import { spawn } from 'node:child_process'
import type { ChildProcessByStdio } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Readable, Writable } from 'node:stream'
import { chromium, firefox, webkit } from 'playwright'
import type { Browser, BrowserType, Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PublicKeyHex } from '@o2/core'
import { KERNEL_TRUST_ANCHOR } from '@o2/demo'
import { FabricNode } from './fabric-node.ts'

/**
 * A **visitor** enrols — AUTH-01, AUTH-02, AUTH-04.
 *
 * ## What was missing, and why an existing green file did not cover it
 *
 * `gated-seed.e2e.test.ts` already drives the demo page against a gated seed in three
 * engines and watches a tab move from refused to admitted. It proves the *plumbing*. What
 * it cannot prove is the thing the v1.1 milestone audit filed as blockers B1–B3, because it
 * does the one move a visitor cannot: it reaches into the page and calls
 *
 * ```ts
 * window.o2.start({ enrollment: { providerAddr, operatorId, userPrivateKey } })
 * ```
 *
 * with key material the harness generated. **A visitor has no Playwright.** On the tree as
 * it stood before 2026-08-17 the visitor path was:
 *
 * - **B1** — `demo/main.ts`'s `autoStart` called `api.start` with no `enrollment` key, so
 *   no certificate was ever stored, so `enrolledIssuer` always answered `null`, so
 *   `trustedIssuers` was never passed and the tab took blocks from every connected peer.
 * - **B2** — `enrollmentProvider` was produced by `bin/seed.ts`, transported in
 *   `/bootstrap.json`, parsed by `discoverRelays` and then **dropped**: `demo/index.html`
 *   referenced the field nowhere. A four-hop flow whose last hop did not exist.
 * - **B3** — their composition: a `--admit-issuer` seed was joinable by no browser tab.
 *
 * So every action below is a **click on a control that is on the page**, and the only
 * `page.evaluate` calls are *reads*. Nothing in this file passes the page an address, a key,
 * an operator id, or a decision. If the demo's UI stops offering enrolment, this file fails;
 * that is the whole point of it, and it is what `gated-seed.e2e.test.ts` structurally cannot
 * check.
 *
 * ## Why the seed is the real binary, with the real flag
 *
 * `relay-admission.node.test.ts` proves `--admit-issuer` closes the door against a *Node*
 * joiner. `seed-binary-join.e2e.test.ts` drives *browsers* against a spawned seed, with no
 * flags. Neither of those is B3, which is about the two together — so the seed here is a
 * separate operating-system process started exactly as an operator starts it, with
 * `--admit-issuer` and `--enrollment-provider` on its argv, and every fact asserted about
 * admission is read back **over HTTP from that process**. A harness holding the node object
 * could assert `reservedPeerIds` without a socket in the path; this one cannot.
 *
 * ## What makes the positive reading non-vacuous
 *
 * `strangerNode` — an in-process `FabricNode` on the same relay, alive throughout, holding
 * no certificate. It is never advertised. Without it, "the seed advertises the tab" would be
 * consistent with a seed that advertises everybody, and the door would be unmeasured.
 *
 * ## What this does NOT establish
 *
 * One host, one kernel. Three browser engines are three engines and not three machines —
 * the standing ruling at `vitest.config.ts` binds here as it does everywhere else. And this
 * says nothing about whether the tab's *own* verifier excludes an unverified peer off the
 * wire; `tab-pinning.e2e.test.ts` owns that reading.
 */

const SEED = fileURLToPath(new URL('./bin/seed.ts', import.meta.url))
const PAGE_PATH = '/packages/browser/demo/index.html'

/** The build authority every node here pins — DET-03, DATA-08. Nothing is dispatched. */
const TRUST_ANCHORS: readonly PublicKeyHex[] = [KERNEL_TRUST_ANCHOR]

/** The engines the browser-tier standard names, in the order they are launched. */
const ENGINES: readonly { readonly name: string; readonly type: BrowserType }[] = [
  { name: 'chromium', type: chromium },
  { name: 'firefox', type: firefox },
  { name: 'webkit', type: webkit },
]

