import { spawn } from 'node:child_process'
import type { ChildProcessByStdio } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Readable, Writable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { ed25519 } from '@noble/curves/ed25519.js'
import {
  DEFAULT_FANOUT,
  EnrollmentAuthority,
  canonicalCid,
  deriveReduceTree,
  executeReduce,
  requestEnrollment,
  signResult,
  signName,
  submitJob,
  toHex,
  verifyCombineAttestation,
  verifyResultAttestation,
} from '@o2/core'
import type {
  CanonicalValue,
  NameRecord,
  NodeCertificate,
  PublicKeyHex,
  ReduceContribution,
  ResultSigner,
  ResultWork,
} from '@o2/core'
import { SEED_BYTES, peerIdForNodeKey } from '@o2/libp2p'
import { discoverCandidates, remoteCombineDispatch, rpcAdmission } from '@o2/net'
import { CID } from 'multiformats/cid'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
// Test-only relative import — see the note in packages/net/src/distributed.test.ts.
import { MODULE_WRITES_PARTITION } from '../../core/src/executor/fixtures.ts'
import { FabricNode } from './fabric-node.ts'
import { FsBlockstore } from './fs-blockstore.ts'

/**
 * VER-08 / VER-09 / VER-10 — the third signing leg, measured where it means something.
 *
 * Plan 19-13 built the signature, 19-14 carried it to a reader, and 19-15 composed it at
 * both production factories. This file is the reading that the composition reached a
 * **running process** rather than only a source file, and that what it produces is worth
 * what the requirement claims.
 *
 * ## What is being measured, stated first because it is the easy thing to fake
 *
 * **The verification is done by a stranger.** Every `verifyResultAttestation` call below
 * is given a `trustedIssuers` set holding exactly one key — the provider's **published**
 * public key, taken off that provider process's own handshake line — plus the work this
 * requestor asked for and the output it was told. **No descriptor, no peer id, no
 * connection, nothing lifted out of the attestation being checked, and nothing taken from
 * the submitter's own node.** A spec that reached for a handy local value — most
 * temptingly the `issuer` named *inside* the certificate under test — would pass every
 * run and prove nothing, because a self-issued certificate satisfies it.
 *
 * That variant was written and run deliberately during this plan; the summary records
 * that it passed, which is the point of having tried it. Phase 18's entire finding was
 * checks that could not fail, and the only defence anyone has found is to run the version
 * that cannot fail and notice.
 *
 * **And the provider is dead before any of it.** Its process is stopped and waited for
 * once the two agents hold their certificates, so a verdict reached afterwards
 * demonstrably contacted nobody — `certificate-verification.node.test.ts`'s technique,
 * applied one leg over. Offline is falsified here rather than argued.
 *
 * ## The entry-point substitution, recorded rather than discovered at verification
 *
 * `bin/agent.ts` never submits a job — it is a serving node whose only stdout is a
 * handshake line. *"A job run through `bin/agent.ts`"* is satisfiable only as **"a job run
 * ACROSS `bin/agent.ts` processes"**, which is the shape `discovery-agents.node.test.ts`
 * uses for criteria 1 and 2 and the shape this file uses. The substitution is the same one
 * Phase 18 recorded in the ROADMAP rather than meeting at the end.
 *
 * ## What this establishes that `certificate-verification.node.test.ts` does not
 *
 * That file proves a **certificate** verifies offline against a pinned issuer. This one
 * proves the **result** does: the thing a node computed, checkable by somebody who was
 * present for none of it. The two are different claims and neither substitutes for the
 * other — a fabric can have perfectly verifiable certificates and results attributable to
 * nobody, which is precisely what this repository had until 19-15.
 *
 * ## What it does NOT establish, and somebody will propose otherwise
 *
 * A signature says a **certified node computed this output**. It says nothing whatever
 * about whether the output is **correct**. A signature on a wrong answer is a signed wrong
 * answer, signed exactly as convincingly as a right one; correctness is `executeVerified`'s
 * N-version comparison and nothing here replaces it. This is written down because the
 * proposal arrives phrased as *"results are attributable now, so redundancy 1 is enough"*,
 * and attribution tells you whom to stop trusting **after** you already know the answer
 * was wrong.
 *
 * ## No wall clock anywhere in this file, deliberately
 *
 * Contention on this host has invalidated timing readings twice in this phase. This file's
 * claim is about **what verifies**, not about what it cost. If a cost figure is wanted it
 * is its own measurement on a quiet host and it is not smuggled in here.
 *
 * ## Budget
 *
 * Three child processes and one in-process submitter, against the nine
 * `tree-reduce-agents.node.test.ts` runs and the seven `discovery-agents.node.test.ts`
 * runs. Its spawn helper, its budgets and its pre-seeding are reused rather than
 * reinvented.
 */

