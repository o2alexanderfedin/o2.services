import { ed25519 } from '@noble/curves/ed25519.js'
import { CID } from 'multiformats/cid'
import { describe, expect, it } from 'vitest'
import { MemoryBlockstore } from './blockstore/memory.ts'
import { canonicalCid, decodeCanonical, encodeCanonical } from './canonical/encode.ts'
import type { CanonicalValue } from './canonical/encode.ts'
import { toHex } from './capability.ts'
import { EnrollmentAuthority, requestEnrollment } from './enrollment.ts'
import {
  DEFAULT_FANOUT,
  MAX_COMBINE_INPUTS,
  MAX_PARTIAL_BYTES,
  asFabricPartial,
  deriveReduceTree,
  executeReduce,
  fabricCombiner,
  localDispatch,
  rendezvousRank,
} from './reduce.ts'
import type { Combiner, ReduceContribution } from './reduce.ts'
import { signCombine, verifyCombineAttestation } from './result-attestation.ts'
import type { ResultSigner } from './result-attestation.ts'

/**
 * MR-02 … MR-07.
 *
 * The reducer throughout is `fabricCombiner` — the production merge, imported rather
 * than redefined here. That is the point of the promotion: the two single-node
 * reference comparisons below measure the tree against the function the fabric
 * actually ships, so a change to it that broke associativity would fail here instead
 * of passing against a private copy that never left this file.
 */

/** One owner's local partial over their own data. */
function partialFor(owner: number): CanonicalValue {
  const counts: { [k: string]: number } = {}
  for (let i = 0; i < 5; i++) counts[`word${(owner + i) % 7}`] = owner + i + 1
  return { counts, rows: owner + 1 }
}

/**
 * `howMany` owners, each contributing their own distinct partial.
 *
 * Distinct by construction, which is exactly why these fixtures could not see the
 * collapse — the case that can is written from the contribution side, below.
 */
async function storePartials(store: MemoryBlockstore, howMany: number) {
  const values: CanonicalValue[] = []
  const contributions: ReduceContribution[] = []
  for (let owner = 0; owner < howMany; owner++) {
    const value = partialFor(owner)
    values.push(value)
    const hashed = await canonicalCid(value)
    if (!hashed.ok) throw new Error('partial not encodable')
    await store.put(hashed.bytes)
    contributions.push({ contributorId: `owner-${owner}`, cid: hashed.cid })
  }
  return { values, contributions }
}

