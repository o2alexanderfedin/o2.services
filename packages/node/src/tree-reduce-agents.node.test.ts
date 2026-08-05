import { spawn } from 'node:child_process'
import type { ChildProcessByStdio } from 'node:child_process'
import type { Readable, Writable } from 'node:stream'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ed25519 } from '@noble/curves/ed25519.js'
import {
  MemoryBlockstore,
  canonicalCid,
  executeReduce,
  fabricCombiner,
  publicNodes,
  rendezvousRank,
  signName,
  submitJob,
  toHex,
} from '@o2/core'
import type { CanonicalValue, CombineTask, JobResult, NameRecord, ReduceTree } from '@o2/core'
import { RemoteExecutor, encodeRequest, parseResponse, reduceJob, remoteCombineDispatch } from '@o2/net'
import { CID } from 'multiformats/cid'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
// Test-only relative import — see the note in packages/net/src/distributed.test.ts.
import { MODULE_WRITES_PARTITION } from '../../core/src/executor/fixtures.ts'
import { FabricNode } from './fabric-node.ts'
import { FsBlockstore } from './fs-blockstore.ts'

/**
 * ROADMAP Phase 16 criteria 1, 2 and 3 — the reduce across eight real `bin/agent.ts`
 * operating-system processes.
 *
 * Plan 16-02 established the mechanism over `MemoryNetwork`
 * (`packages/net/src/reduce-job.test.ts`). That is deliberately not enough for criterion
 * 1, which names `bin/agent.ts`: eight endpoints inside one Vitest process share a heap,
 * an event loop and a module registry, so a subtle shared-state dependency would pass.
 * `two-process.node.test.ts` makes exactly that argument for the map; this file is the
 * same argument applied to combines. Every assertion below re-makes an in-process twin
 * over processes, and none is weaker than its twin.
 *
 * Four facts a reader needs in order not to misread this file.
 *
 * **1. Eight spawned agents is nearly triple this repository's previous maximum.**
 * `sovereignty-placement.node.test.ts` spawns three, and so does `two-process.node.test.ts`.
 * Memory, startup wall-clock and teardown behaviour at this scale had never been exercised
 * here before. Every timeout below is sized deliberately against a measurement taken from
 * this file's own runs, and none is copied from the three-process files.
 *
 * **2. The submitter dials outward, one connection per agent, and the direction is the
 * whole reason eight is reachable at all.** `LIBP2P_INBOUND_CONNECTION_THRESHOLD` is 5
 * **per host** (`packages/libp2p/src/constants.ts:65`) and
 * `LIBP2P_MAX_INCOMING_PENDING_CONNECTIONS` is 10 (`:43`). `bin/bench.ts` publishes its
 * real-transport ladder as excluded above ~5 nodes for precisely this: there every node
 * dials the requestor, so the requestor absorbs N inbound connections from one host.
 * Inverted, each agent sees exactly one inbound connection and the submitter makes eight
 * outbound dials, which nothing caps. Should a run ever hit that ceiling anyway, the
 * standing instruction is to publish the measurement rather than quietly reduce N.
 *
 * **3. The submitter's `rpcTimeoutMs` is short, and that is NET-10 showing through — not
 * a property of the reduce.** A refusal reaches a requestor as a timeout (NET-10), and
 * `DEFAULT_RPC_TIMEOUT_MS` is 30 000 (`packages/net/src/rpc.ts:25`). Combines do not need
 * a short budget and nothing here should be read as saying they do; see `standUp` for what
 * the number actually has to cover.
 *
 * **4. One host. This is not a cross-machine or distributed-hardware result and must
 * never be called one.** Eight OS processes on this machine is the testing standard for
 * this criterion rather than a compromise — separate processes share no heap, no event
 * loop and no module registry, which is exactly the boundary criterion 1 is about — but
 * the label matters, and `report.ts`'s derived `SAME-MACHINE` marker enforces the same
 * discipline for the benchmark.
 *
 * **What this file does not show: MR-02.** No partial computed here is computed over an
 * owner's own data. Every job below is a public one whose shard inputs travel to the
 * executors by CID, so data moves map-side by construction. MR-02's map-side half is
 * **unmeasured by this file**, and unmeasured is not met. What would measure it: a job
 * whose inputs carry an owner label and land on that owner's node, with Phase 13's egress
 * guard refusing the raw input's egress and the coverage report naming what stayed home.
 *
 * ---
 *
 * **HISTORY. Nothing below is skipped and all three criteria pass — this section records
 * why they did not, because the defect is more instructive than the fix.**
 *
 * Written when criteria 1, 2 and 3 were **NOT MET**, for a reason this file was the
 * first thing in the repository able to see: **`runCombine` refused every combine
 * on every real node.** `packages/net/src/agent.ts` gated the combine branch on
 * `options.authorize !== 'serves-unauthenticated'`, and both real node classes —
 * `FabricNode` (`packages/node/src/fabric-node.ts:764`) and `BrowserNode`
 * (`packages/browser/src/browser-node.ts:616`) — hardcode a real
 * `authorizeCapability(...)`. There is no flag, and no configuration, by which
 * `bin/agent.ts` produces a node that answers a combine.
 *
 * The gate's own comment states its premise: *"Every production call site passes the
 * sentinel today, so this is a no-op now."* **That premise is false.** Only the two
 * benchmark call sites (`bin/bench.ts:332`, `:371`) pass the sentinel; the two real ones
 * do not, and both predate the gate. So the branch has been a real refusal on 100% of
 * real nodes since the moment it was written, and Plan 16-02 could not see it because
 * every in-process fabric it tested over builds `serveAgent({...SENTINELS})` — with
 * `authorize: 'serves-unauthenticated'` among them.
 *
 * That is exactly the failure this plan exists to catch, arriving in the shape the
 * project keeps warning about: **the decision keys on what kind of node something is** —
 * "does this node have an authorizer at all" — rather than on the mechanism, and a fabric
 * cheaper than the real one could not observe it.
 *
 * Opening the gate was an admission-policy decision, not a test fix: it deleted a
 * refusal Plan 16-02 asserted deliberately and proved able to fail
 * (`packages/net/src/combine.test.ts`, with a counting blockstore showing zero reads
 * precede it). Plan 16-03 therefore **measured the blocker and stopped**, rather than
 * changing an auth path in another plan's file, and left the criteria skipped so a
 * reader could not mistake an unmeasured criterion for a met one.
 *
 * **The owner ruled on 2026-07-31: route combine through the same `Authorizer` as
 * `exec`.** Plan 16-05 did so, removed the three `.skip`s, and deleted the
 * blocker-measurement `describe` that this gate made meaningful. **Two limits of that
 * fix are recorded at `agent.ts` rather than here**, because that is where they would
 * change: a combine presents no `Task`-shaped value, so `Authorizer` widened to a union;
 * and the combine frame carries no sovereignty label, so `authorizeCapability` admits
 * every combine today. Verification measured the consequence — no node this repository
 * can start is able to refuse one — and recorded it as an open finding, not a closed one.
 *
 * **The criteria below were never speculative.** 16-03 ran all three against a locally
 * opened gate (restored byte-exact, not committed): 1491 ms, 1606 ms, 1867 ms. 16-05 then
 * measured 1495 / 1518 / 2004 ms with the gate genuinely removed, and verification
 * reproduced the pre-fix failure by restoring the gate — all four red, criterion 1 at
 * `expected +0 to be 3`. Three independent readings, no assertion adjusted between them.
 *
 * Six mutations were planted one at a time on top of the opened gate, each watched
 * failing against a different assertion:
 *
 * | Mutation | Where | Assertion it turned red | Reading |
 * |---|---|---|---|
 * | A — the combine happens locally | `combine.ts` | criterion 1, 3(ii) `holders` | `[]` vs `[<root executor>]` |
 * | B — the tree is a left fold | `reduce.ts` | criterion 1, shape | `nodes` 7 vs 3 |
 * | C — combine returns its first input | `agent.ts` | criterion 1, bit-for-bit | root CID differs |
 * | D — a null dispatch breaks the walk | `reduce.ts` | criterion 2 (c) `outcome.ok` | `false` vs `true` |
 * | E — `redundancy` not passed through | `reduce-job.ts` | criterion 3 `minReplicas` | 1 vs 2 |
 * | F — the fetch-back `put` deleted | `combine.ts` | criterion 3, first probe delta | +0 vs +1 |
 *
 * Under A, measurement 3(i) — the `executedBy`/`rendezvousRank` comparison — **still
 * passed**, because `executeReduce` records the executor the ranking chose regardless of
 * who actually did the work. That is the whole reason 3(ii) exists, and it is the
 * difference between an assertion that checks the ranking against itself and one that
 * measures. Under C, measurements 1, 2 and 3 all still passed, which is why the
 * bit-for-bit reference cannot be dropped either. Under B, `reduce.test.ts` kept **26 of
 * 28** green — both single-node reference comparisons among them — because a fold is a
 * valid association of an associative combiner, which is why the shape assertion cannot
 * be dropped in favour of the bit-for-bit one.
 */

