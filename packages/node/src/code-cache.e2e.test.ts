import { mkdtemp, readdir, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CID } from 'multiformats/cid'
import { chromium } from 'playwright'
import type { BrowserContext } from 'playwright'
import { createServer } from 'vite'
import type { ViteDevServer } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sha256 } from '@o2/core'
// Test-only relative import — see the note in packages/net/src/distributed.test.ts.
import { ARTIFACT_SIZED, CHAINED_HOT, syntheticArtifact } from '../../browser/src/synthetic-artifact.ts'
import { chromiumFixtureArgs, fixtureViteCacheDir } from './e2e-browser-launch.ts'

/**
 * AOT-05, criterion 4 — does a second visit hit V8's code cache?
 *
 * **Yes.** It did not until 2026-08-14, and the reason it did not was the fixture.
 *
 * ## What this file used to say, and why it was wrong
 *
 * This test previously published a negative: no WASM code-cache entry was produced on
 * any configuration tried, at 220 KB, 1.1 MB, 4.8 MB and 10.8 MB, with
 * `application/wasm`, a cacheable response, a query-free CID URL, `compileStreaming`,
 * and the module "executed millions of times first so that `wasm.TopTierCompilation`
 * appears in the trace — because blink serialises top-tier code, and a module that is
 * never called never tiers up."
 *
 * That last clause was the right idea applied to the wrong object. A module is not
 * what tiers up; a **function** is. The synthetic modules those runs served export one
 * function, `run`, and `run` did not call anything — every body in the straight-line
 * shape is an `i32.const`/binop chain, so heating `run()` three million times tiered
 * up exactly one function out of 8000, and that one function was a closed expression
 * over constants that Turbofan folds to a single materialised value.
 *
 * The measurement that settles it is printed by this test on every run, in the `heat`
 * column: the straight-line arms complete **3,000,000 `run()` calls in about 24 ms** —
 * upwards of 10^8 calls a second, a rate no 200-operation function body can sustain,
 * and the signature of a body that has been folded away. The chained arms, doing real
 * work, take 6.8 s for 60,000 calls. So the straight-line module never produced enough
 * top-tier code to reach `--wasm-caching-threshold`, and could not have been cached
 * whatever its URL, MIME type or size. **The published negative was a fact about the
 * fixture, not about the loader or the platform.**
 *
 * ## The fifth precondition
 *
 * This project built around four preconditions — streaming API, `application/wasm`, a
 * URL that is a stable cache key, and a module over ~128 KB. `node --v8-options` names
 * a fifth that nothing here accounted for:
 *
 * ```
 * --wasm-caching-threshold=1000         (top-tier code that triggers the next caching event)
 * --wasm-caching-timeout-ms=2000        (only cache if no new code compiled within this window)
 * --wasm-caching-hard-threshold=1000000 (top-tier code that triggers caching immediately)
 * ```
 *
 * The unit is **bytes of top-tier code**, not bytes of module. A large module whose
 * code never tiers up is, to this mechanism, an empty one.
 *
 * ## What is observed now
 *
 * Five profiles, five separate Chromium contexts, one Vite origin:
 *
 * | profile | shape | visits | result |
 * |---|---|---|---|
 * | straight-line | `ARTIFACT_SIZED`, 4.86 MB, both arms | 3 | `Code Cache/wasm` 72 B, no cache trace events |
 * | chained / platform | `CHAINED_HOT`, 622 KB, `compileStreaming` only | 2 | writes on visit 1, reads on visit 2 |
 * | chained / loader | `CHAINED_HOT`, 622 KB, shipped `loadArtifact` only | 2 | writes on visit 1, reads on visit 2 |
 * | quiet-default | 250 x 250, 189 KB, `compileStreaming` only | 2 | 72 B — never writes |
 * | quiet-disabled | the same, `--wasm-caching-timeout-ms=0` | 2 | writes on visit 1, reads on visit 2 |
 *
 * The last two are one pair and are read as one: see *The governing variable* below.
 *
 * The two chained profiles are separate **so the arms can be told apart**. A trace event
 * says a module was serialised; it does not say which of two modules in the same
 * renderer produced it. One arm per profile is what makes the loader's answer the
 * loader's.
 *
 * That third row closes a question this file previously parked as unanswerable:
 * *"whether `Response.clone()` preserves a cache hit is unknown: no entry was ever
 * produced to consume."* An entry is produced now, and the shipped loader — which
 * clones the response to verify its bytes while `compileStreaming` consumes the
 * original — both writes and reads one. The clone does not cost the cache.
 *
 * ## What is asserted, and what is only reported
 *
 * Asserted: that the chained profiles write and read, that the straight-line profile
 * does neither, and that the two readings come from the same apparatus in the same run.
 * The contrast is the evidence — a within-run comparison rather than a threshold
 * carried over from another machine.
 *
 * Reported and not asserted: the byte counts. `Code Cache/wasm` reads 61,528 B for the
 * platform profile and 61,570 B for the loader profile here, and pinning either would
 * turn a Chromium code-generation change into a red build. The assertion is that they
 * clear the 72-byte index-only floor by orders of magnitude.
 *
 * ## The governing variable, settled 2026-08-14
 *
 * This section used to say the governing variable was **not established**, and offered
 * function count as the axis that ordered four points without claiming it was the
 * mechanism. It is established now, and it is neither function count nor size.
 *
 * **It is V8's quiescence window, `--wasm-caching-timeout-ms`.** Caching is triggered
 * only once no new code has been compiled for that long; the default is 2000 ms. The
 * shapes that "never cache" are perfectly cacheable modules whose compilation never goes
 * quiet inside that window.
 *
 * The sweep, four shapes x four Chromium configurations, all chained, all heated 60,000
 * calls, one persistent profile each, one loopback origin, headless. `CACHES` means
 * `wasm.SerializeModule` on visit 1 and all three read events on visit 2:
 *
 * | shape | module | default | `--wasm-caching-threshold=1` | `--wasm-caching-timeout-ms=0` | `--wasm-caching-hard-threshold=250000` |
 * |---|---|---|---|---|---|
 * | 2000 x 100 | 621,623 B | CACHES 61,483 B | CACHES 61,483 B | CACHES | CACHES |
 * | 1000 x 150 | 460,473 B | flaky (72 B this run) | CACHES 30,695 B | CACHES | CACHES |
 * | 500 x 400 | 604,223 B | 72 B | 72 B | CACHES | CACHES |
 * | 250 x 250 | 189,423 B | 72 B | 72 B | CACHES | CACHES |
 *
 * Two readings do the work. **Disabling the timer alone caches all four** — the byte
 * threshold left at its default 1000. **Lowering the byte threshold to 1 does not**:
 * 500 x 400 and 250 x 250 stay at the 72-byte index-only floor. So the gate is the
 * timer, and the threshold is not what those two were failing.
 *
 * The window each shape needs, from a ladder on `--wasm-caching-timeout-ms` alone:
 *
 * | shape | 2000 ms (default) | 1000 ms | 250 ms | 50 ms |
 * |---|---|---|---|---|
 * | 500 x 400 | no | CACHES | CACHES | CACHES |
 * | 250 x 250 | no | no | CACHES | CACHES |
 *
 * Monotone, and at a different value per shape. 2000 x 100 caches at the default, so the
 * three sit in an order — 2000 x 100 tolerates ≥2000 ms, 500 x 400 needs ≤1000 ms,
 * 250 x 250 needs ≤250 ms — and that order, not the size column, is the finding.
 *
 * ## A hypothesis that fit the arithmetic and was false anyway
 *
 * V8's own accounting, read for the first time with `--trace-wasm-compilation-times`
 * (which reports each function's Liftoff→TurboFan upgrade **and its `codesize`**, the
 * quantity this file had only ever inferred), summed over the module in Node:
 *
 * | shape | TurboFan functions | top-tier code |
 * |---|---|---|
 * | 2000 x 100 | 2000 | **1,009,052 B** |
 * | 1000 x 150 | 1000 | 691,008 B |
 * | 500 x 400 | 500 | 785,080 B |
 * | 250 x 250 | 250 | 260,688 B |
 *
 * `--wasm-caching-hard-threshold` defaults to 1,000,000 and is documented as triggering
 * caching *immediately, ignoring the timeout*. The committed shape produces 1,009,052 B —
 * over that line by 9,052 B, or 0.9% — and it is the only one of the four that crosses
 * it. That is a complete explanation of every row in the first table, and it is **wrong**.
 * Raising the hard threshold to 2,000,000, above the committed shape's own top-tier
 * total, left it caching and left the figure byte-identical at 61,483 B. It does not
 * reach the cache by that door.
 *
 * The number is recorded because it agreed with a theory and the theory still died —
 * which is the third time in this project that arithmetic fitting a hypothesis has not
 * been the hypothesis's proof, and the reason the falsifying arm was run at all.
 *
 * ## What is still open
 *
 * *Why* compilation fails to go quiet inside 2000 ms for these shapes. Per-function
 * TurboFan cost does not look like the cause: measured in Node, 500 x 400's 500 upgrades
 * total 4 ms and 250 x 250's 250 total 1 ms, so no individual job is slow, and the
 * consultation's proposed mechanism — large functions finishing far apart so bytes
 * trickle — is not supported by that reading even though its conclusion was right.
 * Total top-tier bytes does not order the four either: 500 x 400 produces more of it
 * than 1000 x 150 and is the harder of the two to cache.
 *
 * The residual is settled to the level of *which knob governs*, which is what the
 * committed pair below asserts, and not to the level of what makes each shape sit where
 * it does on that knob.
 *
 * Also unchanged and deliberate: the committed default shape stays 2000 x 100. It is the
 * shape that reproduces, and `streaming-load.browser.test.ts` pins its bytes exactly.
 *
 * It also remains true that this is automation-driven Chromium, a fresh temporary
 * profile and a loopback http origin, and that none of those was isolated as a factor.
 * What changed is the direction of the result, not the reach of the harness.
 *
 * Serialised with the other e2e specs: it launches its own Chromium and its own Vite
 * server.
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))

/**
 * Two distinct artifacts of near-identical size, one per arm.
 *
 * Distinct so the arms cannot share a cache entry — identical bytes would be
 * identical CIDs, hence one URL, and the second arm would be reading whatever the
 * first arm left behind. Near-identical in size so the arms remain comparable.
 *
 * ~4.8 MB puts them in the range of a real `aarch64-wasi32` translation: elfconv
 * turned a 659 KB `hello` into 5.66 MB, measured on this machine.
 *
 * These are the *straight-line* shapes, and they are kept for exactly one reason:
 * they are the configuration the negative was published at, so reproducing the 72-byte
 * reading beside a working one is what shows the difference is the fixture. Nothing
 * here treats them as a stand-in for a cacheable artifact any more.
 */
