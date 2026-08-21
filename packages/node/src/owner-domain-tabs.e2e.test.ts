import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import type { Browser, BrowserContext, Page } from 'playwright'
import { createServer } from 'vite'
import type { Plugin, ViteDevServer } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { describeAttestation } from '@o2/core'
import type { PublicKeyHex } from '@o2/core'
import { KERNEL_RECORD, KERNEL_TRUST_ANCHOR, kernelBytes } from '@o2/demo'
import type { TabNameRecord } from '@o2/browser'
import { FabricNode } from './fabric-node.ts'

/**
 * **Criterion 5, closed: `owner-domain` rendered on a page for a SOVEREIGN shard.**
 *
 * ## What was left open, and by what
 *
 * `attestation-ui.e2e.test.ts` renders `owner-domain` — on `label: 'public'` work. Its
 * criterion-5 case renders a sovereign shard — and reads the *refusal*
 * `no capability chain supplied`, because nothing on the demo built a chain. AUTH-03's
 * browser half then landed (`chainsForOwner`), and **that case did not redden**, which is
 * the fact this file exists to explain and to finish.
 *
 * The explanation is `.planning/consults/2026-08-20-a-tab-owner-can-only-have-tab-nodes.md`
 * and it is one property with a long shadow: **a visitor's owner key is minted
 * `extractable: false`, so no Node process can ever enrol as that owner.** Every sovereign
 * fixture in this repository builds an owner's two machines as Node processes sharing a
 * private key held in the test — `sovereign-agent.e2e.test.ts`,
 * `sovereign-aggregation.node.test.ts`, and `attestation-ui.e2e.test.ts`'s own criterion
 * case. That shape is **unavailable** to a tab's owner. A chain rooted at a key the tab
 * cannot sign for is not a chain, and `chainsForOwner` answers `null` rather than minting
 * one that would come back `wrong-root`.
 *
 * ## So the owner's machines are tabs, and they are tabs of one profile
 *
 * `visitor-key.ts` keeps the key in a database **deliberately not derived from
 * `blockstoreName`**, and says why in place: *"Two tabs running as two nodes in one profile
 * are two seeds and **one** visitor."* That sentence is this fixture's whole topology.
 * `IdbIdentityStore` is suffixed off the blockstore name, so distinct `blockstoreName`s give
 * distinct node identities inside one origin; the visitor key is shared across them because
 * a browser profile is one person. Three tabs of one `BrowserContext` are therefore three
 * nodes of **one owner under one operator id** — which is exactly what `classifyAttestation`
 * calls `owner-domain`.
 *
 * ## Three tabs, and the third is not spare
 *
 * `classifyAttestation` returns `owner-attested` for `<= 1` agreeing replica and
 * `owner-domain` only at two or more under one operator. The submitter cannot supply one of
 * those two: `attestedNodes` gives a discovered descriptor only to a **peer**, and
 * `discoveredPool` filters this tab out of the pool by `nodeId !== n.peerId`, so the
 * submitter's own descriptor falls back to `ownerId: 'public'` and `eligibleNodes` — which
 * places a sovereign shard only where the owner ids are **equal** — passes it over however
 * `includeSelf` is set. **A two-tab fixture reads `owner-attested`, correctly, and would
 * not close this criterion.** The task that opened this work said "two-tab" and the consult
 * said "two pages"; both were arithmetic taken on trust, and both are corrected in place.
 *
 * ## Nothing here is configured that enrolment does not establish
 *
 * No `sovereignty` is passed anywhere — `TabApi.start` carries none, by a rule stated at
 * `tab-api.ts:816`, and this file does not want one. A tab that enrolled with its own key
 * **is** an owner node of that owner: `fabric-node.ts` publishes
 * `sovereignFor: [certificate.userKey]`, and `discover-candidates.ts:233` builds each
 * descriptor with `ownerId: executor.certificate.userKey`. The owner relation falls out of
 * enrolment. The harness supplies **no key material at all** — that is the point, and it is
 * enforced by `visitor-key.ts` having no parameter through which any could arrive.
 *
 * ## The owner id is read off the fabric, not held by the harness
 *
 * This test cannot know the visitor key: it is generated in the browser and the private half
 * cannot be exported. So it is read back out of `lastCandidates().owners` — the lookup's own
 * answer about who the qualified peers belong to — and typed into the form.
 *
 * **That is not circular, and the reason is `chainsForOwner`.** Feeding a key back in proves
 * nothing by itself; but the chain is minted only when the fed key **equals the signer's
 * own**, and the signer is `subtleUserSigner(await visitorKeyPair())` — this tab's key, not
 * anything the harness passed. So a wrong key produces `null`, no chain, and the refusal
 * `attestation-ui.e2e.test.ts` already reads. Reaching `owner-domain` requires the key read
 * off the peers to be the same key the submitting tab can sign for, which is the claim.
 *
 * ## Sequential, never `Promise.all`, and the reason is a filed defect
 *
 * Task #49 records `loadSeed() -> generateSeed() -> saveSeed()` with no transaction and no
 * cross-tab coordination. `visitorKeyPair()` has the same read-then-write shape one layer
 * out. Three tabs racing a fresh origin can mint two visitor keys, last-write-wins, and this
 * fixture would then read `independent` — a true reading of a fabric that is not the one it
 * meant to build. Tabs are opened, consented, enrolled and started **one at a time**.
 *
 * ## What this fixture proves it can fail on
 *
 * Building it found a production gap rather than a fixture one: **every demo tab published
 * `sovereignFor: []` and `canExecuteSovereign: false`, forever.** An owner-pinned shard was
 * therefore unplaceable on the owner's own device — the one place it is *supposed* to be
 * placeable — because `eligibleNodes` filters a non-public shard down to nodes whose
 * `ownerId` matches and which say they can execute sovereign work, and no tab said so.
 * `enrolledUserKey` closes it by deriving the fact from this origin's own stored
 * certificate, which is why it is not a new `TabApi.start` parameter: a page that was found
 * rather than configured must not become configurable by whatever found it.
 *
 * That line is what this case actually tests, and it was **planted to check**. Replacing
 * `main.ts`'s `sovereignty` spread with a disabled one turned this case red with, verbatim:
 *
 * ```
 * replicas: shard 0..7: no agreement
 * attestation: How strongly was it checked: nothing established. 0 replicas agreed on the
 *   least-attested cube … this shard is unplaceable rather than agreed
 * AssertionError: expected 'shard 0: no agreement…' not to contain 'no agreement'
 * ```
 *
 * Restored by the inverse of that edit and verified `cmp`-identical against a snapshot taken
 * immediately before the plant. Note what the red does **not** say: not
 * `no capability chain supplied`. The chain is minted either way — the plant removes the
 * *eligibility*, not the authority — so this case is failing on the thing it names.
 *
 * The same run also caught a **false sentence on the demo surface**, filed rather than fixed
 * here: eight unplaced shards were printed under `failures: No refusals: every shard reached
 * agreement.` A shard that was never placed reaches neither the `disagreed` nor the
 * `insufficient` arm, so the failure list is legitimately empty and the renderer reads empty
 * as universal success. The attestation line beside it gets it right in the same render.
 *
 * ## What this file does not claim
 *
 * One host, one kernel, one chromium instance and one browser profile. These are three
 * nodes and they are **not** three machines — which is precisely the honest content of
 * `owner-domain`: replicated across the owner's own nodes, *not* across operators. The
 * label being the middle one rather than `independent` is the fixture telling the truth
 * about its own topology.
 *
 * Vite's dev server rather than a built bundle: `attestation-ui.e2e.test.ts` records that
 * `vite build` is already run by three serial specs in this project, and the subject here is
 * the label rather than the artifact — `static-rendezvous.e2e.test.ts` reads the built
 * bundle across three engines and this adds nothing to that. What the dev server does give
 * is a middleware, which is how `/bootstrap.json` reaches the page: `enrollmentProvider` is
 * carried nowhere else, and `discoverRelays` reads it from the origin that served the page.
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const PAGE = 'packages/browser/demo/index.html'

/** The three sentences the kernel owns. Compared against, never transcribed. */
const OWNER_ATTESTED = describeAttestation('owner-attested')
const OWNER_DOMAIN = describeAttestation('owner-domain')
const INDEPENDENT = describeAttestation('independent')

