/**
 * The connectivity funnel's counters, kept somewhere eviction cannot reach — RUN-04.
 *
 * ## Modelled line for line on `relay-service-journal.ts`, and for its stated reason
 *
 * A Durable Object is destroyed and rebuilt whenever the platform feels like it, and
 * `BootstrapObject.alarm()` runs on a **fresh instance**. So the obvious implementation —
 * read the counters, write the counters — erases the whole history the first time an
 * instance is replaced, and does it silently. {@link writeFunnelJournal} therefore **refuses
 * any total lower than the stored one**, which makes the bug impossible rather than merely
 * documented. A caller who forgot to restore gets a {@link FunnelJournalRollbackError}
 * instead of a quietly-truncated funnel.
 *
 * The refusal is not concurrency control — a single Durable Object has one live instance at a
 * time — it is a check on the *caller's state*, and it holds whether or not that stays true.
 *
 * `has` before `get`, never `get`-and-catch: `Datastore.get` signals a miss by throwing, so a
 * `catch` would swallow a genuine storage fault as "no history yet", and the two failures are
 * opposite with only one of them recoverable.
 *
 * JSON bytes, never a raw object. `DoDatastore`'s own docblock records what a non-byte value
 * does there: `has` says true, `get` throws `StoredValueNotBytesError`, `queryKeys` answers
 * `[]` — three different answers about one key.
 *
 * ## Why this one is NOT "one key holding six numbers"
 *
 * Its sibling says exactly that about itself, and this file cannot. A funnel record holds up
 * to {@link FUNNEL_MAX_CELLS} numbers — **13 676** — because question 2 is *by country and
 * network class* and question 3 is *by hour*, and a schema that dropped those dimensions
 * would not answer the questions it exists for.
 *
 * **It is still bounded by construction rather than by a sweep, and that distinction is what
 * makes `/journal/` an acceptable home for it.** `DoDatastore.put` refuses `/dht/` and `/o2/`
 * because those namespaces grow without limit and Phase 31's sweep is what bounds them.
 * `/journal/` is outside both refusals, so anything put here has to carry its own bound. This
 * one's is arithmetic: the stage list is frozen at six names, the hour bucket is 0-23, the
 * network-class and connection-class lists are closed, and a country is a two-letter pattern
 * admitting 676 codes. Multiply those out and you get 13 676 cells and a 476 224 B ceiling —
 * both derived in `@o2/net`'s `funnel-schema.ts` rather than written down here — against the
 * measured `4 194 304 B` storage wall at `do-datastore.ts:231`. An append-only event log under
 * this prefix would be the accumulation window those refusals exist to keep shut, and this is
 * not that: it is **one key**, overwritten in place, whose key space cannot grow.
 *
 * ## What a malformed value does, and why
 *
 * It throws. A silent reset to zero would make the funnel's history vanish while every reading
 * still looked plausible — six zeros is exactly what a fresh object answers — which is the
 * failure this whole file exists to prevent, wearing the disguise of a valid reading.
 */

import { Key } from 'interface-datastore'
import type { Datastore } from 'interface-datastore'
import {
  FUNNEL_RECORD_CEILING_BYTES,
  FUNNEL_SCHEMA_DIGEST,
  FUNNEL_STAGES,
} from '@o2/net'
import type {
  FunnelNetworkClass,
  FunnelPopulation,
  FunnelReport,
  FunnelStage,
  FunnelTotals,
} from '@o2/net'

/**
 * Where the record lives. Outside both namespaces `DoDatastore.put` refuses — see the header;
 * `relay-service-journal.ts` picked `/journal/` first and for the same reason.
 */
export const FUNNEL_JOURNAL_KEY: Key = new Key('/journal/funnel')

/** The counter maps, in one place so a reader and a writer cannot disagree about the set. */
const CELL_MAPS = ['byStageHour', 'webrtcAttempts', 'webrtcOutcomes'] as const

/** Thrown when the stored bytes are not a record this code wrote. */
export class MalformedFunnelJournalError extends Error {
  constructor(detail: string) {
    super(
      `${FUNNEL_JOURNAL_KEY.toString()} does not hold a funnel record (${detail})` +
        ' — refusing to read it as an empty funnel',
    )
    this.name = 'MalformedFunnelJournalError'
  }
}

/** Thrown when a write would lose history. See the header for why this is a refusal. */
export class FunnelJournalRollbackError extends Error {
  constructor(field: string, stored: number, offered: number) {
    super(
      `refusing to write ${field}=${String(offered)} over the stored ${String(stored)} in ` +
        `${FUNNEL_JOURNAL_KEY.toString()} — a funnel total does not go backwards, so the ` +
        'record being written was almost certainly never restored from this store',
    )
    this.name = 'FunnelJournalRollbackError'
  }
}

