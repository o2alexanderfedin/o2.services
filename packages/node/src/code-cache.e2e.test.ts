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
import { syntheticArtifact } from '../../browser/src/synthetic-artifact.ts'

/**
 * AOT-05, criterion 4 — does a second visit hit V8's code cache?
 *
 * The criterion asks for a *measurement*, and a measurement can come back negative.
 * This one does. What follows is the apparatus and the result, written so that the
 * negative is checkable rather than asserted.
 *
 * ## Why it cannot be done in the browser test
 *
 * V8's WebAssembly code cache is populated asynchronously, after top-tier
 * compilation, and read back on a *subsequent load of the same URL*. Nothing inside
 * a single page can observe it: a second `compileStreaming` of the same URL in the
 * same document is faster for at least four reasons that are not the code cache
 * (`CACHE_CONFOUNDS` in `streaming-load.ts` lists them). So the observation has to
 * be made from outside the browser, across page loads, in one profile — which means
 * Playwright, which means an e2e.
 *
 * ## What is observed, and why it is trustworthy
 *
 * Two independent observations, neither of which is a timing:
 *
 * 1. **The profile's `Default/Code Cache/wasm` directory.** Chromium's code cache is
 *    a real on-disk store. If a compiled module were serialised, megabytes would
 *    appear there.
 * 2. **Chromium's own trace events.** `v8.wasm.moduleCacheHit`,
 *    `v8.wasm.cachedModule`, `v8.wasm.moduleCacheInvalid` and
 *    `v8.wasm.moduleCacheInvalidDigest` are present as string literals in the
 *    Chromium binary this test drives, so their absence from a trace is evidence
 *    rather than a guess about naming.
 *
 * Both are negatives, and a negative from an instrument nobody has calibrated is
 * worthless. So the test carries a **positive control**: the sibling directory,
 * `Default/Code Cache/js`, filled by the JavaScript this same page loads from this
 * same origin over these same visits. It goes from roughly 8 KB after the first
 * visit to over a megabyte by the second, and the test asserts that growth. Two
 * directories, one profile, one set of page loads: one fills and the other does not.
 * That is what turns "we saw no WASM code cache" into a finding rather than a broken
 * harness.
 *
 * The control is deliberately described as *the page's JavaScript* rather than as a
 * particular file. An earlier version served a 600 KB module with long cache headers
 * and called that the control; re-serving it with `Cache-Control: no-store` was then
 * expected to collapse the number and did not — the figure is dominated by the
 * modules Vite serves, and the claim that the header mattered was wrong. The
 * calibration that survives is the weaker and true one: this profile's JS code cache
 * fills while its WASM code cache does not.
 *
 * That calibration was then checked against a deliberately disabled cache. Relaunched
 * with Chromium's `--v8-cache-options=none`, `Code Cache/js` reads **72 bytes** —
 * exactly what `Code Cache/wasm` reads on every ordinary run. So 72 bytes is the
 * measured signature of "no code cache was written", produced on purpose on the side
 * that normally works, and it is the number the WASM side returns every time. The
 * negative below is therefore a reading, not an absence of one.
 *
 * ## The result
 *
 * No WASM code-cache entry was ever produced, on any configuration tried:
 *
 * | module size | visits | `Code Cache/wasm` |
 * |---|---|---|
 * | 220 KB | 2 | 72 B (index only) |
 * | 1.1 MB | 2 | 72 B |
 * | 4.8 MB | 3 | 72 B |
 * | 10.8 MB | 3, incl. browser restart, headed and headless | 72 B |
 *
 * all with `Content-Type: application/wasm`, `Cache-Control: public, max-age=…`, a
 * query-free same-origin URL, `compileStreaming`, and the module executed millions
 * of times first so that `wasm.TopTierCompilation` appears in the trace — because
 * blink serialises top-tier code, and a module that is never called never tiers up.
 * In the same profile and the same runs, the JavaScript code cache grew past half a
 * megabyte — **2,078,297 bytes** on the 4.8 MB run recorded in
 * `.planning/phases/phase-10-elfconv-aot/10-VERIFICATION.md`, against 8,545 bytes
 * after the first visit — and was consumed on later visits.
 *
 * The assertion below floors that at 500,000 rather than pinning 2,078,297, because
 * the figure is dominated by whatever modules Vite happens to serve and would drift
 * with an unrelated dependency change. The floor is what the finding needs: the JS
 * side is three orders of magnitude above the 72 bytes the WASM side returns, and no
 * plausible drift closes that gap.
 *
 * So: the four preconditions this project builds around are **necessary**. That they
 * are **sufficient** is not established, and on this platform, this Chromium, and
 * this transport they were demonstrably not sufficient. The honest statement of
 * criterion 4 is that the load path is correct and the cache hit is unobserved.
 *
 * ## What this does not say
 *
 * It does not say Chrome never caches WebAssembly. It says this harness never saw it
 * — automation-driven Chromium, a fresh temporary profile, a loopback origin. Any of
 * those could be the reason, and none of them was isolated. It also cannot say
 * whether `Response.clone()` in the loader would preserve or destroy a cache hit,
 * because no entry was ever produced for a second visit to consume. That question
 * stays open and is the first thing to re-check if the table above ever changes.
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
 */
