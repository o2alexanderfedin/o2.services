import { generateKeyPair } from '@libp2p/crypto/keys'
import { keychain } from '@libp2p/keychain'
import { defaultLogger } from '@libp2p/logger'
import { keychainProtectionFor } from '@o2/libp2p'
import type { KeychainProtection } from '@o2/libp2p'
import { openSecret } from '@o2/core'
import type { Datastore } from 'interface-datastore'
import { afterEach, describe, expect, it } from 'vitest'
import { FakeDurableObjectAlarms, FakeDurableObjectStorage } from './do-storage.fixture.ts'
import { HOSTED_IDENTITY_KEY, SEALED_HOSTED_IDENTITY_KEY } from './hosted-identity.ts'
import { createHostedFabric } from './hosted-libp2p.ts'
import type { HostedFabric } from './hosted-libp2p.ts'



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
 * AUTH-07 criterion 3, the hosted half — **the Durable Object's keychain writes under a real
 * DEK**, measured on the artefact rather than on the options object.
 *
 * Same instrument as `packages/node/src/keychain-dek.node.test.ts`: a key is written through
 * the **shipped** assembly and then read back by readers that differ only in the two fields
 * the criterion is about. Read that file's header for the two corrections this phase's own
 * proposal needed — chiefly that `pass` alone does *not* leave the DEK empty, because
 * `DEK_INIT.salt` is a non-null default, so a `DEK !== ''` assertion cannot see the salt half.
 *
 * ## What is proven here and what is explicitly NOT
 *
 * Proven: a keychain entry that leaves this object — a mis-scoped query, a partial dump — is
 * no longer readable by anyone who merely holds a copy of libp2p.
 *
 * ## AUTH-07 criterion 4 landed, and the third case below inverted
 *
 * **This file said, in this docblock and in a case that asserted it, that the gain here was
 * NIL against anyone who could read the object's storage** — because the DEK is derived from
 * the identity seed and `hosted-identity.ts` wrote that seed to `/identity/seed` in the clear,
 * in the very same storage. It said the limit would be removed by criterion 4, and that when
 * that landed *"this case must be updated rather than deleted"*.
 *
 * It has landed. The seed is now an `@o2/core` envelope at `/identity/sealed-seed`, opened
 * under a secret held in the platform's secret store, and the plaintext row is gone. The third
 * case is inverted rather than removed: it now asserts the absence, and it asserts it with a
 * positive control, because an absence with no positive control passes just as well on a store
 * nothing ever wrote to.
 *
 * **What is still NOT proven, and is claimed nowhere:** secrecy from the account holder. A
 * Durable Object cannot keep a secret from its own operator. What criterion 4 buys is a move
 * between compromise domains — from *whoever can read this object's storage* to *whoever holds
 * the Cloudflare account* — and `hosted-identity.ts`'s header states that limit in the
 * proposal's own words. The keychain's protection is an inheritance from the seed's, so it is
 * worth exactly what the seed's is worth and no more; that sentence was true before this
 * change and is true after it, and only the seed's own worth moved.
 */

const ANNOUNCE = ['/dns4/bootstrap.example/tcp/443/tls/ws']

let running: HostedFabric | undefined
afterEach(async () => {
  await running?.libp2p.stop()
  running = undefined
})

async function startHosted(): Promise<HostedFabric> {
  const fabric = await createHostedFabric({
    storage: new FakeDurableObjectStorage(),
    alarms: new FakeDurableObjectAlarms(),
    identitySecret: SECRET,
    announce: ANNOUNCE,
  })
  running = fabric
  return fabric
}

/** Whether a reader can open `name`, and the refusal text when it cannot. */
async function opens(datastore: Datastore, init: KeychainProtection | undefined, name: string): Promise<true | string> {
  try {
    await keychain(init)({ datastore, logger: defaultLogger() }).exportKey(name)
    return true
  } catch (error) {
    return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  }
}

/**
 * The keychain service the shipped assembly installed — narrowed, not cast, for the reason
 * `hosted-libp2p.node.test.ts` gives about `isPuttingDht`: `createHostedLibp2p` returns a
 * plain `Libp2p`, so `services` is `Record<string, unknown>`, and this tree does not permit
 * `as`. A guard also fails legibly if the assembly ever stops installing a keychain.
 */
