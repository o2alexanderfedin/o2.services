import { spawnSync } from 'node:child_process'
import { mkdtempSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  classifyEntry,
  describeArgFailure,
  describeEntryVerdict,
  parseAotArgs,
  type EntryVerdict,
} from './cli.ts'

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

  it('runs when reached through a symlink that spells the same file differently', () => {
    // The case `realpathSync` was introduced for, and the one that makes the guard
    // more than a string compare. Through the link `argv[1]` is the link's own path,
    // which is not `import.meta.url` — node resolves symlinks when it loads, so the
    // module's URL is the real path. Exit 1 with usage is `main()` having run.
    const dir = mkdtempSync(join(tmpdir(), 'o2-cli-link-'))
    const link = join(dir, 'o2-lift')
    symlinkSync(CLI, link)
    const run = spawnSync(process.execPath, ['--experimental-strip-types', link], {
      encoding: 'utf8',
    })
    expect(run.status).toBe(1)
    expect(run.stderr).toContain('usage: npm run aot:lift --')
  })
})

/**
 * The guard's third answer, which used to be spelled as its second.
 *
 * `invokedAsCommand` was `try { … } catch { return false }`, and `false` means "this
 * file was imported, do nothing" — so every way `realpathSync` can fail produced a
 * process that ran, printed nothing, and exited 0. That is the outcome `cli.ts`'s own
 * docblock calls the worst available, produced by the guard written to prevent it.
 *
 * `classifyEntry` takes its `realpath` as a parameter because this arm cannot be
 * provoked from a real filesystem *here*: node had to resolve `argv[1]` to load
 * anything at all, so by the time the check runs the path has already resolved once.
 * The conditions the finding names — a dangling `node_modules/.bin` entry, `ELOOP`,
 * `EACCES` or `ENOTDIR` on a component, a cwd unlinked under a relative `argv[1]` —
 * all arrive between those two moments. Injecting the throw is what makes the arm
 * reachable at all, and an arm no test can reach is an arm no test can show still
 * fires.
 */
describe('a guard that cannot tell does not answer "no"', () => {
  const MODULE_URL = new URL('./cli.ts', import.meta.url).href
  const CLI = fileURLToPath(new URL('./cli.ts', import.meta.url))

  const throwing = (code: string) => (): string => {
    const error: NodeJS.ErrnoException = new Error(`ENOENT: no such file or directory, ${code}`)
    error.code = code
    throw error
  }

  it('reports undecidable, not another-module, when the path cannot be resolved', () => {
    // The reddening assertion. Against the old guard this whole arm did not exist and
    // the answer was `false`, which the entry point read as "stay inert" and exited 0.
    const verdict = classifyEntry('/some/dangling/link', MODULE_URL, throwing('ENOENT'))
    expect(verdict.kind).toBe('undecidable')
  })

  it('carries the reason the comparison failed rather than only that it did', () => {
    const verdict = classifyEntry('/some/dangling/link', MODULE_URL, throwing('ELOOP'))
    expect(verdict.kind === 'undecidable' && verdict.detail).toContain('ELOOP')
    expect(verdict.kind === 'undecidable' && verdict.entry).toBe('/some/dangling/link')
  })

  it('says it lifted nothing, and does not say the file was imported', () => {
    // Refusal *text*, not merely kind. The defect was a reader being told nothing at
    // all; being told the wrong thing — that this was an ordinary import — would be
    // the same defect wearing a message.
    const text = describeEntryVerdict(
      classifyEntry('/some/dangling/link', MODULE_URL, throwing('ENOENT')),
    )
    expect(text).toContain('could not establish')
    expect(text).toContain('/some/dangling/link')
    expect(text).not.toContain('did nothing')
    expect(text).toMatch(/nothing was lifted/)
  })

  it('never reaches realpath when argv[1] already spells this module', () => {
    // The syscall that can fail is not on the path that does not need it. A throwing
    // `realpath` here would fail this case if the order were reversed.
    const verdict = classifyEntry(CLI, MODULE_URL, throwing('EACCES'))
    expect(verdict.kind).toBe('this-module')
  })

  it('still resolves a symlink through realpath when the spelling differs', () => {
    const dir = mkdtempSync(join(tmpdir(), 'o2-cli-link-'))
    const link = join(dir, 'o2-lift')
    symlinkSync(CLI, link)
    expect(classifyEntry(link, MODULE_URL).kind).toBe('this-module')
  })

  it('is inert for a file that genuinely is something else', () => {
    // The `false` that must survive: importing this module has to stay a no-op, and
    // `another-module` is the only answer that keeps it one.
    const verdict = classifyEntry('/usr/bin/node', MODULE_URL, (path) => path)
    expect(verdict.kind).toBe('another-module')
  })

  it('treats a process with no entry script as an import, not as a failure', () => {
    expect(classifyEntry(undefined, MODULE_URL).kind).toBe('no-entry')
  })

  it('says something different for each of the four answers', () => {
    const every: readonly EntryVerdict[] = [
      { kind: 'this-module' },
      { kind: 'another-module', entry: '/x' },
      { kind: 'no-entry' },
      { kind: 'undecidable', entry: '/x', detail: 'ELOOP' },
    ]
    const said = every.map(describeEntryVerdict)
    expect(new Set(said).size).toBe(4)
    for (const line of said) {
      expect(line.length).toBeGreaterThan(10)
      expect(line).not.toContain('[object')
    }
  })

  it('resolves this very module through the same comparison the program uses', () => {
    // Anti-vacuity: every assertion above would also pass against a `classifyEntry`
    // that never matched anything, since the entry point only *runs* on `this-module`.
    expect(classifyEntry(fileURLToPath(MODULE_URL), MODULE_URL).kind).toBe('this-module')
    expect(pathToFileURL(CLI).href).toBe(MODULE_URL)
  })
})
