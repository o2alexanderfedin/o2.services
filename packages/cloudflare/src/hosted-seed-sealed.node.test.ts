/**
 * AUTH-07 criterion 4 — **the hosted tier's seed is sealed under a secret held in the
 * platform's secret store, and the object's own storage no longer contains the raw seed.**
 *
 * ## The claim, at its true size
 *
 * The criterion states its own limit and this file is held to it: *"The claim is a move
 * between compromise domains and not secrecy from the account holder — a Durable Object cannot
 * keep a secret from its own operator, and any surface that says otherwise fails this
 * criterion."* No case name, comment or assertion below claims that the account holder cannot
 * read this seed. What moves is **who** has to be compromised: before, whoever could read this
 * object's storage; after, whoever holds the Cloudflare account. Those are different
 * compromise domains and moving between them is the whole gain.
 *
 * ## The three properties, and which case carries each
 *
 * 1. **No raw seed in the store** — `holds no row carrying the raw seed…`, with a positive
 *    control in the same run: the pre-change write, made by hand, found by the same scanner.
 *    An absence with no positive control passes just as well on an empty store, and this
 *    repository has closed a criterion on an empty read once already and had to reopen it.
 * 2. **The deployed identity survives the migration** — `migrates a plaintext seed…`. A raw
 *    seed is planted, the object is booted, and the identity that comes up is the one the
 *    planted seed implies. That is the reading that says the object which has answered on one
 *    PeerId since 2026-08-27 is still that object after this change.
 * 3. **An absent secret refuses by name and mints nothing** — the whole `fail closed` block.
 *    This is the hazard: a first boot after a deploy where the secret was never set, a typo in
 *    the binding, a rename. Under a naive `loadOrCreate` every one of those is a fresh seed, a
 *    new PeerId, and a bootstrap node that has quietly become somebody else. Phase 42's
 *    criterion 4 is the same property one tier over.
 *
 * ## Two instrument rules this file is built to, both paid for by this repository
 *
 * **Nothing renders bytes through `String`.** `Buffer.from(String(u8))` turns a `Uint8Array`
 * into the text `255,15,66,…` and blinded an instrument here once already, so
 * {@link rowsCarrying} compares byte against byte and never builds a string from a value.
 *
 * **Every absence carries a positive control in the same run**, and the refusing arm is
 * asserted BEFORE the control wherever both are in one case — `43-KEYCHAIN.md` §5.1 measured
 * the subtler failure two days ago: with the control first, a plant reddens on the control and
 * short-circuits, so the arm that names the defect never evaluates and there is no evidence it
 * could fail at all.
 *
 * The same three properties are measured against a real `workerd` and a real SQLite store in
 * `hosted-seed-at-rest.e2e.test.ts`. This file is where the plants were watched red, because a
 * plant wants a spec that runs in seconds.
 */

import { describe, expect, it } from 'vitest'
import { Key } from 'interface-datastore'
import { SEED_BYTES, WeakPassphraseError, identityFromSeed } from '@o2/libp2p'
import { openSecret, sealSecret } from '@o2/core'
import { DoDatastore } from './do-datastore.ts'
import { FakeDurableObjectAlarms, FakeDurableObjectStorage } from './do-storage.fixture.ts'
import {
  HOSTED_IDENTITY_KEY,
  HOSTED_IDENTITY_REFUSALS,
  HOSTED_IDENTITY_SECRET_BINDING,
  HostedIdentitySecretMissingError,
  MalformedStoredSeedError,
  SEALED_HOSTED_IDENTITY_KEY,
  SealedHostedIdentityUnlockError,
  hostedIdentityProtection,
  hostedIdentityRefusal,
  loadOrCreateHostedSeed,
} from './hosted-identity.ts'
import type { HostedSeedStore } from './hosted-identity.ts'
import { HostedNode } from './hosted-object.ts'
import { BootstrapObject } from './worker.ts'
import type { HostedEnv, HostedObjectStateWithSockets } from './worker.ts'
import type { CloudflareWebSocket } from './websocket-connection.ts'



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

/** A seed nobody generated, so a match against it can only have come from this file. */
const PLANTED_SEED = new Uint8Array(SEED_BYTES)
for (let i = 0; i < SEED_BYTES; i++) PLANTED_SEED[i] = (i * 7 + 3) & 0xff

