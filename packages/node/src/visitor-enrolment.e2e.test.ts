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
import type { IdentityProtection } from '@o2/libp2p'
import { KERNEL_TRUST_ANCHOR } from '@o2/demo'
import { launchFixtureBrowser } from './e2e-browser-launch.ts'
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
 * the standing ruling at `vitest.config.ts` binds here as it does everywhere else.
 *
 * **This paragraph ended *"and this says nothing about whether the tab's *own* verifier
 * excludes an unverified peer off the wire; `tab-pinning.e2e.test.ts` owns that reading"*
 * until 2026-08-18, and the second case below is what made it false.** The sentence is
 * quoted rather than deleted because it was true when written and it names precisely what
 * was missing. `tab-pinning.e2e.test.ts` still owns the reading for a tab pinned by the
 * driving test; what it structurally cannot own is a tab pinned by a decision **a visitor
 * made with the mouse**, because it hands the page `enrollment` as harness-named key
 * material — the same move this file's header objects to two paragraphs above. The second
 * case joins the two halves: the clicks write the certificate, and a harness on the SAME
 * ORIGIN reads the issuer back out of IndexedDB with the production helper and pins it.
 *
 * ## Why the second case restarts through `window.o2capability` and does not grow `TabApi`
 *
 * The reading needs `verifiedPeers()` and `fetchBlock()`, and `TabApi` carries neither.
 * `capability-harness.ts`'s own docblock has already ruled on that: putting the node
 * configuration a measurement wants onto `TabApi` *"would put node configuration on the
 * page's own contract to serve a test"*, and `tab-api.ts` records the same rule. The route
 * the harness takes instead costs nothing, because `seed-server.ts` roots its Vite server at
 * the repository root — so `/packages/browser/harness/capability.html` is served by the
 * **seed process, on the same host and the same port** as the demo page. Same origin, same
 * IndexedDB. The visitor's certificate is written by the clicks and read by the harness
 * without either side naming a key.
 *
 * **The harness restart passes no `enrollment`, and that is required rather than tolerated.**
 * A visitor's key is minted in the browser with `extractable: false`, so no driver can
 * supply it — which is the whole reason `gated-seed.e2e.test.ts` cannot make this reading at
 * all. `resolveCertificate` opens with `if (enrollment === undefined) return null`, so the
 * restarted tab holds no certificate of its own; that is correct and not a gap, because the
 * block source keys on `trustedIssuers`, and `enrolledIssuer` reads those straight out of
 * the store the clicks wrote.
 *
 * ## The fail-open is why the second case has two arms rather than one
 *
 * `peer-verifier.ts`'s `verifiedPeers` returns the connected set **unchanged, with no verdict
 * computed and no `records` request issued**, when the pinned set is empty — a deliberate
 * fail-open, because a fail-closed empty set would empty the block source of the relay that
 * is a fresh tab's only peer. So a version of this case that forgot to enrol would fetch both
 * blocks and pass while proving nothing. The control arm runs FIRST, against a store nothing
 * has ever enrolled under, and takes the uncertificated peer's block — so the `null` in the
 * arm below it is a change in one instrument rather than the only value it has ever shown.
 */

const SEED = fileURLToPath(new URL('./bin/seed.ts', import.meta.url))
const PAGE_PATH = '/packages/browser/demo/index.html'

/**
 * The test-only harness page, served by the SAME seed process on the SAME port.
 *
 * `seed-server.ts` roots its Vite dev server at the repository root, so this path and
 * {@link PAGE_PATH} share an origin and therefore an IndexedDB. That is the whole mechanism
 * by which a certificate obtained by clicking can be read back by something that can see
 * `verifiedPeers` and the block source, and it is why no new page and no new server exist
 * here.
 */
const HARNESS_PATH = '/packages/browser/harness/capability.html'

