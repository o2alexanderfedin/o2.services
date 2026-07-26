import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { request as httpRequest } from 'node:http'
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
    expect(info.relayAddrs[0]).toBe(`/dns4/${name}/tcp/${seed.relayPort}/ws/p2p/${seed.relay.peerId}`)
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
