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
 * **Quorum membership is measured one file over.** `quorum-agents.node.test.ts` reads
 * quorum composition over this same fixture shape: spawned `bin/agent.ts` agents,
 * provider-signed certificates, the production submit path. It reads relay use the same way
 * — **since 2026-08-04**, when Plan 19-19 removed `--port`'s default so that an agent given
 * `--relay-addr` and no `--port` binds nothing and enrols `via-relay`. Until then that half
 * ran over in-process `FabricNode`s, because the binary bound a port unconditionally; the
 * sentence that stood here said so, and it is recorded rather than deleted because it was
 * true when written. Neither reading is gated on the verified set, and nothing in *this*
 * file reads either.
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
import {
  DEFAULT_D,
  DEFAULT_MAX_GENERATIONS,
  canonicalCid,
  planPlacement,
  sampleCandidates,
  signName,
  submitJob,
  toHex,
} from '@o2/core'
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

/**
 * The ONE stand-up failure that is re-attempted, matched on its own text.
 *
 * **Copied from `admission-agents.node.test.ts`, which met this on the same message.**
 * `rpc to <peer> timed out after <n>ms` is `RpcFailure`'s own rendering
 * (`packages/net/src/rpc.ts:59`), and the budget it names is `DEFAULT_RPC_TIMEOUT_MS` — the
 * PRODUCT default of 30 000 ms, not a number this file chose. A spawned agent whose
 * enrolment RPC misses it exits 1 before printing a handshake line, and the whole file then
 * fails in the spawn on a fact about how much CPU the machine had.
 *
 * Observed here on 2026-08-26 in a full `--project node` sweep: *"agent e exited early with
 * 1 … enrollment with /ip4/127.0.0.1/… failed (unreachable): provider unreachable … rpc to
 * … timed out after 30000ms"*. The same file passed alone twice immediately after, and the
 * preceding sweep of 207 files was green — so what changed was the load, not the path.
 *
 * **Keyed on the message, not on a count and not on a timer.** Any other exit — a refusal, a
 * bad flag, a crash — is re-thrown untouched on the first attempt. That is the difference
 * between re-attempting a known host condition and retrying until green.
 */
const RPC_TIMED_OUT = /timed out after \d+ms/

/**
 * Stand an agent up, re-attempting exactly once and only on {@link RPC_TIMED_OUT}.
 *
 * **Why a re-attempt rather than a bigger budget.** The budget belongs to the child and is
 * the product's own default; raising it from here would change what the shipped binary does
 * in a test's favour. And per `CLAUDE.md` § Measurement, a wall-clock bound over a process
 * that is *waiting* measures the host and never the code, so widening it buys a later cliff
 * and nothing else.
 *
 * **Why not silent.** One re-attempt hides a host hiccup, which is the intent, and would
 * equally hide an enrolment path that fails half the time, which is not. So every
 * re-attempt writes to stdout and a run that needed one says so.
 *
 * **What it cannot do.** A second failure is thrown, so an enrolment that is genuinely
 * broken still fails this file on the same message it always did.
 */
async function spawnAgent(name: string, extraArgs: readonly string[] = []): Promise<Agent> {
  try {
    return await spawnAgentOnce(name, extraArgs)
  } catch (cause) {
    const text = cause instanceof Error ? cause.message : String(cause)
    if (!RPC_TIMED_OUT.test(text)) throw cause
    process.stdout.write(
      `[fixture / re-attempt] agent ${name} exited before announcing because an RPC missed ` +
        `the child's own DEFAULT_RPC_TIMEOUT_MS budget, which on this host is a statement ` +
        `about contention rather than about discovery. Standing it up once more; a second ` +
        `failure is thrown. Original: ${text.slice(0, 400)}\n`,
    )
    return await spawnAgentOnce(name, extraArgs)
  }
}

