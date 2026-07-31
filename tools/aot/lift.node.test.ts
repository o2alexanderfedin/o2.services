import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  CROSS_MACHINE_BLIND_SPOT,
  DEFAULT_TIMEOUT_MS,
  ELFCONV_IMAGE_TAG,
  IMAGE_RESOLVE_CAP_MS,
  LIFT_TARGET,
  REACHABILITY_BLIND_SPOT,
  UNDECODED_ADDRESSES_UNRECOVERED_BLIND_SPOT,
  UNDECODED_UNMEASURED_BLIND_SPOT,
  blindSpotsFor,
  describeFinding,
  describeLift,
  describeLiftFailure,
  liftElf,
  readTargetFeatures,
  resolveImage,
  scanStream,
  scanToolchainOutput,
  verdictOf,
} from './lift.ts'
import type { LiftFinding, LiftOutcome, LiftedArtifact, UndecodedProbe } from './lift.ts'

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
 */
vi.setConfig({ testTimeout: 60_000 })

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
 * different {@link UndecodedProbe} change one field instead of restating a
 * seventeen-field literal — three copies of which would drift the moment
 * `LiftedArtifact` grows a field, and drift in a *fixture* is invisible.
 */
const RENDERED_ARTIFACT: LiftedArtifact = {
  bytes: new Uint8Array(bytes(WASM_HEADER, REAL_SECTION)),
  verdict: 'reservations',
  target: LIFT_TARGET,
  toolchain: { 'elfconv-image': 'ghcr.io/yomaytk/elfconv@sha256:22a404f3', clang: '16.0.6' },
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
// A `docker` that is a shell script, so the driver's decisions are testable.
// ---------------------------------------------------------------------------

/**
 * A stub `docker` on `PATH`-free disk, plus a log of everything it was asked to do.
 *
 * `liftElf` and `resolveImage` both already take the executable's path, so the seam
 * exists and nothing needs mocking. The *log* is the point. Every behaviour tested
 * through this stub is something the driver must not do — resolve to somebody else's
 * digest, start a container after refusing, leave one running after a timeout — and
 * none of those is observable from a return value. A driver that refused an image and
 * then ran it anyway satisfies every assertion about its `LiftFailure`.
 */
interface StubDocker {
  readonly path: string
  /** One line per invocation, argv space-joined, in the order they happened. */
  readonly invocations: () => readonly string[]
}

const stubDirs: string[] = []

/**
 * `body` is `sh`, appended after the logging prologue, with `$1` as the subcommand.
 *
 * The prologue flattens newlines out of the argv before logging, because one of the
 * arguments the driver passes to `docker run` is a twenty-line shell script — logged
 * raw it would turn a single invocation into twenty log lines and every count
 * assertion below would be measuring the wrong thing.
 */
function stubDocker(body: string): StubDocker {
  const dir = mkdtempSync(join(tmpdir(), 'o2-stub-docker-'))
  stubDirs.push(dir)
  const log = join(dir, 'invocations.log')
  const path = join(dir, 'docker')
  writeFileSync(
    path,
    `#!/bin/sh\nprintf '%s\\n' "$(printf '%s ' "$@" | tr '\\n' ' ')" >> '${log}'\n${body}\n`,
    { mode: 0o755 },
  )
  return {
    path,
    invocations: () =>
      existsSync(log)
        ? readFileSync(log, 'utf8')
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line !== '')
        : [],
  }
}

/**
 * The smallest byte string `screenElf` accepts, built here rather than committed.
 *
 * These tests have to get *past* the pre-screen to observe what the driver does
 * next, and the only real AArch64 static ELF around is the 659 KB one the integration
 * block compiles inside the image — unavailable exactly when Docker is, and not
 * something to check in. So: 192 bytes of ELF64 little-endian `ET_EXEC` for machine
 * 183, no program headers to be refused as dynamic, and a two-entry section table
 * whose second entry is an `SHT_SYMTAB` so the file reads as unstripped. elfconv would
 * make nothing of it; the pre-screen is the only code that ever looks.
 */
