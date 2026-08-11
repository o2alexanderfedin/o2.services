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
import {
  DUTY_APPLIED,
  SURFACE_STOPPED,
  format,
} from '../../browser/demo/surfaces/fabric.ts'
import type { FabricReadings } from '../../browser/demo/surfaces/fabric.ts'
import { REGIONS } from '../../browser/src/demo-regions.ts'
import type { Region } from '../../browser/src/demo-regions.ts'
import { ATTESTATION_HOOK, absenceSentences, p6, p7, p8 } from './demo-region-properties.ts'
import type { DomRegion } from './demo-region-properties.ts'
import { FabricNode } from './fabric-node.ts'

/**
 * The fabric-state surface — UI-SPEC section 4.6's twenty-one regions, Plan 27-08.
 *
 * ## Three kinds of arm, and the reason they are in one file
 *
 * 1. **The formatter, with no browser at all.** `format` is pure, so the arms a healthy
 *    two-tab fixture will not produce to order — a reading that throws, the start-outcome
 *    cliff, an empty tally set — are function calls rather than states somebody has to
 *    arrange. They run first and they need no fixture, which is why the Playwright
 *    `beforeAll` lives inside the second `describe` rather than at the top of the file.
 * 2. **The page with no node.** Every region that needs one reads its stopped sentence,
 *    no region carries a digit, `#report` still reads its literal, and the surface offers
 *    no primary control.
 * 3. **The page with two tabs.** Every reading is taken off the screen and cross-checked
 *    against a fresh `window.o2` call made in the same page, because the right value read
 *    from the wrong object is this tier's recorded divergence class.
 *
 * ## What the thrown-message arm is, and why it is a stub rather than a source plant
 *
 * UI-SPEC section 4.6's rule is that a reading which throws renders **the thrown message**
 * — never a number, never a blank, never a retained previous value — and that one throwing
 * call does not blank the other twenty. With a node running, no reading throws, so the arm
 * is unreachable by arranging the fabric. It is reached by replacing one method on
 * `window.o2` with one that throws, which is a *harness* intervention on the page's own
 * object: everything downstream of it — the page's `try`/`catch`, the formatter, the
 * writer, the DOM — is real. The source plant that proves this arm can fail is recorded in
 * the plan's SUMMARY; it removes the `try`/`catch` at the call site and this case reddens.
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const PAGE = 'packages/browser/demo/index.html'

const CATALOGUE: ReadonlyMap<string, Region> = new Map(REGIONS.map((r) => [r.id, r]))

/** The twenty-one, from the catalogue rather than from a list typed here. */
const FABRIC_READINGS: readonly Region[] = REGIONS.filter(
  (region) => region.surface === 'fabric' && region.kind === 'reading',
)

const DIGIT = /[0-9]/

/**
 * An `EgressManifest` as the page receives one.
 *
 * Cast rather than imported-and-constructed: `@o2/net` builds these from a guard and the
 * fields this surface renders are the four below. The cast is confined to this helper so no
 * case has to repeat it.
 */
function manifest(fields: {
  entries: readonly { peerId: string; bytes: number; label: string }[]
  totalBytes: number
  violations: readonly string[]
  /**
   * EGR-01, and it has no default on purpose. A fixture that could omit this would render
   * whichever arm the omission happened to select, and the arm an omission selects is the one
   * that says the run registered no sovereign data — the sentence that was false on a real
   * dispatch. Every caller states which run it is describing.
   */
  registeredSovereign: number
}): NonNullable<FabricReadings['egress']> {
  return {
    nodeId: 'self',
    ownerId: 'public',
    ...fields,
  } as unknown as NonNullable<FabricReadings['egress']>
}

// =========================================================================================
// 1. The formatter, with no browser
// =========================================================================================

function readings(overrides: Partial<FabricReadings> = {}): FabricReadings {
  return {
    activity: {
      running: true,
      tasksExecuted: 3,
      dutyCycle: 1,
      hidden: false,
      peers: 2,
      servedFor: [],
      fetched: 4,
      rejected: 0,
    },
    ...overrides,
  }
}