async function spawnAgentOnce(name: string, extraArgs: readonly string[] = []): Promise<Agent> {
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
    spawnAgent('p', ['--issues-certificates', '--max-issued-per-window', '64']),
    spawnAgent('p2', ['--issues-certificates', '--max-issued-per-window', '64']),
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
  // `holderArgs` reaches E as well as A, B and C, because E **is** a holder: it was
  // seeded with both blocks above and the only thing that separates it from the other
  // three is its issuer. The bounded-retry case below needs a fabric of four one-slot
  // executors — strictly more than `DEFAULT_MAX_GENERATIONS`, or the cap it reads is
  // indistinguishable from running out of nodes — and E is the fourth. D is left alone
  // deliberately: it holds nothing, so it is never a provider and never an executor.
  //
  // Inert for every reading above: criterion 1 calls `standUp()` with no arguments, and
  // the case that passes `--max-concurrent-tasks 1` places only on A, B and C.
  const e = await enrol('e', 0x95, p2, holderArgs)

  expect(a.certificate?.issuer).toBe(p.issuerKey)
  expect(e.certificate?.issuer).toBe(p2.issuerKey)

  const requestor = await FabricNode.start({
    relayAdmission: 'admits-any-peer',
    startReporting: 'reports-its-own-start',
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
    index: 'asks-connected-peers-only' as const,
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
        onQuorumShortfall: 'runs-at-available-redundancy',
        admit: rpcAdmission(requestor.rpc),
      },
      requestor.store,
      // CHURN-03 — this test asserts nothing about checkpointing.
      { checkpoints: 'checkpoints-nothing' },
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
      for (const { nodeId } of shard.verification.agreeing) {
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
        onQuorumShortfall: 'runs-at-available-redundancy',
        admit: rpcAdmission(requestor.rpc),
      },
      requestor.store,
      // CHURN-03 — this test asserts nothing about checkpointing.
      { checkpoints: 'checkpoints-nothing' },
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
    expect(shard.verification.agreeing.map((e) => e.nodeId)).not.toContain(busy.peerId)

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
    // exec re-pick are DIFFERENT EVENTS, and the second one now happens: since Phase
    // 20 plan 01 `job/submit.ts` runs a generation loop instead of calling
    // `executeVerified` exactly once per shard, and the block after this one reads it.
    //
    // This dispatch settles the refusal's IDENTITY and nothing more. It is a bare
    // `RemoteExecutor.execute()` **outside** `submitJob`, so the re-pick that now
    // exists inside `submitJob` cannot reach it and it cannot go red on one. That is
    // the reason the behaviour is read one level up, in the block after this, rather
    // than here: this probe answers *which* refusal, never *what was done about it*.
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

    // ---- The exec-stage re-pick itself, on the production submit path. ----------
    // A job whose SELECTED executor refuses at exec. The node answers the offer while
    // it is free, is saturated between that answer and the dispatch, and then refuses
    // the dispatch. That race is not contrived — it is the one the two clauses of
    // criterion 2b are actually about, and the offer branch makes it inevitable on
    // purpose: answering an offer reserves nothing (`LocalCapacity.would` is the
    // non-reserving twin of `offer`, and its doc gives the leak that forced the
    // split), so an accepted offer is a statement about the past by the time the exec
    // arrives.
    //
    // **What this block cannot redden on: the offer-stage re-pick.** That one is
    // `placeWithOffers`' own, it has existed since 18-06, and the first half of this
    // test measures it — a node that refuses the OFFER is never placed. Two re-picks,
    // two stages, and this block owns the second. A change that broke only the offer
    // stage would redden the assertions above `direct`, not these.
    //
    // **The history, in the one sentence that explains why this is written so
    // carefully.** The clause was carried out of Phase 18 into Phase 20 criterion 1
    // under RULING A because the instrument that was supposed to hold it —
    // `expect(shard.verification.agreeing).toHaveLength(1)` — could not fail:
    // `agreeing` is a subset of the executors `submitJob` selected, which is
    // `placement.nodeIds`, whose length IS `redundancy` (1 here), under an `agreed`
    // narrowing that excluded 0, so it was confined to `{0,1}` at the type level and
    // no implementation of a re-pick could have moved it. What replaced it asserted
    // the shard ended `insufficient` *because nothing retried it*, armed to invert
    // the day WIRE-04 landed. It landed in plan 20-01 and this file went red with
    // `expected 'agreed' to be 'insufficient'` — the scheduled clause arriving, not a
    // regression. Below is that clause as a behaviour rather than as an absence.
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

    const repicked = await submitJob(
      {
        moduleCid: fixture.moduleCid,
        moduleRecord: fixture.moduleRecord,
        shards: [{ value: EXEC_STAGE_VALUE, label: 'public' }],
        executors: found.executors,
        nodes: found.nodes,
        redundancy: 1,
        onQuorumShortfall: 'runs-at-available-redundancy',
        admit: admitThenSaturate,
      },
      requestor.store,
      // CHURN-03 — this test asserts nothing about checkpointing.
      { checkpoints: 'checkpoints-nothing' },
    )

    expect(repicked.ok).toBe(true)
    if (!repicked.ok) return
    const repickedShard = repicked.job.shards[0]
    if (repickedShard === undefined) throw new Error('expected one shard')
    const victim = victims[0]
    if (victim === undefined) throw new Error('no node accepted the offer, so none was saturated')

    // ---- Non-vacuity, half one: the node that refused WAS the one chosen. -------
    // `ShardResult.attempted` is the set ASKED, in order, across every generation, so
    // the victim standing first in it says placement chose it and the dispatch
    // reached it. Without this half the reading is satisfiable by a shard that never
    // met the saturated node at all, which would also have completed. And the victim
    // appears in NO placement-stage rejection, because it ACCEPTED its offer — which
    // is the whole reason this reading cannot go through `shard.rejections`.
    expect(repickedShard.attempted[0]).toBe(victim)
    expect(repickedShard.rejections.map((r) => r.nodeId)).not.toContain(victim)

    // ---- Non-vacuity, half two: the node that answered is a DIFFERENT one. ------
    // The shard that used to stall now agrees, and not on the node that refused it.
    expect(repickedShard.verification.status).toBe('agreed')
    expect(repicked.job.complete).toBe(true)
    if (repickedShard.verification.status !== 'agreed') return
    const answered = repickedShard.verification.agreeing.map((e) => e.nodeId)
    expect(answered).not.toContain(victim)
    const answering = answered[0]
    if (answering === undefined) throw new Error('an agreed shard with no agreeing replica')
    // Both halves in one statement: exactly two nodes were asked, the first is the
    // saturated one and the second is the one whose answer this result carries.
    expect(repickedShard.attempted).toStrictEqual([victim, answering])

    // ---- The count, exactly. ----------------------------------------------------
    // `toBeGreaterThan(0)` here would be satisfied by a loop that re-dispatched
    // unconditionally, which is the thing a bounded re-pick is not. One refusal, one
    // re-pick: two generations and one re-dispatch, and `ending` says the loop
    // stopped because the shard agreed rather than because it ran out of anything.
    expect(repickedShard.generations).toBe(2)
    expect(repicked.job.redispatches).toBe(1)
    expect(repickedShard.ending).toBe('agreed')
    // Full redundancy across two generations is not a shortfall — the shard asked for
    // one replica and got one.
    expect(repickedShard.degraded).toBe(false)

    // ---- What survives of the refusal, measured rather than assumed. ------------
    // This plan's clause asks that the re-pick not erase the first executor's named
    // refusal. **It erases half of it, and the half it erases is the over-committed
    // text.** `VerificationResult`'s `agreed` arm carries no `failures` field at all
    // (`core/src/job/verify.ts`, search `status: 'agreed'`), and `mergeVerifications`
    // (`core/src/job/submit.ts`) folds a failed generation into a later agreement by
    // keeping the winner — the failure list has nowhere to go. 20-01 recorded that as
    // a deferral in those words. Asserting a `failures` entry here would be asserting
    // a field the union does not have, so this reading names its new home instead.
    //
    // What survives is the LEASE HISTORY, which is CHURN-01's "visible in the job
    // history rather than hidden" and is the strongest true reading this tree
    // supports today: the victim held generation 1 by name and gave it back, and
    // generation 2 went to a different node and completed. A re-pick that quietly
    // swapped nodes would produce a trail with one `granted` in it.
    const leaseTrail = repicked.job.leaseHistory.map((event) =>
      event.kind === 'abandoned' ? `abandoned:${event.taskId}` : `${event.kind}:${event.nodeId}`,
    )
    expect(leaseTrail).toStrictEqual([
      `granted:${victim}`,
      `surrendered:${victim}`,
      `granted:${answering}`,
      `completed:${answering}`,
    ])

    // ---- What `rejections` carries now, MEASURED rather than assumed. -----------
    // This plan asked the question rather than answering it, so it was measured. The
    // field is still filled from PLACEMENT-stage refusals only — an exec-stage
    // refusal remains structurally invisible here, which is why the victim is absent
    // from it above and why this whole reading goes through `attempted` and the lease
    // history instead. What the generation loop changed is that a SECOND placement
    // now runs and its refusals accumulate into the same list (`core/src/job/
    // submit.ts`, search `collectedRejections`).
    //
    // Measured on this tree: **two entries, both `busy`** — one per placement stage.
    // `busy` was saturated at the top of this test and is still full, and it is
    // offered first for shard "0" in both stages, so it refuses twice. Before the
    // generation loop there was one placement and therefore at most one entry, which
    // is what makes the count itself a reading of the re-placement.
    //
    // Two claims, deliberately separated. The invariant first — every node named here
    // is one the shard never dispatched to, which is what "placement-stage only"
    // means as a property rather than as a sentence. Then the exact list: if this
    // ever reads one entry, the question is whether the second placement still
    // happened, and `generations` above answers it — that is the assertion to consult
    // before touching this one.
    for (const rejection of repickedShard.rejections) {
      expect(repickedShard.attempted).not.toContain(rejection.nodeId)
    }
    expect(repickedShard.rejections.map((r) => r.nodeId)).toStrictEqual([busy.peerId, busy.peerId])
    for (const rejection of repickedShard.rejections) {
      expect(rejection.reason).toContain('over-committed: 1 of 1 slots in use')
    }

    await Promise.all([heldOutcome, ...heldOnVictim])
  }, PROCESS_TEST_TIMEOUT)
})

