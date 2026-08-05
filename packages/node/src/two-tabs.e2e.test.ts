import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { ed25519 } from '@noble/curves/ed25519.js'
import { CID } from 'multiformats/cid'
import { chromium } from 'playwright'
import type { Browser, BrowserContext, Page } from 'playwright'
import { createServer } from 'vite'
import type { ViteDevServer } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { signName, toHex } from '@o2/core'
import type { NameRecord } from '@o2/core'
import type { TabNameRecord } from '@o2/browser'
import { KERNEL_RECORD, kernelBytes } from '@o2/demo'
// Test-only relative import — see the note in packages/net/src/distributed.test.ts.
import { MODULE_WRITES_PARTITION } from '../../core/src/executor/fixtures.ts'
import { FabricNode } from './fabric-node.ts'

/**
 * NET-02 — two browser tabs, one machine, a real WebRTC data path.
 *
 * The topology this project is a bet on. Neither tab can accept a connection, so
 * both reserve on a Circuit Relay v2 peer; the relay carries only the SDP exchange,
 * and once ICE completes the job runs over a direct browser-to-browser WebRTC
 * connection with the relay out of the path.
 *
 * Two isolated `BrowserContext`s rather than two pages in one context: each gets its
 * own origin storage, so the tabs share no IndexedDB, no peer identity, and no
 * libp2p state. They are separate nodes in every sense except the machine they run
 * on — which is the one thing this test does not claim.
 *
 * Driven from Node because the pieces live on both sides of the boundary: the relay
 * and the WASM fixture are Node-side, the nodes are browser-side. Vitest's browser
 * mode gives one page per file, so genuine multi-tab work needs Playwright directly.
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const PAGE = 'packages/browser/demo/index.html'

interface Tab {
  readonly name: string
  readonly context: BrowserContext
  readonly page: Page
  readonly peerId: string
}

/** The `keypair(seed)` fixture from `packages/core/src/naming.test.ts`. */
function keypair(seed: number): { priv: Uint8Array; pub: string } {
  const priv = new Uint8Array(32).fill(seed)
  return { priv, pub: toHex(ed25519.getPublicKey(priv)) }
}

/**
 * DET-03/DATA-08 — the build authority for the fixture module these tabs run.
 *
 * Both tabs pin `harness.pub` and nothing else, which **replaces** the demo's own
 * default anchor rather than joining it (see `TabApi.start`). That is correct here: the
 * module under test is `MODULE_WRITES_PARTITION`, a fixture this harness built and signs
 * for — the demo's kernel is not involved, so the demo's build authority has no standing
 * over it.
 *
 * `unpinned` signs records that are genuine in every respect except that no tab asked
 * for them. Seeds 51 and 52 are distinct from every other fixture key in the repository
 * (1-3, 9, 11-12, 21-24, 30-31, 40-42, 50, 60, 70-82, 90-98), so a mixed-up key produces
 * a clear untrusted-signer refusal rather than an accidental pass.
 */
const harness = keypair(51)
const unpinned = keypair(52)

/** The fixture module's published name. Arbitrary, and shared by both records below. */
const FIXTURE_NAME = 'o2-two-tabs-partition-fixture'

/**
 * A `NameRecord` in the shape that survives `page.evaluate`.
 *
 * Structured cloning does not preserve a `CID` instance — see `TabNameRecord`'s own doc
 * in `packages/browser/src/tab-api.ts`, which is the one place that reason is written
 * down.
 */
function asTabRecord(record: NameRecord): TabNameRecord {
  return { ...record, cid: record.cid.toString() }
}

/** Sign `cid` under {@link FIXTURE_NAME} with `key`, five minutes from now. */
function signFixture(key: { priv: Uint8Array }, cid: string): TabNameRecord {
  return asTabRecord(
    signName(key.priv, {
      name: FIXTURE_NAME,
      cid: CID.parse(cid),
      version: 1,
      expiresAt: Date.now() + 300_000,
    }),
  )
}

let relay: FabricNode
let relayAddr: string
let server: ViteDevServer
let browser: Browser
let baseUrl: string
let workdir: string
const tabs: Tab[] = []

