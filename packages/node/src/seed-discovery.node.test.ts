import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
  seed = await SeedServer.start({ blockstoreDir: join(workdir, 'blocks'), maxReservations: 32 })
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

describe('bootstrap is derived from the host the client used', () => {
  it('answers with the same name the request arrived on', async () => {
    const byName = await fetch(`http://127.0.0.1:${seed.httpPort}/bootstrap.json`)
    expect(byName.ok).toBe(true)
    // Never cached: a joining device must not be handed a stale relay address.
    expect(byName.headers.get('cache-control')).toContain('no-store')

    const info = (await byName.json()) as { relayAddrs: string[]; relayPeerId: string }
    expect(info.relayAddrs[0]).toBe(
      `/ip4/127.0.0.1/tcp/${seed.relayPort}/ws/p2p/${seed.relay.peerId}`,
    )
    expect(info.relayPeerId).toBe(seed.relay.peerId)

    // Reached by a different host, it answers with that host instead — no interface
    // enumeration, no guessing, no hardcoded address.
    if (lanIp !== undefined) {
      const byIp = await fetch(`http://${lanIp}:${seed.httpPort}/bootstrap.json`)
      const other = (await byIp.json()) as { relayAddrs: string[] }
      expect(other.relayAddrs[0]).toBe(
        `/ip4/${lanIp}/tcp/${seed.relayPort}/ws/p2p/${seed.relay.peerId}`,
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
      const joined = await page.evaluate(async () => window.o2.autoStart({ blockstoreName: 'lan-join' }))
      expect(joined.relayAddrs[0]).toContain(`/ip4/${lanIp!}/tcp/${seed.relayPort}/ws`)
      expect(joined.relayAddrs[0]).toContain(seed.relay.peerId)

      // It reserved and became addressable — a real join, not just a fetch.
      const addrs = await page.evaluate(async () => window.o2.waitForWebrtcAddr(60_000))
      expect(addrs.length).toBeGreaterThan(0)
      expect(addrs[0]).toContain(seed.relay.peerId)
      expect(seed.relay.capacity.granted).toBeGreaterThanOrEqual(1)

      // And content addressing works despite the missing WebCrypto — the thing that
      // silently broke before the pure-JS hasher.
      const cid = await page.evaluate(async () => window.o2.putModule([0, 97, 115, 109, 1, 0, 0, 0]))
      expect(cid.startsWith('bafyrei')).toBe(true)

      await page.close()
    },
    240_000,
  )
})
