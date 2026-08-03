/**
 * Phase 19 criterion 1, across real `bin/agent.ts` processes: one operator cannot fill a
 * quorum, and a fabric that tries is degraded-and-labelled or refused-by-name.
 *
 * ## The entry-point substitution, stated here and not only in a planning document
 *
 * **`bin/agent.ts` submits no job.** It has zero occurrences of `submitJob`, `JobSpec` or
 * `executeVerified`; it is a serving node whose only stdout is a handshake JSON line. So
 * *"a job run through `bin/agent.ts`"* is satisfiable only as **"a job run *across*
 * `bin/agent.ts` processes"** — an in-process requestor, real agent processes underneath
 * it — which is the shape `discovery-agents.node.test.ts` already uses for Phase 18's
 * criteria 1 and 2. It is written in this file because a substitution that lives only in
 * `ROADMAP.md` reaches nobody reading the test.
 *
 * Everything below the entry point is real. Each agent is a separate operating-system
 * process that generated its own identity key, enrolled against a spawned provider
 * process, and got a provider-signed certificate naming the `--operator-id` it was started
 * with. `operatorId` is therefore not a fixture field — it is what a provider signed about
 * a process.
 *
 * ## What each case can and cannot redden on
 *
 * Naming this is the point of the table, because this phase has already shipped one
 * assertion that could not fail.
 *
 * | case | operators | relays | reddens on rule 1 | reddens on rule 2 |
 * |---|---|---|---|---|
 * | three operators (below) | 3 distinct | none — three seeds | **yes** | **no** |
 * | fabric A — one operator | 1 | none — three seeds | **yes** | no |
 * | fabric B — one relay | 3 distinct | one, shared | no | **yes** |
 *
 * The first case **cannot redden on rule 2**: three `bin/agent.ts` processes are all
 * `discoverability: 'seed'`, `sharedRelay` answers `null` the moment it sees a seed, and
 * so the "no two members share a relay" assertion is satisfied incidentally rather than by
 * the rule. Deleting rule 2 from `composeQuorum` leaves it green. Fabric B is the case
 * that carries that claim, and it is the reason fabric B exists at all.
 *
 * ## Why fabric B is NOT built from `bin/agent.ts` processes — measured, not chosen
 *
 * The plan for this file said fabric B's agents would be spawned *"with `--relay-addr`
 * pointing at one relay and no `--port`, so each is `via-relay`"*. **That is not
 * possible**, and the binary says so about itself:
 *
 * - `bin/agent.ts` declares `port: { type: 'string', default: '0' }` and passes
 *   `listen: ['/ip4/127.0.0.1/tcp/${port}']` **unconditionally** to `FabricNode.start`.
 *   There is no argv that makes that array empty.
 * - `fabric-node.ts:1067` derives `canRelay` from that list, and `:611-612` derives the
 *   certificate's `discoverability`/`relayIds` from `canRelay`. A spawned agent is
 *   therefore **always** `seed` with `relayIds: []`, whatever `--relay-addr` it was given.
 * - `--relay-addr`'s own docblock states the consequence in as many words: *"an agent given
 *   a relay address binds a real address of its own **and** asks for a circuit … A node
 *   that bound nothing would be the browser case, and **this binary has no way to produce
 *   one**."*
 *
 * So fabric B's three executors are in-process `FabricNode`s started `listen: []` with one
 * `relayAddrs` entry — the browser's topology, driven from the Node tier, the same
 * construction `relayed-job.node.test.ts` uses. **Their provider is still a real spawned
 * process and their certificates are still provider-signed**, so `operatorId`,
 * `discoverability` and `relayIds` are all statements a provider process signed rather than
 * fixture fields. What is lost is only that fabric B's *executors* are not separate
 * processes.
 *
 * **The honest reading: rule 2 across real `bin/agent.ts` processes is unmeasurable until
 * that binary can produce a node that binds nothing.** That is one flag, deliberately not
 * added here — this plan's declared files are two test files, and a production binary's
 * argv surface is not something a measurement plan should widen on its way past.
 *
 * ## Distinguishability, the same instrument Plan 18-11 used
 *
 * Every engineered outcome below is read **after** an assertion that the requestor reached
 * and qualified every candidate in that same run: `discoverCandidates` returned three
 * executors, excluded none for cause, and their node keys are the three the fixture stood
 * up. So each refusal and each degrade is a fabric that was reached and could not compose a
 * quorum, which an outage cannot produce.
 *
 * ## Budget and seeds
 *
 * The budgets are `discovery-agents.node.test.ts`'s, reused rather than re-chosen — a
 * second set of numbers in a sibling file is how two files drift into disagreeing about
 * what this host can do. Its `spawnAgent`/`stopAgent`/`until`/`writeUserKey` helpers are
 * **faithful copies** rather than imports: importing a helper from another `.test.ts`
 * re-registers that file's whole suite.
 *
 * Publisher seed **66**, checked against the repository's whole census (51 `two-process`,
 * 53 `egress-refusal`, 56 `capability-dispatch`, 57 `browser-capability`, 58
 * `tree-reduce-agents`, 59 `discovery-agents`, 60-62 `combine-signature`, 63-65
 * `result-signature`, 70-72 `combine`/`verify`, 77 `provider-merge`). User-key fills
 * `0xb7`-`0xbc`, also unused. Two fixtures sharing a publisher key couple two files that
 * have nothing to do with each other.
 */
