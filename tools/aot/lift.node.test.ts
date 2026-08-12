import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { MemoryBlockstore } from '@o2/core'
import { describeKey, describeKeyFailure, translationCid } from '@o2/aot'
import type { TranslationRecord } from '@o2/aot'
import {
  CROSS_MACHINE_BLIND_SPOT,
  DEFAULT_TIMEOUT_MS,
  ELFCONV_IMAGE_TAG,
  IMAGE_RESOLVE_CAP_MS,
  LIFT_TARGET,
  REACHABILITY_BLIND_SPOT,
  UNDECODED_ADDRESSES_UNRECOVERED_BLIND_SPOT,
  UNDECODED_UNMEASURED_BLIND_SPOT,
  UNDECODED_UNREADABLE_BLIND_SPOT,
  blindSpotsFor,
  classifySpawnFailure,
  describeFinding,
  describeLift,
  describeLiftFailure,
  liftElf,
  readTargetFeatures,
  readUndecoded,
  resolveImage,
  scanStream,
  scanToolchainOutput,
  translationKeyOf,
  unidentifiedIn,
  verdictOf,
} from './lift.ts'
import type {
  LiftFailure,
  LiftFinding,
  LiftOutcome,
  LiftedArtifact,
  UndecodedProbe,
} from './lift.ts'
import {
  ACCEPTABLE_ARTIFACT,
  FOREIGN_DIGESTS,
  MATCHING_DIGEST,
  cleanupStubs,
  emitDigests,
  stubDir,
  stubDocker,
  stubLift,
  writeAcceptableElf,
} from './stubs.ts'
import type { StubDocker } from './stubs.ts'
import { describeGate, gateOnImage, isRunnable, isUndetermined } from './docker-gate.ts'
import type { ImageGate } from './docker-gate.ts'

/**
 * AOT-01 — the toolchain runs, and nothing it says about itself is taken on trust.
 *
 * Split by cost, because a suite that takes three minutes and six gigabytes is a
 * suite nobody runs, and a guard nobody runs is not a guard:
 *
 * - **Fast.** Everything over captured output and byte literals. No container, no
 *   Docker, milliseconds. This is where the scanner and the feature reader are held
 *   to their contracts, and where the mutation tests live.
 * - **Integration.** One real lift, and a second of the same bytes for
 *   reproducibility. `skipIf` on Docker's absence, generously timed.
 *
 * ## Where the fixtures came from
 *
 * `clean-lift.*` and `system-registers.*` are **verbatim captures** from
 * `ghcr.io/yomaytk/elfconv@sha256:22a404f3…` on 2026-07-27, of a static
 * `int main(void){ return 42; }` and of a binary carrying `mrs`/`msr` against
 * `sctlr_el1`, `id_aa64isar0_el1` and `tpidr_el1` respectively. `aborted-lifter.stderr`
 * is a verbatim capture of a `-nostdlib` input, which aborts the lifter with 134.
 *
 * `planted-unsupported-instructions.stdout.txt` is **not** a capture, and is named so
 * that nobody mistakes it for one. In this image the `[Bug]` path could not be
 * provoked within the time available: the instructions that lack a semantics function
 * turn out to also fail to decode, which in this build is silent. The planted lines
 * are written against the literal `printf` format strings in the image
 * (`backend/remill/lib/BC/InstructionLifter.cpp:115`,
 * `backend/remill/lib/Arch/AArch64/Arch.cpp:904` and `:925`) — read out of the
 * container, and confirmed present verbatim in `strings /root/elfconv/bin/elflift`.
 * That is weaker evidence than a capture and is recorded as such.
 */

/**
 * A framework budget equal to the driver's own budget is the defect, not a generous
 * budget.
 *
 * The `node` project's default `testTimeout` is 5 s and this file declared none, while
 * six cases below handed `resolveImage` a budget of exactly `5_000`. Two timers armed
 * for the same instant, and vitest's is armed first — so a stub that was slow to spawn
 * killed the *test* rather than letting the driver's own timer fire, and the case
 * reported `Error: Test timed out in 5000ms` at 5006 ms instead of asserting the
 * classification it exists to check. Those six are about which `LiftFailure` comes
 * back, not about how long anything took. Their budget is now
 * {@link METADATA_BUDGET_MS}, which sits well inside this one.
 *
 * 60 s, chosen the way `packages/demo/src/kernel.test.ts` chose its own — but against
 * the worst case this file can construct rather than the typical one, which is the
 * mistake being corrected here. The slowest unskipped cases are the two deliberate
 * timeouts in "a container that outlived its client". They spend
 * {@link TIMEOUT_CASE_BUDGET_MS} by construction, and then the driver spends its own
 * `CONTAINER_REMOVE_TIMEOUT_MS` — 30 s — trying to kill the container it just
 * abandoned. The stub answers that `rm` immediately, so they measure about 5.4 s each;
 * a stub that did not would make it 35 s, and 60 s has to cover that too. Wide enough
 * that load cannot decide a verdict, tight enough to still catch a hang. The
 * integration cases at the foot of the file pass their own explicit timeouts and are
 * untouched by this line.
 *
 * ## Why there is no `loadavg()` gate below this line
 *
 * This file was carried as "has timing bounds and no load gate — 6 known failures at
 * load ≈45", with the fix written as: copy the `transport-bounds.node.test.ts` gate and
 * site a `LOAD_CEILING` on the 45-vs-4.41 readings. That gate was not added, because
 * measuring first showed there is nothing left for it to protect.
 *
 * The six failures were real, and they were the `EAGAIN` defect: `spawn` refused by a
 * full process table, reported as `docker-unavailable`, in about a millisecond. They
 * are fixed at the source — `host-cannot-spawn` names the host, and
 * {@link despiteAFullProcessTable} retries that one condition. Three things were then
 * measured on 2026-08-01, and none of them is load-sensitive:
 *
 * 1. **The only wall-clock assertion.** 64 samples across load 10 → 64: worst 702 ms
 *    against the 8 000 ms bound it then had. That bound is gone — the assertion is a
 *    difference between two arms of the same case now, which cancels load rather than
 *    surviving it. See {@link WEDGE_BUDGET_SHORT_MS}.
 * 2. **This budget.** The two slowest unskipped cases — the deliberate timeouts, which
 *    the paragraph above sizes this constant against — measured **5 519 ms and
 *    5 499 ms at load average 55–56**, against the ~5.4 s they take on an idle host.
 *    Load moved them by about 2%, because they are dominated by the driver's own 5 s
 *    timer rather than by scheduling. 60 000 is 10.9× the worst of them.
 * 3. **The population that actually failed.** All 34 stub-`docker` cases, run three
 *    times over a load average falling from 54 to 10: **102 of 102 passed.**
 *
 * A gate keyed on load ≈45 would sit inside a band where every measured sample passes
 * with an order of magnitude to spare — it could only ever skip cases that were going
 * to pass, which converts a green run into a silent one. That is a worse failure than
 * the flake it would be replacing, and unlike the flake it would never be noticed. The
 * gate goes in when a bound is measured to fail under load, and no bound here is.
 *
 * ## What the ten `60000ms` timeouts actually were — measured 2026-08-03
 *
 * `.planning/phases/phase-18-…/deferred-items.md` recorded this file, run **alone on a
 * quiet host**, as `12 failed | 87 passed, 850 s`, ten of the twelve reading
 * `Error: Test timed out in 60000ms`, and read that as *"something makes these docker
 * invocations hang for a full 60 s apiece on an idle machine."*
 *
 * **That reading was false, and 60 000 was the tell: it is this constant.** Nothing hung
 * for sixty seconds. The framework killed each case at its own budget and reported its
 * own budget back — a measurement of the budget and of nothing else. A duration that
 * equals a timeout is evidence of the timeout.
 *
 * What was really there is the defect the first paragraph of this docblock says was
 * fixed, returned one level up. {@link despiteAFullProcessTable} was added on 2026-08-02
 * and retries `docker-not-answering`. Four attempts of {@link METADATA_BUDGET_MS} plus
 * the backoffs was **81 500 ms of driver budget inside a 60 000 ms case** — two timers
 * armed for the same instant again, and vitest's is still armed first. Eleven call sites
 * handed the wrapper a budget that large, and ten of them could actually spend it; the
 * eleventh is `/nonexistent/definitely-not-docker`, which fails `ENOENT` in about a
 * millisecond and is not retried. **Ten. That is the recorded count, exactly.**
 *
 * Reproduced rather than inferred, because a count that agrees with a theory is not the
 * theory's proof. One stub was changed to `exec sleep 25` — a single attempt that misses
 * its own 20 s budget — and the case died with `Error: Test timed out in 60000ms` at
 * **60 013 ms**. The identical plant with the retry disabled failed at **20 016 ms** with
 * `expected 'docker-not-answering' to be 'image-digest-foreign'`: the driver's own named
 * answer, in a third of the wall clock. The retry did not make this file flaky. It made
 * the file's flake *unreadable*, and tripled what each instance cost — which is where
 * 850 s came from: ~250 s of real work plus ten framework kills of 60 s each.
 *
 * The fix is {@link RETRY_ENVELOPE_SHARE}: the wrapper now reports before the framework
 * can, and says what it measured while doing so.
 *
 * ## And what this file costs when nothing is wrong
 *
 * Two whole-file runs on 2026-08-03, both **99 passed, exit 0**, timed with
 * `/usr/bin/time -p` because system load average says nothing about whether *this*
 * process got a core:
 *
 * | condition | `real` | `user` | `sys` | `(user+sys)/real` | Σ case spans |
 * |---|---|---|---|---|---|
 * | alone, host at 1-min load 5.9 | 216.83 s | 2.31 s | 0.69 s | **0.0138** | 15.96 s |
 * | under 12 CPU burners + 6 fork loops, load 40 → 102 | 284.29 s | 2.69 s | 0.74 s | **0.0121** | 17.51 s |
 *
 * Both ratios are near zero, which is the comparability key for a spec that spends its
 * life in `spawn`: it is waiting, not starving. Two things follow. Load moved the
 * **cases** by 9.7 % (15.96 s → 17.51 s summed) and the **wall clock** by 31 %, because
 * 93 % of this file's wall clock is the integration `beforeAll` — three real container
 * runs the per-case reporter attributes to nothing at all. And the worst single stub case
 * went 211 ms → 337 ms at load 102, against the 20 000 ms budget it was handed. The
 * budgets were never it, again.
 */
const CASE_BUDGET_MS = 60_000

vi.setConfig({ testTimeout: CASE_BUDGET_MS })

/**
 * What the cases that are *about classification* hand `resolveImage`.
 *
 * Each of them stubs `docker` with a shell script that answers immediately, so this
 * bound is only ever reached by a stub that has wedged — and when it is reached the
 * answer has to be the driver's `docker-unavailable`, carrying the detail string that
 * names the number, rather than a framework kill that names nothing.
 *
 * Measured on this host on 2026-07-31, with an unrelated LLVM build saturating it —
 * load average 30 on 8 cores: 40 spawns of this same `#!/bin/sh` stub, written to
 * `tmpdir()` and read back over a pipe, cost p50 200 ms, p90 279 ms, max 425 ms. 20 s
 * is 47× that worst sample, so nothing but a genuine wedge reaches it, and it is a
 * third of the framework budget above, so when something does reach it the driver's
 * timer fires first with 40 s to spare.
 *
 * **Re-measured 2026-08-01, and the number was never the problem.** This file was
 * failing intermittently on loaded hosts — 3 to 6 cases at a time, reported by three
 * separate agents — and every report read `docker-unavailable`, which was the
 * suspicion against this constant. It was the wrong suspicion. Under synthetic load
 * driven to the band the failures were reported at, 60 spawns of this exact stub gave:
 *
 * | load average (1 min) | p50 | p90 | max | failed to spawn |
 * |---|---|---|---|---|
 * | 27.5 | 38 ms | 54 ms | 348 ms | 0 / 60 |
 * | 42.7 → 54.5 | 116 ms | 328 ms | **456 ms** | 0 / 60 |
 *
 * 456 ms is 44× under this budget and 11× under {@link TIMEOUT_CASE_BUDGET_MS}, which
 * is the smallest budget any case here hands the driver. For the timeout to have been
 * the cause, spawning would have had to be two orders of magnitude worse than it
 * measurably is at that exact load. What fires instead is the *other* path — see
 * {@link despiteAFullProcessTable} — and it fires in about a millisecond. The two
 * populations do not overlap, which is why the driver no longer gives them one name.
 *
 * **Confirmed a third time on 2026-08-03, at load 102**, which is past every band above:
 * the slowest case handed this budget measured **337 ms**, 59× under it. The number was
 * never the problem and is unchanged. What changed is what happens when it *is* spent —
 * see {@link RETRY_ENVELOPE_SHARE}. Four attempts of this budget do not fit inside
 * {@link CASE_BUDGET_MS}, so the wrapper now stops on its own measurement rather than
 * letting the framework stop it on nothing.
 */
const METADATA_BUDGET_MS = 20_000

/**
 * What the two cases that are *about the timeout firing* hand `liftElf`.
 *
 * Bounded on both sides, and the 700 ms this replaces satisfied only one side.
 * `liftElf` spends this budget twice: once on `docker image inspect`, where it is the
 * whole of it because `IMAGE_RESOLVE_CAP_MS` is 60 s and the smaller wins, and again on
 * `docker run` — which is the step these two cases are actually about. The inspect
 * costs one process spawn, and against the distribution above 700 ms was 1.6× the worst
 * sample. On the whole-file run of 2026-07-31 at load average 33 both cases spent it:
 * the inspect was SIGKILLed at its own budget, `liftElf` came back
 * `docker-unavailable`, and the `run` step never happened at all —
 * `expected 'docker-unavailable' to be 'timed-out'`, at 708 ms and 711 ms.
 *
 * 5 s is 12× that worst measured spawn, so the inspect cannot eat the budget; and a
 * sixth of the stub's `exec sleep 30`, so the `run` step is still ended by the driver's
 * timer rather than by the sleep returning on its own — which would come back
 * `no-artifact` and be a different test. It costs 5 s of wall clock twice, against a
 * file that takes 280 s.
 */
const TIMEOUT_CASE_BUDGET_MS = 5_000

/**
 * The two budgets the wedged-inspect case asks for, so its claim can be read as a
 * **difference** rather than as a threshold.
 *
 * This was `TIMER_BEAT_A_HARDCODED_MINUTE_MS = 8_000` and a single
 * `expect(elapsed).toBeLessThan(8_000)` — the file's only wall-clock assertion, and
 * therefore the whole of its exposure to machine load. It was well sited: measured
 * 2026-08-01 across 64 replays, the passing population ran p50 404 ms / max 418 ms at
 * load 10 and p50 440 ms / max 702 ms at load 64, against a failing population at
 * ~60 000 ms. Two orders of magnitude between them and no arithmetic choice inside the
 * gap changes an answer.
 *
 * It is replaced anyway, because a well-sited absolute is still an absolute: 8 000 ms
 * encodes *this* machine's spawn cost on *that* day, and the same reading somewhere
 * slower is either a false red or — worse — a bound so generous it stopped saying
 * anything. The claim being made has a comparative form that needs no siting at all.
 *
 * The claim is *"the caller's timeout reached `resolveImage`"*. So ask twice in the same
 * run, with two budgets, and read the **difference**:
 *
 *     elapsed(LONG) − elapsed(SHORT)  ≈  LONG − SHORT
 *
 * Spawn overhead, machine speed and the I/O weather of the day all appear in both terms
 * and **cancel exactly** — algebraically, not approximately, which is the property a
 * ratio of raw elapsed times would not have. What survives is only the driver's response
 * to what it was asked for.
 *
 * **What makes it fail.** A driver that stops honouring the caller's budget — the
 * hardcoded `60_000` this case was written against — makes both arms cost the same, so
 * the difference collapses toward zero and lands under
 * {@link WEDGE_DIFFERENCE_FLOOR} × 1 600 ms = 800 ms. Planted and watched: with
 * `resolveImage` given a fixed budget instead of the caller's, both arms ran to the
 * stub's own `sleep` and the case went red. The other direction is bounded too — a
 * driver that spends more than {@link WEDGE_DIFFERENCE_CEILING} × the extra budget it
 * was handed is overshooting and also fails.
 *
 * **What it costs to be wrong by accident.** The two arms differ by 1 600 ms of
 * requested budget. The worst *drift* ever measured on this host, load 10 → 102, is
 * ~300 ms — so an accidental red needs the jitter between two arms taken seconds apart
 * to exceed five times the worst drift on record.
 */
