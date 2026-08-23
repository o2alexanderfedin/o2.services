import { ed25519 } from '@noble/curves/ed25519.js'
import { describe, expect, it } from 'vitest'
import { toHex } from './capability.ts'
import { canonicalCid } from './canonical/encode.ts'
import {
  decodeNameRecord,
  encodeNameRecord,
  SignedNameResolver,
  signName,
  signNameDelegation,
} from './naming.ts'
import type { NameDelegation, NameRecord } from './naming.ts'
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

/**
 * Task #4, half 2 — a root that can stay offline.
 *
 * The property under test is not "a delegation verifies". It is that **every way a delegation
 * could be abused is refused, by name**, because the reason to introduce a second key at all
 * is to reduce what an attacker gets from stealing the first one. Each `it` below is one such
 * abuse, and each was watched failing before the check that catches it existed.
 */
describe('#4 — a delegated signing key, under a root that stays offline', () => {
  const root = keypair(21)
  const delegate = keypair(22)
  const stranger = keypair(23)

  /** A delegation that outlives the records signed under it, as `sign-kernel.ts` emits. */
  const warrant = (over: Partial<NameDelegation> = {}): NameDelegation => ({
    ...signNameDelegation(root.priv, { delegate: delegate.pub, expiresAt: LATER }),
    ...over,
  })

  const delegatedRecord = async (
    delegation: NameDelegation,
    signer: { priv: Uint8Array } = delegate,
    expiresAt: number = LATER,
  ): Promise<NameRecord> =>
    signName(signer.priv, {
      name: 'delegated',
      cid: await cidFor('delegated'),
      version: 1,
      expiresAt,
      delegation,
    })

  it('accepts a record signed by a delegate, from a resolver that pins only the root', async () => {
    const resolver = new SignedNameResolver([root.pub])
    const record = await delegatedRecord(warrant())

    // The whole point: the resolver has never seen the delegate's key, and the delegate's key
    // is the one that signed. Nothing was added to the anchor set — `SignedNameResolver` still
    // cannot learn one at runtime, which is the property this must not weaken.
    expect(resolver.accept(record, NOW).ok).toBe(true)
    expect(resolver.trustAnchors).toEqual([root.pub])
    expect(resolver.resolve('delegated', NOW).ok).toBe(true)
  })

  it('refuses a delegation from a root that is not pinned', async () => {
    // A stranger can mint a perfectly valid delegation to themselves. It is valid; it is just
    // not from anyone this resolver trusts, and that is the only thing standing between a
    // delegation seam and an open door.
    const forged = signNameDelegation(stranger.priv, { delegate: delegate.pub, expiresAt: LATER })
    const record = await delegatedRecord(forged)
    const result = new SignedNameResolver([root.pub]).accept(record, NOW)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.kind).toBe('untrusted-root')
    expect(result.reason).toContain('not a pinned trust anchor')
  })

  it('refuses a record whose signer is not the key the delegation names', async () => {
    // Bearer abuse: lift a genuine delegation off a genuine record and sign with a different
    // key. Every signature here is real; only the binding between them is missing.
    const record = await delegatedRecord(warrant(), stranger)
    const result = new SignedNameResolver([root.pub]).accept(record, NOW)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.kind).toBe('delegation-mismatch')
    expect(result.reason).toContain('authorises one key and not the bearer')
  })

  it('refuses a delegation the root did not sign', async () => {
    // The signature is structurally a signature and covers the right shape — it is simply not
    // over these fields. Produced by re-pointing a real delegation at a different delegate,
    // which is what an attacker holding one valid delegation would try first.
    const genuine = warrant()
    const record = await delegatedRecord({ ...genuine, delegate: stranger.pub })
    const result = new SignedNameResolver([root.pub]).accept(
      { ...record, signer: stranger.pub },
      NOW,
    )

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.kind).toBe('bad-delegation-signature')
  })

  it('refuses a lapsed delegation, and says so rather than blaming the signer', async () => {
    const lapsed = signNameDelegation(root.priv, { delegate: delegate.pub, expiresAt: NOW - 1 })
    const record = await delegatedRecord(lapsed, delegate, NOW - 1)
    const result = new SignedNameResolver([root.pub]).accept(record, NOW)

    expect(result.ok).toBe(false)
    if (result.ok) return
    // Not `untrusted-signer`. An operator reading that would go looking for the wrong bug —
    // a key problem instead of a clock problem — which is why these are distinct kinds.
    expect(result.failure.kind).toBe('delegation-expired')
  })

  it('refuses a record that would outlive the delegation authorising it', async () => {
    // This is what makes expiry usable as revocation. A signing key stolen today must not be
    // able to mint a record that survives the delegation it was issued under; if it could,
    // `resolve` — which re-checks only the record's own clock — would honour it indefinitely.
    const short = signNameDelegation(root.priv, { delegate: delegate.pub, expiresAt: NOW + 1_000 })
    const record = await delegatedRecord(short, delegate, NOW + 10_000_000)
    const result = new SignedNameResolver([root.pub]).accept(record, NOW)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.kind).toBe('delegation-outlived')
    expect(result.reason).toContain('outliving the delegation')
  })

  it('will not let a delegate issue a delegation of its own', async () => {
    // No chain of length three. The delegate mints a warrant for a stranger, exactly as the
    // root minted one for it, and the stranger signs. Refused because `#authorise` tests only
    // `delegation.root` against the anchors and never recurses — a limit that cannot be
    // miscounted because there is no counter.
    const subDelegation = signNameDelegation(delegate.priv, {
      delegate: stranger.pub,
      expiresAt: LATER,
    })
    const record = await delegatedRecord(subDelegation, stranger)
    const result = new SignedNameResolver([root.pub]).accept(record, NOW)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.kind).toBe('untrusted-root')
  })

  it('carries the delegation through the wire form unchanged, and still verifies', async () => {
    // A delegation that cannot survive encode/decode is useless: the whole point is handing a
    // record to someone else. Round-tripped and then verified, not merely compared — equality
    // would pass if both sides were equally wrong about the field order the signature covers.
    const record = await delegatedRecord(warrant())
    const decoded = decodeNameRecord(encodeNameRecord(record))

    expect(decoded).not.toBeNull()
    if (decoded === null) return
    expect(decoded.delegation).toEqual(record.delegation)
    expect(new SignedNameResolver([root.pub]).accept(decoded, NOW).ok).toBe(true)
  })

  it('refuses a record whose delegation is present but malformed, rather than dropping it', async () => {
    // The rule `decodeNameRecord` already states for `translationKeyCid`: a dropped field
    // would produce a record whose payload differs from the one that was signed, and the
    // failure would surface as `bad-signature` — a decoding bug wearing a forgery's name.
    const record = await delegatedRecord(warrant())
    const parsed: Record<string, unknown> = JSON.parse(encodeNameRecord(record))
    const delegation: Record<string, unknown> = { ...(parsed['delegation'] as object) }

    // Guarded, because a mangle that does not mangle makes the refusal below vacuous — the
    // first version of this test used a regex that silently matched nothing and asserted that
    // an untouched record was refused, which it was not.
    expect(delegation['expiresAt']).toBeTypeOf('number')
    delegation['expiresAt'] = 'soon'
    const mangled = JSON.stringify({ ...parsed, delegation })
    expect(mangled).not.toBe(encodeNameRecord(record))

    expect(decodeNameRecord(mangled)).toBeNull()
  })

  it('leaves an undelegated record byte-identical to what it was before delegations existed', async () => {
    // The compatibility property, held as a byte comparison for the same reason the
    // translation field's is: every record signed before this field existed must still
    // verify, and it does so only if `payloadOf` omits the key entirely when absent.
    const cid = await cidFor('plain')
    const plain = signName(publisher.priv, { name: 'plain', cid, version: 1, expiresAt: LATER })

    expect('delegation' in plain).toBe(false)
    expect(encodeNameRecord(plain)).not.toContain('delegation')
    expect(new SignedNameResolver([publisher.pub]).accept(plain, NOW).ok).toBe(true)
  })
})

