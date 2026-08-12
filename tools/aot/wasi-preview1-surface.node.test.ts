import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { arch, tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { Fd, WASI } from '@bjorn3/browser_wasi_shim'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { describeGate, isRunnable, probeDockerReach } from './docker-gate.ts'

/**
 * What WASI preview1 supplies, measured — and a module that toolchain produced, RUN.
 *
 * Phase 26 turns on exactly one experiment: can `elflift` be built for `wasm32-wasi`, and if
 * not, which syscall blocks it. Nothing about that question can be believed until two things
 * exist that this file establishes: a wasm32-wasi toolchain that is **pinned rather than
 * found**, and a **measured** statement of what preview1 actually provides.
 *
 * ## AOTW-01 — the toolchain is named by a digest, and the digest is asserted
 *
 * `26-CONTEXT.md`'s preconditions say wasi-sdk is not installed on this host. That is true and
 * it is not the whole reading: `ghcr.io/yomaytk/elfconv`, the image this repository already
 * uses, ships **wasi-sdk-24.0 at `/root/wasi-sdk-24.0-arm64-linux`**. So the acquisition step
 * costs zero bytes of download, and the honest pin is not a version string in a fetch script —
 * it is the image digest.
 *
 * {@link IMAGE} is that digest, read from
 * `docker image inspect --format '{{join .RepoDigests "\n"}}' ghcr.io/yomaytk/elfconv:arm64`
 * on this host on 2026-08-10. `elfconv-differential.node.test.ts:36` pins the mutable
 * `:arm64` **tag**; a tag can be repointed at a different image under the same name, and this
 * plan's whole claim is that the toolchain the phase measures against cannot move without a
 * diff. That spec is deliberately left alone — re-pinning it is not this plan's scope.
 *
 * Pinning alone is not enough, because a digest in a constant proves only what was *asked
 * for*. So the report is asserted to name a clang whose version string contains `wasi-sdk` and
 * a default target triple containing `wasm32`, before anything else is read. A report that
 * named a host toolchain would be measuring the wrong compiler.
 *
 * ## AOTW-03 — the provided set, and what "present" means here
 *
 * `provided.txt` is every globally defined symbol in **any** archive of the preview1 sysroot,
 * read with `llvm-nm --defined-only` out of `share/wasi-sysroot/lib/wasm32-wasi`. That
 * includes the opt-in archives — `libsetjmp.a`, `libdl.a`, `libpthread.a`,
 * `libwasi-emulated-signal.a` — which are not linked unless the link line asks for them. So
 * **present means "linkable against this sysroot", not "linked by default" and emphatically
 * not "works"**: several of those archives are stubs that fail at run time. A gate subtracting
 * from this set measures the generous bound, which is the correct direction — an undefined
 * symbol it did not predict would be a false negative, and this set cannot produce one.
 *
 * **Two readings below need that caveat spelled out, because a bare `present: false` would
 * misinform Plan 26-02's gate:**
 *
 * - `setjmp` / `longjmp` read **absent as symbols and are nonetheless available as a
 *   feature**. wasi-sdk-24 lowers them through the compiler's own SjLj path, so what the
 *   archives define is `__wasm_setjmp`, `__wasm_setjmp_test`, `__wasm_longjmp` and
 *   `__c_longjmp` — all four ARE in `provided.txt`, measured. The C names never appear as
 *   archive symbols at all. Read this row as "not a libc symbol", never as "no non-local jump".
 * - `__cxa_allocate_exception` and `__cxa_throw` read **absent, and that absence is real**.
 *   It is corroborated rather than assumed: **32** other `__cxa_*` symbols (`__cxa_atexit`,
 *   `__cxa_guard_acquire`, `__cxa_rethrow_primary_exception`, `__cxa_demangle`, …) ARE present
 *   in the same scan — `grep -c '^__cxa' provided.txt` reads 32, and neither probed symbol is
 *   among them — so libc++abi was demonstrably read. This matches the roadmap's recorded
 *   `wasm-ld: undefined symbol: __cxa_allocate_exception`, and it is why 26-CONTEXT.md's
 *   "C++ exceptions stay off" is a measurement rather than a preference.
 *
 * **The instrument is checked before any absence is believed.** An `nm` that failed and a
 * library that contains nothing produce the *same* report — all absent — and they must not be
 * confusable. Three separate guards: the harness aborts with exit 31 below 1000 symbols; this
 * spec asserts a sited floor of {@link PROVIDED_FLOOR}; and the probe carries a control group
 * of five symbols that must come back present, asserted in source order **before** any case
 * that reads an absence. `elfconv-differential.node.test.ts:124-131` records the same
 * distinction on the `ldd` side, where this repository has already been bitten by a guard that
 * could not tell "zero matches" from "the tool did not run".
 *
 * ## AOTW-02 — the module is run, not merely compiled
 *
 * The container compiles `smoke.wasm` and does **not** execute it. Execution happens here, on
 * the host, under `@bjorn3/browser_wasi_shim` — the preview1 host this project ships on both
 * platforms — and the assertion is on the **bytes the module wrote**, not on the compiler's
 * exit code. This phase's standing rule is that elfconv exits `0` on binaries it could not
 * translate, so a tool's exit code is never the evidence; `smoke.exit === 0` is recorded in the
 * report and is deliberately not what any case here passes on.
 *
 * `packages/aot/src/wasi-real.node.test.ts` is careful about what a hello-world can establish
 * and the same care applies: this proves the toolchain in the pinned image emits a preview1
 * command module that instantiates against this project's own import surface, exports `_start`
 * and `memory` and nothing else, runs to completion and writes what it was told to write. It
 * proves nothing about `elflift`, which is Plan 26-02's question.
 *
 * ## Planted-mutation proof — recorded, observed, restored
 *
 * Per CLAUDE.md's Proofs convention, and planted on the **execution** leg rather than on a
 * threshold, because execution is the leg AOTW-02 rests on. One byte of the in-memory copy of
 * `smoke.wasm` was flipped immediately before `WebAssembly.instantiate` — a temporary edit to
 * this file, never a write to the artifact. See {@link PLANT} below for the exact edit and the
 * observed failure text.
 *
 * Budget: one `docker run` with no build in it — see {@link HARNESS_BUDGET_MS}. Skipped
 * entirely without Docker, and gated to arm64 because the image is arm64 and an emulated run
 * would measure qemu.
 */

const SCRIPT = fileURLToPath(new URL('./wasi-preview1-surface.sh', import.meta.url))

/**
 * The toolchain, pinned by digest rather than by tag.
 *
 * Overridable by `ELFCONV_IMAGE_DIGEST` so a deliberate re-pin is a one-line env change with a
 * commit behind it, rather than an edit that has to pretend the measurement did not move.
 */
const IMAGE =
  process.env['ELFCONV_IMAGE_DIGEST'] ??
  'ghcr.io/yomaytk/elfconv@sha256:22a404f31c9f7bb5c49e3193081d4876718253d86747aae3d30fcfd971f19c05'

/**
 * Sited against `elfconv-differential.node.test.ts:39`, which allows 900 000 ms for a run that
 * includes a full cold `ninja elflift` plus eight lifts. This harness has no build in it — it
 * runs `llvm-nm` over 19 archives and one `clang++ -O1` on a six-line translation unit — so a
 * third of that is ample, and it is a ceiling on a hung container rather than an expectation.
 */
const HARNESS_BUDGET_MS = 300_000
vi.setConfig({ testTimeout: HARNESS_BUDGET_MS, hookTimeout: HARNESS_BUDGET_MS })

/**
 * A floor with something behind it rather than a round number.
 *
 * Measured per-archive in the same image on 2026-08-10: `libc.a` alone defines **1196** global
 * symbols, `libc++.a` **2319**, `libc++abi.a` **424**, and the whole 19-archive sysroot
 * **3963** unique. The harness's own abort threshold is 1000, which sits *below* libc.a alone —
 * it detects an `nm` that read nothing, and would happily pass a scan that reached only libc.
 * 3000 is above libc.a + libc++abi.a and below the live reading, so it distinguishes "scanned
 * the sysroot" from "scanned part of it", which is the drift the harness floor cannot see.
 */
const PROVIDED_FLOOR = 3000

interface ProbeEntry {
  readonly symbol: string
  readonly present: boolean
  readonly family: string
}

interface Surface {
  readonly image: string
  readonly wasiSdkPath: string
  readonly clangVersion: string
  readonly targetTriple: string
  readonly sysroots: readonly string[]
  readonly libDir: string
  readonly archiveCount: number
  readonly nmExit: number
  readonly providedCount: number
  readonly probe: readonly ProbeEntry[]
  readonly smoke: { readonly exit: number; readonly bytes: number; readonly sha256: string }
}

/**
 * The probe as this repository records it, in the harness's fixed order.
 *
 * This table is the documentation, and it is checked against the live reading element for
 * element so it cannot rot into prose. A sysroot change, a wasi-sdk bump, or a hand-edit here
 * goes red and names the index that moved — which is the whole reason the harness emits an
 * ordered array rather than a map.
 *
 * Recorded 2026-08-10 from the image digest in {@link IMAGE}. See this file's docblock for why
 * `setjmp: false` does NOT mean "no non-local jump", and why `__cxa_throw: false` does mean
 * what it says.
 */
const RECORDED_PROBE: readonly ProbeEntry[] = [
  // process — the family the gating experiment is actually about. Nothing in it exists.
  { symbol: 'fork', present: false, family: 'process' },
  { symbol: 'vfork', present: false, family: 'process' },
  { symbol: 'execv', present: false, family: 'process' },
  { symbol: 'execve', present: false, family: 'process' },
  { symbol: 'execvp', present: false, family: 'process' },
  { symbol: 'posix_spawn', present: false, family: 'process' },
  { symbol: 'wait', present: false, family: 'process' },
  { symbol: 'waitpid', present: false, family: 'process' },
  { symbol: 'wait4', present: false, family: 'process' },
  { symbol: 'system', present: false, family: 'process' },
  { symbol: 'popen', present: false, family: 'process' },
  { symbol: 'pipe', present: false, family: 'process' },
  // signals — `signal` and `raise` exist (libwasi-emulated-signal.a); delivery does not.
  // `signal` there is a stub that can only ever refuse, so present is a linkability fact.
  { symbol: 'signal', present: true, family: 'signals' },
  { symbol: 'sigaction', present: false, family: 'signals' },
  { symbol: 'raise', present: true, family: 'signals' },
  { symbol: 'kill', present: false, family: 'signals' },
  { symbol: 'sigprocmask', present: false, family: 'signals' },
  // non-local jumps — absent as C symbols, available as a compiler feature. See the docblock.
  { symbol: 'setjmp', present: false, family: 'jumps' },
  { symbol: '_setjmp', present: false, family: 'jumps' },
  { symbol: 'sigsetjmp', present: false, family: 'jumps' },
  { symbol: 'longjmp', present: false, family: 'jumps' },
  { symbol: 'siglongjmp', present: false, family: 'jumps' },
  // unwinding — a real absence, and the one 26-CONTEXT.md's "exceptions stay off" rests on.
  { symbol: '_Unwind_RaiseException', present: false, family: 'unwinding' },
  { symbol: '__cxa_allocate_exception', present: false, family: 'unwinding' },
  { symbol: '__cxa_throw', present: false, family: 'unwinding' },
  // dynamic loading — libdl.a defines all three. They are stubs; linking is not loading.
  { symbol: 'dlopen', present: true, family: 'dynamic' },
  { symbol: 'dlsym', present: true, family: 'dynamic' },
  { symbol: 'dlclose', present: true, family: 'dynamic' },
  { symbol: 'socket', present: false, family: 'sockets' },
  { symbol: 'connect', present: false, family: 'sockets' },
  { symbol: 'bind', present: false, family: 'sockets' },
  { symbol: 'listen', present: false, family: 'sockets' },
  // threads — zero `pthread_*` symbols in the preview1 sysroot, measured. The threads variant
  // is a DIFFERENT sysroot (`wasm32-wasi-threads`) which this scan deliberately does not read.
  { symbol: 'pthread_create', present: false, family: 'threads' },
  { symbol: 'pthread_mutex_lock', present: false, family: 'threads' },
  // control — the instrument-alive group. Every absence above is worthless if these are not
  // all present, and the case asserting them runs before any case that reads an absence.
  { symbol: 'printf', present: true, family: 'control' },
  { symbol: 'malloc', present: true, family: 'control' },
  { symbol: 'memcpy', present: true, family: 'control' },
  { symbol: 'write', present: true, family: 'control' },
  { symbol: 'exit', present: true, family: 'control' },
]

const CONTROL_GROUP: readonly string[] = RECORDED_PROBE.filter(
  (entry) => entry.family === 'control',
).map((entry) => entry.symbol)

/** Exactly what the smoke translation unit is told to write, newline included. */
const SMOKE_STDOUT = 'O2 preview1 smoke ok\n'

/**
 * The planted mutation, and its observed failure text.
 *
 * **The edit.** In the AOTW-02 execution case below, immediately before
 * `WebAssembly.instantiate`, one line was inserted into the local copy of the bytes:
 *
 * ```ts
 * bytes[0] = bytes[0]! ^ 0x01   // PLANT: corrupt the wasm magic
 * ```
 *
 * **Observed red** — the verbatim output of
 * `npx vitest run --project node tools/aot/wasi-preview1-surface.node.test.ts`, whose exit code
 * read directly on the following line was **1**:
 *
 * ```
 *  FAIL  |node| tools/aot/wasi-preview1-surface.node.test.ts > WASI preview1 surface, measured
 *  in the digest-pinned image (runnable) > AOTW-02 — the container-produced module RUNS under
 *  the shim and says what it was told to say
 * CompileError: WebAssembly.instantiate(): expected magic word 00 61 73 6d, found 01 61 73 6d @+0
 *
 *  Test Files  1 failed (1)
 *       Tests  1 failed | 5 passed (6)
 * ```
 *
 * **`1 failed | 5 passed` is the part that matters.** The plant is on the execution leg and
 * only the execution case moved; the export check, the probe table and the control group all
 * stayed green. A plant that reddened the whole file would have proved the file runs, not that
 * this case tests what it claims to.
 *
 * **Restored by the surgical inverse of that exact edit** — the inserted line deleted, nothing
 * else touched — and verified with `cmp` against a snapshot of this file taken IMMEDIATELY
 * BEFORE planting: byte-identical, `cmp` silent, exit 0. Per CLAUDE.md, the hunk count is a
 * one-way alarm and proves nothing when equal; `cmp` is what actually holds.
 */
const PLANT = 'see docblock — restored and cmp-verified 2026-08-10'
void PLANT

/**
 * Which precondition is missing, named rather than left as a bare skip.
 *
 * A skipped suite with no reason is indistinguishable from a suite nobody wrote, and this one
 * skips on two independent grounds.
 *
 * The second ground used to be a local `dockerAvailable()` — one of five copies of the same
 * `spawnSync('docker', ['version', …])` in `tools/aot/`, each collapsing its answer into a
 * boolean. Same probe, same 20 s budget, now in `docker-gate.ts`, and what comes back says
 * *which* condition it was: no client at all, a daemon that did not answer, or a question
 * this host could not put. Only `lift.node.test.ts` reddens on the last of those; here every
 * arm skips with its name in the title, as the arch check already did.
 */
function missingPrecondition(): string | null {
  if (arch() !== 'arm64') return `host arch is ${arch()}, the pinned image is arm64`
  const reach = probeDockerReach()
  if (!isRunnable(reach)) return describeGate(reach)
  return null
}

const MISSING = missingPrecondition()
const SKIP_NOTE = MISSING === null ? 'runnable' : `SKIPPED: ${MISSING}`

describe.skipIf(MISSING !== null)(
  `WASI preview1 surface, measured in the digest-pinned image (${SKIP_NOTE})`,
  () => {
    let report: Surface
    let providedLines: number
    let smoke: Uint8Array<ArrayBuffer>

    beforeAll(() => {
      const out = mkdtempSync(join(tmpdir(), 'o2-wasi-surface-'))
      // The harness is not in the image and Task 1 forbids it a /repo mount — it must not be
      // able to write to the working tree, because two specs in this repo snapshot
      // `git status --porcelain` around themselves. So it arrives on stdin.
      //
      // `-i` is load-bearing and its absence is silent: without it the container's stdin is
      // /dev/null, `bash /dev/stdin` reads an empty script, and `docker run` exits **0**
      // having done nothing. That was observed on the first run of this harness — an
      // instrument that read nothing reporting success, which is exactly the failure the rest
      // of this file is built to refuse. The `existsSync` check below is what catches it.
      const run = spawnSync(
        'docker',
        [
          'run',
          '--rm',
          '-i',
          // The digest goes IN so it can be read back OUT of the report — see the `image`
          // assertion below and `elflift-wasi-gate.node.test.ts`, which does the same.
          '-e',
          `IMAGE_DIGEST=${IMAGE}`,
          '-v',
          `${out}:/out`,
          '--entrypoint',
          '/bin/bash',
          IMAGE,
          '-c',
          'bash /dev/stdin',
        ],
        {
          input: readFileSync(SCRIPT, 'utf8'),
          timeout: HARNESS_BUDGET_MS,
          encoding: 'utf8',
        },
      )
      const reportPath = join(out, 'surface.json')
      if (run.status !== 0 || !existsSync(reportPath)) {
        throw new Error(
          `harness exited ${String(run.status)} and wrote no report.\n${run.stderr ?? ''}`,
        )
      }
      report = JSON.parse(readFileSync(reportPath, 'utf8')) as Surface
      providedLines = readFileSync(join(out, 'provided.txt'), 'utf8')
        .split('\n')
        .filter((line) => line.length > 0).length
      smoke = new Uint8Array(readFileSync(join(out, 'smoke.wasm')))
    })

    it('AOTW-01 — the report names the pinned image\'s own wasi-sdk, not a host toolchain', () => {
      // First, because everything below is a statement about WHICH compiler was measured. A
      // report naming a host clang would make every symbol reading foreign.
      expect(IMAGE).toMatch(/@sha256:[0-9a-f]{64}$/)
      // And the report is asserted EQUAL to it, which the line above cannot do: a constant
      // matched against a regex is a statement about the constant, with no run-time reading
      // behind it — it would pass identically if the container had never been given the
      // digest at all. `image` is the digest this spec passed in as `IMAGE_DIGEST` and the
      // harness echoed back, so this is the report saying which image produced it. Added
      // 2026-08-10 to make `.planning/REQUIREMENTS.md`'s AOTW-01 wording ("the report's own
      // `image` field is asserted equal to it at run time") true of BOTH harnesses rather
      // than of the gate alone.
      expect(report.image).toBe(IMAGE)
      expect(report.clangVersion).toContain('wasi-sdk')
      expect(report.targetTriple).toContain('wasm32')
      expect(report.wasiSdkPath).toMatch(/^\/root\/wasi-sdk/)
      // The preview1 sysroot is the tier `packages/aot/src/wasi-executor.ts` executes, and it
      // is the one the scan below reads — asserted, not assumed from the path string.
      expect(report.sysroots).toContain('wasm32-wasi')
      expect(report.libDir).toMatch(/\/wasm32-wasi$/)
    })

    it('AOTW-03 — the instrument is alive: nm ran, and every control symbol came back present', () => {
      // THIS RUNS BEFORE ANY ABSENCE IS BELIEVED. A broken nm and an empty sysroot produce
      // the same all-absent report; the control group is what separates them, and putting it
      // after an absence assertion would make the absence unfalsifiable.
      expect(report.nmExit).toBe(0)
      expect(report.archiveCount).toBeGreaterThan(10)
      expect(report.providedCount).toBeGreaterThan(PROVIDED_FLOOR)
      // The count in the report and the file it was counted from must agree, or one of the
      // two is describing a different run.
      expect(report.providedCount).toBe(providedLines)

      const control = report.probe.filter((entry) => entry.family === 'control')
      expect(control.map((entry) => entry.symbol)).toEqual(CONTROL_GROUP)
      expect(control.filter((entry) => !entry.present).map((entry) => entry.symbol)).toEqual([])
    })

    it('AOTW-03 — the recorded probe table equals the live reading, symbol for symbol', () => {
      // The doc-rot guard. `toEqual` on the whole array would say "arrays differ"; the loop
      // names the index and the symbol, which is what a reader needs to decide whether the
      // sysroot moved or the table was hand-edited.
      expect(report.probe.length).toBe(RECORDED_PROBE.length)
      for (const [index, recorded] of RECORDED_PROBE.entries()) {
        expect(report.probe[index], `probe[${index}] (${recorded.symbol})`).toEqual(recorded)
      }
    })

    it('AOTW-03 — preview1 supplies no process, socket or thread symbol at all', () => {
      // Now believable, because the case above showed the instrument reading. Stated as a
      // family-level roll-up so a single symbol appearing in a future sysroot is red here as
      // well as in the table check — the two fail differently and that is deliberate.
      const presentIn = (family: string): string[] =>
        report.probe.filter((entry) => entry.family === family && entry.present).map((e) => e.symbol)
      expect(presentIn('process')).toEqual([])
      expect(presentIn('sockets')).toEqual([])
      expect(presentIn('threads')).toEqual([])
      // The two rows the docblock qualifies, asserted so the qualification cannot drift from
      // the reading it explains.
      expect(presentIn('unwinding')).toEqual([])
      expect(presentIn('dynamic')).toEqual(['dlopen', 'dlsym', 'dlclose'])
    })

    it('AOTW-02 — the module the container produced declares exactly _start and memory', () => {
      // Asserted SEPARATELY from the run, so "it ran" and "it ran correctly" are
      // distinguishable: a module that happened to execute under some other entrypoint would
      // pass the case below and fail this one.
      expect(report.smoke.bytes).toBeGreaterThan(0)
      expect(report.smoke.sha256).toMatch(/^[0-9a-f]{64}$/)
      expect(smoke.length).toBe(report.smoke.bytes)
      const module = new WebAssembly.Module(smoke)
      expect(WebAssembly.Module.exports(module).map((e) => e.name).sort()).toEqual([
        '_start',
        'memory',
      ])
      // Every import is preview1 and nothing else — the surface `wasi-executor.ts` pins.
      const namespaces = [...new Set(WebAssembly.Module.imports(module).map((i) => i.module))]
      expect(namespaces).toEqual(['wasi_snapshot_preview1'])
    })

    it('AOTW-02 — the container-produced module RUNS under the shim and says what it was told to say', async () => {
      // The requirement in one case: not `smoke.exit === 0`, which is a compiler's opinion, but
      // the bytes the module wrote through preview1 into a host-side sink.
      const chunks: Uint8Array[] = []
      class Collect extends Fd {
        override fd_write(data: Uint8Array): { ret: number; nwritten: number } {
          chunks.push(data)
          return { ret: 0, nwritten: data.length }
        }
      }
      // `{ debug: false }` is not optional — `wasi-executor.ts:811-816` records why: the shim's
      // `enable(enabled)` reads `enabled === undefined ? true : enabled`, so omitting the
      // options object turns on a MODULE-LEVEL logger that then prints for every other task in
      // the process.
      const stdout = new Collect()
      const wasi = new WASI(['smoke.wasm'], [], [new Collect(), stdout, new Collect()], {
        debug: false,
      })
      const bytes = smoke.slice()
      const { instance } = await WebAssembly.instantiate(bytes, {
        wasi_snapshot_preview1: wasi.wasiImport,
      })

      const memory = instance.exports['memory']
      const start = instance.exports['_start']
      if (!(memory instanceof WebAssembly.Memory) || typeof start !== 'function') {
        throw new Error('smoke.wasm is not a preview1 command module')
      }
      // The shim's `start` catches its own `WASIProcExit` and returns the code; anything else
      // it rethrows, so a trap fails this case rather than being swallowed. Read out of
      // `node_modules/@bjorn3/browser_wasi_shim/dist/wasi.js` rather than guessed at, and it
      // matches `wasi-executor.ts:852`'s treatment.
      const code = wasi.start({ exports: { memory, _start: start as () => void } })
      expect(code).toBe(0)

      const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
      const joined = new Uint8Array(total)
      let at = 0
      for (const chunk of chunks) {
        joined.set(chunk, at)
        at += chunk.length
      }
      expect(new TextDecoder().decode(joined)).toBe(SMOKE_STDOUT)
      // A floor under the assertion above: an empty stdout compared against an empty constant
      // would pass, and this is the reading that carries AOTW-02.
      expect(total).toBeGreaterThan(0)
    })
  },
)
