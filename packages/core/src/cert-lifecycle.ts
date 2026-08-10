/**
 * Certificate lifecycle — the four facades, on real crypto.
 *
 * This module replaces `cert-lifecycle.facade.test.ts`, a design probe whose fake
 * "signatures" were strings. Every interface and all 19 flows it proved survive here
 * unchanged in *shape*; what changed is that `Signature`, `Nonce` and the public
 * halves of `PublicIdentity` are now real bytes, produced and checked by real Ed25519
 * and X25519, and certificates are now genuinely signed rather than merely linked by
 * a `parent` reference.
 *
 * ## Backend: `crypto.subtle` primary, `@noble/curves` fallback — libsodium NOT used
 *
 * Owner ruling, 2026-08-10: `@chainsafe/libp2p-noise` already imports
 * `@noble/curves/ed25519.js` — the exact module this file imports — so noble is in
 * the browser bundle before this file is ever loaded, while libsodium-wrappers is
 * 314.9 KB gzip against a 168.93 KB app. noble covers both fallback cases (insecure
 * origin, and engines older than Chrome 137 / Firefox 129 / Safari 17) at ~zero
 * marginal bundle cost.
 *
 * **The port itself no longer lives here.** This module carried its own copy of
 * `CryptoBackend` and its own selection path until Phase 28, Plan 28-01, which merged
 * it into `./ed25519-backend.ts` — the one module in this package that decides which
 * Ed25519 implementation runs. The gate that survived the merge is **this module's**:
 * the real round-trip probe, not the presence-only check the other path used. This
 * file now imports `CryptoBackend` and `createCryptoBackend` and declares neither.
 *
 * The backend is selected once, by `createCryptoBackend`, an **async** factory —
 * never by a synchronous `getX()` that throws if some earlier `initX()` has not yet
 * resolved. The design probe removed that state machine on purpose (see its
 * `IssuerFacade.issue` docblock, ported below onto {@link IssuerFacade.issue}): every
 * facade method already returns a `Promise`, so there is no synchronous call site an
 * uninitialised-backend guard would ever need to protect, and therefore no reason to
 * carry the class of bug `Ed25519NotInitializedError` exists to catch. The merged
 * module keeps that error for its own synchronous port, which the facades do not use.
 *
 * Detection **probes, it does not infer from presence** — the reasoning now sits
 * beside `detectCryptoBackend` in `ed25519-backend.ts`, where the code is. Measured
 * on this host (Node v25.9.0): `subtle` Ed25519 sign+verify succeeds; the noble arm
 * costs roughly 1.3 ms/verify against subtle's ~0.04-0.09 ms across
 * chromium/firefox/webkit (figures from the phase brief, re-measured below in this
 * module's own tests).
 *
 * ## One curve library derives every seed, on both arms
 *
 * WebCrypto's `generateKey` cannot be seeded — there is no way to ask `subtle` for
 * "the Ed25519 keypair whose private scalar is this exact 32 bytes". But
 * {@link SubjectFacade.deriveFromPassphrase} and the "reproduces the same identity
 * after eviction" flow both require exactly that: a deterministic map from entropy to
 * a keypair, byte-identical every time. So `@noble/curves`' pure scalar math
 * (`ed25519.getPublicKey`, `x25519.getPublicKey`) is used **unconditionally, on both
 * arms**, to derive a public key from a seed and — when the subtle arm is selected —
 * to build the JWK `x` field WebCrypto's private-key import requires it to cross-check
 * against `d`. This is not a fallback path; it is the only path, because no such path
 * exists in WebCrypto at all. Verified on this host tonight: a message signed via
 * `subtle` from a JWK built this way and verified via `ed25519.verify` agrees, and the
 * reverse (signed via noble, verified via `subtle.verify`) agrees too.
 *
 * **Correction made against the browser-tier measurement, not assumed:** X25519 is
 * plain scalar multiplication with no randomness anywhere in it, so
 * `agreeX25519` genuinely has exactly one correct output per input pair, confirmed
 * byte-identical noble-vs-subtle in Node and in chromium/firefox/webkit alike. Ed25519
 * signing is a different claim — RFC 8032 defines one canonical deterministic nonce
 * derivation, but does not require every conforming implementation to use exactly it;
 * some harden against fault attacks with a synthetic/hedged nonce instead. Node,
 * chromium and firefox's `subtle` produced signatures byte-identical to noble's in
 * this project's own measurement; **WebKit's did not** — a different, still-valid
 * signature for the same seed and message, verified successfully by both arms. So
 * `signEd25519` across arms is proven here only as "mutually verifiable", never as
 * "byte-identical" — see `cert-lifecycle.test.ts` and `cert-lifecycle.browser.test.ts`
 * for where an earlier, stronger version of that claim was written, measured against
 * webkit, and weakened to what is actually true.
 * `agreeX25519`/`signEd25519`/`verifyEd25519` on {@link CryptoBackend} are the only
 * operations actually dispatched by arm; key derivation from a seed never is.
 *
 * ## The KDF is Argon2id from `@noble/hashes`, on BOTH arms — not a preference
 *
 * `crypto.subtle` has no Argon2id, only PBKDF2/HKDF. If the KDF varied by arm, the
 * same passphrase would derive a DIFFERENT identity depending on which engine ran it,
 * destroying the exact property `deriveFromPassphrase` exists for: a caller who
 * enrols a second device, or recovers after IndexedDB eviction, must get the same
 * keys back regardless of which arm either device happens to run. See
 * {@link ARGON2_PARAMS} for the sited cost parameters.
 *
 * ## AEAD: `xchacha20poly1305`, on BOTH arms — the cross-arm-mismatch question answered
 *
 * `crypto.subtle` has no XChaCha20-Poly1305 and noble has no AES-GCM in the primitive
 * map this phase was handed, and AES-GCM ciphertext is not byte-compatible with
 * XChaCha20-Poly1305 ciphertext. Rather than tag every ciphertext with which algorithm
 * produced it (workable, but it means `open` must branch on untrusted input before it
 * has verified anything), this module uses noble's `xchacha20poly1305` **unconditionally,
 * on both arms** — same choice as the KDF, same reason: a value `seal`ed on one tier
 * must `open` on any other, and a sealed value that outlives the session that sealed
 * it (this fabric hands sealed values to peers) cannot assume the opener picked the
 * same arm. Because there is only ever one AEAD, there is no cross-arm ciphertext to
 * mismatch, by construction — not by a check that could be forgotten. The X25519
 * shared secret is never used directly as the AEAD key: it is passed through
 * HKDF-SHA256 (`AEAD_KEY_INFO`) first, standard practice for a Diffie-Hellman output
 * that is not itself uniformly random.
 *
 * ## Certificates are signed over the kernel's own canonical bytes
 *
 * `certificatePayload` and `csrPopPayload` both go through `encodeCanonical` /
 * `canonicalCid` (`canonical/encode.ts`) — the same codec every other content-addressed
 * or signed record in this package uses (see `capability.ts`'s `payloadOf`). `x509.ts`
 * is not used: Phase 25 shipped it decode-only and deliberately unwired, and this
 * module's certificates are not X.509 — they are this fabric's own signed, canonically
 * encoded records, matching `capability.ts`'s `Delegation` in spirit.
 *
 * ## What was added beyond the probe's literal shape, and why
 *
 * The probe's fake never modelled a certificate signature at all (`Certificate` had no
 * `signature` field), because its "signatures" were unforgeable-by-construction
 * strings. Real certificates can be forged by a malicious or merely-broken directory,
 * so {@link Certificate} carries a real `signature`, {@link ValidationFailure} gained a
 * `bad-signature` case (mirrors `capability.ts`'s `ChainFailure`), and
 * {@link Verifier.validate} verifies every non-root link's signature against its
 * parent's public signing key before trusting anything derived from its contents.
 * {@link IssuerFacade.challenge} nonces are now single-use, tracked and consumed by
 * {@link IssuerFacade.issue} — matching `enrollment.ts`'s "replay gap, and where it was
 * closed" precedent — because a challenge a real signature can be replayed against is
 * not proof of a fresh possession, only proof of a past one.
 *
 * Proof-of-possession is signed over `{challenge, keys}` only, **not** `requested`.
 * This is deliberate, not an omission: {@link IssuerFacade.renew} rewrites `requested`
 * to the prior grant before calling `issue` (hard requirement: renewal cannot widen
 * authority), and a PoP payload that bound `requested` would make every renewal's
 * proof-of-possession fail against the very substitution this facade's contract
 * requires. `requested` needs no signature coverage on its own merits either: the
 * issuer intersects it with its own authority regardless of what a forger might
 * splice in, so tampering with it cannot amplify anything.
 *
 * Pure module except where it must touch `globalThis.crypto` — the same portable
 * Web-standard global `ed25519-backend.ts` and `hash.ts` already depend on.
 */

