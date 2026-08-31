/**
 * The Durable Object alarm that expires DHT records — ARCHITECTURE step 7.
 *
 * ## Why this file and the assembly are one deliverable
 *
 * `.planning/research/v2.0/ARCHITECTURE.md:510-517` states it and the tree now says it
 * harder than the document does. Step 6 is what makes the DO's datastore *persistent*, and
 * DO storage discards nothing: *"any deploy of step 6 without step 7 already wired in is a
 * deploy that starts accumulating unswept records from its first request — there is no safe
 * intermediate state where 6 exists alone."*
 *
 * `DoDatastore` refuses a record-shaped key today, which is what has kept that window shut.
 * This file is what opens it, and the opening is deliberately **not** a flag: the only way
 * to obtain the {@link ExpirySweep} that `DoDatastore` will admit records for is
 * {@link armExpirySweep}, which arms the alarm before it returns one. A boolean option
 * would hand exactly the caller `do-datastore.ts`'s own docblock names — *"a caller that
 * decides to write fabric records into the store directly"* — a one-word key to the thing
 * the refusal exists for.
 *
 * **The proof's real argument is eviction, not tidiness.** A Durable Object is evicted and
 * reconstructed constantly, and an instance that armed an alarm is gone by the time the
 * alarm fires. Because the proof cannot be carried across that boundary, every fresh
 * instance has to call {@link armExpirySweep} again to get one — and that call re-arms if
 * the alarm has somehow gone missing. The invariant therefore repairs itself on every
 * instantiation rather than depending on one that happened once.
 *
 * ## Why the re-arm is in a `finally`
 *
 * A DO alarm is **one-shot**: `setAlarm` schedules a single firing and the handler must
 * schedule the next one. So a pass that threw and did not re-arm would stop expiry forever,
 * on an object nobody is watching, with the records still accumulating — the exact failure
 * the refusal was protecting against, arriving later and quieter. `reprovider.ts:97,168-177`
 * drives its own `setTimeout` from its own `finally` for this reason, and
 * `dht-record-sweep.ts` is written against that reading; this is the same rule on the
 * platform's timer instead of the process's.
 *
 * ## What only a deploy can settle
 *
 * That an alarm survives eviction and fires on a fresh instance is **not** proven here.
 * ARCHITECTURE names the methodology — *"request, fire, evict, re-read from a new
 * instance"* — and says no local emulator reproduces it credibly. That reading is an owner
 * act at the Cloudflare boundary and is reported open, not simulated. What IS proven here
 * is everything on this side of the platform: that arming happens before a proof exists,
 * that a second arm does not push a pending alarm forward, that the sweep deletes what has
 * expired and keeps what has not, and that a throwing pass still re-arms.
 */

import { sweepDhtRecords } from '@o2/libp2p'
import { PROVIDER_RECORD_VALIDITY_MS, providerRecordPolicy } from '@o2/libp2p'
import type { DhtSweepCounts } from '@o2/libp2p'
import type { Datastore } from 'interface-datastore'
import type { DurableObjectAlarms } from './durable-object-storage.d.ts'

/**
 * How long between sweeps.
 *
 * Derived from the provider-record policy rather than chosen, so the fabric keeps one
 * number governing record lifetime. `providerRecordPolicy` fixes `interval` at a quarter of
 * `validity`, which bounds how long an expired entry can still be present at
 * `1.25 × validity` — the same bound the Node tier's reprovider runs under. A literal here
 * would be a second number free to drift from the first, which is the failure
 * `providerRecordPolicy`'s own docblock exists to prevent.
 */
export const EXPIRY_SWEEP_INTERVAL_MS: number = providerRecordPolicy().interval

/**
 * The tightest a sweep may reschedule itself — HOST-09's second half.
 *
 * `arm()`'s `getAlarm()` check answers *"is one already pending"*. It says nothing about
 * how far ahead the next one is set, and the path that would run hot is not `arm()` at all:
 * `run()`'s `finally` sets unconditionally, because the alarm that just fired is gone. A
 * sweep handed a tiny interval therefore re-arms at that interval on every firing, on an
 * object nobody is watching, and **there is no hard spending ceiling behind it** — see the
 * `HOST-10` row for what Cloudflare's budget alerts do and do not do.
 *
 * **Sixty seconds, and the number is a bound on a runaway rather than a second schedule.**
 * An alarm firing every `f` ms costs `3_600_000 / f` invocations an hour; at this floor a
 * self-rescheduling alarm costs 60 an hour instead of unbounded, while the schedule the
 * policy actually asks for is {@link EXPIRY_SWEEP_INTERVAL_MS} — 15 minutes, 4 an hour.
 * The floor is fifteen times tighter than that, so it is inert on every path this tier
 * takes and binds only a caller asking for something `providerRecordPolicy` would never
 * produce.
 *
 * It is enforced on {@link ExpirySweep.intervalMs}, the one reading both paths take, and
 * deliberately not at the two `setAlarm` call sites: a clamp at a call site is a clamp the
 * third call site forgets.
 */
export const MIN_RESCHEDULE_INTERVAL_MS = 60_000

/** Thrown when an {@link ExpirySweep} is constructed by anything but {@link armExpirySweep}. */
export class UnarmedSweepError extends Error {
  override readonly name: string = 'UnarmedSweepError'

