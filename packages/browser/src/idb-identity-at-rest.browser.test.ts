import { ed25519 } from '@noble/curves/ed25519.js'
import { openDB } from 'idb'
import type { IDBPDatabase } from 'idb'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_KDF_PARAMS,
  SALT_BYTES,
  deriveSealKey,
  openSecret,
  parseSealedSecret,
  toHex,
} from '@o2/core'
import type { SealKdfParams, NodeCertificate } from '@o2/core'
import { SEED_BYTES, generateSeed, identityFromSeed } from '@o2/libp2p'
// Test-only relative imports, the route `packages/cloudflare/src/turn-credential.test.ts`
// sanctions and states the reason for: `certificatePayload` and `fromBase64Url` are
// deliberately NOT on `@o2/core`'s barrel — the first because it is the signing side's own
// detail, the second because nothing outside the sealed-secret module has a caller for it.
// Reaching the files directly keeps both true rather than widening the kernel package's
// public surface to serve one spec.
import { fromBase64Url } from '../../core/src/capability.ts'
import { certificatePayload } from '../../core/src/enrollment.ts'
import { BrowserNode } from './browser-node.ts'
import {
  IDENTITY_STORE,
  IdbIdentityStore,
  PROVIDER_KEY,
  SALT_KEY,
  SEALED_PROVIDER_KEY,
  SEALED_SEED_KEY,
  SEED_KEY,
} from './idb-identity-store.ts'
// Vite's `?worker` suffix bundles the module and its imports into a real Worker.
// Browser project only — see vitest.config.ts.
import TaskExecutorWorker from './task-executor.worker.ts?worker'

/**
 * AUTH-06, the browser tier: what a copied browser profile hands over.
 *
 * Three engines, one real IndexedDB each. Every claim below is a reading of the database
 * a tab actually wrote, taken through `getAllKeys`/`getAll` on a fresh connection after
 * the node has stopped — not a reading of what the store's own API says it holds.
 *
 * | describe block | criterion |
 * |---|---|
 * | `criterion 2 — the positive control` | the instrument can see a plaintext secret when one is there |
 * | `criterion 1 — a started tab leaves neither secret at rest` | no seed bytes, no provider-key bytes, certificate still readable |
 * | `criterion 3 — one passphrase, one PeerId across reloads` | three starts, one identity |
 * | `criterion 4 — a wrong passphrase refuses by name and mints nothing` | the refusal changes nothing |
 * | `the migration` | a tab that already held a plaintext seed keeps its PeerId |
 * | `the promise to write no new secret` | and what it costs |
 * | `the store's own one-transaction property, under the seal` | the cross-tab race, still fixed |
 *
 * ## The decode is the instrument, and here is the failure it is written against
 *
 * `packages/cloudflare/src/funnel-collector.e2e.test.ts:110-176` carries a repaired dump
 * and, in its own comment, the reason it needed repairing:
 *
 * > **`node:sqlite` hands a BLOB back as a `Uint8Array`, NOT as a `Buffer`, and reading
 * > that wrongly is how this instrument first failed.** The original line tested
 * > `Buffer.isBuffer(value)` and fell back to `Buffer.from(String(value))`, which renders a
 * > `Uint8Array` as the comma-separated decimal string `255,15,66,123,...`. Every scan
 * > below then searched that rendering and found nothing — and the plant that stores the
 * > client address in the record was watched staying GREEN because of it, with
 * > `"plantedClientAddress":"192.0.2.199"` sitting in the file the whole time. A decode
 * > step is a place a value can be lost, and this one lost all of them.
 *
 * So {@link decodeValue} branches on the value's own type and **never** calls `String` on a
 * `Uint8Array`. IndexedDB's structured clone returns a `Uint8Array` as a `Uint8Array` and a
 * sealed envelope as a plain object; each needs its own decode and neither survives the
 * other's.
 *
 * On top of that, every base64url field of a value that {@link parseSealedSecret} accepts is
 * **decoded back to bytes** and dumped as its own entry. A seed that reached the store
 * inside an envelope's `ciphertext` field un-encrypted would be exactly the failure
 * criterion 1 is looking for, and a scan that only looked at `Uint8Array` records — or only
 * at the JSON text — would not see it.
 *
 * ## Cheap KDF parameters where they can be chosen, and where they cannot
 *
 * Store-level cases derive at {@link CHEAP_PARAMS}; Argon2id at
 * {@link DEFAULT_KDF_PARAMS} measured 436 ms per derivation and this file runs three times.
 * Cases that drive `BrowserNode.start` pay the defaults, because the cost parameters are
 * not a `BrowserNodeOptions` field and must not become one to make a test cheaper.
 *
 * **No case here asserts a duration.** Argon2id at the defaults has read 374, 436 and
 * 501 ms across two hosts — a 34 % spread — and an absolute bound would encode this one.
 */

