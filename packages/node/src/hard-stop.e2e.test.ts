import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import type { Browser, BrowserContext, Page } from 'playwright'
import { createServer } from 'vite'
import type { ViteDevServer } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { KERNEL_TRUST_ANCHOR } from '@o2/demo'
import { fixtureViteCacheDir, launchFixtureBrowser } from './e2e-browser-launch.ts'
import { signInHarnessTab } from './e2e-signin.ts'
import { FabricNode } from './fabric-node.ts'

/**
 * BROW-08, first half — Stop is a hard interrupt, measured against an in-flight task.
 *
 * ## What BROW-04 already gives, so nothing here may be counted as satisfied by it
 *
 * `BrowserNode.stop()` (`browser-node.ts:2575`) already calls `this.worker.terminate()`
 * **first**, and `worker-executor.ts`'s header already argues that this is the only mechanism
 * there is: *"a guest `run()` cannot be interrupted from the thread running it… every
 * cooperative variant — a flag the loop checks, a duty cycle lowered to nothing, a governor
 * asked politely — degrades to 'zero soon'. Ending the thread is the only mechanism that
 * exists."* `terminate()` itself empties the queue before settling anything, for the stated
 * reason that a pool must not turn Stop into *"zero on the threads it happened to remember"*
 * (`worker-executor.ts:380`).
 *
 * This file adds **no mechanism**. It adds the measurement BROW-08 asks for and the plant that
 * makes the measurement mean something — the difference between *the code says it terminates*
 * and *an in-flight task was observed not completing*.
 *
 * ## What is readable after Stop, and what is not
 *
 * `demo/main.ts`'s `stop()` sets `node = null`, and `activity()` answers `null` when there is
 * no node — UI-SPEC §4.1 makes that removal *the* reading, and `#bar` disappears with it. So
 * there is no counter left to sample after Stop and an instruction to "sample the same counter
 * twice more" cannot be carried out. The reading is therefore asymmetric by construction:
 *
 *   1. **Before Stop — a moving floor.** A multi-shard run, with `tasksExecuted` sampled twice
 *      across a known interval and required to have moved. Without this the case would pass on
 *      a fabric that never started, which is the failure mode a zero-after-Stop assertion has
 *      no defence against on its own.
 *   2. **Stop.**
 *   3. **After Stop — two readings of absence.** `activity()` is `null`, and the held
 *      `runColouring` promise does not report a completed job inside a deadline derived from
 *      the rate measured in step 1 — *not* from a typed-in number. The project's Measurement
 *      convention asks for a comparison inside one run rather than an absolute threshold, and
 *      this is that comparison: the work outstanding at the moment of Stop, divided by the
 *      rate this very run was going at, times a margin.
 *
 * ## What "the task had already finished" would mean, and why it fails rather than passes
 *
 * A run that completed before Stop proves nothing at all. So the count of tasks outstanding at
 * the moment of Stop is asserted to be positive, with a message that says the observation was
 * of a finished job rather than an interrupted one. Widening the case to accept that would be
 * closing the gap by widening what counts as passing.
 *
 * ## Open question 2 is read NODE-LOCAL here, and is not settled
 *
 * `.planning/REQUIREMENTS.md`'s open question 2 asks whether a stop must propagate across the
 * fabric. **BROW-08 is about this tab's Stop control dropping this tab's CPU to zero**, and
 * that is the only reading this file measures. The global-propagation reading belongs to Phase
 * 36's kill switch. Nothing here should be read as having answered it.
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const PAGE = 'packages/browser/demo/index.html'

/**
 * Enough shards that the run lasts seconds and Stop lands with work outstanding.
 *
 * `N` is `colouring-demo.e2e.test.ts`'s, which describes that shape as settling *"in
 * milliseconds"* — so the lever is the cube count, not the bound.
 */
const N = 204
const CUBES = 128

/**
 * The tab's duty cycle, and it is the instrument rather than a flavour of the run.
 *
 * **Measured, after the obvious arrangement produced a counter that could not move.** At a
 * duty cycle of 1 `GovernedExecutor` passes every task straight through — `#executed += 1`
 * then `inner.execute(task)`, with no serialization — and `submitJob` dispatches all shards
 * under one `Promise.all`. So `tasksExecuted` counts tasks *admitted*, not tasks *finished*,
 * and it went `0 -> 128` inside the first 800 ms window: the first draft of this case failed
 * its own outstanding-work guard with *"expected 0 to be greater than 0"*, which is the guard
 * working and the instrument not.
 *
 * Below 1 the governor serializes and `#executed` is incremented **after** `await previous`
 * and `await yieldSlice()`, one task at a time. At `0.5` and the governor's default 50 ms
 * slice that is a 50 ms gap per task (`visibility-governor.ts:153`), so the counter climbs at
 * a rate this case can measure and Stop lands with a known amount of work outstanding.
 *
 * It also sharpens the subject rather than softening it: serialized, exactly **one** task is
 * inside the executor when Stop arrives, and criterion 3's sentence — *"no in-flight task is
 * allowed to run to completion"* — is about that task.
 */
