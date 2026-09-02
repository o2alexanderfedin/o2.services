import { describe, expect, it } from 'vitest'
import {
  canonicalFunnelSchema,
  emptyFunnelTotals,
  FUNNEL_CELL_BOUNDS,
  FUNNEL_CONNECTION_CLASSES,
  FUNNEL_FIELDS,
  FUNNEL_MAX_CELLS,
  FUNNEL_NETWORK_CLASSES,
  FUNNEL_POPULATION,
  FUNNEL_QUESTIONS,
  FUNNEL_RECORD_CEILING_BYTES,
  FUNNEL_SCHEMA_DIGEST,
  FUNNEL_STAGES,
  FUNNEL_UNKNOWN_COUNTRY,
  funnelSchemaDigest,
  isFunnelCountry,
  isFunnelHourBucket,
  isFunnelNetworkClass,
  MEASURED_STORAGE_WALL_BYTES,
  parseFunnelReport,
} from './funnel-schema.ts'

/**
 * The freeze, and the three questions it is a freeze over — RUN-05, criterion 3.
 *
 * A plain `.test.ts`, so it runs in **both** the node and the browser lane. That is what a
 * portable module deserves and it is also the property being asserted: the schema is a
 * contract between a browser tab and a Durable Object, and a guard that only ever ran in one
 * runtime would be checking one end of it.
 *
 * ## What each case is for
 *
 * Criterion 3's sentence is *"a field that answers none of the three is not collected, and
 * adding a field after recruitment begins breaks the freeze rather than improving the
 * dataset."* Those are two different failures with two different cases below, and the
 * digest case cannot catch the first: a seventh field that answers a real question moves the
 * digest, and a field answering nothing at all would also move it — but a field answering
 * nothing that was in the schema when the digest was written would not. The question mapping
 * is checked directly for that reason.
 *
 * The floor case exists because cases 2 and 4 both pass perfectly over an empty list.
 */
describe('the funnel schema is designed backward from exactly three questions', () => {
  it('asks exactly three questions, and the count is a literal', () => {
    // The literal 3, never `FUNNEL_QUESTIONS.length`. An assertion that reads the value it
    // tests moves with it, and this repository has twice had a plant stay green that way.
    expect(FUNNEL_QUESTIONS.length).toBe(3)
    expect([...FUNNEL_QUESTIONS]).toEqual([
      'scaling-curve',
      'webrtc-failure-by-country-and-class',
      'diurnal-churn',
    ])
  })

  it('collects no field that answers none of the three questions', () => {
    const known = new Set<string>(FUNNEL_QUESTIONS)
    for (const field of FUNNEL_FIELDS) {
      expect(
        field.answers.length,
        `RUN-05: the field "${field.name}" answers none of the three questions, so it is not ` +
          'collected. Either name the question it answers or delete the field — criterion 3 ' +
          'does not have a third option.',
      ).toBeGreaterThan(0)
      for (const question of field.answers) {
        expect(
          known.has(question),
          `RUN-05: the field "${field.name}" answers "${question}", which is not one of the ` +
            `three questions (${FUNNEL_QUESTIONS.join(', ')}). Adding a question is a change ` +
            'to what this project collects about people and is not an edit to this line.',
        ).toBe(true)
      }
    }
  })

  it('names six stages, in the order the success criterion states them', () => {
    // Six string literals, written out. The list is the contract, and restating it from
    // itself would assert nothing about what it holds.
    expect([...FUNNEL_STAGES]).toEqual([
      'page-load',
      'consent',
      'wss-bootstrap',
      'ice-gathering',
      'connection-classified',
      'first-task',
    ])
    expect(FUNNEL_STAGES.length).toBe(6)
  })

  it('the freeze: the recomputed digest still equals the hand-written one', () => {
    expect(
      funnelSchemaDigest(),
      'RUN-05: the telemetry schema has MOVED — the field set, a question mapping or a value ' +
        'domain differs from the one FUNNEL_SCHEMA_DIGEST was written against on ' +
        'FUNNEL_SCHEMA_FROZEN_AT. Once recruitment has begun the correct response is to REVERT ' +
        'the field, not to update the digest: a dataset whose schema moved mid-collection is ' +
        'two datasets wearing one name. Before recruitment, update the literal deliberately ' +
        'and say in the commit which question the change serves.',
    ).toBe(FUNNEL_SCHEMA_DIGEST)
  })

  it('the floor: the field set is real and every stage is reachable through it', () => {
    // Without this, the two cases above pass over an empty list — nothing to find is not the
    // same as nothing wrong.
    expect(FUNNEL_FIELDS.length).toBeGreaterThan(0)
    const stageField = FUNNEL_FIELDS.find((field) => field.name === 'stage')
    expect(stageField, 'RUN-05: no field names the stage, so no count can be attributed to one')
      .toBeDefined()
    // Every stage is a value the `stage` field admits — so the six counters below are the six
    // names above rather than an overlapping set that happens to be the same length.
    const domain = stageField?.domain
    expect(Array.isArray(domain)).toBe(true)
    for (const stage of FUNNEL_STAGES) {
      expect(
        (domain as readonly string[]).includes(stage),
        `RUN-05: the stage "${stage}" is not in the stage field's domain, so nothing collected ` +
          'can ever be filed under it',
      ).toBe(true)
    }
    // The canonical rendering is what the digest is taken over. A rendering that stopped
    // including the fields would make case 4 a comparison of two constants.
    const canonical = canonicalFunnelSchema()
    for (const field of FUNNEL_FIELDS) expect(canonical).toContain(field.name)
    for (const stage of FUNNEL_STAGES) expect(canonical).toContain(stage)
    for (const question of FUNNEL_QUESTIONS) expect(canonical).toContain(question)
  })
})

