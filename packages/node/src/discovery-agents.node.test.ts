/**
 * Criterion 1 and criterion 2 of Phase 18, across real `bin/agent.ts` processes.
 *
 * ## What criterion 1 actually claims
 *
 * Candidates are found *"by querying real content-CID providers intersected with
 * capability records — not a hardcoded list"*. **What is removed is the executor list,
 * not the need to know an address to dial.** The requestor here still dials five agents
 * by multiaddr; what it does not do is name which of them may run its work. Two of the
 * five turn out not to qualify, and they are in the fixture precisely so that difference
 * is visible: five dialled, three returned.
 *
 * ## The reach is directly-connected peers only
 *
 * `RpcRecordIndex` asks the peers it is handed and nothing further. There is no
 * transitive routing and no DHT in this repository. A node this requestor never dialled
 * is invisible to it however many blocks it holds. That is the fabric's existing shape
 * and it is the honest limit of what this file proves — a wider claim needs a component
 * that does not exist yet.
 *
 * ## Why the fixture pre-seeds blocks
 *
 * Discovery answers "who holds this block", so somebody has to hold it before the
 * question is asked. Each agent's `--dir` is written through `FsBlockstore` **before**
 * the process is spawned, which is also how `certificate-verification.node.test.ts`
 * puts a block on exactly one node. Seeding after the spawn would race the agent's own
 * open of the same directory.
 *
 * The block seeded is the canonical encoding of the shard value the job later submits,
 * so the block discovery searches for and the block the task reads are the same block
 * rather than two that merely travel together.
 *
 * ## What is measured about the verified set, and what is still not
 *
 * The requestor asks `() => requestor.verifiedPeers`, so a peer whose certificate it
 * cannot verify is never asked for a provider list at all. Phase 17 recorded dispatch
 * candidate selection as **unmeasured** because there was no production caller to gate;
 * there is one now, and the `verifiedPeers` thunk below is it.
 *
 * **Quorum membership and relay use remain unmeasured.** Neither is gated on the
 * verified set, and nothing in this file reads them.
 *
 * ## Budget
 *
 * Seven child processes plus one in-process node. `tree-reduce-agents.node.test.ts`
 * runs nine, so this is inside the established budget for this repository; its timeouts
 * are reused rather than re-invented.
 */
import { spawn } from 'node:child_process'
import type { ChildProcessByStdio } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Readable, Writable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { ed25519 } from '@noble/curves/ed25519.js'
import { DEFAULT_D, canonicalCid, sampleCandidates, signName, submitJob, toHex } from '@o2/core'
import type { Admission, CanonicalValue, NameRecord, NodeCertificate, Offer } from '@o2/core'
import { SEED_BYTES, peerIdForNodeKey } from '@o2/libp2p'
import { RemoteExecutor, discoverCandidates, encodeRequest, parseResponse, rpcAdmission } from '@o2/net'
import type { CID } from 'multiformats/cid'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
// Test-only relative import — see the note in packages/net/src/distributed.test.ts.
import { MODULE_NEVER_RETURNS, MODULE_WRITES_PARTITION } from '../../core/src/executor/fixtures.ts'
import { FabricNode } from './fabric-node.ts'
import { FsBlockstore } from './fs-blockstore.ts'

const AGENT = fileURLToPath(new URL('./bin/agent.ts', import.meta.url))

/** Announce budget, matching `certificate-verification.node.test.ts`. */
const ANNOUNCE_BUDGET_MS = 60_000
/** Per-`it` budget. Seven spawns, two enrolments each with a dial, and a real job. */
const PROCESS_TEST_TIMEOUT = 300_000
/** How long a verdict may take to settle after a dial. */
const VERDICT_DEADLINE_MS = 30_000

/**
 * Seed 59. Distinct from every other fixture key in the repository — 57 is
 * `certificate-verification`, 58 is `tree-reduce-agents`, 51 is `two-process`, 53 is
 * `egress-refusal`. Two fixtures sharing a publisher key would couple two files that
 * have nothing to do with each other.
 */