/** Open an isolated context, load the page, and start a node in it. */
async function openTab(name: string): Promise<Tab> {
  const context = await browser.newContext()
  const page = await context.newPage()

  // Surface page errors in the test output; a silent browser failure here is
  // otherwise indistinguishable from a timeout.
  page.on('pageerror', (error) => {
    process.stderr.write(`[${name}] page error: ${error.message}\n`)
  })
  page.on('console', (message) => {
    if (message.type() === 'error') process.stderr.write(`[${name}] console: ${message.text()}\n`)
  })

  await page.goto(`${baseUrl}${PAGE}`)
  await page.waitForFunction(() => typeof window.o2 !== 'undefined', null, { timeout: 30_000 })

  const peerId = await page.evaluate(
    async ([address, store, anchor]) => {
      // BROW-01 has no test-only bypass: a harness consents for the same reason a
      // visitor clicks the button.
      window.o2.grantConsent()
      // DET-03: this tab will run a module exactly when `harness` signed for it — see
      // `harness` above. Replaces the demo's default anchor rather than joining it, which
      // the third case below reads rather than assumes.
      return window.o2.start({
        relayAddrs: [address!],
        blockstoreName: store!,
        trustAnchors: [anchor!],
      })
    },
    [relayAddr, `o2-${name}`, harness.pub],
  )

  const tab: Tab = { name, context, page, peerId }
  tabs.push(tab)
  return tab
}

beforeAll(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'o2-tabs-'))

  relay = await FabricNode.start({
    relayAdmission: 'admits-any-peer',
    startReporting: 'reports-its-own-start',
    // Comfortably above the two tabs, so a refusal cannot be mistaken for a bug.
    maxReservations: 16,
    listen: ['/ip4/127.0.0.1/tcp/0/ws'],
    // DET-03: relays, executes nothing — the subject is two tabs reaching each other.
    // See `background-tab.e2e.test.ts` for the full note.
    trustAnchors: 'runs-unsigned-artifacts',
  })
  const address = relay.browserDialableAddrs[0]
  if (address === undefined) throw new Error('relay produced no browser-dialable address')
  relayAddr = address

  // Root at the repo so workspace packages and their `./src/index.ts` entries
  // resolve without fs.allow gymnastics.
  server = await createServer({
    root: ROOT,
    logLevel: 'error',
    server: { port: 0 },
    // Dependency pre-bundling must stay ON. Several libp2p transitive deps are
    // CommonJS (`netmask`, reached via @libp2p/utils), and without pre-bundling the
    // browser fails on `does not provide an export named 'Netmask'` — an ESM/CJS
    // interop error that looks like a missing module.
  })
  await server.listen()
  const url = server.resolvedUrls?.local[0]
  if (url === undefined) throw new Error('vite dev server produced no URL')
  baseUrl = url.endsWith('/') ? url : `${url}/`

  browser = await chromium.launch()
}, 180_000)

afterAll(async () => {
  for (const tab of tabs) {
    await tab.page.evaluate(async () => window.o2.stop()).catch(() => {})
    await tab.context.close().catch(() => {})
  }
  await browser?.close().catch(() => {})
  await server?.close().catch(() => {})
  await relay?.stop().catch(() => {})
  await rm(workdir, { recursive: true, force: true })
}, 120_000)

