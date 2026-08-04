import { AbiExecutor, WASI_NAMESPACE, WasiExecutor } from '@o2/aot'
import { MAX_PARTITIONS, MemoryBlockstore, WasmExecutor } from '@o2/core'
import type { Blockstore, ExecutionOutcome, Executor, Task } from '@o2/core'
import type { CID } from 'multiformats/cid'
import { describe, expect, it } from 'vitest'
// Test-only relative imports — see the note in packages/net/src/distributed.test.ts.
import {
  MODULE_ECHOES_INPUT,
  MODULE_IMPORTS_CLOCK,
  MODULE_NO_OUTPUT,
  MODULE_TRAPS,
} from '../../core/src/executor/fixtures.ts'
import { wasiEcho } from './fixtures/wasi-fixtures.ts'

/**
 * `AbiExecutor` — the module's declared imports decide, and nothing else does.
 *
 * No `.node.` suffix, so this file runs in the `node` project **and** in every engine
 * the `browser` project drives. Nothing here reaches for a Node builtin: the fixtures
 * arrive as bytes, `MemoryBlockstore` is portable, and `WebAssembly` is a global
 * everywhere.
 *
 * ## What each block is evidence for
 *
 * Two claims are easy to confuse and this file separates them deliberately.
 *
 * 1. **The router picks the right executor.** One `AbiExecutor` instance is handed a
 *    WASI artifact and a native one, and the two recording wrappers underneath it are
 *    required to have seen exactly one call each, on opposite dispatches. Inverting the
 *    predicate fires both halves at once, which is why they share an instance rather
 *    than getting one apiece.
 * 2. **The router changed no existing refusal.** Every reason `WasmExecutor` can
 *    produce is driven through the router *and* through a real `WasmExecutor` built on
 *    the same blockstore, in the same case, and the two strings compared with `toBe`.
 *    Never against a literal — a literal would only prove the router matches a
 *    literal, and the whole risk here is that the router reads `task.moduleCid` before
 *    either executor does and could answer in its own words.
 *
 * A green suite before and after is **not** evidence for (2) and is not offered as
 * such: nobody captured a baseline and nobody diffs the two runs string by string.
 * The enumerated table below is the measurement.
 */

const NODE_ID = 'abi-router-spec-node'

/**
 * A valid module with no imports and no exports — the eight-byte header alone.
 *
 * It compiles and instantiates, so it reaches the entrypoint check rather than
 * failing earlier. That is the only route to `module exports no "run" function`.
 */
const EMPTY_MODULE: Uint8Array<ArrayBuffer> = new Uint8Array([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
])

/** DAG-CBOR for the empty array — a valid input block that `wasiEcho` copies back. */
const EMPTY_ARRAY: Uint8Array<ArrayBuffer> = new Uint8Array([0x80])

/**
 * Watches an executor without changing what it answers.
 *
 * `nodeId` is read off the inner executor rather than supplied, so a wrapper cannot
 * be the reason the router's own `nodeId` assertion passes.
 */
class Recording implements Executor {
  readonly calls: Task[] = []
  readonly nodeId: string
  readonly #inner: Executor

  constructor(inner: Executor) {
    this.#inner = inner
    this.nodeId = inner.nodeId
  }

  async execute(task: Task): Promise<ExecutionOutcome> {
    this.calls.push(task)
    return this.#inner.execute(task)
  }
}

/** Counts `get` calls, so "the refusal cost no read" is a number rather than a claim. */
class CountingBlockstore implements Blockstore {
  gets = 0
  readonly #inner: Blockstore

  constructor(inner: Blockstore) {
    this.#inner = inner
  }

  get size(): number {
    return this.#inner.size
  }

  async put(bytes: Uint8Array<ArrayBuffer>): Promise<CID> {
    return this.#inner.put(bytes)
  }

  async get(cid: CID): Promise<Uint8Array<ArrayBuffer> | undefined> {
    this.gets += 1
    return this.#inner.get(cid)
  }