const AGENT = fileURLToPath(new URL('./bin/agent.ts', import.meta.url))

/** Announce budget, matching `certificate-verification.node.test.ts`. */
const ANNOUNCE_BUDGET_MS = 60_000
/** Per-`it` budget for the spawned reading. Three spawns, two enrolments, a real job. */
const PROCESS_TEST_TIMEOUT = 300_000
/** How long a peer verdict may take to settle after a dial. */
const VERDICT_DEADLINE_MS = 30_000

/**
 * The build authority every spawned agent pins, so a dispatch is refused for the reason
 * under test rather than for provenance.
 *
 * **Seed 63.** Distinct from every other fixture key in the repository, following the
 * convention `discovery-agents.node.test.ts` records: 51 is `two-process`, 53 is
 * `egress-refusal`, 57 is `certificate-verification`, 58 is `tree-reduce-agents`, 59 is
 * `discovery-agents`, 60–62 are `combine-signature`. Two fixtures sharing a publisher key
 * would couple two files that have nothing to do with each other.
 */
const publisher = (() => {
  const priv = new Uint8Array(SEED_BYTES).fill(63)
  return { priv, pub: toHex(ed25519.getPublicKey(priv)) }
})()

/**
 * A provider **nobody in this file pins** — the exclusion arm's issuer. Seed 64.
 *
 * Its certificates are perfectly well-formed and its signatures are perfectly good. The
 * only thing wrong with them is that this reader never trusted the provider who issued
 * them, which is the distinction the arm exists to read.
 */
const STRANGER_PROVIDER_SEED = new Uint8Array(SEED_BYTES).fill(64)
/** The node the stranger provider certifies. Seed 65. */
const STRANGER_NODE_SEED = new Uint8Array(SEED_BYTES).fill(65)
/** The user seeds the two agents enrol under. Not the subject of anything here. */
const USER_SEEDS = [0xf1, 0xf2] as const

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
  readonly trustAnchors: string[]
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

/** The two shard values. Distinct, so the two shards are genuinely different work. */
const SHARD_VALUES: readonly CanonicalValue[] = [
  { shard: 'result-signature-a' },
  { shard: 'result-signature-b' },
]

beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'o2-result-signature-'))
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

interface Fixture {
  readonly providerKey: PublicKeyHex
  readonly a: Agent
  readonly b: Agent
  readonly requestor: FabricNode
  readonly inputCids: readonly CID[]
  readonly moduleCid: CID
  readonly moduleRecord: NameRecord
}

/**
 * One provider, two agents enrolled under it, one in-process submitter.
 *
 * The provider is **stopped and waited for** before this returns, so nothing measured
 * afterwards could have consulted it. The two agents run under different operator ids, so
 * a two-replica agreement across them is an agreement across two operators.
 */
