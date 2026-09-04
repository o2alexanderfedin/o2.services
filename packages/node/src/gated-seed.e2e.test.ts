/**
 * Criterion 8 at the door a browser tab actually meets — a real `SeedServer` that pins an
 * issuer, and the advertisement surface `demo/main.ts` consumes.
 *
 * > *"a node that cannot present a provider-issued certificate cannot join the fabric,
 * > advertise itself, or be dialled by another node"*
 *
 * ## WHY THIS FILE EXISTS BESIDE `gated-admission.e2e.test.ts`
 *
 * That file reads the browser tier against a **co-located** `FabricNode` — one node that is
 * the tab's relay, its enrolment provider and the node that pins admission. It is a real
 * reading and it is not the topology a tab meets. **The seed is the relay every browser tab
 * in this fabric reserves on**, it is the source of `BootstrapInfo.peerAddrs`, and until Plan
 * 24-06 it could not be told to close at all. So this file stands up the production one:
 *
 *   - a **separated** provider that issues certificates and is not the seed;
 *   - a real `SeedServer` pinning that provider's issuer, **serving the demo page and
 *     `/bootstrap.json` from its own origin**, so the tab exercises the production discovery
 *     path rather than a re-creation of it;
 *   - a `memberNode` that enrolled and is admitted, and a `strangerNode` that did not and is
 *     refused — both alive, both directly dialable, differing in argv and in nothing else.
 *
 * **The separation is deliberate and it is the stronger reading.** `.planning/ROADMAP.md`'s
 * correction of 2026-08-05 records that separation was *believed* to break enrolment; Plan
 * 24-05 measured that it does not, across real `bin/agent.ts` processes — a joiner whose
 * provider had been told to admit a key nobody holds still came away with a valid certificate
 * from that same provider, because `resolveCertificate` enrols over a plain dial and there is
 * no reservation anywhere in that path.
 *
 * ## THE SECOND SURFACE THIS FILE EXISTS FOR
 *
 * `packages/browser/demo/main.ts` fetches `/bootstrap.json` and pushes **every** string in
 * `info.peerAddrs` into its dial candidates. That surface was asserted on by one file
 * (`seed-discovery.e2e.test.ts`) and only for address *shape*. It is the browser tier's actual
 * discovery path, so it is read here for its **content** and for its **consumption**: what a
 * real tab, in three engines, derives from it and attempts.
 *
 * Both of `runDiscoveryRound`'s candidate sources are derived from reservation stores — step 1
 * is `peerAddrs`, which `seed-server.ts` builds out of `node.reservedPeerIds`, and step 2 is
 * `findReservedPeers`, which asks connected peers the same `reservations` question. So a peer
 * the seed refused is absent from both **structurally**, with no `if` for anybody to forget.
 * This file is what makes that sentence a measurement instead of an argument.
 *
 * ## WHAT THIS FILE DOES NOT SHOW — stated here, before any reading
 *
 * 1. **A refused node is unfindable, not unreachable.** The `records` and `providers` answers
 *    are still ungated: nothing in this fabric refuses to *talk* to a peer that holds no
 *    certificate. `strangerNode` below is reached on every green run by
 *    `window.o2.dial(...)` handed its direct address, and that assertion is deliberately a
 *    standing one rather than a plant — the claim this file makes is about **discovery**, and
 *    saying so requires demonstrating the other half rather than leaving it unstated.
 * 2. **The browser tier still pins nobody and reaches no verdict about any peer.**
 *    `BrowserNodeOptions` has no `trustedIssuers` field; a tab takes every connected peer as
 *    usable. That is `PeerVerifier` and **selection** — a different question from admission —
 *    and Phase 22 owns the move per `.planning/DEFICIENCIES.md` D09. Nothing here closes it.
 * 3. **No live browser-tier re-reservation without a restart.** Plan 24-03 measured that a peer
 *    refused at first boot never retries on its own: libp2p arms its reservation refresh timer
 *    only inside the success path. What works short of a restart is a *reconnection*, and
 *    `TabApi` exposes no `hangUp`. So the transition available inside one page load is `stop()`
 *    then `start()` — same origin, same IndexedDB, therefore **the same peer id**, which is
 *    what makes the two arms a transition of one node rather than a comparison of two.
 *    Inventing a `hangUp` to do better would be this file editing the mechanism it grades.
 * 4. **No wrong-issuer arm at the browser tier.** A tab carrying a real certificate from an
 *    *unpinned* provider is not built here; that arm exists across real processes in
 *    `admission-agents.node.test.ts`, whose `outsider` carries exactly that.
 * 5. **One seed.** A fabric in which every door is closed is still unmeasured.
 *
 * ## THE INSTRUMENT IS THE SEED'S STORE AND THE SEED'S OWN ADVERTISEMENT — NEVER THE TAB'S ANSWER
 *
 * `browser-node.ts` passes `reservations: 'relays-for-nobody'` to `serveAgent`, and `agent.ts`
 * short-circuits on it: `peerIds: options.reservations === 'relays-for-nobody' ? [] :
 * options.reservations()`. **A tab therefore answers `[]` about itself whatever its admission
 * state**, and a reading built on that answer would pass identically before and after the gate.
 * Rather than warn about it, this file asks the tab in **both** arms and asserts the constant,
 * so the would-be tautology is demonstrated to be one permanently instead of being shown once
 * by a mutation and then forgotten. `gated-admission.e2e.test.ts` established the idiom.
 *
 * ## ALL NODES HAVE EQUAL FUNCTIONALITY
 *
 * The seed, the provider, the member, the stranger and the tab differ in argv and in options.
 * None of them differs in kind, and nothing below branches on which tier a peer is. The tab is
 * a node; the only difference is discovery.
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium, firefox, webkit } from 'playwright'
import type { Browser, BrowserType, Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PublicKeyHex } from '@o2/core'
import { KERNEL_TRUST_ANCHOR } from '@o2/demo'
import { identityFromSeed, nodeKeyForPeerId } from '@o2/libp2p'
import type { IdentityProtection } from '@o2/libp2p'
import { RpcRecordIndex, encodeRequest, parseResponse } from '@o2/net'
import { launchFixtureBrowser, plantLegacyIdentitySeed } from './e2e-browser-launch.ts'
import { FabricNode } from './fabric-node.ts'
import { SeedServer } from './seed-server.ts'

/** The demo page, served by the seed itself. `SeedServer` mounts the repo root. */
const PAGE_PATH = '/packages/browser/demo/index.html'

