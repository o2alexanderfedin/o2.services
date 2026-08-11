import { describe, expect, it } from 'vitest'
import { MemoryBlockstore } from '../blockstore/memory.ts'
import { encodeCanonical } from '../canonical/encode.ts'
import { submitJob } from '../job/submit.ts'
import { publicNodes } from '../sovereignty.ts'
import {
  MODULE_ECHOES_INPUT,
  MODULE_IMPORTS_CLOCK,
  MODULE_NO_OUTPUT,
  MODULE_OUTPUT_NEGATIVE_LENGTH,
  MODULE_OUTPUT_OVER_CAP,
  MODULE_OUTPUT_THEN_OVER_CAP,
  MODULE_OVER_CAP_THEN_OUTPUT,
  MODULE_TRAPS,
  MODULE_COUNTS_INPUT_BYTES,
  MODULE_WRITES_PARTITION,
} from './fixtures.ts'
import { WasmExecutor } from './wasm.ts'

/** The fixture emits its partition index as a 4-byte little-endian byte string. */
function partitionOf(output: unknown): number {
  const p = (output as { p?: unknown }).p
  if (!(p instanceof Uint8Array) || p.length !== 4) {
    throw new Error(`expected a 4-byte partition field, got ${JSON.stringify(output)}`)
  }
  return new DataView(p.buffer, p.byteOffset, 4).getUint32(0, true)
}

/** Store a module and an input, ready to execute. */
async function setup(moduleBytes: Uint8Array<ArrayBuffer>, input: unknown = {}) {
  const store = new MemoryBlockstore()
  const moduleCid = await store.put(moduleBytes)
  const encoded = encodeCanonical(input as never)
  if (!encoded.ok) throw new Error('encode failed')
  const inputCid = await store.put(encoded.bytes)
  return { store, moduleCid, inputCid }
}

describe('fixtures are genuinely valid WASM', () => {
  // Proves the hand-assembly is correct according to V8.
  it.each([
    ['writes-partition', MODULE_WRITES_PARTITION],
    ['counts-input-bytes', MODULE_COUNTS_INPUT_BYTES],
    ['echoes-input', MODULE_ECHOES_INPUT],
    ['no-output', MODULE_NO_OUTPUT],
    ['traps', MODULE_TRAPS],
    ['imports-clock', MODULE_IMPORTS_CLOCK],
  ])('%s validates', (_name, bytes) => {
    expect(WebAssembly.validate(bytes)).toBe(true)
  })
})

describe('WasmExecutor — the four-function host ABI (DET-06)', () => {
  it('runs a module and decodes its declared output', async () => {
    const { store, moduleCid, inputCid } = await setup(MODULE_WRITES_PARTITION)
    const exec = new WasmExecutor({ nodeId: 'n1', blockstore: store })
    const out = await exec.execute({ moduleCid, inputCid, partitionIndex: 3, partitionCount: 8 })
    expect(out.ok).toBe(true)
    if (out.ok) expect(partitionOf(out.output)).toBe(3)
  })

  it('passes the partition index through to the guest for every shard', async () => {
    const { store, moduleCid, inputCid } = await setup(MODULE_WRITES_PARTITION)
    const exec = new WasmExecutor({ nodeId: 'n1', blockstore: store })
    for (const index of [0, 1, 5, 200]) {
      const out = await exec.execute({ moduleCid, inputCid, partitionIndex: index, partitionCount: 256 })
      expect(out.ok).toBe(true)
      if (out.ok) expect(partitionOf(out.output)).toBe(index)
    }
  })

  it('round-trips input through input_len + input_read', async () => {
    const value = { hello: 'world', n: 42 }
    const { store, moduleCid, inputCid } = await setup(MODULE_ECHOES_INPUT, value)
    const exec = new WasmExecutor({ nodeId: 'n1', blockstore: store })
    const out = await exec.execute({ moduleCid, inputCid, partitionIndex: 0, partitionCount: 1 })
    expect(out.ok).toBe(true)
    if (out.ok) expect(out.output).toEqual(value)
  })
})

describe('WasmExecutor — the import object is the sandbox', () => {
  it('refuses a module importing a clock, with no allow-list code involved', async () => {
    // The host supplies four functions. Anything else fails at instantiation,
    // enforced by the runtime rather than by a hand-written scanner.
    const { store, moduleCid, inputCid } = await setup(MODULE_IMPORTS_CLOCK)
    const exec = new WasmExecutor({ nodeId: 'n1', blockstore: store })
    const out = await exec.execute({ moduleCid, inputCid, partitionIndex: 0, partitionCount: 1 })
    expect(out.ok).toBe(false)
    if (!out.ok) {
      expect(out.reason).toContain('instantiation failed')
      // The runtime names the offending import for us.
      expect(out.reason).toContain('env')
    }
  })
})

/**
 * A refused write is an event the host must report, not one it may forget.
 *
 * The refusals all sat as bare `return`s leaving the output slot untouched, so a
 * module that wrote nothing the host would take was reported as one that never
 * wrote at all — and, worse, a module that wrote something acceptable and then
 * something refused had the earlier value returned as its answer.
 *
 * The red-maker for this block is the single `if (sink.state === 'refused') return`
 * guard in `output_write`: without it the mirror case below returns `ok: true` with
 * the small write laundering the refusal. That substitutes for the brief's proposed
 * `sink.bytes = null` red-maker, which no longer exists because the field it named
 * is gone.
 *
 * `CAP` is 8 rather than the shipped 1 MiB so the fixtures stay inside their single
 * 64 KiB page: past that the host's *bounds* check refuses first, which is a
 * different branch and would make these cases prove the wrong thing.
 */
