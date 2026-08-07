import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { request as httpRequest } from 'node:http'
import { KERNEL_TRUST_ANCHOR } from '@o2/demo'
import { chromium } from 'playwright'
import type { Browser, BrowserContext } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SeedServer, lanAddresses, localHostname, relayAddrForHost } from './seed-server.ts'

/**
 * Joining a seed node from another device on the same network.
 *
 * The device under test here is a Chromium page loaded over the machine's **LAN IP**,
 * not localhost — which makes it a non-secure context, exactly as a phone's browser
 * would be. That distinction is the whole point: `crypto.subtle` is absent there, and
 * a build that depends on it joins successfully and then fails at its first block.
 *
 * What is proven: a browser given nothing but a URL discovers the relay, reserves on
 * it, and becomes addressable. What is not proven here is Safari on real iOS
 * hardware — no automation reaches it from this suite.
 */

let seed: SeedServer
let browser: Browser
let context: BrowserContext
let workdir: string

/** Skip gracefully rather than fail when the machine has no LAN address. */
const lanIp = lanAddresses()[0]

beforeAll(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'o2-seed-'))
  // DET-03: the demo's own anchor — exactly what `bin/seed.ts` pins with no flags, which
  // is what this file is the closest thing in the repository to a picture of. Chosen for
  // realism, not coverage: this file calls `computePeers` but never `runColouring` or
  // `runJob`, and `computePeers` sends an `offer` probe and nothing else.
  //
  // Whether this set is ever consulted was **measured, not reasoned**, on 2026-07-31:
  // it was replaced with `[]` — a set that refuses every module — and this file re-run.
  // Every assertion still passed, so **this anchor set is never consulted**. It is here
  // because it is what production pins, not because it covers anything.
  seed = await SeedServer.start({
    blockstoreDir: join(workdir, 'blocks'),
    maxReservations: 32,
    trustAnchors: [KERNEL_TRUST_ANCHOR],
    // AUTH-02 — required since Plan 24-06, and open for the same reason `trustAnchors` above
    // is the demo's own set: this file is the closest thing in the repository to a picture of
    // what `bin/seed.ts` with no flags does, and with no flags that binary's ternary takes
    // exactly this arm. A pinned set here would make this file a picture of a deployment
    // nobody runs — and the browser tab it drives holds no certificate, so it would be
    // refused a circuit and every reading below would be about admission instead of discovery.
    relayAdmission: 'admits-any-peer',
  })
  browser = await chromium.launch()
  context = await browser.newContext()
}, 240_000)

afterAll(async () => {
  await context?.close().catch(() => {})
  await browser?.close().catch(() => {})
  await seed?.stop().catch(() => {})
  await rm(workdir, { recursive: true, force: true })
}, 120_000)

describe('relayAddrForHost', () => {
  it('uses /dns4 for a name and /ip4 for a literal address', () => {
    // A name behind /ip4 parses fine and then never dials — a silent failure worth
    // pinning.
    expect(relayAddrForHost('laptop.local:5173', 4001, 'PEER')).toBe(
      '/dns4/laptop.local/tcp/4001/ws/p2p/PEER',
    )
    expect(relayAddrForHost('192.168.1.5:5173', 4001, 'PEER')).toBe(
      '/ip4/192.168.1.5/tcp/4001/ws/p2p/PEER',
    )
    // Host headers do not always carry a port.
    expect(relayAddrForHost('laptop.local', 4001, 'PEER')).toBe(
      '/dns4/laptop.local/tcp/4001/ws/p2p/PEER',
    )
  })

  it('offers a .local name, which survives the laptop changing IP', () => {
    // The reason the printed URL prefers the Bonjour name over an address.
    expect(localHostname().endsWith('.local')).toBe(true)
    expect(seed.joinUrl).toContain(localHostname())
    expect(seed.joinUrl).toContain(`:${seed.httpPort}`)
  })
})

/**
 * Fetch over the loopback socket while claiming to be `host`.
 *
 * `fetch` will not let the Host header be overridden, and that override is the whole
 * point: a phone reaching the seed by its Bonjour name sends `Host: laptop.local`,
 * and Vite decides whether to answer based on that string alone. Testing only via an
 * IP address proves nothing here, because **IP literals are exempt from the check by
 * default** — which is exactly how the `.local` URL this class prints shipped broken.
 */
