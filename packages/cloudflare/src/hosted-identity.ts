/**
 * The hosted node's identity, persisted in Durable Object storage — Phase 29 criterion 2,
 * and **sealed** since AUTH-07 criterion 4.
 *
 * ## Why this file exists at all
 *
 * Measured on 2026-08-24 against a deployed Worker: three consecutive `GET /self` calls
 * returned **three different PeerIds**, because each request landed in a fresh isolate
 * (`.planning/consults/2026-08-24-cloudflare-as-a-fabric-node-measured.md` §7). A node whose
 * name changes per request cannot be published, dialled twice, or named in a bootstrap list.
 * Moving the node into a Durable Object and persisting the seed is what fixed it, and the
 * persistence is this module.
 *
 * The rule is not new here. `@libp2p/keychain` exists in the Node tier for the same reason —
 * a WebRTC-Direct certhash that changes per restart invalidates every published multiaddr.
 * *An address derived from a key that changes per restart is an address nobody can publish.*
 *
 * ## Why a seed and not a key
 *
 * Because `identityFromSeed` already derives all four encodings from 32 bytes, and
 * `packages/libp2p/src/identity.ts` states why that matters: `peerId ↔ nodeKey` becomes a
 * pure function in both directions, so the Noise handshake is the standing proof of
 * possession for the certificate's subject key. A hosted node that stored a serialised
 * private key instead would need a second derivation path, and two paths are two things that
 * can disagree about who this node is.
 *
 * ## AUTH-07 — the seed stopped being 32 bytes anyone reading this store can lift
 *
 * The owner's rule, ruled 2026-09-06: *"Ключ в открытом виде не должен быть записан нигде."*
 * This module wrote a raw 32-byte seed to {@link HOSTED_IDENTITY_KEY} until then. It now
 * writes an `@o2/core` envelope — Argon2id + XChaCha20-Poly1305, cost parameters recorded
 * beside the ciphertext — to {@link SEALED_HOSTED_IDENTITY_KEY}, under a secret the account
 * holder placed in the platform's secret store, and **deletes the plaintext** once the
 * envelope has been read back and opened.
 *
 * ### What that buys, stated at its true size and no larger
 *
 * Verbatim from the proposal this phase answers
 * (`.planning/consults/2026-09-06-every-stored-key-is-ciphertext.md` §3.C), because the
 * failure this milestone's record exists to prevent is a weaker mechanism described in a
 * stronger one's language:
 *
 * > a Durable Object cannot keep a secret from its own operator. What this buys is not
 * > secrecy from the account holder — it is that the secret no longer sits *in the object's
 * > storage*, where a storage-level compromise, a mis-scoped binding or a stray dump would
 * > expose it. The adversary moves from "whoever can read this object's storage" to "whoever
 * > holds the Cloudflare account". Those are different compromise domains and moving between
 * > them is the whole gain.
 *
 * Nothing in this file, its spec, or its test names claims more than that, and a surface that
 * did would fail the criterion rather than satisfy it.
 *
 * ### The three key-sources, and why this tier's is a platform secret
 *
 * One envelope, three sources, because there are three kinds of operator: a person at a
 * keyboard (the browser passphrase), an operator at a shell (`--identity-passphrase-file`),
 * and — here — **nobody at all**. A Durable Object boots unattended, so the only credential
 * it can be handed is one the platform holds for it. The vocabulary is still
 * `packages/libp2p/src/identity-protection.ts`'s: the same {@link IdentityProtection} value,
 * the same twenty-character floor, the same `WeakPassphraseError`. A fourth vocabulary
 * per artefact is what that file exists to prevent.
 *
 * **The `writes-no-new-secret` arm is deliberately unreachable from here.** It is a promise
 * an operator makes, and this tier has no operator present to make it; a missing secret is a
 * *misconfiguration*, which is a different fact and gets a different refusal —
 * {@link HostedIdentitySecretMissingError}.
 *
 * ## What this deliberately does NOT do
 *
 * It does not use `.tmp-`-then-`rename`, which `packages/node/src/identity-store.ts` needs
 * because a POSIX write is not atomic and a process killed mid-write leaves a half-written
 * key. A Durable Object `put` of a single key is atomic by construction — the platform's own
 * consistency guarantee — so imitating the dance here would be ceremony that looks like
 * durability. **The half of that file's discipline that DOES carry over is the migration's
 * write order**, and it carries over because it is not about atomicity at all: see
 * {@link loadOrCreateHostedSeed}.
 */

