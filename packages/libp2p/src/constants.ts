/**
 * NET-07 — the transport limits this system's design depends on.
 *
 * These are not our choices. They are defaults inside libp2p that constrain the
 * architecture, and several design decisions are downstream of them:
 *
 *   - **A relay is a signalling channel, not a data path.** The data limit is one
 *     counter for the whole relayed connection, decremented by **both** directions,
 *     so a symmetric request/response protocol gets 64 KiB each way and not 128 —
 *     see {@link RELAY_DATA_LIMIT_BYTES} and {@link relayedBudgetPerDirection}.
 *     Bulk data over `/p2p-circuit` is not merely slow, it is impossible. Artifacts
 *     must come from somewhere else.
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

/**
 * How long a relayed connection lives before the relay closes it. **2 minutes.**
 *
 * A default **of the relay server**, so it is whoever runs the relay who sets it —
 * this project's relays pass it explicitly (`fabric-node.ts` as
 * `defaultDurationLimit`, and `hosted-libp2p.ts` likewise), and an operator running
 * their own may pass something else. Read as a fact about the fabric it would be
 * wrong: nothing here binds a relay somebody else operates.
 *
 * **And on one arrangement it was not observed at all.** Measured 2026-08-24 against
 * a hosted relay configured with a `reservations` object carrying no explicit limits,
 * a relayed connection held **206 s** through ten pings with no cut, against this
 * 120 000 ms — reproduced on a second independent run at 204 s, with `conn.limits`
 * reporting no limits while {@link RELAY_DATA_LIMIT_BYTES} *was* being enforced on the
 * same connection. That asymmetry is recorded as measured and **not explained**; no
 * mechanism is offered for it here, because none was measured.
 * `.planning/consults/2026-08-24-cloudflare-as-a-fabric-node-measured.md` §15.
 *
 * A relay that passes the figure explicitly — every relay this project starts — is a
 * different arrangement from that one, and the two readings are not blended.
 */
export const RELAY_DURATION_LIMIT_MS = 120_000

/**
 * Bytes a relayed connection may carry — **counted across both directions at once.**
 *
 * ## The correction, and why it is the kind of number a design gets wrong once
 *
 * This docblock read *"in total, in each direction"* until 2026-09-02, which is two
 * readings at once and the wrong one is the one a design takes: 131 072 bytes reads as
 * a per-direction allowance, and a protocol sized against it budgets **twice the room
 * it has**. There is one counter, not two:
 *
 * ```js
 * // @libp2p/circuit-relay-v2/dist/src/utils.js — createLimitedRelay
 * let dataLimit = { remaining: reservation.limit.data }
 * countStreamBytes(dst, dataLimit, options)
 * countStreamBytes(src, dataLimit, options)
 * ```
 *
 * One object, both directions, `limit.remaining -= len` on every message either way
 * and `abort` once it goes negative. `relayed-budget.node.test.ts` pins that source so
 * a dependency bump that splits the counter fails there rather than in the field.
 *
 * **So a symmetric request/response protocol gets {@link relayedBudgetPerDirection}
 * each way — 64 KiB, not 128.**
 *
 * ## Measured twice, on two unrelated relays, to the same byte
 *
 * 2026-08-24, against a hosted relay: sweeping the chunk size moved nothing — the cut
 * landed on byte 65 536 sent whether written as sixteen 4 KiB chunks, four 16 KiB
 * chunks or one 64 KiB chunk, and bytes-out plus bytes-back plus the reply in flight
 * was `131072` in every row, this figure exactly (consult §15).
 *
 * 2026-09-02, against a **local** `circuitRelayServer()` started by `FabricNode` on
 * this project's own defaults, two peers reachable only through it, exchanging over
 * the o2 RPC protocol: 62 KiB each way completed byte-identical; **63 KiB each way was
 * cut**; and at 64 KiB each way the echo came back 49 152 bytes — the same figure the
 * hosted relay returned for the same 16 KiB framing. Different relay, different
 * process, different transport underneath, same accounting.
 *
 * ## What that leaves for a payload, which is less than half
 *
 * The counter is on **wire** bytes, so the noise handshake, the identify exchange and
 * every noise and yamux frame header are paid out of the same 131 072. 63 KiB each way
 * being cut while 62 KiB survives puts this connection's non-payload cost between 2 049
 * and 4 097 bytes. {@link relayedBudgetPerDirection} is therefore a **ceiling that is
 * not reachable**, not an allowance to size a protocol against.
 *
 * ## It is a default of the relay server
 *
 * Like {@link RELAY_DURATION_LIMIT_MS}: whoever runs the relay sets it, and this
 * project's relays pass it explicitly. A peer on the far end cannot read it back —
 * measured 2026-09-02 on the local arrangement, `connection.limits` on a relayed
 * connection is `{}`, an object present and empty, so it identifies the connection as
 * limited and states no budget. A node that needs a figure has only this default.
 */
