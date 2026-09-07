/**
 * A read-only sampler that timestamps the kill switch turning from admitting to halted, from
 * outside the fabric. `RUN-07`, Phase 39 criterion 5.
 *
 * Plain ESM, zero dependencies, and the only platform import is `node:process` for the CLI arm
 * at the bottom — so `packages/node/src/switch-observation.node.test.ts` imports the pure
 * functions and gets arithmetic with no environment attached.
 *
 * ## What this is FOR, and what it may not do
 *
 * The flip is an operator-key write to the production object, and this project's scope fence
 * puts every production write on the owner's side. So this file is the **instrument** and not
 * the act: it reads `GET /self` and the status page, it holds no credential, and it has no
 * write path at all. The owner's exact script — what to run, what to read back, what number
 * means stop — is
 * `.planning/phases/phase-39-the-public-run/39-KILL-SWITCH-DURING-RUN.md`.
 *
 * ## THE TWO PLANES, and conflating them would make every figure here a lie
 *
 * Phase 36 published `PROPAGATION_WINDOW_MS = 29_880`. That is a **tab-side** figure: the
 * maximum over six browser tabs of the delay between the write returning and that tab's own
 * thirty-second poll noticing, recorded inside each page.
 *
 * This sampler reads `/self`, which is the **object's own state**, and that state changes at
 * the write. Its observed window is therefore bounded by its own sampling interval, by
 * construction — two consecutive samples straddling the flip — and it can never reproduce
 * 29 880 ms. **The two readings are comparable only as ratios to the interval each was taken
 * at**, which is precisely what `propagation-window.ts` found by taking the same window at
 * 2 000 ms and at 30 000 ms in one run and getting 0.937 and 0.996:
 *
 * > The raw window moved by very nearly the interval's own factor — 1 874 -> 29 869, a factor
 * > of 15.9 against the interval's 15 — while the ratio stayed at or under 1 in both. So the
 * > window's dominant term is the poll interval and nothing else contributes materially.
 *
 * {@link withinBaseline} therefore answers `comparable` beside `within`. The millisecond band
 * is a statement about a series taken at the production poll interval; applied to a series
 * taken at any other interval it compares two different quantities, and saying so is the
 * difference between a reading and a number.
 *
 * ## Why every unreadable input is a throw and never a default
 *
 * A sampler that answers `halted: false` for a body it could not read reports a working fabric
 * during an outage — and it fails in the direction that keeps a run going, which is the worst
 * available direction for a control's own instrument. So {@link sampleAdmission} throws, and
 * {@link observedWindow} answers `null` rather than `0` for a transition it did not see: a
 * window of zero and an unobserved flip are opposite claims, and reporting the second as the
 * first would hand the owner a perfect propagation figure off a run nobody measured.
 *
 * ## Its own request cost, because it is a term in the stage budget
 *
 * One `GET /self` per interval, plus one `GET` on the status page per interval when a status
 * URL is given. Nothing else, ever. At the suggested `--interval 5000 --for 180000` that is 36
 * samples, so 36 or 72 Durable Object requests for the whole exercise — against the 1 438
 * `tools/run/stage-budget.mjs` estimates for stage 1. It is a rounding error on the budget and
 * it is still stated, because a control whose own cost is unstated is the class of thing that
 * took the hosted tier down on 2026-09-03.
 */
import process from 'node:process'

// ---------------------------------------------------------------------------
// Phase 36's published constants, RESTATED — and the restatement is checked.
// ---------------------------------------------------------------------------

/**
 * The published propagation window, milliseconds. Restated from
 * `packages/browser/src/propagation-window.ts`.
 *
 * **A `.mjs` in `tools/` cannot import a `.ts` in `packages/browser/src/`**, so this is a second
 * copy, and a second copy is only safe if something compares the two. Something does:
 * `packages/node/src/switch-observation.node.test.ts` imports both and asserts all four are
 * equal, naming both sides in its failure message. Neither copy is derived from the other, so
 * the pair cannot silently disagree.
 *
 * What it is a measurement OF is in that file and is not restated here: six tabs, one local
 * `workerd`, one machine, a Durable-Object-storage poll and not Workers KV.
 */
