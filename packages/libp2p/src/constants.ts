/**
 * NET-07 — the transport limits this system's design depends on.
 *
 * These are not our choices. They are defaults inside libp2p that constrain the
 * architecture, and several design decisions are downstream of them:
 *
 *   - **A relay is a signalling channel, not a data path.** 2 minutes and 128 KiB
 *     per relayed connection means bulk data over `/p2p-circuit` is not merely
 *     slow, it is impossible. Artifacts must come from somewhere else.
 *   - **The browser mesh cannot carry bulk data.** A 16 KiB WebRTC message cap
 *     means partials have to stay small, by design rather than by luck.
 *   - **Concurrent browser peers per relay are bounded.** 15 reservations is a
 *     capacity-planning number for the backbone, not a detail.
 *
 * `constants.node.test.ts` reads the values back out of the installed packages and
 * fails when they change. A dependency bump that silently doubles the data limit
 * would otherwise be discovered at scale, in the one phase where reproducing it is
 * most expensive.
 */

/** Seconds a relayed connection lives before the relay closes it. */
export const RELAY_DURATION_LIMIT_MS = 120_000

/** Bytes a relayed connection may carry in total, in each direction. */
export const RELAY_DATA_LIMIT_BYTES = 131_072n

/** Concurrent reservations one relay server accepts by default. */
export const RELAY_MAX_RESERVATIONS = 15

/** How long a reservation remains valid. */
export const RELAY_MAX_RESERVATION_TTL_MS = 7_200_000

/**
 * Largest single WebRTC datachannel message js-libp2p will send.
 *
 * Hardcoded in js-libp2p rather than negotiated. Chromium closes a channel on
 * anything larger and will not reassemble Firefox's fragments, so this is a hard
 * ceiling on the browser data path, not a tuning parameter.
 */
export const WEBRTC_MAX_MESSAGE_BYTES = 16_384

/** Bytes js-libp2p will buffer for a WebRTC channel before applying backpressure. */
export const WEBRTC_MAX_BUFFERED_BYTES = 2_097_152

/**
 * Chunk size for outbound framing on the o2 protocol.
 *
 * Sized to the WebRTC ceiling even on TCP, so a message that crosses the backbone
 * today survives being relayed to a browser tomorrow without a second framing
 * path. Uniform framing across transports is worth more than TCP throughput here.
 */
export const WIRE_CHUNK_BYTES: number = WEBRTC_MAX_MESSAGE_BYTES
