import { Key } from 'interface-datastore'
import type { Datastore } from 'interface-datastore'
import { DEFAULT_ISSUANCE_WINDOW_MS, EnrollmentAuthority } from '@o2/core'
import type { CanonicalValue, IssuanceLedger, PublicKeyHex } from '@o2/core'
import { certifyFreshly, encodeResponse, parseRequest, serveReservations } from '@o2/net'
import type { RpcHandler, RpcReply } from '@o2/net'

/**
 * The hosted tier issues certificates — AUTH-01 on Cloudflare, and the thing Phase 39 was
 * actually blocked on.
 *
 * ## Why this exists, measured rather than assumed
 *
 * On 2026-09-09 the TURN rung was found to be unreachable by every visitor to the published
 * page, and the credential model was only the smallest of four reasons. The last one was this:
 * **the gate admits by certificate and a visitor holds none.** `bootstrap.json` names no
 * `enrollmentProvider`, so nothing offers enrolment; and there was nothing it could have named,
 * because `hosted-libp2p.ts` constructed no {@link EnrollmentAuthority} and
 * `packages/net/src/agent.ts` — the only place one was ever built — does not run on this tier.
 * Posting a tab-shaped body to the live route answered `400 malformed-request`.
 *
 * The owner ruled on 2026-09-09: make enrolment real rather than loosen the gate.
 *
 * ## The throttle is the on-switch, and that is the owner's requirement made structural
 *
 * The instruction was *«throttle на выдачу сертификатов, чтобы невозможно было нахуячить много
 * за короткое время»*, and then *«throttle глобальный, вне зависимости от того, кто зашёл»*.
 * That is `AuthorityOptions.maxIssuedPerWindow` exactly — the **aggregate** budget, which
 * `enrollment.ts` already says is the only one that bounds an attacker, because everything in
 * a request is requester-chosen and a fresh user key is one `ed25519.keygen()`.
 *
 * So there is no separate enable flag. **Absence of the budget means this tier issues nothing**
 * ({@link hostedEnrolment} answers `'issues-no-certificates'`), which makes it impossible to
 * turn issuance on without stating what bounds it. A flag plus a number would have permitted
 * the one state nobody wants: issuing, unbounded, because a second variable was forgotten.
 *
 * ## Durability is what makes the throttle real, and its absence is what would defeat it
 *
 * `enrollment.ts` records the measurement: *"a second provider process starts with an empty
 * history, so the same user key is accepted again immediately"* — which is why the sentinel
 * `'remembers-only-within-this-process'` must be asked for **by name**. A Durable Object is
 * evicted between requests as a matter of course, so taking that sentinel here would reset the
 * window on every eviction and the global budget would bound nothing at all, with nothing
 * anywhere failing. {@link HostedIssuance} is therefore not an optimisation; it is the
 * difference between a throttle and a comment describing one.
 *
 * ## Synchronous port, asynchronous storage — the one real design problem
 *
 * {@link IssuanceLedger} is **synchronous by requirement**, and `enrollment.ts` says why in as
 * many words: `EnrollmentAuthority.enrol` is fully synchronous, and *that* is why
 * `agent.ts`'s enrol branch takes no capacity slot — nothing can interleave around a
 * synchronous call. An `await` inside the port would silently invalidate a recorded argument in
 * a file nothing here opens.
 *
 * So the storage read happens **before** the authority is called and the write **after**:
 * {@link loadIssuance} reads, `enrol` runs synchronously against what was read, and
 * {@link HostedIssuance.flush} persists what it recorded. That is the same read-modify-write
 * shape `funnel-journal.ts` and `relay-service-journal.ts` already use on this tier, and it is
 * safe here for the reason it is safe there: a Durable Object runs one request at a time by the
 * platform's own input-gate rule, so no second request can interleave between the read and the
 * write.
 *
 * ## Two storage keys, not one, and the reason is size rather than tidiness
 *
 * The aggregate budget needs every timestamp in the window; the per-user budget needs only the
 * asking key's. Keeping both in one value would make the row grow with the number of *distinct
 * users* in a window, which at cohort scale is the same as the budget — and this repository does
 * not know Cloudflare's per-value size limit, has not measured it, and will not build on a
 * number it guessed. So the aggregate is timestamps alone, and each user key gets its own row.
 * {@link MAX_AGGREGATE_BUDGET} bounds the first, and `hosted-enrolment.test.ts` **measures** the
 * serialized size at that ceiling rather than reasoning about it.
 */