const RAW_ARM = syntheticArtifact(ARTIFACT_SIZED)
const LOADER_ARM = syntheticArtifact({ ...ARTIFACT_SIZED, functions: ARTIFACT_SIZED.functions + 1 })

/**
 * The executable shapes — the same two-arm rule, on a module that can tier up.
 *
 * One per profile rather than two per profile: see the module comment. Distinct byte
 * counts for the same reason as above.
 */
const HOT_PLATFORM_ARM = syntheticArtifact(CHAINED_HOT)
const HOT_LOADER_ARM = syntheticArtifact({ ...CHAINED_HOT, functions: CHAINED_HOT.functions + 1 })

/**
 * 250 x 250 — the shape that never cached, and the subject of the quiescence pair.
 *
 * Chosen from the four swept shapes because it is the one that fails hardest at V8's
 * default settings and the one whose heat is cheapest: 60,000 calls cost about 1.5 s
 * here against 6.5 s for `CHAINED_HOT`, so carrying two more profiles costs the suite
 * a few seconds rather than a minute. It is deliberately **not** promoted to
 * `synthetic-artifact.ts`: it is a diagnostic subject for one measurement, not a
 * published fixture, and `streaming-load.browser.test.ts` pins byte-exact output for
 * the shapes that are.
 */
const QUIET_SHAPE = { functions: 250, opsPerFunction: 250, chained: true } as const
const QUIET_DEFAULT_ARM = syntheticArtifact(QUIET_SHAPE)
/** A distinct module for the other profile, for the reason the other arms are distinct. */
const QUIET_DISABLED_ARM = syntheticArtifact({ ...QUIET_SHAPE, functions: QUIET_SHAPE.functions + 1 })

