import { ed25519 } from '@noble/curves/ed25519.js'
import { describe, expect, it } from 'vitest'
import { fromHex, toHex } from './capability.ts'
import { decodeX509Certificate } from './x509.ts'
import { generateSubtleKeyPair } from './ed25519-backend.ts'
import {
  EnrollmentAuthority,
  UserKeyMismatchError,
  challengeAnswerBytes,
  possessionChallenge,
  requestEnrollment,
  resolveReplicaSets,
  subtleUserSigner,
  verifyCertificate,
} from './enrollment.ts'
import type {
  EnrollmentResult,
  IssuanceBudget,
  IssuanceHistory,
  IssuanceLedger,
  NodeCertificate,
  UserSigner,
} from './enrollment.ts'

/** AUTH-01, AUTH-02, AUTH-04, AUTH-05. */

function keypair(seed: number): { priv: Uint8Array; pub: string } {
  const priv = new Uint8Array(32).fill(seed)
  return { priv, pub: toHex(ed25519.getPublicKey(priv)) }
}

const provider = keypair(40)
const rogue = keypair(41)
const alice = keypair(42)
const NOW = 1_800_000_000_000

function authority(
  overrides: {
    maxPerWindow?: number
    windowMs?: number
    maxIssuedPerWindow?: IssuanceBudget
    issuance?: IssuanceHistory
  } = {},
) {
  return new EnrollmentAuthority({
    providerPrivateKey: provider.priv,
    maxPerWindow: overrides.maxPerWindow ?? 3,
    windowMs: overrides.windowMs ?? 60_000,
    // Every case built on this helper is about the per-user window, so the defaults are
    // the two named absences — written out rather than omitted, which is the whole point
    // of both options being required.
    maxIssuedPerWindow: overrides.maxIssuedPerWindow ?? 'issues-without-an-aggregate-budget',
    issuance: overrides.issuance ?? 'remembers-only-within-this-process',
  })
}

async function enrol(auth: EnrollmentAuthority, seed: number, opts: { operatorId?: string; relayIds?: string[]; at?: number } = {}) {
  const node = keypair(seed)
  const request = await requestEnrollment(node.priv, alice.priv, {
    operatorId: opts.operatorId ?? 'alice-op',
    discoverability: (opts.relayIds ?? ['relay-1']).length > 0 ? 'via-relay' : 'seed',
    relayIds: opts.relayIds ?? ['relay-1'],
  })
  return { node, result: auth.enrol(request, opts.at ?? NOW) }
}

/**
 * One enrolment under a **freshly generated** user key, which is the attacker's move.
 *
 * Seeds are derived from `which` so a failure names the request it was, and the two
 * ranges are disjoint from every other fixture key in this file.
 */
async function underFreshUser(auth: EnrollmentAuthority, which: number, at: number = NOW) {
  const node = keypair(100 + which)
  const user = keypair(150 + which)
  return {
    userKey: user.pub,
    result: auth.enrol(
      await requestEnrollment(node.priv, user.priv, {
        operatorId: `op-${which}`,
        discoverability: 'seed',
        relayIds: [],
      }),
      at,
    ),
  }
}

/**
 * A ledger this file owns, so a pre-loaded timestamp is one the authority never wrote.
 *
 * Hand-written rather than imported: the point of the port is that a **host** supplies
 * the history, and a test that used the implementation the sentinel selects would be
 * asserting against the authority's own memory again. `writes` records the calls in
 * order, which is what makes the synchronous reading below observable.
 */
function testLedger(preloaded: readonly (readonly [string, number])[] = []): IssuanceLedger & {
  readonly writes: [string, number][]
} {
  const byUser = new Map<string, number[]>()
  const anybody: number[] = []
  const writes: [string, number][] = []
  const put = (userKey: string, at: number): void => {
    const existing = byUser.get(userKey)
    if (existing === undefined) byUser.set(userKey, [at])
    else existing.push(at)
    anybody.push(at)
  }
  for (const [userKey, at] of preloaded) put(userKey, at)
  return {
    writes,
    issuedTo: (userKey) => byUser.get(userKey) ?? [],
    issuedToAnybody: () => anybody,
    record: (userKey, at) => {
      put(userKey, at)
      writes.push([userKey, at])
    },
  }
}

describe('AUTH-01 — the private key never leaves the device', () => {
  it('issues from a public key plus a proof of possession', async () => {
    const auth = authority()
    const { node, result } = await enrol(auth, 1)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.certificate.nodeKey).toBe(node.pub)
    expect(result.certificate.issuer).toBe(auth.issuerKey)

    // Nothing in the request carries a secret. If a provider could issue without
    // proof, it could impersonate every node it ever enrolled.
    const request = await requestEnrollment(node.priv, alice.priv, { operatorId: 'o', discoverability: 'seed', relayIds: [] })
    expect(Object.values(request).some((v) => v === toHex(node.priv))).toBe(false)
  })

  it('refuses a request that cannot prove it holds the key', async () => {
    const auth = authority()
    const victim = keypair(2)
    const attacker = keypair(3)

    // The attacker claims the victim's public key but signs with their own.
    const forged = await requestEnrollment(attacker.priv, alice.priv, { operatorId: 'o', discoverability: 'seed', relayIds: [] })
    const result = auth.enrol({ ...forged, nodeKey: victim.pub }, NOW)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.refusal.kind).toBe('bad-proof-of-possession')
  })
})

/**
 * A certificate names a user key. Until this, nothing that user did put it there.
 *
 * The node proved it held its own key and the challenge carried the user key inside
 * it, but the user key's private half never signed anything — so a provider would
 * issue a certificate naming any victim's user key to anybody who asked. Reproduced
 * against these classes before the fix: the attacker got a certificate,
 * `verifyCertificate` accepted it, and the victim was then rate-limited out of
 * enrolling their own node because the limiter keys on the attacker-supplied value.
 */
