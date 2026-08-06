/**
 * Criterion 8 at the browser tier — a live tab, refused, enrolled, and then admitted.
 *
 * > *"a node that cannot present a provider-issued certificate cannot join the fabric,
 * > advertise itself, or be dialled by another node"*
 *
 * **Phase 24 has exactly one criterion**, numbered 8 by inheritance from Phase 19, so a
 * verification scores it out of 1.
 *
 * ## THE TOPOLOGY THIS FILE BUILDS, named before anything is asserted about it
 *
 * **Co-located.** One `FabricNode` is the tab's **relay**, its **enrolment provider**, and the
 * node that **pins** `relayAdmission`. All three roles, one process, one address.
 *
 * That is the topology `24-CONTEXT.md`'s sub-decision 1 is actually about — *"a relay that pins
 * issuers must either serve enrolment itself or name a provider a joining peer can reach
 * without a reservation"* — and **no fixture in the tree stood it up at the browser tier
 * before this one**. `enrol-through-a-closed-door.node.test.ts` builds it at the Node tier;
 * this is its browser-tier counterpart.
 *
 * **The topology this file does NOT build, and what it would have shown.**
 * `browser-enrollment.e2e.test.ts` stands up **three** nodes — a `provider` that issues, a
 * separate `gate` that pins `trustedIssuers`, and the tab, whose *relay* is the provider. There,
 * refusal and issuance happen at different processes and *"refused and then enrolled through the
 * same address"* would mean the same address as the **relay**, not as the **gate**. That
 * arrangement would show that a *separated* deployment can still work — which is a different
 * claim, and one this file does not make. Sub-decision 1's own requirement is the co-located
 * one, so the co-located one is what is read here.
 *
 * ## THE INSTRUMENT IS THE RELAY'S STORE, NEVER THE TAB'S OWN ANSWER
 *
 * `browser-node.ts` passes `reservations: 'relays-for-nobody'` to `serveAgent`, and
 * `agent.ts`'s branch **short-circuits** on it: `peerIds: options.reservations ===
 * 'relays-for-nobody' ? [] : options.reservations()`. So a tab answers `[]` about itself
 * **whatever its admission state**, and a reading built on that answer passes identically
 * before and after the gate — a tautology of exactly the shape two criteria in this repository
 * already sit at PARTIAL for.
 *
 * Rather than leave that as a warning, this file **asks the tab both times and asserts the
 * constant**, in the same run as the real reading. The would-be tautology is therefore
 * demonstrated to be one, permanently, instead of being demonstrated once by a mutation and
 * then forgotten.
 *
 * ## THE SHAPE OF THE TRANSITION, and why it is a restart rather than a re-reservation
 *
 * 24-03 measured that **a peer refused at first boot never retries on its own**: libp2p arms
 * its reservation refresh timer only inside the success path, so a failed reservation leaves no
 * timer, and the door being opened underneath it changed nothing for 15 s. What does work short
 * of a restart is a **reconnection** — `hangUp` then dial re-enters the hook off the identify
 * topology event.
 *
 * **The tab API exposes no `hangUp`.** `CapabilityHarness` has `start`, `dial` and `stop`, and
 * `dial` on an already-connected peer is a no-op. So the transition available inside one page
 * load is `stop()` then `start()` — a node restart in the same tab, same origin, same
 * IndexedDB, and therefore **the same peer id**, which is what makes it a transition of one
 * node rather than a comparison of two.
 *
 * What is **UNMEASURED** and is named rather than implied: a *live* re-reservation at the
 * browser tier — a tab that enrols and is admitted without its node being restarted. It needs a
 * `hangUp` on the tab API that does not exist, and inventing one here would be this plan
 * editing the mechanism it is grading.
 *
 * ## WHAT THIS FILE CANNOT SHOW
 *
 * - Anything about an engine it did not run. Every engine is launched and any that cannot take
 *   part fails **by name** rather than vanishing.
 * - That a tab holding a certificate from *another* issuer is refused. That arm is not built
 *   here — it is built across real processes in `admission-agents.node.test.ts`, whose
 *   `outsider` carries a real certificate from an unpinned provider.
 * - That the three-node topology behaves as this one does. It is not the one that was built.
 * - **That a refused tab is out of the fabric.** It is out of *this relay*.
 *   `admission-agents.node.test.ts` measures a peer the gate refuses obtaining a reservation on
 *   an open relay-capable peer it also dialled. Admission is per-relay by construction.
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ed25519 } from '@noble/curves/ed25519.js'
import { chromium, firefox, webkit } from 'playwright'
import type { Browser, BrowserType, Page } from 'playwright'
import { createServer } from 'vite'
import type { ViteDevServer } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { toHex } from '@o2/core'
import type { PublicKeyHex } from '@o2/core'
import { encodeRequest, parseResponse } from '@o2/net'
import { FabricNode } from './fabric-node.ts'

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))

/** The harness page, reused unchanged — `browser-enrollment.e2e.test.ts`'s own idiom. */
const PAGE = 'packages/browser/harness/capability.html'

