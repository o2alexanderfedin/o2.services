import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import type { Browser, BrowserContext, Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { describeAttestation } from '@o2/core'
import { KERNEL_TRUST_ANCHOR } from '@o2/demo'
import { FabricNode } from './fabric-node.ts'

/**
 * Criterion 3's demo-UI half — the label a visitor actually reads, read off the screen.
 *
 * VER-09 and VER-10 ask that a result say how strongly it was attested **wherever it is
 * displayed**, and that *"we cannot say"* and *"one node said so"* never collapse into one
 * sentence. `bench-attestation.node.test.ts` takes that reading off the CLI. This is the
 * other surface the criterion names, and it is the one with the widest audience.
 *
 * ## What the page used to say, and why it is a defect rather than a wording choice
 *
 * `demo/index.html` printed, unconditionally, on every settled run:
 *
 * > *"Verification cost N× — each cube ran twice, on different nodes, and the two had to
 * > agree."*
 *
 * That sentence is composed by the page and not by the kernel, and the page had no way to
 * know whether it was true. The demo runs at `redundancy = min(2, 1 + peers)`, so a lone
 * visitor — which is every visitor who opens it first — ran every cube **once** and was
 * told it ran twice. Measured, not argued: the first case below produced
 * `Verification cost 1.00× — each cube ran twice, on different nodes` in the same run, off
 * a report whose own placement section listed one node per cube. All three cases assert
 * the wording is gone, because a page can ship a stronger claim than its kernel makes for
 * years with nothing noticing.
 *
 * ## Three readings, because one would pass against a page printing a constant
 *
 * 1. **An enrolled tab, alone, at redundancy 1** reads `owner-attested` — the weakest of
 *    the three labels and the correct one: one certified node computed the answer and
 *    signed for it, and nobody checked it. This is the criterion's own sentence.
 * 2. **The same tab beside a peer nobody enrolled** reads the *stated absence*, naming
 *    that peer, and none of the three strength sentences. The failure this excludes looks
 *    like success: `attestationReceipt([])` answers `owner-attested` for an empty set, so
 *    a page falling back to it would tell a visitor that one node vouched for an answer
 *    two nodes produced.
 * 3. **The same tab beside a peer enrolled by a provider it does not pin** reads the same
 *    absence. This is the sharpest of the three and the one that guards the fix rather
 *    than the display: `receiptFor` verifies a replica's attestation against
 *    **`descriptor.certificate.issuer`** — the issuer named by the descriptor it was
 *    handed — so a certificate taken off the wire and put on a descriptor unverified would
 *    supply its own trust root, and two strangers under two operator ids would be reported
 *    `independent`. Remove the `verifyCertificate` call in `demo/main.ts`'s
 *    `peerCertificate` and this case reads a strength that was never established.
 *
 * Every strength sentence is compared against `describeAttestation` rather than
 * transcribed, so a change to the kernel's words reddens this file instead of letting the
 * CLI and the page drift into describing one result differently.
 *
 * ## Why a new file rather than an edit to `colouring-demo.e2e.test.ts`
 *
 * That file drives the **Vite dev server**, which resolves modules on the fly and forgives
 * a great deal. This reading belongs on the artifact that would actually be published, so
 * the fixture is `built-bundle.e2e.test.ts`'s: `vite build` and a dumb 404-ing static file
 * server over `dist/`.
 *
 * **What the extra build costs — measured, so the optimisation nobody has taken can be
 * decided on a number.** This is the **third** spec in the `e2e` project to run
 * `vite build`; `built-bundle.e2e.test.ts` and `static-rendezvous.e2e.test.ts` are the
 * other two, and the project sets `fileParallelism: false`, so the three are serial.
 *
 * Two readings of this file's build on 2026-08-03, both printed by the first case:
 * **1943 ms** cold and **943 ms** warm, against a whole-file wall clock of **15.61 s
 * real, 24.43 s user, 2.07 s sys** — a `(user+sys)/real` ratio of **1.70**, i.e. the
 * process held more CPU than wall clock and was not starved. The figures come from
 * `/usr/bin/time -p` around the run rather than from the machine's load average, which
 * counts I/O-blocked threads and says nothing about whether *this* process got CPU. The
 * ratio is recorded as a comparability key: a later reading taken at a similar ratio can
 * be compared with this one, and one taken at a very different ratio cannot.
 *
 * So sharing one build across the three specs would save about one second and would cost
 * a real coupling — a spec that no longer builds cannot fail when the sources break the
 * bundle, which is the single property `built-bundle.e2e.test.ts` exists for. On these
 * numbers it is not worth doing, and they are here so the next reader does not guess.
 *
 * **No `MEASURED_NODE_SPANS` entry, and that is not an omission.**
 * `slow-specs.node.test.ts` builds its population with
 * `.filter((path) => !/\.(browser|e2e|perf)\.test\.ts$/.test(path))`, so that table covers
 * the `node` project alone and this file is outside its jurisdiction by construction.
 *
 * ## No relay, and the peer is a `FabricNode` — both deliberate
 *
 * A first draft used two browser contexts over a real relay, which is `colouring-demo`'s
 * topology, and it measured badly for **this** file's question: the relay is itself a
 * `FabricNode` serving the agent protocol, so `computePeers()` counted it and three nodes
 * computed. `JobResult.attestation` reports the **first** shard carrying an absence, so
 * which unaccounted node the page named depended on which pair happened to take cube 0 —
 * a reading that would have had to be weakened to *"some node was unnamed"*.
 *
 * With one peer there is one answer. The peer is a Node process rather than a tab because
 * **all nodes have equal functionality and the only difference is discovery** — a tab
 * binds no listening socket, so a second tab needs a relay to be reachable and a Node peer
 * does not. Nothing in the page's path differs: the same `computePeers()` offer, the same
 * `records` request, the same `RemoteExecutor` dispatch.
 *
 * **What that gives up, stated:** this file takes no reading over WebRTC and none through
 * a relay. `colouring-demo.e2e.test.ts` drives the identical page code path across two
 * tabs, and `static-rendezvous.e2e.test.ts` does it on this same built bundle across three
 * engines. Neither of them reads a label, and this one reads no transport.
 *
 * ## The readings are comparative, and the fourth case is the comparison itself
 *
 * Owner rule: *prefer a comparative reading to an absolute one* — an absolute threshold
 * encodes the machine, the load and the I/O weather of the day it was written. Almost
 * nothing below is absolute. The strength sentences are compared against
 * `describeAttestation` rather than transcribed, so a change to the kernel's words moves
 * both sides together; each case asserts the two *other* labels are absent, which is a
 * comparison among the three within one run; and cases 2 and 3 assert the report names the
 * peer as unaccounted **and does not name the submitter**, which is the comparison between
 * what this tab could check and what it could not, taken inside a single job.
 *
 * The fourth case makes the cross-case comparison explicit, because it is the one defect
 * #34 turns on: **a strength appears in exactly the run where no replica went
 * unaccounted.** What would break it, stated so it is not a ratio that always passes — a
 * page printing a strength beside an unaccounted replica (plants P3 and P5 both do), or a
 * page reporting the absence for a run in which everything checked out, which is precisely
 * what an in-process dispatch through the unsigned executor produced before this plan.
 *
 * The absolutes that remain are the per-case timeouts, and they are sited: the whole file
 * measured **15.61 s real / 24.43 s user / 2.07 s sys** — ratio **1.70** — so each 900 s
 * case budget is roughly sixty times the observed cost of the entire file, and is there to
 * turn a hang into a named failure rather than to measure anything.
 *
 * ## One engine, and the limit is the project's rather than this file's
 *
 * `e2e` specs launch Playwright themselves and every one of them is chromium-only;
 * `static-rendezvous.e2e.test.ts` is the sole multi-engine reading in the repository. So
 * the engine-against-engine comparison that file can make is **not available here**, and
 * this file substitutes the run-against-run one above rather than claiming the other.
 *
 * ## Every provider is stopped before any job runs
 *
 * Not tidiness — it is two readings in one act. It takes the provider out of the tab's
 * connected set, so `computePeers()` cannot silently turn a two-node case into a
 * three-node one; and it means every certificate below is verified with its issuer
 * offline and unreachable, which is the whole point of pinning a provider key rather than
 * asking one.
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const DIST = join(ROOT, 'packages', 'browser', 'dist')

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
}

/**
 * The user the tab enrols on behalf of — the **private** half, and it has to be.
 *
 * `EnrollmentAuthority.enrol` refuses by name as `bad-owner-proof` without a signature
 * over its own challenge, and only the private key can produce one.
 *
 * Seeds 68 and 69, checked against the repository's whole `fill(n)` census on 2026-08-03:
 * 66 and 67 are taken, 68 and 69 are free, 70 is taken. Two users rather than one, because
 * the third case needs a peer enrolled by somebody the tab does not pin and a shared user
 * key would leave "different provider" and "different owner" varying together.
 */
const TAB_USER_KEY = [...new Uint8Array(32).fill(68)]
const STRANGER_USER_KEY = new Uint8Array(32).fill(69)

const TAB_OPERATOR = 'harbour-road-volunteers'
const STRANGER_OPERATOR = 'somebody-elses-fleet'

/** The three sentences the kernel owns. Compared against, never transcribed. */
const OWNER_ATTESTED = describeAttestation('owner-attested')
const OWNER_DOMAIN = describeAttestation('owner-domain')
const INDEPENDENT = describeAttestation('independent')

/** The claim the page asserted on every run, true only sometimes. */
const THE_OLD_CLAIM = 'on different nodes'

let server: Server
let baseUrl: string
let browser: Browser
let workdir: string
/** Wall time of `vite build`, so this file's largest fixed cost is a reading. */
let buildMs = 0
const contexts: BrowserContext[] = []
const started: FabricNode[] = []

beforeAll(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'o2-attestation-ui-'))

  // Built here rather than assuming a current `dist/`: the reading must fail when the
  // *sources* break the bundle, not when somebody forgot to rebuild.
  const startedBuild = Date.now()
  execFileSync('npx', ['vite', 'build', '--config', 'packages/browser/vite.config.ts'], {
    cwd: ROOT,
    stdio: 'pipe',
  })
  buildMs = Date.now() - startedBuild

  // Deliberately dumb: no module resolution, no transforms, no fallbacks — what a static
  // host is, and therefore what the artifact has to work against.
  server = createServer((request, response) => {
    const path = (request.url ?? '/').split('?')[0] ?? '/'
    const file = join(DIST, normalize(path === '/' ? '/index.html' : path))
    if (!file.startsWith(DIST)) {
      response.writeHead(403).end()
      return
    }
    readFile(file).then(
      (bytes) => {
        response.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' })
        response.end(bytes)
      },
      () => {
        // Exactly what a static host does for /bootstrap.json.
        response.writeHead(404).end('not found')
      },
    )
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no server port')
  baseUrl = `http://127.0.0.1:${address.port}`

  browser = await chromium.launch()
}, 420_000)