/** The value a descriptor carries when nothing is known about whose node it is. */
const OWNER_THE_NODES_DECLARE = 'public'

/** Page load, wasm init, relay reservation, enrolment round trip, node start. */
const TAB_BUDGET_MS = 180_000
/** The dispatch this file reads, through the page's own form. */
const DISPATCH_BUDGET_MS = 900_000
/**
 * How many warm-up dispatches the fabric is given to converge, and the interval between them.
 *
 * **Not a sleep and not a guess.** An enrolled tab pins its provider and fetches a block only
 * from a peer it has verified, and that verification is one `records` round trip whose first
 * attempt has been measured going unanswered for the full RPC budget — `peer-verifier.ts`
 * records the identical observation independently, and its 5 s retry floor exists precisely
 * because the correct verdict is reached by re-asking. Measured on this fixture: the fabric
 * converged on the **ninth** dispatch, with the whole case at ~28 s wall clock. The ceiling
 * is a little over twice that, so a converging run is never cut off and a wedged one is a
 * named failure rather than a timeout.
 */
const WARM_ATTEMPTS = 20
const WARM_INTERVAL_MS = 3_000
/**
 * How many inputs the warm-up places on both peers.
 *
 * `byoShardsFor(peers)` is `2 * (1 + peers)`, and the page counts the relay among its peers,
 * so the sovereign run below names 8. Twelve is that with headroom, because the count is the
 * page's to decide and a fixture that tracked it exactly would break on a change to a formula
 * it is not about. Warming *more* than the run names costs two extra dispatched shards and
 * removes a whole class of confusing failure.
 */
