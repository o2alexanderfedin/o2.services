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
import { ed25519 } from '@noble/curves/ed25519.js'
import { describeAttestation, toHex } from '@o2/core'
import type { NodeSovereignty } from '@o2/core'
import { KERNEL_RECORD, KERNEL_TRUST_ANCHOR, kernelBytes } from '@o2/demo'
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

/**
 * The owner whose two machines run criterion 5's sovereign shard.
 *
 * Distinct from {@link TAB_USER_KEY} (68) and the stranger (69) for this file's stated
 * reason: a mixed-up key must produce a clear untrusted-signer refusal rather than an
 * accidental pass. The tab is the **submitter** here and deliberately not this owner —
 * placement excludes the submitter anyway, so making it the owner too would hide which
 * of the two facts the label came from.
 */
const OWNER_PRIVATE_KEY = new Uint8Array(32).fill(70)
/**
 * The same owner as a hex public key, which is the form placement compares.
 *
 * **`sovereignty.ownerId` is set to this hex key rather than to a label**, and that is
 * the repository's own documented dodge: `fabric-node.ts:1278-1289` publishes
 * `sovereignFor: [certificate.userKey]` and never `sovereignty.ownerId`, so an opaque
 * operator label here would bake a value into a signed statement that Phase 18's
 * sovereign branch could never match.
 */
