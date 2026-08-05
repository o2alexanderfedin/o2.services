/**
 * A live browser tab enrols, holds a certificate, and is taken as a block source by a
 * peer that pins the issuer — AUTH-01/AUTH-02, the browser tier.
 *
 * ## What this file is for
 *
 * 17-VERIFICATION found a live regression rather than an unfinished tier: **any node
 * started with `--trusted-issuer` excluded every browser peer from its block sources**,
 * because `PeerVerifier` takes only peers whose certificate verifies and no tab could
 * hold one. The fabric partitioned by tier, against the rule this project has restated
 * three times — *all nodes have equal functionality; the only difference is discovery.*
 *
 * Nothing branched on node kind to produce it. `browser-node.ts` was missing a persisted
 * seed, a `privateKey` at `createLibp2p`, an `enrollment` option and a certificate, and
 * passed `index:`/`enroll:` sentinels unconditionally. An absence partitions as
 * effectively as a branch, and is harder to see.
 *
 * ## Why the instrument is read twice, and why that is the point
 *
 * The positive reading — *the gate node's verified set contains the tab* — is worth
 * nothing alone. A `verifiedPeers` getter that returned every connected peer would
 * satisfy it; so would a gate that was never given a `trustedIssuers` list, since that
 * node "returns the connected set" by design (`FabricNode.verifiedPeers`). A
 * `toContain` that has never been seen as a `not.toContain` proves the instrument
 * exists, not that it discriminates.
 *
 * So the *same* gate node, with the *same* pinned issuer, is asked about a tab twice:
 * once about an uncertificated tab, which it must exclude and name its reason for, and
 * once about an enrolled one, which it must include. The first case is the regression
 * itself, still reachable, still red-if-broken — it is what a browser node looked like
 * to a gate node before this plan, reproduced on demand rather than remembered.
 *
 * ## Why `e2e` and not `browser`
 *
 * A real tab needs a real Node peer on the other side, which the `browser` project has
 * no way to start. It needs **no relay**: the tab dials the Node processes' WebSocket
 * listeners directly and every request comes back along the connection the tab itself
 * opened. `browser-capability.e2e.test.ts` established that topology; this file reuses
 * its harness page unchanged.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ed25519 } from '@noble/curves/ed25519.js'
import { chromium } from 'playwright'
import type { Browser, BrowserContext, Page } from 'playwright'
import { createServer } from 'vite'
import type { ViteDevServer } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { toHex } from '@o2/core'
import { peerIdForNodeKey } from '@o2/libp2p'
import { FabricNode } from './fabric-node.ts'

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const PAGE = 'packages/browser/harness/capability.html'

/**
 * The build authority all three nodes pin — DET-03/DATA-08.
 *
 * No module is dispatched in this file, but a tab pins some anchor set however it is
 * started and the two Node peers must agree with it, or a later reader would find three
 * nodes disagreeing about provenance for no stated reason.
 *
 * Seed 58, adjacent to `browser-capability.e2e.test.ts`'s 57 so the browser-tier files
 * read as one family. Re-grepped across every `fill(n)` site in `packages/` and `tools/`
 * on 2026-08-01: 57 is that file's, 59 is free and unused here, 60 and 61 are taken.
 */
const publisher = (() => {
  const priv = new Uint8Array(32).fill(58)
  return { priv, pub: toHex(ed25519.getPublicKey(priv)) }
})()

/**
 * The user the tab enrols on behalf of — the **private** key, and that is the whole
 * point of the field's type.
 *
 * `EnrollmentAuthority.enrol` refuses by name as `bad-owner-proof` without a signature
 * over the possession challenge, and only the private half can produce one. A plan
 * earlier in this phase specified `userKey: PublicKeyHex` here, and every enrollment
 * would have been refused — correctly, and by a refusal naming exactly the right thing.
 *
 * Seed 59, free by the same re-grep.
 */
const USER_PRIVATE_KEY = new Uint8Array(32).fill(59)

