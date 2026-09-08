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
import { launchFixtureBrowser } from './e2e-browser-launch.ts'
import { signInDemoTab } from './e2e-signin.ts'
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
 * **And it is the topology of two of the three arms, not of the file.** The third stands the
 * same two tabs up on *two* relays, which is the same tier one relay operator later — no new
 * kind of node, no new transport, one more of what already exists. Both halves above still
 * hold there: each tab reserves on its own relay and enrols `via-relay` naming it, and the two
 * tabs still pair over a direct WebRTC connection that carries the job.
 *
 * ## The three arms, and why fewer would not have been enough
 *
 * A single case reading a verdict cannot tell *the composer decided this* from *this region
 * renders a constant*. So the file stands up three fabrics and reads three different verdicts
 * off the same region — one per arm of `describeQuorum`'s own union:
 *
 * | | relays | operators | verdict |
 * |---|---|---|---|
 * | distinct-operators | one | three distinct | `not composed [shared-relay-dependency] … relay <id> is itself a member` |
 * | one-operator | one | one | `not composed [insufficient-operators] … 2 distinct operators, found 1` |
 * | two-relays | **two** | four distinct | `composed across 2 operators (…) — no two members share an operator` |
 *
 * A page hardcoding any one string fails the other two, and the final case asserts all three
 * differ pairwise. Every arm also asserts against `not attempted`, which is the arm that means
 * the gate never ran — and is what two earlier drafts of this file actually read.
 *
 * **The first two arms are both refusals, and that is stronger than the composed-vs-refused
 * pair it replaced**, which a region could satisfy by rendering the presence or absence of one
 * word. It is refusal **kind** against refusal **kind** — two strings the page never composes,
 * both from `describeQuorum`, each naming a different rule of `composeQuorum`.
 *
 * **The third arm exists because two refusals cannot show a rule working, only two ways of it
 * refusing.** With the file at two arms, every reading it took was a refusal, so a page that
 * had lost `describeQuorum`'s `composed` branch altogether still passed it — and VER-04's
 * actual sentence is *quorum members are selected with anti-affinity, so one operator cannot
 * supply a whole quorum*, whose positive evidence is the `composed across N operators … no two
 * members share an operator` string. On an unflagged surface that string appeared nowhere: the
 * only other place it is printed is `bin/bench.ts` behind `--discover`. The third arm is what
 * puts it back on a page a visitor reads.
 *
 * **And it is not a fixture bent to produce the wanted answer.** Two independently-run relays
 * with a tab on each is *genuine* path diversity — exactly the thing VER-03 asks a quorum not
 * to lack, standing up rather than failing. No arrangement of operators over a **one**-relay
 * fabric can compose, because rule 2 is not a rule about operators: the single relay is the
 * single point of failure of everything it carries and is itself a member. A second relay was
 * therefore the minimum change, and it is the change that makes the fabric honest rather than
 * the one that makes the assertion pass.
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
/**
 * The second relay's owner — seed 75, and the third arm is the only case that stands one up.
 *
 * Re-grepped across every `new Uint8Array(32).fill(n)` site in `packages/` before it was
 * chosen, the census `gated-seed.e2e.test.ts` and `bench-fabric.node.test.ts` both record
 * doing for theirs. 75 is free, and 74 is this file's other relay.
 */
const OWNER_RELAY_B = [...new Uint8Array(32).fill(75)]

const OPERATOR_A = 'quay-street-collective'
const OPERATOR_B = 'north-mill-compute'
const OPERATOR_RELAY = 'dockside-relay-co'
/** The second relay's operator. Distinct from every other id here, which is the point of it. */
const OPERATOR_RELAY_B = 'harbour-line-signals'

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

  browser = await launchFixtureBrowser(chromium)
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
 * A relay a tab reserves on — **enrolled**, because in this fabric a relay computes.
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
  // `42-04` moved the door: `#allow` reveals `#signin`, and `#main` is what UNLOCK reveals.
  // The `start` below is still the harness's own, and it still supplies the relay — this
  // page is served with no `?relay=`, so `revealMain` finds nothing to dial and starts
  // nothing on unlock. What signing in supplies is the passphrase `start` now requires.
  await signInDemoTab(page)

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