const AGENT = fileURLToPath(new URL('./bin/agent.ts', import.meta.url))

/**
 * DET-03 is not this file's subject — the reduce across a process boundary is. The
 * record exists so that subject can be reached at all: `bin/agent.ts` pins the demo's
 * kernel anchor by default, so an unsigned job would have every map dispatch refused
 * before a single partial existed to combine.
 */
const publisher = (() => {
  // Seed 58 — distinct from every other fixture key in the repository.
  const priv = new Uint8Array(32).fill(58)
  return { priv, pub: toHex(ed25519.getPublicKey(priv)) }
})()

function recordFor(moduleCid: CID): NameRecord {
  return signName(publisher.priv, {
    name: 'tree-reduce-agents-fixture',
    cid: moduleCid,
    version: 1,
    expiresAt: Date.now() + 3_600_000,
  })
}

/**
 * stdin is piped and never written to, so the child's type carries a `Writable` for it.
 *
 * The pipe is the point rather than the type: `bin/agent.ts` watches fd 0 and leaves when
 * it closes, which is what stops a spawned agent outliving a parent that was killed rather
 * than asked. Handing it `ignore` would put `/dev/null` on fd 0 and silently opt this file
 * out. See `orphan-leash.node.test.ts`, which demonstrates it and guards this line.
 */
type AgentProcess = ChildProcessByStdio<Writable, Readable, Readable>

interface Agent {
  readonly peerId: string
  readonly multiaddrs: readonly string[]
  readonly dir: string
  readonly child: AgentProcess
}

let workdir: string
const agents: Agent[] = []
const nodes: FabricNode[] = []

/**
 * Spawn an agent process and wait for its one-line address handshake.
 *
 * **The argument list is the measured form of "combining needed no new flag".**
 * `--dir` and `--trust-anchor` are the whole of it: `--trust-anchor` is DET-03's,
 * pre-existing, and load-bearing for the reason given on `publisher` above. There is no
 * combine flag, no reduce flag and no timeout flag — `bin/agent.ts` grew none for this
 * phase, because a flag would make combining a property of *what kind of node* something
 * is, which is the one thing this project has ruled out. A binary that had grown a
 * *required* combine flag would fail to start here; one that had grown an optional one
 * would still not be being passed it.
 */
async function spawnAgent(name: string, extraArgs: readonly string[] = []): Promise<Agent> {
  const dir = join(workdir, name)
  const child: AgentProcess = spawn(
    process.execPath,
    [AGENT, '--dir', dir, '--trust-anchor', publisher.pub, ...extraArgs],
    {
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  )

  const handshake = await new Promise<{ peerId: string; multiaddrs: string[] }>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`agent ${name} did not announce in time: ${stderr}`)), 60_000)
    let stdout = ''
    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
      const newline = stdout.indexOf('\n')
      if (newline === -1) return
      clearTimeout(timer)
      try {
        // Named fields only. The handshake line carries a third — `trustAnchors` — and
        // reading it positionally would have broken when that was added.
        resolve(JSON.parse(stdout.slice(0, newline)) as { peerId: string; multiaddrs: string[] })
      } catch (cause) {
        reject(cause instanceof Error ? cause : new Error(String(cause)))
      }
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`agent ${name} exited early with ${String(code)}: ${stderr}`))
    })
  })

  const agent: Agent = { ...handshake, dir, child }
  agents.push(agent)
  return agent
}

/** SIGTERM, then wait for the process to actually be gone. */
async function stopAgent(agent: Agent): Promise<void> {
  if (agent.child.exitCode !== null || agent.child.signalCode !== null) return
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      agent.child.kill('SIGKILL')
      resolve()
    }, 10_000)
    agent.child.on('exit', () => {
      clearTimeout(timer)
      resolve()
    })
    agent.child.kill('SIGTERM')
  })
}

