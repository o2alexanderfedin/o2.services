/**
 * Every run says what the machine was doing while it was taken.
 *
 * ## The failure this exists to make impossible
 *
 * `CLAUDE.md` § Measurement says *"measure the process, not the machine"* and *"never write a
 * measured span you did not measure, and record the conditions beside it."* On 2026-08-27 both
 * sentences were in the repository and neither fired: a full browser-lane run took 498 s and
 * failed one chromium spec on a 65-second timeout, and *"the CI failure reproduces locally"*
 * was reported to the owner with a remedy attached. The host had been at a one-minute load
 * average near 400 for the whole run, because an unrelated project's `ctest -j 4` had been
 * spawning test binaries for over seven hours. The run measured contention with that and
 * nothing else.
 *
 * The reading was available the entire time and simply was not taken. The owner's ruling was
 * that a rule of this shape belongs in the tests rather than in a document. So the run takes
 * it, always, and says it out loud.
 *
 * ## Why a reporter and not a per-spec gate
 *
 * A browser spec cannot call `loadavg()` — there is no `node:os` in a browser — and the run
 * that produced the wrong conclusion was a browser run. A reporter is Node whatever the lane
 * is, which makes it the only level all five projects can be reached at.
 *
 * `transport-bounds.node.test.ts`'s per-spec gate stays where it is and is deliberately not
 * generalised: its ceiling is sited on that spec's own observed readings, and a shared constant
 * would be a different claim wearing its number.
 *
 * ## It prints and never fails the run
 *
 * A green run on a loaded host is green — contention does not make a passing assertion false.
 * What contention destroys is every claim about *duration* and every failure whose shape is a
 * timeout. Failing the run would say the opposite, and would make the instrument refuse
 * precisely the runs it is cheapest to take. So the exit code is untouched and the verdict is
 * a banner carrying both numbers.
 *
 * ## What is deliberately NOT recorded here
 *
 * `(user+sys)/real`, which `CLAUDE.md` asks for beside a span. `process.cpuUsage()` in a
 * reporter covers the runner process and would miss forked workers entirely and browser
 * processes completely — for the browser lane it would be near-noise presented as a run
 * ratio, which is the same defect as the one above wearing a different number. That ratio
 * belongs to an outer `/usr/bin/time -p` around the whole command, and this file does not
 * pretend to it.
 */

import { cpus, loadavg } from 'node:os'

/**
 * Load per core above which a duration reading is not evidence.
 *
 * **Sited on readings, not chosen as a margin**, the way `transport-bounds.node.test.ts` sites
 * its own — above every recorded pass, below every observed failure, widened only by adding
 * readings to those two lists.
 *
 * | reading | raw load | 8 cores | outcome |
 * |---|---|---|---|
 * | `--project node` (vitest.config.ts:45) | 6.68 | 0.84 | passed |
 * | `--project node` (vitest.config.ts:47) | 5.20 | 0.65 | passed |
 * | `--project aot` (vitest.config.ts:46) | 18.95 | 2.37 | passed |
 * | browser lane, 2026-08-27 | 396–489 | 49.5–61.1 | one spec timed out at 65 s |
 *
 * The `aot` row is the interesting one and is why the banner prints numbers rather than
 * failing the run: that lane sat at 2.37 per core and its results were sound, because its
 * `(user+sys)/real` was **0.090** — the process was waiting on a container, not starving for
 * CPU. Load alone cannot tell those apart, so the instrument reports and a reader judges.
 */
export const LOAD_PER_CORE_CEILING = 4

/** What the host was doing, and what the run may therefore be used for. */
export interface HostConditions {
  /** One-minute load average sampled before the first module ran. */
  readonly loadBefore: number
  /** The same, sampled after the last one — `loadavg` lags, so both are needed. */
  readonly loadAfter: number
  readonly cpus: number
  readonly failures: number
}

/**
 * What a run is good for.
 *
 * - `sound` — the host was quiet; the run means what it says.
 * - `timings-unsound` — the host was oversubscribed but nothing failed. Pass/fail stands;
 *   every duration in the run is void.
 * - `failures-not-evidence` — the host was oversubscribed AND something failed. The failures
 *   may be real, but this run cannot tell, and a conclusion drawn from them is the mistake
 *   this file exists to prevent.
 */
export type HostConditionsKind = 'sound' | 'timings-unsound' | 'failures-not-evidence'

export interface HostConditionsReading {
  readonly kind: HostConditionsKind
  readonly saturated: boolean
  readonly perCoreBefore: number
  readonly perCoreAfter: number
  readonly message: string
}