import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'
import { ed25519, x25519 } from '@noble/curves/ed25519.js'
import { argon2idAsync, type ArgonOpts } from '@noble/hashes/argon2.js'
import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { fromBase64Url, toBase64Url, toHex } from './capability.ts'
import { type CanonicalValue, NotEncodableError, canonicalCid, encodeCanonical } from './canonical/encode.ts'
// The one crypto-backend port. Declared in `ed25519-backend.ts` since Phase 28 merged
// this module's selection path into it; this module holds no selection of its own and
// deliberately does not re-export what it imports here.
import { type CryptoBackend, createCryptoBackend } from './ed25519-backend.ts'

// ─── Byte helpers ──────────────────────────────────────────────────────────────

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

// ─── Vocabulary ──────────────────────────────────────────────────────────────

export type CertRef = string
export type Action = 'execute' | 'read' | 'delegate' | 'relay' | 'issue'
export type Nonce = Uint8Array
export type Signature = Uint8Array

export interface Authority {
  readonly resources: readonly string[]
  readonly actions: readonly Action[]
}
export interface Window {
  readonly notBefore: number
  readonly notAfter: number
}

/**
 * The PUBLIC halves, and only ever the public halves.
 *
 * No facade method returns private material in any form — private material is
 * reachable only through operations ({@link SubjectFacade.sign},
 * {@link SubjectFacade.agree}), never as a value, the same contract WebCrypto enforces
 * with a non-extractable `CryptoKey`.
 */
