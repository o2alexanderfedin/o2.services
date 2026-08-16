/**
 * Third-party hashing survives an origin with no `crypto.subtle`.
 *
 * `insecure-context.browser.test.ts` proves the *kernel's* hashing does — it was written
 * when `hash.ts` swapped `multiformats/hashes/sha2` for `@noble/hashes`, and it holds for
 * every import this repository writes. This file is about the imports it does not write.
 *
 * `@libp2p/kad-dht`, added to the browser tier in `ee64f24`, hashes every Kademlia ID
 * through `multiformats/hashes/sha2`, whose browser entry is
 * `crypto.subtle.digest('SHA-256', data)`. On a LAN origin that threw
 * `Cannot read properties of undefined (reading 'digest')` out of `RoutingTable.start`,
 * so `libp2p.start()` rejected and the tab never joined —
 * `seed-discovery.e2e.test.ts`'s LAN case is the reading of that.
 *
 * The e2e case is the end-to-end proof and takes a Chromium and a real LAN address to
 * run. This file is the fast one, and it asserts the two halves that matter separately:
 * that the fallback makes the *actual third-party import* work, and that it stays small
 * enough not to capture the Ed25519 probes that currently fall through to noble.
 */

import { describe, expect, it } from 'vitest'
import { sha256 as multiformatsSha256 } from 'multiformats/hashes/sha2'
import { sha256 as kernelSha256 } from '@o2/core'
import {
  SUPPORTED_DIGEST_ALGORITHMS,
  installSubtleDigestFallback,
  subtleDigestFallback,
} from './subtle-digest-fallback.ts'

/**
 * Run `body` with `crypto.subtle` absent, and put back whatever was there.
 *
 * An **own** property shadowing the prototype accessor, exactly as
 * `insecure-origin.browser.test.ts` does and for the same reason it says: `subtle` lives
 * on `Crypto.prototype`, so `delete crypto.subtle` removes nothing and would leave this
 * file measuring a secure context while claiming otherwise.
 */
async function withoutSubtle<T>(body: () => Promise<T>): Promise<T> {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis.crypto, 'subtle')
  Object.defineProperty(globalThis.crypto, 'subtle', {
    value: undefined,
    configurable: true,
    writable: true,
  })
  try {
    return await body()
  } finally {
    if (descriptor === undefined) {
      Reflect.deleteProperty(globalThis.crypto, 'subtle')
    } else {
      Object.defineProperty(globalThis.crypto, 'subtle', descriptor)
    }
  }
}

const HEX = (bytes: Uint8Array): string =>
  [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')

/** RFC 6234's own vector, hardcoded so this file does not prove SHA-256 against itself. */
const ABC = new TextEncoder().encode('abc')
const ABC_SHA256 = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'

describe('crypto.subtle.digest on an origin that has no crypto.subtle', () => {
  it('is measuring what it claims — subtle is genuinely gone inside the helper, and back after', async () => {
    // Without this, every assertion below would be satisfied by a helper that removed
    // nothing, which is what a plain `delete` does here.
    expect(globalThis.crypto.subtle).toBeDefined()
    await withoutSubtle(async () => {
      expect(globalThis.crypto.subtle).toBeUndefined()
    })
    expect(globalThis.crypto.subtle).toBeDefined()
  })

  it('hashes to the published vector with no WebCrypto anywhere in the call', async () => {
    const digested = await subtleDigestFallback('SHA-256', ABC)
    expect(HEX(new Uint8Array(digested))).toBe(ABC_SHA256)
    // And agrees with the kernel's own hasher, so there is one SHA-256 here and not two.
    expect(HEX((await kernelSha256.digest(ABC)).digest)).toBe(ABC_SHA256)
  })

  it('makes the exact third-party import that broke work again', async () => {
    // `multiformats/hashes/sha2` under the browser condition IS `crypto.subtle.digest`.
    // This is the call `@libp2p/kad-dht`'s `convertBuffer` makes, reached the same way.
    const secure = await multiformatsSha256.digest(ABC)

    const installed = await withoutSubtle(async () => {
      // It throws before the fallback: naming the failure this file exists to remove.
      await expect(multiformatsSha256.digest(ABC)).rejects.toThrow(/digest/)

      expect(installSubtleDigestFallback()).toBe(true)
      // Idempotent — a second call sees `subtle` defined and leaves it alone.
      expect(installSubtleDigestFallback()).toBe(false)
      return multiformatsSha256.digest(ABC)
    })

    // Same multihash, byte for byte — a CID computed on a LAN origin addresses the same
    // block as one computed over HTTPS.
    expect(HEX(installed.bytes)).toBe(HEX(secure.bytes))
    expect(HEX(installed.digest)).toBe(ABC_SHA256)
  })

  it('installs digest and deliberately nothing else, so the Ed25519 probes still reach noble', async () => {
    await withoutSubtle(async () => {
      expect(installSubtleDigestFallback()).toBe(true)
      const subtle = globalThis.crypto.subtle as unknown as Record<string, unknown>

      // `ed25519-backend.ts`'s `detectCryptoBackend` and `@libp2p/crypto`'s browser
      // ed25519 entry both probe by *calling* `generateKey` inside a `try/catch`. Absent
      // here, so both throw, both catch, and both select `@noble/curves` — the same arm
      // an absent `subtle` selects. A stub that merely threw would look like a capable
      // engine to any caller that tests for presence instead of calling.
      expect(subtle['generateKey']).toBeUndefined()
      expect(subtle['sign']).toBeUndefined()
      expect(subtle['verify']).toBeUndefined()
      expect(subtle['importKey']).toBeUndefined()
      expect(Object.keys(subtle)).toEqual(['digest'])
    })
  })

  it('refuses an algorithm it cannot compute rather than answering with the wrong hash', async () => {
    await expect(subtleDigestFallback('SHA-1', ABC)).rejects.toThrow(/unsupported digest algorithm SHA-1/)
    expect(SUPPORTED_DIGEST_ALGORITHMS).toContain('SHA-256')
    expect(SUPPORTED_DIGEST_ALGORITHMS).toContain('SHA-512')
    expect(SUPPORTED_DIGEST_ALGORITHMS).not.toContain('SHA-1')
  })

  it('never replaces a real crypto.subtle', async () => {
    // A secure context keeps the platform implementation. This is a fallback for an
    // absent API, not a replacement for a present one.
    const original = globalThis.crypto.subtle
    expect(installSubtleDigestFallback()).toBe(false)
    expect(globalThis.crypto.subtle).toBe(original)
    expect(typeof globalThis.crypto.subtle.sign).toBe('function')
  })

  it('reads a view without copying its whole backing buffer', async () => {
    // `BufferSource` is an ArrayBuffer or *any view over one*, and a view's buffer is
    // routinely larger than the view. Hashing the buffer would silently produce a
    // different, wrong digest.
    const backing = new Uint8Array([0xff, ...ABC, 0xff])
    const view = backing.subarray(1, 1 + ABC.length)
    expect(HEX(new Uint8Array(await subtleDigestFallback('SHA-256', view)))).toBe(ABC_SHA256)
    // And an ArrayBuffer directly, the other half of `BufferSource`.
    expect(HEX(new Uint8Array(await subtleDigestFallback({ name: 'sha-256' }, ABC.buffer as ArrayBuffer)))).toBe(
      ABC_SHA256,
    )
  })
})
