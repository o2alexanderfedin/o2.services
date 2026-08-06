/**
 * AUTH-05 / VER-08 / VER-09 — one owner, two processes, and a label that says whose
 * agreement it is.
 *
 * A sovereignty-pinned shard is placed from a **discovered** candidate set onto two
 * `bin/agent.ts` processes enrolled under one user key, both execute it, the outputs are
 * compared, both nodes sign what they produced, and the receipt `submitJob` builds from
 * those checked signatures reads **`owner-domain`**. The second owner process is then
 * stopped and the identical submission reads **`owner-attested`** at one replica. Neither
 * reads `independent`, and a third owner's node — which holds the block — is excluded by
 * name from both.
 *
 * ## What makes this a measurement rather than a restatement
 *
 * `packages/net/src/sovereign-execution.test.ts` has taken both readings since Phase 6,
 * in process, and it is the closest existing thing to this file. It differs in one way
 * that matters more than the process boundary: **it builds its receipt itself**, calling
 * `attestationReceipt(aliceSet.certificates)` over *whoever the owner has enrolled*. That
 * is a lookup the submitter performs on identities it chose. Here the receipt comes off
 * `ShardResult.attestation`, which `receiptFor` (`core/src/job/submit.ts`) derives from
 * *whoever actually ran and signed this shard* — a certificate counts only when that
 * node's signature over **this task and this output** verifies against the issuer its own
 * descriptor names. Before Plan 19-06 built that and Plan 19-15 composed the signer at
 * both factories, this file could have read `owner-domain` off a fabricated descriptor
 * set. It cannot now: the plant that replaces the signing wrapper's output with the
 * unsigned sentinel takes Arm A to the named absence rather than to a weaker label.
 *
 * ## How this differs from `sovereignty-placement.node.test.ts`
 *
 * That file also spawns real agents and also places a sovereign shard, and its own header
 * says what it does not reach: its owner id is the operator label `'alice'` and **its
 * descriptors are written by the file**. It measures that placement narrows a sovereign
 * shard before load is consulted — true for any owner id at all. This file measures the
 * seam that label could not cross: descriptors built by `discoverCandidates` carry
 * `certificate.userKey` as their `ownerId`, so a shard is placeable only if its
 * `PlacementRequest.ownerId` is that same user key and the serving node is cleared for it.
 * Plan 19-09 made a node's clearance *be* its enrolled user key so those three agree, and
 * this is where that is read.
 *
 * ## The entry-point substitution, recorded rather than met at verification
 *
 * `bin/agent.ts` never submits a job — it is a serving node whose only stdout is a
 * handshake line. *"A job run through `bin/agent.ts`"* is satisfiable only as **"a job run
 * ACROSS `bin/agent.ts` processes"**, which is `discovery-agents.node.test.ts`'s shape and
 * this file's. The same substitution Phase 18 recorded in the ROADMAP.
 *
 * ## Why both owner nodes are seeded before the spawn, and why it is not convenience
 *
 * `PROJECT.md`'s Key Decisions row: raw sovereign data does not move between nodes,
 * **including two nodes the same owner controls**. `EgressGuard.send` refuses any frame
 * carrying a registered sovereign payload rather than forwarding it, and a node that has
 * executed a sovereign task records the input's CID in `FsSovereignCids` and keeps
 * withholding it afterwards. So a redundant sovereign shard is reachable **only** if the
 * owner has already placed the input on both of their live nodes. The fixture writes it
 * into each `--dir` through `FsBlockstore` before the process opens it — the technique
 * `discovery-agents.node.test.ts` uses, for its reason as well: seeding afterwards races
 * the agent's own open of the same directory. If this fixture ever needs the fabric to
 * fetch the row onto the second node, the fixture is wrong.
 *
 * The third owner's node is seeded with the **input only and not the module**, which is
 * what turns "it was excluded" into "it ran nothing": every executing node must hold the
 * module, so `has(moduleCid)` read off its own store after it is stopped is a reading from
 * the far side rather than the requestor's account of itself. Its holding the input is
 * asserted beside that, so an unreadable or empty store cannot pass as an idle one.
 *
 * ## What this file does NOT establish
 *
 * - **It does not read an egress manifest.** Nothing can reach into a spawned process's
 *   `EgressGuard`. What the raw row did not do is carried here by placement — the
 *   agreeing set is exactly the owner's two nodes — and by the third node's empty store.
 *   The manifest reading is `sovereign-execution.test.ts`'s and
 *   `egress-manifest.node.test.ts`'s, in process, and neither substitutes for the other.
 * - **It does not re-check the signatures themselves.** One assertion says every agreeing
 *   replica carries a real attestation rather than the sentinel, because without it the
 *   receipt could not be told apart from a lookup over certificates the submitter happened
 *   to hold. Verifying those signatures against a stranger's pinned key is
 *   `result-signature.node.test.ts`'s job, and duplicating it here would be two files
 *   measuring one thing and neither measuring the other.
 * - **It says nothing about correctness.** A signature says a certified node computed this
 *   output. `executeVerified`'s comparison is the only thing here that says the output is
 *   right.
 *
 * ## Budget and seeds
 *
 * One provider plus three agents, one of them stopped mid-file, and one in-process
 * requestor — inside the established budget (`tree-reduce-agents.node.test.ts` runs nine,
 * `discovery-agents.node.test.ts` seven). Its spawn helper, its budgets and its
 * pre-seeding are reused rather than reinvented.
 *
 * Publisher seed **67**, checked against the repository's whole census first: 51 is
 * `two-process`, 52 `sovereignty-placement`, 53 `egress-refusal`, 57
 * `certificate-verification`, 58 `tree-reduce-agents`, 59 `discovery-agents`, 60–62
 * `combine-signature`, 63–65 `result-signature`, 66 `quorum-agents`. User seeds **0xb7**
 * and **0xb8**, likewise free — 0xb1/0xb2, 0x81/0x82, 0x91–0x95, 0xa1–0xa4, 0xc1/0xc2 and
 * 0xf1/0xf2 are taken. Two fixtures sharing a key couple two files that have nothing to do
 * with each other.
 */