import { spawn } from 'node:child_process'
import type { ChildProcessByStdio } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Readable, Writable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { ed25519 } from '@noble/curves/ed25519.js'
import { canonicalCid, describeAttestation, signName, submitJob, toHex } from '@o2/core'
import type {
  CanonicalValue,
  NameRecord,
  NodeCertificate,
  NodeDescriptor,
  ShardResult,
} from '@o2/core'
import { SEED_BYTES, peerIdForNodeKey } from '@o2/libp2p'
import { discoverCandidates } from '@o2/net'
import type { CID } from 'multiformats/cid'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
// Test-only relative import — see the note in packages/net/src/distributed.test.ts.
import { MODULE_WRITES_PARTITION } from '../../core/src/executor/fixtures.ts'
import { FabricNode } from './fabric-node.ts'
import { FsBlockstore } from './fs-blockstore.ts'

const AGENT = fileURLToPath(new URL('./bin/agent.ts', import.meta.url))

/** Announce budget, `discovery-agents.node.test.ts`'s. */
const ANNOUNCE_BUDGET_MS = 60_000
/** Per-`it` budget, `discovery-agents.node.test.ts`'s. */
const PROCESS_TEST_TIMEOUT = 300_000
/** How long a verdict may take to settle after a dial. */
const VERDICT_DEADLINE_MS = 30_000

/** Seed 66 — see the census in the header. */
const publisher = (() => {
  const priv = new Uint8Array(SEED_BYTES).fill(66)
  return { priv, pub: toHex(ed25519.getPublicKey(priv)) }
})()

function recordFor(name: string, moduleCid: CID): NameRecord {
  return signName(publisher.priv, { name, cid: moduleCid, version: 1, expiresAt: Date.now() + 3_600_000 })
}

type AgentProcess = ChildProcessByStdio<Writable, Readable, Readable>

interface Handshake {
  readonly peerId: string
  readonly multiaddrs: string[]
  readonly trustAnchors: string[]
  readonly nodeKey: string
  readonly certificate: NodeCertificate | null
  readonly issuerKey: string | null
  readonly peers: string[]
  readonly dutyCycle: number
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

/**
 * Defined locally rather than imported. Importing a helper from another `.test.ts`
 * re-registers that file's whole suite — see the note in
 * `certificate-verification.node.test.ts`.
 */
async function until(predicate: () => boolean, timeoutMs: number, what: string): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((r) => setTimeout(r, 20))
  }
  throw new Error(`timed out waiting for ${what}`)
}

/** `bin/agent.ts` refuses to create a user key — see that flag's comment. */
async function writeUserKey(name: string, fill: number): Promise<string> {
  await mkdir(workdir, { recursive: true })
  const path = join(workdir, `${name}.key`)
  await writeFile(path, new Uint8Array(SEED_BYTES).fill(fill), { mode: 0o600 })
  return path
}

/** The one value every job below shards over, and the block discovery goes looking for. */
const SHARD_VALUE: CanonicalValue = { shard: 'quorum-agents' }

interface Fixture {
  readonly provider: Agent
  readonly executors: readonly [Agent, Agent, Agent]
  readonly requestor: FabricNode
  readonly inputCid: CID
  readonly moduleCid: CID
  readonly moduleRecord: NameRecord
}

/**
 * One spawned provider, three spawned agents, one in-process requestor.
 *
 * `operatorIds` is the whole of what differs between the two spawned fabrics: three
 * distinct strings compose a quorum, one string repeated three times cannot. No other
 * knob moves, which is what makes the pair a reading about the rule rather than about two
 * fixtures.
 *
 * Blocks are seeded into each agent's `--dir` through `FsBlockstore` **before** the spawn,
 * because discovery answers "who holds this block" and seeding afterwards races the
 * agent's own open of the same directory. The block seeded is the canonical encoding of
 * the shard value the job later submits, so the block discovery searches for and the block
 * the task reads are the same block rather than two that travel together.
 */