/**
 * The build authority every node here pins.
 *
 * No module is dispatched in this file, but a tab pins some anchor set however it is started
 * and the door must agree with it, or a later reader finds two nodes disagreeing about
 * provenance for no stated reason.
 *
 * Seed 62. Re-grepped across every `fill(n)` site in `packages/` and `tools/` on 2026-08-06:
 * 57 is `browser-capability`, 58 is `browser-enrollment`, 59 is `discovery-agents`, 60 and 61
 * are taken, 62 is free.
 */
const publisher = (() => {
  const priv = new Uint8Array(32).fill(62)
  return { priv, pub: toHex(ed25519.getPublicKey(priv)) }
})()

/**
 * The user the tab enrols on behalf of — the **private** key, and the type is the point.
 * `EnrollmentAuthority.enrol` refuses by name as `bad-owner-proof` without a signature over the
 * possession challenge, and only the private half can produce one.
 */
const USER_PRIVATE_KEY = new Uint8Array(32).fill(63)

const OPERATOR_ID = 'south-quay-volunteers'

/** The engines the browser-tier standard names, in the order they are launched. */
const ENGINES: readonly { readonly name: string; readonly type: BrowserType }[] = [
  { name: 'chromium', type: chromium },
  { name: 'firefox', type: firefox },
  { name: 'webkit', type: webkit },
]

/**
 * How long the relay is given to reach a verdict about a tab.
 *
 * Sited against two measured numbers rather than chosen: `RELAY_ADMISSION_DEADLINE_MS` is
 * 3 500 ms, and libp2p's own `DEFAULT_RESERVATION_COMPLETION_TIMEOUT` is 5 000 ms, past which
 * the joiner has given up whatever the gate decides. A browser adds a page load and an engine's
 * own scheduling on top, so this is an order of magnitude above the mechanism's own ceiling and
 * is a budget rather than a threshold — nothing below asserts on a duration.
 */
const VERDICT_BUDGET_MS = 60_000

/**
 * How long a refusal is held before it is believed.
 *
 * A window, not a sample: an absence read once is also what a fabric that has not got there yet
 * looks like. It is comparative — the admitted arm's grant is observed in the same run on the
 * same relay, so this window is known to exceed what a grant costs here.
 */
const ABSENCE_WINDOW_MS = 6_000

let workdir: string
let door: FabricNode
let doorAddr: string
let doorIssuer: PublicKeyHex
let server: ViteDevServer
let baseUrl: string

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Wait until `predicate` holds, naming what actually arrived. */
async function until(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs: number,
  what: string,
  observed?: () => unknown,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise((r) => setTimeout(r, 100))
  }
  const tail = observed === undefined ? '' : `; observed ${JSON.stringify(observed())}`
  throw new Error(`timed out waiting for ${what}${tail}`)
}

/** Hold `predicate` false for the whole window, or fail naming when it first became true. */
async function stays(
  predicate: () => boolean | Promise<boolean>,
  windowMs: number,
  what: string,
  observed?: () => unknown,
): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < windowMs) {
    if (await predicate()) {
      const tail = observed === undefined ? '' : `; observed ${JSON.stringify(observed())}`
      throw new Error(`${what} stopped holding after ${Date.now() - started}ms${tail}`)
    }
    await new Promise((r) => setTimeout(r, 100))
  }
}

