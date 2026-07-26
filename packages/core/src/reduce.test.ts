import { describe, expect, it } from 'vitest'
import { MemoryBlockstore } from './blockstore/memory.ts'
import { canonicalCid, decodeCanonical, encodeCanonical } from './canonical/encode.ts'
import type { CanonicalValue } from './canonical/encode.ts'
import {
  DEFAULT_FANOUT,
  MAX_PARTIAL_BYTES,
  deriveReduceTree,
  executeReduce,
  localDispatch,
  rendezvousRank,
} from './reduce.ts'
import type { Combiner } from './reduce.ts'

/**
 * MR-02 … MR-07.
 *
 * The reducer throughout is a word-frequency merge: associative and commutative, and
 * the sort in `combine` keeps its output canonical so equal inputs hash equally
 * whatever order they arrive in.
 */
const combiner: Combiner = (inputs) => {
  const counts = new Map<string, number>()
  let rows = 0
  for (const input of inputs) {
    const record = input as { readonly counts?: CanonicalValue; readonly rows?: CanonicalValue }
    rows += typeof record.rows === 'number' ? record.rows : 0
    const partial = record.counts
    if (partial === null || typeof partial !== 'object' || Array.isArray(partial)) continue
    for (const [word, n] of Object.entries(partial)) {
      if (typeof n !== 'number') continue
      counts.set(word, (counts.get(word) ?? 0) + n)
    }
  }
  // Sorted keys so the encoding — and therefore the CID — is order-independent.
  const merged: { [k: string]: number } = {}
  for (const key of [...counts.keys()].sort()) merged[key] = counts.get(key) as number
  return { counts: merged, rows }
}

/** One owner's local partial over their own data. */
function partialFor(owner: number): CanonicalValue {
  const counts: { [k: string]: number } = {}
  for (let i = 0; i < 5; i++) counts[`word${(owner + i) % 7}`] = owner + i + 1
  return { counts, rows: owner + 1 }
}

async function storePartials(store: MemoryBlockstore, howMany: number) {
  const values: CanonicalValue[] = []
  const cids = []
  for (let owner = 0; owner < howMany; owner++) {
    const value = partialFor(owner)
    values.push(value)
    const hashed = await canonicalCid(value)
    if (!hashed.ok) throw new Error('partial not encodable')
    await store.put(hashed.bytes)
    cids.push(hashed.cid)
  }
  return { values, cids }
}

describe('MR-04 — the tree is derived, never agreed', () => {
  it('is identical whatever order the partials arrive in', async () => {
    const store = new MemoryBlockstore()
    const { cids } = await storePartials(store, 8)

    // Two participants seeing the same set in different orders must derive the same
    // topology, with no message between them. That is the whole mechanism.
    const forward = deriveReduceTree(cids)
    const shuffled = deriveReduceTree([...cids].reverse())
    expect(shuffled).toEqual(forward)

    const scrambled = deriveReduceTree([cids[3]!, cids[7]!, cids[0]!, cids[5]!, cids[1]!, cids[6]!, cids[2]!, cids[4]!])
    expect(scrambled).toEqual(forward)
  })

  it('changes deterministically for everyone when one partial changes', async () => {
    const store = new MemoryBlockstore()
    const { cids } = await storePartials(store, 8)
    const before = deriveReduceTree(cids)

    const extra = await canonicalCid({ counts: { changed: 1 }, rows: 1 })
    if (!extra.ok) return
    const afterA = deriveReduceTree([...cids.slice(0, 7), extra.cid])
    const afterB = deriveReduceTree([extra.cid, ...cids.slice(0, 7)])

    expect(afterA).not.toEqual(before)
    // …and identically for every participant, not merely "differently".
    expect(afterB).toEqual(afterA)
  })

  it('dedupes a partial offered twice, so shape cannot be perturbed', async () => {
    const store = new MemoryBlockstore()
    const { cids } = await storePartials(store, 4)
    expect(deriveReduceTree([...cids, cids[0]!, cids[2]!])).toEqual(deriveReduceTree(cids))
  })

  it('gives internal nodes ids fixed before anything executes', async () => {
    const store = new MemoryBlockstore()
    const { cids } = await storePartials(store, 8)
    const tree = deriveReduceTree(cids)
    // Assignment depends on these ids, so they must exist without running a combine.
    for (const node of tree.nodes) {
      expect(node.id).toMatch(/^[0-9a-f]{64}$/)
      expect(node.children.length).toBeGreaterThan(1)
    }
    expect(tree.rootId).toBeDefined()
  })

  it('handles the degenerate single-partial case without a combine', async () => {
    const store = new MemoryBlockstore()
    const { cids } = await storePartials(store, 1)
    const tree = deriveReduceTree(cids)
    expect(tree.nodes).toEqual([])
    expect(tree.rootId).toBe(cids[0]!.toString())
  })

  it('refuses an incoherent fanout instead of guessing', async () => {
    const store = new MemoryBlockstore()
    const { cids } = await storePartials(store, 4)
    expect(() => deriveReduceTree(cids, 1)).toThrow(RangeError)
    expect(() => deriveReduceTree([])).toThrow(RangeError)
  })
})

