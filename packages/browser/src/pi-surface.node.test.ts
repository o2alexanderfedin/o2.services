import type { EgressManifest } from '@o2/net'
import { describe, expect, it } from 'vitest'
import {
  PUBLISHED_PI,
  SECOND_DEVICE_HEADLINE,
  format,
  formatArgs,
  shardsFor,
  termsFor,
} from '../demo/surfaces/pi.ts'
import { REGIONS } from './demo-regions.ts'
import type { TabPiRun } from './tab-api.ts'

/**
 * The π surface's formatter, exercised with **no DOM and no node** — Plan 27-05.
 *
 * It runs in the `node` project, where `document` and `window` do not exist, for the reason
 * `colouring-surface.node.test.ts` gives one file over: UI-SPEC section 2.2 asks for one pure
 * function per surface, and a function that could not be called here would not be that
 * function. If `format` ever grows a DOM reference this file stops loading.
 *
 * **It also reaches the arm the browser cannot be made to reach on demand.** `reduceAttempted:
 * true` with `combined: false` — a reduce that started and whose every combine failed — is a
 * real state of the fabric that a healthy two-tab fixture does not produce to order.
 * `demo-pi.e2e.test.ts` asserts it *if* it lands there and reports which arm it observed; this
 * file is where that arm is actually checked.
 */

const LONE_TAB_REASON = 'no executor to combine on'

function manifest(violations: readonly string[] = []): EgressManifest {
  return {
    entries: [
      { peerId: 'peer-a', bytes: 40, label: 'public' },
      { peerId: 'peer-b', bytes: 60, label: 'public' },
    ],
    totalBytes: 100,
    violations: [...violations],
  } as unknown as EgressManifest
}

/** A lone tab's run: mapped every shard, combined none, and said why. */
function loneTab(overrides: Partial<TabPiRun> = {}): TabPiRun {
  return {
    terms: 1_000_000,
    shards: 4,
    complete: true,
    reduceAttempted: false,
    reduceReason: LONE_TAB_REASON,
    combined: false,
    treeDepth: 0,
    combines: 0,
    estimate: null,
    errorBound: 4 / (2 * 1_000_000 + 1),
    elapsedMs: 1234.5,
    egress: manifest(),
    ...overrides,
  }
}

/** A reduce that started. `reduceReason` is null by contract once `ok` is true. */
function attempted(overrides: Partial<TabPiRun> = {}): TabPiRun {
  return loneTab({
    reduceAttempted: true,
    reduceReason: null,
    treeDepth: 2,
    combines: 0,
    ...overrides,
  })
}

/** A reduce that produced an aggregate. */
function combinedRun(overrides: Partial<TabPiRun> = {}): TabPiRun {
  return attempted({
    combined: true,
    combines: 3,
    estimate: 3.141_591_653_589_793,
    ...overrides,
  })
}

const PI_IDS: readonly string[] = REGIONS.filter(
  (region) => region.surface === 'pi' && (region.kind === 'reading' || region.kind === 'control'),
).map((region) => region.id)

describe('the pi formatter — every arm returns every region', () => {
  it('returns all fourteen of P1-P14 in every arm, and nothing that is not a pi region', () => {
    for (const [arm, run] of [
      ['lone tab', loneTab()],
      ['attempted, not combined', attempted()],
      ['combined', combinedRun()],
      ['combined with no estimate', combinedRun({ estimate: null })],
    ] as const) {
      const { regions } = format({ peers: 1, run })
      const keys = Object.keys(regions).sort()
      expect({ arm, keys }).toEqual({ arm, keys: [...PI_IDS].sort() })
      for (const [id, text] of Object.entries(regions)) {
        expect({ arm, id, empty: text === '' }).toEqual({ arm, id, empty: false })
      }
    }
  })

  it('shows the two arguments it would send, derived from the peer count', () => {
    // More devices, more shards — and because the term count per shard is fixed, more terms
    // and a tighter bound. That is this surface's arc and it is visible before any dispatch.
    expect(shardsFor(0)).toBeLessThan(shardsFor(2))
    expect(termsFor(0)).toBeLessThan(termsFor(2))
    expect(formatArgs(2)).toEqual({
      'pi/terms-arg': String(termsFor(2)),
      'pi/shards-arg': String(shardsFor(2)),
    })
  })
})

