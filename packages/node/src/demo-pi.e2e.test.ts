import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { KERNEL_TRUST_ANCHOR } from '@o2/demo'
import { chromium } from 'playwright'
import type { Browser, BrowserContext, Page } from 'playwright'
import { createServer } from 'vite'
import type { ViteDevServer } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FabricNode } from './fabric-node.ts'

/**
 * Both arms of the π reduce, read off the screen — Plan 27-05, UI-SPEC sections 4.4 and 5.3.
 *
 * ## The arm this file exists for
 *
 * `reduceJob` excludes the submitter from the combine executor set by contract, so **a lone
 * tab cannot run the reduce at all** and gets `reduceAttempted: false` with the fabric's own
 * reason. Every visitor who opens this page first is that visitor. Section 5.3 rules how it
 * reads — *a condition of the topology, not a failure and not a zero* — and this file asserts
 * three things about it that are easy to get individually right and collectively wrong: the
 * sentence is on screen, the fabric's reason is quoted **verbatim**, and nothing on the
 * surface carries the refusal tone or a bare zero. A correct sentence in an error colour still
 * tells the visitor the wrong thing.
 *
 * ## Every reading is taken off the SCREEN and cross-checked against the run
 *
 * `window.__o2LastPiRun` is published by the page's own π handler and is what each screen
 * reading is compared against. The comparison is the point rather than the reading: *the right
 * value read from the wrong object* is the divergence class this repository's mutation ledger
 * records against this tier, and `peer-ledger.e2e.test.ts` says the same about itself. Without
 * the hook this file could only compare the page with itself.
 *
 * ## The two fixtures, and why they differ
 *
 * - **Lone tab** — `window.o2.start({relayAddrs: []})`, which is
 *   `attestation-ui.e2e.test.ts`'s route and is chosen for its reason: **the relay is itself a
 *   `FabricNode` serving the agent protocol**, so a tab that joins one has a compute peer and
 *   its reduce is attempted. A tab that dials nothing has none, which is the only way to reach
 *   the arm on purpose rather than by luck.
 * - **Two tabs** — two isolated `BrowserContext`s over a real in-process relay, joined through
 *   the page's own `#join` button reached by `?relay=`, exactly as `demo-liveness.e2e.test.ts`
 *   does and for the same reason: `findPeers` is installed by that handler, so `#peers` only
 *   becomes a live reading down that path and `2 node(s) computing` is assertable before
 *   anything is dispatched. The relay is the in-process node rather than `bin/seed.ts`, which
 *   would add a second page origin and a second discovery route to a fixture whose subject is
 *   neither.
 *
 * ## What the two-tab run actually observed
 *
 * Read off the `[two-tab] ARM=…` line this spec writes, and from nothing else. On 2026-08-10
 * it landed on the **combined** arm:
 *
 * ```
 * [two-tab] ARM=combined terms=3000000 shards=12 complete=true treeDepth=2 combines=4
 *           estimate=3.141592320257844 bound=6.666665555555741e-7
 * ```
 *
 * Twelve leaves at the default fanout give three combines at the first layer and one above
 * them, which is the `treeDepth=2 combines=4` above rather than a coincidence. The estimate
 * misses published π by 3.33e-7 against a bound of 6.67e-7 — inside it, and not by so much
 * that the comparison could not have failed. The whole file measured **4.85 s real / 5.94 s
 * user / 1.98 s sys**, ratio **1.63**, so nothing in it was starved.
 *
 * The lone arm, from the same run: `terms=1000000 shards=4 complete=true
 * reduceAttempted=false reason="no executor to combine on"`.
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const PAGE = 'packages/browser/demo/index.html'

/** UI-SPEC section 5.3's headline. Quoted here so a reworded page reddens rather than passes. */
const SECOND_DEVICE = 'This claim needs a second device.'

/** `demo.css`'s `--color-refusal`, resolved. Nothing on this surface may carry it. */
const REFUSAL_RGB = 'rgb(203, 75, 22)'

