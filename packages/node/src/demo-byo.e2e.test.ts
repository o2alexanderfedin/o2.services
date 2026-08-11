import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ed25519 } from '@noble/curves/ed25519.js'
import { signName, toHex } from '@o2/core'
import { KERNEL_RECORD, KERNEL_TRUST_ANCHOR } from '@o2/demo'
import { chromium } from 'playwright'
import type { Browser, BrowserContext, Page } from 'playwright'
import { createServer } from 'vite'
import type { ViteDevServer } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FabricNode } from './fabric-node.ts'

/**
 * Both arms of bring-your-own, read off the screen — Plan 27-07, UI-SPEC section 4.5.
 *
 * ## The arm this file exists for
 *
 * **A module signed by a key this tab does not pin is refused, and the refusal is READ rather
 * than waited out.** That is the whole design of the surface: `TabApi.runJob` requires
 * `moduleRecord` by construction, and its docblock says why — making the field optional *would
 * let a caller write the refusal rather than the job and discover it as a timeout*. So the
 * refused arm below asserts on a rendered reason, records the elapsed time as a number, and
 * asserts that number against the accepted arm's. A future regression to timeout-discovery is
 * then visible as a figure rather than as a slow suite.
 *
 * ## Every reading is taken off the SCREEN and cross-checked against the run
 *
 * `window.__o2LastByoRun` is published by the page's own submit handler and is what each
 * screen reading is compared against — the same forcing function `window.__o2LastPiRun` is one
 * surface over. *The right value read from the wrong object* is the divergence class this
 * repository's mutation ledger records against this tier; without the hook this file could
 * only compare the page with itself.
 *
 * ## The form is driven through its own inputs, never through `page.evaluate`
 *
 * `page.fill`, `page.check`, `page.uncheck`. The validity model and the disabled reason are
 * part of what this surface delivers, and a harness that wrote page state directly would test
 * neither.
 *
 * ## Why the form opens filled, and what that costs this file
 *
 * `scripts/sign-kernel.ts` discards its private half on every run, so the only records in
 * existence under the anchor a stock tab pins are the two committed in
 * `packages/demo/src/kernel-record.ts`. An empty form would open at a state no visitor could
 * ever leave. It opens on `KERNEL_RECORD`, and this file's accepted arm therefore presses the
 * control **without typing anything** — which is also what lets
 * `demo-liveness.e2e.test.ts`'s P5 drive this surface with no edit to it.
 *
 * What it costs: the accepted arm dispatches the demo's colouring kernel against `runJob`'s
 * canonical `{a: <shard index>}`, which is not a colouring problem. The guest answers it
 * deterministically with a well-formed partial carrying **no partition field**, every replica
 * agrees, and every entry of `report.partitions` is the `-1` sentinel for a reason that is not
 * *no agreement*. That is measured here rather than assumed, and it is why `surfaces/byo.ts`
 * reads `partitions[i]` beside `agreeing[i]`.
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const PAGE = 'packages/browser/demo/index.html'

/** UI-SPEC's Y6 unavailable sentence, quoted so a reworded page reddens rather than passes. */
const NO_PLACEMENT = 'No placement: no shard reached agreement.'
/** UI-SPEC's Y10 unavailable sentence. */
const NO_REFUSALS = 'No refusals: every shard reached agreement.'

/**
 * A key nobody pins. Seed 53, distinct from every other fixture key in this repository
 * (1-3, 9, 11-12, 21-24, 30-31, 40-42, 50-52, 60, 70-82, 90-98), so a mixed-up key produces a
 * clear untrusted-signer refusal rather than an accidental pass.
 */
const unpinnedPriv = new Uint8Array(32).fill(53)
const unpinnedPub = toHex(ed25519.getPublicKey(unpinnedPriv))

/**
 * A record that is genuine in every respect except the one that matters.
 *
 * Same name, same CID, same version, same expiry as `KERNEL_RECORD` — correctly signed, over
 * the real payload, naming the module actually dispatched — and signed by a key this tab does
 * not pin. **Minted here rather than corrupted**: a malformed signature would produce a
 * different refusal, and the claim this file makes is about *provenance*, not about parsing.
 */
const forged = signName(unpinnedPriv, {
  name: KERNEL_RECORD.name,
  cid: KERNEL_RECORD.cid,
  version: KERNEL_RECORD.version,
  expiresAt: KERNEL_RECORD.expiresAt,
})

/** The report the page published about the dispatch it just rendered. */
interface ByoHook {
  readonly complete: boolean
  readonly partitions: readonly number[]
  readonly agreeing: readonly (readonly string[])[]
  readonly replicas: readonly number[]
  readonly verificationMultiplier: number
  readonly fetched: number
  readonly rejected: number
  readonly failures: readonly { readonly nodeId: string; readonly reason: string }[]
  readonly egress: {
    readonly entries: readonly unknown[]
    readonly totalBytes: number
    readonly violations: readonly string[]
    /**
     * EGR-01. Declared here because this file's sovereign arms assert the rendered sentence
     * against it: it is the only field on the manifest that can tell *the run registered no
     * sovereign data* from *the guard saw no sovereign data leave*, and reading the page
     * without it is how this file spent two days requiring the false one.
     */
    readonly registeredSovereign: number
  }
  readonly attestation: { readonly kind?: string; readonly description?: string; readonly reason?: string }
}

