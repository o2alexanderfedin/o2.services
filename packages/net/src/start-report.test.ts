import {
  MemoryBlockstore,
  MemoryNetwork,
  StartOutcomeLedger,
  WasmExecutor,
  describeStartReport,
} from '@o2/core'
import type { StartOutcome } from '@o2/core'
import { describe, expect, it } from 'vitest'
import { encodeRequest, encodeResponse, parseRequest, parseResponse } from './protocol.ts'
import { RpcEndpoint } from './rpc.ts'
import { serveAgent } from './agent.ts'
import { publishStartOutcome } from './start-report.ts'

/**
 * BROW-02 over a real endpoint.
 *
 * The interesting cases are the unreachable ones, which is why this file exists at
 * all rather than testing the aggregation in isolation: what a start report has to
 * get right is the shape of the world where nothing answers.
 */

const SAFARI_BLOCKED: StartOutcome = {
  browser: 'safari 18',
  result: { kind: 'failed', cause: 'wasm-unavailable' },
}
const CHROMIUM_OK: StartOutcome = { browser: 'chromium 141', result: { kind: 'started' } }

function node(
  network: MemoryNetwork,
  id: string,
  ledger: StartOutcomeLedger | 'keeps-no-ledger' = 'keeps-no-ledger',
): RpcEndpoint {
  const rpc = new RpcEndpoint(network.connect(id), { timeoutMs: 500 })
  const blockstore = new MemoryBlockstore()
  serveAgent({
    rpc,
    executor: new WasmExecutor({ nodeId: id, blockstore }),
    blockstore,
    authorize: 'serves-unauthenticated',
    index: 'serves-no-records',
    capacity: 'accepts-every-offer',
    ledger,
    reservations: 'relays-for-nobody',
    onDispatch: 'reports-no-dispatch',
  })
  return rpc
}

describe('the report kind survives the wire', () => {
  it('round-trips a failure outcome', () => {
    const request = { kind: 'report' as const, outcome: SAFARI_BLOCKED, declined: 2 }
    const parsed = parseRequest(encodeRequest(request))
    expect(parsed).toEqual(request)
  })

  it('round-trips a query that tells nothing', () => {
    // A visitor who declined to be counted may still look. Declining to report is
    // not declining to see.
    const parsed = parseRequest(encodeRequest({ kind: 'report', outcome: null, declined: 0 }))
    expect(parsed).toEqual({ kind: 'report', outcome: null, declined: 0 })
  })

  it('round-trips counts, and derives the blind spots at the far end', () => {
    const encoded = encodeResponse({
      kind: 'report',
      counts: [{ browser: 'safari 18', result: 'wasm-unavailable', count: 4 }],
      declined: 1,
    })
    const parsed = parseResponse(encoded)
    expect(parsed).toEqual({
      kind: 'report',
      counts: [{ browser: 'safari 18', result: 'wasm-unavailable', count: 4 }],
      declined: 1,
    })
    // The blind spots are not on the wire at all, which is the point: there is no
    // field in which a peer could omit them.
    expect(JSON.stringify(encoded)).not.toContain('blindSpot')
  })

  it('drops a cause this build has never heard of, and keeps the rest', () => {
    // A newer peer naming a new cause is a peer worth talking to. Refusing the
    // whole frame would make the metric go dark exactly when the fabric is most
    // heterogeneous.
    const parsed = parseResponse({
      kind: 'report',
      declined: 0,
      counts: [
        { browser: 'chromium 141', result: 'quantum-interference', count: 3 },
        { browser: 'chromium 141', result: 'started', count: 7 },
      ],
    })
    expect(parsed?.kind).toBe('report')
    if (parsed?.kind !== 'report') return
    expect(parsed.counts).toEqual([{ browser: 'chromium 141', result: 'started', count: 7 }])
  })

  it('files a half-formed report as a query rather than guessing', () => {
    // A browser with no result, or a result with no browser, could only be filed
    // under a guess — and a guessed row in a blocking metric is worse than none.
    const parsed = parseRequest({ kind: 'report', browser: 'safari 18', declined: 0 })
    expect(parsed).toEqual({ kind: 'report', outcome: null, declined: 0 })
  })
})

