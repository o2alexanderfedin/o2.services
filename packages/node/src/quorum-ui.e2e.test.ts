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
import { KERNEL_TRUST_ANCHOR } from '@o2/demo'
import { FabricNode } from './fabric-node.ts'

/**
 * VER-03 and VER-04 on the surface a visitor actually looks at — the quorum composer's own
 * verdict, read off a real page driven by two real browser tabs.
 *
 * ## Why this file exists, when `quorum-agents.node.test.ts` already reads rule 2
 *
 * That file reads `composeQuorum`'s refusal **through `submitJob`'s return value**, across
 * spawned `bin/agent.ts` processes. It is a thorough reading and it is not this one. VER-03's
 * clause is about the property being *established*, and Phase 19's own ruling on VER-09/VER-10
 * is that a claim about a result has to hold **wherever the result is displayed**. Until
 * 2026-08-14 the demo page displayed no quorum verdict at all: `submitJob` computed one on
 * every run this page has ever made, recorded it on every shard, and the page threw it away.
 *
 * ## The trap this file is built to avoid, stated before the fixture
 *
 * The fabric surface of the same page renders `· shared relay: <peer id>`. It looks exactly
 * like VER-03's evidence. **It is not.** That line comes from `AttestationReceipt.sharedRelay`,
 * which `attestationReceipt` computes from the certificates of whoever *answered and signed* —
 * so it prints identically on a fabric where `composeQuorum` was never called. A reading that
 * would be identical if the mechanism never ran is not evidence of the mechanism, and closing
 * VER-03 on that line would have closed it on nothing.
 *
 * So both cases below assert on `describeQuorum`'s output, which exists only because the
 * composer ran, and which names the refusal **kind** — a fixed string, not a sentence to
 * pattern-match.
 *
 * ## Two tabs on one relay, and why nothing cheaper works
 *
 * The first draft of this file used a tab plus a Node peer started `listen: ['/p2p-circuit']`,
 * on the reasoning that a node binding nothing enrols `via-relay` and names its relay. That
 * reasoning is correct about the certificate and **wrong about the fabric**, and the page says
 * so in its own source: `index.html`'s Defect 32 note records that a peer reachable *only*
 * through the relay holds nothing but a limited circuit — 2 min / 128 KiB — which cannot carry
 * a job, so such a peer is reported in `relayedOnly` and excluded from `computePeers`. It never
 * becomes a candidate, `redundancyFor` stays at 1, and the quorum gate returns `not-attempted`.
 * Measured, not reasoned: that fixture never reached `2 node(s) computing`.
 *
 * The constraint underneath is real and worth stating, because it rules out every cheaper
 * shape: **a node that is directly dialable enrols `seed`, and a seed depends on no relay to be
 * found.** So a member set that both shares a relay dependency *and* can carry a job cannot
 * contain a Node peer with a bound address at all — unless that peer *is* the relay, which is
 * the case this file now reads and the sentence below records.
 *
 * Two browser tabs are the one topology that satisfies both halves, and they satisfy it by
 * construction rather than by contrivance:
 *
 * - Neither tab can accept a connection, so both reserve on the relay and both enrol
 *   `via-relay` naming it — `browser-node.ts:511` derives `canRelay` from the only listen set a
 *   browser has, `['/p2p-circuit', '/webrtc']`, and both entries are relay-mediated.
 * - The relay carries only the SDP exchange; once ICE completes the job runs over a **direct**
 *   WebRTC connection, which is unlimited and does carry work. `two-tabs.e2e.test.ts` is the
 *   file that establishes that property; this one depends on it and asserts it again locally.
 *
 * **This is the browser tier's real topology, not an engineered one.** Every peer a tab can
 * reach today was found through the relay it reserved on, so a quorum drawn from them shares a
 * single point of failure. The page now says so instead of reporting a redundancy it does not
 * have.
 *
 * ## The two arms, and why one arm would not have been enough
 *
 * A single case reading a verdict cannot tell *the composer decided this* from *this region
 * renders a constant*. So the file stands up two fabrics differing in exactly **one** property
 * — `operatorId` — and reads two different verdicts off the same region:
 *
 * | | operators | verdict |
 * |---|---|---|
 * | distinct-operators | three distinct | `not composed [shared-relay-dependency] … relay <id> is itself a member` |
 * | one-operator | one | `not composed [insufficient-operators] … 2 distinct operators, found 1` |
 *
 * A page hardcoding either string fails the other case, and the third case asserts the two
 * differ at all. Both arms also assert against `not attempted`, which is the arm that means the
 * gate never ran — and is what two earlier drafts of this file actually read.
 *
 * **Both arms are now refusals, and the discrimination is stronger for it rather than weaker.**
 * It used to be composed-vs-refused, which a region could satisfy by rendering the presence or
 * absence of one word. It is now refusal **kind** against refusal **kind** — two strings the
 * page never composes, both coming from `describeQuorum`, each naming a different rule of
 * `composeQuorum`. A region that rendered either constant fails the other arm exactly as
 * before, and a region that rendered "some refusal" now fails both.
 *
 * ## VER-03 on this page — read here since 2026-08-14, and the retraction that got it here
 *
 * This section said the opposite until then: *"It does not close VER-03.
 * `shared-relay-dependency` is not reachable from this page … the relay computes, it binds a
 * socket so it enrols `seed`, `composeQuorum` orders seeds first so it is always a member, and
 * `sharedRelay` answers `null` the moment a member is a seed. That is the rule being right, not
 * silent."*
 *
 * **Every clause of that is true except the last, and the last was the finding.** The rule was
 * silent, for a reason nothing in the reasoning could reach: `relayIds` names relays by **peer
 * id** and a quorum member is identified by **`nodeKey`**, so when the relay every other member
 * depends on was itself a member, no comparison in `quorum.ts` could see it. A seed's own
 * reachability really does not depend on a relay — but *being* the relay is not a dependency on
 * one, it is being the thing everyone else depends on, and losing it loses them anyway. This
 * fabric is the sharpest instance of VER-03 there is, and the composer read it as independent.
 *
 * `composeQuorum` now takes an optional `peerIdOf`, `submitJob` supplies it from the
 * descriptors it already holds, and this page's own topology — two tabs that can only be found
 * through the relay, plus the relay — is refused and says why. No fixture was engineered to get
 * here: the pool is still `computePeers()`, everything that answers, exactly as before.
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
 * The owners the two tabs enrol on behalf of — the **private** halves, and they have to be.
 * `EnrollmentAuthority.enrol` refuses by name as `bad-owner-proof` without a signature over
 * its own challenge, and only the private key can produce one.
 *
 * Seeds 72 and 73. `attestation-ui.e2e.test.ts` records the census that made 68 and 69 the free
 * pair there; these are the next two neither that file nor this one's neighbours use. Two
 * distinct users so that the two arms differ in `operatorId` **alone** — the one-operator arm
 * gives both tabs the same key *and* the same operator, and the two-operator arm changes both,
 * because an operator id is a claim about who runs a node and sharing an owner key across two
 * operators would be a fixture no enrolment would ever produce.
 */