describe('WasmExecutor — a refused output is reported as refused', () => {
  const CAP = 8

  /** Run `bytes` against an executor whose output cap is `CAP`. */
  async function runCapped(bytes: Uint8Array<ArrayBuffer>) {
    const { store, moduleCid, inputCid } = await setup(bytes)
    const exec = new WasmExecutor({ nodeId: 'n1', blockstore: store, maxOutputBytes: CAP })
    return await exec.execute({ moduleCid, inputCid, partitionIndex: 0, partitionCount: 1 })
  }

  it('reports an over-cap-only write as over-cap, naming the cap and the length', async () => {
    const out = await runCapped(MODULE_OUTPUT_OVER_CAP)
    expect(out.ok).toBe(false)
    if (!out.ok) {
      expect(out.reason).toContain('64')
      expect(out.reason).toContain(`${CAP}-byte cap`)
      // The false report this replaces. The module wrote; the host refused.
      expect(out.reason).not.toBe('module produced no output')
    }
  })

  it('never returns a stale earlier write once a later one is refused', async () => {
    const out = await runCapped(MODULE_OUTPUT_THEN_OVER_CAP)
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.reason).toContain(`${CAP}-byte cap`)
  })

  it('cannot have a refusal laundered by a smaller write that follows it', async () => {
    const out = await runCapped(MODULE_OVER_CAP_THEN_OUTPUT)
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.reason).toContain('output-too-large')
  })

  it('tells a malformed negative length apart from the policy bound', async () => {
    const out = await runCapped(MODULE_OUTPUT_NEGATIVE_LENGTH)
    expect(out.ok).toBe(false)
    if (!out.ok) {
      expect(out.reason).toContain('-1')
      expect(out.reason).not.toContain('output-too-large')
    }
  })

  it('shares the sibling executor’s term, so one grep finds both', async () => {
    // `packages/aot/src/wasi-executor.ts` reports `output-too-large` for the same
    // condition. The term is shared deliberately; the code is not, because the two
    // executors have different ABIs and different failure types.
    const out = await runCapped(MODULE_OUTPUT_OVER_CAP)
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.reason).toContain('output-too-large')
  })
})

describe('WasmExecutor — failure modes are reported, never thrown', () => {
  it('reports a module that writes no output', async () => {
    const { store, moduleCid, inputCid } = await setup(MODULE_NO_OUTPUT)
    const exec = new WasmExecutor({ nodeId: 'n1', blockstore: store })
    const out = await exec.execute({ moduleCid, inputCid, partitionIndex: 0, partitionCount: 1 })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.reason).toBe('module produced no output')
  })

  it('reports a trap instead of propagating it', async () => {
    const { store, moduleCid, inputCid } = await setup(MODULE_TRAPS)
    const exec = new WasmExecutor({ nodeId: 'n1', blockstore: store })
    const out = await exec.execute({ moduleCid, inputCid, partitionIndex: 0, partitionCount: 1 })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.reason).toContain('trap')
  })

  it('reports garbage bytes as a failed instantiation rather than crashing', async () => {
    const store = new MemoryBlockstore()
    const moduleCid = await store.put(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))
    const encoded = encodeCanonical({})
    if (!encoded.ok) throw new Error('encode failed')
    const inputCid = await store.put(encoded.bytes)
    const exec = new WasmExecutor({ nodeId: 'n1', blockstore: store })
    const out = await exec.execute({ moduleCid, inputCid, partitionIndex: 0, partitionCount: 1 })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.reason).toContain('instantiation failed')
  })

  it('reports a missing module block', async () => {
    const { store, inputCid } = await setup(MODULE_NO_OUTPUT)
    const absent = await new MemoryBlockstore().put(new Uint8Array([9, 9, 9]))
    const exec = new WasmExecutor({ nodeId: 'n1', blockstore: store })
    const out = await exec.execute({ moduleCid: absent, inputCid, partitionIndex: 0, partitionCount: 1 })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.reason).toContain('module block missing')
  })

  it('refuses a partition count beyond the packed ABI range', async () => {
    const { store, moduleCid, inputCid } = await setup(MODULE_NO_OUTPUT)
    const exec = new WasmExecutor({ nodeId: 'n1', blockstore: store })
    const out = await exec.execute({ moduleCid, inputCid, partitionIndex: 0, partitionCount: 70000 })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.reason).toContain('partitionCount exceeds')
  })
})

describe('end to end — a real WASM job at R=2', () => {
  it('shards, executes redundantly, verifies, and returns result CIDs', async () => {
    const store = new MemoryBlockstore()
    const moduleCid = await store.put(MODULE_WRITES_PARTITION)

    const executors = [
      new WasmExecutor({ nodeId: 'n1', blockstore: store }),
      new WasmExecutor({ nodeId: 'n2', blockstore: store }),
      new WasmExecutor({ nodeId: 'n3', blockstore: store }),
    ]
    const r = await submitJob(
      {
        moduleCid,
        shards: [{ a: 1 }, { a: 2 }, { a: 3 }, { a: 4 }].map((value) => ({ value, label: 'public' as const })),
        executors,
        nodes: publicNodes(executors),
        redundancy: 2,
        onQuorumShortfall: 'runs-at-available-redundancy',
      },
      store,
      // CHURN-03 — this test asserts nothing about checkpointing.
      { checkpoints: 'checkpoints-nothing' },
    )

    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.job.complete).toBe(true)
    expect(r.job.verificationMultiplier).toBe(2)

    for (const [i, shard] of r.job.shards.entries()) {
      expect(shard.verification.status).toBe('agreed')
      if (shard.verification.status === 'agreed') {
        expect(shard.verification.replicas).toBe(2)
        expect(partitionOf(shard.verification.output)).toBe(i)
        expect(await store.has(shard.verification.resultCid)).toBe(true)
      }
    }
  })
})