/** A passphrase at or above `PASSPHRASE_MIN_LENGTH`. Twenty-eight characters. */
const SPEC_PASSPHRASE = 'a-spec-passphrase-for-at-rest'
/** A different one, of legal length, for the wrong-passphrase readings. */
const WRONG_PASSPHRASE = 'a-different-passphrase-entirely'

/** Cheap enough to run three times per engine; still a real Argon2id derivation. */
const CHEAP_PARAMS: SealKdfParams = { t: 1, m: 8192, p: 1, dkLen: 32 }

/** The two needles the positive control plants and criterion 1 looks for. */
const KNOWN_SEED = new Uint8Array(SEED_BYTES).fill(0)
for (let i = 0; i < SEED_BYTES; i += 1) KNOWN_SEED[i] = (i * 7 + 11) % 251
const KNOWN_PROVIDER_SEED = new Uint8Array(SEED_BYTES)
for (let i = 0; i < SEED_BYTES; i += 1) KNOWN_PROVIDER_SEED[i] = (i * 13 + 29) % 241

let seq = 0
const started: BrowserNode[] = []
const created: string[] = []

const createWorker = (): Worker => new TaskExecutorWorker()

/** A blockstore name nothing else in the origin uses. The browser lane shares an origin. */
function freshStore(what: string): string {
  const name = `o2-at-rest-${what}-${seq++}-${Math.trunc(performance.now() * 1000)}`
  created.push(name)
  return name
}

/**
 * The identity database's name, derived exactly as `browser-node.ts` derives it.
 *
 * A second copy of a derivation is a defect that presents as a node with no identity, so
 * the first case asserts this against `BrowserNode.identityStore.name` rather than leaving
 * the two to drift.
 */
function identityDbName(blockstoreName: string): string {
  return `${blockstoreName}-identity`
}

/** Every database `browser-node.ts` derives from one blockstore name. */
function derivedDbNames(blockstoreName: string): string[] {
  return [
    blockstoreName,
    identityDbName(blockstoreName),
    `${blockstoreName}-issuance`,
    `${blockstoreName}-sovereign`,
  ]
}

async function dropDb(name: string): Promise<void> {
  await new Promise<void>((resolve) => {
    const request = indexedDB.deleteDatabase(name)
    request.onsuccess = (): void => resolve()
    request.onerror = (): void => resolve()
    // A delete blocked by a stranded connection must not hang teardown; the names are
    // unique per case anyway, so a leaked database cannot be read by another case.
    request.onblocked = (): void => resolve()
  })
}

afterEach(async () => {
  for (const node of started.splice(0)) {
    await node.stop().catch(() => {})
  }
  for (const name of created.splice(0)) {
    for (const derived of derivedDbNames(name)) await dropDb(derived)
  }
}, 120_000)

// ─── the dump instrument ─────────────────────────────────────────────────────

interface DumpedRecord {
  readonly key: string
  readonly bytes: Uint8Array
}

const textEncoder = new TextEncoder()