export const PROPAGATION_WINDOW_MS = 29_880

/** How far a reading may drift from the published figure. 5 % of the interval. Restated. */
export const PROPAGATION_BAND = 1_500

/** How many tabs the published maximum was taken over. A window over one tab is not a population. */
export const PROPAGATION_POPULATION = 6

/** The poll interval the published window was measured at. Restated. */
export const PROPAGATION_INTERVAL_MS = 30_000

/**
 * The status page's two rendered verdicts, and there are exactly two.
 *
 * `packages/browser/demo/status.ts` renders `NOT ADMITTING NEW TASKS` when halted and
 * `Admitting new tasks` otherwise. Restated on the same two-copies rule as the constants above;
 * the spec reads that file's text and asserts both literals are still in it.
 */
export const VERDICT_HALTED = 'NOT ADMITTING NEW TASKS'

/** See {@link VERDICT_HALTED}. */
export const VERDICT_ADMITTING = 'Admitting new tasks'

/**
 * How much larger than the sampling interval a gap may be before the series is degraded.
 *
 * **A stated judgement, and it is not 1.** A sampler that waits an interval and *then* issues a
 * request produces gaps of interval + round trip on every healthy run, so a threshold of
 * exactly one interval would call every live reading degraded and the classification would
 * carry no information. A **missed** sample doubles the gap. 1.5 sits between the two
 * populations: it is above any jitter a loopback or a wide-area `GET` adds to a five-second
 * grid, and below the smallest gap a dropped sample can produce.
 *
 * The CLI additionally schedules on an absolute grid — the next sample is due at
 * `start + n × interval`, not at `now + interval` — so a slow request is absorbed by the next
 * wait rather than accumulating across the run.
 */
export const DEGRADED_GAP_FACTOR = 1.5

const REFUSAL =
  'a reading the sampler cannot vouch for is not a reading — see the header on why nothing here defaults'

function describe(value) {
  if (typeof value === 'string') return `the string ${JSON.stringify(value)}`
  if (value === null) return 'null'
  if (Array.isArray(value)) return `an array of ${String(value.length)}`
  if (typeof value === 'object') return `the object ${JSON.stringify(value)}`
  return String(value)
}

// ---------------------------------------------------------------------------
// Reading one `/self` body.
// ---------------------------------------------------------------------------

/**
 * Read a `GET /self` body into the five fields a transition is read from, or throw.
 *
 * The narrowing is at the boundary and it is total: `region`, `halted`, `versions`, `since` and
 * `note` are each checked for the shape `AdmissionDirective` declares, and anything else is an
 * error naming what arrived. An outage page, a proxy's HTML, a truncated body and a field that
 * changed type all land here, and all four must be distinguishable from *the fabric is fine*.
 *
 * **T-39-29.** The tempting alternative is to answer `{ halted: false }` for an unreadable body
 * — it keeps a long run going and it reads like robustness. It is the defect: during an outage
 * every sample would report a working fabric, and the owner's mid-run exercise would record a
 * clean transition it never saw. The object itself takes the opposite decision for the opposite
 * reason, and `admission-flag.ts` says why: a stored *instruction* nobody can read is an
 * instruction nobody gave, so it degrades to admitting. A *reading* nobody can read is not a
 * reading at all.
 *
 * @param {unknown} body the parsed JSON of `GET /self`
 * @returns {{halted:boolean, region:string|null, versions:'all'|string[], since:number|null, note:string}}
 */
