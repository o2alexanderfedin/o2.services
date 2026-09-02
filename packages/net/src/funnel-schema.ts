/**
 * The connectivity funnel's wire contract — RUN-05, and the freeze that makes it one.
 *
 * ## Why this module is in `@o2/net` and not in `@o2/core`
 *
 * It is a **cross-tier wire contract**: a visitor's browser composes a report, a Durable
 * Object banks it, and both sides have to agree on the field names or the counts mean
 * different things at each end. `protocol.ts` and `start-report.ts` already live here for
 * exactly that reason. The deciding fact is a dependency edge rather than a taste:
 * `packages/cloudflare/package.json` declares `@o2/net` and does **not** declare `@o2/core`,
 * so a contract placed in `@o2/core` could not be read by the tier that stores it.
 *
 * It is pure constants and predicates — no I/O, no platform globals, no `Date.now()` — so one
 * file runs in the node lane and the browser lane, and the two tiers cannot drift apart by
 * each carrying their own copy.
 *
 * ## Designed backward from exactly three questions
 *
 * {@link FUNNEL_QUESTIONS} is the whole justification for collecting anything. Every field in
 * {@link FUNNEL_FIELDS} names which question would go unanswered without it, and a field that
 * answers none of them fails a guard rather than a review. The derivation, field by field:
 *
 * | field | answers | why it is coarse enough |
 * |---|---|---|
 * | `stage` | all three | one of the six names, and nothing else is representable |
 * | `entered` | scaling curve, diurnal churn | an integer per stage. It says how many got this far, never who |
 * | `stalledAt` | scaling curve, diurnal churn | an integer per stage. Without it the curve has no denominator at each step |
 * | `country` | webrtc failure by country and class | ISO-3166 alpha-2 from the edge, `ZZ` when absent. Two letters is a **country**, not a person |
 * | `networkClass` | webrtc failure by country and class | a closed list ending in `unknown`. The platform's own coarse answer, never a derived one |
 * | `connectionClass` | webrtc failure by country and class | three values. This is the outcome the question is *about*: a relayed or control-only pair is the failure |
 * | `hourBucket` | diurnal churn | an integer 0-23, UTC. **An hour is not a timestamp** — it cannot order two visits or place one |
 * | `population` | all three | which visitors the counts are over. A count whose population is not beside it is a count that will be quoted wrong, so it answers every question in the sense that none of them can be answered honestly without it |
 *
 * ## The stage NAMES are the identifiers; the ordinals are not
 *
 * `.planning/ROADMAP.md`'s Phase 37 block says the classification is *"stage four's"* in its
 * **Depends on** line and lists it **fifth** in the success criterion, two sentences apart.
 * Every counter here is keyed by NAME, which makes the discrepancy harmless instead of
 * something to reconcile by renumbering a roadmap. Nothing in this file or downstream of it
 * indexes a stage by position.
 *
 * ## The freeze is a mechanism, not a promise in a document
 *
 * {@link FUNNEL_SCHEMA_DIGEST} is a **hand-written literal**. {@link funnelSchemaDigest}
 * recomputes it from the field set on every run, and `funnel-schema.test.ts` compares the two.
 * Adding, removing or renaming a field reddens the suite. The constant is deliberately not
 * `const DIGEST = funnelSchemaDigest()`: this repository has twice had a plant stay green
 * because both sides of an assertion moved together, and a digest derived from the thing it
 * guards is that shape exactly.
 *
 * **What the digest is and is not.** It is a 64-bit FNV-1a over a canonical rendering — a
 * *change detector*, chosen because it is deterministic, dependency-free and identical in both
 * lanes. It is **not** a commitment anyone could not forge, and nothing here treats it as one.
 * The property that matters is that an accidental schema edit cannot pass unnoticed, and a
 * deliberate one has to be written down twice.
 *
 * ## Cardinality is bounded by construction, and here is the arithmetic
 *
 * The stored record is not a cross-product of everything. It is five maps whose key spaces are
 * each closed: six frozen stage names, twenty-four hour buckets, a two-letter country pattern
 * (676 codes, `ZZ` among them), a closed network-class list and a closed connection-class list.
 * {@link FUNNEL_MAX_CELLS} is derived from those lists rather than written down beside them,
 * and {@link FUNNEL_RECORD_CEILING_BYTES} is derived from the cell count and the longest key
 * each map can hold.
 *
 * The numbers those derivations produce today: **13 676 cells** and a **476 224 B** ceiling.
 * The measured storage wall they sit under is `do-datastore.ts:231`: *smallest refused
 * 4 194 304 B → "string or blob too big: SQLITE_TOOBIG"*. So a fully saturated record — every
 * country code, every network class, every connection class, every hour — is about **an
 * eighth** of what this platform refuses, and `funnel-journal.test.ts` asserts an encoded
 * saturated record is under the ceiling rather than trusting this paragraph.
 *
 * Pure module.
 */

