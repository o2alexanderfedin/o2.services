import { describe, expect, it } from 'vitest'
import { holdsReservations, reservedPeerIds } from './relay-reservations.ts'
import type { ReservationHolder } from './relay-reservations.ts'

/**
 * The `{kind:'reservations'}` answer, read off the shape `circuitRelayServer()` exposes.
 *
 * Plain `.test.ts` — the module is a shape narrowing and a map, with no platform in it, and
 * both tiers that call it must get the same answer.
 *
 * The case that carries the module is the third one: **a node that does not relay and a relay
 * with no guests must be indistinguishable.** `protocol.ts:262-266` states that as a property
 * of the wire — *"there is no capability flag to read here, because a flag would be a kind to
 * branch on"* — and this is the only place it can be broken, because it is the only place
 * that knows the difference.
 */

/** A relay service holding the given peers, complete against the declared interface. */
function relayHolding(...peers: string[]): ReservationHolder {
  const store = new Map(peers.map((peer) => [{ toString: () => peer }, { expiry: 0 }]))
  return { reservations: store }
}

describe('reading who holds a reservation', () => {
  it('answers with the peer ids, as strings', () => {
    expect(reservedPeerIds(relayHolding('12D3KooWA', '12D3KooWB'))).toEqual([
      '12D3KooWA',
      '12D3KooWB',
    ])
  })

  it('answers [] for a node with no relay service at all', () => {
    // `libp2p.services['relay']` on a node built without `circuitRelayServer()`. Ordinary
    // configuration, not an error.
    expect(reservedPeerIds(undefined)).toEqual([])
  })

  it('makes a relay with no guests INDISTINGUISHABLE from a node that does not relay', () => {
    // The wire's own rule, and this is the only place it can be broken. Anything that
    // distinguished the two — `null`, a thrown refusal, a flag — would hand the reader a kind
    // to branch on, which `protocol.ts` refuses by construction. Plant that reddens this:
    // return `null` from the no-service branch.
    const noService = reservedPeerIds(undefined)
    const emptyRelay = reservedPeerIds(relayHolding())

    expect(emptyRelay).toEqual(noService)
    expect(emptyRelay).toEqual([])
  })

  it('reads the store on every call rather than capturing it', () => {
    // A reservation store changes on every arrival and departure, and this runs in a
    // long-lived relay. A value captured once would be right at construction and wrong for
    // the rest of the process's life. Plant that reddens this: memoise the result.
    const store = new Map<{ toString: () => string }, unknown>()
    const service: ReservationHolder = { reservations: store }
    expect(reservedPeerIds(service)).toEqual([])

    store.set({ toString: () => '12D3KooWLate' }, {})

    expect(reservedPeerIds(service)).toEqual(['12D3KooWLate'])
  })
})

describe('the narrowing refuses anything that is not a reservation store', () => {
  it('accepts the real shape', () => {
    expect(holdsReservations(relayHolding('12D3KooWA'))).toBe(true)
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'relay'],
    ['a number', 7],
    ['an object with no reservations', { peers: [] }],
    ['reservations that are null', { reservations: null }],
    ['reservations that are not an object', { reservations: 'two' }],
  ])('refuses %s', (_name, value) => {
    expect(holdsReservations(value)).toBe(false)
  })

  it('refuses a store with `keys` but no `size`', () => {
    // `size` is not read by `reservedPeerIds` and is required anyway: it is what separates a
    // reservation store from any object that happens to carry a `keys` function, and an
    // array does. Plant that reddens this: drop the `size` check from the narrowing.
    expect(holdsReservations({ reservations: { keys: () => [] } })).toBe(false)
  })

  it('refuses a store with `size` but no `keys`', () => {
    expect(holdsReservations({ reservations: { size: 2 } })).toBe(false)
  })
})
