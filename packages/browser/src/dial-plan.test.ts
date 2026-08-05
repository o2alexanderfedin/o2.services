import { describe, expect, it } from 'vitest'
import { DialPlanner, MAX_UPGRADE_ATTEMPTS, planDials } from './dial-plan.ts'
import type { HeldPeer, PlannedDial } from './dial-plan.ts'

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

/** A peer reached over a connection that can carry a job — WebRTC, or a direct dial. */
const working = (id: string): HeldPeer => ({ peer: id, carriesWork: true })
/** A peer reached over nothing but a relayed circuit — defect 32's state. */
const relayedOnly = (id: string): HeldPeer => ({ peer: id, carriesWork: false })

/** The addresses of a plan, for the cases whose subject is *which* rather than *why*. */
const addressesOf = (plan: readonly PlannedDial[]): string[] => plan.map((dial) => dial.address)

/** A round with no upgrade history, which is every round the rules below describe. */
const round = (
  candidates: readonly string[],
  held: readonly HeldPeer[] = [],
): { candidates: readonly string[]; self: string; held: readonly HeldPeer[]; spent: ReadonlyMap<string, number> } => ({
  candidates,
  self: SELF,
  held,
  spent: new Map(),
})

describe('a round spends a bounded number of dials', () => {
  it('stops at the budget rather than sitting out a timeout per candidate', () => {
    // A failed dial costs a full timeout, so twenty sequential attempts is a round
    // that outlives the tick that started it and a tab that stops discovering
    // anything. Rounds repeat and the candidate set is stable, so the peers cut
    // here are dialled on the next one. Eight is `MAX_DIALS_PER_ROUND`, written out
    // rather than imported: a retune of the budget is a decision, and it should have
    // to be stated here too rather than passing silently.
    const candidates = Array.from({ length: 20 }, (_unused, i) => circuit(peer(i)))
    expect(addressesOf(planDials(round(candidates)))).toEqual(candidates.slice(0, 8))
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
    const plan = planDials(
      round([...skipped, ...fresh], [0, 1, 2, 3].map((i) => working(peer(i)))),
    )
    expect(addressesOf(plan)).toEqual(fresh)
  })
})

describe('a candidate this tab cannot use is not one of the eight', () => {
  it('skips its own entry, which a directory has no way to omit', () => {
    const plan = planDials(round([circuit(SELF), circuit(peer(1))]))
    expect(addressesOf(plan)).toEqual([circuit(peer(1))])
  })

  it('skips a peer this tab already reaches over a connection that carries work', () => {
    const plan = planDials(round([circuit(peer(1)), circuit(peer(2))], [working(peer(1))]))
    expect(addressesOf(plan)).toEqual([circuit(peer(2))])
  })

  it('dials a peer once however many ways the directory offers to reach it', () => {
    // The origin and the fabric both answer, and a peer reachable through two relays
    // appears twice. Dialling it twice spends two of the eight on one peer.
    const first = circuit(peer(1), RELAY)
    const plan = planDials(round([first, circuit(peer(1), OTHER_RELAY), circuit(peer(2))]))
    expect(addressesOf(plan)).toEqual([first, circuit(peer(2))])
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
    expect(addressesOf(planDials(round([address], [working(RELAY)])))).toEqual([address])
  })

  it('skips its own entry published behind a relay', () => {
    // The same rule read the other way: the tail is what identifies the tab, not the
    // relay it happens to be reachable through.
    const address = circuit(SELF)
    expect(addressesOf(planDials(round([address], [working(SELF)])))).toEqual([])
  })
})

/**
 * Defect 32. A pair that dialled each other in the same moment can end up holding
 * nothing but a relayed circuit — `limited`, 2 min / 128 KiB, a signalling channel this
 * project's constraints say may not carry a job. `libp2p.getPeers()` counts that peer as
 * connected, so a round that skipped every connected peer never dialled it again.
 *
 * Measured before it was fixed, on firefox↔webkit over a real relay: four forced
 * simultaneous rounds out of four ended with both tabs holding two limited circuits and
 * no WebRTC connection, and the very next round on each side reported `dialed: []`,
 * `failed: []` — nothing attempted, nothing failed, nothing to notice.
 */
