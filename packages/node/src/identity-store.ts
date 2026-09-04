/**
 * AUTH-01 — the identity seed, persisted beside the blocks.
 *
 * A node's identity is one 32-byte ed25519 seed (`@o2/libp2p`'s `identityFromSeed` reads
 * it as both a `nodeKey` and a peer id). This module is where that seed lives between
 * runs, so a restarted process is the same node rather than a new one — which is what
 * makes a persisted certificate reusable and a peer's cached verdict still true.
 *
 * **Persistence is a deployment choice — whether this process should survive its own
 * restart — and not a kind of node**, in the framing `FabricNodeOptions.blockstoreDir`
 * already uses. A process given no directory has nowhere to persist, so it gets a fresh
 * identity per start; that needs no new option and no branch on node kind, because this
 * module is simply not called on that path. All nodes have equal functionality here; the
 * only difference is discovery.
 *
 * Two names, one function. The provider signing key and the node identity key are
 * separate files so `issuer !== nodeKey` always holds and a provider-signed certificate
 * is never confusable with a self-signed one.
 *
 * **The leading dot is not style.** `FsBlockstore.open`'s filter is the block *counter*,
 * not a safety net — see the note there. Anything written into a blockstore directory
 * that is not a block must be dot-prefixed.
 *
 * A wrong-length file is fatal rather than regenerated. Silently minting a new identity
 * from a truncated file would drop the node out of every peer's verified set, and the
 * only symptom would be that nobody talks to it any more.
 *
 * ## AUTH-06 — the seed stopped being a file a copied disk hands over
 *
 * `loadOrCreateSeed` is **gone**, not deprecated. It wrote 32 raw bytes to
 * `.identity.key` under `0o600`, which protects an identity against another account on the
 * same host and against nothing at all once the disk is imaged. Leaving it exported would
 * have left a reachable path that writes a plaintext secret, and this phase's claim is that
 * no such path remains — so it was deleted rather than kept beside its replacement.
 *
 * {@link loadOrCreateSealedSeed} replaces it. The bytes now live inside an Argon2id +
 * xchacha20poly1305 envelope (`@o2/core`'s `sealSecret`/`openSecret`) under a name of the
 * caller's choosing, and a directory written by an older build is migrated in place —
 * **same bytes, same peer id** — the first time a passphrase is supplied for it.
 *
 * `IDENTITY_FILE` and `PROVIDER_FILE` stay exported: the migration reads them, and
 * criterion 2's positive control writes them by hand in order to prove the instrument that
 * reports their absence can see them when they are there.
 */

import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { SEED_BYTES, assertUsablePassphrase, generateSeed, parseKeyHex } from '@o2/libp2p'
import type { IdentityProtection } from '@o2/libp2p'
import { openSecret, sealSecret } from '@o2/core'
import { parseCertificate } from '@o2/net'
import type { CanonicalValue, NodeCertificate } from '@o2/core'

/** The node's own identity key — the subject of its certificate. */
export const IDENTITY_FILE = '.identity.key'

/** The provider signing key, held only by a process configured to issue certificates. */
export const PROVIDER_FILE = '.provider.key'

/**
 * AUTH-06 — the node's identity seed, sealed.
 *
 * **A new name rather than new content in the old one, and the reason is that criterion 1
 * needs a direct question.** *"Is the plaintext gone?"* is `existsSync(IDENTITY_FILE)`
 * against a distinct name, and it is an inference about a file's contents against a shared
 * one. The migration below turns the second question into the first.
 *
 * Still dot-prefixed, and still for the reason at the top of this file rather than for
 * symmetry: `FsBlockstore.open`'s filter **is** the block counter, and a `.enc` suffix on a
 * dotted name still starts with a dot, so neither envelope is counted among the blocks.
 */
export const SEALED_IDENTITY_FILE = '.identity.key.enc'

/** The provider signing key, sealed. Same passphrase, same directory, same reasons. */
export const SEALED_PROVIDER_FILE = '.provider.key.enc'

/**
 * The provider-signed certificate, so a restart does not spend a fresh issuance.
 *
 * Dot-prefixed for the same reason as the two key files: `FsBlockstore.open`'s filter *is*
 * the block counter, so an undotted name in this directory is counted among the blocks.
 */
export const CERTIFICATE_FILE = '.certificate.json'

