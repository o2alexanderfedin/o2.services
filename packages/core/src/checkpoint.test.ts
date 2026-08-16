import { CID } from 'multiformats/cid'
import { describe, expect, it } from 'vitest'
import { MemoryBlockstore } from './blockstore/memory.ts'
import { encodeCanonical } from './canonical/encode.ts'
import {
  checkpointChain,
  checkpointOf,
  checkpointsInto,
  isComplete,
  readCheckpoint,
  recoverCheckpoint,
  remainingWork,
  writeCheckpoint,
} from './checkpoint.ts'

/** CHURN-03 — the coordinator is the least important participant. */

const T0 = 1_800_000_000_000
const MODULE = 'bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku'

const state = (overrides: Partial<Parameters<typeof checkpointOf>[0]> = {}) =>
  checkpointOf({
    jobId: 'job-1',
    moduleCid: MODULE,
    partitionCount: 4,
    completed: [{ partitionIndex: 0, resultCid: 'bafyA' }],
    at: T0,
    ...overrides,
  })

describe('CHURN-03 — coordinator state is a content-addressed block', () => {
  it('round-trips through the blockstore unchanged', async () => {
    const store = new MemoryBlockstore()
    const checkpoint = state()
    const cid = await writeCheckpoint(checkpoint, store)

    const read = await readCheckpoint(cid, store)
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.checkpoint).toEqual(checkpoint)
  })

  it('gives the same CID for the same knowledge, whatever order it arrived in', async () => {
    // Idempotent to write and comparable without a diff — the same reason the reduce
    // tree sorts its leaves.
    const store = new MemoryBlockstore()
    const forwards = state({
      completed: [
        { partitionIndex: 0, resultCid: 'bafyA' },
        { partitionIndex: 2, resultCid: 'bafyC' },
      ],
    })
    const backwards = state({
      completed: [
        { partitionIndex: 2, resultCid: 'bafyC' },
        { partitionIndex: 0, resultCid: 'bafyA' },
      ],
    })

    expect((await writeCheckpoint(forwards, store)).toString()).toBe(
      (await writeCheckpoint(backwards, store)).toString(),
    )
  })

  it('dedupes a partition reported twice, keeping the later answer', async () => {
    const checkpoint = state({
      completed: [
        { partitionIndex: 1, resultCid: 'bafyOld' },
        { partitionIndex: 1, resultCid: 'bafyNew' },
      ],
    })
    expect(checkpoint.completed).toEqual([{ partitionIndex: 1, resultCid: 'bafyNew' }])
  })

  it('knows what is left to run — the entire meaning of resume', () => {
    const checkpoint = state({
      completed: [
        { partitionIndex: 0, resultCid: 'bafyA' },
        { partitionIndex: 3, resultCid: 'bafyD' },
      ],
    })
    expect(remainingWork(checkpoint)).toEqual([1, 2])
    expect(isComplete(checkpoint)).toBe(false)

    const done = state({
      completed: [0, 1, 2, 3].map((i) => ({ partitionIndex: i, resultCid: `bafy${i}` })),
    })
    expect(remainingWork(done)).toEqual([])
    expect(isComplete(done)).toBe(true)
  })

  it('treats an in-flight task as outstanding, because its lease expired', () => {
    // There is no third state. The tab closed, the lease lapsed, the task is
    // available — "starting" and "resuming" are the same code path.
    const checkpoint = state({ completed: [] })
    expect(remainingWork(checkpoint)).toEqual([0, 1, 2, 3])
  })
})

describe('a checkpoint came out of a blockstore, so every field is validated', () => {
  it('reports a missing block rather than throwing', async () => {
    const store = new MemoryBlockstore()
    const cid = await writeCheckpoint(state(), new MemoryBlockstore())
    const read = await readCheckpoint(cid, store)
    expect(read.ok).toBe(false)
    if (read.ok) return
    expect(read.failure.kind).toBe('block-missing')
  })

  it('refuses a block that is not a checkpoint', async () => {
    const store = new MemoryBlockstore()
    const encoded = encodeCanonical({ something: 'else' })
    if (!encoded.ok) throw new Error('fixture')
    const cid = await store.put(encoded.bytes)

    const read = await readCheckpoint(cid, store)
    expect(read.ok).toBe(false)
    if (read.ok) return
    expect(read.failure.kind).toBe('malformed')
  })

  it('refuses a completed partition outside the job', async () => {
    // Planted violation: a corrupted checkpoint marks partition 9 of a 4-shard job
    // done. Accepting it would mark work finished that the job never contained.
    const store = new MemoryBlockstore()
    const encoded = encodeCanonical({
      jobId: 'job-1',
      moduleCid: MODULE,
      partitionCount: 4,
      completed: [{ partitionIndex: 9, resultCid: 'bafyX' }],
      at: T0,
      previous: null,
    })
    if (!encoded.ok) throw new Error('fixture')
    const cid = await store.put(encoded.bytes)

    const read = await readCheckpoint(cid, store)
    expect(read.ok).toBe(false)
    if (read.ok) return
    expect(read.failure.kind).toBe('malformed')
    expect(read.failure).toMatchObject({ field: 'completed' })
  })

  it('refuses a checkpoint with a non-numeric partition count', async () => {
    const store = new MemoryBlockstore()
    const encoded = encodeCanonical({
      jobId: 'job-1',
      moduleCid: MODULE,
      partitionCount: 'four',
      completed: [],
      at: T0,
      previous: null,
    })
    if (!encoded.ok) throw new Error('fixture')
    const cid = await store.put(encoded.bytes)

    const read = await readCheckpoint(cid, store)
    expect(read.ok).toBe(false)
    if (read.ok) return
    expect(read.failure).toMatchObject({ field: 'partitionCount' })
  })
})