/** One `[data-region]` inside `#s-byo`, as plain data. */
interface ByoRegion {
  readonly id: string
  readonly text: string
}

let relay: FabricNode
let relayAddr: string
let server: ViteDevServer
let browser: Browser
let baseUrl: string
let workdir: string
const contexts: BrowserContext[] = []
let tabA: Page
let tabB: Page

async function openPage(name: string, query: string): Promise<Page> {
  const context = await browser.newContext()
  contexts.push(context)
  const page = await context.newPage()
  page.on('pageerror', (error) => {
    process.stderr.write(`[${name}] page error: ${error.message}\n`)
  })
  page.on('console', (message) => {
    if (message.type() === 'error') process.stderr.write(`[${name}] console: ${message.text()}\n`)
  })
  await page.goto(`${baseUrl}${PAGE}${query}`)
  await page.waitForFunction(() => typeof window.o2 !== 'undefined', null, { timeout: 60_000 })
  // BROW-01 has no test-only bypass: a harness consents by pressing the button a visitor
  // presses, and joins by pressing the button a visitor presses.
  await page.click('#allow')
  await page.waitForSelector('#main', { state: 'visible', timeout: 30_000 })
  return page
}

/** Select the surface the way a visitor does — the tab, which writes the hash. */
async function showByo(page: Page): Promise<void> {
  await page.click('#nav-byo')
  await page.waitForSelector('#s-byo', { state: 'visible', timeout: 30_000 })
}

/**
 * Press `Dispatch this module` and wait for the surface's own text view to be rewritten.
 *
 * Returns the elapsed milliseconds. The refused arm asserts on that number: a refusal
 * discovered as a timeout is the failure this surface exists to prevent, and a summary that
 * only said *it passed* would not notice the day it starts being discovered that way again.
 */
async function dispatch(page: Page, budgetMs: number): Promise<number> {
  await page.waitForFunction(
    () => document.getElementById('run-byo')?.hasAttribute('disabled') === false,
    null,
    { timeout: 120_000 },
  )
  const before = (await page.textContent('#byo-report')) ?? ''
  const started = Date.now()
  await page.click('#run-byo')
  // The text view and the thirteen regions are written by one `applyRender` call, so the view
  // changing IS the dispatch having produced a reading. The control is deliberately not the
  // signal: this page's reconciler re-enables it on a one-second tick.
  await page.waitForFunction(
    (was) => (document.getElementById('byo-report')?.textContent ?? '') !== was,
    before,
    { timeout: budgetMs },
  )
  return Date.now() - started
}

/** Every bring-your-own region, off the screen. */
async function byoRegions(page: Page): Promise<ByoRegion[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('#s-byo [data-region]')).map((element) => ({
      id: element.getAttribute('data-region') ?? '',
      text: (element.textContent ?? '').trim(),
    })),
  )
}

/** The report the page published, read fresh in the same page. */
async function byoHook(page: Page): Promise<ByoHook> {
  const raw = await page.evaluate(() => {
    const value = (window as unknown as Record<string, unknown>)['__o2LastByoRun']
    return value === undefined || value === null ? null : JSON.stringify(value)
  })
  expect(
    raw,
    'the page published no window.__o2LastByoRun, so every reading below would be the page compared against itself',
  ).not.toBeNull()
  return JSON.parse(raw as string) as ByoHook
}

/** P8's hook, read fresh in the same page — the receipt this surface rendered. */
async function attestationHook(page: Page): Promise<{ description?: string; reason?: string }> {
  const raw = await page.evaluate(() => {
    const value = (window as unknown as Record<string, unknown>)['__o2LastAttestation']
    return value === undefined || value === null ? null : JSON.stringify(value)
  })
  expect(raw, 'the page published no window.__o2LastAttestation for this dispatch').not.toBeNull()
  return JSON.parse(raw as string) as { description?: string; reason?: string }
}

/**
 * Print every region, verbatim, for the arm named.
 *
 * Not decoration. 27-04's summary had to be corrected because it *inferred* regions from the
 * shipped symbols and then said it had read them. A summary claiming what is on screen should
 * be quoting this output and nothing else.
 */
function printRegions(arm: string, regions: readonly ByoRegion[]): void {
  for (const region of regions) {
    process.stderr.write(`[${arm}] ${region.id} = ${region.text.replace(/\n/g, ' ⏎ ')}\n`)
  }
}

function textOf(regions: readonly ByoRegion[], id: string): string {
  const found = regions.find((region) => region.id === id)
  expect(found, `${id} is not on the bring-your-own surface at all`).toBeDefined()
  return (found as ByoRegion).text
}

/** The disabled control's visible reason, and whether the control is disabled. */
async function control(page: Page): Promise<{ disabled: boolean; reason: string }> {
  return page.evaluate(() => ({
    disabled: (document.getElementById('run-byo') as HTMLButtonElement).disabled,
    reason: (document.getElementById('byo-validity')?.textContent ?? '').trim(),
  }))
}