export function sampleAdmission(body) {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new Error(`switch-observation: /self answered ${describe(body)}, not an object — ${REFUSAL}`)
  }
  const admission = body.admission
  if (typeof admission !== 'object' || admission === null || Array.isArray(admission)) {
    throw new Error(
      `switch-observation: /self carried no admission object — it carried ${describe(admission)} — ${REFUSAL}`,
    )
  }
  const { region, halted, versions, since, note } = admission
  if (typeof halted !== 'boolean') {
    throw new Error(
      `switch-observation: admission.halted is ${describe(halted)} and must be a boolean — ${REFUSAL}`,
    )
  }
  if (region !== null && typeof region !== 'string') {
    throw new Error(
      `switch-observation: admission.region is ${describe(region)} and must be a string or null — ${REFUSAL}`,
    )
  }
  if (versions !== 'all' && !(Array.isArray(versions) && versions.every((one) => typeof one === 'string'))) {
    throw new Error(
      `switch-observation: admission.versions is ${describe(versions)} and must be 'all' or an ` +
        `array of version strings — ${REFUSAL}`,
    )
  }
  if (since !== null && (typeof since !== 'number' || !Number.isFinite(since))) {
    throw new Error(
      `switch-observation: admission.since is ${describe(since)} and must be a finite number or null — ${REFUSAL}`,
    )
  }
  if (typeof note !== 'string') {
    throw new Error(
      `switch-observation: admission.note is ${describe(note)} and must be a string — ${REFUSAL}`,
    )
  }
  return { halted, region, versions: versions === 'all' ? 'all' : [...versions], since, note }
}

// ---------------------------------------------------------------------------
// Reading a series of samples.
// ---------------------------------------------------------------------------

function requireSamples(samples) {
  if (!Array.isArray(samples) || samples.length === 0) {
    throw new Error(
      `switch-observation: a series of samples is required and ${describe(samples)} arrived — ${REFUSAL}`,
    )
  }
  for (const sample of samples) {
    if (typeof sample !== 'object' || sample === null) {
      throw new Error(`switch-observation: ${describe(sample)} is not a sample — ${REFUSAL}`)
    }
    if (typeof sample.at !== 'number' || !Number.isFinite(sample.at)) {
      throw new Error(
        `switch-observation: a sample's 'at' is ${describe(sample.at)} and must be a finite ` +
          `millisecond stamp — ${REFUSAL}`,
      )
    }
    if (typeof sample.halted !== 'boolean') {
      throw new Error(
        `switch-observation: a sample's 'halted' is ${describe(sample.halted)} and must be a ` +
          `boolean — ${REFUSAL}`,
      )
    }
  }
  return samples
}

/**
 * The elapsed milliseconds between the last sample reading not-halted and the first reading
 * halted, or `null` when the series carries no observed transition.
 *
 * ## `null`, never `0`, for a series that begins already halted — T-39-30
 *
 * This is the early return below, and it is a distinct branch rather than a consequence of the
 * search, because the two cases it separates are opposite claims:
 *
 * - **`0`** would say *the switch flipped between two samples a millisecond apart* — a
 *   measurement, and an extraordinary one.
 * - **`null`** says *I arrived after it had already flipped* — the absence of a measurement.
 *
 * A sampler that cannot tell them apart hands the owner a perfect propagation window off a run
 * in which nothing was observed. `0` is also falsy, so a caller testing the answer for truth
 * rather than for `null` would read the absence as the measurement without noticing.
 *
 * ## Which "last not-halted" is meant when a series flaps
 *
 * The last not-halted sample **before the first halted one**. A series that reads true, then
 * false, then true has a globally-last false sample that sits after the first true, and an
 * elapsed time measured to it would be negative. The first edge is the transition this exercise
 * is about; a later one is a second flip and belongs to a second reading.
 *
 * @param {ReadonlyArray<{at:number, halted:boolean}>} samples in the order they were taken
 * @returns {number|null}
 */
export function observedWindow(samples) {
  const series = requireSamples(samples)
  if (series[0].halted) return null
  for (let index = 1; index < series.length; index += 1) {
    if (series[index].halted) return series[index].at - series[index - 1].at
  }
  return null
}

/**
 * The largest interval between two consecutive samples, or `null` for a series of one.
 *
 * This is what says whether the window above is a reading or an upper bound. See
 * {@link DEGRADED_GAP_FACTOR}.
 *
 * @param {ReadonlyArray<{at:number, halted:boolean}>} samples
 * @returns {number|null}
 */
export function largestGapMs(samples) {
  const series = requireSamples(samples)
  if (series.length < 2) return null
  let largest = 0
  for (let index = 1; index < series.length; index += 1) {
    const gap = series[index].at - series[index - 1].at
    if (gap > largest) largest = gap
  }
  return largest
}

