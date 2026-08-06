/**
 * CHURN-05 / DATA-01 — a cross-owner job with an owner's node stopped returns its answer
 * **and** the number of owners behind it.
 *
 * Three owners, each with its own spawned `bin/agent.ts` process enrolled under its own
 * `--user-key`, and a job of four sovereign shards — one for the first owner, **two** for
 * the second, one for the third. Three readings are taken over that one fabric:
 *
 * | arm | what changed from the arm above it | coverage |
 * |---|---|---|
 * | control | — | **3/3**, `complete` |
 * | stopped owner | the third owner's process is dead and the requestor has dropped it | **2/3**, that owner named in `missing` |
 * | partial owner | the second owner's node states room for one of its two shards | **1/3** |
 *
 * **Exactly one input moves per step**, which is what makes the sequence a measurement
 * rather than three fixtures that happen to disagree. The job spec, the module, the
 * requestor, the redundancy and the placer are identical in all three; the first step
 * changes only the candidate set discovery returns, the second changes only one integer a
 * node states about its own room.
 *
 * ## The load-bearing word is *silently*, and the reading is a pair
 *
 * A partial aggregate is not a defect. An owner may legitimately be offline, and the
 * answer over the rest may be exactly what the caller wanted. What must not happen is that
 * the caller cannot tell. So every arm below asserts **both** halves: the job **returned an
 * answer** — the other owners' shards agreed, with result CIDs — **and** its coverage is
 * not `complete`. Either alone is half a reading: a job that failed outright would also
 * report incomplete coverage, and a job that reported nothing at all would satisfy any
 * assertion about what it did not say.
 *
 * ## The entry-point substitution, recorded here and not only in a planning document
 *
 * `bin/agent.ts` **submits no job** — measured 2026-08-04, `grep -c 'submitJob\|JobSpec\|
 * executeVerified'` returns 0 — it is a serving node whose only stdout is a handshake
 * line. *"A cross-owner job run through `bin/agent.ts`"* is therefore satisfiable only as
 * **"a job run ACROSS `bin/agent.ts` processes"**: an in-process requestor `FabricNode`
 * submitting to spawned agents, which is `discovery-agents.node.test.ts`'s shape,
 * `owner-domain-agents.node.test.ts`'s, and this file's. Phase 19 learned that a
 * substitution living in a plan reaches nobody reading the test.
 *
 * ## Which case carries the owed-against-done gate, and which does not
 *
 * **The partial-owner arm carries it, and nothing else here does.** A stopped owner
 * delivers nothing, so it lands in `missing` under the shipped rule *and* under the wrong
 * one that counts an owner on its first landed shard — it is a reading of the gate's
 * *existence*, never of its shape. The second owner is the one that separates them: its
 * node is **alive, dialled, and has just agreed a shard**, and it still does not count,
 * because one of its two shards did not land. `submitJob`'s own site reproduces
 * `coordinator.ts`'s argument for that rule — *"an owner with four shards, three of which
 * failed, would be reported as having contributed, and `complete` would be true over a
 * quarter of their data"* — and this is that argument over real processes.
 *
 * Watched: planting `>= owed` → `>= 1` at that site reddens the partial-owner arm and
 * leaves the control and stopped arms green. The exact text is in `20-10-SUMMARY.md`.
 *
 * ## How the partial owner is arranged, and why the obvious arrangement cannot work
 *
 * The second owner's node **states room for one shard**, through `JobSpec.admit` —
 * SCHED-02 / owner ruling D2, whose whole mechanism is that `planWithOffers` keeps a
 * running headroom tally from what each node said about itself and offers a later shard
 * only to nodes with room left. So one of that owner's two shards is placed and the other
 * is never offered to anybody, while the owner is up and answering.
 *
 * **The obvious arrangement — spawn that agent with `--max-concurrent-tasks 1` and let its
 * own capacity refuse the second shard — was tried, and it destroys the control.** It is
 * the first thing a reader will propose, so it is recorded as a measurement rather than as
 * an argument: with that flag on the two-shard owner's agent, this file's **control** arm
 * reads `covered: 2/3` (`expected 2 to be 3`, run 2026-08-05). The reason is that the flag
 * sets one number and that number binds in *every* arm — `serveAgent`'s `exec` branch
 * reserves a slot around the executor call and refuses a concurrent second, and `submitJob`
 * dispatches every shard of a job under one `Promise.all` — so the owner is partial before
 * anything has gone wrong, and there is no arm left in which it is fully covered. A
 * node-stated slot count cannot separate the two arms because it is the same integer on
 * both sides. What separates them is a *requestor-side* dial, which is exactly what
 * `JobSpec.admit` is: *"a requestor that supplies this bounds itself"*.
 *
 * **Nor can stopping part of that owner's node set do it**, which is the other arrangement
 * that suggests itself. Give the owner two nodes and stop one, and the generation loop
 * places the orphaned shard on the survivor — that repair is 20-01's whole subject — so
 * the owner ends up fully covered by the mechanism that exists to make it so.
 *
 * **So the admission control is this fixture's dial and not its subject.** What is under
 * test is what `submitJob` reports about an owner that delivered one shard of two; how
 * that owner came to deliver one of two is the fixture's business. It is arranged through
 * a production field, over a real placer, on a live fabric — not by hand-building a
 * `JobResult`, which would measure nothing.
 *
 * ## The sovereignty assertion here is a GUARD, and is not this file's subject
 *
 * DATA-01's placement claim belongs to `sovereignty-placement.node.test.ts` and Phase 12.
 * It is asserted once at the end of this file for one reason: a cross-owner fixture with a
 * node stopped is exactly the shape in which a sovereignty leak would be **invisible** —
 * every reading above would be unchanged if a stopped owner's row had been copied onto
 * somebody else's node on the way. So each surviving owner's own store is read after its
 * process is stopped and asserted to hold its own rows and **none** of any other owner's.
 * That is a guard against this fixture shape, not a measurement of criterion 4.
 *
 * ## What this file cannot redden on
 *
 * - **`coverageOf`'s own set arithmetic.** Which owners are missing given an expected set
 *   and a contributed set is `packages/core/src/coverage.test.ts`'s, and the per-owner gate
 *   in the kernel is `submit.test.ts`'s. This file proves the composition **over real
 *   processes**: that the denominator moves when an owner's process really does go away.
 * - **Sovereignty placement itself.** The guard above says a row is not somewhere it should
 *   not be; that a *sovereign shard is narrowed before load is consulted* is Phase 12's
 *   reading and no assertion here would fail if that ordering were reversed.
 * - **`describeCoverage`'s wording.** It is compared through the function rather than
 *   transcribed — `bench-attestation.node.test.ts`'s discipline with `describeAttestation`
 *   — so the assertion is that this job's report renders the kernel's sentence, not that
 *   somebody copied it correctly on one day.
 *
 * ## Guest choice, measured rather than inherited
 *
 * `MODULE_WRITES_PARTITION`, never `MODULE_ECHOES_INPUT`. Plan 20-09 measured what the
 * identity guest does to a job containing a sovereign shard: the output is byte-identical
 * to the sovereign input, `takeSovereignHold` has registered exactly those bytes, and the
 * owner's own process refuses its own result — `egress refused: bafyreibqswyxuij…`. That is
 * DATA-10 refusing a real leak rather than a bug, and the workaround anybody would reach
 * for (exempt the owner's own answer) *is* the leak.
 *
 * ## Budget and seeds
 *
 * One provider plus three agents plus one in-process requestor — `owner-domain-agents.node.
 * test.ts`'s exact spawn count, and its budgets (`ANNOUNCE_BUDGET_MS`,
 * `PROCESS_TEST_TIMEOUT`, `VERDICT_DEADLINE_MS`) are reused verbatim rather than
 * re-guessed. Its `spawnAgent`, `stopAgent`, `until` and `writeUserKey` helpers are
 * **faithful copies, not imports**: importing a helper from another `.test.ts`
 * re-registers that file's whole suite, the reason recorded in
 * `certificate-verification.node.test.ts`.
 *
 * Publisher seed **117**, taken against the repository's whole census
 * (`grep -rho 'fill([0-9]\+)' packages | sort -n -u`): 51-53, 56-70 and 113-116 are taken,
 * 117 is not. User seeds **0xca**, **0xcb**, **0xcc** — 0x72/0x73, 0x81/0x82, 0x91-0x95,
 * 0xa1-0xa4, 0xb1/0xb2, 0xb7/0xb8, 0xc1/0xc2, 0xc9, 0xd1, 0xd7-0xda and 0xe1/0xe2 are
 * taken. Two fixtures sharing a key couple two files that have nothing to do with each
 * other.
 */