import { Key } from 'interface-datastore'
import type { Datastore } from 'interface-datastore'
import { SEED_BYTES, assertUsablePassphrase, generateSeed, identityFromSeed } from '@o2/libp2p'
import type { IdentityProtection, NodeIdentity } from '@o2/libp2p'
import { openSecret, sealSecret } from '@o2/core'

/**
 * The store surface this module uses — four methods, declared as narrowly as they are used.
 *
 * The discipline `durable-object-storage.d.ts` states for its own declaration, applied here
 * for the same payoff: **a narrower interface is one a fixture can implement COMPLETELY, and a
 * complete fake is the only kind that can honestly claim to model the thing.** That is not
 * decorative here. The migration's write order is the whole of its safety, and the only way to
 * measure the order is to build a store that fails at a chosen step — a `put` that silently
 * drops the write is the case that says the plaintext is deleted only after the envelope has
 * been proved readable. Against the full `Datastore` (twelve members, batching, iterators)
 * such a fake would be a partial implementation asserted through a cast, which this tree does
 * not permit.
 *
 * `DoDatastore` satisfies it structurally; nothing had to change to make that true.
 */
export type HostedSeedStore = Pick<Datastore, 'has' | 'get' | 'put' | 'delete'>

/**
 * Where the **plaintext** seed used to live, and the only thing this module still does with
 * it is read it once and delete it.
 *
 * **Deliberately not under `/o2/`.** That prefix is one of `REFUSED_NAMESPACE`'s two values,
 * so a key under it would be refused by `DoDatastore.put` and the node could never persist an
 * identity at all — a failure that would arrive at first boot of a deployed object rather
 * than in a test. `/identity/` collides with neither refused namespace, and the completeness
 * spec beside this one asserts that rather than trusting the sentence.
 *
 * **Still exported after AUTH-07, for the reason `IDENTITY_FILE` still is on the Node tier**:
 * the migration reads it, and criterion 4's positive control writes it by hand in order to
 * prove that the instrument reporting its absence can see it when it is there. An absence
 * with no positive control passes just as well on an empty store.
 */
export const HOSTED_IDENTITY_KEY: Key = new Key('/identity/seed')

/**
 * Where the sealed seed lives — AUTH-07 criterion 4.
 *
 * **A new key rather than new content under the old one**, and the reason is that the
 * criterion needs a direct question. *"Is the plaintext gone?"* is
 * `store.has(HOSTED_IDENTITY_KEY)` against a distinct name; against a shared one it is an
 * inference about a value's shape. {@link loadOrCreateHostedSeed}'s migration turns the
 * second question into the first, and `packages/node/src/identity-store.ts`'s
 * `SEALED_IDENTITY_FILE` made the same move for the same reason.
 *
 * Under `/identity/` for {@link HOSTED_IDENTITY_KEY}'s stated reason, and the spec asks the
 * production classifier about this key too rather than trusting that the prefix carried.
 */
export const SEALED_HOSTED_IDENTITY_KEY: Key = new Key('/identity/sealed-seed')

/**
 * The binding the account holder sets with `wrangler secret put`.
 *
 * Named once, here, and read off `HostedEnv` by that name — so the string in the runbook, the
 * string in the refusal a misconfigured object emits, and the string the code looks for
 * cannot drift apart. `.planning/OWNER-ACTIONS.md` row 8 is the act; this is its name.
 */
export const HOSTED_IDENTITY_SECRET_BINDING = 'O2_IDENTITY_SECRET'