/**
 * The build authority every node here pins — DET-03, DATA-08.
 *
 * The demo's own committed key, which is what `bin/seed.ts` and `bin/agent.ts` pin when run
 * with no flags, and what a visitor's tab pins by default because `TabApi.start` is called
 * here without `trustAnchors`. No module is dispatched below, so this covers nothing; it is
 * here so that the five nodes in this fixture do not disagree about provenance for no stated
 * reason, exactly as `seed-discovery.e2e.test.ts` records about its own use of it.
 */
const TRUST_ANCHORS: readonly PublicKeyHex[] = [KERNEL_TRUST_ANCHOR]

/**
 * The user the enrolling nodes enrol on behalf of — the **private** key, and the type is the
 * point. `EnrollmentAuthority.enrol` refuses by name as `bad-owner-proof` without a signature
 * over the possession challenge, and only the private half can produce one.
 *
 * Seed 64. Re-grepped across every `new Uint8Array(32).fill(n)` site in `packages/` and
 * `tools/` on 2026-08-06: 63 is `gated-admission.e2e.test.ts`'s, 67 is taken, 64–66 are free.
 */
const USER_PRIVATE_KEY = new Uint8Array(32).fill(64)

const OPERATOR_ID = 'harbour-road-volunteers'

/** The engines the browser-tier standard names, in the order they are launched. */
const ENGINES: readonly { readonly name: string; readonly type: BrowserType }[] = [
  { name: 'chromium', type: chromium },
  { name: 'firefox', type: firefox },
  { name: 'webkit', type: webkit },
]

/**
 * How long the seed is given to reach a verdict about a peer.
 *
 * Sited against two measured numbers rather than chosen: `RELAY_ADMISSION_DEADLINE_MS` is
 * 3 500 ms and libp2p's own `DEFAULT_RESERVATION_COMPLETION_TIMEOUT` is 5 000 ms, past which
 * the joiner has given up whatever the gate decides. A browser adds a page load and an
 * engine's own scheduling on top, so this is an order of magnitude above the mechanism's
 * ceiling and is a budget rather than a threshold — nothing below asserts on a duration.
 */
const VERDICT_BUDGET_MS = 60_000

/**
 * How long a refusal is held before it is believed.
 *
 * A window, not a sample: an absence read once is also what a fabric that has not got there
 * yet looks like. It is comparative — `memberNode`'s grant is observed in the fixture case on
 * the same seed in the same run, and the enrolled tab's grant is observed in the same case as
 * every absence below, so this window is known to exceed what a grant costs on this host.
 */
const ABSENCE_WINDOW_MS = 6_000

let workdir: string
let provider: FabricNode
let providerAddr: string
let providerIssuer: PublicKeyHex
let seed: SeedServer
let seedRelayAddr: string
let pageUrl: string
let bootstrapUrl: string
let memberNode: FabricNode
let strangerNode: FabricNode
let strangerDirectAddr: string

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Occurrences of a needle, as a count rather than a presence. */
function occurrences(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1
}

/**
 * The peer an address leads to: the **last** `/p2p/` component.
 *
 * `dial-plan.ts`'s own rule, restated here rather than imported, because this file must read
 * an address the same way the code under test does. A substring search is wrong: a circuit
 * address is `<relayAddr>/p2p-circuit/webrtc/p2p/<target>` and `relayAddr` ends in the
 * **relay's** peer id, so `address.includes(peer)` is true of every entry for the seed.
 */
function targetOf(address: string): string {
  const parts = address.split('/p2p/')
  return parts[parts.length - 1] ?? ''
}