const WEDGE_BUDGET_SHORT_MS = 400
/** 5× the short arm, so the requested difference dominates every drift measured here. */
const WEDGE_BUDGET_LONG_MS = 2_000
/** Below this share of the requested difference, the driver is not tracking the request. */
const WEDGE_DIFFERENCE_FLOOR = 0.5
/** Above this share, it is spending more than it was asked for. */
const WEDGE_DIFFERENCE_CEILING = 2

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url))

const fixture = (name: string): string => readFileSync(join(FIXTURES, name), 'utf8')

const CLEAN_STDOUT = fixture('clean-lift.stdout.txt')
const CLEAN_STDERR = fixture('clean-lift.stderr.txt')
const SYSREG_STDOUT = fixture('system-registers.stdout.txt')
const SYSREG_STDERR = fixture('system-registers.stderr.txt')
const PLANTED_STDOUT = fixture('planted-unsupported-instructions.stdout.txt')
const ABORTED_STDERR = fixture('aborted-lifter.stderr.txt')

const NO_PROBE: UndecodedProbe = { kind: 'not-run', why: 'no-bitcode' }
const PROBE_FOUND_NOTHING: UndecodedProbe = { kind: 'measured', callSites: 0, addresses: [] }
/**
 * The probe's count grep matched and its address grep did not.
 *
 * 259 because that is the real figure from the recorded lift — the same number of
 * `__ecv_warning` calls the measured probe found 174 addresses in. A shape change to
 * the emitted call leaves exactly the first of those two greps working.
 */
const PROBE_COUNTED_ONLY: UndecodedProbe = { kind: 'counted-only', callSites: 259 }

// ---------------------------------------------------------------------------
// The scanner, over real captured output.
// ---------------------------------------------------------------------------

describe('the fixtures are the output they claim to be', () => {
  /**
   * Every scanner assertion below is of the form "these findings and no others". An
   * empty fixture — a bad path, a truncated copy — satisfies most of them perfectly.
   * So the fixtures are shown to contain the lift they are named for first.
   */
  it('captured a whole lift, not a fragment of one', () => {
    expect(CLEAN_STDOUT).toContain('ELF -> LLVM bitcode')
    expect(CLEAN_STDOUT).toContain('built subject.elf.wasm')
    expect(CLEAN_STDOUT.split('\n').length).toBeGreaterThan(10)
    expect(CLEAN_STDERR.length).toBeGreaterThan(200)
  })

  it('kept the terminal colour codes elfconv actually emits', () => {
    // The INFO tags arrive wrapped in \033[32m. If a fixture were hand-typed they
    // would be missing, and the scanner's ANSI stripping would go untested.
    expect(CLEAN_STDOUT).toContain('[32m')
  })
})

describe('a clean lift is reported as clean', () => {
  const scan = scanToolchainOutput(CLEAN_STDOUT, CLEAN_STDERR)

  it('finds nothing in output that says nothing', () => {
    expect(scan.findings).toEqual([])
  })

  it('leaves no diagnostic unparsed, so the noise floor is genuinely zero', () => {
    // clang's -Wignored-attributes block and wasmedge's [info] lines are in this
    // fixture. If either leaked into `unparsed`, every real lift would carry
    // permanent noise and the channel would stop being read.
    expect(scan.unparsed).toEqual([])
  })

  it('read the lines it was given', () => {
    expect(scan.linesRead).toBeGreaterThan(30)
  })
})

describe('an unmodelled system register is extracted from the glog line it hides in', () => {
  const scan = scanToolchainOutput(SYSREG_STDOUT, SYSREG_STDERR)

  it('finds all three, and only three', () => {
    expect(scan.findings.map((f) => f.kind)).toEqual([
      'unknown-system-register',
      'unknown-system-register',
      'unknown-system-register',
    ])
  })

  it('reads the encoding out of each, as literals nobody computed', () => {
    // Hardcoded from the captured stderr: sctlr_el1, id_aa64isar0_el1, tpidr_el1.
    // Computing these from the fixture would only prove the parser agrees with
    // itself.
    const encodings = scan.findings.flatMap((f) =>
      f.kind === 'unknown-system-register'
        ? [{ encoding: f.encoding, op0: f.op0, op1: f.op1, crn: f.crn, crm: f.crm, op2: f.op2 }]
        : [],
    )
    expect(encodings).toEqual([
      { encoding: 0xc080, op0: 3, op1: 0, crn: 1, crm: 0, op2: 0 },
      { encoding: 0xc030, op0: 3, op1: 0, crn: 0, crm: 6, op2: 0 },
      { encoding: 0xc684, op0: 3, op1: 0, crn: 0xd, crm: 0, op2: 4 },
    ])
  })

  it('attributes them to stderr, where glog actually put them', () => {
    // The stream matters: a caller merging the two loses the ability to tell a
    // lifter diagnostic from a compiler one, and they need different responses.
    expect(scan.findings.every((f) => f.stream === 'stderr')).toBe(true)
  })

  it('does not mistake the timestamp or thread id for part of the message', () => {
    const [first] = scan.findings
    expect(first?.raw).toContain('E20260727')
    expect(first?.raw).toContain('Arch.cpp:4196')
  })

  it('leaves the surrounding compiler warnings alone', () => {
    expect(scan.unparsed).toEqual([])
  })
})

describe('an unsupported instruction is never reported as a clean lift', () => {
  const scan = scanToolchainOutput(PLANTED_STDOUT, '')

  it('extracts every occurrence, with its address and instruction form', () => {
    // Literals, matching the planted lines exactly. Note the fourth: %08lx pads to
    // eight digits but does not truncate, so a 16-digit address is a real shape and
    // a parser anchored on eight would drop it.
    const parsed = scan.findings.flatMap((f) =>
      f.kind === 'no-semantics' ? [{ address: f.address, form: f.instructionForm }] : [],
    )
    expect(parsed).toEqual([
      { address: 0x0041a2c4n, form: 'CASPAL_CP64_LDSTEXCL' },
      { address: 0x0041a2c8n, form: 'FRINT32Z_S_FLOATDP1' },
      { address: 0x0041a2ccn, form: 'SM3SS1_VVV4_CRYPTO4' },
      { address: 0x004a1b30n, form: 'FRINT64X_D_FLOATDP1' },
    ])
  })

  it('extracts the two WARNING forms this image compiles out but another may not', () => {
    const decode = scan.findings.filter((f) => f.kind === 'decode-failed')
    const extract = scan.findings.filter((f) => f.kind === 'extract-failed')
    expect(decode).toHaveLength(1)
    expect(extract).toHaveLength(1)
    expect(decode[0]?.kind === 'decode-failed' ? decode[0].instructionForm : '').toBe('LD1B_Z_P_BI_U8')
    expect(extract[0]?.kind === 'extract-failed' ? extract[0].byteLength : -1).toBe(4)
  })

  it('refuses the verdict "clean" even when the probe found nothing else', () => {
    // The point of the whole exercise: elfconv exited 0 and printed six INFO lines
    // around these. Nothing about that may add up to a clean success.
    expect(verdictOf(scan.findings, scan.unparsed, PROBE_FOUND_NOTHING)).toBe('reservations')
  })

  it('does not swallow the INFO lines it is interleaved with', () => {
    expect(scan.findings).toHaveLength(6)
    expect(scan.unparsed).toEqual([])
  })
})

describe('an aborting lifter is surfaced even though nothing parses it', () => {
  const scan = scanToolchainOutput('', ABORTED_STDERR)

  it('reports the fatal message as an unrecognised diagnostic rather than dropping it', () => {
    // There is deliberately no parser for this. A message the scanner cannot
    // structure must still reach the build log, or the only evidence of a hard
    // failure is the number 134.
    expect(scan.unparsed.map((line) => line.text)).toEqual([
      'what():  [ERROR] [ERROR] entry_function is not found.',
    ])
  })

  it('produces no findings, because none of it is about an instruction', () => {
    expect(scan.findings).toEqual([])
  })
})

describe('the scanner can fail — proved by mutation, not assumed', () => {
  /**
   * Everything above passes trivially if the regexes never match, and "never
   * matches" is indistinguishable from "the lift was clean". So each parser is shown
   * to fire on text written for it, and the unparsed channel is shown to catch the
   * reformats that would otherwise be silent.
   */
  const PLANTED: readonly { readonly kind: LiftFinding['kind']; readonly line: string }[] = [
    {
      kind: 'no-semantics',
      line: '[Bug] Unsupported instruction at address: 0x0041a2c4 (SemanticsFunction), instForm: ADDV_ASIMDALL_ONLY',
    },
    {
      kind: 'decode-failed',
      line: '[WARNING] Unsupported instruction at address: 0x00417914 (TryDecode), instForm: LD1B_Z_P_BI_U8',
    },
    {
      kind: 'extract-failed',
      line: '[WARNING] Unsupported instruction at address: 0x00417918 (TryExtract) size: 4',
    },
    {
      kind: 'unknown-system-register',
      line: 'E20260727 06:40:33.654630 281472948068384 Arch.cpp:4196] Unrecognized system register c080 with op0=3, op1=0, crn=1, crm=0, op2=0, bits.name=0xc080',
    },
  ]

  for (const { kind, line } of PLANTED) {
    it(`flags a planted "${kind}"`, () => {
      expect(scanStream(line, 'stdout').findings.map((f) => f.kind)).toEqual([kind])
    })
  }

  it('does not silently drop a message whose format has drifted', () => {
    // The failure mode this channel exists for. Upstream renames the tag or moves a
    // field, every regex stops matching, and the scanner reports a clean lift
    // forever. Here the line still looks like a diagnostic, so it surfaces.
    const drifted = '[Bug] Unsupported insn @ 0x0041a2c4 (SemanticsFunction) form=ADDV_ASIMDALL_ONLY'
    const scan = scanStream(drifted, 'stdout')
    expect(scan.findings).toEqual([])
    expect(scan.unparsed.map((line) => line.text)).toEqual([drifted])
  })

  it('is not fooled by the colour codes elfconv wraps its tags in', () => {
    const coloured = '\u001b[31m[Bug]\u001b[0m Unsupported instruction at address: 0x00000004 (SemanticsFunction), instForm: NOP_HI_SYSTEM'
    expect(scanStream(coloured, 'stdout').findings.map((f) => f.kind)).toEqual(['no-semantics'])
  })

  it('keeps ordinary INFO narration out of both channels', () => {
    // If INFO reached `unparsed`, every lift would carry six entries and nobody
    // would read the seventh.
    const scan = scanStream(CLEAN_STDOUT, 'stdout')
    expect(scan.findings).toEqual([])
    expect(scan.unparsed).toEqual([])
  })
})

describe('a finding reads as evidence in a build log', () => {
  it('names the address and the form, in hex', () => {
    const [finding] = scanStream(
      '[Bug] Unsupported instruction at address: 0x0041a2c4 (SemanticsFunction), instForm: ADDV_ASIMDALL_ONLY',
      'stdout',
    ).findings
    expect(finding).toBeDefined()
    if (finding === undefined) return
    expect(describeFinding(finding)).toContain('0x0041a2c4')
    expect(describeFinding(finding)).toContain('ADDV_ASIMDALL_ONLY')
  })
})

// ---------------------------------------------------------------------------
// The feature reader, over byte literals.
// ---------------------------------------------------------------------------

const WASM_HEADER: readonly number[] = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]

/**
 * The `target_features` section, byte for byte, out of a real lifted artifact.
 *
 * Copied from `subject.elf.wasm` produced by
 * `ghcr.io/yomaytk/elfconv@sha256:22a404f3…` at `TARGET=aarch64-wasi32`. Kept as a
 * literal rather than read from a 5.66 MB artifact nobody would commit — and it is a
 * conformance vector, so it is written down, not derived.
 */
const REAL_SECTION: readonly number[] = [
  0, 57, 15, 116, 97, 114, 103, 101, 116, 95, 102, 101, 97, 116, 117, 114, 101, 115, 3, 43, 11, 98,
  117, 108, 107, 45, 109, 101, 109, 111, 114, 121, 43, 15, 109, 117, 116, 97, 98, 108, 101, 45, 103,
  108, 111, 98, 97, 108, 115, 43, 8, 115, 105, 103, 110, 45, 101, 120, 116,
]

const bytes = (...parts: readonly (readonly number[])[]): Uint8Array =>
  new Uint8Array(parts.flatMap((part) => [...part]))

/**
 * A section the test writes itself, for prefixes the real artifact does not use.
 *
 * `declaredCount` defaults to the truth and can be set to a lie, which is the only
 * way to reach the malformed-section branch without hand-poking a byte offset —
 * poking an offset is how the first attempt at that test silently corrupted the
 * section *name* instead and asserted the wrong failure.
 */
function targetFeatures(
  pairs: readonly (readonly [string, number])[],
  declaredCount: number = pairs.length,
): readonly number[] {
  const body: number[] = [declaredCount]
  for (const [name, prefix] of pairs) {
    body.push(prefix, name.length, ...[...name].map((c) => c.charCodeAt(0)))
  }
  const header = [...'target_features'].map((c) => c.charCodeAt(0))
  const payload = [header.length, ...header, ...body]
  return [0, payload.length, ...payload]
}

describe('the feature set is read from the artifact, never assumed', () => {
  it('reads exactly what a real elfconv wasi32 artifact declares', () => {
    const scan = readTargetFeatures(bytes(WASM_HEADER, REAL_SECTION))
    expect(scan.ok).toBe(true)
    if (!scan.ok) return
    // Literals. This is the whole point of AOT-03: if elfconv starts emitting
    // simd128, this list must change and the cache key with it.
    expect(scan.features.required).toEqual(['bulk-memory', 'mutable-globals', 'sign-ext'])
    expect(scan.features.declared).toEqual([
      { name: 'bulk-memory', use: 'used' },
      { name: 'mutable-globals', use: 'used' },
      { name: 'sign-ext', use: 'used' },
    ])
  })

  it('skips the sections in front of it rather than assuming a position', () => {
    // A real artifact has ten standard sections and six debug customs before this
    // one. A reader that looked at a fixed offset would work on the fixture and
    // nowhere else.
    const filler = [1, 3, 0, 0, 0] // section id 1, three bytes of payload
    const debug = [0, 8, 6, ...[...'.debug'].map((c) => c.charCodeAt(0)), 0]
    const scan = readTargetFeatures(bytes(WASM_HEADER, filler, debug, REAL_SECTION))
    expect(scan.ok).toBe(true)
    if (!scan.ok) return
    expect(scan.features.required).toEqual(['bulk-memory', 'mutable-globals', 'sign-ext'])
  })

  it('counts "=" as required and "-" as neither, sorted and de-duplicated', () => {
    const section = targetFeatures([
      ['simd128', 0x3d],
      ['threads', 0x2d],
      ['bulk-memory', 0x2b],
      ['bulk-memory', 0x2b],
    ])
    const scan = readTargetFeatures(bytes(WASM_HEADER, section))
    expect(scan.ok).toBe(true)
    if (!scan.ok) return
    expect(scan.features.required).toEqual(['bulk-memory', 'simd128'])
    // The `-` entry is kept: a module that declares it does not use threads is
    // saying something, and dropping it would make the disappearance invisible.
    expect(scan.features.declared).toContainEqual({ name: 'threads', use: 'disallowed' })
  })

  it('refuses a module with no section rather than reporting no features', () => {
    // The dangerous answer. "Requires nothing" is what every node would accept.
    const scan = readTargetFeatures(bytes(WASM_HEADER, [1, 1, 0]))
    expect(scan.ok).toBe(false)
    if (scan.ok) return
    expect(scan.reason.kind).toBe('no-target-features-section')
  })

  it('refuses bytes that are not WASM, and says what they were', () => {
    const scan = readTargetFeatures(new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 1, 2, 3, 4]))
    expect(scan.ok).toBe(false)
    if (scan.ok) return
    expect(scan.reason).toEqual({ kind: 'not-wasm', found: [0x7f, 0x45, 0x4c, 0x46] })
  })

  it('refuses a truncated section instead of reading zeroes past the end', () => {
    // Reading zeroes would decode as "zero features" — a plausible wrong answer,
    // which is worse than a loud failure.
    const whole = bytes(WASM_HEADER, REAL_SECTION)
    const scan = readTargetFeatures(whole.subarray(0, whole.length - 12))
    expect(scan.ok).toBe(false)
    if (scan.ok) return
    expect(scan.reason.kind).toBe('truncated')
  })

  it('refuses a prefix byte that is not one of + - =', () => {
    const scan = readTargetFeatures(bytes(WASM_HEADER, targetFeatures([['simd128', 0x21]])))
    expect(scan.ok).toBe(false)
    if (scan.ok) return
    expect(scan.reason).toEqual({ kind: 'unknown-prefix', byte: 0x21, index: 0 })
  })

  it('refuses a section that promises more features than it holds', () => {
    // Four declared, one present. Truncation with a plausible header is the shape a
    // half-written file takes, and "one feature" would be a plausible wrong answer.
    const scan = readTargetFeatures(bytes(WASM_HEADER, targetFeatures([['simd128', 0x2b]], 4)))
    expect(scan.ok).toBe(false)
    if (scan.ok) return
    expect(scan.reason.kind).toBe('malformed-section')
  })

  it('refuses a version no engine implements', () => {
    const scan = readTargetFeatures(bytes([0x00, 0x61, 0x73, 0x6d, 0x02, 0x00, 0x00, 0x00]))
    expect(scan.ok).toBe(false)
    if (scan.ok) return
    expect(scan.reason).toEqual({ kind: 'unsupported-version', version: 2 })
  })
})