describe('the values are coarse by construction', () => {
  it('a country is two uppercase letters and nothing else', () => {
    expect(isFunnelCountry('DE')).toBe(true)
    expect(isFunnelCountry(FUNNEL_UNKNOWN_COUNTRY)).toBe(true)
    for (const refused of ['de', 'DEU', 'D', '', 'D1', 'DE-NW', ' DE', 12, null, undefined]) {
      expect(isFunnelCountry(refused), `${JSON.stringify(refused)} is not a country code`).toBe(
        false,
      )
    }
  })

  it('the network class is a closed list ending in unknown', () => {
    expect(FUNNEL_NETWORK_CLASSES[FUNNEL_NETWORK_CLASSES.length - 1]).toBe('unknown')
    for (const one of FUNNEL_NETWORK_CLASSES) expect(isFunnelNetworkClass(one)).toBe(true)
    // A value the platform might plausibly hand over, refused because the list is closed.
    expect(isFunnelNetworkClass('slow-2g')).toBe(false)
    expect(isFunnelNetworkClass('WIFI')).toBe(false)
  })

  it('an hour bucket is an hour and not a timestamp', () => {
    expect(isFunnelHourBucket(0)).toBe(true)
    expect(isFunnelHourBucket(23)).toBe(true)
    expect(isFunnelHourBucket(24)).toBe(false)
    expect(isFunnelHourBucket(-1)).toBe(false)
    expect(isFunnelHourBucket(13.5)).toBe(false)
    // The failure this bound exists for: a caller passing the clock straight through.
    expect(isFunnelHourBucket(1_756_800_000_000)).toBe(false)
  })

  it('a connection that carries no work is not reported as one that does', () => {
    expect([...FUNNEL_CONNECTION_CLASSES]).toEqual(['direct', 'relayed', 'control-only'])
  })

  it('every report carries one of the two populations', () => {
    expect([...FUNNEL_POPULATION]).toEqual(['opted-in-only', 'all-visitors'])
  })
})

