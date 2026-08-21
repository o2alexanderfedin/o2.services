import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import type { Browser, BrowserContext, Page } from 'playwright'
import { createServer } from 'vite'
import type { Plugin, ViteDevServer } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { KERNEL_TRUST_ANCHOR } from '@o2/demo'
import { FabricNode } from './fabric-node.ts'

/**
 * **Task #49, production shape: N tabs opening one cold origin at once hold ONE identity.**
 *
 * ## This is the confirmation, NOT the witness — and the distinction is load-bearing
 *
 * The witness for the defect is `idb-identity-store.browser.test.ts`, where four concurrent
 * callers of the old read-then-write pair mint four distinct seeds in chromium, firefox and
 * webkit, deterministically. It is deterministic there because all four `get`s are issued in
 * one synchronous pass and are outstanding before any resolves.
 *
 * **This file cannot make that claim and must not be read as making it.** The window between
 * the `get` and the `put` is one IndexedDB round trip, and three of any four tabs are
 * backgrounded — where Chromium clamps timers to roughly one-second boundaries, which
 * `demo/main.ts` records in its own words. So a green run here cannot distinguish *"the race
 * is rare"* from *"the tabs never overlapped"*. The measured release spread is printed per
 * trial for exactly that reason: without it a reader cannot tell which of the two they are
 * looking at, and a number that cannot be interpreted is worse than no number.
 *
 * What this file does carry is the thing the store-level proof cannot: the real
 * `browser-node.ts` start path, in real tabs, on a real shared origin. It is a canary on the
 * production wiring rather than a reading of the hazard.
 *
 * ## The defect this was written around
 *
 * `browser-node.ts`'s start reads `loadSeed()`, and if it finds nothing calls
 * `generateSeed()` and `saveSeed()`. There is no transaction spanning the read and the
 * write, and IndexedDB is per-origin — tabs of one profile share it, which
 * `static-rendezvous.e2e.test.ts` records in its own words. So N tabs opening a fresh
 * profile *simultaneously* each read `null`, each mint, and `saveSeed` is last-writer-wins.
 *
 * The consequence that makes it a defect rather than waste is the second one: **N−1 of those
 * tabs run as nodes whose seed is not the one in storage.** On the next start each becomes a
 * different node, and any certificate naming the old one is orphaned — which is precisely
 * the case `whenSeedIsGone` exists to make loud, arrived at silently instead.
 *
 * `visitorKeyPair()` has the same read-then-write shape one layer out, and its database is
 * deliberately NOT derived from `blockstoreName`, so every tab of the profile races it
 * regardless of which node store it opens.
 *
 * ## Why this reads identity across a restart rather than counting mints
 *
 * A mint that loses is invisible from outside: the losing tab holds a working node with a
 * working peer id, and nothing at that moment says its seed is not the stored one. What
 * says so is the **next start**. So each trial starts N tabs at once, records their peer
 * ids, reloads, starts again, and compares. A tab whose id changes across the restart lost
 * the race; a set of ids larger than one at the first start is the same fact seen earlier.
 *
 * Both readings are taken because they can disagree: N distinct ids with all N stable would
 * mean the stores are not shared at all, which would make this fixture measure nothing.
 *
 * ## Aligned starts, repeated trials, and the spread printed
 *
 * Tabs are released against a **shared wall-clock instant** computed in Node and passed into
 * each page, rather than merely dispatched together: Playwright's per-page dispatch is serial
 * over CDP and would spread the starts by more than the window they have to overlap in.
 * `Date.now()` is the right clock for this and `performance.now()` is not — the point is a
 * value shared across several JavaScript realms, which a per-realm monotonic origin is not.
 *
 * Each tab reports the instant its wait actually ended, and the spread across the four is
 * printed beside the result. That is what makes a green trial mean something: a spread inside
 * a millisecond says the tabs genuinely overlapped, and a spread of hundreds says the timer
 * clamp won and this trial measured nothing about the race.
 *
 * ## What this file does not claim
 *
 * One host, one chromium, one profile. These are N tabs of one browser and not N devices —
 * but the shared IndexedDB origin is the entire mechanism under test, and that is a property
 * of the profile rather than of the machine.
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const PAGE = 'packages/browser/demo/index.html'

/** Tabs per trial. Four is enough for a last-writer-wins race to have three losers. */
const TABS = 4
/**
 * Independent trials, each on a fresh store.
 *
 * Three rather than more: this is a canary on production wiring, and the deterministic
 * reading lives in the store-level proof. Each trial costs four tabs started, stopped,
 * reloaded and started again, and buying a fourth trial buys no claim the first three
 * do not already carry.
 */
