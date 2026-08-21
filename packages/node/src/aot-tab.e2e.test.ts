import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
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
// Test-only relative imports across a package boundary — see the note in
// `packages/net/src/distributed.test.ts` and the longer form in
// `aot-dispatch.node.test.ts`: a fixture is not part of a package's published surface.
import { MODULE_ECHOES_INPUT } from '../../core/src/executor/fixtures.ts'
import { ECHO_GUEST_C, LIFTED_ECHO } from '../../../tools/aot/echo-guest.ts'
import { OWNER_ID, OWNER_KEY } from './capability-fixture.ts'
import { launchFixtureBrowser } from './e2e-browser-launch.ts'
import { FabricNode } from './fabric-node.ts'

/**
 * AOT-04, the browser tier — **a real browser tab executes a real elfconv artifact.**
 *
 * ## The gap this closes, and why the file next to it does not close it
 *
 * Every reading this repository holds of a translated artifact executing is a **Node**
 * reading. `packages/aot/src/wasi-real.node.test.ts` runs one in-process. `packages/node/
 * src/aot-dispatch.node.test.ts` runs one across two spawned agent processes. And
 * `packages/node/src/ported-lift.e2e.test.ts` — despite the `.e2e` suffix, which is the
 * trap here and is worth naming rather than leaving for the next reader to fall into —
 * **launches no browser at all**: it spawns Docker and drives both arms through
 * `WasiExecutor` directly in Node. It is Node-tier evidence wearing an e2e filename.
 *
 * So until this file, the sentence *"a browser tab executes a translated artifact"* had
 * never been true of anything in this tree. That matters more than it sounds, because the
 * project's central bet is that **one codebase** runs unmodified in a tab and in Node, and
 * the WASI bridge is the single largest piece of machinery that had only ever been
 * measured on one of the two.
 *
 * ## Why an `.e2e` file and not a cheaper `wasi-real.browser.test.ts`
 *
 * A browser-project spec importing `WasiExecutor` and handing it these bytes would be
 * shorter, would run in three engines instead of one, and would prove **the wrong thing**.
 * It would establish *"V8-in-a-tab can run a lifted artifact"*, which nobody doubted. What
 * has never happened is the **composed chain** inside a tab routing to its WASI arm:
 * `guardSovereignty(provenance(new AbiExecutor({native: worker, wasi: new WasiExecutor(…)})))`,
 * built by `BrowserNode.start` (`browser-node.ts:1593`), reached over a real libp2p
 * connection by a real dispatch. Only a live tab has that object, so only an `.e2e` file
 * can read it.
 *
 * ## The topology
 *
 * Copied line-for-line from `browser-capability.e2e.test.ts`, whose header carries the
 * full reasoning: one tab and one `FabricNode` on a **direct WebSocket connection the tab
 * opened itself**, no relay, because a relay exists to let two browsers exchange SDP and
 * there is only one browser here. The tab is constructed by
 * `packages/browser/src/capability-harness.ts` rather than by `window.o2`, for that file's
 * own reason.
 *
 * One thing is deliberately different from that file: **every task here is `public`.**
 * `capability-authorizer.ts:109` returns `null` for any task whose label is not
 * `'sovereign'`, so no chain is needed and none is supplied — the subject is the executor
 * router, not the authorizer, and a capability chain in the frame would only add a way for
 * this file to go red for a reason it is not about. It also keeps the echo honest: the
 * guest copies its input to its output, and echoing a *sovereign* row back to a submitter
 * is the exact frame `EgressGuard.send` exists to refuse.
 *
 * ## How this file tells the WASI arm from the native one
 *
 * This is the assertion that carries the claim, and a reader should be able to check it
 * without trusting a summary. **Two dispatches into the same tab, in one run, differing
 * only in the module bytes:**
 *
 * | Module | Arm it must reach | Reading |
 * |---|---|---|
 * | the lifted echo guest (5.7 MB, elfconv output) | `wasi` | `ok: true`, output === the input value |
 * | `MODULE_ECHOES_INPUT` (146 bytes, hand-written) | `native` | `ok: true`, output === the same value |
 *
 * A translated artifact **cannot** produce a fabric result through `WasmExecutor` at all:
 * it fails at instantiate, naming `wasi_snapshot_preview1` (`abi-router.ts:25-27` quotes
 * the engine's own words). So case 1 completing is only possible via the WASI arm, and
 * case 2 completing in the same tab proves the native arm is simultaneously alive rather
 * than that the router has been wedged one way.
 *
 * **Both plants were run against this file and both were watched red**, in a tab, on
 * 2026-08-16 — `abi-router.ts:158` is the one line each edits:
 *
 * - `wantsWasi ? this.#native : this.#native` — the silent fallback. Case 1 red with
 *   *"lifted artifact refused: instantiation failed: WebAssembly.instantiate(): Import #0
 *   `wasi_snapshot_preview1`: module is not an object or function"*.
 * - `wantsWasi ? this.#wasi : this.#wasi` — the opposite wedge. Case 1 **green** and case
 *   2 red with the mirror text, *"Import #0 `o2`: module is not an object or function"*.
 *
 * The second is why both cases are here rather than one: it is the reading that separates
 * *"the router chose"* from *"one arm happens to answer everything"*, and no single-module
 * spec can take it. Note the pair is ordered — case 1 returns early on failure, so the
 * fallback plant never reaches case 2; it is the wedge plant that exercises both.
 *
 * **What the value equality does and does not add, stated exactly.** On *this* fixture the
 * two modules are echoes, so `ok: true` and a correct value are near-coextensive: any
 * corruption of the byte path yields bytes the codec refuses and surfaces as `ok: false`
 * (`not-dag-cbor`) rather than as a wrong value. No plant was found that moves the value
 * while leaving `ok` true, and none is claimed. The equality is kept because it is the
 * assertion that would catch an arm answering from a *different* block — a valid-but-wrong
 * output — and because the cross-arm comparison at the end of the case is the browser-tier
 * form of `aot-dispatch.node.test.ts`'s field-for-field claim. It is an assertion whose
 * failure mode is real and unexercised, not one whose teeth were demonstrated.
 *
 * ## The gate, stated rather than hidden
 *
 * **On a host without the lifted artifact, every case in this file is skipped and this
 * file proves nothing.** The artifact is `tools/aot/fixtures/lifted-echo-guest-<digest>.wasm`,
 * which `.gitignore:50` excludes — it is a build cache, not a committed fixture, and it is
 * ~5.7 MB. It is produced by `npx vitest run --project node packages/node/src/aot-dispatch.node.test.ts`
 * on a host with the elfconv image, or pointed at directly with `O2_AOT_ARTIFACT`. The
 * digest is `sha256(ECHO_GUEST_C).slice(0,16)`, recomputed here from the C rather than
 * written down, so a cached artifact can never be one lifted from different source —
 * `aot-dispatch.node.test.ts:125` is where that convention comes from, along with what it
 * does *not* cover (a moved toolchain).
 *
 * Unlike `aot-dispatch.node.test.ts` this file will **not** lift on demand: a lift is
 * minutes and needs Docker, and an `.e2e` file that shells out to a container toolchain
 * would put that cost inside a hook where `--reporter=json` attributes it to nothing. The
 * gate is presence, full stop, and the line below prints which way it went.
 *
 * ## What this file does not claim
 *
 * It does not observe `WebAssembly.instantiate` — nothing inside a page can, and
 * `browser-capability.e2e.test.ts` states the same limit about its own counter. It is
 * **one browser** (Chromium, driven by Playwright), not the three-engine matrix the
 * `browser` project runs, because the `e2e` project drives Playwright itself. And it is
 * one host: the artifact's cross-machine determinism remains the standing blind spot the
 * lift driver reports, and nothing here narrows it.
 */

