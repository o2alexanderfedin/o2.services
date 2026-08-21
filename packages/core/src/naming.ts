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

/**
 * A signed statement that {@link NameDelegation.root} authorises {@link NameDelegation.delegate}
 * to sign name records on its behalf — task #4, half 2.
 *
 * **Not `capability.ts`'s `Delegation`, and the name says so rather than leaving it to be
 * discovered.** That one is an ability chain: it delegates *what a holder may ask the fabric
 * to do*, is verified by `verifyChain`, and can be many links long. This one delegates *who
 * may sign a name record*, is verified inside {@link SignedNameResolver.accept}, and is
 * exactly one link. They share a word and nothing else — no field, no payload, no verifier —
 * and a reader who assumes otherwise will look for an ability in a record that has none.
 *
 * ## Why this exists at all
 *
 * {@link SignedNameResolver} pins anchors at construction and cannot learn one afterwards,
 * which is the property that makes it worth trusting. The cost of that property is that the
 * key which signs records must BE a pinned anchor — so it has to be online at every publish,
 * and rotating it means re-pinning every consumer. A root that can stay offline is the whole
 * point of the exercise: the root signs one short statement naming a signing key, the signing
 * key signs the artifacts, and the root's private half never touches the publishing machine.
 *
 * ## What is delegated, and what is not
 *
 * Exactly one thing: permission to sign {@link NameRecord}s until {@link NameDelegation.expiresAt}.
 * A delegate cannot re-delegate — there is no chain of length three, deliberately, because
 * every additional link is another expiry to reason about and the offline-root property is
 * already bought at length two. `accept` never consults a delegation's delegate as a root.
 *
 * ## Revocation is expiry, stated as a decision rather than left as a gap
 *
 * There is no revocation list, and adding one would be the wrong shape here. A revocation
 * list has to REACH a verifier to mean anything, and the fabric's verifiers are browser tabs
 * that may be offline and hold no channel to the root. So the bound is time: a delegation is
 * short-lived, and {@link SignedNameResolver.accept} additionally refuses any record that
 * would outlive the delegation that authorised it, so a stolen signing key cannot mint
 * anything that survives its own delegation's expiry. Withdrawing authority means declining
 * to issue the next delegation, and the blast radius is bounded by the current one's clock.
 */
export interface NameDelegation {
  /** The pinned anchor. Its private half is the one that stays offline. */
  readonly root: PublicKeyHex
  /** The key permitted to sign records. `NameRecord.signer` must equal this. */
  readonly delegate: PublicKeyHex
  /** When the permission lapses. Also the ceiling on any record signed under it. */
  readonly expiresAt: number
  /** Over {@link delegationPayloadOf}, by {@link root}. */
  readonly signature: string
}

/**
 * The bytes a delegation's signature covers.
 *
 * Separate from {@link payloadOf} and deliberately NOT a subset of it: a delegation must not
 * be verifiable as a name record, nor a record as a delegation, or one signature could be
 * replayed as the other. The two payloads share no field ordering and no key set.
 */
function delegationPayloadOf(delegation: Omit<NameDelegation, 'signature'>): Uint8Array<ArrayBuffer> {
  const value: CanonicalValue = {
    root: delegation.root,
    delegate: delegation.delegate,
    expiresAt: delegation.expiresAt,
  }
  const encoded = encodeCanonical(value)
  if (!encoded.ok) throw new NotEncodableError('delegation', encoded.error)
  return encoded.bytes
}

