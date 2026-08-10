import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { readFile } from 'node:fs/promises'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import type { Browser } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FabricNode } from './fabric-node.ts'

/**
 * The *built* bundle, served by a dumb static file server.
 *
 * Everything else exercises the Vite dev server, which resolves modules on the fly
 * and forgives a great deal. A static host does neither — it hands over the files it
 * has and nothing more. That is what GitHub Pages is, so it is what the artifact has
 * to be tested against before being published.
 *
 * Two behaviours matter here and are not covered anywhere else:
 *
 *   1. With no relay to be found, the page must *say so* rather than appear broken.
 *      A public URL that silently fails is worse than no public URL.
 *   2. With `?relay=<multiaddr>`, the page must discover it from the link, because a
 *      static host has no `/bootstrap.json` to serve.
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const DIST = join(ROOT, 'packages', 'browser', 'dist')

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
}

let server: Server
let baseUrl: string
let browser: Browser
let relay: FabricNode
let workdir: string

beforeAll(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'o2-dist-'))

  // Build here rather than assuming a previous build is current — the test must fail
  // when the *sources* break the bundle, not when someone forgot to rebuild.
  execFileSync('npx', ['vite', 'build', '--config', 'packages/browser/vite.config.ts'], {
    cwd: ROOT,
    stdio: 'pipe',
  })

  // A deliberately dumb server: no module resolution, no transforms, no fallbacks.
  server = createServer((request, response) => {
    const path = (request.url ?? '/').split('?')[0] ?? '/'
    const file = join(DIST, normalize(path === '/' ? '/index.html' : path))
    if (!file.startsWith(DIST)) {
      response.writeHead(403).end()
      return
    }
    readFile(file).then(
      (bytes) => {
        response.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' })
        response.end(bytes)
      },
      () => {
        // Exactly what a static host does for /bootstrap.json.
        response.writeHead(404).end('not found')
      },
    )
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no server port')
  baseUrl = `http://127.0.0.1:${address.port}`

  // DET-03: this node relays and executes nothing — the built bundle is the subject,
  // not provenance. See `background-tab.e2e.test.ts` for the full note on why stating
  // the opt-out is the point of the field being required.
  relay = await FabricNode.start({
    relayAdmission: 'admits-any-peer',
    startReporting: 'reports-its-own-start',
    maxReservations: 8,
    listen: ['/ip4/127.0.0.1/tcp/0/ws'],
    trustAnchors: 'runs-unsigned-artifacts',
  })
  browser = await chromium.launch()
}, 300_000)

afterAll(async () => {
  await browser?.close().catch(() => {})
  await relay?.stop().catch(() => {})
  await new Promise<void>((resolve) => server?.close(() => resolve()))
  await rm(workdir, { recursive: true, force: true })
}, 120_000)

/**
 * The gate, observed from outside the page.
 *
 * `page.on('request')` sees every network request the tab makes, including ones the
 * page swallows. That is the only way to check the claim that actually matters:
 * not "we did not compute" but "we did not tell anybody you were here".
 */
async function consent(page: import('playwright').Page): Promise<void> {
  await page.waitForFunction(() => document.getElementById('gate')?.hasAttribute('hidden') === false, null, {
    timeout: 30_000,
  })
  await page.click('#allow')
  await page.waitForFunction(() => document.getElementById('main')?.hasAttribute('hidden') === false, null, {
    timeout: 30_000,
  })
}

