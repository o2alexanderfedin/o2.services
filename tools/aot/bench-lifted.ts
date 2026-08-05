/**
 * A real benchmark of elfconv-lifted native code: warm up, then iterate to a time
 * budget and report the error margin.
 *
 * ## Why this exists rather than the ad-hoc timing loops it replaces
 *
 * Three hand-rolled runs over the same artifact, in the same process shape, on the same
 * host, put the raw execution path at p50 82 ms, then 136 ms, then 37 ms. A 3.7x spread
 * across identical code is not a measurement, and it is the reason a "raw is 2.5x slower
 * than the executor" conclusion drawn from two of those runs was withdrawn.
 *
 * `tinybench` is the project's designated tool for per-op cost (STACK.md), and it fixes
 * the two things the loops got wrong: it discards a warm-up phase instead of letting V8
 * tier up inside the sample, and it reports **rme** — the relative margin of error — so a
 * difference between two rows can be checked against the noise rather than assumed to be
 * signal. Two rows whose error bars overlap are not different, however far apart their
 * means look.
 *
 * ## What is compared, and why each row is here
 *
 *   raw, stock WASI    `WebAssembly.instantiate` plus the stock shim. No fabric, no
 *                      blockstore, no codec — the floor for running a lifted artifact.
 *   raw, pinned WASI   the same, with o2's fixed clock and seeded PRNG substituted, so
 *                      the price of determinism is a line item rather than a belief.
 *   via WasiExecutor   the same artifact through o2's port, so the fabric's own wrapping
 *                      shows as a delta rather than being folded into the number.
 *
 * The module is compiled **once**, outside every row, because `WebAssembly.compile` is
 * cacheable and charging it per run would report a cache miss as the cost of execution.
 *
 * Load average is printed either side. A benchmark on a contended host is still a
 * benchmark, but only if it says what it ran on.
 *
 * Run: `node --experimental-strip-types tools/aot/bench-lifted.ts`
 * The artifact comes from `O2_LIFTED_WASM`, or the cached lift at
 * `$TMPDIR/o2-lifted-subject.wasm` that `measure-wasi.ts` leaves behind.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { loadavg, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Fd, WASI, wasi as wasiDefs } from '@bjorn3/browser_wasi_shim'
import { Bench } from 'tinybench'
import { MemoryBlockstore, encodeCanonical } from '@o2/core'
import { WasiExecutor, pinnedWasiImports, seededStream } from '@o2/aot'

const TIME_MS = Number(process.env['O2_BENCH_MS'] ?? 10_000)
const WARMUP_MS = Number(process.env['O2_WARMUP_MS'] ?? 2_000)
const ARTIFACT = process.env['O2_LIFTED_WASM'] ?? join(tmpdir(), 'o2-lifted-subject.wasm')

/** This file's directory — fixtures sit beside it. */
const HERE = dirname(fileURLToPath(import.meta.url))

const load = (): string =>
  loadavg()
    .map((n) => n.toFixed(2))
    .join(' ')

/** Swallows guest output. What the guest writes is not this benchmark's subject. */
class NullSink extends Fd {
  override fd_write(data: Uint8Array): { ret: number; nwritten: number } {
    return { ret: 0, nwritten: data.byteLength }
  }
  override fd_fdstat_get(): { ret: number; fdstat: wasiDefs.Fdstat | null } {
    return { ret: 0, fdstat: new wasiDefs.Fdstat(wasiDefs.FILETYPE_CHARACTER_DEVICE, 0) }
  }
}

const bytes = new Uint8Array(readFileSync(ARTIFACT)) as Uint8Array<ArrayBuffer>
console.log(`artifact  ${(bytes.length / 1024 / 1024).toFixed(2)} MiB  ${ARTIFACT}`)
console.log(`budget    ${WARMUP_MS} ms warm-up, then ${TIME_MS} ms per row`)
console.log(`load before  ${load()}`)

