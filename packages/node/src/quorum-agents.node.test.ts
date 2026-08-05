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
 * | the binding precondition | — | one | no — reads no quorum | no |
 * | three operators (below) | 3 distinct | none — three seeds | **yes** | **no** |
 * | fabric A — one operator | 1 | none — three seeds | **yes** | no |
 * | fabric B — one relay | 3 distinct | one, shared | no | **yes** |
 *
 * The three-operator case **cannot redden on rule 2**: those `bin/agent.ts` processes are
 * given no `--relay-addr`, so they are all `discoverability: 'seed'`, `sharedRelay` answers
 * `null` the moment it sees a seed, and the "no two members share a relay" assertion is
 * satisfied incidentally rather than by the rule. Deleting rule 2 from `composeQuorum`
 * leaves it green. Fabric B is the case that carries that claim, and it is the reason
 * fabric B exists at all. **That has not changed and is not expected to** — what changed is
 * which tier fabric B is built at.
 *
 * ## Fabric B IS built from `bin/agent.ts` processes, since 2026-08-04
 *
 * It was not, until then, and the reason was a real limit rather than a preference: the
 * binary declared `port: { type: 'string', default: '0' }` and passed
 * `listen: ['/ip4/127.0.0.1/tcp/${port}']` unconditionally, so **no argv could empty that
 * array**. `canRelay` (`fabric-node.ts:1083`) is a predicate over exactly that list and
 * `:627-628` derives `discoverability`/`relayIds` from it, so every spawned agent was
 * `seed` with `relayIds: []` whatever `--relay-addr` it was given — and the only fabric
 * that could redden on rule 2 was three in-process `FabricNode`s. `19-VERIFICATION.md`
 * scored criterion 1 **PARTIAL** for precisely that: the criterion names `bin/agent.ts` as
 * the entry point and half of it held one tier below.
 *
 * Plan 19-19 dropped `--port`'s default, so *not passed* is distinguishable from *passed as
 * `0`* and the listen list became conditional. An agent given `--relay-addr` and no
 * `--port` now binds nothing, enrols `via-relay`, and names its relay in the certificate a
 * provider process signed about it. The `describe` immediately above fabric B reads that
 * property on its own, against a `--port 0` control, before anything is built on it.
 *
 * **What this buys, stated as the reading it is:** deleting rule 2 from `composeQuorum` now
 * reddens a fabric whose executors are four separate operating-system processes, not one
 * heap. Ledger entry `M40` records the observed text.
 *
 * A second thing was measured while building that fabric and is recorded at
 * `standUpBehindOneRelay`: routing the **job** over the circuit does not work, and this
 * repository already knew. The relay is a signalling channel, not a data path.
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
import { discoverCandidates, encodeRequest, parseResponse } from '@o2/net'
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
/**
 * The same verdict, over a circuit.
 *
 * Longer because every step is one hop further: the peer gate's `records` request travels
 * relay-in and relay-out, and the reservation itself has to be granted before the dial that
 * carries it can even be attempted. Stated as its own constant rather than by raising
 * `VERDICT_DEADLINE_MS` for everybody — a budget raised for one case and applied to all is
 * how a file stops noticing that the direct case got slower.
 */
const RELAYED_VERDICT_DEADLINE_MS = 60_000

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
  /**
   * NET-05's grant side, read off `bin/agent.ts`'s own handshake line rather than
   * inferred. `[]` is a statement that no relay granted, not the absence of one — see
   * that binary's module comment. Named here because this file now reads it.
   */
  readonly relays: string[]
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
 *
 * **`what` may be a thunk, and every caller here that has state worth reporting passes
 * one.** `reservation-exhaustion.node.test.ts` records why: a template literal built at the
 * call site reports the state *before* the waiting started, which is empty every time, so
 * it looks like a diagnostic and carries nothing. Evaluated at the throw, it carries what
 * actually arrived.
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

/**
 * Poll one peer's own `providers` answer until it names itself as a holder of this block.
 *
 * **A precondition, and it names which node failed.** `RpcRecordIndex.providers` asks every
 * peer concurrently and *swallows* a transport error — *"a peer that could not be reached
 * contributes nothing to a union"* — so a single unanswered request lands as
 * `providers: 2` with nothing anywhere saying which of the three was silent. That is
 * exactly what the first relayed run of this file reported, and it is unreadable as a
 * failure. Asked node by node, the same condition names the node and carries its last
 * answer.
 *
 * Polled rather than read once, because a node behind a relay is reachable only once its
 * reservation is granted and the requestor's own circuit dial has completed, and neither is
 * instantaneous. A sleep would be a guess about those; this is a reading of the node's own
 * answer.
 */
