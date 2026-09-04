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
 * ## What version 3 deliberately does NOT say — SUPERSEDED 2026-09-04, kept because the
 * ## abstention is part of the record
 *
 * It read: the telemetry line states **what is sent**, which is an engineering fact and is
 * settled; it states no ground for sending it, because whether the minimal record rests on the
 * visitor's permission or on the project's own interest is `.planning/REQUIREMENTS.md`
 * § Open questions item 3, which records that the sources consulted disagreed with each other
 * and that it is *"settled by legal review, not engineering judgement"*. An agent choosing
 * between them would be recording a compliance ruling as a code change. When the owner rules,
 * the sentence lands here and the version bumps again — which costs nothing, because no cohort
 * exists before Phase 39.
 *
 * **Every word of that held, and the owner ruled on 2026-09-04.** The abstention is recorded
 * rather than removed because it is what made the ruling a ruling: for eleven days the tree
 * carried a guard asserting this module named no ground at all, so nothing could drift into
 * one by an edit. See version 6 below.
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
 * ## Version 6, 2026-09-04 — the ground, ruled by the owner
 *
 * `.planning/REQUIREMENTS.md` § Open questions item 3 is settled: **the visitor's permission,
 * and nothing else.** Version 3's note above promised this sentence would land here when the
 * ruling came, and this is it.
 *
 * **What it changed in the code: nothing.** `funnel-reporter.ts` has armed the counters at
 * consent since RUN-04, and its own docblock records why — consent-armed collection is the
 * *intersection* of the two readings, lawful whichever way the ruling went, so a ruling could
 * only ever widen it. The ruling did not widen it. So this version adds words to a page whose
 * behaviour is already what the words describe, which is the only order in which a disclosure
 * can be written honestly.
 *
 * **The sentence is NOT the one that was drafted, and the difference matters.** The draft
 * carried in `35-01-PLAN.md` reads *"this page sends a report only if you turn it on above;
 * with it off, nothing about you or your visit is sent anywhere"*, and it was written before
 * versions 4 and 5 existed. It is now **false**: with the optional report off and the work
 * allowed, the counters described two answers above are sent. Landing it verbatim would have
 * recreated precisely the defect versions 2 and 5 were each bumped to repair — a disclosure
 * that its own code contradicts. What the ruling settles is the *ground*, and the ground is
 * unchanged by the correction; what needed rewriting is which permissions the sentence points
 * at, and there are two of them rather than one.
 *
 * **What this version does NOT claim.** It states the ground this page collects on. It makes no
 * statement about any other tier, about what a self-hosted node does, or about the enrolment
 * path — those have their own surfaces and would need their own sentences.
 *
 * ## Version 8, 2026-09-04 — the page keeps a node key again, sealed, and version 7 went FALSE
 *
 * The same shape as the v1 -> v2 bump four hundred lines up, and as the v6 -> v7 bump one
 * paragraph up, and it is worth saying so plainly rather than letting a reader discover the
 * parallel a third time: a sentence about the visitor's node key stopped being true because
 * the code under it changed. That is now four bumps of the same kind, which is this constant
 * being the mechanism it was created to be rather than a number somebody remembers to move.
 *
 * The owner ruled on 2026-09-04 that a visitor who is not logged in sees what this is and an
 * invitation to register or log in, and that a visitor who is logged in has a node already
 * running — and that *"log in"* means a **local passphrase**: no email, no account database,
 * no server, no third-party identity provider. `demo/main.ts` therefore passes
 * `identityProtection: { kind: 'passphrase', … }`, built from what the visitor typed on the
 * page, and this browser keeps their node key sealed under it.
 *
 * Version 7 told that visitor:
 *
 * > That key is the name other participants know you by while the work runs, and this page
 * > makes a fresh one each visit and does not keep it — so two visits are two different nodes
 * > rather than one, and nothing joins them together.
 *
 * **Every clause of that is now false for a registered visitor**, and the *"two visits are two
 * different nodes"* clause is false in the direction that matters most: it told somebody they
 * were unlinkable across visits, and they are not. It is also still TRUE for a visitor who has
 * not registered — nothing runs and no key is made at all until they do — so the answer below
 * states both, in the order a visitor meets them.
 *
 * The carry-over changed too, and it changed for the better. Version 7 said a key an earlier
 * build left here is *kept and reused*; after `42-03` a registered visitor's is **sealed in
 * place** — the same bytes, the same peer id, now unreadable without their passphrase — so the
 * sentence says that rather than the weaker thing that was true before.
 *
 * **What this bump does NOT claim**, on this module's standing scope rule:
 *
 * - It does not say the passphrase protects anything **while the node is running**. It does
 *   not: libp2p holds the seed in memory for Noise, and design §3.9 names the gap —
 *   *"derivation moves the risk from at-rest to at-use — the enclave closes that gap"*, and a
 *   tab has no enclave. The claim is about a device that is lost, seized or imaged.
 * - It does not say the passphrase can be recovered, because it cannot, and the surface says
 *   so at the control that destroys the identity rather than here.
 * - It takes no position on any other tier, and none on enrolment, which authenticates a
 *   **node** to a **provider** with a key this page cannot read and is a different act with a
 *   different surface.
 *
 * **Three answers below move, and all three had to.** *"Does this page remember me?"* is the
 * one the ruling is about. *"How do I stop it?"* ended *"starting again begins it under a new
 * node key"*, which was version 7's consequence and is now false. And *"What leaves my
 * device?"* was re-read rather than rewritten: its *"no identifiers beyond the key named
 * below"* clause is unchanged and still true — what leaves is still that key and nothing else;
 * what changed is that it is now the same key next time, which the answer below it states.
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
export const DISCLOSURE_VERSION = '8'

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
 * So version 5 stated the counting plainly, in a line of its own that enumerates the whole
 * record, and re-stated the three states a visitor can be in: declined and counted nowhere;
 * consented and counted coarsely; and the separate start report, which is unchanged.
 *
 * **Version 6 is a different kind of bump, and it is honest to say so.** Nothing the page does
 * changed — the counters were already armed at consent and still are. What version 5 lacked was
 * a statement of the *ground* it collects on, deliberately, while that was an open question; the
 * owner ruled on 2026-09-04 and the sentence landed. A returning visitor is re-asked for a
 * sentence that grants them no less than before, which is the cost of the mechanism working
 * rather than a sign it misfired.
 *
 * ## Version 7, 2026-09-04 — AUTH-06, and version 6 had become FALSE the way version 1 did
 *
 * The same shape as the v1 -> v2 bump three hundred lines up, and it is worth saying so
 * plainly rather than letting a reader discover the parallel: a sentence about the visitor's
 * node key stopped being true because the code under it changed.
 *
 * AUTH-06 made `BrowserNodeOptions.identityProtection` required, and a visitor to this page
 * is asked for no passphrase — so `demo/main.ts` passes `{ kind: 'writes-no-new-secret' }`
 * and the page **writes no node key at all**. Version 6 told that visitor *"A key is stored
 * in this browser, for this site … it is loaded again the next time you visit rather than
 * made afresh — so two visits are the same node, not two strangers."* Every clause of that
 * is now false for a new visitor.
 *
 * Why the page stopped storing one, in the words the code uses: a key written in the clear
 * is readable by anyone who copies this browser profile, and the only two alternatives were
 * to keep writing it in the clear or to demand a passphrase from somebody who came here to
 * look at a page. Neither is what a visitor asked for, so the page keeps nothing.
 *
 * **The carry-over is in the visitor-facing text and not only here**, because it is about a
 * particular person rather than about the code: a browser that already holds a key from an
 * earlier version of this page keeps it and reuses it. Deleting somebody's identity because
 * they were never asked for a passphrase is worse than the exposure it would close — their
 * node would come back a stranger to every peer that knows it.
 *
 * **What this bump does NOT do**, on this module's own standing scope rule: it discloses
 * what the code already does. It takes no position on whether a visitor *should* be asked
 * for a passphrase, and it makes no promise about a later version of this page doing so. A
 * page that starts keeping a key again owes its visitors the opposite sentence and another
 * bump; `consent.test.ts` reads the demo's own `identityProtection` value and demands
 * whichever of the two sentences is the true one, so the guard fires in both directions.
 */