/**
 * SIGKILL, and wait for the child to be gone.
 *
 * Distinct from `stopAgent` on purpose. `bin/agent.ts` installs SIGTERM/SIGINT handlers
 * that call `node.stop()`, so a SIGTERMed agent *leaves* — it closes its connections and
 * exits cleanly. Criterion 2 is about a node that **vanishes**, which is the case the
 * fabric is built for and the only one where a peer discovers the loss by an RPC that
 * never comes back.
 */
async function killAgent(agent: Agent): Promise<void> {
  if (agent.child.exitCode !== null || agent.child.signalCode !== null) return
  await new Promise<void>((resolve) => {
    agent.child.on('exit', () => resolve())
    agent.child.kill('SIGKILL')
  })
}

/**
 * Read the 4-byte little-endian partition index the fixture guest emits.
 *
 * **Copied from Plan 16-02's version (`packages/net/src/reduce-job.test.ts`), not from
 * `packages/net/src/distributed.test.ts`, and the one difference is load-bearing.** That
 * copy returns `-1` on a shape it does not recognise, which is right where it lives
 * because it feeds an equality check that simply fails. Here a `-1` would produce a
 * `partition--1` key and a perfectly well-formed leaf, hiding a bad guest output inside a
 * valid-looking aggregate. Throwing routes it into `reduceJob`'s per-shard try/catch,
 * which turns it into a named failure. All three entry points into this projection —
 * 16-02's, this file's, and the benchmark's — must decode identically.
 */
function partitionOf(output: CanonicalValue): number {
  const p = (output as { p?: unknown }).p
  if (!(p instanceof Uint8Array) || p.length !== 4) throw new Error('not a partition output')
  return new DataView(p.buffer, p.byteOffset, 4).getUint32(0, true)
}

/**
 * The job's projection: an agreed shard output becomes a `{counts, rows}` partial.
 *
 * Three things about it, because each is a reading a later reader would otherwise get
 * wrong.
 *
 * **Why not `(_output, partitionIndex) => …`.** That form makes every leaf a pure
 * function of an integer this test process also holds, so the reference in measurement 4
 * and the measured root would be the same arithmetic computed twice — and *nothing any of
 * the eight agent processes computed would enter either side*. A guest returning any
 * agreed output whatsoever would yield the identical root CID. Decoding the output is
 * what makes the bit-for-bit comparison a measurement of the fabric rather than of the
 * test, and the corrupted-output case below is what proves that dependency exists.
 *
 * **Why distinctness still matters.** `deriveReduceTree` dedupes on contributor id plus
 * CID, so two shards projecting to the same value would silently shrink the tree and the
 * shape assertion would fail for a reason unrelated to the wire. The fixture emits a
 * distinct index per shard, so distinctness is inherited from the guest rather than
 * imposed by the test — the stronger arrangement.
 *
 * **What it is.** A per-job projection, requestor-side. The map output shape
 * (`{p: <4 LE bytes>}`) and the combiner's monoid (`{counts, rows}`) are not the same
 * thing, and the projection is the only place they meet.
 */
const project = (output: CanonicalValue): CanonicalValue => ({
  counts: { [`partition-${partitionOf(output)}`]: 1 },
  rows: 1,
})

/** An output the fixture guest would have produced for `partitionIndex`. */
function partitionOutput(partitionIndex: number): CanonicalValue {
  const p = new Uint8Array(4)
  new DataView(p.buffer).setUint32(0, partitionIndex, true)
  return { p }
}

/** The shard count, and therefore the leaf count. */
const SHARDS = 8

/**
 * Map redundancy.
 *
 * 2, so every shard is verified by two independent processes rather than attested by one.
 * NET-09's early-stream cliff is the thing that would force this to 1; if a run ever
 * reports `MaxEarlyStreamsError: Too many early streams`, the instruction is to drop this
 * to 1 and record in the summary that the map is consequently unverified while the
 * aggregation over it still is — never to reduce the agent count, which is the criterion.
 */
const MAP_REDUNDANCY = 2

/**
 * What this file tells `reduceJob` it checks combine signatures against — nothing.
 *
 * **A truthful statement about this rig rather than a convenience.** Nothing here enrols:
 * no provider is spawned, no agent is given an `enrollment` option, so every `FabricNode`
 * resolves `certificate === null` and hands `serveAgent` the `'signs-nothing'` sentinel.
 * There is no combine signature in this fabric to check against anything.
 *
 * An issuer set would be the wrong answer rather than a stricter one: it would say this
 * requestor checked signatures and found none, which is a different claim from *this
 * requestor checks none*, and the aggregate receipt would report the two identically. A
 * named constant rather than five copies of this paragraph, and the literal is in the
 * name so each call site still reads what it chose.
 */
const CHECKS_NO_COMBINE_SIGNATURES = 'checks-no-combine-signatures' as const

interface Fabric {
  readonly agents: readonly Agent[]
  readonly submitter: FabricNode
  readonly moduleCid: CID
  readonly executorIds: readonly string[]
}

/**
 * Spawn `agentCount` agents, start the submitter, dial outward, seed the module.
 *
 * **`rpcTimeoutMs: 10_000` is a configuration choice, not a figure derived from
 * anything.** What it has to cover, and what it deliberately does not:
 *
 * - Long enough for a cold-start `exec` dispatch: the agent pulling
 *   `MODULE_WRITES_PARTITION` and its shard input from the submitter (both local hits at
 *   the submitter, because the submitter authored them) and compiling the module.
 * - Long enough for one combine round trip plus the directed `block` round trip that
 *   follows it. Since Plan 16-02 the combine node's input reads are local hits at the
 *   submitter as well, so neither leg enters a fan-out.
 * - Short enough that a dead node's fallthrough gives up on *this* budget rather than on
 *   the 30 000 default, which is what keeps criterion 2's repair inside a test timeout.
 * - **The agents' side of the budget is not ours.** `bin/agent.ts` exposes no timeout
 *   flag, so every agent runs the hard-coded 30 000 default. Wherever an agent waits on
 *   the submitter the submitter gives up first — the direction that keeps a stall a
 *   fallthrough rather than a hang.
 * - The path this budget deliberately does **not** cover is a request for a block nobody
 *   holds, whose cost through the circular wait `combine.ts` documents is an accepted,
 *   unmeasured residue. Nothing in this file asks for such a CID. If a run overruns and
 *   reports a combine input as unobtainable, that residue is the cause and not the
 *   reduce — measure what the overrun actually was rather than raising a number over it.
 *
 * Spawned with `Promise.all` because sequential startup is where the wall-clock goes at
 * this count.
 */