describe('the stored record is bounded by construction', () => {
  it('derives its cell count from the closed lists rather than restating it', () => {
    // 13 676, written as the literal it is. The arithmetic is in the module; this is the
    // reading, and a reading that recomputed the sum would agree with any sum.
    expect(FUNNEL_MAX_CELLS).toBe(13_676)
    expect(FUNNEL_CELL_BOUNDS.map((bound) => bound.map)).toEqual([
      'entered',
      'stalledAt',
      'byStageHour',
      'webrtcAttempts',
      'webrtcOutcomes',
    ])
  })

  it('sits inside the measured storage wall with room to spare', () => {
    // The wall is `do-datastore.ts:231` — smallest refused 4 194 304 B, bisected against real
    // `put` calls. Two numbers rather than one: that is a fact about Cloudflare and the
    // ceiling is a fact about this schema.
    expect(MEASURED_STORAGE_WALL_BYTES).toBe(4_194_304)
    expect(FUNNEL_RECORD_CEILING_BYTES).toBeLessThan(MEASURED_STORAGE_WALL_BYTES)
    // And by more than a rounding: a schema change that ate the headroom silently is the
    // failure this asserts against.
    expect(FUNNEL_RECORD_CEILING_BYTES * 4).toBeLessThan(MEASURED_STORAGE_WALL_BYTES)
  })

  it('a fresh record is six honest zeros, never a missing field', () => {
    const empty = emptyFunnelTotals('opted-in-only')
    for (const stage of FUNNEL_STAGES) {
      expect(empty.entered[stage]).toBe(0)
      expect(empty.stalledAt[stage]).toBe(0)
    }
    expect(Object.keys(empty.entered).length).toBe(6)
    expect(empty.population).toBe('opted-in-only')
    expect(empty.schemaDigest).toBe(FUNNEL_SCHEMA_DIGEST)
  })
})

describe('a report is parsed strictly and nothing is defaulted', () => {
  const valid = {
    stage: 'ice-gathering',
    kind: 'entered',
    hourBucket: 14,
    population: 'opted-in-only',
  }

  it('accepts a well-formed report', () => {
    expect(parseFunnelReport(valid)).toEqual(valid)
  })

  it('refuses a stage the frozen list does not have', () => {
    expect(parseFunnelReport({ ...valid, stage: 'ice-gathered' })).toBeNull()
  })

  it('refuses a missing field rather than filling in a plausible one', () => {
    // A collector that defaulted a missing hour to the current one would be fabricating a row,
    // and a fabricated row is indistinguishable from a measured one once it is in the store.
    for (const field of ['stage', 'kind', 'hourBucket', 'population']) {
      const partial: Record<string, unknown> = { ...valid }
      delete partial[field]
      expect(parseFunnelReport(partial), `a report with no ${field} was accepted`).toBeNull()
    }
  })

  it('refuses a clock where an hour belongs', () => {
    expect(parseFunnelReport({ ...valid, hourBucket: 1_756_800_000_000 })).toBeNull()
    expect(parseFunnelReport({ ...valid, hourBucket: 24 })).toBeNull()
  })

  it('refuses a connection class outside the closed list, and allows its absence', () => {
    expect(parseFunnelReport({ ...valid, connectionClass: 'webrtc' })).toBeNull()
    expect(parseFunnelReport({ ...valid, connectionClass: 'control-only' })).toEqual({
      ...valid,
      connectionClass: 'control-only',
    })
  })

  it('carries no field the schema does not name, however the sender spells it', () => {
    // The failure this closes: a sender adding a field, and a permissive parse letting it into
    // the store. Everything outside the schema is dropped at the door rather than at the write.
    const parsed = parseFunnelReport({ ...valid, visitHandle: 'a1b2c3d4e5f6a7b8', ip: '1.2.3.4' })
    expect(parsed).not.toBeNull()
    expect(JSON.stringify(parsed)).not.toContain('a1b2c3d4')
    expect(JSON.stringify(parsed)).not.toContain('1.2.3.4')
  })

  it('refuses a body that is not an object at all', () => {
    for (const refused of [null, 'string', 42, [], undefined]) {
      expect(parseFunnelReport(refused)).toBeNull()
    }
  })
})
