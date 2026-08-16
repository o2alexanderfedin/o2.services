/**
 * Coordinator state as a content-addressed block — CHURN-03.
 *
 * The requestor is a browser tab. Tabs close. So the coordinator has to be the least
 * important participant in the system, and that is arranged by giving it almost
 * nothing to lose: its entire state is a small canonical block, addressed by content,
 * written to the same blockstore as everything else.
 *
 * ## There are no orphaned leases, by construction
 *
 * Criterion 4 asks that a departed requestor never leave "orphaned leases". That is
 * not something this module has to clean up, because **a lease is a deadline, not a
 * lock**. Nobody has to release it and no keeper has to notice the coordinator left —
 * the deadline passes and the task is available again. A lock would have needed a
 * lock-holder-liveness protocol, which is the machinery the deadline replaces.
 *
 * ## Resume is not recovery
 *
 * A checkpoint holds CIDs, never values. Resuming means reading which partitions are
 * already answered and dispatching the rest — the same dispatch path a fresh job
 * takes. There is no partial state to reconstitute, no in-flight work to reconcile,
 * and no distinction in the code between "starting" and "resuming". A task that was
 * in flight when the tab closed is simply outstanding, because its lease expired.
 *
 * ## The chain is the recoverable-partials story
 *
 * Each checkpoint names its predecessor, so checkpoints form a content-addressed
 * chain. If the newest is unreadable — never written, or its block lost — the previous
 * one is still a valid, older, entirely consistent view of the job. That is what makes
 * "fails cleanly with recoverable partials" a property rather than an aspiration: the
 * fallback is not partial state, it is an earlier complete state.
 *
 * Everything read back came out of a blockstore and could be anything, so every field
 * is validated. Same discipline as the wire protocol, and for the same reason.
 *
 * Pure module — the blockstore arrives as a port.
 */

import type { CID } from 'multiformats/cid'
import { canonicalCid, decodeCanonical } from './canonical/encode.ts'
import type { CanonicalValue } from './canonical/encode.ts'
import type { Blockstore } from './ports.ts'
// Type-only, and therefore not a cycle at runtime: `job/submit.ts` imports this module's
// values, and this import is erased. The interface stays where it is defined because
// `checkpoint-optout-scope.node.test.ts` reads that file as "the definition".
import type { CheckpointSink } from './job/submit.ts'

/** One shard that is finished and whose answer is retrievable by CID. */
export interface CompletedShard {
  readonly partitionIndex: number
  readonly resultCid: string
}

export interface JobCheckpoint {
  readonly jobId: string
  readonly moduleCid: string
  readonly partitionCount: number
  /** Shards already answered, sorted by partition index. */
  readonly completed: readonly CompletedShard[]
  /** Coordinator clock when this was written. */
  readonly at: number
  /** CID of the previous checkpoint, or `null` for the first. */
  readonly previous: string | null
}

/**
 * Build a checkpoint from live coordinator state.
 *
 * Sorts and dedupes `completed`, so two coordinators holding the same knowledge write
 * the **same CID** — which makes a checkpoint idempotent to write and comparable
 * without a diff. The same reason the reduce tree sorts its leaves.
 */
export function checkpointOf(state: {
  readonly jobId: string
  readonly moduleCid: string
  readonly partitionCount: number
  readonly completed: readonly CompletedShard[]
  readonly at: number
  readonly previous?: string | null
}): JobCheckpoint {
  const byPartition = new Map<number, string>()
  for (const shard of state.completed) byPartition.set(shard.partitionIndex, shard.resultCid)

  return {
    jobId: state.jobId,
    moduleCid: state.moduleCid,
    partitionCount: state.partitionCount,
    completed: [...byPartition.entries()]
      .map(([partitionIndex, resultCid]) => ({ partitionIndex, resultCid }))
      .sort((a, b) => a.partitionIndex - b.partitionIndex),
    at: state.at,
    previous: state.previous ?? null,
  }
}

function toValue(checkpoint: JobCheckpoint): CanonicalValue {
  return {
    jobId: checkpoint.jobId,
    moduleCid: checkpoint.moduleCid,
    partitionCount: checkpoint.partitionCount,
    completed: checkpoint.completed.map((shard) => ({
      partitionIndex: shard.partitionIndex,
      resultCid: shard.resultCid,
    })),
    at: checkpoint.at,
    previous: checkpoint.previous,
  }
}

/** Write a checkpoint and return the CID that is now the job's handle. */
export async function writeCheckpoint(
  checkpoint: JobCheckpoint,
  blockstore: Blockstore,
): Promise<CID> {
  const encoded = await canonicalCid(toValue(checkpoint))
  if (!encoded.ok) throw new Error(`checkpoint not encodable: ${JSON.stringify(encoded.error)}`)
  await blockstore.put(encoded.bytes)
  return encoded.cid
}

