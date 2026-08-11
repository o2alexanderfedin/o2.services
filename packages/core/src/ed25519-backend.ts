/**
 * Ed25519 and X25519 — **the** module that decides which implementation runs.
 *
 * Phase 28, Plan 28-01 merged two selection mechanisms into this one. Until then
 * `packages/core` held two: this module's presence-only gate (Phase 25, Plan 25-04)
 * with a lazily-imported libsodium fallback, and `cert-lifecycle.ts`'s real
 * round-trip probe with a noble fallback (2026-08-10). **The two gates were not
 * equivalent and the surviving one is the probe** — see
 * {@link detectCryptoBackend}. The libsodium arm is gone; so is the second `subtle`
 * verify implementation that sat beside {@link subtleCryptoBackend}'s.
 *
 * ## Why `crypto.subtle` cannot implement the synchronous port
 *
 * Measured by execution on this host, Node v25.9.0 (not inferred from documentation):
 * `@noble/curves`'s `ed25519.verify` returns a plain `boolean` — `instanceof Promise`
 * is `false`. `crypto.subtle.sign`/`.verify` return an object where
 * `instanceof Promise` is `true`. A Promise cannot be awaited synchronously in
 * JavaScript, and no portable trick changes that on this project's declared targets
 * (`Atomics.wait` needs cross-origin isolation, which GitHub Pages cannot supply —
 * the same constraint that already rules out WASM threads here). So `crypto.subtle`
 * is confined to the asynchronous port, for call sites already inside an `async`
 * function.
 *
 * **The conclusion changed with the merge and the type says so.** That argument was
 * written when the synchronous port had *two* conforming implementations, noble and
 * libsodium. It now has exactly **one**, noble, which is why {@link Ed25519Backend}
 * is a one-member union. A one-member union reads oddly on purpose: it makes a future
 * second arm a deliberate type edit rather than a quiet re-addition.
 *
 * ## No production caller yet — and the merge is behaviour-neutral in production
 *
 * Nothing in production calls {@link initEd25519}, {@link getSyncVerifier},
 * {@link getAsyncVerifier} or {@link createCryptoBackend}. Production Ed25519
 * verification calls `@noble/curves` **directly**, at six sites, **named by symbol
 * rather than by line** — `verifyChain` in `capability.ts`; `redeemChallenge`, `enrol`
 * (twice) and `verifyCertificate` in `enrollment.ts`; `verifyCapabilityRecord` in
 * `discovery.ts` — and routes through no selection layer at all. The line numbers this
 * list carried until 2026-08-10 are gone deliberately: it said `capability.ts:219`, the
 * call is at `:249`, and it went stale **in the commit that wrote it** (`31b64a6` moved
 * `toBase64Url`/`fromBase64Url` into that file in the same change), after which the
 * number was copied to eight more places. A symbol survives the next such move; a line
 * number is a claim about a file's layout that nothing re-measures. So collapsing the two layers into one changes no production behaviour. That is
 * what makes the merge safe, and it is also the ceiling on what it may claim: **this
 * removes a duplication from the package, not a hazard from the trust path.**
 *
 * Wiring the port into `verifyChain`/`verifyCertificate` remains unwired for a reason
 * this module does not decide: where each of three runtime entry points calls
 * `initEd25519()` before first use, and what a verification arriving before that
 * promise resolves should do — block, fail closed, or fail open. That is a trust-path
 * ruling. See `ed25519-backend.test.ts`'s "Part 3" for the decision stated by name.
 *
 * ## Ed25519 signature bytes are not a stable identifier in this fabric
 *
 * Carried forward from `cert-lifecycle.ts`, where it was measured. X25519 is plain
 * scalar multiplication with no randomness anywhere in it, so {@link
 * CryptoBackend.agreeX25519} genuinely has exactly one correct output per input pair,
 * confirmed byte-identical noble-vs-subtle in Node and in chromium/firefox/webkit
 * alike. **Ed25519 signing is a different claim.** RFC 8032 defines one canonical
 * deterministic nonce derivation but does not require every conforming implementation
 * to use exactly it; some harden against fault attacks with a synthetic/hedged nonce
 * instead. Node, chromium and firefox's `subtle` produced signatures byte-identical to
 * noble's in this project's own measurement; **WebKit's did not** — a different,
 * still-valid signature for the same seed and message, verified successfully by both
 * arms. So {@link CryptoBackend.signEd25519} across arms is proven only as "mutually
 * verifiable", never as "byte-identical", and a caller that dedupes, caches or keys on
 * signature bytes is green in Node and CI and broken in Safari.
 *
 * ## One curve library derives every seed, on both arms
 *
 * WebCrypto's `generateKey` cannot be seeded — there is no way to ask `subtle` for
 * "the Ed25519 keypair whose private scalar is this exact 32 bytes". `@noble/curves`'
 * pure scalar math (`ed25519.getPublicKey`, `x25519.getPublicKey`) is therefore used
 * **unconditionally, on both arms**, to derive a public key from a seed and — on the
 * subtle arm — to build the JWK `x` field WebCrypto's private-key import requires it
 * to cross-check against `d`. This is not a fallback path; it is the only path,
 * because no such path exists in WebCrypto at all.
 *
 * ## Pure module
 *
 * The only platform contact is `globalThis.crypto` — a portable Web-standard global
 * present in both Node and every browser target — behind a capability probe that runs
 * at most once, shared by every consumer. There is no dynamic `import()` in this
 * module any more.
 */

