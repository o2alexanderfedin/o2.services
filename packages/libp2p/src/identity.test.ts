import { generateKeyPair, generateKeyPairFromSeed, publicKeyFromRaw } from '@libp2p/crypto/keys'
import { peerIdFromPrivateKey, peerIdFromPublicKey } from '@libp2p/peer-id'
import { ed25519 } from '@noble/curves/ed25519.js'
import { describe, expect, it } from 'vitest'
import { fromHex, toHex } from '@o2/core'
import {
  SEED_BYTES,
  generateSeed,
  identityFromSeed,
  nodeKeyForPeerId,
  parseKeyHex,
  peerIdForNodeKey,
} from './identity.ts'

/**
 * AUTH-01 — one on-device seed, read in two namespaces.
 *
 * Runs in the node project *and* the browser project (plain `.test.ts`), which is the
 * cheapest way to learn whether the derivation holds in more than one engine.
 */

/**
 * Four seeds: the two boundary patterns, one fixed arbitrary pattern, and one real
 * generated seed. The three fixed ones make the suite deterministic; the generated one
 * is what stops the fixed three from being the only shape ever exercised.
 */
const ZERO_SEED = new Uint8Array(32)
const MAX_SEED = new Uint8Array(32).fill(0xff)
const PATTERN_SEED = Uint8Array.from({ length: 32 }, (_, i) => i * 7 + 3)
const seedsUnderTest = (): Uint8Array[] => [ZERO_SEED, MAX_SEED, PATTERN_SEED, generateSeed()]

/**
 * The peer id `fromHex`'s zero-fill produces from 64 characters of non-hex, measured on
 * this machine before the validator existed. Hardcoded rather than computed: an
 * expectation derived from the same call it checks only proves the code agrees with
 * itself.
 */
const CONFIDENT_WRONG_PEER_ID = '12D3KooW9pNAk8aiBuGVQtWRdbkLmo5qVL3e2h5UxbN2Nz9ttwiw'

describe('AUTH-01 — the noble/libp2p derivation pin', () => {
  /**
   * A pin on a dependency, not proof of a feature in this repository.
   *
   * `@libp2p/crypto`'s `generateKeyFromSeed` **is** `ed.getPublicKey(seed)` over the same
   * noble import this file uses — `dist/src/keys/ed25519/index.js:2` imports
   * `ed25519 as ed` from `@noble/curves/ed25519.js`, `:13-14` is
   * `derivePublicKey(privateKey) { return ed.getPublicKey(privateKey) }`, and
   * `generateKeyFromSeed` calls it at `:41` under the comment "the seed is used directly
   * as private key". The browser build does the same at `index.browser.js:32-41`.
   *
   * So both sides of this equality are one noble call on one set of bytes, and it is
   * expected rather than hoped for. **No deletion in this repository turns it red** — the
   * only way to redden it is to change `@libp2p/crypto`. It is kept to catch exactly that:
   * a future rewrite of `generateKeyFromSeed` that stopped agreeing would silently split
   * `nodeKey` from `peerId`, and every certificate would name a key its holder could not
   * be shown to hold.
   */
  it('derives one public key from one seed, in both libraries', async () => {
    for (const seed of seedsUnderTest()) {
      const noble = toHex(ed25519.getPublicKey(seed))
      const libp2p = toHex((await generateKeyPairFromSeed('Ed25519', seed)).publicKey.raw)
      expect(libp2p).toBe(noble)
    }
  })
})