const publisher = (() => {
  const priv = new Uint8Array(SEED_BYTES).fill(59)
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
    // `'pipe'` on fd 0 is load-bearing, not cosmetic: `bin/agent.ts` arms its orphan
    // leash by watching fd 0, and `'ignore'` hands it a character device, which opts
    // the leash out. `orphan-leash.node.test.ts` fails any spawn site that does that.
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
        // Named fields only — the handshake line has grown twice and reading it
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

/** The one value the job shards over, and the block discovery goes looking for. */
const SHARD_VALUE: CanonicalValue = { shard: 'discovery-agents' }

/**
 * A second shard value, for the exec-stage reading only, and its separateness is
 * load-bearing for the same reason the direct probe's own value is: a node's slot key
 * is `inputCid:partitionIndex` (`net/src/agent.ts:757`), and the task saturating the
 * node carries `SHARD_VALUE` at partition 0. A shard reusing that value would collide
 * with the held task's key and be refused as a DUPLICATE — `… is already in flight
 * here` — which is a different claim from the over-committed one criterion 2b is about.
 *
 * It is seeded onto the holders beside `SHARD_VALUE` so that a re-pick, once one
 * exists, can actually run rather than failing to fetch its input and producing an
 * `insufficient` that looks like the absence being measured here.
 */
const EXEC_STAGE_VALUE: CanonicalValue = { shard: 'discovery-agents-exec-stage' }

interface Fixture {
  readonly p: Agent
  readonly p2: Agent
  readonly holders: readonly [Agent, Agent, Agent]
  readonly empty: Agent
  readonly foreign: Agent
  readonly requestor: FabricNode
  readonly inputCid: CID
  readonly moduleCid: CID
  readonly moduleRecord: NameRecord
}

/**
 * Seven processes and one in-process requestor.
 *
 * - **P**, **P2** — two providers. They exist only to sign; the requestor never dials
 *   either.
 * - **A, B, C** — enrolled under P, each holding the input block and the module block.
 * - **D** — enrolled under P, holding nothing.
 * - **E** — enrolled under P2, holding both blocks.
 *
 * The requestor pins **P only** and holds no certificate of its own.
 */
async function standUp(holderArgs: readonly string[] = []): Promise<Fixture> {
  const encoded = await canonicalCid(SHARD_VALUE)
  if (!encoded.ok) throw new Error('fixture value is not encodable')
  const execStage = await canonicalCid(EXEC_STAGE_VALUE)
  if (!execStage.ok) throw new Error('exec-stage value is not encodable')

  // Seeded before the spawn, so each block is resident on exactly the nodes named.
  // `MODULE_NEVER_RETURNS` goes to the three holders because which of them will be
  // saturated is not known until their peer ids are — see the second block below.
  //
  // `EXEC_STAGE_VALUE` rides along for the same reason and changes nothing about
  // discovery: every reading below asks who holds `SHARD_VALUE`'s CID, and holding a
  // second unrelated block makes a node no more and no less a provider of the first.
  for (const name of ['a', 'b', 'c', 'e']) {
    const store = await FsBlockstore.open(join(workdir, name))
    await store.put(encoded.bytes)
    await store.put(execStage.bytes)
    await store.put(MODULE_WRITES_PARTITION)
    await store.put(MODULE_NEVER_RETURNS)
  }

  const [p, p2] = await Promise.all([
    spawnAgent('p', ['--issues-certificates']),
    spawnAgent('p2', ['--issues-certificates']),
  ])
  if (p.issuerKey === null || p2.issuerKey === null) throw new Error('a provider announced no issuer key')
  expect(p.issuerKey).not.toBe(p2.issuerKey)

  const enrol = async (name: string, fill: number, under: Agent, extra: readonly string[] = []) =>
    spawnAgent(name, [
      '--provider-addr',
      under.multiaddrs[0] as string,
      '--user-key',
      await writeUserKey(name, fill),
      '--operator-id',
      `${name}-ops`,
      ...extra,
    ])

  const a = await enrol('a', 0x91, p, holderArgs)
  const b = await enrol('b', 0x92, p, holderArgs)
  const c = await enrol('c', 0x93, p, holderArgs)
  const d = await enrol('d', 0x94, p)
  const e = await enrol('e', 0x95, p2)

  expect(a.certificate?.issuer).toBe(p.issuerKey)
  expect(e.certificate?.issuer).toBe(p2.issuerKey)

  const requestor = await FabricNode.start({
    blockstoreDir: join(workdir, 'requestor'),
    listen: ['/ip4/127.0.0.1/tcp/0'],
    rpcTimeoutMs: 20_000,
    trustAnchors: [publisher.pub],
    // P only. E is enrolled under P2 and is the node that makes the two gates
    // separable — see the readings in the first test.
    trustedIssuers: [p.issuerKey],
  })
  nodes.push(requestor)

  // Outward, one dial per agent. `LIBP2P_INBOUND_CONNECTION_THRESHOLD` is 5 per host,
  // so a fixture this size must not invert the direction.
  for (const agent of [a, b, c, d, e]) await requestor.dial(agent.multiaddrs[0] as string)

  const moduleCid = await requestor.store.put(MODULE_WRITES_PARTITION)
  await requestor.store.put(encoded.bytes)

  return {
    p,
    p2,
    holders: [a, b, c],
    empty: d,
    foreign: e,
    requestor,
    inputCid: encoded.cid,
    moduleCid,
    moduleRecord: recordFor('discovery-agents-writes-partition', moduleCid),
  }
}

/** Everything `discoverCandidates` needs except which peer thunk to ask. */
function candidateOptions(fixture: Fixture, peers: () => readonly string[]) {
  return {
    rpc: fixture.requestor.rpc,
    peers,
    trustedIssuers: new Set([fixture.p.issuerKey as string]),
    now: () => Date.now(),
    peerIdFor: peerIdForNodeKey,
    dispatch: 'dispatches-unauthenticated' as const,
  }
}

beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'o2-discovery-'))
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

