/**
 * Job submission — MR-01, DATA-01, VER-06.
 *
 * A job is a module plus N shards. Each shard executes independently at the job's
 * redundancy factor, and every shard's inputs and outputs are content-addressed
 * so an intermediate is cacheable, dedupable, and recomputable from its CID
 * alone. That last property is what makes churn repair cheap in a later phase —
 * a lost combine is "call the same pure function somewhere else", with no state
 * to migrate.
 *
 * Pure module: the blockstore and executors arrive as ports.
 */

import type { CID } from 'multiformats/cid'
import { canonicalCid } from '../canonical/encode.ts'
import type { CanonicalValue } from '../canonical/encode.ts'
import type { Blockstore, Executor, Task } from '../ports.ts'
import { executeVerified } from './verify.ts'
import type { VerificationResult } from './verify.ts'

export interface JobSpec {
  readonly moduleCid: CID
  /** One input value per shard. Length is the partition count. */
  readonly shards: readonly CanonicalValue[]
  /**
   * Executors available to run each shard. `redundancy` of them are used per
   * shard; supplying fewer than `redundancy` is an error rather than a silent
   * downgrade, so a job never reports verified agreement it did not achieve.
   */
  readonly executors: readonly Executor[]
  /** Replicas per shard. 1 disables verification (VER-06). */
  readonly redundancy: number
}

export interface ShardResult {
  readonly partitionIndex: number
  readonly inputCid: CID
  readonly verification: VerificationResult
}

export interface JobResult {
  readonly moduleCid: CID
  readonly shards: readonly ShardResult[]
  /** True only if every shard reached `agreed`. */
  readonly complete: boolean
  /** Node-seconds spent including redundant work. */
  readonly grossNodeSeconds: number
  /** Node-seconds that contributed to the answer. */
  readonly usefulNodeSeconds: number
  /**
   * Measured verification tax: gross / useful. Reported on every job so the cost
   * of verification is always visible rather than discovered later (VER-06).
   */
  readonly verificationMultiplier: number
}

export type SubmitError =
  | { kind: 'no-shards' }
  | { kind: 'bad-redundancy'; redundancy: number }
  | { kind: 'not-enough-executors'; have: number; need: number }
  | { kind: 'input-not-encodable'; partitionIndex: number; detail: string }

export type SubmitResult =
  | { ok: true; job: JobResult }
  | { ok: false; error: SubmitError }

/** Round-robin executor selection, offset by shard so shards spread across nodes. */
function executorsFor(
  all: readonly Executor[],
  shardIndex: number,
  redundancy: number,
): Executor[] {
  const picked: Executor[] = []
  for (let i = 0; i < redundancy; i++) {
    picked.push(all[(shardIndex + i) % all.length] as Executor)
  }
  return picked
}

/**
 * Submit a job: shard it, execute each shard redundantly, verify, return CIDs.
 *
 * Shards run concurrently — they share no state by construction, which is the
 * whole reason the partition is the unit of parallelism.
 */
export async function submitJob(
  spec: JobSpec,
  blockstore: Blockstore,
): Promise<SubmitResult> {
  if (spec.shards.length === 0) return { ok: false, error: { kind: 'no-shards' } }
  if (!Number.isInteger(spec.redundancy) || spec.redundancy < 1) {
    return { ok: false, error: { kind: 'bad-redundancy', redundancy: spec.redundancy } }
  }
  if (spec.executors.length < spec.redundancy) {
    return {
      ok: false,
      error: {
        kind: 'not-enough-executors',
        have: spec.executors.length,
        need: spec.redundancy,
      },
    }
  }

  const partitionCount = spec.shards.length

  // Persist every shard input as a block first, so a task is addressed entirely
  // by CID and could be re-dispatched to any node without resending the payload.
  const inputCids: CID[] = []
  for (let i = 0; i < partitionCount; i++) {
    const encoded = await canonicalCid(spec.shards[i] as CanonicalValue)
    if (!encoded.ok) {
      return {
        ok: false,
        error: {
          kind: 'input-not-encodable',
          partitionIndex: i,
          detail: JSON.stringify(encoded.error),
        },
      }
    }
    await blockstore.put(encoded.bytes)
    inputCids.push(encoded.cid)
  }

  const shards = await Promise.all(
    inputCids.map(async (inputCid, partitionIndex): Promise<ShardResult> => {
      const task: Task = {
        moduleCid: spec.moduleCid,
        inputCid,
        partitionIndex,
        partitionCount,
      }
      const verification = await executeVerified(
        task,
        executorsFor(spec.executors, partitionIndex, spec.redundancy),
      )
      // Persist an agreed result so it is retrievable by CID like any other block.
      if (verification.status === 'agreed') {
        const out = await canonicalCid(verification.output)
        if (out.ok) await blockstore.put(out.bytes)
      }
      return { partitionIndex, inputCid, verification }
    }),
  )

  let gross = 0
  let useful = 0
  for (const s of shards) {
    if (s.verification.status === 'agreed') {
      gross += s.verification.grossNodeSeconds
      useful += s.verification.usefulNodeSeconds
    }
  }

  return {
    ok: true,
    job: {
      moduleCid: spec.moduleCid,
      shards,
      complete: shards.every((s) => s.verification.status === 'agreed'),
      grossNodeSeconds: gross,
      usefulNodeSeconds: useful,
      verificationMultiplier: useful === 0 ? 0 : gross / useful,
    },
  }
}