describe('AUTH-01 — one seed, two namespaces', () => {
  it('yields a 64-character lowercase-hex nodeKey and a peer id', async () => {
    for (const seed of seedsUnderTest()) {
      const identity = await identityFromSeed(seed)
      expect(identity.nodeKey).toMatch(/^[0-9a-f]{64}$/)
      expect(identity.peerId.length).toBeGreaterThan(0)
      expect(identity.seed).toStrictEqual(seed)
    }
  })

  /**
   * The peer id is the one libp2p itself would choose, not one this module invents.
   *
   * **A second pin, not a feature proof, and the distinction was measured rather than
   * assumed.** Deriving `peerId` from `nodeKey` instead of from the private key does
   * **not** redden this — measured: 17/17 still pass. It cannot, and the reason is this
   * plan's own premise: the two derivations are byte-identical, so no assertion can
   * distinguish them. What this does catch is a genuine confusion between the two
   * namespaces — assigning `peerId` the `nodeKey` string reddens four tests here.
   */
  it('derives the peer id libp2p itself would choose', async () => {
    for (const seed of seedsUnderTest()) {
      const identity = await identityFromSeed(seed)
      const expected = peerIdFromPrivateKey(await generateKeyPairFromSeed('Ed25519', seed)).toString()
      expect(identity.peerId).toBe(expected)
    }
  })

  /**
   * The whole of decision 1: the mapping is a pure function in both directions, so a node
   * that has authenticated a peer over Noise already knows which `nodeKey` that peer must
   * present. No lookup table, no network call.
   */
  it('maps peerId and nodeKey to each other with no lookup table', async () => {
    for (const seed of seedsUnderTest()) {
      const identity = await identityFromSeed(seed)
      expect(peerIdForNodeKey(identity.nodeKey)).toBe(identity.peerId)
      expect(nodeKeyForPeerId(identity.peerId)).toBe(identity.nodeKey)
    }
  })

  it('agrees with the derivation requestEnrollment already uses for nodeKey', async () => {
    // `enrollment.ts:181` is `toHex(ed25519.getPublicKey(nodePrivateKey))`. If this module
    // disagreed, a certificate would name a key the node cannot be shown to hold.
    for (const seed of seedsUnderTest()) {
      const identity = await identityFromSeed(seed)
      expect(identity.nodeKey).toBe(toHex(ed25519.getPublicKey(seed)))
    }
  })

  it('gives two different seeds two different identities', async () => {
    const identities = await Promise.all(seedsUnderTest().map(identityFromSeed))
    expect(new Set(identities.map((i) => i.nodeKey)).size).toBe(identities.length)
    expect(new Set(identities.map((i) => i.peerId)).size).toBe(identities.length)
  })

  it('refuses a seed that is not SEED_BYTES long, naming the length it got', async () => {
    // A short seed must not quietly become a different identity.
    await expect(identityFromSeed(new Uint8Array(31))).rejects.toThrow(/31/)
    await expect(identityFromSeed(new Uint8Array(33))).rejects.toThrow(/33/)
  })
})

describe('AUTH-01 — generateSeed', () => {
  it('returns exactly SEED_BYTES bytes', () => {
    expect(SEED_BYTES).toBe(32)
    expect(generateSeed().length).toBe(SEED_BYTES)
  })

  it('does not return the same bytes twice', () => {
    expect(toHex(generateSeed())).not.toBe(toHex(generateSeed()))
  })
})

