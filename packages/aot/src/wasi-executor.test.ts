import { Fd, WASI } from '@bjorn3/browser_wasi_shim'
import { encodeCanonical, MemoryBlockstore, submitJob } from '@o2/core'
import type { CanonicalValue, Task } from '@o2/core'
import type { CID } from 'multiformats/cid'
import { describe, expect, it, vi } from 'vitest'
import {
  wasiEcho,
  wasiFail,
  wasiFdstat,
  wasiNoMemory,
  wasiNoStart,
  wasiProbe,
  wasiShard,
  wasiThreadSpawn,
} from './fixtures/wasi-fixtures.ts'
import {
  FIXED_MONOTONIC_NANOS,
  FIXED_REALTIME_NANOS,
  PINNED_WASI_FUNCTIONS,
  pinnedWasiImports,
  seededStream,
  shardArgv,
  taskSeed,
  WASI_ARGV0,
  WASI_ENV,
  WASI_NAMESPACE,
  WasiExecutor,
} from './wasi-executor.ts'
import type { WasiFailure, WasiRunOutcome } from './wasi-executor.ts'

/**
 * A translated artifact running on the fabric — AOT-04.
 *
 * The property under test is not "WASI works". It is that a program which knows
 * nothing about this project — no `o2.*` imports, no `run` export, an entry point of
 * `_start` and a world of stdin, stdout and argv — produces a result the fabric can
 * content-address, replicate, and compare, *and that two nodes running it agree*.
 * Almost every test below is really about that last clause.
 */

// ---- harness -----------------------------------------------------------------

async function store(
  moduleBytes: Uint8Array<ArrayBuffer>,
  input: CanonicalValue = {},
): Promise<{ blockstore: MemoryBlockstore; moduleCid: CID; inputCid: CID }> {
  const blockstore = new MemoryBlockstore()
  const moduleCid = await blockstore.put(moduleBytes)
  const encoded = encodeCanonical(input)
  if (!encoded.ok) throw new Error(`fixture input does not encode: ${JSON.stringify(encoded.error)}`)
  const inputCid = await blockstore.put(encoded.bytes)
  return { blockstore, moduleCid, inputCid }
}

/** Store an input block that is *not* canonical DAG-CBOR. */
async function storeRaw(
  moduleBytes: Uint8Array<ArrayBuffer>,
  raw: Uint8Array<ArrayBuffer>,
): Promise<{ blockstore: MemoryBlockstore; moduleCid: CID; inputCid: CID }> {
  const blockstore = new MemoryBlockstore()
  const moduleCid = await blockstore.put(moduleBytes)
  const inputCid = await blockstore.put(raw)
  return { blockstore, moduleCid, inputCid }
}

function task(moduleCid: CID, inputCid: CID, index = 0, count = 1): Task {
  return { moduleCid, inputCid, partitionIndex: index, partitionCount: count }
}

/** Run one fixture end to end and hand back the structured outcome. */
async function run(
  moduleBytes: Uint8Array<ArrayBuffer>,
  input: CanonicalValue = {},
  index = 0,
  count = 1,
  maxOutputBytes?: number,
): Promise<WasiRunOutcome> {
  const { blockstore, moduleCid, inputCid } = await store(moduleBytes, input)
  const executor = new WasiExecutor({
    nodeId: 'n1',
    blockstore,
    ...(maxOutputBytes === undefined ? {} : { maxOutputBytes }),
  })
  return executor.run(task(moduleCid, inputCid, index, count))
}

function failureOf(outcome: WasiRunOutcome): WasiFailure {
  if (outcome.ok) throw new Error(`expected a failure, got ${JSON.stringify(outcome.value)}`)
  return outcome.failure
}

function bytesOf(outcome: WasiRunOutcome): Uint8Array {
  if (!outcome.ok) throw new Error(`expected success, got ${JSON.stringify(outcome.failure)}`)
  const value = outcome.value
  if (!(value instanceof Uint8Array)) {
    throw new Error(`expected a byte string, got ${JSON.stringify(value)}`)
  }
  return value
}

const text = (bytes: Uint8Array): string => new TextDecoder().decode(bytes)

/** `WebAssembly.ExportValue` narrows to `Function`, which is not callable. */
function isNiladic(value: WebAssembly.ExportValue | undefined): value is () => unknown {
  return typeof value === 'function'
}

// ---- the fixtures are what they claim to be ----------------------------------

