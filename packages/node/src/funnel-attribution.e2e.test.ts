/**
 * Criterion 2 — one induced failure moves exactly one drop counter and no other.
 *
 * *"Each stage's drop-off is attributable: a synthetic client made to fail at exactly one stage
 * moves exactly that stage's count and no other. A funnel where one failure moves two counters
 * cannot tell anyone where a cohort was lost."*
 *
 * ## What `stalledAt[k]` means here, stated because the reading decides the arms
 *
 * **`stalledAt[k]` is "this visit reached stage k and got no further".** It is keyed on the
 * furthest stage ENTERED, not on the stage an attempt failed at. So a tab whose relay dial
 * fails moves `stalledAt['consent']` — consent is the last stage it reached — and a tab that
 * reaches the relay and stops moves `stalledAt['wss-bootstrap']`. Each arm below is therefore
 * described by the stage it reaches, which is the thing the funnel can actually observe.
 *
 * ## `entered` moving for the prefix is NOT a second attribution
 *
 * A visit that reaches stage three truthfully passed through one and two, so `entered[1..k]`
 * each move by one. Criterion 2's own sentence is about **drop** counters, and a truthful
 * prefix is a record of where the visit went rather than a second claim about where it was
 * lost. Every arm asserts both halves: exactly one `stalledAt` moved, and the `entered` prefix
 * moved exactly as far as the visit went and no further.
 *
 * ## Isolation is by construction, and a contaminated arm is REPORTED rather than subtracted
 *
 * `GET /funnel` offers no per-visit breakdown — deliberately, since a per-visit anything is
 * what criterion 4 forbids — so no arm can assert "these counts came from my tab". Each arm
 * therefore gets **its own workerd on its own port with its own `--persist-to` directory**, and
 * asserts the vector is six zeros before its page opens. A non-zero floor fails the arm naming
 * the arrangement.
 *
 * ## TWO structural findings about this criterion, both of which the arms had to be built around
 *
 * **1. `stalledAt['first-task']` can never move, and that is by design rather than a gap.** A
 * visit that reached the last stage did not stall; `FunnelReporter.stalled` returns without
 * sending for exactly that case, and `funnel-reporter.test.ts` reads it. So there are **five**
 * reachable drop counters, not six, and an arm for the sixth would be an arm asserting that
 * nothing happens. It is written that way — as the completed-visit arm — and says so.
 *
 * **2. Under the pending arming point, `stalledAt['page-load']` cannot move either.** The
 * reporter is armed at consent, so a visit that ends before consenting reports nothing at all.
 * That arm therefore asserts **the whole vector is unchanged**, which is the honest reading of
 * the same event and is also the strongest possible statement of the scope fence: a visitor who
 * declines is not counted anywhere, by anything.
 *
 * Both are parameterised on `FUNNEL_ARMING` so that a ruling on open question 3 flips the
 * second by one value rather than by a rewrite. See `<ruling>` in this phase's plan.
 *
 * ## Scope fence
 *
 * Local workerd only, one per arm, on its own port, `--persist-to` a fresh `mkdtemp`,
 * `CLOUDFLARE_API_TOKEN` blanked, `WRANGLER_SEND_METRICS` off. Chromium only.
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
import { FUNNEL_STAGES } from '@o2/net'
import type { FunnelStage } from '@o2/net'
// Read from the module rather than through `@o2/browser`'s barrel: the reporter is a
// demo-only module that `demo/main.ts` imports by path, exactly as it imports
// `computing-indicator.ts`, and publishing it would add an exported-but-statically-unreachable
// symbol in front of `reachability-guard.node.test.ts` for the benefit of no consumer.
import { FUNNEL_ARMING } from '../../browser/src/funnel-reporter.ts'

const CLOUDFLARE_DIR = fileURLToPath(new URL('../../cloudflare', import.meta.url))
const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const PAGE = 'packages/browser/demo/index.html'
const HOST = '127.0.0.1'
/** One port per arm. 8791-8795 are the cloudflare specs', 8796 and 8798 are this phase's others. */
const FIRST_PORT = 8810