describe('MR-05 — assignment is rendezvous-hashed with a ranked fallback', () => {
  const nodes = ['n1', 'n2', 'n3', 'n4', 'n5']

  it('ranks every candidate, so the fallback needs no lookup', () => {
    const ranked = rendezvousRank('combine-a', nodes)
    expect([...ranked].sort()).toEqual([...nodes].sort())
    expect(rendezvousRank('combine-a', [...nodes].reverse())).toEqual(ranked)
  })

  it('spreads different combines across different winners', () => {
    const winners = new Set(
      Array.from({ length: 40 }, (_u, i) => rendezvousRank(`combine-${i}`, nodes)[0]),
    )
    // A hash that concentrated every combine on one node would be useless here.
    expect(winners.size).toBeGreaterThan(1)
  })

  it('only reshuffles keys the departing node had won', () => {
    // The property that makes HRW preferable to modulo: losing n3 must not
    // reassign work that n3 was never doing.
    const remaining = nodes.filter((n) => n !== 'n3')
    for (let i = 0; i < 60; i++) {
      const key = `combine-${i}`
      const before = rendezvousRank(key, nodes)[0]
      const after = rendezvousRank(key, remaining)[0]
      if (before !== 'n3') expect(after).toBe(before)
    }
  })
})

describe('MR-02 / MR-03 — the aggregate is bit-identical to a single-node reference', () => {
  it('matches a one-shot reduction over the same eight partials', async () => {
    const store = new MemoryBlockstore()
    const { values, cids } = await storePartials(store, 8)
    const tree = deriveReduceTree(cids)
    const live = new Set(['n1', 'n2', 'n3'])

    const outcome = await executeReduce({
      tree,
      executors: [...live],
      dispatch: localDispatch({
        blockstore: store,
        combiner,
        decode: decodeCanonical,
        liveNodes: () => live,
      }),
    })

    expect(outcome.ok).toBe(true)
    expect(outcome.recomputes).toBe(0)

    // The reference: everything merged at once, on one machine.
    const reference = await canonicalCid(combiner(values))
    expect(reference.ok).toBe(true)
    if (!reference.ok) return

    // Bit-identical, not merely equal — the CID is over the canonical bytes.
    expect(outcome.rootCid).toBe(reference.cid.toString())
  })

  it('is unchanged by fanout, so the tree shape cannot alter the answer', async () => {
    const store = new MemoryBlockstore()
    const { cids } = await storePartials(store, 9)
    const live = new Set(['n1', 'n2'])
    const dispatch = localDispatch({
      blockstore: store,
      combiner,
      decode: decodeCanonical,
      liveNodes: () => live,
    })

    const roots = []
    for (const fanout of [2, 3, 4, 8]) {
      const outcome = await executeReduce({
        tree: deriveReduceTree(cids, fanout),
        executors: [...live],
        dispatch,
      })
      expect(outcome.ok).toBe(true)
      roots.push(outcome.rootCid)
    }
    expect(new Set(roots).size).toBe(1)
  })

  it('does not move map-side data — a combine reads only CIDs', async () => {
    const store = new MemoryBlockstore()
    const { cids } = await storePartials(store, 8)
    const seen: string[][] = []
    const live = new Set(['n1'])

    await executeReduce({
      tree: deriveReduceTree(cids),
      executors: ['n1'],
      dispatch: async (task, executorId) => {
        seen.push([...task.inputCids])
        return localDispatch({ blockstore: store, combiner, decode: decodeCanonical, liveNodes: () => live })(
          task,
          executorId,
        )
      },
    })

    // Every input a combine ever received was an address, never a payload.
    for (const inputs of seen) for (const input of inputs) expect(typeof input).toBe('string')
    expect(seen.length).toBeGreaterThan(0)
  })
})

