/**
 * Sealed secrets — AUTH-06. Thirty-two bytes of key material turned into a
 * self-describing envelope that only a passphrase opens.
 *
 * The envelope records the cost parameters it was sealed under, so raising the defaults
 * later does not brick an identity stored today. That is the whole of criterion 5, and it
 * is why {@link openSecret} derives from the envelope's own `t`/`m`/`p`/`dkLen` and never
 * from {@link DEFAULT_KDF_PARAMS}.
 *
 * ## The KDF is Argon2id from `@noble/hashes`, on BOTH arms — not a preference
 *
 * Carried over verbatim in substance from `cert-lifecycle.ts` as it stood at commit
 * `0c49c42^`, which held this repository's previous Argon2id implementation until an owner
 * ruling deleted it on 2026-08-24:
 *
 * > `crypto.subtle` has no Argon2id, only PBKDF2/HKDF. If the KDF varied by arm, the same
 * > passphrase would derive a DIFFERENT identity depending on which engine ran it,
 * > destroying the exact property `deriveFromPassphrase` exists for.
 *
 * Re-probed on 2026-09-04 before relying on it: `Argon2id`, `Argon2i`, `Argon2d`, `scrypt`
 * and `bcrypt` are all `"Unrecognized algorithm name"` to `crypto.subtle`; only `PBKDF2`
 * and `HKDF` exist. PBKDF2 is not a substitute for this threat, and the reason is not
 * speed — it needs no memory, so it is nearly free to parallelise on a GPU, while Argon2id
 * at {@link DEFAULT_KDF_PARAMS} costs 19 MiB per attempt. Against an imaged disk, where
 * the attacker holds the ciphertext and has unlimited time, that is the difference between
 * days and years.
 *
 * ## The AEAD is `xchacha20poly1305` from `@noble/ciphers`, on BOTH arms
 *
 * Same choice as the KDF and, from `0c49c42^`, the same reason: a value sealed on one tier
 * must open on any other, and *"because there is only ever one AEAD, there is no cross-arm
 * ciphertext to mismatch, by construction — not by a check that could be forgotten."*
 *
 * The deciding reason on top of that one is a constraint no Node-only probe can see, and
 * it is why the AEAD is not `crypto.subtle`'s AES-GCM: see {@link sealWithKey}.
 *
 * ## What this module is not
 *
 * It touches no identity store, holds no state, performs no I/O, and never learns whose
 * secret it is sealing. Pure module except for `crypto.getRandomValues`, the same portable
 * Web-standard global `hash.ts` and `ed25519-backend.ts` already depend on.
 */

import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'
import { type ArgonOpts, argon2idAsync } from '@noble/hashes/argon2.js'
import { fromBase64Url, toBase64Url } from './capability.ts'

const textEncoder = new TextEncoder()

/** The envelope format version. Bumped only by a change that an old reader cannot parse. */
export const SEAL_VERSION = 1

/**
 * Argon2's own version number, `0x13` (19) — the RFC 9106 version, and `@noble/hashes`'
 * default.
 *
 * Recorded in the envelope as `kdfVersion` and passed back to the KDF on open, so the
 * field is load-bearing rather than decorative. Measured 2026-09-04: noble accepts `0x10`
 * and `0x13`, derives a DIFFERENT key for each, and rejects anything else with
 * `'"version" must be 0x10 or 0x13, got 153'`. An envelope sealed by an older Argon2
 * therefore opens here without this module having to guess which version produced it.
 */
export const ARGON2_VERSION = 0x13

/**
 * The salt width. 16 bytes — NIST SP 800-132's minimum, and what `@libp2p/keychain`
 * enforces for its own salt.
 *
 * `@noble/hashes`' argon2 refuses a salt under 8 bytes with `'"salt" must be of length
 * 8..4Gb'` (measured 2026-09-04), so 8 is the floor the primitive imposes and 16 is the
 * floor the standard does. The standard's wins.
 */
export const SALT_BYTES = 16