describe('AUTH-04 — a certificate names the user who consented to it', () => {
  it('refuses a request naming another user’s key without that user’s signature', () => {
    const auth = authority()
    const attackerNode = keypair(60)

    // Hand-assembled, because `requestEnrollment` cannot express it: the user key comes
    // from whatever signs, never from a field, and a signer naming a key it cannot sign
    // for is refused before a request is built at all.
    const challenge = possessionChallenge(attackerNode.pub, alice.pub)
    const forged = {
      nodeKey: attackerNode.pub,
      userKey: alice.pub,
      operatorId: 'attacker-op',
      discoverability: 'seed' as const,
      relayIds: [],
      proofOfPossession: toHex(ed25519.sign(challenge, attackerNode.priv)),
      // Signed by the attacker's node key, which is not alice's.
      ownerProof: toHex(ed25519.sign(challenge, attackerNode.priv)),
      // The sentinel, because `enrol` decides *entitlement* and takes no view on
      // freshness — see this module's header on why that check lives at the wire
      // boundary instead. A value here would not change this reading either way.
      freshness: 'answers-no-challenge' as const,
    }

    const result = auth.enrol(forged, NOW)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.refusal.kind).toBe('bad-owner-proof')
    // Its own discriminant, because "this node lied about itself" and "this node
    // claimed someone else's account" are different events and only the second is an
    // attack on a third party.
    expect(result.refusal.kind).not.toBe('bad-proof-of-possession')
    expect(result.reason).toContain(alice.pub)
  })

  it('does not let a refused cross-user request consume the victim’s window', async () => {
    const auth = authority({ maxPerWindow: 3 })
    const challengeFor = (node: { priv: Uint8Array; pub: string }) =>
      possessionChallenge(node.pub, alice.pub)

    for (let i = 0; i < 5; i++) {
      const attackerNode = keypair(70 + i)
      const challenge = challengeFor(attackerNode)
      auth.enrol(
        {
          nodeKey: attackerNode.pub,
          userKey: alice.pub,
          operatorId: 'attacker-op',
          discoverability: 'seed',
          relayIds: [],
          proofOfPossession: toHex(ed25519.sign(challenge, attackerNode.priv)),
          ownerProof: toHex(ed25519.sign(challenge, attackerNode.priv)),
          freshness: 'answers-no-challenge',
        },
        NOW,
      )
    }

    // The ordering is the whole of this case: verification is pure and cheap, so it
    // costs nothing to do it before the limiter is touched, and doing it after is
    // what turned a forgeable field into a denial of service against its owner.
    expect(auth.issuedWithin(alice.pub, NOW)).toBe(0)
    expect((await enrol(auth, 80)).result.ok).toBe(true)
  })

  it('names the key it holds, because that is the only key it can name', async () => {
    const auth = authority()
    const node = keypair(81)
    const request = await requestEnrollment(node.priv, alice.priv, {
      operatorId: 'alice-op',
      discoverability: 'seed',
      relayIds: [],
    })
    const result = auth.enrol(request, NOW)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.certificate.userKey).toBe(alice.pub)
  })

  it('cannot be handed a user key through its fields at all', async () => {
    const auth = authority()
    const node = keypair(82)
    const request = await requestEnrollment(node.priv, alice.priv, {
      operatorId: 'alice-op',
      discoverability: 'seed',
      relayIds: [],
      // @ts-expect-error userKey comes from the signer, never supplied
      userKey: rogue.pub,
    })

    // Two layers, failing for different reasons and both worth having. The
    // `@ts-expect-error` above is the compile-time half — it goes red if the field
    // ever becomes assignable. Everything below is the runtime half: naming a
    // stranger has to be *inert*, not merely unspellable, because a caller reaching
    // this from untyped JS can spell anything.
    expect(request.userKey).toBe(alice.pub)
    expect(request.userKey).not.toBe(rogue.pub)

    const result = auth.enrol(request, NOW)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.certificate.userKey).toBe(alice.pub)
    expect(result.certificate.userKey).not.toBe(rogue.pub)

    // And the limiter keys on that same field, so a honoured `userKey` would not
    // just mislabel the certificate — it would spend the named stranger's window.
    // The count that moved is the signer's.
    expect(auth.issuedWithin(alice.pub, NOW)).toBe(1)
    expect(auth.issuedWithin(rogue.pub, NOW)).toBe(0)
  })

  /**
   * The same property, one layer down, where a **port** put it.
   *
   * When the second parameter was bytes, `userKey` was derived and a stranger's key was
   * unspellable. A `UserSigner` supplies its own public half, so the guarantee had to
   * change shape — and the shape it took catches strictly more, because derivation was
   * never able to notice a signer holding one key and *claiming* another. That is not a
   * hypothetical spelling: it is what a `CryptoKeyPair` assembled from two generations
   * looks like, and the tab that does it would otherwise learn about it from a provider,
   * a round trip later, as an accusation against the provider's own wiring.
   */
  it('refuses to build a request for a signer that cannot sign for the key it names', async () => {
    const liar: UserSigner = {
      // alice's public half…
      userKey: alice.pub,
      // …over rogue's signing key. Every individual value here is real; only the pairing
      // is wrong, which is exactly why no type can catch it.
      sign: async (message) => ed25519.sign(message, rogue.priv),
    }

    await expect(
      requestEnrollment(keypair(83).priv, liar, {
        operatorId: 'alice-op',
        discoverability: 'seed',
        relayIds: [],
      }),
    ).rejects.toThrow(UserKeyMismatchError)

    // The refusal names the key it could not sign for, because an operator holding two
    // key pairs needs to know which one the request was about.
    await expect(
      requestEnrollment(keypair(83).priv, liar, {
        operatorId: 'alice-op',
        discoverability: 'seed',
        relayIds: [],
      }),
    ).rejects.toThrow(new RegExp(alice.pub))

    // The positive control, in the same case: the identical signer over the key it does
    // hold is built without complaint, so the arm above is not passing because
    // `requestEnrollment` refuses every signer it is handed.
    const honest: UserSigner = {
      userKey: rogue.pub,
      sign: async (message) => ed25519.sign(message, rogue.priv),
    }
    const request = await requestEnrollment(keypair(83).priv, honest, {
      operatorId: 'rogue-op',
      discoverability: 'seed',
      relayIds: [],
    })
    expect(request.userKey).toBe(rogue.pub)
    expect(authority().enrol(request, NOW).ok).toBe(true)
  })

  /**
   * The arm the whole port exists for: a key `crypto.subtle` holds and this process
   * cannot read.
   *
   * Runs in the **node** project as well as the browser one, deliberately.
   * `ed25519-backend.ts` records that Node's `subtle` does real Ed25519 on this host, and
   * `webcrypto-ed25519.browser.test.ts` measured the same in chromium, firefox and webkit
   * — so the one thing left to establish is that `requestEnrollment` and `enrol` agree
   * across the two implementations, and that is a claim about *this module* rather than
   * about an engine.
   *
   * `extractable: false` is the point rather than a detail: the assertion below that
   * `exportKey` refuses is what makes this a test about a key the page cannot read, and
   * not merely about an alternative signing library.
   */
  it('builds a request from a non-extractable CryptoKey the process cannot read', async () => {
    // Through the production helper: this case is about a NON-EXTRACTABLE key reaching
    // `subtleUserSigner`, not about whether `generateKey` answers. Raw, it drew once per run
    // against an engine that refuses ~0.78% of draws. The helper retries a refusal and still
    // returns the same non-extractable pair, so nothing this case asserts is weakened.
    const pair = await generateSubtleKeyPair()
    await expect(crypto.subtle.exportKey('pkcs8', pair.privateKey)).rejects.toThrow()

    const signer = await subtleUserSigner(pair)
    expect(signer.userKey).toHaveLength(64)

    const request = await requestEnrollment(keypair(84).priv, signer, {
      operatorId: 'visitor-op',
      discoverability: 'via-relay',
      relayIds: ['relay-1'],
    })

    // The certificate names the WebCrypto key, and a provider that has never heard of
    // WebCrypto issues it: `enrol` verifies `ownerProof` with `@noble/curves`, so this
    // passing is the cross-implementation agreement the design rests on.
    const auth = authority()
    const result = auth.enrol(request, NOW)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.certificate.userKey).toBe(signer.userKey)
    expect(auth.issuedWithin(signer.userKey, NOW)).toBe(1)

    // Nothing that crosses a wire is a `CryptoKey`. A signer that leaked its handle into
    // the request would produce something `encodeCanonical` cannot encode, and the failure
    // would surface as a codec refusal three layers away from the cause.
    const { answering: _answering, ...wire } = request
    for (const [field, value] of Object.entries(wire)) {
      expect(typeof value === 'string' || Array.isArray(value), `${field} is not wire data`).toBe(true)
    }
  })
})