/**
 * Every key in `store` whose value carries `needle` as a contiguous run of bytes.
 *
 * **Byte against byte, and never through a string.** A `Uint8Array` handed to `String` renders
 * as `255,15,66,…`, so a scanner that searched the rendered text would be looking for the
 * wrong thing and would report an absence it never tested for. That defect blinded an
 * instrument in this repository once already and is named in `CLAUDE.md`.
 *
 * It searches the whole value rather than comparing whole values, because the question is not
 * *"is this row exactly the seed?"* but *"can the seed be lifted out of anything this store
 * holds?"* — a wrapper, a JSON field, a serialised record all answer yes to the second and no
 * to the first.
 */
async function rowsCarrying(store: DoDatastore, needle: Uint8Array): Promise<string[]> {
  const found: string[] = []
  for await (const entry of store.query({})) {
    if (carries(entry.value, needle)) found.push(entry.key.toString())
  }
  return found.sort()
}

function carries(haystack: Uint8Array, needle: Uint8Array): boolean {
  if (needle.length === 0 || haystack.length < needle.length) return false
  outer: for (let start = 0; start <= haystack.length - needle.length; start++) {
    for (let i = 0; i < needle.length; i++) {
      if (haystack[start + i] !== needle[i]) continue outer
    }
    return true
  }
  return false
}

/**
 * The Durable Object state `BootstrapObject` takes — the same shape `worker.test.ts`'s
 * `newState` builds, and for its reason: the real `state.storage` carries the storage and the
 * alarm APIs together, and the two fixtures are declared apart so `DoDatastore`'s fake is not
 * made to arm alarms it never touches.
 *
 * No sockets are accepted or read on any path below; `GET /self` opens none.
 */
function stateFor(storage: FakeDurableObjectStorage): HostedObjectStateWithSockets {
  return {
    storage: Object.assign(storage, new FakeDurableObjectAlarms()) as HostedObjectStateWithSockets['storage'],
    acceptWebSocket: (): void => undefined,
    getWebSockets: (): readonly CloudflareWebSocket[] => [],
  }
}

function envWith(secret: string | undefined): HostedEnv {
  return {
    BOOTSTRAP: undefined as unknown as HostedEnv['BOOTSTRAP'],
    ...(secret === undefined ? {} : { O2_IDENTITY_SECRET: secret }),
  }
}

describe('AUTH-07 criterion 4 — the object’s storage no longer contains the raw seed', () => {
  it('holds no row carrying the raw seed after a boot, and the same scanner finds one when it is there', async () => {
    const storage = new FakeDurableObjectStorage()
    const identity = await new HostedNode(storage, SECRET).identity()
    const store = new DoDatastore(storage)

    // **The assertion, and it is about the whole store rather than about one key.** Asking
    // `has(HOSTED_IDENTITY_KEY)` would only say the old row is gone; this says no row anywhere
    // in this object's storage carries those 32 bytes, which is what the criterion's words
    // actually require.
    expect(await rowsCarrying(store, identity.seed)).toEqual([])

    // **The positive control, in the same run, and it is not optional.** This is exactly what
    // the pre-change `loadOrCreateHostedSeed` did — `store.put(HOSTED_IDENTITY_KEY, seed)`,
    // one line, no envelope — and the same scanner run over the result finds it. Without this,
    // the emptiness above is satisfied by a scanner that can see nothing at all, and by a
    // store nobody ever wrote to.
    const before = new DoDatastore(new FakeDurableObjectStorage())
    await before.put(HOSTED_IDENTITY_KEY, identity.seed)
    expect(await rowsCarrying(before, identity.seed)).toEqual([HOSTED_IDENTITY_KEY.toString()])
  })

  it('put an envelope where the plaintext was, and the envelope opens to the identity it is running as', async () => {
    const storage = new FakeDurableObjectStorage()
    const identity = await new HostedNode(storage, SECRET).identity()
    const store = new DoDatastore(storage)

    expect(await store.has(HOSTED_IDENTITY_KEY)).toBe(false)
    expect(await store.has(SEALED_HOSTED_IDENTITY_KEY)).toBe(true)

    // Opened through `@o2/core`'s own reader rather than by inspecting fields, because what
    // matters is that this is a real envelope of the shipped format and not a value that
    // merely looks unlike a seed. A base64 blob of zeroes would pass a shape check.
    const envelope: unknown = JSON.parse(new TextDecoder().decode(await store.get(SEALED_HOSTED_IDENTITY_KEY)))
    expect([...(await openSecret(envelope, SECRET))]).toEqual([...identity.seed])
  })
})