/**
 * Wait until `predicate` holds, naming what actually arrived.
 *
 * `observed` is **awaited**. Plan 24-05 found by plant that an un-awaited async thunk
 * stringifies to `{}`, which makes the one message a timeout produces vacuous — the exact
 * failure the thunk exists to prevent, reproduced by the mechanism meant to prevent it. Every
 * observation in this file is a round trip or a `fetch`, so every thunk here is async.
 */
async function until(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs: number,
  what: string,
  observed?: () => unknown,
): Promise<void> {
  // Two measured reds on 2026-08-31, both false. (1) A predicate here is a round trip over a
  // live connection or another process, and a drop between two polls is the *"not yet"* the
  // budget exists to absorb — so a throw is `false`, carried to the report rather than
  // swallowed. (2) The predicate is re-checked ONCE after the deadline, or the message is
  // built from a later observation than the last evaluation and can read `waiting for X;
  // observed X`. Full working: `closed-fabric-agents.node.test.ts`'s `until`.
  const deadline = Date.now() + timeoutMs
  let lastError: unknown
  const attempt = async (): Promise<boolean> => {
    try {
      if (await predicate()) return true
      lastError = undefined
      return false
    } catch (cause) {
      lastError = cause
      return false
    }
  }
  while (Date.now() < deadline) {
    if (await attempt()) return
    await new Promise((r) => setTimeout(r, 100))
  }
  if (await attempt()) return
  const threw =
    lastError === undefined
      ? ''
      : `; last attempt threw ${lastError instanceof Error ? lastError.message : String(lastError)}`
  const tail = observed === undefined ? '' : `; observed ${JSON.stringify(await observed())}`
  throw new Error(`timed out waiting for ${what}${threw}${tail}`)
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
      const tail = observed === undefined ? '' : `; observed ${JSON.stringify(await observed())}`
      throw new Error(`${what} stopped holding after ${Date.now() - started}ms${tail}`)
    }
    await new Promise((r) => setTimeout(r, 100))
  }
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
 * `/bootstrap.json` exactly as the tab's own `fetch('/bootstrap.json', { cache: 'no-store' })`
 * receives it — same origin, same middleware, same bytes.
 *
 * Requested with `Host: 127.0.0.1:<httpPort>`, which is the host the tab used, so the
 * addresses derived from it are the addresses the tab is handed.
 */
async function bootstrapPeerAddrs(): Promise<readonly string[]> {
  const response = await fetch(bootstrapUrl, { cache: 'no-store' })
  if (!response.ok) throw new Error(`the seed answered /bootstrap.json with ${response.status}`)
  const info = (await response.json()) as { peerAddrs?: unknown }
  if (!Array.isArray(info.peerAddrs)) throw new Error('/bootstrap.json carried no peerAddrs array')
  return info.peerAddrs.filter((a): a is string => typeof a === 'string')
}

/** Whether the seed is currently advertising `peerId` to arriving tabs. */
async function advertises(peerId: string): Promise<boolean> {
  return (await bootstrapPeerAddrs()).some((address) => targetOf(address) === peerId)
}

/**
 * Ask a tab, over the fabric's own RPC, who **it** says is reserved on it.
 *
 * The answer that must never be the instrument, asked here precisely so this file can show
 * why. See the header.
 */
async function tabSaysReserved(peerId: string): Promise<readonly string[]> {
  const body = await seed.node.rpc.request(peerId, encodeRequest({ kind: 'reservations' }))
  const response = parseResponse(body)
  if (response === null || response.kind !== 'reservations') {
    throw new Error(`tab ${peerId} answered a reservations request with ${JSON.stringify(response)}`)
  }
  return response.peerIds
}

/**
 * The issuer named by the certificate a peer serves about itself, or `null`.
 *
 * Read over the **fabric's own `records` request**, which is the same path
 * `demo/main.ts`'s `peerCertificate` takes and the same one the seed's admission gate takes.
 * The node key is computed offline from the peer id, so the key asked about is the key whose
 * holder must have dialled as that peer.
 */
async function certificateIssuerOf(peerId: string): Promise<PublicKeyHex | null> {
  const nodeKey = nodeKeyForPeerId(peerId)
  if (nodeKey === null) return null
  const records = await new RpcRecordIndex(seed.node.rpc, () => [peerId]).recordsFor(nodeKey)
  return records?.certificate.issuer ?? null
}

/**
 * Start the separated provider, in **two** steps, and the second step is not a workaround.
 *
 * A provider's issuer key does not exist until `issuesCertificates` has been through a start,
 * so the node is started once to mint and persist it under `blockstoreDir`, stopped, and
 * restarted on the **same directory** with the key it minted now pinned.
 * `enrollment-cost.node.test.ts` measured that a provider restarting on the same directory
 * keeps its issuer key across a different pid, so this is an established property rather than
 * an assumption.
 *
 * The minting start admits **nobody**, and that is the truthful posture for a node whose whole
 * life is to mint a key and stop: it meets no peer, and stating the open literal would put
 * another open site in the repository-wide posture census for a node that never had a door.
 */
