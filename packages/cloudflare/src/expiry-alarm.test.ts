/**
 * The alarm's subject is the **schedule**, not the sweep.
 *
 * What deleting an expired record and keeping a live one looks like is already proven, at
 * the level it is written, by `packages/libp2p/src/dht-record-sweep.test.ts` against real
 * signed fixtures. Re-proving it here through a second layer would assert the same code
 * twice and leave this file's own subject — that a pass is scheduled, that a pending one is
 * not pushed forward, and that a failing pass still schedules the next — untested behind it.
 *
 * So the datastore below is a recorder. What it lets these cases assert is the **wiring**:
 * that the prefixes the sweep is pointed at are the ones this tier's records live under, and
 * that this node's own peer id reaches the provider sweep, which is the argument
 * `sweepProviderRecords` requires precisely because forgetting it is silent.
 */

import { BaseDatastore } from 'datastore-core'
import { Key } from 'interface-datastore'
import { describe, expect, it } from 'vitest'
import { FakeDurableObjectAlarms } from './do-storage.fixture.ts'
import { EXPIRY_SWEEP_INTERVAL_MS, ExpirySweep, UnarmedSweepError, armExpirySweep } from './expiry-alarm.ts'
import type { KeyQuery, Pair, Query } from 'interface-datastore'

/**
 * A real `Datastore` that records what it was asked.
 *
 * Extends `BaseDatastore` for the same reason `DoDatastore` does, and it is what keeps this
 * fixture honest: the sweep is handed a genuine `Datastore` rather than a narrowed stand-in,
 * so nothing here rests on a type assertion — which this tree does not permit — and the
 * prefix push-down it records is the one the base class actually performs.
 */
class RecordingDatastore extends BaseDatastore {
  readonly queriedPrefixes: (string | undefined)[] = []
  readonly deleted: string[] = []
  #entries: Pair[] = []
  #throwOnQuery = false

  seed(entries: Pair[]): this {
    this.#entries = entries
    return this
  }

  failEveryQuery(): this {
    this.#throwOnQuery = true
    return this
  }

