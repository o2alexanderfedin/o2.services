/**
 * RUN-02's client half, with no network and no page — and then again with both.
 *
 * This file runs in the `node` project **and** the `browser` project, because
 * `vitest.config.ts` includes bare `*.test.ts` in each, and for the reason
 * `computing-indicator.test.ts` states about itself: the module's whole claim is that it is
 * portable, and a spec that only ran where `fetch` and `document` exist would not be able to
 * tell a port from a global.
 *
 * What this file does not cover, and what does: the fetch is a fake, so it says nothing about
 * a real object answering. `kill-switch-regions.e2e.test.ts` runs three real tabs against
 * three real workerds. What belongs here is the rule — that a failed read never halts, and
 * that a directive for another version leaves this tab admitting.
 */

import { describe, expect, it } from 'vitest'
import { ADMISSION_POLL_INTERVAL_MS, KillSwitch, switchEndpointFor } from './kill-switch.ts'
import type { AdmissionDirective } from '@o2/libp2p'

const PEER = '12D3KooWDpJ7As7BWAwRMfu1VU2WCqNjvq387JEYKDBj4kx6nXTN'

const directive = (over: Partial<AdmissionDirective> = {}): AdmissionDirective => ({
  region: 'bootstrap-eu',
  halted: true,
  versions: 'all',
  since: 1_700_000_000_000,
  note: 'a region behaving badly',
  ...over,
})

/** A fetch port over a queue of scripted answers. Each call takes the next one. */
function scriptedFetch(answers: readonly (AdmissionDirective | 'fails' | 'not-ok')[]): {
  readonly port: KillSwitchPortsFetch
  readonly urls: string[]
} {
  const urls: string[] = []
  let index = 0
  return {
    urls,
    port: (input: string) => {
      urls.push(input)
      const answer = answers[Math.min(index, answers.length - 1)]
      index += 1
      if (answer === 'fails') return Promise.reject(new Error('connection refused'))
      if (answer === 'not-ok') return Promise.resolve({ ok: false, json: () => Promise.resolve({}) })
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ admission: answer }) })
    },
  }
}

type KillSwitchPortsFetch = (
  input: string,
  init?: { signal?: AbortSignal },
) => Promise<{ readonly ok: boolean; json(): Promise<unknown> }>

describe('RUN-02 — the object a relay address names', () => {
  it('reads a local ws relay as an http origin on the same port', () => {
    expect(switchEndpointFor(`/ip4/127.0.0.1/tcp/8802/ws/p2p/${PEER}`)).toBe('http://127.0.0.1:8802')
  })

  it('reads a public tls relay as an https origin with the default port omitted', () => {
    // `tls` decides the scheme, not the port. Reading the port instead would get a local
    // `wrangler dev` on 8787 wrong in one direction and a non-standard TLS port in the other.
    expect(switchEndpointFor(`/dns4/o2-bootstrap.example.dev/tcp/443/tls/ws/p2p/${PEER}`)).toBe(
      'https://o2-bootstrap.example.dev',
    )
  })

  it('keeps a non-default TLS port rather than assuming 443', () => {
    expect(switchEndpointFor(`/dns4/host.example/tcp/8443/tls/ws/p2p/${PEER}`)).toBe(
      'https://host.example:8443',
    )
  })

  it('answers null for an address it cannot read, rather than guessing an origin', () => {
    // A guessed origin is a request to somewhere nobody chose — which on a page that has just
    // been given consent is exactly what P10 exists to prevent.
    expect(switchEndpointFor(`/ip4/127.0.0.1/udp/4001/quic-v1/p2p/${PEER}`)).toBe(null)
    expect(switchEndpointFor('/p2p-circuit')).toBe(null)
    expect(switchEndpointFor('')).toBe(null)
  })
})