afterAll(async () => {
  for (const context of contexts) await context.close().catch(() => {})
  await browser?.close().catch(() => {})
  for (const node of started) await node.stop().catch(() => {})
  await new Promise<void>((resolve) => server?.close(() => resolve()))
  await rm(workdir, { recursive: true, force: true })
}, 180_000)

/** A node's own browser-dialable address, or a failure naming which node had none. */
function dialable(node: FabricNode, name: string): string {
  const addr = node.browserDialableAddrs[0]
  if (addr === undefined) throw new Error(`${name} produced no browser-dialable address`)
  return addr
}

/**
 * A provider that will sign certificates, started for one case and stopped inside it.
 *
 * One per case rather than one shared: each case needs its issuer **gone** before its job
 * runs, and a shared provider would make a later case depend on an earlier one not having
 * stopped it. Separate `blockstoreDir`s also mean separate signing keys, which is what
 * makes the third case's provider a genuine stranger rather than the same key twice.
 */
async function startProvider(name: string): Promise<{ node: FabricNode; addr: string }> {
  const node = await FabricNode.start({
    relayAdmission: 'admits-any-peer',
    startReporting: 'reports-its-own-start',
    blockstoreDir: join(workdir, name),
    listen: ['/ip4/127.0.0.1/tcp/0/ws'],
    trustAnchors: [KERNEL_TRUST_ANCHOR],
    // What gives it a signing key at all. The key is persisted under `blockstoreDir`, so
    // the issuer a certificate names is a real value rather than one invented here.
    issuesCertificates: 'issues-without-an-aggregate-budget',
  })
  started.push(node)
  return { node, addr: dialable(node, name) }
}