function acceptableElf(): Uint8Array {
  const file = new Uint8Array(64 + 2 * 64)
  const view = new DataView(file.buffer)
  file.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0], 0) // \x7fELF, ELFCLASS64, ELFDATA2LSB
  view.setUint16(16, 2, true) // e_type = ET_EXEC — ET_DYN is refused as position-independent
  view.setUint16(18, 183, true) // e_machine = EM_AARCH64
  view.setBigUint64(40, 64n, true) // e_shoff — the section table follows the header
  view.setUint16(58, 64, true) // e_shentsize
  view.setUint16(60, 2, true) // e_shnum
  // e_phnum and e_shstrndx stay 0: no segments to carry PT_INTERP/PT_DYNAMIC, and no
  // string table, so every section name reads empty. Acceptance turns on the *type*
  // of section 1, never on its name.
  view.setUint32(64 + 64 + 4, 2, true) // section 1 sh_type = SHT_SYMTAB ⇒ not stripped
  return file
}

let stubElfPath = ''

beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), 'o2-stub-elf-'))
  stubDirs.push(dir)
  stubElfPath = join(dir, 'subject')
  writeFileSync(stubElfPath, acceptableElf())
})

afterAll(() => {
  for (const dir of stubDirs) rmSync(dir, { recursive: true, force: true })
})

/** The digest a correctly-tagged local image would carry. */
const MATCHING_DIGEST =
  'ghcr.io/yomaytk/elfconv@sha256:22a404f31c9f7bb5c49e3193081d4876718253d86747aae3d30fcfd971f19c05'

/** Two entries from somewhere else entirely — the shape a re-tag leaves behind. */
const FOREIGN_DIGESTS: readonly string[] = [
  'docker.io/library/busybox@sha256:1111111111111111111111111111111111111111111111111111111111111111',
  'ghcr.io/someone-else/elfconv@sha256:2222222222222222222222222222222222222222222222222222222222222222',
]

/** `printf` that emits each argument on its own line, the way `{{join}}` does. */
const emitDigests = (digests: readonly string[]): string =>
  digests.length === 0 ? 'exit 0' : `printf '%s\\n' '${digests.join("' '")}'\nexit 0`

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
    const resolved = await resolveImage(ELFCONV_IMAGE_TAG, docker.path, METADATA_BUDGET_MS)
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
    const outcome = await liftElf(stubElfPath, { docker: docker.path })
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.failure.kind).toBe('image-digest-foreign')

    // The assertion the return value cannot make. One invocation, and it is the
    // inspect.
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
    const resolved = await resolveImage(ELFCONV_IMAGE_TAG, docker.path, METADATA_BUDGET_MS)
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
    const resolved = await resolveImage(image, docker.path, METADATA_BUDGET_MS)
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return
    expect(resolved.reference).toBe(digest)
  })

  it('keeps "no digests at all" a separate failure from "digests for elsewhere"', async () => {
    // Different fixes — push the locally built image, versus re-pull by the name you
    // mean — so collapsing them would send half the readers to the wrong one.
    const docker = stubDocker(emitDigests([]))
    const resolved = await resolveImage(ELFCONV_IMAGE_TAG, docker.path, METADATA_BUDGET_MS)
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
    const outcome = await liftElf(stubElfPath, {
      docker: docker.path,
      timeoutMs: TIMEOUT_CASE_BUDGET_MS,
    })
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
    const outcome = await liftElf(stubElfPath, {
      docker: docker.path,
      timeoutMs: TIMEOUT_CASE_BUDGET_MS,
    })
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.failure.kind).toBe('timed-out')
    expect(docker.invocations().some((line) => line.startsWith('rm --force '))).toBe(true)
  })
})

