/**
 * Sealed secrets — the behaviour, written before the module.
 *
 * ## Which criterion each block carries
 *
 * - `a sealed secret round-trips` — the mechanism criteria 1 and 4 are later checked
 *   against. Nothing here is criterion 1 itself; criterion 1 is an *absence* assertion
 *   over a store, and this plan builds no store.
 * - `criterion 4 — a wrong passphrase has exactly one outcome` — a refusal by name, on
 *   every arm that can produce one, with no return path from the failure.
 * - `criterion 5 — the envelope carries its own cost parameters` — an envelope sealed
 *   under parameters that are NOT today's defaults still opens. This is the whole plan.
 * - `refusals are distinguishable by name` — a wrong passphrase, an unknown version and
 *   a malformed record are three different errors, because a caller that cannot tell
 *   them apart cannot tell a typo from a corrupted store.
 * - `sealing is synchronous once the key is derived` — the property
 *   `idb-identity-store.ts`'s `loadOrMintSeed` depends on, asserted here rather than
 *   assumed there.
 *
 * ## This file is deliberately un-infixed, and that is the point
 *
 * `vitest.config.ts`'s `node` project includes every `.test.ts` under a package's `src`
 * and excludes
 * `*.browser.test.ts`; its `browser` project includes the same glob and excludes
 * `*.node.test.ts`. A plain `*.test.ts` therefore runs in BOTH — once under Node and three
 * times under chromium, firefox and webkit. That is the cross-arm reading `0c49c42`'s
 * "the KDF runs on both arms unconditionally" paragraph says the one-KDF choice exists to
 * guarantee. Written as two files it would be an argument; written as one it is a
 * measurement.
 *
 * Consequently: **no `Buffer` anywhere in this file.** It does not exist in chromium,
 * firefox or webkit. Bytes are compared with an explicit length-then-index loop rather
 * than with `uint8arrays`' `equals`, because `uint8arrays` is not a declared dependency of
 * `@o2/core` and only resolves here through the root install's hoist — the hazard
 * `packages/node/src/capability-fixture.ts:29-38` records.
 *
 * ## Cheap parameters everywhere except the cases that are about the defaults
 *
 * This file runs once in the node lane and three times in the browser lane, so every case
 * that is not asserting something about `DEFAULT_KDF_PARAMS` derives at
 * {@link CHEAP_PARAMS} instead. Measured on this host today (2026-09-04, Node v23.11.0),
 * warm: cheap 93.3 / 91.8 / 99.6 ms against the defaults' 435.3 / 435.4 / 438.3 ms.
 *
 * ## Three recorded timings, and why no case asserts a millisecond figure
 *
 * The identical parameters `{ t: 2, m: 19_456, p: 1, dkLen: 32 }` are on record at:
 *
 *   374.4 ms — `0c49c42^:packages/core/src/cert-lifecycle.ts`, Node v25.9.0, 2026-08-10
 *   436   ms — this host, Node v23.11.0, 2026-09-04 (the plan's own probe)
 *   501.5 ms — this host, Node v23.11.0, 2026-09-04 (a second probe, same session)
 *
 * A 34 % spread across two hosts. An absolute bound would encode one machine and fail on
 * the other two readings, so the only timing assertion in this file is a RATIO taken
 * inside one run, per `CLAUDE.md` § Measurement.
 */

import { describe, expect, it } from 'vitest'
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'
import { fromBase64Url, toBase64Url } from './capability.ts'
import {
  DEFAULT_KDF_PARAMS,
  SEAL_VERSION,
  type SealKdfParams,
  type SealedSecret,
  SealedSecretShapeError,
  SealedSecretVersionError,
  SecretUnlockError,
  deriveSealKey,
  openSecret,
  openWithKey,
  parseSealedSecret,
  sealHeaderBytes,
  sealSecret,
  sealWithKey,
  sealedUnderSameKey,
} from './sealed-secret.ts'

/**
 * The cost every case that is not about the defaults uses. See the file docblock.
 *
 * Deliberately NOT `DEFAULT_KDF_PARAMS` — and deliberately different from it in BOTH
 * `t` and `m`, so criterion 5's fixture case has two fields to see rather than one.
 */