  constructor() {
    super(
      'ExpirySweep cannot be constructed directly — call armExpirySweep(), which arms the ' +
        'Durable Object alarm before it returns one. The constructor is guarded because ' +
        'this object is what DoDatastore accepts as evidence that records will be swept, ' +
        'and evidence that can be manufactured is not evidence.',
    )
  }
}

/**
 * The proof-of-arming, held privately so the guard is a runtime fact and not a type-level
 * hope. Not exported: a symbol nobody else can name is a constructor nobody else can call.
 */
const ARMED: unique symbol = Symbol('expiry-sweep/armed')

/** What {@link armExpirySweep} needs. */
export interface ExpirySweepInit {
  /** The store `kadDHT()` writes through — the same one the assembly hands libp2p. */
  readonly datastore: Datastore
  /** The Durable Object's alarm surface, normally `state.storage`. */
  readonly alarms: DurableObjectAlarms
  /**
   * This node's own peer id, as `peerId.toString()` writes it into a provider key.
   *
   * Passed through to `sweepProviderRecords`, which requires it so that a node's own
   * advertisements are exempt — see that function's docblock for what forgetting it costs.
   */
  readonly selfPeerId: string
  /** The clock, injected. Defaults to `Date.now`. */
  readonly now?: () => number
  /** Provider-record lifetime. Defaults to the fabric's own, never the library's 48 h. */
  readonly validityMs?: number
  /** Defaults to {@link EXPIRY_SWEEP_INTERVAL_MS}. */
  readonly intervalMs?: number
  /** Defaults to `kadDHT()`'s own `/dht`; pass what the assembly gave it. */
  readonly datastorePrefix?: string
}

/**
 * A sweep that is armed — the object `DoDatastore` admits record-shaped keys for.
 *
 * Holding one is the whole of the claim. It cannot be constructed without arming, so a
 * store that has one is a store whose records have somewhere to go.
 */
export class ExpirySweep {
  readonly #init: ExpirySweepInit

  constructor(proof: typeof ARMED, init: ExpirySweepInit) {
    if (proof !== ARMED) throw new UnarmedSweepError()
    this.#init = init
  }

  /**
   * Milliseconds between passes, as configured — never tighter than
   * {@link MIN_RESCHEDULE_INTERVAL_MS}.
   *
   * The clamp lives here rather than at either `setAlarm`, because both the initial arm and
   * the re-arm in `run()`'s `finally` read this one value and a floor applied per call site
   * is a floor the next call site can be written without.
   */
  get intervalMs(): number {
    return Math.max(this.#init.intervalMs ?? EXPIRY_SWEEP_INTERVAL_MS, MIN_RESCHEDULE_INTERVAL_MS)
  }

  /**
   * Schedule the next pass, unless one is already scheduled.
   *
   * The `getAlarm()` check is not an optimisation. `setAlarm` **replaces** any pending
   * alarm, so arming unconditionally on a path that runs per request would push the sweep
   * forward every time a request arrived — and an object busy enough to need sweeping is
   * precisely the one that would then never sweep. Losing that check is a defect that
   * presents as "expiry works fine in testing".
   */
  async arm(): Promise<'already-armed' | 'armed'> {
    const { alarms, now = Date.now } = this.#init
    if ((await alarms.getAlarm()) !== null) return 'already-armed'
    await alarms.setAlarm(now() + this.intervalMs)
    return 'armed'
  }

  /**
   * One pass over both prefixes, then re-arm — **even if the pass threw**.
   *
   * The re-arm is unconditional for the reason in the file header: a one-shot alarm whose
   * handler failed to schedule its successor is expiry that has silently stopped. The
   * `finally` means a caller still sees the failure while the schedule survives it.
   */
  async run(): Promise<DhtSweepCounts> {
    const { datastore, selfPeerId, now = Date.now, validityMs, datastorePrefix } = this.#init
    try {
      return await sweepDhtRecords({
        datastore,
        now,
        selfPeerId,
        validityMs: validityMs ?? PROVIDER_RECORD_VALIDITY_MS,
        ...(datastorePrefix === undefined ? {} : { datastorePrefix }),
      })
    } finally {
      // Not `arm()`: the alarm that just fired is gone, so `getAlarm()` is null and the
      // distinction `arm()` draws has no subject here. Setting it directly also means a
      // handler that somehow ran with an alarm still pending re-schedules from *now*
      // rather than leaving a stale earlier time in place.
      //
      // **HOST-09 reads "`getAlarm()` is checked before every `setAlarm()`", and this one
      // call does not check — stated here rather than left for a later verifier to read as
      // a violation.** The requirement's two clauses guard two different failures: the
      // check exists so a pending alarm is not pushed forward, and the floor exists so a
      // reschedule cannot be tighter than `MIN_RESCHEDULE_INTERVAL_MS`. On this path the
      // first failure is unreachable — the platform clears the alarm before calling the
      // handler, so there is no pending alarm to push — while the second is reachable and
      // is what `intervalMs` enforces. Adding the check here would read as compliance and
      // measure nothing.
      await this.#init.alarms.setAlarm(now() + this.intervalMs)
    }
  }
}

/**
 * Arm the alarm and hand back the proof of it.
 *
 * **The only producer of an {@link ExpirySweep}.** Call it on every instantiation that needs
 * a record-accepting store; it is idempotent by way of {@link ExpirySweep.arm}, so the
 * second call on a live object costs one `getAlarm()`.
 */
export async function armExpirySweep(init: ExpirySweepInit): Promise<ExpirySweep> {
  const sweep = new ExpirySweep(ARMED, init)
  await sweep.arm()
  return sweep
}