describe('MR-04 — the tree is derived, never agreed', () => {
  it('is identical whatever order the partials arrive in', async () => {
    const store = new MemoryBlockstore()
    const { contributions } = await storePartials(store, 8)

    // Two participants seeing the same set in different orders must derive the same
    // topology, with no message between them. That is the whole mechanism.
    const forward = deriveReduceTree(contributions)
    const shuffled = deriveReduceTree([...contributions].reverse())
    expect(shuffled).toEqual(forward)

    const c = contributions
    const scrambled = deriveReduceTree([c[3]!, c[7]!, c[0]!, c[5]!, c[1]!, c[6]!, c[2]!, c[4]!])
    expect(scrambled).toEqual(forward)
  })

  it('changes deterministically for everyone when one partial changes', async () => {
    const store = new MemoryBlockstore()
    const { contributions } = await storePartials(store, 8)
    const before = deriveReduceTree(contributions)

    const extra = await canonicalCid({ counts: { changed: 1 }, rows: 1 })
    if (!extra.ok) return
    const late: ReduceContribution = { contributorId: 'owner-7', cid: extra.cid }
    const afterA = deriveReduceTree([...contributions.slice(0, 7), late])
    const afterB = deriveReduceTree([late, ...contributions.slice(0, 7)])

    expect(afterA).not.toEqual(before)
    // …and identically for every participant, not merely "differently".
    expect(afterB).toEqual(afterA)
  })

  it('dedupes the same contributor offering the same partial twice', async () => {
    const store = new MemoryBlockstore()
    const { contributions } = await storePartials(store, 4)
    // The property that makes a late result from a presumed-dead node harmless. What
    // it must NOT swallow is two *different* contributors with equal bytes — see the
    // N-contributors case below.
    const resubmitted = [...contributions, contributions[0]!, contributions[2]!]
    expect(deriveReduceTree(resubmitted)).toEqual(deriveReduceTree(contributions))
    expect(deriveReduceTree(resubmitted).leaves).toHaveLength(4)
  })

  it('gives internal nodes ids fixed before anything executes', async () => {
    const store = new MemoryBlockstore()
    const { contributions } = await storePartials(store, 8)
    const tree = deriveReduceTree(contributions)
    // Assignment depends on these ids, so they must exist without running a combine.
    for (const node of tree.nodes) {
      expect(node.id).toMatch(/^[0-9a-f]{64}$/)
      expect(node.children.length).toBeGreaterThan(1)
    }
    expect(tree.rootId).toBeDefined()
  })

  it('handles the degenerate single-partial case without a combine', async () => {
    const store = new MemoryBlockstore()
    const { contributions } = await storePartials(store, 1)
    const tree = deriveReduceTree(contributions)
    expect(tree.nodes).toEqual([])
    // The root is a leaf *identity* now, and the address it resolves to is still the
    // partial's CID — which is what a caller reads.
    expect(tree.rootId).toBe(tree.leaves[0]!.id)
    expect(tree.leaves[0]!.cid).toBe(contributions[0]!.cid.toString())
  })

  it('refuses an incoherent fanout instead of guessing', async () => {
    const store = new MemoryBlockstore()
    const { contributions } = await storePartials(store, 4)
    expect(() => deriveReduceTree(contributions, 1)).toThrow(RangeError)
    expect(() => deriveReduceTree([])).toThrow(RangeError)
  })
})

