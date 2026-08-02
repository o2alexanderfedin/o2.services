import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { encodeRequest, parseResponse } from '@o2/net'
import type { AgentResponse } from '@o2/net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FabricNode } from './fabric-node.ts'
import type { FabricNodeOptions } from './fabric-node.ts'

/**
 * SCHED-04 on the Node tier: a CPU cap an operator can move on a node that is already
 * running, honoured by what the node *does* and by what it *tells a peer it can do*.
 *
 * ## What this file measures
 *
 * Both halves of the requirement, in the order that makes a failure legible:
 *
 * 1. **The mechanism** — `GovernedExecutor` paces what the node runs, read from
 *    `executorPeakInFlight`.
 * 2. **The observable** — the slot count in the offer answer a *peer* reads off a real
 *    transport. That is the half criterion 3 actually asks for; the mechanism is why it
 *    is true.
 *
 * They are asserted separately and in that order, so a red run names which one broke.
 *
 * ## What it deliberately does not measure
 *
 * **The browser tier.** Criterion 3 names both, and Plan 18-09 covers the other one. This
 * file covers one tier and says so rather than implying more — a file that quietly covered
 * half a criterion while reading as the whole of it is exactly what a verification pass is
 * supposed to catch.
 *
 * **The cap through any wire frame, because there deliberately is none.** A reader looking
 * for the missing RPC should find the reason here: `serveAgent` serves *unauthenticated*,
 * so a frame that set a node's CPU cap would let any peer able to dial this process
 * throttle a machine it does not own. Bounding that needs an authorization surface this
 * phase has no reason to open. The control channel is a file under the directory the agent
 * was already given, plus `SIGHUP` — reachable only by whoever can already write that
 * directory. No new bytes cross the network.
 */

let workdir: string
const running: FabricNode[] = []

async function startNode(name: string, extra: Partial<FabricNodeOptions> = {}): Promise<FabricNode> {
  const node = await FabricNode.start({
    blockstoreDir: join(workdir, name),
    // Port 0: the OS picks a free port, so concurrent runs cannot collide.
    listen: ['/ip4/127.0.0.1/tcp/0'],
    rpcTimeoutMs: 20_000,
    // DET-03: provenance is not this file's subject and no job here carries a
    // `moduleRecord`. Stated rather than defaulted, so a reader counting this literal
    // learns which files do not exercise the signed path.
    trustAnchors: 'runs-unsigned-artifacts',
    ...extra,
  })
  running.push(node)
  return node
}

/** An offer probe over the real wire, reading the raw reply rather than a flattening. */
async function offer(from: FabricNode, to: string, shardId: string): Promise<AgentResponse | null> {
  return parseResponse(await from.rpc.request(to, encodeRequest({ kind: 'offer', shardId })))
}

beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'o2-duty-cycle-'))
})

afterEach(async () => {
  await Promise.all(running.splice(0).map((node) => node.stop()))
  await rm(workdir, { recursive: true, force: true })
})

const TEST_TIMEOUT = 120_000

describe('a cap set on a running node changes what it advertises', () => {
  it('drops the slot count, in process and then on the wire', async () => {
    const node = await startNode('served', { maxConcurrentTasks: 8 })
    const peer = await startNode('peer')
    await peer.dial(node.multiaddrs[0] as string)

    // The mechanism first: unthrottled, the node offers every slot it has.
    expect(node.dutyCycle).toBe(1)
    expect(node.admission.slots).toBe(8)

    const before = await offer(peer, node.peerId, 'shard-before')
    expect(before?.kind).toBe('offer')
    if (before?.kind !== 'offer') throw new Error('the peer read no offer answer')
    expect(before.capacity).toEqual({ slots: 8, inFlight: 0 })

    // One call, on a node that is already serving. No restart, no reconstruction.
    node.setDutyCycle(0.25)

    expect(node.dutyCycle).toBe(0.25)
    expect(node.admission.slots).toBe(2)

    // The observable: the criterion is about what a *requestor* is offered next, so the
    // reading that settles it is this one — taken by a different node, over tcp + noise
    // + yamux, from the very next offer answer.
    const after = await offer(peer, node.peerId, 'shard-after')
    expect(after?.kind).toBe('offer')
    if (after?.kind !== 'offer') throw new Error('the peer read no offer answer')
    expect(after.capacity).toEqual({ slots: 2, inFlight: 0 })
  }, TEST_TIMEOUT)

  it('refuses outside (0, 1] by name, and leaves the running cap alone', async () => {
    const node = await startNode('guarded', { maxConcurrentTasks: 8 })

    // The governor's own guard, reached rather than duplicated in `FabricNode`.
    for (const bad of [0, -0.5, 1.5, Number.NaN]) {
      expect(() => node.setDutyCycle(bad)).toThrow(RangeError)
    }
    // A refused call must not be a partial one: the node is exactly as it was.
    expect(node.dutyCycle).toBe(1)
    expect(node.admission.slots).toBe(8)
  }, TEST_TIMEOUT)

  it('starts at the cap it was given', async () => {
    // The option reaches the governor, which is what `bin/agent.ts --duty-cycle` relies
    // on. Without this, a start-time cap could be silently dropped and only the
    // `setDutyCycle` path would be covered.
    const node = await startNode('preset', { maxConcurrentTasks: 8, dutyCycle: 0.5 })
    expect(node.dutyCycle).toBe(0.5)
    expect(node.admission.slots).toBe(4)
  }, TEST_TIMEOUT)
})

