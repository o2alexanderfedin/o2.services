/**
 * The colouring surface's formatter — UI-SPEC section 4.2, C1 through C21.
 *
 * ## One reading, one record, both views
 *
 * {@link format} takes the ladder's outcomes and returns a {@link SurfaceRender}: a record of
 * already-formatted strings for the rendered regions, and the text view's lines. **Both come
 * out of one pass over one reading**, so the same value cannot be formatted twice differently.
 * That is UI-SPEC section 2.2's rule and it is the same argument `TabColouringRun.attestation`
 * makes about the CLI and this page — two formatters of one value are two things that can come
 * to disagree.
 *
 * Where a value appears in both views it is computed **once** and referenced twice: `cost`,
 * `bestN`, `counts`, `placement`, `attLines` and `egress` below are each a single binding used
 * by the region and by the line. The one deliberate difference is *extent* rather than
 * formatting — the text view prints the first eight placement lines and says how many more
 * there are, exactly as it did before this plan, while the region prints them all. The strings
 * themselves come from one function either way.
 *
 * ## The text view is a MOVE, not a rewrite
 *
 * Every line {@link format} pushes into `text` was lifted out of `index.html`'s `#run` handler
 * unchanged — wording, spacing, padding and the comments that carry the reasoning. It has to
 * be: `attestation-ui.e2e.test.ts` reads eleven distinct substrings out of `#run-report` and
 * `colouring-demo.e2e.test.ts` four more, and beyond the guards, the lines are what a visitor
 * reads. A difference here is a difference in what the page says.
 *
 * ## No DOM, no globals
 *
 * Nothing in this file touches `document`, `window` or `window.o2`. It is callable from a unit
 * context, and the DOM writing is `../render.ts`'s job. There is no `innerHTML` here and there
 * must not be: every string below can carry a peer id, a thrown message or a kernel's refusal
 * reason, and `render.ts`'s header states why *verbatim* is the word that makes `innerHTML`
 * look correct and is not.
 *
 * ## The two sentences this file composes, flagged rather than passed off as transcription
 *
 * {@link NO_RUNG_ATTESTATION} and {@link NO_RUNG_EGRESS}. UI-SPEC gives C15 and C17 no fixed
 * unavailable sentence — C15's is "section 5.1's absence arm", composed by the kernel from a
 * receipt, and C17's column is empty — so when the ladder settles no rung at all there is no
 * receipt and no manifest to read, and no catalogue sentence for the state. Rendering the
 * `initial` sentence there would say *the search has not been run* immediately after running
 * it, which is the exact class of untruth this phase exists to remove. Both are marked COMPOSED
 * and logged in `deferred-items.md`.
 */

import { DEFAULT_BUDGET, MAX_N, buildInput } from '@o2/demo'
import { REGIONS } from '../../src/demo-regions.ts'
import type { Region } from '../../src/demo-regions.ts'
import type { TabColouringRun, TabVerification } from '../../src/tab-api.ts'
import { describeQuorum } from '@o2/core'
import { attestationLines, egressLines, quorumLines } from '../render.ts'
import type { SurfaceRender } from '../render.ts'

/** Measured rungs, moved here with the handler. The wall is real and moves with cube count. */
export const LADDER: readonly number[] = [300, 400, 500, 600]

/**
 * COMPOSED — see this file's header. C15 has no catalogue sentence for "the ladder settled
 * nothing", because UI-SPEC's unavailable arm for it is a receipt the kernel writes.
 */
const NO_RUNG_ATTESTATION =
  'Not established: the fabric settled no rung, so no run produced a receipt to read.'

/** COMPOSED — see this file's header. C17's unavailable column in UI-SPEC is empty. */
const NO_RUNG_EGRESS =
  'Not read: the fabric settled no rung, so no manifest was read back for this workload.'

/**
 * One rung of the ladder, as the page observed it.
 *
 * Exactly one of `run` and `error` is present. A rung that threw carries the thrown message
 * and nothing else — never a zero, never an empty run — because a refusal rendered as a count
 * is indistinguishable from a rung that genuinely found nothing.
 */
export interface RungOutcome {
  readonly n: number
  readonly run?: TabColouringRun
  readonly error?: string
}

/** Everything the two views are written from. No DOM, no node, no `window.o2`. */
export interface ColouringState {
  /** `computePeers().length` at dispatch — what C1 and C2 are derived from. */
  readonly peers: number
  /** The rungs attempted, in ladder order. Stops where the ladder stopped. */
  readonly rungs: readonly RungOutcome[]
}

