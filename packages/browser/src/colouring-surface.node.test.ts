import { describe, expect, it } from 'vitest'
import type { ShardAttestation, ShardQuorum } from '@o2/core'
import { describeQuorum } from '@o2/core'
import type { EgressManifest } from '@o2/net'
import {
  COLOURING_STOP_ABSENCE_IDS,
  bestOf,
  format,
  formatArgs,
  formatConstants,
  formatVerification,
} from '../demo/surfaces/colouring.ts'
import type { ColouringState } from '../demo/surfaces/colouring.ts'
import { REGIONS } from './demo-regions.ts'
import type { TabColouringRun } from './tab-api.ts'

/**
 * The colouring surface's formatter, exercised with **no DOM and no node** — Plan 27-04.
 *
 * This file runs in the `node` project, where `document` and `window` do not exist. That is
 * the point rather than a convenience: UI-SPEC section 2.2 asks for *one pure function per
 * surface, taking the reading and returning a record of already-formatted strings*, and a
 * function that could not be called here would not be that function. If `format` ever grows a
 * DOM reference, this file stops loading.
 *
 * It also reaches three arms the end-to-end specs cannot reach on a healthy fabric — a ladder
 * that settles nothing, a rung that throws, and a ladder that stops before its last rung — and
 * those are exactly the arms where a page is most likely to render a stale reading or a
 * sentence that is no longer true.
 */

const RECEIPT: ShardAttestation = {
  strength: 'owner-attested',
  description: 'owner-attested — computed once by the data owner and not independently verified',
  replicas: 1,
  operators: ['harbour-road-volunteers'],
  userKeys: [],
  sharedRelay: null,
}

const NO_RECEIPT: ShardAttestation = {
  kind: 'holds-no-verified-attestation',
  reason: '12D3KooWfake: this requestor holds no certificate for it',
  agreeing: 2,
  verified: 1,
}

/**
 * The composer refusing a quorum whose every member hangs off one relay — VER-03.
 *
 * `reason` is `composeQuorum`'s own sentence, transcribed rather than invented, so a rewording
 * upstream shows up here as a failing comparison instead of as two sentences that differ by a
 * comma.
 */
const REFUSED_SHARED_RELAY: ShardQuorum = {
  kind: 'not-composed',
  refusal: { kind: 'shared-relay-dependency', relayId: '12D3KooWrelay' },
  reason:
    'every member of the quorum is discoverable only through relay 12D3KooWrelay; ' +
    'its failure would lose the whole quorum',
}

/** The composer succeeding — two operators, no two members sharing one. VER-04. */
const COMPOSED_TWO_OPERATORS: ShardQuorum = {
  kind: 'composed',
  operators: ['harbour-road-volunteers', 'east-pier-compute'],
}

function manifest(violations: readonly string[] = []): EgressManifest {
  return {
    entries: [
      { peerId: 'peer-a', bytes: 40, label: 'public' },
      { peerId: 'peer-b', bytes: 60, label: 'public' },
    ],
    totalBytes: 100,
    violations: [...violations],
    // EGR-01 — every cube `runColouring` submits is `label: 'public'`, so the run this fixture
    // stands for registered nothing. Stated rather than omitted: the omission would select a
    // different arm of `egressLines`, and the arm it selects is the one that used to be false.
    registeredSovereign: 0,
  } as unknown as EgressManifest
}

function run(overrides: Partial<TabColouringRun> = {}): TabColouringRun {
  return {
    n: 300,
    cubes: 16,
    complete: true,
    found: true,
    statuses: ['found', 'exhausted', 'budget'],
    agreeing: [['peer-a', 'peer-b'], ['peer-a', 'peer-b'], []],
    verificationMultiplier: 2,
    elapsedMs: 412.6,
    egress: manifest(),
    attestation: RECEIPT,
    // VER-03, VER-04 — C22. The default is a *refusal*, not a composed quorum, and that is
    // deliberate: this fixture stands for the ordinary browser run, and every peer a tab can
    // reach is discovered through the relay it reserved on. A fixture defaulting to
    // `composed` would make the page's happiest case its most-exercised one.
    quorum: REFUSED_SHARED_RELAY,
    ...overrides,
  }
}

