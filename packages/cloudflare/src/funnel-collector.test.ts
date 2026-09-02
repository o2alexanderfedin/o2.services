/**
 * The collection-side derivation, in the node lane and over plain `Headers`.
 *
 * A pure function is what makes this testable at all: a method on `BootstrapObject` would need
 * a Durable Object to exercise, and the property being asserted — *what the collector derives
 * from a request* — has nothing to do with storage. `funnel-collector.e2e.test.ts` holds the
 * other half, which is what the STORE contains after a real workerd has handled a real request.
 *
 * **The report PARSER's cases are not here**, and the split follows where the code lives:
 * `parseFunnelReport` is the wire contract's own parser and lives in `@o2/net` beside the
 * contract, so its cases are in `funnel-schema.test.ts` where they run in the browser lane too.
 * What is here is the half that reads a Cloudflare header, which only this tier does.
 */

import { describe, expect, it } from 'vitest'
import { FUNNEL_UNKNOWN_COUNTRY } from '@o2/net'
import {
  CLIENT_COUNTRY_HEADER,
  CLIENT_NETWORK_CLASS_HEADER,
  funnelDimensionsFrom,
} from './funnel-collector.ts'
import { CLIENT_ADDRESS_HEADER } from './websocket-connection.ts'

/** A request, as narrowly as this module reads one. `cf` absent unless a case supplies it. */
const req = (headers: Headers, cf?: unknown): { headers: Headers; cf?: unknown } =>
  cf === undefined ? { headers } : { headers, cf }