describe('the fixtures really are WASI command modules', () => {
  const ALL: readonly (readonly [string, Uint8Array<ArrayBuffer>])[] = [
    ['wasi-echo', wasiEcho],
    ['wasi-shard', wasiShard],
    ['wasi-probe', wasiProbe],
    ['wasi-fail', wasiFail],
    ['wasi-fdstat', wasiFdstat],
    ['wasi-no-start', wasiNoStart],
    ['wasi-no-memory', wasiNoMemory],
    ['wasi-thread-spawn', wasiThreadSpawn],
  ]

  it.each(ALL)('%s is valid WASM according to V8', (_name, bytes) => {
    // The `.wat` is hand-written; this is what proves it assembles to something an
    // engine accepts, rather than merely to something wabt was willing to emit.
    expect(WebAssembly.validate(bytes)).toBe(true)
  })

  it.each(ALL)('%s imports from no namespace but wasi_snapshot_preview1', async (_name, bytes) => {
    // If a fixture ever reached for `env` the executor would refuse it, and the
    // refusal would look like a bug in the executor rather than in the fixture.
    const namespaces = new Set(
      WebAssembly.Module.imports(await WebAssembly.compile(bytes)).map((entry) => entry.module),
    )
    expect([...namespaces].filter((ns) => ns !== WASI_NAMESPACE)).toEqual([])
  })

  it('the working fixtures export exactly memory and _start, as elfconv output does', async () => {
    for (const bytes of [wasiEcho, wasiShard, wasiProbe, wasiFail, wasiFdstat]) {
      const names = WebAssembly.Module.exports(await WebAssembly.compile(bytes))
        .map((entry) => entry.name)
        .sort()
      // Verified against a real `aarch64-wasi32` artifact: exports are exactly
      // `memory` and `_start`. A fixture with a richer export surface would let the
      // executor lean on something translated output does not have.
      expect(names).toEqual(['_start', 'memory'])
    }
  })
})

// ---- input in, output out ----------------------------------------------------

describe("the task's input reaches the guest and its output comes back decoded", () => {
  it('round-trips a structured value through stdin and stdout', async () => {
    const value = { hello: 'world', n: 42, xs: [1, 2, 3] }
    const outcome = await run(wasiEcho, value)
    expect(outcome.ok).toBe(true)
    if (outcome.ok) expect(outcome.value).toEqual(value)
  })

  it.each([
    ['an integer', 7],
    ['a string', 'a translated artifact'],
    ['a byte string', new Uint8Array([0, 1, 254, 255])],
    ['a nested map', { a: { b: { c: [true, false, null] } } }],
    ['an empty map', {}],
  ])('round-trips %s', async (_label, value) => {
    // The echo guest is the identity function, so anything the codec can carry must
    // survive the trip byte for byte. A failure here is the stdio plumbing, not the
    // program.
    const outcome = await run(wasiEcho, value as CanonicalValue)
    expect(outcome.ok).toBe(true)
    if (outcome.ok) expect(outcome.value).toEqual(value)
  })

  it('delivers the whole input block, not a first chunk of it', async () => {
    // A guest that read once and stopped would still pass the round-trip above for a
    // small value. Force a payload well past any plausible single-read boundary and
    // require every byte to have been consumed.
    const big = new Uint8Array(40_000)
    for (let i = 0; i < big.length; i++) big[i] = (i * 31) & 0xff
    const outcome = await run(wasiEcho, big)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.value).toEqual(big)
    expect(outcome.stdinConsumed).toBe(outcome.inputBytes)
  })

  it('reports fuel on the same basis as WasmExecutor, so the two are comparable', async () => {
    const { blockstore, moduleCid, inputCid } = await store(wasiEcho, { a: 1 })
    const executor = new WasiExecutor({ nodeId: 'n1', blockstore })
    const outcome = await executor.execute(task(moduleCid, inputCid))
    expect(outcome.ok).toBe(true)
    // Input block plus produced output — the echo guest reproduces its input, so
    // both halves are the same size.
    const inputBytes = await blockstore.get(inputCid)
    if (outcome.ok) expect(outcome.fuelUsed).toBe((inputBytes?.length ?? 0) * 2)
  })
})

// ---- the shard reaches the guest as argv -------------------------------------

