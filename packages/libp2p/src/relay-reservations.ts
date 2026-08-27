/**
 * Who currently holds a reservation on this node's relay — the `{kind:'reservations'}` answer.
 *
 * ## Why this is a module and not a method
 *
 * The Node tier already had this, inline in `FabricNode`, and the hosted tier needs the same
 * answer from the same `circuitRelayServer()` shape. Three ways to get there and only one
 * that does not age badly: `@o2/node` cannot be imported by `@o2/cloudflare` (a tier
 * importing another tier's adapter is the dependency direction `purity.node.test.ts` refuses),
 * copying it makes two spellings of one rule, and this — the middle tier both already depend
 * on — leaves exactly one definition. `FabricNode.reservedPeerIds` now delegates here, so the
 * two tiers cannot answer this question differently.
 *
 * ## Why the service is `unknown` and narrowed rather than typed
 *
 * `libp2p.services` is an index of whatever was registered, so the value is genuinely unknown
 * at this boundary — a node built without `circuitRelayServer()` has nothing under `relay`,
 * and that is an ordinary configuration rather than an error. The narrowing is by **shape**
 * and not by `instanceof`, because the two tiers construct the service from the same package
 * but not necessarily the same module instance, and an identity check would answer a question
 * about module resolution rather than about relaying.
 *
 * **The empty answer is deliberately indistinguishable from "does not relay at all."**
 * `protocol.ts:262-266` states the rule for the wire — *"there is no capability flag to read
 * here, because a flag would be a kind to branch on"* — and this function is where that rule
 * has to hold: a node with no relay service and a relay with no guests must produce the same
 * `[]`, or the wire's guarantee is decided somewhere the wire cannot see.
 */

/**
 * As much of `circuitRelayServer()`'s service as this reads.
 *
 * Declared narrowly on the discipline `durable-object-storage.d.ts` states for its own: an
 * interface this small is one a fixture can implement **completely**, and a complete fake is
 * the only kind that can honestly claim to model the thing. `size` is not read by the code
 * below and is required anyway — it is what distinguishes a real reservation store from any
 * object that happens to carry a `keys` function, and dropping it would let the narrowing
 * accept a plain `Map`-shaped stranger.
 */
export interface ReservationStore {
  readonly size: number
  keys: () => Iterable<{ toString: () => string }>
}

/** A libp2p service that holds reservations — the only shape this module recognises. */
export interface ReservationHolder {
  readonly reservations: ReservationStore
}

/** Shape narrowing for {@link reservedPeerIds}, exported so a caller can ask first. */
export function holdsReservations(value: unknown): value is ReservationHolder {
  if (value === null || typeof value !== 'object') return false
  const candidate = (value as { reservations?: unknown }).reservations
  return (
    candidate !== null &&
    typeof candidate === 'object' &&
    typeof (candidate as { size?: unknown }).size === 'number' &&
    typeof (candidate as { keys?: unknown }).keys === 'function'
  )
}

/**
 * The peer ids holding a reservation, as strings, or `[]` for a node that does not relay.
 *
 * Read on every call rather than cached: a reservation store changes on every arrival and
 * departure, and a value captured once would go stale in exactly the long-lived process this
 * runs in. The same reason `FabricNode.tlsCertificate` reads through `libp2p.services`.
 */
export function reservedPeerIds(service: unknown): readonly string[] {
  if (!holdsReservations(service)) return []
  return [...service.reservations.keys()].map((peer) => peer.toString())
}
