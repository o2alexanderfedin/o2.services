import type { PeerId } from '@libp2p/interface'
import { peerIdFromString } from '@libp2p/peer-id'
import { describe, expect, it } from 'vitest'
import { audienceKeyOf } from './audience-key.ts'

/**
 * AUTH-03 — the audience key both ends of a dispatch arrive at independently.
 *
 * No `.node.` suffix, deliberately: this file runs in the node project *and* in the
 * browser project, which is itself part of the claim. The derivation is pure JS and
 * touches `crypto.subtle` nowhere, so the kernel's "never require a secure context"
 * constraint holds on this path by construction rather than by a check.
 */

/**
 * A real Ed25519 peer id, observed rather than composed.
 *
 * Recorded verbatim at `.planning/phases/phase-13-egress-manifest-completeness/13-VERIFICATION.md:245`
 * as the handshake line a genuinely spawned `bin/agent.ts` process printed. Provenance
 * matters here: a peer id invented by hand would not round-trip through
 * `peerIdFromString`, so a reader should know this one came off a running node.
 */
const OBSERVED_PEER_ID = '12D3KooWKFrpYTgHg9tkjVvocKdbovBiV1B7LSK3rJSo7eB1emN8'

/**
 * The two refusal fixtures are **structural stubs**, cast through `as unknown as PeerId`.
 *
 * Minting a real secp256k1 or RSA identity needs `@libp2p/crypto`, and adding a
 * dependency to this package would mean an `npm install` in a working tree several
 * agents share. The branch under test is a two-line type check whose input shape is
 * fully determined by `@libp2p/interface`, so a structural stub exercises exactly the
 * code a real identity would.
 *
 * The sentence that stops a later plan from over-reading these two cases: they prove
 * `audienceKeyOf` refuses. They prove **nothing** about what a node factory does when
 * it refuses, and they cannot. `FabricNode.start` calls `createLibp2p` with no
 * `privateKey` option (the whole call is `fabric-node.ts:505-552`; `privateKey` appears
 * nowhere in that file — verified 2026-07-31), so every identity that factory ever
 * produces is the Ed25519 default and the throwing branch is unreachable through it.
 */
const SECP256K1_STUB = {
  type: 'secp256k1',
  publicKey: { raw: new Uint8Array(33) },
  toString: () => 'stub-secp256k1-peer',
} as unknown as PeerId

const NO_PUBLIC_KEY_STUB = {
  type: 'RSA',
  publicKey: undefined,
  toString: () => 'stub-rsa-peer',
} as unknown as PeerId

describe('audienceKeyOf — the chain audience recovered from a peer id', () => {
  it('recovers 64 hex characters from a peer id string alone', () => {
    // The load-bearing property of 15-CONTEXT.md decision 1: the string a requestor
    // already holds is enough. A derivation needing a live `PeerId` object, or a key
    // file, cannot satisfy this.
    const key = audienceKeyOf(OBSERVED_PEER_ID)
    expect(key).toHaveLength(64)
    expect(key).toMatch(/^[0-9a-f]{64}$/)
  })

  it('derives the identical key from a PeerId object and from its own toString()', () => {
    // This is what lets the requestor and the serving node reach the same audience
    // from different starting points — one from `libp2p.peerId`, one from the
    // `nodeId` string it was given.
    const peerId = peerIdFromString(OBSERVED_PEER_ID)
    expect(audienceKeyOf(peerId)).toBe(audienceKeyOf(peerId.toString()))
    expect(audienceKeyOf(peerId)).toBe(audienceKeyOf(OBSERVED_PEER_ID))
  })

  it('refuses a non-Ed25519 identity by name rather than mis-deriving one', () => {
    // Not a key `verifyChain` would later reject as wrong-audience: that refusal
    // reads as *the chain was minted for another node*, and would send a reader
    // looking in the wrong file.
    expect(() => audienceKeyOf(SECP256K1_STUB)).toThrow(/secp256k1/)
    expect(() => audienceKeyOf(SECP256K1_STUB)).toThrow(/Ed25519/)
    expect(() => audienceKeyOf(SECP256K1_STUB)).toThrow(/stub-secp256k1-peer/)
  })

  it('refuses an identity carrying no public key, with distinct text', () => {
    // Distinct from the wrong-type case because the two have different fixes.
    expect(() => audienceKeyOf(NO_PUBLIC_KEY_STUB)).toThrow(/carries no public key/)
    expect(() => audienceKeyOf(NO_PUBLIC_KEY_STUB)).toThrow(/stub-rsa-peer/)
  })
})
