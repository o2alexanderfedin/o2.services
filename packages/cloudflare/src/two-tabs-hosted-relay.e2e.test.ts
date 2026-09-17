/**
 * HOST-02 — two browser tabs meet through a **hosted** relay, and the relay then leaves the
 * data path.
 *
 * ## Why this file exists at all, given the row is already measured
 *
 * Both halves of `HOST-02` were measured on 2026-08-31 against the **deployed** object and the
 * readings are in `.planning/ROADMAP.md` § Phase 32. That phase's closing decision is explicit
 * that the row nevertheless stays unchecked, and names what is missing: *"What is missing is not
 * evidence but repeatability: neither run exists in the tree as a spec."* This file is that
 * arrangement. It does not re-derive the deployed reading and does not replace it — that run
 * stands as the separate record that the deployed object does this too.
 *
 * ## The one thing this file adds that no existing spec has
 *
 * `two-tabs.e2e.test.ts` proves two tabs meet and upgrade — against a **`FabricNode`** relay, a
 * Node process. `relay-counters.e2e.test.ts` proves a hosted workerd relays, and counts it —
 * between two **Node** peers with no WebRTC step. Neither says a browser pair upgrades away from
 * a *Durable Object*, which is the tier `HOST-02` is a row about. The composition is the claim.
 *
 * ## Why `relayService.bytes` and never `traffic.relayed`
 *
 * `relay-counters.e2e.test.ts` asserts `traffic.relayed` is `{0, 0}` at all four of its reading
 * points **as a recorded measurement**, against a workerd that was demonstrably relaying at the
 * time. The reason is the stated granularity: relayed payload transits as hop/stop protocol
 * streams riding *direct* WebSocket legs, so `classifyConnection` counts every byte of it under
 * `direct`. A window comparison built on `traffic.relayed` would therefore compare zero against
 * zero and could never redden — an instrument that cannot see the property. The surface that
 * moves is `relayService.bytes`, which is also the one the 2026-08-31 deployed run used.
 *
 * ## The verdict is a three-term comparison, and the two-term version was rejected
 *
 * The deployed run recorded idle `+3 376` against busy `+2 728` and read the second being
 * smaller as the finding. **`busy < idle` is not asserted here.** Both windows are keep-alive
 * drips on a live yamux circuit; which one lands higher is noise, and an assertion on their
 * order is a coin flip that would redden on a fabric behaving perfectly. What actually
 * distinguishes *the relay signalled and left* from *the relay is carrying this* is that the
 * relay's drip is small **against the traffic the pair moved in the same window**:
 *
 *     relayBusyDelta  <<  pairBusyDelta
 *
 * That is a ratio inside one run, in the shape `CLAUDE.md` § Measurement asks for. Both windows
 * are still measured and both are printed, because the idle window is what makes the busy
 * number a comparison rather than an absolute — but the *verdict* rests on the term that cannot
 * be produced by noise.
 *
 * ## The busy relay figure is CONSTANT across runs, and that is the mechanism, not a frozen
 * instrument
 *
 * Four runs printed `relay busy +2120 B` to the byte, while the idle window beside it varied
 * (6 498 / 6 520 / 8 720 / 8 720) and the pair's own figure varied too. A constant sitting
 * between two live neighbours is worth explaining rather than recording, and the explanation is
 * in `relay-service-log.ts`: `observe()` returns immediately unless `roleOf(stream)` is a hop or
 * stop role, so `relayService.bytes` accrues **only** on circuit-protocol streams and never on
 * the WebSocket legs those streams ride. The busy window drives `computePeers()` rounds, which
 * travel the WebRTC pair and open no new hop stream — so the relay's own protocol traffic across
 * that window is the same fixed reservation upkeep every time. The idle window varies because it
 * catches whatever keep-alive happened to fall inside it.
 *
 * **The instrument is demonstrably not frozen**: the same counter moves from cold to
 * post-reservation within this very run, which positive control 2 asserts. A constant that a
 * live control sits beside is a reading, not a stuck register.
 *
 * ## Three positive controls, each closing a way this file could pass while blind
 *
 * A green built on a counter that never moved is the failure mode this arrangement is most
 * exposed to, so each leg is proved live before it is used:
 *
 * 1. **The relay granted the reservation** — `waitForWebrtcAddr` resolves to an address
 *    containing the workerd's own PeerId. Such an address cannot be constructed by a tab; it
 *    exists only because a slot was granted.
 * 2. **The relay counted itself relaying** — `relayService.inboundHopStreams` moved from cold.
 *    Without this, a run in which the tabs somehow met without the relay would satisfy
 *    everything below.
 * 3. **The pair's own counter is alive** — `pairBusyDelta > 0`. Without it the headline ratio is
 *    `small < 0`, which is false-by-arithmetic rather than a reading, and a broken recorder
 *    would present as a clean result.
 *
 * ## Reading the pair's own bytes
 *
 * From `getStats()` on the page's own `RTCPeerConnection`s, reached through the
 * `__o2HostedIcePeers` handle that `addInitScript` installs — the technique and the placement
 * constraint are `turn-fallback.e2e.test.ts`'s, and the constraint is load bearing:
 * `@libp2p/webrtc`'s browser build captures `globalThis.RTCPeerConnection` into a `const` at
 * module evaluation, so a wrapper installed by any statement of the page is invisible to libp2p
 * forever. `addInitScript` runs before any page script, which is the only placement that works.
 * The handle is named per-file so it cannot collide with that spec's.
 *
 * ## Scope fence
 *
 * Local `workerd` only, its own port, its own `--persist-to`. `CLOUDFLARE_API_TOKEN` is blanked
 * so a path reaching for Cloudflare fails here rather than quietly succeeding on an ambient
 * credential, and **`ANNOUNCE_MULTIADDRS` is overridden to this run's own loopback address** —
 * `wrangler.jsonc` announces the deployed host, and a local relay left at that value hands its
 * reserving tab a circuit address pointing at the **owner's production node**. Nothing is
 * deployed and no remote resource is created.
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
// Hermetic by default — a fixture browser reaches the fixture's own server and nothing else.
// Six files launched chromium directly and therefore dialled PRODUCTION once the nostr bootstrap
// fallback went live; see `HERMETIC_PROXY`.
import { launchFixtureBrowser } from '../../node/src/e2e-browser-launch.ts'
import { signInHarnessTab } from '../../node/src/e2e-signin.ts'

/**
 * The identity secret this spec's local `wrangler dev` boots with — AUTH-07 criterion 4.
 *
 * Per-spec test data rather than a shared constant, in the style of the three files this
 * arrangement is built from: this spec passes its own `--persist-to`, so the value only has to
 * be self-consistent across its own boots. The length IS load bearing — under twenty characters
 * `assertUsablePassphrase` refuses and every boot below fails with `WeakPassphraseError`.
 */