export const RELAY_DATA_LIMIT_BYTES = 131_072n

/**
 * NET-13 — what one direction of a symmetric exchange may use. **Half the limit.**
 *
 * Derived rather than written down, so the fabric has exactly one authoritative
 * relayed-budget figure and this one cannot drift from it. A relay tuned to a
 * different `defaultDataLimit` gets a per-direction budget that moves with it, which
 * is the whole reason this is a function of the limit rather than a second constant.
 *
 * **A ceiling, and an unreachable one.** Wire framing comes out of the same counter —
 * see {@link RELAY_DATA_LIMIT_BYTES} — so a protocol that sizes its largest
 * request/response pair *at* this figure is measured to be cut. Size below it.
 */
export function relayedBudgetPerDirection(
  dataLimitBytes: bigint = RELAY_DATA_LIMIT_BYTES,
): bigint {
  return dataLimitBytes / 2n
}

/** Concurrent reservations one relay server accepts by default. */
export const RELAY_MAX_RESERVATIONS = 15

/**
 * Connections one libp2p node keeps before its connection manager prunes. **300.**
 *
 * The fourth limit in this file's story and the one that actually stops a relay from
 * growing. It is stated last because nothing had ever reached it: the three above bind
 * at 5, 10 and 15, so a relay tuned past them hits *this* one with no warning.
 *
 * **Measured 2026-08-19**, one host, node peers rather than tabs: a relay with
 * `maxReservations` at 1024, dialled first by 512 peers and then by 1024, granted
 * **305** reservations both times. Neither sockets nor memory bound it — `ulimit -n`
 * was 1048576 against 632 descriptors in use, and resident memory was *lower* at 1024
 * peers than at 256. 305 is this constant plus the relay's own handful.
 *
 * It fails **silently**, which is what makes it expensive to find: every excess peer
 * reports a successful start and simply holds no reservation. Nothing throws.
 *
 * `FabricNode` derives it from `maxReservations` exactly as it derives the two above,
 * so raising a relay's capacity stays one number instead of four.
 */
export const LIBP2P_MAX_CONNECTIONS = 300

/**
 * Concurrent reservations **this project's** relays accept, against libp2p's 15.
 *
 * A configuration choice, not arithmetic, and sited against the same 2026-08-19 sweep:
 * 64, 128 and 256 peers were each granted in full — 64/64, 128/128, 256/256, no
 * refusals — so 256 is demonstrably reachable on commodity hardware.
 *
 * **64 is nonetheless the default**, because a default is inherited by every node that
 * relays, including a volunteer's laptop. 64 reservations cost roughly 128 file
 * descriptors and sit inside libp2p's stock 300-connection budget without raising
 * anything, which keeps the conservative case free of side effects. A backbone relay
 * that wants 256 passes `maxReservations`, and the connection budget follows it.
 */
export const O2_MAX_RESERVATIONS = 64

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

