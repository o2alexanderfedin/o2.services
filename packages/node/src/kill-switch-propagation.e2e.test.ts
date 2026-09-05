/**
 * RUN-02 criterion 3 — the propagation window, measured over a population and published.
 *
 * The criterion's own words: *"elapsed time from flipping the switch to the last observed tab
 * stopping, recorded with the population it was taken over"*, and — the clause that governs
 * what this file may conclude — *"Open question 2 governs what is done about that number; this
 * criterion only requires that it exists."*
 *
 * ## `t0` and the observation moments are the SAME clock
 *
 * `t0` is `Date.now()` on the line immediately after the `POST /admission` response is read,
 * in this Node process. Each tab's moment is `Date.now()` inside its own page, taken by the
 * kill switch the first time `halted()` turns true. Both are the host's system clock — one
 * machine, one clock, no skew term — which is what makes `max(observed) - t0` a duration
 * rather than a difference between two unrelated readings. On more than one machine it would
 * not be, and that is one of the reasons this number is a single-host reading.
 *
 * **The moment is taken in the page, never by the harness polling it.** A harness that
 * timestamped its own read would be publishing its own poll interval.
 *
 * ## Two intervals, and why one reading would say nothing
 *
 * The window is taken at a short interval and at the production
 * `ADMISSION_POLL_INTERVAL_MS`, and reported both as raw milliseconds and as the ratio
 * `window / interval`. A single reading is a number with no way to tell what it is a number
 * *about*: if the two ratios are close, the window's dominant term is the poll interval and
 * the mechanism is understood; if they diverge, something else dominates and the figure needs
 * a different explanation. That comparison is taken **inside one run**, which is `CLAUDE.md`'s
 * rule: *"A ratio taken within one run cancels [the machine, the load and the I/O weather]."*
 *
 * ## The tabs are started and polling, and are NOT running jobs — a stated substitution
 *
 * The plan asked for `N` tabs "all executing". They are started, joined and polling, and they
 * run no colouring. Running `N` colouring jobs on one host would put `N` worker threads in
 * contention with the browser's own event loops, and the window would then be a measurement of
 * this machine's scheduler rather than of a directive arriving. What is being measured is when
 * a tab *hears*; whether it was busy at the time is a different question, and one this host
 * cannot answer honestly at `N` tabs.
 *
 * ## What this number is NOT
 *
 * It is a **Durable-Object-storage poll**, not Workers KV. Open question 2 is framed in KV's
 * terms and **the ~60 s KV propagation figure remains unmeasured by this phase**. It is also a
 * single host, so it carries no network term; and `N` tabs on one machine is not a cohort —
 * Phase 39 criterion 5 exists because *"a control that works at three tabs and not at three
 * hundred is a control nobody has."* All of that is written into `propagation-window.ts` where
 * a reader of the figure will find it.
 */

import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import type { Browser, BrowserContext, Page } from 'playwright'
import { createServer } from 'vite'
import type { ViteDevServer } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ADMISSION_KEY_HEADER } from '../../cloudflare/src/admission-flag.ts'
import { ADMISSION_POLL_INTERVAL_MS } from '../../browser/src/kill-switch.ts'
import {
  PROPAGATION_BAND,
  PROPAGATION_INTERVAL_MS,
  PROPAGATION_POPULATION,
  PROPAGATION_WINDOW_MS,
} from '../../browser/src/propagation-window.ts'
import { fixtureViteCacheDir } from './e2e-browser-launch.ts'
import { signInHarnessTab } from './e2e-signin.ts'

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const CLOUDFLARE_DIR = fileURLToPath(new URL('../../cloudflare', import.meta.url))
const PAGE = 'packages/browser/demo/index.html'
const HOST = '127.0.0.1'
/** Its own port: 8791–8798, 8801–8807 are taken by the specs already in the tree. */
const PORT = 8808
const REGION = 'bootstrap-eu'
const TEST_KEY = 'phase-36-propagation-local-operator-key'

/**
 * How many tabs the window is taken over.
 *
 * **Six, and the number is a trade rather than a preference.** `max` over one tab is not a
 * statement about a population at all; over six it is a maximum of six independent polls, each
 * started at a moment this file did not choose, so the window is dominated by whichever tab
 * happened to have just polled when the flip landed — which is the quantity the criterion asks
 * for. Above roughly a dozen chromium contexts this host starts scheduling them against each
 * other and the number becomes a reading of the machine; `PROPAGATION_COVERS` says so.
 */
const POPULATION = 6

/** The short arm. Well under the production interval, so the two ratios are comparable. */
const SHORT_INTERVAL_MS = 2_000

let worker: ChildProcess | undefined
let persistDir: string
let server: ViteDevServer
let baseUrl: string
let browser: Browser
let workerPeerId: string
const contexts: BrowserContext[] = []

