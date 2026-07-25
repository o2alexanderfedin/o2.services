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
export type { AgentOptions } from './agent.ts'
