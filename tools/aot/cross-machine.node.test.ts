import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it, vi } from 'vitest'

import { describeGate, isRunnable, probeDockerReach } from './docker-gate.ts'
import { ELFCONV_IMAGE_TAG, liftElf } from './lift.ts'

/**
 * AOT-03's cross-machine half — **the obvious local shortcut, measured closed.**
 *
 * ## The question this file answers
 *
 * AOT-03 asks for byte-identical artifacts from repeated lifts of identical input. The
 * one-host half is established. The cross-machine half has been carried as *"descoped and
 * unmeasured"* on the grounds that it needs a second physical machine — and the obvious
 * objection to that is that this host can run two machine architectures right now: the
 * elfconv project publishes both `ghcr.io/yomaytk/elfconv:arm64` and `:amd64`, both are
 * present here, and Docker will run either. `uname -m` inside them reports `aarch64` and
 * `x86_64`. Two instruction sets, two libc builds, two engine builds — the exact three
 * variables BENCH-06 says a same-host run holds constant.
 *
 * **So it was tried, and it does not work — for a reason that is a property of elfconv
 * rather than of this host.** Swapping the image does not move the same translator to
 * another machine. It swaps the translator: `backend/remill/lib/Arch/Arch.cpp` gates the
 * AArch64 dispatch behind `#if defined(ELFCONV_AARCH64_BUILD)` and the X86 dispatch behind
 * `#if defined(ELFCONV_X86_BUILD)`, and no build defines both. The `:amd64` image is an
 * X86-front-end build. Handed this repository's AArch64 fixture it reaches the `default:`
 * arm of that switch and calls `LOG(FATAL)`.
 *
 * Measured 2026-08-17 on this host:
 *
 * ```
 * :arm64  ok in 367776ms  sha256 8dcf62e1cc9859b60ae6750b1035f25ff4d4bebacc87310e96fa346617691c28
 * :amd64  FAILED after 18522ms — exit 134
 *         F20260817 05:34:38 Arch.cpp:211] OS: 2 ArchName: 8
 *         @ remill::Arch::GetArchByName(llvm::LLVMContext*, remill::OSName, remill::ArchName)
 * ```
 *
 * There is no artifact on the second machine to compare, so nothing about reproducibility
 * was learned — and that is the finding. **What AOT-03 needs is a second host running the
 * SAME elfconv build**, i.e. a second `aarch64` Linux machine. ~~which is a thing this
 * repository does not have and cannot synthesise~~ — **RETIRED 2026-08-30, and it was wrong
 * rather than merely stale.** `o2alexanderfedin/o2.services` is a PUBLIC repository, read
 * with `gh repo view --json visibility` answering `{"visibility":"PUBLIC"}`, and GitHub
 * offers hosted **Linux arm64** runners. A second aarch64 Linux host is obtainable; what the
 * retired clause described was effort, not a physical wall, and this project has a standing
 * record of stating the second when it means the first.
 *
 * The arrangement now exists — `.github/workflows/aot-cross-host.yml`, dispatched by hand
 * and by nothing else, with `tools/aot/cross-host-lift.mjs` producing one host's reading.
 * **What is still unmeasured is whether `ubuntu-24.04-arm` is schedulable for this
 * repository**, which is a claim read off documentation; the workflow's cheap `report-host`
 * job is that experiment, and a job that never starts is the answer as much as one that
 * finishes. `CROSS_MACHINE_BLIND_SPOT` stays attached to every artifact until two readings
 * exist and have been compared — the dispatch is an owner act, because it is a push to a
 * public repository.
 *
 * ## Why this is a spec rather than a note in a planning document
 *
 * Because a note would be the same shape as the 27/27 measurement this project lost — a
 * sentence in a working tree nobody kept. If elfconv ever ships a build defining both flags,
 * the second case here goes red, and the comparison becomes available again. That is worth
 * more than a paragraph asserting it never will.
 */

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const AARCH64_FIXTURE = fileURLToPath(new URL('./fixtures/elf/hello_static', import.meta.url))
const ARCH_CPP = `${REPO_ROOT}third_party/elfconv/backend/remill/lib/Arch/Arch.cpp`

/** The sibling image, built for the other machine architecture. */
const X86_IMAGE_TAG = 'ghcr.io/yomaytk/elfconv:amd64'

/**
 * The refusal is fast — it happens during arch dispatch, before a single instruction is
 * decoded, and was measured at 18.5 s including image resolution. Sited an order of
 * magnitude above that rather than against the successful lift's 368 s, because this file
 * never waits for a successful lift.
 */