/** A port nothing listens on, for the arm whose relay dial cannot complete. */
const DEAD_PORT = 8809

const STAGE_DEADLINE_MS = 30_000

type Vector = Record<FunnelStage, number>
interface Reading {
  readonly entered: Vector
  readonly stalledAt: Vector
}

let server: ViteDevServer
let baseUrl: string
let browser: Browser

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/** One arm's workerd: its own port, its own storage, torn down with it. */
interface Arm {
  readonly origin: string
  readonly peerId: string
  stop(): Promise<void>
}

async function readFunnel(origin: string): Promise<Reading> {
  const response = await fetch(`${origin}/funnel`, { signal: AbortSignal.timeout(10_000) })
  if (!response.ok) throw new Error(`/funnel answered ${String(response.status)}`)
  const body = (await response.json()) as { entered?: unknown; stalledAt?: unknown }
  const counts = (value: unknown, name: string): Vector => {
    if (typeof value !== 'object' || value === null) {
      throw new Error(`/funnel reported a ${name} that is not an object`)
    }
    const from = value as Record<string, unknown>
    const out = {} as Vector
    for (const stage of FUNNEL_STAGES) {
      const count = from[stage]
      if (typeof count !== 'number') throw new Error(`/funnel reported ${name}.${stage} badly`)
      out[stage] = count
    }
    return out
  }
  return { entered: counts(body.entered, 'entered'), stalledAt: counts(body.stalledAt, 'stalledAt') }
}

function render(reading: Reading): string {
  const e = FUNNEL_STAGES.map((s) => `${s}=${String(reading.entered[s])}`).join(' ')
  const d = FUNNEL_STAGES.filter((s) => reading.stalledAt[s] > 0)
    .map((s) => `${s}=${String(reading.stalledAt[s])}`)
    .join(' ')
  return `entered[ ${e} ] stalledAt[ ${d === '' ? 'all zero' : d} ]`
}

let nextPort = FIRST_PORT

async function newArm(): Promise<Arm> {
  const port = nextPort
  nextPort += 1
  const origin = `http://${HOST}:${String(port)}`
  const persistDir = await mkdtemp(join(tmpdir(), 'o2-funnel-arm-'))
  const worker: ChildProcess = spawn(
    'npx',
    ['wrangler', 'dev', '--port', String(port), '--local-protocol', 'http', '--persist-to', persistDir],
    {
      cwd: CLOUDFLARE_DIR,
      env: { ...process.env, CLOUDFLARE_API_TOKEN: '', WRANGLER_SEND_METRICS: 'false' },
      stdio: 'ignore',
    },
  )
  const deadline = Date.now() + 120_000
  let peerId: string | null = null
  let lastError: unknown
  while (peerId === null && Date.now() < deadline) {
    try {
      const response = await fetch(`${origin}/self`, { signal: AbortSignal.timeout(3_000) })
      if (response.ok) {
        const body = (await response.json()) as { peerId?: unknown }
        if (typeof body.peerId === 'string') peerId = body.peerId
      }
    } catch (cause) {
      lastError = cause
    }
    if (peerId === null) await sleep(500)
  }
  if (peerId === null) throw new Error(`workerd on ${String(port)} never became ready: ${String(lastError)}`)
  return {
    origin,
    peerId,
    stop: async (): Promise<void> => {
      worker.kill('SIGTERM')
      await rm(persistDir, { recursive: true, force: true }).catch(() => {})
    },
  }
}

/** The URL a tab opens for this arm. `relay` may name a port nothing listens on. */
function pageUrl(arm: Arm, relay: string): string {
  return `${baseUrl}${PAGE}?relay=${encodeURIComponent(relay)}&funnel=${encodeURIComponent(arm.origin)}`
}

