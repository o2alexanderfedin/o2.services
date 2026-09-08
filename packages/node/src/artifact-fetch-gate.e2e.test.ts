import { createServer as createHttpServer } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { fileURLToPath } from 'node:url'
import { KERNEL_RECORD, kernelBytes } from '@o2/demo'
import { chromium } from 'playwright'
import type { Browser, Page } from 'playwright'
import { createServer } from 'vite'
import type { ViteDevServer } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { fixtureViteCacheDir, launchFixtureBrowser } from './e2e-browser-launch.ts'
import { signInDemoTab } from './e2e-signin.ts'

/**
 * BROW-06 — consent blocks the **fetch**, read at the network rather than inferred.
 *
 * ## What this adds over P10, which already reads the request list
 *
 * `built-bundle.e2e.test.ts:149-219` (P10) asserts that every request the page makes before
 * consent has the page's **own origin**, over the whole request set, with a floor case so an
 * empty list cannot pass. It is the right shape and it is **structurally blind to the thing
 * BROW-06 forbids**: an artifact fetch served from the page's own origin passes P10 without
 * a murmur. P10's own docblock names the class — a filter *"can only refuse what it was told
 * to look for"* — and the origin predicate is the same shape one level up.
 *
 * BROW-06 is about **task bytes**, whatever origin serves them. So this file does not filter
 * a request list at all. It stands a second HTTP server up on its own port, hands the page
 * that origin as its gateway, and reads **that server's own log**: not "the tab did not ask
 * for anything suspicious" but "nobody was asked for the artifact".
 *
 * ## Two instruments, and the second is the one that decides
 *
 * `page.on('request')` sees what the tab tried to issue, including requests the page
 * swallows. The gateway server's log sees what actually **arrived**. They can disagree — a
 * request refused by the browser before it leaves shows in the first and not the second — and
 * the criterion is about what a reviewer watching network traffic sees, so the server's log
 * is the reading and the page-side list is the corroboration.
 *
 * ## Arm B is not a courtesy, it is what makes arm A a measurement
 *
 * A gateway log that is empty in both arms is an instrument that measures nothing, and this
 * repository has been caught by exactly that before — P10's floor case exists because *"a page
 * that fetched nothing would be a broken instrument reporting a clean result"*. So arm B
 * grants consent through the page's own button and requires the same call to produce a
 * **logged request at the server**.
 *
 * ## What arm A must NOT refuse with, and why the case is worded around it
 *
 * `demo/main.ts#fetchModule` opened with `required()` — which throws `node not started` —
 * until 2026-09-02. With that ordering the un-consented state was unreachable *through the
 * fetch*, so no network log could tell a consent gate from a node-state gate and removing the
 * consent check would have changed nothing an instrument could see. Arm A therefore asserts
 * three things and not one: the gateway log is empty, the refusal **names consent**, and the
 * call **did not throw** — a `node not started` here would mean the criterion is being
 * satisfied by the wrong mechanism, which is a finding rather than a pass.
 *
 * ## The second artifact-ingress path, answered rather than assumed
 *
 * The plan asks whether bytes could reach the tab's blockstore by a route this gate does not
 * cover — a bitswap block fetch over libp2p. **There is no such route in this repository.**
 * `bitswap` and `helia` appear in no source file under any package's `src` directory, nor
 * under `packages/browser/demo`; the single occurrence in the tree is the word "Helia" inside a
 * prose docblock at `packages/node/src/job-entry-points.node.test.ts:190`. Every remaining
 * ingress goes through libp2p, which requires a started node, and `demo/main.ts:1055` reads
 * `const granted = requireConsent()` as the first statement of `start()` — before
 * `probeEnvironment()`, before `BrowserNode.start` at `:1133` — and `requireConsent` throws
 * unless `readConsent` returns a `GrantedConsent`. So the two ingress paths are gated by two
 * different mechanisms and both are gated.
 *
 * **What that does not establish**, stated because the honest version is narrower than it
 * sounds: `BrowserNodeOptions` carries no consent field (`browser-node.ts:272-310` says so at
 * length — *"no parameter of `TabApi.start` carries one"*), so the start-path gate is a page
 * convention rather than a type. It holds for this demo page. An embedding host that called
 * `BrowserNode.start` directly would not be gated by it, and nothing here would notice.
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const PAGE = 'packages/browser/demo/index.html'

/** The artifact the gateway serves, and the CID the page will ask for it under. */
const MODULE_CID = KERNEL_RECORD.cid.toString()

