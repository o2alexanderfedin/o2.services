/**
 * Signed artifact names — DATA-07, DATA-08.
 *
 * Content addressing proves *integrity* and says nothing about *provenance*. A CID
 * guarantees the bytes you fetched are the bytes that were hashed; it cannot tell you
 * those bytes are the module you meant to run. Anyone can publish a CID, and a peer
 * that hands you a different one is not detectably lying unless something independent
 * asserts which CID a name is supposed to resolve to.
 *
 * So the fabric never executes a bare CID. It resolves a *name* through a signed
 * `key → CID` mapping, and accepts the mapping only if it is signed by a key that was
 * pinned in advance. A mapping that is unsigned, signed by an unknown key, expired, or
 * superseded by a higher version is refused.
 *
 * Pure module.
 */

import { ed25519 } from '@noble/curves/ed25519.js'
import { CID } from 'multiformats/cid'
import { NotEncodableError, encodeCanonical } from './canonical/encode.ts'
import type { CanonicalValue } from './canonical/encode.ts'
import { fromHex, toHex } from './capability.ts'
import type { PublicKeyHex } from './capability.ts'

/** A signed assertion that `name` currently resolves to `cid`. */
export interface NameRecord {
  readonly name: string
  readonly cid: CID
  /**
   * Monotonic per name. A resolver keeps the highest it has seen, so a signer cannot
   * roll a name back to an older artifact by replaying a record they once issued.
   */
  readonly version: number
  readonly expiresAt: number
  readonly signer: PublicKeyHex
  readonly signature: string
  /**
   * AOT-02 — the translation this artifact came out of, named by the CID of its key.
   *
   * **What it is for.** {@link cid} vouches for the bytes; this vouches for *why those
   * bytes should be what they are*. `@o2/aot`'s `translationCid` hashes the input digest,
   * the target, the toolchain versions and the required WASM feature set into one CID, so
   * a consumer holding a lift of its own can compare what it produced against what the
   * publisher signed and report a mismatch naming both — which is the second reason
   * `describeKey`'s docblock has always given for existing, and the one nothing had.
   *
   * **A CID and not the key itself, stated as the limit it is.** `TranslationKey` lives in
   * `@o2/aot`, which depends on this package, so carrying the four fields here would either
   * invert that dependency or duplicate the type — and a duplicated identity type is how
   * two spellings of one thing get signed. Comparing the CIDs *is* comparing the keys,
   * because `translationCid` is a pure function of the key. What is genuinely lost is that
   * a mismatch report can render only the side it computed; the publisher's key is named
   * rather than shown. `tools/aot/lift.ts`'s `translation-key-mismatch` says so in its own
   * sentence rather than leaving a reader to infer it.
   *
   * **Optional, and the optionality is load-bearing rather than lazy.** Every record signed
   * before 2026-08-18 — the demo's committed kernel records among them — has no translation
   * behind it at all, and {@link payloadOf} therefore omits the field entirely when it is
   * absent, so those signatures verify against byte-identical payloads. A record that
   * *carries* it signs it: the field is inside the signature, so a translation key cannot be
   * attached to, stripped from, or swapped on a record after the fact.
   */
  readonly translationKeyCid?: CID
}

function payloadOf(record: Omit<NameRecord, 'signature'>): Uint8Array<ArrayBuffer> {
  const value: CanonicalValue = {
    name: record.name,
    cid: record.cid,
    version: record.version,
    expiresAt: record.expiresAt,
    signer: record.signer,
    // Spread rather than written as `translationKeyCid: record.translationKeyCid`, because
    // an explicit `undefined` is not the same as an absent key to a canonical encoder, and
    // the whole point of the optionality is that a record without one hashes exactly as it
    // did before this field existed. `naming.test.ts` holds that as a byte comparison.
    ...(record.translationKeyCid === undefined ? {} : { translationKeyCid: record.translationKeyCid }),
  }
  const encoded = encodeCanonical(value)
  if (!encoded.ok) throw new NotEncodableError('name record', encoded.error)
  return encoded.bytes
}

