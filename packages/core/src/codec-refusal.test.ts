import { ed25519 } from '@noble/curves/ed25519.js'
import { CID } from 'multiformats/cid'
import { describe, expect, it } from 'vitest'
import { NotEncodableError } from './canonical/encode.ts'
import { delegate, toHex, verifyChain } from './capability.ts'
import type { PublicKeyHex } from './capability.ts'
import { publishCapabilities, verifyCapabilityRecord } from './discovery.ts'
import { EnrollmentAuthority, requestEnrollment, verifyCertificate } from './enrollment.ts'
import type { NodeCertificate } from './enrollment.ts'
import { SignedNameResolver, signName } from './naming.ts'

/**
 * A record this package cannot encode is not a peer who forged a signature.
 *
 * Six verify paths wrapped an `ed25519.verify` **and the payload builder that feeds
 * it** in one `try`, and turned everything the `try` saw into a verdict. Turning a
 * *verify* throw into "invalid" is sound: the signature, the key and the hex are all
 * the peer's, so a failure there is a statement about them. Turning an *encode* throw
 * into "invalid" is a wrong accusation, because the payload was built here, from a
 * record shape this package defines, by a codec this package chose. The peer is not
 * mentioned in that event at all.
 *
 * What the six reported instead of "this record will not canonically encode":
 * `bad-proof-of-possession`, `bad-owner-proof`, `bad-signature` three times, and a
 * bare `false`. By this repository's rule — *a refusal that names the wrong thing is
 * a defect even when the operation correctly fails* — six defects, and the direction
 * matters: a bug in our own encoder read on the wire as a peer lying.
 *
 * Every case below therefore asserts **both** halves, because either alone can pass
 * while the defect stands:
 *
 *   1. the codec failure arrives as `NotEncodableError`, and its text names the
 *      record, the kind of codec failure, and the field — and
 *   2. a genuine forgery still comes back as the forgery verdict it always was.
 *
 * The second is not ceremony. The obvious over-correction — hoisting the *verify*
 * out of the `try` along with the payload — would satisfy (1) and silently convert
 * every bad signature in the fabric into a thrown exception.
 *
 * The non-finite float is the natural probe rather than a contrived one: DAG-CBOR's
 * specification says NaN and the infinities "must not be accepted", and `expiresAt:
 * Infinity` is what a record meaning "never expires" looks like when someone writes
 * it the obvious way.
 */

function keypair(seed: number): { readonly priv: Uint8Array; readonly pub: PublicKeyHex } {
  const priv = new Uint8Array(32).fill(seed)
  return { priv, pub: toHex(ed25519.getPublicKey(priv)) }
}

const provider = keypair(70)
const owner = keypair(71)
const node = keypair(72)
const audience = keypair(73)
const NOW = 1_800_000_000_000
const FIXED_CID = CID.parse('bafyreidykglsfhoixmivffc5uwhcgshx4j465xwqntbmu43nb2dzqwfvae')

/** Run `body` and hand back whatever it produced — a value or a throw. */
function outcomeOf<T>(body: () => T): { readonly kind: 'returned'; readonly value: T } | { readonly kind: 'threw'; readonly error: unknown } {
  try {
    return { kind: 'returned', value: body() }
  } catch (error) {
    return { kind: 'threw', error }
  }
}

/**
 * Assert a throw is the codec naming itself, and say what it named.
 *
 * Kind alone is not enough — an assertion that only reads `instanceof` passes while
 * the message says something false, and the message is what a human reads at 3am.
 */
function expectNotEncodable(
  outcome: ReturnType<typeof outcomeOf>,
  what: string,
  field: string,
): void {
  expect(outcome.kind).toBe('threw')
  if (outcome.kind !== 'threw') return
  expect(outcome.error).toBeInstanceOf(NotEncodableError)
  if (!(outcome.error instanceof NotEncodableError)) return

  expect(outcome.error.what).toBe(what)
  expect(outcome.error.message).toContain(`${what} not encodable`)
  expect(outcome.error.message).toContain('non-finite-float')
  expect(outcome.error.message).toContain(field)
  expect(outcome.error.error.kind).toBe('non-finite-float')
  if (outcome.error.error.kind !== 'non-finite-float') return
  expect(outcome.error.error.path).toBe(field)
}