describe('the shard reaches the guest as argv, with no bespoke ABI', () => {
  it('hands the guest program name, index and count', async () => {
    const outcome = await run(wasiShard, {}, 3, 8)
    // Hardcoded, not computed from `shardArgv`: an expectation derived from the
    // implementation only proves the implementation agrees with itself. This is the
    // exact byte sequence a translated `main(argc, argv)` will see.
    expect([...bytesOf(outcome)]).toEqual([
      0x6f, 0x32, 0x2d, 0x74, 0x61, 0x73, 0x6b, 0x00, // "o2-task\0"
      0x33, 0x00, //                                     "3\0"
      0x38, 0x00, //                                     "8\0"
    ])
  })

  it('gives every shard of a job a different argv', async () => {
    const seen = new Set<string>()
    for (let index = 0; index < 4; index++) {
      seen.add(text(bytesOf(await run(wasiShard, {}, index, 4))))
    }
    expect(seen.size).toBe(4)
    expect(seen).toContain(`${WASI_ARGV0} 0 4 `)
    expect(seen).toContain(`${WASI_ARGV0} 3 4 `)
  })

  it('keeps argv ASCII, because the shim sizes it in UTF-16 and fills it in UTF-8', () => {
    // `args_sizes_get` adds `arg.length + 1` per argument — UTF-16 code units — while
    // `args_get` writes UTF-8 bytes. Any argument outside ASCII makes the shim
    // under-report the buffer and overwrite whatever follows it in guest memory.
    // Digits and a hyphen cannot reach that.
    for (const arg of shardArgv(1234, 5678)) {
      expect(arg).toMatch(/^[\x21-\x7e]+$/)
    }
    expect(shardArgv(3, 8)).toEqual(['o2-task', '3', '8'])
  })

  it('refuses a shard that argv could only state as a lie', async () => {
    for (const [index, count] of [
      [7, 3], //     index past the end
      [0, 0], //     no shards at all
      [-1, 4], //    negative index
      [1.5, 4], //   not a whole shard
      [0, 2 ** 60], // not a safe integer, so String() would round it
    ] as const) {
      const failure = failureOf(await run(wasiShard, {}, index, count))
      expect(failure.kind).toBe('invalid-shard')
    }
  })
})

// ---- determinism -------------------------------------------------------------

/**
 * The realtime clock every node must report, as the little-endian u64 a guest reads
 * out of memory. Hardcoded rather than derived from `FIXED_REALTIME_NANOS`, so that
 * changing the constant is a deliberate act that breaks a test naming the old value
 * — the value is part of the fabric's observable ABI, and two nodes on different
 * versions of it would disagree on every task that reads a clock.
 */
const FIXED_REALTIME_LE = [0x00, 0x00, 0x8a, 0xb9, 0x35, 0x9a, 0xe5, 0x15]
const ZERO_U64 = [0, 0, 0, 0, 0, 0, 0, 0]

describe('the same task twice produces the same bytes', () => {
  it('is byte-identical for the echo guest', async () => {
    const value = { work: 'map', keys: ['a', 'b'], n: 3 }
    const first = await run(wasiEcho, value)
    const second = await run(wasiEcho, value)
    expect(first.ok && second.ok).toBe(true)
    if (!first.ok || !second.ok) return
    // Compared as encoded bytes rather than as values: `toEqual` on two decoded
    // objects would pass for two results that serialise differently, and it is the
    // serialisation that the fabric hashes and compares across nodes.
    const a = encodeCanonical(first.value)
    const b = encodeCanonical(second.value)
    expect(a.ok && b.ok).toBe(true)
    if (a.ok && b.ok) expect([...a.bytes]).toEqual([...b.bytes])
  })

  it('is byte-identical for a guest that asks the host every awkward question', async () => {
    // The probe reads both clocks twice and draws entropy twice. If any of that
    // reached the platform, these two runs would differ.
    const first = bytesOf(await run(wasiProbe, { s: 1 }, 2, 4))
    const second = bytesOf(await run(wasiProbe, { s: 1 }, 2, 4))
    expect([...first]).toEqual([...second])
    expect(first.length).toBe(48)
  })
})

