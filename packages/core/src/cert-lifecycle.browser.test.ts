/**
 * `cert-lifecycle`'s backend selection, proved in a real browser — chromium,
 * firefox, and webkit, per `vitest.config.ts`'s `browser` project matrix.
 *
 * ## What this file proves that `cert-lifecycle.test.ts` cannot
 *
 * `cert-lifecycle.test.ts` runs on real crypto too (Node v25.9.0's `crypto.subtle`
 * happens to support Ed25519, matching the module docblock's finding that the
 * subtle arm is not browser-exclusive) — but it cannot observe *browser* selection
 * behaviour, because it is never served from a browser origin. This file is served
 * by `@vitest/browser-playwright` from `http://localhost`, which every engine
 * treats as a secure context (the "localhost exception"), so `crypto.subtle` is
 * present and `detectCryptoBackend`'s real `generateKey({name:'Ed25519'})` probe is
 * expected to succeed on all three engines — matching the phase brief's measured
 * finding (`subtle` verify: 0.0387 ms chromium / 0.0775 ms firefox / 0.0850 ms
 * webkit; `subtle` is `undefined` entirely on plain-HTTP in all three).
 *
 * `insecure-origin.browser.test.ts` (`@o2/browser`) is this file's counterpart for
 * the *other* branch: it forces `crypto.subtle` absent and proves the noble arm
 * still functions end to end. This file proves the *presence* branch actually
 * selects `subtle` rather than merely being capable of falling back, and proves the
 * two arms agree inside three real engines rather than only inside Node's
 * implementation of the same standards.
 */

import { sha256 } from '@noble/hashes/sha2.js'
import { describe, expect, it } from 'vitest'
import { toHex } from './capability.ts'
// The crypto-backend port moved to `./ed25519-backend.ts` in Phase 28, Plan 28-01,
// which merged this package's two Ed25519 selection paths into one. Import-path edit
// only — not one assertion in this file changed.
import { createCryptoBackend, nobleCryptoBackend, subtleCryptoBackend } from './ed25519-backend.ts'

describe('cert-lifecycle backend selection — browser tier', () => {
  it('runs in a secure context, so the real probe is expected to select subtle', async () => {
    expect(globalThis.isSecureContext).toBe(true)
    expect(globalThis.crypto.subtle).toBeDefined()
  })

  it('selects the subtle arm', async () => {
    const backend = await createCryptoBackend()
    expect(backend.arm).toBe('subtle')
  })

  it('memoises across concurrent callers — one probe, not one per caller', async () => {
    const [a, b, c] = await Promise.all([createCryptoBackend(), createCryptoBackend(), createCryptoBackend()])
    expect(a).toBe(b)
    expect(b).toBe(c)
  })

  it('reports a measured per-verify cost for both arms on this engine', async () => {
    const noble = nobleCryptoBackend()
    const subtle = subtleCryptoBackend()
    const seed = sha256(new TextEncoder().encode('browser-perf-probe'))
    const { ed25519 } = await import('@noble/curves/ed25519.js')
    const publicKey = ed25519.getPublicKey(seed)
    const message = new TextEncoder().encode('measure, do not assume')
    const signature = await noble.signEd25519(seed, message)

    const ITERATIONS = 200
    const nobleStart = performance.now()
    for (let i = 0; i < ITERATIONS; i++) await noble.verifyEd25519(publicKey, signature, message)
    const nobleMs = (performance.now() - nobleStart) / ITERATIONS

    const subtleStart = performance.now()
    for (let i = 0; i < ITERATIONS; i++) await subtle.verifyEd25519(publicKey, signature, message)
    const subtleMs = (performance.now() - subtleStart) / ITERATIONS

    console.info(`[cert-lifecycle perf] noble verify: ${nobleMs.toFixed(4)} ms/op, subtle verify: ${subtleMs.toFixed(4)} ms/op`)
    // Not asserted as a ratio: three engines, headless, shared CI hardware — a
    // threshold here would encode this run's load, not the code. The number is
    // reported for the phase's definition of done, not gated on.
    expect(nobleMs).toBeGreaterThan(0)
    expect(subtleMs).toBeGreaterThan(0)
  })
})

