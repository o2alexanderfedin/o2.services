/**
 * The mutable key space a checkpoint resume needs, and which the blockstore is not —
 * CHURN-03's read half, browser tier.
 *
 * ## Why this exists at all
 *
 * `demo/main.ts` has written a checkpoint chain into its `IdbBlockstore` since 2026-08-16,
 * and nothing could ever read it back. Its own comment says why, exactly:
 *
 * > *"A blockstore is content-addressed, so there is no stable key under which the newest
 * > handle could be left for a returning tab to find. The block is recoverable by anyone
 * > holding its CID; discovering that CID unaided needs a **mutable key space this port
 * > does not have**."*
 *
 * This is that key space and nothing more: one small mutable record per job, holding the
 * newest handle that job confirmed. The blocks stay where they are.
 *
 * ## Keyed by job id, and that is not a detail
 *
 * `submitJob` derives a job's id from its module CID and its input CIDs, and `resumeState`
 * refuses a handle whose checkpoint names a different job — `checkpoint-names-another-job`.
 * A store keyed by anything looser would hand back a handle for the wrong job, `submitJob`
 * would return `ok: false`, and `demo/main.ts` turns that into a thrown `submit failed`.
 * **That failure was measured on 2026-08-18** while attempting the same wiring in
 * `bin/bench.ts`: one handle applied across a sweep of differently-shaped jobs made every
 * rung refuse, and the driver reported a benchmark over nothing. Keying by job id is what
 * makes a returned handle true by construction rather than by luck.
 *
 * ## A separate database, for the reason `idb-identity-store.ts` gives
 *
 * The blockstore is budgeted and evicted as a cache and the demo deletes it by name. A
 * resume pointer living inside it would be thrown away by a cache wipe together with the
 * blocks it names — which is survivable — but would also be thrown away *independently* of
 * them, which is not: a pointer to blocks that still exist is exactly what makes the resume
 * possible. Beside the identity store, not inside the cache.
 *
 * ## What this does NOT claim
 *
 * IndexedDB is evicted silently under storage pressure, so a stored handle can vanish. That
 * is a fact about browser storage, not about this record, and it is why {@link
 * newestHandleFor} answers `null` rather than throwing: a missing pointer means *start the
 * job from the beginning*, which is always correct and never a corruption.
 *
 * Same-target rules as the rest of `packages/browser/src`: no `node:` imports.
 */

import { openDB } from 'idb'
import type { DBSchema, IDBPDatabase } from 'idb'

const STORE = 'checkpoints'

interface CheckpointDb extends DBSchema {
  [STORE]: {
    /** The job id, as {@link https://github.com/o2-services | `submitJob`} derives it. */
    key: string
    /** The newest CONFIRMED handle, as a CID string. */
    value: string
  }
}

/**
 * One mutable record per job: `jobId → newest confirmed handle`.
 *
 * Reads answer `null` for an absent record, matching `IdbIdentityStore.loadCertificate`'s
 * signature so the two call sites read alike.
 */
export class IdbCheckpoints {
  readonly #db: IDBPDatabase<CheckpointDb>
  readonly #name: string

  private constructor(db: IDBPDatabase<CheckpointDb>, name: string) {
    this.#db = db
    this.#name = name
  }

  /** The database this instance is bound to — read by tests and by refusal text. */
  get name(): string {
    return this.#name
  }

  static async open(name: string): Promise<IdbCheckpoints> {
    const db = await openDB<CheckpointDb>(name, 1, {
      upgrade(database) {
        if (!database.objectStoreNames.contains(STORE)) database.createObjectStore(STORE)
      },
    })
    return new IdbCheckpoints(db, name)
  }

  /**
   * The newest confirmed handle for this job, or `null`.
   *
   * `null` means *no resume is available*, which is a normal state and not an error: a job
   * this tab has never run, a record evicted under storage pressure, and a first visit all
   * answer the same way, and all three want the same behaviour — run the whole job.
   */
  async newestHandleFor(jobId: string): Promise<string | null> {
    return (await this.#db.get(STORE, jobId)) ?? null
  }

  /**
   * Record a handle as the newest for this job.
   *
   * **Only ever called with a CONFIRMED handle.** `checkpointsInto` separates `confirmed`
   * from `unconfirmed` precisely because an unconfirmed handle did not read back out of the
   * store, and filing one here would leave a pointer that resolves to nothing — the caller
   * would then resume from a checkpoint that cannot be read and get
   * `checkpoint-unreadable`, which is a worse outcome than starting over.
   */
  async remember(jobId: string, handle: string): Promise<void> {
    await this.#db.put(STORE, handle, jobId)
  }

  /** Drop a job's pointer. Absent keys are ignored — forgetting twice is harmless. */
  async forget(jobId: string): Promise<void> {
    await this.#db.delete(STORE, jobId)
  }

  close(): void {
    this.#db.close()
  }
}
