import { MemoryBlockstore, MemoryNetwork, SendRefused, canonicalCid } from '@o2/core'
import type { CanonicalValue, ExecutionOutcome, Executor, Task, Transport } from '@o2/core'
import { CID } from 'multiformats/cid'
import { describe, expect, it } from 'vitest'
import { EgressRefusal, RpcEndpoint, remoteDispatch, serveAgent } from './index.ts'
import type { DispatchOutcome, ShardWork } from './index.ts'

/**
 * NET-09's failure classification, which is the whole of what `remoteDispatch` is for.
 *
 * ## What this file used to be, and why two thirds of it is gone
 *
 * It held twelve cases. Six drove `runResilient` against a `MemoryNetwork` fabric of real
 * `serveAgent` nodes and real `WasmExecutor`s — a 30 %-kill run, a die-between-placement-
 * and-dispatch run, a trapping-module run, and two checkpoint runs. Plan 20-12 deleted
 * `runResilient` under WIRE-04 (*"without the caller choosing between two functions"*), and
 * a case cannot outlive the function it calls. **Each of those six behaviours was accounted
 * for before the deletion rather than after it**, and the table is in `20-12-SUMMARY.md`.
 * The short form, so a reader here does not have to go and find it:
 *
 * | what the deleted case stated | where it is now stated |
 * |---|---|
 * | 30 % of the fabric dies and the answer is unchanged | `node/src/churn-agents.node.test.ts` — over real spawned `bin/agent.ts` processes, against a control run in the same run |
 * | a node that dies *between placement and dispatch* | same file; the kill is staged exactly there |
 * | a trapping module is given up on rather than burning the fabric | **only the bound survives** — `core/src/job/submit.test.ts` › *stops at the generation cap…*. `submitJob` has no `node`/`task` distinction to give up *early* on; 20-CONTEXT.md ruled it approximates by distinct-node count. Same observed number (3), different mechanism |
 * | resumes from a checkpoint and finishes only the outstanding shards | `core/src/job/submit.test.ts` › *resumes from a CID and dispatches ONLY the shards the checkpoint does not name*, and `node/src/checkpoint-agents.node.test.ts` across processes |
 * | recovers from an older handle when the newest block is lost | `core/src/job/submit.test.ts` › *recovers to an OLDER handle…* |
 * | a `sender` refusal is retried like a node failure, never counted against the task budget | **NOWHERE — this behaviour no longer exists.** See below |
 *
 * ## The one behaviour that was deleted rather than moved
 *
 * `runResilient` read `DispatchOutcome.kind` for *policy* in exactly one place: a `'task'`
 * failure counted against `DEFAULT_MAX_TASK_FAILURES` and a `'sender'` one did not, so a
 * shard refused by this node's own send gate could be retried across the whole pool.
 * `submitJob` cannot do that — it dispatches through `Executor`, whose `ExecutionOutcome`
 * carries no kind — and bounds *every* failure at `DEFAULT_MAX_GENERATIONS`. So a shard
 * whose sender gate refuses four times is now abandoned at three where it used to reach
 * the fifth node. That is a real loss of behaviour, it is bounded by 3, and it is the
 * stated price of `20-CONTEXT.md`'s ruling against parsing reason strings for policy.
 *
 * **The classification itself is untouched and is what the six cases below read.** `kind`
 * is still produced, still discriminated on the typed detail, and still assertable. What
 * has no reader is the *policy* the kind used to select.
 *
 * ## NET-09 criterion 5 — a send *this node* refused is not the receiver's failure
 *
 * Every case below drives `remoteDispatch` against an `RpcEndpoint` built over a
 * transport that rejects, because the classification lives in `remoteDispatch`'s
 * `catch` and that is the only way to reach it. The interesting half is the
 * negative space: `send-refused` is the *only* thing that produces `'sender'`, and
 * the cases that must keep producing `'node'` are asserted one by one, because a
 * branch that swallowed the general case into `'sender'` would look identical on
 * the happy path.
 *
 * **This file is `mutation-ledger.ts`'s `M5` catcher**, and `M5`'s signature is the first
 * case below failing on its `kind` assertion. Deleting that case, or this file, reddens
 * `mutation-guard.node.test.ts`. The signature itself is deliberately NOT quoted here:
 * `M5` declares it `rendered-at-runtime`, and the guard checks that such a signature does
 * **not** appear verbatim in its own catcher — a signature a grep can find in the test
 * source is a `test-title` match, which is the arm that gets checked cheaply, so quoting
 * it here would silently reclassify the entry. Measured: writing it out reddened
 * `mutation-guard/M5` immediately.
 *
 * ## What this file cannot redden on
 *
 * Anything about *scheduling*. There is no loop here any more, so retry policy, leases,
 * speculation and coverage are all somebody else's — `core/src/job/submit.test.ts` for
 * the kernel readings and the four `*-agents.node.test.ts` files for the process ones.
 * What is here is `remoteDispatch`'s `catch`, its four response-shape branches, and its
 * success return: the whole of what the adapter decides.
 */