export const CONSENT_VERSION_NOTE: string =
  'this page keeps a node key again, and now it is sealed under a passphrase you choose. ' +
  'Version 7 told you the opposite — that a fresh key was made each visit and written ' +
  'nowhere, so that two visits were two different nodes. That has changed: you are now asked ' +
  'to register with a passphrase on the way in, and the key is stored in this browser ' +
  'encrypted under it, so your next visit is the same node rather than a stranger. Nothing ' +
  'runs and no key is made until you register or log in. The passphrase is held for one ' +
  'visit, is never written down anywhere by this page, and cannot be recovered by anybody, ' +
  'because there is no account and no server here to recover it from. If an earlier version ' +
  'of this page left a key here in the clear, registering seals that same key where it is, ' +
  'so you keep the node you already were'

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
        'asked, and your node does not hold it for a peer to ask for either. Both of those ' +
        'rest on your permission, and on nothing else. The counters begin when you allow the ' +
        'work to run; the optional report begins only if you also tick its box; and a visitor ' +
        'who does neither is not counted on some other footing instead, because there is no ' +
        'other footing here. Withdrawing either permission stops what that permission covers ' +
        '— which is what makes it a permission rather than a notice.',
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
        'Only if you ask it to, and only in this browser. Until you register or log in, ' +
        'nothing runs here and no key is made at all. When you register you choose a ' +
        'passphrase, and your node key — the name other participants know you by while the ' +
        'work runs — is stored in this browser encrypted under it, so that the next time you ' +
        'come back and enter the same passphrase you are the same node rather than a ' +
        'stranger. That key says nothing about you or your device: it is a random number ' +
        'with a name. The passphrase itself is held for this one visit and is written ' +
        'nowhere — not in this browser, not in a link, and not to us, because there is no ' +
        'account here and no server of ours holding anything of yours. That also means ' +
        'nobody can send it back to you if you forget it; the page will offer to start you ' +
        'over as a different node instead, and it says on that button what starting over ' +
        'costs. Two other things are kept, and both are yours: your answer to this page, so ' +
        'that you are not asked again every time; and, if you choose to join a provider, the ' +
        'signed statement that records it, which is what lets a later visit recognise who ' +
        'admitted you. One carry-over, stated because it applies to some people and not ' +
        'others: if an earlier version of this page already put a node key in this browser ' +
        'in the clear, registering encrypts that same key where it is rather than making a ' +
        'new one — so you keep the node you already were, and it stops being readable by ' +
        'anyone who copies this browser. Clearing this site’s data in your browser removes ' +
        'all of it.',
    },
    {
      question: 'How do I stop it?',
      answer:
        'The Stop control in the bar. It ends the thread and closes the connections ' +
        'immediately — it does not ask the work to finish first. It does not undo your ' +
        'answer to this page and it does not sign you out: stopping ends the work, and ' +
        'starting again brings back the same node under the same key, because that key is ' +
        'the one already stored in this browser. Closing the tab is enough to make the page ' +
        'forget your passphrase — it will ask for it again next time.',
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
