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
 * `start` takes a `GrantedConsent`, which only `grantConsent` mints. There is no
 * test-only path around it: a path that could start without consenting would be a
 * path, and BROW-01 is not a property you can have on weekdays. A harness calls
 * `window.o2.grantConsent()` for the same reason a visitor clicks the button.
 *
 * Nothing here touches the network before that call either — not even relay
 * discovery, which fetches `/bootstrap.json`. The requirement names CPU; the owner's
 * decision went further, because "we spent no cycles" is not an answer to "you told
 * a third party I was here".
 */

import { publicNodes } from '@o2/core'
import type { CanonicalValue, StartFailure, StartOutcome } from '@o2/core'
import {
  RemoteExecutor,
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
import type { GrantedConsent, TabApi, TabConsentState } from '@o2/browser'
import { createTaskWorker } from '../src/worker-factory.ts'
import { planDials } from '../src/dial-plan.ts'
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
let discoveryRound: Promise<{ asked: boolean; dialed: string[]; failed: string[] }> | null = null

async function runDiscoveryRound(): Promise<{ asked: boolean; dialed: string[]; failed: string[] }> {
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
  // peer already connected, one peer offered twice, and the budget that bounds the
  // round's wall clock — lives in `planDials`, where a test can reach it without a
  // relay and a real node. What is left here is the I/O.
  const dialed: string[] = []
  const failed: string[] = []
  for (const address of planDials({
    candidates,
    self: n.peerId,
    connected: n.transport.peers,
  })) {
    try {
      dialed.push(await n.dial(address))
    } catch {
      // A peer whose reservation has lapsed, or that closed its tab between the
      // directory's answer and this dial. Expected, and not worth failing the round.
      failed.push(address)
    }
  }
  if (dialed.length > 0) notify()
  return { asked, dialed, failed }
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
    requireConsent()
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
        rpcTimeoutMs: 60_000,
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
      }
    }

    const { describeStartReport } = await import('@o2/core')
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
      node.executor,
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
        nodes: publicNodes(executors),
        redundancy: options.redundancy,
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
      agreeing: result.job.shards.map((shard) =>
        shard.verification.status === 'agreed' ? [...shard.verification.agreeing] : [],
      ),
      verificationMultiplier: result.job.verificationMultiplier,
      elapsedMs: performance.now() - started,
      egress: manifest,
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
    // acceptance — either way somebody replied. A peer that does not handle the
    // protocol fails protocol negotiation immediately, so this costs no timeout.
    const answers = await Promise.all(
      connected.map(async (peer) => {
        try {
          const body = await n.rpc.request(peer, encodeRequest({ kind: 'offer', shardId: 'probe' }))
          return parseResponse(body)?.kind === 'offer' ? peer : null
        } catch {
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

  connectionsTo(peerId) {
    const { peerIdFromString } = pid
    return required()
      .libp2p.getConnections(peerIdFromString(peerId))
      .map((connection) => ({
        remoteAddr: connection.remoteAddr.toString(),
        limited: connection.limits !== undefined,
      }))
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
      ...(options.includeSelf === true ? [n.executor] : []),
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
    // `submitJobWithEgress`, not bare `submitJob` — see `runColouring` above for why.
    const result = await submitJobWithEgress(
      {
        moduleCid: CID.parse(options.moduleCid),
        moduleRecord,
        shards: Array.from({ length: options.shards }, (_unused, i) => ({
          value: { a: i },
          label: 'public' as const,
        })),
        executors,
        nodes: publicNodes(executors),
        redundancy: options.redundancy,
      },
      n.store,
      [n.egress],
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
      agreeing: result.job.shards.map((s) =>
        s.verification.status === 'agreed' ? [...s.verification.agreeing] : [],
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
    }
  },

  async stop() {
    if (node !== null) await node.stop()
    node = null
    notify()
  },
}

window.o2 = api