/**
 * AUTH-06 — stated because `startProvider` below restarts the provider on its own directory
 * and refuses if the issuer key moved.
 *
 * Plan 42-02 made `FabricNodeOptions.identityProtection` default to `writes-no-new-secret`, so
 * a node told nothing persists no secret and mints a fresh provider key on every start. The
 * refusal four lines below would then fire for a reason about identity rather than about the
 * gate this file measures. Persistence is asked for; the refusal is left as strict as it was.
 */
const PERSISTS: IdentityProtection = { kind: 'passphrase', passphrase: 'gated-seed-spec-passphrase' }

async function startProvider(): Promise<void> {
  const minting = await FabricNode.start({
    relayAdmission: new Set<PublicKeyHex>(),
    startReporting: 'reports-its-own-start',
    blockstoreDir: join(workdir, 'provider'),
    identityProtection: PERSISTS,
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
    identityProtection: PERSISTS,
    listen: ['/ip4/127.0.0.1/tcp/0/ws'],
    trustAnchors: TRUST_ANCHORS,
    issuesCertificates: 'issues-without-an-aggregate-budget',
  })
  if (provider.issuerKey !== providerIssuer) {
    throw new Error(`the provider minted a second issuer across its restart: ${String(provider.issuerKey)}`)
  }
  providerAddr = directWsAddr(provider)
}

beforeAll(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'o2-gated-seed-'))
  await startProvider()

  // **The subject.** A real seed, serving the demo page and `/bootstrap.json` from its own
  // origin, pinning the separated provider's issuer. This is the door a tab meets.
  seed = await SeedServer.start({
    relayAdmission: new Set<PublicKeyHex>([providerIssuer]),
    blockstoreDir: join(workdir, 'seed'),
    maxReservations: 32,
    trustAnchors: TRUST_ANCHORS,
    // AUTH-01/04 — **the seed names the provider, so the tab below never has to be told it.**
    //
    // This is the deployment requirement `SeedServerOptions.relayAdmission` states in its own
    // words — *a relay that pins issuers must either serve enrolment itself, or name a provider
    // a joining peer can reach without a reservation* — satisfied for the first time by a
    // mechanism rather than by a harness. Before 2026-08-08 no such field existed, and this
    // file passed `providerAddr` into the page through `page.evaluate`, which made the fixture
    // prove less than it looked like it proved: a visitor has no Playwright.
    enrollmentProvider: providerAddr,
  })
  seedRelayAddr = `/ip4/127.0.0.1/tcp/${seed.wsPort}/ws/p2p/${seed.node.peerId}`
  pageUrl = `http://127.0.0.1:${seed.httpPort}${PAGE_PATH}`
  bootstrapUrl = `http://127.0.0.1:${seed.httpPort}/bootstrap.json`

  // The admitted peer. Enrols at the provider over a plain dial, then reserves at the seed —
  // the separated deployment, working. It is what makes every absence below a reading rather
  // than a picture of a seed that advertises nobody at all.
  memberNode = await FabricNode.start({
    relayAdmission: new Set<PublicKeyHex>([providerIssuer]),
    startReporting: 'reports-its-own-start',
    blockstoreDir: join(workdir, 'member'),
    listen: ['/ip4/127.0.0.1/tcp/0/ws'],
    relayAddrs: [seedRelayAddr],
    trustAnchors: TRUST_ANCHORS,
    enrollment: {
      userPrivateKey: USER_PRIVATE_KEY,
      operatorId: OPERATOR_ID,
      providerAddr,
    },
  })

  // The refused peer. **Identical to `memberNode` but for the `enrollment` option** — same
  // class, same transports, same listen address, alive and directly dialable throughout. It
  // pins the same issuer itself, so this fixture holds no relay-capable peer that admits
  // everybody and no absence below can be an artefact of one.
  strangerNode = await FabricNode.start({
    relayAdmission: new Set<PublicKeyHex>([providerIssuer]),
    startReporting: 'reports-its-own-start',
    blockstoreDir: join(workdir, 'stranger'),
    listen: ['/ip4/127.0.0.1/tcp/0/ws'],
    relayAddrs: [seedRelayAddr],
    trustAnchors: TRUST_ANCHORS,
  })
  strangerDirectAddr = directWsAddr(strangerNode)
}, 300_000)

afterAll(async () => {
  await strangerNode?.stop().catch(() => {})
  await memberNode?.stop().catch(() => {})
  await seed?.stop().catch(() => {})
  await provider?.stop().catch(() => {})
  await rm(workdir, { recursive: true, force: true })
}, 180_000)

