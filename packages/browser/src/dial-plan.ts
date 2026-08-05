/**
 * Which of a discovery round's candidates are worth dialling, decided in one pure
 * place — and testable there.
 *
 * `runDiscoveryRound` in `demo/main.ts` gathers addresses from the page's origin and
 * from the fabric's own reservation store, then dials them. Gathering is I/O and
 * dialling is I/O; the decision between them is neither, and it is where every rule
 * that has gone wrong here lives. Inline, it was reachable only through a real
 * libp2p node, a relay and a `fetch` — which is how the dial budget below came to be
 * enforced by a line that could be deleted with the whole suite still green, and how
 * the tail rule in {@link targetOf} came to ship wrong once already.
 *
 * No DOM, no libp2p, no `fetch`: this file loads in the `node` project unchanged.
 */

/**
 * What one round will spend on dials.
 *
 * A failed dial costs a full timeout, so this bounds the round's wall clock rather
 * than its ambition: rounds repeat, the candidate set is stable, and a peer missed
 * this tick is dialled on the next.
 */
const MAX_DIALS_PER_ROUND = 8

/**
 * How many times a tab re-dials a peer it holds **only** over a relay circuit before
 * it stops trying and reports the pair instead — defect 32.
 *
 * ## Why a bound rather than "retry forever"
 *
 * A relayed circuit is `limited` (2 min / 128 KiB) and this project's own rule is that
 * it may not carry a job, so a peer reachable only that way is connected and unusable
 * and the honest response is to try the upgrade again. But some pairs are *legitimately*
 * relay-only — two browsers whose ICE cannot complete without a TURN server this fabric
 * does not run — and an unbounded retry re-dials those on every tick forever. That cost
 * is not hypothetical: measured on firefox↔webkit, one discovery round containing a
 * relayed-only peer takes about a minute, because the rendezvous request to it burns the
 * page's whole RPC timeout. Retrying forever would make a permanently relay-only peer
 * permanently expensive.
 *
 * ## Why three, and why it self-clears
 *
 * Three is a stated judgement, not a measured optimum: enough that a transient ICE loss
 * gets more than one more chance, few enough that a hopeless pair stops costing rounds.
 * It is not a permanent verdict either — {@link DialPlanner} forgets a peer's spent
 * attempts the moment it either carries work or drops out of the held set, and a relayed
 * circuit drops itself when the relay's duration limit expires. So "given up on" means
 * *for as long as this exact circuit lasts*, and the page says so rather than pretending
 * the peer is fine.
 */
export const MAX_UPGRADE_ATTEMPTS = 3

/**
 * A peer this tab already holds at least one open connection to.
 *
 * `carriesWork` is the whole reason this is a record rather than a peer id, and it is
 * the correction defect 32 exists for. `libp2p.getPeers()` — which is what
 * `transport.peers` returns — reports a peer as connected when the *only* connection to
 * it is a relayed circuit, and a relayed circuit is `limited`: 2 minutes and 128 KiB, a
 * signalling channel this project's own constraints say may not carry a job. A round
 * that treats "connected" as "done" therefore stops dialling exactly the peers that most
 * need dialling again.
 */
export interface HeldPeer {
  /** The peer id. */
  readonly peer: string
  /**
   * True when at least one **open, unlimited** connection to this peer exists.
   *
   * Not "no limited connection exists" — a pair that upgraded successfully routinely
   * keeps its signalling circuit open alongside the WebRTC connection, so the question
   * is whether a usable connection is present, never whether an unusable one is absent.
   */
  readonly carriesWork: boolean
}

/** Why a round is spending one of its dials on an address. */
export type DialPurpose =
  /** No connection to this peer at all. */
  | 'first-contact'
  /** Connected, but over a relayed circuit that cannot carry a job. */
  | 'upgrade'

/** One dial a round intends to make, and what it is for. */
export interface PlannedDial {
  readonly address: string
  /** The peer that address leads to — {@link targetOf}'s answer, not a substring guess. */
  readonly peer: string
  readonly purpose: DialPurpose
}

/** What a round heard about, and what this tab already has. */
export interface DialRound {
  /** Every address the round was offered, in the order it was offered them. */
  readonly candidates: readonly string[]
  /** This tab's own peer id. A directory publishes every entry, including ours. */
  readonly self: string
  /** Every peer this tab holds an open connection to, and whether it can carry work. */
  readonly held: readonly HeldPeer[]
  /**
   * Upgrade dials already spent per peer, so {@link MAX_UPGRADE_ATTEMPTS} can be
   * enforced without this function holding state. {@link DialPlanner} owns the counts.
   */
  readonly spent: ReadonlyMap<string, number>
}

/**
 * The peer an address leads to: the **last** `/p2p/` component, not a substring
 * search.
 *
 * A circuit address is `<relayAddr>/p2p-circuit/webrtc/p2p/<target>`, and `relayAddr`
 * ends in the relay's own peer id — so `address.includes(peer)` was true of every
 * address for the relay this tab is already connected to, and every candidate was
 * skipped. Nothing failed; nothing was attempted. Two devices sat on one relay and
 * never heard of each other, which is exactly how this was found.
 */
