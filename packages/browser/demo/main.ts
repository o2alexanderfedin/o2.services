/**
 * The tab-side driver.
 *
 * Exposes a small imperative surface on `window.o2` so a page — or a test harness —
 * can consent, start a node, exchange addresses, dial, submit a job, and stop.
 * Keeping the orchestration outside the page means both tabs run identical code and
 * the *test* decides who submits, which is what makes a two-tab result meaningful
 * rather than choreographed.
 *
 * ## Consent is the gate, and it has no bypass
 *
 * `start` calls `requireConsent()` before it touches anything, and that throws unless
 * this origin's storage already holds a record answering the current disclosure
 * version. There is no test-only path around it: a path that could start without
 * consenting would be a path, and BROW-01 is not a property you can have on weekdays.
 * A harness calls `window.o2.grantConsent()` for the same reason a visitor clicks the
 * button — to *write* that record.
 *
 * **Two corrections to what this paragraph used to say, both measurable here.**
 * `start` does not take a `GrantedConsent`: its signature is
 * `start(options: { relayAddrs, blockstoreName, trustAnchors? })`, and the visitor's
 * consent reaches the node from `requireConsent()`'s **return value** rather than from a
 * parameter. And `grantConsent` is not the only minter — `requireConsent` goes through
 * `readConsent(store, DEMO_ANCHORS)`, which mints one of its own from a record already on disk
 * (`consent.ts:154`), so a returning visitor starts with `grantConsent` never running.
 * What is true, and what the gate actually rests on, is that `new GrantedConsent(...)` is
 * reachable at two places only, both inside `consent.ts` and both behind a module-private
 * `MINTED` symbol.
 *
 * **That return value used to be discarded, and BROW-01 is what it cost.** A visitor's
 * `reportingAllowed` reached the *request* path — `startReport` sends `outcome: null` for
 * somebody who declined — and reached nothing else, so the node this function built
 * recorded that visitor's browser family into the ledger it serves peers and answered
 * every `report` request with it. The page withheld the line and the node sent it. The
 * value is now handed to `BrowserNode.start` as `startReporting`, which is a required
 * option there precisely so that no future call site can build a node without answering.
 *
 * Nothing here touches the network before that call either — not even relay
 * discovery, which fetches `/bootstrap.json`. The requirement names CPU; the owner's
 * decision went further, because "we spent no cycles" is not an answer to "you told
 * a third party I was here".
 */

// FOR ITS SIDE EFFECT, and it must be the FIRST import in this file.
//
// RUN-04 stage four. `@libp2p/webrtc` captures `globalThis.RTCPeerConnection` into a `const`
// when its module evaluates — `dist/src/webrtc/index.browser.js` is one line and that is the
// line — so a wrapper installed by any STATEMENT in this file is installed after the capture
// and is invisible to libp2p forever. Measured, not reasoned about: with the install inside
// `api.start`, two real browser contexts completed a genuine browser-to-browser dial and
// `ice-gathering` stayed at 0.
//
// A named import would not do the job on its own: import statements are hoisted above every
// statement here, so what matters is that this module is evaluated FIRST, before anything that
// pulls in `@libp2p/webrtc`. `packages/cloudflare/src/workerd-shims.ts` is the precedent, and
// its header records what the same mistake cost there.
import '../src/ice-observer-install.ts'
import {
  canonicalCid,
  checkpointsInto,
  decodeCanonical,
  jobIdOf,
  readCheckpoint,
  subtleUserSigner,
  verifyCertificate,
} from '@o2/core'
import type {
  Blockstore,
  CanonicalValue,
  NodeCertificate,
  NodeDescriptor,
  StartFailure,
  StartOutcome,
} from '@o2/core'
import { nodeKeyForPeerId, peerIdForNodeKey } from '@o2/libp2p'
import {
  RemoteExecutor,
  RpcRecordIndex,
  discoverCandidates,
  encodeRequest,
  findReservedPeers,
  parseResponse,
  publishStartOutcome,
  reduceJob,
  rpcAdmission,
  submitJobWithEgress,
} from '@o2/net'
import type { CapabilitySupplier } from '@o2/net'
import {
  DEFAULT_BUDGET,
  KERNEL_RECORD,
  PI_RECORD,
  PRIMES_RECORD,
  KERNEL_TRUST_ANCHOR,
  answerOf,
  buildInput,
  buildPiInput,
  buildPrimesInput,
  estimatePi,
  kernelBytes,
  piErrorBound,
  piKernelBytes,
  PI_PARTIAL_KEY,
  PRIME_COUNT_KEY,
  primesKernelBytes,
  projectPiPartial,
  projectPrimeCount,
  readPartial,
  readPrimeCount,
  verifyColouring,
} from '@o2/demo'
import {
  BrowserNode,
  DISCLOSURE,
  DISCLOSURE_VERSION,
  acceptEnrolment,
  canHoldVisitorKey,
  chainsForOwner,
  classifyStartError,
  currentBrowserLabel,
  enrolledIssuer,
  enrolledUserKey,
  firstGap,
  forgetVisitorKey,
  grantConsent,
  pageConsentStore,
  probeEnvironment,
  describeAnchors,
  readConsent,
  readEnrolment,
  revokeConsent,
  revokeEnrolment,
  visitorKeyPair,
  visitorOperatorId,
} from '@o2/browser'
import type {
  GrantedConsent,
  TabApi,
  TabCandidateLookup,
  TabConsentState,
  TabDiscoveryRound,
  TabEnrolmentOffer,
  TabHeldPeer,
} from '@o2/browser'
import { createTaskWorker } from '../src/worker-factory.ts'
import { DialPlanner } from '../src/dial-plan.ts'
// CHURN-03's read half. Relative and **deliberately not through the barrel**, on
// `demo-regions.ts`'s stated rule and for its stated reason: a barrel export whose only
// caller is inside the `window.o2` literal is an exported-but-unreachable symbol in front of
// `reachability-guard.node.test.ts`, bought for nothing. `IdbIdentityStore` and
// `IdbSovereignCids` are off the barrel already, reached the same way by `browser-node.ts`.
import { IdbCheckpoints } from '../src/idb-checkpoints.ts'
// AOT-05's last mile. Relative, not through the barrel — see the module's own header.
import { fetchModuleForDispatch } from '../src/gateway-module.ts'
// BROW-07's carrier. Relative for the same reason, stated in that module's own header.
import { ComputingIndicator, documentTitlePort } from '../src/computing-indicator.ts'
// RUN-04's two halves. Relative and **deliberately not through the barrel**, on
// `computing-indicator.ts`'s stated rule and for its stated reason: a barrel export whose only
// caller is this file would be an exported-but-statically-unreachable symbol in front of
// `reachability-guard.node.test.ts` for the benefit of no consumer.
import {
  FunnelReporter,
  beaconSendPort,
  funnelEndpointFrom,
  readNetworkClass,
  utcHourPort,
} from '../src/funnel-reporter.ts'
import { onFirstIceGathering } from '../src/ice-observer-install.ts'
import * as pid from '@libp2p/peer-id'
// **`import type`, and the distinction matters here rather than being pedantry.** This file's
// convention is that `CID` is reached through `await import('multiformats/cid')` — see
// `aggregateTotalFrom` for the argument and for the measurement that was withdrawn from it.
// That convention is about the *value*: a static value import emits a real edge in the module
// graph. A type-only import is erased before anything runs, emits no edge, and is the only way
// to annotate a binding the dynamic import produces.
import type { CID } from 'multiformats/cid'

/**
 * The anchor set this demo consents under.
 *
 * `[KERNEL_TRUST_ANCHOR]`, because that is what `start` actually passes when a visitor
 * supplies nothing — a consent that described some *other* anchor set would be describing
 * a node this page does not run. The first cut of this line named the provenance opt-out
 * instead, which was wrong twice over: `trust-anchors.node.test.ts` permits that literal
 * in two files and this is not one of them, and the demo does not run unsigned artifacts
 * in the first place.
 *
 * Named once so the value handed to `grantConsent` and the value checked by `readConsent`
 * cannot come to disagree; two expressions would be two places to change.
 *
 * A visitor who supplies their own `trustAnchors` to `start` is running under a different
 * set, and `readConsent` will say so — which is the whole feature, not an edge case.
 */
const DEMO_ANCHORS: string = describeAnchors([KERNEL_TRUST_ANCHOR])

let node: BrowserNode | null = null
let consent: GrantedConsent | null = null
let lastOutcome: StartOutcome | null = null
/** The last colouring the fabric claimed, kept so the visitor can check it. */
let lastAnswer: { readonly n: number; readonly bits: Uint8Array } | null = null
/** Counted here and never transmitted — see `startReport` below. */
let declinedLocally = 0
/**
 * The provider address the **running** node was started with, or `null` for a node started
 * without one — and `undefined` while no node is running.
 *
 * Kept so `enrolmentOffer` can answer `appliedToRunningNode` from what actually happened
 * rather than from what storage currently says. The two disagree for exactly as long as a
 * visitor's answer is newer than their node, which is the interval the page has to tell them
 * about. Read `undefined` as "the question does not arise".
 */
let runningWithProvider: string | null | undefined

// **`pageConsentStore` and not `localConsentStore`, and the difference is a refusal a
// visitor could hit.** `requireConsent()` below does not use the value `grantConsent`
// returned — it re-reads the store — so on a page whose storage is denied the write went
// nowhere and pressing Start threw `no consent` after the visitor had pressed Allow.
// `pageConsentStore` round-trips a probe and falls back to memory, which is the outcome
// `grantConsent`'s own docblock already promised: *"a visitor in a storage-denied context
// still gets a working consent for this page load, they are simply asked again next
// time."*
const store = pageConsentStore()

/**
 * Observers of "something the visible surface depends on has changed".
 *
 * The page cannot poll for this: Chromium throttles timers hard in a tab that is
 * not in front, so a background tab would show a stale surface — or none at all —
 * for exactly as long as nobody was looking at it.
 */
const listeners = new Set<() => void>()
function notify(): void {
  for (const listener of listeners) listener()
}

function required(): BrowserNode {
  if (node === null) throw new Error('node not started')
  return node
}

/**
 * The tab-strip indicator — BROW-07's page half.
 *
 * ## Why this polls, which the phase plan requires be justified rather than assumed
 *
 * `BrowserNode` publishes **no execution event**. `onActivity` fires when a peer dispatches
 * work here (`browser-node.ts`'s `onDispatch` seam) and has no counterpart for a task
 * *finishing*, and it says nothing at all about this tab's own self-dispatched shards. The
 * two sources of in-flight work therefore have no common event, and building the indicator
 * out of one event plus an inference about the other would give the page two mechanisms that
 * can disagree about whether this machine is busy.
 *
 * What does exist is one authoritative count: `CountingExecutor` sits **inside**
 * `GovernedExecutor` (`browser-node.ts:1826` explains the ordering) so it counts tasks
 * actually running rather than tasks parked on the governor's serialization chain, and every
 * path that reaches `.execute` — a peer's dispatch and this page's own alike — goes through
 * it. `node.executorInFlight` is that count. Reading it on a tick cannot disagree with
 * itself.
 *
 * ## The interval, and why 250 ms rather than something smaller
 *
 * A backgrounded tab is exactly the case this indicator exists for, and Chromium throttles a
 * hidden tab's timers to roughly **1 Hz** (and harder still after several minutes of
 * hiding). Anything faster than that is not delivered where it matters, so the choice is
 * between a figure that is honest about the floor and one that merely looks attentive.
 * 250 ms is fast enough to be indistinguishable from instant in a foreground tab and slow
 * enough that the throttled case degrades to about a second — which is the actual guarantee,
 * and is well inside the life of any task worth indicating.
 *
 * The tick runs only while a node is up. An idle page installs no timer.
 *
 * ## The dwell, which is what makes the indicator *persistent* rather than a strobe
 *
 * `CountingExecutor` counts calls inside the **inner** executor, so a task waiting for its
 * slice on `GovernedExecutor`'s serialization chain is not counted — that is the right
 * definition for SCHED-06's concurrency reading and the wrong one here. A throttled tab
 * spends most of its wall clock idling between tasks: `VisibilityGovernor` sleeps
 * `sliceMs * (1/duty - 1)` per slice (`visibility-governor.ts:153`) with `sliceMs` defaulting
 * to 50 (`:75`), so at this page's own `backgroundDutyCycle` of `0.05` the gap between tasks
 * is **950 ms** and an instantaneous reading finds the executor idle almost every time.
 *
 * A tab **backgrounded and throttled** is exactly the state BROW-07 is about. An indicator
 * sampling `executorInFlight` alone would therefore blink off for most of the interval in
 * which a visitor is most likely to look at it, and "the tab strip said I was not computing
 * while it was computing" is the failure this requirement exists to prevent. So a reading of
 * zero only clears the title once it has been zero for {@link COMPUTING_DWELL_MS} — long
 * enough to cover that 950 ms gap several times over, short enough that a tab which has
 * genuinely finished stops claiming otherwise within a few seconds.
 *
 * **What this does not cover, stated rather than left to be discovered:** a visitor who sets
 * a cap far below the background one by hand — `setDutyCycle(0.005)` gives a 9.95 s gap —
 * makes the gap longer than the dwell, and the indicator will blink for them. The dwell is
 * sited against the duty cycles this page itself chooses, not against every value the API
 * admits. Stop clears the title immediately and does not wait out the dwell, because a
 * stopped tab is not computing and that is not a sampling question.
 */
const COMPUTING_POLL_MS = 250
const COMPUTING_DWELL_MS = 4_000
let computingIndicator: ComputingIndicator | null = null
let computingTicker: ReturnType<typeof setInterval> | null = null
let computingLastBusyAt = 0

function computingTick(): void {
  // RUN-04's stages five and six ride this poll rather than starting a second timer: they are
  // read off the same two counters BROW-07 already samples here, at the same rate.
  funnelTick()
  const indicator = computingIndicator
  if (indicator === null) return
  const inFlight = node?.executorInFlight ?? 0
  if (inFlight > 0) computingLastBusyAt = Date.now()
  const withinDwell = computingLastBusyAt !== 0 && Date.now() - computingLastBusyAt < COMPUTING_DWELL_MS
  indicator.report(inFlight > 0 || withinDwell ? 1 : 0)
}

/**
 * RUN-04 — the six-stage funnel, on this visitor's side.
 *
 * ## Constructed once, inert unless the page was configured
 *
 * `funnelEndpointFrom` reads `?funnel=` and answers `null` for a page that names none, which
 * is every published page today. An inert reporter's methods are no-ops, so the six call sites
 * below cost nothing and say nothing when nobody asked for a funnel. **There is no default
 * endpoint and there must not be one** — see `funnel-reporter.ts`'s header for what a default
 * would cost, and `funnel-reporter.node.test.ts` for the guard that keeps it out.
 *
 * ## Armed at consent, which is the intersection of both readings of open question 3
 *
 * Stage one is *composed* at module evaluation and *held*; it leaves only when
 * {@link armFunnel} runs, carrying the hour it happened rather than the hour it was flushed.
 * That hold is the whole mechanism by which the pending default stays lawful under either
 * ruling: **nothing at all is sent by a visitor who does not consent.**
 */
const funnel = ((): FunnelReporter => {
  const endpoint = funnelEndpointFrom(location.search)
  if (endpoint === null) return new FunnelReporter()
  return new FunnelReporter({
    send: beaconSendPort(endpoint),
    clock: utcHourPort(),
    networkClass: readNetworkClass(),
  })
})()

// Stage one. Composed here — the earliest point in this page's life — and held until consent.
funnel.enter('page-load')

/**
 * The arming point, and the one value the legal ruling moves.
 *
 * Called from **both** places a visitor can arrive at a granted consent: the gate control, and
 * a returning visit whose consent was already stored. Missing the second would make every
 * returning visitor invisible to the funnel while looking like a page-load drop-off, which is a
 * defect that reads as a finding.
 */
function armFunnel(): void {
  funnel.arm()
  funnel.enter('consent')
}

/** Set once stage six has been reported, so the poll loop stops asking. */
let funnelSawFirstTask = false