const CHEAP_PARAMS: SealKdfParams = { t: 1, m: 8192, p: 1, dkLen: 32 }

/** A deterministic 32 bytes, so a failure quotes the same values every run. */
function secret32(): Uint8Array {
  const out = new Uint8Array(32)
  for (let i = 0; i < out.length; i++) out[i] = (i * 7 + 3) & 0xff
  return out
}

/** No `Buffer`, no `uint8arrays`. See the file docblock. */
function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

/**
 * Run `fn` and return whatever it threw, or `undefined` if it did not throw.
 *
 * Written rather than using `rejects.toThrow` alone because every refusal in this file is
 * asserted BY NAME, and a matcher that only proves "something threw" cannot tell
 * `SecretUnlockError` from `SealedSecretShapeError` — which is the distinction three of
 * these cases exist to make.
 */
async function rejection(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn()
    return undefined
  } catch (thrown: unknown) {
    return thrown
  }
}

function nameOf(thrown: unknown): string {
  return thrown instanceof Error ? thrown.name : `not an Error: ${typeof thrown}`
}

function messageOf(thrown: unknown): string {
  return thrown instanceof Error ? thrown.message : ''
}

const PASSPHRASE = 'a correct horse battery staple xxx'

/**
 * CRITERION 5's fixture: an envelope produced under `{ t: 1, m: 8192, p: 1, dkLen: 32 }`,
 * which is NOT what `DEFAULT_KDF_PARAMS` holds.
 *
 * **Generated once and pasted in as a literal. Never regenerated, never recomputed by the
 * suite.** A fixture the suite recomputes derives its parameters from the code under test
 * and therefore cannot see a change in that code's defaults — it would pass identically on
 * a build that had hard-wired `DEFAULT_KDF_PARAMS` into `openSecret`, which is exactly the
 * defect this case exists to catch (planted as task 3's plant B).
 */
const OLD_PARAMS_FIXTURE: SealedSecret = {
  v: 1,
  kdf: 'argon2id',
  kdfVersion: 19,
  t: 1,
  m: 8192,
  p: 1,
  dkLen: 32,
  salt: 'KFbKCD_Yrz83jnToLyWe3A',
  aead: 'xchacha20poly1305',
  nonce: 'uuIObO7o0LAdpiY2pOrydti_SELpN7gb',
  ciphertext: 'bSwcTUlZtft9PbiS7wVl3i8xqbfPlcZwBEiK9i-1RszyRbmBCMm0XzLeYtjoqjVw',
}

/** The passphrase {@link OLD_PARAMS_FIXTURE} was sealed under. */
const OLD_PARAMS_FIXTURE_PASSPHRASE = 'the fixture passphrase, twenty plus'

/** The 32 bytes {@link OLD_PARAMS_FIXTURE} holds — written out, not recomputed. */
const OLD_PARAMS_FIXTURE_SECRET = new Uint8Array([
  0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 0x0f, 0x1e, 0x2d,
  0x3c, 0x4b, 0x5a, 0x69, 0x78, 0x87, 0x96, 0xa5, 0xb4, 0xc3, 0xd2, 0xe1, 0xf0,
])

describe('a sealed secret round-trips', () => {
  it('opens under the passphrase that sealed it', async () => {
    const secret = secret32()
    const envelope = await sealSecret(secret, PASSPHRASE, CHEAP_PARAMS)
    const opened = await openSecret(envelope, PASSPHRASE)
    expect(bytesEqual(opened, secret)).toBe(true)
    expect(opened.length).toBe(32)
  }, 60_000)

  it('gives two seals of one secret different salts and different nonces, and opens both', async () => {
    const secret = secret32()
    const first = await sealSecret(secret, PASSPHRASE, CHEAP_PARAMS)
    const second = await sealSecret(secret, PASSPHRASE, CHEAP_PARAMS)
    // A fixed salt would make two identities sealed under one passphrase share a key.
    expect(first.salt).not.toBe(second.salt)
    expect(first.nonce).not.toBe(second.nonce)
    expect(first.ciphertext).not.toBe(second.ciphertext)
    expect(bytesEqual(await openSecret(first, PASSPHRASE), secret)).toBe(true)
    expect(bytesEqual(await openSecret(second, PASSPHRASE), secret)).toBe(true)
  }, 60_000)
})

