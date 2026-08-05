import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, firefox, webkit } from 'playwright'
import type { Browser, BrowserType, Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FabricNode } from './fabric-node.ts'

/**
 * Criterion 4 — *"Two browser peers opened against the static demo bundle — no seed
 * process running, no `/bootstrap.json`, nothing dialed by a test harness — discover
 * each other via the wired hooks and complete a job together, proving browser peers
 * participate in routing as full peers rather than only through backbone-served
 * fallback."*
 *
 * ## Deliberately no `window.o2.dial(...)` anywhere below
 *
 * Stated the way `seed-discovery.e2e.test.ts:274-276` states it, because it is the
 * whole point. Every other multi-tab spec in this repository dials from the harness —
 * `two-tabs.e2e.test.ts:226`, `colouring-demo.e2e.test.ts`, `background-tab.e2e.test.ts`,
 * `duty-cycle-tab.e2e.test.ts` — and a peer the harness introduced proves nothing about
 * whether the fabric can introduce it. **The only address this file supplies is the
 * relay's, and it arrives through the page's own `?relay=` query string**: the thing a
 * visitor pastes, and the one thing a static host cannot serve.
 *
 * ## The four conditions `seed-discovery.e2e.test.ts` does not meet
 *
 * That file is the closest existing analogue and it fails criterion 4 on four counts,
 * each of which is inverted here:
 *
 * | condition | there | here |
 * |---|---|---|
 * | who serves the page | a live `SeedServer` | a dumb 404-ing file server over `vite build` output |
 * | what answers the directory | `/bootstrap.json` | nothing; the origin 404s, as a static host does |
 * | storage isolation | `context.newPage()` ×2 on one context | one engine per peer, so one storage backend per peer |
 * | engines | chromium alone | chromium, firefox and webkit |
 *
 * ## The mechanism, stated so nobody looks for a missing one
 *
 * A tab holds no reservations of its own. `browser-node.ts`'s `serveAgent` call supplies
 * `reservations: 'relays-for-nobody'` — a **named absence, not an omission** — so tabs
 * do not answer each other's rendezvous and none of them is ever asked. **They both ask
 * the relay**, which is a `FabricNode` holding a real thunk over its own reservation
 * store (`fabric-node.ts:1695`). `findReservedPeers` (`net/src/rendezvous.ts:76`) turns
 * each reported holder into `/p2p/<relay>/p2p-circuit/webrtc/p2p/<holder>` and the tab
 * dials that. The relay carries the SDP exchange and then drops out; the job runs over
 * direct WebRTC, which is why the `limited` reading below is not decoration — a relayed
 * circuit is 2 minutes and 128 KiB and `PROJECT.md` records that it may not carry a job.
 *
 * The other hook criterion 4 names is `index`, and it is genuinely wired on both tiers
 * (each tier's `serveAgent` call passes a byte-identical `index: records`) — that is what makes
 * each of these tabs a full routing peer rather than a client of one. The rendezvous
 * answer and the routing hook are two different hooks on two different nodes, and the
 * roadmap's phrasing was corrected accordingly on 2026-08-03.
 *
 * **`index` is wired here, and it is NOT read here — the distinction is W3 of
 * `19-VERIFICATION.md` and it is worth keeping straight.** Nothing in this file asks a tab
 * for `records` or `providers`: discovery is `findReservedPeers` alone, `computePeers` sends
 * an `offer`, and these tabs are unenrolled so `demo/main.ts`'s `peerCertificate` returns
 * before asking. The paragraph above is therefore a reading of *construction*, which is what
 * it says and all it says. The hook is read off a **live tab over the real wire** by a
 * sibling file from this same phase — `tab-refusals.e2e.test.ts:371,377` — which is where
 * criterion 4's `index` clause is actually measured. Four line citations in this header had
 * drifted and were re-checked against the tree on 2026-08-04.
 *
 * ## One host. Three engines. Not three machines.
 *
 * Per the browser-tier testing standard (owner ruling 2026-07-28, `ROADMAP.md`
 * Constraints): each peer is a separate `browserType.launch()`, so each gets its own
 * origin storage, its own IndexedDB and its own WebRTC implementation. Three engines on
 * one host are **three independent implementations and three independent storage
 * backends. They are not three machines**, and no result obtained from this file may be
 * described as cross-machine or distributed-hardware.
 *
 * Separate launches rather than `browser.newContext()` ×3: it is strictly stronger than
 * the standard asks for — separate storage *and* separate implementations — and it is no
 * more code.
 *
 * ## An engine that cannot take part is published, never dropped
 *
 * Playwright's webkit is not Safari, and this is the first WebRTC-over-relay reading
 * taken in it or in firefox anywhere in this repository. If an engine cannot launch,
 * cannot start a node, or cannot complete the handshake, {@link excluded} carries it
 * with its reason and the first case below goes red naming it. A rung that vanishes
 * between plan and result is indistinguishable from one removed because it was
 * inconvenient — this repository's recorded rule from Phase 8.
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const DIST = join(ROOT, 'packages', 'browser', 'dist')

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
}

/** The engines the standard names, in the order they are launched. */
const ENGINES: readonly { readonly name: string; readonly type: BrowserType }[] = [
  { name: 'chromium', type: chromium },
  { name: 'firefox', type: firefox },
  { name: 'webkit', type: webkit },
]

