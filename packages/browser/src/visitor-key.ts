/**
 * The visitor's own key — the one thing an origin may not supply — AUTH-01, AUTH-04.
 *
 * ## What this is for
 *
 * `enrollment` needs three fields, and they do not come from the same place. `providerAddr`
 * is **discovery**: a seed publishes where a joiner should knock, and `/bootstrap.json`
 * carries it. `userPrivateKey` and `operatorId` are **the visitor's**, and this module is
 * where they come from, precisely so that no code path exists by which the page's origin
 * could name them. `demo/main.ts`'s standing objection — *a page that was found rather than
 * configured must not be configurable by whatever found it* — is enforced here by
 * construction rather than by a rule somebody has to remember: there is no parameter on
 * anything below through which key material can be passed in.
 *
 * ## Why a non-extractable `CryptoKey` and not bytes
 *
 * Measured in three engines on 2026-08-16 and recorded in
 * `.planning/consults/2026-08-16-visitor-device-key-is-cryptographically-available.md`:
 * `crypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify'])` succeeds in
 * chromium, firefox and webkit, and `exportKey('pkcs8', privateKey)` is **refused** in all
 * three. That refusal is the property worth having. The private half is held by the browser
 * outside JavaScript's reach, so **the script this origin served cannot read it** — which
 * is what makes it honest to call it the visitor's key while the visitor is running the
 * origin's code.
 *
 * The same file measured the half that actually carries risk: a signature made by such a
 * key verifies under `@noble/curves`, which is what the enrolment provider uses and which
 * has no idea WebCrypto exists. Both sides are RFC 8032.
 *
 * **A polyfill is not available and must not be attempted.** Any JavaScript implementation
 * holds the material in JavaScript memory, where the origin's own script can read it, so a
 * shim would supply the API shape without the property — strictly worse than absence,
 * because it looks safe. On an origin where `crypto.subtle` is missing (a non-secure one:
 * neither `https:` nor a `localhost`/`127.0.0.1` loopback) {@link visitorKeyPair} refuses by
 * name rather than falling back, and the offer is simply not shown.
 *
 * ## Why it persists, and what that closes
 *
 * The 2026-08-16 consult ends by naming three things it did not establish, and one of them
 * is this: *"nothing about **where the key lives across sessions** (IndexedDB stores
 * `CryptoKey` handles structurally, unmeasured here)"*. `visitor-key.browser.test.ts`
 * measures it, in all three engines, including that the reloaded handle is still
 * non-extractable and still signs something `@noble/curves` accepts.
 *
 * A key that did not persist would still enrol — a certificate is bound to the *node* seed,
 * not to the user key — but every reload would mint a new "user", and `resolveReplicaSets`
 * would see one person's device as a crowd of strangers. Persisting is what makes the user
 * key *stable*, which is the property `AUTH-05` rests on and the one the raised
 * {@link DEFAULT_MAX_PER_WINDOW} was sized against.
 *
 * A separate database from both the blockstore and `IdbIdentityStore`, for
 * `IdbIdentityStore`'s own stated reason applied one level further out: the blockstore is
 * budgeted and evicted as a cache, and a node identity is per-node while this is per-person.
 * Two tabs running as two nodes in one profile are two seeds and **one** visitor.
 *
 * Same-target rules as the rest of `packages/browser/src`: no `node:` imports.
 *
 * **QUALIFIED 2026-08-29: "succeeds" is ~99.2% on Linux WebKit, not 100%.** The 2026-08-16
 * measurement was taken on macOS and holds there; the generalisation to every engine on every
 * platform is what did not. WebKit's Linux WebCrypto backend discards ~0.78% of the keys it
 * draws and reports it as `OperationError` — mechanism, numbers and flip test in
 * `@o2/core`'s `KEYGEN_ATTEMPTS` and
 * `.planning/consults/2026-08-29-webkit-linux-ed25519-keygen-rca.md`. The route below draws
 * through `generateSubtleKeyPair`, which redraws, so this file is not exposed to it. The
 * refusal of `exportKey` — the property this docblock is actually about — is unaffected and
 * holds everywhere measured.
 */

import {
  generateSealableSubtleKeyPair,
  importSealedSubtleKeyPair,
  openSecret,
  parseSealedSecret,
  sealSecret,
  subtleUserSigner,
} from '@o2/core'
import type { SealedSecret } from '@o2/core'
import type { IdentityProtection } from '@o2/libp2p'
import { openDB } from 'idb'
import type { DBSchema, IDBPDatabase } from 'idb'