async function getAs(host: string, path: string, port: number): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: '127.0.0.1', port, path, method: 'GET', headers: { host } },
      (res) => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (chunk: string) => {
          body += chunk
        })
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }))
      },
    )
    req.on('error', reject)
    req.end()
  })
}

describe('the printed .local URL is actually served', () => {
  it('answers a request whose Host is the Bonjour name', async () => {
    const name = localHostname()

    // Regression: Vite allows only localhost, .localhost and IP literals by default,
    // so this returned "Blocked request. This host is not allowed." while every
    // IP-based test passed.
    const page = await getAs(name, '/packages/browser/demo/index.html', seed.httpPort)
    expect(page.status).toBe(200)
    expect(page.body).not.toContain('not allowed')

    // And an arbitrary Bonjour name, since the machine's own may change.
    const other = await getAs('some-other-laptop.local', '/packages/browser/demo/index.html', seed.httpPort)
    expect(other.status).toBe(200)
  }, 60_000)

  it('hands that same name back as the relay address to dial', async () => {
    const name = localHostname()
    const { status, body } = await getAs(name, '/bootstrap.json', seed.httpPort)
    expect(status).toBe(200)

    const info = JSON.parse(body) as { relayAddrs: string[] }
    // /dns4, not /ip4 — a name behind /ip4 parses and never dials.
    expect(info.relayAddrs[0]).toBe(`/dns4/${name}/tcp/${seed.wsPort}/ws/p2p/${seed.node.peerId}`)
  }, 60_000)

  it('still refuses a host it was never told about', async () => {
    // The protection is narrowed, not removed: an attacker-controlled public domain
    // resolving to this machine must still be turned away.
    const blocked = await getAs('evil.example.com', '/packages/browser/demo/index.html', seed.httpPort)
    expect(blocked.status).not.toBe(200)
  }, 60_000)
})

describe('bootstrap is derived from the host the client used', () => {
  it('answers with the same name the request arrived on', async () => {
    const byName = await fetch(`http://127.0.0.1:${seed.httpPort}/bootstrap.json`)
    expect(byName.ok).toBe(true)
    // Never cached: a joining device must not be handed a stale relay address.
    expect(byName.headers.get('cache-control')).toContain('no-store')

    const info = (await byName.json()) as {
      relayAddrs: string[]
      seedPeerId: string
      peerAddrs: string[]
    }
    expect(info.relayAddrs[0]).toBe(
      `/ip4/127.0.0.1/tcp/${seed.wsPort}/ws/p2p/${seed.node.peerId}`,
    )
    // One peer id, and no second field to disagree with it. `relayPeerId` and
    // `seedPeerId` were two names for two processes; there is one process now.
    expect(info.seedPeerId).toBe(seed.node.peerId)
    expect(info).not.toHaveProperty('relayPeerId')
    // The address a page reserves on and the address of its first peer are the same
    // string, because they are the same node.
    expect(info.peerAddrs[0]).toBe(info.relayAddrs[0])

    // Reached by a different host, it answers with that host instead — no interface
    // enumeration, no guessing, no hardcoded address.
    if (lanIp !== undefined) {
      const byIp = await fetch(`http://${lanIp}:${seed.httpPort}/bootstrap.json`)
      const other = (await byIp.json()) as { relayAddrs: string[] }
      expect(other.relayAddrs[0]).toBe(
        `/ip4/${lanIp}/tcp/${seed.wsPort}/ws/p2p/${seed.node.peerId}`,
      )
    }
  }, 60_000)
})

