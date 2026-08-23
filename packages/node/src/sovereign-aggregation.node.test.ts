/**
 * MR-02 — two owners, two `bin/agent.ts` processes, and an aggregate over data that
 * never moved.
 *
 * `PROJECT.md` splits the integrity claim: a public shard gets N-version redundant
 * execution, while for owner-pinned data *the map is owner-attested and the aggregation
 * over contributions is verified*. Phase 16 built the aggregation and ran it over public
 * shards only — `tree-reduce-agents.node.test.ts` says so in its own header, and names
 * exactly what would close the gap: *"a job whose inputs carry an owner label and land on
 * that owner's node, with Phase 13's egress guard refusing the raw input's egress and the
 * coverage report naming what stayed home."* This file is that job.
 *
 * ## What the arrangement makes measurable, and why each piece is load-bearing
 *
 * **Two owners, one process each, seeded with their own row and nothing else.** Alice's
 * `--dir` holds alice's row; bob's holds bob's. Neither store is ever handed the other's,
 * and that is asserted from each store *after* the processes are stopped rather than
 * reasoned about — a reading from the far side, which is `owner-domain-agents.node.test.ts`'s
 * technique and its reason. One owner would not be an aggregation at all: `deriveReduceTree`
 * promotes a lone contribution rather than combining it, and `reduceSovereignJob` refuses
 * that by name.
 *
 * **A guest that reads the row.** `MODULE_COUNTS_INPUT_BYTES` emits `input_len()` — the
 * size of the owner's own row — and no byte of the row itself. Every other fixture in this
 * repository emits the *partition index*, which the host supplied, so a partial projected
 * from one would be a pure function of an integer this process already holds and the
 * aggregate would be the same whether the guests read anything or not. The aggregate here
 * is the sum of two row sizes, each computed on a different machine over a row only that
 * machine held, and it is compared against the two canonical encodings this process
 * measured locally. That comparison is the map-side claim as arithmetic.
 *
 * **The requestor holds the rows and is guarded, which is the fixture's sharpest edge.**
 * `submitJob` content-addresses every shard input into the submitter's own store,
 * sovereign ones included, so this process really does hold both rows. `submitJobWithEgress`
 * registers each of them on the requestor's `EgressGuard` for the job's duration, so any
 * frame carrying one is refused rather than sent. **That is why the owners' stores must be
 * pre-seeded**: an unseeded owner would ask the requestor for its input block, the reply
 * would carry the registered bytes, and the guard would refuse it. The job completing at
 * all is therefore evidence that no raw row crossed the wire — see
 * `submit-with-egress.ts`, which states the same consequence from the other side.
 *
 * ## What this file does NOT establish
 *
 * - **It does not read the spawned processes' own egress manifests.** Nothing can reach
 *   into another process's `EgressGuard`. The manifest read here is the *requestor's*, and
 *   it is the one that matters for this arrangement, because the requestor is the only node
 *   that holds both rows. What the owners' nodes did not send is carried by the other two
 *   readings: each store holds only its own row, and the aggregate is arithmetic over sizes.
 * - **It is not a cross-machine result.** Four processes on one host. Separate processes
 *   share no heap, no event loop and no module registry, which is the boundary the claim is
 *   about — but `SAME-MACHINE` is the honest label and this comment is where it is applied.
 * - **It says nothing about whether the map's arithmetic is right.** A sovereign map cannot
 *   be N-version verified; that is what the split gives up. The *aggregation* is verified,
 *   at two replicas per combine, and `outcome.minReplicas` is where that is read.
 *
 * ## Budget and seeds
 *
 * One provider, two owner agents, one in-process requestor — half of
 * `owner-domain-agents.node.test.ts`'s spawn count and well inside the established budget.
 * Publisher seed **68**: 51 `two-process`, 52 `sovereignty-placement`, 53 `egress-refusal`,
 * 57 `certificate-verification`, 58 `tree-reduce-agents`, 59 `discovery-agents`, 60–62
 * `combine-signature`, 63–65 `result-signature`, 66 `quorum-agents`, 67 `owner-domain`.
 * User seeds **0xb9** and **0xba** — 0xb7/0xb8 are `owner-domain`'s, and the census in that
 * file's header lists the rest.
 */
