import { MemoryBlockstore, MemoryNetwork, encodeCanonical } from '@o2/core'
import { describe, expect, it } from 'vitest'
import { EgressGuard, EgressRefusal } from './egress.ts'
import type { EgressHold } from './egress.ts'
import { RpcEndpoint, RpcFailure } from './rpc.ts'

/**
 * DATA-04 / DATA-05 — nothing raw leaves, and the manifest proves it.
 *
 * The tap is on the owner node's only exit, so "complete by construction" is literal:
 * a frame that was not recorded was not sent, because recording happens inside
 * `send`. There is no second path to forget to instrument.
 *
 * A frame that matches a registered payload is refused, not annotated, so "nothing
 * raw leaves" is a property of the exit rather than a report written after the bytes
 * are gone. "Nothing arrived" is only worth asserting from an instrument shown able
 * to read something, so the delivery counter below is read twice in this file: 0 for
 * a refused frame, 1 for a legitimate one, on the same counter.
 */

/** A recognisable stand-in for a row of someone's private data. */
const SOVEREIGN_ROW = new TextEncoder().encode('SSN=078-05-1120;salary=91000')

/** The guard, plus the hold its own registration took — see {@link EgressHold}. */
interface OwnerNode {
  readonly guard: EgressGuard
  readonly rowHold: EgressHold
}

function ownerNode(network: MemoryNetwork, id: string): EgressGuard {
  return ownerNodeWithHold(network, id).guard
}

function ownerNodeWithHold(network: MemoryNetwork, id: string): OwnerNode {
  const guard = new EgressGuard(network.connect(id), 'alice')
  return { guard, rowHold: guard.guard('alice-row', SOVEREIGN_ROW) }
}

/**
 * The destination peer, plus a count of what actually arrived at it.
 *
 * These tests used to connect the coordinator and discard the handle. The handle is
 * the whole instrument: a refusal assertion that only reads the sender's own manifest
 * proves the sender's bookkeeping, not that the bytes stayed home.
 */
function coordinator(network: MemoryNetwork): { readonly delivered: () => number } {
  const transport = network.connect('coordinator')
  let count = 0
  transport.onMessage(() => {
    count += 1
  })
  return { delivered: () => count }
}

