import { fileURLToPath } from 'node:url'
import { firefox, webkit } from 'playwright'
import type { Browser, BrowserType, Page } from 'playwright'
import { createServer } from 'vite'
import type { ViteDevServer } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { fixtureViteCacheDir, launchFixtureBrowser } from './e2e-browser-launch.ts'
import { signInHarnessTab } from './e2e-signin.ts'
import { FabricNode } from './fabric-node.ts'

/**
 * Defect 32 — a pair that is connected and cannot carry a job.
 *
 * ## What was measured before anything was changed
 *
 * Two tabs dialling in the same moment was reported as a 1-in-3 flake seen once. Forced —
 * both pages calling `connectDiscoveredPeers()` inside one `Promise.all` — it was **4 out
 * of 4** on firefox↔webkit over a real relay, and the shape was identical every time:
 *
 * | reading | value |
 * |---|---|
 * | the racing round, both sides | `dialed: []`, `failed: ['<the other tab>']` |
 * | connections a second later | 2 limited circuits **and** one unlimited `/webrtc` |
 * | connections a few seconds later | 2 limited circuits, the `/webrtc` gone |
 * | the very next round, both sides | `dialed: []`, `failed: []` — nothing attempted |
 *
 * That last row is the defect. `planDials` skipped any peer in `n.transport.peers`, which
 * is `libp2p.getPeers()` — *"every peer with at least one connection"* — and a limited
 * relay circuit is a connection. So the round had nothing to do, and reported nothing
 * wrong, about a pair that could not run the work.
 *
 * ## Two things the source-read description of the defect got wrong, both measured here
 *
 * **The latch is not permanent.** Polling exactly as the demo page does, the pair
 * repaired itself at ~130 s — one tick attempting nothing at 60 s, the next attempting
 * two dials and succeeding. That is the relay's own `DURATION_LIMIT` (120 s) tearing the
 * circuits down, after which the peer leaves `getPeers()` and the ordinary first-contact
 * rule applies again. The defect is a two-minute window, not a permanent state.
 *
 * **Nothing else was going to retry it either, and asking made that worse.** `computePeers()`
 * sends one `offer` per connected peer, and `dialProtocol` → `openConnection` →
 * `findExistingConnection` skips limited connections outright — so every probe on the
 * demo's 4 s timer *silently* dials the peer again. Measured across two runs of the same
 * construction, that implicit dial succeeded once and timed out once: a repair that
 * happens as a side effect of an unrelated request, roughly half the time, and reports
 * nothing either way. What the page then printed was a peer count, with no way for a
 * visitor to tell the two outcomes apart.
 *
 * ## What this fix does and does not do, measured rather than hoped
 *
 * It makes the round dial the peer again *deliberately*, and — the part a retry cannot
 * supply — it makes the condition **sayable**: `heldPeers()`, and a round's `upgrades`
 * and `relayedOnly`. It does **not** rescue this particular pair: firefox's outbound
 * `/webrtc` dial to webkit times out, 4 observations out of 4, whenever firefox already
 * holds a limited circuit to webkit. `The operation timed out.` is the message, captured
 * directly rather than through the round's `catch`.
 *
 * And underneath that sits a state worse than the defect described, found while measuring
 * it: after each of those timed-out dials **webkit holds an open, unlimited `/webrtc`
 * connection to firefox that firefox does not have**. One WebRTC session, two
 * irreconcilable views of it, and only the reading this fix adds can see the difference.
 * That is filed rather than fixed — it is inside `@libp2p/webrtc`'s handshake, not here.
 *
 * ## Why this file does not race
 *
 * The race is a *route into* the state, and an unreliable one to write a guard against —
 * `19-03-SUMMARY.md` records the same conclusion from the other side. The state itself is
 * reachable deliberately and deterministically: dial the other tab's **bare**
 * `/p2p-circuit` address, the one with no `/webrtc` in it, which both tabs publish because
 * `browser-node.ts` listens on both. That produces exactly one limited circuit and no
 * WebRTC connection — byte for byte the end state the race lands in — with no ICE
 * outcome to depend on.
 *
 * Every reading below is therefore comparative or exact: two questions asked about the
 * same instant and required to give different answers, or a count of attempts required to
 * equal a number derived from the fixture. There is no wall-clock threshold anywhere in
 * this file, on purpose — the one absolute number in the story above (130 s) is reported
 * in this header and asserted nowhere.
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const PAGE = 'packages/browser/demo/index.html'

/**
 * firefox and webkit, because that is the pair the defect was observed on.
 *
 * Two engines rather than three: the state under test is produced by a deliberate dial
 * rather than by an engine's ICE behaviour, so a third launch would add a minute of
 * fixture and no independent reading. Two are still two implementations and two storage
 * backends — and, per the standing ruling, **not** two machines.
 */
const ENGINES: readonly { readonly name: string; readonly type: BrowserType }[] = [
  { name: 'firefox', type: firefox },
  { name: 'webkit', type: webkit },
]

interface Peer {
  readonly engine: string
  readonly browser: Browser
  readonly page: Page
  readonly peerId: string
}

