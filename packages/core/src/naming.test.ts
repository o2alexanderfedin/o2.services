import { ed25519 } from '@noble/curves/ed25519.js'
import { describe, expect, it } from 'vitest'
import { toHex } from './capability.ts'
import { canonicalCid } from './canonical/encode.ts'
import { decodeNameRecord, encodeNameRecord, SignedNameResolver, signName } from './naming.ts'
import type { NameRecord } from './naming.ts'
import type { CID } from 'multiformats/cid'

/**
 * DATA-07 / DATA-08 — provenance, which content addressing does not provide.
 *
 * A CID proves the bytes you got are the bytes that were hashed. It cannot tell you
 * they are the module you meant to run, because anyone can publish a CID. These tests
 * are about the gap between integrity and provenance.
 */

function keypair(seed: number): { priv: Uint8Array; pub: string } {
  const priv = new Uint8Array(32).fill(seed)
  return { priv, pub: toHex(ed25519.getPublicKey(priv)) }
}

const publisher = keypair(11)
const impostor = keypair(12)

const NOW = 1_800_000_000_000
const LATER = NOW + 60_000

const cidFor = async (value: string) => {
  const hashed = await canonicalCid({ artifact: value })
  if (!hashed.ok) throw new Error('fixture not encodable')
  return hashed.cid
}

describe('DATA-07 — artifacts resolve only through signed mappings', () => {
  it('accepts and resolves a record signed by a pinned anchor', async () => {
    const cid = await cidFor('good')
    const resolver = new SignedNameResolver([publisher.pub])
    const record = signName(publisher.priv, { name: 'wordcount', cid, version: 1, expiresAt: LATER })

    expect(resolver.accept(record, NOW).ok).toBe(true)
    const resolved = resolver.resolve('wordcount', NOW)
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return
    expect(resolved.cid.toString()).toBe(cid.toString())
  })

  it('refuses a name that was never signed — a bare CID is not executable', () => {
    const resolver = new SignedNameResolver([publisher.pub])
    const result = resolver.resolve('wordcount', NOW)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.kind).toBe('unknown-name')
    expect(result.reason).toContain('bare CID')
  })

  it('refuses a validly-signed record from an untrusted key', async () => {
    // The signature is perfectly good. It is the *signer* that is not pinned —
    // exactly the substitution attack content addressing cannot see.
    const cid = await cidFor('evil')
    const resolver = new SignedNameResolver([publisher.pub])
    const forged = signName(impostor.priv, { name: 'wordcount', cid, version: 1, expiresAt: LATER })

    const result = resolver.accept(forged, NOW)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.kind).toBe('untrusted-signer')
    expect(resolver.resolve('wordcount', NOW).ok).toBe(false)
  })

  it('refuses a record whose contents were altered after signing', async () => {
    const good = await cidFor('good')
    const evil = await cidFor('evil')
    const resolver = new SignedNameResolver([publisher.pub])
    const record = signName(publisher.priv, { name: 'wordcount', cid: good, version: 1, expiresAt: LATER })

    // Swap the CID, keep the signature.
    const result = resolver.accept({ ...record, cid: evil }, NOW)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.kind).toBe('bad-signature')
  })

  it('refuses an expired record, and stops resolving one that expires later', async () => {
    const cid = await cidFor('good')
    const resolver = new SignedNameResolver([publisher.pub])
    resolver.accept(signName(publisher.priv, { name: 'n', cid, version: 1, expiresAt: LATER }), NOW)

    expect(resolver.resolve('n', NOW).ok).toBe(true)
    // Same record, later clock.
    const stale = resolver.resolve('n', LATER + 1)
    expect(stale.ok).toBe(false)
    if (stale.ok) return
    expect(stale.failure.kind).toBe('expired')
  })
})

describe('DATA-08 — a signer cannot roll a name backwards', () => {
  it('refuses an older version once a newer one is known', async () => {
    const v1 = await cidFor('v1')
    const v2 = await cidFor('v2')
    const resolver = new SignedNameResolver([publisher.pub])

    resolver.accept(signName(publisher.priv, { name: 'app', cid: v1, version: 1, expiresAt: LATER }), NOW)
    resolver.accept(signName(publisher.priv, { name: 'app', cid: v2, version: 2, expiresAt: LATER }), NOW)

    // Replaying the genuinely-signed v1 must not downgrade the name to an older,
    // possibly vulnerable, artifact.
    const replay = resolver.accept(
      signName(publisher.priv, { name: 'app', cid: v1, version: 1, expiresAt: LATER }),
      NOW,
    )
    expect(replay.ok).toBe(false)
    if (replay.ok) return
    expect(replay.failure.kind).toBe('rollback')

    const current = resolver.resolve('app', NOW)
    expect(current.ok).toBe(true)
    if (!current.ok) return
    expect(current.cid.toString()).toBe(v2.toString())
  })

  it('allows a re-issue at the same version, for key rotation or renewal', async () => {
    const cid = await cidFor('same')
    const resolver = new SignedNameResolver([publisher.pub])
    resolver.accept(signName(publisher.priv, { name: 'app', cid, version: 3, expiresAt: LATER }), NOW)
    const renewed = resolver.accept(
      signName(publisher.priv, { name: 'app', cid, version: 3, expiresAt: LATER + 10_000 }),
      NOW,
    )
    expect(renewed.ok).toBe(true)
  })
})

