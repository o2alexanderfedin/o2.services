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

// The libp2p transport and the NET-07 constants now live in @o2/libp2p, shared
// with @o2/browser. Re-exported so existing importers of @o2/node are unaffected.
export {
  DEFAULT_SEND_TIMEOUT_MS,
  LIBP2P_INBOUND_CONNECTION_THRESHOLD,
  LIBP2P_MAX_INCOMING_PENDING_CONNECTIONS,
  Libp2pTransport,
  O2_RPC_PROTOCOL,
  RELAY_DATA_LIMIT_BYTES,
  RELAY_DURATION_LIMIT_MS,
  RELAY_MAX_RESERVATIONS,
  RELAY_MAX_RESERVATION_TTL_MS,
  WEBRTC_MAX_BUFFERED_BYTES,
  WEBRTC_MAX_MESSAGE_BYTES,
  WIRE_CHUNK_BYTES,
} from '@o2/libp2p'
export type { Libp2pTransportOptions } from '@o2/libp2p'

// NET-03 — the backbone relay.
export { RelayNode } from './relay-node.ts'
export type { RelayCapacity, RelayNodeOptions } from './relay-node.ts'

// NET-05 — relay exhaustion reported by name.
export {
  RESERVATION_FAILURE_PREFIX,
  ReservationWatcher,
  STATUS_PERMISSION_DENIED,
  STATUS_RESERVATION_REFUSED,
  classifyReservationFailure,
} from './reservation-watch.ts'
export type { ReservationFailure } from './reservation-watch.ts'
