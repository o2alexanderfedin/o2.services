import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { beforeAll, describe, expect, it, vi } from 'vitest'

import { describeGate, isRunnable, probeDockerReach } from './docker-gate.ts'

/**
 * AOTW-06 — **glog was not the wall, and the measurement that said so is now reproducible.**
 *
 * ## What this replaces
 *
 * A session on 2026-08-14 recorded that a two-line `__wasi__` branch plus a few lines fixing
 * elfconv's own bugs got **27/27 translation units compiling at 14.3 MB of objects**. That
 * claim was checked before being written into `REQUIREMENTS.md` and did not survive: the
 * figure existed in two prose sentences landed by one `chore: pause handoff` commit, with no
 * patch, no build log, no fixture, and the submodule pristine. It was a session observation
 * in a working tree nobody kept — which `REQUIREMENTS.md` correctly refused to record as a
 * measurement.
 *
 * `elflift-wasi-port.sh` is that patch, and this file is that measurement. Re-run on
 * 2026-08-17 it reproduces **27/27 at 14 286 380 bytes** — the 14.3 MB figure, to the byte —
 * and then goes past it: the threadless target compiles 27/27 too, at 14 285 302 bytes.
 *
 * ## The qualification the lost note did not carry, and it is the important half
 *
 * That 27/27 was on `wasm32-wasi-**threads**`. The threadless `wasm32-wasi` arm — preview1,
 * which is the target this project actually runs — began at **6/27**, and getting it to 27/27
 * took three walls, none of which glog caused on its own:
 *
 *   6/27   `glog/logging.h:51` includes `<thread>`, and libc++ `#error`s the whole header
 *  13/27   glog's own interface names `std::thread::id` at `logging.h:123`, three times
 *  27/27   remill's `ArchLocker` needs `std::mutex`; LLVM's `RWMutex` needs `<shared_mutex>`
 *
 * **libc++ was the wall, not glog.** Configured without threads it refuses whole headers far
 * past what needs threading: `lock_guard`, `unique_lock` and the lock tag types name no
 * `__libcpp_*` symbol at all and are gated anyway. `std::thread::id` is an opaque handle. A
 * reader/writer lock with no second thread is a no-op. Only `std::mutex` genuinely wraps
 * `__libcpp_mutex_t`, and on a single-threaded target a no-op there is not a stub — it is the
 * correct implementation, because there is no second thread to exclude.
 *
 * And none of it was needed: `llvm-nm --undefined-only` over all 27 objects finds **zero**
 * references to `pthread_create`, `thread_spawn`, `pthread_join`, `pthread_detach` or any
 * `std::thread` member. `elflift` is single-threaded code that only wanted the headers to
 * exist. `std::thread` is therefore declared with no constructors, so a future change that
 * tried to start a thread would be a compile error rather than a silent link.
 *
 * ## What a green here does and does not establish
 *
 * It establishes that every translation unit **compiles**. There is no link, no
 * `elflift.wasm`, and no bitcode compared against native elfconv's — which is what AOTW-06
 * actually asks for. Linking needs LLVM, gflags, glog and XED cross-compiled to wasm32-wasi
 * and `26-CONTEXT.md` precondition 3 still stands: the only cross-compiled LLVM on this host
 * is Emscripten-targeted, verified again on 2026-08-17 by reading its `CMakeCache.txt`
 * (`CMAKE_TOOLCHAIN_FILE` = `Emscripten.cmake`, `EMSCRIPTEN:INTERNAL=1`). **AOTW-06 stays
 * unmet.** What changed is that the compile half is finished on BOTH targets and the whole
 * remaining unknown is the link.
 */

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const SCRIPT = fileURLToPath(new URL('./elflift-wasi-port.sh', import.meta.url))
const IMAGE =
  'ghcr.io/yomaytk/elfconv@sha256:22a404f31c9f7bb5c49e3193081d4876718253d86747aae3d30fcfd971f19c05'

/**
 * The unpatched gate measured three consecutive runs at `real 139.64`, `135.57`, `135.67`.
 * This one adds a `cp -a` of the elfconv fork and compiles a further 21 units on the threads
 * arm; measured at 372 s on this host. 900 000 ms is a ceiling on a hung container, not an
 * expectation — the same siting the differential harness uses for the same reason.
 */
const HARNESS_BUDGET_MS = 900_000
vi.setConfig({ testTimeout: HARNESS_BUDGET_MS, hookTimeout: HARNESS_BUDGET_MS })

interface Tu {
  readonly file: string
  readonly arm: string
  readonly exit: number
  readonly objectBytes: number | null
  readonly firstError: string | null
  readonly errorFile: string | null
}

interface Report {
  readonly tus: readonly Tu[]
  readonly threadsArm: readonly Tu[]
  readonly cmakeExit: number
  readonly clangVersion: string
}

const REACH = await probeDockerReach()
const RUNNABLE = isRunnable(REACH)

let report: Report | undefined
let patchLog = ''

beforeAll(() => {
  process.stdout.write(`[wasi-port] docker: ${describeGate(REACH)}\n`)
  if (!RUNNABLE) return

  const out = mkdtempSync(join(tmpdir(), 'o2-wasi-port-'))
  const run = spawnSync(
    'docker',
    [
      'run',
      '--rm',
      // Load-bearing and silent in its absence — the script arrives on stdin, and without
      // this the container reads /dev/null, does nothing, and exits 0.
      '-i',
      '-e',
      `IMAGE_DIGEST=${IMAGE}`,
      '-v',
      `${REPO_ROOT}:/repo:ro`,
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
      maxBuffer: 64 * 1024 * 1024,
    },
  )
  patchLog = run.stdout ?? ''
  const reportPath = join(out, 'gate.json')
  // The exit code alone is not enough — see the gate's own docblock. An instrument that read
  // nothing must not be able to report success.
  if (run.status !== 0 || !existsSync(reportPath)) {
    throw new Error(
      `the port harness exited ${String(run.status)} and wrote no report.\n` +
        `${patchLog}\n${run.stderr ?? ''}`,
    )
  }
  report = JSON.parse(readFileSync(reportPath, 'utf8')) as Report
}, HARNESS_BUDGET_MS)

