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

/** What a round heard about, and what this tab already has. */
export interface DialRound {
  /** Every address the round was offered, in the order it was offered them. */
  readonly candidates: readonly string[]
  /** This tab's own peer id. A directory publishes every entry, including ours. */
  readonly self: string
  /** Peer ids this tab already holds a connection to. */
  readonly connected: readonly string[]
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
 */
export function planDials(round: DialRound): readonly string[] {
  const already = new Set(round.connected)
  const tried = new Set<string>()
  const plan: string[] = []
  for (const address of round.candidates) {
    const target = targetOf(address)
    // Only the page knows which entry is its own; a directory publishes all of
    // them because it has no way to tell who is asking.
    if (target === '' || target === round.self) continue
    if (already.has(target) || tried.has(target)) continue
    tried.add(target)
    plan.push(address)
    // Spent after the filters above, so the budget goes on dialable targets rather
    // than on entries that were going to be skipped anyway.
    if (plan.length >= MAX_DIALS_PER_ROUND) break
  }
  return plan
}