describe('criterion 1 — a job placed from a CID, with no executor list', () => {
  it('finds the holders, excludes the foreign enrolment by name, and never sees the empty node', async () => {
    const fixture = await standUp()
    const { holders, empty, foreign, requestor } = fixture
    const [a, b, c] = holders

    // The peer gate settles asynchronously after each dial. Four of the five verify:
    // A, B, C and D are enrolled under P, which the requestor pinned. E is not.
    await until(
      () => requestor.verifiedPeers.length === 4,
      VERDICT_DEADLINE_MS,
      `four verified peers, saw ${requestor.verifiedPeers.length}`,
    )

    // E carries the difference between the two gates, and it is asserted rather than
    // described: the requestor dialled E, so E is connected; E's certificate is signed
    // by P2, which the requestor did not pin, so E is not verified.
    expect(requestor.transport.peers).toContain(foreign.peerId)
    expect(requestor.verifiedPeers).not.toContain(foreign.peerId)

    // ---- Reading 1: over the CONNECTED set. -------------------------------------
    // E is asked, answers `providers` truthfully for itself, and is then excluded by
    // `discoverExecutors` on its certificate. This is the reading that exercises the
    // intersection: four providers, three executors, one named exclusion.
    const overConnected = await discoverCandidates(
      { inputCid: fixture.inputCid },
      candidateOptions(fixture, () => requestor.transport.peers),
    )

    expect(overConnected.providers).toBe(4)
    expect(overConnected.executors.map((e) => e.nodeId).sort()).toStrictEqual(
      [a.peerId, b.peerId, c.peerId].sort(),
    )
    expect(overConnected.excluded.map((x) => x.reason.kind)).toStrictEqual(['invalid-certificate'])
    expect(overConnected.excluded[0]?.reason.nodeKey).toBe(foreign.nodeKey)

    // D is in NEITHER list, and both halves are asserted because "not in executors" is
    // also true of E. D does not provide the block, so it is not a provider, so there
    // is nothing about it to exclude.
    expect(overConnected.executors.some((e) => e.nodeId === empty.peerId)).toBe(false)
    expect(overConnected.excluded.some((x) => x.reason.nodeKey === empty.nodeKey)).toBe(false)

    // ---- Reading 2: over the VERIFIED set. --------------------------------------
    // E is never asked at all, because Phase 17's peer gate already dropped it. The
    // pair of readings is the point: the peer gate decided WHO TO ASK, and
    // `discoverExecutors` decided WHO QUALIFIED. E failed the second even where it
    // survived being named by the first — and over this thunk it never reaches the
    // second at all, which is why `excluded` is empty rather than holding E again.
    //
    // A file that used only this thunk would find `invalid-certificate` UNREACHABLE in
    // this fixture and would report an intersection it never exercised.
    const overVerified = await discoverCandidates(
      { inputCid: fixture.inputCid },
      candidateOptions(fixture, () => requestor.verifiedPeers),
    )

    expect(overVerified.providers).toBe(3)
    expect(overVerified.excluded).toStrictEqual([])
    expect(overVerified.executors.map((e) => e.nodeId).sort()).toStrictEqual(
      [a.peerId, b.peerId, c.peerId].sort(),
    )

    // ---- The job completes on what discovery found, and only on that. ------------
    const result = await submitJob(
      {
        moduleCid: fixture.moduleCid,
        moduleRecord: fixture.moduleRecord,
        shards: [{ value: SHARD_VALUE, label: 'public' }],
        executors: overVerified.executors,
        nodes: overVerified.nodes,
        redundancy: 1,
        admit: rpcAdmission(requestor.rpc),
      },
      requestor.store,
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.job.complete).toBe(true)

    // Every node dispatched to came out of `found.executors` rather than any list this
    // file wrote. `discovered` is derived from the discovery result, not restated.
    const discovered = new Set(overVerified.executors.map((e) => e.nodeId))
    for (const shard of result.job.shards) {
      expect(shard.verification.status).toBe('agreed')
      if (shard.verification.status !== 'agreed') continue
      expect(shard.verification.agreeing.length).toBeGreaterThan(0)
      for (const nodeId of shard.verification.agreeing) {
        expect(discovered.has(nodeId)).toBe(true)
      }
    }
  }, PROCESS_TEST_TIMEOUT)
})

