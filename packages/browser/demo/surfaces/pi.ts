/**
 * The π surface's formatter — UI-SPEC section 4.4, P1 through P14, and section 5.3's panel.
 *
 * ## One reading, one record, both views
 *
 * {@link format} takes one `TabPiRun` and the peer count at dispatch and returns a
 * {@link SurfaceRender}: already-formatted strings for the fourteen regions, and the lines of
 * `#pi-report`. **Both come out of one pass over one reading**, so the same value cannot be
 * formatted twice differently — UI-SPEC section 2.2's rule, and the property P6 in
 * `packages/node/src/demo-region-properties.ts` asserts against a real page. `pi/estimate` is
 * one of the fields P6 quantifies over, so the string this file puts in that region occurs
 * character for character in the text view or the guard reddens.
 *
 * ## There is no attestation region on this surface, and this is why
 *
 * `runPi` returns no attestation field. Its declared return type is `TabPiRun` in
 * `packages/browser/src/tab-api.ts` — `terms`, `shards`, `complete`, `reduceAttempted`,
 * `reduceReason`, `combined`, `treeDepth`, `combines`, `estimate`, `errorBound`, `elapsedMs`,
 * `egress`, and nothing else — where `TabColouringRun` in the same file declares
 * `attestation: ShardAttestation`. That is a citation rather than an assertion: a reader can
 * open the interface and count. So this surface has no receipt to render, and the only
 * receipt on the page belongs to the colouring run — a different job, over a different
 * kernel, on a different placement. A panel filled from it would be a receipt for something
 * else, which is worse than the panel's absence because it would look like an answer. The
 * page says so in one sentence beside the reduce panel instead.
 *
 * ## No DOM, no globals
 *
 * Nothing here touches `document`, `window` or `window.o2`, and there is no `innerHTML`:
 * `reduceReason` is a peer-authored string rendered **verbatim**, and `../render.ts`'s header
 * states why *verbatim into `textContent` is a quotation while verbatim into `innerHTML` is an
 * injection*. `pi-surface.node.test.ts` loads this file where `document` does not exist, so a
 * DOM reference stops that spec from loading at all.
 *
 * ## Three sentences this file composes, flagged rather than passed off as transcription
 *
 * {@link NO_REDUCE_NO_AGGREGATE}, {@link NO_COMBINE_COUNT} and {@link SINGLE_PARTIAL}. UI-SPEC
 * section 4.4 gives P7 exactly one unavailable sentence — *No aggregate: a reduce was started
 * and no combine produced one.* — and section 5.3 names it as the sibling case of the lone
 * tab, i.e. the case where a reduce **was** started. In the lone-tab arm that sentence is
 * false, and a false sentence is worse than a composed one. The same holds for P9 when a
 * reduce started and produced nothing (`combines` is a sentinel zero there, not a count), and
 * for the degenerate tree where one partial is its own aggregate and no combine was needed.
 * All three are marked COMPOSED below and logged in `deferred-items.md`.
 */

import { REGIONS } from '../../src/demo-regions.ts'
import type { Region } from '../../src/demo-regions.ts'
import type { TabPiRun } from '../../src/tab-api.ts'
import { egressLines } from '../render.ts'
import type { SurfaceRender } from '../render.ts'

/**
 * The published constant P12 compares against — **cited, and never a reading of this run.**
 *
 * A published mathematical value has no committed path in this repository and UI-SPEC
 * section 0's `cited` row admits exactly that. It is rendered beside the estimate with its
 * provenance in the same string, so it cannot be read as something the fabric produced.
 */
export const PUBLISHED_PI: number = Math.PI

/**
 * How many decimals every figure on this surface is rendered to.
 *
 * One constant rather than a choice per call site: the estimate, the published constant, the
 * difference and the bound are compared *by eye* on this surface, and four different
 * precisions would make the comparison harder to read than the numbers are to compute. Nine
 * is comfortably below the bound at every term count this page dispatches — `piErrorBound`
 * is 4/(2N+1), which at the smallest dispatch here is still five orders of magnitude above
 * the last digit shown.
 */
const DECIMALS = 9

/** UI-SPEC section 5.3's headline, ported verbatim. Exported so specs quote it once. */
export const SECOND_DEVICE_HEADLINE = 'This claim needs a second device.'

/** UI-SPEC section 5.3's body, ported verbatim. */
const SECOND_DEVICE_BODY =
  'The submitter is excluded from the combine executor set by contract, so a lone tab maps ' +
  'every shard and combines none. This is the ordinary state of the first tab on the page, ' +
  'not a failure. Open this page on another device, in another browser, or in a private ' +
  'window, and the tree has somewhere to run.'

/** The label the fabric's own words are quoted under. Section 5.3's wording. */
const REASON_LABEL = "The fabric's own reason: "

/**
 * The reduce started, said in one line.
 *
 * It reports the boolean and nothing more. *Why* it could start is the peer count's business
 * and it is on screen one card up; a sentence here about the topology would be the page's own
 * second opinion about a fact it reads elsewhere.
 */
