/**
 * The bring-your-own surface — UI-SPEC section 4.5, Y1 through Y13, and the form's validity
 * model.
 *
 * ## This file is the caller audit finding G4 named as missing
 *
 * The v1.1 audit's G4 row says `TabApi.runJob` has no caller in the page. It has one now, and
 * it is the handler in `index.html` that calls {@link validity} and {@link format} from here.
 * That closes G4's `runJob` half; the primes half stays open for the reason Plan 27-06
 * recorded, which is a different workload and a different decision.
 *
 * ## The refusal arm of `egressLines` becomes reachable through this file
 *
 * `../render.ts`'s `egressLines` was written on 2026-08-08 with a comment saying its withheld
 * branch had **no caller** — every cube `runColouring` submits is `label: 'public'`, so
 * `violations` is empty by construction everywhere else on this page. `runJob` with `sovereign`
 * set registers owner rows, so this surface is where that branch first becomes reachable. It is
 * imported rather than reimplemented: UI-SPEC section 5.2 makes the count and its sentence one
 * region and **one template function**, and a local copy would be a second author of the
 * sentence that carries the sovereignty claim.
 *
 * ## The form requires seven inputs and the reason is not strictness
 *
 * `TabApi.runJob`'s own docblock: `moduleRecord` is required, not optional, because *a tab
 * started through `start` always pins some anchor set, so a dispatch with no record is a
 * dispatch that will be refused by every executor it reaches* — and making the field optional
 * *would let a caller write the refusal rather than the job and discover it as a timeout*. A
 * CID-only form would produce nothing but refusals discovered as timeouts. So {@link validity}
 * requires all seven, requires the record's `cid` to equal the module CID, and names every
 * field it is missing rather than only disabling a control.
 *
 * ## Why the form ships filled with this bundle's own module
 *
 * {@link DEFAULT_FORM} is `KERNEL_RECORD` and its CID, and that is a decision worth stating
 * because the obvious alternative — seven empty inputs — is a dead end for every visitor.
 * `scripts/sign-kernel.ts` discards its private half on every run, so **nobody outside this
 * repository can sign a record under the anchor this tab pins**: the only two dispatchable
 * modules in existence are the two records committed in `packages/demo/src/kernel-record.ts`.
 * A form that opened empty would therefore open at a state no visitor could leave, with a
 * disabled control they had no way to enable. Filled, the default path *works*, and the
 * refusal path is one field-edit away and is what `demo-byo.e2e.test.ts` drives.
 *
 * The validity model is not weakened by that and is exercised harder by it: clearing any of the
 * seven, or making the record's `cid` disagree with the module CID, disables the control with a
 * reason naming the field — asserted on a real page through the page's own inputs.
 *
 * ## No DOM, no globals
 *
 * Nothing here touches `document`, `window` or `window.o2`, and there is no `innerHTML`.
 * `failures[].reason` and `attestation.reason` are peer-authored strings rendered **verbatim**,
 * and `../render.ts`'s header states why *verbatim into `textContent` is a quotation while
 * verbatim into `innerHTML` is an injection*.
 *
 * ## One sentence this file composes, and one UI-SPEC row it refines
 *
 * {@link NO_PARTITION_FIELD}. UI-SPEC's Y4 row says `-1` renders as `no agreement`, *never as a
 * number*. The second half is the load-bearing half and is honoured absolutely. The first half
 * is **not true of every module**, and that was measured rather than reasoned: `runJob` derives
 * a partition index from `output.p`, a field only a module that writes one has, and
 * `main.ts`'s expression returns `-1` both for a shard that did not agree *and* for a shard
 * that agreed on an output carrying no such field. The demo's own colouring kernel is the
 * second case — measured 2026-08-10, it answers `runJob`'s canonical `{a: <shard index>}` with
 * `{c, s}` and no `p`, deterministically, so every replica agrees and every partition is `-1`.
 * Rendering *no agreement* there would say the opposite of what happened. So this file reads
 * `partitions[i]` **beside** `agreeing[i]`: no agreement when the shard did not agree, and the
 * composed sentence when it did and the module wrote no index.
 */