/**
 * Thrown when a stored seed is the wrong length, sealed or not.
 *
 * Refusing is the whole point: a short read silently reinterpreted as a new identity would
 * drop this node out of every peer's verified set, out of every bootstrap list that names it,
 * and out of its own certificate — with nothing reporting why. The Node tier's
 * `MalformedSeedFileError` refuses for the same reason and says so in the same words.
 *
 * It takes the key it is refusing **about** because there are now two: a legacy plaintext of
 * the wrong length and an envelope that opened to the wrong length are different faults with
 * different repairs, and a message naming one key for both would send an operator to the
 * wrong row.
 */
export class MalformedStoredSeedError extends Error {
  constructor(key: Key, received: number) {
    super(
      `${key.toString()} holds ${received} bytes, expected exactly ${SEED_BYTES}` +
        ' — refusing to reinterpret it as a new identity',
    )
    this.name = 'MalformedStoredSeedError'
  }
}

/**
 * Thrown when no identity secret is configured — **and nothing is minted**.
 *
 * This is the whole hazard of criterion 4, and it is worth naming plainly. This object's
 * PeerId is published in bootstrap lists and in multiaddrs. A first boot after a deploy where
 * the secret was never set, a typo in the binding name, a rename — under a `loadOrCreate` that
 * treated "no secret" as "seal nothing" or as "make a fresh one", every one of those is a new
 * PeerId and a deployed node that has silently become a different node. Phase 42's criterion 4
 * states the same property one tier over: *a wrong passphrase produces a refusal that names
 * itself, and never a freshly minted identity.*
 *
 * So a misconfigured object goes **dark**, loudly, with its stored identity untouched — and
 * setting the secret heals it with nothing lost. That is strictly the better failure: a node
 * that is not answering is a fact somebody notices, and a node that answers as somebody else
 * is a fact nobody notices.
 *
 * It is **not** `WeakPassphraseError` and not the `writes-no-new-secret` arm: those say
 * an operator chose something, and this says the deployment was never configured.
 */
export class HostedIdentitySecretMissingError extends Error {
  constructor() {
    super(
      `no ${HOSTED_IDENTITY_SECRET_BINDING} is bound to this Worker, so this object's identity ` +
        'seed cannot be sealed or opened — refusing to mint a new identity, which would give ' +
        'this object a different PeerId from the one published in every bootstrap list that ' +
        `names it. Set it with \`wrangler secret put ${HOSTED_IDENTITY_SECRET_BINDING}\` and ` +
        'the stored identity comes back unchanged.',
    )
    this.name = 'HostedIdentitySecretMissingError'
  }
}

/**
 * Thrown when a sealed envelope is present and does not open.
 *
 * **The message names both possibilities and claims to know neither**, because the AEAD
 * reports `invalid tag` for a wrong secret and for an altered envelope alike — measured
 * 2026-09-04 and recorded at `sealed-secret.ts`'s `SecretUnlockError`. A refusal that
 * guessed would send an operator looking for the wrong fault half the time.
 *
 * It ends with the consequence, in the style `MalformedSeedFileError` already uses, because
 * the consequence is the reason this is a refusal rather than a fallback.
 */
export class SealedHostedIdentityUnlockError extends Error {
  constructor(cause: unknown) {
    super(
      `${SEALED_HOSTED_IDENTITY_KEY.toString()} did not open — either ` +
        `${HOSTED_IDENTITY_SECRET_BINDING} is not the secret this envelope was sealed under, or ` +
        'the envelope has been altered, and the authenticated cipher reports the same failure ' +
        `for both, so this refusal does not claim to know which (${describe(cause)}). Refusing ` +
        'to mint a new identity — starting anyway would give this object a different PeerId and ' +
        'orphan every bootstrap list and multiaddr naming the old one.',
    )
    this.name = 'SealedHostedIdentityUnlockError'
  }
}

function describe(cause: unknown): string {
  return cause instanceof Error ? `${cause.name}: ${cause.message}` : 'no error was raised'
}

