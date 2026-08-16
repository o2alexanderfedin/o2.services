import { afterEach, describe, expect, it } from 'vitest'
import { BrowserNode } from './browser-node.ts'
// Vite's `?worker` suffix bundles the module and its imports into a real Worker.
// Browser project only — see vitest.config.ts.
import TaskExecutorWorker from './task-executor.worker.ts?worker'

/**
 * A `BrowserNode.start` that rejects must leave the tab as it was found — BROW-02.
 *
 * The Node twin (`packages/node/src/start-unwind.node.test.ts`) reads a bound port,
 * because that is the one thing `FabricNode.start` can strand that the caller has no
 * handle to close. A tab has no ports, so this file reads the two things *this*
 * factory can strand instead, and reads them from outside the node:
 *
 *   - an **IndexedDB connection**. `indexedDB.deleteDatabase` fires `blocked` while a
 *     connection is open and `success` once none is, so "did `store.close()` run" is
 *     directly observable with no handle to the store.
 *   - a **live libp2p**. Its `ConnectionMonitor` arms one `setInterval` heartbeat on
 *     `start()` and clears it on `stop()`, so a count of intervals created during the
 *     window and never cleared says whether the node is still running. Measured, not
 *     assumed: exactly 1 while up and 0 after `stop()`, identically in Chromium,
 *     Firefox and WebKit.
 *   - a **`visibilitychange` listener** on `document`, which `VisibilityGovernor`
 *     takes in its constructor and gives back only in `stop()`.
 *
 * Each probe is shown reading *both* states first. An absence assertion whose
 * instrument never detects a presence is worth nothing, and this repository has
 * shipped exactly that failure once already.
 *
 * Browser-only: real `indexedDB`, real WebSocket dials, a real `document`.
 */

const started: BrowserNode[] = []
let seq = 0

afterEach(async () => {
  await Promise.all(
    started.splice(0).map(async (node) => {
      try {
        await node.stop()
      } catch {
        // A node that already failed is not worth failing teardown over.
      }
    }),
  )
})

const createWorker = (): Worker => new TaskExecutorWorker()

/**
 * Reachable by nobody: a closed loopback port, named with a well-formed peer id.
 *
 * `/ws` rather than `/tcp` alone because a browser can only dial WebSockets, and
 * `allowPrivateAddrs` because libp2p's default gater refuses loopback in a page — a
 * refusal would throw too, but from the gater rather than from a real dial.
 */
const UNREACHABLE_RELAY =
  '/ip4/127.0.0.1/tcp/49999/ws/p2p/12D3KooWHPSVMPEezVCXvka2ahwT26JGL8EBr61LpGEU3ujHQM9Q'

/**
 * Whether a connection to `name` is still open — i.e. `store.close()` never ran.
 *
 * Reads whether the delete *stays* blocked rather than whether `blocked` ever fired,
 * and the difference is not pedantry. **Measured on all three engines:** in WebKit
 * `IDBDatabase.close()` takes effect a turn later, so a delete issued on the very
 * next line fires `blocked` and then succeeds ~100 ms afterwards; Chromium and
 * Firefox never fire it at all. Sampling the first event would therefore have
 * reported a closed store as leaked, in one engine only — the exact shape of failure
 * the three-engine matrix exists to catch, and it caught it here.
 *
 * A genuinely stranded connection has nothing left that will ever close it, so a
 * delete blocked on one stays blocked forever and the grace period below expires.
 */
async function deleteIsBlocked(name: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const request = indexedDB.deleteDatabase(name)
    let sawBlocked = false
    request.onblocked = () => {
      sawBlocked = true
    }
    request.onsuccess = () => resolve(false)
    request.onerror = () => resolve(false)
    setTimeout(() => resolve(sawBlocked), 500)
  })
}

/** What a probe reads about the tab, once the window it watched has closed. */
interface Leaks {
  /** Intervals armed during the window and never cleared — libp2p's heartbeat. */
  readonly intervals: number
  /** `visibilitychange` listeners added during the window and never removed. */
  readonly visibilityListeners: number
}

/**
 * Run `body` while counting the timers and document listeners it leaves behind.
 *
 * Patches two platform APIs rather than reaching inside the node, for the same reason
 * the Node twin binds a real socket instead of reading `process._getActiveHandles()`:
 * a rejected `start` hands its caller no object to interrogate, so the reading has to
 * come from the platform the resources live on. Neither patch changes any behaviour —
 * both delegate — and both are restored before anything is asserted.
 */
