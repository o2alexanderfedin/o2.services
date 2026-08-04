import { execFileSync, spawnSync } from 'node:child_process'
import type { SpawnSyncReturns } from 'node:child_process'
import { mkdtempSync, readFileSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { sha256 } from '@o2/core'
import { describeKeyFailure, translationCid } from '@o2/aot'
import type { TranslationKey } from '@o2/aot'
import { blockCid } from '@o2/net'
import {
  classifyEntry,
  describeArgFailure,
  describeEntryVerdict,
  parseAotArgs,
  type EntryVerdict,
} from './cli.ts'
import { ELFCONV_IMAGE_TAG, LIFT_TARGET, readTargetFeatures } from './lift.ts'
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

  it('carries neither an image nor a docker when neither flag was given', () => {
    // The regression the module comment is about, re-asserted after the parser was
    // rewritten around a consumed-index set. `toEqual` ignores an explicitly
    // `undefined` property, so this is checked by key rather than by value below.
    const args = parseAotArgs(['./hello'])
    expect(args).toEqual({ ok: true, input: './hello', out: './hello.wasm' })
    // An absent flag must leave the property *absent*, not present and `undefined`:
    // `main` spreads these into `LiftOptions`, and under `exactOptionalPropertyTypes`
    // an explicit `undefined` is a different value from an omitted key.
    expect(args.ok && Object.hasOwn(args, 'image')).toBe(false)
    expect(args.ok && Object.hasOwn(args, 'docker')).toBe(false)
  })

  it('takes an image from --image standing before the positional argument', () => {
    // The arrangement that made the original `-1` defect look impossible, applied to
    // the flag this plan adds: a value-flag first, the input second.
    expect(parseAotArgs(['--image', 'o2-local/elfconv:borrowed', './hello'])).toEqual({
      ok: true,
      input: './hello',
      out: './hello.wasm',
      image: 'o2-local/elfconv:borrowed',
    })
  })

  it('reads three value-flags in one invocation without losing the input', () => {
    // No arrangement of the old index arithmetic handled this: it looked for one flag
    // by `indexOf` and filtered two indices. Three flags is where a second sentinel
    // would have had to be invented.
    expect(
      parseAotArgs(['./hello', '--docker', '/tmp/stub/docker', '--out', 'a.wasm', '--image', 'x']),
    ).toEqual({
      ok: true,
      input: './hello',
      out: 'a.wasm',
      docker: '/tmp/stub/docker',
      image: 'x',
    })
  })

  it('takes the argument after a value-flag as its value, even when that looks like a flag', () => {
    // `--out --image ./hello` is a user error either way, and what it must not do is
    // mean two things at once. The old `argv[outAt + 1]` took the next argument
    // whatever it was; the pass that replaced it steps over the value it consumed, so
    // `--image` here is a path and not a second flag. Asserted because the alternative
    // — re-reading a consumed argument — is silent: it would consume `./hello` as
    // `--image`'s value and report no input at all.
    expect(parseAotArgs(['--out', '--image', './hello'])).toEqual({
      ok: true,
      input: './hello',
      out: '--image',
    })
  })

  it('can be pointed at a docker that is not Docker', () => {
    // The half of the refusal proof that lives in the parser. The other half is the
    // subprocess at the bottom of this file: were `main` to stop forwarding this, the
    // spawned CLI would reach the real `docker` and the exit code would change.
    expect(parseAotArgs(['./hello', '--docker', '/tmp/x/docker'])).toEqual({
      ok: true,
      input: './hello',
      out: './hello.wasm',
      docker: '/tmp/x/docker',
    })
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
    // Edited by the failure rename, not by a behaviour change: the invocation and its
    // verdict are what they were, and the failure now says *which* flag rather than
    // there being one failure kind per flag. The old kind's name is deliberately not
    // written here — a grep for it across `tools/aot/` is what shows the rename reached
    // every site, and a comment quoting it would read as a site that was missed.
    expect(parseAotArgs(['./hello', '--out'])).toEqual({
      ok: false,
      failure: { kind: 'missing-flag-value', flag: '--out' },
    })
  })

  it('refuses a value-less --image and a value-less --docker by name', () => {
    // One failure kind carrying the flag, rather than three near-identical kinds.
    // Three names that mean the same thing is how a reader stops being able to tell
    // them apart, which is the property the `ArgFailure` doc says naming exists for.
    expect(parseAotArgs(['./hello', '--image'])).toEqual({
      ok: false,
      failure: { kind: 'missing-flag-value', flag: '--image' },
    })
    expect(parseAotArgs(['./hello', '--docker'])).toEqual({
      ok: false,
      failure: { kind: 'missing-flag-value', flag: '--docker' },
    })
  })

  it('reports no input when --image consumed the only two arguments', () => {
    // The flag and its value are consumed, leaving no positional — exactly what
    // `['--out', 'artifact.wasm']` does above. A parser that consumed only the flag
    // would report the *value* as the input binary and lift `x`.
    expect(parseAotArgs(['--image', 'x'])).toEqual({
      ok: false,
      failure: { kind: 'no-input' },
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
      describeArgFailure({ kind: 'missing-flag-value', flag: '--out' }),
      describeArgFailure({ kind: 'flag-in-input-position', argument: '--verbose' }),
    ]
    expect(new Set(said).size).toBe(3)
    expect(said.every((line) => line.trim() !== '')).toBe(true)
  })

  it('names the flag whose value was missing, rather than naming --out for all three', () => {
    // What the rename is for. One kind now covers three flags, so a sentence that
    // still said `--out` would send a reader to the argument they got right.
    expect(describeArgFailure({ kind: 'missing-flag-value', flag: '--image' })).toContain('--image')
    expect(describeArgFailure({ kind: 'missing-flag-value', flag: '--docker' })).toContain(
      '--docker',
    )
    expect(describeArgFailure({ kind: 'missing-flag-value', flag: '--image' })).not.toContain(
      '--out',
    )
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
    // The two flags a person has to be told about to reach the image refusal from a
    // command line at all. A flag the parser accepts and the usage line hides is a
    // flag only whoever wrote it knows exists.
    expect(run.stderr).toContain('--image')
    expect(run.stderr).toContain('--docker')
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

// ---------------------------------------------------------------------------
// The two halves of AOT-02's criterion, driven through the program a person runs
// ---------------------------------------------------------------------------

/** The labels `describeLift` puts the two CIDs behind. Written down twice on purpose. */
const KEY_CID_LABEL = 'translation key cid: '
const ARTIFACT_CID_LABEL = 'artifact cid: '

/**
 * The CID on the line carrying `label`, or `undefined` if there is no such line.
 *
 * **Off its label, never off the whole of stdout.** Both CIDs the CLI prints are
 * CIDv1/dag-cbor/sha-256, so both render `bafyrei…` and a `/bafy[a-z0-9]+/` match cannot
 * tell them apart — it passes just as well with the two swapped, which is precisely the
 * mutation this phase plants. A shape match here would not be a measurement.
 *
 * The labels live in this file rather than in `stubs.ts` because the labels are what is
 * under test: `describeLift` writing them and this file reading them is the agreement,
 * and an agreement stated once in a shared constant is an agreement nothing checks.
 */
function cidOnLine(stdout: string, label: string): string | undefined {
  const line = stdout.split('\n').find((text) => text.trim().startsWith(label))
  return line === undefined ? undefined : line.trim().slice(label.length).trim()
}

/** Hex of a multihash's bytes, the spelling `liftElf` writes into `inputDigest`. */
function toHex(bytes: Uint8Array): string {
  let out = ''
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0')
  return out
}

/**
 * The five `meta.txt` versions this file hands the stub, so it can recompute the key.
 *
 * Written down here rather than imported: `stubs.ts` keeps its defaults module-private,
 * and a test that recomputed an expected CID from a constant it could not see would be
 * asserting that two copies of one value agree. These are passed *in*, so the expected
 * key is built from what this file gave the container and not from what the container
 * happens to default to.
 *
 * None of them is blank and none of them is the literal `unknown`: a blank one is
 * refused as `blank-version` and would make the emission case assert a failure path by
 * accident.
 */
const STUB_TOOLCHAIN: Readonly<Record<string, string>> = {
  clang: 'Debian clang version 16.0.6 (++20230710042027+7cbf1a259152)',
  'wasi-sdk': 'wasi-sdk-20.0',
  wasmedge: 'wasmedge version 0.13.5',
  'elfconv-commit': 'f4c1d2ab9e7350b6c8d4e1f209a3b5c7d8e9f012',
  'elflift-sha256': '9f8e7d6c5b4a39281706f5e4d3c2b1a09876543210fedcba9876543210fedcba',
}

/**
 * Whether this host has the toolchain image, by the same probe `lift.node.test.ts` uses.
 *
 * Copied and not imported. The two files gate on the same fact and must be able to
 * disagree about it — a shared gate is one place for "the image is here" to become
 * wrong for both.
 */
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

/**
 * A borrowed name, and a name the operator is shown — through the real program.
 *
 * Everything above this line is a function called in-process. Both halves of AOT-02's
 * second criterion are about *the command a person types*: "the CLI prints that CID to
 * the operator", and "pointing the CLI at a re-tagged image is refused". A parser spec
 * cannot reach either — `parseAotArgs` returning `{docker: '/tmp/x'}` says nothing about
 * whether `main` forwards it, and `resolveImage`'s own spec proves the refusal exists in
 * a function nobody could reach from a command line until this plan.
 *
 * ## Two budgets, and why the case timeouts are explicit
 *
 * Each case here spawns a node process that loads the whole lift module graph and then
 * spawns a stub `docker`. `liftElf` caps `docker image inspect` at `IMAGE_RESOLVE_CAP_MS`
 * (60 s) when the caller passes no `timeoutMs`, which `main` does not. Vitest's default
 * case budget is 5 s, so the framework's timer would be the first to fire and the case
 * would die with nothing to report — the same defect `lift.node.test.ts` records against
 * its own `CASE_BUDGET_MS`. The explicit budgets below are configuration, not
 * measurement: they exist so that whichever timer fires is the one that knows why.
 */
describe('the command a person types names what it produced, and refuses a borrowed name', () => {
  const CLI = fileURLToPath(new URL('./cli.ts', import.meta.url))
  const BORROWED_TAG = 'o2-local/elfconv:borrowed'
  let borrowedTagExists = false

  /** The subject: 192 bytes the pre-screen accepts. Nothing here reaches a real lifter. */
  const elfPath = writeAcceptableElf()

  const runCli = (args: readonly string[]): SpawnSyncReturns<string> =>
    spawnSync(process.execPath, ['--experimental-strip-types', CLI, ...args], {
      encoding: 'utf8',
    })

  it(
    'prints the CID it emitted, on its own labelled line, to whoever ran the command',
    async () => {
      /**
       * **The exit code is 2, and 2 is the success here.**
       *
       * `cli.ts`'s own docblock records that `0` is `clean`, `2` is translated with
       * reservations, and that a build script checking only for zero would read
       * "translated, but addresses will abort if reached" as success. A real
       * glibc-static input always lands on `2`, so a case asserting `0` on a happy path
       * would fail on a correct run.
       *
       * **A stub lift, though, is `clean` by default, and that was measured rather than
       * assumed.** `stubLift()` writes `undecoded-callsites=0` and an empty
       * `undecoded.txt`, which `readUndecoded` reads as a probe that ran and found
       * nothing — verdict `clean`, exit 0. So this case *arranges* the reservation it
       * asserts: three counted call sites with no address recovered is the
       * `counted-only` probe, which is a genuine reservation and the only one reachable
       * through this harness, since the stub always writes an empty address file. The
       * verdict is therefore the driver's own, not a number this case wrote down.
       */
      const docker = stubLift({ meta: { ...STUB_TOOLCHAIN, 'undecoded-callsites': '3' } })
      const out = join(stubDir('o2-cli-emit-'), 'artifact.wasm')

      const run = runCli([elfPath, '--docker', docker.path, '--out', out])
      expect(run.status, run.stderr).toBe(2)

      // The bytes really were written, so the CIDs below name something that exists.
      const written = new Uint8Array(readFileSync(out))
      expect([...written]).toEqual([...ACCEPTABLE_ARTIFACT])

      /**
       * The expected key, **recomputed rather than pinned.**
       *
       * A literal CID here would be a second conformance vector with none of
       * `CONFORMANCE_CID`'s documented discipline behind it, and it would have to be
       * regenerated every time a fixture value moved — which is how a vector stops
       * being checked and starts being copied out of the failure output. Every input is
       * one this case handed over or read: the ELF's own bytes, the digest the stub
       * answers `image inspect` with, the five versions in {@link STUB_TOOLCHAIN}, and
       * the feature set read out of the artifact's own `target_features` section.
       */
      const features = readTargetFeatures(ACCEPTABLE_ARTIFACT)
      expect(features.ok).toBe(true)
      if (!features.ok) return
      const digest = await sha256.digest(new Uint8Array(readFileSync(elfPath)))
      const key: TranslationKey = {
        inputDigest: toHex(digest.bytes),
        target: LIFT_TARGET,
        toolchain: { 'elfconv-image': MATCHING_DIGEST, ...STUB_TOOLCHAIN },
        features: features.features.required,
      }
      const named = await translationCid(key)
      expect(named.ok, named.ok ? '' : describeKeyFailure(named.failure)).toBe(true)
      if (!named.ok) return

      const keyLine = cidOnLine(run.stdout, KEY_CID_LABEL)
      const artifactLine = cidOnLine(run.stdout, ARTIFACT_CID_LABEL)
      expect(keyLine, `no "${KEY_CID_LABEL}" line in:\n${run.stdout}`).toBeDefined()
      expect(artifactLine, `no "${ARTIFACT_CID_LABEL}" line in:\n${run.stdout}`).toBeDefined()

      // The operator is shown the key the pipeline built, not a CID of something else.
      expect(keyLine).toBe(named.cid.toString())
      // …and the artifact line is the content hash of the file the CLI just wrote —
      // computed here from bytes read back off disk, by the same function
      // `FetchingBlockstore` verifies a fetched block with.
      expect(artifactLine).toBe((await blockCid(written)).toString())
      // …and the two are not each other. This is what kills "print the artifact CID
      // where the key CID belongs" at the CLI level; the renderer-level kill is in
      // `lift.node.test.ts`, and both are needed because `main` could print its own line.
      expect(keyLine).not.toBe(artifactLine)
    },
    180_000,
  )

  it(
    'refuses an image whose digests name another repository, and starts no container',
    () => {
      // No elfconv image required, which is the point: the refusal is measurable on a
      // host that has never pulled six gigabytes. The stub answers `image inspect` with
      // two digests from somewhere else — the shape a re-tag leaves behind.
      const docker = stubDocker(emitDigests(FOREIGN_DIGESTS))
      const out = join(stubDir('o2-cli-refuse-'), 'artifact.wasm')

      const run = runCli([elfPath, '--docker', docker.path, '--out', out])
      expect(run.status).toBe(1)
      // What was wanted and what was found, both, so the refusal can be debugged
      // without re-running docker by hand.
      expect(run.stderr).toContain('ghcr.io/yomaytk/elfconv')
      expect(run.stderr).toContain(FOREIGN_DIGESTS[0])

      // The assertion neither the exit code nor stderr can make. An exit code cannot
      // distinguish "refused before starting anything" from "started a container and
      // then failed"; the log can. One invocation, and it is the inspect.
      const log = docker.invocations()
      expect(log).toHaveLength(1)
      expect(log[0]).toContain('image inspect')
      expect(log.join('\n')).not.toContain('run ')
    },
    180_000,
  )

  it(
    'inspects the image the operator named, so --image reaches the driver at all',
    () => {
      // The forwarding proof that needs no image on the host. The stub logs its own
      // argv, so the tag typed on the command line is either in that log or `main`
      // dropped the flag — and no assertion on an exit code could tell the difference,
      // because a lift of the *default* image through this stub is refused too.
      const docker = stubDocker(emitDigests(FOREIGN_DIGESTS))
      const out = join(stubDir('o2-cli-named-'), 'artifact.wasm')

      const run = runCli([elfPath, '--image', BORROWED_TAG, '--docker', docker.path, '--out', out])
      expect(run.status).toBe(1)

      const log = docker.invocations()
      expect(log).toHaveLength(1)
      expect(log[0]).toContain(`image inspect ${BORROWED_TAG}`)
      // …and the refusal names what *this* invocation asked for, not the default tag.
      expect(run.stderr).toContain(BORROWED_TAG)
    },
    180_000,
  )

  it.skipIf(!HAVE_IMAGE)(
    'measures what `docker tag` leaves in RepoDigests, because the refusal turns on it',
    () => {
      /**
       * **This case was written to prove that a real re-tag is refused. It measured the
       * opposite, and says so rather than being deleted.**
       *
       * The plan and 21-CONTEXT.md both assume that `docker tag A B` leaves `B`'s
       * `RepoDigests` naming only `A`'s repository, so the repository match in
       * `resolveImage` fails and `image-digest-foreign` fires. That was true of the
       * classic dockerd image store and is **not** true of the containerd image store,
       * measured here on Docker Server **29.4.0** on 2026-08-04:
       *
       *     $ docker tag ghcr.io/yomaytk/elfconv:arm64 o2-local/elfconv:borrowed
       *     $ docker image inspect o2-local/elfconv:borrowed --format '{{json .RepoDigests}}'
       *     ["o2-local/elfconv@sha256:22a404f3…","ghcr.io/yomaytk/elfconv@sha256:22a404f3…"]
       *
       * The borrowed repository gets an entry of its own, carrying the same manifest
       * digest, so the repository match *succeeds* and the driver proceeds — under the
       * borrowed name. **AOT-02's "re-tagging a local image and pointing the CLI at it
       * is refused" is therefore measured and not met by this route on this host.** The
       * harm is milder than the one `lift.ts` documents — the digest is truthful, so no
       * unknown toolchain runs under a trusted name; what is recorded in the key is the
       * *local* name, which no other host can resolve — but it is not the refusal the
       * criterion asks for, and calling it one would be widening what counts as passing.
       *
       * The refusal itself is not in doubt and is proved two cases above, through the
       * program, against a digest list that really does name only other repositories.
       * What is measured here is that `docker tag` on this Docker no longer produces
       * such a list.
       *
       * **If this case ever fails, that is the good news.** It means the host's Docker
       * stopped copying the digest across, and the assertions below should become the
       * refusal ones the plan expected: exit 1, stderr naming the wanted repository and
       * the found digests.
       *
       * A skip here means this was measured on no host at all, and unmeasured is not
       * met — 21-CONTEXT.md's Risk 2 requires the phase's verification record to name
       * the host and the Docker version any of this was measured on.
       */
      execFileSync('docker', ['tag', ELFCONV_IMAGE_TAG, BORROWED_TAG], {
        stdio: ['ignore', 'ignore', 'ignore'],
        timeout: 60_000,
      })
      borrowedTagExists = true

      const digests = execFileSync(
        'docker',
        ['image', 'inspect', BORROWED_TAG, '--format', '{{join .RepoDigests "\\n"}}'],
        { encoding: 'utf8', timeout: 60_000 },
      )
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.includes('@sha256:'))

      // The half the plan assumed, and it holds: the origin's digest survives the tag.
      expect(digests.some((digest) => digest.startsWith('ghcr.io/yomaytk/elfconv@'))).toBe(true)
      // The half it did not, and this is the finding.
      expect(digests.some((digest) => digest.startsWith('o2-local/elfconv@'))).toBe(true)

      // …and the consequence, measured through the program rather than deduced from the
      // rule. `image o2-local/elfconv@sha256:` on stderr is the driver's own progress
      // line: the borrowed name resolved, was adopted as the toolchain's identity, and
      // is what would go into the translation key. That sentence *is* the criterion's
      // failure. The run then aborts inside the container on this case's 192-byte
      // subject, which is why nothing here reads the exit code — 1 would mean the
      // refusal and the abort alike, and an exit code that cannot tell two outcomes
      // apart is the thing this whole driver exists to stop trusting.
      const out = join(stubDir('o2-cli-retag-'), 'artifact.wasm')
      const run = runCli([elfPath, '--image', BORROWED_TAG, '--out', out])
      expect(run.stderr).toContain('image o2-local/elfconv@sha256:')
      expect(run.stderr).not.toContain('re-tagged image')
    },
    300_000,
  )

  afterAll(() => {
    if (borrowedTagExists) {
      execFileSync('docker', ['rmi', BORROWED_TAG], {
        stdio: ['ignore', 'ignore', 'ignore'],
        timeout: 120_000,
      })
      // `rmi` on a tag of an image that carries other tags removes the *tag*. Asserted
      // rather than trusted: cleaning up after this case must not cost the host the six
      // gigabytes every integration test in `lift.node.test.ts` is gated on.
      expect(() =>
        execFileSync('docker', ['image', 'inspect', ELFCONV_IMAGE_TAG, '--format', '{{.Id}}'], {
          stdio: ['ignore', 'ignore', 'ignore'],
          timeout: 60_000,
        }),
      ).not.toThrow()
    }
    cleanupStubs()
  })
})
