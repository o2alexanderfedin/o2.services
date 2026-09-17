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

import { describe, expect, it, vi } from 'vitest'
import { Key } from 'interface-datastore'
import { SEED_BYTES } from '@o2/libp2p'
import { openSecret } from '@o2/core'
import { DoDatastore, REFUSED_NAMESPACE } from './do-datastore.ts'
import { FakeDurableObjectStorage } from './do-storage.fixture.ts'
import {
  HOSTED_IDENTITY_KEY,
  MalformedStoredSeedError,
  SEALED_HOSTED_IDENTITY_KEY,
} from './hosted-identity.ts'
import {
  HOSTED_LOCATION_HINTS,
  HOSTED_OBJECT_NAME,
  HOSTED_OBJECT_NAMES,
  HostedNode,
  UnknownHostedObjectNameError,
  UnsupportedJurisdictionError,
  euJurisdictionOf,
  samLocationHint,
  stubFor,
} from './hosted-object.ts'
import type { DurableObjectJurisdiction, HostedObjectGetOptions } from './hosted-object.ts'



/**
 * **Every case in this file derives an Argon2id key, so the default five-second budget is the
 * wrong one — measured, not anticipated.**
 *
 * Since AUTH-07 criterion 4 the hosted identity is an envelope, and opening or sealing it
 * costs one Argon2id derivation at `DEFAULT_KDF_PARAMS` — 19 MiB and roughly 650 ms
 * uncontended on this host. A case that builds two nodes pays it twice. That is comfortably
 * inside five seconds on a quiet machine and NOT inside it on a busy one: a full
 * `--project node` sweep runs eight workers, several of them deriving at the same time, and
 * this file lost two cases to `Error: Test timed out in 5000ms.` on a run whose banner
 * reported the host oversubscribed at load 11.89 across 8 cores.
 *
 * **Raising the budget rather than lowering the cost**, because the cost is the feature: a
 * memory-hard KDF is what prices a guess against an attacker holding this store. A per-case
 * timeout would have to be repeated on every case and would drift; `vi.setConfig` states it
 * once for the file.
 *
 * The number is a **budget, never an assertion**. Nothing here reads it, no case passes or
 * fails on how long it took, and this repository asserts cost comparatively — see the
 * cold-versus-warm ratio in `hosted-seed-at-rest.e2e.test.ts`.
 */
vi.setConfig({ testTimeout: 60_000 })

/**
 * The identity secret this spec's local `wrangler dev` boots with — AUTH-07 criterion 4.
 *
 * Since that criterion the hosted object refuses to open its identity without
 * `O2_IDENTITY_SECRET` and answers `GET /self` with `500`, so every spec that polls `/self`
 * for readiness has to supply one. There is deliberately no default in production source — a
 * default is the empty-DEK defect one criterion over — and no value in `wrangler.jsonc`,
 * which is tracked.
 *
 * **Per-spec test data rather than a shared constant**, in the style of this tree's `TEST_KEY`
 * and `TURN_SECRET`: this spec passes its own `--persist-to`, so its Durable Object store is
 * its own and the value only has to be self-consistent across its own restarts. The one thing
 * that IS load bearing is the length — under twenty characters `assertUsablePassphrase`
 * refuses and every boot below fails with `WeakPassphraseError`.
 */
