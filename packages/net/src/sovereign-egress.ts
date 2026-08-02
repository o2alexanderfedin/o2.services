/**
 * `takeSovereignHold` — the production caller `EgressGuard.guard()` never had.
 *
 * `EgressGuard` (`egress.ts`) is a tap: it watches every outbound frame for byte
 * patterns someone registered with `.guard()`. Registration is a separate act from
 * watching, and until this module, nothing outside a test ever performed it — the
 * only call site anywhere in the repo was `sovereign-execution.test.ts`, standing in
 * for "the owner declared this payload sovereign". A tap with nothing registered
 * cannot fail, which makes every DATA-05 check that depends on it trivially green
 * regardless of what actually happened.
 *
 * **This was an `Executor` decorator, and is now a function `serveAgent` calls.** The
 * decorator knew *whether* a dispatch had registered anything and had nowhere to say
 * so; `serveAgent` released regardless, on the label the request named, and stripped
 * holds it never took. Taking the hold where it is given back collapses those two
 * facts into one place, and the hold is now a value only its taker can give back.
 *
 * **Composed logically outside `guardSovereignty`, exactly as before.**
 * `guardSovereignty` (`@o2/core`) refuses a sovereign task before it runs when the
 * serving node is not cleared for its owner. Taking a hold on a task that refusal is
 * about to reject is harmless — nothing leaves on a refusal — and the hold is given
 * back on that exit like any other.
 *
 * **The registration blockstore must be the node's local-only store, never one with
 * network fallback.** A sovereign input is owner-pinned: it must already be resident
 * on the owner's own node, by construction of what "sovereign" means in this fabric.
 * Registering from a store with network fallback would make the act of *declaring* a
 * payload sovereign itself a network round trip — fetching bytes from a peer in order
 * to tell the tap to watch for them, which defeats the point of pinning the data
 * locally in the first place. `AgentOptions.blockstore` is the `FetchingBlockstore`
 * at both production factories and is therefore the wrong store; `egress.sovereignInputs`
 * is the right one, and the two travel together in one option so a tap without a store
 * cannot be constructed.
 *
 * **A missing block is a silent skip, not a thrown error.** If the registration store
 * does not hold the task's input, the task still runs unchanged; the tap simply has
 * nothing new to watch for this one input. Throwing here would turn a tap shortfall
 * into an availability outage for a task that may otherwise complete fine — the input
 * might be fetched by the executor itself from elsewhere, or the task might not need
 * this node's local copy at all. Reversing that ruling was considered while fixing
 * B02 and rejected as a behaviour change beyond the bug. **The residual it leaves,
 * named:** such a dispatch runs with its input unguarded on this node, so a reply
 * carrying the raw bytes would not be refused. What is now true and was not is that
 * it strips nobody else's hold on the way.
 *
 * Pure module: no platform imports, so it lives beside the rest of `@o2/net`'s
 * portable code (`purity.node.test.ts` enforces this).
 */

import { encodeCanonical } from '@o2/core'
import type { Blockstore, Task } from '@o2/core'
import type { CID } from 'multiformats/cid'
import type { EgressGuard, EgressHold } from './egress.ts'
import { encodeResponse } from './protocol.ts'

export interface SovereignEgressOptions {
  /** The node's local-only tier — must already hold a sovereign input's bytes. */
  readonly blockstore: Blockstore
  /** The node's own tap. Registration feeds this guard's `.guard()`, nothing else. */
  readonly guard: EgressGuard
}

/**
 * Declare `task`'s input to `options.guard` and take one hold on it, or `null`.
 *
 * `null` for every task whose `label` is not `'sovereign'`, and for a sovereign task
 * whose bytes are not locally resident — in both cases neither the guard nor anything
 * else is touched, so a public task pays no extra I/O and carries no risk of being
 * mistaken for sovereign data. A caller that gets `null` has nothing to give back,
 * which is the state the old unconditional release could not represent.
 */
export async function takeSovereignHold(
  task: Task,
  options: SovereignEgressOptions,
): Promise<EgressHold | null> {
  if (task.label !== 'sovereign') return null
  const bytes = await options.blockstore.get(task.inputCid)
  if (bytes === undefined) return null
  return options.guard.guard(task.inputCid.toString(), bytes)
}

/**
 * Exactly the value `AgentOptions.egress` carries.
 *
 * Written out here rather than imported from `agent.ts` so this module keeps its
 * direction of dependency — `agent.ts` imports this file, not the other way round.
 */
export type EgressDisposition =
  | {
      readonly guard: EgressGuard
      readonly sovereignInputs: Blockstore
      /**
       * DATA-10's at-rest half — the CIDs this node has ever come to hold sovereign
       * bytes for, surviving the job and the process.
       *
       * **Required, with a named absence, because an optional hook with a silent
       * default is a hole** — the same rule `serveAgent`'s hooks are held to.
       */
      readonly sovereignCids: SovereignCids | 'forgets-sovereignty-between-jobs'
    }
  | 'holds-no-registrations'