import { ed25519, x25519 } from '@noble/curves/ed25519.js'
import { toBase64Url } from './capability.ts'

/**
 * The synchronous port has exactly one conforming implementation. See the docblock's
 * "Why `crypto.subtle` cannot implement the synchronous port" for why it cannot be
 * `subtle`, and Phase 28 for why it is no longer also `libsodium`.
 */
export type Ed25519Backend = 'noble'

/**
 * The synchronous port. `verifyChain` and `PeerVerifier.verifiedPeers` can call this
 * without becoming async — that is the entire reason the adapter was chosen.
 */
export interface Ed25519SyncVerifier {
  readonly backend: Ed25519Backend
  verify(signature: Uint8Array, message: Uint8Array, publicKey: Uint8Array): boolean
}

/**
 * The asynchronous port, for call sites already inside an `async` function. Backed by
 * an adapter over the single {@link CryptoBackend} — never by a second, independent
 * `subtle` implementation.
 */
export interface Ed25519AsyncVerifier {
  verify(signature: Uint8Array, message: Uint8Array, publicKey: Uint8Array): Promise<boolean>
}

/**
 * Thrown by {@link getSyncVerifier} / {@link getAsyncVerifier} when
 * {@link initEd25519} has not yet resolved. Named class (not a bare string) *and*
 * a `code` discriminant, so a caller can either `instanceof`-check or read `.code` —
 * this port has no silent default, so forgetting to initialise it must fail loudly
 * rather than hand back a plausible-looking wrong answer.
 */
export class Ed25519NotInitializedError extends Error {
  readonly code = 'ed25519-not-initialized' as const
  readonly port: 'sync' | 'async'
  constructor(port: 'sync' | 'async') {
    super(
      `getEd25519${port === 'sync' ? 'Sync' : 'Async'}Verifier() was called before ` +
        'initEd25519() resolved — this port has no implicit default',
    )
    this.name = 'Ed25519NotInitializedError'
    this.port = port
  }
}

/**
 * Synchronous factory. No import, never throws, always available.
 *
 * The try/catch boundary matches `capability.ts:216-223`: everything that can throw
 * for a *structural* reason (wrong-length signature or public key — `@noble/curves`
 * throws rather than returning `false` for those, measured on this host) is caught
 * here so a malformed input reads as a refusal, never as an unhandled exception.
 * Nothing above the `try` can throw, so a defect in this module itself is never
 * misreported as "the caller's fault".
 */
export function createNobleSyncVerifier(): Ed25519SyncVerifier {
  return {
    backend: 'noble',
    verify(signature, message, publicKey) {
      try {
        return ed25519.verify(signature, message, publicKey)
      } catch {
        return false
      }
    },
  }
}