const SECRET = 'local-dev-identity-secret-42'

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

    const first = await new HostedNode(storage, SECRET).identity()
    // A second object, not a second call: `HostedNode.identity` memoises, so asking the same
    // instance twice would assert the memo. Eviction and redeploy both destroy the instance
    // and keep the storage, and this is that.
    const second = await new HostedNode(storage, SECRET).identity()

    expect(second.peerId).toBe(first.peerId)
    expect(second.nodeKey).toBe(first.nodeKey)
    // All four encodings derive from the seed alone (`packages/libp2p/src/identity.ts`), so
    // the seed is the thing that had to survive and this is the reading that says it did.
    expect([...second.seed]).toEqual([...first.seed])

    // **Anti-vacuity, and it is not optional.** Without it every assertion above is satisfied
    // by an identity derived from a constant — a fixture that always minted the same seed, or
    // a derivation that ignored its input, would pass the three lines above and fail nothing.
    const elsewhere = await new HostedNode(new FakeDurableObjectStorage(), SECRET).identity()
    expect(elsewhere.peerId).not.toBe(first.peerId)
  })

  it('reads the seed back from the store rather than from anything the first node kept', async () => {
    const storage = new FakeDurableObjectStorage()
    const minted = await new HostedNode(storage, SECRET).identity()

    // Asked of a store built independently of either node, so the bytes are read out of the
    // platform surface and not out of a field. This is what makes "it persisted" a statement
    // about storage rather than about JavaScript.
    //
    // **REWRITTEN FOR AUTH-07 criterion 4, and the previous three lines are worth naming.**
    // They were `has(HOSTED_IDENTITY_KEY)` and `get(HOSTED_IDENTITY_KEY)` equalling the seed —
    // an assertion that the raw 32 bytes were sitting in this store, which is now exactly the
    // thing that must not be true. The claim they carried survives unchanged: the identity is
    // recoverable from the store alone. What changed is that the store is no longer sufficient
    // by itself, and this reads the envelope with the secret to say so.
    const store = new DoDatastore(storage)
    expect(await store.has(SEALED_HOSTED_IDENTITY_KEY)).toBe(true)
    const envelope: unknown = JSON.parse(new TextDecoder().decode(await store.get(SEALED_HOSTED_IDENTITY_KEY)))
    expect([...(await openSecret(envelope, SECRET))]).toEqual([...minted.seed])
    expect(minted.seed.length).toBe(SEED_BYTES)
  })

  it('refuses a stored seed of the wrong length instead of minting a second identity', async () => {
    const storage = new FakeDurableObjectStorage()

    // One byte short, and written before anything has sealed anything — a store left by a
    // pre-AUTH-07 build whose plaintext was truncated. The dangerous behaviour is not throwing
    // — it is SILENTLY minting a new identity, which drops the node out of every peer's
    // verified set and out of every bootstrap list naming it, with nothing reporting why.
    await new DoDatastore(storage).put(HOSTED_IDENTITY_KEY, new Uint8Array(SEED_BYTES - 1))

    await expect(new HostedNode(storage, SECRET).identity()).rejects.toThrow(MalformedStoredSeedError)
    // And the store still holds what was put there — the refusal did not overwrite it, nor
    // seal it, nor delete it, which is what makes the failure recoverable by a human rather
    // than by a redeploy.
    expect((await new DoDatastore(storage).get(HOSTED_IDENTITY_KEY)).length).toBe(SEED_BYTES - 1)
    // **The load-bearing half**: the refusal did not walk on into the mint arm behind it. A
    // sealed envelope here would mean a new identity had been created over a store that
    // already held one, which is the failure this case exists for and is invisible from the
    // rejection alone.
    expect(await new DoDatastore(storage).has(SEALED_HOSTED_IDENTITY_KEY)).toBe(false)
  })

  it('keeps the identity key out of both namespaces the store refuses', () => {
    // Asked of the production classifier rather than by comparing strings, so this cannot
    // drift from the rule `DoDatastore.put` actually applies. A seed key under a refused
    // prefix would make a deployed object unable to mint an identity at all — a failure that
    // arrives at first boot in production and nowhere earlier.
    expect(DoDatastore.refusedPrefixFor(HOSTED_IDENTITY_KEY)).toBeUndefined()
    // The sealed key too, and asked separately rather than inferred from the prefix they
    // share: `refusedPrefixFor` normalises before it classifies, so "it starts with the same
    // seven characters" is not the question it answers.
    expect(DoDatastore.refusedPrefixFor(SEALED_HOSTED_IDENTITY_KEY)).toBeUndefined()
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
    const node = new HostedNode(new FakeDurableObjectStorage(), SECRET)
    await expect(
      node.store.put(new Key(`${REFUSED_NAMESPACE.dhtDatastore}record/abc`), new Uint8Array(1)),
    ).rejects.toThrow()
  })
})

/**
 * One entry per platform call `spyNamespace()`'s fixture recorded, in the order they happened.
 *
 * A single ordered log rather than three separate counters, because two of Task 2's cases are
 * about ORDER — a jurisdiction narrowing applied after `idFromName` sites the object on the
 * wrong namespace while every unordered count still agrees — and order is only readable from
 * one shared sequence, never from three arrays counted separately.
 */