/** Where the aggregate issuance history lives. `/journal/` for `funnel-journal.ts`'s reason. */
export const ISSUANCE_JOURNAL_KEY: Key = new Key('/journal/issuance')

/** One row per user key, so the aggregate row does not grow with the number of distinct users. */
export function issuanceKeyFor(userKey: PublicKeyHex): Key {
  return new Key(`/journal/issuance-user/${userKey}`)
}

/**
 * How long a written history is kept.
 *
 * {@link IssuanceLedger} states the rule this obeys — *"it may retain **more** than the
 * authority's window and never less"* — and compaction is explicitly the host's. Twice the
 * window, because a clock that moved backwards or a request that arrived at the boundary must
 * never be able to drop an entry the authority would still have counted.
 */
export const RETAINED_ISSUANCE_MS: number = DEFAULT_ISSUANCE_WINDOW_MS * 2

/**
 * The largest aggregate budget this tier accepts, and it is a **storage** bound rather than a
 * policy one.
 *
 * At a budget of B the aggregate row holds at most `2 × B` timestamps, because
 * {@link RETAINED_ISSUANCE_MS} is two windows. Cloudflare's per-value size limit is not recorded
 * anywhere in this repository and has not been measured here, so rather than build on a guessed
 * constant this ceiling is set where the row stays small by any plausible reading of it, and
 * `hosted-enrolment.test.ts` measures the serialized bytes at exactly this number.
 *
 * 2048 certificates an hour is far above what this milestone's cohort can consume — a few
 * hundred testers, each re-enrolling once an hour because `DEFAULT_CERTIFICATE_LIFETIME_MS` is
 * one hour — so the ceiling constrains no honest deployment at the size the fabric is at. A
 * deployment that outgrows it needs a different storage shape, not a bigger number here, and
 * refusing by name is how that conversation starts instead of a row silently failing to write.
 */
export const MAX_AGGREGATE_BUDGET = 2048

/** Refused rather than clamped: a budget nobody can honour must not look like one that is. */
export class IssuanceBudgetTooLargeError extends Error {
  readonly requested: number

  constructor(requested: number) {
    super(
      `an aggregate issuance budget of ${String(requested)} exceeds this tier's ceiling of ${String(MAX_AGGREGATE_BUDGET)} — the history it would retain outgrows one storage row, and a bigger number here would make the write fail rather than the budget work`,
    )
    this.name = 'IssuanceBudgetTooLargeError'
    this.requested = requested
  }
}

/** Timestamps newer than the retention bound, oldest first. Anything unparseable is dropped. */
function retained(raw: unknown, now: number): number[] {
  if (!Array.isArray(raw)) return []
  const floor = now - RETAINED_ISSUANCE_MS
  return raw
    .filter((at): at is number => typeof at === 'number' && Number.isFinite(at) && at >= floor)
    .sort((a, b) => a - b)
}

/** Read one row of timestamps, compacted. A missing or corrupt row reads as no history. */
async function readTimestamps(store: Datastore, key: Key, now: number): Promise<number[]> {
  // `has` before `get`, never `get`-and-catch — `Datastore.get` signals a miss by throwing,
  // which `funnel-journal.ts` states at its own head.
  if (!(await store.has(key))) return []
  try {
    return retained(JSON.parse(new TextDecoder().decode(await store.get(key))), now)
  } catch {
    // A row this build cannot read is a row with no history in it. Throwing here would take
    // out enrolment for a provider whose only fault is a value written by something else —
    // and the safe direction is the one `enrollment.ts` already names for forgotten
    // challenges: forgetting refuses, it never over-issues.
    return []
  }
}

/** One request's history, as plain data. Loaded before the authority runs; see the header. */
export interface LoadedIssuance {
  readonly userKey: PublicKeyHex
  readonly anybody: number[]
  readonly forUser: number[]
}

