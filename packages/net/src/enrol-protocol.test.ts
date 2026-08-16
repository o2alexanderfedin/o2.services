import { ed25519 } from '@noble/curves/ed25519.js'
import { EnrollmentAuthority, requestEnrollment, toHex, verifyCertificate } from '@o2/core'
import type { CanonicalValue, EnrollmentRequest } from '@o2/core'
import { describe, expect, it } from 'vitest'
import { encodeRequest, encodeResponse, parseRequest, parseResponse } from './protocol.ts'

/**
 * AUTH-01, AUTH-02, AUTH-04 — enrollment at the **wire**, not in a unit fixture.
 *
 * Phase 6 proved `EnrollmentAuthority` and `verifyCertificate` against values held in
 * hand. What was never proven is that those values survive a round trip through this
 * repository's canonical encoding without the parser laundering something on the way:
 * a parser that accepted a partly-formed certificate would hand a verifier something to
 * check that is not what the provider signed.
 *
 * Every certificate here is produced by a real `EnrollmentAuthority` and every failure
 * is the one `verifyCertificate` already names. Nothing in this file invents vocabulary.
 *
 * Portable: no `node:` import and no process spawning, so it runs in both the `node` and
 * `browser` vitest projects.
 */

/** Fixed-pattern seeds, so a failure is reproducible rather than a fresh random one. */
function keypair(seed: number): { readonly priv: Uint8Array; readonly pub: string } {
  const priv = new Uint8Array(32).fill(seed)
  return { priv, pub: toHex(ed25519.getPublicKey(priv)) }
}

const provider = keypair(70)
const otherProvider = keypair(71)
const node = keypair(72)
const user = keypair(73)

const NOW = 1_800_000_000_000

function authority(seed: Uint8Array = provider.priv): EnrollmentAuthority {
  return new EnrollmentAuthority({
    providerPrivateKey: seed,
    maxIssuedPerWindow: 'issues-without-an-aggregate-budget',
    issuance: 'remembers-only-within-this-process',
  })
}

/**
 * A genuine request, built by the production helper.
 *
 * `userKey` is **derived** from the user private key rather than passed — naming
 * somebody else's user key is not something `requestEnrollment` can be asked to do, so
 * the fixture cannot accidentally build a request the authority would refuse for a
 * reason unrelated to what is under test.
 */
async function buildRequest(): Promise<EnrollmentRequest> {
  const pending = await requestEnrollment(node.priv, user.priv, {
    operatorId: 'op-a',
    discoverability: 'via-relay',
    relayIds: ['12D3KooWRelayOne', '12D3KooWRelayTwo'],
  })
  // The **wire** request, which is the pending one having answered a challenge.
  //
  // Two things are being kept straight here. `answering` is the ability to sign one
  // provider's nonce with the node's private key — it is deliberately not a wire field,
  // and a fixture that left it attached would compare a parse against something no frame
  // can carry. And the answered arm is the one worth round-tripping: the sentinel is a
  // bare string, so a codec that dropped the nested `{nonce, proof}` entirely would still
  // look correct if this fixture never produced one.
  //
  // The nonce is arbitrary and no authority minted it, which is right for a parser test:
  // whether a provider is holding a nonce is `redeemChallenge`'s question, and a parser
  // that pre-empted it would be answering an entitlement question.
  const { answering, ...wire } = pending
  return { ...wire, freshness: answering({ nonce: toHex(new Uint8Array(32).fill(0xa7)), expiresAt: NOW + 60_000 }) }
}

/** The encoded request's inner record, for the field-by-field omission loop. */
function requestFieldsOf(encoded: CanonicalValue): { [k: string]: CanonicalValue } {
  const outer = encoded as { readonly request: { readonly [k: string]: CanonicalValue } }
  return { ...outer.request }
}

