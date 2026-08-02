import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_TASK_DEADLINE_MS } from '@o2/core'
import { DEFAULT_RPC_TIMEOUT_MS, RpcEndpoint, encodeRequest, parseResponse } from '@o2/net'
import { afterEach, beforeEach, expect, it } from 'vitest'
// Test-only relative import — see the note in packages/net/src/distributed.test.ts.
import { MODULE_NEVER_RETURNS } from '../../core/src/executor/fixtures.ts'
import { FabricNode } from './fabric-node.ts'

/**
 * SCHED-06 — a peer's module cannot hold this node's event loop.
 *
 * `FabricNode.start` serves `authorize: 'serves-unauthenticated'`, so anyone who can
 * dial `/o2/rpc/1.0.0` reaches `executor.execute`. A guest `run()` is a synchronous
 * call and V8 has no fuel, so a 52-byte looping module used to wedge the process
 * outright: the admission slot's `finally` sat around an `await` that never settled,
 * and the RPC timeout's own `setTimeout` could not even fire. Reproduced by killing
 * the process at 15 s.
 *
 * What this file asserts is the whole claim and nothing softer: the module's
 * requestor is told, in a named outcome, inside the deadline; the node answers the
 * *next* request, which is the event loop being alive; and the slot comes back.
 *
 * Before the fix this hangs and fails on its own timeout, which is the right shape of
 * failure — there is no assertion a wedged node can reach.
 */

let workdir: string
const running: FabricNode[] = []

beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'o2-execution-deadline-'))
})

afterEach(async () => {
  await Promise.all(running.splice(0).map((node) => node.stop().catch(() => {})))
  await rm(workdir, { recursive: true, force: true })
})

async function startNode(name: string, extra: Record<string, unknown> = {}): Promise<FabricNode> {
  const node = await FabricNode.start({
    blockstoreDir: join(workdir, name),
    // Port 0: the OS picks a free port, so concurrent runs cannot collide.
    listen: ['/ip4/127.0.0.1/tcp/0'],
    // DET-03: this file's subject is the task deadline — a module that must actually
    // run and then be killed. A provenance refusal would return before the module ran
    // at all, so the opt-out is what keeps this file measuring its own subject. Stated
    // rather than defaulted, which is the point of the field being required.
    trustAnchors: 'runs-unsigned-artifacts',
    ...extra,
  })
  running.push(node)
  return node
}

it('SCHED-06 — a module that never returns is failed by the deadline, and the node keeps serving', async () => {
  // Short enough that the whole case fits a test budget, and it is *injected* rather
  // than defaulted so the number this asserts against is the one under test.
  const deadlineMs = 1_500
  const [server, client] = await Promise.all([
    startNode('server', { taskDeadlineMs: deadlineMs }),
    startNode('client'),
  ])
  await client.dial(server.multiaddrs[0]!)

  // Only the client holds the blocks, so the server pulls both over the wire — the
  // same route any peer's module arrives by.
  const moduleCid = await client.store.put(MODULE_NEVER_RETURNS)
  const inputCid = await client.store.put(new Uint8Array([0x0a]))

  const rpc: RpcEndpoint = client.rpc
  const started = performance.now()
  const reply = parseResponse(
    await rpc.request(
      server.peerId,
      encodeRequest({
        kind: 'exec',
        task: { moduleCid, inputCid, partitionIndex: 0, partitionCount: 1, label: 'public' },
      }),
    ),
  )
  const elapsed = performance.now() - started

  // (a) A named outcome, not a timeout. `exec ok:false` and not `{kind:'error'}`:
  // churn.ts files `error` as a NODE condition, and a hostile module is a TASK one.
  expect(reply?.kind).toBe('exec')
  if (reply?.kind !== 'exec') return
  expect(reply.outcome.ok).toBe(false)
  if (reply.outcome.ok) return
  expect(reply.outcome.reason).toMatch(/exceeded \d+ms/)
  expect(reply.outcome.reason).toContain(server.peerId)
  // Promptness, and the only claim here the assertions above do not already carry.
  // That the RPC budget was not what ended this is settled causally — a timeout
  // rejects `rpc.request` and there would be no `reply` to parse — so what is left
  // for a clock is whether the deadline is enforced *near* its configured value or
  // merely eventually.
  //
  // Sited between two populations rather than by arithmetic on `deadlineMs`, which
  // is what stood here before (`deadlineMs * 4`) and could not fail for the reason
  // it claimed. Measured 2026-08-01 over 22 runs, 1-min load 23.97→12.68 on 8 cores:
  // **1517.8–1534.7 ms**, i.e. 18–35 ms above the 1 500 ms deadline, and the window
  // includes two real libp2p nodes, a dial and both blocks pulled over the wire.
  // The other population is `DEFAULT_RPC_TIMEOUT_MS` (30 s), asserted against
  // `DEFAULT_TASK_DEADLINE_MS` in the case below — that is what this reads if the
  // deadline stops firing and the requestor's own budget ends the exchange instead.
  // 2 500 leaves ~1 s of headroom, ~28× the worst overhead measured on a host
  // already carrying three times its core count, and stays 12× under the control.
  expect(elapsed).toBeLessThan(2_500)

  // (b) The event loop is alive. This is the claim; everything above is how it is
  // reported. A wedged node cannot answer at all.
  const second = parseResponse(
    await rpc.request(server.peerId, encodeRequest({ kind: 'offer', shardId: 'after-the-deadline' })),
  )
  expect(second?.kind).toBe('offer')

  // (c) The admission slot came back — `serveAgent`'s `finally` really ran, rather
  // than sitting around an await that never settled.
  expect(server.admission.inFlight).toBe(0)
}, 30_000)

it('SCHED-06 — the task deadline sits inside the RPC budget, so the requestor is told', () => {
  // NET-10's argument applied to time. If a node could take longer to give up on a
  // task than its requestor takes to give up on the node, the requestor would sit
  // out its whole budget and learn only that nothing came back — unable to tell
  // "your module never returned" from "that node is gone".
  //
  // A tracked relation rather than a comment, and asserted here because this is the
  // package that can see both constants: `@o2/core` must not depend on `@o2/net`.
  expect(DEFAULT_TASK_DEADLINE_MS).toBeLessThan(DEFAULT_RPC_TIMEOUT_MS)
})