/**
 * One stored value as bytes — **branching on the value's own type, never rendering it.**
 *
 * See this file's docblock for the funnel instrument's recorded failure, which is what
 * this function is shaped by. `String(value)` on a `Uint8Array` yields `"255,15,66,..."`,
 * and a scan of that text finds no byte it was looking for.
 */
function decodeValue(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value
  if (typeof value === 'string') return textEncoder.encode(value)
  return textEncoder.encode(JSON.stringify(value))
}

/**
 * A raw connection for reading, opened **at the same version and with the same upgrade** the
 * store itself uses.
 *
 * **Not `openDB(name)`, and the difference is a measured trap rather than a style choice.**
 * `openDB` with no version opens an existing database at its current version and otherwise
 * *creates* one at version 1 with no upgrade callback — so a reader that reached a database
 * before the store did left behind a version-1 database **with no object store in it**, and
 * `IdbIdentityStore.open` then found version 1, ran no upgrade, and every later
 * `transaction('identity')` threw. Observed in chromium, firefox and webkit alike:
 *
 *   NotFoundError: IDBDatabase.transaction: 'identity' is not a known object store name
 *
 * An instrument that creates the thing it is measuring in a shape nothing else can use is
 * worse than no instrument. This one creates it in exactly the shape the store does.
 */
async function openReader(name: string): Promise<IDBPDatabase> {
  return openDB(name, 1, {
    upgrade(database) {
      if (!database.objectStoreNames.contains(IDENTITY_STORE)) {
        database.createObjectStore(IDENTITY_STORE)
      }
    },
  })
}

/**
 * Every key and every decoded value in `name`, plus the decoded base64url fields of any
 * record that is a sealed envelope.
 *
 * Opened through {@link openReader}, for the reason that function records.
 */
async function dumpIdentityDb(name: string): Promise<DumpedRecord[]> {
  const db = await openReader(name)
  try {
    if (!db.objectStoreNames.contains(IDENTITY_STORE)) return []
    const keys = await db.getAllKeys(IDENTITY_STORE)
    const values: unknown[] = await db.getAll(IDENTITY_STORE)
    const dumped: DumpedRecord[] = []
    for (let i = 0; i < keys.length; i += 1) {
      const rawKey = keys[i]
      const key = typeof rawKey === 'string' ? rawKey : JSON.stringify(rawKey)
      const value = values[i]
      dumped.push({ key, bytes: decodeValue(value) })
      const envelope = parseSealedSecret(value)
      if (envelope === null) continue
      // The envelope's own fields, back to bytes. A secret that reached the store
      // un-encrypted inside `ciphertext` is invisible to a scan of the JSON text.
      dumped.push({ key: `${key}#salt`, bytes: fromBase64Url(envelope.salt) })
      dumped.push({ key: `${key}#nonce`, bytes: fromBase64Url(envelope.nonce) })
      dumped.push({ key: `${key}#ciphertext`, bytes: fromBase64Url(envelope.ciphertext) })
    }
    return dumped
  } finally {
    db.close()
  }
}

/** Raw bytes in raw bytes. No encoding, no rendering, no separator. */
function containsSubsequence(haystack: Uint8Array, needle: Uint8Array): boolean {
  if (needle.length === 0 || needle.length > haystack.length) return false
  outer: for (let start = 0; start + needle.length <= haystack.length; start += 1) {
    for (let i = 0; i < needle.length; i += 1) {
      if (haystack[start + i] !== needle[i]) continue outer
    }
    return true
  }
  return false
}

/** The key of the first dumped record holding `needle`, or `null`. */
function findNeedle(dump: readonly DumpedRecord[], needle: Uint8Array): string | null {
  for (const record of dump) {
    if (containsSubsequence(record.bytes, needle)) return record.key
  }
  return null
}