describe('the clock is fixed', () => {
  it('returns the same realtime value to two reads in one execution', async () => {
    const probe = bytesOf(await run(wasiProbe))
    expect([...probe.slice(0, 8)]).toEqual([...probe.slice(8, 16)])
  })

  it('returns the same monotonic value to two reads in one execution', async () => {
    // A monotonic clock that advanced would make every interval a guest measures a
    // function of how fast this particular machine is.
    const probe = bytesOf(await run(wasiProbe))
    expect([...probe.slice(16, 24)]).toEqual([...probe.slice(24, 32)])
  })

  it('returns the same value across two separate executions', async () => {
    const first = bytesOf(await run(wasiProbe))
    const second = bytesOf(await run(wasiProbe))
    expect([...first.slice(0, 16)]).toEqual([...second.slice(0, 16)])
  })

  it('reports the published epoch exactly, and nothing near the wall clock', async () => {
    const probe = bytesOf(await run(wasiProbe))
    expect([...probe.slice(0, 8)]).toEqual(FIXED_REALTIME_LE)
    expect([...probe.slice(16, 24)]).toEqual(ZERO_U64)
    // …and the literal above really is the constant the executor publishes, so a
    // future edit cannot satisfy one and break the other silently.
    const expected = new DataView(new ArrayBuffer(8))
    expected.setBigUint64(0, FIXED_REALTIME_NANOS, true)
    expect([...new Uint8Array(expected.buffer)]).toEqual(FIXED_REALTIME_LE)
    expect(FIXED_MONOTONIC_NANOS).toBe(0n)
  })

  it('is not the shim doing this — the unpinned shim returns the wall clock', async () => {
    /**
     * The planted violation for the test above.
     *
     * Everything else in this block would pass just as well against a shim that
     * happened to return 2020-01-01 on its own. Run the same fixture with the shim's
     * *own* imports and require the answer to be different: that is what makes the
     * hardcoded vector evidence about this executor rather than about the dependency.
     */
    const collected: Uint8Array[] = []
    class Collect extends Fd {
      override fd_write(data: Uint8Array): { ret: number; nwritten: number } {
        collected.push(data)
        return { ret: 0, nwritten: data.length }
      }
    }
    const wasi = new WASI(['p'], [], [new Collect(), new Collect(), new Collect()], {
      debug: false,
    })
    const module = await WebAssembly.compile(wasiProbe)
    // The shim's surface, verbatim — no pinning. This is the mutation.
    const instance = await WebAssembly.instantiate(module, {
      [WASI_NAMESPACE]: { ...wasi.wasiImport },
    })
    const memory = instance.exports['memory']
    const start = instance.exports['_start']
    if (!(memory instanceof WebAssembly.Memory) || !isNiladic(start)) {
      throw new Error('probe fixture is not a command module')
    }
    wasi.start({ exports: { memory, _start: start } })

    const raw = collected.flatMap((chunk) => [...chunk])
    // Skip the 2-byte CBOR header the fixture writes.
    expect(raw.slice(2, 10)).not.toEqual(FIXED_REALTIME_LE)
  })
})

describe('entropy is derived from the task, never from the host', () => {
  it('gives the same two draws to two executions of the same shard', async () => {
    const first = bytesOf(await run(wasiProbe, { q: 1 }, 1, 2))
    const second = bytesOf(await run(wasiProbe, { q: 1 }, 1, 2))
    expect([...first.slice(32, 48)]).toEqual([...second.slice(32, 48)])
  })

  it('advances between draws, so "deterministic" is not "constant"', async () => {
    // A stream that returned the same block forever would satisfy every test above
    // and be useless — and worse, plausible: a guest seeding a hash table with it
    // would collide every key.
    const probe = bytesOf(await run(wasiProbe))
    expect([...probe.slice(32, 40)]).not.toEqual([...probe.slice(40, 48)])
  })

  it('differs between shards of the same job', async () => {
    const a = bytesOf(await run(wasiProbe, { q: 1 }, 0, 4))
    const b = bytesOf(await run(wasiProbe, { q: 1 }, 1, 4))
    expect([...a.slice(32, 48)]).not.toEqual([...b.slice(32, 48)])
  })

  it('differs when the input block differs', async () => {
    const a = bytesOf(await run(wasiProbe, { q: 1 }))
    const b = bytesOf(await run(wasiProbe, { q: 2 }))
    expect([...a.slice(32, 48)]).not.toEqual([...b.slice(32, 48)])
  })

  it('produces a seed that changes with every component of the task', async () => {
    const { moduleCid, inputCid } = await store(wasiProbe, { q: 1 })
    const otherInput = await store(wasiProbe, { q: 2 })
    // A genuinely different module, not the same bytes stored twice — content
    // addressing would give those the same CID, and the test would pass by not
    // testing anything. (It did, on the first run: four seeds where five were
    // asserted, which is how this comment came to exist.)
    const otherModule = await store(wasiEcho, { q: 1 })
    const seeds = new Set(
      [
        task(moduleCid, inputCid, 0, 1),
        task(moduleCid, inputCid, 0, 2),
        task(moduleCid, inputCid, 1, 2),
        task(moduleCid, otherInput.inputCid, 0, 1),
        task(otherModule.moduleCid, inputCid, 0, 1),
      ].map((t) => [...taskSeed(t)].join(',')),
    )
    // Five tasks differing in one field each; five distinct seeds. A seed that
    // ignored a field would let two genuinely different shards share a stream.
    expect(seeds.size).toBe(5)
  })

  it('gives a 32-byte seed and a stream that fills any length', () => {
    const seed = new Uint8Array(32).fill(9)
    const stream = seededStream(seed)
    const a = new Uint8Array(100)
    stream(a)
    const b = new Uint8Array(100)
    seededStream(seed)(b)
    // Two streams from one seed agree; that is the whole contract.
    expect([...a]).toEqual([...b])
    // …across the internal 32-byte block boundary, which is where an off-by-one in
    // the counter would show up and nowhere else.
    expect([...a.slice(30, 40)]).not.toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0])
  })
})