describe('NET-09 — classifying a refusal this node made, against every other failure', () => {
  const shard: ShardWork = { shardId: 's0', label: 'public' }

  /** A transport whose `send` always rejects with `cause`. Nothing else is used. */
  const rejecting = (cause: unknown): Transport => ({
    localId: 'local-node',
    send: async () => {
      throw cause
    },
    onMessage: () => () => {},
    peers: [],
  })

  /** The task every case below dispatches. Never runs — every send rejects first. */
  const taskFor = (): Task => ({
    moduleCid: CID.parse('bafkqaaa'),
    inputCid: CID.parse('bafkqaaa'),
    partitionIndex: 0,
    partitionCount: 1,
    label: 'public',
  })

  const dispatchOver = async (cause: unknown): Promise<DispatchOutcome> => {
    const rpc = new RpcEndpoint(rejecting(cause), { timeoutMs: 500 })
    try {
      return await remoteDispatch({
        rpc,
        blockstore: new MemoryBlockstore(),
        taskFor,
      })(shard, 'n0')
    } finally {
      rpc.close()
    }
  }

  it('classifies a gate refusal as sender, naming which node’s bound refused', async () => {
    const outcome = await dispatchOver(
      new SendRefused('local-node refused a send to n0: 8 of 8 streams in use', {
        to: 'n0',
        by: 'local-node',
        reason: 'per-peer-stream-budget',
      }),
    )

    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.kind).toBe('sender')
    // The reader learns *whose* bound it was, even though the recorded nodeId
    // still names the peer that was attempted.
    expect(outcome.reason).toContain('local-node')
    expect(outcome.reason).toContain('8 of 8 streams in use')
  })

  it('still classifies a dial to an unreachable peer as node', async () => {
    // The case that makes `send-failed` the wrong discriminator. `rpc.ts`'s catch
    // is bare and `Libp2pTransport.send` awaits `dialProtocol`, so a dead receiver
    // arrives by the same route a gate refusal does.
    const outcome = await dispatchOver(new Error('Can not dial n0: no valid addresses'))
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.kind).toBe('node')
  })

  it('still classifies an ordinary send failure as node', async () => {
    const outcome = await dispatchOver(new Error('the stream has been reset'))
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.kind).toBe('node')
  })

  it('still classifies an EgressRefusal raised by this node’s own tap as node', async () => {
    // Called out by name: NET-09 does **not** reclassify an egress refusal. It
    // reaches `rpc.ts` as `send-failed` and therefore stays `'node'`. If a later
    // phase decides it deserves `'sender'`, it makes `EgressRefusal` carry the
    // `SendRefused` marker; it does not widen the `send-failed` branch.
    const outcome = await dispatchOver(new EgressRefusal({ to: 'n0', violation: 'alice-row', bytes: 138 }))
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.kind).toBe('node')
  })

  it('still classifies a closed endpoint as node', async () => {
    const rpc = new RpcEndpoint(rejecting(new Error('unused')), { timeoutMs: 500 })
    rpc.close()
    const outcome = await remoteDispatch({
      rpc,
      blockstore: new MemoryBlockstore(),
      taskFor,
    })(shard, 'n0')

    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.kind).toBe('node')
  })

  it('still classifies a timeout as node', async () => {
    // A transport that accepts the send and never answers.
    const silent: Transport = {
      localId: 'local-node',
      send: async () => {},
      onMessage: () => () => {},
      peers: [],
    }
    const rpc = new RpcEndpoint(silent, { timeoutMs: 100 })
    try {
      const outcome = await remoteDispatch({
        rpc,
        blockstore: new MemoryBlockstore(),
        taskFor,
      })(shard, 'n0')
      expect(outcome.ok).toBe(false)
      if (outcome.ok) return
      expect(outcome.kind).toBe('node')
    } finally {
      rpc.close()
    }
  })
})