/**
 * The store `autoStart` uses, and therefore the one the visitor's clicks write into.
 *
 * Spelled out rather than imported because `demo/main.ts` states it as a literal default on
 * `autoStart` and exports nothing that names it. It is not asserted against itself: the
 * premise reading below requires `enrolledIssuer(DEMO_STORE)` to be the provider's key, so a
 * demo that started storing under a different name reddens rather than passing quietly.
 */
const DEMO_STORE = 'o2-blocks'

/**
 * A store nothing has ever enrolled under — the control arm, and the ONE variable.
 *
 * Everything else about the two arms is identical: same page, same engine, same relay, same
 * two peers, same two blocks, same `enrolledIssuer` call deciding the anchor set. What
 * differs is which origin-storage that call reads, and therefore whether it answers with the
 * provider or with `null` — which is exactly the difference between a returning visitor and
 * a first-time one.
 */
const FRESH_STORE = 'o2-blocks-a-visit-that-never-enrolled'

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
/** How long a verified set is given to settle. Each verdict is an RPC round trip. */
const SETTLE_MS = 30_000

/**
 * The certificated peer's own user key — the **private** half, which signs the owner proof.
 *
 * Seed 76. Re-grepped across every `fill(n)` site in `packages/` and `tools/` on 2026-08-18:
 * 75 and 77 are taken, 76 is free.
 */
const MEMBER_USER_PRIVATE_KEY = new Uint8Array(32).fill(76)
const MEMBER_OPERATOR_ID = 'wharf-road-members'

/**
 * The two payloads, distinguishable by length alone.
 *
 * Different sizes on purpose, for the reason `tab-pinning.e2e.test.ts` gives for the same
 * pair: `fetchBlock` reports a byte count, so a fetch that somehow returned the OTHER peer's
 * block shows up as the wrong number rather than passing as a generic success.
 */
const STRANGER_BYTES = new Uint8Array(48).fill(11)
const MEMBER_BYTES = new Uint8Array(96).fill(13)

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
let strangerAddr: string
let strangerCid: string
let memberNode: FabricNode | undefined
let memberAddr: string
let memberCid: string
let seed: Seed | undefined
let pageUrl: string
let harnessUrl: string
let seedRelayAddr: string

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
/**
 * AUTH-06 — stated because the fixture below restarts provider on its own directory and
 * refuses if the issuer key moved.
 *
 * Plan 42-02 made `FabricNodeOptions.identityProtection` default to `writes-no-new-secret`, so
 * a node told nothing persists no secret and mints a fresh provider key on every start. The
 * refusal a few lines down would then fire for a reason about identity rather than about the
 * gate this file measures. Persistence is asked for; the refusal is left as strict as it was.
 */
const PERSISTS: IdentityProtection = { kind: 'passphrase', passphrase: 'visitor-enrolment-spec-passphrase' }

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
    await new Promise((r) => setTimeout(r, 250))
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

/**
 * Wait until `#join`'s start has actually produced a node — **not** until it stored a key.
 *
 * **This exists because a race that was always in the first case below started losing on
 * 2026-08-18, and the fixture that exposed it did not cause it.** `enrolmentOffer().heldIssuer`
 * reads the *stored certificate*, which `BrowserNode.start` persists during the enrolment
 * round trip — well before `api.start` assigns `node`. A read of `window.o2.addresses()`
 * taken the instant the issuer appears therefore lands inside `api.start` and throws
 * `node not started`, with `#state` still reading *"starting node and reserving on the
 * relay…"* — which is what a diagnostic read of that element printed.
 *
 * Measured rather than reasoned about, because "it passes at HEAD" is a claim to check: the
 * file as it stood at `f76c925` won that sample **three times out of three**, and with the
 * second case's fixture in the tree it lost **two times out of three**, always in firefox and
 * always on the same line. Nothing about the assertion changed; the interval either side of
 * it did.
 *
 * `activity()` is the probe because it answers `null` while `node` is null and never throws,
 * so waiting on it is a reading rather than a swallowed exception. A `sleep` would have been
 * the other repair and is the wrong one — it encodes this machine's load into the file.
 */
