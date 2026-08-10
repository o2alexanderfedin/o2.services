/**
 * P6, P7 and P8 of UI-SPEC section 9, as functions over a page snapshot — Plan 27-04.
 *
 * ## Why they moved out of the guard, and what it fixes
 *
 * Plan 27-03 wrote all three **generically** — quantified over a named field set and over
 * region id suffix, naming no surface — and then hosted them in
 * `demo-regions.e2e.test.ts`, whose page has **no relay and no node**. Every one of the
 * three is conditional on a region being *populated*, and on that page nothing ever is. So
 * they were correct, general, and could not fire.
 *
 * That is not a defect in how they were written; it is a fact about where they were run. A
 * populated page only exists after a real run, and the first real run in this suite is
 * `demo-liveness.e2e.test.ts`'s. So the bodies live here and **both** files call them: the
 * stopped page keeps asserting them (where they stay vacuous, and say so), and the two-tab
 * page asserts the same three functions against regions that carry readings.
 *
 * One implementation, two harnesses. Two copies of a property are two properties that can
 * come to disagree about what they check — which is the same argument this whole phase makes
 * about two formatters of one value.
 *
 * ## Each returns what it examined, not only what it found
 *
 * `examined: 0` and `problems: []` are the same result to `toEqual([])` and are entirely
 * different findings. Every function below reports both, so a caller can assert that the
 * property covered something — and so a summary can state, with a number, whether a property
 * has stopped being vacuous.
 */

import type { Region, SurfaceId } from '../../browser/src/demo-regions.ts'
import { REGIONS } from '../../browser/src/demo-regions.ts'

/**
 * One `[data-region]` element, reduced to plain data.
 *
 * Collected by each harness's own `page.evaluate` — that part is DOM plumbing and differs
 * (the stopped page also collects undeclared text nodes and `Object.keys(window.o2)`). What
 * is shared is the shape and everything downstream of it.
 */
export interface DomRegion {
  readonly id: string
  readonly kind: string | null
  readonly source: string | null
  readonly text: string
  readonly outer: string
}

/** What a property looked at, and what it found. Both, always — see this file's header. */
export interface PropertyResult {
  readonly examined: number
  readonly problems: readonly string[]
}

/**
 * The page-side hook P8 needs, named here so a surface cannot populate an attestation region
 * without also making P8 real.
 *
 * P8 compares a rendered attestation against **a fresh reading taken in the same page**, and
 * there is no `TabApi` accessor for *the last run's receipt* — a run returns it once. So the
 * plan that lands the first attestation region publishes the reading it rendered under this
 * name. Plan 27-04's `#run` handler does; before it, P8 asserted its own precondition and
 * would have reddened naming this string.
 */
export const ATTESTATION_HOOK = '__o2LastAttestation'

/**
 * The hook's shape, as of Plan 27-08 — the flat receipt, **and** a map keyed by surface.
 *
 * ## Why it grew a map, measured rather than argued
 *
 * With one attestation region on the page, one value was exact. Plan 27-07 landed a second
 * and logged what that did: {@link p8} reads the hook **once**, after the whole P5 loop has
 * finished, so it was comparing a receipt rendered by the colouring panel against a reading
 * produced by the bring-your-own run that came after it. It passed, and it passed *close to
 * luck* — both runs were the same two unenrolled tabs, so both produced the same absence arm
 * naming the same node ids in the same order. A run where they differed would have reddened
 * P8 with a message about a page that had composed a sentence of its own, which would have
 * been false.
 *
 * Plan 27-08 lands a third — `fabric/attestation-description`, the cross-cutting view — and
 * applies the fix that item wrote out. The page publishes what **each** surface rendered
 * under its own key; this function prefers `bySurface[region.surface]` and falls back to the
 * flat fields, which still carry the last receipt the page rendered anywhere. Both harnesses
 * pass the hook through as an opaque JSON string, so **neither needed an edit**.
 */
interface AttestationHook {
  readonly description?: string
  readonly reason?: string
  readonly bySurface?: Readonly<Record<string, { description?: string; reason?: string } | null>>
}

/** What P6 quantifies over: field names, not surfaces. UI-SPEC section 9's P6 row names these four. */
export const P6_FIELDS: readonly string[] = ['n', 'verificationMultiplier', 'estimate', 'totalBytes']

/** UI-SPEC section 5.2's two sentences. A withheld count may never appear without one of them. */
export const EGRESS_SENTENCES: readonly string[] = [
  'registered no sovereign data',
  'They were not sent anywhere.',
]

const CATALOGUE: ReadonlyMap<string, Region> = new Map(REGIONS.map((region) => [region.id, region]))