describe('criterion 4 — a wrong passphrase has exactly one outcome, a named throw', () => {
  it('refuses by name, and the message names BOTH possibilities because the AEAD cannot tell them apart', async () => {
    const envelope = await sealSecret(secret32(), PASSPHRASE, CHEAP_PARAMS)
    const thrown = await rejection(() => openSecret(envelope, 'not the passphrase at all'))
    expect(nameOf(thrown)).toBe('SecretUnlockError')
    expect(thrown).toBeInstanceOf(SecretUnlockError)
    // Measured: noble reports `Error("invalid tag")` for a wrong key AND for a tampered
    // header, and `subtle` reports the identical DOMException for both. A message that
    // claimed to know which had happened would be claiming something the primitive does
    // not tell it.
    const message = messageOf(thrown).toLowerCase()
    expect(message).toContain('passphrase')
    expect(message).toContain('altered')
  }, 60_000)

  it('never returns plaintext on a wrong passphrase — the call rejects, it does not resolve', async () => {
    const envelope = await sealSecret(secret32(), PASSPHRASE, CHEAP_PARAMS)
    await expect(openSecret(envelope, 'still not the passphrase')).rejects.toThrow(SecretUnlockError)
    // The positive control: the same envelope under the RIGHT passphrase DOES resolve, so
    // a build where `openSecret` rejected unconditionally could not pass this pair.
    await expect(openSecret(envelope, PASSPHRASE)).resolves.toBeInstanceOf(Uint8Array)
  }, 60_000)

  it('refuses a tampered ciphertext the same way', async () => {
    const envelope = await sealSecret(secret32(), PASSPHRASE, CHEAP_PARAMS)
    const bytes = fromBase64Url(envelope.ciphertext)
    bytes[0] = (bytes[0] ?? 0) ^ 0x01
    const tampered: SealedSecret = { ...envelope, ciphertext: toBase64Url(bytes) }
    expect(nameOf(await rejection(() => openSecret(tampered, PASSPHRASE)))).toBe('SecretUnlockError')
  }, 60_000)

  it('refuses a tampered header', async () => {
    const envelope = await sealSecret(secret32(), PASSPHRASE, CHEAP_PARAMS)
    expect(envelope.m).toBe(8192)
    const tampered: SealedSecret = { ...envelope, m: 8 }
    expect(nameOf(await rejection(() => openSecret(tampered, PASSPHRASE)))).toBe('SecretUnlockError')
  }, 60_000)

  /**
   * The case above cannot see the property its name claims, and this one can.
   *
   * Rewriting `m` changes the DERIVED KEY as well as the header, so the refusal it
   * observes is produced by key derivation alone — a build that passed no additional data
   * to the AEAD at all would pass it identically. That is the blind-instrument class this
   * repository keeps finding, so the claim "the header is authenticated" is carried here
   * instead: same key, same nonce, same ciphertext, additional data present versus absent.
   */
  it('binds the ciphertext to the header bytes, not merely to the key', async () => {
    const secret = secret32()
    const envelope = await sealSecret(secret, PASSPHRASE, CHEAP_PARAMS)
    const key = await deriveSealKey(PASSPHRASE, fromBase64Url(envelope.salt), {
      t: envelope.t,
      m: envelope.m,
      p: envelope.p,
      dkLen: envelope.dkLen,
      version: envelope.kdfVersion,
    })
    const nonce = fromBase64Url(envelope.nonce)
    const ciphertext = fromBase64Url(envelope.ciphertext)
    // With the header as additional data it opens...
    const opened = xchacha20poly1305(key, nonce, sealHeaderBytes(envelope)).decrypt(ciphertext)
    expect(bytesEqual(opened, secret)).toBe(true)
    // ...and with the same key and the same nonce but NO additional data it does not.
    expect(() => xchacha20poly1305(key, nonce, undefined).decrypt(ciphertext)).toThrow()
    // ...nor with a header that differs in a field that does not feed the KDF.
    const shifted: SealedSecret = { ...envelope, v: 7 }
    const otherHeader = sealHeaderBytes(shifted)
    expect(() => xchacha20poly1305(key, nonce, otherHeader).decrypt(ciphertext)).toThrow()
  }, 60_000)
})

