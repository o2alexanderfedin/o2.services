import { describe, expect, it } from 'vitest'
import {
  FUNNEL_ARMING,
  FUNNEL_PENDING_POPULATION,
  FunnelReporter,
  beaconSendPort,
  funnelEndpointFrom,
  funnelEndpointFromRelay,
  readNetworkClass,
  utcHourPort,
} from './funnel-reporter.ts'
import type { FunnelSendPort } from './funnel-reporter.ts'

/**
 * The reporter's behaviour, in **both** lanes.
 *
 * A plain `.test.ts`, because the reporter is a pure class over two ports and the property that
 * matters — that it is inert without configuration, sends once per stage, and holds until it is
 * armed — is the same in a browser and in Node. The source scan that keeps a remote origin out
 * of this module is in `funnel-reporter.node.test.ts` instead, and the split is measured rather
 * than stylistic: `vitest.config.ts` gives `packages/*​/src/**​/*.test.ts` to the `node` project
 * AND to the `browser` project, so a `readFileSync` in this file would fail in a lane that has
 * no filesystem.
 */

/** A send port that records what it was handed, and can be made to refuse. */
class Recorder implements FunnelSendPort {
  readonly bodies: string[] = []
  accepts = true

  send(body: string): boolean {
    this.bodies.push(body)
    return this.accepts
  }

  get reports(): Record<string, unknown>[] {
    return this.bodies.map((body) => JSON.parse(body) as Record<string, unknown>)
  }
}

const CLOCK = { hourBucket: (): number => 14 }

function armed(send: Recorder): FunnelReporter {
  const reporter = new FunnelReporter({ send, clock: CLOCK, networkClass: 'wifi' })
  reporter.arm()
  return reporter
}

describe('a reporter with no endpoint is inert, which is the production default', () => {
  it('sends nothing and answers false to everything', () => {
    const reporter = new FunnelReporter()
    expect(reporter.active).toBe(false)
    expect(reporter.enter('page-load')).toBe(false)
    expect(reporter.enter('consent')).toBe(false)
    expect(reporter.arm()).toBe(false)
    expect(reporter.stalled()).toBe(false)
  })

  it('is what a page with no funnel parameter gets', () => {
    // The scope fence, read at the one function that decides it. A page opened normally
    // configures nothing, so nothing is sent anywhere by anybody.
    expect(funnelEndpointFrom('')).toBeNull()
    expect(funnelEndpointFrom('?relay=/ip4/127.0.0.1/tcp/1/ws/p2p/x')).toBeNull()
    expect(funnelEndpointFrom('?funnel=')).toBeNull()
    // And a relative value is refused rather than resolved against whatever origin the page
    // happens to be on — which for a published page is a request to that page's own host.
    expect(funnelEndpointFrom('?funnel=/funnel')).toBeNull()
    expect(funnelEndpointFrom('?funnel=not a url')).toBeNull()
  })

  it('takes an origin and names the route itself', () => {
    // The route below the origin is this project's to name, not a caller's.
    expect(funnelEndpointFrom('?funnel=http://127.0.0.1:8798')).toBe('http://127.0.0.1:8798/funnel')
    expect(funnelEndpointFrom('?funnel=http://localhost:5173/anything?x=1')).toBe(
      'http://localhost:5173/funnel',
    )
  })
})

describe('a stage is reported at most once per visit', () => {
  it('sends one report the first time and nothing after', () => {
    const send = new Recorder()
    const reporter = armed(send)

    expect(reporter.enter('page-load')).toBe(true)
    expect(reporter.enter('page-load')).toBe(false)
    expect(reporter.enter('page-load')).toBe(false)

    // One, as the literal. A stage that double-counts makes every ratio in the funnel wrong in
    // a way no reader of the numbers can see.
    expect(send.bodies.length).toBe(1)
  })

  it('carries the stage, the kind, the hour, the population and the class', () => {
    const send = new Recorder()
    armed(send).enter('ice-gathering')

    expect(send.reports[0]).toEqual({
      stage: 'ice-gathering',
      kind: 'entered',
      hourBucket: 14,
      population: FUNNEL_PENDING_POPULATION,
      networkClass: 'wifi',
    })
  })

  it('carries a connection class only where one is given', () => {
    const send = new Recorder()
    const reporter = armed(send)
    reporter.enter('connection-classified', 'control-only')
    expect(send.reports[0]?.['connectionClass']).toBe('control-only')

    reporter.enter('first-task')
    expect(send.reports[1]).not.toHaveProperty('connectionClass')
  })
})