/** What the page published about the run it just rendered. */
interface PiHook {
  readonly terms: number
  readonly shards: number
  readonly complete: boolean
  readonly reduceAttempted: boolean
  readonly reduceReason: string | null
  readonly combined: boolean
  readonly treeDepth: number
  readonly combines: number
  readonly estimate: number | null
  readonly errorBound: number
}

/** One `[data-region]` inside `#s-pi`, as plain data. */
interface PiRegion {
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
  // presses.
  await page.click('#allow')
  await page.waitForSelector('#main', { state: 'visible', timeout: 30_000 })
  return page
}

/** Select the π surface the way a visitor does — the tab, which writes the hash. */
async function showPi(page: Page): Promise<void> {
  await page.click('#nav-pi')
  await page.waitForSelector('#s-pi', { state: 'visible', timeout: 30_000 })
}

/** Press `Run the reduce` and wait for the surface's own text view to be rewritten. */
async function runTheReduce(page: Page, budgetMs: number): Promise<void> {
  await page.waitForFunction(
    () => document.getElementById('run-pi')?.hasAttribute('disabled') === false,
    null,
    { timeout: 120_000 },
  )
  const before = (await page.textContent('#pi-report')) ?? ''
  await page.click('#run-pi')
  // The text view and the fourteen regions are written by one `applyRender` call, so the view
  // changing IS the run having produced a reading. The button is deliberately not the signal:
  // this page's reconciler re-enables it on a one-second tick while the run is still going.
  await page.waitForFunction(
    (was) => (document.getElementById('pi-report')?.textContent ?? '') !== was,
    before,
    { timeout: budgetMs },
  )
}

/** Every π region, off the screen. */
async function piRegions(page: Page): Promise<PiRegion[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('#s-pi [data-region]')).map((element) => ({
      id: element.getAttribute('data-region') ?? '',
      text: (element.textContent ?? '').trim(),
    })),
  )
}

/** The run the page published, read fresh in the same page. */
async function piHook(page: Page): Promise<PiHook> {
  const raw = await page.evaluate(() => {
    const value = (window as unknown as Record<string, unknown>)['__o2LastPiRun']
    return value === undefined || value === null ? null : JSON.stringify(value)
  })
  expect(
    raw,
    'the page published no window.__o2LastPiRun, so every reading below would be the page compared against itself',
  ).not.toBeNull()
  return JSON.parse(raw as string) as PiHook
}

/**
 * Print every π region, verbatim, for the arm named.
 *
 * Not decoration. 27-04's summary had to be corrected because it *inferred* five regions from
 * the shipped symbols and then said it had read them; the figures happened to be right, which
 * is precisely why the habit is worth catching. A summary claiming what is on screen should be
 * quoting this output and nothing else.
 */
function printRegions(arm: string, regions: readonly PiRegion[]): void {
  for (const region of regions) {
    process.stderr.write(`[${arm}] ${region.id} = ${region.text.replace(/\n/g, ' ⏎ ')}\n`)
  }
}

function textOf(regions: readonly PiRegion[], id: string): string {
  const found = regions.find((region) => region.id === id)
  expect(found, `${id} is not on the pi surface at all`).toBeDefined()
  return (found as PiRegion).text
}

/**
 * Does anything inside `#s-pi` carry the refusal colour — and would this detector notice?
 *
 * The probe is why the negative assertion is a measurement rather than a restatement. A scan
 * that finds nothing proves nothing until it has been shown finding something, so a detached
 * element painted `var(--color-refusal)` is measured by the same function in the same frame
 * and removed. A proof that cannot fail is not a proof.
 */