describe('criterion 5 — the envelope carries its own cost parameters', () => {
  it('opens a fixture sealed under parameters that are not today defaults, and the defaults really do differ', async () => {
    // Both halves in one case on purpose. The second half is what makes the first half
    // able to see the property: an assertion that the fixture opens is worth nothing
    // unless the code it opens under is running different defaults.
    expect(DEFAULT_KDF_PARAMS.m).toBe(19456)
    expect(DEFAULT_KDF_PARAMS.t).toBe(2)
    expect(OLD_PARAMS_FIXTURE.m).toBe(8192)
    expect(OLD_PARAMS_FIXTURE.t).toBe(1)
    expect(OLD_PARAMS_FIXTURE.m).not.toBe(DEFAULT_KDF_PARAMS.m)
    expect(OLD_PARAMS_FIXTURE.t).not.toBe(DEFAULT_KDF_PARAMS.t)

    const opened = await openSecret(OLD_PARAMS_FIXTURE, OLD_PARAMS_FIXTURE_PASSPHRASE)
    expect(bytesEqual(opened, OLD_PARAMS_FIXTURE_SECRET)).toBe(true)
  }, 60_000)

  it('puts the parameters in the envelope rather than in the code, in a shape JSON and structured clone both survive', async () => {
    const secret = secret32()
    const envelope = await sealSecret(secret, PASSPHRASE, CHEAP_PARAMS)
    for (const field of ['v', 'kdf', 'kdfVersion', 't', 'm', 'p', 'dkLen', 'salt', 'aead', 'nonce', 'ciphertext']) {
      expect(Object.hasOwn(envelope, field)).toBe(true)
    }
    expect(envelope.v).toBe(SEAL_VERSION)
    expect(envelope.kdf).toBe('argon2id')
    expect(envelope.aead).toBe('xchacha20poly1305')
    // Every field is a JSON primitive, so the record survives a JSON file and IndexedDB's
    // structured clone unchanged. A `Uint8Array` field would survive the second and not
    // the first.
    const roundTripped: unknown = JSON.parse(JSON.stringify(envelope))
    const reparsed = parseSealedSecret(roundTripped)
    expect(reparsed).not.toBe(null)
    expect(bytesEqual(await openSecret(roundTripped, PASSPHRASE), secret)).toBe(true)
  }, 60_000)
})

describe('refusals are distinguishable by name', () => {
  it('refuses an unknown envelope version by a different name than a wrong passphrase', async () => {
    const envelope = await sealSecret(secret32(), PASSPHRASE, CHEAP_PARAMS)
    const thrown = await rejection(() => openSecret({ ...envelope, v: 2 }, PASSPHRASE))
    expect(nameOf(thrown)).toBe('SealedSecretVersionError')
    expect(thrown).toBeInstanceOf(SealedSecretVersionError)
    expect(thrown).not.toBeInstanceOf(SecretUnlockError)
  }, 60_000)

  it('refuses a malformed envelope by a third name, and parseSealedSecret returns null rather than throwing', async () => {
    // A stored envelope is external data whether it came off a disk, out of IndexedDB or
    // off a wire, so it is validated at the boundary.
    expect(parseSealedSecret({ v: 1 })).toBe(null)
    expect(parseSealedSecret(null)).toBe(null)
    expect(parseSealedSecret('an envelope, honest')).toBe(null)
    const thrown = await rejection(() => openSecret({ v: 1 } as never, 'x'))
    expect(nameOf(thrown)).toBe('SealedSecretShapeError')
    expect(thrown).toBeInstanceOf(SealedSecretShapeError)
  })

  it('refuses an envelope whose fields are the right names and the wrong types', async () => {
    const envelope = await sealSecret(secret32(), PASSPHRASE, CHEAP_PARAMS)
    expect(parseSealedSecret({ ...envelope, m: '8192' })).toBe(null)
    expect(parseSealedSecret({ ...envelope, salt: 42 })).toBe(null)
    expect(parseSealedSecret({ ...envelope, kdf: 'scrypt' })).toBe(null)
    expect(parseSealedSecret({ ...envelope, aead: 'aes-gcm' })).toBe(null)
    expect(parseSealedSecret({ ...envelope, kdfVersion: 153 })).toBe(null)
    // The positive control: the untouched envelope parses. Without it every assertion
    // above would pass on a `parseSealedSecret` that returned `null` unconditionally.
    expect(parseSealedSecret({ ...envelope })).not.toBe(null)
  }, 60_000)
})

