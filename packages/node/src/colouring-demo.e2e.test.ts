import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { KERNEL_TRUST_ANCHOR } from '@o2/demo'
import { chromium } from 'playwright'
import type { Browser, BrowserContext, Page } from 'playwright'
import { createServer } from 'vite'
import type { ViteDevServer } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { launchFixtureBrowser } from './e2e-browser-launch.ts'
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
  // DET-03: the demo's own anchor, matching exactly what `bin/seed.ts` pins when it is
  // run with no flags. Chosen for **realism, not coverage** — this file and
  // `seed-discovery.e2e.test.ts` are the closest thing in the repository to a picture of
  // that deployment, so the value that belongs here is the value production uses.
  //
  // Whether this set is ever consulted was **measured, not reasoned**, on 2026-07-31:
  // this site's anchors were replaced with `[]` — a set that refuses every module — and
  // the file was re-run. All 15 tests across this file and `seed-discovery.e2e.test.ts`
  // still passed, so **this anchor set is never consulted** and this site exercises
  // nothing of the signed path. Recorded as an observation, not a deduction: do not
  // work it out from `peerIds` and `redundancy` instead, because which nodes a job's
  // executor set actually contains is a quantity to be read.
  //
  // What would give this site real coverage is one dispatch that reaches it: adding
  // `relay.peerId` to `runColouring`'s `peerIds` below, which this file already has in
  // hand. Deliberately declined — it would change which nodes that job dispatches to and
  // therefore change DEMO-01's own `agreeing` reading, i.e. edit the proof of another
  // phase's criterion to decorate this one.
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

  server = await createServer({ root: ROOT, logLevel: 'error', server: { port: 0 } })
  await server.listen()
  const url = server.resolvedUrls?.local[0]
  if (url === undefined) throw new Error('vite dev server produced no URL')
  baseUrl = url.endsWith('/') ? url : `${url}/`

  browser = await launchFixtureBrowser(chromium)
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

/**
 * CHURN-03's read half, measured through the entry point a visitor reaches — the blocker the
 * v1.1 audit recorded as B4.
 *
 * **Why this case exists and what it is the only proof of.** The write half landed on
 * 2026-08-16: every colouring run passes `checkpointsInto(node.store)`, so a checkpoint block
 * goes into this tab's IndexedDB as each cube is answered. Nothing read one back. `resumeFrom`
 * appeared four times in the whole tree and all four were inside `submit.ts` itself, so the
 * demo was writing a chain no production caller could ever consume. Everything downstream of
 * that — `idb-checkpoints.ts`, the exported `jobIdOf`, the C23 region — exists to close it,
 * and every one of those parts can be unit-tested green while the page still resumes nothing.
 * This is the case that cannot: it drives `window.o2.runColouring` twice over one job in one
 * tab and reads what the second run says it did.
 *
 * **A DISTINCT job from the one above, and that is not incidental.** `cubes` is in the job id —
 * `submitJob` derives it from the module CID and the ordered input CIDs, one per cube — so
 * `CUBES + 1` is a job neither the DEMO-01 case nor the ladder below has touched. Reusing
 * `CUBES` would have made the first call here a resume of that earlier run, and `offered` would
 * have been non-null on a call this case needs to observe starting from nothing.
 *
 * **Watched red, 2026-08-17, not reasoned about.** `main.ts`'s one line of resume wiring —
 * `...(resumeFrom === null ? {} : { resumeFrom })` — was planted to `{} : {}`, i.e. the page
 * looks its handle up, checks it reads back, and then does not pass it. Every other case in
 * this file stayed green and this one failed with `AssertionError: expected +0 to be 9`, which
 * is reading (3): nine cubes were dispatched where nine should have been carried. Restored by
 * the surgical inverse of that one line; `cmp` against a snapshot taken immediately before
 * planting exited 0.
 */
describe('CHURN-03 — the second run of a job carries its cubes instead of computing them', () => {
  it('resumes from the handle the first run stored, and says so', async () => {
    const [a, b] = tabs as [Tab, Tab]
    const argument = { n: N, cubes: CUBES + 1, redundancy: 2, peerIds: [b.peerId] }

    const first = await a.page.evaluate(
      async (options) => window.o2.runColouring(options),
      argument,
    )
    // (1) The first run of THIS job starts from nothing — there is no handle to offer it, so
    // nothing is carried. Both are asserted: a `carried: 0` with a handle on offer would be a
    // resume that silently did nothing, which is the failure this whole mechanism can hide in.
    expect(first.resume.offered).toBeNull()
    expect(first.resume.refused).toBeNull()
    expect(first.resume.carried).toBe(0)
    // And it leaves something behind. `newest()` is the newest CONFIRMED handle — one whose
    // block read back out of the store — so this is also the assertion that the write half
    // actually reached IndexedDB rather than merely being called.
    expect(first.resume.remembered).not.toBeNull()
    expect(first.complete).toBe(true)
    expect(first.found).toBe(true)

    const second = await a.page.evaluate(
      async (options) => window.o2.runColouring(options),
      argument,
    )
    // (2) THE LOAD-BEARING READING. The second run was offered exactly the handle the first
    // one stored — the two halves meeting through the mutable key space, under the job id both
    // derived independently.
    expect(second.resume.offered).toBe(first.resume.remembered)
    expect(second.resume.refused).toBeNull()
    // (3) And it carried every cube. Counted by the page off `ending ===
    // 'carried-from-checkpoint'` in `submitJob`'s own answer, never off the handle it passed,
    // so this is what the fabric did and not what the page asked for.
    expect(second.resume.carried).toBe(CUBES + 1)
    // (4) The answer survived the round trip: it came out of the checkpoint's named blocks
    // rather than off any node. A resume that lost the answer would be a slower restart.
    expect(second.found).toBe(true)
    // (5) `complete` is FALSE on a resumed run, and that is correct rather than a regression:
    // a carried shard is `agreed` at `replicas: 0`, which is below any redundancy a caller can
    // ask for, so it is degraded by the field's own definition. Asserted rather than tolerated
    // — the day it reads `true` on a run that dispatched nothing, this fabric is claiming a
    // verification nobody performed.
    expect(second.complete).toBe(false)
    // (6) A COMPARATIVE reading, taken inside one run against the arm beside it rather than
    // against a wall-clock threshold this machine would encode. The second run dispatched no
    // cube to anybody; the first ran nine across two tabs over WebRTC.
    expect(second.elapsedMs).toBeLessThan(first.elapsedMs)
  }, 240_000)
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