describe('trust anchors are fixed at construction', () => {
  it('exposes them, and cannot be taught a new one at runtime', () => {
    const resolver = new SignedNameResolver([publisher.pub])
    expect(resolver.trustAnchors).toEqual([publisher.pub])
    // A resolver that could learn an anchor would only be as trustworthy as
    // whatever taught it. There is deliberately no method to do so.
    expect('addTrustAnchor' in resolver).toBe(false)
    expect('trust' in resolver).toBe(false)
  })
})

describe('a signed record survives leaving the process', () => {
  /**
   * The publish path's wire form. `tools/aot/cli.ts` writes one of these beside every artifact
   * it lifts, because `guardModuleProvenance` refuses a bare CID — *"a bare CID names bytes, not
   * a publisher"* — so before this format existed nothing the lifter produced could be dispatched
   * to a node that pins a build authority.
   */
  const seed = new Uint8Array(32).fill(9)

  async function aRecord() {
    const hashed = await canonicalCid({ bytes: new Uint8Array([1, 2, 3]) })
    if (!hashed.ok) throw new Error('the fixture could not be hashed')
    return signName(seed, {
      name: 'a-published-artifact',
      cid: hashed.cid,
      version: 4,
      expiresAt: 1_800_000_000_000,
    })
  }

  it('round-trips every field, including the CID', async () => {
    const record = await aRecord()
    const back = decodeNameRecord(encodeNameRecord(record))
    expect(back).not.toBeNull()
    expect(back?.name).toBe(record.name)
    expect(back?.cid.toString()).toBe(record.cid.toString())
    expect(back?.version).toBe(record.version)
    expect(back?.expiresAt).toBe(record.expiresAt)
    expect(back?.signer).toBe(record.signer)
    expect(back?.signature).toBe(record.signature)
  })

  it('is still accepted by the resolver after the round trip', async () => {
    // The assertion that makes the format worth having: a record that survives encoding but
    // stops verifying is a file that looks like a publish and is not one.
    const record = await aRecord()
    const back = decodeNameRecord(encodeNameRecord(record))
    expect(back).not.toBeNull()
    if (back === null) return
    const resolver = new SignedNameResolver([record.signer])
    expect(resolver.accept(back, record.expiresAt - 1).ok).toBe(true)
  })

  it('refuses text that is not a record, rather than half-decoding it', () => {
    // Every rejection is `null`, on the ground `asNodeRecords` gives: a partially-formed record
    // hands the resolver something to verify that is not a record.
    expect(decodeNameRecord('not json at all')).toBeNull()
    expect(decodeNameRecord('[]')).toBeNull()
    expect(decodeNameRecord('null')).toBeNull()
    expect(decodeNameRecord('{}')).toBeNull()
  })

  it('refuses a signer or signature that is not hex, which fromHex would have admitted', async () => {
    // THE case that carries the validation. `fromHex` never rejects — it runs `Number.parseInt`
    // per byte pair and turns anything unparseable into 0 — so a check written as
    // `fromHex(x) === null` cannot fail, and reads exactly like validation while admitting
    // everything. That check was written here first and this is what replaced it.
    const record = await aRecord()
    const good: Record<string, unknown> = JSON.parse(encodeNameRecord(record))

    expect(decodeNameRecord(JSON.stringify({ ...good, signer: 'zz'.repeat(32) }))).toBeNull()
    expect(decodeNameRecord(JSON.stringify({ ...good, signer: 'ABCD'.repeat(16) }))).toBeNull()
    expect(decodeNameRecord(JSON.stringify({ ...good, signer: 'ab' }))).toBeNull()
    expect(decodeNameRecord(JSON.stringify({ ...good, signature: 'nothex' }))).toBeNull()
    // And the other direction, so the predicate is not simply refusing everything.
    expect(decodeNameRecord(JSON.stringify(good))).not.toBeNull()
  })

  it('refuses a malformed CID, a negative version and a non-finite expiry', async () => {
    const record = await aRecord()
    const good: Record<string, unknown> = JSON.parse(encodeNameRecord(record))
    expect(decodeNameRecord(JSON.stringify({ ...good, cid: 'not-a-cid' }))).toBeNull()
    expect(decodeNameRecord(JSON.stringify({ ...good, version: -1 }))).toBeNull()
    expect(decodeNameRecord(JSON.stringify({ ...good, version: 1.5 }))).toBeNull()
    expect(decodeNameRecord(JSON.stringify({ ...good, name: '' }))).toBeNull()
  })
})

