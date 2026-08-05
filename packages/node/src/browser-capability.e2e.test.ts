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
import { canonicalCid, signName, toHex } from '@o2/core'
import type { CanonicalValue, NameRecord, Task } from '@o2/core'
import { RemoteExecutor } from '@o2/net'
// Test-only relative imports — see the note in packages/net/src/distributed.test.ts.
import { MODULE_WRITES_PARTITION } from '../../core/src/executor/fixtures.ts'
import { OWNER_ID, OWNER_KEY, chainSupplierFor, directChainFor } from './capability-fixture.ts'
import { FabricNode } from './fabric-node.ts'

/**
 * AUTH-03 — a real browser tab's own `authorize` hook, measured.
 *
 * ## The gap this closes, and why it stayed open for four plans
 *
 * `packages/browser/src/browser-node.ts` installs the same `authorizeCapability` the
 * Node factory does. Until this file, **nothing measured whether it installed it
 * correctly.** Plan 15-03 planted a fully scrambled authorizer there — the owner id and
 * owner key transposed, the audience hardcoded to an eight-character literal, the clock
 * frozen at zero — and `tsc` exited 0, the substring count in
 * `serve-agent-hooks.node.test.ts` stayed at 1, and 345 browser tests passed in three
 * engines. Phase 15's verifier re-planted it and reproduced all three readings exactly.
 *
 * Every plan that looked at the hole recorded the same reason for leaving it: that
 * `BrowserNode.start` *"needs a real `indexedDB` and a relay to dial, so it runs in
 * neither vitest project"*. **That reason was false**, and it is worth naming the error
 * rather than only correcting it, because it is the error that kept the gap open: a
 * limit that is real about the **`browser`** project was restated as a limit about every
 * project. The `browser` project genuinely cannot host this — a Circuit Relay v2 server
 * *"will not work in browsers"* in `@libp2p/circuit-relay-v2`'s own words, and vitest's
 * browser mode gives one page per file. The **`e2e`** project has neither constraint. It
 * drives Playwright from Node, and `two-tabs.e2e.test.ts` has been dispatching jobs into
 * a tab's own `serveAgent` handler since Phase 13 — mutation-ledger entry `M28` is the
 * proof, and it turns that file red from the browser tier.
 *
 * ## The topology, and why there is no relay in it
 *
 * One tab and one `FabricNode`, on a **direct WebSocket connection the tab opened
 * itself**. No relay, and none is needed: a relay exists to let two browsers exchange
 * SDP, and there is only one browser here. The tab dials the submitter's `/ws` address;
 * libp2p connections are bidirectional, so `Libp2pTransport.send` reaches the tab back
 * along it by peer id (`libp2p-transport.ts:339` dials by `PeerId`, which resolves to
 * the open connection rather than to a new one).
 *
 * This is deliberately **not** a circuit. `.planning/PROJECT.md` records the constraint
 * that a relayed circuit is a signalling channel — 2 minutes and 128 KiB by default —
 * and may not carry a job. A browser dialling a Node's WebSocket listener is a genuine
 * direct data path, which the transport matrix in `CLAUDE.md` lists as supported in
 * exactly this direction and no other.
 *
 * ## Why the tab is constructed by a harness rather than by `window.o2`
 *
 * `TabApi.start` carries no `sovereignty` option, so a tab started through the demo is
 * pinned to nobody and refuses every sovereign task at `authorizeCapability`'s *first*
 * precedence step — `no pinned owner key` — whatever chain arrives and whatever audience
 * the factory derived. That refusal is worth nothing as evidence: a correctly wired
 * authorizer and a scrambled one both produce it. Measuring the wiring needs a tab
 * pinned to a real owner, so `packages/browser/src/capability-harness.ts` constructs the
 * factory directly. Its own header carries the rest of that reasoning.
 *
 * ## The three readings, and the positive twin each one is paired with
 *
 * This is the browser-tier counterpart of `capability-dispatch.node.test.ts`'s criterion
 * 2, and it is one `it` for the same reason that file uses one: three dispatches to
 * **one** node, in one run, so the readings are comparable rather than merely adjacent.
 * The accepted case runs **last**, so neither refusal can be explained by a tab that had
 * already stopped serving.
 *
 * | Instrument | Negative reading | Positive reading |
 * |---|---|---|
 * | the tab's own executor call count | `0` after both refusals | `1` after the accepted dispatch |
 * | the tab's **local** IndexedDB store | module absent after both refusals | module present after the accepted one |
 * | the refusal text returned to the submitter | the mechanism's own words | `ok: true`, no reason at all |
 *
 * **The acceptance case is not optional and is the reason this file is not a file of
 * refusals.** An authorizer that refuses everything — which is the exact shape of the
 * defect 15-03 planted — passes any number of refusal assertions. Every negative reading
 * here has its twin off the same instrument in the same `it`.
 *
 * ## What the executor counter proves that a refusal string does not
 *
 * `GovernedExecutor` increments `executed` immediately before calling the executor it
 * wraps (`governed-executor.ts:64`, `:85`), and `serveAgent` reaches `executor.execute`
 * only when the authorizer returned `null` (`agent.ts:409-417`). So a refusal that
 * arrives with that figure still at `0` was taken **before** the module ran, rather than
 * reported after it. That is a stronger reading than the node tier gets across a process
 * boundary, where the count is unreachable and a blockstore directory stands in for it —
 * and it is available here precisely because the tab is a live object in a page this
 * process drives. Both instruments are asserted, because they fail independently: a
 * guard moved after execution moves the counter, and a guard that runs but fetches
 * eagerly moves the store.
 *
 * ## What this file does not claim
 *
 * It does not observe `WebAssembly.instantiate`. Nothing inside a page can watch that
 * call, and no assertion here pretends to — the counter is upstream of it, which is
 * stated rather than elided. The in-process reading at
 * `packages/net/src/capability-dispatch.test.ts:289` remains the sharpest form of that
 * claim, and this file adds neither it nor a substitute for it.
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const PAGE = 'packages/browser/harness/capability.html'

/**
 * The build authority both nodes pin — DET-03/DATA-08.
 *
 * The subject here is the capability chain, not provenance; this record exists so that
 * subject can be reached at all. A tab pins some anchor set however it is started, so an
 * unsigned module would be refused for provenance and the refusal under test would never
 * be the one that arrived.
 *
 * Seed 57, adjacent to `capability-dispatch.node.test.ts`'s 56 so the capability files
 * read as one family. Re-grepped across every `fill(n)` and `keypair(n)` site in
 * `packages/` and `tools/` on 2026-07-31: 0-4, 7, 9, 11, 12, 21-24, 30, 31, 40-42,
 * 50-56, 60, 61, 80-82, 90-99 and 111-113 are taken; 57 is free.
 */