import { execFileSync, spawn } from 'node:child_process'
import type { ChildProcessByStdio } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Readable, Writable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { ed25519 } from '@noble/curves/ed25519.js'
import { canonicalCid, delegate, describeCoverage, signName, submitJob, toHex } from '@o2/core'
import type {
  Admission,
  AdmissionControl,
  CanonicalValue,
  Delegation,
  JobResult,
  NameRecord,
  NodeCertificate,
  NodeDescriptor,
  Offer,
  PublicKeyHex,
  Task,
} from '@o2/core'
import { SEED_BYTES, audienceKeyOf, peerIdForNodeKey } from '@o2/libp2p'
import { discoverCandidates } from '@o2/net'
import type { CapabilitySupplier } from '@o2/net'
import type { RemoteExecutor } from '@o2/net'
import type { CID } from 'multiformats/cid'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
// Test-only relative import — see the note in packages/net/src/distributed.test.ts.
import { MODULE_WRITES_PARTITION } from '../../core/src/executor/fixtures.ts'
import { FabricNode } from './fabric-node.ts'
import { FsBlockstore } from './fs-blockstore.ts'

const AGENT = fileURLToPath(new URL('./bin/agent.ts', import.meta.url))
const BENCH = fileURLToPath(new URL('./bin/bench.ts', import.meta.url))
const BENCH_SOURCE = readFileSync(new URL('./bin/bench.ts', import.meta.url), 'utf8')
const REPO = fileURLToPath(new URL('../../..', import.meta.url))

/** Announce budget — `owner-domain-agents.node.test.ts`'s, unchanged. */
const ANNOUNCE_BUDGET_MS = 60_000
/** Per-`it` budget. Four spawns, three enrolments with a dial each, and three real jobs. */
const PROCESS_TEST_TIMEOUT = 300_000
/** How long a peer verdict may take to settle after a dial — or to clear after an exit. */
const VERDICT_DEADLINE_MS = 30_000
/** How long `bin/bench.ts --quick` gets. Measured at ~5 s by Plan 20-09; this is headroom. */
const BENCH_BUDGET_MS = 180_000

/** The build authority every spawned agent pins. Seed 117 — see this file's header. */
const publisher = (() => {
  const priv = new Uint8Array(SEED_BYTES).fill(117)
  return { priv, pub: toHex(ed25519.getPublicKey(priv)) }
})()

/**
 * Three owners, each a **private** half held only in this process.
 *
 * Each is written to a file for `--user-key` — which takes a path and never key material,
 * because argv is world-readable in `ps` — and each is additionally the root every
 * capability chain for that owner's shards is signed with. Once a node's clearance *is*
 * its enrolled user key (Plan 19-09), the key that names an owner and the key that roots
 * that owner's chains are the same key.
 */