/**
 * The six stages, in the order `.planning/ROADMAP.md`'s success criterion states them.
 *
 * `as const`, so any other spelling of a stage does not typecheck rather than being counted
 * under a name nothing reads.
 */
export const FUNNEL_STAGES = [
  'page-load',
  'consent',
  'wss-bootstrap',
  'ice-gathering',
  'connection-classified',
  'first-task',
] as const

export type FunnelStage = (typeof FUNNEL_STAGES)[number]

/**
 * The three questions this schema exists to answer, and the only three.
 *
 * A fourth entry here is a change to what the project collects about people, so it is a
 * decision with a paper trail rather than an edit. `funnel-schema.test.ts` asserts the length
 * against the literal `3`.
 */
export const FUNNEL_QUESTIONS = [
  'scaling-curve',
  'webrtc-failure-by-country-and-class',
  'diurnal-churn',
] as const

export type FunnelQuestion = (typeof FUNNEL_QUESTIONS)[number]

/**
 * The two stages question 2 is about — where WebRTC is attempted and where it is judged.
 *
 * Derived from nothing and stated once, because the country dimension is carried at these two
 * stages and nowhere else. The other four stages do not need a country, and giving them one
 * would multiply the key space by 676 for no question.
 */
export const FUNNEL_WEBRTC_STAGES = ['ice-gathering', 'connection-classified'] as const

/**
 * How a visitor's network is described, coarsely, and `unknown` when the platform says nothing.
 *
 * Closed for the reason `START_FAILURES` is closed: an open vocabulary arriving from a client
 * is a field the client chooses the width of, and a wide enough field is a fingerprint. The
 * range is checked where the range is declared — `isStartBrowserLabel`'s stated discipline.
 */
export const FUNNEL_NETWORK_CLASSES = ['wifi', 'cellular', 'ethernet', 'other', 'unknown'] as const

export type FunnelNetworkClass = (typeof FUNNEL_NETWORK_CLASSES)[number]

/**
 * What a connection turned out to be, once one existed.
 *
 * `control-only` is a third value rather than a shade of `relayed`, and the distinction is the
 * point: `libp2p-transport.ts`'s `controlOnlyPeers` names a relayed pair that carries control
 * frames and no work. Folding it into `relayed` would report a peer this visitor cannot
 * compute with as one they can, inflating the classified stage against the first-task stage
 * and hiding the funnel's largest leak inside its own vocabulary.
 */
export const FUNNEL_CONNECTION_CLASSES = ['direct', 'relayed', 'control-only'] as const

export type FunnelConnectionClass = (typeof FUNNEL_CONNECTION_CLASSES)[number]

/**
 * Which visitors a set of counts is over.
 *
 * **This is a field and not a constant, because the answer is not engineering's to give.**
 * `.planning/REQUIREMENTS.md` § Open questions item 3 — consent versus legitimate interest —
 * is settled by legal review, and the two rulings differ in exactly this value. Carrying it in
 * the data means a ruling changes a value rather than the schema, and means no reader can hold
 * a count without holding what it is a count of.
 */
export const FUNNEL_POPULATION = ['opted-in-only', 'all-visitors'] as const

export type FunnelPopulation = (typeof FUNNEL_POPULATION)[number]

/** The country code for *we were not told*. Never inferred, never derived from an address. */
export const FUNNEL_UNKNOWN_COUNTRY = 'ZZ'

/** Two uppercase ASCII letters, and the count of codes that pattern admits. */
const COUNTRY_PATTERN = /^[A-Z]{2}$/
const COUNTRY_LETTERS = 26
const COUNTRY_CODES = COUNTRY_LETTERS * COUNTRY_LETTERS

/**
 * Whether a value is a country code this schema will store.
 *
 * Exactly two uppercase ASCII letters and nothing else — no lowercase, no three-letter form,
 * no region subtag. A validator that accepted more would be accepting a field whose width the
 * sender chooses, which is the failure `isStartBrowserLabel` was written to close for browser
 * labels. Callers map anything else to {@link FUNNEL_UNKNOWN_COUNTRY}.
 */
