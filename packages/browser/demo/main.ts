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

import { verifyCertificate } from '@o2/core'
import type {
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
  submitJobWithEgress,
} from '@o2/net'
import {
  DEFAULT_BUDGET,
  KERNEL_RECORD,
  KERNEL_TRUST_ANCHOR,
  answerOf,
  buildInput,
  kernelBytes,
  readPartial,
  verifyColouring,
} from '@o2/demo'
import {
  BrowserNode,
  DISCLOSURE,
  DISCLOSURE_VERSION,
  classifyStartError,
  currentBrowserLabel,
  firstGap,
  grantConsent,
  localConsentStore,
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
import * as pid from '@libp2p/peer-id'

let node: BrowserNode | null = null
let consent: GrantedConsent | null = null
let lastOutcome: StartOutcome | null = null
/** The last colouring the fabric claimed, kept so the visitor can check it. */
let lastAnswer: { readonly n: number; readonly bits: Uint8Array } | null = null
/** Counted here and never transmitted — see `startReport` below. */
let declinedLocally = 0

const store = localConsentStore()

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
 * Measured rather than assumed: `BrowserNodeOptions` has **no `trustedIssuers` field** —
 * `FabricNodeOptions` has one and this tier does not — so the pinned-provider set a Node
 * peer verifies against does not exist here. `TabApi.start`'s `trustAnchors` is a
 * different namespace entirely: those are *build* authorities, checked by `NameResolver`
 * against a module's signed record, and using them as certificate issuers would be the
 * conflation this phase exists to end wearing a new hat.
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
      certificate:
        executor.nodeId === n.peerId
          ? (n.certificate ?? 'carries-no-certificate')
          : await peerCertificate(n, executor.nodeId),
    })),
  )
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

    try {
      node = await BrowserNode.start({
        relayAddrs: options.relayAddrs,
        blockstoreName: options.blockstoreName,
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
        const info = (await response.json()) as { relayAddrs?: unknown }
        const addrs = Array.isArray(info.relayAddrs)
          ? info.relayAddrs.filter((a): a is string => typeof a === 'string')
          : []
        if (addrs.length > 0) return { source: 'origin' as const, relayAddrs: addrs }
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
      },
      node.store,
      [node.egress],
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
      // AUTH-03, same reasoning as `runColouring` above and equally permanent: every
      // shard below is `label: 'public'`, so there is no owner, no root key, and
      // nothing for a chain to say.
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
      { sovereignCids: n.sovereignCids },
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