describe('DATA-05 — the manifest records everything that leaves', () => {
  it('counts every frame and its bytes', async () => {
    const network = new MemoryNetwork()
    const owner = ownerNode(network, 'alice-1')
    coordinator(network)

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
    coordinator(network)

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

describe('DATA-04 — a raw sovereign byte does not reach the wire at all', () => {
  it('refuses a frame that carries the raw row, and the peer never sees it', async () => {
    const network = new MemoryNetwork()
    const owner = ownerNode(network, 'alice-1')
    const peer = coordinator(network)

    // The failure this exists to catch: a map step that forgot to aggregate and
    // shipped its input.
    const leaked = encodeCanonical({ rows: [SOVEREIGN_ROW] })
    expect(leaked.ok).toBe(true)
    if (!leaked.ok) return
    const refusal = await owner.send('coordinator', leaked.bytes).then(
      () => null,
      (cause: unknown) => cause,
    )

    // Typed, so a caller branches on the value rather than on a message string.
    expect(refusal).toBeInstanceOf(EgressRefusal)
    expect((refusal as EgressRefusal).violation).toBe('alice-row')
    expect((refusal as EgressRefusal).to).toBe('coordinator')
    expect((refusal as EgressRefusal).bytes).toBe(leaked.bytes.byteLength)

    // Read off the instrument that reads 1 for the aggregate below. Without that
    // second reading this 0 would be indistinguishable from a counter nobody
    // connected.
    expect(peer.delivered()).toBe(0)

    const manifest = owner.manifest
    expect(manifest.violations).toEqual(['alice-row'])
    expect(manifest.entries).toHaveLength(1)
    expect(manifest.entries[0]?.violation).toBe('alice-row')
    // Nothing left, and something was nonetheless observed. A manifest whose only
    // frame was refused must never read like the manifest of a node that sent
    // nothing at all.
    expect(manifest.totalBytes).toBe(0)
  })

  it('passes an aggregate derived from the same data', async () => {
    const network = new MemoryNetwork()
    const owner = ownerNode(network, 'alice-1')
    const peer = coordinator(network)

    // Pushed-down aggregation: a count and a sum, no rows. This is what a
    // cross-owner job is supposed to emit.
    const aggregate = encodeCanonical({ count: 1, salaryTotal: 91000 })
    expect(aggregate.ok).toBe(true)
    if (!aggregate.ok) return
    await owner.send('coordinator', aggregate.bytes)

    // The positive control for the 0 above, on the same counter, in the same file:
    // the refusal is specific to the registered pattern, not a general failure of
    // the guard to forward anything.
    expect(peer.delivered()).toBe(1)
    expect(owner.manifest.violations).toEqual([])
    expect(owner.manifest.totalBytes).toBeGreaterThan(0)
  })

  it('refuses the row embedded in a larger frame', async () => {
    // A leak wrapped in an otherwise-legitimate message must not slip through.
    const network = new MemoryNetwork()
    const owner = ownerNode(network, 'alice-1')
    const peer = coordinator(network)

    const framed = new Uint8Array(SOVEREIGN_ROW.byteLength + 64)
    framed.set(SOVEREIGN_ROW, 40)
    await expect(owner.send('coordinator', framed)).rejects.toBeInstanceOf(EgressRefusal)

    expect(peer.delivered()).toBe(0)
    expect(owner.manifest.violations).toEqual(['alice-row'])
  })

  it('does not flag a frame that merely resembles the row', async () => {
    // A near-miss must stay clean, or the tap becomes noise and gets ignored.
    const network = new MemoryNetwork()
    const owner = ownerNode(network, 'alice-1')
    coordinator(network)

    const nearMiss = new Uint8Array(SOVEREIGN_ROW)
    nearMiss[nearMiss.length - 1] = (nearMiss[nearMiss.length - 1]! ^ 0x01) & 0xff
    await owner.send('coordinator', nearMiss)

    expect(owner.manifest.violations).toEqual([])
  })

  it('watches several guarded values at once and names which one it refused', async () => {
    const network = new MemoryNetwork()
    const owner = ownerNode(network, 'alice-1')
    const second = new TextEncoder().encode('dob=1970-01-01')
    owner.guard('alice-dob', second)
    coordinator(network)

    await expect(
      owner.send('coordinator', second as Uint8Array<ArrayBuffer>),
    ).rejects.toBeInstanceOf(EgressRefusal)
    expect(owner.manifest.violations).toEqual(['alice-dob'])
  })

  it('surfaces a refusal on the requesting leg as a named send failure, not a timeout', async () => {
    // The asymmetry `egress.ts` documents, exercised on the leg where it is
    // legible. `rpc.ts` turns a rejected `Transport.send` on an outbound request
    // into `RpcFailure{kind:'send-failed'}` immediately, so this caller learns the
    // violated label at once. On the responding leg `rpc.ts` swallows the failure
    // by documented design and the requester waits out its own timeout instead —
    // that leg is not legible, and nothing here claims it is.
    const network = new MemoryNetwork()
    const owner = ownerNode(network, 'alice-1')
    coordinator(network)

    const rpc = new RpcEndpoint(owner, { timeoutMs: 10_000 })
    try {
      const failure = await rpc.request('coordinator', { row: SOVEREIGN_ROW }).then(
        () => null,
        (cause: unknown) => cause,
      )
      expect(failure).toBeInstanceOf(RpcFailure)
      const detail = (failure as RpcFailure).detail
      // "Not a timeout" is asserted by *name*, not by the clock. `rpc.ts` gives the
      // two mechanisms two structurally different values — `{kind:'send-failed', to,
      // detail}` at `:213` against `{kind:'timeout', to, afterMs}` at `:188` — so a
      // reading of `send-failed` is not a timeout that happened to be quick; it is a
      // value the timeout path cannot construct. That is the whole of the title's
      // claim, and it is decided by the tag rather than by how long this took.
      //
      // There used to be an `elapsed < 1_000` here as well. It was removed rather
      // than re-sited, because it never discriminated anything: measured on
      // 2026-08-01, 24 Node samples (1-min load 10.9→11.9 on 8 cores) and 27 browser
      // samples across chromium/firefox/webkit (load 11.5→29.1) every one read
      // **0 or 1 ms** — `Date.now()`'s own resolution. A bound cannot be sited
      // between a population that is indistinguishable from zero and one that never
      // arrives; the only readings it could ever have separated were noise.
      expect(detail.kind).toBe('send-failed')
      if (detail.kind !== 'send-failed') return
      expect(detail.detail).toContain('alice-row')
    } finally {
      rpc.close()
    }
  })
})

describe('NET-10 — the pre-scan a caller holding a candidate frame can take', () => {
  it('violationIn names the label and records nothing, however often it is asked', async () => {
    const network = new MemoryNetwork()
    const owner = ownerNode(network, 'alice-1')
    coordinator(network)

    const leaked = encodeCanonical({ rows: [SOVEREIGN_ROW] })
    expect(leaked.ok).toBe(true)
    if (!leaked.ok) return

    for (let i = 0; i < 10; i++) expect(owner.violationIn(leaked.bytes)).toBe('alice-row')
    // A pure query. Ten asks and the tap's record is untouched — otherwise
    // `serveAgent` asking about a candidate reply would inflate the manifest with
    // an entry per question rather than per frame.
    expect(owner.manifest.entries).toEqual([])
    expect(owner.manifest.violations).toEqual([])

    const aggregate = encodeCanonical({ count: 1, salaryTotal: 91000 })
    expect(aggregate.ok).toBe(true)
    if (!aggregate.ok) return
    expect(owner.violationIn(aggregate.bytes)).toBeNull()
  })

  it('refuse records exactly one entry, indistinguishable from a send-time refusal', async () => {
    // Two guards, same registration, same frame: one refuses in advance, the other
    // is asked to send it. The entries must be the same object shape — same `to`,
    // same `bytes`, same `violation` — because a reader of the manifest cannot be
    // asked which code path produced a refusal.
    const network = new MemoryNetwork()
    const prescanned = ownerNode(network, 'alice-pre')
    const sent = ownerNode(network, 'alice-send')
    coordinator(network)

    const leaked = encodeCanonical({ rows: [SOVEREIGN_ROW] })
    expect(leaked.ok).toBe(true)
    if (!leaked.ok) return

    expect(prescanned.refuse('coordinator', leaked.bytes)).toBe('alice-row')
    await expect(sent.send('coordinator', leaked.bytes)).rejects.toBeInstanceOf(EgressRefusal)

    expect(prescanned.manifest.entries).toEqual(sent.manifest.entries)
    expect(prescanned.manifest.entries).toHaveLength(1)
    expect(prescanned.manifest.entries[0]?.violation).toBe('alice-row')
    expect(prescanned.manifest.entries[0]?.bytes).toBe(leaked.bytes.byteLength)
    // A refusal raises the count and contributes nothing to the volume — the same
    // rule `EgressManifest.totalBytes` states, reached by the new producer.
    expect(prescanned.manifest.totalBytes).toBe(0)
    expect(prescanned.manifest.violations).toEqual(['alice-row'])
  })

  it('refuse records nothing at all for a clean frame', async () => {
    // The half that would double-count. `send` records every frame because it is
    // the exit and must account for everything that crossed it; `refuse` is asked
    // about a frame that has not been offered to the exit yet and may never be, so
    // a clean answer must leave no trace or every reply would be counted twice.
    const network = new MemoryNetwork()
    const owner = ownerNode(network, 'alice-1')
    coordinator(network)

    const aggregate = encodeCanonical({ count: 1, salaryTotal: 91000 })
    expect(aggregate.ok).toBe(true)
    if (!aggregate.ok) return

    expect(owner.refuse('coordinator', aggregate.bytes)).toBeNull()
    expect(owner.manifest.entries).toHaveLength(0)

    await owner.send('coordinator', aggregate.bytes)
    expect(owner.manifest.entries).toHaveLength(1)
    expect(owner.manifest.totalBytes).toBe(aggregate.bytes.byteLength)
  })

  it('a refused candidate followed by a smaller clean frame reads as two entries', async () => {
    // This is the shape `serveAgent` produces: the candidate reply carried the row
    // and was refused, and a small named refusal went out in its place. Two
    // entries, one at zero bytes and one at its own count, is the honest reading —
    // a refusal happened *and* a frame then left.
    const network = new MemoryNetwork()
    const owner = ownerNode(network, 'alice-1')
    const peer = coordinator(network)

    const leaked = encodeCanonical({ rows: [SOVEREIGN_ROW] })
    const substitute = encodeCanonical({ ok: false, reason: 'egress refused: alice-row' })
    expect(leaked.ok && substitute.ok).toBe(true)
    if (!leaked.ok || !substitute.ok) return

    expect(owner.refuse('coordinator', leaked.bytes)).toBe('alice-row')
    await owner.send('coordinator', substitute.bytes)

    const manifest = owner.manifest
    expect(manifest.entries).toHaveLength(2)
    expect(manifest.violations).toEqual(['alice-row'])
    expect(manifest.totalBytes).toBe(substitute.bytes.byteLength)
    // The instrument that reads 0 for a refused frame elsewhere in this file reads
    // 1 here: the substitute really left.
    expect(peer.delivered()).toBe(1)
  })

  it('leaves send refusing on its own — the pre-scan is a fast path, not the guarantee', async () => {
    // Belt and braces. A caller that pre-scanned and then, for whatever reason,
    // handed the same frame to the exit anyway is still refused. Plan 13.1-03's
    // mutation plants against exactly this property from the other side.
    const network = new MemoryNetwork()
    const owner = ownerNode(network, 'alice-1')
    const peer = coordinator(network)

    const leaked = encodeCanonical({ rows: [SOVEREIGN_ROW] })
    expect(leaked.ok).toBe(true)
    if (!leaked.ok) return

    expect(owner.refuse('coordinator', leaked.bytes)).toBe('alice-row')
    await expect(owner.send('coordinator', leaked.bytes)).rejects.toBeInstanceOf(EgressRefusal)
    expect(peer.delivered()).toBe(0)
    expect(owner.manifest.entries).toHaveLength(2)
  })
})

describe('a registration has a lifetime, and the set can be read', () => {
  it('forgets a released payload, and the set reads empty afterwards', async () => {
    const network = new MemoryNetwork()
    const { guard: owner, rowHold } = ownerNodeWithHold(network, 'alice-1')
    const peer = coordinator(network)

    expect(owner.registrations).toEqual(['alice-row'])
    rowHold.release()
    expect(owner.registrations).toEqual([])

    // Forwarded, and read off the same counter that reads 0 for a refused frame.
    await owner.send('coordinator', SOVEREIGN_ROW as Uint8Array<ArrayBuffer>)
    expect(peer.delivered()).toBe(1)
    expect(owner.manifest.violations).toEqual([])
  })

  it('holds one label twice, so one dispatch finishing cannot unguard the other', async () => {
    // Two concurrent dispatches of the same input are two holds. This is the whole
    // reason release counts rather than deletes: the first to finish must leave the
    // second one's payload guarded, or a node serving two shards of one owner's row
    // unguards itself halfway through.
    const network = new MemoryNetwork()
    const { guard: owner, rowHold: first } = ownerNodeWithHold(network, 'alice-1')
    const peer = coordinator(network)
    const second = owner.guard('alice-row', SOVEREIGN_ROW)

    first.release()
    await expect(
      owner.send('coordinator', SOVEREIGN_ROW as Uint8Array<ArrayBuffer>),
    ).rejects.toBeInstanceOf(EgressRefusal)
    expect(peer.delivered()).toBe(0)
    expect(owner.registrations).toEqual(['alice-row'])

    second.release()
    expect(owner.registrations).toEqual([])
    await owner.send('coordinator', SOVEREIGN_ROW as Uint8Array<ArrayBuffer>)
    expect(peer.delivered()).toBe(1)
  })

  it('gives back one hold however many times one holder asks', () => {
    // What replaces "a release for a label it does not hold is a no-op". That was
    // the licence one exec used to strip another holder's guard under; the property
    // worth keeping is narrower and is about one holder, not one label: releasing
    // twice must not reach into somebody else's hold. `serveAgent` releases in a
    // `finally`, so it must also not throw.
    const network = new MemoryNetwork()
    const { guard: owner, rowHold: first } = ownerNodeWithHold(network, 'alice-1')
    const second = owner.guard('alice-row', SOVEREIGN_ROW)

    first.release()
    expect(() => {
      first.release()
    }).not.toThrow()
    // The second holder still has its hold — this is the assertion the old no-op
    // case could not make, and the defect it could not see.
    expect(owner.registrations).toEqual(['alice-row'])

    second.release()
    expect(owner.registrations).toEqual([])
    expect(() => {
      second.release()
    }).not.toThrow()
  })

  it('names what is still held, so a leak is reportable and not a bare number', () => {
    const network = new MemoryNetwork()
    const { guard: owner, rowHold } = ownerNodeWithHold(network, 'alice-1')
    owner.guard('alice-dob', new TextEncoder().encode('dob=1970-01-01'))

    expect([...owner.registrations].sort()).toEqual(['alice-dob', 'alice-row'])
    rowHold.release()
    expect(owner.registrations).toEqual(['alice-dob'])
  })
})

describe('the manifest is per job', () => {
  it('resets without losing the guarded set', async () => {
    const network = new MemoryNetwork()
    const owner = ownerNode(network, 'alice-1')
    coordinator(network)

    await owner.send('coordinator', new Uint8Array([1]))
    expect(owner.manifest.entries).toHaveLength(1)

    owner.reset()
    expect(owner.manifest.entries).toHaveLength(0)
    expect(owner.manifest.totalBytes).toBe(0)

    // Guarding survives, or the next job would run untapped.
    await expect(
      owner.send('coordinator', SOVEREIGN_ROW as Uint8Array<ArrayBuffer>),
    ).rejects.toBeInstanceOf(EgressRefusal)
    expect(owner.manifest.violations).toEqual(['alice-row'])
  })

  it('leaves the store untouched — this is a transport concern only', async () => {
    const store = new MemoryBlockstore()
    await store.put(SOVEREIGN_ROW as Uint8Array<ArrayBuffer>)
    expect(store.size).toBe(1)
  })
})
