import { ed25519 } from '@noble/curves/ed25519.js'
import { MemoryDatastore } from 'datastore-core'
import { Key } from 'interface-datastore'
import { describe, expect, it } from 'vitest'
import { DEFAULT_ISSUANCE_WINDOW_MS, requestEnrollment, toHex } from '@o2/core'
import type { PendingEnrollment, PublicKeyHex } from '@o2/core'
import { encodeRequest, parseResponse } from '@o2/net'
import {
  ISSUANCE_JOURNAL_KEY,
  IssuanceBudgetTooLargeError,
  MAX_AGGREGATE_BUDGET,
  RETAINED_ISSUANCE_MS,
  UnboundIssuanceError,
  hostedEnrolment,
  hostedProvider,
  issuanceKeyFor,
  loadIssuance,
  serveHostedRequests,
} from './hosted-enrolment.ts'

/**
 * AUTH-01 on the hosted tier — the provider that did not exist, and the throttle that binds it.
 *
 * ## What this file has to establish, and why each half is worthless alone
 *
 * The owner ruled on 2026-09-09 that enrolment becomes real rather than the TURN gate becoming
 * looser, and then stated the bound: *«throttle на выдачу сертификатов, чтобы невозможно было
 * нахуячить много за короткое время»*, global, *«вне зависимости от того, кто зашёл»*.
 *
 * So there are two claims here and each is a positive control for the other. **A provider that
 * issues** — without it every refusal below would pass on an endpoint that refuses everything,
 * which is this repository's standing objection to a spec made only of noes. And **a provider
 * that stops**, measured by exhausting a budget rather than by reading that one was configured:
 * `CLAUDE.md`'s rule is that a reported bound is not a measured one.
 *
 * ## The throttle case is the one that would silently rot, so it is written to notice
 *
 * A budget defeats itself the moment its history stops surviving. `enrollment.ts` records the
 * Phase 17 measurement — *"a second provider process starts with an empty history, so the same
 * user key is accepted again immediately"* — and a Durable Object is evicted between requests
 * as a matter of course. The eviction case below therefore does not construct a second ledger
 * and check a number; it **throws the whole provider away, builds a new one over the same
 * store**, and asks whether the budget still holds. That is what an eviction is.
 */

const PROVIDER_SEED = new Uint8Array(32).fill(41)
const NODE_SEED = new Uint8Array(32).fill(43)
const USER_SEED = new Uint8Array(32).fill(47)
const OTHER_USER_SEED = new Uint8Array(32).fill(53)
const NOW = 1_800_000_000_000

function keyOf(seed: Uint8Array): PublicKeyHex {
  return toHex(ed25519.getPublicKey(seed))
}

/**
 * A request built by the SAME function a real joiner uses.
 *
 * Hand-rolling the two possession proofs here was the first draft and it was the wrong call:
 * a fixture that builds a request its own way can drift from the shape the client sends, and
 * then this file measures a request nobody makes. `requestEnrollment` is `@o2/core`'s own
 * builder, is what `enrol-client.ts` calls, and returns the `answering` closure the second leg
 * of the exchange needs — so the nonce is signed the way the wire signs it too.
 */
async function requestFrom(
  userSeed: Uint8Array,
  nodeSeed: Uint8Array = NODE_SEED,
): Promise<PendingEnrollment> {
  return await requestEnrollment(nodeSeed, userSeed, {
    operatorId: 'phase-39-hosted-enrolment',
    discoverability: 'via-relay',
    relayIds: [],
  })
}

/** A provider over a store the caller owns, so eviction can be modelled by rebuilding it. */
function providerOver(store: MemoryDatastore, budget: number) {
  return hostedProvider({
    store,
    providerPrivateKey: PROVIDER_SEED,
    maxIssuedPerWindow: budget,
  })
}