// ---- exit status -------------------------------------------------------------

describe('a non-zero exit is a failure, named, and never a silent empty output', () => {
  it('reports the code the guest exited with', async () => {
    const failure = failureOf(await run(wasiFail))
    expect(failure.kind).toBe('nonzero-exit')
    if (failure.kind === 'nonzero-exit') expect(failure.code).toBe(7)
  })

  it('discards output the guest wrote before failing, and says how much', async () => {
    // The fixture leaves one byte of perfectly valid DAG-CBOR on stdout. Accepting
    // it would content-address a result the program disowned — and redundancy could
    // not catch that, because two nodes running the same failing program fail
    // identically and therefore agree.
    const failure = failureOf(await run(wasiFail))
    expect(failure.kind).toBe('nonzero-exit')
    if (failure.kind === 'nonzero-exit') expect(failure.stdoutBytes).toBe(1)
  })

  it('surfaces the code through the Executor port, where only a string fits', async () => {
    const { blockstore, moduleCid, inputCid } = await store(wasiFail)
    const executor = new WasiExecutor({ nodeId: 'n1', blockstore })
    const outcome = await executor.execute(task(moduleCid, inputCid))
    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.reason).toContain('status 7')
  })
})

// ---- output the fabric cannot use --------------------------------------------

describe('output the fabric cannot use is reported as such', () => {
  it('reports bytes that are not valid DAG-CBOR', async () => {
    // 0xff is the CBOR "break" code, which is not a value. The echo guest faithfully
    // reproduces it, so the block is the fixture here — no separate program needed.
    const { blockstore, moduleCid, inputCid } = await storeRaw(
      wasiEcho,
      new Uint8Array([0xff, 0xff, 0xff]),
    )
    const executor = new WasiExecutor({ nodeId: 'n1', blockstore })
    const failure = failureOf(await executor.run(task(moduleCid, inputCid)))
    expect(failure.kind).toBe('not-dag-cbor')
  })

  it('reports non-canonical CBOR, not only malformed CBOR', async () => {
    // `18 05` is unsigned(5) written in two bytes. Well-formed CBOR, refused by
    // strict DAG-CBOR because 5 has a shorter encoding — exactly the mistake a guest
    // makes when it writes a variable-width field without branching on magnitude.
    const { blockstore, moduleCid, inputCid } = await storeRaw(
      wasiEcho,
      new Uint8Array([0x18, 0x05]),
    )
    const executor = new WasiExecutor({ nodeId: 'n1', blockstore })
    const failure = failureOf(await executor.run(task(moduleCid, inputCid)))
    expect(failure.kind).toBe('not-dag-cbor')
  })

  it('distinguishes "wrote nothing" from "wrote something unreadable"', async () => {
    const { blockstore, moduleCid, inputCid } = await storeRaw(wasiEcho, new Uint8Array(0))
    const executor = new WasiExecutor({ nodeId: 'n1', blockstore })
    const failure = failureOf(await executor.run(task(moduleCid, inputCid)))
    // An empty stdout would decode as a codec error too, and calling that
    // "not DAG-CBOR" would send whoever debugs it looking at the wrong end.
    expect(failure.kind).toBe('no-output')
  })

  it('refuses output past the cap rather than truncating it', async () => {
    // Truncation would hand back a *shorter* value that still decoded — a plausible
    // wrong answer, which is worse than any error.
    const outcome = await run(wasiEcho, new Uint8Array(4096), 0, 1, 64)
    const failure = failureOf(outcome)
    expect(failure.kind).toBe('output-too-large')
    if (failure.kind === 'output-too-large') expect(failure.limit).toBe(64)
  })

  it('blames the cap, not the guest, when the cap caused the guest to exit', async () => {
    // The echo fixture exits 66 when a write comes back an error. Reporting that code
    // would blame the program for a limit this node imposed.
    const failure = failureOf(await run(wasiEcho, new Uint8Array(4096), 0, 1, 64))
    expect(failure.kind).not.toBe('nonzero-exit')
  })
})

