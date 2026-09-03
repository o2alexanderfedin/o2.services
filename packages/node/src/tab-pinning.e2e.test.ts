/**
 * A live tab pins an issuer and will not take a block from its own relay — AUTH-02,
 * the browser tier's *gate* half.
 *
 * ## What was missing, stated exactly
 *
 * `browser-node.ts` composes its block source as
 * `new RpcBlockSource(rpc, () => verifier.verifiedPeers)`, and until this file existed
 * that line was witnessed by a **source-text count** and by
 * `peer-verifier.browser.test.ts`, which measures `PeerVerifier` against a fake libp2p.
 * Neither reads what the composed node *does*. A `verifiedPeers` getter that was correct
 * while `FetchingBlockstore` was handed `() => transport.peers` — which is precisely the
 * arrangement that stood in this file until 2026-08-14 — satisfies every assertion those
 * two can make. So the claim "a tab excludes an unverified peer from its block source"
 * had no measurement anywhere in the repository.
 *
 * This file takes it off the wire. A block is placed in the store of a peer the tab will
 * **not** verify, another in the store of a peer it **will**, and the tab is asked for
 * both through `BrowserNode.blockstore` — the `FetchingBlockstore` composed over the
 * verified list. What comes back is a reading of the composition line itself.
 *
 * ## Why the relay is the peer that is refused, and not an extra node invented for it
 *
 * Because that is the case the production wiring actually meets. `demo/main.ts` pins
 * `enrolledIssuer(...)`, and a tab's first and often only peer is the relay it reserves
 * on — which in the deployed topology (`gated-seed.e2e.test.ts`: a `SeedServer` that
 * names a separate provider) holds **no certificate of its own**. So "what does pinning
 * do to the relay" is not a corner of this feature, it is the feature's first
 * encounter with reality, and a fixture that quietly gave the relay a certificate would
 * measure a deployment nobody runs.
 *
 * The answer this file records is: **the relay is excluded from the block source, and
 * that costs the tab nothing it was using.** A relay is a signalling channel — the
 * project's own constraint — and the tab still fetches from the certificated peer over
 * the WebRTC/WS path the relay exists to establish. The exclusion is visible here as
 * `fetchBlock` returning `null` for a block only the relay holds, and the *absence* of
 * damage is what case 3's control establishes: the identical fetch succeeds from a tab
 * that pins nobody, so the `null` is the pin and not a broken fixture.
 *
 * ## Why `e2e`
 *
 * A real tab, a real relay reservation and three real Node peers. The `browser` project
 * can start none of them. `browser-enrollment.e2e.test.ts` is the harness this copies —
 * same page, same `startTab` shape — and the difference is the direction of the
 * instrument: that file reads a **Node gate's** verdict about a tab, this one reads a
 * **tab's** verdict about its peers, which is the leg that had no coverage.
 */

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
import type { PublicKeyHex } from '@o2/core'
import { fixtureViteCacheDir, launchFixtureBrowser } from './e2e-browser-launch.ts'
import { FabricNode } from './fabric-node.ts'

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const PAGE = 'packages/browser/harness/capability.html'

/**
 * The build authority every node here pins — DET-03/DATA-08.
 *
 * No module is dispatched in this file, but a node pins some anchor set however it is
 * started and four disagreeing nodes would be a fixture a later reader has to explain.
 *
 * Seed 62. Re-grepped across every `fill(n)` site in `packages/` and `tools/` on
 * 2026-08-14: 57–61 are taken by the two browser-tier e2e files this one sits beside,
 * 62 and 63 are free.
 */
const publisher = (() => {
  const priv = new Uint8Array(32).fill(62)
  return { priv, pub: toHex(ed25519.getPublicKey(priv)) }
})()

/** The visitor's own key — the **private** half, which is what signs the owner proof. */
const USER_PRIVATE_KEY = new Uint8Array(32).fill(63)

const OPERATOR_ID = 'wharf-road-volunteers'

