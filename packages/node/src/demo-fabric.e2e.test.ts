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
        egress: {
          nodeId: 'self',
          ownerId: 'public',
          entries: [{ peerId: 'peer-a', bytes: 10, label: 'public' }],
          totalBytes: 10,
          violations: ['owner-row-a'],
        } as unknown as FabricReadings['egress'],
      }),
    )
    const region = withheld.regions['fabric/egress-withheld'] ?? ''
    expect(region).toContain('WITHHELD')
    expect(region).toContain('They were not sent anywhere.')
    expect(withheld.regions['fabric/egress-frames']).toBe('1 frame')
    expect(withheld.regions['fabric/egress-bytes']).toBe('10 byte(s)')
  })

  it('puts every populated figure into its own text view, which is what P6 checks', () => {
    const full = format(
      readings({
        peers: ['a', 'b'],
        capacity: { dutyCycle: 0.5, slots: 2 },
        egress: {
          nodeId: 'self',
          ownerId: 'public',
          entries: [],
          totalBytes: 4096,
          violations: [],
        } as unknown as FabricReadings['egress'],
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
