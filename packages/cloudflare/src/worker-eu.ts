/**
 * The `eu` region's deployed entry point — Phase 33, `HOST-06`.
 *
 * ## Why this is a separate file rather than a branch in `worker.ts`
 *
 * `HOST-06`'s ledger row (`.planning/REQUIREMENTS.md:2193`) states that the three regions
 * "must not be created by one uniform code path that hides the difference." Narrowing a
 * namespace by {@link euJurisdictionOf} is a **platform call that changes which object ID a
 * name derives to** — it is not a label, and hiding it behind a shared helper's internal
 * branch is exactly the shape that row refuses. So this file exists to make the difference
 * visible at the call site: it narrows the namespace with {@link euJurisdictionOf} *before*
 * handing it to {@link stubFor}, and nothing else about it differs from `worker.ts`'s own
 * entry.
 *
 * ## This entry CANNOT be exercised under a local `wrangler dev`, measured rather than expected
 *
 * A local `workerd` throws `Error: Jurisdiction restrictions are not implemented in workerd.`
 * for **every** binding-placement value — `eu`, `us`, `fedramp` and the `sam` hint alike —
 * read 2026-09-13 off a throwaway worker under `wrangler dev`. The refusal is value-independent,
 * so a local boot test against this entry would prove nothing about the code and would only
 * prove that `workerd` still refuses this narrowing locally. This entry's local verifications
 * are therefore the `--dry-run` build in `wrangler.eu.jsonc` (which does not run the worker,
 * only bundles it) and the placement cases in `hosted-identity.test.ts`, which exercise
 * {@link euJurisdictionOf} against a spy namespace rather than a real one.
 *
 * Creating the object this entry serves — the first real `get()` — is `waits on owner act 2`
 * (`.planning/OWNER-ACTIONS.md` row 2). Nothing here deploys or reaches the network.
 */

// Re-exported so wrangler's migration finds the class under this entry's own `main`. Importing
// `worker.ts` also runs ITS first import — `./workerd-shims.ts`, for its side effect — before
// anything here can reach `BootstrapObject`, so this file needs no separate shim import.
export { BootstrapObject } from './worker.ts'

import { euJurisdictionOf, stubFor } from './hosted-object.ts'
import type { HostedEnv } from './worker.ts'
import type { HostedObjectName } from './hosted-object.ts'

/**
 * Which object this entry serves — a module constant, never derived from a request, on
 * `worker.ts`'s `SERVED_BY` docblock's stated reason: a visitor must not be able to cause an
 * object to be created, and an object is created by its first `get()`.
 */
const SERVED_BY: HostedObjectName = 'bootstrap-eu'

export default {
  async fetch(request: Request, env: HostedEnv): Promise<Response> {
    return stubFor(euJurisdictionOf(env.BOOTSTRAP), SERVED_BY).fetch(request)
  },
}