describe('AUTH-07 criterion 4 — the migration keeps the identity the fabric already knows', () => {
  it('migrates a plaintext seed to an envelope and comes up as the node that seed implies', async () => {
    const storage = new FakeDurableObjectStorage()
    // A store as a pre-AUTH-07 build left it: 32 raw bytes under `/identity/seed`. The
    // deployed object at `o2-bootstrap.af-4a0.workers.dev` is in exactly this state.
    await new DoDatastore(storage).put(HOSTED_IDENTITY_KEY, PLANTED_SEED)

    const identity = await new HostedNode(storage, SECRET).identity()

    // **The reading that says the deployed node survives.** Not "some identity came up" and
    // not "it is stable across a restart" — that the PeerId is the one the PLANTED seed
    // implies, computed independently by the same pure function the fabric uses.
    expect(identity.peerId).toBe((await identityFromSeed(PLANTED_SEED)).peerId)
    expect([...identity.seed]).toEqual([...PLANTED_SEED])

    const store = new DoDatastore(storage)
    expect(await store.has(HOSTED_IDENTITY_KEY)).toBe(false)
    expect(await rowsCarrying(store, PLANTED_SEED)).toEqual([])

    // And a second construction over the migrated store is the same node again — the
    // criterion-2 property, re-asserted on the far side of the migration because that is the
    // boundary at which it could have been lost.
    expect((await new HostedNode(storage, SECRET).identity()).peerId).toBe(identity.peerId)
  })

  it('keeps the plaintext when the envelope it just wrote cannot be read back — the write order, measured', async () => {
    // **This is the ordering claim itself, and it is the reason the order is what it is.**
    // `packages/node/src/identity-store.ts:209-213`: *"Unlinking before the envelope is proven
    // readable turns a full disk — or any defect in the sealing path — into a destroyed
    // identity. The verification read is not belt-and-braces; it is the thing that makes the
    // unlink safe."* A store whose sealing write silently vanishes is that defect, and the
    // only outcome that is not a destroyed identity is: refuse, and leave the plaintext.
    const storage = new FakeDurableObjectStorage()
    const inner = new DoDatastore(storage)
    await inner.put(HOSTED_IDENTITY_KEY, PLANTED_SEED)

    await expect(loadOrCreateHostedSeed(new DroppingWrites(inner, SEALED_HOSTED_IDENTITY_KEY), SECRET)).rejects.toThrow(
      SealedHostedIdentityUnlockError,
    )

    // The identity is still recoverable — which is the whole point of refusing rather than
    // proceeding. A build that deleted first would leave this store holding nothing at all.
    expect([...(await inner.get(HOSTED_IDENTITY_KEY))]).toEqual([...PLANTED_SEED])
  })

  it('refuses a sealed envelope that opens to the wrong number of bytes rather than adopting it', async () => {
    const storage = new FakeDurableObjectStorage()
    const store = new DoDatastore(storage)
    // A well-formed envelope of the right format sealed over the WRONG payload — what an older
    // build with a different seed width would have left. It decrypts cleanly, so only the
    // post-decryption length check can catch it.
    const wrong = await sealSecret(new Uint8Array(SEED_BYTES + 1), SECRET)
    await store.put(SEALED_HOSTED_IDENTITY_KEY, new TextEncoder().encode(JSON.stringify(wrong)))

    await expect(loadOrCreateHostedSeed(store, SECRET)).rejects.toThrow(MalformedStoredSeedError)
  })
})

