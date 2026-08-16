import { readFileSync, statSync } from 'node:fs'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EnrollmentAuthority, requestEnrollment, verifyCertificate } from '@o2/core'
import type { NodeCertificate } from '@o2/core'
import { SEED_BYTES } from '@o2/libp2p'
import { stripComments } from './strip-comments.ts'
import {
  CERTIFICATE_FILE,
  IDENTITY_FILE,
  PROVIDER_FILE,
  loadCertificate,
  loadOrCreateSeed,
  saveCertificate,
} from './identity-store.ts'

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

/**
 * AUTH-01 — the certificate on disk.
 *
 * Every certificate under test is issued by a **real** `EnrollmentAuthority` over a real
 * `requestEnrollment`, never hand-assembled, so the signature is genuine and the tampering
 * case below has something real to break.
 *
 * The five null cases are asserted **next to** the intact round trip on purpose. Five
 * nulls from a function that returned `null` for everything would look identical to five
 * nulls from one that validates; the round trip is the positive control that tells them
 * apart.
 */
describe('AUTH-01 — the certificate on disk', async () => {
  const NODE_SEED = new Uint8Array(SEED_BYTES).fill(0xa1)
  const USER_SEED = new Uint8Array(SEED_BYTES).fill(0xa2)
  const PROVIDER_SEED = new Uint8Array(SEED_BYTES).fill(0xa3)
  const OTHER_NODE_SEED = new Uint8Array(SEED_BYTES).fill(0xa4)

  /** A genuinely signed certificate, over a request built by the production helper. */
  const issue = async (seed: Uint8Array, relayIds: readonly string[] = []): Promise<NodeCertificate> => {
    const authority = new EnrollmentAuthority({
      providerPrivateKey: PROVIDER_SEED,
      maxIssuedPerWindow: 'issues-without-an-aggregate-budget',
      issuance: 'remembers-only-within-this-process',
    })
    // Three parameters, and the middle one is what *signs* rather than a key name:
    // `requestEnrollment` takes `userKey` from the signer, never as a field — which is
    // also why `FabricNodeOptions.enrollment` has to carry something that holds the
    // private half (bytes, or a `CryptoKeyPair`) rather than a hex public key.
    const request = await requestEnrollment(seed, USER_SEED, {
      operatorId: 'harbour-ops',
      discoverability: relayIds.length === 0 ? 'seed' : 'via-relay',
      relayIds,
    })
    const result = authority.enrol(request, Date.now())
    if (!result.ok) throw new Error(`fixture did not enrol: ${result.reason}`)
    return result.certificate
  }

  /** Write a certificate-shaped object straight to the file, bypassing `saveCertificate`. */
  const plant = async (value: unknown): Promise<void> => {
    await writeFile(join(dir, CERTIFICATE_FILE), JSON.stringify(value))
  }

  it('round-trips all nine fields through disk unchanged', async () => {
    const certificate = await issue(NODE_SEED, ['relay-b', 'relay-a'])
    await saveCertificate(dir, certificate)

    const loaded = await loadCertificate(dir)
    expect(loaded).toStrictEqual(certificate)

    // Named individually rather than left to `toStrictEqual` alone, because the two
    // timestamps are the fields a JSON round trip is most likely to hand back as strings
    // and `relayIds` is the one whose ORDER is load-bearing — the authority sorts it, and
    // `payloadOf` sorts it again when verifying, so a reordered array would still verify
    // and would still be a different certificate from the one that was stored.
    expect(loaded?.nodeKey).toBe(certificate.nodeKey)
    expect(loaded?.userKey).toBe(certificate.userKey)
    expect(loaded?.operatorId).toBe(certificate.operatorId)
    expect(loaded?.discoverability).toBe('via-relay')
    expect(loaded?.relayIds).toStrictEqual(['relay-a', 'relay-b'])
    expect(typeof loaded?.issuedAt).toBe('number')
    expect(typeof loaded?.expiresAt).toBe('number')
    expect(loaded?.issuer).toBe(certificate.issuer)
    expect(loaded?.signature).toBe(certificate.signature)
  })

  it('returns null rather than throwing when there is no file at all', async () => {
    expect(await loadCertificate(dir)).toBeNull()
  })

  it('returns null rather than throwing when the file is not JSON', async () => {
    await writeFile(join(dir, CERTIFICATE_FILE), '{ this is not json')
    expect(await loadCertificate(dir)).toBeNull()
  })

  /**
   * `signature` and not `issuer`, and the difference was measured rather than assumed.
   *
   * Dropping `issuer` reddens under **neither** deletion on its own, because the two
   * layers overlap on it: `parseCertificate` rejects a missing `issuer` for want of a
   * string, and so does the `parseKeyHex` narrowing, since `/^[0-9a-f]{64}$/.test(undefined)`
   * coerces to the string `'undefined'` and is false. A field caught twice cannot isolate
   * either check. `signature` is outside the narrowing's three keys, so this assertion
   * reddens for exactly one reason.
   *
   * Reddened by deleting the `parseCertificate(...)` call in `loadCertificate` and
   * returning the `JSON.parse` result cast — measured: this test and the
   * `discoverability` one below both go red, the `parseKeyHex` one does not.
   */
  it('returns null when a required field is missing', async () => {
    const { signature: _dropped, ...withoutSignature } = await issue(NODE_SEED)
    await plant(withoutSignature)
    expect(await loadCertificate(dir)).toBeNull()

    // Dropping `issuer` is refused too — by whichever layer sees it first, which is the
    // point of having both.
    const { issuer: _alsoDropped, ...withoutIssuer } = await issue(NODE_SEED)
    await plant(withoutIssuer)
    expect(await loadCertificate(dir)).toBeNull()
  })

  /** Same deletion reddens this: `discoverability` is `parseCertificate`'s only enum. */
  it('returns null when discoverability is neither seed nor via-relay', async () => {
    await plant({ ...issue(NODE_SEED), discoverability: 'backbone' })
    expect(await loadCertificate(dir)).toBeNull()
  })

  /**
   * The case `parseCertificate` deliberately does **not** catch. It types `nodeKey` as a
   * string and does not judge its shape — correctly, because `@o2/net` is portable and may
   * not import `@o2/libp2p`. So a hand-edited file carrying 64 non-hex characters parses
   * cleanly and is then zero-filled by `fromHex` into a different, valid key downstream,
   * with nothing reporting that the input was never hex.
   *
   * Reddened by deleting the `parseKeyHex` check over `nodeKey`/`userKey`/`issuer`.
   */
  it('returns null when nodeKey is 64 characters of something other than lowercase hex', async () => {
    await plant({ ...issue(NODE_SEED), nodeKey: 'Z'.repeat(64) })
    expect(await loadCertificate(dir)).toBeNull()

    // And the uppercase spelling of a REAL key is refused for the same reason: a
    // `PublicKeyHex` is a string held in `Set`s and `Map`s, and `toHex` only ever emits
    // lowercase, so one key with two spellings is two identities to every string-keyed
    // structure here — including `verifyCertificate`'s `trustedIssuers.has(issuer)`.
    const real = await issue(NODE_SEED)
    await plant({ ...real, issuer: real.issuer.toUpperCase() })
    expect(await loadCertificate(dir)).toBeNull()
  })

  /**
   * The disk path launders nothing, exactly as the wire path does not. A certificate that
   * `loadCertificate` accepts is a certificate that PARSED, never one that is trusted.
   */
  it('loads a certificate whose signature was altered, and verifyCertificate still refuses it by name', async () => {
    const certificate = await issue(NODE_SEED)
    const trusted = new Set([certificate.issuer])

    // Positive control first: intact, from disk, verifies.
    await saveCertificate(dir, certificate)
    const intact = await loadCertificate(dir)
    expect(intact).not.toBeNull()
    expect(verifyCertificate(intact as NodeCertificate, trusted, Date.now()).ok).toBe(true)

    // Flip the final hex digit of the signature to something else in the alphabet.
    const last = certificate.signature.slice(-1)
    const tampered = certificate.signature.slice(0, -1) + (last === '0' ? '1' : '0')
    await plant({ ...certificate, signature: tampered })

    const fromDisk = await loadCertificate(dir)
    expect(fromDisk).not.toBeNull()
    const verdict = verifyCertificate(fromDisk as NodeCertificate, trusted, Date.now())
    expect(verdict.ok).toBe(false)
    if (verdict.ok) throw new Error('unreachable')
    expect(verdict.failure.kind).toBe('bad-signature')
    // The refusal names the right subject, not merely the right kind.
    expect(verdict.reason).toContain(certificate.nodeKey)
  })

  it('leaves no partial file behind after writing', async () => {
    await saveCertificate(dir, await issue(NODE_SEED))
    await saveCertificate(dir, await issue(OTHER_NODE_SEED))
    expect((await readdir(dir)).filter((name) => name.startsWith('.tmp-'))).toStrictEqual([])
    expect(await readdir(dir)).toContain(CERTIFICATE_FILE)
  })

  /** The dot rule, at the point where a third non-block file appears in the directory. */
  it('names the certificate file with a leading dot so FsBlockstore does not count it', () => {
    expect(CERTIFICATE_FILE.startsWith('.')).toBe(true)
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
   * **The stripper here was a line-prefix filter with the mirror-image bugs**, replaced
   * 2026-08-04 by the shared tokenizer. It dropped any line whose first non-space
   * character began `*`, `//` or `/*`, which is wrong in both directions at once: it kept
   * a trailing `// …` comment on a line of code — so a `subtle` named in one would count
   * as a use, a false red — and it deleted whole *code* lines that merely began with a
   * `*` or a `/`, which is a false green.
   *
   * **Neither direction was live, and that is measured rather than assumed.** Across the
   * three files this block reads, the `subtle` counts are identical under both stripper
   * and filter — 0, 0 and 5 — so the replacement changes no verdict here today. What it
   * removes is the standing possibility, in a file whose whole claim is a zero count.
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