const STORE = 'visitor'
/**
 * The pre-`AUTH-07` record: a `CryptoKeyPair` stored as handles.
 *
 * **Kept as a name because the record still exists in the wild and must be recognised**, not
 * because anything writes one. See {@link visitorKeyPair} for what happens when one is found
 * and why it cannot be migrated.
 */
const LEGACY_KEY_PAIR_KEY = 'user-key-pair'
/** One record, because a browser profile is one person. */
const SEALED_KEY = 'user-key-sealed'

/**
 * A visitor key as it is stored since `AUTH-07`: the private half sealed, the public half not.
 *
 * `spki` is in the clear deliberately and on the certificate's own reasoning — a public key
 * is published material and encrypting it would protect nothing while costing an unseal on
 * every read. It is a `Uint8Array` rather than a string because IndexedDB stores typed arrays
 * through the structured clone algorithm, so an encoding hop would be two more places for a
 * byte to be rendered wrongly and nothing gained.
 */
interface SealedVisitorKey {
  readonly sealed: SealedSecret
  readonly spki: Uint8Array
}

interface VisitorDb extends DBSchema {
  [STORE]: {
    key: string
    /** The union is the migration: one shape is written, both are readable. */
    value: CryptoKeyPair | SealedVisitorKey
  }
}

/**
 * Thrown when a visitor key is asked for by a caller that will not persist a new secret.
 *
 * **Refusing is the whole point and a per-visit key is not the fallback.** `operatorId` is
 * derived from this key and is the unit `composeQuorum` spreads a quorum across; a visitor
 * who got a new key each visit would report as a new operator each visit, which is a
 * diversity claim about one person, one device and one browser profile. So a caller holding
 * `writes-no-new-secret` gets a named refusal rather than a key that quietly breaks that.
 */
export class VisitorKeyNeedsAPassphraseError extends Error {
  constructor() {
    super(
      'a visitor key cannot be minted without a passphrase to seal it under: this browser '
        + 'holds no sealed visitor key and the caller promised to write no new secret. A key '
        + 'minted here would be written in the clear, and one minted per visit would report '
        + 'one person to the fabric as a different operator every time',
    )
    this.name = 'VisitorKeyNeedsAPassphraseError'
  }
}

/**
 * The database name. Deliberately **not** derived from `blockstoreName`.
 *
 * `IdbIdentityStore.open` takes a name suffixed off the blockstore's so one origin can hold
 * several independent *nodes* — which is what makes a two-tab topology work. The visitor is
 * the opposite: two tabs of one profile are two nodes belonging to **one** person, and
 * giving them two user keys would report one visitor to the fabric as two operators and
 * defeat `composeQuorum`'s anti-affinity. So the name is fixed per origin.
 */
export const VISITOR_DB = 'o2-visitor'

/** Thrown when this origin cannot hold a key the page is unable to read. */
export class InsecureOriginError extends Error {
  constructor() {
    super(
      'this origin cannot hold a visitor key: crypto.subtle is unavailable, which means the ' +
        'page is not a secure context (https:, or a localhost/127.0.0.1 loopback)',
    )
    this.name = 'InsecureOriginError'
  }
}

/**
 * Whether this origin can hold a visitor key at all.
 *
 * Read before the offer is shown, so a visitor on an origin that cannot keep their key
 * outside the page's reach is never invited to enrol. Failing this way round matters: the
 * alternative is to offer, take the click, and refuse — which teaches a visitor that the
 * button is broken rather than that this origin is not one they should hold a key on.
 *
 * Lazy, never at module scope. Environment detection at import time is what breaks the
 * `default` export condition for a host application (Phase 2's rule), and this module is
 * imported by `demo/main.ts` unconditionally.
 */
export function canHoldVisitorKey(): boolean {
  try {
    const subtle: unknown = globalThis.crypto?.subtle
    return typeof subtle === 'object' && subtle !== null
  } catch {
    // A hostile or exotic host can throw on the property access itself. An origin whose
    // capability cannot be *read* is not one to mint a key on, and the collapse to `false`
    // is the same answer as "absent" because the correct response to both is identical.
    return false
  }
}

