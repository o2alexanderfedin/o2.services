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
//
// **`loadOrCreateSeed` came OFF this barrel on 2026-09-04 (AUTH-06, plan 42-02) because it
// was deleted**, not renamed and not deprecated. It wrote 32 raw bytes to `.identity.key`,
// and leaving any exported route to that behaviour would have contradicted the phase's own
// claim that no reachable path writes a plaintext secret.
//
// `loadOrCreateSealedSeed` takes its place on this line, and the two `.enc` names take their
// plaintext siblings' place beside it — the siblings stay, because the migration reads them
// and because a directory written before this phase still has them. The replacement is on the
// barrel rather than off it for the reason the deletion is legible at all:
// `reachability.node.test.ts` holds a per-package floor on this barrel's callable exports, and
// a package that quietly published one fewer entry point than it did the day before is exactly
// what that floor exists to notice. The entry point did not go away; it changed shape.
export {
  CERTIFICATE_FILE,
  IDENTITY_FILE,
  MalformedSeedFileError,
  PROVIDER_FILE,
  SEALED_IDENTITY_FILE,
  SEALED_PROVIDER_FILE,
  loadCertificate,
  loadOrCreateSealedSeed,
  saveCertificate,
} from './identity-store.ts'

// AUTH-02 — `PeerVerifier` moved to `@o2/libp2p` on 2026-08-14 and is exported from that
// barrel. The four lines that stood here said it "sits here only because `@o2/browser` does
// not depend on `@o2/node`", which was the whole of why a tab reached no verdict about any
// peer; the module imports nothing Node-only, so the fix was the move.
//
// **Deliberately not re-exported**, which is the opposite of what the transport block below
// does and needs the difference stated. That block says *"re-exported so existing importers
// of `@o2/node` are unaffected"*, and here there are none to be unaffected: `grep -rl
// "from '@o2/node'"` over `packages` and `tools` matches one file, and it is
// `peer-verifier.ts`'s own docblock quoting the specifier as the example of an import
// `purity.node.test.ts` refuses. A re-export with no importer is a widened surface that
// nothing would notice going stale.

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
  LIBP2P_MAX_CONNECTIONS,
  O2_MAX_RESERVATIONS,
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