/** Thrown when an existing seed file is not exactly {@link SEED_BYTES} long. */
export class MalformedSeedFileError extends Error {
  constructor(path: string, received: number) {
    super(`${path} holds ${received} bytes, expected exactly ${SEED_BYTES} bytes — refusing to reinterpret it as a new identity`)
    this.name = 'MalformedSeedFileError'
  }
}

/**
 * Thrown when a sealed envelope is present and does not open.
 *
 * **The message names both possibilities and claims to know neither**, because the AEAD
 * reports `invalid tag` for a wrong passphrase and for an altered envelope alike. A refusal
 * that guessed would send an operator looking for the wrong fault half the time.
 *
 * It ends with the consequence, in the style {@link MalformedSeedFileError} already uses,
 * because the consequence is the reason this is a refusal rather than a fallback.
 */
export class SealedIdentityUnlockError extends Error {
  constructor(path: string, cause: unknown) {
    super(
      `${path} did not open — either the passphrase is wrong or the envelope has been altered, and the `
        + 'authenticated cipher reports the same failure for both, so this refusal does not claim to know '
        + `which (${cause instanceof Error ? `${cause.name}: ${cause.message}` : 'no error was raised'}). `
        + 'Refusing to mint a new identity — starting anyway would give this node a different peer id and '
        + 'orphan any certificate naming the old one.',
    )
    this.name = 'SealedIdentityUnlockError'
  }
}

/**
 * Thrown when an envelope is present and the caller promised to write no new secret.
 *
 * The alternative is minting over an identity that already exists, which is the same
 * outcome as a silent re-mint after a failed unlock and is refused for the same reason.
 */
export class SealedIdentityNeedsPassphraseError extends Error {
  constructor(path: string) {
    super(
      `${path} holds a sealed identity and no passphrase was supplied — refusing to mint a new identity `
        + 'over one that already exists, which would give this node a different peer id and orphan any '
        + 'certificate naming the old one. Supply --identity-passphrase-file, or point --dir somewhere else.',
    )
    this.name = 'SealedIdentityNeedsPassphraseError'
  }
}

/**
 * What {@link loadOrCreateSealedSeed} returns: the bytes, and whether they are readable by
 * anyone who copies this directory.
 *
 * `unprotected` exists so *"this identity is in the clear on this disk"* is a **value a
 * caller can act on** rather than a fact nobody is told. It is `true` on exactly one path —
 * a pre-existing plaintext seed adopted by a node that supplied no passphrase — and the
 * caller's obligation is to say so once, by name, not to repair it.
 */
export interface UnprotectedLegacySeed {
  readonly seed: Uint8Array<ArrayBuffer>
  readonly unprotected: boolean
}

let tmpSeq = 0

/**
 * Read the seed at `<dir>/<sealedFile>`, migrating `<dir>/<legacyFile>` or minting as
 * required, under the protection the caller states.
 *
 * Seven cases, and each one is a case in `identity-at-rest.node.test.ts`:
 *
 * | directory holds | protection | outcome |
 * |---|---|---|
 * | a sealed envelope | `passphrase`, correct | opens; same seed, same peer id |
 * | a sealed envelope | `passphrase`, wrong | {@link SealedIdentityUnlockError}. No mint branch is reachable. |
 * | a sealed envelope | `writes-no-new-secret` | {@link SealedIdentityNeedsPassphraseError} |
 * | a legacy plaintext seed | `passphrase` | seals the SAME bytes, proves the envelope opens, then unlinks the plaintext |
 * | a legacy plaintext seed | `writes-no-new-secret` | adopts it, reports `unprotected: true`, does NOT delete it |
 * | neither | `passphrase` | mints, seals, writes the envelope |
 * | neither | `writes-no-new-secret` | mints, persists nothing |
 *
 * Written with the durability discipline `FsBlockstore.put` uses — a `.tmp-` name carrying
 * the pid and a per-call counter, then `rename`, which is atomic within a directory on
 * POSIX — so a process killed mid-write leaves no half-written envelope.
 *
 * **The passphrase is checked before anything is derived from it**, so a passphrase under
 * the floor costs a string length rather than an Argon2id derivation and its refusal can
 * never be confused with a decryption failure.
 */
