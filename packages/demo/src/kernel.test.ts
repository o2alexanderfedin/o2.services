import { MemoryBlockstore, WasmExecutor, decodeCanonical, encodeCanonical, publicNodes, submitJob } from '@o2/core'
import type { CanonicalValue, Executor } from '@o2/core'
import type { CID } from 'multiformats/cid'
import { describe, expect, it, vi } from 'vitest'
import { colourOf, verifyColouring } from './colouring.ts'
import { COLOURING_BYTES, DEFAULT_BUDGET, MAX_N, answerOf, buildInput, readPartial } from './job.ts'
import { kernelBytes } from './kernel.ts'
import { assignmentOrder } from './triples.ts'

/**
 * Every case here runs a real depth-first search inside a real WASM guest, so what
 * each one costs is a fact about the host, not about the assertion.
 *
 * Set once for the file rather than per case. `vitest.config.ts` listed this file
 * among the slow specs and described it as carrying a "50 s testTimeout" — it
 * carried none, and ran on the project default. The browser project's default is
 * 15 s, and on 2026-07-31, with an unrelated LLVM build saturating the host (load
 * average 31 on 8 cores), the n=300 cube case exceeded it in Firefox alone while
 * passing in Chromium and WebKit. Nothing was wrong with the kernel; the machine
 * was busy.
 *
 * A correctness suite that goes red because another process is compiling is not
 * reporting on the code, and the previous session already spent an investigation
 * discovering exactly that about this file.
 *
 * The figure was then set wrong once before landing, which is worth leaving on the
 * record because it is the same error twice. 60 s was chosen against the ~25 s the
 * whole file measures idle across all three engines — the typical case. Hours later
 * the same LLVM build reached a load average of 130, and the n=300 cube exceeded
 * 60 s in Firefox. Sizing a bound to the typical case is precisely the mistake the
 * paragraph above describes.
 *
 * 120 s is ~5x the idle whole-file cost, and was verified against the host at that
 * 16x oversubscription rather than against a quiet one.
 */
vi.setConfig({ testTimeout: 120_000 })

/**
 * A bound a *single* cube settles within the shipped budget.
 *
 * Measured on this kernel: cube 0 of 8 finds a colouring of {1..300} in about 14 ms.
 * The number is not a property of the problem — colourings exist all the way to 7824
 * — but of plain depth-first search with no conflict analysis. See `TRIPLES_AT_300`
 * below and the package doc for where the wall now sits and why it moved.
 */
const SOLVABLE_N = 300

/** Triples with hypotenuse at most 300 — what the verifier reports having checked. */
const TRIPLES_AT_300 = 209

/**
 * A bound one cube cannot settle but eight can.
 *
 * This is the property the demo exists to show: at n = 400 a single searcher exhausts
 * its budget, and splitting the same problem across eight independent cubes finds an
 * answer. More participants, more reach — not merely the same work done faster.
 */
const CUBE_N = 400

/**
 * The shipped default, used here rather than a test-local number.
 *
 * If the default ever stopped being enough to settle the cubes below, that is a fact
 * about what a caller gets by taking the default — which is what these tests should
 * be measuring.
 */
const TEST_BUDGET = DEFAULT_BUDGET

/** Store the module and one shard input, ready to execute. */
async function setup(
  n: number,
  budget: number,
): Promise<{ store: MemoryBlockstore; moduleCid: CID; inputCid: CID }> {
  const store = new MemoryBlockstore()
  const moduleCid = await store.put(kernelBytes)
  const encoded = encodeCanonical(buildInput(n, budget))
  if (!encoded.ok) throw new Error(`input not encodable: ${JSON.stringify(encoded.error)}`)
  const inputCid = await store.put(encoded.bytes)
  return { store, moduleCid, inputCid }
}

/**
 * Run the guest against a hand-written host, bypassing `WasmExecutor`.
 *
 * `WasmExecutor` decodes the output before returning it, which is the right thing for
 * every other test here and the wrong thing for the two that are about the raw bytes:
 * the fixed-width frame and byte-identical determinism.
 */