/**
 * An ordinary peer that will run cubes for the tab.
 *
 * It pins the demo's own build authority, so it checks the kernel's signed record exactly
 * as the tab does — nothing here runs an unsigned artifact to make a fixture simpler.
 */
async function startPeer(
  name: string,
  enrollment?: { userPrivateKey: Uint8Array; operatorId: string; providerAddr: string },
): Promise<{ node: FabricNode; addr: string }> {
  const node = await FabricNode.start({
    relayAdmission: 'admits-any-peer',
    startReporting: 'reports-its-own-start',
    blockstoreDir: join(workdir, name),
    listen: ['/ip4/127.0.0.1/tcp/0/ws'],
    trustAnchors: [KERNEL_TRUST_ANCHOR],
    ...(enrollment === undefined ? {} : { enrollment }),
  })
  started.push(node)
  return { node, addr: dialable(node, name) }
}

/** A fresh page on the built bundle, consented. BROW-01 has no test-only bypass. */
async function openPage(name: string): Promise<Page> {
  const context = await browser.newContext()
  contexts.push(context)
  const page = await context.newPage()
  page.on('pageerror', (error) => {
    process.stderr.write(`[${name}] page error: ${error.message}\n`)
  })
  page.on('console', (message) => {
    if (message.type() === 'error') process.stderr.write(`[${name}] console: ${message.text()}\n`)
  })
  await page.goto(`${baseUrl}/`)
  await page.waitForFunction(() => typeof window.o2 !== 'undefined', null, { timeout: 60_000 })
  await page.waitForFunction(
    () => document.getElementById('gate')?.hasAttribute('hidden') === false,
    null,
    { timeout: 30_000 },
  )
  await page.click('#allow')
  await page.waitForFunction(
    () => document.getElementById('main')?.hasAttribute('hidden') === false,
    null,
    { timeout: 30_000 },
  )
  return page
}

