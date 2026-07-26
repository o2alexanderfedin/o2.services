import { BLOCK_VECTORS, blockCid } from '@o2/net'
import { canonicalCid, sha256 } from '@o2/core'
import { describe, expect, it } from 'vitest'

/**
 * The kernel must not need `crypto.subtle`.
 *
 * A page served from a LAN address — `http://192.168.1.5:5173`, or
 * `http://my-laptop.local:5173` — is **not a secure context**, so `crypto.subtle` is
 * `undefined` there. That is the ordinary case for a phone joining a laptop on the
 * same network, not an edge case.
 *
 * It was a real failure: `multiformats/hashes/sha2` delegates to WebCrypto in the
 * browser, so every CID computation threw `Cannot read properties of undefined
 * (reading 'digest')` on a LAN origin. The node itself started fine — libp2p signs
 * with `@noble/curves` — so it only surfaced on the first block written.
 *
 * The import-scanning purity tests cannot catch this: it is a *runtime* platform
 * dependency, not an import of `node:` or a DOM global. Hence this test, which
 * removes `crypto.subtle` and requires the hashing path to carry on regardless.
 */

/** Run `body` with `crypto.subtle` removed, restoring it afterwards. */
async function withoutSubtle<T>(body: () => Promise<T>): Promise<T> {
  const original = Object.getOwnPropertyDescriptor(globalThis.crypto, 'subtle')
  Object.defineProperty(globalThis.crypto, 'subtle', { configurable: true, get: () => undefined })
  try {
    return await body()
  } finally {
    if (original === undefined) {
      Reflect.deleteProperty(globalThis.crypto, 'subtle')
    } else {
      Object.defineProperty(globalThis.crypto, 'subtle', original)
    }
  }
}

describe('hashing without a secure context', () => {
  it('confirms the test actually removes crypto.subtle', async () => {
    // Otherwise everything below would pass for the wrong reason.
    expect(crypto.subtle).toBeDefined()
    await withoutSubtle(async () => {
      expect(crypto.subtle).toBeUndefined()
    })
    expect(crypto.subtle).toBeDefined()
  })

  it('produces the same CIDs with WebCrypto unavailable', async () => {
    const withCrypto = await Promise.all(BLOCK_VECTORS.map(async (v) => (await blockCid(v.bytes)).toString()))
    const withoutCrypto = await withoutSubtle(async () =>
      Promise.all(BLOCK_VECTORS.map(async (v) => (await blockCid(v.bytes)).toString())),
    )

    expect(withoutCrypto).toEqual(withCrypto)
    // And still the addresses the whole fabric agrees on.
    expect(withoutCrypto).toEqual(BLOCK_VECTORS.map((v) => v.cid))
  })

  it('keeps canonical encoding and the raw hasher working too', async () => {
    await withoutSubtle(async () => {
      const digest = await sha256.digest(new Uint8Array([1, 2, 3]))
      expect(digest.bytes.length).toBeGreaterThan(0)

      const hashed = await canonicalCid({ hello: 'world' })
      expect(hashed.ok).toBe(true)
      if (!hashed.ok) return
      expect(hashed.cid.toString().startsWith('bafyrei')).toBe(true)
    })
  })
})
