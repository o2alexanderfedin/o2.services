import { ed25519 } from '@noble/curves/ed25519.js'
import { describe, expect, it } from 'vitest'
import { toHex } from './capability.ts'
import { canonicalCid } from './canonical/encode.ts'
import { SignedNameResolver, signName } from './naming.ts'

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