describe('AUTH-07 criterion 4 — fail closed: an absent secret refuses by name and mints nothing', () => {
  it('refuses an empty store by name and leaves it empty, so no identity was created', async () => {
    const storage = new FakeDurableObjectStorage()
    const store = new DoDatastore(storage)

    await expect(loadOrCreateHostedSeed(store, undefined)).rejects.toThrow(HostedIdentitySecretMissingError)

    // **The load-bearing half, and the one the criterion is actually about.** A rejection says
    // this call failed; it says nothing about whether a seed was created on the way. An
    // identity minted and then refused is still an identity, and on a redeploy it is the one
    // that answers. The store must hold NOTHING.
    const keys: string[] = []
    for await (const entry of store.query({})) keys.push(entry.key.toString())
    expect(keys).toEqual([])
  })

  it('names the binding an operator has to set, so the refusal is actionable rather than only correct', async () => {
    // A refusal that says "misconfigured" sends an operator reading source. This one says which
    // binding and which command, and the string is asserted against the constant the code reads
    // by, so the runbook, the message and the lookup cannot drift apart.
    const refusal = await loadOrCreateHostedSeed(new DoDatastore(new FakeDurableObjectStorage()), undefined).catch(
      (cause: unknown) => cause,
    )
    expect(refusal).toBeInstanceOf(HostedIdentitySecretMissingError)
    expect(String(refusal)).toContain(HOSTED_IDENTITY_SECRET_BINDING)
    expect(String(refusal)).toContain('wrangler secret put')
    expect(HOSTED_IDENTITY_SECRET_BINDING).toBe('O2_IDENTITY_SECRET')
  })

  it('refuses without touching a store that already holds an identity, and never mints beside it', async () => {
    const storage = new FakeDurableObjectStorage()
    const kept = await new HostedNode(storage, SECRET).identity()
    const store = new DoDatastore(storage)
    const envelopeBefore = await store.get(SEALED_HOSTED_IDENTITY_KEY)

    await expect(loadOrCreateHostedSeed(store, undefined)).rejects.toThrow(HostedIdentitySecretMissingError)

    // Byte-identical, so the refusal neither re-sealed nor replaced it. Re-sealing would be
    // harmless; replacing would be the disaster, and only a byte comparison tells them apart.
    expect([...(await store.get(SEALED_HOSTED_IDENTITY_KEY))]).toEqual([...envelopeBefore])
    // And the secret still opens the object that was there all along.
    expect((await new HostedNode(storage, SECRET).identity()).peerId).toBe(kept.peerId)
  })

  it('refuses a wrong secret by a name that admits it cannot tell a typo from tampering', async () => {
    const storage = new FakeDurableObjectStorage()
    const kept = await new HostedNode(storage, SECRET).identity()

    await expect(loadOrCreateHostedSeed(new DoDatastore(storage), `${SECRET}-not-the-one`)).rejects.toThrow(
      SealedHostedIdentityUnlockError,
    )

    // No second identity was minted beside the first, and the first still opens. This is the
    // property Phase 42 criterion 4 names one tier over: *a wrong passphrase produces a refusal
    // that names itself, and never a freshly minted identity.*
    expect((await new HostedNode(storage, SECRET).identity()).peerId).toBe(kept.peerId)
  })

  it('refuses a secret under the shared floor before deriving anything, and by the shared vocabulary’s name', async () => {
    // Nineteen characters — one under `PASSPHRASE_MIN_LENGTH`. The refusal is
    // `@o2/libp2p`'s `WeakPassphraseError` and not a name this tier invented, because this tier
    // speaks the vocabulary `identity-protection.ts` exists to keep to one.
    expect(() => hostedIdentityProtection('x'.repeat(19))).toThrow(WeakPassphraseError)
    expect(hostedIdentityProtection('x'.repeat(20)).kind).toBe('passphrase')
    // An empty string is absence, not a zero-length passphrase: `wrangler`'s own `--var NAME:`
    // produces one, and an operator who typed the binding with no value configured nothing.
    expect(() => hostedIdentityProtection('')).toThrow(HostedIdentitySecretMissingError)
    expect(() => hostedIdentityProtection(undefined)).toThrow(HostedIdentitySecretMissingError)
  })

  it('declares exactly the four refusals a deployment can be told about, each by its own class’s name', () => {
    // Written out as literals in the source and checked against the classes here, rather than
    // derived from them — deriving would make the two agree by construction and prove nothing,
    // while this makes a fifth refusal a red test instead of a silent widening.
    expect(HOSTED_IDENTITY_REFUSALS.length).toBe(4)
    expect([...HOSTED_IDENTITY_REFUSALS].sort()).toEqual([
      'HostedIdentitySecretMissingError',
      'MalformedStoredSeedError',
      'SealedHostedIdentityUnlockError',
      'WeakPassphraseError',
    ])
    for (const error of [
      new HostedIdentitySecretMissingError(),
      new MalformedStoredSeedError(HOSTED_IDENTITY_KEY, 0),
      new SealedHostedIdentityUnlockError(new Error('why')),
      new WeakPassphraseError(1),
    ]) {
      expect(HOSTED_IDENTITY_REFUSALS).toContain(error.name)
    }
    // A defect must NOT be dressed as configuration — an operator told to check a binding they
    // already set will check it twice before looking anywhere else.
    expect(hostedIdentityRefusal(new TypeError('undefined is not a function'))).toBeNull()
    expect(hostedIdentityRefusal('a string')).toBeNull()
  })
})