/**
 * The flag that settles the residual, passed to one profile of the pair and not the other.
 *
 * `--wasm-caching-timeout-ms` is V8's quiescence window: caching is triggered only once
 * no new code has been compiled for that long. `0` is documented on `node --v8-options`
 * as *"disable this logic and only use --wasm-caching-threshold"*.
 *
 * ## The flag was verified to exist rather than assumed
 *
 * Two checks, because "the flag is in the help text of the Node on this machine" is not
 * the same claim as "this Chromium's V8 honours it", and this file has already been
 * burned once by a list of names that were present in the binary and inert on the path.
 *
 * 1. `--js-flags` reaches the renderer's V8 at all: launched with
 *    `--js-flags=--expose-gc`, `typeof globalThis.gc` is `'function'` in the page, and
 *    `'undefined'` without it.
 * 2. This flag is *recognised by name*: V8 writes `Error: unrecognized flag <name>` to
 *    the browser process's stderr for one that is not, and a deliberately bogus
 *    `--o2-bogus-flag-xyz` produces exactly that line while the wasm-caching flags
 *    produce none. Measured against Google Chrome for Testing 151.0.7922.34.
 *
 * A flag that were silently ignored would make the pair below agree, not disagree — so
 * the disagreement is itself the third check, and the one that runs on every build.
 */
const DISABLE_QUIESCENCE_TIMER = ['--js-flags=--wasm-caching-timeout-ms=0']

/** Multicodec `raw` — a single block of bytes, which is what an artifact is. */
const RAW_CODE = 0x55

/**
 * How many times each arm calls `run()` before the page is left to settle.
 *
 * A **call count**, not a wall-clock budget. V8 budgets tier-up in approximate bytes
 * executed per function (`--wasm-tiering-budget=13000000`), so what has to be
 * controlled is calls; a time box would make the thing under control depend on how
 * busy the machine is, which is the failure mode a measurement here can least afford.
 *
 * 60,000 against a requirement of roughly 42,000 for a 2000 x 100 module — about 40%
 * headroom. Measured: at 45,400 calls the entry appears, at 19,800 it does not.
 * The straight-line arms keep their original three million, which cost a fraction of
 * a second precisely because the body they call has been folded away.
 */
const HOT_HEAT_CALLS = 60_000
const STRAIGHT_HEAT_CALLS = 3_000_000

/**
 * Bulk JavaScript for the page to load, so the JS side of the comparison has
 * something substantial in it even if Vite's own output shrinks.
 *
 * This was the *positive control* while the WASM reading was null: without it, "no
 * WASM code cache" could not be told apart from "this harness cannot see a code
 * cache". It is retained rather than removed, because the straight-line profile still
 * returns a null and that null still needs calibrating — but it is no longer the only
 * thing standing between this file and an uninterpretable zero. The chained profiles
 * calibrate the WASM directory directly, which is strictly better evidence.
 */
function controlModule(): string {
  let source = ''
  for (let i = 0; i < 4000; i++) {
    source += `export function f${i}(x){let a=x;${'a=(a*3+7)^(a>>>2);'.repeat(8)}return a}\n`
  }
  return `${source}export const marker = 'o2-code-cache-control'\n`
}

const CONTROL_JS = controlModule()

interface ArmResult {
  readonly ok: boolean
  readonly bytes: number
  readonly compileMs: number
  /** Calls actually completed, so a truncated heat is visible rather than silent. */
  readonly heatCalls: number
  readonly heatMs: number
  readonly detail: string
}

declare global {
  interface Window {
    probeReady: boolean
    controlLoaded: boolean
    /** The platform API, unmediated — the control for the loader arm. */
    armRaw: (url: string, heatCalls: number) => Promise<ArmResult>
    /** The shipped `loadArtifact`, imported into the page by Vite. */
    armLoader: (base: string, cid: string, heatCalls: number) => Promise<ArmResult>
  }
}

interface VisitReading {
  readonly visit: number
  readonly arms: readonly ArmResult[]
  readonly wasmCacheBytes: number
  readonly jsCacheBytes: number
  readonly writeTraceEvents: readonly string[]
  readonly readTraceEvents: readonly string[]
  readonly artifactRequests: number
}