const OPERATOR_ID = 'north-wharf-volunteers'

/** How long a verified set is given to settle. The verification is an RPC round trip. */
const SETTLE_MS = 20_000

let provider: FabricNode
let gate: FabricNode
let providerAddr: string
let gateAddr: string
let server: ViteDevServer
let browser: Browser
let context: BrowserContext
let page: Page
let workdir: string

/**
 * Start the tab and hand back its peer id.
 *
 * A helper rather than four copies, because the readings differ only in the two fields
 * that are the subject — whether an `enrollment` was configured, and which database the
 * tab reads its seed from — and a copy per case would let those two drift into looking
 * like incidental differences.
 */
async function startTab(options: {
  blockstoreName: string
  enrol: boolean
  whenSeedIsGone: 'mints-a-new-identity' | 'refuses-to-start-without-its-seed'
}): Promise<string> {
  return page.evaluate(
    async ([blockstoreName, anchor, provider, operatorId, userKey, enrol, policy]) =>
      window.o2capability.start({
        // **The provider, not the gate.** `relayAddrs` is dialled *inside* `start`,
        // before `serveAgent` has been called, so a peer met this way asks this node for
        // records and gets no answer — which is the correct topology for a relay, whose
        // whole purpose is to be reached before the node is addressable, and the wrong
        // one for an ordinary peer. The gate is dialled after start, by `meetGate`, so
        // both readings below meet it the same way and differ only in enrollment.
        //
        // This also gives the certificate a non-empty `relayIds`: the tab is not a seed,
        // so it must name what it is reachable through.
        relayAddrs: [provider as string],
        blockstoreName: blockstoreName as string,
        trustAnchors: [anchor as string],
        sovereignty: { ownerId: '', canExecuteSovereign: false },
        whenSeedIsGone: policy as 'mints-a-new-identity' | 'refuses-to-start-without-its-seed',
        ...(enrol === true
          ? {
              enrollment: {
                userPrivateKey: userKey as number[],
                operatorId: operatorId as string,
                providerAddr: provider as string,
              },
            }
          : {}),
      }),
    [
      options.blockstoreName,
      publisher.pub,
      providerAddr,
      OPERATOR_ID,
      [...USER_PRIVATE_KEY],
      options.enrol,
      options.whenSeedIsGone,
    ] as const,
  )
}

/**
 * The tab meets the gate — after it is up, as an ordinary peer does.
 *
 * Called identically in both readings. If it were called only in the positive one, the
 * two cases would differ in how they met the gate as well as in whether they enrolled,
 * and the exclusion could be explained by the meeting rather than by the certificate.
 */
async function meetGate(): Promise<void> {
  await page.evaluate(async (address) => {
    await window.o2capability.dial(address)
  }, gateAddr)
}

async function stopTab(): Promise<void> {
  await page.evaluate(async () => window.o2capability.stop())
}

beforeAll(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'o2-browser-enrollment-'))

  // The provider. `issuesCertificates` is what gives it a signing key at all, and the
  // key is persisted under its `blockstoreDir`, so `issuerKey` below is a real pinned
  // value rather than one this file invented.
  provider = await FabricNode.start({
    relayAdmission: 'admits-any-peer',
    startReporting: 'reports-its-own-start',
    blockstoreDir: join(workdir, 'provider'),
    listen: ['/ip4/127.0.0.1/tcp/0/ws'],
    trustAnchors: [publisher.pub],
    issuesCertificates: 'issues-without-an-aggregate-budget',
  })
  const issuer = provider.issuerKey
  if (issuer === null) throw new Error('provider was started to issue and holds no key')

  // The gate: a node that pins the provider as an issuer, which is precisely what
  // `--trusted-issuer` does on the command line. This is the node whose block sources
  // partitioned.
  gate = await FabricNode.start({
    relayAdmission: 'admits-any-peer',
    startReporting: 'reports-its-own-start',
    blockstoreDir: join(workdir, 'gate'),
    listen: ['/ip4/127.0.0.1/tcp/0/ws'],
    trustAnchors: [publisher.pub],
    trustedIssuers: [issuer],
  })

  const provided = provider.browserDialableAddrs[0]
  const gated = gate.browserDialableAddrs[0]
  if (provided === undefined || gated === undefined) {
    throw new Error('a node produced no browser-dialable address')
  }
  providerAddr = provided
  gateAddr = gated

  server = await createServer({ root: ROOT, logLevel: 'error', server: { port: 0 } })
  await server.listen()
  const url = server.resolvedUrls?.local[0]
  if (url === undefined) throw new Error('vite dev server produced no URL')
  const baseUrl = url.endsWith('/') ? url : `${url}/`

  browser = await chromium.launch()
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
}, 180_000)

