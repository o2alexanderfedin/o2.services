/**
 * Criterion 1's live half — six counters moving on a real tab, read while the tab is running.
 *
 * *"Six stages are instrumented and reporting live … with each stage's count readable **while
 * the fabric is running**."* The word is *live*, and a reading taken after the page closed is
 * not it. So this spec opens one page, drives it, and reads `GET /funnel` **with the page still
 * open** — twice, with both raw vectors recorded in the failure text so a red is diagnosable in
 * one read and a green leaves the numbers behind.
 *
 * ## What it proves, and what nothing local can
 *
 * It proves the six counters move on a real browser tab against a real workerd, and that the
 * whole vector is readable over one HTTP request while that tab is still running. It proves
 * **nothing** about a deployed object; no local run can, and the last mile — a reading taken on
 * the deployed collector before the first invitation — is `37-RUNBOOK.md` step 2 and is an owner
 * act by the 2026-08-25 ruling.
 *
 * It is also **one tab**, so it is a proof of instrumentation and not a population reading.
 * Nothing here is evidence about what fraction of a general audience can participate; that
 * number does not exist yet, which is what `RUN-04` says in its own words.
 *
 * ## The arrangement, which Phase 35 proved and this does not rediscover
 *
 * `35-01-SUMMARY.md` § Task 4 records a browser tab dialling a LOCAL workerd for the first time
 * in this repository, and the address form that worked:
 * `/ip4/127.0.0.1/tcp/<port>/ws/p2p/<peerId>`, handed to the demo through `?relay=`, from an
 * `http://localhost` Vite origin. The funnel endpoint arrives the same way, through `?funnel=`.
 *
 * ## Scope fence
 *
 * Local workerd only, on its own port, with `--persist-to` a fresh `mkdtemp`,
 * `CLOUDFLARE_API_TOKEN` blanked and `WRANGLER_SEND_METRICS` off. Nothing is deployed and no
 * remote resource is created. Chromium only — criterion 1 names no engine requirement.
 *
 * ## Under the other reading of open question 3
 *
 * This spec consents before it starts, so every stage is reported either way and the case is
 * unchanged. What reading B would add is an arm that **never consents** and still reports stage
 * one. That arm is **not measured here** — which is different from saying it produces nothing.
 */

import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import type { Browser, Page } from 'playwright'
import { createServer } from 'vite'
import type { ViteDevServer } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FUNNEL_SCHEMA_DIGEST, FUNNEL_STAGES } from '@o2/net'
import type { FunnelStage } from '@o2/net'
import { KERNEL_RECORD, kernelBytes } from '@o2/demo'
import type { TabNameRecord } from '@o2/browser'
import { fixtureViteCacheDir } from './e2e-browser-launch.ts'

const CLOUDFLARE_DIR = fileURLToPath(new URL('../../cloudflare', import.meta.url))
const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const PAGE = 'packages/browser/demo/index.html'
const HOST = '127.0.0.1'
/** Its own port. 8791-8795 belong to the cloudflare e2e specs and 8798 to the collector's. */
const PORT = 8796
const ORIGIN = `http://${HOST}:${String(PORT)}`

/**
 * How long a stage is given to arrive.
 *
 * **Sited against something measured in this run, not against a number that looked right.**
 * `beforeAll` already waits up to 120 s for workerd and the page start is awaited to
 * completion, so by the time this budget applies the only outstanding work is a beacon in
 * flight and a 250 ms poll. It is generous by two orders of magnitude against that, which is
 * the shape `SETTLE_MS` in `stop-closes-the-billed-socket.e2e.test.ts` took after being wrong
 * at 2 s on a loaded host: this project sites a beat well above the worst reading rather than
 * near the typical one, and writes down why.
 */
const STAGE_DEADLINE_MS = 30_000

interface FunnelReading {
  readonly entered: Record<FunnelStage, number>
  readonly stalledAt: Record<FunnelStage, number>
  readonly population: string
  readonly schemaDigest: string
}

