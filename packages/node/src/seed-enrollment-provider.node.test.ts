import { describe, expect, it } from 'vitest'
import { bootstrapInfoFor } from './seed-server.ts'

/**
 * AUTH-01 / AUTH-02 / AUTH-04 / DEMO-01 — a closed seed can name where to enrol.
 *
 * ## The gap this closes, stated as the source stated it first
 *
 * `SeedServerOptions.relayAdmission`'s docblock takes on a deployment requirement in its own
 * words: *"a relay that pins issuers must either serve enrolment itself, or name a provider a
 * joining peer can reach without a reservation."* It then says the un-named case — a closed
 * seed with no reachable provider — is **operator error**, and that the sentence is printed in
 * the seed's own banner so an operator meets it.
 *
 * **Neither remedy was implementable.** `SeedServerOptions` had no field naming a provider,
 * `bin/seed.ts` had no flag, `BootstrapInfo` had no member to publish one, and the page's
 * `discoverRelays` read `relayAddrs` and nothing else. So an operator who read the banner and
 * set out to comply *could not* — the requirement was stated and unsatisfiable, which is worse
 * than an absent requirement because it reads as though a mechanism exists.
 *
 * The v1.1 milestone audit recorded this as *"a closed seed is unjoinable by the demo page"*.
 * **That headline is partly a correct security property and the distinction is load-bearing.**
 * A closed seed *should* refuse an anonymous visitor holding no certificate — that is the whole
 * of AUTH-02, and `gated-seed.e2e.test.ts` asserts the refusal. What was broken is narrower and
 * real: an operator had no way to point a joiner at the door it is meant to enrol through.
 *
 * ## Why the provider is named rather than served
 *
 * Of the two remedies the docblock offers, this takes the second. Serving enrolment from the
 * seed would fold two roles this repository deliberately separates — `gated-seed.e2e.test.ts`
 * puts it as *"the door a tab is refused at is not the door it enrols through"* — and would make
 * every seed an identity authority. Naming costs one optional field and changes no role.
 *
 * It is also already sound at the transport layer, and that was measured rather than assumed:
 * Plan 24-05 found a joiner enrolling successfully against a provider that had refused it a
 * reservation, because `resolveCertificate` enrols over a **plain dial** with no reservation
 * anywhere in its path. So a named provider is reachable by a peer the seed itself will not yet
 * admit — which is precisely the peer that needs it.
 *
 * ## What this file does NOT claim
 *
 * It does not claim a visitor auto-enrols. `demo/main.ts`'s `autoStart` passes no `enrollment`
 * and must not grow a parameter for one — *"a page that was found rather than configured must
 * not be configurable by whatever found it"* — and a certificate is signed over the visitor's
 * **own** key, which no seed can supply. Publishing an address is discovery; supplying an
 * identity would be configuration. Only the first belongs here.
 *
 * Pure: builds the payload the HTTP route serves, with no server and no socket.
 */

const SEED_PEER_ID = '12D3KooWQYV9dGMFoRzNStwpXztXaBUjtPWmycqhNMKfSDDGrVGL'
const PROVIDER = '/dns4/enrol.example/tcp/443/tls/ws/p2p/12D3KooWJvyP3VJYymTqG7eH4PM5rcTrGkYCRDLTBLxeANWgJs2W'

describe('a seed that pins issuers can name the provider a joiner enrols through', () => {
  it('publishes the provider it was given, so a page learns it from its own origin', () => {
    const info = bootstrapInfoFor({
      host: 'laptop.local:5173',
      wsPort: 4001,
      seedPeerId: SEED_PEER_ID,
      reservedPeerIds: [],
      enrollmentProvider: PROVIDER,
    })

    expect(info.enrollmentProvider).toBe(PROVIDER)
  })

  /**
   * The absence is a **named** absence, not a default.
   *
   * An open seed needs no provider — every peer is admitted — so publishing an empty string or
   * the seed's own address would both be answers to a question nobody asked. `undefined` is the
   * one value a page can distinguish from "there is a provider and it is X".
   */
  it('omits the field entirely when no provider was named, rather than inventing one', () => {
    const info = bootstrapInfoFor({
      host: 'laptop.local:5173',
      wsPort: 4001,
      seedPeerId: SEED_PEER_ID,
      reservedPeerIds: [],
    })

    expect(info.enrollmentProvider).toBeUndefined()
    expect(Object.hasOwn(info, 'enrollmentProvider')).toBe(false)
  })

  /**
   * The provider is **not** derived from the request host, and every other address here is.
   *
   * `relayAddrs` and `peerAddrs` are rewritten through the `Host` header so a phone reaching
   * `laptop.local` is never handed `127.0.0.1`. The provider is a different node on a different
   * host — frequently not on this LAN at all — so host-rewriting it would corrupt it. This case
   * exists because that rewrite is the obvious thing to do and it is wrong here.
   */
  it('leaves the provider address untouched while host-deriving the seed addresses', () => {
    const info = bootstrapInfoFor({
      host: 'laptop.local:5173',
      wsPort: 4001,
      seedPeerId: SEED_PEER_ID,
      reservedPeerIds: [],
      enrollmentProvider: PROVIDER,
    })

    expect(info.enrollmentProvider).toBe(PROVIDER)
    expect(info.relayAddrs[0]).toContain('laptop.local')
    expect(info.enrollmentProvider).not.toContain('laptop.local')
  })

  /**
   * The payload keeps every guarantee it already made — this function was extracted from the
   * route closure, and an extraction that quietly changed the wire would be a regression no
   * existing test names, because no existing test could reach the closure.
   */
  it('still leads peerAddrs with the seed itself, repeating relayAddrs[0] exactly', () => {
    const info = bootstrapInfoFor({
      host: 'phone.local:5173',
      wsPort: 4001,
      seedPeerId: SEED_PEER_ID,
      reservedPeerIds: ['12D3KooWBmwmnhnDdKZgCEbLWNfMkeoPBBFbHfWTZDkoQTFrTGWX'],
      enrollmentProvider: PROVIDER,
    })

    expect(info.peerAddrs[0]).toBe(info.relayAddrs[0])
    expect(info.seedPeerId).toBe(SEED_PEER_ID)
    expect(info.peerAddrs[1]).toContain('/p2p-circuit/webrtc/p2p/')
  })
})