/** Thrown when a record would not fit under the schema's own derived ceiling. */
export class FunnelJournalTooLargeError extends Error {
  constructor(bytes: number) {
    super(
      `refusing to write ${String(bytes)} B to ${FUNNEL_JOURNAL_KEY.toString()} — the schema's ` +
        `derived ceiling is ${String(FUNNEL_RECORD_CEILING_BYTES)} B. A record past it means ` +
        'a key space grew that the schema says is closed, which is the accumulation window ' +
        "`DoDatastore`'s namespace refusals exist to keep shut",
    )
    this.name = 'FunnelJournalTooLargeError'
  }
}

/**
 * One counter, read strictly. A count is a non-negative integer and nothing else.
 *
 * `path` is the field's whole path rather than its leaf, because a reader of a crash log
 * wants to know which of the five maps held the bad value.
 */
function readCount(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new MalformedFunnelJournalError(`${path} is ${JSON.stringify(value)}`)
  }
  return value
}

function objectAt(source: Record<string, unknown>, field: string): Record<string, unknown> {
  const value = source[field]
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new MalformedFunnelJournalError(`${field} is ${typeof value}, not an object`)
  }
  return value as Record<string, unknown>
}

/**
 * The six stage counters, read by NAME from the frozen list.
 *
 * A stage the schema does not have cannot be read back, and a stage the schema has that the
 * stored value lacks is a malformed record rather than a zero. The second half is what makes
 * this a refusal: silently defaulting a missing stage to zero is the same silent history loss
 * the whole file is written against, one field down.
 */
function readStageCounts(
  source: Record<string, unknown>,
  field: string,
): Record<FunnelStage, number> {
  const from = objectAt(source, field)
  const out = {} as Record<FunnelStage, number>
  for (const stage of FUNNEL_STAGES) out[stage] = readCount(from[stage], `${field}.${stage}`)
  return out
}

function readCells(source: Record<string, unknown>, field: string): Record<string, number> {
  const from = objectAt(source, field)
  const out: Record<string, number> = {}
  for (const key of Object.keys(from)) out[key] = readCount(from[key], `${field}[${key}]`)
  return out
}

/**
 * Six honest zeros for a node that has never banked a report.
 *
 * Not a throw and not a missing field: `#traffic`'s own comment in `worker.ts` is the
 * precedent — *"Two zeroed columns is a reading; a missing field is not."* A fresh object
 * answering `GET /funnel` has an answer, and it is that nothing has happened yet.
 */
export function emptyFunnelJournal(population: FunnelPopulation): FunnelTotals {
  const zeroed = (): Record<FunnelStage, number> => {
    const out = {} as Record<FunnelStage, number>
    for (const stage of FUNNEL_STAGES) out[stage] = 0
    return out
  }
  return {
    entered: zeroed(),
    stalledAt: zeroed(),
    byStageHour: {},
    webrtcAttempts: {},
    webrtcOutcomes: {},
    population,
    schemaDigest: FUNNEL_SCHEMA_DIGEST,
  }
}

/**
 * The stored record, or six zeros if this node has never banked one.
 *
 * `has` before `get` rather than `get`-and-catch — see the header.
 */
export async function readFunnelJournal(
  store: Datastore,
  population: FunnelPopulation,
): Promise<FunnelTotals> {
  if (!(await store.has(FUNNEL_JOURNAL_KEY))) return emptyFunnelJournal(population)

  const raw = await store.get(FUNNEL_JOURNAL_KEY)
  let parsed: unknown
  try {
    parsed = JSON.parse(new TextDecoder().decode(raw))
  } catch (error) {
    throw new MalformedFunnelJournalError(error instanceof Error ? error.message : String(error))
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new MalformedFunnelJournalError(`the value decodes to ${typeof parsed}, not an object`)
  }
  const source: Record<string, unknown> = { ...parsed }

  const storedPopulation = source['population']
  if (typeof storedPopulation !== 'string') {
    throw new MalformedFunnelJournalError(`population is ${JSON.stringify(storedPopulation)}`)
  }
  const storedDigest = source['schemaDigest']
  if (typeof storedDigest !== 'string') {
    throw new MalformedFunnelJournalError(`schemaDigest is ${JSON.stringify(storedDigest)}`)
  }

  return {
    entered: readStageCounts(source, 'entered'),
    stalledAt: readStageCounts(source, 'stalledAt'),
    byStageHour: readCells(source, 'byStageHour'),
    webrtcAttempts: readCells(source, 'webrtcAttempts'),
    webrtcOutcomes: readCells(source, 'webrtcOutcomes'),
    population: storedPopulation as FunnelPopulation,
    schemaDigest: storedDigest,
  }
}

