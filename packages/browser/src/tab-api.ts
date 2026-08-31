/**
 * The contract between a tab and whatever is driving it.
 *
 * Lives here rather than in `demo/` so the page that implements it and the harness
 * that calls it type-check against one definition. A mismatch between the two would
 * otherwise only show up as a runtime failure inside `page.evaluate`, where the
 * error surfaces as a timeout.
 */

import type { BrowserTally, ShardAttestation, ShardQuorum } from '@o2/core'
import type { EgressManifest } from '@o2/net'
import type { FetchReport } from './gateway-module.ts'

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
  /**
   * The warrant, when {@link signer} is a delegate rather than a pinned anchor — task #4.
   *
   * **Optional here and load-bearing when present.** `payloadOf` in `@o2/core`'s `naming.ts`
   * hashes this field, so a record that carries one and crosses this boundary without it is
   * not the record that was signed — and the far side reports `untrusted-signer`, naming a
   * key nobody pinned, which reads exactly like an attack. The demo's three kernel records
   * are all delegated, so this is the live path and not a provision for later.
   *
   * Plain fields rather than `NameDelegation` because this interface is what survives
   * structured cloning across `page.evaluate`, and every value in it must be a clonable
   * primitive for the same reason {@link cid} crosses as a string.
   */
  readonly delegation?: {
    readonly root: string
    readonly delegate: string
    readonly expiresAt: number
    readonly signature: string
  }
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

/**
 * A peer this tab holds a connection to, and whether that connection can carry a job —
 * defect 32.
 *
 * The reading {@link TabApi.peers} cannot give. That one is `libp2p.getPeers()`, which
 * counts a peer reachable over nothing but a `limited` relay circuit as connected —
 * and a relayed circuit is 2 minutes and 128 KiB of signalling channel that this
 * project's constraints say may not carry a job. The two are different questions and a
 * surface that has only the first cannot say that a pair is connected and unusable.
 */
export interface TabHeldPeer {
  readonly peer: string
  /**
   * True when at least one open, unlimited connection to this peer exists.
   *
   * A positive test rather than "no limited connection": an upgraded pair routinely
   * keeps its signalling circuit open beside the WebRTC connection.
   */
  readonly carriesWork: boolean
}

/** What one discovery round did, and what it left behind — see {@link TabApi.connectDiscoveredPeers}. */
export interface TabDiscoveryRound {
  /** Whether any directory answered at all. False on a static host with no peers yet. */
  readonly asked: boolean
  /** Peer ids reached by a dial this round made. */
  readonly dialed: string[]
  /** Addresses whose dial threw. A simultaneous mutual dial lands here on both sides. */
  readonly failed: string[]
  /**
   * The addresses among `dialed`/`failed` that were re-dials of a peer this tab already
   * held over a relayed circuit — defect 32's repair, counted so a caller can tell a
   * round that introduced somebody from one that was trying to rescue a stuck pair.
   */
  readonly upgrades: string[]
  /**
   * Peers this tab holds **only** over a relayed circuit as the round ended: connected,
   * counted by `computePeers()` because the RPC protocol negotiates over a limited
   * connection, and unable to carry the work.
   */
  readonly relayedOnly: string[]
  /**
   * The subset of `relayedOnly` this tab has stopped trying to upgrade, having spent its
   * whole retry budget on them. The honest end state: *this pair is connected and cannot
   * run your job, and I am no longer trying to fix it.*
   */
  readonly stalled: string[]
}

/**
 * What the candidate lookup this page runs before every dispatch answered — SCHED-01.
 *
 * **Not {@link TabDiscoveryRound}, and the two are different questions asked of different
 * things.** That one is about *connectivity*: who is here, and can this tab dial them. This
 * one is about *eligibility*: of the peers already dialled, which ones advertise the block
 * the job will read **and** hand over a capability record whose certificate verifies
 * against an issuer this tab pinned. A peer can be in `dialed` and absent from `qualified`
 * — that is the ordinary case for a peer that has not fetched the module yet — and the
 * page must be able to say which of the two it is looking at.
 *
 * Every field is a reading of one lookup rather than a running total, so a caller comparing
 * two of these is comparing two dispatches rather than a history.
 */