/**
 * The one arm of {@link IdentityProtection} this tier can produce.
 *
 * Narrowed at the type level rather than only in prose, so *"the `writes-no-new-secret` arm is
 * unreachable from here"* is something the compiler enforces at every call site rather than a
 * sentence a later edit can quietly falsify. It is still the shared vocabulary's value — the
 * same union member the other two tiers pass around — and not a fourth type.
 */
export type HostedIdentityProtection = Extract<IdentityProtection, { readonly kind: 'passphrase' }>

/**
 * The protection this tier seals under, from the platform secret — or a refusal.
 *
 * Exported because the fail-closed property is worth asking about directly, without a store:
 * *does an absent secret refuse, and does it refuse by a name that says which of the two
 * things went wrong?* A spec that could only reach this through a `Datastore` would be
 * proving the refusal and the storage path at once, and a green there is two claims.
 *
 * The mapping is deliberately **not** `undefined → { kind: 'writes-no-new-secret' }`. That
 * value means *an operator promised this node would write no new secret*, and laundering a
 * misconfiguration through it would make the refusal contradict the value it was built from.
 * Nobody is present on this tier to make that promise.
 *
 * An empty string is treated as absent, because `wrangler`'s own `--var NAME:` produces one
 * and an operator who typed the binding with no value has not configured anything.
 */
export function hostedIdentityProtection(secret: string | undefined): HostedIdentityProtection {
  if (secret === undefined || secret === '') throw new HostedIdentitySecretMissingError()
  const protection: HostedIdentityProtection = { kind: 'passphrase', passphrase: secret }
  // The twenty-character floor, from `@libp2p/keychain`'s reading of NIST SP 800-132 — the
  // same floor the other two tiers are held to. Checked BEFORE anything is derived from the
  // secret, so a too-short one costs a string length rather than an Argon2id derivation and
  // its refusal can never be confused with a failure to decrypt.
  assertUsablePassphrase(protection)
  return protection
}

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

/**
 * Read the seed, migrating a plaintext one or minting as required, under the platform secret.
 *
 * Four cases, and each one is a case in `hosted-seed-sealed.node.test.ts`:
 *
 * | storage holds | secret | outcome |
 * |---|---|---|
 * | a sealed envelope | correct | opens; same seed, same PeerId |
 * | a sealed envelope | wrong | {@link SealedHostedIdentityUnlockError}. No mint branch is reachable. |
 * | a legacy plaintext seed | set | seals the SAME bytes, proves the envelope opens, then deletes the plaintext |
 * | anything at all | absent | {@link HostedIdentitySecretMissingError}, before a single read |
 *
 * ## The migration's write order is the whole of its safety
 *
 * **Seal, put, re-read, OPEN, compare, and only THEN delete** — copied deliberately from
 * `packages/node/src/identity-store.ts:209-224`, whose own comment states why: *"Unlinking
 * before the envelope is proven readable turns a full disk — or any defect in the sealing
 * path — into a destroyed identity. The verification read is not belt-and-braces; it is the
 * thing that makes the unlink safe."* Everything about that argument survives the move to a
 * Durable Object, because it is about a defect in the sealing path and not about atomicity.
 * The `.tmp-`-then-`rename` half does **not** carry over, for the reason at the top of this
 * file: a single-key `put` here is atomic by the platform's own guarantee.
 *
 * The re-read is a real read of the store rather than the value just held in hand, so a
 * `put` that silently dropped the write, or a store that round-trips a value into something
 * else, is caught before the plaintext goes.
 *
 * ## The sealed key is checked before the plaintext one, and the order is load bearing
 *
 * A stale plaintext left behind by a migration that was interrupted between the `put` and the
 * `delete` must never shadow the envelope that replaced it. Checking the envelope first makes
 * that interruption a no-op on the next boot rather than a second migration.
 *
 * ## The one race, named rather than engineered around
 *
 * Argon2id is not a storage operation, so awaiting it opens the Durable Object's input gate
 * and a second request can be delivered mid-derivation. On the **migration** path that is
 * benign: both racers read the same plaintext, so both envelopes open to the same seed and
 * the PeerId is identical whichever write lands last. On the **mint** path it would not be,
 * so the mint arm re-checks for an envelope immediately before writing one — with only
 * storage awaits between the check and the `put` — and adopts what it finds. `HostedNode`
 * additionally memoises the *promise* rather than the resolved identity, so one instance
 * cannot start two derivations at all.
 */
