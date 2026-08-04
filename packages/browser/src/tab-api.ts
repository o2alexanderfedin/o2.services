/**
 * The contract between a tab and whatever is driving it.
 *
 * Lives here rather than in `demo/` so the page that implements it and the harness
 * that calls it type-check against one definition. A mismatch between the two would
 * otherwise only show up as a runtime failure inside `page.evaluate`, where the
 * error surfaces as a timeout.
 */

import type { ShardAttestation } from '@o2/core'
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
   *
   * **That exception was itself excepted, and this is where to read why.** The sentence
   * above was written when the only thing a returned report had gained was a diagnosis
   * a harness needed. {@link TabColouringRun.attestation} broke the rule deliberately —
   * criterion 3 requires the receipt to read `owner-attested` *wherever a result is
   * displayed* and it names the demo UI, which is what that report is rendered into. The
   * rule stands for everything else; the one surface the criterion names moved, and both
   * docs say so rather than leaving a reader to notice a rule quietly stop applying.
   */
  readonly failures: readonly { readonly nodeId: string; readonly reason: string }[]
  /**
   * How strongly this job's answer was attested — VER-09, VER-10.
   *
   * **`JobResult.attestation`, passed through.** Not recomputed, not derived from
   * `replicas`, not derived from `agreeing.length`, and not composed into a sentence
   * here: this is the value `submitJob` produced and the same union the kernel carries.
   * A report that computed its own would be a second opinion about one result, and the
   * day the two disagree is the day a visitor is told the stronger one.
   *
   * The absence arm is a **statement**, not a blank: it says this tab holds no signed
   * statement it could check about who produced the answer, and carries how many
   * replicas agreed against how many of those were verified. See `NoVerifiedAttestation`
   * in `@o2/core` — `0 of 2` and `1 of 2` are different situations with different
   * remedies.
   */
  readonly attestation: ShardAttestation
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
  /**
   * How strongly this run's answer was attested — VER-09, VER-10, criterion 3.
   *
   * **This report had been held stable on purpose, and this field is the stated
   * exception.** {@link TabJobReport.failures} records the rule — *the visitor-facing
   * report is untouched* — and it was the right rule for a diagnosis a harness wanted.
   * It is the wrong rule for this value, because criterion 3's requirement is that the
   * receipt reads `owner-attested` rather than `verified` **wherever it is displayed**,
   * and it names the demo UI by name. This report *is* the demo UI's input. Leaving it
   * out would have satisfied the letter of a convention by leaving the criterion open on
   * the one surface a person actually looks at.
   *
   * The same union {@link TabJobReport.attestation} carries, and the same passthrough:
   * `JobResult.attestation`, unmodified. The page renders its `description` — the
   * kernel's own sentence — and composes none of its own, which is the only arrangement
   * in which the CLI and this page cannot come to describe one result differently.
   */
  readonly attestation: ShardAttestation
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
   * Record that the visitor consented, and mint the proof of it.
   *
   * **This is how the gate is opened, not the only way it is found open.** The
   * corrected form of a claim that stood here and was false: a returning visitor
   * never calls this, because {@link start} re-reads storage through `readConsent`,
   * which mints a `GrantedConsent` of its own from a record already written
   * (`consent.ts:154`). `consent.ts` states the real rule at the class itself —
   * there is no way to obtain one *"than to have written, or to have found, a
   * consent record"* — and this method is the writing half.
   *
   * **The gate is sound, which is why only the description needed correcting.**
   * `new GrantedConsent(...)` is reachable at exactly two places, both in
   * `consent.ts` and both behind a module-private `MINTED` symbol that is exported
   * nowhere; the constructor refuses any other caller. So there is still no bypass,
   * and a test harness calls this for the same reason a visitor clicks the button:
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
    /**
     * SCHED-06 — tasks this tab will hold at once. Omitted takes the factory default.
     *
     * Exposed for the same reason `FabricNodeOptions.maxConcurrentTasks` is: a test that
     * wants to *observe* a refusal, or a slot count moving with a cap, has to be able to
     * make one certain rather than hope for it.
     */
    maxConcurrentTasks?: number
    /**
     * SCHED-04 — this tab's starting user CPU cap, in `(0, 1]`. Omitted means 1.
     *
     * A starting value only; {@link TabApi.setDutyCycle} moves it on a running tab.
     */
    dutyCycle?: number
    /**
     * Enrol with a provider on the way up, and hold the certificate it signs — AUTH-01.
     *
     * Straight through to `BrowserNodeOptions.enrollment`, which carries the long form of
     * every field. `userPrivateKey` crosses as `number[]` rather than as a `Uint8Array`
     * for {@link TabNameRecord}'s reason one field over: Playwright serialises
     * `page.evaluate` arguments as JSON, so a typed array arrives on the page side as a
     * plain `{"0":…}` object and `ed25519.getPublicKey` would derive a key from nothing.
     * The conversion happens at the implementation, which is the one place that knows
     * both sides. It is the **private** half, and it has to be: `EnrollmentAuthority.enrol`
     * refuses by name as `bad-owner-proof` without a signature over its challenge, and a
     * public key cannot sign.
     *
     * ## Why this is on the page's contract when `sovereignty` deliberately is not
     *
     * `packages/browser/src/capability-harness.ts` records the rule this appears to
     * break — it exists *"rather than a third option on `window.o2`"* because adding
     * `BrowserNodeOptions.sovereignty` here *"would put node configuration on the page's
     * own contract to serve a test"*. That rule stands, and this field is not a
     * counter-example to it; the two options differ in what they change.
     *
     * `sovereignty` pins the owner a node will accept work **for**. It decides which
     * dispatches a node takes, it is meaningful only to whoever operates the node, and no
     * visitor-facing surface reports it. `enrollment` decides whether this node's
     * statements about its own results **can be checked by anybody else** — and criterion
     * 3 requires this page to display exactly that, in the kernel's words, on every run.
     * A surface obliged to say how strongly an answer was attested, with no way to be
     * given an identity to attest with, can only ever display the absence. That is a gap
     * in the contract rather than a test's convenience.
     *
     * ## What omitting it means, and it is not a lesser node
     *
     * Nobody asked this tab to enrol. It executes tasks, holds blocks, serves peers and
     * takes verification slots on exactly the terms an enrolled one does — the only thing
     * it cannot do is produce a signed statement a third party could check, so every
     * receipt naming it reads the named absence. That is a fact about what this tab was
     * handed, not about what kind of node it is. Every visitor path omits it today:
     * {@link TabApi.autoStart} does not pass it and deliberately grows no parameter for
     * it, for the same reason it grows none for `trustAnchors`.
     */
    enrollment?: {
      userPrivateKey: number[]
      operatorId: string
      providerAddr: string
    }
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
  /**
   * SCHED-04 — set this tab's user CPU cap while it is running, in `(0, 1]`.
   *
   * **The user's cap, not the environment's.** It composes with the visibility governor
   * by taking the lower of the two, so a backgrounded tab still throttles to the
   * background rate whatever is set here, and `capacity().dutyCycle` reports the
   * effective rate rather than this argument.
   *
   * Throws a `RangeError` naming the value for anything outside `(0, 1]`, and a tab whose
   * call threw is unchanged — there is no partial application of a cap.
   *
   * This is the page's control. There is deliberately **no wire frame** that does the
   * same thing: `serveAgent` serves unauthenticated, so a peer able to dial this tab must
   * not be able to throttle it.
   */
  setDutyCycle(value: number): void
  /** SCHED-04 — this tab's effective rate and the slot count it now advertises. */
  capacity(): { dutyCycle: number; slots: number }
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
    /**
     * Submit this job's shards as **owner-pinned data** rather than public — DATA-10,
     * WIRE-03. Omitted means public, which is what every shard submitted from a page
     * was until this field existed.
     *
     * **One field, not two.** The label and the owner id arrive together or not at
     * all, because a sovereign shard with no owner is not a state this fabric has —
     * `submitJob` refuses it by name (`shard-missing-owner`), and a pair of loose
     * optionals is a way to spell a refusal rather than a job. Two spellings of one
     * fact are two things that can disagree; this is the shape that cannot.
     *
     * **Why a page may submit owner-pinned data at all**, since the question reads at
     * first like a tier being handed a capability: sovereignty is a property of the
     * data and of whose it is, never of what kind of node holds it. A tab is the
     * owner's own device and is therefore the most natural place for owner-pinned data
     * to live — the least surprising submitter in the fabric, not a privileged one. A
     * `FabricNode` submitting the same shard through `submitJobWithEgress` gets exactly
     * this treatment and has since Phase 13.1.
     *
     * **What supplying it does, mechanically.** The page hands its node's
     * `sovereignCids` to `submitJob`, so the shard's canonical bytes are recorded at the
     * **blockstore-put** — the line that makes this tab hold the row — and the tab
     * refuses to serve that block afterwards and withholds it from its own `providers`
     * answer. Recorded at the put rather than at this call site, so a submitter is
     * covered by having submitted rather than by having remembered.
     *
     * **Harness-facing, like the report this returns.** {@link TabColouringRun} — the
     * visitor-facing surface — gains nothing, which is the same exception
     * {@link TabJobReport.failures} already declares for itself: the demo runs a public
     * colouring search over one shared input block, and there is no owner in it.
     */
    sovereign?: { readonly ownerId: string }
  }): Promise<TabJobReport>
  stop(): Promise<void>
}

declare global {
  interface Window {
    o2: TabApi
  }
}
