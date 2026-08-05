import { mkdtempSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { FabricNode } from './fabric-node.ts'
import { SeedServer } from './seed-server.ts'

/**
 * A `start` that rejects must leave nothing behind — and a bound socket is the one
 * thing it can leave that the caller has no handle to close.
 *
 * The instrument is a port, not a process handle. `FabricNode.start` binds a real
 * listener before any of the steps that can fail, so "is that port still taken" is
 * directly observable from outside the node, needs no `process._getActiveHandles()`
 * internals, and reads the same on every platform. The first case below is there to
 * prove the probe can say *both* things: an absence assertion whose instrument never
 * detects a presence is worth nothing, and this repository has shipped exactly that
 * failure once already.
 *
 * Node-only: real sockets.
 */

const started: FabricNode[] = []

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

/**
 * A port nothing is listening on right now. Bound, read, released.
 *
 * `host` has to match the address the node under test binds. On BSD — macOS
 * included — `SO_REUSEADDR` lets a probe on `127.0.0.1` take a port that a live
 * listener holds on `0.0.0.0`, so a mismatched host reports "free" while something
 * is very much serving. Measured: the seed case below read green that way before the
 * host was threaded through.
 */
async function freePort(host = '127.0.0.1'): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const probe = createServer()
    probe.once('error', reject)
    probe.listen(0, host, () => {
      const address = probe.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      probe.close(() => {
        resolve(port)
      })
    })
  })
}

/**
 * Whether a fresh listener can take `port` on `host` — i.e. nothing is still bound.
 *
 * A listening socket cannot be re-bound on the same address: Node sets
 * `SO_REUSEADDR` (which permits re-binding a port in `TIME_WAIT`) and not
 * `SO_REUSEPORT` (which would permit two live listeners), so `EADDRINUSE` here means
 * something is genuinely still serving.
 */
async function isFree(port: number, host = '127.0.0.1'): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const probe = createServer()
    probe.once('error', () => {
      resolve(false)
    })
    probe.listen(port, host, () => {
      probe.close(() => {
        resolve(true)
      })
    })
  })
}

/** Reachable by nobody: port 1 on loopback, named with a well-formed peer id. */
const UNREACHABLE_PEER =
  '/ip4/127.0.0.1/tcp/1/p2p/12D3KooWHPSVMPEezVCXvka2ahwT26JGL8EBr61LpGEU3ujHQM9Q'

/**
 * An enrollment nobody will answer — the async, post-bind failure this file needs.
 *
 * **This used to be an unreachable `relayAddrs`, and the swap is a behaviour change
 * elsewhere rather than a preference here.** Plan 18-11 made the relay dial NON-FATAL:
 * NET-05's position is that a node which could not get into one relay can still work, and
 * killing it would be worse than the silence the requirement exists to replace. So an
 * unreachable relay no longer rejects `start`, and this file needed a different trigger.
 *
 * `resolveCertificate` dials the provider and throws when it cannot be reached, which puts
 * the failure in the same place the relay dial used to occupy: after `createLibp2p` has
 * bound a real listener, and asynchronously. That placement is the whole reason these
 * cases are not merged into the `maxConcurrentTasks: 0` one below — **a synchronous
 * constructor throw and a failed network round trip unwind through different code**, and a
 * file that covered only the first would say it covered both.
 */
const UNANSWERED_ENROLLMENT = {
  userPrivateKey: new Uint8Array(32).fill(0x77),
  operatorId: 'start-unwind',
  providerAddr: UNREACHABLE_PEER,
} as const

/**
 * DET-03, stated once for all seven construction sites below.
 *
 * This file's subject is which listeners survive a rejected start. No node here ever
 * executes a task — most of them never finish starting — so provenance decides nothing.
 * Stated rather than defaulted, which is the whole point of `trustAnchors` being
 * required: a reader counting this literal learns which tests do not exercise the
 * signed path. Named once so seven sites cannot drift apart.
 */
const UNWIND_ANCHORS = 'runs-unsigned-artifacts' as const

describe('the port probe reads both states, so an absence below means something', () => {
  it('says a started node holds its port and a stopped one has given it back', async () => {
    const port = await freePort()
    expect(await isFree(port)).toBe(true)

    const node = await FabricNode.start({ listen: [`/ip4/127.0.0.1/tcp/${port}`], trustAnchors: UNWIND_ANCHORS })
    expect(await isFree(port)).toBe(false)

    await node.stop()
    expect(await isFree(port)).toBe(true)
  }, 60_000)
})

