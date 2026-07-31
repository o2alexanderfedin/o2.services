/**
 * The contract between a tab and whatever is driving it.
 *
 * Lives here rather than in `demo/` so the page that implements it and the harness
 * that calls it type-check against one definition. A mismatch between the two would
 * otherwise only show up as a runtime failure inside `page.evaluate`, where the
 * error surfaces as a timeout.
 */

import type { EgressManifest } from '@o2/net'

/**
 * A `NameRecord` in the shape that survives `page.evaluate` — DET-03, DATA-08.
 *
 * Everything crossing the `page.evaluate` boundary is structured-cloned, and a `CID`
 * instance does not survive that: it arrives on the far side as a plain object with the
 * right fields and no prototype, so `CID.asCID` rejects it and every comparison against
 * a real CID fails. So the boundary carries the CID as the string it already is on the
 * wire, and the page reconstructs it with `CID.parse`. Exactly the reason
 * {@link TabApi.putModule} takes `number[]` rather than a `Uint8Array`.
 *
 * Field-for-field identical to `NameRecord` (`@o2/core`) apart from `cid`. Deliberately
 * not derived from it with a mapped type — the point of this interface is that it is the
 * *transport* shape, and a reader tracing a refusal needs to see what actually crossed.
 */
export interface TabNameRecord {
  readonly name: string
  /** The CID as a string. `CID.parse` on the page side; see this interface's doc. */
  readonly cid: string
  readonly version: number
  readonly expiresAt: number
  readonly signer: string
  readonly signature: string
}

/** What a completed job looks like from outside the tab. */
export interface TabJobReport {
  readonly complete: boolean
  /** Partition index each shard's guest reported, or -1 if it did not agree. */
  readonly partitions: readonly number[]
  readonly agreeing: readonly string[][]
  readonly replicas: readonly number[]
  readonly verificationMultiplier: number
  /** Blocks this tab pulled over the wire. */
  readonly fetched: number
  readonly rejected: number
  /**
   * DATA-05/DATA-06 — exactly what left this tab's node while running this job,
   * sliced from `BrowserNode.egress`. Job-scoped metadata, not a `JobResult` field
   * (`EgressManifest` lives in `@o2/net`, which `@o2/core` may not depend on).
   */
  readonly egress: EgressManifest
  /**
   * Why shards failed, flattened across every shard that did not agree.
   *
   * `complete: false` alone cannot tell a provenance refusal from a dropped relay
   * connection, and a browser-tier test that asserted only the boolean would pass for
   * the wrong reason on a flaky run. Filled from `VerificationResult`'s own `failures`,
   * which `packages/core/src/job/verify.ts` already carries on both the `disagreed` and
   * `insufficient` arms — nothing here is computed and nothing is inferred.
   *
   * **The one field this phase adds to a returned report shape, and the exception is
   * named rather than left quiet:** {@link TabColouringRun} — the visitor-facing report
   * — is untouched. This is the harness-facing one.
   */
  readonly failures: readonly { readonly nodeId: string; readonly reason: string }[]
}

/** How this tab is actually connected to a peer, right now. */
export interface TabConnection {
  readonly remoteAddr: string
  /**
   * True when the connection is a relayed circuit, which libp2p marks as limited
   * (2 min / 128 KiB). A WebRTC connection is unlimited — that difference is how
   * "the relay signals, then drops out of the data path" is verified rather than
   * assumed.
   */
  readonly limited: boolean
}

/** BROW-03 — what the visibility governor is doing right now. */
export interface TabGovernorState {
  readonly hidden: boolean
  readonly dutyCycle: number
  readonly transitions: number
  readonly sleptMs: number
}

/** BROW-05 — the isolation state of the page hosting this node. */
export interface TabIsolation {
  /** False on a page served without COOP/COEP, which is the supported case. */
  readonly crossOriginIsolated: boolean
  readonly hasSharedArrayBuffer: boolean
  readonly inIframe: boolean
}

import type { Disclosure } from './disclosure.ts'

/** BROW-01 — what the gate knows before anything has run. */
export interface TabConsentState {
  readonly granted: boolean
  /**
   * Why there is no usable consent: `never-asked`, `terms-changed`, `unreadable`.
   * Absent when one exists. Named rather than collapsed, because "you never asked
   * me" and "the terms changed" deserve different sentences.
   */
  readonly gap?: string
  /** The disclosure version currently in force. */
  readonly version: string
  /** Whether the visitor also allowed the start-outcome report. */
  readonly reportingAllowed: boolean
}

/** BROW-04 — what the always-visible surface displays. */
export interface TabActivity {
  readonly running: boolean
  readonly tasksExecuted: number
  readonly dutyCycle: number
  readonly hidden: boolean
  readonly peers: number
  /**
   * Whose work this node has run, most first.
   *
   * The criterion says the surface shows what is running *and for whom*. A peer
   * count answers only the first half.
   */
  readonly servedFor: readonly { readonly peerId: string; readonly tasks: number }[]
  /** Blocks this tab has pulled from peers, and refused for a CID mismatch. */
  readonly fetched: number
  readonly rejected: number
}