let server: ViteDevServer
let baseUrl: string
let relay: FabricNode
let relayAddr: string
const peers: Peer[] = []

async function openPeer(engine: string, type: BrowserType): Promise<Peer> {
  const browser = await launchFixtureBrowser(type)
  const page = await browser.newPage()
  page.on('pageerror', (error) => process.stderr.write(`[${engine}] page error: ${error.message}\n`))
  // The relay arrives through the page's own `?relay=` query string — the thing a visitor
  // pastes. Nothing else here is supplied by the harness.
  await page.goto(`${baseUrl}${PAGE}?relay=${encodeURIComponent(relayAddr)}`)
  await page.waitForFunction(() => typeof window.o2 !== 'undefined', null, { timeout: 60_000 })
  // BROW-01 has no test-only bypass: a harness consents for the same reason a visitor
  // clicks the button. AUTH-06, `42-06`: it signs in for the same reason too, because
  // `window.o2.start` refuses with `SignedOutError` until somebody has opened their own
  // envelope. `signInHarnessTab` does both, in the order its header explains.
  await signInHarnessTab(page)
  const joined = await page.evaluate(
    async (store) => window.o2.autoStart({ blockstoreName: store }),
    `relay-latch-${engine}`,
  )
  // A reservation that has produced no dialable address is a peer nobody can name, so
  // this is part of joining rather than part of any reading.
  await page.evaluate(async () => window.o2.waitForWebrtcAddr(90_000))
  return { engine, browser, page, peerId: joined.peerId }
}

beforeAll(async () => {
  relay = await FabricNode.start({
    relayAdmission: 'admits-any-peer',
    startReporting: 'reports-its-own-start',
    maxReservations: 8,
    listen: ['/ip4/127.0.0.1/tcp/0/ws'],
    // DET-03: this node relays and executes nothing — the subject is two tabs.
    trustAnchors: 'runs-unsigned-artifacts',
  })
  const dialable = relay.browserDialableAddrs[0]
  if (dialable === undefined) throw new Error('relay produced no browser-dialable address')
  relayAddr = dialable

  // Root at the repo so workspace packages and their `./src/index.ts` entries resolve —
  // `two-tabs.e2e.test.ts` gives the full note, including why pre-bundling must stay on.
  server = await createServer({ root: ROOT, logLevel: 'error', server: { port: 0 }, cacheDir: fixtureViteCacheDir(ROOT) })
  await server.listen()
  const url = server.resolvedUrls?.local[0]
  if (url === undefined) throw new Error('vite dev server produced no URL')
  baseUrl = url.endsWith('/') ? url : `${url}/`

  // Sequential: two engines launching at once contend for the CPU and the symptom is a
  // timeout in whichever lost.
  for (const { name, type } of ENGINES) peers.push(await openPeer(name, type))
}, 420_000)

afterAll(async () => {
  for (const peer of peers) {
    await peer.page.evaluate(async () => window.o2.stop()).catch(() => {})
    await peer.browser.close().catch(() => {})
  }
  await server?.close().catch(() => {})
  await relay?.stop().catch(() => {})
}, 180_000)

/** The two tabs, in launch order. */
function pair(): readonly [Peer, Peer] {
  const [a, b] = peers as [Peer, Peer]
  return [a, b]
}

