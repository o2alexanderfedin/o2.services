import { readFileSync, statSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SEED_BYTES } from '@o2/libp2p'
import { IDENTITY_FILE, PROVIDER_FILE, loadOrCreateSeed } from './identity-store.ts'

/**
 * AUTH-01 — the identity seed on disk.
 *
 * Node-only: writes real files and reads real modes.
 */

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'o2-identity-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('AUTH-01 — loadOrCreateSeed creates', () => {
  it('writes exactly SEED_BYTES bytes and returns them', async () => {
    const seed = await loadOrCreateSeed(dir, IDENTITY_FILE)
    expect(seed.length).toBe(SEED_BYTES)

    const onDisk = await readFile(join(dir, IDENTITY_FILE))
    expect(onDisk.length).toBe(SEED_BYTES)
    expect(new Uint8Array(onDisk)).toStrictEqual(seed)
  })

  /**
   * A private key readable by every account on the host is not a private key.
   * Reddened by deleting `{ mode: 0o600 }` from the `writeFile` call.
   */
  it('creates the file readable and writable by its owner only', async () => {
    await loadOrCreateSeed(dir, IDENTITY_FILE)
    expect(statSync(join(dir, IDENTITY_FILE)).mode & 0o777).toBe(0o600)
  })

  it('does not alias the bytes it hands back across two calls', async () => {
    const first = await loadOrCreateSeed(dir, IDENTITY_FILE)
    const second = await loadOrCreateSeed(dir, IDENTITY_FILE)
    expect(second).toStrictEqual(first)
    expect(second).not.toBe(first)
    first.fill(0)
    // Mutating one caller's copy must not reach the next caller's.
    const third = await loadOrCreateSeed(dir, IDENTITY_FILE)
    expect(third.some((b) => b !== 0)).toBe(true)
  })
})

describe('AUTH-01 — loadOrCreateSeed reads back', () => {
  /**
   * The whole of "the peer id becomes stable across restarts", reduced to the one fact
   * that makes it true. Reddened by deleting the `readFile` attempt so every call
   * generates.
   */
  it('returns the same bytes on a second call against the same directory', async () => {
    const first = await loadOrCreateSeed(dir, IDENTITY_FILE)
    const second = await loadOrCreateSeed(dir, IDENTITY_FILE)
    expect(second).toStrictEqual(first)
  })

  /**
   * Two names, one function, so the provider signing key and the node identity key
   * cannot accidentally become the same bytes — which is what keeps `issuer !== nodeKey`
   * true and a provider-signed certificate distinguishable from a self-signed one.
   *
   * Reddened by changing `PROVIDER_FILE` to equal `IDENTITY_FILE`.
   */
  it('gives two file names in one directory two different seeds', async () => {
    const identity = await loadOrCreateSeed(dir, IDENTITY_FILE)
    const provider = await loadOrCreateSeed(dir, PROVIDER_FILE)
    expect(provider).not.toStrictEqual(identity)

    // And both are still stable individually.
    expect(await loadOrCreateSeed(dir, IDENTITY_FILE)).toStrictEqual(identity)
    expect(await loadOrCreateSeed(dir, PROVIDER_FILE)).toStrictEqual(provider)
  })

  /**
   * A truncated identity file that silently became a new identity would drop the node out
   * of every peer's verified set with nothing reporting why. Fatal, never regenerated.
   *
   * Reddened by deleting the `if (bytes.length !== SEED_BYTES) throw …` line.
   */
  it('refuses a wrong-length file by name instead of minting a new identity', async () => {
    for (const wrong of [31, 33]) {
      const path = join(dir, IDENTITY_FILE)
      await writeFile(path, new Uint8Array(wrong))

      await expect(loadOrCreateSeed(dir, IDENTITY_FILE)).rejects.toThrow(
        new RegExp(`${wrong} bytes`),
      )
      // The error names the path too, so an operator knows which file to look at.
      await expect(loadOrCreateSeed(dir, IDENTITY_FILE)).rejects.toThrow(/identity\.key/)

      // And it did NOT rewrite the file — a refusal that repaired the thing it refused
      // would be the silent regeneration this test exists to forbid.
      expect((await readFile(path)).length).toBe(wrong)
    }
  })

  /**
   * The crash-mid-write case, inert by construction: `loadOrCreateSeed` writes to a
   * `.tmp-` name and renames, so a leftover temporary is never the identity.
   */
  it('ignores a leftover .tmp- file rather than adopting it or failing', async () => {
    await writeFile(join(dir, '.tmp-99999-0'), new Uint8Array(7))

    const seed = await loadOrCreateSeed(dir, IDENTITY_FILE)
    expect(seed.length).toBe(SEED_BYTES)
    expect(await loadOrCreateSeed(dir, IDENTITY_FILE)).toStrictEqual(seed)
  })

  it('creates the directory when it does not exist yet', async () => {
    const nested = join(dir, 'a', 'b')
    const seed = await loadOrCreateSeed(nested, IDENTITY_FILE)
    expect(seed.length).toBe(SEED_BYTES)
  })
})

