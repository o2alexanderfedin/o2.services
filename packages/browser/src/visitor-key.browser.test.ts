import { ed25519 } from '@noble/curves/ed25519.js'
import { subtleUserSigner } from '@o2/core'
import { afterEach, describe, expect, it } from 'vitest'
import type { IdentityProtection } from '@o2/libp2p'
import { openDB } from 'idb'
import {
  VISITOR_DB,
  VisitorKeyNeedsAPassphraseError,
  canHoldVisitorKey,
  forgetVisitorKey,
  visitorKeyPair,
  visitorOperatorId,
} from './visitor-key.ts'

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

/**
 * The passphrase every case below seals under — `AUTH-07`.
 *
 * Four ordinary words, over `PASSPHRASE_MIN_LENGTH`. It is a *constant* rather than each case
 * inventing one, because a case that sealed under its own string and opened under the same
 * string would pass even if the two never met the KDF at all.
 */
const SEALED_UNDER: IdentityProtection = {
  kind: 'passphrase',
  passphrase: 'correct horse battery staple',
}

describe('the visitor key is minted here and cannot be read here', () => {
  it('reports this origin as one that can hold such a key', () => {
    // Vitest browser mode serves from `http://localhost`, which IS a secure context — so a
    // pass here is a statement about localhost and HTTPS and says nothing about
    // `http://laptop.local`. `insecure-context.browser.test.ts` owns that reading.
    expect(canHoldVisitorKey()).toBe(true)
  })

  it('refuses to export the private half, which is the whole property', async () => {
    const pair = await visitorKeyPair(SEALED_UNDER, freshDb('export'))
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
    const pair = await visitorKeyPair(SEALED_UNDER, freshDb('interop'))
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
    const first = await visitorKeyPair(SEALED_UNDER, db)
    const firstSigner = await subtleUserSigner(first)

    // A second `visitorKeyPair` on the same name is what a reload does: a fresh `openDB`,
    // a fresh `get`, and either the stored handle or a newly minted key. If the structured
    // clone had not carried the handle, this would mint and the two keys would differ.
    const second = await visitorKeyPair(SEALED_UNDER, db)
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
    const first = await visitorOperatorId(await visitorKeyPair(SEALED_UNDER, db))
    const second = await visitorOperatorId(await visitorKeyPair(SEALED_UNDER, db))
    expect(second, 'quorum anti-affinity is by operator, and one device is one operator').toBe(first)
    expect(first.startsWith('visitor:'), 'the derived form must be legible in a log line').toBe(true)
  })

  it('forgets it on withdrawal, and the next key is a different one', async () => {
    const db = freshDb('forget')
    const before = await subtleUserSigner(await visitorKeyPair(SEALED_UNDER, db))
    await forgetVisitorKey(db)
    const after = await subtleUserSigner(await visitorKeyPair(SEALED_UNDER, db))
    expect(
      after.userKey,
      'a withdrawal that left the key behind would be a preference, not a withdrawal',
    ).not.toBe(before.userKey)
  })

  it('keeps two origins’ keys apart, so one database is not every visitor', async () => {
    const a = await subtleUserSigner(await visitorKeyPair(SEALED_UNDER, freshDb('scope-a')))
    const b = await subtleUserSigner(await visitorKeyPair(SEALED_UNDER, freshDb('scope-b')))
    expect(b.userKey).not.toBe(a.userKey)
  })
})

/** Hex to bytes, local so this spec depends on nothing but the module under test. */
function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

/**
 * `AUTH-07` criterion 2 — the visitor's key is ciphertext at rest.
 *
 * The owner's rule, 2026-09-06: *"Ключ в открытом виде не должен быть записан нигде."* This
 * key was the counter-example that produced the rule — `exportKey` refuses it, and its whole
 * PKCS#8 was measured lying in a Chromium and a Firefox profile in the clear
 * (`.planning/consults/2026-09-06-non-extractable-keys-and-a-disk-image.md`).
 *
 * **What is read here is the RECORD, not the handle.** A `CryptoKey` in the store is the
 * pre-`AUTH-07` shape and is the whole defect; an envelope is the fix. So the store is opened
 * directly rather than through the module, because the module's job is to hide what these
 * cases exist to look at.
 */
