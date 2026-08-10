import { createRequire } from 'node:module'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { build } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * Plan 28-02, obligations 2 and 5: `libsodium-wrappers` has left this repository, and
 * this file is the guard that makes its return red.
 *
 * **The correction this file owes, stated first so nothing below can be read as a
 * larger claim than it is.** The removal happened in two halves, in two plans, and only
 * the second half is this plan's.
 *
 *   - **The bundle half was Plan 28-01's**, which deleted `createLibsodiumSyncVerifier`
 *     and its lazy `import('libsodium-wrappers')` from `packages/core/src/ed25519-backend.ts`.
 *     From that commit onward a production build of the Ed25519 verification surface
 *     contained no libsodium bytes **whether or not the package was still installed**.
 *   - **The supply-chain and install-surface half is Plan 28-02's**: the entry left
 *     `packages/core/package.json`, and it and its transitive `libsodium` left
 *     `package-lock.json` and `node_modules`.
 *
 * So this file guards the state those two changes *jointly* produced. It does **not**
 * claim that 28-02's `npm install` moved 314.9 KB — or 149.4 KiB, the figure actually
 * measured here — off a page. It could not have: 28-01 had already moved those bytes.
 * Saying otherwise would be the widening-what-counts-as-passing failure CLAUDE.md
 * § Proofs names. The measured evidence for this is recorded beside
 * `VERIFIER_BUDGET_BYTES`: the verification surface's gzip delta was **28306 B before
 * the uninstall and 28306 B after it** — unchanged, because there was nothing left to
 * remove.
 *
 * **Why the assertion shape here departs from `x509-bundle.e2e.test.ts`'s.** That file
 * guards an *addition* with `expect(delta).toBeLessThanOrEqual(DECODER_BUDGET_BYTES)`
 * (`:115`, `:159`), which is the right shape for a ceiling on something being added. **A
 * ceiling alone cannot guard a removal**: a tree that never removed libsodium also
 * satisfies a generous upper bound, so the assertion would be satisfiable by doing
 * nothing at all. This file therefore asserts the absence *directly* — by name in the
 * manifest and lockfile, by a module resolution that must throw, and by a marker scan
 * over the raw built bytes — and only then adds the two size relations.
 *
 * The scratch-directory mechanism is copied verbatim from `x509-bundle.e2e.test.ts:27-35`
 * and its reasoning is load-bearing: Vite resolves bare specifiers by walking up from the
 * *importing file's own directory* looking for `node_modules`, so an entry written under
 * `os.tmpdir()` sits outside this repository's tree and would need a `resolve.alias` to
 * find `@o2/core` at all. An entry under `<repo-root>/tmp/` resolves it for free through
 * the workspace's real `node_modules/@o2/core` symlink. `tmp/` is already gitignored.
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const SCRATCH_ROOT = join(ROOT, 'tmp')

/**
 * The scratch prefix must not contain any string in `MARKERS`, and this is not
 * fastidiousness — it was measured. Rollup embeds the entry file's own absolute path in
 * a `//#region <path>` comment that **survives production minification** (the same
 * mechanism `x509-bundle.e2e.test.ts:108-113` records as the source of its 1-2 byte
 * gzip variance). Plan 28-02's throwaway measurement script used the prefix
 * `o2-libsodium-measure-` and the marker scan over a libsodium-free verifier bundle
 * consequently reported **one** hit, at offset 91361, whose 440-byte context was the
 * region comment naming the scratch directory. A workdir named after the marker makes
 * the scan find itself. Post-removal, with this prefix, the same scan reports zero.
 */
const WORKDIR_PREFIX = 'o2-dep-absence-'

let workdir: string

const BASELINE_SOURCE = `export function run(): number {\n  return 1\n}\n`

/**
 * A real, exported, awaited call through `@o2/core`'s Ed25519 verification surface —
 * not a discarded expression — so Rolldown cannot treat the import as dead and drop it.
 * The returned boolean is the function's own return value, so the call cannot be folded
 * away either. The tree-shaking sanity assertion below proves this held.
 */