/** BROW-02 — the start-outcome report as the page shows it. */
export interface TabStartReport {
  /** Peers that answered, and peers asked. `asked > 0 && reached === 0` is the cliff. */
  readonly reached: number
  readonly asked: number
  /** Rendered text, blind spots included — see `describeStartReport`. */
  readonly text: string
  readonly reported: number
  readonly failed: number
}

/** DEMO-01/DEMO-02 — one run of the colouring search across the fabric. */
export interface TabColouringRun {
  readonly n: number
  readonly cubes: number
  /** Every cube reached agreement between its replicas. */
  readonly complete: boolean
  /** A colouring was found by at least one cube. */
  readonly found: boolean
  /** Per cube: `found`, `exhausted` (provably none here), or `budget` (unknown). */
  readonly statuses: readonly string[]
  /** Which nodes agreed on each cube, so placement is visible rather than implied. */
  readonly agreeing: readonly string[][]
  readonly verificationMultiplier: number
  readonly elapsedMs: number
  /**
   * DATA-05/DATA-06 — exactly what left this tab's node while running this job,
   * sliced from `BrowserNode.egress`. Job-scoped metadata, not a `JobResult` field
   * (`EgressManifest` lives in `@o2/net`, which `@o2/core` may not depend on).
   */
  readonly egress: EgressManifest
}

/**
 * The check, run in the visitor's own tab — DEMO-02.
 *
 * Deliberately a separate act from the run. The fabric makes a claim; this is the
 * visitor testing it against the definition, with no node's word taken for anything.
 */
export interface TabVerification {
  readonly checked: boolean
  readonly ok: boolean
  readonly n: number
  /** Triples re-derived here, from a² + b² = c². Not supplied by anyone. */
  readonly triplesChecked: number
  /** The triple that refutes the claim, when there is one. */
  readonly violation: string | null
}

export interface TabAddresses {
  readonly peerId: string
  readonly webrtc: readonly string[]
  readonly circuit: readonly string[]
}