/**
 * The floor, asserted before any absence is.
 *
 * A dump of nothing satisfies every `not.toBe` in this file. `42-02`'s counterpart caught a
 * blinded instrument through exactly this assertion, and reddened three cases nobody had
 * predicted it would.
 *
 * The byte floor is `2 * SEED_BYTES` — as many bytes as the two needles being searched for
 * — because a dump smaller than its own needles cannot have found them and cannot have lost
 * them either. It is sited against the smallest database any case here builds, which is the
 * positive control's two 32-byte records.
 */
function expectDumpIsNotEmpty(dump: readonly DumpedRecord[], where: string, minRecords = 2): void {
  expect(
    dump.length,
    `${where}: the dump found ${dump.length} records — an absence assertion over a dump `
      + 'this small is passing because the instrument read nothing, not because the bytes are gone',
  ).toBeGreaterThanOrEqual(minRecords)
  const total = dump.reduce((sum, one) => sum + one.bytes.length, 0)
  expect(total, `${where}: the dump holds ${total} bytes in total`).toBeGreaterThanOrEqual(
    2 * SEED_BYTES,
  )
}

// ─── hand-built pre-change databases ─────────────────────────────────────────

/**
 * Write an identity database in the **pre-change shape**, by hand.
 *
 * By hand rather than by running the pre-change code, because a pre-change run is not
 * reproducible after the change and this control has to keep working for as long as
 * criterion 1 does. It is also the only remaining writer of a plaintext secret anywhere in
 * this repository, which is the phase's claim stated as an arrangement of code.
 */
async function writeLegacyDb(
  name: string,
  records: { readonly seed?: Uint8Array; readonly providerSeed?: Uint8Array },
): Promise<void> {
  const db = await openReader(name)
  try {
    if (records.seed !== undefined) await db.put(IDENTITY_STORE, records.seed, SEED_KEY)
    if (records.providerSeed !== undefined) {
      await db.put(IDENTITY_STORE, records.providerSeed, PROVIDER_KEY)
    }
  } finally {
    db.close()
  }
}

/** The keys a database holds, sorted, for a comparison a new record would break. */
async function keysOf(name: string): Promise<string[]> {
  const db = await openReader(name)
  try {
    if (!db.objectStoreNames.contains(IDENTITY_STORE)) return []
    const keys = await db.getAllKeys(IDENTITY_STORE)
    return keys.map((key) => (typeof key === 'string' ? key : JSON.stringify(key))).sort()
  } finally {
    db.close()
  }
}

/** One record, straight out of the database, as whatever it is. */
async function recordAt(name: string, key: string): Promise<unknown> {
  const db = await openReader(name)
  try {
    if (!db.objectStoreNames.contains(IDENTITY_STORE)) return undefined
    return await db.get(IDENTITY_STORE, key)
  } finally {
    db.close()
  }
}

/** The bytes a sealed record opens to, under `passphrase`. Throws if it is not one. */
async function openRecord(name: string, key: string, passphrase: string): Promise<Uint8Array> {
  const stored = await recordAt(name, key)
  const envelope = parseSealedSecret(stored)
  expect(envelope, `${name}/${key} is not a sealed record`).not.toBeNull()
  return await openSecret(stored, passphrase)
}

/**
 * Byte equality, compared as bytes.
 *
 * Not a hex rendering, and the reason is this file's own rule applied to itself: a value
 * scanned or compared through a string rendering is a value that can be lost in the
 * rendering, which is exactly the funnel instrument's failure quoted at the top.
 */
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false
  }
  return true
}

/**
 * A certificate naming `seed`'s public key, signed the way the fabric signs one.
 *
 * Built here rather than obtained from a provider because the browser project can start
 * none: this file's subject is what the database holds, and the certificate's role in it is
 * to be the record criterion 1 requires to STILL be readable.
 */