const SECRET = 'local-dev-identity-secret-42'

const PACKAGE_DIR = fileURLToPath(new URL('..', import.meta.url))
const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const PAGE = 'packages/browser/demo/index.html'
const HOST = '127.0.0.1'

/**
 * Its own port. Swept across the whole tree on 2026-09-14: 8787, 8791-8796, 8798, 8801-8810,
 * 8814-8820, 8822-8826, 8831-8833, 8835-8836 are claimed by other specs. 8841 is free.
 */
const PORT = 8841

/** See the scope fence: never the deployed host, and never inherited from `wrangler.jsonc`. */
const LOCAL_ANNOUNCE = `/ip4/${HOST}/tcp/${String(PORT)}/ws`

/**
 * Each measurement window.
 *
 * The deployed run used 12 s. Kept, because the quantity being measured is a keep-alive drip
 * whose period this file does not control: a window shorter than the drip reads zero on an
 * arrangement that is working, and the ratio's denominator would then be noise.
 */
const WINDOW_MS = 12_000

/**
 * Rounds of real work driven between the tabs during the busy window.
 *
 * `computePeers()` is the demo's own offer/answer round over the pair's protocol — the same
 * call the deployed run used, for the same reason: it moves bytes between the two tabs and
 * asks nothing of the relay.
 */
