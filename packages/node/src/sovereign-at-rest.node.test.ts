/**
 * DATA-10 at rest — criterion 7's remaining half, and the one Phase 13.1 scored PARTIAL.
 *
 * ## What was open, in the verification's own words
 *
 * > **At rest.** The registration is job-scoped and given back in a `finally`, so a peer
 * > asking for the same block after the job has finished still receives the raw bytes.
 * > … Closing it needs a persistent per-node set of sovereign CIDs surviving the job and
 * > the process.
 *
 * and:
 *
 * > **Bare `submitJob`.** It content-addresses every shard input and `put`s it into the
 * > store it was handed, sovereign ones included, and registers nothing.
 *
 * Both routes end in the same place — this node holds another owner's raw row and nothing
 * withholds it — so both are measured here against one mechanism.
 *
 * ## Why this is a second file and not more cases in `sovereign-block-refusal`
 *
 * That file's subject is the refusal **during** a job, and its assertions are built around
 * a wire tap over a live dispatch. Its reading that `submitter.egress.registrations` is
 * `[]` after the job stays true and stays valuable: the payload-scanning guard is still
 * job-scoped, deliberately. This file's subject is what happens once that is empty, which
 * is a different question with a different instrument — no tap, no job in flight, just a
 * `block` request and the answer to it.
 *
 * ## The mechanism, and why it is not simply a longer hold
 *
 * `EgressGuard` is keyed on payload bytes and answers by scanning every registered payload
 * against every outbound frame. `egress.ts`'s `guard()` forbids eviction and says why —
 * *the set is bounded by giving holds back, which is a bound somebody can be shown* — so a
 * hold that is never given back removes the only bound it has, and
 * `submit-with-egress.ts` names that as reintroducing *exactly the unbounded scan cost
 * Plan 13-07 was written to remove*.
 *
 * A `block` request names a **CID**. So the at-rest question never needed the byte scan:
 * `SovereignCids.has` is a lookup, and its growth costs memory rather than per-frame work.
 * The two mechanisms coexist, and this file measures the second without disturbing the
 * first.
 *
 * ## The restart is the point
 *
 * A set held only in memory would satisfy every assertion below except the last one. The
 * last case stops the node and opens a **new** one over the same directory, which is the
 * only reading that distinguishes "survives the job" from "survives the process".
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { canonicalCid, submitJob } from '@o2/core'
import type { CID } from 'multiformats/cid'
import { encodeRequest, parseResponse } from '@o2/net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
// Test-only relative import — see the note in packages/net/src/distributed.test.ts.
import { MODULE_WRITES_PARTITION } from '../../core/src/executor/fixtures.ts'
import { FabricNode } from './fabric-node.ts'
import { SOVEREIGN_CIDS_FILE } from './sovereign-cids.ts'

const OWNER = 'alice'
/** Another owner's row. This node is not alice and must never serve it. */
const ROW = { patient: 'alice-row', reading: 41 } as const

let workdir: string
const running: FabricNode[] = []

async function startNode(name: string): Promise<FabricNode> {
  const node = await FabricNode.start({
    relayAdmission: 'admits-any-peer',
    startReporting: 'reports-its-own-start',
    blockstoreDir: join(workdir, name),
    listen: ['/ip4/127.0.0.1/tcp/0'],
    rpcTimeoutMs: 20_000,
    trustAnchors: 'runs-unsigned-artifacts',
  })
  running.push(node)
  return node
}

/** Ask `holder` for `cid` over a real wire, and return the reply as it came. */
async function askForBlock(asker: FabricNode, holderId: string, cid: CID) {
  return parseResponse(await asker.rpc.request(holderId, encodeRequest({ kind: 'block', cid })))
}

beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'o2-at-rest-'))
})

afterEach(async () => {
  await Promise.all(running.splice(0).map((n) => n.stop().catch(() => {})))
  await rm(workdir, { recursive: true, force: true })
}, 40_000)