async function runRaw(
  n: number,
  budget: number,
  partitionIndex: number,
  partitionCount: number,
): Promise<{ output: Uint8Array<ArrayBuffer>; memory: WebAssembly.Memory }> {
  const encoded = encodeCanonical(buildInput(n, budget))
  if (!encoded.ok) throw new Error('input not encodable')
  const input = encoded.bytes

  const state: { memory: WebAssembly.Memory | null; output: Uint8Array<ArrayBuffer> | null } = {
    memory: null,
    output: null,
  }
  let cursor = 0

  const instance = await WebAssembly.instantiate(await WebAssembly.compile(kernelBytes), {
    o2: {
      input_len: (): number => input.length,
      input_read: (ptr: number, len: number): number => {
        const view = new Uint8Array((state.memory as WebAssembly.Memory).buffer)
        const count = Math.max(0, Math.min(len, input.length - cursor))
        view.set(input.subarray(cursor, cursor + count), ptr)
        cursor += count
        return count
      },
      output_write: (ptr: number, len: number): void => {
        const view = new Uint8Array((state.memory as WebAssembly.Memory).buffer)
        state.output = view.slice(ptr, ptr + len)
      },
      partition: (): number => ((partitionIndex & 0xffff) << 16) | (partitionCount & 0xffff),
    },
  })

  const memory = instance.exports['memory']
  if (!(memory instanceof WebAssembly.Memory)) throw new Error('no memory export')
  state.memory = memory
  ;(instance.exports['run'] as () => void)()

  if (state.output === null) throw new Error('guest wrote no output')
  return { output: state.output, memory }
}

/**
 * The engine-portable part of an import/export descriptor: who it is, not what
 * shape it has.
 *
 * `WebAssembly.Module.imports`/`.exports` do not agree across engines. WebKit
 * implements the JS-API type-reflection member and returns an extra `type` —
 * `{parameters,results}` for a function, `{minimum,maximum,shared}` for a memory.
 * Chromium, Firefox and Node do not return it at all. Measured 2026-07-29 on one
 * host with a two-line synthetic module, all three engines under Playwright:
 *
 *   chromium  imports [kind, module, name]         exports [kind, name]
 *   firefox   imports [kind, module, name]         exports [kind, name]
 *   webkit    imports [kind, module, name, type]   exports [kind, name, type]
 *
 * (`WebAssembly.Function` is `undefined` on all three, so it is not the feature
 * probe it looks like — the divergence is on the descriptor objects only.)
 *
 * A `toEqual` against bare object literals therefore asserted "these four imports
 * AND this engine does not implement type reflection", which is two claims welded
 * together, and only the first is this test's business. Projecting to the identity
 * fields keeps the claim exactly as strong: the array is still compared whole, so
 * an extra, missing, renamed or reordered import still fails. WebKit's `type`
 * payload was inspected when this was found and describes the intended ABI
 * correctly — `[]→i32`, `[i32,i32]→i32`, `[i32,i32]→[]`, `[]→i32`, and a memory of
 * `minimum === maximum === 4` — so nothing about the module itself was in question.
 */
function descriptorIdentity<T extends { name: string; kind: string; module?: string }>(
  descriptor: T,
): { name: string; kind: string; module?: string } {
  return descriptor.module === undefined
    ? { name: descriptor.name, kind: descriptor.kind }
    : { module: descriptor.module, name: descriptor.name, kind: descriptor.kind }
}