async function untilNodeRunning(tab: Page): Promise<void> {
  await expect
    .poll(async () => tab.evaluate(() => window.o2.activity() !== null), {
      timeout: ADMIT_BUDGET_MS,
    })
    .toBe(true)
}

/**
 * What `demo/main.ts#start` would pin if a visitor started a node on this origin right now.
 *
 * The production helper itself, called in a real engine against the IndexedDB a real
 * enrolment wrote — not a reimplementation of it. Deliberately routed through the harness
 * rather than through a started node: the whole question it answers is what a tab knows
 * *before* it starts.
 */
async function pinnedFor(tab: Page, blockstoreName: string): Promise<string | null> {
  return tab.evaluate(async (name) => window.o2capability.enrolledIssuer(name), blockstoreName)
}

/**
 * Start the harness tab, taking its anchor set the way production takes it.
 *
 * The two lines inside are `demo/main.ts#start`'s own: read the issuer THIS ORIGIN enrolled
 * with, and pass nothing at all when there is none. Nothing here names a key — the argument
 * list carries a store name, the build authority and the relay address, and no certificate
 * issuer at all. That is what makes the difference between the two arms a property of the
 * visitor's own storage rather than of this file.
 *
 * `relayAddrs` is the spawned seed, always, so the tab meets the real gated relay inside
 * `start` exactly as a visitor does. The tab passes no `enrollment` and so holds no
 * certificate, which means the seed refuses it a reservation and keeps the connection —
 * `gated-seed.e2e.test.ts` measures that pair directly. A connected peer holding no
 * certificate is the shape this case is about, so the relay being one is not a wrinkle.
 */
async function harnessStart(tab: Page, blockstoreName: string): Promise<string> {
  return tab.evaluate(
    async ([name, anchor, relayAt]) =>
      window.o2capability.start({
        relayAddrs: [relayAt],
        blockstoreName: name,
        trustAnchors: [anchor],
        trustedIssuers: await window.o2capability
          .enrolledIssuer(name)
          .then((issuer) => (issuer === null ? [] : [issuer])),
        sovereignty: { ownerId: '', canExecuteSovereign: false },
        whenSeedIsGone: 'mints-a-new-identity',
        // AUTH-06 — the subject of both arms is which issuer this origin's own storage
        // names, which is read off the stored CERTIFICATE and not off the seed. The
        // certificate is deliberately not sealed, so it survives a `writes-no-new-secret`
        // tab exactly as it survived before; the two arms use two different store names and
        // neither asserts a peer id across a start. See the amended note at the demo→harness
        // hand-off above for what this changes and what it does not.
        identityProtection: { kind: 'writes-no-new-secret' },
      }),
    [blockstoreName, KERNEL_TRUST_ANCHOR, seedRelayAddr] as const,
  )
}

/** Meet a peer after start, as an ordinary peer is met — see the harness's own docblock. */
async function harnessDial(tab: Page, address: string): Promise<string> {
  return tab.evaluate(async (at) => window.o2capability.dial(at), address)
}

async function harnessPeers(tab: Page): Promise<string[]> {
  return tab.evaluate(() => window.o2capability.peers())
}

async function harnessVerified(tab: Page): Promise<string[]> {
  return tab.evaluate(() => window.o2capability.verifiedPeers())
}

/**
 * Ask the tab's **fetching** tier for a block and report how many bytes came back.
 *
 * This is the off-the-wire reading and the reason the case cannot be satisfied from a page
 * variable. `BrowserNode.blockstore` is the `FetchingBlockstore` composed over
 * `RpcBlockSource(rpc, () => verifier.verifiedPeers)`, so a number here is bytes that
 * crossed a real connection from a peer that really holds them, and a `null` is the absence
 * of any peer the gate would ask. `verifiedPeers()` says what the verifier *thinks*; only
 * this says what the composed node *does with it*, and the two fail independently.
 */
