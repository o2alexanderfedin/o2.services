import {
  LocalCapacity,
  MAX_PARTIAL_BYTES,
  MemoryBlockstore,
  MemoryNetwork,
  canonicalCid,
  deriveReduceTree,
  encodeCanonical,
  executeReduce,
  fabricCombiner,
} from '@o2/core'
import type { Blockstore, CanonicalValue, Executor } from '@o2/core'
import { CID } from 'multiformats/cid'
import { describe, expect, it } from 'vitest'
import { RpcBlockSource, serveAgent } from './agent.ts'
import type { AuthorizedWork, Authorizer } from './agent.ts'
import { FetchingBlockstore } from './block.ts'
import { LocalStoreWriteFailed, remoteCombineDispatch } from './combine.ts'
import { EgressGuard } from './egress.ts'
import type { EgressHold } from './egress.ts'
import { encodeRequest, encodeResponse, parseResponse } from './protocol.ts'
import { RpcEndpoint } from './rpc.ts'

/**
 * MR-03 / MR-05 / MR-06 — the combine handler and the dispatcher that drives it.
 *
 * `combine-wire.test.ts` judges the frame; this file judges what a node *does* with
 * one. The two are kept apart so a failure names its layer.
 *
 * **The fabric here is deliberately hostile in one specific way, and it is the point
 * of the file.** Every serving node's blockstore is a `FetchingBlockstore` whose only
 * source is the `origin`. A serving node therefore starts holding nothing, and
 * whatever it merges it must have *asked for by CID* — which is the property that
 * makes "a combine goes to a node that has never seen a partial" a measurement rather
 * than a claim. It is also the topology of every fabric in this repository:
 * `distributed.test.ts:70` and `bin/bench.ts:168` both point every worker at one
 * origin, so **no worker can see another worker's store**.
 */

/** The seven sentinels every `AgentOptions` must write down, in one place. */
const SENTINELS = {
  egress: 'holds-no-registrations',
  authorize: 'serves-unauthenticated',
  index: 'serves-no-records',
  capacity: 'accepts-every-offer',
  ledger: 'keeps-no-ledger',
  reservations: 'relays-for-nobody',
  onDispatch: 'reports-no-dispatch',
  enroll: 'issues-no-certificates',
} as const

/**
 * An executor that fails the test if it is ever reached.
 *
 * A combine must never fall through to the exec branch — that branch reads
 * `request.task`, which a combine does not have.
 */
function inertExecutor(nodeId: string): Executor {
  return {
    nodeId,
    async execute() {
      throw new Error(`the exec branch ran on ${nodeId} for a request that was not an exec`)
    },
  }
}

/** A well-formed partial, distinct per `key`. */
function partial(key: string, n = 1): CanonicalValue {
  return { counts: { [key]: n }, rows: n }
}

/**
 * A fabric of `workers` serving nodes over one origin.
 *
 * Each worker holds nothing locally and can reach only the origin, so every input a
 * worker merges arrived because it asked for that CID.
 */
async function combineFabric(options: { readonly workers: number }) {
  const network = new MemoryNetwork()
  const originStore = new MemoryBlockstore()

  const originRpc = new RpcEndpoint(network.connect('origin'), { timeoutMs: 5_000 })
  serveAgent({ rpc: originRpc, executor: inertExecutor('origin'), blockstore: originStore, ...SENTINELS })

  const workers: {
    readonly id: string
    readonly rpc: RpcEndpoint
    readonly store: FetchingBlockstore
    readonly local: MemoryBlockstore
  }[] = []
  for (let i = 0; i < options.workers; i++) {
    const id = `w${i}`
    const rpc = new RpcEndpoint(network.connect(id), { timeoutMs: 5_000 })
    const local = new MemoryBlockstore()
    const store = new FetchingBlockstore(local, new RpcBlockSource(rpc, () => ['origin']))
    serveAgent({ rpc, executor: inertExecutor(id), blockstore: store, ...SENTINELS })
    workers.push({ id, rpc, store, local })
  }

  const clientRpc = new RpcEndpoint(network.connect('client'), { timeoutMs: 5_000 })

  const askCombine = async (nodeId: string, inputCids: readonly CID[], level = 1) =>
    parseResponse(
      await clientRpc.request(
        nodeId,
        encodeRequest({ kind: 'combine', combineId: 'tree-node-a', inputCids, level }),
      ),
    )

  const close = () => {
    clientRpc.close()
    originRpc.close()
    for (const w of workers) w.rpc.close()
  }

  return { network, originStore, originRpc, clientRpc, workers, askCombine, close }
}

/** Put a canonical value into `store` and return its CID. */
async function putValue(store: Blockstore, value: CanonicalValue): Promise<CID> {
  const encoded = encodeCanonical(value)
  if (!encoded.ok) throw new Error(`fixture will not canonicalise: ${JSON.stringify(encoded.error)}`)
  return store.put(encoded.bytes)
}

describe('MR-03 — a node combines partials it has never seen', () => {
  it('pulls every input by CID, merges them, and answers with the result address', async () => {
    const fabric = await combineFabric({ workers: 1 })
    try {
      const a = partial('alpha')
      const b = partial('beta')
      const [aCid, bCid] = [await putValue(fabric.originStore, a), await putValue(fabric.originStore, b)]

      const reply = await fabric.askCombine('w0', [aCid, bCid])

      // Computed independently in this process, from the production combiner.
      const reference = await canonicalCid(fabricCombiner([a, b]))
      expect(reference.ok).toBe(true)
      if (!reference.ok) return

      expect(reply?.kind).toBe('combine')
      if (reply?.kind !== 'combine') return
      expect(reply.reason).toBe('')
      expect(reply.resultCid?.toString()).toBe(reference.cid.toString())

      // Every input it merged, it obtained by asking for an address.
      expect(fabric.workers[0]?.store.fetched).toBeGreaterThanOrEqual(2)
    } finally {
      fabric.close()
    }
  })

  it('leaves the result on the node that computed it, and not on the asker', async () => {
    const fabric = await combineFabric({ workers: 1 })
    try {
      const aCid = await putValue(fabric.originStore, partial('alpha'))
      const bCid = await putValue(fabric.originStore, partial('beta'))

      const reply = await fabric.askCombine('w0', [aCid, bCid])
      expect(reply?.kind).toBe('combine')
      if (reply?.kind !== 'combine' || reply.resultCid === null) throw new Error('no result cid')

      // This pair is what distinguishes a real remote combine from a local one
      // dressed up as one. It is a property of the HANDLER: the work happened on w0
      // and stayed there. The dispatcher in the next describe then retrieves it
      // deliberately, by CID, from that same peer — the two are not in tension.
      expect(await fabric.workers[0]?.local.has(reply.resultCid)).toBe(true)
      expect(await fabric.originStore.has(reply.resultCid)).toBe(false)
    } finally {
      fabric.close()
    }
  })
})