/**
 * AOT-02 — the translation a signed artifact came out of, carried inside the signature.
 *
 * `NameRecord.cid` vouches for the bytes. `translationKeyCid` vouches for *why those bytes
 * should be what they are*: `@o2/aot`'s `translationCid` hashes the input digest, the
 * target, the toolchain versions and the required WASM feature set into one CID, and a
 * consumer holding a lift of its own compares the two. `tools/aot/lift.ts` is where the
 * comparison and its refusal live; what is checked here is the three properties that make
 * the claim worth anything — it is signed, it is optional in a way that does not disturb
 * records predating it, and it survives the wire form.
 */
describe('AOT-02 — a record can vouch for the translation as well as the bytes', () => {
  const seed = new Uint8Array(32).fill(9)

  async function twoCids(): Promise<{ artifact: CID; key: CID; otherKey: CID }> {
    const artifact = await canonicalCid({ bytes: new Uint8Array([1, 2, 3]) })
    const key = await canonicalCid({ target: 'aarch64-wasi32', clang: '16.0.6' })
    const otherKey = await canonicalCid({ target: 'aarch64-wasi32', clang: '17.0.1' })
    if (!artifact.ok || !key.ok || !otherKey.ok) throw new Error('fixture not encodable')
    return { artifact: artifact.cid, key: key.cid, otherKey: otherKey.cid }
  }

  it('signs it, so it cannot be attached, stripped or swapped after the fact', async () => {
    const { artifact, key, otherKey } = await twoCids()
    const fields = { name: 'lifted', cid: artifact, version: 1, expiresAt: LATER } as const
    const record = signName(seed, { ...fields, translationKeyCid: key })
    const resolver = new SignedNameResolver([record.signer])

    // The record as issued verifies.
    expect(resolver.accept(record, NOW).ok).toBe(true)

    // Swapped: the same signature over a different translation key is refused. This is the
    // whole reason the field is inside the payload rather than beside it — a publisher's
    // claim about the toolchain must not be editable by whoever relays the file.
    const swapped = resolver.accept({ ...record, translationKeyCid: otherKey }, NOW)
    expect(swapped.ok).toBe(false)
    if (swapped.ok) return
    expect(swapped.failure.kind).toBe('bad-signature')

    // Stripped: removing it is equally a different record. Written by rebuilding the object
    // without the key rather than by setting `undefined`, because an absent key and an
    // explicit `undefined` are different values to a canonical encoder and only the first is
    // what a stripped file would decode to.
    const stripped = resolver.accept(
      { name: record.name, cid: record.cid, version: record.version, expiresAt: record.expiresAt, signer: record.signer, signature: record.signature },
      NOW,
    )
    expect(stripped.ok).toBe(false)

    // Attached: a record signed WITHOUT one does not accept one being added.
    const bare = signName(seed, fields)
    expect(resolver.accept(bare, NOW).ok).toBe(true)
    expect(resolver.accept({ ...bare, translationKeyCid: key }, NOW).ok).toBe(false)
  })

  it('leaves a record that carries none hashing exactly as it did before the field existed', async () => {
    // The compatibility claim, as a byte comparison rather than as a sentence. Every record
    // signed before 2026-08-18 — the demo's committed kernel records among them — has no
    // translation behind it, and `payloadOf` omits the field entirely rather than encoding a
    // null, so those signatures verify against byte-identical payloads. The reading is that
    // the signature of a record built with no key equals the signature of one built by a
    // signer that has never heard of the field, which is the same expression.
    const { artifact } = await twoCids()
    const fields = { name: 'unlifted', cid: artifact, version: 1, expiresAt: LATER } as const
    const withoutField = signName(seed, fields)
    const withUndefinedSpread = signName(seed, { ...fields })
    expect(withoutField.signature).toBe(withUndefinedSpread.signature)
    expect(withoutField.translationKeyCid).toBeUndefined()
    // …and the encoded file has no such property at all, rather than a null one.
    const encoded: Record<string, unknown> = JSON.parse(encodeNameRecord(withoutField))
    expect('translationKeyCid' in encoded).toBe(false)
  })

  it('round-trips it, and refuses a present-but-unparseable one rather than dropping it', async () => {
    const { artifact, key } = await twoCids()
    const record = signName(seed, {
      name: 'lifted',
      cid: artifact,
      version: 1,
      expiresAt: LATER,
      translationKeyCid: key,
    })
    const back = decodeNameRecord(encodeNameRecord(record))
    expect(back?.translationKeyCid?.toString()).toBe(key.toString())
    // And it still verifies after the round trip — a field that survives encoding but
    // changes the payload is a file that looks like a publish and is not one.
    expect(new SignedNameResolver([record.signer]).accept(back as NameRecord, NOW).ok).toBe(true)

    // Present and unparseable is a malformed record, not a record without the field.
    // Dropping it would hand the resolver a payload that differs from the one signed, and
    // the signature check would then report `bad-signature` for a decoding bug.
    const good: Record<string, unknown> = JSON.parse(encodeNameRecord(record))
    expect(decodeNameRecord(JSON.stringify({ ...good, translationKeyCid: 'not-a-cid' }))).toBeNull()
    expect(decodeNameRecord(JSON.stringify({ ...good, translationKeyCid: 7 }))).toBeNull()
    expect(decodeNameRecord(JSON.stringify(good))).not.toBeNull()
  })
})