async function standUp(): Promise<Fixture> {
  const encoded = await Promise.all(SHARD_VALUES.map((value) => canonicalCid(value)))
  const inputCids: CID[] = []
  for (const hashed of encoded) {
    if (!hashed.ok) throw new Error('a fixture shard value is not encodable')
    inputCids.push(hashed.cid)
  }

  // Seeded before the spawn, so each block is resident on the agents rather than fetched
  // from the submitter mid-run — and seeding after the spawn would race the agent's own
  // open of the same directory.
  for (const name of ['a', 'b']) {
    const store = await FsBlockstore.open(join(workdir, name))
    for (const hashed of encoded) if (hashed.ok) await store.put(hashed.bytes)
    await store.put(MODULE_WRITES_PARTITION)
  }

  const provider = await spawnAgent('p', ['--issues-certificates', '--max-issued-per-window', '64'])
  const providerKey = provider.issuerKey
  if (providerKey === null) throw new Error('the provider announced no issuer key')

  const enrol = async (name: string, fill: number): Promise<Agent> =>
    spawnAgent(name, [
      '--provider-addr',
      provider.multiaddrs[0] as string,
      '--user-key',
      await writeUserKey(name, fill),
      '--operator-id',
      `${name}-ops`,
    ])

  const a = await enrol('a', USER_SEEDS[0])
  const b = await enrol('b', USER_SEEDS[1])
  expect(a.certificate?.issuer).toBe(providerKey)
  expect(b.certificate?.issuer).toBe(providerKey)
  // Two operators, asserted rather than assumed: a two-replica agreement across one
  // operator is `owner-domain`, not `independent`, and the receipt reading below would
  // then be measuring something else.
  expect(a.certificate?.operatorId).not.toBe(b.certificate?.operatorId)

  // **The falsification.** The authority is gone before anything is verified, so "the
  // provider was still answering" is not an available explanation for any verdict below.
  await stopAgentNow(provider)
  expect(provider.child.exitCode !== null || provider.child.signalCode !== null).toBe(true)

  const requestor = await FabricNode.start({
    relayAdmission: 'admits-any-peer',
    blockstoreDir: join(workdir, 'requestor'),
    listen: ['/ip4/127.0.0.1/tcp/0'],
    rpcTimeoutMs: 20_000,
    trustAnchors: [publisher.pub],
    trustedIssuers: [providerKey],
  })
  nodes.push(requestor)

  // Outward, one dial per agent — `LIBP2P_INBOUND_CONNECTION_THRESHOLD` is 5 per host, so
  // a fixture must not invert the direction.
  for (const agent of [a, b]) await requestor.dial(agent.multiaddrs[0] as string)

  const moduleCid = await requestor.store.put(MODULE_WRITES_PARTITION)
  for (const hashed of encoded) if (hashed.ok) await requestor.store.put(hashed.bytes)

  return {
    providerKey,
    a,
    b,
    requestor,
    inputCids,
    moduleCid,
    moduleRecord: recordFor('result-signature-writes-partition', moduleCid),
  }
}