describe('the committed module is a well-formed, minimally-privileged guest', () => {
  it('validates', () => {
    expect(WebAssembly.validate(kernelBytes)).toBe(true)
  })

  it('imports exactly the four host ABI functions and nothing else', async () => {
    // No allow-list, no opcode scan: the import object *is* the sandbox, and this is
    // the assertion that the module never asks for more than it will be given. Anything
    // extra — a clock, an RNG, a WASI call — would fail at `instantiate` anyway; the
    // value of checking here is that the failure is named at build time rather than
    // discovered on some node in the field.
    const module = await WebAssembly.compile(kernelBytes)
    expect(WebAssembly.Module.imports(module).map(descriptorIdentity)).toEqual([
      { module: 'o2', name: 'input_len', kind: 'function' },
      { module: 'o2', name: 'input_read', kind: 'function' },
      { module: 'o2', name: 'output_write', kind: 'function' },
      { module: 'o2', name: 'partition', kind: 'function' },
    ])
  })

  it('exports run and memory, as the executor requires', async () => {
    const module = await WebAssembly.compile(kernelBytes)
    expect(WebAssembly.Module.exports(module).map(descriptorIdentity)).toEqual([
      { name: 'memory', kind: 'memory' },
      { name: 'run', kind: 'function' },
    ])
  })

  it('pins memory at initial === maximum, so growth cannot succeed or fail per-host', async () => {
    const { memory } = await runRaw(30, TEST_BUDGET, 0, 1)
    // 4 pages, fixed. `memory.grow` failing differently on two hosts is one of the
    // nondeterminism sources the WASM spec lists; a memory that cannot grow at all
    // removes it rather than managing it.
    expect(memory.buffer.byteLength).toBe(4 * 65536)
    // The `memory.grow` *instruction* returns -1 on failure; the JS mirror of it
    // throws instead. Both say the same thing: the ceiling is real and already met.
    expect(() => memory.grow(1)).toThrow()
    expect(memory.buffer.byteLength).toBe(4 * 65536)
  })
})

describe('the guest emits one fixed-width strict-DAG-CBOR frame', () => {
  it('writes 1034 bytes with the same header whatever the outcome', async () => {
    const found = await runRaw(30, TEST_BUDGET, 0, 1)
    const unknown = await runRaw(300, 1000, 0, 1)

    for (const { output } of [found, unknown]) {
      expect(output.length).toBe(1034)
      expect([...output.subarray(0, 6)]).toEqual([
        0xa2, // map(2)
        0x61, 0x63, // text(1) "c"  — sorts before "s"
        0x59, 0x04, 0x00, // bytes(1024), the constant-width colouring field
      ])
      expect([...output.subarray(1030, 1033)]).toEqual([
        0x61, 0x73, // text(1) "s"
        0x41, // bytes(1) — a one-byte string, not a CBOR integer
      ])
    }
  })

  it('produces bytes the strict codec accepts and round-trips', () => {
    // The whole reason the status is a byte string: an integer below 24 must live in
    // the type byte, so a guest emitting one has to branch on magnitude and can
    // produce a non-minimal encoding that `decodeCanonical` rightly refuses.
    return runRaw(30, TEST_BUDGET, 0, 1).then(({ output }) => {
      const decoded = decodeCanonical(output)
      const partial = readPartial(decoded)
      expect(partial.status).toBe('found')
      expect(partial.bits.length).toBe(COLOURING_BYTES)

      // Re-encoding the decoded value reproduces the guest's bytes exactly, which is
      // what makes the guest's output already canonical rather than merely decodable.
      const reencoded = encodeCanonical(decoded)
      expect(reencoded.ok).toBe(true)
      if (reencoded.ok) expect([...reencoded.bytes]).toEqual([...output])
    })
  })
})

