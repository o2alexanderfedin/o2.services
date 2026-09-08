import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ed25519 } from '@noble/curves/ed25519.js'
import { CID } from 'multiformats/cid'
import { chromium } from 'playwright'
import type { Browser, BrowserContext, Page } from 'playwright'
import { createServer } from 'vite'
import type { ViteDevServer } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { toHex } from '@o2/core'
import { fixtureViteCacheDir, launchFixtureBrowser } from './e2e-browser-launch.ts'
import { FabricNode } from './fabric-node.ts'

/**
 * NET-05, the browser tier — **a list of relays is a list of spares, not a chain of
 * dependencies.**
 *
 * ## The defect this file was written against, measured before it was changed
 *
 * `browser-node.ts` dialled `options.relayAddrs` in a serial `for` loop with no `catch`,
 * so a single unreachable address rejected `BrowserNode.start`. A tab given N relays for
 * redundancy therefore held N points of failure **in series**: three relays made a tab
 * three times likelier to fail to start than one did, which is the exact opposite of what
 * a redundancy list is for, and it is what stood between this project and ever handing a
 * visitor more than one relay.
 *
 * The measurement is this file's first case, run on 2026-09-06 against the serial loop
 * restored verbatim into the fixed tree. Same fixture, same order — a dead address first,
 * a live one second — and every case here failed, the first with:
 *
 *     AssertionError: expected '[object Event]' to be null
 *
 * `[object Event]` is the whole of what the tab could say, because the raw dial rejection
 * was what propagated; the useful sentence went to Chromium's console instead, where no
 * caller can reach it —
 * `WebSocket connection to 'ws://127.0.0.1:49999/' failed: Error in connection
 * establishment: net::ERR_CONNECTION_REFUSED`. So the defect was two things at once: a
 * tab that would not start beside a relay that was answering, and a tab that could not
 * say which of its relays was the problem. It is not a claim about a loop's shape; the
 * live relay was up and serving throughout.
 *
 * ## Why `e2e` and not `browser`
 *
 * Case 1's whole content is that a **real** relay answered while a dead one did not, so
 * one of the two addresses has to be genuinely dialable. The `browser` project cannot
 * produce one: it has no `globalSetup`, no vitest browser `commands` infra anywhere in
 * this repository, and a page cannot host a listening socket — a Circuit Relay v2 server
 * *"will not work in browsers"* in `@libp2p/circuit-relay-v2`'s own words. So the
 * all-failed half of the rule lives in `start-unwind.browser.test.ts`, where it runs in
 * all three engines because it needs nothing to be up, and the at-least-one half lives
 * here, where a Node process can be. Neither lane can hold both, and saying which is
 * which is the point: **case 1 is a Chromium-only reading**, and making it a
 * three-engine one is new harness work rather than a stronger assertion.
 *
 * ## The topology, and why the "relay" is an ordinary WebSocket peer
 *
 * `relayAddrs` is a list of addresses `start` dials before the node is serving anything.
 * What is on the other end decides whether a *reservation* follows; what this file
 * measures is the dial and what the tab does with the outcome. So the live address is a
 * `FabricNode` on `/ip4/127.0.0.1/tcp/0/ws` — the same substitution
 * `browser-capability.e2e.test.ts` and `browser-enrollment.e2e.test.ts` already make,
 * and for the same reason: a real dial to a real libp2p peer, with no circuit in the
 * data path. The dead address is a closed loopback port carrying a well-formed peer id,
 * which is what makes case 3 discriminating — see there.
 *
 * ## The three readings
 *
 * | # | Reading | Instrument |
 * |---|---|---|
 * | 1 | the tab starts, and is **reachable** | `start` resolves; the provider fetches a block only the tab holds |
 * | 2 | the failure is **reported**, not swallowed | `BrowserNode.relayFailures` names the dead address |
 * | 3 | the peer-id list holds **only** relays that answered | the certificate's `relayIds` |
 *
 * Reading 1 is deliberately not "`start` resolved". A `start` that resolved onto a tab
 * nobody can reach is precisely the outcome the absent `catch` existed to prevent, and
 * this change must not buy the first case by giving that up — so the provider goes and
 * gets a block that exists nowhere else, over the connection the tab opened when it
 * dialled the surviving relay address.
 *
 * Reading 3 is why this tab enrols. `relayPeerIds` is collected inside `#compose` and
 * leaves it in exactly one direction: `resolveCertificate`'s `relayIds`, which is a tab's
 * signed statement of what it is reachable through. A list that named the dead relay
 * would be a lie a peer acts on — it would dial a circuit through a relay holding no
 * reservation for this tab — and the dead address carries a peer id in its own multiaddr,
 * so an implementation that pushed the *configured* id rather than the *connected* one
 * would produce exactly that lie and pass any assertion weaker than an equality.
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const PAGE = 'packages/browser/harness/capability.html'

/**
 * Reachable by nobody: a closed loopback port, named with a well-formed peer id.
 *
 * Byte-identical to `start-unwind.browser.test.ts`'s `UNREACHABLE_RELAY`, deliberately —
 * the two lanes hold the two halves of one rule, and a reader comparing them should not
 * have to decide whether two different dead addresses fail differently.
 *
 * `/ws` rather than `/tcp` alone because a browser can only dial WebSockets. The peer id
 * is load-bearing rather than decorative: it is a value the tab *knows* without ever
 * reaching the relay, so case 3's equality can only pass if the list was built from
 * connections rather than from configuration.
 */