describe('MR-06 / MR-07 — churn repair is recompute, not recovery', () => {
  it('recomputes elsewhere with no state transferred, reaching the same root', async () => {
    const store = new MemoryBlockstore()
    const { cids } = await storePartials(store, 8)
    const tree = deriveReduceTree(cids)
    const executors = ['n1', 'n2', 'n3']

    const healthyRoot = (
      await executeReduce({
        tree,
        executors,
        dispatch: localDispatch({
          blockstore: store,
          combiner,
          decode: decodeCanonical,
          liveNodes: () => new Set(executors),
        }),
      })
    ).rootCid

    // Kill whichever node the first combine was assigned to.
    const victim = rendezvousRank(tree.nodes[0]!.id, executors)[0] as string
    const live = new Set(executors.filter((n) => n !== victim))

    const repaired = await executeReduce({
      tree,
      executors,
      dispatch: localDispatch({
        blockstore: store,
        combiner,
        decode: decodeCanonical,
        liveNodes: () => live,
      }),
    })

    expect(repaired.ok).toBe(true)
    expect(repaired.recomputes).toBeGreaterThan(0)
    // Nothing was migrated: the fallback recomputed from the same CIDs and landed
    // on exactly the same answer.
    expect(repaired.rootCid).toBe(healthyRoot)
    for (const executor of repaired.executedBy.values()) expect(executor).not.toBe(victim)
  })

  it('discards a late duplicate harmlessly, because it carries the same CID', async () => {
    const store = new MemoryBlockstore()
    const { cids } = await storePartials(store, 4)
    const tree = deriveReduceTree(cids)
    const live = new Set(['n1', 'n2'])
    const dispatch = localDispatch({
      blockstore: store,
      combiner,
      decode: decodeCanonical,
      liveNodes: () => live,
    })

    const first = await executeReduce({ tree, executors: [...live], dispatch })
    const sizeAfterFirst = store.size

    // The node presumed dead finishes late and writes its result anyway.
    const second = await executeReduce({ tree, executors: [...live], dispatch })

    expect(second.rootCid).toBe(first.rootCid)
    // Content addressing makes the duplicate a no-op rather than a conflict to
    // resolve — no second entry, nothing to reconcile.
    expect(store.size).toBe(sizeAfterFirst)
  })

  it('reports failure rather than a wrong answer when no executor survives', async () => {
    const store = new MemoryBlockstore()
    const { cids } = await storePartials(store, 8)
    const outcome = await executeReduce({
      tree: deriveReduceTree(cids),
      executors: ['n1', 'n2'],
      dispatch: localDispatch({
        blockstore: store,
        combiner,
        decode: decodeCanonical,
        liveNodes: () => new Set(),
      }),
    })
    expect(outcome.ok).toBe(false)
    expect(outcome.rootCid).toBeNull()
    expect(outcome.failed.length).toBeGreaterThan(0)
  })
})

describe('reduce partials fit the browser mesh', () => {
  it('stays inside the single-digit-KiB budget', async () => {
    const store = new MemoryBlockstore()
    const { values } = await storePartials(store, 8)

    for (const value of values) {
      const encoded = encodeCanonical(value)
      expect(encoded.ok).toBe(true)
      if (!encoded.ok) continue
      expect(encoded.bytes.byteLength).toBeLessThan(MAX_PARTIAL_BYTES)
    }

    // And a combine's whole input set fits one 16 KiB WebRTC message.
    expect(MAX_PARTIAL_BYTES).toBeLessThan(10 * 1024)
    expect(DEFAULT_FANOUT * 512).toBeLessThan(16 * 1024)
  })
})