const OWNER_A = [...new Uint8Array(32).fill(72)]
const OWNER_B = [...new Uint8Array(32).fill(73)]
const OWNER_RELAY = [...new Uint8Array(32).fill(74)]

const OPERATOR_A = 'quay-street-collective'
const OPERATOR_B = 'north-mill-compute'
const OPERATOR_RELAY = 'dockside-relay-co'

/** What `describeQuorum` emits. Fixed strings, so a reworded sentence cannot pass either arm. */
const SHARED_RELAY = '[shared-relay-dependency]'
const INSUFFICIENT_OPERATORS = '[insufficient-operators]'
const COMPOSED = 'composed across'
/** The arm that means the gate did not run at all — never an acceptable reading here. */
const NOT_ATTEMPTED = 'not attempted'

let server: Server
let baseUrl: string
let browser: Browser
let workdir: string
const contexts: BrowserContext[] = []
const started: FabricNode[] = []

beforeAll(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'o2-quorum-ui-'))

  // Built here rather than assuming a current `dist/` — the reading must fail when the
  // *sources* break the bundle, not when somebody forgot to rebuild. This file reads the
  // deployed artifact for the same reason `attestation-ui.e2e.test.ts` does: the claim is
  // about what a visitor sees, and a visitor gets the build.
  execFileSync('npx', ['vite', 'build', '--config', 'packages/browser/vite.config.ts'], {
    cwd: ROOT,
    stdio: 'pipe',
  })

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
      // Exactly what a static host does for /bootstrap.json.
      () => response.writeHead(404).end('not found'),
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