describe('the terminal report says where the visit stopped', () => {
  it('names the furthest stage reached', () => {
    const send = new Recorder()
    const reporter = armed(send)
    reporter.enter('page-load')
    reporter.enter('consent')
    reporter.enter('wss-bootstrap')

    expect(reporter.stalled()).toBe(true)
    expect(send.reports[3]).toMatchObject({ stage: 'wss-bootstrap', kind: 'stalled' })
  })

  it('names the furthest, not the latest, when stages arrive out of order', () => {
    const send = new Recorder()
    const reporter = armed(send)
    reporter.enter('wss-bootstrap')
    // A late page-load report — the shape a flushed hold produces — must not pull the furthest
    // stage backwards, or the visit is filed as stalling where it started.
    reporter.enter('page-load')

    reporter.stalled()
    expect(send.reports[2]).toMatchObject({ stage: 'wss-bootstrap', kind: 'stalled' })
  })

  it('sends nothing for a visit that reached the last stage', () => {
    const send = new Recorder()
    const reporter = armed(send)
    reporter.enter('page-load')
    reporter.enter('first-task')

    // A visit that finished did not stall. Reporting one would put a drop against the stage a
    // visitor actually completed, which is the two-counters defect criterion 2 forbids.
    expect(reporter.stalled()).toBe(false)
    expect(send.bodies.length).toBe(2)
  })

  it('sends nothing for a visit that reached no stage at all', () => {
    const send = new Recorder()
    expect(armed(send).stalled()).toBe(false)
    expect(send.bodies.length).toBe(0)
  })

  it('sends at most once, because pagehide can fire more than once', () => {
    const send = new Recorder()
    const reporter = armed(send)
    reporter.enter('consent')

    expect(reporter.stalled()).toBe(true)
    expect(reporter.stalled()).toBe(false)
    expect(reporter.stalled()).toBe(false)
    expect(send.bodies.length).toBe(2)
  })
})

describe('the arming point is the intersection of both readings of open question 3', () => {
  it('is at-consent while the ruling is pending', () => {
    // The literal, because the value IS the claim. Reading it off the module would agree with
    // whatever it had been changed to.
    expect(FUNNEL_ARMING).toBe('at-consent')
    expect(FUNNEL_PENDING_POPULATION).toBe('opted-in-only')
  })

  it('holds a report composed before arming and sends nothing until armed', () => {
    const send = new Recorder()
    const reporter = new FunnelReporter({ send, clock: CLOCK })

    expect(reporter.enter('page-load')).toBe(false)
    expect(send.bodies.length, 'a report left before the visitor consented').toBe(0)

    expect(reporter.arm()).toBe(true)
    expect(send.bodies.length).toBe(1)
    expect(send.reports[0]).toMatchObject({ stage: 'page-load', kind: 'entered' })
  })

  it('keeps the hour a held report HAPPENED, not the hour it was flushed', () => {
    const send = new Recorder()
    let hour = 23
    const reporter = new FunnelReporter({ send, clock: { hourBucket: (): number => hour } })
    reporter.enter('page-load')

    // The visitor opened the page at 23:58 and consented at 00:01. Filing stage one under hour
    // 0 would put a smear into the one question the hour bucket exists to answer.
    hour = 0
    reporter.arm()
    expect(send.reports[0]?.['hourBucket']).toBe(23)
  })

  it('arms once; a second arm flushes nothing', () => {
    const send = new Recorder()
    const reporter = new FunnelReporter({ send, clock: CLOCK })
    reporter.enter('page-load')
    reporter.arm()
    expect(reporter.arm()).toBe(false)
    expect(send.bodies.length).toBe(1)
  })
})

