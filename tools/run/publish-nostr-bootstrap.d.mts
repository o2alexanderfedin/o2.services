/**
 * Types for the Nostr bootstrap publisher. See `publish-nostr-bootstrap.mjs`.
 *
 * A sibling declaration file rather than `allowJs`, on this tree's own precedent:
 * `tools/run/stage-budget.d.mts` and `packages/demo/scripts/compile-kernel.d.mts` sit beside
 * their `.mjs` for the same reason and are imported the same way. The module is plain ESM so it
 * runs from `deploy-pages.sh` with no build step, which is what lets a deploy call it.
 */

/** NIP-78 parameterized replaceable — the same kind the reader filters on. */
export declare const KIND: number

/** The `d` tag — the same identifier the reader filters on. */
export declare const IDENTIFIER: string

/** The relays written to. Deliberately the same list the reader asks. */
export declare const RELAYS: readonly string[]

/** A signed NIP-01 event, in the shape a relay takes and the reader verifies. */
export interface SignedBootstrapEvent {
  readonly id: string
  readonly pubkey: string
  readonly created_at: number
  readonly kind: number
  readonly tags: readonly (readonly string[])[]
  readonly content: string
  readonly sig: string
}

/**
 * Sign a document as a bootstrap event.
 *
 * `createdAt` has no default so a caller cannot sign with a clock it did not choose — the value
 * decides which of two documents a relay calls newer, and whether the reader calls one replayed.
 * It is **seconds**, as NIP-01 requires.
 */
export declare function signBootstrapDocument(
  secretHex: string,
  document: string,
  createdAt: number,
): SignedBootstrapEvent

/** What one relay said about one event. */
export interface PublishResult {
  readonly url: string
  readonly accepted: boolean
  readonly detail: string
}

/** Send one event to one relay. Never throws and never rejects. */
export declare function publishTo(
  url: string,
  event: SignedBootstrapEvent,
  timeoutMs?: number,
): Promise<PublishResult>

/**
 * The key, from the environment or from the ignored directory beside the project, or `null`.
 *
 * A blank value in either place answers `null`: a key that is the empty string would sign
 * nothing and is indistinguishable from a forgotten one.
 */
export declare function readSecret(
  env?: Record<string, string | undefined>,
  secretsPath?: string,
): string | null
