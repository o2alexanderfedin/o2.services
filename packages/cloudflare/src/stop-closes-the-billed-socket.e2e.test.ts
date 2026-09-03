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

/**
 * BROW-08, second half — the socket the operator is billed for closes with the tab.
 *
 * ## Why duration and not messages
 *
 * Criterion 3's own sentence: *"on this platform cost is held sockets, not messages, so a stop
 * that leaves the socket open has not stopped anything the operator pays for."* A tab that
 * terminates its worker and leaves a WebSocket open has dropped its own CPU to zero and moved
 * the cost onto somebody else, silently. So the reading is `/self`'s
 * `traffic.direct.connectionSeconds`.
 *
 * ## Why that counter can be read at all
 *
 * `traffic-split.ts:50-56` is the sentence this whole file rests on: *"`report` therefore adds
 * `now - openedAt` for each live connection to the total already banked from closed ones… the
 * counter does not depend on observing every close, which on a tab that is killed is not
 * observable at all."* A live socket therefore accrues **at read time**, and a closed one stops
 * — which is exactly the difference this case has to see, and it works whether the tab closed
 * politely or was killed outright.
 *
 * ## A browser tab dialling a LOCAL workerd — a first for this repository
 *
 * No existing e2e had a browser tab dial a local workerd; Phase 32's tabs dialled the deployed
 * WSS relay. The transport matrix permits insecure `ws://` only for `localhost`, and the demo
 * is served from an `http://localhost` Vite origin, so the address form is
 * `/ip4/127.0.0.1/tcp/<port>/ws/p2p/<peerId>` and it is handed to the page through the demo's
 * own `?relay=` parameter. **Proved by probe before this file was written**, and the probe's
 * numbers are in the phase SUMMARY: the tab started, `window.o2.peers()` came back holding the
 * workerd's PeerId, and `/self` went `0 → 2.069 → 4.081 → 6.106 → 8.119` connection-seconds
 * across four two-second windows.
 *
 * ## Isolation is by construction, and contamination is loud rather than subtracted
 *
 * `/self` answers `peerId`, `nodeKey`, `instance`, `version`, `traffic` and `relayService`
 * (`worker.ts:448-472`) — **there is no connection count and no connection list**, so this file
 * cannot assert "the object holds exactly one connection". Isolation is therefore arranged
 * instead of measured: a fresh `wrangler dev` on its own port, with its own `--persist-to`
 * directory, whose address is handed to exactly one page. What *is* measured is the
 * precondition — `connectionSeconds` must be **zero before the tab dials** — and a non-zero
 * reading there fails the case naming the arrangement rather than being subtracted out.
 *
 * ## `--persist-to`, which `hosted-record-store.e2e.test.ts` does not pass
 *
 * That file spawns `wrangler dev` with no `--persist-to`, so it inherits
 * `packages/cloudflare/.wrangler/state` and carries Durable Object storage across runs. Its own
 * comment records what that cost: a case *"passed for the wrong reason twice"* because a record
 * written by an earlier run was still there. Recorded here as a finding about that file; it is
 * not edited by this phase.
 *
 * ## Scope fence
 *
 * Local workerd only. `CLOUDFLARE_API_TOKEN` is blanked so a path reaching for Cloudflare fails
 * here instead of quietly succeeding on an ambient credential, `WRANGLER_SEND_METRICS` is off,
 * nothing is deployed and no remote resource is created.
 */

const PACKAGE_DIR = fileURLToPath(new URL('..', import.meta.url))
const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const PAGE = 'packages/browser/demo/index.html'
const HOST = '127.0.0.1'

/** Its own port: 8791–8794 are taken by the four cloudflare e2e specs already in this package. */
const PORT = 8795

/**
 * The window each of the two deltas is measured over.
 *
 * A live connection accrues one second of `connectionSeconds` per second of wall clock, so the
 * expected pre-Stop delta is `WINDOW_MS / 1000` and the window is chosen against the noise
 * rather than against the signal: a `/self` round trip on a loaded host costs tens of
 * milliseconds, so four seconds puts the reading two orders of magnitude above the jitter. It
 * is not a threshold — nothing below is compared against a number of seconds. Both deltas are
 * measured the same way in the same run and the verdict is their ratio.
 */
const WINDOW_MS = 4_000

/**
 * Time given to the close after Stop returns, before the second window opens.
 *
 * **Measured rather than chosen, and the first value was wrong.** It was 2 000 ms, on the
 * strength of a probe in which the counter was frozen 1 500 ms after Stop. The case then
 * failed on a host at load 29 with *"after Stop the connection went on accruing at 78.2 % of
 * its pre-Stop rate — t0=0.494 t1=4.550 t2=6.771 t3=9.944"*: the counter went on climbing for
 * about **5.2 s** after Stop and then froze.
 *
 * That is a real property of the arrangement and not noise, so it is written down rather than
 * tuned away: **the object learns of the close some seconds after the tab initiates it, and
 * the delay grows with host load.** The tab does not control it — `libp2p.stop()` has
 * returned — and from the operator's side those seconds are genuinely billed. What criterion 3
 * asks is that the accrual *stops*, not that it stops instantaneously, so the settling beat is
 * sited about four times above the worst reading taken so far.
 */
