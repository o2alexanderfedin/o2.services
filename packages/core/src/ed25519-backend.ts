/**
 * Ed25519 verification — a synchronous port and an asynchronous port, two adapters.
 *
 * This module implements `25-CONTEXT.md`'s "OWNER RULING 2026-08-09" (`crypto.subtle`
 * first, libsodium as the fallback when a host is not a secure context) as **scoped**
 * by that same document's "second ruling, same day": the adapter pattern. Read
 * together, not separately — the second ruling does not reverse the first, it decides
 * which of the two ports each backend is allowed to win on.
 *
 * ## Why `crypto.subtle` cannot implement the synchronous port
 *
 * Measured by execution on this host, Node v25.9.0 (not inferred from documentation):
 * `@noble/curves`'s `ed25519.verify` and libsodium's `crypto_sign_verify_detached`
 * (after one `await sodium.ready`) both return a plain `boolean` —
 * `instanceof Promise` is `false` for both. `crypto.subtle.sign`/`.verify` return an
 * object where `instanceof Promise` is `true`. A Promise cannot be awaited
 * synchronously in JavaScript, and no portable trick changes that on this project's
 * declared targets (`Atomics.wait` needs cross-origin isolation, which GitHub Pages
 * cannot supply — the same constraint that already rules out WASM threads here). So
 * the synchronous port has exactly two conforming implementations, noble and
 * libsodium, and `crypto.subtle` is confined to the separate asynchronous port, for
 * call sites that are already inside an `async` function.
 *
 * ## No production caller yet
 *
 * This module ships complete, tested, and unwired. `verifyChain` (`capability.ts`)
 * and `verifyCertificate` (`enrollment.ts`) are not switched onto it in this phase —
 * not because of an async-migration cost (the adapter dissolves that; see this
 * package's `ed25519-backend.test.ts`, "Part 1" of its migration-pricing docblock),
 * but because of a bootstrap-ordering decision across three runtime entry points that
 * this plan's obligations do not cover. See that same test file's "Part 3" for the
 * decision stated by name and what a future wiring pass needs to do.
 *
 * ## Pure module
 *
 * The only platform contact is `globalThis.crypto` (a portable Web-standard global
 * present in both Node and every browser target) and a lazy `import()`, gated behind
 * a capability check that runs before either executes, at most once, shared by both
 * ports.
 */

import { ed25519 } from '@noble/curves/ed25519.js'

export type Ed25519Backend = 'noble' | 'libsodium'

/**
 * The synchronous port. `verifyChain` and `PeerVerifier.verifiedPeers` can call this
 * without becoming async — that is the entire reason the adapter was chosen.
 */
export interface Ed25519SyncVerifier {
  readonly backend: Ed25519Backend
  verify(signature: Uint8Array, message: Uint8Array, publicKey: Uint8Array): boolean
}

/**
 * The asynchronous port, for call sites already inside an `async` function.
 * `crypto.subtle` when available; the same lazily-loaded libsodium instance the sync
 * port uses otherwise (never a second, independent import).
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

/**
 * Performs the lazy `import('libsodium-wrappers')` and `await sodium.ready`. The
 * only asynchronous step either adapter has — after this resolves, `.verify()` is an
 * ordinary synchronous call.
 *
 * A genuine dynamic `import()`, never hoisted to a static import anywhere in this
 * module or re-exported eagerly from `index.ts` — that is what keeps libsodium's
 * 314.9 KB gzip off a secure-context tier's bundle. See `initEd25519` for the
 * capability check that decides whether this function is ever called at all.
 */
export async function createLibsodiumSyncVerifier(): Promise<Ed25519SyncVerifier> {
  const { default: sodium } = await import('libsodium-wrappers')
  await sodium.ready
  return {
    backend: 'libsodium',
    verify(signature, message, publicKey) {
      // Same try/catch boundary as the noble adapter above: libsodium-wrappers
      // throws on wrong-length inputs (measured: "invalid signature length",
      // "invalid publicKey length") rather than returning `false` for them.
      try {
        return sodium.crypto_sign_verify_detached(signature, message, publicKey)
      } catch {
        return false
      }
    },
  }
}

/**
 * `undefined` if this host's `crypto.subtle` cannot verify Ed25519 (absent entirely,
 * or present but algorithm-incapable — both read the same way to a caller: a `verify`
 * call that cannot succeed).
 */
export function createSubtleAsyncVerifier(): Ed25519AsyncVerifier | undefined {
  if (typeof globalThis.crypto?.subtle?.verify !== 'function') return undefined
  const subtle = globalThis.crypto.subtle
  return {
    async verify(signature, message, publicKey) {
      try {
        // `BufferSource` wants a `Uint8Array<ArrayBuffer>` specifically; this port's
        // public contract (matching the sync port and `Ed25519SyncVerifier`) accepts
        // the wider `Uint8Array`. Same cast this package already uses at this exact
        // boundary — see `canonical/encode.ts:118`, `net/src/conformance.ts:62`.
        const key = await subtle.importKey(
          'raw',
          publicKey as Uint8Array<ArrayBuffer>,
          { name: 'Ed25519' },
          false,
          ['verify'],
        )
        return await subtle.verify(
          { name: 'Ed25519' },
          key,
          signature as Uint8Array<ArrayBuffer>,
          message as Uint8Array<ArrayBuffer>,
        )
      } catch {
        // Catches both a malformed-input rejection (wrong-length key, measured:
        // "Ed25519 raw keys must be exactly 32-bytes") and an unsupported-algorithm
        // rejection (some engines advertise `subtle` but not `Ed25519`) — the same
        // "resolves false, never throws" contract as the sync adapters above.
        return false
      }
    },
  }
}

let syncVerifier: Ed25519SyncVerifier | undefined
let asyncVerifier: Ed25519AsyncVerifier | undefined
let initPromise: Promise<void> | undefined

/**
 * One capability check, run at most once, memoised. Decides both ports from the same
 * decision: `crypto.subtle` Ed25519-capable -> sync port = noble, async port =
 * subtle, libsodium never imported. Not capable -> sync port = libsodium, async port
 * wraps the same libsodium instance, imported exactly once for both.
 *
 * The check is `typeof globalThis.crypto?.subtle?.sign === 'function'`, matching
 * `25-CONTEXT.md`'s measured finding that `subtle` reads `undefined` in its entirety
 * outside a secure context (not merely missing one algorithm) — so presence of the
 * object is the correct and sufficient gate for *this* decision, distinct from
 * {@link createSubtleAsyncVerifier}'s own per-call algorithm-capability handling.
 *
 * Calling this twice concurrently, before the first call's promise settles, performs
 * the import at most once: the second caller receives the same in-flight promise
 * rather than racing a second `import()`.
 */
export function initEd25519(): Promise<void> {
  if (initPromise === undefined) {
    initPromise = (async () => {
      const subtleCapable = typeof globalThis.crypto?.subtle?.sign === 'function'

      if (subtleCapable) {
        syncVerifier = createNobleSyncVerifier()
        // Non-null: the same check that selected this branch guarantees
        // `createSubtleAsyncVerifier()` finds `subtle.verify` present.
        asyncVerifier = createSubtleAsyncVerifier()!
      } else {
        // The one arm that imports libsodium — exactly once, shared by both ports.
        const libsodiumVerifier = await createLibsodiumSyncVerifier()
        syncVerifier = libsodiumVerifier
        asyncVerifier = {
          verify: (signature, message, publicKey) =>
            Promise.resolve(libsodiumVerifier.verify(signature, message, publicKey)),
        }
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