describe('NET-02 — two tabs on one machine', () => {
  it('each tab reserves on the relay and gets a dialable /webrtc address', async () => {
    const a = await openTab('a')
    const b = await openTab('b')

    expect(a.peerId).not.toBe(b.peerId)

    const [aAddrs, bAddrs] = await Promise.all([
      a.page.evaluate(async () => window.o2.waitForWebrtcAddr(60_000)),
      b.page.evaluate(async () => window.o2.waitForWebrtcAddr(60_000)),
    ])

    for (const [tab, addrs] of [
      [a, aAddrs],
      [b, bAddrs],
    ] as const) {
      expect(addrs.length).toBeGreaterThan(0)
      // A browser's WebRTC address is expressed through the relay that will carry
      // its SDP exchange — it cannot exist standalone.
      expect(addrs[0]).toContain('/webrtc')
      expect(addrs[0]).toContain(relay.peerId)
      expect(addrs[0]).toContain(tab.peerId)
    }

    // Both reservations are held simultaneously.
    expect(relay.capacity.granted).toBeGreaterThanOrEqual(2)
    expect(relay.capacity.atCapacity).toBe(false)
  }, 180_000)

  it('completes a 2x-redundant map job over a direct WebRTC connection', async () => {
    const [a, b] = tabs as [Tab, Tab]

    const bAddrs = await b.page.evaluate(async () => window.o2.waitForWebrtcAddr(60_000))
    const target = bAddrs[0]!

    // Tab A dials tab B at its /webrtc address. The relay signals; the resulting
    // connection is direct.
    const dialed = await a.page.evaluate(async (address) => window.o2.dial(address), target)
    expect(dialed).toBe(b.peerId)
    expect(await a.page.evaluate(() => window.o2.peers())).toContain(b.peerId)

    // THE claim of this phase: the relay carried only the SDP exchange, and the data
    // path is a direct WebRTC connection. libp2p marks a relayed circuit as
    // *limited* (2 min / 128 KiB); a WebRTC connection has no such limits. If the
    // job were running over the relay this assertion is what would catch it.
    const connections = await a.page.evaluate(
      async (peer) => window.o2.connectionsTo(peer),
      b.peerId,
    )
    expect(connections.length).toBeGreaterThan(0)
    const webrtc = connections.filter((c) => c.remoteAddr.includes('/webrtc'))
    expect(webrtc.length).toBeGreaterThan(0)
    for (const connection of webrtc) expect(connection.limited).toBe(false)

    // Only tab A holds the module. Tab B has a fresh IndexedDB and must pull it.
    const moduleCid = await a.page.evaluate(
      async (bytes) => window.o2.putModule(bytes),
      [...MODULE_WRITES_PARTITION],
    )

    // DET-03/DATA-08: both tabs pin `harness.pub`, so the module needs a record that key
    // signed for this exact CID. `putModule` returned it; the harness signs over it.
    const record = signFixture(harness, moduleCid)

    const report = await a.page.evaluate(
      async ([cid, peer, signed]) =>
        window.o2.runJob({
          moduleCid: cid as string,
          moduleRecord: signed as TabNameRecord,
          peerIds: [peer as string],
          shards: 4,
          redundancy: 2,
          // A submits and also executes; B executes. Two tabs, 2x redundancy.
          includeSelf: true,
        }),
      [moduleCid, b.peerId, record] as const,
    )

    expect(report.complete).toBe(true)
    // The paired positive for the two refusal cases below: the same field, in the same
    // file, shown reading the other value. An assertion that a refusal happened proves
    // nothing about the instrument unless the instrument is also seen reporting silence.
    expect(report.failures).toEqual([])
    expect(report.partitions).toEqual([0, 1, 2, 3])
    for (const replicas of report.replicas) expect(replicas).toBe(2)
    for (const agreeing of report.agreeing) {
      expect([...agreeing].sort()).toEqual([a.peerId, b.peerId].sort())
    }
    expect(report.verificationMultiplier).toBeCloseTo(2, 6)
    expect(report.rejected).toBe(0)

    // Criterion 2 — the manifest reaches the demo's real entry point (`runJob`,
    // called through `window.o2` exactly as a visitor's page does), not only a
    // test-side harness that builds its own `EgressGuard`. Both `entries.length`
    // and `violations` are checked, per 13-CONTEXT.md decision 3: a manifest with
    // zero entries reports zero violations trivially, and the two must never be
    // allowed to look alike.
    expect(report.egress.entries.length).toBeGreaterThan(0)
    expect(report.egress.violations).toEqual([])
  }, 240_000)

  /**
   * DET-03/DATA-08 — the browser tier's guard, on the live path, between two real
   * contexts.
   *
   * This is the case that goes green-to-red if the `provenance(...)` wrapper in
   * `browser-node.ts`'s executor composition is deleted. Beside it rather than inside
   * the job test above, so the accepted and refused readings are two independent runs of
   * the same instrument rather than two halves of one.
   *
   * **What it proves:** a job dispatched between two genuinely separate browser
   * contexts, over a real relay-signalled WebRTC connection, is refused when its record
   * is signed by a key no tab pinned — and the refusal carries the resolver's own
   * wording, so it is distinguishable from a relay that dropped. `complete: false` alone
   * would be produced by that too, which is exactly why the boolean is not the assertion.
   *
   * **What it does not prove:** that the refusal happened before
   * `WebAssembly.instantiate`. Nothing inside a page can watch that call. That property
   * is carried by `module-provenance.test.ts`'s call-counter readings and by
   * `signed-artifact.node.test.ts`'s never-fetched module block; neither runs in a
   * browser, and this test adds neither and claims neither.
   *
   * The demo bundle these contexts load always passes `createTaskWorker`, so the
   * executor under test here is the `WorkerExecutor`. A guard attached to some other
   * executor would fail this case rather than pass it, which is why the proof lives in
   * e2e and not in a unit test that composes its own executor.
   */
  it('refuses a job whose record no tab pinned, and says so in words', async () => {
    const [a, b] = tabs as [Tab, Tab]

    const moduleCid = await a.page.evaluate(
      async (bytes) => window.o2.putModule(bytes),
      [...MODULE_WRITES_PARTITION],
    )

    // Genuine in every respect except the one that matters: correctly signed, unexpired,
    // naming the CID actually dispatched — and signed by a key neither tab asked for.
    const forged = signFixture(unpinned, moduleCid)

    const report = await a.page.evaluate(
      async ([cid, peer, signed]) =>
        window.o2.runJob({
          moduleCid: cid as string,
          moduleRecord: signed as TabNameRecord,
          peerIds: [peer as string],
          shards: 2,
          redundancy: 2,
          includeSelf: true,
        }),
      [moduleCid, b.peerId, forged] as const,
    )

    expect(report.complete).toBe(false)
    // Asserted before anything about the text: a `some()` over an empty array is `false`
    // for the wrong reason, and would read as a passing test that measured nothing.
    expect(report.failures.length).toBeGreaterThan(0)
    expect(report.failures.some((f) => f.reason.includes('not a pinned trust anchor'))).toBe(true)
  }, 240_000)

  /**
   * The other half of "pins the harness key **and nothing else**".
   *
   * `KERNEL_RECORD` is not a forgery: it is the demo's own committed record, signed by
   * the demo's own build authority, over the CID of the kernel this repository ships. A
   * tab that had *merged* the supplied anchors with the demo default would run this job
   * happily. These tabs asked for `harness.pub`, so they must refuse it.
   *
   * That is what makes "replaced, not extended" a reading rather than a claim — and it
   * is the strongest reading available from outside the page, which is weaker than
   * inspecting the anchor set and is stated as such: it proves the demo anchor is
   * **absent**, not that the set holds exactly one entry. Nothing exposes a tab's pinned
   * anchors, and this phase does not add such a surface — that would put node
   * configuration on `window.o2`.
   *
   * `colouring-demo.e2e.test.ts` supplies the opposite direction: the same record
   * accepted by a tab that pinned nothing and therefore inherited the demo default. Both
   * directions are observed, in two files.
   */
  it('refuses the demo’s own genuine record, because these tabs asked for a different authority', async () => {
    const [a, b] = tabs as [Tab, Tab]

    const moduleCid = await a.page.evaluate(
      async (bytes) => window.o2.putModule(bytes),
      [...kernelBytes],
    )
    // The record vouches for the kernel this repository ships, and `putModule` just
    // hashed those same bytes. `kernel-build.node.test.ts` is what keeps the two equal;
    // asserted here so a drift shows up as this line rather than as a refusal with the
    // right words for the wrong reason.
    expect(moduleCid).toBe(KERNEL_RECORD.cid.toString())

    const report = await a.page.evaluate(
      async ([cid, peer, signed]) =>
        window.o2.runJob({
          moduleCid: cid as string,
          moduleRecord: signed as TabNameRecord,
          peerIds: [peer as string],
          shards: 2,
          redundancy: 2,
          includeSelf: true,
        }),
      [moduleCid, b.peerId, asTabRecord(KERNEL_RECORD)] as const,
    )

    expect(report.complete).toBe(false)
    expect(report.failures.length).toBeGreaterThan(0)
    expect(report.failures.some((f) => f.reason.includes('not a pinned trust anchor'))).toBe(true)
  }, 240_000)

  it('leaves the pulled blocks in the second tab’s IndexedDB', async () => {
    const [a, b] = tabs as [Tab, Tab]

    // The module was only ever put into tab A. Tab B pulled it over the WebRTC
    // connection during the job, and it persisted browser-side — DATA-02 holding on
    // the real path rather than in a unit test.
    const moduleCid = await a.page.evaluate(
      async (bytes) => window.o2.putModule(bytes),
      [...MODULE_WRITES_PARTITION],
    )

    expect(await b.page.evaluate(async (cid) => window.o2.hasBlock(cid), moduleCid)).toBe(true)

    // Blocks: the module, plus one input per shard from the previous test.
    const stored = await b.page.evaluate(async () => window.o2.storedBlocks())
    expect(stored).toBeGreaterThanOrEqual(1 + 4)
  }, 120_000)

  /**
   * The panel presents an aggregate that now exists, and the count beside it is honest.
   *
   * **This case was inverted on 2026-08-04 and the sentence it used to make is kept
   * here rather than deleted.** It read *"renders no peer aggregate beside a report
   * that can only hold this tab"*, and it was right for exactly as long as its premise
   * held: `serveAgent`'s report branch is the only absorber of a peer's start outcome,
   * and every production call site opted out of it with the `'keeps-no-ledger'`
   * sentinel, so a merged report could only ever contain this tab's own row however
   * many peers were asked. Plan 20-02 removed the premise — both node factories now
   * build a real `StartOutcomeLedger` and record their own row into it — and **this case
   * went red on that change alone, before any render was touched**: `expected '0 of 2
   * reported starts failed (0.0%)…' to contain 'no start outcomes reported'`.
   *
   * ## The reading is a family, not a count
   *
   * `openTab` calls `grantConsent()` bare, so `reportingAllowed` is false and this tab
   * sends `outcome: null`. It therefore contributes **nothing** — not to a peer, and not
   * to its own merged view, because `publishStartOutcome` records the local outcome only
   * when there is one. Every row in this panel was learned from somebody else.
   *
   * The load-bearing row is `other`. That is the **Node** tier's family label
   * (`fabric-node.ts`'s `OWN_START_FAMILY`), it arrives from the relay's own ledger, and
   * there is no user-agent string a chromium tab could report that yields it — a count
   * above 1 is satisfiable by an accident or a double-record, and a family this tab has
   * no expression to produce is not.
   *
   * ## What this file does NOT carry
   *
   * **Criterion 5's reading is not here.** Two tabs of one engine share a family label
   * and `mergeOverlapping` takes the maximum per `(browser, result)` key, so a
   * two-chromium fixture cannot tell two browser peers from one. That reading is
   * `peer-ledger.e2e.test.ts`, across three engines. What this case holds is narrower and
   * still worth holding: the demo panel's own rendering, the restored contributor count,
   * and the fact that a visitor who declined to be counted still sees everything.
   *
   * This file runs in the `e2e` project only, so nothing about it is visible to the
   * `npm run test:unit` loop.
   */
  it('renders the merged aggregate a declining tab could not have produced', async () => {
    const [a] = tabs as [Tab]

    // `page.evaluate`, not a locator click: `#refresh-report` lives inside `#main`,
    // which stays hidden until `reveal()` runs on a button press, and this harness
    // drives `window.o2` directly rather than clicking Start. A locator click would
    // fail actionability and the test would go red for the wrong reason.
    await a.page.evaluate(() => {
      document.getElementById('refresh-report')?.click()
    })
    await a.page.waitForFunction(
      () => (document.getElementById('report')?.textContent ?? 'not asked yet') !== 'not asked yet',
      null,
      { timeout: 30_000 },
    )
    const panel = await a.page.evaluate(() => document.getElementById('report')?.textContent ?? '')

    // The load-bearing assertion: a tally line for a family this tab cannot express.
    // Anchored on `describeStartReport`'s two-space row indent so a blind spot note
    // mentioning the word `other` in prose cannot satisfy it.
    expect(panel).toMatch(/^ {2}other: /m)

    // The paired negative, so the row above is shown to be a *merge* rather than this
    // tab's own outcome having been counted after all. This tab declined, so the
    // summary line it would produce alone is exactly the string this used to assert.
    expect(panel).not.toContain('no start outcomes reported')

    // The restored juxtaposition, and the anti-vacuity reading on it. `0 of 0 asked`
    // renders just as happily as a real fan-out, so the count is parsed rather than
    // matched: every peer asked answered, and at least two were asked — the other tab
    // and the relay.
    const answering = /peers answering: (\d+) of (\d+) asked/.exec(panel)
    expect(answering).not.toBeNull()
    const [reached, asked] = [Number(answering?.[1]), Number(answering?.[2])]
    expect(asked).toBeGreaterThanOrEqual(2)
    expect(reached).toBe(asked)

    // That same bare `grantConsent()` is one visitor declining to be counted, and the
    // running-node path is the only place that count could be dropped — no unit test
    // can import the demo glue that passes it. Still local, still never transmitted.
    expect(panel).toContain('not counted: 1')
  }, 120_000)
})