describe('MR-03 — a combine that could not be run says so, and is not an error frame', () => {
  it('names the input it could not obtain from anywhere', async () => {
    const fabric = await combineFabric({ workers: 1 })
    try {
      const held = await putValue(fabric.originStore, partial('alpha'))
      // Never stored anywhere: no peer in this fabric can answer for it.
      const missing = (await canonicalCid(partial('nobody-holds-this'))) as { cid: CID }

      const reply = await fabric.askCombine('w0', [held, missing.cid])

      expect(reply?.kind).toBe('combine')
      if (reply?.kind !== 'combine') return
      expect(reply.resultCid).toBeNull()
      expect(reply.reason).toContain(missing.cid.toString())
    } finally {
      fabric.close()
    }
  })

  it('names an input larger than the partial budget, with both figures', async () => {
    const fabric = await combineFabric({ workers: 1 })
    try {
      const small = await putValue(fabric.originStore, partial('alpha'))
      // A perfectly well-formed value that has stopped being a summary.
      const oversized: CanonicalValue = { blob: new Uint8Array(MAX_PARTIAL_BYTES + 512), rows: 1 }
      const bigCid = await putValue(fabric.originStore, oversized)
      const bigBytes = encodeCanonical(oversized)
      if (!bigBytes.ok) throw new Error('fixture will not canonicalise')

      const reply = await fabric.askCombine('w0', [small, bigCid])

      expect(reply?.kind).toBe('combine')
      if (reply?.kind !== 'combine') return
      expect(reply.resultCid).toBeNull()
      expect(reply.reason).toContain(bigCid.toString())
      expect(reply.reason).toContain(String(bigBytes.bytes.byteLength))
      expect(reply.reason).toContain(String(MAX_PARTIAL_BYTES))
    } finally {
      fabric.close()
    }
  })

  it('names an input whose bytes are not decodable, without throwing out of the handler', async () => {
    const fabric = await combineFabric({ workers: 1 })
    try {
      const small = await putValue(fabric.originStore, partial('alpha'))
      // `0xff` is a CBOR "break" with nothing to break out of — decodable bytes this
      // is not, and the block still hashes to the CID it is stored under.
      const junkCid = await fabric.originStore.put(new Uint8Array([0xff, 0xff, 0xff]))

      const reply = await fabric.askCombine('w0', [small, junkCid])

      // A throw would have reached `serveAgent`'s outer catch and come back as an
      // `error` frame naming the node — a *node* condition, which is the wrong retry
      // policy for a combine that simply could not be run.
      expect(reply?.kind).toBe('combine')
      if (reply?.kind !== 'combine') return
      expect(reply.resultCid).toBeNull()
      expect(reply.reason).toContain(junkCid.toString())
    } finally {
      fabric.close()
    }
  })
})

describe('the cost of a combine frame is bounded by the first input the node refuses', () => {
  it('stops reading at the refusal rather than fetching every named input', async () => {
    const fabric = await combineFabric({ workers: 1 })
    try {
      // Five inputs: the first obtainable, the second not, and three more that a node
      // fetching the whole list eagerly would go on to pull.
      const first = await putValue(fabric.originStore, partial('alpha'))
      const missing = await canonicalCid(partial('nobody-holds-this'))
      if (!missing.ok) throw new Error('fixture will not canonicalise')
      const rest = [
        await putValue(fabric.originStore, partial('gamma')),
        await putValue(fabric.originStore, partial('delta')),
        await putValue(fabric.originStore, partial('epsilon')),
      ]

      const reply = await fabric.askCombine('w0', [first, missing.cid, ...rest])

      expect(reply?.kind).toBe('combine')
      if (reply?.kind !== 'combine') return
      expect(reply.resultCid).toBeNull()

      // This is the whole content of the amplification disposition, as a number rather
      // than a paragraph: one block crossed the wire, not four. A `Promise.all` over
      // `inputCids`, or a loop that validated only after fetching everything, pulls all
      // four and fails here while still answering the same null arm — which is exactly
      // why the count is asserted and not only the reply.
      expect(fabric.workers[0]?.store.fetched).toBe(1)
    } finally {
      fabric.close()
    }
  })
})

/** A `Blockstore` decorator that counts the reads made through it. */
class CountingBlockstore implements Blockstore {
  gets = 0
  /**
   * CID string whose read throws, or `null` for a store that answers everything.
   *
   * Here to make "the slot is released on a throw" a measurement rather than an
   * argument. A store that always threw could not also serve the paired positive
   * control — the combine that succeeds once the fault is cleared — and without that
   * control the release assertion is satisfied by a node that never took a slot.
   */
  throwOn: string | null = null
  readonly #inner: Blockstore

  constructor(inner: Blockstore) {
    this.#inner = inner
  }

  async put(bytes: Uint8Array<ArrayBuffer>): Promise<CID> {
    return this.#inner.put(bytes)
  }

  async get(cid: CID): Promise<Uint8Array<ArrayBuffer> | undefined> {
    this.gets += 1
    if (this.throwOn === cid.toString()) throw new Error('the local tier faulted')
    return this.#inner.get(cid)
  }

  async has(cid: CID): Promise<boolean> {
    return this.#inner.has(cid)
  }

  get size(): number {
    return this.#inner.size
  }
}

/**
 * A node holding a real `Authorizer`, with a blockstore that counts reads.
 *
 * The counting wrapper goes on *after* the fixtures are in, so `gets` covers the
 * handler alone and nothing the test itself did to set up.
 */