import { KERNEL_RECORD, KERNEL_TRUST_ANCHOR, PI_RECORD, kernelBytes, piKernelBytes } from '@o2/demo'
import { REGIONS } from '../../src/demo-regions.ts'
import type { Region } from '../../src/demo-regions.ts'
import type { TabJobReport, TabNameRecord } from '../../src/tab-api.ts'
import { attestationLines, egressLines } from '../render.ts'
import type { SurfaceRender } from '../render.ts'

/**
 * UI-SPEC section 4.5's copy above the form, verbatim.
 *
 * It appears **before** anything is submitted, which is the whole of why it exists: the failure
 * this surface is built to prevent is a provenance refusal discovered as a timeout. Rendered
 * from here rather than typed into the markup, for the reason Plan 27-05 removed the lone-tab
 * card's static copy — a sentence a spec asserts must have one author.
 */
export const PROVENANCE_NOTICE: string =
  'This tab pins one build authority — the demo’s own, shipped in this bundle. A module ' +
  'whose record was signed by any other key is refused by every executor it reaches, ' +
  'including this tab’s own. The refusal is shown below in the fabric’s own words. To ' +
  'dispatch your own module you sign it with a key this tab pins; there is no value you can ' +
  'enter here that turns the check off.'

/**
 * Y2 — the literal shape `runJob` sends per shard, with UI-SPEC's own sentence beside it.
 *
 * A `constant` and not a reading: it is a property of the dispatch path rather than of any
 * run. The sentence matters as much as the literal — a visitor who supplies a module is
 * entitled to know, before pressing anything, that the form carries no way to give it input.
 */
export const SHARD_INPUT: string =
  '{ a: <shard index> }\nevery shard receives this canonical value; this path carries no ' +
  'caller-supplied input'

/**
 * COMPOSED — see this file's header. UI-SPEC's Y4 row names one meaning for `-1` and
 * `main.ts`'s expression produces it for two, so the sentence for the second is written here
 * and logged in `deferred-items.md` as a correction owed to UI-SPEC.
 */
const NO_PARTITION_FIELD = 'no partition index — this module’s output carries no such field'

/** UI-SPEC's Y4 sentence for the case it names: the shard reached no agreement. */
const NO_AGREEMENT = 'no agreement'

/**
 * COMPOSED — Y7, and the third sentinel this surface had to separate from a quantity.
 *
 * `submitJob` computes `verificationMultiplier` as `useful === 0 ? 0 : gross / useful`
 * (`packages/core/src/job/submit.ts`), so a run where nothing produced an answer reports
 * **zero** — a sentinel for *there was nothing to divide by*, not a measured cost of zero.
 * Measured on a refused dispatch: `0.00×` on screen beside eighteen refusals, which reads as
 * *verification was free* and means the opposite. UI-SPEC's Y7 row names no unavailable arm,
 * so this sentence is composed here and logged in `deferred-items.md`.
 */
const NO_COST_MEASURED =
  'No cost measured: no shard produced an answer, so there is no verified work to divide the ' +
  'total by.'

/** The seven required inputs, in the order the form presents them. */
export const REQUIRED_FIELDS: readonly {
  readonly key: keyof ByoForm
  /** The visible `<label>`, and the name the disabled reason uses. Digit-free. */
  readonly label: string
}[] = [
  { key: 'moduleCid', label: 'module CID' },
  { key: 'name', label: 'record name' },
  { key: 'cid', label: 'record CID' },
  { key: 'version', label: 'record version' },
  { key: 'expiresAt', label: 'record expiry' },
  { key: 'signer', label: 'record signer' },
  { key: 'signature', label: 'record signature' },
]

/** What the form holds, as strings — which is what an `<input>` has. */
export interface ByoForm {
  readonly moduleCid: string
  readonly name: string
  readonly cid: string
  readonly version: string
  readonly expiresAt: string
  readonly signer: string
  readonly signature: string
  /**
   * The sovereign option, as **one** value and never two loose optionals.
   *
   * `TabApi.runJob`'s `sovereign` field makes the label and the owner id inseparable, because
   * `submitJob` refuses a sovereign shard with no owner by name (`shard-missing-owner`) — *a
   * pair of loose optionals is a way to spell a refusal rather than a job*. The form mirrors
   * that: the checkbox and the owner id are validated together, so a form that could dispatch
   * one without the other does not exist.
   */
  readonly sovereign: boolean
  readonly ownerId: string
}