const SETTLE_MS = 20_000

/**
 * How near zero the second delta has to be, as a fraction of the first.
 *
 * A ratio and not a duration, so the case says the same thing on a fast host and a slow one.
 * The probe measured this at exactly `0` — a closed connection accrues nothing at all rather
 * than a little — so the allowance is entirely for a socket that takes a moment to close after
 * `stop()` returns, which `SETTLE_MS` is already meant to cover.
 */
const NEAR_ZERO = 0.1

interface TrafficLeg {
  readonly connectionSeconds: number
  readonly bytes: number
}
interface SelfReport {
  readonly peerId: string
  readonly traffic: { readonly direct: TrafficLeg; readonly relayed: TrafficLeg }
}

let worker: ChildProcess | undefined
let persistDir: string
let server: ViteDevServer
let baseUrl: string
let browser: Browser
let selfReport: SelfReport

/**
 * Read `/self` and narrow it at the boundary.
 *
 * A cast would make a route that stopped reporting `traffic` present as a field of `undefined`
 * inside an arithmetic comparison rather than as a failure where it happened —
 * `inbound-listener.e2e.test.ts` makes the same argument about the same route.
 */
async function readSelf(): Promise<SelfReport> {
  const response = await fetch(`http://${HOST}:${String(PORT)}/self`, {
    signal: AbortSignal.timeout(5_000),
  })
  if (!response.ok) throw new Error(`/self answered ${String(response.status)}`)
  const body: unknown = await response.json()
  if (
    typeof body !== 'object' ||
    body === null ||
    !('peerId' in body) ||
    typeof body.peerId !== 'string' ||
    !('traffic' in body) ||
    typeof body.traffic !== 'object' ||
    body.traffic === null ||
    !('direct' in body.traffic) ||
    !('relayed' in body.traffic)
  ) {
    throw new Error(`/self answered a body this test cannot read: ${JSON.stringify(body)}`)
  }
  const leg = (value: unknown): TrafficLeg => {
    if (
      typeof value !== 'object' ||
      value === null ||
      !('connectionSeconds' in value) ||
      !('bytes' in value) ||
      typeof value.connectionSeconds !== 'number' ||
      typeof value.bytes !== 'number'
    ) {
      throw new Error(`/self reported a traffic leg that is not two numbers: ${JSON.stringify(value)}`)
    }
    return { connectionSeconds: value.connectionSeconds, bytes: value.bytes }
  }
  return {
    peerId: body.peerId,
    traffic: { direct: leg(body.traffic.direct), relayed: leg(body.traffic.relayed) },
  }
}

async function waitForReady(timeoutMs: number): Promise<SelfReport> {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      return await readSelf()
    } catch (cause) {
      lastError = cause
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`workerd did not become ready within ${String(timeoutMs)} ms: ${String(lastError)}`)
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