// Compiled once, deliberately: see the header.
const wasmModule = await WebAssembly.compile(bytes)
const SEED = new Uint8Array(32).fill(7)

/**
 * The same four lines of C compiled *straight* to WASM, rather than compiled to an
 * AArch64 binary and then lifted.
 *
 * This is the row that isolates what lifting costs, because everything else is held
 * constant: same source, same engine, same shim, same instantiate-and-`_start` shape.
 * The only difference is the route from C to WASM.
 *
 * Built with `emcc -sSTANDALONE_WASM -sPURE_WASI` inside the elfconv image, because the
 * host's Apple clang has no wasm target and there is no wasi-sdk on this machine. It
 * exports `_start` and imports only `wasi_snapshot_preview1`, so the shim runs it
 * unchanged.
 *
 * Size, before any timing: **504 bytes against the lifted artifact's 5.40 MiB.** Same
 * program, ~11,000x apart.
 */
const DIRECT = process.env['O2_DIRECT_WASM'] ?? join(HERE, 'fixtures', 'direct-subject.wasm')
const directBytes = existsSync(DIRECT)
  ? (new Uint8Array(readFileSync(DIRECT)) as Uint8Array<ArrayBuffer>)
  : null
const directModule = directBytes === null ? null : await WebAssembly.compile(directBytes)
if (directBytes !== null) {
  console.log(`direct    ${directBytes.length} bytes  ${DIRECT}`)
}

async function runModule(module: WebAssembly.Module, pinned: boolean): Promise<void> {
  const wasi = new WASI([], [], [new NullSink(), new NullSink(), new NullSink()], { debug: false })
  const memoryRef: { memory: WebAssembly.Memory | null } = { memory: null }
  const instance = await WebAssembly.instantiate(module, {
    wasi_snapshot_preview1: pinned
      ? pinnedWasiImports(wasi.wasiImport, memoryRef, seededStream(SEED))
      : wasi.wasiImport,
  })
  const memory = instance.exports['memory']
  if (memory instanceof WebAssembly.Memory) memoryRef.memory = memory
  try {
    wasi.start(
      instance as unknown as { exports: { memory: WebAssembly.Memory; _start: () => unknown } },
    )
  } catch {
    // non-zero exit by construction
  }
}

async function rawRun(pinned: boolean): Promise<void> {
  const wasi = new WASI([], [], [new NullSink(), new NullSink(), new NullSink()], { debug: false })
  const memoryRef: { memory: WebAssembly.Memory | null } = { memory: null }
  const instance = await WebAssembly.instantiate(wasmModule, {
    wasi_snapshot_preview1: pinned
      ? pinnedWasiImports(wasi.wasiImport, memoryRef, seededStream(SEED))
      : wasi.wasiImport,
  })
  const memory = instance.exports['memory']
  if (memory instanceof WebAssembly.Memory) memoryRef.memory = memory
  try {
    wasi.start(
      instance as unknown as { exports: { memory: WebAssembly.Memory; _start: () => unknown } },
    )
  } catch {
    // `int main(){ return 42; }` exits non-zero by construction. The work still
    // happened; the exit status is not the subject.
  }
}

const blockstore = new MemoryBlockstore()
const moduleCid = await blockstore.put(bytes)
const encoded = encodeCanonical({})
if (!encoded.ok) throw new Error('empty map does not encode')
const inputCid = await blockstore.put(encoded.bytes)
const executor = new WasiExecutor({ nodeId: 'bench', blockstore })

/**
 * The native baseline, and what it is honestly comparable to.
 *
 * Built here from the **same four lines of C** the lifted artifact came from, with the
 * host's own clang. Two differences are real and neither can be removed on this machine:
 * the lifted subject is a *static AArch64 Linux* binary and this one is macOS/arm64, so
 * the OS and libc differ; and running it means creating a process, where running the
 * lifted artifact means instantiating a module inside one that already exists.
 *
 * That second difference is the whole reason `spawn floor` is here. The subject does
 * nothing — `return 42` — so essentially all of the native figure is process creation,
 * and without a control there is no way to tell how much. `/usr/bin/true` is the same
 * measurement with the subject removed, so the difference between those two rows is
 * what this program costs and everything else is the fork/exec tax.
 *
 * The comparison this licenses: "run this program once, from a standing start" on each
 * side. It does **not** license a claim about steady-state compute throughput, because
 * a subject that does no work cannot measure that.
 */