const OWNER_KEY_HEX = toHex(ed25519.getPublicKey(OWNER_PRIVATE_KEY))
const OWNER_OPERATOR = 'one-owner-two-machines'

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
  sovereignty?: NodeSovereignty,
): Promise<{ node: FabricNode; addr: string }> {
  const node = await FabricNode.start({
    relayAdmission: 'admits-any-peer',
    startReporting: 'reports-its-own-start',
    blockstoreDir: join(workdir, name),
    listen: ['/ip4/127.0.0.1/tcp/0/ws'],
    trustAnchors: [KERNEL_TRUST_ANCHOR],
    ...(enrollment === undefined ? {} : { enrollment }),
    // Omitted rather than defaulted, so a peer this file starts without it is pinned to
    // nobody exactly as before — the three cases above are untouched by this parameter.
    ...(sovereignty === undefined ? {} : { sovereignty }),
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

/**
 * Select the BYO surface the way a visitor does — the tab, which writes the hash.
 *
 * Named for `demo-byo.e2e.test.ts`'s helper of the same shape, because it is the same
 * click; duplicated rather than imported so neither file's fixture can quietly move the
 * other's.
 */
async function showByo(page: Page): Promise<void> {
  await page.click('#nav-byo')
  await page.waitForSelector('#s-byo', { state: 'visible', timeout: 30_000 })
}

/**
 * Press `Dispatch this module` and wait for the surface's own text view to be rewritten.
 *
 * The control is deliberately not the signal — this page's reconciler re-enables it on a
 * one-second tick, so waiting on it would return before the render. The text view and the
 * regions are written by one `applyRender`, so the view changing IS the dispatch having
 * produced a reading. Same reasoning, same wait, as `demo-byo.e2e.test.ts`.
 */
async function dispatchByo(page: Page, budgetMs: number): Promise<void> {
  await page.waitForFunction(
    () => document.getElementById('run-byo')?.hasAttribute('disabled') === false,
    null,
    { timeout: 120_000 },
  )
  const before = (await page.textContent('#byo-report')) ?? ''
  await page.click('#run-byo')
  await page.waitForFunction(
    (was) => (document.getElementById('byo-report')?.textContent ?? '') !== was,
    before,
    { timeout: budgetMs },
  )
}

/** One `[data-region]` inside `#s-byo`, by name. */
async function byoRegion(page: Page, id: string): Promise<string> {
  const text = await page.evaluate(
    (wanted) =>
      Array.from(document.querySelectorAll('#s-byo [data-region]')).find(
        (element) => element.getAttribute('data-region') === wanted,
      )?.textContent ?? null,
    id,
  )
  expect(text, `${id} is not on the byo surface at all`).not.toBeNull()
  return (text ?? '').trim()
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

    // ## DATA-05/DATA-06 — the egress manifest is on screen, **asserted on this run**
    //
    // Off this describe's stated theme, and deliberately so: this ladder costs up to seven
    // minutes and already produces the report the panel is rendered into. A dedicated case
    // would buy a second identical run and nothing else. `runTheLadder` returns the same
    // `#run-report` either way.
    //
    // Audit finding G13 was that every run produced a manifest and the page displayed none
    // of it — the sovereignty claim's only operator-facing surface stopped at `window.o2`.
    expect(report).toContain('What left this device:')
    expect(report).toMatch(/\d+ byte\(s\) total/)

    // **The honesty half, and it is the half worth having.** Every cube here is
    // `label: 'public'`, so `violations` is empty by construction. A panel printing only
    // "0 withheld" would read as a sovereignty proof it cannot support, so the page says
    // why the number is zero. This asserts the disclaimer, not just the digit.
    expect(report).toContain('0 withheld')
    expect(report).toContain('registered no sovereign data')
  }, 900_000)

  /**
   * **VER-10 — `owner-domain` on a screen, for the first time anywhere.**
   *
   * Until today `OWNER_DOMAIN` appeared in this file **only inside `not.toContain`**, three
   * times, plus once in a membership list. `classifyAttestation` could produce the label and
   * `attestationLines` could render it, and no fixture in the repository had ever built a
   * fabric that made one. A label nothing can produce is indistinguishable from a label
   * nothing *would* produce, and VER-10's whole sentence is that the middle claim is
   * reported **as a distinct, weaker one** — which cannot be checked against a screen that
   * has never shown it.
   *
   * ## The fabric, and why it is the smallest one that produces the label
   *
   * `classifyAttestation` (`quorum.ts:285-291`) reads exactly two things: how many replicas
   * agreed, and how many distinct `operatorId`s they carry. `>= 2` replicas and `>= 2`
   * operators is `independent`; `<= 1` replica is `owner-attested`; two or more replicas
   * under **one** operator is `owner-domain` — its own comment calls that *"replicated
   * across the owner's own machines"*.
   *
   * So this case is case 1 plus one peer, with the peer enrolled at **the same provider**
   * under **the same owner key and operator id** as the tab. Same provider is what makes
   * both certificates verifiable — the case below shows what a stranger's provider costs,
   * and the reading collapses to the absence. Same operator is what makes it two machines
   * of one owner rather than two owners.
   *
   * The peer enrols **before** `startEnrolled` stops the provider, which is the one
   * ordering constraint in the fixture.
   *
   * ## What this establishes, stated narrowly
   *
   * That the page renders the middle label, distinctly, for a run whose topology yields exactly it —
   * and, in the same breath, that it does **not** print `independent` for that run. The
   * second half is the one VER-10 actually asks for: *the stronger guarantee is never
   * implied by the weaker one*. Asserted as a pair on one screen rather than across two
   * runs, because two runs of the same page differing in the label is a comparison, and one
   * run showing the weaker label while withholding the stronger is the property.
   *
   * ## This case is load-sensitive, and the regime is measured rather than left to be hit
   *
   * **The fixture has no redundancy slack by construction.** Two nodes at
   * `redundancy = min(2, 1 + peers)` means *every* cube needs *both* of them to come back
   * inside the dispatch budget; one straggler drops a cube to one replica, which drops
   * `Verification cost` below 2.00× and degrades the label to `owner-attested` — correctly,
   * because that is what the fabric actually achieved. The case then reads a true statement
   * about a run it did not want.
   *
   * Six runs on 2026-08-16, same commit, and the discriminator is the process's CPU share:
   *
   * | `(user+sys)/real` | rung times | cost | label |
   * |---|---|---|---|
   * | 0.385 | 8.5 – 12.2 s | 1.50× | `owner-attested` — FAILS |
   * | ~0.4 (15 s probe) | 3.6 – 11.2 s | 1.88× | FAILS |
   * | 0.674 (48 burners) | 1.5 – 2.4 s | 2.00× | `owner-domain` — passes |
   * | idle | 1.8 – 3.1 s | 2.00× | passes |
   *
   * The search itself is deterministic and identical in every one of them — `8 found /
   * 8 out of budget`, `2 / 14`, `3 / 13`, `0 / 16` byte for byte — so only the clock moved.
   *
   * **Two things this is NOT, both ruled out by measurement rather than by argument.** It is
   * not admission: across 416 offers to 7 nodes every one was accepted, `slots 64 /
   * inFlight 0`, and not a single refusal was recorded, so `JobSpec.admit` never excluded
   * anybody. And it is not the offer probe's budget: at `probeTimeoutMs` 15 000, 7.5× the
   * default, it failed the same way.
   *
   * **CPU burners do not reproduce it on this host** and that is worth knowing before
   * someone tries: 24 and 48 spinning shell loops both *raised* the run's share (0.674) and
   * it passed, because macOS deprioritises them against the browser and node processes.
   * What produces the failing regime here is a real competing workload, not a synthetic one.
   */
  it('VER-10 — reads owner-domain for two machines of one owner, and withholds independent', async () => {
    const provider = await startProvider('provider-domain')

    // The owner's second machine: a different node, the **same** owner key and operator id
    // the tab enrols under. Enrolled at the tab's own provider, so the tab can account for
    // its replica — an unaccounted one collapses the whole receipt to the named absence,
    // which is what the two cases below measure.
    const sibling = await startPeer('peer-owner-domain', {
      // The same 32 bytes as {@link TAB_USER_KEY}, as a `Uint8Array` rather than the number
      // array that constant is — it is declared spread because it crosses `page.evaluate`,
      // which structured-clones, and a `FabricNode` takes the typed form. Derived from that
      // constant instead of written out again, so the two identities cannot drift apart and
      // silently make this a two-owner fixture reading `independent`.
      userPrivateKey: new Uint8Array(TAB_USER_KEY),
      operatorId: TAB_OPERATOR,
      providerAddr: provider.addr,
    })

    const page = await openPage('owner-domain')
    const submitterId = await startEnrolled(page, 'o2-attestation-owner-domain', provider)
    const dialedId = await page.evaluate(async (address) => window.o2.dial(address), sibling.addr)
    expect(dialedId).toBe(sibling.node.peerId)

    const report = await runTheLadder(page, 600_000)
    readings.push(readingOf('owner-domain', report))
    process.stderr.write(`[owner-domain] peer ${sibling.node.peerId}\n${report}\n`)

    // The population, said on the page. The demo runs at `redundancy = min(2, 1 + peers)`,
    // so two computing nodes is what puts two replicas on a cube — without this the label
    // could have come from a run that quietly lost the peer, which reads `owner-attested`
    // and would pass a naive "not independent" check.
    expect(await page.textContent('#peers')).toContain('2 node(s) computing')

    // **The label, in the kernel's words rather than transcribed** — the same rule the
    // three cases around this one follow, so the page cannot drift into describing one
    // result differently from the fabric that produced it.
    //
    // The message carries the discriminator, because without it this red is
    // `expected '1 peer(s) · 16 cubes per rung…' to contain 'owner-domain agreement…'`
    // and separating "the label is wrong" from "the host was too slow to place two
    // replicas" costs a full investigation — it cost one on 2026-08-16. `Verification
    // cost` is the number that settles it and the page already prints it.
    const cost = /Verification cost ([0-9.]+)×/.exec(report)?.[1] ?? 'unread'
    const rungs = [...report.matchAll(/^n = .*?(\d+)ms$/gm)].map((m) => m[1]).join(',')
    expect(
      report,
      `expected the owner-domain label; the run settled at verification cost ${cost}× with ` +
        `rung times [${rungs}]ms. **2.00× and a wrong label is a defect in the label.** ` +
        `Anything BELOW 2.00× is a run that failed to place or collect two replicas per ` +
        `cube, which degrades the label correctly — measured 2026-08-16 as a CPU-share ` +
        `effect and not an admission one: 0.385 share failed at 1.50× with rungs 8.5–12.2 s, ` +
        `0.674 share passed at 2.00× with rungs 1.5–2.4 s, and across 416 offers to 7 nodes ` +
        `every single one was accepted with slots 64 / inFlight 0, so nothing was ever ` +
        `refused. Re-run this file under \`/usr/bin/time -p\` and read (user+sys)/real ` +
        `before touching the fixture.`,
    ).toContain(OWNER_DOMAIN)
    expect(report).toContain('2 replicas')
    expect(report).toContain('1 operator')

    // **VER-10's actual sentence.** Two replicas agreed, both certificates check out, and
    // everything `classifyAttestation` needs for `independent` is present EXCEPT a second
    // operator. The page must not round up.
    expect(report).not.toContain(INDEPENDENT)
    // Nor down: `owner-attested` is the one-replica claim and this run placed two.
    expect(report).not.toContain(OWNER_ATTESTED)

    // Both replicas accounted for, named individually. A receipt that could not account for
    // one of them reports the absence instead of any strength, so this is what separates
    // "the label is owner-domain" from "the label is owner-domain because the peer went
    // missing".
    expect(report).not.toContain(`${sibling.node.peerId}: this requestor holds no certificate for it`)
    expect(report).not.toContain(`${submitterId}: this requestor holds no certificate for it`)
    expect(report).not.toContain(THE_OLD_CLAIM)
  }, 900_000)

  /**
   * **Phase 19 criterion 5 — `owner-domain` for a SOVEREIGN shard.**
   *
   * ## What was open, and why the case above did not close it
   *
   * The case above renders the middle label on a run whose shards are `label: 'public'` —
   * `attestation-ui.e2e.test.ts` asserts `registered no sovereign data` on its own first
   * case, which is what that fixture submits throughout. So the label had been shown, and
   * never for the data the label exists to describe. `19-VERIFICATION.md` says exactly
   * that: *"no display site has shown the label for a sovereign shard"*.
   *
   * The other half was proven separately and elsewhere: `browser-capability.e2e.test.ts`
   * has a tab pinned `canExecuteSovereign: true` execute `label: 'sovereign'` work, and it
   * touches no page, no region and no report. **Execution without rendering there,
   * rendering without sovereignty here.** This case is the intersection.
   *
   * ## Why this needs no new option on the page's contract
   *
   * It reads as though it should: a sovereign shard runs only on its owner's nodes, so
   * something has to be pinned to that owner, and `TabApi.start` carries no `sovereignty`
   * — deliberately, by a rule stated in `tab-api.ts:816` and again in
   * `capability-harness.ts:22`.
   *
   * **The thing that must be pinned is the executor, and the tab is the submitter.**
   * `planPlacement` filters candidates to the owner's own nodes and the submitter is
   * excluded from its own executor set anyway, so the tab never needed to be this owner.
   * The two peers are pinned through `FabricNode.start`'s `sovereignty`, which has always
   * existed, and the page learns their owner the ordinary way: `discover-candidates.ts:233`
   * builds each descriptor with `ownerId: executor.certificate.userKey` and
   * `canExecuteSovereign: capabilities.sovereignFor.includes(...)`. Nothing here reaches
   * around the contract; the contract was never the obstacle.
   *
   * ## Three ordering constraints, each of which silently produces a different reading
   *
   * 1. **The peers enrol before `startEnrolled` stops the provider** — the constraint the
   *    case above already names.
   * 2. **The tab must hold a certificate**, or `candidatePool` answers `asked: false` and
   *    every descriptor falls back to `ownerId: 'public'` — the state
   *    `demo-byo.e2e.test.ts` measures, in which a sovereign dispatch is unplaceable.
   * 3. **A warm-up dispatch first.** `main.ts:636-640`: a peer holds the module only once
   *    it has executed, so the first dispatch of a cold fabric qualifies nobody. Without
   *    it this case would read the absence off a run that never placed anything, and would
   *    be a true statement about a run it did not want.
   *
   * ## What this case measured, and why its name changed before it was ever committed
   *
   * It was written to assert `owner-domain` and it does not, because the run says
   * something more useful. **Placement succeeds** — `lookup.asked: true`, one qualified
   * provider, `owners: [<this owner>]` — and the owner's own machine then refuses at its
   * authorizer: `unauthorized: no capability chain supplied`, six times, once per offer.
   *
   * So criterion 5's residue is **not** a placement problem, not a contract problem, and
   * not a rendering problem. Every one of those was ruled out by this fixture. It is
   * AUTH-03's unwired half: no surface in this demo builds a capability chain, so an
   * owner-pinned shard arrives at its owner's machine unaccompanied and is correctly
   * turned away. `main.ts`'s sovereign arm predicted exactly this and said to wire the
   * chain first; this case is the measurement that the warning was right.
   *
   * **The day a chain is wired here, the `failures` assertion below reddens** and this
   * case is re-planned to assert `owner-domain` — which is the same discipline
   * `demo-byo.e2e.test.ts` applies to its own `ownerId: 'public'` guard.
   *
   * ## AMENDED 2026-08-20 — the chain IS wired, and this case did not redden
   *
   * `chainsForOwner` landed and `runJob` now mints a chain per node for an owner-pinned
   * shard. **The sentence above predicted this case would go red. It did not, and the
   * prediction was right about the mechanism and wrong about which fixture would show it.**
   *
   * **Why**: this fixture's two peers are pinned to `OWNER_KEY_HEX`, a key held by the
   * TEST. A tab can only root a chain at a key it can sign for, and its own key is minted
   * `extractable: false` in the browser — so `chainsForOwner` compares, finds this owner is
   * not the tab's, and answers `null` rather than minting a chain that would be refused as
   * `wrong-root`. The dispatch is unchanged and the refusal below is still the true reading
   * of this run.
   *
   * **And that is not a gap in the wiring — it is a property of the key.** A visitor's owner
   * key cannot leave the browser, so **no Node process can ever enrol as that owner**, and
   * the two-Node-peers shape every sovereign fixture in this repository uses is unavailable
   * for a tab's owner. Measured, with its control:
   * `.planning/consults/2026-08-20-a-tab-owner-can-only-have-tab-nodes.md` — two tabs of one
   * profile share the key (`visitor:6976e894…` twice) and two profiles do not
   * (`visitor:27b260b7…`).
   *
   * **So this case keeps its assertions and keeps its subject**, which was always the
   * refusal rather than the label. The case that reads `owner-domain` off a page is a
   * DIFFERENT one, and it is now written: **`owner-domain-tabs.e2e.test.ts`**.
   *
   * Its shape was predicted here as *"two pages in ONE `browser.newContext()`"* and the
   * arithmetic was wrong — it is **three**. `attestedNodes` gives a discovered descriptor
   * only to a peer and `discoveredPool` filters the submitter out by `nodeId !== n.peerId`,
   * so the submitting tab's own descriptor falls back to `ownerId: 'public'` and
   * `eligibleNodes` passes it over however `includeSelf` is set. Two tabs therefore leave
   * one agreeing replica and read `owner-attested`. Corrected in that file, in the consult,
   * and here.
   *
   * The rest of the prediction held: both enrolled through the visitor path, which makes
   * them nodes of one owner because `sovereignFor: [certificate.userKey]` falls out of
   * enrolment, and **nothing there passes `sovereignty` or any key material** — that fixture
   * reads the owner id back off `lastCandidates().owners` because it cannot know it.
   *
   * ## One reading from the mutation, recorded because it was not expected
   *
   * The guard was proved by planting `canExecuteSovereign: false` on both peers, which
   * makes them ineligible and should leave the shard unplaceable. It reddened — correctly,
   * and on the load-bearing line — but the text it reddened against was **`No refusals:
   * every shard reached agreement`**, not a named absence. So with no eligible owner node
   * present, something still ran these owner-pinned shards and reported agreement.
   *
   * **That was written down and NOT diagnosed here.** It was observed in a planted tree,
   * which is not a measurement of the real one, and this case's subject is the refusal
   * above rather than what a fabric with no eligible owner does. Two candidates were
   * offered: either the submitter legitimately runs its own owner-attested map and the
   * owner id simply is not the tab's, or a shard nobody may run found somewhere to run.
   *
   * **DIAGNOSED 2026-08-20, and it is neither of those — it is the sentence.** Nothing ran.
   * `owner-domain-tabs.e2e.test.ts` reproduced the reading on an UNPLANTED tree on its first
   * run, and then again under a deliberate plant, both times printing eight or ten
   * `no agreement` shards directly beside `No refusals: every shard reached agreement`.
   * `TabJobReport.failures` is filled from `VerificationResult`'s `disagreed` and
   * `insufficient` arms; a shard that was never PLACED reaches neither, so the list is
   * legitimately empty and the renderer reads empty as universal success. The attestation
   * line in the same render gets it right — *"this shard is unplaceable rather than agreed,
   * so there is no agreement to attest"* — so the fabric knows and only this sentence does
   * not. Filed as its own defect; it is a rendering fault, not a placement one.
   */
  it('criterion 5 — places a sovereign shard on its owner’s machine, and is refused for want of a chain', async () => {
    const provider = await startProvider('provider-sovereign-domain')

    // Two machines of ONE owner, each cleared to execute that owner's sovereign work.
    // `ownerId` is the hex user key and not a label — see OWNER_KEY_HEX for why.
    const owned: NodeSovereignty = {
      ownerId: OWNER_KEY_HEX,
      ownerKey: OWNER_KEY_HEX,
      canExecuteSovereign: true,
    }
    const enrolment = {
      userPrivateKey: OWNER_PRIVATE_KEY,
      operatorId: OWNER_OPERATOR,
      providerAddr: provider.addr,
    }
    const first = await startPeer('peer-owned-first', enrolment, owned)
    const second = await startPeer('peer-owned-second', enrolment, owned)

    const page = await openPage('sovereign-domain')
    const submitterId = await startEnrolled(page, 'o2-attestation-sovereign-domain', provider)
    for (const peer of [first, second]) {
      const dialedId = await page.evaluate(async (address) => window.o2.dial(address), peer.addr)
      expect(dialedId).toBe(peer.node.peerId)
    }

    await showByo(page)

    // Constraint 3. Public, so it places on anybody and leaves the module advertised.
    await dispatchByo(page, 600_000)

    // The run this case is about.
    await page.check('#byo-sovereign')
    await page.fill('#byo-owner-id', OWNER_KEY_HEX)
    await dispatchByo(page, 600_000)

    const attestation = await byoRegion(page, 'byo/attestation')
    const label = await byoRegion(page, 'byo/sovereign-label')
    const egress = await byoRegion(page, 'byo/egress')
    const replicas = await byoRegion(page, 'byo/replicas')
    const failures = await byoRegion(page, 'byo/failures')
    // The instrument that separates "the lookup declined" from "it asked and nobody
    // qualified" — `demo-byo.e2e.test.ts` reads the same field for the same reason.
    const lookup = await page.evaluate(() => window.o2.lastCandidates())
    process.stderr.write(
      `[sovereign·owner-domain] submitter ${submitterId}\n` +
        `  peers ${first.node.peerId} ${second.node.peerId}\n` +
        `  lookup ${JSON.stringify(lookup)}\n` +
        `  attestation: ${attestation}\n  label: ${label}\n  replicas: ${replicas}\n` +
        `  failures: ${failures}\n  egress: ${egress}\n`,
    )

    // **Fact one: the shards really were sovereign, and pinned to this owner.** Asserted
    // first, so a run that quietly fell back to public cannot pass by rendering correct
    // words about the wrong data — the failure mode EGR-01 closed once already here.
    expect(label).toContain('sovereign')
    expect(label).toContain(OWNER_KEY_HEX)
    expect(
      egress,
      'the page said this run registered no sovereign data, on the dispatch this case exists to make sovereign — the two facts are conflated again',
    ).not.toContain('registered no sovereign data')

    // **Fact two, and the reason this case exists: PLACEMENT SUCCEEDED.** The lookup ran,
    // one peer advertised the block, and the owner it declares is this shard's owner. This
    // is the half `demo-byo.e2e.test.ts` cannot reach — there the lookup answers
    // `asked: false`, every descriptor falls back to `ownerId: 'public'`, and the shard is
    // unplaceable. Here it is placeable, and the difference is a tab that holds a
    // certificate. Asserted so that a future regression in qualification cannot hide
    // behind the same red as the refusal below.
    expect(lookup?.asked, 'the tab holds a certificate, so the lookup must run').toBe(true)
    expect(lookup?.owners).toContain(OWNER_KEY_HEX)
    expect(lookup?.qualified.length, 'the warm-up dispatch must leave the module advertised').toBeGreaterThan(0)

    // **Fact three: it is refused at the executor's authorizer, by name.** `main.ts`'s
    // sovereign arm says *"Wire a chain here BEFORE that day, not after it"* — this case
    // IS that day, arrived at deliberately, and what it measures is that the day has not
    // been prepared for. The demo builds every `RemoteExecutor` as
    // `'dispatches-unauthenticated'`, so no chain accompanies an owner-pinned shard and
    // the owner's own machine refuses it at `authorizeCapability`'s first step.
    //
    // **This is the correct refusal and must not be "fixed" by relaxing the authorizer.**
    // The tab here is a different user from the owner, so it could not root a chain at
    // this owner's key even if the surface built one. A chain forged by the submitter is
    // precisely the hole the sequencing rule exists to prevent.
    expect(
      failures,
      'the sovereign dispatch was no longer refused for want of a capability chain. If AUTH-03 wired one on this surface, this case should now assert owner-domain instead — see the docblock.',
    ).toContain('no capability chain supplied')

    // **And therefore the label is the named absence, not a strength.** Criterion 5 asks
    // for `owner-domain` on a sovereign shard; nothing agreed, so the page reports that
    // rather than rounding a refusal up into a weak agreement.
    expect(replicas).toContain('no agreement')
    expect(attestation).not.toContain(OWNER_DOMAIN)
    expect(attestation).not.toContain(INDEPENDENT)
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
   * The comparison the cases above exist to support, and the one defect #34 turns on.
   *
   * Each case above asks whether one screen said the right thing. This asks the question
   * a visitor's trust actually rests on: **does a strength appear exactly where nothing
   * went unaccounted?** It reads no absolute — no count, no threshold, no wall clock —
   * only the screens against each other, all produced by the same page, the same built
   * bundle and the same ladder, differing in one variable each.
   *
   * It can fail, which is the point. A page printing a strength beside an unaccounted
   * replica breaks it — plants P3 and P5 both did — and so does a page reporting the
   * absence for a run in which everything checked out, which is exactly what the demo did
   * before this plan, when a self-included job dispatched through the unsigned executor
   * and the tab could not account for its own replica.
   *
   * ## Four screens since 2026-08-14, and the fourth is what makes the loop mean something
   *
   * This read *"three screens"* and expected `['solo']` as the one strength-claiming run.
   * With three, **"claimed a strength" and "was the solo run" were coextensive** — so the
   * loop below could not distinguish *strength iff nothing unaccounted* from *strength iff
   * solo*, and a page implementing the second would have passed. The `owner-domain` run
   * separates them: it is not solo, it has a peer, and it claims a strength because both
   * replicas were accounted for. The relation being tested is now the only one that fits.
   *
   * That is a strengthening and not a widening: the loop's rule is unchanged, and what
   * moved is the population it holds over.
   */
  it('claims a strength in exactly the runs where no replica went unaccounted', () => {
    // All four ran, in order. Without this, a suite that skipped cases would satisfy every
    // comparison below trivially.
    expect(readings.map((reading) => reading.label)).toEqual([
      'solo',
      'owner-domain',
      'unenrolled peer',
      'stranger’s provider',
    ])

    for (const reading of readings) {
      expect({ label: reading.label, strength: reading.strength }).toEqual({
        label: reading.label,
        strength: !reading.unaccounted,
      })
    }

    // And the split is the one the topologies predict rather than any split at all: the two
    // runs whose every replica carried a checkable certificate claimed a strength, and both
    // runs holding a peer nobody this tab pins did not. A page with the relation inverted
    // would satisfy the loop above.
    expect(readings.filter((reading) => reading.strength).map((reading) => reading.label)).toEqual([
      'solo',
      'owner-domain',
    ])
  })
})

/**
 * SCHED-01 — the requestor half, on the page a visitor opens and with no flag in front of it.
 *
 * ## Why this reading is here and not on a benchmark
 *
 * `discoverCandidates` had exactly one production call site in this repository until
 * 2026-08-18 — `bin/bench.ts:1541`, inside `if (DISCOVER)` — so no path a person can run
 * without typing `--discover` ever asked *who has this block*. The owner ruling of
 * 2026-08-15 (`.planning/consults/2026-08-15-owner-ruling-off-by-default-flag.md`) answered
 * *"It must work with no flag"* and named the demo page's Run button as the method rather
 * than the escape. `demo/main.ts`'s `discoveredPool` is that default path; this is
 * the reading of it.
 *
 * ## Why this file rather than a new one
 *
 * The lookup needs an **enrolled** tab — with no certificate a tab has pinned no issuer,
 * and checking a peer's records against an empty issuer set is accepting a peer's word for
 * a peer's identity. Three specs in this repository enrol a tab at all, and this is the
 * cheapest of them: one tab, `FabricNode` peers, and a `vite build` already paid for by the
 * four cases above. `quorum-ui.e2e.test.ts` is the only fixture that enrols **two tabs**,
 * and it costs twice as much for a property that does not need a second browser.
 *
 * Its own `describe`, and it deliberately does **not** push to {@link readings}: the
 * cross-case comparison above asserts the exact ordered list of four labels, and a fifth
 * entry there would redden a case about something else.
 *
 * ## What makes it a reading of the mechanism rather than of a return value
 *
 * The peer is seeded with the demo kernel **before** anything runs, so `providers` has a
 * true answer to give — the same thing `bin/bench.ts`'s `--discover` arm does for its
 * workers, and for the same reason: a node holds a module only once it has fetched one, so
 * a cold fabric qualifies nobody and would make an empty answer indistinguishable from a
 * broken lookup.
 *
 * The sharpest assertion is on `owners`. A placeholder descriptor declares the literal
 * `public` for everybody — `attestedNodes`' fallback still does, for peers this lookup does
 * not qualify — and there is no way for the page to invent a peer's certified user key. So
 * an `owners` entry equal to the key the peer really enrolled under can only have come from
 * that peer's own signed records, fetched over the wire and verified offline against an
 * issuer this tab pinned before it spoke to anybody.
 */
describe('SCHED-01 — the page discovers its candidates by asking who holds the block', () => {
  it('qualifies a peer that advertises the module and hands over records that verify', async () => {
    const provider = await startProvider('provider-discovery')

    // Enrolled at the tab's own provider under the tab's own user key, exactly as the
    // owner-domain case above — so the certificate this lookup verifies is one the tab can
    // check offline, and the user key it reports is one this file already holds.
    const peer = await startPeer('peer-discovery', {
      userPrivateKey: new Uint8Array(TAB_USER_KEY),
      operatorId: TAB_OPERATOR,
      providerAddr: provider.addr,
    })

    // **The one line that makes `providers` a question with an answer.** Without it this
    // peer holds no block until it has executed a cube, so the first rung's lookup would
    // qualify nobody and the case would be measuring a race rather than an intersection.
    // `bin/bench.ts:1539` seeds its workers for the identical reason and says so.
    await peer.node.store.put(kernelBytes)

    const page = await openPage('discovery')
    const submitterId = await startEnrolled(page, 'o2-attestation-discovery', provider)
    const dialedId = await page.evaluate(async (address) => window.o2.dial(address), peer.addr)
    expect(dialedId).toBe(peer.node.peerId)

    const report = await runTheLadder(page, 600_000)
    process.stderr.write(`[discovery] peer ${peer.node.peerId}\n${report}\n`)

    // Read AFTER the ladder, so it is the lookup a real dispatch was placed over rather
    // than one this case asked for. There is no method that runs a lookup on demand,
    // deliberately — see `TabApi.lastCandidates`.
    const lookup = await page.evaluate(() => window.o2.lastCandidates())
    process.stderr.write(`[discovery] lastCandidates = ${JSON.stringify(lookup)}\n`)

    expect(
      lookup,
      'the page ran no candidate lookup at all, so every reading below would be about a mechanism that did not run',
    ).not.toBeNull()
    const found = lookup as NonNullable<typeof lookup>

    // It ran, and it ran to completion. `declined` carries the two named absences — no
    // pinned issuer, and no answer inside the deadline — and either would make an empty
    // `qualified` mean something other than "nobody qualified".
    expect(found.asked).toBe(true)
    expect(found.declined).toBeNull()
    expect(found.inputCid).toBe(KERNEL_RECORD.cid.toString())

    // The `providers` half: somebody answered that they hold this block.
    expect(
      found.providers,
      'no peer answered the providers request for the module CID, so the intersection had nothing to intersect',
    ).toBeGreaterThanOrEqual(1)

    // The intersection's output, by peer id — the id the transport knows, which is what
    // makes a descriptor usable at all (`discover-candidates.ts` names the alternative
    // `missing-node-descriptor`).
    expect(found.qualified).toContain(peer.node.peerId)
    expect(found.excluded).toEqual([])
    expect(found.undialable).toEqual([])

    // **This tab is not in its own answer, and that is the anti-vacuity check.** The lookup
    // asks `verifiedPeers`; a page that had quietly answered from its own record index
    // would list itself here, and every assertion above would pass on a reading that never
    // crossed the wire.
    expect(found.qualified).not.toContain(submitterId)

    // **The capability-records half, and the sharpest line in this case.** `public` is what
    // the placeholder declares for everybody; a certified user key is what only a peer's own
    // signed records can supply.
    const peerUserKey = peer.node.certificate?.userKey
    expect(peerUserKey, 'the peer enrolled without a certificate, so the fixture is not the one described').toBeDefined()
    expect(found.owners).not.toContain('public')
    expect(found.owners[found.qualified.indexOf(peer.node.peerId)]).toBe(peerUserKey)

    // The descriptors this produced were handed to a real placement rather than collected.
    // `#peers` is the page's own population count and `#run-report` is what the ladder
    // settled to, so a lookup that ran beside a job which never placed anything cannot read
    // as one the job used. Both are read off the screen, as the four cases above are.
    expect(await page.textContent('#peers')).toContain('2 node(s) computing')
    // A rung line, which the page writes only for a rung it actually dispatched. Chosen over
    // the strength label deliberately: the owner-domain case one screen up carries a long
    // note about how a label assertion reads under CPU pressure, and this case is about
    // where the candidates came from rather than about how well they agreed.
    expect(report, 'the ladder produced no rung line, so nothing was dispatched').toMatch(/^n = /m)
  }, 900_000)
})

/**
 * NET-06 — a tab's executor set comes from a routing query, not only from its caller's list.
 *
 * ## What this measures that the SCHED-01 case above does not
 *
 * That case reads the *lookup*: the page asks who holds the block, somebody answers, and
 * the answer is verified against a pinned issuer. It says nothing about who the job ran on,
 * and until 2026-08-18 the honest answer was *"the peers the caller named, and only those"*
 * — `demo/main.ts` built every `RemoteExecutor` from `options.peerIds`, a caller-supplied
 * array on the {@link TabApi} contract, and threw away the executors `discoverCandidates`
 * had already built for the candidates it qualified. `bin/bench.ts --discover` selected
 * executors from an index answer and no browser-tier path did, which is exactly the
 * *browser is a lesser peer* asymmetry NET-06 forbids.
 *
 * ## `peerIds: []` is the whole case
 *
 * The tab is connected to the peer — `window.o2.dial` returned its id — and then submits a
 * job naming **nobody**. Every executor in that job's pool other than the tab's own can
 * therefore only have come from the index answer. `agreeing` carries one node id per
 * replica that agreed on a cube, so a peer id in it is a peer that was dispatched to, ran
 * the guest and returned a result the requestor matched — not a peer that appeared in a
 * descriptor.
 *
 * The anti-vacuity half is `complete`: a job that ran entirely on the submitter's own worker
 * reports `complete: true` just as happily (`built-bundle.e2e.test.ts` runs exactly that
 * shape with `peerIds: []` and gets it), which is why the foreign id — and not completion —
 * is the reading.
 *
 * ## Why the peer is seeded before anything runs
 *
 * A node holds a module only once it has fetched one, so on a cold fabric `providers`
 * truthfully answers nobody and this case would be measuring a race. `bin/bench.ts:1539`
 * seeds its workers for the identical reason, and the SCHED-01 case above says so too.
 *
 * ## What this case CANNOT redden on
 *
 * It does not read the DHT. `BrowserNode.recordIndex` — the composed `DhtRecordIndex` that
 * would reach past the peers this tab is connected to — has no reader on **either** tier,
 * and `discoverCandidates` builds a bare `RpcRecordIndex` internally. So the reach measured
 * here is directly-connected peers, which is `RpcRecordIndex`'s stated limit and is the same
 * reach a backbone node has today. That is a fabric-wide gap and a symmetric one; it is not
 * a browser being a lesser peer, which is the claim this id carries.
 */
describe('NET-06 — the tab dispatches to a peer its index query found and its caller never named', () => {
  it('runs a cube on a peer absent from peerIds, because the lookup qualified it', async () => {
    const provider = await startProvider('provider-net06')

    // Enrolled at the same provider the tab pins, so its records verify offline here for the
    // reason the SCHED-01 case gives: an answer checked against an issuer this tab was handed
    // by the peer being checked is a peer vouching for itself.
    const peer = await startPeer('peer-net06', {
      userPrivateKey: new Uint8Array(TAB_USER_KEY),
      operatorId: TAB_OPERATOR,
      providerAddr: provider.addr,
    })

    // The line that gives `providers` a true answer. See this describe's header.
    await peer.node.store.put(kernelBytes)

    const page = await openPage('net06')
    const submitterId = await startEnrolled(page, 'o2-attestation-net06', provider)
    const dialedId = await page.evaluate(async (address) => window.o2.dial(address), peer.addr)
    expect(dialedId).toBe(peer.node.peerId)

    // **`peerIds: []`.** Not the page's own peer list, not a filtered one — nothing. Two
    // cubes because one would leave the per-cube list unable to disagree with itself, and
    // `redundancy: 2` so every cube is offered to both members of whatever pool gets built.
    const run = await page.evaluate(async () =>
      window.o2.runColouring({ n: 24, cubes: 2, redundancy: 2, peerIds: [] }),
    )
    process.stderr.write(
      `[net06] peer=${peer.node.peerId} submitter=${submitterId} agreeing=${JSON.stringify(run.agreeing)}\n` +
        `[net06] complete=${String(run.complete)} statuses=${JSON.stringify(run.statuses)} ` +
        `multiplier=${String(run.verificationMultiplier)}\n` +
        `[net06] attestation=${JSON.stringify(run.attestation)}\n[net06] quorum=${JSON.stringify(run.quorum)}\n`,
    )

    // The lookup ran and named this peer — so the id asserted below has a stated origin
    // rather than being a peer that got in some other way.
    const lookup = await page.evaluate(() => window.o2.lastCandidates())
    process.stderr.write(`[net06] lastCandidates = ${JSON.stringify(lookup)}\n`)
    expect(lookup, 'the page ran no candidate lookup, so nothing here is about an index').not.toBeNull()
    const found = lookup as NonNullable<typeof lookup>
    expect(found.asked).toBe(true)
    expect(found.declined).toBeNull()
    expect(found.qualified).toContain(peer.node.peerId)
    // Its own answer is not a routing answer — the same anti-vacuity line the SCHED-01 case
    // makes, and it is what stops a page that quietly answered from its own record index
    // from satisfying everything below.
    expect(found.qualified).not.toContain(submitterId)

    // **The reading.** A caller that named nobody got a pool with somebody in it, and that
    // somebody executed. Asserted per cube rather than "a foreign id somewhere", so a run
    // in which one cube was distributed and the other silently ran alone cannot pass.
    expect(run.agreeing.length).toBe(2)
    for (const agreeing of run.agreeing) {
      expect(
        agreeing,
        'a cube agreed without the discovered peer in it — the executor pool came from peerIds after all',
      ).toContain(peer.node.peerId)
    }
    // Anti-vacuity, and it is placed after the reading deliberately: every line here goes
    // red on a job that ran alone, and if one of them spoke first the proof for this case
    // would read as a redundancy reading rather than as the distribution reading it is.
    //
    // **`run.complete` is NOT the anti-vacuity check, and the reason is measured rather
    // than assumed.** It was, until the first run of this case reported `complete: false`
    // beside `statuses: ["found","found"]`, `verificationMultiplier: 2` and an `agreeing`
    // list carrying both nodes — a job that plainly ran on two machines. `submitJob` sets
    // `complete` only where no shard is `degraded` (`submit.ts:3356`), and this fixture
    // degrades every shard by construction: the tab and the peer enrol under one operator,
    // so `quorum` comes back `not-composed` with *"quorum of 2 needs 2 distinct operators,
    // found 1"* and `onQuorumShortfall: 'runs-at-available-redundancy'` — the demo page's
    // permanent choice — runs it anyway. Asserting `complete` here would have held this
    // case hostage to a second operator, which is a different requirement (VER-03/VER-04)
    // and one this fixture deliberately does not meet.
    expect(run.statuses).toEqual(['found', 'found'])
    // Each cube ran twice, on two nodes: a job that ran alone reports 1.
    expect(run.verificationMultiplier).toBeCloseTo(2, 6)
    // And the receipt counted two replicas of one owner. The first case in this file reads
    // `owner-attested` with one replica off a tab that ran every cube by itself, so this is
    // the same instrument reading the other state.
    expect(run.attestation).toMatchObject({ strength: 'owner-domain', replicas: 2 })
  }, 900_000)
})