export async function loadOrCreateHostedSeed(store: HostedSeedStore, secret: string | undefined): Promise<Uint8Array> {
  // Before a single read of the store: a misconfigured object must not be able to learn
  // anything about, or do anything to, the identity it is not entitled to open.
  const { passphrase } = hostedIdentityProtection(secret)

  // 1. A sealed envelope wins over everything else in this store.
  if (await store.has(SEALED_HOSTED_IDENTITY_KEY)) {
    return await openHostedSeed(await store.get(SEALED_HOSTED_IDENTITY_KEY), passphrase)
  }

  // 2. A legacy plaintext seed, written by a build before AUTH-07 — including the object that
  //    has been answering on one PeerId since 2026-08-27. The bytes do not change here; only
  //    where they are kept does.
  if (await store.has(HOSTED_IDENTITY_KEY)) {
    const legacy = await store.get(HOSTED_IDENTITY_KEY)
    if (legacy.length !== SEED_BYTES) throw new MalformedStoredSeedError(HOSTED_IDENTITY_KEY, legacy.length)
    const seed = copyOf(legacy)

    await store.put(SEALED_HOSTED_IDENTITY_KEY, await sealHostedSeed(seed, passphrase))
    // The re-read asks the STORE, not the value still in hand, so a `put` that silently
    // dropped the write is caught here rather than by the next boot finding nothing at all.
    // `has` before `get` for the reason it is used above: `get` signals a miss by throwing,
    // and a raw miss escaping here would leave this path without a named refusal.
    if (!(await store.has(SEALED_HOSTED_IDENTITY_KEY))) {
      throw new SealedHostedIdentityUnlockError(
        new Error('the envelope this migration just wrote is not there'),
      )
    }
    const reopened = await openHostedSeed(await store.get(SEALED_HOSTED_IDENTITY_KEY), passphrase)
    if (!sameBytes(reopened, seed)) {
      throw new SealedHostedIdentityUnlockError(
        new Error('the envelope this migration just wrote opened to different bytes'),
      )
    }
    await store.delete(HOSTED_IDENTITY_KEY)
    return seed
  }

  // 3. Nothing yet. Seal first, then check-and-write with no non-storage await between them —
  //    see the race note above.
  const minted = generateSeed()
  const envelope = await sealHostedSeed(minted, passphrase)
  if (await store.has(SEALED_HOSTED_IDENTITY_KEY)) {
    return await openHostedSeed(await store.get(SEALED_HOSTED_IDENTITY_KEY), passphrase)
  }
  await store.put(SEALED_HOSTED_IDENTITY_KEY, envelope)
  return minted
}

/** Seal a seed into the bytes this store holds — the envelope, as JSON, as UTF-8. */
async function sealHostedSeed(seed: Uint8Array, passphrase: string): Promise<Uint8Array> {
  return textEncoder.encode(JSON.stringify(await sealSecret(seed, passphrase)))
}

/**
 * Open one envelope, or refuse by name.
 *
 * **There is no arm of this function that reaches `generateSeed()`**, and that is the property
 * criterion 4 is about. The function this replaced minted whenever it found nothing, so a
 * decrypt failure that returned `null` — or fell through — would walk into a silent re-mint,
 * present as a successful start, and orphan every published multiaddr. Every failure below
 * leaves by `throw`.
 *
 * `SEED_BYTES` is re-checked **after** decryption as well as before encryption: a decrypted
 * blob is external data, and an envelope written by an older build could hold a different
 * length. Same refusal, same reason, same words as the plaintext path used.
 */