describe('recovery works from the handles a caller kept', () => {
  it('takes the newest readable checkpoint and says how far back it went', async () => {
    const store = new MemoryBlockstore()
    const lost = new MemoryBlockstore()

    const older = await writeCheckpoint(state({ at: T0 }), store)
    // Written to a store nobody can read — the newest handle is a dead end.
    const newer = await writeCheckpoint(state({ at: T0 + 1_000, previous: older.toString() }), lost)

    const recovered = await recoverCheckpoint([newer, older], store)
    expect(recovered?.skipped).toBe(1)
    expect(recovered?.checkpoint.at).toBe(T0)
    // An older *complete* state, not a patched-together one.
    expect(recovered?.checkpoint.completed).toEqual([{ partitionIndex: 0, resultCid: 'bafyA' }])
  })

  it('returns the newest when it is readable, with nothing skipped', async () => {
    const store = new MemoryBlockstore()
    const older = await writeCheckpoint(state({ at: T0 }), store)
    const newer = await writeCheckpoint(state({ at: T0 + 1_000, previous: older.toString() }), store)

    const recovered = await recoverCheckpoint([newer, older], store)
    expect(recovered?.skipped).toBe(0)
    expect(recovered?.checkpoint.at).toBe(T0 + 1_000)
  })

  it('returns null when no handle is readable, rather than inventing a state', async () => {
    const store = new MemoryBlockstore()
    const orphan = await writeCheckpoint(state(), new MemoryBlockstore())
    expect(await recoverCheckpoint([orphan], store)).toBeNull()
    expect(await recoverCheckpoint([], store)).toBeNull()
  })
})

describe('the chain is the audit view, and stops rather than fails', () => {
  const resolve = (value: string): CID | null => {
    try {
      return CID.parse(value)
    } catch {
      return null
    }
  }

  it('walks back through intact history', async () => {
    const store = new MemoryBlockstore()
    const first = await writeCheckpoint(state({ at: T0, completed: [] }), store)
    const second = await writeCheckpoint(state({ at: T0 + 1, previous: first.toString() }), store)
    const third = await writeCheckpoint(
      state({
        at: T0 + 2,
        previous: second.toString(),
        completed: [
          { partitionIndex: 0, resultCid: 'bafyA' },
          { partitionIndex: 1, resultCid: 'bafyB' },
        ],
      }),
      store,
    )

    const chain = await checkpointChain(third, store, resolve)
    expect(chain.map((c) => c.at)).toEqual([T0 + 2, T0 + 1, T0])
  })

  it('stops at the first missing link — an incomplete history is normal', async () => {
    const store = new MemoryBlockstore()
    const missing = await writeCheckpoint(state({ at: T0 }), new MemoryBlockstore())
    const present = await writeCheckpoint(
      state({ at: T0 + 1, previous: missing.toString() }),
      store,
    )

    const chain = await checkpointChain(present, store, resolve)
    expect(chain.map((c) => c.at)).toEqual([T0 + 1])
  })

  it('terminates on a chain that points at itself', async () => {
    // A corrupted chain must end an audit, not hang it.
    const store = new MemoryBlockstore()
    const encoded = encodeCanonical({
      jobId: 'job-1',
      moduleCid: MODULE,
      partitionCount: 1,
      completed: [],
      at: T0,
      previous: 'self',
    })
    if (!encoded.ok) throw new Error('fixture')
    const cid = await store.put(encoded.bytes)

    const selfResolve = (value: string): CID | null => (value === 'self' ? cid : null)
    const chain = await checkpointChain(cid, store, selfResolve)
    expect(chain).toHaveLength(1)
  })
})