function compiled(arm: readonly Tu[]): readonly Tu[] {
  // The object is the evidence, never the exit code — this repository's standing rule about
  // elfconv exiting 0 on work it did not do, turned around on the compiler doing the porting.
  return arm.filter((tu) => tu.exit === 0 && (tu.objectBytes ?? 0) > 0)
}

describe('AOTW-06 — the port that was measured once and not kept', () => {
  it.runIf(RUNNABLE)('applied every change it depends on, or said which one it could not', () => {
    // Exit 9 would already have failed the hook. This reads the log so a green names what ran
    // rather than implying it.
    expect(patchLog).toContain('OK    <thread> shim installed into the threadless sysroot')
    expect(patchLog).toContain('OK    __mutex/lock_guard.h: un-gated')
    expect(patchLog).toContain('OK    __mutex/mutex.h: a no-op std::mutex')
    expect(patchLog).toContain('OK    <shared_mutex> shim installed')
    expect(patchLog).toContain('OK    glog/platform.h: a __wasi__ branch')
    expect(patchLog).toContain('OK    Lift.cpp: open a __linux__ guard around the siginfo_t handler')
    expect(patchLog).toContain('OK    Loader.h: 5 guest-address fields widened')
    expect(patchLog).not.toContain('MISS ')
  })

  it.runIf(RUNNABLE)('compiles every translation unit for wasm32-wasi-threads', () => {
    if (report === undefined) throw new Error('no report')
    const arm = report.threadsArm
    const ok = compiled(arm)
    process.stdout.write(
      `[wasi-port] wasm32-wasi-threads: ${ok.length}/${arm.length} compiled, ` +
        `${ok.reduce((sum, tu) => sum + (tu.objectBytes ?? 0), 0)} bytes of objects\n`,
    )
    expect(arm.length).toBe(27)
    expect(ok.length).toBe(27)
    // The 2026-08-14 figure, recovered. Bounded rather than pinned: object size moves with
    // the image's clang, and an equality here would go red on an upgrade that changed
    // nothing about the port. 14.3 MB was the number in the lost note.
    const bytes = ok.reduce((sum, tu) => sum + (tu.objectBytes ?? 0), 0)
    expect(bytes).toBeGreaterThan(13_000_000)
    expect(bytes).toBeLessThan(16_000_000)
  })

  it.runIf(RUNNABLE)('compiles every translation unit for threadless preview1 as well', () => {
    if (report === undefined) throw new Error('no report')
    const arm = report.tus
    const ok = compiled(arm)
    process.stdout.write(
      `[wasi-port] wasm32-wasi (preview1, no threads): ${ok.length}/${arm.length} compiled, ` +
        `${ok.reduce((sum, tu) => sum + (tu.objectBytes ?? 0), 0)} bytes of objects\n`,
    )
    expect(arm.length).toBe(27)
    // **This is the target that matters**, and it took three walls to reach. The guest sandbox
    // is `@bjorn3/browser_wasi_shim` — preview1, no threads — and CLAUDE.md's stack table
    // records why threads stay off the browser tier regardless: `SharedArrayBuffer` needs COOP
    // and COEP headers GitHub Pages will not serve, and threads are a nondeterminism source
    // this project rejects at publish time.
    //
    // The walls, in the order they appeared:
    //   6/27  glog's `#include <thread>` — libc++ `#error`s the whole header
    //  13/27  glog's own interface names `std::thread::id` at logging.h:123
    //  27/27  remill's ArchLocker needs `std::mutex`, and LLVM's RWMutex `<shared_mutex>`
    //
    // None of it needed threading. `llvm-nm --undefined-only` over all 27 objects finds ZERO
    // references to pthread_create, thread_spawn, pthread_join or any std::thread member —
    // elflift is single-threaded code that only wanted the headers to exist.
    expect(ok.length).toBe(27)
    const bytes = ok.reduce((sum, tu) => sum + (tu.objectBytes ?? 0), 0)
    expect(bytes).toBeGreaterThan(13_000_000)
    expect(bytes).toBeLessThan(16_000_000)
  })

  it.runIf(RUNNABLE)('states plainly that compiling is not linking', () => {
    if (report === undefined) throw new Error('no report')
    expect(report.cmakeExit).toBe(0)
    process.stdout.write(
      `[wasi-port] clang: ${report.clangVersion}\n` +
        `[wasi-port] AOTW-06 STAYS UNMET. This harness LINKS NOTHING: there is no elflift.wasm, ` +
        `no bitcode, and no sha256 compared against native elfconv's. What it establishes is ` +
        `that the compile half costs four small source changes, and that the unpaid cost is ` +
        `the wasm32-wasi LLVM cross-build\n`,
    )
  })

  it('says why it skipped, when it skips', () => {
    // A suite that skips silently is indistinguishable from one that passed.
    if (!RUNNABLE) process.stdout.write(`[wasi-port] SKIPPED: ${describeGate(REACH)}\n`)
    expect(typeof RUNNABLE).toBe('boolean')
  })
})
