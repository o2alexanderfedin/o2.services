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

import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { SEED_BYTES, generateSeed } from '@o2/libp2p'

/** The node's own identity key — the subject of its certificate. */
export const IDENTITY_FILE = '.identity.key'

/** The provider signing key, held only by a process configured to issue certificates. */
export const PROVIDER_FILE = '.provider.key'

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

/** Whether a seed file already exists, without creating one. */
export async function hasSeed(dir: string, file: string): Promise<boolean> {
  try {
    await stat(join(dir, file))
    return true
  } catch (cause) {
    if (isNotFound(cause)) return false
    throw cause
  }
}

function isNotFound(cause: unknown): boolean {
  return typeof cause === 'object' && cause !== null && (cause as { code?: string }).code === 'ENOENT'
}