const TRIALS = 3
/** How far ahead of now the shared release instant is set, so every tab is armed before it. */
const RELEASE_LEAD_MS = 1_500

/** Page load, wasm init, node start. */
const TAB_BUDGET_MS = 180_000
/** Whole-case budget — there to turn a hang into a named failure, not to measure anything. */
const CASE_TIMEOUT_MS = 1_800_000

let workdir: string
let relay: FabricNode | undefined
let relayAddr: string
let server: ViteDevServer | undefined
let browser: Browser | undefined
let context: BrowserContext | undefined
let pageUrl: string
const pages: Page[] = []

/** A node's own listening WebSocket address — never a circuit, which also matches `/ws`. */
function directWsAddr(node: FabricNode, name: string): string {
  const found = node.browserDialableAddrs.find((address) => !address.includes('/p2p-circuit'))
  if (found === undefined) {
    throw new Error(`${name} produced no direct /ws address`)
  }
  return found
}

/** `/bootstrap.json`, named by the origin that serves the page. No provider: see the docblock. */
function bootstrapPlugin(): Plugin {
  return {
    name: 'o2-cold-start-bootstrap',
    configureServer(dev: ViteDevServer) {
      dev.middlewares.use((request, response, next) => {
        if ((request.url ?? '').split('?')[0] !== '/bootstrap.json') {
          next()
          return
        }
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify({ relayAddrs: [relayAddr] }))
      })
    },
  }
}

/**
 * Bring one tab to the point where `autoStart` is the only thing left to do.
 *
 * Consent is granted here and **no node is started**, which is what keeps the origin cold
 * for the seed: `#allow` reveals `#main` and writes the consent record, and the node is
 * minted by `autoStart` alone. Only the first tab of the profile is shown the gate.
 */
async function armTab(name: string): Promise<Page> {
  const ctx = context
  if (ctx === undefined) throw new Error('no browser context')
  const page = await ctx.newPage()
  pages.push(page)
  page.on('pageerror', (error) => {
    process.stderr.write(`[${name}] page error: ${error.message}\n`)
  })
  page.on('console', (message) => {
    if (message.type() === 'error') process.stderr.write(`[${name}] console: ${message.text()}\n`)
  })
  await page.goto(pageUrl)
  await page.waitForFunction(() => typeof window.o2 !== 'undefined', null, { timeout: TAB_BUDGET_MS })
  if (await page.isVisible('#gate')) await page.click('#allow')
  await page.waitForFunction(
    () => document.getElementById('main')?.hasAttribute('hidden') === false,
    null,
    { timeout: TAB_BUDGET_MS },
  )
  return page
}

/**
 * Start every tab against `store`, released together at `releaseAt`.
 *
 * The wait is inside the page so the alignment survives Playwright's serial dispatch: each
 * tab is armed by its own `evaluate` call, and all of them sleep until one instant that Node
 * chose. `Date.now()` is the right clock here and not `performance.now()` — the point is a
 * value shared across five JavaScript realms, which a per-realm monotonic origin is not.
 */
async function startTogether(
  store: string,
  releaseAt: number,
): Promise<{ readonly peerIds: string[]; readonly spreadMs: number }> {
  const started = await Promise.all(
    pages.map(async (page) =>
      page.evaluate(
        async ([name, at]) => {
          const delay = (at as number) - Date.now()
          if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay))
          // Stamped where the wait ends and BEFORE the start, so the number reports when
          // this tab was released rather than how long its start took.
          const releasedAt = Date.now()
          const node = await window.o2.autoStart({ blockstoreName: name as string })
          return { peerId: node.peerId, releasedAt }
        },
        [store, releaseAt] as const,
      ),
    ),
  )
  const stamps = started.map((one) => one.releasedAt)
  return {
    peerIds: started.map((one) => one.peerId),
    spreadMs: Math.max(...stamps) - Math.min(...stamps),
  }
}

