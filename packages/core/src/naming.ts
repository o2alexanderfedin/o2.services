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
import { encodeCanonical } from './canonical/encode.ts'
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
}

function payloadOf(record: Omit<NameRecord, 'signature'>): Uint8Array<ArrayBuffer> {
  const value: CanonicalValue = {
    name: record.name,
    cid: record.cid,
    version: record.version,
    expiresAt: record.expiresAt,
    signer: record.signer,
  }
  const encoded = encodeCanonical(value)
  if (!encoded.ok) throw new Error(`name record not encodable: ${JSON.stringify(encoded.error)}`)
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

    let valid = false
    try {
      valid = ed25519.verify(fromHex(record.signature), payloadOf(record), fromHex(record.signer))
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