/**
 * The nonce width. Not a choice: `xchacha20poly1305` rejects any other length with
 * `'"nonce" expected Uint8Array of length 24, got length=12'` (measured 2026-09-04).
 */
export const NONCE_BYTES = 24

/**
 * The cost parameters, as four required fields.
 *
 * Deliberately NOT `ArgonOpts` itself, which is the type `@noble/hashes` exports and which
 * makes `dkLen` optional. An envelope's `dkLen` is never optional — it is a number that
 * was written down at seal time and must be read back at open time — and typing it as
 * `number | undefined` would force either a fallback that silently disagrees with what was
 * sealed, or a non-null assertion this repository forbids. Every value of this type is
 * assignable to `ArgonOpts`, which is what {@link deriveSealKey} passes to the KDF.
 */
export interface SealKdfParams {
  /** Time cost, in iterations. */
  readonly t: number
  /** Memory cost, in kibibytes. */
  readonly m: number
  /** Parallelism. */
  readonly p: number
  /** Derived key length, in bytes. */
  readonly dkLen: number
  /** Argon2's own version. Omitted means {@link ARGON2_VERSION}. */
  readonly version?: number
}

/**
 * `{ t: 2, m: 19_456, p: 1, dkLen: 32 }` — sited, not picked.
 *
 * These are the parameters `0c49c42^:packages/core/src/cert-lifecycle.ts` carried as
 * `ARGON2_PARAMS`, and they are reused here with their basis rather than re-derived. That
 * commit's siting, restated: they are the OWASP Password Storage Cheat Sheet's Argon2id
 * **first recommended option**. The cheat sheet's memory-constrained second option
 * (`m=12288`, `t=3`) was named there and rejected, because *"this fabric's node processes
 * are not memory-constrained the way the cheat sheet's second option targets."*
 *
 * **Three recorded timings of exactly these parameters, and why no code here asserts a
 * millisecond figure:**
 *
 *   374.4 ms — `0c49c42^:cert-lifecycle.ts`, Node v25.9.0, 2026-08-10
 *   436   ms — this host, Node v23.11.0, 2026-09-04
 *   501.5 ms — this host, Node v23.11.0, 2026-09-04, a second probe the same session
 *
 * A 34 % spread across two hosts and one session. Per `CLAUDE.md` § Measurement, cost is
 * asserted comparatively — see the spec's ratio case — never against an absolute bound
 * that would encode one machine.
 *
 * **Raising these is safe by construction.** Every envelope carries its own copy, and
 * {@link openSecret} reads that copy, so changing this constant cannot make an already
 * sealed record unopenable. That is the property criterion 5 names and the spec's
 * `OLD_PARAMS_FIXTURE` case measures.
 */
export const DEFAULT_KDF_PARAMS: SealKdfParams = { t: 2, m: 19_456, p: 1, dkLen: 32 }

/**
 * A sealed 32-byte secret and everything needed to open it except the passphrase.
 *
 * Every field is a JSON primitive on purpose: the record has to survive being written to a
 * JSON file on a Node host **and** being handed to IndexedDB's structured clone in a
 * browser tab, and a `Uint8Array` field survives only the second of those. `salt`, `nonce`
 * and `ciphertext` are therefore base64url (`capability.ts`'s codec, RFC 4648 §5, padding
 * stripped).
 */
export interface SealedSecret {
  /** {@link SEAL_VERSION} at seal time. */
  readonly v: number
  readonly kdf: 'argon2id'
  /** Argon2's own version number — see {@link ARGON2_VERSION}. */
  readonly kdfVersion: number
  readonly t: number
  readonly m: number
  readonly p: number
  readonly dkLen: number
  /** base64url, {@link SALT_BYTES} bytes or more. */
  readonly salt: string
  readonly aead: 'xchacha20poly1305'
  /** base64url, exactly {@link NONCE_BYTES} bytes. */
  readonly nonce: string
  /** base64url: the secret plus a 16-byte Poly1305 tag. */
  readonly ciphertext: string
}

