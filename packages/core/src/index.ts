/**
 * `@o2/core` — the portable kernel.
 *
 * Every export is a pure function, a class over injected ports, or a type. No
 * platform imports, no I/O, no libp2p. That constraint is what lets the identical
 * kernel run in Node, in a browser tab, and inside a Worker with no
 * target-specific branches — and it is what makes the later transport swap a
 * one-adapter change rather than a rewrite.
 */

// Ports — the kernel's entire contact surface with the outside world.
export type {
  Blockstore,
  ComputeThread,
  ComputeThreadFactory,
  ExecutionOutcome,
  Executor,
  Governor,
  Task,
  Transport,
} from './ports.ts'
// NET-09 — the marker a Transport raises when *this* node declined to send.
export { SendRefused } from './ports.ts'

// Hashing — pure JS, so it works outside a secure context. See hash.ts.
export { SHA256_CODE, sha256 } from './hash.ts'

// Canonical encoding — DET-05.
export { NotEncodableError, canonicalCid, decodeCanonical, encodeCanonical } from './canonical/encode.ts'
export type {
  CanonicalValue,
  EncodeError,
  EncodeResult,
  HashResult,
} from './canonical/encode.ts'

// Execution — DET-06.
export { MAX_PARTITIONS, TASK_ENTRYPOINT, WasmExecutor } from './executor/wasm.ts'
export type { WasmExecutorOptions } from './executor/wasm.ts'
// The cross-thread ABI both tiers speak, and the executor that bounds it.
export { runTask, runTaskAndPost } from './executor/task-run.ts'
export type { WorkerTaskRequest, WorkerTaskResponse } from './executor/task-run.ts'
export { DEFAULT_TASK_DEADLINE_MS, WorkerExecutor } from './executor/worker-executor.ts'
export type { WorkerExecutorOptions } from './executor/worker-executor.ts'

// Redundant execution and verification — VER-01, VER-05, VER-06.
export { executeVerified } from './job/verify.ts'
export type { AgreeingReplica, Receipt, VerificationResult } from './job/verify.ts'

// The two-round ceremony — VER-02.
//
// **Exactly what the serving side needs to produce a commitment, and nothing more.**
// `executeCommitReveal`, `isCommitting` and `MIN_CEREMONY_REPLICAS` are deliberately
// absent: they are what `submitJob` uses to choose a path, and a barrel export of them
// would be a second way to run a job — WIRE-04's rule, which `job-entry-points.node.test.ts`
// enforces against this file by name. `submitJob` is the entry point; the ceremony is how
// it verifies, not an alternative to it.
//
// What crosses the package boundary is the executing node's half: `@o2/net`'s
// `serveAgent` draws a nonce and computes a digest over its own answer, and its
// `protocol.ts` bounds the nonce on the wire.
export { CEREMONY_NONCE_BYTES, commitmentDigest, drawCeremonyNonce } from './job/commit-reveal.ts'
export type {
  CommitOutcome,
  Commitment,
  CommittingExecutor,
  RevealOutcome,
} from './job/commit-reveal.ts'

// Job submission — MR-01, DATA-01, DATA-03, DATA-04.
export { submitJob } from './job/submit.ts'
// VER-03, VER-04. The composer's verdict, in one set of words for every surface that
// shows it. Exported here for the same reason `describeAttestation` is: a display site
// outside this package that formats the value itself becomes a second author of the
// sentence, and two authors of one sentence eventually describe one result two ways.
export { describeQuorum } from './job/submit.ts'
// CHURN-03's read half. **Not a second way to run a job** — WIRE-04's rule, which
// `job-entry-points.node.test.ts` enforces against this file by name, is about entry points
// that dispatch work, and this dispatches nothing: it hashes two content addresses into the
// name a job answers to in its own checkpoints.
//
// It is here because a resume needs that name *before* the submit that derives it. A stored
// handle must be filed under something, `resumeState` refuses a handle whose checkpoint names
// another job, and so the key can only be this id — see `idb-checkpoints.ts`, whose whole
// docblock is that argument. Without this export a returning tab would have to re-implement
// the derivation, and the day the two spellings drifted every resume would be refused by name
// with nothing saying why.
export { jobIdOf } from './job/submit.ts'
export type {
  JobResult,
  JobSpec,
  // VER-09, VER-10. Added by Plan 19-10 because a display site outside this package
  // cannot name what it is rendering without them: `bin/bench.ts` prints a rung's
  // strength and the demo UI (19-11) renders the same value. 19-06 defined all three
  // and deliberately left the barrel alone — that file was under concurrent edit — and
  // 19-CONTEXT.md records the handoff. Types only: nothing new is *callable* from here.
  NoVerifiedAttestation,
  ShardAttestation,
  ShardQuorum,
  ShardResult,
  ShardSpec,
  SubmitError,
  SubmitOptions,
  SubmitResult,
} from './job/submit.ts'