/** Sign a name → CID mapping. */
export function signName(
  privateKey: Uint8Array,
  fields: Omit<NameRecord, 'signature' | 'signer'>,
): NameRecord {
  const signer = toHex(ed25519.getPublicKey(privateKey))
  const unsigned = { ...fields, signer }
  return { ...unsigned, signature: toHex(ed25519.sign(payloadOf(unsigned), privateKey)) }
}

/**
 * A signed name record as a line of JSON, so a publisher can hand one to an operator.
 *
 * **This exists because the publish path used to stop at the bytes.** `tools/aot/cli.ts` wrote a
 * `.wasm` and printed a summary; nothing turned that into a record, and
 * `guardModuleProvenance` refuses a task whose module arrives as a bare CID — *"a bare CID names
 * bytes, not a publisher"*. So a lifted artifact could not be dispatched to any node that pins a
 * build authority, which is every node that is not explicitly `runs-unsigned-artifacts`. The
 * missing step was a **signed record leaving the process**, and this is its wire form.
 *
 * `CID` is written as its canonical string because JSON has no CID. Everything else is already
 * JSON-safe: `version` and `expiresAt` are numbers, the rest are hex strings.
 *
 * The signature covers the DAG-CBOR payload, never this text — {@link signName} and
 * {@link SignedNameResolver.accept} both hash `payloadOf`, so re-formatting this JSON cannot
 * change whether a record verifies.
 */
export function encodeNameRecord(record: NameRecord): string {
  return JSON.stringify(
    {
      name: record.name,
      cid: record.cid.toString(),
      version: record.version,
      expiresAt: record.expiresAt,
      // Emitted only when present, matching `payloadOf`. A `"translationKeyCid": null` in
      // the file would decode to a record that is not the one that was signed.
      ...(record.translationKeyCid === undefined
        ? {}
        : { translationKeyCid: record.translationKeyCid.toString() }),
      signer: record.signer,
      signature: record.signature,
    },
    null,
    2,
  )
}

/**
 * The inverse, returning `null` rather than throwing on anything malformed.
 *
 * `null` for every rejection, on the same ground `asNodeRecords` in `net/src/protocol.ts` gives:
 * a partially-formed record would hand {@link SignedNameResolver} something to verify that is not
 * a record, and a half-decoded one is worse than none. A caller that wants a reason has the file.
 *
 * **Decoding does not verify.** It says the text is shaped like a record, never that the
 * signature holds — that is {@link SignedNameResolver.accept}'s job, and separating them is what
 * keeps a decoder from becoming a second, weaker verifier.
 */
function isHex(value: unknown, length: number): value is string {
  if (typeof value !== 'string' || value.length !== length) return false
  for (const character of value) {
    const code = character.charCodeAt(0)
    const digit = code >= 0x30 && code <= 0x39
    const lower = code >= 0x61 && code <= 0x66
    if (!digit && !lower) return false
  }
  return true
}

export function decodeNameRecord(text: string): NameRecord | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const value: Record<string, unknown> = { ...parsed }

  const name = value['name']
  const cidText = value['cid']
  const version = value['version']
  const expiresAt = value['expiresAt']
  const signer = value['signer']
  const signature = value['signature']

  if (typeof name !== 'string' || name.length === 0) return null
  if (typeof cidText !== 'string') return null
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 0) return null
  if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt)) return null
  // Checked with a REAL predicate, not with `fromHex`. `fromHex` never rejects — it runs
  // `Number.parseInt` per byte pair and turns anything unparseable into 0 — so
  // `fromHex(x) === null` is a comparison that cannot fail, which is worse than no check at
  // all: it reads like validation and admits everything. Written that way first, and caught
  // by reading `fromHex`'s body rather than its name.
  if (!isHex(signer, 64)) return null
  if (!isHex(signature, 128)) return null

  let cid: CID
  try {
    cid = CID.parse(cidText)
  } catch {
    return null
  }

  // AOT-02. Absent is a record with no translation behind it and decodes fine; *present and
  // unparseable* is a malformed record and is refused, on this function's own stated rule
  // that a half-decoded record is worse than none — dropping an unparseable field would
  // hand the resolver a record whose payload differs from the one that was signed, and the
  // signature check would then report `bad-signature` for a decoding bug.
  const translationText = value['translationKeyCid']
  let translationKeyCid: CID | undefined
  if (translationText !== undefined) {
    if (typeof translationText !== 'string') return null
    try {
      translationKeyCid = CID.parse(translationText)
    } catch {
      return null
    }
  }

  return {
    name,
    cid,
    version,
    expiresAt,
    signer,
    signature,
    ...(translationKeyCid === undefined ? {} : { translationKeyCid }),
  }
}

