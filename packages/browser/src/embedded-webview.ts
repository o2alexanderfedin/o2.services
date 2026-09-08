/**
 * Whether this page is running inside somebody else's browser — RUN-06's agent half.
 *
 * ## The distinction the whole module is built around
 *
 * Phase 38's criterion 1 refuses a green obtained from a spoofed user-agent string: *the
 * point of the check is the engine, not the string*. So this module does not answer one
 * question but two, and keeps them apart in the verdict it returns:
 *
 * - {@link EmbeddedWebViewVerdict.embedded} — should the visitor be offered the notice?
 * - {@link EmbeddedWebViewVerdict.engineCorroborated} — was any of the evidence something
 *   other than a string the page was handed?
 *
 * Collapsing those two into one boolean is what makes a detector unfalsifiable. A host
 * application that injects a bridge object into the global scope has *done something to this
 * page* that the page can observe; a user-agent naming Telegram is a claim by whoever set
 * the header. Both are worth acting on — the notice is an offer with a dismiss button beside
 * it, and being wrong costs a visitor one click — but only the first is evidence.
 *
 * ## Why the probe is a parameter and not a global read
 *
 * `readEmbeddedWebViewProbe(scope)` takes the scope rather than closing over `window`, on
 * `computing-indicator.ts`'s precedent and for its stated reason: a plain `*.test.ts` under
 * `packages/<name>/src/` is collected by **both** the `node` project and the `browser` project,
 * and a module that reads browser globals at import time cannot be imported by a Node test
 * at all. It also means every firing condition below can be driven from a literal, which is
 * the only way the arithmetic of "engine evidence versus a string" is exhaustible.
 *
 * It reads in-page globals and **issues no request** — T-38-03. Nothing here fetches, and
 * nothing here calls a method on a host object it found. A bridge is detected by being
 * there, never by being spoken to.
 *
 * ## The `navigator.standalone` row is gated on an iOS-shaped user-agent, and that was measured
 *
 * The obvious reading of that row — *fire when `navigator.standalone` is undefined* — makes
 * this module answer `embedded: true` on an ordinary desktop browser. Measured 2026-09-06
 * against `about:blank` in the three engines this repository tests in, with no page code
 * involved:
 *
 * | engine | `navigator.userAgent` names | `typeof navigator.standalone` |
 * |---|---|---|
 * | chromium `151.0` | `Macintosh` | `undefined` |
 * | firefox `153.0` | `Macintosh` | `undefined` |
 * | webkit `26.5` (desktop Safari) | `Macintosh` | **`boolean`** |
 *
 * So the property's absence is the *ordinary* state on two of the three, and carries
 * information only in the population where it is otherwise present: Mobile Safari on iOS
 * sets it, and a page rendered by a `WKWebView` inside another application is reported not
 * to. The row therefore fires on *absent* **and** an iOS-shaped user-agent, and the
 * user-agent's role there is to select the population rather than to be the evidence — which
 * is why the row keeps its `host-shape` class.
 *
 * **The residue of that gate, stated rather than discovered later.** A desktop browser
 * sending a spoofed iPhone string has `navigator.standalone` genuinely absent, fires this
 * row, and is reported `engineCorroborated: true` on what is really a string. That is a
 * false positive whose worst outcome is a dismissible notice on a page that works anyway —
 * T-38-01's accepted disposition — and it is the one place in this module where the
 * engine/string separation is weaker than it looks. Criterion 1's own claim does not rest on
 * it: `packages/node/src/embedded-webview.e2e.test.ts`'s RUN-06 case fires a `host-object`
 * row with a stock desktop string and no mobile shape at all.
 *
 * ## Where this table came from, and what is allowed to change it
 *
 * **Every row of {@link CANDIDATE_SIGNALS} states candidate confidence, and not one of them
 * has been read off a real Telegram client.** The phase's own Research note records that
 * Telegram's current WebView behaviour *"was not found in any authoritative current source"*
 * — which is why the field exists at all rather than every row being implicitly true. What
 * is written here is a set of things worth looking for, in the shapes that embedding
 * applications are generally reported to leave behind.
 *
 * **The table is revised from Plan 38-04's device readings, and from nothing else.** Not from
 * further reading, not from a better-sourced article, not from another repository's
 * detector: the owner opens the real recruitment link from a real Telegram message on an iOS
 * device and an Android one, and what those two devices actually expose is what a row is
 * allowed to be promoted on. A row raised to measured confidence has to name the device the
 * reading came from, and a row that fires on neither device should be deleted rather than
 * kept as a guess that has now been checked and failed.
 *
 * This paragraph is a statement of **provenance**, not a claim of correctness — a comment is
 * not a specification. What is asserted lives in `embedded-webview.test.ts` and
 * `packages/node/src/embedded-webview.e2e.test.ts`, and what they assert is that the
 * *mechanism* separates engine evidence from a string. Whether these are the right five
 * signals is a question no spec in this repository can answer.
 *
 * ## Not in the barrel
 *
 * `packages/browser/src/index.ts` does not export this, on `computing-indicator.ts`'s and
 * `gateway-module.ts`'s precedent: `demo/main.ts` imports it by relative path, and a barrel
 * entry would put an exported-but-statically-unreachable symbol in front of
 * `reachability-guard.node.test.ts` for the benefit of no consumer.
 */