describe('publishing tells peers and reads back what they know', () => {
  it('returns an aggregate built from every peer that answered', async () => {
    const network = new MemoryNetwork()
    const alice = new StartOutcomeLedger()
    alice.mergeDisjoint([{ browser: 'chromium 141', result: 'started', count: 40 }])
    const bob = new StartOutcomeLedger()
    bob.mergeDisjoint([{ browser: 'safari 18', result: 'wasm-unavailable', count: 12 }])

    node(network, 'alice', alice)
    node(network, 'bob', bob)
    const visitor = node(network, 'visitor')

    const result = await publishStartOutcome({
      rpc: visitor,
      peers: () => ['alice', 'bob'],
      outcome: SAFARI_BLOCKED,
    })

    expect(result.reached).toBe(2)
    expect(result.asked).toBe(2)
    // Alice took the visitor's report, so her safari count is 13; Bob took it too.
    // Merged as overlapping views, the answer is the larger — not the sum.
    const safari = result.report.byBrowser.find((b) => b.browser === 'safari 18')
    expect(safari?.attempts).toBe(13)
    expect(result.report.byBrowser.find((b) => b.browser === 'chromium 141')?.attempts).toBe(40)
  })

  it('leaves the peers holding the report that was published to them', async () => {
    const network = new MemoryNetwork()
    const keeper = new StartOutcomeLedger()
    node(network, 'keeper', keeper)
    const visitor = node(network, 'visitor')

    await publishStartOutcome({ rpc: visitor, peers: () => ['keeper'], outcome: CHROMIUM_OK })
    await publishStartOutcome({ rpc: visitor, peers: () => ['keeper'], outcome: SAFARI_BLOCKED })

    expect(keeper.report().reported).toBe(2)
    expect(keeper.report().failed).toBe(1)
  })

  it('does not multiply the sample size by the number of peers asked', async () => {
    // Eight peers, one population. Summing would report 8× the visitors while
    // leaving every percentage unchanged — a correct-looking rate over a fiction.
    const network = new MemoryNetwork()
    const peers: string[] = []
    for (let i = 0; i < 8; i++) {
      const ledger = new StartOutcomeLedger()
      ledger.mergeDisjoint([{ browser: 'chromium 141', result: 'started', count: 100 }])
      node(network, `peer-${i}`, ledger)
      peers.push(`peer-${i}`)
    }
    const visitor = node(network, 'visitor')

    const result = await publishStartOutcome({ rpc: visitor, peers: () => peers, outcome: null })
    expect(result.reached).toBe(8)
    expect(result.report.reported).toBe(100)
  })
})

describe('the unreachable case is the one the metric exists for', () => {
  it('reports its own outcome and says nobody answered', async () => {
    // This is what a blocked visitor's node can produce: one report, no peers, and
    // an honest statement that the population it belongs to is unobservable.
    const network = new MemoryNetwork()
    const visitor = node(network, 'visitor')

    const result = await publishStartOutcome({
      rpc: visitor,
      peers: () => ['nobody-home'],
      outcome: SAFARI_BLOCKED,
    })

    expect(result.asked).toBe(1)
    expect(result.reached).toBe(0)
    expect(result.report.reported).toBe(1)
    expect(result.report.failed).toBe(1)
    expect(describeStartReport(result.report)).toContain('could not reach a peer')
  })

  it('is distinguishable from a peer that answered with nothing', async () => {
    // "Nobody is there" and "somebody is there and has been told nothing" are
    // different findings, and only `reached` tells them apart — the counts are
    // identical.
    const network = new MemoryNetwork()
    node(network, 'quiet', new StartOutcomeLedger())
    const visitor = node(network, 'visitor')

    const answered = await publishStartOutcome({
      rpc: visitor,
      peers: () => ['quiet'],
      outcome: CHROMIUM_OK,
    })
    const silent = await publishStartOutcome({
      rpc: visitor,
      peers: () => ['nobody-home'],
      outcome: CHROMIUM_OK,
    })

    expect(answered.report.reported).toBe(silent.report.reported)
    expect(answered.reached).toBe(1)
    expect(silent.reached).toBe(0)
  })

  it('asks no more peers than its cap allows', async () => {
    const network = new MemoryNetwork()
    const peers = Array.from({ length: 20 }, (_unused, i) => `peer-${i}`)
    for (const peer of peers) node(network, peer, new StartOutcomeLedger())
    const visitor = node(network, 'visitor')

    const result = await publishStartOutcome({
      rpc: visitor,
      peers: () => peers,
      outcome: CHROMIUM_OK,
      maxPeers: 3,
    })
    expect(result.asked).toBe(3)
    expect(result.reached).toBe(3)
  })
})

describe('a node without a ledger answers truthfully', () => {
  it('returns nothing rather than an error', async () => {
    // Holding no ledger is not a lesser kind of node — it is a node that has been
    // told nothing, and saying so is a real answer.
    const network = new MemoryNetwork()
    node(network, 'plain')
    const visitor = node(network, 'visitor')

    const result = await publishStartOutcome({
      rpc: visitor,
      peers: () => ['plain'],
      outcome: CHROMIUM_OK,
    })
    expect(result.reached).toBe(1)
    expect(result.report.reported).toBe(1)
  })
})