/**
 * RFC-0003 Response 01 §1.8 recommendation 5, second half — **refusal within the set,
 * never pick.**
 *
 * The first half ("replace across channels") was already true: `bin/agent.ts` and
 * `bin/seed.ts` let a supplied `--trust-anchor` list replace the compiled-in default
 * rather than join it. The second half was not, and the behaviour it left was measured
 * before it was changed: `accept` compared **only** `record.version` against the version
 * it already held, and nothing compared the authority. So with two anchors pinned, either
 * could take over any name the other published simply by signing a higher version — the
 * resolver *picked*, and it picked by a number the attacker chooses.
 *
 * The exposure was never the default: one anchor ships compiled in and the flag replaces
 * the list. It is a deployment that deliberately pins several, which is exactly the case
 * §1.6 is about.
 *
 * **Priced, not free.** §1.8 records the cost as a denial-of-service surface: an attacker
 * who can get one contradictory record into an accepted anchor's namespace stops that name
 * resolving, where a precedence rule would have produced an answer. That is deliberate —
 * "two anchors disagree" is not a condition a resolver can adjudicate, and quietly
 * preferring one of them is how a pin becomes decorative.
 *
 * The comparison is on the **root authority** and not on `signer`, because a delegation
 * is a legitimate way for one anchor to sign under several keys. Two records delegated by
 * the same root are the same authority; the same key promoted to a different root is not.
 */