/** Read both rows for one asking key. The `await`s that the synchronous port may not contain. */
export async function loadIssuance(
  store: Datastore,
  userKey: PublicKeyHex,
  now: number,
): Promise<LoadedIssuance> {
  const [anybody, forUser] = await Promise.all([
    readTimestamps(store, ISSUANCE_JOURNAL_KEY, now),
    readTimestamps(store, issuanceKeyFor(userKey), now),
  ])
  return { userKey, anybody, forUser }
}

/** An authority asked to issue with no history loaded — a bug, and never a silent one. */
export class UnboundIssuanceError extends Error {
  constructor() {
    super(
      'the enrolment authority read its issuance history with none loaded — the throttle would have counted nothing, so it refuses instead',
    )
    this.name = 'UnboundIssuanceError'
  }
}

/**
 * The ledger the one long-lived authority holds, whose contents are swapped per request.
 *
 * ## Why the authority is built once and the history per request
 *
 * `EnrollmentAuthority` takes its ledger at construction, and it keeps minted challenges in its
 * own heap — `enrollment.ts` is explicit that this is deliberate and that forgetting them is the
 * safe direction. An authority rebuilt per request would forget every nonce it had just minted,
 * and since the enrolment exchange is **two** round trips, the second leg would be refused every
 * single time. So the authority must outlive a request.
 *
 * But the history it must read depends on **who is asking** — `issuedTo(userKey)` — and that key
 * is only known once the request arrives. Loading every user's history at construction is the
 * shape this file's header refuses on size grounds.
 *
 * So the authority holds this, and this holds whatever was loaded for the request in flight.
 *
 * ## One class, not two
 *
 * A first draft had this delegate to a second object that also implemented
 * {@link IssuanceLedger}. `reachability.node.test.ts` reddened on three name collisions in one
 * file and it was right to: two implementations of a three-method interface, one of which only
 * forwarded, is duplication with a wrapper around it. The loaded history is plain data
 * ({@link LoadedIssuance}) and this is the only ledger.
 *
 * ## Why swapping is safe here and would not be everywhere
 *
 * A Durable Object processes one request at a time — the platform's input-gate rule — so there
 * is no second `enrol` to interleave between {@link bind} and {@link clear}. That is the same
 * property `funnel-journal.ts` and `relay-service-journal.ts` already rely on for their
 * read-modify-write, and it is stated here rather than assumed because a reader meeting mutable
 * shared state is owed the reason it is not a race.
 *
 * **Unbound reads throw.** Answering "no history" would let the aggregate budget count zero and
 * issue freely, which is precisely the throttle failing open — the one outcome the owner's
 * instruction rules out. A throw reaches the RPC handler's catch and answers an error frame.
 */
export class HostedIssuance implements IssuanceLedger {
  readonly #store: Datastore
  readonly #reserved: ReadonlySet<PublicKeyHex>
  #current: LoadedIssuance | null = null
  #recorded = false

  constructor(store: Datastore, reserved: ReadonlySet<PublicKeyHex> = new Set()) {
    this.#store = store
    this.#reserved = reserved
  }