const DUTY_CYCLE = 0.5

/** The interval each pre-Stop sample is separated by. Two of them make the rate. */
const WINDOW_MS = 800

/**
 * The margin the post-Stop wait carries over the time the remaining work would have taken.
 *
 * Three, and the reason is that the estimate it multiplies is itself the run's own measured
 * rate rather than a guess — so the margin is covering scheduling noise on a loaded host, not
 * covering an unknown. A margin of one would make a slow tick indistinguishable from a stop
 * that worked.
 */
const REMAINING_WORK_MARGIN = 3

/** Floor and ceiling on that wait, so a pathological rate cannot make the case unbounded. */
const MIN_POST_STOP_WAIT_MS = 5_000
const MAX_POST_STOP_WAIT_MS = 90_000

let relay: FabricNode
let relayAddr: string
let server: ViteDevServer
let baseUrl: string
let browser: Browser
let context: BrowserContext

beforeAll(async () => {
  // DET-03: this node relays and executes nothing, so its anchor set covers nothing here.
  // The demo's own committed key rather than the provenance opt-out — `trust-anchors.node.test.ts`
  // bounds how far that literal may spread through the test suite, and this file has no
  // decision to record with it. This is the value a visitor's tab pins with no flags.
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

  browser = await launchFixtureBrowser(chromium)
  context = await browser.newContext()
}, 240_000)

afterAll(async () => {
  await context?.close().catch(() => {})
  await browser?.close().catch(() => {})
  await server?.close().catch(() => {})
  await relay?.stop().catch(() => {})
}, 180_000)

async function startedPage(store: string): Promise<Page> {
  const page = await context.newPage()
  await page.goto(`${baseUrl}${PAGE}`)
  await page.waitForFunction(() => typeof window.o2 !== 'undefined', null, { timeout: 60_000 })
  // BROW-01 has no test-only bypass: a harness consents for the same reason a visitor
  // clicks the button. AUTH-06, `42-06`: it signs in for the same reason too, because
  // `window.o2.start` refuses with `SignedOutError` until somebody has opened their own
  // envelope. `signInHarnessTab` does both, in the order its header explains.
  await signInHarnessTab(page)
  await page.evaluate(
    async ([address, name, duty]) => {
      return window.o2.start({
        relayAddrs: [address as string],
        blockstoreName: name as string,
        dutyCycle: duty as number,
      })
    },
    [relayAddr, store, DUTY_CYCLE] as [string, string, number],
  )
  return page
}

/** Tasks this tab has started, or `null` once there is no node to ask. */
async function executed(page: Page): Promise<number | null> {
  return page.evaluate(() => window.o2.activity()?.tasksExecuted ?? null)
}

