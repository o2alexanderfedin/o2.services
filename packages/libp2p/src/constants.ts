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

/**
 * Simultaneous *inbound handshakes* libp2p permits by default.
 *
 * The limit that actually caps a relay's browser-peer capacity, and it binds well
 * before `RELAY_MAX_RESERVATIONS` does. Ten browser tabs joining at once already sit
 * at the edge; the eleventh is dropped part-way through the noise handshake and
 * surfaces as `EncryptionFailedError: Unexpected EOF - stream closed while reading
 * 0/1 bytes` — which reads like a network fault and is a configured limit.
 *
 * Discovered by sixteen browser peers failing to join a relay whose reservation limit
 * was 32. Raising reservations alone is not enough: the two have to move together,
 * which is why `FabricNode` derives one from the other.
 */
export const LIBP2P_MAX_INCOMING_PENDING_CONNECTIONS = 10

/**
 * Inbound connections per second libp2p accepts **from a single host** by default.
 *
 * The limit that actually stops sixteen browser peers joining a relay at once, and the
 * most surprising one in this file. It is per *host*, not per peer — so it binds
 * whenever many peers share an IP:
 *
 *   - every tab in a local multi-tab test, all on `127.0.0.1`;
 *   - and, in production, every volunteer behind one NAT — a school, an office, a
 *     carrier running CGNAT. For a fabric whose whole premise is many browsers, that
 *     is not an edge case.
 *
 * Exceeding it rejects the connection *during* the noise handshake, which the dialer
 * reports as `EncryptionFailedError: Unexpected EOF - stream closed while reading 0/1
 * bytes` — indistinguishable from a network fault unless you know to look here.
 *
 * Found by bisection: eight simultaneous joins already failed three of eight, and
 * adding a stagger fixed it, while raising the reservation and pending-handshake
 * limits did not.
 */
export const LIBP2P_INBOUND_CONNECTION_THRESHOLD = 5

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

/**
 * NET-08 — the largest single inbound message this node will accumulate. **8 MiB.**
 *
 * Unlike everything above it, this is **not** a libp2p default. It is this
 * project's own declared ceiling, and it is a **configuration choice** — no
 * arithmetic produces it. It exists because nothing below this line was ever
 * bounding the sum: `WIRE_CHUNK_BYTES` is send-side framing only, and yamux's
 * receive window paces delivery without capping the total, so `readMessage` would
 * accumulate whatever a peer chose to send. A single 64 MiB frame was sent over
 * tcp + noise + yamux and accepted (ROADMAP.md, Phase 13.1 criterion 3).
 *
 * Sited against three figures somebody actually recorded, not against a workload
 * anybody computed:
 *
 *   - **above** the 100 KiB block `fabric-node.node.test.ts` deliberately carries
 *     to exercise the chunking and reassembly paths;
 *   - **above** the largest artifact this project has produced — a 5.6 MB elfconv
 *     output, ~4.8 MB after summarisation (`10-VERIFICATION.md:16,146`);
 *   - **below** the 64 MiB frame the roadmap measured accepted.
 *
 * If some workload's frame size ever matters here, measure it and record the
 * measured figure with its date. Do not compute one from demo or job source.
 *
 * `Libp2pTransportOptions.maxMessageBytes` overrides it per transport;
 * `transport-bounds.node.test.ts` proves the shipped value is the enforced one and
 * not only the override.
 */
export const MAX_INBOUND_MESSAGE_BYTES = 8_388_608