const DEAD_RELAY =
  '/ip4/127.0.0.1/tcp/49999/ws/p2p/12D3KooWHPSVMPEezVCXvka2ahwT26JGL8EBr61LpGEU3ujHQM9Q'

/** The peer id inside {@link DEAD_RELAY}, which the tab can name and never reached. */
const DEAD_RELAY_PEER_ID = '12D3KooWHPSVMPEezVCXvka2ahwT26JGL8EBr61LpGEU3ujHQM9Q'

/**
 * The build authority both nodes pin — DET-03/DATA-08.
 *
 * No module is dispatched here, but a tab pins some anchor set however it is started and
 * the Node peer must agree with it, or a later reader would find two nodes disagreeing
 * about provenance for no stated reason.
 *
 * Seed 62. Re-grepped across every `fill(n)` and `keypair(n)` site in `packages/` and
 * `tools/` on 2026-09-06: 57 is `browser-capability`'s, 58 and 59 are
 * `browser-enrollment`'s, 60 and 61 are taken, 62 is free.
 */
const publisher = (() => {
  const priv = new Uint8Array(32).fill(62)
  return { priv, pub: toHex(ed25519.getPublicKey(priv)) }
})()

/**
 * The user the tab enrols on behalf of — the **private** key, and the type is the point.
 *
 * `EnrollmentAuthority.enrol` refuses by name as `bad-owner-proof` without a signature
 * over the possession challenge, and only the private half can produce one. Seed 63, free
 * by the same re-grep.
 */
const USER_PRIVATE_KEY = new Uint8Array(32).fill(63)

const OPERATOR_ID = 'north-wharf-volunteers'

/** How long the provider is given to reach a block that lives only in the tab. */
const SETTLE_MS = 20_000

let provider: FabricNode
let providerAddr: string
let server: ViteDevServer
let browser: Browser
let context: BrowserContext
let page: Page
let workdir: string
let tabPeerId: string
let startFailure: string | null = null

beforeAll(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'o2-any-one-relay-'))

  // The live relay address. `issuesCertificates` is what gives this node a signing key,
  // which is what makes reading 3's certificate exist at all.
  provider = await FabricNode.start({
    relayAdmission: 'admits-any-peer',
    startReporting: 'reports-its-own-start',
    blockstoreDir: join(workdir, 'provider'),
    listen: ['/ip4/127.0.0.1/tcp/0/ws'],
    trustAnchors: [publisher.pub],
    issuesCertificates: 'issues-without-an-aggregate-budget',
  })
  const provided = provider.browserDialableAddrs[0]
  if (provided === undefined) throw new Error('provider produced no browser-dialable address')
  providerAddr = provided

  server = await createServer({
    root: ROOT,
    logLevel: 'error',
    server: { port: 0 },
    cacheDir: fixtureViteCacheDir(ROOT),
  })
  await server.listen()
  const url = server.resolvedUrls?.local[0]
  if (url === undefined) throw new Error('vite dev server produced no URL')
  const baseUrl = url.endsWith('/') ? url : `${url}/`

  browser = await launchFixtureBrowser(chromium)
  context = await browser.newContext()
  page = await context.newPage()
  page.on('pageerror', (error) => {
    process.stderr.write(`[harness] page error: ${error.message}\n`)
  })
  page.on('console', (message) => {
    if (message.type() === 'error') process.stderr.write(`[harness] console: ${message.text()}\n`)
  })

  await page.goto(`${baseUrl}${PAGE}`)
  await page.waitForFunction(() => typeof window.o2capability !== 'undefined', null, {
    timeout: 30_000,
  })

  // **The dead address goes FIRST**, and that ordering is the measurement. Under the
  // serial loop this file was written against, the tab never reached the second entry at
  // all — so a fixture that put the live relay first would have passed on the defect.
  //
  // The rejection is captured rather than thrown, so a failure to start is reported by
  // the case that is about starting rather than as a `beforeAll` crash with no reading
  // attached to it. That is also how the pre-fix measurement was taken.
  const outcome = await page.evaluate(
    async ([dead, live, anchor, operatorId, userKey]) =>
      window.o2capability
        .start({
          relayAddrs: [dead as string, live as string],
          blockstoreName: 'o2-any-one-relay',
          trustAnchors: [anchor as string],
          sovereignty: { ownerId: '', canExecuteSovereign: false },
          whenSeedIsGone: 'mints-a-new-identity',
          // AUTH-06 — this tab starts once and is thrown away; nothing here reads an
          // identity twice, so `writes-no-new-secret` is the truthful value rather than
          // the convenient one, and it keeps an Argon2id derivation out of the fixture.
          identityProtection: { kind: 'writes-no-new-secret' },
          // Reading 3 needs a certificate, which needs an enrolment. The provider is both
          // the live relay address and the issuer — one process, because a second would
          // add a variable to a file whose subject is which addresses were dialled.
          enrollment: {
            userPrivateKey: userKey as number[],
            operatorId: operatorId as string,
            providerAddr: live as string,
          },
        })
        .then(
          (peerId) => ({ peerId, failure: null }),
          (cause: unknown) => ({
            peerId: '',
            failure: cause instanceof Error ? cause.message : String(cause),
          }),
        ),
    [DEAD_RELAY, providerAddr, publisher.pub, OPERATOR_ID, [...USER_PRIVATE_KEY]] as const,
  )
  tabPeerId = outcome.peerId
  startFailure = outcome.failure
}, 240_000)