/**
 * The provider that certifies every member of the fabric. Stopped before each run.
 *
 * Separate from the relay, and that separation is forced rather than stylistic — see
 * `startEnrolledRelay`. Stopped inside each case for `attestation-ui.e2e.test.ts`'s reason: a
 * provider left running is a fourth connected peer that answers offers, and therefore a fourth
 * candidate holding no certificate of its own.
 */
async function startProvider(name: string): Promise<{ node: FabricNode; addr: string }> {
  const node = await FabricNode.start({
    relayAdmission: 'admits-any-peer',
    startReporting: 'reports-its-own-start',
    blockstoreDir: join(workdir, name),
    listen: ['/ip4/127.0.0.1/tcp/0/ws'],
    trustAnchors: [KERNEL_TRUST_ANCHOR],
    // What gives it a signing key at all, so the issuer a certificate names is a real value
    // rather than one invented here.
    issuesCertificates: 'issues-without-an-aggregate-budget',
  })
  started.push(node)
  const addr = node.browserDialableAddrs[0]
  if (addr === undefined) throw new Error(`${name} produced no browser-dialable address`)
  return { node, addr }
}

/**
 * The relay both tabs reserve on — **enrolled**, because in this fabric a relay computes.
 *
 * ## The correction this function records, which is the file's most reusable finding
 *
 * The draft before this one made one node both relay and provider and did not enrol it. That
 * run reached the page and read `3 node(s) computing — this tab and 2 peer(s)` and a verdict of
 * `not attempted — this requestor holds no certificate for at least one candidate`. Both
 * readings have the same cause and it is **not** a fixture slip: `fabric-node.ts`'s header
 * records that the non-executing `RelayNode` class was **deleted** on purpose — *"all nodes
 * have equal functionality, and the only difference is discovery"* — after a demo showed "2
 * compute peers of 3 connections", the third being a relay *"present, connected, perfectly able
 * to compute, and structurally excluded from doing so."*
 *
 * So the relay answers the offer probe, `computePeers` counts it, `attestedNodes` builds a
 * descriptor for it, and the quorum gate's third condition — *every candidate carries a
 * certificate* — fails on it. The composer never ran. Enrolling it is what lets it run.
 *
 * ## And this is why VER-03's refusal IS read on this page — corrected 2026-08-14
 *
 * This section argued the opposite, and the argument is kept because its first half is exactly
 * right and its conclusion was exactly wrong. It said: the relay binds a listening socket, so
 * `canRelay` is true, so it enrols `discoverability: 'seed'` with `relayIds: []`;
 * `composeQuorum` orders candidates by *fewest discovery dependencies first*, so a seed always
 * sorts ahead of both tabs and is always in the member set; and `sharedRelay` returned `null`
 * the moment one member was a seed. Every step of that is a true statement about the code.
 *
 * The conclusion drawn from it was *"that is correct behaviour, not a gap in the rule: a quorum
 * containing the relay genuinely does not lose everything if the relay's discovery role
 * fails."* **It does.** Both tabs are `via-relay` naming this node, so losing it loses both of
 * them, and the third member IS it — so the quorum loses everything, which is the entire
 * content of VER-03's sentence. What made the rule blind was not the seed reading but a
 * namespace mismatch beneath it: `relayIds` holds **peer ids**, a member is identified by
 * **`nodeKey`**, and the two never compare equal. `quorum.ts`'s header carries the correction
 * in full.
 *
 * So the demo page's candidate pool — `main.ts` builds it from `computePeers()`, everything
 * that answers, rather than from who advertises the input block — contains the relay, and the
 * rule now sees it. Nothing about this fixture changed to reach that verdict, which is what
 * makes it a reading rather than a contrivance: engineering the pool to exclude the relay would
 * have been shaping a fixture to reach a verdict, and a rule shaped to produce a reading is not
 * a rule.
 *
 * `quorum-agents.node.test.ts` reads the *other* shape of the same refusal — a relay that is
 * not in the pool at all, because `discoverCandidates` qualifies on providers of the input CID
 * and its relay holds no block. Two shapes, one kind, and the two files are not substitutes.
 */