async function certificateOver(seed: Uint8Array): Promise<NodeCertificate> {
  const issuerSeed = generateSeed()
  const unsigned: Omit<NodeCertificate, 'signature'> = {
    nodeKey: (await identityFromSeed(seed)).nodeKey,
    userKey: toHex(ed25519.getPublicKey(issuerSeed)),
    operatorId: 'phase-42-browser-at-rest',
    discoverability: 'via-relay',
    relayIds: [],
    issuedAt: Date.now() - 1000,
    expiresAt: Date.now() + 3_600_000,
    issuer: toHex(ed25519.getPublicKey(issuerSeed)),
  }
  return { ...unsigned, signature: toHex(ed25519.sign(certificatePayload(unsigned), issuerSeed)) }
}

/** Start a tab with the least configuration a `BrowserNode` will accept. */
async function startTab(options: {
  readonly blockstoreName: string
  readonly passphrase?: string
  readonly whenSeedIsGone?: 'mints-a-new-identity' | 'refuses-to-start-without-its-seed'
  readonly issues?: boolean
}): Promise<BrowserNode> {
  const node = await BrowserNode.start({
    relayAddrs: [],
    createWorker,
    blockstoreName: options.blockstoreName,
    trustAnchors: [],
    startReporting: 'reports-its-own-start',
    whenSeedIsGone: options.whenSeedIsGone ?? 'mints-a-new-identity',
    identityProtection:
      options.passphrase === undefined
        ? { kind: 'writes-no-new-secret' }
        : { kind: 'passphrase', passphrase: options.passphrase },
    ...(options.issues === true ? { issuesCertificates: 4 } : {}),
  })
  started.push(node)
  return node
}

/** Start and immediately stop, handing back the peer id the tab held. */
async function peerIdOfOneStart(options: Parameters<typeof startTab>[0]): Promise<string> {
  const node = await startTab(options)
  const id = node.peerId
  await node.stop()
  started.splice(started.indexOf(node), 1)
  return id
}

/** Whatever `BrowserNode.start` rejected with, or `null` when it did not reject. */
async function startFailure(options: Parameters<typeof startTab>[0]): Promise<unknown> {
  try {
    const node = await startTab(options)
    await node.stop()
    started.splice(started.indexOf(node), 1)
    return null
  } catch (cause: unknown) {
    return cause
  }
}

function nameOf(thrown: unknown): string {
  return thrown instanceof Error ? thrown.name : `not an Error: ${JSON.stringify(thrown) ?? 'undefined'}`
}

// ─── the cases ───────────────────────────────────────────────────────────────

describe('criterion 2 — the positive control, and it runs first', () => {
  it('the positive control: the dump finds both plaintext secrets in a database written in the pre-change shape', async () => {
    const store = freshStore('control')
    const dbName = identityDbName(store)
    await writeLegacyDb(dbName, { seed: KNOWN_SEED, providerSeed: KNOWN_PROVIDER_SEED })

    const dump = await dumpIdentityDb(dbName)
    expectDumpIsNotEmpty(dump, 'the hand-built pre-change database')

    // Named by the key each was found under, not merely "somewhere": an instrument that
    // reported a hit in the wrong record would be reporting a coincidence.
    expect(findNeedle(dump, KNOWN_SEED)).toBe(SEED_KEY)
    expect(findNeedle(dump, KNOWN_PROVIDER_SEED)).toBe(PROVIDER_KEY)
  }, 60_000)
})

