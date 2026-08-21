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

/**
 * base64url, the RFC 4648 §5 alphabet with padding stripped — the encoding JWK fields
 * and sealed blobs both use.
 *
 * Declared here rather than in either consumer because Phase 28 needed it in two
 * modules at once: `ed25519-backend.ts`'s JWK builders (the subtle arm's only way to
 * import a seeded private key) and `cert-lifecycle.ts`'s sealed-blob encoding. It was
 * `cert-lifecycle.ts`-private until then, and importing it back from there would have
 * closed a cycle — `cert-lifecycle.ts` now imports `ed25519-backend.ts`. This module
 * already holds `toHex`/`fromHex`, so it is where the package keeps byte codecs; it is
 * deliberately **not** added to `index.ts`, so no barrel export is created by the move.
 *
 * `btoa`/`atob` are Web-standard globals present in Node and in every browser target,
 * the same portability class as the `globalThis.crypto` this package already depends on.
 */
export function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  const binary = atob(padded)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out as Uint8Array<ArrayBuffer>
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

/**
 * The signing capability {@link delegateWith} needs, as a port rather than as bytes.
 *
 * **Structurally identical to `enrollment.ts`'s `UserSigner`, and deliberately not an
 * import of it.** `enrollment.ts` imports *this* module (`fromHex`, `toHex`,
 * `PublicKeyHex`), so importing back would close a cycle. Declaring the shape here — in the
 * lower layer, where the signing actually happens — means a `UserSigner` satisfies it
 * structurally at every call site with no adapter and no cast, and it means this module
 * still has exactly three imports. If the two ever need to diverge, that is a signal the
 * port was wrong rather than a reason to add the import.
 */
export interface DelegationSigner {
  /** The public half, hex. Becomes the delegation's `issuer`, and is checked against it. */
  readonly userKey: PublicKeyHex
  /** Sign one payload. Async because `crypto.subtle.sign` is, and nothing awaits it synchronously. */
  sign(message: Uint8Array): Promise<Uint8Array>
}

/**
 * Thrown when a {@link DelegationSigner} names a `userKey` it cannot actually sign for.
 *
 * The same guard `UserKeyMismatchError` performs for enrolment, for the same reason and at
 * the same seam. When the issuer is *derived* from bytes, naming somebody else's key is not
 * something the function can be asked to do; once the caller supplies its own public half,
 * that impossibility becomes a **check** — and the check is what catches a `CryptoKeyPair`
 * mix-up, which derivation never could.
 *
 * **This is not a formality here.** A delegation whose `issuer` does not match the key that
 * signed it fails verification as `bad-signature` at the serving node — a refusal that names
 * the wrong cause and sends a reader hunting for a corrupted chain rather than a mispaired
 * signer. Failing at mint time names it correctly and costs one verify.
 */
export class DelegationSignerMismatchError extends Error {
  readonly code = 'delegation-signer-mismatch' as const
  readonly userKey: PublicKeyHex
  constructor(userKey: PublicKeyHex) {
    super(
      `the signer for ${userKey} produced a signature that key does not verify, so any chain ` +
        'rooted at it would be refused as bad-signature by the node it was sent to',
    )
    this.name = 'DelegationSignerMismatchError'
    this.userKey = userKey
  }
}

/**
 * Issue and sign one delegation **through a signer**, for an issuer whose key material the
 * caller does not hold.
 *
 * ## Why this exists at all, and why it is not a refactor of {@link delegate}
 *
 * A browser tab's owner key is minted `extractable: false`, so `exportKey` on the private
 * half is refused in chromium, firefox and webkit — measured, and that refusal *is* the
 * property being bought: the origin that served the page cannot read the key. There are
 * therefore no bytes to hand {@link delegate}, and there never will be. This is the identical
 * shape `requestEnrollment` took when it grew a `UserSigner`, and for the identical reason.
 *
 * {@link delegate} is untouched and is **not** a legacy path: a backbone node's owner key
 * comes from a file, must survive a restart, and must be movable between machines by the
 * person who owns it. Two arms because there are genuinely two situations.
 *
 * ## Asynchronous, which the consumer has to arrange around rather than await
 *
 * `CapabilitySupplier` is `(task) => readonly Delegation[]` — synchronous, because it is
 * called on the dispatch path. So a browser caller **cannot** sign on demand inside a
 * supplier and must mint ahead of dispatch and serve from what it minted. That is a
 * constraint on the caller, stated here because it is the first thing that bites and it is
 * not visible from this signature.
 *
 * ## The verify is on the success path on purpose
 *
 * `enrollment.ts` records why its *seed* arm skips verification — derivation and verification
 * are alternatives, not a stack, and paying for both halved a measured DoS ratio for no
 * security gain. That reasoning does not transfer: here the public half is **supplied**, so
 * the check can fail for a caller reason rather than only if `sign` and `verify` disagree
 * with each other. One verify per delegation, minted once per node per job, is not on a hot
 * path.
 */
