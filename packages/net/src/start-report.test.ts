import {
  BROWSER_FAMILIES,
  MemoryBlockstore,
  MemoryNetwork,
  StartOutcomeLedger,
  WasmExecutor,
  describeStartReport,
  encodeCanonical,
} from '@o2/core'
import type { OutcomeCount, StartOutcome } from '@o2/core'
import { describe, expect, it } from 'vitest'
import {
  MAX_REPORTED_COUNT,
  encodeRequest,
  encodeResponse,
  parseRequest,
  parseResponse,
} from './protocol.ts'
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
/**
 * A family the asking node in the cases below is not.
 *
 * The load-bearing reading for BROW-02's cross-node merge is a **family**, never a count.
 * A count is satisfiable by accident — an off-by-one in a merge, a peer asked twice, a
 * fixture that recorded something extra — while a node whose only local outcome is
 * `chromium 141` has no expression anywhere that produces the string `firefox`. So the
 * assertion is that a row for this family arrived, and the control is the same fixture
 * with the peer holding nothing.
 */
const FIREFOX_OK: StartOutcome = { browser: 'firefox 130', result: { kind: 'started' } }

function node(
  network: MemoryNetwork,
  id: string,
  ledger: StartOutcomeLedger | 'keeps-no-ledger' = 'keeps-no-ledger',
): RpcEndpoint {
  const rpc = new RpcEndpoint(network.connect(id), { timeoutMs: 500 })
  const blockstore = new MemoryBlockstore()
  serveAgent({
    paused: 'never-pauses',
    rpc,
    executor: new WasmExecutor({ nodeId: id, blockstore }),
    blockstore,
    egress: 'holds-no-registrations',
    authorize: 'serves-unauthenticated',
    index: 'serves-no-records',
    enroll: 'issues-no-certificates',
    capacity: 'accepts-every-offer',
    ledger,
    reservations: 'relays-for-nobody',
    onDispatch: 'reports-no-dispatch',
    attest: 'signs-nothing',
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

  it('files a report whose browser label is a full UA string as a query, not as a claim', () => {
    // `StartOutcome.browser` has said "coarse family and major version, never a
    // full UA string" since it was written, and nothing enforced it on a label
    // that arrived from a peer. The disclosure promise rests on the coarseness,
    // so a peer-chosen fingerprint must not become a row.
    const ua =
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'
    const parsed = parseRequest(
      encodeRequest({
        kind: 'report',
        outcome: { browser: ua, result: { kind: 'started' } },
        declined: 3,
      }),
    )
    // The claim is dropped; the peer's own truthful count is not. Dropping the
    // frame would take the metric dark for a whole population over one bad label.
    expect(parsed).toEqual({ kind: 'report', outcome: null, declined: 3 })

    const fileable = parseRequest(
      encodeRequest({
        kind: 'report',
        outcome: { browser: 'chromium 141', result: { kind: 'started' } },
        declined: 3,
      }),
    )
    expect(fileable).toEqual({
      kind: 'report',
      outcome: { browser: 'chromium 141', result: { kind: 'started' } },
      declined: 3,
    })
  })

  it('drops a counts entry whose browser label is not one this build can file', () => {
    const parsed = parseResponse({
      kind: 'report',
      declined: 0,
      counts: [
        { browser: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', result: 'started', count: 3 },
        { browser: 'firefox 130', result: 'started', count: 7 },
      ],
    })
    expect(parsed?.kind).toBe('report')
    if (parsed?.kind !== 'report') return
    expect(parsed.counts).toEqual([{ browser: 'firefox 130', result: 'started', count: 7 }])
  })

  it('files every family this build publishes, bare and with a major', () => {
    // Driven off the exported list rather than a copy of it: a family added to
    // `BROWSER_FAMILIES` that the wire check would reject fails here, which is
    // what keeps the producer and the wire check from drifting apart.
    for (const family of BROWSER_FAMILIES) {
      for (const label of [family, `${family} 141`]) {
        const parsed = parseRequest(
          encodeRequest({
            kind: 'report',
            outcome: { browser: label, result: { kind: 'started' } },
            declined: 0,
          }),
        )
        expect(parsed).toEqual({
          kind: 'report',
          outcome: { browser: label, result: { kind: 'started' } },
          declined: 0,
        })
      }
    }
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

describe('a decline is counted where it was made and nowhere else', () => {
  it('folds a local decline into this node’s own report without putting it on a peer’s ledger', async () => {
    // Both halves are asserted together on purpose. A decline that reaches the peer
    // is not an opt-out; a decline that reaches nothing at all loses the blind spot
    // the report exists to publish. One argument could only ever get one of them.
    const network = new MemoryNetwork()
    const keeper = new StartOutcomeLedger()
    node(network, 'keeper', keeper)
    const visitor = node(network, 'visitor')

    const result = await publishStartOutcome({
      rpc: visitor,
      peers: () => ['keeper'],
      outcome: CHROMIUM_OK,
      declinedLocally: 1,
    })

    const spot = result.report.blindSpots.find((entry) => entry.kind === 'declined')
    expect(spot?.kind === 'declined' && spot.count).toBe(1)
    expect(keeper.declined).toBe(0)
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

/**
 * A number a peer sends is a claim, and a claim has a size past which it stops
 * being evidence.
 *
 * The negative count the parser already drops and the enormous one it did not are
 * the same attack from opposite ends: one erases another peer's evidence, the other
 * buries it. `mergeOverlapping` takes the largest count it is shown, so a single
 * `count: 4e9` decided every rate in the merged report on its own.
 */
describe('a count past what this fabric could have observed is not evidence', () => {
  it('files an entry at the ceiling and refuses the one above it', () => {
    const parsed = parseResponse({
      kind: 'report',
      declined: 0,
      counts: [
        { browser: 'chromium 141', result: 'started', count: MAX_REPORTED_COUNT },
        { browser: 'safari 18', result: 'wasm-unavailable', count: MAX_REPORTED_COUNT + 1 },
      ],
    })
    expect(parsed?.kind).toBe('report')
    if (parsed?.kind !== 'report') return
    // The over-ceiling entry alone is dropped. Refusing the whole frame would let
    // one bad row take a truthful peer's whole ledger dark — the same reason an
    // unrecognised cause drops its entry and not the frame.
    expect(parsed.counts).toEqual([
      { browser: 'chromium 141', result: 'started', count: MAX_REPORTED_COUNT },
    ])
  })

  it('still drops the negative and the zero it always dropped', () => {
    // Pinned here because the ceiling is a second check on the same field: a
    // rewrite that replaced the lower bound with an upper one would pass every
    // other test in this file.
    const parsed = parseResponse({
      kind: 'report',
      declined: 0,
      counts: [
        { browser: 'chromium 141', result: 'started', count: -5 },
        { browser: 'firefox 134', result: 'started', count: 0 },
        { browser: 'safari 18', result: 'started', count: 3 },
      ],
    })
    expect(parsed?.kind).toBe('report')
    if (parsed?.kind !== 'report') return
    expect(parsed.counts).toEqual([{ browser: 'safari 18', result: 'started', count: 3 }])
  })

  it('lets no single peer decide the aggregate by claiming a number nobody can hold', async () => {
    // The property that matters, over a real endpoint: seven peers report what they
    // saw, one reports a magnitude no node in this fabric could have accumulated,
    // and the merged report is the seven. Clamping instead of dropping would still
    // have handed the hostile peer the row, because the merge takes the maximum —
    // a bounded lie is still the largest number in the aggregate.
    const network = new MemoryNetwork()
    const peers: string[] = []
    for (let i = 0; i < 7; i++) {
      const honest = new StartOutcomeLedger()
      honest.mergeDisjoint([{ browser: 'chromium 141', result: 'started', count: 100 }])
      node(network, `peer-${i}`, honest)
      peers.push(`peer-${i}`)
    }
    const hostile = new StartOutcomeLedger()
    hostile.mergeDisjoint([
      { browser: 'safari 18', result: 'wasm-unavailable', count: 4_000_000_000 },
    ])
    node(network, 'hostile', hostile)
    peers.push('hostile')

    const visitor = node(network, 'visitor')
    const result = await publishStartOutcome({ rpc: visitor, peers: () => peers, outcome: null })

    // It answered — it is not unreachable, and the report must not pretend otherwise.
    expect(result.reached).toBe(8)
    expect(result.report.reported).toBe(100)
    expect(result.report.failed).toBe(0)
    expect(result.report.byBrowser.find((b) => b.browser === 'safari 18')).toBeUndefined()
  })

  it('refuses a decline count that would bury the blind spot it belongs to', async () => {
    // `declined` is the same unbounded number one field away, and the cheaper attack
    // of the two: a count needs one request per unit to grow, while a single request
    // carrying `declined: 4e9` is added to the serving node's ledger outright and
    // then served to everyone who asks it. The blind spot is a line this project
    // treats as load-bearing, so a peer must not get to write it.
    const network = new MemoryNetwork()
    const keeper = new StartOutcomeLedger()
    node(network, 'keeper', keeper)
    const visitor = node(network, 'visitor')

    await visitor.request(
      'keeper',
      encodeRequest({ kind: 'report', outcome: null, declined: MAX_REPORTED_COUNT + 1 }),
    )
    expect(keeper.declined).toBe(0)

    // At the ceiling it is still a real answer, and is counted.
    await visitor.request(
      'keeper',
      encodeRequest({ kind: 'report', outcome: null, declined: MAX_REPORTED_COUNT }),
    )
    expect(keeper.declined).toBe(MAX_REPORTED_COUNT)
  })
})

/**
 * BROW-02's cross-node merge — the mechanism half, measured rather than asserted.
 *
 * ## Why this file gained cases at all
 *
 * Every production node used to pass `serveAgent`'s named opt-out for the `ledger` hook,
 * so the report branch answered `counts: []` and this whole exchange moved nothing. Plan
 * 20-02 gave both node factories a real {@link StartOutcomeLedger}. That is **necessary
 * and not sufficient**, and the insufficiency is the thing worth a test:
 *
 * `serveAgent` records only what a **peer** told it. A node's own outcome never entered
 * its own serve-side ledger, so A publishing to B and then asking B was handed back
 * **A's own row** — and `mergeOverlapping` takes the maximum per `(browser, result)` key,
 * so a merged report across two nodes read 1, and across twenty read 1. The fix is that a
 * node records its own start row at construction, and the fixtures below reproduce that
 * exactly: a peer's ledger is built and its own outcome recorded into it before it serves.
 *
 * ## What these cases cannot see, said plainly
 *
 * They exercise the **mechanism** in `@o2/net`, not the factories in `@o2/node` and
 * `@o2/browser`. Those depend on this package and not the other way round, so no test
 * here can import them and no plant in `fabric-node.ts` can redden this file — measured,
 * not assumed: 20-02-PLAN.md's proof block predicted that the opt-out planted back into
 * `fabric-node.ts` would redden a case here, it was planted, and every case in this file
 * stayed green. What sees that plant is `packages/node/src/serve-agent-hooks.node.test.ts`,
 * whose ledger rows pin the hook argument, the ledger construction and the own-row record
 * at both factories.
 */
describe('a node that records its own row hands a peer something it did not supply', () => {
  it('carries a family the asking node has no expression to produce, and does not when the peer has no row of its own', async () => {
    // Three arms, one fixture, one run. Comparative rather than absolute on purpose: the
    // only thing that differs between them is what the answering peer holds, so the
    // difference in what the asking node reads is attributable to that and to nothing
    // about the machine, the ordering, or whether an answer came back at all.
    const network = new MemoryNetwork()

    // (i) A peer that holds a real ledger **and its own row** — what both node factories
    //     now build at construction.
    const withOwnRow = new StartOutcomeLedger()
    withOwnRow.record(FIREFOX_OK)
    node(network, 'holds-own-row', withOwnRow)

    // (ii) A peer that holds a real ledger and **skipped its own row** — the defect this
    //      plan exists to remove, staged rather than described. It answers, it holds a
    //      ledger, and it has nothing of its own in it.
    node(network, 'holds-empty-ledger', new StartOutcomeLedger())

    // (iii) A peer holding no ledger at all. Kept beside (ii) because the two are
    //       *indistinguishable to the asking node*, which is itself the finding: handing
    //       every factory a ledger and stopping there buys a caller nothing it can read.
    node(network, 'holds-no-ledger')

    const asking = node(network, 'asking')
    const ask = async (peer: string) =>
      publishStartOutcome({ rpc: asking, peers: () => [peer], outcome: CHROMIUM_OK })

    const fromOwnRow = await ask('holds-own-row')
    const fromEmpty = await ask('holds-empty-ledger')
    const fromNone = await ask('holds-no-ledger')

    // Every arm reached its peer. Without this the absence in the last two arms would be
    // equally explained by nobody answering, which is a different finding entirely and is
    // the one this whole module exists to keep separable.
    expect([fromOwnRow.reached, fromEmpty.reached, fromNone.reached]).toEqual([1, 1, 1])

    const familyIn = (result: Awaited<ReturnType<typeof ask>>): readonly string[] =>
      result.report.byBrowser.map((tally) => tally.browser)

    // The load-bearing reading: a family, not a count.
    expect(familyIn(fromOwnRow)).toContain('firefox 130')
    expect(familyIn(fromEmpty)).not.toContain('firefox 130')
    expect(familyIn(fromNone)).not.toContain('firefox 130')

    // And the arithmetic 20-CONTEXT.md works through, read as a ratio inside this one
    // run rather than as three absolute numbers: the own-row arm is the only one that
    // exceeds what the asking node already held.
    expect(fromOwnRow.report.reported).toBe(2)
    expect(fromEmpty.report.reported).toBe(1)
    expect(fromNone.report.reported).toBe(1)
  })
})

/**
 * The two bounds the demo's deferral named, re-measured rather than cited.
 *
 * `demo/index.html`'s `refreshReport` deferred a serve-side ledger *"behind the magnitude
 * bound and the label whitelist, because publishing per-peer start outcomes across the
 * fabric before those land is the fingerprint the disclosure promise in
 * `start-outcome.ts` exists to prevent."* Both landed — `MAX_REPORTED_COUNT` and
 * `isStartBrowserLabel`, enforced in `protocol.ts`'s `parseCounts` — and Plan 20-02 lifts
 * that deferral. **A deferral lifted on an unverified condition is the same class of
 * error the deferral prevented**, so both bounds are measured here over the wire rather
 * than quoted from the parser that implements them.
 *
 * The cases above them in this file already read each bound at `parseResponse`. What
 * these add is the paired discrimination those could not make: a peer whose frame carries
 * a refused entry **and** truthful ones, so an absence in the merged report is shown to be
 * that entry being dropped rather than the whole frame being refused. Those are different
 * behaviours with opposite consequences — one loses a row, the other takes a peer's entire
 * evidence dark — and an unpaired assertion cannot tell them apart.
 */
describe('lifting the deferral does not lift the bounds it was conditional on', () => {
  /**
   * A magnitude no ceiling this fabric could honestly declare would admit.
   *
   * **An absolute, and it is deliberate — a relative one here cannot fail.** The first
   * draft of the case below sent `MAX_REPORTED_COUNT + 1`, which reads correctly and is
   * the shape two existing cases in this file already use. Then the plant this plan
   * requires was applied — `MAX_REPORTED_COUNT` raised, to check the case could see the
   * bound being lifted — and **the file stayed green**, because raising the constant
   * raised the probe with it. A count expressed as `ceiling + 1` is above the ceiling by
   * construction and can therefore never detect the ceiling moving.
   *
   * That distinction matters here and not in the two cases above, and the difference is
   * what each is for. `'files an entry at the ceiling and refuses the one above it'` is
   * about **where the boundary is** — relative is exactly right, and a raise is a
   * *decision* rather than a defect it should report. This block is about a **deferral
   * that was lifted on the condition that this bound exists**, so a silent raise re-opens
   * the surface the deferral guarded and is precisely what has to be visible.
   *
   * Paired with a relational assertion in the case, so the literal is not a number
   * somebody has to trust: if a future ceiling ever climbed past this, that assertion
   * fires and names the reason rather than the case silently starting to measure nothing.
   */
  const BEYOND_ANY_CEILING = 4_000_000_000

  it('drops the over-large entry from a peer whose other entries are truthful, and keeps those', async () => {
    const network = new MemoryNetwork()
    const loud = new StartOutcomeLedger()
    loud.mergeDisjoint([
      { browser: 'safari 18', result: 'wasm-unavailable', count: BEYOND_ANY_CEILING },
      { browser: 'firefox 130', result: 'started', count: 7 },
    ])
    node(network, 'loud', loud)
    const asking = node(network, 'asking')

    const result = await publishStartOutcome({
      rpc: asking,
      peers: () => ['loud'],
      outcome: CHROMIUM_OK,
    })

    expect(result.reached).toBe(1)
    // The pair. The absence alone is equally produced by a whole-frame refusal; the
    // survival beside it is what says the drop was per-entry.
    expect(result.report.byBrowser.map((tally) => tally.browser)).not.toContain('safari 18')
    expect(result.report.byBrowser.find((tally) => tally.browser === 'firefox 130')?.attempts).toBe(7)
    // Last on purpose, and the ordering is a measurement rather than a style. This is
    // what makes the literal above mean something: the ceiling really is below the
    // magnitude this case sends, so a ceiling raised past `BEYOND_ANY_CEILING` cannot
    // leave the case passing while measuring nothing. Placed first, it fired before the
    // pair and the plant showed only *why* the case was void — placed here, the plant
    // shows the refused row **arriving**, which is the behaviour under test, and then
    // this line names the cause.
    expect(MAX_REPORTED_COUNT).toBeLessThan(BEYOND_ANY_CEILING)
  })

  it('drops a full user-agent label from a peer whose other entries are truthful, and keeps those', async () => {
    // The fingerprint the disclosure promise exists to prevent, arriving as a *count*
    // rather than as an outcome — which is the direction nothing guarded until
    // `parseCounts` checked labels, and the direction a serve-side ledger opens by
    // making per-peer rows travel at all.
    const network = new MemoryNetwork()
    const fingerprinting = new StartOutcomeLedger()
    fingerprinting.mergeDisjoint([
      {
        browser:
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
        result: 'started',
        count: 5,
      },
      { browser: 'firefox 130', result: 'started', count: 7 },
    ])
    node(network, 'fingerprinting', fingerprinting)
    const asking = node(network, 'asking')

    const result = await publishStartOutcome({
      rpc: asking,
      peers: () => ['fingerprinting'],
      outcome: CHROMIUM_OK,
    })

    expect(result.reached).toBe(1)
    expect(result.report.byBrowser.map((tally) => tally.browser)).not.toContain(
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
    )
    expect(result.report.byBrowser.find((tally) => tally.browser === 'firefox 130')?.attempts).toBe(7)
  })
})

/**
 * The row count — **measured, and the measurement is the finding.**
 *
 * `StartOutcomeLedger`'s own docblock says the magnitude of a count is free to hold and
 * that *"the row count is a separate matter and is still unbounded — only a cap at the
 * wire boundary closes that, and it is not here."* 20-CONTEXT.md asks whether NET-08's
 * inbound ceiling covers it, and says to measure that before writing either word in a
 * summary. This is that measurement, and Plan 20-02 deliberately does **not** add a cap:
 * closing it is a new decision.
 *
 * ## What the reading is taken through, and what that means
 *
 * The frame goes through the real `encodeRequest` / `parseResponse` path over
 * `MemoryNetwork`, so `parseCounts` — every label check and every magnitude check — is in
 * play on all of it. What is **not** in play is NET-08's `MAX_INBOUND_MESSAGE_BYTES`,
 * because that bound belongs to `@o2/libp2p`'s transport and `MemoryNetwork` has no byte
 * limit of any kind. `@o2/net` depends only on `@o2/core`, so the constant cannot be
 * imported here; its value is written down beside the reading in the same way
 * `perf-workload.ts` writes down the driver's `SHARDS` and `enrol-client.ts` writes down
 * `DEFAULT_RPC_TIMEOUT_MS`, with the same consequence stated: if it moves, this reading
 * has to be retaken.
 *
 * So the answer has two halves, and neither is "bounded":
 *
 * - **In-process, nothing refuses it at all.** Every well-formed row arrives and is
 *   merged.
 * - **Over libp2p, the only thing that would refuse it is a byte ceiling**, which bounds
 *   the *frame* and not the *row count* — so the row count it permits is whatever fits,
 *   which the case below computes rather than guesses.
 */
describe('the row count is bounded by nothing this test can reach', () => {
  /**
   * NET-08's inbound ceiling, from `@o2/libp2p`'s `MAX_INBOUND_MESSAGE_BYTES`.
   *
   * 8 MiB. Duplicated rather than imported because importing it would make `@o2/net`
   * depend on `@o2/libp2p`, which is the wrong direction and which `purity.node.test.ts`
   * exists to refuse. If that constant moves, this reading is stale.
   */
  const INBOUND_CEILING_BYTES = 8_388_608

  it('merges ten thousand rows with nothing refusing them, and says what a byte ceiling would', async () => {
    // Every label is one `isStartBrowserLabel` accepts — `\d{1,4}` is its whole allowance
    // for a major version, so 0…9999 is the complete set of `firefox N` labels this build
    // can file. Well-formed on purpose: a reading taken on rows the parser drops would
    // measure the parser, not the row count.
    //
    // `firefox`, and the family is load-bearing rather than arbitrary. The first draft
    // generated `chromium N`, which contains `chromium 141` — the asking node's own
    // label — so the merge collapsed two rows into one and the count read 10 000 instead
    // of 10 001. The case caught it, which is the reason it is written down here: a
    // fixture that overlaps the reading it is the background for is not a background.
    const rows: OutcomeCount[] = Array.from({ length: 10_000 }, (_unused, i) => ({
      browser: `firefox ${i}`,
      result: 'started' as const,
      count: 1,
    }))

    const network = new MemoryNetwork()
    const many = new StartOutcomeLedger()
    many.mergeDisjoint(rows)
    node(network, 'many-rows', many)
    const asking = node(network, 'asking')

    const result = await publishStartOutcome({
      rpc: asking,
      peers: () => ['many-rows'],
      outcome: CHROMIUM_OK,
    })

    // The finding: nothing anywhere on this path refused any of it. 10 000 rows from the
    // peer, plus the asking node's own `chromium 141`, which is not among them.
    expect(result.reached).toBe(1)
    expect(result.report.byBrowser).toHaveLength(10_001)
    expect(result.report.reported).toBe(10_001)

    // What a byte ceiling would do, derived rather than assumed. `encodeCanonical` is the
    // same encoder `rpc.ts` puts on the wire, so this is the frame's real size.
    const encoded = encodeCanonical(
      encodeResponse({ kind: 'report', counts: many.counts(), declined: 0 }),
    )
    expect(encoded.ok).toBe(true)
    if (!encoded.ok) return
    const bytesPerRow = encoded.bytes.byteLength / rows.length
    // Comparative, not absolute: the assertion is that this frame is *well inside* the
    // ceiling, which is what says the row count is not what NET-08 bounds.
    //
    // **The absolute figures, measured on 2026-08-04 and not estimated.** 10 000 rows of
    // the shape above encode to **438 967 bytes** — **43.90 bytes a row** — putting the
    // crossover at **191 099 rows**. They are deterministic rather than timing-shaped:
    // `encodeCanonical` over a fixed row set has no dependence on the machine or the
    // load, so unlike a wall-clock span they are reproducible anywhere. What they do
    // depend on is the row *shape*, and a wider label or a longer result string moves
    // them; that is why the assertions below are a bound and a floor rather than
    // equalities.
    expect(encoded.bytes.byteLength).toBeLessThan(INBOUND_CEILING_BYTES)
    // The crossover the measured figures imply. Nearly two hundred thousand rows is not a
    // bound on a metric that grows by one row per distinct `(browser, result)` a node is
    // ever told about, and a node is told about them for as long as it runs. Asserted as
    // a floor so the claim this whole block exists to state — **NET-08 does not
    // meaningfully bound the row count** — is the thing that can fail.
    expect(INBOUND_CEILING_BYTES / bytesPerRow).toBeGreaterThan(100_000)
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