describe('AUTH-01 — identity generation does not require a secure context', () => {
  /**
   * The kernel must never require `crypto.subtle`: a LAN `http://` origin is not a secure
   * context, so `subtle` is undefined there while `getRandomValues` works.
   *
   * Comment lines are stripped before counting, because both files' comments *explain*
   * this constraint and an unfiltered count would be self-invalidating.
   *
   * **The limit of this instrument, stated: the insecure-context case is unmeasured.**
   * The grep proves these two files do not name `subtle`. It cannot prove anything about
   * the dependency, and the dependency does touch it — `@libp2p/crypto`'s browser entry
   * evaluates `crypto.get().subtle.generateKey({name:'Ed25519'}, …)` at module load,
   * inside a `try/catch` that returns `false`, so sign/verify fall back to noble rather
   * than breaking. The claim this phase is entitled to is *identity generation and
   * derivation do not require `crypto.subtle`*, not *nothing on this path touches it*.
   * Both vitest projects run on a secure origin, so that branch is never taken anywhere in
   * this repository. What would measure it: serving the demo bundle over plain `http://`
   * on a LAN address and generating an identity in that tab — first runnable under Phase
   * 19's multi-browser standard.
   */
  const stripComments = (source: string): string =>
    source
      .split('\n')
      .filter((line) => {
        const t = line.trim()
        return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*')
      })
      .join('\n')

  const occurrences = (source: string, needle: string): number => source.split(needle).length - 1

  const IDENTITY_SRC = readFileSync(new URL('../../libp2p/src/identity.ts', import.meta.url), 'utf8')
  const IDENTITY_STORE_SRC = readFileSync(new URL('./identity-store.ts', import.meta.url), 'utf8')
  const LIBP2P_BROWSER_ED25519_SRC = readFileSync(
    new URL('../../../node_modules/@libp2p/crypto/dist/src/keys/ed25519/index.browser.js', import.meta.url),
    'utf8',
  )

  it('names crypto.subtle nowhere in either file it owns', () => {
    expect(occurrences(stripComments(IDENTITY_SRC), 'subtle')).toBe(0)
    expect(occurrences(stripComments(IDENTITY_STORE_SRC), 'subtle')).toBe(0)
  })

  /**
   * A zero from an instrument never shown to return non-zero is indistinguishable from an
   * instrument that reads nothing. This runs the identical helper over a file that does
   * contain the string, so the zero above is a reading rather than a silence.
   */
  it('reads a non-zero count from a file that does contain the string', () => {
    expect(occurrences(stripComments(LIBP2P_BROWSER_ED25519_SRC), 'subtle')).toBeGreaterThan(0)
  })

  it('strips comments without emptying the file it is reading', () => {
    // The stripper must not be the reason the count is zero.
    expect(stripComments(IDENTITY_SRC).length).toBeGreaterThan(200)
    expect(occurrences(stripComments(IDENTITY_SRC), 'getPublicKey')).toBeGreaterThan(0)
  })
})