type SpyEvent =
  | { readonly kind: 'jurisdiction'; readonly value: DurableObjectJurisdiction }
  | { readonly kind: 'idFromName'; readonly name: string; readonly onNarrowed: boolean }
  | { readonly kind: 'get'; readonly options: HostedObjectGetOptions | undefined }

/** Narrows {@link SpyEvent} to its `jurisdiction` member, without a type assertion. */
function jurisdictionEvents(events: readonly SpyEvent[]): readonly Extract<SpyEvent, { kind: 'jurisdiction' }>[] {
  return events.filter((event): event is Extract<SpyEvent, { kind: 'jurisdiction' }> => event.kind === 'jurisdiction')
}

/** Narrows {@link SpyEvent} to its `idFromName` member, without a type assertion. */
function idFromNameEvents(events: readonly SpyEvent[]): readonly Extract<SpyEvent, { kind: 'idFromName' }>[] {
  return events.filter((event): event is Extract<SpyEvent, { kind: 'idFromName' }> => event.kind === 'idFromName')
}

/** Narrows {@link SpyEvent} to its `get` member, without a type assertion. */
function getEvents(events: readonly SpyEvent[]): readonly Extract<SpyEvent, { kind: 'get' }>[] {
  return events.filter((event): event is Extract<SpyEvent, { kind: 'get' }> => event.kind === 'get')
}

/**
 * The one and only element of an array already asserted to have exactly one — reading `[0]`
 * directly types as `T | undefined` under this repository's `noUncheckedIndexedAccess`, and
 * this repository forbids the non-null assertion that would silence it. Throwing rather than
 * returning `undefined` keeps every call site a plain value with no optional chaining needed.
 */
function theOneElementOf<T>(array: readonly T[]): T {
  const [first] = array
  if (first === undefined) throw new Error('expected exactly one recorded element, found none')
  return first
}

/**
 * **Anti-vacuity floor for the whole describe block below.** Incremented by every `idFromName`
 * any `spyNamespace()` fixture ever builds records, across every case in this file's run — not
 * reset between cases. A fixture that silently stopped recording would leave every assertion
 * above satisfied by an empty log; this is the number that says the log was not empty. Depends
 * on this file's cases running in declaration order, which is vitest's default (no `sequence`
 * or `shuffle` option is set anywhere in `vitest.config.ts`).
 */
let totalIdFromNameCallsAcrossThisFile = 0