/**
 * Start the tab enrolled with `provider`, then stop the provider.
 *
 * `relayAddrs: []` — this tab dials nothing on the way up. `enrollment.providerAddr` is
 * what reaches the provider, and `resolveCertificate` has one throw site for all three
 * failure kinds, so reaching the next line means this tab holds a certificate rather than
 * having quietly gone without one.
 */
async function startEnrolled(
  page: Page,
  store: string,
  provider: { node: FabricNode; addr: string },
): Promise<string> {
  const peerId = await page.evaluate(
    async (options) =>
      window.o2.start({
        relayAddrs: [],
        blockstoreName: options.store,
        enrollment: {
          userPrivateKey: options.userPrivateKey,
          operatorId: options.operatorId,
          providerAddr: options.providerAddr,
        },
      }),
    { store, userPrivateKey: TAB_USER_KEY, operatorId: TAB_OPERATOR, providerAddr: provider.addr },
  )
  await provider.node.stop()
  return peerId
}

/** Press the page's own Run button and wait for the ladder to stop climbing. */
async function runTheLadder(page: Page, budgetMs: number): Promise<string> {
  await page.waitForFunction(
    () => document.getElementById('run')?.hasAttribute('disabled') === false,
    null,
    { timeout: 60_000 },
  )
  await page.click('#run')
  await page.waitForFunction(
    () => {
      const status = document.getElementById('run-status')?.textContent ?? ''
      return status.startsWith('settled') || status === 'nothing settled'
    },
    null,
    { timeout: budgetMs },
  )
  const status = (await page.textContent('#run-status')) ?? ''
  // A run that settled nothing produces no report to read a label off, and saying so is a
  // different failure from a label that was wrong. Plan 19-10 lost an afternoon to a
  // receipt taken off a run that had not completed.
  expect(status).toMatch(/^settled/)
  // On screen, not in the DOM's opinion of itself: an id rule that sets `display` outranks
  // the browser's own `[hidden]`, which is how the always-visible bar on this very page
  // came to be visible while idle.
  expect(await page.isVisible('#run-report')).toBe(true)
  return (await page.textContent('#run-report')) ?? ''
}