export interface TabCandidateLookup {
  /**
   * Whether the lookup ran at all.
   *
   * `false` is not a failure and is the ordinary state of an unenrolled tab: with no
   * certificate this tab has pinned no issuer, and a records answer verified against an
   * empty issuer set is a peer vouching for itself. {@link TabCandidateLookup.declined}
   * carries which of the reasons it was.
   */
  readonly asked: boolean
  /** Why the lookup did not run, or `null` when it did. */
  readonly declined: string | null
  /** The CID whose providers were asked for — the module the dispatch will name. */
  readonly inputCid: string
  /** How many distinct node keys answered that they hold it, qualified or not. */
  readonly providers: number
  /** Peer ids that survived the intersection, in the order the lookup returned them. */
  readonly qualified: string[]
  /**
   * The owner id each qualified peer's certificate names, index-aligned with `qualified`.
   *
   * This is the field the sovereign arm turns on: a descriptor built from a lookup carries
   * the user key its certificate was signed over, where the placeholder this page falls
   * back to declares the literal `public` for everybody.
   */
  readonly owners: string[]
  /** Every provider the intersection rejected, as `<node key prefix>: <reason>`. */
  readonly excluded: string[]
  /** Qualified node keys naming no peer id this transport could dial. */
  readonly undialable: string[]
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

/**
 * AUTH-01/02/04 — the enrolment question as a page can put it to a person.
 *
 * Every field is here so the page can render a *sentence*, not so it can branch: a visitor
 * is owed the address they are being asked to trust, and told plainly when the offer has
 * changed under them or when this origin is not one they should hold a key on at all.
 */
export interface TabEnrolmentOffer {
  /** Whether this origin published a provider to enrol with at all. */
  readonly offered: boolean
  /**
   * The provider address on the table — the one the origin currently names, or, when the
   * visitor has already answered, the one they answered. Absent when neither exists.
   */
  readonly providerAddr?: string
  /** Whether a decision to enrol is on file for this origin and still stands. */
  readonly accepted: boolean
  /**
   * Why a stored decision does not stand: `never-asked`, `provider-changed`, `unreadable`.
   * Absent when one does. `provider-changed` is the one that deserves its own sentence —
   * the visitor said yes to an address, and this origin now names a different one.
   */
  readonly gap?: string
  /**
   * Whether this origin can hold a key the page itself cannot read.
   *
   * `false` on a non-secure origin, where `crypto.subtle` does not exist and a visitor key
   * would have to live in JavaScript memory that the origin's own script can read. The page
   * must not offer on such an origin: taking the click and then refusing teaches a visitor
   * that the button is broken rather than that this origin is not one to hold a key on.
   */
  readonly canHoldKey: boolean
  /**
   * The issuer of the certificate this tab actually **holds**, or absent when it holds none.
   *
   * Separate from {@link accepted}, and the distinction is the one worth reporting: a
   * decision is what the visitor asked for and this is what came back. They disagree
   * whenever a decision is newer than the tab's last start, and whenever a provider was
   * unreachable — so a surface that showed only the decision would tell a visitor they were
   * enrolled at the moment enrolment had failed.
   *
   * Read from the stored certificate, so it survives a reload and answers before any peer
   * has been spoken to. Absent on a tab that never enrolled, and on one whose stored
   * certificate names a node identity this origin has since lost.
   */
  readonly heldIssuer?: string
  /**
   * Whether the running node is the one this decision describes.
   *
   * `false` when a decision was accepted or withdrawn while a node was already up, because
   * {@link TabApi.acceptEnrolment} records an answer and deliberately does not act on it.
   * The page uses this to say a restart is outstanding rather than leaving a visitor to
   * infer it from nothing.
   */
  readonly appliedToRunningNode: boolean
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
  /**
   * The merged tallies, one row per browser family — BROW-02's cross-node reading.
   *
   * **Structure rather than prose, and the reason is what the criterion actually
   * asserts.** The load-bearing reading is a *family this tab is not*: a chromium tab
   * whose merged report carries a `firefox 130` row cannot have produced that row,
   * because there is no expression in the page that would. A count above 1 is
   * satisfiable by an accident, a double-record, or a fixture that opened one page
   * twice; a foreign family label is not. With only {@link TabStartReport.text} on this
   * interface a spec could assert that family only by regexing
   * `describeStartReport`'s output — which would make the criterion depend on a
   * formatting decision that is free to change and that nothing would then re-check.
   *
   * `StartReport.byBrowser`, passed straight through. Not recomputed, not re-sorted and
   * not filtered here, for the reason {@link TabColouringRun.attestation} gives one
   * interface over: a report that composed its own second opinion about one population
   * is a thing that can disagree with the first, and the day the two disagree is the
   * day a reader is shown whichever one the page happened to build.
   *
   * **This does not replace the screen reading, and adding it is not a way around
   * one.** The criterion says the ledger is *viewed*, and a returned object is not a
   * view. `peer-ledger.e2e.test.ts` takes its reading off the rendered element and uses
   * this field only as the cross-check that the screen and the object agree — the right
   * value read from the wrong object being the divergence class mutation-ledger entry
   * `M37` records against this very tier.
   */
  readonly byBrowser: readonly BrowserTally[]
}

/** DEMO-01/DEMO-02 — one run of the colouring search across the fabric. */
/**
 * What a pi run looks like from outside the tab — MR-03…MR-07, and the demo's one
 * **verified** aggregation.
 *
 * The three booleans are separate on purpose and collapsing them would misreport a run.
 * `reduceAttempted` says a reduce could be started at all; `combined` says combines actually
 * produced an aggregate. `reduceJob` documents on its own type that `ok` means only the former,
 * so a run where every combine failed is `{ok: true}` with `outcome.ok === false` —
 * `bin/bench.ts` makes the identical distinction at its own call site, for the identical reason.
 */
export interface TabPiRun {
  readonly terms: number
  readonly shards: number
  /** Every shard reached agreement between its replicas — the MAP half. */
  readonly complete: boolean
  /** False for a lone tab: the submitter is excluded from the combine executor set. */
  readonly reduceAttempted: boolean
  /** The fabric's own words when it could not start — e.g. `no executor to combine on`. */
  readonly reduceReason: string | null
  /** Combines produced an aggregate. Distinct from {@link TabPiRun.reduceAttempted}. */
  readonly combined: boolean
  readonly treeDepth: number
  readonly combines: number
  /**
   * pi, as the fabric aggregated it — **fetched from the store, never recomputed locally.**
   * `null` whenever there is no aggregate to read; the flags above say which case it was.
   */
  readonly estimate: number | null
  /** The Madhava-Leibniz remainder bound for this term count, for comparison against published pi. */
  readonly errorBound: number
  readonly elapsedMs: number
  /** DATA-05/DATA-06, as {@link TabJobReport.egress}. */
  readonly egress: EgressManifest
}

/**
 * What a prime-counting run came to — the reading behind UI-SPEC section 4.3's Primes surface.
 *
 * **Why this workload is not a third flavour of {@link TabPiRun}.** π is a series: more terms
 * means a closer estimate, and the answer is compared against a constant to a stated tolerance.
 * π(x) — the count of primes at or below x — is an **integer with a published value**. There is
 * no tolerance and no estimate. The fabric either returns 78 498 for x = 10⁶ or it is wrong,
 * and the value it is checked against was tabulated in the mathematical literature long before
 * this repository existed.
 *
 * That is the whole reason the workload is worth a surface. Every other check on this page is
 * written by the same hand as the thing it checks: `verifyColouring` re-derives the triples
 * from the definition, which is strong, but a misconception held in both the fabric and its
 * verifier is invisible to the pair. This one cannot be talked into agreeing.
 *
 * **The oracle's stated blind spot travels with it, and the page says so.** Published values are
 * quoted at powers of ten, and a power of ten sits far from the prime below it — so a guest that
 * silently loses the top of its range still returns the right total. `primes-reduce.node.test.ts`
 * is what closes that hole, by tiling `[2, N]` at every shard count from one to eight and
 * requiring the per-shard counts to sum to the published value each time. This reading does not
 * re-derive that, and must not be described as if it did.
 */
export interface TabPrimesRun {
  /** The bound: every prime p with 2 ≤ p ≤ n was counted. */
  readonly n: number
  readonly shards: number
  /** Every shard reached agreement between its replicas — the MAP half. */
  readonly complete: boolean
  /** False for a lone tab: the submitter is excluded from the combine executor set. */
  readonly reduceAttempted: boolean
  /** The fabric's own words when it could not start — e.g. `no executor to combine on`. */
  readonly reduceReason: string | null
  /** Combines produced an aggregate. Distinct from {@link TabPrimesRun.reduceAttempted}. */
  readonly combined: boolean
  readonly treeDepth: number
  readonly combines: number
  /**
   * π(n), as the fabric aggregated it — **fetched from the store, never recomputed locally.**
   *
   * `null` whenever there is no aggregate to read; the flags above say which case it was. An
   * integer, and deliberately not rounded or formatted here: the comparison against the
   * published value is an equality, so a number that has been through a display transform is
   * not the number to compare.
   */
  readonly total: number | null
  /**
   * What each shard counted in its own sub-range, in shard order — one entry per shard.
   *
   * **`null` where a shard has no count to give**, which is two different conditions and both
   * are real: its replicas did not agree, or the guest refused the block and `readPrimeCount`
   * threw rather than returning a zero. A zero would be indistinguishable from a sub-range that
   * genuinely held no primes, and `primes.ts` records at length why that distinction is the
   * whole reason the reader throws.
   *
   * **This is the map's own reading, not a decomposition of {@link total}.** The total comes
   * back from the combine nodes through the store; these come off this tab's own shard results.
   * So the two are independently derived and their agreement is a real check on the reduce —
   * which is what the surface renders beside them, and what a table of per-shard rows is for.
   */
  readonly perShard: readonly (number | null)[]
  /** How strongly this run's answer was attested — the same passthrough {@link TabColouringRun} carries. */
  readonly attestation: ShardAttestation
  readonly elapsedMs: number
  /** DATA-05/DATA-06, as {@link TabJobReport.egress}. */
  readonly egress: EgressManifest
}

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
  /**
   * What the verification quorum came to for this run — VER-03, VER-04.
   *
   * **This is not the same fact as {@link attestation}, and the whole reason this field
   * exists is that the two are routinely confused.** `attestation` is computed by
   * `classifyAttestation` from the certificates of whoever *answered and signed*; this is
   * what `composeQuorum` *decided* before anybody was asked. A fabric on which the quorum
   * gate never ran produces an identical `attestation` — that is measured, not feared, and
   * it is why VER-03 could not be closed on the receipt's own `sharedRelay` line.
   *
   * **Job-level by construction, carried here off the first shard.** `submitJob` composes
   * once for the whole job — its candidate pool is the same for every shard — and records
   * the answer per shard by label. Every shard `runColouring` submits is `label: 'public'`,
   * so all of them carry that one composition and the first is not a sample of the others,
   * it *is* them. A future caller that mixes labels in one job must not read this field
   * without revisiting that sentence.
   *
   * Rendered through `describeQuorum`, the kernel's own words, on the same passthrough
   * arrangement as `attestation` directly above.
   */
  readonly quorum: ShardQuorum
  /**
   * Whether this run picked up where an earlier one stopped — CHURN-03's read half.
   *
   * **The third stated exception to *the visitor-facing report is untouched*.**
   * {@link TabJobReport.failures} records that rule, {@link attestation} and {@link quorum}
   * are the first two exceptions and both argue the same way: the requirement names a
   * screen. So does this one. A checkpoint that is written and never read back is
   * indistinguishable, from outside, from no checkpoint at all — the whole gap CHURN-03's
   * read half exists to close is that *nothing could observe the resume*. A field that
   * stopped at the harness would reproduce the gap one layer up.
   *
   * See {@link TabResume} for what each arm means. The page renders it as C23.
   */
  readonly resume: TabResume
}