// ---------------------------------------------------------------------------
// The verdict, and what travels with it.
// ---------------------------------------------------------------------------

describe('the verdict admits only what has been both explained and measured', () => {
  const oneFinding = scanStream(
    '[Bug] Unsupported instruction at address: 0x4 (SemanticsFunction), instForm: X',
    'stdout',
  ).findings

  it('is clean only when nothing was found and the probe ran empty', () => {
    expect(verdictOf([], [], PROBE_FOUND_NOTHING)).toBe('clean')
  })

  it('is not clean when the probe did not run', () => {
    // An unmeasured class is not an absent one. In this image the silent decode
    // failures are the only class that leaves no trace in the output at all.
    expect(verdictOf([], [], NO_PROBE)).toBe('reservations')
  })

  it('is not clean when the probe found untranslated addresses', () => {
    expect(verdictOf([], [], { kind: 'measured', callSites: 259, addresses: [0x417914n] })).toBe(
      'reservations',
    )
  })

  it('is not clean when a diagnostic went unparsed', () => {
    expect(verdictOf([], [{ stream: 'stdout', text: '[Bug] something new' }], PROBE_FOUND_NOTHING)).toBe(
      'reservations',
    )
  })

  it('is not clean when the toolchain named an instruction it could not lift', () => {
    expect(verdictOf(oneFinding, [], PROBE_FOUND_NOTHING)).toBe('reservations')
  })
})

/**
 * One rendering fixture, varied by spreading over it.
 *
 * Held at module scope rather than inside the block below, so the blocks that need a
 * different {@link UndecodedProbe} change one field instead of restating the whole
 * literal — three copies of which would drift the moment `LiftedArtifact` grows a
 * field, and drift in a *fixture* is invisible.
 *
 * **The field count that used to be in this sentence is gone.** It read
 * "seventeen-field" while `LiftedArtifact` declared sixteen, which is the same class of
 * defect the sentence is warning about: a number in a comment that no test reads, left
 * behind by the field that moved it. The argument does not need the number.
 *
 * Split in two because {@link translationRecordFor} is `async` and the whole artifact
 * cannot exist until it has answered. See that function for why this is not a
 * `beforeAll`.
 */
const RENDERED_ARTIFACT_BASE: Omit<LiftedArtifact, 'translation'> = {
  bytes: new Uint8Array(bytes(WASM_HEADER, REAL_SECTION)),
  verdict: 'reservations',
  target: LIFT_TARGET,
  toolchain: { 'elfconv-image': 'ghcr.io/yomaytk/elfconv@sha256:22a404f3', clang: '16.0.6' },
  /** Both fields above named a version, so this lift is fully provenanced. */
  unidentifiedTools: [],
  inputDigest: '1220ab',
  requiredFeatures: ['bulk-memory'],
  declaredFeatures: [{ name: 'bulk-memory', use: 'used' }],
  findings: scanStream(
    '[Bug] Unsupported instruction at address: 0x0041a2c4 (SemanticsFunction), instForm: CASPAL_CP64_LDSTEXCL',
    'stdout',
  ).findings,
  unparsed: [],
  undecoded: { kind: 'measured', callSites: 259, addresses: [0x417914n, 0x417918n] },
  blindSpots: [CROSS_MACHINE_BLIND_SPOT, REACHABILITY_BLIND_SPOT],
  elf: {
    machine: 183,
    type: 'exec',
    stripped: false,
    hasEhFrame: true,
    sectionCount: 30,
    entryPoint: 0x400000n,
    sectionNames: ['', '.text'],
  },
  durationMs: 95_000,
  stdout: '',
  stderr: '',
}

/**
 * The `TranslationRecord` an artifact would be given, computed rather than pinned.
 *
 * A literal CID written down here would be a second conformance vector with none of
 * `CONFORMANCE_CID`'s documented discipline behind it — `cache-key.test.ts` already
 * holds one, and its docblock says changing it "is not a test edit". Two of those, one
 * of them undocumented, is how a pinned value quietly becomes a value somebody updates
 * to match the code.
 *
 * `artifactCid` comes from a real {@link MemoryBlockstore} rather than from the
 * driver's own hashing, so the fixture's own name is checked against the thing that
 * answers `blockstore.get` rather than against the thing that produced it.
 */
async function translationRecordFor(
  artifact: Omit<LiftedArtifact, 'translation'>,
): Promise<TranslationRecord> {
  const named = await translationCid(translationKeyOf(artifact))
  if (!named.ok) throw new Error(describeKeyFailure(named.failure))
  const artifactCid = await new MemoryBlockstore().put(new Uint8Array(artifact.bytes))
  return { keyCid: named.cid, key: named.key, artifactCid }
}

/**
 * Built at module scope with top-level await, and **deliberately not in a `beforeAll`.**
 *
 * The reason is mechanical rather than stylistic. `describeLift(artifact)` is called in
 * the *describe body* immediately below, which executes during collection — before any
 * `beforeAll` hook runs. A `translation` populated in a hook is `undefined` there, and
 * the assertions Plan 21-02 adds read `artifact.translation.keyCid.toString()`, so the
 * file would throw at collection and take every case in it down rather than failing one.
 * `translationCid` is `async` and `sha256.digest` returns an awaitable, so there is no
 * synchronous route either.
 *
 * Top-level await was **verified to run in this runner**, not assumed: the file is ESM
 * (`tsconfig.json` sets `module: "esnext"`) and vitest evaluates it as a module.
 */
const RENDERED_ARTIFACT: LiftedArtifact = {
  ...RENDERED_ARTIFACT_BASE,
  translation: await translationRecordFor(RENDERED_ARTIFACT_BASE),
}

describe('a rendered lift carries its reservations in the same string as its numbers', () => {
  const artifact = RENDERED_ARTIFACT

  const rendered = describeLift(artifact)

  it('states the verdict where a reader cannot miss it', () => {
    expect(rendered).toContain('RESERVATIONS')
  })

  it('names the finding, the silent addresses, and the toolchain digest together', () => {
    // Together in one string, for the reason `describeStartReport` does it: a caveat
    // kept beside a number gets separated from it the first time somebody quotes the
    // number.
    expect(rendered).toContain('CASPAL_CP64_LDSTEXCL')
    expect(rendered).toContain('0x417914')
    expect(rendered).toContain('259 call sites')
    expect(rendered).toContain('sha256:22a404f3')
  })

  it('prints the required feature set it was told, not a constant', () => {
    expect(rendered).toContain('needs bulk-memory')
  })

  it('prints every blind spot', () => {
    for (const spot of artifact.blindSpots) expect(rendered).toContain(spot.note)
  })

  it('carries the name of what it produced in the same string as the reservations', () => {
    // Inside the one string, not written beside it by `main`. The reason is the reason
    // `describeLift` returns a string at all: a name printed next to the reservations is
    // a name that gets separated from them the first time somebody quotes either one.
    // A `main` that emitted the CID with its own `process.stdout.write` would satisfy
    // "the operator sees the CID" and would not satisfy this.
    expect(rendered).toContain(artifact.translation.keyCid.toString())
    expect(rendered).toContain(artifact.translation.artifactCid.toString())
  })

  it('labels the key and the artifact, so neither CID can be read as the other', () => {
    // Asserted first, because every assertion under it is vacuous if the two are the
    // same string. They differ by construction rather than by arrangement:
    // `RENDERED_ARTIFACT.bytes` is not the encoding of its own key.
    expect(artifact.translation.keyCid.toString()).not.toBe(
      artifact.translation.artifactCid.toString(),
    )
    // Label *and* value together. The mutation this phase plants — print the artifact
    // CID where the key CID belongs — leaves both strings present in the rendering and
    // only swaps which label each one wears, so an assertion on presence alone survives
    // it and this one does not.
    expect(rendered).toContain(`translation key cid: ${artifact.translation.keyCid.toString()}`)
    expect(rendered).toContain(`artifact cid: ${artifact.translation.artifactCid.toString()}`)
  })

  it('prints the input digest, the one key field no other line carried', () => {
    // The gap this closes. Until 2026-08-04 the rendering showed the key's *CID* and
    // none of the four fields hashed into it, so an operator holding two different key
    // CIDs could not tell whether the *inputs* differed — the first question a key
    // mismatch raises, and the only one of the four that no other line answers. Target,
    // toolchain and feature set were already on the lines around it; `inputDigest` was
    // on none of them, which is why 21-02's reason for leaving `describeKey` uncalled
    // held for three fields out of four.
    //
    // Read off the artifact rather than written as a literal, so the fixture and the
    // claim cannot drift apart.
    expect(artifact.inputDigest).not.toBe('')
    expect(rendered).toContain(`input ${artifact.inputDigest}`)
    // …and rendered *by* `describeKey`, so the tree holds one rendering of a key rather
    // than two that can disagree. Label and value together, for the reason the case
    // above gives about the two CIDs.
    expect(rendered).toContain(`key as hashed: ${describeKey(artifact.translation.key)}`)
  })

  it('renders the key that was hashed, not the fields the artifact happens to carry', async () => {
    // These are two different objects, and the difference is observable. `translationKeyOf`
    // hands `requiredFeatures` over in the artifact's own order and `translationCid`
    // sorts and de-duplicates it, so the `needs` line shows what was *reported* and the
    // `key as hashed` line shows what was *hashed*. A `describeLift` that rendered its
    // own fields instead of `artifact.translation.key` would print the raw order twice,
    // and the gap between reported and hashed — a normalisation defect — would be
    // invisible in the one string an operator keeps.
    const base: Omit<LiftedArtifact, 'translation'> = {
      ...RENDERED_ARTIFACT_BASE,
      requiredFeatures: ['simd128', 'bulk-memory', 'simd128'],
    }
    const unsorted = describeLift({ ...base, translation: await translationRecordFor(base) })

    // Reported: the artifact's order, duplicate intact.
    expect(unsorted).toContain('needs simd128 bulk-memory simd128')
    // Hashed: sorted and de-duplicated. Asserted as the tail of `describeKey`'s own
    // rendering so this cannot pass on the reported line above.
    expect(unsorted).toContain('· needs bulk-memory simd128')
    // Asserted first in spirit: the fixture really does distinguish the two orderings.
    // Both assertions above would pass on a single-feature artifact without saying
    // anything, and `RENDERED_ARTIFACT_BASE` is exactly such an artifact.
    expect(base.requiredFeatures.join(' ')).not.toBe(
      [...new Set(base.requiredFeatures)].sort().join(' '),
    )
  })

  it('never claims cross-machine reproducibility', () => {
    // The one sentence this project must not accidentally write. Two lifts agreeing
    // on one host is not evidence about a second host.
    expect(CROSS_MACHINE_BLIND_SPOT.note).toContain('never been compared')
    expect(rendered).not.toMatch(/reproducible across machines|cross-machine identical/i)
  })
})

describe('a probe that counted call sites and recovered no addresses is not a clean lift', () => {
  /**
   * The failure mode the undecoded probe can have *itself*.
   *
   * The probe is two greps over one disassembly — one counting
   * `call void @__ecv_warning(` and one pulling the `i64` operand out of the same
   * calls. A change to the emitted call shape breaks the second and leaves the first
   * matching, and the result read as `addresses: []`, which the verdict called
   * `clean` and the renderer called "every address was translated". That is the
   * silent clean lift this driver exists to prevent, produced by the driver.
   */
  it('refuses the verdict clean, so the exit code cannot come back 0', () => {
    // `cli.ts` maps `clean` to 0 and everything else to 2. The assertion is on the
    // verdict rather than on a third enum value, because that mapping is not this
    // file's to change.
    expect(verdictOf([], [], PROBE_COUNTED_ONLY)).toBe('reservations')
  })

  it('refuses it through the measured arm too, which a hand-built value can still reach', () => {
    // `readUndecoded` cannot construct this, but `verdictOf` is exported and takes
    // whatever it is given, and the answer this shape used to get was `clean`.
    expect(verdictOf([], [], { kind: 'measured', callSites: 259, addresses: [] })).toBe(
      'reservations',
    )
  })

  it('still calls a genuinely empty probe clean, so the guard has not swallowed the good case', () => {
    // Zero counted and zero recovered is the two greps agreeing. Without this the
    // block above would pass just as well if `clean` had become unreachable.
    expect(verdictOf([], [], PROBE_FOUND_NOTHING)).toBe('clean')
  })

  it('states the count and says no addresses came back', () => {
    const rendered = describeLift({ ...RENDERED_ARTIFACT, undecoded: PROBE_COUNTED_ONLY })
    expect(rendered).toContain('259')
    expect(rendered).toContain('recovered no addresses')
  })

  it('never renders it as "every address was translated"', () => {
    // The exact sentence. Asserting only that the count appears would pass while the
    // renderer printed both, and a reader who sees the reassuring one stops reading.
    for (const undecoded of [PROBE_COUNTED_ONLY, { kind: 'measured', callSites: 259, addresses: [] } as const]) {
      expect(describeLift({ ...RENDERED_ARTIFACT, undecoded })).not.toContain(
        'every address was translated',
      )
    }
  })

  it('still says it for a probe that really did find nothing', () => {
    expect(describeLift({ ...RENDERED_ARTIFACT, undecoded: PROBE_FOUND_NOTHING })).toContain(
      'every address was translated',
    )
  })

  it('carries a blind spot naming the changed call shape, not a disassembler that failed', () => {
    // Two different causes with the same consequence. Sending a reader to a
    // disassembler that worked fine is worse than sending them nowhere.
    const spots = blindSpotsFor(PROBE_COUNTED_ONLY, 'reservations')
    expect(spots).toContainEqual(UNDECODED_ADDRESSES_UNRECOVERED_BLIND_SPOT)
    expect(spots).not.toContainEqual(UNDECODED_UNMEASURED_BLIND_SPOT)
    expect(UNDECODED_ADDRESSES_UNRECOVERED_BLIND_SPOT.note).toContain('call shape has changed')
  })

  it('leaves the blind spots of a measured probe alone', () => {
    const spots = blindSpotsFor(PROBE_FOUND_NOTHING, 'clean')
    expect(spots).toEqual([CROSS_MACHINE_BLIND_SPOT])
  })
})

// ---------------------------------------------------------------------------
// The probe's own reasons, read from a directory rather than from a container.
// ---------------------------------------------------------------------------

/**
 * A read the host could not do is not a disassembler that failed.
 *
 * `readUndecoded` stamped `why: 'disassembler-failed'` on a failed read of
 * `undecoded.txt` — and the code proves that reading is false. Getting to that read
 * requires `undecoded-callsites` to be in `meta.txt`, and `CONTAINER_SCRIPT` writes
 * that key and `/o2/undecoded.txt` inside one `if llvm-dis-16 …; then` branch. So the
 * disassembler had already run *and succeeded*; what failed was this host reading a
 * bind-mounted file. The reason sent whoever read it into the container to debug a
 * tool that worked.
 *
 * The same family as `host-cannot-spawn`: fail-safe on the verdict, wrong on the
 * reason. Every case here builds the directory the driver would have been handed,
 * which is the whole condition — no container, no stub, no injection.
 */
