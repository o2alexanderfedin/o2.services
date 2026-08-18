import { ed25519 } from '@noble/curves/ed25519.js'
import { subtleUserSigner } from '@o2/core'
import { afterEach, describe, expect, it } from 'vitest'
import { canHoldVisitorKey, forgetVisitorKey, visitorKeyPair, visitorOperatorId } from './visitor-key.ts'

/**
 * Does a visitor's key survive a session? — AUTH-01, AUTH-05.
 *
 * ## The open question this closes, quoted from where it was left open
 *
 * `.planning/consults/2026-08-16-visitor-device-key-is-cryptographically-available.md` ends
 * by naming three things it deliberately did not establish, and the first is this one:
 *
 * > It says nothing about **where the key lives across sessions** (IndexedDB stores
 * > `CryptoKey` handles structurally, unmeasured here) …
 *
 * That parenthesis is a plausible claim about the structured clone algorithm, and this
 * repository has been burned twice by a mechanism whose description outran its measurement.
 * So it is measured, in the three engines the browser tier names, on the *production*
 * module — not on a hand-rolled `openDB` in a spec.
 *
 * ## Why it matters, which is not "convenience"
 *
 * A key that did not persist would still enrol. A certificate is bound to the **node** seed,
 * not to the user key, so a fresh key each session would produce a working tab. What it
 * would break is `resolveReplicaSets`: one person's device would report a different
 * `userKey` and a different derived `operatorId` on every reload, so one owner's nodes would
 * resolve as a crowd of strangers, and `composeQuorum`'s anti-affinity would spread a quorum
 * across what is actually one failure domain. Persistence is what makes the user key
 * *stable*, and stability is the property AUTH-05 rests on.
 *
 * It is also the premise the raised `DEFAULT_MAX_PER_WINDOW` was sized against — a bound
 * on issuances per user key means nothing if the user key is new every time.
 *
 * ## The property that must survive the round trip, and it is not the bytes
 *
 * A stored-and-reloaded handle that had become *extractable* would be worse than no
 * persistence at all: the API shape without the property, which is the failure
 * `visitor-key.ts`'s header refuses to allow a polyfill to introduce. So the reload arm
 * asserts the refusal as well as the equality.
 */

/** A database per case, so one case's stored key cannot be another's "reload". */
let dbNames: string[] = []
function freshDb(label: string): string {
  const name = `o2-visitor-test-${label}-${Math.random().toString(36).slice(2)}`
  dbNames.push(name)
  return name
}

afterEach(async () => {
  for (const name of dbNames) await forgetVisitorKey(name).catch(() => {})
  dbNames = []
})

describe('the visitor key is minted here and cannot be read here', () => {
  it('reports this origin as one that can hold such a key', () => {
    // Vitest browser mode serves from `http://localhost`, which IS a secure context — so a
    // pass here is a statement about localhost and HTTPS and says nothing about
    // `http://laptop.local`. `insecure-context.browser.test.ts` owns that reading.
    expect(canHoldVisitorKey()).toBe(true)
  })

  it('refuses to export the private half, which is the whole property', async () => {
    const pair = await visitorKeyPair(freshDb('export'))
    expect(pair.privateKey.extractable, 'a visitor key must not be extractable').toBe(false)
    await expect(
      crypto.subtle.exportKey('pkcs8', pair.privateKey),
      'the page that minted this key must not be able to read it',
    ).rejects.toThrow()
  })

  it('signs something the enrolment provider’s own verifier accepts', async () => {
    // The provider verifies with `@noble/curves` and has no idea WebCrypto exists. This is
    // the cross-implementation agreement the whole design rests on, re-read here over the
    // production module rather than over a locally generated key.
    const pair = await visitorKeyPair(freshDb('interop'))
    const signer = await subtleUserSigner(pair)
    const message = new TextEncoder().encode('a challenge the authority minted')
    const signature = await signer.sign(message)
    expect(
      ed25519.verify(signature, message, hexToBytes(signer.userKey)),
      'noble must accept a WebCrypto signature, or a visitor key is useless to a provider',
    ).toBe(true)
  })
})

describe('the visitor key survives a session, which was unmeasured until now', () => {
  it('returns the same key on a second open of the same database', async () => {
    const db = freshDb('persist')
    const first = await visitorKeyPair(db)
    const firstSigner = await subtleUserSigner(first)

    // A second `visitorKeyPair` on the same name is what a reload does: a fresh `openDB`,
    // a fresh `get`, and either the stored handle or a newly minted key. If the structured
    // clone had not carried the handle, this would mint and the two keys would differ.
    const second = await visitorKeyPair(db)
    const secondSigner = await subtleUserSigner(second)

    expect(
      secondSigner.userKey,
      'a reload must find the key this browser already holds, not mint a second one',
    ).toBe(firstSigner.userKey)
    expect(
      second.privateKey.extractable,
      'a reloaded handle that had become extractable would be the API shape without the property',
    ).toBe(false)
  })

  it('derives one stable operator id from it, so one person is one operator', async () => {
    const db = freshDb('operator')
    const first = await visitorOperatorId(await visitorKeyPair(db))
    const second = await visitorOperatorId(await visitorKeyPair(db))
    expect(second, 'quorum anti-affinity is by operator, and one device is one operator').toBe(first)
    expect(first.startsWith('visitor:'), 'the derived form must be legible in a log line').toBe(true)
  })

  it('forgets it on withdrawal, and the next key is a different one', async () => {
    const db = freshDb('forget')
    const before = await subtleUserSigner(await visitorKeyPair(db))
    await forgetVisitorKey(db)
    const after = await subtleUserSigner(await visitorKeyPair(db))
    expect(
      after.userKey,
      'a withdrawal that left the key behind would be a preference, not a withdrawal',
    ).not.toBe(before.userKey)
  })

  it('keeps two origins’ keys apart, so one database is not every visitor', async () => {
    const a = await subtleUserSigner(await visitorKeyPair(freshDb('scope-a')))
    const b = await subtleUserSigner(await visitorKeyPair(freshDb('scope-b')))
    expect(b.userKey).not.toBe(a.userKey)
  })
})

/** Hex to bytes, local so this spec depends on nothing but the module under test. */
function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}
