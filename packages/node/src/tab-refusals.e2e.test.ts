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
import { canonicalCid, signName, toHex } from '@o2/core'
import type { NameRecord, Task } from '@o2/core'
import { peerIdForNodeKey } from '@o2/libp2p'
import { encodeRequest, parseResponse } from '@o2/net'
import type { AgentResponse } from '@o2/net'
import type { TabNameRecord } from '@o2/browser'
// Test-only relative import — see the note in packages/net/src/distributed.test.ts.
import { MODULE_WRITES_PARTITION } from '../../core/src/executor/fixtures.ts'
import { FabricNode } from './fabric-node.ts'

/**
 * WIRE-03 — the two refusals a live tab had never been made to execute.
 *
 * ## What was genuinely open, and what was not
 *
 * The browser tier's **serving** direction has been measured since Phase 18:
 * `packages/node/src/browser-capability.e2e.test.ts` dispatches three `label:'sovereign'`
 * tasks to a live tab pinned to a real owner, refuses two of them by name at
 * `authorizeCapability`, and has the third accepted and executed. So *"no sovereign job
 * has ever run in a browser"* is refuted, and AUTH-03's refusal in a tab is not what this
 * file is about.
 *
 * Two narrower things were open, and both are read here for the first time.
 *
 * 1. **The submitter direction.** `packages/node/src/sovereign-block-refusal.node.test.ts`
 *    states in its own header that it proves the Node tier's submitter path and *not* the
 *    browser tier's, because *"that file dispatches **to** a browser node and reads what
 *    it serves, which is the other direction."* Nothing drove a sovereign payload out of a
 *    tab's own `submitJob` and then asked the tab for it.
 * 2. **The capacity refusal.** `packages/browser/src/browser-node.ts` said at its
 *    `capacity:` hook that *"nothing drives a refusal through this hook, so the number this
 *    node would answer an over-committed requestor with has never been read"*, and named
 *    WIRE-03 as the harness that would. Note what is **not** this:
 *    `duty-cycle-tab.e2e.test.ts:263` reads a tab's advertised slots fall 8 → 2, which is
 *    an **offer answer, not a refusal**. The two are different questions and this file does
 *    not let them merge — that spec stays green and untouched.
 *
 * ## A name a reader will look for and not find
 *
 * `registerSovereignInputs` does not exist in this repository and never shipped. The
 * planning documents inherited a name the source had already dropped; the real symbols are
 * `takeSovereignHold` and `withholdingFrom`, both exported at `packages/net/src/index.ts`,
 * and `packages/net/src/capability-authorizer.ts` records the correction verbatim. The
 * registration this file depends on is neither of those: it is `submitJob`'s own
 * **blockstore-put** (`packages/core/src/job/submit.ts`), which records a sovereign shard's
 * CID on the durable set the submitting node was handed. Registering at the put covers
 * every submitter rather than every submitter that remembered — including, from this plan
 * on, a page.
 *
 * ## The topology, and why there is no relay in it
 *
 * One tab and one Node-tier `FabricNode`, on a **direct WebSocket connection the tab
 * opened itself** — `browser-capability.e2e.test.ts`'s topology, for its reason: a relay
 * exists so that two browsers can exchange SDP, and there is one browser here. The tab
 * dials the peer's `/ws` listener; libp2p connections are bidirectional, so the Node side
 * addresses the tab back **by peer id** along the connection the tab opened
 * (`libp2p-transport.ts` dials by `PeerId`, which resolves to the open connection rather
 * than to a new one). Deliberately not a circuit: `.planning/PROJECT.md` records that a
 * relayed circuit is a signalling channel — 2 minutes and 128 KiB by default — and may not
 * carry a job.
 *
 * ## Both readings are taken from the requestor's own reply
 *
 * Never from a counter read back out of the page. A reading taken inside the tab proves
 * the tab counted; the requirement is about **what the peer was told**, which is the only
 * half a peer can act on. Page-side readings appear below only as preconditions — that the
 * tab holds the block it is refusing, and that it really ran the work it admitted — and
 * each is labelled as such.
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const PAGE = 'packages/browser/demo/index.html'

/**
 * The build authority this file's fixture module is published under — DET-03/DATA-08.
 *
 * Seed 67, free against the repository's whole `fill(n)`/`keypair(n)` census on
 * 2026-08-03: 0-4, 7, 9, 11-13, 19-24, 30-33, 40-42, 50-66, 70-75, 77, 80-87, 90-99,
 * 111-113, 120, 121, 133 and 200 are taken; 67 is not, and it sits next to 63-66 so the
 * Phase 19 fixtures read as one family.
 *
 * Both the tab and the Node peer pin this and nothing else. A tab pinning its own key
 * **replaces** the demo's committed anchor rather than joining it (`TabApi.start`), which
 * is correct here: the module under test is a harness fixture and the demo's build
 * authority has no standing over it.
 */
