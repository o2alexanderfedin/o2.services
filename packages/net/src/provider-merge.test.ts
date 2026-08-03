import { ed25519 } from '@noble/curves/ed25519.js'
import {
  EnrollmentAuthority,
  MemoryBlockstore,
  MemoryNetwork,
  MemoryRecordIndex,
  SelfRecordIndex,
  WasmExecutor,
  publishCapabilities,
  requestEnrollment,
  toHex,
} from '@o2/core'
import type { NodeRecords, RecordIndex } from '@o2/core'
import type { CID } from 'multiformats/cid'
import { describe, expect, it } from 'vitest'
import {
  EgressGuard,
  RpcEndpoint,
  RpcRecordIndex,
  encodeRequest,
  parseResponse,
  serveAgent,
  takeSovereignHold,
  withholdingFrom,
} from './index.ts'

/**
 * `RpcRecordIndex.providers` unions across peers — SCHED-01, owner ruling D1.
 *
 * Under D1 each node answers `providers` only for its own store. First-non-empty
 * therefore finds exactly **one** provider however many peers hold the block, and
 * power-of-d sampling over one candidate is not sampling. This file is the union, and
 * the asymmetry with `recordsFor` — which deliberately still takes the first answer,
 * because a record is a signed document and one copy of it is the whole of it.
 *
 * It also holds the invariant that keeps a provider answer from becoming a side
 * channel: a node never advertises a block its own `block` branch would refuse to
 * serve. That one is asserted against a **real `serveAgent`**, both branches, over the
 * wire — not against a predicate in isolation, because the whole claim is that the two
 * branches agree.
 *
 * Deliberately a new file rather than an extension of `discovery.test.ts`, whose
 * fixture publishes every provider into one seed index: a union over one peer is the
 * same list first-non-empty returned, so that file cannot see this change.
 */

const NOW = 1_800_000_000_000
const YEAR = 365 * 24 * 3_600_000
const FEATURES = ['bulk-memory', 'simd128']
const INPUT = new Uint8Array([0x80]) as Uint8Array<ArrayBuffer> // dag-cbor []

/** A `RecordIndex` that counts what it was asked, and can be made to wait. */
class Watched implements RecordIndex {
  providerCalls = 0
  recordCalls = 0
  readonly #inner: RecordIndex
  readonly #before: (() => Promise<void>) | undefined

  constructor(inner: RecordIndex, before?: () => Promise<void>) {
    this.#inner = inner
    this.#before = before
  }