import { spawn } from 'node:child_process'
import type { ChildProcessByStdio } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Readable, Writable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { ed25519 } from '@noble/curves/ed25519.js'
import { canonicalCid, delegate, signName, submitJob, toHex } from '@o2/core'
import type {
  CanonicalValue,
  Delegation,
  NameRecord,
  NodeCertificate,
  PublicKeyHex,
  Task,
} from '@o2/core'
import { SEED_BYTES, audienceKeyOf, peerIdForNodeKey } from '@o2/libp2p'
import { discoverCandidates } from '@o2/net'
import type { CandidateSet, CapabilitySupplier } from '@o2/net'
import type { CID } from 'multiformats/cid'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
// Test-only relative import — see the note in packages/net/src/distributed.test.ts.
import { MODULE_WRITES_PARTITION } from '../../core/src/executor/fixtures.ts'
import { FabricNode } from './fabric-node.ts'
import { FsBlockstore } from './fs-blockstore.ts'

const AGENT = fileURLToPath(new URL('./bin/agent.ts', import.meta.url))

/** Announce budget, matching `certificate-verification.node.test.ts`. */
const ANNOUNCE_BUDGET_MS = 60_000
/** Per-`it` budget. Four spawns, three enrolments with a dial each, and two real jobs. */
const PROCESS_TEST_TIMEOUT = 300_000
/** How long a peer verdict may take to settle after a dial — or to clear after an exit. */
const VERDICT_DEADLINE_MS = 30_000

/** The build authority every spawned agent pins. Seed 67 — see this file's header. */
const publisher = (() => {
  const priv = new Uint8Array(SEED_BYTES).fill(67)
  return { priv, pub: toHex(ed25519.getPublicKey(priv)) }
})()

/**
 * The owner whose two nodes agree, and a second owner whose one node is excluded.
 *
 * Both are **private** halves, held only in this process. Each is written to a file for
 * `--user-key` — which takes a path and never key material, because argv is world-readable
 * in `ps` — and the owner's is additionally the root every capability chain below is
 * signed with. That is not a shortcut: once a node's clearance *is* its enrolled user key
 * (Plan 19-09), the key that names the owner and the key that roots the owner's chains are
 * the same key, and a fixture that used two would be modelling a deployment nobody has.
 */
const OWNER_PRIVATE_KEY = new Uint8Array(SEED_BYTES).fill(0xb7)
const THIRD_PRIVATE_KEY = new Uint8Array(SEED_BYTES).fill(0xb8)
const OWNER_USER_KEY: PublicKeyHex = toHex(ed25519.getPublicKey(OWNER_PRIVATE_KEY))
const THIRD_USER_KEY: PublicKeyHex = toHex(ed25519.getPublicKey(THIRD_PRIVATE_KEY))

