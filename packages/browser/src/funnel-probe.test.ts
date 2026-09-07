import { describe, expect, it } from 'vitest'
import {
  FUNNEL_PROBE_TIMEOUT_MS,
  FunnelReporter,
  beaconSendPort,
  funnelEndpointFrom,
  probeFunnelTarget,
} from './funnel-reporter.ts'
import type { FunnelProbePort, FunnelSendPort } from './funnel-reporter.ts'

/**
 * The proof that a derived collector answers before a send port is installed — RUN-07.
 *
 * ## The defect this closes, in one sentence
 *
 * `funnelEndpointFromRelay` derives a collector origin from the relay a tab bootstrapped
 * through. That is right for the deployed Worker, which serves the collector on the same host
 * as the relay, and **wrong for any self-hosted seed**, which serves libp2p WebSocket on that
 * port and answers `400` to a plain request. It fails immediately, so nothing hangs and nothing
 * is logged — the funnel *looks configured and collects nothing*, which is the failure that
 * presents as a pass.
 *
 * ## A plain `.test.ts`, in both lanes, for `funnel-reporter.test.ts`'s stated reason
 *
 * The probe is a pure function over one narrow port, so its behaviour is the same in a browser
 * and in Node, and `vitest.config.ts` gives `packages/*​/src/**​/*.test.ts` to both projects.
 * Nothing here opens a socket: every case supplies its own {@link FunnelProbePort}, which is
 * why a case for "the collector answered 400" costs no server.
 *
 * ## Validation is on the BODY, never on the status
 *
 * A `200` from something that is not a collector — a static host, a captive portal, a router
 * admin page — is exactly the shape that would install a port to nowhere while looking
 * configured. So the cases below include one that answers `200` with an ordinary JSON object
 * and require it to be refused.
 */

/** A probe port a case supplies, recording what it was asked and what it was handed. */
class ProbeStub implements FunnelProbePort {
  readonly asked: string[] = []
  readonly signals: AbortSignal[] = []

  readonly #answer: (endpoint: string) => Promise<Response>

  constructor(answer: (endpoint: string) => Promise<Response>) {
    this.#answer = answer
  }

  async probe(endpoint: string, signal: AbortSignal): Promise<Response> {
    this.asked.push(endpoint)
    this.signals.push(signal)
    return this.#answer(endpoint)
  }
}

/** The deployed collector's own answer, read live 2026-09-04 and used here as the good shape. */
const COLLECTOR_BODY = JSON.stringify({
  entered: { 'page-load': 0 },
  stalledAt: {},
  byStageHour: {},
  webrtcAttempts: {},
  webrtcOutcomes: {},
  population: 'opted-in-only',
  schemaDigest: '3911527f1a04abee',
})

/** The endpoint under test. A derived one, assembled the way the reporter assembles it. */
const ENDPOINT = `${new URL('http://127.0.0.1:8796').origin}/funnel`

const answering = (body: string, status = 200): ProbeStub =>
  new ProbeStub(async () => new Response(body, { status, headers: { 'content-type': 'application/json' } }))

describe('a derived collector that does not answer as one installs no send port', () => {
  it('answers null when the request never arrives at all', async () => {
    // The self-hosted seed reached over a scheme it does not speak: the browser rejects and the
    // page must treat that as "there is no collector here", not as an error to surface.
    const port = new ProbeStub(async () => {
      throw new Error('Failed to fetch')
    })
    expect(await probeFunnelTarget(ENDPOINT, port)).toBeNull()
    expect(port.asked).toEqual([ENDPOINT])
  })

  it('answers null on 400 — the self-hosted seed serving libp2p on that port', async () => {
    // THE DEFECT'S OWN CASE. A seed answers 400 to a plain GET on its websocket port, and
    // before this function that answer was never asked for.
    const port = answering('bad request', 400)
    expect(await probeFunnelTarget(ENDPOINT, port)).toBeNull()
  })

  it('answers null on a 200 whose body is not JSON', async () => {
    const port = new ProbeStub(async () => new Response('<!doctype html><title>hello</title>', { status: 200 }))
    expect(await probeFunnelTarget(ENDPOINT, port)).toBeNull()
  })

  it('answers null on a 200 that is JSON and is not a collector', async () => {
    // The dangerous shape: a host that answers, so status alone would install a port to
    // nowhere. Two forms — the field absent, and the field present as something other than a
    // string — because a collector is identified by carrying a digest, not by carrying a key.
    expect(await probeFunnelTarget(ENDPOINT, answering(JSON.stringify({ ok: true })))).toBeNull()
    expect(await probeFunnelTarget(ENDPOINT, answering(JSON.stringify({ schemaDigest: 17 })))).toBeNull()
    expect(await probeFunnelTarget(ENDPOINT, answering(JSON.stringify([1, 2, 3])))).toBeNull()
    expect(await probeFunnelTarget(ENDPOINT, answering('null'))).toBeNull()
  })

  it('never throws, whatever the port does', async () => {
    // A funnel that threw into a visitor's console would be an instrument making itself visible
    // to the thing it measures — `beaconSendPort` says the same in its own comment. Both throw
    // shapes are covered: the synchronous one, and a response whose body read fails.
    const sync: FunnelProbePort = {
      probe(): Promise<Response> {
        throw new Error('the port threw before it returned a promise')
      },
    }
    expect(await probeFunnelTarget(ENDPOINT, sync)).toBeNull()
    const broken: FunnelProbePort = {
      probe: async (): Promise<Response> => ({
        ok: true,
        status: 200,
        async json(): Promise<unknown> {
          throw new Error('the body read failed')
        },
      }) as unknown as Response,
    }
    expect(await probeFunnelTarget(ENDPOINT, broken)).toBeNull()
  })

  it('answers null when nothing answers within the stated timeout, and aborts the request', async () => {
    // The timeout is a PARAMETER with an exported default, not a literal buried in the body.
    // The comparative reading is what this case takes: 20 ms wins against the default, which is
    // three orders of magnitude larger, so a probe that ignored the parameter would sit here.
    expect(FUNNEL_PROBE_TIMEOUT_MS).toBeGreaterThan(1_000)
    const port = new ProbeStub(async () => new Promise<Response>(() => {}))
    const started = performance.now()
    expect(await probeFunnelTarget(ENDPOINT, port, 20)).toBeNull()
    const elapsed = performance.now() - started
    expect(
      elapsed,
      `the probe took ${String(Math.round(elapsed))} ms against a 20 ms parameter, so the ` +
        'timeout it used is not the one it was given',
    ).toBeLessThan(FUNNEL_PROBE_TIMEOUT_MS)
    // And the request was actually withdrawn rather than merely raced past: a probe that left
    // its request outstanding would hold a connection open for every visit that hit a seed.
    expect(port.signals[0]?.aborted, 'the timed-out probe never aborted its own request').toBe(true)
  })
})