/**
 * More peers, more cubes. **This is the whole arc**: a cube fixes the most constrained
 * numbers, so cubes are not merely parallelism — they are how far the search reaches.
 *
 * Exported so the page dispatches with the same expression C1 displays. Two copies of this
 * formula would be two things that can disagree about what the page said it would send.
 */
export function cubesFor(peers: number): number {
  return 8 * (1 + peers)
}

/** The redundancy the page will send — `min(2, 1 + peers)`. C2 displays this expression. */
export function redundancyFor(peers: number): number {
  return Math.min(2, 1 + peers)
}

const CATALOGUE: ReadonlyMap<string, Region> = new Map(REGIONS.map((region) => [region.id, region]))

/**
 * The catalogue's sentence for a region in one of its three states.
 *
 * Read from `../../src/demo-regions.ts` and never written here: a sentence held in two places
 * is two sentences that can drift, and section 11's copywriting contract is the catalogue's to
 * carry. A missing arm throws rather than falling back — a fallback is how a region comes to
 * render a sentence nobody wrote.
 */
function absence(id: string, state: 'initial' | 'stopped' | 'unavailable'): string {
  const region = CATALOGUE.get(id)
  if (region?.absence === undefined) {
    throw new Error(`colouring: "${id}" holds no absence copy in the catalogue`)
  }
  const sentence =
    state === 'initial'
      ? region.absence.initial
      : state === 'stopped'
        ? region.absence.stopped
        : region.absence.unavailable
  if (sentence === undefined) {
    throw new Error(`colouring: "${id}" has no ${state} arm in the catalogue`)
  }
  return sentence
}

/**
 * The colouring readings that go back to a named absence when the node stops.
 *
 * C18 through C21 are **excluded, and the exclusion is UI-SPEC section 5.4's**: `verifyAnswer()`
 * needs no node, no peer and no network, so a verdict already on screen is still true with the
 * fabric stopped. `colouring-demo.e2e.test.ts` presses `#verify` *after* stopping the node and
 * reads the report, and copy saying the node is stopped would contradict the one control on
 * this page that works disconnected.
 */
export const COLOURING_STOP_ABSENCE_IDS: readonly string[] = REGIONS.filter(
  (region) =>
    region.surface === 'colouring' &&
    region.kind === 'reading' &&
    !region.id.startsWith('colouring/verify-'),
).map((region) => region.id)

/**
 * C3, C4 and C5 — always present, never described as a result.
 *
 * C5 is computed **in-page from the shipped builder** rather than written down, and is labelled
 * on screen with the expression it came from. A transcribed byte count is a number nobody
 * recomputes when the builder changes.
 */
export function formatConstants(): Readonly<Record<string, string>> {
  return {
    'colouring/budget': String(DEFAULT_BUDGET),
    'colouring/max-n': String(MAX_N),
    'colouring/input-bytes': String(buildInput(MAX_N, DEFAULT_BUDGET).length),
  }
}

/**
 * C1 and C2 — the arguments the page *would* send, on screen before anything is dispatched.
 *
 * They are `control` regions rather than readings: nothing has been asked of the fabric yet, so
 * there is nothing to read. What they make visible is *more peers, more cubes*, before a visitor
 * presses anything.
 */
export function formatArgs(peers: number): Readonly<Record<string, string>> {
  return {
    'colouring/cubes-arg': String(cubesFor(peers)),
    'colouring/redundancy-arg': String(redundancyFor(peers)),
  }
}

/** The last rung that settled — `best` throughout UI-SPEC section 4.2. */
export function bestOf(state: ColouringState): TabColouringRun | null {
  let best: TabColouringRun | null = null
  for (const outcome of state.rungs) {
    if (outcome.run === undefined) break
    if (!outcome.run.found) break
    best = outcome.run
  }
  return best
}

/** `found` / `exhausted` / `budget`, counted once and rendered by both views. */
function countsOf(run: TabColouringRun): { found: number; exhausted: number; unknown: number } {
  return {
    found: run.statuses.filter((s) => s === 'found').length,
    exhausted: run.statuses.filter((s) => s === 'exhausted').length,
    unknown: run.statuses.filter((s) => s === 'budget').length,
  }
}

/** C11's string, and the tail of every rung line in the text view. Formatted once. */
function countsLine(counts: { found: number; exhausted: number; unknown: number }): string {
  return `${counts.found} found · ${counts.exhausted} proved empty · ${counts.unknown} out of budget`
}