const BUSY_ROUNDS = 38

/**
 * How much of the pair's own traffic the relay is allowed to have carried in the same window.
 *
 * Not a byte count — a fraction, so the case says the same thing on a fast host and a slow one.
 * The deployed reading was 2 728 against 20 710, i.e. 13.2 %. The bound is set well above that
 * so a slower host with a longer keep-alive is not failed for it, and far below the ~100 % a
 * genuinely relayed data path would produce: a relay carrying the payload must move at least as
 * many bytes as the pair, because they would be the same bytes.
 */
const RELAY_SHARE_CEILING = 0.5

/**
 * The least the pair must have moved for the ratio below to mean anything.
 *
 * `share` divides by this quantity, so it is the denominator's floor rather than a second
 * reading of the same property: a window that fitted too few rounds shrinks it while the relay's
 * keep-alive drip does not move, and the ratio then climbs for a reason that has nothing to do
 * with the data path.
 *
 * Sited an order of magnitude below every reading taken while writing this file — 140 580,
 * 140 306, 140 748 and 140 838 bytes, 38 rounds each, on hosts ranging from load/core 5.65 to a
 * quiet 2.50 — so it fails a collapsed window and not a slow one. The relay side did not move
 * across any of the four: 2 120 B every time.
 */
const PAIR_BYTES_FLOOR = 10_000

interface Tab {
  readonly name: string
  readonly context: BrowserContext
  readonly page: Page
  readonly peerId: string
}

interface RelayServiceReading {
  readonly inboundHopStreams: number
  readonly outboundStopStreams: number
  readonly bytes: number
}

interface SelfReading {
  readonly peerId: string
  readonly relayService: RelayServiceReading
}

let worker: ChildProcess | undefined
let persistDir: string
let server: ViteDevServer
let baseUrl: string
let browser: Browser
let relayPeerId: string
const tabs: Tab[] = []

/**
 * Read `/self`, narrowing at the boundary rather than casting.
 *
 * A cast would make a route that stopped reporting `relayService` present as a field of
 * `undefined` inside an arithmetic comparison — a subtraction of two `undefined`s is `NaN`, and
 * every comparison against `NaN` is false, so a broken route would arrive as a failed assertion
 * about the relay rather than as a failure where it happened.
 */
async function readSelf(): Promise<SelfReading> {
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
    !('relayService' in body) ||
    typeof body.relayService !== 'object' ||
    body.relayService === null
  ) {
    throw new Error(`/self answered a body this test cannot read: ${JSON.stringify(body)}`)
  }
  const source: Record<string, unknown> = { ...body.relayService }
  const counter = (name: string): number => {
    const read = source[name]
    if (typeof read !== 'number') {
      throw new Error(`/self reported relayService.${name} as ${JSON.stringify(read)}`)
    }
    return read
  }
  return {
    peerId: body.peerId,
    relayService: {
      inboundHopStreams: counter('inboundHopStreams'),
      outboundStopStreams: counter('outboundStopStreams'),
      bytes: counter('bytes'),
    },
  }
}

async function waitForReady(timeoutMs: number): Promise<SelfReading> {
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

/**
 * Bytes this page's own WebRTC connections have sent and received, summed.
 *
 * `transport` entries carry the totals for a whole `RTCPeerConnection`, which is what the
 * comparison wants: the question is how much traffic went pair-to-pair, not which candidate
 * pair carried it. A page with no WebRTC connection answers `0`, which positive control 3
 * reads as a broken recorder rather than as a quiet pair.
 */
async function pairBytes(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const peers =
      (globalThis as unknown as { __o2HostedIcePeers?: RTCPeerConnection[] })['__o2HostedIcePeers'] ??
      []
    let total = 0
    for (const peer of peers) {
      let report: RTCStatsReport
      try {
        report = await peer.getStats()
      } catch {
        continue
      }
      report.forEach((entry) => {
        const record = entry as unknown as Record<string, unknown>
        if (record['type'] !== 'transport') return
        const sent = record['bytesSent']
        const received = record['bytesReceived']
        if (typeof sent === 'number') total += sent
        if (typeof received === 'number') total += received
      })
    }
    return total
  })
}