const KEEL_PRIVATE = new Uint8Array(SEED_BYTES).fill(0xca)
const MAST_PRIVATE = new Uint8Array(SEED_BYTES).fill(0xcb)
const SPAR_PRIVATE = new Uint8Array(SEED_BYTES).fill(0xcc)
const KEEL: PublicKeyHex = toHex(ed25519.getPublicKey(KEEL_PRIVATE))
/** The owner with **two** shards — the one that ends up partial. */
const MAST: PublicKeyHex = toHex(ed25519.getPublicKey(MAST_PRIVATE))
/** The owner whose process is stopped. */
const SPAR: PublicKeyHex = toHex(ed25519.getPublicKey(SPAR_PRIVATE))

const OWNER_PRIVATE: ReadonlyMap<PublicKeyHex, Uint8Array> = new Map([
  [KEEL, KEEL_PRIVATE],
  [MAST, MAST_PRIVATE],
  [SPAR, SPAR_PRIVATE],
])

/** One operator per owner: three separate people, which is what a cross-owner job is. */
const OPERATOR: ReadonlyMap<PublicKeyHex, string> = new Map([
  [KEEL, 'keel-ops'],
  [MAST, 'mast-ops'],
  [SPAR, 'spar-ops'],
])

/**
 * One row per shard, distinctive enough that a match anywhere means something.
 *
 * `MAST` holds two, which is the whole of the partial-owner arm: an owner is covered only
 * when **every** shard it owes has landed.
 */
const ROWS: readonly { readonly owner: PublicKeyHex; readonly value: CanonicalValue }[] = [
  { owner: KEEL, value: { ssn: '512-08-7731', salary: 61_200, dob: '1983-02-17' } },
  { owner: MAST, value: { ssn: '318-64-9042', salary: 88_400, dob: '1971-06-30' } },
  { owner: MAST, value: { ssn: '905-27-4416', salary: 44_950, dob: '1994-10-09' } },
  { owner: SPAR, value: { ssn: '740-93-1158', salary: 73_050, dob: '1966-12-22' } },
]

/** Which agent directory holds which owner's rows. One node per owner. */
const NODE_OF: ReadonlyMap<PublicKeyHex, string> = new Map([
  [KEEL, 'keel'],
  [MAST, 'mast'],
  [SPAR, 'spar'],
])

function recordFor(name: string, moduleCid: CID): NameRecord {
  return signName(publisher.priv, {
    name,
    cid: moduleCid,
    version: 1,
    expiresAt: Date.now() + 3_600_000,
  })
}

type AgentProcess = ChildProcessByStdio<Writable, Readable, Readable>

interface Handshake {
  readonly peerId: string
  readonly multiaddrs: string[]
  readonly nodeKey: string
  readonly certificate: NodeCertificate | null
  readonly issuerKey: string | null
}

interface Agent extends Handshake {
  readonly name: string
  readonly dir: string
  readonly child: AgentProcess
}

let workdir: string
const agents: Agent[] = []
const nodes: FabricNode[] = []

async function spawnAgent(name: string, extraArgs: readonly string[] = []): Promise<Agent> {
  const dir = join(workdir, name)
  const child: AgentProcess = spawn(
    process.execPath,
    [AGENT, '--dir', dir, '--trust-anchor', publisher.pub, ...extraArgs],
    // `'pipe'` on fd 0 is load-bearing: `bin/agent.ts` arms its orphan leash by watching
    // fd 0, and `'ignore'` hands it a character device, which opts the leash out.
    // `orphan-leash.node.test.ts` fails any spawn site that does that.
    { stdio: ['pipe', 'pipe', 'pipe'] },
  )

  const handshake = await new Promise<Handshake>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`agent ${name} did not announce in time: ${stderr}`)),
      ANNOUNCE_BUDGET_MS,
    )
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
        // Named fields only — the handshake line has grown several times and reading it
        // positionally would have broken on each.
        resolve(JSON.parse(stdout.slice(0, newline)) as Handshake)
      } catch (cause) {
        reject(cause instanceof Error ? cause : new Error(String(cause)))
      }
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`agent ${name} exited early with ${String(code)}: ${stderr}`))
    })
  })

  const agent: Agent = { ...handshake, name, dir, child }
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

/** Stop one agent out of turn, so `afterEach` does not wait on it a second time. */
async function stopAgentNow(agent: Agent): Promise<void> {
  const at = agents.indexOf(agent)
  if (at >= 0) agents.splice(at, 1)
  await stopAgent(agent)
}

/** Is this process demonstrably gone, rather than merely slow? */
function isDead(agent: Agent): boolean {
  return agent.child.exitCode !== null || agent.child.signalCode !== null
}

/**
 * Defined locally rather than imported — see this file's header.
 *
 * `what` may be a thunk, evaluated **at the throw**. Plan 19-08 measured the alternative:
 * a caller interpolating live state into a `string` argument reports the state as it was
 * before the wait, which is empty every time.
 */
async function until(
  predicate: () => boolean,
  timeoutMs: number,
  what: string | (() => string),
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((r) => setTimeout(r, 20))
  }
  throw new Error(`timed out waiting for ${typeof what === 'function' ? what() : what}`)
}

/** `bin/agent.ts` refuses to create a user key — see that flag's comment. */
async function writeUserKey(name: string, seed: Uint8Array): Promise<string> {
  await mkdir(workdir, { recursive: true })
  const path = join(workdir, `${name}.key`)
  await writeFile(path, seed, { mode: 0o600 })
  return path
}