export interface PublicIdentity {
  readonly signing: Uint8Array
  readonly agreement: Uint8Array
}

/**
 * An opaque reference to a derived shared secret held inside the facade.
 *
 * A key-agreement output is exactly as sensitive as the private key that produced it,
 * so it is not returned either. Callers get a handle and use it through
 * {@link SubjectFacade.seal} / {@link SubjectFacade.open}.
 */
export interface SecretHandle {
  readonly id: string
}

export interface Csr {
  readonly keys: PublicIdentity
  readonly requested: Authority
  /** The issuer's nonce this CSR's proof-of-possession is signed over. Single-use. */
  readonly challenge: Nonce
  readonly proofOfPossession: Signature
}

export interface Certificate {
  readonly ref: CertRef
  readonly subject: PublicIdentity
  readonly parent: CertRef | undefined
  readonly grant: Authority
  readonly window: Window
  /** The issuer's signature over {@link certificatePayload} of this certificate's fields. */
  readonly signature: Signature
}
export type Chain = readonly Certificate[]

export type RevocationReason = 'key-compromise' | 'superseded' | 'ceased-operation'
export interface Revocation {
  readonly subject: CertRef
  readonly reason: RevocationReason
  readonly at: number
}
export type RevocationStatus =
  | { readonly known: true; readonly revoked: false }
  | { readonly known: true; readonly revoked: true; readonly at: number }
  | { readonly known: false; readonly why: 'directory-unreachable' }

export type ValidationFailure =
  | { readonly kind: 'no-chain' }
  | { readonly kind: 'expired'; readonly at: number }
  | { readonly kind: 'revoked'; readonly at: number }
  /** Added beyond the probe: the probe's fake had no signature to forge. See module docblock. */
  | { readonly kind: 'bad-signature'; readonly index: number }
  | { readonly kind: 'not-attenuating'; readonly index: number }
  | { readonly kind: 'subject-mismatch'; readonly presented: string }
  | { readonly kind: 'untrusted-anchor'; readonly root: CertRef }

export type Verdict =
  | { readonly ok: false; readonly reason: ValidationFailure }
  | {
      readonly ok: true
      readonly effective: Authority
      readonly expiresAt: number
      readonly revocation:
        | { readonly checked: true; readonly asOf: number }
        | { readonly checked: false; readonly why: 'directory-unreachable' | 'no-policy' }
    }

export type IssueResult =
  | { readonly ok: true; readonly certificate: Certificate }
  | {
      readonly ok: false
      readonly reason: 'proof-of-possession-failed' | 'unknown-certificate' | 'revoked'
    }

export type DestroyResult =
  | { readonly erased: 'guaranteed' }
  | { readonly erased: 'best-effort'; readonly why: string }

/** Time is a dependency, matching `PeerVerifier`'s injected `#now()` rather than a parameter. */
export interface Clock {
  now(): number
}

// ─── The four facades ────────────────────────────────────────────────────────