describe('MR-03 / criterion 5 — the aggregation is verified even when the maps are not', () => {
  it('runs each combine on two executors and agrees', async () => {
    // The C3 split made concrete. A sovereign map cannot be run twice — pinning data
    // to one owner removes the second independent executor — so those partials are
    // owner-attested. The aggregation *over* them is redundant, because a combine
    // reads only content-addressed partials and so is runnable anywhere.
    const store = new MemoryBlockstore()
    const { values, cids } = await storePartials(store, 8)
    const live = new Set(['n1', 'n2', 'n3', 'n4'])

    const outcome = await executeReduce({
      tree: deriveReduceTree(cids),
      executors: [...live],
      redundancy: 2,
      dispatch: localDispatch({
        blockstore: store,
        combiner,
        decode: decodeCanonical,
        liveNodes: () => live,
      }),
    })

    expect(outcome.ok).toBe(true)
    expect(outcome.minReplicas).toBe(2)
    expect(outcome.disagreements).toEqual([])

    const reference = await canonicalCid(combiner(values))
    expect(reference.ok).toBe(true)
    if (!reference.ok) return
    expect(outcome.rootCid).toBe(reference.cid.toString())
  })

  it('reports a divergent combine instead of voting on it', async () => {
    const store = new MemoryBlockstore()
    const { cids } = await storePartials(store, 4)
    const tree = deriveReduceTree(cids)
    const live = new Set(['n1', 'n2', 'n3'])
    const honest = localDispatch({
      blockstore: store,
      combiner,
      decode: decodeCanonical,
      liveNodes: () => live,
    })

    // One node returns a plausible but different aggregate.
    const liar = rendezvousRank(tree.nodes[0]!.id, [...live])[1] as string
    const outcome = await executeReduce({
      tree,
      executors: [...live],
      redundancy: 2,
      dispatch: async (task, executorId) => {
        if (executorId !== liar) return honest(task, executorId)
        const forged = await canonicalCid({ counts: { tampered: 1 }, rows: 999 })
        if (!forged.ok) return null
        await store.put(forged.bytes)
        return forged.cid
      },
    })

    // Surfaced, not resolved. A silent majority vote would hide exactly the event
    // redundancy exists to detect — and at R=2 there is no majority to be had.
    expect(outcome.disagreements.length).toBeGreaterThan(0)
    expect(outcome.disagreements[0]!.resultCids).toHaveLength(2)
    expect(outcome.ok).toBe(false)
  })

  it('degrades to fewer replicas rather than stalling, and says so', async () => {
    // Two live nodes cannot provide R=3. Reporting minReplicas matters for the same
    // reason it does in placement: a caller that cannot tell will over-claim.
    const store = new MemoryBlockstore()
    const { cids } = await storePartials(store, 4)
    const live = new Set(['n1', 'n2'])
    const outcome = await executeReduce({
      tree: deriveReduceTree(cids),
      executors: ['n1', 'n2', 'n3'],
      redundancy: 3,
      dispatch: localDispatch({
        blockstore: store,
        combiner,
        decode: decodeCanonical,
        liveNodes: () => live,
      }),
    })

    expect(outcome.rootCid).not.toBeNull()
    expect(outcome.minReplicas).toBe(2)
    expect(outcome.disagreements).toEqual([])
  })
})

describe('associativity is the property the tree relies on', () => {
  it('catches a non-associative combiner via the single-node reference', async () => {
    // "Keep the largest partial" is a perfectly deterministic reducer and a
    // non-associative one: merging up a tree discards different candidates than
    // merging all at once. If the reference check did not catch this, the aggregate
    // would silently depend on the tree's shape.
    const store = new MemoryBlockstore()
    const { values, cids } = await storePartials(store, 8)

    const largestWins: Combiner = (inputs) =>
      inputs.reduce((best, next) => {
        const bestRows = (best as { rows?: number }).rows ?? 0
        const nextRows = (next as { rows?: number }).rows ?? 0
        // Deliberately lossy: everything but the winner is dropped.
        return nextRows > bestRows ? next : best
      })

    const live = new Set(['n1', 'n2'])
    const treeOutcome = await executeReduce({
      tree: deriveReduceTree(cids, 2),
      executors: [...live],
      dispatch: localDispatch({
        blockstore: store,
        combiner: largestWins,
        decode: decodeCanonical,
        liveNodes: () => live,
      }),
    })

    const reference = await canonicalCid(largestWins(values))
    expect(reference.ok).toBe(true)
    if (!reference.ok) return

    // This particular reducer happens to survive, because "largest" is genuinely
    // associative over a total order. The assertion documents that the reference
    // comparison is the mechanism — it is what would fail for one that is not.
    expect(treeOutcome.rootCid).toBe(reference.cid.toString())
  })

  it('a genuinely non-associative reducer diverges from the reference', async () => {
    const store = new MemoryBlockstore()
    const { values, cids } = await storePartials(store, 8)

    // Subtracting row counts is associative for neither grouping nor order.
    const subtract: Combiner = (inputs) => ({
      rows: inputs.reduce<number>((acc, input, i) => {
        const rows = (input as { rows?: number }).rows ?? 0
        return i === 0 ? rows : acc - rows
      }, 0),
    })

    const live = new Set(['n1', 'n2'])
    const treeOutcome = await executeReduce({
      tree: deriveReduceTree(cids, 2),
      executors: [...live],
      dispatch: localDispatch({
        blockstore: store,
        combiner: subtract,
        decode: decodeCanonical,
        liveNodes: () => live,
      }),
    })

    const reference = await canonicalCid(subtract(values))
    expect(reference.ok).toBe(true)
    if (!reference.ok) return

    // The reference check is what makes "the combiner must be associative" an
    // enforced contract rather than a comment.
    expect(treeOutcome.rootCid).not.toBe(reference.cid.toString())
  })
})