/** Open an isolated context, load the page against the local workerd, and start a node in it. */
async function openTab(name: string, relayAddr: string): Promise<Tab> {
  const context = await browser.newContext()
  const page = await context.newPage()

  page.on('pageerror', (error) => {
    process.stderr.write(`[${name}] page error: ${error.message}\n`)
  })
  page.on('console', (message) => {
    if (message.type() === 'error') process.stderr.write(`[${name}] console: ${message.text()}\n`)
  })

  // BEFORE any page script evaluates — see the header. `@libp2p/webrtc` captures
  // `globalThis.RTCPeerConnection` at module evaluation, so this is the only placement from
  // which the connections libp2p builds are reachable at all.
  await page.addInitScript(() => {
    const live: RTCPeerConnection[] = []
    ;(globalThis as unknown as Record<string, unknown>)['__o2HostedIcePeers'] = live
    const Original = globalThis.RTCPeerConnection
    class Recording extends Original {
      constructor(...args: [RTCConfiguration?]) {
        super(...args)
        live.push(this as unknown as RTCPeerConnection)
      }
    }
    globalThis.RTCPeerConnection = Recording as unknown as typeof RTCPeerConnection
  })

  // `?relay=` names ONLY the local workerd, so this page will not reach for `/bootstrap.json`
  // and will not dial anything else.
  await page.goto(`${baseUrl}${PAGE}?relay=${encodeURIComponent(relayAddr)}`)
  await page.waitForFunction(() => typeof window.o2 !== 'undefined', null, { timeout: 60_000 })
  // BROW-01 has no test-only bypass: a harness consents for the same reason a visitor clicks
  // the button. AUTH-06: it signs in too, because `window.o2.start` refuses with
  // `SignedOutError` until somebody has opened their own envelope.
  await signInHarnessTab(page)
  const peerId = await page.evaluate(
    async ([address, store]) =>
      window.o2.start({ relayAddrs: [address as string], blockstoreName: store as string }),
    [relayAddr, `o2-hosted-${name}`],
  )

  const tab: Tab = { name, context, page, peerId }
  tabs.push(tab)
  return tab
}