async function harnessFetch(tab: Page, cid: string): Promise<number | null> {
  return tab.evaluate(async (c) => window.o2capability.fetchBlock(c), cid)
}

async function harnessStop(tab: Page): Promise<void> {
  await tab.evaluate(async () => window.o2capability.stop())
}

beforeAll(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'o2-visitor-enrol-'))
  await startProvider()
  seed = await startSeed(join(workdir, 'seed'))
  pageUrl = `http://127.0.0.1:${seed.httpPort}${PAGE_PATH}`
  harnessUrl = `http://127.0.0.1:${seed.httpPort}${HARNESS_PATH}`
  seedRelayAddr = `/ip4/127.0.0.1/tcp/${seed.wsPort}/ws/p2p/${seed.peerId}`

  // The control that makes every positive reading below non-vacuous: same relay, alive
  // throughout, holding no certificate. It pins the same issuer itself, so this fixture
  // holds no relay-capable peer that admits everybody.
  strangerNode = await FabricNode.start({
    relayAdmission: new Set<PublicKeyHex>([providerIssuer]),
    startReporting: 'reports-its-own-start',
    blockstoreDir: join(workdir, 'stranger'),
    listen: ['/ip4/127.0.0.1/tcp/0/ws'],
    relayAddrs: [seedRelayAddr],
    trustAnchors: TRUST_ANCHORS,
  })
  strangerAddr = directWsAddr(strangerNode)

  // **The certificated peer — identical to `strangerNode` in every field but `enrollment`.**
  //
  // Same class, same transports, same listen address, same relay, same admission posture, so
  // an exclusion in the second case below cannot be an artefact of a kind of node. It enrols
  // with the separated provider, which is the same provider the visitor's clicks reach and
  // therefore the same issuer the tab ends up pinning — a peer certificated by somebody else
  // would measure the wrong thing.
  memberNode = await FabricNode.start({
    relayAdmission: new Set<PublicKeyHex>([providerIssuer]),
    startReporting: 'reports-its-own-start',
    blockstoreDir: join(workdir, 'member'),
    listen: ['/ip4/127.0.0.1/tcp/0/ws'],
    relayAddrs: [seedRelayAddr],
    trustAnchors: TRUST_ANCHORS,
    enrollment: {
      userPrivateKey: MEMBER_USER_PRIVATE_KEY,
      operatorId: MEMBER_OPERATOR_ID,
      providerAddr,
    },
  })
  memberAddr = directWsAddr(memberNode)

  // One block into each peer's **local** store, which is the tier `serveAgent` answers a
  // `block` request from. `put` on a `FetchingBlockstore` writes the local tier.
  strangerCid = (await strangerNode.blockstore.put(STRANGER_BYTES)).toString()
  memberCid = (await memberNode.blockstore.put(MEMBER_BYTES)).toString()
}, 300_000)