async function standUp(agentCount: number): Promise<Fabric> {
  const spawned = await Promise.all(Array.from({ length: agentCount }, (_, i) => spawnAgent(`a${i}`)))

  const submitter = await FabricNode.start({
    blockstoreDir: join(workdir, 'submitter'),
    listen: ['/ip4/127.0.0.1/tcp/0'],
    rpcTimeoutMs: 10_000,
    // The same authority the agents were spawned with. A submitter declaring a different
    // one from the nodes it dispatches to would be a lie in a file nobody would re-read.
    trustAnchors: [publisher.pub],
  })
  nodes.push(submitter)

  // Outward, one dial per agent — see fact 2 in the file docstring.
  const dialed = await Promise.all(spawned.map((agent) => submitter.dial(agent.multiaddrs[0] as string)))
  expect([...dialed].sort()).toEqual(spawned.map((a) => a.peerId).sort())

  // Only the submitter has the module. Every agent is a fresh process with an empty
  // directory, so it cannot possibly have it except by asking.
  const moduleCid = await submitter.store.put(MODULE_WRITES_PARTITION)

  return { agents: spawned, submitter, moduleCid, executorIds: spawned.map((a) => a.peerId) }
}

/** Run the map phase across every agent, and refuse to proceed unless it completed. */
async function runMap(fabric: Fabric): Promise<JobResult> {
  const executors = fabric.executorIds.map(
    (id) => new RemoteExecutor(id, fabric.submitter.rpc, 'dispatches-unauthenticated'),
  )
  const result = await submitJob(
    {
      moduleCid: fabric.moduleCid,
      moduleRecord: recordFor(fabric.moduleCid),
      shards: Array.from({ length: SHARDS }, (_, i) => ({ value: { a: i }, label: 'public' as const })),
      executors,
      nodes: publicNodes(executors),
      redundancy: MAP_REDUNDANCY,
      onQuorumShortfall: 'runs-at-available-redundancy',
    },
    fabric.submitter.store,
  )

  // A reduce over a job that did not complete would be measuring the wrong failure.
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error('the map did not run')
  expect(result.job.complete).toBe(true)
  return result.job
}

/** Every shard's agreed output, in shard order. Throws if any shard did not agree. */
function agreedOutputs(job: JobResult): readonly CanonicalValue[] {
  return job.shards.map((shard) => {
    if (shard.verification.status !== 'agreed') throw new Error(`shard ${shard.partitionIndex} did not agree`)
    return shard.verification.output
  })
}

/**
 * The single-process reference: project each output here, merge them in ONE call, hash.
 *
 * One `fabricCombiner` call over all eight is a different association from the tree's
 * two-level one. That the two agree bit-for-bit is the associativity claim, and it is the
 * only thing enforcing it — commutativity is **not** claimed and must not be reintroduced.
 */
async function referenceRoot(outputs: readonly CanonicalValue[]): Promise<string> {
  const reference = await canonicalCid(fabricCombiner(outputs.map((output) => project(output))))
  if (!reference.ok) throw new Error('the reference will not canonicalise')
  return reference.cid.toString()
}

/**
 * The CIDs a level-1 combine node reads, from the tree's own leaf table.
 *
 * `ReduceTreeNode.children` are leaf **identities** (`contributorId\0cid`), not addresses
 * — the tree keeps the two apart on purpose, because two contributors offering the same
 * bytes must remain two leaves. A combine reads addresses, so the identity has to be
 * resolved through `tree.leaves` rather than parsed out of the id.
 */
function leafCidsOf(tree: ReduceTree, nodeIndex: number): readonly CID[] {
  const node = tree.nodes[nodeIndex]
  if (node === undefined) throw new Error(`no tree node at ${nodeIndex}`)
  return node.children.map((child) => {
    const leaf = tree.leaves.find((candidate) => candidate.id === child)
    if (leaf === undefined) throw new Error(`node ${nodeIndex} child ${child} is not a leaf`)
    return CID.parse(leaf.cid)
  })
}

/** Peer ids of the agent directories that hold `cid`, read after the agents are gone. */
async function holdersOf(candidates: readonly Agent[], cid: string): Promise<readonly string[]> {
  const held: string[] = []
  for (const agent of candidates) {
    const store = await FsBlockstore.open(agent.dir)
    if (await store.has(CID.parse(cid))) held.push(agent.peerId)
  }
  return held
}

beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'o2-reduce-'))
})

/**
 * Inner 10 s, outer 60 s — and the relationship between the two clocks is the point.
 *
 * `stopAgent` gives a wedged process 10 s before falling back to SIGKILL. Vitest's
 * default `hookTimeout` is also 10 s, so with no explicit budget the two clocks are armed
 * for the same instant, the framework's fires first, the SIGKILL fallback can never run,
 * and a wedged agent is reported as an anonymous hook timeout naming no step. A test that
 * arms two clocks must make the framework's the larger.
 *
 * **Why 60 s rather than the 20 s the three-process files use, and what the number is
 * sized against.** Not the normal case: measured teardown here is **4–33 ms** for eight
 * agents and **5 ms** for nine (four runs, 2026-07-31, `performance.now()` around the
 * whole hook body — the 33 ms is the first run of a file, the rest settle at 4–5 ms).
 * Teardown is therefore nowhere near the budget when nothing is wrong, and sizing against
 * that measurement would be sizing against the wrong term.
 *
 * The budget is dominated entirely by the pathological case. One wedged child costs the
 * full 10 s SIGKILL fallback; the children are stopped concurrently, so nine wedged
 * children still cost ~10 s rather than ninety. The margin above that covers `rm -rf` of
 * nine blockstore directories and a `FabricNode` that is itself unwinding connections to
 * nine peers which have just died. 60 s is a configuration choice with that headroom, and
 * the only hard requirement it has to satisfy is being **larger than the inner 10 s**.
 */
afterEach(async () => {
  await Promise.all(nodes.splice(0).map((node) => node.stop().catch(() => {})))
  await Promise.all(agents.splice(0).map((a) => stopAgent(a).catch(() => {})))
  await rm(workdir, { recursive: true, force: true })
}, 60_000)

