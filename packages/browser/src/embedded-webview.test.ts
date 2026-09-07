import { describe, expect, it } from 'vitest'
import { DIGIT } from './demo-regions.ts'
import {
  CANDIDATE_SIGNALS,
  detectEmbeddedWebView,
  readEmbeddedWebViewProbe,
} from './embedded-webview.ts'
import type { EmbeddedWebViewProbe } from './embedded-webview.ts'

/**
 * The detector's arithmetic, exhausted with no page — and then read once off the real engine.
 *
 * This file runs in the `node` project **and** in all three engines of the `browser` project,
 * because `vitest.config.ts` includes bare `*.test.ts` in each. That is the point rather than
 * a side effect: the module's claim is that its core takes an injected probe instead of
 * reading globals, and a spec that only ran where `window` exists could not tell a parameter
 * from a global.
 *
 * What it does not cover, and what does: every case below drives a literal, so nothing here
 * says a real host application injects a real object. `packages/node/src/embedded-webview.
 * e2e.test.ts` drives a real page in a real browser with a real host injection made through
 * `addInitScript`, and Plan 38-04 is where the table itself meets a real Telegram client.
 */

/** Headless Chromium's own string, read off `about:blank` on 2026-09-06. */
const STOCK_DESKTOP =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'HeadlessChrome/151.0.7922.34 Safari/537.36'

/** Telegram-shaped and Android-shaped. See the e2e spec for why not iOS-shaped. */
const TELEGRAM_SHAPED_AGENT =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/124.0.0.0 Mobile Safari/537.36 Telegram-Android/10.14.5'

const IOS_SHAPED_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Mobile/15E148'

function probe(over: Partial<EmbeddedWebViewProbe> = {}): EmbeddedWebViewProbe {
  return {
    bridgeObjects: [],
    // The desktop truth, measured: absent in stock Chromium and stock Firefox. The default
    // here is therefore the ordinary case rather than the interesting one.
    standaloneAbsent: true,
    userAgent: STOCK_DESKTOP,
    ...over,
  }
}

describe('the declared table', () => {
  it('holds five rows, so a table that silently emptied cannot pass every other case here', () => {
    // A floor with teeth: `detectEmbeddedWebView` filters the table, so an empty table makes
    // "a stock desktop probe is not embedded" pass perfectly while checking nothing.
    expect(CANDIDATE_SIGNALS.length).toBe(5)
  })

  it('puts no digit in any name, because every name is written into the notice verbatim', () => {
    // `DIGIT` rather than a second regular expression: `#entry-notice` stays digit-free so it
    // stays outside the region catalogue's jurisdiction, and two definitions of "digit on
    // screen" are two properties that can come to disagree.
    const offending = CANDIDATE_SIGNALS.filter((signal) => DIGIT.test(signal.name)).map(
      (signal) => signal.name,
    )
    expect(offending).toEqual([])
  })

  it('states candidate confidence on every row, because none of it was read off a real client', () => {
    const measured = CANDIDATE_SIGNALS.filter((signal) => signal.confidence !== 'candidate').map(
      (signal) => signal.name,
    )
    expect(
      measured,
      'a row claims measured confidence — Plan 38-04 is the only thing that can grant that, ' +
        'and it has to name the device the reading came from',
    ).toEqual([])
  })

  it('gives every row a reason, so nothing in it is a bare string somebody added', () => {
    expect(CANDIDATE_SIGNALS.filter((signal) => signal.why.trim() === '')).toEqual([])
  })
})

describe('a host object with nothing else — the direction a string check cannot pass', () => {
  it('raises the notice and records the evidence as engine evidence', () => {
    const verdict = detectEmbeddedWebView(
      probe({ bridgeObjects: ['TelegramWebviewProxy'], userAgent: STOCK_DESKTOP }),
    )

    expect(verdict.embedded).toBe(true)
    expect(verdict.engineCorroborated).toBe(true)
    expect(verdict.fired.map((signal) => signal.name)).toEqual(['TelegramWebviewProxy'])
    // Named rather than counted: the user-agent row must NOT be among them, or this case
    // would be passing on the string it was built to do without.
    expect(verdict.fired.every((signal) => signal.klass !== 'user-agent')).toBe(true)
  })

  it('corroborates from a WKWebView message handler too', () => {
    const verdict = detectEmbeddedWebView(probe({ bridgeObjects: ['webkit message handler'] }))
    expect(verdict.embedded).toBe(true)
    expect(verdict.engineCorroborated).toBe(true)
  })
})

describe('a string with nothing else — recorded as a string', () => {
  it('raises the notice and refuses to call it engine evidence', () => {
    const verdict = detectEmbeddedWebView(probe({ userAgent: TELEGRAM_SHAPED_AGENT }))

    // The offer still stands: being wrong about somebody costs them a dismiss button.
    expect(verdict.embedded).toBe(true)
    // The grounds do not. This is the whole of criterion 1's refusal, in one field.
    expect(verdict.engineCorroborated).toBe(false)
    expect(verdict.fired.map((signal) => signal.name)).toEqual(['user-agent names Telegram'])
  })

  it('stops being a string the moment a host object arrives beside it', () => {
    const verdict = detectEmbeddedWebView(
      probe({ bridgeObjects: ['TelegramWebviewProxy'], userAgent: TELEGRAM_SHAPED_AGENT }),
    )
    expect(verdict.fired.length).toBe(2)
    expect(verdict.engineCorroborated).toBe(true)
  })
})

