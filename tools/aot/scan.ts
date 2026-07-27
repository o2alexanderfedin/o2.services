/**
 * Reading what the lifter said, because the exit code does not say it.
 *
 * `elfconv` exits 0 on translations it knows are broken. Three separate paths let a
 * lift "succeed" while producing an artifact that aborts the moment the affected
 * address is reached, and every one of them announces itself only as a line of text
 * on stdout or stderr:
 *
 * | printed by | means |
 * |---|---|
 * | `[Bug] Unsupported instruction at address: 0x… (SemanticsFunction), instForm: …` | decoded, but remill has no semantics function for that form — the lifter substitutes `unsupported_instruction` and keeps going |
 * | `[WARNING] Unsupported instruction at address: 0x… (TryDecode), instForm: …` | the operands would not decode |
 * | `[WARNING] Unsupported instruction at address: 0x… (TryExtract) size: …` | the bytes would not even extract to an instruction form |
 * | `Unrecognized system register c080 with op0=…` | an `MRS`/`MSR` naming a register remill does not model |
 *
 * The formats above are not guessed. They are the literal `printf` and `LOG(ERROR)`
 * format strings in `backend/remill/lib/BC/InstructionLifter.cpp:115`,
 * `backend/remill/lib/Arch/AArch64/Arch.cpp:904`, `:925` and `:4196` inside the
 * image, read out of the container rather than inferred from observed output — which
 * matters, because only two of the four are compiled in (see below) and a scanner
 * built purely from what happened to be seen would silently miss the rest.
 *
 * ## Why every unparsed diagnostic is reported
 *
 * A scanner keyed on exact prose is one upstream commit away from matching nothing,
 * and matching nothing looks exactly like a clean lift. So anything that *looks* like
 * a diagnostic — a `[Bug]`/`[WARNING]`/`[ERROR]` tag, or a glog severity line — and
 * does not parse into a finding is returned in {@link ToolchainScan.unparsed}. A
 * format change then shows up as an unparsed line in the build log instead of as
 * silence, which is the difference between a guard and a decoration.
 *
 * That channel is also what catches hard aborts. `[ERROR] entry_function is not
 * found.` — a real message, captured from a `-nostdlib` input — is not a finding
 * about an instruction and deliberately has no parser; it surfaces as unparsed text
 * beside a non-zero exit code, which is enough.
 *
 * ## What this cannot see, measured
 *
 * In `ghcr.io/yomaytk/elfconv:arm64` the two `[WARNING]` forms are compiled out:
 * `WARNING_OUTPUT` is commented out at
 * `backend/remill/include/remill/BC/HelperMacro.h:10`. So a decode failure in *this*
 * image is completely silent — and it is not rare. Lifting a static
 * `int main(void){ return 42; }` (659 KB, clang-16 `-O0 -static`) printed nothing at
 * all and still emitted 259 `__ecv_warning` calls covering 174 distinct addresses,
 * every sampled one a real SVE instruction inside glibc's `__memcpy_a64fx`.
 *
 * Both `[WARNING]` parsers are kept anyway. They cost four lines, they are written
 * against the format strings rather than against observed output, and an image built
 * with `WARNING_OUTPUT` on must not need a code change to be understood.
 *
 * Pure module: strings in, findings out. The driver in `lift.ts` supplies the
 * strings, and closes the silent-decode gap by a separate route.
 */

/**
 * Colour codes: elfconv writes its tags through `\033[32m` and `\033[0;31m`.
 *
 * The escape byte is part of the pattern, written as `\u001b` rather than as the
 * literal control character — an invisible byte in source survives exactly until
 * somebody reformats the file. Matching only `[0;31m` would both leave the escape
 * behind and eat a literal `[…m` out of a message that was never coloured.
 */