describe('VER-08/09/10 — a result signed in one process verifies in another', () => {
  /**
   * One test, because every reading is a precondition for the next: an attestation cannot
   * be shown to exclude anything until it has been shown to verify, and a refusal cannot
   * be shown to name the right thing until there is a real statement to refuse.
   */
  it('carries a real attestation from every replica, verifiable against the provider key alone', async () => {
    const fixture = await standUp()
    const { requestor, a, b, providerKey } = fixture

    // **The pinned set, built from the provider's PUBLISHED key and from nothing else.**
    // Not from `attestation.certificate.issuer`, which is the substitution that would make
    // every case below unfalsifiable — a self-issued certificate satisfies it.
    const pinned: ReadonlySet<PublicKeyHex> = new Set([providerKey])

    await until(
      () => requestor.verifiedPeers.length === 2,
      VERDICT_DEADLINE_MS,
      `two verified peers, saw ${requestor.verifiedPeers.length}`,
    )

    const found = await discoverCandidates(
      { inputCid: fixture.inputCids[0] as CID },
      {
        rpc: requestor.rpc,
        peers: () => requestor.verifiedPeers,
        trustedIssuers: new Set([providerKey]),
        now: () => Date.now(),
        peerIdFor: peerIdForNodeKey,
        dispatch: 'dispatches-unauthenticated' as const,
      },
    )
    expect(found.executors).toHaveLength(2)

    const result = await submitJob(
      {
        moduleCid: fixture.moduleCid,
        moduleRecord: fixture.moduleRecord,
        shards: SHARD_VALUES.map((value) => ({ value, label: 'public' as const })),
        executors: found.executors,
        nodes: found.nodes,
        redundancy: 2,
        onQuorumShortfall: 'runs-at-available-redundancy',
        admit: rpcAdmission(requestor.rpc),
      },
      requestor.store,
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.job.complete).toBe(true)
    expect(result.job.shards).toHaveLength(2)

    // ---- Reading 1: nothing reports the sentinel. -------------------------------
    // **Read first, because it is what proves 19-15's composition reached a running
    // process rather than only a source file.** `trust-anchors.node.test.ts` says the
    // call site is present; this says the wrapper it composes is on the live path.
    const works: ResultWork[] = []
    for (const shard of result.job.shards) {
      expect(shard.verification.status).toBe('agreed')
      if (shard.verification.status !== 'agreed') return
      expect(shard.verification.agreeing).toHaveLength(2)

      // Rebuilt from **this requestor's own** task and from the CID every agreeing
      // replica hashed to. Nothing here is taken from an attestation; a challenge built
      // from the statement it checks would verify against itself every time.
      const work: ResultWork = {
        moduleCid: fixture.moduleCid,
        inputCid: shard.inputCid,
        partitionIndex: shard.partitionIndex,
        outputCid: shard.verification.resultCid,
      }
      works.push(work)

      for (const replica of shard.verification.agreeing) {
        expect(replica.attestation).not.toBe('signed-by-nobody')

        // ---- Reading 2: the stranger's verification. ----------------------------
        const checked = verifyResultAttestation(replica.attestation, work, pinned, Date.now())
        expect(checked.ok).toBe(true)
        if (!checked.ok) throw new Error(`${replica.nodeId} did not verify: ${checked.reason}`)

        // ---- Reading 3: the statement names the node that answered. -------------
        // Without this, two forwarded copies of ONE node's work would satisfy every
        // reading above, and the receipt would report two replicas where one node did
        // the work. The peer id is DERIVED from the certificate's `nodeKey` rather than
        // read off anything the peer said about itself.
        expect(peerIdForNodeKey(checked.certificate.nodeKey)).toBe(replica.nodeId)
        expect(checked.certificate.issuer).toBe(providerKey)
      }

      // The two replicas are two different nodes, which is what a redundancy-2 agreement
      // is supposed to mean and is not implied by either of them verifying.
      const answering = shard.verification.agreeing.map((replica) => replica.nodeId)
      expect(new Set(answering).size).toBe(2)
      expect([...answering].sort()).toStrictEqual([a.peerId, b.peerId].sort())
    }

    // ---- Reading 4: the receipt is a strength, not a named absence. --------------
    // Every receipt in this fabric read `holds-no-verified-attestation` until this plan,
    // because `receiptFor` treats an unsigned replica as unaccounted and one unaccounted
    // replica collapses the whole receipt. This is that inversion, read on the production
    // submit path.
    for (const shard of result.job.shards) {
      expect('kind' in shard.attestation).toBe(false)
      if ('kind' in shard.attestation) continue
      expect(shard.attestation.strength).toBe('independent')
      expect(shard.attestation.replicas).toBe(2)
      expect([...shard.attestation.operators].sort()).toStrictEqual(['a-ops', 'b-ops'])
    }
    expect('kind' in result.job.attestation).toBe(false)

    // ---- Reading 5: the exclusion, and it is what makes this a measurement. ------
    // A statement signed by a node **no trusted provider certified**: a locally generated
    // seed carrying a certificate from a provider this reader never pinned. The signature
    // is perfectly good — it is made with the key its own certificate names — so a
    // verifier reporting `bad-result-signature` here would accuse a peer of forging while
    // the real answer is this reader's own trust configuration. That distinction is the
    // one an operator acts on.
    const work0 = works[0] as ResultWork
    const stranger = strangerSigner()
    const forged = signResult(stranger, work0)
    const refused = verifyResultAttestation(forged, work0, pinned, Date.now())
    expect(refused.ok).toBe(false)
    if (refused.ok) return
    expect(refused.failure.kind).toBe('untrusted-certificate')
    if (refused.failure.kind !== 'untrusted-certificate') return
    expect(refused.failure.failure.kind).toBe('untrusted-issuer')

    // ---- Reading 6: a statement stands for its own work and for nothing else. ----
    // Both attestations came off a real wire from real processes, so this is a reading
    // about what was signed rather than about two objects a test built.
    const shard0 = result.job.shards[0]
    const shard1 = result.job.shards[1]
    if (shard0 === undefined || shard1 === undefined) throw new Error('expected two shards')
    if (shard0.verification.status !== 'agreed') return
    const carried = shard0.verification.agreeing[0]?.attestation
    if (carried === undefined || carried === 'signed-by-nobody') {
      throw new Error('the first shard carried no statement, so the cross arm reads nothing')
    }

    // Against the other shard's whole work — different input, different partition,
    // different output. The signature kind and not the issuer kind: the certificate is
    // good and this provider issued it; the statement simply is not about this work.
    const crossed = verifyResultAttestation(carried, works[1] as ResultWork, pinned, Date.now())
    expect(crossed.ok).toBe(false)
    if (crossed.ok) return
    expect(crossed.failure.kind).toBe('bad-result-signature')

    // And the narrow version, which isolates the **answer** from the work: this shard's
    // own task with only the output swapped for the other shard's. Drop `outputCid` from
    // the challenge and this one verifies — a node could then sign once and have that
    // signature stand for anything it later returned.
    const swappedOutput = verifyResultAttestation(
      carried,
      { ...work0, outputCid: (works[1] as ResultWork).outputCid },
      pinned,
      Date.now(),
    )
    expect(swappedOutput.ok).toBe(false)
    if (swappedOutput.ok) return
    expect(swappedOutput.failure.kind).toBe('bad-result-signature')

    // ---- Reading 7: both verbs, from one identity, in one construction. ----------
    // A node that signed its map results and not the aggregation over them would satisfy
    // the letter of this leg and none of its purpose — `PROJECT.md` states the split as
    // *the owner's contribution is trusted; the aggregation over contributions is
    // verified*. This dispatches a combine to agent A, whose `exec` statements verified
    // above, and requires the aggregation to carry a statement under **the same node
    // key**. One factory, one identity, both verbs.
    const combine = await combineOn(fixture, a)
    expect(combine.attestation).not.toBe('signed-by-nobody')
    if (combine.attestation === 'signed-by-nobody') return
    const merged = verifyCombineAttestation(
      combine.attestation,
      combine.inputCids,
      combine.resultCid,
      pinned,
      Date.now(),
    )
    expect(merged.ok).toBe(true)
    if (!merged.ok) throw new Error(`the combine did not verify: ${merged.reason}`)
    expect(peerIdForNodeKey(merged.certificate.nodeKey)).toBe(a.peerId)
    expect(merged.certificate.nodeKey).toBe(a.nodeKey)

    // Nothing above is explained by a process having died.
    expect(a.child.exitCode).toBeNull()
    expect(b.child.exitCode).toBeNull()
  }, PROCESS_TEST_TIMEOUT)
})

