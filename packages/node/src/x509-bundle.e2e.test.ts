import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { build } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * X509-04's second owed number (25-CONTEXT.md, owner ruling 2026-08-06/08-09): the
 * X.509 decoder's contribution to the browser tier's bundle weight, **measured**
 * rather than inherited from RESEARCH.md's earlier estimate, and **guarded** rather
 * than merely printed — "a number this phase owes, not a caveat it may inherit."
 *
 * RESEARCH.md §5 proposed a before/after diff of the real demo bundle
 * (`packages/browser/dist/assets/index-*.js`). This file deliberately does not do
 * that: nothing in `packages/browser/demo/main.ts` imports `decodeX509Certificate` in
 * this phase (no certificate is issued or verified as X.509 yet, 25-02-PLAN.md), so a
 * real before/after diff against the live demo would measure a tree-shaken-away
 * import — a false near-zero, not the decoder's real cost. Instead, two synthetic
 * Vite library-mode builds run in this one process: a baseline entry with no
 * `@o2/core` import at all, and a decoder entry that imports and genuinely calls
 * `decodeX509Certificate`. Both go through the same bundler, the same default
 * production settings, in the same run — the comparative, within-one-run measurement
 * CLAUDE.md's Measurement convention requires, not a number compared against a figure
 * recorded on a different host on a different day.
 *
 * Entry files are written under `<repo-root>/tmp/`, not `os.tmpdir()` (contrast
 * `built-bundle.e2e.test.ts:47`, which uses `os.tmpdir()` for a workdir it never
 * resolves modules from). Vite's bare-specifier resolution walks up from the
 * *importing file's own directory* looking for `node_modules` — an entry written to
 * `os.tmpdir()` sits outside this repository's directory tree entirely and would need
 * a `resolve.alias` to find `@o2/core`. An entry under `<repo-root>/tmp/` resolves it
 * for free through the workspace's real `node_modules/@o2/core` symlink, exercising
 * the exact resolution a real consumer gets. `tmp/` is already gitignored
 * (`.gitignore`'s "Logs & temp" section).
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const SCRATCH_ROOT = join(ROOT, 'tmp')

let workdir: string

const BASELINE_SOURCE = `export function run(): number {\n  return 1\n}\n`

// A real, exported call — not a discarded expression — so esbuild/Rollup cannot treat
// the import as dead and drop it. `.ok` is read from the result so the call itself
// cannot be folded away either.
const DECODER_SOURCE = `import { decodeX509Certificate } from '@o2/core'\nexport function run(bytes: Uint8Array): boolean {\n  return decodeX509Certificate(bytes).ok\n}\n`

beforeAll(async () => {
  await mkdir(SCRATCH_ROOT, { recursive: true })
  workdir = await mkdtemp(join(SCRATCH_ROOT, 'o2-x509-bundle-'))
}, 60_000)

afterAll(async () => {
  await rm(workdir, { recursive: true, force: true })
}, 60_000)

/** Build one library-mode entry and return its gzip byte size. */
async function buildAndMeasure(name: string, source: string): Promise<number> {
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
      // Left at Vite's default (esbuild minification under `mode: 'production'`,
      // which the `build()` API applies the same way the `vite build` CLI does) —
      // this measures what a real production bundle actually ships, not a debug
      // build's inflated size.
      write: true,
    },
  })

  const bytes = await readFile(join(outDir, 'out.js'))
  return gzipSync(bytes).length
}