const publisher = (() => {
  const priv = new Uint8Array(32).fill(57)
  return { priv, pub: toHex(ed25519.getPublicKey(priv)) }
})()

/**
 * The owner's row, pinned to the tab that owns it and never dispatched over the wire.
 *
 * Distinct bytes from every other sovereign fixture in the repository, for the reason
 * `capability-dispatch.node.test.ts` gives about its own: if two files shared a row,
 * either file's seeding could satisfy the other's assertion and a failure to seed would
 * be invisible.
 */
const SOVEREIGN_ROW: CanonicalValue = {
  ssn: '305-41-9922',
  salary: 71_250,
  dob: '1988-11-04',
  branch: 'north-wharf',
}

/** Non-zero on purpose: an index of 0 would make a module that emitted nothing agree. */
const PARTITION_INDEX = 3
const PARTITION_COUNT = 7

let submitter: FabricNode
let submitterAddr: string
let server: ViteDevServer
let browser: Browser
let context: BrowserContext
let page: Page
let tabPeerId: string
let workdir: string

beforeAll(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'o2-browser-capability-'))

  // The submitter. `trustAnchors` is the publisher's key rather than the opt-out,
  // because a submitter declaring a different authority from the node it dispatches to
  // would be a lie in a file nobody would re-read.
  //
  // **No `rpcTimeoutMs`.** The production default of 30,000 ms is inherited rather than
  // narrowed, so no bound in this file is a number nobody measured. Every refusal below
  // arrives as a returned outcome rather than at that budget's expiry, and the accepted
  // dispatch — a full round trip including a module pull and a WASM compile inside a
  // browser Worker — is the evidence the default is ample rather than merely convenient.
  submitter = await FabricNode.start({
    relayAdmission: 'admits-any-peer',
    startReporting: 'reports-its-own-start',
    blockstoreDir: join(workdir, 'submitter'),
    listen: ['/ip4/127.0.0.1/tcp/0/ws'],
    trustAnchors: [publisher.pub],
  })
  const address = submitter.browserDialableAddrs[0]
  if (address === undefined) throw new Error('submitter produced no browser-dialable address')
  submitterAddr = address

  // Rooted at the repo so workspace packages and their `./src/index.ts` entries resolve
  // without fs.allow gymnastics, and so the harness page can load a module from `src/`.
  // Dependency pre-bundling must stay ON — see the note in `two-tabs.e2e.test.ts`.
  server = await createServer({ root: ROOT, logLevel: 'error', server: { port: 0 } })
  await server.listen()
  const url = server.resolvedUrls?.local[0]
  if (url === undefined) throw new Error('vite dev server produced no URL')
  const baseUrl = url.endsWith('/') ? url : `${url}/`

  browser = await chromium.launch()
  context = await browser.newContext()
  page = await context.newPage()

  // Surface page errors in the test output; a silent browser failure here is otherwise
  // indistinguishable from a timeout.
  page.on('pageerror', (error) => {
    process.stderr.write(`[harness] page error: ${error.message}\n`)
  })
  page.on('console', (message) => {
    if (message.type() === 'error') process.stderr.write(`[harness] console: ${message.text()}\n`)
  })

  await page.goto(`${baseUrl}${PAGE}`)
  await page.waitForFunction(() => typeof window.o2capability !== 'undefined', null, { timeout: 30_000 })

  // The tab, pinned to alice and cleared to execute for her — the configuration that
  // makes `authorizeCapability`'s later precedence steps reachable at all.
  tabPeerId = await page.evaluate(
    async ([address, anchor, ownerId, ownerKey]) =>
      window.o2capability.start({
        relayAddrs: [address!],
        blockstoreName: 'o2-browser-capability',
        trustAnchors: [anchor!],
        sovereignty: { ownerId: ownerId!, ownerKey: ownerKey!, canExecuteSovereign: true },
        // A fresh context, so there is no seed to find and the first start must mint one.
        // The subject of this file is the capability chain, not identity persistence —
        // `browser-enrollment.e2e.test.ts` is where that is read.
        whenSeedIsGone: 'mints-a-new-identity',
      }),
    [submitterAddr, publisher.pub, OWNER_ID, OWNER_KEY],
  )
}, 180_000)