async function authorizingNode(authorize: Authorizer) {
  const network = new MemoryNetwork()
  const store = new MemoryBlockstore()
  const a = partial('alpha')
  const b = partial('beta')
  const aCid = await putValue(store, a)
  const bCid = await putValue(store, b)
  const counting = new CountingBlockstore(store)

  const serverRpc = new RpcEndpoint(network.connect('w0'), { timeoutMs: 5_000 })
  serveAgent({ ...SENTINELS, rpc: serverRpc, executor: inertExecutor('w0'), blockstore: counting, authorize })

  const client = new RpcEndpoint(network.connect('client'), { timeoutMs: 5_000 })
  const askCombine = async () =>
    parseResponse(
      await client.request(
        'w0',
        encodeRequest({ kind: 'combine', combineId: 'tree-node-a', inputCids: [aCid, bCid], level: 1 }),
      ),
    )

  return {
    counting,
    inputs: [a, b] as const,
    askCombine,
    close: () => {
      client.close()
      serverRpc.close()
    },
  }
}

/**
 * AUTH-03 / 16-05 — a combine goes through `options.authorize`, like every other request.
 *
 * **What this describe replaced, because the record matters more than the diff.** Until
 * 16-05 it held one case asserting that a node with a real `Authorizer` *refuses* every
 * combine, with the text `'combine requires a capability chain this build cannot verify'`
 * — and 16-02 mutation-tested that refusal with this same counting blockstore. The
 * refusal was written on the premise that every production call site passed the
 * `'serves-unauthenticated'` sentinel, so refusing cost nothing. Phase 15 falsified the
 * premise: both `FabricNode` and `BrowserNode` install `authorizeCapability`, so the
 * refusal fired on every real node and the reduce had no production path. Owner ruling
 * 2026-07-31 routes a combine through the same hook instead.
 *
 * The two properties below are what replaced it, and they are the pair: **the hook is
 * consulted** (a refusing authorizer refuses the combine, in its own words) and **the
 * hook is obeyed** (an admitting authorizer gets a real combine, not a silent refusal).
 * Either one alone is passed by a build that ignores `authorize` on this branch.
 */
describe('AUTH-03 / 16-05 — a combine is admitted or refused by the node`s own Authorizer', () => {
  it('performs the combine when the authorizer admits it', async () => {
    const node = await authorizingNode(() => null)
    try {
      const reply = await node.askCombine()

      // The reference is computed here, from the production combiner, so this asserts a
      // combine actually happened rather than merely that nothing said no.
      const reference = await canonicalCid(fabricCombiner([...node.inputs]))
      expect(reference.ok).toBe(true)
      if (!reference.ok) return

      expect(reply?.kind).toBe('combine')
      if (reply?.kind !== 'combine') return
      expect(reply.reason).toBe('')
      expect(reply.resultCid?.toString()).toBe(reference.cid.toString())
      // Reads happen now, where before 16-05 the refusal made them zero. Asserted so
      // the two cases cannot both be satisfied by a handler that never reads at all.
      expect(node.counting.gets).toBeGreaterThanOrEqual(2)
    } finally {
      node.close()
    }
  })

  it('returns the authorizer`s own refusal text, and never calls get', async () => {
    // The text is the authorizer's, verbatim under the `unauthorized: ` prefix the
    // `exec` branch also uses. Asserted with `toBe` rather than `toContain`: a handler
    // that composed its own message — which is what the deleted gate did — fails here
    // even though the combine still correctly fails.
    const node = await authorizingNode(() => 'no pinned owner key for owner-1 on this node')
    try {
      const reply = await node.askCombine()

      expect(reply?.kind).toBe('combine')
      if (reply?.kind !== 'combine') return
      expect(reply.resultCid).toBeNull()
      expect(reply.reason).toBe('unauthorized: no pinned owner key for owner-1 on this node')
      // The ordering is the requirement, and it is the one property the deleted gate
      // got right: refusing after fetching would already have made the peer do the work
      // the refusal exists to prevent. Moving the check below the loop passes the reason
      // assertion above while failing this.
      expect(node.counting.gets).toBe(0)
    } finally {
      node.close()
    }
  })

  it('hands the authorizer the combine`s own addresses, and no fabricated task', async () => {
    // What the hook is *told* is load-bearing, because an authorizer decides on it. A
    // combine has no `moduleCid`, no single `inputCid`, no partition index and no
    // partition count, so `AuthorizedWork` gives it a `combine` arm rather than a `Task`
    // literal with four invented fields. This pins that: the arm is discriminated, and
    // it carries the frame's own three keys.
    const seen: AuthorizedWork[] = []
    const node = await authorizingNode((request) => {
      seen.push(request)
      return null
    })
    try {
      await node.askCombine()

      expect(seen).toHaveLength(1)
      const work = seen[0]
      expect(work?.kind).toBe('combine')
      if (work?.kind !== 'combine') return
      expect(work.combine.combineId).toBe('tree-node-a')
      expect(work.combine.level).toBe(1)
      expect(work.combine.inputCids).toHaveLength(2)
      // Empty because the frame carries no chain — not because one was checked and
      // found empty. `agent.ts`' `AuthorizedWork` records which of the two this is.
      expect(work.capability).toEqual([])
    } finally {
      node.close()
    }
  })
})

/**
 * A node with a real `LocalCapacity` and a blockstore that counts reads.
 *
 * Separate from {@link authorizingNode} rather than a parameter on it, because the two
 * read different instruments: that helper's subject is what the `authorize` hook is
 * told and obeys, this one's is how many slots the node is holding and what it says
 * when it has none. Both wrap the store *after* the fixtures are in, so `gets` covers
 * the handler alone.
 *
 * `putPartial` exposes the raw store so a test can add fixtures whose CIDs differ from
 * the pair below. That matters for the leak case: `LocalCapacity` refuses a key already
 * in flight *before* it reaches the over-committed branch, so a leak measured with one
 * repeated input set would report `already in flight here` and never reach the reading
 * the test is taking.
 */