describe('X509-04 — the decoder\'s bundle-weight contribution is measured and guarded', () => {
  it('costs the browser tier a bounded, measured amount of gzip-compressed weight', async () => {
    // Sequential, not `Promise.all` — matches the `e2e` project's own
    // `fileParallelism: false` rationale (vitest.config.ts:1127): two concurrent Vite
    // builds writing into the same scratch tree is an unforced risk, and this
    // measurement is not timing-sensitive so there is nothing to gain by racing them.
    const baselineGzipBytes = await buildAndMeasure('baseline', BASELINE_SOURCE)
    const decoderGzipBytes = await buildAndMeasure('decoder', DECODER_SOURCE)

    // The sanity check that makes the delta meaningful: if this ever fails, the
    // decoder's import was tree-shaken to nothing and the delta below would be
    // vacuously small for a reason that has nothing to do with the decoder's real
    // cost. Kept as its own assertion, separate from the ceiling check.
    expect(decoderGzipBytes).toBeGreaterThan(baselineGzipBytes)

    const delta = decoderGzipBytes - baselineGzipBytes

    // Recorded, not asserted on directly: conditions this number was taken under.
    // Host: local dev machine, 2026-08-09. Build: Vite 8.1.5 library mode, `es`
    // format, default (esbuild) minification. Measured via `node:zlib.gzipSync` on
    // the raw output bytes -- no server compression, no browser-side heuristics.
    // Representative run: baseline gzip 126 B, decoder gzip 19190 B, delta 19064 B.
    // Repeated across five separate runs in this session: delta varied 19063-19065 B
    // -- Rollup embeds the entry file's own `mkdtemp`-generated absolute path in a
    // `//#region <path>` debug comment even under production minification, and that
    // path's random suffix differs by run, moving gzip's output by a byte or two.
    // Confirmed directly: two builds from *fixed*, non-mkdtemp paths produced
    // byte-identical output (`cmp` clean). The variance is real, understood, and
    // three orders of magnitude smaller than the headroom below.
    expect(delta).toBeLessThanOrEqual(DECODER_BUDGET_BYTES)
  }, 120_000)
})

/**
 * The most gzip-compressed bytes `decodeX509Certificate`'s own dependency graph may
 * add to a page that genuinely imports and calls it.
 *
 * **Sited, not picked**, the same convention `MAX_CHAIN_DEPTH`'s docblock uses
 * (`capability.ts:101-127`). Measured delta on this host, 2026-08-09, via the exact
 * dual-build procedure this file runs: **~19064 bytes** gzip (baseline 126 B,
 * decoder 19190 B; varied 19063-19065 B across five runs -- see the assertion's own
 * comment for why). That cost is not `x509.ts`'s own ~900 lines alone -- it is the real
 * transitive graph a caller pays for calling `decodeX509Certificate` at all, because
 * two of its extension decoders (`EXT_OPERATOR_ID`, `EXT_RELAY_IDS`) call
 * `dagCbor.decode`, and `@ipld/dag-cbor` pulls in `multiformats`' CID/hasher/varint
 * machinery. Confirmed by an unminified probe build: the output's function bodies are
 * dag-cbor/multiformats/`@noble/hashes` internals (`decodeUint8`, `toArrayBufferBackedArray`,
 * `createHasher`, etc.), not unrelated `@o2/core` kernel code left un-tree-shaken --
 * `verifyChain`, `SelfRecordIndex`, `WasmExecutor` and every other barrel export
 * outside the decoder's own call graph are absent from the built output. A page that
 * already loads `@ipld/dag-cbor` for another reason (canonical encoding is already a
 * dependency of `@o2/core`'s `submitJob` path) would see a smaller marginal cost than
 * this worst-case, nothing-shared baseline measures -- this ceiling is deliberately
 * the more conservative of the two honest numbers.
 *
 * Ceiling set at `ceil(19064 * 1.34 / 1024) KiB = 25 KiB = 25600 bytes` -- roughly
 * 1.34x headroom over the measured delta, in the 1.2-1.5x range this profile's other
 * "sited, not picked" constants use. Raising this without re-measuring is the failure
 * mode `MAX_CHAIN_DEPTH`'s docblock warns about: a reader who just raises the number
 * without reading why it was set here loses the guard's entire purpose.
 *
 * **Planted-mutation proof (CLAUDE.md § Proofs), performed once and recorded rather
 * than left in the suite** (matching `capability.test.ts`'s narrated-plant style,
 * `25-PATTERNS.md`'s cited precedent): `DECODER_BUDGET_BYTES` was set to `0` and the
 * suite re-run. Observed failure, verbatim:
 *
 *   AssertionError: expected 19064 to be less than or equal to 0
 *
 * -- naming the real measured delta (19064) against the too-low limit (0), exactly as
 * the plan's `<behavior>` requires. The file was then restored to this value via the
 * surgical inverse of that one-line edit and verified byte-identical to a snapshot
 * taken immediately before planting, via `cmp`.
 */
const DECODER_BUDGET_BYTES = 25_600