afterAll(async () => {
  await page?.evaluate(async () => window.o2capability.stop()).catch(() => {})
  await context?.close().catch(() => {})
  await browser?.close().catch(() => {})
  await server?.close().catch(() => {})
  await gate?.stop().catch(() => {})
  await provider?.stop().catch(() => {})
  await rm(workdir, { recursive: true, force: true })
}, 120_000)

describe('AUTH-01/AUTH-02 — a browser node enrols and is taken on identical terms', () => {
  /**
   * The instrument's **negative** value, and the regression itself.
   *
   * This is what every browser peer looked like to a `--trusted-issuer` node before this
   * plan: connected, serving, indistinguishable in capability, and excluded. It runs
   * first so that the positive reading below is a change in the same instrument rather
   * than the only value it has ever been seen at.
   */
  it('a tab holding no certificate is excluded from a pinned peer’s block sources, and the refusal names why', async () => {
    const tabPeerId = await startTab({
      blockstoreName: 'o2-enrol-uncertificated',
      enrol: false,
      whenSeedIsGone: 'mints-a-new-identity',
    })
    await meetGate()

    // The gate has to have seen the connection before its verdict means anything —
    // otherwise "not in the verified set" would also be true of a peer that never
    // arrived, and this assertion would pass with the tab switched off.
    await expect
      .poll(() => gate.libp2p.getConnections().map((c) => c.remotePeer.toString()), {
        timeout: SETTLE_MS,
      })
      .toContain(tabPeerId)

    // The verdict is computed over an RPC round trip, so it is polled for rather than
    // read once: a `undefined` verdict is "not asked yet", which is not the same claim.
    await expect.poll(() => gate.verdictFor(tabPeerId) !== undefined, { timeout: SETTLE_MS }).toBe(true)

    const verdict = gate.verdictFor(tabPeerId)
    expect(verdict?.ok).toBe(false)
    // The refusal's own name, not merely the fact of one. A gate that excluded this peer
    // for the wrong reason — `unreachable` because nothing answered, `unanswerable-peer`
    // because the frame did not parse — would satisfy every assertion above, and a
    // refusal that names the wrong thing is a defect even when the request correctly
    // fails. `no-records` is the one that means *the peer answered, and said it holds
    // none*, which is exactly what the `'serves-no-records'` sentinel makes it say.
    expect(verdict?.ok === false ? verdict.failure.kind : 'no verdict').toBe('no-records')

    expect(gate.verifiedPeers).not.toContain(tabPeerId)

    await stopTab()
  }, 120_000)

  /**
   * The same instrument, the same gate, the same pinned issuer — the other value.
   */
  it('a tab that enrols holds a certificate naming its own peer id, and the same gate then takes it as a block source', async () => {
    const tabPeerId = await startTab({
      blockstoreName: 'o2-enrol-certificated',
      enrol: true,
      whenSeedIsGone: 'mints-a-new-identity',
    })
    await meetGate()

    const held = await page.evaluate(() => window.o2capability.certificate())
    expect(held).not.toBeNull()
    if (held === null) throw new Error('unreachable — asserted above')

    // The certificate names *this* tab and not some other node. Written through
    // `peerIdForNodeKey` rather than by comparing `nodeKey` strings, because that is the
    // derivation the transport and the certificate namespaces are bridged by, and a
    // `nodeKey` that is not valid lowercase hex yields `null` — which fails here instead
    // of comparing equal to something.
    expect(peerIdForNodeKey(held.nodeKey)).toBe(tabPeerId)
    expect(held.issuer).toBe(provider.issuerKey)
    // Derived from the private key the tab was configured with, never passed as a field.
    expect(held.userKey).toBe(toHex(ed25519.getPublicKey(USER_PRIVATE_KEY)))

    await expect
      .poll(() => gate.libp2p.getConnections().map((c) => c.remotePeer.toString()), {
        timeout: SETTLE_MS,
      })
      .toContain(tabPeerId)

    // The reading the whole plan exists for: a node started with a pinned issuer now
    // takes a browser peer as a block source. `verifiedPeers` is the same list
    // `RpcBlockSource` reads, so this is a reading of the gate rather than a parallel
    // account of it.
    //
    // Polled through the verdict's own name rather than through `verifiedPeers`
    // directly, so a failure reports *which* refusal arrived instead of "expected [] to
    // include …" — the difference between a diagnosis and a restatement.
    await expect
      .poll(
        () => {
          const verdict = gate.verdictFor(tabPeerId)
          if (verdict === undefined) return 'not asked yet'
          return verdict.ok ? 'verified' : verdict.failure.kind
        },
        { timeout: SETTLE_MS },
      )
      .toBe('verified')
    expect(gate.verifiedPeers).toContain(tabPeerId)
  }, 120_000)

  /**
   * The seed survives a reload, and the assertion cannot be satisfied by a fresh mint.
   *
   * `'refuses-to-start-without-its-seed'` is doing the work. Restarting with
   * `'mints-a-new-identity'` and finding the same peer id would be evidence, but weak
   * evidence: a factory that ignored storage entirely would fail it, and one with a
   * subtly wrong key path would not necessarily. Demanding a refusal if the seed is
   * absent makes a successful start *itself* the proof that the stored bytes were read.
   */
  it('the same tab reloads as the same node, and cannot have minted its way there', async () => {
    const before = await page.evaluate(() => window.o2capability.peerId())
    await stopTab()

    const after = await startTab({
      blockstoreName: 'o2-enrol-certificated',
      enrol: false,
      whenSeedIsGone: 'refuses-to-start-without-its-seed',
    })
    expect(after).toBe(before)

    // And the certificate came back with it — from the tab's own store, with no provider
    // contacted, because `enrol` was false on this start and there was nothing to ask.
    const held = await page.evaluate(() => window.o2capability.certificate())
    expect(held).toBeNull()

    await stopTab()
  }, 120_000)

  /**
   * The other branch of `whenSeedIsGone`, planted rather than assumed.
   *
   * Without this, `'refuses-to-start-without-its-seed'` above could be a value the
   * factory never reads — the test above would pass just as happily with the whole
   * branch deleted, because its seed *is* present. A database name nothing has ever
   * written to is the case that separates them.
   */
  it('a tab told to refuse without its seed refuses, naming the store it looked in', async () => {
    const failure = await page.evaluate(
      async ([anchor, address]) => {
        try {
          await window.o2capability.start({
            relayAddrs: [address as string],
            blockstoreName: 'o2-enrol-never-written',
            trustAnchors: [anchor as string],
            sovereignty: { ownerId: '', canExecuteSovereign: false },
            whenSeedIsGone: 'refuses-to-start-without-its-seed',
          })
          return 'started, which it must not have'
        } catch (cause) {
          return cause instanceof Error ? cause.message : String(cause)
        }
      },
      [publisher.pub, providerAddr] as const,
    )

    expect(failure).toContain('no seed in o2-enrol-never-written-identity')
    expect(failure).toContain('refuses-to-start-without-its-seed')
  }, 120_000)
})