/**
 * A durable set of CIDs whose bytes are sovereign — DATA-10, criterion 7's at-rest half.
 *
 * ## Why this is not just a longer-lived `EgressGuard` hold
 *
 * `EgressGuard` is keyed on **payload bytes** and answers "does this outbound frame
 * contain a guarded row", by scanning. That question is worth its cost because it catches
 * sovereign bytes anywhere in any frame, including ones nobody anticipated — and the cost
 * is what bounds its lifetime to a job. `egress.ts`'s own `guard()` doc forbids eviction
 * and says why: *the set is bounded by giving holds back, which is a bound somebody can be
 * shown*. Holding forever would remove that bound and leave every later frame scanned
 * against every row the node ever submitted, which `submit-with-egress.ts` names as
 * *exactly the unbounded scan cost Plan 13-07 was written to remove*.
 *
 * This is keyed on the **CID** and answers "is this block sovereign", by lookup. A `block`
 * request names a CID, so the at-rest case never needed the byte scan. Unbounded growth
 * here costs memory proportional to the number of distinct sovereign blocks the node has
 * held — it does not cost anything per frame.
 *
 * **So the two coexist rather than one replacing the other**, and each answers the
 * question it is cheap at. A node forgetting one still has the other.
 *
 * ## What is deliberately absent
 *
 * No `delete`, no eviction, no cap — for the reason `egress.ts:230-237` gives about its own
 * set. Sovereignty is a property of the data. A node that forgot a CID was sovereign would
 * serve it, and would do so silently.
 */
export interface SovereignCids {
  /**
   * Record that `cid`'s bytes are sovereign. Idempotent.
   *
   * Durable before it resolves: a node that recorded a CID and then lost power must not
   * come back serving it.
   */
  add(cid: string): Promise<void>
  /**
   * Whether `cid` is known sovereign.
   *
   * Synchronous on purpose. It is consulted on the `block` branch's hot path, and an
   * implementation that had to await I/O per request would put a disk read between a peer
   * and every block it asks for. Both shipped adapters load the set at open and keep it in
   * memory; `add` is what writes.
   */
  has(cid: string): boolean
}

/**
 * The withholding predicate for `SelfRecordIndex` — SCHED-01, DATA-05.
 *
 * **This is the only correct construction, and the reason is not style.** The
 * invariant is *a node never advertises a block its own `block` branch would refuse
 * to serve*: a `providers` answer that said "yes, I hold it" about a refused block
 * would convert the ruling recorded in `egress.ts` — that a peer cannot tell refusal
 * from absence — into a peer that **can** tell, learning it without asking for the
 * bytes and without anything appearing on this node's manifest. That is a side
 * channel around a refusal.
 *
 * Holding an invariant between two branches means asking **one** question twice, not
 * writing the question down twice. So this builds the candidate reply the `block`
 * branch would build for that CID — `encodeCanonical(encodeResponse({kind:'block',
 * bytes}))` — and puts it to {@link EgressGuard.violationIn}, which is the same pure
 * query `serveAgent`'s pre-scan reaches through `refuse`. Same bytes, same scan, same
 * answer.
 *
 * **The tempting cheaper version is wrong, and it is worth naming.**
 * `guard.registrations.includes(cid.toString())` agrees with the block branch today,
 * but only because two independent facts happen to line up: {@link takeSovereignHold}
 * uses the CID string as the label, *and* registers exactly that CID's bytes.
 * {@link EgressGuard.guard} takes an arbitrary label for an arbitrary payload, so
 * neither fact is guaranteed by anything. The moment a payload is registered under
 * any other label, the label-keyed predicate advertises a block the block branch
 * refuses — the exact side channel, reintroduced by a line that reads like a
 * simplification.
 *
 * `violationIn` records nothing (it is documented as a pure query), which is what
 * makes it safe to ask on a lookup: a provider question is not a frame that was
 * offered to the exit, and counting it on the manifest would make every provider
 * lookup look like an attempted send.
 *
 * Two short-circuits, both mirroring `refusedReason`'s own so the two cannot drift:
 * a node holding no registrations withholds nothing, and a body that will not
 * canonicalise is not a body this node could send either — it fails loudly on its own
 * path rather than being converted into a withholding here.
 *
 * Returns the stated absence `'advertises-everything-it-holds'` for a node whose sends
 * are not tapped, which is the same case `refusedReason` answers `null` for.
 */
export function withholdingFrom(
  egress: EgressDisposition,
): ((cid: CID) => Promise<boolean>) | 'advertises-everything-it-holds' {
  if (egress === 'holds-no-registrations') return 'advertises-everything-it-holds'
  const { guard, sovereignInputs, sovereignCids } = egress
  return async (cid: CID): Promise<boolean> => {
    // DATA-10's at-rest half, asked FIRST and by CID. The `block` branch refuses a
    // recorded CID outright, so `providers` must withhold it outright too — the invariant
    // this predicate exists to hold is that it names exactly the set `refusedReason`
    // consults, and a node advertising a block its own `block` branch refuses is the
    // defect 18-02 planted and measured.
    //
    // Before the guard check, not after, because it is the cheaper question and the one
    // that stays true after the job ends.
    if (sovereignCids !== 'forgets-sovereignty-between-jobs' && sovereignCids.has(cid.toString())) {
      return true
    }
    if (guard.registrations.length === 0) return false
    // The local-only tier, for the reason this module's header already gives about
    // registration: asking whether to advertise a block must not itself fetch one.
    const bytes = await sovereignInputs.get(cid)
    if (bytes === undefined) return false
    const encoded = encodeCanonical(encodeResponse({ kind: 'block', bytes }))
    if (!encoded.ok) return false
    return guard.violationIn(encoded.bytes) !== null
  }
}