/**
 * This bundle's own module and the record that vouches for it — the form's starting values.
 *
 * `KERNEL_RECORD.cid` is a `CID` instance and crosses to the form as the string it already is
 * on the wire; see `TabNameRecord` for the one place that reason is written down.
 */
export const DEFAULT_FORM: ByoForm = {
  moduleCid: KERNEL_RECORD.cid.toString(),
  name: KERNEL_RECORD.name,
  cid: KERNEL_RECORD.cid.toString(),
  version: String(KERNEL_RECORD.version),
  expiresAt: String(KERNEL_RECORD.expiresAt),
  signer: KERNEL_RECORD.signer,
  signature: KERNEL_RECORD.signature,
  sovereign: false,
  ownerId: '',
}

/** Y1 — the anchor `start()` pins when none is supplied. */
export const PINNED_ANCHOR: string = KERNEL_TRUST_ANCHOR

/**
 * The modules whose **bytes** ship in this bundle, by CID.
 *
 * A dispatch names a module by CID and carries no bytes, so the bytes have to already be
 * somewhere the fabric can fetch them from — `runColouring` and `runPi` both `store.put` their
 * own kernel before dispatching, for exactly this reason. This form has no such kernel of its
 * own, so it puts whichever bundled module the CID names and nothing else.
 *
 * **Measured before it was written.** Without this the default dispatch came back with every
 * shard refused for `module block missing: bafyrei…` — a true refusal, rendered correctly, and
 * a dead end for the one module a visitor can actually dispatch. Recorded here rather than
 * fixed silently, because the same refusal is the *correct* answer for a CID this bundle does
 * not ship, and a reader needs to be able to tell the two apart.
 */
export const BUNDLED_MODULES: ReadonlyMap<string, Uint8Array> = new Map([
  [KERNEL_RECORD.cid.toString(), kernelBytes],
  [PI_RECORD.cid.toString(), piKernelBytes],
])

/**
 * AOT-05's fetch sentence, re-exported so this surface keeps ONE import site on the page.
 *
 * It is declared in `../../src/gateway-module.ts` beside the fetch it describes, for the
 * reason every formatter here is declared beside nothing at all: it must be callable with no
 * DOM and no network, and `gateway-module.node.test.ts` calls it that way. It is re-exported
 * rather than re-implemented because a sentence held in two places is two sentences that can
 * drift — the same argument this file's header makes about `PROVENANCE_NOTICE`.
 */
export { describeFetch } from '../../src/gateway-module.ts'

/** Whether the form may be dispatched, and the reason when it may not. */
export type Validity =
  | { readonly ok: true }
  | {
      /** Field labels that are empty or unparsable. Empty when the failure is not a missing field. */
      readonly ok: false
      readonly missing: readonly string[]
      /** One sentence, naming what is wrong. Always non-empty when `ok` is false. Digit-free. */
      readonly reason: string
    }

/**
 * Is the form dispatchable — and if not, which field says so?
 *
 * Pure and DOM-free, which is what lets the whole validity model be tested exhaustively
 * without a Playwright round trip per case.
 */
export function validity(form: ByoForm): Validity {
  const missing = REQUIRED_FIELDS.filter((field) => String(form[field.key]).trim() === '').map(
    (field) => field.label,
  )
  // The sovereign pair, validated as one thing. Checked with no owner is a job `submitJob`
  // refuses by name, so the form refuses it first rather than spelling a refusal.
  if (form.sovereign && form.ownerId.trim() === '') missing.push('owner id')
  if (missing.length > 0) {
    return {
      ok: false,
      missing,
      reason: `Not dispatchable yet — still needed: ${missing.join(', ')}.`,
    }
  }

  // A parse failure is a validity failure naming the field, never a `NaN` sent to the fabric.
  for (const field of [
    { key: 'version' as const, label: 'record version' },
    { key: 'expiresAt' as const, label: 'record expiry' },
  ]) {
    if (!/^-?\d+$/.test(form[field.key].trim())) {
      return {
        ok: false,
        missing: [field.label],
        reason: `Not dispatchable — the ${field.label} is not a whole number, and a value the fabric cannot read is not a value to send.`,
      }
    }
  }

  // Two spellings of one fact are two things that can disagree; the form refuses the
  // disagreement rather than picking one of them on the visitor's behalf.
  if (form.cid.trim() !== form.moduleCid.trim()) {
    return {
      ok: false,
      missing: [],
      reason: "Not dispatchable — the record's cid does not match the module cid.",
    }
  }

  return { ok: true }
}