describe('AUTH-02 — verification is offline', () => {
  it('verifies against a pinned provider key with no authority call', async () => {
    const auth = authority()
    const { result } = await enrol(auth, 4)
    // Asserted rather than merely guarded, here and below. A bare `if (!result.ok)
    // return` turns an issuer that stopped issuing into a green test that ran no
    // assertion at all — the whole body is skipped and nothing says so.
    expect(result.ok).toBe(true)
    if (!result.ok) return

    // The trust anchors are an argument. There is nothing here to reach out to.
    const verdict = verifyCertificate(result.certificate, new Set([auth.issuerKey]), NOW)
    expect(verdict.ok).toBe(true)
  })

  it('refuses a certificate from an unpinned issuer', async () => {
    const auth = authority()
    const { result } = await enrol(auth, 5)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const verdict = verifyCertificate(result.certificate, new Set([rogue.pub]), NOW)
    expect(verdict.ok).toBe(false)
    if (verdict.ok) return
    expect(verdict.failure.kind).toBe('untrusted-issuer')
  })

  it('refuses a certificate altered after signing', async () => {
    const auth = authority()
    const { result } = await enrol(auth, 6, { operatorId: 'honest-op' })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    // Changing the operator would defeat quorum diversity if it went unnoticed.
    const tampered: NodeCertificate = { ...result.certificate, operatorId: 'attacker-op' }
    const verdict = verifyCertificate(tampered, new Set([auth.issuerKey]), NOW)
    expect(verdict.ok).toBe(false)
    if (verdict.ok) return
    expect(verdict.failure.kind).toBe('bad-signature')
  })

  it('refuses an expired or not-yet-valid certificate', async () => {
    const auth = new EnrollmentAuthority({
      providerPrivateKey: provider.priv,
      certificateLifetimeMs: 1_000,
      maxIssuedPerWindow: 'issues-without-an-aggregate-budget',
      issuance: 'remembers-only-within-this-process',
    })
    const { result } = await enrol(auth, 7)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const anchors = new Set([auth.issuerKey])

    expect(verifyCertificate(result.certificate, anchors, NOW + 2_000).ok).toBe(false)
    expect(verifyCertificate(result.certificate, anchors, NOW - 1).ok).toBe(false)
    expect(verifyCertificate(result.certificate, anchors, NOW + 500).ok).toBe(true)
  })
})