/** Ask for a certificate the way a joiner does: mint a nonce, answer it, send the request. */
async function enrolOnce(
  handler: ReturnType<typeof serveHostedRequests>,
  pending: PendingEnrollment,
): Promise<{ ok: boolean; reason: string }> {
  const minted = parseResponse(
    (await handler('a-peer', encodeRequest({ kind: 'enrol-challenge' }))) as never,
  )
  if (minted === null || minted.kind !== 'enrol-challenge') {
    return { ok: false, reason: `no challenge: ${JSON.stringify(minted)}` }
  }
  // Spread-then-answer, exactly as `enrol-client.ts` does it, and for the reason
  // `PendingEnrollment` records: `answering` returns the ANSWER rather than a rebuilt request,
  // so the fields on the wire are this object's and not a snapshot from signing time.
  const request = { ...pending, freshness: pending.answering(minted.challenge) }
  const body = parseResponse(
    (await handler('a-peer', encodeRequest({ kind: 'enrol', request }))) as never,
  )
  if (body === null) return { ok: false, reason: 'unparseable' }
  if (body.kind === 'error') return { ok: false, reason: body.reason }
  if (body.kind !== 'enrol') return { ok: false, reason: `wrong kind ${body.kind}` }
  return body.result.ok
    ? { ok: true, reason: '' }
    : { ok: false, reason: body.result.reason }
}

describe('AUTH-01 — the budget is the on-switch, and absence issues nothing', () => {
  it('issues nothing when no budget is stated', () => {
    // Every one of these is the same answer on purpose: a provider that cannot say what bounds
    // it must not sign. A flag plus a number would permit issuing-and-unbounded.
    for (const value of [undefined, '', '   ', 'lots', '0', '-1', '3.5', 'NaN']) {
      expect(hostedEnrolment(value).issues, `"${String(value)}" turned issuance ON`).toBe(false)
    }
  })

  it('issues at exactly the number stated', () => {
    const read = hostedEnrolment('250')
    expect(read.issues).toBe(true)
    if (!read.issues) return
    expect(read.maxIssuedPerWindow).toBe(250)
  })

  it('REFUSES a budget above the tier ceiling rather than quietly issuing at a smaller one', () => {
    // Clamping would make an operator's number mean something other than what they wrote, and
    // the direction it would move in is the one that matters least to notice.
    expect(() => hostedEnrolment(String(MAX_AGGREGATE_BUDGET + 1))).toThrow(
      IssuanceBudgetTooLargeError,
    )
    expect(hostedEnrolment(String(MAX_AGGREGATE_BUDGET)).issues).toBe(true)
  })
})

describe('AUTH-01 — a hosted provider issues, which is what makes every refusal below a measurement', () => {
  it('THE POSITIVE CONTROL: a well-formed request gets a certificate', async () => {
    const store = new MemoryDatastore()
    const handler = serveHostedRequests({
      reservations: () => [],
      provider: providerOver(store, 8),
      now: () => NOW,
    })
    const outcome = await enrolOnce(handler, await requestFrom(USER_SEED))
    expect(outcome.ok, outcome.reason).toBe(true)
  })

  it('answers `error`, not a refusal, when this deployment issues nothing', async () => {
    // The distinction `agent.ts` draws and this tier carries: a refusal says *your request was
    // not granted*, an error says *I am not somewhere that grants them*. Collapsing them tells a
    // joiner to fix a proof that was fine.
    const handler = serveHostedRequests({
      reservations: () => [],
      provider: 'issues-no-certificates',
      now: () => NOW,
    })
    for (const frame of [{ kind: 'enrol-challenge' as const }, { kind: 'enrol' as const, request: await requestFrom(USER_SEED) }]) {
      const body = parseResponse((await handler('a-peer', encodeRequest(frame as never))) as never)
      expect(body?.kind).toBe('error')
      if (body?.kind === 'error') expect(body.reason).toBe('this node issues no certificates')
    }
  })

  it('names what it ACTUALLY serves — which differs between the two postures', async () => {
    // Both arms, because one sentence for both would make a node describe a capability it does
    // not have. A node that issues nothing serves reservations only and says so — which is what
    // `hosted-rendezvous.e2e.test.ts` and `rendezvous.test.ts` already assert of it.
    const issuing = serveHostedRequests({
      reservations: () => [],
      provider: providerOver(new MemoryDatastore(), 4),
      now: () => NOW,
    })
    const fromIssuer = parseResponse(
      (await issuing('a-peer', encodeRequest({ kind: 'offer', shardId: 'shard-1' }))) as never,
    )
    expect(fromIssuer?.kind).toBe('error')
    if (fromIssuer?.kind === 'error') {
      expect(fromIssuer.reason).toBe('this node serves reservations and enrolment only, not offer')
    }

    const handler = serveHostedRequests({
      reservations: () => ['12D3KooWaPeer'],
      provider: 'issues-no-certificates',
      now: () => NOW,
    })
    const reservations = parseResponse(
      (await handler('a-peer', encodeRequest({ kind: 'reservations' }))) as never,
    )
    expect(reservations?.kind).toBe('reservations')

    const foreign = parseResponse(
      (await handler('a-peer', encodeRequest({ kind: 'offer', shardId: 'shard-1' }))) as never,
    )
    expect(foreign?.kind).toBe('error')
    if (foreign?.kind === 'error') {
      // A node that issues nothing keeps `serveReservations`' own sentence, because on it that
      // sentence is TRUE. The issuing arm above is where the other one is asserted.
      expect(foreign.reason).toBe('this node serves reservations only, not offer')
    }
  })
})

