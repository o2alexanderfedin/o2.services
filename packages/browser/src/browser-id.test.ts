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

describe('resolving the current browser is lazy', () => {
  it('does not throw where there is no navigator', () => {
    // Node is not a visitor. Module-scope environment detection is what breaks the
    // `default` export condition for a host application, so this must be a call.
    expect(() => currentBrowserLabel()).not.toThrow()
    expect(typeof currentBrowserLabel()).toBe('string')
  })
})
