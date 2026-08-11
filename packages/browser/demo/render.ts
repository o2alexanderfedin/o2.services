/**
 * The region writer — the one thing that puts a figure or a named absence on screen.
 *
 * ## `textContent`, never `innerHTML`, and the reason the mistake is tempting
 *
 * The strings this writer carries include `attestation.description`, `attestation.reason`,
 * `TabPiRun.reduceReason` and `TabJobReport.failures[].reason`. Every one of them is
 * produced by a peer this tab does not control, and every one of them is rendered
 * **verbatim** by contract — UI-SPEC section 5.1 and section 11 both say so, because the
 * page has no better words for a refusal than the fabric's own.
 *
 * *Verbatim* is exactly the word that makes `innerHTML` look correct. It is not. **Verbatim
 * into `textContent` is a quotation; verbatim into `innerHTML` is an injection.** A peer
 * that can name itself in a refusal reason can name itself with a `<script>` in it, and the
 * contract that says the page must not paraphrase is not a licence to let the string choose
 * its own markup. Nothing in this file assigns `innerHTML`, and nothing in any surface
 * module this phase writes may either; a grep gate over the render path holds it.
 *
 * ## Stopped wins
 *
 * When `activity() === null`, **every** reading region paints its `stopped` sentence —
 * including the readings that are safe to call with no node (`discoverRelays`,
 * `verifyAnswer`, `isolation`, `startReport`). The alternative, letting a safe reading paint
 * an `unavailable` arm while the node is stopped, would make the guard's expectation depend
 * on which readings happen to be safe: P3 would then have to accept two sentences per
 * region, and a property that accepts two answers is most of the way to accepting any. The
 * `unavailable` arms are reached from the running state.
 *
 * One consequence, recorded rather than left to be discovered: `session/relay`'s
 * `unavailable` arm — *No relay: this page was served by a static host, which runs none.* —
 * is currently unreachable, because a page with no relay cannot start a node, so
 * `activity()` is null in every state in which that sentence would be true.
 *
 * ## `data-absence` is a mirror, never an expectation
 *
 * {@link paintAbsence} writes the sentence into `textContent` **and** onto the element's
 * `data-absence` attribute, so a reader inspecting the DOM can see which of a region's three
 * sentences is currently on screen. That is also precisely why the guard does not compare a
 * region against its own `data-absence`: with both written by one call, the comparison is
 * true by construction and could not fail. The guard's expectation comes from the committed
 * catalogue in `../src/demo-regions.ts`.
 */

import type { ShardAttestation } from '@o2/core'
import type { EgressManifest } from '@o2/net'
import type { Region, SurfaceId } from '../src/demo-regions.ts'
import { REGIONS } from '../src/demo-regions.ts'

/** Already-formatted strings for one surface. Neither view formats what the other lacks. */
export interface SurfaceRender {
  /** regionId -> the exact string that goes on screen. */
  readonly regions: Readonly<Record<string, string>>
  /** The text view's lines, in order. */
  readonly text: readonly string[]
}

/** The state a region is in when it has no reading to show. */
export type AbsenceState = 'initial' | 'stopped' | 'unavailable'

const BY_ID: ReadonlyMap<string, Region> = new Map(REGIONS.map((region) => [region.id, region]))

/** The catalogue entry, or a throw naming the id — an undeclared region is a defect, not a gap. */
function regionOf(id: string): Region {
  const region = BY_ID.get(id)
  if (region === undefined) {
    throw new Error(
      `demo-regions: no catalogue entry for "${id}". Declare it in packages/browser/src/demo-regions.ts before rendering it.`,
    )
  }
  return region
}

/**
 * The one element carrying `data-region="<id>"`.
 *
 * Throws when there is none, and throws when there are two. Both are loud on purpose: a
 * region that silently never renders is the failure this whole phase exists to prevent, and
 * an e2e harness's `page.on('pageerror')` turns a throw here into a named line in the run.
 */
export function regionElement(id: string): HTMLElement {
  const found = document.querySelectorAll<HTMLElement>(`[data-region="${id}"]`)
  const first = found[0]
  if (first === undefined) throw new Error(`demo-regions: no element carries data-region="${id}"`)
  if (found.length > 1) {
    throw new Error(
      `demo-regions: ${found.length} elements carry data-region="${id}"; a region is one element`,
    )
  }
  return first
}

