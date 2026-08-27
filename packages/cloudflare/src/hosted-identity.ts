/**
 * The hosted node's identity, persisted in Durable Object storage — Phase 29 criterion 2.
 *
 * ## Why this file exists at all
 *
 * Measured on 2026-08-24 against a deployed Worker: three consecutive `GET /self` calls
 * returned **three different PeerIds**, because each request landed in a fresh isolate
 * (`.planning/consults/2026-08-24-cloudflare-as-a-fabric-node-measured.md` §7). A node whose
 * name changes per request cannot be published, dialled twice, or named in a bootstrap list.
 * Moving the node into a Durable Object and persisting the seed is what fixed it, and the
 * persistence is this module.
 *
 * The rule is not new here. `@libp2p/keychain` exists in the Node tier for the same reason —
 * a WebRTC-Direct certhash that changes per restart invalidates every published multiaddr.
 * *An address derived from a key that changes per restart is an address nobody can publish.*
 *
 * ## Why a seed and not a key
 *
 * Because {@link identityFromSeed} already derives all four encodings from 32 bytes, and
 * `packages/libp2p/src/identity.ts` states why that matters: `peerId ↔ nodeKey` becomes a
 * pure function in both directions, so the Noise handshake is the standing proof of
 * possession for the certificate's subject key. A hosted node that stored a serialised
 * private key instead would need a second derivation path, and two paths are two things that
 * can disagree about who this node is.
 *
 * ## What this deliberately does NOT do
 *
 * It does not use `.tmp-`-then-`rename`. `packages/node/src/identity-store.ts` needs that
 * sequence because a POSIX write is not atomic and a process killed mid-write leaves a
 * half-written key. A Durable Object `put` of a single key is atomic by construction — the
 * platform's own consistency guarantee — so imitating the dance here would be ceremony that
 * looks like durability. The claim is narrow and is exactly the platform's: **one key, one
 * write.** Nothing here writes two keys that must agree.
 */

import { Key } from 'interface-datastore'
import type { Datastore } from 'interface-datastore'
import { SEED_BYTES, generateSeed, identityFromSeed } from '@o2/libp2p'
import type { NodeIdentity } from '@o2/libp2p'

/**
 * Where the seed lives in the store.
 *
 * **Deliberately not under `/o2/`.** That prefix is one of {@link REFUSED_NAMESPACE}'s two
 * values, so a key under it would be refused by `DoDatastore.put` and the node could never
 * mint an identity at all — a failure that would arrive at first boot of a deployed object
 * rather than in a test. `/identity/` collides with neither refused namespace, and the
 * completeness spec beside this one asserts that rather than trusting the sentence.
 */
export const HOSTED_IDENTITY_KEY: Key = new Key('/identity/seed')

/**
 * Thrown when the stored seed is the wrong length.
 *
 * Refusing is the whole point: a short read silently reinterpreted as a new identity would
 * drop this node out of every peer's verified set, out of every bootstrap list that names it,
 * and out of its own certificate — with nothing reporting why. The Node tier's
 * `MalformedSeedFileError` refuses for the same reason and says so in the same words.
 */
export class MalformedStoredSeedError extends Error {
  constructor(received: number) {
    super(
      `${HOSTED_IDENTITY_KEY.toString()} holds ${received} bytes, expected exactly ${SEED_BYTES}` +
        ' — refusing to reinterpret it as a new identity',
    )
    this.name = 'MalformedStoredSeedError'
  }
}

/**
 * Read the seed, minting and storing one on first use.
 *
 * `has` before `get` rather than `get`-and-catch: `Datastore.get` signals a miss by throwing,
 * and a `catch` around it would swallow a genuine storage fault as "not there yet" and mint a
 * second identity over a store that already held one. The two failures are opposite and only
 * one of them is recoverable, so they are not allowed to share a branch.
 */
export async function loadOrCreateHostedSeed(store: Datastore): Promise<Uint8Array> {
  if (await store.has(HOSTED_IDENTITY_KEY)) {
    const stored = await store.get(HOSTED_IDENTITY_KEY)
    if (stored.length !== SEED_BYTES) throw new MalformedStoredSeedError(stored.length)
    return stored
  }

  const seed = generateSeed()
  await store.put(HOSTED_IDENTITY_KEY, seed)
  return seed
}

/**
 * The hosted node's full identity, stable across eviction and redeploy.
 *
 * "Stable across eviction" is a claim about the STORE and not about this function: an object
 * evicted and re-instantiated runs this again over the same Durable Object storage and reads
 * the same 32 bytes. What a test can hold on one machine is exactly that — two instantiations
 * over one store yield one PeerId — and the spec beside this file asserts it that way rather
 * than pretending to have evicted anything. The deployed half of criterion 2 is an owner act.
 */
export async function hostedIdentity(store: Datastore): Promise<NodeIdentity> {
  return identityFromSeed(await loadOrCreateHostedSeed(store))
}