/**
 * The record the handler sends, built from a form {@link validity} has already accepted.
 *
 * Separate from `validity` on purpose: this function may assume the parse succeeds, and it can
 * only assume that because the caller cannot reach it otherwise.
 */
export function recordOf(form: ByoForm): TabNameRecord {
  return {
    name: form.name.trim(),
    cid: form.cid.trim(),
    version: Number.parseInt(form.version.trim(), 10),
    expiresAt: Number.parseInt(form.expiresAt.trim(), 10),
    signer: form.signer.trim(),
    signature: form.signature.trim(),
  }
}

/**
 * The shard count the page will send — `2 × (1 + peers)`.
 *
 * Exported so the dispatch and anything displaying it use one expression. Deliberately smaller
 * than the colouring surface's eight-per-device: this surface is about the dispatch path and
 * its provenance check, not about the size of the search, and a refusal arm that a visitor has
 * to wait out is the thing this whole surface exists to prevent.
 */
export function shardsFor(peers: number): number {
  return 2 * (1 + peers)
}

const CATALOGUE: ReadonlyMap<string, Region> = new Map(REGIONS.map((region) => [region.id, region]))

/**
 * The catalogue's sentence for a region in one of its three states.
 *
 * Read from `../../src/demo-regions.ts` and never written here — a sentence held in two places
 * is two sentences that can drift. A missing arm throws rather than falling back.
 */
function absence(id: string, state: 'initial' | 'stopped' | 'unavailable'): string {
  const region = CATALOGUE.get(id)
  if (region?.absence === undefined) throw new Error(`byo: "${id}" holds no absence copy`)
  const sentence =
    state === 'initial'
      ? region.absence.initial
      : state === 'stopped'
        ? region.absence.stopped
        : region.absence.unavailable
  if (sentence === undefined) throw new Error(`byo: "${id}" has no ${state} arm in the catalogue`)
  return sentence
}

/** Every bring-your-own reading, for the handler's stop and throw paths. Derived, never listed. */
export const BYO_READING_IDS: readonly string[] = REGIONS.filter(
  (region) => region.surface === 'byo' && region.kind === 'reading',
).map((region) => region.id)

/** Y1 and Y2 — always present, never a result, never an absence. */
export function formatConstants(): Readonly<Record<string, string>> {
  return {
    'byo/pinned-anchor': PINNED_ANCHOR,
    'byo/shard-input': SHARD_INPUT,
  }
}

/** Everything the two views are written from. No DOM, no node, no `window.o2`. */
export interface ByoState {
  readonly report: TabJobReport
  /**
   * What was **submitted**, not what was intended — Y13's own wording. Read back from the
   * options the handler passed, so a form the visitor edited after pressing the control
   * cannot change what the panel says about the job that ran.
   */
  readonly sovereign: { readonly ownerId: string } | null
}

/**
 * Y7 — the verification cost, or the sentence for the sentinel.
 *
 * One binding, used by the region and by the text view — P6 asserts the consequence.
 */
function multiplierOf(report: TabJobReport): string {
  return report.verificationMultiplier === 0
    ? NO_COST_MEASURED
    : `${report.verificationMultiplier.toFixed(2)}×`
}

/**
 * Y4 — one row per shard, and never a bare `-1`.
 *
 * Reads `partitions[i]` beside `agreeing[i]`, for the reason this file's header records: the
 * sentinel is produced by two different situations and only one of them is *no agreement*.
 */