afterAll(async () => {
  await memberNode?.stop().catch(() => {})
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
        browser = await launchFixtureBrowser(type)
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
        //
        // The join is still in flight when the issuer above appears — see
        // {@link untilNodeRunning} for the measurement. Waited for rather than sampled.
        if (page === undefined) throw new Error('no page')
        await untilNodeRunning(page)
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

  /**
   * **AUTH-02's browser leg, off the wire, on a tab a visitor enrolled with the mouse.**
   *
   * The case above establishes that the clicks produce a certificate and get the tab through
   * a closed door. It says nothing about what the tab then *does* with the issuer it
   * obtained, and until 2026-08-18 nothing in this repository did: `tab-pinning.e2e.test.ts`
   * makes the fetching reading but starts its tab through the harness with key material it
   * generated, and this file clicked but read only `heldIssuer` and `/bootstrap.json`.
   *
   * The three clicks below are a **precondition, not the subject** — what they establish is
   * asserted in the case above and is not restated. They are here because they are the only
   * way to obtain the one input this case is about, and because nothing else in this
   * repository can produce it: the visitor's key is minted in the browser as
   * non-extractable, so no driver can hand a page an enrolment the way `gated-seed` does.
   *
   * ## The instrument, and why a page variable would not carry the claim
   *
   * Two peers, alive since `beforeAll`, differing in the `enrollment` option and in nothing
   * else, each holding one block of its own in its **local** store. The tab is asked for both
   * through `BrowserNode.blockstore`. A byte count is bytes that crossed a real connection; a
   * `null` is the gate declining to ask anybody. `verifiedPeers()` is asserted beside them
   * and is the weaker of the two readings — a getter can be right while the block source
   * reads something else entirely, which is the gap that left the composition line witnessed
   * by a source-text count for a day.
   *
   * ## The contrast is the proof
   *
   * Arm A pins nobody, because it names a store nothing has enrolled under, and takes the
   * uncertificated peer's block. Arm B pins what the clicks stored, and does not. Same page,
   * same engine, same relay, same two peers, same two blocks, same production `enrolledIssuer`
   * call choosing the anchor — one variable. Without arm A, arm B's `null` would be satisfied
   * just as well by a peer that does not serve blocks, a CID that names nothing, or a
   * `fetchBlock` that is broken.
   */
  it(
    'and the tab it enrolled will not take a block from a connected peer holding no certificate',
    async () => {
      let browser: Browser | undefined
      let page: Page | undefined
      try {
        browser = await launchFixtureBrowser(type)
        page = await browser.newPage()
        const tab = page
        tab.on('pageerror', (error) => {
          process.stderr.write(`[${name}] page error: ${error.message}\n`)
        })
        tab.on('console', (message) => {
          if (message.type() === 'error') {
            process.stderr.write(`[${name}] console: ${message.text()}\n`)
          }
        })

        // ---- the precondition: the same three clicks, and no argument crosses into the page.
        await tab.goto(pageUrl)
        await tab.waitForFunction(() => typeof window.o2 !== 'undefined', null, { timeout: 60_000 })
        await tab.locator('#allow').click()
        await tab.locator('#enrol-offer').waitFor({ state: 'visible', timeout: 60_000 })
        await tab.locator('#enrol').click()
        await expect
          .poll(async () => tab.evaluate(async () => (await window.o2.enrolmentOffer()).accepted), {
            timeout: 60_000,
          })
          .toBe(true)
        await tab.locator('#join').click()
        await expect
          .poll(
            async () => tab.evaluate(async () => (await window.o2.enrolmentOffer()).heldIssuer),
            { timeout: ADMIT_BUDGET_MS },
          )
          .toBe(providerIssuer)

        // Waited for, then released. The issuer above appears INSIDE `api.start`, so a stop
        // issued on it would be a stop of a node that does not exist yet — `TabApi.stop` is
        // a no-op against `node === null` and would leave the start running into a page this
        // case is about to navigate away from. See {@link untilNodeRunning}.
        //
        // Released before a second node starts on the same identity store.
        //
        // **AMENDED 2026-09-04 (AUTH-06).** This read *"a tab's identity lives in IndexedDB
        // rather than in the tab, so the harness restart below reloads THIS node rather than
        // minting a second one."* That is no longer true and was never what this case reads:
        // a visitor is asked for no passphrase, so a demo tab now writes no seed at all and
        // the harness start below is a different node. What the arms below actually depend
        // on is the stored **certificate**, which is public material and deliberately not
        // sealed — `pinnedFor` reads its `issuer` and nothing here compares a peer id across
        // a start. `42-04` is where a visitor is asked and where the identity becomes durable
        // again.
        await untilNodeRunning(tab)
        await tab.evaluate(async () => window.o2.stop())

        // ---- same origin, different page: same host, same port, therefore same IndexedDB.
        await tab.goto(harnessUrl)
        await tab.waitForFunction(() => typeof window.o2capability !== 'undefined', null, {
          timeout: 60_000,
        })

        // **The premise of both arms, read with the production helper in the engine.** What
        // the clicks wrote is what `demo/main.ts#start` would pin; a store nothing enrolled
        // under has nothing to pin. If the demo ever stores under another name, this is where
        // it reddens rather than the arms below quietly measuring two unpinned tabs.
        expect(await pinnedFor(tab, DEMO_STORE)).toBe(providerIssuer)
        expect(await pinnedFor(tab, FRESH_STORE)).toBeNull()

        // ---- arm A — THE CONTROL, and it runs first. ------------------------------------
        await harnessStart(tab, FRESH_STORE)
        const strangerId = await harnessDial(tab, strangerAddr)
        const memberId = await harnessDial(tab, memberAddr)
        expect(strangerId).toBe(strangerNode?.peerId)
        expect(memberId).toBe(memberNode?.peerId)

        await expect
          .poll(async () => (await harnessPeers(tab)).length, { timeout: SETTLE_MS })
          .toBeGreaterThanOrEqual(2)

        // Pinning nobody means verifying nobody, which `PeerVerifier` reads as taking
        // everybody — the early return in `verifiedPeers`. Stated as a reading rather than
        // left implied, because it is the premise of the two fetches under it.
        const unpinned = await harnessVerified(tab)
        expect(unpinned).toContain(strangerId)
        expect(unpinned).toContain(memberId)

        expect(await harnessFetch(tab, strangerCid)).toBe(STRANGER_BYTES.length)
        expect(await harnessFetch(tab, memberCid)).toBe(MEMBER_BYTES.length)

        await harnessStop(tab)

        // ---- arm B — THE MEASUREMENT. One field different: which store the anchor came from.
        await harnessStart(tab, DEMO_STORE)
        expect(await harnessDial(tab, strangerAddr)).toBe(strangerId)
        expect(await harnessDial(tab, memberAddr)).toBe(memberId)

        // Each verdict is an RPC round trip, so the certificated peer's arrival in the
        // verified set is polled for. A read taken before it settles is "not asked yet",
        // which is not the claim being made.
        await expect
          .poll(async () => harnessVerified(tab), { timeout: SETTLE_MS })
          .toContain(memberId)

        // The uncertificated peer is connected throughout, and excluded.
        //
        // **`soft`, and that is the difference between watching a plant and inferring one.**
        // These two are the weaker reading — a getter can be right while the block source
        // reads something else — and a hard failure here would abort the case before the two
        // fetches under it ran, so the off-the-wire assertions this row actually turns on
        // would never be watched failing. Measured: forcing `verifiedPeers`' empty-set
        // fail-open to be taken while an issuer is pinned reddens the getter line AND
        // *"expected null to be 48"* on the fetch, in one run, in all three engines. Hard
        // assertions here made the second half invisible.
        expect.soft(await harnessPeers(tab)).toContain(strangerId)
        expect.soft(await harnessVerified(tab)).not.toContain(strangerId)

        // **Off the wire, and this pair is the claim.** The two lines above say what the
        // verifier thinks; these two say what the composed node does with it. A block held
        // only by the excluded peer does not arrive, and a block held only by the verified
        // one does — through the same `FetchingBlockstore`, in the same tab, in the same
        // second. Neither is readable from a page variable: `null` here is the gate declining
        // to ask anybody, and `96` is bytes that crossed a real connection.
        expect(await harnessFetch(tab, strangerCid)).toBeNull()
        expect(await harnessFetch(tab, memberCid)).toBe(MEMBER_BYTES.length)

        await harnessStop(tab)
      } finally {
        await page?.close().catch(() => {})
        await browser?.close().catch(() => {})
      }
    },
    CASE_TIMEOUT_MS,
  )
})