/** How long a verified set is given to settle. Each verdict is an RPC round trip. */
const SETTLE_MS = 20_000

/**
 * The two payloads, distinguishable by length alone.
 *
 * Different sizes on purpose: `fetchBlock` reports a byte count, so a fetch that somehow
 * returned the *other* peer's block would show up as the wrong number rather than passing
 * as a generic success.
 */
const RELAY_BYTES = new Uint8Array(48).fill(7)
const MEMBER_BYTES = new Uint8Array(96).fill(9)

let provider: FabricNode
let relay: FabricNode
let member: FabricNode
let providerAddr: string
let relayAddr: string
let memberAddr: string
let providerIssuer: PublicKeyHex
let relayCid: string
let memberCid: string
let server: ViteDevServer
let browser: Browser
let context: BrowserContext
let page: Page
let workdir: string

/**
 * Start the tab and hand back its peer id.
 *
 * `relayAddrs` is the relay, always — so every case in this file meets the relay the way
 * a tab really does, inside `start`, before it is serving anything. The peers that vary
 * are dialled afterwards by {@link meetMember}, and the only field that changes between
 * the readings is `trustedIssuers`.
 */
async function startTab(options: {
  blockstoreName: string
  enrol: boolean
  /**
   * The issuers to pin — either named by this file, or computed on the page the way
   * production computes them.
   *
   * `'from-this-origins-enrolment'` is not a convenience. It makes the tab decide its own
   * anchor set by calling `enrolledIssuer(blockstoreName)` *in the engine*, which is the
   * whole of what `demo/main.ts` does on the line above its `BrowserNode.start` — so a
   * case using it is reading the production decision rather than a value this file chose
   * and then asserted against itself.
   */
  pin: readonly string[] | 'from-this-origins-enrolment'
}): Promise<string> {
  return page.evaluate(
    async ([blockstoreName, anchor, relayAt, providerAt, operatorId, userKey, enrol, pin]) =>
      window.o2capability.start({
        relayAddrs: [relayAt as string],
        blockstoreName: blockstoreName as string,
        trustAnchors: [anchor as string],
        trustedIssuers:
          pin === 'from-this-origins-enrolment'
            ? // Exactly `demo/main.ts`'s two lines: read the issuer this origin enrolled
              // with, and pass nothing at all when there is none.
              await window.o2capability
                .enrolledIssuer(blockstoreName as string)
                .then((issuer) => (issuer === null ? [] : [issuer]))
            : (pin as string[]),
        sovereignty: { ownerId: '', canExecuteSovereign: false },
        whenSeedIsGone: 'mints-a-new-identity',
        ...(enrol === true
          ? {
              enrollment: {
                userPrivateKey: userKey as number[],
                operatorId: operatorId as string,
                providerAddr: providerAt as string,
              },
            }
          : {}),
      }),
    [
      options.blockstoreName,
      publisher.pub,
      relayAddr,
      providerAddr,
      OPERATOR_ID,
      [...USER_PRIVATE_KEY],
      options.enrol,
      options.pin === 'from-this-origins-enrolment' ? options.pin : [...options.pin],
    ] as const,
  )
}

/** The tab meets the certificated peer, after start, as an ordinary peer is met. */
async function meetMember(): Promise<void> {
  await page.evaluate(async (address) => {
    await window.o2capability.dial(address)
  }, memberAddr)
}

async function stopTab(): Promise<void> {
  await page.evaluate(async () => window.o2capability.stop())
}

/** Ask the tab's fetching tier for a block, by CID string. */
async function fetchBlock(cid: string): Promise<number | null> {
  return page.evaluate(async (c) => window.o2capability.fetchBlock(c), cid)
}

