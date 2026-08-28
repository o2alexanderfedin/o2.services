/**
 * Phase 29 criterion 2, the half a machine without a Cloudflare account can hold.
 *
 * ## What is asserted here and what is deliberately not
 *
 * The criterion is *"a peer outside Cloudflare dials the object, and gets the **same** PeerId
 * when it dials again after the object has been evicted and after a redeploy."* Two of those
 * three words are deploy-gated and stay open by owner ruling — no local spec can evict a
 * Durable Object or redeploy a Worker, and a spec that claimed to would be modelling
 * structure instead of truth.
 *
 * What eviction and redeploy have in common is the only thing this file needs: **a fresh
 * instantiation over storage that survived.** So every case below builds a SECOND
 * `HostedNode` over the same storage, which shares no memo, no field and no closure with the
 * first. That is the mechanism the criterion rests on, and it is testable in-process
 * precisely because `DoDatastore` was declared against a narrow interface that a complete
 * fake can implement.
 *
 * A run that mints a new identity on the second construction fails here, which is the same
 * failure the deployed criterion names — three consecutive requests to a plain Worker
 * returning three different PeerIds (`…measured.md` §7).
 */

import { describe, expect, it } from 'vitest'
import { Key } from 'interface-datastore'
import { SEED_BYTES } from '@o2/libp2p'
import { DoDatastore, REFUSED_NAMESPACE } from './do-datastore.ts'
import { FakeDurableObjectStorage } from './do-storage.fixture.ts'
import { HOSTED_IDENTITY_KEY, MalformedStoredSeedError } from './hosted-identity.ts'
import {
  HOSTED_OBJECT_NAME,
  HOSTED_OBJECT_NAMES,
  HostedNode,
  UnknownHostedObjectNameError,
  stubFor,
} from './hosted-object.ts'

/**
 * **`HOST-01` is named in the title below as of 2026-08-28, and the name is narrower than the
 * row.** The row says a *deployed* node is *dialable* over WSS at an identity unchanged across
 * eviction and redeploy. Nothing in this process is deployed and nothing here dials; that half
 * is owner-captured evidence (`29-EVIDENCE.md`) and no test can carry it.
 *
 * What this block carries is the mechanism the row rests on: the identity comes from the
 * storage rather than from the instance, so a construction boundary — which is what an eviction
 * and a redeploy have in common — does not mint a new PeerId. The id is in the title so that
 * when this goes red, the report says which ledger row just became false.
 */