/**
 * AUTH-03's chain supplier, minted per candidate and rooted at **the task's own owner**.
 *
 * A function of the node id, which is what `CandidateOptions.dispatch` became on
 * 2026-08-03 and why: `verifyChain` refuses a chain whose audience is another node, so one
 * supplier shared across a candidate set can serve at most one of them.
 *
 * It is also a function of `task.ownerId`, which `owner-domain-agents.node.test.ts`'s
 * single-owner version did not need to be. Three owners' shards go through one candidate
 * set here, so the root key is selected per task rather than closed over — a supplier
 * rooted at one owner would be refused at every other owner's node with `wrong-audience`'s
 * sibling failure, and the shard would come back unplaceable with nothing obviously wrong.
 *
 * `[]` for a public task is not a stub: a public task has no owner, so there is no key a
 * chain could be rooted at, and `authorizeCapability` returns before it looks.
 */
const dispatchForAnyOwner =
  (nodeId: string): CapabilitySupplier =>
  (task: Task): readonly Delegation[] => {
    if (task.label !== 'sovereign' || task.ownerId === undefined) return []
    const root = OWNER_PRIVATE.get(task.ownerId)
    if (root === undefined) return []
    return [
      delegate(root, {
        ownerId: task.ownerId,
        audience: audienceKeyOf(nodeId),
        abilities: ['execute'],
        // Computed at call time rather than at module load: these suites spawn real
        // processes, and a constant fixed at import would start expiring immediately.
        expiresAt: Date.now() + 60_000,
      }),
    ]
  }

/** What one `admit` answer said, recorded so the headroom mechanism can be read. */
interface OfferRecord {
  readonly shardId: string
  readonly nodeId: string
  readonly accepted: boolean
  readonly slots: number | 'stated-none'
}

/**
 * An `AdmissionControl` in which one named node states room for `slots` shards and every
 * other node states nothing at all.
 *
 * **Accepting while stating a bound is the whole mechanism**, and it is worth separating
 * from the refusal a reader will expect. `planWithOffers` keeps a headroom tally from what
 * each node *stated* and offers a later shard only to nodes with room left — so a node that
 * states one slot and accepts one shard is not asked about the second at all. The second
 * shard is therefore `never-placed` with **no rejection and `probed: 0`**, which is
 * `placement.ts`'s own recorded intent: *"a node held back here was never asked, so it
 * never refused"*.
 *
 * `'states-no-capacity'` for every other node is a **named absence, not a zero**: a
 * requestor that learned nothing bounds nothing, and assuming full would make a node
 * running an older build invisible.
 */
function statesRoom(
  nodeId: string,
  slots: number,
  log: OfferRecord[],
): AdmissionControl {
  return (offer: Offer): Admission => {
    const decision: Admission =
      offer.nodeId === nodeId
        ? { accepted: true, capacity: { slots, inFlight: 0 } }
        : { accepted: true, capacity: 'states-no-capacity' }
    log.push({
      shardId: offer.shardId,
      nodeId: offer.nodeId,
      accepted: decision.accepted,
      slots: decision.capacity === 'states-no-capacity' ? 'stated-none' : decision.capacity.slots,
    })
    return decision
  }
}

interface Fixture {
  readonly providerKey: PublicKeyHex
  readonly byOwner: ReadonlyMap<PublicKeyHex, Agent>
  readonly requestor: FabricNode
  /** One per entry of {@link ROWS}, in the same order — the job's partition inputs. */
  readonly inputCids: readonly CID[]
  readonly moduleCid: CID
  readonly moduleRecord: NameRecord
}

/**
 * One provider, three enrolled agents — one per owner — and one in-process requestor.
 *
 * Every agent is spawned with `--user-key` and **no `--owner-id`**, the derived case Plan
 * 19-09 added: a node's clearance is the public half of the key it enrolled under, so it
 * equals the `ownerId` a discovery-derived descriptor carries. Each gets `--owner-key` (the
 * anchor a capability chain must be rooted at) and `--can-execute-sovereign`, which is what
 * puts that user key into its published `sovereignFor`.
 *
 * **Each owner's rows are seeded into that owner's directory before the spawn, and
 * nowhere else.** That is `PROJECT.md`'s model rather than a convenience: raw sovereign
 * data does not move between nodes, so a row is executable only where its owner already
 * put it. Seeding afterwards races the agent's own open of the same directory —
 * `discovery-agents.node.test.ts`'s recorded reason. It is also what makes the sovereignty
 * guard at the end of this file readable: no other node ever held these bytes, so finding
 * them on one would mean they had travelled.
 */