describe('AUTH-04 — enrollment is rate-limited per user key', () => {
  it('permits up to the limit and then refuses, saying when to retry', async () => {
    const auth = authority({ maxPerWindow: 3, windowMs: 60_000 })

    for (let i = 0; i < 3; i++) expect((await enrol(auth, 10 + i)).result.ok).toBe(true)

    const fourth = await enrol(auth, 99)
    expect(fourth.result.ok).toBe(false)
    if (fourth.result.ok) return
    expect(fourth.result.refusal.kind).toBe('rate-limited')
    if (fourth.result.refusal.kind !== 'rate-limited') return
    // A refusal without a retry time makes a caller guess, and guessing means
    // hammering.
    expect(fourth.result.refusal.retryAfterMs).toBeGreaterThan(0)
    expect(fourth.result.reason).toContain('limit 3')
  })

  it('lets the window slide rather than blocking forever', async () => {
    const auth = authority({ maxPerWindow: 2, windowMs: 60_000 })
    await enrol(auth, 20, { at: NOW })
    await enrol(auth, 21, { at: NOW })
    expect((await enrol(auth, 22, { at: NOW })).result.ok).toBe(false)

    // Past the window, the earlier issues no longer count.
    expect((await enrol(auth, 23, { at: NOW + 60_001 })).result.ok).toBe(true)
  })

  it('counts per user key, so one user cannot exhaust another’s budget', async () => {
    const auth = authority({ maxPerWindow: 1 })
    const bob = keypair(50)

    const first = await requestEnrollment(keypair(30).priv, alice.priv, { operatorId: 'a', discoverability: 'seed', relayIds: [] })
    expect(auth.enrol(first, NOW).ok).toBe(true)

    const second = await requestEnrollment(keypair(31).priv, bob.priv, { operatorId: 'b', discoverability: 'seed', relayIds: [] })
    expect(auth.enrol(second, NOW).ok).toBe(true)

    expect(auth.issuedWithin(alice.pub, NOW)).toBe(1)
    expect(auth.issuedWithin(bob.pub, NOW)).toBe(1)
  })
})

/**
 * The second budget, on the one quantity an attacker cannot rotate.
 *
 * Phase 17 measured the per-user window and published what it does not buy: the limiter
 * keys on `userKey`, a fresh user key is one `ed25519.keygen()`, and twenty requests
 * under twenty distinct user keys all succeed with **no deletion turning that assertion
 * red** (`enrollment.node.test.ts`, *"rate-limiting is measured; cost is unmeasured"*).
 * That exact population is what the first case below runs, against an authority that
 * states an aggregate budget — and then again against one that states it has none, so
 * the two configurations are shown to differ rather than assumed to.
 *
 * What this bounds is **issuance per provider per window**, not the price of an
 * identity. See `enrollment.ts`'s header for what that does and does not buy.
 */
describe('AUTH-04 — a provider signs a stated number of certificates per window', () => {
  it('refuses past its stated number however many free keygens the requester mints', async () => {
    // `maxPerWindow: 3` never binds here: every request names a different user key and
    // spends one of that key's three. The only thing that can refuse is the aggregate.
    const budgeted = authority({ maxPerWindow: 3, maxIssuedPerWindow: 5 })
    // A sequential loop rather than `Promise.all`, because the budget is spent in the
    // order requests are made and a reader has to be able to say which five got through.
    const outcomes: EnrollmentResult[] = []
    for (let i = 0; i < 20; i += 1) outcomes.push((await underFreshUser(budgeted, i)).result)

    expect(outcomes.filter((o) => o.ok)).toHaveLength(5)
    expect(budgeted.issuedToAnybodyWithin(NOW)).toBe(5)
    for (const outcome of outcomes.filter((o) => !o.ok)) {
      if (outcome.ok) continue
      expect(outcome.refusal.kind).toBe('issuance-budget-exhausted')
    }

    // The control, in the same run: the identical twenty against an authority that
    // states it has no aggregate budget. Without this the first half would be equally
    // well explained by twenty requests that were never going to succeed.
    const unbudgeted = authority({ maxPerWindow: 3 })
    const same: EnrollmentResult[] = []
    for (let i = 0; i < 20; i += 1) same.push((await underFreshUser(unbudgeted, i)).result)
    expect(same.filter((o) => o.ok)).toHaveLength(20)
    expect(unbudgeted.issuedToAnybodyWithin(NOW)).toBe(20)
  })

  it('names the provider’s own budget and says nothing about the requester', async () => {
    const auth = authority({ maxIssuedPerWindow: 1 })
    expect((await underFreshUser(auth, 0)).result.ok).toBe(true)

    const second = await underFreshUser(auth, 1)
    expect(second.result.ok).toBe(false)
    if (second.result.ok) return

    // Asserted by name, not by `ok === false`. A refusal that named the requester
    // would send an operator looking at a user key that is not the problem — this
    // requester did nothing wrong and has a different next action from a rate-limited
    // one: find another provider, rather than wait.
    expect(second.result.refusal.kind).toBe('issuance-budget-exhausted')
    if (second.result.refusal.kind !== 'issuance-budget-exhausted') return
    expect(second.result.refusal.limit).toBe(1)
    expect(second.result.refusal.windowMs).toBe(60_000)
    expect(second.result.refusal.retryAfterMs).toBeGreaterThan(0)

    // Nothing about the requester, in the refusal or in the sentence beside it.
    expect(Object.keys(second.result.refusal)).not.toContain('userKey')
    expect(Object.keys(second.result.refusal)).not.toContain('nodeKey')
    expect(second.result.reason).not.toContain(second.userKey)
  })

  it('tells a requester their own window is full before it tells them the provider’s is', async () => {
    // Both budgets bind at once. Which reason is reported is the whole of this case:
    // the more specific true statement about *this* request wins.
    const auth = authority({ maxPerWindow: 2, maxIssuedPerWindow: 2 })
    expect((await enrol(auth, 120)).result.ok).toBe(true)
    expect((await enrol(auth, 121)).result.ok).toBe(true)
    expect(auth.issuedWithin(alice.pub, NOW)).toBe(2)
    expect(auth.issuedToAnybodyWithin(NOW)).toBe(2)

    const hers = (await enrol(auth, 122)).result
    expect(hers.ok).toBe(false)
    if (hers.ok) return
    expect(hers.refusal.kind).toBe('rate-limited')

    // And a stranger, whose own window is empty, meets the aggregate instead — which
    // is what shows the ordering is an ordering rather than the aggregate being
    // unreachable.
    const stranger = (await underFreshUser(auth, 7)).result
    expect(stranger.ok).toBe(false)
    if (stranger.ok) return
    expect(stranger.refusal.kind).toBe('issuance-budget-exhausted')
  })

  it('slides the aggregate window rather than closing the provider forever', async () => {
    const auth = authority({ maxPerWindow: 3, maxIssuedPerWindow: 2, windowMs: 60_000 })
    expect((await underFreshUser(auth, 10)).result.ok).toBe(true)
    expect((await underFreshUser(auth, 11)).result.ok).toBe(true)
    expect((await underFreshUser(auth, 12)).result.ok).toBe(false)

    // Past the window, the earlier issuances no longer count against the provider.
    expect((await underFreshUser(auth, 13, NOW + 60_001)).result.ok).toBe(true)
    expect(auth.issuedToAnybodyWithin(NOW + 60_001)).toBe(1)
  })
})

