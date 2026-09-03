/**
 * `@o2/net` — distributed execution over the `Transport` port.
 *
 * Portable by the same rule as `@o2/core`: no platform imports, no libp2p, no
 * `node:*`. It only knows the ports. That is what lets the two-process Node test
 * and the browser tier share one implementation of remote execution, with the
 * transport itself being the only thing that differs between them.
 */

export { DEFAULT_RPC_TIMEOUT_MS, RpcEndpoint, RpcFailure } from './rpc.ts'
export type { RpcEndpointOptions, RpcError, RpcHandler } from './rpc.ts'

export { encodeRequest, encodeResponse, parseRequest, parseResponse } from './protocol.ts'
export type { AgentRequest, AgentResponse } from './protocol.ts'

// AUTH-02 — the one certificate validator, shared by the wire and the disk path. A
// second, more lenient parser beside it is exactly how a persisted certificate would
// come to be trusted on terms the wire would have refused.
export { decodeNodeRecords, encodeNodeRecords, parseCertificate } from './protocol.ts'

// Enrollment over the fabric's own protocol — AUTH-01, AUTH-04.
export { enrolOverRpc, UNREACHABLE_PROVIDER } from './enrol-client.ts'
export type { EnrolOutcome } from './enrol-client.ts'

export { blockCid, FetchingBlockstore } from './block.ts'
export type { BlockSource } from './block.ts'

export { RemoteExecutor } from './remote-executor.ts'
// AUTH-03 — what a call site names as its third constructor argument. This barrel
// is `@o2/net`'s only entry point (`package.json` declares just `"."`), so a type
// absent from here cannot be named anywhere else, and `isolatedDeclarations` forces
// every exported function returning one to write the name out.
export type { CapabilitySupplier } from './remote-executor.ts'

export {
  NEVER_PAUSES,
  RpcBlockSource,
  declinedWhilePaused,
  pauseMisreported,
  pausedRefusal,
  serveAgent,
} from './agent.ts'
export type {
  AgentOptions,
  AuthorizedWork,
  Authorizer,
  CombineWork,
  DeclinedWhilePaused,
  PauseState,
} from './agent.ts'

// AUTH-03 — the first real `Authorizer`: a chain verified against a pinned owner key.
export { authorizeCapability } from './capability-authorizer.ts'
export type { CapabilityAuthorizerOptions } from './capability-authorizer.ts'

// Dispatching a shard over RPC with the failure kind preserved — CHURN-01, NET-09.
//
// `remoteDispatch` has NO production caller: `runResilient` was its only one and Plan
// 20-12 deleted it, while `submitJob` structurally cannot use it. It is kept because it
// holds NET-09's `'sender'` classification, which exists nowhere else, and the debt is
// named with its owner phase in the module's own header. The three types below moved here
// from `@o2/core`'s deleted `coordinator.ts` in the same plan — this is the only module
// that still reads them.
export { remoteDispatch } from './churn.ts'
export type {
  DispatchOutcome,
  RemoteDispatchOptions,
  ShardDispatch,
  ShardWork,
} from './churn.ts'

// Dispatching a combine over RPC — MR-05, MR-06.
export { LocalStoreWriteFailed, remoteCombineDispatch } from './combine.ts'
export type { RemoteCombineOptions } from './combine.ts'

// Turning a JobResult into a reduce over connected peers — MR-04…MR-07.
export { reduceJob } from './reduce-job.ts'
// VER-08/09/10 — the AGGREGATION's own receipt, which is not the map half's. This barrel
// is `@o2/net`'s only entry point, so a type absent from here cannot be named anywhere
// else: `bin/bench.ts` prints both receipts and has to be able to write this one's name.
export type {
  AggregateAttestation,
  CombinePlacement,
  CombineTrustAnchors,
  ContributorAttribution,
  NoVerifiedAggregation,
  ReduceJobOptions,
  ReduceJobResult,
} from './reduce-job.ts'

// The SOVEREIGN arm of the aggregation — MR-02. `reduceJob` above aggregates whatever
// it is handed; this one aggregates owner-pinned partials and attaches the claim that
// makes them sovereign. See `reduce-sovereign.ts` for what "verified aggregation" means.
export { MIN_SOVEREIGN_COMBINE_REPLICAS, reduceSovereignJob } from './reduce-sovereign.ts'
export type {
  SovereignAggregate,
  SovereignContribution,
  SovereignEgressEvidence,
  SovereignEgressReading,
  SovereignReduceOptions,
  SovereignReduceResult,
} from './reduce-sovereign.ts'