// ---- not a command module ----------------------------------------------------

describe('an artifact that is not a WASI command module is named as such', () => {
  it('reports a module with no _start', async () => {
    const failure = failureOf(await run(wasiNoStart))
    expect(failure.kind).toBe('missing-export')
    if (failure.kind === 'missing-export') expect(failure.name).toBe('_start')
  })

  it('reports a module with no memory', async () => {
    const failure = failureOf(await run(wasiNoMemory))
    expect(failure.kind).toBe('missing-export')
    if (failure.kind === 'missing-export') expect(failure.name).toBe('memory')
  })

  it('reports garbage bytes as a failed instantiation rather than crashing', async () => {
    const failure = failureOf(await run(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])))
    expect(failure.kind).toBe('instantiation-failed')
  })

  it('reports a missing module block', async () => {
    const { blockstore, inputCid } = await store(wasiEcho)
    const absent = await new MemoryBlockstore().put(new Uint8Array([9, 9, 9]))
    const executor = new WasiExecutor({ nodeId: 'n1', blockstore })
    const failure = failureOf(await executor.run(task(absent, inputCid)))
    expect(failure.kind).toBe('module-missing')
  })

  it('reports a missing input block', async () => {
    const { blockstore, moduleCid } = await store(wasiEcho)
    const absent = await new MemoryBlockstore().put(new Uint8Array([9, 9, 9]))
    const executor = new WasiExecutor({ nodeId: 'n1', blockstore })
    const failure = failureOf(await executor.run(task(moduleCid, absent)))
    expect(failure.kind).toBe('input-missing')
  })
})

// ---- the import object is the sandbox ----------------------------------------

describe('the import object is the sandbox, with no allow-list involved', () => {
  it('refuses a module asking for thread_spawn, and the runtime names it', async () => {
    const failure = failureOf(await run(wasiThreadSpawn))
    expect(failure.kind).toBe('instantiation-failed')
    if (failure.kind === 'instantiation-failed') {
      // The engine's own message. Nothing in this repository scanned for the name.
      expect(failure.detail).toContain('thread_spawn')
    }
  })

  it('supplies every WASI function the shim implements, and not one more', () => {
    const shim = new WASI([], [], [], { debug: false }).wasiImport
    const pinned = pinnedWasiImports(shim, { memory: null }, () => {})
    // Same key set both ways. A *missing* key would refuse a legitimate artifact at
    // instantiation; an *extra* one would be a capability nobody decided to grant.
    expect(Object.keys(pinned).sort()).toEqual(Object.keys(shim).sort())
  })
})

// ---- the pinned surface ------------------------------------------------------

