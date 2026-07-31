/**
 * How fast does elfconv-lifted native code actually run?
 *
 * Costs kept apart, because they are paid at different times by different parties and
 * lumping them together is how a per-task figure gets quoted that is mostly build work:
 *
 *   compile      build-time, once, on a developer machine
 *   lift         build-time, once per binary
 *   ---- everything below is per-run ----
 *   wasm compile `WebAssembly.compile` over the lifted bytes — cacheable, so measured
 *                once and excluded from the steady-state figure
 *   instantiate  a fresh `WebAssembly.Instance` plus a fresh WASI, per run
 *   _start       the guest actually running
 *
 * The per-run costs need no fabric, no node and no network — `WebAssembly.instantiate`
 * and a WASI shim are the whole of it. `WasiExecutor` is measured separately at the end
 * so o2's own wrapping (blockstore fetch, canonical decode) shows up as a delta rather
 * than being folded into the number.
 *
 * Percentiles, not means: this project's perf baseline already records that
 * straggler-dominated distributions have meaningless means. Load average is sampled at
 * every stage — a timing on a contended host is still a reading, but only if it says so.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { loadavg, tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { Fd, WASI, wasi as wasiDefs } from '@bjorn3/browser_wasi_shim'
import { MemoryBlockstore, encodeCanonical } from '@o2/core'
import { WasiExecutor } from '@o2/aot'
import { ELFCONV_IMAGE_TAG, liftElf } from './lift.ts'

const RUNS = Number(process.env['O2_RUNS'] ?? 50)

const load = (): string =>
  loadavg()
    .map((n) => n.toFixed(2))
    .join(' ')

function pct(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return Number.NaN
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[i] as number
}

function report(label: string, samples: readonly number[]): void {
  const s = [...samples].sort((a, b) => a - b)
  console.log(
    `  ${label.padEnd(22)} n=${s.length}  min ${s[0]?.toFixed(2)}  p50 ${pct(s, 50).toFixed(2)}  ` +
      `p90 ${pct(s, 90).toFixed(2)}  p95 ${pct(s, 95).toFixed(2)}  max ${s[s.length - 1]?.toFixed(2)}`,
  )
}

/** Swallows guest output. What the guest writes is not this measurement's subject. */
class NullSink extends Fd {
  override fd_write(data: Uint8Array): { ret: number; nwritten: number } {
    return { ret: 0, nwritten: data.byteLength }
  }
  override fd_fdstat_get(): { ret: number; fdstat: wasiDefs.Fdstat | null } {
    return { ret: 0, fdstat: new wasiDefs.Fdstat(wasiDefs.FILETYPE_CHARACTER_DEVICE, 0) }
  }
}

const work = mkdtempSync(join(tmpdir(), 'o2-measure-'))
console.log(`load at start: ${load()}`)

// ---- build-time: compile the subject inside the image, then lift it ----
const compileStart = performance.now()
execFileSync(
  'docker',
  [
    'run', '--rm', '--network', 'none', '-e', 'EMSDK_QUIET=1',
    '--entrypoint', '/bin/bash', '-v', `${work}:/out`, ELFCONV_IMAGE_TAG, '--login', '-c',
    'printf "int main(void){ return 42; }\\n" > /tmp/subject.c && ' +
      'clang-16 -O0 -static -o /out/subject /tmp/subject.c && chmod a+rw /out/subject',
  ],
  { stdio: ['ignore', 'ignore', 'pipe'], timeout: 10 * 60 * 1000 },
)
const compileMs = performance.now() - compileStart
console.log(`compile:  ${(compileMs / 1000).toFixed(1)}s   load ${load()}`)

const liftStart = performance.now()
const outcome = await liftElf(join(work, 'subject'))
const liftMs = performance.now() - liftStart
console.log(`lift:     ${(liftMs / 1000).toFixed(1)}s   ok=${outcome.ok}   load ${load()}`)
if (!outcome.ok) {
  console.log(`lift failed: ${JSON.stringify(outcome.failure)}`)
  process.exit(1)
}
const bytes = outcome.artifact.bytes as Uint8Array<ArrayBuffer>
const kept = join(tmpdir(), 'o2-lifted-subject.wasm')
writeFileSync(kept, bytes)
console.log(
  `artifact: ${(bytes.length / 1024 / 1024).toFixed(2)} MiB, ${outcome.artifact.target}, ` +
    `verdict ${outcome.verdict}, features [${outcome.artifact.requiredFeatures.join(' ')}]`,
)
console.log(`kept at:  ${kept}`)

// ---- per-run: the raw path. No fabric, no blockstore, no codec. ----
const compileWasmStart = performance.now()
const wasmModule = await WebAssembly.compile(bytes)
const wasmCompileMs = performance.now() - compileWasmStart

const instantiate: number[] = []
const started: number[] = []
for (let i = 0; i < RUNS; i += 1) {
  const t0 = performance.now()
  const wasi = new WASI([], [], [new NullSink(), new NullSink(), new NullSink()], { debug: false })
  const instance = await WebAssembly.instantiate(wasmModule, {
    wasi_snapshot_preview1: wasi.wasiImport,
  })
  const t1 = performance.now()
  try {
    wasi.start(
      instance as unknown as { exports: { memory: WebAssembly.Memory; _start: () => unknown } },
    )
  } catch {
    // `wasi.start` throws on a non-zero exit, which `int main(){return 42;}` is by
    // construction. The work still happened; the exit status is not the subject.
  }
  const t2 = performance.now()
  instantiate.push(t1 - t0)
  started.push(t2 - t1)
}

// ---- per-run: the same artifact through o2's executor, for the delta ----
const blockstore = new MemoryBlockstore()
const moduleCid = await blockstore.put(bytes)
const encoded = encodeCanonical({})
if (!encoded.ok) throw new Error('empty map does not encode')
const inputCid = await blockstore.put(encoded.bytes)
const executor = new WasiExecutor({ nodeId: 'measure', blockstore })
const viaExecutor: number[] = []
let lastKind = ''
for (let i = 0; i < RUNS; i += 1) {
  const t0 = performance.now()
  const result = await executor.run({ moduleCid, inputCid, partitionIndex: 0, partitionCount: 1 })
  viaExecutor.push(performance.now() - t0)
  lastKind = result.ok ? 'ok' : result.failure.kind
}

console.log(`\nload at end: ${load()}`)
console.log(
  `\nper run, ms — ${RUNS} runs of a ${(bytes.length / 1024 / 1024).toFixed(2)} MiB lifted artifact:`,
)
report('instantiate + WASI', instantiate)
report('_start (the guest)', started)
report(
  'raw total',
  instantiate.map((v, i) => v + (started[i] as number)),
)
report('via WasiExecutor', viaExecutor)
console.log(`\nWebAssembly.compile, once, cacheable: ${wasmCompileMs.toFixed(1)} ms`)
console.log(`WasiExecutor outcome every run: ${lastKind}`)
console.log(
  `\nbuild-time, for contrast: compile ${(compileMs / 1000).toFixed(1)}s, lift ${(liftMs / 1000).toFixed(1)}s`,
)
