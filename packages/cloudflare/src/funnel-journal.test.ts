/**
 * The funnel journal against the real `DoDatastore`, over the storage fixture.
 *
 * Not a mock store, for `relay-service-journal.test.ts`'s stated reason: the two things that
 * could go wrong here are properties of `DoDatastore` rather than of the module under test —
 * that `/journal/` is not one of the namespaces `put` refuses, and that a `Uint8Array`
 * round-trips through it unchanged. A fake datastore would assert neither, and the first is a
 * failure that would arrive at the first visitor on a deployed object rather than here.
 *
 * The claim this file cannot make is the platform's own — that a Durable Object really is
 * evicted and rebuilt over the same storage. What it holds instead is the shape that survives
 * it: two stores constructed over ONE `FakeDurableObjectStorage`, sharing no memo, with the
 * second reading what the first wrote.
 */

import { describe, expect, it } from 'vitest'
import {
  FUNNEL_CELL_BOUNDS,
  FUNNEL_CONNECTION_CLASSES,
  FUNNEL_NETWORK_CLASSES,
  FUNNEL_RECORD_CEILING_BYTES,
  FUNNEL_SCHEMA_DIGEST,
  FUNNEL_STAGES,
} from '@o2/net'
import type { FunnelTotals } from '@o2/net'
import { DoDatastore } from './do-datastore.ts'
import { FakeDurableObjectStorage } from './do-storage.fixture.ts'
import {
  FUNNEL_JOURNAL_KEY,
  FunnelJournalRollbackError,
  FunnelJournalTooLargeError,
  MalformedFunnelJournalError,
  accrueFunnelReport,
  emptyFunnelJournal,
  readFunnelJournal,
  writeFunnelJournal,
} from './funnel-journal.ts'

const DIMS = { country: 'DE', networkClass: 'cellular' } as const

function moved(): FunnelTotals {
  let totals = emptyFunnelJournal('opted-in-only')
  totals = accrueFunnelReport(
    totals,
    { stage: 'page-load', kind: 'entered', hourBucket: 9, population: 'opted-in-only' },
    DIMS,
  )
  totals = accrueFunnelReport(
    totals,
    { stage: 'ice-gathering', kind: 'entered', hourBucket: 9, population: 'opted-in-only' },
    DIMS,
  )
  totals = accrueFunnelReport(
    totals,
    {
      stage: 'connection-classified',
      kind: 'entered',
      hourBucket: 9,
      population: 'opted-in-only',
      connectionClass: 'relayed',
    },
    DIMS,
  )
  return accrueFunnelReport(
    totals,
    { stage: 'first-task', kind: 'stalled', hourBucket: 9, population: 'opted-in-only' },
    DIMS,
  )
}

