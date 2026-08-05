/**
 * `submitJobWithEgress` — a job's manifest, reachable from the call that ran it.
 *
 * `JobResult` (`@o2/core`, `job/submit.ts`) gains no manifest field: `EgressManifest`
 * is defined in `@o2/net`, and `purity.node.test.ts`'s `'has no dependency edge from
 * @o2/core to any adapter package'` test asserts `packages/core/package.json` has
 * zero `@o2/*` dependencies — a `JobResult` field of that type would break it. So the
 * manifest is sibling metadata, attached here, where `@o2/net` already imports both
 * `submitJob` (`@o2/core`) and `EgressGuard` (`./egress.ts`).
 *
 * The technique is the one 13-CONTEXT.md decision 1 specifies: `EgressGuard` is
 * constructed once, at node startup, and lives for the node's whole process — a
 * manifest is job-scoped, and the gap is closed by reading `guard.manifest.entries`
 * before and after `submitJob` runs and slicing the delta. `EgressGuard.manifest`
 * returns a fresh array on every read, which is what makes the slice non-destructive.
 *
 * **`EgressGuard.reset()` is never called here.** Reset discards the guard's whole
 * history, which is wrong the moment two jobs run back-to-back and a caller wants to
 * inspect the first job's manifest after the second has started — slicing composes
 * with concurrent reads, reset does not.
 *
 * **The two `totalBytes` computations must agree.** This module recomputes the
 * figure over its slice while `EgressGuard.manifest` computes it over the whole
 * record, so the same rule has to hold in both places: a frame carrying a
 * `violation` was refused and contributes zero. If the two ever diverged, the same
 * frames would be readable two ways — a per-job manifest reporting bytes the
 * per-node manifest excludes — and neither figure would mean anything.
 *
 * **Scoped limitation, not solved here (13-CONTEXT.md Risk 2):** attribution assumes
 * one job in flight per guard at a time. If two `submitJob` calls run concurrently
 * against the same guard, their entries windows can overlap, and a byte counted as
 * "job B's manifest" could include frames job A sent while both were in flight.
 * Nothing in the current job model prevents this, and this module does not attempt
 * to detect or fix it.
 *
 * ---
 *
 * **DATA-10 — five further arguments, for the sovereign registration below.**
 *
 * **Why the submitter registers at all.** `takeSovereignHold`
 * (`sovereign-egress.ts`) fires on the *serving* side, for a task about to execute,
 * when the local store already holds the input. A submitter satisfies none of those
 * three, so a node that assembled a job containing another owner's row and never ran
 * a task over it holds no registration and serves the raw bytes on request.
 * Sovereignty is a property of the data, not of whether this node happened to compute
 * over it. And the submitter really does hold the row: `submitJob` content-addresses
 * every shard input and `put`s it into the store it was handed, sovereign ones
 * included.
 *
 * **Why the label is the input CID string.** It matches `takeSovereignHold`'s
 * `task.inputCid.toString()` exactly, so the two registration paths cannot produce
 * two different labels for one payload — and because a guard counts *holds* rather
 * than registrants, a node that both submits and serves the same row takes two holds
 * and stays guarded until both have been given back. The cost, stated
 * rather than hidden: `submitJob` canonicalises every shard input again a few lines
 * later, so a sovereign shard is encoded twice per job. A shared helper between the
 * two would remove that and is not attempted here.
 *
 * **What this changes, stated as a consequence and not hidden.** In the *unseeded*
 * configuration — the owner does not already hold the row — the submitter used to ship
 * the raw bytes when the owner's `RpcBlockSource` asked for the input block; now that
 * response is refused and the job fails. That is correct: `sovereign-egress.ts` states
 * the premise that a sovereign input is owner-pinned and already resident, and a
 * submitter holding another owner's raw row has broken that premise before the fabric
 * is involved. The *seeded* path is unaffected, because an `exec` request frame
 * carries CIDs and not bytes.
 *
 * **Why the lifetime is job-scoped and not process-scoped.** Holding forever would
 * refuse the block after the job too, which is closer to what ROADMAP criterion 7's
 * wording asks for, but it reintroduces exactly the unbounded scan cost Plan 13-07 was
 * written to remove — on a set the node's own submissions grow. Job-scoped matches the
 * serve path's hold/release discipline. What that leaves open: **a peer asking for the
 * same block after the job has finished still receives the raw bytes, and that is
 * unmeasured.** It needs a persistent per-node set of sovereign CIDs that survives the
 * job and the process. See `13.1-04-PLAN.md`'s `## Out of scope`.
 *
 * **Why this is a property of this function and not of the node, and what that costs.**
 * Criterion 7 is worded about a *node*. This registration fires only when a caller
 * reaches the fabric through *this* function. Bare `submitJob` puts every shard input
 * — sovereign included — into the submitter's own blockstore and registers nothing, so
 * **a submitter that used it holds the row, is unguarded, and that is unmeasured.**
 * `packages/node/src/sovereignty-placement.node.test.ts` is the standing example: it
 * drives a real spawned-agent sovereign scenario through bare `submitJob` and keeps
 * passing for exactly that reason. `sovereign-block-refusal.node.test.ts` carries a
 * source scan that fails if a *new* production submit path appears — a fourth file
 * entering a scanned set that today holds exactly three. The fix a later phase would
 * make: register at a boundary the node owns — the blockstore-put of a shard labelled
 * sovereign, or a helper both `submitJob` callers share.
 *
 * Pure module.
 */

