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
 * `readConsent(store)`, which mints one of its own from a record already on disk
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

import { checkpointsInto, decodeCanonical, verifyCertificate } from '@o2/core'
import type {
  Blockstore,
  CanonicalValue,
  NodeCertificate,
  NodeDescriptor,
  StartFailure,
  StartOutcome,
} from '@o2/core'
import { nodeKeyForPeerId } from '@o2/libp2p'
import {
  RemoteExecutor,
  RpcRecordIndex,
  encodeRequest,
  findReservedPeers,
  parseResponse,
  publishStartOutcome,
  reduceJob,
  rpcAdmission,
  submitJobWithEgress,
} from '@o2/net'
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
  classifyStartError,
  currentBrowserLabel,
  enrolledIssuer,
  firstGap,
  grantConsent,
  pageConsentStore,
  probeEnvironment,
  readConsent,
  revokeConsent,
} from '@o2/browser'
import type {
  GrantedConsent,
  TabApi,
  TabConsentState,
  TabDiscoveryRound,
  TabHeldPeer,
} from '@o2/browser'
import { createTaskWorker } from '../src/worker-factory.ts'
import { DialPlanner } from '../src/dial-plan.ts'
// AOT-05's last mile. Relative, not through the barrel — see the module's own header.
import { fetchModuleForDispatch } from '../src/gateway-module.ts'
import * as pid from '@libp2p/peer-id'

let node: BrowserNode | null = null
let consent: GrantedConsent | null = null
let lastOutcome: StartOutcome | null = null
/** The last colouring the fabric claimed, kept so the visitor can check it. */
let lastAnswer: { readonly n: number; readonly bits: Uint8Array } | null = null
/** Counted here and never transmitted — see `startReport` below. */
let declinedLocally = 0

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
 * The proof `start` needs, or a refusal naming why there is none.
 *
 * Re-read from storage each time rather than cached: another tab on this origin may
 * have revoked in the meantime, and a stale in-memory grant would let this tab keep
 * running on a permission the visitor has withdrawn.
 */
function requireConsent(): GrantedConsent {
  const found = readConsent(store)
  if (found.ok) {
    consent = found.consent
    return found.consent
  }
  consent = null
  throw new Error(`no consent: ${found.gap.kind}`)
}