describe('criterion 1 — a started tab leaves neither secret at rest', () => {
  it('holds no seed bytes and no provider-key bytes, and still holds a readable certificate', async () => {
    const store = freshStore('criterion1')
    const node = await startTab({ blockstoreName: store, passphrase: SPEC_PASSPHRASE, issues: true })

    // The derivation this file uses for every hand-built database, checked against the one
    // production uses, so the two cannot drift into measuring different databases.
    expect(node.identityStore.name).toBe(identityDbName(store))

    await node.stop()
    started.splice(started.indexOf(node), 1)

    const dbName = identityDbName(store)
    // The real secrets, recovered from their own envelopes — so the needles are what this
    // tab actually holds rather than values the case chose.
    const seed = await openRecord(dbName, SEALED_SEED_KEY, SPEC_PASSPHRASE)
    const providerSeed = await openRecord(dbName, SEALED_PROVIDER_KEY, SPEC_PASSPHRASE)
    expect(seed.length).toBe(SEED_BYTES)
    expect(providerSeed.length).toBe(SEED_BYTES)

    // A certificate over this tab's own key, written through the store's own writer — the
    // one this phase deliberately leaves unsealed. The browser lane can start no provider
    // peer, so the record is placed rather than enrolled for; `browser-enrollment.e2e.test.ts`
    // is where a real enrolment writes one.
    const certificate = await certificateOver(seed)
    const writer = await IdbIdentityStore.open(dbName)
    try {
      await writer.saveCertificate(certificate)
    } finally {
      writer.close()
    }

    const dump = await dumpIdentityDb(dbName)
    expectDumpIsNotEmpty(dump, 'the started tab')

    expect(findNeedle(dump, seed)).toBeNull()
    expect(findNeedle(dump, providerSeed)).toBeNull()

    const keys = await keysOf(dbName)
    expect(keys).not.toContain(SEED_KEY)
    expect(keys).not.toContain(PROVIDER_KEY)
    expect(keys).toContain(SEALED_SEED_KEY)
    expect(keys).toContain(SEALED_PROVIDER_KEY)

    // And the certificate is still there and still readable. Criterion 1 deliberately does
    // not cover it: it is public material, verified offline against pinned provider keys,
    // and a phase that sealed it would have broken that while protecting nothing.
    const reopened = await IdbIdentityStore.open(dbName)
    try {
      const held = await reopened.loadCertificate()
      expect(held?.issuer).toBe(certificate.issuer)
      expect(held?.signature).toBe(certificate.signature)
    } finally {
      reopened.close()
    }
  }, 180_000)

  it('the salt record is a salt: the right width, and no part of either secret', async () => {
    const store = freshStore('salt')
    const node = await startTab({ blockstoreName: store, passphrase: SPEC_PASSPHRASE, issues: true })
    await node.stop()
    started.splice(started.indexOf(node), 1)

    const dbName = identityDbName(store)
    const salt = await recordAt(dbName, SALT_KEY)
    expect(salt).toBeInstanceOf(Uint8Array)
    if (!(salt instanceof Uint8Array)) throw new Error('unreachable — asserted above')
    // `SALT_BYTES`, read off the module that writes it rather than restated as a literal.
    expect(salt.length).toBe(SALT_BYTES)

    const seed = await openRecord(dbName, SEALED_SEED_KEY, SPEC_PASSPHRASE)
    const providerSeed = await openRecord(dbName, SEALED_PROVIDER_KEY, SPEC_PASSPHRASE)

    // This is what makes "the store holds no secret at rest" checkable rather than
    // definitional: the store DOES hold a record, and this is the assertion that the
    // record is not a piece of either secret.
    expect(containsSubsequence(seed, salt)).toBe(false)
    expect(containsSubsequence(providerSeed, salt)).toBe(false)
    expect(containsSubsequence(salt, seed)).toBe(false)
    expect(containsSubsequence(salt, providerSeed)).toBe(false)
  }, 180_000)
})

describe('criterion 3 — one passphrase, one PeerId across reloads', () => {
  it('comes back as the same node on the second start, and on the third', async () => {
    const store = freshStore('reload')
    const first = await peerIdOfOneStart({ blockstoreName: store, passphrase: SPEC_PASSPHRASE })
    const second = await peerIdOfOneStart({ blockstoreName: store, passphrase: SPEC_PASSPHRASE })
    // A third, because two equal readings could be an accident of the second reading the
    // first's in-memory anything; three against one database is the claim.
    const third = await peerIdOfOneStart({ blockstoreName: store, passphrase: SPEC_PASSPHRASE })

    expect(second).toBe(first)
    expect(third).toBe(first)
  }, 240_000)
})

