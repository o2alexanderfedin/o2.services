import { MemoryBlockstore, MemoryNetwork, WasmExecutor } from '@o2/core'
import { describe, expect, it } from 'vitest'
import { encodeRequest, encodeResponse, parseRequest, parseResponse } from './protocol.ts'
import { RpcEndpoint } from './rpc.ts'
import { serveAgent } from './agent.ts'
import { findReservedPeers, MAX_RESERVED_PEERS_PER_ANSWER } from './rendezvous.ts'

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
    rpc,
    executor: new WasmExecutor({ nodeId: id, blockstore }),
    blockstore,
    egress: 'holds-no-registrations',
    authorize: 'serves-unauthenticated',
    index: 'serves-no-records',
    capacity: 'accepts-every-offer',
    ledger: 'keeps-no-ledger',
    reservations,
    onDispatch: 'reports-no-dispatch',
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
