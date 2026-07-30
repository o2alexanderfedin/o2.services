import { describe, expect, it } from 'vitest'
import { MemoryNetwork, TransportError } from './memory.ts'

const bytes = (...b: number[]): Uint8Array<ArrayBuffer> => new Uint8Array(b)

describe('MemoryNetwork — delivery', () => {
  it('delivers a message from one peer to another', async () => {
    const net = new MemoryNetwork()
    const a = net.connect('a')
    const b = net.connect('b')

    const seen: [string, number[]][] = []
    b.onMessage((from, msg) => seen.push([from, [...msg]]))

    await a.send('b', bytes(1, 2, 3))
    expect(seen).toEqual([['a', [1, 2, 3]]])
  })

  it('delivers to every registered handler on the recipient', async () => {
    const net = new MemoryNetwork()
    const a = net.connect('a')
    const b = net.connect('b')
    let count = 0
    b.onMessage(() => count++)
    b.onMessage(() => count++)
    await a.send('b', bytes(1))
    expect(count).toBe(2)
  })

  it('does not deliver a message back to its sender', async () => {
    const net = new MemoryNetwork()
    const a = net.connect('a')
    net.connect('b')
    let received = 0
    a.onMessage(() => received++)
    await a.send('b', bytes(1))
    expect(received).toBe(0)
  })

  it('stops delivering after the handler is unsubscribed', async () => {
    const net = new MemoryNetwork()
    const a = net.connect('a')
    const b = net.connect('b')
    let count = 0
    const off = b.onMessage(() => count++)
    await a.send('b', bytes(1))
    off()
    await a.send('b', bytes(2))
    expect(count).toBe(1)
  })

  it('counts delivered messages', async () => {
    const net = new MemoryNetwork()
    const a = net.connect('a')
    net.connect('b')
    net.connect('c')
    await a.send('b', bytes(1))
    await a.send('c', bytes(2))
    expect(net.delivered).toBe(2)
  })
})

describe('MemoryNetwork — a peer answers in the namespace it was dialled by', () => {
  // The `Transport` port requires `from` and `to` to be one namespace spelled
  // identically, because `RpcEndpoint` correlates a reply against the peer its
  // request went to by comparing those two strings. The loopback satisfies it
  // trivially, which is exactly why it is worth pinning: an adapter that satisfies a
  // precondition by accident is one refactor away from not satisfying it, and the
  // failure mode is a total outage that reads as a broken network rather than as a
  // spelling bug.
  it('hands the initiator a `from` byte-identical to the `to` it addressed', async () => {
    const net = new MemoryNetwork()
    const initiator = net.connect('12D3KooWInitiator')
    const responder = net.connect('12D3KooWResponder')

    // The responder answers using only what it was handed — all `RpcEndpoint` has.
    const answered: string[] = []
    responder.onMessage((from) => {
      answered.push(from)
      void responder.send(from, bytes(2)).catch(() => {})
    })
    const seen: string[] = []
    initiator.onMessage((from) => seen.push(from))

    const to = responder.localId
    await initiator.send(to, bytes(1))

    expect(answered).toEqual([initiator.localId])
    expect(seen).toEqual([to])
  })
})

describe('MemoryNetwork — the loopback must not be more permissive than a network', () => {
  it('hands the recipient a copy, not a view into the sender’s buffer', async () => {
    // A real transport serializes. If the loopback passed the sender's buffer
    // through, code that mutated a message after sending would pass here and fail
    // over a real transport — the adapter would be hiding a bug.
    const net = new MemoryNetwork()
    const a = net.connect('a')
    const b = net.connect('b')

    const received: Uint8Array[] = []
    b.onMessage((_from, msg) => received.push(msg))

    const payload = bytes(1, 2, 3)
    await a.send('b', payload)
    payload[0] = 99

    expect([...(received[0] as Uint8Array)]).toEqual([1, 2, 3])
  })

  it('gives each of several recipients an independent copy', async () => {
    const net = new MemoryNetwork()
    const a = net.connect('a')
    const b = net.connect('b')
    const c = net.connect('c')
    const got: Uint8Array[] = []
    b.onMessage((_f, m) => got.push(m))
    c.onMessage((_f, m) => got.push(m))
    await a.send('b', bytes(7))
    await a.send('c', bytes(7))
    expect(got).toHaveLength(2)
    expect(got[0]).not.toBe(got[1])
  })
})

describe('MemoryNetwork — peer topology', () => {
  it('lists peers excluding itself', () => {
    const net = new MemoryNetwork()
    const a = net.connect('a')
    net.connect('b')
    net.connect('c')
    expect([...a.peers].sort()).toEqual(['b', 'c'])
  })

  it('refuses to connect the same peer id twice', () => {
    const net = new MemoryNetwork()
    net.connect('a')
    expect(() => net.connect('a')).toThrow(/already connected/)
  })

  it('scales to 100 peers in one process', async () => {
    const net = new MemoryNetwork()
    const nodes = Array.from({ length: 100 }, (_, i) => net.connect(`n${i}`))
    let received = 0
    for (const n of nodes) n.onMessage(() => received++)
    const first = nodes[0]
    if (first === undefined) throw new Error('no nodes')
    for (let i = 1; i < 100; i++) await first.send(`n${i}`, bytes(i & 0xff))
    expect(received).toBe(99)
    expect(net.delivered).toBe(99)
  })
})

describe('MemoryNetwork — failure paths for the churn phase', () => {
  it('reports an unknown peer', async () => {
    const net = new MemoryNetwork()
    const a = net.connect('a')
    await expect(a.send('nobody', bytes(1))).rejects.toThrow(TransportError)
  })

  it('reports a partitioned peer as unreachable, distinctly from unknown', async () => {
    const net = new MemoryNetwork()
    const a = net.connect('a')
    net.connect('b')
    net.partition('b')
    // The distinction matters: a node that exists but cannot be reached should be
    // retried, while an unknown peer should be re-discovered.
    await expect(a.send('b', bytes(1))).rejects.toMatchObject({
      detail: { kind: 'peer-unreachable', to: 'b' },
    })
  })

  it('resumes delivery after healing a partition', async () => {
    const net = new MemoryNetwork()
    const a = net.connect('a')
    const b = net.connect('b')
    let count = 0
    b.onMessage(() => count++)
    net.partition('b')
    await expect(a.send('b', bytes(1))).rejects.toThrow()
    net.heal('b')
    await a.send('b', bytes(2))
    expect(count).toBe(1)
  })

  it('reports a disconnected peer as unknown rather than unreachable', async () => {
    const net = new MemoryNetwork()
    const a = net.connect('a')
    net.connect('b')
    net.disconnect('b')
    await expect(a.send('b', bytes(1))).rejects.toMatchObject({
      detail: { kind: 'unknown-peer', to: 'b' },
    })
    expect(a.peers).toEqual([])
  })
})