describe('AUTH-01 — the GLOBAL throttle, measured by exhausting it', () => {
  it('stops issuing once the window budget is spent, WHOEVER asks', async () => {
    // The owner's instruction in one case: global, regardless of who came. Two certificates are
    // granted and the third is refused — and the third asks under a DIFFERENT user key, which
    // is the whole point. A per-user limit would have granted it, because a fresh user key is
    // one `ed25519.keygen()` and `enrollment.ts` measured that rotation as free.
    const store = new MemoryDatastore()
    const handler = serveHostedRequests({
      reservations: () => [],
      provider: providerOver(store, 2),
      now: () => NOW,
    })
    expect((await enrolOnce(handler, await requestFrom(USER_SEED))).ok).toBe(true)
    expect((await enrolOnce(handler, await requestFrom(USER_SEED))).ok).toBe(true)

    const third = await enrolOnce(handler, await requestFrom(OTHER_USER_SEED))
    expect(third.ok, 'a third certificate was issued against a budget of two').toBe(false)
  })

  it('SURVIVES THE OBJECT BEING EVICTED — the half that makes the throttle real', async () => {
    // Phase 17 measured the defeat this guards against: *"a second provider process starts with
    // an empty history, so the same user key is accepted again immediately"*. A Durable Object
    // is evicted between requests as a matter of course, so an in-process ledger would bound
    // nothing at all while looking exactly like one that does.
    //
    // So the provider is THROWN AWAY and rebuilt over the same store, which is what an eviction
    // is — not a second ledger constructed beside the first.
    const store = new MemoryDatastore()
    const first = serveHostedRequests({
      reservations: () => [],
      provider: providerOver(store, 1),
      now: () => NOW,
    })
    expect((await enrolOnce(first, await requestFrom(USER_SEED))).ok).toBe(true)

    const afterEviction = serveHostedRequests({
      reservations: () => [],
      provider: providerOver(store, 1),
      now: () => NOW,
    })
    const second = await enrolOnce(afterEviction, await requestFrom(OTHER_USER_SEED))
    expect(second.ok, 'the budget reset when the object was rebuilt — the throttle is in memory only').toBe(false)
  })

  it('lets issuance resume once the window has passed, so the throttle is a rate and not a cap', async () => {
    const store = new MemoryDatastore()
    const spent = serveHostedRequests({
      reservations: () => [],
      provider: providerOver(store, 1),
      now: () => NOW,
    })
    expect((await enrolOnce(spent, await requestFrom(USER_SEED))).ok).toBe(true)
    expect((await enrolOnce(spent, await requestFrom(OTHER_USER_SEED))).ok).toBe(false)

    // A window and a second later, over the SAME store and a fresh provider.
    const later = NOW + DEFAULT_ISSUANCE_WINDOW_MS + 1000
    const resumed = serveHostedRequests({
      reservations: () => [],
      provider: providerOver(store, 1),
      now: () => later,
    })
    expect((await enrolOnce(resumed, await requestFrom(OTHER_USER_SEED))).ok).toBe(true)
  })
})