beforeAll(async () => {
  persistDir = await mkdtemp(join(tmpdir(), 'o2-billed-socket-'))
  worker = spawn(
    'npx',
    [
      'wrangler',
      'dev',
      '--port',
      String(PORT),
      '--local-protocol',
      'http',
      // The scope fence's own clause, and also the fix for the false green
      // `hosted-record-store.e2e.test.ts` records: state from an earlier run cannot reach
      // this one, because there is no earlier run in this directory.
      '--persist-to',
      persistDir,
    ],
    {
      cwd: PACKAGE_DIR,
      env: { ...process.env, CLOUDFLARE_API_TOKEN: '', WRANGLER_SEND_METRICS: 'false' },
      stdio: 'ignore',
    },
  )
  selfReport = await waitForReady(120_000)

  server = await createServer({
    root: ROOT,
    logLevel: 'error',
    server: { port: 0 },
    // One optimiser cache per `vitest run`, not one shared by every lane on the machine.
    // See `fixtureViteCacheDir` in packages/node/src/e2e-browser-launch.ts for the race this
    // closes and for the reading that established it: two Vite servers on one `cacheDir`
    // leave the loser's live pages asking for dep modules under a `browserHash` that no
    // longer exists, and Vite answers `504 Outdated Optimize Dep`.
    //
    // Written out here rather than imported, because no `packages/cloudflare` spec reaches
    // into `packages/node` today and a bug fix is not the place to open that route. The key
    // is `process.ppid` — measured identical across the files of one invocation and distinct
    // across concurrent ones — so it must stay in step with the helper if either moves.
    cacheDir: join(ROOT, 'node_modules', `.vite-e2e-${String(process.ppid)}`),
  })
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

/** The workerd's own dialable address, in the one form a browser may use on localhost. */
function workerAddress(): string {
  return `/ip4/${HOST}/tcp/${String(PORT)}/ws/p2p/${selfReport.peerId}`
}

describe('BROW-08 — Stop closes the connection the hosted tier is billed for', () => {
  it('stops the duration billing this connection was accruing, measured as a ratio of two windows', async () => {
    // The isolation precondition, measured. Nothing else has been handed this address, and the
    // object was created seconds ago in a directory that did not exist before this run.
    const beforeDial = await readSelf()
    expect(
      beforeDial.traffic.direct.connectionSeconds,
      `BROW-08: this workerd was already accruing ${String(beforeDial.traffic.direct.connectionSeconds)} ` +
        'connection-seconds before the tab dialled it, so the arrangement is not isolated and the ' +
        'readings below would be about more than one connection. This is reported rather than ' +
        'subtracted: a contaminated instrument is not an instrument with an offset.',
    ).toBe(0)

    const address = workerAddress()
    const page: Page = await browser.newPage()
    // `?relay=` names **only** the local workerd. `demo/main.ts` takes an explicit `?relay=`
    // ahead of every other source, so this page will not reach for `/bootstrap.json` and will
    // not dial anything else.
    await page.goto(`${baseUrl}${PAGE}?relay=${encodeURIComponent(address)}`)
    await page.waitForFunction(() => typeof window.o2 !== 'undefined', null, { timeout: 60_000 })
    await page.evaluate(
      async ([relay]) => {
        // BROW-01 has no test-only bypass: a harness consents for the same reason a visitor
        // clicks the button.
        window.o2.grantConsent()
        return window.o2.start({ relayAddrs: [relay as string], blockstoreName: 'o2-billed-socket' })
      },
      [address],
    )

    // The tab holds the socket, read from the page's side as well as the object's. Both, so a
    // reading that only the object could see would not be mistaken for a connection.
    const peers = await page.evaluate(() => window.o2.peers())
    expect(
      peers,
      'BROW-08: the tab started but is not holding the workerd as a peer, so what the counter ' +
        'below measures is not this tab',
    ).toContain(selfReport.peerId)

    // Wait until the object agrees a direct connection exists before the first window opens.
    const dialDeadline = Date.now() + 60_000
    let live = await readSelf()
    while (live.traffic.direct.connectionSeconds === 0 && Date.now() < dialDeadline) {
      await sleep(250)
      live = await readSelf()
    }
    expect(live.traffic.direct.connectionSeconds).toBeGreaterThan(0)

    // ---- window 1: the socket is accruing ------------------------------------------
    const t0 = await readSelf()
    await sleep(WINDOW_MS)
    const t1 = await readSelf()

    // ---- Stop ------------------------------------------------------------------------
    await page.evaluate(async () => window.o2.stop())
    await sleep(SETTLE_MS)

    // ---- window 2: it should not be ---------------------------------------------------
    const t2 = await readSelf()
    await sleep(WINDOW_MS)
    const t3 = await readSelf()

    const before = t1.traffic.direct.connectionSeconds - t0.traffic.direct.connectionSeconds
    const after = t3.traffic.direct.connectionSeconds - t2.traffic.direct.connectionSeconds

    const reads =
      `t0=${t0.traffic.direct.connectionSeconds.toFixed(3)} ` +
      `t1=${t1.traffic.direct.connectionSeconds.toFixed(3)} ` +
      `t2=${t2.traffic.direct.connectionSeconds.toFixed(3)} ` +
      `t3=${t3.traffic.direct.connectionSeconds.toFixed(3)} ` +
      `(window ${String(WINDOW_MS)} ms; before=${before.toFixed(3)} s, after=${after.toFixed(3)} s)`

    // The floor. Without it a socket that never opened would satisfy "stopped accruing"
    // perfectly, and the case would be reporting a clean result from a broken instrument.
    expect(
      before,
      `BROW-08 floor: the connection accrued ${before.toFixed(3)} s across a ${String(WINDOW_MS)} ms ` +
        `window BEFORE Stop, i.e. it was not accruing at all — so a zero afterwards is a constant ` +
        `rather than a change. ${reads}`,
    ).toBeGreaterThan(WINDOW_MS / 1000 / 2)

    // The verdict: a RATIO of the two windows measured inside one run, never a duration
    // compared against a number somebody chose.
    const ratio = after / before
    expect(
      ratio,
      `BROW-08: after Stop the connection went on accruing at ${(ratio * 100).toFixed(1)} % of its ` +
        `pre-Stop rate, ${String(SETTLE_MS)} ms after Stop returned. On this platform cost is ` +
        `held sockets, so a stop that leaves the socket open has not stopped anything the ` +
        `operator pays for. ${reads}`,
    ).toBeLessThan(NEAR_ZERO)

    // All four raw numbers, printed rather than only compared, so the SUMMARY carries the
    // reading and not the verdict.
    process.stderr.write(`[BROW-08 socket] ${reads}\n`)

    await page.close()
  }, 300_000)
})