describe('the fabric-state formatter, with no DOM and no node', () => {
  it('gives all twenty-one regions a string in every arm, stopped included', () => {
    const stopped = format({ activity: null })
    const missing = FABRIC_READINGS.filter((region) => stopped.regions[region.id] === undefined)
    expect(missing.map((region) => region.id)).toEqual([])
    expect(FABRIC_READINGS.length).toBe(21)

    // Stopped wins: every one of them is the catalogue's stopped sentence, which is what
    // P3 asserts against the real page in `demo-regions.e2e.test.ts`.
    const wrong: string[] = []
    for (const region of FABRIC_READINGS) {
      const text = stopped.regions[region.id]
      if (text !== region.absence?.stopped) wrong.push(`${region.id}: "${text}"`)
    }
    expect(wrong).toEqual([])
    expect(stopped.text).toEqual([SURFACE_STOPPED])
  })

  it('renders a thrown message verbatim, and one throw does not blank the other twenty', () => {
    const thrown = new Error('node not started')
    const one = format(
      readings({
        governor: thrown,
        peers: ['peer-a', 'peer-b'],
        capacity: { dutyCycle: 0.5, slots: 2 },
      }),
    )

    // The thrown message, verbatim. Not a number, not a blank, not a previous value.
    expect(one.regions['fabric/governor-hidden']).toBe('node not started')
    expect(one.regions['fabric/governor-duty']).toBe('node not started')
    expect(one.regions['fabric/governor-transitions']).toBe('node not started')

    // And the neighbours are untouched — this is the property the plan's plant is about.
    expect(one.regions['fabric/peers-all']).toBe('2 connections')
    expect(one.regions['fabric/duty-user']).toBe('0.50')
    expect(one.regions['fabric/slots']).toBe('2 slots')
  })

  it('names the start-outcome cliff instead of showing a zero', () => {
    const cliff = format(
      readings({
        startReport: {
          reached: 0,
          asked: 4,
          text: 'nothing',
          reported: 0,
          failed: 0,
          byBrowser: [],
        },
      }),
    )
    expect(cliff.regions['fabric/start-reached']).toBe('Asked, and no peer answered.')
    // Never the figure the cliff would otherwise be rendered as.
    expect(cliff.regions['fabric/start-reached']).not.toContain('0 of')

    // The other zero is a different finding and takes a different sentence.
    const unasked = format(
      readings({
        startReport: { reached: 0, asked: 0, text: '', reported: 0, failed: 0, byBrowser: [] },
      }),
    )
    expect(unasked.regions['fabric/start-reached']).toBe(
      CATALOGUE.get('fabric/start-reached')?.absence?.stopped,
    )
    expect(unasked.regions['fabric/start-tallies']).toBe(
      'No rows: no node has reported an outcome.',
    )

    // And a report that was answered is a figure, because there the figure is the reading.
    const answered = format(
      readings({
        startReport: {
          reached: 2,
          asked: 3,
          text: '',
          reported: 2,
          failed: 0,
          byBrowser: [
            { browser: 'firefox 130', attempts: 4, failed: 1, failureRate: 0.25, reliable: false, causes: [] },
          ],
        },
      }),
    )
    expect(answered.regions['fabric/start-reached']).toBe('2 of 3 peers asked answered')
    expect(answered.regions['fabric/start-tallies']).toContain('firefox 130')
  })

  it('says a pair is connected and cannot carry a job, rather than counting it as a peer', () => {
    const stuck = format(
      readings({
        heldPeers: [
          { peer: 'peer-a', carriesWork: true },
          { peer: 'peer-b', carriesWork: false },
        ],
        discovery: {
          asked: true,
          dialed: [],
          failed: [],
          upgrades: [],
          relayedOnly: ['peer-b'],
          stalled: ['peer-b'],
        },
      }),
    )
    // F3 counts the peers that can actually work, not every held connection.
    expect(stuck.regions['fabric/held-peers']).toBe('1 peer')
    expect(stuck.regions['fabric/peer-rows']).toContain('peer-b — relay circuit only, cannot carry a job')
    expect(stuck.regions['fabric/relayed-only']).toContain('no longer being retried')

    const clean = format(
      readings({
        heldPeers: [{ peer: 'peer-a', carriesWork: true }],
        discovery: {
          asked: true,
          dialed: [],
          failed: [],
          upgrades: [],
          relayedOnly: [],
          stalled: [],
        },
      }),
    )
    expect(clean.regions['fabric/relayed-only']).toBe('Every peer this tab holds can carry a job.')
  })

  it('renders the receipt through the shared formatter and never composes a sentence', () => {
    const receipt = format(
      readings({
        attestation: {
          strength: 'independent',
          description: 'independent — two operators signed, on independent relay paths',
          replicas: 2,
          operators: ['op-a', 'op-b'],
          userKeys: [],
          sharedRelay: null,
        },
      }),
    )
    // F7 is `description` **verbatim** — the whole of UI-SPEC section 5.1.
    expect(receipt.regions['fabric/attestation-description']).toBe(
      'independent — two operators signed, on independent relay paths',
    )
    expect(receipt.regions['fabric/attestation-strength']).toBe('independent')

    const absent = format(
      readings({
        attestation: {
          kind: 'holds-no-verified-attestation',
          reason: 'no agreeing replica produced a signed statement this requestor could check',
          agreeing: 2,
          verified: 0,
        },
      }),
    )
    expect(absent.regions['fabric/attestation-description']).toBe(
      'no agreeing replica produced a signed statement this requestor could check',
    )
    expect(absent.regions['fabric/attestation-strength']).toBe('holds-no-verified-attestation')
    // The counts arm comes from `attestationLines`, imported rather than reimplemented.
    expect(absent.regions['fabric/attestation-counts']).toContain('2 replicas agreed')
  })

  it('keeps the withheld figure and its sentence in one region', () => {
    const withheld = format(
      readings({
        egress: manifest({
          entries: [{ peerId: 'peer-a', bytes: 10, label: 'public' }],
          totalBytes: 10,
          violations: ['owner-row-a'],
          registeredSovereign: 1,
        }),
      }),
    )
    const region = withheld.regions['fabric/egress-withheld'] ?? ''
    expect(region).toContain('WITHHELD')
    expect(region).toContain('They were not sent anywhere.')
    expect(withheld.regions['fabric/egress-frames']).toBe('1 frame')
    expect(withheld.regions['fabric/egress-bytes']).toBe('10 byte(s)')
  })

  /**
   * EGR-01, at the formatter, which is where the three arms actually differ.
   *
   * This surface is the *cross-cutting* view: F11 renders whichever manifest the last run
   * produced, so when that run was a sovereign bring-your-own dispatch this file's subject is
   * exactly the case the defect was found on. It is asserted here rather than only in the
   * browser because the distinction is a property of `egressLines` and its manifest, and a
   * property provable without a browser should not need one.
   *
   * The negative is the load-bearing half: two of the three arms print `0 withheld`, and before
   * 2026-08-10 both printed *registered no sovereign data* with it.
   */
  it('EGR-01 — tells a run that registered no sovereign data from one whose sovereign data stayed put', () => {
    const nothingRegistered = format(
      readings({
        egress: manifest({ entries: [], totalBytes: 0, violations: [], registeredSovereign: 0 }),
      }),
    )
    const none = nothingRegistered.regions['fabric/egress-withheld'] ?? ''
    expect(none).toContain('0 withheld')
    expect(none).toContain('registered no sovereign data')

    const registeredAndClean = format(
      readings({
        egress: manifest({ entries: [], totalBytes: 0, violations: [], registeredSovereign: 6 }),
      }),
    )
    const six = registeredAndClean.regions['fabric/egress-withheld'] ?? ''
    expect(six).toContain('0 withheld')
    // **The claim, asserted FIRST and deliberately.** Plant the third arm away and every
    // positive assertion below also reddens — on the words the new arm uses, which is a
    // mechanism reading. Ordered after them, this line would never run under the plant and the
    // claim would be unproved by the very run that was supposed to prove it. That failure is
    // recorded against CRYPTO-01 in REQUIREMENTS.md and is not repeated here.
    expect(
      six,
      'a run that registered six owner-pinned shards is being told it registered none — the two facts are conflated again',
    ).not.toContain('registered no sovereign data')
    // Same figure, same region, same function — and a different fact, which is the point.
    expect(six).toContain('registered 6 sovereign shards')
    expect(six).toContain('saw none of them leave')

    // The count is the ONLY difference between the two readings above. Asserted so this case
    // cannot pass on some incidental divergence in the frames or bytes lines.
    expect(nothingRegistered.regions['fabric/egress-frames']).toBe(
      registeredAndClean.regions['fabric/egress-frames'],
    )
    expect(nothingRegistered.regions['fabric/egress-bytes']).toBe(
      registeredAndClean.regions['fabric/egress-bytes'],
    )
    expect(none).not.toBe(six)
  })

  it('puts every populated figure into its own text view, which is what P6 checks', () => {
    const full = format(
      readings({
        peers: ['a', 'b'],
        capacity: { dutyCycle: 0.5, slots: 2 },
        egress: manifest({
          entries: [],
          totalBytes: 4096,
          violations: [],
          registeredSovereign: 0,
        }),
      }),
    )
    const view = full.text.join('\n')
    for (const id of ['fabric/peers-all', 'fabric/duty-user', 'fabric/egress-bytes']) {
      expect(view, `${id} is not in the text view`).toContain(full.regions[id])
    }
  })

  it('states the cap composition without repeating the figure the region already carries', () => {
    expect(DIGIT.test(DUTY_APPLIED)).toBe(false)
  })
})

