// `@peculiar/x509` reaches its crypto provider through tsyringe, which needs the
// `Reflect.metadata` polyfill installed before any of its decorators evaluate. Import order
// is the contract: below the other imports this throws at module load. AutoTLS pulls that
// package in, and this file starts a node with AutoTLS configured.
import 'reflect-metadata'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { generateKeyPair } from '@libp2p/crypto/keys'
import { keychain } from '@libp2p/keychain'
import { defaultLogger } from '@libp2p/logger'
import {
  KEYCHAIN_DEK_HASH,
  KEYCHAIN_DEK_ITERATIONS,
  KEYCHAIN_DEK_KEY_LENGTH,
  keychainProtectionFor,
} from '@o2/libp2p'
import type { KeychainProtection } from '@o2/libp2p'
import { MemoryDatastore } from 'datastore-core'
import type { Datastore } from 'interface-datastore'
import { afterEach, describe, expect, it } from 'vitest'
import { FabricNode } from './fabric-node.ts'
import { IDENTITY_FILE, SEALED_IDENTITY_FILE, loadOrCreateSealedSeed } from './identity-store.ts'

/**
 * AUTH-07 criterion 3 — **the libp2p keychain derives a real DEK**, measured on the artefact
 * it writes rather than on the options object it was handed.
 *
 * ## Why the artefact and not the options
 *
 * The criterion is worded against a specific failure: *"a test asserts the derived DEK is not
 * `''` rather than asserting the options object was passed, because the options object was
 * always passable and the defect is that it did nothing."* `@libp2p/keychain` keeps its DEK
 * in a module-private `WeakMap` (`privates.set(this, { dek })`), so it cannot be read
 * directly — and that is the useful constraint. Every case below writes a key **through the
 * shipped assembly** and then interrogates the bytes that landed in the datastore.
 *
 * ## Two corrections this file records, both measured 2026-09-06 before anything was changed
 *
 * **1. `pass` alone does NOT leave the DEK empty**, contrary to the phase proposal and to the
 * roadmap criterion, which both say *"either alone leaves the empty string"*. The constructor
 * spreads `dek: { ...DEK_INIT, ...init.dek }` and `DEK_INIT.salt` is a non-null hardcoded
 * default, so `dek?.salt != null` is always true and the condition reduces to `pass != null`.
 * The three-way probe: no args **opened** under an empty-DEK reader, `pass` alone **refused**,
 * `pass` + salt **refused**.
 *
 * **2. The salt is still mandatory, for a different defect** — left unset every libp2p
 * deployment shares one PBKDF2 salt, so attacking one keychain is reusable against all of
 * them. A test that only pins `DEK !== ''` cannot see that half at all, which is why
 * {@link describe}'s matrix has a separate arm for it and why that arm is the one a
 * salt-only plant reddens.
 *
 * ## The matrix is comparative and carries its own positive control
 *
 * Four readers are run against **one** artefact in **one** run. Three must refuse and the
 * fourth must succeed. Without the fourth, three refusals prove nothing — a store that was
 * never written to refuses every reader just as well. The refusing three are asserted
 * **before** the control, so that a plant reddens on the arm that names its defect rather
 * than short-circuiting on the control; see the comment at the arms themselves.
 */

const PASSPHRASE = 'a-node-identity-passphrase-well-over-twenty'

/** The salt `@libp2p/keychain` uses when a caller supplies none — `DEK_INIT.salt`. */
const LIBRARY_DEFAULT_SALT = 'you should override this value with a crypto secure random number'

const dirs: string[] = []
const started: FabricNode[] = []

afterEach(async () => {
  for (const node of started.splice(0)) await node.stop()
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true })
})

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'o2-keychain-dek-'))
  dirs.push(dir)
  return dir
}

/**
 * A keychain over someone else's store.
 *
 * This is the instrument: the *reader* varies while the artefact stays fixed, so every case
 * below is a statement about what the shipped writer produced.
 */
function readerOver(
  datastore: Datastore,
  init?: KeychainProtection,
): {
  exportKey(name: string): Promise<unknown>
  importKey(name: string, key: unknown): Promise<unknown>
} {
  return keychain(init)({ datastore, logger: defaultLogger() })
}