async function startEnrolledRelay(
  name: string,
  providerAddr: string,
  operatorId: string,
  owner: Uint8Array,
): Promise<{ node: FabricNode; addr: string }> {
  const node = await FabricNode.start({
    relayAdmission: 'admits-any-peer',
    startReporting: 'reports-its-own-start',
    blockstoreDir: join(workdir, name),
    // Comfortably above the two tabs, so a refusal could never be mistaken for the property
    // under test.
    maxReservations: 16,
    listen: ['/ip4/127.0.0.1/tcp/0/ws'],
    trustAnchors: [KERNEL_TRUST_ANCHOR],
    enrollment: { userPrivateKey: owner, operatorId, providerAddr },
  })
  started.push(node)
  const addr = node.browserDialableAddrs[0]
  if (addr === undefined) throw new Error(`${name} produced no browser-dialable address`)
  return { node, addr }
}

/**
 * A consented tab, started **on the relay** and enrolled at the provider.
 *
 * `relayAddrs: [relayAddr]` is the whole fixture. A tab that dials no relay enrols with
 * `relayIds: []`, and `sharedRelay` returns `null` for any member whose dependency set is
 * empty — so `attestation-ui.e2e.test.ts`'s `startEnrolled`, which passes `[]`, could not
 * produce this reading however its operators were arranged.
 */
async function openEnrolledTab(
  name: string,
  store: string,
  relayAddr: string,
  providerAddr: string,
  owner: number[],
  operatorId: string,
): Promise<{ page: Page; peerId: string }> {
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
  // BROW-01 has no test-only bypass: a harness consents through the gate a visitor uses.
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

  const peerId = await page.evaluate(
    async (options) =>
      window.o2.start({
        relayAddrs: [options.relayAddr],
        blockstoreName: options.store,
        enrollment: {
          userPrivateKey: options.owner,
          operatorId: options.operatorId,
          providerAddr: options.providerAddr,
        },
      }),
    { store, relayAddr, providerAddr, owner, operatorId },
  )
  return { page, peerId }
}

/**
 * Stand up both tabs on one relay and join them over a direct WebRTC connection.
 *
 * Returns the tab that will *submit*. The dial direction is A → B, so A is the requestor and
 * the quorum is composed in A's process over A's and B's certificates.
 */
async function twoTabsOnOneRelay(
  label: string,
  operatorOfB: string,
  ownerOfB: number[],
  operatorOfRelay: string,
): Promise<{ page: Page; relayPeerId: string }> {
  const provider = await startProvider(`provider-${label}`)
  const relay = await startEnrolledRelay(
    `relay-${label}`,
    provider.addr,
    operatorOfRelay,
    new Uint8Array(OWNER_RELAY),
  )
  // Enrolled, and asserted before anything depends on it. A relay that came up without a
  // certificate collapses the whole job to `not-attempted` naming a candidate the reader would
  // then have to identify — which is exactly how this file's previous draft failed.
  expect(relay.node.certificate?.operatorId).toBe(operatorOfRelay)
  expect(relay.node.certificate?.discoverability).toBe('seed')

  const a = await openEnrolledTab(
    `${label}-a`, `o2-quorum-${label}-a`, relay.addr, provider.addr, OWNER_A, OPERATOR_A,
  )
  const b = await openEnrolledTab(
    `${label}-b`, `o2-quorum-${label}-b`, relay.addr, provider.addr, ownerOfB, operatorOfB,
  )
  expect(a.peerId).not.toBe(b.peerId)

  // The provider is a connected peer of every node that enrolled through it, and it answers
  // offers like any other node in this fabric — so leaving it up would put a fourth candidate
  // in the pool. `attestation-ui.e2e.test.ts` stops its provider for the same reason.
  await provider.node.stop()

  // Tab A dials tab B at its own `/webrtc` address. The relay signals; the resulting path is
  // direct. `two-tabs.e2e.test.ts` is where that property is established.
  const bAddrs = await b.page.evaluate(async () => window.o2.waitForWebrtcAddr(60_000))
  const target = bAddrs[0]
  if (target === undefined) throw new Error(`${label}-b produced no /webrtc address`)
  const dialed = await a.page.evaluate(async (address) => window.o2.dial(address), target)
  expect(dialed).toBe(b.peerId)

  // **The connection carries work, and this is asserted rather than hoped.** A limited circuit
  // — 2 min / 128 KiB — would leave B in `relayedOnly` and out of `computePeers`, the fabric
  // would run at redundancy 1, and the gate would answer `not-attempted`. That is exactly how
  // this file's first fixture failed, so the condition is checked where it can be diagnosed.
  const connections = await a.page.evaluate(async (peer) => window.o2.connectionsTo(peer), b.peerId)
  const webrtc = connections.filter((connection) => connection.remoteAddr.includes('/webrtc'))
  expect(webrtc.length, `${label}: no direct WebRTC path to ${b.peerId}`).toBeGreaterThan(0)
  for (const connection of webrtc) expect(connection.limited).toBe(false)

  // Two computing nodes is what makes `redundancyFor` ask for 2, which is what makes the
  // composer run at all — at redundancy 1 the gate returns `not-attempted` and this file would
  // be reading the wrong arm of the union.
  //
  // **Waited on `computePeers()` and NOT on `#peers`, and the difference cost a 364 s run.**
  // The first draft waited for the page to read `2 node(s) computing` before pressing Run. It
  // never does: `index.html` registers `setInterval(findPeers, 4_000)` inside the **`#join`
  // button's** handler, which calls `autoStart`. A harness that calls `window.o2.start`
  // directly — this file and `attestation-ui.e2e.test.ts` both do, because only `start` takes
  // an `enrollment` — never registers that interval, so `#peers` refreshes only when the `#run`
  // handler performs its own `findPeers()`. That is exactly why the sibling file asserts that
  // sentence *after* its ladder rather than before it.
  //
  // So this waits on the fabric predicate the run handler will itself use, rather than on a
  // rendering that a harness-started tab does not refresh. Polled on an interval rather than
  // per animation frame: each call is an `offer` RPC to every connected peer.
  await a.page.waitForFunction(
    (peer) => window.o2.computePeers().then((peers) => peers.includes(peer)),
    b.peerId,
    { timeout: 180_000, polling: 3_000 },
  )

  return { page: a.page, relayPeerId: relay.node.peerId }
}