/**
 * This visitor's key pair — the stored one if there is one, a fresh non-extractable one
 * if there is not.
 *
 * **Generated with `extractable: false`, and that argument is the whole point.** The call
 * itself is `@o2/core`'s {@link generateSubtleKeyPair} rather than an inline
 * `crypto.subtle.generateKey` here — written inline first, and **CRYPTO-01 refused it by
 * path**: `one-crypto-implementation.node.test.ts` asserts exactly one production file
 * performs WebCrypto Ed25519 operations, and this is not that file. The guard was right and
 * the code moved, which is the same trade `subtleUserSigner` took on 2026-08-16.
 *
 * @throws {InsecureOriginError} when this origin has no `crypto.subtle`.
 */
export async function visitorKeyPair(
  protection: IdentityProtection,
  dbName: string = VISITOR_DB,
): Promise<CryptoKeyPair> {
  if (!canHoldVisitorKey()) throw new InsecureOriginError()

  const db = await openVisitorDb(dbName)
  try {
    const stored = await db.get(STORE, SEALED_KEY)
    const envelope = readSealed(stored)
    if (envelope !== null) {
      if (protection.kind !== 'passphrase') throw new VisitorKeyNeedsAPassphraseError()
      const pkcs8 = await openSecret(envelope.sealed, protection.passphrase)
      return await importSealedSubtleKeyPair(pkcs8, envelope.spki)
    }

    // ---- The pre-`AUTH-07` record, and it CANNOT be migrated. `AUTH-07`.
    //
    // The old shape stored a `CryptoKeyPair` generated `extractable: false`. Sealing it needs
    // its bytes, and a non-extractable key has none to give — so **the API that was supposed
    // to protect this key is what prevents us from protecting it**, while not preventing an
    // attacker from reading it: measured 2026-09-06, the whole PKCS#8 sits in a Chromium or
    // Firefox profile in the clear.
    //
    // So the record is DELETED rather than kept or wrapped. Keeping it would be the owner's
    // rule broken on purpose, and the cost of deleting it is real and is stated where a
    // visitor can read it: this browser becomes a different operator, and any certificate a
    // provider signed for the old key no longer names them. `42-02` and `42-03` could migrate
    // because their secret was bytes on a disk; this one cannot, and saying which is which
    // matters more than the two looking alike.
    if (isKeyPair(await db.get(STORE, LEGACY_KEY_PAIR_KEY))) {
      await db.delete(STORE, LEGACY_KEY_PAIR_KEY)
    }

    if (protection.kind !== 'passphrase') throw new VisitorKeyNeedsAPassphraseError()

    // A `CryptoKey` handle round-trips through the structured clone algorithm; the private
    // half stays where it was and only the handle is stored. Written before returning, so a
    // reload finds the same key rather than minting a second one for the same person.
    const { pkcs8, spki } = await generateSealableSubtleKeyPair()
    const record: SealedVisitorKey = { sealed: await sealSecret(pkcs8, protection.passphrase), spki }
    const generated = await importSealedSubtleKeyPair(pkcs8, spki)

    // ---- Compare-and-set, in ONE transaction — task #49, and it is NOT the shape the node
    // seed uses one file over.
    //
    // The hazard is the same: the read above and the write below are two operations, and a
    // browser profile's tabs share this database, so N tabs opening a cold origin together
    // each read `undefined`, each mint, and the last write wins. The people behind those
    // tabs are one person; two visitor keys for one person is two `operatorId`s, which is
    // the unit `composeQuorum` spreads a quorum across. **A raced mint would let one
    // profile's tabs count as independent operators**, which is a diversity claim about a
    // single failure domain and worse than a wasted key.
    //
    // `IdbIdentityStore.loadOrMintSeed` fixes its version by doing the read and the write
    // inside one `readwrite` transaction. **That is unavailable here**, and the reason is
    // exact rather than stylistic: `generateSubtleKeyPair()` is asynchronous, and awaiting
    // anything that is not part of an IndexedDB transaction lets that transaction commit —
    // so the `put` would land in a second one with the check no longer covering it. The same
    // race, one level in and harder to see.
    //
    // So the key is minted first and the transaction only decides *whose* wins. The loser
    // discards what it minted and adopts the winner's, which is the property that matters —
    // one person, one key — and the discarded handle costs nothing: it is non-extractable,
    // unreferenced, and was never published to anyone.
    const tx = db.transaction(STORE, 'readwrite')
    const raced = readSealed(await tx.store.get(SEALED_KEY))
    if (raced !== null) {
      await tx.done
      // The loser adopts the winner's, exactly as before — and it must OPEN it rather than
      // keep what it minted, because the two are different keys and only one is stored.
      const pkcs8OfWinner = await openSecret(raced.sealed, protection.passphrase)
      return await importSealedSubtleKeyPair(pkcs8OfWinner, raced.spki)
    }
    await tx.store.put(record, SEALED_KEY)
    await tx.done
    return generated
  } finally {
    db.close()
  }
}