/** One relay this fabric stands up: who runs it, and whose key enrolled it. */
interface RelaySpec {
  readonly operator: string
  readonly owner: number[]
}

/**
 * Stand up this fabric's relays, put one tab on each, and join the two tabs over a direct
 * WebRTC connection.
 *
 * Returns the tab that will *submit*. The dial direction is A → B, so A is the requestor and
 * the quorum is composed in A's process over every certificate A can account for.
 *
 * ## Why `relays` is a list, added 2026-08-14
 *
 * The first two arms need exactly one relay and the third needs two, and the difference
 * between them is **the entire fabric property under test** — one shared reachability
 * dependency against two independent ones. Everything else has to stay byte-identical or the
 * three verdicts stop being attributable to the topology: same provider, same enrolment path,
 * same dial, same direct-WebRTC assertion, same wait. So the relay count is the parameter and
 * nothing else moved.
 *
 * Tab A goes on `relays[0]` and tab B on the last one, so a one-relay list is exactly the
 * fabric this function stood up before the parameter existed. With two, A dials B at an address
 * whose circuit half names **B's** relay — which is how A comes to hold a connection to a relay
 * it never reserved on, and therefore how both relays become candidates in A's process. That is
 * a consequence of the dial rather than an arrangement: nothing here connects A to relay 2.
 */