describe('defect 32 — a peer held over nothing but a relay circuit', () => {
  /**
   * The fixture is what it claims to be, checked before anything is read off it.
   *
   * Placed first for `static-rendezvous.e2e.test.ts`'s reason: a missing engine names
   * itself here rather than surfacing as an empty set two cases later, where "no peer is
   * relayed-only" would pass for the wrong reason.
   */
  it('has two distinct tabs, neither yet connected to the other', async () => {
    expect(peers.map((peer) => peer.engine)).toEqual(['firefox', 'webkit'])
    const [a, b] = pair()
    expect(a.peerId).not.toBe(b.peerId)

    for (const [peer, other] of [
      [a, b],
      [b, a],
    ] as const) {
      const held = await peer.page.evaluate(() => window.o2.peers())
      expect({ engine: peer.engine, holds: held.includes(other.peerId) }).toEqual({
        engine: peer.engine,
        holds: false,
      })
      // Each already holds the relay, so "holds nobody" is not what is being read.
      expect(held).toContain(relay.peerId)
    }
  }, 120_000)

  /**
   * The state, constructed deliberately, and the two questions that must disagree about it.
   *
   * `peers()` is `libp2p.getPeers()` — the set the defect trusted. `heldPeers()` is the
   * same set with the fact it could not carry. Requiring `connected: true` in the same
   * breath as `carriesWork: false` is what makes this a reading rather than an absence: a
   * pair that simply failed to connect would go red on the first half, and a `heldPeers`
   * that answered `false` for everything would go red on the relay, which is reached over
   * a direct WebSocket and is checked here for exactly that reason.
   *
   * **Nothing in this case sends an RPC**, and that is not tidiness. `computePeers()`
   * dials the peer as a side effect — see the header — so a probe placed here would repair
   * the state it was called to observe, about half the time, and this case would then be
   * measuring its own instrument.
   */
  it('is connected on one reading and unable to carry a job on the other', async () => {
    const [a, b] = pair()

    // The bare `/p2p-circuit` address — no `/webrtc` — which every tab publishes because
    // `browser-node.ts` listens on both. Dialling it produces the race's end state with
    // no race in it.
    const addrs = await b.page.evaluate(() => window.o2.addresses())
    const bare = addrs.circuit.find((address) => !address.includes('/webrtc'))
    expect(bare).toBeDefined()
    expect(bare).toContain(relay.peerId)
    expect(bare).toContain(b.peerId)

    expect(await a.page.evaluate(async (address) => window.o2.dial(address), bare!)).toBe(b.peerId)

    for (const [peer, other] of [
      [a, b],
      [b, a],
    ] as const) {
      const held = await peer.page.evaluate(() => window.o2.peers())
      const heldPeers = await peer.page.evaluate(() => window.o2.heldPeers())
      const connections = await peer.page.evaluate(
        async (id) => window.o2.connectionsTo(id),
        other.peerId,
      )
      expect({
        engine: peer.engine,
        // Connected, on the reading `planDials` used to make its decision…
        connected: held.includes(other.peerId),
        // …and unable to carry the work that reading was standing in for…
        carriesWork: heldPeers.find((entry) => entry.peer === other.peerId)?.carriesWork,
        // …while the relay, over a direct WebSocket, is not in that state. Without this
        // the row above is satisfied by a `heldPeers` that answers `false` for everything.
        relayCarriesWork: heldPeers.find((entry) => entry.peer === relay.peerId)?.carriesWork,
        // Corroboration from the connection table, which is the same fact
        // `static-rendezvous.e2e.test.ts` reads in the successful direction: every
        // connection to the other tab is a limited circuit and none is WebRTC.
        connections: connections.map((c) => ({
          limited: c.limited,
          webrtc: c.remoteAddr.includes('/webrtc'),
        })),
      }).toEqual({
        engine: peer.engine,
        connected: true,
        carriesWork: false,
        relayCarriesWork: true,
        connections: [{ limited: true, webrtc: false }],
      })
    }
  }, 180_000)

  /**
   * The count that used to be zero, and the field that used to not exist.
   *
   * Pre-fix this round reported `dialed: []` and `failed: []` — measured on both sides,
   * in two separate constructions. The assertion is exact rather than "something
   * happened": **one** dial, and that dial classified as an `upgrade` naming this peer,
   * because a round that had simply forgotten the peer would also attempt one and would
   * be a different repair with a different failure mode.
   *
   * **Deliberately not asserted: that the pair now carries work.** It does not, and
   * pretending otherwise would be the more comfortable proof rather than the true one.
   * firefox's `/webrtc` dial to webkit times out whenever firefox already holds a limited
   * circuit to it — four observations out of four, message `The operation timed out.` —
   * so this pair recovers when the relay's duration limit drops the circuit, exactly as
   * it did before. What changed is that the tab now tries, and says what it is trying to
   * fix. A guard asserting a repair that the underlying transport does not perform would
   * be red for a reason that has nothing to do with this file's subject.
   *
   * A's round alone, not both at once: racing is the thing this file declines to depend on.
   */
  it('is dialled again by the next round, as an upgrade rather than as a stranger', async () => {
    const [a, b] = pair()

    const round = await a.page.evaluate(async () => window.o2.connectDiscoveredPeers())
    expect({
      asked: round.asked,
      attempted: round.dialed.length + round.failed.length,
      upgrades: round.upgrades.length,
      upgradesTheRightPeer: round.upgrades.every((address) => address.endsWith(b.peerId)),
    }).toEqual({
      // The origin has no `/bootstrap.json`, so the only directory that can have answered
      // is the fabric's own reservation store — `findReservedPeers`.
      asked: true,
      attempted: 1,
      upgrades: 1,
      upgradesTheRightPeer: true,
    })

    // What the round leaves, it names. Read against `heldPeers()` rather than against a
    // literal, so this stays true whichever way the dial went: if the upgrade landed both
    // are empty, and if it did not both name the peer. It cannot pass vacuously in the
    // way that matters — `upgrades: 1` above already established that the peer was
    // relayed-only when the round began, so a `relayedOnly` hardcoded to `[]` fails here
    // on every run in which the dial did not land, which is every run so far.
    const heldAfter = await a.page.evaluate(() => window.o2.heldPeers())
    expect([...round.relayedOnly].sort()).toEqual(
      heldAfter.filter((entry) => !entry.carriesWork).map((entry) => entry.peer).sort(),
    )

    // Nothing is given up on yet: the retry budget is three, and one round has been spent.
    // `MAX_UPGRADE_ATTEMPTS` and what it does when exhausted are read in
    // `packages/browser/src/dial-plan.test.ts`, where the outcome of a dial is not a
    // variable and the case can therefore be exact.
    expect(round.stalled).toEqual([])
  }, 300_000)
})
