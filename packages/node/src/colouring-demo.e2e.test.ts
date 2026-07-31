import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { chromium } from 'playwright'
import type { Browser, BrowserContext, Page } from 'playwright'
import { createServer } from 'vite'
import type { ViteDevServer } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FabricNode } from './fabric-node.ts'

/**
 * DEMO-01 and DEMO-02 — the demo, end to end, in two real browser tabs.
 *
 * The two criteria this file exists for are not about throughput:
 *
 *   1. a static client distributes a real job across tabs, *showing live placement
 *      and results arriving*; and
 *   2. the job is one a person cares about the answer to, and **a visitor can check
 *      that the answer is right**.
 *
 * The second is the one that is easy to fake and easy to lose. A demo can satisfy
 * its letter by printing a number and asserting the number is correct — which is a
 * demo of the protocol wearing a hat. So the assertions here are specifically about
 * *who* the visitor has to trust: the answer is checked in the page, against
 * a² + b² = c² re-derived there, with the fabric stopped and every peer gone.
 *
 * Two isolated `BrowserContext`s, so the tabs share no IndexedDB, no peer identity
 * and no libp2p state — separate nodes in every sense but the machine, which is the
 * one thing this test does not claim.
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const PAGE = 'packages/browser/demo/index.html'

/** Small enough to settle in milliseconds; large enough to have real constraints. */
const N = 204
const CUBES = 8

interface Tab {
  readonly name: string
  readonly context: BrowserContext
  readonly page: Page
  readonly peerId: string
}

let relay: FabricNode
let relayAddr: string
let server: ViteDevServer
let browser: Browser
let baseUrl: string
let workdir: string
const tabs: Tab[] = []

async function openTab(name: string): Promise<Tab> {
  const context = await browser.newContext()
  const page = await context.newPage()
  page.on('pageerror', (error) => {
    process.stderr.write(`[${name}] page error: ${error.message}\n`)
  })
  page.on('console', (message) => {
    if (message.type() === 'error') process.stderr.write(`[${name}] console: ${message.text()}\n`)
  })

  await page.goto(`${baseUrl}${PAGE}`)
  await page.waitForFunction(() => typeof window.o2 !== 'undefined', null, { timeout: 30_000 })

  const peerId = await page.evaluate(
    async ([address, store]) => {
      // BROW-01 has no test-only bypass: a harness consents for the same reason a
      // visitor clicks the button.
      window.o2.grantConsent()
      return window.o2.start({ relayAddrs: [address!], blockstoreName: store! })
    },
    [relayAddr, `o2-colouring-${name}`],
  )

  const tab: Tab = { name, context, page, peerId }
  tabs.push(tab)
  return tab
}

beforeAll(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'o2-colouring-'))
  relay = await FabricNode.start({ maxReservations: 16, listen: ['/ip4/127.0.0.1/tcp/0/ws'] })
  const address = relay.browserDialableAddrs[0]
  if (address === undefined) throw new Error('relay produced no browser-dialable address')
  relayAddr = address

  server = await createServer({ root: ROOT, logLevel: 'error', server: { port: 0 } })
  await server.listen()
  const url = server.resolvedUrls?.local[0]
  if (url === undefined) throw new Error('vite dev server produced no URL')
  baseUrl = url.endsWith('/') ? url : `${url}/`

  browser = await chromium.launch()
}, 180_000)

afterAll(async () => {
  for (const tab of tabs) {
    await tab.page.evaluate(async () => window.o2.stop()).catch(() => {})
    await tab.context.close().catch(() => {})
  }
  await browser?.close().catch(() => {})
  await server?.close().catch(() => {})
  await relay?.stop().catch(() => {})
  await rm(workdir, { recursive: true, force: true })
}, 120_000)