const WARM_SHARDS = 12

/**
 * Whole-case budget. Absolute, and sited: it is there to turn a hang into a named failure
 * rather than to measure anything, and it is the sum of the three above with room over.
 */
const CASE_TIMEOUT_MS = 1_800_000

let workdir: string
let relay: FabricNode | undefined
let relayAddr: string
let provider: FabricNode | undefined
let providerAddr: string
let server: ViteDevServer | undefined
let browser: Browser | undefined
let context: BrowserContext | undefined
let pageUrl: string
const pages: Page[] = []

/** A node's own listening WebSocket address — never a circuit, which also matches `/ws`. */
function directWsAddr(node: FabricNode, name: string): string {
  const found = node.browserDialableAddrs.find((address) => !address.includes('/p2p-circuit'))
  if (found === undefined) {
    throw new Error(`${name} produced no direct /ws address; multiaddrs=${JSON.stringify(node.multiaddrs)}`)
  }
  return found
}

/**
 * `/bootstrap.json`, served by the origin that serves the page.
 *
 * The fourth hop of the flow `visitor-enrolment.e2e.test.ts` walks end to end from the real
 * `bin/seed.ts`. That binary is not spawned here because this file's subject is downstream
 * of it and that one already reads it off the wire; what is needed here is only that the
 * page be *offered* a provider, which is what a static host publishing this file does.
 */
function bootstrapPlugin(): Plugin {
  return {
    name: 'o2-owner-domain-bootstrap',
    configureServer(dev: ViteDevServer) {
      dev.middlewares.use((request, response, next) => {
        if ((request.url ?? '').split('?')[0] !== '/bootstrap.json') {
          next()
          return
        }
        response.setHeader('content-type', 'application/json')
        response.end(
          JSON.stringify({ relayAddrs: [relayAddr], enrollmentProvider: providerAddr }),
        )
      })
    },
  }
}

/** The kernel record in the shape that survives `page.evaluate`. See `TabNameRecord`. */
function kernelTabRecord(): TabNameRecord {
  return { ...KERNEL_RECORD, cid: KERNEL_RECORD.cid.toString() }
}

/**
 * Open one tab of the shared context, walk the visitor's own path, and start its node.
 *
 * **`#allow` and `#enrol` are conditional and that is a reading, not a convenience.** Tabs
 * two and three arrive at an origin that already holds both answers, so the gate is not
 * rendered and the offer is already accepted — the same storage sharing that gives them one
 * visitor key. Clicking unconditionally would time out on an element that is correctly
 * absent.
 *
 * `blockstoreName` is the one thing supplied per tab, and it is not key material: it selects
 * which node identity store this tab opens, exactly as `colouring-demo.e2e.test.ts` uses
 * `o2-colouring-a` and `-b`. Without it all three tabs would open `o2-blocks` and be one
 * node three times.
 */