async function openHostedSeed(stored: Uint8Array, passphrase: string): Promise<Uint8Array> {
  let opened: Uint8Array
  try {
    const parsed: unknown = JSON.parse(textDecoder.decode(stored))
    opened = await openSecret(parsed, passphrase)
  } catch (cause) {
    throw new SealedHostedIdentityUnlockError(cause)
  }
  if (opened.length !== SEED_BYTES) throw new MalformedStoredSeedError(SEALED_HOSTED_IDENTITY_KEY, opened.length)
  return copyOf(opened)
}

/**
 * A private copy of exactly {@link SEED_BYTES}.
 *
 * A value handed back by a store may be a view into memory the store still owns —
 * `packages/node/src/identity-store.ts` copies out of Node's `Buffer` pool for the same
 * reason — and an identity that aliases somebody else's buffer is an identity that can change
 * without anything having assigned to it.
 */
function copyOf(bytes: Uint8Array): Uint8Array {
  const seed = new Uint8Array(SEED_BYTES)
  seed.set(bytes.subarray(0, SEED_BYTES))
  return seed
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

/**
 * Every refusal name a caller may treat as *this deployment is not configured to open its own
 * identity* — as opposed to *this code has a bug*.
 *
 * Written out as literals rather than derived from the classes, deliberately, and the spec
 * beside this file asserts each class's own `.name` is a member and that there are exactly
 * four. Deriving it would make the list and the classes agree by construction and prove
 * nothing; writing it out makes a fifth refusal a red test rather than a silent widening.
 *
 * Matched on `name` and never on `instanceof`, in the style `sealed-secret.ts`'s refusals
 * already state: a class duplicated across a bundler boundary fails `instanceof` while still
 * being the same refusal, and a Worker bundle is exactly such a boundary.
 *
 * `WeakPassphraseError` is on the list although it is `@o2/libp2p`'s: a secret below the
 * twenty-character floor is a misconfigured deployment by every reading, and an operator who
 * set a short one needs to be told that rather than shown a stack trace.
 */
export const HOSTED_IDENTITY_REFUSALS: readonly string[] = [
  'HostedIdentitySecretMissingError',
  'WeakPassphraseError',
  'SealedHostedIdentityUnlockError',
  'MalformedStoredSeedError',
]

/**
 * The text `GET /self` answers with when this object cannot open its own identity, or `null`
 * when the failure is not one of {@link HOSTED_IDENTITY_REFUSALS}.
 *
 * **`null` means rethrow, and that asymmetry is the design.** A misconfigured deployment must
 * say so — the precedent is `turn-not-configured`: *"a deployment that is not configured
 * should say so, not look broken."* A genuine defect must NOT be dressed up as configuration,
 * because an operator who is told to check a binding they already set will check it twice
 * before they look at anything else.
 */
export function hostedIdentityRefusal(cause: unknown): string | null {
  if (!(cause instanceof Error)) return null
  if (!HOSTED_IDENTITY_REFUSALS.includes(cause.name)) return null
  return `${cause.name}: ${cause.message}`
}

/**
 * The hosted node's full identity, stable across eviction and redeploy.
 *
 * "Stable across eviction" is a claim about the STORE and not about this function: an object
 * evicted and re-instantiated runs this again over the same Durable Object storage and reads
 * the same 32 bytes. What a test can hold on one machine is exactly that — two instantiations
 * over one store yield one PeerId — and the spec beside this file asserts it that way rather
 * than pretending to have evicted anything. The deployed half of criterion 2 is an owner act.
 *
 * Since AUTH-07 the same sentence carries one more clause: the 32 bytes are read out of an
 * envelope, so the store alone is no longer enough to produce them. What the store holds is
 * necessary and no longer sufficient.
 */
export async function hostedIdentity(store: HostedSeedStore, secret: string | undefined): Promise<NodeIdentity> {
  return identityFromSeed(await loadOrCreateHostedSeed(store, secret))
}