/**
 * Trace event names this Chromium emits when it **writes** a module to the code cache.
 *
 * ## The list this replaces was inert
 *
 * It read:
 *
 * ```
 * v8.wasm.moduleCacheHit, v8.wasm.cachedModule,
 * v8.wasm.moduleCacheInvalid, v8.wasm.moduleCacheInvalidDigest
 * ```
 *
 * under a comment claiming they were "taken from the binary itself rather than from
 * memory of the Blink source: all four appear as string literals in the framework this
 * test drives, so looking for them and finding nothing is a measurement."
 *
 * The premise is true and the conclusion did not follow. All four *are* string literals
 * in this Chromium — `strings` on the framework binary finds them. **None of them fires
 * on a genuine cache hit.** They were checked against a run that writes an entry on
 * visit 1 and reads it back on visits 2 and 3, and the filtered list came back empty on
 * every visit, exactly as it did when nothing was cached at all.
 *
 * So the file's claim of "two independent observations" was one observation and a
 * constant. That is the defect class this project names as its own: **a reading that
 * would be identical if the mechanism had never run.** Present in a binary is not the
 * same as emitted on this path, and only the second one makes a filter a measurement.
 *
 * The names below were read off a trace of a run that demonstrably cached, not off the
 * binary and not off memory of the source.
 */
const CACHE_WRITE_TRACE_NAMES = ['wasm.SerializeModule']

/**
 * ...and when it **reads** one back.
 *
 * Three, because they are three different claims: `wasm.GetNativeModuleFromCache` is
 * the lookup succeeding, `wasm.Deserialize` is the bytes being turned back into code,
 * and `wasm.CompilationAfterDeserialization` is the residue compiled because it was
 * not in the entry. A hit emits all three together here; requiring only one would
 * accept a lookup that found something and could not use it.
 */
const CACHE_READ_TRACE_NAMES = [
  'wasm.GetNativeModuleFromCache',
  'wasm.Deserialize',
  'wasm.CompilationAfterDeserialization',
]

/** One Chromium profile, its directory, and the readings taken from it. */
interface Profile {
  readonly label: string
  readonly dir: string
  readonly context: BrowserContext
}

let server: ViteDevServer
let baseUrl: string
let straight: Profile
let hotPlatform: Profile
let hotLoader: Profile
let quietDefault: Profile
let quietDisabled: Profile
let rawCid: string
let loaderCid: string
let hotPlatformCid: string
let hotLoaderCid: string
let quietDefaultCid: string
let quietDisabledCid: string
let artifactRequests = 0

/** Recursive byte total. `-1` when the directory does not exist at all. */
async function dirBytes(dir: string): Promise<number> {
  let total = 0
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return -1
  }
  for (const entry of entries) {
    const path = join(dir, entry.name)
    total += entry.isDirectory() ? await dirBytes(path) : (await stat(path)).size
  }
  return total
}

const codeCacheDir = (profile: Profile, kind: 'js' | 'wasm'): string =>
  join(profile.dir, 'Default', 'Code Cache', kind)

/**
 * The page.
 *
 * Served through Vite's `transformIndexHtml` so the inline module script can import
 * the **real** `streaming-load.ts` and the real `multiformats` CID parser. A
 * transcription of the loader's strategy would have been simpler and would have
 * measured something other than the shipped code.
 */
const PAGE = `<!doctype html><meta charset="utf-8"><title>o2 code cache probe</title>
<script type="module">
import { CID } from 'multiformats/cid'
import { loadArtifact } from '/packages/browser/src/streaming-load.ts'

/**
 * Force top-tier compilation: V8 serialises tiered-up code and nothing else.
 *
 * Bounded by calls, with a wall-clock stop only as a backstop against a module that
 * turns out to be far slower than expected — reaching that backstop truncates the heat,
 * so the count is returned and asserted rather than assumed.
 */
function heat(module, calls) {
  const instance = new WebAssembly.Instance(module, {})
  const run = instance.exports.run
  let acc = 0
  let done = 0
  const started = performance.now()
  while (done < calls && performance.now() - started < 60000) {
    for (let i = 0; i < 200; i++) { acc = (acc + run()) | 0; done++ }
  }
  return { acc, done, ms: performance.now() - started }
}

window.armRaw = async (url, heatCalls) => {
  try {
    const started = performance.now()
    const module = await WebAssembly.compileStreaming(fetch(url))
    const compileMs = performance.now() - started
    const response = await fetch(url)
    const bytes = (await response.arrayBuffer()).byteLength
    const heated = heat(module, heatCalls)
    return { ok: true, bytes, compileMs, heatCalls: heated.done, heatMs: heated.ms, detail: 'compileStreaming' }
  } catch (cause) {
    return { ok: false, bytes: 0, compileMs: 0, heatCalls: 0, heatMs: 0, detail: String(cause) }
  }
}

window.armLoader = async (base, cid, heatCalls) => {
  const result = await loadArtifact({ gatewayBase: base, cid: CID.parse(cid) })
  if (!result.ok) return { ok: false, bytes: 0, compileMs: 0, heatCalls: 0, heatMs: 0, detail: JSON.stringify(result.failure) }
  const heated = heat(result.artifact.module, heatCalls)
  return {
    ok: true,
    bytes: result.artifact.bytes,
    compileMs: result.artifact.compileMs,
    heatCalls: heated.done,
    heatMs: heated.ms,
    detail: result.artifact.cacheEligible ? 'eligible' : 'INELIGIBLE',
  }
}

// Bulk JavaScript from the same origin, part of the control side of the comparison.
//
// The specifier is assembled at runtime and marked @vite-ignore so Vite's import
// analysis leaves it alone — the middleware serves it, so the response headers are
// the ones this test chose rather than the ones Vite would have chosen.
window.controlLoaded = false
const controlUrl = '/control/' + 'module.js'
import(/* @vite-ignore */ controlUrl).then((mod) => {
  window.controlLoaded = mod.marker === 'o2-code-cache-control'
})

window.probeReady = true
</script>`