const RAW_ARM = syntheticArtifact({ functions: 8000, opsPerFunction: 200 })
const LOADER_ARM = syntheticArtifact({ functions: 8001, opsPerFunction: 200 })

/** Multicodec `raw` — a single block of bytes, which is what an artifact is. */
const RAW_CODE = 0x55

/**
 * Bulk JavaScript for the page to load, so the control side of the comparison has
 * something substantial in it even if Vite's own output shrinks.
 *
 * Not *the* control on its own — see the module comment. The measured figure covers
 * every script this origin serves.
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
  readonly detail: string
}

declare global {
  interface Window {
    probeReady: boolean
    controlLoaded: boolean
    /** The platform API, unmediated — the control for the loader arm. */
    armRaw: (url: string) => Promise<ArmResult>
    /** The shipped `loadArtifact`, imported into the page by Vite. */
    armLoader: (base: string, cid: string) => Promise<ArmResult>
  }
}

interface VisitReading {
  readonly visit: number
  readonly raw: ArmResult
  readonly loader: ArmResult
  readonly wasmCacheBytes: number
  readonly jsCacheBytes: number
  readonly cacheTraceEvents: readonly string[]
  readonly artifactRequests: number
}

/**
 * Trace event names this Chromium emits around the WASM code cache.
 *
 * Taken from the binary itself rather than from memory of the Blink source: all four
 * appear as string literals in the framework this test drives, so looking for them
 * and finding nothing is a measurement.
 */
const CACHE_TRACE_NAMES = [
  'v8.wasm.moduleCacheHit',
  'v8.wasm.cachedModule',
  'v8.wasm.moduleCacheInvalid',
  'v8.wasm.moduleCacheInvalidDigest',
]

let server: ViteDevServer
let baseUrl: string
let context: BrowserContext
let profile: string
let rawCid: string
let loaderCid: string
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

const codeCacheDir = (kind: 'js' | 'wasm'): string => join(profile, 'Default', 'Code Cache', kind)

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

/** Force top-tier compilation: blink serialises tiered-up code, nothing else. */
function heat(module) {
  const instance = new WebAssembly.Instance(module, {})
  let acc = 0
  for (let i = 0; i < 3_000_000; i++) acc = (acc + instance.exports.run()) | 0
  return acc
}

window.armRaw = async (url) => {
  try {
    const started = performance.now()
    const module = await WebAssembly.compileStreaming(fetch(url))
    const compileMs = performance.now() - started
    const response = await fetch(url)
    const bytes = (await response.arrayBuffer()).byteLength
    heat(module)
    return { ok: true, bytes, compileMs, detail: 'compileStreaming' }
  } catch (cause) {
    return { ok: false, bytes: 0, compileMs: 0, detail: String(cause) }
  }
}