describe('the ports read the platform coarsely and answer honestly when it says nothing', () => {
  it('maps a medium the schema has, and refuses everything else into unknown', () => {
    expect(readNetworkClass({ navigator: { connection: { type: 'cellular' } } })).toBe('cellular')
    expect(readNetworkClass({ navigator: { connection: { type: 'wifi' } } })).toBe('wifi')
    // A speed is not a medium. The cellular generations map; `4g` does not, because a laptop on
    // fast wifi reports `4g` and filing it as cellular would put a reading in the wrong bucket.
    expect(readNetworkClass({ navigator: { connection: { effectiveType: '3g' } } })).toBe('cellular')
    expect(readNetworkClass({ navigator: { connection: { effectiveType: '4g' } } })).toBe('unknown')
    // Safari and Firefox implement neither, which is why `unknown` is a member of the list.
    expect(readNetworkClass({ navigator: {} })).toBe('unknown')
    expect(readNetworkClass({})).toBe('unknown')
  })

  it('sends through the beacon when there is one, and does not read its answer', () => {
    const sent: { url: string; type: string }[] = []
    const port = beaconSendPort('http://127.0.0.1:1/funnel', {
      navigator: {
        sendBeacon: (url: string, data?: BodyInit): boolean => {
          sent.push({ url, type: (data as Blob).type })
          return true
        },
      },
    })
    expect(port.send('{}')).toBe(true)
    expect(sent[0]?.url).toBe('http://127.0.0.1:1/funnel')
    // `text/plain` is CORS-safelisted, so the request needs no preflight — and a preflight
    // cannot be sent from a page that is already unloading, which is when this send happens.
    expect(sent[0]?.type).toContain('text/plain')
  })

  it('falls back to a keepalive fetch when the beacon refuses', () => {
    const calls: RequestInit[] = []
    const port = beaconSendPort('http://127.0.0.1:1/funnel', {
      navigator: { sendBeacon: (): boolean => false },
      fetch: ((_url: string, init: RequestInit): Promise<Response> => {
        calls.push(init)
        return Promise.resolve(new Response(null, { status: 204 }))
      }) as unknown as typeof fetch,
    })
    expect(port.send('{}')).toBe(true)
    expect(calls[0]?.keepalive, 'the fallback would not outlive the document').toBe(true)
  })

  it('answers false when the platform offers neither', () => {
    expect(beaconSendPort('http://127.0.0.1:1/funnel', {}).send('{}')).toBe(false)
  })

  it('answers an hour and nothing finer', () => {
    const hour = utcHourPort().hourBucket()
    expect(Number.isInteger(hour)).toBe(true)
    expect(hour).toBeGreaterThanOrEqual(0)
    expect(hour).toBeLessThan(24)
  })
})

/**
 * The relay-derived endpoint — RUN-04's repair, and the fence it now rests on.
 *
 * Every host below is invented (`relay.example`, loopback). The deployed host is named nowhere
 * in this file, deliberately: `funnel-reporter.node.test.ts` scans the module for it, and
 * handing a future widening of that scan a hit from a spec would be a self-inflicted red.
 *
 * Every expected endpoint is written as a literal rather than re-derived from the input, on
 * this repository's rule that an assertion must not reuse the value it tests.
 */