export type ResolveFailure =
  | { readonly kind: 'unknown-name'; readonly name: string }
  | { readonly kind: 'untrusted-signer'; readonly name: string; readonly signer: PublicKeyHex }
  | { readonly kind: 'bad-signature'; readonly name: string; readonly signer: PublicKeyHex }
  | { readonly kind: 'expired'; readonly name: string; readonly expiresAt: number; readonly now: number }
  | { readonly kind: 'rollback'; readonly name: string; readonly have: number; readonly offered: number }

export function describeResolveFailure(failure: ResolveFailure): string {
  switch (failure.kind) {
    case 'unknown-name':
      return `no signed mapping for "${failure.name}" — a bare CID is not executable`
    case 'untrusted-signer':
      return `"${failure.name}" is signed by ${failure.signer}, which is not a pinned trust anchor`
    case 'bad-signature':
      return `"${failure.name}" has an invalid signature for ${failure.signer}`
    case 'expired':
      return `"${failure.name}" expired at ${failure.expiresAt}, now ${failure.now}`
    case 'rollback':
      return `"${failure.name}" offered version ${failure.offered}, but ${failure.have} is already known`
  }
}

export type ResolveResult =
  | { readonly ok: true; readonly cid: CID }
  | { readonly ok: false; readonly failure: ResolveFailure; readonly reason: string }

/**
 * Resolves names to CIDs, accepting only records signed by pinned keys.
 *
 * The trust anchors are supplied at construction and cannot be added to afterwards.
 * A resolver that could learn a new anchor at runtime would only be as trustworthy as
 * whatever taught it — which is the property this class exists to avoid.
 */
export class SignedNameResolver {
  readonly #anchors: ReadonlySet<PublicKeyHex>
  readonly #records = new Map<string, NameRecord>()

  constructor(trustAnchors: Iterable<PublicKeyHex>) {
    this.#anchors = new Set(trustAnchors)
  }

  get trustAnchors(): readonly PublicKeyHex[] {
    return [...this.#anchors]
  }

  /** Offer a record. Accepted only if it verifies against a pinned anchor. */
  accept(record: NameRecord, now: number): ResolveResult {
    if (!this.#anchors.has(record.signer)) {
      return this.#refuse({ kind: 'untrusted-signer', name: record.name, signer: record.signer })
    }

    // Above the `try` — `payloadOf` throws `NotEncodableError` by design, and a
    // record this package cannot encode is not a record whose signature was forged.
    const payload = payloadOf(record)

    let valid = false
    try {
      valid = ed25519.verify(fromHex(record.signature), payload, fromHex(record.signer))
    } catch {
      valid = false
    }
    if (!valid) {
      return this.#refuse({ kind: 'bad-signature', name: record.name, signer: record.signer })
    }

    if (record.expiresAt <= now) {
      return this.#refuse({
        kind: 'expired',
        name: record.name,
        expiresAt: record.expiresAt,
        now,
      })
    }

    const existing = this.#records.get(record.name)
    if (existing !== undefined && record.version < existing.version) {
      return this.#refuse({
        kind: 'rollback',
        name: record.name,
        have: existing.version,
        offered: record.version,
      })
    }

    this.#records.set(record.name, record)
    return { ok: true, cid: record.cid }
  }

  /** Resolve a name already accepted. Never returns a CID from an unsigned source. */
  resolve(name: string, now: number): ResolveResult {
    const record = this.#records.get(name)
    if (record === undefined) return this.#refuse({ kind: 'unknown-name', name })
    if (record.expiresAt <= now) {
      return this.#refuse({ kind: 'expired', name, expiresAt: record.expiresAt, now })
    }
    return { ok: true, cid: record.cid }
  }

  #refuse(failure: ResolveFailure): ResolveResult {
    return { ok: false, failure, reason: describeResolveFailure(failure) }
  }
}