export interface TabApi {
  /**
   * The disclosed terms — BROW-01.
   *
   * The page renders this rather than holding its own copy, so the text a visitor
   * reads, the version a stored consent answered, and the text on the policy page
   * cannot drift apart.
   */
  disclosure(): Disclosure
  /**
   * BROW-01. What the gate is currently allowed to do.
   *
   * Safe to call before consent — it reads storage and nothing else.
   */
  consentState(): TabConsentState
  /**
   * Record that the visitor consented, and mint the proof `start` requires.
   *
   * This is the only thing that opens the gate. A test harness calls it for the
   * same reason a visitor clicks the button, and there is deliberately no bypass:
   * a test path that could start without consenting would be a path.
   */
  grantConsent(options?: { reporting?: boolean }): TabConsentState
  /** Forget the consent. The gate reappears, and any running node is stopped. */
  revokeConsent(): Promise<TabConsentState>
  /** BROW-04. Null when no node is running. */
  activity(): TabActivity | null
  /**
   * BROW-02. Publish this tab's start outcome and read back what peers know.
   *
   * Publishes only when the visitor allowed it; otherwise it asks without telling.
   */
  startReport(): Promise<TabStartReport>
  /**
   * Subscribe to state changes. Returns an unsubscribe function.
   *
   * Pushed rather than polled, and not for elegance: **Chromium throttles timers in
   * a tab that is not in front**, so a poll fast enough to feel live in the
   * foreground fires roughly never in the background. A node started in a
   * background tab would then run with no visible surface, which is precisely the
   * failure BROW-04 names. Every call that changes what the surface should say ends
   * by notifying.
   */
  onChange(listener: () => void): () => void
  /**
   * DEMO-01/DEMO-02. Run the colouring search across this tab and its peers.
   *
   * Every cube is the same input block; a shard differs only by `partition()`, so
   * the fabric distributes work without distributing data.
   */
  runColouring(options: {
    n: number
    cubes: number
    redundancy: number
    peerIds: string[]
  }): Promise<TabColouringRun>
  /**
   * DEMO-02. Check the last answer here, from the definition.
   *
   * Needs no node, no peer and no network — it works with the fabric disconnected,
   * which is the point.
   */
  verifyAnswer(): TabVerification
  /**
   * Join the fabric.
   *
   * `trustAnchors` is the build authorities this tab will run a module for — DET-03,
   * DATA-08. **A list, or nothing, and nothing means the demo's own build authority**
   * (`KERNEL_TRUST_ANCHOR`, `@o2/demo`), supplied by `main.ts` rather than by this type
   * so the page and its committed kernel cannot drift apart.
   *
   * A supplied list **replaces** the demo's default rather than joining it. That is
   * deliberate: a harness pinning its own key is running its own build, and silently
   * leaving the demo key pinned would make its test prove less than it appears to.
   *
   * **This surface is stricter than `BrowserNodeOptions.trustAnchors`, which it sits
   * over, and the asymmetry is the point.** That option admits a named opt-out literal
   * for a caller who constructs a node in TypeScript and has written down that they want
   * one. This one admits no opt-out at all — there is no value passable through
   * `window.o2` that starts a tab which resolves bare CIDs, and {@link runJob}'s record
   * is required for the same reason. A harness wanting to run its own module signs it
   * with its own key and pins that key here; it does not turn the check off.
   */
  start(options: {
    relayAddrs: string[]
    blockstoreName: string
    trustAnchors?: string[]
  }): Promise<string>
  /**
   * Join using whatever the page's own origin says to dial.
   *
   * The whole of "automatic discovery" from the browser's side. The page fetches
   * `/bootstrap.json` from the host it was itself loaded from, so a phone that opened
   * `http://laptop.local:5173` is told to dial `/dns4/laptop.local/...` — nothing
   * hardcoded, nothing guessed, and no address that can go stale in a build.
   */
  autoStart(options?: { blockstoreName?: string }): Promise<{ peerId: string; relayAddrs: string[] }>
  /**
   * Where this page would look for a relay, without joining.
   *
   * `source` is `'query'` when relays came from `?relay=<multiaddr>`, `'origin'` when
   * they came from a same-origin `/bootstrap.json`, and `'none'` when neither is
   * available — which is the normal state on a static host with no relay configured.
   */
  discoverRelays(): Promise<{ source: 'query' | 'origin' | 'none'; relayAddrs: string[] }>
  /**
   * Dial every peer the origin says is here, that this tab is not already on.
   *
   * A browser binds no listening socket, so two tabs on one relay stay invisible to
   * each other however long they wait — somebody has to say who is present, and the
   * only node that can be dialled cold is the one serving this page. Idempotent, and
   * safe to call on a timer: peers already connected are skipped.
   *
   * Returns nothing dialled on a static host, where there is no origin to ask. That
   * is a real limitation of the static tier rather than a failure, and the caller
   * can tell the difference from `asked`.
   */
  connectDiscoveredPeers(): Promise<{ asked: boolean; dialed: string[]; failed: string[] }>
  /**
   * The connected peers that will actually execute a task.
   *
   * Not the same as {@link peers}, which is every libp2p connection — and that set
   * always includes the relay, because holding a reservation *is* a connection. A
   * relay carries signalling and does not serve the agent protocol, so counting it
   * as a peer inflates the display and, worse, puts it in the executor list, where
   * every shard dispatched to it fails and the job silently runs alone.
   *
   * Established by **asking**, never by classifying. A peer that answers an offer
   * serves the protocol; one that does not, does not. Nothing here branches on what
   * kind of node something is — that rule has been broken twice in this project and
   * this is the shape that cannot break it, because there is no field to branch on.
   */
  computePeers(): Promise<string[]>
  addresses(): TabAddresses
  /** Resolves once a relay reservation has produced a dialable `/webrtc` address. */
  waitForWebrtcAddr(timeoutMs: number): Promise<string[]>
  dial(address: string): Promise<string>
  peers(): string[]
  connectionsTo(peerId: string): TabConnection[]
  putModule(bytes: number[]): Promise<string>
  storedBlocks(): Promise<number>
  governor(): TabGovernorState
  isolation(): TabIsolation
  /**
   * Force the page's visibility signal, then dispatch a real `visibilitychange`.
   *
   * Exists only because **Chromium under automation never reports a page as
   * hidden** — verified: neither `page.bringToFront()` nor headed mode produces a
   * hidden state or fires the event, because there is no window manager driving tab
   * activation. So the browser's *signal* is simulated and everything downstream is
   * real: the actual `document`, a real event dispatch, the governor's real listener,
   * and the real execution path.
   *
   * Test-only. Nothing in the production path calls it.
   */
  simulateHidden(hidden: boolean): void
  hasBlock(cid: string): Promise<boolean>
  /**
   * Dispatch a job carrying a signed record for its module — DET-03, DATA-08.
   *
   * `moduleRecord` is **required**, not optional, and that is the whole of the design:
   * a tab started through {@link start} always pins some anchor set, so a dispatch with
   * no record is a dispatch that will be refused by every executor it reaches. Making
   * the field optional would let a caller write the refusal rather than the job and
   * discover it as a timeout. Whoever hands this tab a module signs a record for it —
   * see {@link TabNameRecord} for why the CID crosses as a string.
   */
  runJob(options: {
    moduleCid: string
    moduleRecord: TabNameRecord
    peerIds: string[]
    shards: number
    redundancy: number
    includeSelf?: boolean
  }): Promise<TabJobReport>
  stop(): Promise<void>
}

declare global {
  interface Window {
    o2: TabApi
  }
}