function partitionRows(report: TabJobReport): string {
  return report.partitions
    .map((partition, index) => {
      const agreed = (report.agreeing[index] ?? []).length > 0
      if (!agreed) return `shard ${index}: ${NO_AGREEMENT}`
      if (partition < 0) return `shard ${index}: ${NO_PARTITION_FIELD}`
      return `shard ${index}: ${partition}`
    })
    .join('\n')
}

/**
 * The whole bring-your-own surface, from one report — Y3 through Y13 and the text view.
 *
 * Every one of the eleven readings is in the returned record in every arm, so no region can
 * keep a value from a previous dispatch: a reading with nothing to show carries a named
 * absence, and a stale reading is a placeholder that used to be true.
 */
export function format(state: ByoState): SurfaceRender {
  const { report } = state
  const regions: Record<string, string> = {}

  const complete = String(report.complete)
  const multiplier = multiplierOf(report)
  const fetched = String(report.fetched)
  const rejected = String(report.rejected)
  const egress = egressLines(report.egress)

  regions['byo/complete'] = complete
  regions['byo/partitions'] = partitionRows(report)
  // Y5, and the second sentinel this surface separates from a quantity. `main.ts` maps a
  // shard that did not agree to `replicas: 0` — so the zero is *no agreement*, not a count of
  // zero replicas, and printing it beside eighteen refusals would say the fabric measured
  // nothing rather than that nothing was measurable. Read beside `agreeing[i]`, as Y4 is.
  regions['byo/replicas'] = report.replicas
    .map((replicas, index) =>
      (report.agreeing[index] ?? []).length === 0
        ? `shard ${index}: ${NO_AGREEMENT}`
        : `shard ${index}: ${replicas}`,
    )
    .join('\n')
  regions['byo/verification-multiplier'] = multiplier
  regions['byo/fetched'] = fetched
  regions['byo/rejected'] = rejected

  // Y6 — placement, or UI-SPEC's own sentence for the case where there is none.
  const placed = report.agreeing.filter((nodes) => nodes.length > 0)
  regions['byo/agreeing'] =
    placed.length === 0
      ? absence('byo/agreeing', 'unavailable')
      : report.agreeing
          .map((nodes, index) =>
            nodes.length === 0
              ? `shard ${index}: ${NO_AGREEMENT}`
              : `shard ${index}: ${nodes.join(', ')}`,
          )
          .join('\n')

  // Y10 — the fabric's own words, verbatim, one refusal per line. The page has no better
  // words for a refusal than the fabric's, and it composes none.
  regions['byo/failures'] =
    report.failures.length === 0
      ? absence('byo/failures', 'unavailable')
      : report.failures.map((failure) => `${failure.nodeId}: ${failure.reason}`).join('\n')

  // Y11 — section 5.1. `attestationLines` is imported for `egressLines`' reason: the CLI and
  // this page must not come to describe one result differently, so there is one author of the
  // words and neither surface holds a copy.
  regions['byo/attestation'] =
    'kind' in report.attestation
      ? attestationLines(report.attestation).join('\n')
      : report.attestation.description

  // Y12 — **ONE region, count and sentence together**, UI-SPEC section 5.2. This is the one
  // surface in the demo where the withheld branch of `egressLines` can fire.
  regions['byo/egress'] = egress.join('\n').trim()

  // Y13 — read from what was submitted rather than from what was intended.
  regions['byo/sovereign-label'] =
    state.sovereign === null
      ? 'public — this dispatch carried no owner, so nothing in it was registered as sovereign.'
      : `sovereign — every shard was submitted owner-pinned to ${state.sovereign.ownerId}.`

  const text: string[] = [
    `${report.partitions.length} shard(s) dispatched · ${regions['byo/sovereign-label']}`,
    '',
    `Every shard agreed: ${complete}`,
    `Verification cost: ${multiplier}`,
    `Blocks pulled over the wire: ${fetched} · refused for a CID mismatch: ${rejected}`,
    '',
    'Partition index per shard:',
    regions['byo/partitions'],
    '',
    'Replicas per shard:',
    regions['byo/replicas'],
    '',
    'Placement:',
    regions['byo/agreeing'],
    '',
    'Refusals:',
    regions['byo/failures'],
    '',
    regions['byo/attestation'],
  ]
  text.push(...egress)

  return { regions, text }
}