async function standUp(operatorIds: readonly [string, string, string]): Promise<Fixture> {
  const encoded = await canonicalCid(SHARD_VALUE)
  if (!encoded.ok) throw new Error('fixture value is not encodable')

  const names = ['x', 'y', 'z'] as const
  for (const name of names) {
    const store = await FsBlockstore.open(join(workdir, name))
    await store.put(encoded.bytes)
    await store.put(MODULE_WRITES_PARTITION)
  }

  const provider = await spawnAgent('p', ['--issues-certificates'])
  if (provider.issuerKey === null) throw new Error('the provider announced no issuer key')

  const enrol = async (name: string, fill: number, operatorId: string): Promise<Agent> =>
    spawnAgent(name, [
      '--provider-addr',
      provider.multiaddrs[0] as string,
      '--user-key',
      await writeUserKey(name, fill),
      '--operator-id',
      operatorId,
    ])

  const x = await enrol('x', 0xb7, operatorIds[0])
  const y = await enrol('y', 0xb8, operatorIds[1])
  const z = await enrol('z', 0xb9, operatorIds[2])

  // The operator id is a provider's statement, not the fixture's — asserted here once so
  // every reading below can be taken off the certificate rather than off the spawn args.
  for (const [agent, operatorId] of [
    [x, operatorIds[0]],
    [y, operatorIds[1]],
    [z, operatorIds[2]],
  ] as const) {
    expect(agent.certificate?.issuer).toBe(provider.issuerKey)
    expect(agent.certificate?.operatorId).toBe(operatorId)
    // The measurement the header's fabric-B section rests on: `--port` defaults to `'0'`,
    // so every spawned agent binds an address of its own and is a `seed` with no relay
    // dependency. This is why the three-operator case below cannot redden on rule 2.
    expect(agent.certificate?.discoverability).toBe('seed')
    expect(agent.certificate?.relayIds).toStrictEqual([])
  }

  const requestor = await FabricNode.start({
    blockstoreDir: join(workdir, 'requestor'),
    listen: ['/ip4/127.0.0.1/tcp/0'],
    rpcTimeoutMs: 20_000,
    trustAnchors: [publisher.pub],
    trustedIssuers: [provider.issuerKey],
  })
  nodes.push(requestor)

  // Outward, one dial per agent. `LIBP2P_INBOUND_CONNECTION_THRESHOLD` is 5 per host, so
  // a fixture this size must not invert the direction.
  for (const agent of [x, y, z]) await requestor.dial(agent.multiaddrs[0] as string)

  const moduleCid = await requestor.store.put(MODULE_WRITES_PARTITION)
  await requestor.store.put(encoded.bytes)

  return {
    provider,
    executors: [x, y, z],
    requestor,
    inputCid: encoded.cid,
    moduleCid,
    moduleRecord: recordFor('quorum-agents-writes-partition', moduleCid),
  }
}

/** Everything `discoverCandidates` needs, over the verified set. */
function candidateOptions(fixture: Fixture) {
  return {
    rpc: fixture.requestor.rpc,
    peers: () => fixture.requestor.verifiedPeers,
    trustedIssuers: new Set([fixture.provider.issuerKey as string]),
    now: () => Date.now(),
    peerIdFor: peerIdForNodeKey,
    dispatch: 'dispatches-unauthenticated' as const,
  }
}

/**
 * The requestor reached and qualified every candidate, read before any outcome is.
 *
 * Plan 18-11's instrument, one layer up: without it, "this fabric could not compose a
 * quorum" is indistinguishable from "this requestor could not reach anybody". Pointing the
 * requestor at a dead address makes this fail **first**, naming the cause.
 */
function expectAllThreeQualified(
  found: { executors: readonly { nodeId: string }[]; excluded: readonly unknown[]; providers: number },
  expected: readonly Agent[],
): void {
  expect(found.providers).toBe(expected.length)
  expect(found.excluded).toStrictEqual([])
  expect(found.executors.map((e) => e.nodeId).sort()).toStrictEqual(
    expected.map((a) => a.peerId).sort(),
  )
}

/** The certificate this requestor discovered a node under, by node id. */
function certificateOf(nodes: readonly NodeDescriptor[], nodeId: string): NodeCertificate {
  const descriptor = nodes.find((n) => n.nodeId === nodeId)
  if (descriptor === undefined) throw new Error(`no descriptor for ${nodeId}`)
  if (descriptor.certificate === 'carries-no-certificate') {
    throw new Error(`the descriptor for ${nodeId} carries no certificate`)
  }
  return descriptor.certificate
}