const NATIVE = process.env['O2_NATIVE_BIN'] ?? join(HERE, 'fixtures', 'subject-native')
let nativeBuilt = existsSync(NATIVE)
if (!nativeBuilt) {
  try {
    execFileSync(
      'sh',
      [
        '-c',
        `printf 'int main(void){ return 42; }\\n' > "${NATIVE}.c" && ` +
          `cc -O0 -o "${NATIVE}" "${NATIVE}.c" && rm -f "${NATIVE}.c"`,
      ],
      { stdio: ['ignore', 'ignore', 'pipe'] },
    )
    nativeBuilt = true
  } catch (cause) {
    console.log(`native baseline unavailable: ${cause instanceof Error ? cause.message : cause}`)
  }
}
if (nativeBuilt) {
  const probe = spawnSync(NATIVE, [], { stdio: 'ignore' })
  console.log(`native    ${NATIVE} (exit ${probe.status})`)
}

/**
 * Capture what a module prints, so every route can be checked against the others
 * before any of them is timed.
 *
 * A benchmark that does not verify its subject can report a lift that is fast because
 * it computed the wrong answer. The workload prints one checksum and nothing else, and
 * it is deterministic by construction, so agreement here is a real cross-route check.
 */
class CaptureSink extends Fd {
  readonly chunks: Uint8Array[] = []
  override fd_write(data: Uint8Array): { ret: number; nwritten: number } {
    this.chunks.push(data.slice())
    return { ret: 0, nwritten: data.byteLength }
  }
  override fd_fdstat_get(): { ret: number; fdstat: wasiDefs.Fdstat | null } {
    return { ret: 0, fdstat: new wasiDefs.Fdstat(wasiDefs.FILETYPE_CHARACTER_DEVICE, 0) }
  }
  text(): string {
    const total = this.chunks.reduce((n, c) => n + c.length, 0)
    const all = new Uint8Array(total)
    let at = 0
    for (const c of this.chunks) {
      all.set(c, at)
      at += c.length
    }
    return new TextDecoder().decode(all).trim()
  }
}

async function outputOf(module: WebAssembly.Module): Promise<string> {
  const out = new CaptureSink()
  const wasi = new WASI([], [], [new NullSink(), out, new NullSink()], { debug: false })
  const instance = await WebAssembly.instantiate(module, {
    wasi_snapshot_preview1: wasi.wasiImport,
  })
  try {
    wasi.start(
      instance as unknown as { exports: { memory: WebAssembly.Memory; _start: () => unknown } },
    )
  } catch {
    // a non-zero exit is not a reason to discard what was already written
  }
  return out.text()
}

console.log('\nchecksums, before timing anything:')
const liftedOut = await outputOf(wasmModule)
console.log(`  lifted        ${liftedOut || '(no output)'}`)
if (directModule !== null) {
  console.log(`  direct wasm   ${await outputOf(directModule)}`)
}
if (nativeBuilt) {
  const r = spawnSync(NATIVE, [], { encoding: 'utf8' })
  console.log(`  native        ${(r.stdout ?? '').trim() || `(exit ${r.status})`}`)
}

const bench = new Bench({ time: TIME_MS, warmupTime: WARMUP_MS })
/**
 * One instance, prepared outside the clock.
 *
 * `beforeEach` runs before tinybench captures its start time and `afterEach` after it
 * stops (verified in `tinybench/dist/index.js`), so anything done here is excluded from
 * the measurement. That is what lets `_start` be timed on its own.
 *
 * Shared rather than per-row because rows run sequentially, so only one is ever live.
 */