async function openEnrolledTab(name: string, blockstoreName: string): Promise<string> {
  const ctx = context
  if (ctx === undefined) throw new Error('no browser context')
  const page = await ctx.newPage()
  pages.push(page)
  page.on('pageerror', (error) => {
    process.stderr.write(`[${name}] page error: ${error.message}\n`)
  })
  page.on('console', (message) => {
    if (message.type() === 'error') process.stderr.write(`[${name}] console: ${message.text()}\n`)
  })

  await page.goto(pageUrl)
  await page.waitForFunction(() => typeof window.o2 !== 'undefined', null, { timeout: TAB_BUDGET_MS })

  // BROW-01 has no test-only bypass — this is the real control a visitor presses. Only the
  // first tab of the profile is shown it.
  if (await page.isVisible('#gate')) await page.click('#allow')
  await page.waitForFunction(
    () => document.getElementById('main')?.hasAttribute('hidden') === false,
    null,
    { timeout: TAB_BUDGET_MS },
  )

  // The origin must have named a provider before there is anything to accept.
  await expect
    .poll(async () => (await page.evaluate(async () => window.o2.enrolmentOffer())).offered, {
      timeout: TAB_BUDGET_MS,
    })
    .toBe(true)

  const offer = await page.evaluate(async () => window.o2.enrolmentOffer())
  if (!offer.accepted) {
    await page.click('#enrol')
    await expect
      .poll(async () => (await page.evaluate(async () => window.o2.enrolmentOffer())).accepted, {
        timeout: TAB_BUDGET_MS,
      })
      .toBe(true)
  }

  // ---- Start twice, and the second start is not a retry.
  //
  // `enrolledIssuer` and `enrolledUserKey` both read a certificate **a previous start
  // stored**, because the certificate this start is about to obtain does not exist while
  // `BrowserNodeOptions` is being composed — `PeerVerifier.start` is built before
  // `resolveCertificate`, deliberately, so the enrolment dial reaches a live listener. So
  // the enrolling start is cleared for nobody and every later one is an owner node of its
  // own owner. `enrolledIssuer` has had that shape since Phase 22 and says why it is right
  // rather than merely tolerated; this fixture is the first to need the second start, and
  // it needs it because a tab that is not cleared is not placeable for its owner's shard.
  //
  // The node seed persists under `blockstoreName`, so the peer id survives the restart and
  // the id asserted below is the id that runs. Reservations and `/webrtc` addresses do not
  // survive it, which is why every dial in this file happens after every restart.
  //
  // `api.start` has a single throw site for all three certificate failures, so reaching the
  // line after the first start means this tab holds one.
  const enrolling = await page.evaluate(
    async (store) => window.o2.autoStart({ blockstoreName: store }),
    blockstoreName,
  )
  if (enrolling.peerId === '') throw new Error(`${name} started no node`)
  await page.evaluate(async () => window.o2.stop())

  // Reloaded rather than restarted in place, and **the reason is fidelity, not a fix**. A
  // visitor who enrols comes back to the page; this reproduces that.
  //
  // It was put here as a fix, and the attribution was wrong. The failing runs showed
  // `unreachable: closed: rpc endpoint closed` on every verification the peers attempted,
  // and the theory was that a second `start` in one JS context leaves the stopped node's
  // relay reservation behind for a dialling peer to be handed. Adding the reload and the
  // reverse dial together turned the fixture green, and the reload was given the attribution.
  //
  // **A control run took it back.** With the reload removed and the mutual dial kept, this
  // case converged on the same tenth warm-up attempt and passed in 32.9 s against 34.3 s —
  // no difference outside the noise. What the probes actually established is the *dial*: an
  // issuer-pinning tab fetches blocks only from peers it has verified, verification is a
  // `records` request the executor makes **back** to the submitter, and those verdicts were
  // failing because nothing had dialled that direction. `two-tabs.e2e.test.ts` never needed
  // the reverse leg because nothing there pins an issuer.
  //
  // So the reload stays for what it does honestly represent and claims nothing more.
  await page.reload()
  await page.waitForFunction(() => typeof window.o2 !== 'undefined', null, { timeout: TAB_BUDGET_MS })
  await page.waitForFunction(
    () => document.getElementById('main')?.hasAttribute('hidden') === false,
    null,
    { timeout: TAB_BUDGET_MS },
  )

  const cleared = await page.evaluate(
    async (store) => window.o2.autoStart({ blockstoreName: store }),
    blockstoreName,
  )
  if (cleared.peerId !== enrolling.peerId) {
    throw new Error(
      `${name} came back as a different node across its restart: ${enrolling.peerId} then ${cleared.peerId}`,
    )
  }
  return cleared.peerId
}