/**
 * Stages five and six, read off the same 250 ms poll BROW-07 already runs.
 *
 * ## Stage five's class, and why `relayed` is a value this tier does not produce
 *
 * `pathTo` answers `carries-work`, `control-only` or `unconnected`. **A control-only pair is
 * not a peer this visitor can compute with**, so folding it into the connected count would
 * inflate stage five against stage six and hide the funnel's largest leak inside its own
 * vocabulary — which is why the schema carries `control-only` as a value of its own.
 *
 * The other two map to `direct`, and that is a statement about this tier rather than a
 * shortcut: in a browser every relayed circuit is a *limited* connection, so `pathTo` has
 * already separated it as `control-only`, and anything left that carries work is either a
 * direct WSS connection to a bootstrap node or a WebRTC one. `classifyConnection` calls the
 * second `direct` too, deliberately — a direct browser-to-browser address still names the relay
 * that signalled it. So `relayed` is produced by the hosted tier and not by this one, and the
 * schema carries it because the schema is shared.
 *
 * ## Stage six counts a task that FINISHED, and the predicate is why
 *
 * Phase 35 measured `activity().tasksExecuted` — `GovernedExecutor`'s `#executed` — going
 * `0 → 128` inside 800 ms, because at a duty cycle of 1 it increments **before**
 * `inner.execute(task)`. It counts tasks *admitted*. Stage six's words are *first task
 * EXECUTED*, so the predicate here is `executed >= 1 && executorInFlight === 0`, which is only
 * true once an admitted task has left the executor: `CountingExecutor.execute` raises
 * `#inFlight` as its first statement and lowers it in a `finally`, and `GovernedExecutor`
 * raises `#executed` in the statement immediately before calling it — so the intermediate state
 * is never observable between two polls, and no sampling rate can miss it.
 */
function funnelTick(): void {
  const running = node
  if (running === null) return

  for (const peer of running.transport.peers) {
    const path = running.transport.pathTo(peer)
    if (path === 'unconnected') continue
    funnel.enter('connection-classified', path === 'control-only' ? 'control-only' : 'direct')
    break
  }

  if (!funnelSawFirstTask && running.executor.executed >= 1 && running.executorInFlight === 0) {
    funnelSawFirstTask = true
    funnel.enter('first-task')
  }
}

function beginComputingIndicator(): void {
  // Constructed lazily rather than at module scope for `localConsentStore`'s reason: a
  // module that reads a browser global when it is loaded cannot be loaded anywhere else.
  computingIndicator ??= new ComputingIndicator(documentTitlePort())
  // A fresh node has done no work; a stale mark from a previous node would decorate the
  // title for a tab that has just started and is idle.
  computingLastBusyAt = 0
  computingTick()
  computingTicker ??= setInterval(computingTick, COMPUTING_POLL_MS)
}

function endComputingIndicator(): void {
  if (computingTicker !== null) {
    clearInterval(computingTicker)
    computingTicker = null
  }
  // Reported rather than left decorated: a stopped tab is not computing, and the title is
  // the only place a visitor looking at another tab would find that out. The dwell is
  // deliberately skipped — it exists to smooth a *sampled* reading of a running executor,
  // and there is nothing to sample once the thread has been terminated.
  computingLastBusyAt = 0
  computingIndicator?.report(0)
}

/**
 * The open handle store for this tab, opened once — CHURN-03's read half.
 *
 * **Named off the blockstore this node actually opened**, not off a constant and not off the
 * option `start` was called with: `${node.store.name}-checkpoints` is the same derivation
 * `browser-node.ts` uses for `-identity`, `-sovereign` and `-issuance`, and it is what keeps
 * two tabs isolated. Every end-to-end harness on this page isolates its tabs by passing
 * distinct `blockstoreName`s — `o2-colouring-a` and `o2-colouring-b` in
 * `colouring-demo.e2e.test.ts` — and a checkpoint database named by a constant would have
 * been shared across all of them on one origin. Tab B would then have resumed tab A's job,
 * carried every cube, and reported `complete: false` on a fabric that was working perfectly.
 *
 * A separate database from the blocks, for the reason `idb-checkpoints.ts` gives at length:
 * a pointer that is evicted independently of the blocks it names is worse than no pointer.
 *
 * Memoised per name rather than per call. Opening the same IndexedDB database twice from one
 * page is legal and wasteful, and a second connection also blocks a `deleteDatabase` — the
 * hazard `start-unwind.browser.test.ts` reads on the blockstore's own connection.
 */
let checkpointRecords: { readonly name: string; readonly store: Promise<IdbCheckpoints> } | null =
  null
function checkpointsFor(blockstoreName: string): Promise<IdbCheckpoints> {
  const name = `${blockstoreName}-checkpoints`
  const held = checkpointRecords
  if (held?.name !== name) {
    // The previous connection is closed rather than dropped, for `start-unwind.browser.test.ts`'s
    // reason one database over: an open IndexedDB connection makes `deleteDatabase` fire
    // `blocked` instead of completing, and a page that restarted its node under a different
    // store name would leave one open for the lifetime of the tab. `catch` because a store that
    // failed to open has nothing to close and its rejection is the *next* call's to report.
    if (held !== null) void held.store.then((store) => store.close()).catch(() => {})
    const opened = { name, store: IdbCheckpoints.open(name) }
    checkpointRecords = opened
    return opened.store
  }
  return held.store
}

/**
 * The proof `start` needs, or a refusal naming why there is none.
 *
 * Re-read from storage each time rather than cached: another tab on this origin may
 * have revoked in the meantime, and a stale in-memory grant would let this tab keep
 * running on a permission the visitor has withdrawn.
 */
function requireConsent(): GrantedConsent {
  const found = readConsent(store, DEMO_ANCHORS)
  if (found.ok) {
    consent = found.consent
    return found.consent
  }
  consent = null
  throw new Error(`no consent: ${found.gap.kind}`)
}

function stateOf(): TabConsentState {
  const found = readConsent(store, DEMO_ANCHORS)
  return found.ok
    ? { granted: true, version: DISCLOSURE_VERSION, reportingAllowed: found.consent.reportingAllowed }
    : { granted: false, gap: found.gap.kind, version: DISCLOSURE_VERSION, reportingAllowed: false }
}

/**
 * The `enrollment` option a visitor's stored decision amounts to — AUTH-01/02/04.
 *
 * The only place the three fields are assembled, and the assembly is the point: the address
 * arrives as an argument because it is the origin's to publish and the visitor's to have
 * accepted, while the other two are **taken, not passed**. There is no parameter here for a
 * key or an operator, so no caller — the page, a harness, an embedding host — can supply
 * one, and that is enforced by the signature rather than by a rule somebody remembers.
 *
 * A key pair, not bytes: `BrowserNodeOptions.enrollment.userPrivateKey` is
 * `Uint8Array | CryptoKeyPair`, and the second arm exists for exactly this caller. The pair
 * is non-extractable, so the branch that would hand over bytes is not available here even
 * to code that wanted it.
 */
async function visitorEnrolmentOption(providerAddr: string): Promise<{
  readonly userPrivateKey: CryptoKeyPair
  readonly operatorId: string
  readonly providerAddr: string
} | null> {
  // A non-secure origin cannot hold a key the page is unable to read, and a key the page
  // *can* read is not the visitor's in any sense worth the word. Answering `null` starts an
  // ordinary unenrolled node rather than throwing, because a stored decision made on an
  // origin that has since lost `crypto.subtle` must not turn into a page that will not load.
  if (!canHoldVisitorKey()) return null
  const keyPair = await visitorKeyPair()
  return {
    userPrivateKey: keyPair,
    operatorId: await visitorOperatorId(keyPair),
    providerAddr,
  }
}

/**
 * The chains a sovereign dispatch travels under — AUTH-03's browser half, wired here.
 *
 * **This is the "that day" `runJob`'s standing note said to wire a chain before.** That note
 * bounded the surface by placement: every descriptor this page built declared
 * `ownerId: 'public'`, so a sovereign shard was unplaceable and no executor was ever handed
 * one. Placement stopped being the bound on 2026-08-18, when `discoveredDescriptors` started
 * carrying `certificate.userKey`, and `attestation-ui.e2e.test.ts` then measured what was
 * actually left: the shard reaches the right machine and is refused there,
 * `unauthorized: no capability chain supplied`, six times. This is that refusal answered.
 *
 * ## Minted before the executors, because a supplier cannot sign
 *
 * `CapabilitySupplier` is synchronous and `crypto.subtle.sign` is not, so the node set has to
 * be settled first. That is why this runs after `discoveredPool` and before the executor list
 * — and why the discovered executors are **rebuilt** rather than reused: the ones
 * `discoverCandidates` returned carry the unauthenticated sentinel it was given.
 *
 * ## `null` in four situations, and only one of them is a refusal
 *
 * No sovereign arm (nothing to authorise), no certificate (this tab enrolled nowhere, so it
 * has no owner identity at all), no holdable key (a non-secure origin), and finally an
 * `ownerId` that is not this tab's own — the last being the real one, and `chainsForOwner`
 * makes that call rather than this function, because it is the only place that can compare
 * against what the signer can actually produce a signature for.
 *
 * Every `null` lands on the same behaviour: dispatch unauthenticated, exactly as before.
 * A sovereign shard then gets the fabric's own refusal at the far end, which is a true
 * sentence about the run, and the page keeps saying it.
 */
async function sovereignChainsFor(
  n: BrowserNode,
  sovereign: { readonly ownerId: string } | undefined,
  nodeIds: readonly string[],
): Promise<((nodeId: string) => CapabilitySupplier) | null> {
  if (sovereign === undefined) return null
  if (n.certificate === null) return null
  if (!canHoldVisitorKey()) return null
  const signer = await subtleUserSigner(await visitorKeyPair())
  return chainsForOwner(signer, { ownerId: sovereign.ownerId, nodeIds, now: () => Date.now() })
}

/**
 * The offer as the page must render it, assembled from the three things that decide it:
 * what the origin publishes, what the visitor answered, and what this browser can hold.
 *
 * `offered` is about the origin and `accepted` is about the visitor, and they are separate
 * fields rather than one tri-state because the page says different things about each — an
 * origin that names nobody is the ordinary state of a static host and is not a refusal.
 */
async function offerOf(): Promise<TabEnrolmentOffer> {
  const canHoldKey = canHoldVisitorKey()
  // Consent gates the network read inside `discoverRelays`, and a page that has not been
  // granted it has nothing to offer yet. Reported as "no offer" rather than thrown: the
  // consent gate is the surface that should be speaking at that moment, not this one.
  if (!readConsent(store, DEMO_ANCHORS).ok) {
    return { offered: false, accepted: false, canHoldKey, appliedToRunningNode: true }
  }
  const { enrollmentProvider } = await api.discoverRelays()
  const found = readEnrolment(store, enrollmentProvider)
  // What actually came back, as against what was asked for. `enrolledIssuer` reads the
  // stored certificate, so this answers before any peer has been spoken to and it survives a
  // reload — and it is `null` on a tab whose certificate names a node identity this origin
  // has since lost, which is the case a decision alone could never see.
  const heldIssuer = await enrolledIssuer()
  const providerAddr =
    found.ok ? found.enrolment.providerAddr
    : found.gap.kind === 'provider-changed' ? found.gap.offered
    : enrollmentProvider
  const accepted = found.ok
  return {
    offered: enrollmentProvider !== undefined,
    ...(providerAddr === undefined ? {} : { providerAddr }),
    accepted,
    ...(found.ok ? {} : { gap: found.gap.kind }),
    canHoldKey,
    ...(heldIssuer === null ? {} : { heldIssuer }),
    // `undefined` means no node is running, and then the question does not arise — a
    // decision cannot be out of step with a node that does not exist.
    appliedToRunningNode:
      runningWithProvider === undefined ||
      runningWithProvider === (accepted ? found.enrolment.providerAddr : null),
  }
}

function partitionOf(output: CanonicalValue): number {
  const p = (output as { p?: unknown }).p
  if (!(p instanceof Uint8Array) || p.length !== 4) return -1
  return new DataView(p.buffer, p.byteOffset, 4).getUint32(0, true)
}

/** Record how starting went, for BROW-02. Kept whether or not it will be sent. */
function noteOutcome(cause: StartFailure | null): void {
  lastOutcome = {
    browser: currentBrowserLabel(),
    result: cause === null ? { kind: 'started' } : { kind: 'failed', cause },
  }
}

/**
 * This origin's bootstrap document, wherever it is mounted — and it is mounted in two places.
 *
 * ## Why two, and why asking both is the fix rather than picking one
 *
 * Two production servers publish this document at two different paths, and neither is wrong:
 *
 * - **Beside the page.** GitHub Pages serves this repository at a SUBPATH
 *   (`/o2.services/`), and `scripts/deploy-pages.sh` writes `bootstrap.json` into the
 *   published directory. A root-absolute request there reaches the domain apex, not the site.
 * - **At the origin root.** `SeedServer` mounts a middleware on `/bootstrap.json`
 *   (`packages/node/src/seed-server.ts:499`) while serving the page from
 *   `/packages/browser/demo/index.html`, because the address it publishes is derived from the
 *   request's own `Host` header and cannot be a file sitting next to the page.
 *   `tab-api.ts` documents the root path.
 *
 * **A page cannot know which one served it, and that is the whole point.** It is a bundle
 * loaded from an origin it was not configured for — the same property that makes
 * `?relay=` a link rather than a build flag.
 *
 * ## What this cost, and why one request was never enough
 *
 * `cb09195` (2026-08-28) changed both call sites from root-absolute to document-relative. It
 * fixed the published client, which had never been able to join at all, and it silently broke
 * every LAN seed: measured 2026-08-31 against a live `SeedServer`, `/bootstrap.json` answered
 * 200 with the seed's own relay address while `/packages/browser/demo/bootstrap.json` — what
 * a relative fetch from that page resolves to — answered **404**. `discoverRelays` then
 * reported `source: 'none'`, which `tab-api.ts` documents as the ORDINARY state of a static
 * host, so a page that could no longer join looked exactly like one that was simply given no
 * relay. Nothing errored. Fifteen e2e cases across six files went red and stayed red through
 * two releases.
 *
 * The root-absolute form had the mirror-image defect, which is why reverting is not the fix.
 *
 * ## Relative FIRST, and the order is load-bearing
 *
 * On Pages the root request reaches the domain apex — an origin this page does not control
 * and whose answer it must never dial. Asking beside the page first means that request is
 * only ever made when the page's own directory has no bootstrap document, and it is answered
 * by the same origin in either case.
 *
 * The first request that returns a parseable JSON body wins, whatever fields are in it: a
 * document that exists IS this origin's answer, and falling through on a missing field would
 * let one caller read one location and another caller read the other.
 *
 * Answers `undefined` when neither location has one — a static host with no seed, which is a
 * state and not a failure.
 */
async function fetchBootstrapDocument(): Promise<Record<string, unknown> | undefined> {
  // Deduplicated, because a page served FROM the root resolves both to the same URL and a
  // second identical request would be a wasted round trip on the commonest arrangement.
  const seen = new Set<string>()
  for (const candidate of [
    new URL('bootstrap.json', document.baseURI),
    new URL('/bootstrap.json', location.origin),
  ]) {
    if (seen.has(candidate.href)) continue
    seen.add(candidate.href)
    try {
      // `no-store` because a stale relay address is worse than a slow one.
      const response = await fetch(candidate, { cache: 'no-store' })
      if (!response.ok) continue
      const body: unknown = await response.json()
      // Narrowed rather than cast: a static host may answer 200 with HTML or with an array,
      // and neither must be read as a bootstrap document by a caller reaching for a field.
      if (typeof body === 'object' && body !== null && !Array.isArray(body)) {
        return { ...body }
      }
    } catch {
      // A 404, HTML where JSON was expected, or no host at all. Try the other location.
    }
  }
  return undefined
}

/** The round in flight, so a second caller joins it instead of starting another. */
let discoveryRound: Promise<TabDiscoveryRound> | null = null

/**
 * The upgrade budget for peers this tab holds over a relay circuit only — defect 32.
 *
 * Module-level and replaced in {@link TabApi.stop}, so a tab that restarts does not
 * inherit the verdicts of a run whose connections no longer exist.
 */
let planner = new DialPlanner()