const ANSI = /\u001b\[[0-9;]*m/g

const stripAnsi = (line: string): string => line.replace(ANSI, '')

/**
 * One thing the toolchain said about an address it could not translate properly.
 *
 * Discriminated by *which* stage gave up, not by severity, because the stages fail
 * differently and want different responses. `no-semantics` means remill decoded the
 * instruction and has no implementation of it — a gap in remill. `decode-failed` and
 * `extract-failed` mean the bytes did not resolve to an instruction at all, which on
 * a real binary is as often data in `.text` as it is an unsupported encoding.
 * `unknown-system-register` is a third thing again: the instruction is understood,
 * the register it names is not modelled.
 */
export type LiftFinding =
  | {
      readonly kind: 'no-semantics'
      readonly address: bigint
      readonly instructionForm: string
      readonly stream: OutputStream
      readonly raw: string
    }
  | {
      readonly kind: 'decode-failed'
      readonly address: bigint
      readonly instructionForm: string
      readonly stream: OutputStream
      readonly raw: string
    }
  | {
      readonly kind: 'extract-failed'
      readonly address: bigint
      /** `size:` from the message — how many bytes the extractor was offered. */
      readonly byteLength: number
      readonly stream: OutputStream
      readonly raw: string
    }
  | {
      readonly kind: 'unknown-system-register'
      /**
       * The `op0/op1/crn/crm/op2` encoding, as remill printed it in hex.
       *
       * No address: `Arch.cpp:4196` does not print one, and inventing a zero here
       * would put a wrong address in a build log. The encoding is the identifying
       * fact, and it is enough to look the register up.
       */
      readonly encoding: number
      readonly op0: number
      readonly op1: number
      readonly crn: number
      readonly crm: number
      readonly op2: number
      readonly stream: OutputStream
      readonly raw: string
    }

export type OutputStream = 'stdout' | 'stderr'

export interface ToolchainScan {
  readonly findings: readonly LiftFinding[]
  /**
   * Lines that look like a diagnostic and did not parse. Never ignored — see the
   * module comment. A non-empty list is a signal about the *scanner*, not only
   * about the lift.
   */
  readonly unparsed: readonly UnparsedDiagnostic[]
  /** Anti-vacuity: a scan of nothing must not read as a scan that found nothing. */
  readonly linesRead: number
}

export interface UnparsedDiagnostic {
  readonly stream: OutputStream
  readonly text: string
}

// ---------------------------------------------------------------------------
// Parsers, one per format string in the image. Each is anchored on the literal
// prose so a reformat fails to match rather than half-matching into a wrong
// address — a finding at address 0 is worse than an unparsed line, because a build
// log reader believes it.
// ---------------------------------------------------------------------------

/** `InstructionLifter.cpp:115` — `printf("[Bug] Unsupported instruction at address: 0x%08lx (SemanticsFunction), instForm: %s\n", …)` */
const NO_SEMANTICS =
  /^\[Bug\] Unsupported instruction at address: 0x([0-9a-fA-F]+) \(SemanticsFunction\), instForm: (\S+)/

/** `Arch.cpp:925` — the same shape under a `[WARNING]` tag. Compiled out in this image. */
const DECODE_FAILED =
  /^\[WARNING\] Unsupported instruction at address: 0x([0-9a-fA-F]+) \(TryDecode\), instForm: (\S+)/

/** `Arch.cpp:904`. Compiled out in this image. */
const EXTRACT_FAILED =
  /^\[WARNING\] Unsupported instruction at address: 0x([0-9a-fA-F]+) \(TryExtract\) size: (\d+)/

/**
 * `Arch.cpp:4196`, through glog, so it arrives with glog's `E<date> <time> <tid>
 * <file>:<line>]` prefix on stderr. The prefix is skipped rather than matched: it
 * carries a timestamp and a thread id, and pinning those would make the parser fail
 * on a machine with a different clock.
 */
const UNKNOWN_SYSTEM_REGISTER =
  /Unrecognized system register ([0-9a-f]+) with op0=([0-9a-f]+), op1=([0-9a-f]+), crn=([0-9a-f]+), crm=([0-9a-f]+), op2=([0-9a-f]+)/

/**
 * Looks like a diagnostic.
 *
 * Deliberately broad. `[INFO]` is excluded because elfconv narrates every successful
 * step with it and including it would bury the channel in noise; the wasmedge
 * `[info]` lines and the clang warning block are excluded for the same reason —
 * they come from tools that report their own failures through the exit code.
 */
const LOOKS_LIKE_DIAGNOSTIC = /(?:\[Bug\]|\[WARNING\]|\[ERROR\]|^[EWF]\d{8} )/

/**
 * Diagnostic-looking lines that are known noise, each narrow on purpose.
 *
 * An over-broad entry here is how the channel dies: it would suppress the one
 * message it exists to show and nothing would say so. `/^\s/` was tried and removed
 * — it dropped `  what():  [ERROR] entry_function is not found.`, which is a real
 * fatal message that happens to be indented by libstdc++.
 */
const IGNORABLE = [
  /^\[INFO\]/,
  /^\[\d{4}-\d{2}-\d{2} [\d:.]+\] \[(?:info|debug)\]/,
  // A clang diagnostic, identified by its own `-Wflag` suffix. clang reports its
  // failures through the exit code, so its warnings are not this scanner's business.
  /\[-W[a-z0-9-]+\]$/,
  /^\d+ warnings? generated\.$/,
]

const hex = (text: string): number => Number.parseInt(text, 16)

function parseLine(line: string, stream: OutputStream): LiftFinding | undefined {
  const noSemantics = NO_SEMANTICS.exec(line)
  if (noSemantics?.[1] !== undefined && noSemantics[2] !== undefined) {
    return {
      kind: 'no-semantics',
      address: BigInt(`0x${noSemantics[1]}`),
      instructionForm: noSemantics[2],
      stream,
      raw: line,
    }
  }

  const decode = DECODE_FAILED.exec(line)
  if (decode?.[1] !== undefined && decode[2] !== undefined) {
    return {
      kind: 'decode-failed',
      address: BigInt(`0x${decode[1]}`),
      instructionForm: decode[2],
      stream,
      raw: line,
    }
  }

  const extract = EXTRACT_FAILED.exec(line)
  if (extract?.[1] !== undefined && extract[2] !== undefined) {
    return {
      kind: 'extract-failed',
      address: BigInt(`0x${extract[1]}`),
      byteLength: Number.parseInt(extract[2], 10),
      stream,
      raw: line,
    }
  }

  const sysreg = UNKNOWN_SYSTEM_REGISTER.exec(line)
  if (
    sysreg?.[1] !== undefined &&
    sysreg[2] !== undefined &&
    sysreg[3] !== undefined &&
    sysreg[4] !== undefined &&
    sysreg[5] !== undefined &&
    sysreg[6] !== undefined
  ) {
    return {
      kind: 'unknown-system-register',
      encoding: hex(sysreg[1]),
      op0: hex(sysreg[2]),
      op1: hex(sysreg[3]),
      crn: hex(sysreg[4]),
      crm: hex(sysreg[5]),
      op2: hex(sysreg[6]),
      stream,
      raw: line,
    }
  }

  return undefined
}

/**
 * Every finding in one stream, plus every diagnostic-looking line that did not parse.
 *
 * Order is preserved: a build log reads top to bottom, and re-sorting would separate
 * a finding from the `INFO` line that says which phase it happened in.
 */
export function scanStream(text: string, stream: OutputStream): ToolchainScan {
  const findings: LiftFinding[] = []
  const unparsed: UnparsedDiagnostic[] = []
  const lines = text.split('\n')

  for (const rawLine of lines) {
    // Trimmed at both ends: libstdc++ indents `what():` by two spaces, and the
    // parsers are anchored with `^`.
    const line = stripAnsi(rawLine).trim()
    if (line === '') continue
    const finding = parseLine(line, stream)
    if (finding !== undefined) {
      findings.push(finding)
      continue
    }
    if (!LOOKS_LIKE_DIAGNOSTIC.test(line)) continue
    if (IGNORABLE.some((pattern) => pattern.test(line))) continue
    unparsed.push({ stream, text: line })
  }

  return { findings, unparsed, linesRead: lines.length }
}

/** Both streams, in the order a reader would put them: stdout then stderr. */
export function scanToolchainOutput(stdout: string, stderr: string): ToolchainScan {
  const out = scanStream(stdout, 'stdout')
  const err = scanStream(stderr, 'stderr')
  return {
    findings: [...out.findings, ...err.findings],
    unparsed: [...out.unparsed, ...err.unparsed],
    linesRead: out.linesRead + err.linesRead,
  }
}

const hex08 = (value: bigint): string => `0x${value.toString(16).padStart(8, '0')}`

/**
 * A system-register sub-field, spelled the way remill spelled it.
 *
 * `Arch.cpp:4196` prints these with `%x` — bare lowercase hex, no `0x`, no padding —
 * and they were parsed with `parseInt(…, 16)` and then rendered with the default
 * `${}` conversion, i.e. in decimal. So the captured line
 *
 *     Unrecognized system register c684 with op0=3, op1=0, crn=d, crm=0, op2=4
 *
 * was reported as `crn=13`, which cannot be grepped back to the message it came from
 * and, worse, is a legal hex spelling of a *different* field value. Two of the three
 * registers in the fixture happen to have every sub-field below ten, so the two
 * renderings agree on them and only the third one — `crn=d` — shows the divergence.
 * A build log is read by pasting a number into a search box; a number that has been
 * silently re-based defeats that.
 */
const hexField = (value: number): string => value.toString(16)

/** One line per finding, fit to print in a build log. */
export function describeFinding(finding: LiftFinding): string {
  switch (finding.kind) {
    case 'no-semantics':
      return (
        `${hex08(finding.address)} ${finding.instructionForm} — decoded, but remill has no ` +
        'semantics for this form; the artifact aborts if this address is reached'
      )
    case 'decode-failed':
      return (
        `${hex08(finding.address)} ${finding.instructionForm} — operands would not decode; ` +
        'not translated'
      )
    case 'extract-failed':
      return (
        `${hex08(finding.address)} — ${finding.byteLength} bytes would not extract to any ` +
        'instruction form; not translated'
      )
    case 'unknown-system-register':
      // The tuple is reproduced with the toolchain's own separators as well as its
      // own base, so the whole `op0=…, …, op2=…` substring greps straight back to the
      // `Arch.cpp:4196` line in the raw build output.
      return (
        `system register 0x${finding.encoding.toString(16)} ` +
        `(op0=${hexField(finding.op0)}, op1=${hexField(finding.op1)}, ` +
        `crn=${hexField(finding.crn)}, crm=${hexField(finding.crm)}, ` +
        `op2=${hexField(finding.op2)}) is not modelled; ` +
        'the instruction naming it was not translated'
      )
  }
}