let worker: ChildProcess | undefined
let persistDir: string
let server: ViteDevServer
let baseUrl: string
let browser: Browser
let workerPeerId: string

/** `GET /funnel`, narrowed at the boundary rather than cast. */
async function readFunnel(): Promise<FunnelReading> {
  const response = await fetch(`${ORIGIN}/funnel`, { signal: AbortSignal.timeout(10_000) })
  if (!response.ok) throw new Error(`/funnel answered ${String(response.status)}`)
  const body: unknown = await response.json()
  if (
    typeof body !== 'object' ||
    body === null ||
    !('entered' in body) ||
    !('stalledAt' in body) ||
    !('population' in body) ||
    typeof body.population !== 'string' ||
    !('schemaDigest' in body) ||
    typeof body.schemaDigest !== 'string'
  ) {
    throw new Error(`/funnel answered a body this test cannot read: ${JSON.stringify(body)}`)
  }
  const counts = (value: unknown, name: string): Record<FunnelStage, number> => {
    if (typeof value !== 'object' || value === null) {
      throw new Error(`/funnel reported a ${name} that is not an object`)
    }
    const from = value as Record<string, unknown>
    const out = {} as Record<FunnelStage, number>
    for (const stage of FUNNEL_STAGES) {
      const count = from[stage]
      if (typeof count !== 'number') {
        throw new Error(`/funnel reported ${name}.${stage} as ${JSON.stringify(count)}`)
      }
      out[stage] = count
    }
    return out
  }
  return {
    entered: counts(body.entered, 'entered'),
    stalledAt: counts(body.stalledAt, 'stalledAt'),
    population: body.population,
    schemaDigest: body.schemaDigest,
  }
}

