import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import type { Server } from 'node:http'
import { readFile } from 'node:fs/promises'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import type { Browser } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { RelayNode } from './relay-node.ts'

/**
 * The *built* bundle, served by a dumb static file server.
 *
 * Everything else exercises the Vite dev server, which resolves modules on the fly
 * and forgives a great deal. A static host does neither — it hands over the files it
 * has and nothing more. That is what GitHub Pages is, so it is what the artifact has
 * to be tested against before being published.
 *
 * Two behaviours matter here and are not covered anywhere else:
 *
 *   1. With no relay to be found, the page must *say so* rather than appear broken.
 *      A public URL that silently fails is worse than no public URL.
 *   2. With `?relay=<multiaddr>`, the page must discover it from the link, because a
 *      static host has no `/bootstrap.json` to serve.
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const DIST = join(ROOT, 'packages', 'browser', 'dist')

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
}

let server: Server
let baseUrl: string
let browser: Browser
let relay: RelayNode
let workdir: string

beforeAll(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'o2-dist-'))

  // Build here rather than assuming a previous build is current — the test must fail
  // when the *sources* break the bundle, not when someone forgot to rebuild.
  execFileSync('npx', ['vite', 'build', '--config', 'packages/browser/vite.config.ts'], {
    cwd: ROOT,
    stdio: 'pipe',
  })

  // A deliberately dumb server: no module resolution, no transforms, no fallbacks.
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

  relay = await RelayNode.start({ maxReservations: 8 })
  browser = await chromium.launch()
}, 300_000)

afterAll(async () => {
  await browser?.close().catch(() => {})
  await relay?.stop().catch(() => {})
  await new Promise<void>((resolve) => server?.close(() => resolve()))
  await rm(workdir, { recursive: true, force: true })
}, 120_000)

describe('the built bundle on a static host', () => {
  it('loads and runs with no module server behind it', async () => {
    const page = await browser.newPage()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))

    await page.goto(baseUrl)
    await page.waitForFunction(() => typeof window.o2 !== 'undefined', null, { timeout: 60_000 })

    // A bundling failure shows up here and nowhere else — the dev server would have
    // papered over it.
    expect(errors).toEqual([])
    await page.close()
  }, 180_000)

  it('reports that no relay is reachable, instead of looking broken', async () => {
    const page = await browser.newPage()
    await page.goto(baseUrl)
    await page.waitForFunction(() => typeof window.o2 !== 'undefined', null, { timeout: 60_000 })

    // /bootstrap.json 404s, as it will on any static host.
    const discovery = await page.evaluate(async () => window.o2.discoverRelays())
    expect(discovery.source).toBe('none')
    expect(discovery.relayAddrs).toEqual([])

    // And the page says so, in those words, with the Start button unavailable.
    await page.waitForFunction(
      () => document.getElementById('state')?.dataset['tone'] === 'blocked',
      null,
      { timeout: 30_000 },
    )
    expect(await page.textContent('#state')).toContain('no relay')
    expect(await page.isDisabled('#join')).toBe(true)
    // The explanation names the thing a visitor would need to do next.
    expect(await page.textContent('#explain')).toContain('?relay=')

    await page.close()
  }, 180_000)

  it('takes a relay from ?relay= and joins with it', async () => {
    const relayAddr = relay.browserDialableAddrs[0]!
    const page = await browser.newPage()
    await page.goto(`${baseUrl}/?relay=${encodeURIComponent(relayAddr)}`)
    await page.waitForFunction(() => typeof window.o2 !== 'undefined', null, { timeout: 60_000 })

    const discovery = await page.evaluate(async () => window.o2.discoverRelays())
    expect(discovery.source).toBe('query')
    expect(discovery.relayAddrs).toEqual([relayAddr])

    // The button is offered, and pressing it produces a real reservation.
    await page.waitForFunction(() => document.getElementById('join')?.hasAttribute('disabled') === false, null, {
      timeout: 30_000,
    })
    await page.click('#join')
    await page.waitForFunction(
      () => document.getElementById('state')?.dataset['tone'] === 'live',
      null,
      { timeout: 90_000 },
    )

    expect(await page.textContent('#state')).toContain('node running')
    expect(relay.capacity.granted).toBeGreaterThanOrEqual(1)

    await page.close()
  }, 240_000)
})