describe('the probe says which of three things stopped it', () => {
  const probeDir = (files: Readonly<Record<string, string>>): string => {
    const dir = stubDir('o2-probe-')
    for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content)
    return dir
  }

  it('names the host read, not the disassembler, when the count is there and the file is not', async () => {
    // The reddening case. This directory is exactly what the container leaves when it
    // disassembled, counted, and this host then could not read the addresses back.
    const dir = probeDir({ 'meta.txt': 'undecoded-callsites=259\n' })
    const probe = await readUndecoded(dir, new Map([['undecoded-callsites', '259']]))
    expect(probe.kind).toBe('not-run')
    expect(probe.kind === 'not-run' && probe.why).toBe('undecoded-unreadable')
  })

  it('carries the host’s own error rather than a guess about the toolchain', async () => {
    const dir = probeDir({ 'meta.txt': 'undecoded-callsites=259\n' })
    const probe = await readUndecoded(dir, new Map([['undecoded-callsites', '259']]))
    // ENOENT for `undecoded.txt` — a fact about this filesystem, which is the thing
    // that actually went wrong.
    expect(probe.kind === 'not-run' && probe.detail).toContain('ENOENT')
    expect(probe.kind === 'not-run' && probe.detail).toContain('undecoded.txt')
  })

  it('still says disassembler-failed when the container is the one saying so', async () => {
    // The arm that must keep its name. `undecoded-probe=failed` is written by the
    // `else` of the disassembly branch, so here the tool really is what failed.
    const dir = probeDir({ 'meta.txt': 'undecoded-probe=failed\n' })
    const probe = await readUndecoded(dir, new Map([['undecoded-probe', 'failed']]))
    expect(probe.kind === 'not-run' && probe.why).toBe('disassembler-failed')
  })

  it('says no-bitcode when the container never reported a count at all', async () => {
    const dir = probeDir({ 'meta.txt': 'clang=16.0.6\n' })
    const probe = await readUndecoded(dir, new Map([['clang', '16.0.6']]))
    expect(probe.kind === 'not-run' && probe.why).toBe('no-bitcode')
  })

  it('measures normally when both halves are present, so the guard has not eaten the good case', async () => {
    const dir = probeDir({ 'undecoded.txt': '4290836\n4290840\n' })
    const probe = await readUndecoded(dir, new Map([['undecoded-callsites', '259']]))
    expect(probe).toEqual({
      kind: 'measured',
      callSites: 259,
      addresses: [0x417914n, 0x417918n],
    })
  })

  it('carries a blind spot about this host, not about the bitcode', async () => {
    // The wrong accusation one level up. A blind spot outlives the failure that made
    // it — it is the sentence that gets quoted later — so repeating "could not be
    // disassembled" here would carry the defect into the artifact.
    const spots = blindSpotsFor({ kind: 'not-run', why: 'undecoded-unreadable' }, 'reservations')
    expect(spots).toContainEqual(UNDECODED_UNREADABLE_BLIND_SPOT)
    expect(spots).not.toContainEqual(UNDECODED_UNMEASURED_BLIND_SPOT)
    expect(UNDECODED_UNREADABLE_BLIND_SPOT.note).toContain('the toolchain is not what failed')
    expect(UNDECODED_UNREADABLE_BLIND_SPOT.note).not.toContain('could not be disassembled')
  })

  it('leaves the other two reasons pointing at the container', async () => {
    for (const why of ['no-bitcode', 'disassembler-failed'] as const) {
      const spots = blindSpotsFor({ kind: 'not-run', why }, 'reservations')
      expect(spots).toContainEqual(UNDECODED_UNMEASURED_BLIND_SPOT)
    }
  })

  it('is still not a clean lift, whichever of the three it was', async () => {
    // Fail-safe on the verdict was never the defect and must not become one.
    for (const why of ['no-bitcode', 'disassembler-failed', 'undecoded-unreadable'] as const) {
      expect(verdictOf([], [], { kind: 'not-run', why })).toBe('reservations')
    }
  })
})

// ---------------------------------------------------------------------------
// Provenance: the refusing half and the stated-degraded half.
// ---------------------------------------------------------------------------

/**
 * An artifact whose provenance could not be established was not provenanced.
 *
 * The read of `meta.txt` was `catch { meta = new Map() }`, with no comment, and the
 * consequence was five `'unknown'` strings in the record the line above them calls the
 * cache key — on an artifact still returned `ok: true`. The reason that is not a
 * survivable default is `translationCid`: it refuses a *blank* version as
 * `blank-version`, and `'unknown'` is not blank. Five of them hash to a perfectly
 * well-formed CID that names no particular toolchain and goes on matching after the
 * compiler changes underneath it — which `cache-key.ts` calls worse than no cache.
 *
 * So the split is: unreadable is a refusal, and unidentified-in-part is a stated
 * result carried on the artifact. Both halves are asserted here, and the point is that
 * a caller can tell them apart.
 */
describe('provenance that could not be read is refused, not defaulted', () => {
  it('names the file, the reason, and what it would have cost to continue', () => {
    // Refusal text, not merely kind: `'unknown'` defeating the downstream guard is the
    // entire argument for refusing, and a message that omits it reads like a missing
    // log file.
    const text = describeLiftFailure({
      kind: 'provenance-unreadable',
      path: '/tmp/o2-lift-x/meta.txt',
      detail: 'ENOENT: no such file or directory',
    })
    expect(text).toContain('/tmp/o2-lift-x/meta.txt')
    expect(text).toContain('ENOENT')
    expect(text).toContain('unknown')
    expect(text).toContain('unnameable')
  })

  it('counts a key that is absent as unidentified', () => {
    expect(unidentifiedIn(new Map([['clang', '16.0.6']]), ['clang', 'wasmedge'])).toEqual([
      'wasmedge',
    ])
  })

  it('counts a key that is present and empty as unidentified too', () => {
    // `printf 'clang=%s\n' "$(clang-16 --version …)"` with no output writes `clang=`,
    // and `parseMeta` keeps that as `''`. The `?? 'unknown'` in the record only ever
    // fired for a key that was missing entirely, so this spelling went into the cache
    // key as an empty string and was reported downstream as a *key* defect rather than
    // as the provenance defect it is.
    expect(unidentifiedIn(new Map([['clang', '']]), ['clang'])).toEqual(['clang'])
    expect(unidentifiedIn(new Map([['clang', '   ']]), ['clang'])).toEqual(['clang'])
  })

  it('reports nothing when every tool named a version', () => {
    const meta = new Map([
      ['clang', '16.0.6'],
      ['wasmedge', '0.14.1'],
    ])
    expect(unidentifiedIn(meta, ['clang', 'wasmedge'])).toEqual([])
  })

  it('states the incomplete provenance where the versions are printed', () => {
    const rendered = describeLift({
      ...RENDERED_ARTIFACT,
      toolchain: { ...RENDERED_ARTIFACT.toolchain, wasmedge: 'unknown' },
      unidentifiedTools: ['wasmedge'],
    })
    expect(rendered).toContain('provenance incomplete')
    expect(rendered).toContain('wasmedge')
    expect(rendered).toContain('does not distinguish this toolchain from another')
  })

  it('says nothing about provenance when the lift was fully identified', () => {
    // Anti-vacuity for the line above: a renderer that always printed it would satisfy
    // that case and tell a reader nothing.
    expect(describeLift(RENDERED_ARTIFACT)).not.toContain('provenance incomplete')
  })
})

// ---------------------------------------------------------------------------
// A `docker` that is a shell script, so the driver's decisions are testable.
// ---------------------------------------------------------------------------

// `stubDocker`, `stubLift`, `acceptableElf`, the digest fixtures and the temporary
// directories they all make now live in `./stubs.ts`, unchanged. They moved because
// `cli.node.test.ts` has to drive the same harness one level up — the CLI spawned as a
// program against a `docker` that answers with somebody else's digest — and the
// alternative to moving them is a second copy of a shell script that has been corrected
// four times. Nothing below is asserted differently for having been imported.

/**
 * Anything with the shape both `resolveImage` and `liftElf` return.
 *
 * Neither is a `LiftOutcome` — `resolveImage` yields a reference and `liftElf` an
 * artifact — but they agree on the discriminant and on the failure type, which is all
 * {@link despiteAFullProcessTable} needs to look at.
 */
type Attempted = { readonly ok: true } | { readonly ok: false; readonly failure: LiftFailure }

/**
 * How many times a case will let the host refuse to fork before it gives up.
 *
 * Four is a judgement and is recorded as one — unlike the latency figures above, the
 * *transience* of `EAGAIN` under real load was not measured, because the only way
 * `EAGAIN` could be provoked here was by reducing `RLIMIT_NPROC` below the live
 * process count, where it is permanent rather than transient and every retry fails
 * identically. So this is not a threshold sited between two populations; it is a
 * small bound on a condition that costs a millisecond to detect. If it is ever seen
 * to exhaust, the exhaustion is reported by name rather than swallowed, and that
 * report is the measurement this comment is currently missing.
 */
const HOST_SPAWN_ATTEMPTS = 4

/** Widening gap between retries, so a burst of fork pressure is given time to pass. */
const HOST_SPAWN_BACKOFF_MS = 250

/**
 * How much of {@link CASE_BUDGET_MS} {@link despiteAFullProcessTable} may spend before
 * it stops asking and reports what it measured.
 *
 * **This is the fix for the ten `60000ms` timeouts.** The wrapper bounded its retries by
 * a *count* and not by a *duration*, and the duration of one attempt is a budget the
 * caller chose: four attempts of {@link METADATA_BUDGET_MS} plus the backoffs is 81 500 ms
 * of driver budget inside a 60 000 ms case. So the framework was always the one to fire,
 * always at 60 000 ms, and always with nothing to say — while the driver's own named
 * refusal, produced twice on the way there, was thrown away. See the module docblock for
 * the reproduction.
 *
 * A share rather than a millisecond count, because the thing it must fit inside is
 * {@link CASE_BUDGET_MS} and nothing else. Raise or lower the framework budget and this
 * follows it; the two can no longer be armed for the same instant by arithmetic that
 * happened somewhere else.
 *
 * **What a half buys, and what it forbids.** The wrapper will not *start* an attempt
 * that — judged by the worst attempt it has already seen in this same run — could not
 * finish inside 30 000 ms, and it abandons an attempt still running at 30 000 ms. So the
 * cheap failures keep every retry they had: `host-cannot-spawn` costs about a
 * millisecond, so all four attempts and 1 500 ms of backoff fit with 28 s to spare, and
 * a `docker-not-answering` against {@link TIMEOUT_CASE_BUDGET_MS} costs 5 s, so all four
 * fit in 21.5 s. Only the expensive one is truncated — an attempt that has just spent
 * 20 s of a 60 s case did not fail to *start*, it failed to *answer*, and asking a
 * swamped daemon the same question three more times spends the case's whole budget on
 * hope. That case now reports at ~20 s carrying the driver's diagnosis and its own
 * measurement.
 *
 * **What would make this the wrong number.** A legitimate attempt sequence that needs
 * more than half a case. The largest legitimate spend in this file is 5.4 s — the two
 * deliberate-timeout cases, measured 5 218 ms and 5 224 ms alone and 5 360 ms and
 * 5 325 ms at load 102 — which is 5.5× under the envelope. If a case is ever added that
 * legitimately needs more, this share is what it has to argue with, and that argument
 * will be about a number that is stated rather than one that is implied by a literal.
 */
const RETRY_ENVELOPE_SHARE = 0.5

/** What {@link despiteAFullProcessTable} is allowed to do, and inside what. */
interface RetryLimits {
  /**
   * Whether a daemon that did not answer is transient here.
   *
   * `true` everywhere except the case whose **subject** is a wedged inspect: it stubs a
   * sleep against a 400 ms budget on purpose, so `docker-not-answering` is the result it
   * is asserting, and retrying it turns the expected answer into a report about the host.
   * Measured, not foreseen — widening the retry did exactly that on the first run.
   */
  readonly retryUnansweredDaemon?: boolean
  /**
   * The framework budget the wrapper must report inside of. Defaults to
   * {@link CASE_BUDGET_MS}; injectable only so the contract cases below can prove the
   * deadline in milliseconds instead of in minutes.
   */
  readonly caseBudgetMs?: number
}

/**
 * `work`, or `null` once `ms` has passed — whichever happens first.
 *
 * The abandoned promise is not left dangling. `Promise.race` attaches its own handlers
 * to both inputs immediately, so a late settle — a late *rejection* included — is
 * delivered to a race that has already resolved, and is therefore handled. Nothing is
 * leaked by walking away from the driver either: it kills its own child at its own
 * budget, which is the timer this wrapper exists to stop overrunning.
 */
function within<T>(work: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const expiry = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms)
  })
  return Promise.race([work, expiry]).finally(() => clearTimeout(timer))
}

/**
 * Run `attempt` until the host actually manages to create the process.
 *
 * **This is not a retry-until-green.** It retries exactly one condition —
 * `host-cannot-spawn`, which the driver only returns when `spawn` failed with an
 * errno in its host-exhaustion set — and that condition means the code under test was
 * never reached at all. A wrong classification, a wrong digest, a timeout that did not
 * fire: all of those come straight back on the first attempt and fail the case. The
 * assertion each caller makes is untouched.
 *
 * This is the defect that made this file flaky, and it is worth stating precisely
 * because the shape is easy to mistake for weakening. Eight cases below hand a stub
 * `docker` to the driver and assert *which* `LiftFailure` comes back. On a host under
 * fork pressure `spawn` fails with `EAGAIN`, the driver returned `docker-unavailable`
 * — the same kind it uses for "docker is not installed" — and eight assertions about
 * classification reported that Docker was missing on a machine where Docker was fine.
 * Naming the host distinctly is what makes this helper able to tell "the host had no
 * room" from "the driver got it wrong", and only the first is retryable.
 *
 * `elapsedMs` is the final attempt's alone, never the sum, so a case that bounds how
 * long the driver took still bounds the driver rather than the retries.
 *
 * **And it must report before the framework does.** Bounding the retries by a count and
 * not by a duration is what produced ten `Error: Test timed out in 60000ms` on a quiet
 * host — see {@link RETRY_ENVELOPE_SHARE}, and the module docblock for the reproduction.
 * Every exit from this function is now either the caller's answer or a thrown sentence
 * naming a number this run measured. Nothing here returns quietly and nothing here waits
 * for vitest to end it.
 */