// ─── Crypto backend: subtle primary, noble fallback ──────────────────────────
//
// Moved here verbatim from `cert-lifecycle.ts:466-575` by Plan 28-01, minus the
// `Signature` alias (widened to its definition, `Uint8Array`, so the merged module
// does not import a type back out of `cert-lifecycle.ts` and close a cycle).

export type CryptoArm = 'subtle' | 'noble'

export interface CryptoBackend {
  readonly arm: CryptoArm
  signEd25519(seed: Uint8Array, message: Uint8Array): Promise<Uint8Array>
  verifyEd25519(publicKey: Uint8Array, signature: Uint8Array, message: Uint8Array): Promise<boolean>
  agreeX25519(seed: Uint8Array, peerPublicKey: Uint8Array): Promise<Uint8Array>
}

/**
 * `BufferSource` wants a `Uint8Array<ArrayBuffer>` specifically; this module's public
 * contract accepts the wider `Uint8Array`. Same cast this package already uses at
 * this exact boundary — see `canonical/encode.ts:118`, `net/src/conformance.ts:62`.
 */
function toBufferSource(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return bytes as Uint8Array<ArrayBuffer>
}

function ed25519PrivateJwk(seed: Uint8Array, publicKey: Uint8Array): JsonWebKey {
  return { kty: 'OKP', crv: 'Ed25519', d: toBase64Url(seed), x: toBase64Url(publicKey), key_ops: ['sign'], ext: true }
}
function x25519PrivateJwk(seed: Uint8Array, publicKey: Uint8Array): JsonWebKey {
  return { kty: 'OKP', crv: 'X25519', d: toBase64Url(seed), x: toBase64Url(publicKey), key_ops: ['deriveBits'], ext: true }
}
function x25519PublicJwk(publicKey: Uint8Array): JsonWebKey {
  return { kty: 'OKP', crv: 'X25519', x: toBase64Url(publicKey), ext: true }
}

/**
 * The noble arm — a plain static import (already in the bundle graph via
 * `@chainsafe/libp2p-noise`), used whenever `subtle` cannot do real Ed25519.
 */
export function nobleCryptoBackend(): CryptoBackend {
  return {
    arm: 'noble',
    async signEd25519(seed, message) {
      return ed25519.sign(message, seed)
    },
    async verifyEd25519(publicKey, signature, message) {
      try {
        return ed25519.verify(signature, message, publicKey)
      } catch {
        // Structural rejection (wrong-length key/signature) reads as a refusal,
        // never as an unhandled exception — same boundary as the sync port above.
        return false
      }
    },
    async agreeX25519(seed, peerPublicKey) {
      return x25519.getSharedSecret(seed, peerPublicKey)
    },
  }
}

/**
 * The subtle arm. Construction itself is unguarded — call this only after
 * {@link detectCryptoBackend}'s real capability probe has succeeded, or (in tests)
 * deliberately, to exercise this arm directly regardless of what the host would
 * auto-select.
 */
export function subtleCryptoBackend(subtle: SubtleCrypto = globalThis.crypto.subtle): CryptoBackend {
  return {
    arm: 'subtle',
    async signEd25519(seed, message) {
      const publicKey = ed25519.getPublicKey(seed)
      const key = await subtle.importKey('jwk', ed25519PrivateJwk(seed, publicKey), { name: 'Ed25519' }, false, ['sign'])
      const signature = await subtle.sign({ name: 'Ed25519' }, key, toBufferSource(message))
      return new Uint8Array(signature)
    },
    async verifyEd25519(publicKey, signature, message) {
      try {
        const key = await subtle.importKey('raw', toBufferSource(publicKey), { name: 'Ed25519' }, false, ['verify'])
        return await subtle.verify({ name: 'Ed25519' }, key, toBufferSource(signature), toBufferSource(message))
      } catch {
        // Malformed-input rejection (wrong-length key/signature) or an
        // unsupported-algorithm rejection both read as "not valid", never as a throw.
        return false
      }
    },
    async agreeX25519(seed, peerPublicKey) {
      const publicKey = x25519.getPublicKey(seed)
      const privateKey = await subtle.importKey('jwk', x25519PrivateJwk(seed, publicKey), { name: 'X25519' }, false, ['deriveBits'])
      const peerKey = await subtle.importKey('jwk', x25519PublicJwk(peerPublicKey), { name: 'X25519' }, false, [])
      const bits = await subtle.deriveBits({ name: 'X25519', public: peerKey }, privateKey, 256)
      return new Uint8Array(bits)
    },
  }
}