/**
 * Put the module and **every input the sovereign run will name** onto both peers, by running
 * them there as public work.
 *
 * ## This is the whole of what makes a sovereign shard runnable, and it is not a workaround
 *
 * A tab that submits sovereign data **refuses to serve it** — `submitJobWithEgress` takes a
 * job-scoped hold on those bytes and `submitJob` records the CID at the blockstore-put on a
 * set that outlives the job, which is what `tab-refusals.e2e.test.ts` reads. So an
 * owner-pinned shard cannot ship its input anywhere: it runs **where its data already is**.
 * That is *move code to data*, stated as a property of the wire rather than of a policy, and
 * `capability-harness.ts`'s `putBytes` says the same thing in its own words — *"seed the
 * owner's row into the node that owns it, before anything is dispatched"*. This function is
 * that seeding, done through the page's own front door.
 *
 * ## Why the shard count and the executor set are exactly these
 *
 * `includeSelf: false` with **two** executors and `redundancy: 2` places every shard on
 * **both** peers, so a completed run is a proof that both hold every input. `shards: 12`
 * covers `byoShardsFor(3) = 8` with headroom, and the values match because both this call
 * and `TabApi.runJob`'s own shard builder produce `{ a: i }` — the same value is the same
 * dag-cbor CID, which is the identity this relies on.
 *
 * **The honest subtlety, measured rather than reasoned about.** A first draft warmed with two
 * shards and the sovereign run then reached agreement on shards 0 and 1 and reported
 * `input block missing` for 2 through 7 — because `{a:0}` and `{a:1}` had already travelled,
 * *as public work*, under CIDs identical to the ones the sovereign run went on to declare.
 * A value dispatched public and later declared sovereign is the same block, and the fabric
 * cannot retract what already left. The run said so plainly: `violations: []`, `0 withheld`.
 */
async function warmUp(
  page: Page,
  label: string,
  peerIds: readonly string[],
): Promise<{ readonly replicas: readonly number[] }> {
  await page.evaluate(async (bytes) => window.o2.putModule(bytes), [...kernelBytes])
  const report = await page.evaluate(
    // `WARM_SHARDS` travels in the argument rather than being read from the closure: this
    // arrow is serialised and evaluated in the page, where nothing of this module exists.
    async ([cid, record, peers, shards]) =>
      window.o2.runJob({
        moduleCid: cid as string,
        moduleRecord: record as TabNameRecord,
        peerIds: peers as string[],
        shards: shards as number,
        redundancy: 2,
        // Excluded on purpose: with exactly two executors and redundancy two, every shard
        // lands on both peers. Including this tab would let it take a replica and leave a
        // peer without one, which is the one thing this warm-up must not do.
        includeSelf: false,
      }),
    [KERNEL_RECORD.cid.toString(), kernelTabRecord(), [...peerIds], WARM_SHARDS] as const,
  )
  // Printed rather than asserted on: a warm-up that placed nothing produces a *later*
  // failure about an empty candidate list, and the two are hard to tell apart without this.
  // Printed rather than asserted on: a warm-up that placed less than everything produces a
  // *later* failure about a missing input block, and the two are hard to tell apart without
  // this line.
  process.stderr.write(
    `[warm-up ${label}] complete=${String(report.complete)} replicas=${JSON.stringify(report.replicas)} ` +
      `failures=${JSON.stringify(report.failures)}\n`,
  )
  return { replicas: report.replicas }
}

/** One `[data-region]` inside `#s-byo`, by name. `attestation-ui.e2e.test.ts`'s helper. */
async function byoRegion(page: Page, id: string): Promise<string> {
  const text = await page.evaluate(
    (wanted) =>
      Array.from(document.querySelectorAll('#s-byo [data-region]')).find(
        (element) => element.getAttribute('data-region') === wanted,
      )?.textContent ?? null,
    id,
  )
  expect(text, `${id} is not on the byo surface at all`).not.toBeNull()
  return (text ?? '').trim()
}

