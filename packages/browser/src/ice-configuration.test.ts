import { describe, expect, it } from 'vitest'
import { iceConfiguration, STUN_SERVERS, turnEntry } from './ice-configuration.ts'

/**
 * NET-12 — the ICE configuration is this repository's, and it says so on every path.
 *
 * Two claims are under test and they are different in kind. The first is about **content**: the
 * dead entry is gone and every survivor carries a reason and a probe date. The second is about
 * **the contract** — `iceServers` is present on every path this function has — and it is the
 * one THE TRAP is about, because the failure mode it prevents is silent and lives only on the
 * branch nobody exercises.
 *
 * Everything here is pure, so this spec runs in the **node and browser lanes both** — the
 * module touches no global at import time, `consent.ts`'s rule. The third claim, that the
 * library still reinstates its own defaults, needs `readFileSync` and therefore lives in
 * `ice-configuration-library.node.test.ts`: a filesystem guard in this file would redden in the
 * browser lane for a reason that has nothing to do with what it tests.
 */

/** The name that rotted. Written out once, so a re-add anywhere below is caught by one grep. */
const DEAD_ENTRY = 'stun.services.mozilla.com'

describe('NET-12 — the STUN list is this repository’s, with a reason and a date per entry', () => {
  it('carries exactly the three survivors and not the entry that stopped resolving', () => {
    expect(STUN_SERVERS).toHaveLength(3)
    expect(STUN_SERVERS.map((entry) => entry.urls)).toEqual([
      'stun:stun.l.google.com:19302',
      'stun:global.stun.twilio.com:3478',
      'stun:stun.cloudflare.com:3478',
    ])
  })

  it('never names the entry that answers NXDOMAIN on three public resolvers', () => {
    expect(JSON.stringify(STUN_SERVERS)).not.toContain(DEAD_ENTRY)
    expect(JSON.stringify(iceConfiguration())).not.toContain(DEAD_ENTRY)
  })

  it('gives every entry a non-empty reason and an ISO probe date', () => {
    for (const entry of STUN_SERVERS) {
      expect(entry.why.length).toBeGreaterThan(20)
      expect(entry.probedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })
})

/**
 * THE TRAP, enumerated rather than sampled.
 *
 * `iceConfiguration` has four reachable shapes — {no turn, no relayOnly}, {turn}, {relayOnly},
 * {turn + relayOnly}. Every one is constructed here and asserted to carry a non-empty
 * `iceServers`. A branch added later that returns a configuration without the key would have to
 * defeat the type first; this case is what catches it if the type is ever relaxed.
 */
describe('NET-12 — iceServers is present and non-empty on EVERY path', () => {
  const rung = {
    urls: ['turn:127.0.0.1:3478?transport=udp', 'turn:127.0.0.1:53?transport=udp'],
    username: '1788403690:node',
    credential: 'Zm9vYmFyYmF6',
  }

  const everyPath = [
    ['no TURN, no policy — the default roughly forty e2e specs get', iceConfiguration()],
    ['no TURN, relay-only', iceConfiguration({ relayOnly: true })],
    ['TURN held', iceConfiguration({ turn: rung })],
    ['TURN held, relay-only', iceConfiguration({ turn: rung, relayOnly: true })],
    ['TURN explicitly absent — the credential-fetch-failed path', iceConfiguration({ turn: null })],
  ] as const

  for (const [label, config] of everyPath) {
    it(`${label}: iceServers present, non-empty, and free of the dead entry`, () => {
      expect(config.iceServers).toBeDefined()
      expect(config.iceServers.length).toBeGreaterThan(0)
      expect(JSON.stringify(config.iceServers)).not.toContain(DEAD_ENTRY)
    })
  }

  it('the default is STUN alone — three entries, no credential anywhere', () => {
    const config = iceConfiguration()
    expect(config.iceServers).toHaveLength(3)
    expect(JSON.stringify(config.iceServers)).not.toContain('credential')
    expect(config.iceTransportPolicy).toBeUndefined()
  })

  it('a held rung adds ONE entry carrying both measured ports, keeping the list at four', () => {
    const config = iceConfiguration({ turn: rung })
    expect(config.iceServers).toHaveLength(4)
    const turn = turnEntry(rung)
    expect(turn.urls).toEqual([
      'turn:127.0.0.1:3478?transport=udp',
      'turn:127.0.0.1:53?transport=udp',
    ])
    expect(turn.username).toBe('1788403690:node')
  })

  it('relay-only is opt-in and never a default', () => {
    expect(iceConfiguration({ turn: rung }).iceTransportPolicy).toBeUndefined()
    expect(iceConfiguration({ relayOnly: true }).iceTransportPolicy).toBe('relay')
  })
})
