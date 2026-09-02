/**
 * What the EDGE says about a visit, and what a visitor is allowed to say about themselves.
 *
 * ## The one sentence this module exists to enforce
 *
 * **The client IP may be read, and nothing derived from it that survives the request may be
 * stored.** `websocket-connection.ts:86` already reads `CF-Connecting-IP` on the socket path
 * and libp2p rate-limits on it — this tier legitimately handles a raw address. Criterion 4 is
 * about what is in the **store** afterwards, and the answer here is: a two-letter country code
 * that the edge stamped, a network class from a closed list, and nothing else.
 *
 * A country is not a person. Two letters cannot narrow anyone, and the code below never
 * *derives* one from an address — it reads the edge's own header or answers `ZZ`. Deriving a
 * country from an IP inside this Worker would be geolocation performed by this project on data
 * it promised to discard, which is a different act from reading a label the platform attached.
 *
 * ## Why the dimensions are separate from the report
 *
 * A browser composes a {@link FunnelReport}; the edge supplies the dimensions. Keeping them
 * apart in the types means a visitor cannot choose which country their visit is filed under,
 * which is the difference between a measurement and a poll. It also means the collector never
 * has to trust a field it did not stamp.
 *
 * ## Validated where the range is declared
 *
 * `isFunnelCountry`, `isFunnelNetworkClass` and the rest live in `@o2/net`'s `funnel-schema.ts`
 * beside the lists they check. `start-outcome.ts:95-105` states the discipline and the reason:
 * *"The disclosure promise rests on the coarseness, so the range is checked where the range is
 * declared rather than at each place a label lands."*
 *
 * Pure module — headers in, values out, no I/O and no storage.
 */

import { FUNNEL_UNKNOWN_COUNTRY, isFunnelCountry, isFunnelNetworkClass } from '@o2/net'
import type { FunnelDimensions } from './funnel-journal.ts'

/**
 * The header Cloudflare's edge stamps with a two-letter country code.
 *
 * Named here rather than inline for the reason `CLIENT_ADDRESS_HEADER` is named in
 * `websocket-connection.ts`: a header this tier depends on is a platform contract, and a
 * contract written in one place can be checked in one place.
 *
 * **`XX` and `T1` are values the edge really sends** — `XX` for a request the edge could not
 * place, `T1` for one arriving over Tor — and the schema treats them DIFFERENTLY, which is a
 * finding rather than a decision. `XX` is two uppercase letters, so it passes and is stored as
 * itself: an honest "the edge could not place this" that a reader can tell apart from "no
 * header arrived". `T1` contains a digit, so the schema's letters-only rule refuses it and it
 * is filed as `ZZ`.
 *
 * **What that costs, stated rather than smoothed over: a Tor visit is indistinguishable from a
 * visit with no country header at all.** The rule was not widened to admit it. Two uppercase
 * letters is a bound somebody can check by reading one regular expression; `[A-Z][A-Z0-9]`
 * would admit 936 codes to rescue one, and the reason the range is narrow is that a field whose
 * width the sender chooses is the fingerprint these lists exist to prevent. The loss is one
 * bucket's worth of signal on a population this project has no reading of yet, and it is
 * recorded here so a later phase can reopen it deliberately rather than discover it.
 */
export const CLIENT_COUNTRY_HEADER = 'CF-IPCountry'

/**
 * A header naming the visitor's coarse network class, when the arrangement supplies one.
 *
 * **Cloudflare does not stamp this and this project does not pretend otherwise.** The value is
 * the browser's own reading of `navigator.connection.effectiveType`, sent by the reporter,
 * which makes it the one dimension a visitor could lie about. That is accepted for the reason
 * `start-report.ts` accepts an inflatable count — authenticating a visitor is exactly what
 * criterion 4 forbids — and it is recorded beside the figures rather than mitigated.
 */
export const CLIENT_NETWORK_CLASS_HEADER = 'X-O2-Network-Class'

/**
 * The two dimensions, read off the request.
 *
 * Anything the schema does not admit becomes `ZZ` / `unknown` rather than being stored as
 * sent. That is not leniency: a value outside a closed list is a field whose width the sender
 * chose, and the whole reason these lists are closed is that a wide enough field is a
 * fingerprint.
 */
export function funnelDimensionsFrom(headers: Headers): FunnelDimensions {
  const country = headers.get(CLIENT_COUNTRY_HEADER)?.toUpperCase() ?? null
  const networkClass = headers.get(CLIENT_NETWORK_CLASS_HEADER)?.toLowerCase() ?? null
  return {
    country: isFunnelCountry(country) ? country : FUNNEL_UNKNOWN_COUNTRY,
    networkClass: isFunnelNetworkClass(networkClass) ? networkClass : 'unknown',
  }
}

/** The widest an accepted body may be. A beacon is one small object; anything else is not one. */
export const MAX_FUNNEL_BODY_BYTES = 1024