describe('the collector is derived from the relay a visit actually started with', () => {
  it('derives https from a TLS websocket relay, dropping the default port', () => {
    expect(funnelEndpointFromRelay('/dns4/relay.example/tcp/443/tls/ws/p2p/12D3KooWABC')).toBe(
      'https://relay.example/funnel',
    )
    // The legacy `/wss` shorthand means the same thing and must derive the same thing.
    expect(funnelEndpointFromRelay('/dns4/relay.example/tcp/443/wss')).toBe(
      'https://relay.example/funnel',
    )
  })

  it('derives from dns6 and dnsaddr the same way', () => {
    expect(funnelEndpointFromRelay('/dns6/relay.example/tcp/443/tls/ws')).toBe(
      'https://relay.example/funnel',
    )
    expect(funnelEndpointFromRelay('/dnsaddr/relay.example/tcp/443/tls/ws/p2p/12D3KooWABC')).toBe(
      'https://relay.example/funnel',
    )
  })

  it('keeps a TLS port that is not the default', () => {
    expect(funnelEndpointFromRelay('/dns4/relay.example/tcp/8443/tls/ws/p2p/12D3KooWABC')).toBe(
      'https://relay.example:8443/funnel',
    )
  })

  it('derives the insecure scheme ONLY from an insecure relay, which is what a test has', () => {
    // THE FENCE, AS A CASE RATHER THAN A COMMENT. A test arrangement bootstraps off a loopback
    // relay, so the target it derives is loopback — a run in this repository cannot reach a
    // paid origin because there is no relay in it that names one.
    expect(funnelEndpointFromRelay('/ip4/127.0.0.1/tcp/8796/ws/p2p/12D3KooWABC')).toBe(
      'http://127.0.0.1:8796/funnel',
    )
  })

  it('answers null rather than guessing', () => {
    // Unparseable: not a multiaddr at all.
    expect(funnelEndpointFromRelay('not a multiaddr')).toBeNull()
    expect(funnelEndpointFromRelay('')).toBeNull()
    // A circuit address names a peer BEHIND the relay, so its host serves nothing for this.
    expect(
      funnelEndpointFromRelay('/dns4/relay.example/tcp/443/tls/ws/p2p/12D3KooWABC/p2p-circuit'),
    ).toBeNull()
    expect(
      funnelEndpointFromRelay(
        '/dns4/relay.example/tcp/443/tls/ws/p2p/12D3KooWABC/p2p-circuit/webrtc/p2p/12D3KooWXYZ',
      ),
    ).toBeNull()
    // No websocket component: a TCP peer address, and a UDP one. Neither says HTTP is served.
    expect(funnelEndpointFromRelay('/ip4/1.2.3.4/tcp/4001')).toBeNull()
    expect(funnelEndpointFromRelay('/ip4/1.2.3.4/udp/4001/webrtc-direct')).toBeNull()
    // A websocket with no port to serve on.
    expect(funnelEndpointFromRelay('/dns4/relay.example/ws')).toBeNull()
  })

  it('ANTI-VACUITY: a resolver that answered null everywhere would fail here', () => {
    // The null cases above are all satisfied by a function that returns null unconditionally.
    // This is the case that refuses one, held separately so the reason it exists is legible.
    const derived = [
      funnelEndpointFromRelay('/dns4/relay.example/tcp/443/tls/ws/p2p/12D3KooWABC'),
      funnelEndpointFromRelay('/ip4/127.0.0.1/tcp/8796/ws'),
    ]
    expect(derived.filter((d) => d !== null).length, 'the derivation produced nothing').toBe(2)
  })
})

