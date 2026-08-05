import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FabricNode } from './fabric-node.ts'
import { ReservationWatcher } from './reservation-watch.ts'

/**
 * NET-02 / NET-04 — a job over a relayed connection.
 *
 * This is the topology a browser peer has no way to avoid: neither side can accept
 * a connection, so both hold a reservation on a relay and are reachable only at a
 * `/p2p-circuit` address. Running the *real* job over that path is what proves
 * `runOnLimitedConnection` is set correctly.
 *
 * That flag is easy to get wrong in a way that is invisible until the browser tier
 * exists. Without it on **both** `handle` and `dial`, peers connect happily and the
 * o2 protocol then refuses to negotiate — a failure that looks like a bug in the
 * scheduler rather than in transport configuration. Proving it in Node, where the
 * relay is local and nothing is flaky, is much cheaper than discovering it in a
 * browser.
 *
 * Scope note: a full redundant job over relayed connections is NOT verified here.
 * Attempting it surfaced a design problem that needs a fix rather than a test —
 * see "Open problem" in phases/phase-3-browser-tier/SUMMARY.md. What is verified
 * below is that a node with no listen address of its own obtains a working
 * `/p2p-circuit` address, and that the flag the relayed path depends on is set on
 * both sides.
 */

let workdir: string
const running: { stop(): Promise<void> }[] = []

async function until(predicate: () => boolean, timeoutMs: number, what: string): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error(`timed out waiting for ${what}`)
}

beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'o2-relayed-'))
})

afterEach(async () => {
  await Promise.all(running.splice(0).map((n) => n.stop().catch(() => {})))
  await rm(workdir, { recursive: true, force: true })
})

describe('NET-04 — protocols negotiate over p2p-circuit', () => {
  it('registers runOnLimitedConnection on both handle and dial', () => {
    // Both halves are required. Setting it on only one produces a connection that
    // works for identify and ping but silently refuses the fabric's own protocol.
    const source = readFileSync(new URL('../../libp2p/src/libp2p-transport.ts', import.meta.url), 'utf8')
    const occurrences = source.match(/runOnLimitedConnection:\s*true/g) ?? []
    expect(occurrences.length).toBe(2)

    // And specifically inside each call, not merely twice somewhere in the file.
    const handleAt = source.indexOf('libp2p.handle(')
    const dialAt = source.indexOf('dialProtocol(')
    expect(handleAt).toBeGreaterThan(-1)
    expect(dialAt).toBeGreaterThan(handleAt)
    expect(source.slice(handleAt, dialAt)).toContain('runOnLimitedConnection: true')
    expect(source.slice(dialAt)).toContain('runOnLimitedConnection: true')
  })

  it('reserves a circuit address for a node that cannot listen', async () => {
    const relay = await FabricNode.start({
      relayAdmission: 'admits-any-peer',
      startReporting: 'reports-its-own-start',
      maxReservations: 8,
      listen: ['/ip4/127.0.0.1/tcp/0/ws'],
      // DET-03: this file's subject is a job that crosses a relayed connection, and
      // every dispatch in it is in-process on the node being configured. Stated rather
      // than defaulted — the point of the field being required is that a reader
      // counting this literal learns which tests do not exercise the signed path. No
      // job here carries a `moduleRecord`: a node running with the opt-out has no
      // guard to satisfy, and a record would be decoration.
      trustAnchors: 'runs-unsigned-artifacts',
    })
    running.push(relay)

    const watcher = new ReservationWatcher()
    const node = await FabricNode.start({
      relayAdmission: 'admits-any-peer',
      startReporting: 'reports-its-own-start',
      blockstoreDir: join(workdir, 'a'),
      // No listen addresses of its own — the browser's situation exactly.
      listen: [],
      relayAddrs: relay.browserDialableAddrs.slice(0, 1),
      reservationWatcher: watcher,
      rpcTimeoutMs: 30_000,
      // DET-03 — see the relay above.
      trustAnchors: 'runs-unsigned-artifacts',
    })
    running.push(node)

    await until(() => node.circuitAddrs.length > 0, 30_000, 'a circuit address')

    expect(node.circuitAddrs[0]).toContain('/p2p-circuit')
    expect(node.circuitAddrs[0]).toContain(node.peerId)
    // The reservation was granted, so nothing was refused.
    expect(watcher.failures).toEqual([])
    expect(relay.capacity.granted).toBeGreaterThan(0)
  }, 60_000)
})
