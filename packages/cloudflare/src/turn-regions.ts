import { HOSTED_OBJECT_NAMES } from './hosted-object.ts'
import type { HostedObjectName } from './hosted-object.ts'

/**
 * TURN rungs, one per declared region — NET-12, criterion 2's **built half**.
 *
 * ## The mapping is DERIVED, never written beside the name set
 *
 * `HOSTED_OBJECT_NAMES` is itself derived from `HOSTED_OBJECT_NAME` for a stated reason, and
 * `relayedBudgetPerDirection()` is the most recent example of the same preference: one
 * authoritative list and a derivation, so a fourth region cannot be added in one place and
 * forgotten in the other. {@link turnRegions} therefore walks the closed set rather than
 * transcribing it, and `turn-regions.test.ts` reddens if somebody pastes a literal object over
 * the derivation.
 *
 * ## Why this survives whichever way the provider's topology turns out
 *
 * **This module asserts nothing about Cloudflare's regional topology, and that is deliberate.**
 * One A-record resolution (`141.101.90.1`, recorded in the provider consult) is not a
 * measurement of anycast, and this repository does not settle a question by inference. So the
 * design is written so the answer does not matter:
 *
 * - if the provider offers per-region endpoints, each region's list names them;
 * - if it is anycast-only, all three lists name the same host and the **region tag carried in
 *   the credential** is what attributes an allocation.
 *
 * Either way an allocation is attributable, because the username the minter builds carries the
 * region. The measurement that would settle the topology question is a probe from two
 * continents, and this milestone cannot take it.
 *
 * ## What criterion 2 still lacks — TWO things, not one
 *
 * The criterion asks for *a cross-continent pair observed using its own region's rung rather
 * than one city's*. The obvious answer — "Phase 33 has not run" — is **incomplete**:
 *
 * 1. **Three sited objects.** Phase 33 owns siting `bootstrap-us`, `-eu` and `-sam`; it is gated
 *    on the owner and on money, and it has not run.
 * 2. **Clients on two continents.** Even with three sited objects there is no cross-continent
 *    *pair* until there are clients on two continents — Phase 39's cohort, or the tester cohort
 *    the owner already has access to.
 *
 * Neither is substitutable. Three objects on one local workerd are three **objects**, not three
 * regions, and a same-region substitute does not close the criterion. *Descoped is not
 * satisfied; unmeasured is not met.*
 *
 * ## No location is claimed anywhere in this file
 *
 * Phase 33's criterion 2 forbids any surface claiming where a hosted object runs, and this is
 * the point at which writing a city name first becomes tempting. A region name here is an
 * **address**, not a location: `bootstrap-eu` is the name a request is routed under, and it says
 * nothing about where the object holding that name was created. `turn-regions.test.ts` asserts
 * no location string appears in this module.
 */

/** A region's rung: the name it is addressed by, and the TURN URLs handed out under it. */
export interface TurnRegion {
  readonly name: HostedObjectName
  readonly urls: readonly string[]
}

/**
 * Split a comma-separated URL list, dropping empties.
 *
 * `wrangler dev` injects `''` for an absent var rather than omitting it, so an empty string has
 * to mean *nothing declared* rather than *one empty URL*.
 */
function urlList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '')
}

/**
 * Every declared region and the URLs it hands out, derived from the closed name set.
 *
 * `perRegion` lets a deployment give one region its own endpoints; anything unnamed there falls
 * back to `shared`. That fallback is not a convenience — it is what makes the module correct
 * under the anycast answer to a question nobody here has measured.
 */
export function turnRegions(config: {
  readonly shared?: string
  readonly perRegion?: Partial<Record<HostedObjectName, string>>
}): readonly TurnRegion[] {
  const shared = urlList(config.shared)
  return HOSTED_OBJECT_NAMES.map((name) => {
    const own = urlList(config.perRegion?.[name])
    return { name, urls: own.length > 0 ? own : shared }
  })
}

/** Thrown-free lookup: the URLs for `region`, or `null` when it is not a declared name. */
export function turnUrlsFor(
  region: string,
  config: {
    readonly shared?: string
    readonly perRegion?: Partial<Record<HostedObjectName, string>>
  },
): readonly string[] | null {
  // The same value check `stubFor` applies, and for its stated reason: *"a name that arrived
  // from a request is a `string`, and the only thing that can refuse it is a value check."*
  const found = turnRegions(config).find((entry) => entry.name === region)
  if (found === undefined || found.urls.length === 0) return null
  return found.urls
}

/** Whether `region` is one of the declared names. Narrows a request-supplied string. */
export function isDeclaredRegion(region: string): region is HostedObjectName {
  return (HOSTED_OBJECT_NAMES as readonly string[]).includes(region)
}