// Adapters.
export { MemoryBlockstore } from './blockstore/memory.ts'
export { MemoryNetwork, TransportError } from './transport/memory.ts'
export type { SendError } from './transport/memory.ts'
export { DutyCycleGovernor } from './governor.ts'
export type { DutyCycleOptions, Sleep } from './governor.ts'

// Sovereignty and placement — DATA-03, DATA-06, DATA-09.
export { eligibleNodes, planPlacement, publicNodes } from './sovereignty.ts'
export type {
  NodeDescriptor,
  OwnerId,
  Placement,
  PlacementPlan,
  PlacementRequest,
  Sovereignty,
} from './sovereignty.ts'

// Serving-side sovereignty gate — DATA-09.
export { guardSovereignty } from './executor/sovereignty-guard.ts'
export type { NodeSovereignty } from './executor/sovereignty-guard.ts'

// Serving-side signed-artifact gate — DET-03, DATA-08.
export { describeModuleRefusal, guardModuleProvenance } from './executor/module-provenance.ts'
export type { ModuleProvenance, ModuleRefusal } from './executor/module-provenance.ts'

// Leg 3's wrapper, beside leg 1's above. Composed nowhere until Plan 19-15.
export { attestResults } from './executor/attesting-executor.ts'
export type { ResultAttestor } from './executor/attesting-executor.ts'

// Power-of-d placement with rejection and re-pick — SCHED-02, SCHED-03, SCHED-05.
export {
  DEFAULT_D,
  DEFAULT_MAX_CONCURRENT_TASKS,
  LocalCapacity,
  MAX_D,
  MIN_D,
  placeWithOffers,
  planWithOffers,
  sampleCandidates,
} from './placement.ts'
export type {
  Admission,
  AdmissionControl,
  CapacityOptions,
  NodeCapacity,
  Offer,
  OfferedPlacement,
  OfferOptions,
  OfferStanding,
  Rejection,
} from './placement.ts'

// Task leases and re-dispatch — CHURN-04, and the history CHURN-01 needs.
export {
  DEFAULT_LEASE_MS,
  DEFAULT_MAX_GENERATIONS,
  LeaseTable,
  RENEW_AT,
  checkLease,
  shouldRenew,
} from './lease.ts'
export type { Lease, LeaseCheck, LeaseEvent, LeaseTableOptions, Reaped } from './lease.ts'

// Speculative duplication of stragglers — CHURN-02, CHURN-06.
//
// `settleRace` stood between `median` and `speculativeCandidates` until 2026-08-18 and is
// **retired from the barrel, not deleted**: `speculation.ts` still declares it and
// `speculation.test.ts` still holds it, module-relative. What is retired is the claim that
// it is a capability of `@o2/core`, and the one site that would consume it refuses it in
// writing on a **correctness** ground rather than a preference — `job/submit.ts`, at the
// comparison it would replace: *"It re-derives the winner from arrival instants and ties
// break on node id — so on a clock that reports the same instant for both, it could name
// the loser as the winner, overturning a decision this module has already taken and
// already closed a lease against."* Publishing it on the barrel invites the next reader to
// do the thing that comment exists to stop.
export {
  DEFAULT_SPECULATION_FRACTION,
  DEFAULT_STRAGGLER_FACTOR,
  MIN_SAMPLES,
  SpeculationLedger,
  median,
  speculativeCandidates,
  stragglers,
} from './speculation.ts'
export type {
  Discarded,
  InFlight,
  RaceLoser,
  RaceOutcome,
  SpeculativeAnswer,
  StragglerOptions,
} from './speculation.ts'