/**
 * The whole decision, as a pure function so it can be tested without a loaded machine.
 *
 * **Either sample is enough.** `loadavg()[0]` is a one-minute average and therefore lags the
 * contention it stands for: `transport-bounds.node.test.ts` records a suite that began at load
 * 5.20 and read 51 MB against a 40 MB threshold as its other files spun up. A before-only
 * sample cannot see that, because at the moment it sampled the host really was quiet.
 */
export function hostConditionsVerdict(conditions: HostConditions): HostConditionsReading {
  const cores = conditions.cpus > 0 ? conditions.cpus : 1
  const perCoreBefore = conditions.loadBefore / cores
  const perCoreAfter = conditions.loadAfter / cores
  const saturated = perCoreBefore >= LOAD_PER_CORE_CEILING || perCoreAfter >= LOAD_PER_CORE_CEILING

  const readings =
    `load/core ${perCoreBefore.toFixed(2)} before, ${perCoreAfter.toFixed(2)} after ` +
    `(${cores} cores, ceiling ${LOAD_PER_CORE_CEILING.toFixed(2)})`

  if (!saturated) {
    return {
      kind: 'sound',
      saturated,
      perCoreBefore,
      perCoreAfter,
      message: `host was quiet — ${readings}`,
    }
  }

  if (conditions.failures === 0) {
    return {
      kind: 'timings-unsound',
      saturated,
      perCoreBefore,
      perCoreAfter,
      message:
        `HOST WAS OVERSUBSCRIBED — ${readings}. Nothing failed, so pass/fail stands. ` +
        'Every DURATION in this run is void: do not quote a wall clock, a span or a ' +
        'timeout from it, and re-run on a quiet host before writing one down.',
    }
  }

  return {
    kind: 'failures-not-evidence',
    saturated,
    perCoreBefore,
    perCoreAfter,
    message:
      `HOST WAS OVERSUBSCRIBED AND ${conditions.failures} TEST(S) FAILED — ${readings}. ` +
      'These failures are NOT evidence about the code. A timeout on a contended host is a ' +
      'statement about the host. Re-run on a quiet machine before reporting, diagnosing or ' +
      'proposing a remedy for any of them.',
  }
}

/** `loadavg()` without the tuple-index narrowing noise at every call site. */
function oneMinuteLoad(): number {
  return loadavg()[0] ?? 0
}

/**
 * The vitest reporter. Wired at the ROOT of `vitest.config.ts` so every project inherits it —
 * reporters are run-level rather than per-project, and `host-conditions-wired.node.test.ts`
 * pins that wiring so it cannot be dropped without a red.
 *
 * **A CLI `--reporter=` overrides config reporters and therefore removes this one.** That hole
 * cannot be closed from the config; the repository's own measurement procedure
 * (`vitest.config.ts`, the `--reporter=json` recipe) names this file alongside its own so the
 * documented path keeps its conditions.
 */
export default class HostConditionsReporter {
  #loadBefore = 0
  #failures = 0
  #startedAt = 0

  onTestRunStart(): void {
    this.#loadBefore = oneMinuteLoad()
    this.#startedAt = performance.now()
  }

  onTestModuleEnd(module: { readonly errors?: () => readonly unknown[] }): void {
    // Counted per module rather than per case: the reporter API hands modules, and one failed
    // module is already enough to make the verdict the strict one.
    try {
      const errors = module.errors?.() ?? []
      if (errors.length > 0) this.#failures += errors.length
    } catch {
      // A reporter that throws would take the run's own report with it. The count is an input
      // to a banner, so losing one is worth strictly less than losing the run's output.
    }
  }

  onTestCaseResult(testCase: { readonly result: () => { readonly state: string } }): void {
    try {
      if (testCase.result().state === 'failed') this.#failures += 1
    } catch {
      // As above.
    }
  }

  onTestRunEnd(): void {
    const verdict = hostConditionsVerdict({
      loadBefore: this.#loadBefore,
      loadAfter: oneMinuteLoad(),
      cpus: cpus().length,
      failures: this.#failures,
    })
    const wallClockMs = performance.now() - this.#startedAt
    const banner = verdict.kind === 'sound' ? '' : '\n' + '='.repeat(78)
    process.stdout.write(
      `${banner}\n[host conditions] ${verdict.message}\n` +
        `[host conditions] wall clock ${(wallClockMs / 1000).toFixed(2)} s` +
        `${verdict.saturated ? ' — see above before quoting this number' : ''}\n` +
        `${banner}\n`,
    )
  }
}