const VERIFIER_SOURCE =
  `import { initEd25519, getSyncVerifier } from '@o2/core'\n` +
  `export async function run(signature: Uint8Array, message: Uint8Array, publicKey: Uint8Array): Promise<boolean> {\n` +
  `  await initEd25519()\n` +
  `  return getSyncVerifier().verify(signature, message, publicKey)\n` +
  `}\n`

/**
 * Two markers, not one. `libsodium` catches the package name, its emscripten module
 * identifiers and any `//#region node_modules/libsodium*` path comment; and
 * `crypto_sign_verify_detached` catches the specific call the deleted
 * `createLibsodiumSyncVerifier` made, which would survive even a bundle that had somehow
 * lost the package name.
 *
 * **Planted-mutation proof.** This list was temporarily replaced with `['export']` — a
 * string every ES bundle contains — and the file re-run. Observed failure, verbatim:
 *
 *   FAIL  |e2e| packages/node/src/libsodium-absence.e2e.test.ts > CRYPTO-05 — absence, in the built artifact > contains none of the libsodium markers in the built bytes of the verification surface
 *   AssertionError: expected [ 'export' ] to deeply equal []
 *
 * — which proves the scan reads the real built bytes rather than an empty string, the
 * failure mode that would make a clean result meaningless. Restored by the surgical
 * inverse of that one-line edit and `cmp`-verified byte-identical against a snapshot
 * taken immediately before the plant.
 */
const MARKERS = ['libsodium', 'crypto_sign_verify_detached'] as const

/**
 * The bare specifier that must no longer resolve from this repository.
 *
 * **Planted-mutation proof.** Temporarily set to `'multiformats'`, a package that *is*
 * installed, and the file re-run. Observed failure, verbatim:
 *
 *   FAIL  |e2e| packages/node/src/libsodium-absence.e2e.test.ts > CRYPTO-02 — absence, resolution: gone, not merely unlisted > throws when the bare specifier is resolved from this repository
 *   AssertionError: expected [Function] to throw an error
 *
 * — which proves the assertion is a real resolution attempt against the installed tree
 * and not a `toThrow` that would pass on any specifier. Restored by the surgical inverse
 * and `cmp`-verified against a snapshot taken immediately before the plant.
 */
const ABSENT_SPECIFIER = 'libsodium-wrappers'

/** Whatever `libsodium` is now called cannot hide behind a rename: substring, not equality. */
const FORBIDDEN_SUBSTRING = 'libsodium'

interface ManifestLike {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  packages?: Record<string, unknown>
}

/**
 * The instrument. Returns every dependency name or lockfile path key that contains
 * `libsodium`; an empty array means absent.
 *
 * It is a named function rather than an inline expression so that it can be proved able
 * to say **"present"** — see the two inline fixtures below. A live reading of "absent"
 * taken by an instrument that has never been shown capable of reporting "present" is
 * not evidence of anything.
 *
 * **Planted-mutation proof, and it is the one that justifies the fixtures existing.**
 * The predicate was temporarily crippled to `name === FORBIDDEN_SUBSTRING && false`, so
 * the matcher could never report anything. Observed result: **8 of 9 cases still passed**
 * — including *both* live readings of the real manifest and the real lockfile, which
 * passed **vacuously**. Only the fixture caught it:
 *
 *   FAIL  |e2e| packages/node/src/libsodium-absence.e2e.test.ts > CRYPTO-02 — the matcher is able to report "present" > reports a libsodium dependency present in a fixture that carries one
 *   AssertionError: expected [] to deeply equal [ 'libsodium-wrappers', …(1) ]
 *
 * That is the whole argument for the fixture: without it a broken instrument reports the
 * desired answer and the suite stays green. Restored by the surgical inverse and
 * `cmp`-verified against a snapshot taken immediately before the plant.
 */
function libsodiumReferences(input: ManifestLike): string[] {
  const names = [
    ...Object.keys(input.dependencies ?? {}),
    ...Object.keys(input.devDependencies ?? {}),
    ...Object.keys(input.packages ?? {}),
  ]
  return names.filter((name) => name.includes(FORBIDDEN_SUBSTRING))
}