/**
 * A reader built from a passphrase and a salt, with the other three PBKDF2 parameters left at
 * the values the shipped derivation uses.
 *
 * Only `pass` and `salt` vary across the matrix because they are the only two the criterion is
 * about; holding `hash`/`iterationCount`/`keyLength` fixed is what makes a refusal attributable
 * to the thing that changed.
 */
function readerWith(pass: string, salt: string): KeychainProtection {
  return {
    pass,
    dek: {
      salt,
      hash: KEYCHAIN_DEK_HASH,
      iterationCount: KEYCHAIN_DEK_ITERATIONS,
      keyLength: KEYCHAIN_DEK_KEY_LENGTH,
    },
  }
}

/** Whether a reader can open `name`, and the refusal text when it cannot. */
async function opens(datastore: Datastore, init: KeychainProtection | undefined, name: string): Promise<true | string> {
  try {
    await readerOver(datastore, init).exportKey(name)
    return true
  } catch (error) {
    return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  }
}

/**
 * The keychain service the shipped node installed — narrowed, not cast.
 *
 * `FabricNode.libp2p` types `services` loosely, and this tree does not permit `as`. A guard
 * also fails legibly if the assembly ever stops installing a keychain, which is the very
 * regression a cast would sail past.
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

interface Rig {
  readonly node: FabricNode
  readonly datastore: MemoryDatastore
  /** The options the shipped node should have derived — recomputed here from its own seed. */
  readonly expected: KeychainProtection
  readonly keychain: WritableKeychain
}

/**
 * Start the **shipped** node with AutoTLS configured, which is the only condition under which
 * the node tier installs a keychain at all (`fabric-node.ts` spreads it on `options.autoTls`).
 *
 * No ACME server is started and none is needed: the keychain is constructed when libp2p is,
 * while provisioning waits on a public announced address this node never declares. The
 * unreachable directory URL is never dialled.
 */
async function startRig(datastore?: MemoryDatastore): Promise<Rig> {
  const dir = await tempDir()
  const store = datastore ?? new MemoryDatastore()
  const node = await FabricNode.start({
    trustAnchors: 'runs-unsigned-artifacts',
    relayAdmission: 'admits-any-peer',
    startReporting: 'reports-its-own-start',
    listen: ['/ip4/127.0.0.1/tcp/0'],
    blockstoreDir: dir,
    identityProtection: { kind: 'passphrase', passphrase: PASSPHRASE },
    datastore: store,
    autoTls: { acmeDirectory: 'http://127.0.0.1:1/directory' },
  })
  started.push(node)

  // Read the node's own seed back through the shipped store, rather than inventing one — so
  // `expected` is derived from the same bytes the node derived from and a mismatch is a real
  // disagreement rather than a fixture error.
  const held = await loadOrCreateSealedSeed(dir, SEALED_IDENTITY_FILE, IDENTITY_FILE, {
    kind: 'passphrase',
    passphrase: PASSPHRASE,
  })
  const expected = await keychainProtectionFor(held.seed)

  const service = node.libp2p.services['keychain']
  if (!isWritableKeychain(service)) throw new Error('the node tier installed no keychain service')
  return { node, datastore: store, expected, keychain: service }
}

