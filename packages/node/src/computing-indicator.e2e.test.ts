import { fileURLToPath } from 'node:url'
import { chromium, firefox, webkit } from 'playwright'
import type { Browser, BrowserType, Page } from 'playwright'
import { createServer } from 'vite'
import type { ViteDevServer } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { KERNEL_TRUST_ANCHOR } from '@o2/demo'
import { fixtureViteCacheDir, launchFixtureBrowser } from './e2e-browser-launch.ts'
import { signInHarnessTab } from './e2e-signin.ts'
import { FabricNode } from './fabric-node.ts'

/**
 * BROW-07 — the tab strip says this machine is working, read from outside the page.
 *
 * ## Where the harness is standing, and why that is the whole design
 *
 * `page.title()` is a Playwright call, answered by the browser rather than by the page's own
 * script. It is the same string the browser renders in the tab strip, so a harness reading it
 * is standing where a visitor looking at another tab is standing. Every reading below is
 * taken from there and none from inside the document.
 *
 * The indicator lives in `document.title` because criterion 2 rules the page body out in its
 * own sentence — *"Page-body content alone is watched failing the criterion, because a
 * backgrounded tab shows none of it"* — and because of a constraint recorded in
 * `background-tab.e2e.test.ts:16-42`: **Chromium under automation never reports a page as
 * hidden**, so any indicator conditioned on `document.hidden` or `visibilityState` could not
 * be tested in this harness at all. The decoration is therefore unconditional, which is the
 * requirement rather than a shortcut.
 *
 * ## What this proves, and what it does not
 *
 * It proves the title carries the indicator **while this page is not the front page of its
 * context** — two pages in one `BrowserContext`, the second brought to the front, which is
 * what `background-tab.e2e.test.ts` records as the arrangement that actually hides the first.
 * It proves the title returns to the page's own when the work drains, so the indicator is not
 * a constant.
 *
 * It does **not** prove that an operating system's window manager painted those characters in
 * a tab strip. Nothing in an automated harness can prove that, and no assertion here should be
 * read as claiming it.
 *
 * ## Three engines, because criterion 2 names them
 *
 * Criterion 2 is the only one in Phase 35 that carries an engine requirement — *"verified with
 * the tab backgrounded in the three engines this project's Playwright harness already
 * drives"*. The `ENGINES` table below is `gated-seed.e2e.test.ts:127-131`'s.
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const PAGE = 'packages/browser/demo/index.html'

/** The engines the browser-tier standard names, in the order they are launched. */
const ENGINES: readonly { readonly name: string; readonly type: BrowserType }[] = [
  { name: 'chromium', type: chromium },
  { name: 'firefox', type: firefox },
  { name: 'webkit', type: webkit },
]

/**
 * The decoration, written out here rather than imported.
 *
 * `@o2/browser`'s barrel does not export `computing-indicator.ts` — that module's header says
 * why — and a harness importing it by relative path across package boundaries would be
 * asserting the constant against itself. A literal is the independent side of the comparison:
 * if somebody changes the prefix, this file goes red and says so, which is the point.
 */
const COMPUTING_PREFIX = '● Computing — '

/** The page's own title, from `demo/index.html`. Also written out, for the same reason. */
const BASE_TITLE = 'o2.services — node'

/**
 * A workload with enough shards to keep the executor occupied for seconds rather than
 * milliseconds.
 *
 * `colouring-demo.e2e.test.ts` uses `N = 204 / CUBES = 8` and describes it as settling *"in
 * milliseconds"*, which is the wrong shape for an indicator: an instrument that has to catch
 * a state cannot be pointed at a state that lasts less than one of its ticks. More cubes, not
 * a bigger N — the shards are dispatched concurrently, so cube count is what raises the
 * in-flight count and keeps it raised.
 */
const N = 204
const CUBES = 64

/** How long the harness will wait for the title to change, either way. */
const TITLE_DEADLINE_MS = 60_000

let relay: FabricNode
let relayAddr: string
let server: ViteDevServer
let baseUrl: string
const browsers: Browser[] = []

beforeAll(async () => {
  // DET-03: this node relays and executes nothing, so its anchor set covers nothing here.
  // The demo's own committed key rather than the provenance opt-out, and the reason is a
  // guard rather than taste: `trust-anchors.node.test.ts` bounds how far that literal may
  // spread through the test suite, and this file has no decision to record with it — it is
  // `colouring-demo.e2e.test.ts`'s choice, made for realism, since this is the value a
  // visitor's tab and `bin/seed.ts` both pin with no flags.
  relay = await FabricNode.start({
    relayAdmission: 'admits-any-peer',
    startReporting: 'reports-its-own-start',
    maxReservations: 16,
    listen: ['/ip4/127.0.0.1/tcp/0/ws'],
    trustAnchors: [KERNEL_TRUST_ANCHOR],
  })
  const address = relay.browserDialableAddrs[0]
  if (address === undefined) throw new Error('relay produced no browser-dialable address')
  relayAddr = address

  server = await createServer({ root: ROOT, logLevel: 'error', server: { port: 0 }, cacheDir: fixtureViteCacheDir(ROOT) })
  await server.listen()
  const url = server.resolvedUrls?.local[0]
  if (url === undefined) throw new Error('vite dev server produced no URL')
  baseUrl = url.endsWith('/') ? url : `${url}/`
}, 240_000)

