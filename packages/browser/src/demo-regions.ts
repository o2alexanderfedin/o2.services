/**
 * The region catalogue — every figure the demo page may put on screen, declared as data.
 *
 * ## Three things to know before reading it
 *
 * **1. Why it lives in `src/` and not in `demo/`.** `tab-api.ts` states the rule in its own
 * opening docblock: it lives here *"so the page that implements it and the harness that
 * calls it type-check against one definition"*, because a mismatch between the two would
 * otherwise surface only as a runtime failure inside `page.evaluate`, where the error
 * arrives as a timeout. That argument is exactly this file's argument. The page imports
 * this catalogue to paint its initial absences; `packages/node/src/demo-regions.e2e.test.ts`
 * imports the same file to enumerate the page against it. UI-SPEC section 3 names
 * `packages/browser/demo/regions.ts` and is corrected here — `demo/` is also outside every
 * vitest project's include glob, so a catalogue there could not be imported by a spec at all.
 *
 * **2. This is the *catalogue*, and the division of blame is deliberate.** A wrong absence
 * sentence is a defect in this file and can be blamed on it. A wrong *element* — a region on
 * the page that is in no catalogue, a catalogue entry with no element, a region rendering a
 * number where there is no reading, a `data-source` naming a method `window.o2` does not
 * have — is a defect the guard finds. The guard's expectations come from here and never from
 * the element it is checking: a guard that reads its expectation off the thing under test
 * cannot fail, which is UI-SPEC section 9's P3 as originally written and the reason P3 is
 * arranged the other way round.
 *
 * **3. It was written before any surface, and that is the property that makes the guard a
 * guard.** Landed in Plan 27-03, ahead of Plans 27-04 through 27-09 which wire the screens.
 * Written afterwards it would have been written to fit them, and *"the mockup is now wired"*
 * would have been satisfiable by CSS.
 *
 * ## The two switches
 *
 * {@link WIRED_SURFACES} starts at `['session']`. A surface's plan appends one line to it,
 * which is a greppable admission that the surface has arrived and the switch that turns the
 * guard's *every catalogue entry resolves to an element* half on for all of that surface's
 * regions at once. A surface therefore cannot half-land.
 *
 * {@link Region.permanentlyUnavailable} is the other: it says a reading has no dispatch path
 * from a tab, permanently, and it **inverts** the guard's source check for that entry. See
 * its own docblock — the inversion is the point of the flag rather than a side effect.
 *
 * ## Deliberately not in `packages/browser/src/index.ts`
 *
 * Imported by relative path from the page and from the guard, exactly as `main.ts` imports
 * `../src/worker-factory.ts` today. Adding it to the barrel would put an exported-but-uncalled
 * symbol in front of `reachability-guard.node.test.ts` for no benefit to anybody.
 */

/**
 * `control-status` is **not** a kind, and dropping it is what makes UI-SPEC's own tally add
 * up: section 4's closing paragraph counts 74 `reading` + 6 `constant` + 3 `cited` +
 * 8 `control` = 91, so `session/state` (H1) and `bar/stop` (B3) are `control`.
 *
 * `text-view` and `prose` are additive kinds that are **not** part of the 91 and are never
 * rendered as a figure. `prose` exists so that a legitimate number inside a sentence — the
 * published bound N = 7824, the definition of a Pythagorean triple — is *declared* rather
 * than exempt. Without it, *wrap it in a paragraph* is the loophole that makes the
 * no-undeclared-digit property unenforceable.
 */
export type RegionKind = 'reading' | 'constant' | 'cited' | 'control' | 'text-view' | 'prose'

/** The eight surfaces UI-SPEC section 4 enumerates, in its own order. */
export type SurfaceId =
  | 'session'
  | 'bar'
  | 'colouring'
  | 'primes'
  | 'pi'
  | 'byo'
  | 'fabric'
  | 'bench'

/**
 * The four kinds that are counted as figure regions. The 91.
 *
 * Exported so the guard and this file's own self-checks use one definition; two lists of
 * four strings are two things that can disagree.
 */
export const FIGURE_KINDS: readonly RegionKind[] = ['reading', 'constant', 'cited', 'control']

/**
 * What counts as a digit on screen — stated once, so the catalogue's self-check and the
 * guard's P2 and P3 cannot come to disagree about it.
 *
 * Matches every Unicode decimal digit **and** the superscripts this page actually uses:
 * `²` and `³` from `a² + b² = c²`, `¹`, and the U+2070..U+2079 block the primes surface's
 * published oracle is quoted in.
 *
 * **Its hole, stated rather than left to be discovered.** It does not match roman numerals,
 * it does not match spelled-out numbers (*seven thousand eight hundred and twenty-four*),
 * and it does not match subscripts. A placeholder written as `forty-one` is invisible to it.
 * The alternative — a rule against number *words* — would fire on every named absence this
 * catalogue holds, because `No count`, `Not counted` and `no rung settled` are all about
 * quantities. So the check is over glyphs, and this comment is its stated limit.
 */
export const DIGIT: RegExp = /[\p{Nd}²³¹⁰-⁹]/u

/** The three states a `reading` region can be in when it has no reading to show. */
export interface RegionAbsence {
  /** On screen with a running node and nothing dispatched. Contains no digit. */
  readonly initial: string
  /** On screen when `activity() === null`. Contains no digit. */
  readonly stopped: string
  /**
   * The legitimate-absence arm, present only where UI-SPEC section 4 names a **literal
   * sentence** for it. Contains no digit.
   *
   * Absent where UI-SPEC's unavailable column names a *dynamic* reason instead — *the thrown
   * message from `autoStart`*, *section 5.1's absence arm*, *`reduceReason` verbatim*. Those
   * are written by the writer's `reason` parameter at render time and there is no fixed
   * string for this file to hold. Recording an invented one would put a sentence in the
   * copywriting contract that nothing produces.
   */
  readonly unavailable?: string
}

export interface Region {
  /** `<surface>/<field>`, unique. The catalogue key and the `data-region` value. */
  readonly id: string
  readonly surface: SurfaceId
  readonly kind: RegionKind
  /**
   * `reading`  -> `TabApi.<method>().<field>`, exactly
   * `constant` -> the exported symbol, e.g. `@o2/demo.MAX_N`
   * `cited`    -> the committed document path and section, or a published constant
   * others     -> what the element is
   *
   * A handful of readings are composed from more than one call or field — `session/peers-sentence`
   * is three calls, `fabric/blocks` is two. Those name the method that carries the figure
   * first, so the form stays `TabApi.<method>(` and the guard can resolve it, and the rest
   * of the composition follows in the same string. Nothing is hidden in a comment that the
   * guard would then not see.
   */
  readonly source: string
  /** Required for `reading`, except the bar's two. Absent for every other kind. */
  readonly absence?: RegionAbsence
  /**
   * The bar's three regions only. `activity() === null` removes the element entirely.
   *
   * UI-SPEC section 4.1: **the element's existence IS the reading.** A bar reading `idle`
   * while offering to stop a node that does not exist is a defect this page already fixed
   * once, and the fix was to delete the bar rather than to give it absence copy. So these
   * three carry no `absence` at all, and the guard skips them while `#bar` is absent.
   */
  readonly absenceMode?: 'element-removed'
  /**
   * This reading has **no dispatch path from a tab**, permanently, and renders its
   * `absence.unavailable` sentence in every state.
   *
   * Two guard consequences, and they are the point of the flag rather than side effects:
   *
   * - **P3** expects `absence.unavailable` for these, not `absence.stopped`.
   * - **P4 inverts for these.** For an ordinary reading, the method named in `source` MUST
   *   be a key of `window.o2`. For one of these it must **NOT** be — which turns *this
   *   surface cannot run* into a positive, checkable claim rather than a silence. The day
   *   somebody adds `TabApi.runPrimes`, P4 reddens and the Primes surface is forced back
   *   onto the board instead of quietly staying absent.
   */
  readonly permanentlyUnavailable?: { readonly reason: string }
}