/** The seed's banner is measured at ~590 ms elsewhere; two orders of margin over that. */
const BANNER_BUDGET_MS = 120_000
/** A tab enrolling and reserving: page load, wasm init, dial, enrol, reservation. */
const ADMIT_BUDGET_MS = 90_000
/** How long a refusal is held before it is believed. */
const REFUSAL_WINDOW_MS = 6_000
/** Whole-case budget for one engine: launch, load, consent, enrol, join, admission. */
const CASE_TIMEOUT_MS = 420_000

type SeedProcess = ChildProcessByStdio<Writable, Readable, Readable>

interface Seed {
  readonly child: SeedProcess
  readonly httpPort: number
  readonly wsPort: number
  readonly peerId: string
  readonly banner: string
}

let workdir: string
let provider: FabricNode | undefined
let providerIssuer: PublicKeyHex
let providerAddr: string
let strangerNode: FabricNode | undefined
let seed: Seed | undefined
let pageUrl: string

/**
 * A port the OS just told us was free.
 *
 * `seed-binary-join.e2e.test.ts`'s helper, copied rather than shared for the reason every
 * e2e helper in this directory is copied — there is no shared harness module, and its own
 * docblock explains why the small race is taken: `bin/seed.ts` prints its HTTP port nowhere,
 * so `--port` must be known in advance.
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

/** A node's own listening WebSocket address — never a circuit, which also matches `/ws`. */
function directWsAddr(node: FabricNode): string {
  const found = node.browserDialableAddrs.find((address) => !address.includes('/p2p-circuit'))
  if (found === undefined) {
    throw new Error(`no direct /ws address; multiaddrs=${JSON.stringify(node.multiaddrs)}`)
  }
  return found
}

/**
 * Start the separated provider in **two** steps, and the second is not a workaround.
 *
 * A provider's issuer key does not exist until `issuesCertificates` has been through a
 * start, so the node is started once to mint and persist it under `blockstoreDir`, stopped,
 * and restarted on the **same directory**. `enrollment-cost.node.test.ts` measured that a
 * provider restarting on the same directory keeps its issuer key across a different pid, so
 * this is an established property rather than an assumption — and the issuer key has to be
 * known *before* the seed is spawned, because it goes on the seed's argv.
 */
async function startProvider(): Promise<void> {
  const minting = await FabricNode.start({
    relayAdmission: new Set<PublicKeyHex>(),
    startReporting: 'reports-its-own-start',
    blockstoreDir: join(workdir, 'provider'),
    listen: ['/ip4/127.0.0.1/tcp/0/ws'],
    trustAnchors: TRUST_ANCHORS,
    issuesCertificates: 'issues-without-an-aggregate-budget',
  })
  const minted = minting.issuerKey
  await minting.stop()
  if (minted === null) throw new Error('the provider was started to issue and minted no key')
  providerIssuer = minted

  provider = await FabricNode.start({
    relayAdmission: new Set<PublicKeyHex>([providerIssuer]),
    startReporting: 'reports-its-own-start',
    blockstoreDir: join(workdir, 'provider'),
    listen: ['/ip4/127.0.0.1/tcp/0/ws'],
    trustAnchors: TRUST_ANCHORS,
    issuesCertificates: 'issues-without-an-aggregate-budget',
  })
  if (provider.issuerKey !== providerIssuer) {
    throw new Error(`the provider minted a second issuer across its restart: ${String(provider.issuerKey)}`)
  }
  providerAddr = directWsAddr(provider)
}

/**
 * Spawn the real binary with the two flags this file is about, and resolve on its banner.
 *
 * `--admit-issuer` is the door and `--enrollment-provider` is the way through it. A seed
 * given the first and not the second is one its own banner calls joinable by NOBODY, and
 * that pairing is the deployment `SeedServerOptions.relayAdmission` states in words.
 */
async function startSeed(dir: string): Promise<Seed> {
  const httpPort = await freePort()
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
      // **The subject.** The door, and the way through it.
      '--admit-issuer',
      providerIssuer,
      '--enrollment-provider',
      providerAddr,
    ],
    // `'pipe'` on fd 0 is load-bearing: `bin/seed.ts` arms its orphan leash by watching fd
    // 0, and `'ignore'` hands it a character device, which opts the leash out and leaves a
    // server holding a port for the rest of the run. `orphan-leash.node.test.ts` fails any
    // spawn site that does this.
    { stdio: ['pipe', 'pipe', 'pipe'] },
  )

  let banner = ''
  let stderr = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk
  })

  return new Promise<Seed>((resolve, reject) => {
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
      // The `enrol at` line is printed last of the identity lines, so its presence is what
      // says the banner is complete rather than mid-write.
      const complete = /^\s*enrol at\s+/m.test(banner)
      if (peerId === undefined || !complete) return
      clearTimeout(timer)
      resolve({ child, httpPort, wsPort, peerId, banner })
    })
  })
}