describe('criterion 4 — a wrong passphrase refuses by name and mints nothing', () => {
  it('refuses, changes not one byte, and the right passphrase still opens the original identity', async () => {
    const store = freshStore('wrong')
    const dbName = identityDbName(store)
    const original = await peerIdOfOneStart({ blockstoreName: store, passphrase: SPEC_PASSPHRASE })

    const keysBefore = await keysOf(dbName)
    const before = parseSealedSecret(await recordAt(dbName, SEALED_SEED_KEY))
    expect(before).not.toBeNull()

    const failure = await startFailure({ blockstoreName: store, passphrase: WRONG_PASSPHRASE })
    expect(nameOf(failure)).toBe('SealedIdentityUnlockError')

    // Nothing new arrived, and nothing was rewritten. A refusal that had quietly re-sealed
    // would still throw and would still leave a database of the right shape.
    expect(await keysOf(dbName)).toEqual(keysBefore)
    const after = parseSealedSecret(await recordAt(dbName, SEALED_SEED_KEY))
    expect(after?.ciphertext).toBe(before?.ciphertext)

    // The assertion that turns "it threw" into "it changed nothing".
    const reopened = await peerIdOfOneStart({ blockstoreName: store, passphrase: SPEC_PASSPHRASE })
    expect(reopened).toBe(original)
  }, 300_000)

  it('the same call against an empty database DOES mint, so the refusal above is not a store that can never mint', async () => {
    const store = freshStore('mints')
    const dbName = identityDbName(store)
    expect(await keysOf(dbName)).toEqual([])

    const minted = await peerIdOfOneStart({ blockstoreName: store, passphrase: SPEC_PASSPHRASE })
    expect(minted.length).toBeGreaterThan(0)
    expect(await keysOf(dbName)).toContain(SEALED_SEED_KEY)
  }, 180_000)

  it('refuses a passphrase under the floor before deriving anything from it', async () => {
    const store = freshStore('weak')
    const failure = await startFailure({ blockstoreName: store, passphrase: 'too-short' })
    expect(nameOf(failure)).toBe('WeakPassphraseError')
  }, 60_000)
})

describe('the migration — a tab that already held a plaintext seed', () => {
  it('keeps its PeerId, seals the same bytes, and the plaintext record is gone', async () => {
    const store = freshStore('migrate')
    const dbName = identityDbName(store)
    await writeLegacyDb(dbName, { seed: KNOWN_SEED })

    const expected = (await identityFromSeed(KNOWN_SEED)).peerId
    const after = await peerIdOfOneStart({ blockstoreName: store, passphrase: SPEC_PASSPHRASE })
    // The tab does not become a new node. That is the whole of what a migration must do.
    expect(after).toBe(expected)

    const opened = await openRecord(dbName, SEALED_SEED_KEY, SPEC_PASSPHRASE)
    expect(sameBytes(opened, KNOWN_SEED), 'the envelope opened to bytes that are not the ones it found').toBe(true)
    expect(await keysOf(dbName)).not.toContain(SEED_KEY)
  }, 180_000)

  it('under a promise to write no new secret it is adopted and reported, and NOT deleted', async () => {
    const store = freshStore('adopt')
    const dbName = identityDbName(store)
    await writeLegacyDb(dbName, { seed: KNOWN_SEED })

    const expected = (await identityFromSeed(KNOWN_SEED)).peerId
    const node = await startTab({ blockstoreName: store })
    expect(node.peerId).toBe(expected)
    // Deleting somebody's identity because they supplied no passphrase is a worse outcome
    // than the exposure it would close. It is reported, never repaired — see the summary's
    // residue section, and `identity-protection.ts`'s own words for the arm's meaning.
    expect(node.identityIsUnprotected).toBe(true)
    await node.stop()
    started.splice(started.indexOf(node), 1)

    expect(await keysOf(dbName)).toContain(SEED_KEY)
    expect(await keysOf(dbName)).not.toContain(SEALED_SEED_KEY)
  }, 180_000)
})