async function standUp(): Promise<Fixture> {
  const inputCids: CID[] = []
  const bytesByOwner = new Map<PublicKeyHex, Uint8Array<ArrayBuffer>[]>()
  for (const row of ROWS) {
    const encoded = await canonicalCid(row.value)
    if (!encoded.ok) throw new Error('fixture value is not encodable')
    inputCids.push(encoded.cid)
    const held = bytesByOwner.get(row.owner)
    if (held === undefined) bytesByOwner.set(row.owner, [encoded.bytes])
    else held.push(encoded.bytes)
  }

  for (const [owner, name] of NODE_OF) {
    const store = await FsBlockstore.open(join(workdir, name))
    for (const bytes of bytesByOwner.get(owner) ?? []) await store.put(bytes)
    // Every executing node needs the module. Its presence in a *stopped* node's store is
    // also how `owner-domain-agents.node.test.ts` tells "it ran nothing" from "its
    // directory was unreadable"; here it is simply a precondition for running at all.
    await store.put(MODULE_WRITES_PARTITION)
  }

  const provider = await spawnAgent('p', ['--issues-certificates', '--max-issued-per-window', '64'])
  const providerKey = provider.issuerKey
  if (providerKey === null) throw new Error('the provider announced no issuer key')

  const byOwner = new Map<PublicKeyHex, Agent>()
  for (const [owner, name] of NODE_OF) {
    const agent = await spawnAgent(name, [
      '--provider-addr',
      provider.multiaddrs[0] as string,
      '--user-key',
      await writeUserKey(name, OWNER_PRIVATE.get(owner) as Uint8Array),
      '--operator-id',
      OPERATOR.get(owner) as string,
      // AUTH-03's pinned anchor. Deliberately NOT derived by the binary — a clearance may
      // be derived from a signed statement, a trust anchor is configuration.
      '--owner-key',
      owner,
      '--can-execute-sovereign',
    ])
    byOwner.set(owner, agent)
  }

  // The fixture's own premise, asserted rather than assumed. Plan 19-08 recorded the cost
  // of not doing this: a fixture whose owner ids had silently collapsed would read a
  // different denominator and look like a pass.
  for (const [owner, agent] of byOwner) {
    expect(agent.certificate?.userKey).toBe(owner)
    expect(agent.certificate?.operatorId).toBe(OPERATOR.get(owner))
    expect(agent.certificate?.issuer).toBe(providerKey)
  }
  expect(new Set([...byOwner.values()].map((agent) => agent.nodeKey)).size).toBe(3)

  const requestor = await FabricNode.start({
    relayAdmission: 'admits-any-peer',
    startReporting: 'reports-its-own-start',
    blockstoreDir: join(workdir, 'requestor'),
    listen: ['/ip4/127.0.0.1/tcp/0'],
    rpcTimeoutMs: 20_000,
    trustAnchors: [publisher.pub],
    trustedIssuers: [providerKey],
  })
  nodes.push(requestor)

  // Outward, one dial per agent. `LIBP2P_INBOUND_CONNECTION_THRESHOLD` is 5 per host, so a
  // fixture this size must not invert the direction.
  for (const agent of byOwner.values()) await requestor.dial(agent.multiaddrs[0] as string)

  const moduleCid = await requestor.store.put(MODULE_WRITES_PARTITION)

  return {
    providerKey,
    byOwner,
    requestor,
    inputCids,
    moduleCid,
    moduleRecord: recordFor('coverage-writes-partition', moduleCid),
  }
}

/** Executors and descriptors, deduped by node id across one discovery per shard. */
interface Candidates {
  readonly executors: readonly RemoteExecutor[]
  readonly nodes: readonly NodeDescriptor[]
  readonly providersPerShard: readonly number[]
}

/**
 * Discover once **per shard**, and merge.
 *
 * One call per shard rather than one for the job, because `discoverCandidates` answers
 * *"who holds this input and is cleared for this owner"* and both halves are per shard
 * here. The merge is by node id: each owner holds its own rows and no others, so each call
 * returns that owner's single node, and the union is the three-node candidate set
 * `submitJob` is handed.
 *
 * `providersPerShard` is carried out so the fixture's own premise can be read rather than
 * assumed — a shard whose row nobody answered for would produce an empty candidate set and
 * an unplaceable shard that looked exactly like a stopped owner.
 */
async function discoverForShards(fixture: Fixture): Promise<Candidates> {
  const executors = new Map<string, RemoteExecutor>()
  const descriptors = new Map<string, NodeDescriptor>()
  const providersPerShard: number[] = []

  for (const [index, row] of ROWS.entries()) {
    const found = await discoverCandidates(
      { inputCid: fixture.inputCids[index] as CID, sovereignFor: row.owner },
      {
        rpc: fixture.requestor.rpc,
        // `verifiedPeers` and not `transport.peers`: a provider list steers where work
        // goes, so a peer that has not cleared verification does not contribute one.
        peers: () => fixture.requestor.verifiedPeers,
        trustedIssuers: new Set([fixture.providerKey]),
        now: () => Date.now(),
        peerIdFor: peerIdForNodeKey,
        dispatch: dispatchForAnyOwner,
      },
    )
    providersPerShard.push(found.providers)
    for (const executor of found.executors) executors.set(executor.nodeId, executor)
    for (const descriptor of found.nodes) descriptors.set(descriptor.nodeId, descriptor)
  }

  return {
    executors: [...executors.values()],
    nodes: [...descriptors.values()],
    providersPerShard,
  }
}

/** The owners this result reports as having fully delivered, and the ones it does not. */
function coverageOfJob(job: JobResult): {
  covered: number
  total: number
  missing: readonly string[]
  complete: boolean
  rendered: string
} {
  const { coverage } = job
  // **The named arm first, and `describeCoverage` reachable only past it** — the shape
  // every display site has to take, and the one `bin/bench.ts` now takes. A reading that
  // skipped this would be reading a report the union exists to prevent.
  if (coverage === 'defines-no-owners') {
    throw new Error(
      'this job reported the no-owners sentinel; it defines four sovereign shards across ' +
        'three owners, so a sentinel here means the owner set was derived from something ' +
        'other than the job’s own shards',
    )
  }
  return {
    covered: coverage.covered,
    total: coverage.total,
    missing: coverage.missing,
    complete: coverage.complete,
    rendered: describeCoverage(coverage),
  }
}

/** Which partitions this owner owes, and which of them agreed. */
function shardsOf(job: JobResult, owner: PublicKeyHex): {
  owed: readonly number[]
  agreed: readonly number[]
} {
  const owed = ROWS.flatMap((row, index) => (row.owner === owner ? [index] : []))
  const agreed = owed.filter(
    (index) =>
      job.shards.find((shard) => shard.partitionIndex === index)?.verification.status === 'agreed',
  )
  return { owed, agreed }
}

beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'o2-coverage-'))
})

/**
 * 60 s, which must exceed `stopAgent`'s inner 10 s or its SIGKILL fallback could never
 * fire — the inversion three files in this repository carried until 2026-07-31.
 */
afterEach(async () => {
  await Promise.all(nodes.splice(0).map((node) => node.stop().catch(() => {})))
  await Promise.all(agents.splice(0).map((agent) => stopAgent(agent).catch(() => {})))
  await rm(workdir, { recursive: true, force: true })
}, 60_000)