beforeAll(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'o2-tab-pinning-'))

  // The provider. `issuesCertificates` is what mints its signing key, persisted under
  // `blockstoreDir`, so `providerIssuer` is a real value this fixture read rather than
  // one it invented.
  provider = await FabricNode.start({
    relayAdmission: 'admits-any-peer',
    startReporting: 'reports-its-own-start',
    blockstoreDir: join(workdir, 'provider'),
    listen: ['/ip4/127.0.0.1/tcp/0/ws'],
    trustAnchors: [publisher.pub],
    issuesCertificates: 'issues-without-an-aggregate-budget',
  })
  const issuer = provider.issuerKey
  if (issuer === null) throw new Error('the provider was started to issue and minted no key')
  providerIssuer = issuer

  // **The relay, holding no certificate — the deployed shape, not a contrived one.**
  // `gated-seed.e2e.test.ts` runs a `SeedServer` in exactly this position: it names a
  // separate provider for joiners to enrol at and never enrols itself. It admits any
  // peer, so nothing below can be explained by the tab having been refused a reservation.
  relay = await FabricNode.start({
    relayAdmission: 'admits-any-peer',
    startReporting: 'reports-its-own-start',
    blockstoreDir: join(workdir, 'relay'),
    listen: ['/ip4/127.0.0.1/tcp/0/ws'],
    trustAnchors: [publisher.pub],
  })

  // The certificated peer: identical to the relay but for `enrollment`. Same class, same
  // transports, same listen address — so an exclusion below cannot be an artefact of a
  // node kind.
  const providerDialable = provider.browserDialableAddrs[0]
  if (providerDialable === undefined) throw new Error('the provider produced no dialable address')
  providerAddr = providerDialable

  member = await FabricNode.start({
    relayAdmission: 'admits-any-peer',
    startReporting: 'reports-its-own-start',
    blockstoreDir: join(workdir, 'member'),
    listen: ['/ip4/127.0.0.1/tcp/0/ws'],
    trustAnchors: [publisher.pub],
    enrollment: {
      userPrivateKey: USER_PRIVATE_KEY,
      operatorId: OPERATOR_ID,
      providerAddr,
    },
  })

  const relayDialable = relay.browserDialableAddrs[0]
  const memberDialable = member.browserDialableAddrs[0]
  if (relayDialable === undefined || memberDialable === undefined) {
    throw new Error('a node produced no browser-dialable address')
  }
  relayAddr = relayDialable
  memberAddr = memberDialable

  // One block into each peer's **local** store, which is the tier `serveAgent` answers a
  // `block` request from.
  relayCid = (await relay.blockstore.put(RELAY_BYTES)).toString()
  memberCid = (await member.blockstore.put(MEMBER_BYTES)).toString()

  server = await createServer({ root: ROOT, logLevel: 'error', server: { port: 0 }, cacheDir: fixtureViteCacheDir(ROOT) })
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
}, 300_000)

afterAll(async () => {
  await page?.evaluate(async () => window.o2capability.stop()).catch(() => {})
  await context?.close().catch(() => {})
  await browser?.close().catch(() => {})
  await server?.close().catch(() => {})
  await member?.stop().catch(() => {})
  await relay?.stop().catch(() => {})
  await provider?.stop().catch(() => {})
  await rm(workdir, { recursive: true, force: true })
}, 180_000)

