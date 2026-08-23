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

// AUTH-03 — the capability chain audience, derived from an identity both ends hold.
// No type is introduced: the return is `@o2/core`'s own `PublicKeyHex`.
export { audienceKeyOf } from './audience-key.ts'

// NET-07 — transport limits the architecture depends on.
export {
  LIBP2P_INBOUND_CONNECTION_THRESHOLD,
  LIBP2P_MAX_CONNECTIONS,
  LIBP2P_MAX_INCOMING_PENDING_CONNECTIONS,
  MAX_CONCURRENT_STREAMS_PER_PEER,
  MAX_INBOUND_MESSAGE_BYTES,
  MAX_INBOUND_MESSAGES_IN_FLIGHT_PER_PEER,
  MAX_QUEUED_SENDS_PER_PEER,
  O2_MAX_RESERVATIONS,
  RELAY_DATA_LIMIT_BYTES,
  RELAY_DURATION_LIMIT_MS,
  RELAY_MAX_RESERVATIONS,
  RELAY_MAX_RESERVATION_TTL_MS,
  WEBRTC_MAX_BUFFERED_BYTES,
  WEBRTC_MAX_MESSAGE_BYTES,
  WIRE_CHUNK_BYTES,
} from './constants.ts'

// NET-06 — how long the keyspace remembers who holds a block, stated rather than inherited.
// The constant's docblock carries the reading that makes it necessary: `kad-dht` splits
// provider lifetime across two modules, and the one that looks authoritative is inert.
export { PROVIDER_RECORD_VALIDITY_MS, providerRecordPolicy } from './constants.ts'
export type { ProviderRecordPolicy } from './constants.ts'

// AUTH-02 / AUTH-04 — who a relay admits, stated by the operator and read by nothing yet.
//
// Lives here rather than in `@o2/core` or `@o2/net` for two reasons, both measured. It is
// a statement about a **circuit reservation**, so it belongs beside the four reservation
// numbers `constants.ts` already owns and its docblock has to cite one of them
// (`RELAY_MAX_RESERVATION_TTL_MS`) to state the revocation window. And the mechanism that
// will read it — `ConnectionGater.denyInboundRelayReservation` — is a `@libp2p/interface`
// type, which `purity.node.test.ts` forbids in `@o2/core` and `@o2/net` outright. Both
// `@o2/node` and `@o2/browser` depend on this package, so `bin/seed.ts`, `bin/agent.ts`
// and the browser tier can all name it without `@o2/browser` acquiring `@o2/node`.
export { ADMITS_ANY_PEER, admitsAnyPeer } from './relay-admission.ts'
export type { RelayAdmission } from './relay-admission.ts'

// AUTH-02 — one named verdict per peer, computed offline against pinned issuer keys.
//
// Here for the reason stated directly above, one symbol later, and the sibling comment is
// why this one is short: `PeerVerifier` reads `@libp2p/interface`'s `Libp2p` and `PeerId`,
// which `purity.node.test.ts` forbids in `@o2/core` and `@o2/net` outright, and both
// `@o2/node` and `@o2/browser` depend on this package. It sat in `@o2/node` from Plan
// 17-04 until 2026-08-14, which is exactly why `browser-node.ts` could not construct one
// and the browser tier reached no verdict about any peer — AUTH-02's remaining leg, and
// `DEFICIENCIES.md` D09. `@o2/node` re-exports both lines so no existing importer moves.
//
// `DEFAULT_VERDICT_RETRY_FLOOR_MS` is exported alongside them and was **not** on `@o2/node`'s
// barrel, because the spec that reads it (`packages/node/src/peer-verifier.node.test.ts`)
// used to sit beside the module and import it relatively. The spec stays where it is — it
// is named by three `mutation-ledger.ts` rows and by `AUTH-02`'s witness list — so the
// constant has to be reachable by package specifier or the retry-floor cases cannot see it.
export { DEFAULT_VERDICT_RETRY_FLOOR_MS, PeerVerifier } from './peer-verifier.ts'
export type { PeerFailure, PeerVerdict, PeerVerifierOptions } from './peer-verifier.ts'

// AUTH-01 — one on-device seed, read in two namespaces.
export {
  SEED_BYTES,
  SeedLengthError,
  generateSeed,
  identityFromSeed,
  nodeKeyForPeerId,
  parseKeyHex,
  peerIdForNodeKey,
} from './identity.ts'
export type { NodeIdentity } from './identity.ts'

// The fabric's index answered by a Kademlia DHT — SCHED-01, NET-06. Both composition
// arguments on `DhtRecordIndexOptions` are required, so an instance that answers less
// than today's fabric is a compile error rather than a review comment.
export {
  DHT_QUERY_TIMEOUT_MS,
  DhtRecordIndex,
  O2_KAD_PROTOCOL,
  O2_KEY_PREFIX,
  dhtKeyForNodeKey,
} from './dht-record-index.ts'
export type {
  DhtRecordIndexOptions,
  ProviderAddressSink,
  RecordVerifier,
} from './dht-record-index.ts'

// Registration — the write half. The validator is what makes `/o2/<nodeKey>` ownable:
// only the holder of that key's secret can put a record there, enforced by every storer.
export {
  O2_RECORD_NAMESPACE,
  RecordPublisher,
  RecordRefused,
  o2RecordSelector,
  o2RecordValidator,
  publishRecords,
} from './dht-registration.ts'
export type { PeerArrivals, PublishOutcome, RecordRefusal } from './dht-registration.ts'

// Provider announcement — the half that lets `findProviders` answer anything at all.
// It deliberately does not announce inside `put`; that module's header carries the
// measured ordering in `submit.ts` which makes the obvious place a side channel.
export { DhtProviderAnnouncer, ObservingBlockstore } from './dht-provider-announcer.ts'
export type {
  ProviderAnnouncerOptions,
  SweepOutcome,
  WithholdingPredicate,
} from './dht-provider-announcer.ts'