async function readSelf(): Promise<Record<string, unknown>> {
  const response = await fetch(`http://${HOST}:${String(PORT)}/self`, {
    signal: AbortSignal.timeout(5_000),
  })
  if (!response.ok) throw new Error(`/self answered ${String(response.status)}`)
  const body: unknown = await response.json()
  if (typeof body !== 'object' || body === null) throw new Error('/self answered no object')
  return { ...body }
}

async function waitForReady(timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      const self = await readSelf()
      if (typeof self['peerId'] === 'string') return self['peerId']
    } catch (cause) {
      lastError = cause
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`workerd not ready in ${String(timeoutMs)} ms: ${String(lastError)}`)
}

async function postAdmission(body: unknown): Promise<number> {
  const response = await fetch(`http://${HOST}:${String(PORT)}/admission`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', [ADMISSION_KEY_HEADER]: TEST_KEY },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5_000),
  })
  // Read to completion before `t0` is taken, so `t0` is *the write having returned* and not
  // *the headers having arrived*.
  await response.text()
  return response.status
}

beforeAll(async () => {
  persistDir = await mkdtemp(join(tmpdir(), 'o2-propagation-'))
  worker = spawn(
    'npx',
    [
      'wrangler',
      'dev',
      '--port',
      String(PORT),
      '--local-protocol',
      'http',
      '--persist-to',
      persistDir,
      '--var',
      `O2_REGION:${REGION}`,
      '--var',
      `O2_ADMISSION_KEY:${TEST_KEY}`,
    ],
    {
      cwd: CLOUDFLARE_DIR,
      env: { ...process.env, CLOUDFLARE_API_TOKEN: '', WRANGLER_SEND_METRICS: 'false' },
      stdio: ['ignore', 'ignore', 'pipe'],
      detached: true,
    },
  )
  worker.stderr?.on('data', (chunk: Buffer) => {
    const text = chunk.toString()
    if (text.includes('ERROR')) process.stdout.write(`[workerd] ${text}`)
  })
  workerPeerId = await waitForReady(120_000)

  server = await createServer({ root: ROOT, logLevel: 'error', server: { port: 0 }, cacheDir: fixtureViteCacheDir(ROOT) })
  await server.listen()
  const url = server.resolvedUrls?.local[0]
  if (url === undefined) throw new Error('vite dev server produced no URL')
  baseUrl = url.endsWith('/') ? url : `${url}/`

  browser = await chromium.launch()
}, 400_000)

afterAll(async () => {
  try {
    for (const context of contexts) await context.close().catch(() => {})
    await browser?.close().catch(() => {})
    await server?.close().catch(() => {})
    if (worker?.pid !== undefined) {
      try {
        process.kill(-worker.pid, 'SIGTERM')
      } catch {
        worker.kill('SIGTERM')
      }
    }
  } finally {
    await rm(persistDir, { recursive: true, force: true }).catch(() => {})
  }
}, 120_000)

interface ArmReading {
  readonly intervalMs: number
  readonly population: number
  readonly windowMs: number
  readonly perTabMs: readonly number[]
  readonly ratio: number
}

/**
 * One arm: `POPULATION` fresh tabs at one poll interval, flipped once, every observation read.
 *
 * Fresh contexts per arm on purpose. Reusing the first arm's tabs would leave them holding a
 * directive they had already observed, and `firstHaltedAt` never moves once set — so the
 * second arm would report the first arm's number.
 */
async function measureArm(intervalMs: number): Promise<ArmReading> {
  // Back to admitting before the tabs join, so each arm measures its own flip. Read back
  // rather than assumed: a tab that started against a halted object would record an
  // observation before `t0` and the window would be negative.
  expect(await postAdmission({ region: REGION, halted: false, versions: 'all', since: null, note: '' })).toBe(200)
  expect((await readSelf())['admission']).toMatchObject({ halted: false })

  const address = `/ip4/${HOST}/tcp/${String(PORT)}/ws/p2p/${workerPeerId}`
  const pages: Page[] = []
  for (let index = 0; index < POPULATION; index += 1) {
    const context = await browser.newContext()
    contexts.push(context)
    const page = await context.newPage()
    await page.goto(`${baseUrl}${PAGE}?relay=${encodeURIComponent(address)}`)
    await page.waitForFunction(() => typeof window.o2 !== 'undefined', null, { timeout: 60_000 })
    // BROW-01 / AUTH-06: a harness consents and signs in for the same reasons a visitor
    // presses the two controls — see `signInHarnessTab`.
    await signInHarnessTab(page)
    await page.evaluate(
      async ([addr, name, poll]) => {
        return window.o2.start({
          relayAddrs: [addr as string],
          blockstoreName: name as string,
          admissionPollIntervalMs: poll as number,
        })
      },
      [address, `o2-prop-${String(intervalMs)}-${String(index)}`, intervalMs] as [string, string, number],
    )
    pages.push(page)
  }

  // Every tab has read at least once and reports NOT halted. Without this the flip could land
  // before a tab's first poll, and that tab's observation would be its startup rather than the
  // directive's arrival.
  for (const page of pages) {
    await page.waitForFunction(
      () => (window.o2.admissionState()?.reads ?? 0) > 0 && window.o2.admissionState()?.halted === false,
      null,
      { timeout: 60_000 },
    )
  }

  const status = await postAdmission({
    region: REGION,
    halted: true,
    versions: 'all',
    since: Date.now(),
    note: 'phase 36 — the propagation window',
  })
  const t0 = Date.now()
  expect(status, 'the flip was refused, so there was nothing for the tabs to observe').toBe(200)

  // Long enough that even a tab which polled a millisecond before the flip has two chances.
  const deadline = t0 + intervalMs * 3 + 20_000
  const observed: number[] = []
  for (const page of pages) {
    const at = await page.waitForFunction(
      () => window.o2.admissionState()?.observedAt ?? null,
      null,
      { timeout: Math.max(5_000, deadline - Date.now()) },
    )
    observed.push((await at.jsonValue()) as number)
  }

  const perTabMs = observed.map((at) => at - t0)
  const windowMs = Math.max(...perTabMs)
  return {
    intervalMs,
    population: POPULATION,
    windowMs,
    perTabMs,
    ratio: windowMs / intervalMs,
  }
}