/**
 * What a colouring run did about the checkpoint an earlier run of the same job left —
 * CHURN-03.
 *
 * **Four facts and not one summary**, because the four have four different remedies and a
 * boolean over them would collapse the two that matter most into each other. *Nothing was
 * stored* and *something was stored and refused* both mean "this run computed everything",
 * and only the second says the tab's storage is holding a pointer it should not.
 *
 * Filled by `demo/main.ts#runColouring` from three sources that cannot be derived from one
 * another: {@link offered} and {@link remembered} come from the `IdbCheckpoints` record,
 * {@link carried} is counted off `ShardResult.ending === 'carried-from-checkpoint'` in
 * `submitJob`'s own answer, and {@link refused} is the `SubmitError` kind `submitJob`
 * returned when it would not take the handle. Counting `carried` off the fabric's report
 * rather than off the pointer is the point: the pointer says what was *asked for* and the
 * shards say what was *carried*, and a run where those disagree is exactly a stale pointer.
 */
export interface TabResume {
  /**
   * The name this job answers to in its own checkpoints, derived by `@o2/core`'s `jobIdOf`
   * from the module CID and the ordered input CIDs — the key the handle is filed under.
   *
   * Derived by the page **before** the submit, which is the whole reason `jobIdOf` is
   * exported: a handle must be looked up under the id `submitJob` is about to derive, and
   * `resumeState` refuses by name a handle whose checkpoint belongs to another job.
   */
  readonly jobId: string
  /** The stored handle this run was offered, or `null` when the tab had none for this job. */
  readonly offered: string | null
  /**
   * The `SubmitError` kind that made this run drop {@link offered} and start over, or
   * `null`.
   *
   * Non-null means the pointer outlived the blocks it named — the browser evicted the
   * checkpoint block and kept the record, which `idb-checkpoints.ts` names as a fact about
   * browser storage rather than a corruption. The run recovers by forgetting the pointer
   * and computing everything, so a stale record costs time and never an answer.
   */
  readonly refused: string | null
  /**
   * Cubes whose answer came out of the checkpoint, so this run dispatched them nowhere.
   *
   * `0` on a run that started from nothing **and** on a run whose stored handle was
   * refused; {@link offered} and {@link refused} are what tell those two apart.
   */
  readonly carried: number
  /**
   * The handle this run filed for the next one, or `null` when it confirmed none.
   *
   * Only ever a **confirmed** handle — `StoredCheckpoints.newest()`, which is the newest
   * whose block read back out of the store through the same validating reader a resume
   * would use. Filing an unconfirmed one would leave a pointer resolving to nothing, which
   * is the failure {@link refused} exists to survive, deliberately created.
   */
  readonly remembered: string | null
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
   * **Declining to report is not declining to see**: a visitor who opted out still
   * asks every peer, still merges every answer, and still transmits no outcome of
   * their own — which is the only arrangement in which an opt-out means what it says.
   *
   * What comes back is a *merged* view and no longer only this tab's own row. Every
   * node holds a start-outcome ledger with its own row in it from the moment it starts
   * — `browser-node.ts` and `fabric-node.ts` do it on identical terms, because the only
   * difference between nodes in this fabric is discovery — so a peer answers with
   * something it observed rather than with an empty list, and the merge can carry a
   * browser family the asking tab is not.
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
   * MR-03…MR-07. Estimate pi across shards and merge with a **verified tree-reduce**.
   *
   * The companion of {@link TabApi.runColouring} and deliberately not a replacement for it.
   * A colouring is first-found-wins, so its merge is a scan and there is nothing to aggregate;
   * pi is a sum, so it is the workload the fabric's combiner exists for. Audit findings G3 and
   * G4 were one piece of work for exactly this reason.
   *
   * **Needs a peer.** `reduceJob` excludes the submitter from its executor set by contract, so
   * a lone tab gets `reduceAttempted: false` with the fabric's own reason carried through in
   * `reduceReason`. That is the ordinary state of the first tab on the page, not a failure.
   */
  runPi(options: {
    terms: number
    shards: number
    redundancy: number
    peerIds: string[]
  }): Promise<TabPiRun>
  /**
   * Count the primes at or below `n` across shards, and merge with the same verified tree-reduce.
   *
   * **This method is what closed the open half of audit finding G4**, on 2026-08-17. Until then
   * the prime-counting module shipped in this repository, ran in the Node suite, and had no
   * signed record — so every executor in this fabric, *including the submitting tab's own*,
   * refused a prime-counting dispatch on provenance. The Primes surface carried no run control
   * and said so on screen. `PRIMES_RECORD` (`@o2/demo`) is what changed, and adding it meant
   * re-signing all three demo records under a new anchor.
   *
   * **Why it stands beside {@link runPi} rather than replacing it.** Both are sums, so
   * both exercise the combiner. π's answer is an *estimate* checked against a constant to a
   * stated tolerance; π(x) is an *integer* checked against a published table for equality. The
   * second is the stronger claim and the weaker instrument — see {@link TabPrimesRun} for the
   * oracle's blind spot and for what does close it.
   *
   * **Needs a peer**, on the same terms as {@link runPi}: `reduceJob` excludes the submitter
   * from its executor set by contract, so a lone tab gets `reduceAttempted: false` with the
   * fabric's own reason in `reduceReason`. That is the ordinary state of the first tab on the
   * page, not a failure.
   */
  runPrimes(options: {
    n: number
    shards: number
    redundancy: number
    peerIds: string[]
  }): Promise<TabPrimesRun>
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
    /**
     * The relays this tab dials on the way up — AUTH-02.
     *
     * **A host page supplying this is supplying a front door, and the front door is where
     * admission will be decided.** Today that door is unlocked and the unlock is scheduled
     * rather than accidental: `circuitRelayServer` is constructed with capacity limits and
     * nothing else, no `connectionGater` guards a reservation anywhere in this repository,
     * and every certificate check in the tree decides who to *use* rather than who gets
     * *in*. So any peer completing a Noise handshake against one of these addresses is
     * reserved, advertised and dialable.
     *
     * Phase 24's ruling puts the decision at the reservation, because that is where a
     * node's life in the fabric begins. From then on **the address a page passes here is
     * the address that decides whether this tab joins at all** — which is why it is worth
     * saying at the field rather than in a planning document nobody reading this will open.
     *
     * Two things a page choosing an address should know, neither of them true yet:
     *
     * - **A relay that pins issuers must serve enrolment itself, or name a provider a
     *   joining peer can reach without a reservation.** `RelayAdmission`'s own docblock
     *   carries that as a deployment requirement. It is satisfied today by co-location, and
     *   `browser-enrollment.e2e.test.ts` says so about itself — *"The provider, not the
     *   gate"*, passing the provider's address in this very field.
     * - **The gate fires on the reservation and on nothing else.** A plain connection never
     *   reaches it, and the `enrollment` dial below is a plain connection, so a tab holding
     *   no certificate can still obtain its first one through this same address. That is an
     *   exemption by construction rather than a carve-out somebody has to remember.
     *
     * Nothing here refuses anybody as of 2026-08-06. This states where the decision will be
     * made, so a page choosing an address chooses it knowing that.
     */
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
     * handed, not about what kind of node it is.
     *
     * ## Who supplies it, corrected 2026-08-17
     *
     * This paragraph read *"Every visitor path omits it today: {@link TabApi.autoStart} does
     * not pass it and deliberately grows no parameter for it, for the same reason it grows
     * none for `trustAnchors`."* **The second clause is still exactly true and the first is
     * no longer.** `autoStart` passes no `enrollment` and has grown no parameter for one —
     * that has not changed and must not — but a visitor path now reaches this field, through
     * {@link TabApi.acceptEnrolment}: the implementation reads the visitor's own stored
     * decision and their own non-extractable key, and supplies this itself.
     *
     * So this option keeps exactly one meaning for a *caller*: a harness stating an identity
     * it holds. A caller-supplied value wins over the visitor's stored decision, because a
     * test that names its own key is running its own arrangement and silently substituting
     * the visitor's would make it prove something else.
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
   * The whole of "automatic discovery" from the browser's side. The page fetches the
   * bootstrap document from the host it was itself loaded from, so a phone that opened
   * `http://laptop.local:5173` is told to dial `/dns4/laptop.local/...` — nothing
   * hardcoded, nothing guessed, and no address that can go stale in a build.
   *
   * **CORRECTED 2026-08-31 — it is fetched from TWO paths, not one, and this docblock saying
   * `/bootstrap.json` was part of why that took three days to find.** A seed mounts the
   * document at the origin ROOT while serving the page from a subpath; GitHub Pages and every
   * static host carry it BESIDE the page. Neither is wrong and a bundle cannot know which
   * origin served it, so the page asks beside-the-page first and the root second — see
   * `demo/main.ts`'s `fetchBootstrapDocument`. Asking only one of them was measured breaking
   * the other completely, in both directions, at different times.
   */
  autoStart(options?: { blockstoreName?: string }): Promise<{ peerId: string; relayAddrs: string[] }>
  /**
   * Where this page would look for a relay, without joining.
   *
   * `source` is `'query'` when relays came from `?relay=<multiaddr>`, `'origin'` when
   * they came from a same-origin bootstrap document — beside the page or at the origin
   * root, see {@link autoStart} — and `'none'` when neither is available, which is the
   * normal state on a static host with no relay configured.
   *
   * `enrollmentProvider` is present only when the origin named one — AUTH-01/04. A seed that
   * pins admission issuers is meant to publish where a joiner can enrol, because the peers
   * that need it are exactly the ones it will not yet admit. Absent means the origin named
   * nobody, which is the ordinary state of an open seed and of every static host.
   *
   * **An address, and never an identity.** A certificate is signed over the visitor's own key;
   * `operatorId` and `userPrivateKey` come from the visitor and can come from nowhere else, so
   * discovering this does not make a tab enrollable by whatever served it.
   */
  discoverRelays(): Promise<{
    source: 'query' | 'origin' | 'none'
    relayAddrs: string[]
    enrollmentProvider?: string
  }>
  /**
   * What this origin offers, and what this visitor has already answered — AUTH-01/02/04.
   *
   * **The fourth hop of a four-hop flow whose last hop did not exist.**
   * `enrollmentProvider` was produced by `bin/seed.ts --enrollment-provider`, transported in
   * `/bootstrap.json`, parsed by {@link discoverRelays} — and then dropped, because nothing
   * read it. This is what reads it.
   *
   * It is a **question to put to a person**, and that framing is the whole design. The
   * origin gets to say *where* a joiner may knock; it does not get to decide that this tab
   * knocks, nor to say who it is when it does. So this method answers only what a page needs
   * in order to *ask*, and {@link acceptEnrolment} is the only thing that acts.
   *
   * Nothing here starts, stops or dials, and nothing is written. Calling it on every render
   * is safe and is what the demo does.
   */
  enrolmentOffer(): Promise<TabEnrolmentOffer>
  /**
   * The visitor's answer: yes, enrol me with the provider this origin named.
   *
   * **The one explicit action, and the reason this does not violate the standing objection
   * that a page found rather than configured must not be configurable by whatever found
   * it.** It takes no parameters at all. There is no field on it through which the origin,
   * a harness, an embedding host or a discovered page could name a provider, a key or an
   * operator: the provider comes from the offer the visitor is looking at, the key is minted
   * in this browser and cannot be read by the script that minted it, and the operator id is
   * derived from that key. What this records is a *decision*, and a decision is the one
   * thing an origin cannot fabricate.
   *
   * Persisted and revocable, exactly like {@link grantConsent} — so a returning visitor is
   * not asked twice, and {@link start} may read the answer without anybody having configured
   * anything. {@link declineEnrolment} is the withdrawal.
   *
   * **Does not start or restart the node**, for `grantConsent`'s reason: recording an answer
   * and acting on it are different, and a page that conflated them could not offer the
   * choice before starting. A tab already running must be stopped and started again for the
   * decision to take effect, and the returned {@link TabEnrolmentOffer} says whether that is
   * outstanding.
   *
   * @throws when there is no consent, when this origin published no provider to accept, or
   *   when this origin cannot hold a key the page is unable to read — each by name, because
   *   a visitor who pressed a button is owed the reason it did not work.
   */
  acceptEnrolment(): Promise<TabEnrolmentOffer>
  /**
   * Withdraw the decision: stop the node, forget the answer, and forget the key.
   *
   * All three, deliberately. {@link revokeConsent}'s note — *"A permission withdrawn while
   * work continues would be a permission in name only"* — is the first; the third is the
   * one specific to this decision, because the visitor's key is the identifier a provider
   * knows this person by, and a withdrawal that left it behind would be a preference rather
   * than a withdrawal. The certificate is left where it is: it names a key that no longer
   * exists here, so `resolveCertificate`'s own identity check refuses it, and deleting a
   * signed statement is not this page's business.
   */
  declineEnrolment(): Promise<TabEnrolmentOffer>
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
   *
   * **"Peers already connected are skipped" now means already reachable over a
   * connection that can carry a job** — defect 32. A pair that dialled each other in the
   * same moment can end up holding nothing but a relayed circuit, which `libp2p.getPeers()`
   * reports as connected; a round that skipped every connected peer therefore never
   * retried the upgrade, and the pair sat unusable until the relay's own duration limit
   * tore the circuit down. Such a peer is dialled again, a bounded number of times, and
   * then reported through `relayedOnly` and `stalled`.
   */
  connectDiscoveredPeers(): Promise<TabDiscoveryRound>
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
  /**
   * What the last candidate lookup answered — SCHED-01 — or `null` before the first
   * dispatch of this session.
   *
   * A reading of something that already happened rather than a way to make it happen: the
   * lookup runs inside every dispatch this page makes, because the descriptors it produces
   * are what placement is given. There is deliberately no method that runs one on demand —
   * that would be a second lookup able to disagree with the one the job used, and the
   * question this surface answers is *what did the run I just watched place over*.
   */
  lastCandidates(): TabCandidateLookup | null
  addresses(): TabAddresses
  /** Resolves once a relay reservation has produced a dialable `/webrtc` address. */
  waitForWebrtcAddr(timeoutMs: number): Promise<string[]>
  dial(address: string): Promise<string>
  peers(): string[]
  /**
   * The same set as {@link peers}, with the one fact `peers` cannot carry: whether the
   * connection this tab holds to each of them can carry a job — defect 32.
   *
   * Readable without running a discovery round, deliberately. The state it describes is
   * reached by a race and left by a relay's duration limit, so a caller that could only
   * learn about it as a side effect of dialling would be told about it late or not at all.
   */
  heldPeers(): TabHeldPeer[]
  connectionsTo(peerId: string): TabConnection[]
  putModule(bytes: number[]): Promise<string>
  /**
   * AOT-05's last mile — pull a module's bytes from a content-addressed gateway, verify
   * them against the CID, and put them where this tab's dispatch can reach them.
   *
   * {@link putModule} is the other way bytes get in, and the two are not alternatives.
   * `putModule` takes bytes a caller already has: the page uses it for the kernels this
   * bundle ships, and a harness uses it to plant a fixture. This method is for the case
   * neither covers and which had no route at all until it existed — **a CID for an
   * artifact this bundle does not carry**, which is every artifact `tools/aot/cli.ts` has
   * ever produced. Without it the form could hold the record and never the module, and the
   * fabric answered `module block missing` on every shard.
   *
   * Returns a report and never throws for a refusal: a gateway that answered an error page,
   * bytes that did not hash to the CID, a record naming some other artifact. Those are
   * outcomes the page shows, not exceptions — see {@link FetchReport}.
   *
   * **This is not an admission decision and must not be read as one.** It establishes that
   * the bytes are the bytes the record names. Whether the *record* is signed by a key this
   * tab pins is decided by `guardModuleProvenance` on every executor the shard reaches,
   * including this tab's own, and a module that fetches cleanly here can still be refused
   * there — which is the fabric working.
   */
  fetchModule(options: {
    /** A path-gateway root with a trailing slash and no query string. */
    gatewayBase: string
    /** The CID the dispatch will name. */
    moduleCid: string
    /** The CID the signed record vouches for. Compared against `moduleCid`, never assumed. */
    recordCid: string
    /** The record's name, so a mismatch is worded the way the executor words it. */
    recordName: string
  }): Promise<FetchReport>
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