export interface SubjectFacade {
  generate(seed: string): Promise<PublicIdentity>
  deriveFromPassphrase(passphrase: string, salt: string): Promise<PublicIdentity>
  requestCertificate(challenge: Nonce, requested: Authority): Promise<Csr>
  sign(message: Uint8Array): Promise<Signature>
  agree(peer: PublicIdentity): Promise<SecretHandle>
  seal(handle: SecretHandle, plaintext: string): Promise<string>
  open(handle: SecretHandle, ciphertext: string): Promise<string | undefined>
  load(): Promise<PublicIdentity | undefined>
  destroy(): Promise<DestroyResult>
}

export interface IssuerFacade {
  /**
   * Async despite needing nothing async today.
   *
   * Every method on these facades returns a `Promise`, on purpose. A synchronous
   * method is a bet that no future implementation will need to reach a vault, a
   * worker, a remote policy engine or `crypto.subtle` — and this repository paid for
   * that bet once already on 2026-08-09, when `verifyChain` was synchronous, `subtle`
   * could not serve it, and unwinding it priced out at ten call sites across four
   * packages. The cost of an unnecessary `await` is a keyword; the cost of a missing
   * one is a migration.
   */
  challenge(): Promise<Nonce>
  /**
   * Issue against a CSR and nothing else.
   *
   * No `parent` — an issuer issues under its own certificate, fixed at construction.
   * No `window` — lifetime is issuer policy; a requester choosing its own expiry is the
   * smell that clipping merely mitigates.
   * No `grant` — the CSR carries what was *requested*; the issuer intersects that with
   * its own authority, so over-granting has no parameter to travel through.
   */
  issue(csr: Csr): Promise<IssueResult>
  /**
   * Extend an existing certificate's window against the same keys.
   *
   * **Takes no `Authority`, and that absence is the whole point.** Renewal is the
   * high-frequency path — session certificates renew constantly — and if it were
   * spelled as `issue`, an issuer could quietly widen authority at renewal time. There
   * is no parameter here to widen with, so amplification-at-renewal is unrepresentable
   * rather than merely untested. A fresh proof-of-possession is still required:
   * renewal re-proves custody.
   */
  renew(existing: CertRef, csr: Csr): Promise<IssueResult>
  revoke(subject: CertRef, reason: RevocationReason): Promise<Revocation>
}

export interface VerifierFacade {
  resolve(leaf: CertRef): Promise<Chain | undefined>
  validate(chain: Chain, presenter: PublicIdentity): Promise<Verdict>
  authorizes(verdict: Verdict, action: Action, resource: string): Promise<boolean>
}

export interface DirectoryPort {
  publish(cert: Certificate): Promise<void>
  fetch(ref: CertRef): Promise<Certificate | undefined>
  publishRevocation(r: Revocation): Promise<void>
  revocationStatus(ref: CertRef): Promise<RevocationStatus>
}

// ─── Pure authority algebra ──────────────────────────────────────────────────

const subset = (child: Authority, parent: Authority): boolean =>
  child.actions.every((a) => parent.actions.includes(a)) && child.resources.every((r) => parent.resources.includes(r))

const intersect = (a: Authority, b: Authority): Authority => ({
  actions: a.actions.filter((x) => b.actions.includes(x)),
  resources: a.resources.filter((x) => b.resources.includes(x)),
})

// ─── Canonical payloads ──────────────────────────────────────────────────────

interface UnsignedCertificate {
  readonly subject: PublicIdentity
  readonly parent: CertRef | undefined
  readonly grant: Authority
  readonly window: Window
}

/** The bytes a certificate's signature covers — everything except `ref` and `signature`. */
function certificatePayload(u: UnsignedCertificate): Uint8Array<ArrayBuffer> {
  const value: CanonicalValue = {
    subject: { signing: u.subject.signing, agreement: u.subject.agreement },
    parent: u.parent ?? null,
    grant: { actions: [...u.grant.actions].sort(), resources: [...u.grant.resources].sort() },
    window: { notBefore: u.window.notBefore, notAfter: u.window.notAfter },
  }
  const encoded = encodeCanonical(value)
  if (!encoded.ok) throw new NotEncodableError('certificate', encoded.error)
  return encoded.bytes
}