/** A fixture that DOES carry the dependency. The matcher must report it present. */
const FIXTURE_WITH_LIBSODIUM: ManifestLike = {
  dependencies: { '@noble/curves': '2.2.0', 'libsodium-wrappers': '0.8.4' },
  packages: { 'node_modules/libsodium': {}, 'node_modules/@noble/curves': {} },
}

/** A fixture shaped identically but without it. The matcher must report it absent. */
const FIXTURE_WITHOUT_LIBSODIUM: ManifestLike = {
  dependencies: { '@noble/curves': '2.2.0', multiformats: '14.0.5' },
  packages: { 'node_modules/@noble/curves': {}, 'node_modules/multiformats': {} },
}

interface BuildResult {
  gzipBytes: number
  text: string
}

/**
 * Build one library-mode entry and return **both** its gzip byte size and its raw output
 * text. The precedent returns gzip only; this file needs the bytes as well, and returning
 * both from one build is what makes the marker scan and the size relations readings of
 * the *same* artifact rather than of two builds that merely ought to agree.
 */
async function buildAndMeasure(name: string, source: string): Promise<BuildResult> {
  const entryDir = join(workdir, name)
  await mkdir(entryDir, { recursive: true })
  const entryPath = join(entryDir, `${name}.ts`)
  await writeFile(entryPath, source, 'utf8')

  const outDir = join(entryDir, 'out')
  await build({
    root: ROOT,
    logLevel: 'warn',
    build: {
      lib: { entry: entryPath, formats: ['es'], fileName: () => 'out.js' },
      outDir,
      emptyOutDir: true,
      // Vite's default minification under `mode: 'production'`, exactly as the `vite
      // build` CLI applies it — this measures what a real production bundle ships.
      write: true,
    },
  })

  const bytes = await readFile(join(outDir, 'out.js'))
  return { gzipBytes: gzipSync(bytes).length, text: bytes.toString('utf8') }
}

let baseline: BuildResult
let verifier: BuildResult

beforeAll(async () => {
  await mkdir(SCRATCH_ROOT, { recursive: true })
  workdir = await mkdtemp(join(SCRATCH_ROOT, WORKDIR_PREFIX))

  // Sequential, not `Promise.all` — matches the `e2e` project's own
  // `fileParallelism: false` rationale (vitest.config.ts:1291): two concurrent Vite
  // builds writing into one scratch tree is an unforced risk, and nothing here is
  // timing-sensitive. Both builds happen once, in this hook, so the marker scan and
  // both size relations read one pair of artifacts.
  baseline = await buildAndMeasure('baseline', BASELINE_SOURCE)
  verifier = await buildAndMeasure('verifier', VERIFIER_SOURCE)
}, 180_000)

afterAll(async () => {
  await rm(workdir, { recursive: true, force: true })
}, 60_000)

describe('CRYPTO-02 — the matcher is able to report "present"', () => {
  it('reports a libsodium dependency present in a fixture that carries one', () => {
    // This is the plant that never gets removed. If `libsodiumReferences` is ever
    // weakened into something that cannot say "present" — the failure mode that makes
    // every absence reading below vacuous — this case is what goes red.
    expect(libsodiumReferences(FIXTURE_WITH_LIBSODIUM).sort()).toEqual([
      'libsodium-wrappers',
      'node_modules/libsodium',
    ])
  })

  it('reports absent for a fixture shaped identically but without it', () => {
    expect(libsodiumReferences(FIXTURE_WITHOUT_LIBSODIUM)).toEqual([])
  })
})

describe('CRYPTO-02 — absence, structural: manifest and lockfile', () => {
  it('names no libsodium dependency in packages/core/package.json', async () => {
    const manifest = JSON.parse(
      await readFile(join(ROOT, 'packages/core/package.json'), 'utf8'),
    ) as ManifestLike
    expect(libsodiumReferences(manifest)).toEqual([])
  })

  it('holds no libsodium key anywhere in package-lock.json, transitive included', async () => {
    // The transitive `libsodium` is pulled in only by `libsodium-wrappers`, so both
    // leave together; a substring match over the whole `packages` map catches either.
    const lockfile = JSON.parse(
      await readFile(join(ROOT, 'package-lock.json'), 'utf8'),
    ) as ManifestLike
    expect(libsodiumReferences(lockfile)).toEqual([])
  })
})