describe('HOST-01, criterion 2 — the identity survives a fresh instantiation over storage that did', () => {
  it('gives one PeerId across two nodes built over the same storage, and a different one over different storage', async () => {
    const storage = new FakeDurableObjectStorage()

    const first = await new HostedNode(storage).identity()
    // A second object, not a second call: `HostedNode.identity` memoises, so asking the same
    // instance twice would assert the memo. Eviction and redeploy both destroy the instance
    // and keep the storage, and this is that.
    const second = await new HostedNode(storage).identity()

    expect(second.peerId).toBe(first.peerId)
    expect(second.nodeKey).toBe(first.nodeKey)
    // All four encodings derive from the seed alone (`packages/libp2p/src/identity.ts`), so
    // the seed is the thing that had to survive and this is the reading that says it did.
    expect([...second.seed]).toEqual([...first.seed])

    // **Anti-vacuity, and it is not optional.** Without it every assertion above is satisfied
    // by an identity derived from a constant — a fixture that always minted the same seed, or
    // a derivation that ignored its input, would pass the three lines above and fail nothing.
    const elsewhere = await new HostedNode(new FakeDurableObjectStorage()).identity()
    expect(elsewhere.peerId).not.toBe(first.peerId)
  })

  it('reads the seed back from the store rather than from anything the first node kept', async () => {
    const storage = new FakeDurableObjectStorage()
    const minted = await new HostedNode(storage).identity()

    // Asked of a store built independently of either node, so the bytes are read out of the
    // platform surface and not out of a field. This is what makes "it persisted" a statement
    // about storage rather than about JavaScript.
    const store = new DoDatastore(storage)
    expect(await store.has(HOSTED_IDENTITY_KEY)).toBe(true)
    expect([...(await store.get(HOSTED_IDENTITY_KEY))]).toEqual([...minted.seed])
    expect(minted.seed.length).toBe(SEED_BYTES)
  })

  it('refuses a stored seed of the wrong length instead of minting a second identity', async () => {
    const storage = new FakeDurableObjectStorage()
    const first = await new HostedNode(storage).identity()

    // One byte short. The dangerous behaviour is not throwing — it is SILENTLY minting a new
    // identity, which drops the node out of every peer's verified set and out of every
    // bootstrap list naming it, with nothing reporting why.
    await new DoDatastore(storage).put(HOSTED_IDENTITY_KEY, new Uint8Array(SEED_BYTES - 1))

    await expect(new HostedNode(storage).identity()).rejects.toThrow(MalformedStoredSeedError)
    // And the store still holds what was put there — the refusal did not overwrite it, which
    // is what makes the failure recoverable by a human rather than by a redeploy.
    expect((await new DoDatastore(storage).get(HOSTED_IDENTITY_KEY)).length).toBe(SEED_BYTES - 1)
    expect(first.seed.length).toBe(SEED_BYTES)
  })

  it('keeps the identity key out of both namespaces the store refuses', () => {
    // Asked of the production classifier rather than by comparing strings, so this cannot
    // drift from the rule `DoDatastore.put` actually applies. A seed key under a refused
    // prefix would make a deployed object unable to mint an identity at all — a failure that
    // arrives at first boot in production and nowhere earlier.
    expect(DoDatastore.refusedPrefixFor(HOSTED_IDENTITY_KEY)).toBeUndefined()
    // Anti-vacuity: the classifier does refuse something, so `undefined` above is a verdict
    // and not a function that always returns it.
    expect(DoDatastore.refusedPrefixFor(new Key(`${REFUSED_NAMESPACE.fabricKeyspace}x`))).toBe(
      REFUSED_NAMESPACE.fabricKeyspace,
    )
  })

  it('still refuses a record-shaped key through the production wiring — criterion 3 on a real path', async () => {
    // `do-datastore.test.ts` holds this against a directly constructed store. What this adds
    // is the composition: the store a `HostedNode` actually built refuses too, so the
    // unbounded-accumulation window is shut on the path a deployed object uses rather than
    // only on one a spec constructs.
    const node = new HostedNode(new FakeDurableObjectStorage())
    await expect(
      node.store.put(new Key(`${REFUSED_NAMESPACE.dhtDatastore}record/abc`), new Uint8Array(1)),
    ).rejects.toThrow()
  })
})

describe('criteria 4 and 6 — one call site, and a closed set of names', () => {
  /** Records what it was asked, so the assertion is about the call and not about the result. */
  function spyNamespace(): {
    readonly namespace: Parameters<typeof stubFor<string>>[0]
    readonly asked: string[]
  } {
    const asked: string[] = []
    return {
      asked,
      namespace: {
        idFromName: (name: string) => {
          asked.push(name)
          return { name }
        },
        get: (id: unknown) => `stub:${String((id as { name: string }).name)}`,
      },
    }
  }

  it('sites an object for each declared name and for no other', () => {
    for (const name of HOSTED_OBJECT_NAMES) {
      const { namespace, asked } = spyNamespace()
      expect(stubFor(namespace, name)).toBe(`stub:${name}`)
      // `idFromName` is what SITES the object, permanently, so the assertion is that it was
      // reached with exactly the declared name — not merely that a stub came back.
      expect(asked).toEqual([name])
    }
  })

  it('refuses a name that is not declared, before it can site anything', () => {
    const { namespace, asked } = spyNamespace()
    // A request-derived string is the case criterion 6 exists for. The type says
    // `HostedObjectName`; the value at a request boundary is a `string`, and only a value
    // check can refuse it — which is why the runtime guard is not redundant beside the type.
    const fromAVisitor = 'bootstrap-us-2' as (typeof HOSTED_OBJECT_NAMES)[number]
    expect(() => stubFor(namespace, fromAVisitor)).toThrow(UnknownHostedObjectNameError)
    // **The load-bearing half**: nothing was sited. An object created and then rejected is
    // still created, and its location is still permanent.
    expect(asked).toEqual([])
  })

  it('states the set once, so the enumeration and the array cannot disagree', () => {
    // Derived from the object rather than written twice — the drift this repository has paid
    // for before, most recently a literal written twice in `enrollment.ts` that moved apart.
    expect(HOSTED_OBJECT_NAMES).toEqual(Object.values(HOSTED_OBJECT_NAME))
    expect(HOSTED_OBJECT_NAMES.length).toBe(3)
    // Phase 33 owns three regions by name; this asserts membership rather than only the count,
    // because a set of three wrong names has the right length.
    expect([...HOSTED_OBJECT_NAMES].sort()).toEqual(['bootstrap-eu', 'bootstrap-sam', 'bootstrap-us'])
  })
})
