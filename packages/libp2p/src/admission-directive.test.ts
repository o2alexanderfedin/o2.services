/**
 * RUN-02's matcher, in the one place it is defined.
 *
 * Ten cases, one `it` each, so each has its own plant. The two that matter most are the
 * unreadable-version pair: they are the only place the slice rule's asymmetry is checked, and
 * a docblock stating it is not a check.
 *
 * The behavioural half — that a directive written to an object at run time reaches a tab and
 * stops it — is `admission-slices.e2e.test.ts` and `kill-switch-regions.e2e.test.ts`, because
 * that needs a real workerd and real tabs. What belongs here is the rule they both carry.
 */

import { describe, expect, it } from 'vitest'
import { ADMITTING, clientVersionFrom, isHaltedFor } from './admission-directive.ts'
import type { AdmissionDirective } from './admission-directive.ts'

const halt = (over: Partial<AdmissionDirective> = {}): AdmissionDirective => ({
  region: 'bootstrap-eu',
  halted: true,
  versions: 'all',
  since: 1_700_000_000_000,
  note: 'a region behaving badly',
  ...over,
})

describe('RUN-02 — whether a directive halts this client', () => {
  it('does not halt when the directive is not halted, whatever its slice says', () => {
    expect(isHaltedFor(halt({ halted: false, versions: ['1.2.3'] }), '1.2.3')).toBe(false)
  })

  it('halts a client on a known version when the slice is `all`', () => {
    expect(isHaltedFor(halt(), '1.2.3')).toBe(true)
  })

  it('halts a client whose version could NOT be read when the slice is `all`', () => {
    // `all` names every client by construction, including the ones that cannot name
    // themselves. There is nothing for an unreadable stamp to be excluded from.
    expect(isHaltedFor(halt(), null)).toBe(true)
  })

  it('halts a client whose version is named in the slice', () => {
    expect(isHaltedFor(halt({ versions: ['1.2.3'] }), '1.2.3')).toBe(true)
  })

  it('leaves a client whose version is not named in the slice admitting', () => {
    expect(isHaltedFor(halt({ versions: ['1.2.3'] }), '1.2.4')).toBe(false)
  })

  it('leaves a client whose version could NOT be read admitting under a version slice', () => {
    // **A slice means the slice.** An operator naming a version is naming a population they
    // can describe; a client that cannot say which slice it is in is not in it. Halting it
    // would halt an unknown population under a control whose whole purpose is halting exactly
    // the slice that is misbehaving instead of the whole fabric.
    expect(isHaltedFor(halt({ versions: ['1.2.3'] }), null)).toBe(false)
  })

  it('reads a many-version slice as a membership test rather than a first-entry test', () => {
    expect(isHaltedFor(halt({ versions: ['1.2.3', '1.2.4'] }), '1.2.4')).toBe(true)
  })

  it('never halts anything under ADMITTING, including a client with no readable version', () => {
    expect(isHaltedFor(ADMITTING, '1.2.3')).toBe(false)
    expect(isHaltedFor(ADMITTING, null)).toBe(false)
  })
})

describe('RUN-02 — the version half of a build stamp', () => {
  it('takes the first field of a clean build stamp', () => {
    expect(clientVersionFrom('1.2.3 abc1234')).toBe('1.2.3')
  })

  it('leaves a dirty build in the same slice as every other build on that version', () => {
    // `-dirty` belongs to the COMMIT field. A developer tree is not a separate release, and a
    // parser that read the whole string would put every dirty build in a slice of one — so an
    // operator halting `1.2.3` would miss exactly the tabs most likely to be misbehaving.
    expect(clientVersionFrom('1.2.3 abc1234-dirty')).toBe('1.2.3')
  })

  it('reads a version from a stamp built where git was unavailable', () => {
    expect(clientVersionFrom('1.2.3 no-commit')).toBe('1.2.3')
  })

  it('answers null for a stamp that is absent, empty, or has no readable field', () => {
    expect(clientVersionFrom(null)).toBe(null)
    expect(clientVersionFrom('')).toBe(null)
    expect(clientVersionFrom('   ')).toBe(null)
  })
})