/**
 * Test timeout: 300 000, a configuration choice above the 120 000 this suite's existing
 * three-process tests use. Named against what it has to cover rather than multiplied out:
 * eight `FabricNode.start()` calls in child processes plus one in the test process, eight
 * outward dials, the map dispatch at redundancy 2, the reduce's combines, and — added by
 * Plan 16-02 — one directed `block` round trip per combine fetching each result back to
 * the submitter.
 *
 * **Measured, so that this number is not mistaken for one:** with the combine gate open,
 * criterion 1 runs in **1491 ms**, criterion 2 in **1606 ms**, and criterion 3 — which
 * spawns nine agents rather than eight — in **1867 ms** (2026-07-31, unloaded). The
 * timeout is therefore roughly 160× the measured cost, which is deliberate: it is a
 * ceiling for a loaded machine, not an estimate of the work. **If a run ever exceeds it,
 * do not raise it before checking whether the overrun is the fan-out for a block nobody
 * holds** — symptom: a combine input reported unobtainable. A timeout raised over a stall
 * records the stall as normal.
 */
const PROCESS_TEST_TIMEOUT = 300_000

/**
 * **What this describe used to assert, and why it now asserts the opposite.**
 *
 * Plan 16-03 wrote it as *"the blocker: a real `bin/agent.ts` process refuses every
 * combine"*, and it passed: `serveAgent` refused any combine on a node holding a real
 * `Authorizer`, `bin/agent.ts` starts a `FabricNode`, and `FabricNode` installs
 * `authorizeCapability`. That was the whole of Phase 16's defect, and 16-03 deliberately
 * committed it as a **passing** test so it would go red the moment the defect was fixed
 * rather than quietly keep describing a repaired build.
 *
 * 16-05 fixed it, so this went red, so it was rewritten to say what is now true. The
 * reading it takes is the same reading in the same place — a raw `combine` frame against
 * a spawned agent process — and only the expectation moved.
 */