window.armLoader = async (base, cid) => {
  const result = await loadArtifact({ gatewayBase: base, cid: CID.parse(cid) })
  if (!result.ok) return { ok: false, bytes: 0, compileMs: 0, detail: JSON.stringify(result.failure) }
  heat(result.artifact.module)
  return {
    ok: true,
    bytes: result.artifact.bytes,
    compileMs: result.artifact.compileMs,
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

beforeAll(async () => {
  rawCid = CID.create(1, RAW_CODE, await sha256.digest(RAW_ARM)).toString()
  loaderCid = CID.create(1, RAW_CODE, await sha256.digest(LOADER_ARM)).toString()

  server = await createServer({
    root: ROOT,
    logLevel: 'error',
    server: { port: 0 },
    plugins: [
      {
        name: 'o2-code-cache-fixtures',
        configureServer(dev) {
          dev.middlewares.use((request, response, next) => {
            const path = (request.url ?? '/').split('?')[0] ?? '/'

            if (path.startsWith('/artifact/')) {
              const wanted = path.slice('/artifact/'.length)
              const bytes = wanted === rawCid ? RAW_ARM : wanted === loaderCid ? LOADER_ARM : null
              if (bytes === null) {
                response.writeHead(404).end('no such artifact')
                return
              }
              artifactRequests += 1
              // The four preconditions, on the wire: the right type, a cacheable
              // response, and a URL that is the CID and nothing else.
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

  // A persistent profile, because a code cache that lives only in memory would make
  // the "second visit" arm meaningless before it started.
  profile = await mkdtemp(join(tmpdir(), 'o2-code-cache-'))
  context = await chromium.launchPersistentContext(profile, { headless: true })
}, 300_000)

afterAll(async () => {
  await context?.close().catch(() => {})
  await server?.close().catch(() => {})
  await rm(profile, { recursive: true, force: true }).catch(() => {})
}, 120_000)

/** One page load: both arms, the control, the disk, and the trace. */
async function visit(index: number, settleMs: number): Promise<VisitReading> {
  const page = await context.newPage()
  // A silent page failure here is indistinguishable from a timeout, and a timeout
  // in a cache measurement looks like a cache miss.
  page.on('pageerror', (error) => process.stderr.write(`[probe] page error: ${error.message}\n`))
  page.on('console', (message) => {
    if (message.type() === 'error') process.stderr.write(`[probe] console: ${message.text()}\n`)
  })
  const session = await context.newCDPSession(page)
  const traced: string[] = []
  session.on('Tracing.dataCollected', (payload) => {
    for (const event of payload.value) if (typeof event['name'] === 'string') traced.push(event['name'])
  })
  await session.send('Tracing.start', {
    traceConfig: { includedCategories: ['v8', 'v8.wasm', 'disabled-by-default-v8.wasm'] },
    transferMode: 'ReportEvents',
  })

  const before = artifactRequests
  await page.goto(`${baseUrl}/code-cache-probe`)
  await page.waitForFunction(() => window.probeReady === true, null, { timeout: 60_000 })

  const raw = await page.evaluate((url) => window.armRaw(url), `${baseUrl}/artifact/${rawCid}`)
  const loader = await page.evaluate(
    (args) => window.armLoader(args.base, args.cid),
    { base: `${baseUrl}/artifact/`, cid: loaderCid },
  )
  await page.waitForFunction(() => window.controlLoaded === true, null, { timeout: 60_000 })

  // Blink writes the cache on a timer once top-tier compilation has produced
  // something worth serialising. Closing the page early would be a way to observe
  // nothing for a reason that has nothing to do with caching.
  await page.waitForTimeout(settleMs)

  const finished = new Promise<void>((resolve) => session.once('Tracing.tracingComplete', () => resolve()))
  await session.send('Tracing.end')
  await finished
  await page.close()

  return {
    visit: index,
    raw,
    loader,
    wasmCacheBytes: await dirBytes(codeCacheDir('wasm')),
    jsCacheBytes: await dirBytes(codeCacheDir('js')),
    cacheTraceEvents: CACHE_TRACE_NAMES.filter((name) => traced.includes(name)),
    artifactRequests: artifactRequests - before,
  }
}

const readings: VisitReading[] = []

describe('AOT-05 — a translated artifact loads over a stable content-addressed URL', () => {
  it('completes three visits with both the platform API and the shipped loader', async () => {
    // The first visit gets the long settle: it is the only one that could produce a
    // cache entry, and a short wait would confuse "not written" with "not yet".
    readings.push(await visit(1, 25_000))
    readings.push(await visit(2, 10_000))
    readings.push(await visit(3, 10_000))

    for (const reading of readings) {
      expect(reading.raw.ok, `visit ${reading.visit} raw arm: ${reading.raw.detail}`).toBe(true)
      expect(reading.loader.ok, `visit ${reading.visit} loader arm: ${reading.loader.detail}`).toBe(true)
    }
  }, 600_000)

  it('serves both arms over the ~4.8 MB the caching threshold requires', () => {
    const first = readings[0]
    expect(first).toBeDefined()
    if (first === undefined) return
    // Both arms must clear 128 KB or the measurement is of a module V8 would never
    // have cached anyway — which is exactly the trap the demo kernel sets.
    expect(first.raw.bytes).toBeGreaterThan(128 * 1024)
    expect(first.loader.bytes).toBeGreaterThan(128 * 1024)
    // The shipped loader agrees the module is eligible.
    expect(first.loader.detail).toBe('eligible')
  })

  it('addresses the artifact by CID alone, with nothing in the URL that could bust a cache', () => {
    // The cache key is the URL. This is the one precondition that is a property of
    // this repository's code rather than of the platform, so it is asserted here as
    // well as in the browser test.
    const url = `${baseUrl}/artifact/${rawCid}`
    expect(url).not.toContain('?')
    expect(url).not.toContain('#')
    expect(url.endsWith(rawCid)).toBe(true)
  })

  it('serves the artifact from the HTTP cache on later visits, which is not the code cache', () => {
    // Distinguishing the two is the whole reason this test looks at disk rather than
    // at a stopwatch: a repeat visit is faster because the bytes never crossed a
    // socket, and that improvement is real, cheap, and not what criterion 4 asks for.
    expect(readings[0]?.artifactRequests).toBe(2) // one per arm
    expect(readings[1]?.artifactRequests).toBe(0)
    expect(readings[2]?.artifactRequests).toBe(0)
  })
})

describe('AOT-05 — the code-cache observation, and its positive control', () => {
  it('sees Chromium fill the JavaScript code cache in the same profile, so a null WASM reading means something', () => {
    // The calibration, and the reason the negative below is worth anything. Same
    // profile, same origin, same visits, sibling directory — one fills, one does not.
    // Without this, "no WASM code cache" would be indistinguishable from "this
    // harness cannot see a code cache".
    const first = readings[0]
    const last = readings[readings.length - 1]
    expect(first).toBeDefined()
    expect(last).toBeDefined()
    if (first === undefined || last === undefined) return

    // Growth *during* these visits, not a number that was already there. A static
    // total could have come from anywhere, including Chromium's own pages.
    expect(last.jsCacheBytes).toBeGreaterThan(500_000)
    expect(last.jsCacheBytes).toBeGreaterThan(first.jsCacheBytes)

    // And the two directories are genuinely read apart. If this ever failed, the
    // comparison the whole finding rests on would be one number against itself.
    expect(last.wasmCacheBytes).toBeLessThan(last.jsCacheBytes)
  })

  it('reports what was seen for WebAssembly without asserting a hit that was not observed', () => {
    // Deliberately not `expect(wasmCacheBytes).toBe(72)`. Asserting the negative
    // would turn a future Chromium that starts caching into a red build, and the
    // point of this test is to find out, not to freeze today's answer.
    const lines: string[] = []
    lines.push('AOT-05 criterion 4 — V8 WebAssembly code cache across visits')
    lines.push(`  origin ${baseUrl}, persistent profile, ${readings.length} visits`)
    lines.push('  | visit | raw compile | loader compile | Code Cache/wasm | Code Cache/js | cache trace events |')
    for (const reading of readings) {
      lines.push(
        `  | ${reading.visit} | ${reading.raw.compileMs.toFixed(1)}ms | ${reading.loader.compileMs.toFixed(1)}ms | ` +
          `${reading.wasmCacheBytes}B | ${reading.jsCacheBytes}B | ` +
          `${reading.cacheTraceEvents.length === 0 ? 'none' : reading.cacheTraceEvents.join(', ')} |`,
      )
    }

    const anyWasmCache = readings.some((reading) => reading.wasmCacheBytes > 4096)
    const anyTrace = readings.some((reading) => reading.cacheTraceEvents.length > 0)
    lines.push(
      anyWasmCache || anyTrace
        ? '  OBSERVED: a WASM code-cache entry appeared. Criterion 4 is met — and the' +
            ' loader arm must now be compared against the raw arm, because Response.clone()' +
            ' could preserve or destroy the cached-metadata handler and that has never been tested.'
        : '  NOT OBSERVED: no WASM code-cache entry was produced on any visit, at ~4.8 MB,' +
            ' with application/wasm, a cacheable response, a query-free CID URL, compileStreaming,' +
            ' and the module executed hot enough to tier up.',
    )
    lines.push(
      '  Calibration: relaunched with --v8-cache-options=none, Code Cache/js reads 72B —' +
        ' the same number Code Cache/wasm reads on every ordinary run. 72B is what a' +
        ' disabled code cache looks like on this platform.',
    )
    lines.push('  Limitations of this reading, published rather than dropped:')
    lines.push('    - automation-driven Chromium with a fresh temporary profile; neither was isolated as a cause')
    lines.push('    - a loopback http origin, not the https gateway a deployment would use')
    lines.push('    - compile timings fall across visits because of the HTTP cache and a warm JIT, not the code cache')
    lines.push('    - whether Response.clone() preserves a cache hit is unknown: no entry was ever produced to consume')
    lines.push('    - a synthetic module stands in for a translated artifact; it has no imports, no memory and no WASI')
    process.stdout.write(`${lines.join('\n')}\n`)

    // What *is* asserted: that the observation was actually made. A reading of -1
    // means the directory was never created, which would mean this test measured
    // nothing at all and quietly passed.
    for (const reading of readings) {
      expect(reading.wasmCacheBytes, 'Code Cache/wasm was never created — nothing was observed').toBeGreaterThanOrEqual(0)
    }
  })
})