async function measuringLeaks<T>(body: () => Promise<T>): Promise<{ result: T; leaks: Leaks }> {
  const realSet = globalThis.setInterval
  const realClear = globalThis.clearInterval
  const realClearTimeout = globalThis.clearTimeout
  const realAdd = document.addEventListener.bind(document)
  const realRemove = document.removeEventListener.bind(document)
  const intervals = new Set<unknown>()
  const listeners = new Set<unknown>()

  globalThis.setInterval = ((...args: Parameters<typeof realSet>) => {
    const id = realSet(...args)
    intervals.add(id)
    return id
  }) as typeof realSet
  globalThis.clearInterval = ((id?: Parameters<typeof realClear>[0]) => {
    intervals.delete(id)
    realClear(id)
  }) as typeof realClear
  // `clearTimeout` counts as clearing an interval, and this half was missing until
  // 2026-08-15. `setTimeout` and `setInterval` share ONE map of active timers in the HTML
  // spec, so either clear method cancels either kind — and `@libp2p/kad-dht`'s
  // `ClosestPeers` does exactly that: `setInterval` at `routing-table/closest-peers.ts:72`,
  // `clearTimeout(this.timeout)` at `:83`. Without this hook the probe watched the arm and
  // missed the disarm, and reported a timer that had genuinely stopped as a leak.
  //
  // **Verified rather than taken from the spec**: in Chromium 151, `setInterval(fn, 10)`
  // followed by `clearTimeout(id)` produced 0 ticks over 120 ms.
  //
  // This does not weaken the guard. A timer nobody cleared is still counted; what changed
  // is that a timer cleared through the other name is no longer miscounted as uncleared.
  globalThis.clearTimeout = ((id?: Parameters<typeof realClearTimeout>[0]) => {
    intervals.delete(id)
    realClearTimeout(id)
  }) as typeof realClearTimeout
  document.addEventListener = ((type: string, listener: unknown, options?: unknown) => {
    if (type === 'visibilitychange') listeners.add(listener)
    realAdd(type as 'visibilitychange', listener as EventListener, options as boolean)
  }) as typeof document.addEventListener
  document.removeEventListener = ((type: string, listener: unknown, options?: unknown) => {
    if (type === 'visibilitychange') listeners.delete(listener)
    realRemove(type as 'visibilitychange', listener as EventListener, options as boolean)
  }) as typeof document.removeEventListener

  try {
    const result = await body()
    return { result, leaks: { intervals: intervals.size, visibilityListeners: listeners.size } }
  } finally {
    globalThis.setInterval = realSet
    globalThis.clearInterval = realClear
    globalThis.clearTimeout = realClearTimeout
    document.addEventListener = realAdd
    document.removeEventListener = realRemove
  }
}

/**
 * DET-03, stated once for all five construction sites below.
 *
 * The exact twin of `start-unwind.node.test.ts`'s `UNWIND_ANCHORS`, and for the same
 * reason: this file's subject is which listeners and connections survive a rejected
 * start. No node here ever executes a task — most never finish starting — so provenance
 * decides nothing. Stated rather than defaulted, which is the whole point of
 * `trustAnchors` being required: a reader counting this literal learns which tests do
 * not exercise the signed path. Named once so five sites cannot drift apart.
 */
const UNWIND_ANCHORS = 'runs-unsigned-artifacts' as const

/** Start, and hand back whatever came out — the node or the reason there is none. */
async function attempt(
  options: Omit<Parameters<typeof BrowserNode.start>[0], 'createWorker'>,
): Promise<BrowserNode | unknown> {
  return BrowserNode.start({ ...options, createWorker }).then(
    (node) => {
      started.push(node)
      return node
    },
    (cause: unknown) => cause,
  )
}