async function launchProfile(label: string, args: readonly string[] = []): Promise<Profile> {
  // A persistent profile, because a code cache that lives only in memory would make
  // the "second visit" arm meaningless before it started.
  //
  // `args` exists for the quiescence pair below and for nothing else. It is the only
  // difference between those two profiles, which is what makes their disagreement a
  // reading of the flag rather than of the machine.
  const dir = await mkdtemp(join(tmpdir(), `o2-code-cache-${label}-`))
  return { label, dir, context: await chromium.launchPersistentContext(dir, { headless: true, args: chromiumFixtureArgs(args) }) }
}

beforeAll(async () => {
  rawCid = CID.create(1, RAW_CODE, await sha256.digest(RAW_ARM)).toString()
  loaderCid = CID.create(1, RAW_CODE, await sha256.digest(LOADER_ARM)).toString()
  hotPlatformCid = CID.create(1, RAW_CODE, await sha256.digest(HOT_PLATFORM_ARM)).toString()
  hotLoaderCid = CID.create(1, RAW_CODE, await sha256.digest(HOT_LOADER_ARM)).toString()
  quietDefaultCid = CID.create(1, RAW_CODE, await sha256.digest(QUIET_DEFAULT_ARM)).toString()
  quietDisabledCid = CID.create(1, RAW_CODE, await sha256.digest(QUIET_DISABLED_ARM)).toString()

  const byCid = new Map<string, Uint8Array>([
    [rawCid, RAW_ARM],
    [loaderCid, LOADER_ARM],
    [hotPlatformCid, HOT_PLATFORM_ARM],
    [hotLoaderCid, HOT_LOADER_ARM],
    [quietDefaultCid, QUIET_DEFAULT_ARM],
    [quietDisabledCid, QUIET_DISABLED_ARM],
  ])

  server = await createServer({
    root: ROOT,
    logLevel: 'error',
    server: { port: 0 },
    cacheDir: fixtureViteCacheDir(ROOT),
    plugins: [
      {
        name: 'o2-code-cache-fixtures',
        configureServer(dev) {
          dev.middlewares.use((request, response, next) => {
            const path = (request.url ?? '/').split('?')[0] ?? '/'

            if (path.startsWith('/artifact/')) {
              const bytes = byCid.get(path.slice('/artifact/'.length))
              if (bytes === undefined) {
                response.writeHead(404).end('no such artifact')
                return
              }
              artifactRequests += 1
              // The four preconditions, on the wire: the right type, a cacheable
              // response, and a URL that is the CID and nothing else. The fifth is a
              // property of the module, not of the response, and lives in the shape.
              response.writeHead(200, {
                'content-type': 'application/wasm',
                'content-length': String(bytes.length),
                'cache-control': 'public, max-age=31536000, immutable',
              })
              response.end(Buffer.from(bytes))
              return
            }

            if (path === '/control/module.js') {
              response.writeHead(200, {
                'content-type': 'text/javascript; charset=utf-8',
                'cache-control': 'public, max-age=31536000, immutable',
              })
              response.end(CONTROL_JS)
              return
            }

            if (path === '/code-cache-probe') {
              dev.transformIndexHtml('/code-cache-probe', PAGE).then(
                (html) => {
                  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
                  response.end(html)
                },
                () => response.writeHead(500).end('transform failed'),
              )
              return
            }

            next()
          })
        },
      },
    ],
  })
  await server.listen()
  const url = server.resolvedUrls?.local[0]
  if (url === undefined) throw new Error('vite dev server produced no URL')
  baseUrl = url.endsWith('/') ? url.slice(0, -1) : url

  straight = await launchProfile('straight')
  hotPlatform = await launchProfile('hot-platform')
  hotLoader = await launchProfile('hot-loader')
  quietDefault = await launchProfile('quiet-default')
  quietDisabled = await launchProfile('quiet-disabled', DISABLE_QUIESCENCE_TIMER)
}, 300_000)

afterAll(async () => {
  for (const profile of [straight, hotPlatform, hotLoader, quietDefault, quietDisabled]) {
    await profile?.context.close().catch(() => {})
    await rm(profile?.dir ?? '', { recursive: true, force: true }).catch(() => {})
  }
  await server?.close().catch(() => {})
}, 180_000)

/** What one page load should do, beyond loading the page. */
type Arm = (page: import('playwright').Page) => Promise<ArmResult>

const platformArm =
  (cid: string, heatCalls: number): Arm =>
  (page) =>
    page.evaluate((args) => window.armRaw(args.url, args.heatCalls), {
      url: `${baseUrl}/artifact/${cid}`,
      heatCalls,
    })

const loaderArm =
  (cid: string, heatCalls: number): Arm =>
  (page) =>
    page.evaluate((args) => window.armLoader(args.base, args.cid, args.heatCalls), {
      base: `${baseUrl}/artifact/`,
      cid,
      heatCalls,
    })

