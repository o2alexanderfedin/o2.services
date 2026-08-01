/**
 * AUTH-01 — one on-device seed, read in two namespaces.
 *
 * A node has two names. The transport addresses it by libp2p peer id
 * (`Libp2pTransport.send` calls `peerIdFromString(to)`); a certificate names it by
 * `NodeCertificate.nodeKey`, a hex ed25519 public key. Those were two different
 * namespaces with nothing bridging them, and the Phase 6 tests only worked because the
 * in-memory network lets a node pick its own address, so a fixture could make the two
 * identical by fiat.
 *
 * This module resolves that by construction rather than with a lookup table: **one**
 * 32-byte ed25519 seed, generated on the device, read as both. `peerId ↔ nodeKey` is
 * therefore a pure function in both directions, computable offline by anyone holding
 * either name.
 *
 * That is what makes the Noise handshake the standing proof of possession for the
 * certificate's subject key. A node that has authenticated a peer over Noise already
 * knows which `nodeKey` that peer must present, and can refuse a certificate naming a
 * different one — re-proved on every dial, where `EnrollmentAuthority.enrol` proves it
 * once at issuance. It also makes the peer id stable across restarts, and makes
 * "the advertised identity is a certificate rather than a bare peer id" structurally
 * checkable instead of a matter of what a binary prints.
 *
 * **All nodes have equal functionality; the only difference is discovery.** Nothing here
 * reads what kind of node a peer is, and there is no field to branch on — a browser node
 * derives its identity by this same call and is verified on identical terms.
 */

import { generateKeyPairFromSeed, publicKeyFromRaw } from '@libp2p/crypto/keys'
import { peerIdFromPublicKey, peerIdFromString } from '@libp2p/peer-id'
import type { Ed25519PrivateKey } from '@libp2p/interface'
import { ed25519 } from '@noble/curves/ed25519.js'
import { fromHex, toHex } from '@o2/core'
import type { PublicKeyHex } from '@o2/core'

/** Length of an ed25519 seed, in bytes. Fixed by the curve, not a configuration choice. */
export const SEED_BYTES = 32

/**
 * A node's identity, in every encoding anything in this repository asks for.
 *
 * All four fields derive from `seed` alone; none is independently settable, so they
 * cannot disagree.
 */
export interface NodeIdentity {
  /** The 32 bytes everything else here is derived from. */
  readonly seed: Uint8Array
  /** The hex ed25519 public key a `NodeCertificate` names as its subject. */
  readonly nodeKey: PublicKeyHex
  /** The libp2p peer id the transport addresses this node by. */
  readonly peerId: string
  /** The key to hand `createLibp2p({ privateKey })`. */
  readonly privateKey: Ed25519PrivateKey
}

/**
 * Generate a fresh 32-byte seed.
 *
 * **This path reads `crypto.getRandomValues` and never `crypto.subtle`.** `keygen()`
 * bottoms out in `@noble/hashes`'s `randomBytes`, which reads `getRandomValues` and
 * throws if it is absent; `subtle` appears nowhere in it. That matters because a LAN
 * `http://` origin is **not** a secure context, so `crypto.subtle` is undefined there
 * while `getRandomValues` works — the same reason `start-probe.ts` probes for
 * `getRandomValues` specifically and says "deliberately not `crypto.subtle`".
 *
 * Nothing in this phase may reach for `crypto.subtle` to hash, sign, or generate.
 *
 * The accurate claim is *identity generation and derivation do not require
 * `crypto.subtle`* — **not** "nothing on this path touches it". `@libp2p/crypto`'s
 * browser entry does evaluate `crypto.get().subtle.generateKey({name:'Ed25519'}, …)` at
 * module load to memoise whether WebCrypto can sign Ed25519, inside a `try/catch` that
 * returns `false`; a missing `subtle` therefore routes its sign/verify to noble rather
 * than breaking. The insecure-context branch is **unmeasured** — both vitest projects run
 * on a secure origin, so it is never taken anywhere in this repository.
 */
export function generateSeed(): Uint8Array<ArrayBuffer> {
  const secretKey = ed25519.keygen().secretKey
  // Copy into a plain `Uint8Array<ArrayBuffer>`: the caller persists these bytes, and
  // handing back a view into whatever slab noble allocated would alias storage it owns.
  const seed = new Uint8Array(secretKey.length)
  seed.set(secretKey)
  return seed
}

/** Thrown when a seed is not exactly {@link SEED_BYTES} long. */
export class SeedLengthError extends Error {
  constructor(received: number) {
    super(`seed must be ${SEED_BYTES} bytes, got ${received}`)
    this.name = 'SeedLengthError'
  }
}