/**
 * Compare an observed window against Phase 36's published reading — as a ratio, with the
 * millisecond band beside it and a flag saying whether the band is even about the same thing.
 *
 * Three answers rather than one, because the honest comparison needs all three:
 *
 * - `ratio` — `windowMs / intervalMs`. **This is the quantity Phase 36 found to be stable**
 *   across a fifteen-fold change of interval, so it is the one that survives being taken by a
 *   different instrument at a different cadence. At or under 1 means nothing needed more than
 *   one poll to hear.
 * - `within` — is the window inside `PROPAGATION_WINDOW_MS ± PROPAGATION_BAND`.
 * - `comparable` — was this series taken at the interval the published band describes. When it
 *   is `false`, `within` is a comparison between two different quantities and must be reported
 *   as inapplicable rather than as a verdict.
 *
 * The one-argument form answers about the production poll interval, which is what the published
 * band is sited against.
 *
 * @param {number} windowMs the observed window
 * @param {number} [intervalMs] the interval the series was sampled at
 */
export function withinBaseline(windowMs, intervalMs = PROPAGATION_INTERVAL_MS) {
  if (typeof windowMs !== 'number' || !Number.isFinite(windowMs) || windowMs < 0) {
    throw new Error(
      `switch-observation: a window of ${describe(windowMs)} is not a duration. An unobserved ` +
        `transition is null and must not be compared against a band — ${REFUSAL}`,
    )
  }
  if (typeof intervalMs !== 'number' || !Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new Error(
      `switch-observation: an interval of ${describe(intervalMs)} is not a cadence — ${REFUSAL}`,
    )
  }
  return {
    windowMs,
    intervalMs,
    ratio: windowMs / intervalMs,
    within: Math.abs(windowMs - PROPAGATION_WINDOW_MS) <= PROPAGATION_BAND,
    comparable: intervalMs === PROPAGATION_INTERVAL_MS,
    baselineMs: PROPAGATION_WINDOW_MS,
    bandMs: PROPAGATION_BAND,
    baselinePopulation: PROPAGATION_POPULATION,
  }
}

/**
 * The whole reading over a series: what kind of answer this run produced, and the summary line
 * the owner records.
 *
 * Three kinds, and the two that are not `measured` are the point:
 *
 * - **`not-observed`** — no transition in the series. `windowMs` is `null`. A run that ends
 *   here has produced no reading, and the CLI exits non-zero rather than printing a clean run.
 * - **`degraded`** — a transition, but with a gap wider than {@link DEGRADED_GAP_FACTOR} × the
 *   interval somewhere in the series. The window is then an **upper bound**: the flip could
 *   have landed anywhere inside the hole. Saying so is the difference between a reading and a
 *   number.
 * - **`measured`** — a transition on the series' own grid.
 *
 * @param {ReadonlyArray<{at:number, halted:boolean}>} samples
 * @param {number} intervalMs the cadence the series was sampled at
 */
export function observationReport(samples, intervalMs) {
  const series = requireSamples(samples)
  if (typeof intervalMs !== 'number' || !Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new Error(
      `switch-observation: an interval of ${describe(intervalMs)} is not a cadence — ${REFUSAL}`,
    )
  }
  const windowMs = observedWindow(series)
  const gap = largestGapMs(series)
  const degraded = gap !== null && gap > intervalMs * DEGRADED_GAP_FACTOR

  if (windowMs === null) {
    return {
      kind: 'not-observed',
      windowMs: null,
      ratio: null,
      largestGapMs: gap,
      intervalMs,
      samples: series.length,
      baseline: null,
      line:
        `no transition in ${String(series.length)} samples at a ${String(intervalMs)} ms ` +
        'cadence — either the switch was never flipped, or the series began after it already ' +
        'had. This is not a window of zero and must not be recorded as one.',
    }
  }

  const baseline = withinBaseline(windowMs, intervalMs)
  const ratioText = baseline.ratio.toFixed(3)
  const bandText = baseline.comparable
    ? `${baseline.within ? 'inside' : 'OUTSIDE'} the published band of ` +
      `${String(baseline.baselineMs)} ± ${String(baseline.bandMs)} ms`
    : `not comparable to the published ${String(baseline.baselineMs)} ms band, which describes a ` +
      `series taken at ${String(PROPAGATION_INTERVAL_MS)} ms over ` +
      `${String(baseline.baselinePopulation)} tabs`
  return {
    kind: degraded ? 'degraded' : 'measured',
    windowMs,
    ratio: baseline.ratio,
    largestGapMs: gap,
    intervalMs,
    samples: series.length,
    baseline,
    line: degraded
      ? `UPPER BOUND ${String(windowMs)} ms, ratio ${ratioText} to a ${String(intervalMs)} ms ` +
        `cadence — a gap of ${String(gap)} ms means a sample was missed and the flip could have ` +
        `landed anywhere inside it; ${bandText}`
      : `window ${String(windowMs)} ms, ratio ${ratioText} to a ${String(intervalMs)} ms ` +
        `cadence, largest gap ${String(gap)} ms; ${bandText}`,
  }
}