/**
 * One cube's placement, formatted once for C16 and for the text view.
 *
 * `no agreement` where the array is empty, and **never a number in its place** — a zero here
 * would read as a count of agreeing nodes rather than as the absence of agreement.
 */
function placementLine(who: readonly string[], index: number): string {
  return `cube ${index}: ${who.length === 0 ? 'no agreement' : who.join(' + ')}`
}

/**
 * A swatch and its word, per cube — C10.
 *
 * **Colour is never the only carrier.** The glyph is a shape rather than a hue, and the status
 * word sits beside it in every cell, so the reading survives a monochrome screen, a screen
 * reader and a colour-blind visitor. `budget` is a distinct shape from `exhausted` for the same
 * reason the fabric keeps them distinct values: collapsing them would turn a shortage of search
 * into a mathematical claim.
 */
const SWATCH: Readonly<Record<string, string>> = {
  found: '■',
  exhausted: '□',
  budget: '▧',
}

function cubeGrid(statuses: readonly string[]): string {
  return statuses.map((status) => `${SWATCH[status] ?? '·'} ${status}`).join(' · ')
}

/**
 * How much of a handle is shown — enough to recognise, not enough to retype.
 *
 * A CID is 59 characters and there are two of them in C23. Shown whole they would be the
 * longest thing on the surface and would read as noise; shown as *a checkpoint* with no
 * identifier at all, a visitor could not tell the handle this run was offered from the one it
 * left behind, which is the single most informative thing about a resumed run.
 */
const HANDLE_SHOWN = 12
function shortHandle(cid: string): string {
  return cid.length <= HANDLE_SHOWN ? cid : `${cid.slice(0, HANDLE_SHOWN)}…`
}

/**
 * C23 — whether this run picked up where an earlier one stopped. CHURN-03's read half.
 *
 * **Four arms, because `TabResume` carries four facts that do not reduce to one.** *Nothing
 * was stored* and *something was stored and refused* both produce a run that computed every
 * cube, and only the second says this tab's storage was holding a pointer to blocks that are
 * gone. A boolean over them would render the same sentence for a healthy first visit and for
 * an eviction.
 *
 * **The count comes from `carried`, which is counted off the shards, never from `offered`.**
 * `main.ts` counts `ending === 'carried-from-checkpoint'` on `submitJob`'s own answer, so this
 * sentence reports what the fabric did rather than what the page asked for. The two disagree
 * exactly when a checkpoint named fewer shards than the pointer promised, which is the case a
 * page must not paper over.
 *
 * The second line is always present and always says something: what the *next* run of this job
 * will be offered. A resume the visitor cannot see coming is as invisible as one they cannot
 * see happening.
 */
export function resumeLines(run: TabColouringRun): string[] {
  const { offered, refused, carried, remembered } = run.resume
  const first =
    refused !== null
      ? `Started over: a stored checkpoint was refused (${refused}) and dropped, so every cube ran.`
      : offered === null
        ? 'Started from nothing: this tab had stored no checkpoint for this job.'
        : `Resumed from ${shortHandle(offered)}: ${carried} of ${run.cubes} cube(s) came out of it ` +
          'and were dispatched nowhere.'
  const second =
    remembered === null
      ? 'Nothing stored for a next run: this run confirmed no handle.'
      : `Stored for a next run: ${shortHandle(remembered)}`
  return [first, second]
}

/**
 * The whole colouring surface, from the ladder's outcomes — C1 through C17, C22, C23 and the
 * text view.
 *
 * *(Read "C1 through C17" until 2026-08-17. It was already false when C22 landed on 2026-08-14
 * and is corrected here rather than left, because the count below is what the sentence is for.
 * `colouring-surface.node.test.ts` derives the set from `REGIONS` and has been asserting the
 * real one throughout — the comment drifted, not the code.)*
 *
 * Every one of the nineteen is in the returned record in every state, so nothing is left
 * holding a value from a previous run: a region with no reading carries its named absence, and
 * a rung the ladder never reached says so in the catalogue's words rather than staying at
 * whatever was last painted there. A stale reading is a placeholder that used to be true.
 */
