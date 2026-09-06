/**
 * AUTH-07, criterion 3 — the derived encryption key `@libp2p/keychain` writes its stored
 * private keys under, on every tier that constructs one.
 *
 * ## The defect this exists to close, measured rather than read
 *
 * `@libp2p/keychain`'s own documentation says a stored private key is *"an encrypted PKCS 8
 * structure … protected by a key generated from the key chain's pass phrase using PBKDF2."*
 * The implementation qualifies that (`node_modules/@libp2p/keychain/dist/src/keychain.js:101-103`):
 *
 * ```js
 * const dek = this.init.pass != null && this.init.dek?.salt != null
 *     ? pbkdf2(this.init.pass, this.init.dek?.salt, …)
 *     : '';
 * ```
 *
 * Constructed with no arguments — which is what this repository did on both tiers that use
 * it — the derived encryption key is **the empty string**, so every key the keychain holds
 * is encrypted under a password everybody knows.
 *
 * ## Two corrections to the reading that opened this, both measured 2026-09-06
 *
 * **1. Supplying `pass` alone does NOT leave the DEK empty.** The phase proposal and the
 * roadmap criterion both say the condition needs `pass` *and* `dek.salt` because *"either
 * alone leaves the empty string"*. It does not, and the reason is two lines above the
 * quoted one: the constructor spreads `dek: { ...DEK_INIT, ...init.dek }`, and
 * `DEK_INIT.salt` is a non-null default — the literal string *"you should override this
 * value with a crypto secure random number"* (`dist/src/constants.js`). So
 * `this.init.dek?.salt != null` is **always true** and the condition reduces to
 * `pass != null`. Measured by writing a key through a keychain built three ways and trying
 * to read each artefact back with a no-argument keychain: no args **opened**, `pass` alone
 * **refused**, `pass` + salt **refused**.
 *
 * **2. `dek.salt` is still mandatory, for a different defect.** Left unset, every libp2p
 * deployment on earth shares one PBKDF2 salt — the hardcoded sentence above — so the work
 * of attacking one keychain is reusable against all of them. A salt's whole job is to
 * defeat exactly that precomputation. The proposal's *conclusion* (supply both) survives;
 * its *mechanism* does not, and a test that only asserts `DEK !== ''` cannot see the salt
 * half at all. {@link keychainProtectionFor} therefore supplies both, and the spec pins
 * both properties separately.
 *
 * ## Why the seed, and not the operator's passphrase
 *
 * Three sources were available and the seed is the only one with no hole in it.
 *
 * - **The operator passphrase directly** would make the keychain a *downgrade* of the thing
 *   it sits beside. `sealed-secret.ts` seals the identity under Argon2id at
 *   `DEFAULT_KDF_PARAMS` deliberately memory-hard; the keychain's KDF is PBKDF2 at 10 000
 *   iterations, which is nearly free to parallelise on a GPU. Handing the same string to
 *   both makes the cheap target an oracle for the expensive one: crack the keychain, open
 *   the identity envelope. The strong mechanism would be protecting nothing.
 * - **A KDF over the operator passphrase** fixes that but not the hole underneath it.
 *   `IdentityProtection` has a second arm — `writes-no-new-secret` — which carries no
 *   passphrase at all, so that path would still construct the empty DEK, silently, on
 *   exactly the deployment least likely to be watching.
 * - **The seed** covers every path with no branch: it exists whether it was unsealed from
 *   an envelope, adopted from a pre-existing plaintext file, or generated for one process.
 *
 * So the property this file delivers is stated as an inheritance rather than as a strength:
 * **the keychain is exactly as protected as the identity seed it hangs off, on every path.**
 * Under a passphrase the keychain is Argon2id-protected because reaching the seed is; under
 * `writes-no-new-secret` over an adopted plaintext seed it is not protected against someone
 * holding that directory — and neither is the identity, which `#compose` already says out
 * loud on stderr. What is closed everywhere is the empty string.
 *
 * ## Why the parameters are what they are
 *
 * `iterationCount` is deliberately left at the library default. Iteration count prices a
 * *guess*, and there is nothing here to guess: the input to PBKDF2 is 256 bits of uniform
 * randomness, not a human password. Raising it to the OWASP password figure would cost
 * start-up time and imply something false about the input. The 20-character floor
 * `@libp2p/keychain` enforces against NIST SP 800-132 — the same floor
 * `identity-protection.ts` borrows for this project's own passphrases, so the two agree by
 * construction rather than by coincidence — is satisfied here **by construction and not by
 * hoping**: hex of 32 bytes is 64 characters, and the salt floor of 16 likewise.
 *
 * ## Portability
 *
 * `crypto.subtle` HKDF rather than a library, because this file is imported by `@o2/node`
 * **and** by `@o2/cloudflare`, i.e. it must run on Node and on workerd. Nothing here
 * imports `node:` anything and nothing here does I/O — `purity.node.test.ts` lists `libp2p`
 * under `DUAL_TARGET` and a `node:` import in this file would redden it.
 */