/** Press the page's own Run button and wait for the ladder to stop climbing. */
async function runTheLadder(page: Page, budgetMs: number): Promise<void> {
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
  // A run that settled nothing places no shard, so there is no verdict to read — and saying so
  // is a different failure from a verdict that was wrong.
  expect(status).toMatch(/^settled/)
}

/**
 * C22's text, off the region itself rather than out of the text view.
 *
 * The region is the contract UI-SPEC section 4.2 states; the text view is a second rendering of
 * the same record. Reading the region is what makes this an assertion about the catalogue entry
 * rather than about a `<pre>` that happens to contain a substring.
 */
async function quorumRegion(page: Page): Promise<string> {
  expect(await page.isVisible('[data-region="colouring/quorum"]')).toBe(true)
  return (await page.textContent('[data-region="colouring/quorum"]')) ?? ''
}

/** Each arm's rendered verdict, kept for the cross-arm comparison at the end. */
const verdicts: { arm: string; text: string }[] = []

describe('VER-03/VER-04 — the quorum composer’s verdict, on the page a visitor reads', () => {
  it('refuses for the shared relay when the relay is itself a member, and names it on screen', async () => {
    // Three distinct operators across three candidates, so rule 1 is satisfied and **only**
    // rule 2 can fire. That is what makes the refusal below a reading of VER-03 rather than
    // of VER-04: `insufficient-operators` would also refuse this shard, and would mean the
    // fixture was built wrong. `quorum-agents.node.test.ts` separates its two fabrics the
    // same way and for the same reason.
    const { page, relayPeerId } = await twoTabsOnOneRelay('many-op', OPERATOR_B, OWNER_B, OPERATOR_RELAY)

    await runTheLadder(page, 600_000)
    const verdict = await quorumRegion(page)
    verdicts.push({ arm: 'distinct-operators', text: verdict })
    process.stderr.write(`[distinct-operators] ${verdict}\n`)

    // The population, said on the page, and read for the reason `attestation-ui`'s VER-10 case
    // reads it: without it a verdict could have come from a run that quietly lost a peer.
    // Asserted *after* the run because the `#run` handler is what refreshes it — see
    // `twoTabsOnOneRelay`. Three, not two: in this fabric the relay computes too.
    expect(await page.textContent('#peers')).toContain('node(s) computing')

    // ---- VER-03's sentence, on the surface a visitor reads. --------------------------
    // The gate ran. Asserted first, and against the arm that would mean it did not, because
    // `not attempted` is what this file's two earlier drafts actually read and it would
    // otherwise pass every negative assertion below.
    expect(verdict).not.toContain(NOT_ATTEMPTED)
    expect(verdict).toContain(SHARED_RELAY)
    // **The identity, which is what makes the claim checkable.** The peer id of the node
    // this test started as the relay, read off `FabricNode` rather than off the page — so
    // this asserts that the composer named the node that is actually the single point of
    // failure, not merely that it named something.
    expect(verdict).toContain(relayPeerId)
    // **The shape of the refusal, in the composer's own words.** The pre-existing sentence
    // says every member is discoverable *through* the relay, which is false of a relay that
    // is itself a member; this clause is what distinguishes the two and is the half that
    // could not be read at all before 2026-08-14.
    expect(verdict).toContain('is itself a member of the quorum')
    // Not the page claiming a quorum it did not get, and not the other rule.
    expect(verdict).not.toContain(COMPOSED)
    expect(verdict).not.toContain(INSUFFICIENT_OPERATORS)
  }, 1_200_000)

  it('refuses for the operators when every candidate is one operator’s, and says which', async () => {
    // The only difference from the case above: tab B and the relay enrol under tab A's own
    // owner and operator. Same relay, same transports, same provider, same everything else — so
    // a different verdict here can only have come from `operatorId`, which is VER-04's subject.
    const { page } = await twoTabsOnOneRelay('one-op', OPERATOR_A, OWNER_A, OPERATOR_A)

    await runTheLadder(page, 600_000)
    const verdict = await quorumRegion(page)
    verdicts.push({ arm: 'one-operator', text: verdict })
    process.stderr.write(`[one-operator] ${verdict}\n`)

    expect(await page.textContent('#peers')).toContain('node(s) computing')

    // ---- VER-04's actual sentence: one operator cannot supply a whole quorum. -----------
    expect(verdict).not.toContain(NOT_ATTEMPTED)
    expect(verdict).toContain(INSUFFICIENT_OPERATORS)
    expect(verdict).toContain('2 distinct operators, found 1')
    // Not the page claiming a quorum it did not get.
    expect(verdict).not.toContain(COMPOSED)
    // And NOT the shared-relay refusal — **which since 2026-08-14 is a fact this fabric would
    // otherwise produce, and that is what makes this assertion worth its line.** Both tabs
    // hang off the relay and the relay is a member, so rule 2 fires on this topology too; it
    // does not get to speak because rule 1 runs first and this fabric has one operator. Until
    // that date the assertion held for a weaker reason — the rule could not see the relay at
    // all — so it passed on a fabric where nothing was being ordered.
    expect(verdict).not.toContain(SHARED_RELAY)
  }, 1_200_000)

  it('reads two different refusal KINDS off two fabrics, so neither arm can be a constant', () => {
    // The property both cases exist to establish and neither can establish alone. A region
    // hardcoded to either string passes one case and fails this comparison; a region that
    // renders nothing fails both; a region wired to `not attempted` fails both. This is the
    // check that the reading DISCRIMINATES.
    //
    // **Re-sited on the refusal KIND on 2026-08-14, and it is a stronger reading than what it
    // replaced.** It used to be composed-against-refused: the first arm composed, the second
    // did not, and the two texts differed. Once rule 2 could see that the relay was a member,
    // the first arm became a refusal too — so "one composed, one did not" was no longer
    // available and something had to carry the discrimination. Kind-against-kind is what it
    // is now, and the trade runs in this file's favour: the old pair could be satisfied by a
    // region that rendered the *presence or absence* of one word, and this one cannot. Each
    // arm names a different rule of `composeQuorum`, both strings come from `describeQuorum`,
    // and the page composes neither.
    expect(verdicts.map((verdict) => verdict.arm)).toStrictEqual(['distinct-operators', 'one-operator'])
    const [distinct, oneOperator] = verdicts
    if (distinct === undefined || oneOperator === undefined) {
      throw new Error('an arm did not record its verdict')
    }
    expect(distinct.text).not.toBe(oneOperator.text)
    expect(distinct.text).not.toBe('')
    expect(oneOperator.text).not.toBe('')

    // The kinds, crossed. Asserting each arm's own kind and the *absence* of the other's is
    // what makes this a discrimination rather than two independent readings that happen to
    // differ — a region rendering both strings at once would pass the inequality above.
    expect(distinct.text).toContain(SHARED_RELAY)
    expect(distinct.text).not.toContain(INSUFFICIENT_OPERATORS)
    expect(oneOperator.text).toContain(INSUFFICIENT_OPERATORS)
    expect(oneOperator.text).not.toContain(SHARED_RELAY)
  })
})