async function untilAdvertises(
  requestor: FabricNode,
  peer: { readonly peerId: string; readonly nodeKey: string },
  cid: CID,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let last: unknown = 'the peer was never asked'
  while (Date.now() < deadline) {
    try {
      const reply = parseResponse(
        await requestor.rpc.request(peer.peerId, encodeRequest({ kind: 'providers', cid })),
      )
      last = reply
      if (reply?.kind === 'providers' && reply.nodeKeys.includes(peer.nodeKey)) return
    } catch (cause) {
      last = cause instanceof Error ? cause.message : String(cause)
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(
    `${peer.peerId} never advertised ${cid.toString()}; its last answer was ${JSON.stringify(last)}`,
  )
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

  const provider = await spawnAgent('p', ['--issues-certificates', '--max-issued-per-window', '64'])
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
    // Why the three-operator case below cannot redden on rule 2, read rather than assumed.
    // These agents are given no `--relay-addr`, so `bin/agent.ts` binds them
    // `/ip4/127.0.0.1/tcp/0` — the middle row of that binary's `listen` table, unchanged by
    // Plan 19-19's removal of `--port`'s default — `canRelay` is true, and each is a `seed`
    // with no relay dependency for `sharedRelay` to find.
    expect(agent.certificate?.discoverability).toBe('seed')
    expect(agent.certificate?.relayIds).toStrictEqual([])
  }

  const requestor = await FabricNode.start({
    relayAdmission: 'admits-any-peer',
    startReporting: 'reports-its-own-start',
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

/**
 * Everything `discoverCandidates` needs, over the verified set.
 *
 * Structural in its parameter rather than typed to `Fixture`, because both stand-ups below
 * hand it the same two things — an in-process requestor and a spawned provider's issuer key
 * — and a second copy of this function for the relayed fixture would be a second place the
 * pinned-issuer decision is made.
 */
function candidateOptions(fixture: {
  readonly requestor: FabricNode
  readonly provider: { readonly issuerKey: string | null }
}) {
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
  expected: readonly { peerId: string }[],
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

    // **Membership, never a count.** A count of three is satisfiable by the wrong three
    // peers, and fabric B below is where that actually happened: the requestor is connected
    // to the relay as well as to the executors, so `verifiedPeers.length === 3` was reached
    // with only two executors in the list and discovery then asked two nodes instead of
    // three. The count read as a precondition and guarded nothing.
    await until(
      () => executors.every((agent) => requestor.verifiedPeers.includes(agent.peerId)),
      VERDICT_DEADLINE_MS,
      () => `all three agents verified; the verified set was ${JSON.stringify(requestor.verifiedPeers)}`,
    )

    // Each node asked on its own, before the union below. `RpcRecordIndex.providers` asks
    // every peer concurrently and swallows a transport error, so one silent peer lands as a
    // provider count one short with nothing naming which. See `untilAdvertises`.
    for (const agent of executors) {
      await untilAdvertises(requestor, agent, fixture.inputCid, VERDICT_DEADLINE_MS)
    }

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

/**
 * Fabric A — three processes, one operator, submitted three times over ONE live fixture.
 *
 * **Both dial arms run over the same live agents, and that is the whole design.** Two
 * fabrics behaving differently would prove that two fabrics behave differently; one fabric
 * submitted twice, differing in exactly one field of one object, proves that the dial is
 * what decided. The `submitOver` closure below exists so the two calls cannot drift: every
 * other argument comes from the same variables, so there is no second place for a
 * difference to hide.
 *
 * The redundancy-1 control is the third submission, and it is what makes the other two a
 * reading rather than an observation about this fabric. Without it, "the shard degraded"
 * could be anything about three one-operator agents; with it, the same three agents run a
 * job that neither degrades nor is refused **on either arm**, because no quorum was
 * attempted and so there was nothing to fall short of.
 */
describe('criterion 1 engineered — one operator: degraded by default, refused on request', () => {
  it('degrades to owner-domain on the default dial, is refused in the composer’s words on the strict one, and leaves a redundancy-1 job untouched by either', async () => {
    // The engineered condition, and the only thing that differs from the case above.
    const fixture = await standUp(['one-ops', 'one-ops', 'one-ops'])
    const { executors, requestor } = fixture

    // **Membership, never a count.** A count of three is satisfiable by the wrong three
    // peers, and fabric B below is where that actually happened: the requestor is connected
    // to the relay as well as to the executors, so `verifiedPeers.length === 3` was reached
    // with only two executors in the list and discovery then asked two nodes instead of
    // three. The count read as a precondition and guarded nothing.
    await until(
      () => executors.every((agent) => requestor.verifiedPeers.includes(agent.peerId)),
      VERDICT_DEADLINE_MS,
      () => `all three agents verified; the verified set was ${JSON.stringify(requestor.verifiedPeers)}`,
    )

    // Each node asked on its own, before the union below. `RpcRecordIndex.providers` asks
    // every peer concurrently and swallows a transport error, so one silent peer lands as a
    // provider count one short with nothing naming which. See `untilAdvertises`.
    for (const agent of executors) {
      await untilAdvertises(requestor, agent, fixture.inputCid, VERDICT_DEADLINE_MS)
    }

    // ---- The requestor reached and qualified every one of them. --------------------
    // Read before any outcome, so no refusal below can be confused with an outage.
    const found = await discoverCandidates({ inputCid: fixture.inputCid }, candidateOptions(fixture))
    expectAllThreeQualified(found, executors)

    // And the concentration is a fact about what a provider signed, not about the spawn
    // arguments: three qualified candidates, one operator id among them.
    const operators = new Set(
      found.nodes.map((node) => certificateOf(found.nodes, node.nodeId).operatorId),
    )
    expect([...operators]).toStrictEqual(['one-ops'])

    // One object, one varying field. See this describe's doc.
    const submitOver = async (
      redundancy: number,
      onQuorumShortfall: 'runs-at-available-redundancy' | 'refuses-the-shard',
    ) =>
      submitJob(
        {
          moduleCid: fixture.moduleCid,
          moduleRecord: fixture.moduleRecord,
          shards: [{ value: SHARD_VALUE, label: 'public' }],
          executors: found.executors,
          nodes: found.nodes,
          redundancy,
          onQuorumShortfall,
        },
        requestor.store,
      )

    const shardOf = (result: Awaited<ReturnType<typeof submitOver>>): ShardResult => {
      if (!result.ok) throw new Error(`submitJob refused the whole job: ${JSON.stringify(result.error)}`)
      const shard = result.job.shards[0]
      if (shard === undefined) throw new Error('expected one shard')
      return shard
    }

    // ---- A-degrade: the default arm. ----------------------------------------------
    const degradeRun = await submitOver(2, 'runs-at-available-redundancy')
    const degraded = shardOf(degradeRun)

    // The composer noticed, and its own words are on the shard. A caller that can read
    // this can tell an over-concentrated fabric from any other degradation, which is the
    // whole reason degrading here is defensible rather than silent.
    expect(degraded.quorum.kind).toBe('not-composed')
    if (degraded.quorum.kind !== 'not-composed') return
    expect(degraded.quorum.refusal.kind).toBe('insufficient-operators')
    if (degraded.quorum.refusal.kind !== 'insufficient-operators') return
    expect(degraded.quorum.refusal.wanted).toBe(2)
    expect(degraded.quorum.refusal.distinctOperators).toBe(1)
    expect(degraded.quorum.reason).toBe('quorum of 2 needs 2 distinct operators, found 1')

    // It ran anyway, at the redundancy that was available.
    expect(degraded.verification.status).toBe('agreed')
    expect(agreeingIds(degraded)).toHaveLength(2)

    // **`degraded` is true at FULL redundancy.** Two replicas were asked for and two ran,
    // so the pre-19-06 reading of this flag — "achieved redundancy is below what was
    // asked" — would have been `false`, and a caller filtering on it would have accepted a
    // shard that failed to get the independence it asked for.
    expect(degraded.degraded).toBe(true)
    expect(degradeRun.ok && degradeRun.job.complete).toBe(false)

    // And the receipt names the weaker outcome rather than the stronger one. This is
    // criterion 1's load-bearing word: a labelled weaker result is not a silent one.
    const degradedAttestation = degraded.attestation
    if ('kind' in degradedAttestation) {
      throw new Error(`expected a receipt, got the named absence: ${degradedAttestation.reason}`)
    }
    expect(degradedAttestation.strength).toBe('owner-domain')
    expect(degradedAttestation.strength).not.toBe('independent')
    expect(degradedAttestation.description).toBe(describeAttestation('owner-domain'))
    expect(degradedAttestation.replicas).toBe(2)
    expect([...degradedAttestation.operators]).toStrictEqual(['one-ops'])

    // ---- A-refuse: the strict arm, over the SAME live agents. ----------------------
    const refuseRun = await submitOver(2, 'refuses-the-shard')
    const refused = shardOf(refuseRun)

    expect(refused.verification.status).toBe('insufficient')
    if (refused.verification.status !== 'insufficient') return
    // The composer's own words reached the requestor through the job result — the same
    // string the degrade arm carried on `quorum`, so the two arms are demonstrably reading
    // one refusal rather than composing two.
    expect(refused.verification.reason).toBe(degraded.quorum.reason)
    expect(refused.quorum).toStrictEqual(degraded.quorum)
    expect(refuseRun.ok && refuseRun.job.complete).toBe(false)
    // Nothing ran, so there is nothing to attest and the receipt says exactly that rather
    // than reporting a strength over an empty set.
    expect('kind' in refused.attestation && refused.attestation.kind).toBe(
      'holds-no-verified-attestation',
    )

    // ---- The control: redundancy 1, on BOTH arms. ---------------------------------
    // The dial is read where a shortfall happened and nowhere else, and this is the
    // assertion that says so: the same fabric, the same three one-operator agents, and
    // both arms produce the identical undegraded `owner-attested` answer because no quorum
    // was attempted at all.
    for (const arm of ['runs-at-available-redundancy', 'refuses-the-shard'] as const) {
      const controlRun = await submitOver(1, arm)
      const control = shardOf(controlRun)
      expect(control.quorum.kind, arm).toBe('not-attempted')
      if (control.quorum.kind !== 'not-attempted') return
      expect(control.quorum.reason, arm).toBe(
        'redundancy 1 asks for no verification, so there is no quorum to compose',
      )
      expect(control.verification.status, arm).toBe('agreed')
      expect(control.degraded, arm).toBe(false)
      expect(controlRun.ok && controlRun.job.complete, arm).toBe(true)
      const controlAttestation = control.attestation
      if ('kind' in controlAttestation) {
        throw new Error(`expected a receipt on ${arm}, got: ${controlAttestation.reason}`)
      }
      expect(controlAttestation.strength, arm).toBe('owner-attested')
      expect(controlAttestation.replicas, arm).toBe(1)
    }
  }, PROCESS_TEST_TIMEOUT)
})

/**
 * Fabric B's precondition, measured on its own before anything is built on it.
 *
 * Until 2026-08-04 `bin/agent.ts` declared `port` with `default: '0'` and passed
 * `listen: ['/ip4/127.0.0.1/tcp/${port}']` unconditionally, so **no argv could empty that
 * array**: `canRelay` was always true, every spawned agent signed `discoverability: 'seed'`
 * with `relayIds: []`, and rule 2 had no across-process reading anywhere. That is the whole
 * of what `19-VERIFICATION.md` scored criterion 1 PARTIAL for.
 *
 * The mechanism is one distinction: **`--port` no longer has a default**, so *not passed* is
 * different from *passed as `0`*, and the listen list can be built conditionally. Both
 * halves are read here because only the pair is a measurement — the first alone would not
 * show that the old behaviour survived, and the second alone would not show anything new.
 *
 * **This is a binding choice, not a node kind.** The two agents below differ in what they
 * *did* — one bound a socket, one did not — and in nothing they *can do*. Both execute
 * tasks, serve blocks and answer records; `bin/agent.ts` carries that sentence at every flag
 * it declares, and `STATE.md`'s cardinal rule is that a decision keying on node kind is
 * wrong. This phase already retracted one rule (`0314208`) for being exactly that.
 */
describe('criterion 1’s precondition — `bin/agent.ts` can produce a node that binds nothing', () => {
  it('signs via-relay naming its relay when --port is not passed, and seed when --port 0 is', async () => {
    const relay = await FabricNode.start({
      relayAdmission: 'admits-any-peer',
      startReporting: 'reports-its-own-start',
      listen: ['/ip4/127.0.0.1/tcp/0/ws'],
      maxReservations: 8,
      trustAnchors: [publisher.pub],
    })
    nodes.push(relay)
    const relayAddr = relay.browserDialableAddrs[0]
    if (relayAddr === undefined) throw new Error('the relay published no browser-dialable address')

    const provider = await spawnAgent('p', ['--issues-certificates', '--max-issued-per-window', '64'])
    if (provider.issuerKey === null) throw new Error('the provider announced no issuer key')

    // One closure, one varying argument. The two agents below differ in exactly the flag
    // under test and in nothing else, so what differs in their certificates is what that
    // flag decided — the construction fabric A already uses for its two dial arms.
    const enrol = async (
      name: string,
      fill: number,
      port: readonly string[],
    ): Promise<Agent> =>
      spawnAgent(name, [
        '--provider-addr',
        provider.multiaddrs[0] as string,
        '--user-key',
        await writeUserKey(name, fill),
        '--operator-id',
        `${name}-ops`,
        '--relay-addr',
        relayAddr,
        ...port,
      ])

    // ---- No `--port`: the node binds nothing. --------------------------------------
    // Read off the certificate a provider **process** signed, not off the spawn args, and
    // off the handshake line's own `relays` field, which reports circuits that were
    // granted rather than relays that were asked.
    const unbound = await enrol('unbound', 0xbd, [])
    expect(unbound.certificate?.discoverability).toBe('via-relay')
    expect(unbound.certificate?.relayIds).toStrictEqual([relay.peerId])
    expect(unbound.relays.length).toBeGreaterThan(0)
    for (const address of unbound.relays) expect(address).toContain('/p2p-circuit')
    // The claim the certificate rests on: every address this process holds is one the
    // relay granted. `canRelay` is a predicate over exactly this list.
    expect(unbound.multiaddrs.filter((ma) => !ma.includes('/p2p-circuit'))).toStrictEqual([])

    // ---- `--port 0`: unchanged, and this is the regression guard. -------------------
    // Every pre-existing spawn site of this binary either passes no `--relay-addr` at all
    // (so the listen list is what it always was) or is this shape. Asserted rather than
    // assumed: fourteen executors in this phase found a proof in their own plan that could
    // not fail, and "nothing else changed" is the easiest such claim to make.
    const seed = await enrol('seeded', 0xbe, ['--port', '0'])
    expect(seed.certificate?.discoverability).toBe('seed')
    expect(seed.certificate?.relayIds).toStrictEqual([])
    expect(seed.multiaddrs.some((ma) => ma.includes('/tcp/') && !ma.includes('/p2p-circuit'))).toBe(
      true,
    )
    // It asked for a circuit too, and got one — so the difference above is the binding and
    // not the relay having refused one of them.
    expect(seed.relays.length).toBeGreaterThan(0)
  }, PROCESS_TEST_TIMEOUT)
})

/**
 * Fabric B — three distinct operators, one relay between all of them and the world.
 *
 * **This is the case that carries rule 2.** The three-operator case above satisfies
 * "no two members share a relay" incidentally, because three spawned agents are seeds;
 * deleting rule 2 from `composeQuorum` leaves it green. Here the operators are deliberately
 * distinct — `ra-ops`, `rb-ops`, `rc-ops` — so rule 1 is satisfied and **only** rule 2 can
 * fire. Asserting the refusal *kind* rather than merely that something degraded is what
 * separates the two: `insufficient-operators` would degrade this shard too, and would mean
 * the fixture was built wrong.
 *
 * ## The executors are spawned `bin/agent.ts` processes, and that is criterion 1's clause
 *
 * They were in-process `FabricNode`s until 2026-08-04, because the binary could not produce
 * a node that binds nothing — this file's header carries that measurement and what closed
 * it. They are now four separate operating-system processes (a provider and three agents),
 * each of which generated its own identity key, dialled a provider process, and was handed
 * a certificate naming the `--operator-id` and the `discoverability` **that provider**
 * decided. Nothing about the topology below is a fixture field.
 *
 * The relay is a single point of failure over which a redundancy of two is not a
 * redundancy: lose it and every member of the quorum goes at once. That is what eclipse
 * resistance means here, and it is the whole of what survives the anchor rule's retraction.
 */
interface RelayedFixture {
  readonly provider: Agent
  readonly relay: FabricNode
  readonly executors: readonly Agent[]
  readonly requestor: FabricNode
  readonly inputCid: CID
  readonly moduleCid: CID
  readonly moduleRecord: NameRecord
}

/**
 * One in-process relay, one spawned provider, one in-process requestor, and three spawned
 * `bin/agent.ts` processes that hold a reservation on the relay and bind nothing of their
 * own.
 *
 * `--relay-addr <relay>` with **no `--port`** is the entire mechanism, and it lives in the
 * binary rather than here: `bin/agent.ts` passes `listen: []`, `fabric-node.ts:1072-1076`
 * turns that plus a relay into a listen list of `['/p2p-circuit']` alone, `:1083` reads
 * `canRelay` off it as false, and `:627-628` therefore signs `discoverability: 'via-relay'`
 * with the relay's peer id in `relayIds`. Nothing here is engineered beyond the relay
 * address; the certificate is one process's statement about another that genuinely binds
 * nothing. Each agent's own handshake line carries `relays`, written after `bin/agent.ts`
 * has settled the reservation question, so a granted circuit is read rather than waited for.
 *
 * ## Why the requestor is stood up BEFORE the agents
 *
 * A node that binds nothing cannot be dialled directly, so the dial has to run the other
 * way — and the only way a spawned agent dials anything is `--peer-addr`, which it takes at
 * startup. So the requestor must exist first, and its address is an argument to the spawn.
 * That also makes the peering a *precondition* rather than a hope: `bin/agent.ts` dials
 * every `--peer-addr` before it writes its handshake line and exits 2 if any of them fails,
 * so an agent that announced has already reached the requestor.
 *
 * The three-agent count is the minimum the case needs: two of three behind one relay is a
 * different fabric from all three behind it, and rule 2 is asked of the **members** rather
 * than the pool (`quorum.ts:200-215`). Four processes plus two in-process nodes is inside
 * this repository's established budget — `discovery-agents.node.test.ts` runs seven
 * children, `tree-reduce-agents.node.test.ts` nine.
 *
 * ## The executors dial the requestor, and that is the architecture rather than a shortcut
 *
 * **The relay is a signalling channel for registration and discovery, not a data path** —
 * this repository's recorded Phase 3 decision, restated in `CLAUDE.md` against libp2p's own
 * measured defaults: 2 minutes and 128 KiB per relayed connection. *"Once connected, the
 * peers are indistinguishable"*, and the relay drops out. So the connection a job travels
 * over is a direct one, opened here by the side that cannot be dialled — the same direction
 * a browser peer opens after WebRTC signalling completes.
 *
 * **Routing the job over the circuit instead was tried and measured**, because it is the
 * obvious first arrangement: with the requestor holding its own reservation and dialling
 * three `/p2p-circuit` addresses, one peer's every first request stalled for the full 30 s
 * RPC timeout — a 33 s peer-gate verdict, a 30 s discovery, a 30 s submit, and a shard that
 * came back with **one** replica of the two it placed. Raising the relay's
 * `maxReservations` from 8 to 32 changed nothing. `relayed-job.node.test.ts` records the
 * same wall: *"a full redundant job over relayed connections is NOT verified here.
 * Attempting it surfaced a design problem that needs a fix rather than a test."*
 *
 * **So do not "fix" this fixture by pointing the job at the circuit.** What comes off the
 * relay here is the *certificate's* `relayIds` — a statement about how each node is
 * **discovered** — and that is exactly what rule 2 reads. The socket the bytes travel is a
 * separate question this file does not re-open. A reader who routes the job over the
 * circuit will see it stall at exactly `rpcTimeoutMs` and conclude the fabric is broken; it
 * is not, and the stall is deferred item 3.
 *
 * The requestor therefore needs no reservation and no `circuitRelayTransport`: it listens on
 * TCP and is dialled.
 */
async function standUpBehindOneRelay(): Promise<RelayedFixture> {
  const encoded = await canonicalCid(SHARD_VALUE)
  if (!encoded.ok) throw new Error('fixture value is not encodable')

  const names = ['ra', 'rb', 'rc'] as const
  // Before the spawn, exactly as `standUp` does and for its reason: discovery answers "who
  // holds this block", and seeding a directory afterwards races the agent's own open of it.
  for (const name of names) {
    const store = await FsBlockstore.open(join(workdir, name))
    await store.put(encoded.bytes)
    await store.put(MODULE_WRITES_PARTITION)
  }

  const relay = await FabricNode.start({
    relayAdmission: 'admits-any-peer',
    startReporting: 'reports-its-own-start',
    listen: ['/ip4/127.0.0.1/tcp/0/ws'],
    maxReservations: 8,
    trustAnchors: [publisher.pub],
  })
  nodes.push(relay)
  const relayAddr = relay.browserDialableAddrs[0]
  if (relayAddr === undefined) throw new Error('the relay published no browser-dialable address')

  const provider = await spawnAgent('p', ['--issues-certificates', '--max-issued-per-window', '64'])
  if (provider.issuerKey === null) throw new Error('the provider announced no issuer key')

  const requestor = await FabricNode.start({
    relayAdmission: 'admits-any-peer',
    startReporting: 'reports-its-own-start',
    blockstoreDir: join(workdir, 'requestor'),
    listen: ['/ip4/127.0.0.1/tcp/0'],
    rpcTimeoutMs: 20_000,
    trustAnchors: [publisher.pub],
    trustedIssuers: [provider.issuerKey],
  })
  nodes.push(requestor)

  // Inward, one dial per executor, and the direction is forced: a node that binds nothing
  // cannot be dialled directly, so it must do the dialling. `--peer-addr` is that flag, and
  // it is deliberately not `--provider-addr` — see both docblocks in `bin/agent.ts`.
  const requestorAddr = requestor.multiaddrs.find(
    (ma) => ma.includes('/tcp/') && !ma.includes('/p2p-circuit'),
  )
  if (requestorAddr === undefined) throw new Error('the requestor bound no direct address')

  const executors: Agent[] = []
  for (const [name, fill, operatorId] of [
    ['ra', 0xba, 'ra-ops'],
    ['rb', 0xbb, 'rb-ops'],
    ['rc', 0xbc, 'rc-ops'],
  ] as const) {
    const agent = await spawnAgent(name, [
      '--provider-addr',
      provider.multiaddrs[0] as string,
      '--user-key',
      await writeUserKey(name, fill),
      '--operator-id',
      operatorId,
      // The two flags that make this a `via-relay` node, and the absence that makes them
      // work: no `--port`, so `bin/agent.ts` binds nothing at all.
      '--relay-addr',
      relayAddr,
      '--peer-addr',
      requestorAddr,
    ])
    // No `--trusted-issuer`, matching `standUp` and for the same reason: what this fixture
    // reads is the certificate the PROVIDER signed about each agent, and an agent's own
    // pinning decides only whom it would fetch blocks from — which it never needs to, since
    // its store was seeded above.
    executors.push(agent)
  }

  // Read, not waited for. `bin/agent.ts` settles the reservation question before it
  // announces, so a handshake line carrying circuits is a granted fact — and one carrying
  // none is a fixture that did not stand up, said here rather than three assertions later.
  for (const agent of executors) {
    expect(agent.relays.length, `${agent.name} holds no circuit; it announced ${JSON.stringify(agent)}`).toBeGreaterThan(0)
  }

  const moduleCid = await requestor.store.put(MODULE_WRITES_PARTITION)
  await requestor.store.put(encoded.bytes)

  return {
    provider,
    relay,
    executors,
    requestor,
    inputCid: encoded.cid,
    moduleCid,
    moduleRecord: recordFor('quorum-agents-writes-partition', moduleCid),
  }
}

describe('criterion 1 engineered — one relay: caught by rule 2 and named by its relay', () => {
  it('refuses for the shared relay and not for the operators, degrades under the default dial, and names the relay in the composer’s words', async () => {
    const fixture = await standUpBehindOneRelay()
    const { relay, executors, requestor } = fixture

    // Membership, for the reason recorded at the spawned fixtures' wait — and this is the
    // fixture that taught it. The requestor holds a reservation on the relay, so the relay
    // is a connected peer of its own, and a count reached three before the third executor's
    // records round trip had landed.
    await until(
      () => executors.every((node) => requestor.verifiedPeers.includes(node.peerId)),
      RELAYED_VERDICT_DEADLINE_MS,
      () =>
        `all three relayed peers verified; the verified set was ` +
        `${JSON.stringify(requestor.verifiedPeers)} and the relay is ${relay.peerId}`,
    )

    // Node by node, and this is the fixture that made it necessary — see `untilAdvertises`.
    for (const node of executors) {
      await untilAdvertises(requestor, node, fixture.inputCid, RELAYED_VERDICT_DEADLINE_MS)
    }

    // ---- The requestor reached and qualified every one of them. --------------------
    const found = await discoverCandidates({ inputCid: fixture.inputCid }, candidateOptions(fixture))
    expectAllThreeQualified(
      found,
      executors.map((node) => ({ peerId: node.peerId })),
    )

    // ---- The fixture is engineered for rule 2 and against rule 1. ------------------
    // Three distinct operators, so `insufficient-operators` cannot fire; one shared relay
    // named on every certificate, so `shared-relay-dependency` is the only thing left.
    // Both read off what the provider process signed.
    const certificates = found.nodes.map((node) => certificateOf(found.nodes, node.nodeId))
    expect(new Set(certificates.map((c) => c.operatorId)).size).toBe(3)
    for (const certificate of certificates) {
      expect(certificate.discoverability).toBe('via-relay')
      expect(certificate.relayIds).toStrictEqual([relay.peerId])
    }

    // One object, one varying field — fabric A's construction, for fabric A's reason.
    const submitOver = async (
      onQuorumShortfall: 'runs-at-available-redundancy' | 'refuses-the-shard',
    ) =>
      submitJob(
        {
          moduleCid: fixture.moduleCid,
          moduleRecord: fixture.moduleRecord,
          shards: [{ value: SHARD_VALUE, label: 'public' }],
          executors: found.executors,
          nodes: found.nodes,
          redundancy: 2,
          onQuorumShortfall,
        },
        requestor.store,
      )

    const shardOf = (result: Awaited<ReturnType<typeof submitOver>>): ShardResult => {
      if (!result.ok) throw new Error(`submitJob refused the whole job: ${JSON.stringify(result.error)}`)
      const shard = result.job.shards[0]
      if (shard === undefined) throw new Error('expected one shard')
      return shard
    }

    // ---- B-degrade: the default arm. ----------------------------------------------
    const degradeRun = await submitOver('runs-at-available-redundancy')
    const degraded = shardOf(degradeRun)

    expect(degraded.quorum.kind).toBe('not-composed')
    if (degraded.quorum.kind !== 'not-composed') return
    // The kind, not merely that something happened. This is the assertion that fails if
    // the fixture is built with one shared `--operator-id` — the single most likely way to
    // get it wrong — because the reason would then be `insufficient-operators`.
    expect(degraded.quorum.refusal.kind).toBe('shared-relay-dependency')
    if (degraded.quorum.refusal.kind !== 'shared-relay-dependency') return
    expect(degraded.quorum.refusal.relayId).toBe(relay.peerId)
    expect(degraded.quorum.reason).toBe(
      `every member of the quorum is discoverable only through relay ${relay.peerId}; ` +
        'its failure would lose the whole quorum',
    )
    expect(degraded.degraded).toBe(true)

    // The shard ran anyway — that is what degrading means — and the receipt reports the
    // strength it actually got rather than the one it asked for.
    expect(degraded.verification.status).toBe('agreed')
    expect(agreeingIds(degraded)).toHaveLength(2)
    const degradedAttestation = degraded.attestation
    if ('kind' in degradedAttestation) {
      throw new Error(`expected a receipt, got the named absence: ${degradedAttestation.reason}`)
    }
    expect(degradedAttestation.replicas).toBe(2)
    // **And the receipt honestly reads `independent` on a shard that is `degraded`.** Two
    // separate operators did agree, which is exactly what that label claims; what this
    // fabric lacks is *path* independence, and `degraded` plus the composer's reason are
    // what carry that. `ShardResult.degraded`'s doc says the two are different tests and
    // that neither can be inferred from the other — asserted here rather than assumed,
    // because the pairing looks like a contradiction until it is read.
    expect(new Set(degradedAttestation.operators).size).toBe(2)
    expect(degradedAttestation.strength).toBe('independent')
    // The receipt also names the shared relay itself, so a reader holding only the receipt
    // can see the dependency the composer refused on.
    expect(degradedAttestation.sharedRelay).toBe(relay.peerId)
    expect(degradeRun.ok && degradeRun.job.complete).toBe(false)

    // ---- B-refuse: the strict arm, over the SAME live nodes. -----------------------
    const refuseRun = await submitOver('refuses-the-shard')
    const refused = shardOf(refuseRun)

    expect(refused.verification.status).toBe('insufficient')
    if (refused.verification.status !== 'insufficient') return
    expect(refused.verification.reason).toBe(degraded.quorum.reason)
    expect(refused.verification.reason).toContain(relay.peerId)
    expect(refused.quorum).toStrictEqual(degraded.quorum)
    expect(refuseRun.ok && refuseRun.job.complete).toBe(false)
  }, PROCESS_TEST_TIMEOUT)
})