describe('a derived collector that answers as one installs the port it was probed for', () => {
  it('answers the endpoint back for the deployed collector’s own body shape', async () => {
    const port = answering(COLLECTOR_BODY)
    expect(await probeFunnelTarget(ENDPOINT, port)).toBe(ENDPOINT)
    expect(port.asked).toEqual([ENDPOINT])
  })

  it('accepts a collector whose schema has MOVED, because that comparison is not this seam’s', () => {
    // Stated as a case rather than only in prose. The digest's job here is to prove *this is a
    // collector*; comparing it against the client's own would make a page refuse a collector
    // that had been redeployed, and `37-RUNBOOK.md` step 5 already owns that comparison as an
    // operator reading between two requests.
    const moved = JSON.stringify({ population: 'opted-in-only', schemaDigest: 'ffffffffffffffff' })
    return expect(probeFunnelTarget(ENDPOINT, answering(moved))).resolves.toBe(ENDPOINT)
  })
})

describe('the composition the demo page performs, both ways round', () => {
  /** A send port that records, so "sent nothing" is read off it rather than inferred. */
  class Recorder implements FunnelSendPort {
    readonly bodies: string[] = []
    send(body: string): boolean {
      this.bodies.push(body)
      return true
    }
  }

  it('leaves the reporter inactive, and holding, when the derived origin answers 400', async () => {
    const reporter = new FunnelReporter({ clock: { hourBucket: (): number => 14 } })
    reporter.enter('page-load')
    reporter.arm()
    reporter.enter('consent')

    const confirmed = await probeFunnelTarget(ENDPOINT, answering('bad request', 400))
    const recorder = new Recorder()
    if (confirmed !== null) reporter.target(recorder)

    expect(
      reporter.active,
      'RUN-07: a page whose derived collector refused still reports itself active, so an ' +
        'operator reading the funnel cannot tell "nobody came" from "nothing was collected"',
    ).toBe(false)
    expect(recorder.bodies).toEqual([])
  })

  it('activates the reporter and flushes the held stages when it answers as a collector', async () => {
    // THE POSITIVE CONTROL for the case above. Without it that emptiness is a property of a
    // reporter nobody armed rather than of the refusal.
    const reporter = new FunnelReporter({ clock: { hourBucket: (): number => 14 } })
    reporter.enter('page-load')
    reporter.arm()
    reporter.enter('consent')

    const confirmed = await probeFunnelTarget(ENDPOINT, answering(COLLECTOR_BODY))
    const recorder = new Recorder()
    if (confirmed !== null) reporter.target(recorder)

    expect(reporter.active).toBe(true)
    const stages = recorder.bodies.map((body) => (JSON.parse(body) as { stage: string }).stage)
    expect(
      stages,
      'the held reports did not arrive in composition order, so a probe that resolves late is ' +
        'losing the two stages a funnel most needs',
    ).toEqual(['page-load', 'consent'])
  })

  it('does not probe an explicitly configured endpoint, because that one still wins', () => {
    // Truth four, at the seam that decides it: `funnelEndpointFrom` answers the configured
    // origin and never looks at the relay list, so the demo's configured branch never reaches
    // the probe. `funnel.target` is first-install-wins, which enforces it a second time.
    const relays = ['/ip4/127.0.0.1/tcp/8796/ws/p2p/12D3KooWHPSVMPEezVCXvka2ahwT26JGL8EBr61LpGEU3ujHQM9Q']
    const configured = new URL('http://127.0.0.1:8798').origin
    expect(funnelEndpointFrom(`?funnel=${encodeURIComponent(configured)}`, relays)).toBe(`${configured}/funnel`)
    // And with no parameter the relay is what is derived — the branch that IS probed.
    expect(funnelEndpointFrom('', relays)).toBe(ENDPOINT)
    // The send port for a configured endpoint is built without any probe at all.
    expect(typeof beaconSendPort(`${configured}/funnel`, {}).send).toBe('function')
  })
})