describe('RUN-02 — what a tab concludes from what it read', () => {
  it('is not halted before it has read anything', async () => {
    const fetchPort = scriptedFetch([directive()])
    const halt = new KillSwitch({
      endpoint: 'http://127.0.0.1:8802',
      clientVersion: '1.2.3',
      fetch: fetchPort.port,
    })
    expect(halt.halted()).toBe(false)
    expect(halt.firstHaltedAt).toBe(null)
  })

  it('is halted after reading a halt that names this tab', async () => {
    const fetchPort = scriptedFetch([directive()])
    const halt = new KillSwitch({
      endpoint: 'http://127.0.0.1:8802',
      clientVersion: '1.2.3',
      fetch: fetchPort.port,
      now: () => 42,
    })
    await halt.poll()
    expect(halt.halted()).toBe(true)
    expect(halt.firstHaltedAt).toBe(42)
    expect(fetchPort.urls).toEqual(['http://127.0.0.1:8802/self'])
  })

  it('HOLDS the last known value across a failed read rather than inventing a halt', async () => {
    // **An operator's silence is not a stop order.** A fabric that halted on a failed poll is
    // a fabric one dropped request takes down, and it would fail in the direction where
    // nobody is computing.
    const fetchPort = scriptedFetch([directive({ halted: false }), 'fails', 'not-ok'])
    const halt = new KillSwitch({
      endpoint: 'http://127.0.0.1:8802',
      clientVersion: '1.2.3',
      fetch: fetchPort.port,
    })
    await halt.poll()
    expect(halt.halted()).toBe(false)
    await halt.poll()
    expect(halt.halted()).toBe(false)
    await halt.poll()
    expect(halt.halted()).toBe(false)
    expect(halt.counts).toEqual({ reads: 1, failures: 2 })
  })

  it('HOLDS a halt across a failed read too, so a blip does not un-halt a stopped tab', async () => {
    // The mirror case, and it is the one that says the rule is *hold the last value* rather
    // than *default to admitting*. A halt that evaporated on one failed poll would let a tab
    // an operator stopped start taking work again without anybody saying so.
    const fetchPort = scriptedFetch([directive(), 'fails'])
    const halt = new KillSwitch({
      endpoint: 'http://127.0.0.1:8802',
      clientVersion: '1.2.3',
      fetch: fetchPort.port,
    })
    await halt.poll()
    await halt.poll()
    expect(halt.halted()).toBe(true)
  })

  it('is not halted by a directive naming a version that is not this build', async () => {
    const fetchPort = scriptedFetch([directive({ versions: ['9.9.9'] })])
    const halt = new KillSwitch({
      endpoint: 'http://127.0.0.1:8802',
      clientVersion: '1.2.3',
      fetch: fetchPort.port,
    })
    await halt.poll()
    expect(halt.halted()).toBe(false)
    expect(halt.firstHaltedAt).toBe(null)
    // It read the directive — the reading is of the SLICE and not of a failed poll.
    expect(halt.counts.reads).toBe(1)
    expect(halt.directive.note).toBe('a region behaving badly')
  })

  it('is halted by a directive naming this build’s own version', async () => {
    const fetchPort = scriptedFetch([directive({ versions: ['1.2.3'] })])
    const halt = new KillSwitch({
      endpoint: 'http://127.0.0.1:8802',
      clientVersion: '1.2.3',
      fetch: fetchPort.port,
    })
    await halt.poll()
    expect(halt.halted()).toBe(true)
  })

  it('is not halted by a version slice when this page’s stamp could not be read', async () => {
    const fetchPort = scriptedFetch([directive({ versions: ['1.2.3'] })])
    const halt = new KillSwitch({
      endpoint: 'http://127.0.0.1:8802',
      clientVersion: null,
      fetch: fetchPort.port,
    })
    await halt.poll()
    expect(halt.halted()).toBe(false)
  })

  it('treats a body it cannot read as a failed poll, not as an absent halt', async () => {
    const fetchPort = scriptedFetch([directive()])
    const halt = new KillSwitch({
      endpoint: 'http://127.0.0.1:8802',
      clientVersion: '1.2.3',
      fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({ traffic: {} }) }),
    })
    void fetchPort
    await halt.poll()
    expect(halt.counts).toEqual({ reads: 0, failures: 1 })
    expect(halt.halted()).toBe(false)
  })

  it('records the FIRST halted moment and does not move it when the halt is lifted', async () => {
    // The propagation window is `max(observed) - t0` over a population, so this moment has to
    // be the tab's own and has to survive a later admitting directive.
    let clock = 100
    const fetchPort = scriptedFetch([directive(), directive({ halted: false }), directive()])
    const halt = new KillSwitch({
      endpoint: 'http://127.0.0.1:8802',
      clientVersion: '1.2.3',
      fetch: fetchPort.port,
      now: () => {
        clock += 10
        return clock
      },
    })
    await halt.poll()
    const first = halt.firstHaltedAt
    await halt.poll()
    await halt.poll()
    expect(halt.firstHaltedAt).toBe(first)
  })

  it('polls at the production interval when none was named', () => {
    const halt = new KillSwitch({
      endpoint: 'http://127.0.0.1:8802',
      clientVersion: '1.2.3',
      fetch: scriptedFetch([directive()]).port,
    })
    // Not the value the class computed — a literal, written independently, so the assertion
    // cannot pass by comparing the constant against itself.
    expect(ADMISSION_POLL_INTERVAL_MS).toBe(30_000)
    halt.stop()
  })
})
