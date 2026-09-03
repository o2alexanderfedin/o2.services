import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { HOSTED_OBJECT_NAMES } from './hosted-object.ts'
import { isDeclaredRegion, turnRegions, turnUrlsFor } from './turn-regions.ts'

/**
 * NET-12 — criterion 2's built half: three declared regions, three rungs, an undeclared one
 * refused, and no location claimed anywhere.
 *
 * **This file does not close criterion 2 and must not be read as though it did.** The criterion
 * asks for a cross-continent pair observed on its own region's rung. What is tested here is that
 * the mapping exists, is derived from the closed name set, and refuses a name outside it. The
 * missing evidence is named in `turn-regions.ts`'s header and is two things, not one: three
 * sited objects (Phase 33, gated on the owner) **and** clients on two continents (the cohort).
 */

const SHARED = 'turn:turn.example.invalid:3478?transport=udp,turn:turn.example.invalid:53?transport=udp'

describe('NET-12 — each declared region has its own rung', () => {
  it('yields exactly the three declared names, in the closed set’s order', () => {
    expect(turnRegions({ shared: SHARED }).map((entry) => entry.name)).toEqual([
      'bootstrap-us',
      'bootstrap-eu',
      'bootstrap-sam',
    ])
  })

  it('gives every declared region a non-empty URL list', () => {
    for (const entry of turnRegions({ shared: SHARED })) {
      expect(entry.urls.length).toBeGreaterThan(0)
    }
  })

  it('lets one region carry its own endpoints while the others fall back', () => {
    const regions = turnRegions({
      shared: SHARED,
      perRegion: { 'bootstrap-eu': 'turn:eu.example.invalid:3478?transport=udp' },
    })
    const eu = regions.find((entry) => entry.name === 'bootstrap-eu')
    const us = regions.find((entry) => entry.name === 'bootstrap-us')
    expect(eu?.urls).toEqual(['turn:eu.example.invalid:3478?transport=udp'])
    expect(us?.urls.length).toBe(2)
    // The fallback is what makes this correct under the anycast answer to a topology question
    // nobody here has measured.
    expect(us?.urls).not.toEqual(eu?.urls)
  })

  it('refuses a name outside the closed set, by value rather than by type', () => {
    expect(turnUrlsFor('bootstrap-atlantis', { shared: SHARED })).toBeNull()
    expect(turnUrlsFor('', { shared: SHARED })).toBeNull()
    expect(isDeclaredRegion('bootstrap-atlantis')).toBe(false)
    expect(isDeclaredRegion('bootstrap-eu')).toBe(true)
  })

  it('answers null when a declared region has no URLs at all, rather than an empty rung', () => {
    // Absent configuration must refuse by name upstream, not hand out a credential for nowhere.
    expect(turnUrlsFor('bootstrap-us', {})).toBeNull()
  })
})

describe('NET-12 — the mapping is DERIVED from the closed name set, not transcribed beside it', () => {
  it('covers every name the object module declares, whatever that set becomes', () => {
    // Not a literal ['bootstrap-us', …]. If a fourth region is added to HOSTED_OBJECT_NAME, this
    // stays green and the region gains a rung; if the mapping were pasted as a literal, it would
    // redden here — which is the whole point.
    expect(turnRegions({ shared: SHARED }).map((entry) => entry.name)).toEqual([
      ...HOSTED_OBJECT_NAMES,
    ])
  })

  it('reads the source and finds no hand-written region literal beside the derivation', () => {
    const source = readFileSync(fileURLToPath(new URL('./turn-regions.ts', import.meta.url)), 'utf8')
    // The derivation itself.
    expect(source).toContain('HOSTED_OBJECT_NAMES.map(')
    // A pasted literal object keyed by the three names would look like this.
    expect(
      /\{\s*'bootstrap-us'\s*:/.test(source),
      'a literal region map has been pasted over the derivation — a fourth region would then be ' +
        'added in one place and forgotten in the other',
    ).toBe(false)
  })
})

/**
 * Phase 33's criterion 2 discipline, applied at the point a location first becomes tempting.
 *
 * A region name is an **address**, not a location. Nothing in this module may claim where a
 * hosted object runs, because Phase 33 has not run and no document may claim a siting before it
 * does.
 */
describe('NET-12 — no file in this shard claims where anything runs', () => {
  const source = readFileSync(fileURLToPath(new URL('./turn-regions.ts', import.meta.url)), 'utf8')

  /**
   * Cities and countries a reader might reach for when naming these three regions.
   *
   * Checked over the WHOLE source including comments, and that is deliberate: a plant that put a
   * city in a comment stayed green against a literals-only reading, so this case reads the file
   * as text. Phase 33's own criterion 2 is a grep over published copy, and a grep does not skip
   * comments either.
   */
  const LOCATIONS = [
    'Ashburn',
    'Frankfurt',
    'London',
    'Amsterdam',
    'Virginia',
    'Oregon',
    'Iowa',
    'Ireland',
    'Germany',
    'Brazil',
    'Chile',
    'Sao Paulo',
    'São Paulo',
    'Santiago',
    'Paris',
    'Singapore',
    'Tokyo',
    'Sydney',
  ]

  for (const location of LOCATIONS) {
    it(`does not name ${location}`, () => {
      expect(
        source.toLowerCase().includes(location.toLowerCase()),
        `turn-regions.ts names ${location}. Phase 33's criterion 2 forbids any surface claiming ` +
          `where a hosted object runs, and Phase 33 has not run — so no such claim can be true yet.`,
      ).toBe(false)
    })
  }
})