describe('a peer held only over a relayed circuit is not a peer this tab is done with', () => {
  it('dials it again, and says the dial is an upgrade rather than first contact', () => {
    const plan = planDials(round([circuit(peer(1))], [relayedOnly(peer(1))]))
    expect(plan).toEqual([{ address: circuit(peer(1)), peer: peer(1), purpose: 'upgrade' }])
  })

  it('reads the usable connection, not the absence of an unusable one', () => {
    // The pair that upgraded successfully keeps its signalling circuit open beside the
    // WebRTC connection — measured: three connections, two limited, one not. A rule
    // written as "no limited connection exists" would re-dial that pair forever.
    const plan = planDials(round([circuit(peer(1))], [working(peer(1))]))
    expect(plan).toEqual([])
  })

  it('is first contact when there is no connection at all, and an upgrade when there is', () => {
    const plan = planDials(round([circuit(peer(1)), circuit(peer(2))], [relayedOnly(peer(2))]))
    expect(plan).toEqual([
      { address: circuit(peer(1)), peer: peer(1), purpose: 'first-contact' },
      { address: circuit(peer(2)), peer: peer(2), purpose: 'upgrade' },
    ])
  })

  it('stops after the upgrade budget, so a pair that cannot upgrade stops costing rounds', () => {
    const spent = new Map([[peer(1), MAX_UPGRADE_ATTEMPTS]])
    const plan = planDials({
      candidates: [circuit(peer(1))],
      self: SELF,
      held: [relayedOnly(peer(1))],
      spent,
    })
    expect(plan).toEqual([])
  })
})

describe('the planner charges upgrades and forgets peers that no longer need charging', () => {
  it('gives up after exactly MAX_UPGRADE_ATTEMPTS rounds and then names the peer', () => {
    const planner = new DialPlanner()
    const held = [relayedOnly(peer(1))]
    const candidates = [circuit(peer(1))]

    // Written as a loop over the constant rather than three copied blocks: the number
    // is a judgement stated in one place, and a change to it should move this case
    // rather than leave it asserting a stale count that still passes.
    for (let attempt = 1; attempt <= MAX_UPGRADE_ATTEMPTS; attempt++) {
      expect(planner.plan({ candidates, self: SELF, held })).toEqual([
        { address: circuit(peer(1)), peer: peer(1), purpose: 'upgrade' },
      ])
      expect(planner.spentOn(peer(1))).toBe(attempt)
      // Not stalled yet on any round before the last: the budget is spent *after* the
      // dial it paid for, so a peer with one attempt left is still being tried.
      expect(planner.stalled(held)).toEqual(attempt === MAX_UPGRADE_ATTEMPTS ? [peer(1)] : [])
    }

    expect(planner.plan({ candidates, self: SELF, held })).toEqual([])
    expect(planner.stalled(held)).toEqual([peer(1)])
  })

  it('charges nothing for first contact, so a peer nobody reached keeps being dialled', () => {
    const planner = new DialPlanner()
    const candidates = [circuit(peer(1))]
    for (let attempt = 0; attempt < MAX_UPGRADE_ATTEMPTS + 2; attempt++) {
      expect(planner.plan({ candidates, self: SELF, held: [] })).toEqual([
        { address: circuit(peer(1)), peer: peer(1), purpose: 'first-contact' },
      ])
    }
    expect(planner.spentOn(peer(1))).toBe(0)
    expect(planner.stalled([relayedOnly(peer(1))])).toEqual([])
  })

  it('forgets a peer that upgraded, so a later relapse gets the full budget again', () => {
    const planner = new DialPlanner()
    const candidates = [circuit(peer(1))]
    for (let attempt = 1; attempt <= MAX_UPGRADE_ATTEMPTS; attempt++) {
      planner.plan({ candidates, self: SELF, held: [relayedOnly(peer(1))] })
    }
    expect(planner.spentOn(peer(1))).toBe(MAX_UPGRADE_ATTEMPTS)

    // The upgrade lands. A relayed circuit dies of its own duration limit soon after,
    // and the pair should not carry a verdict from the episode that is over.
    planner.plan({ candidates, self: SELF, held: [working(peer(1))] })
    expect(planner.spentOn(peer(1))).toBe(0)
    expect(planner.stalled([relayedOnly(peer(1))])).toEqual([])
  })

  it('forgets a peer that went away entirely', () => {
    const planner = new DialPlanner()
    planner.plan({ candidates: [circuit(peer(1))], self: SELF, held: [relayedOnly(peer(1))] })
    expect(planner.spentOn(peer(1))).toBe(1)
    planner.plan({ candidates: [], self: SELF, held: [] })
    expect(planner.spentOn(peer(1))).toBe(0)
  })

  it('names nobody while a relayed peer still has budget left', () => {
    // `stalled` answers about *now* from the held set it is handed, so a peer that is
    // relay-only but not yet given up on is not reported, and a peer that has gone away
    // is not reported however much budget it burned.
    const planner = new DialPlanner()
    const held = [relayedOnly(peer(1))]
    planner.plan({ candidates: [circuit(peer(1))], self: SELF, held })
    expect(planner.stalled(held)).toEqual([])
  })
})