// Coordinator state as a content-addressed block — CHURN-03.
export {
  checkpointChain,
  checkpointOf,
  // CHURN-03's write half. Exported because the only store in the fabric that outlives
  // its process is a browser tab's, and `browser/demo/main.ts` is outside this package —
  // a sink it cannot import is a sink no shipped entry point can supply.
  checkpointsInto,
  // `isComplete` is deliberately NOT here — retired from this barrel on 2026-08-18. The
  // declaration and its cases stay in `checkpoint.ts`, which says at the declaration why
  // re-exporting it would be a mistake rather than a convenience.
  readCheckpoint,
  recoverCheckpoint,
  remainingWork,
  writeCheckpoint,
} from './checkpoint.ts'
export type {
  CheckpointFailure,
  CheckpointResult,
  CompletedShard,
  JobCheckpoint,
  RecoveredCheckpoint,
  StoredCheckpoints,
  UnconfirmedHandle,
} from './checkpoint.ts'

// Start outcomes and the blocking metric — BROW-02.
//
// `startReport` stood between `isStartBrowserLabel` and `startReportFromCounts` until
// 2026-08-18 and is **retired from the barrel, not deleted** — superseded, on this
// package's own production path, by the fold beside it. Nothing in the tree ever holds a
// `readonly StartOutcome[]` to hand it: `StartOutcomeLedger#report()` calls
// `startReportFromCounts` directly and both node getters read that ledger. The declaration
// stays, and `start-outcome.test.ts` states why at the case that uses it.
export {
  BROWSER_FAMILIES,
  MAX_BROWSER_MAJOR,
  MIN_REPORTS_FOR_RATE,
  START_FAILURES,
  STRUCTURAL_BLIND_SPOT,
  StartOutcomeLedger,
  describeStartReport,
  isStartBrowserLabel,
  startReportFromCounts,
} from './start-outcome.ts'
export type {
  BlindSpot,
  BrowserFamily,
  BrowserTally,
  CauseCount,
  OutcomeCount,
  StartFailure,
  StartOutcome,
  StartReport,
  StartReportOptions,
  StartReportingConsent,
  StartResult,
} from './start-outcome.ts'

// Coverage over owners — CHURN-05.
export { coverageOf, describeCoverage, withCoverage } from './coverage.ts'
export type { CoverageReport, CoveredAggregate } from './coverage.ts'

// There is no second job entry point here, and that is deliberate — WIRE-04.
//
// `./coordinator.ts` used to stand here and export `runResilient`, a whole second job
// implementation with its own options, its own outcome and its own six types. Plan 20-12
// deleted it: WIRE-04 asks that submitting a job get lease renewal, speculation and
// coverage accounting *"without the caller choosing between two functions"*, and a barrel
// export is exactly a caller's choice. Its machinery now runs inside `submitJob`, which
// four production submitters actually call.
//
// `submitJob` is exported from `./job/submit.ts` below and is the only way to run a job.
//
// Two checks hold that, and this comment holds neither of them. **The sentence here until
// 2026-08-05 named `job-entry-point.test.ts`, and no file of that name has ever existed in
// this repository** — the string occurred on this one line in the whole tree, which is the
// defect this project keeps re-finding: a comment that reads like evidence. Cited by
// grep-able symbol rather than by file name alone, because that is what rotted:
//
//   - `describe('WIRE-04 — the barrel offers exactly one way to run a job'` in
//     `packages/core/src/job/submit.test.ts` — this barrel's own `Object.keys`, pinned as a
//     set, with `export { submitJob as runResilient }` planted against it.
//   - `describe('WIRE-04 — every barrel in the workspace offers at most one way to run a job'`
//     in `packages/node/src/job-entry-points.node.test.ts` — the same predicate over **all
//     eight** workspace barrels, because the check above reads this file and nothing else,
//     and `@o2/net` already exports a job-shaped `submitJobWithEgress` it never saw.
//
// Where the deleted exports went: `ShardWork`, `DispatchOutcome` and `ShardDispatch` moved
// to `@o2/net`'s `churn.ts`, the only module that still reads them. `DEFAULT_WATCHDOG_MS`
// is `DEFAULT_SPECULATION_WATCHDOG_MS` in `./job/submit.ts`. `DEFAULT_MAX_TASK_FAILURES`,
// `CoordinatorOptions`, `CoordinatorOutcome` and `ShardOutcome` went with the module —
// see `20-12-SUMMARY.md` for the case-by-case accounting.