import type { Blockstore, JobResult, JobSpec, SubmitError } from '@o2/core'
import { canonicalCid, submitJob } from '@o2/core'
import type { SubmitOptions } from '@o2/core'
import type { EgressGuard, EgressHold, EgressManifest } from './egress.ts'

export type SubmitWithEgressResult =
  | { readonly ok: true; readonly job: JobResult; readonly manifests: readonly EgressManifest[] }
  | { readonly ok: false; readonly error: SubmitError }

/**
 * Slice `guard`'s manifest to only the entries recorded since index `from`.
 *
 * `totalBytes` and `violations` are recomputed from the sliced subset alone — the
 * full manifest's totals cover entries outside the slice and must not be reused.
 * The recomputation follows `EgressGuard.manifest`'s own rule exactly: a refused
 * frame (one carrying a `violation`) contributes zero bytes, because it did not
 * leave.
 */
export function sliceManifest(guard: EgressGuard, from: number): EgressManifest {
  const full = guard.manifest
  const entries = full.entries.slice(from)
  return {
    nodeId: full.nodeId,
    ownerId: full.ownerId,
    entries,
    totalBytes: entries.reduce(
      (sum, entry) => (entry.violation === undefined ? sum + entry.bytes : sum),
      0,
    ),
    violations: entries
      .map((entry) => entry.violation)
      .filter((label): label is string => label !== undefined),
  }
}

/**
 * `submitJob`, unmodified, plus one delta-sliced `EgressManifest` per supplied
 * `guard` — and, for the duration of the job, every sovereign shard's canonical bytes
 * registered on every supplied guard (DATA-10; see this module's comment).
 *
 * On failure — `submitJob` itself returned `ok: false` — the result passes through
 * exactly, with no `manifests` field: a validation failure happens before any shard
 * dispatches, so there is nothing job-scoped to slice. The registrations are given
 * back on that exit and on a throwing one alike.
 */
export async function submitJobWithEgress(
  spec: JobSpec,
  blockstore: Blockstore,
  guards: readonly EgressGuard[],
  // Required for the same reason it is required on `submitJob`, and it has to be required
  // *here* too or this wrapper reopens the hole that one closed: an omittable bag on the
  // path every guarded submitter takes would let a submitter reach the fabric without
  // stating whether it checkpoints. See `SubmitOptions.checkpoints`.
  options: SubmitOptions,
): Promise<SubmitWithEgressResult> {
  // One hold per sovereign *shard* per guard, not per distinct label: a value
  // appearing in two shards takes two holds and gives two back. Holding the values
  // rather than the labels makes that structural — there is no count to keep in step
  // and no way to give back a hold this job did not take.
  const held: EgressHold[] = []
  for (const shard of spec.shards) {
    if (shard.label !== 'sovereign') continue
    const encoded = await canonicalCid(shard.value)
    // A shard whose value will not canonicalise registers nothing and is left to
    // `submitJob`, which names it `input-not-encodable`. This module must not invent a
    // second failure mode for a condition that already has one.
    if (!encoded.ok) continue
    const label = encoded.cid.toString()
    for (const guard of guards) held.push(guard.guard(label, encoded.bytes))
  }
  try {
    // The `before` capture sits *after* the registration, and that is not a claim
    // about behaviour: `guard()` appends no `EgressEntry`, and every frame this job
    // sends is sent below this line either way, so the two orders produce identical
    // manifests today. It is placed this way because the delta window means "what left
    // during this job", and a registration is not something that left.
    const before = guards.map((guard) => guard.manifest.entries.length)
    // Passed straight through. The durable registration happens at `submitJob`'s
    // blockstore-put rather than here, because that put is what makes this node hold the
    // row — and doing it there covers bare `submitJob` too, which this wrapper never
    // could. A caller that omits it keeps the job-scoped guarding below and nothing else.
    const result = await submitJob(spec, blockstore, options)
    if (!result.ok) return result
    return {
      ok: true,
      job: result.job,
      manifests: guards.map((guard, i) => sliceManifest(guard, before[i] as number)),
    }
  } finally {
    // Every exit gives the holds back — the success path, the `ok:false` return above,
    // and a `submitJob` that throws. A submitter whose guard grew by one label per job
    // would scan every frame it ever sends afterwards against every row it has ever
    // submitted, which is the unbounded cost the job-scoped lifetime exists to avoid.
    for (const hold of held) hold.release()
  }
}
