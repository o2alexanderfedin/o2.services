import { describe, expect, it } from 'vitest'
import { planDials } from './dial-plan.ts'

/**
 * The decision a discovery round makes before it touches the network.
 *
 * Every rule below was inline in `demo/main.ts` until this file existed, which meant
 * none of them could be reached without a real libp2p node, a relay and a `fetch` —
 * so none of them was checked. The budget was deleted during verification and the
 * whole suite stayed green.
 */

const RELAY = '12D3KooWRelayRelayRelayRelayRelayRelayRelayRelayRelay'
const OTHER_RELAY = '12D3KooWOtherOtherOtherOtherOtherOtherOtherOtherOthe'
const SELF = '12D3KooWSelfSelfSelfSelfSelfSelfSelfSelfSelfSelfSelf'

const relayAddr = (relay: string): string => `/ip4/192.168.1.10/tcp/9090/ws/p2p/${relay}`
/** The shape the fabric actually publishes: a circuit through a relay to a peer. */
const circuit = (target: string, relay: string = RELAY): string =>
  `${relayAddr(relay)}/p2p-circuit/webrtc/p2p/${target}`
const peer = (i: number): string => `12D3KooWPeer${String(i).padStart(2, '0')}AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`

describe('a round spends a bounded number of dials', () => {
  it('stops at the budget rather than sitting out a timeout per candidate', () => {
    // A failed dial costs a full timeout, so twenty sequential attempts is a round
    // that outlives the tick that started it and a tab that stops discovering
    // anything. Rounds repeat and the candidate set is stable, so the peers cut
    // here are dialled on the next one. Eight is `MAX_DIALS_PER_ROUND`, written out
    // rather than imported: a retune of the budget is a decision, and it should have
    // to be stated here too rather than passing silently.
    const candidates = Array.from({ length: 20 }, (_unused, i) => circuit(peer(i)))
    expect(planDials({ candidates, self: SELF, connected: [] })).toEqual(candidates.slice(0, 8))
  })

  it('spends the budget on dialable targets, not on entries it was going to skip', () => {
    // The order matters and is the whole reason the budget sits below the filters:
    // a round that counted skipped entries would spend itself on a directory listing
    // that named this tab and its existing peers, and dial nobody.
    const skipped = [
      ...Array.from({ length: 4 }, () => circuit(SELF)),
      ...Array.from({ length: 4 }, (_unused, i) => circuit(peer(i))),
    ]
    const fresh = Array.from({ length: 8 }, (_unused, i) => circuit(peer(50 + i)))
    const plan = planDials({
      candidates: [...skipped, ...fresh],
      self: SELF,
      connected: [peer(0), peer(1), peer(2), peer(3)],
    })
    expect(plan).toEqual(fresh)
  })
})

describe('a candidate this tab cannot use is not one of the eight', () => {
  it('skips its own entry, which a directory has no way to omit', () => {
    const plan = planDials({
      candidates: [circuit(SELF), circuit(peer(1))],
      self: SELF,
      connected: [],
    })
    expect(plan).toEqual([circuit(peer(1))])
  })

  it('skips a peer this tab is already connected to', () => {
    const plan = planDials({
      candidates: [circuit(peer(1)), circuit(peer(2))],
      self: SELF,
      connected: [peer(1)],
    })
    expect(plan).toEqual([circuit(peer(2))])
  })

  it('dials a peer once however many ways the directory offers to reach it', () => {
    // The origin and the fabric both answer, and a peer reachable through two relays
    // appears twice. Dialling it twice spends two of the eight on one peer.
    const first = circuit(peer(1), RELAY)
    const plan = planDials({
      candidates: [first, circuit(peer(1), OTHER_RELAY), circuit(peer(2))],
      self: SELF,
      connected: [],
    })
    expect(plan).toEqual([first, circuit(peer(2))])
  })
})

describe('the peer an address names is its last /p2p/ component', () => {
  it('dials through a relay this tab is already connected to', () => {
    // The bug this is a regression test for. A circuit address is
    // `<relayAddr>/p2p-circuit/webrtc/p2p/<target>`, and `relayAddr` ends in the
    // relay's own peer id — so `address.includes(connectedPeer)` was true of every
    // address behind the relay this tab had already dialled, and every candidate was
    // skipped. Nothing failed and nothing was attempted: two devices sat on one relay
    // and never heard of each other.
    const address = circuit(peer(1))
    expect(address.includes(RELAY)).toBe(true)
    expect(planDials({ candidates: [address], self: SELF, connected: [RELAY] })).toEqual([address])
  })

  it('skips its own entry published behind a relay', () => {
    // The same rule read the other way: the tail is what identifies the tab, not the
    // relay it happens to be reachable through.
    const address = circuit(SELF)
    expect(planDials({ candidates: [address], self: SELF, connected: [] })).toEqual([])
  })
})
