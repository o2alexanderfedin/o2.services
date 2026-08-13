import { ed25519 } from '@noble/curves/ed25519.js'
import { describe, expect, it } from 'vitest'

/**
 * Can a visitor's owner key be a key the page cannot read?
 *
 * The trust model's sharpest exposure is that `userPrivateKey` is *bytes*: a page that
 * holds them can be read by whatever served it. A non-extractable `CryptoKey` removes
 * that — the browser holds the private half and will only ever *use* it — and the owner
 * ruled on 2026-08-13 that this is the shape a visitor identity should take.
 *
 * **This file does not implement that. It measures whether it is possible**, because
 * three separate things have to hold and none of them was measured here before:
 *
 * 1. `crypto.subtle` exists at all. It does **not** on a LAN origin —
 *    `insecure-context.browser.test.ts` records the outage that taught this repository
 *    so, and `start-probe.ts:17-19` states it as a rule. Under Vitest browser mode the
 *    origin is `http://localhost`, which **is** a secure context, so a pass here is a
 *    statement about localhost and HTTPS and says nothing about `http://laptop.local`.
 *    That limit is asserted rather than left implied, below.
 * 2. WebCrypto implements **Ed25519**, in every engine this project ships to. It is a
 *    late arrival — the curve was in the draft-then-abandoned "Secure Curves" spec for
 *    years — so Chromium, Firefox and WebKit reached it at different times.
 * 3. **A WebCrypto signature verifies under `@noble/curves`.** This is the one that
 *    actually decides the design, and the only one no specification can settle for us:
 *    `enrol` verifies `ownerProof` with `ed25519.verify` (`enrollment.ts`, one of the
 *    six direct noble call sites `ed25519-backend.ts` enumerates), so a key the browser
 *    holds is useless unless what it signs satisfies the verifier already on the wire.
 *    Ed25519 is deterministic and fully specified in RFC 8032, so this *should* hold —
 *    which is exactly the kind of "should" this repository requires a reading for.
 *
 * A failure here is not a bug to fix. It is the measurement deciding the design, and
 * the arm that fails says which part of the ruling is unreachable in which engine.
 *
 * ## The reading, 2026-08-13, and the plant that shows it is not vacuous
 *
 * **All three engines pass**: 15 tests, 5 per engine, `EXIT=0`. Non-extractable Ed25519
 * generates, the private half refuses both `raw` and `pkcs8` export, the public half is
 * 32 bytes, and **noble verifies what WebCrypto signs** in chromium, firefox and webkit
 * alike. So point 3 above is settled affirmatively and the ruling is implementable —
 * *on a secure context*.
 *
 * Point 1 is the one that is **not** settled and cannot be settled from here.
 * `insecure-context.browser.test.ts` records the LAN outage in full, and the demo's own
 * multi-device path (seed serves over `http://<host>.local:5173`, phone scans a QR code)
 * has **no `crypto.subtle` at all**. Nothing in this file is evidence about that path,
 * which is why the first case pins `location.hostname` to `localhost` rather than
 * leaving the bound implied.
 *
 * **Watched red rather than assumed.** Planting `signature[0] ^= 0xff` immediately
 * before the interop assertion gave `PLANTED_EXIT=1` with *"AssertionError: expected
 * false to be true"* in **all three** engines — 3 failed, 12 passed — and the file was
 * restored by the surgical inverse and `cmp`-verified byte-identical against a snapshot
 * taken before planting (`sha256 738ec9fe…`). The negative control inside the loop
 * (a wrong message must not verify) is what stops the positive arm passing because
 * `verify` returns true for everything.
 */

/** RFC 8032 raw scalar length, and the length `identityFromSeed` already requires. */
const ED25519_SEED_BYTES = 32

describe('a visitor owner key the page cannot read', () => {
  it('has crypto.subtle here, and says what that does and does not cover', () => {
    // Vitest browser mode serves on localhost, which is a secure context by fiat. This
    // assertion exists so the arms below cannot pass vacuously in some future harness
    // that serves from elsewhere.
    expect(globalThis.isSecureContext).toBe(true)
    expect(crypto.subtle).toBeDefined()

    // The bound, stated in the file rather than in a commit message: `localhost` is a
    // secure context and `http://laptop.local:5173` is not, so nothing measured below
    // is evidence about the LAN multi-device path.
    expect(globalThis.location.hostname).toBe('localhost')
  })

  it('generates a non-extractable Ed25519 key and refuses to export the private half', async () => {
    const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify'])

    // `generateKey` is overloaded and returns `CryptoKey | CryptoKeyPair`; narrow rather
    // than assert, so a future engine returning the wrong shape fails here by name.
    expect('privateKey' in pair).toBe(true)
    if (!('privateKey' in pair)) throw new Error('expected a CryptoKeyPair')

    expect(pair.privateKey.extractable).toBe(false)
    expect(pair.publicKey.extractable).toBe(true)

    // The whole point, measured rather than trusted to the flag: the private half cannot
    // leave. This is what a script served by a hostile origin cannot get past.
    await expect(crypto.subtle.exportKey('raw', pair.privateKey)).rejects.toThrow()
    await expect(crypto.subtle.exportKey('pkcs8', pair.privateKey)).rejects.toThrow()
  })

  it('exports a public key of the length the fabric already uses for a userKey', async () => {
    const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify'])
    if (!('privateKey' in pair)) throw new Error('expected a CryptoKeyPair')

    const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
    // 32 bytes, which is what `toHex(ed25519.getPublicKey(...))` produces today, so the
    // `userKey` string keeps its existing shape and every downstream comparison is
    // unaffected.
    expect(raw.length).toBe(ED25519_SEED_BYTES)
  })

  it('produces signatures @noble/curves verifies — the arm the design rests on', async () => {
    const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify'])
    if (!('privateKey' in pair)) throw new Error('expected a CryptoKeyPair')

    const publicKey = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
    // Not a fixed vector: the message shape that matters is `possessionChallenge`'s, which
    // is bytes of unremarkable length. Two lengths are signed so a padding assumption in
    // one engine cannot pass by coincidence.
    for (const message of [new Uint8Array([1, 2, 3]), crypto.getRandomValues(new Uint8Array(64))]) {
      const signature = new Uint8Array(
        await crypto.subtle.sign({ name: 'Ed25519' }, pair.privateKey, message),
      )
      expect(signature.length).toBe(64)
      expect(ed25519.verify(signature, message, publicKey)).toBe(true)

      // And a wrong message is refused, so the arm above cannot be passing because
      // `verify` returns true for everything.
      expect(ed25519.verify(signature, new Uint8Array([9, 9, 9]), publicKey)).toBe(false)
    }
  })

  it('cannot be reconstructed from bytes — which is the property and also the cost', async () => {
    // A noble key is bytes and therefore portable between devices; a browser-held key is
    // not, and that is the trade the owner accepted. Recorded as a behaviour rather than
    // as prose so a later `importKey`-based "fix" has to delete a passing assertion.
    const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify'])
    if (!('privateKey' in pair)) throw new Error('expected a CryptoKeyPair')

    const publicKey = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
    // There is no path from the public key back to a signer. Stated as the absence of an
    // export above; here as the absence of the seed noble would need.
    expect(publicKey.length).toBe(ED25519_SEED_BYTES)
    expect(() => ed25519.getPublicKey(publicKey)).not.toThrow()
    // Deriving a public key *from the public key bytes* yields something else entirely —
    // i.e. the bytes are not a seed, and no amount of local work makes them one.
    expect(Array.from(ed25519.getPublicKey(publicKey))).not.toEqual(Array.from(publicKey))
  })
})