/** One engine's tab, opened on the page the **seed itself** serves, with consent granted. */
async function openTab(engine: string, type: BrowserType): Promise<{ browser: Browser; page: Page }> {
  const browser = await launchFixtureBrowser(type)
  const page = await browser.newPage()
  page.on('pageerror', (error) => {
    process.stderr.write(`[${engine}] page error: ${error.message}\n`)
  })
  page.on('console', (message) => {
    if (message.type() === 'error') process.stderr.write(`[${engine}] console: ${message.text()}\n`)
  })
  await page.goto(pageUrl)
  await page.waitForFunction(() => typeof window.o2 !== 'undefined', null, { timeout: 60_000 })
  // BROW-01 has no test-only bypass: a harness consents for the same reason a visitor clicks
  // the button, and `discoverRelays` is gated behind it because reading `/bootstrap.json` is
  // a network request.
  await page.evaluate(() => {
    window.o2.grantConsent()
  })
  return { browser, page }
}

/**
 * Start the tab's node, with or without an enrolment, and hand back its peer id.
 *
 * **`relayAddrs` comes from the tab's own `discoverRelays()`**, never from a value this file
 * passed it. A page handed a relay address out of band is not reading the production
 * discovery path, and the production discovery path is the whole subject of this file.
 *
 * **And since 2026-08-08 the provider's address comes from there too.** It used to arrive
 * through `page.evaluate`, which hid the gap the v1.1 audit found as G1: the seed stated a
 * deployment requirement to name a provider, no field existed with which to name one, and this
 * fixture supplied the missing value from Node so nothing went red. A visitor has no
 * Playwright. The tab now refuses to enrol against an address the origin did not publish, so
 * deleting `SeedServer`'s `enrollmentProvider` reddens this file instead of passing quietly.
 *
 * **What is still injected, and why that is correct:** `operatorId` and `userPrivateKey`. Those
 * are the *visitor's*, a certificate is signed over them, and no seed holds them or may supply
 * them — `demo/main.ts` states it as *"a page that was found rather than configured must not be
 * configurable by whatever found it"*. Discovering an address is not being handed an identity,
 * and the whole of G1's remedy sits on that line.
 */
async function startTabNode(page: Page, blockstoreName: string, enrol: boolean): Promise<string> {
  return page.evaluate(
    async (options) => {
      const { source, relayAddrs, enrollmentProvider } = await window.o2.discoverRelays()
      if (source !== 'origin') {
        throw new Error(`the tab learned its relay from '${source}', not from its own origin`)
      }
      if (options.enrol && enrollmentProvider === undefined) {
        throw new Error('the origin published no enrollmentProvider, so this tab cannot enrol')
      }
      return window.o2.start({
        relayAddrs,
        blockstoreName: options.blockstoreName,
        // The seed persists in this origin's IndexedDB under `blockstoreName`, so the restart
        // below reuses it and both arms are the same node. That identity is the transition.
        ...(options.enrol && enrollmentProvider !== undefined
          ? {
              enrollment: {
                // **Separated, and now discovered**: the provider's address, which is not the
                // relay's. The door a tab is refused at is not the door it enrols through, and
                // 24-05 measured that this works because enrolment is a plain dial with no
                // reservation in its path. The seed publishes it; this file no longer passes it.
                providerAddr: enrollmentProvider,
                operatorId: options.operatorId,
                userPrivateKey: options.userKey,
              },
            }
          : {}),
      })
    },
    {
      blockstoreName,
      enrol,
      operatorId: OPERATOR_ID,
      // Playwright serialises `page.evaluate` arguments as JSON, so a typed array would arrive
      // as a plain `{"0":…}` object and `ed25519.getPublicKey` would derive a key from
      // nothing. `TabApi.start` takes `number[]` and rebuilds it on the page side.
      userKey: [...USER_PRIVATE_KEY],
    },
  )
}

/**
 * One pre-AUTH-06 seed per engine — see the case docblock and `plantLegacyIdentitySeed`.
 *
 * Distinct per engine so that a reader of a failure knows which profile it came from, and
 * so that the three never collapse into one identity if the fixture is ever changed to share
 * a profile. Exactly 32 bytes each; all-identical bytes is a valid ed25519 seed and the
 * repository's other fixtures use the same shape (`new Uint8Array(32).fill(63)`).
 */
const PLANTED_SEEDS: Readonly<Record<string, Uint8Array>> = {
  chromium: new Uint8Array(32).fill(11),
  firefox: new Uint8Array(32).fill(13),
  webkit: new Uint8Array(32).fill(17),
}