describe('the dimensions come off the request, coarsely, and never from the address', () => {
  it('reads the country the edge stamped', () => {
    const headers = new Headers({ [CLIENT_COUNTRY_HEADER]: 'DE' })
    expect(funnelDimensionsFrom(req(headers)).country).toBe('DE')
  })

  it('answers ZZ when the edge says nothing, rather than inventing one', () => {
    expect(funnelDimensionsFrom(req(new Headers())).country).toBe(FUNNEL_UNKNOWN_COUNTRY)
  })

  it('answers ZZ for anything the schema does not admit', () => {
    for (const refused of ['DEU', 'd', '', 'DE-NW', '12']) {
      const headers = new Headers({ [CLIENT_COUNTRY_HEADER]: refused })
      expect(
        funnelDimensionsFrom(req(headers)).country,
        `"${refused}" was stored as sent rather than refused`,
      ).toBe(FUNNEL_UNKNOWN_COUNTRY)
    }
  })

  it('DERIVES NOTHING from the client address — criterion 4, at the point of collection', () => {
    // The positive control's cheap half: the address IS on the request, exactly as it is on the
    // socket path (`websocket-connection.ts:86`), and the dimensions come back with no trace of
    // it. The store-level proof is in `funnel-collector.e2e.test.ts`; this one says the pure
    // derivation cannot be the leak.
    const headers = new Headers({ [CLIENT_ADDRESS_HEADER]: '203.0.113.45' })
    const dimensions = funnelDimensionsFrom(req(headers))
    expect(dimensions.country).toBe(FUNNEL_UNKNOWN_COUNTRY)
    expect(JSON.stringify(dimensions)).not.toContain('203.0.113')
    expect(JSON.stringify(dimensions)).not.toContain('203')
  })

  it('keeps XX, and loses T1 to the letters-only rule — measured, not assumed', () => {
    // MEASURED 2026-09-02, and it went the other way from how this case was first written.
    // `XX` is what the edge sends for a request it could not place: two uppercase letters, so
    // it survives and a reader can tell it apart from "no header arrived at all".
    expect(funnelDimensionsFrom(req(new Headers({ [CLIENT_COUNTRY_HEADER]: 'XX' }))).country).toBe('XX')
    // `T1` is what it sends for a request arriving over Tor. It carries a DIGIT, so the
    // schema's two-uppercase-letters rule refuses it and a Tor visit is filed as ZZ —
    // indistinguishable from a visit whose country the edge never stamped. The rule was not
    // widened to rescue it; see `funnel-collector.ts`'s header for what that costs and why.
    expect(funnelDimensionsFrom(req(new Headers({ [CLIENT_COUNTRY_HEADER]: 'T1' }))).country).toBe('ZZ')
  })

  /**
   * MEASURED 2026-09-02 on a local `wrangler dev`, and the values are this machine's real ones.
   *
   * `request.cf` is NOT edge-only: it arrived locally carrying thirty-three properties
   * populated from this host's public address. The fixture below is that reading, trimmed to
   * the fields that matter to the argument and otherwise verbatim.
   */
  const MEASURED_CF = {
    country: 'US',
    city: 'San Jose',
    region: 'California',
    regionCode: 'CA',
    continent: 'NA',
    colo: 'SJC',
    asn: 62_628,
    asOrganization: 'Zoox Labs, Inc.',
    latitude: '37.33939',
    longitude: '-121.89496',
    postalCode: '95110',
    timezone: 'America/Los_Angeles',
    clientTcpRtt: 7,
  }

  it('falls back to the country the platform object carries, which is what workerd supplies', () => {
    // The header is absent under a local `wrangler dev` — measured, five headers and no
    // `CF-IPCountry` among them — so without this fallback the country dimension could not be
    // exercised anywhere but a deployed object.
    expect(funnelDimensionsFrom(req(new Headers(), MEASURED_CF)).country).toBe('US')
  })

  it('prefers the header when both are present, because the header is the documented contract', () => {
    const headers = new Headers({ [CLIENT_COUNTRY_HEADER]: 'DE' })
    expect(funnelDimensionsFrom(req(headers, MEASURED_CF)).country).toBe('DE')
  })

  it('READS ONE PROPERTY of thirty-three, and the other thirty-two are the point', () => {
    // criterion 4, at the point of collection and against the richest thing at the door. The
    // platform hands this Worker a street-level location, an ISP and a network fingerprint on
    // every request; nothing in the platform stops any of it being stored. What stops it is
    // this function reading `country` and the store dump in `funnel-collector.e2e.test.ts`
    // proving the rest never arrives.
    const dimensions = funnelDimensionsFrom(req(new Headers(), MEASURED_CF))
    const rendered = JSON.stringify(dimensions)
    for (const forbidden of [
      'San Jose',
      'California',
      '95110',
      '37.33939',
      '-121.89496',
      'Zoox',
      '62628',
      'America/Los_Angeles',
      'SJC',
    ]) {
      expect(rendered, `the dimensions carry ${forbidden}`).not.toContain(forbidden)
    }
    // And the one field it does carry is the one it is allowed to.
    expect(dimensions.country).toBe('US')
  })

  it('refuses a platform country the schema does not admit', () => {
    expect(funnelDimensionsFrom(req(new Headers(), { country: 'T1' })).country).toBe('ZZ')
    expect(funnelDimensionsFrom(req(new Headers(), { country: 42 })).country).toBe('ZZ')
    expect(funnelDimensionsFrom(req(new Headers(), 'not an object')).country).toBe('ZZ')
  })

  it('holds the network class to the closed list', () => {
    expect(
      funnelDimensionsFrom(req(new Headers({ [CLIENT_NETWORK_CLASS_HEADER]: 'cellular' }))).networkClass,
    ).toBe('cellular')
    // A value the browser might plausibly hand over — `effectiveType` really does answer
    // `slow-2g` — refused because the list is closed and the reporter maps before it sends.
    expect(
      funnelDimensionsFrom(req(new Headers({ [CLIENT_NETWORK_CLASS_HEADER]: 'slow-2g' }))).networkClass,
    ).toBe('unknown')
    expect(funnelDimensionsFrom(req(new Headers())).networkClass).toBe('unknown')
  })
})