// Discovery and admission over RPC — SCHED-01, SCHED-03, NET-06.
export { DEFAULT_PROBE_TIMEOUT_MS, RpcRecordIndex, rpcAdmission } from './discovery.ts'
// `LocalAdmission` joins `AdmissionOptions` here because Phase 36 gave it a second
// implementer: `BrowserNode.localAdmission` answers a tab's own offers by the same rule
// `serveAgent` applies to a peer's. A type, so it is outside `reachability-guard`'s
// jurisdiction by construction.
export type { AdmissionOptions, LocalAdmission } from './discovery.ts'

// SCHED-01's requestor half — a data CID and a peer list become dispatchable
// candidates. The bridge `discoverExecutors` never had: it answers in node keys and
// a transport is addressed by peer ids.
export { discoverCandidates } from './discover-candidates.ts'
export type { CandidateOptions, CandidateSet } from './discover-candidates.ts'

// DATA-02 — one addressing contract, checked against every Blockstore adapter.
export { BLOCK_VECTORS, CONFORMANCE_BLOCK_COUNT, checkBlockstoreConformance } from './conformance.ts'
export type { BlockVector, ConformanceReport } from './conformance.ts'

// SCHED-04 / BROW-03 — the governor applied to the execution path.
export { GovernedExecutor } from './governed-executor.ts'

// SCHED-06 — the instrument a node's execution concurrency is read off.
export { CountingExecutor } from './counting-executor.ts'

// Egress control — DATA-04, DATA-05.
export { EgressGuard, EgressRefusal } from './egress.ts'
export type { EgressEntry, EgressHold, EgressManifest } from './egress.ts'
export { takeSovereignHold, withholdingFrom } from './sovereign-egress.ts'
export type { EgressDisposition, SovereignEgressOptions, SovereignCids } from './sovereign-egress.ts'
export { sliceManifest, submitJobWithEgress } from './submit-with-egress.ts'
export type { SubmitWithEgressResult } from './submit-with-egress.ts'

// Start-outcome publication and read-back — BROW-02.
export { DEFAULT_MAX_PEERS, publishStartOutcome } from './start-report.ts'
export type { PublishOptions, PublishResult } from './start-report.ts'

// Finding browsers that cannot announce themselves — NET-03.
export { findReservedPeers, MAX_RESERVED_PEERS_PER_ANSWER, serveReservations } from './rendezvous.ts'
export type { Rendezvous, RendezvousOptions } from './rendezvous.ts'


// RUN-04 / RUN-05 — the connectivity funnel's wire contract, read by the browser tier that
// composes a report and by the hosted tier that banks it. It lives in `@o2/net` rather than in
// `@o2/core` because `packages/cloudflare/package.json` declares `@o2/net` and does not declare
// `@o2/core`, which is the same reason `protocol.ts` and `start-report.ts` are here.
//
// **Three callables and no more, and the count is deliberate.** `reachability-guard.node.test.ts`
// holds every unreachable callable barrel export by NAME in a register, and everything below
// `BootstrapObject.fetch` is unreachable for this tier's standing reason — the Workers runtime
// invokes it and no call expression in this repository does. So each callable published here
// costs a register row. `parseFunnelReport` is published because a wire contract's parser
// belongs beside the contract (the `parseRequest`/`parseResponse` precedent, four blocks up);
// `isFunnelCountry` and `isFunnelNetworkClass` because `@o2/cloudflare` reads two headers and
// must check them against the ranges declared here rather than against a second copy. The four
// remaining predicates stay module-private: `parseFunnelReport` uses them and nothing else
// does.
export {
  FUNNEL_CELL_BOUNDS,
  FUNNEL_CONNECTION_CLASSES,
  FUNNEL_FIELDS,
  FUNNEL_HOUR_BUCKETS,
  FUNNEL_MAX_CELLS,
  FUNNEL_NETWORK_CLASSES,
  FUNNEL_POPULATION,
  FUNNEL_QUESTIONS,
  FUNNEL_RECORD_CEILING_BYTES,
  FUNNEL_SCHEMA_DIGEST,
  FUNNEL_SCHEMA_FROZEN_AT,
  FUNNEL_STAGES,
  FUNNEL_UNKNOWN_COUNTRY,
  FUNNEL_WEBRTC_STAGES,
  isFunnelCountry,
  isFunnelNetworkClass,
  MEASURED_STORAGE_WALL_BYTES,
  parseFunnelReport,
} from './funnel-schema.ts'
export type {
  FunnelConnectionClass,
  FunnelField,
  FunnelFieldDomain,
  FunnelNetworkClass,
  FunnelPopulation,
  FunnelQuestion,
  FunnelReport,
  FunnelStage,
  FunnelTotals,
} from './funnel-schema.ts'