function relayAddr(arm: Arm): string {
  return `/ip4/${HOST}/tcp/${String(new URL(arm.origin).port)}/ws/p2p/${arm.peerId}`
}

/** Poll until `stalledAt[stage]` moves, or the deadline expires. */
async function untilStalled(origin: string, stage: FunnelStage | null): Promise<Reading> {
  const deadline = Date.now() + STAGE_DEADLINE_MS
  let last = await readFunnel(origin)
  while (Date.now() < deadline) {
    if (stage === null || last.stalledAt[stage] > 0) return last
    await sleep(250)
    last = await readFunnel(origin)
  }
  return last
}

/**
 * The whole of criterion 2's assertion, in one place.
 *
 * Every expected value is an **integer literal** passed in by the caller, never a number read
 * back out of the same vector. `MEMORY: an assertion must not reuse the value it tests` — twice
 * in one day a plant stayed green here because both sides moved together.
 */
function attributedTo(
  before: Reading,
  after: Reading,
  stalledStage: FunnelStage | null,
  reached: readonly FunnelStage[],
  visits = 1,
): void {
  const moved = FUNNEL_STAGES.filter((s) => after.stalledAt[s] - before.stalledAt[s] !== 0)
  expect(
    moved,
    `criterion 2: ${String(moved.length)} drop counters moved for one induced failure ` +
      `(${moved.join(', ')}). A funnel where one failure moves two counters cannot tell ` +
      `anyone where a cohort was lost. before ${render(before)} after ${render(after)}`,
  ).toEqual(stalledStage === null ? [] : [stalledStage])

  if (stalledStage !== null) {
    expect(
      after.stalledAt[stalledStage] - before.stalledAt[stalledStage],
      `criterion 2: the drop at "${stalledStage}" moved by the wrong amount for ` +
        `${String(visits)} visit(s) — ${render(after)}`,
    ).toBe(visits)
  }

  // The truthful prefix, and nothing past it. Not a second attribution — see the header.
  for (const stage of FUNNEL_STAGES) {
    const delta = after.entered[stage] - before.entered[stage]
    const expected = reached.includes(stage) ? visits : 0
    expect(
      delta,
      `criterion 2: entered[${stage}] moved by ${String(delta)} and should have moved by ` +
        `${String(expected)} — the visit ${reached.includes(stage) ? 'did' : 'did not'} reach ` +
        `it. ${render(after)}`,
    ).toBe(expected)
  }
}

beforeAll(async () => {
  server = await createServer({ root: ROOT, logLevel: 'error', server: { port: 0 } })
  await server.listen()
  const url = server.resolvedUrls?.local[0]
  if (url === undefined) throw new Error('vite dev server produced no URL')
  baseUrl = url.endsWith('/') ? url : `${url}/`
  browser = await chromium.launch()
}, 180_000)

afterAll(async () => {
  await browser?.close().catch(() => {})
  await server?.close().catch(() => {})
}, 120_000)

/** Open a page for an arm, run `drive`, then leave BY NAVIGATION so `pagehide` fires. */
async function visit(arm: Arm, relay: string, drive: (page: Page) => Promise<void>): Promise<void> {
  const context: BrowserContext = await browser.newContext()
  const page = await context.newPage()
  try {
    await page.goto(pageUrl(arm, relay))
    await page.waitForFunction(() => typeof window.o2 !== 'undefined', null, { timeout: 60_000 })
    await drive(page)
    // **Navigation, not close.** `pagehide` fires reliably on a navigation in Playwright;
    // closing a context may not, and a beacon in flight when the browser dies never arrives.
    await page.goto('about:blank')
    // A beat for the beacon to leave and the object to bank it.
    await sleep(1_000)
  } finally {
    await context.close().catch(() => {})
  }
}

