import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import type { Browser, BrowserContext, Page } from 'playwright'
import { createServer } from 'vite'
import type { ViteDevServer } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { KERNEL_TRUST_ANCHOR } from '@o2/demo'
import { fixtureViteCacheDir, launchFixtureBrowser } from './e2e-browser-launch.ts'
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
 * ## The driver moved on 2026-09-04 (AUTH-06), and the subject did not
 *
 * This file drove `window.o2.autoStart` — the demo — until then. AUTH-06 made
 * `identityProtection` a required option, and a **visitor is asked for no passphrase**, so
 * `demo/main.ts` now starts under `writes-no-new-secret` and persists nothing at all until
 * `42-04` asks. Left on that path this fixture would have measured four tabs each minting a
 * per-session identity, which is not a race and not a property: the assertions would have
 * gone red for a reason that has nothing to do with the transaction they are about.
 *
 * The alternative — a passphrase parameter on `TabApi` — was refused. `demo/main.ts` records
 * the rule in its own words: *a page that was found rather than configured must not be
 * configurable by whatever found it*, and a passphrase is the last thing that should be
 * relaxed for.
 *
 * So the tabs are driven through `packages/browser/harness/capability.html`, whose harness
 * *"constructs the factory directly, which is also the sharper thing to do: the subject is
 * `BrowserNode.start`'s composition, not the demo glue above it."* Everything this file
 * measures is unchanged — one context, one origin, one IndexedDB, four real tabs released
 * against a shared wall-clock instant, three trials, both readings, the spread printed. What
 * changed is which `start` call the tabs make, and it is the same `BrowserNode.start`.
 *
 * The consent gate went with it: the harness page installs no `window.o2` and asks for no
 * consent, so `armTab` no longer clicks `#allow`. That was never part of the subject —
 * `demo/main.ts` writes the consent record, and the seed is minted by `start`.
 *
 * **And the same is true of the sign-in surface `42-04` added, which is why this file is not
 * in `42-06`'s sweep.** Thirty-seven e2e files had to learn the demo page's new front door;
 * this one does not have that door, because it does not use that page. It passes its own
 * `identityProtection` to `BrowserNode.start` directly — its own passphrase, chosen here —
 * so it never calls the page's registration control, never sees `#signin`, and was green through
 * `42-04` while every fixture that drives the demo page was red. A mechanical edit that put
 * a page-level registration in this file would be editing the wrong subject.
 *
 * What the sign-in surface DOES change is how much this file's reading matters. Under
 * `writes-no-new-secret` a demo tab minted a fresh key every visit, so *"N tabs of one
 * origin hold ONE identity"* was a property of this harness and of nothing a visitor
 * touched. Since `42-04` a visitor's tab seals and reuses one, so the property this file
 * pins is the visitor's property again.
 *
 * ## What this file does not claim
 *
 * One host, one chromium, one profile. These are N tabs of one browser and not N devices —
 * but the shared IndexedDB origin is the entire mechanism under test, and that is a property
 * of the profile rather than of the machine.
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const PAGE = 'packages/browser/harness/capability.html'

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

/**
 * AUTH-06 — the passphrase every tab of every trial starts under.
 *
 * **One value, shared by all four tabs, and that is the fixture's premise rather than a
 * convenience**: four tabs of one profile are one person's browser, so they hold one
 * passphrase, and the question this file asks is what four such tabs do to one cold store.
 * Four different passphrases would be four different people and no race at all.
 *
 * A fixture constant naming nothing outside this file, at or above `PASSPHRASE_MIN_LENGTH`.
 */
const SPEC_PASSPHRASE = 'a-fixture-passphrase-for-a-tab'

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

/*
 * `/bootstrap.json` used to be served here by a Vite middleware, because `autoStart` reads
 * the relay list from the origin. The harness takes `relayAddrs` as an argument, so the
 * middleware has nothing left to answer and is gone rather than left serving a route nobody
 * requests.
 */

/**
 * Bring one tab to the point where `start` is the only thing left to do.
 *
 * **No node is started here**, which is what keeps the origin cold for the seed: the page
 * loads its module, installs `window.o2capability`, and waits. The harness page renders no
 * surface and asks for no consent — see its own comment for why that is right for a page a
 * visitor never opens — so there is no gate to click.
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
  await page.waitForFunction(() => typeof window.o2capability !== 'undefined', null, {
    timeout: TAB_BUDGET_MS,
  })
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
        async ([name, at, anchor, relay, passphrase]) => {
          const delay = (at as number) - Date.now()
          if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay))
          // Stamped where the wait ends and BEFORE the start, so the number reports when
          // this tab was released rather than how long its start took.
          const releasedAt = Date.now()
          const peerId = await window.o2capability.start({
            relayAddrs: [relay as string],
            blockstoreName: name as string,
            trustAnchors: [anchor as string],
            sovereignty: { ownerId: '', canExecuteSovereign: false },
            whenSeedIsGone: 'mints-a-new-identity',
            // AUTH-06 — the same passphrase in all four tabs, because they are four tabs
            // of one person's browser. The seal happens INSIDE the transaction this file
            // is about; the Argon2id derivation that produces the key happens before it.
            identityProtection: { kind: 'passphrase', passphrase: passphrase as string },
          })
          return { peerId, releasedAt }
        },
        [store, releaseAt, KERNEL_TRUST_ANCHOR, relayAddr, SPEC_PASSPHRASE] as const,
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
  await Promise.all(pages.map(async (page) => page.evaluate(async () => window.o2capability.stop())))
  await Promise.all(
    pages.map(async (page) => {
      await page.reload()
      await page.waitForFunction(() => typeof window.o2capability !== 'undefined', null, {
        timeout: TAB_BUDGET_MS,
      })
    }),
  )
  return Promise.all(
    pages.map(async (page) =>
      page.evaluate(
        async ([name, anchor, relay, passphrase]) =>
          window.o2capability.start({
            relayAddrs: [relay],
            blockstoreName: name,
            trustAnchors: [anchor],
            sovereignty: { ownerId: '', canExecuteSovereign: false },
            whenSeedIsGone: 'mints-a-new-identity',
            identityProtection: { kind: 'passphrase', passphrase },
          }),
        [store, KERNEL_TRUST_ANCHOR, relayAddr, SPEC_PASSPHRASE] as const,
      ),
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
    cacheDir: fixtureViteCacheDir(ROOT),
  })
  await server.listen()
  const url = server.resolvedUrls?.local[0]
  if (url === undefined) throw new Error('vite dev server produced no URL')
  pageUrl = `${url.endsWith('/') ? url : `${url}/`}${PAGE}`

  browser = await launchFixtureBrowser(chromium)
  // ONE context. Every page of it shares one origin and therefore one IndexedDB.
  context = await browser.newContext()
}, 420_000)

afterAll(async () => {
  for (const page of pages) {
    await page.evaluate(async () => window.o2capability.stop()).catch(() => {})
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

        await Promise.all(
          pages.map(async (page) => page.evaluate(async () => window.o2capability.stop())),
        )
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
