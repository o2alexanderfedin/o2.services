import { spawn } from 'node:child_process'
import type { ChildProcessByStdio } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Readable, Writable } from 'node:stream'
import { chromium } from 'playwright'
import type { Browser, BrowserContext, Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * NET-03, runnable half — the relay binary an operator actually runs, on a real socket,
 * dialled by real browsers.
 *
 * ## The row this file is a partial answer to, split honestly
 *
 * NET-03 reads: *"A backbone relay node auto-acquires a TLS certificate and accepts browser
 * reservations without manual certificate management."* That is two clauses, and only one
 * of them is obtainable on a private host:
 *
 * - **`accepts browser reservations without manual certificate management`** — measured
 *   here. No certificate is configured anywhere below, none is needed, and two real
 *   browsers reserve on the relay and find each other through it.
 * - **`auto-acquires a TLS certificate`** — **not** measured here and not measurable here.
 *   AutoTLS (`@ipshipyard/libp2p-auto-tls`) obtains a Let's Encrypt certificate for
 *   `<peerId>.libp2p.direct` by proving control of a publicly reachable address to
 *   `registration.libp2p.direct`; a host behind NAT with no public DNS name cannot make
 *   that proof, and the package is not installed in this repository. Nothing in this file
 *   should be read as evidence about it. The clause stays unmet.
 *
 * ## Why this spawns the binary rather than importing `SeedServer`
 *
 * `seed-discovery.e2e.test.ts` already drives real browsers against a `SeedServer.start()`
 * **in this process**, and it is the closest existing picture of what a joining device
 * sees. What it cannot see is the binary: `bin/seed.ts` parses argv, applies its own
 * defaults, arms an orphan leash and prints a banner, and a page joining a real deployment
 * meets *that*, not a constructor call. So the seed here is a separate operating-system
 * process, started exactly as an operator starts it, and every fact this file asserts about
 * reservations is read back **over HTTP from that process** — never off an in-process
 * object it could have read from a variable instead.
 *
 * That is also what makes the reservation reading non-vacuous. `/bootstrap.json` is built
 * per request from `FabricNode.reservedPeerIds` inside the seed process, so a browser peer
 * id appearing in `peerAddrs` is the *seed* stating that it granted that peer a circuit.
 * A harness holding the node object could assert the same field without a socket in the
 * path; this one cannot.
 *
 * ## What it does not establish
 *
 * One host, one kernel, one browser engine (Chromium). Two isolated `BrowserContext`s are
 * two independent nodes in every sense except the machine they run on — separate origin
 * storage, separate IndexedDB, separate peer identity, separate libp2p state — and that one
 * exception is the one this file makes no claim about. The standing ruling at
 * `vitest.config.ts:716` binds here too: contexts on one host are not machines.
 */

const SEED = fileURLToPath(new URL('./bin/seed.ts', import.meta.url))
const PAGE_PATH = '/packages/browser/demo/index.html'

/** The seed's banner is measured at ~590 ms; this is two orders of margin over that. */
const BANNER_BUDGET_MS = 120_000
/** A browser tab joining a relay: page load, wasm init, dial, reservation. */
const JOIN_BUDGET_MS = 60_000
/** Whole-case budget: a spawn, two browser contexts, two joins and a rendezvous. */
const CASE_TIMEOUT_MS = 300_000

type SeedProcess = ChildProcessByStdio<Writable, Readable, Readable>

interface Timings {
  [stage: string]: number
}

/** Every stage this file measured, printed once at the end beside what bounds it. */
const timings: Timings = {}

/** Time an awaited stage and record it under `name`. */
async function timed<T>(name: string, work: () => Promise<T>): Promise<T> {
  const started = performance.now()
  const value = await work()
  timings[name] = performance.now() - started
  return value
}

/**
 * A port the OS just told us was free.
 *
 * Inherently a small race — the port is released before the seed claims it — and taken
 * anyway because `bin/seed.ts` prints its HTTP port nowhere: the banner carries the relay
 * multiaddr and the join URLs, and the join URLs are built from `.local`/LAN names that a
 * CI host may not resolve. Asking for `--port 0` would leave this file with no way to learn
 * where to point a browser. A collision surfaces as a spawn that never banners, inside
 * `BANNER_BUDGET_MS`, and not as a wrong answer.
 */
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      if (address === null || typeof address === 'string') {
        probe.close()
        reject(new Error('no port assigned'))
        return
      }
      const { port } = address
      probe.close(() => resolve(port))
    })
  })
}

