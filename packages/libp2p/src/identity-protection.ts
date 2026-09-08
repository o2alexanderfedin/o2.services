/**
 * AUTH-06 — how a tier says what it will do with a long-lived secret before it writes one.
 *
 * Two arms, named for what they **guarantee** rather than for how they are implemented,
 * because the second one is the arm a caller reaches by saying nothing and a field called
 * `off` would make silence mean *"write the secret in the clear"*:
 *
 * - `passphrase` — seal every secret this node persists under this passphrase.
 * - `writes-no-new-secret` — a promise, not an absence: **this node will not write a new
 *   secret to this device.** A node holding it adopts a pre-existing plaintext identity if
 *   one is already there, so an operator who upgrades keeps their peer id, and otherwise
 *   mints a per-process identity that never touches a disk.
 *
 * ## Why the vocabulary lives in `@o2/libp2p` and not in `@o2/core` or the two tiers
 *
 * `@o2/node` and `@o2/browser` both persist an identity seed and both must describe the
 * same choice in the same words, or the two tiers' stores diverge on the one question the
 * phase is about. This package is already the one they share for `SEED_BYTES`,
 * `generateSeed` and `identityFromSeed` — the seed vocabulary — and this is the seed's
 * protection, so it belongs beside them.
 *
 * **Nothing here imports `node:` anything and nothing here does I/O.** `purity.node.test.ts`
 * lists `libp2p` under `DUAL_TARGET`; a `node:` import in this file would redden it.
 */

/**
 * The minimum passphrase length, in characters.
 *
 * **Twenty, and the number is borrowed rather than invented.** `@libp2p/keychain` — a
 * package already in this repository's own dependency tree — enforces exactly this floor
 * against NIST SP 800-132 (`node_modules/@libp2p/keychain/src/keychain.ts:100-102`). The
 * keychain was examined as a home for the node seed and refused for structural reasons (a
 * libp2p service cannot hold the key libp2p is constructed from, and its KDF is PBKDF2),
 * but its length floor survives that refusal: this repository has no reason to be weaker
 * than a library it already ships.
 *
 * It is a floor on **length** and deliberately not a judgement about entropy. A rule that
 * rejected a long passphrase for looking unlike one is a rule an operator works around,
 * and the memory-hard KDF is what actually prices a guess.
 */
export const PASSPHRASE_MIN_LENGTH = 20

/**
 * What a tier will do with the long-lived secrets it persists.
 *
 * A discriminated union rather than an optional string, so the compiler makes a caller
 * state which of the two it means and there is no third state to arrive at by omission.
 */
export type IdentityProtection =
  | { readonly kind: 'passphrase'; readonly passphrase: string }
  | { readonly kind: 'writes-no-new-secret' }

/** Thrown when a passphrase is shorter than {@link PASSPHRASE_MIN_LENGTH}. */
export class WeakPassphraseError extends Error {
  constructor(received: number) {
    super(
      `the identity passphrase is ${received} characters, and at least ${PASSPHRASE_MIN_LENGTH} are required `
        + '— the floor @libp2p/keychain enforces against NIST SP 800-132; refusing to seal a long-lived '
        + 'secret behind a passphrase that an offline attacker holding this disk could enumerate',
    )
    this.name = 'WeakPassphraseError'
  }
}

/**
 * Refuse an unusable passphrase **before** anything is derived from it.
 *
 * Called at the top of a store's load path rather than beside the KDF, so a weak passphrase
 * costs a string length rather than an Argon2id derivation, and so the refusal cannot be
 * confused with a decryption failure.
 *
 * The `writes-no-new-secret` arm has nothing to check and returns: it is not a passphrase
 * of length zero, it is a promise to write nothing.
 */
export function assertUsablePassphrase(protection: IdentityProtection): void {
  if (protection.kind !== 'passphrase') return
  if (protection.passphrase.length < PASSPHRASE_MIN_LENGTH) {
    throw new WeakPassphraseError(protection.passphrase.length)
  }
}
