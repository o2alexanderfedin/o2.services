import { generateKeyPair } from '@libp2p/crypto/keys'
import { keychain } from '@libp2p/keychain'
import { defaultLogger } from '@libp2p/logger'
import { keychainProtectionFor } from '@o2/libp2p'
import type { KeychainProtection } from '@o2/libp2p'
import type { Datastore } from 'interface-datastore'
import { afterEach, describe, expect, it } from 'vitest'
import { FakeDurableObjectAlarms, FakeDurableObjectStorage } from './do-storage.fixture.ts'
import { HOSTED_IDENTITY_KEY } from './hosted-identity.ts'
import { createHostedFabric } from './hosted-libp2p.ts'
import type { HostedFabric } from './hosted-libp2p.ts'

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
 * **Not proven, and not claimed anywhere**: secrecy from someone who can read this object's
 * storage. The DEK is derived from the identity seed and `hosted-identity.ts` still writes
 * that seed to `/identity/seed` in the clear, in the very same storage. Against that adversary
 * the gain is nil. Making the DEK independent of stored material is **criterion 4** — sealing
 * the seed under a platform secret — and it is not done here. The one case below that names
 * the plaintext seed exists so that this limit is a measured fact in the suite rather than a
 * sentence in a comment that could quietly stop being true.
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

  it('the honest limit: the seed the DEK is derived from is still in this object’s storage in the clear', async () => {
    // **This case asserts a WEAKNESS, deliberately.** Criterion 4 is what removes it, and
    // when it lands this case must be updated rather than deleted — it is the record that the
    // hosted keychain's protection is an inheritance from the seed, so it is worth exactly
    // what the seed's own protection is worth and no more. A comment saying so could rot;
    // this cannot.
    const fabric = await startHosted()
    // `HOSTED_IDENTITY_KEY` is `/identity/seed`; reached through the same store the object
    // uses, so this is the real artefact and not a re-derivation.
    const stored = await fabric.datastore.get(HOSTED_IDENTITY_KEY)
    expect(stored).toEqual(fabric.identity.seed)
  })
})