const harness = (() => {
  const priv = new Uint8Array(32).fill(67)
  return { priv, pub: toHex(ed25519.getPublicKey(priv)) }
})()

/** The fixture module's published name. Arbitrary, and shared by every record below. */
const FIXTURE_NAME = 'o2-tab-refusals-partition-fixture'

/**
 * The owner the tab's sovereign shard is pinned to.
 *
 * Distinct from `capability-fixture.ts`'s `OWNER_ID` on purpose: nothing here mints a
 * capability chain, and borrowing that identifier would invite a reader to look for one.
 */
const OWNER = 'tab-owner'

/**
 * A `NameRecord` in the shape that survives `page.evaluate`.
 *
 * Structured cloning does not preserve a `CID` instance — `TabNameRecord`'s own doc in
 * `packages/browser/src/tab-api.ts` is the one place that reason is written down.
 */
function asTabRecord(record: NameRecord): TabNameRecord {
  return { ...record, cid: record.cid.toString() }
}

/** Sign `cid` under {@link FIXTURE_NAME} with the harness key, five minutes out. */
function signFixture(cid: CID): NameRecord {
  return signName(harness.priv, {
    name: FIXTURE_NAME,
    cid,
    version: 1,
    expiresAt: Date.now() + 300_000,
  })
}

interface Tab {
  readonly name: string
  readonly context: BrowserContext
  readonly page: Page
  readonly peerId: string
}

let peer: FabricNode
let peerAddr: string
let server: ViteDevServer
let browser: Browser
let baseUrl: string
let workdir: string
const tabs: Tab[] = []

/**
 * Open an isolated context, load the demo page, and start a node in it.
 *
 * An isolated `BrowserContext` per tab rather than a second page in one context, for
 * `two-tabs.e2e.test.ts`'s reason: each gets its own origin storage, so no tab in this
 * file can see another's IndexedDB — which matters more here than usual, because the
 * durable sovereign-CID set *is* an IndexedDB database and a shared one would let the
 * second case inherit the first's registrations.
 */
async function openTab(name: string, slots?: number): Promise<Tab> {
  const context = await browser.newContext()
  const page = await context.newPage()

  // Surface page errors in the test output; a silent browser failure here is otherwise
  // indistinguishable from a timeout.
  page.on('pageerror', (error) => {
    process.stderr.write(`[${name}] page error: ${error.message}\n`)
  })
  page.on('console', (message) => {
    if (message.type() === 'error') process.stderr.write(`[${name}] console: ${message.text()}\n`)
  })

  await page.goto(`${baseUrl}${PAGE}`)
  await page.waitForFunction(() => typeof window.o2 !== 'undefined', null, { timeout: 30_000 })

  const peerId = await page.evaluate(
    async ([address, store, anchor, maxConcurrent]) => {
      // BROW-01 has no test-only bypass: a harness consents for the same reason a visitor
      // clicks the button.
      window.o2.grantConsent()
      return window.o2.start({
        relayAddrs: [address as string],
        blockstoreName: store as string,
        trustAnchors: [anchor as string],
        // Conditional, so a tab that did not ask for a limit takes the shipped default and
        // this helper cannot silently pin one for a case that is not about it.
        ...(maxConcurrent === undefined ? {} : { maxConcurrentTasks: maxConcurrent as number }),
      })
    },
    [peerAddr, `o2-tab-refusals-${name}`, harness.pub, slots] as const,
  )

  const tab: Tab = { name, context, page, peerId }
  tabs.push(tab)
  return tab
}

/** Ask `to` for `cid` over the real wire, and return the reply as it came. */
async function askForBlock(to: string, cid: CID): Promise<AgentResponse | null> {
  return parseResponse(await peer.rpc.request(to, encodeRequest({ kind: 'block', cid })))
}

/** Ask `to` who provides `cid`, over the same wire and the same connection. */
async function askProviders(to: string, cid: CID): Promise<readonly string[]> {
  const reply = parseResponse(await peer.rpc.request(to, encodeRequest({ kind: 'providers', cid })))
  if (reply?.kind !== 'providers') throw new Error(`expected a providers reply, got ${reply?.kind}`)
  return reply.nodeKeys
}