describe('AUTH-01 — parseKeyHex, the phase’s one hex-key validator', () => {
  /**
   * A validator asserted only on its rejections could be `() => null` and every rejection
   * test would still pass. Reddened by replacing `parseKeyHex`'s body with `return null`.
   */
  it('accepts every real key', async () => {
    for (const seed of seedsUnderTest()) {
      const identity = await identityFromSeed(seed)
      expect(parseKeyHex(identity.nodeKey)).toBe(identity.nodeKey)
    }
  })

  /**
   * The hazard that actually bites, and it is 64 characters long.
   *
   * `fromHex` does not throw on non-hex — it zero-fills — so `try/catch` protects nothing.
   * Measured before the validator existed: `fromHex('z'.repeat(64))` is 32 zero bytes,
   * `publicKeyFromRaw` accepts them as a valid Ed25519 key, and the derivation returns the
   * confident wrong peer id named below.
   *
   * Reddened by deleting the `parseKeyHex` call in `peerIdForNodeKey`.
   */
  it('refuses 64 characters of non-hex instead of zero-filling them into a wrong identity', () => {
    const nonHex = 'z'.repeat(64)
    expect(parseKeyHex(nonHex)).toBeNull()
    expect(peerIdForNodeKey(nonHex)).toBeNull()

    // What the answer would be without the validator, hardcoded so this test states the
    // wrong answer it prevents rather than merely asserting a null.
    expect(peerIdFromPublicKey(publicKeyFromRaw(fromHex(nonHex))).toString()).toBe(CONFIDENT_WRONG_PEER_ID)
  })

  /**
   * The nastier shape: a real key with its last byte corrupted to non-hex. 31 of 32 bytes
   * survive, so the peer id differs from the true one only in its final characters — a
   * near-miss no reader scanning a log would catch.
   */
  it('refuses a real key whose last byte is not hex', async () => {
    const identity = await identityFromSeed(PATTERN_SEED)
    const nearMiss = `${identity.nodeKey.slice(0, 62)}zz`

    expect(parseKeyHex(nearMiss)).toBeNull()
    expect(peerIdForNodeKey(nearMiss)).toBeNull()

    // Without the validator it is a *different* peer id that shares a long prefix with the
    // true one. Measured, not predicted.
    const unguarded = peerIdFromPublicKey(publicKeyFromRaw(fromHex(nearMiss))).toString()
    expect(unguarded).not.toBe(identity.peerId)
    expect(unguarded.slice(0, 48)).toBe(identity.peerId.slice(0, 48))
  })

  /**
   * Uppercase is refused — but **not** for the reason it would be natural to assume, and
   * the difference is measured here so nobody writes the wrong reason down again.
   *
   * `Number.parseInt` is case-insensitive over hex (`parseInt('AB',16) === parseInt('ab',16)
   * === 171`), so an uppercase key parses to the *same bytes* and derives the *same peer
   * id*. Nothing cryptographic goes wrong. What goes wrong is the **string** namespace:
   * `PublicKeyHex` is compared with `===`, held in `Set`s and used as `Map` keys, and
   * `toHex` only ever emits lowercase. So one key with two spellings is one identity to
   * ed25519 and two identities to every string-keyed structure in the repository —
   * including `verifyCertificate`'s `trustedIssuers.has(certificate.issuer)`
   * (`enrollment.ts:344`), where a pinned issuer spelled uppercase reads as
   * `untrusted-issuer`.
   *
   * Reddened by widening `parseKeyHex`'s pattern to `/^[0-9a-fA-F]{64}$/`.
   */
  it('refuses uppercase so one key cannot have two spellings', async () => {
    const identity = await identityFromSeed(PATTERN_SEED)
    const upper = identity.nodeKey.toUpperCase()

    expect(parseKeyHex(upper)).toBeNull()
    expect(peerIdForNodeKey(upper)).toBeNull()

    // The bytes and the peer id are identical — this is a namespace rule, not a
    // wrong-answer rule. Both halves are asserted so the reason cannot drift.
    expect(toHex(fromHex(upper))).toBe(identity.nodeKey)
    expect(peerIdFromPublicKey(publicKeyFromRaw(fromHex(upper))).toString()).toBe(identity.peerId)
    // And the consequence, in the structure that actually consumes these strings.
    expect(new Set([identity.nodeKey]).has(upper)).toBe(false)
  })

  /**
   * The cheap cases, kept for completeness and labelled for what they are: these are
   * **not** what the validator exists for. Both fail on length inside `publicKeyFromRaw`
   * and would fail identically with no validator present at all.
   */
  it('also refuses the cheap cases, which are not why it exists', () => {
    for (const cheap of ['', 'zz']) {
      expect(parseKeyHex(cheap)).toBeNull()
      expect(peerIdForNodeKey(cheap)).toBeNull()
    }
  })
})

describe('AUTH-01 — nodeKeyForPeerId refuses what it cannot answer for', () => {
  it('returns null for a string that is not a peer id', () => {
    expect(nodeKeyForPeerId('not-a-peer-id')).toBeNull()
    expect(nodeKeyForPeerId('')).toBeNull()
  })

  /**
   * A non-Ed25519 peer id carries a public key this phase's `nodeKey` namespace has no
   * encoding for. Answering with its bytes would produce a hex string that is not an
   * ed25519 key and that no certificate could ever match.
   *
   * Reddened by deleting the `publicKey?.type !== 'Ed25519'` guard.
   */
  it('returns null for a peer id that is not Ed25519', async () => {
    const secp = await generateKeyPair('secp256k1')
    const peerId = peerIdFromPublicKey(secp.publicKey).toString()
    expect(nodeKeyForPeerId(peerId)).toBeNull()
  })
})

describe('AUTH-01 — this module reads nothing about what kind of node a peer is', () => {
  /**
   * All nodes have equal functionality; the only difference is discovery. A browser node
   * enrols and is verified on identical terms, so there is no field here to branch on and
   * no argument that could carry one.
   */
  it('derives an identity from bytes alone, with no node-kind input', async () => {
    const seed = generateSeed()
    const first = await identityFromSeed(seed)
    const second = await identityFromSeed(seed)
    expect(second.nodeKey).toBe(first.nodeKey)
    expect(second.peerId).toBe(first.peerId)
  })
})