/**
 * Press `Dispatch this module` and wait for the surface's own text view to be rewritten.
 *
 * The control is deliberately not the signal — the page's reconciler re-enables it on a
 * one-second tick, so waiting on it would return before the render.
 */
async function dispatchByo(page: Page, budgetMs: number): Promise<void> {
  await page.waitForFunction(
    () => document.getElementById('run-byo')?.hasAttribute('disabled') === false,
    null,
    { timeout: budgetMs },
  )
  const before = (await page.textContent('#byo-report')) ?? ''
  await page.click('#run-byo')
  await page.waitForFunction(
    (was) => (document.getElementById('byo-report')?.textContent ?? '') !== was,
    before,
    { timeout: budgetMs },
  )
}

/**
 * The one owner id that two or more qualified peers share.
 *
 * Not `owners[0]`: the relay is a `FabricNode` serving the agent protocol and can be
 * qualified alongside the tabs — `attestation-ui.e2e.test.ts` records that its own first
 * draft counted the relay in `computePeers()` and had to go relayless because of it. A
 * topology of tabs cannot go relayless, so the extraction is by **agreement between at least
 * two peers** rather than by position, and `public` is excluded by name because it is the
 * value a descriptor carries when nothing is known about whose node it is.
 */
function sharedOwnerOf(owners: readonly string[]): PublicKeyHex {
  const counts = new Map<string, number>()
  for (const owner of owners) {
    if (owner === OWNER_THE_NODES_DECLARE) continue
    counts.set(owner, (counts.get(owner) ?? 0) + 1)
  }
  const shared = [...counts.entries()].filter(([, count]) => count >= 2)
  if (shared.length !== 1) {
    throw new Error(
      `expected exactly one owner id held by two or more qualified peers; owners=${JSON.stringify(owners)}`,
    )
  }
  return (shared[0]?.[0] ?? '') as PublicKeyHex
}

beforeAll(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'o2-owner-domain-'))

  // Reservations comfortably above three tabs, so a refusal cannot be mistaken for a bug.
  relay = await FabricNode.start({
    relayAdmission: 'admits-any-peer',
    startReporting: 'reports-its-own-start',
    maxReservations: 16,
    blockstoreDir: join(workdir, 'relay'),
    listen: ['/ip4/127.0.0.1/tcp/0/ws'],
    // Pins the demo's own build authority, so if it is ever dispatched to it checks the
    // kernel's signed record exactly as the tabs do. Nothing here runs an unsigned artifact.
    trustAnchors: [KERNEL_TRUST_ANCHOR],
  })
  relayAddr = directWsAddr(relay, 'relay')

  // Separate from the relay, as `visitor-enrolment.e2e.test.ts` separates them: the address
  // a joiner knocks at is not the address it reserves on, and conflating the two would make
  // this fixture unable to tell a reservation failure from an issuance failure.
  provider = await FabricNode.start({
    relayAdmission: 'admits-any-peer',
    startReporting: 'reports-its-own-start',
    blockstoreDir: join(workdir, 'provider'),
    listen: ['/ip4/127.0.0.1/tcp/0/ws'],
    trustAnchors: [KERNEL_TRUST_ANCHOR],
    // What gives it a signing key at all. `DEFAULT_MAX_PER_WINDOW` is 32 and this sentinel
    // disables only the *aggregate* budget, so three enrolments of one user key are well
    // inside both limits.
    issuesCertificates: 'issues-without-an-aggregate-budget',
  })
  providerAddr = directWsAddr(provider, 'provider')

  // Root at the repo so workspace packages and their `./src/index.ts` entries resolve
  // without fs.allow gymnastics. Dependency pre-bundling stays ON — see
  // `two-tabs.e2e.test.ts` for the `Netmask` interop failure that turning it off produces.
  server = await createServer({
    root: ROOT,
    logLevel: 'error',
    server: { port: 0 },
    plugins: [bootstrapPlugin()],
  })
  await server.listen()
  const url = server.resolvedUrls?.local[0]
  if (url === undefined) throw new Error('vite dev server produced no URL')
  pageUrl = `${url.endsWith('/') ? url : `${url}/`}${PAGE}`

  browser = await chromium.launch()
  // ONE context. Three pages of it share an origin, and therefore share one visitor key.
  context = await browser.newContext()
}, 420_000)