describe('a rejected start leaves nothing listening', () => {
  it('gives the port back when a provider dial fails', async () => {
    const port = await freePort()

    const failure = await FabricNode.start({
      listen: [`/ip4/127.0.0.1/tcp/${port}`],
      enrollment: UNANSWERED_ENROLLMENT,
      trustAnchors: UNWIND_ANCHORS,
    }).then(
      (node) => {
        started.push(node)
        return null
      },
      (cause: unknown) => cause,
    )

    expect(failure).toBeInstanceOf(Error)
    expect(await isFree(port)).toBe(true)
  }, 60_000)

  it('does not accumulate a second node when start is driven again', async () => {
    const port = await freePort()
    const attempt = async (): Promise<unknown> =>
      await FabricNode.start({
        listen: [`/ip4/127.0.0.1/tcp/${port}`],
        enrollment: UNANSWERED_ENROLLMENT,
        trustAnchors: UNWIND_ANCHORS,
      }).then(
        (node) => {
          started.push(node)
          return null
        },
        (cause: unknown) => cause,
      )

    expect(await attempt()).toBeInstanceOf(Error)
    // The second attempt binding the same port at all is itself the reading: a first
    // attempt that had leaked its listener would make this one fail with EADDRINUSE,
    // which is a different error and a different reason.
    const second = await attempt()
    expect(second).toBeInstanceOf(Error)
    expect(String(second)).not.toContain('EADDRINUSE')
    expect(await isFree(port)).toBe(true)
  }, 60_000)

  it('gives the port back when a later argument check throws, and tells the caller why', async () => {
    const port = await freePort()

    // The path the one narrow `try`/`catch` in this factory used to cover on its own:
    // `LocalCapacity`'s constructor refuses anything below one slot, and it runs after
    // `createLibp2p` has bound. Kept as a case because the wider unwind subsumed that
    // catch, and a subsumption nobody checks is a deletion.
    const failure = await FabricNode.start({
      listen: [`/ip4/127.0.0.1/tcp/${port}`],
      maxConcurrentTasks: 0,
      trustAnchors: UNWIND_ANCHORS,
    }).then(
      (node) => {
        started.push(node)
        return null
      },
      (cause: unknown) => cause,
    )

    expect(failure).toBeInstanceOf(RangeError)
    expect(await isFree(port)).toBe(true)
  }, 60_000)

  it('reports the failure that happened, not something the unwind ran into', async () => {
    const port = await freePort()

    const failure = await FabricNode.start({
      listen: [`/ip4/127.0.0.1/tcp/${port}`],
      enrollment: UNANSWERED_ENROLLMENT,
      trustAnchors: UNWIND_ANCHORS,
    }).then(
      (node) => {
        started.push(node)
        return null
      },
      (cause: unknown) => cause,
    )

    // The caller is told about the dial it asked for. An unwind that replaced this
    // with its own shutdown error would leave a node whose start failed and whose
    // operator has no idea which peer was unreachable.
    expect(String(failure)).toMatch(/ECONNREFUSED|connect|dial|unreachable/i)
    // And it names the address, so the operator knows WHICH line was wrong.
    expect(String(failure)).toContain(UNREACHABLE_PEER)
  }, 60_000)
})

/**
 * The same defect one composition up, and it leaks more: a `SeedServer` whose HTTP
 * half fails strands a whole `FabricNode` holding **two** bound listeners — the
 * WebSocket port a browser dials and the plain TCP one another node dials.
 */
describe('a rejected seed start leaves nothing listening either', () => {
  const ANY = '0.0.0.0'

  it('reads a running seed as holding its WebSocket port, and a stopped one as not', async () => {
    const wsPort = await freePort(ANY)
    const seed = await SeedServer.start({
      blockstoreDir: mkdtempSync(join(tmpdir(), 'o2-seed-live-')),
      wsPort,
      trustAnchors: UNWIND_ANCHORS,
    })
    expect(await isFree(wsPort, ANY)).toBe(false)

    await seed.stop()
    expect(await isFree(wsPort, ANY)).toBe(true)
  }, 60_000)

  it('stops the node it already started when the HTTP server cannot bind', async () => {
    const wsPort = await freePort(ANY)

    const failure = await SeedServer.start({
      blockstoreDir: mkdtempSync(join(tmpdir(), 'o2-seed-unwind-')),
      wsPort,
      trustAnchors: UNWIND_ANCHORS,
      // Past the 16-bit port space. Vite reports `No available ports found between
      // 70000 and 65535` — a failure arriving after `FabricNode.start` has bound both
      // of the seed's listeners.
      httpPort: 70_000,
    }).then(
      (seed) => {
        started.push(seed.node)
        return null
      },
      (cause: unknown) => cause,
    )

    expect(failure).toBeInstanceOf(Error)
    expect(await isFree(wsPort, ANY)).toBe(true)
  }, 60_000)
})