// ---------------------------------------------------------------------------
// the gate
// ---------------------------------------------------------------------------

/**
 * The lifted echo guest, or `undefined` — the whole file's precondition.
 *
 * Resolution order matches `aot-dispatch.node.test.ts`: the `O2_AOT_ARTIFACT` override
 * first (which is `wasi-real.node.test.ts`'s `O2_LIFTED_WASM` convention applied to this
 * guest), then that file's own cache path.
 */
const ECHO_CACHE = fileURLToPath(
  new URL(
    `../../../tools/aot/fixtures/lifted-echo-guest-${createHash('sha256')
      .update(ECHO_GUEST_C)
      .digest('hex')
      .slice(0, 16)}.wasm`,
    import.meta.url,
  ),
)

function readOr(path: string | undefined): Uint8Array<ArrayBuffer> | undefined {
  if (path === undefined) return undefined
  try {
    return new Uint8Array(readFileSync(path))
  } catch {
    return undefined
  }
}

const LIFTED = readOr(LIFTED_ECHO) ?? readOr(existsSync(ECHO_CACHE) ? ECHO_CACHE : undefined)

console.log(
  `[aot-tab] O2_AOT_ARTIFACT=${LIFTED_ECHO ?? '(unset)'} cache=${ECHO_CACHE}` +
    ` present=${existsSync(ECHO_CACHE)} → measurable=${LIFTED !== undefined}` +
    (LIFTED === undefined ? ' (SKIPPED — this file proves nothing on this host)' : ''),
)

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const PAGE = 'packages/browser/harness/capability.html'