describe('DATA-10 at rest — a node refuses a sovereign block after the job that put it there', () => {
  it('refuses once the job is over, and the payload guard is empty when it does', async () => {
    const [holder, asker] = await Promise.all([startNode('holder'), startNode('asker')])
    await asker.dial(holder.multiaddrs[0] as string)

    const encoded = await canonicalCid(ROW)
    if (!encoded.ok) throw new Error('fixture not encodable')
    await holder.store.put(MODULE_WRITES_PARTITION)

    // Bare `submitJob` — the second of the two open routes, and the one that used to
    // register nothing at all. The node hands its own durable set, because the put below
    // writes into its own store.
    const result = await submitJob(
      {
        moduleCid: await holder.store.put(MODULE_WRITES_PARTITION),
        shards: [{ value: ROW, label: 'sovereign', ownerId: OWNER }],
        executors: [],
        nodes: [],
        redundancy: 1,
        onQuorumShortfall: 'runs-at-available-redundancy',
      },
      holder.store,
      // CHURN-03 — this file's subject is the sovereign CID set, not checkpointing, and
      // the statement is on both arms so the arm under test stays the only difference.
      holder.sovereignCids === 'forgets-sovereignty-between-jobs'
        ? { checkpoints: 'checkpoints-nothing' }
        : { sovereignCids: holder.sovereignCids, checkpoints: 'checkpoints-nothing' },
    )
    // The job itself cannot place — there are no executors — and that is irrelevant here.
    // What matters is that the shard input was content-addressed and PUT before placement
    // was ever attempted, which is exactly how a submitter comes to hold another owner's
    // row. Asserted rather than assumed, because if the put stopped happening this whole
    // file would be measuring an empty store.
    expect(result.ok).toBe(true)
    expect(await holder.store.get(encoded.cid)).toBeDefined()

    // The job is over. The payload-scanning guard is empty — deliberately, and this is
    // the state in which the old behaviour served the raw bytes.
    expect(holder.egress.registrations).toEqual([])

    const reply = await askForBlock(asker, holder.peerId, encoded.cid)
    expect(reply?.kind).toBe('error')
    if (reply?.kind !== 'error') return
    expect(reply.reason).toContain('egress refused')
    expect(reply.reason).toContain(encoded.cid.toString())
  }, 120_000)

  it('serves a public block from the same store, so the refusal is about sovereignty and not about blocks', async () => {
    const [holder, asker] = await Promise.all([startNode('holder'), startNode('asker')])
    await asker.dial(holder.multiaddrs[0] as string)

    const publicValue = { note: 'not anybody’s row' } as const
    const encoded = await canonicalCid(publicValue)
    if (!encoded.ok) throw new Error('fixture not encodable')

    const result = await submitJob(
      {
        moduleCid: await holder.store.put(MODULE_WRITES_PARTITION),
        shards: [{ value: publicValue, label: 'public' }],
        executors: [],
        nodes: [],
        redundancy: 1,
        onQuorumShortfall: 'runs-at-available-redundancy',
      },
      holder.store,
      // CHURN-03 — this file's subject is the sovereign CID set, not checkpointing, and
      // the statement is on both arms so the arm under test stays the only difference.
      holder.sovereignCids === 'forgets-sovereignty-between-jobs'
        ? { checkpoints: 'checkpoints-nothing' }
        : { sovereignCids: holder.sovereignCids, checkpoints: 'checkpoints-nothing' },
    )
    expect(result.ok).toBe(true)

    // The control. Without it, a node that refused every block would pass the case above
    // perfectly — and "refuses everything" is a far more likely regression than "refuses
    // exactly the sovereign one".
    const reply = await askForBlock(asker, holder.peerId, encoded.cid)
    expect(reply?.kind).toBe('block')
    if (reply?.kind !== 'block') return
    expect(reply.bytes).not.toBeNull()
  }, 120_000)

  it('still refuses after the process that recorded it is gone', async () => {
    const encoded = await canonicalCid(ROW)
    if (!encoded.ok) throw new Error('fixture not encodable')

    // ---- First process: hold the row, record it, die. ----------------------------
    {
      const holder = await startNode('holder')
      const result = await submitJob(
        {
          moduleCid: await holder.store.put(MODULE_WRITES_PARTITION),
          shards: [{ value: ROW, label: 'sovereign', ownerId: OWNER }],
          executors: [],
          nodes: [],
          redundancy: 1,
          onQuorumShortfall: 'runs-at-available-redundancy',
        },
        holder.store,
        // CHURN-03 — as above: stated on both arms so it cannot be the difference.
        holder.sovereignCids === 'forgets-sovereignty-between-jobs'
          ? { checkpoints: 'checkpoints-nothing' }
          : { sovereignCids: holder.sovereignCids, checkpoints: 'checkpoints-nothing' },
      )
      expect(result.ok).toBe(true)
      await holder.stop()
      running.length = 0
    }

    // It reached the disk, under the name this tier declares and dot-prefixed so
    // `FsBlockstore.open`'s counter does not read it as a block.
    const recorded = await readFile(join(workdir, 'holder', SOVEREIGN_CIDS_FILE), 'utf8')
    expect(recorded).toContain(encoded.cid.toString())

    // ---- Second process: same directory, new everything else. --------------------
    // This is the reading that separates "survives the job" from "survives the process".
    // An in-memory set passes every other case in this file and fails here.
    const reborn = await startNode('holder')
    const asker = await startNode('asker')
    await asker.dial(reborn.multiaddrs[0] as string)

    // Nothing has run on this node. The payload guard has never held anything at all.
    expect(reborn.egress.registrations).toEqual([])
    expect(await reborn.store.get(encoded.cid)).toBeDefined()

    const reply = await askForBlock(asker, reborn.peerId, encoded.cid)
    expect(reply?.kind).toBe('error')
    if (reply?.kind !== 'error') return
    expect(reply.reason).toContain(encoded.cid.toString())
  }, 120_000)
})