// Discovery from a data CID — SCHED-01, NET-06.
//
// `SelfRecordIndex` is the production answer to `providers` — SCHED-01. Every node
// answers about its own store at ask time, so nothing is announced and nothing goes
// stale; see its class doc for owner ruling D1 and for where the only correct
// withholding predicate comes from.
export {
  DuplicateExtensionError,
  compareExtensionIds,
  discoverExecutors,
  FallbackRecordIndex,
  MemoryRecordIndex,
  SelfRecordIndex,
  publishCapabilities,
  verifyCapabilityRecord,
} from './discovery.ts'
export type {
  CapabilityExtension,
  CapabilityRecord,
  DiscoveredExecutor,
  DiscoveryOptions,
  DiscoveryResult,
  Exclusion,
  ExclusionReason,
  ExecutorQuery,
  IndexSource,
  NodeRecords,
  RecordIndex,
  SelfRecordIndexOptions,
} from './discovery.ts'

// Capability chains — AUTH-03, DET-03.
export { delegate, DelegationSignerMismatchError, delegateWith, describeFailure, fromHex, toHex, verifyChain } from './capability.ts'
export type { Ability, ChainFailure, ChainResult, Delegation, DelegationSigner, PublicKeyHex, VerifyOptions } from './capability.ts'

// X.509 v3 certificate profile — X509-01…07, additive alongside NodeCertificate.
export { decodeX509Certificate, describeX509Failure, MAX_CERTIFICATE_BYTES, MAX_EXTENSION_BYTES, MAX_EXTENSION_COUNT } from './x509.ts'
export type { X509Certificate, X509Failure, X509Result } from './x509.ts'

// Signed artifact names — DATA-07, DATA-08.
export {
  decodeNameRecord,
  describeResolveFailure,
  encodeNameRecord,
  SignedNameResolver,
  signNameDelegation,
  signName,
} from './naming.ts'
export type { NameDelegation, NameRecord, ResolveFailure, ResolveResult } from './naming.ts'

// Decomposable tree-reduce — MR-02 through MR-07.
export {
  DEFAULT_FANOUT,
  MAX_COMBINE_INPUTS,
  LOCAL_COMBINE_EXECUTOR,
  MAX_PARTIAL_BYTES,
  asFabricPartial,
  deriveReduceTree,
  executeReduce,
  fabricCombiner,
  localDispatch,
  rendezvousRank,
} from './reduce.ts'
export type {
  CombineDispatch,
  CombineProduct,
  CombineTask,
  Combiner,
  FabricPartial,
  LocalCombineAdmission,
  LocalCombinePlacement,
  ReduceContribution,
  ReduceLeaf,
  ReduceOutcome,
  ReduceRun,
  ReduceTree,
  ReduceTreeNode,
} from './reduce.ts'