async function runDiscoveryRound(): Promise<TabDiscoveryRound> {
  const n = required()
  const candidates: string[] = []
  let asked = false

  // 1. The origin, when a seed node served this page. It is the better answer on a
  //    LAN because it also carries the seed's own direct address, which needs no
  //    relay circuit at all — so a lone visitor has a peer immediately.
  // Both mount points, relative first — see {@link fetchBootstrapDocument} for why a page
  // cannot know which of the two served it, and for what asking only one of them cost.
  const info = await fetchBootstrapDocument()
  if (info !== undefined && Array.isArray(info['peerAddrs'])) {
    candidates.push(...info['peerAddrs'].filter((a): a is string => typeof a === 'string'))
    asked = true
  }

  // 2. The fabric itself. **This is the only route on a static host**, where there
  //    is no origin and DEMO-03 forbids adding a server-side process. Asking the
  //    nodes we are already connected to needs nothing the fabric does not have.
  const reserved = await findReservedPeers({
    rpc: n.rpc,
    peers: () => n.transport.peers,
    self: n.peerId,
  })
  if (reserved.answered > 0) asked = true
  candidates.push(...reserved.addrs)

  // Every rule about *which* candidates are worth a dial — this tab's own entry, a
  // peer already reachable, one peer offered twice, the budget that bounds the round's
  // wall clock, and how many times a relayed-only pair is re-dialled before this tab
  // gives up and says so — lives in `DialPlanner`, where a test can reach it without a
  // relay and a real node. What is left here is the I/O.
  //
  // `n.heldPeers`, **not** `n.transport.peers`, and that is the whole of defect 32: the
  // second is `libp2p.getPeers()`, which counts a peer reachable over nothing but a
  // limited relay circuit as connected, so a round skipped exactly the peers that most
  // needed dialling again.
  const dialed: string[] = []
  const failed: string[] = []
  const upgrades: string[] = []
  for (const { address, purpose } of planner.plan({
    candidates,
    self: n.peerId,
    held: n.heldPeers,
  })) {
    if (purpose === 'upgrade') upgrades.push(address)
    try {
      dialed.push(await n.dial(address))
    } catch {
      // A peer whose reservation has lapsed, or that closed its tab between the
      // directory's answer and this dial. Expected, and not worth failing the round.
      //
      // A simultaneous mutual dial lands here too, on **both** sides at once — measured
      // four times out of four on firefox↔webkit — and it is the entry point to the state
      // the two fields below exist to report.
      failed.push(address)
    }
  }
  // Read after the dials, so both fields describe how the round left this tab rather
  // than how it found it.
  const held = n.heldPeers
  if (dialed.length > 0) notify()
  return {
    asked,
    dialed,
    failed,
    upgrades,
    relayedOnly: held.filter((peer) => !peer.carriesWork).map((peer) => peer.peer),
    stalled: [...planner.stalled(held)],
  }
}

/**
 * How long this page waits for a peer to hand over its own signed records.
 *
 * Far below this page's `rpcTimeoutMs` (60 s, set where it constructs its node), and the
 * gap is the whole point. This lookup exists to *label* a result; a job that stalled a
 * minute per peer to improve a caption would be a worse product than no caption, and the
 * plan this landed under says so in those words. Silence inside the deadline is the same
 * answer as a refusal — this tab holds no signed statement about that peer — so a
 * requestor gains nothing by waiting longer.
 *
 * Sits beside `DEFAULT_PROBE_TIMEOUT_MS` (2 s, `@o2/net`) in kind rather than in value: an
 * offer bounds a *placement* decision and is on the critical path of every shard, while
 * this runs once per peer per job and its answer decides a sentence.
 */
const RECORDS_DEADLINE_MS = 5_000

/**
 * A peer's provider-signed certificate, or the named absence — VER-09, VER-10.
 *
 * ## What this is, and what it is not
 *
 * It is the **reading** half of the `records` request this tier already *serves*, on
 * terms byte-identical to the Node tier's (`browser-node.ts`'s `index:` argument against
 * `fabric-node.ts`'s). NET-06 claims a browser peer participates in routing as a full
 * peer; a tab that answers records and never asks for one has exercised half of that.
 *
 * It is **not** discovery. The peers asked here are the ones already connected and
 * already chosen to compute; nothing in this function changes who is asked to run
 * anything, and a peer that answers nothing is still dispatched to. A display concern
 * that could remove a node from a job would be a node class invented by a caption.
 *
 * ## The anchor is this tab's own issuer, because it is the only one this tab has
 *
 * **Corrected 2026-08-14.** This paragraph read *"`BrowserNodeOptions` has no
 * `trustedIssuers` field — `FabricNodeOptions` has one and this tier does not"*, and that
 * is no longer true: the field landed, and `api.start` above now fills it from
 * `enrolledIssuer`. The sentence is kept rather than deleted because the *reasoning* under
 * it survived the field's arrival intact — it is why the field is filled the way it is.
 *
 * `TabApi.start`'s `trustAnchors` is still a different namespace entirely: those are
 * *build* authorities, checked by `NameResolver` against a module's signed record, and
 * using them as certificate issuers would be the conflation this phase exists to end
 * wearing a new hat.
 *
 * What this function reads is this tab's *own* certificate rather than the pinned set,
 * and that is not the same value even now — a tab pins what it enrolled with on an
 * earlier start, and holds a certificate from this one. The two agree in every case a
 * visitor reaches; they are read from different places on purpose, so a mismatch between
 * them stays visible instead of being assumed away.
 *
 * What this tab does hold, when it was enrolled, is a certificate naming the provider
 * that signed it. That provider's key is a real anchor, held before any peer spoke, and
 * a peer enrolled by the same provider verifies against it offline. A tab enrolled by
 * nobody has **no** anchor and therefore names nobody — which is the honest answer and
 * not a degradation, because "I checked nothing" and "I checked and it failed" both mean
 * this tab cannot vouch for that peer.
 *
 * ## Why the check has to be here and not left to `receiptFor`
 *
 * `submitJob`'s `receiptFor` verifies a replica's attestation against
 * **`descriptor.certificate.issuer`** — the issuer named by the descriptor it was handed.
 * So a certificate taken off the wire and put on a descriptor unverified would supply its
 * own trust root, and two peers presenting self-issued certificates under two operator ids
 * would be reported as `independent`. That is precisely a strength the run did not
 * establish, printed on the surface with the widest audience. The pin has to be applied
 * where an independently-held key exists, and this is that place.
 */
async function peerCertificate(
  n: BrowserNode,
  peerId: string,
): Promise<NodeCertificate | 'carries-no-certificate'> {
  const held = n.certificate
  // No anchor. Asking would still return an answer, and accepting it would be accepting
  // a peer's word for a peer's identity — see this function's last section.
  if (held === null) return 'carries-no-certificate'

  // Computed offline from the peer id, so the key this tab asks about is the key whose
  // holder must have dialled as that peer. Asking a peer "what is your node key" and then
  // believing the answer would leave nothing for the comparison below to catch.
  const nodeKey = nodeKeyForPeerId(peerId)
  if (nodeKey === null) return 'carries-no-certificate'

  let timer: ReturnType<typeof setTimeout> | undefined
  const answered = await Promise.race([
    // `RpcRecordIndex` already swallows a transport error into `undefined`; the `catch` is
    // for anything it does not, because the one thing this lookup may never do is throw
    // into a job. Both arms of the race land on the same named absence.
    new RpcRecordIndex(n.rpc, () => [peerId]).recordsFor(nodeKey).catch(() => undefined),
    new Promise<undefined>((resolve) => {
      timer = setTimeout(() => resolve(undefined), RECORDS_DEADLINE_MS)
    }),
  ]).finally(() => {
    if (timer !== undefined) clearTimeout(timer)
  })
  if (answered === undefined) return 'carries-no-certificate'

  // A peer answers `records` from its own `SelfRecordIndex`, which returns nothing for any
  // key but its own — so a well-behaved peer cannot answer with somebody else's here. This
  // compares the answer against what was asked anyway, because "a well-behaved peer
  // cannot" is a statement about the peers that behave.
  if (answered.certificate.nodeKey !== nodeKey) return 'carries-no-certificate'

  const checked = verifyCertificate(answered.certificate, new Set([held.issuer]), Date.now())
  return checked.ok ? checked.certificate : 'carries-no-certificate'
}

/**
 * How long this page waits for the candidate lookup before dispatching without it.
 *
 * Sited at {@link RECORDS_DEADLINE_MS} and for that function's reason rather than by
 * coincidence: both are per-dispatch lookups whose answer improves a placement, and a page
 * that stalled a minute per peer to improve one would be a worse product than a page that
 * placed on what it already knew. `discoverCandidates` fans `providers` out concurrently
 * and `recordsFor` sequentially, so a single wedged peer can hold the whole lookup open for
 * this tab's `rpcTimeoutMs` (60 s) — which is the case this deadline exists for and the
 * only one, because a peer that is merely absent fails multistream negotiation at once.
 */
const CANDIDATES_DEADLINE_MS = 5_000

/**
 * The last candidate lookup this page ran — SCHED-01, and the reading
 * {@link TabApi.lastCandidates} returns.
 *
 * Module-level beside {@link planner} and for the same reason: it describes a run rather
 * than a node, so a tab that restarts must not report the candidates of a fabric whose
 * connections no longer exist. Reset in {@link TabApi.stop}.
 */
let lastCandidates: TabCandidateLookup | null = null

/** What one candidate lookup leaves a dispatch — {@link discoveredPool}. */
interface DiscoveredPool {
  /**
   * Executors for the peers the lookup qualified that the caller **did not name** — NET-06.
   *
   * **The whole of what this page selects rather than accepts.** Every other executor a job
   * runs on is built from an id in `options.peerIds`; these are built from a `providers`
   * answer intersected with capability records this tab verified against an issuer it
   * pinned before it spoke to anybody. Empty is the ordinary state — a cold fabric
   * advertises nothing, and a fabric whose peers the caller already named leaves nothing
   * over — so an empty list here is *not* the lookup having failed. Read
   * {@link TabCandidateLookup.providers} beside it to tell those apart.
   *
   * **Taken from `discoverCandidates`'s own `executors` rather than rebuilt from the ids.**
   * The helper exists precisely to turn a node key into something dispatchable, addressed
   * by the peer id the transport knows; rebuilding a `RemoteExecutor` from a descriptor
   * here would be this page re-deriving the one correlation `submit.ts` names
   * `missing-node-descriptor` when it goes wrong.
   *
   * **This tab is filtered out of its own answer, and that is a bound rather than a
   * formality.** A peer answers `providers` about itself alone, so the submitter should
   * never appear here — but a peer that answered otherwise would put this tab's own id into
   * a `RemoteExecutor`, and `rpcAdmission` already cost this repository four red e2e files
   * on 2026-08-16 by asking the transport to dial self. The tab is in the pool once, as
   * {@link BrowserNode.signingExecutor}, and that is the only way it may be in it.
   */
  readonly unnamed: readonly RemoteExecutor[]
  /**
   * One descriptor per qualified peer, keyed on the peer id its executor is addressed by.
   *
   * Keyed rather than listed because {@link attestedNodes} looks each executor up: the
   * qualified peers and the named ones are two overlapping sets, and a list would make the
   * overlap something the caller had to compute.
   */
  readonly descriptors: ReadonlyMap<string, NodeDescriptor>
}

/**
 * Who advertises the block this job will read, and hands over a capability record that
 * verifies — **SCHED-01, and this page is its first production caller.**
 *
 * ## Why this exists at all when {@link attestedNodes} was already asking peers questions
 *
 * `attestedNodes` asks each *already-chosen* peer for its records and stops there; its own
 * docblock says in as many words that *"it is **not** discovery … nothing in this function
 * changes who is asked to run anything"*. SCHED-01 is the other half of that sentence: the
 * requestor asks **who has the block**, and intersects that answer with the capability
 * records. Until this call site existed, `discoverCandidates` had exactly one production
 * caller in the repository — `bin/bench.ts:1541`, inside `if (DISCOVER)` — so no path a
 * person could run without typing a flag ever queried providers of a data CID. The owner
 * ruling of 2026-08-15 (`.planning/consults/2026-08-15-owner-ruling-off-by-default-flag.md`)
 * answered *"It must work with no flag"*, and named the demo page's Run button as the
 * method rather than the escape.
 *
 * ## What it changes about a dispatch, stated precisely so nothing more is read into it
 *
 * The descriptors this returns replace the placeholder ones **for the peers it qualifies
 * and for nobody else**. That matters on exactly one field: a discovered descriptor's
 * `ownerId` is `certificate.userKey`, the identity a provider signed, where
 * {@link attestedNodes} declares the literal `public` for everybody. `eligibleNodes` places
 * a sovereign shard only where the owner ids are **equal**, so a page whose descriptors all
 * say `public` can never place an owner-pinned shard anywhere — which is what
 * `demo-byo.e2e.test.ts`'s `[sovereign·unowned]` arm reads, and what this repairs.
 *
 * On a public shard it changes no placement, because `eligibleNodes` returns every node for
 * a public request. That is not a reason to run it only on the sovereign arm: a lookup that
 * ran on one surface and not the others would be a second thing able to disagree with the
 * first, and the page would place over two differently-derived pools depending on which
 * button was pressed.
 *
 * ## Two named absences, and neither is a failure
 *
 * **No certificate, so no anchor.** A tab nobody enrolled has pinned no issuer, and
 * verifying a peer's records against an empty issuer set is accepting a peer's word for a
 * peer's identity — the same argument {@link peerCertificate} makes at length. It answers
 * `asked: false` and the page falls back, rather than qualifying nobody and calling that a
 * result.
 *
 * **Nobody advertises the block yet.** A peer holds the module only once it has fetched it,
 * which happens the first time it executes. So the first dispatch of a cold fabric
 * qualifies nobody and the later ones qualify the peers that ran it — that is `providers`
 * behaving exactly as specified, not a defect, and {@link TabCandidateLookup.providers}
 * exists so a reader can tell the two apart instead of inferring it from an empty list.
 *
 * ## NET-06 — and this is the half that was missing until 2026-08-18
 *
 * SCHED-01 is answered by the paragraphs above: the page asks who holds the block, on no
 * flag, and the answer decides what each chosen peer's descriptor says. NET-06 asks
 * something the paragraphs above deny doing — that the answer decide **who is asked at
 * all**. Until this function returned {@link DiscoveredPool.unnamed} it did not: every
 * executor a job ran on came from `options.peerIds`, a caller-supplied array on the
 * {@link TabApi} contract, and the lookup's own `RemoteExecutor`s were built by
 * `discoverCandidates` and then thrown away by this page.
 *
 * They are not thrown away now. A peer this lookup qualified and the caller never named is
 * dispatched to on the strength of the index answer alone — which is a browser tier
 * *selecting* executors from a routing query, the one thing `bin/bench.ts --discover` could
 * do and no tab could. That is NET-06's asking half, on the same terms the backbone has it.
 */
async function discoveredPool(
  n: BrowserNode,
  peerIds: readonly string[],
  inputCid: CID,
): Promise<DiscoveredPool> {
  const none: DiscoveredPool = { unnamed: [], descriptors: new Map() }
  const held = n.certificate
  if (held === null) {
    lastCandidates = {
      asked: false,
      declined:
        'this tab holds no certificate, so it has pinned no issuer — a records answer checked ' +
        'against an empty issuer set is a peer vouching for itself',
      inputCid: inputCid.toString(),
      providers: 0,
      qualified: [],
      owners: [],
      excluded: [],
      undialable: [],
    }
    return none
  }

  let timer: ReturnType<typeof setTimeout> | undefined
  const found = await Promise.race([
    // Both arms land on the same named absence, exactly as `peerCertificate`'s race does:
    // the one thing a lookup that decorates a placement may never do is throw into a job.
    discoverCandidates(
      { inputCid },
      {
        rpc: n.rpc,
        // `verifiedPeers` and not `transport.peers` — `discover-candidates.ts`'s own
        // recommendation, and it is load-bearing here rather than cautious: a provider list
        // steers where work goes, so a peer that has not cleared verification does not get
        // to put an entry in one. A tab that pinned nobody never reaches this line.
        peers: () => n.verifiedPeers,
        // NET-06 / SCHED-01 — the tab's own composed asking index, which is the byte
        // identical composition `fabric-node.ts` builds. A tab differs from a backbone
        // node in what it can listen on, never in what it may ask.
        index: n.recordIndex,
        // The same anchor `peerCertificate` uses and for the same reason — this tab's own
        // issuer is the only key it holds that was not handed to it by the peer being
        // checked.
        trustedIssuers: new Set([held.issuer]),
        now: () => Date.now(),
        peerIdFor: peerIdForNodeKey,
        // AUTH-03's sentinel, matching every `RemoteExecutor` this page constructs. A
        // discovered candidate is dispatched to over the same unauthenticated layer as a
        // listed one; nothing here mints a chain, and claiming otherwise by passing a
        // supplier that produced none would be worse than saying so.
        dispatch: 'dispatches-unauthenticated',
      },
    ).catch(() => undefined),
    new Promise<undefined>((resolve) => {
      timer = setTimeout(() => resolve(undefined), CANDIDATES_DEADLINE_MS)
    }),
  ]).finally(() => {
    if (timer !== undefined) clearTimeout(timer)
  })

  if (found === undefined) {
    lastCandidates = {
      asked: true,
      declined: `no answer inside ${String(CANDIDATES_DEADLINE_MS)}ms`,
      inputCid: inputCid.toString(),
      providers: 0,
      qualified: [],
      owners: [],
      excluded: [],
      undialable: [],
    }
    return none
  }

  lastCandidates = {
    asked: true,
    declined: null,
    inputCid: inputCid.toString(),
    providers: found.providers,
    qualified: found.nodes.map((node) => node.nodeId),
    owners: found.nodes.map((node) => node.ownerId),
    // `detail` and not `reason`: the kernel already writes one line per exclusion *"fit to
    // show a human staring at an empty candidate list"*, and composing a second sentence
    // here would be this page disagreeing with the fabric about why somebody was dropped.
    excluded: found.excluded.map((one) => one.detail),
    undialable: [...found.undialable],
  }
  // Reported above as the lookup answered it and filtered below for the dispatch: the two
  // are different questions. `lastCandidates` says what the index returned, which is what a
  // reader checking the mechanism needs; `unnamed` says who this job gains because of it.
  const named = new Set(peerIds)
  return {
    unnamed: found.executors.filter(
      (one) => one.nodeId !== n.peerId && !named.has(one.nodeId),
    ),
    descriptors: new Map(found.nodes.map((node) => [node.nodeId, node])),
  }
}