/** Put the form back to this bundle's own record, through the page's own inputs. */
async function restoreDefaults(page: Page): Promise<void> {
  await page.fill('#byo-module-cid', KERNEL_RECORD.cid.toString())
  await page.fill('#byo-record-name', KERNEL_RECORD.name)
  await page.fill('#byo-record-cid', KERNEL_RECORD.cid.toString())
  await page.fill('#byo-record-version', String(KERNEL_RECORD.version))
  await page.fill('#byo-record-expires', String(KERNEL_RECORD.expiresAt))
  await page.fill('#byo-record-signer', KERNEL_RECORD.signer)
  await page.fill('#byo-record-signature', KERNEL_RECORD.signature)
  await page.uncheck('#byo-sovereign')
  await page.fill('#byo-owner-id', '')
}

beforeAll(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'o2-demo-byo-'))
  // DET-03: the demo's own anchor, matching what `bin/seed.ts` pins with no flags. The tabs
  // dispatch the demo's signed kernel, so the authority that vouches for it is the one that
  // belongs in the relay too.
  relay = await FabricNode.start({
    relayAdmission: 'admits-any-peer',
    startReporting: 'reports-its-own-start',
    maxReservations: 16,
    listen: ['/ip4/127.0.0.1/tcp/0/ws'],
    trustAnchors: [KERNEL_TRUST_ANCHOR],
  })
  const address = relay.browserDialableAddrs[0]
  if (address === undefined) throw new Error('relay produced no browser-dialable address')
  relayAddr = address

  server = await createServer({ root: ROOT, logLevel: 'error', server: { port: 0 } })
  await server.listen()
  const url = server.resolvedUrls?.local[0]
  if (url === undefined) throw new Error('vite dev server produced no URL')
  baseUrl = url.endsWith('/') ? url : `${url}/`

  browser = await chromium.launch()
}, 420_000)

afterAll(async () => {
  for (const context of contexts) await context.close().catch(() => {})
  await browser?.close().catch(() => {})
  await server?.close().catch(() => {})
  await relay?.stop().catch(() => {})
  await rm(workdir, { recursive: true, force: true })
}, 180_000)

