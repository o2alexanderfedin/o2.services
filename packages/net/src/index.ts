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

export { RpcBlockSource, serveAgent } from './agent.ts'
export type { AgentOptions, Authorizer } from './agent.ts'

// Dispatching a shard over RPC with the failure kind preserved — CHURN-01.
export { remoteDispatch } from './churn.ts'
export type { RemoteDispatchOptions } from './churn.ts'

// Discovery and admission over RPC — SCHED-01, SCHED-03, NET-06.
export { DEFAULT_PROBE_TIMEOUT_MS, RpcRecordIndex, rpcAdmission } from './discovery.ts'
export type { AdmissionOptions } from './discovery.ts'

// DATA-02 — one addressing contract, checked against every Blockstore adapter.
export { BLOCK_VECTORS, CONFORMANCE_BLOCK_COUNT, checkBlockstoreConformance } from './conformance.ts'
export type { BlockVector, ConformanceReport } from './conformance.ts'

// SCHED-04 / BROW-03 — the governor applied to the execution path.
export { GovernedExecutor } from './governed-executor.ts'

// Egress control — DATA-04, DATA-05.
export { EgressGuard } from './egress.ts'
export type { EgressEntry, EgressManifest } from './egress.ts'