/**
 * The candidate pool for a job this page composes, with signed statements where this tab
 * holds them — VER-09, VER-10.
 *
 * **The shape `publicNodes` produced, with one field answered instead of defaulted.**
 * `ownerId: 'public'`, `canExecuteSovereign: true` and `load: 0` are carried over
 * unchanged and deliberately: they are the placeholders that function documents as
 * harmless for an all-public pool, and moving either of them would change *placement* in a
 * plan whose subject is a label. `certificate` is the field that stops being a placeholder.
 *
 * **The asymmetry between the two arms is not one.** This tab reads its own certificate
 * out of memory and a peer's off the wire because that is where each one lives, not
 * because the two are different kinds of node. A peer asking *this* tab gets its answer
 * over the same request from the same server this tab just read from.
 */
async function attestedNodes(
  n: BrowserNode,
  executors: readonly { readonly nodeId: string }[],
  discovered: ReadonlyMap<string, NodeDescriptor>,
): Promise<readonly NodeDescriptor[]> {
  // SCHED-01/NET-06. **Handed in rather than looked up here, and the move is the point.**
  // This function ran the lookup itself until 2026-08-18, which meant the answer could only
  // ever reach a descriptor — by the time it existed, `executors` had already been decided.
  // The caller runs it now, *before* it composes the pool, so one lookup decides both who is
  // dispatched to and what is said about them. Two lookups would have been the alternative
  // and would have been worse than the gap: two answers taken a round trip apart can
  // disagree, and a peer in the pool with no descriptor is `missing-node-descriptor`.
  // Concurrently: one round trip per peer, and asking in sequence would pay their sum for
  // no benefit — `RpcRecordIndex.providers` gives the same reason for the same shape.
  return Promise.all(
    executors.map(async (executor) => {
      // **The discovered descriptor wins outright where there is one, and this is a
      // replacement rather than a merge on purpose.** Its four fields were derived together
      // from one certificate verified at one instant; taking `ownerId` from the lookup and
      // `certificate` from the fallback would produce a descriptor no single reading ever
      // supported, which is the shape `discover-candidates.ts` warns about when it explains
      // why `replicaSets` is computed at the moment of qualification rather than later.
      //
      // Keyed on `nodeId`, which is the **peer id** on both sides — `discoverCandidates`
      // builds its descriptors on the id the transport knows precisely so this comparison
      // is possible, and `submit.ts` names the alternative `missing-node-descriptor`.
      const found = discovered.get(executor.nodeId)
      if (found !== undefined) return found
      return {
        nodeId: executor.nodeId,
        ownerId: 'public',
        canExecuteSovereign: true,
        load: 0,
        // **AUTH-02 — what this tab's named absence will come to mean, and it does not mean
        // it yet.** Today a tab holding no certificate joins, is advertised and is dialled on
        // exactly the terms an enrolled one is; the absence costs it only a receipt a third
        // party could check, which is what the panel already reports in the kernel's own
        // words. Phase 24's ruling moves the decision to the relay reservation — where a
        // node's life in the fabric begins — and then this same absence becomes the reason a
        // tab is not let in. So: **this tab can enrol, and until it does it will not be
        // admitted.**
        //
        // A fact about what *this tab* was handed, never a kind of node. Enrolment stays open
        // precisely so a tab in this state can leave it, and the tab beside it that did enrol
        // is the same class with a different value in this field.
        //
        // **Nothing in this repository refuses anybody on this ground as of 2026-08-06.** Plan
        // 24-03 is the one that arms it; a reader meeting this before that lands is reading a
        // promise about the next plan, not a description of this one.
        certificate:
          executor.nodeId === n.peerId
            ? (n.certificate ?? 'carries-no-certificate')
            : await peerCertificate(n, executor.nodeId),
      }
    }),
  )
}

/**
 * Read the reduce's aggregate back out of the store, or `null` if there is nothing to read.
 *
 * **Fetched, never recomputed.** `ReduceOutcome` carries a `rootCid` and not a value, and the
 * temptation is to sum the partials locally — which would report a number this tab calculated
 * while claiming it came from the fabric. The block is read back through the same blockstore the
 * combine nodes wrote into, so what is displayed is what was aggregated.
 *
 * Every `null` arm is a real state rather than a swallowed error: no reduce attempted (a lone
 * visitor), a reduce whose combines all failed, a root that names no block, or an aggregate whose
 * shape is not the combiner's. The caller distinguishes them from the flags beside this value.
 *
 * **`key` is a parameter because two workloads now aggregate through this path.** π sums under
 * `PI_PARTIAL_KEY` and prime-counting under `PRIME_COUNT_KEY`, and `fabricCombiner` sums
 * `counts` key-wise — so the key *is* which workload's total this reads. It was hardcoded while
 * π was the only caller; a second copy of these thirty lines differing by one string is the
 * shape a divergence hides in.
 */