/**
 * The build authority both nodes pin — DET-03/DATA-08.
 *
 * The subject here is the executor router, not provenance; this record exists so that
 * subject can be reached at all, since an unsigned module is refused by `provenance`
 * before `AbiExecutor` ever sees it.
 *
 * Seed 58, adjacent to `browser-capability.e2e.test.ts`'s 57, so the two files that drive
 * the same harness page read as one family. Re-grepped across `fill(n)` and `keypair(n)`
 * in `packages/` and `tools/` on 2026-08-16: 57 is that file's, 58 was free.
 */
const publisher = (() => {
  const priv = new Uint8Array(32).fill(58)
  return { priv, pub: toHex(ed25519.getPublicKey(priv)) }
})()

/**
 * The value both arms must echo back, byte for byte.
 *
 * Distinct from every other fixture value in the repository, so a tab that answered from
 * some other file's seeded block would disagree rather than accidentally agree. Mixed
 * types on purpose: a `Uint8Array`-shaped guest that dropped everything but the first map
 * entry would still produce valid DAG-CBOR, and a single-key value could not tell.
 */
const ECHOED: CanonicalValue = {
  kind: 'aot-tab',
  shard: 'north-quay',
  weight: 4_211,
  ratio: '0.375',
}

/** Non-zero on purpose, matching `browser-capability.e2e.test.ts`'s reasoning. */
const PARTITION_INDEX = 2
const PARTITION_COUNT = 5

let submitter: FabricNode
let submitterAddr: string
let server: ViteDevServer
let browser: Browser
let context: BrowserContext
let page: Page
let tabPeerId: string
let workdir: string