/** One page load in one profile: its arms, the control, the disk, and the trace. */
async function visit(profile: Profile, index: number, settleMs: number, arms: readonly Arm[]): Promise<VisitReading> {
  const page = await profile.context.newPage()
  // A silent page failure here is indistinguishable from a timeout, and a timeout
  // in a cache measurement looks like a cache miss.
  page.on('pageerror', (error) => process.stderr.write(`[${profile.label}] page error: ${error.message}\n`))
  page.on('console', (message) => {
    if (message.type() === 'error') process.stderr.write(`[${profile.label}] console: ${message.text()}\n`)
  })
  const session = await profile.context.newCDPSession(page)
  const traced = new Set<string>()
  session.on('Tracing.dataCollected', (payload) => {
    for (const event of payload.value) if (typeof event['name'] === 'string') traced.add(event['name'])
  })
  await session.send('Tracing.start', {
    traceConfig: { includedCategories: ['v8', 'v8.wasm', 'disabled-by-default-v8.wasm'] },
    transferMode: 'ReportEvents',
  })

  const before = artifactRequests
  await page.goto(`${baseUrl}/code-cache-probe`)
  await page.waitForFunction(() => window.probeReady === true, null, { timeout: 60_000 })

  const results: ArmResult[] = []
  for (const arm of arms) results.push(await arm(page))
  await page.waitForFunction(() => window.controlLoaded === true, null, { timeout: 60_000 })

  // V8 writes the cache on a timer once enough top-tier code exists and compilation
  // has gone quiet (`--wasm-caching-timeout-ms=2000`). Closing the page early would be
  // a way to observe nothing for a reason that has nothing to do with caching.
  await page.waitForTimeout(settleMs)

  const finished = new Promise<void>((resolve) => session.once('Tracing.tracingComplete', () => resolve()))
  await session.send('Tracing.end')
  await finished
  await page.close()

  return {
    visit: index,
    arms: results,
    wasmCacheBytes: await dirBytes(codeCacheDir(profile, 'wasm')),
    jsCacheBytes: await dirBytes(codeCacheDir(profile, 'js')),
    writeTraceEvents: CACHE_WRITE_TRACE_NAMES.filter((name) => traced.has(name)),
    readTraceEvents: CACHE_READ_TRACE_NAMES.filter((name) => traced.has(name)),
    artifactRequests: artifactRequests - before,
  }
}

/**
 * The floor that separates "an entry exists" from "only the index exists".
 *
 * 72 bytes is the measured signature of an empty code-cache directory on this platform
 * — produced deliberately by relaunching with `--v8-cache-options=none`, and the figure
 * the straight-line profile returns on every visit. 4096 is a generous margin above it
 * and an order of magnitude below the ~61.5 KB an entry actually occupies, so the
 * comparison never depends on where in that gap a future Chromium lands.
 */
const INDEX_ONLY_CEILING = 4096

const straightReadings: VisitReading[] = []
const hotPlatformReadings: VisitReading[] = []
const hotLoaderReadings: VisitReading[] = []
const quietDefaultReadings: VisitReading[] = []
const quietDisabledReadings: VisitReading[] = []

describe('AOT-05 — a translated artifact loads over a stable content-addressed URL', () => {
  it('completes every visit in every profile with both the platform API and the shipped loader', async () => {
    // The first visit of each profile gets the long settle: it is the one that could
    // produce a cache entry, and a short wait would confuse "not written" with "not yet".
    const straightArms = [platformArm(rawCid, STRAIGHT_HEAT_CALLS), loaderArm(loaderCid, STRAIGHT_HEAT_CALLS)]
    straightReadings.push(await visit(straight, 1, 25_000, straightArms))
    straightReadings.push(await visit(straight, 2, 10_000, straightArms))
    straightReadings.push(await visit(straight, 3, 10_000, straightArms))

    const platform = [platformArm(hotPlatformCid, HOT_HEAT_CALLS)]
    hotPlatformReadings.push(await visit(hotPlatform, 1, 15_000, platform))
    hotPlatformReadings.push(await visit(hotPlatform, 2, 8_000, platform))

    const loader = [loaderArm(hotLoaderCid, HOT_HEAT_CALLS)]
    hotLoaderReadings.push(await visit(hotLoader, 1, 15_000, loader))
    hotLoaderReadings.push(await visit(hotLoader, 2, 8_000, loader))

    // The quiescence pair. Identical in every respect the other profiles vary —
    // same origin, same headers, same heat, same settle, same platform API, same
    // shape — and different in exactly one Chromium argument.
    const quietA = [platformArm(quietDefaultCid, HOT_HEAT_CALLS)]
    quietDefaultReadings.push(await visit(quietDefault, 1, 15_000, quietA))
    quietDefaultReadings.push(await visit(quietDefault, 2, 8_000, quietA))

    const quietB = [platformArm(quietDisabledCid, HOT_HEAT_CALLS)]
    quietDisabledReadings.push(await visit(quietDisabled, 1, 15_000, quietB))
    quietDisabledReadings.push(await visit(quietDisabled, 2, 8_000, quietB))

    for (const [label, readings] of [
      ['straight', straightReadings],
      ['hot-platform', hotPlatformReadings],
      ['hot-loader', hotLoaderReadings],
      ['quiet-default', quietDefaultReadings],
      ['quiet-disabled', quietDisabledReadings],
    ] as const) {
      for (const reading of readings) {
        for (const arm of reading.arms) {
          expect(arm.ok, `${label} visit ${reading.visit}: ${arm.detail}`).toBe(true)
        }
      }
    }
  }, 900_000)

  it('heats every chained arm past the tier-up budget, so a null could not be an unheated module', () => {
    // The whole correction in this file is that the previous fixture never tiered up.
    // A truncated heat would silently reintroduce exactly that, and the wall-clock
    // backstop in `heat` makes truncation possible rather than impossible.
    for (const reading of [
      ...hotPlatformReadings,
      ...hotLoaderReadings,
      ...quietDefaultReadings,
      ...quietDisabledReadings,
    ]) {
      for (const arm of reading.arms) {
        expect(arm.heatCalls, `visit ${reading.visit} heated only ${arm.heatCalls} calls`).toBe(HOT_HEAT_CALLS)
      }
    }
  })

  it('serves the straight-line arms over the ~4.8 MB the size precondition asks for', () => {
    const first = straightReadings[0]
    expect(first).toBeDefined()
    if (first === undefined) return
    // Both arms must clear 128 KB or the measurement is of a module V8 would never
    // have cached anyway — which is exactly the trap the demo kernel sets. Necessary,
    // and — as this file now documents at length — not sufficient.
    for (const arm of first.arms) expect(arm.bytes).toBeGreaterThan(128 * 1024)
    expect(first.arms[1]?.detail).toBe('eligible')
  })

  it('addresses the artifact by CID alone, with nothing in the URL that could bust a cache', () => {
    // The cache key is the URL. This is the one precondition that is a property of
    // this repository's code rather than of the platform, so it is asserted here as
    // well as in the browser test.
    for (const cid of [rawCid, hotPlatformCid, hotLoaderCid]) {
      const url = `${baseUrl}/artifact/${cid}`
      expect(url).not.toContain('?')
      expect(url).not.toContain('#')
      expect(url.endsWith(cid)).toBe(true)
    }
  })

  it('serves the artifact from the HTTP cache on later visits, which is not the code cache', () => {
    // Distinguishing the two is the whole reason this test looks at disk and at the
    // trace rather than at a stopwatch: a repeat visit is faster because the bytes
    // never crossed a socket, and that improvement is real, cheap, and not criterion 4.
    expect(straightReadings[0]?.artifactRequests).toBe(2) // one per arm
    expect(straightReadings[1]?.artifactRequests).toBe(0)
    expect(straightReadings[2]?.artifactRequests).toBe(0)
    expect(hotPlatformReadings[0]?.artifactRequests).toBe(1)
    expect(hotPlatformReadings[1]?.artifactRequests).toBe(0)
  })
})