describe('the lone tab — a condition of the topology, not a failure and not a zero', () => {
  it("carries section 5.3's panel with the fabric's own reason quoted verbatim", () => {
    const { regions, text } = format({ peers: 0, run: loneTab() })
    const panel = regions['pi/reduce-attempted'] ?? ''
    expect(panel).toContain(SECOND_DEVICE_HEADLINE)
    expect(panel).toContain('The submitter is excluded from the combine executor set by contract')
    // Verbatim, and labelled as the fabric's rather than the page's.
    expect(panel).toContain(`The fabric's own reason: ${LONE_TAB_REASON}`)
    // The same string in the text view, because both come out of one record.
    expect(text.join('\n')).toContain(LONE_TAB_REASON)
    expect(text.join('\n')).toContain(SECOND_DEVICE_HEADLINE)
  })

  it('quotes whatever reason the fabric gives, not a remembered one', () => {
    const other = 'every combine executor refused the module record'
    const { regions } = format({ peers: 0, run: loneTab({ reduceReason: other }) })
    expect(regions['pi/reduce-attempted']).toContain(`The fabric's own reason: ${other}`)
    expect(regions['pi/reduce-attempted']).not.toContain(LONE_TAB_REASON)
  })

  it('names the absence of the tree, the aggregate and the comparison — never a zero', () => {
    const { regions } = format({ peers: 0, run: loneTab() })
    expect(regions['pi/tree-depth']).toBe('No tree: no reduce was attempted — see above.')
    expect(regions['pi/combines']).toBe('No tree: no reduce was attempted — see above.')
    expect(regions['pi/estimate']).toBe(
      'No estimate: the fabric produced no aggregate to read back.',
    )
    expect(regions['pi/against-published']).toBe(
      'No comparison: the fabric produced no aggregate to compare.',
    )
    // P7's catalogue sentence says *a reduce was started*, which is untrue here. Composed.
    expect(regions['pi/combined']).toBe('No aggregate: no reduce was attempted — see above.')

    // The whole point of the arm: nothing on this surface reads as a quantity of zero.
    const zeros = Object.entries(regions)
      .filter(([, value]) => /^\s*0\s*$/.test(value))
      .map(([id]) => id)
    expect(zeros).toEqual([])
  })

  it('still reads the map half, which a lone tab really did do', () => {
    const { regions } = format({ peers: 0, run: loneTab() })
    expect(regions['pi/terms']).toBe('1000000')
    expect(regions['pi/shards']).toBe('4')
    expect(regions['pi/complete']).toBe('true')
    expect(regions['pi/elapsed']).toBe('1235ms')
  })
})

describe('a reduce that started and combined nothing — the sibling case', () => {
  it('does not show the second-device panel', () => {
    const { regions, text } = format({ peers: 1, run: attempted() })
    expect(regions['pi/reduce-attempted']).not.toContain(SECOND_DEVICE_HEADLINE)
    expect(text.join('\n')).not.toContain(SECOND_DEVICE_HEADLINE)
  })

  it("reads UI-SPEC's own sentence for combined: false", () => {
    const { regions } = format({ peers: 1, run: attempted() })
    expect(regions['pi/combined']).toBe(
      'No aggregate: a reduce was started and no combine produced one.',
    )
  })

  it('draws the tree it really has, and refuses to print a combine count of zero', () => {
    const { regions } = format({ peers: 1, run: attempted({ treeDepth: 2 }) })
    expect(regions['pi/tree-depth']).toBe('depth 2\nmap\nlvl 1\nlvl 2')
    expect(regions['pi/combines']).toBe(
      'No count: a reduce was started and no combine produced an aggregate, so the fabric reported no combine count.',
    )
  })
})

describe('an aggregate, against a published constant', () => {
  it('renders the estimate once and puts that exact string in the text view', () => {
    const run = combinedRun()
    const { regions, text } = format({ peers: 2, run })
    const shown = regions['pi/estimate'] ?? ''
    expect(shown).toBe((run.estimate ?? 0).toFixed(9))
    // P6 in `demo-region-properties.ts` asserts exactly this against a real page.
    expect(text.join('\n')).toContain(shown)
  })

  it('puts both operands and the bound on screen, with pi marked as published', () => {
    const run = combinedRun()
    const { regions } = format({ peers: 2, run })
    const comparison = regions['pi/against-published'] ?? ''
    expect(comparison).toContain((run.estimate ?? 0).toFixed(9))
    expect(comparison).toContain(PUBLISHED_PI.toFixed(9))
    expect(comparison).toContain(run.errorBound.toFixed(9))
    expect(comparison).toContain('a published mathematical constant')
    expect(comparison).toContain('inside the bound')
    expect(regions['pi/error-bound']).toBe(run.errorBound.toFixed(9))
  })

  it('says so when the estimate falls outside the bound rather than rounding it away', () => {
    const { regions } = format({ peers: 2, run: combinedRun({ estimate: 3.2 }) })
    expect(regions['pi/against-published']).toContain('OUTSIDE the bound')
  })

  it('counts the combines, and names the one case where none was needed', () => {
    expect(format({ peers: 2, run: combinedRun() }).regions['pi/combines']).toBe('3')
    expect(
      format({ peers: 2, run: combinedRun({ combines: 0, treeDepth: 0 }) }).regions['pi/combines'],
    ).toBe('No combine was needed: a single partial is itself the aggregate.')
  })

  it('reads the named absence when the aggregate could not be read back', () => {
    const { regions } = format({ peers: 2, run: combinedRun({ estimate: null }) })
    expect(regions['pi/estimate']).toBe(
      'No estimate: the fabric produced no aggregate to read back.',
    )
    expect(regions['pi/against-published']).toBe(
      'No comparison: the fabric produced no aggregate to compare.',
    )
  })
})

describe('the manifest, and the sentence that may never be separated from it', () => {
  it('renders the count and its sentence as one region', () => {
    const { regions } = format({ peers: 2, run: combinedRun() })
    const egress = regions['pi/egress'] ?? ''
    expect(egress).toContain('What left this device:')
    expect(egress).toContain('0 withheld')
    expect(egress).toContain('registered no sovereign data')
  })

  it('carries the refusal arm through untouched when a frame was withheld', () => {
    const { regions } = format({
      peers: 2,
      run: combinedRun({ egress: manifest(['frame-7']) }),
    })
    expect(regions['pi/egress']).toContain('WITHHELD: frame-7')
    expect(regions['pi/egress']).toContain('They were not sent anywhere.')
  })
})
