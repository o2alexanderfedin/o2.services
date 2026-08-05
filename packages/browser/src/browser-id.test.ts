import { MAX_BROWSER_MAJOR, isStartBrowserLabel } from '@o2/core'
import { describe, expect, it } from 'vitest'
import { BROWSER_FAMILIES, browserLabel, currentBrowserLabel, identifyBrowser } from './browser-id.ts'

/**
 * BROW-02 — the segmentation axis.
 *
 * The vectors below are real user-agent strings, hardcoded rather than generated.
 * A computed expectation would only prove the classifier agrees with itself, and
 * the failure mode here is not a crash — it is silently filing a whole population
 * under the wrong row, where it would look like ordinary data.
 */

const VECTORS: readonly { readonly ua: string; readonly family: string; readonly major: number | null }[] = [
  {
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
    family: 'chromium',
    major: 141,
  },
  {
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.3485.66',
    family: 'edge',
    major: 140,
  },
  {
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:134.0) Gecko/20100101 Firefox/134.0',
    family: 'firefox',
    major: 134,
  },
  {
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Safari/605.1.15',
    family: 'safari',
    major: 18,
  },
  {
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.3 Mobile/15E148 Safari/604.1',
    family: 'safari',
    major: 18,
  },
  {
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.7390.54 Mobile/15E148 Safari/604.1',
    family: 'chromium',
    major: 141,
  },
  {
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/136.0 Mobile/15E148 Safari/605.1.15',
    family: 'firefox',
    major: 136,
  },
  {
    ua: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Brave/140',
    family: 'chromium',
    major: 140,
  },
  { ua: 'curl/8.7.1', family: 'other', major: null },
  { ua: '', family: 'other', major: null },
]

describe('detection order is the whole difficulty', () => {
  it.each(VECTORS)('classifies $family from a real user-agent string', ({ ua, family, major }) => {
    const id = identifyBrowser(ua)
    expect(id.family).toBe(family)
    expect(id.major).toBe(major)
  })

  it('does not file Edge under chromium, though its string says Chrome', () => {
    // Stated separately because this is the mistake that would not look like one:
    // Edge's user-agent contains `Chrome/`, and its extension store is a different
    // blocklist from Chrome's.
    const edge =
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.3485.66'
    expect(identifyBrowser(edge).family).toBe('edge')
  })

  it('does not file Chrome under safari, though every Chrome string ends in Safari', () => {
    const chrome =
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
    expect(identifyBrowser(chrome).family).toBe('chromium')
  })
})

describe('the label is coarse enough to publish', () => {
  it('carries a family and a major version, and nothing else', () => {
    expect(browserLabel({ family: 'chromium', major: 141 })).toBe('chromium 141')
    // No platform, no minor version, no build. Five families and an integer cannot
    // tell two visitors apart, which is what makes this safe to send.
    expect(browserLabel({ family: 'safari', major: 18 })).not.toContain('.')
  })

  it('drops to the family alone when no version can be read', () => {
    expect(browserLabel({ family: 'other', major: null })).toBe('other')
  })

  it('only ever produces a family from the fixed set', () => {
    for (const { ua } of VECTORS) {
      expect(BROWSER_FAMILIES).toContain(identifyBrowser(ua).family)
    }
  })
})

/**
 * **A composer that can emit what its own wire refuses is the defect.**
 *
 * `browserLabel` composes the one field that travels, and `isStartBrowserLabel` is the
 * predicate every label crossing the wire passes through — including this node's own, at
 * `ownStartOutcome`. They were two independent statements about the same range: the
 * composer bounded the major not at all, the predicate admitted four digits. A visitor on
 * a five-digit major therefore started, and reported *nothing at all* — its own ledger
 * empty and its request's outcome dropped by every peer — which is precisely the silence
 * BROW-02 exists to make visible, manufactured by the reporter.
 *
 * The pair below is the whole claim and neither half stands alone:
 *
 * - every label the composer can produce is one the wire admits, and
 * - a full user-agent string is still refused.
 *
 * The second is not decoration. The cheap way to satisfy the first is to widen the
 * pattern, and widening it far enough would readmit the user-agent string this range was
 * introduced to keep out — the disclosure promise rests on the label being too blunt to
 * name a visitor.
 */