/** The bytes a CSR's proof-of-possession covers. Deliberately excludes `requested` — see module docblock. */
function csrPopPayload(fields: { readonly challenge: Nonce; readonly keys: PublicIdentity }): Uint8Array<ArrayBuffer> {
  const value: CanonicalValue = {
    challenge: fields.challenge,
    signing: fields.keys.signing,
    agreement: fields.keys.agreement,
  }
  const encoded = encodeCanonical(value)
  if (!encoded.ok) throw new NotEncodableError('csr-proof-of-possession', encoded.error)
  return encoded.bytes
}

async function refOf(signed: UnsignedCertificate & { readonly signature: Signature }): Promise<CertRef> {
  const value: CanonicalValue = {
    subject: { signing: signed.subject.signing, agreement: signed.subject.agreement },
    parent: signed.parent ?? null,
    grant: { actions: [...signed.grant.actions].sort(), resources: [...signed.grant.resources].sort() },
    window: { notBefore: signed.window.notBefore, notAfter: signed.window.notAfter },
    signature: signed.signature,
  }
  const result = await canonicalCid(value)
  if (!result.ok) throw new NotEncodableError('certificate-ref', result.error)
  return result.cid.toString()
}

/** Sign and content-address one certificate. Shared by {@link Issuer} and test fixtures. */
export async function signCertificate(
  sign: (message: Uint8Array) => Promise<Signature>,
  unsigned: UnsignedCertificate,
): Promise<Certificate> {
  const payload = certificatePayload(unsigned)
  const signature = await sign(payload)
  const ref = await refOf({ ...unsigned, signature })
  return { ...unsigned, signature, ref }
}

// ─── Deterministic key derivation — noble, unconditionally, on both arms ─────

const SIGNING_LABEL = textEncoder.encode('o2/cert-lifecycle/signing')
const AGREEMENT_LABEL = textEncoder.encode('o2/cert-lifecycle/agreement')

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length)
  out.set(a, 0)
  out.set(b, a.length)
  return out
}

/**
 * One 32-byte entropy source fans out into two domain-separated 32-byte scalar
 * seeds — signing and agreement are never the same key (Ed25519 signs, X25519
 * agrees; one key cannot safely do both). Pure and public so tests can independently
 * recompute the expected private material and prove the facade never leaks it,
 * without needing a backdoor into {@link Subject}.
 */
export function deriveKeySeeds(entropy: Uint8Array): { readonly signingSeed: Uint8Array; readonly agreementSeed: Uint8Array } {
  return {
    signingSeed: sha256(concatBytes(entropy, SIGNING_LABEL)),
    agreementSeed: sha256(concatBytes(entropy, AGREEMENT_LABEL)),
  }
}

/**
 * Argon2id cost parameters — sited, not picked, in the style of `capability.ts`'s
 * `MAX_CHAIN_DEPTH` (`capability.ts:101-127`).
 *
 * **Basis:** OWASP Password Storage Cheat Sheet's Argon2id recommendation
 * (`m=19456` KiB / `t=2` / `p=1` as the "first recommended option", memory-constrained
 * variant `m=12288`/`t=3` as the second). This module uses the first: this fabric's
 * node processes are not memory-constrained the way the cheat sheet's second option
 * targets.
 *
 * **Measured, this host, Node v25.9.0, `argon2idAsync`, 2026-08-10:**
 * `t=2, m=19456 KiB (19 MiB), p=1, dkLen=32` → **374.4 ms**. A second run at
 * `dkLen=64` (used only for that measurement, not these params) read 358.3 ms —
 * the two are within run-to-run variance of each other, confirming `dkLen` is not
 * the cost driver here; `m` and `t` are. `deriveFromPassphrase` is on the recovery
 * and multi-device-enrolment paths only (not session renewal, not per-message
 * signing), so ~375 ms is an acceptable interactive cost for those flows on this
 * host, and is expected to be the same order of magnitude on a browser main thread
 * running the identical pure-JS implementation.
 */
export const ARGON2_PARAMS: ArgonOpts = { t: 2, m: 19_456, p: 1, dkLen: 32 }

// ─── Crypto backend ──────────────────────────────────────────────────────────
//
// Declared in `./ed25519-backend.ts` and imported at the top of this file. Until
// Phase 28 this module held its own copy of the port — `CryptoArm`, `CryptoBackend`,
// three JWK helpers, `nobleCryptoBackend`, `subtleCryptoBackend`,
// `createCryptoBackend` and `detectCryptoBackend` — sitting beside a *second*
// selection mechanism in `ed25519-backend.ts`. Plan 28-01 moved this block there and
// kept **this** module's gate, the real `subtle.generateKey({name:'Ed25519'})`
// round-trip probe, over the presence-only check the other module used. Nothing is
// re-exported from here: a second name for the same thing is what the merge removed.