/** A {@link SealedSecret} before its ciphertext exists — what the header is built from. */
export type SealHeader = { readonly [K in Exclude<keyof SealedSecret, 'ciphertext'>]: SealedSecret[K] }

/**
 * The AEAD's additional data: the ten non-ciphertext fields, in a fixed literal order.
 *
 * **Deterministic because the order is written out below, not because an object happens to
 * iterate that way.** Property order on a JSON-parsed object is a property of the parser
 * and the key insertion history; a header built by iterating one would produce different
 * bytes for a record that had made a round trip through a store, and every such record
 * would then fail to open for a reason that looked exactly like a wrong passphrase.
 *
 * ## Why the header is authenticated at all
 *
 * Changing `t`, `m`, `p`, `dkLen`, `salt` or `kdfVersion` already changes the derived key
 * and so already breaks decryption. Authenticating the header makes that a *detected
 * alteration* rather than an accident of key derivation, and keeps every refusal on one
 * path — and it additionally covers `v`, `kdf`, `aead` and `nonce`, which do not feed the
 * KDF at all.
 *
 * ## The instrument that proves this, and the one that cannot
 *
 * The spec's tampered-header case rewrites `m` and watches the refusal. That case **cannot
 * see this function** — the rewritten `m` changes the derived key, so a build passing no
 * additional data to the AEAD would pass it identically. The claim is carried instead by
 * `binds the ciphertext to the header bytes, not merely to the key`, which holds the key
 * and the nonce fixed and varies only the additional data.
 */
export function sealHeaderBytes(header: SealHeader): Uint8Array {
  return textEncoder.encode(
    [
      `v=${header.v}`,
      `kdf=${header.kdf}`,
      `kdfVersion=${header.kdfVersion}`,
      `t=${header.t}`,
      `m=${header.m}`,
      `p=${header.p}`,
      `dkLen=${header.dkLen}`,
      `salt=${header.salt}`,
      `aead=${header.aead}`,
      `nonce=${header.nonce}`,
    ].join('\n'),
  )
}

/**
 * Derive the sealing key from a passphrase and a salt.
 *
 * **Async, slow, and called BEFORE any IndexedDB transaction opens.** That is the whole
 * division of labour between this function and {@link sealWithKey}: the expensive,
 * `Promise`-returning half runs outside the transaction, and only the synchronous half
 * runs inside it.
 *
 * One KDF, on both arms, unconditionally — see this module's docblock for `0c49c42^`'s
 * statement of why that is a correctness requirement rather than a preference.
 */
export async function deriveSealKey(passphrase: string, salt: Uint8Array, params: SealKdfParams): Promise<Uint8Array> {
  const opts: ArgonOpts = {
    t: params.t,
    m: params.m,
    p: params.p,
    dkLen: params.dkLen,
    version: params.version ?? ARGON2_VERSION,
  }
  return await argon2idAsync(textEncoder.encode(passphrase), salt, opts)
}

/**
 * Seal `secret` under an already-derived `key`. **Synchronous, and that is the point.**
 *
 * `IdbIdentityStore.loadOrMintSeed` (`packages/browser/src/idb-identity-store.ts:122-129`)
 * states the constraint in its own doc: *"`mint` **must be synchronous.** Awaiting anything
 * that is not part of an IndexedDB transaction lets that transaction commit."* That is not
 * decorative — it is the fix for a measured cross-tab race in which four tabs of one
 * profile minted four identities and three came back as somebody else
 * (`cold-start-seed-race.e2e.test.ts`). The seal has to happen **inside** that
 * transaction, beside the `put`.
 *
 * `subtle.importKey` and `subtle.encrypt` are both `Promise`-returning and would commit
 * the transaction out from under the write, which is the measured reason this module's
 * AEAD is noble's rather than `crypto.subtle`'s AES-GCM. `xchacha20poly1305(...).encrypt`
 * returns a `Uint8Array` synchronously — measured 2026-09-04: 48 bytes for a 32-byte
 * input, `typeof result.then === 'undefined'`.
 *
 * The nonce comes from `crypto.getRandomValues`, which is present on non-secure origins
 * where `crypto.subtle` is `undefined` — `packages/browser/src/start-probe.ts` records that
 * measurement.
 */