async function stopSeed(): Promise<void> {
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

/**
 * The peers the seed process is currently advertising, read over a real socket.
 *
 * `/bootstrap.json` is built per request from `FabricNode.reservedPeerIds` **inside the seed
 * process**, so a peer id in `peerAddrs` is that process stating it granted a circuit. This
 * is the reading a harness holding the node object could fake by reading a field.
 */
async function advertised(): Promise<readonly string[]> {
  if (seed === undefined) throw new Error('no seed')
  const response = await fetch(`http://127.0.0.1:${seed.httpPort}/bootstrap.json`, {
    cache: 'no-store',
  })
  if (!response.ok) throw new Error(`the seed answered /bootstrap.json with ${response.status}`)
  const info = (await response.json()) as { peerAddrs?: unknown }
  if (!Array.isArray(info.peerAddrs)) throw new Error('/bootstrap.json carried no peerAddrs array')
  return info.peerAddrs
    .filter((a): a is string => typeof a === 'string')
    .map((address) => address.split('/p2p/').at(-1) ?? '')
}

/** Wait until `predicate` holds, naming what actually arrived. */
async function until(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs: number,
  what: string,
  observed?: () => Promise<unknown>,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise((r) => setTimeout(r, 250))
  }
  const tail = observed === undefined ? '' : `; observed ${JSON.stringify(await observed())}`
  throw new Error(`timed out waiting for ${what}${tail}`)
}

/** Hold `predicate` false for the whole window, or fail naming when it first became true. */
async function stays(
  predicate: () => boolean | Promise<boolean>,
  windowMs: number,
  what: string,
  observed?: () => Promise<unknown>,
): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < windowMs) {
    if (await predicate()) {
      const tail = observed === undefined ? '' : `; observed ${JSON.stringify(await observed())}`
      throw new Error(`${what} stopped holding after ${Date.now() - started}ms${tail}`)
    }
    await new Promise((r) => setTimeout(r, 250))
  }
}

beforeAll(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'o2-visitor-enrol-'))
  await startProvider()
  seed = await startSeed(join(workdir, 'seed'))
  pageUrl = `http://127.0.0.1:${seed.httpPort}${PAGE_PATH}`

  // The control that makes every positive reading below non-vacuous: same relay, alive
  // throughout, holding no certificate. It pins the same issuer itself, so this fixture
  // holds no relay-capable peer that admits everybody.
  strangerNode = await FabricNode.start({
    relayAdmission: new Set<PublicKeyHex>([providerIssuer]),
    startReporting: 'reports-its-own-start',
    blockstoreDir: join(workdir, 'stranger'),
    listen: ['/ip4/127.0.0.1/tcp/0/ws'],
    relayAddrs: [`/ip4/127.0.0.1/tcp/${seed.wsPort}/ws/p2p/${seed.peerId}`],
    trustAnchors: TRUST_ANCHORS,
  })
}, 300_000)

afterAll(async () => {
  await strangerNode?.stop().catch(() => {})
  await stopSeed()
  await provider?.stop().catch(() => {})
  await rm(workdir, { recursive: true, force: true })
}, 180_000)

describe('a --admit-issuer seed states its door and its way through it', () => {
  it("banners the pinned issuer and the provider a joiner can reach", () => {
    const banner = seed?.banner ?? ''
    expect(banner, 'the seed must say it admits only certificated peers').toContain(
      'only peers certified by',
    )
    expect(banner, 'the seed must name the issuer it pins').toContain(providerIssuer)
    expect(banner, 'the seed must publish where a joiner can enrol').toContain(
      `enrol at   ${providerAddr}`,
    )
  })

  it('publishes that provider to arriving pages, and refuses a peer holding no certificate', async () => {
    // Hop 2 of four, read off the wire the tab reads it from.
    const response = await fetch(`http://127.0.0.1:${seed?.httpPort ?? 0}/bootstrap.json`, {
      cache: 'no-store',
    })
    const info = (await response.json()) as { enrollmentProvider?: unknown }
    expect(info.enrollmentProvider).toBe(providerAddr)

    const stranger = strangerNode?.peerId ?? ''
    await stays(
      async () => (await advertised()).includes(stranger),
      REFUSAL_WINDOW_MS,
      'the uncertificated stranger stays out of the seed’s advertisement',
      advertised,
    )
  }, 60_000)
})