describe('the enrol request survives the wire intact', () => {
  it('round-trips every field, including relayIds order and the two proofs', async () => {
    const request = await buildRequest()
    const parsed = parseRequest(encodeRequest({ kind: 'enrol', request }))
    expect(parsed).toStrictEqual({ kind: 'enrol', request })
  })

  /**
   * The omission loop, and its positive control.
   *
   * Seven nulls from a parser that returned null for *everything* would look identical
   * to seven nulls from a parser that checks each field, so the loop only measures
   * anything next to the assertion above that the untouched value parses. `ownerProof`
   * is in this list because the request carries **two** signatures, not one — the node's
   * proof of possession and the user's consent — and a parser that checked only the
   * first would admit a request naming a user who never signed.
   */
  const FIELDS = [
    'nodeKey',
    'userKey',
    'operatorId',
    'discoverability',
    'relayIds',
    'proofOfPossession',
    'ownerProof',
    // AUTH-01 freshness. Required at the wire like the two proofs beside it, and for the
    // same reason: a parser that admitted a request with no freshness field — or that
    // degraded a broken one to the sentinel — would report a peer's *protocol error* as a
    // *stale challenge*, and the joiner would fetch another nonce, answer it with the same
    // broken encoder, and loop.
    'freshness',
  ] as const

  for (const field of FIELDS) {
    it(`refuses a request with ${field} missing, rather than defaulting it`, async () => {
      const encoded = encodeRequest({ kind: 'enrol', request: await buildRequest() })
      const fields = requestFieldsOf(encoded)
      delete fields[field]
      expect(parseRequest({ kind: 'enrol', request: fields })).toBeNull()
    })
  }

  it('refuses a discoverability this build does not know', async () => {
    const encoded = encodeRequest({ kind: 'enrol', request: await buildRequest() })
    const fields = requestFieldsOf(encoded)
    fields['discoverability'] = 'whenever-it-feels-like-it'
    expect(parseRequest({ kind: 'enrol', request: fields })).toBeNull()
  })
})

describe('a certificate crosses the wire without being laundered', () => {
  /**
   * The positive control for the two negative behaviours below. If the parser corrupted
   * every certificate, "tampering is refused" would pass for entirely the wrong reason.
   */
  it('a valid certificate survives the round trip and still verifies', async () => {
    const issuer = authority()
    const result = issuer.enrol(await buildRequest(), NOW)
    expect(result.ok).toBe(true)

    const parsed = parseResponse(encodeResponse({ kind: 'enrol', result }))
    expect(parsed?.kind).toBe('enrol')
    if (parsed?.kind !== 'enrol' || !parsed.result.ok) throw new Error('expected an ok result')

    expect(parsed.result.certificate).toStrictEqual(result.ok ? result.certificate : null)
    expect(verifyCertificate(parsed.result.certificate, new Set([issuer.issuerKey]), NOW).ok).toBe(true)
  })

  /**
   * Tampering, on two different fields so the outcome is not an artefact of which one
   * was chosen. The alteration is made to the **encoded** value — the shape a peer
   * actually controls — and the parser is then asked to accept it. It does, because
   * a well-formed lie is still well-formed; what refuses it is the signature check,
   * which is exactly the split `parseCertificate`'s doc argues for.
   */
  for (const [field, value] of [
    ['operatorId', 'op-somebody-else'],
    ['expiresAt', NOW + 999_999_999],
  ] as const) {
    it(`refuses a certificate whose ${field} was altered on the wire, as bad-signature`, async () => {
      const issuer = authority()
      const result = issuer.enrol(await buildRequest(), NOW)
      if (!result.ok) throw new Error('expected issuance to succeed')

      const encoded = encodeResponse({ kind: 'enrol', result }) as {
        readonly [k: string]: CanonicalValue
      }
      const certificate = { ...(encoded['certificate'] as { readonly [k: string]: CanonicalValue }) }
      certificate[field] = value

      const parsed = parseResponse({ ...encoded, certificate })
      if (parsed?.kind !== 'enrol' || !parsed.result.ok) throw new Error('tampering was not parsed')

      const verdict = verifyCertificate(parsed.result.certificate, new Set([issuer.issuerKey]), NOW)
      expect(verdict).toMatchObject({ ok: false, failure: { kind: 'bad-signature' } })
      if (verdict.ok) throw new Error('unreachable')
      expect(verdict.failure).toStrictEqual({ kind: 'bad-signature', nodeKey: node.pub })
    })
  }

  it('names the issuer it does not trust, rather than refusing anonymously', async () => {
    const pinned = authority()
    const foreign = authority(otherProvider.priv)
    const result = foreign.enrol(await buildRequest(), NOW)
    if (!result.ok) throw new Error('expected issuance to succeed')

    const parsed = parseResponse(encodeResponse({ kind: 'enrol', result }))
    if (parsed?.kind !== 'enrol' || !parsed.result.ok) throw new Error('expected an ok result')

    const verdict = verifyCertificate(parsed.result.certificate, new Set([pinned.issuerKey]), NOW)
    if (verdict.ok) throw new Error('a foreign issuer was accepted')
    expect(verdict.failure).toStrictEqual({ kind: 'untrusted-issuer', issuer: foreign.issuerKey })
  })

  /**
   * The **literal** self-signed shape — `issuer === nodeKey`.
   *
   * The behaviour above is a defensible restatement of "self-signed": a certificate the
   * verifier's anchors do not cover. But it is a *different sentence*, and nothing else
   * in this phase constructs a certificate whose issuer IS its own subject. This does,
   * with production code only and no forgery flag: an authority over the node's own
   * seed, so `issuerKey === nodeKey` by derivation.
   *
   * The `issuer === nodeKey` assertion below is what makes this the self-signed case
   * rather than merely another foreign one, and it is asserted before the verdict is
   * read so the test cannot pass while measuring something else.
   */
  it('refuses a self-signed certificate, naming the node that signed for itself', async () => {
    const pinned = authority()
    const selfSigned = authority(node.priv)
    const result = selfSigned.enrol(await buildRequest(), NOW)
    if (!result.ok) throw new Error('expected issuance to succeed')

    const parsed = parseResponse(encodeResponse({ kind: 'enrol', result }))
    if (parsed?.kind !== 'enrol' || !parsed.result.ok) throw new Error('expected an ok result')
    const certificate = parsed.result.certificate

    // This is the assertion that makes the case self-signed rather than foreign.
    expect(certificate.issuer).toBe(certificate.nodeKey)
    expect(certificate.issuer).toBe(node.pub)

    const verdict = verifyCertificate(certificate, new Set([pinned.issuerKey]), NOW)
    if (verdict.ok) throw new Error('a self-signed certificate was accepted')
    expect(verdict.failure).toStrictEqual({ kind: 'untrusted-issuer', issuer: node.pub })
  })
})