export type CheckpointFailure =
  | { readonly kind: 'block-missing'; readonly cid: string }
  | { readonly kind: 'undecodable'; readonly cid: string }
  | { readonly kind: 'malformed'; readonly cid: string; readonly field: string }

export type CheckpointResult =
  | { readonly ok: true; readonly checkpoint: JobCheckpoint }
  | { readonly ok: false; readonly failure: CheckpointFailure; readonly reason: string }

function asRecord(value: CanonicalValue): { readonly [k: string]: CanonicalValue } | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  if (value instanceof Uint8Array) return null
  return value as { readonly [k: string]: CanonicalValue }
}

function asWholeNumber(value: CanonicalValue | undefined): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return null
  return value
}

/** Read a checkpoint back. Every field validated — this came out of a blockstore. */
export async function readCheckpoint(
  cid: CID,
  blockstore: Blockstore,
): Promise<CheckpointResult> {
  const label = cid.toString()
  const bytes = await blockstore.get(cid)
  if (bytes === undefined) {
    return {
      ok: false,
      failure: { kind: 'block-missing', cid: label },
      reason: `checkpoint block ${label} is not available`,
    }
  }

  let decoded: CanonicalValue
  try {
    decoded = decodeCanonical(bytes)
  } catch (cause) {
    return {
      ok: false,
      failure: { kind: 'undecodable', cid: label },
      reason: `checkpoint block ${label} did not decode: ${cause instanceof Error ? cause.message : String(cause)}`,
    }
  }

  const record = asRecord(decoded)
  if (record === null) {
    return {
      ok: false,
      failure: { kind: 'malformed', cid: label, field: 'root' },
      reason: `checkpoint ${label} is not a record`,
    }
  }

  const bad = (field: string): CheckpointResult => ({
    ok: false,
    failure: { kind: 'malformed', cid: label, field },
    reason: `checkpoint ${label} has an unusable ${field}`,
  })

  const { jobId, moduleCid, previous } = record
  if (typeof jobId !== 'string') return bad('jobId')
  if (typeof moduleCid !== 'string') return bad('moduleCid')
  if (previous !== null && typeof previous !== 'string') return bad('previous')

  const partitionCount = asWholeNumber(record['partitionCount'])
  const at = asWholeNumber(record['at'])
  if (partitionCount === null) return bad('partitionCount')
  if (at === null) return bad('at')

  const completedValue = record['completed']
  if (!Array.isArray(completedValue)) return bad('completed')
  const completed: CompletedShard[] = []
  for (const entry of completedValue) {
    const shard = asRecord(entry)
    if (shard === null) return bad('completed')
    const partitionIndex = asWholeNumber(shard['partitionIndex'])
    const resultCid = shard['resultCid']
    if (partitionIndex === null || typeof resultCid !== 'string') return bad('completed')
    // A partition outside the job is incoherent, and accepting it would let a
    // corrupted checkpoint mark work done that the job never contained.
    if (partitionIndex >= partitionCount) return bad('completed')
    completed.push({ partitionIndex, resultCid })
  }

  return {
    ok: true,
    checkpoint: checkpointOf({ jobId, moduleCid, partitionCount, completed, at, previous }),
  }
}

/** Partition indices still to run. The entire meaning of "resume". */
export function remainingWork(checkpoint: JobCheckpoint): readonly number[] {
  const done = new Set(checkpoint.completed.map((shard) => shard.partitionIndex))
  const remaining: number[] = []
  for (let i = 0; i < checkpoint.partitionCount; i++) if (!done.has(i)) remaining.push(i)
  return remaining
}

/** True when every shard is answered and the job needs no further dispatch. */
export function isComplete(checkpoint: JobCheckpoint): boolean {
  return remainingWork(checkpoint).length === 0
}

/** A handle the store would not give back, and `readCheckpoint`'s own sentence for why. */
export interface UnconfirmedHandle {
  readonly handle: CID
  readonly reason: string
}

/**
 * A {@link CheckpointSink} that keeps what it published and what the store would not
 * confirm. Returned by {@link checkpointsInto}.
 */
export interface StoredCheckpoints extends CheckpointSink {
  /** Handles whose block read back, oldest first — the chain, in the order it was written. */
  readonly confirmed: readonly CID[]
  /** Handles whose block did not read back, with the reason it did not. */
  readonly unconfirmed: readonly UnconfirmedHandle[]
  /** The newest **confirmed** handle — what a second requestor would be handed. `null` until one is. */
  newest(): CID | null
}

