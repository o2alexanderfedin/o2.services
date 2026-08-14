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
 * ## Version 2, 2026-08-14 — and the reason is that version 1 had become FALSE
 *
 * This is not a wording improvement. Version 1 told a visitor that what leaves their
 * device is *"no identifiers beyond a peer key **generated in this tab**"*, and that
 * sentence was wrong in both of its halves by the time it was read:
 *
 * - The key is not generated *in this tab*. `browser-node.ts` opens
 *   `IdbIdentityStore`, loads a stored seed if one exists, and only mints when none
 *   does — so it is generated once per **origin** and every later tab loads the
 *   existing one.
 * - It is not tab-scoped in lifetime. `browser-node.ts` says so in its own words —
 *   the derived key means *"this tab's peer id is `identity.peerId` and **survives a
 *   reload**"* — and `gated-seed.e2e.test.ts` pins it: *"same origin, same IndexedDB,
 *   therefore **the same peer id**"*.
 *
 * **The drift was twelve days old.** Persistent identity landed 2026-08-01; this file
 * and `demo/policy.html` were both written 2026-07-26 and neither had been touched
 * since. `DISCLOSURE_VERSION` stayed `'1'` throughout, so every consent granted in
 * that window is one this module's own opening paragraph refuses to call consent: *a
 * record that somebody once clicked something.*
 *
 * **The bump is therefore the repair, not the paperwork.** `policy.html` promises
 * that *"if what the page does changes, the agreement stops applying and the visitor
 * is asked again"*; `readConsent` implements it by refusing a stored version that is
 * not this one. The mechanism worked the whole time and was never triggered, because
 * nobody moved the number. Bumping it re-asks every returning visitor — that cost is
 * the promise being kept, and it is the correct outcome rather than a side effect.
 *
 * **What the new line does NOT do**, so a later reader does not mistake its scope: it
 * discloses what the code already does. It takes no position on whether the seed
 * *should* persist, on key custody, on trust anchors, or on enrolment. Changing any
 * of those is a separate decision with its own disclosure consequence — and its own
 * version bump.
 *
 * Pure module — no DOM, no storage, no side effects at import.
 */

/**
 * Bump this whenever any string in `DISCLOSURE` changes.
 *
 * A test asserts that this constant appears in the rendered gate, so a silent
 * edit to the terms fails rather than quietly re-using an old agreement.
 */
export const DISCLOSURE_VERSION = '2'

/** Why the current version differs from the one before it. */
export const CONSENT_VERSION_NOTE: string =
  'this page now says that the key naming your node is stored on your device and reused ' +
  'when you come back; version 1 said it was generated in the tab'

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
        'history, no identifiers beyond the key named below.',
    },
    {
      question: 'Does this page remember me?',
      answer:
        'Yes, in one specific way. A key is stored in this browser, for this site. It is ' +
        'the name other participants know your node by, and it is loaded again the next ' +
        'time you visit rather than made afresh — so two visits are the same node, not two ' +
        'strangers. It is not shared with other sites, and it says nothing about you or ' +
        'your device. There is currently no control on this page that forgets it; clearing ' +
        'this site’s data in your browser is what removes it.',
    },
    {
      question: 'How do I stop it?',
      answer:
        'The Stop control in the bar. It ends the thread and closes the connections ' +
        'immediately — it does not ask the work to finish first. It does not forget the ' +
        'key above: stopping ends the work, and this tab returns as the same node.',
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