describe('a refusal crosses the wire with its numbers intact', () => {
  it('round-trips the rate-limited arm with all four values', () => {
    const result = {
      ok: false,
      refusal: {
        kind: 'rate-limited',
        userKey: user.pub,
        limit: 5,
        windowMs: 3_600_000,
        retryAfterMs: 12_345,
      },
      reason: 'too many, too fast',
    } as const

    const parsed = parseResponse(encodeResponse({ kind: 'enrol', result }))
    expect(parsed).toStrictEqual({ kind: 'enrol', result })
  })

  it('round-trips the bad-proof-of-possession arm with its nodeKey', () => {
    const result = {
      ok: false,
      refusal: { kind: 'bad-proof-of-possession', nodeKey: node.pub },
      reason: 'no proof',
    } as const
    expect(parseResponse(encodeResponse({ kind: 'enrol', result }))).toStrictEqual({
      kind: 'enrol',
      result,
    })
  })

  /**
   * The third arm. `EnrollmentRefusal` has **four** kinds, not two: a node that did not
   * prove possession and a user who did not consent are different events with different
   * remedies, and the wire has to keep them apart.
   */
  it('round-trips the bad-owner-proof arm with its userKey', () => {
    const result = {
      ok: false,
      refusal: { kind: 'bad-owner-proof', userKey: user.pub },
      reason: 'the named user did not sign',
    } as const
    expect(parseResponse(encodeResponse({ kind: 'enrol', result }))).toStrictEqual({
      kind: 'enrol',
      result,
    })
  })

  /**
   * The fourth arm, and the reason this plan's *"no wire change anywhere"* was wrong.
   *
   * `EnrollmentRefusal` is a wire type: `serveAgent` answers an `enrol` frame with the
   * `EnrollmentResult` the authority produced, and this module is what puts it on the
   * wire. Adding a refusal kind therefore **is** a wire change, whatever else the plan
   * that added it changed. `tsc` found the encoder — `refusal.userKey` stopped existing
   * on the union — and said nothing at all about the parser, which returns `null` for a
   * kind it does not know and compiles clean while doing it. A provider would have
   * refused correctly and the peer would have read a malformed frame.
   *
   * The arm carries **no `userKey`**, so this case is also what would fail if somebody
   * copied the `rate-limited` arm and left the requester's key in it.
   */
  it('round-trips the issuance-budget-exhausted arm, which names nobody', () => {
    const result = {
      ok: false,
      refusal: {
        kind: 'issuance-budget-exhausted',
        limit: 5,
        windowMs: 3_600_000,
        retryAfterMs: 12_345,
      },
      reason: 'this provider has issued 5 certificates in the last 3600000ms (limit 5)',
    } as const

    const parsed = parseResponse(encodeResponse({ kind: 'enrol', result }))
    expect(parsed).toStrictEqual({ kind: 'enrol', result })
    // The threshold reaches the peer that hit it, which is what "stated threshold"
    // means — and the reason names no user key, on the wire as well as in the object.
    if (parsed?.kind !== 'enrol' || parsed.result.ok) throw new Error('expected a refusal')
    if (parsed.result.refusal.kind !== 'issuance-budget-exhausted') throw new Error('wrong kind')
    expect(Object.keys(parsed.result.refusal)).not.toContain('userKey')
    expect(parsed.result.reason).not.toContain(user.pub)
  })

  it('refuses an issuance-budget-exhausted arm whose numbers are not numbers', () => {
    const parsed = parseResponse({
      kind: 'enrol',
      ok: false,
      refusal: { kind: 'issuance-budget-exhausted', limit: 5, windowMs: 'an hour', retryAfterMs: 1 },
      reason: 'malformed',
    })
    expect(parsed).toBeNull()
  })

  it('refuses a refusal kind this build does not know, rather than half-populating one', () => {
    const parsed = parseResponse({
      kind: 'enrol',
      ok: false,
      refusal: { kind: 'insufficiently-polite', userKey: user.pub },
      reason: 'from a newer build',
    })
    expect(parsed).toBeNull()
  })

  it('refuses a rate-limited arm whose numbers are not numbers', () => {
    const parsed = parseResponse({
      kind: 'enrol',
      ok: false,
      refusal: {
        kind: 'rate-limited',
        userKey: user.pub,
        limit: 'lots',
        windowMs: 3_600_000,
        retryAfterMs: 1,
      },
      reason: 'malformed',
    })
    expect(parsed).toBeNull()
  })
})

