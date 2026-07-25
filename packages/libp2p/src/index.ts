/**
 * `@o2/libp2p` — the libp2p `Transport` adapter, shared by Node and the browser.
 *
 * Sits between the portable packages and the platform ones. `@o2/core` and
 * `@o2/net` may not reference libp2p at all: they are the parts that must also work
 * over an in-process transport. `@o2/node` and `@o2/browser` may reference anything
 * their platform offers. This package is the middle tier — it uses libp2p, but only
 * the parts that behave identically in both, so both can depend on it instead of
 * duplicating the adapter or reaching across into each other.
 *
 * The platform-bound choices — which *transports* to configure, where blocks live —
 * stay in the platform packages, because those genuinely differ.
 */

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