  /**
   * Whether the key this request is bound to runs in the reserved lane — AUTH-01.
   *
   * **Unforgeable, and that rests on a measured ordering rather than on hope.**
   * `EnrollmentAuthority.enrol` verifies `proofOfPossession` and then `ownerProof` **before**
   * it consults either budget: a request naming a reserved `userKey` without the private half
   * is refused `bad-owner-proof` and never reaches this method's effect at all. So pinning a
   * PUBLIC key here grants nothing to anyone who merely knows it, which is everyone — it
   * appears in every certificate that key ever obtained.
   *
   * What it does grant, to whoever holds the private half: a lane that neither reads nor
   * consumes the shared window. That is the point — the operator must not be locked out of
   * their own fabric by whoever drained the public budget this hour — and it is also the whole
   * of the exposure. A leaked reserved key mints at `DEFAULT_MAX_PER_WINDOW` an hour and no
   * more, because the per-user limit is untouched by any of this; rotation is one variable.
   */
  #isReserved(): boolean {
    return this.#reserved.has(this.#require().userKey)
  }

  bind(loaded: LoadedIssuance): void {
    this.#current = loaded
    this.#recorded = false
  }

  clear(): void {
    this.#current = null
    this.#recorded = false
  }

  #require(): LoadedIssuance {
    if (this.#current === null) throw new UnboundIssuanceError()
    return this.#current
  }

  issuedTo(userKey: PublicKeyHex): readonly number[] {
    const loaded = this.#require()
    // Loaded for ONE user key, because that is the only one an enrolment request can ask
    // about — the request names it. A question about a different key is answered with no
    // history rather than with this key's, which would be the wrong answer in the direction
    // that over-issues.
    return userKey === loaded.userKey ? loaded.forUser : []
  }

  issuedToAnybody(): readonly number[] {
    // A reserved key does not see the shared window, so the aggregate budget cannot refuse it.
    // Returning an empty history rather than a larger limit is deliberate: a bigger number
    // would still be spent by whoever got there first, and "I do not want to wait" is a claim
    // about contention, not about size.
    return this.#isReserved() ? [] : this.#require().anybody
  }

  record(userKey: PublicKeyHex, at: number): void {
    const loaded = this.#require()
    // The other half of the lane, and it must be the other half: a reserved key that did not
    // READ the shared window but still WROTE to it would spend the cohort's budget while being
    // exempt from it — the operator quietly making everybody else wait, which is the inverse of
    // the thing being asked for.
    if (!this.#isReserved()) loaded.anybody.push(at)
    if (userKey === loaded.userKey) loaded.forUser.push(at)
    this.#recorded = true
  }

  /** Persist what was recorded. A no-op when nothing was, so a refused request writes nothing. */
  async flush(): Promise<void> {
    if (!this.#recorded) return
    const loaded = this.#require()
    const encode = (values: readonly number[]): Uint8Array =>
      new TextEncoder().encode(JSON.stringify(values))
    // Written unconditionally, and the reserved lane is NOT guarded a second time here.
    //
    // **That second guard existed and was deleted, because it made the property unplantable.**
    // With a guard in both `record` and this line, either one alone held the claim — so a
    // single-line plant left the suite green and the case that names the property could not
    // see it. Measured, both ways, before this line was changed. The semantics live in
    // `record` (*a reserved key does not consume the shared window*), so that is where the one
    // guard is; by the time execution reaches here `loaded.anybody` is byte-identical to what
    // was loaded, and writing it back is a no-op rather than a leak.
    await this.#store.put(ISSUANCE_JOURNAL_KEY, encode(loaded.anybody))
    await this.#store.put(issuanceKeyFor(loaded.userKey), encode(loaded.forUser))
  }
}

/** One authority, the ledger it reads through, and how to load a request's history. */
export interface HostedProvider {
  readonly authority: EnrollmentAuthority
  readonly ledger: HostedIssuance
  load(userKey: PublicKeyHex, now: number): Promise<LoadedIssuance>
}

/**
 * Build this object's provider — one authority, living as long as the object does.
 *
 * The signing key is the node's **own identity seed**, so the issuer a certificate names is the
 * `nodeKey` this object already publishes on `GET /self`. That is a derivation rather than a
 * fifth secret to set and forget: `worker.ts` pins the same value as a trusted issuer without
 * anybody transcribing it, and a deployment cannot end up trusting an issuer that does not
 * exist or issuing under a key nobody trusts.
 */
export function hostedProvider(parts: {
  readonly store: Datastore
  readonly providerPrivateKey: Uint8Array
  readonly maxIssuedPerWindow: number
  /** User keys that run in the reserved lane. See {@link HostedIssuance} for what it grants. */
  readonly reserved?: ReadonlySet<PublicKeyHex>
}): HostedProvider {
  const ledger = new HostedIssuance(parts.store, parts.reserved ?? new Set())
  const authority = new EnrollmentAuthority({
    providerPrivateKey: parts.providerPrivateKey,
    maxIssuedPerWindow: parts.maxIssuedPerWindow,
    issuance: ledger,
  })
  return {
    authority,
    ledger,
    load: async (userKey, now) => loadIssuance(parts.store, userKey, now),
  }
}

/** What a deployment says about issuing, read off its configuration. */
export type HostedEnrolment =
  | { readonly issues: false }
  | { readonly issues: true; readonly maxIssuedPerWindow: number }

/**
 * Read the deployment's issuance posture off one variable — see this file's header.
 *
 * Absent, empty, unparseable, zero or negative all mean **issues nothing**, and every one of
 * them is the same answer on purpose: a provider that cannot state its bound must not sign. A
 * value above the ceiling is the one case that throws, because it is a deployment asking for
 * something specific that this tier cannot deliver, and silently issuing at a smaller number
 * than an operator asked for is how a bound stops meaning what its owner thinks it means.
 */
export function hostedEnrolment(configured: string | undefined): HostedEnrolment {
  if (configured === undefined || configured.trim() === '') return { issues: false }
  const budget = Number(configured.trim())
  if (!Number.isFinite(budget) || !Number.isInteger(budget) || budget <= 0) return { issues: false }
  if (budget > MAX_AGGREGATE_BUDGET) throw new IssuanceBudgetTooLargeError(budget)
  return { issues: true, maxIssuedPerWindow: budget }
}

/**
 * The handler this tier serves — reservations, and enrolment when it is configured to issue.
 *
 * ## Why the refusal text differs from `serveReservations`'
 *
 * `serveReservations` answers *"this node serves reservations only, not X"*, and on a node that
 * also enrols that sentence is **false**. It is left untouched for nodes where it is true — its
 * own spec asserts it — and this tier says what is true of this tier. `hosted-rendezvous.e2e`'s
 * assertion moved with it, in the same change, rather than the node telling a peer something
 * inaccurate to keep an old string green.
 *
 * ## A provider that issues nothing answers `error`, not a refusal
 *
 * The distinction is `agent.ts`'s and is carried here deliberately: a refusal says *your request
 * was not granted and here is which of three things was wrong with it*, while an error says *I
 * am not somewhere that grants them*. Collapsing them would tell a requestor to fix a proof that
 * was fine when it should be asking somebody else.
 */
export function serveHostedRequests(parts: {
  readonly reservations: () => readonly string[]
  readonly provider: HostedProvider | 'issues-no-certificates'
  readonly now?: () => number
}): RpcHandler {
  const reservationsHandler = serveReservations(parts.reservations)
  const clock = parts.now ?? ((): number => Date.now())
  const provider = parts.provider

  return async (from: string, body: CanonicalValue): Promise<CanonicalValue | RpcReply> => {
    const request = parseRequest(body)
    if (request === null) return encodeResponse({ kind: 'error', reason: 'malformed request' })

    if (request.kind === 'reservations') return reservationsHandler(from, body)

    if (request.kind === 'enrol-challenge') {
      if (provider === 'issues-no-certificates') {
        return encodeResponse({ kind: 'error', reason: 'this node issues no certificates' })
      }
      return encodeResponse({
        kind: 'enrol-challenge',
        challenge: provider.authority.mintChallenge(clock()),
      })
    }

    if (request.kind === 'enrol') {
      if (provider === 'issues-no-certificates') {
        return encodeResponse({ kind: 'error', reason: 'this node issues no certificates' })
      }
      // THE ONE PLACE THE THROTTLE BECOMES DURABLE, and the ordering is the whole of it: the
      // history is read from storage HERE, `certifyFreshly` runs synchronously against what was
      // read, and what it recorded is written back after. No `await` sits inside the port —
      // see this file's header for the recorded argument that would otherwise be invalidated.
      const now = clock()
      provider.ledger.bind(await provider.load(request.request.userKey, now))
      try {
        const answered = certifyFreshly(provider.authority, request.request, now)
        await provider.ledger.flush()
        return encodeResponse(answered)
      } finally {
        // Unbound again whatever happened, so a later call that somehow reached the authority
        // without a loaded history throws instead of silently issuing against an empty one.
        provider.ledger.clear()
      }
    }

    // A foreign kind, answered by what this node ACTUALLY serves rather than by one fixed
    // sentence. A deployment that issues nothing serves reservations only, and saying anything
    // else would be this node describing a capability it does not have — so that arm falls
    // through to `serveReservations`' own text, which is true there and which its own spec and
    // `hosted-rendezvous.e2e.test.ts` both assert. A deployment that issues says so.
    if (provider === 'issues-no-certificates') return reservationsHandler(from, body)
    return encodeResponse({
      kind: 'error',
      reason: `this node serves reservations and enrolment only, not ${request.kind}`,
    })
  }
}