export function sealWithKey(key: Uint8Array, secret: Uint8Array, params: SealKdfParams, salt: Uint8Array): SealedSecret {
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES))
  const header: SealHeader = {
    v: SEAL_VERSION,
    kdf: 'argon2id',
    kdfVersion: params.version ?? ARGON2_VERSION,
    t: params.t,
    m: params.m,
    p: params.p,
    dkLen: params.dkLen,
    salt: toBase64Url(salt),
    aead: 'xchacha20poly1305',
    nonce: toBase64Url(nonce),
  }
  const ciphertext = xchacha20poly1305(key, nonce, sealHeaderBytes(header)).encrypt(secret)
  return { ...header, ciphertext: toBase64Url(ciphertext) }
}

/**
 * Seal `secret` under `passphrase` with a fresh random salt.
 *
 * The convenience path, for a caller with no transaction to hold. A caller that does hold
 * one — the browser tier — calls {@link deriveSealKey} and {@link sealWithKey} separately,
 * so that only the synchronous half runs inside the transaction.
 *
 * **The salt is fresh per envelope, never fixed.** A fixed salt would make two secrets
 * sealed under one passphrase share a key, which is threat T-42-04; the spec's
 * two-seals-differ case is the instrument, and task 3's plant C is the proof it can fail.
 */
export async function sealSecret(
  secret: Uint8Array,
  passphrase: string,
  params: SealKdfParams = DEFAULT_KDF_PARAMS,
): Promise<SealedSecret> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const key = await deriveSealKey(passphrase, salt, params)
  return sealWithKey(key, secret, params, salt)
}

// ─── The boundary ─────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A safe integer at or above `min`, or `null`. Never `NaN`, never a float, never a string. */
function intAtLeast(record: Record<string, unknown>, key: string, min: number): number | null {
  const value = record[key]
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < min) return null
  return value
}

const BASE64URL = /^[A-Za-z0-9_-]+$/

/** A base64url string whose decoded length is in `[min, max]`, or `null`. */
function base64UrlField(record: Record<string, unknown>, key: string, min: number, max: number): string | null {
  const value = record[key]
  if (typeof value !== 'string' || !BASE64URL.test(value)) return null
  // Safe to decode now: `atob` throws on characters outside its alphabet, and the regex
  // above has already excluded them. `parseSealedSecret` must RETURN, never throw.
  const decoded = fromBase64Url(value)
  if (decoded.length < min || decoded.length > max) return null
  return value
}

/**
 * Validate an untrusted value into a {@link SealedSecret}, or return `null`.
 *
 * **A stored envelope is external data** — whether it came off a disk, out of IndexedDB,
 * or off a wire — so it is validated at the boundary, field by field, with a narrowing
 * predicate per field and no type assertion anywhere. Returns `null` rather than throwing,
 * so a caller inspecting a store can ask "is this one of mine?" without an exception.
 *
 * `v` is deliberately **not** checked against {@link SEAL_VERSION} here. A future version
 * is a well-formed record this reader cannot interpret, which is a different fact from a
 * malformed one, and {@link openSecret} reports it as a different error.
 *
 * The `m >= 8 * p` bound is `@noble/hashes`' own documented constraint. Checking it here
 * means an envelope that reaches the KDF cannot make the KDF throw on its cost parameters,
 * so a KDF throw stays what it should be: a bug, not a refusal wearing a refusal's name.
 * No **upper** bound is placed on `m` — threat T-42-05, accepted: the envelope is read from
 * this device's own store, and an attacker who can rewrite that store can replace the
 * identity outright, which is strictly stronger than exhausting its memory.
 */
