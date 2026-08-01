import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ed25519 } from '@noble/curves/ed25519.js'
import { publicNodes, signName, submitJob, toHex } from '@o2/core'
import type { CanonicalValue, NameRecord, Task } from '@o2/core'
import { RemoteExecutor, blockCid } from '@o2/net'
import type { CID } from 'multiformats/cid'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
// Test-only relative imports — see the note in packages/net/src/distributed.test.ts.
import { MODULE_WRITES_PARTITION } from '../../core/src/executor/fixtures.ts'
import { OWNER_KEY, chainSupplierFor } from './capability-fixture.ts'
import { FabricNode } from './fabric-node.ts'
import type { FabricNodeOptions } from './fabric-node.ts'
import { FsBlockstore } from './fs-blockstore.ts'

/**
 * NET-01 — the same job, over a real transport.
 *
 * These nodes talk TCP, negotiate noise, multiplex with yamux, and exchange blocks
 * over a real socket. The kernel is the same kernel: `submitJob` is called exactly
 * as the loopback tests call it, and the only difference is that the `Executor`
 * instances it receives happen to reach other machines.
 */

let workdir: string
const running: FabricNode[] = []

async function startNode(name: string, extra: Partial<FabricNodeOptions> = {}): Promise<FabricNode> {
  const node = await FabricNode.start({
    blockstoreDir: join(workdir, name),
    // Port 0: the OS picks a free port, so concurrent test runs cannot collide.
    listen: ['/ip4/127.0.0.1/tcp/0'],
    rpcTimeoutMs: 20_000,
    // Everything above this line predates DET-03 and its subject is the transport,
    // the job path and persistence — not provenance. Stating the opt-out here is what
    // keeps those tests proving exactly what they were written to prove, and it is
    // stated rather than defaulted so a reader counting the literal can see that this
    // file's pre-existing cases do not exercise the signed path. The DET-03 block at
    // the bottom passes real anchors and does not use this helper's default.
    trustAnchors: 'runs-unsigned-artifacts',
    ...extra,
  })
  running.push(node)
  return node
}

/** The `naming.test.ts` fixture pattern — an ephemeral key derived from one byte. */
function keypair(seed: number): { priv: Uint8Array; pub: string } {
  const priv = new Uint8Array(32).fill(seed)
  return { priv, pub: toHex(ed25519.getPublicKey(priv)) }
}

// Seeds distinct from every other fixture key in the repository.
const publisher = keypair(41)
const impostor = keypair(42)

const KERNEL = 'fabric-node-fixture-kernel'

function recordFor(priv: Uint8Array, cid: CID): NameRecord {
  return signName(priv, {
    name: KERNEL,
    cid,
    version: 1,
    // Far enough out that this test never becomes a clock-dependent flake, and read
    // from the real clock rather than a constant because the guard `FabricNode`
    // composes uses `Date.now()` — a fixed epoch would expire on every run.
    expiresAt: Date.now() + 3_600_000,
  })
}

function taskFor(moduleCid: CID, inputCid: CID, record?: NameRecord): Task {
  return {
    moduleCid,
    inputCid,
    partitionIndex: 0,
    partitionCount: 1,
    label: 'public',
    ...(record === undefined ? {} : { moduleRecord: record }),
  }
}

function partitionOf(output: CanonicalValue): number {
  const p = (output as { p?: unknown }).p
  if (!(p instanceof Uint8Array) || p.length !== 4) return -1
  return new DataView(p.buffer, p.byteOffset, 4).getUint32(0, true)
}

beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'o2-net-'))
})

afterEach(async () => {
  await Promise.all(running.splice(0).map((n) => n.stop().catch(() => {})))
  await rm(workdir, { recursive: true, force: true })
})