describe('AOT-05 — the code cache is written and read back, once the module can tier up', () => {
  it('writes an entry on the first visit through the platform API', () => {
    const first = hotPlatformReadings[0]
    expect(first).toBeDefined()
    if (first === undefined) return
    // Two observations that are genuinely independent this time: a directory that grew
    // on disk, and a trace event emitted by the engine that grew it. Either alone would
    // be a number; together they are a mechanism.
    expect(first.wasmCacheBytes).toBeGreaterThan(INDEX_ONLY_CEILING)
    expect(first.writeTraceEvents).toEqual(CACHE_WRITE_TRACE_NAMES)
  })

  it('reads that entry back on the second visit, which is what criterion 4 actually asks', () => {
    const second = hotPlatformReadings[1]
    expect(second).toBeDefined()
    if (second === undefined) return
    // All three, not any: a lookup that finds an entry it cannot use would emit the
    // first and not the rest, and that is a miss wearing a hit's name.
    expect(second.readTraceEvents).toEqual(CACHE_READ_TRACE_NAMES)
    expect(second.wasmCacheBytes).toBeGreaterThan(INDEX_ONLY_CEILING)
  })

  it('does the same through the shipped loader, so Response.clone() does not cost the hit', () => {
    // The question this file parked as unanswerable while no entry existed. `loadArtifact`
    // clones the response to verify its bytes against the CID and hands the original to
    // `compileStreaming`; the worry was that the clone would detach whatever Blink
    // attaches for cached metadata. Its own profile, so the answer is unambiguously the
    // loader's rather than a neighbouring arm's.
    const first = hotLoaderReadings[0]
    const second = hotLoaderReadings[1]
    expect(first).toBeDefined()
    expect(second).toBeDefined()
    if (first === undefined || second === undefined) return
    expect(first.writeTraceEvents).toEqual(CACHE_WRITE_TRACE_NAMES)
    expect(second.readTraceEvents).toEqual(CACHE_READ_TRACE_NAMES)
    expect(second.wasmCacheBytes).toBeGreaterThan(INDEX_ONLY_CEILING)
  })

  it('produces no entry at all for the straight-line shape, in the same run and the same apparatus', () => {
    // The contrast that makes the rows above evidence rather than an anecdote. Same
    // Chromium, same origin, same headers, same settle, larger module, more visits —
    // and nothing, because nothing in it ever became top-tier code. This is the
    // published negative, reproduced, and now explained.
    for (const reading of straightReadings) {
      expect(reading.wasmCacheBytes, `straight visit ${reading.visit}`).toBeLessThan(INDEX_ONLY_CEILING)
      expect(reading.writeTraceEvents).toEqual([])
      expect(reading.readTraceEvents).toEqual([])
    }
    // And it is a reading rather than an absence of one: the directory exists.
    for (const reading of straightReadings) expect(reading.wasmCacheBytes).toBeGreaterThanOrEqual(0)
  })

  it('still fills the JavaScript code cache in the null profile, so that null stays calibrated', () => {
    // Retained from when this was the only calibration available. It answers a question
    // the WASM rows no longer leave open — "can this harness see a code cache at all" —
    // but the straight-line profile still reports a zero, and a zero from an
    // uncalibrated instrument is worth nothing whichever direction the other rows point.
    const first = straightReadings[0]
    const last = straightReadings[straightReadings.length - 1]
    expect(first).toBeDefined()
    expect(last).toBeDefined()
    if (first === undefined || last === undefined) return
    expect(last.jsCacheBytes).toBeGreaterThan(500_000)
    expect(last.jsCacheBytes).toBeGreaterThan(first.jsCacheBytes)
  })

  it('leaves 250x250 uncached at V8\'s default quiescence window, reproducing the residual', () => {
    // The row the sweep recorded as "never writes". It is reproduced here rather than
    // quoted, because it is the half of the pair that carries the contrast: without it,
    // the flagged profile below is a module that caches, which was never in doubt.
    for (const reading of quietDefaultReadings) {
      expect(reading.wasmCacheBytes, `quiet-default visit ${reading.visit}`).toBeLessThan(INDEX_ONLY_CEILING)
      expect(reading.writeTraceEvents).toEqual([])
      expect(reading.readTraceEvents).toEqual([])
    }
    // A reading, not an absence of one.
    for (const reading of quietDefaultReadings) expect(reading.wasmCacheBytes).toBeGreaterThanOrEqual(0)
  })

  it('caches that same shape once the quiescence timer is disabled — the governing variable', () => {
    // **This is the answer to the residual.** One Chromium argument apart from the
    // profile above: same origin, same headers, same 60,000 calls, same settle, same
    // platform API, and a module of the same shape. It writes on visit 1 and reads on
    // visit 2.
    //
    // What that rules out is everything the residual left open. The module is not too
    // small, not too large, not the wrong function count, and not "unable to tier up" —
    // it is the same module, and the only thing that changed is *when V8 decides to
    // serialise*. So the governing variable is the caching trigger policy, and
    // specifically the quiescence window: not module bytes, not function count, and not
    // ops per function, all of which are identical across this pair.
    const first = quietDefaultReadings[0]
    const flaggedFirst = quietDisabledReadings[0]
    const flaggedSecond = quietDisabledReadings[1]
    expect(first).toBeDefined()
    expect(flaggedFirst).toBeDefined()
    expect(flaggedSecond).toBeDefined()
    if (first === undefined || flaggedFirst === undefined || flaggedSecond === undefined) return
    expect(flaggedFirst.writeTraceEvents).toEqual(CACHE_WRITE_TRACE_NAMES)
    expect(flaggedSecond.readTraceEvents).toEqual(CACHE_READ_TRACE_NAMES)
    expect(flaggedFirst.wasmCacheBytes).toBeGreaterThan(INDEX_ONLY_CEILING)
    // The comparison stated as a ratio within the run, which is what makes it a reading
    // of the flag rather than of this machine on this day.
    expect(flaggedFirst.wasmCacheBytes).toBeGreaterThan(first.wasmCacheBytes * 10)
  })

  it('reports every reading, including the figures it deliberately does not assert', () => {
    const lines: string[] = []
    lines.push('AOT-05 criterion 4 — V8 WebAssembly code cache across visits')
    lines.push(`  origin ${baseUrl}, three persistent profiles, headless`)
    lines.push(`  straight-line arms ${RAW_ARM.length} B / ${LOADER_ARM.length} B, ${STRAIGHT_HEAT_CALLS} calls each`)
    lines.push(`  chained arms ${HOT_PLATFORM_ARM.length} B / ${HOT_LOADER_ARM.length} B, ${HOT_HEAT_CALLS} calls each`)
    lines.push('  | profile | visit | compile | heat | Code Cache/wasm | Code Cache/js | write trace | read trace |')
    for (const [label, readings] of [
      ['straight', straightReadings],
      ['hot-platform', hotPlatformReadings],
      ['hot-loader', hotLoaderReadings],
      ['quiet-default', quietDefaultReadings],
      ['quiet-disabled', quietDisabledReadings],
    ] as const) {
      for (const reading of readings) {
        const compile = reading.arms.map((arm) => `${arm.compileMs.toFixed(1)}ms`).join('+')
        const heat = reading.arms.map((arm) => `${arm.heatMs.toFixed(0)}ms`).join('+')
        lines.push(
          `  | ${label} | ${reading.visit} | ${compile} | ${heat} | ${reading.wasmCacheBytes}B | ` +
            `${reading.jsCacheBytes}B | ${reading.writeTraceEvents.join(', ') || 'none'} | ` +
            `${reading.readTraceEvents.join(', ') || 'none'} |`,
        )
      }
    }
    lines.push(
      '  RESULT: the code cache is written and read. The published negative was an artifact of the' +
        ' fixture — a module whose only exported function called nothing and folded to a constant,' +
        ' so one function of 8000 tiered up and --wasm-caching-threshold was never reached.',
    )
    lines.push(
      '  RESIDUAL SETTLED 2026-08-14: the governing variable is V8\'s quiescence window' +
        ' (--wasm-caching-timeout-ms), not module size, not function count, and not bytes of' +
        ' top-tier code. The quiet-default and quiet-disabled rows above are the same 250x250' +
        ' shape one Chromium argument apart: uncached at the default 2000 ms, cached at 0.',
    )
    lines.push('  Limitations of this reading, published rather than dropped:')
    lines.push('    - automation-driven Chromium with fresh temporary profiles; neither isolated as a factor')
    lines.push('    - a loopback http origin, not the https gateway a deployment would use')
    lines.push('    - WHY compilation fails to go quiet inside the window for these shapes is still open')
    lines.push('    - a synthetic module stands in for a translated artifact; it has no imports, no memory and no WASI')
    lines.push('    - the heat loop is the harness calling run() in a tight loop, not a workload anything would run')
    process.stdout.write(`${lines.join('\n')}\n`)

    for (const reading of [
      ...straightReadings,
      ...hotPlatformReadings,
      ...hotLoaderReadings,
      ...quietDefaultReadings,
      ...quietDisabledReadings,
    ]) {
      expect(reading.wasmCacheBytes, 'Code Cache/wasm was never created — nothing was observed').toBeGreaterThanOrEqual(0)
    }
  })
})