describe('BROW-01 — nothing runs, and nothing is contacted, before consent', () => {
  it('makes no request of its own beyond loading itself', async () => {
    const page = await browser.newPage()
    const requested: string[] = []
    page.on('request', (request) => requested.push(request.url()))

    await page.goto(baseUrl)
    await page.waitForFunction(() => typeof window.o2 !== 'undefined', null, { timeout: 60_000 })
    // Long enough that a discovery fetch on load would have happened by now.
    await page.waitForTimeout(1_500)

    // The page's own assets are fetched by the browser to render it at all. What
    // must be absent is anything the *node* would do: asking the origin for a
    // relay, or dialling one.
    expect(requested.filter((url) => url.includes('bootstrap.json'))).toEqual([])
    expect(requested.filter((url) => url.startsWith('ws'))).toEqual([])

    // And the gate is what is on screen, with the rest of the page not merely
    // hidden but never having run.
    // Visibility, not the attribute. An id rule that sets `display` outranks the
    // browser's own `[hidden]`, so the attribute can be correct while the element
    // is on screen — which is how an "always-visible" bar came to be visible while
    // idle, reported from a phone rather than caught here.
    expect(await page.isVisible('#gate')).toBe(true)
    expect(await page.isVisible('#main')).toBe(false)
    expect(await page.isVisible('#bar')).toBe(false)

    await page.close()
  }, 180_000)

  /**
   * P10, UI-SPEC section 9 — and the shape of it is the point, not the assertion.
   *
   * The case immediately above collects every request and then asserts on **two filtered
   * slices** of the collection: `bootstrap.json` and anything starting `ws`. Those two
   * filters are exactly right about what the *node* would do and structurally blind to
   * everything else, because a filter can only refuse what it was told to look for.
   *
   * That blindness had a live subject. The mockup stylesheet this page's design was
   * ported from opens its second line with a font import from a Google host; porting the
   * file verbatim would have made the page fetch a font at load — before consent, from a
   * third party, on a page whose gate promises in writing that nobody learns a visitor is
   * present until they agree. Neither filter above would have seen it, and nothing else
   * in this suite looks at the request list at all.
   *
   * So this case asserts on the WHOLE SET: every request the page makes, from `goto`
   * until it is sitting at the gate, has the page's own origin. `about:`, `data:` and
   * `blob:` are excepted because they are not requests to anybody — they never leave the
   * process.
   *
   * The floor underneath it matters as much as the assertion: an empty request list
   * satisfies "no foreign origin" perfectly, so the collection is also required to
   * contain the page's own assets. A page that fetched nothing would be a broken
   * instrument reporting a clean result.
   */
  it('makes no request to any origin but its own, over the whole request set', async () => {
    const page = await browser.newPage()
    const requested: string[] = []
    page.on('request', (request) => requested.push(request.url()))

    await page.goto(baseUrl)
    await page.waitForFunction(() => typeof window.o2 !== 'undefined', null, { timeout: 60_000 })
    await page.waitForFunction(
      () => document.getElementById('gate')?.hasAttribute('hidden') === false,
      null,
      { timeout: 30_000 },
    )
    // Long enough that a font, an icon set, or a discovery fetch would have gone out.
    await page.waitForTimeout(1_500)

    // Before consent, and measured rather than assumed: this is the window the claim is
    // about, and a page that had already been consented to would be measuring nothing.
    expect(await page.isVisible('#gate')).toBe(true)
    expect(await page.isVisible('#main')).toBe(false)

    const origin = new URL(baseUrl).origin
    const inProcess = /^(?:about|data|blob):/
    const foreign = requested.filter((url) => {
      if (inProcess.test(url)) return false
      try {
        return new URL(url).origin !== origin
      } catch {
        // A URL this test cannot parse is a URL it cannot vouch for.
        return true
      }
    })
    expect(
      foreign,
      `P10: the page contacted ${String(foreign.length)} foreign origin(s) before consent — ` +
        `${[...new Set(foreign.map((url) => new URL(url).origin))].join(', ')}. Every request ` +
        `during load must have the page's own origin (${origin}); the gate promises in writing ` +
        'that nobody learns a visitor is present until they agree.',
    ).toEqual([])

    // The floor: the set is a real reading and not an empty list.
    const own = requested.filter((url) => url.startsWith(origin))
    expect(
      own.length,
      `P10: the request collector saw ${String(requested.length)} request(s) in total and ` +
        'none of them same-origin — the page did not load, so the clean result above is an ' +
        'artefact of the instrument rather than a property of the page',
    ).toBeGreaterThan(1)

    await page.close()
  }, 180_000)

  it('refuses to discover or start until consent is granted', async () => {
    const page = await browser.newPage()
    await page.goto(baseUrl)
    await page.waitForFunction(() => typeof window.o2 !== 'undefined', null, { timeout: 60_000 })

    // There is no test-only bypass: the API refuses for the same reason the button
    // is not there yet.
    const refusal = await page.evaluate(async () =>
      window.o2.discoverRelays().then(
        () => 'discovered',
        (error: unknown) => (error instanceof Error ? error.message : String(error)),
      ),
    )
    expect(refusal).toContain('no consent')
    expect(await page.evaluate(() => window.o2.consentState().granted)).toBe(false)
    expect(await page.evaluate(() => window.o2.activity())).toBeNull()

    await page.close()
  }, 180_000)

  it('shows the disclosed terms, with the report unticked', async () => {
    const page = await browser.newPage()
    await page.goto(baseUrl)
    await page.waitForFunction(() => typeof window.o2 !== 'undefined', null, { timeout: 60_000 })
    await page.waitForFunction(() => document.getElementById('gate-headline')?.textContent !== '', null, {
      timeout: 30_000,
    })

    const terms = (await page.textContent('#gate-terms')) ?? ''
    expect(terms.toLowerCase()).toContain('what would run')
    expect(terms.toLowerCase()).toContain('how do i stop it')
    // A pre-ticked box is the dark pattern this phase exists to avoid.
    expect(await page.isChecked('#reporting')).toBe(false)
    // Declining is a control, not an absence.
    expect(await page.isVisible('#decline')).toBe(true)

    await page.close()
  }, 180_000)

  it('starts nothing when the visitor declines', async () => {
    const page = await browser.newPage()
    const requested: string[] = []
    page.on('request', (request) => requested.push(request.url()))

    await page.goto(baseUrl)
    await page.waitForFunction(() => typeof window.o2 !== 'undefined', null, { timeout: 60_000 })
    await page.click('#decline')
    await page.waitForTimeout(1_000)

    expect(requested.filter((url) => url.includes('bootstrap.json'))).toEqual([])
    expect(await page.isDisabled('#join')).toBe(true)
    expect(await page.evaluate(() => window.o2.activity())).toBeNull()

    await page.close()
  }, 180_000)
})