/**
 * One operator for both of the owner's nodes, because that is the fact under test.
 *
 * `classifyAttestation` reads `owner-domain` for two or more certificates sharing one
 * `operatorId`, and `independent` for two or more operators. One person's own machines are
 * one operator, which is exactly why their agreement is independent of hardware and not of
 * the owner. Two spellings here would silently turn Arm A into a weaker file that read
 * `independent` and looked like it had passed.
 */
const OWNER_OPERATOR = 'harbour-ops'
const THIRD_OPERATOR = 'trawler-ops'

/** The owner's row. Distinctive, so a match anywhere means something. */
const SHARD_VALUE: CanonicalValue = { ssn: '404-11-2900', salary: 74_500, dob: '1979-11-04' }

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
 * Defined locally rather than imported. Importing a helper from another `.test.ts`
 * re-registers that file's whole suite — see the note in
 * `certificate-verification.node.test.ts`.
 *
 * `what` may be a thunk, evaluated **at the throw**. Plan 19-08 measured the alternative:
 * a caller interpolating live state into a `string` argument reports the state as it was
 * before the wait — which is empty, every time.
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
 * AUTH-03's chain supplier, minted per candidate and rooted at the owner's own key.
 *
 * **A function of the node id, which is what `CandidateOptions.dispatch` became on
 * 2026-08-03 and why.** `verifyChain` refuses a chain whose audience is another node
 * (`wrong-audience`), so one supplier shared across a candidate set can serve at most one
 * of them. Until that option took the node id, `discoverCandidates` could build no
 * candidate that a sovereign dispatch would be authorised at — on any production node,
 * because both factories install `authorizeCapability` and it refuses a sovereign task
 * with no valid chain whether or not an owner key is pinned.
 *
 * `[]` for a public task is not a stub: a public task has no owner, so there is no key a
 * chain could be rooted at, and `authorizeCapability` returns before it looks.
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
            // Computed at call time rather than at module load: these suites spawn real
            // processes, and a constant fixed when the module was imported would start
            // expiring the moment the suite began.
            expiresAt: Date.now() + 60_000,
          }),
        ]
      : []

interface Fixture {
  readonly providerKey: PublicKeyHex
  /** The owner's two processes, enrolled under one user key and one operator id. */
  readonly owned: readonly [Agent, Agent]
  /** A third owner's process. Holds the block, is cleared for its own owner only. */
  readonly foreign: Agent
  readonly requestor: FabricNode
  readonly inputCid: CID
  readonly moduleCid: CID
  readonly moduleRecord: NameRecord
}

/**
 * One provider, three enrolled agents, one in-process requestor.
 *
 * The two owner agents are spawned with `--user-key` and **no `--owner-id`**, which is the
 * derived case Plan 19-09 added: their clearance is the public half of the key they enrol
 * under, so it equals the `ownerId` a discovery-derived descriptor carries. Both get
 * `--owner-key <owner user key>` — the anchor a capability chain must be rooted at — and
 * `--can-execute-sovereign`, which is what puts that user key into their published
 * `sovereignFor`.
 *
 * The third agent gets the identical treatment under a **different** user key, so the only
 * thing separating it from the other two is whose data it is cleared for. It is not an
 * uncleared node standing in for a foreign one.
 */