describe('CRYPTO-02 — absence, resolution: gone, not merely unlisted', () => {
  it('throws when the bare specifier is resolved from this repository', () => {
    const require_ = createRequire(import.meta.url)
    // A manifest can omit a package that is still sitting in `node_modules` and still
    // importable. This distinguishes "unlisted" from "gone" and is the only one of the
    // three absence assertions that reads the installed tree.
    expect(() => require_.resolve(ABSENT_SPECIFIER)).toThrow(/Cannot find module/)
  })
})

describe('CRYPTO-05 — absence, in the built artifact', () => {
  it('contains none of the libsodium markers in the built bytes of the verification surface', () => {
    const found = MARKERS.filter((marker) => verifier.text.includes(marker))
    expect(found).toEqual([])
  })

  it('is a non-vacuous scan: the verifier build is strictly larger than the baseline', () => {
    // Kept as its own assertion, deliberately separate from the size relations below —
    // the same device as `x509-bundle.e2e.test.ts:95-99` and for the same reason. If the
    // `@o2/core` import were tree-shaken away entirely, the marker scan above would pass
    // over an essentially empty bundle and mean nothing at all. This is the assertion
    // that fails in that case, loudly, instead of letting a clean scan be clean for the
    // wrong reason.
    //
    // Planted-mutation proof, and it demonstrated the separation rather than merely
    // asserting it: the verifier entry was temporarily built from `BASELINE_SOURCE`, i.e.
    // with the `@o2/core` import gone entirely — the exact state a total tree-shake would
    // produce. The marker scan above **passed**, over a bundle with nothing in it. Only
    // this assertion caught it. Observed failure, verbatim:
    //
    //   FAIL  |e2e| packages/node/src/libsodium-absence.e2e.test.ts > CRYPTO-05 — absence, in the built artifact > is a non-vacuous scan: the verifier build is strictly larger than the baseline
    //   AssertionError: expected 122 to be greater than 122
    //
    // Restored by the surgical inverse and `cmp`-verified against a snapshot taken
    // immediately before the plant.
    expect(verifier.gzipBytes).toBeGreaterThan(baseline.gzipBytes)
  })
})

describe('CRYPTO-05 — the size moved down, and stays down', () => {
  it('keeps the verification surface under its sited ceiling', () => {
    const delta = verifier.gzipBytes - baseline.gzipBytes
    expect(delta).toBeLessThanOrEqual(VERIFIER_BUDGET_BYTES)
  })

  it('costs less than the dependency it dropped measured at on its own', () => {
    // The "moved down" relation obligation 5 asks for, and the one a ceiling inherited
    // from an addition guard cannot express: the *whole* verification surface now costs
    // less than the single dependency that left. Re-attaching a dependency of that scale
    // to this graph fails this and the ceiling above together.
    const delta = verifier.gzipBytes - baseline.gzipBytes
    expect(delta).toBeLessThan(LIBSODIUM_MEASURED_GZIP_BYTES)
  })
})