describe('AUTH-02 — a tab pins an issuer, and its block source is what changes', () => {
  /**
   * The fixture is what it claims to be, before any reading rests on it.
   *
   * Placed first for the reason `gated-seed.e2e.test.ts` records: a misconfigured fixture
   * otherwise surfaces as a browser timing out twenty seconds later, and this repository
   * has spent real time on that shape of misdiagnosis.
   */
  it('is a relay that holds no certificate and a peer that holds one from the pinned issuer', async () => {
    expect(relay.peerId).not.toBe(provider.peerId)
    expect(relay.peerId).not.toBe(member.peerId)
    // The relay never enrolled, so it has nothing to answer a `records` request with.
    // This is the property the whole file turns on.
    expect(relay.certificate).toBeNull()
    // The member did, and against the issuer the tab will pin.
    expect(member.certificate).not.toBeNull()
    expect(member.certificate?.issuer).toBe(providerIssuer)
    // Both blocks are really resident, so a `null` below is about the gate and never
    // about a peer that was asked for something it does not have. `has` reads the local
    // tier only and never the network, which is what makes it the right question here.
    expect(await relay.blockstore.has(CID.parse(relayCid))).toBe(true)
    expect(await member.blockstore.has(CID.parse(memberCid))).toBe(true)
  }, 60_000)

  /**
   * **The control, and it runs first so the exclusion below is a change in one instrument
   * rather than the only value it has ever shown.**
   *
   * A tab pinning nobody — every tab in this repository before 2026-08-14, and every
   * first-time visitor after it — takes blocks from both peers, including the relay.
   * Without this reading, case 3's two `null`s would be satisfied just as well by a relay
   * that does not serve blocks, a CID that names nothing, or a `fetchBlock` that is
   * broken.
   */
  it('a tab that pins nobody fetches from the relay and from the certificated peer alike', async () => {
    await startTab({ blockstoreName: 'o2-pin-none', enrol: false, pin: [] })
    await meetMember()

    // Both peers connected. "Not in the verified set" would otherwise also be true of a
    // peer that never arrived.
    await expect
      .poll(async () => page.evaluate(() => window.o2capability.peers().length), {
        timeout: SETTLE_MS,
      })
      .toBeGreaterThanOrEqual(2)

    // Pinning nobody means verifying nobody, which `PeerVerifier` reads as taking
    // everybody — the early return in `verifiedPeers`. Stated as a reading rather than
    // left implied, because it is the premise of the two fetches below.
    const verified = await page.evaluate(() => window.o2capability.verifiedPeers())
    expect(verified).toContain(relay.peerId)
    expect(verified).toContain(member.peerId)

    expect(await fetchBlock(relayCid)).toBe(RELAY_BYTES.length)
    expect(await fetchBlock(memberCid)).toBe(MEMBER_BYTES.length)

    await stopTab()
  }, 180_000)

  /**
   * **The measurement.** Same page, same relay, same peers, same blocks — one field
   * different.
   */
  it('a tab that pins the provider drops the relay from its block source and keeps the certificated peer', async () => {
    await startTab({
      blockstoreName: 'o2-pin-provider',
      enrol: true,
      pin: [providerIssuer],
    })
    await meetMember()

    await expect
      .poll(async () => page.evaluate(() => window.o2capability.peers().length), {
        timeout: SETTLE_MS,
      })
      .toBeGreaterThanOrEqual(2)

    // The verdicts are RPC round trips, so the member's arrival in the verified set is
    // polled for. A `verifiedPeers` read before it settles is "not asked yet", which is
    // not the claim being made.
    await expect
      .poll(async () => page.evaluate(() => window.o2capability.verifiedPeers()), {
        timeout: SETTLE_MS,
      })
      .toContain(member.peerId)

    // The relay is connected throughout — the tab holds its reservation — and excluded.
    const verified = await page.evaluate(() => window.o2capability.verifiedPeers())
    expect(verified).not.toContain(relay.peerId)
    const connected = await page.evaluate(() => window.o2capability.peers())
    expect(connected).toContain(relay.peerId)

    // **Off the wire.** The getter above says what the verifier thinks; these two say what
    // the composed node does with it. A block held only by the excluded peer does not
    // arrive, and a block held only by the verified one does — through the same
    // `FetchingBlockstore`, in the same tab, in the same second.
    expect(await fetchBlock(relayCid)).toBeNull()
    expect(await fetchBlock(memberCid)).toBe(MEMBER_BYTES.length)

    await stopTab()
  }, 180_000)

  /**
   * The production helper, in a real engine, against the database a real enrolment wrote.
   *
   * This is what closes the loop between this file and `demo/main.ts`. The two cases above
   * establish what a pinned tab *does*; they say nothing about where a page on a visitor's
   * path would get the key it pins. `enrolledIssuer` is that function, and it is called
   * here rather than reimplemented, so a change to the derivation of the identity
   * database's name — or to which field is read off the certificate — reddens this.
   *
   * The `'o2-pin-provider'` store is the one case 3 enrolled under, and the `null` is read
   * from a name nothing has ever started, so the two arms are the presence and the absence
   * of an enrolment rather than two spellings of the same one.
   */
  it('enrolledIssuer names the provider a tab enrolled with, and null for an origin that has not', async () => {
    const afterEnrolment = await page.evaluate(
      async (name) => window.o2capability.enrolledIssuer(name),
      'o2-pin-provider',
    )
    expect(afterEnrolment).toBe(providerIssuer)

    const neverEnrolled = await page.evaluate(
      async (name) => window.o2capability.enrolledIssuer(name),
      'o2-pin-never-started',
    )
    expect(neverEnrolled).toBeNull()
  }, 60_000)

  /**
   * **The production decision, applied end to end — and the visit on which it first bites.**
   *
   * Cases 2 and 3 pin a key this file handed the tab, which measures what pinning *does*
   * and takes the choice of key as given. This one takes nothing as given: the tab calls
   * `enrolledIssuer` itself, in the engine, against the IndexedDB its own earlier
   * enrolment wrote, and pins whatever comes back — which is `demo/main.ts` line for line.
   *
   * **It is the third start under this store, and that number is the finding rather than a
   * fixture detail.** `enrolledIssuer` can only answer with a certificate that is already
   * persisted, and the anchor set is fixed inside `#compose` *before* the enrolment round
   * trip. So a real visitor's sequence is: visit once and pin nobody, enrol and still pin
   * nobody on that same start, and pin from the visit after. `gated-seed.e2e.test.ts`
   * drives the first two of those three and therefore never reaches a pinned tab at all —
   * which is exactly why this case exists here rather than being left to that file.
   *
   * ## `enrol: true` on a start that contacts nobody, and why it is not a contradiction
   *
   * Measured rather than assumed, after this case was first written with `enrol: false`
   * and went red on `certificate()` returning `null`. `resolveCertificate` opens with
   * `if (enrollment === undefined) return null` **before** it consults the store, so a tab
   * started without the option holds no certificate even when a perfectly good one is
   * sitting in its IndexedDB. Passing the option takes the branch below it, which finds
   * the stored certificate, checks its identity and expiry, and returns it **without
   * dialling the provider** — the returning-visitor path.
   *
   * That asymmetry is also the reason `demo/main.ts` reads `enrolledIssuer` and not
   * `node.certificate`: the anchor has to be known before `start`, and `node.certificate`
   * is not merely unavailable that early, it would be `null` on exactly the starts that
   * matter.
   */
  it('a returning tab pins what its own earlier enrolment stored, and the relay stays out of its block source', async () => {
    const peerId = await startTab({
      blockstoreName: 'o2-pin-provider',
      enrol: true,
      pin: 'from-this-origins-enrolment',
    })
    await meetMember()

    // The same node as case 3, not a fresh one — otherwise "it reused the stored
    // certificate" would be a claim about a tab that had never enrolled.
    const held = await page.evaluate(() => window.o2capability.certificate())
    expect(held?.issuer).toBe(providerIssuer)
    expect(held?.nodeKey).toBeDefined()
    expect(peerId).toBeDefined()

    await expect
      .poll(async () => page.evaluate(() => window.o2capability.verifiedPeers()), {
        timeout: SETTLE_MS,
      })
      .toContain(member.peerId)

    const connected = await page.evaluate(() => window.o2capability.peers())
    expect(connected).toContain(relay.peerId)
    const verified = await page.evaluate(() => window.o2capability.verifiedPeers())
    expect(verified).not.toContain(relay.peerId)

    // The same two fetches as case 3, reached without this file naming a key.
    expect(await fetchBlock(relayCid)).toBeNull()
    expect(await fetchBlock(memberCid)).toBe(MEMBER_BYTES.length)

    await stopTab()
  }, 180_000)
})