afterAll(async () => {
  await page?.evaluate(async () => window.o2capability.stop()).catch(() => {})
  await context?.close().catch(() => {})
  await browser?.close().catch(() => {})
  await server?.close().catch(() => {})
  await submitter?.stop().catch(() => {})
  await rm(workdir, { recursive: true, force: true })
}, 120_000)

describe('AUTH-03 — a live browser tab judges a capability chain', () => {
  it('the tab reserves nothing and is reachable over the connection it opened itself', async () => {
    // The precondition every assertion below rests on, asserted rather than assumed: the
    // submitter and the tab are two distinct peers holding one connection between them.
    // Without this, a dispatch that never arrived would be indistinguishable from one
    // that arrived and was refused.
    expect(tabPeerId).not.toBe(submitter.peerId)
    expect(await page.evaluate(() => window.o2capability.peers())).toContain(submitter.peerId)
    // No module has been dispatched, so the tab has run nothing. This is the counter's
    // zero before any case moves it — the baseline that makes the readings below
    // transitions rather than absolute values.
    expect(await page.evaluate(() => window.o2capability.executed())).toBe(0)
  }, 120_000)

  it('refuses a task with no chain in the mechanism’s own words, refuses an expired one by link index, and accepts a valid one — never running the module for either refusal', async () => {
    const owned = await canonicalCid(SOVEREIGN_ROW)
    if (!owned.ok) throw new Error('sovereign fixture not encodable')

    // Seeded into the tab's **local** store, so the owner's row sits on the node that
    // owns it and the only block this tab must go and fetch is the module. That is what
    // makes the store reading below a clean instrument — and it keeps the sovereign row
    // off the wire entirely, in a phase whose sibling files exist to prove it stays off.
    const seeded = await page.evaluate(
      async (bytes) => window.o2capability.putBytes(bytes),
      [...owned.bytes],
    )
    expect(seeded).toBe(owned.cid.toString())

    // Only the submitter holds the module. The tab has a fresh IndexedDB and must pull
    // it over the connection — which it will do only if it gets as far as executing.
    const moduleCid = await submitter.store.put(MODULE_WRITES_PARTITION)
    expect(await page.evaluate(async (cid) => window.o2capability.hasBlock(cid), moduleCid.toString())).toBe(
      false,
    )

    const moduleRecord: NameRecord = signName(publisher.priv, {
      name: 'browser-capability',
      cid: moduleCid,
      version: 1,
      expiresAt: Date.now() + 3_600_000,
    })

    const task: Task = {
      moduleCid,
      moduleRecord,
      inputCid: owned.cid,
      partitionIndex: PARTITION_INDEX,
      partitionCount: PARTITION_COUNT,
      label: 'sovereign',
      ownerId: OWNER_ID,
    }

    const executed = async (): Promise<number> =>
      page.evaluate(() => window.o2capability.executed())
    const holdsModule = async (): Promise<boolean> =>
      page.evaluate(async (cid) => window.o2capability.hasBlock(cid), moduleCid.toString())

    // ---- 1. No chain at all -------------------------------------------------------
    //
    // The frame genuinely carries no `capability` key: the sentinel branch at
    // `remote-executor.ts:110-111` encodes `{kind:'exec', task}` and `protocol.ts:355`
    // omits the key when it is undefined.
    const unauthenticated = new RemoteExecutor(tabPeerId, submitter.rpc, 'dispatches-unauthenticated')
    const absent = await unauthenticated.execute(task)

    expect(absent.ok).toBe(false)
    if (absent.ok) return
    // `describeFailure`'s own text, passed through untouched — `agent.ts:419` adds the
    // prefix and `remote-executor.ts:139` returns the outcome verbatim.
    //
    // **The text, not merely the kind.** A tab whose authorizer had its owner fields
    // transposed also refuses this task, at a different precedence step, naming a
    // different thing — and `ok: false` cannot tell the two apart. 15-03 hit exactly
    // that: a refusal that named the wrong thing while the job still correctly failed.
    expect(absent.reason).toContain('unauthorized:')
    expect(absent.reason).toContain('no capability chain supplied')
    // The half of the criterion that names **no** link, and cannot: an empty chain has
    // no link to index (`capability.ts:104` produces that literal and nothing more).
    // Asserted as an absence only because the expired case below shows the same
    // instrument producing an index.
    expect(absent.reason).not.toContain('link ')
    // Refused *before* the module ran, on both instruments.
    expect(await executed()).toBe(0)
    expect(await holdsModule()).toBe(false)

    // ---- 2. An expired chain ------------------------------------------------------
    //
    // No sleep and no timing bound: `expiresAt` is absolute Unix ms, *"Absolute rather
    // than a duration so it cannot drift"* (`capability.ts:57` — `capability-dispatch.
    // node.test.ts:458` cites `:56` for this line, which is one short), so a chain that
    // expired one second ago is exact rather than approximate.
    const stale = new RemoteExecutor(tabPeerId, submitter.rpc, () =>
      directChainFor(tabPeerId, OWNER_ID, Date.now() - 1_000),
    )
    const expired = await stale.execute(task)

    expect(expired.ok).toBe(false)
    if (expired.ok) return
    expect(expired.reason).toContain('unauthorized:')
    expect(expired.reason).toContain('expired at')
    // The index survived the whole trip: minted in this process, encoded, parsed inside
    // a browser tab, judged there against that tab's own clock, and named in a string
    // this process reads back.
    expect(expired.reason).toContain('link 0')
    expect(await executed()).toBe(0)
    expect(await holdsModule()).toBe(false)

    // ---- 3. A valid chain, last -------------------------------------------------
    //
    // Ordered last so neither refusal above can be explained by a tab that had already
    // stopped serving. One thing changes between this dispatch and the first: the chain.
    //
    // `chainSupplierFor` mints `owner -> this tab`, with the audience derived from the
    // tab's peer id by `audienceKeyOf` — the identical derivation the factory ran over
    // its own `libp2p.peerId` (`browser-node.ts:423`). Nothing is exchanged to make
    // those two agree, which is what makes a hardcoded audience in the factory fatal
    // here and invisible to every substring count.
    const valid = new RemoteExecutor(tabPeerId, submitter.rpc, chainSupplierFor(tabPeerId))
    const accepted = await valid.execute(task)

    // The positive twin of every reading above, off the same three instruments.
    expect(accepted.ok).toBe(true)
    if (!accepted.ok) return
    const executedAfterAccepted = await executed()
    expect(executedAfterAccepted).toBe(1)
    expect(await holdsModule()).toBe(true)

    // Printed rather than only asserted, so the readings are available on every run
    // instead of surviving as a note somebody took once — the convention
    // `capability-dispatch.node.test.ts:448` established for its frame counts. The
    // refusal texts are printed whole because their *wording* is the assertion here,
    // and a run that reports them is a run a reader can check against `describeFailure`
    // without re-deriving which branch produced them.
    console.log(
      `[browser tier] tab executor calls — after absent: 0, after expired: 0, after accepted: ${executedAfterAccepted}`,
    )
    console.log(`[browser tier] absent  -> ${absent.reason}`)
    console.log(`[browser tier] expired -> ${expired.reason}`)
  }, 240_000)
})