/**
 * The most gzip-compressed bytes `@o2/core`'s Ed25519 verification surface may add to a
 * page that imports and calls `initEd25519` + `getSyncVerifier().verify`.
 *
 * **Sited, not picked** — the convention `DECODER_BUDGET_BYTES` (`x509-bundle.e2e.test.ts:119`)
 * and `MAX_CHAIN_DEPTH` (`capability.ts:101-127`) use. Measured on this host
 * (Darwin 25.5.0 arm64, Apple M1 Pro, 8 cores), **2026-08-10**, Node v25.9.0, Vite 8.1.5
 * library mode, `es` format, default esbuild production minification, `node:zlib.gzipSync`
 * over the raw output bytes, no server compression — by the exact dual-build procedure
 * this file runs:
 *
 * | Reading | Before the uninstall | After the uninstall |
 * |---|---|---|
 * | `baselineGzip`  | 127 B   | 125 B   |
 * | `verifierGzip`  | 28434 B | 28431 B |
 * | `verifierDelta` | **28307 B** | **28306 B** |
 *
 * **The delta did not move, and that is the finding, not a disappointment.** Plan 28-01
 * had already deleted the lazy `import('libsodium-wrappers')`, so the uninstall had no
 * bytes left to take off the page. The 1-byte difference is the known `mkdtemp`-path
 * variance recorded at `x509-bundle.e2e.test.ts:108-113`, three orders of magnitude below
 * the headroom here.
 *
 * The 28.3 KB is not libsodium and never was — it is the real transitive graph a caller
 * pays for touching `@o2/core`'s barrel at all (`@noble/curves`, and the
 * `@ipld/dag-cbor` + `multiformats` machinery the barrel's other reachable exports pull).
 *
 * Ceiling set at `ceil(28306 * 1.35 / 1024) KiB = 38 KiB = 38912 bytes` — 1.375x headroom
 * over the measured delta, inside the 1.2-1.5x range this profile's other sited constants
 * use. Raising it without re-measuring loses the guard's entire purpose.
 *
 * **Planted-mutation proof (CLAUDE.md § Proofs), performed once and recorded rather than
 * left in the suite.** This constant was set to `0` and the file re-run. Observed failure,
 * verbatim:
 *
 *   AssertionError: expected 28306 to be less than or equal to 0
 *
 * — naming the real measured delta against the too-low limit. Restored by the surgical
 * inverse of that one-line edit and verified byte-identical, via `cmp`, against a
 * snapshot taken immediately before the plant. Never `cp`, never `git stash`, never
 * `git checkout --`.
 */
const VERIFIER_BUDGET_BYTES = 38_912

/**
 * What `libsodium-wrappers` alone cost, as a gzip delta over the same baseline, measured
 * in the same run and by the same procedure as the table above — **153005 bytes**
 * (149.4 KiB; `libsodiumGzip` 153132 B, raw 458134 B, over `baselineGzip` 127 B).
 *
 * **This is a historical reading, and the entry that produced it can no longer be built.**
 * That is the point, not a defect: the measurement entry
 * (`import sodium from 'libsodium-wrappers'` … `sodium.crypto_sign_verify_detached(…)`)
 * was built once, before `npm install` removed the package, and now fails to resolve:
 *
 *   Error: [vite]: Rolldown failed to resolve import "libsodium-wrappers"
 *
 * which is itself corroboration of the resolution assertion above. The constant is
 * therefore carried here as a recorded number with its conditions, never re-derived at
 * run time.
 *
 * **Against the inherited figure, which this retires.** 25-CONTEXT.md (`:97`, `:113`)
 * records libsodium's bundle cost as **314.9 KB gzip**, a figure that document itself
 * flags as one host, one run, and asks to be re-measured before being quoted as settled.
 * The re-measurement disagrees by **2.11x**, and the cause was identified rather than
 * split the difference: `gzip -9` of the two packages' unbundled, unminified
 * `dist/modules/*.js` on disk is 306869 B (`libsodium.js`) + 15558 B
 * (`libsodium-wrappers.js`) = **322427 B = 314.87 KiB**. The inherited number is a
 * sum of files as published, never passed through a bundler; the number here is what a
 * production Vite library-mode build of a real call site actually costs, after
 * minification and tree-shaking. Per the plan, the measured number wins and the
 * inherited one is retired, not averaged.
 *
 * **The gap to `VERIFIER_BUDGET_BYTES`, stated honestly, including where it falls short
 * of what 28-02-PLAN.md asked for.** The plan's acceptance criteria require this constant
 * to sit "at least an order of magnitude" above the ceiling. Against the measured numbers
 * it does not, and the number was not bent to make it: 153005 / 38912 = **3.93x**, and
 * 153005 / 28306 = 5.41x against the raw delta. The criterion was written against the
 * inherited 314.9 KB and against an unmeasured assumption that the verification surface
 * would be small; both premises moved. What the criterion was *for* survives intact and
 * is what actually matters — re-attaching libsodium to this graph would take the delta to
 * roughly 28306 + 153005 = 181311 B, which is **4.66x** the ceiling, so the guard reddens
 * decisively rather than as a formality. The shortfall is recorded in 28-02-SUMMARY.md as
 * a deviation rather than closed by widening what counts as passing.
 */
const LIBSODIUM_MEASURED_GZIP_BYTES = 153_005
