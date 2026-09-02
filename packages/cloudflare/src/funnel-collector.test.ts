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

describe('the dimensions come off the request, coarsely, and never from the address', () => {
  it('reads the country the edge stamped', () => {
    const headers = new Headers({ [CLIENT_COUNTRY_HEADER]: 'DE' })
    expect(funnelDimensionsFrom(headers).country).toBe('DE')
  })

  it('answers ZZ when the edge says nothing, rather than inventing one', () => {
    expect(funnelDimensionsFrom(new Headers()).country).toBe(FUNNEL_UNKNOWN_COUNTRY)
  })

  it('answers ZZ for anything the schema does not admit', () => {
    for (const refused of ['DEU', 'd', '', 'DE-NW', '12']) {
      const headers = new Headers({ [CLIENT_COUNTRY_HEADER]: refused })
      expect(
        funnelDimensionsFrom(headers).country,
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
    const dimensions = funnelDimensionsFrom(headers)
    expect(dimensions.country).toBe(FUNNEL_UNKNOWN_COUNTRY)
    expect(JSON.stringify(dimensions)).not.toContain('203.0.113')
    expect(JSON.stringify(dimensions)).not.toContain('203')
  })

  it('keeps XX, and loses T1 to the letters-only rule — measured, not assumed', () => {
    // MEASURED 2026-09-02, and it went the other way from how this case was first written.
    // `XX` is what the edge sends for a request it could not place: two uppercase letters, so
    // it survives and a reader can tell it apart from "no header arrived at all".
    expect(funnelDimensionsFrom(new Headers({ [CLIENT_COUNTRY_HEADER]: 'XX' })).country).toBe('XX')
    // `T1` is what it sends for a request arriving over Tor. It carries a DIGIT, so the
    // schema's two-uppercase-letters rule refuses it and a Tor visit is filed as ZZ —
    // indistinguishable from a visit whose country the edge never stamped. The rule was not
    // widened to rescue it; see `funnel-collector.ts`'s header for what that costs and why.
    expect(funnelDimensionsFrom(new Headers({ [CLIENT_COUNTRY_HEADER]: 'T1' })).country).toBe('ZZ')
  })

  it('holds the network class to the closed list', () => {
    expect(
      funnelDimensionsFrom(new Headers({ [CLIENT_NETWORK_CLASS_HEADER]: 'cellular' })).networkClass,
    ).toBe('cellular')
    // A value the browser might plausibly hand over — `effectiveType` really does answer
    // `slow-2g` — refused because the list is closed and the reporter maps before it sends.
    expect(
      funnelDimensionsFrom(new Headers({ [CLIENT_NETWORK_CLASS_HEADER]: 'slow-2g' })).networkClass,
    ).toBe('unknown')
    expect(funnelDimensionsFrom(new Headers()).networkClass).toBe('unknown')
  })
})