describe('the probes read both states, so an absence below means something', () => {
  it('reads a running node as holding a connection, a heartbeat and a listener — and a stopped one as holding none', async () => {
    const name = `o2-unwind-live-${seq++}`
    const readings = await measuringLeaks(async () => {
      const node = await BrowserNode.start({ relayAddrs: [], createWorker, blockstoreName: name, trustAnchors: UNWIND_ANCHORS, whenSeedIsGone: 'mints-a-new-identity', startReporting: 'reports-its-own-start' })
      started.push(node)
      const whileUp = {
        blocked: await deleteIsBlocked(name),
        // Read through the probe's own counters by closing the window twice would be
        // circular, so the live readings are taken here and the leak readings below.
      }
      await node.stop()
      started.pop()
      return whileUp
    })

    // Present while the node is up.
    expect(readings.result.blocked).toBe(true)
    // And gone once it is stopped, which is what makes the absences below meaningful.
    expect(readings.leaks).toEqual({ intervals: 0, visibilityListeners: 0 })
    expect(await deleteIsBlocked(name)).toBe(false)
  }, 60_000)

  it('reads a node that was never stopped as still holding all three', async () => {
    // The positive control for the leak counters specifically. Without it, the zeroes
    // asserted below could mean "nothing was released" just as easily as "nothing
    // was taken" — the probe would agree with a `#compose` that never ran.
    const name = `o2-unwind-leaky-${seq++}`
    const { result: node, leaks } = await measuringLeaks(async () => {
      const live = await BrowserNode.start({ relayAddrs: [], createWorker, blockstoreName: name, trustAnchors: UNWIND_ANCHORS, whenSeedIsGone: 'mints-a-new-identity', startReporting: 'reports-its-own-start' })
      started.push(live)
      return live
    })

    expect(leaks.intervals).toBeGreaterThan(0)
    expect(leaks.visibilityListeners).toBeGreaterThan(0)
    expect(await deleteIsBlocked(name)).toBe(true)
    await node.stop()
    started.pop()
  }, 60_000)
})

describe('a rejected start leaves nothing behind', () => {
  it('closes the blockstore and stops libp2p when a relay dial fails', async () => {
    const name = `o2-unwind-dial-${seq++}`
    const { result: failure, leaks } = await measuringLeaks(
      async () =>
        await attempt({ relayAddrs: [UNREACHABLE_RELAY], blockstoreName: name, allowPrivateAddrs: true, trustAnchors: UNWIND_ANCHORS, whenSeedIsGone: 'mints-a-new-identity', startReporting: 'reports-its-own-start' }),
    )

    // Not `toBeInstanceOf(Error)`: measured in all three engines, a WebSocket dial to a
    // closed port rejects `libp2p.dial` with the raw error `Event`, not an `Error`. The
    // Node twin can assert the stronger thing; a tab cannot, and saying so is the point.
    expect(failure).not.toBeInstanceOf(BrowserNode)
    expect(failure).toBeDefined()
    // The two releases `#compose` pushed, read from outside: the store was closed and
    // libp2p was stopped. A `start` whose catch never ran passes neither.
    expect(await deleteIsBlocked(name)).toBe(false)
    expect(leaks.intervals).toBe(0)
  }, 60_000)

  it('does not accumulate a second node when start is driven again', async () => {
    // `demo/main.ts` catches a rejected start and lets the visitor press the button
    // again, so this is the shape the leak would actually take: not one stranded node
    // but one per attempt, for as long as the relay stays down.
    const name = `o2-unwind-retry-${seq++}`
    const { leaks } = await measuringLeaks(async () => {
      for (let i = 0; i < 3; i += 1) {
        const outcome = await attempt({
          relayAddrs: [UNREACHABLE_RELAY],
          blockstoreName: name,
          allowPrivateAddrs: true,
          trustAnchors: UNWIND_ANCHORS,
          whenSeedIsGone: 'mints-a-new-identity',
          startReporting: 'reports-its-own-start',
        })
        expect(outcome).not.toBeInstanceOf(BrowserNode)
      }
    })

    expect(leaks.intervals).toBe(0)
    expect(await deleteIsBlocked(name)).toBe(false)
  }, 60_000)

  it('unwinds a failure raised after the governor is built, and tells the caller why', async () => {
    // The path the dial cases cannot reach. `LocalCapacity`'s constructor refuses
    // anything below one slot and runs last of all, so this is the only case that gets
    // past `VisibilityGovernor` — which takes a `document` listener in its constructor
    // and gives it back only in `stop()`. Kept as its own case because that release is
    // the newest of the three and is therefore the first thing a broken unwind drops.
    const name = `o2-unwind-late-${seq++}`
    const { result: failure, leaks } = await measuringLeaks(
      async () => await attempt({ relayAddrs: [], blockstoreName: name, maxConcurrentTasks: 0, trustAnchors: UNWIND_ANCHORS, whenSeedIsGone: 'mints-a-new-identity', startReporting: 'reports-its-own-start' }),
    )

    // The caller is told what it asked about. An unwind that replaced this with its own
    // shutdown error would leave a page that cannot say why its node would not start.
    expect(failure).toBeInstanceOf(RangeError)
    expect(await deleteIsBlocked(name)).toBe(false)
    expect(leaks).toEqual({ intervals: 0, visibilityListeners: 0 })
  }, 60_000)
})