describe('criteria 4 and 6 — one call site, and a closed set of names', () => {
  /**
   * Records what it was asked, so the assertion is about the call and not about the result.
   *
   * **Widened for Task 2** to record four things in one ordered log — every jurisdiction
   * narrowing, every `idFromName` call (naming whether it landed on the ORIGINAL namespace or
   * on a narrowed one), and every `get` call (naming the options it carried) — because `eu`,
   * `sam` and `us` are proved apart by recorded ORDER and BY WHICH NAMESPACE was asked, not
   * merely by presence. `asked` is kept as its own plain array beside `events` because the
   * pre-existing cases immediately below assert on it directly and widening it would be an
   * unrelated second fixture living beside this one — exactly what this file's own header
   * warns against.
   */
  function spyNamespace(): {
    readonly namespace: Parameters<typeof stubFor<string>>[0]
    readonly asked: string[]
    readonly events: readonly SpyEvent[]
  } {
    const asked: string[] = []
    const events: SpyEvent[] = []

    function makeNamespace(isNarrowed: boolean): Parameters<typeof stubFor<string>>[0] {
      return {
        idFromName: (name: string) => {
          asked.push(name)
          events.push({ kind: 'idFromName', name, onNarrowed: isNarrowed })
          totalIdFromNameCallsAcrossThisFile += 1
          return { name }
        },
        get: (id: unknown, options?: HostedObjectGetOptions) => {
          events.push({ kind: 'get', options })
          return `stub:${String((id as { name: string }).name)}`
        },
        jurisdiction: (jurisdiction: DurableObjectJurisdiction) => {
          events.push({ kind: 'jurisdiction', value: jurisdiction })
          return makeNamespace(true)
        },
      }
    }

    return { namespace: makeNamespace(false), asked, events }
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

  it('narrows the namespace to the eu jurisdiction before anything is sited, and sites on the narrowed namespace', () => {
    const { namespace, events } = spyNamespace()
    expect(stubFor(euJurisdictionOf(namespace), HOSTED_OBJECT_NAME.eu)).toBe('stub:bootstrap-eu')

    const narrowings = jurisdictionEvents(events)
    expect(narrowings.length).toBe(1)
    const narrowing = theOneElementOf(narrowings)
    expect(narrowing.value).toBe('eu')

    const sitings = idFromNameEvents(events)
    expect(sitings.length).toBe(1)
    const siting = theOneElementOf(sitings)
    expect(siting.name).toBe('bootstrap-eu')
    // On the NARROWED namespace, not the original — `euJurisdictionOf` returns a namespace and
    // siting must happen through what it returned, not through the argument it was given.
    expect(siting.onNarrowed).toBe(true)

    const sites = getEvents(events)
    expect(sites.length).toBe(1)
    expect(theOneElementOf(sites).options).toBeUndefined()

    // **Order, not merely presence.** A narrowing applied AFTER `idFromName` sites the object
    // on the wrong namespace while the three counts above still hold unchanged — so this is the
    // assertion that actually carries the claim in this case's name.
    const narrowedAt = events.indexOf(narrowing)
    const sitedAt = events.indexOf(siting)
    expect(narrowedAt).toBeLessThan(sitedAt)
  })

  it('sites the sam object on the plain namespace and carries a location hint, with no jurisdiction narrowing', () => {
    const { namespace, events } = spyNamespace()
    expect(stubFor(namespace, HOSTED_OBJECT_NAME.sam, samLocationHint())).toBe('stub:bootstrap-sam')

    expect(jurisdictionEvents(events).length).toBe(0)

    const sitings = idFromNameEvents(events)
    expect(sitings.length).toBe(1)
    const siting = theOneElementOf(sitings)
    expect(siting.name).toBe('bootstrap-sam')
    expect(siting.onNarrowed).toBe(false)

    const sites = getEvents(events)
    expect(sites.length).toBe(1)
    expect(theOneElementOf(sites).options).toEqual({ locationHint: 'sam' })
  })

  it('sites the us object on the plain namespace and carries neither a jurisdiction nor a hint', () => {
    // Written as its own case, beside the `eu` and `sam` cases above, rather than folded into a
    // loop over the three names — a loop over a placement descriptor is the exact shape HOST-06
    // names as the failure this file exists to avoid reproducing.
    const { namespace, events } = spyNamespace()
    expect(stubFor(namespace, HOSTED_OBJECT_NAME.us)).toBe('stub:bootstrap-us')

    expect(jurisdictionEvents(events).length).toBe(0)

    const sites = getEvents(events)
    expect(sites.length).toBe(1)
    expect(theOneElementOf(sites).options).toBeUndefined()
  })

  it('refuses a namespace with no jurisdiction method by name, before calling anything on it', () => {
    const namespaceWithNoJurisdictionMethod: Parameters<typeof stubFor<string>>[0] = {
      idFromName: (name: string) => ({ name }),
      get: (id: unknown) => `stub:${String((id as { name: string }).name)}`,
    }
    expect(() => euJurisdictionOf(namespaceWithNoJurisdictionMethod)).toThrow(UnsupportedJurisdictionError)
    expect(() => euJurisdictionOf(namespaceWithNoJurisdictionMethod)).toThrow(/"eu"/)
  })

  it('closes the location hint set at exactly one declared member', () => {
    // The literal `1`, never `Object.keys(HOSTED_LOCATION_HINT).length` — an assertion that
    // reuses the value it tests moves with it and can never redden against its own drift.
    expect(HOSTED_LOCATION_HINTS.length).toBe(1)
  })

  it('anti-vacuity: the declared name count is fixed at three, and the spy fixture actually recorded calls', () => {
    // The literal `3`, for the same reason the case above uses a literal `1`.
    expect(HOSTED_OBJECT_NAMES.length).toBe(3)
    // If `spyNamespace()`'s `idFromName` handler silently stopped recording, every assertion in
    // this describe block that reads `events` or `asked` would be reading an empty log and
    // passing vacuously. This fails that scenario instead of letting it through quietly.
    expect(totalIdFromNameCallsAcrossThisFile).toBeGreaterThan(0)
  })
})
