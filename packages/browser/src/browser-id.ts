/**
 * Which browser this is, coarsely — BROW-02.
 *
 * A start-outcome report is segmented by browser because that is the axis a
 * blocklist moves along: an extension store ban, a WASM policy, or a storage
 * partition lands on one engine at a time, and an unsegmented failure rate averages
 * it away into nothing.
 *
 * ## Coarse on purpose
 *
 * Family and major version, from a fixed set. Not the user-agent string, not the
 * platform, not the minor version, not `hardwareConcurrency`. The disclosure
 * promises "no identifiers beyond a peer key generated in this tab", and a metric
 * that needs to see a cliff does not need to see a person. Five families and a
 * major version cannot distinguish visitors from one another, which is the property
 * that makes this safe to publish.
 *
 * Detection order is load-bearing and is the only subtle thing here: Edge's
 * user-agent contains `Chrome/`, Chrome's contains `Safari/`, and every
 * iOS browser contains `Safari/` because iOS has one engine. Checking in the wrong
 * order silently mislabels whole populations — which would not fail anything, it
 * would just move a cliff onto the wrong row.
 */

/**
 * The families reported. `other` is not a failure — it is an honest label, and a
 * report where `other` grows is itself the finding that this list needs extending.
 */
export const BROWSER_FAMILIES = ['chromium', 'edge', 'firefox', 'safari', 'other'] as const

export type BrowserFamily = (typeof BROWSER_FAMILIES)[number]

export interface BrowserId {
  readonly family: BrowserFamily
  /** Major version only, or `null` when it cannot be read. */
  readonly major: number | null
}

const major = (userAgent: string, token: string): number | null => {
  const match = new RegExp(`${token}/(\\d+)`).exec(userAgent)
  if (match === null) return null
  const parsed = Number.parseInt(match[1] ?? '', 10)
  return Number.isInteger(parsed) ? parsed : null
}

/**
 * Classify a user-agent string.
 *
 * Pure, so the whole table of real-world strings is checkable without a browser.
 */
export function identifyBrowser(userAgent: string): BrowserId {
  // Edge before Chrome: `Edg/` strings also contain `Chrome/`.
  if (userAgent.includes('Edg/')) return { family: 'edge', major: major(userAgent, 'Edg') }
  // Firefox before Chrome, and `FxiOS` because iOS Firefox is Safari underneath but
  // is the product a visitor chose and the product a blocklist would name.
  if (userAgent.includes('FxiOS/')) return { family: 'firefox', major: major(userAgent, 'FxiOS') }
  if (userAgent.includes('Firefox/')) return { family: 'firefox', major: major(userAgent, 'Firefox') }
  if (userAgent.includes('CriOS/')) return { family: 'chromium', major: major(userAgent, 'CriOS') }
  // Chrome before Safari: every Chrome string ends with `Safari/537.36`.
  if (userAgent.includes('Chrome/')) return { family: 'chromium', major: major(userAgent, 'Chrome') }
  if (userAgent.includes('Safari/')) return { family: 'safari', major: major(userAgent, 'Version') }
  return { family: 'other', major: null }
}

/** The label that travels in a report. One string, so it cannot be re-split wrongly. */
export function browserLabel(id: BrowserId): string {
  return id.major === null ? id.family : `${id.family} ${id.major}`
}

/**
 * This browser's label, resolved lazily.
 *
 * Lazy because module-scope environment detection breaks the `default` export
 * condition for a host application — the rule this project adopted in Phase 2 and
 * has not had cause to revisit. Returns `other` wherever there is no navigator,
 * which includes Node, which is correct: a Node process is not a visitor.
 */
export function currentBrowserLabel(): string {
  const agent = globalThis.navigator?.userAgent
  return browserLabel(identifyBrowser(typeof agent === 'string' ? agent : ''))
}