async function aggregateTotalFrom(
  reduced: Awaited<ReturnType<typeof reduceJob>>,
  store: Blockstore,
  key: string,
): Promise<number | null> {
  if (!reduced.ok || !reduced.outcome.ok || reduced.outcome.rootCid === null) return null
  // Dynamic, **following this file's existing convention** at the two `runJob` sites
  // (`main.ts` already reaches `CID` this way twice and holds no static import of it).
  //
  // A static import was written here first and reverted. The comment that replaced it claimed
  // the static form had been *measured* to slow the reachability instrument from ~6 s to ~250 s
  // — **that attribution was wrong and is corrected rather than deleted.** The slow readings
  // were taken while this host carried a load average of 175 from another workload, and the
  // process held 12% CPU (`user+sys / real` = 34.6 s / 286 s). That is a starved measurement,
  // not a slow one. The revert stands on the convention alone, which is reason enough.
  const { CID } = await import('multiformats/cid')
  const bytes = await store.get(CID.parse(reduced.outcome.rootCid))
  if (bytes === undefined) return null
  // `decodeCanonical` returns the value directly and throws on malformed input rather than
  // answering a result type, so the guard is a try rather than an `.ok` check.
  let value: CanonicalValue
  try {
    value = decodeCanonical(bytes)
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const counts = (value as { counts?: unknown }).counts
  if (typeof counts !== 'object' || counts === null || Array.isArray(counts)) return null
  const total = (counts as Record<string, unknown>)[key]
  return typeof total === 'number' ? total : null
}

const api: TabApi = {
  onChange(listener) {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },

  disclosure() {
    return DISCLOSURE
  },

  consentState() {
    return stateOf()
  },

  grantConsent(options = {}) {
    const reporting = options.reporting === true
    consent = grantConsent(store, { anchoredTo: DEMO_ANCHORS, reportingAllowed: reporting })
    if (!reporting) declinedLocally += 1
    // RUN-04's arming point — stage two, and the moment the held stage one is allowed to
    // leave. AFTER `grantConsent` returns, never before: the whole reason the pending default
    // is lawful under either reading of open question 3 is that a visitor who does not consent
    // is not counted, and a send one line earlier would be exactly that visitor being counted.
    armFunnel()
    notify()
    return stateOf()
  },

  async revokeConsent() {
    // Revoking stops the node. A permission withdrawn while work continues would
    // be a permission in name only.
    await api.stop()
    revokeConsent(store)
    consent = null
    notify()
    return stateOf()
  },

  async start(options) {
    // BROW-01 — **the return value is used, and that is the fix.** It is the same
    // `GrantedConsent` the gate rests on, so the node below is built from the record the
    // visitor actually answered rather than from module state that a later call could
    // have moved. `consent` above is assigned from the same read and is what the
    // *request* path consults; this is the one the node is constructed with.
    const granted = requireConsent()
    // RUN-04 — the OTHER way a visitor arrives at a granted consent. A returning visit reads a
    // stored consent and never calls `api.grantConsent`, so arming only there would make every
    // returning visitor invisible to the funnel while looking like a page-load drop-off — a
    // defect that reads as a finding. `arm()` and `enter()` are both once-only, so calling this
    // on the path that already armed sends nothing.
    armFunnel()
    // RUN-04 stage four. The observer itself was installed at the top of this file's import
    // graph — see the side-effect import — and this only registers where its answer goes.
    // Gathering that already happened is not lost: `onFirstIceGathering` fires immediately.
    onFirstIceGathering(() => {
      funnel.enter('ice-gathering')
    })
    // Probe before attempting, so a missing capability is a fact about this browser
    // rather than an inference from an error message.
    const environment = probeEnvironment()
    const gap = firstGap(environment)
    if (gap !== null) {
      noteOutcome(gap)
      throw new Error(`cannot start: ${gap}`)
    }

    // AUTH-02 — **the production pinning decision, and the only one on a visitor's path.**
    //
    // Read before `BrowserNode.start` because it has to be: the verifier's anchor set is
    // fixed inside `#compose` *before* the enrolment round trip that would produce an
    // anchor, so a tab enrolling for the first time cannot pin the provider it is in the
    // act of meeting. `enrolledIssuer` reads the certificate this origin stored on an
    // earlier start and returns the provider that signed it — a key this tab obtained by
    // its own enrolment, held before any peer spoke.
    //
    // **A fresh tab pins nobody, and that is the property that keeps this page working.**
    // Fail-closed on a first visit would empty the block source of the relay, which is a
    // fresh tab's only peer, and hand the visitor a node that connects and can fetch
    // nothing. So the sequence a visitor actually walks is: visit once and pin nobody
    // (unchanged from every build before 2026-08-14), enrol, and from the next start
    // onwards take blocks only from peers the same provider certified.
    //
    // Applied at `start` rather than at `autoStart` deliberately — `autoStart`, the `#join`
    // button and a direct `window.o2.start` all funnel through here, so there is one site
    // that decides this and no entry point that can skip it. It is **not** a parameter, for
    // the reason the two fields below it are not: a page that was found rather than
    // configured must not let whatever found it choose who this tab believes.
    const pinned = await enrolledIssuer(options.blockstoreName)

    // AUTH-03 — **whose sovereign work this device is a device of**, read back out of the
    // same stored certificate one line above, at the same site and under the same ordering
    // constraint. `enrolledUserKey` carries the argument; the two lines that matter here
    // are which fact this is and which it is not.
    //
    // It is **not** configuration. `TabApi.start` takes relays, a store name and anchors,
    // and grows no parameter for this, for the reason it grows none for `trustAnchors`: a
    // page that was found rather than configured must not let whatever found it declare
    // whose data this device will run. What reaches this field is this origin's own prior
    // enrolment, arriving from this origin's own storage.
    //
    // It is **not a widening of who may dispatch**, either. `canExecuteSovereign` decides
    // whether the executor's sovereignty guard will consider an owner-pinned task at all;
    // `authorizeCapability` — built from the same value, twenty lines into
    // `BrowserNode.start` — still demands a delegation chain rooted at this key and
    // addressed to this node. A visitor's key is minted `extractable: false`, so the only
    // parties who can produce such a chain are tabs of this same browser profile. That set
    // is exactly what `owner-domain` is a claim about: the owner's own machines.
    //
    // **The one-start delay is `enrolledIssuer`'s and is not a second one.** A first visit
    // enrols and is cleared for nobody, which is today's behaviour unchanged; from the next
    // start the tab is an owner node of its own owner. Before this line existed, every demo
    // tab published `sovereignFor: []` and declared `canExecuteSovereign: false` forever —
    // so an owner-pinned shard was *unplaceable on the owner's own device*, which is the
    // state `owner-domain-tabs.e2e.test.ts` measured before it measured this.
    const ownerKey = await enrolledUserKey(options.blockstoreName)

    // AUTH-01/02/04 — **the visitor's own enrolment decision, read from storage exactly as
    // the pinning above is.**
    //
    // Read before `BrowserNode.start` for the same reason and in the same shape: a stored
    // answer this origin already holds, consulted at the one funnel every entry point goes
    // through, and not a parameter.
    //
    // A caller-supplied `options.enrollment` wins. A harness naming its own key is running
    // its own arrangement, and silently substituting the visitor's would make its test prove
    // something other than what it says — the same argument `trustAnchors` makes above about
    // replacement rather than union.
    const chosen =
      options.enrollment === undefined ? readEnrolment(store) : ({ ok: false } as const)
    const visitorEnrolment = chosen.ok
      ? await visitorEnrolmentOption(chosen.enrolment.providerAddr)
      : null

    try {
      node = await BrowserNode.start({
        relayAddrs: options.relayAddrs,
        blockstoreName: options.blockstoreName,
        // Conditional spread, so a tab that has never enrolled passes no key at all rather
        // than an empty array. The two are the same to `PeerVerifier` — both are a set of
        // size zero — and different to a reader, who can see here that "pins nobody" is a
        // state this tab was found in and not a list that came back empty.
        ...(pinned === null ? {} : { trustedIssuers: [pinned] }),
        // Conditional spread for `trustedIssuers`' reason: a tab that has never enrolled
        // passes no `sovereignty` at all rather than a cleared-for-nobody record, so
        // `BrowserNode.start`'s own default is what applies and a reader can see that
        // "cleared for nobody" is a state this tab was found in rather than one this page
        // asked for. `ownerId` and `ownerKey` are the same hex key deliberately — see
        // `fabric-node.ts`'s note on why `sovereignFor` carries `certificate.userKey` and
        // never an opaque operator label.
        ...(ownerKey === null
          ? {}
          : { sovereignty: { ownerId: ownerKey, ownerKey, canExecuteSovereign: true } }),
        // DET-03/DATA-08: the build authorities this tab will run a module for. With no
        // `trustAnchors` supplied — which is every visitor, and `autoStart` — that is the
        // demo's own committed key, the same one `bin/agent.ts` and `bin/seed.ts` pin
        // when run with no flags, so a browser node and a Node one started by a visitor
        // answer the same dispatch the same way.
        //
        // A supplied list **replaces** this rather than joining it, and the replacement
        // is deliberate: a harness pinning its own key is running its own build, and
        // silently leaving the demo key pinned would make its test prove less than it
        // appears to. `two-tabs.e2e.test.ts` reads that property rather than restating
        // it — it dispatches the demo's own genuine record at a harness-pinned tab and
        // requires the refusal.
        //
        // There is no value passable through `window.o2` that turns the check off. The
        // parameter is a list of keys or nothing; see `TabApi.start`.
        trustAnchors: options.trustAnchors ?? [KERNEL_TRUST_ANCHOR],
        // BROW-01 — the visitor's own answer to `DISCLOSURE.reporting`, carried to the one
        // place that decides whether a row about this device is ever recorded. Written as
        // a ternary over the two named values rather than passed as a boolean, because the
        // option is a union whose members say what they do: a reader of this line does not
        // have to know which way round `true` means.
        //
        // **No `options` key for this and there must not be one.** `TabApi.start` takes
        // relays, a store name and anchors; a parameter here would let whatever called
        // `window.o2.start` — a harness, a discovered page, an embedding host — answer the
        // disclosure on the visitor's behalf, which is the whole of what BROW-01 forbids.
        // The same argument `trustAnchors` above makes about configuration, applied to the
        // one field where the answer is not the operator's to give.
        startReporting: granted.reportingAllowed
          ? 'reports-its-own-start'
          : 'withholds-its-own-start',
        // AUTH-01, and the reason is the visitor: this page is opened by somebody who did
        // not provision anything, so the first start has no seed and every later one may
        // have lost it to an eviction nobody was told about. Refusing to start would hand
        // that visitor a blank page for a fault they cannot act on.
        //
        // What it costs, written here rather than left implied: the tab comes back with a
        // **different peer id**, so peers holding its old address must rediscover it, and
        // a certificate stored beside the lost seed is refused by its own identity check
        // and would have to be re-issued. That is the right trade for a demo tab and it
        // is exactly the wrong one for a node whose name other people have pinned — which
        // is why this is a value here and not a default in the factory.
        whenSeedIsGone: 'mints-a-new-identity',
        rpcTimeoutMs: 60_000,
        // Conditional spread, so an omitted option is genuinely absent and the factory's
        // own default is what applies — passing `undefined` explicitly would override it.
        ...(options.maxConcurrentTasks === undefined
          ? {}
          : { maxConcurrentTasks: options.maxConcurrentTasks }),
        ...(options.dutyCycle === undefined ? {} : { dutyCycle: options.dutyCycle }),
        // AUTH-01 — straight through, with the `Uint8Array` rebuilt here because that is
        // the one place that knows both sides of the `page.evaluate` boundary. Playwright
        // serialises its arguments as JSON, so a typed array arrives as a plain
        // `{"0":…}` object and `ed25519.getPublicKey` would derive a key from nothing;
        // `capability-harness.ts` records the same conversion at the same seam.
        //
        // ## The standing objection, and why what follows does not violate it — 2026-08-17
        //
        // This comment read, and the sentence is quoted rather than deleted because the
        // rule in it is still in force:
        //
        // > **Nothing on a visitor's path supplies this.** `autoStart` passes no
        // > `enrollment` and grows no parameter for one, for the same reason it grows none
        // > for `trustAnchors`: A PAGE THAT WAS FOUND RATHER THAN CONFIGURED MUST NOT BE
        // > CONFIGURABLE BY WHATEVER FOUND IT.
        //
        // **The second half is untouched and is enforced below; the first half is now
        // false, and closing the gap between them is the whole of this change.**
        // `autoStart` still passes no `enrollment` and still has no parameter for one — go
        // and read it, and do not add one. What reaches this field on a visitor's path is
        // not configuration arriving from the origin; it is the visitor's own prior answer
        // arriving from this origin's storage, which is the identical move `enrolledIssuer`
        // makes twenty lines up and `requireConsent` makes at the top of this function.
        //
        // The objection is about **who decides**, and it is worth separating the three
        // inputs an enrolment needs, because they do not come from the same place:
        //
        //   - `providerAddr` — WHERE to knock. The origin may say this, and it is the only
        //     one it may say. It is an address and never an identity, it is published in
        //     `/bootstrap.json` for exactly the peers a gated relay has not yet admitted,
        //     and knowing it makes nobody enrollable. It is stored at the moment the
        //     visitor accepts it, and read back from *storage* here rather than from the
        //     origin — so an origin that later publishes a different provider cannot
        //     redirect a tab that already answered.
        //   - `userPrivateKey` — WHO this is. Minted in this browser by `visitor-key.ts`
        //     with `extractable: false`, and **the script this origin served cannot read
        //     it**; measured in chromium, firefox and webkit. There is no parameter,
        //     anywhere on this path, through which key material could be supplied.
        //   - `operatorId` — derived from that key. Not readable from `/bootstrap.json`
        //     even if it were published there, because nothing reads it from there.
        //
        // And the decision itself is `acceptEnrolment`, which takes **no arguments at all**.
        // An origin can cause this page to render an offer. It cannot cause the offer to be
        // accepted, cannot name the key, and cannot pre-answer the question — which is what
        // the objection asks for. Consent, not configuration.
        //
        // A tab that has answered nothing is unchanged in every respect: it is an ordinary
        // node whose receipts read the named absence, which is true.
        ...(options.enrollment === undefined
          ? visitorEnrolment === null
            ? {}
            : { enrollment: visitorEnrolment }
          : {
              enrollment: {
                userPrivateKey: new Uint8Array(options.enrollment.userPrivateKey),
                operatorId: options.enrollment.operatorId,
                providerAddr: options.enrollment.providerAddr,
              },
            }),
        // Aggressive so the throttle is unmistakable in a test rather than marginal.
        backgroundDutyCycle: 0.05,
        // Loopback relay: refused by libp2p's browser defaults, correct to allow here.
        allowPrivateAddrs: true,
        // BROW-04: tasks run on a thread that Stop can kill outright.
        createWorker: createTaskWorker,
      })
    } catch (error) {
      noteOutcome(classifyStartError(error, environment))
      throw error
    }
    noteOutcome(null)
    // Recorded from what this start actually did, not from what storage says now. The two
    // diverge the moment a visitor answers the offer while a node is already up, and that
    // interval is precisely what `appliedToRunningNode` has to report — a value re-derived
    // from storage could never see it.
    runningWithProvider =
      options.enrollment?.providerAddr ?? visitorEnrolment?.providerAddr ?? null
    // A peer dispatching work here changes what the surface must say, and the page
    // cannot poll for it — see `onActivity`.
    node.onActivity(notify)
    // RUN-04 stage three — the dial to the bootstrap peer completed.
    //
    // **Chosen by measurement rather than by plausibility, and the reason it is HERE.**
    // `BrowserNode.start` resolving is itself the evidence: a browser has no listening socket,
    // so it can only be on the fabric by way of a relay reservation, and a start that could not
    // reach one rejects with `no-relay-reachable` before this line. Reading a libp2p event
    // instead — `peer:connect` or `peer:identify` — would fire for peers reached later over
    // WebRTC as well, so it would report stage three for a visit that never dialled a bootstrap
    // node at all. The peer count is asserted rather than assumed for the same reason.
    if (node.transport.peers.length > 0) funnel.enter('wss-bootstrap')
    // BROW-07 — the tab strip starts saying whether this machine is working, and keeps
    // saying it while the visitor is looking at something else.
    beginComputingIndicator()
    notify()
    return node.peerId
  },

  async discoverRelays() {
    // Gated: reading `/bootstrap.json` is a network request, and nothing reaches
    // the network before consent.
    requireConsent()

    // 1. An explicit `?relay=` wins. This is what makes one bundle work on a static
    //    host: the page has no server to ask, so the address comes from the link.
    const fromQuery = new URLSearchParams(location.search).getAll('relay').filter((a) => a !== '')
    if (fromQuery.length > 0) return { source: 'query' as const, relayAddrs: fromQuery }

    // 2. Otherwise ask this page's own origin. Works when a seed node is serving the
    //    page — over `.local`, a raw IP, or localhost — without knowing which.
    //
    //    **Two locations, relative first.** The sentence here used to read *"Absolute: the
    //    seed mounts it at the root"* beside code that had already been changed to resolve
    //    against the document, and the two disagreed for three days. See
    //    {@link fetchBootstrapDocument}: a seed mounts it at the root, a static host and
    //    GitHub Pages carry it beside the page, and a bundle cannot know which served it.
    {
      const info = await fetchBootstrapDocument()
      if (info !== undefined) {
        const addrs = Array.isArray(info['relayAddrs'])
          ? info['relayAddrs'].filter((a): a is string => typeof a === 'string')
          : []
        if (addrs.length > 0) {
          // AUTH-01/04 — where to enrol, learned from the origin that served this page.
          //
          // **Discovery, and the distinction from configuration is the whole reason this is
          // one address.** A seed may publish where a joiner should knock; it may not publish
          // *who the joiner is*. `operatorId` and `userPrivateKey` are the visitor's and are
          // never read from here — which is why `autoStart` below still passes no `enrollment`
          // and must not grow a parameter for one.
          //
          // Narrowed rather than cast: `/bootstrap.json` is a network response, and a static
          // host answering with something else must not put a non-string on a dial path.
          return {
            source: 'origin' as const,
            relayAddrs: addrs,
            ...(typeof info['enrollmentProvider'] === 'string' && info['enrollmentProvider'] !== ''
              ? { enrollmentProvider: info['enrollmentProvider'] }
              : {}),
          }
        }
      }
    }

    // Neither location had one. A static host with no seed — a state, not a failure.
    return { source: 'none' as const, relayAddrs: [] }
  },

  async enrolmentOffer() {
    return offerOf()
  },

  async acceptEnrolment() {
    // The network read below and everything after it is gated, like every other path here.
    requireConsent()

    // Refusals by name, in the order a visitor would hit them, because somebody who pressed
    // a button is owed the reason it did not work rather than a page that quietly does
    // nothing. Each of these is a fact about this origin or this browser, not about them.
    if (!canHoldVisitorKey()) {
      throw new Error(
        'cannot enrol: this origin is not a secure context, so it cannot hold a key that ' +
          'this page is unable to read — enrolment is refused rather than done with a key ' +
          'the page could read',
      )
    }
    const { enrollmentProvider } = await api.discoverRelays()
    if (enrollmentProvider === undefined) {
      throw new Error(
        'cannot enrol: this origin published no enrolment provider, so there is nobody to ' +
          'enrol with',
      )
    }

    // The write, and the only one. Note what is **not** written: no key, and nothing derived
    // from one. The key stays in IndexedDB as a handle whose private half nothing reads, and
    // copying a stable identifier for this person into `localStorage` would hand it to every
    // script on this origin.
    acceptEnrolment(store, { providerAddr: enrollmentProvider })

    // Minted here rather than lazily at the next `start`, so a visitor who accepts on an
    // origin whose storage or crypto is about to refuse finds out now, while the surface is
    // still about enrolment, and not as a start failure later.
    await visitorKeyPair()

    notify()
    return offerOf()
  },

  async declineEnrolment() {
    // Stops first, for `revokeConsent`'s stated reason applied to this decision: a tab still
    // running with the certificate it obtained under a withdrawn decision has withdrawn
    // nothing.
    await api.stop()
    revokeEnrolment(store)
    // And the key, which is the part specific to this decision. The certificate is left
    // alone deliberately — it names a key that no longer exists here, so
    // `resolveCertificate`'s own identity check refuses it on the next start, and deleting
    // somebody else's signed statement is not this page's business.
    await forgetVisitorKey()
    notify()
    return offerOf()
  },

  async autoStart(options = {}) {
    const { source, relayAddrs } = await api.discoverRelays()
    if (source === 'none') {
      noteOutcome('no-relay-reachable')
      throw new Error(
        'no relay available: this page was not served by a seed node, and no ?relay= was given',
      )
    }
    // DET-03: **no `trustAnchors` key, deliberately, and this must not grow one.** By
    // passing none, a page reached by discovery inherits `api.start`'s own default — the
    // demo's committed build authority — and there is no parameter through which whatever
    // found the page could hand it a different one. A page that was found rather than
    // configured should not be configurable by whatever found it.
    const peerId = await api.start({
      relayAddrs,
      blockstoreName: options.blockstoreName ?? 'o2-blocks',
    })
    return { peerId, relayAddrs }
  },

  activity() {
    if (node === null) return null
    return {
      running: true,
      tasksExecuted: node.executor.executed,
      dutyCycle: node.executor.dutyCycle,
      hidden: node.governor.hidden,
      peers: node.transport.peers.length,
      servedFor: [...node.servedFor]
        .map(([peerId, tasks]) => ({ peerId, tasks }))
        .sort((a, b) => b.tasks - a.tasks || a.peerId.localeCompare(b.peerId)),
      fetched: node.blockstore.fetched,
      rejected: node.blockstore.rejected,
    }
  },

  async startReport() {
    const outcome = lastOutcome
    const allowed = consent?.reportingAllowed === true
    const running = node
    if (running === null) {
      // Nothing to ask through. The local outcome is still the whole of what this
      // visitor can contribute, and saying so is the honest answer.
      const { StartOutcomeLedger, describeStartReport } = await import('@o2/core')
      const ledger = new StartOutcomeLedger()
      if (outcome !== null) ledger.record(outcome)
      ledger.decline(declinedLocally)
      const report = ledger.report()
      return {
        reached: 0,
        asked: 0,
        text: describeStartReport(report),
        reported: report.reported,
        failed: report.failed,
        // One row at most, and it is this tab's own. Carried on the same field as the
        // merged arm below rather than omitted, so a caller reads one shape and can
        // tell the two apart by `asked` — which is the honest discriminator, because
        // "nobody was asked" and "everybody was asked and none answered" are different
        // findings and only the second is the cliff.
        byBrowser: report.byBrowser,
      }
    }

    const { describeStartReport } = await import('@o2/core')
    // Every connected peer's counts merged into a view that already holds this tab's
    // own row — BROW-02's cross-node reading. A peer answers out of a ledger it has
    // held since it started (`browser-node.ts` and `fabric-node.ts` each build one and
    // record their own row into it, on identical terms), so what comes back can name a
    // browser family this tab is not. There is no expression here that could produce
    // such a row, which is exactly why it is the reading criterion 5 rests on;
    // `peer-ledger.e2e.test.ts` takes it off the rendered element rather than off this
    // object, because the criterion says *viewed*.
    const result = await publishStartOutcome({
      rpc: running.rpc,
      peers: () => running.transport.peers,
      // Declining to report is not declining to see: a visitor who opted out still
      // asks, they simply tell nothing. Their own decline is counted here and never
      // transmitted, which is the only way an opt-out can mean what it says.
      outcome: allowed ? outcome : null,
      declinedLocally,
    })
    return {
      reached: result.reached,
      asked: result.asked,
      text: describeStartReport(result.report),
      reported: result.report.reported,
      failed: result.report.failed,
      // `StartReport.byBrowser` straight through. Not recomputed from `text`, not
      // re-sorted, and not filtered to the families this page recognises — a peer that
      // named a family this build has never heard of is a finding, and dropping it here
      // would delete the finding at the one place a person looks.
      byBrowser: result.report.byBrowser,
    }
  },

  /**
   * MR-03…MR-07 — the demo's **verified tree-reduce**, and the workload that can carry one.
   *
   * Audit findings G3 and G4 turned out to be one piece of work, and π is why. `runColouring`
   * merges with `answerOf`, a linear scan, and **that is correct for it**: a colouring job is
   * first-found-wins, so there is nothing to aggregate and a reduce over peers would be
   * ceremony. π is a sum — every shard contributes a scaled partial that must be added — so it
   * is the workload the fabric's combiner was built for. `pi.ts` says as much in its own words:
   * it exists to *"project a partial into the partial shape the fabric's one combiner accepts"*.
   *
   * So this closes both: the π workload gains a runnable path (G4), and the demo gains a merge
   * that is **verified rather than trusted** (G3).
   *
   * ## The two things this reports separately, because they answer different questions
   *
   * `reduceJob` documents on its own type that `ok` means only *a reduce could be attempted*.
   * A run where every combine failed is `{ok: true}` with `outcome.ok === false`, and
   * `bin/bench.ts` makes exactly this distinction at its own call site for exactly this reason.
   * Collapsing the two would let the page report an aggregation that never happened.
   *
   * ## A lone visitor cannot run it, and is told so rather than shown a blank panel
   *
   * `ReduceJobOptions.executors` is *"peer ids of the connected agents — the submitter is NOT
   * among them"*, and `reduce-job.ts` answers an empty set with
   * `{ok: false, reason: 'no executor to combine on'}`. That is the ordinary state of the first
   * tab to open the page. The reason is passed through verbatim: the honest statement is that
   * this claim needs a second device, not that the run failed.
   *
   * ## What the aggregate is checked against
   *
   * `estimatePi` converts the scaled total, and `piErrorBound` gives the remainder bound for the
   * term count — so the page compares a fabric-computed answer against a **published constant**
   * with a stated tolerance, rather than against itself. `pi.ts` records why that oracle is
   * necessary and not sufficient, and the shard-count invariance it does not replace.
   */
  async runPi(options) {
    const node = required()
    const started = performance.now()
    const terms = options.terms
    const input = buildPiInput(terms)
    const moduleCid = await node.store.put(piKernelBytes)
    // The same guard `runColouring` carries one module over: a rebuilt kernel that was not
    // re-signed produces a provenance refusal at dispatch, and this says so here instead.
    if (moduleCid.toString() !== PI_RECORD.cid.toString()) {
      throw new Error(
        `the bundled pi kernel hashes to ${moduleCid.toString()} but the committed record ` +
          `vouches for ${PI_RECORD.cid.toString()} — rebuilt without re-signing; run ` +
          '`npm run sign:kernel --workspace @o2/demo`',
      )
    }
    // NET-06 — awaited before the pool is composed, because what it answers is *who is in
    // it*. See `discoveredPool`; the same call supplies the descriptors below.
    const pool = await discoveredPool(node, options.peerIds, moduleCid)
    const executors = [
      node.signingExecutor,
      ...options.peerIds.map((id) => new RemoteExecutor(id, node.rpc, 'dispatches-unauthenticated')),
      // NET-06. The peers a routing query found and this caller never named. Appended
      // rather than substituted: a caller's list is still honoured in full, so this changes
      // nothing on a run where the index names nobody new and adds executors on one where
      // it does.
      ...pool.unnamed,
    ]
    const result = await submitJobWithEgress(
      {
        moduleCid,
        moduleRecord: PI_RECORD,
        shards: Array.from({ length: options.shards }, () => ({ value: input, label: 'public' as const })),
        executors,
        nodes: await attestedNodes(node, executors, pool.descriptors),
        redundancy: options.redundancy,
        onQuorumShortfall: 'runs-at-available-redundancy',
      },
      node.store,
      [node.egress],
      // CHURN-03 — **this site opted out until 2026-08-18 and no longer does.** The
      // sentence it passed the sentinel under is quoted rather than deleted, because the
      // owner's ruling is only legible against the argument it overturned: *"A π run is
      // one submit whose shards all name the same input block, so there is no partial
      // progress a resume could pick up. What `runColouring` has and this does not is a
      // ladder of rungs to be resumed *between*."* The first clause was the weak one and
      // said so — `submitJob` writes one checkpoint per **answered shard**, and a π run
      // has `options.shards` of them, so the partial progress it denied is exactly what
      // the sink records. The ladder distinction is real and is about the *read* half:
      // this page offers no `resumeFrom` here, so what a closed tab leaves behind is a
      // chain in IndexedDB that `bin/agent.ts --resume-from` or a second requestor holding
      // the CID can finish from — not a Run button that picks up where it left off.
      { checkpoints: checkpointsInto(node.store) },
    )
    if (!result.ok) throw new Error(`pi submit failed: ${JSON.stringify(result.error)}`)
    const manifest = result.manifests[0]
    if (manifest === undefined) throw new Error('unreachable: no manifest for the sole guard')

    // The map is done; this is the part `runColouring` has no counterpart for.
    const reduced = await reduceJob(result.job, {
      rpc: node.rpc,
      // The submitter is excluded by contract, so this is the peer set and not `executors`.
      executors: options.peerIds,
      // The tab's own store: it is what this node's `serveAgent` answers block requests from,
      // so it is where combine nodes fetch the leaves and where each combine's result returns.
      blockstore: node.store,
      project: projectPiPartial,
      redundancy: options.redundancy,
      // A visitor's tab pins no combine issuer, and saying so by name beats passing an empty
      // set that would silently refuse every combine. The page states this limit on screen.
      trustedIssuers: 'checks-no-combine-signatures',
      // MR-02 — every shard this π job submits is `label: 'public'`, so its partials are
      // the requestor's own and are attributed to nothing but their partition index. The
      // sentinel is that fact stated, not a default: reading an owner into a public job's
      // leaves would be a sovereignty claim about a page that made none. `reduceSovereignJob`
      // is where a leaf is keyed on an owner.
      contributors: 'attributes-each-shard-to-its-own-partition-index',
      // ── The owner's placement ruling, 2026-08-18, on the path an operator runs. ─────
      //
      // *"Always prefer local execution, unless it must be executed remotely … or the
      // current node is fully loaded."* This tab is the node, so it offers itself every
      // combine first and reaches for a peer only when one of the named conditions
      // refuses it. Both ports are **this tab's own**, not second copies: `node.admission`
      // is the `LocalCapacity` its `serveAgent` refuses a peer's combine on, and
      // `node.authorize` is the one authorizer it serves with. A tab admitting its own
      // work by a different rule would be more permissive to itself than to everybody
      // else.
      //
      // **What this costs is stated on screen and in the outcome, not hidden.** A combine
      // this tab performed is signed by nobody — `localDispatch` signs nothing on purpose,
      // because a signature this tab made would be it attesting to itself — so
      // `reduced.outcome.locallyCombined` names each one and `aggregateAttestation` comes
      // back as the named absence saying the aggregation was performed by the party that
      // wanted the answer. At `redundancy >= 2` a peer still answers the second replica,
      // so a local result that disagrees with a peer's still surfaces as a disagreement.
      placement: {
        kind: 'prefers-local-combining',
        capacity: node.admission,
        authorize: node.authorize,
      },
    })

    // The aggregate's VALUE, fetched rather than assumed. `ReduceOutcome` carries `rootCid`
    // and not the number — the combined block lives in the store like any other, and reading
    // it back through the same blockstore the combines wrote to is what makes this the
    // fabric's answer rather than a local recomputation.
    const scaled = await aggregateTotalFrom(reduced, node.store, PI_PARTIAL_KEY)
    return {
      terms,
      shards: options.shards,
      complete: result.job.complete,
      // `ok` and `outcome.ok` are distinct answers — see the docblock.
      reduceAttempted: reduced.ok,
      reduceReason: reduced.ok ? null : reduced.reason,
      combined: reduced.ok && reduced.outcome.ok,
      treeDepth: reduced.ok ? reduced.tree.depth : 0,
      combines: reduced.ok && reduced.outcome.ok ? reduced.outcome.combines : 0,
      estimate: scaled === null ? null : estimatePi(scaled),
      errorBound: piErrorBound(terms),
      elapsedMs: performance.now() - started,
      egress: manifest,
    }
  },

  /**
   * Count the primes at or below `n` across the fabric — audit finding **G4's open half, closed**.
   *
   * ## What was actually missing, because it was not the code
   *
   * `primes.wasm`, `buildPrimesInput`, `projectPrimeCount` and `readPrimeCount` have been in the
   * repository since Phase 26, and `primes-reduce.node.test.ts` runs the whole workload through
   * the real map and the real tree-reduce — agreeing with the tabulated π(x) at 10⁴, 10⁵ and 10⁶
   * over eight shards, and tiling `[2, N]` exactly at every shard count from one to eight.
   *
   * What was missing was a **signed record**. `guardModuleProvenance` refuses a module no pinned
   * anchor vouches for, and a tab pins exactly one anchor, so every executor — *including this
   * tab's own* — refused a prime-counting dispatch. The Primes surface therefore shipped under
   * UI-SPEC section 10's Option B: twelve regions, no run control, the reason on screen. Option A
   * meant re-signing all three demo records under a new anchor, because `sign-kernel.ts` discards
   * its private half the moment it signs. That was an owner decision and it was taken on
   * 2026-08-17.
   *
   * ## Why the fabric is checked against this and not only against π
   *
   * π(x) is an integer with a value published in the mathematical literature. The comparison is
   * an **equality**, not a tolerance, and the table was written long before this project — so
   * unlike `verifyColouring`, it cannot share a misconception with the thing it checks. That is
   * the one claim on this page whose authority does not come from this repository.
   *
   * Its blind spot is stated on the surface beside it rather than left for a reader to find:
   * published values are quoted at powers of ten, and a power of ten sits far from the prime
   * below it, so a guest that lost the top of its range would still return the right total. The
   * tiling proof in the Node suite is what closes that, and this method does not re-derive it.
   *
   * ## Structurally {@link runPi}, and deliberately so
   *
   * Same map, same `submitJobWithEgress`, same `reduceJob`, same sentinels and the same reasons
   * for each — a lone tab gets `reduceAttempted: false` with the fabric's own words, and the
   * aggregate is **fetched from the store** rather than summed here. The differences are three:
   * the input is eight bytes from `buildPrimesInput(n)` rather than a term count, the projection
   * is `projectPrimeCount`, and the total is read under `PRIME_COUNT_KEY`.
   */
  async runPrimes(options) {
    const node = required()
    const started = performance.now()
    const n = options.n
    // Throws a `RangeError` naming the bound and the limit if `n` is out of range — the guest
    // would refuse it anyway, and refusing here names the argument instead of producing a
    // shard failure a reader has to trace back to it.
    const input = buildPrimesInput(n)
    const moduleCid = await node.store.put(primesKernelBytes)
    // The same guard the other two workloads carry: a rebuilt kernel that was not re-signed
    // produces a provenance refusal at dispatch, and this says so here instead. It is the
    // check that would have fired every time before 2026-08-17, when no record existed at all.
    if (moduleCid.toString() !== PRIMES_RECORD.cid.toString()) {
      throw new Error(
        `the bundled primes kernel hashes to ${moduleCid.toString()} but the committed record ` +
          `vouches for ${PRIMES_RECORD.cid.toString()} — rebuilt without re-signing; run ` +
          '`npm run sign:kernel --workspace @o2/demo`',
      )
    }
    // NET-06 — as `runPi` above, and on every surface for that function's stated reason: a
    // lookup that ran on one Run button and not the others would place two differently
    // derived pools depending on which one a visitor pressed.
    const pool = await discoveredPool(node, options.peerIds, moduleCid)
    const executors = [
      node.signingExecutor,
      ...options.peerIds.map((id) => new RemoteExecutor(id, node.rpc, 'dispatches-unauthenticated')),
      // NET-06. See `runPi` above.
      ...pool.unnamed,
    ]
    const result = await submitJobWithEgress(
      {
        moduleCid,
        moduleRecord: PRIMES_RECORD,
        // One input block for every shard, content-addressed once. A shard differs only by what
        // `partition()` tells the guest, which costs nothing on the wire — the colouring job's
        // arrangement, reused rather than reinvented, and `primes.ts` says why in its header.
        shards: Array.from({ length: options.shards }, () => ({ value: input, label: 'public' as const })),
        executors,
        nodes: await attestedNodes(node, executors, pool.descriptors),
        redundancy: options.redundancy,
        onQuorumShortfall: 'runs-at-available-redundancy',
      },
      node.store,
      [node.egress],
      // CHURN-03 — **this site opted out until 2026-08-18 and no longer does**, on the
      // same owner ruling as `runPi`'s one screen up, and its superseded sentence is kept
      // for the same reason: *"A primes run is one submit whose shards all name the same
      // input block, so it either completes or is re-dispatched whole, and there is no
      // partial progress a resume could pick up."* That last clause was false of the
      // mechanism — a checkpoint is written per **answered shard**, not per submit — and
      // `options.shards` of them are answered here. As at `runPi`, only the write half is
      // wired: nothing on this page hands `resumeFrom` back, so a tab closed mid-run
      // leaves a chain another requestor can finish from rather than a resuming button.
      { checkpoints: checkpointsInto(node.store) },
    )
    if (!result.ok) throw new Error(`primes submit failed: ${JSON.stringify(result.error)}`)
    const manifest = result.manifests[0]
    if (manifest === undefined) throw new Error('unreachable: no manifest for the sole guard')

    const reduced = await reduceJob(result.job, {
      rpc: node.rpc,
      // The submitter is excluded by contract, so this is the peer set and not `executors`.
      executors: options.peerIds,
      blockstore: node.store,
      // `projectPrimeCount` **throws** on a shard the guest refused, rather than returning zero.
      // That is load-bearing here and not a style choice: a refusal summed into the aggregate is
      // indistinguishable from a sub-range that genuinely held no primes, and the total would be
      // quietly short by exactly the primes that shard was meant to count. Throwing routes it
      // into `reduceJob`'s per-shard handling and it becomes a named failure. `primes.ts` records
      // the reasoning at the function.
      project: projectPrimeCount,
      redundancy: options.redundancy,
      trustedIssuers: 'checks-no-combine-signatures',
      // MR-02 — every shard here is `label: 'public'`, so its partials are the requestor's own.
      contributors: 'attributes-each-shard-to-its-own-partition-index',
      // The placement ruling, on the same terms `runPi` states in full above: this tab
      // offers itself every combine and falls to the ranking only where a named condition
      // — its own capacity, its own authorizer — refuses it.
      placement: {
        kind: 'prefers-local-combining',
        capacity: node.admission,
        authorize: node.authorize,
      },
    })

    // The aggregate's VALUE, fetched rather than assumed — see `aggregateTotalFrom`.
    const total = await aggregateTotalFrom(reduced, node.store, PRIME_COUNT_KEY)

    // Each shard's own count, off this tab's shard results rather than out of the aggregate.
    // `null` on either of the two conditions that mean "no count": replicas that did not agree,
    // and a guest that refused the block — `readPrimeCount` throws for the latter rather than
    // returning a zero, and catching it here is what turns the throw into a named gap in the
    // row instead of a failed run. Deriving these from the total would make the surface's
    // per-shard table a decomposition of one number and its agreement with the total vacuous.
    const perShard = result.job.shards.map((shard) => {
      if (shard.verification.status !== 'agreed') return null
      try {
        return readPrimeCount(shard.verification.output)
      } catch {
        return null
      }
    })

    return {
      n,
      shards: options.shards,
      perShard,
      complete: result.job.complete,
      // `ok` and `outcome.ok` are distinct answers — the same distinction `runPi` documents.
      reduceAttempted: reduced.ok,
      reduceReason: reduced.ok ? null : reduced.reason,
      combined: reduced.ok && reduced.outcome.ok,
      treeDepth: reduced.ok ? reduced.tree.depth : 0,
      combines: reduced.ok && reduced.outcome.ok ? reduced.outcome.combines : 0,
      total,
      // Passthrough, unmodified, exactly as `runColouring` carries it: the page renders the
      // kernel's own sentence and composes none of its own, which is the only arrangement in
      // which the CLI and this page cannot come to describe one result differently.
      attestation: result.job.attestation,
      elapsedMs: performance.now() - started,
      egress: manifest,
    }
  },

  async runColouring(options) {
    const node = required()
    const started = performance.now()
    // One input block, shared by every cube. A shard is distinguished by
    // `partition()` alone, so the fabric moves work without moving data — and
    // every replica of a cube reads byte-identical input by construction.
    const input = buildInput(options.n, DEFAULT_BUDGET)
    const moduleCid = await node.store.put(kernelBytes)
    // DET-03/DATA-08. **This is not the drift detector, and saying so is the point.**
    // `packages/demo/src/kernel-build.node.test.ts` already compares `KERNEL_RECORD.cid`
    // against the CID of `kernel.wasm` read from disk, and against `kernelBytes` itself,
    // so a kernel rebuilt without re-signing goes red there long before any demo runs.
    //
    // What this adds is legibility for whoever skipped that test. Without it the drift
    // surfaces as every shard refused for a CID mismatch — which reads to a visitor as
    // "the fabric is broken" and to a developer as a wall of identical refusals. One
    // comparison turns that into one sentence naming the fix.
    //
    // **No test executes this branch.** Making the record and the bundled bytes disagree
    // means editing a generated file, and the generated file has its own detector. Stated
    // rather than left for a reader to discover.
    if (moduleCid.toString() !== KERNEL_RECORD.cid.toString()) {
      throw new Error(
        `the bundled kernel hashes to ${moduleCid.toString()} but the committed record vouches ` +
          `for ${KERNEL_RECORD.cid.toString()} — the kernel was rebuilt without re-signing; run ` +
          '`npm run sign:kernel --workspace @o2/demo`',
      )
    }

    // NET-06 — as `runPi`, and this is the surface the Run button reaches, so it is the one
    // an ordinary visitor gets it on.
    const pool = await discoveredPool(node, options.peerIds, moduleCid)
    const executors = [
      // VER-08/VER-09/VER-10 — `signingExecutor`, not `executor`, and the difference is
      // the whole of what a visitor is told about this run. Both names reach the same
      // worker, the same counter and the same governor; this one signs what comes back,
      // so this tab's own replica produces a statement `receiptFor` can check instead of
      // an unaccounted one that collapses the whole receipt to the named absence. See
      // `BrowserNode.signingExecutor` for why the field exists and what it does not do —
      // a tab nobody enrolled composes it too, and its receipt is unchanged.
      node.signingExecutor,
      // AUTH-03. The sentinel is the correct value here, permanently — not a stub
      // and not a thing to burn down. Every shard this job dispatches is
      // `label: 'public'` (below), a public task has no owner and therefore no root
      // key a chain could be rooted at, and `authorizeCapability`'s first precedence
      // step returns `null` for a public task in any case. The visitor whose tab this
      // is has no identity to mint from either.
      ...options.peerIds.map((id) => new RemoteExecutor(id, node.rpc, 'dispatches-unauthenticated')),
      // NET-06. See `runPi` above. The sentinel these carry is the same one, written down
      // at the lookup rather than here — `discoveredPool` passes it as
      // `CandidateOptions.dispatch`, so a discovered candidate reaches its executor over
      // exactly the layer a listed one does and nothing on this page mints a chain.
      ...pool.unnamed,
    ]
    // ── CHURN-03's READ half — closed here, and it has to happen BEFORE the submit ─────
    //
    // The write half landed on 2026-08-16 and the comment on `checkpoints:` below still
    // records what it could not do: *"there is no stable key under which the newest handle
    // could be left for a returning tab to find … discovering that CID unaided needs a
    // mutable key space this port does not have."* `../src/idb-checkpoints.ts` is that key
    // space, and these lines are the tab finding its own handle again.
    //
    // **The lookup key can only be the job id, and that is measured rather than chosen.**
    // `resumeState` refuses a handle whose checkpoint names a different job —
    // `checkpoint-names-another-job` — so a store keyed on anything looser hands back a
    // handle for the wrong job and `submitJob` answers `ok: false`, which the line below
    // turns into a thrown `submit failed` on a visitor's screen. That exact failure was
    // measured on 2026-08-18 in `bin/bench.ts`, where one handle was applied across a sweep
    // of differently-shaped jobs: every rung refused and the driver printed a benchmark over
    // nothing while exiting 0.
    //
    // So the id is derived here, from `@o2/core`'s own `jobIdOf`, before the call that will
    // derive it again internally — the one thing this page must not do is spell it its own
    // way. `submit.test.ts`'s *"a caller derives the id `submitJob` will derive"* case is
    // what holds the two together: it re-derives an id by exactly this recipe and compares it
    // against the one the written checkpoint block carries.
    const encodedInput = await canonicalCid(input)
    if (!encodedInput.ok) {
      throw new Error(
        `this run has no job id: the colouring input would not canonicalise — ` +
          JSON.stringify(encodedInput.error),
      )
    }
    // **One CID repeated, and that is the input this job actually has.** `shards` below is
    // `options.cubes` copies of the same `input` value, deliberately — a cube is distinguished
    // by `partition()` alone — so the ordered input CIDs `submitJob` canonicalises are this
    // one CID, `options.cubes` times. The count is in the id, which is correct: a four-cube
    // run and an eight-cube run partition the same data differently and are different jobs.
    const jobId = await jobIdOf(
      moduleCid,
      Array.from({ length: options.cubes }, () => encodedInput.cid),
    )
    const records = await checkpointsFor(node.store.inner.name)
    const offered = await records.newestHandleFor(jobId)
    // Dynamic, following this file's existing convention at the three other `CID` sites.
    const { CID } = await import('multiformats/cid')
    /** Why a stored handle was dropped, in `readCheckpoint`'s own vocabulary. */
    let refused: string | null = null
    let resumeFrom: CID[] | null = null
    if (offered !== null) {
      // **Read before it is offered to `submitJob`, and this is not belt-and-braces.**
      // `submitJob` answers `ok: false` with `checkpoint-unreadable` when the newest handle's
      // block is gone, and this page throws on `ok: false` — so a browser that evicted the
      // checkpoint block while keeping this pointer would have turned the Run button into a
      // permanent error. Browsers evict IndexedDB silently under storage pressure;
      // `idb-checkpoints.ts` says so against its own interest, and a resume that is worse
      // than starting over is not a resume. Checked through `readCheckpoint`, which is the
      // same validating reader `resumeState` uses, so a handle that passes here is a handle
      // that passes there.
      const handle = CID.parse(offered)
      const read = await readCheckpoint(handle, node.store)
      if (!read.ok) refused = read.failure.kind
      // **Unreachable by construction, and kept anyway.** The record was fetched *by* this
      // job id, so a checkpoint naming another job means the store handed back a row it was
      // not asked for. No test executes this branch — stated rather than left for a reader to
      // wonder — and it costs three lines to make the one refusal that breaks this page
      // impossible to reach from here rather than merely unlikely.
      else if (read.checkpoint.jobId !== jobId) refused = 'names-another-job'
      else resumeFrom = [handle]
      // Forgotten rather than left to be re-read next run: a pointer that failed to resolve
      // once will fail the same way again, and keeping it would spend a block read per run
      // forever to reach the same answer.
      if (refused !== null) await records.forget(jobId)
    }
    // Hoisted out of the options bag it used to be constructed inside, because the read half
    // needs it *after* the job as well: `newest()` is the newest handle this run confirmed,
    // and that is what the next run of this job will be offered.
    const written = checkpointsInto(node.store)
    // `submitJobWithEgress`, not bare `submitJob` — DATA-05/DATA-06's manifest,
    // sliced off `node.egress` (the guard `BrowserNode.start` already wraps this
    // tab's transport in), reachable from this call's own result rather than only
    // from a test harness that builds its own guard.
    const result = await submitJobWithEgress(
      {
        moduleCid,
        // DET-03/DATA-08: the visitor-facing job resolves its kernel through a signed
        // mapping, not through a bare CID. Every executor this reaches — this tab's own
        // and every peer's — checks it against its own pinned anchors before the bytes
        // are fetched, so the demo makes exactly the claim the rest of the fabric does.
        moduleRecord: KERNEL_RECORD,
        shards: Array.from({ length: options.cubes }, () => ({ value: input, label: 'public' as const })),
        executors,
        // VER-09/VER-10 — descriptors this page builds, carrying the certificates it can
        // account for. `publicNodes(executors)` stood here and answered
        // `'carries-no-certificate'` for every node unconditionally, which is what made
        // every receipt this demo has ever produced the named absence.
        nodes: await attestedNodes(node, executors, pool.descriptors),
        redundancy: options.redundancy,
        // VER-03/VER-04. A tab fabric is routinely one operator, and routinely behind
        // one relay — which is the topology this demo exists to show, not a degenerate
        // case of it. `'refuses-the-shard'` here would refuse every cube on exactly the
        // set of visitors the demo is for, and the page would render nothing on the
        // machine of anyone who opened it alone.
        //
        // So it degrades, and Plan 19-11 renders the weaker strength that comes back.
        // **That rendering is the demo being honest, not the demo being broken**: a
        // visitor sees a real answer next to a truthful statement of how well it was
        // checked, which is a stronger claim than a blank panel.
        onQuorumShortfall: 'runs-at-available-redundancy',
        // CHURN-04 — **the second production supplier of `admit`, and the first one an
        // ordinary visitor reaches.** `bin/bench.ts` supplies one too, but only behind
        // `--discover`, so on every run of anything an operator starts the lease-renewal
        // path was unreachable: `submit.ts` renews a lease *only* against evidence
        // obtained through this hook, and where it is absent there is no probe, so every
        // lease lapses on time.
        //
        // That default is wrong for exactly this run and right for `runPi`. A cube ladder
        // dispatches `options.cubes` shards across peer tabs over WebRTC, where a slow
        // executor and a departed one look identical from here — and a tab that went to a
        // background throttle is the *common* case, not the exceptional one. Without a
        // probe the fabric re-dispatches its work to somebody else and the original tab's
        // answer arrives to a shard already reassigned; with one, `rpcAdmission` offers
        // the same slot key back to the holder and reads the duplicate refusal
        // (`is already in flight here`) as positive evidence it is still running.
        //
        // `node.rpc` and not a second endpoint: this is the same `RpcEndpoint` the
        // `RemoteExecutor`s above dispatch over, so a peer that cannot be probed is a peer
        // that could not have been dispatched to either. **Not `bin/bench.ts`'s** — that
        // call site is left alone deliberately, because moving it off `--discover` would
        // change the placement algorithm of the published benchmark.
        // `local` is not optional in spirit here, only in the signature: this tab is in
        // the pool it places over, so without it every shard carried
        // `unreachable: … Can not dial self` against this tab's own id and a two-tab run
        // at `redundancy: 2` reached one replica. See `rpcAdmission`'s `LocalAdmission`.
        admit: rpcAdmission(node.rpc, { local: node.admission }),
      },
      node.store,
      [node.egress],
      {
        // CHURN-03 — **the write half, and this is the site that closes it.** Every
        // production submitter said `'checkpoints-nothing'` from 2026-08-05 until
        // 2026-08-16, so nothing an operator ran ever wrote a checkpoint block; the
        // comment that stood here said this tab is *"the one production store that
        // already outlives its process"* and then declined to use it. It is used now.
        //
        // **This run and not the other two.** `runColouring` is the multi-shard ladder —
        // it dispatches `options.cubes` shards and settles them one at a time, so partial
        // progress genuinely exists between the first answer and the last. `runPi` and the
        // sovereign run below are one submit each with nothing a resume could pick up, and
        // both still state the sentinel.
        //
        // **What the durability claim is, exactly.** `node.store` is an `IdbBlockstore`,
        // so a checkpoint block written here **survives the tab closing** — that is the
        // whole claim and it is deliberately not the word "durable". Browsers evict
        // IndexedDB silently under storage pressure; `idb-blockstore.ts` treats a missing
        // block as a normal condition rather than corruption, and `checkpointsInto`
        // reports an unconfirmed handle instead of throwing for that reason.
        // `navigator.storage.persist()` would exempt this origin from eviction under disk
        // pressure and would still not survive a visitor clearing site data, so it would
        // buy a stronger claim than "survives tab close" from nobody.
        //
        // **And what it is not.** A blockstore is content-addressed, so there is no stable
        // key under which the *newest* handle could be left for a returning tab to find.
        // The block is recoverable by anyone holding its CID; discovering that CID unaided
        // needs a mutable key space this port does not have. Said here rather than left
        // for a reader to assume the resume story is complete.
        //
        // **CORRECTED 2026-08-17, and the paragraph above is quoted rather than deleted
        // because this comment's argument runs through it.** The mutable key space now
        // exists — `../src/idb-checkpoints.ts`, one record per job id — and the block above
        // this call looks this job's newest handle up in it. What the paragraph says about
        // the *blockstore* is still exactly true: it is content-addressed and it holds no
        // such key. What was wrong was reading that as a statement about the port.
        checkpoints: written,
        // CHURN-03's read half, and `undefined` is not spelled here on purpose:
        // `exactOptionalPropertyTypes` makes an explicit `undefined` a different type from an
        // absent field, and `resumeState` distinguishes the two.
        ...(resumeFrom === null ? {} : { resumeFrom }),
      },
    )
    if (!result.ok) throw new Error(`submit failed: ${JSON.stringify(result.error)}`)
    // **Counted off the fabric's own report, never off `resumeFrom`.** The pointer says what
    // was *asked for*; `ending` says what was *carried*. A run where those two disagree is a
    // checkpoint that named fewer shards than the caller hoped, and reporting the request as
    // though it were the outcome is how a resume comes to be claimed and not performed.
    const carried = result.job.shards.filter(
      (shard) => shard.ending === 'carried-from-checkpoint',
    ).length
    // **Only ever a CONFIRMED handle**, which is `newest()`'s whole definition —
    // `checkpointsInto` keeps `confirmed` and `unconfirmed` apart precisely because an
    // unconfirmed handle did not read back out of the store, and filing one would leave the
    // next run a pointer that resolves to nothing.
    //
    // `null` leaves the previous pointer standing rather than clearing it, and that is the
    // right way round: a run that carried every cube dispatches nothing, so it records
    // nothing, so it confirms nothing — and the handle that made that possible is still the
    // best one this tab has.
    const confirmed = written.newest()
    if (confirmed !== null) await records.remember(jobId, confirmed.toString())
    // Exactly one guard was supplied above, so exactly one manifest comes back.
    const manifest = result.manifests[0]
    if (manifest === undefined) throw new Error('unreachable: no manifest for the sole guard')

    const statuses = result.job.shards.map((shard) =>
      shard.verification.status === 'agreed' ? readPartial(shard.verification.output).status : 'unagreed',
    )
    const bits = answerOf(result.job.shards)
    // Stored, not checked. The fabric's claim and the visitor's check are two
    // separate acts, and collapsing them would hide which one is being trusted.
    //
    // Kept when a run finds nothing, rather than cleared. The demo climbs a ladder
    // and stops at the first rung it cannot settle, so the *last* run is normally
    // the failed one — clearing here would throw away the best answer the fabric
    // reached at exactly the moment it finished reaching it.
    if (bits !== null) lastAnswer = { n: options.n, bits }
    notify()

    return {
      n: options.n,
      cubes: options.cubes,
      complete: result.job.complete,
      found: bits !== null,
      statuses,
      // Node ids, projected off the entries. `TabColouringRun.agreeing` is declared
      // `readonly string[][]` and stays that way: what a tab reports to a page is peer
      // ids, and the attestation each entry now carries is for a receipt, not a roster.
      agreeing: result.job.shards.map((shard) =>
        shard.verification.status === 'agreed'
          ? shard.verification.agreeing.map((replica) => replica.nodeId)
          : [],
      ),
      verificationMultiplier: result.job.verificationMultiplier,
      elapsedMs: performance.now() - started,
      egress: manifest,
      // `JobResult`'s own, passed through. Not recomputed from `redundancy`, not derived
      // from `agreeing.length`, and not turned into a sentence here — the page renders
      // `description`, which `attestationReceipt` filled from `describeAttestation`, so
      // this surface and the CLI have one source of the words and cannot come to describe
      // one result differently.
      attestation: result.job.attestation,
      // VER-03, VER-04 — the composer's verdict, which until now was computed on every
      // run of this page and thrown away.
      //
      // **Off the shards, never off `job.attestation`.** The receipt beside it carries a
      // `sharedRelay` field that looks like it answers VER-03 and does not: it is derived
      // from the certificates of whoever answered, so it reads the same on a fabric where
      // `composeQuorum` was never called. This value cannot — `not-attempted` names which
      // of the gate's three conditions failed, and the two refusal kinds are the composer's.
      //
      // Every cube above is `label: 'public'` and the composition is job-level, so all
      // shards carry the identical verdict; the first is not a sample. The fallback is for
      // a run that produced no shard at all, which is a truthful answer rather than a
      // default — nothing was submitted, so nothing was composed.
      quorum: result.job.shards[0]?.quorum ?? {
        kind: 'not-attempted',
        reason: 'this run produced no shard, so there was nothing to compose a quorum for',
      },
      // CHURN-03 — the four facts assembled above, in the order they were established:
      // the id this run derived, the pointer it found, why it dropped one if it did, how
      // many cubes the fabric says it carried, and what it left for the next run.
      resume: { jobId, offered, refused, carried, remembered: confirmed?.toString() ?? null },
    }
  },

  verifyAnswer() {
    const answer = lastAnswer
    if (answer === null) {
      return { checked: false, ok: false, n: 0, triplesChecked: 0, violation: null }
    }
    // `verifyColouring` enumerates its own triples from a² + b² = c². It is handed
    // the claim and nothing else — no triple list, no node's assurance.
    const verdict = verifyColouring(answer.n, answer.bits)
    return verdict.ok
      ? { checked: true, ok: true, n: verdict.n, triplesChecked: verdict.triplesChecked, violation: null }
      : {
          checked: true,
          ok: false,
          n: verdict.n,
          triplesChecked: 0,
          violation: `${verdict.violation.a}² + ${verdict.violation.b}² = ${verdict.violation.c}²`,
        }
  },

  connectDiscoveredPeers() {
    // A round already running is the round this caller wants. The page polls on a
    // timer, the e2e harness calls this directly, and an embedder will too — two
    // rounds at once dial the same candidates twice, and the second finishes into a
    // page that has already moved on.
    discoveryRound ??= runDiscoveryRound().finally(() => {
      discoveryRound = null
    })
    return discoveryRound
  },

  async computePeers() {
    const n = required()
    const connected = [...n.transport.peers]
    // Asked, not classified. An offer is the cheapest request that proves a peer
    // speaks the agent protocol at all, and its refusal is as good an answer as its
    // acceptance — either way somebody replied.
    //
    // **The catch collapses two different peers into one answer, and only one of them
    // is cheap.** A peer that does not handle the protocol fails multistream
    // negotiation immediately, so it costs no timeout — that is the case the reasoning
    // above was written for. A peer that *does* speak it but is wedged burns this
    // demo's full `rpcTimeoutMs` (60 s, set where this page constructs its node) and is then
    // dropped from the tally exactly as though it had never spoken.
    //
    // Swallowed deliberately rather than reported: this is a display count on a demo
    // page, a wedged peer is indistinguishable from a departed one from here, and the
    // honest rendering of both is "not counted". What it must not do is claim the round
    // was cheap in the wedged case, which is why the timeout is named here — a
    // `computePeers()` that takes a minute is this branch, not a hung page.
    const answers = await Promise.all(
      connected.map(async (peer) => {
        try {
          const body = await n.rpc.request(peer, encodeRequest({ kind: 'offer', shardId: 'probe' }))
          return parseResponse(body)?.kind === 'offer' ? peer : null
        } catch {
          // Refusal, timeout, or a peer that vanished mid-request — all three mean the
          // same thing to a peer count, and none of them is this page's to report.
          return null
        }
      }),
    )
    return answers.filter((peer): peer is string => peer !== null)
  },

  lastCandidates() {
    // Returned as held. Every field is already a scalar or a fresh array this module built
    // and nothing else retains, so there is no copy to defend — and a `structuredClone`
    // here would be ceremony that hid that fact rather than establishing it.
    return lastCandidates
  },

  addresses() {
    const n = required()
    return { peerId: n.peerId, webrtc: [...n.webrtcAddrs], circuit: [...n.circuitAddrs] }
  },

  async waitForWebrtcAddr(timeoutMs) {
    const n = required()
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (n.webrtcAddrs.length > 0) return [...n.webrtcAddrs]
      await new Promise((r) => setTimeout(r, 100))
    }
    throw new Error(`no /webrtc address after ${timeoutMs}ms; addrs=${JSON.stringify(n.multiaddrs)}`)
  },

  async dial(address) {
    return required().dial(address)
  },

  peers() {
    return [...required().transport.peers]
  },

  heldPeers(): TabHeldPeer[] {
    return required().heldPeers.map((held) => ({ ...held }))
  },

  connectionsTo(peerId) {
    const { peerIdFromString } = pid
    return required()
      .libp2p.getConnections(peerIdFromString(peerId))
      .map((connection) => ({
        remoteAddr: connection.remoteAddr.toString(),
        limited: connection.limits !== undefined,
      }))
  },

  setDutyCycle(value: number) {
    // Straight through to the node, so the `RangeError` a page sees is the governor's own
    // and the binary, the tab and the class cannot disagree about which values exist.
    required().setDutyCycle(value)
  },

  capacity() {
    const node = required()
    return {
      dutyCycle: node.dutyCycle,
      slots: node.admission.slots,
    }
  },

  governor() {
    const g = required().governor
    return {
      hidden: g.hidden,
      dutyCycle: g.dutyCycle,
      transitions: g.transitions,
      sleptMs: g.sleptMs,
    }
  },

  isolation() {
    return {
      crossOriginIsolated: globalThis.crossOriginIsolated,
      hasSharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
      inIframe: window.self !== window.top,
    }
  },

  simulateHidden(hidden) {
    // Shadow the read-only getters on this document instance, then fire the genuine
    // event. The governor's listener, the duty cycle, and the execution path are all
    // untouched by this — only the browser's own signal is stood in for.
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => (hidden ? 'hidden' : 'visible'),
    })
    document.dispatchEvent(new Event('visibilitychange'))
  },

  async storedBlocks() {
    return required().store.inner.refresh()
  },

  async hasBlock(cid) {
    const { CID } = await import('multiformats/cid')
    return required().store.has(CID.parse(cid))
  },

  async putModule(bytes) {
    const cid = await required().store.put(new Uint8Array(bytes))
    return cid.toString()
  },

  /**
   * AOT-05 wired — the one production caller of `streaming-load.ts`.
   *
   * The decisions live in `../src/gateway-module.ts` so they can be driven with no DOM and
   * no network by `gateway-module.node.test.ts`; what is here is the part that genuinely
   * needs a running tab, which is the blockstore put.
   *
   * **The store is the second CID check and it is not decoration.** `IdbBlockstore.put`
   * hashes what it is given and returns the CID it computed, so a byte that changed between
   * `loadArtifact`'s digest comparison and this line produces a different address and the
   * dispatch — which names the record's CID — would find nothing there. Comparing the two
   * turns that from a `module block missing` several seconds later into a sentence naming
   * what happened. It has no known way to fire, and it is three lines.
   *
   * ## The order of the three steps is BROW-06, and it was the wrong way round
   *
   * This function opened with `required()` until 2026-09-02, so a tab that had not started
   * threw `node not started` and a tab that had started must already have consented — which
   * looks like a gate and is not one. It made the criterion **untestable**: with the fetch
   * unreachable in the un-consented state, no network log could distinguish a consent gate
   * from a node-state gate, and removing the consent check would have changed nothing an
   * instrument could see. That is the shape of a proof that cannot fail.
   *
   * So the order is now: **consent, then fetch, then `required()` for the put.** `required()`
   * still gates the blockstore write, which genuinely needs a node; it no longer stands in
   * front of the network, which needs only a visitor's agreement.
   *
   * **`readConsent` and not `requireConsent()`, deliberately.** `requireConsent()` throws,
   * and a throw here would put the refusal back in front of the fetch at a *different* call
   * site — the same defect one line up. The gap is passed down instead, and
   * `fetchModuleForDispatch` is the single place that turns it into a refusal.
   */
  async fetchModule(options) {
    const found = readConsent(store, DEMO_ANCHORS)
    const outcome = await fetchModuleForDispatch({
      consent: found.ok ? found.consent : found.gap,
      gatewayBase: options.gatewayBase,
      moduleCid: options.moduleCid,
      recordCid: options.recordCid,
      recordName: options.recordName,
    })
    if (!outcome.ok) return outcome

    const n = required()
    const stored = await n.store.put(outcome.content)
    if (stored.toString() !== outcome.cid) {
      return {
        ok: false,
        reason:
          `the verified bytes were stored as ${stored.toString()} rather than ${outcome.cid}, so ` +
          'a dispatch naming the record’s cid would not find them — nothing was dispatched.',
      }
    }

    return {
      ok: true,
      cid: outcome.cid,
      bytes: outcome.bytes,
      url: outcome.url,
      cacheEligible: outcome.cacheEligible,
      compileMs: outcome.compileMs,
    }
  },

  async runJob(options) {
    const n = required()
    const { CID } = await import('multiformats/cid')
    // Bound once rather than parsed twice: SCHED-01's lookup asks who provides **this**
    // module, and a second `CID.parse` of the same string would be a second value able to
    // disagree with the one the dispatch names.
    //
    // **Hoisted above the executor list on 2026-08-18, and the move is NET-06's whole cost
    // on this surface.** It was declared beside `shards` below while the lookup only ever
    // produced descriptors; now the lookup also decides who is in the pool, so the pool
    // cannot be built before the module it is looked up against exists.
    const moduleCid = CID.parse(options.moduleCid)
    // NET-06 — as `runPi`. This surface is the bring-your-own form, so the module a
    // visitor names is what `providers` is asked about.
    const pool = await discoveredPool(n, options.peerIds, moduleCid)
    // AUTH-03 — minted here rather than inside a supplier, because signing is asynchronous
    // and `CapabilitySupplier` is not. Over BOTH populations: a discovered candidate is
    // dispatched to on the same terms as a listed one, and giving one a chain and the other
    // none would make the sovereign arm's outcome depend on where the executor came from.
    const chainFor = await sovereignChainsFor(n, options.sovereign, [
      ...options.peerIds,
      ...pool.unnamed.map((executor) => executor.nodeId),
    ])
    const executors = [
      // This tab contributes its own compute when asked. With two tabs that is
      // what makes R=2 possible: one tab submits *and* executes, the other
      // executes, and the two must agree.
      //
      // `signingExecutor` for `runColouring`'s reason: an in-process dispatch through the
      // unsigned layer left this tab's own replica unaccounted, so a self-included job
      // reported the named absence however well it had actually gone.
      ...(options.includeSelf === true ? [n.signingExecutor] : []),
      // AUTH-03. **The reason here is NOT `runColouring`'s, and this comment said it was
      // until 2026-08-14.** It read *"every shard below is `label: 'public'`, so there is
      // no owner, no root key, and nothing for a chain to say"* — which is true of
      // `runColouring` and false of this function, thirty lines below which a
      // `label: 'sovereign'` arm is built from the BYO form's own checkbox. Another
      // sentence that was true when written and was not re-read when the code under it
      // grew an arm.
      //
      // The correct reason is placement, and it is measured rather than argued.
      // `attestedNodes` declares `ownerId: 'public'` on every descriptor this page builds,
      // and `eligibleNodes` places a sovereign shard only on a node whose `ownerId`
      // **equals** the shard's — so every sovereign dispatch from this surface is
      // unplaceable and no remote executor is ever handed one.
      // `demo-byo.e2e.test.ts`'s `[sovereign·unowned]` arm reads exactly that: nothing
      // placed, nothing agreed, zero frames, zero bytes.
      //
      // **So this is a bound, not a proof, and the bound has a named edge.** A visitor who
      // types the literal `public` into the owner-id box makes every peer eligible for a
      // sovereign shard dispatched with no chain — `demo-byo.e2e.test.ts` names that
      // literal `OWNER_THE_NODES_DECLARE` and asserts it is still there precisely so this
      // arm reddens the day a tab is handed a real owner identity. Wire a chain here
      // *before* that day, not after it.
      ...options.peerIds.map(
        (id) => new RemoteExecutor(id, n.rpc, chainFor?.(id) ?? 'dispatches-unauthenticated'),
      ),
      // NET-06. See `runPi` above. **Rebuilt rather than passed through, as of the day the
      // chain was wired**: `discoverCandidates` was handed the unauthenticated sentinel, so
      // the executors it returned carry it. Same id, same rpc, same descriptor correlation —
      // only the capability differs, and it has to, or a sovereign shard would be authorised
      // on a listed peer and refused on a discovered one for no reason a reader could find.
      ...pool.unnamed.map(
        (executor) =>
          new RemoteExecutor(
            executor.nodeId,
            n.rpc,
            chainFor?.(executor.nodeId) ?? 'dispatches-unauthenticated',
          ),
      ),
    ]
    // DET-03/DATA-08. Rebuilt field by field rather than spread, and that is not style:
    // this object arrived through structured cloning from whatever called
    // `page.evaluate`, so its shape is whatever the harness sent and a spread would carry
    // every extra property straight into a signed-payload comparison. Only `cid` changes
    // form — it crossed as a string because a `CID` instance does not survive the clone;
    // see `TabNameRecord`.
    const moduleRecord = {
      name: options.moduleRecord.name,
      cid: CID.parse(options.moduleRecord.cid),
      version: options.moduleRecord.version,
      expiresAt: options.moduleRecord.expiresAt,
      signer: options.moduleRecord.signer,
      signature: options.moduleRecord.signature,
      // Task #4. Named field by field for the SAME reason the five above are — a spread would
      // carry whatever the harness attached — and present only when the sender sent one, so a
      // record signed directly by an anchor still hashes exactly as it did before delegations
      // existed. Its absence here is what turned every demo dispatch into `untrusted-signer`
      // the first time the demo records became delegated: this list must name every field
      // `payloadOf` hashes, and it named six of eight.
      ...(options.moduleRecord.delegation === undefined
        ? {}
        : {
            delegation: {
              root: options.moduleRecord.delegation.root,
              delegate: options.moduleRecord.delegation.delegate,
              expiresAt: options.moduleRecord.delegation.expiresAt,
              signature: options.moduleRecord.delegation.signature,
            },
          }),
    }
    // DATA-10, WIRE-03 — the shard label is the caller's, defaulting to public.
    //
    // **A page may submit owner-pinned data, and the reason is not a concession.**
    // Sovereignty is a property of the data and of whose it is, never of what kind of node
    // holds it. A tab is the owner's own device, which makes it the least surprising place
    // in this fabric for owner-pinned data to live rather than a privileged one. The
    // hardcoded `label: 'public' as const` that stood here was not a decision anybody took
    // about tabs — it was the only shape the surface above could express.
    //
    // Rebuilt per shard rather than spread, so the `sovereign` arm carries an `ownerId`
    // that `TabApi.runJob` already made inseparable from the label. `submitJob` refuses a
    // sovereign shard with no owner by name (`shard-missing-owner`), and this expression
    // has no way to produce one.
    const shards = Array.from({ length: options.shards }, (_unused, i) =>
      options.sovereign === undefined
        ? { value: { a: i }, label: 'public' as const }
        : { value: { a: i }, label: 'sovereign' as const, ownerId: options.sovereign.ownerId },
    )
    // `submitJobWithEgress`, not bare `submitJob` — see `runColouring` above for why.
    const result = await submitJobWithEgress(
      {
        moduleCid,
        moduleRecord,
        shards,
        executors,
        // As `runColouring` above — see that call site for what replaced `publicNodes`
        // here and why. SCHED-01's lookup rides inside it, keyed on the module this form
        // named — which on this surface is the field that makes the sovereign arm placeable.
        nodes: await attestedNodes(n, executors, pool.descriptors),
        redundancy: options.redundancy,
        // VER-03/VER-04 — the same choice and the same reason as `runColouring` above:
        // a tab fabric that refused every shard it could not independently verify would
        // show nothing on the topology this page is for.
        onQuorumShortfall: 'runs-at-available-redundancy',
      },
      n.store,
      [n.egress],
      // DATA-10's at-rest half, and **this is an addition rather than a duplicate — the
      // page's submit path did not supply it, checked before adding it.** Two registrations
      // that could disagree would be worse than the gap, so: `submitJobWithEgress` takes a
      // *job-scoped* hold on every sovereign shard's bytes and gives it back in a `finally`
      // (the third argument above), which is the payload-scanning guard and is a different
      // mechanism with a different lifetime. This fourth argument passes straight through
      // to `submitJob`, which records the CID at the **blockstore-put** — the line that
      // makes this tab hold the row — on a set that outlives the job and the page. Without
      // it a tab that submitted an owner's row served it to the next peer that asked, which
      // is exactly what `tab-refusals.e2e.test.ts` read before this line existed.
      //
      // `runColouring` above deliberately does not get this: every cube it submits is
      // `label: 'public'`, so there is nothing for the set to record and handing it one
      // would suggest otherwise.
      {
        sovereignCids: n.sovereignCids,
        // CHURN-03 — stated, not defaulted. **This comment read *"as `runColouring` above,
        // and for the same reason … the only one of the five where the new field cost a line
        // rather than an argument"* until 2026-08-18, and both halves had gone stale.**
        // `runColouring` passes a real `checkpointsInto(node.store)` sink since 2026-08-16,
        // so pointing at it points at the opposite decision; and there are nine production
        // submit sites now, not five. Quoted rather than deleted because a reader tracing
        // why this site was ever grouped with `runColouring` needs to find the sentence
        // that grouped them.
        //
        // **It then read *"The reason that does hold is `runPi`'s, one screen up: one
        // submit, no ladder of rungs to be resumed between"* — for a few hours of the same
        // day.** The owner ruled later on 2026-08-18 that `runPi` and `runPrimes` keep
        // checkpoints, so that borrowed reason went with them and this site is the last
        // sentinel on the page. It is left as an opt-out **whose stated reason has been
        // withdrawn**, which is worth more than a replacement reason invented to fill the
        // gap: the ruling covered two sites and did not cover this one.
        //
        // What has to be answered before it moves is specific and is not about the
        // workload's shape. A checkpoint record is a block written into `node.store` — the
        // same store `serveAgent` answers peers' block requests from — and it **names**
        // each shard's result CID rather than carrying it. `sovereignCids` above is the set
        // this tab refuses to serve. Whether a servable block naming sovereign result CIDs
        // is inside or outside that refusal is **unmeasured**, and stating it as unmeasured
        // is the whole of this comment's claim.
        checkpoints: 'checkpoints-nothing',
      },
    )
    if (!result.ok) throw new Error(`submit failed: ${JSON.stringify(result.error)}`)
    // Exactly one guard was supplied above, so exactly one manifest comes back.
    const manifest = result.manifests[0]
    if (manifest === undefined) throw new Error('unreachable: no manifest for the sole guard')

    return {
      complete: result.job.complete,
      partitions: result.job.shards.map((s) =>
        s.verification.status === 'agreed' ? partitionOf(s.verification.output) : -1,
      ),
      // Node ids, as above. `TabJobReport.agreeing` is unchanged.
      agreeing: result.job.shards.map((s) =>
        s.verification.status === 'agreed' ? s.verification.agreeing.map((replica) => replica.nodeId) : [],
      ),
      replicas: result.job.shards.map((s) =>
        s.verification.status === 'agreed' ? s.verification.replicas : 0,
      ),
      verificationMultiplier: result.job.verificationMultiplier,
      fetched: n.blockstore.fetched,
      rejected: n.blockstore.rejected,
      egress: manifest,
      // Why the shards that did not agree did not agree, flattened across all of them.
      // Nothing is computed: `VerificationResult` already carries these entries on both
      // its `disagreed` and `insufficient` arms.
      //
      // A harness reading only `complete` cannot tell a provenance refusal from a relay
      // that dropped, and the browser tier's whole refusal proof rests on that
      // distinction — `two-tabs.e2e.test.ts` reads the resolver's own wording out of
      // here rather than inferring it from a boolean that a flaky run also produces.
      failures: result.job.shards.flatMap((s) =>
        s.verification.status === 'agreed' ? [] : [...s.verification.failures],
      ),
      // `JobResult`'s own, as in `runColouring` above.
      attestation: result.job.attestation,
    }
  },

  async stop() {
    // BROW-07, first and before the await: a tick that fired part-way through `node.stop()`
    // would read a node that is being dismantled, and the tab strip would go on claiming to
    // be computing for as long as the teardown took.
    endComputingIndicator()
    // RUN-04 — the ICE wrapper does NOT come off, and that is deliberate. It is installed at
    // module evaluation because `@libp2p/webrtc` captures the constructor at its own, so a
    // remove-on-stop would leave a restarted tab permanently unobservable: the capture has
    // already happened and cannot happen again. The wrapper is a transparent subclass that
    // delegates and reports once per visit, so leaving it costs the tab nothing.
    funnelSawFirstTask = false
    if (node !== null) await node.stop()
    node = null
    // Back to "the question does not arise". A stopped tab cannot be out of step with a
    // decision, and leaving the last run's value here would make `appliedToRunningNode`
    // answer about a node that no longer exists.
    runningWithProvider = undefined
    // Defect 32: the upgrade budget is about connections this node held. A restarted
    // tab has none of them, so carrying the counts across would let a fresh run inherit
    // a verdict — "given up on this peer" — that nothing in it justifies.
    planner = new DialPlanner()
    // SCHED-01, and the same argument one line up: a candidate lookup names peer ids and
    // owner keys of a fabric this tab is no longer in. Reported as "no lookup has run"
    // rather than kept, because a stale one would be answered to a caller asking what the
    // *next* run will place over.
    lastCandidates = null
    notify()
  },
}

window.o2 = api

/**
 * RUN-04's terminal report — where this visit stopped.
 *
 * `pagehide` rather than `beforeunload` or `unload`: it is the one event that fires on a
 * bfcache eviction and on mobile Safari, where `unload` frequently does not, and a funnel that
 * missed those would under-report exactly the population it exists to measure. The send is a
 * beacon for the same reason — see `funnel-reporter.ts`.
 *
 * `FunnelReporter.stalled` is once-only and sends nothing for a visit that reached the last
 * stage, so a `pagehide` that fires twice, or one that fires after a completed visit, costs
 * nothing.
 */
window.addEventListener('pagehide', () => {
  funnel.stalled()
})