describe('criterion 2 — sample, refuse, re-pick, complete', () => {
  it('re-picks past a node genuinely at its slot limit, on the production submit path', async () => {
    // One slot each, so a single held task saturates.
    const fixture = await standUp(['--max-concurrent-tasks', '1'])
    const { holders, requestor } = fixture

    await until(
      () => requestor.verifiedPeers.length === 4,
      VERDICT_DEADLINE_MS,
      `four verified peers, saw ${requestor.verifiedPeers.length}`,
    )

    const found = await discoverCandidates(
      { inputCid: fixture.inputCid },
      candidateOptions(fixture, () => requestor.verifiedPeers),
    )
    expect(found.executors).toHaveLength(3)

    // Which node is probed first for shard "0" is derivable, not lucky. Discovery sets
    // `load: 0` on every descriptor it returns — it learns nothing about load, and says
    // so — and `sampleCandidates` takes the top `d` by rendezvous rank on the shard id
    // before `leastLoaded` breaks the all-zero tie by ascending node id. So the first
    // probe is the lexicographically smaller of the two highest-ranked candidates.
    // Derived here from the library's own functions rather than recomputed by hand: a
    // hand-rolled copy of the rule would agree with itself even after the rule changed.
    const sample = sampleCandidates('0', found.nodes, DEFAULT_D)
    const busyId = [...sample].sort((x, y) => x.load - y.load || x.nodeId.localeCompare(y.nodeId))[0]
      ?.nodeId
    const busy = holders.find((h) => h.peerId === busyId)
    if (busy === undefined) throw new Error(`first-probed node ${String(busyId)} is not one of the holders`)

    // ---- Saturation, declared rather than raced. --------------------------------
    // `admission.node.test.ts` reaches into `busy.admission.offer(...)` on an
    // IN-PROCESS node. No test can do that to a spawned one, so the slot here is
    // occupied by a real long-running `exec` this file dispatches and does not await:
    // `MODULE_NEVER_RETURNS` loops until the node's own task deadline kills it. The
    // reading is therefore of a node genuinely at its limit, with the refusal composed
    // by the node and carried over a real wire.
    //
    // The other technique — a module whose runtime the test ends explicitly — was not
    // used because `bin/agent.ts` exposes no deadline flag, so the release point would
    // have to be a second RPC, and a node that is only *sometimes* saturated is exactly
    // what this arrangement exists to avoid.
    const neverCid = await requestor.store.put(MODULE_NEVER_RETURNS)
    const held = new RemoteExecutor(busy.peerId, requestor.rpc, 'dispatches-unauthenticated').execute({
      moduleCid: neverCid,
      inputCid: fixture.inputCid,
      partitionIndex: 0,
      partitionCount: 1,
      label: 'public',
      moduleRecord: recordFor('discovery-agents-never-returns', neverCid),
    })
    // Nothing above awaits `held`; an unhandled rejection would fail the run, so the
    // outcome is collected and read at the end of the test.
    const heldOutcome = held.catch((cause: unknown) => ({ ok: false as const, reason: String(cause) }))

    // ---- The precondition, read before the placement. ---------------------------
    // Without this, a placement that avoided the busy node would prove nothing — it
    // might simply never have sampled it.
    const saturated = await untilFull(requestor, busy.peerId)
    expect(saturated.accepted).toBe(false)
    expect(saturated.capacity).toStrictEqual({ slots: 1, inFlight: 1 })

    // ---- Placement over the production submit path. -----------------------------
    const result = await submitJob(
      {
        moduleCid: fixture.moduleCid,
        moduleRecord: fixture.moduleRecord,
        shards: [{ value: SHARD_VALUE, label: 'public' }],
        executors: found.executors,
        nodes: found.nodes,
        redundancy: 1,
        admit: rpcAdmission(requestor.rpc),
      },
      requestor.store,
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const shard = result.job.shards[0]
    if (shard === undefined) throw new Error('expected one shard')

    // The refusal is the node's own words, composed in exactly one place
    // (`LocalCapacity.#decide`) and travelled a real wire to get here.
    expect(shard.rejections.map((r) => r.nodeId)).toStrictEqual([busy.peerId])
    expect(shard.rejections[0]?.reason).toContain('over-committed: 1 of 1 slots in use')

    // The requestor re-picked and the job completed on a node that did not refuse.
    expect(shard.verification.status).toBe('agreed')
    expect(result.job.complete).toBe(true)
    if (shard.verification.status !== 'agreed') return
    expect(shard.verification.agreeing).not.toContain(busy.peerId)

    // ---- The precondition still held WHILE the placement ran. -------------------
    // Read after rather than assumed. `MODULE_NEVER_RETURNS` is ended by the node's own
    // task deadline, so a placement slower than that deadline would have found the busy
    // node free and this whole block would have measured nothing — the failure mode the
    // seed's orphan-leash test shipped with for a day. This turns it into a loud
    // failure instead of a silent pass.
    const stillBusy = await askOffer(requestor, busy.peerId, 'post-placement')
    expect(stillBusy.accepted).toBe(false)
    expect(stillBusy.capacity).toStrictEqual({ slots: 1, inFlight: 1 })

    // ---- Which refusal a saturated node gives, read directly. -------------------
    // Criterion 2b's second clause — *"a node at its execution slot limit refuses an
    // `exec` request … and the requestor re-picks"*. The offer re-pick above and the
    // exec re-pick are DIFFERENT EVENTS. `job/submit.ts` calls `executeVerified`
    // exactly once per shard: no retry, no resample.
    //
    // This dispatch settles the refusal's IDENTITY and nothing more. It is a bare
    // `RemoteExecutor.execute()` **outside** `submitJob`, so a retry added inside
    // `submitJob`/`runResilient` could never reach it and it can never go red — the
    // absence is therefore read one level up, in the block after this one.
    //
    // **The probe carries its own input block, and that is load-bearing.** A node's
    // slot key is derived from `inputCid:partitionIndex` and does NOT include the
    // module, so a probe reusing this fixture's input would collide with the held
    // task's key and meet the DEDUPE branch — `… is already in flight here` — instead
    // of the over-committed one. Measured: that is exactly what the first run of this
    // file did. The two refusals are different claims and only the second is the one
    // criterion 2b is about; `admission.node.test.ts:296-303` chooses its own key for
    // the same reason from the opposite direction.
    const probeValue = await canonicalCid({ shard: 'direct-exec-probe' })
    if (!probeValue.ok) throw new Error('probe value is not encodable')
    await requestor.store.put(probeValue.bytes)

    const direct = await new RemoteExecutor(
      busy.peerId,
      requestor.rpc,
      'dispatches-unauthenticated',
    ).execute({
      moduleCid: fixture.moduleCid,
      inputCid: probeValue.cid,
      partitionIndex: 0,
      partitionCount: 1,
      label: 'public',
      moduleRecord: fixture.moduleRecord,
    })
    expect(direct.ok).toBe(false)
    if (!direct.ok) expect(direct.reason).toContain('over-committed')

    // ---- The absence itself, on the production submit path. ---------------------
    // The reading that used to sit here was `expect(shard.verification.agreeing)
    // .toHaveLength(1)`, and it could not fail. `agreeing` is a subset of the
    // executors `submitJob` selected, which is `placement.nodeIds`, whose length IS
    // `redundancy` — 1 in this fixture. So the value was confined to `{0,1}`, and the
    // `agreed` narrowing above it excluded 0. No implementation of a re-pick could
    // have moved it. It is removed rather than kept beside the reading below: a green
    // assertion that looks like a guard and is not is worse than no assertion,
    // because the next reader stops looking.
    //
    // What can fail is a job whose SELECTED executor refuses at exec. The node
    // answers the offer while it is free, is saturated between that answer and the
    // dispatch, and then refuses the dispatch. That race is not contrived — it is the
    // one the two clauses of criterion 2b are actually about, and the offer branch
    // makes it inevitable on purpose: answering an offer reserves nothing
    // (`LocalCapacity.would` is the non-reserving twin of `offer`, and its doc gives
    // the leak that forced the split), so an accepted offer is a statement about the
    // past by the time the exec arrives.
    //
    // `shard.rejections` cannot carry this refusal. `submit.ts:341` fills it from
    // `planWithOffers`' PLACEMENT-stage refusals only, so an exec-stage refusal is
    // structurally invisible there; the reading goes through `verification.failures`,
    // which is not bounded by the placement and is where a refused executor lands.
    //
    // **This is the assertion that inverts the day WIRE-04 lands.** The shard is
    // `insufficient` *because nothing retries it* — given a re-pick it would reach a
    // second executor, which is free, and stop being `insufficient`. That inversion
    // was measured rather than asserted: a re-pick planted in `submitJob` for the
    // length of one run turned this red. **WIRE-04 / Phase 20 criterion 1 owns the
    // merge that would add it**, and this is the correct moment for the clause to be
    // revisited rather than a sentence in a summary nobody re-reads.
    const ask = rpcAdmission(requestor.rpc)
    const victims: string[] = []
    const heldOnVictim: Promise<unknown>[] = []
    const admitThenSaturate = async (offer: Offer): Promise<Admission> => {
      const decision = await ask(offer)
      // The first node to accept is the node the placement will choose, because
      // `placeWithOffers` stops at `redundancy` acceptances and redundancy is 1.
      if (!decision.accepted || victims.length > 0) return decision
      victims.push(offer.nodeId)
      // Keyed on `SHARD_VALUE` at partition 0, which is a DIFFERENT slot key from the
      // shard about to be dispatched — see `EXEC_STAGE_VALUE`'s doc. Same technique as
      // the held task above: a real long-running `exec` this file does not await.
      const occupy = new RemoteExecutor(
        offer.nodeId,
        requestor.rpc,
        'dispatches-unauthenticated',
      ).execute({
        moduleCid: neverCid,
        inputCid: fixture.inputCid,
        partitionIndex: 0,
        partitionCount: 1,
        label: 'public',
        moduleRecord: recordFor('discovery-agents-never-returns', neverCid),
      })
      heldOnVictim.push(occupy.catch((cause: unknown) => ({ ok: false as const, reason: String(cause) })))
      // Returns only once the node says so itself, so the dispatch that follows meets
      // a node genuinely at its limit rather than one that is about to be.
      const full = await untilFull(requestor, offer.nodeId)
      expect(full.accepted).toBe(false)
      return decision
    }

    const stalled = await submitJob(
      {
        moduleCid: fixture.moduleCid,
        moduleRecord: fixture.moduleRecord,
        shards: [{ value: EXEC_STAGE_VALUE, label: 'public' }],
        executors: found.executors,
        nodes: found.nodes,
        redundancy: 1,
        admit: admitThenSaturate,
      },
      requestor.store,
    )

    expect(stalled.ok).toBe(true)
    if (!stalled.ok) return
    const stalledShard = stalled.job.shards[0]
    if (stalledShard === undefined) throw new Error('expected one shard')
    const victim = victims[0]
    if (victim === undefined) throw new Error('no node accepted the offer, so none was saturated')

    // Not vacuous in the other direction: a shard that was never placed on the
    // saturated node would also be `insufficient`, for an unrelated reason. Naming the
    // node in the failure is what separates the two.
    expect(stalledShard.verification.status).toBe('insufficient')
    if (stalledShard.verification.status !== 'insufficient') return
    expect(stalledShard.verification.failures.map((f) => f.nodeId)).toStrictEqual([victim])
    expect(stalledShard.verification.failures.some((f) => f.reason.includes('over-committed'))).toBe(
      true,
    )
    expect(stalled.job.complete).toBe(false)

    // And the victim appears in NO placement-stage rejection: it accepted the offer.
    // Its refusal exists only in `failures`, which is the whole reason that field is
    // the one this reading goes through.
    expect(stalledShard.rejections.map((r) => r.nodeId)).not.toContain(victim)

    await Promise.all([heldOutcome, ...heldOnVictim])
  }, PROCESS_TEST_TIMEOUT)
})

/**
 * Poll a node's own offer answer until it reports itself full.
 *
 * The held task has to travel a wire, be admitted, have its module fetched and reach
 * the executor before the slot is occupied, so the saturation is not instantaneous.
 * Polling the node's own answer is what makes the wait a reading rather than a sleep.
 */
async function untilFull(
  requestor: FabricNode,
  nodeId: string,
): Promise<{ accepted: boolean; capacity: unknown; reason?: string }> {
  const deadline = Date.now() + VERDICT_DEADLINE_MS
  let last = await askOffer(requestor, nodeId, 'precondition')
  while (Date.now() < deadline) {
    if (!last.accepted) return last
    await new Promise((r) => setTimeout(r, 20))
    last = await askOffer(requestor, nodeId, 'precondition')
  }
  throw new Error(`busy node never reported itself full; last answer was ${JSON.stringify(last)}`)
}

/** Ask a node directly whether it would take a shard, and read its own answer. */
async function askOffer(
  requestor: FabricNode,
  nodeId: string,
  shardId: string,
): Promise<{ accepted: boolean; capacity: unknown; reason?: string }> {
  const reply = parseResponse(await requestor.rpc.request(nodeId, encodeRequest({ kind: 'offer', shardId })))
  if (reply?.kind !== 'offer') throw new Error(`expected an offer answer, got ${String(reply?.kind)}`)
  return reply
}