async function despiteAFullProcessTable<T extends Attempted>(
  attempt: () => Promise<T>,
  limits: RetryLimits = {},
): Promise<{ readonly result: T; readonly elapsedMs: number; readonly attempts: number }> {
  const retryUnansweredDaemon = limits.retryUnansweredDaemon ?? true
  const caseBudgetMs = limits.caseBudgetMs ?? CASE_BUDGET_MS
  const envelopeMs = Math.round(caseBudgetMs * RETRY_ENVELOPE_SHARE)
  const deadline = Date.now() + envelopeMs
  /** Every attempt's cost, so the report is a measurement rather than an adjective. */
  const spent: number[] = []
  let result: T | undefined
  let elapsedMs = 0
  const envelope = `the ${envelopeMs} ms this wrapper may spend inside a ${caseBudgetMs} ms case`
  const measured = (): string => `attempts so far: ${spent.join(' ms, ')} ms`
  const diagnosis = (): string =>
    result !== undefined && !result.ok ? describeLiftFailure(result.failure) : 'no result'

  for (let n = 1; n <= HOST_SPAWN_ATTEMPTS; n++) {
    const started = Date.now()
    const settled = await within(attempt(), Math.max(deadline - started, 1))
    elapsedMs = Date.now() - started
    spent.push(elapsedMs)
    if (settled === null) {
      // One attempt outlived the whole envelope, so the budget handed to the driver is
      // not smaller than the framework's — the defect the module docblock's first
      // paragraph describes, one level up. Reported here, at half the case budget, with
      // the number in it; left to vitest it arrives at 60 000 ms saying nothing.
      throw new Error(
        `one attempt was still running ${elapsedMs} ms in, past ${envelope}, so the ` +
          `driver's own answer never arrived and this case never ran. The budget it was ` +
          `handed is not smaller than the framework's. ${measured()}`,
      )
    }
    result = settled
    // Both transient conditions, and the second was added on 2026-08-02 against a
    // reproduced failure: on a whole-suite run this wrapper returned immediately on a
    // swamped daemon, and the two timeout cases went red with `docker-unavailable` where
    // they expect `timed-out`. A host too loaded to fork and a host too loaded to answer
    // an inspect are the same condition wearing two labels; only one of them was retried.
    const transient = result.ok
      ? false
      : result.failure.kind === 'host-cannot-spawn' ||
        (retryUnansweredDaemon && result.failure.kind === 'docker-not-answering')
    if (!transient) {
      return { result, elapsedMs, attempts: n }
    }
    if (n === HOST_SPAWN_ATTEMPTS) break
    const backoff = HOST_SPAWN_BACKOFF_MS * n
    // Judged against the worst attempt *this run* has already produced, so the decision
    // is comparative and self-calibrating: a millisecond-cheap `EAGAIN` keeps all four
    // attempts on any host, and a twenty-second non-answer buys none — on the same host,
    // in the same wrapper, with no number written down about either.
    const worst = Math.max(...spent)
    if (Date.now() + backoff + worst > deadline) {
      throw new Error(
        `an answer that cost ${elapsedMs} ms leaves no room for another attempt inside ` +
          `${envelope}, so this case never ran: ${diagnosis()}. ${measured()}`,
      )
    }
    await new Promise((resolve) => setTimeout(resolve, backoff))
  }
  // Loud, never a skip and never a pass. A host that could not fork four times running
  // has a problem worth reporting, and the driver already wrote the diagnosis.
  const exhausted =
    result !== undefined && !result.ok && result.failure.kind === 'host-cannot-spawn'
      ? `the host refused to create a process ${HOST_SPAWN_ATTEMPTS} times running`
      : `the daemon did not answer ${HOST_SPAWN_ATTEMPTS} times running`
  throw new Error(`${exhausted}, so this case never ran: ${diagnosis()}. ${measured()}`)
}

let stubElfPath = ''

beforeAll(() => {
  stubElfPath = writeAcceptableElf()
})

// Every temporary directory `stubs.ts` made, including the ones this file asked it for
// through `stubDir`. Removing a directory twice is a no-op there, so `cli.node.test.ts`
// calling this too is safe.
afterAll(() => {
  cleanupStubs()
})

describe('an image whose digests name another repository is refused, never run', () => {
  /**
   * The reproduced defect. `resolveImage` fell back to `digests[0]` when no entry
   * matched the requested repository — two lines below a comment saying the
   * repository has to match. `ghcr.io/yomaytk/elfconv:arm64` resolved to an unrelated
   * `docker.io/…@sha256:…`, which the driver would then run, and whose digest it
   * would write into `toolchain['elfconv-image']` and hash into the translation key:
   * a build from an unknown toolchain, cached forever under a trusted name.
   */
  it('names the mismatch instead of resolving to the first digest in the list', async () => {
    const docker = stubDocker(emitDigests(FOREIGN_DIGESTS))
    const { result: resolved } = await despiteAFullProcessTable(() =>
      resolveImage(ELFCONV_IMAGE_TAG, docker.path, METADATA_BUDGET_MS),
    )
    expect(resolved.ok).toBe(false)
    if (resolved.ok) return
    expect(resolved.failure.kind).toBe('image-digest-foreign')
    if (resolved.failure.kind !== 'image-digest-foreign') return
    // Enough evidence to debug it without re-running docker by hand: what was asked
    // for, and what was actually there.
    expect(resolved.failure.repository).toBe('ghcr.io/yomaytk/elfconv')
    expect(resolved.failure.image).toBe(ELFCONV_IMAGE_TAG)
    expect(resolved.failure.digests).toEqual(FOREIGN_DIGESTS)
  })

  it('explains the danger rather than only reporting the mismatch', () => {
    const text = describeLiftFailure({
      kind: 'image-digest-foreign',
      image: ELFCONV_IMAGE_TAG,
      repository: 'ghcr.io/yomaytk/elfconv',
      digests: FOREIGN_DIGESTS,
    })
    expect(text).toContain('docker.io/library/busybox@sha256:1111')
    expect(text).toContain('ghcr.io/yomaytk/elfconv')
    expect(text).toMatch(/unknown toolchain/)
  })

  it('starts no container — the foreign digest never reaches docker run', async () => {
    const docker = stubDocker(emitDigests(FOREIGN_DIGESTS))
    const { result: outcome } = await despiteAFullProcessTable(() =>
      // `timeoutMs` is not optional here, and its absence was the sharpest instance of
      // the defect in the module docblock: with no budget, `liftElf` caps the inspect at
      // `IMAGE_RESOLVE_CAP_MS`, which is 60 000 ms — the same instant as this file's own
      // `CASE_BUDGET_MS`. One timer against an identical timer, and the framework's is
      // armed first, so a single slow inspect killed the case with nothing to report.
      liftElf(stubElfPath, { docker: docker.path, timeoutMs: METADATA_BUDGET_MS }),
    )
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.failure.kind).toBe('image-digest-foreign')

    // The assertion the return value cannot make. One invocation, and it is the
    // inspect. A retried attempt cannot inflate this count: the only thing retried is
    // a spawn that never happened, and a stub that never ran logged nothing.
    const log = docker.invocations()
    expect(log).toHaveLength(1)
    expect(log[0]).toContain('image inspect')
    expect(log.join('\n')).not.toContain('run ')
  })

  it('still resolves the matching digest wherever it sits in the list', async () => {
    // Anti-regression for removing the fallback: the ordinary path is a *late* match
    // in a list whose first entry is foreign, which is exactly the case the fallback
    // used to get right by accident and could now get wrong on purpose.
    const docker = stubDocker(emitDigests([...FOREIGN_DIGESTS, MATCHING_DIGEST]))
    const { result: resolved } = await despiteAFullProcessTable(() =>
      resolveImage(ELFCONV_IMAGE_TAG, docker.path, METADATA_BUDGET_MS),
    )
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return
    expect(resolved.reference).toBe(MATCHING_DIGEST)
  })

  it('does not mistake a registry port for a tag', async () => {
    // `image.split(':')[0]` reads `localhost:5000/o2/elfconv:arm64` as the repository
    // `localhost`, which matches nothing. Harmless while a mismatch fell through to
    // `digests[0]`; a refusal of a perfectly good image now.
    const image = 'localhost:5000/o2/elfconv:arm64'
    const digest = `localhost:5000/o2/elfconv@sha256:${'3'.repeat(64)}`
    const docker = stubDocker(emitDigests([digest]))
    const { result: resolved } = await despiteAFullProcessTable(() =>
      resolveImage(image, docker.path, METADATA_BUDGET_MS),
    )
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return
    expect(resolved.reference).toBe(digest)
  })

  it('keeps "no digests at all" a separate failure from "digests for elsewhere"', async () => {
    // Different fixes — push the locally built image, versus re-pull by the name you
    // mean — so collapsing them would send half the readers to the wrong one.
    const docker = stubDocker(emitDigests([]))
    const { result: resolved } = await despiteAFullProcessTable(() =>
      resolveImage(ELFCONV_IMAGE_TAG, docker.path, METADATA_BUDGET_MS),
    )
    expect(resolved.ok).toBe(false)
    if (resolved.ok) return
    expect(resolved.failure.kind).toBe('image-has-no-digest')
  })
})

describe('a container that outlived its client is killed before its mount is deleted', () => {
  /**
   * `child.kill()` reaches the `docker` client, not the container. The daemon keeps
   * running what it was asked to run, and the `finally` in `liftElf` then removes the
   * bind-mounted work directory out from under it.
   */
  it('names the container it starts and removes that same name on timeout', async () => {
    const docker = stubDocker(
      `case "$1" in\n` +
        `  image) printf '%s\\n' '${MATCHING_DIGEST}'; exit 0 ;;\n` +
        // `exec`, so the shell is *replaced* by the sleep rather than becoming its
        // parent. A grandchild inherits the stdio pipes, and `run()` resolves on
        // `close` — which does not fire while anything still holds them open, so a
        // forked sleep would outlive the SIGKILL and hang this test for thirty
        // seconds after the timeout it is testing had already fired.
        '  run) exec sleep 30 ;;\n' +
        '  *) exit 0 ;;\n' +
        'esac',
    )
    const { result: outcome } = await despiteAFullProcessTable(() =>
      liftElf(stubElfPath, {
        docker: docker.path,
        timeoutMs: TIMEOUT_CASE_BUDGET_MS,
      }),
    )
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.failure.kind).toBe('timed-out')

    const log = docker.invocations()
    const runLine = log.find((line) => line.startsWith('run '))
    expect(runLine).toBeDefined()
    const named = /--name (\S+)/.exec(runLine ?? '')
    const name = named?.[1]
    expect(name).toBeDefined()
    if (name === undefined) return
    // The *same* name. A removal of some other container would be worse than no
    // removal at all, and "a rm happened" cannot tell the two apart.
    expect(log).toContain(`rm --force ${name}`)
    expect(log.indexOf(`rm --force ${name}`)).toBeGreaterThan(log.indexOf(runLine ?? ''))
  })

  it('reports the timeout even when the removal fails', async () => {
    // Best effort means best effort. A container that will not die is a second
    // problem, and surfacing it here would replace the answer the caller needs.
    const docker = stubDocker(
      `case "$1" in\n` +
        `  image) printf '%s\\n' '${MATCHING_DIGEST}'; exit 0 ;;\n` +
        // `exec`, so the shell is *replaced* by the sleep rather than becoming its
        // parent. A grandchild inherits the stdio pipes, and `run()` resolves on
        // `close` — which does not fire while anything still holds them open, so a
        // forked sleep would outlive the SIGKILL and hang this test for thirty
        // seconds after the timeout it is testing had already fired.
        '  run) exec sleep 30 ;;\n' +
        "  rm) printf 'no such container\\n' >&2; exit 1 ;;\n" +
        '  *) exit 0 ;;\n' +
        'esac',
    )
    const { result: outcome } = await despiteAFullProcessTable(() =>
      liftElf(stubElfPath, {
        docker: docker.path,
        timeoutMs: TIMEOUT_CASE_BUDGET_MS,
      }),
    )
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.failure.kind).toBe('timed-out')
    expect(docker.invocations().some((line) => line.startsWith('rm --force '))).toBe(true)
  })
})

describe('the caller’s timeout bounds image resolution too', () => {
  it('gives up on a wedged inspect in the time it was given, not in a hardcoded minute', async () => {
    // `liftElf` passed a literal 60_000 to `resolveImage`, so `timeoutMs` did not
    // reach it at all.
    //
    // `exec` for the reason given in the block above: a forked sleep holds the stdio
    // pipes open past the SIGKILL and `run()` resolves on `close`. The sleep is **8 s
    // and not 30**, and the number is load-bearing in the other direction from the one
    // it looks like: it is 4× the longest budget asked for below, so the driver's timer
    // still ends both arms — and it is small enough that a driver which *ignored* the
    // caller's budget runs into the stub's own exit and fails an assertion, instead of
    // running into this file's 60 000 ms and being killed by the framework with nothing
    // to say. A plant that reds by timeout is not a plant anybody can read.
    const docker = stubDocker('exec sleep 8')

    /** One wedged inspect, and what the caller's budget cost in wall clock. */
    const wedged = async (
      budgetMs: number,
    ): Promise<{ readonly failure: LiftFailure; readonly elapsedMs: number }> => {
      const { result: outcome, elapsedMs } = await despiteAFullProcessTable(
        () => liftElf(stubElfPath, { docker: docker.path, timeoutMs: budgetMs }),
        // The wedged inspect is this case's subject, not an obstacle to it.
        { retryUnansweredDaemon: false },
      )
      expect(outcome.ok, 'a wedged inspect must not resolve').toBe(false)
      if (outcome.ok) throw new Error('a wedged inspect resolved')
      return { failure: outcome.failure, elapsedMs }
    }

    const short = await wedged(WEDGE_BUDGET_SHORT_MS)
    const long = await wedged(WEDGE_BUDGET_LONG_MS)

    // Not `image-absent`: the image was never reported missing, the daemon just never
    // answered, and telling someone to pull six gigabytes they already have would
    // send them to the same wedged daemon.
    //
    // And not `docker-unavailable` either, since 2026-08-02. That kind means `docker`
    // could not be run at all; this one means it ran and the answer never came, which is
    // transient and is retried rather than reported as a broken installation.
    for (const { failure } of [short, long]) expect(failure.kind).toBe('docker-not-answering')
    // Each arm names its own number, which is the non-timing half of the same claim: a
    // driver using a budget of its own would print that one here.
    expect(describeLiftFailure(short.failure)).toContain(
      `did not answer within ${WEDGE_BUDGET_SHORT_MS} ms`,
    )
    expect(describeLiftFailure(long.failure)).toContain(
      `did not answer within ${WEDGE_BUDGET_LONG_MS} ms`,
    )

    // The comparative half. Both arms paid the same spawn cost on the same host seconds
    // apart, so it cancels in the difference and what is left is the driver's response
    // to what it was asked for. See {@link WEDGE_BUDGET_SHORT_MS} for what breaks it.
    const requested = WEDGE_BUDGET_LONG_MS - WEDGE_BUDGET_SHORT_MS
    const observed = long.elapsedMs - short.elapsedMs
    expect(
      observed,
      `asking for ${requested} ms more budget bought ${observed} ms more wall clock ` +
        `(${short.elapsedMs} ms → ${long.elapsedMs} ms)`,
    ).toBeGreaterThan(requested * WEDGE_DIFFERENCE_FLOOR)
    expect(observed).toBeLessThan(requested * WEDGE_DIFFERENCE_CEILING)
  })

  it('does not hand a twenty-minute lift budget to a metadata read', async () => {
    // The option applies, capped — the smaller of the two wins. With the default
    // twenty minutes the cap is what bounds it, and the cap is what stops a wedged
    // daemon holding a build in silence for the whole budget.
    const docker = stubDocker(emitDigests([MATCHING_DIGEST]))
    const { result: resolved } = await despiteAFullProcessTable(() =>
      resolveImage(ELFCONV_IMAGE_TAG, docker.path, METADATA_BUDGET_MS),
    )
    expect(resolved.ok).toBe(true)
    expect(IMAGE_RESOLVE_CAP_MS).toBeLessThan(DEFAULT_TIMEOUT_MS)
  })
})

// ---------------------------------------------------------------------------
// The provenance split, through the driver rather than through its parts.
// ---------------------------------------------------------------------------

/**
 * A `docker` that produces an artifact, and whatever `meta.txt` the case wants.
 *
 * The unit cases above hold `unidentifiedIn` and `describeLiftFailure` to their
 * contracts, and a driver that never called either of them satisfies every one of
 * them — so these two go through `liftElf` itself. The stub finds the work directory
 * the way the real container would: `liftElf` passes `-v <workDir>:/o2`, so the mount
 * argument names it.
 *
 * `wasmPath` is a real `target_features` section, because `readTargetFeatures` runs
 * before the provenance read and a driver that refused the bytes would never reach the
 * behaviour under test.
 */
function stubDockerProducing(wasmPath: string, metaLine: string | null): StubDocker {
  return stubDocker(
    'case "$1" in\n' +
      `  image) printf '%s\\n' '${MATCHING_DIGEST}'; exit 0 ;;\n` +
      '  run)\n' +
      '    for a in "$@"; do case "$a" in *:/o2) d="${a%:/o2}" ;; esac; done\n' +
      `    cp '${wasmPath}' "$d/artifact.wasm"\n` +
      (metaLine === null ? '' : `    printf '%s\\n' '${metaLine}' > "$d/meta.txt"\n`) +
      '    exit 0 ;;\n' +
      '  *) exit 0 ;;\n' +
      'esac',
  )
}