/**
 * Neither budget lives in the authority's heap.
 *
 * Both read a ledger the **host** supplies, which is what lets a provider that restarts
 * be handed back everything it already issued. The readings here are all in one process,
 * because that is what a pure module can measure: an authority constructed over a ledger
 * it did not write is the in-process form of the cross-process reading Plan 19-07 takes
 * across a real restart. Nothing here claims the restart itself has been measured.
 */
describe('AUTH-04 — the issuance history belongs to the host, not to the authority', () => {
  const providerOptions = { providerPrivateKey: provider.priv, windowMs: 60_000 } as const

  it('counts issuances it never made, because the budget was never its own', async () => {
    const stranger = keypair(200)
    const ledger = testLedger([
      [alice.pub, NOW - 1_000],
      [alice.pub, NOW - 2_000],
      [stranger.pub, NOW - 3_000],
    ])
    const auth = new EnrollmentAuthority({
      ...providerOptions,
      maxPerWindow: 2,
      maxIssuedPerWindow: 3,
      issuance: ledger,
    })

    // A brand-new authority object that has issued nothing, and both readers already
    // report the host's history rather than an empty heap.
    expect(auth.issuedWithin(alice.pub, NOW)).toBe(2)
    expect(auth.issuedToAnybodyWithin(NOW)).toBe(3)

    // And both budgets *bind* on it, which is the assertion this plan exists for.
    const hers = (await enrol(auth, 131)).result
    expect(hers.ok).toBe(false)
    if (hers.ok) return
    expect(hers.refusal.kind).toBe('rate-limited')

    const theirs = (await underFreshUser(auth, 30)).result
    expect(theirs.ok).toBe(false)
    if (theirs.ok) return
    expect(theirs.refusal.kind).toBe('issuance-budget-exhausted')
  })

  it('hands a second authority over the same ledger everything the first issued', async () => {
    // The restart, as far as one process can show it: a new authority object, the same
    // host-owned history. The `'remembers-only-within-this-process'` control below is
    // the same sequence against a heap that is not shared, and it is the behaviour
    // Phase 17 measured as defeating the limit.
    const ledger = testLedger()
    const options = { ...providerOptions, maxPerWindow: 5, maxIssuedPerWindow: 2 } as const

    const first = new EnrollmentAuthority({ ...options, issuance: ledger })
    expect((await underFreshUser(first, 31)).result.ok).toBe(true)
    expect((await underFreshUser(first, 32)).result.ok).toBe(true)

    const second = new EnrollmentAuthority({ ...options, issuance: ledger })
    expect(second.issuedToAnybodyWithin(NOW)).toBe(2)
    const after = (await underFreshUser(second, 33)).result
    expect(after.ok).toBe(false)
    if (after.ok) return
    expect(after.refusal.kind).toBe('issuance-budget-exhausted')

    // The control. Same options, same requests, a history that is this object's own.
    const forgetful = new EnrollmentAuthority({
      ...options,
      issuance: 'remembers-only-within-this-process',
    })
    expect((await underFreshUser(forgetful, 31)).result.ok).toBe(true)
    expect((await underFreshUser(forgetful, 32)).result.ok).toBe(true)
    const restarted = new EnrollmentAuthority({
      ...options,
      issuance: 'remembers-only-within-this-process',
    })
    expect(restarted.issuedToAnybodyWithin(NOW)).toBe(0)
    expect((await underFreshUser(restarted, 33)).result.ok).toBe(true)
  })

  it('records every issuance where the host can see it, by user key and in the aggregate', async () => {
    const ledger = testLedger()
    const auth = new EnrollmentAuthority({
      ...providerOptions,
      maxPerWindow: 5,
      maxIssuedPerWindow: 'issues-without-an-aggregate-budget',
      issuance: ledger,
    })

    expect((await enrol(auth, 132)).result.ok).toBe(true)
    expect((await underFreshUser(auth, 34)).result.ok).toBe(true)

    expect(ledger.issuedTo(alice.pub)).toEqual([NOW])
    expect(ledger.issuedToAnybody()).toEqual([NOW, NOW])
    // A refusal consumes nothing, so the ledger is a record of certificates rather than
    // of attempts — which is the property the per-user ordering above rests on.
    expect((await underFreshUser(auth, 35, NOW)).result.ok).toBe(true)
    expect(ledger.writes).toHaveLength(3)
  })

  it('records synchronously, which is why the serving branch takes no capacity slot', async () => {
    // `agent.ts` records that `enrol` is fully synchronous and that this is *why* the
    // enrol branch takes no capacity slot. So the write is asserted visible on the line
    // after the call, with no `await` anywhere in this case.
    //
    // **Which mutation actually holds that argument was measured, because the obvious
    // one does not.** Giving `IssuanceLedger.record` a `Promise<void>` return type leaves
    // `agent.ts` compiling perfectly — `enrol` still returns a value, and the write is
    // merely a floating promise; the only `tsc` complaint is against a hand-written
    // ledger like the one above. What the compiler *does* refuse is `enrol` itself
    // becoming `async`: `agent.ts:724` then reports `{ kind: 'enrol'; result:
    // Promise<EnrollmentResult> }` is not an `AgentResponse`. The signature is the
    // compile-time guard; this case is the runtime one, and a port that awaited inside
    // would be caught here rather than there.
    const ledger = testLedger()
    const auth = new EnrollmentAuthority({
      ...providerOptions,
      maxPerWindow: 5,
      maxIssuedPerWindow: 5,
      issuance: ledger,
    })

    const result = auth.enrol(
      await requestEnrollment(keypair(133).priv, alice.priv, {
        operatorId: 'alice-op',
        discoverability: 'seed',
        relayIds: [],
      }),
      NOW,
    )

    expect(result).not.toBeInstanceOf(Promise)
    expect(result.ok).toBe(true)
    expect(ledger.writes).toEqual([[alice.pub, NOW]])
  })

  it('reproduces the per-process behaviour exactly when a caller asks for it by name', async () => {
    // What licenses the one-line sentinel written at every other construction site in
    // this repository: on the sentinel, the existing rate-limit readings are unchanged.
    const auth = authority({ maxPerWindow: 3, windowMs: 60_000 })
    for (let i = 0; i < 3; i++) expect((await enrol(auth, 140 + i)).result.ok).toBe(true)
    const fourth = (await enrol(auth, 143)).result
    expect(fourth.ok).toBe(false)
    if (fourth.ok) return
    expect(fourth.refusal.kind).toBe('rate-limited')
    expect(auth.issuedWithin(alice.pub, NOW)).toBe(3)
    expect(auth.issuedToAnybodyWithin(NOW)).toBe(3)

    // Past the window it slides, exactly as before.
    expect((await enrol(auth, 144, { at: NOW + 60_001 })).result.ok).toBe(true)
  })
})