// Enrollment and node identity — AUTH-01, AUTH-02, AUTH-04, AUTH-05.
export {
  // The one window both budgets are measured over, read by a durable ledger's compaction
  // as well as by the authority — see `IssuanceLedger` for why a host that guessed it
  // would widen a budget with nothing failing.
  DEFAULT_ISSUANCE_WINDOW_MS,
  // Certificates one user key may obtain per window — a blast-radius bound on accidents
  // and NOT a defence, which is why it is exported: a test that wants to witness the
  // refusal has to be able to name the number, and a reader who takes it for anti-abuse
  // is the failure mode its own doc warns about.
  // The renewal half of AUTH-04. Exported because both platform tiers run the loop and
  // neither may hand-roll the arithmetic: a tier that renewed on a different fraction
  // would be a tier with a different reachability window, and nothing in a certificate
  // says which one produced it. `CERTIFICATE_RENEW_AT` is exported for the same reason
  // `DEFAULT_MAX_PER_WINDOW` is — a test that witnesses the timing has to name it.
  CERTIFICATE_RENEW_AT,
  // The revocation window, because expiry is the only revocation this fabric has.
  DEFAULT_CERTIFICATE_LIFETIME_MS,
  // The single cell a renewing node's certificate lives in. Exported because both tiers
  // construct one and `@o2/libp2p`'s renewal loop writes through it.
  CertificateHolder,
  DEFAULT_MAX_PER_WINDOW,
  // How long a minted enrolment challenge stays spendable, and the number a
  // `stale-challenge` refusal carries so the joiner it refused knows the window it missed.
  ENROLLMENT_CHALLENGE_TTL_MS,
  EnrollmentAuthority,
  challengeAnswerBytes,
  possessionChallenge,
  msUntilRenewalDue,
  requestEnrollment,
  resolveReplicaSets,
  shouldRenewCertificate,
  // The WebCrypto arm of `UserSigner`: turns a non-extractable `CryptoKey` pair into the
  // thing `requestEnrollment` asks for, so a visitor's owner key can be one the page that
  // rendered it cannot read. Both platform tiers call this when their `enrollment` option
  // is handed a `CryptoKeyPair` rather than bytes.
  subtleUserSigner,
  verifyCertificate,
} from './enrollment.ts'
export type {
  AuthorityOptions,
  CertificateFailure,
  CertificateResult,
  // The freshness half of AUTH-01: what a provider mints, what a node signs back, and the
  // not-yet-addressed request that can answer one. See `enrollment.ts`' header for why
  // this is checked at the wire boundary rather than inside `enrol`.
  ChallengeAnswer,
  EnrollmentChallenge,
  EnrollmentRefusal,
  EnrollmentRefused,
  EnrollmentRequest,
  EnrollmentResult,
  Freshness,
  PendingEnrollment,
  // The issuance budget and the port both budgets read. A host supplies the second; how
  // it makes a write durable is the host's problem, on each tier.
  IssuanceBudget,
  IssuanceHistory,
  IssuanceLedger,
  NodeCertificate,
  Discoverability,
  ReplicaSet,
  // The user's half of an enrolment as a *capability to sign* rather than as key material
  // — the port `crypto.subtle` fits through, and the reason `requestEnrollment` is async.
  UserSigner,
} from './enrollment.ts'

// The third signing leg — a result the node that produced it signed. VER-08, VER-09,
// VER-10. The other two legs are `guardModuleProvenance` (the code) and
// `verifyCertificate` (the node), both above.
export {
  WrongSigningKeyError,
  combineChallenge,
  resultChallenge,
  signCombine,
  signResult,
  signingKeyOf,
  verifyCombineAttestation,
  verifyResultAttestation,
} from './result-attestation.ts'
export type {
  AttestationRefusal,
  AttestationResult,
  AttestedResult,
  ResultAttestation,
  ResultSigner,
  ResultWork,
} from './result-attestation.ts'

// Quorum composition and attestation strength — VER-03, VER-04, VER-08, VER-09, VER-10.
export {
  attestationRank,
  attestationReceipt,
  classifyAttestation,
  composeQuorum,
  describeAttestation,
  sharedRelay,
} from './quorum.ts'
export type {
  AttestationReceipt,
  AttestationStrength,
  QuorumRefusal,
  QuorumResult,
  QuorumRules,
} from './quorum.ts'