export function format(state: ColouringState): SurfaceRender {
  const cubes = cubesFor(state.peers)
  const best = bestOf(state)
  const regions: Record<string, string> = {
    ...formatConstants(),
    ...formatArgs(state.peers),
  }

  // ---- the text view, moved out of `index.html`'s `#run` handler unchanged ----
  const text: string[] = [`${state.peers} peer(s) · ${cubes} cubes per rung`, '']

  const attempted = new Map<number, RungOutcome>()
  for (const outcome of state.rungs) attempted.set(outcome.n, outcome)

  for (const outcome of state.rungs) {
    const run = outcome.run
    if (run === undefined) {
      const message = outcome.error ?? 'the rung threw and no message was captured'
      text.push(`n = ${outcome.n}: ${message}`)
      continue
    }
    const counts = countsOf(run)
    text.push(
      `n = ${String(outcome.n).padStart(4)}  ${run.found ? 'FOUND   ' : 'no answer'}  ` +
        `${countsLine(counts)}  ` +
        `${Math.round(run.elapsedMs)}ms`,
    )
    if (!run.found) {
      // 'budget' means "I ran out of steps", not "there is none". Saying so
      // is the difference between a limit and a claim.
      text.push('', `Stopped here. ${counts.unknown} cube(s) ran out of steps — that is a`)
      text.push('shortage of search, not a proof that no colouring exists.')
    }
  }

  // ---- C6 through C9, one region per rung of the ladder ----
  for (const n of LADDER) {
    const id = `colouring/rung-${n}`
    const outcome = attempted.get(n)
    if (outcome === undefined) {
      // The ladder stopped before this rung. C9 is the only one UI-SPEC gives this sentence
      // to, and it is the right sentence for any un-attempted rung — C7 and C8 read "as C6"
      // in every column, so the catalogue holds no arm of their own for a state that is not
      // C6's. One sentence, named once, rather than three that could drift.
      regions[id] = absence('colouring/rung-600', 'unavailable')
      continue
    }
    if (outcome.run === undefined) {
      // Section 11's error state. The fabric's words, verbatim, with the page adding only the
      // prefix that says a run stopped rather than that a rung was never tried.
      regions[id] = `The run stopped: ${outcome.error ?? 'the rung threw and no message was captured'}`
      continue
    }
    const counts = countsOf(outcome.run)
    regions[id] =
      `${outcome.run.found ? 'FOUND' : 'no answer'} · ${countsLine(counts)} · ` +
      `${Math.round(outcome.run.elapsedMs)}ms`
  }

  if (best === null) {
    regions['colouring/cube-grid'] = absence('colouring/cube-grid', 'unavailable')
    regions['colouring/status-counts'] = absence('colouring/status-counts', 'unavailable')
    regions['colouring/best-n'] = absence('colouring/best-n', 'unavailable')
    regions['colouring/complete'] = absence('colouring/complete', 'unavailable')
    regions['colouring/verification-multiplier'] = absence(
      'colouring/verification-multiplier',
      'unavailable',
    )
    regions['colouring/agreeing'] = absence('colouring/agreeing', 'unavailable')
    regions['colouring/attestation'] = NO_RUNG_ATTESTATION
    regions['colouring/egress'] = NO_RUNG_EGRESS
    // C22 takes its sentence from the catalogue rather than a COMPOSED constant, because
    // unlike C15 and C17 this region has one: "no rung settled" is a state that existed
    // when C22 was written, so its `unavailable` arm was written for it.
    regions['colouring/quorum'] = absence('colouring/quorum', 'unavailable')
    // C23 takes its sentence from the catalogue on C22's terms — "no rung settled" is a state
    // that existed when C23 was written, so its `unavailable` arm was written for it.
    regions['colouring/resume'] = absence('colouring/resume', 'unavailable')
    return { regions, text }
  }

  // One binding per value, referenced by the region and by the line. This is what P6 asserts
  // and it is why nothing below re-formats anything above it.
  const counts = countsOf(best)
  const bestN = String(best.n)
  const cost = `${best.verificationMultiplier.toFixed(2)}×`
  const placement = best.agreeing.map(placementLine)
  const attLines = attestationLines(best.attestation)
  const quoLines = quorumLines(best.quorum)
  const egress = egressLines(best.egress)
  // C23. One binding, read by the region and by the text view below — P6's rule, and the
  // reason nothing below re-formats anything above it.
  const resume = resumeLines(best)

  text.push('')
  text.push(`Best settled: n = ${bestN}, every cube agreed: ${best.complete}`)
  // VER-06. Gross fuel over useful fuel — measured, correct at any redundancy,
  // and the half of the old line that was never in doubt.
  text.push(`Verification cost ${cost}.`)
  text.push(...attLines)
  // VER-03, VER-04 — directly under the attestation lines, because the two answers are
  // most useful side by side and most misleading apart: one says who signed, the other
  // says who was *allowed to be asked*. A run can read `owner-domain` with a quorum the
  // composer refused, and that pairing is the honest picture of a single-relay fabric.
  text.push(...quoLines)
  text.push('')
  text.push('Where the last rung ran:')
  text.push(...placement.slice(0, 8).map((line) => `  ${line}`))
  if (placement.length > 8) text.push(`  … and ${placement.length - 8} more`)
  text.push(...egress)
  // CHURN-03, directly under the egress lines and above the invitation to check the answer,
  // because it is the last thing that is true *about this run* — everything below it is about
  // what the visitor does next. A resumed run also explains, on its own terms, why the
  // attestation lines above it read weaker than a visitor expects: a carried cube was
  // dispatched to nobody, so this requestor holds no signature over it from anybody.
  text.push('', ...resume)
  text.push('', 'This answer has not been checked. The button below checks it.')

  regions['colouring/cube-grid'] = cubeGrid(best.statuses)
  regions['colouring/status-counts'] = countsLine(counts)
  regions['colouring/best-n'] = bestN
  regions['colouring/complete'] = String(best.complete)
  regions['colouring/verification-multiplier'] = cost
  regions['colouring/agreeing'] = placement.join('\n')
  // **The page composes no sentence of its own here.** The receipt arm is the kernel's
  // `description` field and nothing else — not the two-line block the text view carries, which
  // adds the replica counts around it, because UI-SPEC section 5.1 asks for the sentence
  // verbatim and P8 compares this region against a fresh reading of the same field. The absence
  // arm is `attestationLines`' own output, which ends in `attestation.reason` verbatim.
  regions['colouring/attestation'] =
    'kind' in best.attestation ? attLines.join('\n') : best.attestation.description
  // **The kernel's sentence verbatim, with no prefix**, on exactly C15's arrangement above:
  // the text view carries the "How was the quorum chosen:" lead-in, the region carries the
  // composer's own words alone, and both come from one `describeQuorum` so the two views
  // cannot drift. The refusal *kind* is inside that string — `[shared-relay-dependency]`,
  // `[insufficient-operators]` — which is what makes this region assertable by a test
  // rather than merely readable by a person.
  regions['colouring/quorum'] = describeQuorum(best.quorum)
  // **ONE region, count and sentence together** — UI-SPEC section 5.2. `0 withheld` alone
  // reads as a sovereignty proof and would be a lie by omission, so the figure and the
  // sentence explaining it come out of one call to one function and cannot be separated by
  // anything that renders them.
  regions['colouring/egress'] = egress.join('\n').trim()
  // **ONE region, the count and its sentence together**, on C17's rule directly above and for
  // the same reason: `0 of 8` alone reads as a failed resume on a first visit where there was
  // nothing to resume, and a handle alone says nothing about whether it was used.
  regions['colouring/resume'] = resume.join('\n')

  return { regions, text }
}