describe('AUTH-03 / 16-05 — a real bin/agent.ts process answers a combine', () => {
  /**
   * Two readings a layer apart, because either alone is arguable.
   *
   * (i) The **frame**, verbatim: a spawned `FabricNode` — which installs
   * `authorizeCapability` and has no flag to say otherwise — answers a raw `combine` with
   * a result address and an empty reason. The result is compared **bit for bit** against
   * a reference computed in this process from the production combiner, so this is not
   * merely "it stopped refusing": the remote process computed the right aggregate.
   *
   * (ii) The **driver**, end to end, which is what makes (i) load-bearing rather than a
   * curiosity: `reduceJob` over eight agent processes now produces an aggregate. The
   * inverse readings — `combines: 0`, `executedBy.size: 0`, every tree node in `failed`,
   * `rootCid: null` — are what this same test measured before the fix.
   */
  it('answers with the aggregate the production combiner computes, and the reduce completes', async () => {
    const fabric = await standUp(8)
    const { submitter, executorIds } = fabric

    // (i) — a raw frame, exactly the one the production dispatcher sends.
    const a = await canonicalCid(project(partitionOutput(0)))
    const b = await canonicalCid(project(partitionOutput(1)))
    if (!a.ok || !b.ok) throw new Error('the fixture partials will not canonicalise')
    await submitter.store.put(a.bytes)
    await submitter.store.put(b.bytes)

    const reply = parseResponse(
      await submitter.rpc.request(
        executorIds[0] as string,
        encodeRequest({ kind: 'combine', combineId: 'probe', inputCids: [a.cid, b.cid], level: 1 }),
      ),
    )
    expect(reply?.kind).toBe('combine')
    if (reply?.kind !== 'combine') return
    expect(reply.reason).toBe('')

    // Computed here, from the production combiner, so a peer answering with *something*
    // does not pass. This is the process-level twin of `combine.test.ts`'s in-process
    // reference — and the frame-level assertion the criteria below do not make.
    const reference = await canonicalCid(fabricCombiner([project(partitionOutput(0)), project(partitionOutput(1))]))
    expect(reference.ok).toBe(true)
    if (!reference.ok) return
    expect(reply.resultCid?.toString()).toBe(reference.cid.toString())

    // (ii) — the production driver, end to end, over eight OS processes.
    const job = await runMap(fabric)
    const result = await reduceJob(job, {
      rpc: submitter.rpc,
      executors: executorIds,
      blockstore: submitter.store,
      project,
      trustedIssuers: CHECKS_NO_COMBINE_SIGNATURES,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const { outcome, tree } = result

    // The tree shape is unchanged by the fix, and is asserted here so a failure below can
    // be told apart from a tree that came out differently.
    expect(tree.leaves).toHaveLength(SHARDS)
    expect(tree.nodes).toHaveLength(3)
    expect(tree.depth).toBe(2)

    // Every one of these read the opposite before 16-05.
    expect(outcome.ok).toBe(true)
    expect(outcome.rootCid).not.toBeNull()
    expect(outcome.combines).toBe(3)
    expect(outcome.executedBy.size).toBeGreaterThan(0)
    expect([...outcome.failed]).toEqual([])
  }, PROCESS_TEST_TIMEOUT)
})

/**
 * **Criterion 1 — MEASURED.** Skipped by 16-03 on the combine refusal above; the `.skip`
 * was removed by 16-05 in the same change that routed a combine through `options.authorize`.
 *
 * Not one assertion here was rewritten to make it pass. 16-03 wrote it exactly as it now
 * runs and recorded that against the unfixed tree it failed at `expected +0 to be 3` on
 * `outcome.combines` — i.e. at the blocker and not before it, which is what licenses
 * keeping the rest rather than re-deriving them.
 */
describe('MR-04…MR-07 — eight bin/agent.ts processes walk one derived tree', () => {
  it('produces an aggregate bit-identical to a single-process reference, and exactly one agent directory holds the root', async () => {
    const fabric = await standUp(8)
    const { agents: spawned, submitter, executorIds } = fabric

    // Measurement 1 — eight live nodes, every id off a distinct child's stdout
    // handshake. **No deletion in production code turns this red.** It is a property of
    // the harness rather than of the fabric — a precondition check, reported as one.
    expect(spawned).toHaveLength(8)
    expect(new Set(spawned.map((a) => a.peerId)).size).toBe(8)
    expect([...executorIds].sort()).toEqual(spawned.map((a) => a.peerId).sort())

    const job = await runMap(fabric)

    // `submitter.store`, not `submitter.blockstore`. The leaves must be resident on the
    // LOCAL tier so the submitter's own `serveAgent` can answer a block request for them
    // from a combine node; `FetchingBlockstore.put` delegates to the local tier anyway,
    // so passing the fetching wrapper would work and would only obscure the intent.
    // Redundancy is left at its default of 1 — criterion 3 is where 2 is measured.
    const result = await reduceJob(job, {
      rpc: submitter.rpc,
      executors: executorIds,
      blockstore: submitter.store,
      project,
      trustedIssuers: CHECKS_NO_COMBINE_SIGNATURES,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const { outcome, tree, skipped } = result

    // All eight shards agreed, so the aggregate covers the whole job.
    expect(skipped).toEqual([])

    // Measurement 2 — it is a tree, not a scan.
    //
    // The leaf count is this test's own input. The other two figures are **transcribed
    // from 16-02-SUMMARY.md, where Plan 16-02 measured them by reading them off
    // `deriveReduceTree` over the same eight leaves at the same fanout** — never computed
    // here. Layout recorded there: L1(4), L1(4), L2(2).
    expect(tree.leaves).toHaveLength(SHARDS)
    expect(tree.nodes).toHaveLength(3)
    expect(tree.depth).toBe(2)
    // What separates a tree from a one-level merge without needing a figure at all. A
    // linear scan produces zero combines and an empty `executedBy`, so the two cannot be
    // confused.
    expect(tree.depth).toBeGreaterThan(1)
    expect(outcome.combines).toBe(tree.nodes.length)
    expect(outcome.executedBy.size).toBe(tree.nodes.length)

    // The level above the leaves is reachable at all: a tree deeper than one level cannot
    // pass this unless a combine above level 1 found its inputs — which is only true
    // because `remoteCombineDispatch` fetches each result back to the submitter.
    expect(outcome.ok).toBe(true)
    expect(outcome.failed).toEqual([])
    expect(outcome.disagreements).toEqual([])

    // Measurement 3, half (i) — rendezvous assignment. On its own this checks the
    // ranking against itself, since `executeReduce` records the executor that same pure
    // function chose, which is why Plan 16-02 recorded its in-process twin as having no
    // falsifying deletion. **At process level it does have one**, and that was measured
    // rather than argued: under Mutation F — the directed fetch-back deleted — this line
    // went red with the root executed by a peer the ranking did not name. The ranked-first
    // peer could not reach its inputs, because a level-1 result lives only on the
    // executor that produced it, so the walk fell through to a peer that happened to hold
    // both level-1 results locally. `outcome.ok` and `failed` above **stayed green**
    // through that, and the run cost 61.5 s against a healthy 1.49 s — the fan-out
    // residue `combine.ts` documents, measured here rather than predicted.
    //
    // Half (ii) below is what makes this a measurement in the ordinary case.
    for (const node of tree.nodes) {
      expect(outcome.executedBy.get(node.id)).toBe(rendezvousRank(node.id, executorIds)[0])
    }

    // Measurement 4 — bit-for-bit. Both sides depend on what the eight agent processes
    // actually produced, because the projection decodes each guest's output.
    const outputs = agreedOutputs(job)
    expect(outcome.rootCid).toBe(await referenceRoot(outputs))

    // Measurement 5 — the dependency proved rather than asserted. Corrupt one of the
    // eight agreed outputs and the reference moves. Without this, an index-derived
    // projection could be reintroduced later and every other assertion here would stay
    // green while nothing any agent computed entered either side of measurement 4.
    const corrupted = [...outputs]
    corrupted[3] = partitionOutput(999)
    expect(await referenceRoot(corrupted)).not.toBe(outcome.rootCid)

    // Measurement 3, half (ii) — the root block was written by a different OS process,
    // addressed by the CID this one computed.
    //
    // The agents are stopped first on purpose: reading a directory a live process is
    // still writing to is a race, and `two-process.node.test.ts` establishes the
    // stop-then-read order for exactly this reason. `afterEach` stopping an
    // already-stopped agent is a no-op — `stopAgent` returns immediately once `exitCode`
    // or `signalCode` is set.
    await Promise.all(spawned.map(stopAgent))

    expect(outcome.rootCid).not.toBeNull()
    const holders = await holdersOf(spawned, outcome.rootCid as string)
    expect(holders).toEqual([outcome.executedBy.get(tree.rootId)])
    // The count itself, stated separately from the identity: at the default redundancy of
    // 1 exactly one process did the root combine. Criterion 3 below reads **2** off this
    // same instrument at redundancy 2, which is what makes this a reading rather than a
    // constant.
    expect(holders).toHaveLength(1)
  }, PROCESS_TEST_TIMEOUT)
})

/**
 * **Criterion 2 — MEASURED.** Same blocker as criterion 1, same removal in 16-05.
 */
describe('MR-05 / MR-06 — a combine node SIGKILLed mid-reduce is repaired elsewhere', () => {
  it('completes the reduce from a different process, with no state having moved', async () => {
    const fabric = await standUp(8)
    const { agents: spawned, submitter, executorIds } = fabric
    const job = await runMap(fabric)

    // A healthy run first — this is the reference, and **a reference that is itself null
    // proves nothing**. `rootCid === healthyRoot` would be `null === null` and pass on a
    // run that produced no aggregate at all, so (a) and (b) are the instrument check that
    // has to come before every other assertion in this test.
    const healthy = await reduceJob(job, {
      rpc: submitter.rpc,
      executors: executorIds,
      blockstore: submitter.store,
      project,
      trustedIssuers: CHECKS_NO_COMBINE_SIGNATURES,
    })
    expect(healthy.ok).toBe(true)
    if (!healthy.ok) return
    const { outcome: healthyOutcome, tree } = healthy
    // (a)
    expect(healthyOutcome.rootCid).not.toBeNull()
    const healthyRoot = healthyOutcome.rootCid as string
    // (b)
    expect(healthyOutcome.ok).toBe(true)

    // The victim is the node rendezvous ranking put first for the first level-1 combine,
    // computed before dispatch exactly as `reduce.test.ts` does it in process.
    const victimId = rendezvousRank((tree.nodes[0] as { id: string }).id, executorIds)[0] as string
    const victimAgent = spawned.find((agent) => agent.peerId === victimId)
    if (victimAgent === undefined) throw new Error('the ranking named a peer that is not an agent')

    // **The positive control for (g), taken on the healthy run.** Undisturbed, this
    // combine *is* executed by the victim; after the kill it must not be. Without this
    // line, `not.toBe(victimId)` is a silence — it would also pass if the ranking never
    // chose the victim in the first place.
    expect(healthyOutcome.executedBy.get((tree.nodes[0] as { id: string }).id)).toBe(victimId)

    /*
     * **Why `executeReduce` directly here and not `reduceJob`.** `reduceJob` builds its
     * dispatch internally, which is correct: a driver that accepted a caller-supplied
     * dispatch would be carrying a test-only hook in production code, and this
     * repository's standing rule is that a hook exists to record a decision. So the
     * mid-flight kill is staged one layer down, wrapping the **production**
     * `remoteCombineDispatch`, over the **production** combine handler, on a tree the
     * **production** driver derived. What is bypassed is `reduceJob`'s
     * projection-and-store prologue, and that already ran above.
     *
     * **Why that is not the whole criterion.** Measurement 4 below re-runs the reduce
     * through `reduceJob` itself with the victim already dead. Measurement 1 covers
     * "mid-flight"; measurement 4 covers "through the production entry point". Neither
     * alone is the criterion — the pair is.
     */
    let killed = false
    // The same options `reduceJob` builds internally: the submitter's endpoint, and its
    // LOCAL store as the place each combine's result is fetched back to. A different
    // store here would break level 2 for a reason unrelated to the kill.
    const dispatch = remoteCombineDispatch({ rpc: submitter.rpc, blockstore: submitter.store })
    const outcome = await executeReduce({
      tree,
      executors: executorIds,
      dispatch: async (task, executorId) => {
        if (!killed && task.level === 1 && executorId === victimId) {
          killed = true
          // SIGKILL, awaited — the process is gone before we dial it.
          await killAgent(victimAgent)
        }
        return dispatch(task, executorId)
      },
    })

    // The staging actually happened. Without this, a run in which the wrapper never fired
    // would satisfy every assertion below by simply never losing a node.
    expect(killed).toBe(true)
    // The kill was a vanish, not a shutdown. **No deletion in production code turns this
    // red** — it measures the test's own kill, and it is a precondition for the statement
    // below rather than a proof of anything the fabric does.
    expect(victimAgent.child.signalCode).toBe('SIGKILL')

    // Measurement 2 — recomputed elsewhere, and **the job still completes**. Seven
    // assertions, of which (a) and (b) above are the instrument check.
    expect(outcome.ok).toBe(true) // (c)
    expect(outcome.failed).toEqual([]) // (d)
    expect(outcome.rootCid).toBe(healthyRoot) // (e)
    expect(outcome.recomputes).toBeGreaterThan(0) // (f)
    expect(outcome.executedBy.get((tree.nodes[0] as { id: string }).id)).not.toBe(victimId) // (g)
    // And the bit-for-bit reference, recomputed in *this* run rather than inherited from
    // criterion 1's `it`. "Completes" is (c) and (d); "with the correct aggregate" is this.
    expect(outcome.rootCid).toBe(await referenceRoot(agreedOutputs(job)))

    // Measurement 3(i) — no state transfer, first reading: there is nowhere on the wire
    // to put state. The frame for the very task that was recomputed carries exactly four
    // keys, and its inputs are addresses. This guard fires on **addition**, which is the
    // direction a payload arrives from.
    const level1Inputs = leafCidsOf(tree, 0)
    const frame = encodeRequest({
      kind: 'combine',
      combineId: (tree.nodes[0] as { id: string }).id,
      inputCids: level1Inputs,
      level: 1,
    })
    expect(Object.keys(frame as object).sort()).toEqual(['combineId', 'inputCids', 'kind', 'level'])
    const wireInputs = (frame as { readonly inputCids: readonly unknown[] }).inputCids
    expect(wireInputs).toHaveLength(level1Inputs.length)
    expect(wireInputs.every((value) => CID.asCID(value) !== null)).toBe(true)

    // Measurement 4 — the production entry point completes with the node gone.
    //
    // `second.ok` alone is **not** the claim and must never stand for it: `ok` says only
    // that a reduce could be attempted, while `outcome.ok` says whether it produced an
    // aggregate. Plan 16-02 measured a run that reported `ok: true` with
    // `outcome.ok: false` and no aggregate whatsoever.
    const second = await reduceJob(job, {
      rpc: submitter.rpc,
      executors: executorIds,
      blockstore: submitter.store,
      project,
      trustedIssuers: CHECKS_NO_COMBINE_SIGNATURES,
    })
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.outcome.ok).toBe(true)
    expect(second.outcome.failed).toEqual([])
    expect(second.outcome.rootCid).toBe(healthyRoot)

    // Measurement 3(ii) — no state transfer, second reading, from the other end. The
    // replacement process holds every input of the combine it recomputed, and it never
    // received any of them: it asked for each by CID.
    //
    // This is `two-process.node.test.ts`'s move, and its force here is different — there
    // it proved persistence, here it proves the *absence* of a state channel. Agents are
    // stopped first for the same race reason as criterion 1.
    const replacementId = outcome.executedBy.get((tree.nodes[0] as { id: string }).id)
    const replacement = spawned.find((agent) => agent.peerId === replacementId)
    if (replacement === undefined) throw new Error('the recompute names a peer that is not an agent')
    await Promise.all(spawned.map(stopAgent))

    const replacementStore = await FsBlockstore.open(replacement.dir)
    for (const cid of level1Inputs) {
      expect(await replacementStore.has(cid)).toBe(true)
    }
  }, PROCESS_TEST_TIMEOUT)
})

/**
 * **Criterion 3 — MEASURED.** Same blocker, same removal in 16-05.
 *
 * And a second limit that is **not** the blocker and survives it — **corrected 2026-08-04
 * by Plan 20-03, because the sentence this paragraph carried was true of one function and
 * false of the layer beneath it.** It read: *"`executeReduce` has **no late-arrival
 * channel** — it walks the ranking, stops at `wanted` replicas, and there is no production
 * path on which a result arriving after that can be received at all."*
 *
 * The first clause is true and stays true: `executeReduce` breaks out of the ranking walk
 * at `wanted` replicas and has nothing to do with a result that arrives afterwards. **The
 * second clause is false.** `packages/net/src/rpc.ts` — search `late or duplicate reply` —
 * is `if (entry === undefined) return`, and a reply whose pending entry the timeout has
 * already deleted is received there, decoded, and dropped. That line is the production
 * path, it predates this phase, and nothing in Phase 16 had to be built for it.
 *
 * So the *"arriving late"* clause never needed a handler; it needed a **producer**, and
 * Phase 16 had none because it had no recovery path. `late-combine.node.test.ts` is that
 * producer — SIGSTOP the ranked-first process, let the requestor's `rpcTimeoutMs` elapse,
 * let the walk take its replicas elsewhere, SIGCONT — and it **counts** the arrival on the
 * requestor's transport rather than assuming it, with the no-SIGCONT control proved able
 * to fail. Criterion 6 is measured there.
 *
 * **This file's own reading is unchanged and the duplicate below is still staged by this
 * test.** What it measures is the dedupe across real processes: same inputs → same bytes →
 * same CID → no second entry. That is a different claim from the arrival, it was met here,
 * and 20-03 deliberately does not re-state it.
 */
describe('MR-07 — two replicas dedupe, and a duplicate from a fresh process costs nothing', () => {
  it('holds the root in exactly two directories, and a ninth process re-answering adds no entry', async () => {
    const fabric = await standUp(8)
    const { agents: spawned, submitter, executorIds } = fabric
    const job = await runMap(fabric)

    // Step 1 — the reduce at redundancy 2.
    const result = await reduceJob(job, {
      rpc: submitter.rpc,
      executors: executorIds,
      blockstore: submitter.store,
      project,
      redundancy: 2,
      trustedIssuers: CHECKS_NO_COMBINE_SIGNATURES,
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const { outcome, tree } = result
    expect(outcome.ok).toBe(true)
    expect(outcome.minReplicas).toBe(2)
    // Two independent processes produced each combine and their answers deduped, because
    // they carry the same CID. A disagreement is reported, never voted on.
    expect(outcome.disagreements).toEqual([])

    /*
     * Step 2 — the staged duplicate, **while all eight are still live**. The ordering
     * between steps 2 and 3 looks incidental and is not: a step-2 dispatch placed after
     * step 3 would have no live agent to dispatch to, and a step-3 read taken before
     * step 2 would be reading directories `ninth` is still writing.
     *
     * Called `ninth`, not `replacement` — criterion 2 uses "replacement" for the
     * *existing* agent that recomputed the victim's combine, and reusing the word here is
     * how a reader conflates a recompute with a fresh process.
     *
     * Three things about `ninth` a reader needs:
     *
     * - **Its peer id is one no earlier agent had.** `FabricNode` persists no identity
     *   key, so every agent process — fresh or restarted — comes up as a new peer. That
     *   does not weaken the reading; the property is that a process which has never seen
     *   these inputs produces the same bytes. But a reader assuming identity persistence
     *   would draw the wrong conclusion from the ids not matching.
     * - **Its directory starts empty.** `--dir` is a path `mkdtemp` created for this test
     *   and nothing has written to, so before it can combine at all it pulls every one of
     *   `tree.nodes[0]`'s input partials from the submitter by CID. How many that is is a
     *   measurement, read off the derived tree below — not a number derived on paper.
     * - **It is dispatched two level-1 combines and never the root**, which is why step 3
     *   does not look in its directory for the root: its absence there would measure
     *   nothing.
     */
    const ninth = await spawnAgent('ninth')
    await submitter.dial(ninth.multiaddrs[0] as string)

    /*
     * **The instrument is a probe store, and that is part of the assertion rather than a
     * convenience.** Two candidates are disqualified, both by properties of code this
     * phase added:
     *
     * (i) Two `submitter.blockstore.get(cid)` calls with a size read between them is
     *     green with the combine branch deleted entirely: `FetchingBlockstore.get`
     *     returns on a local hit *before* consulting its source, and `#fetchAndVerify`
     *     writes the block locally on the way past. That version measures the cache.
     * (ii) `submitter.store` is disqualified too. `reduceJob` hands its `blockstore`
     *     straight to `remoteCombineDispatch`, whose directed fetch-back ends in
     *     `blockstore.put`, so step 1 has **already** written `tree.nodes[0]`'s and
     *     `tree.nodes[1]`'s results there. A re-put of identical bytes leaves `size`
     *     unchanged, so every delta taken there would read +0 — *including the two that
     *     are supposed to read +1*, and the test could not go green.
     *
     * So: an empty `MemoryBlockstore`, with no network fallback of any kind, handed to a
     * dispatcher constructed for this measurement alone.
     *
     * **Both +1s are POSITIVE CONTROLS and both are required.** The first proves the
     * instrument is connected before the +0 is read; the third proves the store can still
     * grow *after* it, so the +0 is a reading about two producers agreeing rather than
     * about a store that never grows. Neither is a negative control.
     */
    const probe = new MemoryBlockstore()
    const dispatch = remoteCombineDispatch({ rpc: submitter.rpc, blockstore: probe })

    const first: CombineTask = {
      nodeId: (tree.nodes[0] as { id: string }).id,
      inputCids: leafCidsOf(tree, 0).map((cid) => cid.toString()),
      level: 1,
    }
    const second: CombineTask = {
      nodeId: (tree.nodes[1] as { id: string }).id,
      inputCids: leafCidsOf(tree, 1).map((cid) => cid.toString()),
      level: 1,
    }
    // The count of partials `ninth` must pull before it can combine — read off the tree,
    // and recorded rather than derived.
    expect(first.inputCids.length).toBeGreaterThan(1)

    const beforeFirst = probe.size
    const firstProduct = await dispatch(first, spawned[0]?.peerId as string)
    expect(firstProduct).not.toBeNull()
    expect(probe.size - beforeFirst).toBe(1)

    const beforeDuplicate = probe.size
    const duplicateProduct = await dispatch(first, ninth.peerId)
    expect(duplicateProduct).not.toBeNull()
    // One block, two independent producers, one entry.
    expect(duplicateProduct?.cid.toString()).toBe(firstProduct?.cid.toString())
    expect(probe.size - beforeDuplicate).toBe(0)

    const beforeSecond = probe.size
    const secondProduct = await dispatch(second, ninth.peerId)
    expect(secondProduct).not.toBeNull()
    // A different task over a disjoint set of leaves, hence a different CID — the store
    // that did not grow for a second copy of one block does grow for a different one.
    expect(secondProduct?.cid.toString()).not.toBe(firstProduct?.cid.toString())
    expect(probe.size - beforeSecond).toBe(1)

    // Step 3 — only now stop everything, then read the eight original directories.
    await Promise.all([...spawned, ninth].map(stopAgent))
    expect(outcome.rootCid).not.toBeNull()
    const holders = await holdersOf(spawned, outcome.rootCid as string)
    expect(holders).toHaveLength(2)
  }, PROCESS_TEST_TIMEOUT)
})