const REDUCE_STARTED = 'A reduce was started.'

/**
 * COMPOSED — see this file's header. P7's catalogue sentence asserts *a reduce was started*,
 * and in the lone-tab arm no reduce was started at all.
 */
const NO_REDUCE_NO_AGGREGATE = 'No aggregate: no reduce was attempted — see above.'

/**
 * COMPOSED — see this file's header. `runPi` maps `combines` to `0` whenever the outcome is
 * not ok, so the zero there is a sentinel and not a count. Printing it would be the exact
 * failure this phase exists to remove: an absence rendered as a quantity.
 */
const NO_COMBINE_COUNT =
  'No count: a reduce was started and no combine produced an aggregate, so the fabric ' +
  'reported no combine count.'

/**
 * COMPOSED — see this file's header. `deriveReduceTree` promotes a lone child rather than
 * wrapping it in a pointless combine (`packages/core/src/reduce.ts`), so a single-partial
 * reduce genuinely has zero combines and a real aggregate. That zero is true, and it still
 * reads as a failure next to `combined: true`, so it is said in words.
 */
const SINGLE_PARTIAL = 'No combine was needed: a single partial is itself the aggregate.'

/**
 * Term count per shard — fixed, so the *total* term count grows with the number of devices.
 *
 * This is the π surface's arc and it is the same arc the colouring surface draws with cubes:
 * a second device does not merely make the same work finish sooner, it makes a **tighter
 * claim** possible. The alternating-series bound is 4/(2N+1), so doubling the devices halves
 * the bound while every node still sums the same number of terms.
 *
 * The value is chosen so a shard's work is milliseconds of WASM rather than seconds: the cost
 * this page is showing is the fabric's, not the series'.
 */
const TERMS_PER_SHARD = 250_000

/**
 * The shard count the page will send — `4 × (1 + peers)`.
 *
 * Exported so the dispatch uses the same expression P2 displays. Two copies of the formula
 * would be two things that can disagree about what the page said it would send.
 */
export function shardsFor(peers: number): number {
  return 4 * (1 + peers)
}

/** The term count the page will send. P1 displays this; the dispatch calls the same function. */
export function termsFor(peers: number): number {
  return TERMS_PER_SHARD * shardsFor(peers)
}

const CATALOGUE: ReadonlyMap<string, Region> = new Map(REGIONS.map((region) => [region.id, region]))

/**
 * The catalogue's sentence for a region in one of its three states.
 *
 * Read from `../../src/demo-regions.ts` and never written here — a sentence held in two places
 * is two sentences that can drift. A missing arm throws rather than falling back; a fallback
 * is how a region comes to render a sentence nobody wrote.
 */
function absence(id: string, state: 'initial' | 'stopped' | 'unavailable'): string {
  const region = CATALOGUE.get(id)
  if (region?.absence === undefined) {
    throw new Error(`pi: "${id}" holds no absence copy in the catalogue`)
  }
  const sentence =
    state === 'initial'
      ? region.absence.initial
      : state === 'stopped'
        ? region.absence.stopped
        : region.absence.unavailable
  if (sentence === undefined) throw new Error(`pi: "${id}" has no ${state} arm in the catalogue`)
  return sentence
}

/** Every π reading, for the handler's stop and throw paths. Derived, never listed. */
export const PI_READING_IDS: readonly string[] = REGIONS.filter(
  (region) => region.surface === 'pi' && region.kind === 'reading',
).map((region) => region.id)

/** Everything the two views are written from. No DOM, no node, no `window.o2`. */
export interface PiState {
  /** `computePeers().length` at dispatch — what P1 and P2 are derived from. */
  readonly peers: number
  readonly run: TabPiRun
}

/**
 * P1 and P2 — the arguments the page *would* send, on screen before anything is dispatched.
 *
 * `control` regions rather than readings: nothing has been asked of the fabric yet, so there
 * is nothing to read. What they make visible is that a second device buys a tighter bound,
 * before a visitor presses anything.
 */
export function formatArgs(peers: number): Readonly<Record<string, string>> {
  return {
    'pi/terms-arg': String(termsFor(peers)),
    'pi/shards-arg': String(shardsFor(peers)),
  }
}

/**
 * The reduce-tree diagram — P8's region, and the whole of what the reading supports.
 *
 * One row per layer: `map` for the leaves, then one per combine level. **The row count is
 * `depth + 1` and not `depth`**, because `ReduceTree.depth` counts the combine layers *above*
 * the leaves — `depth: level - 1` in `packages/core/src/reduce.ts`, where `level` starts at 1
 * for the first combine layer. Drawing `depth` rows would mean either dropping the `map` row
 * that UI-SPEC section 4.4 names first, or drawing one fewer combine layer than the fabric
 * built. Recorded as a deviation rather than resolved by rounding a row off.
 *
 * **No per-combine node state is drawn, and there is no way to draw one from here.**
 * `TabPiRun` carries a depth and a count. It carries no node ids, no per-node outcome and no
 * per-node executor, so a box with a state in it would be a state this page invented.
 */