/** `TabApi.runColouring().n` -> `runColouring`. `null` when the string is not of that form. */
export function methodOf(source: string | null): string | null {
  if (source === null) return null
  const match = /^TabApi\.([A-Za-z][A-Za-z0-9]*)\(/.exec(source)
  return match?.[1] ?? null
}

/** Every sentence the catalogue holds for a region. A populated region equals none of them. */
export function absenceSentences(region: Region): readonly string[] {
  const absence = region.absence
  if (absence === undefined) return []
  const out = [absence.initial, absence.stopped]
  if (absence.unavailable !== undefined) out.push(absence.unavailable)
  return out
}

/**
 * Does this element carry a reading rather than one of its named absences?
 *
 * Compared against the **committed catalogue** and never against the element's own
 * `data-absence`: the writer sets the attribute and the text in one call, so that comparison
 * is true by construction and could not fail.
 */
export function isPopulated(region: Region, dom: DomRegion): boolean {
  if (dom.text === '') return false
  return !absenceSentences(region).includes(dom.text)
}

/** The one text view declared for a surface, or `undefined` while that surface has none. */
export function textViewOf(surface: SurfaceId): Region | undefined {
  return REGIONS.find((r) => r.surface === surface && r.kind === 'text-view')
}

/**
 * P6 — a populated figure also occurs, character for character, in its own surface's text view.
 *
 * Quantified over {@link P6_FIELDS} and over the region's own surface. No surface is named,
 * so pi, bring-your-own and fabric-state inherit it unwritten. What it catches is the same
 * value formatted twice: the rendered card and the text view are written from one record of
 * already-formatted strings, and a second formatter would produce a string the other view
 * does not contain.
 */
export function p6(regions: readonly DomRegion[]): PropertyResult {
  const problems: string[] = []
  let examined = 0
  for (const dom of regions) {
    const region = CATALOGUE.get(dom.id)
    if (region === undefined || region.kind !== 'reading') continue
    if (!P6_FIELDS.some((field) => region.source.endsWith(`.${field}`))) continue
    if (!isPopulated(region, dom)) continue
    examined += 1

    const view = textViewOf(region.surface)
    if (view === undefined) {
      problems.push(`${region.id} is populated and its surface declares no text view to render it twice`)
      continue
    }
    const viewText = regions.find((other) => other.id === view.id)?.text
    if (viewText === undefined) {
      problems.push(`${region.id} is populated and its text view ${view.id} is not on the page`)
      continue
    }
    if (!viewText.includes(dom.text)) {
      problems.push(
        `${region.id} renders "${dom.text}" and ${view.id} does not contain that string — one value, two formatters`,
      )
    }
  }
  return { examined, problems }
}

/**
 * P7 — a withheld count never appears without the sentence that explains it.
 *
 * Quantified over id suffix. UI-SPEC section 5.2: the count and its sentence are ONE region
 * and ONE template function, because the bare figure reads as a sovereignty proof and would
 * be a lie by omission.
 */
export function p7(regions: readonly DomRegion[]): PropertyResult {
  const problems: string[] = []
  let examined = 0
  for (const dom of regions) {
    const region = CATALOGUE.get(dom.id)
    if (region === undefined) continue
    if (!region.id.endsWith('/egress') && !region.id.endsWith('-withheld')) continue
    if (!isPopulated(region, dom)) continue
    if (!/withheld/i.test(dom.text) || !/[0-9]/.test(dom.text)) continue
    examined += 1
    if (!EGRESS_SENTENCES.some((sentence) => dom.text.includes(sentence))) {
      problems.push(
        `${region.id} shows a withheld count with neither "${EGRESS_SENTENCES[0]}" nor "${EGRESS_SENTENCES[1]}" beside it — the figure alone is a lie by omission`,
      )
    }
  }
  return { examined, problems }
}

/** P8's result. `hookProblem` is its own precondition, reported separately from its findings. */
export interface AttestationResult extends PropertyResult {
  /**
   * Non-null when an attestation region is populated and the page published no reading to
   * compare it against. That is a failure rather than a skip: without the hook, P8 would be
   * comparing the page against itself.
   */
  readonly hookProblem: string | null
}

/**
 * P8 — an attestation region carries the fabric's own words and no sentence of the page's.
 *
 * The receipt arm must equal `attestation.description` **exactly**; the absence arm must
 * contain `attestation.reason` verbatim. Both are compared against a fresh reading taken in
 * the same page and published under {@link ATTESTATION_HOOK}, so this is a comparison between
 * what was rendered and what the kernel said, rather than between the page and itself.
 */
export function p8(regions: readonly DomRegion[], hook: string | null): AttestationResult {
  const populated = regions.filter((dom) => {
    const region = CATALOGUE.get(dom.id)
    if (region === undefined) return false
    if (!region.id.endsWith('/attestation') && !region.id.endsWith('/attestation-description')) {
      return false
    }
    return isPopulated(region, dom)
  })

  if (populated.length === 0) return { examined: 0, problems: [], hookProblem: null }

  if (hook === null) {
    return {
      examined: populated.length,
      problems: [],
      hookProblem:
        `an attestation region is populated and the page publishes no window.${ATTESTATION_HOOK}; ` +
        'P8 compares a rendered receipt against a fresh reading taken in the same page, and ' +
        'without one it would be comparing the page against itself',
    }
  }

  const reading = JSON.parse(hook) as AttestationHook | null
  const problems: string[] = []
  for (const dom of populated) {
    // Per surface first, flat second. See {@link AttestationHook} for the measurement that
    // made the first necessary and why the second stays: a page that publishes only the
    // flat value is still checked, against the last receipt it rendered anywhere.
    const surface = CATALOGUE.get(dom.id)?.surface
    const perSurface = surface === undefined ? undefined : reading?.bySurface?.[surface]
    const source = perSurface ?? reading
    const receipt = source?.description
    const absence = source?.reason
    const ok =
      (receipt !== undefined && dom.text === receipt) ||
      (absence !== undefined && dom.text.includes(absence))
    if (!ok) {
      problems.push(
        `${dom.id} reads "${dom.text}", which is neither attestation.description verbatim nor a block containing attestation.reason${perSurface === undefined || perSurface === null ? '' : ` (compared against window.${ATTESTATION_HOOK}.bySurface.${surface})`} — the page has composed a sentence of its own`,
      )
    }
  }
  return { examined: populated.length, problems, hookProblem: null }
}