describe('the caller’s timeout bounds image resolution too', () => {
  it('gives up on a wedged inspect in the time it was given, not in a hardcoded minute', async () => {
    // `liftElf` passed a literal 60_000 to `resolveImage`, so `timeoutMs` did not
    // reach it at all. The bound below is deliberately loose: it is twenty times the
    // requested timeout and still an order of magnitude under the minute this used to
    // take.
    // `exec` for the reason given in the block above: a forked sleep holds the stdio
    // pipes open past the SIGKILL and `run()` resolves on `close`.
    const docker = stubDocker('exec sleep 30')
    const started = Date.now()
    const outcome = await liftElf(stubElfPath, { docker: docker.path, timeoutMs: 400 })
    const elapsed = Date.now() - started

    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    // Not `image-absent`: the image was never reported missing, the daemon just never
    // answered, and telling someone to pull six gigabytes they already have would
    // send them to the same wedged daemon.
    expect(outcome.failure.kind).toBe('docker-unavailable')
    expect(describeLiftFailure(outcome.failure)).toContain('did not answer within 400 ms')
    expect(elapsed).toBeLessThan(8_000)
  })

  it('does not hand a twenty-minute lift budget to a metadata read', async () => {
    // The option applies, capped — the smaller of the two wins. With the default
    // twenty minutes the cap is what bounds it, and the cap is what stops a wedged
    // daemon holding a build in silence for the whole budget.
    const docker = stubDocker(emitDigests([MATCHING_DIGEST]))
    const resolved = await resolveImage(ELFCONV_IMAGE_TAG, docker.path, METADATA_BUDGET_MS)
    expect(resolved.ok).toBe(true)
    expect(IMAGE_RESOLVE_CAP_MS).toBeLessThan(DEFAULT_TIMEOUT_MS)
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
    const resolved = await resolveImage(
      ELFCONV_IMAGE_TAG,
      '/nonexistent/definitely-not-docker',
      METADATA_BUDGET_MS,
    )
    expect(resolved.ok).toBe(false)
    if (resolved.ok) return
    expect(resolved.failure.kind).toBe('docker-unavailable')
    expect(describeLiftFailure(resolved.failure)).toContain('docker could not be run')
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
    const every = [
      { kind: 'input-unreadable', path: 'a', detail: 'b' },
      { kind: 'refused-by-screen', reason: { kind: 'not-aarch64', machine: 62 } },
      { kind: 'docker-unavailable', detail: 'x' },
      { kind: 'image-absent', image: 'i', detail: 'd' },
      { kind: 'image-has-no-digest', image: 'i' },
      {
        kind: 'image-digest-foreign',
        image: 'i:t',
        repository: 'i',
        digests: ['other@sha256:00'],
      },
      {
        kind: 'toolchain-failed',
        exitCode: 134,
        signal: null,
        findings: [],
        unparsed: [{ stream: 'stderr', text: '[ERROR] entry_function is not found.' }],
        stdout: '',
        stderr: '',
      },
      { kind: 'timed-out', afterMs: 1_200_000 },
      { kind: 'no-artifact', detail: 'ENOENT', stdout: '', stderr: '' },
      { kind: 'features-unreadable', reason: { kind: 'no-target-features-section' } },
    ] as const
    for (const failure of every) {
      const text = describeLiftFailure(failure)
      expect(text.length).toBeGreaterThan(10)
      expect(text).not.toContain('[object')
    }
  })
})

// ---------------------------------------------------------------------------
// The real thing. Docker, six gigabytes, and about two minutes per lift.
// ---------------------------------------------------------------------------

function imageIsPresent(): boolean {
  try {
    execFileSync('docker', ['image', 'inspect', ELFCONV_IMAGE_TAG, '--format', '{{.Id}}'], {
      stdio: ['ignore', 'ignore', 'ignore'],
      timeout: 60_000,
    })
    return true
  } catch {
    return false
  }
}

const HAVE_IMAGE = imageIsPresent()

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

describe('a real binary goes through the real toolchain', () => {
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