// ─── AEAD: xchacha20poly1305, unconditionally, on both arms ──────────────────

const AEAD_KEY_INFO = textEncoder.encode('o2/cert-lifecycle/seal-key')
const XCHACHA_NONCE_BYTES = 24

function symmetricKeyFromSharedSecret(shared: Uint8Array): Uint8Array {
  return hkdf(sha256, shared, undefined, AEAD_KEY_INFO, 32)
}

// ─── SubjectFacade ─────────────────────────────────────────────────────────

export class Subject implements SubjectFacade {
  #signingSeed: Uint8Array | undefined
  #agreementSeed: Uint8Array | undefined
  readonly #secrets = new Map<string, Uint8Array>()
  #handles = 0

  constructor(
    private readonly backend: CryptoBackend,
    private readonly vaultBacked: boolean,
  ) {}

  async generate(seed: string): Promise<PublicIdentity> {
    const entropy = sha256(textEncoder.encode(seed))
    return this.#adopt(deriveKeySeeds(entropy))
  }

  /** Deterministic: the same passphrase and salt reproduce the same identity. */
  async deriveFromPassphrase(passphrase: string, salt: string): Promise<PublicIdentity> {
    const entropy = await argon2idAsync(textEncoder.encode(passphrase), textEncoder.encode(salt), ARGON2_PARAMS)
    return this.#adopt(deriveKeySeeds(entropy))
  }