interface Peer {
  readonly engine: string
  readonly browser: Browser
  readonly page: Page
  readonly peerId: string
}

/** An engine that did not reach the starting line, and why. Never silently dropped. */
interface Excluded {
  readonly engine: string
  readonly reason: string
}

let server: Server
let baseUrl: string
let relay: FabricNode
let relayAddr: string
const peers: Peer[] = []
const excluded: Excluded[] = []
/** Wall time of the whole fixture, reported so this file's cost is a finding, not a surprise. */
let setupMs = 0

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Launch one engine, open the built bundle at `?relay=`, and start a node in it.
 *
 * Every step that can fail per-engine is inside the `try`, so a webkit that cannot open
 * a data channel is reported as *webkit could not do X* rather than as a timeout in
 * whichever assertion happened to run first.
 */
async function openPeer(engine: string, type: BrowserType): Promise<Peer | Excluded> {
  let browser: Browser
  try {
    browser = await type.launch()
  } catch (error) {
    return { engine, reason: `launch failed: ${messageOf(error)}` }
  }
  try {
    const page = await browser.newPage()
    page.on('pageerror', (error) => {
      process.stderr.write(`[${engine}] page error: ${error.message}\n`)
    })
    page.on('console', (message) => {
      if (message.type() === 'error') process.stderr.write(`[${engine}] console: ${message.text()}\n`)
    })

    // The one address the harness supplies, through the page's own query string.
    await page.goto(`${baseUrl}/?relay=${encodeURIComponent(relayAddr)}`)
    await page.waitForFunction(() => typeof window.o2 !== 'undefined', null, { timeout: 60_000 })

    // BROW-01 has no test-only bypass: a harness consents for the same reason a
    // visitor clicks the button. `autoStart` then reads `?relay=` through
    // `discoverRelays()` — the same precedence a visitor's page uses — and inherits
    // the demo's own build authority, because nothing here pins one.
    const joined = await page.evaluate(async (store) => {
      window.o2.grantConsent()
      return window.o2.autoStart({ blockstoreName: store })
    }, `static-rendezvous-${engine}`)

    // A reservation that has not yet produced a dialable `/webrtc` address is a peer
    // the relay cannot name to anybody, so this is part of joining rather than part of
    // the reading.
    const addrs = await page.evaluate(async () => window.o2.waitForWebrtcAddr(90_000))
    if (addrs.length === 0) return { engine, reason: 'reserved on the relay but produced no /webrtc address' }

    return { engine, browser, page, peerId: joined.peerId }
  } catch (error) {
    await browser.close().catch(() => {})
    return { engine, reason: messageOf(error) }
  }
}