describe('AUTH-07 criterion 3 — the node tier keychain writes under a real DEK', () => {
  it(
    'the artefact refuses an empty-DEK reader, a default-salt reader and a wrong-pass reader, and opens for the derived one',
    async () => {
      const rig = await startRig()
      // Written through the SHIPPED keychain service, so every assertion below is about the
      // assembly rather than about a keychain this test constructed.
      await rig.keychain.importKey('probe', await generateKeyPair('Ed25519'))

      // **The refusing arms come FIRST and the control comes LAST, and the order is load
      // bearing.** Written the other way round — control first — every plant reddens on the
      // control and short-circuits, so arms A and B never evaluate and there is no evidence
      // they can fail at all. Measured: with the control first, a bare-`keychain()` plant and
      // a salt-only plant both failed at the control line and neither arm was ever reached.
      // Ordered this way each arm is the assertion that speaks for the defect it names.

      // Arm A — the empty DEK. `keychain()` with no arguments is exactly what this
      // repository shipped, and it is the reader the criterion names.
      expect(await opens(rig.datastore, undefined, 'probe')).not.toBe(true)

      // Arm B — the right passphrase over the library's global default salt. This is the
      // half a `DEK !== ''` assertion cannot see, and the half a salt-only plant reddens.
      expect(
        await opens(rig.datastore, readerWith(rig.expected.pass, LIBRARY_DEFAULT_SALT), 'probe'),
      ).not.toBe(true)

      // Arm C — this node's own salt under a different passphrase.
      expect(
        await opens(rig.datastore, readerWith('a-different-passphrase-over-twenty-chars', rig.expected.dek.salt), 'probe'),
      ).not.toBe(true)

      // Arm D — the positive control, and it is not optional. Three refusals prove nothing on
      // their own: a store that was never written to refuses every reader just as well. This
      // is what makes the three above statements about a real artefact.
      expect(await opens(rig.datastore, rig.expected, 'probe')).toBe(true)
    },
    60_000,
  )

  it('the derived pass and salt differ from each other and clear the library floors by construction', async () => {
    const derived = await keychainProtectionFor(new Uint8Array(32).fill(7))

    // 20 for `pass` and 16 for `dek.salt`, the NIST SP 800-132 floors `@libp2p/keychain`
    // throws on. Written as literals rather than as `PASSPHRASE_MIN_LENGTH`, so the
    // assertion cannot move together with the value it is checking.
    expect(derived.pass.length).toBeGreaterThanOrEqual(20)
    expect(derived.dek.salt.length).toBeGreaterThanOrEqual(16)

    // Domain separation: the salt must not be the passphrase under another name.
    expect(derived.dek.salt).not.toBe(derived.pass)

    // Deterministic across calls — this is what lets a keychain written before a restart be
    // read after one, and it is a hard requirement rather than a nicety.
    const again = await keychainProtectionFor(new Uint8Array(32).fill(7))
    expect(again.pass).toBe(derived.pass)
    expect(again.dek.salt).toBe(derived.dek.salt)

    // And per node: a different seed must not reach the same DEK.
    const other = await keychainProtectionFor(new Uint8Array(32).fill(8))
    expect(other.pass).not.toBe(derived.pass)
    expect(other.dek.salt).not.toBe(derived.dek.salt)
  })
})

describe('AUTH-07 criterion 3 — a node whose datastore predates the real DEK still starts', () => {
  it(
    'entries written under the empty DEK are removed, so AutoTLS sees the NotFoundError it recreates on',
    async () => {
      // The name AutoTLS actually uses — `DEFAULT_ACCOUNT_PRIVATE_KEY_NAME`. Seeded through a
      // no-argument keychain, i.e. written exactly as this repository used to write it.
      const stale = 'auto-tls-acme-account-private-key'
      const datastore = new MemoryDatastore()
      await readerOver(datastore, undefined).importKey(stale, await generateKeyPair('Ed25519'))

      // Positive control: the entry really is there, and really is readable by the empty DEK,
      // before the node touches it. Without this the assertion below passes on an empty store.
      expect(await opens(datastore, undefined, stale)).toBe(true)

      const rig = await startRig(datastore)

      // The regression this closes: `@ipshipyard/libp2p-auto-tls`'s `loadOrCreateKey` catches
      // `exportKey` and rethrows anything whose `name` is not `NotFoundError`
      // (`dist/src/utils.js:13-26`). Measured against an unswept store it threw
      // `OperationError: The operation failed for an operation-specific reason` — a node that
      // would not start. Swept, the same call reaches the branch that mints a new key.
      const refusal = await opens(rig.datastore, rig.expected, stale)
      expect(refusal).not.toBe(true)
      expect(refusal).toContain('NotFoundError')

      // And the swept store is still a working keychain, not a broken one.
      await rig.keychain.importKey('fresh', await generateKeyPair('Ed25519'))
      expect(await opens(rig.datastore, rig.expected, 'fresh')).toBe(true)
    },
    60_000,
  )
})
