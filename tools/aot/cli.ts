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
 * True only when this file *is* the program.
 *
 * `realpathSync` on both sides because a launcher reached through a symlinked
 * `node_modules/.bin` entry gives an `argv[1]` that spells the same file differently
 * from `import.meta.url`, and the failure mode of getting that wrong is the worst
 * available: the command runs, prints nothing, and exits 0.
 */
function invokedAsCommand(): boolean {
  const entry = process.argv[1]
  if (entry === undefined) return false
  try {
    return pathToFileURL(realpathSync(entry)).href === import.meta.url
  } catch {
    return false
  }
}

if (invokedAsCommand()) process.exitCode = await main(process.argv.slice(2))