interface Seed {
  readonly child: SeedProcess
  readonly httpPort: number
  readonly wsPort: number
  readonly peerId: string
  readonly relayAddrs: readonly string[]
  readonly banner: string
}

/** Spawn the real binary and resolve once its banner names a peer id and a relay address. */
async function startSeed(dir: string): Promise<Seed> {
  const httpPort = await freePort()
  // Sequentially, because the first probe has already closed by the time the second opens
  // and the OS is free to hand back the same number. Two ports that are secretly one port
  // produces a seed whose HTTP server and WebSocket listener fight over a socket, and the
  // symptom is a spawn that never banners — a slow, confusing failure for a fast, checkable
  // cause.
  let candidate = await freePort()
  for (let attempt = 0; candidate === httpPort && attempt < 8; attempt += 1) {
    candidate = await freePort()
  }
  if (candidate === httpPort) throw new Error('could not obtain two distinct free ports')
  const wsPort = candidate
  const child: SeedProcess = spawn(
    process.execPath,
    [
      SEED,
      '--dir',
      dir,
      '--port',
      String(httpPort),
      '--ws-port',
      String(wsPort),
      '--reservations',
      '32',
    ],
    // `'pipe'` on fd 0 is load-bearing: `bin/seed.ts` arms its orphan leash by watching fd
    // 0, and `'ignore'` hands it a character device, which opts the leash out and leaves a
    // server holding a port for the rest of the run.
    { stdio: ['pipe', 'pipe', 'pipe'] },
  )

  let banner = ''
  let stderr = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk
  })

  const ready = new Promise<Seed>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          `seed printed no complete banner in ${BANNER_BUDGET_MS} ms.\n` +
            `stdout so far:\n${banner}\nstderr:\n${stderr}`,
        ),
      )
    }, BANNER_BUDGET_MS)

    child.once('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`seed exited with ${code} before bannering.\nstderr:\n${stderr}`))
    })

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      banner += chunk
      const peerId = /^\s*peer id\s+(\S+)\s*$/m.exec(banner)?.[1]
      const relayAddrs = [...banner.matchAll(/^\s*relay\s+(\S+)\s*$/gm)].map((m) => m[1] as string)
      // The `trusts` line is printed after every `relay` line, so its presence is what says
      // the relay list is complete rather than mid-write.
      const complete = /^\s*trusts\s+/m.test(banner)
      if (peerId === undefined || relayAddrs.length === 0 || !complete) return
      clearTimeout(timer)
      resolve({ child, httpPort, wsPort, peerId, relayAddrs, banner })
    })
  })

  return ready
}

async function stopSeed(seed: Seed | undefined): Promise<void> {
  if (seed === undefined) return
  const { child } = seed
  if (child.exitCode !== null) return
  await new Promise<void>((resolve) => {
    const kill = setTimeout(() => {
      child.kill('SIGKILL')
      resolve()
    }, 10_000)
    child.once('exit', () => {
      clearTimeout(kill)
      resolve()
    })
    child.kill('SIGTERM')
  })
}

interface Bootstrap {
  readonly relayAddrs: readonly string[]
  readonly seedPeerId: string
  readonly peerAddrs: readonly string[]
  readonly enrollmentProvider?: string
}

/** Ask the seed process, over a real socket, what it is currently publishing. */
async function fetchBootstrap(httpPort: number): Promise<Bootstrap> {
  const response = await fetch(`http://127.0.0.1:${httpPort}/bootstrap.json`)
  expect(response.status).toBe(200)
  expect(response.headers.get('content-type')).toContain('application/json')
  return (await response.json()) as Bootstrap
}

let workdir: string
let seed: Seed | undefined
let browser: Browser | undefined
const contexts: BrowserContext[] = []

beforeAll(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'o2-seed-bin-'))
  seed = await timed('seed-spawn-to-banner', async () => startSeed(join(workdir, 'seed')))
  browser = await timed('chromium-launch', async () => chromium.launch())
}, 240_000)