describe('NET-01 — two nodes over TCP', () => {
  it('exchanges a message over the o2 protocol', async () => {
    const [a, b] = await Promise.all([startNode('a'), startNode('b')])
    const remoteId = await a.dial(b.multiaddrs[0]!)

    expect(remoteId).toBe(b.peerId)
    expect(a.transport.peers).toContain(b.peerId)

    // A block request is the simplest round trip that proves the protocol works.
    const bytes = new Uint8Array([1, 2, 3, 4])
    const cid = await b.store.put(bytes)
    const fetched = await a.blockstore.get(cid)
    expect(fetched).toEqual(bytes)
  }, 30_000)

  it('carries a message larger than the wire chunk size', async () => {
    const [a, b] = await Promise.all([startNode('a'), startNode('b')])
    await a.dial(b.multiaddrs[0]!)

    // 100 KiB — many chunks, so the drain/backpressure path and the reassembly
    // path both run. A framing bug shows up as a truncated or corrupted block,
    // which the CID check turns into a hard failure rather than a silent one.
    const big = new Uint8Array(100 * 1024)
    for (let i = 0; i < big.length; i++) big[i] = (i * 31) & 0xff
    const cid = await b.store.put(big)

    const fetched = await a.blockstore.get(cid)
    expect(fetched).toEqual(big)
    expect((await blockCid(fetched!)).equals(cid)).toBe(true)
    expect(a.blockstore.rejected).toBe(0)
  }, 30_000)
})