async function capacityNode(options: { readonly maxConcurrent: number; readonly authorize?: Authorizer }) {
  const network = new MemoryNetwork()
  const store = new MemoryBlockstore()
  const a = partial('alpha')
  const b = partial('beta')
  const aCid = await putValue(store, a)
  const bCid = await putValue(store, b)
  const counting = new CountingBlockstore(store)
  const capacity = new LocalCapacity({ nodeId: 'w0', maxConcurrent: options.maxConcurrent })

  const serverRpc = new RpcEndpoint(network.connect('w0'), { timeoutMs: 5_000 })
  serveAgent({
    ...SENTINELS,
    rpc: serverRpc,
    executor: inertExecutor('w0'),
    blockstore: counting,
    capacity,
    ...(options.authorize === undefined ? {} : { authorize: options.authorize }),
  })

  const client = new RpcEndpoint(network.connect('client'), { timeoutMs: 5_000 })
  const askCombine = async (inputCids: readonly CID[] = [aCid, bCid], combineId = 'tree-node-a') =>
    parseResponse(
      await client.request('w0', encodeRequest({ kind: 'combine', combineId, inputCids, level: 1 })),
    )

  return {
    capacity,
    counting,
    cids: [aCid, bCid] as const,
    inputs: [a, b] as const,
    putPartial: async (key: string) => putValue(store, partial(key)),
    askCombine,
    close: () => {
      client.close()
      serverRpc.close()
    },
  }
}

/**
 * SCHED-06 on the combine branch — the fetch-amplification bound the owner ruled for.
 *
 * **Why admission and not a second authorizer rule.** A combine's inputs are the
 * outputs of public map tasks: content-addressed, and already public by construction.
 * There is nothing on that frame to authorize. What a peer can provoke is CPU and
 * transfer, which is a *capacity* question, and capacity is what `LocalCapacity`
 * answers. `agent.ts`' own disclosure said so before this branch existed — *"the
 * general answer to it is per-request admission (SCHED-06), not a second bound invented
 * for this branch alone"*.
 *
 * **The `Authorizer` routing 16-05 added stays.** It is consulted on every node alike
 * and becomes live the day a sovereign reduce exists; this is a capacity bound placed
 * beside it, not a replacement for it. The three AUTH-03 cases above are untouched.
 *
 * ## Which instrument reads which claim, because they are not interchangeable
 *
 * - **The reply text** is the falsifiable reading of the bound. It can carry any string
 *   at all, so `toBe('over-committed: 1 of 1 slots in use')` fails on a handler that
 *   refused for the wrong reason while the combine still correctly produced nothing —
 *   the failure mode this repository has been bitten by four times.
 * - **`counting.gets`** is the falsifiable reading of *where* the check sits. A bound
 *   applied after the loop has already paid for the transfers it exists to prevent, and
 *   `gets` is the only thing that can tell the two placements apart: the reply text is
 *   identical either way.
 * - **`capacity.peakInFlight`** is a **release** reading, never a bound reading.
 *   `LocalCapacity.offer` returns its refusal before `#inFlight.add`, so
 *   `peakInFlight <= slots` is arithmetic and cannot fail. What it can say is that a
 *   slot really was taken — which is what makes "and given back" a measurement.
 */