/**
 * NET-08 — in-limit messages this node will accumulate from **one** peer at once.
 * **4.**
 *
 * Like {@link MAX_INBOUND_MESSAGE_BYTES} above it, a **configuration choice** and not
 * a libp2p default. It is a multiplier rather than a byte count so that the budget is
 * `maxMessageBytes × this`: a transport whose per-message cap is shrunk gets a budget
 * that shrinks with it, and "a budget smaller than one legal message" is not a state
 * anybody can express.
 *
 * Deliberately **not** aliased to {@link MAX_CONCURRENT_STREAMS_PER_PEER}. That is a
 * send-side bound sited against libp2p's `maxEarlyStreams`; this is an inbound memory
 * bound. They would change for unrelated reasons and sharing one number would couple
 * them.
 *
 * Sited against figures somebody recorded, not against a workload anybody computed:
 *
 *   - 4 × 8 MiB = 32 MiB is **above** the largest artifact this project has produced
 *     — a 5.6 MB elfconv output, ~4.8 MB after summarisation
 *     (`10-VERIFICATION.md:16,146`) — even at six-way concurrency;
 *   - and far **below** the 263 MB the reproduction measured retained at 32
 *     concurrent in-limit streams from one peer.
 *
 * If some workload's concurrency ever matters here, measure it and record the
 * measured figure with its date. Do not compute one from demo or job source.
 *
 * **What this does not close.** A sybil holding N peer ids gets N budgets, bounded
 * only loosely by {@link LIBP2P_INBOUND_CONNECTION_THRESHOLD} and libp2p's connection
 * manager; nothing in this repository declares a fabric-wide inbound memory ceiling.
 * 256 idle streams each sending one byte consume almost no budget while still holding
 * 256 libp2p stream objects. And the flatten in `readMessage` transiently doubles
 * retention, so measured peak is around twice the declared budget rather than equal
 * to it.
 *
 * No node-factory option, for the reason {@link MAX_CONCURRENT_STREAMS_PER_PEER}
 * gives: a knob invites raising it back past the point it protects.
 */
export const MAX_INBOUND_MESSAGES_IN_FLIGHT_PER_PEER = 4

/**
 * NET-09 — outbound streams this node will hold open toward **one** peer at once.
 * **8.**
 *
 * A **configuration choice**, chosen to sit below the operative `maxEarlyStreams`
 * default of 10 that `@libp2p/utils`'s `AbstractStreamMuxer` hardcodes as a
 * `init.maxEarlyStreams ?? 10` (`dist/src/abstract-stream-muxer.js:24`) — *not*
 * `@chainsafe/libp2p-yamux`'s `defaultConfig.maxEarlyStreams`, which `YamuxMuxer`
 * declares and never reads (`dist/src/muxer.js:64-75` reads four other fields off
 * it). Past that ceiling the muxer calls `abort()` on the **whole connection**.
 *
 * The evidence is measurement, not arithmetic: the roadmap measured N=8 completing
 * and N=12 aborting, and `transport-bounds.node.test.ts` reproduces the abort and
 * reads the `10` back out of the error the reproduction throws.
 *
 * **What this bounds, and what it does not.** `earlyStreams` is *cumulative* within
 * the pre-listener window, not a concurrency count: `onRemoteStream` pushes every
 * inbound stream while the muxer has no `'stream'` listener
 * (`abstract-stream-muxer.js:114-124`), `cleanUpStream` splices `this.streams` only
 * and never touches `earlyStreams` (`:128-148`), and the array is emptied in exactly
 * one place — when a `'stream'` listener is finally added (`:154-164`). So a cap on
 * *concurrent* outbound streams does not cap how many are opened in total inside
 * that window. This constant lowers the burst rate and bounds the damage. It does
 * **not** make the ceiling unreachable, and nothing in this repository may claim it
 * does. What would measure that is an instrument on the receiver's muxer counting
 * inbound streams accepted before its `'stream'` listener attached; `earlyStreams`
 * is a private field of a class libp2p never hands out, so that instrument is not
 * reachable through any public API today.
 *
 * **Why the fix is not `yamux({maxEarlyStreams: N})`, and why it is not shipped even
 * as a belt.** Raising it moves the cliff rather than removing it, and leaves
 * connection tear-down as the failure mode. A peer running default yamux still
 * aborts at 10 whatever this node sets. And its effect is not readable from outside
 * libp2p's public API, so shipping it would add a mechanism this phase could only
 * report, not measure. If a later phase ships it, it gets pinned the way every other
 * libp2p default in this repository is — against a runtime value, not a `.d.ts`.
 */
export const MAX_CONCURRENT_STREAMS_PER_PEER = 8

/**
 * NET-09 — sends this node will hold waiting behind the per-peer gate. **256.**
 *
 * A **configuration choice**, set to match the number this transport already
 * declares as `maxOutboundStreams` on its protocol registration, so one figure
 * governs both rather than two drifting apart.
 *
 * No claim is attached about what this depth does to any workload's admissibility.
 * What matters about the queue is that overflowing it refuses *immediately* rather
 * than waiting, and that is asserted behaviourally in
 * `transport-bounds.node.test.ts` — on elapsed time as well as on the message —
 * rather than argued from this number.
 */
export const MAX_QUEUED_SENDS_PER_PEER = 256
