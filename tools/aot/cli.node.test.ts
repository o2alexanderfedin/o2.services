import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { describeArgFailure, parseAotArgs } from './cli.ts'

/**
 * The invocation in the README has to be the invocation that works.
 *
 * `npm run aot:lift -- ./hello` — the documented one, the one with no `--out` —
 * printed usage and exited 1 for the whole life of the tool, because the filter that
 * strips `--out` and its value from the positional arguments used `indexOf`'s `-1`
 * sentinel as if it were an index and dropped `argv[0]` whenever `--out` was absent.
 * The default output path underneath it had never executed.
 *
 * Nothing caught it because there was nothing to catch it with: parsing read
 * `process.argv` directly and answered by calling `process.exit`, so the only probe
 * available was a subprocess. {@link parseAotArgs} returns a value now, and these are
 * the six invocations it has to get right.
 *
 * ## Two halves of the entry guard
 *
 * `cli.ts` both exports the parser and *is* a program, so it only runs `main()` when
 * `argv[1]` is itself. The negative half of that guard is asserted by this file
 * existing: were it removed, importing `./cli.ts` on the line above would run a real
 * container lift against vitest's own argv, and no test below would get the chance to
 * run. The positive half — that the guard still fires when the file is genuinely the
 * program — needs a subprocess, and gets one at the bottom.
 */

describe('the input binary is found wherever --out is not', () => {
  it('defaults the output path to the input path plus .wasm when --out is absent', () => {
    // The regression. `['./hello']` produced no input at all, so this default was
    // unreachable code.
    expect(parseAotArgs(['./hello'])).toEqual({
      ok: true,
      input: './hello',
      out: './hello.wasm',
    })
  })

  it('takes the output path from --out when it follows the input', () => {
    expect(parseAotArgs(['./hello', '--out', 'artifact.wasm'])).toEqual({
      ok: true,
      input: './hello',
      out: 'artifact.wasm',
    })
  })

  it('takes the output path from --out when it precedes the input', () => {
    // The one arrangement the broken filter handled correctly, kept because it is
    // the arrangement that made the bug look impossible.
    expect(parseAotArgs(['--out', 'artifact.wasm', './hello'])).toEqual({
      ok: true,
      input: './hello',
      out: 'artifact.wasm',
    })
  })

  it('does not treat the value of --out as the input binary', () => {
    // The failure this pins is silent rather than loud: lifting `artifact.wasm`
    // instead of `./hello` would run, and would produce a wrong artifact.
    const args = parseAotArgs(['--out', 'artifact.wasm', './hello'])
    expect(args.ok && args.input).toBe('./hello')
  })
})

describe('an unusable command line is refused by name rather than by exit code', () => {
  it('reports no input when there are no arguments at all', () => {
    expect(parseAotArgs([])).toEqual({ ok: false, failure: { kind: 'no-input' } })
  })

  it('reports no input when --out consumed the only two arguments', () => {
    expect(parseAotArgs(['--out', 'artifact.wasm'])).toEqual({
      ok: false,
      failure: { kind: 'no-input' },
    })
  })

  it('reports a missing value when --out is the last argument', () => {
    expect(parseAotArgs(['./hello', '--out'])).toEqual({
      ok: false,
      failure: { kind: 'missing-out-value' },
    })
  })

  it('refuses a flag standing where the input binary should be', () => {
    // Accepting it would hand `--verbose` to the container as a path, and the error
    // would arrive minutes later wearing docker's face rather than this tool's.
    expect(parseAotArgs(['--verbose', './hello'])).toEqual({
      ok: false,
      failure: { kind: 'flag-in-input-position', argument: '--verbose' },
    })
  })

  it('says something different for each of the three ways it can refuse', () => {
    // A distinctness check rather than a prose check: the point of naming the
    // failures is that a reader can tell them apart, and three identical strings
    // would satisfy every assertion above.
    const said = [
      describeArgFailure({ kind: 'no-input' }),
      describeArgFailure({ kind: 'missing-out-value' }),
      describeArgFailure({ kind: 'flag-in-input-position', argument: '--verbose' }),
    ]
    expect(new Set(said).size).toBe(3)
    expect(said.every((line) => line.trim() !== '')).toBe(true)
  })
})

describe('the file is a program as well as a module', () => {
  const CLI = fileURLToPath(new URL('./cli.ts', import.meta.url))

  it('prints usage and exits 1 when it is run with no arguments', () => {
    // Anti-vacuity for the entry guard. Every assertion above passes just as well
    // with `main()` never wired up at all, and a lifter that exits 0 having done
    // nothing is the worst outcome available. No container is reached: an unusable
    // command line is refused before `liftElf` is called.
    const run = spawnSync(process.execPath, ['--experimental-strip-types', CLI], {
      encoding: 'utf8',
    })
    expect(run.status).toBe(1)
    expect(run.stderr).toContain('usage: npm run aot:lift --')
  })
})