  async has(cid: CID): Promise<boolean> {
    return this.#inner.has(cid)
  }
}

interface Harness {
  readonly store: MemoryBlockstore
  /**
   * Wraps the store for the **router only**. The two executors underneath hold the
   * raw store, so `gets` is a count of the router's own reads and of nothing else —
   * which is what makes the zero below attributable.
   */
  readonly counting: CountingBlockstore
  readonly native: Recording
  readonly wasi: Recording
  readonly router: AbiExecutor
  /** The reference every refusal string is compared against, over the same blocks. */
  readonly bare: WasmExecutor
}

function harness(): Harness {
  const store = new MemoryBlockstore()
  const counting = new CountingBlockstore(store)
  const native = new Recording(new WasmExecutor({ nodeId: NODE_ID, blockstore: store }))
  const wasi = new Recording(new WasiExecutor({ nodeId: NODE_ID, blockstore: store }))
  return {
    store,
    counting,
    native,
    wasi,
    router: new AbiExecutor({ blockstore: counting, native, wasi }),
    bare: new WasmExecutor({ nodeId: NODE_ID, blockstore: store }),
  }
}

/** A well-formed CID for bytes no store under test holds. */
async function absentCid(): Promise<CID> {
  return new MemoryBlockstore().put(new Uint8Array([0xde, 0xad, 0xbe, 0xef]))
}

function taskOf(moduleCid: CID, inputCid: CID, partitionCount = 1): Task {
  return { moduleCid, inputCid, partitionIndex: 0, partitionCount }
}

describe('AbiExecutor routes on the module and never on the node', () => {
  it('sends a WASI artifact to the WASI arm and a native module to the native arm, from one instance', async () => {
    // One instance, both dispatches. Two instances would let an inverted predicate
    // pass half the file, and the inversion is the mutation this case exists for.
    const h = harness()
    const wasiCid = await h.store.put(wasiEcho)
    const nativeCid = await h.store.put(MODULE_ECHOES_INPUT)
    const inputCid = await h.store.put(EMPTY_ARRAY)

    const viaWasi = await h.router.execute(taskOf(wasiCid, inputCid))
    expect(h.wasi.calls).toHaveLength(1)
    expect(h.native.calls).toHaveLength(0)

    const viaNative = await h.router.execute(taskOf(nativeCid, inputCid))
    expect(h.wasi.calls).toHaveLength(1)
    expect(h.native.calls).toHaveLength(1)

    // Both succeeded, so neither half is explained by a refusal that happened to be
    // routed somewhere.
    expect(viaWasi.ok).toBe(true)
    expect(viaNative.ok).toBe(true)
  })

  it('returns exactly what the chosen executor returned, field for field', async () => {
    const h = harness()
    const wasiCid = await h.store.put(wasiEcho)
    const nativeCid = await h.store.put(MODULE_ECHOES_INPUT)
    const inputCid = await h.store.put(EMPTY_ARRAY)

    // The comparison is against a *bare* executor over the same store, so the router
    // adding, dropping or rewriting a field would show up here rather than in prose.
    const wasiTask = taskOf(wasiCid, inputCid)
    expect(await h.router.execute(wasiTask)).toEqual(
      await new WasiExecutor({ nodeId: NODE_ID, blockstore: h.store }).execute(wasiTask),
    )

    const nativeTask = taskOf(nativeCid, inputCid)
    expect(await h.router.execute(nativeTask)).toEqual(await h.bare.execute(nativeTask))
  })

  it('takes nodeId from the native executor rather than from a fourth argument', () => {
    // A separately supplied `nodeId` is a value that can drift from the one it
    // duplicates, and a node id that disagrees with the executor that produced a
    // result misnames the machine a disagreement is attributed to.
    const store = new MemoryBlockstore()
    const native = new WasmExecutor({ nodeId: 'native-arm', blockstore: store })
    const wasi = new WasiExecutor({ nodeId: 'a-different-string', blockstore: store })
    expect(new AbiExecutor({ blockstore: store, native, wasi }).nodeId).toBe(native.nodeId)
  })
})