afterAll(async () => {
  for (const browser of browsers) await browser.close().catch(() => {})
  await server?.close().catch(() => {})
  await relay?.stop().catch(() => {})
}, 180_000)

/**
 * Poll `page.title()` from the harness until it satisfies `wanted`, or give up.
 *
 * Returns the last title seen either way, so a failing assertion can print what the tab strip
 * actually said rather than only that it was wrong.
 */
async function waitForTitle(
  page: Page,
  wanted: (title: string) => boolean,
  deadlineMs: number,
): Promise<string> {
  const deadline = Date.now() + deadlineMs
  let last = await page.title()
  while (!wanted(last) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100))
    last = await page.title()
  }
  return last
}

describe.each(ENGINES)('BROW-07 in $name', ({ name, type }) => {
  it('carries the indicator in the tab title while a second page is in front, and drops it when the work drains', async () => {
    const browser = await launchFixtureBrowser(type)
    browsers.push(browser)
    // One context, two pages: separate contexts are separate windows and both stay visible.
    // `background-tab.e2e.test.ts` records that arrangement and the reason.
    const context = await browser.newContext()
    const worker = await context.newPage()
    await worker.goto(`${baseUrl}${PAGE}`)
    await worker.waitForFunction(() => typeof window.o2 !== 'undefined', null, { timeout: 60_000 })

    // The starting state is a reading, not a setup step: an indicator that was already there
    // would make everything below vacuous.
    expect(await worker.title()).toBe(BASE_TITLE)

    // BROW-01 has no test-only bypass: a harness consents for the same reason a visitor
    // clicks the button. AUTH-06, `42-06`: it signs in for the same reason too, because
    // `window.o2.start` refuses with `SignedOutError` until somebody has opened their own
    // envelope. `signInHarnessTab` does both, in the order its header explains.
    await signInHarnessTab(worker)
    await worker.evaluate(
      async ([address, store]) => window.o2.start({ relayAddrs: [address!], blockstoreName: store! }),
      [relayAddr, `o2-indicator-${name}`],
    )

    // Started and idle. Still the page's own title — this is what stops the indicator being
    // a constant that says "computing" from the moment a node exists.
    expect(
      await worker.title(),
      'BROW-07: a started but idle tab already claimed to be computing, so the indicator says ' +
        'nothing about whether work is in flight',
    ).toBe(BASE_TITLE)

    // The second page, brought to the front. From here the worker page is not the page this
    // context is showing, which is the state the criterion is about.
    const front = await context.newPage()
    await front.goto(`${baseUrl}${PAGE}`)
    await front.bringToFront()

    // Dispatched WITHOUT awaiting, on purpose: the promise is held on the harness side while
    // the page goes on running, so every title reading below is taken *during* the work
    // rather than after it.
    const run = worker.evaluate(
      async ([n, cubes]) =>
        window.o2.runColouring({
          n: n as number,
          cubes: cubes as number,
          redundancy: 1,
          peerIds: [],
        }),
      [N, CUBES],
    )

    const busyTitle = await waitForTitle(
      worker,
      (title) => title.startsWith(COMPUTING_PREFIX),
      TITLE_DEADLINE_MS,
    )

    expect(
      busyTitle,
      `BROW-07: with work in flight and a second page in front, ${name}'s tab strip read ` +
        `"${busyTitle}". A visitor looking at another tab has the title and the favicon and ` +
        'nothing else; if the title does not say so, nothing does.',
    ).toBe(`${COMPUTING_PREFIX}${BASE_TITLE}`)

    // The other page really is the front one, asserted rather than assumed — if
    // `bringToFront` had done nothing, the reading above would be about a focused tab.
    expect(await front.title()).toBe(BASE_TITLE)

    const result = await run
    expect(result.complete).toBe(true)

    // And it is not a constant: the title comes back on its own, with the page still open and
    // the node still running. The wait covers `demo/main.ts`'s stated dwell.
    const idleTitle = await waitForTitle(worker, (title) => title === BASE_TITLE, TITLE_DEADLINE_MS)
    expect(
      idleTitle,
      'BROW-07: the indicator never cleared after the work drained, so it is a decoration that ' +
        'says a node exists rather than one that says this machine is working',
    ).toBe(BASE_TITLE)

    await worker.evaluate(async () => window.o2.stop()).catch(() => {})
    await context.close()
  }, 300_000)
})