import { spawn } from 'node:child_process'
import type { ChildProcessByStdio } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Readable, Writable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { ed25519 } from '@noble/curves/ed25519.js'
import { canonicalCid, delegate, signName, toHex } from '@o2/core'
import type {
  CanonicalValue,
  Delegation,
  Executor,
  NameRecord,
  NodeCertificate,
  NodeDescriptor,
  PublicKeyHex,
  Task,
} from '@o2/core'
import { SEED_BYTES, audienceKeyOf, peerIdForNodeKey } from '@o2/libp2p'
import { discoverCandidates, reduceSovereignJob, submitJobWithEgress } from '@o2/net'
import type { CapabilitySupplier } from '@o2/net'
import type { CID } from 'multiformats/cid'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
// Test-only relative import — see the note in packages/net/src/distributed.test.ts.
import { MODULE_COUNTS_INPUT_BYTES } from '../../core/src/executor/fixtures.ts'
import { FabricNode } from './fabric-node.ts'
import { FsBlockstore } from './fs-blockstore.ts'

const AGENT = fileURLToPath(new URL('./bin/agent.ts', import.meta.url))

/** Announce budget, matching `owner-domain-agents.node.test.ts`. */
const ANNOUNCE_BUDGET_MS = 60_000
/** Per-`it` budget. Three spawns, two enrolments with a dial each, one job, one reduce. */
const PROCESS_TEST_TIMEOUT = 300_000
/** How long a peer verdict may take to settle after a dial. */
const VERDICT_DEADLINE_MS = 30_000

/** The build authority both agents pin. Seed 68 — see this file's header. */
const publisher = (() => {
  const priv = new Uint8Array(SEED_BYTES).fill(68)
  return { priv, pub: toHex(ed25519.getPublicKey(priv)) }
})()

const ALICE_PRIVATE_KEY = new Uint8Array(SEED_BYTES).fill(0xb9)
const BOB_PRIVATE_KEY = new Uint8Array(SEED_BYTES).fill(0xba)
const ALICE_USER_KEY: PublicKeyHex = toHex(ed25519.getPublicKey(ALICE_PRIVATE_KEY))
const BOB_USER_KEY: PublicKeyHex = toHex(ed25519.getPublicKey(BOB_PRIVATE_KEY))

/**
 * Two owners' rows, and they are **deliberately different sizes**.
 *
 * The aggregate is the sum of the two row sizes, so equal-length rows would make it
 * `2n` for any `n` and a fixture in which the two guests' outputs had been swapped,
 * duplicated or read off one row twice would produce the identical number. Different
 * lengths make the sum decomposable, and the assertions below read both halves.
 */
const ALICE_ROW: CanonicalValue = { ssn: '404-11-2900', salary: 74_500, dob: '1979-11-04' }
const BOB_ROW: CanonicalValue = { ssn: '512-08-7731' }

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
    // fd 0, and `'ignore'` would opt this file out. `orphan-leash.node.test.ts` fails any
    // spawn site that does that.
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

/**
 * Defined locally rather than imported — importing a helper from another `.test.ts`
 * re-registers that file's whole suite. `what` is a thunk so it is evaluated at the throw.
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

/** `bin/agent.ts` refuses to create a user key — it takes a path, never key material. */
async function writeUserKey(name: string, seed: Uint8Array): Promise<string> {
  await mkdir(workdir, { recursive: true })
  const path = join(workdir, `${name}.key`)
  await writeFile(path, seed, { mode: 0o600 })
  return path
}

/**
 * AUTH-03's chain supplier, minted per candidate and rooted at the owner's own key.
 *
 * One supplier per owner, because a chain's audience is one node and `verifyChain` refuses
 * another's (`wrong-audience`) — and because these are genuinely two owners, so a single
 * root key here would be a fixture modelling one owner with two names.
 */
const dispatchAs =
  (ownerPrivateKey: Uint8Array) =>
  (nodeId: string): CapabilitySupplier =>
  (task: Task): readonly Delegation[] =>
    task.label === 'sovereign' && task.ownerId !== undefined
      ? [
          delegate(ownerPrivateKey, {
            ownerId: task.ownerId,
            audience: audienceKeyOf(nodeId),
            abilities: ['execute'],
            expiresAt: Date.now() + 60_000,
          }),
        ]
      : []

function recordFor(name: string, moduleCid: CID): NameRecord {
  return signName(publisher.priv, {
    name,
    cid: moduleCid,
    version: 1,
    expiresAt: Date.now() + 3_600_000,
  })
}