describe('a second device joins knowing only the URL', () => {
  it.skipIf(lanIp === undefined)(
    'discovers the relay from a non-secure LAN origin and reserves on it',
    async () => {
      const page = await context.newPage()
      page.on('pageerror', (error) => {
        process.stderr.write(`[lan-tab] page error: ${error.message}\n`)
      })

      // Loaded over the LAN IP, exactly as a phone would — so this is a non-secure
      // context with no crypto.subtle.
      await page.goto(`http://${lanIp!}:${seed.httpPort}/packages/browser/demo/index.html`)
      await page.waitForFunction(() => typeof window.o2 !== 'undefined', null, { timeout: 60_000 })

      const context_ = await page.evaluate(() => ({
        secure: window.isSecureContext,
        subtle: typeof crypto.subtle !== 'undefined',
      }))
      expect(context_.secure).toBe(false)
      expect(context_.subtle).toBe(false)

      // No relay address is passed in. The page asks its own origin.
      const joined = await page.evaluate(async () => {
        window.o2.grantConsent()
        return window.o2.autoStart({ blockstoreName: 'lan-join' })
      })
      expect(joined.relayAddrs[0]).toContain(`/ip4/${lanIp!}/tcp/${seed.wsPort}/ws`)
      expect(joined.relayAddrs[0]).toContain(seed.node.peerId)

      // It reserved and became addressable — a real join, not just a fetch.
      const addrs = await page.evaluate(async () => window.o2.waitForWebrtcAddr(60_000))
      expect(addrs.length).toBeGreaterThan(0)
      expect(addrs[0]).toContain(seed.node.peerId)
      expect(seed.node.capacity.granted).toBeGreaterThanOrEqual(1)

      // And content addressing works despite the missing WebCrypto — the thing that
      // silently broke before the pure-JS hasher.
      const cid = await page.evaluate(async () => window.o2.putModule([0, 97, 115, 109, 1, 0, 0, 0]))
      expect(cid.startsWith('bafyrei')).toBe(true)

      await page.close()
    },
    240_000,
  )
})

describe('a lone visitor has a peer, which was a comment before it was true', () => {
  it('finds the node serving the page willing to run its shards', async () => {
    // `BootstrapInfo.seedPeerId` has carried the comment "the seed's own compute
    // node, so a lone phone still has a peer to work with" since it was written.
    // It was false twice over. First that node listened on plain TCP, which no
    // browser can dial, and no address for it was published anywhere. Then, once it
    // was reachable, it was still the *second* of two processes the seed ran — and
    // the first, the relay, could not compute at all, so a page holding two
    // connections had one peer. There is one process now, and the peer a lone
    // visitor gets is the same node it reserved its circuit on.
    const page = await context.newPage()
    page.on('pageerror', (error) => {
      process.stderr.write(`[lone] page error: ${error.message}\n`)
    })
    await page.goto(`http://127.0.0.1:${seed.httpPort}/packages/browser/demo/index.html`)
    await page.waitForFunction(() => typeof window.o2 !== 'undefined', null, { timeout: 60_000 })
    await page.evaluate(async () => {
      window.o2.grantConsent()
      return window.o2.autoStart({ blockstoreName: 'lone-visitor' })
    })

    const found = await page.evaluate(async () => window.o2.connectDiscoveredPeers())
    expect(found.asked).toBe(true)
    // No dial is needed for the seed itself: reserving the circuit already opened
    // that connection and the published address is its far end. Deliberately not
    // asserted through `dialed`/`failed` — those also carry stale circuit addresses
    // for tabs earlier tests in this file closed, and pinning them would make this
    // claim depend on reservation expiry rather than on the topology.
    expect(await page.evaluate(() => window.o2.peers())).toContain(seed.node.peerId)

    // And it is a *compute* peer, established by asking rather than by assuming. The
    // node carrying this page's circuit answers the agent protocol, because relaying
    // and computing are the same node.
    const computing = await page.evaluate(async () => window.o2.computePeers())
    expect(computing).toContain(seed.node.peerId)

    await page.close()
  }, 240_000)
})