/**
 * How many of each verdict the status page rendered.
 *
 * Counts rather than one answer, because the page renders **one card per configured origin** —
 * `status.ts` maps over `originsFrom(search)` — so a page showing two objects can legitimately
 * show one of each. A function answering a single verdict would have to pick one and would be
 * wrong about the other.
 *
 * ## AGAINST THE DEPLOYED PAGE THIS ANSWERS `{0, 0}`, AND THAT IS NOT A DEFECT HERE
 *
 * **`status.html` is a shell and the verdicts are painted by JavaScript.** `status.ts` builds
 * every card inside `render()` and assigns `root.innerHTML` in the browser, so a `GET` on the
 * published page returns markup containing neither string. Measured, not supposed: a case in
 * `packages/node/src/switch-observation.node.test.ts` reads `packages/browser/demo/status.html`
 * and asserts this function answers `{halted: 0, admitting: 0}` for it.
 *
 * So `--status` is useful against a server-rendered page and is inert against the one this
 * project publishes. `{0, 0}` is unambiguous-free by construction, so {@link disagrees} answers
 * `false` and nothing false-stops — but a reader must not take a `status=halted:0 admitting:0`
 * line as *the page says admitting*. It says *this text carried no verdict*. **The status page
 * is read back by the owner's own browser**, which is where the painting happens, and the
 * sampler carries `/self` only.
 *
 * The case that measures this is also what retires the caveat: server-render the page and it
 * reddens, which is the signal to delete these three paragraphs.
 *
 * @param {string} html the status page's rendered text
 * @returns {{halted:number, admitting:number}}
 */
export function renderedVerdicts(html) {
  if (typeof html !== 'string') {
    throw new Error(
      `switch-observation: the status page answered ${describe(html)}, not text — ${REFUSAL}`,
    )
  }
  return { halted: countOf(html, VERDICT_HALTED), admitting: countOf(html, VERDICT_ADMITTING) }
}

/**
 * Does this one sample's `/self` reading contradict what the status page rendered?
 *
 * Only when the page is unambiguous. A page rendering one card of each — which it does whenever
 * more than one origin is configured, or when one object is halted and another is not — carries
 * no single claim to contradict, and reporting one would be the instrument inventing a finding.
 *
 * @param {boolean} halted what `/self` said
 * @param {{halted:number, admitting:number}} verdicts what the page rendered
 */
export function disagrees(halted, verdicts) {
  if (typeof halted !== 'boolean') {
    throw new Error(`switch-observation: ${describe(halted)} is not a halted reading — ${REFUSAL}`)
  }
  if (typeof verdicts !== 'object' || verdicts === null) {
    throw new Error(`switch-observation: ${describe(verdicts)} is not a verdict count — ${REFUSAL}`)
  }
  const pageHalted = verdicts.halted > 0 && verdicts.admitting === 0
  const pageAdmitting = verdicts.admitting > 0 && verdicts.halted === 0
  return (halted && pageAdmitting) || (!halted && pageHalted)
}