/**
 * Bank a funnel record, refusing any write that would lose history.
 *
 * Answers what is now stored, which is what was offered — a caller that wants the stored value
 * after banking does not need a second read.
 *
 * **Every counter is checked, not just the six.** A cell in `webrtcOutcomes` that went
 * backwards is the same loss as a stage that did; the only difference is that nobody would
 * notice, because no route reports one cell on its own.
 */
export async function writeFunnelJournal(
  store: Datastore,
  totals: FunnelTotals,
  population: FunnelPopulation,
): Promise<FunnelTotals> {
  const stored = await readFunnelJournal(store, population)
  for (const stage of FUNNEL_STAGES) {
    if (totals.entered[stage] < stored.entered[stage]) {
      throw new FunnelJournalRollbackError(
        `entered.${stage}`,
        stored.entered[stage],
        totals.entered[stage],
      )
    }
    if (totals.stalledAt[stage] < stored.stalledAt[stage]) {
      throw new FunnelJournalRollbackError(
        `stalledAt.${stage}`,
        stored.stalledAt[stage],
        totals.stalledAt[stage],
      )
    }
  }
  for (const map of CELL_MAPS) {
    for (const [cell, was] of Object.entries(stored[map])) {
      const now = totals[map][cell] ?? 0
      if (now < was) throw new FunnelJournalRollbackError(`${map}[${cell}]`, was, now)
    }
  }

  const encoded = new TextEncoder().encode(JSON.stringify(totals))
  if (encoded.byteLength > FUNNEL_RECORD_CEILING_BYTES) {
    throw new FunnelJournalTooLargeError(encoded.byteLength)
  }
  await store.put(FUNNEL_JOURNAL_KEY, encoded)
  return totals
}

/**
 * The two dimensions the EDGE supplies, never the visitor.
 *
 * They are separate from {@link FunnelReport} on purpose: a report is what a browser sends and
 * a browser must not be able to choose which country its visit is filed under. `worker.ts`
 * derives these from headers the platform stamps, validates them against the schema's closed
 * ranges, and hands them here.
 */
export interface FunnelDimensions {
  readonly country: string
  readonly networkClass: FunnelNetworkClass
}

/**
 * Add one report to a record, purely.
 *
 * Returns a new record; nothing is mutated in place, so a caller cannot half-apply a report and
 * then bank it.
 *
 * ## Which map moves, and why exactly one drop counter can ever move
 *
 * A report is either an `entered` or a `stalled`, never both, and it names exactly one stage.
 * So `stalledAt` moves by one at one key or not at all, which is criterion 2's requirement made
 * structural rather than tested for: there is no arrangement of arguments here that moves two
 * drop counters. `funnel-attribution.e2e.test.ts` reads the property end to end anyway, because
 * the failure it guards against is a REPORTER that sends two reports, which this function
 * cannot see.
 *
 * ## What `byStageHour` counts, stated because it is easy to misread
 *
 * **Every report about a stage in that UTC hour, entered or stalled.** It is the volume signal
 * diurnal churn is asked of. Separating the two kinds by hour is deliberately not collected: it
 * would double a 144-cell map to answer a question nobody has asked, and the schema's rule is
 * that a field exists because a question needs it.
 */
export function accrueFunnelReport(
  totals: FunnelTotals,
  report: FunnelReport,
  dimensions: FunnelDimensions,
): FunnelTotals {
  const entered = { ...totals.entered }
  const stalledAt = { ...totals.stalledAt }
  const byStageHour = { ...totals.byStageHour }
  const webrtcAttempts = { ...totals.webrtcAttempts }
  const webrtcOutcomes = { ...totals.webrtcOutcomes }

  if (report.kind === 'entered') entered[report.stage] += 1
  else stalledAt[report.stage] += 1

  const hourKey = `${report.stage}|${String(report.hourBucket)}`
  byStageHour[hourKey] = (byStageHour[hourKey] ?? 0) + 1

  // Question 2's denominator: who reached the point where WebRTC is attempted at all.
  if (report.stage === 'ice-gathering' && report.kind === 'entered') {
    const key = `${dimensions.country}|${dimensions.networkClass}`
    webrtcAttempts[key] = (webrtcAttempts[key] ?? 0) + 1
  }
  // And its numerator: what they got. `control-only` is its own value, so a relayed pair that
  // carries no work is not counted as one this visitor can compute with.
  if (
    report.stage === 'connection-classified' &&
    report.kind === 'entered' &&
    report.connectionClass !== undefined
  ) {
    const key = `${dimensions.country}|${dimensions.networkClass}|${report.connectionClass}`
    webrtcOutcomes[key] = (webrtcOutcomes[key] ?? 0) + 1
  }

  return {
    entered,
    stalledAt,
    byStageHour,
    webrtcAttempts,
    webrtcOutcomes,
    population: totals.population,
    schemaDigest: totals.schemaDigest,
  }
}