import { toHex } from '@o2/core'

/**
 * HKDF `info` for the keychain passphrase. Versioned, so a future change of derivation is a
 * new label rather than a silent reinterpretation of the same bytes.
 */
export const KEYCHAIN_PASS_INFO: string = 'o2/keychain/pass/v1'

/**
 * HKDF `info` for the keychain's PBKDF2 salt.
 *
 * **A different label from {@link KEYCHAIN_PASS_INFO}, and that is the point.** Domain
 * separation is what stops the salt and the passphrase from being the same value under two
 * names — which would hand PBKDF2 its own salt as its own secret.
 */
export const KEYCHAIN_SALT_INFO: string = 'o2/keychain/salt/v1'

/**
 * The subset of `@libp2p/keychain`'s init this repository sets.
 *
 * Deliberately not the library's own `KeychainInit`: naming only the two fields that decide
 * whether the DEK is real keeps a caller from believing some third field also matters.
 */
export interface KeychainProtection {
  /** PBKDF2 passphrase. Always 64 characters, so the 20-character NIST floor holds by construction. */
  readonly pass: string
  /**
   * The full PBKDF2 configuration.
   *
   * **All four fields, not just the salt, and the type is what forces it.** `DEKConfig`
   * declares `hash`, `iterationCount` and `keyLength` as required even though the
   * constructor spreads `DEK_INIT` over whatever it is given — a partial object works at
   * runtime and does not compile. Restating them is the better outcome anyway: the
   * parameters a key was written under are now visible at the call site rather than
   * inherited from a library default that could move underneath a stored artefact.
   */
  readonly dek: {
    readonly salt: string
    readonly hash: string
    readonly iterationCount: number
    readonly keyLength: number
  }
}

/**
 * PBKDF2 output length in bytes — 64, `DEK_INIT`'s own value, matching SHA-512's digest so
 * the derivation asks for exactly one block and no more.
 */
export const KEYCHAIN_DEK_KEY_LENGTH: number = 512 / 8

/**
 * PBKDF2 iterations — `DEK_INIT`'s own value, pinned deliberately low and **not** an
 * oversight to be corrected to the OWASP password figure.
 *
 * Iteration count prices a *guess*. There is nothing here to guess: the input is 256 bits
 * of uniform randomness from HKDF, not a human password, so an attacker's only route is the
 * seed itself and stretching costs start-up time to buy nothing. Restated here rather than
 * inherited so that a future change to the library's default cannot silently make keys
 * written today unreadable tomorrow.
 */
export const KEYCHAIN_DEK_ITERATIONS: number = 10_000

/** PBKDF2 hash, in the multihash-style spelling `@libp2p/crypto`'s `pbkdf2` expects. */
export const KEYCHAIN_DEK_HASH: string = 'sha2-512'

const textEncoder = new TextEncoder()

/** One HKDF-SHA256 expansion of the seed under a label. */
async function derive(seed: Uint8Array, info: string): Promise<string> {
  const ikm = await crypto.subtle.importKey('raw', seed as unknown as BufferSource, 'HKDF', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: textEncoder.encode(info) },
    ikm,
    256,
  )
  return toHex(new Uint8Array(bits))
}

/**
 * Derive the `pass` and `dek.salt` a keychain must be constructed with, from the node's
 * identity seed.
 *
 * Deterministic: the same seed yields the same pair on every start, which is what lets a
 * keychain written before a restart still be read after one. That stability is a hard
 * requirement rather than a nicety — a keychain whose DEK moved between starts would make
 * AutoTLS order a new certificate every time the process came up.
 */
export async function keychainProtectionFor(seed: Uint8Array): Promise<KeychainProtection> {
  const [pass, salt] = await Promise.all([derive(seed, KEYCHAIN_PASS_INFO), derive(seed, KEYCHAIN_SALT_INFO)])
  return {
    pass,
    dek: {
      salt,
      hash: KEYCHAIN_DEK_HASH,
      iterationCount: KEYCHAIN_DEK_ITERATIONS,
      keyLength: KEYCHAIN_DEK_KEY_LENGTH,
    },
  }
}