describe('a certificate that will not encode is not a certificate with a bad signature', () => {
  function certificate(overrides: Partial<NodeCertificate> = {}): NodeCertificate {
    const auth = new EnrollmentAuthority({
      providerPrivateKey: provider.priv,
      maxIssuedPerWindow: 'issues-without-an-aggregate-budget',
      issuance: 'remembers-only-within-this-process',
    })
    const issued = auth.enrol(
      requestEnrollment(node.priv, owner.priv, {
        operatorId: 'op',
        discoverability: 'seed',
        relayIds: [],
      }),
      NOW,
    )
    if (!issued.ok) throw new Error('fixture did not enrol')
    return { ...issued.certificate, ...overrides }
  }

  it('names the codec and the field, instead of accusing the issuer of forging it', () => {
    const anchors = new Set([provider.pub])
    // "Never expires", written the obvious way. Every other field is untouched and
    // the signature is the real one the authority produced.
    const forever = certificate({ expiresAt: Number.POSITIVE_INFINITY })

    expectNotEncodable(
      outcomeOf(() => verifyCertificate(forever, anchors, NOW)),
      'certificate',
      'expiresAt',
    )
  })

  it('still calls a real forgery bad-signature', () => {
    const anchors = new Set([provider.pub])
    const forged = certificate({ operatorId: 'someone-else' })

    const verdict = verifyCertificate(forged, anchors, NOW)
    expect(verdict.ok).toBe(false)
    if (verdict.ok) return
    expect(verdict.failure.kind).toBe('bad-signature')
    expect(verdict.reason).toContain('has an invalid signature')
  })
})

describe('a name record that will not encode is not a name record with a bad signature', () => {
  const resolver = () => new SignedNameResolver([provider.pub])

  it('names the codec and the field, instead of accusing the signer', () => {
    // Signed with a finite expiry and then given the infinite one, because
    // `signName` builds the same payload and would refuse it first. That is the shape
    // the defect actually takes anyway: a record arrives already carrying the value.
    const signed = signName(provider.priv, {
      name: 'demo/kernel',
      cid: FIXED_CID,
      version: 1,
      expiresAt: NOW + 1_000,
    })
    const record = { ...signed, expiresAt: Number.POSITIVE_INFINITY }

    expectNotEncodable(outcomeOf(() => resolver().accept(record, NOW)), 'name record', 'expiresAt')
  })

  it('still calls a real forgery bad-signature', () => {
    const signed = signName(provider.priv, {
      name: 'demo/kernel',
      cid: FIXED_CID,
      version: 1,
      expiresAt: NOW + 1_000,
    })
    const tampered = { ...signed, version: 99 }

    const verdict = resolver().accept(tampered, NOW)
    expect(verdict.ok).toBe(false)
    if (verdict.ok) return
    expect(verdict.failure.kind).toBe('bad-signature')
    expect(verdict.reason).toContain('has an invalid signature')
  })
})

describe('a delegation that will not encode is not a link with a bad signature', () => {
  const options = {
    ownerKey: owner.pub,
    ownerId: 'owner-1',
    audience: audience.pub,
    ability: 'execute' as const,
    now: NOW,
  }

  it('names the codec and the field, instead of accusing the link issuer', () => {
    const signed = delegate(owner.priv, {
      audience: audience.pub,
      ownerId: 'owner-1',
      abilities: ['execute'],
      expiresAt: NOW + 1_000,
    })
    const link = { ...signed, expiresAt: Number.POSITIVE_INFINITY }

    expectNotEncodable(outcomeOf(() => verifyChain([link], options)), 'delegation', 'expiresAt')
  })

  it('still calls a real forgery bad-signature, naming the link index', () => {
    const link = delegate(owner.priv, {
      audience: audience.pub,
      ownerId: 'owner-1',
      abilities: ['execute'],
      expiresAt: NOW + 1_000,
    })
    const tampered = { ...link, abilities: ['execute', 'delegate'] as const }

    const verdict = verifyChain([tampered], options)
    expect(verdict.ok).toBe(false)
    if (verdict.ok) return
    expect(verdict.failure.kind).toBe('bad-signature')
    if (verdict.failure.kind !== 'bad-signature') return
    expect(verdict.failure.index).toBe(0)
  })
})