  async requestCertificate(challenge: Nonce, requested: Authority): Promise<Csr> {
    const keys = this.#requirePublic()
    const payload = csrPopPayload({ challenge, keys })
    const proofOfPossession = await this.backend.signEd25519(this.#requireSigningSeed(), payload)
    return { keys, requested, challenge, proofOfPossession }
  }

  async sign(message: Uint8Array): Promise<Signature> {
    return this.backend.signEd25519(this.#requireSigningSeed(), message)
  }

  /** Returns a HANDLE. The derived key stays in `#secrets` and is never a return value. */
  async agree(peer: PublicIdentity): Promise<SecretHandle> {
    const seed = this.#requireAgreementSeed()
    const shared = await this.backend.agreeX25519(seed, peer.agreement)
    const key = symmetricKeyFromSharedSecret(shared)
    shared.fill(0)
    this.#handles += 1
    const id = `handle-${this.#handles.toString()}`
    this.#secrets.set(id, key)
    return { id }
  }

  async seal(handle: SecretHandle, plaintext: string): Promise<string> {
    const key = this.#secrets.get(handle.id)
    if (key === undefined) throw new Error('unknown handle')
    const nonce = new Uint8Array(XCHACHA_NONCE_BYTES)
    globalThis.crypto.getRandomValues(nonce)
    const ciphertext = xchacha20poly1305(key, nonce).encrypt(textEncoder.encode(plaintext))
    const blob = new Uint8Array(nonce.length + ciphertext.length)
    blob.set(nonce, 0)
    blob.set(ciphertext, nonce.length)
    return toBase64Url(blob)
  }

  async open(handle: SecretHandle, ciphertext: string): Promise<string | undefined> {
    const key = this.#secrets.get(handle.id)
    if (key === undefined) return undefined
    try {
      const blob = fromBase64Url(ciphertext)
      const nonce = blob.slice(0, XCHACHA_NONCE_BYTES)
      const sealed = blob.slice(XCHACHA_NONCE_BYTES)
      const plaintext = xchacha20poly1305(key, nonce).decrypt(sealed)
      return textDecoder.decode(plaintext)
    } catch {
      // Auth-tag failure, truncated blob, or a value sealed under a different key —
      // all read as "cannot open", never as a throw.
      return undefined
    }
  }

  async load(): Promise<PublicIdentity | undefined> {
    return this.#signingSeed === undefined ? undefined : this.#requirePublic()
  }

  /** Simulates IndexedDB eviction. Not part of {@link SubjectFacade} — a browser tab does not call this on itself. */
  evict(): void {
    this.#signingSeed?.fill(0)
    this.#agreementSeed?.fill(0)
    this.#signingSeed = undefined
    this.#agreementSeed = undefined
  }

  async destroy(): Promise<DestroyResult> {
    this.evict()
    for (const key of this.#secrets.values()) key.fill(0)
    this.#secrets.clear()
    return this.vaultBacked
      ? { erased: 'guaranteed' }
      : { erased: 'best-effort', why: 'JS heap; GC gives no scrub guarantee' }
  }

  #adopt(seeds: { readonly signingSeed: Uint8Array; readonly agreementSeed: Uint8Array }): PublicIdentity {
    this.#signingSeed = seeds.signingSeed
    this.#agreementSeed = seeds.agreementSeed
    return this.#requirePublic()
  }

  #requirePublic(): PublicIdentity {
    return { signing: ed25519.getPublicKey(this.#requireSigningSeed()), agreement: x25519.getPublicKey(this.#requireAgreementSeed()) }
  }
  #requireSigningSeed(): Uint8Array {
    if (this.#signingSeed === undefined) throw new Error('no keys')
    return this.#signingSeed
  }
  #requireAgreementSeed(): Uint8Array {
    if (this.#agreementSeed === undefined) throw new Error('no keys')
    return this.#agreementSeed
  }
}

// ─── IssuerFacade ────────────────────────────────────────────────────────────

/** Everything fixed for this issuer's lifetime is a constructor dependency. */
export interface IssuerPolicy {
  readonly lifetimeMs: number
}

export class Issuer implements IssuerFacade {
  readonly #outstanding = new Set<string>()

  constructor(
    private readonly dir: DirectoryPort,
    private readonly clock: Clock,
    private readonly own: Certificate,
    private readonly policy: IssuerPolicy,
    /** The issuer's own signing capability — reused, never a second keypair. */
    private readonly signer: Pick<SubjectFacade, 'sign'>,
    private readonly backend: CryptoBackend,
  ) {}

  async challenge(): Promise<Nonce> {
    const nonce = new Uint8Array(24)
    globalThis.crypto.getRandomValues(nonce)
    this.#outstanding.add(toHex(nonce))
    return nonce
  }

  async issue(csr: Csr): Promise<IssueResult> {
    const nonceKey = toHex(csr.challenge)
    if (!this.#outstanding.has(nonceKey)) {
      // Unknown or already-consumed challenge — replayed or forged either way.
      return { ok: false, reason: 'proof-of-possession-failed' }
    }
    const payload = csrPopPayload({ challenge: csr.challenge, keys: csr.keys })
    const valid = await this.backend.verifyEd25519(csr.keys.signing, csr.proofOfPossession, payload)
    if (!valid) return { ok: false, reason: 'proof-of-possession-failed' }
    this.#outstanding.delete(nonceKey)

    // The caller cannot over-grant: what it asked for is intersected with what this
    // issuer holds. `would-amplify` is gone as a failure mode because it is now
    // unreachable.
    const grant = intersect(csr.requested, this.own.grant)
    const now = this.clock.now()
    const window: Window = {
      notBefore: Math.max(now, this.own.window.notBefore),
      notAfter: Math.min(now + this.policy.lifetimeMs, this.own.window.notAfter),
    }
    const certificate = await signCertificate((message) => this.signer.sign(message), {
      subject: csr.keys,
      parent: this.own.ref,
      grant,
      window,
    })
    await this.dir.publish(certificate)
    return { ok: true, certificate }
  }

  async renew(existing: CertRef, csr: Csr): Promise<IssueResult> {
    const prior = await this.dir.fetch(existing)
    if (prior === undefined) return { ok: false, reason: 'unknown-certificate' }
    if (!bytesEqual(prior.subject.signing, csr.keys.signing)) return { ok: false, reason: 'proof-of-possession-failed' }
    const status = await this.dir.revocationStatus(existing)
    if (status.known && status.revoked) return { ok: false, reason: 'revoked' }
    // Carry the PRIOR grant, never the CSR's request — renewal cannot widen. The PoP
    // signature does not cover `requested` (see module docblock), so this
    // substitution does not invalidate it.
    return this.issue({ ...csr, requested: prior.grant })
  }

  async revoke(subject: CertRef, reason: RevocationReason): Promise<Revocation> {
    const r: Revocation = { subject, reason, at: this.clock.now() }
    await this.dir.publishRevocation(r)
    return r
  }
}

// ─── VerifierFacade ──────────────────────────────────────────────────────────

export class Verifier implements VerifierFacade {
  constructor(
    private readonly dir: DirectoryPort,
    private readonly clock: Clock,
    /** The trust anchors. The most non-dynamic thing in the system — and it was MISSING. */
    private readonly anchors: ReadonlySet<CertRef>,
    private readonly backend: CryptoBackend,
  ) {}

  async resolve(leaf: CertRef): Promise<Chain | undefined> {
    const out: Certificate[] = []
    let ref: CertRef | undefined = leaf
    while (ref !== undefined) {
      const c: Certificate | undefined = await this.dir.fetch(ref)
      if (c === undefined) return out.length === 0 ? undefined : out
      out.push(c)
      ref = c.parent
    }
    return out
  }

  async validate(chain: Chain, presenter: PublicIdentity): Promise<Verdict> {
    const now = this.clock.now()
    const leaf = chain[0]
    if (leaf === undefined) return { ok: false, reason: { kind: 'no-chain' } }
    if (!bytesEqual(leaf.subject.signing, presenter.signing)) {
      return { ok: false, reason: { kind: 'subject-mismatch', presented: toHex(presenter.signing) } }
    }
    const root = chain[chain.length - 1]
    if (root === undefined || !this.anchors.has(root.ref)) {
      return { ok: false, reason: { kind: 'untrusted-anchor', root: root?.ref ?? '' } }
    }

    let effective = leaf.grant
    let expiresAt = leaf.window.notAfter
    for (const [i, cert] of chain.entries()) {
      if (now > cert.window.notAfter) return { ok: false, reason: { kind: 'expired', at: cert.window.notAfter } }

      const issuerCert = chain[i + 1]
      if (issuerCert !== undefined) {
        // Every non-root link must carry a signature its parent's public signing key
        // actually produced. Checked before attenuation: a forged link's `grant`
        // is not a claim worth reasoning about at all.
        const payload = certificatePayload({ subject: cert.subject, parent: cert.parent, grant: cert.grant, window: cert.window })
        const validSignature = await this.backend.verifyEd25519(issuerCert.subject.signing, cert.signature, payload)
        if (!validSignature) return { ok: false, reason: { kind: 'bad-signature', index: i } }
        if (!subset(cert.grant, issuerCert.grant)) return { ok: false, reason: { kind: 'not-attenuating', index: i } }
      }

      effective = intersect(effective, cert.grant)
      expiresAt = Math.min(expiresAt, cert.window.notAfter)
    }

    const status = await this.dir.revocationStatus(leaf.ref)
    if (status.known && status.revoked) return { ok: false, reason: { kind: 'revoked', at: status.at } }
    return {
      ok: true,
      effective,
      expiresAt,
      revocation: status.known ? { checked: true, asOf: now } : { checked: false, why: status.why },
    }
  }

  async authorizes(verdict: Verdict, action: Action, resource: string): Promise<boolean> {
    return verdict.ok && verdict.effective.actions.includes(action) && verdict.effective.resources.includes(resource)
  }
}

// ─── DirectoryPort ───────────────────────────────────────────────────────────

export class Directory implements DirectoryPort {
  readonly #certs = new Map<CertRef, Certificate>()
  readonly #revoked = new Map<CertRef, Revocation>()
  reachable = true

  async publish(cert: Certificate): Promise<void> {
    this.#certs.set(cert.ref, cert)
  }
  async fetch(ref: CertRef): Promise<Certificate | undefined> {
    return this.#certs.get(ref)
  }
  async publishRevocation(r: Revocation): Promise<void> {
    this.#revoked.set(r.subject, r)
  }
  async revocationStatus(ref: CertRef): Promise<RevocationStatus> {
    if (!this.reachable) return { known: false, why: 'directory-unreachable' }
    const r = this.#revoked.get(ref)
    return r === undefined ? { known: true, revoked: false } : { known: true, revoked: true, at: r.at }
  }
}

// ─── Async factories — the backend is selected once, per module docblock ────

export async function createSubject(vaultBacked: boolean): Promise<Subject> {
  const backend = await createCryptoBackend()
  return new Subject(backend, vaultBacked)
}

export async function createIssuer(options: {
  readonly dir: DirectoryPort
  readonly clock: Clock
  readonly own: Certificate
  readonly policy: IssuerPolicy
  readonly signer: Pick<SubjectFacade, 'sign'>
}): Promise<Issuer> {
  const backend = await createCryptoBackend()
  return new Issuer(options.dir, options.clock, options.own, options.policy, options.signer, backend)
}

export async function createVerifier(options: {
  readonly dir: DirectoryPort
  readonly clock: Clock
  readonly anchors: ReadonlySet<CertRef>
}): Promise<Verifier> {
  const backend = await createCryptoBackend()
  return new Verifier(options.dir, options.clock, options.anchors, backend)
}
