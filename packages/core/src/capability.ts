/**
 * Capability chains — AUTH-03, DET-03.
 *
 * A task arriving at a node has to prove it is allowed to touch that owner's data.
 * The proof is a chain of signed delegations rooted at the owner's own key: the
 * owner delegates to a coordinator, the coordinator may delegate onward, and the node
 * verifies the whole chain before it instantiates anything.
 *
 * Rolled by hand rather than pulling in UCAN or an SPKI library, after weighing it:
 * the whole surface needed here is *sign a small canonical record, verify a linked
 * sequence of them*. `@noble/curves` already provides the hard part, and the
 * canonical encoder already guarantees a stable byte representation to sign over —
 * which is the single thing a home-grown scheme normally gets wrong. Adopting UCAN
 * would mean adopting DID resolution, a JWT envelope, and a specification still in
 * flux, to gain semantics this project does not yet use. Revisit if interop with
 * other UCAN systems is ever wanted.
 *
 * ## What verification refuses, and how loudly
 *
 * A refusal names the link that failed. "Not authorised" sends someone reading a log
 * hunting through an entire chain; "link 2 delegates to a key that link 3 was not
 * issued by" points at the break. Every rejection below carries an index.
 *
 * Pure module.
 */

import { ed25519 } from '@noble/curves/ed25519.js'
import { NotEncodableError, encodeCanonical } from './canonical/encode.ts'
import type { CanonicalValue } from './canonical/encode.ts'

const HEX = '0123456789abcdef'

export function toHex(bytes: Uint8Array): string {
  let out = ''
  for (const byte of bytes) out += HEX[byte >> 4]! + HEX[byte & 0x0f]!
  return out
}

export function fromHex(hex: string): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(hex.length >> 1)
  for (let i = 0; i < bytes.length; i++) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return bytes
}

/** An ed25519 public key, hex-encoded. Serves as a principal's identity. */
export type PublicKeyHex = string

/** What a delegation permits. Coarse on purpose — finer scopes can be added later. */
export type Ability = 'execute' | 'read' | 'delegate'

/** One link: `issuer` grants `audience` these abilities over this owner's data. */
export interface Delegation {
  readonly issuer: PublicKeyHex
  readonly audience: PublicKeyHex
  readonly ownerId: string
  readonly abilities: readonly Ability[]
  /** Unix milliseconds. Absolute rather than a duration so it cannot drift. */
  readonly expiresAt: number
  readonly signature: string
}

/** The bytes a delegation's signature covers — everything except the signature. */
function payloadOf(delegation: Omit<Delegation, 'signature'>): Uint8Array<ArrayBuffer> {
  const value: CanonicalValue = {
    issuer: delegation.issuer,
    audience: delegation.audience,
    ownerId: delegation.ownerId,
    // Sorted so two callers listing the same abilities in a different order produce
    // the same bytes, and therefore the same signature.
    abilities: [...delegation.abilities].sort(),
    expiresAt: delegation.expiresAt,
  }
  const encoded = encodeCanonical(value)
  if (!encoded.ok) throw new NotEncodableError('delegation', encoded.error)
  return encoded.bytes
}

/** Issue and sign one delegation. */
export function delegate(
  issuerPrivateKey: Uint8Array,
  fields: Omit<Delegation, 'signature' | 'issuer'>,
): Delegation {
  const issuer = toHex(ed25519.getPublicKey(issuerPrivateKey))
  const unsigned = { ...fields, issuer }
  const signature = toHex(ed25519.sign(payloadOf(unsigned), issuerPrivateKey))
  return { ...unsigned, signature }
}

export type ChainFailure =
  | { readonly kind: 'empty-chain' }
  | { readonly kind: 'wrong-root'; readonly index: number; readonly expected: PublicKeyHex; readonly found: PublicKeyHex }
  | { readonly kind: 'broken-link'; readonly index: number; readonly expected: PublicKeyHex; readonly found: PublicKeyHex }
  | { readonly kind: 'bad-signature'; readonly index: number; readonly issuer: PublicKeyHex }
  | { readonly kind: 'expired'; readonly index: number; readonly expiresAt: number; readonly now: number }
  | { readonly kind: 'owner-mismatch'; readonly index: number; readonly expected: string; readonly found: string }
  | { readonly kind: 'missing-ability'; readonly index: number; readonly ability: Ability }
  | { readonly kind: 'not-delegable'; readonly index: number }
  | { readonly kind: 'wrong-audience'; readonly expected: PublicKeyHex; readonly found: PublicKeyHex }