export function isFunnelCountry(value: unknown): value is string {
  return typeof value === 'string' && COUNTRY_PATTERN.test(value)
}

/** Whether a value is one of {@link FUNNEL_NETWORK_CLASSES}. */
export function isFunnelNetworkClass(value: unknown): value is FunnelNetworkClass {
  return typeof value === 'string' && (FUNNEL_NETWORK_CLASSES as readonly string[]).includes(value)
}

/** Whether a value is one of {@link FUNNEL_CONNECTION_CLASSES}. */
export function isFunnelConnectionClass(value: unknown): value is FunnelConnectionClass {
  return (
    typeof value === 'string' && (FUNNEL_CONNECTION_CLASSES as readonly string[]).includes(value)
  )
}

/** Whether a value is one of {@link FUNNEL_STAGES}. */
export function isFunnelStage(value: unknown): value is FunnelStage {
  return typeof value === 'string' && (FUNNEL_STAGES as readonly string[]).includes(value)
}

/** Whether a value is one of {@link FUNNEL_POPULATION}. */
export function isFunnelPopulation(value: unknown): value is FunnelPopulation {
  return typeof value === 'string' && (FUNNEL_POPULATION as readonly string[]).includes(value)
}

/** Hours in a day. The whole of the diurnal dimension; an hour is not a timestamp. */
export const FUNNEL_HOUR_BUCKETS = 24

/** Whether a value is an hour bucket — an integer 0-23, UTC. */
export function isFunnelHourBucket(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < FUNNEL_HOUR_BUCKETS
}

/**
 * What a field's stored values may be, for the digest and for the reader.
 *
 * The two scalar forms are named rather than left as `'integer'` for both, because they are
 * different widths and the digest has to see the difference: an hour bucket is 24 values and a
 * counter is unbounded above, and a field that moved between them would be a schema change
 * that a shared label would hide.
 */
export type FunnelFieldDomain =
  | 'count'
  | 'hour-0-23'
  | 'country-alpha2'
  | readonly string[]

/** One collected field, with the question it is collected for. */
export interface FunnelField {
  /** The name as it appears on the wire and in the stored record. */
  readonly name: string
  /**
   * Which of {@link FUNNEL_QUESTIONS} this field answers. **Never empty** — a field that
   * answers none of the three is not collected, which is criterion 3's own sentence.
   */
  readonly answers: readonly FunnelQuestion[]
  /** What would go unanswered without it. Prose, and deliberately outside the digest. */
  readonly why: string
  /** Why it is coarse enough to be collected at all. Prose, also outside the digest. */
  readonly coarseness: string
  /** The values it may hold. Inside the digest, because a widened domain is a schema change. */
  readonly domain: FunnelFieldDomain
}

/**
 * Every field the schema collects, and the question each one is collected for.
 *
 * The table in this module's header is the derivation. This is the machine-readable half of
 * it, and `funnel-schema.test.ts` asserts the two properties criterion 3 names: every field
 * answers at least one question drawn from {@link FUNNEL_QUESTIONS}, and no field names a
 * question outside it.
 */
export const FUNNEL_FIELDS: readonly FunnelField[] = [
  {
    name: 'stage',
    answers: ['scaling-curve', 'webrtc-failure-by-country-and-class', 'diurnal-churn'],
    why: 'without it there is no funnel at all — every question is asked of a stage',
    coarseness: 'one of six frozen names; no other value is representable',
    domain: FUNNEL_STAGES,
  },
  {
    name: 'entered',
    answers: ['scaling-curve', 'diurnal-churn'],
    why: 'the scaling curve is the shape of these six integers; without them there is no curve',
    coarseness: 'an integer per stage. It says how many got this far and never who',
    domain: 'count',
  },
  {
    name: 'stalledAt',
    answers: ['scaling-curve', 'diurnal-churn'],
    why: 'where a cohort was lost. Without it the curve shows a decline with no attribution',
    coarseness: 'an integer per stage, moved once per visit at most',
    domain: 'count',
  },
  {
    name: 'country',
    answers: ['webrtc-failure-by-country-and-class'],
    why: 'question 2 is by country. Without it the WebRTC failure rate is a single global number',
    coarseness: 'ISO-3166 alpha-2 from the edge, ZZ when absent. Two letters is a country, not a person',
    domain: 'country-alpha2',
  },
  {
    name: 'networkClass',
    answers: ['webrtc-failure-by-country-and-class'],
    why: 'question 2 is by network class. Carrier NAT and campus wifi fail differently and the difference is the finding',
    coarseness: 'a closed list ending in unknown; the platform is not asked to elaborate',
    domain: FUNNEL_NETWORK_CLASSES,
  },
  {
    name: 'connectionClass',
    answers: ['webrtc-failure-by-country-and-class'],
    why: 'the outcome question 2 is about. A relayed or control-only pair IS the failure being counted',
    coarseness: 'three values, and control-only is one of them so a pair that carries no work is not reported as one that does',
    domain: FUNNEL_CONNECTION_CLASSES,
  },
  {
    name: 'hourBucket',
    answers: ['diurnal-churn'],
    why: 'churn is a shape over the day. Without an hour the whole question is unanswerable',
    coarseness: 'an integer 0-23 in UTC. An hour cannot order two visits and cannot place one',
    domain: 'hour-0-23',
  },
  {
    name: 'population',
    answers: ['scaling-curve', 'webrtc-failure-by-country-and-class', 'diurnal-churn'],
    why: 'which visitors the counts are over. None of the three questions can be answered honestly without it, because every answer is a ratio and this is what the denominator is',
    coarseness: 'one of two named values, decided by a legal ruling and not by a visitor',
    domain: FUNNEL_POPULATION,
  },
]