interface WritableKeychain {
  importKey(name: string, key: unknown): Promise<unknown>
  exportKey(name: string): Promise<unknown>
}

function isWritableKeychain(service: unknown): service is WritableKeychain {
  return (
    typeof service === 'object' &&
    service !== null &&
    'importKey' in service &&
    typeof service.importKey === 'function' &&
    'exportKey' in service &&
    typeof service.exportKey === 'function'
  )
}

describe('AUTH-07 criterion 3 — the hosted tier keychain writes under a real DEK', () => {
  it('the artefact refuses an empty-DEK reader and opens for the one derived from this object’s seed', async () => {
    const fabric = await startHosted()
    const service = fabric.libp2p.services['keychain']
    if (!isWritableKeychain(service)) throw new Error('the hosted assembly installed no keychain service')

    // Written through the SHIPPED service, into the very store the assembly handed libp2p.
    await service.importKey('probe', await generateKeyPair('Ed25519'))

    const expected = await keychainProtectionFor(fabric.identity.seed)

    // **The refusing arm first, the control last** — the ordering is load bearing, for the
    // reason the node-tier spec records: with the control first, a bare-`keychain()` plant
    // reddens on the control and short-circuits, so the arm that names the defect never
    // evaluates and there is no evidence it can fail. Measured here too, on that plant.

    // The criterion's own reader — `keychain()` with no arguments, which derives the empty
    // string and is exactly what this file shipped before.
    expect(await opens(fabric.datastore, undefined, 'probe')).not.toBe(true)

    // The positive control, and it is not optional: without it the refusal above could be a
    // store that was never written to rather than one written under a real DEK.
    expect(await opens(fabric.datastore, expected, 'probe')).toBe(true)
  })

  it('nothing in the shipped hosted assembly writes to the keychain, so there are no stale entries to sweep', async () => {
    // The node tier needs a sweep because AutoTLS left entries behind under the empty DEK.
    // The hosted tier needs none, and this is that claim rather than an assumption: the only
    // two keychain writers in the dependency tree are `@ipshipyard/libp2p-auto-tls` and
    // `@libp2p/webrtc`'s webRTC-Direct, and this assembly installs neither — its transports
    // are `webSockets()` and `circuitRelayTransport()`.
    //
    // If that ever changes, this case goes red and whoever changed it has to decide what to
    // do about the entries a previously-deployed object is already holding.
    const fabric = await startHosted()
    const held: string[] = []
    for await (const entry of fabric.datastore.query({})) {
      const key = entry.key.toString()
      // `@libp2p/keychain`'s own two namespaces — `/pkcs8/<name>` holds the encrypted key and
      // `/info/<name>` the plaintext descriptor.
      if (key.startsWith('/pkcs8/') || key.startsWith('/info/')) held.push(key)
    }
    expect(held).toEqual([])
  })

  it('the seed the DEK is derived from is itself sealed, so the inheritance is worth something', async () => {
    // **THIS CASE WAS INVERTED WHEN AUTH-07 CRITERION 4 LANDED, exactly as it said it would
    // be.** It asserted a WEAKNESS — `get(HOSTED_IDENTITY_KEY)` equalling the live seed — and
    // its own comment said criterion 4 was what removed it and that it must then be updated
    // rather than deleted. It is the record that the hosted keychain's protection is an
    // INHERITANCE from the seed's, so it is worth exactly what the seed's is worth and no
    // more. That sentence has not changed; the seed's worth has.
    const fabric = await startHosted()

    // The absence. `HOSTED_IDENTITY_KEY` is `/identity/seed` — the row a pre-AUTH-07 build
    // wrote 32 raw bytes to — reached through the same store the object uses, so this is the
    // real artefact and not a re-derivation.
    expect(await fabric.datastore.has(HOSTED_IDENTITY_KEY)).toBe(false)

    // **The positive control, and it is not optional**: an absence with no control passes just
    // as well on an empty store. The envelope IS there, at the other key, and it opens under
    // the secret to the very seed this node is running as — so the store was written, the
    // instrument can see what it holds, and what it holds is ciphertext.
    const envelope: unknown = JSON.parse(
      new TextDecoder().decode(await fabric.datastore.get(SEALED_HOSTED_IDENTITY_KEY)),
    )
    expect([...(await openSecret(envelope, SECRET))]).toEqual([...fabric.identity.seed])
  })
})