/** Stop, reload, and start again — the restart that makes a lost mint visible. */
async function restartTogether(store: string): Promise<string[]> {
  await Promise.all(pages.map(async (page) => page.evaluate(async () => window.o2.stop())))
  await Promise.all(
    pages.map(async (page) => {
      await page.reload()
      await page.waitForFunction(() => typeof window.o2 !== 'undefined', null, {
        timeout: TAB_BUDGET_MS,
      })
      await page.waitForFunction(
        () => document.getElementById('main')?.hasAttribute('hidden') === false,
        null,
        { timeout: TAB_BUDGET_MS },
      )
    }),
  )
  return Promise.all(
    pages.map(async (page) =>
      page
        .evaluate(async (name) => window.o2.autoStart({ blockstoreName: name }), store)
        .then((started) => started.peerId),
    ),
  )
}

beforeAll(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'o2-cold-start-'))
  relay = await FabricNode.start({
    relayAdmission: 'admits-any-peer',
    startReporting: 'reports-its-own-start',
    // Well above what three trials of four tabs can ask for across two starts each. Sited
    // high on purpose: a stopped instance's reservation has been measured lingering — see
    // `owner-domain-tabs.e2e.test.ts` — so the cap must not be the thing a trial trips over.
    maxReservations: 64,
    blockstoreDir: join(workdir, 'relay'),
    listen: ['/ip4/127.0.0.1/tcp/0/ws'],
    trustAnchors: [KERNEL_TRUST_ANCHOR],
  })
  relayAddr = directWsAddr(relay, 'relay')

  server = await createServer({
    root: ROOT,
    logLevel: 'error',
    server: { port: 0 },
    plugins: [bootstrapPlugin()],
  })
  await server.listen()
  const url = server.resolvedUrls?.local[0]
  if (url === undefined) throw new Error('vite dev server produced no URL')
  pageUrl = `${url.endsWith('/') ? url : `${url}/`}${PAGE}`

  browser = await chromium.launch()
  // ONE context. Every page of it shares one origin and therefore one IndexedDB.
  context = await browser.newContext()
}, 420_000)

afterAll(async () => {
  for (const page of pages) {
    await page.evaluate(async () => window.o2.stop()).catch(() => {})
  }
  await context?.close().catch(() => {})
  await browser?.close().catch(() => {})
  await server?.close().catch(() => {})
  await relay?.stop().catch(() => {})
  await rm(workdir, { recursive: true, force: true })
}, 180_000)

describe('AUTH-01 — a cold origin opened by several tabs at once holds one identity', () => {
  it(
    'mints exactly one seed however many tabs race for it, and every tab keeps its id across a restart',
    async () => {
      for (let index = 0; index < TABS; index += 1) await armTab(`tab-${String(index)}`)

      const raced: number[] = []
      const drifted: number[] = []

      for (let trial = 0; trial < TRIALS; trial += 1) {
        // A fresh store per trial, so each is a genuinely cold origin rather than a
        // re-reading of the first trial's winner.
        const store = `o2-cold-start-${String(trial)}`
        const { peerIds: first, spreadMs } = await startTogether(store, Date.now() + RELEASE_LEAD_MS)
        const distinct = new Set(first).size
        const after = await restartTogether(store)
        const changed = first.filter((id, tab) => id !== after[tab]).length

        // The spread is printed first because it is what says whether the rest of the line
        // is a reading of the race or a reading of the timer clamp.
        process.stderr.write(
          `[cold-start trial ${String(trial)}] release-spread=${String(spreadMs)}ms ` +
            `distinct=${String(distinct)} of ${String(TABS)} ` +
            `changed-across-restart=${String(changed)}\n  first=${JSON.stringify(first)}\n` +
            `  after=${JSON.stringify(after)}\n`,
        )
        if (distinct > 1) raced.push(trial)
        if (changed > 0) drifted.push(trial)

        await Promise.all(pages.map(async (page) => page.evaluate(async () => window.o2.stop())))
      }

      // The claim, in the two forms that can disagree. The first is the mint: four tabs of
      // one profile opening one cold store are one node. The second is the consequence a
      // caller actually meets — a node that comes back as somebody else on its next start.
      expect(
        raced,
        `${String(raced.length)} of ${String(TRIALS)} trials minted more than one identity for one store — ` +
          'the read and the write in `browser-node.ts`\'s seed path are not one transaction, so ' +
          'every tab that read `null` minted, and `saveSeed` is last-writer-wins',
      ).toEqual([])
      expect(
        drifted,
        `${String(drifted.length)} of ${String(TRIALS)} trials had a tab come back as a different node ` +
          'after a restart — the silent arrival at exactly the state `whenSeedIsGone` exists to make loud',
      ).toEqual([])
    },
    CASE_TIMEOUT_MS,
  )
})