describe('SCHED-06 — the combine branch takes an admission slot, and gives it back', () => {
  it('refuses at the limit in the node`s own words, reads nothing, and combines once a slot frees', async () => {
    const node = await capacityNode({ maxConcurrent: 1 })
    try {
      // Saturation is *declared*, not raced — the same technique
      // `admission.node.test.ts` uses on the exec branch, and for the same reason: a
      // test that is usually saturated is worse than one that says how it made certain.
      // The key is not any combine's derived key, so the incoming frame meets the
      // over-committed branch and not the dedupe branch.
      const held = node.capacity.offer({ shardId: 'held-by-this-test', nodeId: 'w0' })
      expect(held.accepted).toBe(true)

      const refused = await node.askCombine()

      // The combine reply shape, never an `error` frame: `executeReduce`'s ranking walk
      // consumes `resultCid: null` as the signal to try the next executor, and an
      // `error` would be read as a node condition by a caller that never sees this
      // string at all (`combine.ts` collapses every failure to `null`).
      expect(refused?.kind).toBe('combine')
      if (refused?.kind !== 'combine') return
      expect(refused.resultCid).toBeNull()
      // The **text**, not the kind. No prefix is added, so one capacity refusal reads
      // identically whichever branch composed it — the exec branch sends
      // `admission.reason` verbatim too.
      expect(refused.reason).toBe('over-committed: 1 of 1 slots in use')
      // The whole content of the ruling, as a number: the slot is taken before the
      // fetch loop, so a refused combine costs nothing at all. A check placed after
      // the loop passes the assertion above while failing this one.
      expect(node.counting.gets).toBe(0)

      // The paired positive control. Without it, `gets === 0` is equally satisfied by a
      // handler that never reads, and the refusal above by a node that refuses always.
      node.capacity.release('held-by-this-test')
      const admitted = await node.askCombine()

      const reference = await canonicalCid(fabricCombiner([...node.inputs]))
      expect(reference.ok).toBe(true)
      if (!reference.ok) return
      expect(admitted?.kind).toBe('combine')
      if (admitted?.kind !== 'combine') return
      expect(admitted.reason).toBe('')
      expect(admitted.resultCid?.toString()).toBe(reference.cid.toString())
      expect(node.counting.gets).toBeGreaterThanOrEqual(2)

      // Taken, and given back.
      expect(node.capacity.peakInFlight).toBe(1)
      expect(node.capacity.inFlight).toBe(0)
    } finally {
      node.close()
    }
  })

  it('does not climb its high-water mark across twenty combines', async () => {
    // **The leak test, and it matters more than the bound test.** A node that admits
    // correctly and never releases is indistinguishable from a working one for exactly
    // `slots` combines and then refuses everything forever — which on this branch means
    // a reduce that silently stops finding executors, with nothing naming the cause.
    //
    // Two slots and one combine at a time, so a working release leaves the mark at 1.
    // Each iteration names a *distinct* input pair: with one repeated pair a leak would
    // surface as `already in flight here` on the second call, which is a different
    // refusal answering a different question.
    const node = await capacityNode({ maxConcurrent: 2 })
    try {
      const reference = await canonicalCid(fabricCombiner([...node.inputs]))
      expect(reference.ok).toBe(true)

      for (let i = 0; i < 20; i++) {
        const pair = [await node.putPartial(`left-${i}`), await node.putPartial(`right-${i}`)]
        const reply = await node.askCombine(pair, `tree-node-${i}`)
        expect(reply?.kind).toBe('combine')
        if (reply?.kind !== 'combine') return
        // Instrument live: every one of the twenty really did combine. Twenty refusals
        // would also leave `peakInFlight` where it started.
        expect(reply.reason).toBe('')
        expect(reply.resultCid).not.toBeNull()
      }

      // Never more than one slot held at any instant across twenty take/release pairs.
      // A leak reads 2 here — and every combine from the third on reads
      // `over-committed: 2 of 2 slots in use`, which is why the loop asserts each reply.
      expect(node.capacity.peakInFlight).toBe(1)
      expect(node.capacity.inFlight).toBe(0)
    } finally {
      node.close()
    }
  })

  it('gives the slot back when the combine fails, and when the store throws', async () => {
    const node = await capacityNode({ maxConcurrent: 1 })
    try {
      // Exit 1 — a named failure inside the handler: an input nobody holds. One slot,
      // so a leak here makes every later assertion in this test read a refusal.
      const missing = await canonicalCid(partial('nobody-holds-this'))
      expect(missing.ok).toBe(true)
      if (!missing.ok) return
      const notHeld = await node.askCombine([node.cids[0], missing.cid])
      expect(notHeld?.kind).toBe('combine')
      if (notHeld?.kind !== 'combine') return
      expect(notHeld.resultCid).toBeNull()
      expect(notHeld.reason).toContain(missing.cid.toString())
      expect(node.capacity.peakInFlight).toBe(1)
      expect(node.capacity.inFlight).toBe(0)

      // Exit 2 — a throw, which leaves this handler entirely and is answered by
      // `serveAgent`'s outer catch. Nothing inside `runCombine` sees it, so only a
      // `finally` can return the slot.
      node.counting.throwOn = node.cids[0].toString()
      const threw = await node.askCombine()
      expect(threw?.kind).toBe('error')
      if (threw?.kind !== 'error') return
      expect(threw.reason).toContain('serving failed on w0')
      expect(node.capacity.inFlight).toBe(0)

      // Exit 3 — success, after the fault is cleared. This is the positive control for
      // both exits above: a node still holding either slot answers this
      // `over-committed: 1 of 1 slots in use` instead of combining.
      node.counting.throwOn = null
      const ok = await node.askCombine()
      const reference = await canonicalCid(fabricCombiner([...node.inputs]))
      expect(reference.ok).toBe(true)
      if (!reference.ok) return
      expect(ok?.kind).toBe('combine')
      if (ok?.kind !== 'combine') return
      expect(ok.reason).toBe('')
      expect(ok.resultCid?.toString()).toBe(reference.cid.toString())
      expect(node.capacity.inFlight).toBe(0)
    } finally {
      node.close()
    }
  })

  it('gives the slot back when the authorizer refuses, an exit that reads nothing at all', async () => {
    // The exit `admission.test.ts` singles out on the exec branch — *"the authorize
    // refusal that never calls the executor at all"* — in its combine form. The slot is
    // taken before the hook is consulted, so this path holds one without ever entering
    // the fetch loop, and only a `finally` returns it.
    let refuse = true
    const node = await capacityNode({
      maxConcurrent: 1,
      authorize: () => (refuse ? 'no pinned owner key for owner-1 on this node' : null),
    })
    try {
      const refused = await node.askCombine()
      expect(refused?.kind).toBe('combine')
      if (refused?.kind !== 'combine') return
      expect(refused.reason).toBe('unauthorized: no pinned owner key for owner-1 on this node')
      expect(node.counting.gets).toBe(0)
      // A slot really was taken — the reading that makes "and given back" mean
      // something — and it really was returned.
      expect(node.capacity.peakInFlight).toBe(1)
      expect(node.capacity.inFlight).toBe(0)

      // The node is as free as one that has answered nothing.
      refuse = false
      const ok = await node.askCombine()
      expect(ok?.kind).toBe('combine')
      if (ok?.kind !== 'combine') return
      expect(ok.reason).toBe('')
      expect(ok.resultCid).not.toBeNull()
    } finally {
      node.close()
    }
  })
})

/**
 * Yield to the macrotask queue so every microtask queued during delivery has run.
 *
 * **Not a timing bound and not a measurement.** `MemoryNetwork.route` delivers
 * synchronously, so the serving side's post-send `finally` — the only place
 * `afterSent` runs — is a microtask that may be queued behind the requesting side's
 * own continuation. A zero timeout is a *macrotask*, which by the event loop's own
 * ordering runs after every pending microtask, so this waits on a queue rather than
 * on a duration. Reading `releases` without it measures the scheduler, not the code.
 */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/** An `EgressGuard` that counts how many holds have been given back. */
class CountingEgressGuard extends EgressGuard {
  releases = 0

  override guard(label: string, payload: Uint8Array): EgressHold {
    const inner = super.guard(label, payload)
    return {
      release: (): void => {
        this.releases += 1
        inner.release()
      },
    }
  }
}

describe('MR-06 — a combine reply is a plain body, with no egress hold to give back', () => {
  it('releases nothing across a combine, and at least one across a sovereign exec', async () => {
    const network = new MemoryNetwork()
    const local = new MemoryBlockstore()
    const aCid = await putValue(local, partial('alpha'))
    const bCid = await putValue(local, partial('beta'))
    // The sovereign task's input, resident locally — which is what `takeSovereignHold`
    // requires before it registers anything at all.
    const moduleCid = await local.put(new Uint8Array([0x00, 0x61, 0x73, 0x6d]))
    const inputCid = await putValue(local, { row: 'owner-private' })

    const guard = new CountingEgressGuard(network.connect('w0'), 'owner-1')
    const serverRpc = new RpcEndpoint(guard, { timeoutMs: 5_000 })
    const succeeds: Executor = {
      nodeId: 'w0',
      async execute() {
        return { ok: true, output: { done: true }, fuelUsed: 1, attestation: 'signed-by-nobody' }
      },
    }
    serveAgent({
      ...SENTINELS,
      rpc: serverRpc,
      executor: succeeds,
      blockstore: local,
      egress: { guard, sovereignInputs: local, sovereignCids: 'forgets-sovereignty-between-jobs' },
    })

    const client = new RpcEndpoint(network.connect('client'), { timeoutMs: 5_000 })
    try {
      const combineReply = parseResponse(
        await client.request(
          'w0',
          encodeRequest({ kind: 'combine', combineId: 'tree-node-a', inputCids: [aCid, bCid], level: 1 }),
        ),
      )
      expect(combineReply?.kind).toBe('combine')
      await settle()
      // A combine's inputs are partials, and only the executing node of a *map* task
      // registers a sovereign payload — so there is no registration outstanding
      // against a combine reply to release.
      expect(guard.releases).toBe(0)

      // The positive control, without which the zero above is a silence rather than a
      // reading: the same guard, on the same node, across an exec that does register.
      const execReply = parseResponse(
        await client.request(
          'w0',
          encodeRequest({
            kind: 'exec',
            task: {
              moduleCid,
              inputCid,
              partitionIndex: 0,
              partitionCount: 1,
              label: 'sovereign',
              ownerId: 'owner-1',
            },
          }),
        ),
      )
      expect(execReply?.kind).toBe('exec')
      await settle()
      expect(guard.releases).toBeGreaterThanOrEqual(1)
    } finally {
      client.close()
      serverRpc.close()
    }
  })
})