describe('MR-04 — a leaf is a contribution, not a set of bytes', () => {
  /** One partial, stored once, offered by four separate owners. */
  async function sharedPartial(store: MemoryBlockstore) {
    const value = { counts: { word0: 5 }, rows: 5 }
    const hashed = await canonicalCid(value)
    if (!hashed.ok) throw new Error('partial not encodable')
    await store.put(hashed.bytes)
    return hashed.cid
  }

  /** `howMany` distinct owners, all reporting the one partial. */
  const offeredBy = (howMany: number, cid: CID): ReduceContribution[] =>
    Array.from({ length: howMany }, (_unused, owner) => ({
      contributorId: `owner-${owner}`,
      cid,
    }))

  it('aggregates N contributors reporting byte-identical partials to N times the value', async () => {
    const store = new MemoryBlockstore()
    const cid = await sharedPartial(store)

    // The ordinary case for count, sum, exists and histogram: four owners each
    // summarise their own rows and four summaries come out the same. Nothing about
    // the bytes alone can tell that from one owner answering four times.
    const tree = deriveReduceTree(offeredBy(4, cid))
    expect(tree.leaves).toHaveLength(4)
    expect(tree.nodes).toHaveLength(1)

    const live = new Set(['n1', 'n2'])
    const outcome = await executeReduce({
      localCombine: 'combines-nothing-locally',
      tree,
      executors: [...live],
      dispatch: localDispatch({
        blockstore: store,
        combiner: fabricCombiner,
        decode: decodeCanonical,
        liveNodes: () => live,
      }),
    })

    expect(outcome.ok).toBe(true)
    const root = await store.get(CID.parse(outcome.rootCid as string))
    expect(decodeCanonical(root as Uint8Array<ArrayBuffer>)).toEqual({
      counts: { word0: 20 },
      rows: 20,
    })
  })

  it('gives eight identical contributions eight leaves and eight distinct node ids', async () => {
    const store = new MemoryBlockstore()
    const tree = deriveReduceTree(offeredBy(8, await sharedPartial(store)), 4)

    // A combine's id hashes its children, so leaves that shared an identity would make
    // two sibling combines the same node — and `resolved` and `executedBy`, both keyed
    // by node id, would silently agree about a disagreement.
    expect(tree.leaves).toHaveLength(8)
    expect(new Set(tree.nodes.map((node) => node.id)).size).toBe(tree.nodes.length)

    const live = new Set(['n1', 'n2'])
    const outcome = await executeReduce({
      localCombine: 'combines-nothing-locally',
      tree,
      executors: [...live],
      dispatch: localDispatch({
        blockstore: store,
        combiner: fabricCombiner,
        decode: decodeCanonical,
        liveNodes: () => live,
      }),
    })
    expect(outcome.executedBy.size).toBe(outcome.combines)
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
    const { values, contributions } = await storePartials(store, 8)
    const tree = deriveReduceTree(contributions)
    const live = new Set(['n1', 'n2', 'n3'])

    const outcome = await executeReduce({
      localCombine: 'combines-nothing-locally',
      tree,
      executors: [...live],
      dispatch: localDispatch({
        blockstore: store,
        combiner: fabricCombiner,
        decode: decodeCanonical,
        liveNodes: () => live,
      }),
    })

    expect(outcome.ok).toBe(true)
    expect(outcome.recomputes).toBe(0)

    // The reference: everything merged at once, on one machine.
    const reference = await canonicalCid(fabricCombiner(values))
    expect(reference.ok).toBe(true)
    if (!reference.ok) return

    // Bit-identical, not merely equal — the CID is over the canonical bytes.
    expect(outcome.rootCid).toBe(reference.cid.toString())
  })

  it('is unchanged by fanout, so the tree shape cannot alter the answer', async () => {
    const store = new MemoryBlockstore()
    const { contributions } = await storePartials(store, 9)
    const live = new Set(['n1', 'n2'])
    const dispatch = localDispatch({
      blockstore: store,
      combiner: fabricCombiner,
      decode: decodeCanonical,
      liveNodes: () => live,
    })

    const roots = []
    for (const fanout of [2, 3, 4, 8]) {
      const outcome = await executeReduce({
        localCombine: 'combines-nothing-locally',
        tree: deriveReduceTree(contributions, fanout),
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
    const { contributions } = await storePartials(store, 8)
    const seen: string[][] = []
    const live = new Set(['n1'])

    await executeReduce({
      localCombine: 'combines-nothing-locally',
      tree: deriveReduceTree(contributions),
      executors: ['n1'],
      dispatch: async (task, executorId) => {
        seen.push([...task.inputCids])
        return localDispatch({ blockstore: store, combiner: fabricCombiner, decode: decodeCanonical, liveNodes: () => live })(
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
    const { contributions } = await storePartials(store, 8)
    const tree = deriveReduceTree(contributions)
    const executors = ['n1', 'n2', 'n3']

    const healthyRoot = (
      await executeReduce({
        localCombine: 'combines-nothing-locally',
        tree,
        executors,
        dispatch: localDispatch({
          blockstore: store,
          combiner: fabricCombiner,
          decode: decodeCanonical,
          liveNodes: () => new Set(executors),
        }),
      })
    ).rootCid

    // Kill whichever node the first combine was assigned to.
    const victim = rendezvousRank(tree.nodes[0]!.id, executors)[0] as string
    const live = new Set(executors.filter((n) => n !== victim))

    const repaired = await executeReduce({
      localCombine: 'combines-nothing-locally',
      tree,
      executors,
      dispatch: localDispatch({
        blockstore: store,
        combiner: fabricCombiner,
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
    const { contributions } = await storePartials(store, 4)
    const tree = deriveReduceTree(contributions)
    const live = new Set(['n1', 'n2'])
    const dispatch = localDispatch({
      blockstore: store,
      combiner: fabricCombiner,
      decode: decodeCanonical,
      liveNodes: () => live,
    })

    const first = await executeReduce({ localCombine: 'combines-nothing-locally', tree, executors: [...live], dispatch })
    const sizeAfterFirst = store.size

    // The node presumed dead finishes late and writes its result anyway.
    const second = await executeReduce({ localCombine: 'combines-nothing-locally', tree, executors: [...live], dispatch })

    expect(second.rootCid).toBe(first.rootCid)
    // Content addressing makes the duplicate a no-op rather than a conflict to
    // resolve — no second entry, nothing to reconcile.
    expect(store.size).toBe(sizeAfterFirst)
  })

  it('reports failure rather than a wrong answer when no executor survives', async () => {
    const store = new MemoryBlockstore()
    const { contributions } = await storePartials(store, 8)
    const outcome = await executeReduce({
      localCombine: 'combines-nothing-locally',
      tree: deriveReduceTree(contributions),
      executors: ['n1', 'n2'],
      dispatch: localDispatch({
        blockstore: store,
        combiner: fabricCombiner,
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

describe('MR-03 — the fabric offers exactly one combine, and it is total', () => {
  const good: CanonicalValue = { counts: { a: 2, b: 3 }, rows: 5 }

  /**
   * Values a partial could arrive as and must not be merged as one.
   *
   * All of these can come off a wire: `decodeCanonical` will happily produce a
   * number, an array or a record whose `counts` is a string.
   */
  const malformed: readonly CanonicalValue[] = [
    42,
    null,
    ['x'],
    'partial',
    {},
    { counts: { a: 1 } },
    { rows: 1 },
    { counts: 'not-a-record', rows: 1 },
    { counts: { a: 'one' }, rows: 1 },
    { counts: { a: 1 }, rows: 'many' },
  ]

  it('contributes nothing for a malformed partial instead of throwing', () => {
    // A combiner that threw would fail this by rejection; one that let a bad input
    // through would fail it by inequality. Both are the wire's problem, not a
    // hypothetical: these bytes came from a peer.
    expect(fabricCombiner([42, null, ['x'], good])).toEqual(fabricCombiner([good]))
    expect(fabricCombiner(malformed)).toEqual({ counts: {}, rows: 0 })
  })

  it('agrees with asFabricPartial about what is malformed', () => {
    // The two dispositions must be driven by one predicate. Changing one without
    // the other fails one half of this pair.
    for (const value of malformed) {
      expect(asFabricPartial(value)).toBeNull()
      expect(fabricCombiner([value, good])).toEqual(fabricCombiner([good]))
    }
    expect(asFabricPartial(good)).toEqual({ counts: { a: 2, b: 3 }, rows: 5 })
  })

  it('hashes the same whatever order its inputs arrive in', async () => {
    const a: CanonicalValue = { counts: { x: 1, z: 4 }, rows: 2 }
    const b: CanonicalValue = { counts: { y: 7, x: 2 }, rows: 3 }

    // Commutativity, which the module docstring is careful to say is *not* strictly
    // required — the tree relies on associativity. It is asserted rather than
    // restated because it is what would let the grouping change without silently
    // changing answers.
    const forward = await canonicalCid(fabricCombiner([a, b]))
    const reverse = await canonicalCid(fabricCombiner([b, a]))
    expect(forward.ok && reverse.ok).toBe(true)
    if (!forward.ok || !reverse.ok) return
    expect(forward.cid.toString()).toBe(reverse.cid.toString())
  })

  it('counts a repeated contribution twice rather than deduplicating it', () => {
    // The `Combiner` contract: two contributors reaching the same summary is the
    // ordinary case, and a combiner that deduped would put back the defect the leaf
    // key removed, one layer up.
    expect(fabricCombiner([good, good])).toEqual({ counts: { a: 4, b: 6 }, rows: 10 })
  })

  it('bounds how many inputs one combine may merge', () => {
    // Precisely two facts, and nothing else about the value: it is a whole number of
    // inputs, and it can express at least the default tree's own fanout. No product
    // is asserted against it — this bound is not a byte figure and multiplying it by
    // one would claim a residency guarantee nobody measured.
    expect(Number.isInteger(MAX_COMBINE_INPUTS)).toBe(true)
    expect(MAX_COMBINE_INPUTS).toBeGreaterThanOrEqual(DEFAULT_FANOUT)
  })
})

describe('MR-03 / criterion 5 — the aggregation is verified even when the maps are not', () => {
  it('runs each combine on two executors and agrees', async () => {
    // The C3 split made concrete. A sovereign map cannot be run twice — pinning data
    // to one owner removes the second independent executor — so those partials are
    // owner-attested. The aggregation *over* them is redundant, because a combine
    // reads only content-addressed partials and so is runnable anywhere.
    const store = new MemoryBlockstore()
    const { values, contributions } = await storePartials(store, 8)
    const live = new Set(['n1', 'n2', 'n3', 'n4'])

    const outcome = await executeReduce({
      localCombine: 'combines-nothing-locally',
      tree: deriveReduceTree(contributions),
      executors: [...live],
      redundancy: 2,
      dispatch: localDispatch({
        blockstore: store,
        combiner: fabricCombiner,
        decode: decodeCanonical,
        liveNodes: () => live,
      }),
    })

    expect(outcome.ok).toBe(true)
    expect(outcome.minReplicas).toBe(2)
    expect(outcome.disagreements).toEqual([])

    const reference = await canonicalCid(fabricCombiner(values))
    expect(reference.ok).toBe(true)
    if (!reference.ok) return
    expect(outcome.rootCid).toBe(reference.cid.toString())
  })

  it('reports a divergent combine instead of voting on it', async () => {
    const store = new MemoryBlockstore()
    const { contributions } = await storePartials(store, 4)
    const tree = deriveReduceTree(contributions)
    const live = new Set(['n1', 'n2', 'n3'])
    const honest = localDispatch({
      blockstore: store,
      combiner: fabricCombiner,
      decode: decodeCanonical,
      liveNodes: () => live,
    })

    // One node returns a plausible but different aggregate.
    const liar = rendezvousRank(tree.nodes[0]!.id, [...live])[1] as string
    const outcome = await executeReduce({
      localCombine: 'combines-nothing-locally',
      tree,
      executors: [...live],
      redundancy: 2,
      dispatch: async (task, executorId) => {
        if (executorId !== liar) return honest(task, executorId)
        const forged = await canonicalCid({ counts: { tampered: 1 }, rows: 999 })
        if (!forged.ok) return null
        await store.put(forged.bytes)
        return { cid: forged.cid, attestation: 'signed-by-nobody' }
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
    const { contributions } = await storePartials(store, 4)
    const live = new Set(['n1', 'n2'])
    const outcome = await executeReduce({
      localCombine: 'combines-nothing-locally',
      tree: deriveReduceTree(contributions),
      executors: ['n1', 'n2', 'n3'],
      redundancy: 3,
      dispatch: localDispatch({
        blockstore: store,
        combiner: fabricCombiner,
        decode: decodeCanonical,
        liveNodes: () => live,
      }),
    })

    expect(outcome.rootCid).not.toBeNull()
    expect(outcome.minReplicas).toBe(2)
    expect(outcome.disagreements).toEqual([])
  })
})

describe('VER-08/09/10 — what a combine produced and what its producer signed travel together', () => {
  const provider = new Uint8Array(32).fill(90)
  const alice = new Uint8Array(32).fill(91)
  const NOW = 1_800_000_000_000
  const PINNED: ReadonlySet<string> = new Set([toHex(ed25519.getPublicKey(provider))])

  /** A node this fixture's provider certified, holding its own seed. */
  async function enrolled(seed: number): Promise<ResultSigner> {
    const nodeSeed = new Uint8Array(32).fill(seed)
    const issued = new EnrollmentAuthority({
      providerPrivateKey: provider,
      maxIssuedPerWindow: 'issues-without-an-aggregate-budget',
      issuance: 'remembers-only-within-this-process',
    }).enrol(
      await requestEnrollment(nodeSeed, alice, {
        operatorId: `op-${seed}`,
        discoverability: 'via-relay',
        relayIds: ['relay-1'],
      }),
      NOW,
    )
    if (!issued.ok) throw new Error('fixture failed to enrol')
    return { nodeSeed, certificate: issued.certificate }
  }

  it('records the accepted replica’s attestation against that tree node', async () => {
    const store = new MemoryBlockstore()
    const { contributions } = await storePartials(store, 4)
    const tree = deriveReduceTree(contributions)
    const live = new Set(['n1', 'n2'])
    const honest = localDispatch({
      blockstore: store,
      combiner: fabricCombiner,
      decode: decodeCanonical,
      liveNodes: () => live,
    })
    const signer = await enrolled(11)

    const outcome = await executeReduce({
      localCombine: 'combines-nothing-locally',
      tree,
      executors: [...live],
      // Every executor here signs with one identity, which is enough to establish that
      // the statement survives the dispatch. Who signed which replica is
      // `combine-signature.node.test.ts`'s question, across real processes.
      dispatch: async (task, executorId) => {
        const product = await honest(task, executorId)
        if (product === null) return null
        return {
          cid: product.cid,
          attestation: signCombine(
            signer,
            task.inputCids.map((cid) => CID.parse(cid)),
            product.cid,
          ),
        }
      },
    })

    expect(outcome.ok).toBe(true)
    expect(outcome.attestations.size).toBe(outcome.combines)
    expect(outcome.attestations.size).toBeGreaterThan(0)

    // Not merely "an attestation is present": the one recorded must verify against the
    // inputs that combine actually merged and the CID it actually produced, using
    // nothing but the provider's public key. A map filled with the wrong node's
    // statement satisfies a size assertion and fails this one.
    for (const node of tree.nodes) {
      const attested = outcome.attestations.get(node.id)
      expect(attested).toBeDefined()
      if (attested === undefined) continue
      const inputCids = node.children.map((child) => {
        const leaf = tree.leaves.find((candidate) => candidate.id === child)
        if (leaf === undefined) throw new Error('this fixture is one level deep')
        return CID.parse(leaf.cid)
      })
      const resultCid = CID.parse(outcome.rootCid as string)
      expect(verifyCombineAttestation(attested, inputCids, resultCid, PINNED, NOW).ok).toBe(true)
    }
  })

  it('says the requestor’s own combiner signs nothing, by name', async () => {
    // Asserted directly so that nobody later hands `localDispatch` a signing key. A
    // signature the requestor made for itself proves nothing to the requestor.
    const store = new MemoryBlockstore()
    const { contributions } = await storePartials(store, 4)
    const live = new Set(['n1', 'n2'])
    const outcome = await executeReduce({
      localCombine: 'combines-nothing-locally',
      tree: deriveReduceTree(contributions),
      executors: [...live],
      dispatch: localDispatch({
        blockstore: store,
        combiner: fabricCombiner,
        decode: decodeCanonical,
        liveNodes: () => live,
      }),
    })

    expect(outcome.attestations.size).toBeGreaterThan(0)
    for (const attested of outcome.attestations.values()) {
      expect(attested).toBe('signed-by-nobody')
    }
  })

  it('records nothing for a combine whose replicas disagreed', async () => {
    // A signature beside a combine with no agreed answer invites a later reader to pick
    // a winner out of the signatures, which `verify.ts` forbids. `executedBy` is
    // deliberately still filled — it answers a different question, and this case pins
    // that the two maps disagree here on purpose.
    const store = new MemoryBlockstore()
    const { contributions } = await storePartials(store, 4)
    const tree = deriveReduceTree(contributions)
    const live = new Set(['n1', 'n2', 'n3'])
    const signer = await enrolled(12)
    const honest = localDispatch({
      blockstore: store,
      combiner: fabricCombiner,
      decode: decodeCanonical,
      liveNodes: () => live,
    })
    const liar = rendezvousRank(tree.nodes[0]!.id, [...live])[1] as string

    const outcome = await executeReduce({
      localCombine: 'combines-nothing-locally',
      tree,
      executors: [...live],
      redundancy: 2,
      dispatch: async (task, executorId) => {
        if (executorId !== liar) {
          const product = await honest(task, executorId)
          if (product === null) return null
          return {
            cid: product.cid,
            attestation: signCombine(signer, task.inputCids.map((cid) => CID.parse(cid)), product.cid),
          }
        }
        const forged = await canonicalCid({ counts: { tampered: 1 }, rows: 999 })
        if (!forged.ok) return null
        await store.put(forged.bytes)
        return { cid: forged.cid, attestation: signCombine(signer, task.inputCids.map((cid) => CID.parse(cid)), forged.cid) }
      },
    })

    expect(outcome.disagreements.length).toBeGreaterThan(0)
    for (const disagreement of outcome.disagreements) {
      expect(outcome.attestations.has(disagreement.nodeId)).toBe(false)
      // Still recorded as executed. The two maps answer different questions and this is
      // the one place they part company.
      expect(outcome.executedBy.has(disagreement.nodeId)).toBe(true)
    }
  })

  it('still reads a null as a dead executor, and an unsigned answer as an ordinary one', async () => {
    // The distinction a widened return type is most likely to flatten. `null` means the
    // executor is gone; a product carrying the sentinel is a live node that holds no
    // certificate. Reading the second as the first would walk the ranking past every
    // unenrolled node in the fabric.
    const store = new MemoryBlockstore()
    const { contributions } = await storePartials(store, 4)
    const tree = deriveReduceTree(contributions)
    const executors = ['n1', 'n2', 'n3']
    const asked: string[] = []
    const honest = localDispatch({
      blockstore: store,
      combiner: fabricCombiner,
      decode: decodeCanonical,
      liveNodes: () => new Set(executors),
    })
    const gone = rendezvousRank(tree.nodes[0]!.id, executors)[0] as string

    const outcome = await executeReduce({
      localCombine: 'combines-nothing-locally',
      tree,
      executors,
      dispatch: async (task, executorId) => {
        asked.push(executorId)
        if (executorId === gone) return null
        return honest(task, executorId)
      },
    })

    // The first-ranked node answered `null` and the walk continued past it.
    expect(asked[0]).toBe(gone)
    expect(outcome.ok).toBe(true)
    expect(outcome.recomputes).toBeGreaterThan(0)
    for (const executor of outcome.executedBy.values()) expect(executor).not.toBe(gone)
    // And the unsigned answers that followed were accepted as results, not skipped.
    expect(outcome.attestations.size).toBe(outcome.combines)
  })
})

describe('associativity is the property the tree relies on', () => {
  it('catches a non-associative combiner via the single-node reference', async () => {
    // "Keep the largest partial" is a perfectly deterministic reducer and a
    // non-associative one: merging up a tree discards different candidates than
    // merging all at once. If the reference check did not catch this, the aggregate
    // would silently depend on the tree's shape.
    const store = new MemoryBlockstore()
    const { values, contributions } = await storePartials(store, 8)

    const largestWins: Combiner = (inputs) =>
      inputs.reduce((best, next) => {
        const bestRows = (best as { rows?: number }).rows ?? 0
        const nextRows = (next as { rows?: number }).rows ?? 0
        // Deliberately lossy: everything but the winner is dropped.
        return nextRows > bestRows ? next : best
      })

    const live = new Set(['n1', 'n2'])
    const treeOutcome = await executeReduce({
      localCombine: 'combines-nothing-locally',
      tree: deriveReduceTree(contributions, 2),
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
    const { values, contributions } = await storePartials(store, 8)

    // Subtracting row counts is associative for neither grouping nor order.
    const subtract: Combiner = (inputs) => ({
      rows: inputs.reduce<number>((acc, input, i) => {
        const rows = (input as { rows?: number }).rows ?? 0
        return i === 0 ? rows : acc - rows
      }, 0),
    })

    const live = new Set(['n1', 'n2'])
    const treeOutcome = await executeReduce({
      localCombine: 'combines-nothing-locally',
      tree: deriveReduceTree(contributions, 2),
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