/** The catalogue's sentence for this region in this state, or a throw naming what is missing. */
function sentenceFor(region: Region, state: AbsenceState): string {
  const absence = region.absence
  if (absence === undefined) {
    throw new Error(
      `demo-regions: "${region.id}" is kind "${region.kind}" and holds no absence copy; only a reading has one`,
    )
  }
  if (state === 'unavailable') {
    const named = absence.unavailable
    if (named === undefined) {
      throw new Error(
        `demo-regions: "${region.id}" has no unavailable arm in the catalogue. UI-SPEC names a dynamic reason for it, so paintAbsence must be called with one.`,
      )
    }
    return named
  }
  return state === 'initial' ? absence.initial : absence.stopped
}

/**
 * Paint a region's named absence.
 *
 * `reason` is the fabric's own words — a thrown message, a refusal — and when it is supplied
 * it is written **instead**, verbatim. Never a number, never a blank, never a retained
 * previous value: those three are what a named absence exists to replace.
 */
export function paintAbsence(id: string, state: AbsenceState, reason?: string): void {
  const region = regionOf(id)
  const text = reason ?? sentenceFor(region, state)
  const element = regionElement(id)
  element.textContent = text
  element.setAttribute('data-absence', text)
}

/** Write a reading. The string is already formatted; this writer composes nothing. */
export function writeReading(id: string, text: string): void {
  // `data-absence` is deliberately left as whatever was last painted. It is a mirror of the
  // last absence, not a claim about the current text, and the guard reads neither.
  regionElement(id).textContent = text
}

/**
 * Paint every reading on one surface.
 *
 * A `permanentlyUnavailable` reading takes its `unavailable` arm whatever the state is —
 * that is what "renders its unavailable copy permanently" means, and it is the one place the
 * flag changes what is on screen rather than only what the guard expects.
 *
 * The bar's regions are skipped: `activity() === null` removes the bar entirely, so their
 * absence is the element not being there.
 */
export function paintSurfaceAbsence(surface: SurfaceId, state: 'initial' | 'stopped'): void {
  for (const region of REGIONS) {
    if (region.surface !== surface) continue
    if (region.kind !== 'reading') continue
    if (region.absenceMode === 'element-removed') continue
    paintAbsence(region.id, region.permanentlyUnavailable === undefined ? state : 'unavailable')
  }
}

/**
 * Write one surface's reading into both of its views, in one pass.
 *
 * This is what makes P6 assertable: the rendered regions and the text view are written from
 * **one** record of already-formatted strings, so neither view can format anything the other
 * does not have. UI-SPEC section 2.2 makes the same argument `TabColouringRun.attestation`
 * makes about the CLI and this page — two formatters of one value are two things that can
 * disagree.
 */
export function applyRender(
  surface: SurfaceId,
  render: SurfaceRender,
  textViewId: string,
): void {
  for (const [id, text] of Object.entries(render.regions)) {
    const region = regionOf(id)
    if (region.surface !== surface) {
      throw new Error(
        `demo-regions: "${id}" belongs to surface "${region.surface}" and was rendered under "${surface}"`,
      )
    }
    writeReading(id, text)
  }
  regionElement(textViewId).textContent = render.text.join('\n')
}

// ---------------------------------------------------------------------------------------
// Moved verbatim out of `index.html`'s inline script — body and comments, line for line.
//
// They are already the established pattern and their comments carry the reasoning that put
// them there; a reworded copy would be a second author of the same sentence, which is the
// exact failure the sentences themselves are about. The only edits are the type annotations
// TypeScript needs on a function that no longer lives inside an HTML script element.
// ---------------------------------------------------------------------------------------

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

// VER-09/VER-10, criterion 3 — how strongly the answer was attested, in the
// kernel's own words.
//
// **The page composes no sentence of its own here, and that is the whole
// design.** `description` is the string `attestationReceipt` filled from
// `describeAttestation`, carried onto `JobResult` and passed through
// `runColouring` untouched. `bin/bench.ts` prints the same field for the same
// reason, so the CLI and this page cannot come to describe one result
// differently — there is one source of the words and neither surface holds a
// copy. Nothing below is derived from `redundancy`, from `agreeing.length`, or
// from anything this page believes about its own topology.
//
// **What stood here before was a claim the page could not check.** The line
// read `Verification cost N× — each cube ran twice, on different nodes, and the
// two had to agree`, unconditionally, on every settled run. At `redundancy: 1`
// — a lone visitor, which is every visitor who opens this page first — it was
// simply false, and it was printed directly above a placement list showing one
// node per cube. The cost figure is measured and stays; the claim about how the
// work was placed is now the kernel's.
//
// **The absence arm is a statement, not a blank and not a weaker label.** A
// visitor told less than the truth and a visitor told something untrue are
// different failures, and only the first is acceptable. So it says how many
// replicas agreed, how many of those this tab could actually check, and the
// kernel's own reason naming each replica it could not — never a strength over
// whatever happened to check out.
export const attestationLines = (attestation: ShardAttestation): string[] =>
  'kind' in attestation
    ? [
        'How strongly was it checked: nothing established. ' +
          `${plural(attestation.agreeing, 'replica')} agreed on the least-attested ` +
          `cube, and ${attestation.verified} of those produced a signed statement ` +
          'this tab could check.',
        attestation.reason,
      ]
    : [
        `How strongly was it checked: ${attestation.description}`,
        `Established over ${plural(attestation.replicas, 'replica')} from ` +
          `${plural(attestation.operators.length, 'operator')}.`,
      ]