describe('RUN-02 criterion 3 — how long a halt takes to reach the last tab', () => {
  it('measures the window at two poll intervals and compares them inside one run', async () => {
    const shortArm = await measureArm(SHORT_INTERVAL_MS)
    const productionArm = await measureArm(ADMISSION_POLL_INTERVAL_MS)

    for (const arm of [shortArm, productionArm]) {
      console.log(
        `[RUN-02 propagation] N=${String(arm.population)} interval=${String(arm.intervalMs)} ms ` +
          `window=${String(arm.windowMs)} ms ratio=${arm.ratio.toFixed(3)} ` +
          `per-tab=[${arm.perTabMs.join(', ')}]`,
      )
    }

    // Every tab observed it: `max` over a population, not a reading from whichever tab
    // answered first.
    expect(shortArm.perTabMs.length).toBe(POPULATION)
    expect(productionArm.perTabMs.length).toBe(POPULATION)
    // No observation precedes the write returning. A negative elapsed time would mean a tab
    // recorded a halt this run did not cause, and the window would be meaningless.
    for (const elapsed of [...shortArm.perTabMs, ...productionArm.perTabMs]) {
      expect(elapsed).toBeGreaterThanOrEqual(0)
    }

    // **The comparison the two arms exist for.** A window whose dominant term is the poll
    // interval scales with it: the ratio stays roughly where it was while the raw milliseconds
    // move by the interval's own factor. Both ratios at or under 1 means no tab needed more
    // than one interval to hear — which is what a poll costs, and it is the whole of what this
    // number says.
    expect(
      shortArm.ratio,
      `the short arm needed ${shortArm.ratio.toFixed(2)} intervals to reach the last tab, so ` +
        'something other than the poll dominates the window and the figure needs a different ' +
        'explanation from the one `propagation-window.ts` gives.',
    ).toBeLessThanOrEqual(1.5)
    expect(
      productionArm.ratio,
      `the production arm needed ${productionArm.ratio.toFixed(2)} intervals to reach the last ` +
        'tab. See the short arm’s message.',
    ).toBeLessThanOrEqual(1.5)
    // And the raw window really did move with the interval, which is what says the ratio is
    // measuring a poll rather than a constant.
    expect(productionArm.windowMs).toBeGreaterThan(shortArm.windowMs)

    // ---- The anti-staleness guard, on `data-cost.ts`'s model. -------------------------
    //
    // The published literal describes the PRODUCTION arm, so it is compared against the
    // production arm and not the short one — a literal and a measurement taken at different
    // intervals would be about different things. Neither side is computed from the other:
    // `PROPAGATION_WINDOW_MS` is hand-written and this is a live reading.
    expect(PROPAGATION_INTERVAL_MS).toBe(ADMISSION_POLL_INTERVAL_MS)
    expect(PROPAGATION_POPULATION).toBe(POPULATION)
    expect(
      Math.abs(productionArm.windowMs - PROPAGATION_WINDOW_MS),
      `RUN-02: the published propagation window is ${String(PROPAGATION_WINDOW_MS)} ms and this ` +
        `run measured ${String(productionArm.windowMs)} ms over ${String(POPULATION)} tabs at a ` +
        `${String(ADMISSION_POLL_INTERVAL_MS)} ms poll — a difference of ` +
        `${String(Math.abs(productionArm.windowMs - PROPAGATION_WINDOW_MS))} ms against a band of ` +
        `±${String(PROPAGATION_BAND)} ms. The figure a volunteer reads on the status page and ` +
        'the figure this fabric actually delivers have diverged; fix whichever moved — the ' +
        'literal if the mechanism changed, the mechanism if it regressed.',
    ).toBeLessThanOrEqual(PROPAGATION_BAND)
  }, 400_000)
})
