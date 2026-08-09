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
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { SEED_BYTES, generateSeed, parseKeyHex } from '@o2/libp2p'
import { parseCertificate } from '@o2/net'
import type { CanonicalValue, NodeCertificate } from '@o2/core'

/** The node's own identity key — the subject of its certificate. */
export const IDENTITY_FILE = '.identity.key'

/** The provider signing key, held only by a process configured to issue certificates. */
export const PROVIDER_FILE = '.provider.key'

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

let tmpSeq = 0

/**
 * Read the seed at `<dir>/<file>`, creating it on first use.
 *
 * Written with the durability discipline `FsBlockstore.put` uses — a `.tmp-` name
 * carrying the pid and a per-call counter, then `rename`, which is atomic within a
 * directory on POSIX — so a process killed mid-write leaves no half-written key and no
 * partially-readable identity.
 */
export async function loadOrCreateSeed(dir: string, file: string): Promise<Uint8Array<ArrayBuffer>> {
  await mkdir(dir, { recursive: true })
  const target = join(dir, file)

  let existing: Buffer | undefined
  try {
    existing = await readFile(target)
  } catch (cause) {
    if (!isNotFound(cause)) throw cause
  }

  if (existing !== undefined) {
    if (existing.length !== SEED_BYTES) throw new MalformedSeedFileError(target, existing.length)
    // Copy out of Node's Buffer pool: a Buffer is a view into a shared slab, so handing
    // it out would alias memory the caller does not own — the same reason
    // `FsBlockstore.get` copies.
    const seed = new Uint8Array(SEED_BYTES)
    seed.set(existing)
    return seed
  }

  const seed = generateSeed()
  const tmp = join(dir, `.tmp-${process.pid}-${tmpSeq++}`)
  await writeFile(tmp, seed, { mode: 0o600 })
  await rename(tmp, target)
  return seed
}

/**
 * Persist a provider-signed certificate beside the identity it names.
 *
 * Same `.tmp-`-then-`rename` sequence `loadOrCreateSeed` uses above, for the same reason:
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