describe('precedence: a configured endpoint wins, then the relay, then nothing', () => {
  const RELAY = '/dns4/relay.example/tcp/443/tls/ws/p2p/12D3KooWABC'

  it('an explicit ?funnel= beats a supplied relay', () => {
    expect(funnelEndpointFrom('?funnel=http://127.0.0.1:8798', [RELAY])).toBe(
      'http://127.0.0.1:8798/funnel',
    )
  })

  it('the relay is used when the page named nothing', () => {
    expect(funnelEndpointFrom('', [RELAY])).toBe('https://relay.example/funnel')
    expect(funnelEndpointFrom('?relay=%2Fdns4%2Fx', [RELAY])).toBe('https://relay.example/funnel')
  })

  it('takes the first relay that yields an origin, and skips the ones that do not', () => {
    expect(funnelEndpointFrom('', ['/ip4/1.2.3.4/tcp/4001', RELAY])).toBe(
      'https://relay.example/funnel',
    )
  })

  it('both absent is null, and the reporter that gets it is inert', () => {
    expect(funnelEndpointFrom('')).toBeNull()
    expect(funnelEndpointFrom('', [])).toBeNull()
    expect(funnelEndpointFrom('', ['/ip4/1.2.3.4/tcp/4001'])).toBeNull()
    expect(new FunnelReporter({ clock: CLOCK }).active).toBe(false)
  })

  it('a configured value that will not parse is refused, not fallen through', () => {
    // Somebody named a destination and got it wrong. Sending somewhere else instead would hide
    // the mistake behind a funnel that looked like it was working.
    expect(funnelEndpointFrom('?funnel=not a url', [RELAY])).toBeNull()
    expect(funnelEndpointFrom('?funnel=/funnel', [RELAY])).toBeNull()
  })
})

describe('the send port can be installed late, because a page learns its relay late', () => {
  it('flushes stages held across arming, in order, with the hours they happened', () => {
    // The production order: page-load composed at module evaluation, consent arms, and only
    // then does the tab learn the relay it bootstrapped through.
    const send = new Recorder()
    let hour = 23
    const reporter = new FunnelReporter({ clock: { hourBucket: (): number => hour } })

    expect(reporter.enter('page-load')).toBe(false)
    hour = 0
    expect(reporter.arm(), 'armed with no port, so nothing could have left').toBe(false)
    expect(reporter.enter('consent')).toBe(false)
    expect(send.bodies.length, 'a report left before the collector was known').toBe(0)

    expect(reporter.target(send)).toBe(true)
    expect(send.bodies.length).toBe(2)
    expect(send.reports[0]).toMatchObject({ stage: 'page-load', hourBucket: 23 })
    expect(send.reports[1]).toMatchObject({ stage: 'consent', hourBucket: 0 })
  })

  it('sends immediately once targeted, without holding anything further', () => {
    const send = new Recorder()
    const reporter = new FunnelReporter({ clock: CLOCK })
    reporter.arm()
    reporter.target(send)
    expect(reporter.enter('wss-bootstrap')).toBe(true)
    expect(send.bodies.length).toBe(1)
  })

  it('SENDS NOTHING FOR A VISIT THAT HAS NOT CONSENTED, however it is targeted', () => {
    // The one property this change must not move. Targeting is about WHERE an already-consented
    // report goes; it is not a second arming point and must never release the hold on its own.
    const send = new Recorder()
    const reporter = new FunnelReporter({ clock: CLOCK })
    reporter.enter('page-load')
    reporter.enter('consent')
    reporter.stalled()

    expect(reporter.target(send), 'targeting released the hold of a visit that never armed').toBe(
      false,
    )
    expect(send.bodies.length, 'a visitor who did not consent was counted').toBe(0)

    // And the hold is intact rather than discarded: arming afterwards still delivers them.
    expect(reporter.arm()).toBe(true)
    expect(send.bodies.length).toBe(3)
  })

  it('first install wins, so a page that named ?funnel= keeps what it named', () => {
    const first = new Recorder()
    const second = new Recorder()
    const reporter = new FunnelReporter({ send: first, clock: CLOCK })
    reporter.arm()

    expect(reporter.target(second)).toBe(false)
    reporter.enter('page-load')
    expect(first.bodies.length).toBe(1)
    expect(second.bodies.length, 'a later target redirected an already-configured reporter').toBe(0)
  })

  it('is inert until targeted, and says so', () => {
    const reporter = new FunnelReporter({ clock: CLOCK })
    expect(reporter.active).toBe(false)
    reporter.target(new Recorder())
    expect(reporter.active).toBe(true)
  })
})