/**
 * Ask a tab, over the fabric's own RPC, who **it** says is reserved on it.
 *
 * This is the answer that must never be the instrument, and it is asked here precisely so the
 * file can show why. See the header.
 */
async function tabSaysReserved(peerId: string): Promise<readonly string[]> {
  const body = await door.rpc.request(peerId, encodeRequest({ kind: 'reservations' }))
  const response = parseResponse(body)
  if (response === null || response.kind !== 'reservations') {
    throw new Error(`tab ${peerId} answered a reservations request with ${JSON.stringify(response)}`)
  }
  return response.peerIds
}

/**
 * Start the co-located door, in **two** steps, and the second step is not a workaround.
 *
 * `relayAdmission` must name the issuer this node itself will sign with, and that key does not
 * exist until `issuesCertificates` has been through a start. So the node is started once to mint
 * and persist the key under its `blockstoreDir`, stopped, and restarted on the **same directory**
 * with the key it minted now pinned. `enrollment-cost.node.test.ts` measured that a provider
 * restarting on the same directory keeps its issuer key across a different pid, so this is the
 * established property rather than an assumption.
 *
 * The alternative — assigning `connectionGater.denyInboundRelayReservation` onto libp2p's live
 * gater object after start, as `enrol-through-a-closed-door.node.test.ts` legitimately does —
 * was rejected here: that file had to, because the option did not exist when it was written.
 * It does now, and a reading of the criterion that installed its own gate would be grading a
 * hook rather than the production path from `relayAdmission` through `relayAdmissionGate`.
 */
async function startCoLocatedDoor(): Promise<void> {
  const minting = await FabricNode.start({
    // Admits nobody, and that is the truthful posture for a node whose entire life is to mint
    // a key and stop: no peer is given its address, and stating the open literal here would put
    // a sixty-first open site in the repository-wide census for a node that never met anybody.
    relayAdmission: new Set<PublicKeyHex>(),
    startReporting: 'reports-its-own-start',
    blockstoreDir: join(workdir, 'door'),
    listen: ['/ip4/127.0.0.1/tcp/0/ws'],
    trustAnchors: [publisher.pub],
    issuesCertificates: 'issues-without-an-aggregate-budget',
  })
  const issuer = minting.issuerKey
  await minting.stop()
  if (issuer === null) throw new Error('the door was started to issue and minted no key')
  doorIssuer = issuer

  door = await FabricNode.start({
    // **The whole subject of this file, on the production option.** A set with one member: a
    // peer gets a circuit here only if it presents a certificate this node itself signed.
    relayAdmission: new Set<PublicKeyHex>([issuer]),
    startReporting: 'reports-its-own-start',
    blockstoreDir: join(workdir, 'door'),
    listen: ['/ip4/127.0.0.1/tcp/0/ws'],
    trustAnchors: [publisher.pub],
    issuesCertificates: 'issues-without-an-aggregate-budget',
  })
  if (door.issuerKey !== issuer) {
    throw new Error(`the door minted a second issuer key across its restart: ${String(door.issuerKey)}`)
  }
  const dialable = door.browserDialableAddrs[0]
  if (dialable === undefined) throw new Error('the door produced no browser-dialable address')
  doorAddr = dialable
}

beforeAll(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'o2-gated-admission-'))
  await startCoLocatedDoor()

  server = await createServer({ root: ROOT, logLevel: 'error', server: { port: 0 } })
  await server.listen()
  const url = server.resolvedUrls?.local[0]
  if (url === undefined) throw new Error('vite dev server produced no URL')
  baseUrl = url.endsWith('/') ? url : `${url}/`
}, 240_000)

afterAll(async () => {
  await server?.close().catch(() => {})
  await door?.stop().catch(() => {})
  await rm(workdir, { recursive: true, force: true })
}, 120_000)

/** One engine's tab, opened on the harness page. */
async function openTab(engine: string, type: BrowserType): Promise<{ browser: Browser; page: Page }> {
  const browser = await type.launch()
  const page = await browser.newPage()
  page.on('pageerror', (error) => {
    process.stderr.write(`[${engine}] page error: ${error.message}\n`)
  })
  page.on('console', (message) => {
    if (message.type() === 'error') process.stderr.write(`[${engine}] console: ${message.text()}\n`)
  })
  await page.goto(`${baseUrl}${PAGE}`)
  await page.waitForFunction(() => typeof window.o2capability !== 'undefined', null, { timeout: 60_000 })
  return { browser, page }
}

