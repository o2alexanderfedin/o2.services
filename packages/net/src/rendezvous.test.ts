import { MemoryBlockstore, MemoryNetwork, WasmExecutor } from '@o2/core'
import { describe, expect, it } from 'vitest'
import { encodeRequest, encodeResponse, parseRequest, parseResponse } from './protocol.ts'
import { RpcEndpoint } from './rpc.ts'
import { serveAgent } from './agent.ts'
import { findReservedPeers, MAX_RESERVED_PEERS_PER_ANSWER, serveReservations } from './rendezvous.ts'

/** Zero-padded so lexical order is numeric order — the module sorts what it returns. */
function holders(count: number, prefix = 'tab'): string[] {
  return Array.from({ length: count }, (_, i) => `${prefix}-${String(i).padStart(6, '0')}`)
}

/**
 * NET-03 — the rendezvous a browser cannot perform for itself.
 *
 * Two tabs reserved on the same node are invisible to each other for as long as
 * nobody says who is present, because neither can be dialled cold and neither can
 * announce itself. This is the request that breaks the symmetry, and it has to work
 * on a static host where there is no origin to ask.
 */

function node(
  network: MemoryNetwork,
  id: string,
  reservations: (() => readonly string[]) | 'relays-for-nobody' = 'relays-for-nobody',
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
    ledger: 'keeps-no-ledger',
    reservations,
    onDispatch: 'reports-no-dispatch',
    attest: 'signs-nothing',
  })
  return rpc
}

describe('the request survives the wire', () => {
  it('round-trips, carrying nothing — the question has no parameters', () => {
    expect(parseRequest(encodeRequest({ kind: 'reservations' }))).toEqual({ kind: 'reservations' })
  })

  it('round-trips a list of holders', () => {
    const parsed = parseResponse(encodeResponse({ kind: 'reservations', peerIds: ['a', 'b'] }))
    expect(parsed).toEqual({ kind: 'reservations', peerIds: ['a', 'b'] })
  })

  it('refuses a list that is not a list of ids', () => {
    // Wire input. A malformed frame is an expected condition, not an exception.
    expect(parseResponse({ kind: 'reservations', peerIds: [1, 2] })).toBeNull()
    expect(parseResponse({ kind: 'reservations' })).toBeNull()
  })
})

describe('a node answers with who is reserved on it', () => {
  it('turns holders into addresses that go through the node holding them', async () => {
    // A reservation is held *on* a node, so the address that reaches its holder
    // must route through that node. The address is only meaningful relative to the
    // peer that reported it, which is why the protocol returns ids and this builds
    // the address.
    const network = new MemoryNetwork()
    node(network, 'hub', () => ['tab-a', 'tab-b'])
    const seeker = node(network, 'seeker')

    const found = await findReservedPeers({
      rpc: seeker,
      peers: () => ['hub'],
      self: 'seeker',
    })

    expect(found.answered).toBe(1)
    expect(found.addrs).toEqual([
      '/p2p/hub/p2p-circuit/webrtc/p2p/tab-a',
      '/p2p/hub/p2p-circuit/webrtc/p2p/tab-b',
    ])
  })

  it('never offers a node its own reservation back', async () => {
    // The asking tab is reserved on the same node, so it is in the answer. Dialling
    // itself would be a connection to nowhere that looks like a peer.
    const network = new MemoryNetwork()
    node(network, 'hub', () => ['seeker', 'tab-b'])
    const seeker = node(network, 'seeker')

    const found = await findReservedPeers({ rpc: seeker, peers: () => ['hub'], self: 'seeker' })
    expect(found.addrs).toEqual(['/p2p/hub/p2p-circuit/webrtc/p2p/tab-b'])
  })

  it('merges two hubs rather than stopping at the first', async () => {
    // Two nodes hold different populations. Taking the first answer would silently
    // halve a fabric spread across both, and it would look like fewer volunteers —
    // the failure mode this project spends a whole requirement trying to make
    // visible elsewhere.
    const network = new MemoryNetwork()
    node(network, 'hub-1', () => ['tab-a'])
    node(network, 'hub-2', () => ['tab-b'])
    const seeker = node(network, 'seeker')

    const found = await findReservedPeers({
      rpc: seeker,
      peers: () => ['hub-1', 'hub-2'],
      self: 'seeker',
    })
    expect(found.answered).toBe(2)
    expect(found.addrs).toHaveLength(2)
    expect(found.addrs.some((a) => a.includes('hub-1'))).toBe(true)
    expect(found.addrs.some((a) => a.includes('hub-2'))).toBe(true)
  })

  it('is deterministic in the order it returns addresses', async () => {
    const network = new MemoryNetwork()
    node(network, 'hub', () => ['z', 'a', 'm'])
    const seeker = node(network, 'seeker')
    const found = await findReservedPeers({ rpc: seeker, peers: () => ['hub'], self: 'seeker' })
    expect([...found.addrs]).toEqual([...found.addrs].sort())
  })
})