/** Neither of the two stronger sentences, asserted wherever a weaker one is expected. */
function readsNoStrongerLabel(report: string): void {
  expect(report).not.toContain(OWNER_DOMAIN)
  expect(report).not.toContain(INDEPENDENT)
}

/**
 * Did this report claim a strength, and did it name a replica it could not account for?
 *
 * Derived from the rendered text rather than from anything the page was handed, so the
 * fourth case compares three screens and not three return values.
 */
function readingOf(label: string, report: string): {
  label: string
  strength: boolean
  unaccounted: boolean
} {
  return {
    label,
    strength: [OWNER_ATTESTED, OWNER_DOMAIN, INDEPENDENT].some((line) => report.includes(line)),
    unaccounted: report.includes('this requestor holds no certificate for it'),
  }
}

/** Each case's rendered report, kept for the cross-case comparison at the end. */
const readings: { label: string; strength: boolean; unaccounted: boolean }[] = []

describe('VER-09/VER-10 criterion 3 — the demo page says how strongly its answer was attested', () => {
  it('reads owner-attested for an enrolled tab that ran every cube by itself', async () => {
    const provider = await startProvider('provider-solo')
    const page = await openPage('solo')
    await startEnrolled(page, 'o2-attestation-solo', provider)

    const report = await runTheLadder(page, 420_000)
    readings.push(readingOf('solo', report))
    process.stderr.write(`[attestation-ui] vite build ${buildMs} ms\n[solo]\n${report}\n`)

    // The population the reading came from, said on the page rather than assumed here.
    // Without it, a label taken from a run that quietly acquired a peer would read as a
    // solo one — Plan 19-10's own finding, one surface over.
    expect(await page.textContent('#peers')).toContain('1 node(s) computing')

    // The criterion's sentence, in the kernel's words. `receiptFor` reaches it only
    // because this tab's own replica signed: dispatched in-process through the unsigned
    // executor, the tab is an unaccounted replica and the whole receipt collapses to the
    // named absence however well the run went.
    expect(report).toContain(OWNER_ATTESTED)
    expect(report).toContain('1 replica')
    expect(report).toContain('1 operator')
    readsNoStrongerLabel(report)

    // The shipped overstatement is gone. This run placed one replica per cube, and the
    // old line told the visitor there were two.
    expect(report).not.toContain(THE_OLD_CLAIM)
  }, 900_000)

  it('states the absence, naming the peer, when nobody enrolled that peer', async () => {
    const provider = await startProvider('provider-unenrolled')
    const peer = await startPeer('peer-unenrolled')
    const page = await openPage('unenrolled')
    const submitterId = await startEnrolled(page, 'o2-attestation-unenrolled', provider)

    // Dialled after the tab is up, as an ordinary peer is met. This is the only address
    // this file supplies to a page.
    const dialedId = await page.evaluate(async (address) => window.o2.dial(address), peer.addr)
    expect(dialedId).toBe(peer.node.peerId)

    const report = await runTheLadder(page, 600_000)
    readings.push(readingOf('unenrolled peer', report))
    process.stderr.write(`[unenrolled] peer ${peer.node.peerId}\n${report}\n`)

    // Two nodes really computed, so the receipt reports on an agreement rather than on an
    // empty set — which is the whole difference between this case and the one above.
    expect(await page.textContent('#peers')).toContain('2 node(s) computing')

    // **No strength, because none was established.**
    expect(report).not.toContain(OWNER_ATTESTED)
    readsNoStrongerLabel(report)

    // And the absence is a *statement*, not a blank: it names the replica this tab could
    // not account for, in `receiptFor`'s own words. Transcribed rather than compared
    // against a function because that string is composed per replica and no exported
    // sentence exists to compare it with — the three strengths are the ones that have one.
    expect(report).toContain('produced a signed statement this requestor could check')
    expect(report).toContain(`${peer.node.peerId}: this requestor holds no certificate for it`)
    // The submitter is not among the unaccounted: it enrolled, it signed, and it verified
    // against its own issuer with that issuer stopped.
    expect(report).not.toContain(`${submitterId}: this requestor holds no certificate for it`)

    expect(report).not.toContain(THE_OLD_CLAIM)
  }, 900_000)

  it('states the same absence for a peer enrolled by a provider this tab does not pin', async () => {
    const mine = await startProvider('provider-mine')
    const stranger = await startProvider('provider-stranger')
    // A perfectly ordinary node, correctly enrolled, holding a valid certificate — signed
    // by somebody this tab has never pinned. It answers `records` with it, so unlike the
    // case above there **is** a certificate on the wire here, and the question is whether
    // the page checks it before believing it.
    const peer = await startPeer('peer-stranger', {
      userPrivateKey: STRANGER_USER_KEY,
      operatorId: STRANGER_OPERATOR,
      providerAddr: stranger.addr,
    })
    await stranger.node.stop()

    const page = await openPage('stranger')
    const submitterId = await startEnrolled(page, 'o2-attestation-stranger', mine)
    const dialedId = await page.evaluate(async (address) => window.o2.dial(address), peer.addr)
    expect(dialedId).toBe(peer.node.peerId)

    const report = await runTheLadder(page, 600_000)
    readings.push(readingOf('stranger’s provider', report))
    process.stderr.write(`[stranger] peer ${peer.node.peerId}\n${report}\n`)

    expect(await page.textContent('#peers')).toContain('2 node(s) computing')

    // **The reading that guards the fix.** Two nodes, two distinct operator ids, both
    // signing real attestations against real certificates — everything `classifyAttestation`
    // needs to answer `independent`. It must not, because this tab pinned neither the
    // stranger's provider nor anything that vouches for it, and a receipt built on a
    // certificate that supplied its own trust root would be a strength this run did not
    // establish, printed to whoever is looking at the page.
    expect(report).not.toContain(INDEPENDENT)
    expect(report).not.toContain(OWNER_DOMAIN)
    expect(report).not.toContain(OWNER_ATTESTED)

    expect(report).toContain(`${peer.node.peerId}: this requestor holds no certificate for it`)
    expect(report).not.toContain(`${submitterId}: this requestor holds no certificate for it`)
    expect(report).not.toContain(THE_OLD_CLAIM)
  }, 900_000)

  /**
   * The comparison the three cases exist to support, and the one defect #34 turns on.
   *
   * Each case above asks whether one screen said the right thing. This asks the question
   * a visitor's trust actually rests on: **does a strength appear exactly where nothing
   * went unaccounted?** It reads no absolute — no count, no threshold, no wall clock —
   * only three screens against each other, all three produced by the same page, the same
   * built bundle and the same ladder, differing in one variable each.
   *
   * It can fail, which is the point. A page printing a strength beside an unaccounted
   * replica breaks it — plants P3 and P5 both did — and so does a page reporting the
   * absence for a run in which everything checked out, which is exactly what the demo did
   * before this plan, when a self-included job dispatched through the unsigned executor
   * and the tab could not account for its own replica.
   */
  it('claims a strength in exactly the run where no replica went unaccounted', () => {
    // All three ran. Without this, a suite that skipped two cases would satisfy every
    // comparison below trivially.
    expect(readings.map((reading) => reading.label)).toEqual([
      'solo',
      'unenrolled peer',
      'stranger’s provider',
    ])

    for (const reading of readings) {
      expect({ label: reading.label, strength: reading.strength }).toEqual({
        label: reading.label,
        strength: !reading.unaccounted,
      })
    }

    // And the split is the one the topologies predict rather than any split at all: the
    // solo run is the one that claimed a strength, both peer runs are the ones that did
    // not. A page with the relation inverted would satisfy the loop above.
    expect(readings.filter((reading) => reading.strength).map((reading) => reading.label)).toEqual([
      'solo',
    ])
  })
})
