/**
 * A pure-JS `crypto.subtle.digest` for origins that have no `crypto.subtle` at all.
 *
 * ## The failure this exists to remove
 *
 * A page served from a LAN address — `http://10.144.82.249:5173`, which is exactly what a
 * phone reaches a laptop's demo on — is **not a secure context**, so `crypto.subtle` is
 * `undefined` while `crypto.getRandomValues` still works. `packages/core/src/hash.ts`
 * already carries the measurement and the reasoning for the fabric's *own* hashing: it
 * dropped `multiformats/hashes/sha2` for `@noble/hashes` precisely because the former's
 * browser entry is `crypto.subtle.digest('SHA-256', data)`.
 *
 * That fix reaches every import this repository writes. It cannot reach the ones it does
 * not write. `@libp2p/kad-dht@16.4.0` — added to the browser tier in `ee64f24` — computes
 * every Kademlia ID through that same import:
 *
 * ```
 * RoutingTable.start → ClosestPeers.start → convertPeerId → convertBuffer
 *   → sha256.digest        (multiformats/hashes/sha2, browser condition)
 *   → crypto.subtle.digest (undefined)
 * ```
 *
 * so a tab on a LAN origin threw `TypeError: Cannot read properties of undefined (reading
 * 'digest')` out of `libp2p.start()` and never joined at all. Measured, not reasoned:
 * `seed-discovery.e2e.test.ts`'s *"discovers the relay from a non-secure LAN origin and
 * reserves on it"* produced exactly that stack.
 *
 * ## Why a global rather than a build alias
 *
 * A `resolve.alias` for `multiformats/hashes/sha2` would fix the demo bundle and nothing
 * else. The project's stated constraint is one build for browser, Node and host-embedded
 * use, and "embedded in a host app" means an ESM import into *somebody else's* bundler —
 * which would silently not have the alias. The dependency is a **runtime** platform
 * dependency inside third-party code, so the repair has to be at runtime too.
 *
 * ## Why `digest` and deliberately nothing else
 *
 * This installs a one-method object. That is not minimalism for its own sake: **adding a
 * second method would break two working fallbacks in this repository.**
 *
 * - `packages/core/src/ed25519-backend.ts`'s `detectCryptoBackend` reads
 *   `globalThis.crypto?.subtle` and, when present, *probes* it with a real
 *   `generateKey({name:'Ed25519'})`. With only `digest` defined that call is `undefined`,
 *   the `TypeError` lands in the existing `catch`, and the noble backend is selected —
 *   the same arm an absent `subtle` selects.
 * - `@libp2p/crypto`'s `keys/ed25519/index.browser.js` memoises WebCrypto Ed25519 support
 *   the same way, in a module-load `try/catch`, through a `crypto.get()` that throws when
 *   `subtle == null`. Either shape of failure memoises `false` and routes to `@noble/curves`.
 *
 * A stub `sign`/`importKey` — even one that throws — would make both of those probes look
 * like a *capable* engine to any caller that tests for presence rather than calling, and
 * would move a working noble path onto a broken WebCrypto one. So: `digest`, and nothing.
 *
 * ## Why it never overwrites a real `crypto.subtle`
 *
 * A secure context gets the platform implementation untouched. This is a fallback for an
 * absent API, not a replacement for a present one, and a page that has WebCrypto should
 * keep its hardware-accelerated hashing.
 *
 * `@noble/hashes` is the same dependency `hash.ts` uses, so there is one SHA-2
 * implementation in this repository and not two. SHA-256 is SHA-256: the CID vectors in
 * the conformance suite are what prove no address moves.
 */

import { sha256, sha384, sha512 } from '@noble/hashes/sha2.js'

/** The digest functions a `crypto.subtle.digest` caller can name, keyed as WebCrypto spells them. */
const ALGORITHMS: Record<string, (input: Uint8Array) => Uint8Array> = {
  'SHA-256': sha256,
  'SHA-384': sha384,
  'SHA-512': sha512,
}

/**
 * The algorithm names this fallback answers to.
 *
 * SHA-1 is absent on purpose rather than by oversight: `@noble/hashes/sha2.js` does not
 * carry it, nothing in the browser tier's dependency set asks for it — `multiformats`
 * names only `SHA-256` and `SHA-512` — and answering with a wrong hash would be worse
 * than refusing. A caller that needs it gets a named error, not a silent substitution.
 */
export const SUPPORTED_DIGEST_ALGORITHMS: readonly string[] = Object.keys(ALGORITHMS)

/** Normalise WebCrypto's `AlgorithmIdentifier` — a string or an `{ name }` object. */
function algorithmName(algorithm: AlgorithmIdentifier): string {
  return (typeof algorithm === 'string' ? algorithm : algorithm.name).toUpperCase()
}

/** Normalise WebCrypto's `BufferSource` — an `ArrayBuffer` or any view over one. */
function bytesOf(data: BufferSource): Uint8Array {
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  }
  return new Uint8Array(data)
}

/**
 * `SubtleCrypto.digest`, in pure JavaScript.
 *
 * Exported for its own spec, and usable directly by a caller that would rather pass a
 * hasher than reach for a global.
 */
export async function subtleDigestFallback(
  algorithm: AlgorithmIdentifier,
  data: BufferSource,
): Promise<ArrayBuffer> {
  const name = algorithmName(algorithm)
  const digest = ALGORITHMS[name]
  if (digest === undefined) {
    throw new Error(
      `unsupported digest algorithm ${name}: this origin has no crypto.subtle (it is not a ` +
        `secure context) and the pure-JS fallback implements ${SUPPORTED_DIGEST_ALGORITHMS.join(', ')}`,
    )
  }
  const out = digest(bytesOf(data))
  // A fresh `ArrayBuffer` rather than `out.buffer`: callers do `new Uint8Array(result)` and
  // a view's backing buffer may be larger than the view.
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer
}

/**
 * Give this realm a `crypto.subtle.digest` if — and only if — it has no `crypto.subtle`.
 *
 * Returns `true` when it installed one, `false` when the platform already had WebCrypto
 * (a secure context, and every Node runtime) or when there is no `crypto` global to
 * extend at all. Idempotent: a second call after a first sees `subtle` defined and does
 * nothing.
 *
 * Defined as an **own** property with `Object.defineProperty`, because `subtle` is an
 * accessor on `Crypto.prototype` and a plain assignment to it does not take.
 * `configurable: true` so a test can restore whatever was there before.
 *
 * Called from `BrowserNode.#compose` before `createLibp2p`, which is the first thing in
 * this package that reaches third-party hashing — and called there rather than at module
 * scope because this package must import cleanly into a bundler that never runs it.
 */
export function installSubtleDigestFallback(): boolean {
  const webCrypto = globalThis.crypto as Crypto | undefined
  if (webCrypto === undefined) return false
  if (webCrypto.subtle !== undefined) return false

  Object.defineProperty(webCrypto, 'subtle', {
    value: { digest: subtleDigestFallback } as unknown as SubtleCrypto,
    configurable: true,
    writable: true,
    enumerable: false,
  })
  return true
}