describe('AUTH-05 — certificates chain to a user key, forming a replica set', () => {
  it('groups an owner’s nodes and reports whether redundancy is available', async () => {
    const auth = authority({ maxPerWindow: 10 })
    const certs = [(await enrol(auth, 60)).result, (await enrol(auth, 61)).result]
      .filter((r): r is Extract<typeof r, { ok: true }> => r.ok)
      .map((r) => r.certificate)

    const sets = resolveReplicaSets(certs, new Set([auth.issuerKey]), NOW)
    expect(sets).toHaveLength(1)
    expect(sets[0]!.userKey).toBe(alice.pub)
    expect(sets[0]!.certificates).toHaveLength(2)
    // Two live nodes means a sovereign task can run redundantly inside the owner's
    // own trust domain — the only place redundancy is available to it.
    expect(sets[0]!.canVerifyWithinOwnerDomain).toBe(true)
  })

  it('reports a single-node owner as unable to verify within its domain', async () => {
    const auth = authority()
    const { result } = await enrol(auth, 70)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const sets = resolveReplicaSets([result.certificate], new Set([auth.issuerKey]), NOW)
    expect(sets[0]!.canVerifyWithinOwnerDomain).toBe(false)
  })

  it('will not let an unverifiable certificate inflate a replica count', async () => {
    // The dangerous case: a forged extra node making an owner-attested result look
    // like an owner-domain verified one.
    const auth = authority()
    const { result } = await enrol(auth, 80)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const forged: NodeCertificate = { ...result.certificate, nodeKey: keypair(81).pub }

    const sets = resolveReplicaSets([result.certificate, forged], new Set([auth.issuerKey]), NOW)
    expect(sets[0]!.certificates).toHaveLength(1)
    expect(sets[0]!.canVerifyWithinOwnerDomain).toBe(false)
  })
})

describe('all nodes have equal functionality', () => {
  it('issues an identical certificate however the node is discovered', async () => {
    // The certificate says how a node is found and nothing about what it may do.
    // A relay-discovered peer and a seed differ in one field's value — never in
    // shape, weight, or which checks apply.
    const auth = authority({ maxPerWindow: 10 })
    const relayed = (await enrol(auth, 90, { relayIds: ['relay-1'] })).result
    const direct = (await enrol(auth, 91, { relayIds: [] })).result
    expect(relayed.ok && direct.ok).toBe(true)
    if (!relayed.ok || !direct.ok) return

    expect(Object.keys(relayed.certificate).sort()).toEqual(Object.keys(direct.certificate).sort())
    expect(relayed.certificate.discoverability).toBe('via-relay')
    expect(direct.certificate.discoverability).toBe('seed')

    // Both verify by exactly the same path.
    const anchors = new Set([auth.issuerKey])
    expect(verifyCertificate(relayed.certificate, anchors, NOW).ok).toBe(true)
    expect(verifyCertificate(direct.certificate, anchors, NOW).ok).toBe(true)
  })

  it('signs the relay set, so a shared dependency cannot be hidden', async () => {
    // Quorum path-diversity reads relayIds. If they were unsigned, a node could
    // understate its discovery dependencies and slip into a quorum it should not
    // share.
    const auth = authority()
    const { result } = await enrol(auth, 92, { relayIds: ['relay-1'] })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const understated = { ...result.certificate, relayIds: [] }
    expect(verifyCertificate(understated, new Set([auth.issuerKey]), NOW).ok).toBe(false)
  })
})