describe('an artifact the driver cannot provenance is not returned', () => {
  let wasmPath = ''

  beforeAll(() => {
    wasmPath = join(stubDir('o2-stub-wasm-'), 'artifact.wasm')
    writeFileSync(wasmPath, bytes(WASM_HEADER, REAL_SECTION))
  })

  it('refuses the lift when meta.txt cannot be read at all', async () => {
    // The reddening case for the wholesale swallow. The container "succeeded", the
    // `.wasm` is there and readable, and the only thing missing is the file naming the
    // toolchain that produced it — which used to yield `ok: true` and five `'unknown'`s.
    const docker = stubDockerProducing(wasmPath, null)
    const { result: outcome } = await despiteAFullProcessTable(() =>
      liftElf(stubElfPath, { docker: docker.path, timeoutMs: METADATA_BUDGET_MS }),
    )
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.failure.kind).toBe('provenance-unreadable')
    expect(describeLiftFailure(outcome.failure)).toContain('meta.txt')
  })

  it('does not report the missing provenance as a missing disassembly', async () => {
    // The knock-on the empty map produced: `readUndecoded` read the absent
    // `undecoded-callsites` as `why: 'no-bitcode'`, so one unread file also produced a
    // second wrong label — a statement about the bitcode, from a file never read.
    const docker = stubDockerProducing(wasmPath, null)
    const { result: outcome } = await despiteAFullProcessTable(() =>
      liftElf(stubElfPath, { docker: docker.path, timeoutMs: METADATA_BUDGET_MS }),
    )
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(describeLiftFailure(outcome.failure)).not.toContain('bitcode')
  })

  it('returns the artifact and names the tools that did not identify themselves', async () => {
    // The other half of the split, and the reason it is a split: a `meta.txt` that
    // reads is survivable, and the survivable case must stay survivable.
    const docker = stubDockerProducing(wasmPath, 'clang=16.0.6')
    const { result: outcome } = await despiteAFullProcessTable(() =>
      liftElf(stubElfPath, { docker: docker.path, timeoutMs: METADATA_BUDGET_MS }),
    )
    expect(outcome.ok, outcome.ok ? '' : describeLiftFailure(outcome.failure)).toBe(true)
    if (!outcome.ok) return
    // `clang` named a version and is absent from the list; the other four did not.
    expect(outcome.artifact.unidentifiedTools).toEqual([
      'elfconv-commit',
      'elflift-sha256',
      'wasi-sdk',
      'wasmedge',
    ])
    expect(describeLift(outcome.artifact)).toContain('provenance incomplete')
  })

  it('stops on an empty value rather than returning an artifact it cannot name', async () => {
    /**
     * **This case asserted `ok: true` until the pipeline started naming its output.**
     *
     * `clang=` is what `printf 'clang=%s\n' "$(clang-16 --version)"` writes when the
     * command says nothing, and `parseMeta` keeps it as `''`. The claim it was written
     * for — that an empty value is unidentified rather than a version — is unchanged and
     * is held directly by the `unidentifiedIn` cases above. What changed is what the
     * *driver* does with it: `liftElf` now calls `translationCid`, which refuses a blank
     * version, so this lift has no name and is not returned.
     *
     * That is the outcome `LiftedArtifact.unidentifiedTools`' own doc was already written
     * against — it keeps `''` and `'unknown'` spelled differently in the record
     * *because* one of them is refused and the other is not. The refusal was simply
     * unreachable while nothing in the pipeline asked for a name.
     */
    const docker = stubDockerProducing(wasmPath, 'clang=')
    const { result: outcome } = await despiteAFullProcessTable(() =>
      liftElf(stubElfPath, { docker: docker.path, timeoutMs: METADATA_BUDGET_MS }),
    )
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.failure).toEqual({
      kind: 'unnameable',
      reason: { kind: 'blank-version', tool: 'clang' },
    })
  })
})

/**
 * The positive control for every refusal above, and the reason the extraction into
 * `stubs.ts` is more than a move.
 *
 * Each stub in this file so far exists to make the driver *stop* — a foreign digest, a
 * wedged inspect, a missing `meta.txt`. A harness that only ever produces refusals could
 * be broken in a way no refusal case would notice: a stub that never wrote an artifact at
 * all would satisfy them, because none of them gets far enough to read one. `stubLift`
 * imitates the container script's whole successful path instead, and this block is the
 * one place that reads the result back.
 */