describe('an ordinary desktop browser', () => {
  it('is not embedded, even though navigator.standalone is absent on it', () => {
    // The measurement this case exists for: `standalone` is undefined in stock Chromium and
    // stock Firefox, so an ungated absence row would report every desktop visitor as being
    // inside a host application and would un-hide the notice on every page load.
    const verdict = detectEmbeddedWebView(probe({ standaloneAbsent: true }))
    expect(verdict.embedded).toBe(false)
    expect(verdict.fired).toEqual([])
    expect(verdict.engineCorroborated).toBe(false)
  })

  it('is not embedded when it does declare navigator.standalone either', () => {
    // Desktop Safari, measured: `typeof navigator.standalone === 'boolean'`.
    const verdict = detectEmbeddedWebView(probe({ standaloneAbsent: false }))
    expect(verdict.embedded).toBe(false)
  })
})

describe('the navigator.standalone row, in the one population where its absence means anything', () => {
  it('fires on an iOS-shaped user-agent with the property missing', () => {
    const verdict = detectEmbeddedWebView(
      probe({ standaloneAbsent: true, userAgent: IOS_SHAPED_AGENT }),
    )
    expect(verdict.fired.map((signal) => signal.name)).toEqual(['navigator.standalone absent'])
    // A shape of the host, so it corroborates — with the caveat the module docblock states
    // about a spoofed iPhone string, which is why the RUN-06 case does not rest on this row.
    expect(verdict.engineCorroborated).toBe(true)
  })

  it('stays silent on an iOS-shaped user-agent that does declare the property', () => {
    // Mobile Safari itself. The row is about the property being taken away, not about iOS.
    const verdict = detectEmbeddedWebView(
      probe({ standaloneAbsent: false, userAgent: IOS_SHAPED_AGENT }),
    )
    expect(verdict.embedded).toBe(false)
  })
})

describe('reading a scope', () => {
  it('names every bridge it finds with a name the table can fire on', () => {
    const found = readEmbeddedWebViewProbe({
      TelegramWebviewProxy: { postEvent: () => {} },
      TelegramWebviewProxyProto: { postEvent: () => {} },
      webkit: { messageHandlers: { performAction: { postMessage: () => {} } } },
      navigator: { userAgent: STOCK_DESKTOP, standalone: false },
    })

    const declared = CANDIDATE_SIGNALS.filter((signal) => signal.klass === 'host-object').map(
      (signal) => signal.name,
    )
    // Both directions. A probe that emitted a name no row carries would report a signal
    // nothing can fire on, and the notice would stay hidden with the evidence in hand.
    expect([...found.bridgeObjects].sort()).toEqual([...declared].sort())
    expect(detectEmbeddedWebView(found).fired.length).toBe(3)
  })

  it('speaks to nothing it finds — T-38-03', () => {
    // A bridge is detected by being there. A detector that called `postEvent` to confirm it
    // would be telling the host application a page had noticed it, which is the one thing
    // reading a global was chosen to avoid.
    let calls = 0
    const scope = {
      TelegramWebviewProxy: {
        postEvent: (): void => {
          calls += 1
        },
      },
      navigator: { userAgent: STOCK_DESKTOP },
    }
    const found = readEmbeddedWebViewProbe(scope)
    detectEmbeddedWebView(found)

    expect(found.bridgeObjects).toEqual(['TelegramWebviewProxy'])
    expect(calls, 'the detector called a method on the host object it found').toBe(0)
  })

  it('survives a scope that is not a window at all', () => {
    for (const scope of [undefined, null, 0, 'window', { navigator: null }]) {
      const found = readEmbeddedWebViewProbe(scope)
      expect(found.bridgeObjects).toEqual([])
      expect(found.userAgent).toBe('')
      // Absent, and firing nothing — absence is only read beside the string that gives it
      // meaning, and there is no string here.
      expect(detectEmbeddedWebView(found).embedded).toBe(false)
    }
  })

  it('reads THIS engine, whatever it is, as not being inside a host application', () => {
    // The one case that touches a real global, and the only one that can catch the module
    // misfiring on an ordinary browser. It runs four times over: once under the `node`
    // project where `globalThis` has no `navigator`, and once in each of chromium, firefox
    // and webkit. None of them is a host application's embedded browser, and a green here
    // is what says the notice stays hidden for an ordinary visitor.
    const verdict = detectEmbeddedWebView(readEmbeddedWebViewProbe(globalThis))
    expect(
      verdict.fired.map((signal) => signal.name),
      'this engine fired an embedded-browser signal — either it really is one, or a row ' +
        'reads a property that ordinary browsers also lack',
    ).toEqual([])
    expect(verdict.embedded).toBe(false)
  })
})