/** The CID a canonical value gets, without storing it anywhere. */
async function blockCidOf(value: CanonicalValue): Promise<CID> {
  const hashed = await canonicalCid(value)
  if (!hashed.ok) throw new Error(`fixture will not canonicalise: ${JSON.stringify(hashed.error)}`)
  return hashed.cid
}

/**
 * A `CombineTask` naming `inputCids`, with the id of a derived tree node.
 *
 * `nodeId` is the *tree node's* id and never a peer id — the wire field is called
 * `combineId` precisely because carrying `nodeId` across a boundary where "node" means
 * "peer" is how that gets misread.
 */
function combineTask(inputCids: readonly CID[], nodeId = 'tree-node-a') {
  return { nodeId, inputCids: inputCids.map((c) => c.toString()), level: 1 }
}

/**
 * An endpoint that records every request body it is asked and answers from a script.
 *
 * The captured object is the *decoded request*, not the encoded frame bytes, which is
 * what makes the payload assertion below about the protocol rather than about the RPC
 * envelope.
 */
function recordingNode(
  network: MemoryNetwork,
  id: string,
  answer: (body: CanonicalValue) => CanonicalValue,
) {
  const rpc = new RpcEndpoint(network.connect(id), { timeoutMs: 5_000 })
  const bodies: CanonicalValue[] = []
  rpc.serve(async (_from, body) => {
    bodies.push(body)
    return answer(body)
  })
  return { id, rpc, bodies }
}

/** Dispatch one combine at a scripted peer and assert the dispatcher resolved null. */
async function expectNull(
  peerFor: (network: MemoryNetwork) => { readonly rpc: RpcEndpoint },
): Promise<void> {
  const network = new MemoryNetwork()
  const peer = peerFor(network)
  const clientRpc = new RpcEndpoint(network.connect('client'), { timeoutMs: 5_000 })
  const aCid = await blockCidOf(partial('alpha'))
  const bCid = await blockCidOf(partial('beta'))
  try {
    const cid = await remoteCombineDispatch({ rpc: clientRpc, blockstore: new MemoryBlockstore() })(
      combineTask([aCid, bCid]),
      'w0',
    )
    expect(cid).toBeNull()
  } finally {
    clientRpc.close()
    peer.rpc.close()
  }
}

describe('MR-05 — remoteCombineDispatch runs a combine on a peer and brings the result home', () => {
  it('resolves the CID the handler produced, and makes it resident here', async () => {
    const fabric = await combineFabric({ workers: 1 })
    // A plain store with **no network fallback of any kind**: the only way bytes reach
    // it is the dispatcher's own directed fetch.
    const plain = new MemoryBlockstore()
    try {
      const a = partial('alpha')
      const b = partial('beta')
      const aCid = await putValue(fabric.originStore, a)
      const bCid = await putValue(fabric.originStore, b)

      const reference = await canonicalCid(fabricCombiner([a, b]))
      if (!reference.ok) throw new Error('reference will not canonicalise')

      expect(await plain.has(reference.cid)).toBe(false)

      const dispatch = remoteCombineDispatch({ rpc: fabric.clientRpc, blockstore: plain })
      const cid = await dispatch(combineTask([aCid, bCid]), 'w0')

      expect(cid?.toString()).toBe(reference.cid.toString())
      // The assertion that closes level 2. An implementation that returned the CID and
      // stopped passes the line above and fails this one.
      expect(await plain.has(reference.cid)).toBe(true)
    } finally {
      fabric.close()
    }
  })

  it('asks the peer that answered, and no other peer at all', async () => {
    const network = new MemoryNetwork()
    const originStore = new MemoryBlockstore()
    const originRpc = new RpcEndpoint(network.connect('origin'), { timeoutMs: 5_000 })
    serveAgent({ rpc: originRpc, executor: inertExecutor('origin'), blockstore: originStore, ...SENTINELS })

    const aCid = await putValue(originStore, partial('alpha'))
    const bCid = await putValue(originStore, partial('beta'))

    // w0 runs the combine for real.
    const w0Rpc = new RpcEndpoint(network.connect('w0'), { timeoutMs: 5_000 })
    const w0Store = new FetchingBlockstore(
      new MemoryBlockstore(),
      new RpcBlockSource(w0Rpc, () => ['origin']),
    )
    serveAgent({ rpc: w0Rpc, executor: inertExecutor('w0'), blockstore: w0Store, ...SENTINELS })

    // w1 holds nothing and records anything it is asked. A fan-out would reach it —
    // and a non-holding peer answering a block miss asks its own only peer straight
    // back, which is the circular wait this design keeps off the happy path.
    const w1 = recordingNode(network, 'w1', () => encodeResponse({ kind: 'block', bytes: null }))

    const clientRpc = new RpcEndpoint(network.connect('client'), { timeoutMs: 5_000 })
    const plain = new MemoryBlockstore()
    try {
      const cid = await remoteCombineDispatch({ rpc: clientRpc, blockstore: plain })(
        combineTask([aCid, bCid]),
        'w0',
      )

      expect(cid).not.toBeNull()
      // Both asserted: residency alone would still pass for an implementation that
      // fanned out and happened to find a holder.
      expect(w1.bodies).toEqual([])
    } finally {
      clientRpc.close()
      w1.rpc.close()
      w0Rpc.close()
      originRpc.close()
    }
  })

  it('sends four keys of addresses, then two, and no payload in either direction', async () => {
    const network = new MemoryNetwork()
    const hashed = await canonicalCid(fabricCombiner([partial('alpha'), partial('beta')]))
    if (!hashed.ok) throw new Error('fixture will not canonicalise')

    const peer = recordingNode(network, 'w0', (body) =>
      (body as { kind?: unknown }).kind === 'combine'
        ? encodeResponse({ kind: 'combine', resultCid: hashed.cid, reason: '' })
        : encodeResponse({ kind: 'block', bytes: hashed.bytes }),
    )

    const clientRpc = new RpcEndpoint(network.connect('client'), { timeoutMs: 5_000 })
    const aCid = await blockCidOf(partial('alpha'))
    const bCid = await blockCidOf(partial('beta'))
    try {
      const cid = await remoteCombineDispatch({ rpc: clientRpc, blockstore: new MemoryBlockstore() })(
        combineTask([aCid, bCid]),
        'w0',
      )
      expect(cid?.toString()).toBe(hashed.cid.toString())

      // MR-06 at the dispatch site, where a future edit would actually add a payload.
      // No deletion turns this red — it fires on *addition*, which is correct for a
      // shape guard, because that is the direction a payload arrives from.
      expect(Object.keys(peer.bodies[0] as object).sort()).toEqual([
        'combineId',
        'inputCids',
        'kind',
        'level',
      ])
      for (const element of (peer.bodies[0] as { readonly inputCids: readonly unknown[] }).inputCids) {
        expect(CID.asCID(element as CanonicalValue)).not.toBeNull()
      }
      // The follow-up is the fabric's ordinary retrieval verb, not a widened combine.
      expect(Object.keys(peer.bodies[1] as object).sort()).toEqual(['cid', 'kind'])
    } finally {
      clientRpc.close()
      peer.rpc.close()
    }
  })
})