/** Start the tab's node, with or without an enrolment, and hand back its peer id. */
async function startTabNode(page: Page, blockstoreName: string, enrol: boolean): Promise<string> {
  return page.evaluate(
    async ([store, anchor, relay, operatorId, userKey, shouldEnrol]) =>
      window.o2capability.start({
        // The **only** address this tab is ever given, and it is the door's. A page handed a
        // peer list out of band is not reading admission.
        relayAddrs: [relay as string],
        blockstoreName: store as string,
        trustAnchors: [anchor as string],
        sovereignty: { ownerId: '', canExecuteSovereign: false },
        // The seed persists in this origin's IndexedDB under `blockstoreName`, so the restart
        // below reuses it and both arms are the same node. That identity is the transition.
        whenSeedIsGone: 'mints-a-new-identity',
        ...(shouldEnrol === true
          ? {
              enrollment: {
                userPrivateKey: userKey as number[],
                operatorId: operatorId as string,
                // Co-located: the same address as `relayAddrs` above. The door a peer is
                // refused at is the door it must enrol through.
                providerAddr: relay as string,
              },
            }
          : {}),
      }),
    [blockstoreName, publisher.pub, doorAddr, OPERATOR_ID, [...USER_PRIVATE_KEY], enrol] as const,
  )
}