/**
 * CHURN-03's **write half** — the sink `browser/demo/main.ts`'s `runColouring` supplies.
 *
 * Until 2026-08-16 every production submitter passed `'checkpoints-nothing'`, so the
 * recovery half above was proven against sinks that exist only in tests. These cases are
 * about the destination a shipped entry point can actually name.
 *
 * **What a sink over a blockstore is for.** `checkpointLogOf` has already written the
 * block by the time `publish` is called, so the sink is not what makes the bytes durable —
 * it is what establishes that they *are*, by reading the handle back out of the same
 * store. That read is the whole claim: a handle whose block does not resolve is a resume
 * nobody can perform, and counting it would be publishing a promise the store cannot keep.
 */
describe('CHURN-03 write half — a sink that confirms its handles against the store', () => {
  it('confirms a handle whose block reads back, and reports it as the newest', async () => {
    const store = new MemoryBlockstore()
    const sink = checkpointsInto(store)
    const checkpoint = state()
    const handle = await writeCheckpoint(checkpoint, store)

    await sink.publish(handle, checkpoint)

    expect(sink.confirmed.map((cid) => cid.toString())).toEqual([handle.toString()])
    expect(sink.unconfirmed).toEqual([])
    expect(sink.newest()?.toString()).toBe(handle.toString())
  })

  it('does not confirm a handle whose block is absent, and does not throw over it', async () => {
    // Browsers evict IndexedDB silently under storage pressure, so a missing block is a
    // normal condition here — `idb-blockstore.ts` says so in those words. `publish` is
    // awaited inside `checkpointLogOf`'s serialised chain, so a throw would reject that
    // chain and every later `record` on it: one eviction would end the visitor's job. The
    // sink therefore reports and continues.
    const store = new MemoryBlockstore()
    const sink = checkpointsInto(store)
    const checkpoint = state()
    const evicted = await writeCheckpoint(checkpoint, new MemoryBlockstore())

    await expect(sink.publish(evicted, checkpoint)).resolves.toBeUndefined()

    expect(sink.confirmed).toEqual([])
    expect(sink.unconfirmed).toHaveLength(1)
    expect(sink.unconfirmed[0]?.handle.toString()).toBe(evicted.toString())
    expect(sink.unconfirmed[0]?.reason).toContain(evicted.toString())
    expect(sink.newest()).toBe(null)
  })

  it('reports the newest CONFIRMED handle, not the newest published one', async () => {
    // The distinction is why two lists are kept. A resume handed the newest *published*
    // handle after an eviction would name a block that is gone, and `recoverCheckpoint`
    // would have to skip it — from a handle the page had already shown as the place to
    // resume from.
    const store = new MemoryBlockstore()
    const sink = checkpointsInto(store)
    const first = state({ completed: [{ partitionIndex: 0, resultCid: 'bafyA' }] })
    const kept = await writeCheckpoint(first, store)
    const second = state({
      completed: [
        { partitionIndex: 0, resultCid: 'bafyA' },
        { partitionIndex: 1, resultCid: 'bafyB' },
      ],
    })
    const lost = await writeCheckpoint(second, new MemoryBlockstore())

    await sink.publish(kept, first)
    await sink.publish(lost, second)

    expect(sink.newest()?.toString()).toBe(kept.toString())
    expect(sink.confirmed).toHaveLength(1)
    expect(sink.unconfirmed).toHaveLength(1)
  })

  it('keeps confirmed handles oldest first, so the list is the chain in order', async () => {
    const store = new MemoryBlockstore()
    const sink = checkpointsInto(store)
    const first = state()
    const older = await writeCheckpoint(first, store)
    const second = state({ at: T0 + 1, previous: older.toString() })
    const newer = await writeCheckpoint(second, store)

    await sink.publish(older, first)
    await sink.publish(newer, second)

    expect(sink.confirmed.map((cid) => cid.toString())).toEqual([
      older.toString(),
      newer.toString(),
    ])
    expect(sink.newest()?.toString()).toBe(newer.toString())
  })

  it('refuses a handle whose block is unreadable, not merely one that is missing', async () => {
    // `readCheckpoint` validates every field because the bytes came out of a blockstore.
    // A sink that only asked `has()` would confirm a handle over a block that cannot be
    // decoded back into a checkpoint — the same unusable resume, one layer down.
    const store = new MemoryBlockstore()
    const sink = checkpointsInto(store)
    const encoded = encodeCanonical({ jobId: 'job-1', partitionCount: 'four' })
    if (!encoded.ok) throw new Error('fixture')
    const handle = await store.put(encoded.bytes)

    await sink.publish(handle, state())

    expect(sink.confirmed).toEqual([])
    expect(sink.unconfirmed).toHaveLength(1)
    expect(sink.newest()).toBe(null)
  })
})