/**
 * What kind of thing a signal read.
 *
 * `host-object` — an object the embedding application put into this page's global scope.
 * `host-shape`  — a property of the engine or its host, present or absent by construction.
 * `user-agent`  — a string, and recorded as one.
 */
export type SignalClass = 'host-object' | 'host-shape' | 'user-agent'

/** One row of the declared table. Every row states its own confidence. */
export interface CandidateSignal {
  /**
   * Rendered on screen, and therefore **carrying no digit**.
   *
   * `#entry-notice` sits outside `#main` and declares no `data-region`, which is what keeps
   * it outside the region catalogue's jurisdiction — see `<catalogue_decision>` in
   * `38-01-PLAN.md`. Digit-freedom is the third of those three properties and it is the one
   * a signal name could break, because these names are written into the notice verbatim.
   */
  readonly name: string
  readonly klass: SignalClass
  readonly confidence: 'measured' | 'candidate'
  readonly why: string
}

/** Everything read out of the page, and nothing else. No request is made to build one. */
export interface EmbeddedWebViewProbe {
  /** Names of injected host objects found — each one a declared `host-object` row's name. */
  readonly bridgeObjects: readonly string[]
  /** `navigator.standalone` is undefined. Read the module docblock before trusting this. */
  readonly standaloneAbsent: boolean
  readonly userAgent: string
}

export interface EmbeddedWebViewVerdict {
  readonly embedded: boolean
  readonly fired: readonly CandidateSignal[]
  /** True iff some fired signal is NOT `user-agent` — the field criterion 1 is about. */
  readonly engineCorroborated: boolean
}

/**
 * The signals, declared as data.
 *
 * Every row is `candidate` rather than `measured`, and the reason is in the module docblock's
 * closing section: nothing here has been read off a real Telegram client.
 */
export const CANDIDATE_SIGNALS: readonly CandidateSignal[] = [
  {
    name: 'TelegramWebviewProxy',
    klass: 'host-object',
    confidence: 'candidate',
    why: "the bridge object Telegram's Android client is reported to inject",
  },
  {
    name: 'TelegramWebviewProxyProto',
    klass: 'host-object',
    confidence: 'candidate',
    why: 'the same role, reported for the iOS client',
  },
  {
    name: 'webkit message handler',
    klass: 'host-object',
    confidence: 'candidate',
    why: 'webkit.messageHandlers.performAction — a WKWebView host bridge',
  },
  {
    name: 'navigator.standalone absent',
    klass: 'host-shape',
    confidence: 'candidate',
    why: 'present in Mobile Safari, reported absent in a WKWebView; a shape of the host, not a string',
  },
  {
    name: 'user-agent names Telegram',
    klass: 'user-agent',
    confidence: 'candidate',
    why: 'a string, and recorded as one',
  },
]