describe('AUTH-02 — a tab is refused by a gated relay, enrols through it, and is then admitted', () => {
  /**
   * The door's own posture, asserted before any browser is launched.
   *
   * Placed first for the reason `static-rendezvous.e2e.test.ts` records about its own inverse:
   * a misconfigured door produces tabs that time out in an engine twenty seconds later, in a
   * file that already reports per-engine failures, and this repository has spent real time on
   * that shape of misdiagnosis.
   */
  it('pins its own issuer at the door, on the production option rather than an installed hook', async () => {
    expect(door.issuerKey).toBe(doorIssuer)
    expect(doorAddr).toContain('/ws')

    // **Read off this file's own source, because `FabricNode` publishes no `relayAdmission`
    // getter and adding one would be this plan editing the mechanism it grades.** The posture
    // is a *construction* fact here and the construction is a literal thirty lines above, so
    // reading the literal is the honest instrument — which is also what 24-03 concluded after
    // catching itself asserting `admissionDecisions.length === 0` and calling that behavioural.
    //
    // The needles are **assembled** rather than written whole, on `relay-admission.node.test.ts`'s
    // standing rule: this file is a tracked `.ts` under `packages/`, so a needle written out
    // would make the repository-wide posture census count these assertions as construction
    // sites of their own.
    const FIELD = 'relayAdmission'
    const ownSource = await readFile(fileURLToPath(import.meta.url), 'utf8')
    expect(ownSource).toContain(`${FIELD}: new Set<PublicKeyHex>([issuer]),`)
    // And the door is not *also* stated open anywhere in this file. A second construction that
    // admitted everybody would make every refusal below depend on which one ran.
    expect(ownSource.split(`${FIELD}: 'admits-any-peer',`).length - 1).toBe(0)

    // Nobody has asked yet, so the decision log is empty — which is exactly why it is **not**
    // the instrument: it reads zero for a pinned door and an open one alike.
    expect(door.admissionDecisions).toStrictEqual([])
  })

  for (const { name, type } of ENGINES) {
    /**
     * One engine, one page, one node, two arms.
     *
     * Five readings carry it and each closes a different way this case could go green for the
     * wrong reason:
     *
     * 1. **the tab is running** — asserted as *connected to the door*, not as "start resolved".
     *    A tab that failed to start produces the same absence as a tab that was refused.
     * 2. **the refusal took** — held over a window, not sampled, and the window is longer than
     *    the grant in arm B takes.
     * 3. **the instrument is not the tab's own answer** — the tab is asked in both arms and
     *    answers `[]` both times, which is the demonstration that a reading built on it would
     *    have passed identically before and after the gate.
     * 4. **the transition is one node** — the same peer id in both arms, from the same origin's
     *    persisted seed.
     * 5. **the enrolment is real** — a certificate whose issuer is the door's own key, read off
     *    the tab rather than off the door.
     */
    it(`${name} — the same tab id is absent from the relay's store unenrolled and present in it enrolled`, async () => {
      let browser: Browser | undefined
      let opened: { browser: Browser; page: Page }
      try {
        opened = await openTab(name, type)
        browser = opened.browser
      } catch (error) {
        // Published, never dropped: an engine that vanishes between plan and result is
        // indistinguishable from one removed because it was inconvenient.
        throw new Error(`${name} could not take part — ${messageOf(error)}`)
      }

      const { page } = opened
      const store = `gated-admission-${name}`
      try {
        // ---- arm A: no certificate. -----------------------------------------------------
        const unenrolled = await startTabNode(page, store, false)

        // 1. The tab is up and talking to the door. Without this the absence below is also
        //    what a tab that never started looks like.
        await until(
          async () => (await page.evaluate(() => window.o2capability.peers())).includes(door.peerId),
          VERDICT_BUDGET_MS,
          `${name}'s unenrolled tab to be connected to the door`,
          () => ({ peers: [] as string[] }),
        )
        expect(await page.evaluate(() => window.o2capability.certificate())).toBeNull()

        // 2. And it holds no reservation, over a window rather than at an instant.
        await stays(
          () => door.reservedPeerIds.includes(unenrolled),
          ABSENCE_WINDOW_MS,
          `${name}'s unenrolled tab staying out of the door's reservation store`,
          () => ({ reserved: door.reservedPeerIds, decisions: door.admissionDecisions }),
        )
        expect(door.reservedPeerIds).not.toContain(unenrolled)

        // The door said why, in its own words. This is the relay-side reason that has no wire
        // surface — `admission-agents.node.test.ts` records that a refused peer is told only
        // `PERMISSION_DENIED` — so it is read here, in-process, where it exists.
        const refusal = door.admissionDecisions.find((decision) => decision.peerId === unenrolled)
        expect(refusal, `no decision recorded for ${unenrolled}`).toBeDefined()
        expect(refusal?.admitted).toBe(false)
        expect(refusal?.reason).toContain('is not admitted to this relay')

        // 3. **The tautology, demonstrated rather than avoided.** Asked about itself, the tab
        //    answers `[]` — and it will answer `[]` in arm B too.
        const saysWhenRefused = await tabSaysReserved(unenrolled)
        expect(saysWhenRefused).toStrictEqual([])

        // ---- the transition: same page, same origin, same seed. --------------------------
        await page.evaluate(async () => window.o2capability.stop())
        const enrolled = await startTabNode(page, store, true)

        // 4. One node, not two. This is what makes the two arms a transition.
        expect(enrolled).toBe(unenrolled)

        // 5. The enrolment is real, and it went through the door that had just refused it.
        const held = await page.evaluate(() => window.o2capability.certificate())
        expect(held?.issuer).toBe(doorIssuer)

        // **The claim.** The same id the door refused is now in the door's own store.
        await until(
          () => door.reservedPeerIds.includes(enrolled),
          VERDICT_BUDGET_MS,
          `${name}'s enrolled tab to obtain a reservation at the door that refused it`,
          () => ({ reserved: door.reservedPeerIds, decisions: door.admissionDecisions.slice(-3) }),
        )
        expect(door.reservedPeerIds).toContain(enrolled)

        const admission = [...door.admissionDecisions].reverse().find((d) => d.peerId === enrolled)
        expect(admission?.admitted).toBe(true)
        expect(admission?.reason).toContain('holds a certificate from a pinned issuer')

        // 3'. And the tab's own answer has not moved. **Same constant, both arms** — so a case
        //     built on it would have passed in both and measured nothing.
        expect(await tabSaysReserved(enrolled)).toStrictEqual(saysWhenRefused)
        expect(await tabSaysReserved(enrolled)).toStrictEqual([])

        await page.evaluate(async () => window.o2capability.stop()).catch(() => {})
      } finally {
        await browser?.close().catch(() => {})
      }
    }, 300_000)
  }
})