describe('a shard executed through WasmExecutor produces a verifiable colouring', () => {
  it('finds a colouring for n = 300 that the independent verifier accepts', async () => {
    const { store, moduleCid, inputCid } = await setup(SOLVABLE_N, TEST_BUDGET)
    const executor = new WasmExecutor({ nodeId: 'n1', blockstore: store })

    const outcome = await executor.execute({
      moduleCid,
      inputCid,
      partitionIndex: 0,
      partitionCount: 8,
    })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return

    const partial = readPartial(outcome.output)
    expect(partial.status).toBe('found')

    // The end-to-end claim of this package: a colouring produced by a WASM guest,
    // handed back through the executor, and accepted by a verifier that re-derived
    // every triple itself and trusted nothing the guest said.
    const verdict = verifyColouring(SOLVABLE_N, partial.bits)
    expect(verdict).toEqual({ ok: true, n: SOLVABLE_N, triplesChecked: TRIPLES_AT_300 })
  })

  it('reports "budget" rather than a wrong answer when the search does not finish', async () => {
    // A single undivided search at n = 400 runs out of budget. "I do not know" is a
    // real result and must stay distinguishable from "no colouring exists" —
    // conflating them would turn a shortage of compute into a false mathematical
    // claim. A small budget here so the test costs a millisecond rather than seventy.
    const { store, moduleCid, inputCid } = await setup(CUBE_N, 50_000)
    const executor = new WasmExecutor({ nodeId: 'n1', blockstore: store })
    const outcome = await executor.execute({
      moduleCid,
      inputCid,
      partitionIndex: 0,
      partitionCount: 1,
    })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return

    const partial = readPartial(outcome.output)
    expect(partial.status).toBe('budget')
    // Nothing is claimed, so nothing is carried.
    expect(partial.bits.every((byte) => byte === 0)).toBe(true)
  })

  it('answers "unknown" for a bound past MAX_N rather than overrunning fixed memory', async () => {
    // The guest's memory is `initial === maximum`, so there is no growing its way out
    // of an oversized input — the arrays simply have no room past MAX_N. What matters
    // is that the guard degrades to the same honest "I do not know" the search itself
    // returns, and never to a trap, a wrong colouring, or a claim of exhaustion.
    const { store, moduleCid, inputCid } = await setup(MAX_N + 1, TEST_BUDGET)
    const executor = new WasmExecutor({ nodeId: 'n1', blockstore: store })
    const outcome = await executor.execute({
      moduleCid,
      inputCid,
      partitionIndex: 0,
      partitionCount: 8,
    })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    const partial = readPartial(outcome.output)
    expect(partial.status).toBe('budget')
    expect(partial.bits.every((byte) => byte === 0)).toBe(true)
  })

  it('reports "exhausted" for a cube whose fixed values are already monochromatic', async () => {
    // 256 cubes fixes the eight most constrained values of {1..300}, which are
    // order[0..7] = 120, 60, 48, 84, 180, 240, 72, 96. Among them sits a genuine
    // triple: 72² + 96² = 5184 + 9216 = 14400 = 120². It occupies order positions 6,
    // 7 and 0, so cube index 0 — every fixed value colour 0 — makes it monochromatic
    // before the search starts. That cube provably contains no colouring, which is a
    // result, not a failure.
    const order = assignmentOrder(SOLVABLE_N)
    expect([order[0], order[6], order[7]]).toEqual([120, 72, 96])
    expect(72 * 72 + 96 * 96).toBe(120 * 120)

    const { store, moduleCid, inputCid } = await setup(SOLVABLE_N, TEST_BUDGET)
    const executor = new WasmExecutor({ nodeId: 'n1', blockstore: store })
    const outcome = await executor.execute({
      moduleCid,
      inputCid,
      partitionIndex: 0,
      partitionCount: 256,
    })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(readPartial(outcome.output).status).toBe('exhausted')
  })

  it('gives each cube the colours its index dictates, and different answers', async () => {
    // Cube index j fixes order[i] to bit i of j. Every cube therefore searches a
    // genuinely different region, and no two that succeed can return the same
    // colouring. This is what makes the partition a real decomposition rather than
    // eight copies of one search.
    const order = assignmentOrder(SOLVABLE_N)
    const { store, moduleCid, inputCid } = await setup(SOLVABLE_N, TEST_BUDGET)
    const executor = new WasmExecutor({ nodeId: 'n1', blockstore: store })

    const seen = new Set<string>()
    let found = 0
    for (let index = 0; index < 8; index++) {
      const outcome = await executor.execute({
        moduleCid,
        inputCid,
        partitionIndex: index,
        partitionCount: 8,
      })
      expect(outcome.ok).toBe(true)
      if (!outcome.ok) return
      const partial = readPartial(outcome.output)
      // Some of the eight run out of budget; that is expected and is not a failure.
      if (partial.status !== 'found') continue
      found++
      expect(verifyColouring(SOLVABLE_N, partial.bits).ok).toBe(true)
      // The three most constrained values carry the cube index, bit by bit.
      for (let bit = 0; bit < 3; bit++) {
        expect(colourOf(partial.bits, order[bit] as number)).toBe((index >> bit) & 1)
      }
      seen.add([...partial.bits].join(','))
    }
    expect(found).toBeGreaterThan(1)
    expect(seen.size).toBe(found)
  })
})