/**
 * UI-SPEC section 4's tally of itself, as data rather than as prose.
 *
 * The guard asserts the catalogue against these numbers. That is a check on **both**: a
 * transcription that dropped a row reddens, and so does a tally UI-SPEC states about itself
 * and does not meet. A disagreement is reported, not reconciled — UI-SPEC's tally is a claim
 * and the catalogue is the measurement of it.
 */
export const UI_SPEC_TALLY: {
  readonly total: number
  readonly bySurface: Readonly<Record<SurfaceId, number>>
  readonly byKind: Readonly<Record<'reading' | 'constant' | 'cited' | 'control', number>>
} = {
  total: 91,
  bySurface: {
    session: 5,
    bar: 3,
    colouring: 21,
    primes: 12,
    pi: 14,
    byo: 13,
    fabric: 21,
    bench: 2,
  },
  byKind: { reading: 74, constant: 6, cited: 3, control: 8 },
}

/**
 * The surfaces whose regions must all be on screen.
 *
 * One line per surface, appended by the plan that lands it — a greppable admission that a
 * surface has arrived, and the switch that turns the guard's second half on for all of that
 * surface's regions at once. Starts as `['session']`; the phase is complete when it holds
 * all eight.
 */
export const WIRED_SURFACES: readonly SurfaceId[] = [
  // Plan 27-03 — the five header regions, wired through `demo/render.ts` in the same plan
  // that landed this catalogue, so the mechanism is proved against readings that already
  // existed before any new surface depends on it.
  'session',
]

// ---------------------------------------------------------------------------------------
// Repeated sentences, named once.
//
// Transcribed from UI-SPEC section 4 and shared where UI-SPEC's own table says *"as C10"*,
// *"as F1"*, *"as N3"*. Naming them is not a tidy-up: it is what stops two rows that UI-SPEC
// says carry one sentence from drifting into two sentences that differ by a comma.
// ---------------------------------------------------------------------------------------

/**
 * UI-SPEC section 4.3's unavailable copy for the Primes surface, in the short per-region
 * form. Every Primes reading but N9 carries it — the table says *"as N3"* on N4, N6, N8 and
 * N11, and N5 and N7 take it too under the Option B decision recorded at the surface below.
 */
const PRIMES_NO_DISPATCH = 'No count: this workload has no dispatch path from a tab — see above.'

/** C10's unavailable arm. UI-SPEC's C11 row says *"as C10"* and this is that sentence. */
const COLOURING_NO_RUNG = 'No per-cube status: no rung settled.'

/** C12's unavailable arm. UI-SPEC's C13 and C14 rows say *"as C12"*. */
const COLOURING_NO_SETTLED =
  'No settled rung: the fabric did not settle any rung of the ladder.'

/**
 * C18 through C21's absence, in **both** arms, and the wording is load-bearing.
 *
 * It says *no answer has been produced to check* and never *the node is stopped*, because
 * `verifyAnswer()` needs no node, no peer and no network — UI-SPEC section 5.4, and
 * `colouring-demo.e2e.test.ts` asserts exactly that property. Copy saying the node is
 * stopped would contradict the one control on this page that works with the fabric
 * disconnected.
 */
const COLOURING_NOT_CHECKED = 'Not checked: no answer has been produced to check.'

/** The `Nothing dispatched yet` copy every argument control carries — C1, C2, N1, N2, P1, P2. */
const ARG_NOT_DISPATCHED = 'Nothing dispatched yet — this is what would be sent.'

// ---------------------------------------------------------------------------------------
// The catalogue.
//
// UI-SPEC's table order throughout — H1..H5, B1..B3, C1..C21, N1..N12, P1..P14, Y1..Y13,
// F1..F21, K1..K2 — with the UI-SPEC row label in a trailing comment on each entry, so a
// reader can walk one against the other without counting.
// ---------------------------------------------------------------------------------------

