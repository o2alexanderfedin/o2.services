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

export { blockCid, FetchingBlockstore } from './block.ts'
export type { BlockSource } from './block.ts'

export { RemoteExecutor } from './remote-executor.ts'
// AUTH-03 — what a call site names as its third constructor argument. This barrel
// is `@o2/net`'s only entry point (`package.json` declares just `"."`), so a type
// absent from here cannot be named anywhere else, and `isolatedDeclarations` forces
// every exported function returning one to write the name out.
export type { CapabilitySupplier } from './remote-executor.ts'

export { RpcBlockSource, serveAgent } from './agent.ts'
export type { AgentOptions, Authorizer } from './agent.ts'

// AUTH-03 — the first real `Authorizer`: a chain verified against a pinned owner key.
export { authorizeCapability } from './capability-authorizer.ts'
export type { CapabilityAuthorizerOptions } from './capability-authorizer.ts'

// Dispatching a shard over RPC with the failure kind preserved — CHURN-01.
export { remoteDispatch } from './churn.ts'
export type { RemoteDispatchOptions } from './churn.ts'

// Dispatching a combine over RPC — MR-05, MR-06.
export { remoteCombineDispatch } from './combine.ts'
export type { RemoteCombineOptions } from './combine.ts'

// Turning a JobResult into a reduce over connected peers — MR-04…MR-07.
export { reduceJob } from './reduce-job.ts'
export type { ReduceJobOptions, ReduceJobResult } from './reduce-job.ts'

// Discovery and admission over RPC — SCHED-01, SCHED-03, NET-06.
export { DEFAULT_PROBE_TIMEOUT_MS, RpcRecordIndex, rpcAdmission } from './discovery.ts'
export type { AdmissionOptions } from './discovery.ts'

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
export { takeSovereignHold } from './sovereign-egress.ts'
export type { SovereignEgressOptions } from './sovereign-egress.ts'
export { sliceManifest, submitJobWithEgress } from './submit-with-egress.ts'
export type { SubmitWithEgressResult } from './submit-with-egress.ts'

// Start-outcome publication and read-back — BROW-02.
export { DEFAULT_MAX_PEERS, publishStartOutcome } from './start-report.ts'
export type { PublishOptions, PublishResult } from './start-report.ts'

// Finding browsers that cannot announce themselves — NET-03.
export { findReservedPeers, MAX_RESERVED_PEERS_PER_ANSWER } from './rendezvous.ts'
export type { Rendezvous, RendezvousOptions } from './rendezvous.ts'