describe('CHURN-05 — a cross-owner job returns its answer and the number of owners behind it', () => {
  /**
   * One test, because the three arms are the **same expression on different inputs** and
   * that is the claim.
   *
   * All three submissions go through one closure whose only varying arguments are the
   * candidate set discovery returned — which is what the fabric's liveness produces — and
   * one integer stating a node's own room. Plan 19-08's technique, for its reason: with
   * every other argument coming from the same variables there is no second place for a
   * difference to hide, so `3/3`, `2/3` and `1/3` are demonstrably one expression reading
   * three fabrics rather than three code paths that happen to agree.
   */
  it('reports covered: 2/3 naming the owner whose node was stopped, against a 3/3 control on the same fabric', async () => {
    const fixture = await standUp()
    const { byOwner, requestor } = fixture
    const keel = byOwner.get(KEEL) as Agent
    const mast = byOwner.get(MAST) as Agent
    const spar = byOwner.get(SPAR) as Agent

    // **Membership, never a count.** A count of three is satisfiable by the wrong three
    // peers the moment anything else connects — Plan 19-08 measured exactly that failure.
    await until(
      () => [keel, mast, spar].every((agent) => requestor.verifiedPeers.includes(agent.peerId)),
      VERDICT_DEADLINE_MS,
      () =>
        `all three agents verified; the verified set was ${JSON.stringify(requestor.verifiedPeers)}`,
    )

    /**
     * The one submission, called three times.
     *
     * `redundancy: 1` because each owner has exactly one node: a sovereign shard cannot be
     * replicated outside its owner's trust domain, so asking for two would make every
     * shard `degraded` and put a second, irrelevant reason for incompleteness into every
     * arm. `onQuorumShortfall` is stated because it is required and because a sovereign
     * shard never reaches the composer anyway.
     */
    const submitOver = async (candidates: Candidates, mastRoom: number, log: OfferRecord[]) =>
      submitJob(
        {
          moduleCid: fixture.moduleCid,
          moduleRecord: fixture.moduleRecord,
          // The owner id is the **user key**: a discovery-derived descriptor's `ownerId`
          // is `certificate.userKey`, so an operator label here would match no candidate
          // and every shard would come back unplaceable with nothing obviously wrong.
          shards: ROWS.map((row) => ({
            value: row.value,
            label: 'sovereign' as const,
            ownerId: row.owner,
          })),
          executors: candidates.executors,
          nodes: candidates.nodes,
          redundancy: 1,
          onQuorumShortfall: 'runs-at-available-redundancy' as const,
          admit: statesRoom(mast.peerId, mastRoom, log),
        },
        requestor.store,
        // CHURN-03 — this test asserts nothing about checkpointing.
        { checkpoints: 'checkpoints-nothing' },
      )

    // ---- Arm 1: the control, over the live fabric. -------------------------------
    // **Without this, everything below could be describing a fixture that never covered
    // anything.** A job whose shards cannot run reports missing owners for reasons that
    // have nothing to do with anybody being offline.
    const wholeFabric = await discoverForShards(fixture)
    // One provider per shard: each owner's row is on that owner's node and nowhere else.
    expect(wholeFabric.providersPerShard).toStrictEqual([1, 1, 1, 1])
    expect(wholeFabric.nodes).toHaveLength(3)
    for (const descriptor of wholeFabric.nodes) {
      expect(descriptor.canExecuteSovereign).toBe(true)
      expect(descriptor.certificate).not.toBe('carries-no-certificate')
    }

    const controlLog: OfferRecord[] = []
    const control = await submitOver(wholeFabric, 2, controlLog)
    expect(control.ok).toBe(true)
    if (!control.ok) return
    const full = coverageOfJob(control.job)
    expect(full.covered).toBe(3)
    expect(full.total).toBe(3)
    expect(full.missing).toStrictEqual([])
    expect(full.complete).toBe(true)
    // The criterion's own string, through the kernel's own function.
    expect(full.rendered).toBe('covered: 3/3 owners — complete')
    // The answer, not only the denominator: every shard ran and produced a result.
    expect(control.job.shards.map((shard) => shard.verification.status)).toStrictEqual([
      'agreed',
      'agreed',
      'agreed',
      'agreed',
    ])
    expect(control.job.complete).toBe(true)

    // ---- Between arm 1 and arm 2: one owner's node goes away. --------------------
    // **Dead before anything is submitted, asserted rather than assumed.** An arm that
    // read `2/3` because a node was merely slow would be measuring latency, and Phase 17
    // set the precedent of falsifying that rather than arguing it away.
    await stopAgentNow(spar)
    expect(isDead(spar)).toBe(true)
    // **What the poll buys, stated because it is measurably not what it looks like.**
    // Deleting it leaves this file **green**: exit 0, the same `covered: 2/3`, and a run
    // 15.31 s against 14.27 s — measured 2026-08-05, and recorded in `20-10-SUMMARY.md`
    // against the plan's prediction that the arm would read `3/3` intermittently without
    // it. It does not, because the dead process closes its connection on exit and answers
    // no provider query either, so discovery excludes it whether or not the requestor's
    // verdict has caught up.
    //
    // It is kept, and it is kept as a *statement of the precondition* rather than as the
    // thing that carries the reading: the line above asserts the process is dead, and this
    // one asserts the requestor knows. **What carries the reading is the stop** — planting
    // its removal takes this arm to `expected 3 to be 2` on the coverage itself.
    await until(
      () => !requestor.verifiedPeers.includes(spar.peerId),
      VERDICT_DEADLINE_MS,
      () =>
        `the requestor to drop ${spar.peerId}; it still held ${JSON.stringify(requestor.verifiedPeers)}`,
    )

    // ---- Arm 2: the same job, the same requestor, one owner missing. -------------
    const withoutSpar = await discoverForShards(fixture)
    const stoppedLog: OfferRecord[] = []
    const stopped = await submitOver(withoutSpar, 2, stoppedLog)
    // **It returned a result.** Half the reading, and the half a job that failed outright
    // would also satisfy the other half of.
    expect(stopped.ok).toBe(true)
    if (!stopped.ok) return
    const partial = coverageOfJob(stopped.job)
    expect(partial.covered).toBe(2)
    expect(partial.total).toBe(3)
    // Named by the id the fixture derives for itself from its own seed, never read back
    // out of the result it is checking.
    expect(partial.missing).toStrictEqual([SPAR])
    // **And it is not presented as complete.** Asserted beside the fact that it answered,
    // because either alone is half a reading.
    expect(partial.complete).toBe(false)
    // Criterion 4's literal string, off `describeCoverage` rather than transcribed.
    expect(partial.rendered).toContain('covered: 2/3')
    expect(partial.rendered).toContain(`missing ${SPAR}`)
    expect(partial.rendered).toContain('PARTIAL')

    // **The discovery premise, asserted AFTER the reading it explains and not before.**
    // Checking it the moment discovery returned is the natural position and it was
    // measured and rejected: a plant that leaves the owner's process running would redden
    // *there* first, on a provider count, which is a fact `discovery-agents.node.test.ts`
    // owns — and this file would have proved that discovery noticed rather than that the
    // denominator moved. Below the reading, it says what the reading was taken over.
    // Plan 20-09 moved an assertion for the same reason and recorded it.
    expect(withoutSpar.providersPerShard).toStrictEqual([1, 1, 1, 0])
    expect(withoutSpar.nodes.map((node) => node.nodeId).toSorted()).toStrictEqual(
      [keel.peerId, mast.peerId].toSorted(),
    )

    // The three owners' shards, read individually: the two live owners delivered
    // everything they owed, and the stopped one delivered nothing.
    expect(shardsOf(stopped.job, KEEL).agreed).toStrictEqual([0])
    expect(shardsOf(stopped.job, MAST).agreed).toStrictEqual([1, 2])
    expect(shardsOf(stopped.job, SPAR).agreed).toStrictEqual([])
    // The answer the caller actually wanted is present: two owners' worth of results, with
    // CIDs, beside a denominator that says two of three.
    const answered = stopped.job.shards.filter(
      (shard) => shard.verification.status === 'agreed',
    )
    expect(answered).toHaveLength(3)
    expect(stopped.job.complete).toBe(false)

    // ---- Arm 3: one owner's node states room for one of its two shards. ----------
    // The partial-owner case, and **the only arm here that carries the owed-against-done
    // gate**. Nothing about the fabric changed between this arm and the one above: the
    // same two processes are up, the same candidate set was discovered, the same job is
    // submitted. One integer moved.
    const saturatedLog: OfferRecord[] = []
    const saturated = await submitOver(withoutSpar, 1, saturatedLog)
    expect(saturated.ok).toBe(true)
    if (!saturated.ok) return
    const thin = coverageOfJob(saturated.job)

    // The owner is **present and answering** — this is what separates this arm from the
    // stopped one, and what a rule counting an owner on its first landed shard would get
    // wrong.
    const mastShards = shardsOf(saturated.job, MAST)
    expect(mastShards.owed).toStrictEqual([1, 2])
    expect(mastShards.agreed).toHaveLength(1)
    expect(mast.child.exitCode).toBeNull()
    // The headroom mechanism, read off the offers themselves rather than inferred: this
    // node stated one slot, was offered one shard, accepted it, and was never asked about
    // the other. `placement.ts`: *"a node held back here was never asked, so it never
    // refused"*.
    const offeredToMast = saturatedLog.filter((entry) => entry.nodeId === mast.peerId)
    expect(offeredToMast).toHaveLength(1)
    expect(offeredToMast[0]?.slots).toBe(1)
    expect(offeredToMast[0]?.accepted).toBe(true)
    const heldBack = saturated.job.shards.find(
      (shard) => shard.partitionIndex === (mastShards.agreed[0] === 1 ? 2 : 1),
    )
    expect(heldBack?.ending).toBe('never-placed')
    expect(heldBack?.rejections).toStrictEqual([])

    // And the reading: one of two is not a contribution.
    expect(thin.covered).toBe(1)
    expect(thin.total).toBe(3)
    expect(thin.missing).toStrictEqual([MAST, SPAR].toSorted())
    expect(thin.complete).toBe(false)
    expect(thin.rendered).toContain('covered: 1/3')
    // Still an answer beside the denominator, on this arm too.
    expect(
      saturated.job.shards.filter((shard) => shard.verification.status === 'agreed'),
    ).toHaveLength(2)

    // The whole sequence, as one statement: the denominator moved because owners went
    // away, and it moved twice for two different reasons.
    expect([full.rendered, partial.rendered, thin.rendered].map((line) => line.slice(0, 17)))
      .toStrictEqual(['covered: 3/3 owne', 'covered: 2/3 owne', 'covered: 1/3 owne'])

    // The live reading, printed so a green run is legible rather than merely green — the
    // discipline `speculation-agents.node.test.ts` established. Every figure here is a
    // count or a comparison against another arm of the same fixture; none is a duration.
    process.stdout.write(
      `\n[criterion 4 / coverage] control ${full.rendered}\n` +
        `                         stopped ${partial.rendered}\n` +
        `                         thinned ${thin.rendered}\n` +
        `                         shards agreed 4 → 3 → 2 of 4; offers to the two-shard ` +
        `owner ${String(controlLog.filter((e) => e.nodeId === mast.peerId).length)} → ` +
        `${String(stoppedLog.filter((e) => e.nodeId === mast.peerId).length)} → ` +
        `${String(offeredToMast.length)}\n`,
    )

    // ---- The guard: no owner's row is on anybody else's node. --------------------
    // **This is a guard against this fixture's shape and is not criterion 4's content** —
    // see the header. Read after the processes are stopped so their own writes have
    // landed, `owner-domain-agents.node.test.ts`'s technique.
    await stopAgentNow(keel)
    await stopAgentNow(mast)
    for (const [owner, name] of NODE_OF) {
      const store = await FsBlockstore.open(join(workdir, name))
      for (const [index, row] of ROWS.entries()) {
        const cid = fixture.inputCids[index] as CID
        // Not a vacuous reading of an empty or unreadable directory: each store is
        // asserted to hold its own owner's rows, which is what makes the `false` below a
        // statement about those bytes rather than about the store.
        expect(
          await store.has(cid),
          `${name} holds row ${String(index)} (owner ${row.owner === owner ? 'its own' : 'another'})`,
        ).toBe(row.owner === owner)
      }
    }
  }, PROCESS_TEST_TIMEOUT)
})