/**
 * A checkpoint sink whose destination is a blockstore — CHURN-03's write half.
 *
 * ## What this adds, given that the block is already written
 *
 * `checkpointLogOf` calls `writeCheckpoint` and *then* `publish`, so by the time a sink
 * sees a handle the bytes are already in the store. A sink is therefore not what makes a
 * checkpoint durable. What it can do — and what nothing before it did — is establish that
 * the bytes **came back**, by reading the handle out of the same store through the same
 * validating reader a resume would use. A handle whose block does not resolve is a resume
 * nobody can perform, so counting it would be publishing a promise the store cannot keep.
 *
 * The CID is a hash of the content, so a block that reads back and validates *is* this
 * checkpoint; nothing further is compared, and a field-by-field comparison here would be
 * comparing a value against its own hash.
 *
 * ## It reports rather than throws, and that is not leniency
 *
 * `publish` is awaited inside `checkpointLogOf`'s serialised chain, and that chain is one
 * promise: a rejection from any `publish` rejects every later `record` on it too. So a
 * sink that threw would convert one missing block into a dead job. Browsers evict
 * IndexedDB silently under storage pressure — `idb-blockstore.ts` calls a missing block "a
 * normal condition, not corruption" — which makes that the *expected* case in the browser
 * tier, not the exceptional one. The refusal is recorded in {@link StoredCheckpoints.unconfirmed}
 * and the job carries on.
 *
 * ## What it does not do
 *
 * It publishes nowhere but into its own lists. A handle is a mutable pointer and a
 * blockstore is content-addressed, so there is no stable key in `store` under which the
 * *newest* handle could be found again — a returning tab can read a checkpoint it is
 * handed and cannot discover one it is not. Making the newest handle discoverable needs a
 * mutable key space this port does not have, and inventing one here would be claiming a
 * capability the store does not provide.
 */
export function checkpointsInto(store: Blockstore): StoredCheckpoints {
  const confirmed: CID[] = []
  const unconfirmed: UnconfirmedHandle[] = []

  return {
    confirmed,
    unconfirmed,
    newest: (): CID | null => confirmed[confirmed.length - 1] ?? null,
    async publish(handle: CID): Promise<void> {
      const read = await readCheckpoint(handle, store)
      if (read.ok) confirmed.push(handle)
      else unconfirmed.push({ handle, reason: read.reason })
    },
  }
}

/**
 * Recover from the newest readable checkpoint among the handles a caller kept.
 *
 * This is the "fails cleanly with recoverable partials" path, and the signature is the
 * honest one. **A chain cannot be walked backwards past a block you cannot read**,
 * because the link to the predecessor lives *inside* that block. So recovery works
 * from the handles the coordinator published — each `writeCheckpoint` returns one —
 * newest first, and stops at the first that is readable.
 *
 * It returns an *older complete* view rather than a patched-together one, and says how
 * many it had to skip, so a caller can tell resuming from losing ground.
 */
export interface RecoveredCheckpoint {
  readonly checkpoint: JobCheckpoint
  readonly cid: CID
  /** Handles skipped because their blocks were unreadable. 0 means the newest. */
  readonly skipped: number
}

export async function recoverCheckpoint(
  candidates: readonly CID[],
  blockstore: Blockstore,
): Promise<RecoveredCheckpoint | null> {
  let skipped = 0
  for (const cid of candidates) {
    const result = await readCheckpoint(cid, blockstore)
    if (result.ok) return { checkpoint: result.checkpoint, cid, skipped }
    skipped += 1
  }
  return null
}

/**
 * Walk a checkpoint's lineage while the blocks are present — the audit view.
 *
 * Distinct from recovery on purpose. Recovery answers "what is the newest state I can
 * still act on"; this answers "how did the job get here", and it is only available
 * when the chain happens to be intact. It stops rather than fails at the first missing
 * link, because an incomplete history is normal — blocks are garbage-collected.
 */
export async function checkpointChain(
  cid: CID,
  blockstore: Blockstore,
  resolve: (value: string) => CID | null,
): Promise<readonly JobCheckpoint[]> {
  const chain: JobCheckpoint[] = []
  const seen = new Set<string>()
  let current: CID | null = cid

  while (current !== null) {
    // A corrupted chain could point at itself. A cycle must end the walk rather
    // than hang an audit.
    if (seen.has(current.toString())) break
    seen.add(current.toString())

    const result: CheckpointResult = await readCheckpoint(current, blockstore)
    if (!result.ok) break
    chain.push(result.checkpoint)
    const { previous } = result.checkpoint
    current = previous === null ? null : resolve(previous)
  }

  return chain
}