  override async *_all(q: Query): AsyncGenerator<Pair> {
    this.queriedPrefixes.push(q.prefix)
    if (this.#throwOnQuery) throw new Error('storage is unavailable')
    for (const entry of this.#entries) {
      if (q.prefix !== undefined && !entry.key.toString().startsWith(q.prefix)) continue
      yield entry
    }
  }

  override async *_allKeys(q: KeyQuery): AsyncGenerator<Key> {
    // The prefix and nothing else. `KeyQuery`'s filters and orders are typed over `Key`
    // while `Query`'s are typed over `Pair`, so they are not the same shape and forwarding
    // them would be an assertion wearing a spread. The sweep uses neither.
    for await (const entry of this._all(q.prefix === undefined ? {} : { prefix: q.prefix })) {
      yield entry.key
    }
  }

  override async put(key: Key, value: Uint8Array): Promise<Key> {
    this.#entries.push({ key, value })
    return key
  }

  override async get(key: Key): Promise<Uint8Array> {
    const found = this.#entries.find((entry) => entry.key.toString() === key.toString())
    if (found === undefined) throw new Error(`Not Found: ${key.toString()}`)
    return found.value
  }

  override async has(key: Key): Promise<boolean> {
    return this.#entries.some((entry) => entry.key.toString() === key.toString())
  }

  override async delete(key: Key): Promise<void> {
    this.deleted.push(key.toString())
    this.#entries = this.#entries.filter((entry) => entry.key.toString() !== key.toString())
  }
}

const SELF = '12D3KooWSelf'

function newSweep(recorder: RecordingDatastore, alarms: FakeDurableObjectAlarms, now: () => number) {
  return armExpirySweep({ datastore: recorder, alarms, selfPeerId: SELF, now })
}

describe('arming is what a caller gets instead of a flag', () => {
  it('cannot be constructed without going through armExpirySweep', () => {
    // The whole reason `DoDatastore` accepts this object as evidence. Plant that reddens
    // this: drop the `proof !== ARMED` check from the constructor.
    expect(
      () =>
        new ExpirySweep(
          // The guard's subject: any value that is not the private symbol.
          Symbol('forged') as never,
          { datastore: new RecordingDatastore(), alarms: new FakeDurableObjectAlarms(), selfPeerId: SELF },
        ),
    ).toThrow(UnarmedSweepError)
  })

  it('arms the alarm before it hands back the proof', async () => {
    const alarms = new FakeDurableObjectAlarms()
    await newSweep(new RecordingDatastore(), alarms, () => 1_000)

    expect(alarms.setCalls).toEqual([1_000 + EXPIRY_SWEEP_INTERVAL_MS])
  })

  it('does NOT push a pending alarm forward on a second call', async () => {
    // The defect this prevents presents as "expiry works fine in testing": `setAlarm`
    // REPLACES, so arming unconditionally on a per-request path means the busier an object
    // is the further its sweep recedes — and it never fires on the object that needs it
    // most. Plant that reddens this: remove the `getAlarm()` check from `arm()`.
    const alarms = new FakeDurableObjectAlarms()
    let clock = 1_000
    const sweep = await newSweep(new RecordingDatastore(), alarms, () => clock)

    clock = 50_000
    expect(await sweep.arm()).toBe('already-armed')
    expect(alarms.setCalls).toEqual([1_000 + EXPIRY_SWEEP_INTERVAL_MS])
  })

  it('takes its interval from the provider policy rather than a literal of its own', () => {
    // A second number would be free to drift from the first, which is the failure
    // `providerRecordPolicy` exists to prevent. Written as the derivation and not as the
    // value, so changing the fabric's record lifetime moves both together.
    expect(EXPIRY_SWEEP_INTERVAL_MS).toBe(3_600_000 / 4)
  })
})

describe('a pass sweeps both prefixes and re-arms', () => {
  it('points the sweep at both of kad-dht’s own prefixes', async () => {
    const recorder = new RecordingDatastore()
    const sweep = await newSweep(recorder, new FakeDurableObjectAlarms(), () => 1_000)

    await sweep.run()

    // `/dht/record` and `/dht/provider` — where `@libp2p/kad-dht@16.4.0` actually writes,
    // per the table in `do-datastore.ts`. A sweep pointed anywhere else deletes nothing and
    // reports success, which is the quietest possible failure.
    expect(recorder.queriedPrefixes).toEqual(['/dht/record', '/dht/provider'])
  })

  it('re-arms after a normal pass', async () => {
    const alarms = new FakeDurableObjectAlarms()
    let clock = 1_000
    const sweep = await newSweep(new RecordingDatastore(), alarms, () => clock)

    clock = 90_000
    await alarms.fire(async () => sweep.run())

    expect(alarms.setCalls).toEqual([
      1_000 + EXPIRY_SWEEP_INTERVAL_MS,
      90_000 + EXPIRY_SWEEP_INTERVAL_MS,
    ])
  })

  it('RE-ARMS EVEN WHEN THE PASS THREW, and still reports the failure', async () => {
    // The case the `finally` exists for, and the most consequential one in this file. A DO
    // alarm is one-shot: a handler that failed to schedule its successor is expiry that has
    // silently stopped, on an object nobody is watching, with records still arriving. The
    // caller must still see the error — a swallowed failure would be the same defect wearing
    // a green test. Plant that reddens this: move the `setAlarm` out of the `finally` and
    // onto the success path.
    const alarms = new FakeDurableObjectAlarms()
    let clock = 1_000
    const sweep = await newSweep(new RecordingDatastore().failEveryQuery(), alarms, () => clock)

    clock = 90_000
    await alarms.fire(async () => {
      await expect(sweep.run()).rejects.toThrow('storage is unavailable')
    })

    expect(alarms.setCalls).toEqual([
      1_000 + EXPIRY_SWEEP_INTERVAL_MS,
      90_000 + EXPIRY_SWEEP_INTERVAL_MS,
    ])
  })

  it('counts an undecodable entry rather than deleting it', async () => {
    // Reaching through to the sweep's own rule once, because the alarm is what a deployment
    // actually runs and "the pass returns counts" is this layer's contract. The keyspace has
    // validators, so a value that cannot be decoded did not arrive through the write path —
    // deleting it would be this layer inventing a verdict the read path never reached.
    const recorder = new RecordingDatastore().seed([
      { key: new Key('/dht/record/AAAA'), value: new Uint8Array([1, 2, 3]) },
    ])
    const sweep = await newSweep(recorder, new FakeDurableObjectAlarms(), () => 1_000)

    const counts = await sweep.run()

    expect(counts.values.undecodable).toBe(1)
    expect(counts.values.swept).toBe(0)
    expect(recorder.deleted).toEqual([])
  })
})