  async providers(cid: CID): Promise<readonly string[]> {
    this.providerCalls += 1
    if (this.#before !== undefined) await this.#before()
    return this.#inner.providers(cid)
  }

  async recordsFor(nodeKey: string): Promise<NodeRecords | undefined> {
    this.recordCalls += 1
    return this.#inner.recordsFor(nodeKey)
  }
}

interface Peer {
  readonly nodeKey: string
  readonly rpc: RpcEndpoint
  readonly store: MemoryBlockstore
  readonly index: Watched
  readonly records: NodeRecords
}

interface Fabric {
  readonly requestorRpc: RpcEndpoint
  readonly peers: readonly Peer[]
  readonly inputCid: CID
  close(): void
}

/**
 * `count` peers, each holding the same block in its **own** store and answering
 * `providers` only for itself. This is D1's shape, and it is why the union exists.
 */
async function fabricOf(options: {
  count: number
  /** Held per peer index; a peer whose store is empty answers `[]` truthfully. */
  holdsInput?: (i: number) => boolean
  before?: () => Promise<void>
}): Promise<Fabric> {
  const network = new MemoryNetwork()
  const authority = new EnrollmentAuthority({
    providerPrivateKey: new Uint8Array(32).fill(60),
    maxPerWindow: 100,
    maxIssuedPerWindow: 'issues-without-an-aggregate-budget',
    issuance: 'remembers-only-within-this-process',
  })
  const userPriv = new Uint8Array(32).fill(61)

  const peers: Peer[] = []
  let inputCid: CID | undefined
  for (let i = 0; i < options.count; i++) {
    const priv = new Uint8Array(32).fill(70 + i)
    const nodeKey = toHex(ed25519.getPublicKey(priv))

    const enrolled = authority.enrol(
      requestEnrollment(priv, userPriv, {
        operatorId: `op-${i}`,
        discoverability: 'seed',
        relayIds: [],
      }),
      NOW,
    )
    if (!enrolled.ok) throw new Error(`fixture enrolment failed: ${enrolled.reason}`)
    const records: NodeRecords = {
      certificate: enrolled.certificate,
      capabilities: publishCapabilities(priv, {
        features: FEATURES,
        sovereignFor: [],
        issuedAt: NOW - 1000,
        expiresAt: NOW + YEAR,
      }),
    }

    const store = new MemoryBlockstore()
    // Every peer hashes the same bytes, so every peer's CID is the same CID — which
    // is the whole point of asking a content-addressed question of several nodes.
    const cid = await new MemoryBlockstore().put(INPUT)
    inputCid ??= cid
    if (options.holdsInput?.(i) ?? true) await store.put(INPUT)

    const index = new Watched(
      new SelfRecordIndex({
        nodeKey,
        store,
        records,
        withhold: 'advertises-everything-it-holds',
      }),
      options.before,
    )
    const rpc = new RpcEndpoint(network.connect(nodeKey), { timeoutMs: 5_000 })
    serveAgent({
      rpc,
      executor: new WasmExecutor({ nodeId: nodeKey, blockstore: store }),
      blockstore: store,
      egress: 'holds-no-registrations',
      authorize: 'serves-unauthenticated',
      index,
      enroll: 'issues-no-certificates',
      capacity: 'accepts-every-offer',
      ledger: 'keeps-no-ledger',
      reservations: 'relays-for-nobody',
      onDispatch: 'reports-no-dispatch',
    })
    peers.push({ nodeKey, rpc, store, index, records })
  }

  if (inputCid === undefined) throw new Error('fixture built no peers')
  const requestorRpc = new RpcEndpoint(network.connect('requestor'), { timeoutMs: 5_000 })
  return {
    requestorRpc,
    peers,
    inputCid,
    close() {
      requestorRpc.close()
      for (const peer of peers) peer.rpc.close()
    },
  }
}

describe('SCHED-01 — providers unions across peers, because each answers only for itself', () => {
  it('finds every provider, not the first one', async () => {
    const fabric = await fabricOf({ count: 3 })
    try {
      const index = new RpcRecordIndex(
        fabric.requestorRpc,
        () => fabric.peers.map((p) => p.nodeKey),
      )
      const keys = fabric.peers.map((p) => p.nodeKey).sort()

      // First-non-empty returns exactly one of these three. That is the production
      // behaviour this plan removes.
      expect(await index.providers(fabric.inputCid)).toStrictEqual(keys)
      // Every peer was asked exactly once — nobody was skipped after a fast answer.
      expect(fabric.peers.map((p) => p.index.providerCalls)).toStrictEqual([1, 1, 1])
    } finally {
      fabric.close()
    }
  })

  it('deduplicates and sorts, so a repeated key counts once and the answer is stable', async () => {
    const fabric = await fabricOf({ count: 3 })
    try {
      // Two of the three peers named twice: the same peer asked twice, which is what
      // an overlapping answer looks like from the requestor's side.
      const [first, second, third] = fabric.peers
      if (first === undefined || second === undefined || third === undefined) {
        throw new Error('fixture')
      }
      const index = new RpcRecordIndex(fabric.requestorRpc, () => [
        first.nodeKey,
        second.nodeKey,
        first.nodeKey,
        third.nodeKey,
        second.nodeKey,
      ])

      const answer = await index.providers(fabric.inputCid)
      expect(answer).toStrictEqual([first.nodeKey, second.nodeKey, third.nodeKey].sort())
      expect(new Set(answer).size).toBe(answer.length)
      // Reproducible: the same peers in a different order give the same answer.
      const reversed = new RpcRecordIndex(fabric.requestorRpc, () => [
        third.nodeKey,
        second.nodeKey,
        first.nodeKey,
      ])
      expect(await reversed.providers(fabric.inputCid)).toStrictEqual(answer)
    } finally {
      fabric.close()
    }
  })

  it('is stopped by neither an empty answer nor an unreachable peer', async () => {
    // "Skipped" and "empty" are different inputs with the same disposition, so they
    // are shown together: peer 1 holds nothing and says so, and a peer id nobody
    // serves cannot say anything at all.
    const fabric = await fabricOf({ count: 3, holdsInput: (i) => i !== 1 })
    try {
      const [first, silent, third] = fabric.peers
      if (first === undefined || silent === undefined || third === undefined) {
        throw new Error('fixture')
      }
      const index = new RpcRecordIndex(fabric.requestorRpc, () => [
        'nobody-serves-this-peer',
        first.nodeKey,
        silent.nodeKey,
        third.nodeKey,
      ])

      expect(await index.providers(fabric.inputCid)).toStrictEqual(
        [first.nodeKey, third.nodeKey].sort(),
      )
      // The empty answer was a real answer, and it was asked for.
      expect(silent.index.providerCalls).toBe(1)
      expect(await silent.store.has(fabric.inputCid)).toBe(false)
    } finally {
      fabric.close()
    }
  })

  it('leaves recordsFor taking the first answer — a signed document has one copy', async () => {
    // Two serving nodes both holding a record for the same key, so "first answer"
    // and "every answer" are genuinely different counts rather than the same one.
    const network = new MemoryNetwork()
    const authority = new EnrollmentAuthority({
      providerPrivateKey: new Uint8Array(32).fill(60),
      maxPerWindow: 100,
      maxIssuedPerWindow: 'issues-without-an-aggregate-budget',
      issuance: 'remembers-only-within-this-process',
    })
    const priv = new Uint8Array(32).fill(99)
    const subject = toHex(ed25519.getPublicKey(priv))
    const enrolled = authority.enrol(
      requestEnrollment(priv, new Uint8Array(32).fill(61), {
        operatorId: 'op-subject',
        discoverability: 'seed',
        relayIds: [],
      }),
      NOW,
    )
    if (!enrolled.ok) throw new Error(`fixture enrolment failed: ${enrolled.reason}`)
    const records: NodeRecords = {
      certificate: enrolled.certificate,
      capabilities: publishCapabilities(priv, {
        features: FEATURES,
        sovereignFor: [],
        issuedAt: NOW - 1000,
        expiresAt: NOW + YEAR,
      }),
    }

    const held: Watched[] = []
    const serving: RpcEndpoint[] = []
    for (const id of ['holder-a', 'holder-b']) {
      const memory = new MemoryRecordIndex()
      memory.publish(records)
      const watched = new Watched(memory)
      const store = new MemoryBlockstore()
      const rpc = new RpcEndpoint(network.connect(id), { timeoutMs: 5_000 })
      serveAgent({
        rpc,
        executor: new WasmExecutor({ nodeId: id, blockstore: store }),
        blockstore: store,
        egress: 'holds-no-registrations',
        authorize: 'serves-unauthenticated',
        index: watched,
        enroll: 'issues-no-certificates',
        capacity: 'accepts-every-offer',
        ledger: 'keeps-no-ledger',
        reservations: 'relays-for-nobody',
        onDispatch: 'reports-no-dispatch',
      })
      held.push(watched)
      serving.push(rpc)
    }

    const requestorRpc = new RpcEndpoint(network.connect('requestor'), { timeoutMs: 5_000 })
    try {
      const index = new RpcRecordIndex(requestorRpc, () => ['holder-a', 'holder-b'])
      expect(await index.recordsFor(subject)).toStrictEqual(records)

      // Exactly one `records` request in total. A `recordsFor` rewritten to ask
      // everyone the way `providers` now does reads two, and that asymmetry is what
      // this test exists to protect: a record is signed and verified by the caller,
      // so a second copy from a second peer can only agree or be discarded.
      expect(held.reduce((sum, w) => sum + w.recordCalls, 0)).toBe(1)
    } finally {
      requestorRpc.close()
      for (const rpc of serving) rpc.close()
    }
  })

  it('pays the full RPC budget for a peer that answers nothing, and still returns the rest', async () => {
    // The cost the class doc states, measured rather than asserted. The number is the
    // endpoint's OWN configured budget — no quantity is invented here, and none is
    // compared against a wall clock that nobody chose.
    const BUDGET_MS = 300
    const network = new MemoryNetwork()
    const store = new MemoryBlockstore()
    const cid = await store.put(INPUT)

    // A peer that receives the request and never answers it. `partition` and an
    // unknown peer id both fail FAST, so neither would exercise the budget at all.
    const mute = network.connect('mute')
    mute.onMessage(() => {})

    const priv = new Uint8Array(32).fill(77)
    const answering = toHex(ed25519.getPublicKey(priv))
    const authority = new EnrollmentAuthority({
      providerPrivateKey: new Uint8Array(32).fill(60),
      maxPerWindow: 100,
      maxIssuedPerWindow: 'issues-without-an-aggregate-budget',
      issuance: 'remembers-only-within-this-process',
    })
    const enrolled = authority.enrol(
      requestEnrollment(priv, new Uint8Array(32).fill(61), {
        operatorId: 'op-answering',
        discoverability: 'seed',
        relayIds: [],
      }),
      NOW,
    )
    if (!enrolled.ok) throw new Error(`fixture enrolment failed: ${enrolled.reason}`)
    const answeringStore = new MemoryBlockstore()
    await answeringStore.put(INPUT)
    const servingRpc = new RpcEndpoint(network.connect(answering), { timeoutMs: 5_000 })
    serveAgent({
      rpc: servingRpc,
      executor: new WasmExecutor({ nodeId: answering, blockstore: answeringStore }),
      blockstore: answeringStore,
      egress: 'holds-no-registrations',
      authorize: 'serves-unauthenticated',
      index: new SelfRecordIndex({
        nodeKey: answering,
        store: answeringStore,
        records: {
          certificate: enrolled.certificate,
          capabilities: publishCapabilities(priv, {
            features: FEATURES,
            sovereignFor: [],
            issuedAt: NOW - 1000,
            expiresAt: NOW + YEAR,
          }),
        },
        withhold: 'advertises-everything-it-holds',
      }),
      enroll: 'issues-no-certificates',
      capacity: 'accepts-every-offer',
      ledger: 'keeps-no-ledger',
      reservations: 'relays-for-nobody',
      onDispatch: 'reports-no-dispatch',
    })

    const requestorRpc = new RpcEndpoint(network.connect('requestor'), {
      timeoutMs: BUDGET_MS,
    })
    try {
      const index = new RpcRecordIndex(requestorRpc, () => ['mute', answering])
      const started = performance.now()
      const answer = await index.providers(cid)
      const elapsed = performance.now() - started

      // The lookup completed on the answers it got.
      expect(answer).toStrictEqual([answering])
      // …and it waited out the silent peer's whole budget to do it. This is the cost,
      // not a regression: under first-non-empty the fast answer would have returned
      // and the silent peer would never have been waited for.
      //
      // The bound carries a millisecond of slack, and the reason is the interesting
      // part: a `setTimeout(BUDGET_MS)` is compared against libuv's cached loop
      // timestamp rather than a fresh clock read, so it can fire a fraction of a
      // millisecond before `BUDGET_MS` has elapsed on `performance.now()`. Measured
      // here at **299.666 ms against a 300 ms budget** — and only on an idle host,
      // because under load the scheduling delay swamps the granularity and the reading
      // lands well above. A bound with no slack therefore fails when the machine is
      // quiet and passes when it is busy, which is exactly the wrong way round for a
      // guard: it would be green on the contended host that hides real regressions and
      // red on the clean one that would show them.
      //
      // One millisecond covers the granularity and comes nowhere near admitting the
      // behaviour being guarded against — a first-non-empty lookup returns on the fast
      // peer's answer in single-digit milliseconds, two orders of magnitude below this.
      const TIMER_GRANULARITY_MS = 1
      expect(elapsed).toBeGreaterThanOrEqual(BUDGET_MS - TIMER_GRANULARITY_MS)
    } finally {
      requestorRpc.close()
      servingRpc.close()
    }
  })

  it('asks the peers concurrently, not one after another', async () => {
    // An ordering property, not a wall-clock threshold: a millisecond number here
    // would be a quantity nobody measured. Each serving index records how many
    // `providers` requests had been observed across the fabric at the moment it
    // answered; under concurrency every one of them reads the full count.
    let observed = 0
    const seenWhenAnswering: number[] = []
    const settle = async (): Promise<void> => {
      observed += 1
      const started = Date.now()
      // Resolves as soon as everyone has been asked; the deadline exists only so a
      // sequential implementation fails the assertion instead of hanging the suite.
      while (observed < 3 && Date.now() - started < 250) {
        await new Promise((resolve) => setTimeout(resolve, 5))
      }
      seenWhenAnswering.push(observed)
    }

    const fabric = await fabricOf({ count: 3, before: settle })
    try {
      const index = new RpcRecordIndex(
        fabric.requestorRpc,
        () => fabric.peers.map((p) => p.nodeKey),
      )
      await index.providers(fabric.inputCid)

      expect(seenWhenAnswering).toHaveLength(3)
      // All three requests were observed at the serving side before the first answer
      // came back. A `for` loop with an `await` inside it reads `[1, 2, 3]`.
      expect(Math.min(...seenWhenAnswering)).toBe(3)
    } finally {
      fabric.close()
    }
  })
})

describe('DATA-05 — a provider answer is not a side channel around an egress refusal', () => {
  /**
   * The invariant, asserted against a real `serveAgent` on both branches over the
   * wire. Asking the predicate in isolation would prove only that the predicate does
   * what it does; the claim is that the *two branches agree*.
   */
  async function guardedNode(options: { label: (cid: CID) => string }): Promise<{
    ask: (body: ReturnType<typeof encodeRequest>) => Promise<ReturnType<typeof parseResponse>>
    sovereignCid: CID
    publicCid: CID
    nodeKey: string
    store: MemoryBlockstore
    close(): void
  }> {
    const network = new MemoryNetwork()
    const priv = new Uint8Array(32).fill(80)
    const nodeKey = toHex(ed25519.getPublicKey(priv))
    const authority = new EnrollmentAuthority({
      providerPrivateKey: new Uint8Array(32).fill(60),
      maxPerWindow: 100,
      maxIssuedPerWindow: 'issues-without-an-aggregate-budget',
      issuance: 'remembers-only-within-this-process',
    })
    const userPriv = new Uint8Array(32).fill(61)
    const enrolled = authority.enrol(
      requestEnrollment(priv, userPriv, {
        operatorId: 'op-guarded',
        discoverability: 'seed',
        relayIds: [],
      }),
      NOW,
    )
    if (!enrolled.ok) throw new Error(`fixture enrolment failed: ${enrolled.reason}`)
    const records: NodeRecords = {
      certificate: enrolled.certificate,
      capabilities: publishCapabilities(priv, {
        features: FEATURES,
        sovereignFor: [],
        issuedAt: NOW - 1000,
        expiresAt: NOW + YEAR,
      }),
    }

    const store = new MemoryBlockstore()
    const sovereignBytes = new TextEncoder().encode(
      'alice row 1, alice row 2 — raw, and pinned to her device',
    ) as Uint8Array<ArrayBuffer>
    const sovereignCid = await store.put(sovereignBytes)
    const publicCid = await store.put(INPUT)

    const guard = new EgressGuard(network.connect(nodeKey), toHex(ed25519.getPublicKey(userPriv)))
    // How a registration is actually produced on a running node.
    guard.guard(options.label(sovereignCid), sovereignBytes)

    const egress = { guard, sovereignInputs: store, sovereignCids: 'forgets-sovereignty-between-jobs' } as const
    const rpc = new RpcEndpoint(guard, { timeoutMs: 5_000 })
    serveAgent({
      rpc,
      executor: new WasmExecutor({ nodeId: nodeKey, blockstore: store }),
      blockstore: store,
      egress,
      authorize: 'serves-unauthenticated',
      index: new SelfRecordIndex({
        nodeKey,
        store,
        records,
        withhold: withholdingFrom(egress),
      }),
      enroll: 'issues-no-certificates',
      capacity: 'accepts-every-offer',
      ledger: 'keeps-no-ledger',
      reservations: 'relays-for-nobody',
      onDispatch: 'reports-no-dispatch',
    })

    const requestorRpc = new RpcEndpoint(network.connect('requestor'), { timeoutMs: 5_000 })
    return {
      ask: async (body) => parseResponse(await requestorRpc.request(nodeKey, body)),
      sovereignCid,
      publicCid,
      nodeKey,
      store,
      close() {
        requestorRpc.close()
        rpc.close()
      },
    }
  }

  it('withholds exactly the block its own block branch refuses, and advertises the rest', async () => {
    const node = await guardedNode({ label: (cid) => cid.toString() })
    try {
      // The block branch refuses, by name.
      const refused = await node.ask(encodeRequest({ kind: 'block', cid: node.sovereignCid }))
      expect(refused?.kind).toBe('error')
      if (refused?.kind === 'error') {
        expect(refused.reason).toContain('egress refused:')
        expect(refused.reason).toContain(node.sovereignCid.toString())
        expect(refused.reason).toContain(node.nodeKey)
      }
      // …and the provider branch agrees, without a second copy of the condition.
      const hidden = await node.ask(encodeRequest({ kind: 'providers', cid: node.sovereignCid }))
      expect(hidden?.kind === 'providers' ? hidden.nodeKeys : 'wrong kind').toStrictEqual([])
      // The node really does hold it — an empty answer here is a refusal, not absence,
      // and without this reading the two are indistinguishable.
      expect(await node.store.has(node.sovereignCid)).toBe(true)

      // The withholding is about one block, not about this node: an unregistered
      // block is served and advertised.
      const served = await node.ask(encodeRequest({ kind: 'block', cid: node.publicCid }))
      expect(served?.kind).toBe('block')
      const shown = await node.ask(encodeRequest({ kind: 'providers', cid: node.publicCid }))
      expect(shown?.kind === 'providers' ? shown.nodeKeys : 'wrong kind').toStrictEqual([
        node.nodeKey,
      ])
    } finally {
      node.close()
    }
  })

  it('agrees even when the registration was not labelled with its CID', async () => {
    // The decisive case. `EgressGuard.guard` takes an arbitrary label for an
    // arbitrary payload, so the block branch — which scans for the PAYLOAD — refuses
    // here too. A predicate keyed on `registrations.includes(cid.toString())` would
    // advertise this block while the block branch refused it: the side channel,
    // reintroduced by a line that reads like a simplification.
    const node = await guardedNode({ label: () => 'a label that is not a CID' })
    try {
      const refused = await node.ask(encodeRequest({ kind: 'block', cid: node.sovereignCid }))
      expect(refused?.kind).toBe('error')
      if (refused?.kind === 'error') {
        expect(refused.reason).toContain('egress refused: a label that is not a CID')
      }

      const hidden = await node.ask(encodeRequest({ kind: 'providers', cid: node.sovereignCid }))
      expect(hidden?.kind === 'providers' ? hidden.nodeKeys : 'wrong kind').toStrictEqual([])
      expect(await node.store.has(node.sovereignCid)).toBe(true)
    } finally {
      node.close()
    }
  })

  it('withholds nothing on a node whose sends are not tapped', async () => {
    expect(withholdingFrom('holds-no-registrations')).toBe('advertises-everything-it-holds')
  })

  it('withholds nothing while the tap holds no registration, and again once given back', async () => {
    // A registration's lifetime is a hold. The answer must follow it in both
    // directions, which is what "consulted per lookup" buys.
    const network = new MemoryNetwork()
    const store = new MemoryBlockstore()
    const bytes = new TextEncoder().encode('owner-pinned bytes') as Uint8Array<ArrayBuffer>
    const cid = await store.put(bytes)
    const guard = new EgressGuard(network.connect('n'), 'owner')
    const withhold = withholdingFrom({ guard, sovereignInputs: store, sovereignCids: 'forgets-sovereignty-between-jobs' })
    if (withhold === 'advertises-everything-it-holds') throw new Error('fixture')

    expect(await withhold(cid)).toBe(false)
    const hold = await takeSovereignHold(
      {
        moduleCid: cid,
        inputCid: cid,
        partitionIndex: 0,
        partitionCount: 1,
        label: 'sovereign',
        ownerId: 'owner',
      },
      { blockstore: store, guard },
    )
    expect(hold).not.toBeNull()
    expect(await withhold(cid)).toBe(true)
    hold?.release()
    expect(await withhold(cid)).toBe(false)
  })
})