export function parseSealedSecret(value: unknown): SealedSecret | null {
  if (!isRecord(value)) return null

  const v = intAtLeast(value, 'v', 0)
  if (v === null) return null
  if (value['kdf'] !== 'argon2id') return null
  if (value['aead'] !== 'xchacha20poly1305') return null

  const kdfVersion = intAtLeast(value, 'kdfVersion', 0)
  if (kdfVersion !== 0x10 && kdfVersion !== 0x13) return null

  const t = intAtLeast(value, 't', 1)
  const m = intAtLeast(value, 'm', 8)
  const p = intAtLeast(value, 'p', 1)
  const dkLen = intAtLeast(value, 'dkLen', 4)
  if (t === null || m === null || p === null || dkLen === null) return null
  if (m < 8 * p) return null

  const salt = base64UrlField(value, 'salt', 8, 4096)
  const nonce = base64UrlField(value, 'nonce', NONCE_BYTES, NONCE_BYTES)
  // 16 bytes is the Poly1305 tag alone, so a ciphertext shorter than that cannot carry a
  // secret at all. The upper bound is generous: this module seals key material, not files.
  const ciphertext = base64UrlField(value, 'ciphertext', 16, 65536)
  if (salt === null || nonce === null || ciphertext === null) return null

  return { v, kdf: 'argon2id', kdfVersion, t, m, p, dkLen, salt, aead: 'xchacha20poly1305', nonce, ciphertext }
}

/**
 * Open a sealed record with an already-derived `key`. **Synchronous, and the counterpart of
 * {@link sealWithKey}.**
 *
 * **There is no arm of this function that returns on a failed decrypt**, and that sentence
 * is criterion 4's structural requirement rather than a description: the defect it forbids
 * is a `catch` that returns a plausible-looking zero-filled buffer, which a caller then
 * adopts as a seed. {@link openSecret} delegates here, so the claim is stated once, at the
 * one `catch` that decrypts.
 *
 * ## The caller's obligation, and it is the whole of why this exists
 *
 * This function does **not** check that `key` was derived under the envelope's own cost
 * parameters — it cannot, because a key is 32 bytes and carries no record of how it was
 * made. A caller that passes a key derived under different parameters gets
 * {@link SecretUnlockError}, which is indistinguishable from a wrong passphrase.
 *
 * So a caller must compare the envelope's `salt`, `t`, `m`, `p`, `dkLen` and `kdfVersion`
 * with the ones its key was derived under, and fall back to {@link openSecret} when they
 * differ — never *try this and fall back on failure*, because matching parameters plus a
 * failed open **is** the wrong passphrase, and a fallback derivation would produce the same
 * key and the same refusal several hundred milliseconds later.
 *
 * ## Why it is on the barrel at all
 *
 * `packages/browser/src/idb-identity-store.ts` derives one key per start and uses it for
 * both the seal and the open. Without this, a warm start would derive the key twice —
 * Argon2id measured 436 ms at {@link DEFAULT_KDF_PARAMS} — to reach a value it already had.
 */
export function openWithKey(key: Uint8Array, value: unknown): Uint8Array {
  const envelope = parseSealedSecret(value)
  if (envelope === null) throw new SealedSecretShapeError()
  if (envelope.v !== SEAL_VERSION) throw new SealedSecretVersionError(envelope.v)
  try {
    return xchacha20poly1305(key, fromBase64Url(envelope.nonce), sealHeaderBytes(envelope)).decrypt(
      fromBase64Url(envelope.ciphertext),
    )
  } catch (thrown: unknown) {
    throw new SecretUnlockError(thrown)
  }
}

/**
 * Whether `params` and `salt` are the ones `envelope` was sealed under.
 *
 * The predicate {@link openWithKey}'s caller owes it. Written here rather than at each call
 * site because getting it wrong is silent: a caller that compared five of the six fields
 * would open correctly on every envelope this build writes and refuse an envelope written
 * by a build whose sixth field differed, reporting it as a wrong passphrase.
 */