describe('a node nobody enrolled says so, rather than being unable to answer', () => {
  it('reports the named absence from its own executor, and its receipts say why', async () => {
    // The other arm of the unconditional composition. A `FabricNode` started with no
    // enrollment composes the identical wrapper and passes the no-signer literal, so its
    // outcomes carry the named absence rather than an omission.
    //
    // **This assertion passes whether the composition is unconditional or branched on
    // `certificate !== null`**, and that is why the *unconditional* half is asserted
    // textually by `trust-anchors.node.test.ts` instead of here. What this does establish
    // is that a certificate-less node still runs, still answers, and states what it signs
    // — which is the half a branch would also get right and an omission would not.
    const node = await FabricNode.start({
      relayAdmission: 'admits-any-peer',
      blockstoreDir: join(workdir, 'unenrolled'),
      listen: ['/ip4/127.0.0.1/tcp/0'],
      trustAnchors: 'runs-unsigned-artifacts',
    })
    nodes.push(node)
    expect(node.certificate).toBeNull()

    const value = await canonicalCid({ shard: 'result-signature-unenrolled' })
    if (!value.ok) throw new Error('fixture value is not encodable')
    await node.store.put(value.bytes)
    const moduleCid = await node.store.put(MODULE_WRITES_PARTITION)

    // No `moduleRecord`: this node runs unsigned artifacts, so the provenance wrapper is
    // the identity and there is no record for it to check. DET-03 is not this case's
    // subject; what a node with no certificate says about its own output is.
    const outcome = await node.executor.execute({
      moduleCid,
      inputCid: value.cid,
      partitionIndex: 0,
      partitionCount: 1,
      label: 'public',
    })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.attestation).toBe('signed-by-nobody')

    // And a reader is told *why* rather than being handed a bare `false`: an honest peer
    // holding no certificate and a peer whose statement does not check are different
    // events with different answers, and collapsing them would report the first as
    // misconduct. The work is this node's own, recomputed here, so nothing about the
    // refusal turns on the challenge being wrong.
    const produced = await canonicalCid(outcome.output)
    if (!produced.ok) throw new Error('the outcome will not canonicalise')
    const refused = verifyResultAttestation(
      outcome.attestation,
      {
        moduleCid,
        inputCid: value.cid,
        partitionIndex: 0,
        outputCid: produced.cid,
      },
      new Set([publisher.pub]),
      Date.now(),
    )
    expect(refused.ok).toBe(false)
    if (refused.ok) return
    expect(refused.failure.kind).toBe('not-attested')
  }, 60_000)
})