/**
 * The canonical rendering the digest is taken over.
 *
 * Field prose (`why`, `coarseness`) is deliberately **out**: editing an explanation should not
 * break a freeze, and a freeze that fires on prose gets updated reflexively until it fires on
 * nothing. Names, question mappings and value domains are **in**, because each of those three
 * changes what is collected or how wide it is.
 */
export function canonicalFunnelSchema(): string {
  const stages = FUNNEL_STAGES.join(',')
  const questions = FUNNEL_QUESTIONS.join(',')
  const fields = FUNNEL_FIELDS.map((field) => {
    const domain = typeof field.domain === 'string' ? field.domain : field.domain.join('+')
    return `${field.name}:${field.answers.join('+')}:${domain}`
  }).join(';')
  return `stages=${stages}|questions=${questions}|fields=${fields}`
}

/**
 * A 64-bit FNV-1a over {@link canonicalFunnelSchema}, as sixteen lowercase hex digits.
 *
 * Written out rather than imported so this module keeps its charter — no platform imports, no
 * async, identical arithmetic in both lanes. `BigInt` is used because the mixing step needs a
 * 64-bit multiply that `Number` cannot represent exactly, and getting that silently wrong
 * would produce a digest that is stable per-engine and different across them, which is the
 * worst possible failure for a value two tiers compare.
 */
export function funnelSchemaDigest(): string {
  const OFFSET = 0xcbf2_9ce4_8422_2325n
  const PRIME = 0x0000_0100_0000_01b3n
  const MASK = 0xffff_ffff_ffff_ffffn
  let digest = OFFSET
  for (const unit of new TextEncoder().encode(canonicalFunnelSchema())) {
    digest = ((digest ^ BigInt(unit)) * PRIME) & MASK
  }
  return digest.toString(16).padStart(16, '0')
}

/**
 * The frozen digest — **hand-written, from one run of {@link funnelSchemaDigest}**.
 *
 * Never `const FUNNEL_SCHEMA_DIGEST = funnelSchemaDigest()`. The whole mechanism is that two
 * independent statements of the schema have to agree, and a derived constant is one statement
 * wearing two names.
 *
 * If the case comparing them goes red **after recruitment has begun**, the correct response is
 * to revert the field, not to update this line. Updating it is how a dataset stops being one
 * dataset.
 */
export const FUNNEL_SCHEMA_DIGEST = '3911527f1a04abee'

/**
 * When the schema was frozen, and against what.
 *
 * Frozen against `.planning/ROADMAP.md`'s Phase 37 criterion 3 and `RUN-05` — the three
 * questions, the six stage names and the eight fields above — before any invitation was sent.
 * Phase 39 is where recruitment begins; `37-RUNBOOK.md` step 5 is where the owner confirms
 * this digest is the same one the pre-invite reading carried.
 */
export const FUNNEL_SCHEMA_FROZEN_AT = '2026-09-02'

/**
 * Cell counts per stored map, derived from the closed lists above.
 *
 * Exported as data rather than as five constants so {@link FUNNEL_MAX_CELLS} and
 * {@link FUNNEL_RECORD_CEILING_BYTES} are both sums over one table, and so the journal's own
 * spec can name the map it is saturating.
 */