export const REGIONS: readonly Region[] = [
  // =====================================================================================
  // Session header — 5 regions. UI-SPEC section 4.0.
  // "always visible on every surface": the node's own status is not a property of
  // whichever workload happens to be on screen.
  //
  // DECISION: H1 is kind `control`, not the `control-status` UI-SPEC's H1 row names. See
  // `RegionKind` — `control-status` is not one of the four kinds UI-SPEC's own 8-control
  // tally counts, and with it the tally does not add up.
  // =====================================================================================
  {
    id: 'session/state', // H1
    surface: 'session',
    kind: 'control',
    // Not a `TabApi` reading: the page's own state machine over three calls. Its copy —
    // `checking for a relay…`, `no relay reachable from this page`, `node running —
    // reachable by other tabs`, `stopped — the thread was ended and the connections
    // closed` — is unchanged from today, including the no-relay case that
    // `built-bundle.e2e.test.ts` reads by substring.
    source: 'the page state machine over TabApi.discoverRelays(), autoStart() and stop()',
  },
  {
    id: 'session/peer-id', // H2
    surface: 'session',
    kind: 'reading',
    source: 'TabApi.autoStart().peerId',
    absence: {
      initial: 'No peer id: this tab has not joined.',
      stopped: "No peer id: this tab's node is stopped.",
      // UI-SPEC's unavailable column here is "the thrown message from `autoStart`" — a
      // dynamic reason, written by the writer's `reason` parameter. No fixed sentence.
    },
  },
  {
    id: 'session/relay', // H3
    surface: 'session',
    kind: 'reading',
    source: 'TabApi.discoverRelays().relayAddrs[0]',
    absence: {
      initial: 'No relay: this page has not been asked yet.',
      stopped: "No relay: this tab's node is stopped.",
      // `source === 'none'`. Note that under the writer's stopped-wins rule (see
      // `demo/render.ts`) this arm is currently unreachable: a page with no relay cannot
      // start a node, so `activity()` is null whenever `source === 'none'` and the stopped
      // sentence is what is painted. Recorded as a finding rather than deleted — the arm is
      // UI-SPEC's copy and becomes reachable the day a node can outlive its relay discovery.
      unavailable: 'No relay: this page was served by a static host, which runs none.',
    },
  },
  {
    id: 'session/webrtc-addr', // H4
    surface: 'session',
    kind: 'reading',
    source: 'TabApi.waitForWebrtcAddr()[0]',
    absence: {
      initial: 'No address: this tab has not joined.',
      stopped: "No address: this tab's node is stopped.",
      unavailable: 'No address: the relay has not yet produced a reservation.',
    },
  },
  {
    id: 'session/peers-sentence', // H5
    surface: 'session',
    kind: 'reading',
    // Three calls compose this one sentence. `computePeers` carries the figure, so it is
    // named first and the guard resolves that method; the other two are named in the same
    // string rather than hidden in a comment the guard cannot read.
    source: 'TabApi.computePeers() with connectDiscoveredPeers() and peers()',
    absence: {
      initial: 'Not counted yet: no discovery round has run.',
      stopped: "Not counted: this tab's node is stopped.",
      // UI-SPEC: "existing copy verbatim (`#peers`) — including the relayed-only and
      // stalled clauses". That copy is a *reading*, not an absence: it is written through
      // `writeReading` and `attestation-ui.e2e.test.ts` reads `1 node(s) computing` and
      // `2 node(s) computing` out of it. Unchanged, wording and all.
    },
  },

  // =====================================================================================
  // Bar — 3 regions. UI-SPEC section 4.1.
  // "the always-visible activity bar", hidden iff no node.
  //
  // The bar has no absence copy and that is deliberate: `activity() === null` removes the
  // bar entirely, so the element's existence IS the reading. `built-bundle.e2e.test.ts`
  // asserts `isVisible('#bar') === false` before consent.
  //
  // DECISION: B3 is kind `control`, for the same reason H1 is.
  // =====================================================================================
  {
    id: 'bar/what', // B1
    surface: 'bar',
    kind: 'reading',
    source: 'TabApi.activity().servedFor with .peers',
    absenceMode: 'element-removed',
  },
  {
    id: 'bar/stats', // B2
    surface: 'bar',
    kind: 'reading',
    source: 'TabApi.activity().dutyCycle with .hidden, .tasksExecuted and .fetched',
    absenceMode: 'element-removed',
  },
  {
    id: 'bar/stop', // B3
    surface: 'bar',
    kind: 'control',
    // `Stop` — the word the disclosure uses, and UI-SPEC section 11 forbids softening it to
    // `Pause` or `End`.
    source: 'the Stop control, calling TabApi.stop()',
    absenceMode: 'element-removed',
  },

  // =====================================================================================
  // Colouring — 21 regions. UI-SPEC section 4.2.
  // "Capacity grows with participants, and it grows in steps." One or more
  // `runColouring()` results over the ladder [300, 400, 500, 600]; `best` is the last
  // settled run.
  // =====================================================================================
  {
    id: 'colouring/cubes-arg', // C1
    surface: 'colouring',
    kind: 'control',
    source: 'the argument this page will send: 8 x (1 + computePeers().length)',
    // Initial and stopped copy: ARG_NOT_DISPATCHED. A control carries no `absence` — see
    // `Region.absence` — and this comment is where its copy is recorded.
  },
  {
    id: 'colouring/redundancy-arg', // C2
    surface: 'colouring',
    kind: 'control',
    source: 'the argument this page will send: min(2, 1 + computePeers().length)',
    // Copy: ARG_NOT_DISPATCHED, both states.
  },
  {
    id: 'colouring/budget', // C3
    surface: 'colouring',
    kind: 'constant',
    source: '@o2/demo.DEFAULT_BUDGET',
    // Labelled `backtracks, fixed, travels in the input`.
  },
  {
    id: 'colouring/max-n', // C4
    surface: 'colouring',
    kind: 'constant',
    source: '@o2/demo.MAX_N',
    // Labelled `above it the guest returns "unknown"`.
  },
  {
    id: 'colouring/input-bytes', // C5
    surface: 'colouring',
    kind: 'constant',
    source: '@o2/demo.buildInput(MAX_N, DEFAULT_BUDGET).length',
    // Computed in-page from the shipped builder, labelled with the expression itself.
  },
  {
    id: 'colouring/rung-300', // C6
    surface: 'colouring',
    kind: 'reading',
    source: 'TabApi.runColouring().found with .statuses and .elapsedMs',
    absence: {
      initial: 'Not attempted: the ladder has not been run.',
      stopped: "Not attempted: this tab's node is stopped.",
      // Unavailable: the thrown message from the rung. Dynamic; no fixed sentence.
    },
  },
  {
    id: 'colouring/rung-400', // C7 — "as C6 at n=400"
    surface: 'colouring',
    kind: 'reading',
    source: 'TabApi.runColouring().found with .statuses and .elapsedMs',
    absence: {
      initial: 'Not attempted: the ladder has not been run.',
      stopped: "Not attempted: this tab's node is stopped.",
    },
  },
  {
    id: 'colouring/rung-500', // C8 — "as C6 at n=500"
    surface: 'colouring',
    kind: 'reading',
    source: 'TabApi.runColouring().found with .statuses and .elapsedMs',
    absence: {
      initial: 'Not attempted: the ladder has not been run.',
      stopped: "Not attempted: this tab's node is stopped.",
    },
  },
  {
    id: 'colouring/rung-600', // C9 — as C6 at n=600, with an unavailable arm of its own
    surface: 'colouring',
    kind: 'reading',
    source: 'TabApi.runColouring().found with .statuses and .elapsedMs',
    absence: {
      initial: 'Not attempted: the ladder has not been run.',
      stopped: "Not attempted: this tab's node is stopped.",
      unavailable: 'Not attempted: the ladder stopped at an earlier rung.',
    },
  },
  {
    id: 'colouring/cube-grid', // C10
    surface: 'colouring',
    kind: 'reading',
    source: 'TabApi.runColouring().statuses',
    absence: {
      initial: 'No per-cube status: the search has not been run.',
      stopped: "No per-cube status: this tab's node is stopped.",
      unavailable: COLOURING_NO_RUNG,
    },
  },
  {
    id: 'colouring/status-counts', // C11
    surface: 'colouring',
    kind: 'reading',
    source: 'TabApi.runColouring().statuses',
    absence: {
      initial: 'Not counted: the search has not been run.',
      stopped: "Not counted: this tab's node is stopped.",
      // UI-SPEC's C11 unavailable cell reads "as C10", so this is C10's sentence verbatim
      // rather than a `Not counted:` variant of it. Transcribed, not improved — section 11
      // is the copywriting contract and section 4's column is part of it.
      unavailable: COLOURING_NO_RUNG,
    },
  },
  {
    id: 'colouring/best-n', // C12
    surface: 'colouring',
    kind: 'reading',
    source: 'TabApi.runColouring().n',
    absence: {
      initial: 'No settled rung: the search has not been run.',
      stopped: "No settled rung: this tab's node is stopped.",
      unavailable: COLOURING_NO_SETTLED,
    },
  },
  {
    id: 'colouring/complete', // C13
    surface: 'colouring',
    kind: 'reading',
    source: 'TabApi.runColouring().complete',
    absence: {
      initial: 'Not established: the search has not been run.',
      stopped: "Not established: this tab's node is stopped.",
      unavailable: COLOURING_NO_SETTLED,
    },
  },
  {
    id: 'colouring/verification-multiplier', // C14
    surface: 'colouring',
    kind: 'reading',
    source: 'TabApi.runColouring().verificationMultiplier',
    absence: {
      initial: 'Not measured: the search has not been run.',
      stopped: "Not measured: this tab's node is stopped.",
      unavailable: COLOURING_NO_SETTLED,
    },
  },
  {
    id: 'colouring/attestation', // C15
    surface: 'colouring',
    kind: 'reading',
    source: 'TabApi.runColouring().attestation',
    absence: {
      initial: 'Not established: the search has not been run.',
      stopped: "Not established: this tab's node is stopped.",
      // Unavailable: section 5.1's absence arm, composed by `attestationLines` from the
      // kernel's own words. Dynamic; no fixed sentence, and inventing one would put a
      // second author on a sentence whose whole design is that it has one.
    },
  },
  {
    id: 'colouring/agreeing', // C16
    surface: 'colouring',
    kind: 'reading',
    source: 'TabApi.runColouring().agreeing',
    absence: {
      initial: 'No placement: the search has not been run.',
      stopped: "No placement: this tab's node is stopped.",
      unavailable: 'No placement: no cube reached agreement.',
    },
  },
  {
    id: 'colouring/egress', // C17
    surface: 'colouring',
    kind: 'reading',
    // ONE region — the count and its sentence together. UI-SPEC section 5.2: `0 withheld`
    // may never be rendered without the sentence explaining that the run registered no
    // sovereign data, because the bare figure reads as a sovereignty proof and would be a
    // lie by omission. Splitting the count from its sentence into two elements is exactly
    // the plant that P7 exists to catch.
    source: 'TabApi.runColouring().egress',
    absence: {
      initial: 'Nothing measured: nothing has left this device for this workload yet.',
      stopped: "Nothing measured: this tab's node is stopped.",
    },
  },
  {
    id: 'colouring/verify-verdict', // C18
    surface: 'colouring',
    kind: 'reading',
    source: 'TabApi.verifyAnswer().ok',
    absence: { initial: COLOURING_NOT_CHECKED, stopped: COLOURING_NOT_CHECKED },
  },
  {
    id: 'colouring/verify-n', // C19
    surface: 'colouring',
    kind: 'reading',
    source: 'TabApi.verifyAnswer().n',
    absence: { initial: COLOURING_NOT_CHECKED, stopped: COLOURING_NOT_CHECKED },
  },
  {
    id: 'colouring/verify-triples', // C20
    surface: 'colouring',
    kind: 'reading',
    source: 'TabApi.verifyAnswer().triplesChecked',
    absence: { initial: COLOURING_NOT_CHECKED, stopped: COLOURING_NOT_CHECKED },
  },
  {
    id: 'colouring/verify-violation', // C21
    surface: 'colouring',
    kind: 'reading',
    source: 'TabApi.verifyAnswer().violation',
    absence: {
      initial: COLOURING_NOT_CHECKED,
      stopped: COLOURING_NOT_CHECKED,
      unavailable:
        'No refutation: every triple checked has two colours among its three numbers.',
    },
  },

  // =====================================================================================
  // Primes — 12 regions. UI-SPEC section 4.3.
  // "An oracle nothing here produced."
  //
  // DECISION, and it is the largest one in this file: **Option B**, per UI-SPEC section 10
  // and this phase's plan set. As of 2026-08-10 there is no path from a tab to a
  // prime-counting job — `primes.wasm` has no signed record, `runJob` hardcodes each
  // shard's value to `{a: <index>}` and so cannot carry `buildPrimesInput(n)`, and
  // `scripts/sign-kernel.ts` discards its private half each run, so a third record means a
  // new trust anchor and a change to what a stock `o2 agent` and a stock `o2 seed` will run.
  //
  // So N3..N9 and N11 carry `permanentlyUnavailable`, their `source` names
  // `TabApi.runPrimes()` — a method that does not exist — and UI-SPEC section 4.3's
  // **unavailable** column is transcribed into all three absence arms, because the surface
  // renders that copy permanently.
  //
  // **Naming a method that does not exist is deliberate here, and P4's inverted arm is what
  // makes it a claim rather than a mistake.** Do not add `TabApi.runPrimes`; Option A
  // touches the trust root and is an owner decision surfaced separately.
  //
  // Two of these rows take a further decision, marked at the entry: UI-SPEC's N5 and N7
  // unavailable cells name section 5.3's lone-tab copy and section 5.1's absence arm, both
  // of which are Option A arms that cannot occur under Option B. They take N3's sentence,
  // which is what UI-SPEC's own N4, N6, N8 and N11 rows do with "as N3".
  // =====================================================================================
  {
    id: 'primes/n-arg', // N1
    surface: 'primes',
    kind: 'control',
    source: 'the argument this page would send under Option A',
    // Copy: ARG_NOT_DISPATCHED, both states.
  },
  {
    id: 'primes/shards-arg', // N2
    surface: 'primes',
    kind: 'control',
    source: 'the argument this page would send under Option A',
    // Copy: ARG_NOT_DISPATCHED, both states.
  },
  {
    id: 'primes/total', // N3
    surface: 'primes',
    kind: 'reading',
    source: 'TabApi.runPrimes().total',
    absence: {
      initial: PRIMES_NO_DISPATCH,
      stopped: PRIMES_NO_DISPATCH,
      unavailable: PRIMES_NO_DISPATCH,
    },
    permanentlyUnavailable: {
      reason:
        'no signed record vouches for the prime-counting module, and every executor in this fabric refuses a module whose record no pinned anchor signed',
    },
  },
  {
    id: 'primes/complete', // N4 — unavailable "as N3"
    surface: 'primes',
    kind: 'reading',
    source: 'TabApi.runPrimes().complete',
    absence: {
      initial: PRIMES_NO_DISPATCH,
      stopped: PRIMES_NO_DISPATCH,
      unavailable: PRIMES_NO_DISPATCH,
    },
    permanentlyUnavailable: {
      reason: 'the surface has no dispatch path from a tab — see primes/total',
    },
  },
  {
    id: 'primes/reduce-state', // N5
    surface: 'primes',
    kind: 'reading',
    source: 'TabApi.runPrimes().reduceAttempted with .reduceReason and .combined',
    absence: {
      // DECISION: UI-SPEC's N5 unavailable cell names "section 5.3's lone-tab copy, or the
      // fabric's own `reduceReason`". Both are Option A arms — there is no run, so there is
      // no `reduceReason` and no lone-tab condition to describe. It takes N3's sentence,
      // which is the treatment UI-SPEC's own N4/N6/N8/N11 rows apply.
      initial: PRIMES_NO_DISPATCH,
      stopped: PRIMES_NO_DISPATCH,
      unavailable: PRIMES_NO_DISPATCH,
    },
    permanentlyUnavailable: {
      reason: 'the surface has no dispatch path from a tab — see primes/total',
    },
  },
  {
    id: 'primes/elapsed', // N6 — unavailable "as N3"
    surface: 'primes',
    kind: 'reading',
    source: 'TabApi.runPrimes().elapsedMs',
    absence: {
      initial: PRIMES_NO_DISPATCH,
      stopped: PRIMES_NO_DISPATCH,
      unavailable: PRIMES_NO_DISPATCH,
    },
    permanentlyUnavailable: {
      reason: 'the surface has no dispatch path from a tab — see primes/total',
    },
  },
  {
    id: 'primes/attestation', // N7
    surface: 'primes',
    kind: 'reading',
    source: 'TabApi.runPrimes().attestation',
    absence: {
      // DECISION: as N5. UI-SPEC names section 5.1's absence arm, which is composed from a
      // receipt a run produced; under Option B there is no run and no receipt.
      initial: PRIMES_NO_DISPATCH,
      stopped: PRIMES_NO_DISPATCH,
      unavailable: PRIMES_NO_DISPATCH,
    },
    permanentlyUnavailable: {
      reason: 'the surface has no dispatch path from a tab — see primes/total',
    },
  },
  {
    id: 'primes/egress', // N8 — one region, count and sentence together. Splitting is P7's plant.
    surface: 'primes',
    kind: 'reading',
    source: 'TabApi.runPrimes().egress',
    absence: {
      initial: PRIMES_NO_DISPATCH,
      stopped: PRIMES_NO_DISPATCH,
      unavailable: PRIMES_NO_DISPATCH,
    },
    permanentlyUnavailable: {
      reason: 'the surface has no dispatch path from a tab — see primes/total',
    },
  },
  {
    id: 'primes/per-shard', // N9
    surface: 'primes',
    kind: 'reading',
    // **The pattern for "the mockup drew something the reading does not carry."** The
    // mockup's per-shard table is not available from any `TabApi` shape. It is not silently
    // dropped and it is not filled with plausible rows: it states which reading it would
    // need. The same treatment applies anywhere else a mockup panel outruns the contract.
    source: 'TabApi.runPrimes().perShard — no such field exists on any reading this page receives',
    absence: {
      initial:
        'No per-shard counts: the reading this page receives carries the total and not the shard rows.',
      stopped:
        'No per-shard counts: the reading this page receives carries the total and not the shard rows.',
      unavailable:
        'No per-shard counts: the reading this page receives carries the total and not the shard rows.',
    },
    permanentlyUnavailable: {
      reason:
        'the field does not exist on any TabApi return type, so the row has no reading to wait for',
    },
  },
  {
    id: 'primes/oracle-table', // N10
    surface: 'primes',
    kind: 'cited',
    // A published mathematical value rather than a committed measurement — UI-SPEC section
    // 0's `cited` row admits both. Marked on screen `published in the mathematical
    // literature; not computed here`.
    source: 'published values of the prime-counting function at powers of ten',
  },
  {
    id: 'primes/oracle-compare', // N11 — unavailable "as N3"
    surface: 'primes',
    kind: 'reading',
    source: 'TabApi.runPrimes().total against primes/oracle-table for the same x',
    absence: {
      initial: PRIMES_NO_DISPATCH,
      stopped: PRIMES_NO_DISPATCH,
      unavailable: PRIMES_NO_DISPATCH,
    },
    permanentlyUnavailable: {
      reason: 'there is no count from this tab to compare — see primes/total',
    },
  },
  {
    id: 'primes/max-n', // N12
    surface: 'primes',
    kind: 'constant',
    source: '@o2/demo.PRIME_MAX_N',
  },

  // =====================================================================================
  // pi and reduce — 14 regions. UI-SPEC section 4.4.
  // "The only workload with a real aggregation." Reading: `TabApi.runPi(...)` -> `TabPiRun`.
  //
  // DECISION: P12 is kind `reading`. UI-SPEC's P12 row says "reading + cited", which is not
  // one of the four kinds; counting it as `cited` would make the by-kind tally 4 cited and
  // 73 reading against UI-SPEC's stated 3 and 74. The published constant it is compared
  // against is on screen beside it as its own operand, which is what the row's "both
  // operands on screen" requirement is really asking for.
  //
  // NOT HERE, and stated rather than left to be noticed: UI-SPEC section 4.4's prose names a
  // **shard-partials** absence — *"No per-shard partials: the reading this page receives
  // carries the aggregate and not the shard rows."* — and gives it no row in the table and
  // no number in the tally. Adding it would make this surface 15 and the catalogue 92,
  // against a tally UI-SPEC states about itself and this file's guard checks. It is a
  // sentence the pi surface renders as prose, and Plan 27-06 owns it. `primes/per-shard`
  // (N9) is the same pattern with a row of its own, so the pattern is still under guard.
  // =====================================================================================
  {
    id: 'pi/terms-arg', // P1
    surface: 'pi',
    kind: 'control',
    source: 'the argument this page will send: the term count',
    // Copy: ARG_NOT_DISPATCHED, both states.
  },
  {
    id: 'pi/shards-arg', // P2
    surface: 'pi',
    kind: 'control',
    source: 'the argument this page will send: the shard count',
    // Copy: ARG_NOT_DISPATCHED, both states.
  },
  {
    id: 'pi/terms', // P3
    surface: 'pi',
    kind: 'reading',
    source: 'TabApi.runPi().terms',
    absence: {
      initial: 'Not dispatched: the series has not been run in this tab.',
      stopped: "Not dispatched: this tab's node is stopped.",
    },
  },
  {
    id: 'pi/shards', // P4
    surface: 'pi',
    kind: 'reading',
    source: 'TabApi.runPi().shards',
    absence: {
      initial: 'Not dispatched: the series has not been run in this tab.',
      stopped: "Not dispatched: this tab's node is stopped.",
    },
  },
  {
    id: 'pi/complete', // P5 — the MAP half
    surface: 'pi',
    kind: 'reading',
    source: 'TabApi.runPi().complete',
    absence: {
      initial: 'Not established: the series has not been run in this tab.',
      stopped: "Not established: this tab's node is stopped.",
    },
  },
  {
    id: 'pi/reduce-attempted', // P6
    surface: 'pi',
    kind: 'reading',
    source: 'TabApi.runPi().reduceAttempted with .reduceReason',
    absence: {
      initial: 'Not attempted: the series has not been run in this tab.',
      stopped: "Not attempted: this tab's node is stopped.",
      // Unavailable: section 5.3's second-device panel, carrying `reduceReason` verbatim.
      // Dynamic — the fabric's own words, which the page never paraphrases.
    },
  },
  {
    id: 'pi/combined', // P7
    surface: 'pi',
    kind: 'reading',
    source: 'TabApi.runPi().combined',
    absence: {
      initial: 'Not attempted: the series has not been run in this tab.',
      stopped: "Not attempted: this tab's node is stopped.",
      unavailable: 'No aggregate: a reduce was started and no combine produced one.',
    },
  },
  {
    id: 'pi/tree-depth', // P8
    surface: 'pi',
    kind: 'reading',
    source: 'TabApi.runPi().treeDepth',
    absence: {
      initial: 'No tree: no reduce was attempted.',
      stopped: "No tree: this tab's node is stopped.",
      unavailable: 'No tree: no reduce was attempted — see above.',
    },
  },
  {
    id: 'pi/combines', // P9 — "as P8"
    surface: 'pi',
    kind: 'reading',
    source: 'TabApi.runPi().combines',
    absence: {
      initial: 'No tree: no reduce was attempted.',
      stopped: "No tree: this tab's node is stopped.",
      unavailable: 'No tree: no reduce was attempted — see above.',
    },
  },
  {
    id: 'pi/estimate', // P10
    surface: 'pi',
    kind: 'reading',
    source: 'TabApi.runPi().estimate',
    absence: {
      initial: 'No estimate: the series has not been run in this tab.',
      stopped: "No estimate: this tab's node is stopped.",
      unavailable: 'No estimate: the fabric produced no aggregate to read back.',
    },
  },
  {
    id: 'pi/error-bound', // P11
    surface: 'pi',
    kind: 'reading',
    source: 'TabApi.runPi().errorBound',
    absence: {
      initial: 'No bound: the series has not been run in this tab.',
      stopped: "No bound: this tab's node is stopped.",
    },
  },
  {
    id: 'pi/against-published', // P12 — see the surface note on why this is `reading`
    surface: 'pi',
    kind: 'reading',
    source: 'TabApi.runPi().estimate against the published constant, with .errorBound beside it',
    absence: {
      initial: 'No comparison: there is no estimate from this tab to compare.',
      // UI-SPEC's stopped cell reads "same".
      stopped: 'No comparison: there is no estimate from this tab to compare.',
      unavailable: 'No comparison: the fabric produced no aggregate to compare.',
    },
  },
  {
    id: 'pi/elapsed', // P13
    surface: 'pi',
    kind: 'reading',
    source: 'TabApi.runPi().elapsedMs',
    absence: {
      initial: 'Not timed: the series has not been run in this tab.',
      stopped: "Not timed: this tab's node is stopped.",
    },
  },
  {
    id: 'pi/egress', // P14 — one region, count and sentence together. Splitting is P7's plant.
    surface: 'pi',
    kind: 'reading',
    source: 'TabApi.runPi().egress',
    absence: {
      initial: 'Nothing measured: nothing has left this device for this workload yet.',
      stopped: "Nothing measured: this tab's node is stopped.",
    },
  },

  // =====================================================================================
  // Bring-your-own — 13 regions. UI-SPEC section 4.5.
  // Reading: `TabApi.runJob(...)` -> `TabJobReport`. This surface is what closes audit
  // finding G4: `runJob` gains a caller in the page.
  // =====================================================================================
  {
    id: 'byo/pinned-anchor', // Y1
    surface: 'byo',
    kind: 'constant',
    source: '@o2/demo.KERNEL_TRUST_ANCHOR',
  },
  {
    id: 'byo/shard-input', // Y2
    surface: 'byo',
    kind: 'constant',
    // The one `constant` whose source is not an exported symbol, and saying so is better
    // than pretending: UI-SPEC's Y2 is "the literal shape `runJob` sends per shard", which
    // lives at a named call site rather than in a package's exports. The catalogue's
    // self-check admits a committed path for exactly this row.
    source: 'packages/browser/demo/main.ts runJob() — the per-shard literal { a: <shard index> }',
    // Rendered with the sentence: *every shard receives this canonical value; this path
    // carries no caller-supplied input*.
  },
  {
    id: 'byo/complete', // Y3
    surface: 'byo',
    kind: 'reading',
    source: 'TabApi.runJob().complete',
    absence: {
      initial: 'Not dispatched: no job has been submitted from this form.',
      stopped: "Not dispatched: this tab's node is stopped.",
    },
  },
  {
    id: 'byo/partitions', // Y4 — `-1` renders as `no agreement`, never as a number
    surface: 'byo',
    kind: 'reading',
    source: 'TabApi.runJob().partitions',
    absence: {
      initial: 'No partitions: no job has been submitted from this form.',
      stopped: "No partitions: this tab's node is stopped.",
    },
  },
  {
    id: 'byo/replicas', // Y5
    surface: 'byo',
    kind: 'reading',
    source: 'TabApi.runJob().replicas',
    absence: {
      initial: 'No replica counts: no job has been submitted from this form.',
      stopped: "No replica counts: this tab's node is stopped.",
    },
  },
  {
    id: 'byo/agreeing', // Y6
    surface: 'byo',
    kind: 'reading',
    source: 'TabApi.runJob().agreeing',
    absence: {
      initial: 'No placement: no job has been submitted from this form.',
      stopped: "No placement: this tab's node is stopped.",
      unavailable: 'No placement: no shard reached agreement.',
    },
  },
  {
    id: 'byo/verification-multiplier', // Y7
    surface: 'byo',
    kind: 'reading',
    source: 'TabApi.runJob().verificationMultiplier',
    absence: {
      initial: 'Not measured: no job has been submitted from this form.',
      stopped: "Not measured: this tab's node is stopped.",
    },
  },
  {
    id: 'byo/fetched', // Y8
    surface: 'byo',
    kind: 'reading',
    source: 'TabApi.runJob().fetched',
    absence: {
      initial: 'Not counted: no job has been submitted from this form.',
      stopped: "Not counted: this tab's node is stopped.",
    },
  },
  {
    id: 'byo/rejected', // Y9 — "as Y8"
    surface: 'byo',
    kind: 'reading',
    source: 'TabApi.runJob().rejected',
    absence: {
      initial: 'Not counted: no job has been submitted from this form.',
      stopped: "Not counted: this tab's node is stopped.",
    },
  },
  {
    id: 'byo/failures', // Y10 — `nodeId` and `reason`, the fabric's own words, verbatim
    surface: 'byo',
    kind: 'reading',
    source: 'TabApi.runJob().failures',
    absence: {
      initial: 'No refusals: no job has been submitted from this form.',
      stopped: "No refusals: this tab's node is stopped.",
      unavailable: 'No refusals: every shard reached agreement.',
    },
  },
  {
    id: 'byo/attestation', // Y11
    surface: 'byo',
    kind: 'reading',
    source: 'TabApi.runJob().attestation',
    absence: {
      initial: 'Not established: no job has been submitted from this form.',
      stopped: "Not established: this tab's node is stopped.",
      // Unavailable: section 5.1's absence arm. Dynamic, as C15.
    },
  },
  {
    id: 'byo/egress', // Y12 — one region, count and sentence together. Splitting is P7's plant.
    surface: 'byo',
    kind: 'reading',
    // The one place in this demo where a non-empty `violations` list can appear, because
    // this is the one path that can carry `sovereign`.
    source: 'TabApi.runJob().egress',
    absence: {
      initial: 'Nothing measured: nothing has left this device for this job yet.',
      stopped: "Nothing measured: this tab's node is stopped.",
    },
  },
  {
    id: 'byo/sovereign-label', // Y13
    surface: 'byo',
    kind: 'reading',
    source: 'TabApi.runJob().egress — whether the submitted job carried sovereign',
    absence: {
      initial: 'Not dispatched: no job has been submitted from this form.',
      stopped: "Not dispatched: this tab's node is stopped.",
    },
  },

  // =====================================================================================
  // Fabric state — 21 regions. UI-SPEC section 4.6.
  // "The surface with no workload of its own: it renders the cross-cutting readings."
  // =====================================================================================
  {
    id: 'fabric/peers-all', // F1
    surface: 'fabric',
    kind: 'reading',
    source: 'TabApi.peers().length',
    absence: {
      initial: 'Not counted: no discovery round has run.',
      stopped: "Not counted: this tab's node is stopped.",
      // Unavailable: the thrown message. Dynamic.
    },
  },
  {
    id: 'fabric/compute-peers', // F2 — "as F1"
    surface: 'fabric',
    kind: 'reading',
    source: 'TabApi.computePeers().length',
    absence: {
      initial: 'Not counted: no discovery round has run.',
      stopped: "Not counted: this tab's node is stopped.",
    },
  },
  {
    id: 'fabric/held-peers', // F3 — "as F1"
    surface: 'fabric',
    kind: 'reading',
    source: 'TabApi.heldPeers().length',
    absence: {
      initial: 'Not counted: no discovery round has run.',
      stopped: "Not counted: this tab's node is stopped.",
    },
  },
  {
    id: 'fabric/peer-rows', // F4
    surface: 'fabric',
    kind: 'reading',
    source: 'TabApi.heldPeers().peer with .carriesWork',
    absence: {
      initial: 'No peers held: no discovery round has run.',
      stopped: "No peers held: this tab's node is stopped.",
      unavailable: 'No peers held: this tab holds no connection to another node.',
    },
  },
  {
    id: 'fabric/relayed-only', // F5
    surface: 'fabric',
    kind: 'reading',
    source: 'TabApi.connectDiscoveredPeers().relayedOnly with .stalled',
    absence: {
      initial: 'Not known: no discovery round has run.',
      stopped: "Not known: this tab's node is stopped.",
      unavailable: 'Every peer this tab holds can carry a job.',
    },
  },
  {
    id: 'fabric/attestation-strength', // F6
    surface: 'fabric',
    kind: 'reading',
    // "last run's attestation" — whichever run in this tab produced the most recent
    // receipt. `runColouring` is the path a visitor reaches first and is named here;
    // `runJob` carries the identical field and feeds the same region.
    source: 'TabApi.runColouring().attestation.strength',
    absence: {
      initial: 'Not established: no job has been run in this tab.',
      stopped: "Not established: this tab's node is stopped.",
      // Unavailable: section 5.1. Dynamic.
    },
  },
  {
    id: 'fabric/attestation-description', // F7 — verbatim, and the page adds nothing to it
    surface: 'fabric',
    kind: 'reading',
    source: 'TabApi.runColouring().attestation.description',
    absence: {
      initial: 'Not established: no job has been run in this tab.',
      stopped: "Not established: this tab's node is stopped.",
      // Unavailable: section 5.1's `reason`, verbatim. Dynamic — and it is peer-supplied,
      // which is why `render.ts` writes it with `textContent`.
    },
  },
  {
    id: 'fabric/attestation-counts', // F8
    surface: 'fabric',
    kind: 'reading',
    source: 'TabApi.runColouring().attestation.replicas with .operators and .sharedRelay',
    absence: {
      initial: 'Not established: no job has been run in this tab.',
      stopped: "Not established: this tab's node is stopped.",
      // Unavailable: the absence arm's `.agreeing` and `.verified`. Dynamic.
    },
  },
  {
    id: 'fabric/egress-frames', // F9
    surface: 'fabric',
    kind: 'reading',
    source: 'TabApi.runColouring().egress.entries.length',
    absence: {
      initial: 'Nothing measured: no job has been run in this tab.',
      stopped: "Nothing measured: this tab's node is stopped.",
    },
  },
  {
    id: 'fabric/egress-bytes', // F10 — "as F9"
    surface: 'fabric',
    kind: 'reading',
    source: 'TabApi.runColouring().egress.totalBytes',
    absence: {
      initial: 'Nothing measured: no job has been run in this tab.',
      stopped: "Nothing measured: this tab's node is stopped.",
    },
  },
  {
    id: 'fabric/egress-withheld', // F11 — figure and sentence in ONE region. Splitting is P7's plant.
    surface: 'fabric',
    kind: 'reading',
    source: 'TabApi.runColouring().egress.violations',
    absence: {
      initial: 'Nothing measured: no job has been run in this tab.',
      stopped: "Nothing measured: this tab's node is stopped.",
    },
  },
  {
    id: 'fabric/duty-user', // F12
    surface: 'fabric',
    kind: 'reading',
    source: 'TabApi.capacity().dutyCycle',
    absence: {
      // UI-SPEC's F12 "before any reading" cell is the stopped sentence itself, and its
      // stopped cell reads "as F12". Transcribed as written.
      initial: "Not read: this tab's node is stopped.",
      stopped: "Not read: this tab's node is stopped.",
      // Unavailable: the thrown message. Dynamic.
    },
  },
  {
    id: 'fabric/slots', // F13 — "as F12"
    surface: 'fabric',
    kind: 'reading',
    source: 'TabApi.capacity().slots',
    absence: {
      initial: "Not read: this tab's node is stopped.",
      stopped: "Not read: this tab's node is stopped.",
    },
  },
  {
    id: 'fabric/governor-hidden', // F14 — "as F12"
    surface: 'fabric',
    kind: 'reading',
    source: 'TabApi.governor().hidden',
    absence: {
      initial: "Not read: this tab's node is stopped.",
      stopped: "Not read: this tab's node is stopped.",
    },
  },
  {
    id: 'fabric/governor-duty', // F15 — "as F12"
    surface: 'fabric',
    kind: 'reading',
    source: 'TabApi.governor().dutyCycle',
    absence: {
      initial: "Not read: this tab's node is stopped.",
      stopped: "Not read: this tab's node is stopped.",
    },
  },
  {
    id: 'fabric/governor-transitions', // F16 — "as F12"
    surface: 'fabric',
    kind: 'reading',
    source: 'TabApi.governor().transitions with .sleptMs',
    absence: {
      initial: "Not read: this tab's node is stopped.",
      stopped: "Not read: this tab's node is stopped.",
    },
  },
  {
    id: 'fabric/isolation', // F17
    surface: 'fabric',
    kind: 'reading',
    source: 'TabApi.isolation().crossOriginIsolated with .hasSharedArrayBuffer and .inIframe',
    absence: {
      // COMPOSED, and flagged rather than passed off as a transcription. UI-SPEC's F17 cells
      // read "always readable — three booleans, no node needed" and "unchanged" — a
      // description of the row, not a sentence for the screen. This reading needs no node,
      // so the sentence below is on screen only in the moment before the first read; it
      // exists because every reading needs an absence to paint before it has a reading.
      initial: "Not read: the page has not yet taken this tab's isolation reading.",
      stopped: "Not read: the page has not yet taken this tab's isolation reading.",
    },
  },
  {
    id: 'fabric/start-reached', // F18
    surface: 'fabric',
    kind: 'reading',
    source: 'TabApi.startReport().reached with .asked',
    absence: {
      // UI-SPEC's F18 "before any reading" cell quotes `Not asked yet.` and attributes it to
      // `#report`'s initial string. **`#report`'s actual literal is `not asked yet` —
      // lowercase, no full stop** — and it must stay that way, because `peer-ledger.e2e.test.ts`
      // and `two-tabs.e2e.test.ts` both wait on `textContent !== 'not asked yet'`. That
      // element is `fabric/start-outcome-text`, a text view, and it is NOT this region. This
      // region is the figure, and it takes UI-SPEC's sentence.
      initial: 'Not asked yet.',
      // COMPOSED: UI-SPEC's stopped cell describes the state — "readable with no node:
      // `asked` is zero and the copy says *nobody was asked*" — rather than quoting a
      // sentence.
      stopped: 'Nobody was asked: no peer has been asked for a start outcome.',
      unavailable: 'Asked, and no peer answered.',
    },
  },
  {
    id: 'fabric/start-tallies', // F19
    surface: 'fabric',
    kind: 'reading',
    source: 'TabApi.startReport().byBrowser',
    absence: {
      initial: 'Not asked yet.',
      // COMPOSED: UI-SPEC's F19 stopped cell reads "as F18", whose own cell is a
      // description. Same sentence as F18's, for the same reason.
      stopped: 'Nobody was asked: no peer has been asked for a start outcome.',
      unavailable: 'No rows: no node has reported an outcome.',
    },
  },
  {
    id: 'fabric/blocks', // F20
    surface: 'fabric',
    kind: 'reading',
    source: 'TabApi.storedBlocks() with activity().fetched and .rejected',
    absence: {
      // UI-SPEC's F20 "before any reading" cell is the stopped sentence; its stopped cell
      // reads "same".
      initial: "Not counted: this tab's node is stopped.",
      stopped: "Not counted: this tab's node is stopped.",
      // Unavailable: the thrown message. Dynamic.
    },
  },
  {
    id: 'fabric/addresses', // F21
    surface: 'fabric',
    kind: 'reading',
    source: 'TabApi.addresses().peerId with .webrtc and .circuit',
    absence: {
      initial: "No addresses: this tab's node is stopped.",
      stopped: "No addresses: this tab's node is stopped.",
      unavailable: 'No dialable address: the relay has produced no reservation.',
    },
  },

  // =====================================================================================
  // Benchmarks — 2 region groups, all `cited`. UI-SPEC section 4.7.
  // "Renders the committed figures of docs/perf/prime-and-pi-benchmarks.md. Blocks nothing,
  // reads nothing, and must never look like a live reading."
  //
  // The guard resolves both paths on disk: a citation naming a document that is not
  // committed is a citation of nothing.
  // =====================================================================================
  {
    id: 'bench/speedup', // K1
    surface: 'bench',
    kind: 'cited',
    source: 'docs/perf/prime-and-pi-benchmarks.md section 5 — Real parallel speedup',
  },
  {
    id: 'bench/overhead', // K2
    surface: 'bench',
    kind: 'cited',
    source:
      'docs/perf/prime-and-pi-benchmarks.md sections 2, 3 and 4 — decomposition cost, cold instantiate, fabric overhead',
  },

  // =====================================================================================
  // Text views — NOT part of the 91. UI-SPEC section 2.2: each surface carries exactly one
  // `<pre class="text-view">`, and the view toggle can never hide one.
  //
  // Benchmarks has none, deliberately: nothing there is a reading, so there is no reading to
  // render twice.
  // =====================================================================================
  {
    id: 'colouring/run-report',
    surface: 'colouring',
    kind: 'text-view',
    // The historical id, never renamed. `attestation-ui.e2e.test.ts` reads eleven distinct
    // substrings out of it and `colouring-demo.e2e.test.ts` four more.
    source: 'the #run-report text view — the colouring run, rendered as lines',
  },
  {
    id: 'colouring/verify-report',
    surface: 'colouring',
    kind: 'text-view',
    source: 'the #verify-report text view — TabApi.verifyAnswer(), rendered as lines',
  },
  {
    id: 'primes/report',
    surface: 'primes',
    kind: 'text-view',
    source: 'the #primes-report text view',
  },
  {
    id: 'pi/report',
    surface: 'pi',
    kind: 'text-view',
    source: 'the #pi-report text view',
  },
  {
    id: 'byo/report',
    surface: 'byo',
    kind: 'text-view',
    source: 'the #byo-report text view',
  },
  {
    id: 'fabric/report',
    surface: 'fabric',
    kind: 'text-view',
    source: 'the #fabric-report text view',
  },
  {
    id: 'fabric/start-outcome-text',
    surface: 'fabric',
    kind: 'text-view',
    // The existing `#report`. Its initial literal is `not asked yet` — lowercase, no full
    // stop — and it must stay that way: `peer-ledger.e2e.test.ts` and `two-tabs.e2e.test.ts`
    // both wait on `textContent !== 'not asked yet'`, so a page rendering UI-SPEC's
    // `Not asked yet.` would satisfy that wait immediately and both specs would read a panel
    // that had not been refreshed.
    source: 'the #report text view — describeStartReport() output, reformatted by nobody',
  },

  // =====================================================================================
  // Prose — NOT part of the 91.
  //
  // A digit inside a sentence is legitimate and it is still declared. Without these entries
  // *wrap it in a paragraph* is the loophole that makes the no-undeclared-digit property
  // unenforceable, and `#main` already carries four such sentences.
  //
  // **Every one of these six was found by running the guard's P2 against the page**, not by
  // reading the markup. Reading found four of them; P2 found six, and then found a seventh
  // after its own truncation defect was fixed. Two of the three the reading missed are the
  // interesting ones — `2-colouring` in a surface kicker, and `v2` in a protocol name — and
  // they are why the rule is over glyphs rather than over anything a person is asked to spot.
  //
  // Each `source` names where its number comes from.
  // =====================================================================================
  {
    id: 'session/prose-explain',
    surface: 'session',
    kind: 'prose',
    // `v2` in "Circuit Relay v2", and `o2` in "o2 seed". Both are names, and a name with a
    // digit in it is still a digit on screen.
    source:
      'the version number in the Circuit Relay protocol name, and the name of this project',
  },
  {
    id: 'colouring/prose-kicker',
    surface: 'colouring',
    kind: 'prose',
    // `2` in "2-colouring".
    source: 'the number of colours a 2-colouring uses, which is what the word means',
  },
  {
    id: 'colouring/prose-problem',
    surface: 'colouring',
    kind: 'prose',
    // `1` in "from 1 to N", and the superscripts in `a² + b² = c²`.
    source:
      'the definition of a Pythagorean triple, and the lower bound of the range being coloured',
  },
  {
    id: 'colouring/prose-bound',
    surface: 'colouring',
    kind: 'prose',
    // `7824`, `7825`, `200-terabyte`.
    source:
      'the published bound on the Boolean Pythagorean triples problem and the size of the proof that settled it',
  },
  {
    id: 'byo/prose-lift-target',
    surface: 'byo',
    kind: 'prose',
    // `64` in AArch64.
    source: 'the name of the instruction set architecture the lift pipeline reads',
  },
  {
    id: 'bench/prose-provenance',
    surface: 'bench',
    kind: 'prose',
    // `27-09` in "Plan 27-09". A planning identifier quoted on a visitor-facing page is odd
    // copy and it is Plan 27-09's to replace when it lands this surface's figures; it is
    // declared here rather than reworded, because rewording another plan's surface to make
    // this plan's guard green is the failure this guard exists to prevent, one level up.
    source: 'the identifier of the plan that transcribes this surface\'s committed figures',
  },
]