describe('AUTH-07 criterion 2 — what the store holds is an envelope, not a key', () => {
  /** Every value in the visitor store, as stored, with no interpretation. */
  async function dump(name: string): Promise<{ key: string; value: unknown }[]> {
    const db = await openDB(name, 1, {
      upgrade(database) {
        if (!database.objectStoreNames.contains('visitor')) database.createObjectStore('visitor')
      },
    })
    try {
      const keys = await db.getAllKeys('visitor')
      const out: { key: string; value: unknown }[] = []
      for (const key of keys) {
        out.push({ key: String(key), value: await db.get('visitor', key) })
      }
      return out
    } finally {
      db.close()
    }
  }

  it('holds no CryptoKey — with the pre-change shape shown being seen, or the absence is worthless', async () => {
    const name = freshDb('shape')

    // ---- THE POSITIVE CONTROL, and it runs first. The pre-`AUTH-07` record is planted and
    // the reader is shown finding it. Without this the assertion below passes just as well on
    // an empty store, which is a failure this repository has already had to reopen once.
    const planted = await crypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify'])
    const seed = await openDB(name, 1, {
      upgrade(database) {
        if (!database.objectStoreNames.contains('visitor')) database.createObjectStore('visitor')
      },
    })
    await seed.put('visitor', planted, 'user-key-pair')
    seed.close()

    const before = await dump(name)
    expect(
      before.some((row) => row.value instanceof Object && 'privateKey' in row.value),
      'the reader cannot see a key pair this case planted itself, so it could not have seen '
        + 'one it did not plant either — every absence below would be worthless',
    ).toBe(true)

    // ---- Now the real thing. Minting must delete the legacy record rather than keep it: it
    // cannot be sealed, because a non-extractable key has no bytes to give.
    const pair = await visitorKeyPair(SEALED_UNDER, name)
    expect(pair.privateKey.extractable, 'the handle must still be non-extractable').toBe(false)

    const after = await dump(name)
    expect(
      after.map((row) => row.key),
      'the pre-AUTH-07 plaintext record survived, so the rule is broken on the record this '
        + 'requirement was opened for',
    ).not.toContain('user-key-pair')
    for (const row of after) {
      expect(
        row.value instanceof CryptoKey,
        `${row.key} holds a CryptoKey — the shape whose private half was measured on disk`,
      ).toBe(false)
      const nested: unknown = row.value
      if (typeof nested === 'object' && nested !== null && 'privateKey' in nested) {
        expect.fail(`${row.key} holds a key pair, which is the pre-AUTH-07 shape`)
      }
    }
  })

  it('stores the public half in the clear and nothing else in the clear', async () => {
    const name = freshDb('public')
    const pair = await visitorKeyPair(SEALED_UNDER, name)
    const rows = await dump(name)
    expect(rows.map((row) => row.key)).toEqual(['user-key-sealed'])

    const record: unknown = rows[0]?.value
    if (typeof record !== 'object' || record === null) return expect.fail('no record stored')
    const spki: unknown = 'spki' in record ? record.spki : null
    expect(spki instanceof Uint8Array, 'the public half must be stored as bytes').toBe(true)
    if (!(spki instanceof Uint8Array)) return

    // It is the PUBLIC half and not something else wearing the name — read against the handle
    // the module just returned, which is the only thing that can settle it.
    const exported = new Uint8Array(await crypto.subtle.exportKey('spki', pair.publicKey))
    expect(
      [...spki],
      'the value stored in the clear is not this key pair\'s public half',
    ).toEqual([...exported])
  })

  it('refuses a wrong passphrase by name, and does not mint a second identity', async () => {
    // Criterion 4 of Phase 42, one artefact over, and it matters here for the same reason: a
    // silent re-mint would make this browser a different operator with nothing saying so.
    const name = freshDb('wrong')
    const first = await subtleUserSigner(await visitorKeyPair(SEALED_UNDER, name))

    await expect(
      visitorKeyPair({ kind: 'passphrase', passphrase: 'a different four word phrase' }, name),
      'a wrong passphrase must refuse rather than mint',
    ).rejects.toThrow()

    // And the original still opens — the refusal changed nothing.
    const again = await subtleUserSigner(await visitorKeyPair(SEALED_UNDER, name))
    expect(
      again.userKey,
      'the refusal cost this browser its identity, which is worse than the defect it prevents',
    ).toBe(first.userKey)
  })

  it('refuses to mint for a caller that will write no new secret', async () => {
    const name = freshDb('nosecret')
    await expect(
      visitorKeyPair({ kind: 'writes-no-new-secret' }, name),
      'a key minted here would be written in the clear, and one minted per visit would report '
        + 'one person as a different operator every time',
    ).rejects.toThrow(VisitorKeyNeedsAPassphraseError)
    expect(await dump(name), 'the refusal wrote something').toEqual([])
  })
})