/**
 * NET-06 — how long the keyspace keeps a statement that some node holds a block. **1 hour.**
 *
 * ## Why this is stated rather than left at the library default, and what was measured
 *
 * `@libp2p/kad-dht@16.4.0` splits provider-record lifetime across two modules, and reading
 * only one of them yields a false conclusion. **This project reached that false conclusion
 * twice**, so the reading is recorded here rather than in a commit message.
 *
 * `src/providers.ts` — the store — takes an init of exactly `logPrefix` and
 * `datastorePrefix`, reads no validity and runs no cleanup, and `getProviders` returns every
 * entry under the key prefix **with no date comparison**. The public options type declares
 * `providers.provideValidity` and `providers.cleanupInterval` (`src/index.ts:432,438`) and
 * `kad-dht.ts:182` spreads them into that constructor, where nothing reads them. Those two
 * options are inert, and a reader who stops there concludes provider records never expire.
 *
 * They do expire. The mechanism is `src/reprovider.ts`, started with the other components
 * by `kad-dht.ts`'s `start(...)` call: every `interval` it walks the same key prefix,
 * deletes any entry older than `validity` **whose provider is not this node**, and queues a
 * republish for its own records that are within `threshold` of expiring. Its own comment
 * gives the reason self records are exempt — *"if user node is down for a while, we still
 * persist provide intent"*.
 *
 * So the honoured knob is `reprovide.validity`, and its default is 48 hours.
 *
 * ## What the number is sited against
 *
 * The fabric's shortest-lived participant is a browser tab, whose session is minutes. Its
 * freshness is not carried by this timer at all — `RpcRecordIndex` asks directly-connected
 * peers, which is fresh by construction — so this number governs the population that
 * outlives it, and 48 hours is sited against a long-running IPFS daemon rather than against
 * anything in this fabric.
 *
 * The cost of a record that outlives its provider is **measured**: an `attestation-ui`
 * e2e case failed with *"no answer inside 5000ms"* when discovery spent the page's budget
 * on a provider that was no longer there. A stale record is worse than a missing one,
 * because a missing one fails immediately.
 *
 * **The staleness bound is `validity + interval`, not `validity`**, because reads are not
 * filtered by date — an entry is served until a sweep removes it. {@link providerRecordPolicy}
 * derives the interval from the validity so that bound stays a property of one number
 * instead of an accident between two.
 */
export const PROVIDER_RECORD_VALIDITY_MS = 3_600_000

/**
 * The three `reprovide` figures, derived from one so they cannot drift apart.
 *
 * `interval` is a quarter of `validity`, which fixes the staleness bound at `1.25 ×
 * validity`. `threshold` is half, so a node republishes in the second half of its record's
 * life — early enough that one missed sweep is not a gap, late enough not to republish on
 * every pass.
 *
 * Taking all three from one argument is the point. The library's own defaults are 48 h / 1 h
 * / 24 h, which are individually reasonable and jointly mean a record is republished at
 * roughly the same instant it would otherwise expire.
 */
export interface ProviderRecordPolicy {
  /** How long a record about another node is kept before a sweep deletes it. */
  readonly validity: number
  /** How often the sweep runs. */
  readonly interval: number
  /** How close to expiry this node's own records are republished. */
  readonly threshold: number
}

/** Derive the three coupled `reprovide` figures from a single validity. */
export function providerRecordPolicy(
  validityMs: number = PROVIDER_RECORD_VALIDITY_MS,
): ProviderRecordPolicy {
  return {
    validity: validityMs,
    interval: Math.max(1, Math.floor(validityMs / 4)),
    threshold: Math.max(1, Math.floor(validityMs / 2)),
  }
}

/**
 * NET-05 — how many relays a node keeps itself reachable through. **2.**
 *
 * Arithmetic, not taste. A relay grants {@link O2_MAX_RESERVATIONS} reservations — 64, and
 * the library's own default is 15. A node that took a slot on every relay it could find
 * would cap a fabric of `M` relays at 64 participants however many relays were added; at
 * `k` slots per node the cap is `64 × M / k`. So `k` is a divisor on the fabric's own
 * capacity and wants to be as small as it can be.
 *
 * One is too small for a reason that has nothing to do with capacity: a node whose only
 * address runs through one relay disappears from the fabric when that relay does, and
 * cannot be told about a replacement because being told requires being reachable. Two is
 * the smallest number that survives that, and it is what a relay slot is actually being
 * spent on.
 *
 * **This bounds only the nodes that need reserving.** A relay's `handleConnect` checks the
 * reservation of the **destination** (`server/index.ts:284-287`), so a node that only ever
 * initiates — a pure requestor — occupies no slot anywhere and is not counted here.
 */
export const RELAY_RESERVATION_TARGET = 2