describe.each(ENGINES)('a visitor enrols this tab by clicking, in $name', ({ name, type }) => {
  it(
    'is offered the provider, accepts it, holds a certificate, and is admitted',
    async () => {
      let browser: Browser | undefined
      let page: Page | undefined
      try {
        browser = await type.launch()
        page = await browser.newPage()
        page.on('pageerror', (error) => {
          process.stderr.write(`[${name}] page error: ${error.message}\n`)
        })
        page.on('console', (message) => {
          if (message.type() === 'error') {
            process.stderr.write(`[${name}] console: ${message.text()}\n`)
          }
        })
        await page.goto(pageUrl)
        await page.waitForFunction(() => typeof window.o2 !== 'undefined', null, {
          timeout: 60_000,
        })

        // ---- The visitor's first click. The real consent control, not `grantConsent()`.
        await page.locator('#allow').click()

        // ---- B2: the page references `enrollmentProvider`. Before 2026-08-17 this element
        // did not exist and `grep -c enrol` over `index.html` returned 1, on an unrelated
        // comment. This is the fourth hop.
        const offerBlock = page.locator('#enrol-offer')
        await offerBlock.waitFor({ state: 'visible', timeout: 60_000 })
        await expect
          .poll(async () => page?.locator('#enrol-provider').textContent(), { timeout: 30_000 })
          .toContain(providerAddr)

        // The offer is a question, and the page must say what accepting it would do. Read
        // as a substring of the visitor-facing sentence rather than asserted verbatim, so
        // that rewording the copy does not redden a test about wiring.
        const status = await page.locator('#enrol-status').textContent()
        expect(status ?? '', 'the offer must say a key is made in this browser').toContain(
          'this page cannot read',
        )

        // Nothing has been decided yet, and the page must not have decided for the visitor.
        const before = await page.evaluate(async () => window.o2.enrolmentOffer())
        expect(before.offered, 'the origin names a provider').toBe(true)
        expect(before.accepted, 'nothing may be accepted before the visitor accepts it').toBe(false)
        expect(before.heldIssuer, 'a tab that never enrolled holds no certificate').toBeUndefined()

        // ---- The visitor's second click. THIS is the whole of what B1 was missing: an
        // explicit action, on a control that exists, taking no argument from anybody.
        await page.locator('#enrol').click()
        await expect
          .poll(async () => page?.evaluate(async () => (await window.o2.enrolmentOffer()).accepted), {
            timeout: 60_000,
          })
          .toBe(true)

        // ---- The visitor's third click: start the node. `autoStart` still passes no
        // `enrollment` — go and read it. What reaches `BrowserNode` is the decision above,
        // read back out of this origin's own storage by `api.start`.
        await page.locator('#join').click()

        // The certificate, read from the tab's own store through `enrolledIssuer`. This is
        // the arm that says the enrolment ROUND TRIP completed: a decision alone would be
        // `accepted: true` with no issuer.
        await expect
          .poll(
            async () => page?.evaluate(async () => (await window.o2.enrolmentOffer()).heldIssuer),
            { timeout: ADMIT_BUDGET_MS },
          )
          .toBe(providerIssuer)

        // ---- B3: the gated seed admits it. Read out of the seed PROCESS over HTTP.
        const { peerId } = await page.evaluate(() => window.o2.addresses())
        expect(peerId, 'the tab must have started a node').not.toBe('')
        await until(
          async () => (await advertised()).includes(peerId),
          ADMIT_BUDGET_MS,
          `the --admit-issuer seed to advertise the enrolled tab ${peerId}`,
          advertised,
        )

        // And the control still holds, in the same run, against the same seed: what
        // separates this tab from the stranger is the certificate and nothing else.
        expect(
          await advertised(),
          'the uncertificated stranger must still be out while the enrolled tab is in',
        ).not.toContain(strangerNode?.peerId ?? '')
      } finally {
        await page?.close().catch(() => {})
        await browser?.close().catch(() => {})
      }
    },
    CASE_TIMEOUT_MS,
  )
})