describe('DEMO-01 — a real job, distributed across tabs, with placement visible', () => {
  it('runs every cube on two nodes and shows which two', async () => {
    const a = await openTab('a')
    const b = await openTab('b')

    const bAddrs = await b.page.evaluate(async () => window.o2.waitForWebrtcAddr(60_000))
    const dialed = await a.page.evaluate(async (address) => window.o2.dial(address), bAddrs[0]!)
    expect(dialed).toBe(b.peerId)

    const run = await a.page.evaluate(
      async ([n, cubes, peer]) =>
        window.o2.runColouring({
          n: n as number,
          cubes: cubes as number,
          redundancy: 2,
          peerIds: [peer as string],
        }),
      [N, CUBES, b.peerId],
    )

    expect(run.complete).toBe(true)
    expect(run.cubes).toBe(CUBES)
    expect(run.verificationMultiplier).toBeCloseTo(2, 6)

    // Placement is *shown*, not merely happening: every cube names the two nodes
    // that agreed on it, and both tabs appear. Without this the criterion is
    // satisfied by a job that silently ran twice in one tab.
    expect(run.agreeing).toHaveLength(CUBES)
    for (const agreeing of run.agreeing) {
      expect([...agreeing].sort()).toEqual([a.peerId, b.peerId].sort())
    }

    // Every cube returned a real answer. `budget` would mean "I ran out of time"
    // and is deliberately not the same as `exhausted`, which means "this cube
    // provably contains no colouring".
    for (const status of run.statuses) {
      expect(['found', 'exhausted']).toContain(status)
    }
    expect(run.found).toBe(true)

    // Criterion 2 — the manifest reaches the demo's real entry point
    // (`runColouring`, called through `window.o2` exactly as a visitor's page
    // does), not only a test-side harness that builds its own `EgressGuard`. Both
    // `entries.length` and `violations` are checked, per 13-CONTEXT.md decision 3:
    // an empty manifest reports zero violations trivially, and the two must never
    // be allowed to look alike.
    expect(run.egress.entries.length).toBeGreaterThan(0)
    expect(run.egress.violations).toEqual([])
  }, 240_000)

  it('shows the work in the always-visible bar', async () => {
    // BROW-04. The bar is fixed, has no control that hides it, and by now has
    // counted the tasks this tab executed for its peer.
    const [a, b] = tabs as [Tab, Tab]

    for (const tab of [a, b]) {
      // Both tabs, not just the one that submitted. A background tab running
      // someone else's work with no visible surface is the case BROW-04 exists for,
      // and it is the one a foreground-only check would miss.
      // `isVisible`, not the attribute: a `display` rule on an id outranks the
      // browser's own `[hidden]`, so the attribute can be right while the element
      // is on screen. That is exactly what happened.
      expect(await tab.page.isVisible('#bar')).toBe(true)
      expect(await tab.page.textContent('#bar-stats')).toContain('of one thread')
    }
    const activity = await b.page.evaluate(() => window.o2.activity())
    expect(activity).not.toBeNull()
    // Tab B executed replicas for tab A's job. If this is zero, the job ran
    // entirely in one tab and the distribution claim above is hollow.
    expect(activity?.tasksExecuted ?? 0).toBeGreaterThan(0)

    // "and for whom" — the half of the criterion a peer count does not answer.
    // Tab B is working for tab A specifically, and both the API and the bar say so.
    expect(activity?.servedFor.map((s) => s.peerId)).toContain(a.peerId)
    expect(await b.page.textContent('#bar-what')).toContain('running work for')
  }, 120_000)
})

describe('the page runs the ladder itself, not only the API', () => {
  it('climbs until the fabric stops, and says which rung it settled', async () => {
    // Everything above drives `window.o2` directly, which is the right way to make
    // assertions about the fabric — and would pass just as well if the page's own
    // controls were wired to nothing.
    const [a] = tabs as [Tab]

    await a.page.waitForFunction(
      () => document.getElementById('run')?.hasAttribute('disabled') === false,
      null,
      { timeout: 30_000 },
    )
    await a.page.click('#run')
    await a.page.waitForFunction(
      () => (document.getElementById('run-status')?.textContent ?? '').startsWith('settled'),
      null,
      { timeout: 180_000 },
    )

    const report = (await a.page.textContent('#run-report')) ?? ''
    // The arc the reordering bought: cubes are not merely parallelism, they are how
    // far the search reaches, so the report leads with how many there were.
    expect(report).toContain('cubes per rung')
    expect(report).toContain('Best settled: n =')
    // A rung that stops must say *why* — 'budget' is a shortage of search, never a
    // proof that no colouring exists, and conflating the two would turn a limit
    // into a false mathematical claim.
    if (report.includes('Stopped here')) {
      expect(report).toContain('not a proof')
    }
    // And the check becomes available because an answer now exists.
    expect(await a.page.isDisabled('#verify')).toBe(false)
  }, 240_000)
})

describe('DEMO-02 — the visitor checks the answer, trusting nobody', () => {
  it('accepts the colouring the fabric produced', async () => {
    const [a] = tabs as [Tab]
    const verdict = await a.page.evaluate(() => window.o2.verifyAnswer())

    expect(verdict.checked).toBe(true)
    expect(verdict.ok).toBe(true)
    // At least the run above, and more if the ladder climbed past it. Pinning the
    // exact value would make this a test of how far the search got rather than of
    // whether the check works, and those are different questions — the second one
    // must keep passing when the answer to the first changes.
    expect(verdict.n).toBeGreaterThanOrEqual(N)
    // The triples were re-derived in the page from a² + b² = c². They were not
    // supplied by a node, and they are not the list the guest was handed.
    expect(verdict.triplesChecked).toBeGreaterThan(0)
    expect(verdict.violation).toBeNull()
  }, 120_000)

  it('still checks with the fabric stopped and every peer gone', async () => {
    // This is the whole claim, isolated. If the check needed a node, a peer, or a
    // network, it would be one more thing to trust rather than the escape from
    // trusting things.
    const [a] = tabs as [Tab]

    await a.page.evaluate(async () => window.o2.stop())
    expect(await a.page.evaluate(() => window.o2.activity())).toBeNull()

    const verdict = await a.page.evaluate(() => window.o2.verifyAnswer())
    expect(verdict.ok).toBe(true)
    expect(verdict.triplesChecked).toBeGreaterThan(0)
  }, 120_000)

  it('puts the verdict on the page, where a visitor would read it', async () => {
    // A check nobody can see is a check that did not happen, as far as the
    // criterion is concerned.
    const [a] = tabs as [Tab]
    await a.page.click('#verify')
    await a.page.waitForFunction(
      () => (document.getElementById('verify-report')?.textContent ?? '').length > 0,
      null,
      { timeout: 30_000 },
    )
    const text = (await a.page.textContent('#verify-report')) ?? ''
    expect(text).toContain('Correct')
    expect(text).toContain('Pythagorean triples')
  }, 120_000)
})