describe('AUTH-07 criterion 4 — the deployment says so, on the one route this object serves', () => {
  it('answers GET /self with 500 naming the refusal when no secret is bound, rather than a new PeerId', async () => {
    const storage = new FakeDurableObjectStorage()
    const object = new BootstrapObject(stateFor(storage), envWith(undefined))

    const response = await object.fetch(new Request('https://bootstrap.example/self'))
    expect(response.status).toBe(500)
    // The name, so an operator reading a log knows which of the four it is. `turn-not-configured`
    // is the precedent: a deployment that is not configured should say so, not look broken.
    expect(await response.text()).toContain('HostedIdentitySecretMissingError')

    // **And nothing was created while answering.** A 500 that had already minted a seed would
    // be the worst of both: the operator sets the binding, the object comes up, and it comes up
    // as somebody else.
    const keys: string[] = []
    for await (const entry of new DoDatastore(storage).query({})) keys.push(entry.key.toString())
    expect(keys).toEqual([])
  })

  it('answers the same object with a PeerId once the binding is set, so the refusal was recoverable', async () => {
    const storage = new FakeDurableObjectStorage()
    // The order matters: refused first, configured second, over ONE storage. That is the
    // operator's actual repair — set the secret on a Worker that has been refusing — and the
    // claim is that it costs nothing.
    expect((await new BootstrapObject(stateFor(storage), envWith(undefined)).fetch(selfRequest())).status).toBe(500)

    const healed = await new BootstrapObject(stateFor(storage), envWith(SECRET)).fetch(selfRequest())
    expect(healed.status).toBe(200)
    const reading: unknown = await healed.json()
    expect(isSelfReading(reading)).toBe(true)

    // Same object, still the same node on the next construction.
    const again = await new BootstrapObject(stateFor(storage), envWith(SECRET)).fetch(selfRequest())
    const second: unknown = await again.json()
    expect(isSelfReading(reading) && isSelfReading(second) && second.peerId).toBe(
      isSelfReading(reading) ? reading.peerId : 'unreadable',
    )
  })
})

function selfRequest(): Request {
  return new Request('https://bootstrap.example/self')
}

function isSelfReading(value: unknown): value is { peerId: string } {
  return typeof value === 'object' && value !== null && 'peerId' in value && typeof value.peerId === 'string'
}

/**
 * A store whose `put` of one chosen key silently does nothing.
 *
 * **A complete implementation of {@link HostedSeedStore}, not a partial one behind a cast** —
 * which is why that type is four methods wide. It models the one defect the migration's write
 * order exists to survive: a sealing write that reports success and leaves nothing behind.
 * Returning the key rather than throwing is the point; a `put` that threw would be caught by
 * any ordering.
 */
class DroppingWrites implements HostedSeedStore {
  readonly #inner: DoDatastore
  readonly #dropped: string

  constructor(inner: DoDatastore, dropped: Key) {
    this.#inner = inner
    this.#dropped = dropped.toString()
  }

  async has(key: Key): Promise<boolean> {
    return await this.#inner.has(key)
  }

  async get(key: Key): Promise<Uint8Array> {
    return await this.#inner.get(key)
  }

  async put(key: Key, value: Uint8Array): Promise<Key> {
    if (key.toString() === this.#dropped) return key
    return await this.#inner.put(key, value)
  }

  async delete(key: Key): Promise<void> {
    await this.#inner.delete(key)
  }
}
