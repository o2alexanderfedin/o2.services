import { describe, expect, it } from 'vitest'
import {
  FUNNEL_ARMING,
  FUNNEL_PENDING_POPULATION,
  FunnelReporter,
  beaconSendPort,
  funnelEndpointFrom,
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