describe('bring your own — the record is required, and the refusal is read rather than timed out', () => {
  /** Filled by the accepted arm and compared against by the refused arm's elapsed reading. */
  let acceptedMs = 0
  let refusedMs = 0

  it('has two nodes computing, on the page, before anything is dispatched', async () => {
    // Opened and joined one at a time, which is `demo-liveness.e2e.test.ts`'s order rather
    // than a preference: the two tabs find each other through the relay's reservation store,
    // and a tab that has not reserved yet is not there to be found.
    const join = async (name: string): Promise<Page> => {
      const page = await openPage(name, `?relay=${encodeURIComponent(relayAddr)}`)
      await page.waitForFunction(
        () => document.getElementById('join')?.hasAttribute('disabled') === false,
        null,
        { timeout: 60_000 },
      )
      await page.click('#join')
      await page.waitForFunction(
        () => document.getElementById('state')?.dataset['tone'] === 'live',
        null,
        { timeout: 120_000 },
      )
      return page
    }
    tabA = await join('a')
    tabB = await join('b')

    // One harness intervention, named: tab A dials tab B's WebRTC address once, as every
    // other two-tab spec here does. Rendezvous over the relay's reservation store would get
    // there on its own timetable; the dial makes *when* deterministic without changing *what*.
    const bAddrs = await tabB.evaluate(async () => window.o2.waitForWebrtcAddr(120_000))
    const bPeerId = await tabB.evaluate(() => window.o2.addresses().peerId)
    expect(await tabA.evaluate(async (addr) => window.o2.dial(addr), bAddrs[0] as string)).toBe(
      bPeerId,
    )

    await tabA.waitForFunction(
      () => (document.getElementById('peers')?.textContent ?? '').includes('2 node(s) computing'),
      null,
      { timeout: 120_000 },
    )
    expect(await tabA.textContent('#peers')).toContain('2 node(s) computing')
    await showByo(tabA)
  }, 900_000)

  /**
   * UI-SPEC section 7.5, and the copy the surface exists to put on screen before a refusal.
   *
   * Asserted before anything is dispatched, because that is the whole claim: a visitor is told
   * that this tab pins one authority *first*, not after waiting out a job.
   */
  it('states the provenance rule above the form, and labels every input visibly', async () => {
    const shape = await tabA.evaluate(() => {
      const panel = document.getElementById('s-byo') as HTMLElement
      const inputs = Array.from(panel.querySelectorAll('input'))
      return {
        notice: (document.getElementById('byo-notice')?.textContent ?? '').trim(),
        primaries: panel.querySelectorAll('.btn-primary').length,
        buttons: panel.querySelectorAll('button').length,
        describedBy: document.getElementById('run-byo')?.getAttribute('aria-describedby') ?? '',
        formDescribedBy: document.getElementById('byo-form')?.getAttribute('aria-describedby') ?? '',
        statusRole: document.getElementById('byo-status')?.getAttribute('role') ?? '',
        unlabelled: inputs
          .filter((input) => document.querySelector(`label[for="${input.id}"]`) === null)
          .map((input) => input.id),
        placeholders: inputs
          .filter((input) => input.getAttribute('placeholder') !== null)
          .map((input) => input.id),
        values: Object.fromEntries(
          inputs
            .filter((input) => input.type !== 'checkbox')
            .map((input) => [input.id, input.value]),
        ),
        sovereignChecked: (document.getElementById('byo-sovereign') as HTMLInputElement).checked,
      }
    })

    // The copy, verbatim on the four clauses that carry the claim.
    expect(shape.notice).toContain('This tab pins one build authority')
    expect(shape.notice).toContain('refused by every executor it reaches')
    expect(shape.notice).toContain('in the fabric’s own words')
    expect(shape.notice).toContain('there is no value you can enter here that turns the check off')

    // UI-SPEC section 7.5: a visible label per input, and no placeholder standing in for one.
    expect(shape.unlabelled, 'an input on this form has no visible label').toEqual([])
    expect(shape.placeholders, 'a placeholder is standing in for a label').toEqual([])
    // A floor: an empty input set would satisfy both of the above.
    expect(Object.keys(shape.values).length).toBe(8)

    // One primary, and no other button at all — so P5 in `demo-liveness.e2e.test.ts` has
    // exactly one control to discover and drive on this surface.
    expect(shape.primaries).toBe(1)
    expect(shape.buttons).toBe(1)
    expect(shape.describedBy).toBe('byo-validity')
    expect(shape.formDescribedBy).toBe('byo-failures')
    expect(shape.statusRole).toBe('status')

    // The form opens on this bundle's own record — the only one in existence under the anchor
    // this tab pins, because `sign-kernel.ts` discards its private half at signing time.
    expect(shape.values['byo-module-cid']).toBe(KERNEL_RECORD.cid.toString())
    expect(shape.values['byo-record-name']).toBe(KERNEL_RECORD.name)
    expect(shape.values['byo-record-cid']).toBe(KERNEL_RECORD.cid.toString())
    expect(shape.values['byo-record-version']).toBe(String(KERNEL_RECORD.version))
    expect(shape.values['byo-record-expires']).toBe(String(KERNEL_RECORD.expiresAt))
    expect(shape.values['byo-record-signer']).toBe(KERNEL_RECORD.signer)
    expect(shape.values['byo-record-signature']).toBe(KERNEL_RECORD.signature)
    expect(shape.values['byo-owner-id']).toBe('')
    expect(shape.sovereignChecked).toBe(false)

    // Y1, on screen and equal to the anchor a stock tab pins.
    const regions = await byoRegions(tabA)
    expect(textOf(regions, 'byo/pinned-anchor')).toBe(KERNEL_TRUST_ANCHOR)
    expect(textOf(regions, 'byo/shard-input')).toContain('{ a: <shard index> }')
    expect(textOf(regions, 'byo/shard-input')).toContain('carries no caller-supplied input')
  }, 120_000)

  /**
   * The validity model, driven through the page's own inputs.
   *
   * Every case here asserts the control is disabled **and** that the reason names the field,
   * because a disabled control with no reason is the same defect as a placeholder — UI-SPEC
   * section 4.5 says so in those words.
   */
  it('disables the control with a reason naming every field it is missing', async () => {
    const ready = await control(tabA)
    // The floor. Every negative below is only a reading if the control is seen enabled first.
    expect(ready.disabled, 'the control is already disabled before anything was cleared').toBe(false)
    expect(ready.reason, 'the reason element is empty while the form is valid').not.toBe('')
    process.stderr.write(`[validity] ready → "${ready.reason}"\n`)

    const cases: { readonly what: string; readonly apply: () => Promise<void>; readonly names: string }[] = [
      {
        what: 'the module CID cleared',
        apply: async () => tabA.fill('#byo-module-cid', ''),
        names: 'module CID',
      },
      {
        what: 'the record signature cleared',
        apply: async () => tabA.fill('#byo-record-signature', ''),
        names: 'record signature',
      },
      {
        what: 'the record version made unparsable',
        apply: async () => tabA.fill('#byo-record-version', 'one'),
        names: 'record version',
      },
      {
        what: "the record's cid disagreeing with the module cid",
        apply: async () => tabA.fill('#byo-record-cid', KERNEL_RECORD.cid.toString().slice(0, -1)),
        names: "the record's cid does not match the module cid",
      },
      {
        what: 'the sovereign box checked with no owner id',
        apply: async () => tabA.check('#byo-sovereign'),
        names: 'owner id',
      },
    ]

    for (const arm of cases) {
      await restoreDefaults(tabA)
      await arm.apply()
      const state = await control(tabA)
      process.stderr.write(`[validity] ${arm.what} → disabled=${state.disabled} "${state.reason}"\n`)
      expect(state.disabled, `${arm.what}: the control is still enabled`).toBe(true)
      expect(state.reason, `${arm.what}: the disabled state carries no reason`).not.toBe('')
      expect(state.reason, `${arm.what}: the reason does not name it`).toContain(arm.names)
    }

    // Nothing was dispatched by any of the above: the text view still holds its pre-run
    // literal, which is the only way to say *the form refused rather than the fabric*.
    expect((await tabA.textContent('#byo-report'))?.trim()).toBe('nothing dispatched yet')
    await restoreDefaults(tabA)
    expect((await control(tabA)).disabled).toBe(false)
  }, 300_000)

  /** THE ACCEPTED ARM. The form as it opens, dispatched with nothing typed. */
  describe('a record this tab pins', () => {
    let regions: readonly ByoRegion[] = []
    let hook: ByoHook
    let report = ''

    it('dispatches and completes, with every reading equal to the run', async () => {
      await restoreDefaults(tabA)
      acceptedMs = await dispatch(tabA, 900_000)
      regions = await byoRegions(tabA)
      hook = await byoHook(tabA)
      report = (await tabA.textContent('#byo-report')) ?? ''

      process.stderr.write(
        `[accepted] ${acceptedMs}ms complete=${hook.complete} shards=${hook.partitions.length} ` +
          `multiplier=${hook.verificationMultiplier} failures=${hook.failures.length} ` +
          `partitions=[${hook.partitions.join(',')}] ` +
          `violations=${hook.egress.violations.length}\n`,
      )
      printRegions('accepted', regions)

      expect(hook.complete).toBe(true)
      expect(hook.failures).toEqual([])

      // Y3, Y7, Y8, Y9 — against the run, never against a literal this file holds.
      expect(textOf(regions, 'byo/complete')).toBe('true')
      expect(textOf(regions, 'byo/verification-multiplier')).toBe(
        hook.verificationMultiplier.toFixed(2) + '×',
      )
      expect(textOf(regions, 'byo/fetched')).toBe(String(hook.fetched))
      expect(textOf(regions, 'byo/rejected')).toBe(String(hook.rejected))
      // P6's property on this surface: the multiplier's string occurs character for character
      // in the surface's own text view, because both come out of one record.
      expect(report).toContain(hook.verificationMultiplier.toFixed(2) + '×')

      // Y5 — one row per shard, and the counts are the run's. Every shard agreed on this
      // arm, so every row is a number; the refused arm below is where the sentinel appears.
      expect(textOf(regions, 'byo/replicas').split('\n')).toEqual(
        hook.replicas.map((replicas, index) => `shard ${index}: ${replicas}`),
      )
      for (const replicas of hook.replicas) expect(replicas).toBeGreaterThan(0)

      // Y6 — placement, naming the nodes the run named.
      const placement = textOf(regions, 'byo/agreeing')
      expect(placement).not.toBe(NO_PLACEMENT)
      for (const [index, nodes] of hook.agreeing.entries()) {
        expect(placement).toContain(`shard ${index}: ${nodes.join(', ')}`)
      }

      // Y10 — no refusals, said in UI-SPEC's own words rather than as an empty element.
      expect(textOf(regions, 'byo/failures')).toBe(NO_REFUSALS)

      // Y13 — this dispatch carried no owner.
      expect(textOf(regions, 'byo/sovereign-label')).toContain('public')
      expect(textOf(regions, 'byo/sovereign-label')).toContain('nothing in it was registered')
    }, 900_000)

    /**
     * Y4, and the measurement that made this file's Y4 rendering what it is.
     *
     * Every partition is `-1` here, and **not because a shard failed to agree** — `complete` is
     * true and every shard has agreeing replicas. `runJob` derives the index from `output.p`
     * and the demo's colouring kernel writes `{c, s}`, so the sentinel means *this module wrote
     * no index*. Rendering UI-SPEC's `no agreement` there would say the opposite of what the
     * run reports one field over, which is why `surfaces/byo.ts` reads the two together.
     */
    it('never renders the partition sentinel as a number, and never as the wrong sentence', () => {
      const rows = textOf(regions, 'byo/partitions').split('\n')
      expect(rows.length).toBe(hook.partitions.length)
      for (const [index, partition] of hook.partitions.entries()) {
        const agreed = (hook.agreeing[index] ?? []).length > 0
        const row = rows[index] as string
        expect(row).not.toContain('-1')
        if (!agreed) {
          expect(row).toBe(`shard ${index}: no agreement`)
        } else if (partition < 0) {
          expect(row).toBe(`shard ${index}: no partition index — this module’s output carries no such field`)
        } else {
          expect(row).toBe(`shard ${index}: ${partition}`)
        }
      }
      // The reading this case is about, recorded as a fact rather than left implicit: these
      // shards agreed AND carry the sentinel, which is the pair UI-SPEC's Y4 row does not cover.
      const agreedWithSentinel = hook.partitions.filter(
        (partition, index) => partition < 0 && (hook.agreeing[index] ?? []).length > 0,
      ).length
      process.stderr.write(
        `[accepted] shards that agreed and carry the -1 sentinel: ${agreedWithSentinel} of ${hook.partitions.length}\n`,
      )
    })

    it("renders the receipt in the kernel's own words, checked against a fresh reading", async () => {
      const attestation = await attestationHook(tabA)
      const rendered = textOf(regions, 'byo/attestation')
      // Section 5.1 and P8: the receipt arm equals `description` exactly; the absence arm
      // contains `reason` verbatim. Compared against a reading taken in the same page.
      if (attestation.description !== undefined) {
        expect(rendered).toBe(attestation.description)
      } else {
        expect(attestation.reason).toBeDefined()
        expect(rendered).toContain(attestation.reason as string)
      }
      process.stderr.write(`[accepted] attestation → ${rendered.replace(/\n/g, ' ⏎ ')}\n`)
    })

    it('measures what left the device, count and sentence inseparable', () => {
      const egress = textOf(regions, 'byo/egress')
      expect(egress).toContain('What left this device:')
      expect(egress).toContain('withheld')
      // Y12's arm for a public dispatch. The count alone would read as a sovereignty proof.
      //
      // EGR-01: the sentence is asserted together with the manifest fact that makes it TRUE
      // here, which is what the sovereign arms further down assert the negative of. This
      // dispatch left `#byo-sovereign` unchecked, so nothing was registered and the guard
      // really did have nothing to hold back.
      expect(hook.egress.registeredSovereign).toBe(0)
      expect(egress).toContain('registered no sovereign data')
      expect(report).toContain('withheld')
    })
  })

  /** THE REFUSED ARM. Same CID, same name, same expiry — a signer this tab does not pin. */
  describe('a record signed by a key this tab does not pin', () => {
    let regions: readonly ByoRegion[] = []
    let hook: ByoHook

    it('is refused, and the refusal is on screen inside the normal timeout', async () => {
      await restoreDefaults(tabA)
      // Only two fields change. The record is correctly signed over the real payload, names
      // the module actually dispatched, and has not expired — so the only thing wrong with it
      // is who signed it, which is what makes this a provenance reading and not a parse one.
      await tabA.fill('#byo-record-signer', forged.signer)
      await tabA.fill('#byo-record-signature', forged.signature)
      expect(forged.signer).toBe(unpinnedPub)
      expect(forged.signer).not.toBe(KERNEL_TRUST_ANCHOR)
      expect((await control(tabA)).disabled, 'a well-formed record is refused by the FORM').toBe(
        false,
      )

      refusedMs = await dispatch(tabA, 900_000)
      regions = await byoRegions(tabA)
      hook = await byoHook(tabA)

      process.stderr.write(
        `[refused] ${refusedMs}ms complete=${hook.complete} failures=${hook.failures.length}\n`,
      )
      for (const failure of hook.failures) {
        process.stderr.write(`[refused] ${failure.nodeId}: ${failure.reason}\n`)
      }
      printRegions('refused', regions)

      expect(hook.complete).toBe(false)
      // Asserted before anything about the text: a `some()` over an empty array is `false` for
      // the wrong reason and would read as a passing test that measured nothing.
      expect(hook.failures.length).toBeGreaterThan(0)

      // **The claim this arm exists for.** The refusal was rendered, and it was rendered
      // without waiting out a timeout. Compared against the accepted arm taken in the same
      // run rather than against an absolute, so the reading survives a slower machine.
      expect(
        refusedMs,
        `the refusal took ${refusedMs}ms against an accepted dispatch's ${acceptedMs}ms in the same run — a refusal that costs an order of magnitude more than an acceptance is one being discovered as a timeout`,
      ).toBeLessThan(Math.max(acceptedMs * 10, 60_000))
    }, 900_000)

    it("renders every refusal verbatim, nodeId and reason, in the fabric's own words", () => {
      const rendered = textOf(regions, 'byo/failures')
      expect(rendered).not.toBe(NO_REFUSALS)
      // **Verbatim**, compared against what the run returned rather than against a string this
      // file holds. A page that prefixed or paraphrased the reason would still contain a line
      // per failure, which is why the comparison is against the hook and is exact.
      for (const failure of hook.failures) {
        expect(rendered).toContain(`${failure.nodeId}: ${failure.reason}`)
      }
      expect(rendered.split('\n').length).toBe(hook.failures.length)
      // The refusal is a PROVENANCE refusal — the thing this surface's copy promises — and not
      // a dropped connection that happened to produce the same boolean.
      expect(hook.failures.some((failure) => failure.reason.includes('not a pinned trust anchor'))).toBe(
        true,
      )
    })

    it('says no shard was placed, in UI-SPEC’s own sentence', () => {
      expect(textOf(regions, 'byo/agreeing')).toBe(NO_PLACEMENT)
      expect(textOf(regions, 'byo/complete')).toBe('false')
      // Every shard's row says no agreement — and here that sentence is TRUE, which is the
      // pair the accepted arm above showed is not automatic.
      for (const [index, nodes] of hook.agreeing.entries()) {
        expect(nodes).toEqual([])
        expect(textOf(regions, 'byo/partitions')).toContain(`shard ${index}: no agreement`)
      }
    })

    /**
     * The other two sentinels, and the one that would be easiest to ship by accident.
     *
     * `main.ts` maps a shard that did not agree to `replicas: 0`, and `submitJob` computes
     * `verificationMultiplier` as `useful === 0 ? 0 : gross / useful` — so on a run where
     * nothing agreed both fields are **zero as a sentinel**. Rendered as figures they read
     * *no replicas were needed* and *verification was free*, directly above eighteen
     * refusals. Measured here rather than reasoned about: both zeros are real in the hook
     * and neither reaches the screen as a quantity.
     */
    it('renders no zero for the replica count or the verification cost', () => {
      expect(hook.verificationMultiplier).toBe(0)
      for (const replicas of hook.replicas) expect(replicas).toBe(0)

      expect(textOf(regions, 'byo/verification-multiplier')).toBe(
        'No cost measured: no shard produced an answer, so there is no verified work to divide the total by.',
      )
      expect(textOf(regions, 'byo/replicas').split('\n')).toEqual(
        hook.replicas.map((_unused, index) => `shard ${index}: no agreement`),
      )

      // The sweep, with its two exemptions stated rather than quietly excluded.
      //
      // `byo/fetched` and `byo/rejected` are `activity()`-style counters: their zero is a
      // real observation — this tab pulled no block over the wire and refused none for a CID
      // mismatch — and prose in place of it would be replacing a measurement with a sentence.
      // Every other zero on this surface is written by the fabric as a stand-in for *there
      // was nothing to report*, and those are the ones a figure must never carry.
      const TRUE_COUNTERS = ['byo/fetched', 'byo/rejected']
      const zeros = regions
        .filter((region) => /^\s*0(\.0+)?×?\s*$/.test(region.text))
        .map((region) => region.id)
      expect(
        zeros.filter((id) => !TRUE_COUNTERS.includes(id)),
        'a bring-your-own region reads as the quantity zero on a run where nothing was measured',
      ).toEqual([])
      // And the exemption is not a hole: both counters are asserted to be exactly the run's
      // own figures in the accepted arm above, and here they are asserted to be what the hook
      // says rather than merely tolerated at zero.
      expect(textOf(regions, 'byo/fetched')).toBe(String(hook.fetched))
      expect(textOf(regions, 'byo/rejected')).toBe(String(hook.rejected))
    })
  })

  /** THE SOVEREIGN ARM. The one dispatch in this demo that can register an owner row. */
  describe('the sovereign option, which is one control pair', () => {
    /**
     * The owner id every node descriptor this page builds declares.
     *
     * `attestedNodes` in `packages/browser/demo/main.ts` hardcodes `ownerId: 'public'` on every
     * descriptor it returns, and `eligibleNodes` (`packages/core/src/sovereignty.ts`) places a
     * sovereign shard only on a node whose `ownerId` **equals** the shard's. So this literal
     * is the one owner id a dispatch from this page can be placed for, and every other one is
     * correctly reported as unplaceable. The next case asserts that the literal is still there,
     * so the day a tab is handed a real owner identity this arm reddens and is re-planned
     * rather than quietly measuring something else.
     */
    const OWNER_THE_NODES_DECLARE = 'public'
    /** An owner id no node in this fabric declares. */
    const OWNER_NOBODY_DECLARES = 'o2-demo-byo-owner'

    it('EGR-01 — is refused as unplaceable for an owner no node declares, and nothing leaves the device', async () => {
      await restoreDefaults(tabA)
      await tabA.check('#byo-sovereign')
      // Checked with no owner id, the control is disabled and names the field. Asserted here
      // as well as in the validity block, because this is the state a visitor reaches by
      // pressing the checkbox rather than by clearing something.
      const half = await control(tabA)
      expect(half.disabled).toBe(true)
      expect(half.reason).toContain('owner id')

      await tabA.fill('#byo-owner-id', OWNER_NOBODY_DECLARES)
      expect((await control(tabA)).disabled).toBe(false)

      const elapsed = await dispatch(tabA, 900_000)
      const regions = await byoRegions(tabA)
      const hook = await byoHook(tabA)
      process.stderr.write(
        `[sovereign·unowned] ${elapsed}ms complete=${hook.complete} ` +
          `frames=${hook.egress.entries.length} bytes=${hook.egress.totalBytes} ` +
          `violations=${hook.egress.violations.length}\n`,
      )
      printRegions('sovereign·unowned', regions)

      // The sovereignty property, seen from the submitter's side: a shard nobody may run is
      // stalled rather than run somewhere else. Nothing left the device because there was
      // nowhere it was allowed to go.
      expect(hook.complete).toBe(false)
      for (const nodes of hook.agreeing) expect(nodes).toEqual([])
      expect(hook.egress.entries.length).toBe(0)
      expect(hook.egress.totalBytes).toBe(0)
      // Y13 still reports what was submitted.
      expect(textOf(regions, 'byo/sovereign-label')).toContain('sovereign')
      expect(textOf(regions, 'byo/sovereign-label')).toContain(OWNER_NOBODY_DECLARES)

      // **EGR-01, on the arm where the old sentence was most obviously false.** Nothing was
      // placed and nothing left, so a manifest read alone cannot tell this apart from a run
      // that had no sovereign data to begin with — and the page used to say the second about
      // the first, directly beneath Y13 saying the first. The count is what separates them,
      // and the egress region is asserted against it here rather than only printed.
      expect(hook.egress.registeredSovereign).toBe(hook.partitions.length)
      expect(hook.egress.registeredSovereign).toBeGreaterThan(0)
      const unownedEgress = textOf(regions, 'byo/egress')
      expect(
        unownedEgress,
        'Y13 says every shard was submitted owner-pinned and the egress region says the run registered no sovereign data — one render pass, two contradictory readings, which is the finding EGR-01 names',
      ).not.toContain('registered no sovereign data')
      expect(unownedEgress).toContain(
        `registered ${hook.egress.registeredSovereign} sovereign shard`,
      )
    }, 900_000)

    it('EGR-01 — places a shard for the owner this page’s node descriptors declare, and records the egress branch', async () => {
      // The forcing function for the literal above. `attestedNodes` is read from disk rather
      // than trusted, so the day this page hands a tab a real owner identity the arm below
      // stops measuring what it claims to and says so here first.
      const mainSource = readFileSync(join(ROOT, 'packages/browser/demo/main.ts'), 'utf8')
      expect(
        mainSource,
        "attestedNodes no longer declares ownerId: 'public' on every descriptor, so the owner id this arm dispatches for is no longer the one the fabric would place — re-plan this case",
      ).toContain(`ownerId: '${OWNER_THE_NODES_DECLARE}'`)

      await restoreDefaults(tabA)
      await tabA.check('#byo-sovereign')
      await tabA.fill('#byo-owner-id', OWNER_THE_NODES_DECLARE)
      expect((await control(tabA)).disabled).toBe(false)

      const elapsed = await dispatch(tabA, 900_000)
      const regions = await byoRegions(tabA)
      const hook = await byoHook(tabA)

      // The arm actually rendered, named by BOTH facts (EGR-01). This line read
      // `violations.length === 0 ? 'registered-no-sovereign-data' : 'WITHHELD'` until
      // 2026-08-10 — a two-way label for a three-way branch, which printed the name of the
      // false sentence into the record of every clean sovereign run.
      const branch =
        hook.egress.violations.length > 0
          ? 'WITHHELD'
          : hook.egress.registeredSovereign === 0
            ? 'registered-no-sovereign-data'
            : `registered-${hook.egress.registeredSovereign}-none-withheld`
      process.stderr.write(
        `[sovereign·placed] ${elapsed}ms ARM=${branch} complete=${hook.complete} ` +
          `placed=${hook.agreeing.filter((nodes) => nodes.length > 0).length}/${hook.agreeing.length} ` +
          `frames=${hook.egress.entries.length} bytes=${hook.egress.totalBytes} ` +
          `violations=${hook.egress.violations.length}\n`,
      )
      printRegions('sovereign·placed', regions)

      expect(textOf(regions, 'byo/sovereign-label')).toContain('sovereign')

      // Y12, against whichever branch the run actually produced. Reported rather than
      // demanded: this is the first place in this demo where the withheld branch is reachable
      // at all, and which one fired is a finding either way — so the branch is written to
      // stderr above and asserted here against what the manifest says, never against a hope.
      //
      // **What this block asserted until 2026-08-10, and why replacing it was the fix.** The
      // empty-violations arm read `expect(egress).toContain('registered no sovereign data')`.
      // It passed — and it was a green spec *requiring* the page to say something false about
      // this very dispatch, which submits owner-pinned shards on every shard. EGR-01. The
      // replacement below asserts the two facts separately and would go red if either were
      // conflated with the other again: the count must equal the shards this arm submitted,
      // and the *no sovereign data* sentence is forbidden on a run that registered some,
      // whichever of the two clean branches fired.
      const egress = textOf(regions, 'byo/egress')
      expect(egress).toContain('What left this device:')

      // Fact one: what the RUN submitted. Asserted before anything about the text, so a page
      // that rendered the right words off a manifest that had lost the count cannot pass.
      expect(
        hook.egress.registeredSovereign,
        'this arm submits every shard owner-pinned, so the manifest must report one sovereign registration per shard — a zero here is the count never reaching the page, which is the defect EGR-01 closed and not a property of the run',
      ).toBe(hook.partitions.length)
      expect(hook.egress.registeredSovereign).toBeGreaterThan(0)

      // Fact two: what the GUARD saw. The sentence that speaks for the run must never be the
      // one that only speaks for the guard.
      expect(
        egress,
        'the page told a visitor this run registered no sovereign data, on a dispatch that registered ' +
          `${hook.egress.registeredSovereign} — the two facts are conflated again`,
      ).not.toContain('registered no sovereign data')
      if (hook.egress.violations.length === 0) {
        expect(egress).toContain(`registered ${hook.egress.registeredSovereign} sovereign shard`)
        expect(egress).toContain('saw none of them leave')
      } else {
        expect(egress).toContain('WITHHELD')
        expect(egress).toContain('They were not sent anywhere.')
        for (const violation of hook.egress.violations) expect(egress).toContain(violation)
      }
    }, 900_000)
  })
})