let backendPromise: Promise<CryptoBackend> | undefined

/**
 * Probe once, memoised, shared by every facade constructed through
 * `createSubject`/`createIssuer`/`createVerifier` **and** by {@link initEd25519}.
 * Calling this concurrently before the first call's probe resolves performs the probe
 * at most once — the second caller receives the same in-flight promise.
 */
export function createCryptoBackend(): Promise<CryptoBackend> {
  backendPromise ??= detectCryptoBackend()
  return backendPromise
}

/**
 * **The surviving gate.** Detection **probes, it does not infer from presence.**
 *
 * `crypto.subtle` exists on engines that lack Ed25519, so a presence check — a
 * `typeof` test for `subtle.sign` being a function, which is what this module used
 * until Phase 28 — selects a backend that cannot verify on exactly those
 * engines. The two failure modes are opposite and both are real: outside a secure
 * context `subtle` reads `undefined` *in its entirety* (25-CONTEXT.md's measurement,
 * which a presence check does catch), and inside a secure context on an
 * algorithm-incapable engine `subtle` is *present and refuses* `Ed25519` (which a
 * presence check does not). A real `generateKey` catches both; presence catches one.
 * Merging toward the presence check would have been merging toward the weaker gate.
 *
 * Measured on this host (Node v25.9.0): `subtle` Ed25519 sign+verify succeeds, so the
 * subtle arm is selected here.
 */
async function detectCryptoBackend(): Promise<CryptoBackend> {
  const subtle = globalThis.crypto?.subtle
  if (subtle !== undefined) {
    try {
      // The real probe. Discarded on success — this call's only purpose is to
      // observe whether it throws.
      await subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify'])
      return subtleCryptoBackend(subtle)
    } catch {
      // Falls through to noble.
    }
  }
  return nobleCryptoBackend()
}

// ─── The two ports, both settled by the one probe above ──────────────────────

let syncVerifier: Ed25519SyncVerifier | undefined
let asyncVerifier: Ed25519AsyncVerifier | undefined
let initPromise: Promise<void> | undefined

/**
 * Settles both ports from {@link createCryptoBackend}'s single probe. This function
 * holds **no capability decision of its own** — that is the point of the merge.
 *
 * The sync port is always noble, because it is the only synchronous implementation
 * (see the module docblock). The async port is an *adapter* over the probed
 * {@link CryptoBackend}, reordering `(signature, message, publicKey)` to
 * `verifyEd25519(publicKey, signature, message)` — this is the only place that
 * reordering happens, and getting it backwards is the obvious defect
 * `ed25519-backend.test.ts`'s port-agreement cases exist to catch.
 *
 * **Two memos, each with a stated job.** `initPromise` keeps *this* function
 * idempotent so two concurrent callers share one settlement; `createCryptoBackend`'s
 * own `backendPromise` is what guarantees the *probe* runs at most once, including for
 * callers that never touch these ports. Two memos with the same job is what Phase 28
 * removed; two memos with different jobs is fine.
 */
export function initEd25519(): Promise<void> {
  if (initPromise === undefined) {
    initPromise = (async () => {
      const backend = await createCryptoBackend()
      syncVerifier = createNobleSyncVerifier()
      asyncVerifier = {
        verify: (signature, message, publicKey) => backend.verifyEd25519(publicKey, signature, message),
      }
    })()
  }
  return initPromise
}

/** Throws {@link Ed25519NotInitializedError} if `initEd25519()` has not yet resolved. */
export function getSyncVerifier(): Ed25519SyncVerifier {
  if (syncVerifier === undefined) throw new Ed25519NotInitializedError('sync')
  return syncVerifier
}

/** Throws {@link Ed25519NotInitializedError} if `initEd25519()` has not yet resolved. */
export function getAsyncVerifier(): Ed25519AsyncVerifier {
  if (asyncVerifier === undefined) throw new Ed25519NotInitializedError('async')
  return asyncVerifier
}
