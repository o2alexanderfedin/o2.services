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
 * ## Version 3, 2026-09-02 — BROW-09, and what was MISSING rather than wrong
 *
 * Version 2's six lines were true. Criterion 4 of Phase 35 asks for four specific things and
 * this module carried three of them: *what code runs*, *whose task it is*, and *what leaves
 * the device*. The fourth — **what telemetry is sent** — had no line at all. The `reporting`
 * extra below describes the **opt-in** report, and a visitor reading it learns what happens if
 * they tick the box and nothing whatever about what happens if they do not. That is the half
 * that matters most to somebody deciding, and its absence was not visible because nothing
 * asserted the disclosure's *completeness*. `packages/node/src/disclosure-four-elements.node.test.ts`
 * now does, with one plant per element.
 *
 * The second change is to *What leaves my device?*, and it is a change of **standing** rather
 * than of fact. Version 2 answered it as a list of exclusions — *"The answers your machine
 * computes, and nothing else. No files, no browsing history…"* — which is accurate and reads
 * as a caveat: a reassurance offered by someone who knows you are worried. Criterion 4 asks
 * for the sovereignty guarantee *"stated as a selling point rather than a caveat"*, and the
 * reason is not tone. **Data staying on its owner's device is the whole claim this project
 * makes**, so a visitor meeting it as a mitigation is being told the wrong thing about what
 * they are being asked to join. The guarantee now leads the answer and the exclusions follow
 * it.
 *
 * ## What version 3 deliberately does NOT say
 *
 * The telemetry line states **what is sent**, which is an engineering fact and is settled. It
 * states no **legal basis** — whether the minimal record rests on consent or on legitimate
 * interest under GDPR is `.planning/REQUIREMENTS.md` § Open questions item 3, which records
 * that the sources consulted disagreed with each other and that it is *"settled by legal
 * review, not engineering judgement"*. An agent choosing between them would be recording a
 * compliance ruling as a code change. When the owner rules, the sentence lands here and the
 * version bumps again — which costs nothing, because no cohort exists before Phase 39.
 *
 * ## Version 4, 2026-09-02 — the data cost, beside the processor cost
 *
 * BROW-10. Criterion 5 asks for *"a rough data cost… beside the CPU disclosure and before
 * opt-in, stated in bytes for a representative task and taken from a real run of that task
 * rather than estimated"*, and its reason is a cohort rather than a completeness rule: *"An
 * international cohort has a mobile-data subset, and a figure nobody measured is the one that
 * gets quoted back."* The line sits immediately after *How much of my processor?* because
 * "beside" is where the criterion puts it, and its number comes from `data-cost.ts`, which
 * records the three runs it was read off and what it does and does not count.
 *
 * A second version bump in one phase, and it costs nothing: no cohort exists before Phase 39,
 * so the only visitors this re-asks are the ones who consented during this phase's own
 * development.
 *
 * Pure module — no DOM, no storage, no side effects at import.
 */

import { DISCLOSED_DATA_COST_BYTES } from './data-cost.ts'

/**
 * Bump this whenever any string in `DISCLOSURE` changes.
 *
 * A test asserts that this constant appears in the rendered gate, so a silent
 * edit to the terms fails rather than quietly re-using an old agreement.
 */
export const DISCLOSURE_VERSION = '5'

/**
 * Why the current version differs from the one before it.
 *
 * **Version 4 had become FALSE, and the bump is the repair rather than the paperwork.** It
 * said *"it does not count your visit and it sends nothing about you anywhere"*, which was
 * true of every build that carried it and stopped being true the moment RUN-04's connectivity
 * funnel was armed. A page that counts a visit while its own terms say it does not is the
 * exact defect this constant was created for: `disclosure.ts`'s version-2 note records the
 * same shape, when persistent identity landed and the sentence *"no identifiers beyond a peer
 * key generated in this tab"* went false in both halves with no test noticing for twelve days.
 *
 * So version 5 states the counting plainly, in a line of its own that enumerates the whole
 * record, and re-states the three states a visitor can be in: declined and counted nowhere;
 * consented and counted coarsely; and the separate start report, which is unchanged.
 */
export const CONSENT_VERSION_NOTE: string =
  'this page now counts how far a visit gets — six named steps between opening the page and ' +
  'running a first task — once you have said yes, and a line of its own lists everything ' +
  'those counts hold. Version 4 said the page did not count your visit at all, and that had ' +
  'stopped being true'

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
      question: 'How much of my data allowance?',
      answer:
        `About ${Math.round(DISCLOSED_DATA_COST_BYTES / 1000)} kilobytes leave this device ` +
        'for one run of the search described above. That is a measured figure rather than an ' +
        'estimate — it is what a real run of that search actually sent, and a test compares it ' +
        'against a fresh run so that it cannot quietly go out of date. It counts what leaves; ' +
        'what other participants send back to you is not in it, because nothing on this page ' +
        'measures that.',
    },
    {
      question: 'What leaves my device?',
      answer:
        'Your own data never leaves this device. That is what the whole system is for, and ' +
        'it is a property of how the work is arranged rather than a promise: the code that ' +
        'runs here is handed a public question and computes an answer, so there is nothing ' +
        'of yours for it to send. What leaves is that answer — small integers and bit ' +
        'arrays. No files, no browsing history, no identifiers beyond the key named below.',
    },
    {
      question: 'What does this page report about my visit?',
      answer:
        'Nothing at all unless you say yes above. This page carries no analytics code, sets ' +
        'no cookie and contacts no outside company; a visitor who declines is not counted ' +
        'anywhere, by anything. Once you allow the work to run, this page adds one to a small ' +
        'set of counters that say how far a visit got — the next answer lists everything ' +
        'those counters hold, and it is a short list. The optional report below is a separate ' +
        'thing again: with it turned on, the one line described there is offered to the peers ' +
        'your node is already connected to and to nobody else, and turning it off is not a ' +
        'preference this page records and then ignores — your line is not sent when peers are ' +
        'asked, and your node does not hold it for a peer to ask for either.',
    },
    {
      question: 'What does this page count about my visit?',
      answer:
        'Six named steps between opening this page and running a first task, so that the ' +
        'people building this can see where visitors get stuck. For the two steps where your ' +
        'browser tries to reach another browser, three coarse values travel beside the count: ' +
        'a two-letter country code, a rough label for the kind of connection you are on, and ' +
        'the hour of the day in UTC. That is the entire list. There is no identifier of any ' +
        'kind in it — nothing that joins two of your visits together and nothing that joins a ' +
        'step to you — and your network address is used to work out the two-letter country ' +
        'and is then gone. An hour is not a time, and two letters is a country rather than a ' +
        'place.',
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