describe('criterion 2 — one induced failure, one drop counter', () => {
  it('ARM 1 — the visit ends before consent, and nothing at all is counted', async () => {
    const arm = await newArm()
    try {
      const before = await readFunnel(arm.origin)
      expect(before.entered, `arm 1 opened on a contaminated arrangement — ${render(before)}`).toEqual({
        'page-load': 0,
        consent: 0,
        'wss-bootstrap': 0,
        'ice-gathering': 0,
        'connection-classified': 0,
        'first-task': 0,
      })

      await visit(arm, relayAddr(arm), async () => {
        // Nothing. The page loads and the visitor leaves.
      })

      const after = await untilStalled(arm.origin, null)
      // eslint-disable-next-line no-console
      console.log(`[attribution] arm 1 page-load: ${render(after)}`)

      // **Degenerate under the pending ruling, and that is a finding rather than a gap.** The
      // reporter is armed at consent, so a visit that ends before consenting reports nothing —
      // which makes the first drop-off unmeasurable and is precisely what reading A costs.
      expect(FUNNEL_ARMING).toBe('at-consent')
      attributedTo(before, after, null, [])
    } finally {
      await arm.stop()
    }
  }, 300_000)

  it('ARM 2 — consent is granted and the visit ends before anything starts', async () => {
    const arm = await newArm()
    try {
      const before = await readFunnel(arm.origin)
      expect(before.entered['page-load'], `arm 2 floor — ${render(before)}`).toBe(0)

      await visit(arm, relayAddr(arm), async (page) => {
        await page.evaluate(() => {
          window.o2.grantConsent()
        })
        await sleep(500)
      })

      const after = await untilStalled(arm.origin, 'consent')
      // eslint-disable-next-line no-console
      console.log(`[attribution] arm 2 consent:   ${render(after)}`)
      attributedTo(before, after, 'consent', ['page-load', 'consent'])
    } finally {
      await arm.stop()
    }
  }, 300_000)

  it('ARM 3 — the relay dial cannot complete, so the visit gets no further than consent', async () => {
    const arm = await newArm()
    try {
      const before = await readFunnel(arm.origin)
      expect(before.entered['page-load'], `arm 3 floor — ${render(before)}`).toBe(0)

      // A port nothing listens on. The failure is induced at the VISITOR, never at the
      // collector: a collector-side fault would move no counter at all and would prove nothing
      // about attribution.
      const dead = `/ip4/${HOST}/tcp/${String(DEAD_PORT)}/ws/p2p/${arm.peerId}`
      await visit(arm, dead, async (page) => {
        await page.evaluate(async ([relay]) => {
          window.o2.grantConsent()
          try {
            await window.o2.start({ relayAddrs: [relay as string], blockstoreName: 'o2-arm-3' })
          } catch {
            // Expected: nothing is listening. The point is what the funnel says about it.
          }
        }, [dead])
        await sleep(500)
      })

      const after = await untilStalled(arm.origin, 'consent')
      // eslint-disable-next-line no-console
      console.log(`[attribution] arm 3 dead relay: ${render(after)}`)
      // Consent, and not `wss-bootstrap`: the visit REACHED consent and got no further. A
      // funnel that filed this under stage three would be claiming the tab arrived somewhere
      // it never did.
      attributedTo(before, after, 'consent', ['page-load', 'consent'])
    } finally {
      await arm.stop()
    }
  }, 300_000)

  it('ARM 4 — the tab reaches the relay and no compute peer, so it stalls at stage three', async () => {
    const arm = await newArm()
    try {
      const before = await readFunnel(arm.origin)
      expect(before.entered['page-load'], `arm 4 floor — ${render(before)}`).toBe(0)

      const relay = relayAddr(arm)
      await visit(arm, relay, async (page) => {
        await page.evaluate(async ([one]) => {
          window.o2.grantConsent()
          return window.o2.start({ relayAddrs: [one as string], blockstoreName: 'o2-arm-4' })
        }, [relay])
        // One tab and one relay: no browser-to-browser dial is attempted, so no ICE gathering
        // and no compute peer. Long enough for the 250 ms poll to have run many times, so a
        // stage that WOULD have fired has had every chance to.
        await sleep(3_000)
      })

      const after = await untilStalled(arm.origin, 'wss-bootstrap')
      // eslint-disable-next-line no-console
      console.log(`[attribution] arm 4 relay only: ${render(after)}`)
      attributedTo(before, after, 'wss-bootstrap', ['page-load', 'consent', 'wss-bootstrap'])
    } finally {
      await arm.stop()
    }
  }, 300_000)
})