beforeAll(async () => {
  persistDir = await mkdtemp(join(tmpdir(), 'o2-two-tabs-hosted-'))
  worker = spawn(
    'npx',
    [
      'wrangler',
      'dev',
      '--port',
      String(PORT),
      '--local-protocol',
      'http',
      // AUTH-07 criterion 4 — without it the object refuses to open its sealed identity,
      // `/self` answers 500, and every readiness poll below times out.
      '--var',
      `O2_IDENTITY_SECRET:${SECRET}`,
      // The scope fence's own clause. `--var` MERGES with the file's `vars` rather than
      // replacing them (measured 2026-08-27), so overriding this one key leaves the rest.
      '--var',
      `ANNOUNCE_MULTIADDRS:${LOCAL_ANNOUNCE}`,
      '--persist-to',
      persistDir,
    ],
    {
      cwd: PACKAGE_DIR,
      env: { ...process.env, CLOUDFLARE_API_TOKEN: '', WRANGLER_SEND_METRICS: 'false' },
      // PIPED, not ignored. A refusal from the assembly — `NoAnnouncedAddressError` is the one
      // this arrangement can actually produce — is otherwise unreadable, and would have to be
      // inferred from a failed dial. That is attribution by plausibility, which this repository
      // refuses; `.planning/ROADMAP.md` § Phase 32 records the same reading being taken by name
      // from the runtime's own output for exactly this reason.
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  worker.stdout?.on('data', (chunk: Buffer) => {
    process.stderr.write(`[workerd] ${chunk.toString()}`)
  })
  worker.stderr?.on('data', (chunk: Buffer) => {
    process.stderr.write(`[workerd] ${chunk.toString()}`)
  })
  relayPeerId = (await waitForReady(120_000)).peerId

  server = await createServer({
    root: ROOT,
    logLevel: 'error',
    server: { port: 0 },
    // One optimiser cache per `vitest run`, not one shared by every lane on the machine — two
    // Vite servers on one `cacheDir` leave the loser's live pages asking for dep modules under
    // a `browserHash` that no longer exists, and Vite answers `504 Outdated Optimize Dep`.
    // Written out rather than imported for the reason
    // `stop-closes-the-billed-socket.e2e.test.ts` gives at the same line.
    cacheDir: join(ROOT, 'node_modules', `.vite-e2e-${String(process.ppid)}`),
  })
  await server.listen()
  const url = server.resolvedUrls?.local[0]
  if (url === undefined) throw new Error('vite dev server produced no URL')
  baseUrl = url.endsWith('/') ? url : `${url}/`

  browser = await launchFixtureBrowser(chromium)
}, 300_000)

afterAll(async () => {
  for (const tab of tabs) {
    await tab.page.evaluate(async () => window.o2.stop()).catch(() => {})
    await tab.context.close().catch(() => {})
  }
  await browser?.close().catch(() => {})
  await server?.close().catch(() => {})
  worker?.kill('SIGTERM')
  await rm(persistDir, { recursive: true, force: true }).catch(() => {})
}, 180_000)

describe('HOST-02 — two tabs meet through a hosted relay, which then leaves the data path', () => {
  it('upgrades to a direct pair the hosted relay granted but does not carry', async () => {
    const cold = await readSelf()
    const relayAddr = `/ip4/${HOST}/tcp/${String(PORT)}/ws/p2p/${relayPeerId}`

    const a = await openTab('a', relayAddr)
    const b = await openTab('b', relayAddr)

    // ---- positive control 1: the reservation exists because the relay granted it ----
    //
    // A `/webrtc` address resolves through the reservation to `<relay>/p2p-circuit/webrtc/p2p/<B>`.
    // A tab cannot construct one: the relay's PeerId in it is proof a slot was granted.
    const bAddrs = await b.page.evaluate(async () => window.o2.waitForWebrtcAddr(90_000))
    const target = bAddrs[0]
    expect(
      target,
      'HOST-02: tab B published no /webrtc address within 90 s, so the hosted relay granted it ' +
        'no reservation and there is no circuit for tab A to signal over',
    ).toBeDefined()
    expect(
      target,
      `HOST-02: tab B's address ${String(target)} does not name the hosted relay ` +
        `${relayPeerId}, so whatever granted the reservation is not the object under test`,
    ).toContain(relayPeerId)

    // ---- the dial: signalled by the relay, upgraded away from it ----
    const dialed = await a.page.evaluate(async (address) => window.o2.dial(address), target!)
    expect(dialed).toBe(b.peerId)

    const connections = await a.page.evaluate(
      async (peer) => window.o2.connectionsTo(peer),
      b.peerId,
    )
    const webrtc = connections.filter((conn) => conn.remoteAddr.includes('/webrtc'))
    expect(
      webrtc.length,
      `HOST-02: tab A holds ${String(connections.length)} connection(s) to tab B and none is a ` +
        `/webrtc pair — ${JSON.stringify(connections)}. The pair never left the circuit, so the ` +
        'relay is still the data path',
    ).toBeGreaterThan(0)
    // libp2p marks a relayed circuit limited (2 min / 128 KiB); a WebRTC connection is not. If
    // the work below were running over the relay, this is what would catch it.
    for (const conn of webrtc) expect(conn.limited).toBe(false)

    // ---- positive control 2: the relay counted itself relaying ----
    const afterDial = await readSelf()
    expect(
      afterDial.relayService.inboundHopStreams,
      `HOST-02: inboundHopStreams was ${String(cold.relayService.inboundHopStreams)} cold and ` +
        `${String(afterDial.relayService.inboundHopStreams)} after both tabs reserved and A ` +
        'dialled B. No peer opened a hop stream, so nothing below is a reading about a relay',
    ).toBeGreaterThan(cold.relayService.inboundHopStreams)

    // ---- window 1: idle. Both tabs up, the pair formed, no work driven. ----
    const relayIdle0 = afterDial.relayService.bytes
    await sleep(WINDOW_MS)
    const relayIdle1 = (await readSelf()).relayService.bytes

    // ---- window 2: busy. The same pair, carrying real rounds between the two tabs. ----
    const pairBusy0 = await pairBytes(a.page)
    const relayBusy0 = relayIdle1
    const busyUntil = Date.now() + WINDOW_MS
    let rounds = 0
    while (rounds < BUSY_ROUNDS && Date.now() < busyUntil) {
      await a.page.evaluate(async () => window.o2.computePeers())
      rounds += 1
    }
    // The window is a fixed span on both sides or the two deltas are not comparable: a busy
    // window that finished its rounds early would give the relay less wall clock to drip in,
    // and the comparison would be measuring the schedule rather than the data path.
    const remaining = busyUntil - Date.now()
    if (remaining > 0) await sleep(remaining)
    const relayBusy1 = (await readSelf()).relayService.bytes
    const pairBusy1 = await pairBytes(a.page)

    const relayIdleDelta = relayIdle1 - relayIdle0
    const relayBusyDelta = relayBusy1 - relayBusy0
    const pairBusyDelta = pairBusy1 - pairBusy0

    const reads =
      `window ${String(WINDOW_MS)} ms; rounds=${String(rounds)}; ` +
      `relay idle +${String(relayIdleDelta)} B, relay busy +${String(relayBusyDelta)} B, ` +
      `pair busy +${String(pairBusyDelta)} B`

    // ---- positive control 3: the pair's own counter is alive, and large enough to divide by ----
    //
    // Without this the verdict below is `something < 0`, false by arithmetic, and a broken
    // recorder would arrive as a clean result rather than as a finding.
    //
    // **The floor is the denominator's, and it is not cosmetic.** `share` divides by whatever
    // the pair moved, so a host slow enough to fit only a handful of rounds into the window
    // shrinks the denominator while the relay's keep-alive drip stays where it is — and the
    // ratio climbs for a reason that is about the schedule, not about the data path. That
    // failure would read as *the relay is carrying a share of the data path*, which is the one
    // sentence this file must never say wrongly. So a run that did not move enough to divide by
    // fails HERE, naming the rounds, rather than below naming the relay. See
    // {@link PAIR_BYTES_FLOOR} for the four readings it is sited against.
    expect(
      pairBusyDelta,
      `HOST-02: the pair moved ${String(pairBusyDelta)} bytes of its own across the busy window ` +
        `of ${String(rounds)} rounds, under the ${String(PAIR_BYTES_FLOOR)} this comparison needs ` +
        `to have a denominator worth dividing by. Either the rounds did not run, or getStats() is ` +
        `reading nothing, or the host fitted too few rounds into the window — none of which is a ` +
        `statement about the relay. ${reads}`,
    ).toBeGreaterThan(PAIR_BYTES_FLOOR)

    // ---- THE VERDICT ----
    //
    // Deliberately NOT `relayBusyDelta < relayIdleDelta`. Both are keep-alive drips on a live
    // yamux circuit and their order is noise; the deployed run happened to see busy lower, and
    // asserting that would be a coin flip reddening on a fabric doing exactly the right thing.
    // What cannot be produced by noise is the relay staying small against the traffic the pair
    // moved in the SAME window: a relay carrying the payload must move at least as many bytes
    // as the pair, because they would be the same bytes.
    const share = relayBusyDelta / pairBusyDelta
    expect(
      share,
      `HOST-02: across the busy window the hosted relay moved ${String(relayBusyDelta)} bytes ` +
        `against the pair's ${String(pairBusyDelta)} — ${(share * 100).toFixed(1)} % — so the ` +
        'relay is carrying a share of the data path rather than having left it. ' +
        `${reads}`,
    ).toBeLessThan(RELAY_SHARE_CEILING)

    // Both windows printed rather than only compared, so a summary carries the reading and not
    // the verdict, and so the idle figure is on the record as the thing that makes the busy one
    // a comparison rather than an absolute.
    process.stderr.write(`[HOST-02 hosted relay] ${reads}\n`)
  }, 600_000)
})
