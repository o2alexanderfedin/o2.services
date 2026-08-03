import { Fd, WASI } from '@bjorn3/browser_wasi_shim'
import { encodeCanonical, MemoryBlockstore, publicNodes, submitJob } from '@o2/core'
import type { CanonicalValue, Task } from '@o2/core'
import type { CID } from 'multiformats/cid'
import { describe, expect, it, vi } from 'vitest'
import {
  wasiEcho,
  wasiEnv,
  wasiFail,
  wasiFdstat,
  wasiHostcall,
  wasiNoisy,
  wasiNoMemory,
  wasiNoStart,
  wasiProbe,
  wasiShard,
  wasiThreadSpawn,
} from './fixtures/wasi-fixtures.ts'
import {
  describeWasiFailure,
  FIXED_MONOTONIC_NANOS,
  FIXED_REALTIME_NANOS,
  MAX_STDERR_BYTES,
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
import type {
  RandomStream,
  WasiFailure,
  WasiHostFunctions,
  WasiRunOutcome,
} from './wasi-executor.ts'

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

/**
 * The argv block a C `main` sees: every argument NUL-terminated, concatenated.
 *
 * Spelled `\u0000` rather than typed. An earlier version of the two assertions below
 * carried *raw* NUL bytes in the source, and the cost was not cosmetic: the
 * repository-wide vocabulary guard skips any file containing a NUL — the cheap test
 * for "this is a binary" — so committing them would have made this file permanently,
 * silently exempt from a rule the project treats as absolute. An unregistered
 * exemption is worse than a registered one, because nobody can audit what they cannot
 * see. `denied-by-invisibility` is now itself a test; see `vocabulary.node.test.ts`.
 */
const argv = (...args: readonly string[]): string => args.map((arg) => `${arg}\u0000`).join('')

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
    ['wasi-env', wasiEnv],
    ['wasi-hostcall', wasiHostcall],
    ['wasi-noisy', wasiNoisy],
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
    for (const bytes of [
      wasiEcho,
      wasiShard,
      wasiProbe,
      wasiFail,
      wasiFdstat,
      wasiEnv,
      wasiHostcall,
      wasiNoisy,
    ]) {
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
    expect(seen).toContain(argv(WASI_ARGV0, '0', '4'))
    expect(seen).toContain(argv(WASI_ARGV0, '3', '4'))
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

// ---- the diagnostic survives the failure it describes -------------------------

describe('a failing guest is quoted, and what was not quoted is counted', () => {
  /**
   * A trap or a non-zero exit is the only moment stderr is ever read, so a cap that
   * loses it loses it exactly when it is needed.
   *
   * `MAX_STDERR_BYTES` used to be enforced by the *stdout* sink, which refuses a write
   * that would exceed the cap and keeps none of it. On stdout that is right and
   * deliberate — a short result that still decodes is a plausible wrong answer. On
   * stderr it produced two defects at once. A guest whose message arrived in one
   * `fprintf` larger than 4 KiB had the whole diagnostic discarded, so a trap after a
   * large message reported nothing at all; and the `ERRNO_NOSPC` it got back was this
   * node's storage policy arriving in the guest's control flow, where a node with a
   * different cap would make the same program exit differently.
   *
   * `wasi-noisy.wasm` writes 100 lines of 48 bytes — 4800 against a 4096-byte cap — and
   * exits 71 if any stderr write reports an error, or 72 if one is acknowledged short.
   * So a regression in either defect is a *wrong exit code*, not a subtly shorter
   * string that nobody reads.
   */
  const LINE = 'o2-task guest diagnostic: something went wrong.\n'
  const LINES = 100
  /** Hardcoded, not `LINE.length`: this is the fixture's contract, not a measurement. */
  const LINE_BYTES = 48
  const WROTE = 4800
  const KEPT = 4096
  const DROPPED = 704

  /** `1` traps, anything else exits 9 — see the fixture's own comment. */
  const TRAPS = 1
  const EXITS = 0

  it('states the arithmetic the fixture and the cap are built on', () => {
    // Every number above, tied to the constant it is a claim about. Without this the
    // rest of the block is self-consistent and could be wrong together.
    expect(LINE.length).toBe(LINE_BYTES)
    expect(LINES * LINE_BYTES).toBe(WROTE)
    expect(MAX_STDERR_BYTES).toBe(KEPT)
    expect(KEPT + DROPPED).toBe(WROTE)
    // And 4096 is deliberately not a multiple of 48, so one write straddles the cap.
    expect(KEPT % LINE_BYTES).toBe(16)
  })

  it('keeps the first cap-full of stderr and reports what it dropped', async () => {
    const failure = failureOf(await run(wasiNoisy, EXITS))
    expect(failure.kind).toBe('nonzero-exit')
    if (failure.kind !== 'nonzero-exit') return
    // 9, not 71 or 72: every diagnostic write was accepted and acknowledged in full,
    // even the ones past the cap. The cap never reached the guest.
    expect(failure.code).toBe(9)
    expect(failure.stderr.length).toBe(KEPT)
    expect(failure.stderrDropped).toBe(DROPPED)
  })

  it('keeps the head, because the first message is the diagnosis', async () => {
    // A ring buffer would keep the last 4096 bytes, which for a program failing in a
    // loop is the cascade rather than the cause.
    const failure = failureOf(await run(wasiNoisy, EXITS))
    if (failure.kind !== 'nonzero-exit') throw new Error('expected a non-zero exit')
    expect(failure.stderr.startsWith(LINE + LINE)).toBe(true)
    // …and the write that straddles the cap is split rather than dropped whole: the
    // last 16 characters are the beginning of line 86, not the end of line 85.
    expect(failure.stderr.endsWith(LINE.slice(0, 16))).toBe(true)
  })

  it('says in the description that output was truncated, not only in a field', async () => {
    // Nothing downstream reads `stderrDropped`; the description is what a human sees.
    // A count that only a debugger can reach is the same as no count.
    const failure = failureOf(await run(wasiNoisy, EXITS))
    const described = describeWasiFailure(failure)
    expect(described).toContain('status 9')
    expect(described).toContain(LINE.trim())
    expect(described).toContain(`+${DROPPED} bytes dropped`)
    expect(described).toContain(`${MAX_STDERR_BYTES}-byte cap`)
  })

  it('carries the same diagnostic out of a trap, where there is no exit code to read', async () => {
    // The case the reviewer named. A trap has no status and no output — the guest's own
    // words are the entire evidence, and this is the path on which they used to vanish.
    const failure = failureOf(await run(wasiNoisy, TRAPS))
    expect(failure.kind).toBe('trap')
    if (failure.kind !== 'trap') return
    expect(failure.stderr.length).toBe(KEPT)
    expect(failure.stderrDropped).toBe(DROPPED)
    const described = describeWasiFailure(failure)
    expect(described).toContain('trap during execution')
    expect(described).toContain(LINE.trim())
    expect(described).toContain(`+${DROPPED} bytes dropped`)
  })

  it('does not invent a truncation notice for a guest that said little or nothing', async () => {
    // The other half of the contract: a description that always mentioned stderr would
    // be as useless as one that never did. `wasi-fail` exits 7 in silence.
    const failure = failureOf(await run(wasiFail))
    expect(failure.kind).toBe('nonzero-exit')
    if (failure.kind !== 'nonzero-exit') return
    expect(failure.stderrDropped).toBe(0)
    expect(failure.stderr).toBe('')
    expect(describeWasiFailure(failure)).not.toContain('stderr')
  })

  it('surfaces the diagnostic through the Executor port, where only a string fits', async () => {
    const { blockstore, moduleCid, inputCid } = await store(wasiNoisy, EXITS)
    const executor = new WasiExecutor({ nodeId: 'n1', blockstore })
    const outcome = await executor.execute(task(moduleCid, inputCid))
    expect(outcome.ok).toBe(false)
    // The port carries one string, so if the truncation notice is not in it, no caller
    // downstream can ever learn that the diagnostic is partial.
    if (!outcome.ok) expect(outcome.reason).toContain(`+${DROPPED} bytes dropped`)
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

  /**
   * Identity is not behaviour.
   *
   * Every check above is satisfied by a replacement that is merely *a different
   * function* — including one that returns `undefined`, or `ERRNO_SUCCESS` for a
   * socket call, or reads the wall clock and then rounds it. The errnos below are
   * spelled as literals rather than read from `wasiDefs`, because a test that imports
   * the same constant as the implementation cannot notice the two disagreeing with the
   * ABI together. These are the preview1 numbers: 0 success, 58 notsup, 21 fault,
   * 28 inval.
   */
  const ERRNO_SUCCESS = 0
  const ERRNO_NOTSUP = 58
  const ERRNO_FAULT = 21
  const ERRNO_INVAL = 28

  /** A pinned surface over a real page of guest memory, so writes can be read back. */
  function overMemory(random: RandomStream = () => undefined): {
    readonly fns: WasiHostFunctions
    readonly memory: WebAssembly.Memory
    readonly view: DataView
  } {
    const memory = new WebAssembly.Memory({ initial: 1, maximum: 1 })
    const shimImports = new WASI([], [], [], { debug: false }).wasiImport
    return {
      fns: pinnedWasiImports(shimImports, { memory }, random),
      memory,
      view: new DataView(memory.buffer),
    }
  }

  /**
   * Call one pinned host function, and require it to have answered with an errno.
   *
   * The single type assertion in this block, concentrated here on purpose. WASI
   * signatures are per-function, and `WasiHostFunctions` is a record of
   * `(...args: never[]) => unknown` — which is what makes the object assignable to
   * `WebAssembly.Imports` at all, and uncallable by construction. The engine supplies
   * the real signature at instantiation; a test standing where the engine stands has
   * to state it. So the widening happens once, guarded by a `typeof` check before and
   * a `typeof` check after, and every call below goes through it.
   */
  function invoke(
    fns: WasiHostFunctions,
    name: string,
    ...args: readonly (number | bigint)[]
  ): number {
    const fn = fns[name]
    if (typeof fn !== 'function') throw new Error(`${name} is not a host function`)
    const callable = fn as (...a: readonly (number | bigint)[]) => unknown
    const result = callable(...args)
    if (typeof result !== 'number') {
      throw new Error(`${name} answered ${String(result)}, which is not an errno`)
    }
    return result
  }

  it.each(['proc_raise', 'sock_accept', 'sock_recv', 'sock_send', 'sock_shutdown'])(
    '%s answers ERRNO_NOTSUP, so a guest is told rather than left guessing',
    (name) => {
      // A refusal that returned `undefined` coerces to `0` at the boundary — which is
      // ERRNO_SUCCESS, i.e. "your signal was raised" or "your socket is connected".
      // That is worse than not implementing it.
      expect(invoke(overMemory().fns, name, 0, 0, 0, 0)).toBe(ERRNO_NOTSUP)
    },
  )

  it('sched_yield answers ERRNO_SUCCESS, deliberately and not by coercion', () => {
    // The shim returns `undefined` here, which happens to coerce to 0. Right by
    // accident is indistinguishable from right on purpose at the ABI — and
    // distinguishable here, because `invoke` refuses a non-number.
    expect(invoke(overMemory().fns, 'sched_yield')).toBe(ERRNO_SUCCESS)
  })

  it('poll_oneoff refuses *and* leaves nevents defined', () => {
    // The defect this exists for: the shim declares three parameters where the ABI
    // passes four, so it never receives `nevents_ptr` and never writes it. A guest
    // that checks the errno, ignores it, and reads `nevents` — which real libc code
    // does — reads whatever was in that word. On one node that is zero; on another it
    // is the tail of a previous write. Divergence with no traceable cause.
    const { fns, view } = overMemory()
    const nevents = 128
    view.setUint32(nevents, 0xdeadbeef, true)
    expect(invoke(fns, 'poll_oneoff', 0, 64, 1, nevents)).toBe(ERRNO_NOTSUP)
    expect(view.getUint32(nevents, true)).toBe(0)
  })

  it('answers a pointer it cannot write with ERRNO_FAULT rather than trapping', () => {
    // One 64 KiB page. A host function that let a `RangeError` escape would unwind the
    // guest as an opaque trap, and "your pointer was out of range" is something the
    // guest can be told in its own vocabulary.
    const { fns } = overMemory()
    const past = 65_536
    expect(invoke(fns, 'clock_time_get', 0, 0n, past)).toBe(ERRNO_FAULT)
    expect(invoke(fns, 'clock_res_get', 0, past)).toBe(ERRNO_FAULT)
    expect(invoke(fns, 'random_get', past, 8)).toBe(ERRNO_FAULT)
    expect(invoke(fns, 'poll_oneoff', 0, 0, 1, past)).toBe(ERRNO_FAULT)
  })

  it('answers ERRNO_INVAL when the guest has no memory yet', () => {
    // `memoryRef.memory` is null between instantiation and start. Reachable, because
    // the import object is built before the instance exists.
    const fns = pinnedWasiImports(
      new WASI([], [], [], { debug: false }).wasiImport,
      { memory: null },
      () => undefined,
    )
    for (const name of ['clock_time_get', 'clock_res_get', 'random_get', 'poll_oneoff']) {
      expect(invoke(fns, name, 0, 0n, 0, 0)).toBe(ERRNO_INVAL)
    }
  })

  it('writes the pinned clock and the seeded entropy, not merely a different value', () => {
    // The two functions whose *value* is the determinism claim, checked at the host
    // boundary rather than only through a fixture — so a fixture that stopped calling
    // them could not take this coverage with it.
    const drawn: number[] = []
    let block = 1
    const { fns, memory, view } = overMemory((out) => {
      out.fill(block++)
      drawn.push(out.length)
    })

    expect(invoke(fns, 'clock_time_get', 0, 0n, 0)).toBe(ERRNO_SUCCESS)
    expect(view.getBigUint64(0, true)).toBe(FIXED_REALTIME_NANOS)
    expect(invoke(fns, 'clock_time_get', 1, 0n, 8)).toBe(ERRNO_SUCCESS)
    expect(view.getBigUint64(8, true)).toBe(FIXED_MONOTONIC_NANOS)

    expect(invoke(fns, 'random_get', 16, 4)).toBe(ERRNO_SUCCESS)
    // The stream was asked for exactly the bytes requested, and wrote exactly them —
    // the byte after the range is still zero, so the write did not run long.
    expect(drawn).toEqual([4])
    expect([...new Uint8Array(memory.buffer, 16, 5)]).toEqual([1, 1, 1, 1, 0])
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

describe('a guest observes the pinned host functions behaving, not merely existing', () => {
  /**
   * The same claims as the block above, asked from the other side of the boundary.
   *
   * A direct call proves the function does the right thing when *this test* calls it.
   * It does not prove the function is the one the engine wired into a running module,
   * that the arguments arrive in the order WASI specifies, or that what the host wrote
   * landed where the guest was looking. `wasi-hostcall.wasm` asks through a real
   * instantiation and publishes the memory it got back, which is the only vantage
   * point that can tell those apart.
   *
   * Every out-parameter is prefilled with `0xa5a5a5a5` inside the fixture, so "wrote
   * zero" and "wrote nothing" are two different observations. That distinction is the
   * entire `poll_oneoff` defect.
   */
  const SENTINEL = [0xa5, 0xa5, 0xa5, 0xa5]
  const ERRNO_SUCCESS_LE = [0, 0, 0, 0]
  const ERRNO_NOTSUP_LE = [58, 0, 0, 0]
  const ERRNO_BADF_LE = [8, 0, 0, 0]
  const ONE_NANOSECOND_LE = [1, 0, 0, 0, 0, 0, 0, 0]

  /**
   * The whole 64-byte answer, as a literal.
   *
   * Hardcoded rather than assembled from the named constants below, for the reason
   * every conformance vector in this file is: a vector computed from the same pieces
   * the implementation uses agrees with the implementation by construction, whatever
   * either of them says. This is what a guest sees, written down.
   */
  const HOSTCALL_VECTOR = [
    58, 0, 0, 0, //                 poll_oneoff → ERRNO_NOTSUP
    0, 0, 0, 0, //                  …and nevents written, not left as the sentinel
    8, 0, 0, 0, //                  fd_read(3) → ERRNO_BADF
    0xa5, 0xa5, 0xa5, 0xa5, //      …nread untouched, deterministically
    8, 0, 0, 0, //                  fd_write(3) → ERRNO_BADF
    0xa5, 0xa5, 0xa5, 0xa5, //      …nwritten untouched, deterministically
    0, 0, 0, 0, //                  clock_res_get(CLOCKID_REALTIME) → ERRNO_SUCCESS
    1, 0, 0, 0, 0, 0, 0, 0, //      …1 ns
    0, 0, 0, 0, //                  clock_res_get(CLOCKID_MONOTONIC) → ERRNO_SUCCESS
    1, 0, 0, 0, 0, 0, 0, 0, //      …1 ns
    0, 0, 0, 0, //                  clock_res_get(99) → ERRNO_SUCCESS, where the shim says NOSYS
    1, 0, 0, 0, 0, 0, 0, 0, //      …1 ns, so no clock id is a fingerprint
    0, 0, 0, 0, //                  sched_yield → ERRNO_SUCCESS
  ]

  it('sees exactly this from the pinned surface, byte for byte', async () => {
    const seen = bytesOf(await run(wasiHostcall, { a: 1 }))
    expect(seen.length).toBe(64)
    expect([...seen]).toEqual(HOSTCALL_VECTOR)
  })

  it('is told poll_oneoff is refused, and finds nevents written rather than stale', async () => {
    // The defect, from the guest's chair. The shim declares three parameters where the
    // ABI passes four, so it never receives `nevents_ptr`; a guest that reads the count
    // after an error — and real libc code does — reads whatever was in that word. The
    // sentinel is what proves the difference between a host that wrote `0` and a host
    // that wrote nothing, and before the fix the sentinel came back intact.
    const seen = bytesOf(await run(wasiHostcall, { a: 1 }))
    expect([...seen.slice(0, 4)]).toEqual(ERRNO_NOTSUP_LE)
    expect([...seen.slice(4, 8)]).toEqual(ERRNO_SUCCESS_LE)
    expect([...seen.slice(4, 8)]).not.toEqual(SENTINEL)
  })

  it('is told a descriptor it never opened is ERRNO_BADF, on read and on write', async () => {
    // `fds` is exactly `[stdin, stdout, stderr]` and there are no preopens, so fd 3 is
    // the first thing a translated binary hits the moment it assumes a filesystem.
    // Answering `BADF` is what lets it fail the way it would on a real machine; the
    // untouched counts are the other half — unwritten, but unwritten *identically* on
    // every node, which is the property that matters here.
    const seen = bytesOf(await run(wasiHostcall, { a: 1 }))
    expect([...seen.slice(8, 12)]).toEqual(ERRNO_BADF_LE)
    expect([...seen.slice(12, 16)]).toEqual(SENTINEL)
    expect([...seen.slice(16, 20)]).toEqual(ERRNO_BADF_LE)
    expect([...seen.slice(20, 24)]).toEqual(SENTINEL)
  })

  it('gets a resolution for every clock id, including ones the shim refuses', async () => {
    // Not a fidelity claim — a consistency one. The shim answers `ERRNO_NOSYS` for any
    // id outside the two it knows, so a guest could ask about clock 99 and learn which
    // host it was on. Every id gets 1 ns here, including the two that also return a
    // time, so there is no pair for a guest to branch on.
    const seen = bytesOf(await run(wasiHostcall, { a: 1 }))
    for (const at of [24, 36, 48]) {
      expect([...seen.slice(at, at + 4)]).toEqual(ERRNO_SUCCESS_LE)
      expect([...seen.slice(at + 4, at + 12)]).toEqual(ONE_NANOSECOND_LE)
    }
  })

  it('gets the same answers on a second execution, which is the point of all of it', async () => {
    const first = bytesOf(await run(wasiHostcall, { a: 1 }))
    const second = bytesOf(await run(wasiHostcall, { a: 1 }))
    expect([...first]).toEqual([...second])
  })

  it('is not the shim doing this — the unpinned shim answers differently', async () => {
    /**
     * The planted violation. Run the same fixture against the shim's own surface and
     * require the vector to differ, so the literal above is evidence about this
     * executor rather than about a shim that would have answered the same anyway.
     *
     * Note the fixture asks `poll_oneoff` for a *zero* timeout precisely so this run
     * terminates: the shim busy-waits on `performance.now()` until the deadline passes,
     * and a fixture that asked for a real one would spend that time here.
     */
    const collected: Uint8Array[] = []
    class Collect extends Fd {
      override fd_write(data: Uint8Array): { ret: number; nwritten: number } {
        collected.push(data)
        return { ret: 0, nwritten: data.length }
      }
    }
    const wasi = new WASI([WASI_ARGV0], [], [new Collect(), new Collect()], { debug: false })
    const instance = await WebAssembly.instantiate(await WebAssembly.compile(wasiHostcall), {
      [WASI_NAMESPACE]: { ...wasi.wasiImport },
    })
    const memory = instance.exports['memory']
    const start = instance.exports['_start']
    if (!(memory instanceof WebAssembly.Memory) || !isNiladic(start)) {
      throw new Error('hostcall fixture is not a command module')
    }
    try {
      wasi.start({ exports: { memory, _start: start } })
    } catch {
      // `proc_exit` unwinds as a throw in the shim; the output is already collected.
    }

    // Skip the 2-byte CBOR header the fixture writes.
    const raw = Uint8Array.from(collected.flatMap((chunk) => [...chunk])).subarray(2)
    expect([...raw.subarray(0, 64)]).not.toEqual(HOSTCALL_VECTOR)
    // Specifically: the shim leaves `nevents` exactly as the fixture left it.
    expect([...raw.subarray(4, 8)]).toEqual(SENTINEL)
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

  /**
   * …and the assertion above, alone, proves only that the constant says what it says.
   *
   * That was the whole of this claim's coverage until now: `WASI_ENV` is documented as
   * "the guest's entire environment", and nothing had ever asked a guest. An executor
   * that built its `WASI` with `[]` for `env` would have satisfied every test in this
   * file — and would have handed a translated binary an empty environment, where
   * `LC_ALL` decides collation and `TZ` decides how `FIXED_REALTIME_NANOS` renders as
   * a local date. Two nodes disagreeing by hours, from a constant both of them export
   * correctly.
   *
   * `wasi-env.wasm` asks through `environ_sizes_get`/`environ_get`, which is the only
   * route a libc uses, and publishes the pointer array as well as the string buffer:
   * `getenv` walks the array and reads *through* it, so a correct buffer behind a
   * wrong array would satisfy any test that looked only at the strings.
   */
  const ENVIRON = {
    /** `environ_sizes_get` → count. */
    count: 3,
    /** `environ_sizes_get` → buffer size: 'LANG=C\0'(7) + 'LC_ALL=C\0'(9) + 'TZ=UTC\0'(7). */
    bufferBytes: 23,
    /** `environ_get` → the three pointers, as offsets from the buffer base. */
    offsets: [0, 7, 16],
  } as const

  const u32 = (bytes: Uint8Array, at: number): number =>
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(at, true)

  it('hands a real guest exactly those three variables, through environ_get', async () => {
    const seen = bytesOf(await run(wasiEnv, { a: 1 }))
    expect(seen.length).toBe(64)

    expect(u32(seen, 0)).toBe(ENVIRON.count)
    expect(u32(seen, 4)).toBe(ENVIRON.bufferBytes)
    // The pointer array, not the buffer: this is what `getenv` dereferences.
    expect([u32(seen, 8), u32(seen, 12), u32(seen, 16)]).toEqual([...ENVIRON.offsets])

    // The buffer itself, byte for byte, NUL terminators included.
    expect(text(seen.subarray(20, 20 + ENVIRON.bufferBytes))).toBe(
      argv('LANG=C', 'LC_ALL=C', 'TZ=UTC'),
    )
    // Memory starts zeroed and the fixture copies 44 bytes, so a fourth variable
    // arriving from the host would appear here rather than nowhere.
    expect([...seen.subarray(20 + ENVIRON.bufferBytes)]).toEqual(
      new Array(64 - 20 - ENVIRON.bufferBytes).fill(0),
    )
  })

  it('gives the same environment to two nodes running the same task', async () => {
    // The reason the claim matters at all: an environment that varied by host would be
    // a divergence source that no result comparison could attribute to its cause.
    const a = bytesOf(await run(wasiEnv, { a: 1 }))
    const b = bytesOf(await run(wasiEnv, { a: 1 }))
    expect([...a]).toEqual([...b])
  })

  it('is not the shim doing this — an unpinned environment reaches the guest too', async () => {
    // The planted violation. Instantiate the same fixture with a *different* env and
    // require a different answer, so the vector above is evidence about this executor
    // rather than about a fixture that would print those bytes regardless.
    const collected: Uint8Array[] = []
    class Collect extends Fd {
      override fd_write(data: Uint8Array): { ret: number; nwritten: number } {
        collected.push(data)
        return { ret: 0, nwritten: data.length }
      }
    }
    const wasi = new WASI([WASI_ARGV0], ['TZ=Europe/Berlin'], [new Collect(), new Collect()], {
      debug: false,
    })
    const instance = await WebAssembly.instantiate(await WebAssembly.compile(wasiEnv), {
      [WASI_NAMESPACE]: { ...wasi.wasiImport },
    })
    const memory = instance.exports['memory']
    const start = instance.exports['_start']
    if (!(memory instanceof WebAssembly.Memory) || !isNiladic(start)) {
      throw new Error('env fixture is not a command module')
    }
    try {
      wasi.start({ exports: { memory, _start: start } })
    } catch {
      // `proc_exit(0)` unwinds as a throw in the shim; the output is already collected.
    }

    const raw = Uint8Array.from(collected.flatMap((chunk) => [...chunk]))
    // Skip the 2-byte CBOR header the fixture writes.
    expect(u32(raw.subarray(2), 0)).not.toBe(ENVIRON.count)
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
    const executors = [
      new WasiExecutor({ nodeId: 'n1', blockstore }),
      new WasiExecutor({ nodeId: 'n2', blockstore }),
      new WasiExecutor({ nodeId: 'n3', blockstore }),
    ]

    const result = await submitJob(
      {
        moduleCid,
        shards: shards.map((value) => ({ value, label: 'public' as const })),
        executors,
        nodes: publicNodes(executors),
        redundancy: 2,
        onQuorumShortfall: 'runs-at-available-redundancy',
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
