/**
 * `@o2/node` — the Node.js adapters.
 *
 * Everything here is something a browser structurally cannot do: bind a listening
 * socket, write a file, spawn a process. Keeping it in a separate package is what
 * stops `node:*` leaking into the browser build, which would break the portability
 * property `@o2/core` and `@o2/net` exist to preserve.
 */

// The one node class. It executes tasks, holds blocks, and — when it has bound an
// address others can reach — relays for peers that have not. NET-03's server side is
// a capability of this class, not a class of its own; see its module comment for
// what went wrong while it was.
export { FabricNode } from './fabric-node.ts'
export type { FabricNodeOptions, RelayCapacity } from './fabric-node.ts'

export { FsBlockstore } from './fs-blockstore.ts'

// AUTH-01 — the identity seed and the provider-signed certificate, persisted beside the
// blocks. The certificate goes through the same parser the wire uses, plus the hex-key
// narrowing that parser cannot make — see `loadCertificate`.
export {
  CERTIFICATE_FILE,
  IDENTITY_FILE,
  MalformedSeedFileError,
  PROVIDER_FILE,
  hasSeed,
  loadCertificate,
  loadOrCreateSeed,
  saveCertificate,
} from './identity-store.ts'

// The Node tier's killable compute thread — SCHED-06, BROW-04's other half.
export { workerThread } from './worker-thread.ts'

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

// NET-05 — relay exhaustion reported by name.
export {
  RESERVATION_FAILURE_PREFIX,
  ReservationWatcher,
  STATUS_PERMISSION_DENIED,
  STATUS_RESERVATION_REFUSED,
  classifyReservationFailure,
} from './reservation-watch.ts'
export type { ReservationFailure } from './reservation-watch.ts'

// The LAN seed: one command another device on the network can join.
export { SeedServer, lanAddresses, localHostname, relayAddrForHost } from './seed-server.ts'
export type { BootstrapInfo, SeedServerOptions } from './seed-server.ts'