describe('MR-05 — every way a combine can fail resolves null, and none of them throws', () => {
  it('(a) resolves null when the peer is not on the network', async () => {
    const network = new MemoryNetwork()
    // A short budget, because this peer does not exist and the request can only time
    // out. Two clocks are armed here and the framework's own (vitest's default test
    // timeout) must stay the larger — 50 ms against a 5 s ceiling.
    const clientRpc = new RpcEndpoint(network.connect('client'), { timeoutMs: 50 })
    const aCid = await blockCidOf(partial('alpha'))
    const bCid = await blockCidOf(partial('beta'))
    try {
      const cid = await remoteCombineDispatch({ rpc: clientRpc, blockstore: new MemoryBlockstore() })(
        combineTask([aCid, bCid]),
        'nobody',
      )
      expect(cid).toBeNull()
    } finally {
      clientRpc.close()
    }
  })

  it('(b) resolves null when this endpoint has been closed', async () => {
    const network = new MemoryNetwork()
    const peer = recordingNode(network, 'w0', () => encodeResponse({ kind: 'block', bytes: null }))
    const clientRpc = new RpcEndpoint(network.connect('client'), { timeoutMs: 5_000 })
    const aCid = await blockCidOf(partial('alpha'))
    const bCid = await blockCidOf(partial('beta'))
    clientRpc.close()
    try {
      const cid = await remoteCombineDispatch({ rpc: clientRpc, blockstore: new MemoryBlockstore() })(
        combineTask([aCid, bCid]),
        'w0',
      )
      expect(cid).toBeNull()
    } finally {
      peer.rpc.close()
    }
  })

  it('(c) resolves null on an error frame', async () => {
    await expectNull((network) =>
      recordingNode(network, 'w0', () => encodeResponse({ kind: 'error', reason: 'refusing' })),
    )
  })

  it('(d) resolves null on a reply of a different kind', async () => {
    await expectNull((network) =>
      recordingNode(network, 'w0', () =>
        encodeResponse({ kind: 'exec', outcome: { ok: true, output: null, fuelUsed: 0, attestation: 'signed-by-nobody' } }),
      ),
    )
  })

  it('(e) resolves null when the peer could not run the combine', async () => {
    await expectNull((network) =>
      recordingNode(network, 'w0', () =>
        encodeResponse({ kind: 'combine', resultCid: null, reason: 'input not held' }),
      ),
    )
  })

  it('(f) resolves null when the peer names a result it will not then serve', async () => {
    const merged = await canonicalCid(fabricCombiner([partial('alpha'), partial('beta')]))
    if (!merged.ok) throw new Error('fixture will not canonicalise')
    // Reachable, and it answered — but a result the requestor cannot retrieve is a
    // result the next level cannot use, so returning its CID anyway would fail the
    // whole reduce one level later with a reason naming the wrong node.
    await expectNull((network) =>
      recordingNode(network, 'w0', (body) =>
        (body as { kind?: unknown }).kind === 'combine'
          ? encodeResponse({ kind: 'combine', resultCid: merged.cid, reason: '' })
          : encodeResponse({ kind: 'block', bytes: null }),
      ),
    )
  })

  it('(g) resolves null when the served block does not hash to the CID claimed', async () => {
    const merged = await canonicalCid(fabricCombiner([partial('alpha'), partial('beta')]))
    const other = encodeCanonical(partial('something-else'))
    if (!merged.ok || !other.ok) throw new Error('fixture will not canonicalise')
    await expectNull((network) =>
      recordingNode(network, 'w0', (body) =>
        (body as { kind?: unknown }).kind === 'combine'
          ? encodeResponse({ kind: 'combine', resultCid: merged.cid, reason: '' })
          : encodeResponse({ kind: 'block', bytes: other.bytes }),
      ),
    )
  })

  it('resolves null for an input CID string that will not parse', async () => {
    const network = new MemoryNetwork()
    const peer = recordingNode(network, 'w0', () => encodeResponse({ kind: 'block', bytes: null }))
    const clientRpc = new RpcEndpoint(network.connect('client'), { timeoutMs: 5_000 })
    try {
      // `CombineTask.inputCids` are strings and become CIDs on the wire. A malformed
      // one inside `executeReduce`'s level would otherwise take down the whole level's
      // `Promise.all` rather than costing one attempt.
      const cid = await remoteCombineDispatch({ rpc: clientRpc, blockstore: new MemoryBlockstore() })(
        { nodeId: 'tree-node-a', inputCids: ['not-a-cid', 'also-not-a-cid'], level: 1 },
        'w0',
      )
      expect(cid).toBeNull()
      expect(peer.bodies).toEqual([])
    } finally {
      clientRpc.close()
      peer.rpc.close()
    }
  })
})