describe.skipIf(LIFTED === undefined)('AOT-04 — a live browser tab runs a translated artifact', () => {
  // Inside the `describe`, not above it, so a host without the artifact launches no
  // Chromium and starts no libp2p node. Vitest does not run the hooks of a skipped suite.
  beforeAll(async () => {
    workdir = await mkdtemp(join(tmpdir(), 'o2-aot-tab-'))

    // No `rpcTimeoutMs` — the production default of 30 s is inherited rather than
    // narrowed, for `browser-capability.e2e.test.ts`'s reason. The lifted artifact is
    // ~5.7 MB and crosses this connection on the accepted dispatch, so that default is
    // being measured here rather than assumed: a run that completes is the evidence.
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

    // Rooted at the repo so workspace packages resolve and the harness page can load a
    // module from `src/`. Pre-bundling stays ON — see the note in `two-tabs.e2e.test.ts`.
    server = await createServer({ root: ROOT, logLevel: 'error', server: { port: 0 } })
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

    // `sovereignty` is required by `HarnessStartOptions` and is passed through unused:
    // every task below is `public`, so `guardSovereignty` is traversed and no-ops. It is
    // stated truthfully rather than stubbed, because a tab pinned to nobody is a different
    // node from one pinned to alice and this file should not quietly be measuring the
    // other one.
    tabPeerId = await page.evaluate(
      async ([address, anchor, ownerId, ownerKey]) =>
        window.o2capability.start({
          relayAddrs: [address!],
          blockstoreName: 'o2-aot-tab',
          trustAnchors: [anchor!],
          sovereignty: { ownerId: ownerId!, ownerKey: ownerKey!, canExecuteSovereign: true },
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

  it('the tab reserves nothing, is reachable over the connection it opened itself, and has run nothing', async () => {
    // The precondition every reading below rests on, asserted rather than assumed:
    // without it, a dispatch that never arrived is indistinguishable from one refused.
    expect(tabPeerId).not.toBe(submitter.peerId)
    expect(await page.evaluate(() => window.o2capability.peers())).toContain(submitter.peerId)
    expect(await page.evaluate(() => window.o2capability.executed())).toBe(0)
  }, 120_000)

  it('executes a real elfconv artifact through the tab’s WASI arm, and the same tab still runs a source-compiled module through its native arm', async () => {
    if (LIFTED === undefined) return

    const input = await canonicalCid(ECHOED)
    if (!input.ok) throw new Error('echo fixture does not encode')

    // Seeded into the tab's **local** store, so the only block this tab must go and fetch
    // is the module — which is what makes `hasBlock` below a clean instrument.
    const seeded = await page.evaluate(
      async (bytes) => window.o2capability.putBytes(bytes),
      [...input.bytes],
    )
    expect(seeded).toBe(input.cid.toString())

    const executed = async (): Promise<number> =>
      page.evaluate(() => window.o2capability.executed())
    const holds = async (cid: string): Promise<boolean> =>
      page.evaluate(async (value) => window.o2capability.hasBlock(value), cid)

    const record = (cid: Awaited<ReturnType<typeof submitter.store.put>>, name: string): NameRecord =>
      signName(publisher.priv, { name, cid, version: 1, expiresAt: Date.now() + 3_600_000 })

    // ---- 1. The translated artifact ------------------------------------------------
    //
    // Only the submitter holds it. The tab has a fresh IndexedDB and must pull ~5.7 MB
    // over the connection it opened — which it does only if it gets as far as executing.
    const liftedCid = await submitter.store.put(LIFTED)
    expect(await holds(liftedCid.toString())).toBe(false)

    const liftedTask: Task = {
      moduleCid: liftedCid,
      moduleRecord: record(liftedCid, 'aot-tab-lifted'),
      inputCid: input.cid,
      partitionIndex: PARTITION_INDEX,
      partitionCount: PARTITION_COUNT,
      label: 'public',
    }

    const dispatcher = new RemoteExecutor(tabPeerId, submitter.rpc, 'dispatches-unauthenticated')
    const lifted = await dispatcher.execute(liftedTask)

    // The whole claim, and the reading a native fallback cannot produce: routed to
    // `WasmExecutor`, this artifact fails at instantiate naming `wasi_snapshot_preview1`
    // and never reaches an output at all.
    expect(lifted.ok, lifted.ok ? '' : `lifted artifact refused: ${lifted.reason}`).toBe(true)
    if (!lifted.ok) return
    // The value, not merely `ok`. The echo guest copies stdin to stdout, `WasiExecutor`
    // presents the input block as stdin and decodes stdout as DAG-CBOR, so a run that
    // truncated or answered from a different block disagrees here while still saying `ok`.
    expect(lifted.output).toEqual(ECHOED)
    expect(await executed()).toBe(1)
    // It really did go and get the module — a tab that answered without fetching would
    // not have moved this.
    expect(await holds(liftedCid.toString())).toBe(true)

    // ---- 2. A source-compiled module, same tab, same input --------------------------
    //
    // The positive twin, and the half that makes case 1 a statement about *routing*.
    // `MODULE_ECHOES_INPUT` declares no WASI import, so `AbiExecutor` must send it the
    // other way; a router wedged onto its WASI arm turns *this* case red instead.
    const nativeCid = await submitter.store.put(MODULE_ECHOES_INPUT)
    expect(nativeCid.toString()).not.toBe(liftedCid.toString())
    expect(await holds(nativeCid.toString())).toBe(false)

    const native = await dispatcher.execute({
      moduleCid: nativeCid,
      moduleRecord: record(nativeCid, 'aot-tab-native'),
      inputCid: input.cid,
      partitionIndex: PARTITION_INDEX,
      partitionCount: PARTITION_COUNT,
      label: 'public',
    })

    expect(native.ok, native.ok ? '' : `source-compiled module refused: ${native.reason}`).toBe(true)
    if (!native.ok) return
    expect(native.output).toEqual(ECHOED)
    expect(await executed()).toBe(2)
    expect(await holds(nativeCid.toString())).toBe(true)

    // The equality across the two arms, stated as its own assertion rather than left to
    // be inferred from two comparisons against the same literal. This is the browser-tier
    // form of `aot-dispatch.node.test.ts`'s field-for-field claim.
    expect(lifted.output).toEqual(native.output)

    // Printed rather than only asserted, so the readings are on every run — the
    // convention `capability-dispatch.node.test.ts:448` established.
    console.log(
      `[browser tier] lifted ${LIFTED.length} bytes → ok, output echoed;` +
        ` source-compiled ${MODULE_ECHOES_INPUT.length} bytes → ok, same output;` +
        ` tab executor calls 0 → 1 → 2`,
    )
  }, 300_000)
})