describe('more cubes reach further — the property the demo exists to show', () => {
  it('cannot settle n = 400 with one searcher but can with eight', async () => {
    // Criterion 1, made concrete. The same problem, the same budget per shard, the
    // same kernel: one participant returns "unknown", eight return an answer. That
    // only holds because the cube fixes the *most constrained* values — under
    // increasing-value order the first k values are nearly unconstrained (1 and 2 are
    // in no triple at all), so splitting the job further bought nothing.
    const { store, moduleCid, inputCid } = await setup(CUBE_N, TEST_BUDGET)
    const executor = new WasmExecutor({ nodeId: 'n1', blockstore: store })

    const alone = await executor.execute({
      moduleCid,
      inputCid,
      partitionIndex: 0,
      partitionCount: 1,
    })
    expect(alone.ok).toBe(true)
    if (!alone.ok) return
    expect(readPartial(alone.output).status).toBe('budget')

    let answer: Uint8Array | null = null
    for (let index = 0; index < 8 && answer === null; index++) {
      const outcome = await executor.execute({
        moduleCid,
        inputCid,
        partitionIndex: index,
        partitionCount: 8,
      })
      expect(outcome.ok).toBe(true)
      if (!outcome.ok) return
      const partial = readPartial(outcome.output)
      if (partial.status === 'found') answer = partial.bits
    }

    expect(answer).not.toBeNull()
    if (answer === null) return
    // And the extra reach is real reach: the verifier re-derives all 294 triples with
    // hypotenuse at most 400 and accepts.
    expect(verifyColouring(CUBE_N, answer)).toEqual({
      ok: true,
      n: CUBE_N,
      triplesChecked: 294,
    })
  })
})

describe('the same shard run twice is byte-identical', () => {
  it('produces the same output bytes on a repeat execution', async () => {
    // Redundant execution compares serialized outputs, so determinism here is not a
    // nicety — a guest that varied by one byte would be reported as node disagreement
    // and blamed on the network. Integer-only arithmetic is what buys this for free.
    const first = await runRaw(SOLVABLE_N, TEST_BUDGET, 5, 8)
    const second = await runRaw(SOLVABLE_N, TEST_BUDGET, 5, 8)
    expect([...first.output]).toEqual([...second.output])
  })

  it('gives two independent executors the same result CID', async () => {
    const { store, moduleCid, inputCid } = await setup(SOLVABLE_N, TEST_BUDGET)
    const task = { moduleCid, inputCid, partitionIndex: 3, partitionCount: 8 }
    const a = await new WasmExecutor({ nodeId: 'a', blockstore: store }).execute(task)
    const b = await new WasmExecutor({ nodeId: 'b', blockstore: store }).execute(task)
    expect(a.ok && b.ok).toBe(true)
    if (!a.ok || !b.ok) return
    const encodedA = encodeCanonical(a.output)
    const encodedB = encodeCanonical(b.output)
    expect(encodedA.ok && encodedB.ok).toBe(true)
    if (!encodedA.ok || !encodedB.ok) return
    expect([...encodedA.bytes]).toEqual([...encodedB.bytes])
  })
})