describe('the promise to write no new secret, and what it costs', () => {
  it('writes no seed-shaped record to a cold database, and is a different node next start', async () => {
    const store = freshStore('nosecret')
    const dbName = identityDbName(store)

    const first = await peerIdOfOneStart({ blockstoreName: store })
    const keys = await keysOf(dbName)
    expect(keys).not.toContain(SEED_KEY)
    expect(keys).not.toContain(SEALED_SEED_KEY)
    expect(keys).not.toContain(SALT_KEY)

    // A per-session identity by construction. Stated as an outcome rather than left to be
    // discovered by whoever wonders why their tab changed name.
    const second = await peerIdOfOneStart({ blockstoreName: store })
    expect(second).not.toBe(first)
  }, 180_000)

  it('refuses the contradiction: a node that will write no secret and will not start without one', async () => {
    const store = freshStore('contradiction')
    const failure = await startFailure({
      blockstoreName: store,
      whenSeedIsGone: 'refuses-to-start-without-its-seed',
    })
    expect(nameOf(failure)).toBe('ContradictoryIdentityPolicyError')
    expect(failure instanceof Error ? failure.message : '').toContain('writes-no-new-secret')
    expect(failure instanceof Error ? failure.message : '').toContain(
      'refuses-to-start-without-its-seed',
    )
  }, 60_000)
})

describe("the store's own one-transaction property, under the seal", () => {
  it('gives two concurrent handles on one database the same seed', async () => {
    const store = freshStore('race')
    const dbName = identityDbName(store)
    const handles = await Promise.all([
      IdbIdentityStore.open(dbName),
      IdbIdentityStore.open(dbName),
    ])
    try {
      const salt = await handles[0]!.loadOrCreateSalt()
      const key = await deriveSealKey(SPEC_PASSPHRASE, salt, CHEAP_PARAMS)
      const sealed = await Promise.all(
        handles.map(async (handle) =>
          handle.loadOrMintSealedSeed(key, CHEAP_PARAMS, salt, generateSeed),
        ),
      )
      const opened = await Promise.all(
        sealed.map(async (envelope) => openSecret(envelope, SPEC_PASSPHRASE)),
      )
      // One identity for two concurrent openers — and the loser holds the WINNER's seed
      // rather than the one it minted. The seal now happens inside the transaction that
      // carries that property, which is the thing this case exists to keep true.
      expect(
        sameBytes(opened[0] ?? new Uint8Array(0), opened[1] ?? new Uint8Array(1)),
        'two concurrent handles on one database minted two identities',
      ).toBe(true)
      expect(new Set(sealed.map((one) => one.ciphertext)).size).toBe(1)
    } finally {
      for (const handle of handles) handle.close()
    }
  }, 120_000)

  it('opens an envelope written under cost parameters that are not today defaults', async () => {
    const store = freshStore('oldparams')
    const dbName = identityDbName(store)
    const olderParams: SealKdfParams = { t: 1, m: 8192, p: 2, dkLen: 32 }
    expect(olderParams.m).not.toBe(DEFAULT_KDF_PARAMS.m)

    const handle = await IdbIdentityStore.open(dbName)
    try {
      const salt = await handle.loadOrCreateSalt()
      const key = await deriveSealKey(SPEC_PASSPHRASE, salt, olderParams)
      const written = await handle.loadOrMintSealedSeed(key, olderParams, salt, () => KNOWN_SEED)
      expect(written.m).toBe(olderParams.m)
      expect(written.p).toBe(olderParams.p)
    } finally {
      handle.close()
    }

    // The tab starts at today's defaults and must still open it — criterion 5, on this
    // tier. A build that derived only at the parameters it was configured with would go
    // red here and nowhere else in this file.
    const peerId = await peerIdOfOneStart({ blockstoreName: store, passphrase: SPEC_PASSPHRASE })
    expect(peerId).toBe((await identityFromSeed(KNOWN_SEED)).peerId)
  }, 180_000)
})
