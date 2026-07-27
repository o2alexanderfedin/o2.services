/**
 * What the visitor is told, before anything runs — BROW-01.
 *
 * The terms live here as data rather than as markup so that three things cannot
 * drift apart: what the page displays, what a stored consent claims to have
 * answered, and what the policy page tells a blocklist reviewer. All three read
 * this module.
 *
 * ## The version is the mechanism
 *
 * A stored consent records `DISCLOSURE_VERSION`. Changing what is disclosed means
 * bumping the version, which invalidates every stored consent and shows the gate
 * again. A consent that silently survives a change in what it permitted is not
 * consent — it is a record that somebody once clicked something.
 *
 * `CONSENT_VERSION_NOTE` exists so the bump is not merely a number: a reader can
 * see what changed and therefore why they are being asked again.
 *
 * Pure module — no DOM, no storage, no side effects at import.
 */

/**
 * Bump this whenever any string in `DISCLOSURE` changes.
 *
 * A test asserts that this constant appears in the rendered gate, so a silent
 * edit to the terms fails rather than quietly re-using an old agreement.
 */
export const DISCLOSURE_VERSION = '1'

/** Why the current version differs from the one before it. */
export const CONSENT_VERSION_NOTE = 'first published disclosure'

export interface DisclosureLine {
  /** Short label — the question a visitor is actually asking. */
  readonly question: string
  /** The answer, in plain language. No marketing, no hedging. */
  readonly answer: string
}

export interface Disclosure {
  readonly version: string
  readonly headline: string
  readonly lines: readonly DisclosureLine[]
  /** Label on the affirmative control. Never "OK", never "Got it". */
  readonly affirm: string
  /** Label on the control that declines. Always present, never hidden. */
  readonly decline: string
  /** The optional extra, unticked by default. */
  readonly reporting: DisclosureLine
}

/**
 * The disclosed terms.
 *
 * Written to be read by someone deciding, not by someone already convinced. The
 * ordering is deliberate: what runs, then what it costs them, then what leaves
 * the device, then how to stop — the last being the one a visitor most wants and
 * is most often buried.
 */
export const DISCLOSURE: Disclosure = {
  version: DISCLOSURE_VERSION,
  headline: 'This page can use your processor. It will not, unless you say so.',
  lines: [
    {
      question: 'What would run?',
      answer:
        'A search for a colouring of the numbers 1 to N in which no Pythagorean ' +
        'triple — three numbers with a² + b² = c² — is all one colour. The code is ' +
        'a small WebAssembly module; you can read its source in this repository.',
    },
    {
      question: 'Whose work is it?',
      answer:
        'A shared job. Whoever asked for it is named in the bar at the bottom of ' +
        'the page for as long as their work is running on your machine.',
    },
    {
      question: 'How much of my processor?',
      answer:
        'One background thread. It drops to a tenth of that when this tab is not ' +
        'in front, and the live figure is shown in the bar at all times.',
    },
    {
      question: 'What leaves my device?',
      answer:
        'The answers your machine computes, and nothing else. No files, no browsing ' +
        'history, no identifiers beyond a peer key generated in this tab.',
    },
    {
      question: 'How do I stop it?',
      answer:
        'The Stop control in the bar. It ends the thread and closes the connections ' +
        'immediately — it does not ask the work to finish first.',
    },
  ],
  affirm: 'Allow this page to use my processor',
  decline: 'No',
  reporting: {
    question: 'Optional: report whether my node started',
    answer:
      'Sends one line — which browser family, and whether the node started or was ' +
      'blocked. It is how blocking becomes visible instead of looking like a quiet ' +
      'absence of volunteers. Off unless you turn it on.',
  },
}