/**
 * AUTH-01 freshness — the nonce, and the state that makes it one.
 *
 * `enrol-agent.test.ts` holds the end-to-end reading: a captured frame, resent by a peer
 * holding no key, refused. These are the unit-level facts that reading rests on, and each
 * is here because it is invisible from the wire.
 *
 * **A nonce a provider does not remember is not a nonce**, so what is actually asserted
 * below is the *memory*: that a mint is held, that redeeming removes it rather than merely
 * refusing the second attempt, that the removal is observable in a count, and that a
 * second authority — which is what a restarted provider is — holds none of the first's.
 * That last case is the restart behaviour, and it fails **closed**: the successor refuses a
 * nonce it never minted, which is one round trip of cost to an honest joiner and no
 * exposure at all.
 */
describe('AUTH-01 — an enrolment challenge is minted once and spent once', () => {
  const NONCE_TTL = 60_000

  /** A request that answers `minted`, signed by the node that request names. */
  async function answering(auth: EnrollmentAuthority, seed: number, at: number) {
    const node = keypair(seed)
    const pending = await requestEnrollment(node.priv, alice.priv, {
      operatorId: 'alice-op',
      discoverability: 'seed',
      relayIds: [],
    })
    const minted = auth.mintChallenge(at)
    return { node, minted, request: { ...pending, freshness: pending.answering(minted) } }
  }

  it('refuses a request that answers no challenge, and states the window it needed', async () => {
    const auth = authority()
    const pending = await requestEnrollment(keypair(200).priv, alice.priv, {
      operatorId: 'alice-op',
      discoverability: 'seed',
      relayIds: [],
    })

    // What `requestEnrollment` produces before it has spoken to anybody. It is a valid
    // request in every other respect — `enrol` itself certifies it, which is the split
    // this module's header describes — and it is refused the moment freshness is asked for.
    expect(auth.enrol(pending, NOW).ok).toBe(true)

    const refused = auth.redeemChallenge(pending, NOW)
    expect(refused).not.toBeNull()
    expect(refused?.refusal).toEqual({ kind: 'stale-challenge', ttlMs: NONCE_TTL })
    // The threshold is carried, not merely implied: a joiner told its challenge went stale
    // has to know the window its next attempt must answer within, and a window readable
    // only from the provider's source is not stated to the peer that hit it.
    expect(refused?.reason).toContain(`${NONCE_TTL}ms`)
  })

  it('spends a challenge by deleting it, so the identical answer fails the second time', async () => {
    const auth = authority()
    const { request } = await answering(auth, 201, NOW)

    expect(auth.outstandingChallenges(NOW)).toBe(1)
    expect(auth.redeemChallenge(request, NOW)).toBeNull()
    // **Deleted, not marked.** The count is the assertion: a provider that merely refused
    // a repeat would still be holding the nonce, and would grow one entry per enrolment
    // for ever. This is also why the three stale states share one refusal kind — after
    // this line the provider genuinely cannot tell a spent nonce from one it never minted.
    expect(auth.outstandingChallenges(NOW)).toBe(0)

    const replayed = auth.redeemChallenge(request, NOW)
    expect(replayed?.refusal).toEqual({ kind: 'stale-challenge', ttlMs: NONCE_TTL })
  })

  it('refuses an answer signed by a key other than the one the request names', async () => {
    const auth = authority()
    const { minted, request } = await answering(auth, 202, NOW)
    const impostor = keypair(203)

    // A well-formed signature over the right nonce and the right two keys, by somebody who
    // does not hold `nodeKey`. Refused as `bad-proof-of-possession` and **not** as
    // `stale-challenge`: the nonce was live, and this is a claim about the key. Telling
    // this joiner its challenge went stale would send it to fetch another one for ever.
    const lifted = {
      ...request,
      freshness: {
        nonce: minted.nonce,
        proof: toHex(
          ed25519.sign(challengeAnswerBytes(minted.nonce, request.nodeKey, request.userKey), impostor.priv),
        ),
      },
    }
    expect(auth.redeemChallenge(lifted, NOW)?.refusal.kind).toBe('bad-proof-of-possession')

    // And the nonce survived the bad answer, so a junk signature cannot burn a live
    // challenge out from under the node that was going to answer it.
    expect(auth.outstandingChallenges(NOW)).toBe(1)
    expect(auth.redeemChallenge(request, NOW)).toBeNull()
  })

  it('refuses an answer transplanted onto a request naming different keys', async () => {
    const auth = authority()
    const first = await answering(auth, 204, NOW)
    const second = await answering(auth, 205, NOW)

    // `second`'s request, carrying `first`'s answer. Both answers are genuine and both
    // nonces are live — what fails is the binding: `challengeAnswerBytes` signs the nonce
    // *together with* the keys, so an answer cannot be lifted between requests. An answer
    // over the bare nonce would make this line accept.
    const transplanted = { ...second.request, freshness: first.request.freshness }
    expect(auth.redeemChallenge(transplanted, NOW)?.refusal.kind).toBe('bad-proof-of-possession')
  })

  it('refuses a challenge answered after its window, and stops counting it as outstanding', async () => {
    const auth = authority()
    const { request } = await answering(auth, 206, NOW)

    expect(auth.outstandingChallenges(NOW + NONCE_TTL - 1)).toBe(1)
    expect(auth.redeemChallenge(request, NOW + NONCE_TTL - 1)).toBeNull()

    const later = await answering(auth, 207, NOW)
    expect(auth.outstandingChallenges(NOW + NONCE_TTL)).toBe(0)
    expect(auth.redeemChallenge(later.request, NOW + NONCE_TTL)?.refusal).toEqual({
      kind: 'stale-challenge',
      ttlMs: NONCE_TTL,
    })
  })

  it('sweeps expired challenges out of the map when the next one is minted', () => {
    const auth = authority()
    for (let i = 0; i < 5; i++) auth.mintChallenge(NOW)
    expect(auth.outstandingChallenges(NOW)).toBe(5)

    // Bounded by mint rate × TTL rather than by lifetime. The sweep is paid for by the
    // request that made it necessary, which is also why an authority nobody asks stops
    // growing rather than needing a timer this module has no way to own.
    auth.mintChallenge(NOW + NONCE_TTL)
    expect(auth.outstandingChallenges(NOW + NONCE_TTL)).toBe(1)
  })

  it('gives a restarted provider none of its predecessor’s outstanding challenges', async () => {
    const before = authority()
    const { request } = await answering(before, 208, NOW)

    // A second authority over the same signing key and the same issuance ledger — which is
    // what a restarted provider is. It holds no challenge, because challenges live in this
    // object's heap and deliberately not in the host port beside them: forgetting issuance
    // history accepts *more*, forgetting a challenge accepts *less*.
    const restarted = authority()
    expect(restarted.outstandingChallenges(NOW)).toBe(0)
    expect(restarted.redeemChallenge(request, NOW)?.refusal).toEqual({
      kind: 'stale-challenge',
      ttlMs: NONCE_TTL,
    })

    // The cost of that, stated so it is not mistaken for a fault: one extra round trip for
    // an honest joiner, which asks the successor for a challenge and enrols.
    const afterRestart = await answering(restarted, 209, NOW)
    expect(restarted.redeemChallenge(afterRestart.request, NOW)).toBeNull()
    expect(restarted.enrol(afterRestart.request, NOW).ok).toBe(true)
  })

  it('mints an unpredictable nonce rather than a derivable one', () => {
    const auth = authority()
    // Same authority, same clock, twenty mints: twenty distinct nonces. A nonce derived
    // from anything a caller can see — the keys, the time, a counter — would be one an
    // attacker could answer in advance, and this is the cheapest reading that catches it.
    const minted = new Set(Array.from({ length: 20 }, () => auth.mintChallenge(NOW).nonce))
    expect(minted.size).toBe(20)
    for (const nonce of minted) expect(nonce).toMatch(/^[0-9a-f]{64}$/)
  })
})