describe('sealing is synchronous once the key is derived', () => {
  it('returns a SealedSecret from sealWithKey with no then property', async () => {
    // The property `IdbIdentityStore.loadOrMintSeed` depends on: awaiting anything that is
    // not part of an IndexedDB transaction lets that transaction commit, and the seal
    // happens beside the `put`. Asserted here rather than assumed in `42-03`.
    const salt = crypto.getRandomValues(new Uint8Array(16))
    const key = await deriveSealKey(PASSPHRASE, salt, CHEAP_PARAMS)
    const result = sealWithKey(key, secret32(), CHEAP_PARAMS, salt)
    expect(typeof (result as { then?: unknown }).then).toBe('undefined')
    expect(result.v).toBe(SEAL_VERSION)
    expect(bytesEqual(await openSecret(result, PASSPHRASE), secret32())).toBe(true)
  }, 60_000)
})

describe('cost is read comparatively, never against a millisecond bound', () => {
  it('costs more at the defaults than at the cheap parameters, by a ratio taken inside one run', async () => {
    const salt = crypto.getRandomValues(new Uint8Array(16))
    // A discarded derivation first, and it is load-bearing. Measured today: the ratio is
    // 2.54 when the CHEAP arm pays the JIT warm-up and 4.40 / 4.66 / 4.74 when it does
    // not, against a work ratio of (19456*2)/(8192*1) = 4.75. A cold first arm would put
    // this assertion within noise of its own bound on a loaded engine.
    await deriveSealKey('a throwaway warm-up passphrase', salt, CHEAP_PARAMS)

    const t0 = performance.now()
    await deriveSealKey(PASSPHRASE, salt, CHEAP_PARAMS)
    const t1 = performance.now()
    await deriveSealKey(PASSPHRASE, salt, DEFAULT_KDF_PARAMS)
    const t2 = performance.now()

    const ratio = (t2 - t1) / (t1 - t0)
    // Printed, not merely asserted: a ratio that only ever becomes a boolean cannot be
    // compared against the next run, and this file executes on four runtimes whose
    // absolute costs differ by more than the property under test does.
    console.log(
      `[sealed-secret kdf] cheap ${(t1 - t0).toFixed(1)} ms, defaults ${(t2 - t1).toFixed(1)} ms, ratio ${ratio.toFixed(2)}`,
    )
    // A ratio taken inside one run, per `CLAUDE.md` § Measurement: it cancels the machine,
    // the load and the engine, all three of which differ across the four runtimes this
    // file executes on. No millisecond figure is asserted anywhere in this file.
    expect(ratio).toBeGreaterThan(2)
  }, 120_000)
})