/**
 * Dispatch an `exec` over the real wire and read the **raw** reply.
 *
 * `RemoteExecutor` would flatten a `{kind:'error'}` frame into `ok:false` with a reason,
 * which is enough to see *that* a dispatch was refused and not enough to see that the
 * refusal was the capacity branch's — the distinction the second `describe` is entirely
 * about. Taken the way `admission.node.test.ts` takes it one tier over.
 */
async function dispatch(to: string, task: Task): Promise<AgentResponse | null> {
  return parseResponse(await peer.rpc.request(to, encodeRequest({ kind: 'exec', task })))
}

beforeAll(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'o2-tab-refusals-'))

  // The peer that asks and dispatches. `trustAnchors` is the harness key rather than the
  // opt-out, because a peer declaring a different build authority from the tab it
  // dispatches to would be a lie in a file nobody would re-read.
  //
  // **No `rpcTimeoutMs`.** The production default of 30,000 ms is inherited rather than
  // narrowed, so no bound in this file is a number nobody measured. Every refusal below
  // arrives as a returned frame rather than at that budget's expiry — which is itself part
  // of the reading, because a node that runs everything at once answers late enough to
  // time out and a node that refuses answers immediately.
  peer = await FabricNode.start({
    blockstoreDir: join(workdir, 'peer'),
    listen: ['/ip4/127.0.0.1/tcp/0/ws'],
    trustAnchors: [harness.pub],
  })
  const address = peer.browserDialableAddrs[0]
  if (address === undefined) throw new Error('peer produced no browser-dialable address')
  peerAddr = address

  // Rooted at the repo so workspace packages and their `./src/index.ts` entries resolve.
  // Dependency pre-bundling must stay ON — see the note in `two-tabs.e2e.test.ts`.
  server = await createServer({ root: ROOT, logLevel: 'error', server: { port: 0 } })
  await server.listen()
  const url = server.resolvedUrls?.local[0]
  if (url === undefined) throw new Error('vite dev server produced no URL')
  baseUrl = url.endsWith('/') ? url : `${url}/`

  browser = await chromium.launch()
}, 180_000)

afterAll(async () => {
  for (const tab of tabs) {
    await tab.page.evaluate(async () => window.o2.stop()).catch(() => {})
    await tab.context.close().catch(() => {})
  }
  await browser?.close().catch(() => {})
  await server?.close().catch(() => {})
  await peer?.stop().catch(() => {})
  await rm(workdir, { recursive: true, force: true })
}, 120_000)

