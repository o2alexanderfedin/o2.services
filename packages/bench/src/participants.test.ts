import { describe, expect, it } from 'vitest'
import { LOCAL_COMBINE_EXECUTOR } from '@o2/core'
import { distinctParticipants, participantLabel } from './report.ts'

/**
 * The participant count, and the word it is not allowed to say — BENCH-06, criterion 4.
 *
 * Criterion 4 wants *"the distinct-machine count published beside the curve"*, and the
 * public run is browser tabs. A tab announces nothing about the machine it runs on —
 * `AgentOptions` carries no machine field and `browser-id.ts` refuses `platform` and
 * `hardwareConcurrency` by name — so the only identity a run's outcome carries is the
 * peer id in `ReduceOutcome.executedBy`. Two tabs on one laptop are two peer ids, which
 * is exactly the over-count BENCH-06's own row forbids: *"sixteen nodes on one laptop are
 * reported as sixteen processes on one machine"*.
 *
 * So these cases hold two properties at once. The count is **distinct** peers, and the
 * label **withholds** the machine noun until something supplies it. The second is the one
 * that needs a plant: `bench-inventory.ts` records a `hostCount` that was `1` by
 * construction and whose label no plant could falsify, and the same defect is one default
 * value away from happening here.
 */

/** Written out rather than composed — a spec that builds its expectation from the same
 * value the function reads moves with it and proves nothing. */
const TWO_PEER_LABEL =
  '2 distinct peers — machine count not measured; peers are tabs, and two tabs on one device are two peers'
const FIVE_PEER_LABEL =
  '5 distinct peers — machine count not measured; peers are tabs, and two tabs on one device are two peers'

describe('distinctParticipants counts peers, not contributions', () => {
  it('counts the distinct executor peer ids', () => {
    const executedBy = new Map([
      ['contribution-a', '12D3KooWAlpha'],
      ['contribution-b', '12D3KooWBeta'],
    ])
    expect(distinctParticipants(executedBy)).toBe(2)
  })

  it('answers 0 for an empty map', () => {
    expect(distinctParticipants(new Map())).toBe(0)
  })

  it('answers 0 when the only executor is the requestor itself', () => {
    // `LOCAL_COMBINE_EXECUTOR` is "an id no peer can present" — reduce.ts:348. A run whose
    // every combine stayed in the requestor's own process observed no participant at all,
    // and reporting 1 there would publish the requestor as a participant in its own run.
    const executedBy = new Map([
      ['contribution-a', LOCAL_COMBINE_EXECUTOR],
      ['contribution-b', LOCAL_COMBINE_EXECUTOR],
    ])
    expect(distinctParticipants(executedBy)).toBe(0)
  })

  it('answers 2 for three contributions executed by two peers, not 3', () => {
    const executedBy = new Map([
      ['contribution-a', '12D3KooWAlpha'],
      ['contribution-b', '12D3KooWBeta'],
      ['contribution-c', '12D3KooWAlpha'],
    ])
    expect(distinctParticipants(executedBy)).toBe(2)
  })

  it('excludes the local pseudo-executor from a mixed run', () => {
    const executedBy = new Map([
      ['contribution-a', '12D3KooWAlpha'],
      ['contribution-b', LOCAL_COMBINE_EXECUTOR],
      ['contribution-c', '12D3KooWBeta'],
    ])
    expect(distinctParticipants(executedBy)).toBe(2)
  })
})

describe('participantLabel withholds the machine noun until something supplies it', () => {
  it('names the peer count and says the machine count was not measured', () => {
    expect(participantLabel({ peers: 2, announcedMachines: null })).toBe(TWO_PEER_LABEL)
  })

  /**
   * The falsifying case.
   *
   * Replacing the null branch with the literal string it produces for a 2-peer reading
   * leaves the case above green and reddens this one. Without a second peer count the
   * function could be a constant wearing a derivation's shape, which is the defect
   * `bench-inventory.ts` records in its own words.
   */
  it('moves with the peer count — a five-peer reading is not the two-peer string', () => {
    expect(participantLabel({ peers: 5, announcedMachines: null })).toBe(FIVE_PEER_LABEL)
  })

  it('never says "machines" when no machine was announced', () => {
    expect(participantLabel({ peers: 5, announcedMachines: null })).not.toContain('machines')
  })

  it('names both counts once an announced-machine source supplies one', () => {
    expect(participantLabel({ peers: 5, announcedMachines: 3 })).toBe(
      '5 distinct peers on 3 announced machines',
    )
  })
})
