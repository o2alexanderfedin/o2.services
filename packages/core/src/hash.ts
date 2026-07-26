/**
 * The fabric's one hash function — pure JavaScript, deliberately.
 *
 * `multiformats/hashes/sha2` delegates to `crypto.subtle` in a browser, and
 * **`crypto.subtle` only exists in a secure context**. That is not an exotic
 * restriction: a page served from a LAN address — `http://192.168.1.5:5173`, or
 * `http://my-laptop.local:5173` — is not a secure context, so `crypto.subtle` is
 * `undefined` there and every CID computation throws
 * `Cannot read properties of undefined (reading 'digest')`.
 *
 * Measured, not assumed. The same page, same build, two origins:
 *
 * | Origin                     | `isSecureContext` | `crypto.subtle` | CID |
 * |----------------------------|-------------------|-----------------|-----|
 * | `http://localhost:5178`    | true              | present         | ok  |
 * | `http://10.144.82.249:5178`| false             | **undefined**   | **throws** |
 *
 * The node itself started fine in both — libp2p 3.x signs with `@noble/curves`, not
 * WebCrypto — so the failure surfaced only on the first block written. A phone
 * joining a laptop over the LAN would have connected and then failed at its first
 * task, which is the worst possible place to discover this.
 *
 * `@noble/hashes` is audited, zero-dependency, and identical on every runtime, so
 * using it removes a *runtime* platform dependency the import-scanning purity tests
 * cannot see. SHA-256 is SHA-256: the hardcoded CID vectors in the conformance suite
 * are what prove this substitution changed no address anywhere.
 */

import { sha256 as nobleSha256 } from '@noble/hashes/sha2.js'
import * as hasher from 'multiformats/hashes/hasher'
import type { MultihashHasher } from 'multiformats/hashes/interface'

/** The multicodec code for sha2-256. */
export const SHA256_CODE = 0x12

/**
 * sha2-256 over pure JS.
 *
 * A drop-in replacement for `multiformats/hashes/sha2`'s export, with the same name,
 * code, and output — and no secure-context requirement.
 */
export const sha256: MultihashHasher<typeof SHA256_CODE> = hasher.from({
  name: 'sha2-256',
  code: SHA256_CODE,
  encode: (input: Uint8Array) => nobleSha256(input),
})