/**
 * The longest run of consecutive samples in which the two routes disagreed.
 *
 * **Why a run and not a single sample, measured rather than reasoned.** The first exercise of
 * the CLI against a local origin that flipped mid-run printed, in one sample,
 * `halted=false … status=halted:1 admitting:0` — and the verdict came back `stop`. Nothing was
 * wrong: the sampler reads `/self` and *then* the status page, about a millisecond apart, and
 * the flip landed between the two reads. **Every run that observes a transition at all will
 * produce one such sample**, so a stop rule keyed on a single disagreement fires on exactly the
 * runs that worked.
 *
 * Two consecutive is the discrimination. One sample straddling the flip is two reads taken at
 * two moments; two in a row is one of the routes being stale, which is the thing the rule
 * exists to catch — a status page serving a cached object, or a `/self` answered by an instance
 * that never saw the write.
 *
 * A reading whose page could not be read breaks a run rather than extending it: an unread page
 * is not a disagreement.
 *
 * @param {ReadonlyArray<{halted:boolean, verdicts:{halted:number, admitting:number}|null}>} readings
 * @returns {number}
 */
export function longestDisagreementRun(readings) {
  if (!Array.isArray(readings)) {
    throw new Error(`switch-observation: ${describe(readings)} is not a list of readings — ${REFUSAL}`)
  }
  let longest = 0
  let current = 0
  for (const reading of readings) {
    if (typeof reading !== 'object' || reading === null) {
      throw new Error(`switch-observation: ${describe(reading)} is not a reading — ${REFUSAL}`)
    }
    if (reading.verdicts === null || reading.verdicts === undefined) {
      current = 0
      continue
    }
    current = disagrees(reading.halted, reading.verdicts) ? current + 1 : 0
    if (current > longest) longest = current
  }
  return longest
}

/** How many consecutive disagreements make a stop. See {@link longestDisagreementRun}. */
export const DISAGREEMENT_RUN_FOR_STOP = 2

function countOf(haystack, needle) {
  let count = 0
  let from = 0
  for (;;) {
    const found = haystack.indexOf(needle, from)
    if (found === -1) return count
    count += 1
    from = found + needle.length
  }
}

// ---------------------------------------------------------------------------
//
//   node tools/run/switch-observation.mjs --self https://<origin>/self \
//     --status https://<origin>/status.html --interval 5000 --for 180000
//
// One `[switch-observation]` line per sample — an ISO timestamp, `halted`, `since`, and the
// status page's rendered verdict counts — then three summary lines: the reading, the comparison
// against Phase 36, and the verdict. The exit code says the same thing as the verdict line:
//
//   0  observed  — a transition was seen and a window reported
//   1  stop      — no transition inside the run, or `/self` and the status page disagreed
//   2  refused   — an input was absent or unusable, so no reading could be taken at all
//
// The same three codes `tools/run/stage-budget.mjs` uses, deliberately: the owner reads this
// beside the funnel at a stage boundary and one vocabulary is enough.
//
// **Read `EXIT=$?` on the line IMMEDIATELY after the command.** No pipe, no trailing `tail`, no
// `echo` in between. zsh has no `PIPESTATUS`; it is `pipestatus[1]`.
//
// It sends one `GET` per interval per route and nothing else, ever. It presents no credential
// and it cannot write: the halt is the owner's act and is scripted in
// `.planning/phases/phase-39-the-public-run/39-KILL-SWITCH-DURING-RUN.md`.
//
// **`--status` is inert against the page this project publishes** and every line will read
// `status=halted:0 admitting:0`, because that page paints itself in the browser — see
// {@link renderedVerdicts}. It costs one request per sample to learn nothing, so pass it only
// against a server-rendered page. `/self` is the route that carries the reading.

function parseArgs(argv) {
  const parsed = {}
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    if (typeof flag !== 'string' || !flag.startsWith('--')) continue
    parsed[flag.slice(2)] = argv[index + 1]
    index += 1
  }
  return parsed
}

async function readJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) })
  if (!response.ok) throw new Error(`${url} answered ${String(response.status)}`)
  return response.json()
}

async function readText(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) })
  if (!response.ok) throw new Error(`${url} answered ${String(response.status)}`)
  return response.text()
}

function stamp(at) {
  return new Date(at).toISOString()
}