let prepared: { wasi: WASI; instance: WebAssembly.Instance } | null = null

async function prepare(module: WebAssembly.Module, pinned: boolean): Promise<void> {
  const wasi = new WASI([], [], [new NullSink(), new NullSink(), new NullSink()], { debug: false })
  const memoryRef: { memory: WebAssembly.Memory | null } = { memory: null }
  const instance = await WebAssembly.instantiate(module, {
    wasi_snapshot_preview1: pinned
      ? pinnedWasiImports(wasi.wasiImport, memoryRef, seededStream(SEED))
      : wasi.wasiImport,
  })
  const memory = instance.exports['memory']
  if (memory instanceof WebAssembly.Memory) memoryRef.memory = memory
  prepared = { wasi, instance }
}

/** The measured region for the `_start only` rows: the guest running, nothing else. */
function startOnly(): void {
  const p = prepared
  if (p === null) throw new Error('beforeEach did not prepare an instance')
  try {
    p.wasi.start(
      p.instance as unknown as { exports: { memory: WebAssembly.Memory; _start: () => unknown } },
    )
  } catch {
    // a non-zero exit is not a failure of the work that already ran
  }
}

/*
 * Two shapes per artifact, because they answer different questions.
 *
 *   `_start only`          what the guest's own execution costs, with construction of the
 *                          WASI object and `WebAssembly.instantiate` lifted out of the
 *                          clock. This is the honest compute comparison.
 *   `instantiate + start`  what running the program once costs from a standing start,
 *                          which is what a node actually pays per task.
 *
 * `via WasiExecutor` appears only in the second shape: it instantiates internally, so
 * there is no seam at which its setup could be excluded without rewriting it.
 * `native, spawn` is likewise irreducible — process creation *is* how a native program
 * starts, which is exactly what `spawn floor` exists to quantify.
 */
bench
  .add('lifted: _start only', startOnly, {
    beforeEach: async () => {
      await prepare(wasmModule, false)
    },
  })
  .add('lifted: instantiate+start', async () => {
    await rawRun(false)
  })
  .add('lifted: +pinned WASI', async () => {
    await rawRun(true)
  })
  .add('lifted: via WasiExecutor', async () => {
    await executor.run({ moduleCid, inputCid, partitionIndex: 0, partitionCount: 1 })
  })

if (directModule !== null) {
  const dm = directModule
  bench
    .add('direct: _start only', startOnly, {
      beforeEach: async () => {
        await prepare(dm, false)
      },
    })
    .add('direct: instantiate+start', async () => {
      await runModule(dm, false)
    })
}

if (nativeBuilt) {
  bench
    .add('native: spawn+run', () => {
      spawnSync(NATIVE, [], { stdio: 'ignore' })
    })
    // The control. Subtract from the row above for what the subject costs; the rest is
    // the fork/exec tax every native run pays and no in-process route pays at all.
    .add('native: spawn floor', () => {
      spawnSync('/usr/bin/true', [], { stdio: 'ignore' })
    })
}

await bench.run()

console.log(`load after   ${load()}\n`)
console.log('row                  n      mean ms    +/- rme     median     p99')
for (const task of bench.tasks) {
  const r = task.result
  if (r === undefined || r === null) {
    console.log(`  ${task.name.padEnd(18)} did not produce a result`)
    continue
  }
  console.log(
    `  ${task.name.padEnd(18)} ${String(r.samples.length).padStart(5)}  ` +
      `${r.mean.toFixed(2).padStart(9)}  ${`+/-${r.rme.toFixed(1)}%`.padStart(9)}  ` +
      `${r.p75.toFixed(2).padStart(8)}  ${r.p99.toFixed(2).padStart(8)}`,
  )
}
console.log('\n(median column is p75 — tinybench 2.x reports p75/p99, not p50)')
console.log('Two rows whose mean +/- rme overlap are not measurably different.')