/** Every colouring region that is a figure — the eighteen `format` owns, plus the four it does not. */
const FIGURE_IDS: readonly string[] = REGIONS.filter(
  (region) =>
    region.surface === 'colouring' &&
    ['reading', 'constant', 'control'].includes(region.kind) &&
    !region.id.startsWith('colouring/verify-'),
).map((region) => region.id)

/** Every absence sentence the catalogue holds for a region. A reading equals none of them. */
function absencesOf(id: string): readonly string[] {
  const absence = REGIONS.find((region) => region.id === id)?.absence
  if (absence === undefined) return []
  const out = [absence.initial, absence.stopped]
  if (absence.unavailable !== undefined) out.push(absence.unavailable)
  return out
}

const SETTLED: ColouringState = {
  peers: 1,
  rungs: [
    { n: 300, run: run({ n: 300 }) },
    { n: 400, run: run({ n: 400, elapsedMs: 900 }) },
    { n: 500, run: run({ n: 500, found: false, statuses: ['exhausted', 'budget', 'budget'] }) },
  ],
}

describe('the colouring formatter, with no DOM', () => {
  it('names every one of its eighteen regions in every arm, so nothing keeps a stale value', () => {
    const arms: Record<string, ColouringState> = {
      settled: SETTLED,
      'nothing settled': { peers: 0, rungs: [{ n: 300, run: run({ found: false }) }] },
      'a rung threw': { peers: 0, rungs: [{ n: 300, error: 'node not started' }] },
      'the ladder stopped short': { peers: 2, rungs: [{ n: 300, run: run() }] },
    }
    for (const [name, state] of Object.entries(arms)) {
      const rendered = Object.keys(format(state).regions).sort()
      expect(rendered, `${name}: a region left out keeps whatever was last painted there`).toEqual(
        [...FIGURE_IDS].sort(),
      )
    }
  })

  it('says a rung was not attempted rather than that it has not been run', () => {
    const short = format({ peers: 2, rungs: [{ n: 300, run: run() }] })
    for (const id of ['colouring/rung-400', 'colouring/rung-500', 'colouring/rung-600']) {
      const text = short.regions[id]
      expect(text).toBe('Not attempted: the ladder stopped at an earlier rung.')
      // The sentence that would be a lie after a run: the ladder HAS been run.
      expect(text).not.toContain('has not been run')
    }
  })

  it("carries a thrown rung's message verbatim, behind section 11's prefix", () => {
    const threw = format({ peers: 0, rungs: [{ n: 300, error: 'no executor answered' }] })
    expect(threw.regions['colouring/rung-300']).toBe('The run stopped: no executor answered')
    expect(threw.text.join('\n')).toContain('n = 300: no executor answered')
  })

  it('renders the ladder into the text view line for line, unchanged', () => {
    const text = format(SETTLED).text
    expect(text[0]).toBe('1 peer(s) · 16 cubes per rung')
    expect(text[1]).toBe('')
    expect(text[2]).toBe('n =  300  FOUND     1 found · 1 proved empty · 1 out of budget  413ms')
    expect(text).toContain('Stopped here. 2 cube(s) ran out of steps — that is a')
    expect(text).toContain('shortage of search, not a proof that no colouring exists.')
    expect(text).toContain('Best settled: n = 400, every cube agreed: true')
    expect(text).toContain('Verification cost 2.00×.')
    expect(text).toContain('Where the last rung ran:')
    expect(text).toContain('  cube 0: peer-a + peer-b')
    expect(text).toContain('  cube 2: no agreement')
    expect(text).toContain('This answer has not been checked. The button below checks it.')
  })

  it('formats one value once: every P6 field also occurs in the text view', () => {
    const rendered = format(SETTLED)
    const view = rendered.text.join('\n')
    for (const id of ['colouring/best-n', 'colouring/verification-multiplier']) {
      const figure = rendered.regions[id] ?? ''
      expect(figure, `${id} rendered nothing`).not.toBe('')
      expect(
        view.includes(figure),
        `${id} renders "${figure}" and the text view does not contain it — one value, two formatters`,
      ).toBe(true)
    }
    // C11's counts are the same substring the rung line carries, from one function.
    expect(view).toContain(rendered.regions['colouring/status-counts'] ?? 'x')
  })

  it('keeps the withheld count and its sentence in one region', () => {
    const clean = format(SETTLED).regions['colouring/egress'] ?? ''
    expect(clean).toContain('0 withheld')
    expect(clean).toContain('registered no sovereign data')

    const withheld = format({
      peers: 1,
      rungs: [{ n: 300, run: run({ egress: manifest(['shard-3']) }) }],
    }).regions['colouring/egress']
    expect(withheld).toContain('WITHHELD')
    expect(withheld).toContain('They were not sent anywhere.')
  })

  it("renders the kernel's own attestation words and composes none of its own", () => {
    const receipt = format(SETTLED).regions['colouring/attestation']
    expect(receipt).toBe(RECEIPT.description)

    const absent = format({
      peers: 1,
      rungs: [{ n: 300, run: run({ attestation: NO_RECEIPT }) }],
    }).regions['colouring/attestation']
    expect(absent).toContain('12D3KooWfake: this requestor holds no certificate for it')
    // No strength claimed where none was established.
    expect(absent).not.toContain('owner-attested')
  })

  it("renders the composer's own quorum words, kind included, and composes none of its own", () => {
    const refused = format(SETTLED).regions['colouring/quorum']
    expect(refused).toBe(describeQuorum(REFUSED_SHARED_RELAY))
    // The kind is the assertable part — a caller that can read it can tell an
    // over-concentrated fabric from any other degradation, and one that cannot, cannot.
    expect(refused).toContain('[shared-relay-dependency]')
    expect(refused).toContain('12D3KooWrelay')

    const composed = format({
      peers: 2,
      rungs: [{ n: 300, run: run({ quorum: COMPOSED_TWO_OPERATORS }) }],
    }).regions['colouring/quorum']
    expect(composed).toBe(describeQuorum(COMPOSED_TWO_OPERATORS))
    expect(composed).toContain('east-pier-compute')
    // VER-04 — anti-affinity, stated as the property rather than implied by a count.
    expect(composed).toContain('no two members share an operator')

    // The two verdicts are DISTINGUISHABLE on screen. Without this the region could be a
    // constant and every assertion above would still pass.
    expect(composed).not.toBe(refused)
  })

  it('does not derive the quorum verdict from the attestation — VER-03’s whole trap', () => {
    // The reason this case exists: `AttestationReceipt` carries its own `sharedRelay`, and a
    // page deriving C22 from the receipt would look correct on every ordinary run. So hold one
    // input still and move the other, in both directions. A region derived from the wrong
    // value fails one of the two halves.

    // Attestation moves, quorum does not: same refusal text under three different receipts,
    // including one whose receipt reports NO shared relay at all.
    const receiptWithNoSharedRelay: ShardAttestation = { ...RECEIPT, sharedRelay: null }
    const receiptNamingOne: ShardAttestation = { ...RECEIPT, sharedRelay: '12D3KooWsomethingElse' }
    const quorumUnder = (attestation: ShardAttestation): string | undefined =>
      format({ peers: 1, rungs: [{ n: 300, run: run({ attestation }) }] }).regions['colouring/quorum']

    expect(quorumUnder(receiptWithNoSharedRelay)).toBe(describeQuorum(REFUSED_SHARED_RELAY))
    expect(quorumUnder(receiptNamingOne)).toBe(describeQuorum(REFUSED_SHARED_RELAY))
    expect(quorumUnder(NO_RECEIPT)).toBe(describeQuorum(REFUSED_SHARED_RELAY))
    // And it never picks up the receipt's peer id, which is what a derived region would.
    expect(quorumUnder(receiptNamingOne)).not.toContain('12D3KooWsomethingElse')

    // Quorum moves, attestation does not: one receipt, two verdicts, two different strings.
    const held = { peers: 1, rungs: [{ n: 300, run: run({ attestation: RECEIPT }) }] }
    const heldComposed = {
      peers: 1,
      rungs: [{ n: 300, run: run({ attestation: RECEIPT, quorum: COMPOSED_TWO_OPERATORS }) }],
    }
    expect(format(held).regions['colouring/attestation']).toBe(
      format(heldComposed).regions['colouring/attestation'],
    )
    expect(format(held).regions['colouring/quorum']).not.toBe(
      format(heldComposed).regions['colouring/quorum'],
    )
  })

  it('says the fabric settled nothing rather than that nothing was run', () => {
    const nothing = format({ peers: 0, rungs: [{ n: 300, run: run({ found: false }) }] })
    expect(bestOf({ peers: 0, rungs: [{ n: 300, run: run({ found: false }) }] })).toBeNull()
    for (const id of FIGURE_IDS) {
      const region = REGIONS.find((r) => r.id === id)
      if (region?.kind !== 'reading') continue
      if (id.startsWith('colouring/rung-')) continue
      const text = nothing.regions[id] ?? ''
      expect(text, `${id} is empty`).not.toBe('')
      expect(
        absencesOf(id).slice(0, 2).includes(text),
        `${id} reads "${text}", which is its pre-run or stopped sentence after a real run`,
      ).toBe(false)
    }
  })

  it('tells the verification card there is no answer, never that the node is stopped', () => {
    const idle = formatVerification({
      checked: false,
      ok: false,
      n: 0,
      triplesChecked: 0,
      violation: null,
    })
    for (const text of Object.values(idle.regions)) {
      expect(text).toBe('Not checked: no answer has been produced to check.')
      expect(text).not.toContain('stopped')
    }
    expect(idle.text).toEqual(['nothing to check yet'])
  })

  it('puts the verdict, the n, the triples and the refutation on the card', () => {
    const checked = formatVerification({
      checked: true,
      ok: true,
      n: 400,
      triplesChecked: 386,
      violation: null,
    })
    expect(checked.regions['colouring/verify-verdict']).toBe('Correct')
    expect(checked.regions['colouring/verify-n']).toBe('400')
    expect(checked.regions['colouring/verify-triples']).toBe('386')
    expect(checked.regions['colouring/verify-violation']).toBe(
      'No refutation: every triple checked has two colours among its three numbers.',
    )
    expect(checked.text[0]).toContain('Correct.')
    expect(checked.text[0]).toContain('Pythagorean triples')

    const refuted = formatVerification({
      checked: true,
      ok: false,
      n: 400,
      triplesChecked: 386,
      violation: '(3, 4, 5)',
    })
    expect(refuted.regions['colouring/verify-verdict']).toBe('REFUTED')
    expect(refuted.regions['colouring/verify-violation']).toBe('(3, 4, 5)')
  })

  it('derives the arguments and the constants from the shipped code, not from a literal', () => {
    expect(formatArgs(0)).toEqual({
      'colouring/cubes-arg': '8',
      'colouring/redundancy-arg': '1',
    })
    expect(formatArgs(3)).toEqual({
      'colouring/cubes-arg': '32',
      'colouring/redundancy-arg': '2',
    })
    const constants = formatConstants()
    // Read against the exported symbols rather than transcribed: a transcription is a
    // second copy of a number nobody recomputes when the builder changes.
    expect(Number(constants['colouring/input-bytes'])).toBeGreaterThan(0)
    expect(Object.keys(constants).sort()).toEqual([
      'colouring/budget',
      'colouring/input-bytes',
      'colouring/max-n',
    ])
  })

  it('leaves the verification regions out of the stop repaint — the check needs no node', () => {
    expect(COLOURING_STOP_ABSENCE_IDS).toContain('colouring/best-n')
    expect(COLOURING_STOP_ABSENCE_IDS).not.toContain('colouring/verify-verdict')
    expect(COLOURING_STOP_ABSENCE_IDS).not.toContain('colouring/verify-violation')
  })
})