/**
 * The X.509 form at the wire — X509-01…07's transport half.
 *
 * The gate that refuses a malformed form lives in `verifyCertificate`, and it can only
 * refuse what reaches it. This file's own subject is whether the parser launders
 * anything on the way, and the X.509 form is the field where laundering would be both
 * easiest and worst: a certificate silently stripped of a field its issuer signed no
 * longer verifies, so a reader would be told `bad-signature` about a frame that this
 * parser had damaged.
 */
describe('X509-04 — the X.509 form survives the wire, and a malformed one is not laundered', () => {
  function x509Authority(): EnrollmentAuthority {
    return new EnrollmentAuthority({
      providerPrivateKey: provider.priv,
      maxIssuedPerWindow: 'issues-without-an-aggregate-budget',
      issuance: 'remembers-only-within-this-process',
      x509: 'issues-the-x509-form',
    })
  }

  it('carries the form across the wire intact, so the certificate still verifies', async () => {
    const issuer = x509Authority()
    const result = issuer.enrol(await buildRequest(), NOW)
    if (!result.ok) throw new Error('expected issuance to succeed')
    expect(result.certificate.x509).toBeDefined()

    const parsed = parseResponse(encodeResponse({ kind: 'enrol', result }))
    if (parsed?.kind !== 'enrol' || !parsed.result.ok) throw new Error('expected an ok result')

    expect(parsed.result.certificate.x509).toBe(result.certificate.x509)
    expect(verifyCertificate(parsed.result.certificate, new Set([issuer.issuerKey]), NOW).ok).toBe(true)
  })

  it('refuses the whole frame when the x509 field is not a string, rather than dropping it', async () => {
    const issuer = x509Authority()
    const result = issuer.enrol(await buildRequest(), NOW)
    if (!result.ok) throw new Error('expected issuance to succeed')

    const encoded = encodeResponse({ kind: 'enrol', result }) as { readonly [k: string]: CanonicalValue }
    const certificate = { ...(encoded['certificate'] as { readonly [k: string]: CanonicalValue }) }
    certificate['x509'] = 12345

    expect(parseResponse({ ...encoded, certificate })).toBeNull()
  })

  it('lets an altered form reach the gate, which refuses it by the profile\'s own name', async () => {
    // Altered on the **encoded** value, which is the shape a peer actually controls. The
    // parser accepts it — a well-formed lie is still well-formed — and the refusal comes
    // from the profile rather than from the signature, because the gate runs first.
    const issuer = x509Authority()
    const result = issuer.enrol(await buildRequest(), NOW)
    if (!result.ok) throw new Error('expected issuance to succeed')

    const encoded = encodeResponse({ kind: 'enrol', result }) as { readonly [k: string]: CanonicalValue }
    const certificate = { ...(encoded['certificate'] as { readonly [k: string]: CanonicalValue }) }
    certificate['x509'] = `${certificate['x509'] as string}ff`.repeat(1)

    const parsed = parseResponse({ ...encoded, certificate })
    if (parsed?.kind !== 'enrol' || !parsed.result.ok) throw new Error('tampering was not parsed')

    const verdict = verifyCertificate(parsed.result.certificate, new Set([issuer.issuerKey]), NOW)
    expect(verdict.ok).toBe(false)
    if (verdict.ok) return
    expect(verdict.failure.kind).toBe('x509-profile-refused')
  })
})