describe('WIRE-03 — a tab does not hand over the sovereign row it submitted', () => {
  it('serves a public block to the peer, refuses the sovereign one by name, and withholds it from its own providers answer', async () => {
    const tab = await openTab('submitter')

    // The precondition every reading below rests on, asserted rather than assumed: two
    // distinct peers holding one connection, which the tab opened. Without it a refusal
    // and a request that never arrived are the same empty result.
    expect(tab.peerId).not.toBe(peer.peerId)
    expect(await tab.page.evaluate(() => window.o2.peers())).toContain(peer.peerId)

    // The module. Only the tab holds it, and nothing here dispatches it anywhere — a job
    // with no executors places nothing, which is exactly the configuration
    // `sovereign-at-rest.node.test.ts` uses one tier over. What matters is the line
    // *before* placement: `submitJob` content-addresses every shard input and puts it into
    // the store it was handed, which is how a submitter comes to hold a row at all.
    const moduleCid = await tab.page.evaluate(
      async (bytes) => window.o2.putModule(bytes),
      [...MODULE_WRITES_PARTITION],
    )
    const record = asTabRecord(signFixture(CID.parse(moduleCid)))

    // ---- The sovereign submission, from the page's own job runner ------------------
    const sovereignRun = await tab.page.evaluate(
      async ([cid, signed, owner]) =>
        window.o2.runJob({
          moduleCid: cid as string,
          moduleRecord: signed as TabNameRecord,
          peerIds: [],
          shards: 1,
          redundancy: 1,
          sovereign: { ownerId: owner as string },
        }),
      [moduleCid, record, OWNER] as const,
    )
    // The job places nothing and completes nothing — there are no executors — and that is
    // irrelevant to what is measured. Read rather than ignored, so a run in which the page
    // threw before reaching the put cannot pass as one that registered.
    expect(sovereignRun.complete).toBe(false)

    // ---- The public submission, through the identical entry point -------------------
    //
    // Two shards, so its second input is a value the sovereign run never produced. The
    // page derives a shard's value from its index alone, so a one-shard public run would
    // content-address to the byte-identical block the sovereign run registered, and the
    // control would be measuring the same CID under two names.
    const publicRun = await tab.page.evaluate(
      async ([cid, signed]) =>
        window.o2.runJob({
          moduleCid: cid as string,
          moduleRecord: signed as TabNameRecord,
          peerIds: [],
          shards: 2,
          redundancy: 1,
        }),
      [moduleCid, record] as const,
    )
    expect(publicRun.complete).toBe(false)

    // The two blocks, addressed in this process from `canonicalCid`'s own bytes so no CID
    // asserted against below is read back off the code under test.
    const sovereignRow = await canonicalCid({ a: 0 })
    const publicRow = await canonicalCid({ a: 1 })
    if (!sovereignRow.ok || !publicRow.ok) throw new Error('fixture not encodable')
    expect(sovereignRow.cid.toString()).not.toBe(publicRow.cid.toString())

    // Page-side precondition, and the one that makes every absence below mean something.
    // `SelfRecordIndex.providers` answers `[]` for a block this node does not hold, and
    // the `block` branch answers `bytes: null` for the same — so a tab that had simply not
    // put the row would satisfy the withholding assertion and the refusal assertion both,
    // for the wrong reason. It holds **both** rows, in its local-only store.
    expect(await tab.page.evaluate(async (cid) => window.o2.hasBlock(cid), sovereignRow.cid.toString())).toBe(true)
    expect(await tab.page.evaluate(async (cid) => window.o2.hasBlock(cid), publicRow.cid.toString())).toBe(true)

    // ---- The control, read FIRST ---------------------------------------------------
    //
    // A tab that served nothing at all — because the connection had dropped, because the
    // page had thrown, because `serveAgent`'s block branch had stopped answering — would
    // satisfy every refusal assertion below. So the working case is established before any
    // absence is allowed to be reported, and it is established against the same tab, the
    // same peer, the same connection and the same store.
    const served = await askForBlock(tab.peerId, publicRow.cid)
    expect(served?.kind).toBe('block')
    if (served?.kind !== 'block') return
    // The bytes, not merely a non-null reply: this is the row itself coming back.
    expect(served.bytes).toEqual(publicRow.bytes)

    // ---- The refusal, by name ------------------------------------------------------
    //
    // The text and not merely the kind. This repository has recorded twice that a refusal
    // naming the wrong thing satisfies every "it failed" assertion — a tab whose block
    // branch had broken in some other way answers `error` too, and `ok: false` cannot tell
    // the two apart.
    const refused = await askForBlock(tab.peerId, sovereignRow.cid)
    expect(refused?.kind).toBe('error')
    if (refused?.kind !== 'error') return
    expect(refused.reason).toContain('egress refused')
    expect(refused.reason).toContain(sovereignRow.cid.toString())
    // Composed by the tab, about the tab: the refusal names the node that made it.
    expect(refused.reason).toContain(tab.peerId)

    // ---- The two answers cannot diverge ---------------------------------------------
    //
    // A node advertising a block its own `block` branch refuses converts the ruling
    // recorded in `egress.ts` — that a peer cannot tell refusal from absence — into a peer
    // that **can** tell, learning it without asking for the bytes and without anything
    // appearing on the refusing node's manifest. That is a side channel around a refusal,
    // it is the defect 18-02 planted and measured, and it is why both answers are read
    // rather than one.
    expect(await askProviders(tab.peerId, sovereignRow.cid)).toEqual([])

    // The positive twin, off the same instrument in the same run. Without it, `[]` is
    // equally what a tab answering nobody about anything returns. The key is a node key
    // and not a peer id, so it is checked through the derivation that relates them —
    // `peerIdForNodeKey`, the identical function `browser-node.ts` runs over its own.
    const providers = await askProviders(tab.peerId, publicRow.cid)
    expect(providers).toHaveLength(1)
    expect(peerIdForNodeKey(providers[0] as string)).toBe(tab.peerId)

    // Printed as well as asserted, so the wording is available on every run rather than
    // surviving as a note somebody took once — the convention `browser-capability.
    // e2e.test.ts` established for its own refusal texts.
    console.log(`[browser tier] sovereign block -> ${refused.reason}`)
    console.log(
      `[browser tier] providers — sovereign: [] , public: ${providers.length} key(s) for ${tab.peerId}`,
    )
  }, 300_000)
})