// Ed25519 dual-port verifier — owner ruling 2026-08-09, adapter ruling 2026-08-09
// (second, same day). No production caller yet; see `ed25519-backend.test.ts`'s
// migration-pricing-and-wiring-decision docblock for why.
//
// Phase 28, Plan 28-01: `packages/core` now holds **one** Ed25519 selection mechanism
// instead of two, and its gate is a real `subtle.generateKey({name:'Ed25519'})`
// round-trip probe rather than the presence-only check this module used to carry.
// Two callable exports left with the merge and are named in `28-01-SUMMARY.md`: the
// WASM-fallback sync factory, which took `libsodium-wrappers` out of the code path,
// and the standalone subtle async verifier, which was a duplicate of the `subtle`
// arm's own verify. (Named descriptively rather than by identifier so this comment is
// not itself a hit for the greps that check they are gone.) Five callable exports
// remain and **nothing was added**: the merged module's crypto-backend symbols
// (`createCryptoBackend`,
// `nobleCryptoBackend`, `subtleCryptoBackend`) and `cert-lifecycle.ts`'s facades are
// deliberately off this barrel. Barrel-exporting the facade surface is an owner
// non-decision (28-CONTEXT.md `<deferred>` §2), and adding them here would take it by
// side effect.
//
// **The price is +7 callable exports, RE-MEASURED 2026-08-13 against a repaired tracer:
// 71 → 78 unreachable, and OPEN_FINDING_CEILING 29 → 36.** It read *"72 → 79 … 36 → 43"* until
// then, measured 2026-08-11 and correct on that day's base. The base moved when
// `packages/node/src/reachability.ts` learned two edge classes it had been dropping (see that
// file's `36 → 29` note in `reachability-dispositions.ts`), and this figure was **re-measured
// rather than re-derived**: the seven exports were added to the bottom of this file, both
// ceilings set to 0, the guard run, and the line removed and `cmp`-verified against a snapshot
// taken immediately before. 72 − 1 and 79 − 1 also give 71 and 78, and that agreement was not
// taken as the proof. The **price is unchanged at +7** and the same seven symbols are named by
// the guard. Every figure in the two sentences that stood here was
// wrong, and the count itself was the largest error. It read *"12 callable exports … 73 → 85
// … 37 → 49"*, and said in the same breath that the `+12` had never been re-measured because
// checking it would take the decision this comment exists to avoid. It has now been checked
// and put back: the facades were exported here, both ceilings set to 0, the guard run, the
// exports removed and `cmp`-verified against a pre-plant snapshot. Seven symbols arrive, not
// twelve — `Subject`, `Issuer`, `Verifier`, `Directory`, `createSubject`, `createIssuer`,
// `createVerifier`. `ARGON2_PARAMS` is a `const`, so `other-value` and never in jurisdiction,
// the same arithmetic that made `x509.ts`'s five new exports move the count by two; and
// `signCertificate`/`deriveKeySeeds` do not become findings because the graph reaches them
// through their own in-module callers, which is that guard's known over-connection rather than
// a production path. So **+7 is a lower bound on the uncounted surface, not a full accounting**.
//
// The left-hand figures moved too, and for a reason outside this file: the X.509 wiring gave
// `decodeX509Certificate` and `describeX509Failure` a production caller in `enrollment.ts`, so
// the two bounds came down 74 → 72 and 38 → 36 with it.
//
// **A price is not the whole reason these stay off the barrel.** The facades have no consumer:
// `cert-lifecycle.ts` is imported by nothing in the production corpus — measured, and it is one
// of 27 such modules — and the X.509 wiring that landed on the trust path this week built on
// `enrollment.ts`'s `NodeCertificate` and `x509.ts`, not on these. Exporting them would pay 7
// findings to make an unused surface reachable-looking. They are counted where they actually
// live instead: `reachability-guard.node.test.ts`'s *"a module that reaches no barrel is
// counted, not invisible"* block names this module and holds both facts still.
export {
  createNobleSyncVerifier,
  Ed25519NotInitializedError,
  // The visitor key's minter, exported because CRYPTO-01 forbids `@o2/browser` from
  // holding its own `generateKey` call — the one production file permitted to perform
  // WebCrypto Ed25519 operations is `ed25519-backend.ts`, so the call lives there and
  // crosses the barrel rather than being duplicated at its caller.
  generateSubtleKeyPair,
  getAsyncVerifier,
  getSyncVerifier,
  initEd25519,
} from './ed25519-backend.ts'
export type { Ed25519AsyncVerifier, Ed25519Backend, Ed25519SyncVerifier } from './ed25519-backend.ts'