const HARNESS_BUDGET_MS = 300_000
vi.setConfig({ testTimeout: HARNESS_BUDGET_MS, hookTimeout: HARNESS_BUDGET_MS })

const REACH = await probeDockerReach()
const RUNNABLE = isRunnable(REACH)

/** `uname -m` inside an image, which is the only claim about it this file needs. */
function machineOf(image: string): string {
  const run = spawnSync(
    'docker',
    ['run', '--rm', '--entrypoint', '/usr/bin/uname', image, '-m'],
    { encoding: 'utf8', timeout: 120_000 },
  )
  return run.stdout.trim()
}

describe('AOT-03 — swapping the image swaps the translator, not the machine', () => {
  it('elfconv compiles exactly one architecture front end, chosen at build time', () => {
    // The attribution, read from the submodule rather than inferred from a crash. Both
    // dispatches are conditional and the `default:` arm below them is a `LOG(FATAL)`, so a
    // build that omits a front end does not degrade — it aborts.
    const source = readFileSync(ARCH_CPP, 'utf8')
    expect(source).toContain('#if defined(ELFCONV_AARCH64_BUILD) && ELFCONV_AARCH64_BUILD == 1')
    expect(source).toContain('#if defined(ELFCONV_X86_BUILD) && ELFCONV_X86_BUILD == 1')
    expect(source).toContain('LOG(FATAL) << "OS: " << os_name_ << " ArchName: " << arch_name_;')

    // And the AArch64 case really is inside the guarded region rather than merely near it —
    // otherwise the abort below would need a different explanation.
    const guarded = source.slice(
      source.indexOf('#if defined(ELFCONV_AARCH64_BUILD)'),
      source.indexOf('#endif', source.indexOf('#if defined(ELFCONV_AARCH64_BUILD)')),
    )
    expect(guarded).toContain('case kArchAArch64LittleEndian:')
  })

  it.runIf(RUNNABLE)('the two published images really are two machine architectures', () => {
    // Without this the case below would prove nothing about machines: an image that reported
    // `aarch64` under both tags would make the refusal a packaging accident.
    expect(machineOf(ELFCONV_IMAGE_TAG)).toBe('aarch64')
    expect(machineOf(X86_IMAGE_TAG)).toBe('x86_64')
  })

  it.runIf(RUNNABLE)(
    'the x86_64 image refuses the AArch64 input, so there is no second artifact to compare',
    async () => {
      const outcome = await liftElf(AARCH64_FIXTURE, {
        image: X86_IMAGE_TAG,
        timeoutMs: HARNESS_BUDGET_MS,
      })

      expect(outcome.ok).toBe(false)
      if (outcome.ok) throw new Error('unreachable')
      const failure = outcome.failure
      // Named precisely. `toolchain-failed` and not `timed-out`, `refused-by-screen` or
      // `docker-unavailable`: the container ran, the lifter started, and it decided it could
      // not proceed. Any other kind here would be a different finding wearing this one's
      // clothes.
      expect(failure.kind).toBe('toolchain-failed')
      if (failure.kind !== 'toolchain-failed') throw new Error('unreachable')
      // 134 is 128 + SIGABRT, which is what `LOG(FATAL)` produces.
      expect(failure.exitCode).toBe(134)

      const said = failure.unparsed.map((line) => line.text).join('\n')
      expect(said).toContain('Arch.cpp:211')
      // `ArchName: 8` is `kArchAArch64LittleEndian` — the lifter identified the input
      // correctly and then had no case to dispatch it to. That distinction is the whole
      // finding: this is not a misread ELF, it is a translator without that front end.
      expect(said).toMatch(/ArchName: 8/)
    },
  )

  it('says why it skipped, when it skips', () => {
    // The rule `docker-gate.ts` exists for: a suite that skips silently is indistinguishable
    // from one that passed. Printed unconditionally so a reader of a green run knows which.
    process.stdout.write(`[cross-machine] docker: ${describeGate(REACH)}\n`)
    process.stdout.write(
      `[cross-machine] AOT-03's cross-machine half stays UNMEASURED: the second machine ` +
        `available on this host runs a DIFFERENT elfconv build, and what the row needs is a ` +
        `second aarch64 Linux host running the same one\n`,
    )
    expect(typeof RUNNABLE).toBe('boolean')
  })
})