export function sealedUnderSameKey(envelope: SealedSecret, params: SealKdfParams, salt: Uint8Array): boolean {
  return (
    envelope.t === params.t &&
    envelope.m === params.m &&
    envelope.p === params.p &&
    envelope.dkLen === params.dkLen &&
    envelope.kdfVersion === (params.version ?? ARGON2_VERSION) &&
    envelope.salt === toBase64Url(salt)
  )
}

/**
 * Open a sealed record, or refuse by name. **There is no arm of this function that returns
 * on a failed decrypt.**
 *
 * That last sentence is criterion 4's structural requirement, stated in those words
 * because the defect it forbids is a `catch` that returns a plausible-looking zero-filled
 * buffer, which a caller then adopts as a seed. Task 3's plant A is exactly that mutation,
 * and it is watched red.
 *
 * The key is derived from **the envelope's own parameters**, never from
 * {@link DEFAULT_KDF_PARAMS} — criterion 5. Task 3's plant B substitutes the defaults and
 * is watched red.
 *
 * Three refusals, three names, because a caller that cannot tell them apart cannot tell a
 * typo from a corrupted store:
 *
 * - {@link SealedSecretShapeError} — not a sealed record at all.
 * - {@link SealedSecretVersionError} — a sealed record this reader is too old to open.
 * - {@link SecretUnlockError} — a sealed record that did not open. It does **not** claim to
 *   know whether the passphrase was wrong or the record was altered, because the AEAD
 *   reports the identical `Error("invalid tag")` for both, and `crypto.subtle` reports the
 *   identical `DOMException` for both. Both measured 2026-09-04.
 */
export async function openSecret(value: unknown, passphrase: string): Promise<Uint8Array> {
  const envelope = parseSealedSecret(value)
  if (envelope === null) throw new SealedSecretShapeError()
  if (envelope.v !== SEAL_VERSION) throw new SealedSecretVersionError(envelope.v)

  // From the envelope, not from the defaults. This is criterion 5.
  const key = await deriveSealKey(passphrase, fromBase64Url(envelope.salt), {
    t: envelope.t,
    m: envelope.m,
    p: envelope.p,
    dkLen: envelope.dkLen,
    version: envelope.kdfVersion,
  })

  // One decrypt path, shared with {@link openWithKey}. Two would drift, and the field this
  // module is most exposed to drift in is the additional-data construction — which is the
  // one `sealHeaderBytes`' own doc records an instrument being blind to.
  return openWithKey(key, envelope)
}

// ─── Refusals ────────────────────────────────────────────────────────────────
// Each sets `this.name` to its own class name, in the style of `MalformedSeedFileError`
// (`packages/node/src/identity-store.ts:50-55`), so a caller can branch on the name across
// a bundler boundary where `instanceof` against a duplicated class would not hold.

/**
 * The record did not open. The passphrase is wrong, or the record has been altered.
 *
 * The message names both and commits to neither, because the primitive does not
 * distinguish them: measured 2026-09-04, `xchacha20poly1305(...).decrypt` throws
 * `Error("invalid tag")` for a wrong key AND for altered additional data.
 */
export class SecretUnlockError extends Error {
  constructor(cause: unknown) {
    super(
      'the sealed record did not open — either the passphrase is wrong or the record has been altered; ' +
        'the AEAD reports the same failure for both, so this refusal does not claim to know which',
      { cause },
    )
    this.name = 'SecretUnlockError'
  }
}

/** A well-formed sealed record from a future this reader cannot interpret. */
export class SealedSecretVersionError extends Error {
  constructor(received: number) {
    super(`sealed secret version ${received} is not ${SEAL_VERSION} — refusing to guess at a format this reader does not know`)
    this.name = 'SealedSecretVersionError'
  }
}

/** Not a sealed record. See {@link parseSealedSecret} for what is checked. */
export class SealedSecretShapeError extends Error {
  constructor() {
    super('not a sealed secret — refusing to treat an unvalidated value as an envelope')
    this.name = 'SealedSecretShapeError'
  }
}