/**
 * Every refusal `WasmExecutor.execute` can return from its own `return` statements,
 * one row each.
 *
 * Nine routes to eight reasons: `instantiation failed` has two, because malformed
 * bytes and an import the host does not supply are different code paths into the same
 * string, and the router treats them differently — it delegates on a compile throw and
 * routes on a successful compile, so both need a row.
 *
 * Not exhaustive of `WasmExecutor`'s refusals and this file does not claim it is:
 * `output_write`'s own refusals (the over-cap, negative-length and out-of-bounds
 * strings) are relayed through a ninth `return` site that these rows do not reach.
 * They are unaffected for a structural reason — the router never sees them, because
 * they are produced after it has already delegated — but "unaffected for a reason" is
 * not the same as "measured", and the distinction is the point of writing it down.
 */
const REASON_ROWS: readonly {
  readonly name: string
  readonly setup: (store: MemoryBlockstore) => Promise<Task>
}[] = [
  {
    name: `partitionCount exceeds ${MAX_PARTITIONS}`,
    setup: async (): Promise<Task> => {
      const cid = await absentCid()
      return taskOf(cid, cid, MAX_PARTITIONS + 1)
    },
  },
  {
    name: 'module block missing',
    setup: async (store): Promise<Task> => taskOf(await absentCid(), await store.put(EMPTY_ARRAY)),
  },
  {
    name: 'input block missing',
    setup: async (store): Promise<Task> =>
      taskOf(await store.put(MODULE_ECHOES_INPUT), await absentCid()),
  },
  {
    // Bytes that are not a module at all: the router's own `WebAssembly.compile`
    // throws, so this is the delegate-on-throw branch.
    name: 'instantiation failed',
    setup: async (store): Promise<Task> =>
      taskOf(await store.put(new Uint8Array([1, 2, 3, 4])), await store.put(EMPTY_ARRAY)),
  },
  {
    // A module that compiles and asks for an import the native host does not supply:
    // the router routes it correctly and the refusal comes from instantiate.
    name: 'instantiation failed',
    setup: async (store): Promise<Task> =>
      taskOf(await store.put(MODULE_IMPORTS_CLOCK), await store.put(EMPTY_ARRAY)),
  },
  {
    name: 'module exports no "run" function',
    setup: async (store): Promise<Task> =>
      taskOf(await store.put(EMPTY_MODULE), await store.put(EMPTY_ARRAY)),
  },
  {
    name: 'trap during execution',
    setup: async (store): Promise<Task> =>
      taskOf(await store.put(MODULE_TRAPS), await store.put(EMPTY_ARRAY)),
  },
  {
    name: 'module produced no output',
    setup: async (store): Promise<Task> =>
      taskOf(await store.put(MODULE_NO_OUTPUT), await store.put(EMPTY_ARRAY)),
  },
  {
    // 0xff is CBOR's break byte, which is invalid standing alone. The echo module
    // hands it straight back, so the decode is what refuses.
    name: 'output is not valid DAG-CBOR',
    setup: async (store): Promise<Task> =>
      taskOf(await store.put(MODULE_ECHOES_INPUT), await store.put(new Uint8Array([0xff]))),
  },
]

describe('AbiExecutor changes no refusal the native executor already produced', () => {
  for (const [index, row] of REASON_ROWS.entries()) {
    it(`row ${index + 1}: ${row.name} — byte-identical through the router`, async () => {
      const h = harness()
      const task = await row.setup(h.store)

      const viaRouter = await h.router.execute(task)
      const viaNative = await h.bare.execute(task)

      expect(viaRouter.ok).toBe(false)
      expect(viaNative.ok).toBe(false)
      if (viaRouter.ok || viaNative.ok) return
      // The measurement. Not `toContain` and not a literal: the reference is a real
      // `WasmExecutor` over the same blocks, so a router that invented its own wording
      // fails here whatever the wording is.
      expect(viaRouter.reason).toBe(viaNative.reason)
      // And a check that the row reached the refusal it was written for, so a table
      // that silently collapsed onto one reason could not read as nine passes.
      expect(viaRouter.reason).toContain(row.name)
    })
  }
})

