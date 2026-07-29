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
 * Pure module.
 */

import type { Blockstore, JobResult, JobSpec, SubmitError } from '@o2/core'
import { submitJob } from '@o2/core'
import type { EgressGuard, EgressManifest } from './egress.ts'

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
 * `guard`. On failure — `submitJob` itself returned `ok: false` — the result passes
 * through exactly, with no `manifests` field: a validation failure happens before any
 * shard dispatches, so there is nothing job-scoped to slice.
 */
export async function submitJobWithEgress(
  spec: JobSpec,
  blockstore: Blockstore,
  guards: readonly EgressGuard[],
): Promise<SubmitWithEgressResult> {
  const before = guards.map((guard) => guard.manifest.entries.length)
  const result = await submitJob(spec, blockstore)
  if (!result.ok) return result
  return {
    ok: true,
    job: result.job,
    manifests: guards.map((guard, i) => sliceManifest(guard, before[i] as number)),
  }
}