let server: ViteDevServer
let baseUrl: string
let browser: Browser

/** Every path the gateway server was asked for, in order. Reset per arm. */
let gatewayLog: string[] = []
let gateway: Server
let gatewayOrigin: string

beforeAll(async () => {
  // A dumb static gateway: one artifact, `application/wasm`, and a log. Deliberately not a
  // Vite middleware and deliberately not the same origin as the page — the point of the
  // separate port is that "did anybody ask for the artifact" is answerable by one process
  // that has no other reason to be spoken to.
  gateway = createHttpServer((request, response) => {
    gatewayLog.push(request.url ?? '(no url)')
    if (request.url === `/${MODULE_CID}`) {
      response.writeHead(200, {
        'content-type': 'application/wasm',
        // The page's origin is not this one, so without CORS the browser refuses the read.
        // That refusal would happen *after* the request left, which is the wrong side of the
        // line this file measures: a request the gateway logged is a request that was made.
        'access-control-allow-origin': '*',
      })
      response.end(Buffer.from(kernelBytes))
      return
    }
    response.writeHead(404, { 'access-control-allow-origin': '*' })
    response.end('no such artifact')
  })
  await new Promise<void>((resolve) => gateway.listen(0, '127.0.0.1', resolve))
  const address = gateway.address()
  if (address === null || typeof address === 'string') {
    throw new Error('the gateway server bound no port')
  }
  gatewayOrigin = `http://127.0.0.1:${String((address as AddressInfo).port)}`

  server = await createServer({ root: ROOT, logLevel: 'error', server: { port: 0 }, cacheDir: fixtureViteCacheDir(ROOT) })
  await server.listen()
  const url = server.resolvedUrls?.local[0]
  if (url === undefined) throw new Error('vite dev server produced no URL')
  baseUrl = url.endsWith('/') ? url : `${url}/`

  browser = await launchFixtureBrowser(chromium)
}, 180_000)

afterAll(async () => {
  await browser?.close().catch(() => {})
  await server?.close().catch(() => {})
  await new Promise<void>((resolve) => {
    gateway?.close(() => resolve())
  })
}, 120_000)

/** What the page reported, plus whatever it threw — both are readings, and a throw is one. */
interface Attempt {
  readonly thrown: string | null
  readonly reason: string | null
  readonly ok: boolean | null
}

/**
 * Drive `window.o2.fetchModule` through the page and bring back what happened.
 *
 * The `try` is not defensive tidying. With no node started `fetchModule` reaches
 * `required()` **after** the fetch and throws `node not started` from the blockstore put — so
 * on the consented arm the call legitimately throws *having already made the request*, which
 * is the reading this file wants. Letting the throw escape would abort the case before the
 * gateway log could be read.
 */
async function attemptFetch(page: Page): Promise<Attempt> {
  return page.evaluate(
    async ([origin, cid]) => {
      try {
        const report = await window.o2.fetchModule({
          gatewayBase: `${origin!}/`,
          moduleCid: cid!,
          recordCid: cid!,
          recordName: 'kernel',
        })
        return { thrown: null, reason: report.ok ? null : report.reason, ok: report.ok }
      } catch (cause) {
        return { thrown: String(cause), reason: null, ok: null }
      }
    },
    [gatewayOrigin, MODULE_CID],
  )
}

