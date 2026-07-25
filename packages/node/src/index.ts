/**
 * `@o2/node` — the Node.js adapters.
 *
 * Everything here is something a browser structurally cannot do: bind a listening
 * socket, write a file, spawn a process. Keeping it in a separate package is what
 * stops `node:*` leaking into the browser build, which would break the portability
 * property `@o2/core` and `@o2/net` exist to preserve.
 */

export { FabricNode } from './fabric-node.ts'
export type { FabricNodeOptions } from './fabric-node.ts'

export { FsBlockstore } from './fs-blockstore.ts'

export { DEFAULT_SEND_TIMEOUT_MS, Libp2pTransport, O2_RPC_PROTOCOL } from './libp2p-transport.ts'
export type { Libp2pTransportOptions } from './libp2p-transport.ts'

// NET-07 — transport limits the architecture depends on.
export {
  RELAY_DATA_LIMIT_BYTES,
  RELAY_DURATION_LIMIT_MS,
  RELAY_MAX_RESERVATIONS,
  RELAY_MAX_RESERVATION_TTL_MS,
  WEBRTC_MAX_BUFFERED_BYTES,
  WEBRTC_MAX_MESSAGE_BYTES,
  WIRE_CHUNK_BYTES,
} from './constants.ts'
