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
 *
 * Everything here is pure, so this spec runs in the node lane **and** the browser lane. The two
 * claims that need to read this package's source as text — that the mapping is derived rather
 * than pasted, and that no location is named anywhere — live in
 * `turn-regions-source.node.test.ts`, because `readFileSync` does not exist in the browser lane
 * and a filesystem guard placed here reddens for a reason that has nothing to do with what it
 * tests.
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

  it('answers an EMPTY LIST for a declared region with no URLs — not null, which means undeclared', () => {
    // CORRECTED 2026-09-09. This case asserted `toBeNull()` and the assertion was wrong in a way
    // that only a second credential scheme could reveal: a deployment holding Cloudflare's API
    // key pair declares no URLs of its own, so every mint came back `unknown-region` — telling a
    // correctly configured tab that `bootstrap-us` is not a region. The refusal was right; the
    // NAME was wrong, and a deployment mistake wore a client-error name.
    //
    // The two answers are now distinct, and the distinction is the whole point: `null` is *not a
    // declared name*, `[]` is *declared, and this deployment names none*. Whether `[]` is fatal
    // belongs to the minter — `turn-credential.test.ts` holds both halves of that.
    expect(turnUrlsFor('bootstrap-us', {})).toEqual([])
    expect(turnUrlsFor('bootstrap-us', {})).not.toBeNull()
    // And the contrast, in the same case, so neither can drift alone.
    expect(turnUrlsFor('bootstrap-atlantis', {})).toBeNull()
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
})