export async function loadOrCreateSealedSeed(
  dir: string,
  sealedFile: string,
  legacyFile: string,
  protection: IdentityProtection,
): Promise<UnprotectedLegacySeed> {
  assertUsablePassphrase(protection)
  await mkdir(dir, { recursive: true })

  const sealedPath = join(dir, sealedFile)
  const legacyPath = join(dir, legacyFile)

  // 1. A sealed envelope wins over everything else in the directory. Checked first so a
  //    stale plaintext left behind by a half-finished migration can never shadow the
  //    envelope that replaced it.
  const envelope = await readTextIfPresent(sealedPath)
  if (envelope !== undefined) {
    if (protection.kind !== 'passphrase') throw new SealedIdentityNeedsPassphraseError(sealedPath)
    return { seed: await openSealedSeed(sealedPath, envelope, protection.passphrase), unprotected: false }
  }

  // 2. A legacy plaintext seed, written by a build before AUTH-06.
  const legacy = await readIfPresent(legacyPath)
  if (legacy !== undefined) {
    if (legacy.length !== SEED_BYTES) throw new MalformedSeedFileError(legacyPath, legacy.length)
    // Copy out of Node's Buffer pool: a Buffer is a view into a shared slab, so handing it
    // out would alias memory the caller does not own — the same reason `FsBlockstore.get`
    // copies.
    const seed = new Uint8Array(SEED_BYTES)
    seed.set(legacy)

    // **Reported, never repaired.** Deleting somebody's identity because they supplied no
    // passphrase is a worse outcome than the exposure it would close, so this arm hands
    // back the same bytes and tells the caller what they are.
    if (protection.kind !== 'passphrase') return { seed, unprotected: true }

    // **The write order is the whole of this branch's safety, and it is: seal, rename,
    // re-read and OPEN, and only THEN unlink.** Unlinking before the envelope is proven
    // readable turns a full disk — or any defect in the sealing path — into a destroyed
    // identity. The verification read is not belt-and-braces; it is the thing that makes
    // the unlink safe, which is why it is inlined here rather than hidden in a helper.
    await writeEnvelope(dir, sealedPath, seed, protection.passphrase)
    const written = await readTextIfPresent(sealedPath)
    if (written === undefined) {
      throw new SealedIdentityUnlockError(sealedPath, new Error('the envelope this migration just wrote is not there'))
    }
    const reopened = await openSealedSeed(sealedPath, written, protection.passphrase)
    if (!sameBytes(reopened, seed)) {
      throw new SealedIdentityUnlockError(sealedPath, new Error('the envelope this migration just wrote opened to different bytes'))
    }
    await unlink(legacyPath)
    return { seed, unprotected: false }
  }

  // 3. Neither. A node that promised to write no new secret keeps that promise: it gets a
  //    per-process identity and this directory learns nothing about it.
  const seed = generateSeed()
  if (protection.kind !== 'passphrase') return { seed, unprotected: false }
  await writeEnvelope(dir, sealedPath, seed, protection.passphrase)
  return { seed, unprotected: false }
}

/**
 * Open one envelope, or refuse by name.
 *
 * **There is no arm of this catch that reaches `generateSeed()`, and that is the property
 * criterion 4 is about.** The function this replaced minted whenever it found nothing, so a
 * decrypt failure that returned `null` — or fell through — would walk into a silent
 * re-mint, present as a successful start, burn the enrolment quota and orphan the
 * certificate the old seed was issued against. Every failure below leaves by `throw`.
 *
 * `SEED_BYTES` is re-checked **after** decryption as well as before encryption: a decrypted
 * blob is external data, and an envelope written by an older build could hold a different
 * length. Same refusal, same reason, same words as the plaintext path used.
 */
async function openSealedSeed(path: string, text: string, passphrase: string): Promise<Uint8Array<ArrayBuffer>> {
  let opened: Uint8Array
  try {
    const parsed: unknown = JSON.parse(text)
    opened = await openSecret(parsed, passphrase)
  } catch (cause) {
    throw new SealedIdentityUnlockError(path, cause)
  }
  if (opened.length !== SEED_BYTES) throw new MalformedSeedFileError(path, opened.length)
  const seed = new Uint8Array(SEED_BYTES)
  seed.set(opened)
  return seed
}

/**
 * Seal and write one envelope, atomically.
 *
 * `{ mode: 0o600 }` even though the content is ciphertext. Filesystem mode is no longer the
 * protection, but it is still free — and the asymmetry with `.certificate.json`'s
 * deliberate lack of a mode stays meaningful to whoever reads the directory next.
 */