describe('the whole job, across cubes, at redundancy 2', () => {
  it('runs eight cubes on three nodes, agrees on every shard, and finds a colouring', async () => {
    const store = new MemoryBlockstore()
    const moduleCid = await store.put(kernelBytes)
    const input: CanonicalValue = buildInput(SOLVABLE_N, TEST_BUDGET)

    const executors: readonly Executor[] = [
      new WasmExecutor({ nodeId: 'n1', blockstore: store }),
      new WasmExecutor({ nodeId: 'n2', blockstore: store }),
      new WasmExecutor({ nodeId: 'n3', blockstore: store }),
    ]

    const submitted = await submitJob(
      {
        moduleCid,
        // Every cube gets the identical input block; only `partition()` differs.
        shards: Array.from({ length: 8 }, () => ({ value: input, label: 'public' as const })),
        executors,
        nodes: publicNodes(executors),
        redundancy: 2,
        onQuorumShortfall: 'runs-at-available-redundancy',
      },
      store,
      // CHURN-03 — this test asserts nothing about checkpointing.
      { checkpoints: 'checkpoints-nothing' },
    )

    expect(submitted.ok).toBe(true)
    if (!submitted.ok) return
    const job = submitted.job

    expect(job.complete).toBe(true)
    // Two replicas per shard, both useful, so the tax is exactly 2.
    expect(job.verificationMultiplier).toBe(2)

    for (const shard of job.shards) {
      expect(shard.verification.status).toBe('agreed')
      if (shard.verification.status !== 'agreed') continue
      expect(shard.verification.replicas).toBe(2)
      // Every replica of every shard has to be retrievable by CID afterwards.
      expect(await store.has(shard.verification.resultCid)).toBe(true)
    }

    // All eight shards ran against the same input CID — one block, eight cubes.
    const inputCids = new Set(job.shards.map((s) => s.inputCid.toString()))
    expect(inputCids.size).toBe(1)

    const answer = answerOf(job.shards)
    expect(answer).not.toBeNull()
    if (answer === null) return
    expect(verifyColouring(SOLVABLE_N, answer)).toEqual({
      ok: true,
      n: SOLVABLE_N,
      triplesChecked: TRIPLES_AT_300,
    })
  })

  it('returns null from answerOf when no shard found anything', async () => {
    const store = new MemoryBlockstore()
    const moduleCid = await store.put(kernelBytes)
    // Past the wall, with a budget small enough that every cube gives up quickly.
    const input: CanonicalValue = buildInput(CUBE_N, 20_000)
    const executors = [new WasmExecutor({ nodeId: 'n1', blockstore: store })]
    const submitted = await submitJob(
      {
        moduleCid,
        shards: Array.from({ length: 4 }, () => ({ value: input, label: 'public' as const })),
        executors,
        nodes: publicNodes(executors),
        redundancy: 1,
        onQuorumShortfall: 'runs-at-available-redundancy',
      },
      store,
      // CHURN-03 — this test asserts nothing about checkpointing.
      { checkpoints: 'checkpoints-nothing' },
    )
    expect(submitted.ok).toBe(true)
    if (!submitted.ok) return
    expect(submitted.job.complete).toBe(true)
    expect(answerOf(submitted.job.shards)).toBeNull()
  })
})

describe('readPartial refuses anything that is not a colouring partial', () => {
  it.each([
    ['a number', 7],
    ['a byte string', new Uint8Array([1, 2, 3])],
    ['an empty map', {}],
    ['a short colouring field', { c: new Uint8Array(16), s: new Uint8Array([1]) }],
    ['a status outside the three codes', { c: new Uint8Array(1024), s: new Uint8Array([9]) }],
    ['a status encoded as an integer', { c: new Uint8Array(1024), s: 1 }],
  ])('throws on %s', (_label, value) => {
    expect(() => readPartial(value as CanonicalValue)).toThrow('not a colouring partial')
  })
})