async function standUp(): Promise<Fixture> {
  const encoded = await canonicalCid(SHARD_VALUE)
  if (!encoded.ok) throw new Error('fixture value is not encodable')

  // Seeded before the spawn — see this file's header for why both owner nodes must hold
  // the row and why the third must hold it too but not the module.
  for (const name of ['n1', 'n2']) {
    const store = await FsBlockstore.open(join(workdir, name))
    await store.put(encoded.bytes)
    await store.put(MODULE_WRITES_PARTITION)
  }
  const foreignStore = await FsBlockstore.open(join(workdir, 'n3'))
  await foreignStore.put(encoded.bytes)

  const provider = await spawnAgent('p', ['--issues-certificates', '--max-issued-per-window', '64'])
  const providerKey = provider.issuerKey
  if (providerKey === null) throw new Error('the provider announced no issuer key')

  const enrol = async (
    name: string,
    privateKey: Uint8Array,
    userKey: PublicKeyHex,
    operatorId: string,
  ): Promise<Agent> =>
    spawnAgent(name, [
      '--provider-addr',
      provider.multiaddrs[0] as string,
      '--user-key',
      await writeUserKey(name, privateKey),
      '--operator-id',
      operatorId,
      // AUTH-03's pinned anchor. Deliberately NOT derived by the binary — see
      // `--owner-key`'s docblock: a clearance may be derived from a signed statement, a
      // trust anchor is configuration.
      '--owner-key',
      userKey,
      '--can-execute-sovereign',
    ])

  const n1 = await enrol('n1', OWNER_PRIVATE_KEY, OWNER_USER_KEY, OWNER_OPERATOR)
  const n2 = await enrol('n2', OWNER_PRIVATE_KEY, OWNER_USER_KEY, OWNER_OPERATOR)
  const n3 = await enrol('n3', THIRD_PRIVATE_KEY, THIRD_USER_KEY, THIRD_OPERATOR)

  // The fixture's own premise, asserted rather than assumed. Plan 19-08 recorded the cost
  // of not doing this: a fixture whose operator ids had silently collapsed would read a
  // different label and look like a pass.
  expect(n1.certificate?.userKey).toBe(OWNER_USER_KEY)
  expect(n2.certificate?.userKey).toBe(OWNER_USER_KEY)
  expect(n3.certificate?.userKey).toBe(THIRD_USER_KEY)
  expect(n1.certificate?.operatorId).toBe(OWNER_OPERATOR)
  expect(n2.certificate?.operatorId).toBe(OWNER_OPERATOR)
  expect(n3.certificate?.operatorId).toBe(THIRD_OPERATOR)
  expect(n1.nodeKey).not.toBe(n2.nodeKey)
  for (const agent of [n1, n2, n3]) expect(agent.certificate?.issuer).toBe(providerKey)

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
  for (const agent of [n1, n2, n3]) await requestor.dial(agent.multiaddrs[0] as string)

  const moduleCid = await requestor.store.put(MODULE_WRITES_PARTITION)

  return {
    providerKey,
    owned: [n1, n2],
    foreign: n3,
    requestor,
    inputCid: encoded.cid,
    moduleCid,
    moduleRecord: recordFor('owner-domain-writes-partition', moduleCid),
  }
}

/** Everything `discoverCandidates` needs, over the verified set and pinned to the owner. */
function candidateOptions(fixture: Fixture) {
  return {
    rpc: fixture.requestor.rpc,
    // `verifiedPeers` and not `transport.peers`: a provider list steers where work goes,
    // so a peer that has not cleared verification does not get to contribute one. This is
    // `discover-candidates.ts`'s own recommendation.
    peers: () => fixture.requestor.verifiedPeers,
    trustedIssuers: new Set([fixture.providerKey]),
    now: () => Date.now(),
    peerIdFor: peerIdForNodeKey,
    dispatch: dispatchAs(OWNER_PRIVATE_KEY),
  }
}

beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'o2-owner-domain-'))
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