describe('AbiExecutor keeps the cheap refusal cheap and holds no cache', () => {
  it('refuses an over-large partitionCount without reading a single block', async () => {
    // `protocol.ts` validates only that `partitionCount !== 0` and
    // `partitionIndex < partitionCount`, so a peer can put `partitionCount: 1e9` on the
    // wire with any `moduleCid` at all. Reading the module first would turn a refusal
    // that costs one integer comparison into a block fetch — over the network, on a
    // `FetchingBlockstore` — that the peer chose to trigger.
    //
    // Counting rather than asserting on the string is the whole point: deleting the
    // hoisted guard leaves the reason correct and moves this number to 1.
    const h = harness()
    const cid = await absentCid()
    const outcome = await h.router.execute(taskOf(cid, cid, MAX_PARTITIONS + 1))

    expect(h.counting.gets).toBe(0)
    expect(outcome.ok).toBe(false)
  })

  it('reads and compiles the module on every dispatch, deliberately', async () => {
    // Memoising `moduleCid → route` is not done here, and the reason is the resource
    // bound rather than the difficulty: an unbounded per-node map is exactly what the
    // roadmap already has open against `EgressGuard.#entries`, and opening a second
    // one while that is unresolved is not a trade this phase makes quietly.
    //
    // Asserted as a number, because "there is no cache" is otherwise a claim about
    // source that nothing reads.
    const h = harness()
    const moduleCid = await h.store.put(wasiEcho)
    const inputCid = await h.store.put(EMPTY_ARRAY)
    const task = taskOf(moduleCid, inputCid)

    await h.router.execute(task)
    expect(h.counting.gets).toBe(1)
    await h.router.execute(task)
    expect(h.counting.gets).toBe(2)

    // The structural half: one public own property, so a map added as a field would
    // have to be private to survive this — and a private one would still move the
    // count above.
    expect(Object.keys(h.router)).toEqual(['nodeId'])
  })
})

describe('routing wrongly is honest, not silent', () => {
  it('costs one instantiation failure naming the namespace the host did not supply', async () => {
    // The measured form of the router comment's central claim. `WebAssembly.instantiate`
    // is still the sandbox: handing a WASI artifact to the native executor cannot
    // produce a wrong result, only a named refusal.
    const store = new MemoryBlockstore()
    const moduleCid = await store.put(wasiEcho)
    const inputCid = await store.put(EMPTY_ARRAY)

    const outcome = await new WasmExecutor({ nodeId: NODE_ID, blockstore: store }).execute(
      taskOf(moduleCid, inputCid),
    )
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.reason).toContain('instantiation failed')
    // The constant rather than the string, so a shim rename moves both together.
    expect(outcome.reason).toContain(WASI_NAMESPACE)
  })

  it('costs the same in the other direction — a native module against the WASI host', async () => {
    // The converse, so "routing wrongly is honest" is not a statement about one
    // direction. The wording differs between the two executors' failure types and this
    // case deliberately asserts only what both agree on: a refusal, naming the import
    // namespace the chosen host did not supply.
    const store = new MemoryBlockstore()
    const moduleCid = await store.put(MODULE_ECHOES_INPUT)
    const inputCid = await store.put(EMPTY_ARRAY)

    const outcome = await new WasiExecutor({ nodeId: NODE_ID, blockstore: store }).execute(
      taskOf(moduleCid, inputCid),
    )
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.reason).toContain('o2')
  })
})