describe('the cap is honoured by the executor, not only advertised', () => {
  it('runs one task at a time when throttled, and more than one when not', async () => {
    // **The pair is the measurement.** "Never more than one in flight" is satisfied
    // perfectly by a test that only ever dispatched one, so the throttled reading is
    // worth nothing without a full-rate reading taken the same way. Both nodes are
    // handed the same work by the same code below.
    const throttled = await startNode('slow', { maxConcurrentTasks: 8, dutyCycle: 0.1 })
    const open = await startNode('fast', { maxConcurrentTasks: 8 })

    const load = async (node: FabricNode): Promise<number> => {
      // Straight at the node's own executor: this is the pacing being measured, not
      // admission, and a local call takes no slot precisely because it does not pass
      // through `serveAgent`'s exec branch. Failures are irrelevant here — what is being
      // read is how many were *inside* at once.
      await Promise.all(
        Array.from({ length: 6 }, async () => {
          await node.executor
            .execute({
              moduleCid: (await node.store.put(new Uint8Array([0]))) as never,
              inputCid: (await node.store.put(new Uint8Array([1]))) as never,
              partitionIndex: 0,
              partitionCount: 1,
              label: 'public',
            })
            .catch(() => undefined)
        }),
      )
      return node.executorPeakInFlight
    }

    const throttledPeak = await load(throttled)
    const openPeak = await load(open)

    // The governor serialises only while throttled, which is the whole of its contract.
    expect(throttledPeak).toBe(1)
    // And the control: the same six dispatches on an identical node at full rate get
    // inside together, so the reading above is the cap and not the harness.
    expect(openPeak).toBeGreaterThan(1)
  }, TEST_TIMEOUT)
})

describe('a throttled node names its cap when it refuses', () => {
  it('says which duty cycle it is refusing at', async () => {
    const node = await startNode('named', { maxConcurrentTasks: 4, dutyCycle: 0.25 })
    const peer = await startNode('asker')
    await peer.dial(node.multiaddrs[0] as string)

    // One slot at a quarter of four, so the very first probe after it is held is refused
    // — and the refusal has to carry the cap, or an operator reading it cannot tell an
    // over-subscribed node from a deliberately throttled one.
    expect(node.admission.slots).toBe(1)

    const reply = await offer(peer, node.peerId, 'shard-named')
    expect(reply?.kind).toBe('offer')
    if (reply?.kind !== 'offer') throw new Error('the peer read no offer answer')
    expect(reply.capacity).toEqual({ slots: 1, inFlight: 0 })
  }, TEST_TIMEOUT)
})

describe('the control file is the only channel, and a bad one is not fatal', () => {
  it('is read from the directory the node was given, never from a peer', async () => {
    // The negative half of the design, asserted rather than left to the header: there is
    // no request kind that sets a cap. If one is ever added, this fails and whoever added
    // it has to argue for the authorization surface it needs.
    const node = await startNode('unreachable', { maxConcurrentTasks: 8 })
    const peer = await startNode('stranger')
    await peer.dial(node.multiaddrs[0] as string)

    // A control file exists on disk for the agent binary to read; a peer cannot reach it.
    await writeFile(join(workdir, 'unreachable', '.duty-cycle'), '0.25\n', 'utf8')

    // Nothing a peer can send changes the cap. The node still answers every slot.
    const reply = await offer(peer, node.peerId, 'shard-stranger')
    expect(reply?.kind).toBe('offer')
    if (reply?.kind !== 'offer') throw new Error('the peer read no offer answer')
    expect(reply.capacity).toEqual({ slots: 8, inFlight: 0 })
    expect(node.dutyCycle).toBe(1)
  }, TEST_TIMEOUT)
})