/**
 * Derive a node's full identity from its seed.
 *
 * `nodeKey` is `toHex(ed25519.getPublicKey(seed))` — byte-for-byte the derivation
 * `requestEnrollment` already uses, so the certificate names the key the node proves
 * possession of. `peerId` comes from the private key's own public half rather than from
 * `nodeKey`, so it is the peer id libp2p itself would choose and not one this module
 * invents. The two agree because `@libp2p/crypto`'s `generateKeyFromSeed` *is* the same
 * noble call; `identity.test.ts` pins that.
 *
 * A wrong-length seed throws rather than being padded or truncated: a short seed that
 * quietly became a different identity would drop the node out of every peer's verified
 * set with nothing reporting why.
 */
export async function identityFromSeed(seed: Uint8Array): Promise<NodeIdentity> {
  if (seed.length !== SEED_BYTES) throw new SeedLengthError(seed.length)

  const privateKey = await generateKeyPairFromSeed('Ed25519', seed)
  return {
    seed,
    nodeKey: toHex(ed25519.getPublicKey(seed)),
    peerId: peerIdFromPublicKey(privateKey.publicKey).toString(),
    privateKey,
  }
}

/**
 * The phase's one hex-key validator. Everything that turns a string into a key goes
 * through it.
 *
 * Two things a reader will otherwise assume wrongly, both measured before this was
 * written:
 *
 * **`fromHex` does not throw on non-hex — it zero-fills — so `try/catch` around it
 * protects nothing.** `'z'.repeat(64)` becomes 32 zero bytes, `publicKeyFromRaw` accepts
 * those as a valid Ed25519 key, and the caller gets a confident wrong peer id
 * (`12D3KooW9pNAk8ai…`). The near-miss is worse: a real key with its last byte corrupted
 * to non-hex keeps 31 of 32 bytes, so the derived peer id differs from the true one only
 * in its final characters. The validator is what stops a wrong answer; a `catch` only
 * stops a throw, and neither substitutes for the other.
 *
 * **The lowercase requirement is a namespace rule, not a wrong-answer rule.**
 * `Number.parseInt` is case-insensitive over hex, so an uppercase key parses to the *same
 * bytes* and derives the *same* peer id — nothing cryptographic goes wrong. What goes
 * wrong is that `PublicKeyHex` is a **string**: it is compared with `===`, held in `Set`s
 * and used as `Map` keys, and `toHex` only ever emits lowercase. One key with two
 * spellings is one identity to ed25519 and two identities to every string-keyed structure
 * here — including `verifyCertificate`'s `trustedIssuers.has(certificate.issuer)`, where a
 * pinned issuer spelled uppercase reads as `untrusted-issuer`. Canonicalising on lowercase
 * is what keeps string equality and key equality the same question.
 *
 * Lives here rather than beside `fromHex` in `@o2/core` because `packages/core/src/index.ts`
 * is edited by three other phases and this file's barrel is already open in this one.
 */
export function parseKeyHex(value: string): PublicKeyHex | null {
  return /^[0-9a-f]{64}$/.test(value) ? value : null
}

/**
 * The peer id whose holder must present this `nodeKey`, computed offline.
 *
 * Two layers, each doing a different job: `parseKeyHex` is what stops a *wrong answer*
 * (see its doc — `fromHex` zero-fills rather than throwing), and the `catch` is what stops
 * a *throw* from a well-formed hex string that is not a valid curve point. Neither
 * substitutes for the other.
 */
export function peerIdForNodeKey(nodeKey: PublicKeyHex): string | null {
  const parsed = parseKeyHex(nodeKey)
  if (parsed === null) return null
  try {
    return peerIdFromPublicKey(publicKeyFromRaw(fromHex(parsed))).toString()
  } catch {
    return null
  }
}

/**
 * The `nodeKey` whose holder must dial as this peer id, computed offline.
 *
 * An Ed25519 peer id carries its public key in an identity multihash, so this needs no
 * network call. A peer id of any other key type is refused rather than answered for: its
 * public key has no encoding in this phase's `nodeKey` namespace, and returning its bytes
 * would produce a hex string no certificate could ever match.
 */
export function nodeKeyForPeerId(peerId: string): PublicKeyHex | null {
  try {
    const publicKey = peerIdFromString(peerId).publicKey
    if (publicKey?.type !== 'Ed25519') return null
    return toHex(publicKey.raw)
  } catch {
    return null
  }
}