describe('one answer cannot decide how much work this node takes on', () => {
  it('mints at most the cap from a single peer, however long its answer', async () => {
    // The length of that list is the answering peer's choice, and every address
    // minted from it becomes a dial attempt costing a full timeout.
    const network = new MemoryNetwork()
    node(network, 'hub', () => holders(10_000))
    const seeker = node(network, 'seeker')

    const found = await findReservedPeers({ rpc: seeker, peers: () => ['hub'], self: 'seeker' })

    expect(found.answered).toBe(1)
    expect(found.addrs).toHaveLength(MAX_RESERVED_PEERS_PER_ANSWER)
    // The ones kept are the ones offered first, not an arbitrary subset.
    expect(found.addrs).toEqual(
      holders(MAX_RESERVED_PEERS_PER_ANSWER).map((h) => `/p2p/hub/p2p-circuit/webrtc/p2p/${h}`),
    )
  })

  it('bounds each answer separately, so a second hub still contributes', async () => {
    // The bound is per answer because the merge is the reason this module exists:
    // two nodes hold different populations, and one hub's flood must not spend the
    // budget the other hub's honest answer needs.
    const network = new MemoryNetwork()
    node(network, 'hub-1', () => holders(10_000, 'one'))
    node(network, 'hub-2', () => holders(10_000, 'two'))
    const seeker = node(network, 'seeker')

    const found = await findReservedPeers({
      rpc: seeker,
      peers: () => ['hub-1', 'hub-2'],
      self: 'seeker',
    })

    expect(found.addrs).toHaveLength(MAX_RESERVED_PEERS_PER_ANSWER * 2)
    expect(found.addrs.filter((a) => a.includes('hub-1'))).toHaveLength(MAX_RESERVED_PEERS_PER_ANSWER)
    expect(found.addrs.filter((a) => a.includes('hub-2'))).toHaveLength(MAX_RESERVED_PEERS_PER_ANSWER)
  })

  it('does not spend a slot on our own id coming back to us', async () => {
    const network = new MemoryNetwork()
    node(network, 'hub', () => ['seeker', ...holders(MAX_RESERVED_PEERS_PER_ANSWER)])
    const seeker = node(network, 'seeker')

    const found = await findReservedPeers({ rpc: seeker, peers: () => ['hub'], self: 'seeker' })
    expect(found.addrs).toHaveLength(MAX_RESERVED_PEERS_PER_ANSWER)
  })
})

describe('a node relaying for nobody is not a different kind of node', () => {
  it('answers with an empty list rather than an error', async () => {
    const network = new MemoryNetwork()
    node(network, 'quiet', () => [])
    const seeker = node(network, 'seeker')

    const found = await findReservedPeers({ rpc: seeker, peers: () => ['quiet'], self: 'seeker' })
    expect(found.answered).toBe(1)
    expect(found.addrs).toEqual([])
  })

  it('is indistinguishable from a node that holds no reservations at all', async () => {
    // Deliberate. A capability flag here would be a kind to branch on, and this
    // project's standing rule is that if a decision keys on what kind of node
    // something is, it is wrong.
    const network = new MemoryNetwork()
    node(network, 'no-thunk')
    node(network, 'empty-thunk', () => [])
    const seeker = node(network, 'seeker')

    const a = await findReservedPeers({ rpc: seeker, peers: () => ['no-thunk'], self: 'seeker' })
    const b = await findReservedPeers({ rpc: seeker, peers: () => ['empty-thunk'], self: 'seeker' })
    expect(a).toEqual(b)
  })

  it('counts a silent peer separately from one that answered with nothing', async () => {
    const network = new MemoryNetwork()
    node(network, 'quiet', () => [])
    const seeker = node(network, 'seeker')

    const answered = await findReservedPeers({ rpc: seeker, peers: () => ['quiet'], self: 'seeker' })
    const silent = await findReservedPeers({ rpc: seeker, peers: () => ['gone'], self: 'seeker' })
    expect(answered.addrs).toEqual(silent.addrs)
    expect(answered.answered).toBe(1)
    expect(silent.answered).toBe(0)
  })
})

/**
 * A node that relays and does not compute — `serveReservations` with nothing else installed.
 *
 * Deliberately NOT built through {@link node} above. That helper calls `serveAgent`, which
 * needs an executor and a blockstore, and a fixture that constructed those would be modelling
 * the tier this function exists to serve *without* them. The point of the whole exercise is
 * that this arrangement is reachable at all.
 */
function relayOnly(
  network: MemoryNetwork,
  id: string,
  reservations: (() => readonly string[]) | 'relays-for-nobody',
): RpcEndpoint {
  const rpc = new RpcEndpoint(network.connect(id), { timeoutMs: 500 })
  rpc.serve(serveReservations(reservations))
  return rpc
}