describe('two devices on one seed find each other with nobody dialling for them', () => {
  it('publishes reserved peers and each page dials the rest', async () => {
    // The gap this closes was found by running the demo on a phone and a laptop at
    // once: both joined, both were addressable, and neither ever heard of the
    // other. A browser binds no listening socket — the *only* difference between
    // nodes in this fabric — so no tab can announce itself and none of them will
    // ever be dialled cold. Somebody has to say who is present, and the one node
    // that can be reached cold is the one serving the page.
    //
    // Deliberately no `window.o2.dial(...)` anywhere below. Every other multi-tab
    // test in this repository dials from the harness, which is exactly why none of
    // them caught this.
    const first = await context.newPage()
    const second = await context.newPage()
    for (const [name, page] of [
      ['peer-a', first],
      ['peer-b', second],
    ] as const) {
      page.on('pageerror', (error) => {
        process.stderr.write(`[${name}] page error: ${error.message}\n`)
      })
    }

    const url = `http://127.0.0.1:${seed.httpPort}/packages/browser/demo/index.html`
    const ids: string[] = []
    for (const [i, page] of [first, second].entries()) {
      await page.goto(url)
      await page.waitForFunction(() => typeof window.o2 !== 'undefined', null, { timeout: 60_000 })
      const joined = await page.evaluate(async (store) => {
        window.o2.grantConsent()
        return window.o2.autoStart({ blockstoreName: store })
      }, `rendezvous-${i}`)
      await page.evaluate(async () => window.o2.waitForWebrtcAddr(60_000))
      ids.push(joined.peerId)
    }
    const [idA, idB] = ids as [string, string]
    expect(idA).not.toBe(idB)
    expect(seed.node.reservedPeerIds).toEqual(expect.arrayContaining([idA, idB]))

    // Each page asks the origin who is here and dials them. No harness involvement.
    for (const page of [first, second]) {
      const found = await page.evaluate(async () => window.o2.connectDiscoveredPeers())
      expect(found.asked).toBe(true)
      // Something was attempted. An empty `dialed` *and* an empty `failed` is the
      // signature of the bug this test was written for: every candidate skipped by
      // a filter, nothing tried, and no error anywhere to notice.
      expect(found.dialed.length + found.failed.length).toBeGreaterThan(0)
    }

    const peersOfA = await first.evaluate(() => window.o2.peers())
    const peersOfB = await second.evaluate(() => window.o2.peers())
    expect(peersOfA.concat(peersOfB)).toContain(idB)

    // And a page filters its own published address out rather than dialling itself.
    expect(peersOfA).not.toContain(idA)
    expect(peersOfB).not.toContain(idB)

    // Calling again is a no-op: peers already connected are skipped, so a timer can
    // drive this without accumulating duplicate connections.
    const again = await first.evaluate(async () => window.o2.connectDiscoveredPeers())
    expect(again.dialed).toEqual([])

    // Two callers arriving together get one round. The page polls on a 4s timer and
    // a round can outlive a tick, so overlapping rounds dial the same candidates
    // twice and the loser finishes into a surface that has already moved on.
    // Compared inside the page: object identity does not survive serialization out.
    const rounds = await first.evaluate(async () => {
      const [a, b] = await Promise.all([
        window.o2.connectDiscoveredPeers(),
        window.o2.connectDiscoveredPeers(),
      ])
      // And the memo clears afterwards rather than latching — two rounds run in
      // sequence must still be two rounds.
      const third = await window.o2.connectDiscoveredPeers()
      const fourth = await window.o2.connectDiscoveredPeers()
      return { coalesced: a === b, latched: third === fourth }
    })
    expect(rounds.coalesced).toBe(true)
    expect(rounds.latched).toBe(false)

    // Every connection is a compute peer, and that is the fix rather than the
    // caveat. Holding a reservation *is* a libp2p connection, so `peers()` has
    // always contained the node carrying the circuit; what changed is that the node
    // now answers an offer, because relaying and computing are one class. The demo
    // used to report "2 compute peers of 3 connections" and had no way to name the
    // missing one. Established by asking, not by classifying — `computePeers` sends
    // an offer and counts who replies, so this would still be correct if some peer
    // genuinely did not serve the protocol.
    const connected = await first.evaluate(() => window.o2.peers())
    const computing = await first.evaluate(async () => window.o2.computePeers())
    expect(connected).toContain(seed.node.peerId)
    expect(computing).toContain(seed.node.peerId)
    expect(computing).toContain(idB)
    expect([...computing].sort()).toEqual([...connected].sort())

    await first.close()
    await second.close()
  }, 300_000)
})