/** The node ids of the replicas that agreed, or a loud failure naming what happened instead. */
function agreeingIds(shard: ShardResult): readonly string[] {
  if (shard.verification.status !== 'agreed') {
    throw new Error(`expected an agreed shard, got ${shard.verification.status}`)
  }
  return shard.verification.agreeing.map((replica) => replica.nodeId)
}

beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'o2-quorum-'))
})

/**
 * 60 s, which must exceed `stopAgent`'s inner 10 s or its SIGKILL fallback could never
 * fire — the inversion three files in this repository carried until 2026-07-31.
 */
afterEach(async () => {
  await Promise.all(nodes.splice(0).map((node) => node.stop().catch(() => {})))
  await Promise.all(agents.splice(0).map((a) => stopAgent(a).catch(() => {})))
  await rm(workdir, { recursive: true, force: true })
}, 60_000)

describe('criterion 1 — three operators, a quorum whose independence is read off certificates', () => {
  it('composes across two distinct operators that share no relay, and labels it independent', async () => {
    const fixture = await standUp(['x-ops', 'y-ops', 'z-ops'])
    const { executors, requestor } = fixture

    await until(
      () => requestor.verifiedPeers.length === 3,
      VERDICT_DEADLINE_MS,
      `three verified peers, saw ${requestor.verifiedPeers.length}`,
    )

    const found = await discoverCandidates({ inputCid: fixture.inputCid }, candidateOptions(fixture))
    expectAllThreeQualified(found, executors)

    const result = await submitJob(
      {
        moduleCid: fixture.moduleCid,
        moduleRecord: fixture.moduleRecord,
        shards: [{ value: SHARD_VALUE, label: 'public' }],
        executors: found.executors,
        nodes: found.nodes,
        redundancy: 2,
        onQuorumShortfall: 'runs-at-available-redundancy',
      },
      requestor.store,
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const shard = result.job.shards[0]
    if (shard === undefined) throw new Error('expected one shard')

    // ---- The quorum composed, and the composer says which operators it asked. -------
    expect(shard.quorum.kind).toBe('composed')
    if (shard.quorum.kind !== 'composed') return
    expect(new Set(shard.quorum.operators).size).toBe(2)

    // ---- The job agreed at the redundancy it asked for. ----------------------------
    expect(shard.verification.status).toBe('agreed')
    expect(shard.degraded).toBe(false)
    expect(result.job.complete).toBe(true)
    const agreed = agreeingIds(shard)
    expect(agreed).toHaveLength(2)

    // ---- The operators are the provider's, not the fixture's. ----------------------
    // Taken from the receipt — which `receiptFor` built out of certificates whose
    // holders' signatures over THIS task and THIS output verified — and compared against
    // the `--operator-id` strings the two winning PROCESSES were spawned with. A fixture
    // field could not fail this comparison; a signed statement can.
    const attestation = shard.attestation
    if ('kind' in attestation) {
      throw new Error(`expected a receipt, got the named absence: ${attestation.reason}`)
    }
    const spawnedOperatorOf = (nodeId: string): string => {
      const agent = executors.find((a) => a.peerId === nodeId)
      if (agent === undefined) throw new Error(`${nodeId} is not one of the spawned agents`)
      return `${agent.name}-ops`
    }
    expect([...attestation.operators].sort()).toStrictEqual(agreed.map(spawnedOperatorOf).sort())
    expect(new Set(attestation.operators).size).toBe(2)
    expect(attestation.replicas).toBe(2)

    // ---- No two agreeing members share a relay. ------------------------------------
    // Read off the certificates the descriptors carry rather than off how the fixture was
    // spawned. **This assertion cannot redden on rule 2** — see the header's table: three
    // spawned agents are seeds, `sharedRelay` answers `null` on sight of one, and the
    // intersection is empty whatever `composeQuorum` does. It is asserted because the
    // reworded criterion names the property; fabric B is what guards the rule.
    const agreeingCertificates = agreed.map((nodeId) => certificateOf(found.nodes, nodeId))
    const shared = agreeingCertificates.reduce<readonly string[]>(
      (common, certificate) => common.filter((relay) => certificate.relayIds.includes(relay)),
      agreeingCertificates[0]?.relayIds ?? [],
    )
    expect(shared).toStrictEqual([])
    expect(attestation.sharedRelay).toBeNull()

    // ---- The strength, not merely that the job finished. ---------------------------
    // A job over one operator would also complete; `owner-domain` is what it would read,
    // and fabric A below is that job over this same shape of fixture.
    expect(attestation.strength).toBe('independent')
    expect(attestation.description).toBe(describeAttestation('independent'))
    expect(result.job.attestation).toStrictEqual(attestation)
  }, PROCESS_TEST_TIMEOUT)
})