async function refusalScan(page: Page): Promise<{ probeDetected: boolean; offenders: string[] }> {
  return page.evaluate((refusal) => {
    const carries = (element: Element): boolean => {
      const style = window.getComputedStyle(element)
      return [
        style.color,
        style.backgroundColor,
        style.borderTopColor,
        style.borderRightColor,
        style.borderBottomColor,
        style.borderLeftColor,
        style.outlineColor,
        style.textDecorationColor,
      ].includes(refusal)
    }

    const probe = document.createElement('div')
    probe.style.color = 'var(--color-refusal)'
    probe.textContent = 'probe'
    document.body.append(probe)
    const probeDetected = carries(probe)
    probe.remove()

    const panel = document.getElementById('s-pi')
    const offenders =
      panel === null
        ? ['#s-pi is not on the page']
        : Array.from(panel.querySelectorAll('*'))
            .filter((element) => carries(element))
            .map(
              (element) =>
                `${element.tagName.toLowerCase()}${element.getAttribute('data-region') === null ? '' : `[${element.getAttribute('data-region')}]`}: ${(element.textContent ?? '').trim().slice(0, 60)}`,
            )
    return { probeDetected, offenders }
  }, REFUSAL_RGB)
}

beforeAll(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'o2-demo-pi-'))
  // DET-03: the demo's own anchor, matching what `bin/seed.ts` pins with no flags.
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

describe('UI-SPEC section 5.3 — a lone tab cannot run the reduce, and is told so', () => {
  let regions: readonly PiRegion[] = []
  let hook: PiHook
  let report = ''
  let page: Page

  it('runs the series with no peer at all, and the reduce is not attempted', async () => {
    // `relayAddrs: []` — this tab dials nothing on the way up, which is the only way to be
    // certain there is no compute peer. A relay would be one: it is a `FabricNode` and it
    // answers `computePeers()`'s offer probe.
    page = await openPage('lone', '')
    await page.evaluate(async () =>
      window.o2.start({ relayAddrs: [], blockstoreName: 'o2-demo-pi-lone' }),
    )
    await showPi(page)
    await runTheReduce(page, 600_000)

    regions = await piRegions(page)
    hook = await piHook(page)
    report = (await page.textContent('#pi-report')) ?? ''

    // The population the readings came from, said ON THE PAGE rather than assumed here. The
    // π handler refreshes peers before it dispatches, so this is the count it dispatched at.
    expect(await page.textContent('#peers')).toContain('1 node(s) computing')
    expect(hook.reduceAttempted).toBe(false)
    expect(hook.reduceReason).not.toBeNull()

    process.stderr.write(
      `[lone] terms=${hook.terms} shards=${hook.shards} complete=${hook.complete} ` +
        `reduceAttempted=${hook.reduceAttempted} reason="${hook.reduceReason ?? ''}"\n`,
    )
    printRegions('lone', regions)

    const scan = await refusalScan(page)
    // The detector, shown working before its negative result is believed.
    expect(scan.probeDetected, 'the refusal-colour detector found nothing on a probe painted with it, so its empty result below would mean nothing').toBe(true)
    expect(
      scan.offenders,
      'an element on the pi surface carries the refusal colour: a lone-tab reduce is a condition of the topology and section 5.3 forbids the error tone',
    ).toEqual([])
  }, 900_000)

  it("reads section 5.3's sentence with the fabric's own reason quoted verbatim", () => {
    const panel = textOf(regions, 'pi/reduce-attempted')
    expect(panel).toContain(SECOND_DEVICE)
    // **Verbatim**, compared against what the run returned rather than against a string this
    // file holds. A page that paraphrased the reason would still contain the headline.
    expect(panel).toContain(hook.reduceReason as string)
    expect(panel).toContain(`The fabric's own reason: ${hook.reduceReason as string}`)
    // Both views, out of one record.
    expect(report).toContain(SECOND_DEVICE)
    expect(report).toContain(hook.reduceReason as string)
  })

  it('shows no zero for the aggregate, the tree or the combines', () => {
    // The three the fabric reports as `0` on this arm — `treeDepth`, `combines` and an
    // absent `estimate` — and a zero in any of them would say the fabric measured nothing
    // rather than that nothing was measurable.
    expect(hook.treeDepth).toBe(0)
    expect(hook.combines).toBe(0)
    expect(hook.estimate).toBeNull()

    expect(textOf(regions, 'pi/tree-depth')).toBe('No tree: no reduce was attempted — see above.')
    expect(textOf(regions, 'pi/combines')).toBe('No tree: no reduce was attempted — see above.')
    expect(textOf(regions, 'pi/estimate')).toBe(
      'No estimate: the fabric produced no aggregate to read back.',
    )
    expect(textOf(regions, 'pi/combined')).toBe('No aggregate: no reduce was attempted — see above.')
    expect(textOf(regions, 'pi/against-published')).toBe(
      'No comparison: the fabric produced no aggregate to compare.',
    )

    const zeros = regions
      .filter((region) => /^\s*0\s*$/.test(region.text))
      .map((region) => region.id)
    expect(zeros, 'a pi region reads as the quantity zero on a run where nothing was measured').toEqual([])
  })

  it('still reads the map half, which a lone tab really did do', () => {
    // The half that is NOT missing. Presenting the whole surface as absent would be the
    // mirror of presenting the reduce as a failure.
    expect(textOf(regions, 'pi/terms')).toBe(String(hook.terms))
    expect(textOf(regions, 'pi/shards')).toBe(String(hook.shards))
    expect(textOf(regions, 'pi/complete')).toBe(String(hook.complete))
    expect(textOf(regions, 'pi/error-bound')).toBe(hook.errorBound.toFixed(9))
    expect(textOf(regions, 'pi/egress')).toContain('What left this device:')
    expect(textOf(regions, 'pi/elapsed')).toMatch(/^\d+ms$/)
  })

  /**
   * The lone node is stopped before the next describe runs, and it is not tidiness.
   *
   * It is a running `BrowserNode` with a worker pool in the same chromium process the two-tab
   * arm is about to put two more in, and `attestation-ui.e2e.test.ts` stops its provider for
   * the same class of reason: a node left running is a node that can be counted, scheduled on,
   * or simply compete for the CPU the arm below is measuring.
   */
  afterAll(async () => {
    await page?.evaluate(async () => window.o2.stop()).catch(() => {})
  }, 60_000)

  it('carries no attestation region at all, and says why in prose', async () => {
    expect(regions.map((region) => region.id).filter((id) => id.includes('attestation'))).toEqual([])
    // The sentence UI-SPEC section 4.4 asks for, on the surface rather than only in a
    // docblock — a reader of the page is owed the reason, not just a reader of the source.
    const panelText = (await page.textContent('#s-pi')) ?? ''
    expect(panelText).toContain('runPi')
    expect(panelText).toContain('does not include the map')
    expect(panelText).toContain('No per-shard partials')
  })
})