// =========================================================================================
// 2 and 3. The page, with no node and with two tabs
// =========================================================================================

interface Tab {
  readonly name: string
  readonly context: BrowserContext
  readonly page: Page
  readonly peerId: string
}

let relay: FabricNode
let relayAddr: string
let server: ViteDevServer
let browser: Browser
let baseUrl: string
let workdir: string
const tabs: Tab[] = []
/** The third context: consented, never joined. Every arm about the stopped page is read here. */
let stopped: Page

/** Every `[data-region]` inside `#s-fabric`, as plain data. */
async function readFabric(page: Page): Promise<DomRegion[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('#s-fabric [data-region]')).map((element) => ({
      id: element.getAttribute('data-region') ?? '',
      kind: element.getAttribute('data-kind'),
      source: element.getAttribute('data-source'),
      text: (element.textContent ?? '').trim(),
      outer: element.outerHTML.slice(0, 240),
    })),
  )
}

function textOf(regions: readonly DomRegion[], id: string): string {
  return regions.find((region) => region.id === id)?.text ?? '(no such region on the page)'
}

async function openTab(name: string, join: boolean): Promise<Page> {
  const context = await browser.newContext()
  const page = await context.newPage()
  page.on('pageerror', (error) => {
    process.stderr.write(`[${name}] page error: ${error.message}\n`)
  })
  page.on('console', (message) => {
    if (message.type() === 'error') process.stderr.write(`[${name}] console: ${message.text()}\n`)
  })
  await page.goto(`${baseUrl}${PAGE}?relay=${encodeURIComponent(relayAddr)}`)
  await page.waitForFunction(() => typeof window.o2 !== 'undefined', null, { timeout: 60_000 })
  // BROW-01 has no test-only bypass: a harness consents by pressing the button a visitor
  // presses, and joins by pressing the button a visitor presses.
  await page.click('#allow')
  await page.waitForSelector('#main', { state: 'visible', timeout: 30_000 })
  await page.waitForFunction(
    () => document.getElementById('join')?.hasAttribute('disabled') === false,
    null,
    { timeout: 60_000 },
  )
  if (join) {
    await page.click('#join')
    await page.waitForFunction(
      () => document.getElementById('state')?.dataset['tone'] === 'live',
      null,
      { timeout: 120_000 },
    )
  }
  // The visitor's own route to the surface. `nav.ts` writes `location.hash` and renders
  // from it synchronously; nothing here sets the hash or removes a `hidden` attribute.
  await page.click('#nav-fabric')
  await page.waitForSelector('#s-fabric', { state: 'visible', timeout: 30_000 })
  if (context !== null) {
    if (join) {
      const peerId = await page.evaluate(() => window.o2.addresses().peerId)
      tabs.push({ name, context, page, peerId })
    }
  }
  return page
}