export async function delegateWith(
  signer: DelegationSigner,
  fields: Omit<Delegation, 'signature' | 'issuer'>,
): Promise<Delegation> {
  const unsigned = { ...fields, issuer: signer.userKey }
  const payload = payloadOf(unsigned)
  const signature = await signer.sign(payload)
  // A mispaired signer is the one failure this cannot detect later in any useful form —
  // see `DelegationSignerMismatchError`. Anything `fromHex`/`verify` throws on is the same
  // finding and is reported as that finding rather than as an exception from a crypto call.
  let ok = false
  try {
    ok = ed25519.verify(signature, payload, fromHex(signer.userKey))
  } catch {
    ok = false
  }
  if (!ok) throw new DelegationSignerMismatchError(signer.userKey)
  return { ...unsigned, signature: toHex(signature) }
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
  | { readonly kind: 'too-deep'; readonly depth: number; readonly limit: number }

/**
 * The most links a chain may carry. Its length comes off the wire, so it is an input.
 *
 * **Sited, not picked.** The deepest chain anywhere in this repository is **two** —
 * owner → coordinator → worker, in `capability.test.ts`. Production builds **one**:
 * `bin/bench.ts` delegates owner → node. Eight is 4× the deepest the tree has ever
 * constructed. If a real topology needs more, move the constant and update this comment;
 * discovering the bound because an attacker found it first is the alternative.
 *
 * **Two separate things needed this**, and the second is the one that bites:
 *
 * 1. The loop is unbounded. That alone is mild — it fails fast at the first link whose
 *    issuer does not match, so an attacker cannot spend a verifier's CPU beyond the valid
 *    prefix they actually hold.
 * 2. `expiresAt` was folded with `Math.min(...chain.map(…))`, and **spreading a
 *    wire-length array into a call blows the argument stack**. Measured on this host:
 *    100 000 elements fine, **200 000 raises `RangeError: Maximum call stack size
 *    exceeded`**. That is a *throw* on the **success** path of a security check, where
 *    whatever the caller's `catch` does becomes part of the trust decision. Reaching it
 *    needed a fully valid chain, so it was privilege abuse rather than a remote crash —
 *    narrow, not absent.
 *
 * The fold below is now a `reduce`, so **neither control depends on the other**. The depth
 * bound already makes the spread unreachable; leaving a landmine armed behind a guard is
 * how the next person who raises the constant gets hurt.
 */
export const MAX_CHAIN_DEPTH = 8

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
    case 'too-deep':
      return `chain carries ${failure.depth} links, more than the ${failure.limit} allowed`
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

  // Before any signature work: the length is attacker-supplied, and this is the cheapest
  // possible refusal. See MAX_CHAIN_DEPTH for why the bound exists and how it was sited.
  if (chain.length > MAX_CHAIN_DEPTH) {
    return fail({ kind: 'too-deep', depth: chain.length, limit: MAX_CHAIN_DEPTH })
  }

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
  //
  // `reduce`, not `Math.min(...chain.map(…))`. The spread put a wire-length array into a
  // call's argument list, which raises `RangeError: Maximum call stack size exceeded` past
  // ~200 000 elements — a throw on this function's SUCCESS path. MAX_CHAIN_DEPTH now makes
  // that unreachable; this makes it impossible, so the two controls are independent.
  const expiresAt = chain.reduce((earliest, link) => Math.min(earliest, link.expiresAt), Infinity)
  return { ok: true, audience: expectedIssuer, expiresAt }
}