describe('AUTH-01 — the durable ledger itself', () => {
  it('writes nothing when a request was refused, so a refusal costs no storage', async () => {
    const store = new MemoryDatastore()
    const loaded = await loadIssuance(store, keyOf(USER_SEED), NOW)
    await loaded.flush()
    expect(await store.has(ISSUANCE_JOURNAL_KEY)).toBe(false)
  })

  it('records into both rows and reads them back after a rebuild', async () => {
    const store = new MemoryDatastore()
    const userKey = keyOf(USER_SEED)
    const loaded = await loadIssuance(store, userKey, NOW)
    loaded.record(userKey, NOW)
    await loaded.flush()

    const reread = await loadIssuance(store, userKey, NOW)
    expect(reread.issuedToAnybody()).toEqual([NOW])
    expect(reread.issuedTo(userKey)).toEqual([NOW])
  })

  it('answers no history for a key it was not loaded for — the direction that cannot over-issue', async () => {
    const store = new MemoryDatastore()
    const loaded = await loadIssuance(store, keyOf(USER_SEED), NOW)
    // Returning this key's history for another key would UNDER-count the other key's use, which
    // is the over-issuing direction. An empty answer is the safe one, and the aggregate budget
    // is what actually bounds an attacker anyway.
    expect(loaded.issuedTo(keyOf(OTHER_USER_SEED))).toEqual([])
  })

  it('compacts what it retains, and retains MORE than the authority’s window and never less', async () => {
    const store = new MemoryDatastore()
    const userKey = keyOf(USER_SEED)
    const stale = NOW - RETAINED_ISSUANCE_MS - 1
    const insideAuthorityWindow = NOW - DEFAULT_ISSUANCE_WINDOW_MS + 1
    const insideRetention = NOW - DEFAULT_ISSUANCE_WINDOW_MS - 1000
    await store.put(
      ISSUANCE_JOURNAL_KEY,
      new TextEncoder().encode(JSON.stringify([stale, insideRetention, insideAuthorityWindow])),
    )
    const loaded = await loadIssuance(store, userKey, NOW)
    // The entry the authority would still count is kept; so is one it would not, because the
    // rule `IssuanceLedger` states is retain more, never less. Only the genuinely ancient goes.
    expect(loaded.issuedToAnybody()).toEqual([insideRetention, insideAuthorityWindow])
    expect(RETAINED_ISSUANCE_MS).toBeGreaterThan(DEFAULT_ISSUANCE_WINDOW_MS)
  })

  it('reads a corrupt row as no history rather than taking enrolment out', async () => {
    const store = new MemoryDatastore()
    await store.put(ISSUANCE_JOURNAL_KEY, new TextEncoder().encode('{not json'))
    const loaded = await loadIssuance(store, keyOf(USER_SEED), NOW)
    expect(loaded.issuedToAnybody()).toEqual([])
  })

  it('keeps the aggregate row small at the ceiling — MEASURED, not reasoned about', async () => {
    // Cloudflare's per-value size limit is not recorded anywhere in this repository and has not
    // been measured here, so `MAX_AGGREGATE_BUDGET` is sited where the row is small by any
    // plausible reading of it — and this case reads the actual bytes rather than trusting the
    // arithmetic in the constant's docblock.
    const worstCase = Array.from({ length: MAX_AGGREGATE_BUDGET * 2 }, (_, index) => NOW - index)
    const bytes = new TextEncoder().encode(JSON.stringify(worstCase)).byteLength
    expect(bytes).toBeLessThan(64 * 1024)
  })

  it('gives each user key its own row, so the aggregate row does not grow with distinct users', () => {
    expect(issuanceKeyFor(keyOf(USER_SEED)).toString()).not.toBe(
      issuanceKeyFor(keyOf(OTHER_USER_SEED)).toString(),
    )
    expect(issuanceKeyFor(keyOf(USER_SEED)).toString()).not.toBe(ISSUANCE_JOURNAL_KEY.toString())
    // Under `/journal/`, which is what `DoDatastore.put` admits — `/dht/` and `/o2/` are its own
    // namespaces and it refuses anything outside them.
    expect(issuanceKeyFor(keyOf(USER_SEED)).toString().startsWith('/journal/')).toBe(true)
  })

  it('THROWS rather than counting zero when the authority reads with no history bound', async () => {
    // The throttle failing open is the one outcome the owner's instruction rules out, and an
    // unbound read is exactly how it would happen: the aggregate budget would see no issuance
    // and sign freely. `bind`/`clear` bracket every enrol; this is what happens outside them.
    const store = new MemoryDatastore()
    const provider = providerOver(store, 4)
    expect(() => provider.ledger.issuedToAnybody()).toThrow(UnboundIssuanceError)
    provider.ledger.bind(await loadIssuance(store, keyOf(USER_SEED), NOW))
    expect(provider.ledger.issuedToAnybody()).toEqual([])
    provider.ledger.clear()
    expect(() => provider.ledger.record(keyOf(USER_SEED), NOW)).toThrow(UnboundIssuanceError)
  })

  it('is stored under a key nothing else in this tier writes', () => {
    expect(ISSUANCE_JOURNAL_KEY.toString()).toBe(new Key('/journal/issuance').toString())
  })
})