describe('BROW-08 — Stop ends an in-flight task rather than waiting for it', () => {
  it('interrupts a running job: the work stops moving and the run never reports completion', async () => {
    const page = await startedPage('o2-hard-stop')

    // Dispatched WITHOUT awaiting: the promise is held here while the page runs, so Stop
    // lands on a job that is genuinely in flight rather than on one already reported.
    const run = page.evaluate(
      async ([n, cubes]) =>
        window.o2.runColouring({
          n: n as number,
          cubes: cubes as number,
          redundancy: 1,
          peerIds: [],
        }),
      [N, CUBES],
    )
    // Held rejections are read at the end. Attaching a sink now stops Node reporting the
    // rejection as unhandled before the case gets to it — and a rejected run is one of the
    // outcomes this case accepts, so it must not become a process-level failure.
    const settled: { value: unknown; failed: string | null; done: boolean } = {
      value: null,
      failed: null,
      done: false,
    }
    void run.then(
      (value) => {
        settled.value = value
        settled.done = true
      },
      (cause: unknown) => {
        settled.failed = String(cause)
        settled.done = true
      },
    )

    // ---- window 1: the moving floor -------------------------------------------------
    const before = await executed(page)
    const beforeAt = Date.now()
    await new Promise((resolve) => setTimeout(resolve, WINDOW_MS))
    const after = await executed(page)
    const afterAt = Date.now()

    expect(before, 'the page reported no activity at all, so no node was running').not.toBeNull()
    expect(after).not.toBeNull()
    const moved = (after ?? 0) - (before ?? 0)
    expect(
      moved,
      `BROW-08 floor: tasksExecuted went ${String(before)} -> ${String(after)} across ` +
        `${String(afterAt - beforeAt)} ms, i.e. it did not move. A stop that is measured against ` +
        'a fabric which never started measures nothing.',
    ).toBeGreaterThan(0)

    // The rate this run was actually going at, from this run — never a typed-in number.
    const ratePerMs = moved / (afterAt - beforeAt)
    const outstanding = CUBES - (after ?? 0)
    expect(
      outstanding,
      `BROW-08: at the moment of Stop the run had already started all ${String(CUBES)} of its ` +
        'shards, so what follows would be an observation of a finished job rather than of an ' +
        'interrupted one. Raise CUBES or shorten the pre-Stop window.',
    ).toBeGreaterThan(0)

    // ---- Stop -----------------------------------------------------------------------
    const stoppedAt = Date.now()
    await page.evaluate(async () => window.o2.stop())

    // ---- reading one: the surface is gone --------------------------------------------
    // UI-SPEC §4.1 — the element's absence IS the reading, and `activity()` answering null is
    // the same fact one layer down.
    expect(await executed(page)).toBeNull()
    expect(await page.isVisible('#bar')).toBe(false)

    // ---- reading two: the run does not report a completed job -------------------------
    // The wait is derived, not chosen: outstanding work divided by this run's own measured
    // rate, times a margin, clamped so a pathological rate cannot make the case unbounded.
    const wouldHaveTakenMs = outstanding / ratePerMs
    const waitMs = Math.min(
      MAX_POST_STOP_WAIT_MS,
      Math.max(MIN_POST_STOP_WAIT_MS, wouldHaveTakenMs * REMAINING_WORK_MARGIN),
    )
    await new Promise((resolve) => setTimeout(resolve, waitMs))

    // Compacted rather than dumped. The first draft put `JSON.stringify(settled.value)` in the
    // message and a red printed a 128-element `agreeing` array of one repeated peer id — four
    // screens of output in which the one number that mattered, `complete`, was unreadable.
    const shape = (value: unknown): { complete?: unknown; statuses?: unknown } | null =>
      typeof value === 'object' && value !== null ? (value as { complete?: unknown; statuses?: unknown }) : null

    // A rejection is not a completion, and neither is silence. What must not have happened is
    // a job coming back complete.
    const report = settled.failed === null && settled.done ? shape(settled.value) : null
    const completed = report?.complete === true

    // The sharper half of the same reading, and it is about SHARDS rather than about the job.
    // A shard that ran returns `found` or `exhausted`; a shard nobody executed comes back
    // `unagreed` with an empty `agreeing` list. So this counts the tasks that actually
    // finished, which is what criterion 3's *"no in-flight task is allowed to run to
    // completion"* is a statement about.
    const answered = Array.isArray(report?.statuses)
      ? report.statuses.filter((status) => status === 'found' || status === 'exhausted').length
      : null

    expect(
      completed,
      `BROW-08: the run held across Stop ${
        settled.failed !== null
          ? `rejected (${settled.failed})`
          : settled.done
            ? `resolved with complete=${String(report?.complete)} and ${String(answered)} of ${String(CUBES)} shards finished`
            : 'never settled'
      }. Measured in this run: tasksExecuted moved ` +
        `${String(moved)} in ${String(afterAt - beforeAt)} ms (${ratePerMs.toFixed(4)} tasks/ms), ` +
        `${String(outstanding)} of ${String(CUBES)} shards were outstanding at Stop, which at that ` +
        `rate would have taken ${wouldHaveTakenMs.toFixed(0)} ms; the wait after Stop was ` +
        `${waitMs.toFixed(0)} ms, i.e. ${REMAINING_WORK_MARGIN}x. A job that completed anyway ` +
        'means Stop let the in-flight work run on, which is the cooperative behaviour criterion ' +
        '3 names as failing.',
    ).toBe(false)

    if (answered !== null) {
      // The floor: shards did finish before Stop, so the shortfall below is a shortfall and
      // not a run that never began.
      expect(
        answered,
        'BROW-08 floor: no shard finished at all, so this run says nothing about work being ' +
          'interrupted — it says the fabric never computed anything',
      ).toBeGreaterThan(0)
      expect(
        answered,
        `BROW-08: ${String(answered)} of ${String(CUBES)} shards came back finished after a Stop ` +
          `that landed with ${String(outstanding)} outstanding. All of them finishing would mean ` +
          'the interrupted task, and everything queued behind it, was allowed to run to ' +
          'completion.',
      ).toBeLessThan(CUBES)
    }

    // Printed so the SUMMARY can carry both numbers rather than a verdict. `stoppedAt` is in
    // the line so a reader can place Stop between the two windows.
    process.stderr.write(
      `[BROW-08] window 1: ${String(before)} -> ${String(after)} tasks in ` +
        `${String(afterAt - beforeAt)} ms; Stop at +${String(stoppedAt - beforeAt)} ms; ` +
        `outstanding ${String(outstanding)}/${String(CUBES)}; waited ${waitMs.toFixed(0)} ms; ` +
        `shards finished ${String(answered)}/${String(CUBES)}; run complete=${String(report?.complete)}\n`,
    )

    await page.close()
  }, 300_000)
})