describe('CHURN-05 — the benchmark driver renders coverage only where a job defines owners', () => {
  /**
   * The CLI half, read off `bin/bench.ts`'s own stdout.
   *
   * **What this case measures is a silence, so it is paired with a source reading.** Every
   * rung the driver runs submits `label: 'public'` shards, so every rung's coverage is the
   * named sentinel and the driver prints no coverage line at all. A reading that only
   * checked the stdout would be equally green against a driver that had never learned to
   * render coverage — so the presence of the call site is counted too, the way
   * `speculation-agents.node.test.ts` counts the two measurement sites it guards.
   *
   * What the pair says together: *this driver renders coverage, and no rung of it
   * apologises for a question it was never asked.*
   *
   * **What reddens it**: dropping the named arm in `coverageReading`, which makes every
   * rung print `covered: 0/0 owners — PARTIAL (no owners were expected)`. Watched; the
   * observed text is in `20-10-SUMMARY.md`.
   *
   * `--quick` and **not** `--discover`: this reads what every rung prints, not what an
   * enrolled rig attests, and the discover arm costs minutes for a reading identical here.
   */
  it('prints no PARTIAL on any rung, because a public job defines no owners', async () => {
    // The published artifact this driver would overwrite if it were spawned in the
    // repository. **Compared by content around the run**, deliberately rather than by
    // `git status --porcelain`: `discover-arm.node.test.ts` and
    // `bench-attestation.node.test.ts` both snapshot the whole tree's status and both went
    // red during Plan 20-09's runs because *another agent staged a file* mid-run, which is
    // a fact about the shared checkout and not about the driver. This reads the one file
    // the risk is actually about.
    const published = join(REPO, '.planning', 'BENCHMARK-RESULTS.md')
    const before = readFileSync(published, 'utf8')

    const cwd = await mkdtemp(join(tmpdir(), 'o2-coverage-bench-'))
    let stdout = ''
    let stderr = ''
    const code = await new Promise<number | null>((resolve, reject) => {
      // `'pipe'` on fd 0 per the guard at the bottom of `orphan-leash.node.test.ts`.
      const child = spawn(process.execPath, [BENCH, '--quick'], {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      const timer = setTimeout(() => {
        child.kill('SIGKILL')
        reject(new Error(`bench did not finish in budget\nstdout:\n${stdout}\nstderr:\n${stderr}`))
      }, BENCH_BUDGET_MS)
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString()
      })
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString()
      })
      child.on('exit', (exit) => {
        clearTimeout(timer)
        resolve(exit)
      })
    })

    // Read directly, and before anything is asserted about what it printed: a driver that
    // died has a stdout that says nothing about coverage for reasons of its own.
    expect(code, `bench exited ${String(code)}\nstdout:\n${stdout}\nstderr:\n${stderr}`).toBe(0)

    // **Anti-vacuity.** The rungs really ran and really reported, so the absence below is
    // an absence in output that exists.
    const headings = [...stdout.matchAll(/^ {2}(memory|real) transport, (\d+) node\(s\)…$/gm)].map(
      (hit) => `${hit[1] ?? ''}/${hit[2] ?? ''}`,
    )
    expect(headings).toStrictEqual(['memory/1', 'memory/2', 'memory/4', 'real/1', 'real/2'])
    expect(stdout).toContain('map attestation (')

    // The reading. Neither the criterion's own line nor the word it would carry appears
    // anywhere, because no rung of this driver defines an owner.
    expect(stdout).not.toMatch(/covered: \d+\/\d+ owners/)
    expect(stdout).not.toContain('PARTIAL')
    expect(stdout).not.toContain('owner coverage (')

    // The other half of the pair: the driver does render coverage — the function exists
    // and is called from the per-rung output block. A count of 2 is its definition and its
    // one call site; deleting either takes this to 1 or 0.
    expect(BENCH_SOURCE.split('coverageReading(').length - 1).toBe(2)
    // And the named arm is handled at that site rather than the report being rendered
    // unconditionally. This is the line whose deletion the stdout reading above catches.
    expect(BENCH_SOURCE).toContain("if (coverage === 'defines-no-owners') return null")

    // Written where it was told to, and the repository's published figures are the bytes
    // they were before this ran.
    expect((await stat(join(cwd, '.planning', 'bench'))).isDirectory()).toBe(true)
    expect(readFileSync(published, 'utf8')).toBe(before)
    // Belt and braces on the one path the driver writes outside its `outDir`.
    expect(
      execFileSync('git', ['status', '--porcelain', '--', '.planning/BENCHMARK-RESULTS.md'], {
        cwd: REPO,
        encoding: 'utf8',
      }),
    ).toBe('')

    await rm(cwd, { recursive: true, force: true })
  }, BENCH_BUDGET_MS)
})