/** A human-readable account of a refusal, naming the link that broke. */
export function describeFailure(failure: ChainFailure): string {
  switch (failure.kind) {
    case 'empty-chain':
      return 'no capability chain supplied'
    case 'wrong-root':
      return `link 0 is issued by ${failure.found}, but the data owner's key is ${failure.expected}`
    case 'broken-link':
      return `link ${failure.index} is issued by ${failure.found}, but link ${failure.index - 1} delegated to ${failure.expected}`
    case 'bad-signature':
      return `link ${failure.index} has an invalid signature for issuer ${failure.issuer}`
    case 'expired':
      return `link ${failure.index} expired at ${failure.expiresAt}, now ${failure.now}`
    case 'owner-mismatch':
      return `link ${failure.index} is scoped to owner ${failure.found}, not ${failure.expected}`
    case 'missing-ability':
      return `link ${failure.index} does not carry the "${failure.ability}" ability`
    case 'not-delegable':
      return `link ${failure.index} was re-delegated, but its issuer was never granted "delegate"`
    case 'wrong-audience':
      return `chain ends at ${failure.found}, but this node is ${failure.expected}`
  }
}

export type ChainResult =
  | { readonly ok: true; readonly audience: PublicKeyHex; readonly expiresAt: number }
  | { readonly ok: false; readonly failure: ChainFailure; readonly reason: string }

export interface VerifyOptions {
  /** The owner's key. The chain must start here or it is refused. */
  readonly ownerKey: PublicKeyHex
  readonly ownerId: string
  /** The node checking the chain; the chain must end by delegating to it. */
  readonly audience: PublicKeyHex
  readonly ability: Ability
  /** Injected so verification is deterministic in tests and has no clock port. */
  readonly now: number
}

/**
 * Verify a delegation chain end to end.
 *
 * Checks, in order, that: the chain is non-empty; link 0 is issued by the owner; each
 * link is issued by the previous link's audience; every signature is valid; nothing
 * has expired; every link is scoped to this owner; the requested ability survives to
 * the end; and any link past the first was re-delegated by someone actually granted
 * `delegate`.
 */
export function verifyChain(chain: readonly Delegation[], options: VerifyOptions): ChainResult {
  const fail = (failure: ChainFailure): ChainResult => ({
    ok: false,
    failure,
    reason: describeFailure(failure),
  })

  if (chain.length === 0) return fail({ kind: 'empty-chain' })

  let expectedIssuer = options.ownerKey

  for (let i = 0; i < chain.length; i++) {
    const link = chain[i] as Delegation

    if (link.issuer !== expectedIssuer) {
      return fail(
        i === 0
          ? { kind: 'wrong-root', index: 0, expected: options.ownerKey, found: link.issuer }
          : { kind: 'broken-link', index: i, expected: expectedIssuer, found: link.issuer },
      )
    }

    if (link.ownerId !== options.ownerId) {
      return fail({ kind: 'owner-mismatch', index: i, expected: options.ownerId, found: link.ownerId })
    }

    // Signature before anything derived from the contents is trusted.
    //
    // The payload is built above the `try` — `payloadOf` throws `NotEncodableError`
    // by design, and a link this package cannot encode is not a link whose signature
    // was forged. Inside, that throw read as `bad-signature` against `link.issuer`.
    const payload = payloadOf(link)
    let valid = false
    try {
      valid = ed25519.verify(fromHex(link.signature), payload, fromHex(link.issuer))
    } catch {
      valid = false
    }
    if (!valid) return fail({ kind: 'bad-signature', index: i, issuer: link.issuer })

    if (link.expiresAt <= options.now) {
      return fail({ kind: 'expired', index: i, expiresAt: link.expiresAt, now: options.now })
    }

    if (!link.abilities.includes(options.ability)) {
      return fail({ kind: 'missing-ability', index: i, ability: options.ability })
    }

    // Any link after the first exists because the previous audience re-delegated.
    // That is only legitimate if the previous link granted `delegate`.
    if (i > 0) {
      const previous = chain[i - 1] as Delegation
      if (!previous.abilities.includes('delegate')) {
        return fail({ kind: 'not-delegable', index: i })
      }
    }

    expectedIssuer = link.audience
  }

  if (expectedIssuer !== options.audience) {
    return fail({ kind: 'wrong-audience', expected: options.audience, found: expectedIssuer })
  }

  // The chain is only valid until its earliest expiry.
  const expiresAt = Math.min(...chain.map((link) => link.expiresAt))
  return { ok: true, audience: expectedIssuer, expiresAt }
}