async function runCli(argv) {
  const args = parseArgs(argv)
  const selfUrl = args.self
  const statusUrl = args.status
  const intervalMs = Number(args.interval)
  const forMs = Number(args.for)

  if (typeof selfUrl !== 'string' || selfUrl === '') {
    console.log('[switch-observation] refused --self <url> is required and names the GET /self route')
    process.exitCode = 2
    return
  }
  if (!Number.isFinite(intervalMs) || intervalMs <= 0 || !Number.isFinite(forMs) || forMs <= 0) {
    console.log(
      '[switch-observation] refused --interval and --for are required, both in milliseconds and ' +
        'both greater than zero',
    )
    process.exitCode = 2
    return
  }

  const startedAt = Date.now()
  const samples = []
  const readings = []

  // **An absolute grid.** The next sample is due at `startedAt + n × interval`, not at
  // `now + interval`, so a slow request is absorbed by the next wait instead of accumulating
  // across the run — which would otherwise drift the series into `degraded` on a long exercise.
  for (let index = 0; startedAt + index * intervalMs < startedAt + forMs; index += 1) {
    const dueAt = startedAt + index * intervalMs
    const wait = dueAt - Date.now()
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))

    let sample
    try {
      sample = sampleAdmission(await readJson(selfUrl))
    } catch (error) {
      // A failed read is recorded and the run continues: an operator's silence is not a stop
      // order, and neither is a dropped request. It widens the gap, which is what makes the
      // series `degraded` if it matters.
      console.log(`[switch-observation] ${stamp(Date.now())} unreadable ${String(error?.message ?? error)}`)
      continue
    }
    const at = Date.now()
    samples.push({ at, halted: sample.halted })

    let verdicts = null
    if (typeof statusUrl === 'string' && statusUrl !== '') {
      try {
        verdicts = renderedVerdicts(await readText(statusUrl))
      } catch (error) {
        console.log(`[switch-observation] ${stamp(at)} status page unreadable ${String(error?.message ?? error)}`)
      }
    }
    readings.push({ halted: sample.halted, verdicts })

    console.log(
      `[switch-observation] ${stamp(at)} halted=${String(sample.halted)} ` +
        `region=${JSON.stringify(sample.region)} since=${sample.since === null ? 'null' : stamp(sample.since)} ` +
        `status=${verdicts === null ? 'not read' : `halted:${String(verdicts.halted)} admitting:${String(verdicts.admitting)}`}`,
    )
  }

  if (samples.length === 0) {
    console.log('[switch-observation] refused no sample was readable, so no reading exists')
    process.exitCode = 2
    return
  }

  const report = observationReport(samples, intervalMs)
  console.log(`[switch-observation] reading ${report.line}`)
  console.log(
    `[switch-observation] baseline Phase 36 measured ${String(PROPAGATION_WINDOW_MS)} ms over ` +
      `${String(PROPAGATION_POPULATION)} tabs at a ${String(PROPAGATION_INTERVAL_MS)} ms poll, ` +
      'ratio 0.996 — a tab-side figure, while this series is object-side; compare the ratios',
  )
  const disagreementRun = longestDisagreementRun(readings)
  const disagreed = disagreementRun >= DISAGREEMENT_RUN_FOR_STOP
  const stop = report.kind === 'not-observed' || disagreed
  console.log(`[switch-observation] verdict ${stop ? 'stop' : 'observed'}`)
  if (disagreed) {
    console.log(
      `[switch-observation] reason the status page and /self disagreed for ` +
        `${String(disagreementRun)} consecutive samples — one of the two is stale; believe ` +
        'neither and find out which',
    )
  } else if (report.kind === 'not-observed') {
    console.log(`[switch-observation] reason ${report.line}`)
  }
  process.exitCode = stop ? 1 : 0
}

/**
 * Run only when this file is the program, never when it is imported.
 *
 * `process.argv[1]` is resolved by Node to an absolute path and equals the decoded pathname of
 * `import.meta.url` for a directly-invoked module. Under vitest `argv[1]` is the runner, so the
 * spec imports these functions and this block does not fire — the same gate
 * `tools/run/stage-budget.mjs` uses.
 */
const invokedDirectly =
  typeof process !== 'undefined' &&
  typeof process.argv?.[1] === 'string' &&
  decodeURIComponent(new URL(import.meta.url).pathname) === process.argv[1]

if (invokedDirectly) {
  await runCli(process.argv.slice(2))
}