afterAll(async () => {
  for (const page of pages) {
    await page.evaluate(async () => window.o2.stop()).catch(() => {})
  }
  await context?.close().catch(() => {})
  await browser?.close().catch(() => {})
  await server?.close().catch(() => {})
  await provider?.stop().catch(() => {})
  await relay?.stop().catch(() => {})
  await rm(workdir, { recursive: true, force: true })
}, 180_000)

describe('VER-10 criterion 5 — a page reads owner-domain for a sovereign shard', () => {
  it(
    'places an owner-pinned shard on two tabs of one profile, authorises it, and renders owner-domain',
    async () => {
      // ---- Sequentially. See the docblock: #49's read-then-write shape is one layer down.
      const submitterId = await openEnrolledTab('submitter', 'o2-owner-domain-submitter')
      const firstId = await openEnrolledTab('owned-first', 'o2-owner-domain-first')
      const secondId = await openEnrolledTab('owned-second', 'o2-owner-domain-second')
      const [submitter, first, second] = pages as [Page, Page, Page]

      expect(new Set([submitterId, firstId, secondId]).size, 'three tabs, three node identities').toBe(3)

      // ---- The submitter dials the other two at their relay-signalled /webrtc addresses.
      // A browser binds no listening socket; this is the only way one tab reaches another.
      //
      // **Dialled in BOTH directions, and that is a finding rather than belt and braces.**
      // A tab that has enrolled pins its provider and takes blocks only from peers it has
      // verified, and verification is a `records` request the *executor* makes back to the
      // submitter. `two-tabs.e2e.test.ts` never needed the reverse leg because nothing there
      // pins an issuer, so its jobs only ever travel one way. Here they do not: measured on
      // this fixture, a one-way dial left every peer with one verification of the submitter
      // still in flight for the whole run and settling only at teardown — so no peer ever
      // reached the module, `fetched` and `stored` stayed at 0 on both, and the submitter
      // ran every shard alone while reporting no failure at all.
      const addressOf = async (peer: Page, id: string): Promise<string> => {
        const addrs = await peer.evaluate(async () => window.o2.waitForWebrtcAddr(120_000))
        const target = addrs[0]
        expect(target, `${id} produced no /webrtc address`).toBeDefined()
        return target as string
      }
      const submitterAddr = await addressOf(submitter, submitterId)
      for (const [peer, id] of [
        [first, firstId],
        [second, secondId],
      ] as const) {
        const target = await addressOf(peer, id)
        expect(await submitter.evaluate(async (a) => window.o2.dial(a), target)).toBe(id)
        expect(await peer.evaluate(async (a) => window.o2.dial(a), submitterAddr)).toBe(submitterId)
      }

      // ---- Constraint 3 of `attestation-ui.e2e.test.ts`'s criterion case, twice.
      //
      // `main.ts:636-640` — a peer holds the module only once it has executed, so the first
      // dispatch of a cold fabric qualifies nobody. The second is what makes the lookup
      // answer, and this test needs it to answer *before* it can fill in the form: it cannot
      // know the visitor key, which is the whole property under test.
      let warmed = false
      for (let attempt = 0; attempt < WARM_ATTEMPTS && !warmed; attempt += 1) {
        const report = await warmUp(submitter, `attempt-${String(attempt)}`, [firstId, secondId])
        const found = await submitter.evaluate(() => window.o2.lastCandidates())
        // **Two conditions, and they settle one dispatch apart.** The replica counts say both
        // peers executed every shard, and therefore hold every input the sovereign run will
        // name. The lookup says the submitter can *see* that they do — and it runs at the
        // start of a dispatch rather than at the end, so it is always one behind. Waiting on
        // the counts alone produced `qualified: 1` on a run where both peers were already
        // fully warmed.
        //
        // **`report.complete` is deliberately not the test, and the reason is this fixture's
        // own subject.** `ShardResult.degraded` folds a quorum shortfall in beside a
        // redundancy shortfall — its docblock: *"A quorum shortfall can occur at full
        // redundancy — two nodes of one operator are two replicas and no quorum"* — and
        // `JobResult.complete` conjoins `!degraded`. Both warm-up peers are tabs of one
        // profile under one operator, so every shard here is degraded **however well it ran**
        // and `complete` is `false` for the very property this file exists to read. Measured,
        // not reasoned about: a draft using `complete` looped all twenty attempts against
        // `replicas=[2,2,2,2,2,2,2,2,2,2,2,2]` and `failures=[]`.
        const everywhere = report.replicas.every((count) => count === 2)
        if (everywhere && (found?.qualified.length ?? 0) >= 2) warmed = true
        else await submitter.waitForTimeout(WARM_INTERVAL_MS)
      }
      expect(
        warmed,
        `the fabric did not converge inside ${String(WARM_ATTEMPTS)} warm-up dispatches — both peers must hold the module AND the lookup must qualify both, or the sovereign run below reads a cold fabric rather than an authorised one`,
      ).toBe(true)

      const lookup = await submitter.evaluate(() => window.o2.lastCandidates())
      process.stderr.write(
        `[owner-domain] submitter ${submitterId}\n  peers ${firstId} ${secondId}\n` +
          `  lookup ${JSON.stringify(lookup)}\n`,
      )

      // The tab holds a certificate, so the lookup runs — `demo-byo.e2e.test.ts` measures
      // the other value, where `asked: false` makes every descriptor fall back to `public`
      // and a sovereign shard is unplaceable.
      expect(lookup?.asked, 'the tab holds a certificate, so the lookup must run').toBe(true)
      expect(lookup?.qualified.length, 'both warmed peers must advertise the module').toBeGreaterThanOrEqual(2)

      // **The shared-key reading, in-run.** Two distinct peers report the SAME owner id, and
      // it is not the placeholder. Two tabs of one profile are one visitor; two profiles are
      // not, which is the control this fixture inherits rather than repeats — see the
      // consult, whose third row is a second `BrowserContext` reporting a different key.
      const owner = sharedOwnerOf(lookup?.owners ?? [])
      expect(owner).not.toBe(OWNER_THE_NODES_DECLARE)
      expect(owner.length, 'an owner id is a hex public key').toBeGreaterThan(32)

      // ---- The run this file is about, through the page's own form.
      await submitter.click('#nav-byo')
      await submitter.waitForSelector('#s-byo', { state: 'visible', timeout: 60_000 })
      await submitter.check('#byo-sovereign')
      await submitter.fill('#byo-owner-id', owner)
      await dispatchByo(submitter, DISPATCH_BUDGET_MS)

      const attestation = await byoRegion(submitter, 'byo/attestation')
      const label = await byoRegion(submitter, 'byo/sovereign-label')
      const replicas = await byoRegion(submitter, 'byo/replicas')
      const failures = await byoRegion(submitter, 'byo/failures')
      const egress = await byoRegion(submitter, 'byo/egress')
      process.stderr.write(
        `[owner-domain] owner ${owner}\n  attestation: ${attestation}\n  label: ${label}\n` +
          `  replicas: ${replicas}\n  failures: ${failures}\n  egress: ${egress}\n`,
      )

      // **Fact one: the shards really were sovereign and pinned to this owner.** Asserted
      // first, so a run that quietly fell back to public cannot pass by rendering correct
      // words about the wrong data.
      expect(label).toContain('sovereign')
      expect(label).toContain(owner)
      expect(
        egress,
        'the page said this run registered no sovereign data, on the dispatch this case exists to make sovereign',
      ).not.toContain('registered no sovereign data')

      // **Fact two: the chain was accepted.** This is the exact opposite value of the field
      // `attestation-ui.e2e.test.ts`'s criterion case reads — same instrument, other reading,
      // and the difference between the two files is only whose key the owner is.
      expect(
        failures,
        'the sovereign dispatch was refused for want of a capability chain, so `chainsForOwner` did not root at this tab’s own key',
      ).not.toContain('no capability chain supplied')

      // **Fact three, and the criterion: the middle label, on screen, for sovereign data.**
      // Compared against `describeAttestation` rather than transcribed, so a change to the
      // kernel's words moves both sides together.
      expect(replicas).not.toContain('no agreement')
      expect(attestation).toContain(OWNER_DOMAIN)

      // And the two comparisons that make it a reading rather than a constant. `independent`
      // is what an unshared key would produce — two operators — and `owner-attested` is what
      // a run that lost a replica would produce. Both are excluded in the same run.
      expect(attestation).not.toContain(INDEPENDENT)
      expect(attestation).not.toContain(OWNER_ATTESTED)
    },
    CASE_TIMEOUT_MS,
  )
})