/** Read the 4-byte little-endian value the guest emits — here, its input's byte count. */
function countOf(output: CanonicalValue): number {
  const p = (output as { p?: unknown }).p
  if (!(p instanceof Uint8Array) || p.length !== 4) throw new Error('not a counting output')
  return new DataView(p.buffer, p.byteOffset, 4).getUint32(0, true)
}

/**
 * The projection: an owner's byte count becomes a `{counts, rows}` partial.
 *
 * Keyed on a **constant** rather than on the owner or the index, and that is the whole
 * point of the aggregate: `fabricCombiner` sums key-wise, so every owner contributing under
 * `bytes` makes the root the *sum of the owners' row sizes*. A per-owner key would produce a
 * map of two entries that no combine had to add together, and the arithmetic that carries
 * this file's claim would never run.
 */
function projectRowSize(output: CanonicalValue): CanonicalValue {
  return { counts: { bytes: countOf(output) }, rows: 1 }
}

interface Fixture {
  readonly providerKey: PublicKeyHex
  readonly alice: Agent
  readonly bob: Agent
  readonly requestor: FabricNode
  readonly moduleCid: CID
  readonly moduleRecord: NameRecord
  readonly aliceCid: CID
  readonly bobCid: CID
  readonly aliceBytes: number
  readonly bobBytes: number
}

async function standUp(): Promise<Fixture> {
  const aliceEncoded = await canonicalCid(ALICE_ROW)
  const bobEncoded = await canonicalCid(BOB_ROW)
  if (!aliceEncoded.ok || !bobEncoded.ok) throw new Error('a fixture row is not encodable')
  // The fixture's own premise: two rows of different sizes, so the sum below is
  // decomposable. Asserted rather than assumed — a change to either literal that made them
  // equal would silently delete the strongest reading in this file.
  expect(aliceEncoded.bytes.byteLength).not.toBe(bobEncoded.bytes.byteLength)

  // **Seeded before the spawn, and each store gets ONE row.** Seeding afterwards races the
  // agent's own open of the same directory (`discovery-agents.node.test.ts`'s reason), and
  // giving a node the other owner's row would delete the reading this file takes from each
  // store after the processes stop.
  const aliceStore = await FsBlockstore.open(join(workdir, 'alice'))
  await aliceStore.put(aliceEncoded.bytes)
  await aliceStore.put(MODULE_COUNTS_INPUT_BYTES)
  const bobStore = await FsBlockstore.open(join(workdir, 'bob'))
  await bobStore.put(bobEncoded.bytes)
  await bobStore.put(MODULE_COUNTS_INPUT_BYTES)

  const provider = await spawnAgent('p', ['--issues-certificates', '--max-issued-per-window', '64'])
  const providerKey = provider.issuerKey
  if (providerKey === null) throw new Error('the provider announced no issuer key')

  const enrol = async (name: string, privateKey: Uint8Array, userKey: PublicKeyHex): Promise<Agent> =>
    spawnAgent(name, [
      '--provider-addr',
      provider.multiaddrs[0] as string,
      '--user-key',
      await writeUserKey(name, privateKey),
      '--operator-id',
      `${name}-ops`,
      // A pinned trust anchor, deliberately not derived by the binary — see `--owner-key`.
      '--owner-key',
      userKey,
      '--can-execute-sovereign',
    ])

  const alice = await enrol('alice', ALICE_PRIVATE_KEY, ALICE_USER_KEY)
  const bob = await enrol('bob', BOB_PRIVATE_KEY, BOB_USER_KEY)

  // The premise again, asserted: two owners, two user keys, two operators.
  expect(alice.certificate?.userKey).toBe(ALICE_USER_KEY)
  expect(bob.certificate?.userKey).toBe(BOB_USER_KEY)
  expect(alice.certificate?.operatorId).not.toBe(bob.certificate?.operatorId)
  for (const agent of [alice, bob]) expect(agent.certificate?.issuer).toBe(providerKey)

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
  for (const agent of [alice, bob]) await requestor.dial(agent.multiaddrs[0] as string)

  const moduleCid = await requestor.store.put(MODULE_COUNTS_INPUT_BYTES)
  return {
    providerKey,
    alice,
    bob,
    requestor,
    moduleCid,
    moduleRecord: recordFor('sovereign-aggregation-counts-input', moduleCid),
    aliceCid: aliceEncoded.cid,
    bobCid: bobEncoded.cid,
    aliceBytes: aliceEncoded.bytes.byteLength,
    bobBytes: bobEncoded.bytes.byteLength,
  }
}

beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'o2-sov-agg-'))
})

/** 60 s, which must exceed `stopAgent`'s inner 10 s or its SIGKILL fallback could never fire. */
afterEach(async () => {
  await Promise.all(nodes.splice(0).map((node) => node.stop().catch(() => {})))
  await Promise.all(agents.splice(0).map((agent) => stopAgent(agent).catch(() => {})))
  await rm(workdir, { recursive: true, force: true })
}, 60_000)

describe('MR-02 — each owner computes a partial over its own data, and the aggregation over them is verified', () => {
  it('aggregates two owners’ locally-computed partials into the sum of their row sizes, with no row on any other node', async () => {
    const fixture = await standUp()
    const { alice, bob, requestor } = fixture

    // Membership, never a count — a count of two is satisfiable by the wrong two peers.
    await until(
      () => [alice, bob].every((agent) => requestor.verifiedPeers.includes(agent.peerId)),
      VERDICT_DEADLINE_MS,
      () => `both agents verified; the verified set was ${JSON.stringify(requestor.verifiedPeers)}`,
    )

    // ---- Discovery, once per owner, because a lookup is about one owner's clearance ----
    //
    // The candidate set is the union, and it is the union that goes to `submitJob`:
    // `eligibleNodes` narrows each shard to its own owner's nodes, so the merged pool is
    // what a real multi-owner requestor would hold and the narrowing still happens per
    // shard. A per-owner submission would place each shard against a pool that contained
    // only its owner, which would make the placement claim vacuous.
    const found = await Promise.all(
      [
        { inputCid: fixture.aliceCid, sovereignFor: ALICE_USER_KEY, key: ALICE_PRIVATE_KEY },
        { inputCid: fixture.bobCid, sovereignFor: BOB_USER_KEY, key: BOB_PRIVATE_KEY },
      ].map(async ({ inputCid, sovereignFor, key }) =>
        discoverCandidates(
          { inputCid, sovereignFor },
          {
            rpc: requestor.rpc,
            peers: () => requestor.verifiedPeers,
            index: 'asks-connected-peers-only',
            trustedIssuers: new Set([fixture.providerKey]),
            now: () => Date.now(),
            peerIdFor: peerIdForNodeKey,
            dispatch: dispatchAs(key),
          },
        ),
      ),
    )

    // **Each owner's row is discoverable on exactly one node — its owner's.** This is the
    // *lookup* half of "the data never moved": the other owner's process does not hold the
    // block and therefore does not answer as a provider for it.
    expect(found[0]?.executors.map((e) => e.nodeId)).toStrictEqual([alice.peerId])
    expect(found[1]?.executors.map((e) => e.nodeId)).toStrictEqual([bob.peerId])

    const executors: Executor[] = [
      ...(found[0]?.executors ?? []),
      ...(found[1]?.executors ?? []),
    ]
    // **Alice's process is described as saturated and bob's as idle**, which is the
    // discrimination `sovereignty-placement.node.test.ts` established and is reused here
    // because without it this file's placement reading is a coin flip. Measured, not
    // assumed: with `eligibleNodes`' sovereign narrowing planted inert, `planPlacement`
    // orders by load and then nudges the second shard away from the node the first took,
    // so on equal loads it spreads two shards over two nodes and lands on the CORRECT
    // assignment half the time — and with this fixture's fixed seeds, it landed on it. A
    // load skew makes the misplacement deterministic: a scheduler that let load widen
    // ownership would move alice's shard onto the idle foreign node every run.
    const descriptors: NodeDescriptor[] = [
      ...(found[0]?.nodes ?? []).map((node) => ({ ...node, load: 1 })),
      ...(found[1]?.nodes ?? []).map((node) => ({ ...node, load: 0 })),
    ]
    // The unification made literal: a discovery-derived descriptor's `ownerId` IS
    // `certificate.userKey`, which is what the shards below pin to and what
    // `reduceSovereignJob` compares each partial's receipt against.
    expect(descriptors.map((d) => d.ownerId).toSorted()).toStrictEqual(
      [ALICE_USER_KEY, BOB_USER_KEY].toSorted(),
    )

    // ---- The job: one owner-pinned shard each, through the guarded submit path --------
    const submitted = await submitJobWithEgress(
      {
        moduleCid: fixture.moduleCid,
        moduleRecord: fixture.moduleRecord,
        shards: [
          { value: ALICE_ROW, label: 'sovereign' as const, ownerId: ALICE_USER_KEY },
          { value: BOB_ROW, label: 'sovereign' as const, ownerId: BOB_USER_KEY },
        ],
        executors,
        nodes: descriptors,
        // 1, and it is the honest figure rather than a weakened one: each owner runs one
        // node, so a sovereign shard is owner-attested by construction. That is the half of
        // the split redundancy cannot carry, which is why the reduce below asks for 2.
        redundancy: 1,
        onQuorumShortfall: 'runs-at-available-redundancy' as const,
      },
      requestor.store,
      [requestor.egress],
      {
        checkpoints: 'checkpoints-nothing',
        // DATA-10's at-rest half. `FabricNode` resolves this to a real `FsSovereignCids`
        // when it has a blockstore directory, which it does here; the sentinel arm cannot
        // be passed to `submitJob` and the narrowing says so rather than being cast away.
        ...(requestor.sovereignCids === 'forgets-sovereignty-between-jobs'
          ? {}
          : { sovereignCids: requestor.sovereignCids }),
      },
    )
    expect(submitted.ok, JSON.stringify(submitted)).toBe(true)
    if (!submitted.ok) return
    expect(submitted.job.complete).toBe(true)

    // Each shard ran on its own owner's process and on no other. The placement half of
    // *no data leaves the owner's trust domain*, read off the set that answered.
    const ranOn = submitted.job.shards.map((shard) =>
      shard.verification.status === 'agreed'
        ? shard.verification.agreeing.map((replica) => replica.nodeId)
        : [],
    )
    expect(ranOn).toStrictEqual([[alice.peerId], [bob.peerId]])

    // **The set ASKED, not the set that answered — and this is the assertion that catches a
    // widened eligibility gate**, which is exactly what `ShardResult.attempted`'s own
    // docstring says it is for. Measured, and the measurement changed this file: with
    // `eligibleNodes`' sovereign narrowing planted inert, `ranOn` and `job.complete` above
    // both stayed GREEN, because the foreign node refuses the task it should never have been
    // offered and `submitJob`'s generation loop then re-dispatches onto the owner's own node.
    // That is the fabric working — defence in depth — and it is also a reading this file
    // could not take. `attempted` and `generations` can: a shard that was offered to the
    // wrong owner's process names it here and counts a second generation, whatever the
    // outcome was repaired to.
    expect(submitted.job.shards.map((shard) => shard.attempted)).toStrictEqual([
      [alice.peerId],
      [bob.peerId],
    ])
    expect(submitted.job.shards.map((shard) => shard.generations)).toStrictEqual([1, 1])

    // **Each owner's guest read its own row and no other**, which is the arithmetic that
    // makes this a measurement of MR-02's map-side half rather than of its placement. The
    // two counts are the two canonical encodings measured in this process, and they differ.
    const counted = submitted.job.shards.map((shard) =>
      shard.verification.status === 'agreed' ? countOf(shard.verification.output) : -1,
    )
    expect(counted).toStrictEqual([fixture.aliceBytes, fixture.bobBytes])

    // ---- The aggregation ------------------------------------------------------------
    //
    // Both owner processes are combine executors. A combine reads only content-addressed
    // partials, so it is runnable anywhere — which is precisely why the aggregation *can*
    // be redundant while the map cannot.
    const reduced = await reduceSovereignJob(submitted.job, {
      moduleCid: fixture.moduleCid,
      moduleRecord: fixture.moduleRecord,
      shards: [
        { value: ALICE_ROW, label: 'sovereign' as const, ownerId: ALICE_USER_KEY },
        { value: BOB_ROW, label: 'sovereign' as const, ownerId: BOB_USER_KEY },
      ],
      executors,
      nodes: descriptors,
      redundancy: 1,
      onQuorumShortfall: 'runs-at-available-redundancy' as const,
    }, {
      rpc: requestor.rpc,
      executors: [alice.peerId, bob.peerId],
      blockstore: requestor.store,
      project: projectRowSize,
      // Neither agent is given `attest` for combines in this fixture's configuration, so
      // the honest statement is that this requestor checks no combine signature. The
      // aggregation's *verification* here is redundancy and agreement, which is what
      // `minReplicas` and `disagreements` below read; `combine-signature.node.test.ts`
      // carries the signed half.
      trustedIssuers: 'checks-no-combine-signatures',
      egress: submitted.manifests,
      redundancy: 2,
    })

    expect(reduced.ok, JSON.stringify(reduced)).toBe(true)
    if (!reduced.ok) return
    const { value, coverage } = reduced.aggregate

    // Coverage over owners, complete, derived from the partials that were admitted rather
    // than from the shards that were submitted.
    expect(coverage.complete).toBe(true)
    expect(coverage.covered).toBe(2)
    expect(coverage.total).toBe(2)
    expect(coverage.missing).toEqual([])

    // The leaf key is the owner, and the owner came off a certificate this requestor
    // verified — not off anything it chose. Read off the **derived tree** as well as off
    // the contribution list, because only the tree carries it into the aggregation: an arm
    // that reported owners in its own return value while keying its leaves on the partition
    // index would satisfy every other assertion in this block.
    expect(value.tree.leaves.map((leaf) => leaf.id.split('\u0000')[0]).toSorted()).toStrictEqual(
      [ALICE_USER_KEY, BOB_USER_KEY].toSorted(),
    )
    expect(value.contributions.map((c) => c.ownerId)).toStrictEqual([ALICE_USER_KEY, BOB_USER_KEY])
    expect(value.contributions.map((c) => c.operators)).toStrictEqual([['alice-ops'], ['bob-ops']])

    // **The aggregation over contributions is verified**: one combine, performed
    // independently by both owner processes, producing the same CID.
    expect(value.tree.nodes).toHaveLength(1)
    expect(value.outcome.ok).toBe(true)
    expect(value.outcome.minReplicas).toBe(2)
    expect(value.outcome.disagreements).toEqual([])

    // **The number.** The root of the tree is the sum of two row sizes, each measured by a
    // different operating-system process over a row that only that process held. Fetched
    // from the store rather than assumed: `ReduceOutcome` carries `rootCid`, and the merged
    // block is read back through the same blockstore the combines wrote to.
    const rootCid = value.outcome.rootCid
    expect(rootCid).not.toBeNull()
    const { CID } = await import('multiformats/cid')
    const rootBytes = await requestor.store.get(CID.parse(rootCid as string))
    expect(rootBytes).toBeDefined()
    const { decodeCanonical } = await import('@o2/core')
    const merged = decodeCanonical(rootBytes as Uint8Array<ArrayBuffer>) as {
      counts: { bytes: number }
      rows: number
    }
    expect(merged.rows).toBe(2)
    expect(merged.counts.bytes).toBe(fixture.aliceBytes + fixture.bobBytes)
    // Decomposable, so a fixture that had read one row twice cannot pass: the sum is not
    // 2×either half.
    expect(merged.counts.bytes).not.toBe(fixture.aliceBytes * 2)
    expect(merged.counts.bytes).not.toBe(fixture.bobBytes * 2)

    // **EGR-01's reading, and it is the sovereignty claim rather than a footnote.** Two
    // owner-pinned rows were registered on this requestor's guard for the job's duration,
    // and no frame the guard was offered carried one. `violations: []` alone could not say
    // that — it is equally the answer of a guard that was watching nothing.
    expect(value.egress.registeredSovereign).toBe(2)
    expect(value.egress.pinnedShards).toBe(2)
    for (const manifest of submitted.manifests) expect(manifest.violations).toEqual([])

    // ---- The far-side reading: neither owner's node ever held the other's row ---------
    //
    // Taken after each process is stopped, so its own writes have landed. A node that had
    // fetched the other row to compute over it would hold it.
    await stopAgentNow(alice)
    await stopAgentNow(bob)
    const aliceStore = await FsBlockstore.open(alice.dir)
    const bobStore = await FsBlockstore.open(bob.dir)
    // Not a vacuous reading of an empty or unreadable directory: each holds its own row and
    // the module it needed to compute over it.
    expect(await aliceStore.has(fixture.aliceCid)).toBe(true)
    expect(await aliceStore.has(fixture.moduleCid)).toBe(true)
    expect(await bobStore.has(fixture.bobCid)).toBe(true)
    expect(await bobStore.has(fixture.moduleCid)).toBe(true)
    // And the claim itself.
    expect(await aliceStore.has(fixture.bobCid)).toBe(false)
    expect(await bobStore.has(fixture.aliceCid)).toBe(false)
  }, PROCESS_TEST_TIMEOUT)
})