describe('every nondeterministic host function is replaced', () => {
  const shim = new WASI([], [], [], { debug: false }).wasiImport
  const pinned = pinnedWasiImports(shim, { memory: null }, () => {})

  it.each(PINNED_WASI_FUNCTIONS)('%s still exists in the shim', (name) => {
    // If an upgrade renamed one of these, the pinning below would silently apply to
    // a function nobody calls while the real one stayed wired up. This is the check
    // that would fail first, and it names the function.
    expect(typeof shim[name]).toBe('function')
  })

  it.each(PINNED_WASI_FUNCTIONS)('%s is not the shim implementation', (name) => {
    expect(pinned[name]).not.toBe(shim[name])
  })

  it('covers everything the shim reaches the platform through', () => {
    // The list is maintained by hand, so it is worth restating what has to be on it
    // and why, in a form that fails if an entry is dropped. Sources, in order:
    // wall clock, clock resolution, host entropy, a busy-wait on the wall clock, a
    // yield with no errno, a raised signal, and four socket calls.
    expect([...PINNED_WASI_FUNCTIONS].sort()).toEqual([
      'clock_res_get',
      'clock_time_get',
      'poll_oneoff',
      'proc_raise',
      'random_get',
      'sched_yield',
      'sock_accept',
      'sock_recv',
      'sock_send',
      'sock_shutdown',
    ])
  })

  it('catches a pinner that forgot one — the planted violation', () => {
    // Delete `clock_time_get` from the pinned surface and the check above must fail.
    // Without this, a pinning function that returned `{...base}` unchanged would pass
    // every structural test in this block.
    const forgetful: Record<string, unknown> = { ...pinned }
    forgetful['clock_time_get'] = shim['clock_time_get']
    const escaped = PINNED_WASI_FUNCTIONS.filter((name) => forgetful[name] === shim[name])
    expect(escaped).toEqual(['clock_time_get'])
  })

  it('leaves the object it was given untouched, so the two can be compared at all', () => {
    // `pinnedWasiImports` returns a new object rather than mutating `wasiImport` in
    // place. If it mutated, every identity check in this block would compare a
    // function to itself and pass unconditionally.
    //
    // Note this cannot be checked against a *second* `new WASI(...)`: the shim builds
    // its closures per instance, so two instances never share a function identity and
    // such a test would fail for a reason that says nothing about pinning.
    const before = shim['clock_time_get']
    pinnedWasiImports(shim, { memory: null }, () => {})
    expect(shim['clock_time_get']).toBe(before)
    expect(shim['clock_time_get']).not.toBe(pinned['clock_time_get'])
  })
})

describe('the guest gets descriptors that say the same thing on every node', () => {
  /**
   * These two claims are only observable through `fd_fdstat_get`/`fd_filestat_get`,
   * and they went untested until a mutation survived: setting `fs_rights_base = 0n`
   * broke nothing, because the hand-written fixtures call `fd_read` directly and
   * never ask permission. A real libc does ask.
   */
  const CHARACTER_DEVICE = 2
  const RIGHTS_FD_READ_LE = [2, 0, 0, 0, 0, 0, 0, 0]
  const RIGHTS_FD_WRITE_LE = [64, 0, 0, 0, 0, 0, 0, 0]

  it('tells stdin it is a readable character device', async () => {
    const stat = bytesOf(await run(wasiFdstat, { a: 1 }))
    expect(stat.length).toBe(112)
    // fdstat: {u8 filetype, pad, u16 flags, pad[4], u64 rights_base, u64 inherited}
    expect(stat[0]).toBe(CHARACTER_DEVICE)
    expect([...stat.slice(2, 4)]).toEqual([0, 0]) // no O_APPEND, no O_NONBLOCK
    expect([...stat.slice(8, 16)]).toEqual(RIGHTS_FD_READ_LE)
    expect([...stat.slice(16, 24)]).toEqual([0, 0, 0, 0, 0, 0, 0, 0])
  })

  it('tells stdout it is a writable character device', async () => {
    const stat = bytesOf(await run(wasiFdstat, { a: 1 }))
    expect(stat[24]).toBe(CHARACTER_DEVICE)
    expect([...stat.slice(32, 40)]).toEqual(RIGHTS_FD_WRITE_LE)
  })

  it('gives stdin a fixed inode and no timestamps', async () => {
    // The shim's own descriptors draw `ino` from a module-global counter, so this
    // number would otherwise depend on how many tasks the *process* had already run
    // — two nodes disagreeing over a value neither of them chose.
    const stat = bytesOf(await run(wasiFdstat, { a: 1 }))
    const filestat = stat.slice(48)
    expect([...filestat.slice(0, 8)]).toEqual([0, 0, 0, 0, 0, 0, 0, 0]) // dev
    expect([...filestat.slice(8, 16)]).toEqual([1, 0, 0, 0, 0, 0, 0, 0]) // ino
    expect(filestat[16]).toBe(CHARACTER_DEVICE)
    expect([...filestat.slice(24, 32)]).toEqual([0, 0, 0, 0, 0, 0, 0, 0]) // nlink
    // Everything past `size` is atim/mtim/ctim, and all of it must be zero: a
    // timestamp taken from the host clock is the same divergence as `clock_time_get`
    // wearing a different hat. Asserted as a range rather than at three offsets
    // because the shim's own field offsets are off by two and could be corrected.
    expect([...filestat.slice(38)]).toEqual(new Array(filestat.length - 38).fill(0))
  })

  it('reports the input size, so the two runs of a shard agree on that too', async () => {
    // `{a: 1}` encodes as 4 bytes of DAG-CBOR: a1 61 61 01.
    const stat = bytesOf(await run(wasiFdstat, { a: 1 }))
    expect([...stat.slice(48 + 32, 48 + 38)]).toEqual([4, 0, 0, 0, 0, 0])
  })

  it('is byte-identical across executions, descriptors and all', async () => {
    const first = bytesOf(await run(wasiFdstat, { a: 1 }))
    const second = bytesOf(await run(wasiFdstat, { a: 1 }))
    expect([...first]).toEqual([...second])
  })
})