async function writeEnvelope(dir: string, path: string, seed: Uint8Array, passphrase: string): Promise<void> {
  const envelope = await sealSecret(seed, passphrase)
  const tmp = join(dir, `.tmp-${process.pid}-${tmpSeq++}`)
  await writeFile(tmp, JSON.stringify(envelope), { mode: 0o600 })
  await rename(tmp, path)
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

/**
 * The file's bytes, or `undefined` when there is no such file. Any other error throws.
 *
 * Two named helpers rather than one overloaded pair, and the reason is measured:
 * `reachability.node.test.ts` counts declarations that share a file and a name, and a TypeScript
 * overload set is three such declarations. The bound moved 17 -> 18 on the overloaded shape.
 * Two names cost nothing here and are what the call sites read as anyway.
 */
async function readIfPresent(path: string): Promise<Buffer | undefined> {
  try {
    return await readFile(path)
  } catch (cause) {
    if (isNotFound(cause)) return undefined
    throw cause
  }
}

/** The file's text, or `undefined` when there is no such file. Any other error throws. */
async function readTextIfPresent(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8')
  } catch (cause) {
    if (isNotFound(cause)) return undefined
    throw cause
  }
}

/**
 * Persist a provider-signed certificate beside the identity it names.
 *
 * Same `.tmp-`-then-`rename` sequence `loadOrCreateSealedSeed` uses above, for the same reason:
 * a process killed mid-write must leave either the old certificate or the new one, never
 * half of either.
 *
 * **No `mode` restriction, and the asymmetry with the `0o600` on the seed above is a
 * decision rather than an oversight.** A seed is the one secret this directory holds; a
 * certificate is a public signed statement that every peer is meant to be able to read and
 * verify, and restricting it would protect nothing while making the file look like a
 * secret to whoever reads the directory next.
 */
export async function saveCertificate(dir: string, certificate: NodeCertificate): Promise<void> {
  await mkdir(dir, { recursive: true })
  const tmp = join(dir, `.tmp-${process.pid}-${tmpSeq++}`)
  await writeFile(tmp, JSON.stringify(certificate))
  await rename(tmp, join(dir, CERTIFICATE_FILE))
}

/**
 * Read a persisted certificate, or `null` when there is nothing usable to read.
 *
 * **This function parses and does not verify** — the same split
 * `parseCertificate`'s own doc states, in the same words. A certificate that loads is not
 * a certificate that is trusted: `FabricNode.start` checks that it names *this* node's key
 * and has not expired, and `verifyCertificate` checks the signature against pinned issuers.
 *
 * It reuses the **wire's** parser rather than carrying a second one, because a node's own
 * disk is not more trustworthy than a peer's wire: the file may have been truncated by a
 * crash, edited by hand, or written by an older build with a different field set. Two
 * validators would drift, and the lenient one would become the one that matters.
 *
 * On top of that, one check `parseCertificate` deliberately does not make. It types
 * `nodeKey`, `userKey` and `issuer` as strings and does not judge their shape — correctly,
 * because `@o2/net` is portable and may not import `@o2/libp2p` (`purity.node.test.ts`).
 * So a hand-edited file carrying 64 non-hex characters parses cleanly and is then
 * zero-filled by `fromHex` into a different, valid key downstream, with nothing reporting
 * that the input was never hex. `@o2/node` is the first layer that *can* apply
 * `parseKeyHex`, so it applies it. The two validators cannot drift, because the second
 * only ever narrows the first.
 */
export async function loadCertificate(dir: string): Promise<NodeCertificate | null> {
  let raw: string
  try {
    raw = await readFile(join(dir, CERTIFICATE_FILE), 'utf8')
  } catch (cause) {
    if (isNotFound(cause)) return null
    throw cause
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }

  // A plain JSON tree of strings, numbers and arrays is a valid `CanonicalValue` shape,
  // and `parseCertificate` validates every field — so this cast is checked on the very
  // next line rather than trusted.
  const certificate = parseCertificate(parsed as CanonicalValue)
  if (certificate === null) return null

  for (const key of [certificate.nodeKey, certificate.userKey, certificate.issuer]) {
    if (parseKeyHex(key) === null) return null
  }
  return certificate
}

function isNotFound(cause: unknown): boolean {
  return typeof cause === 'object' && cause !== null && (cause as { code?: string }).code === 'ENOENT'
}
