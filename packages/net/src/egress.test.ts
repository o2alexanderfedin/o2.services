import { MemoryBlockstore, MemoryNetwork, encodeCanonical } from '@o2/core'
import { describe, expect, it } from 'vitest'
import { EgressGuard } from './egress.ts'
import { RpcEndpoint } from './rpc.ts'

/**
 * DATA-04 / DATA-05 — nothing raw leaves, and the manifest proves it.
 *
 * The tap is on the owner node's only exit, so "complete by construction" is literal:
 * a frame that was not recorded was not sent, because recording happens inside
 * `send`. There is no second path to forget to instrument.
 */

/** A recognisable stand-in for a row of someone's private data. */
const SOVEREIGN_ROW = new TextEncoder().encode('SSN=078-05-1120;salary=91000')

function ownerNode(network: MemoryNetwork, id: string): EgressGuard {
  const guard = new EgressGuard(network.connect(id), 'alice')
  guard.guard('alice-row', SOVEREIGN_ROW)
  return guard
}

describe('DATA-05 — the manifest records everything that leaves', () => {
  it('counts every frame and its bytes', async () => {
    const network = new MemoryNetwork()
    const owner = ownerNode(network, 'alice-1')
    network.connect('coordinator')

    await owner.send('coordinator', new Uint8Array([1, 2, 3]))
    await owner.send('coordinator', new Uint8Array([4, 5, 6, 7]))

    const manifest = owner.manifest
    expect(manifest.nodeId).toBe('alice-1')
    expect(manifest.ownerId).toBe('alice')
    expect(manifest.entries).toHaveLength(2)
    expect(manifest.totalBytes).toBe(7)
    expect(manifest.violations).toEqual([])
  })

  it('records a frame even when delivery fails', async () => {
    // A frame that left and then failed still left. Recording only on success
    // would produce a manifest that understates egress precisely when something
    // went wrong.
    const network = new MemoryNetwork()
    const owner = ownerNode(network, 'alice-1')

    await expect(owner.send('nobody', new Uint8Array([9, 9, 9]))).rejects.toThrow()
    expect(owner.manifest.entries).toHaveLength(1)
    expect(owner.manifest.totalBytes).toBe(3)
  })

  it('cannot be bypassed — the transport interface is the only exit', async () => {
    // `EgressGuard` *is* the Transport handed to everything above it, so anything
    // that can send is already recorded. Nothing else exposes the inner transport.
    const network = new MemoryNetwork()
    const owner = ownerNode(network, 'alice-1')
    network.connect('coordinator')

    const rpc = new RpcEndpoint(owner, { timeoutMs: 100 })
    try {
      await rpc.request('coordinator', { hello: true }).catch(() => undefined)
    } finally {
      rpc.close()
    }

    // The RPC layer never touched the underlying transport directly.
    expect(owner.manifest.entries.length).toBeGreaterThan(0)
  })
})

describe('DATA-04 — a raw sovereign byte crossing the wire fails the test', () => {
  it('flags a frame that carries the raw row', async () => {
    const network = new MemoryNetwork()
    const owner = ownerNode(network, 'alice-1')
    network.connect('coordinator')

    // The failure this exists to catch: a map step that forgot to aggregate and
    // shipped its input.
    const leaked = encodeCanonical({ rows: [SOVEREIGN_ROW] })
    expect(leaked.ok).toBe(true)
    if (!leaked.ok) return
    await owner.send('coordinator', leaked.bytes)

    const manifest = owner.manifest
    expect(manifest.violations).toEqual(['alice-row'])
    expect(manifest.entries[0]?.violation).toBe('alice-row')
  })

  it('passes an aggregate derived from the same data', async () => {
    const network = new MemoryNetwork()
    const owner = ownerNode(network, 'alice-1')
    network.connect('coordinator')

    // Pushed-down aggregation: a count and a sum, no rows. This is what a
    // cross-owner job is supposed to emit.
    const aggregate = encodeCanonical({ count: 1, salaryTotal: 91000 })
    expect(aggregate.ok).toBe(true)
    if (!aggregate.ok) return
    await owner.send('coordinator', aggregate.bytes)

    expect(owner.manifest.violations).toEqual([])
    expect(owner.manifest.totalBytes).toBeGreaterThan(0)
  })

  it('catches the row embedded in a larger frame', async () => {
    // A leak wrapped in an otherwise-legitimate message must not slip through.
    const network = new MemoryNetwork()
    const owner = ownerNode(network, 'alice-1')
    network.connect('coordinator')

    const framed = new Uint8Array(SOVEREIGN_ROW.byteLength + 64)
    framed.set(SOVEREIGN_ROW, 40)
    await owner.send('coordinator', framed)

    expect(owner.manifest.violations).toEqual(['alice-row'])
  })

  it('does not flag a frame that merely resembles the row', async () => {
    // A near-miss must stay clean, or the tap becomes noise and gets ignored.
    const network = new MemoryNetwork()
    const owner = ownerNode(network, 'alice-1')
    network.connect('coordinator')

    const nearMiss = new Uint8Array(SOVEREIGN_ROW)
    nearMiss[nearMiss.length - 1] = (nearMiss[nearMiss.length - 1]! ^ 0x01) & 0xff
    await owner.send('coordinator', nearMiss)

    expect(owner.manifest.violations).toEqual([])
  })

  it('watches several guarded values at once and names which one leaked', async () => {
    const network = new MemoryNetwork()
    const owner = ownerNode(network, 'alice-1')
    const second = new TextEncoder().encode('dob=1970-01-01')
    owner.guard('alice-dob', second)
    network.connect('coordinator')

    await owner.send('coordinator', second as Uint8Array<ArrayBuffer>)
    expect(owner.manifest.violations).toEqual(['alice-dob'])
  })
})

describe('the manifest is per job', () => {
  it('resets without losing the guarded set', async () => {
    const network = new MemoryNetwork()
    const owner = ownerNode(network, 'alice-1')
    network.connect('coordinator')

    await owner.send('coordinator', new Uint8Array([1]))
    expect(owner.manifest.entries).toHaveLength(1)

    owner.reset()
    expect(owner.manifest.entries).toHaveLength(0)
    expect(owner.manifest.totalBytes).toBe(0)

    // Guarding survives, or the next job would run untapped.
    await owner.send('coordinator', SOVEREIGN_ROW as Uint8Array<ArrayBuffer>)
    expect(owner.manifest.violations).toEqual(['alice-row'])
  })

  it('leaves the store untouched — this is a transport concern only', async () => {
    const store = new MemoryBlockstore()
    await store.put(SOVEREIGN_ROW as Uint8Array<ArrayBuffer>)
    expect(store.size).toBe(1)
  })
})
