import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * NET-12 — the two claims about `turn-regions.ts` that are read off its source text.
 *
 * Split out of `turn-regions.test.ts` and named `*.node.test.ts` deliberately: that spec runs in
 * the browser lane too, across three engines, and `readFileSync` does not exist there. Keeping
 * these cases beside the pure ones cost three red files in the browser lane for a reason that had
 * nothing to do with regions — which is precisely why the rule exists.
 *
 * Reading source as text is the `slow-specs.node.test.ts` idiom. Both claims below are about the
 * *shape of the file*, which no amount of calling its functions can observe.
 */

const SOURCE = readFileSync(
  fileURLToPath(new URL('./turn-regions.ts', import.meta.url)),
  'utf8',
)

describe('NET-12 — the region mapping is derived in source, not transcribed beside the name set', () => {
  it('walks the closed name set rather than listing the names', () => {
    expect(SOURCE).toContain('HOSTED_OBJECT_NAMES.map(')
  })

  it('reddens if a literal region map is pasted over the derivation', () => {
    expect(
      /\{\s*'bootstrap-us'\s*:/.test(SOURCE),
      'a literal region map has been pasted over the derivation — a fourth region would then be ' +
        'added in one place and forgotten in the other, which is the whole reason the mapping ' +
        'is derived',
    ).toBe(false)
  })
})

/**
 * Phase 33's criterion 2 discipline, applied at the point a location first becomes tempting.
 *
 * A region name is an **address**, not a location. Nothing in this module may claim where a
 * hosted object runs, because Phase 33 has not run and no document may claim a siting before it
 * does.
 *
 * **The whole file is read, comments included, and that is not incidental.** A plant that put a
 * city into a comment was watched reddening here; against a literals-only reading it would have
 * stayed green. Phase 33's own criterion 2 is a grep over published copy, and a grep does not
 * skip comments either.
 */
describe('NET-12 — no file in this shard claims where anything runs', () => {
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
    'S\u00e3o Paulo',
    'Santiago',
    'Paris',
    'Singapore',
    'Tokyo',
    'Sydney',
  ]

  for (const location of LOCATIONS) {
    it(`does not name ${location}`, () => {
      expect(
        SOURCE.toLowerCase().includes(location.toLowerCase()),
        `turn-regions.ts names ${location}. Phase 33's criterion 2 forbids any surface claiming ` +
          `where a hosted object runs, and Phase 33 has not run — so no such claim can be true yet.`,
      ).toBe(false)
    })
  }
})