describe('the funnel record round-trips through the store the deployed object actually uses', () => {
  it('answers six honest zeros for an object that has never banked a report', async () => {
    const store = new DoDatastore(new FakeDurableObjectStorage())
    const read = await readFunnelJournal(store, 'opted-in-only')
    // Literals, all six. A missing field is not a reading; two zeroed columns is.
    expect(read.entered).toEqual({
      'page-load': 0,
      consent: 0,
      'wss-bootstrap': 0,
      'ice-gathering': 0,
      'connection-classified': 0,
      'first-task': 0,
    })
    expect(read.stalledAt).toEqual(read.entered)
    expect(read.byStageHour).toEqual({})
    expect(read.population).toBe('opted-in-only')
    expect(read.schemaDigest).toBe(FUNNEL_SCHEMA_DIGEST)
  })

  it('is admitted by `DoDatastore.put`, which refuses `/dht/` and `/o2/`', async () => {
    const store = new DoDatastore(new FakeDurableObjectStorage())
    // The property, not the sentence in the docblock. A key under either refused namespace
    // would make every bank throw on a deployed object and nowhere else.
    await expect(writeFunnelJournal(store, moved(), 'opted-in-only')).resolves.toBeDefined()
    expect(FUNNEL_JOURNAL_KEY.toString()).toBe('/journal/funnel')
  })

  it('survives the store being reconstructed — which is what eviction looks like', async () => {
    const storage = new FakeDurableObjectStorage()
    const banked = moved()
    await writeFunnelJournal(new DoDatastore(storage), banked, 'opted-in-only')

    // A SECOND store over the same storage, sharing no state with the first.
    const read = await readFunnelJournal(new DoDatastore(storage), 'opted-in-only')
    expect(read.entered['page-load']).toBe(1)
    expect(read.entered['ice-gathering']).toBe(1)
    expect(read.stalledAt['first-task']).toBe(1)
    expect(read.webrtcAttempts['DE|cellular']).toBe(1)
    expect(read.webrtcOutcomes['DE|cellular|relayed']).toBe(1)
    expect(read.byStageHour['page-load|9']).toBe(1)
  })

  it('refuses a total lower than the stored one, by name', async () => {
    const storage = new FakeDurableObjectStorage()
    const store = new DoDatastore(storage)
    await writeFunnelJournal(store, moved(), 'opted-in-only')

    // The failure this refusal exists for: a caller that never restored, offering a record
    // built from zero. On a deployed object this is what an alarm on a fresh instance looks
    // like, and the write would erase the whole funnel while every reading stayed plausible.
    const unrestored = emptyFunnelJournal('opted-in-only')
    await expect(writeFunnelJournal(store, unrestored, 'opted-in-only')).rejects.toBeInstanceOf(
      FunnelJournalRollbackError,
    )
    // And the store still holds what it held.
    expect((await readFunnelJournal(store, 'opted-in-only')).entered['page-load']).toBe(1)
  })

  it('refuses a lower CELL as well as a lower stage counter', async () => {
    const storage = new FakeDurableObjectStorage()
    const store = new DoDatastore(storage)
    const banked = moved()
    await writeFunnelJournal(store, banked, 'opted-in-only')

    // Every stage counter is untouched; one country/class cell goes backwards. Without the
    // cell loop this passes, and the loss is invisible because no route reports one cell.
    const shrunk: FunnelTotals = {
      ...banked,
      webrtcOutcomes: { ...banked.webrtcOutcomes, 'DE|cellular|relayed': 0 },
    }
    await expect(writeFunnelJournal(store, shrunk, 'opted-in-only')).rejects.toBeInstanceOf(
      FunnelJournalRollbackError,
    )
  })

  /**
   * **This case was written first as `{"entered":"nope"}` and that version proved nothing.**
   * Planting a silent reset into the counter validation left it GREEN, because a record that
   * bare also has no `population` and no `schemaDigest`, and those two checks were carrying the
   * assertion. The case now stores an OTHERWISE VALID record with one malformed counter, so the
   * only thing that can refuse it is the check this case claims to be about.
   */
  it('refuses one malformed counter inside an otherwise valid record', async () => {
    const store = new DoDatastore(new FakeDurableObjectStorage())
    const almost = { ...moved(), entered: { ...moved().entered, consent: 'nope' } }
    await store.put(FUNNEL_JOURNAL_KEY, new TextEncoder().encode(JSON.stringify(almost)))
    // A silent reset would make the funnel's history vanish while every reading still looked
    // plausible — six zeros is exactly what a fresh object answers, so the disguise is perfect.
    await expect(readFunnelJournal(store, 'opted-in-only')).rejects.toBeInstanceOf(
      MalformedFunnelJournalError,
    )
  })

  it('refuses a counter map that is not a map', async () => {
    const store = new DoDatastore(new FakeDurableObjectStorage())
    const almost = { ...moved(), byStageHour: 'nope' }
    await store.put(FUNNEL_JOURNAL_KEY, new TextEncoder().encode(JSON.stringify(almost)))
    await expect(readFunnelJournal(store, 'opted-in-only')).rejects.toBeInstanceOf(
      MalformedFunnelJournalError,
    )
  })

  it('refuses a record with no population, because a count without one is not readable', async () => {
    const store = new DoDatastore(new FakeDurableObjectStorage())
    const { population, ...withoutPopulation } = moved()
    void population
    await store.put(
      FUNNEL_JOURNAL_KEY,
      new TextEncoder().encode(JSON.stringify(withoutPopulation)),
    )
    await expect(readFunnelJournal(store, 'opted-in-only')).rejects.toBeInstanceOf(
      MalformedFunnelJournalError,
    )
  })

  it('refuses a stored value that is not JSON at all', async () => {
    const store = new DoDatastore(new FakeDurableObjectStorage())
    await store.put(FUNNEL_JOURNAL_KEY, new TextEncoder().encode('not json'))
    await expect(readFunnelJournal(store, 'opted-in-only')).rejects.toBeInstanceOf(
      MalformedFunnelJournalError,
    )
  })
})