/**
 * C18 through C21, and `#verify-report` — UI-SPEC section 5.4's card.
 *
 * **The card is not disabled with the fabric stopped and its copy never says the node is.**
 * `verifyAnswer()` needs no node, no peer and no network; saying otherwise would misdescribe
 * the one control on this page that works disconnected, and `colouring-demo.e2e.test.ts`
 * presses it in exactly that state.
 */
export function formatVerification(verdict: TabVerification): SurfaceRender {
  if (!verdict.checked) {
    return {
      regions: {
        'colouring/verify-verdict': absence('colouring/verify-verdict', 'initial'),
        'colouring/verify-n': absence('colouring/verify-n', 'initial'),
        'colouring/verify-triples': absence('colouring/verify-triples', 'initial'),
        'colouring/verify-violation': absence('colouring/verify-violation', 'initial'),
      },
      // The existing literal, unchanged.
      text: ['nothing to check yet'],
    }
  }

  const line = verdict.ok
    ? `Correct. ${verdict.triplesChecked} Pythagorean triples up to ${verdict.n} were ` +
      're-derived here and every one has two colours among its three numbers.'
    : `REFUTED. ${verdict.violation} is all one colour.`

  return {
    regions: {
      // The same two words the line above leads with, so the card and its text view use one
      // vocabulary for one verdict.
      'colouring/verify-verdict': verdict.ok ? 'Correct' : 'REFUTED',
      'colouring/verify-n': String(verdict.n),
      'colouring/verify-triples': String(verdict.triplesChecked),
      'colouring/verify-violation':
        verdict.violation === null
          ? absence('colouring/verify-violation', 'unavailable')
          : verdict.violation,
    },
    text: [line],
  }
}