describe('AUTH-05/VER-08/VER-09 — an owner’s own processes verify each other, and the receipt says so', () => {
  /**
   * One test, because the two arms are the *same expression on different inputs* and that
   * is the claim.
   *
   * Both submissions go through one closure whose only varying argument is the candidate
   * set discovery returned — Plan 19-08's technique, for its reason: with every other
   * argument coming from the same variables there is no second place for a difference to
   * hide, so `owner-domain` and `owner-attested` are demonstrably produced by one
   * expression reading two node sets rather than by two code paths that happen to agree.
   */
  it('reads owner-domain with two of the owner’s nodes live and owner-attested with one, off receipts those nodes signed', async () => {
    const fixture = await standUp()
    const { owned, foreign, requestor } = fixture
    const [n1, n2] = owned

    // **Membership, never a count.** The requestor is connected to three agents and a
    // count of three is satisfiable by the wrong three peers the moment anything else
    // connects — Plan 19-08 measured exactly that failure and it reported a provider
    // shortfall with nothing naming the cause.
    await until(
      () => [n1, n2, foreign].every((agent) => requestor.verifiedPeers.includes(agent.peerId)),
      VERDICT_DEADLINE_MS,
      () => `all three agents verified; the verified set was ${JSON.stringify(requestor.verifiedPeers)}`,
    )

    /**
     * The one submission, called twice.
     *
     * No `admit`: the offer arm adds a failure mode without adding a reading either arm
     * needs, and `sovereignty-placement.node.test.ts` already carries the sovereign offer
     * loop. `redundancy: 2` on **both** calls, which is what makes Arm B's degradation a
     * shortfall rather than a request for one replica.
     */
    const submitOver = async (candidates: CandidateSet) =>
      submitJob(
        {
          moduleCid: fixture.moduleCid,
          moduleRecord: fixture.moduleRecord,
          // The owner id is the **user key**, which is the whole of AUTH-05's consuming
          // half: a discovery-derived descriptor's `ownerId` is `certificate.userKey`, so
          // an operator label here would match no candidate and the shard would come back
          // unplaceable with nothing obviously wrong.
          shards: [{ value: SHARD_VALUE, label: 'sovereign' as const, ownerId: OWNER_USER_KEY }],
          executors: candidates.executors,
          nodes: candidates.nodes,
          redundancy: 2,
          onQuorumShortfall: 'runs-at-available-redundancy' as const,
        },
        requestor.store,
        // CHURN-03 — this test asserts nothing about checkpointing.
        { checkpoints: 'checkpoints-nothing' },
      )

    // ---- Discovery: two qualify, the third is excluded by name. ------------------
    const found = await discoverCandidates(
      { inputCid: fixture.inputCid, sovereignFor: OWNER_USER_KEY },
      candidateOptions(fixture),
    )

    // Three providers, because the third owner's node genuinely holds the row. That is
    // what makes the exclusion a **selection** rather than an empty answer: a node that
    // never answered would be absent for a reason that has nothing to do with ownership.
    expect(found.providers).toBe(3)
    expect(found.executors.map((executor) => executor.nodeId).toSorted()).toStrictEqual(
      [n1.peerId, n2.peerId].toSorted(),
    )
    expect(found.excluded.map((exclusion) => exclusion.reason.kind)).toStrictEqual([
      'not-cleared-for-owner',
    ])
    expect(found.excluded[0]?.reason.nodeKey).toBe(foreign.nodeKey)
    expect(found.excluded[0]?.detail).toContain(OWNER_USER_KEY)

    // ---- AUTH-05: one replica set, two certificates, verification available. -----
    // Taken over the **qualified** set, so the third owner's certificate is not in it at
    // all — a replica set that contained a node the lookup excluded would report an owner
    // redundancy that placement could never use.
    expect(found.replicaSets).toHaveLength(1)
    const ownerSet = found.replicaSets.find((set) => set.userKey === OWNER_USER_KEY)
    expect(ownerSet?.certificates).toHaveLength(2)
    expect(ownerSet?.canVerifyWithinOwnerDomain).toBe(true)
    expect(ownerSet?.certificates.map((certificate) => certificate.operatorId)).toStrictEqual([
      OWNER_OPERATOR,
      OWNER_OPERATOR,
    ])

    // The descriptors the scheduler will read, and the unification made literal: their
    // `ownerId` is the user key, which is what the shard above pins to.
    for (const descriptor of found.nodes) {
      expect(descriptor.ownerId).toBe(OWNER_USER_KEY)
      expect(descriptor.canExecuteSovereign).toBe(true)
      expect(descriptor.certificate).not.toBe('carries-no-certificate')
    }

    // ---- Arm A: two live. --------------------------------------------------------
    const twoLive = await submitOver(found)
    expect(twoLive.ok).toBe(true)
    if (!twoLive.ok) return
    const shardA = twoLive.job.shards[0]
    if (shardA === undefined) throw new Error('expected one shard')

    expect(shardA.verification.status).toBe('agreed')
    if (shardA.verification.status !== 'agreed') return
    // It ran on the owner's nodes and on no others — the placement half of *no data leaves
    // the owner's trust domain*.
    expect(shardA.verification.agreeing.map((replica) => replica.nodeId).toSorted()).toStrictEqual(
      [n1.peerId, n2.peerId].toSorted(),
    )

    // **Read before the strength, because without it the strength cannot be told apart
    // from a lookup.** A receipt derived from two checked signatures and a receipt derived
    // from two certificates the submitter happened to hold are the artifacts this phase
    // exists to distinguish, and only this line separates them.
    for (const replica of shardA.verification.agreeing) {
      expect(replica.attestation).not.toBe('signed-by-nobody')
    }

    // Asserted explicitly rather than inferred from `complete`: a job that ran on two
    // nodes completes either way, and `complete` is not the reading.
    expect('kind' in shardA.attestation).toBe(false)
    if ('kind' in shardA.attestation) return
    expect(shardA.attestation.strength).toBe('owner-domain')
    // VER-10, stated directly rather than implied by the line above. This is the
    // conflation the requirement forbids, and an implementation that returned the stronger
    // label unconditionally would satisfy every other assertion in this block.
    expect(shardA.attestation.strength).not.toBe('independent')
    expect(shardA.attestation.replicas).toBe(2)
    expect(shardA.attestation.operators).toStrictEqual([OWNER_OPERATOR])
    expect(shardA.attestation.userKeys).toStrictEqual([OWNER_USER_KEY])
    expect(shardA.attestation.description).toContain('not across operators')

    // A sovereign shard is never handed to `composeQuorum` — it has one operator by
    // construction, so the composer would refuse it correctly and uselessly. Read here so
    // the `owner-domain` label above is visibly *not* something a quorum produced.
    expect(shardA.quorum.kind).toBe('not-attempted')
    expect(shardA.degraded).toBe(false)
    expect(twoLive.job.complete).toBe(true)
    expect(twoLive.job.attestation).toStrictEqual(shardA.attestation)

    // ---- Between the arms: one of the owner's two nodes goes away. ---------------
    // **Dead before anything is submitted, asserted rather than assumed.** An arm that read
    // `owner-attested` because a node was merely slow would be measuring latency, and Phase
    // 17 set the precedent of falsifying that rather than arguing it away.
    await stopAgentNow(n2)
    expect(isDead(n2)).toBe(true)
    await until(
      () => !requestor.verifiedPeers.includes(n2.peerId),
      VERDICT_DEADLINE_MS,
      () => `the requestor to drop ${n2.peerId}; it still held ${JSON.stringify(requestor.verifiedPeers)}`,
    )

    const alone = await discoverCandidates(
      { inputCid: fixture.inputCid, sovereignFor: OWNER_USER_KEY },
      candidateOptions(fixture),
    )
    expect(alone.executors.map((executor) => executor.nodeId)).toStrictEqual([n1.peerId])
    expect(alone.replicaSets[0]?.certificates).toHaveLength(1)
    // The same field that read `true` above, now reading `false` on the same expression.
    expect(alone.replicaSets[0]?.canVerifyWithinOwnerDomain).toBe(false)

    // ---- Arm B: one live. --------------------------------------------------------
    const oneLive = await submitOver(alone)
    expect(oneLive.ok).toBe(true)
    if (!oneLive.ok) return
    const shardB = oneLive.job.shards[0]
    if (shardB === undefined) throw new Error('expected one shard')

    expect(shardB.verification.status).toBe('agreed')
    if (shardB.verification.status !== 'agreed') return
    expect(shardB.verification.agreeing.map((replica) => replica.nodeId)).toStrictEqual([n1.peerId])
    expect(shardB.verification.agreeing[0]?.attestation).not.toBe('signed-by-nobody')

    expect('kind' in shardB.attestation).toBe(false)
    if ('kind' in shardB.attestation) return
    expect(shardB.attestation.strength).toBe('owner-attested')
    expect(shardB.attestation.strength).not.toBe('independent')
    expect(shardB.attestation.replicas).toBe(1)
    expect(shardB.attestation.operators).toStrictEqual([OWNER_OPERATOR])
    expect(shardB.attestation.description).toContain('not independently verified')

    // The redundancy it asked for was not available, and the shard says so rather than
    // reporting a clean run at one replica.
    expect(shardB.degraded).toBe(true)
    expect(oneLive.job.complete).toBe(false)

    // ---- The third owner's node ran nothing, read from its own store. ------------
    // Read after it is stopped, so its own writes have landed. An agent that executed the
    // shard had to pull the module over the wire to do it, and would hold it.
    await stopAgentNow(foreign)
    const foreignStore = await FsBlockstore.open(foreign.dir)
    expect(await foreignStore.has(fixture.moduleCid)).toBe(false)
    // Not a vacuous reading of an empty or unreadable directory: it holds the row this
    // whole file discovered it by.
    expect(await foreignStore.has(fixture.inputCid)).toBe(true)

    // And nothing above is explained by the surviving node having died.
    expect(n1.child.exitCode).toBeNull()
  }, PROCESS_TEST_TIMEOUT)
})