/** Sign a delegation with the root's private half. */
export function signNameDelegation(
  rootPrivateKey: Uint8Array,
  fields: Omit<NameDelegation, 'signature' | 'root'>,
): NameDelegation {
  const root = toHex(ed25519.getPublicKey(rootPrivateKey))
  const unsigned = { root, delegate: fields.delegate, expiresAt: fields.expiresAt }
  return {
    ...unsigned,
    signature: toHex(ed25519.sign(delegationPayloadOf(unsigned), rootPrivateKey)),
  }
}

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
  /**
   * The authority under which {@link signer} signed, when {@link signer} is not itself a
   * pinned anchor — task #4, half 2.
   *
   * **Inside the signature, for the same reason `translationKeyCid` is.** The delegate signs
   * its own warrant, so a delegation cannot be attached to a record that was signed without
   * one, stripped from a record that carries one, or swapped for a different delegation with
   * a longer clock. All three of those are forgeries a field outside the payload would allow.
   *
   * **Optional, and the optionality is what keeps existing records verifying.** Every record
   * signed before this field existed omits it, {@link payloadOf} omits it from the encoded
   * value when absent, and those signatures therefore verify against byte-identical payloads.
   * A record whose signer IS an anchor needs no delegation and should carry none.
   */
  readonly delegation?: NameDelegation
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
    // Same spread-omit discipline as `translationKeyCid` above, and for the same measured
    // reason: a record without a delegation must hash exactly as it did before delegations
    // existed. Written out field by field rather than passed through, so that adding a field
    // to `NameDelegation` later cannot silently change what an existing record's signature covers.
    ...(record.delegation === undefined
      ? {}
      : {
          delegation: {
            root: record.delegation.root,
            delegate: record.delegation.delegate,
            expiresAt: record.delegation.expiresAt,
            signature: record.delegation.signature,
          },
        }),
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
      // Emitted only when present, matching `payloadOf`. Written field by field for the same
      // reason `payloadOf` is: the wire form and the signed form must name the same four
      // fields, and a spread of the object would let a future field reach the file without
      // reaching the payload — a record that decodes to something that was never signed.
      ...(record.delegation === undefined
        ? {}
        : {
            delegation: {
              root: record.delegation.root,
              delegate: record.delegation.delegate,
              expiresAt: record.delegation.expiresAt,
              signature: record.delegation.signature,
            },
          }),
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

  // Task #4 half 2, on exactly the rule the translation field above states: absent is a
  // record whose signer must itself be an anchor and decodes fine; PRESENT AND MALFORMED is
  // refused rather than dropped, because dropping it would hand the resolver a record whose
  // payload differs from the one that was signed and the failure would surface as
  // `bad-signature` — a decoding bug wearing a forgery's name.
  const delegationValue = value['delegation']
  let delegation: NameDelegation | undefined
  if (delegationValue !== undefined) {
    if (typeof delegationValue !== 'object' || delegationValue === null) return null
    const fields: Record<string, unknown> = { ...delegationValue }
    const root = fields['root']
    const delegate = fields['delegate']
    const delegationExpiresAt = fields['expiresAt']
    const delegationSignature = fields['signature']
    if (!isHex(root, 64)) return null
    if (!isHex(delegate, 64)) return null
    if (typeof delegationExpiresAt !== 'number' || !Number.isFinite(delegationExpiresAt)) {
      return null
    }
    if (!isHex(delegationSignature, 128)) return null
    delegation = { root, delegate, expiresAt: delegationExpiresAt, signature: delegationSignature }
  }

  return {
    name,
    cid,
    version,
    expiresAt,
    signer,
    signature,
    ...(translationKeyCid === undefined ? {} : { translationKeyCid }),
    ...(delegation === undefined ? {} : { delegation }),
  }
}