describe('a label this build composes is a label this build can file', () => {
  /** Real Chrome, with only the major moved past the range the wire admits. */
  const FIVE_DIGIT_CHROME =
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/12345.0.0.0 Safari/537.36'

  it('files a visitor whose major version is past the range the wire admits', () => {
    // The production path, end to end: classify a user-agent string, compose the label,
    // hand it to the predicate `ownStartOutcome` hands it to.
    const label = browserLabel(identifyBrowser(FIVE_DIGIT_CHROME))
    expect(isStartBrowserLabel(label)).toBe(true)
    // And it is the family, not a clamped version: a version this build cannot publish is
    // a version it has none to report, and inventing `chromium 9999` would file a real
    // visitor under a number no browser ever had.
    expect(label).toBe('chromium')
  })

  /**
   * Majors a caller can hand the exported composer, adversarial and otherwise.
   *
   * `browserLabel` is public API (`packages/browser/src/index.ts`) over `number | null`,
   * and `number` is not `non-negative integer below the ceiling`. Every one of these is a
   * value the type permits, so every one of them is a label the composer must not emit.
   */
  const MAJORS: readonly (number | null)[] = [
    null,
    0,
    1,
    141,
    9_999,
    10_000,
    12_345,
    1e20, // still an integer: expands to twenty-one plain digits
    1e21, // template literal switches to `1e+21` — not digits at all
    Number.MAX_SAFE_INTEGER,
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ]

  it.each(BROWSER_FAMILIES)('composes only fileable labels for %s', (family) => {
    for (const major of MAJORS) {
      const label = browserLabel({ family, major })
      // The major is in the message because a bare `false` here names neither the input
      // nor the label, and this case has fifteen inputs per family.
      expect({ major, label, fileable: isStartBrowserLabel(label) }).toEqual({
        major,
        label,
        fileable: true,
      })
    }
  })

  it('bounds itself at the wire`s own edge, measured rather than declared', () => {
    // `MAX_BROWSER_MAJOR` is the composer's ceiling; this reddens if it stops being the
    // predicate's. The two are derived from one width today, and this is what would notice
    // if somebody split them again — which is the shape the defect had.
    expect(isStartBrowserLabel(`chromium ${MAX_BROWSER_MAJOR}`)).toBe(true)
    expect(isStartBrowserLabel(`chromium ${MAX_BROWSER_MAJOR + 1}`)).toBe(false)

    // And the composer sits exactly on it — not one short, which would silently coarsen a
    // whole version's worth of visitors, and not one over.
    expect(browserLabel({ family: 'chromium', major: MAX_BROWSER_MAJOR })).toBe(
      `chromium ${MAX_BROWSER_MAJOR}`,
    )
    expect(browserLabel({ family: 'chromium', major: MAX_BROWSER_MAJOR + 1 })).toBe('chromium')
  })

  it('keeps a version the wire admits rather than dropping every version', () => {
    // Without this the case above is satisfied by returning the family always, which would
    // delete the segmentation the metric is built on.
    expect(browserLabel({ family: 'chromium', major: 141 })).toBe('chromium 141')
    expect(browserLabel({ family: 'firefox', major: 0 })).toBe('firefox 0')
  })

  it('still refuses a full user-agent string', () => {
    // The regression this fix must not become. Plan 20-02 introduced the range by planting
    // `isStartBrowserLabel` → `typeof value === 'string'` and watching a user-agent string
    // arrive in a report. Every string this file already treats as an input is checked,
    // because a label and the string it was derived from must never be confused.
    for (const { ua } of VECTORS) {
      expect({ ua, fileable: isStartBrowserLabel(ua) }).toEqual({ ua, fileable: false })
    }
    expect(isStartBrowserLabel(FIVE_DIGIT_CHROME)).toBe(false)
  })

  it('composes nothing that could name a visitor, and no notation but digits', () => {
    // A label carries a family and at most an integer. A dot, a slash or a parenthesis in
    // one means a user-agent fragment survived composition.
    //
    // The last vector is what makes this case able to fail at all, and it was added after
    // watching it stay green through a plant that removed the bound entirely: every other
    // user-agent here yields a plain run of digits, so `chromium 12345` satisfies the
    // pattern as readily as `chromium 141`. A twenty-two-digit major does not — it parses
    // to `1e21`, which a template literal renders `1e+21`. Deliberately looser than the
    // wire's `\d{1,4}`, so this is a statement about *notation* rather than a second copy
    // of the range assertion three cases up.
    const EXPONENTIAL = 'Mozilla/5.0 (X11) Chrome/1000000000000000000000.0 Safari/537.36'
    expect(identifyBrowser(EXPONENTIAL).major).toBe(1e21)
    for (const { ua } of VECTORS.concat([
      { ua: FIVE_DIGIT_CHROME, family: 'chromium', major: 12_345 },
      { ua: EXPONENTIAL, family: 'chromium', major: 1e21 },
    ])) {
      expect({ ua, label: browserLabel(identifyBrowser(ua)) }).toEqual({
        ua,
        label: expect.stringMatching(/^[a-z]+(?: \d+)?$/),
      })
    }
  })
})

describe('resolving the current browser is lazy', () => {
  it('does not throw where there is no navigator', () => {
    // Node is not a visitor. Module-scope environment detection is what breaks the
    // `default` export condition for a host application, so this must be a call.
    expect(() => currentBrowserLabel()).not.toThrow()
    expect(typeof currentBrowserLabel()).toBe('string')
  })
})
