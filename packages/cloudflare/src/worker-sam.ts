/**
 * The `sam` region's deployed entry point — Phase 33, `HOST-06`.
 *
 * ## Why a hint rather than a binding narrowing
 *
 * No South-American value exists in the platform's own binding-placement enum at all — `eu`,
 * `fedramp`, `fedramp-high` and `us` are its whole set (declared in `hosted-object.ts`).
 * `.planning/REQUIREMENTS.md:2193` names this directly: `bootstrap-sam` carries a
 * **`locationHint` only**, because no member of that set binds it. So placement here is
 * best-effort **by construction, not by preference** — there is no stronger mechanism
 * available to ask for, and this file does not pretend there is one by wrapping the namespace
 * in anything.
 *
 * ## The hint is not validated by the platform, measured rather than assumed
 *
 * A local `workerd` accepts **any** string as a `locationHint` — measured 2026-09-13,
 * `namespace.get(id, { locationHint: 'notareal' })` returned a live stub with no refusal. So
 * the closed set declared in `hosted-object.ts` ({@link HOSTED_LOCATION_HINT}) is the only
 * refusal of a mistyped hint that exists anywhere in this system; the platform itself refuses
 * nothing.
 *
 * Creating the object this entry serves — the first real `get()` — is `waits on owner act 2`
 * (`.planning/OWNER-ACTIONS.md` row 2). Nothing here deploys or reaches the network.
 */

// Re-exported so wrangler's migration finds the class under this entry's own `main`. Importing
// `worker.ts` also runs ITS first import — `./workerd-shims.ts`, for its side effect — before
// anything here can reach `BootstrapObject`, so this file needs no separate shim import.
export { BootstrapObject } from './worker.ts'

import { samLocationHint, stubFor } from './hosted-object.ts'
import type { HostedEnv } from './worker.ts'
import type { HostedObjectName } from './hosted-object.ts'

/**
 * Which object this entry serves — a module constant, never derived from a request, on
 * `worker.ts`'s `SERVED_BY` docblock's stated reason: a visitor must not be able to cause an
 * object to be created, and an object is created by its first `get()`.
 */
const SERVED_BY: HostedObjectName = 'bootstrap-sam'

export default {
  async fetch(request: Request, env: HostedEnv): Promise<Response> {
    return stubFor(env.BOOTSTRAP, SERVED_BY, samLocationHint()).fetch(request)
  },
}