describe('the built bundle on a static host', () => {
  /**
   * The `./perf/index.html` link the footer and the Benchmarks surface both render.
   *
   * Until Plan 27-09 the footer read `./perf/` and the bundle held no `perf/` directory at
   * all — UI-SPEC section 10 records the gap and leaves the packaging to the plan. The fix
   * is one committed source (`docs/perf/prime-and-pi-benchmarks.html`, written by
   * `docs/perf/build-report.py`) emitted into the bundle by a plugin in
   * `packages/browser/vite.config.ts`, with the build failing if that source is absent.
   *
   * **The body check names a section heading rather than a figure, deliberately.** P9 in
   * `demo-bench.e2e.test.ts` is the property about figures, and it reads the committed
   * markdown to hold it. A figure asserted here as well would be a second, weaker copy of
   * that property — weaker because this file has no document to compare against and would
   * be asserting a number against a literal typed into a spec.
   */
  it('serves ./perf/index.html — the committed report, emitted into the bundle', async () => {
    const emitted = join(DIST, 'perf', 'index.html')
    const bytes = await readFile(emitted, 'utf8').catch(() => null)
    expect(
      bytes,
      `${emitted} is not in the bundle: the footer and the Benchmarks surface both link ` +
        './perf/index.html, and a link that resolves nowhere is the state this case exists ' +
        'to keep closed',
    ).not.toBeNull()
    expect((bytes ?? '').length).toBeGreaterThan(1_000)

    // And the static host actually hands it over, at the URL the page links. The server
    // above does no directory-index resolution — which is why the link names the file.
    const page = await browser.newPage()
    const response = await page.goto(`${baseUrl}/perf/index.html`)
    expect(response?.status(), 'GET /perf/index.html on the built bundle').toBe(200)
    const body = (await page.content()) ?? ''
    expect(body).toContain('Real parallel speedup')
    expect(body).toContain('Fabric overhead')

    // One source, not two: what the bundle serves is byte-identical to what is committed.
    const committed = await readFile(join(ROOT, 'docs', 'perf', 'prime-and-pi-benchmarks.html'), 'utf8')
    expect(
      bytes,
      'the emitted report differs from the committed one — there are now two copies, and ' +
        'docs/perf/build-report.py writes only one of them',
    ).toBe(committed)

    await page.close()
  }, 180_000)

  it('loads and runs with no module server behind it', async () => {
    const page = await browser.newPage()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))

    await page.goto(baseUrl)
    await page.waitForFunction(() => typeof window.o2 !== 'undefined', null, { timeout: 60_000 })

    // A bundling failure shows up here and nowhere else — the dev server would have
    // papered over it.
    expect(errors).toEqual([])
    await page.close()
  }, 180_000)

  it('reports that no relay is reachable, instead of looking broken', async () => {
    const page = await browser.newPage()
    await page.goto(baseUrl)
    await page.waitForFunction(() => typeof window.o2 !== 'undefined', null, { timeout: 60_000 })
    await consent(page)

    // /bootstrap.json 404s, as it will on any static host.
    const discovery = await page.evaluate(async () => window.o2.discoverRelays())
    expect(discovery.source).toBe('none')
    expect(discovery.relayAddrs).toEqual([])

    // And the page says so, in those words, with the Start button unavailable.
    await page.waitForFunction(
      () => document.getElementById('state')?.dataset['tone'] === 'blocked',
      null,
      { timeout: 30_000 },
    )
    expect(await page.textContent('#state')).toContain('no relay')
    expect(await page.isDisabled('#join')).toBe(true)
    // The explanation names the thing a visitor would need to do next.
    expect(await page.textContent('#explain')).toContain('?relay=')

    await page.close()
  }, 180_000)

  it('takes a relay from ?relay= and joins with it', async () => {
    const relayAddr = relay.browserDialableAddrs[0]!
    const page = await browser.newPage()
    await page.goto(`${baseUrl}/?relay=${encodeURIComponent(relayAddr)}`)
    await page.waitForFunction(() => typeof window.o2 !== 'undefined', null, { timeout: 60_000 })
    await consent(page)

    const discovery = await page.evaluate(async () => window.o2.discoverRelays())
    expect(discovery.source).toBe('query')
    expect(discovery.relayAddrs).toEqual([relayAddr])

    // The button is offered, and pressing it produces a real reservation.
    await page.waitForFunction(() => document.getElementById('join')?.hasAttribute('disabled') === false, null, {
      timeout: 30_000,
    })
    await page.click('#join')
    await page.waitForFunction(
      () => document.getElementById('state')?.dataset['tone'] === 'live',
      null,
      { timeout: 90_000 },
    )

    expect(await page.textContent('#state')).toContain('node running')
    expect(relay.capacity.granted).toBeGreaterThanOrEqual(1)

    // BROW-04: the always-visible bar appears with the node and says what it is doing.
    await page.waitForSelector('#bar', { state: 'visible', timeout: 30_000 })
    expect(await page.textContent('#bar-stats')).toContain('of one thread')

    // SCHED-06: and the thread it is doing it on is a real one, emitted by *this*
    // build.
    //
    // What stood here were two assertions on `offMainThread`, which became a constant
    // `true` the moment `createWorker` was made required — reading a literal and
    // reporting it as a measurement. They are gone, but deleting them bare would have
    // left this file with nothing touching the worker at all, and that matters more
    // now than it did: a mis-emitted worker used to degrade quietly to main-thread
    // compute, and now kills compute outright, because the fallback that used to
    // absorb it has been deleted.
    //
    // This is the only place that risk can be seen. `colouring-demo.e2e.test.ts`
    // asserts `tasksExecuted > 0`, but it runs against the Vite **dev** server; this
    // file is the one that runs `vite build` and serves `dist/`. Whether the production
    // bundle's `?worker` import survives bundling was, until this line, asserted
    // nowhere.
    //
    // One cube at redundancy 1 with no peers: `runColouring` composes
    // `executors = [node.executor]` alone, so the whole job runs on this tab's own
    // worker and needs no second party. `n` is small because the answer does not
    // matter here — that a task crossed a thread boundary and came back does.
    const executed = await page.evaluate(async () => {
      await window.o2.runColouring({ n: 12, cubes: 1, redundancy: 1, peerIds: [] })
      return window.o2.activity()?.tasksExecuted ?? 0
    })
    expect(executed).toBeGreaterThan(0)

    // And Stop empties it: the thread ends and the connections close.
    await page.click('#stop')
    await page.waitForSelector('#bar', { state: 'hidden', timeout: 30_000 })
    expect(await page.evaluate(() => window.o2.activity())).toBeNull()

    await page.close()
  }, 240_000)
})