describe('NET-01 — a redundant job with every execution remote', () => {
  it('completes 4 shards at R=2 across two worker nodes', async () => {
    const [submitter, w1, w2] = await Promise.all([startNode('s'), startNode('w1'), startNode('w2')])
    await Promise.all([submitter.dial(w1.multiaddrs[0]!), submitter.dial(w2.multiaddrs[0]!)])

    // Only the submitter holds the module. The workers have empty stores and must
    // pull it — this is "code moves to data", over a socket.
    const moduleCid = await submitter.store.put(MODULE_WRITES_PARTITION)
    expect(await w1.store.has(moduleCid)).toBe(false)
    expect(await w2.store.has(moduleCid)).toBe(false)

    const executors = [
      new RemoteExecutor(w1.peerId, submitter.rpc, 'dispatches-unauthenticated'),
      new RemoteExecutor(w2.peerId, submitter.rpc, 'dispatches-unauthenticated'),
    ]
    const result = await submitJob(
      {
        moduleCid,
        shards: [{ a: 0 }, { a: 1 }, { a: 2 }, { a: 3 }].map((value) => ({ value, label: 'public' as const })),
        executors,
        nodes: publicNodes(executors),
        redundancy: 2,
      },
      submitter.store,
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.job.complete).toBe(true)
    expect(
      result.job.shards.map((s) => (s.verification.status === 'agreed' ? partitionOf(s.verification.output) : -1)),
    ).toEqual([0, 1, 2, 3])

    // Every shard agreed, and the agreeing nodes are the two remote peer ids —
    // proof the work actually happened on the other machines.
    for (const shard of result.job.shards) {
      expect(shard.verification.status).toBe('agreed')
      if (shard.verification.status !== 'agreed') continue
      expect(shard.verification.replicas).toBe(2)
      expect([...shard.verification.agreeing].sort()).toEqual([w1.peerId, w2.peerId].sort())
    }

    // R=2 over 4 shards is exactly 2x the useful work.
    expect(result.job.verificationMultiplier).toBeCloseTo(2, 6)

    // Blocks crossed the wire: the module once each despite 4 concurrent shards,
    // plus one input block per shard.
    for (const worker of [w1, w2]) {
      expect(await worker.store.has(moduleCid)).toBe(true)
      expect(worker.blockstore.fetched).toBe(1 + 4)
      expect(worker.blockstore.rejected).toBe(0)
    }
  }, 60_000)

  it('degrades to a reported failure when a worker goes away mid-job', async () => {
    const [submitter, w1, w2] = await Promise.all([startNode('s'), startNode('w1'), startNode('w2')])
    await Promise.all([submitter.dial(w1.multiaddrs[0]!), submitter.dial(w2.multiaddrs[0]!)])
    const moduleCid = await submitter.store.put(MODULE_WRITES_PARTITION)

    // Stop one worker before dispatch. Its replica must fail, and because R=2
    // leaves one surviving execution the shard reports agreement at replicas: 1 —
    // never a thrown job, and never a claim of verification it did not achieve.
    await w2.stop()

    const executors = [
      new RemoteExecutor(w1.peerId, submitter.rpc, 'dispatches-unauthenticated'),
      new RemoteExecutor(w2.peerId, submitter.rpc, 'dispatches-unauthenticated'),
    ]
    const result = await submitJob(
      {
        moduleCid,
        shards: [{ value: { a: 0 }, label: 'public' }],
        executors,
        nodes: publicNodes(executors),
        redundancy: 2,
      },
      submitter.store,
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const verification = result.job.shards[0]!.verification
    expect(verification.status).toBe('agreed')
    if (verification.status !== 'agreed') return
    expect(verification.replicas).toBe(1)
    expect(verification.agreeing).toEqual([w1.peerId])
  }, 60_000)
})

describe('NET-01 — persistence across a restart', () => {
  it('keeps blocks written by one process retrievable by CID after a restart', async () => {
    const [submitter, worker] = await Promise.all([startNode('s'), startNode('w')])
    await submitter.dial(worker.multiaddrs[0]!)

    const moduleCid = await submitter.store.put(MODULE_WRITES_PARTITION)
    const executors = [new RemoteExecutor(worker.peerId, submitter.rpc, 'dispatches-unauthenticated')]
    const result = await submitJob(
      {
        moduleCid,
        shards: [{ a: 0 }, { a: 1 }].map((value) => ({ value, label: 'public' as const })),
        executors,
        nodes: publicNodes(executors),
        redundancy: 1,
      },
      submitter.store,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.job.complete).toBe(true)

    const resultCids = result.job.shards.map((s) =>
      s.verification.status === 'agreed' ? s.verification.resultCid : null,
    )
    expect(resultCids.every((c) => c !== null)).toBe(true)

    // The directory this test handed to `startNode`, not one read back off the node.
    // `FabricNode.store` is typed as the `Blockstore` port, so there is no
    // `.directory` to ask for — which is the point: nothing outside the factory gets
    // to know, or branch on, which adapter is behind it.
    const workerDir = join(workdir, 'w')
    const sizeBeforeRestart = worker.store.size
    expect(sizeBeforeRestart).toBeGreaterThan(0)

    // Full stop, then reopen the same directory — a genuinely new store object
    // with no in-memory state carried over.
    await worker.stop()
    const reopened = await FsBlockstore.open(workerDir)

    expect(reopened.size).toBe(sizeBeforeRestart)
    // The module the worker pulled over the wire is still there, still addressed
    // by the CID the submitter computed.
    const persisted = await reopened.get(moduleCid)
    expect(persisted).toEqual(MODULE_WRITES_PARTITION)

    // And the submitter's own results survived on its side too.
    for (const cid of resultCids) {
      if (cid === null) continue
      expect(await submitter.store.has(cid)).toBe(true)
    }
  }, 60_000)
})

describe("DATA-09 and AUTH-03's serving half — three node shapes, four dispatches", () => {
  /**
   * `startNode` is the same factory call `bin/agent.ts` makes — no test-only bypass,
   * no hand-built fabric. Until Phase 15 this block proved one thing: a node built
   * this way is guarded *before anyone opts in*, and opting in changes the outcome
   * over real RPC. It now has to prove that **and** AUTH-03's serving half, because
   * the two gates are stacked and the outer one hides the inner.
   *
   * The shape of the problem, which is why this is four dispatches over three nodes
   * rather than a two-line edit (15-CONTEXT.md Risk 3). `authorize` runs before
   * `execute`, so on a node with no pinned owner key the capability refusal arrives
   * first and `guardSovereignty` never runs. DATA-09's own refusal is therefore
   * reachable by exactly one node shape: pinned to the owner, given that owner's key,
   * and still not cleared. Without `pinnedNode` below, this phase would quietly delete
   * an existing guarantee's only production-path test while leaving a green suite.
   */
  it('refuses unpinned, refuses uncleared at the sovereignty gate, accepts pinned-and-cleared, refuses that same node with no chain', async () => {
    const [submitter, defaultNode, pinnedNode, clearedNode] = await Promise.all([
      startNode('s3'),
      startNode('default'),
      startNode('pinned', {
        sovereignty: { ownerId: 'alice', ownerKey: OWNER_KEY, canExecuteSovereign: false },
      }),
      startNode('cleared', {
        sovereignty: { ownerId: 'alice', ownerKey: OWNER_KEY, canExecuteSovereign: true },
      }),
    ])
    await Promise.all([
      submitter.dial(defaultNode.multiaddrs[0]!),
      submitter.dial(pinnedNode.multiaddrs[0]!),
      submitter.dial(clearedNode.multiaddrs[0]!),
    ])

    const moduleCid = await submitter.store.put(MODULE_WRITES_PARTITION)
    const inputCid = await submitter.store.put(new Uint8Array([0x80]))

    const sovereignTask: Task = {
      moduleCid,
      inputCid,
      partitionIndex: 0,
      partitionCount: 1,
      label: 'sovereign',
      ownerId: 'alice',
    }

    // 1. The safe default, observed. A node started with no `sovereignty` option at
    // all refuses even a chain that is entirely valid for it.
    //
    // **The refusal has moved, and the old string is gone.** Before Phase 15 this node
    // refused at `guardSovereignty`, with 'sovereignty' and its own peer id in the
    // reason. It now refuses one step earlier, for want of a pinned owner key. Do not
    // restore the old assertion by rewording the refusal — the point of the pinned
    // node below is that the old refusal still has a test, on the one node shape that
    // can still reach it.
    const unpinned = await new RemoteExecutor(
      defaultNode.peerId,
      submitter.rpc,
      chainSupplierFor(defaultNode.peerId),
    ).execute(sovereignTask)
    expect(unpinned.ok).toBe(false)
    if (unpinned.ok) return
    expect(unpinned.reason).toContain('unauthorized')
    expect(unpinned.reason).toContain('alice')

    // 2. DATA-09's production-path proof, restored. Pinned to alice and holding
    // alice's key, so the chain verifies and `authorize` returns null — and then the
    // sovereignty gate refuses for want of clearance, naming itself.
    const uncleared = await new RemoteExecutor(
      pinnedNode.peerId,
      submitter.rpc,
      chainSupplierFor(pinnedNode.peerId),
    ).execute(sovereignTask)
    expect(uncleared.ok).toBe(false)
    if (uncleared.ok) return
    expect(uncleared.reason).toContain('sovereignty')
    expect(uncleared.reason).toContain(pinnedNode.peerId)

    // 3. Pinned, keyed and cleared: the same task with the same chain is accepted.
    const accepted = await new RemoteExecutor(
      clearedNode.peerId,
      submitter.rpc,
      chainSupplierFor(clearedNode.peerId),
    ).execute(sovereignTask)
    expect(accepted.ok).toBe(true)

    // 4. The control that makes assertion 3 mean something. Same node, same task, one
    // argument changed: no chain. Without this reading, "the cleared node accepts" is
    // equally well explained by an authorizer that accepts everything.
    const unchained = await new RemoteExecutor(
      clearedNode.peerId,
      submitter.rpc,
      'dispatches-unauthenticated',
    ).execute(sovereignTask)
    expect(unchained.ok).toBe(false)
    if (unchained.ok) return
    expect(unchained.reason).toContain('no capability chain supplied')
  }, 60_000)
})

describe('DET-03 — a production node runs only a module a pinned anchor vouched for', () => {
  /**
   * Read through `node.executor` directly, not over RPC, and that is the point rather
   * than a shortcut. The guard is composed once at construction, inside the same
   * expression `serveAgent` is handed — so a caller that bypasses the wire entirely
   * gets the identical refusal a remote dispatch would. That is the property the
   * comment above `guardSovereignty`'s composition already claims for its own subject;
   * these read it for this one. Deleting the composition line in `fabric-node.ts`
   * fails every case below with RPC untouched.
   */
  async function fixture(
    name: string,
    trustAnchors: FabricNodeOptions['trustAnchors'],
  ): Promise<{ node: FabricNode; moduleCid: CID; inputCid: CID }> {
    const node = await startNode(name, { trustAnchors })
    const moduleCid = await node.store.put(MODULE_WRITES_PARTITION)
    const inputCid = await node.store.put(new Uint8Array([0x80]))
    return { node, moduleCid, inputCid }
  }

  it('executes a task the pinned anchor signed, and refuses the same task with the record omitted', async () => {
    const { node, moduleCid, inputCid } = await fixture('anchored', [publisher.pub])

    // The positive control, and it comes first deliberately: without it every refusal
    // below is equally well explained by a node that refuses everything.
    const signed = await node.executor.execute(
      taskFor(moduleCid, inputCid, recordFor(publisher.priv, moduleCid)),
    )
    expect(signed.ok).toBe(true)

    const bare = await node.executor.execute(taskFor(moduleCid, inputCid))
    expect(bare.ok).toBe(false)
    if (bare.ok) return
    expect(bare.reason).toContain('signed name record')
    expect(bare.reason).toContain(moduleCid.toString())
  }, 60_000)

  it('refuses a record signed by a key that was never pinned', async () => {
    const { node, moduleCid, inputCid } = await fixture('impostor', [publisher.pub])

    const outcome = await node.executor.execute(
      taskFor(moduleCid, inputCid, recordFor(impostor.priv, moduleCid)),
    )
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.reason).toContain('not a pinned trust anchor')
    expect(outcome.reason).toContain(impostor.pub)
  }, 60_000)

  it('trusts nobody when the anchor set is empty, and refuses signed and bare alike', async () => {
    // An empty set is a node that has been told to trust nobody. That is the correct
    // reading of an empty set and is deliberately not special-cased into meaning the
    // opt-out. No binary produces this value — it is reachable only from TypeScript —
    // and it is asserted because the type admits it.
    const { node, moduleCid, inputCid } = await fixture('nobody', [])

    const signed = await node.executor.execute(
      taskFor(moduleCid, inputCid, recordFor(publisher.priv, moduleCid)),
    )
    expect(signed.ok).toBe(false)

    const bare = await node.executor.execute(taskFor(moduleCid, inputCid))
    expect(bare.ok).toBe(false)
  }, 60_000)

  it('runs an unsigned task when the call site wrote down that it wants one', async () => {
    // The escape hatch, doing exactly what it says and nothing more. Without this the
    // literal could be a no-op nobody would notice.
    const { node, moduleCid, inputCid } = await fixture('unsigned', 'runs-unsigned-artifacts')

    const outcome = await node.executor.execute(taskFor(moduleCid, inputCid))
    expect(outcome.ok).toBe(true)
  }, 60_000)

  it('answers a remote dispatch the same way it answers a local one', async () => {
    // The guard sits at construction, so the two routes cannot disagree. This is the
    // one case that reads the refusal back over a real socket, which is what says the
    // reason survives the wire rather than only the outcome.
    const [submitter, worker] = await Promise.all([
      startNode('s-det03'),
      startNode('w-det03', { trustAnchors: [publisher.pub] }),
    ])
    await submitter.dial(worker.multiaddrs[0]!)

    const moduleCid = await submitter.store.put(MODULE_WRITES_PARTITION)
    const inputCid = await submitter.store.put(new Uint8Array([0x80]))
    const remote = new RemoteExecutor(worker.peerId, submitter.rpc, 'dispatches-unauthenticated')

    const bare = await remote.execute(taskFor(moduleCid, inputCid))
    expect(bare.ok).toBe(false)
    if (bare.ok) return
    expect(bare.reason).toContain('signed name record')

    const signed = await remote.execute(
      taskFor(moduleCid, inputCid, recordFor(publisher.priv, moduleCid)),
    )
    expect(signed.ok).toBe(true)
  }, 60_000)
})

describe('bin/agent.ts names its anchors on the way in and on the way out', () => {
  const AGENT: string = readFileSync(fileURLToPath(new URL('./bin/agent.ts', import.meta.url)), 'utf8')

  it('offers the flag in its usage line', () => {
    expect(AGENT).toContain('--trust-anchor')
  })

  it('prints the set it actually pinned, not the one the source says it should', () => {
    // An anchor is a public key, so publishing it discloses nothing, and it converts
    // "the default is what the source says" into a reading a parent process can take.
    // Plan 14-05 takes it across a real process boundary; this only asserts the field
    // is in the line, which is the half that can be checked without spawning.
    expect(AGENT).toContain('trustAnchors')
  })
})
