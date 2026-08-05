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

// Redundant execution and verification — VER-01, VER-02, VER-05, VER-06.
export { executeVerified } from './job/verify.ts'
export type { AgreeingReplica, Receipt, VerificationResult } from './job/verify.ts'

// Job submission — MR-01, DATA-01, DATA-03, DATA-04.
export { submitJob } from './job/submit.ts'
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
export {
  DEFAULT_SPECULATION_FRACTION,
  DEFAULT_STRAGGLER_FACTOR,
  MIN_SAMPLES,
  SpeculationLedger,
  median,
  settleRace,
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
  isComplete,
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
} from './checkpoint.ts'

// Start outcomes and the blocking metric — BROW-02.
export {
  BROWSER_FAMILIES,
  MAX_BROWSER_MAJOR,
  MIN_REPORTS_FOR_RATE,
  START_FAILURES,
  STRUCTURAL_BLIND_SPOT,
  StartOutcomeLedger,
  describeStartReport,
  isStartBrowserLabel,
  startReport,
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

// The resilient run loop where the churn criteria compose — CHURN-01.
export {
  DEFAULT_MAX_TASK_FAILURES,
  DEFAULT_WATCHDOG_MS,
  runResilient,
} from './coordinator.ts'
export type {
  CoordinatorOptions,
  CoordinatorOutcome,
  DispatchOutcome,
  ShardDispatch,
  ShardOutcome,
  ShardWork,
} from './coordinator.ts'

// Discovery from a data CID — SCHED-01, NET-06.
//
// `SelfRecordIndex` is the production answer to `providers` — SCHED-01. Every node
// answers about its own store at ask time, so nothing is announced and nothing goes
// stale; see its class doc for owner ruling D1 and for where the only correct
// withholding predicate comes from.
export {
  discoverExecutors,
  FallbackRecordIndex,
  MemoryRecordIndex,
  SelfRecordIndex,
  publishCapabilities,
  verifyCapabilityRecord,
} from './discovery.ts'
export type {
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
export { delegate, describeFailure, fromHex, toHex, verifyChain } from './capability.ts'
export type { Ability, ChainFailure, ChainResult, Delegation, PublicKeyHex, VerifyOptions } from './capability.ts'

// Signed artifact names — DATA-07, DATA-08.
export { describeResolveFailure, SignedNameResolver, signName } from './naming.ts'
export type { NameRecord, ResolveFailure, ResolveResult } from './naming.ts'

// Decomposable tree-reduce — MR-02 through MR-07.
export {
  DEFAULT_FANOUT,
  MAX_COMBINE_INPUTS,
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
  EnrollmentAuthority,
  possessionChallenge,
  requestEnrollment,
  resolveReplicaSets,
  verifyCertificate,
} from './enrollment.ts'
export type {
  AuthorityOptions,
  CertificateFailure,
  CertificateResult,
  EnrollmentRefusal,
  EnrollmentRequest,
  EnrollmentResult,
  // The issuance budget and the port both budgets read. A host supplies the second; how
  // it makes a write durable is the host's problem, on each tier.
  IssuanceBudget,
  IssuanceHistory,
  IssuanceLedger,
  NodeCertificate,
  Discoverability,
  ReplicaSet,
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