/**
 * A store that answers every `put` with the failure a full disk produces.
 *
 * `FsBlockstore.put` reaches `writeFile`/`rename`, so ENOSPC and EACCES arrive here;
 * a browser's `IDBBlockstore` raises `QuotaExceededError`. All three are the same
 * event as far as the dispatcher is concerned: **this node** could not keep the
 * block. `get`/`has`/`size` stay real so nothing else in the path changes shape.
 */
class RefusingStore extends MemoryBlockstore {
  puts = 0
  override async put(_bytes: Uint8Array<ArrayBuffer>): Promise<CID> {
    this.puts += 1
    throw new Error('ENOSPC: no space left on device, write')
  }
}

/** A peer that runs a real combine and serves the result — it does nothing wrong. */
function honestCombiner(network: MemoryNetwork, id: string, merged: { cid: CID; bytes: Uint8Array<ArrayBuffer> }) {
  return recordingNode(network, id, (body) =>
    (body as { kind?: unknown }).kind === 'combine'
      ? encodeResponse({ kind: 'combine', resultCid: merged.cid, reason: '' })
      : encodeResponse({ kind: 'block', bytes: merged.bytes }),
  )
}

describe('MR-05 — a store this node could not write to is not an executor that is gone', () => {
  it('throws LocalStoreWriteFailed naming the local store, and does not accuse the peer', async () => {
    const network = new MemoryNetwork()
    const merged = await canonicalCid(fabricCombiner([partial('alpha'), partial('beta')]))
    if (!merged.ok) throw new Error('fixture will not canonicalise')
    const peer = honestCombiner(network, 'w0', merged)
    const clientRpc = new RpcEndpoint(network.connect('client'), { timeoutMs: 5_000 })
    const store = new RefusingStore()
    const aCid = await blockCidOf(partial('alpha'))
    const bCid = await blockCidOf(partial('beta'))

    try {
      const dispatch = remoteCombineDispatch({ rpc: clientRpc, blockstore: store })
      const thrown = await dispatch(combineTask([aCid, bCid]), 'w0').then(
        (cid) => ({ kind: 'resolved' as const, cid }),
        (error: unknown) => ({ kind: 'threw' as const, error }),
      )

      // Not `null`. `reduce.ts` defines `null` as "that executor is gone", and w0 is
      // not gone — it ran the combine and served the block when asked.
      expect(thrown.kind).toBe('threw')
      if (thrown.kind !== 'threw') return
      expect(thrown.error).toBeInstanceOf(LocalStoreWriteFailed)
      if (!(thrown.error instanceof LocalStoreWriteFailed)) return

      // The text, not just the type — the message is what a human reads at 3am, and
      // a refusal that names the wrong thing is the defect this case exists for.
      expect(thrown.error.message).toContain('the local store refused the combine result')
      expect(thrown.error.message).toContain('tree node tree-node-a')
      expect(thrown.error.message).toContain('ENOSPC: no space left on device')
      expect(thrown.error.message).toContain("this node's own storage, not the executor that produced it")
      // The peer is not named anywhere in the refusal, because the peer did nothing.
      expect(thrown.error.message).not.toContain('w0')

      expect(thrown.error.combineId).toBe('tree-node-a')
      expect(thrown.error.cid).toBe(merged.cid.toString())
      expect(thrown.error.cause).toBeInstanceOf(Error)

      // The peer was asked exactly twice — the combine and the block — and the write
      // was attempted exactly once. So the failure is the local write and nothing
      // about the exchange before it.
      expect(peer.bodies.length).toBe(2)
      expect(store.puts).toBe(1)
    } finally {
      clientRpc.close()
      peer.rpc.close()
    }
  })

  /**
   * The read count, not the reason string, is what proves this one.
   *
   * A full disk used to be reported as `null`, and `executeReduce` reads `null` as
   * "try the next executor in the rendezvous ranking". So it walked **every** peer,
   * failing the identical local write at each, and reported the whole fabric failed.
   * Counting combine requests is the only assertion that separates the two
   * behaviours: both end with no root CID, and only one of them asks four peers.
   */
  it('costs one combine request, not one per executor in the ranking', async () => {
    const network = new MemoryNetwork()
    const merged = await canonicalCid(fabricCombiner([partial('alpha'), partial('beta')]))
    if (!merged.ok) throw new Error('fixture will not canonicalise')

    const executors = ['w0', 'w1', 'w2', 'w3']
    const peers = executors.map((id) => honestCombiner(network, id, merged))
    const clientRpc = new RpcEndpoint(network.connect('client'), { timeoutMs: 5_000 })
    const store = new RefusingStore()

    const aCid = await blockCidOf(partial('alpha'))
    const bCid = await blockCidOf(partial('beta'))
    const tree = deriveReduceTree([
      { contributorId: 'c0', cid: aCid },
      { contributorId: 'c1', cid: bCid },
    ])

    try {
      const outcome = await executeReduce({
        tree,
        executors,
        dispatch: remoteCombineDispatch({ rpc: clientRpc, blockstore: store }),
      }).then(
        (result) => ({ kind: 'resolved' as const, result }),
        (error: unknown) => ({ kind: 'threw' as const, error }),
      )

      expect(outcome.kind).toBe('threw')
      if (outcome.kind !== 'threw') return
      expect(outcome.error).toBeInstanceOf(LocalStoreWriteFailed)

      // One combine request in total, across all four peers. The old behaviour issued
      // four combines and four block fetches — eight bodies — and then called every
      // executor in the fabric failed.
      const combines = peers.flatMap((p) => p.bodies).filter((b) => (b as { kind?: unknown }).kind === 'combine')
      expect(combines.length).toBe(1)
      expect(store.puts).toBe(1)
    } finally {
      clientRpc.close()
      for (const p of peers) p.rpc.close()
    }
  })
})