/** The whole vector on one line, for a failure message and for the SUMMARY. */
function render(reading: FunnelReading): string {
  const entered = FUNNEL_STAGES.map((s) => `${s}=${String(reading.entered[s])}`).join(' ')
  const stalled = FUNNEL_STAGES.filter((s) => reading.stalledAt[s] > 0)
    .map((s) => `${s}=${String(reading.stalledAt[s])}`)
    .join(' ')
  return `entered[ ${entered} ] stalledAt[ ${stalled === '' ? 'all zero' : stalled} ] population=${reading.population}`
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** Poll `GET /funnel` until every named stage has moved, or the deadline expires. */
async function until(stages: readonly FunnelStage[], deadlineMs: number): Promise<FunnelReading> {
  const deadline = Date.now() + deadlineMs
  let last = await readFunnel()
  while (Date.now() < deadline) {
    if (stages.every((stage) => last.entered[stage] > 0)) return last
    await sleep(250)
    last = await readFunnel()
  }
  return last
}

async function waitForSelf(timeoutMs: number): Promise<string> {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${ORIGIN}/self`, { signal: AbortSignal.timeout(3_000) })
      if (response.ok) {
        const body = (await response.json()) as { peerId?: unknown }
        if (typeof body.peerId === 'string') return body.peerId
      }
      lastError = new Error(`/self answered ${String(response.status)}`)
    } catch (cause) {
      lastError = cause
    }
    await sleep(500)
  }
  throw new Error(`workerd did not become ready within ${String(timeoutMs)} ms: ${String(lastError)}`)
}

beforeAll(async () => {
  persistDir = await mkdtemp(join(tmpdir(), 'o2-funnel-live-'))
  worker = spawn(
    'npx',
    ['wrangler', 'dev', '--port', String(PORT), '--local-protocol', 'http', '--persist-to', persistDir],
    {
      cwd: CLOUDFLARE_DIR,
      env: { ...process.env, CLOUDFLARE_API_TOKEN: '', WRANGLER_SEND_METRICS: 'false' },
      stdio: 'ignore',
    },
  )
  workerPeerId = await waitForSelf(120_000)

  server = await createServer({ root: ROOT, logLevel: 'error', server: { port: 0 }, cacheDir: fixtureViteCacheDir(ROOT) })
  await server.listen()
  const url = server.resolvedUrls?.local[0]
  if (url === undefined) throw new Error('vite dev server produced no URL')
  baseUrl = url.endsWith('/') ? url : `${url}/`

  browser = await chromium.launch()
}, 240_000)

afterAll(async () => {
  await browser?.close().catch(() => {})
  await server?.close().catch(() => {})
  worker?.kill('SIGTERM')
  await rm(persistDir, { recursive: true, force: true }).catch(() => {})
}, 120_000)

describe('RUN-04 criterion 1 — the counts are readable while the tab is still running', () => {
  it('moves the stages on a real tab, read live, with both vectors recorded', async () => {
    // ---- the zero floor, asserted as six literals -----------------------------------
    //
    // Without it every count below could be one this workerd was already carrying, and the
    // whole reading would be about more than this tab. Reported rather than subtracted: a
    // contaminated instrument is not an instrument with an offset.
    const floor = await readFunnel()
    expect(floor.entered, `criterion 1: this workerd was not at the floor — ${render(floor)}`).toEqual({
      'page-load': 0,
      consent: 0,
      'wss-bootstrap': 0,
      'ice-gathering': 0,
      'connection-classified': 0,
      'first-task': 0,
    })
    expect(floor.schemaDigest).toBe(FUNNEL_SCHEMA_DIGEST)
    expect(floor.population).toBe('opted-in-only')

    const address = `/ip4/${HOST}/tcp/${String(PORT)}/ws/p2p/${workerPeerId}`
    const page: Page = await browser.newPage()
    // `?relay=` names ONLY the local workerd, so the page reaches for no `/bootstrap.json` and
    // dials nothing else. `?funnel=` points at the same local origin — the reporter has no
    // default and would be inert without it.
    await page.goto(
      `${baseUrl}${PAGE}?relay=${encodeURIComponent(address)}&funnel=${encodeURIComponent(ORIGIN)}`,
    )
    await page.waitForFunction(() => typeof window.o2 !== 'undefined', null, { timeout: 60_000 })

    // Stage one is composed at module evaluation and HELD. Nothing has been sent yet, and that
    // is the property the pending arming point rests on — asserted, not assumed.
    const beforeConsent = await readFunnel()
    expect(
      beforeConsent.entered['page-load'],
      'RUN-04: a report left before the visitor consented. The reporter is armed at consent ' +
        'because that is the INTERSECTION of both readings of open question 3, and a send ' +
        `before it is the one thing that breaks that claim — ${render(beforeConsent)}`,
    ).toBe(0)

    // BROW-01 has no test-only bypass: a harness consents for the same reason a visitor clicks.
    await page.evaluate(() => {
      window.o2.grantConsent()
    })

    // ---- reading one, taken while the page is open ----------------------------------
    const armed = await until(['page-load', 'consent'], STAGE_DEADLINE_MS)
    expect(
      armed.entered['page-load'],
      `criterion 1: the held stage-one report did not arrive — ${render(armed)}`,
    ).toBe(1)
    expect(armed.entered['consent'], `criterion 1: stage two did not arrive — ${render(armed)}`).toBe(1)

    await page.evaluate(
      async ([relay]) =>
        window.o2.start({ relayAddrs: [relay as string], blockstoreName: 'o2-funnel-live' }),
      [address],
    )

    // ---- reading two, ALSO taken while the page is open, and this is the live claim --
    const running = await until(['wss-bootstrap'], STAGE_DEADLINE_MS)
    expect(
      running.entered['wss-bootstrap'],
      `criterion 1: the tab is on the fabric and stage three did not arrive — ${render(running)}`,
    ).toBe(1)

    // The page is still open and the fabric is still running at the moment of this read. That
    // is the whole of criterion 1's word "live", and it is asserted rather than implied.
    const stillOpen = await page.evaluate(() => window.o2.peers())
    expect(
      stillOpen,
      `criterion 1: the reading above was not taken while the fabric was running — ${render(running)}`,
    ).toContain(workerPeerId)

    // Both raw vectors, printed on a passing run so the SUMMARY does not have to guess.
    // eslint-disable-next-line no-console
    console.log(`[funnel-live] before consent: ${render(beforeConsent)}`)
    // eslint-disable-next-line no-console
    console.log(`[funnel-live] armed:          ${render(armed)}`)
    // eslint-disable-next-line no-console
    console.log(`[funnel-live] running:        ${render(running)}`)

    // ---- the stages that did NOT move are the interesting result --------------------
    //
    // Recorded rather than asserted away. A single tab against a WSS relay negotiates no
    // browser-to-browser WebRTC, so `ice-gathering` and `connection-classified` may legitimately
    // stay at zero here, and `first-task` needs work this arrangement does not dispatch. What
    // this case claims is stages one to three; the rest are read, printed, and left to
    // `funnel-attribution.e2e.test.ts` and to the SUMMARY.
    const unmoved = FUNNEL_STAGES.filter((stage) => running.entered[stage] === 0)
    // eslint-disable-next-line no-console
    console.log(`[funnel-live] did not move:   ${unmoved.length === 0 ? 'none' : unmoved.join(', ')}`)

    // The terminal report, driven by NAVIGATION rather than by closing the context: navigating
    // to `about:blank` fires `pagehide` reliably in Playwright, and a beacon in flight when the
    // browser dies is a beacon that never arrives.
    const furthest = FUNNEL_STAGES.filter((stage) => running.entered[stage] > 0).at(-1)
    await page.goto('about:blank')
    const afterLeaving = await (async (): Promise<FunnelReading> => {
      const deadline = Date.now() + STAGE_DEADLINE_MS
      let last = await readFunnel()
      while (Date.now() < deadline && furthest !== undefined && last.stalledAt[furthest] === 0) {
        await sleep(250)
        last = await readFunnel()
      }
      return last
    })()
    // eslint-disable-next-line no-console
    console.log(`[funnel-live] after leaving:  ${render(afterLeaving)}`)
    expect(
      furthest === undefined ? 0 : afterLeaving.stalledAt[furthest],
      `criterion 1: the visit ended at "${String(furthest)}" and no terminal report arrived, so ` +
        'the beacon on `pagehide` is not reaching the collector in this harness — ' +
        `${render(afterLeaving)}`,
    ).toBe(1)

    await page.close()
  }, 300_000)
})

/**
 * Stages four, five and six — the three a single tab against a WSS relay cannot reach.
 *
 * **This case exists because the case above did not move them, and the plan's rule is that a
 * stage is not reported as instrumented on the strength of a unit test alone.** `CLAUDE.md`'s
 * *wired is not used* was caught three times on the DHT and this is the same shape:
 * `ice-observer.test.ts` proves the observer reports once over a fake `RTCPeerConnection`, and
 * that says nothing about whether libp2p's real one ever passes through it in a real browser.
 *
 * ICE gathering happens on a **browser-to-browser** dial. One tab talking to a WSS relay never
 * attempts one, so the arrangement had to grow a second page — and that is the recorded answer
 * to "what did it take": two independent browser contexts, each with its own IndexedDB, one
 * dialling the other's `/webrtc` address over the relay that signalled it.
 *
 * Stage six needs work, so this case dispatches a real job over the demo's own committed
 * kernel with `includeSelf: true`, which makes the submitting tab execute a shard itself.
 *
 * The counters are shared with the case above — one collector, one object — so every assertion
 * here is a **delta** taken inside this run rather than an absolute.
 */
describe('RUN-04 criterion 1 — the three stages a single tab cannot reach', () => {
  it('reaches ICE gathering, a classified connection and a first task, with a second page', async () => {
    const before = await readFunnel()
    const address = `/ip4/${HOST}/tcp/${String(PORT)}/ws/p2p/${workerPeerId}`
    const url = `${baseUrl}${PAGE}?relay=${encodeURIComponent(address)}&funnel=${encodeURIComponent(ORIGIN)}`

    // Two CONTEXTS rather than two pages: each is an isolated origin with its own IndexedDB,
    // which is what makes them two independent nodes rather than one node in two windows.
    const contexts = await Promise.all([browser.newContext(), browser.newContext()])
    const pages = await Promise.all(contexts.map(async (context) => context.newPage()))
    try {
      const started = await Promise.all(
        pages.map(async (page) => {
          await page.goto(url)
          await page.waitForFunction(() => typeof window.o2 !== 'undefined', null, { timeout: 60_000 })
          return page.evaluate(
            async ([relay]) => {
              window.o2.grantConsent()
              return window.o2.start({ relayAddrs: [relay as string], blockstoreName: 'o2-funnel-live-2' })
            },
            [address],
          )
        }),
      )
      const [pageA, pageB] = pages as [Page, Page]
      const peerB = started[1] as string

      // Each tab needs a relayed address of its own before the other can dial it — the
      // `/webrtc` form resolves to `<relay>/p2p-circuit/webrtc/p2p/<self>`.
      const addrsB = await pageB.evaluate(async () => window.o2.waitForWebrtcAddr(60_000))
      const target = addrsB.find((one) => one.includes('/webrtc'))
      expect(target, 'tab B never advertised a /webrtc address, so no dial can be attempted').toBeDefined()

      await pageA.evaluate(async (one) => window.o2.dial(one), target as string)
      expect(await pageA.evaluate(() => window.o2.peers())).toContain(peerB)

      // ---- stage four, which the single-tab case could not reach ----------------------
      const gathered = await until(['ice-gathering'], STAGE_DEADLINE_MS)
      // eslint-disable-next-line no-console
      console.log(`[funnel-live] after webrtc:   ${render(gathered)}`)
      expect(
        gathered.entered['ice-gathering'] - before.entered['ice-gathering'],
        'RUN-04 stage four: a real browser-to-browser dial happened and the ICE observer saw ' +
          'nothing. The wrapper is installed before `BrowserNode.start`; if this is red, check ' +
          `that ordering first — ${render(gathered)}`,
      ).toBeGreaterThan(0)

      // ---- stages five and six, over a real job ---------------------------------------
      const moduleCid = await pageA.evaluate(
        async (bytes) => window.o2.putModule(bytes),
        [...kernelBytes],
      )
      expect(moduleCid).toBe(KERNEL_RECORD.cid.toString())
      const report = await pageA.evaluate(
        async ([cid, peer, signed]) =>
          window.o2.runJob({
            moduleCid: cid as string,
            moduleRecord: signed as TabNameRecord,
            peerIds: [peer as string],
            shards: 2,
            redundancy: 2,
            // The submitting tab executes a shard itself, which is what stage six needs to see.
            includeSelf: true,
          }),
        [moduleCid, peerB, { ...KERNEL_RECORD, cid: KERNEL_RECORD.cid.toString() }] as const,
      )
      expect(report.complete, `the job did not complete: ${JSON.stringify(report.failures)}`).toBe(true)

      const worked = await until(['first-task'], STAGE_DEADLINE_MS)
      // eslint-disable-next-line no-console
      console.log(`[funnel-live] after the job:  ${render(worked)}`)
      expect(
        worked.entered['connection-classified'] - before.entered['connection-classified'],
        `RUN-04 stage five: no connection was classified — ${render(worked)}`,
      ).toBeGreaterThan(0)
      expect(
        worked.entered['first-task'] - before.entered['first-task'],
        'RUN-04 stage six: a job completed and no tab reported a first task. The predicate is ' +
          "`executed >= 1 && executorInFlight === 0`, read off the 250 ms poll — if this is " +
          `red, check that the poll is running rather than that the job ran — ${render(worked)}`,
      ).toBeGreaterThan(0)
    } finally {
      await Promise.all(contexts.map(async (context) => context.close().catch(() => {})))
    }
  }, 300_000)
})