describe('the encoded record stays inside the ceiling the schema derives', () => {
  /**
   * Every map saturated at its own longest key — the worst case the closed lists admit.
   *
   * Not a sample: the country dimension is filled with all 676 two-letter codes, every network
   * class and every connection class, which is the whole key space and not a plausible slice of
   * it. A ceiling checked against a plausible record would be a ceiling nobody had tested.
   */
  function saturated(): FunnelTotals {
    const totals = emptyFunnelJournal('opted-in-only')
    const entered = { ...totals.entered }
    const stalledAt = { ...totals.stalledAt }
    for (const stage of FUNNEL_STAGES) {
      entered[stage] = 4_294_967_295
      stalledAt[stage] = 4_294_967_295
    }
    const byStageHour: Record<string, number> = {}
    for (const stage of FUNNEL_STAGES) {
      for (let hour = 0; hour < 24; hour += 1) {
        byStageHour[`${stage}|${String(hour)}`] = 4_294_967_295
      }
    }
    const webrtcAttempts: Record<string, number> = {}
    const webrtcOutcomes: Record<string, number> = {}
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')
    for (const a of letters) {
      for (const b of letters) {
        for (const netClass of FUNNEL_NETWORK_CLASSES) {
          webrtcAttempts[`${a}${b}|${netClass}`] = 4_294_967_295
          for (const connClass of FUNNEL_CONNECTION_CLASSES) {
            webrtcOutcomes[`${a}${b}|${netClass}|${connClass}`] = 4_294_967_295
          }
        }
      }
    }
    return { ...totals, entered, stalledAt, byStageHour, webrtcAttempts, webrtcOutcomes }
  }

  it('a saturated record is every cell the schema admits, and no more', () => {
    const record = saturated()
    const cells =
      Object.keys(record.entered).length +
      Object.keys(record.stalledAt).length +
      Object.keys(record.byStageHour).length +
      Object.keys(record.webrtcAttempts).length +
      Object.keys(record.webrtcOutcomes).length
    // 13 676, the literal. The floor for the ceiling case below: a "saturated" record that was
    // actually small would pass any ceiling at all.
    expect(cells).toBe(13_676)
    expect(FUNNEL_CELL_BOUNDS.reduce((total, bound) => total + bound.cells, 0)).toBe(cells)
  })

  it('encodes under the derived ceiling, with the measured byte size recorded', () => {
    const encoded = new TextEncoder().encode(JSON.stringify(saturated()))
    // The number this run measured, printed so a reader of the SUMMARY does not have to guess
    // what the margin actually was.
    expect(
      encoded.byteLength,
      `a saturated funnel record encodes to ${String(encoded.byteLength)} B against a derived ` +
        `ceiling of ${String(FUNNEL_RECORD_CEILING_BYTES)} B`,
    ).toBeLessThan(FUNNEL_RECORD_CEILING_BYTES)
  })

  it('refuses to bank a record past the ceiling', async () => {
    const store = new DoDatastore(new FakeDurableObjectStorage())
    // A key space that grew past what the schema says is closed — the accumulation window
    // `DoDatastore`'s namespace refusals exist to keep shut, arriving under `/journal/` where
    // those refusals do not reach.
    const overflowing: FunnelTotals = {
      ...emptyFunnelJournal('opted-in-only'),
      webrtcOutcomes: Object.fromEntries(
        Array.from({ length: 40_000 }, (_, index) => [`overflow-cell-${String(index)}`, 1]),
      ),
    }
    await expect(writeFunnelJournal(store, overflowing, 'opted-in-only')).rejects.toBeInstanceOf(
      FunnelJournalTooLargeError,
    )
  })
})

describe('one report moves one drop counter and no other', () => {
  it('a stall at one stage moves exactly that stalledAt and nothing else', () => {
    const before = emptyFunnelJournal('opted-in-only')
    const after = accrueFunnelReport(
      before,
      { stage: 'wss-bootstrap', kind: 'stalled', hourBucket: 3, population: 'opted-in-only' },
      DIMS,
    )
    expect(after.stalledAt['wss-bootstrap']).toBe(1)
    for (const stage of FUNNEL_STAGES) {
      if (stage === 'wss-bootstrap') continue
      expect(after.stalledAt[stage], `${stage} moved on a stall at wss-bootstrap`).toBe(0)
    }
    // And no `entered` moved: a stall is not an arrival.
    for (const stage of FUNNEL_STAGES) expect(after.entered[stage]).toBe(0)
  })

  it('does not mutate the record it was given', () => {
    const before = emptyFunnelJournal('opted-in-only')
    accrueFunnelReport(
      before,
      { stage: 'consent', kind: 'entered', hourBucket: 0, population: 'opted-in-only' },
      DIMS,
    )
    // A half-applied record that was then banked would be a rollback waiting to happen.
    expect(before.entered['consent']).toBe(0)
  })

  it('files a control-only pair as its own outcome, never as a relayed one', () => {
    const after = accrueFunnelReport(
      emptyFunnelJournal('opted-in-only'),
      {
        stage: 'connection-classified',
        kind: 'entered',
        hourBucket: 12,
        population: 'opted-in-only',
        connectionClass: 'control-only',
      },
      DIMS,
    )
    expect(after.webrtcOutcomes['DE|cellular|control-only']).toBe(1)
    expect(after.webrtcOutcomes['DE|cellular|relayed']).toBeUndefined()
  })
})