describe('AUTH-02 — the door a browser tab actually meets is a seed, and it can be closed', () => {
  /**
   * The fixture is what it claims to be, established **before any browser launches**.
   *
   * Placed first and alone for the reason `static-rendezvous.e2e.test.ts` records: a
   * misconfigured door produces tabs that time out in an engine twenty seconds later, in a
   * file that already reports per-engine failures, and this repository has spent real time on
   * that shape of misdiagnosis. A composite case that established these inline would report
   * "the fixture is wrong" as a failure of whichever engine ran first.
   */
  it('is a separated topology whose seed refuses an uncertificated node and admits an enrolled one', async () => {
    // 1. Separated. The provider is not the seed, and that is the claim this file makes that
    //    `gated-admission.e2e.test.ts` does not.
    expect(provider.peerId).not.toBe(seed.node.peerId)
    expect(provider.issuerKey).toBe(providerIssuer)
    expect(providerAddr).toContain('/ws')
    expect(seedRelayAddr).toContain(seed.node.peerId)

    // 2. **The posture, read off source, because `FabricNode` publishes no getter for it and
    //    adding one would be this file editing the mechanism it grades** (24-04, finding 7).
    //    The needles are *assembled* rather than written whole, on
    //    `relay-admission.node.test.ts`'s standing rule: this is a `.ts` file under
    //    `packages/`, and a needle written out would make these assertions construction sites
    //    of their own in the repository-wide posture census.
    //
    //    Counted rather than merely present. `toContain` alone would still pass if the seed's
    //    construction had been opened and one of the other three pinned ones remained.
    //
    //    **Placed before the behavioural readings, and that ordering was measured rather than
    //    chosen.** With these last, the two mutations they exist to catch — the seed opened
    //    here, and `seed-server.ts` overriding the operator's option with a literal — both
    //    reddened the `stays` at (5) first, in ~100 ms, and these lines were never reached. An
    //    assertion that cannot fail before something else does is not a proof of anything. Run
    //    first they name the misconfiguration itself, which is what `static-rendezvous.e2e.test.ts`
    //    and 24-05's own posture-guard finding both record as the thing worth having: a fixture
    //    error should say it is a fixture error, not surface as a symptom later. Measured after
    //    the move: 9 ms and 240 ms respectively, each naming the file and the count that moved.
    const FIELD = 'relayAdmission'
    const PINNED = `${FIELD}: new Set<PublicKeyHex>([providerIssuer]),`
    const ownSource = await readFile(fileURLToPath(import.meta.url), 'utf8')
    // Five construction sites: the minting provider, the pinned provider, the seed, the
    // member and the stranger. Four state a pinned set; one states the empty set; **none
    // states the open literal.**
    expect(occurrences(ownSource, `${FIELD}:`)).toBe(5)
    expect(occurrences(ownSource, PINNED)).toBe(4)
    expect(occurrences(ownSource, `${FIELD}: new Set<PublicKeyHex>(),`)).toBe(1)
    expect(occurrences(ownSource, `${FIELD}: 'admits-any-peer',`)).toBe(0)

    // 3. And the value this file passes actually reaches the node. `seed-server.ts` forwards
    //    the operator's option rather than stating a literal of its own — the property Plan
    //    24-06 landed. Cross-checked here because a seed that overrode it produces the
    //    banner-says-shut-door-is-open defect, and because **this exact mutation was observed
    //    live in this working tree on 2026-08-06** while a concurrent plan held it as a plant:
    //    every reading in this file went red at once, and none of them said which file was
    //    wrong. These two lines are what turn that into a sentence.
    const seedSource = await readFile(fileURLToPath(new URL('./seed-server.ts', import.meta.url)), 'utf8')
    expect(seedSource).toContain(`${FIELD}: options.${FIELD},`)
    expect(occurrences(seedSource, `${FIELD}: 'admits-any-peer',`)).toBe(0)

    // 4. The enrolled node is admitted. Watched **before any absence**, so every absence below
    //    is read against a grant this run has already seen happen on this host.
    await until(
      () => seed.node.reservedPeerIds.includes(memberNode.peerId),
      VERDICT_BUDGET_MS,
      "the enrolled member to obtain a reservation at the seed's door",
      async () => ({ reserved: seed.node.reservedPeerIds, decisions: seed.node.admissionDecisions.slice(-3) }),
    )
    expect(memberNode.certificate?.issuer).toBe(providerIssuer)

    // 5. The uncertificated node is refused, held over a window rather than sampled — and it
    //    is alive and dialable throughout, which is what makes its later absence a fact about
    //    discovery rather than about liveness.
    await stays(
      () => seed.node.reservedPeerIds.includes(strangerNode.peerId),
      ABSENCE_WINDOW_MS,
      "the uncertificated stranger staying out of the seed's reservation store",
      async () => ({ reserved: seed.node.reservedPeerIds, decisions: seed.node.admissionDecisions }),
    )
    expect(seed.node.reservedPeerIds).not.toContain(strangerNode.peerId)
    expect(strangerNode.certificate).toBeNull()

    // 6. The seed said why, in its own words. **This is also the evidence that a gate exists
    //    at all**: `'admits-any-peer'` supplies no gater method, so an open seed produces an
    //    empty decision log rather than a list of approvals. A refusal recorded by name is
    //    therefore a live reading of the posture and not only of the outcome.
    const refusal = seed.node.admissionDecisions.find((d) => d.peerId === strangerNode.peerId)
    expect(refusal, `no admission decision recorded for ${strangerNode.peerId}`).toBeDefined()
    expect(refusal?.admitted).toBe(false)
    expect(refusal?.reason).toContain('is not admitted to this relay')

    const admitted = [...seed.node.admissionDecisions].reverse().find((d) => d.peerId === memberNode.peerId)
    expect(admitted?.admitted).toBe(true)
    expect(admitted?.reason).toContain('holds a certificate from a pinned issuer')
  }, 180_000)

  for (const { name, type } of ENGINES) {
    /**
     * One engine, one page served by the seed, one node, two arms.
     *
     * Every reading closes a different way this case could go green for the wrong reason:
     *
     * 1. **the tab is running** — asserted as *connected to the seed*, not as "start
     *    resolved". A tab that failed to start produces the same absence as a refused one.
     * 2. **the tab learned its relay from the origin** — `discoverRelays()` answering
     *    `'origin'`, so the address under test is the one production hands a visitor.
     * 3. **the refusal took** — held over a window, not sampled.
     * 4. **the instrument is not the tab's own answer** — asked in both arms, `[]` both times.
     * 5. **the transition is one node** — the same peer id from the same origin's seed.
     * 6. **the enrolment is real and it came from the separated provider** — the certificate
     *    issuer read off the fabric's own `records` request.
     *
     * ## AUTH-06, 2026-09-04 — which visitor this tab now is, and why it is planted
     *
     * Reading 5 needs one node across two starts through `window.o2`, and since AUTH-06 the
     * demo passes `writes-no-new-secret`: a *cold* visitor is asked for no passphrase, writes
     * no key, and is a different node on every visit. So this tab is the one visitor who does
     * still hold a durable identity — **a returning visitor whose browser already held a key
     * from before AUTH-06**, adopted rather than deleted (threat T-42-20). The seed is planted
     * before the first start and `plantLegacyIdentitySeed`'s docblock carries the reasoning.
     *
     * Nothing about readings 1-4 or 6 changes, and no assertion moved. What changed is how the
     * identity got into the store, and the line under the plant pins it: the first arm's peer
     * id must be the one the planted seed implies, so a mis-planted seed fails as *the adoption
     * never happened* rather than as a bare id mismatch two arms later.
     */
    it(`${name} — the same tab id is absent from the seed's store unenrolled and present in it enrolled`, async () => {
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
      const store = `gated-seed-${name}`
      try {
        // AUTH-06 — see this case's docblock. The tab is a returning pre-AUTH-06 visitor,
        // because that is the only visitor `writes-no-new-secret` leaves with an identity
        // that survives a start. Planted before the first start, per engine so no two
        // profiles share one.
        await plantLegacyIdentitySeed(page, store, PLANTED_SEEDS[name] ?? new Uint8Array(32).fill(1))

        // ---- arm A: no certificate. ------------------------------------------------------
        const unenrolled = await startTabNode(page, store, false)

        // The adoption happened, and this is what says so. Without it a planting mistake
        // would surface as arm B disagreeing with arm A, which names the wrong thing.
        expect(
          unenrolled,
          `${name}'s tab did not adopt the planted pre-AUTH-06 seed — it minted instead, which is `
            + 'what a tab with no stored key does and is not what this case is reading',
        ).toBe((await identityFromSeed(PLANTED_SEEDS[name] ?? new Uint8Array(32).fill(1))).peerId)

        await until(
          async () => (await page.evaluate(() => window.o2.peers())).includes(seed.node.peerId),
          VERDICT_BUDGET_MS,
          `${name}'s unenrolled tab to be connected to the seed`,
          async () => ({ peers: await page.evaluate(() => window.o2.peers()) }),
        )

        await stays(
          () => seed.node.reservedPeerIds.includes(unenrolled),
          ABSENCE_WINDOW_MS,
          `${name}'s unenrolled tab staying out of the seed's reservation store`,
          async () => ({ reserved: seed.node.reservedPeerIds, decisions: seed.node.admissionDecisions.slice(-3) }),
        )
        expect(seed.node.reservedPeerIds).not.toContain(unenrolled)

        const refusal = seed.node.admissionDecisions.find((d) => d.peerId === unenrolled)
        expect(refusal, `no admission decision recorded for ${name}'s unenrolled tab`).toBeDefined()
        expect(refusal?.admitted).toBe(false)
        expect(refusal?.reason).toContain('is not admitted to this relay')

        // **The tautology, demonstrated rather than avoided.** Asked about itself, the tab
        // answers `[]` — and it will answer `[]` in arm B too.
        const saysWhenRefused = await tabSaysReserved(unenrolled)
        expect(saysWhenRefused).toStrictEqual([])

        // **The advertisement surface, in the refused arm.** `peerAddrs` as served to this
        // very tab carries the admitted member and carries neither this tab nor the stranger.
        // Held over a window rather than sampled, and the member's presence is what stops the
        // pair being satisfied by a seed that advertises nobody at all.
        await stays(
          async () => (await advertises(unenrolled)) || (await advertises(strangerNode.peerId)),
          ABSENCE_WINDOW_MS,
          `${name}'s unenrolled tab and the stranger staying out of the seed's peerAddrs`,
          async () => ({ peerAddrs: await bootstrapPeerAddrs() }),
        )
        expect(await advertises(memberNode.peerId)).toBe(true)

        // ---- the transition: same page, same origin, same IndexedDB seed. -----------------
        await page.evaluate(async () => window.o2.stop())
        const enrolled = await startTabNode(page, store, true)

        // One node, not two. This is what makes the two arms a transition.
        expect(enrolled).toBe(unenrolled)

        // **The claim.** The same id the seed refused is now in the seed's own store.
        await until(
          () => seed.node.reservedPeerIds.includes(enrolled),
          VERDICT_BUDGET_MS,
          `${name}'s enrolled tab to obtain a reservation at the seed that refused it`,
          async () => ({ reserved: seed.node.reservedPeerIds, decisions: seed.node.admissionDecisions.slice(-3) }),
        )
        expect(seed.node.reservedPeerIds).toContain(enrolled)

        const admission = [...seed.node.admissionDecisions].reverse().find((d) => d.peerId === enrolled)
        expect(admission?.admitted).toBe(true)
        expect(admission?.reason).toContain('holds a certificate from a pinned issuer')

        // And the certificate came from the **provider**, not from the seed. The separated
        // topology, read off the fabric rather than off the tab's own claim about itself.
        expect(await certificateIssuerOf(enrolled)).toBe(providerIssuer)

        // The tab's own answer has not moved. **Same constant, both arms** — so a case built
        // on it would have passed in both and measured nothing.
        expect(await tabSaysReserved(enrolled)).toStrictEqual(saysWhenRefused)
        expect(await tabSaysReserved(enrolled)).toStrictEqual([])

        // ---- the surface the tab consumes ------------------------------------------------
        //
        // `demo/main.ts` fetches `/bootstrap.json` and pushes every string in `info.peerAddrs`
        // into its dial candidates; step 2 of the same round asks the fabric through
        // `findReservedPeers`, which reads the same `reservations` thunk. **Both candidate
        // sources are derived from reservation stores**, so the absence below is structural
        // rather than filtered — there is no `if` for anybody to forget.
        //
        // Presence first, absence second, and the absence over a window whose length arm B's
        // presence has already shown to be enough on this host.
        await until(
          async () => advertises(enrolled),
          VERDICT_BUDGET_MS,
          `${name}'s enrolled tab to appear in the seed's peerAddrs`,
          async () => ({ peerAddrs: await bootstrapPeerAddrs() }),
        )
        await stays(
          async () => advertises(strangerNode.peerId),
          ABSENCE_WINDOW_MS,
          "the uncertificated stranger staying out of the seed's peerAddrs",
          async () => ({ peerAddrs: await bootstrapPeerAddrs() }),
        )

        // **What the tab did with it.** `dialed` holds peer ids and `failed` holds addresses,
        // so the stranger is checked against both, by target and by substring.
        const round = await page.evaluate(async () => window.o2.connectDiscoveredPeers())
        // An empty round must not read as a pass: `asked` is false only when no directory
        // answered at all.
        expect(round.asked).toBe(true)

        const attempted = new Set([...round.dialed, ...round.failed.map(targetOf)])
        // Published, so a reader of a green run sees the reading rather than inferring it from
        // the assertions that follow — 24-05's `[bootstrap]` idiom. `short` keeps the line
        // legible without making the assertions depend on a prefix length.
        const short = (id: string): string => id.slice(-8)
        process.stderr.write(
          `[gated-seed] ${name}: tab=${short(enrolled)} seed=${short(seed.node.peerId)} ` +
            `member=${short(memberNode.peerId)} stranger=${short(strangerNode.peerId)} ` +
            `peerAddrs=[${(await bootstrapPeerAddrs()).map((a) => short(targetOf(a))).join(' ')}] ` +
            `asked=${String(round.asked)} dialed=[${round.dialed.map(short).join(' ')}] ` +
            `failed=[${round.failed.map((a) => short(targetOf(a))).join(' ')}] ` +
            `attempted=[${[...attempted].map(short).join(' ')}]\n`,
        )
        // The positive half. An advertised peer is attempted — so the negative half below is
        // a statement about *what was advertised*, not about a round that dialled nothing.
        expect([...attempted]).toContain(memberNode.peerId)
        // The negative half. Nothing was attempted for the refused node. That is a different
        // fact from a dial that failed, and the two are distinguished here rather than merged.
        expect(round.dialed).not.toContain(strangerNode.peerId)
        expect(round.failed.filter((address) => address.includes(strangerNode.peerId))).toStrictEqual([])

        // ---- the limit, asserted in the same run rather than around it -------------------
        //
        // **A refused node is unfindable, not unreachable.** Handed its direct address, the
        // tab reaches the very peer its discovery round never heard of. A standing assertion
        // on every green, which is strictly stronger than demonstrating it once by a plant —
        // and the same call 24-04 made for its clause 3.
        const reached = await page.evaluate(
          async (address) => window.o2.dial(address),
          strangerDirectAddr,
        )
        expect(reached).toBe(strangerNode.peerId)
        expect(await page.evaluate(() => window.o2.peers())).toContain(strangerNode.peerId)

        await page.evaluate(async () => window.o2.stop()).catch(() => {})
      } finally {
        await browser?.close().catch(() => {})
      }
    }, 420_000)
  }
})