describe('opening with an already-derived key — the synchronous counterpart of sealWithKey', () => {
  it('opens with the key it was sealed under, synchronously, and yields the same bytes', async () => {
    const salt = crypto.getRandomValues(new Uint8Array(16))
    const key = await deriveSealKey(PASSPHRASE, salt, CHEAP_PARAMS)
    const envelope = sealWithKey(key, secret32(), CHEAP_PARAMS, salt)

    const opened = openWithKey(key, envelope)
    // Synchronous, for the reason `sealWithKey` is: `idb-identity-store.ts` opens inside
    // the same IndexedDB transaction it reads in, and awaiting a non-transaction promise
    // there commits the transaction out from under the check.
    expect(typeof (opened as unknown as { then?: unknown }).then).toBe('undefined')
    expect(bytesEqual(opened, secret32())).toBe(true)
  }, 60_000)

  it('refuses a key that is not the one it was sealed under, by name and with no return path', async () => {
    const salt = crypto.getRandomValues(new Uint8Array(16))
    const key = await deriveSealKey(PASSPHRASE, salt, CHEAP_PARAMS)
    const other = await deriveSealKey('a completely different passphrase', salt, CHEAP_PARAMS)
    const envelope = sealWithKey(key, secret32(), CHEAP_PARAMS, salt)

    let thrown: unknown = 'nothing was thrown, which is the fail-open this case forbids'
    try {
      openWithKey(other, envelope)
    } catch (cause: unknown) {
      thrown = cause
    }
    expect(thrown instanceof Error ? thrown.name : `not an Error: ${JSON.stringify(thrown)}`).toBe(
      'SecretUnlockError',
    )
  }, 60_000)

  it('binds to the header bytes here too, not merely to the key', async () => {
    // The same reading `binds the ciphertext to the header bytes` takes of `openSecret`,
    // applied to the second decrypt path — because two decrypt paths is exactly how an
    // additional-data construction drifts, and `sealHeaderBytes`' own doc records an
    // instrument that could not see that drift.
    const salt = crypto.getRandomValues(new Uint8Array(16))
    const key = await deriveSealKey(PASSPHRASE, salt, CHEAP_PARAMS)
    const envelope = sealWithKey(key, secret32(), CHEAP_PARAMS, salt)
    // `v` does not feed the KDF at all, so a build that authenticated nothing would open
    // this happily. The version check has to be stepped around, so the altered field is
    // `aead`... which `parseSealedSecret` pins. `kdf` likewise. What is left that is
    // authenticated and neither parsed-for nor key-feeding is the nonce, so the nonce is
    // moved and the ORIGINAL nonce is handed to the cipher directly below.
    const movedNonce = toBase64Url(crypto.getRandomValues(new Uint8Array(24)))
    const altered: SealedSecret = { ...envelope, nonce: movedNonce }
    let thrown: unknown = 'nothing was thrown'
    try {
      // Decrypted with the envelope's true nonce and the ALTERED header, so the key and the
      // nonce are both right and only the additional data differs.
      xchacha20poly1305(key, fromBase64Url(envelope.nonce), sealHeaderBytes(altered)).decrypt(
        fromBase64Url(envelope.ciphertext),
      )
    } catch (cause: unknown) {
      thrown = cause
    }
    expect(thrown instanceof Error ? thrown.message : 'no error').toContain('invalid tag')
  }, 60_000)

  it('sealedUnderSameKey says yes only when every field the key was derived from agrees', async () => {
    const salt = crypto.getRandomValues(new Uint8Array(16))
    const other = crypto.getRandomValues(new Uint8Array(16))
    const key = await deriveSealKey(PASSPHRASE, salt, CHEAP_PARAMS)
    const envelope = sealWithKey(key, secret32(), CHEAP_PARAMS, salt)

    expect(sealedUnderSameKey(envelope, CHEAP_PARAMS, salt)).toBe(true)
    // A different salt derives a different key, whatever the cost parameters say.
    expect(sealedUnderSameKey(envelope, CHEAP_PARAMS, other)).toBe(false)
    // And each cost field on its own, because a predicate that compared four of the five
    // would be right about every envelope this build writes and wrong about the one case
    // it exists for.
    expect(sealedUnderSameKey(envelope, { ...CHEAP_PARAMS, t: CHEAP_PARAMS.t + 1 }, salt)).toBe(false)
    expect(sealedUnderSameKey(envelope, { ...CHEAP_PARAMS, m: CHEAP_PARAMS.m * 2 }, salt)).toBe(false)
    expect(sealedUnderSameKey(envelope, { ...CHEAP_PARAMS, p: CHEAP_PARAMS.p + 1 }, salt)).toBe(false)
    expect(sealedUnderSameKey(envelope, { ...CHEAP_PARAMS, dkLen: 16 }, salt)).toBe(false)
    expect(sealedUnderSameKey(envelope, { ...CHEAP_PARAMS, version: 0x10 }, salt)).toBe(false)
  }, 60_000)
})
