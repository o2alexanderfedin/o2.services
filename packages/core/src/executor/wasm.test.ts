import { describe, expect, it } from 'vitest'
import { MemoryBlockstore } from '../blockstore/memory.ts'
import { encodeCanonical } from '../canonical/encode.ts'
import { submitJob } from '../job/submit.ts'
import {
  MODULE_ECHOES_INPUT,
  MODULE_GROWABLE_MEMORY,
  MODULE_NO_OUTPUT,
  MODULE_TRAPS,
  MODULE_USES_SIMD,
  MODULE_WRITES_PARTITION,
} from './fixtures.ts'
import { WasmExecutor, publishModule } from './wasm.ts'

/** The fixture emits its partition index as a 4-byte little-endian byte string. */
function partitionOf(output: unknown): number {
  const p = (output as { p?: unknown }).p
  if (!(p instanceof Uint8Array) || p.length !== 4) {
    throw new Error(`expected a 4-byte partition field, got ${JSON.stringify(output)}`)
  }
  return new DataView(p.buffer, p.byteOffset, 4).getUint32(0, true)
}

describe('fixtures are genuinely valid WASM', () => {
  // This is the check that matters: it proves the hand-assembly is correct
  // according to V8, not merely acceptable to our own admission gate.
  it.each([
    ['writes-partition', MODULE_WRITES_PARTITION],
    ['echoes-input', MODULE_ECHOES_INPUT],
    ['no-output', MODULE_NO_OUTPUT],
    ['traps', MODULE_TRAPS],
    ['growable-memory', MODULE_GROWABLE_MEMORY],
  ])('%s validates', (_name, bytes) => {
    expect(WebAssembly.validate(bytes)).toBe(true)
  })
})

describe('publishModule — admission is enforced at publish', () => {
  it('stores an admissible module and returns its CID', async () => {
    const store = new MemoryBlockstore()
    const r = await publishModule(MODULE_WRITES_PARTITION, store)
    expect(r.ok).toBe(true)
    if (r.ok) expect(await store.has(r.cid)).toBe(true)
  })

  it('refuses a module using SIMD', async () => {
    const r = await publishModule(MODULE_USES_SIMD, new MemoryBlockstore())
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('simd')
  })

  it('refuses a module with growable memory', async () => {
    const r = await publishModule(MODULE_GROWABLE_MEMORY, new MemoryBlockstore())
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('unbounded-memory')
  })
})

describe('WasmExecutor — the four-function host ABI (DET-06)', () => {
  it('runs a module and decodes its declared output', async () => {
    const store = new MemoryBlockstore()
    const mod = await publishModule(MODULE_WRITES_PARTITION, store)
    expect(mod.ok).toBe(true)
    if (!mod.ok) return
    const input = encodeCanonical({ ignored: true })
    expect(input.ok).toBe(true)
    if (!input.ok) return
    const inputCid = await store.put(input.bytes)

    const exec = new WasmExecutor({ nodeId: 'n1', blockstore: store })
    const out = await exec.execute({
      moduleCid: mod.cid,
      inputCid,
      partitionIndex: 3,
      partitionCount: 8,
    })
    expect(out.ok).toBe(true)
    if (out.ok) expect(partitionOf(out.output)).toBe(3)
  })

  it('passes the partition index through to the guest for every shard', async () => {
    const store = new MemoryBlockstore()
    const mod = await publishModule(MODULE_WRITES_PARTITION, store)
    if (!mod.ok) throw new Error('publish failed')
    const input = encodeCanonical({})
    if (!input.ok) throw new Error('encode failed')
    const inputCid = await store.put(input.bytes)
    const exec = new WasmExecutor({ nodeId: 'n1', blockstore: store })

    for (const index of [0, 1, 5, 200]) {
      const out = await exec.execute({
        moduleCid: mod.cid,
        inputCid,
        partitionIndex: index,
        partitionCount: 256,
      })
      expect(out.ok).toBe(true)
      if (out.ok) expect(partitionOf(out.output)).toBe(index)
    }
  })

  it('round-trips input through input_len + input_read', async () => {
    const store = new MemoryBlockstore()
    const mod = await publishModule(MODULE_ECHOES_INPUT, store)
    if (!mod.ok) throw new Error('publish failed')
    const value = { hello: 'world', n: 42 }
    const input = encodeCanonical(value)
    if (!input.ok) throw new Error('encode failed')
    const inputCid = await store.put(input.bytes)

    const exec = new WasmExecutor({ nodeId: 'n1', blockstore: store })
    const out = await exec.execute({
      moduleCid: mod.cid,
      inputCid,
      partitionIndex: 0,
      partitionCount: 1,
    })
    expect(out.ok).toBe(true)
    if (out.ok) expect(out.output).toEqual(value)
  })

  it('re-validates the module before instantiation (DET-02)', async () => {
    const store = new MemoryBlockstore()
    // Bypass publishModule entirely — simulate a module that was stored by a node
    // that skipped or lied about publish-time validation.
    const cid = await store.put(MODULE_USES_SIMD)
    const input = encodeCanonical({})
    if (!input.ok) throw new Error('encode failed')
    const inputCid = await store.put(input.bytes)

    const exec = new WasmExecutor({ nodeId: 'n1', blockstore: store })
    const out = await exec.execute({ moduleCid: cid, inputCid, partitionIndex: 0, partitionCount: 1 })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.reason).toContain('admission gate')
  })
})

