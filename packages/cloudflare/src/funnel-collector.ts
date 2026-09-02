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

import { FUNNEL_UNKNOWN_COUNTRY, isFunnelCountry } from '@o2/net'
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
 *
 * **MEASURED 2026-09-02 against a local `wrangler dev`, and it is NOT stamped there.** The
 * request carried five headers — `accept`, `accept-encoding`, `cf-connecting-ip`, `host`,
 * `user-agent` — and no `CF-IPCountry` among them. So this path alone would answer `ZZ` for
 * every local run, which would make the country dimension untestable outside a deploy.
 * {@link CF_COUNTRY_PROPERTY} is why it is testable anyway.
 */
export const CLIENT_COUNTRY_HEADER = 'CF-IPCountry'

/**
 * The one property of `request.cf` this code is allowed to touch, and the reason it is one.
 *
 * **MEASURED 2026-09-02 on a local `wrangler dev`, and the reading is why this constant has a
 * docblock rather than being inlined.** `request.cf` exists locally — it is not an edge-only
 * object — and it arrived carrying **thirty-three** properties populated from this machine's
 * real public address. Read verbatim off the probe:
 *
 * ```
 * country = 'US'          city = 'San Jose'       region = 'California'
 * postalCode = '95110'    latitude = '37.33939'   longitude = '-121.89496'
 * asn = 62628             asOrganization = 'Zoox Labs, Inc.'
 * timezone = 'America/Los_Angeles'                clientTcpRtt = 7
 * ```
 *
 * **That is a street-level location, an ISP and a network fingerprint, one property access
 * away from the collector, on every request, locally as well as on the edge.** Nothing in the
 * platform prevents any of it from being stored; the only thing that does is this line reading
 * one property and the arm in `funnel-collector.e2e.test.ts` proving the rest is absent from
 * the store. It is also what makes criterion 4's positive control unusually strong: the thing
 * that must not be in the store is demonstrably at the door, and demonstrably richer than the
 * IP address the criterion names.
 *
 * `country` is read and the other thirty-two are not, because two letters is a country and
 * `postalCode` is a person's neighbourhood. `latitude` and `longitude` are strings here rather
 * than numbers, which is worth knowing only because it means a naive `typeof === 'number'`
 * filter would not have excluded them.
 */
export const CF_COUNTRY_PROPERTY = 'country'

/** The shape of a request this module reads. Narrow, so a node-lane spec can build one. */
export interface FunnelRequestFacts {
  readonly headers: Headers
  /** The platform's per-request object. Present locally as well as on the edge — see above. */
  readonly cf?: unknown
}

/**
 * The country, read off the request.
 *
 * Anything the schema does not admit becomes `ZZ` rather than being stored as sent. That is not leniency: a value outside a closed list is a field whose width the sender
 * chose, and the whole reason these lists are closed is that a wide enough field is a
 * fingerprint.
 *
 * **The header is asked first and `request.cf` second, and the order is not a preference.**
 * `CF-IPCountry` is the documented edge contract and is the value an operator can see in a log;
 * `request.cf.country` is what a LOCAL workerd actually supplies, measured, so the fallback is
 * what makes the country path exercisable without a deploy. Neither is derived from the address
 * by this code: both are labels the platform attached, and computing a location from an IP
 * inside this Worker would be geolocation performed by this project on data it promised to
 * discard, which is a different act from reading a label somebody else stamped.
 */
export function funnelDimensionsFrom(request: FunnelRequestFacts): FunnelDimensions {
  const fromHeader = request.headers.get(CLIENT_COUNTRY_HEADER)?.toUpperCase() ?? null
  const cf = request.cf
  const fromPlatform =
    typeof cf === 'object' && cf !== null
      ? ((cf as Record<string, unknown>)[CF_COUNTRY_PROPERTY] ?? null)
      : null
  const country = isFunnelCountry(fromHeader)
    ? fromHeader
    : typeof fromPlatform === 'string' && isFunnelCountry(fromPlatform.toUpperCase())
      ? fromPlatform.toUpperCase()
      : FUNNEL_UNKNOWN_COUNTRY

  return { country }
}

/** The widest an accepted body may be. A beacon is one small object; anything else is not one. */
export const MAX_FUNNEL_BODY_BYTES = 1024