/**
 * Where each `host-object` row lives in the global scope.
 *
 * Kept beside the table rather than inside it because a row is a thing shown to a visitor and
 * a path is a thing read from a page — and because the third row's name is prose
 * (`webkit message handler`) while its path is three segments deep. The unit spec asserts
 * every name here is a declared `host-object` row, so the two cannot drift into a probe that
 * reports a signal no table row can fire.
 */
const BRIDGE_PATHS: readonly { readonly name: string; readonly path: readonly string[] }[] = [
  { name: 'TelegramWebviewProxy', path: ['TelegramWebviewProxy'] },
  { name: 'TelegramWebviewProxyProto', path: ['TelegramWebviewProxyProto'] },
  { name: 'webkit message handler', path: ['webkit', 'messageHandlers', 'performAction'] },
]

/** The population in which an absent `navigator.standalone` means anything. */
const APPLE_MOBILE = /iPhone|iPad|iPod/i

/** The string row's whole condition. */
const NAMES_TELEGRAM = /telegram/i

/** One step along a path, without assuming the scope is shaped like anything. */
function step(value: unknown, key: string): unknown {
  if (value === null) return undefined
  if (typeof value !== 'object' && typeof value !== 'function') return undefined
  return (value as Record<string, unknown>)[key]
}

/** A host bridge is an object or a function that is there. Never called, only seen. */
function isPresent(value: unknown): boolean {
  if (value === null || value === undefined) return false
  return typeof value === 'object' || typeof value === 'function'
}

/**
 * Read the page. **Makes no request and calls nothing it finds.**
 *
 * `scope` is `window` in the page and a literal in a spec. A scope missing `navigator`
 * entirely reports `standaloneAbsent: true` and an empty user-agent, which fires nothing —
 * absence is only ever read together with the iOS-shaped string that gives it meaning.
 */
export function readEmbeddedWebViewProbe(scope: unknown): EmbeddedWebViewProbe {
  const bridgeObjects: string[] = []
  for (const bridge of BRIDGE_PATHS) {
    let value: unknown = scope
    for (const key of bridge.path) value = step(value, key)
    if (isPresent(value)) bridgeObjects.push(bridge.name)
  }

  const navigator = step(scope, 'navigator')
  const userAgent = step(navigator, 'userAgent')

  return {
    bridgeObjects,
    standaloneAbsent: step(navigator, 'standalone') === undefined,
    userAgent: typeof userAgent === 'string' ? userAgent : '',
  }
}

/** Whether one row fires on one probe. The only place a firing condition is written. */
function fires(signal: CandidateSignal, probe: EmbeddedWebViewProbe): boolean {
  if (signal.klass === 'host-object') return probe.bridgeObjects.includes(signal.name)
  if (signal.klass === 'user-agent') return NAMES_TELEGRAM.test(probe.userAgent)
  return probe.standaloneAbsent && APPLE_MOBILE.test(probe.userAgent)
}

/**
 * The verdict — both halves of it.
 *
 * `embedded` is *any* row firing, because the notice is an offer and the cost of offering it
 * to somebody who did not need it is one click. `engineCorroborated` is *some fired row is
 * not a string*, and it is deliberately not the same question: a page that collapsed the two
 * would report a spoofed header as engine evidence, which is the green criterion 1 refuses.
 */
export function detectEmbeddedWebView(probe: EmbeddedWebViewProbe): EmbeddedWebViewVerdict {
  const fired = CANDIDATE_SIGNALS.filter((signal) => fires(signal, probe))
  return {
    embedded: fired.length > 0,
    fired,
    engineCorroborated: fired.some((signal) => signal.klass !== 'user-agent'),
  }
}

declare global {
  interface Window {
    /**
     * The verdict this visit reached, for a harness to read — T-38-04, accepted.
     *
     * A read-only diagnostic handle on `ATTESTATION_HOOK`'s precedent. The e2e spec needs
     * `engineCorroborated` and the page has no reason to render it: the visitor is asked
     * whether to open the page elsewhere, not shown the grounds in a boolean. Overwriting it
     * changes what a test reads and nothing a visitor gets.
     */
    __o2EntryVerdict?: EmbeddedWebViewVerdict
  }
}