describe('the fabric-state surface, on a real page', () => {
  beforeAll(async () => {
    workdir = await mkdtemp(join(tmpdir(), 'o2-demo-fabric-'))
    // The in-process relay rather than `bin/seed.ts`, for the reason
    // `demo-liveness.e2e.test.ts`'s header gives: `seed.ts` also serves `/bootstrap.json`
    // and its own copy of the page, which would put a second origin and a second discovery
    // route into a fixture whose subject is neither.
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
    stopped = await openTab('stopped', false)
    await openTab('a', true)
    await openTab('b', true)
  }, 420_000)

  afterAll(async () => {
    for (const tab of tabs) {
      await tab.page.evaluate(async () => window.o2.stop()).catch(() => {})
      await tab.context.close().catch(() => {})
    }
    await stopped?.context().close().catch(() => {})
    await browser?.close().catch(() => {})
    await server?.close().catch(() => {})
    await relay?.stop().catch(() => {})
    await rm(workdir, { recursive: true, force: true })
  }, 180_000)

  // ---- the page with no node ------------------------------------------------------------

  it('reads its stopped sentence in every region that needs a node, and no digit anywhere', async () => {
    const regions = await readFabric(stopped)
    const problems: string[] = []
    for (const region of FABRIC_READINGS) {
      const dom = regions.find((entry) => entry.id === region.id)
      if (dom === undefined) {
        problems.push(`${region.id} has no element inside #s-fabric`)
        continue
      }
      if (dom.text !== region.absence?.stopped) {
        problems.push(`${region.id}: on screen "${dom.text}" — the catalogue says "${region.absence?.stopped}"`)
      }
      // A region with no reading may not carry a figure. This surface has the most calls
      // that throw, so it is the one where a number could most easily survive into an
      // absence, and P3 holds the general case one file over.
      if (DIGIT.test(dom.text)) problems.push(`${region.id} carries a digit with no reading: "${dom.text}"`)
    }
    expect(problems).toEqual([])
    // A floor: twenty-one of them, not whichever subset happened to be found.
    expect(regions.filter((dom) => dom.kind === 'reading').length).toBe(21)

    process.stderr.write(
      `[no node] fabric/isolation: ${textOf(regions, 'fabric/isolation')}\n` +
        `[no node] fabric/start-reached: ${textOf(regions, 'fabric/start-reached')}\n`,
    )
  })

  it('leaves #report at its literal and #fabric-report at the whole-surface sentence', async () => {
    // The literal two other specs wait on. `peer-ledger.e2e.test.ts` and
    // `two-tabs.e2e.test.ts` both wait for `#report`'s textContent to differ from it, so a
    // page that started at anything else would satisfy those waits immediately.
    expect(await stopped.textContent('#report')).toBe('not asked yet')
    expect((await stopped.textContent('#fabric-report'))?.trim()).toBe(SURFACE_STOPPED)
    // Both work on a hidden panel, which is what makes the move safe. Read here through
    // the same route those two specs use, with a different panel selected.
    await stopped.click('#nav-colouring')
    await stopped.waitForSelector('#s-fabric', { state: 'hidden', timeout: 30_000 })
    const hidden = await stopped.evaluate(() => ({
      report: document.getElementById('report')?.textContent ?? null,
      clickable: document.getElementById('refresh-report') !== null,
    }))
    expect(hidden.report).toBe('not asked yet')
    expect(hidden.clickable).toBe(true)
    await stopped.click('#nav-fabric')
    await stopped.waitForSelector('#s-fabric', { state: 'visible', timeout: 30_000 })
  })

  it('offers no primary run control, and the slider is disabled with a reason', async () => {
    const controls = await stopped.evaluate(() => {
      const panel = document.getElementById('s-fabric')
      return {
        primary: panel?.querySelectorAll('.btn-primary').length ?? -1,
        buttons: Array.from(panel?.querySelectorAll('button') ?? []).map((b) => b.id),
        sliderDisabled: (document.getElementById('duty-slider') as HTMLInputElement | null)?.disabled,
        status: document.getElementById('duty-status')?.textContent ?? '',
      }
    })
    // UI-SPEC section 11: *Fabric state — none; the surface reads, it does not run.*
    expect(controls.primary).toBe(0)
    expect(controls.buttons).toEqual(['refresh-report'])
    expect(controls.sliderDisabled).toBe(true)
    // A disabled control with no explanation is the same defect as a placeholder.
    expect(controls.status).not.toBe('')
    expect(DIGIT.test(controls.status)).toBe(false)
  })

  // ---- the page with two tabs -------------------------------------------------------------

  it('has two tabs computing, on the page, before anything is read off it', async () => {
    const [a, b] = tabs as [Tab, Tab]
    expect(a.peerId).not.toBe(b.peerId)
    const bAddrs = await b.page.evaluate(async () => window.o2.waitForWebrtcAddr(120_000))
    const dialed = await a.page.evaluate(async (addr) => window.o2.dial(addr), bAddrs[0]!)
    expect(dialed).toBe(b.peerId)
    await a.page.waitForFunction(
      () => (document.getElementById('peers')?.textContent ?? '').includes('2 node(s) computing'),
      null,
      { timeout: 120_000 },
    )
  }, 300_000)

  it('carries a live reading in every region a running node can answer, cross-checked in the page', async () => {
    const [a] = tabs as [Tab]
    // The peer counts and the addresses arrive with a discovery round; the panel repaints
    // on the same notification the bar does.
    await a.page.waitForFunction(
      () => {
        const text = document.querySelector('[data-region="fabric/addresses"]')?.textContent ?? ''
        return text.includes('12D3Koo')
      },
      null,
      { timeout: 120_000 },
    )
    // **This surface is a LIVE view of a fabric that is still settling**, so one snapshot
    // of the screen and one reading of the object are two different moments and may
    // legitimately differ. Measured on the first run of this case: `1 peer` on screen
    // against two in the object, because the pair upgraded from a relay circuit to WebRTC
    // between the paint and the read. So the volatile readings are asserted by
    // **convergence** — the screen agrees with a fresh reading taken in the same page,
    // within a bound — and the whole comparison happens inside one `page.evaluate`, with
    // every DOM value snapshotted before any object is asked, so a repaint cannot slip
    // between the two halves of one comparison.
    const disagreements = async (): Promise<string[]> =>
      a.page.evaluate(async () => {
        const text = (id: string): string =>
          (document.querySelector(`[data-region="${id}"]`)?.textContent ?? '').trim()
        const screen = {
          peers: text('fabric/peers-all'),
          computePeers: text('fabric/compute-peers'),
          held: text('fabric/held-peers'),
          rows: text('fabric/peer-rows'),
          duty: text('fabric/duty-user'),
          slots: text('fabric/slots'),
          hidden: text('fabric/governor-hidden'),
          governorDuty: text('fabric/governor-duty'),
          transitions: text('fabric/governor-transitions'),
          isolation: text('fabric/isolation'),
          addresses: text('fabric/addresses'),
          blocks: text('fabric/blocks'),
          startReached: text('fabric/start-reached'),
        }
        const problems: string[] = []
        const say = (id: string, on: string, expected: string): void => {
          problems.push(`${id}: on screen "${on}" — the object says ${expected}`)
        }

        const peers = window.o2.peers().length
        if (!screen.peers.startsWith(String(peers))) say('fabric/peers-all', screen.peers, String(peers))
        const held = window.o2.heldPeers()
        const carrying = held.filter((peer) => peer.carriesWork).length
        if (carrying < 2) problems.push(`the fixture holds ${carrying} working peers, not the relay and one tab`)
        if (!screen.held.startsWith(String(carrying))) say('fabric/held-peers', screen.held, String(carrying))
        for (const peer of held) {
          if (!screen.rows.includes(peer.peer)) say('fabric/peer-rows', screen.rows, peer.peer)
        }
        const capacity = window.o2.capacity()
        if (screen.duty !== capacity.dutyCycle.toFixed(2)) say('fabric/duty-user', screen.duty, capacity.dutyCycle.toFixed(2))
        if (!screen.slots.startsWith(String(capacity.slots))) say('fabric/slots', screen.slots, String(capacity.slots))
        const governor = window.o2.governor()
        if (screen.hidden !== (governor.hidden ? 'yes' : 'no')) say('fabric/governor-hidden', screen.hidden, String(governor.hidden))
        if (screen.governorDuty !== governor.dutyCycle.toFixed(2)) say('fabric/governor-duty', screen.governorDuty, governor.dutyCycle.toFixed(2))
        if (!screen.transitions.startsWith(String(governor.transitions))) say('fabric/governor-transitions', screen.transitions, String(governor.transitions))
        // F17 — the one reading that needs no node, and it IS on screen now. The other half
        // of the stopped-wins decision recorded in `surfaces/fabric.ts`'s header.
        const isolation = window.o2.isolation()
        const expected =
          `cross-origin isolated: ${isolation.crossOriginIsolated ? 'yes' : 'no'}` +
          ` · SharedArrayBuffer: ${isolation.hasSharedArrayBuffer ? 'yes' : 'no'}` +
          ` · in an iframe: ${isolation.inIframe ? 'yes' : 'no'}`
        if (screen.isolation !== expected) say('fabric/isolation', screen.isolation, expected)
        const addresses = window.o2.addresses()
        if (addresses.webrtc.length + addresses.circuit.length === 0) {
          problems.push('the fixture produced no dialable address at all')
        }
        for (const addr of [addresses.peerId, ...addresses.webrtc, ...addresses.circuit]) {
          if (!screen.addresses.includes(addr)) say('fabric/addresses', screen.addresses, addr)
        }
        // F18 and F19 are read on the join, through `refreshReport`. A tab that joined has
        // asked, so this may not still be the sentence for a tab that has not.
        if (screen.startReached === '') problems.push('fabric/start-reached is empty')

        // The two async readings last, because awaiting is what lets the screen move.
        const compute = (await window.o2.computePeers()).length
        if (!screen.computePeers.startsWith(String(compute))) say('fabric/compute-peers', screen.computePeers, String(compute))
        const blocks = await window.o2.storedBlocks()
        if (!screen.blocks.startsWith(String(blocks))) say('fabric/blocks', screen.blocks, String(blocks))
        return problems
      })

    await expect.poll(disagreements, { timeout: 120_000, interval: 1_000 }).toEqual([])

    const regions = await readFabric(a.page)
    const fresh = await a.page.evaluate(async () => ({
      capacity: window.o2.capacity(),
      governor: window.o2.governor(),
      held: window.o2.heldPeers(),
    }))

    // Every one of the twenty-one, verbatim, on every run. A summary that lists which
    // regions carry a reading and which carry a named absence should be quoting this
    // rather than deriving it — *never write a measured span you did not measure* applies
    // to a table of sentences exactly as it does to a number.
    for (const region of FABRIC_READINGS) {
      const dom = regions.find((entry) => entry.id === region.id)
      const absent = absenceSentences(region).includes(dom?.text ?? '')
      process.stderr.write(
        `[region] ${region.id} | ${absent ? 'ABSENCE' : 'reading'} | ${(dom?.text ?? '').replace(/\n/g, ' ⏎ ')}\n`,
      )
    }

    process.stderr.write(
      `[two tabs] capacity: dutyCycle=${fresh.capacity.dutyCycle} slots=${fresh.capacity.slots}\n` +
        `[two tabs] governor: hidden=${fresh.governor.hidden} dutyCycle=${fresh.governor.dutyCycle}` +
        ` transitions=${fresh.governor.transitions} sleptMs=${fresh.governor.sleptMs}\n` +
        `[two tabs] heldPeers: ${JSON.stringify(fresh.held)}\n` +
        `[two tabs] F4 on screen: ${textOf(regions, 'fabric/peer-rows').replace(/\n/g, ' ⏎ ')}\n` +
        `[two tabs] F5 on screen: ${textOf(regions, 'fabric/relayed-only').replace(/\n/g, ' ⏎ ')}\n` +
        `[two tabs] F18 on screen: ${textOf(regions, 'fabric/start-reached')}\n` +
        `[two tabs] F19 on screen: ${textOf(regions, 'fabric/start-tallies').replace(/\n/g, ' ⏎ ')}\n` +
        `[two tabs] F20 on screen: ${textOf(regions, 'fabric/blocks')}\n` +
        `[two tabs] F21 on screen: ${textOf(regions, 'fabric/addresses').replace(/\n/g, ' ⏎ ')}\n`,
    )
  }, 300_000)

  // ---- a reading that throws --------------------------------------------------------------

  it('renders a thrown message verbatim and leaves the other twenty standing', async () => {
    const [a] = tabs as [Tab]
    const before = await readFabric(a.page)

    // The harness intervention, and it is on the page's own object rather than on the
    // source: everything downstream — the page's per-reading `try`/`catch`, the formatter,
    // the writer, the DOM — is real. With a node running no reading throws, so this arm is
    // not reachable by arranging the fabric.
    await a.page.evaluate(() => {
      const api = window.o2 as unknown as Record<string, unknown>
      ;(api as { __realGovernor?: unknown }).__realGovernor = api['governor']
      api['governor'] = () => {
        throw new Error('planted: the governor is unavailable')
      }
    })
    await a.page.waitForFunction(
      () =>
        (document.querySelector('[data-region="fabric/governor-hidden"]')?.textContent ?? '') ===
        'planted: the governor is unavailable',
      null,
      { timeout: 60_000 },
    )
    const during = await readFabric(a.page)

    // The thrown message, verbatim, in all three regions that call it.
    for (const id of [
      'fabric/governor-hidden',
      'fabric/governor-duty',
      'fabric/governor-transitions',
    ]) {
      expect(textOf(during, id)).toBe('planted: the governor is unavailable')
    }
    // And the neighbours are unchanged — one throwing call is not twenty blanks. Compared
    // against what they read BEFORE the throw, so an empty region cannot pass by equalling
    // an absence sentence.
    for (const id of ['fabric/peers-all', 'fabric/duty-user', 'fabric/slots', 'fabric/addresses']) {
      expect(textOf(during, id), `${id} was blanked by another reading's throw`).toBe(
        textOf(before, id),
      )
      expect(textOf(during, id)).not.toBe('')
    }

    // Restored, and the page recovers on its own next tick.
    await a.page.evaluate(() => {
      const api = window.o2 as unknown as Record<string, unknown>
      api['governor'] = (api as { __realGovernor?: unknown }).__realGovernor
    })
    await a.page.waitForFunction(
      () =>
        (document.querySelector('[data-region="fabric/governor-hidden"]')?.textContent ?? '') !==
        'planted: the governor is unavailable',
      null,
      { timeout: 60_000 },
    )
  }, 300_000)

  // ---- the duty-cycle slider ----------------------------------------------------------------

  it('moves the cap from the slider, and renders a refused one in the governor’s own words', async () => {
    const [a] = tabs as [Tab]
    await a.page.fill('#duty-slider', '50')
    await a.page.waitForFunction(
      () => (document.querySelector('[data-region="fabric/duty-user"]')?.textContent ?? '') === '0.50',
      null,
      { timeout: 60_000 },
    )
    const applied = await a.page.evaluate(() => window.o2.capacity().dutyCycle)
    expect(applied).toBeCloseTo(0.5, 5)
    expect(await a.page.textContent('#duty-status')).toBe(DUTY_APPLIED)

    // The refusal. `setDutyCycle` throws a `RangeError` naming the value for anything
    // outside `(0, 1]`, and the slider cannot produce one — its `min` is above zero,
    // because a control offering a position the fabric refuses is a control that spells a
    // refusal. So the refused call is made the way the plan names, and the assertion is
    // the one that matters: **a tab whose call threw is unchanged.**
    const refusal = await a.page.evaluate(() => {
      try {
        window.o2.setDutyCycle(0)
        return { threw: false, message: '', after: window.o2.capacity().dutyCycle }
      } catch (error) {
        return {
          threw: true,
          message: error instanceof Error ? error.message : String(error),
          after: window.o2.capacity().dutyCycle,
        }
      }
    })
    expect(refusal.threw).toBe(true)
    expect(refusal.message).toContain('(0, 1]')
    // No partial application of a cap. This is the half a rendered message cannot carry.
    expect(refusal.after).toBeCloseTo(0.5, 5)

    // And the page renders that message verbatim when the control produces it. Driven
    // through the handler by giving the slider a value below its own minimum: the DOM
    // clamps `.value`, so the event is dispatched with the number the governor refuses.
    await a.page.evaluate(() => {
      const slider = document.getElementById('duty-slider') as HTMLInputElement
      slider.min = '0'
      slider.value = '0'
      slider.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await a.page.waitForFunction(
      () => (document.getElementById('duty-status')?.textContent ?? '').includes('(0, 1]'),
      null,
      { timeout: 60_000 },
    )
    const rendered = await a.page.evaluate(() => ({
      status: document.getElementById('duty-status')?.textContent ?? '',
      slider: (document.getElementById('duty-slider') as HTMLInputElement).value,
      capacity: window.o2.capacity().dutyCycle,
    }))
    // Verbatim — the governor's own message, with nothing added by the page.
    expect(rendered.status).toBe(refusal.message)
    // The slider went back to the effective rate rather than sitting at the refused one.
    expect(rendered.slider).toBe('50')
    expect(rendered.capacity).toBeCloseTo(0.5, 5)

    process.stderr.write(`[slider] refusal rendered verbatim: ${rendered.status}\n`)

    // Put the tab back where the rest of the file found it.
    await a.page.evaluate(() => {
      const slider = document.getElementById('duty-slider') as HTMLInputElement
      slider.min = '5'
      window.o2.setDutyCycle(1)
      slider.value = '100'
    })
  }, 300_000)

  // ---- after a run on another surface -------------------------------------------------------

  it('carries the last run’s receipt and manifest, and F7 is the description verbatim', async () => {
    const [a] = tabs as [Tab]
    await a.page.click('#nav-colouring')
    await a.page.waitForSelector('#s-colouring', { state: 'visible', timeout: 30_000 })
    await a.page.click('#s-colouring .btn-primary')
    await a.page.waitForFunction(
      () => (document.getElementById('run-status')?.textContent ?? '').startsWith('settled'),
      null,
      { timeout: 600_000 },
    )
    await a.page.click('#nav-fabric')
    await a.page.waitForSelector('#s-fabric', { state: 'visible', timeout: 30_000 })
    await a.page.waitForFunction(
      () => {
        const text =
          document.querySelector('[data-region="fabric/egress-frames"]')?.textContent ?? ''
        return /[0-9]/.test(text)
      },
      null,
      { timeout: 60_000 },
    )

    const regions = await readFabric(a.page)
    const hook = await a.page.evaluate((name) => {
      const value = (window as unknown as Record<string, unknown>)[name]
      return value === undefined || value === null ? null : JSON.stringify(value)
    }, ATTESTATION_HOOK)

    // F6, F7, F8 — populated, and none of them a catalogue sentence any more.
    for (const id of [
      'fabric/attestation-strength',
      'fabric/attestation-description',
      'fabric/attestation-counts',
      'fabric/egress-frames',
      'fabric/egress-bytes',
      'fabric/egress-withheld',
    ]) {
      const region = CATALOGUE.get(id)
      const dom = regions.find((entry) => entry.id === id)
      expect(dom?.text, `${id} is empty after a run`).not.toBe('')
      expect(
        absenceSentences(region as Region).includes(dom?.text ?? ''),
        `${id} still reads as absent after a run: "${dom?.text}"`,
      ).toBe(false)
    }

    // P8 over this panel, with the per-surface hook. Before Plan 27-08 the hook was one
    // value and there are three attestation regions on this page, so this comparison was
    // against whichever surface ran last rather than against what this one rendered.
    const attest = p8(regions, hook)
    process.stderr.write(
      `[P8·fabric] examined ${attest.examined}; hook ${hook === null ? 'ABSENT' : 'present'}\n`,
    )
    expect(attest.hookProblem).toBeNull()
    expect(attest.problems).toEqual([])
    expect(attest.examined).toBeGreaterThan(0)
    // The hook really is keyed by surface, and the fabric key really is present — without
    // this the case above would pass on the flat fallback and prove nothing new.
    const keyed = JSON.parse(hook ?? 'null') as { bySurface?: Record<string, unknown> } | null
    expect(Object.keys(keyed?.bySurface ?? {})).toContain('fabric')
    expect(Object.keys(keyed?.bySurface ?? {})).toContain('colouring')

    // P6 and P7 over this panel too — the fabric surface is invisible to both in
    // `demo-liveness.e2e.test.ts`, because that property collects only the panels it drove
    // and this surface has no run control for it to drive.
    const six = p6(regions)
    const seven = p7(regions)
    process.stderr.write(
      `[P6·fabric] examined ${six.examined}\n[P7·fabric] examined ${seven.examined}\n`,
    )
    expect(six.problems).toEqual([])
    expect(seven.problems).toEqual([])
    expect(six.examined, 'P6 examined nothing on the fabric panel after a run').toBeGreaterThan(0)
    expect(seven.examined, 'P7 examined nothing on the fabric panel after a run').toBeGreaterThan(0)

    process.stderr.write(
      `[after a run] F6: ${textOf(regions, 'fabric/attestation-strength')}\n` +
        `[after a run] F7: ${textOf(regions, 'fabric/attestation-description')}\n` +
        `[after a run] F8: ${textOf(regions, 'fabric/attestation-counts')}\n` +
        `[after a run] F9: ${textOf(regions, 'fabric/egress-frames')}` +
        ` · F10: ${textOf(regions, 'fabric/egress-bytes')}\n` +
        `[after a run] F11: ${textOf(regions, 'fabric/egress-withheld').replace(/\n/g, ' ⏎ ')}\n`,
    )
  }, 900_000)

  it('repaints every region on Stop rather than leaving a figure from a fabric it has left', async () => {
    const [, b] = tabs as [Tab, Tab]
    // Tab b, so the arms above keep their fixture. It was joined and has readings.
    const before = await readFabric(b.page)
    expect(textOf(before, 'fabric/isolation')).toContain('cross-origin isolated')

    await b.page.click('#stop')
    await b.page.waitForFunction(() => window.o2.activity() === null, null, { timeout: 60_000 })
    await b.page.waitForFunction(
      () =>
        (document.querySelector('[data-region="fabric/addresses"]')?.textContent ?? '').startsWith(
          'No addresses',
        ),
      null,
      { timeout: 60_000 },
    )

    const after = await readFabric(b.page)
    const survivors: string[] = []
    for (const region of FABRIC_READINGS) {
      const dom = after.find((entry) => entry.id === region.id)
      if (dom?.text !== region.absence?.stopped) {
        survivors.push(`${region.id}: on screen "${dom?.text}"`)
      }
    }
    expect(
      survivors,
      'a region kept a value after Stop — the retained previous value UI-SPEC names beside the blank and the number',
    ).toEqual([])
    expect((await b.page.textContent('#fabric-report'))?.trim()).toBe(SURFACE_STOPPED)
  }, 300_000)
})