export type ResolveFailure =
  | { readonly kind: 'unknown-name'; readonly name: string }
  | { readonly kind: 'untrusted-signer'; readonly name: string; readonly signer: PublicKeyHex }
  | { readonly kind: 'bad-signature'; readonly name: string; readonly signer: PublicKeyHex }
  | { readonly kind: 'expired'; readonly name: string; readonly expiresAt: number; readonly now: number }
  | { readonly kind: 'rollback'; readonly name: string; readonly have: number; readonly offered: number }
  // ---- delegated signing, task #4 half 2. Four distinct kinds rather than folding them
  // into `untrusted-signer`, because they fail for four different reasons and an operator
  // reading `untrusted-signer` for an EXPIRED delegation would go looking for the wrong bug.
  | {
      readonly kind: 'untrusted-root'
      readonly name: string
      readonly root: PublicKeyHex
    }
  | {
      readonly kind: 'delegation-mismatch'
      readonly name: string
      readonly signer: PublicKeyHex
      readonly delegate: PublicKeyHex
    }
  | {
      readonly kind: 'bad-delegation-signature'
      readonly name: string
      readonly root: PublicKeyHex
      readonly delegate: PublicKeyHex
    }
  | {
      readonly kind: 'delegation-expired'
      readonly name: string
      readonly expiresAt: number
      readonly now: number
    }
  | {
      readonly kind: 'delegation-outlived'
      readonly name: string
      readonly recordExpiresAt: number
      readonly delegationExpiresAt: number
    }

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
    case 'untrusted-root':
      return (
        `"${failure.name}" is signed under a delegation from ${failure.root}, ` +
        `which is not a pinned trust anchor`
      )
    case 'delegation-mismatch':
      return (
        `"${failure.name}" is signed by ${failure.signer} but carries a delegation to ` +
        `${failure.delegate} — a delegation authorises one key and not the bearer`
      )
    case 'bad-delegation-signature':
      return (
        `"${failure.name}" carries a delegation of ${failure.delegate} that ${failure.root} ` +
        `did not sign`
      )
    case 'delegation-expired':
      return (
        `"${failure.name}" is signed under a delegation that lapsed at ` +
        `${failure.expiresAt}, now ${failure.now}`
      )
    case 'delegation-outlived':
      return (
        `"${failure.name}" expires at ${failure.recordExpiresAt}, outliving the delegation ` +
        `that authorised it, which lapses at ${failure.delegationExpiresAt}`
      )
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
    // Who is allowed to have signed this — either the signer IS a pinned anchor, or it holds a
    // delegation from one. Kept as its own method so the record-integrity checks below read as
    // one sequence rather than being split around an authority branch.
    const unauthorised = this.#authorise(record, now)
    if (unauthorised !== null) return this.#refuse(unauthorised)

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

  /**
   * Whether `record.signer` was entitled to sign, returning the failure if not — task #4.
   *
   * Two ways to be entitled and no third. Either the signer is a pinned anchor, which is the
   * path every record signed before delegations existed takes and which is unchanged; or the
   * record carries a {@link NameDelegation} from a pinned anchor naming this signer.
   *
   * **A delegate is never treated as a root.** The anchor test below runs against
   * `delegation.root` only, so a delegate cannot issue a delegation of its own and have it
   * accepted — there is no chain of length three. That is enforced here by there being no
   * recursion rather than by a depth counter, which is a limit that cannot be miscounted.
   *
   * **The order of the checks is load-bearing.** Cheap structural facts first, the signature
   * verification last, so a malformed or unpinned delegation costs no curve operation. The
   * expiry checks come after the signature deliberately: an expired delegation and a forged
   * one are different findings, and reporting `delegation-expired` for something the root
   * never signed would send an operator to the clock instead of to the key.
   */
  #authorise(record: NameRecord, now: number): ResolveFailure | null {
    if (this.#anchors.has(record.signer)) return null

    const delegation = record.delegation
    if (delegation === undefined) {
      return { kind: 'untrusted-signer', name: record.name, signer: record.signer }
    }

    if (delegation.delegate !== record.signer) {
      return {
        kind: 'delegation-mismatch',
        name: record.name,
        signer: record.signer,
        delegate: delegation.delegate,
      }
    }

    if (!this.#anchors.has(delegation.root)) {
      return { kind: 'untrusted-root', name: record.name, root: delegation.root }
    }

    let valid = false
    try {
      valid = ed25519.verify(
        fromHex(delegation.signature),
        delegationPayloadOf(delegation),
        fromHex(delegation.root),
      )
    } catch {
      valid = false
    }
    if (!valid) {
      return {
        kind: 'bad-delegation-signature',
        name: record.name,
        root: delegation.root,
        delegate: delegation.delegate,
      }
    }

    if (delegation.expiresAt <= now) {
      return {
        kind: 'delegation-expired',
        name: record.name,
        expiresAt: delegation.expiresAt,
        now,
      }
    }

    // The ceiling that makes expiry a usable substitute for revocation. Without it, a stolen
    // signing key could mint a record with a 10-year clock inside a 30-day delegation, and
    // `resolve` — which re-checks only the RECORD's expiry — would keep honouring it long
    // after the delegation lapsed. With it, no record can outlive the authority behind it,
    // so the existing expiry check in `resolve` enforces the delegation bound for free.
    if (record.expiresAt > delegation.expiresAt) {
      return {
        kind: 'delegation-outlived',
        name: record.name,
        recordExpiresAt: record.expiresAt,
        delegationExpiresAt: delegation.expiresAt,
      }
    }

    return null
  }

  #refuse(failure: ResolveFailure): ResolveResult {
    return { ok: false, failure, reason: describeResolveFailure(failure) }
  }
}