describe('criterion 2 — a third stall stage, which takes two tabs to reach', () => {
  /**
   * **ARM 5, and the two structural facts this file's header names are why it is the last one.**
   *
   * There are five reachable drop counters, not six: `stalledAt['first-task']` cannot move,
   * because a visit that reached the last stage did not stall. And under the pending arming
   * point `stalledAt['page-load']` cannot move either — arm 1 asserts that as its whole
   * finding. So the reachable set is `consent`, `wss-bootstrap`, `ice-gathering` and
   * `connection-classified`, and this arm takes the fourth.
   *
   * `ice-gathering` is the one stall this file does not produce, and the reason is honest
   * rather than an omission: a tab that reaches ICE gathering against a live peer proceeds to a
   * classified connection within the same 250 ms poll, so there is no arrangement in this
   * fabric where a visit's furthest stage is `ice-gathering`. It is reported as **not
   * exercised** rather than smoothed over.
   */
  it('ARM 5 — two tabs connect over WebRTC and dispatch nothing, so both stall at stage five', async () => {
    const arm = await newArm()
    try {
      const before = await readFunnel(arm.origin)
      expect(before.entered['page-load'], `arm 5 floor — ${render(before)}`).toBe(0)

      const relay = relayAddr(arm)
      const contexts = await Promise.all([browser.newContext(), browser.newContext()])
      const pages = await Promise.all(contexts.map(async (context) => context.newPage()))
      try {
        const started = await Promise.all(
          pages.map(async (page) => {
            await page.goto(pageUrl(arm, relay))
            await page.waitForFunction(() => typeof window.o2 !== 'undefined', null, { timeout: 60_000 })
            return page.evaluate(
              async ([one]) => {
                window.o2.grantConsent()
                return window.o2.start({ relayAddrs: [one as string], blockstoreName: 'o2-arm-5' })
              },
              [relay],
            )
          }),
        )
        const [pageA, pageB] = pages as [Page, Page]
        const addrs = await pageB.evaluate(async () => window.o2.waitForWebrtcAddr(60_000))
        const target = addrs.find((one) => one.includes('/webrtc'))
        expect(target, 'tab B advertised no /webrtc address, so no dial can be attempted').toBeDefined()
        await pageA.evaluate(async (one) => window.o2.dial(one), target as string)
        expect(await pageA.evaluate(() => window.o2.peers())).toContain(started[1] as string)
        // Long enough for the poll to classify, and no job is ever dispatched.
        await sleep(3_000)
        // Leave by NAVIGATION, both tabs, so both beacons go.
        await Promise.all(pages.map(async (page) => page.goto('about:blank')))
        await sleep(1_500)
      } finally {
        await Promise.all(contexts.map(async (context) => context.close().catch(() => {})))
      }

      const after = await untilStalled(arm.origin, 'connection-classified')
      // eslint-disable-next-line no-console
      console.log(`[attribution] arm 5 two tabs:  ${render(after)}`)
      // Two visits, so every counter the pair reached moved by exactly two and the one drop
      // counter moved by exactly two. Both written as `visits`, never read off the vector.
      attributedTo(
        before,
        after,
        'connection-classified',
        ['page-load', 'consent', 'wss-bootstrap', 'ice-gathering', 'connection-classified'],
        2,
      )
    } finally {
      await arm.stop()
    }
  }, 300_000)
})