describe('the guest gets a fixed environment and no filesystem', () => {
  it('publishes exactly the three variables that pin locale and time zone', () => {
    // Hardcoded: the point of this list is that it does not vary with the host, so a
    // test that read it from the implementation would check nothing.
    expect([...WASI_ENV]).toEqual(['LANG=C', 'LC_ALL=C', 'TZ=UTC'])
  })

  it('never writes to the console, however talkative the shim wants to be', async () => {
    // `new WASI(args, env, fds)` with no options **enables** the shim's debug logger
    // — `enabled === undefined ? true : enabled` — and the logger is a module-level
    // singleton, so one careless construction anywhere starts printing argv counts
    // for every task in the process.
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      await run(wasiShard, {}, 1, 2)
      expect(spy).not.toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })
})

// ---- the same path as a source-compiled module -------------------------------

describe('a WASI artifact travels the fabric’s ordinary verified path — AOT-04', () => {
  it('shards, executes redundantly across three nodes, and reaches agreement', async () => {
    // The acceptance criterion in words: "under the same admission checks and
    // verification as a source-compiled one". `submitJob` takes `Executor`s and has
    // no idea this one speaks WASI — which is the proof.
    const blockstore = new MemoryBlockstore()
    const moduleCid = await blockstore.put(wasiEcho)
    const shards: CanonicalValue[] = [{ a: 1 }, { a: 2 }, { a: 3 }, { a: 4 }]

    const result = await submitJob(
      {
        moduleCid,
        shards,
        executors: [
          new WasiExecutor({ nodeId: 'n1', blockstore }),
          new WasiExecutor({ nodeId: 'n2', blockstore }),
          new WasiExecutor({ nodeId: 'n3', blockstore }),
        ],
        redundancy: 2,
      },
      blockstore,
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.job.complete).toBe(true)
    expect(result.job.verificationMultiplier).toBe(2)

    for (const [index, shard] of result.job.shards.entries()) {
      expect(shard.verification.status).toBe('agreed')
      if (shard.verification.status === 'agreed') {
        expect(shard.verification.replicas).toBe(2)
        // The echo guest is the identity, so each shard's verified output is its
        // own input value — agreed on independently by two nodes.
        expect(shard.verification.output).toEqual(shards[index])
        expect(await blockstore.has(shard.verification.resultCid)).toBe(true)
      }
    }
  })

  it('a WASI node and a native-ABI node cannot be told apart by the scheduler', async () => {
    // Both satisfy `Executor`, both report a `nodeId`, both return the same outcome
    // shape. Nothing downstream branches on which kind of guest produced a result,
    // which is what makes translated artifacts first-class rather than a side door.
    const blockstore = new MemoryBlockstore()
    const executor = new WasiExecutor({ nodeId: 'aot-1', blockstore })
    expect(executor.nodeId).toBe('aot-1')
    const moduleCid = await blockstore.put(wasiEcho)
    const encoded = encodeCanonical({ k: 'v' })
    if (!encoded.ok) throw new Error('encode failed')
    const inputCid = await blockstore.put(encoded.bytes)
    const outcome = await executor.execute(task(moduleCid, inputCid))
    expect(outcome.ok).toBe(true)
    if (outcome.ok) {
      expect(outcome.output).toEqual({ k: 'v' })
      expect(outcome.fuelUsed).toBeGreaterThan(0)
    }
  })
})