describe('BROW-06 — no artifact bytes are requested before consent is recorded', () => {
  it('asks the gateway for nothing at all with consent absent, and says consent is why', async () => {
    gatewayLog = []
    const page = await browser.newPage()
    const requested: string[] = []
    page.on('request', (request) => requested.push(request.url()))

    await page.goto(`${baseUrl}${PAGE}`)
    await page.waitForFunction(() => typeof window.o2 !== 'undefined', null, { timeout: 60_000 })
    // Before consent, and measured rather than assumed — the window the claim is about.
    await page.waitForFunction(
      () => document.getElementById('gate')?.hasAttribute('hidden') === false,
      null,
      { timeout: 30_000 },
    )
    expect(await page.isVisible('#gate')).toBe(true)

    const attempt = await attemptFetch(page)
    // Long enough that a request in flight when `fetchModule` returned would have arrived.
    await page.waitForTimeout(1_000)

    // The reading that is the criterion: at the gateway's own server, nothing arrived.
    expect(
      gatewayLog,
      `BROW-06: with no consent recorded, the gateway server was asked for ${gatewayLog.join(', ')}. ` +
        'A reviewer watching network traffic reads a fetch as preparation-to-run; the gate has to ' +
        'sit in front of the request, not in front of the execution.',
    ).toEqual([])
    // The corroborating reading, from the page side.
    expect(requested.filter((url) => url.startsWith(gatewayOrigin))).toEqual([])

    // And the refusal is about consent — not about a node that has not started, which would
    // mean the gate above is being provided by the wrong mechanism.
    expect(
      attempt.thrown,
      'BROW-06: the un-consented fetch threw instead of refusing, so the zero above says nothing ' +
        'about a consent gate — it is a node-state gate, and removing the consent check would not ' +
        'change it',
    ).toBeNull()
    expect(attempt.ok).toBe(false)
    expect(attempt.reason).toContain('before you have agreed')
    expect(attempt.reason).not.toContain('node not started')

    await page.close()
  }, 180_000)

  it('asks the gateway for the artifact once consent is granted — the floor under the zero above', async () => {
    gatewayLog = []
    const page = await browser.newPage()
    const requested: string[] = []
    page.on('request', (request) => requested.push(request.url()))

    await page.goto(`${baseUrl}${PAGE}`)
    await page.waitForFunction(() => typeof window.o2 !== 'undefined', null, { timeout: 60_000 })
    // The page's own button, for `built-bundle.e2e.test.ts`'s stated reason: *"There is no
    // test-only bypass: the API refuses for the same reason the button is not there yet."*
    await page.waitForFunction(
      () => document.getElementById('gate')?.hasAttribute('hidden') === false,
      null,
      { timeout: 30_000 },
    )
    await page.click('#allow')
    // AUTH-06, `42-06` — the only change this file takes, and every assertion below is
    // untouched. `#allow` reveals `#signin`; `#main` is what UNLOCK reveals, and unlocking
    // is what `window.o2.start` now requires. **It does not produce a running node here**:
    // this fixture stands up a Vite server and a gateway server and no relay at all, so
    // `revealMain` finds nothing to dial and starts nothing — which is precisely why the
    // refusal below is still the blockstore put's rather than a consent refusal, exactly as
    // it was before this plan. The running-node reading is taken by
    // `signin-journey.e2e.test.ts`, on a fixture that has a relay.
    await signInDemoTab(page)

    const attempt = await attemptFetch(page)
    await page.waitForTimeout(1_000)

    expect(
      gatewayLog,
      'BROW-06 floor: with consent granted the same call still asked the gateway for nothing, so ' +
        'the empty log in the case above is a property of the instrument rather than of the gate',
    ).toEqual([`/${MODULE_CID}`])
    expect(requested.filter((url) => url === `${gatewayOrigin}/${MODULE_CID}`).length).toBe(1)

    // The fetch itself got that far; what happens next is the blockstore put reaching
    // `required()` on a page with no node, which **throws** — so the outcome arrives as
    // `thrown` rather than as a refusal, and both are read together. Asserted rather than
    // tolerated, because it is what proves the consent check is no longer the thing refusing
    // and that the ordering inside `fetchModule` is consent → fetch → `required()`.
    expect(
      `${attempt.thrown ?? ''} ${attempt.reason ?? ''}`,
      'BROW-06 floor: the consented call still refused on consent grounds',
    ).not.toContain('before you have agreed')
    expect(
      attempt.thrown,
      'BROW-06 ordering: with consent granted and no node started, the refusal that arrives must ' +
        'be the blockstore put’s — a consent refusal here would mean the gate is in front of the ' +
        'fetch for a reason other than consent',
    ).toContain('node not started')

    await page.close()
  }, 180_000)
})