describe('DATA-07 — two pinned anchors do not overwrite each other’s names', () => {
  const other = keypair(13)

  it('refuses a higher version for a name another anchor already holds', async () => {
    const mine = await cidFor('mine')
    const theirs = await cidFor('theirs')
    const resolver = new SignedNameResolver([publisher.pub, other.pub])

    expect(
      resolver.accept(
        signName(publisher.priv, { name: 'kernel', cid: mine, version: 1, expiresAt: LATER }),
        NOW,
      ).ok,
    ).toBe(true)

    const takeover = resolver.accept(
      signName(other.priv, { name: 'kernel', cid: theirs, version: 99, expiresAt: LATER }),
      NOW,
    )
    expect(takeover.ok, 'a second pinned anchor took over a name by out-numbering it').toBe(false)
    if (takeover.ok) return
    expect(takeover.failure.kind).toBe('authority-changed')
    expect(takeover.reason).toContain('kernel')

    // And the name still resolves to what its own authority published.
    const resolved = resolver.resolve('kernel', NOW)
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return
    expect(resolved.cid.toString()).toBe(mine.toString())
  })

  it('still accepts a higher version from the authority that already holds the name', async () => {
    const first = await cidFor('v1')
    const second = await cidFor('v2')
    const resolver = new SignedNameResolver([publisher.pub, other.pub])

    resolver.accept(
      signName(publisher.priv, { name: 'kernel', cid: first, version: 1, expiresAt: LATER }),
      NOW,
    )
    const update = resolver.accept(
      signName(publisher.priv, { name: 'kernel', cid: second, version: 2, expiresAt: LATER }),
      NOW,
    )
    expect(update.ok, 'the refusal caught an ordinary update by its own publisher').toBe(true)

    const resolved = resolver.resolve('kernel', NOW)
    expect(resolved.ok).toBe(true)
    if (!resolved.ok) return
    expect(resolved.cid.toString()).toBe(second.toString())
  })

  it('treats a delegate of the holding authority as that authority, not as a stranger', async () => {
    const first = await cidFor('by-root')
    const second = await cidFor('by-delegate')
    const delegate = keypair(14)
    const resolver = new SignedNameResolver([publisher.pub, other.pub])

    resolver.accept(
      signName(publisher.priv, { name: 'kernel', cid: first, version: 1, expiresAt: LATER }),
      NOW,
    )

    const delegation: NameDelegation = signNameDelegation(publisher.priv, {
      delegate: delegate.pub,
      expiresAt: LATER,
    })
    const viaDelegate = resolver.accept(
      signName(delegate.priv, {
        name: 'kernel',
        cid: second,
        version: 2,
        expiresAt: LATER,
        delegation,
      }),
      NOW,
    )
    expect(
      viaDelegate.ok,
      'the check compared signers rather than root authorities, so an anchor could not delegate',
    ).toBe(true)
  })
})