/**
 * Who the fabric should treat as running this machine — the `operatorId` an enrolment
 * request carries.
 *
 * **Derived from the visitor's own public key, and that is a correctness requirement rather
 * than a convenience.** `operatorId` is the unit of quorum anti-affinity: `composeQuorum`
 * spreads a quorum across operators because three nodes run by one operator are one failure
 * domain and one attacker. A visitor's tabs *are* one failure domain — one person, one
 * device, one browser profile — so they must report one operator, and the stable thing they
 * all share is exactly this key.
 *
 * **The origin cannot name it, which is the point.** Taking `operatorId` from
 * `/bootstrap.json` would let whatever served the page decide how a visitor's node counts
 * toward diversity — a page that was found rather than configured, configuring the fabric's
 * view of whoever found it. Derivation makes that unrepresentable: there is no parameter.
 *
 * The public half only. It is 32 bytes the certificate is about to publish as `userKey`
 * anyway, so the prefix reveals nothing new; it is truncated because an `operatorId` is
 * compared for equality and never parsed, and a shorter one is legible in a log line.
 */
export async function visitorOperatorId(keyPair: CryptoKeyPair): Promise<string> {
  const signer = await subtleUserSigner(keyPair)
  return `visitor:${signer.userKey.slice(0, 16)}`
}

/**
 * Forget this visitor's key.
 *
 * The counterpart of {@link visitorKeyPair} and the reason the revoke path is more than
 * cosmetic: clearing the *decision* stops the tab enrolling again, and clearing the *key*
 * is what makes the visitor unrecognisable to a provider that kept a record of it. A
 * revocation that left the key behind would be a preference, not a withdrawal.
 */
export async function forgetVisitorKey(dbName: string = VISITOR_DB): Promise<void> {
  const db = await openVisitorDb(dbName)
  try {
    // **Both shapes**, and the legacy one is not an afterthought: a withdrawal that left a
    // pre-`AUTH-07` record behind would leave the very key this requirement is about lying in
    // the clear on the device of somebody who asked to be forgotten.
    await db.delete(STORE, SEALED_KEY)
    await db.delete(STORE, LEGACY_KEY_PAIR_KEY)
  } finally {
    db.close()
  }
}

async function openVisitorDb(name: string): Promise<IDBPDatabase<VisitorDb>> {
  return openDB<VisitorDb>(name, 1, {
    upgrade(database) {
      if (!database.objectStoreNames.contains(STORE)) {
        database.createObjectStore(STORE)
      }
    },
  })
}

/**
 * A stored value read as a key pair, or `false` for anything else.
 *
 * The guard is not decoration, for `IdbIdentityStore.#readBytes`'s reason: a record written
 * by an older build, or by a key collision, would otherwise reach `subtleUserSigner` and
 * fail somewhere that cannot say what happened. Answering `false` makes it the absent case,
 * which this module already has a decision for — mint a new one.
 */
function readSealed(value: unknown): SealedVisitorKey | null {
  if (typeof value !== 'object' || value === null) return null
  if (!('sealed' in value) || !('spki' in value)) return null
  const sealed = parseSealedSecret(value.sealed)
  if (sealed === null) return null
  const spki: unknown = value.spki
  if (!(spki instanceof Uint8Array)) return null
  return { sealed, spki }
}

/**
 * A stored value read as a key pair, or `false` for anything else.
 *
 * Since `AUTH-07` this recognises only the **legacy** record — nothing writes this shape any
 * more. It is kept for exactly the reason the docblock below already gives: a record written
 * by an older build reaching `subtleUserSigner` would fail somewhere that cannot say why.
 */
function isKeyPair(value: unknown): value is CryptoKeyPair {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<CryptoKeyPair>
  return (
    typeof candidate.privateKey === 'object' &&
    candidate.privateKey !== null &&
    typeof candidate.publicKey === 'object' &&
    candidate.publicKey !== null
  )
}