export const FUNNEL_CELL_BOUNDS: readonly { readonly map: string; readonly cells: number; readonly longestKey: number }[] =
  [
    {
      map: 'entered',
      cells: FUNNEL_STAGES.length,
      longestKey: Math.max(...FUNNEL_STAGES.map((stage) => stage.length)),
    },
    {
      map: 'stalledAt',
      cells: FUNNEL_STAGES.length,
      longestKey: Math.max(...FUNNEL_STAGES.map((stage) => stage.length)),
    },
    {
      map: 'byStageHour',
      cells: FUNNEL_STAGES.length * FUNNEL_HOUR_BUCKETS,
      longestKey: Math.max(...FUNNEL_STAGES.map((stage) => stage.length)) + 1 + 2,
    },
    {
      map: 'webrtcAttempts',
      cells: COUNTRY_CODES * FUNNEL_NETWORK_CLASSES.length,
      longestKey: 2 + 1 + Math.max(...FUNNEL_NETWORK_CLASSES.map((one) => one.length)),
    },
    {
      map: 'webrtcOutcomes',
      cells: COUNTRY_CODES * FUNNEL_NETWORK_CLASSES.length * FUNNEL_CONNECTION_CLASSES.length,
      longestKey:
        2 +
        1 +
        Math.max(...FUNNEL_NETWORK_CLASSES.map((one) => one.length)) +
        1 +
        Math.max(...FUNNEL_CONNECTION_CLASSES.map((one) => one.length)),
    },
  ]

/**
 * The largest number of counter cells the stored record can ever hold.
 *
 * Derived, never written down. 13 676 today: six `entered`, six `stalledAt`, 144 stage-hours,
 * 3 380 WebRTC attempts (676 country codes x 5 classes) and 10 140 WebRTC outcomes (the same
 * again x 3 connection classes). Every factor is a closed list or a two-letter pattern, so the
 * bound holds by construction rather than by a sweep — which matters because `/journal/` is
 * outside both namespaces `DoDatastore.put` refuses, and an unbounded key there would be
 * exactly the accumulation window those refusals exist to keep shut.
 */
export const FUNNEL_MAX_CELLS: number = FUNNEL_CELL_BOUNDS.reduce(
  (total, bound) => total + bound.cells,
  0,
)

/** Quote, quote, colon, comma — the JSON punctuation around one `"key":value` pair. */
const JSON_PUNCTUATION_BYTES = 4
/** `4294967295` — the widest integer a counter is allowed to reach before it is a defect. */
const WIDEST_COUNT_DIGITS = 10
/** Map names, braces, the population and digest fields, and slack for the envelope. */
const FUNNEL_ENVELOPE_BYTES = 512

/**
 * The byte ceiling a saturated record must stay under, derived from the bounds above.
 *
 * `funnel-journal.test.ts` encodes a record with every map saturated at its own longest key
 * and asserts the result is under this. This is **not** the platform's limit — that is the
 * measured `4_194_304 B` at `do-datastore.ts:231`, and a guard asserts this ceiling is inside
 * it. Two numbers rather than one, because the platform's wall is a fact about Cloudflare and
 * this one is a fact about the schema, and conflating them is how a schema change quietly
 * spends someone else's headroom.
 */
export const FUNNEL_RECORD_CEILING_BYTES: number =
  FUNNEL_CELL_BOUNDS.reduce(
    (total, bound) =>
      total + bound.cells * (bound.longestKey + JSON_PUNCTUATION_BYTES + WIDEST_COUNT_DIGITS),
    0,
  ) + FUNNEL_ENVELOPE_BYTES

/** The measured storage wall this ceiling sits under — `do-datastore.ts:231`. */
export const MEASURED_STORAGE_WALL_BYTES = 4_194_304

/** The counter maps a banked record holds, keyed as {@link FUNNEL_CELL_BOUNDS} describes. */
export interface FunnelTotals {
  /** How many visits reached each stage. */
  readonly entered: Readonly<Record<FunnelStage, number>>
  /** How many visits got no further than each stage. */
  readonly stalledAt: Readonly<Record<FunnelStage, number>>
  /** `${stage}|${hourBucket}` — the diurnal dimension. */
  readonly byStageHour: Readonly<Record<string, number>>
  /** `${country}|${networkClass}` at `ice-gathering` — question 2's denominator. */
  readonly webrtcAttempts: Readonly<Record<string, number>>
  /** `${country}|${networkClass}|${connectionClass}` at `connection-classified` — its numerator. */
  readonly webrtcOutcomes: Readonly<Record<string, number>>
  /** Which visitors these counts are over. Stored beside them, never inferred by a reader. */
  readonly population: FunnelPopulation
  /** The digest the record was written under, so a reader can see the schema did not move. */
  readonly schemaDigest: string
}