const targetOf = (address: string): string => {
  const parts = address.split('/p2p/')
  return parts[parts.length - 1] ?? ''
}

/**
 * The addresses this round should actually dial, in the order it heard them.
 *
 * One address per peer and never more than {@link MAX_DIALS_PER_ROUND} of them, so
 * the caller's loop is a loop over attempts: everything returned here is dialled, and
 * everything filtered out cost nothing.
 *
 * A peer is skipped when this tab holds a connection to it that **can carry work**.
 * A peer held only over a relayed circuit is dialled again — that is the upgrade — up
 * to {@link MAX_UPGRADE_ATTEMPTS} times. See {@link HeldPeer.carriesWork}.
 */
export function planDials(round: DialRound): readonly PlannedDial[] {
  const carries = new Set(round.held.filter((h) => h.carriesWork).map((h) => h.peer))
  const relayed = new Set(round.held.filter((h) => !h.carriesWork).map((h) => h.peer))
  const tried = new Set<string>()
  const plan: PlannedDial[] = []
  for (const address of round.candidates) {
    const peer = targetOf(address)
    // Only the page knows which entry is its own; a directory publishes all of
    // them because it has no way to tell who is asking.
    if (peer === '' || peer === round.self) continue
    if (carries.has(peer) || tried.has(peer)) continue
    // Connected over a relay circuit only. Worth another dial — but a bounded number
    // of them, because a pair that genuinely cannot upgrade would otherwise be
    // re-dialled on every tick for as long as the page is open.
    const upgrade = relayed.has(peer)
    if (upgrade && (round.spent.get(peer) ?? 0) >= MAX_UPGRADE_ATTEMPTS) continue
    tried.add(peer)
    plan.push({ address, peer, purpose: upgrade ? 'upgrade' : 'first-contact' })
    // Spent after the filters above, so the budget goes on dialable targets rather
    // than on entries that were going to be skipped anyway.
    if (plan.length >= MAX_DIALS_PER_ROUND) break
  }
  return plan
}

/**
 * {@link planDials} plus the one piece of state the rule needs: how many upgrade
 * dials have been spent on each peer.
 *
 * Kept here rather than in `demo/main.ts` for this file's founding reason — bookkeeping
 * that lives beside the I/O is bookkeeping no test reaches. A planner has no DOM, no
 * libp2p and no `fetch`; it is a `Map` and two rules, and both are readable from the
 * `node` project.
 *
 * One planner per node. `demo/main.ts` drops its planner when the node stops, so a tab
 * that restarts does not inherit a previous run's verdicts.
 */
export class DialPlanner {
  readonly #spent = new Map<string, number>()

  /**
   * What to dial this round, and what each dial is for.
   *
   * Charges an attempt against every `upgrade` it returns, and forgets any peer that
   * now carries work or is no longer held at all — so the budget is per *episode* of
   * being relay-only, not per lifetime of the page.
   */
  plan(round: Omit<DialRound, 'spent'>): readonly PlannedDial[] {
    this.#forget(round.held)
    const plan = planDials({ ...round, spent: this.#spent })
    for (const dial of plan) {
      if (dial.purpose === 'upgrade') this.#spent.set(dial.peer, (this.#spent.get(dial.peer) ?? 0) + 1)
    }
    return plan
  }

  /**
   * Peers this tab holds over a relay circuit only and has stopped trying to upgrade —
   * connected, counted, and unable to carry a job.
   *
   * The reading the defect existed *without*. A pair in this state answers an offer, so
   * `computePeers()` counts it (measured: `[1,1]` across a firefox↔webkit pair holding
   * nothing but a circuit), and every surface downstream reports a compute peer that the
   * relay's own limits forbid from carrying the work. A condition nobody reports is a
   * condition nobody can act on.
   *
   * Takes the held set rather than reading a cached one: the answer is about *now*, and
   * a planner that answered from its own last round would keep naming a peer that had
   * since upgraded or gone away.
   */
  stalled(held: readonly HeldPeer[]): readonly string[] {
    return held
      .filter((h) => !h.carriesWork && (this.#spent.get(h.peer) ?? 0) >= MAX_UPGRADE_ATTEMPTS)
      .map((h) => h.peer)
  }

  /** How many upgrade dials have been spent on `peer`. Exposed for its own test. */
  spentOn(peer: string): number {
    return this.#spent.get(peer) ?? 0
  }

  /** Drop the count for every peer that no longer needs one. */
  #forget(held: readonly HeldPeer[]): void {
    const stillRelayed = new Set(held.filter((h) => !h.carriesWork).map((h) => h.peer))
    for (const peer of [...this.#spent.keys()]) {
      if (!stillRelayed.has(peer)) this.#spent.delete(peer)
    }
  }
}