describe('a relay that does not compute still answers the rendezvous', () => {
  it('is found by the same `findReservedPeers` a full node is found by', async () => {
    // The defect, in one case. The deployed hosted relay served no `/o2/rpc/1.0.0` handler
    // at all, so this call answered `{answered: 0, addrs: []}` — a fabric whose one
    // always-reachable node could not introduce the tabs reserved on it.
    const network = new MemoryNetwork()
    relayOnly(network, 'hosted', () => ['tab-a', 'tab-b'])
    const seeker = node(network, 'seeker')

    const found = await findReservedPeers({ rpc: seeker, peers: () => ['hosted'], self: 'seeker' })

    expect(found.answered).toBe(1)
    expect(found.addrs).toEqual([
      '/p2p/hosted/p2p-circuit/webrtc/p2p/tab-a',
      '/p2p/hosted/p2p-circuit/webrtc/p2p/tab-b',
    ])
  })

  it('refuses every other request BY NAME, so a requestor learns rather than waits', async () => {
    const network = new MemoryNetwork()
    relayOnly(network, 'hosted', 'relays-for-nobody')
    const seeker = node(network, 'seeker')

    const answer = parseResponse(
      await seeker.request('hosted', encodeRequest({ kind: 'offer', shardId: 'shard-1' })),
    )

    // Not a dropped frame and not a timeout: NET-10's distinction is that a requestor can
    // tell refusal from silence. The kind is in the reason so the reading is actionable.
    expect(answer?.kind).toBe('error')
    expect(answer).toEqual({ kind: 'error', reason: 'this node serves reservations only, not offer' })
  })

  it('names a malformed frame as malformed rather than as a refused kind', async () => {
    const network = new MemoryNetwork()
    relayOnly(network, 'hosted', 'relays-for-nobody')
    const seeker = node(network, 'seeker')

    const answer = parseResponse(await seeker.request('hosted', { kind: 'not-a-request-kind' }))

    expect(answer).toEqual({ kind: 'error', reason: 'malformed request' })
  })

  it('answers an empty relay identically to one that cannot relay at all', async () => {
    // `protocol.ts:262-266` — there is no capability flag on this wire, because a flag would
    // be a kind to branch on. The two postures differ in the source and must not on the wire.
    const network = new MemoryNetwork()
    relayOnly(network, 'empty', () => [])
    relayOnly(network, 'never', 'relays-for-nobody')
    const seeker = node(network, 'seeker')

    const fromEmpty = parseResponse(await seeker.request('empty', encodeRequest({ kind: 'reservations' })))
    const fromNever = parseResponse(await seeker.request('never', encodeRequest({ kind: 'reservations' })))

    expect(fromEmpty).toEqual({ kind: 'reservations', peerIds: [] })
    expect(fromNever).toEqual(fromEmpty)
  })

  it('reads the store on every request, so an arrival between two asks is visible', async () => {
    // The same reason `FabricNode.reservedPeerIds` reads through `libp2p.services`: libp2p
    // declares a `relay:reservation` event and never dispatches it, so a value captured once
    // goes stale in exactly the long-lived process this runs in.
    const network = new MemoryNetwork()
    const held: string[] = []
    relayOnly(network, 'hosted', () => held)
    const seeker = node(network, 'seeker')

    const before = await findReservedPeers({ rpc: seeker, peers: () => ['hosted'], self: 'seeker' })
    held.push('tab-late')
    const after = await findReservedPeers({ rpc: seeker, peers: () => ['hosted'], self: 'seeker' })

    expect(before.addrs).toEqual([])
    expect(after.addrs).toEqual(['/p2p/hosted/p2p-circuit/webrtc/p2p/tab-late'])
  })

  it('answers what it holds, leaving the bound to the reader that has to trust it', async () => {
    // A hostile relay's bound is `MAX_RESERVED_PEERS_PER_ANSWER`, applied where the answer is
    // read. Capping here as well would bound this node's honesty about its own store, which
    // is a different property and not one worth having.
    const network = new MemoryNetwork()
    const many = holders(MAX_RESERVED_PEERS_PER_ANSWER + 5)
    relayOnly(network, 'hosted', () => many)
    const seeker = node(network, 'seeker')

    const raw = parseResponse(await seeker.request('hosted', encodeRequest({ kind: 'reservations' })))
    const found = await findReservedPeers({ rpc: seeker, peers: () => ['hosted'], self: 'seeker' })

    expect(raw).toEqual({ kind: 'reservations', peerIds: many })
    // 64 as a literal rather than as `MAX_RESERVED_PEERS_PER_ANSWER`: an assertion that
    // reused the value it tests would stay green if both sides moved together.
    expect(found.addrs).toHaveLength(64)
  })
})