afterAll(async () => {
  await page?.evaluate(async () => window.o2capability.stop()).catch(() => {})
  await context?.close().catch(() => {})
  await browser?.close().catch(() => {})
  await server?.close().catch(() => {})
  await provider?.stop().catch(() => {})
  await rm(workdir, { recursive: true, force: true })
}, 120_000)

describe('NET-05 — one reachable relay out of two is enough for a tab to start', () => {
  it('starts on the surviving relay and is reachable over it, though the first address it was given was dead', async () => {
    // The defect, read directly. On the unfixed tree this is the line that failed, with
    // the message quoted in this file's header.
    expect(startFailure).toBeNull()
    expect(tabPeerId).not.toBe('')
    expect(tabPeerId).not.toBe(provider.peerId)

    // Started is not reached. A tab that resolved `start` and holds no connection is the
    // outcome the absent `catch` existed to prevent, and this change must not buy the
    // first assertion by giving that one up.
    expect(await page.evaluate(() => window.o2capability.peers())).toContain(provider.peerId)

    // The reachability reading proper, and it runs in the direction that matters: the
    // *provider* goes and gets a block that exists nowhere but inside the tab. A tab that
    // were merely connected-but-unserving would fail here — `FetchingBlockstore` asks
    // `RpcBlockSource` over the connection, and the answer has to come from the tab's own
    // `serveAgent`. The bytes are unique to this file so nothing else could supply them.
    const seeded = await page.evaluate(async (bytes) => window.o2capability.putBytes(bytes), [
      ...new TextEncoder().encode('any-one-relay-is-enough'),
    ])
    const seededCid = CID.parse(seeded)
    expect(await provider.store.has(seededCid)).toBe(false)
    await expect
      .poll(async () => (await provider.blockstore.get(seededCid))?.length ?? null, {
        timeout: SETTLE_MS,
      })
      .toBe('any-one-relay-is-enough'.length)
  }, 120_000)

  it('reports the relay it could not reach, naming the address and libp2p’s reason', async () => {
    const failures = await page.evaluate(() => window.o2capability.relayFailures())

    // Exactly one, not "at least one". A tier that reported every configured address as a
    // failure, or that reported the live one too, would satisfy a `toContain`.
    expect(failures).toHaveLength(1)
    expect(failures[0]?.address).toBe(DEAD_RELAY)
    // **The reason is libp2p's own words and is never synthesised — and measured here on
    // 2026-09-06, those words are `[object Event]`.** A browser WebSocket dial to a closed
    // port rejects with a raw `Event` rather than an `Error`, so `String(cause)` is all
    // there is; Chromium's own console says the useful thing
    // (`net::ERR_CONNECTION_REFUSED`) and does not hand it to the caller.
    //
    // So this asserts the reason is *present and non-empty* rather than pinning text that
    // belongs to a dependency. What it must not be is the empty string, which is what a
    // `catch` that dropped the cause would leave. **And it is why the address is a field
    // of its own rather than something a page digs out of the reason**: on this tier the
    // reason cannot name the address, so a record that did not carry it separately would
    // tell a visitor that *a* relay failed and never which one.
    expect(failures[0]?.reason.length ?? 0).toBeGreaterThan(0)
    // The address the visitor would be shown. Read off the same record, because a page
    // that could name the failure but not the line that caused it is back to inferring
    // which relay was dead — the ambiguity NET-05 exists to remove.
    expect(`${failures[0]?.address} — ${failures[0]?.reason}`).toContain('49999')
  }, 60_000)

  it('names only the relay it actually reached in the certificate it signs', async () => {
    const certificate = await page.evaluate(() => window.o2capability.certificate())
    if (certificate === null) throw new Error('the tab enrolled and holds no certificate')

    // An equality, not a `toContain`. The dead address carries a peer id the tab knows
    // without ever having reached it, so an implementation that collected configured ids
    // rather than connected ones would produce a two-element list — a signed statement
    // that this tab can be reached through a relay holding no reservation for it, which
    // is a lie a peer would act on by dialling a circuit that cannot exist.
    expect(certificate.relayIds).toEqual([provider.peerId])
    expect(certificate.relayIds).not.toContain(DEAD_RELAY_PEER_ID)
  }, 60_000)
})