beforeAll(async () => {
  const started = performance.now()

  // Built here rather than assuming a previous build is current, exactly as
  // `built-bundle.e2e.test.ts:51` does: this must fail when the *sources* break the
  // bundle, not when somebody forgot to rebuild.
  execFileSync('npx', ['vite', 'build', '--config', 'packages/browser/vite.config.ts'], {
    cwd: ROOT,
    stdio: 'pipe',
  })

  // A deliberately dumb server: no module resolution, no transforms, no fallbacks, and
  // **no `/bootstrap.json`**. There is no `SeedServer` and no Vite dev server in this
  // file; either would serve the origin criterion 4 forbids.
  server = createServer((request, response) => {
    const path = (request.url ?? '/').split('?')[0] ?? '/'
    const file = join(DIST, normalize(path === '/' ? '/index.html' : path))
    if (!file.startsWith(DIST)) {
      response.writeHead(403).end()
      return
    }
    readFile(file).then(
      (bytes) => {
        response.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' })
        response.end(bytes)
      },
      () => {
        // Exactly what a static host does for /bootstrap.json.
        response.writeHead(404).end('not found')
      },
    )
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('no server port')
  baseUrl = `http://127.0.0.1:${address.port}`

  // Comfortably above three, so a refusal cannot be mistaken for a configured limit.
  // DET-03: this node relays and executes nothing — the subject is three tabs reaching
  // each other. See `background-tab.e2e.test.ts` for the full note on why stating the
  // opt-out is the point of the field being required.
  relay = await FabricNode.start({
    relayAdmission: 'admits-any-peer',
    startReporting: 'reports-its-own-start',
    maxReservations: 8,
    listen: ['/ip4/127.0.0.1/tcp/0/ws'],
    trustAnchors: 'runs-unsigned-artifacts',
  })
  const dialable = relay.browserDialableAddrs[0]
  if (dialable === undefined) throw new Error('relay produced no browser-dialable address')
  relayAddr = dialable

  // Sequential rather than concurrent: three engines launching at once contend for the
  // CPU, and the symptom is a timeout in whichever one lost — the same reason the `e2e`
  // project sets `fileParallelism: false`.
  for (const { name, type } of ENGINES) {
    const outcome = await openPeer(name, type)
    if ('reason' in outcome) {
      process.stderr.write(`[${name}] excluded: ${outcome.reason}\n`)
      excluded.push(outcome)
    } else {
      peers.push(outcome)
    }
  }

  setupMs = performance.now() - started
  process.stderr.write(`[fixture] build + relay + ${peers.length} engines in ${Math.round(setupMs)}ms\n`)
  // 300s: three `browserType.launch()` calls, three page loads of a 565 kB bundle,
  // three relay reservations and three ICE gatherings, on top of a `vite build`.
  // Larger than the wrapping budget of every `it` below, because it does the work of
  // all of them once.
}, 420_000)

afterAll(async () => {
  // Nothing spawned here may outlive the run: the node first so its libp2p unwinds
  // cleanly, then the engine, then the relay and the file server.
  for (const peer of peers) {
    await peer.page.evaluate(async () => window.o2.stop()).catch(() => {})
    await peer.browser.close().catch(() => {})
  }
  await relay?.stop().catch(() => {})
  await new Promise<void>((resolve) => server?.close(() => resolve()))
}, 180_000)

describe('NET-06 — three engines on one static bundle, nothing dialled by the harness', () => {
  /**
   * The standard's own rung, read first and separately.
   *
   * Placed before every other case so a missing engine names itself here rather than
   * surfacing as a thin job two cases later. The message carries the reason because
   * *"webkit did not take part"* is not actionable and *"webkit produced no /webrtc
   * address"* is.
   */
  it('runs all three engines the standard names, or publishes the one it could not', () => {
    expect(
      excluded.map((entry) => `${entry.engine} could not take part — ${entry.reason}`),
    ).toEqual([])
    expect(peers.map((peer) => peer.engine)).toEqual(['chromium', 'firefox', 'webkit'])
    // Three distinct nodes, not one node seen three times.
    expect(new Set(peers.map((peer) => peer.peerId)).size).toBe(peers.length)
    // And all three reservations are held at once, on the relay's own count.
    expect(relay.capacity.granted).toBeGreaterThanOrEqual(peers.length)
  })

  /**
   * The origin has nothing to say, and the page reads the relay out of its own link.
   *
   * Both halves matter. `source: 'query'` is what makes the static tier work at all;
   * a 404 on `/bootstrap.json` is what makes this a static host rather than a seed with
   * the directory switched off.
   */
  it('has no origin to ask: /bootstrap.json 404s and the relay comes from ?relay=', async () => {
    expect(peers.length).toBeGreaterThan(0)
    const bootstrap = await fetch(`${baseUrl}/bootstrap.json`)
    expect(bootstrap.status).toBe(404)

    for (const peer of peers) {
      const discovery = await peer.page.evaluate(async () => window.o2.discoverRelays())
      expect({ engine: peer.engine, ...discovery }).toEqual({
        engine: peer.engine,
        source: 'query',
        relayAddrs: [relayAddr],
      })
    }
  }, 120_000)

  /**
   * The reading this file exists for.
   *
   * ## Why the rounds run in sequence, and what that cost
   *
   * `seed-discovery.e2e.test.ts:311` reads *"something was attempted"* as
   * `dialed.length + failed.length > 0`, because an empty `dialed` **and** an empty
   * `failed` was the signature of the bug it was written for: every candidate skipped
   * by a filter, nothing tried, no error anywhere to notice. That reading cannot be
   * applied peer-by-peer here, and the reason is arithmetic rather than a weakness:
   * with three peers, the earlier rounds introduce everybody, so the third peer
   * correctly finds nothing left to dial. `planDials` filtering an already-connected
   * peer is the same file's own `again.dialed` assertion at `:325`.
   *
   * Running the rounds concurrently would give every peer something to dial, and it was
   * tried first. **It is flaky, measured, and the flake is a real finding rather than
   * contention** — see the recorded note in `19-03-SUMMARY.md`. A simultaneous mutual
   * dial between firefox and webkit lost ICE on one run of three and left the pair
   * holding a *limited* circuit and no `/webrtc` connection; the same code succeeded on
   * the next two runs, producing duplicate connections both times.
   *
   * **Amended 2026-08-04 — the second half of that paragraph is fixed and the first half
   * got worse.** It used to end *"a later round cannot repair it, because `planDials`
   * skips a peer already in `n.transport.peers` and a limited circuit puts it there"*.
   * That was read off the source and has since been measured, as defect 32: the skip was
   * real, and `planDials` now takes `heldPeers` — connected **and able to carry work** —
   * so a relayed-only peer is dialled again and named. The flake itself is *not* 1-in-3;
   * forced, it was 4 out of 4. `relay-latch.e2e.test.ts` carries the whole reading and
   * the two facts this file's reasoning did not have: the pair recovers on its own when
   * the relay's duration limit drops the circuit, and firefox's re-dial to webkit times
   * out while webkit ends up holding a `/webrtc` connection firefox does not have.
   *
   * None of that changes what this case does. Sequential rounds remain the right choice
   * here for the reason below — an exact reading beats a raced one — and this file's
   * assertions were re-run unchanged and green against the fix.
   *
   * ## So the anti-vacuity reading is made exact instead of merely non-zero
   *
   * Each round is compared against the peers that page had **not yet discovered when
   * the round began**. A filter eating a candidate shows up as an attempt count below
   * that number, which is the defect `seed-discovery.e2e.test.ts` was written for and is
   * caught here on any peer rather than only on one with work outstanding. A zero is
   * then a derived answer rather than an excused one. And the totals are pinned: across
   * the whole set the fabric introduces every pair exactly once, so a round that dialled
   * a peer somebody else had already introduced is a failure too.
   */
  it('each peer asks the relay who is here and dials them, with no harness dial', async () => {
    expect(peers.length).toBeGreaterThan(1)

    const rounds: { engine: string; undiscovered: number; attempted: number; asked: boolean }[] = []
    for (const peer of peers) {
      const before = await peer.page.evaluate(() => window.o2.peers())
      const undiscovered = peers.filter(
        (other) => other.peerId !== peer.peerId && !before.includes(other.peerId),
      ).length
      const found = await peer.page.evaluate(async () => window.o2.connectDiscoveredPeers())
      rounds.push({
        engine: peer.engine,
        undiscovered,
        attempted: found.dialed.length + found.failed.length,
        asked: found.asked,
      })
    }

    for (const round of rounds) {
      // The origin 404s, so `asked` can only be true because the *fabric* answered —
      // `findReservedPeers` reported at least one peer that responded. On a static host
      // this is the sole route, and `demo/main.ts:162-164` says so at the call site.
      expect({ engine: round.engine, asked: round.asked }).toEqual({
        engine: round.engine,
        asked: true,
      })
      expect({ engine: round.engine, attempted: round.attempted }).toEqual({
        engine: round.engine,
        attempted: round.undiscovered,
      })
    }

    // The instrument is not measuring an empty set: at least one round had work, and
    // between them the rounds introduced every pair exactly once — no pair missed, and
    // none dialled twice by two peers that both thought it undiscovered.
    expect(rounds.filter((round) => round.undiscovered > 0).length).toBeGreaterThan(0)
    expect(rounds.reduce((sum, round) => sum + round.attempted, 0)).toBe(
      (peers.length * (peers.length - 1)) / 2,
    )

    // Every peer ends up holding every other peer, read from inside each page.
    for (const peer of peers) {
      const connected = await peer.page.evaluate(() => window.o2.peers())
      for (const other of peers) {
        if (other.peerId === peer.peerId) continue
        expect({ from: peer.engine, to: other.engine, holds: connected.includes(other.peerId) }).toEqual(
          { from: peer.engine, to: other.engine, holds: true },
        )
      }
      // A page filters its own published address out rather than dialling itself.
      expect(connected).not.toContain(peer.peerId)
      // The relay is a connection too — holding a reservation *is* one.
      expect(connected).toContain(relay.peerId)
    }

    // And they are *compute* peers, established by asking rather than by assuming:
    // `computePeers` sends an offer and counts who replies. This is the half of
    // criterion 4 that says "as full peers" rather than "reachable".
    for (const peer of peers) {
      const computing = await peer.page.evaluate(async () => window.o2.computePeers())
      for (const other of peers) {
        if (other.peerId === peer.peerId) continue
        expect({ from: peer.engine, to: other.engine, computes: computing.includes(other.peerId) }).toEqual(
          { from: peer.engine, to: other.engine, computes: true },
        )
      }
    }
  }, 300_000)

  /**
   * The relay signalled and then dropped out of the data path.
   *
   * libp2p marks a relayed circuit *limited* — 2 minutes and 128 KiB, the verified
   * defaults in `transport-circuit-relay-v2/src/constants.ts`. A WebRTC connection has
   * no such bound. `PROJECT.md` records that the relay is a signalling channel and may
   * not carry a job, so a job running over `/p2p-circuit` would be testing a
   * configuration this project does not support, and this is the assertion that would
   * catch it.
   */
  it('holds an unlimited /webrtc connection to every peer, not a relayed circuit', async () => {
    expect(peers.length).toBeGreaterThan(1)

    for (const peer of peers) {
      for (const other of peers) {
        if (other.peerId === peer.peerId) continue
        const connections = await peer.page.evaluate(
          async (id) => window.o2.connectionsTo(id),
          other.peerId,
        )
        const webrtc = connections.filter((c) => c.remoteAddr.includes('/webrtc'))
        expect({
          from: peer.engine,
          to: other.engine,
          webrtc: webrtc.length > 0,
        }).toEqual({ from: peer.engine, to: other.engine, webrtc: true })
        for (const connection of webrtc) {
          expect({ from: peer.engine, to: other.engine, limited: connection.limited }).toEqual({
            from: peer.engine,
            to: other.engine,
            limited: false,
          })
        }
      }
    }
  }, 180_000)

  /**
   * They finish a job together.
   *
   * `complete: true` is **not** the reading. A job that ran entirely on the submitter's
   * own worker reports `complete` just as happily — `built-bundle.e2e.test.ts:292-296`
   * runs exactly that shape with `peerIds: []` and gets it. The reading is the
   * `agreeing` list carrying a node id that is not the submitter's, which is the whole
   * difference between a job that completed and a job that was distributed.
   *
   * `redundancy` is the number of participating peers, so every cube runs on every one
   * of them and the agreement list is a full roster rather than a sample. Two cubes
   * because one would leave the per-cube list unable to disagree with itself.
   */
  it('completes a job across the engines, with a non-submitter in the agreement', async () => {
    expect(peers.length).toBeGreaterThan(1)
    const [submitter, ...rest] = peers as [Peer, ...Peer[]]
    const others = rest.map((peer) => peer.peerId)

    const run = await submitter.page.evaluate(
      async ([ids, redundancy]) =>
        window.o2.runColouring({
          n: 24,
          cubes: 2,
          redundancy: redundancy as number,
          peerIds: ids as string[],
        }),
      [others, peers.length] as const,
    )

    expect(run.complete).toBe(true)

    // The load-bearing assertion, and it is placed **before** the multiplier
    // deliberately. Both go red on a job that ran alone, and if the multiplier spoke
    // first the proof for this case would read as a redundancy reading rather than as
    // the distribution reading it is. Asserted as a set per cube rather than "at least
    // one foreign id somewhere", so a run in which one cube was distributed and the
    // other silently ran alone cannot pass.
    expect(run.agreeing.length).toBe(2)
    for (const agreeing of run.agreeing) {
      expect([...agreeing].sort()).toEqual([...peers.map((peer) => peer.peerId)].sort())
      expect(agreeing.filter((id) => id !== submitter.peerId).length).toBeGreaterThan(0)
    }

    expect(run.verificationMultiplier).toBeCloseTo(peers.length, 6)

    // DATA-05/DATA-06: the manifest is checked on both fields, per 13-CONTEXT.md
    // decision 3 — a manifest with zero entries reports zero violations trivially, and
    // the two must never be allowed to look alike.
    expect(run.egress.entries.length).toBeGreaterThan(0)
    expect(run.egress.violations).toEqual([])

    // And the work reached the other tabs' own threads, read from inside each of them.
    for (const peer of rest) {
      const executed = await peer.page.evaluate(() => window.o2.activity()?.tasksExecuted ?? 0)
      expect({ engine: peer.engine, executed: executed > 0 }).toEqual({
        engine: peer.engine,
        executed: true,
      })
    }
  }, 300_000)
})
