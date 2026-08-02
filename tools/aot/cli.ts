/**
 * The command a person types to lift one binary.
 *
 * Thin by intent: the work lives in `lift.ts`, `scan.ts` and `features.ts`, and this
 * reads argv, prints, and picks an exit code.
 *
 * Run with:  npm run aot:lift -- path/to/binary [--out artifact.wasm]
 *
 * ## Why the argument parser is a function that returns a value
 *
 * "Thin" was previously read as "too small to be wrong", and the invocation on the
 * line above did not work. Stripping `--out` from the positional arguments was
 * written as
 *
 *     argv.filter((arg, index) => index !== outAt && index !== outAt + 1)
 *
 * which is only correct while `--out` is present. Without it `outAt` is `-1`, so the
 * second clause reads `index !== 0` and eats the *first positional argument*.
 * `npm run aot:lift -- ./hello` therefore printed usage and exited 1, and the
 * `` out ?? `${input}.wasm` `` default underneath was unreachable code that had never
 * once run.
 *
 * What kept it alive was structural rather than careless. The parsing was welded to
 * `process.argv` at one end and to a `process.exit` at the other, so the only way to
 * exercise it was to spawn a process — and nothing did, because the file was the part
 * of the tool declared not to need a test. So {@link parseAotArgs} is now a pure
 * function from an argv array to an {@link AotArgs} result, and turning a failure into
 * usage text and an exit code is `main`'s job. The one thing here with logic is the
 * one thing here with a test, and the defaulted output path is inside the tested
 * function rather than downstream of it.
 *
 * ## The exit code says what the verdict says
 *
 * `0` clean, `2` translated with reservations, `1` failed. `2` rather than `0`
 * because a build script that only checks for zero would otherwise treat "translated,
 * but 174 addresses will abort if reached" as success — which is the exact mistake
 * this whole driver exists to stop elfconv making. The reservations are printed
 * either way, and on this image a glibc-static input always lands on `2`.
 *
 * ## Why the entry point is guarded
 *
 * `main()` ran at module scope, which is right for a script and wrong for a script
 * that also exports something: importing this file to test the parser would have run
 * a real container lift against the test runner's own argv. The guard below compares
 * `argv[1]` to this module, so importing is inert and invoking is not.
 *
 * That comparison can also *fail*, which is a third answer and used to be spelled as
 * the second one — see {@link EntryVerdict}. A guard that answers "no" when it means
 * "I could not tell" is how this file produced the exit code its own paragraph above
 * calls the worst available.
 *
 * Node-only.
 */

import { realpathSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { describeLift, describeLiftFailure, liftElf } from './lift.ts'

const EXIT_CLEAN = 0
const EXIT_FAILED = 1
const EXIT_RESERVATIONS = 2

const USAGE = 'usage: npm run aot:lift -- <path-to-aarch64-static-elf> [--out <artifact.wasm>]'

/**
 * Why the arguments could not be used.
 *
 * Named, not merely counted, for the same reason `LiftFailure` is: all three end in
 * the same usage text and the same exit code, so a caller that only saw "usage error"
 * could not tell a forgotten path from a `--out` with nothing after it. The name is
 * what lets a test pin the *reason* rather than the exit code, and the exit code is
 * the part that could not distinguish anything.
 */
export type ArgFailure =
  | { readonly kind: 'no-input' }
  | { readonly kind: 'missing-out-value' }
  | { readonly kind: 'flag-in-input-position'; readonly argument: string }

/**
 * A usable invocation, or the reason there isn't one.
 *
 * `out` is a resolved path and never `undefined` — see the module comment. A caller
 * that had to apply the default itself is a caller that could skip it.
 */
export type AotArgs =
  | { readonly ok: true; readonly input: string; readonly out: string }
  | { readonly ok: false; readonly failure: ArgFailure }

export function describeArgFailure(failure: ArgFailure): string {
  switch (failure.kind) {
    case 'no-input':
      return 'no input binary given — there is nothing to lift'
    case 'missing-out-value':
      return '--out was given with no path after it'
    case 'flag-in-input-position':
      return `${failure.argument} is not a path — the input binary comes first, or after --out <path>`
  }
}

/**
 * `process.argv.slice(2)` into an input path and an output path.
 *
 * `--out` may appear on either side of the positional argument, which is the whole
 * reason this is index arithmetic rather than a simple `argv[0]`. Extra positionals
 * are ignored rather than rejected: that was the previous behaviour, one binary per
 * run is the only shape the container driver supports, and turning a tolerated
 * argument into a hard failure is not a bug fix.
 *
 * Refuses rather than exits. A parser that calls `process.exit` cannot be asked what
 * it would have decided, and that is precisely how the `-1` bug above stayed invisible
 * through the tool's whole existence.
 */
export function parseAotArgs(argv: readonly string[]): AotArgs {
  const outAt = argv.indexOf('--out')
  const out = outAt === -1 ? undefined : argv[outAt + 1]
  if (outAt !== -1 && out === undefined) {
    return { ok: false, failure: { kind: 'missing-out-value' } }
  }

  // The `outAt === -1` guard is load-bearing. Without it the remaining clauses read
  // `index !== -1 && index !== 0` whenever `--out` is absent, which is true of every
  // index except the first — silently discarding the only argument there was.
  const positional = argv.filter(
    (_, index) => outAt === -1 || (index !== outAt && index !== outAt + 1),
  )

  const input = positional[0]
  if (input === undefined) return { ok: false, failure: { kind: 'no-input' } }
  if (input.startsWith('-')) {
    return { ok: false, failure: { kind: 'flag-in-input-position', argument: input } }
  }

  return { ok: true, input, out: out ?? `${input}.wasm` }
}

async function main(argv: readonly string[]): Promise<number> {
  const args = parseAotArgs(argv)
  if (!args.ok) {
    process.stderr.write(`${describeArgFailure(args.failure)}\n${USAGE}\n`)
    return EXIT_FAILED
  }

  const outcome = await liftElf(args.input, {
    onProgress: (note) => process.stderr.write(`  ${note}\n`),
  })

  if (!outcome.ok) {
    process.stderr.write(`${describeLiftFailure(outcome.failure)}\n`)
    if (outcome.failure.kind === 'toolchain-failed') {
      process.stderr.write(outcome.failure.stderr)
    }
    return EXIT_FAILED
  }

  await writeFile(args.out, outcome.artifact.bytes)
  process.stdout.write(`${describeLift(outcome.artifact)}\n`)
  process.stdout.write(`  written to ${args.out}\n`)

  return outcome.verdict === 'clean' ? EXIT_CLEAN : EXIT_RESERVATIONS
}

/**
 * Which file this process was actually asked to run.
 *
 * Four answers rather than a boolean, and the fourth is the whole point. The guard
 * was written as `try { … } catch { return false }`, and `false` is the answer that
 * means "do nothing" — so every way `realpathSync` can fail (a dangling symlink in
 * `node_modules/.bin`, `ELOOP`, `EACCES` or `ENOTDIR` on a path component, a cwd
 * unlinked under a relative `argv[1]`) produced exactly the outcome the docblock
 * below already named as the worst available: the command runs, prints nothing, and
 * exits 0. The tool whose entire reason for existing is that *elfconv's* exit code
 * cannot be trusted was emitting an untrustworthy one of its own.
 *
 * `undecidable` is not `another-module`. "I compared them and they differ" and "I
 * could not compare them" are different statements, and only the first justifies
 * silence.
 */
export type EntryVerdict =
  /** `argv[1]` names this file, so `main()` is the program. */
  | { readonly kind: 'this-module' }
  /** `argv[1]` names something else — this file was imported, and must stay inert. */
  | { readonly kind: 'another-module'; readonly entry: string }
  /** No `argv[1]` at all: `node -e`, the REPL, an embedder. Genuinely not a command. */
  | { readonly kind: 'no-entry' }
  /** The comparison could not be made. See {@link EntryVerdict}. */
  | { readonly kind: 'undecidable'; readonly entry: string; readonly detail: string }

export function describeEntryVerdict(verdict: EntryVerdict): string {
  switch (verdict.kind) {
    case 'this-module':
      return 'this file is the program'
    case 'another-module':
      return `this file was imported by ${verdict.entry}, so it did nothing`
    case 'no-entry':
      return 'there is no entry script, so this file was imported rather than run'
    case 'undecidable':
      return (
        `could not establish whether ${verdict.entry} is this file (${verdict.detail}), so ` +
        'nothing was lifted and this is not a success — re-run with a path that resolves'
      )
  }
}

/** `null` rather than a throw, so an unrepresentable path is a comparison that failed. */
function hrefOf(path: string): string | null {
  try {
    return pathToFileURL(path).href
  } catch {
    return null
  }
}

/**
 * `argv[1]` against this module's URL, without letting a failed syscall mean "no".
 *
 * The unresolved comparison runs *first* and is decisive on a match: `import.meta.url`
 * is already fully resolved, so `argv[1]` spelling it exactly settles the question with
 * no syscall at all. `realpathSync` is only needed for the case it was introduced for —
 * a launcher reached through a symlinked `node_modules/.bin` entry, whose `argv[1]`
 * spells the same file differently — and when it throws, the answer is that there is no
 * answer.
 *
 * `realpath` is a parameter because the arm that matters cannot be provoked from a
 * real filesystem here: node had to resolve `argv[1]` to load anything at all, so a
 * path that fails this call is one that succeeded moments earlier. An arm nothing can
 * call directly is an arm no test can show still fires — the reason `lift.ts` exports
 * `classifySpawnFailure`.
 */
export function classifyEntry(
  entry: string | undefined,
  moduleUrl: string,
  realpath: (path: string) => string = realpathSync,
): EntryVerdict {
  if (entry === undefined) return { kind: 'no-entry' }
  if (hrefOf(entry) === moduleUrl) return { kind: 'this-module' }

  let resolved: string
  try {
    resolved = realpath(entry)
  } catch (cause) {
    return {
      kind: 'undecidable',
      entry,
      detail: cause instanceof Error ? cause.message : String(cause),
    }
  }

  const resolvedHref = hrefOf(resolved)
  if (resolvedHref === null) {
    return { kind: 'undecidable', entry, detail: `${resolved} is not expressible as a file URL` }
  }
  return resolvedHref === moduleUrl ? { kind: 'this-module' } : { kind: 'another-module', entry }
}

const invocation = classifyEntry(process.argv[1], import.meta.url)
if (invocation.kind === 'this-module') {
  process.exitCode = await main(process.argv.slice(2))
} else if (invocation.kind === 'undecidable') {
  // Reported and failed, never run. Running `main()` on a maybe would lift a container
  // as a side effect of an `import`, which is worse than the defect being fixed; exiting
  // 0 having established nothing is the defect being fixed. Refusing is the only arm
  // left, and it is the one that makes the exit code follow the measurement.
  process.stderr.write(`${describeEntryVerdict(invocation)}\n`)
  process.exitCode = EXIT_FAILED
}