afterAll(async () => {
  for (const context of contexts) await context.close().catch(() => {})
  await browser?.close().catch(() => {})
  await stopSeed(seed)
  if (workdir !== undefined) await rm(workdir, { recursive: true, force: true })
})

describe('NET-03 (runnable half) — the seed binary on a real socket, joined by real browsers', () => {
  it('bannered a relay address a browser can dial, with no certificate configured anywhere', () => {
    const live = seed
    if (live === undefined) throw new Error('seed did not start')
    // A browser can only dial a WebSocket relay. The banner has to contain one, or the two
    // joins below could only ever fail — and they would fail for a reason this reading
    // names precisely.
    expect(live.relayAddrs.some((addr) => addr.includes('/ws'))).toBe(true)
    expect(live.relayAddrs.every((addr) => addr.includes(live.peerId))).toBe(true)
    // Manual certificate management is what NET-03's second clause is about. Nothing was
    // configured, and the relay is dialable regardless — over `ws`, not `wss`, which is
    // exactly why the AutoTLS clause is the one that stays unmet.
    expect(live.banner).not.toMatch(/wss|tls/i)
  })

  it(
    'two real browsers fetch bootstrap, reserve on the relay, and find each other through it',
    async () => {
      const live = seed
      const engine = browser
      if (live === undefined || engine === undefined) throw new Error('rig did not start')

      // Before anyone joins: the seed publishes itself and nobody else.
      const before = await timed('bootstrap-fetch-empty', async () => fetchBootstrap(live.httpPort))
      expect(before.seedPeerId).toBe(live.peerId)
      expect(before.relayAddrs.length).toBe(1)
      expect(before.relayAddrs[0]).toContain(live.peerId)
      // `peerAddrs[0]` is the seed's own address; a reservation adds entries after it. With
      // no tab joined there is exactly one, and that is what makes the growth below mean
      // something rather than being a field that was always populated.
      expect(before.peerAddrs.length).toBe(1)

      const url = `http://127.0.0.1:${live.httpPort}${PAGE_PATH}`
      const pages: Page[] = []
      const peerIds: string[] = []

      for (const [index, name] of ['peer-a', 'peer-b'].entries()) {
        // A separate context per tab: separate origin storage, so the two share no
        // IndexedDB, no identity and no libp2p state. Two nodes, not two views of one.
        const context = await engine.newContext()
        contexts.push(context)
        const page = await context.newPage()
        page.on('pageerror', (error) => {
          process.stderr.write(`[${name}] page error: ${error.message}\n`)
        })
        pages.push(page)

        await timed(`${name}-page-ready`, async () => {
          await page.goto(url)
          await page.waitForFunction(() => typeof window.o2 !== 'undefined', null, {
            timeout: JOIN_BUDGET_MS,
          })
        })

        // The page fetches `/bootstrap.json` **from its own origin** and is handed the relay
        // to dial. No address is passed in from the harness anywhere in this file.
        const fetched = await page.evaluate(async () => {
          const res = await fetch('/bootstrap.json')
          return (await res.json()) as { relayAddrs: string[]; seedPeerId: string }
        })
        expect(fetched.seedPeerId).toBe(live.peerId)
        expect(fetched.relayAddrs[0]).toContain(`/tcp/${live.wsPort}/ws`)

        const joined = await timed(`${name}-autostart`, async () =>
          page.evaluate(async (store) => {
            window.o2.grantConsent()
            return window.o2.autoStart({ blockstoreName: store })
          }, `seed-binary-${index}`),
        )
        expect(joined.relayAddrs[0]).toContain(live.peerId)

        // It reserved and became addressable — a real circuit, not merely a fetch.
        const addrs = await timed(`${name}-reservation`, async () =>
          page.evaluate(async (budget) => window.o2.waitForWebrtcAddr(budget), JOIN_BUDGET_MS),
        )
        expect(addrs.length).toBeGreaterThan(0)
        expect(addrs[0]).toContain(live.peerId)
        peerIds.push(joined.peerId)
      }

      const [idA, idB] = peerIds as [string, string]
      expect(idA).not.toBe(idB)

      // ── the cross-process reservation proof ──────────────────────────────────────
      //
      // Read back over HTTP from the seed **process**, which is where `reservedPeerIds`
      // lives. This file holds no reference to that node and could not have written these
      // ids into the answer.
      const after = await timed('bootstrap-fetch-joined', async () =>
        fetchBootstrap(live.httpPort),
      )
      expect(after.peerAddrs.length).toBe(3)
      for (const id of [idA, idB]) {
        expect(after.peerAddrs.some((addr) => addr.endsWith(`/p2p-circuit/webrtc/p2p/${id}`))).toBe(
          true,
        )
      }

      // ── each page asks the origin who is here and dials them ─────────────────────
      //
      // Deliberately no `window.o2.dial(...)` anywhere: a browser binds no listening socket,
      // so if the harness dials for it the test proves nothing about whether the fabric can
      // introduce two tabs that cannot announce themselves.
      const rounds: { dialed: number; failed: number }[] = []
      for (const [index, page] of pages.entries()) {
        const found = await timed(`rendezvous-${index}`, async () =>
          page.evaluate(async () => window.o2.connectDiscoveredPeers()),
        )
        // The page reached a directory. On a seed-served origin that is `/bootstrap.json`;
        // `asked` false would mean no directory answered at all, and every reading below
        // would then be about a page that never looked.
        expect(found.asked).toBe(true)
        rounds.push({ dialed: found.dialed.length, failed: found.failed.length })
      }

      // **The outcome, not the round, is the claim** — and this is a correction made after
      // watching the first version fail. Asserting `dialed + failed > 0` on *this* call
      // treats the explicit round as the only one that can have dialled, and the demo page
      // polls discovery on its own 4 s timer. By the time both tabs had joined, that timer
      // had already run a round and connected them, so the explicit call correctly reported
      // a no-op — `dialed: []`, `failed: []` — and the assertion failed on a fabric that had
      // done exactly what it is supposed to do.
      //
      // What NET-03's runnable half actually claims is that two tabs which cannot announce
      // themselves end up connected through the relay **with nobody outside the pages
      // dialling for them**. That is a statement about the end state, and it is what is
      // asserted here. The no-harness-dial half is structural: `window.o2.dial(` appears
      // nowhere in this file, which is a property a reader can check by grepping it.
      const rendezvousBudgetMs = 30_000
      const deadline = Date.now() + rendezvousBudgetMs
      let peersOfA: string[] = []
      let peersOfB: string[] = []
      const rendezvousStarted = performance.now()
      for (;;) {
        peersOfA = await pages[0]!.evaluate(() => window.o2.peers())
        peersOfB = await pages[1]!.evaluate(() => window.o2.peers())
        if (peersOfA.includes(idB) && peersOfB.includes(idA)) break
        if (Date.now() >= deadline) break
        await new Promise((resolve) => setTimeout(resolve, 250))
      }
      timings['rendezvous-settle'] = performance.now() - rendezvousStarted

      expect(peersOfA).toContain(idB)
      expect(peersOfB).toContain(idA)
      // A page filters its own published address out rather than dialling itself.
      expect(peersOfA).not.toContain(idA)
      expect(peersOfB).not.toContain(idB)
      process.stdout.write(
        `[seed-binary-join] explicit discovery rounds: ${rounds
          .map((r, i) => `tab${i}(dialed=${r.dialed} failed=${r.failed})`)
          .join(' ')}\n`,
      )

      // ── the seed is still a separate live process, which is the whole premise ────
      expect(live.child.exitCode).toBe(null)
      expect(live.child.pid).not.toBe(process.pid)

      process.stdout.write(
        `[seed-binary-join] seedPid=${live.child.pid} driverPid=${process.pid} ` +
          `httpPort=${live.httpPort} wsPort=${live.wsPort} reservations=2\n` +
          `[seed-binary-join] ${Object.entries(timings)
            .map(([stage, ms]) => `${stage}=${ms.toFixed(0)}ms`)
            .join(' ')}\n` +
          `[seed-binary-join] ONE HOST, ONE KERNEL, ONE ENGINE (chromium): real sockets and ` +
          `two isolated browser contexts; NOT two machines, and NOT a TLS certificate — ` +
          `AutoTLS is unmeasured here and stays unmet\n`,
      )
    },
    CASE_TIMEOUT_MS,
  )
})