/** Six honest zeros, the population, and the digest. A fresh store reads exactly this. */
export function emptyFunnelTotals(population: FunnelPopulation): FunnelTotals {
  const zeroed = (): Record<FunnelStage, number> => ({
    'page-load': 0,
    consent: 0,
    'wss-bootstrap': 0,
    'ice-gathering': 0,
    'connection-classified': 0,
    'first-task': 0,
  })
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
 * One report from one visit, as it crosses the wire.
 *
 * ## Why `networkClass` travels in the BODY and `country` does not
 *
 * The two dimensions have different sources and the split is a trust boundary rather than a
 * convenience. **Country is the edge's**: the platform stamps it, the collector reads it off
 * the request, and a visitor cannot choose which country their visit is filed under — that is
 * the difference between a measurement and a poll. **Network class is the visitor's device's**:
 * it is the browser's own `navigator.connection.effectiveType` and there is no other source for
 * it, so pretending it arrives from anywhere but the client would be dressing up a
 * self-reported value as an observed one.
 *
 * There is also a mechanical reason it cannot be a header, and it decided the shape.
 * **`navigator.sendBeacon` cannot set request headers.** The terminal `stalledAt` report leaves
 * on `pagehide` and a beacon is the only send that survives a page unloading, so a dimension
 * carried in a header would be systematically absent from exactly the reports that say where
 * visitors were lost. It is in the body, where one send path can carry it.
 *
 * The cost is stated rather than mitigated: a visitor can send any class on the closed list.
 * `start-report.ts` records the same acceptance for the same reason — *"Counts are
 * unauthenticated: a peer can inflate its own"* — and authenticating a visitor is precisely
 * what criterion 4 forbids.
 */
export interface FunnelReport {
  /** The stage this report is about. */
  readonly stage: FunnelStage
  /** Whether the visit reached the stage, or got no further than it. */
  readonly kind: 'entered' | 'stalled'
  /** UTC hour, 0-23. */
  readonly hourBucket: number
  /** Which visitors this sender is part of. */
  readonly population: FunnelPopulation
  /** The device's own coarse reading of its connection. See the header for why it is here. */
  readonly networkClass: FunnelNetworkClass
  /** Present only at `connection-classified`, and only when a connection was classified. */
  readonly connectionClass?: FunnelConnectionClass
}

/**
 * A visitor's report, parsed strictly, or `null`.
 *
 * **It lives beside the contract it parses, which is what `protocol.ts` already does** with
 * `parseRequest` and `parseResponse`. A parser in the tier that happens to receive the bytes is
 * a second, more lenient reading of the same contract living somewhere the other end cannot see
 * it — exactly the shape `AUTH-02`'s note in this package's barrel warns about.
 *
 * `null` rather than a throw: an unparseable body from an unauthenticated public endpoint is
 * an ordinary event, not a fault, and a Worker that threw on one would turn a malformed beacon
 * into an error page. The caller answers 400 and stores nothing.
 *
 * **Nothing is defaulted.** A missing stage is a refusal, not `page-load`; a missing hour is a
 * refusal, not the current one. A collector that filled in a plausible value would be
 * fabricating a row, and a fabricated row is indistinguishable from a measured one once it is
 * in the store.
 */
export function parseFunnelReport(body: unknown): FunnelReport | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null
  const source = body as Record<string, unknown>

  const stage = source['stage']
  if (!isFunnelStage(stage)) return null

  const kind = source['kind']
  if (kind !== 'entered' && kind !== 'stalled') return null

  const hourBucket = source['hourBucket']
  if (!isFunnelHourBucket(hourBucket)) return null

  const population = source['population']
  if (!isFunnelPopulation(population)) return null

  // Refused rather than defaulted to `unknown`, for the reason every other field is: a
  // collector that filled in a plausible value would be fabricating a row.
  const networkClass = source['networkClass']
  if (!isFunnelNetworkClass(networkClass)) return null

  const connectionClass = source['connectionClass']
  if (connectionClass !== undefined && !isFunnelConnectionClass(connectionClass)) return null

  return {
    stage,
    kind,
    hourBucket,
    population,
    networkClass,
    ...(connectionClass === undefined ? {} : { connectionClass }),
  }
}