describe('differential (browser engines): the subtle arm and the noble arm agree', () => {
  const noble = nobleCryptoBackend()
  const subtle = subtleCryptoBackend()

  /**
   * NOT byte-identical, measured: this exact assertion, written first as
   * `.toBe` on the hex-encoded bytes, is what caught webkit signing with a
   * synthetic/hedged nonce rather than noble's RFC 8032 canonical deterministic one
   * — a different, still-valid signature for the same seed and message. Node,
   * chromium and firefox all matched noble byte-for-byte; webkit did not. See the
   * module docblock's "Correction made against the browser-tier measurement" note.
   * Mutual verifiability, asserted below, is the property that actually holds on
   * all three engines.
   */
  it('happy path: a signature made on either arm verifies on both arms', async () => {
    const { ed25519 } = await import('@noble/curves/ed25519.js')
    const seed = sha256(new TextEncoder().encode('browser-differential-seed'))
    const publicKey = ed25519.getPublicKey(seed)
    const message = new TextEncoder().encode('agree across engines')
    const fromNoble = await noble.signEd25519(seed, message)
    const fromSubtle = await subtle.signEd25519(seed, message)

    expect(await noble.verifyEd25519(publicKey, fromNoble, message)).toBe(true)
    expect(await subtle.verifyEd25519(publicKey, fromNoble, message)).toBe(true)
    expect(await noble.verifyEd25519(publicKey, fromSubtle, message)).toBe(true)
    expect(await subtle.verifyEd25519(publicKey, fromSubtle, message)).toBe(true)
  })

  it('rejects a wrong-length public key identically on both arms', async () => {
    const message = new TextEncoder().encode('m')
    const signature = new Uint8Array(64)
    const tooShortKey = new Uint8Array(31)
    expect(await noble.verifyEd25519(tooShortKey, signature, message)).toBe(false)
    expect(await subtle.verifyEd25519(tooShortKey, signature, message)).toBe(false)
  })

  it('rejects a bit-flipped signature identically on both arms', async () => {
    const { ed25519 } = await import('@noble/curves/ed25519.js')
    const seed = sha256(new TextEncoder().encode('browser-bit-flip'))
    const publicKey = ed25519.getPublicKey(seed)
    const message = new TextEncoder().encode('do not tamper')
    const signature = await noble.signEd25519(seed, message)
    const tampered = signature.slice()
    tampered[0] = (tampered[0] ?? 0) ^ 0xff

    expect(await noble.verifyEd25519(publicKey, tampered, message)).toBe(false)
    expect(await subtle.verifyEd25519(publicKey, tampered, message)).toBe(false)
  })

  it('rejects a signature checked against the wrong message identically on both arms', async () => {
    const { ed25519 } = await import('@noble/curves/ed25519.js')
    const seed = sha256(new TextEncoder().encode('browser-wrong-message'))
    const publicKey = ed25519.getPublicKey(seed)
    const signed = new TextEncoder().encode('the real message')
    const other = new TextEncoder().encode('a different message')
    const signature = await noble.signEd25519(seed, signed)

    expect(await noble.verifyEd25519(publicKey, signature, other)).toBe(false)
    expect(await subtle.verifyEd25519(publicKey, signature, other)).toBe(false)
  })

  it('X25519 agreement produces the identical shared secret on both arms', async () => {
    const { x25519 } = await import('@noble/curves/ed25519.js')
    const seedA = sha256(new TextEncoder().encode('browser-x25519-a'))
    const seedB = sha256(new TextEncoder().encode('browser-x25519-b'))
    const publicB = x25519.getPublicKey(seedB)

    const sharedFromNoble = await noble.agreeX25519(seedA, publicB)
    const sharedFromSubtle = await subtle.agreeX25519(seedA, publicB)
    expect(toHex(sharedFromNoble)).toBe(toHex(sharedFromSubtle))
  })

  it('X25519 agreement refuses a known low-order peer key identically on both arms', async () => {
    const seed = sha256(new TextEncoder().encode('browser-x25519-low-order'))
    const lowOrderPeer = new Uint8Array(32)

    let nobleThrew = false
    try {
      await noble.agreeX25519(seed, lowOrderPeer)
    } catch {
      nobleThrew = true
    }
    let subtleThrew = false
    try {
      await subtle.agreeX25519(seed, lowOrderPeer)
    } catch {
      subtleThrew = true
    }
    expect(nobleThrew).toBe(true)
    expect(subtleThrew).toBe(true)
  })
})