function treeRows(depth: number): string {
  const rows = ['map']
  for (let level = 1; level <= depth; level++) rows.push(`lvl ${level}`)
  return [`depth ${depth}`, ...rows].join('\n')
}

/**
 * The whole π surface, from one run — P1 through P14 and the text view.
 *
 * Every one of the fourteen is in the returned record in every arm, so no region can keep a
 * value from a previous run: a reading with nothing to show carries a named absence, and a
 * stale reading is a placeholder that used to be true.
 */
export function format(state: PiState): SurfaceRender {
  const { run } = state
  const regions: Record<string, string> = { ...formatArgs(state.peers) }

  // ---- the map half, which even a lone tab really did do ----
  const terms = String(run.terms)
  const shards = String(run.shards)
  const complete = String(run.complete)
  const elapsed = `${Math.round(run.elapsedMs)}ms`
  const bound = run.errorBound.toFixed(DECIMALS)
  const egress = egressLines(run.egress)

  regions['pi/terms'] = terms
  regions['pi/shards'] = shards
  regions['pi/complete'] = complete
  regions['pi/elapsed'] = elapsed
  regions['pi/error-bound'] = bound
  // **ONE region, count and sentence together** — UI-SPEC section 5.2, and the same
  // `egressLines` call feeds both views. `0 withheld` on its own reads as a sovereignty proof.
  regions['pi/egress'] = egress.join('\n').trim()

  const text: string[] = [
    `${state.peers} peer(s) · ${shards} shard(s) · ${terms} term(s)`,
    '',
    `The map: every shard agreed: ${complete}`,
    '',
  ]

  // ---- P6: the reduce, or the reason there was none ----
  if (!run.reduceAttempted) {
    // Section 5.3's panel. `reduceReason` is quoted and never paraphrased — the page has no
    // better words for it than the fabric's. When the fabric supplies none the page says that
    // rather than inventing one.
    const reason = run.reduceReason ?? 'the fabric gave none.'
    const panel = `${SECOND_DEVICE_HEADLINE}\n${SECOND_DEVICE_BODY}\n\n${REASON_LABEL}${reason}`
    regions['pi/reduce-attempted'] = panel
    regions['pi/combined'] = NO_REDUCE_NO_AGGREGATE
    regions['pi/tree-depth'] = absence('pi/tree-depth', 'unavailable')
    regions['pi/combines'] = absence('pi/combines', 'unavailable')
    text.push(SECOND_DEVICE_HEADLINE, SECOND_DEVICE_BODY, '', `${REASON_LABEL}${reason}`)
  } else {
    regions['pi/reduce-attempted'] = REDUCE_STARTED
    regions['pi/tree-depth'] = treeRows(run.treeDepth)
    if (run.combined) {
      regions['pi/combined'] = 'true'
      regions['pi/combines'] = run.combines === 0 ? SINGLE_PARTIAL : String(run.combines)
    } else {
      regions['pi/combined'] = absence('pi/combined', 'unavailable')
      regions['pi/combines'] = NO_COMBINE_COUNT
    }
    text.push(
      REDUCE_STARTED,
      `  tree depth ${run.treeDepth} · combines: ${regions['pi/combines']}`,
      `  an aggregate was produced: ${regions['pi/combined']}`,
    )
  }
  text.push('')

  // ---- P10 and P12: the aggregate, against the published constant ----
  if (run.estimate === null) {
    regions['pi/estimate'] = absence('pi/estimate', 'unavailable')
    regions['pi/against-published'] = absence('pi/against-published', 'unavailable')
    text.push(regions['pi/estimate'], regions['pi/against-published'])
  } else {
    // One binding, referenced by the region, by the comparison and by the line. P6 asserts the
    // consequence: the string in the region occurs character for character in the text view.
    const estimate = run.estimate.toFixed(DECIMALS)
    const published = PUBLISHED_PI.toFixed(DECIMALS)
    const error = Math.abs(run.estimate - PUBLISHED_PI)
    const verdict = error <= run.errorBound ? 'inside the bound' : 'OUTSIDE the bound'
    const comparison =
      `|estimate − π| = ${error.toFixed(DECIMALS)} · the alternating-series bound for this ` +
      `term count is ${bound} · ${verdict}\n` +
      `estimate = ${estimate} · published π = ${published} — Math.PI, a published ` +
      'mathematical constant and not a reading of this run'
    regions['pi/estimate'] = estimate
    regions['pi/against-published'] = comparison
    text.push(`π, as the fabric aggregated it: ${estimate}`, comparison)
  }

  text.push('', `The whole dispatch took ${elapsed}.`)
  text.push(...egress)

  return { regions, text }
}