describe('WasmExecutor — failure modes are reported, never thrown', () => {
  const setup = async (moduleBytes: Uint8Array<ArrayBuffer>) => {
    const store = new MemoryBlockstore()
    const cid = await store.put(moduleBytes)
    const input = encodeCanonical({})
    if (!input.ok) throw new Error('encode failed')
    const inputCid = await store.put(input.bytes)
    return { store, cid, inputCid }
  }

  it('reports a module that writes no output', async () => {
    const { store, cid, inputCid } = await setup(MODULE_NO_OUTPUT)
    const exec = new WasmExecutor({ nodeId: 'n1', blockstore: store })
    const out = await exec.execute({ moduleCid: cid, inputCid, partitionIndex: 0, partitionCount: 1 })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.reason).toBe('module produced no output')
  })

  it('reports a trap instead of propagating it', async () => {
    const { store, cid, inputCid } = await setup(MODULE_TRAPS)
    const exec = new WasmExecutor({ nodeId: 'n1', blockstore: store })
    const out = await exec.execute({ moduleCid: cid, inputCid, partitionIndex: 0, partitionCount: 1 })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.reason).toContain('trap')
  })

  it('reports a missing module block', async () => {
    const { store, inputCid } = await setup(MODULE_NO_OUTPUT)
    const absent = await new MemoryBlockstore().put(new Uint8Array([9, 9, 9]))
    const exec = new WasmExecutor({ nodeId: 'n1', blockstore: store })
    const out = await exec.execute({
      moduleCid: absent,
      inputCid,
      partitionIndex: 0,
      partitionCount: 1,
    })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.reason).toContain('module block missing')
  })

  it('refuses a partition count beyond the packed ABI range', async () => {
    const { store, cid, inputCid } = await setup(MODULE_NO_OUTPUT)
    const exec = new WasmExecutor({ nodeId: 'n1', blockstore: store })
    const out = await exec.execute({
      moduleCid: cid,
      inputCid,
      partitionIndex: 0,
      partitionCount: 70000,
    })
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.reason).toContain('partitionCount exceeds')
  })
})

describe('end to end — a real WASM job at R=2', () => {
  it('shards, executes redundantly, verifies, and returns result CIDs', async () => {
    const store = new MemoryBlockstore()
    const mod = await publishModule(MODULE_WRITES_PARTITION, store)
    expect(mod.ok).toBe(true)
    if (!mod.ok) return

    const r = await submitJob(
      {
        moduleCid: mod.cid,
        shards: [{ a: 1 }, { a: 2 }, { a: 3 }, { a: 4 }],
        executors: [
          new WasmExecutor({ nodeId: 'n1', blockstore: store }),
          new WasmExecutor({ nodeId: 'n2', blockstore: store }),
          new WasmExecutor({ nodeId: 'n3', blockstore: store }),
        ],
        redundancy: 2,
      },
      store,
    )

    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.job.complete).toBe(true)
    expect(r.job.verificationMultiplier).toBe(2)

    // Every shard agreed, and its output carries that shard's own index — so the
    // partition genuinely reached the guest rather than being assumed.
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