/**
 * The accepted branch — and the reason it is here rather than deleted with the rest.
 *
 * The six cases above never reach `ok: true`, so until Plan 20-12 the success return was
 * covered only by the 30 %-kill case that drove `runResilient` over a `MemoryNetwork`
 * fabric. That case went with `runResilient`, and its claim moved to
 * `churn-agents.node.test.ts` — which reads it over real spawned processes but through
 * `submitJob` and `RemoteExecutor`, so it never enters this module at all.
 *
 * **That left `mutation-ledger.ts`'s `M64` with a plant nobody could catch.** `M64`
 * appends the answering node's id to the returned CID, and its whole argument is that a
 * *distinctness* check cannot see it while an *equality against a control* can. So the
 * control is restored here at the only layer that still reaches the line: the same task
 * answered by two different nodes, compared to each other and to the CID computed from
 * the output. Measured — see `20-12-SUMMARY.md`: with `M64` planted this case reddens and
 * the six above stay green, which is precisely why deleting it would have been a silent
 * loss rather than a tidy-up.
 *
 * No WASM and no real module: `serveAgent` calls whatever `Executor` it is handed, so a
 * two-line fake reaches the branch under test and nothing else is in the way.
 */
describe('CHURN-01 — an accepted dispatch names its result by its content address', () => {
  const shard: ShardWork = { shardId: 's0', label: 'public' }

  /** The output every node below returns for the same task — a pure function of it. */
  const outputFor = (task: Task): CanonicalValue => ({
    shard: task.partitionIndex,
    of: task.partitionCount,
  })

  /** An executor that answers from the task alone, so two nodes cannot disagree. */
  const answering = (nodeId: string): Executor => ({
    nodeId,
    async execute(task: Task): Promise<ExecutionOutcome> {
      return { ok: true, output: outputFor(task), fuelUsed: 7, attestation: 'signed-by-nobody' }
    },
  })

  it('returns the CID of the output and stores the block, identically whichever node answered', async () => {
    const network = new MemoryNetwork()
    const serving = ['n0', 'n1'].map((nodeId) => {
      const rpc = new RpcEndpoint(network.connect(nodeId), { timeoutMs: 2_000 })
      serveAgent({
        paused: 'never-pauses',
        rpc,
        executor: answering(nodeId),
        blockstore: new MemoryBlockstore(),
        egress: 'holds-no-registrations',
        authorize: 'serves-unauthenticated',
        index: 'serves-no-records',
        enroll: 'issues-no-certificates',
        capacity: 'accepts-every-offer',
        ledger: 'keeps-no-ledger',
        reservations: 'relays-for-nobody',
        onDispatch: 'reports-no-dispatch',
        attest: 'signs-nothing',
      })
      return rpc
    })
    const store = new MemoryBlockstore()
    const requestorRpc = new RpcEndpoint(network.connect('requestor'), { timeoutMs: 2_000 })

    const task: Task = {
      moduleCid: CID.parse('bafkqaaa'),
      inputCid: CID.parse('bafkqaaa'),
      partitionIndex: 3,
      partitionCount: 8,
      label: 'public',
    }

    try {
      const dispatch = remoteDispatch({ rpc: requestorRpc, blockstore: store, taskFor: () => task })
      const first = await dispatch(shard, 'n0')
      const second = await dispatch(shard, 'n1')

      expect(first.ok).toBe(true)
      expect(second.ok).toBe(true)
      if (!first.ok || !second.ok) return

      // The equality against a control, taken inside one run: the SAME task answered by
      // two different nodes is the same bytes and therefore the same address. A CID that
      // depended on who ran it would break here and pass a distinctness check.
      expect(first.resultCid).toBe(second.resultCid)

      // And it is the address of the OUTPUT, computed rather than transcribed — so a
      // return that decorated the CID, or named the input, fails without a literal to
      // maintain.
      const expected = await canonicalCid(outputFor(task))
      expect(expected.ok).toBe(true)
      if (!expected.ok) return
      expect(first.resultCid).toBe(expected.cid.toString())

      // The block is retrievable by that address, which is what makes "names its result"
      // true rather than a string the requestor invented.
      expect(await store.has(CID.parse(first.resultCid))).toBe(true)

      // WHAT THIS CANNOT REDDEN ON. Nothing about the failure kinds — every dispatch here
      // succeeds. The six cases above are the whole of that, and neither half stands in
      // for the other.
    } finally {
      requestorRpc.close()
      for (const rpc of serving) rpc.close()
    }
  })
})