// DATA-05/DATA-06 — the egress manifest, rendered. **This is the sovereignty claim's
// only operator-facing surface**, and until 2026-08-08 it did not exist: every run
// produced a manifest and the page displayed none of it, so the one property this
// project puts first was the one thing a visitor could not see.
//
// ## It states what it can prove and refuses the stronger reading
//
// Every cube `runColouring` submits is `label: 'public'`, so **nothing is registered
// as sovereign on this path** and `violations` is empty by construction. Printing
// "0 refused" alone would read as a sovereignty proof and would be a lie by omission —
// the guard withheld nothing because it was given nothing to withhold. So the panel
// says that, in those words. What it *does* establish is real and worth showing: the
// guard is genuinely in the transport, and it counted every byte that left.
//
// `runJob` — the path that registers owner rows and can produce a non-empty
// `violations` — had no caller in this page when this block was written. That was audit
// finding G4; Phase 27 gave it one, and the sentence below had to grow a third arm as a
// direct consequence (see the next block).
//
// ## Three arms, because "0 withheld" answers two different questions — EGR-01
//
// Until 2026-08-10 there were two, split on `violations.length`, and the empty arm said
// *"this run registered no sovereign data"*. That is a statement about **what the run
// submitted**, and `violations` is a reading of **what the guard saw leave**. On a public
// dispatch the two coincide, which is why it stood for two days and five surfaces; on a
// bring-your-own dispatch that submitted six owner-pinned shards it was simply false, and
// the page printed it beside `byo/sovereign-label` reading *"sovereign — every shard was
// submitted owner-pinned"* in one render pass. `EgressManifest.registeredSovereign` is
// the field that tells them apart, and this function is where the reader sees it.
//
// The split is by **fact**, not by surface: the run registered nothing; the run registered
// something and the guard withheld none of it; the guard withheld some. Every surface
// still calls this one function over whichever manifest it holds, and the count and its
// sentence stay one region and one template — UI-SPEC §5.2, asserted by P7 — because a
// bare figure "would read as a sovereignty proof and would be a lie by omission". The
// second arm is the one that had to be written most carefully: it is a **detector**
// reporting a clean scan, not a proof, and it says so in the words it uses.
export const egressLines = (egress: EgressManifest | null | undefined): string[] => {
  if (egress === undefined || egress === null) return []
  const out = [
    '',
    'What left this device:',
    `  ${plural(egress.entries.length, 'frame')} sent, ${egress.totalBytes} byte(s) total.`,
  ]
  if (egress.violations.length > 0) {
    out.push(
      `  ${plural(egress.violations.length, 'frame')} WITHHELD: ${egress.violations.join(', ')}.`,
      '  Those bytes are still on this device. They were not sent anywhere.',
    )
  } else if (egress.registeredSovereign === 0) {
    out.push(
      '  0 withheld — and this run registered no sovereign data, so that is the',
      '  guard reporting it had nothing to hold back, not a proof of sovereignty.',
    )
  } else {
    // Reached when the count is anything other than zero, so a manifest that somehow
    // carried no count at all lands HERE rather than on the sentence above. That is
    // deliberate: this arm reads oddly and goes red, where the arm above reads perfectly
    // and is the false one. A silent default belongs on the side that fails loudly.
    out.push(
      `  0 withheld — and this run registered ${plural(egress.registeredSovereign, 'sovereign shard')},`,
      '  so the guard was watching for those bytes and saw none of them leave. That is',
      '  a clean scan of what crossed, not a proof about what could not.',
    )
  }
  return out
}