describe('a capability record that will not encode is not a record that failed to verify', () => {
  it('names the codec and the field, instead of answering a bare false', () => {
    // `expiresAt: Infinity` clears the date guard above the signature check — it is
    // not expired, by construction — so the payload build is genuinely reached.
    const signed = publishCapabilities(node.priv, {
      features: ['simd128'],
      sovereignFor: [],
      issuedAt: NOW - 1_000,
      expiresAt: NOW + 1_000,
    })
    const record = { ...signed, expiresAt: Number.POSITIVE_INFINITY }

    expectNotEncodable(
      outcomeOf(() => verifyCapabilityRecord(record, NOW)),
      'capability record',
      'expiresAt',
    )
  })

  it('still answers false for a real forgery, and true for an untouched record', () => {
    const record = publishCapabilities(node.priv, {
      features: ['simd128'],
      sovereignFor: [],
      issuedAt: NOW - 1_000,
      expiresAt: NOW + 1_000,
    })

    expect(verifyCapabilityRecord(record, NOW)).toBe(true)
    expect(verifyCapabilityRecord({ ...record, features: ['simd128', 'threads'] }, NOW)).toBe(false)
  })
})

/**
 * The two `enrol` sites, which cannot be reached the way the four above are.
 *
 * `possessionChallenge` encodes `{ purpose, nodeKey, userKey }` — three strings — and
 * `encodeCanonical` has nothing to reject in a record of strings. So the defect was
 * unreachable through a well-typed request, and these two cases pass a value the
 * declared type forbids to reach it, exactly as an in-process caller of this exported
 * function can. That is the boundary being tested: `enrol` is public API and a type
 * annotation is not a runtime guarantee at a package edge.
 *
 * What the old code did with it is the point. Both sites caught the encode throw and
 * set the verdict false, so a caller who handed `enrol` a bad key was told *the node
 * did not prove possession of its key* — a claim about the node's cryptography, made
 * on the strength of an encoder error.
 */
describe('a challenge that will not encode is not a node failing to prove possession', () => {
  const auth = () =>
    new EnrollmentAuthority({
      providerPrivateKey: provider.priv,
      maxIssuedPerWindow: 'issues-without-an-aggregate-budget',
      issuance: 'remembers-only-within-this-process',
    })
  const valid = () =>
    requestEnrollment(node.priv, owner.priv, {
      operatorId: 'op',
      discoverability: 'seed',
      relayIds: [],
    })

  it('names the codec and the field, instead of bad-proof-of-possession', () => {
    const request = { ...valid(), nodeKey: Number.NaN as unknown as PublicKeyHex }

    expectNotEncodable(outcomeOf(() => auth().enrol(request, NOW)), 'challenge', 'nodeKey')
  })

  it('names the codec and the field, instead of bad-owner-proof', () => {
    const request = { ...valid(), userKey: Number.NEGATIVE_INFINITY as unknown as PublicKeyHex }

    expectNotEncodable(outcomeOf(() => auth().enrol(request, NOW)), 'challenge', 'userKey')
  })

  it('still refuses a request that genuinely did not prove possession', () => {
    const stranger = keypair(74)
    const request = { ...valid(), proofOfPossession: toHex(ed25519.sign(new Uint8Array(8), stranger.priv)) }

    const result = auth().enrol(request, NOW)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.refusal.kind).toBe('bad-proof-of-possession')
    expect(result.reason).toContain('did not prove possession of its key')
  })

  it('still refuses a request the named user did not consent to', () => {
    const stranger = keypair(75)
    const request = { ...valid(), ownerProof: toHex(ed25519.sign(new Uint8Array(8), stranger.priv)) }

    const result = auth().enrol(request, NOW)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.refusal.kind).toBe('bad-owner-proof')
    expect(result.reason).toContain('did not consent to')
  })
})