async function twoTabsOnRelays(
  label: string,
  relays: readonly RelaySpec[],
  operatorOfB: string,
  ownerOfB: number[],
): Promise<{ page: Page; relayPeerIds: readonly string[] }> {
  const provider = await startProvider(`provider-${label}`)
  // Named `standing` rather than `started` because this file already has a module-level
  // `started` that `afterAll` stops, and a shadow of it here would read as the same list.
  const standing: { node: FabricNode; addr: string }[] = []
  for (const [index, spec] of relays.entries()) {
    const relay = await startEnrolledRelay(
      `relay-${label}-${index}`,
      provider.addr,
      spec.operator,
      new Uint8Array(spec.owner),
    )
    // Enrolled, and asserted before anything depends on it. A relay that came up without a
    // certificate collapses the whole job to `not-attempted` naming a candidate the reader would
    // then have to identify — which is exactly how this file's previous draft failed.
    expect(relay.node.certificate?.operatorId).toBe(spec.operator)
    // **`seed`, and on the third arm this is what decides who the members are.** A seed's
    // `relayIds` is empty, `composeQuorum` orders candidates fewest-dependencies-first, and
    // both tabs name one relay each — so with two seeds in the pool the seeds are the two
    // members at `size: 2`. Asserted on every arm because it is a fact about how a node that
    // binds a socket enrols, not a property of one fixture.
    expect(relay.node.certificate?.discoverability).toBe('seed')
    standing.push(relay)
  }
  const relayForA = standing[0]
  const relayForB = standing[standing.length - 1]
  if (relayForA === undefined || relayForB === undefined) {
    throw new Error(`${label}: a fabric needs at least one relay`)
  }

  const a = await openEnrolledTab(
    `${label}-a`, `o2-quorum-${label}-a`, relayForA.addr, provider.addr, OWNER_A, OPERATOR_A,
  )
  const b = await openEnrolledTab(
    `${label}-b`, `o2-quorum-${label}-b`, relayForB.addr, provider.addr, ownerOfB, operatorOfB,
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
  //
  // **Every relay is waited on too, not only tab B — added with the third arm and it is a
  // precondition rather than a formality.** Each arm's verdict is a statement about a member
  // set, and a relay that is connected but not answering `offer` is simply not in the pool the
  // composer sees. On one relay that would turn the `shared-relay-dependency` arm into a
  // reading of a fabric with no relay in it; on two it would leave a *single* seed and one tab
  // as the members, which composes or refuses depending on which tab sorted second — the one
  // genuinely non-deterministic shape this fixture has. Waiting here makes that a stall this
  // line names rather than a verdict some later assertion has to explain.
  const expected = [b.peerId, ...standing.map((relay) => relay.node.peerId)]
  await a.page.waitForFunction(
    (peers) => window.o2.computePeers().then((seen) => peers.every((peer) => seen.includes(peer))),
    expected,
    { timeout: 180_000, polling: 3_000 },
  )

  return { page: a.page, relayPeerIds: standing.map((relay) => relay.node.peerId) }
}

/**
 * The one-relay fabric, which is what the first two arms are about.
 *
 * A thin wrapper rather than a second implementation: the two shared-relay arms must differ
 * from the composed arm in the relay count **alone**, and two functions that stand up tabs are
 * two things that can come to stand them up differently.
 */
async function twoTabsOnOneRelay(
  label: string,
  operatorOfB: string,
  ownerOfB: number[],
  operatorOfRelay: string,
): Promise<{ page: Page; relayPeerId: string }> {
  const { page, relayPeerIds } = await twoTabsOnRelays(
    label,
    [{ operator: operatorOfRelay, owner: OWNER_RELAY }],
    operatorOfB,
    ownerOfB,
  )
  const relayPeerId = relayPeerIds[0]
  if (relayPeerId === undefined) throw new Error(`${label}: the sole relay reported no peer id`)
  return { page, relayPeerId }
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

  it('composes across two operators when two independent relays carry the tabs, and says so', async () => {
    // ---- VER-04's positive sentence, and the fabric that actually establishes it. -------
    //
    // **Two relays, one tab on each. This is not a contrived fixture — it is the fabric that
    // SHOULD compose.** Two independently-run relays are genuine path diversity, which is
    // precisely the property VER-03 asks a quorum not to lack and precisely what VER-04's
    // positive arm has to look like: `composed across N operators … no two members share an
    // operator`, read off the page rather than off a CLI.
    //
    // **Why the two-arm version of this file could not show it.** Both arms above stand one
    // relay up, and one relay is by construction the single point of failure of everything it
    // carries — the tabs name it and it is itself a member, so rule 2 fires (many-operator arm)
    // or rule 1 fires first (one-operator arm). No arrangement of *operators* over a one-relay
    // fabric composes, because rule 2 is not about operators. So an unflagged surface showing
    // anti-affinity SUCCEEDING needed a second relay and nothing less, and until this case
    // existed the only place that sentence appeared was `bin/bench.ts` behind `--discover`.
    //
    // **Who the members are, and why it is the relays.** `composeQuorum` dedups to one
    // certificate per operator, then orders fewest-discovery-dependencies-first. A relay binds
    // a socket, so it enrols `seed` with `relayIds: []`; a tab can bind nothing, so it enrols
    // `via-relay` naming the one relay it reserved on. Both relays therefore sort ahead of both
    // tabs and are the two members at `size: 2` — `redundancyFor` asks for `min(2, 1 + peers)`.
    // `sharedRelay` then looks for a relay id that loses *every* member, where a member is lost
    // with R if it depends on R or **is** R. Its candidate ids come only from the members' own
    // `relayIds`, and two seeds name none, so there is no such id and the composer says so.
    //
    // Both readings are asserted below rather than either alone: the count with the identities
    // (VER-04's subject is `operatorId`) and the anti-affinity clause (its actual sentence).
    const { page, relayPeerIds } = await twoTabsOnRelays(
      'two-relay',
      [
        { operator: OPERATOR_RELAY, owner: OWNER_RELAY },
        { operator: OPERATOR_RELAY_B, owner: OWNER_RELAY_B },
      ],
      OPERATOR_B,
      OWNER_B,
    )
    // Two distinct relays and not one counted twice — cheap, and it is the fixture's whole
    // premise. `twoTabsOnRelays` has already waited for both to answer `offer` in tab A's
    // process, so both are in the pool the composer reads.
    expect(new Set(relayPeerIds).size).toBe(2)

    await runTheLadder(page, 600_000)
    const verdict = await quorumRegion(page)
    verdicts.push({ arm: 'two-relays', text: verdict })
    process.stderr.write(`[two-relays] ${verdict}\n`)

    expect(await page.textContent('#peers')).toContain('node(s) computing')

    // The gate ran, and it did not refuse. Asserted before the positive clauses for the reason
    // the arms above give: `not attempted` would otherwise satisfy every negative below.
    expect(verdict).not.toContain(NOT_ATTEMPTED)
    expect(verdict).not.toContain(SHARED_RELAY)
    expect(verdict).not.toContain(INSUFFICIENT_OPERATORS)
    expect(verdict).toContain(COMPOSED)
    expect(verdict).toContain('composed across 2 operators')
    // **VER-04's clause verbatim.** `composed across 2 operators` alone would be satisfied by a
    // sentence that counted operators without claiming anything about how members were picked;
    // this is the half that states the anti-affinity.
    expect(verdict).toContain('no two members share an operator')
    // **The identities, and NOT as one ordered string.** `ShardQuorum.operators` is
    // `members.map(...)` in the composer's own order, which is sorted by `nodeKey` among equal
    // dependency counts — and a `nodeKey` is a fresh ed25519 key per run. Asserting the pair as
    // a joined literal would be asserting a coin toss.
    expect(verdict).toContain(OPERATOR_RELAY)
    expect(verdict).toContain(OPERATOR_RELAY_B)
    // **And the tabs' operators are absent, which is the fewest-dependencies-first ordering
    // being read rather than assumed.** It is also the one degradation this fabric could
    // silently produce: were a relay missing from the pool, a member set of one seed plus one
    // tab would compose too — with a tab's operator in it — and every assertion above would
    // still pass. This is the line that would go red.
    expect(verdict).not.toContain(OPERATOR_A)
    expect(verdict).not.toContain(OPERATOR_B)
  }, 1_200_000)

  it('reads three different verdicts off three fabrics, so no arm can be a constant', () => {
    // The property the three cases exist to establish and none can establish alone. A region
    // hardcoded to any one string passes one case and fails the other two; a region that
    // renders nothing fails all three; a region wired to `not attempted` fails all three. This
    // is the check that the reading DISCRIMINATES.
    //
    // **Re-sited on the refusal KIND on 2026-08-14, and re-widened to three arms the same
    // day.** It began as composed-against-refused: the first arm composed, the second did not,
    // and the two texts differed. Once rule 2 could see that the relay was a member, the first
    // arm became a refusal too — so "one composed, one did not" was no longer available and
    // kind-against-kind carried it, which was strictly stronger because the old pair could be
    // satisfied by a region rendering the presence or absence of one word.
    //
    // **What kind-against-kind alone still could not see, and why this case had to grow rather
    // than merely get longer.** With both arms refusing, every reading this file took was a
    // refusal, and a page that had lost the composed branch entirely — rendering
    // `describeQuorum`'s two `not-composed` sentences correctly and its `composed` one never —
    // passed the whole file. The third arm closes that: three fabrics, three of
    // `describeQuorum`'s three arms, pairwise distinct. Each names a different decision of
    // `composeQuorum` (rule 2, rule 1, and neither), all three strings come from one formatter,
    // and the page composes none of them.
    expect(verdicts.map((verdict) => verdict.arm)).toStrictEqual([
      'distinct-operators',
      'one-operator',
      'two-relays',
    ])
    const [distinct, oneOperator, twoRelays] = verdicts
    if (distinct === undefined || oneOperator === undefined || twoRelays === undefined) {
      throw new Error('an arm did not record its verdict')
    }
    // Pairwise, all three. Two of the three comparisons would hold even if two arms had
    // collapsed onto one reading, so the pair that collapsed has to be named explicitly.
    expect(distinct.text).not.toBe(oneOperator.text)
    expect(distinct.text).not.toBe(twoRelays.text)
    expect(oneOperator.text).not.toBe(twoRelays.text)
    expect(distinct.text).not.toBe('')
    expect(oneOperator.text).not.toBe('')
    expect(twoRelays.text).not.toBe('')

    // The kinds, crossed. Asserting each arm's own kind and the *absence* of the other two is
    // what makes this a discrimination rather than three independent readings that happen to
    // differ — a region rendering all three strings at once would pass the inequalities above.
    expect(distinct.text).toContain(SHARED_RELAY)
    expect(distinct.text).not.toContain(INSUFFICIENT_OPERATORS)
    expect(distinct.text).not.toContain(COMPOSED)
    expect(oneOperator.text).toContain(INSUFFICIENT_OPERATORS)
    expect(oneOperator.text).not.toContain(SHARED_RELAY)
    expect(oneOperator.text).not.toContain(COMPOSED)
    expect(twoRelays.text).toContain(COMPOSED)
    expect(twoRelays.text).not.toContain(SHARED_RELAY)
    expect(twoRelays.text).not.toContain(INSUFFICIENT_OPERATORS)
  })
})