/** A signer certified by a provider this file's readers never pin. */
function strangerSigner(): ResultSigner {
  const issued = new EnrollmentAuthority({
    providerPrivateKey: STRANGER_PROVIDER_SEED,
    maxIssuedPerWindow: 'issues-without-an-aggregate-budget',
    issuance: 'remembers-only-within-this-process',
  }).enrol(
    requestEnrollment(STRANGER_NODE_SEED, new Uint8Array(SEED_BYTES).fill(USER_SEEDS[0]), {
      operatorId: 'stranger-ops',
      discoverability: 'via-relay',
      relayIds: [],
    }),
    Date.now(),
  )
  if (!issued.ok) throw new Error(`the stranger fixture failed to enrol: ${issued.reason}`)
  return { nodeSeed: STRANGER_NODE_SEED, certificate: issued.certificate }
}

/**
 * Run one real combine on a spawned agent and report what it merged, what it produced and
 * what it said about both.
 *
 * A two-leaf tree, so `deriveReduceTree` yields exactly one combine and the reading is
 * about the statement rather than about tree shape — `combine-signature.node.test.ts`
 * measures the multi-level case, and this file's question is only whether the **factory**
 * supplies the same identity to both verbs.
 *
 * The leaves live in the requestor's local tier, so the agent fetches them over the wire
 * from the node that holds them.
 */
async function combineOn(
  fixture: Fixture,
  agent: Agent,
): Promise<{
  readonly attestation: import('@o2/core').AttestedResult
  readonly inputCids: readonly CID[]
  readonly resultCid: CID
}> {
  const contributions: ReduceContribution[] = []
  for (const index of [0, 1]) {
    const hashed = await canonicalCid({ partial: `result-signature-${index}`, rows: index + 1 })
    if (!hashed.ok) throw new Error('a fixture partial will not canonicalise')
    await fixture.requestor.store.put(hashed.bytes)
    contributions.push({ contributorId: `owner-${index}`, cid: hashed.cid })
  }

  const tree = deriveReduceTree(contributions, DEFAULT_FANOUT)
  expect(tree.nodes).toHaveLength(1)
  const only = tree.nodes[0]
  if (only === undefined) throw new Error('expected one combine')

  const outcome = await executeReduce({
    tree,
    executors: [agent.peerId],
    dispatch: remoteCombineDispatch({
      rpc: fixture.requestor.rpc,
      blockstore: fixture.requestor.store,
    }),
  })
  expect(outcome.ok).toBe(true)
  expect(outcome.failed).toEqual([])
  if (outcome.rootCid === null) throw new Error('the combine produced no root')

  const attestation = outcome.attestations.get(only.id)
  if (attestation === undefined) throw new Error('the combine reported no attestation slot')

  // **In merge order, never sorted** — a combine's output depends on input order, so a
  // sorted list would be asking whether a merge that did not happen was signed.
  return {
    attestation,
    inputCids: contributions.map((contribution) => contribution.cid),
    resultCid: CID.parse(outcome.rootCid),
  }
}