describe('a stub lift completes, so the harness the refusals invert is known to work', () => {
  it('returns the bytes it was given, under a toolchain with nothing missing in it', async () => {
    const docker = stubLift()
    const { result: outcome } = await despiteAFullProcessTable(() =>
      liftElf(stubElfPath, { docker: docker.path, timeoutMs: METADATA_BUDGET_MS }),
    )
    expect(outcome.ok, outcome.ok ? '' : describeLiftFailure(outcome.failure)).toBe(true)
    if (!outcome.ok) return

    const artifact = outcome.artifact
    // The bytes, not merely a length: the stub `cp`s a staged file rather than emitting
    // the artifact through `printf`, precisely so this can be an equality.
    expect(Buffer.from(artifact.bytes).equals(Buffer.from(ACCEPTABLE_ARTIFACT))).toBe(true)
    // Read out of the fixture's own `target_features` section, never assumed.
    expect(artifact.requiredFeatures).toEqual(['bulk-memory'])
    // Neither spelling of an unidentified tool is present. `''` and `'unknown'` reach
    // `translationCid` as different outcomes, so a stub carrying either would make every
    // case built on it assert a failure path by accident.
    for (const [tool, version] of Object.entries(artifact.toolchain)) {
      expect(version.trim(), `${tool} is blank`).not.toBe('')
      expect(version, `${tool} did not identify itself`).not.toBe('unknown')
    }
    expect(artifact.unidentifiedTools).toEqual([])
    // The container was actually asked to run, which the assertions above cannot show:
    // a driver that fabricated an artifact would satisfy all of them.
    expect(docker.invocations().some((line) => line.startsWith('run '))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// The name the pipeline gives what it produced — AOT-02.
// ---------------------------------------------------------------------------

/** The emitted key's CID as a string, so a sweep can compare two of them. */
const cidOf = async (artifact: LiftedArtifact): Promise<string> => {
  const named = await translationCid(translationKeyOf(artifact))
  expect(named.ok, named.ok ? '' : describeKeyFailure(named.failure)).toBe(true)
  if (!named.ok) throw new Error(describeKeyFailure(named.failure))
  return named.cid.toString()
}

/**
 * `translationKeyOf` maps four fields, and the sweep runs in both directions.
 *
 * Extracted from the call site rather than inlined there, and the reason is what makes
 * this block possible at all: the roadmap criterion is about *the emitted* CID, and a
 * pipeline that silently dropped `requiredFeatures` from the key would pass every
 * assertion `cache-key.test.ts` makes about `translationCid` in isolation. Extracted,
 * the coverage claim is measurable with no container anywhere in it; inlined, the only
 * probe is a full lift per field, which nobody will run — the one lift ever timed was
 * measured at 95 s.
 *
 * **Both directions, because one of them alone is not a measurement.** That a covered
 * field moves the CID says the key is not empty; that an uncovered one does not is what
 * says the key is a *key* rather than a hash of the build log. A key that moved with
 * `durationMs` would never match twice on any host, and every assertion in the first
 * half would still pass.
 */
describe('the name covers what changed the bytes, and nothing that did not', () => {
  it('maps exactly the four fields the criterion names', () => {
    // Field by field, because the CID sweep below would also pass for a function that
    // hashed the whole artifact — every flip would move that CID too.
    const key = translationKeyOf(RENDERED_ARTIFACT)
    expect(key.inputDigest).toBe(RENDERED_ARTIFACT.inputDigest)
    expect(key.target).toBe(RENDERED_ARTIFACT.target)
    expect(key.toolchain).toEqual(RENDERED_ARTIFACT.toolchain)
    expect(key.features).toEqual(RENDERED_ARTIFACT.requiredFeatures)
    // …and nothing else. A fifth key would be a field the criterion does not name,
    // silently entering the identity of every translation.
    expect(Object.keys(key).sort()).toEqual(['features', 'inputDigest', 'target', 'toolchain'])
  })

  it('moves when the input digest moves', async () => {
    expect(await cidOf({ ...RENDERED_ARTIFACT, inputDigest: 'ff00' })).not.toBe(
      await cidOf(RENDERED_ARTIFACT),
    )
  })

  it('moves when the target moves', async () => {
    // The cast exists because `target` is a literal type. The claim under test is about
    // the key's coverage, not about whether this driver can emit a second target — it
    // cannot, deliberately, and `LIFT_TARGET`'s own doc says why.
    expect(
      await cidOf({ ...RENDERED_ARTIFACT, target: 'aarch64-wasi32-other' as typeof LIFT_TARGET }),
    ).not.toBe(await cidOf(RENDERED_ARTIFACT))
  })

  it('moves when any toolchain version moves', async () => {
    const baseline = await cidOf(RENDERED_ARTIFACT)
    // Every entry that is present, one at a time. A key built from a hardcoded subset
    // would pass for whichever entries it happened to include.
    for (const tool of Object.keys(RENDERED_ARTIFACT.toolchain)) {
      const moved = {
        ...RENDERED_ARTIFACT,
        toolchain: { ...RENDERED_ARTIFACT.toolchain, [tool]: 'something-else' },
      }
      expect(await cidOf(moved), `${tool} did not move the key`).not.toBe(baseline)
    }
  })

  it('moves when a toolchain entry is added', async () => {
    // Not the same claim as changing one. A key built by reading six known names would
    // hold still here while the toolchain that ran genuinely differed.
    const moved = {
      ...RENDERED_ARTIFACT,
      toolchain: { ...RENDERED_ARTIFACT.toolchain, 'wasi-sdk': '20.0' },
    }
    expect(await cidOf(moved)).not.toBe(await cidOf(RENDERED_ARTIFACT))
  })

  it('moves when the required feature set moves', async () => {
    // The mutation "drop `requiredFeatures` from `translationKeyOf`" fires exactly here
    // and nowhere else in the repository.
    expect(await cidOf({ ...RENDERED_ARTIFACT, requiredFeatures: ['simd128'] })).not.toBe(
      await cidOf(RENDERED_ARTIFACT),
    )
  })

  it('holds still for everything the container did not decide', async () => {
    const baseline = await cidOf(RENDERED_ARTIFACT)
    const irrelevant: readonly Partial<LiftedArtifact>[] = [
      { durationMs: 1 },
      { stdout: 'INFO: something' },
      { stderr: 'a warning nobody parsed' },
      { findings: [] },
      { unparsed: [{ stream: 'stdout', text: '[Bug] something new' }] },
      { declaredFeatures: [] },
      { unidentifiedTools: ['wasmedge'] },
      { undecoded: PROBE_COUNTED_ONLY },
      { blindSpots: [CROSS_MACHINE_BLIND_SPOT] },
    ]
    for (const change of irrelevant) {
      const [field] = Object.keys(change)
      expect(await cidOf({ ...RENDERED_ARTIFACT, ...change }), `${field} moved the key`).toBe(
        baseline,
      )
    }
  })
})

describe('a lift the pipeline cannot name is a failure, not a success called unknown', () => {
  it('emits the key CID a caller recomputes from the artifact it was handed', async () => {
    const docker = stubLift()
    const { result: outcome } = await despiteAFullProcessTable(() =>
      liftElf(stubElfPath, { docker: docker.path, timeoutMs: METADATA_BUDGET_MS }),
    )
    expect(outcome.ok, outcome.ok ? '' : describeLiftFailure(outcome.failure)).toBe(true)
    if (!outcome.ok) return

    // Recomputed here from the artifact's own fields, so this fails for a pipeline that
    // named a *different* key than the one its artifact describes — a stale digest, a
    // toolchain read before the last entry was added.
    expect(outcome.artifact.translation.keyCid.toString()).toBe(await cidOf(outcome.artifact))
    // And the key travels with the CID, so a mismatch can be read rather than guessed.
    expect(outcome.artifact.translation.key).toEqual(translationKeyOf(outcome.artifact))
  })

  it('names the artifact by the CID a blockstore would answer to', async () => {
    const docker = stubLift()
    const { result: outcome } = await despiteAFullProcessTable(() =>
      liftElf(stubElfPath, { docker: docker.path, timeoutMs: METADATA_BUDGET_MS }),
    )
    expect(outcome.ok, outcome.ok ? '' : describeLiftFailure(outcome.failure)).toBe(true)
    if (!outcome.ok) return

    // A real `MemoryBlockstore`, not a recomputation of the same two lines. `put`
    // returns the CID `get` answers to, and `FsBlockstore.put` computes it identically —
    // the codec is dag-cbor even though the payload is a WASM binary. The mutation "use
    // `raw` because the bytes are opaque" produces a well-formed CID that no
    // `blockstore.get` in this repository ever answers, and fires here; nothing else
    // would notice until an agent failed to resolve an artifact. Plan 21-05 is the
    // end-to-end version, where a spawned agent has to actually find it by this name.
    const stored = await new MemoryBlockstore().put(new Uint8Array(outcome.artifact.bytes))
    expect(outcome.artifact.translation.artifactCid.toString()).toBe(stored.toString())
  })

  it('refuses a lift whose toolchain reported a blank version', async () => {
    // `clang=` is what the container writes when `clang-16 --version` says nothing.
    // `parseMeta` trims, so it arrives as `''` rather than `undefined`, the `?? 'unknown'`
    // fallback does not fire, and `translationCid` refuses it. Driven through `liftElf`
    // rather than through `translationCid` directly: the criterion is about the pipeline.
    const docker = stubLift({ meta: { clang: '' } })
    const { result: outcome } = await despiteAFullProcessTable(() =>
      liftElf(stubElfPath, { docker: docker.path, timeoutMs: METADATA_BUDGET_MS }),
    )
    // The mutation "report the blank version as a silent `'unknown'`" turns this
    // `ok: false` into an `ok: true`, and the assertion fires.
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.failure).toEqual({
      kind: 'unnameable',
      reason: { kind: 'blank-version', tool: 'clang' },
    })
  })

  it('says which tool was blank, in the codec’s own words', async () => {
    const text = describeLiftFailure({
      kind: 'unnameable',
      reason: { kind: 'blank-version', tool: 'clang' },
    })
    expect(text).toContain('clang')
    expect(text).not.toContain('[object')
    // Delegated to `describeKeyFailure` rather than restated, so the two cannot drift
    // into two different accounts of one refusal.
    expect(text).toContain(describeKeyFailure({ kind: 'blank-version', tool: 'clang' }))
  })

  it('names a lift whose toolchain said the word "unknown" — the limit of the refusal', async () => {
    /**
     * Anti-vacuity for the refusal above, and a **measured limit rather than a green.**
     *
     * The refusal covers *blank* and only blank, because that is all `translationCid`
     * can see. `'unknown'` is a version as far as it is concerned, so this lift is named
     * and the string goes into the key — and the container writes exactly that string
     * itself, twice: `${WASI_VERSION_FULL:-unknown}` and
     * `git rev-parse HEAD || echo unknown`. Without this case the refusal above would
     * pass just as well if every partial lift had become unnameable, so it is needed;
     * with it, the hole is written down instead of implied.
     *
     * `unidentifiedTools` does **not** report it either — `unidentifiedIn` asks whether
     * the value is empty, and this one is not. So an artifact can claim full provenance
     * while carrying a toolchain entry that identifies nothing. That is the failure
     * `provenance-unreadable`'s own doc calls "the one wrong value `translationCid`
     * cannot catch", reached through the *partial* branch rather than the wholesale one.
     * Closing it is not this plan's to do — it would move the line between the two halves
     * of the provenance split — but it is not fixed by anything here and must not read
     * as if it were.
     */
    const docker = stubLift({ meta: { wasmedge: 'unknown' } })
    const { result: outcome } = await despiteAFullProcessTable(() =>
      liftElf(stubElfPath, { docker: docker.path, timeoutMs: METADATA_BUDGET_MS }),
    )
    expect(outcome.ok, outcome.ok ? '' : describeLiftFailure(outcome.failure)).toBe(true)
    if (!outcome.ok) return
    expect(outcome.artifact.toolchain['wasmedge']).toBe('unknown')
    expect(outcome.artifact.unidentifiedTools).toEqual([])
    expect(outcome.artifact.translation.keyCid.toString()).toBe(await cidOf(outcome.artifact))
  })
})

// ---------------------------------------------------------------------------
// Failure paths that need no container.
// ---------------------------------------------------------------------------

describe('the driver fails by name, and fails early', () => {
  it('names a missing input rather than throwing', async () => {
    const outcome = await liftElf(join(FIXTURES, 'no-such-file.elf'))
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.failure.kind).toBe('input-unreadable')
  })

  it('refuses a non-ELF before it starts a container', async () => {
    /**
     * Ordering is the assertion. `docker` here is a path that cannot be executed, so
     * if the pre-screen ran second this would come back `docker-unavailable`. It
     * comes back `refused-by-screen`, which is what saves 95 seconds per bad input.
     */
    const outcome = await liftElf(join(FIXTURES, 'clean-lift.stdout.txt'), {
      docker: '/nonexistent/definitely-not-docker',
    })
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.failure.kind).toBe('refused-by-screen')
    if (outcome.failure.kind !== 'refused-by-screen') return
    expect(outcome.failure.reason.kind).toBe('not-an-elf')
  })

  it('names an unavailable Docker rather than reporting an empty lift', async () => {
    const { result: resolved } = await despiteAFullProcessTable(() =>
      resolveImage(ELFCONV_IMAGE_TAG, '/nonexistent/definitely-not-docker', METADATA_BUDGET_MS),
    )
    expect(resolved.ok).toBe(false)
    if (resolved.ok) return
    expect(resolved.failure.kind).toBe('docker-unavailable')
    const text = describeLiftFailure(resolved.failure)
    expect(text).toContain('docker could not be run')
    // The errno, not merely the kind. `ENOENT` is what makes this arm *about docker* —
    // the host was perfectly able to fork, it just found nothing at that path — and it
    // is the half of the split that has to keep saying "docker".
    expect(text).toContain('ENOENT')
  })

  it('renders the findings a failed toolchain already named, not only its exit code', () => {
    /**
     * `toolchain-failed` is the one failure carrying structured evidence, and it
     * rendered without it — leaving `elfconv exited 134` as the entire message for
     * the case where the toolchain had *already said* which instruction it choked on.
     * The findings went into the struct and stopped there.
     */
    const findings = scanStream(
      '[Bug] Unsupported instruction at address: 0x0041a2c4 (SemanticsFunction), instForm: CASPAL_CP64_LDSTEXCL',
      'stdout',
    ).findings
    const [finding] = findings
    expect(finding).toBeDefined()
    if (finding === undefined) return

    const text = describeLiftFailure({
      kind: 'toolchain-failed',
      exitCode: 134,
      signal: null,
      findings,
      unparsed: [{ stream: 'stderr', text: 'what():  [ERROR] entry_function is not found.' }],
      stdout: '',
      stderr: '',
    })
    expect(text).toContain('exited 134')
    // Through `describeFinding`, so a finding reads identically whether the lift
    // failed or merely came back with reservations.
    expect(text).toContain(describeFinding(finding))
    expect(text).toContain('CASPAL_CP64_LDSTEXCL')
    // …and the unparsed channel is still there beside it, not displaced by it.
    expect(text).toContain('entry_function is not found')
  })

  it('describes every failure it can produce, so none renders as [object Object]', () => {
    /**
     * Keyed by kind, and the key set is the assertion.
     *
     * This was an array, with a closing comment that read *"`describeLiftFailure` has no
     * `default:` arm, so this count and `tsc` between them make an unnamed failure
     * impossible to add quietly."* **That was false and it had already failed.** The
     * missing `default:` obliges *the renderer* to handle every arm of the union; it
     * says nothing whatever about whether this list names every arm, and a `Set` of the
     * kinds present can only count what somebody remembered to write. `LiftFailure` grew
     * `docker-not-answering` on 2026-08-02 and the array never learned about it — so the
     * one kind at the centre of this file's own timeout defect was the one arm the
     * completeness case did not cover, for a day, while reading green.
     *
     * A mapped type over `LiftFailure['kind']` is the same claim made where it can be
     * checked: leave a kind out and this does not compile. That is a guard, whereas a
     * count of what is present is a tautology.
     */
    const every: { readonly [K in LiftFailure['kind']]: Extract<LiftFailure, { kind: K }> } = {
      'input-unreadable': { kind: 'input-unreadable', path: 'a', detail: 'b' },
      'refused-by-screen': {
        kind: 'refused-by-screen',
        reason: { kind: 'not-aarch64', machine: 62 },
      },
      'docker-unavailable': { kind: 'docker-unavailable', detail: 'x' },
      'docker-not-answering': { kind: 'docker-not-answering', detail: 'x', afterMs: 400 },
      'host-cannot-spawn': {
        kind: 'host-cannot-spawn',
        command: '/usr/bin/docker',
        code: 'EAGAIN',
        detail: 'x',
      },
      'image-absent': { kind: 'image-absent', image: 'i', detail: 'd' },
      'image-has-no-digest': { kind: 'image-has-no-digest', image: 'i' },
      'image-digest-foreign': {
        kind: 'image-digest-foreign',
        image: 'i:t',
        repository: 'i',
        digests: ['other@sha256:00'],
      },
      'toolchain-failed': {
        kind: 'toolchain-failed',
        exitCode: 134,
        signal: null,
        findings: [],
        unparsed: [{ stream: 'stderr', text: '[ERROR] entry_function is not found.' }],
        stdout: '',
        stderr: '',
      },
      'timed-out': { kind: 'timed-out', afterMs: 1_200_000 },
      'no-artifact': { kind: 'no-artifact', detail: 'ENOENT', stdout: '', stderr: '' },
      'features-unreadable': {
        kind: 'features-unreadable',
        reason: { kind: 'no-target-features-section' },
      },
      'provenance-unreadable': {
        kind: 'provenance-unreadable',
        path: '/tmp/o2-lift-x/meta.txt',
        detail: 'ENOENT',
      },
      unnameable: { kind: 'unnameable', reason: { kind: 'blank-version', tool: 'clang' } },
    }
    for (const [key, failure] of Object.entries(every)) {
      const text = describeLiftFailure(failure)
      expect(text.length, `${key} rendered as nothing`).toBeGreaterThan(10)
      expect(text, `${key} rendered a raw object`).not.toContain('[object')
      // Each entry must be the failure its key names, or the mapped type would be
      // satisfied by thirteen copies of one arm.
      expect(failure.kind).toBe(key)
    }
  })
})

// ---------------------------------------------------------------------------
// A host with no room to fork, which is not a host with no Docker.
// ---------------------------------------------------------------------------

/**
 * The `lift.ts` next to this file, as something a child process can import.
 *
 * A file URL rather than a copied path: the child is written to `tmpdir()`, and a
 * bare `@o2/core` inside `lift.ts` resolves from *`lift.ts`'s* directory, not from
 * the importer's — so the child gets the same module graph this test has without
 * needing a `node_modules` of its own.
 */
const LIFT_MODULE_URL = new URL('./lift.ts', import.meta.url).href

/** POSIX single-quoting, because the child is launched through `sh -c` for `ulimit`. */
const shellQuote = (text: string): string => `'${text.replaceAll("'", `'\\''`)}'`

/**
 * `resolveImage`, run in a child whose `RLIMIT_NPROC` is `maxProcesses`.
 *
 * `ulimit -u 1` against a machine already running hundreds of processes makes every
 * `fork` fail immediately, which is the condition this whole block is about. `exec`
 * is what makes it survivable: the shell is *replaced* by node rather than forking
 * it, so the limit applies to a process that is already running and only bites when
 * that process tries to spawn. Measured on this host: node starts fine at `-u 1`, and
 * 6 of 6 spawns then fail with `EAGAIN` in 0–3 ms.
 */
function resolveImageUnderProcessLimit(maxProcesses: number | null, docker: string): Attempted {
  const dir = stubDir('o2-nproc-')
  const child = join(dir, 'resolve-once.mjs')
  writeFileSync(
    child,
    'const [, , liftUrl, image, docker] = process.argv\n' +
      'const { resolveImage } = await import(liftUrl)\n' +
      `const r = await resolveImage(image, docker, ${METADATA_BUDGET_MS})\n` +
      'process.stdout.write(JSON.stringify(r.ok ? { ok: true } : { ok: false, failure: r.failure }))\n',
  )
  const argv = [
    process.execPath,
    '--experimental-strip-types',
    '--no-warnings',
    child,
    LIFT_MODULE_URL,
    ELFCONV_IMAGE_TAG,
    docker,
  ]
    .map(shellQuote)
    .join(' ')
  const stdout = execFileSync(
    '/bin/sh',
    ['-c', `${maxProcesses === null ? '' : `ulimit -u ${maxProcesses}; `}exec ${argv}`],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: METADATA_BUDGET_MS },
  )
  return JSON.parse(stdout) as Attempted
}

describe('a host that cannot fork is not a host without Docker', () => {
  /**
   * The reproduced defect, and the reason this file was intermittently red.
   *
   * Both `spawn` failure and the inspect timeout returned `docker-unavailable`, so the
   * failure output could not say which had fired — and on a loaded host it was always
   * the first. Eight cases here assert *which* `LiftFailure` a stub produces; every one
   * of them reported "docker could not be run" on a machine with a working Docker,
   * because the host had briefly run out of process slots.
   *
   * `/bin/echo` is the `docker` here on purpose. It exists and is executable, so under
   * no pressure the driver runs it and gets a real answer — see the control case below.
   * The only difference between the two cases is whether the host can fork.
   */
  it('reports the host, not Docker, when there is no room for another process', () => {
    const resolved = resolveImageUnderProcessLimit(1, '/bin/echo')
    expect(resolved.ok).toBe(false)
    if (resolved.ok) return
    expect(resolved.failure.kind).toBe('host-cannot-spawn')
    if (resolved.failure.kind !== 'host-cannot-spawn') return
    // The errno itself, because the kind alone would survive a classifier that put
    // every spawn failure in this arm — which is the mirror image of the defect.
    expect(resolved.failure.code).toBe('EAGAIN')
    expect(resolved.failure.detail).toContain('EAGAIN')

    // The text, not merely the kind. This is the sentence a reader acts on, and the
    // whole defect was that it sent them to check an installation that was fine.
    const text = describeLiftFailure(resolved.failure)
    expect(text).toContain('this machine could not start a process')
    expect(text).toContain('EAGAIN')
    expect(text).not.toContain('docker could not be run')
  })

  it('answers the same question differently when it has room to fork', () => {
    // The control. Same driver, same `/bin/echo`, same arguments — only the process
    // limit is lifted, and the answer is now about the image rather than the host.
    // Without this, the case above would still pass if `resolveImage` had simply
    // started returning `host-cannot-spawn` for everything.
    const resolved = resolveImageUnderProcessLimit(null, '/bin/echo')
    expect(resolved.ok).toBe(false)
    if (resolved.ok) return
    expect(resolved.failure.kind).toBe('image-has-no-digest')
  })

  it('sorts each spawn errno to the thing it is actually about', () => {
    // `EAGAIN`/`EMFILE`/`ENFILE`/`ENOMEM` are the host running out of room and say
    // nothing about the command. `ENOENT`/`EACCES` are statements about the command
    // itself, and have to keep naming docker or the split has moved the lie rather
    // than removed it.
    for (const code of ['EAGAIN', 'EMFILE', 'ENFILE', 'ENOMEM']) {
      const failure = classifySpawnFailure('/usr/bin/docker', code, `spawn /usr/bin/docker ${code}`)
      expect(failure.kind, `${code} should be the host`).toBe('host-cannot-spawn')
      expect(describeLiftFailure(failure)).not.toContain('docker could not be run')
    }
    for (const code of ['ENOENT', 'EACCES']) {
      const failure = classifySpawnFailure('/usr/bin/docker', code, `spawn /usr/bin/docker ${code}`)
      expect(failure.kind, `${code} should be docker`).toBe('docker-unavailable')
      expect(describeLiftFailure(failure)).toContain('docker could not be run')
    }
  })

  it('does not guess when the spawn failure carried no errno', () => {
    // A `spawn` that failed without a `code` is not evidence that the host is full,
    // and claiming it is would be the same defect pointing the other way.
    const failure = classifySpawnFailure('/usr/bin/docker', null, 'something went wrong')
    expect(failure.kind).toBe('docker-unavailable')
    expect(describeLiftFailure(failure)).toContain('something went wrong')
  })

  it('names the command it never reached, so the message is not about "a process"', () => {
    const failure = classifySpawnFailure('/opt/homebrew/bin/docker', 'EAGAIN', 'spawn … EAGAIN')
    const text = describeLiftFailure(failure)
    expect(text).toContain('/opt/homebrew/bin/docker')
    expect(text).toContain('never reached')
  })
})

/**
 * The retry helper the eight classification cases now go through.
 *
 * Held to its contract directly, because it is load-bearing test infrastructure and
 * the failure it guards against cannot be provoked in-process. A helper that had
 * quietly stopped retrying, or that had started retrying *everything*, would leave
 * every case above still green — the first by restoring the flake, the second by
 * hiding real regressions behind three re-runs.
 */
describe('retrying a host that would not fork retries nothing else', () => {
  const hostFull: Attempted = {
    ok: false,
    failure: { kind: 'host-cannot-spawn', command: '/usr/bin/docker', code: 'EAGAIN', detail: 'x' },
  }

  it('runs the case again once the host has room, and reports the later answer', async () => {
    let calls = 0
    const { result, attempts } = await despiteAFullProcessTable(() => {
      calls += 1
      return Promise.resolve(calls < 3 ? hostFull : ({ ok: true } as Attempted))
    })
    expect(result.ok).toBe(true)
    expect(attempts).toBe(3)
    expect(calls).toBe(3)
  })

  it('hands back a wrong classification immediately instead of asking again', async () => {
    // The property that keeps this from being retry-until-green. `image-absent` is a
    // real answer from a driver that ran; asking again would only hide it.
    let calls = 0
    const wrong: Attempted = {
      ok: false,
      failure: { kind: 'image-absent', image: 'i', detail: 'd' },
    }
    const { result, attempts } = await despiteAFullProcessTable(() => {
      calls += 1
      return Promise.resolve(wrong)
    })
    expect(result.ok).toBe(false)
    expect(attempts).toBe(1)
    expect(calls).toBe(1)
  })

  it('gives up loudly rather than skipping when the host never finds room', async () => {
    // Also the anti-vacuity case for the envelope below: this failure costs about a
    // millisecond, and a wrapper that had started truncating *cheap* retries would fail
    // here on the attempt count rather than quietly protecting less than it says.
    let calls = 0
    await expect(
      despiteAFullProcessTable(() => {
        calls += 1
        return Promise.resolve(hostFull)
      }),
    ).rejects.toThrow(/refused to create a process 4 times/)
    expect(calls).toBe(HOST_SPAWN_ATTEMPTS)
  })

  /**
   * The half that was missing, and that cost this file ten `60000ms` timeouts.
   *
   * The wrapper bounded its retries by a count and not by a duration, and an attempt's
   * duration is a budget the caller chose — four attempts of {@link METADATA_BUDGET_MS}
   * is 81 500 ms of driver budget inside a {@link CASE_BUDGET_MS} case. So the framework
   * killed the case first, every time, and reported its own budget: a number that says
   * only that the number exists. Both arms below are proved at ~1/30th scale, against an
   * injected `caseBudgetMs`, so the guard costs under two seconds rather than a minute.
   */
  const daemonSilent: Attempted = {
    ok: false,
    failure: { kind: 'docker-not-answering', detail: 'x', afterMs: 700 },
  }

  it('stops asking once the answer it got would not fit again, and names what it measured', async () => {
    // 2 000 ms of case ⇒ a 1 000 ms envelope. One 700 ms answer, and 700 + 250 of
    // backoff + another 700 is 1 650 — so there is no room, and the wrapper says so
    // rather than starting an attempt the framework would have to end.
    let calls = 0
    await expect(
      despiteAFullProcessTable(
        () => {
          calls += 1
          return new Promise<Attempted>((resolve) => {
            setTimeout(() => resolve(daemonSilent), 700).unref()
          })
        },
        { caseBudgetMs: 2_000 },
      ),
    ).rejects.toThrow(/leaves no room for another attempt inside the 1000 ms/)
    expect(calls).toBe(1)
  })

  it('reports it itself when one attempt outlives the whole envelope', async () => {
    // The sharpest form: a single attempt whose budget is not smaller than the
    // framework's. Nothing about it is retryable and nothing about it is the wrapper's
    // to wait out — the only useful act is to say so, with the measurement, before
    // vitest says nothing with a bigger one.
    await expect(
      despiteAFullProcessTable(
        () =>
          new Promise<Attempted>((resolve) => {
            setTimeout(() => resolve(daemonSilent), 30_000).unref()
          }),
        { caseBudgetMs: 600 },
      ),
    ).rejects.toThrow(/still running \d+ ms in, past the 300 ms/)
  })

  it('spends every attempt on a silent daemon that answers cheaply', async () => {
    // Anti-vacuity for both arms above, on the condition they truncate. The retry of
    // `docker-not-answering` was added 2026-08-02 against a reproduced failure, and the
    // envelope must not have quietly repealed it: the same failure that buys no retry at
    // 700 ms buys all four when it costs nothing, on the same wrapper in the same run.
    let calls = 0
    await expect(
      despiteAFullProcessTable(() => {
        calls += 1
        return Promise.resolve(daemonSilent)
      }),
    ).rejects.toThrow(/did not answer 4 times running/)
    expect(calls).toBe(HOST_SPAWN_ATTEMPTS)
  })
})

// ---------------------------------------------------------------------------
// The real thing. Docker, six gigabytes, and about two minutes per lift.
// ---------------------------------------------------------------------------

/**
 * What the gate established about the image, and — when it established nothing — why.
 *
 * ## This gate used to answer with whichever way the daemon happened to be down
 *
 * The function that stood here asked `docker image inspect` and nothing else, and
 * `docker image inspect` answers two questions through one exit code. Measured on this
 * host on 2026-08-12, docker 29.4.0:
 *
 * | condition | exit | stderr |
 * |---|---|---|
 * | the image really is absent | 1 | `Error response from daemon: No such image: …` |
 * | the daemon's socket refuses | 1 | `failed to connect to the docker API at unix://…` |
 * | the daemon's socket accepts and hangs | — | never returns; killed at the budget, `ETIMEDOUT` |
 *
 * Row 2 cleared the `typeof code !== 'string'` guard and returned
 * `{ present: false, undetermined: null }` — **a silent skip claiming the image is absent,
 * which is a thing nothing observed.** Row 3 landed in the retry set and came back
 * `undetermined`, which the case below turns into a **red**. So on 2026-08-12, with this
 * host's OrbStack daemon wedged, this file went red while 47 cases across
 * `elflift-wasi-gate.node.test.ts`, `echo-guest.node.test.ts` and
 * `elfconv-differential.node.test.ts` skipped — one host, one cause, and a failure that
 * named this machine's process table for a container runtime that had died.
 *
 * The three siblings were not stricter or looser. They ask `docker version` — the daemon
 * question — and never reach the image question at all.
 *
 * ## What replaced it
 *
 * `tools/aot/docker-gate.ts`, which asks the daemon first and the image second, and asks
 * the daemon **again** when an inspect fails — because an exit code is an answer only if
 * something answered it. Read that file for the order and for what each arm is worth. The
 * five call sites that each carried their own copy of this predicate now share it.
 *
 * ## What is still red here, and it is narrower than it was
 *
 * Only `undetermined`: the question never left this host (`EAGAIN` and its family), or it
 * left and never came back *from a daemon that is demonstrably still answering*. Both are
 * "nobody found out", and a skip for a reason nobody measured is a claim that happens to be
 * false. A daemon that is down, or a host with no docker, is an **observation** — the same
 * observation the three siblings have always skipped on, and this file now agrees with them.
 */
const IMAGE_GATE: ImageGate = gateOnImage(ELFCONV_IMAGE_TAG)

const HAVE_IMAGE = isRunnable(IMAGE_GATE)

/**
 * The skip note, carried into the `describe` title below.
 *
 * The sibling specs' idiom — `elflift-wasi-gate.node.test.ts:468`,
 * `wasi-preview1-surface.node.test.ts:284` — adopted here because a skipped suite whose
 * title says nothing is indistinguishable from a suite nobody wrote. It is the *loud* half
 * of "skip loudly": vitest prints the suite name for skipped cases, so the reason travels
 * with them into any log that keeps the run.
 */
const SKIP_NOTE = HAVE_IMAGE ? 'runnable' : `SKIPPED: ${describeGate(IMAGE_GATE)}`

/** Two lifts plus a compile, on a host where one lift is ~95 s. */
const INTEGRATION_TIMEOUT_MS = 15 * 60 * 1000

/**
 * The artifact of a lift that succeeded, or a failure with a reason attached.
 *
 * Four of the blocks below opened with `if (!first.ok) return`, which is the shape a
 * *skip* takes, applied to a *failure*. The Docker gate above is a legitimate skip —
 * a host without the image cannot run these and should not pretend to. A lift that
 * ran and came back `ok: false` is the opposite: it is the toolchain telling us
 * something, and returning early turned every assertion in the block into a
 * no-op that reported green. Six passing tests, none of which executed an
 * expectation.
 *
 * The message carries {@link describeLiftFailure} so the report is the diagnosis
 * rather than a prompt to go and re-run it by hand.
 */
function liftedArtifact(outcome: LiftOutcome | undefined): LiftedArtifact {
  expect(outcome, 'beforeAll never assigned a lift outcome').toBeDefined()
  if (outcome === undefined) throw new Error('beforeAll never assigned a lift outcome')
  expect(outcome.ok, outcome.ok ? 'the lift succeeded' : describeLiftFailure(outcome.failure)).toBe(
    true,
  )
  if (!outcome.ok) throw new Error(describeLiftFailure(outcome.failure))
  return outcome.artifact
}

/**
 * The one case about the gate, deliberately outside the block it gates.
 *
 * Outside, because a case inside that `describe` would drag its `beforeAll` — three real
 * container runs and about 280 s — into every attempt to check the gate itself. Here it
 * costs whatever the gate already spent at module scope and nothing more.
 *
 * The block below is gated on {@link HAVE_IMAGE}, and a gate is only as honest as its
 * `false`. Three of the ways it can be `false` are observations — a daemon answered and
 * said the image is not here, a daemon did not answer at all, or there is no docker on this
 * host — and those skip green, which is right. The fourth is the gate failing to find out,
 * and until 2026-08-05 it was indistinguishable from the first: seven skips, no message,
 * and a green file that had measured nothing about the toolchain.
 *
 * **2026-08-12: the second of those three observations used to arrive as one of the other
 * two, and which one it got was decided by whether the daemon's socket refused or hung.**
 * See {@link IMAGE_GATE} for the measured table, and `docker-gate.ts` for the fix.
 *
 * A red here does not say the toolchain is broken. It says nobody knows on this host, and
 * that the seven skips below are not evidence of anything. That is worth one failure, and
 * it is not worth widening — nor narrowing past the one condition it names.
 */
describe('the gate that decides whether the toolchain gets measured', () => {
  it('skips for a reason it measured, or says that it could not measure one', () => {
    expect(isUndetermined(IMAGE_GATE) ? describeGate(IMAGE_GATE) : null, 'the gate found out').toBeNull()
  })

  it('says out loud which of the four conditions it found, in the suite title', () => {
    // The loud half. A skipped suite carries its reason into the run's output, so a reader
    // scanning a log can tell a dead daemon from an absent image without opening this file
    // — which on 2026-08-12 was the difference between a false red and a true skip.
    expect(SKIP_NOTE).toBe(HAVE_IMAGE ? 'runnable' : `SKIPPED: ${describeGate(IMAGE_GATE)}`)
    expect(SKIP_NOTE.length).toBeGreaterThan(0)
    if (HAVE_IMAGE) return
    // Whatever the reason was, it names the condition rather than merely announcing a skip.
    expect(SKIP_NOTE).toMatch(
      /NOT PRESENT|THE DOCKER DAEMON IS NOT ANSWERING|NO DOCKER CLIENT|NOBODY FOUND OUT/,
    )
  })

  it('runs the seven cases below on a measured presence and on nothing else', () => {
    // The wiring, asserted rather than read: the only thing that unlocks the toolchain
    // cases is a daemon that answered AND an image it said was there. A gate arm quietly
    // promoted into `HAVE_IMAGE` — which is how "make it skip" becomes "make it pass" —
    // fails here. Always runs; no arm of this is conditional on today's host.
    expect(HAVE_IMAGE, describeGate(IMAGE_GATE)).toBe(IMAGE_GATE.kind === 'image-present')
    // …and the red is one arm, not "everything that is not runnable".
    expect(isUndetermined(IMAGE_GATE)).toBe(IMAGE_GATE.kind === 'undetermined')
    expect(HAVE_IMAGE && isUndetermined(IMAGE_GATE)).toBe(false)
  })
})

describe(`a real binary goes through the real toolchain (${SKIP_NOTE})`, () => {
  let work = ''
  let first: LiftOutcome | undefined
  let second: LiftOutcome | undefined

  beforeAll(async () => {
    if (!HAVE_IMAGE) return
    work = mkdtempSync(join(tmpdir(), 'o2-lift-it-'))
    /**
     * The subject is built *inside* the image.
     *
     * The host is macOS and has no AArch64 Linux cross-compiler, and committing a
     * 659 KB binary to make a test runnable would put an opaque artifact in the
     * repository. The image is already an arm64 Linux userland with clang-16, so it
     * can produce its own input — and the input is then reproducible from four lines
     * of C rather than trusted because it is checked in.
     */
    execFileSync(
      'docker',
      [
        'run',
        '--rm',
        '--network',
        'none',
        '-e',
        'EMSDK_QUIET=1',
        '--entrypoint',
        '/bin/bash',
        '-v',
        `${work}:/out`,
        ELFCONV_IMAGE_TAG,
        '--login',
        '-c',
        'printf "int main(void){ return 42; }\\n" > /tmp/subject.c && ' +
          'clang-16 -O0 -static -o /out/subject /tmp/subject.c && chmod a+rw /out/subject',
      ],
      { stdio: ['ignore', 'ignore', 'pipe'], timeout: 5 * 60 * 1000 },
    )

    first = await liftElf(join(work, 'subject'))
    second = await liftElf(join(work, 'subject'))
  }, INTEGRATION_TIMEOUT_MS)

  it.skipIf(!HAVE_IMAGE)(
    'produces a wasi32 artifact whose feature set it read rather than assumed',
    () => {
      const artifact = liftedArtifact(first)
      expect(artifact.target).toBe('aarch64-wasi32')
      // \0asm — it is a WASM module, not the wasmedge AOT output that sits next to it
      // in the container with a very similar name.
      expect([...artifact.bytes.subarray(0, 4)]).toEqual([0x00, 0x61, 0x73, 0x6d])
      expect(artifact.bytes.length).toBeGreaterThan(1_000_000)
      expect(artifact.requiredFeatures).toEqual(['bulk-memory', 'mutable-globals', 'sign-ext'])
    },
    INTEGRATION_TIMEOUT_MS,
  )

  it.skipIf(!HAVE_IMAGE)(
    'keys the translation on the image digest, never on the mutable tag',
    () => {
      const artifact = liftedArtifact(first)
      const image = artifact.toolchain['elfconv-image'] ?? ''
      expect(image).toContain('@sha256:')
      expect(image).not.toContain(':arm64')
      // Every tool the artifact could have changed with is named, so a blank one
      // cannot slip into `translationCid`.
      for (const version of Object.values(artifact.toolchain)) {
        expect(version.trim()).not.toBe('')
        expect(version).not.toBe('unknown')
      }
    },
    INTEGRATION_TIMEOUT_MS,
  )

  it.skipIf(!HAVE_IMAGE)(
    'refuses to call a lift clean that left addresses untranslated in silence',
    () => {
      const artifact = liftedArtifact(first)
      /**
       * The measurement this driver exists for. elfconv exits 0, prints six INFO
       * lines and nothing else, and leaves real SVE instructions inside glibc's
       * `__memcpy_a64fx` untranslated. Believing the exit code here would put an
       * artifact that aborts at runtime into the cache under a name that says it is
       * fine.
       */
      expect(artifact.undecoded.kind).toBe('measured')
      if (artifact.undecoded.kind !== 'measured') return
      expect(artifact.undecoded.addresses.length).toBeGreaterThan(0)
      // The two greps agreed, which is the state that makes the address list evidence
      // rather than an artefact of one of them having stopped matching.
      expect(artifact.undecoded.callSites).toBeGreaterThanOrEqual(
        artifact.undecoded.addresses.length,
      )
      expect(artifact.verdict).toBe('reservations')
      // …and the output really did say nothing, which is the part that makes the
      // probe necessary rather than merely thorough.
      expect(artifact.findings).toEqual([])
      expect(artifact.blindSpots).toContainEqual(REACHABILITY_BLIND_SPOT)
    },
    INTEGRATION_TIMEOUT_MS,
  )

  it.skipIf(!HAVE_IMAGE)(
    'carries a blind spot for every class it did not measure',
    () => {
      const artifact = liftedArtifact(first)
      // Structural: no configuration removes it.
      expect(artifact.blindSpots).toContainEqual(CROSS_MACHINE_BLIND_SPOT)
      // …and both unmeasured-probe spots are absent precisely because the probe ran
      // and both of its greps agreed.
      expect(artifact.blindSpots).not.toContainEqual(UNDECODED_UNMEASURED_BLIND_SPOT)
      expect(artifact.blindSpots).not.toContainEqual(UNDECODED_ADDRESSES_UNRECOVERED_BLIND_SPOT)
    },
    INTEGRATION_TIMEOUT_MS,
  )

  it.skipIf(!HAVE_IMAGE)(
    'lifts the same bytes twice to byte-identical artifacts — on this host, and only this host',
    () => {
      /**
       * **Same-host only.** Both lifts ran in containers on one machine, minutes
       * apart. That is the floor: a toolchain that cannot agree with itself cannot
       * be reproducible at all. It is *not* evidence about a second machine, and the
       * artifact says so in {@link CROSS_MACHINE_BLIND_SPOT} rather than leaving a
       * reader to infer more than was measured — elfconv's virtual-register
       * promotion iterates a pointer-keyed `std::unordered_map`, whose order is an
       * address-space property.
       */
      const one = liftedArtifact(first)
      const two = liftedArtifact(second)

      expect(two.bytes.length).toBe(one.bytes.length)
      expect(Buffer.from(two.bytes).equals(Buffer.from(one.bytes))).toBe(true)
      // The identity has to hold for the key too, or two identical artifacts would
      // still be cached under two names.
      expect(two.inputDigest).toBe(one.inputDigest)
      expect(two.toolchain).toEqual(one.toolchain)
      expect(two.requiredFeatures).toEqual(one.requiredFeatures)
      // The **emitted** CID, not only its ingredients. Without this line the repeat half
      // of the roadmap criterion is asserted of the three fields above and never of the
      // name the pipeline actually produced — and the mutation "seed the key with
      // something the container did not determine", a timestamp or a work-directory
      // name, fires here and nowhere else in the repository.
      expect(two.translation.keyCid.equals(one.translation.keyCid)).toBe(true)
      // Same bytes, so the same artifact name too.
      expect(two.translation.artifactCid.equals(one.translation.artifactCid)).toBe(true)
    },
    INTEGRATION_TIMEOUT_MS,
  )

  it.skipIf(!HAVE_IMAGE)(
    'names a missing image instead of pulling six gigabytes unasked',
    async () => {
      const resolved = await resolveImage('ghcr.io/yomaytk/elfconv:no-such-tag-exists', 'docker', 60_000)
      expect(resolved.ok).toBe(false)
      if (resolved.ok) return
      expect(resolved.failure.kind).toBe('image-absent')
    },
    120_000,
  )

  it.skipIf(!HAVE_IMAGE)(
    'renders the whole lift as something a build log can keep',
    () => {
      const rendered = describeLift(liftedArtifact(first))
      expect(rendered).toContain('aarch64-wasi32')
      expect(rendered).toContain('RESERVATIONS')
      expect(rendered).toContain('not translated, silently')
      // Never both. The verdict and the reassurance in one string is the reading a
      // build log gives up on.
      expect(rendered).not.toContain('every address was translated')
    },
    INTEGRATION_TIMEOUT_MS,
  )

  afterAll(() => {
    if (work !== '') rmSync(work, { recursive: true, force: true })
  })
})