/**
 * Issuance of the X.509 form — the other half of X509-01…07's wiring.
 *
 * `x509.test.ts` proves the gate refuses. These prove a real `EnrollmentAuthority`
 * produces something it accepts, which is what keeps "fail-closed" from degenerating
 * into "refuses everything". The option is opt-in and the default is checked here too,
 * because a default that silently switched on would triple the certificate's cost on the
 * wire for every node in the fabric.
 */
describe('X509-01 — a provider can issue the profile\'s X.509 form alongside the envelope', () => {
  function x509Authority(): EnrollmentAuthority {
    return new EnrollmentAuthority({
      providerPrivateKey: provider.priv,
      maxIssuedPerWindow: 'issues-without-an-aggregate-budget',
      issuance: 'remembers-only-within-this-process',
      x509: 'issues-the-x509-form',
    })
  }

  it('issues no X.509 form by default', async () => {
    const { result } = await enrol(authority(), 220)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.certificate.x509).toBeUndefined()
    // And the certificate still verifies, which is the compatibility claim: `payloadOf`
    // omits the key rather than encoding a null, so this is byte-for-byte the payload
    // this repository signed before the field existed.
    expect(verifyCertificate(result.certificate, new Set([provider.pub]), NOW + 1).ok).toBe(true)
  })

  it('issues a form its own verifier accepts, carrying the envelope\'s fields', async () => {
    const { node, result } = await enrol(x509Authority(), 221, { operatorId: 'alice-op', relayIds: ['relay-2', 'relay-1'] })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const { x509 } = result.certificate
    expect(x509).toBeDefined()
    if (x509 === undefined) return

    // Accepted through the real trust path, not through the decoder directly.
    const verdict = verifyCertificate(result.certificate, new Set([provider.pub]), NOW + 1)
    expect(verdict.ok, verdict.ok ? '' : verdict.reason).toBe(true)

    // And a third party holding only the DER — the interchange case X.509 exists for —
    // reads the same node out of it.
    const decoded = decodeX509Certificate(fromHex(x509))
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.certificate.subjectPublicKey).toBe(node.pub)
    expect(decoded.certificate.userKey).toBe(alice.pub)
    expect(decoded.certificate.operatorId).toBe('alice-op')
    expect(decoded.certificate.discoverability).toBe('via-relay')
    expect(decoded.certificate.relayIds).toEqual(['relay-1', 'relay-2'])
    expect(decoded.certificate.version).toBe(2)
  })

  it('refuses a certificate whose X.509 form was grafted from another node', async () => {
    // The stranger's move rather than the provider's, and it is refused for the profile's
    // own reason rather than for a signature reason — the gate runs before the envelope
    // signature, so the operator is told which half of the statement is wrong.
    const mine = await enrol(x509Authority(), 222)
    const theirs = await enrol(x509Authority(), 223)
    expect(mine.result.ok && theirs.result.ok).toBe(true)
    if (!mine.result.ok || !theirs.result.ok) return
    const grafted: NodeCertificate = { ...mine.result.certificate, x509: theirs.result.certificate.x509 as string }
    const verdict = verifyCertificate(grafted, new Set([provider.pub]), NOW + 1)
    expect(verdict.ok).toBe(false)
    if (verdict.ok) return
    expect(verdict.failure.kind).toBe('x509-mismatch')
  })
})