/**
 * The other half of the re-pick: it is BOUNDED, and a fabric that refuses everywhere
 * still says which nodes refused — CHURN-01, and the cost `DEFAULT_MAX_GENERATIONS`'
 * own docblock argues for.
 *
 * The case above shows a refused shard reaching a second executor. On its own that is
 * half a claim: a re-dispatch that never stops is worse than none, because it spends
 * the fabric on work that will not succeed and reports nothing about why. This reads
 * the stop.
 *
 * **No `JobSpec.admit` here, and that is the choice that makes it an exec-stage
 * reading.** With an admission control supplied, a saturated node refuses the OFFER
 * and is never placed, so the shard comes back unplaceable with placement-stage
 * rejections and an empty failure list — a true statement about a different stage.
 * Without one, `submitJob` places through `planPlacement`, dispatches, and meets the
 * refusal at `exec`, which is where SCHED-06's slot limit actually lives.
 */
describe('criterion 2, bounded — a fabric with no free node, and the control that had one', () => {
  it('stops at the generation cap naming every refusal, beside a control with one node free', async () => {
    const fixture = await standUp(['--max-concurrent-tasks', '1'])
    const { requestor } = fixture

    // The peer gate settles asynchronously after each dial, and waiting for its
    // verdict is what makes the connected set stable to read. Four of the five verify;
    // E is not one of them and is still CONNECTED, which is what this case uses.
    await until(
      () => requestor.verifiedPeers.length === 4,
      VERDICT_DEADLINE_MS,
      `four verified peers, saw ${requestor.verifiedPeers.length}`,
    )

    // ---- A fabric strictly larger than the cap, and that is the whole point. ----
    // With three executors and a `DEFAULT_MAX_GENERATIONS` of three, "stopped at the
    // cap" and "ran out of untried nodes" are the same reading, and every assertion
    // below would pass against a loop that had no cap at all. So this is the one
    // reading in this file that trusts P2: E holds both blocks and differs from A, B
    // and C only in its issuer, and trusting that issuer HERE — in this call's own
    // `trustedIssuers`, never in the requestor's peer gate — is what makes a fourth
    // executor exist. Criterion 1's reading of the issuer gate is a different call
    // with a different set and is untouched by this one.
    const discover = async (): Promise<Awaited<ReturnType<typeof discoverCandidates>>> =>
      discoverCandidates(
        { inputCid: fixture.inputCid },
        {
          rpc: requestor.rpc,
          peers: () => requestor.transport.peers,
          index: 'asks-connected-peers-only',
          trustedIssuers: new Set([fixture.p.issuerKey as string, fixture.p2.issuerKey as string]),
          now: () => Date.now(),
          peerIdFor: peerIdForNodeKey,
          dispatch: 'dispatches-unauthenticated' as const,
        },
      )

    // ---- The roster, BY NAME, because the two short-count causes are opposites ------
    //
    // **Added 2026-08-25.** This read `expect(found.executors).toHaveLength(4)` and was
    // observed failing at *"expected length 4, got 3"*. A count cannot be acted on here,
    // because the two ways to be one short want opposite verdicts:
    //
    // - **E missing** is the ISSUER GATE. E differs from A, B and C in exactly one thing,
    //   its issuer, and this call trusts P2 in its own `trustedIssuers`. E absent means a
    //   node whose issuer was trusted was refused anyway — a real defect, and the one this
    //   whole fixture exists to make visible. It must fail and it must say so.
    // - **A, B or C missing** is the fixture not being ready. The `until` above waits for
    //   the peer GATE to settle; nothing waits for a holder to finish ANNOUNCING itself as
    //   a provider of the input block, which is a separate asynchronous settling. On a
    //   loaded host one holder has not got there yet.
    //
    // **So this waits rather than skips, and that is the better answer of the two.** A
    // skip on a short count would swallow the issuer-gate regression, which was the
    // objection recorded against doing it that way. A bounded wait on the ROSTER is
    // fail-closed instead: a holder that is merely late arrives and the case proceeds
    // unchanged, while E — which is refused rather than late — never arrives, the wait
    // spends its whole budget, and the failure NAMES E. `dht-registration`'s fix has the
    // same shape: a wait whose condition finally says what its message always said.
    // Keyed through `peerIdForNodeKey`, the SAME derivation the discovery call above is
    // handed, so the two sides cannot disagree about what a node is called.
    // `peerIdForNodeKey` is honestly typed `string | null`, so the null is handled rather
    // than asserted away: a fixture agent whose key yields no peer id is a broken fixture
    // and says so here, instead of becoming a silently absent roster entry that would read
    // as the issuer gate refusing it.
    const peerIdOf = (agent: Agent, name: string): string => {
      const peerId = peerIdForNodeKey(agent.nodeKey)
      if (peerId === null) {
        throw new Error(`the fixture's ${name} has a node key no peer id derives from`)
      }
      return peerId
    }
    const roster: readonly (readonly [string, string])[] = [
      ['a (issued by P)', peerIdOf(fixture.holders[0], 'a')],
      ['b (issued by P)', peerIdOf(fixture.holders[1], 'b')],
      ['c (issued by P)', peerIdOf(fixture.holders[2], 'c')],
      ['e (issued by P2 — the issuer gate)', peerIdOf(fixture.foreign, 'e')],
    ]
    const missingFrom = (
      result: Awaited<ReturnType<typeof discoverCandidates>>,
    ): readonly string[] => {
      const qualified = new Set(result.executors.map((executor) => executor.nodeId))
      return roster.filter(([, peerId]) => !qualified.has(peerId)).map(([name]) => name)
    }

    let found = await discover()
    const rosterDeadline = Date.now() + VERDICT_DEADLINE_MS
    while (missingFrom(found).length > 0 && Date.now() < rosterDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 100))
      found = await discover()
    }
    // The exclusions are carried into the message because they are the only place that
    // says WHY a node did not qualify, and the logs truncate the executor array — which
    // is how the first recorded instance of this failure left the cause unrecoverable.
    expect(
      missingFrom(found),
      `after ${VERDICT_DEADLINE_MS}ms of re-querying, the fixture's four executable ` +
        `holders were not all discoverable. A node issued by P that is merely late will ` +
        `have arrived by now; E is issued by P2 and is trusted BY THIS CALL, so E among ` +
        `the missing is the issuer gate refusing a trusted issuer and is a defect rather ` +
        `than a slow host. Providers considered: ${found.providers}. Excluded: ` +
        `${found.excluded.map((exclusion) => exclusion.detail).join(' | ') || '(none)'}`,
    ).toEqual([])
    expect(found.executors).toHaveLength(4)
    // Asserted rather than assumed, because it is the precondition the bound is read
    // against: a fabric no larger than the cap cannot tell the two exits apart.
    expect(found.executors.length).toBeGreaterThan(DEFAULT_MAX_GENERATIONS)

    // Which node the production path places FIRST is derivable, not lucky: with no
    // `admit` supplied `submitJob` places through `planPlacement`, so the same call
    // over the same request and the same descriptors names the same node. Derived from
    // the library's own function rather than recomputed by hand, for the reason the
    // case above gives about `sampleCandidates`.
    const firstPlan = planPlacement([{ shardId: '0', label: 'public', redundancy: 1 }], found.nodes)
    const firstPlaced = firstPlan.placements[0]
    if (firstPlaced?.status !== 'placed') throw new Error('the fixture cannot place its own shard')
    const spare = firstPlaced.nodeIds[0] as string

    const neverCid = await requestor.store.put(MODULE_NEVER_RETURNS)
    const neverRecord = recordFor('discovery-agents-never-returns', neverCid)
    const occupied: Promise<unknown>[] = []
    /**
     * Fill a node's single slot with a real long-running `exec` and return only once
     * the node itself says it is full — `untilFull`, not a sleep, for the reason the
     * case above records: a node that is only *sometimes* saturated measures nothing.
     *
     * Keyed on `SHARD_VALUE` at partition 0, which is a DIFFERENT slot key from the
     * shard submitted below — that one carries `EXEC_STAGE_VALUE`. A same-key
     * occupation would meet the dedupe branch (`… is already in flight here`) instead
     * of the over-committed one, and only the second is SCHED-06's.
     */
    const saturate = async (nodeId: string): Promise<void> => {
      const held = new RemoteExecutor(nodeId, requestor.rpc, 'dispatches-unauthenticated').execute({
        moduleCid: neverCid,
        inputCid: fixture.inputCid,
        partitionIndex: 0,
        partitionCount: 1,
        label: 'public',
        moduleRecord: neverRecord,
      })
      occupied.push(held.catch((cause: unknown) => ({ ok: false as const, reason: String(cause) })))
      const full = await untilFull(requestor, nodeId)
      expect(full.accepted).toBe(false)
      expect(full.capacity).toStrictEqual({ slots: 1, inFlight: 1 })
    }

    const spec = {
      moduleCid: fixture.moduleCid,
      moduleRecord: fixture.moduleRecord,
      shards: [{ value: EXEC_STAGE_VALUE, label: 'public' as const }],
      executors: found.executors,
      nodes: found.nodes,
      redundancy: 1,
      onQuorumShortfall: 'runs-at-available-redundancy' as const,
    }

    // ---- Arm one, the control: every node but the first-placed one is full. -----
    for (const node of found.executors) if (node.nodeId !== spare) await saturate(node.nodeId)

    const control = await submitJob(spec, requestor.store,
      // CHURN-03 — this test asserts nothing about checkpointing.
      { checkpoints: 'checkpoints-nothing' },
    )
    expect(control.ok).toBe(true)
    if (!control.ok) return
    const controlShard = control.job.shards[0]
    if (controlShard === undefined) throw new Error('expected one shard')

    expect(controlShard.verification.status).toBe('agreed')
    expect(control.job.complete).toBe(true)
    expect(controlShard.attempted).toStrictEqual([spare])
    expect(controlShard.generations).toBe(1)
    expect(control.job.redispatches).toBe(0)
    expect(controlShard.ending).toBe('agreed')

    // ---- Arm two: the same submission, with that last node saturated too. -------
    // One fixture, two arms, one node's saturation between them. Two fabrics behaving
    // differently would prove nothing about a bound; this way the only difference
    // between the arms is the thing under test.
    await saturate(spare)

    const everyNodeFull = await submitJob(spec, requestor.store,
      // CHURN-03 — this test asserts nothing about checkpointing.
      { checkpoints: 'checkpoints-nothing' },
    )
    expect(everyNodeFull.ok).toBe(true)
    if (!everyNodeFull.ok) return
    const fullShard = everyNodeFull.job.shards[0]
    if (fullShard === undefined) throw new Error('expected one shard')

    expect(fullShard.verification.status).toBe('insufficient')
    if (fullShard.verification.status !== 'insufficient') return

    // ---- And it says why, PER NODE. ---------------------------------------------
    // Compared element by element against `attempted` rather than counted: a bounded
    // retry that reported only its last attempt would satisfy a length check and would
    // have thrown away the evidence the bound exists to produce. Each node's refusal
    // is its own, in its own words, and they arrive in the order the nodes were tried.
    expect(fullShard.verification.failures.map((f) => f.nodeId)).toStrictEqual(fullShard.attempted)
    for (const failure of fullShard.verification.failures) {
      expect(failure.reason).toContain('over-committed: 1 of 1 slots in use')
    }

    // ---- The bound is READ, not inferred. ---------------------------------------
    // Against the exported constant, never a literal — `submitJob` builds its lease
    // table from that same symbol (`core/src/job/submit.ts`, search `maxGenerations`),
    // so a cap that moved would move both sides of this together and the reading below
    // is what stays true.
    expect(fullShard.attempted).toHaveLength(DEFAULT_MAX_GENERATIONS)
    expect(fullShard.generations).toBe(DEFAULT_MAX_GENERATIONS)
    expect(everyNodeFull.job.redispatches).toBe(DEFAULT_MAX_GENERATIONS - 1)
    // Which exit the loop took, named rather than inferred from the counts.
    expect(fullShard.ending).toBe('generations-spent')
    // And the reading that separates the cap from the fabric: a node that was
    // eligible, saturated, and never asked. "Fewer than the fabric size" would be free
    // in any fabric larger than the cap; a NAMED untried node is not.
    const untried = found.executors.filter((node) => !fullShard.attempted.includes(node.nodeId))
    expect(untried.map((node) => node.nodeId)).toHaveLength(
      found.executors.length - DEFAULT_MAX_GENERATIONS,
    )
    // The abandonment is an event, not something a caller has to infer — CHURN-01.
    expect(everyNodeFull.job.leaseHistory.filter((event) => event.kind === 'abandoned')).toHaveLength(1)

    // ---- The comparison, taken inside one run. ----------------------------------
    // The control's attempt count against this arm's, on the same fabric minutes
    // apart, rather than either against an absolute nobody sited.
    expect(controlShard.attempted.length).toBeLessThan(fullShard.attempted.length)
    expect(control.job.complete).toBe(true)
    expect(everyNodeFull.job.complete).toBe(false)

    // No `admit` was supplied, so no offer was ever made and nothing refused one. `[]`
    // is the truthful answer rather than a default, and it is also this case's proof
    // that every refusal it read came from `exec`.
    expect(fullShard.rejections).toStrictEqual([])

    // ---- The saturation still held WHILE both arms ran. -------------------------
    // Read after rather than assumed. `MODULE_NEVER_RETURNS` is ended by the node's
    // own task deadline, so a slow run could have met a node that had gone free again
    // and this arm would have measured nothing. That becomes a loud failure here
    // instead of a silent pass — the failure mode the seed's orphan-leash test shipped
    // with for a day.
    for (const node of found.executors) {
      const still = await askOffer(requestor, node.nodeId, 'post-placement')
      expect(still.accepted).toBe(false)
      expect(still.capacity).toStrictEqual({ slots: 1, inFlight: 1 })
    }

    // **What this case cannot redden on.** Not the renewal half of CHURN-04: it
    // supplies no `JobSpec.admit`, so `submitJob` has no evidence channel to probe
    // with and never reaches `LeaseTable.renew` (`core/src/job/submit.ts`, search
    // `probeHolder`) — and no dispatch here holds a lease long enough to reach a
    // renewal point anyway, since every one of them is refused at once. Not the
    // offer-stage re-pick either, for the same reason: no offers, hence the empty
    // `rejections` above. And not speculation, which has no production path at this
    // wave — 20-07 lands it and 20-09 reads it, and when it does, the count this case
    // asserts exactly is one of the numbers it will move.
    await Promise.all(occupied)
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