function stateOf(): TabConsentState {
  const found = readConsent(store)
  return found.ok
    ? { granted: true, version: DISCLOSURE_VERSION, reportingAllowed: found.consent.reportingAllowed }
    : { granted: false, gap: found.gap.kind, version: DISCLOSURE_VERSION, reportingAllowed: false }
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
  try {
    const response = await fetch('/bootstrap.json', { cache: 'no-store' })
    if (response.ok) {
      const info = (await response.json()) as { peerAddrs?: unknown }
      if (Array.isArray(info.peerAddrs)) {
        candidates.push(...info.peerAddrs.filter((a): a is string => typeof a === 'string'))
        asked = true
      }
    }
  } catch {
    // A static host has no origin to ask. Not a failure — see below.
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
): Promise<readonly NodeDescriptor[]> {
  // Concurrently: one round trip per peer, and asking in sequence would pay their sum for
  // no benefit — `RpcRecordIndex.providers` gives the same reason for the same shape.
  return Promise.all(
    executors.map(async (executor) => ({
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
    })),
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
    consent = grantConsent(store, { reportingAllowed: reporting })
    if (!reporting) declinedLocally += 1
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

    try {
      node = await BrowserNode.start({
        relayAddrs: options.relayAddrs,
        blockstoreName: options.blockstoreName,
        // Conditional spread, so a tab that has never enrolled passes no key at all rather
        // than an empty array. The two are the same to `PeerVerifier` — both are a set of
        // size zero — and different to a reader, who can see here that "pins nobody" is a
        // state this tab was found in and not a list that came back empty.
        ...(pinned === null ? {} : { trustedIssuers: [pinned] }),
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
        // **Nothing on a visitor's path supplies this.** `autoStart` passes no
        // `enrollment` and grows no parameter for one, for the same reason it grows none
        // for `trustAnchors`: a page that was found rather than configured must not be
        // configurable by whatever found it. A tab reaching here without it is an
        // ordinary node whose receipts read the named absence, which is true.
        ...(options.enrollment === undefined
          ? {}
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
    // A peer dispatching work here changes what the surface must say, and the page
    // cannot poll for it — see `onActivity`.
    node.onActivity(notify)
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
    //    Absolute: the seed mounts it at the root, and on a static host it simply 404s.
    //    `no-store` because a stale relay address is worse than a slow one.
    try {
      const response = await fetch('/bootstrap.json', { cache: 'no-store' })
      if (response.ok) {
        const info = (await response.json()) as {
          relayAddrs?: unknown
          enrollmentProvider?: unknown
        }
        const addrs = Array.isArray(info.relayAddrs)
          ? info.relayAddrs.filter((a): a is string => typeof a === 'string')
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
            ...(typeof info.enrollmentProvider === 'string' && info.enrollmentProvider !== ''
              ? { enrollmentProvider: info.enrollmentProvider }
              : {}),
          }
        }
      }
    } catch {
      // A static host answers 404, or HTML, or nothing. Not an error — just means
      // there is no seed node here.
    }

    return { source: 'none' as const, relayAddrs: [] }
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
    const executors = [
      node.signingExecutor,
      ...options.peerIds.map((id) => new RemoteExecutor(id, node.rpc, 'dispatches-unauthenticated')),
    ]
    const result = await submitJobWithEgress(
      {
        moduleCid,
        moduleRecord: PI_RECORD,
        shards: Array.from({ length: options.shards }, () => ({ value: input, label: 'public' as const })),
        executors,
        nodes: await attestedNodes(node, executors),
        redundancy: options.redundancy,
        onQuorumShortfall: 'runs-at-available-redundancy',
      },
      node.store,
      [node.egress],
      { checkpoints: 'checkpoints-nothing' },
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
    const executors = [
      node.signingExecutor,
      ...options.peerIds.map((id) => new RemoteExecutor(id, node.rpc, 'dispatches-unauthenticated')),
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
        nodes: await attestedNodes(node, executors),
        redundancy: options.redundancy,
        onQuorumShortfall: 'runs-at-available-redundancy',
      },
      node.store,
      [node.egress],
      { checkpoints: 'checkpoints-nothing' },
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
    ]
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
        nodes: await attestedNodes(node, executors),
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
        checkpoints: checkpointsInto(node.store),
      },
    )
    if (!result.ok) throw new Error(`submit failed: ${JSON.stringify(result.error)}`)
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
    return required().store.refresh()
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
   */
  async fetchModule(options) {
    const n = required()
    const outcome = await fetchModuleForDispatch({
      gatewayBase: options.gatewayBase,
      moduleCid: options.moduleCid,
      recordCid: options.recordCid,
      recordName: options.recordName,
    })
    if (!outcome.ok) return outcome

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
      ...options.peerIds.map((id) => new RemoteExecutor(id, n.rpc, 'dispatches-unauthenticated')),
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
        moduleCid: CID.parse(options.moduleCid),
        moduleRecord,
        shards,
        executors,
        // As `runColouring` above — see that call site for what replaced `publicNodes`
        // here and why.
        nodes: await attestedNodes(n, executors),
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
        // CHURN-03 — as `runColouring` above, and for the same reason. Note this is the
        // one production submit that already passes an options bag, so it is the only one
        // of the five where the new field cost a line rather than an argument.
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
    if (node !== null) await node.stop()
    node = null
    // Defect 32: the upgrade budget is about connections this node held. A restarted
    // tab has none of them, so carrying the counts across would let a fresh run inherit
    // a verdict — "given up on this peer" — that nothing in it justifies.
    planner = new DialPlanner()
    notify()
  },
}

window.o2 = api
