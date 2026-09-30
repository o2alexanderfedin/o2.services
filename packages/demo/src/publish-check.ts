/**
 * The check `scripts/sign-kernel.ts` runs on every module before it signs one.
 *
 * A node refuses a guest whose memory declares no maximum, or a maximum above its cap
 * (`checkMemoryCap` in `@o2/core`). Signing such a module would publish a record every
 * stock node then refuses to run — a signed artifact that is unrunnable by construction.
 * The signer holds itself to the node's rule so that cannot be produced, and says which
 * module and why rather than writing the record.
 *
 * Separate from the script so it can be tested without running it: every run of the
 * script generates new keys and new records, which is exactly what a test must not do.
 */

import { checkMemoryCap, DEFAULT_MAX_MEMORY_PAGES, describeMemoryRefusal } from '@o2/core'

/** Throws, naming `name` and the refusal, unless a node with `capPages` would run `bytes`. */
export function assertPublishable(
  name: string,
  bytes: Uint8Array,
  capPages: number = DEFAULT_MAX_MEMORY_PAGES,
): void {
  const verdict = checkMemoryCap(bytes, capPages)
  if (!verdict.ok) {
    throw new Error(`refusing to sign ${name}: ${describeMemoryRefusal(verdict.refusal)}`)
  }
}