describe('two tabs — the reduce has somewhere to run', () => {
  let regions: readonly PiRegion[] = []
  let hook: PiHook
  let report = ''

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
    const a = await join('a')
    const b = await join('b')

    // One harness intervention, named: tab A dials tab B's WebRTC address once, as
    // `colouring-demo.e2e.test.ts` and `demo-liveness.e2e.test.ts` both do. Rendezvous over
    // the relay's reservation store would get there on its own timetable; the dial makes
    // *when* deterministic without changing *what*.
    const bAddrs = await b.evaluate(async () => window.o2.waitForWebrtcAddr(120_000))
    const bPeerId = await b.evaluate(() => window.o2.addresses().peerId)
    expect(await a.evaluate(async (addr) => window.o2.dial(addr), bAddrs[0] as string)).toBe(bPeerId)

    await a.waitForFunction(
      () => (document.getElementById('peers')?.textContent ?? '').includes('2 node(s) computing'),
      null,
      { timeout: 120_000 },
    )
    expect(await a.textContent('#peers')).toContain('2 node(s) computing')

    await showPi(a)
    await runTheReduce(a, 900_000)
    regions = await piRegions(a)
    hook = await piHook(a)
    report = (await a.textContent('#pi-report')) ?? ''

    // The arm this run landed on, recorded. A run that never combines is then visible as a
    // pattern across runs rather than as a green.
    process.stderr.write(
      `[two-tab] ARM=${hook.combined ? 'combined' : hook.reduceAttempted ? 'attempted-no-aggregate' : 'NOT-ATTEMPTED'} ` +
        `terms=${hook.terms} shards=${hook.shards} complete=${hook.complete} ` +
        `treeDepth=${hook.treeDepth} combines=${hook.combines} estimate=${String(hook.estimate)} ` +
        `bound=${hook.errorBound}\n`,
    )
    printRegions('two-tab', regions)
  }, 900_000)

  it('attempted the reduce, and says so without the second-device panel', () => {
    expect(hook.reduceAttempted).toBe(true)
    expect(hook.reduceReason).toBeNull()
    expect(textOf(regions, 'pi/reduce-attempted')).not.toContain(SECOND_DEVICE)
    expect(report).not.toContain(SECOND_DEVICE)
  })

  it('draws the tree it has, and never a per-combine state it does not have', () => {
    const rows = textOf(regions, 'pi/tree-depth').split('\n')
    expect(rows[0]).toBe(`depth ${hook.treeDepth}`)
    // `map` for the leaves, then one row per combine layer. `ReduceTree.depth` counts the
    // layers ABOVE the leaves (`depth: level - 1`), so the row count is depth + 1.
    expect(rows.slice(1)).toEqual([
      'map',
      ...Array.from({ length: hook.treeDepth }, (_unused, index) => `lvl ${index + 1}`),
    ])
  })

  it('reports whichever aggregate arm it reached, and reports it separately from the attempt', () => {
    if (!hook.combined) {
      // A real state of the fabric, reported rather than retried into a luckier run. The
      // three booleans staying separate is what makes this reportable at all.
      expect(textOf(regions, 'pi/combined')).toBe(
        'No aggregate: a reduce was started and no combine produced one.',
      )
      expect(textOf(regions, 'pi/estimate')).toBe(
        'No estimate: the fabric produced no aggregate to read back.',
      )
      return
    }

    expect(textOf(regions, 'pi/combined')).toBe('true')
    expect(textOf(regions, 'pi/combines')).toBe(
      hook.combines === 0
        ? 'No combine was needed: a single partial is itself the aggregate.'
        : String(hook.combines),
    )

    const estimate = (hook.estimate as number).toFixed(9)
    expect(textOf(regions, 'pi/estimate')).toBe(estimate)
    // P6's property, on this surface: the region's string occurs character for character in
    // the surface's own text view, because both come out of one record.
    expect(report).toContain(estimate)

    // P12 — both operands on screen, the bound beside them, and the constant visibly cited.
    const comparison = textOf(regions, 'pi/against-published')
    expect(comparison).toContain(estimate)
    expect(comparison).toContain(Math.PI.toFixed(9))
    expect(comparison).toContain(hook.errorBound.toFixed(9))
    expect(comparison).toContain('a published mathematical constant')

    // The claim itself: the fabric's aggregate lands inside a bound that is a property of the
    // alternating series and not of this project.
    expect({
      inside: Math.abs((hook.estimate as number) - Math.PI) <= hook.errorBound,
    }).toEqual({ inside: true })
    expect(comparison).toContain('inside the bound')
  })

  it('measures what left the device, count and sentence inseparable', () => {
    const egress = textOf(regions, 'pi/egress')
    expect(egress).toContain('What left this device:')
    expect(egress).toContain('withheld')
    // **This workload is all-public, so this is the arm that is TRUE here** — `runPi` submits
    // every shard `label: 'public'` and registers nothing. EGR-01 gave `egressLines` a second
    // `0 withheld` arm for runs that did register something, and the pair below is what makes
    // this case an assertion about which arm fired rather than about which words exist: a
    // manifest that reached the page without its count selects the *other* arm, so the second
    // line goes red on exactly the failure the first line cannot see.
    expect(egress).toContain('registered no sovereign data')
    expect(
      egress,
      'a public π run is being described as having registered sovereign shards — the manifest reached this page without its registeredSovereign count',
    ).not.toContain('saw none of them leave')
  })
})
