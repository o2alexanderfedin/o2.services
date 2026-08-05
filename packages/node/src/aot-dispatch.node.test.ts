import { spawn } from 'node:child_process'
import type { ChildProcessByStdio } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { performance } from 'node:perf_hooks'
import type { Readable, Writable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { ed25519 } from '@noble/curves/ed25519.js'
import { encodeCanonical, publicNodes, signName, submitJob, toHex } from '@o2/core'
import type {
  CanonicalValue,
  ExecutionOutcome,
  Executor,
  JobResult,
  NameRecord,
  Task,
  VerificationResult,
} from '@o2/core'
import { RemoteExecutor } from '@o2/net'
import type { CID } from 'multiformats/cid'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
// Test-only relative imports across a package boundary — the convention
// `sovereignty-placement.node.test.ts` and `packages/net/src/distributed.test.ts` record: a
// fixture is not part of a package's published surface, and the barrel is what production
// depends on.
import { MODULE_ECHOES_INPUT } from '../../core/src/executor/fixtures.ts'
import {
  ECHO_GUEST_C,
  HELLO_GUEST_C,
  LIFTED_ECHO,
  LIFTED_HELLO,
  buildGuest,
  cleanupGuests,
  guestDir,
  imageIsPresent,
  liftThroughCli,
} from '../../../tools/aot/echo-guest.ts'
import { FabricNode } from './fabric-node.ts'
import { FsBlockstore } from './fs-blockstore.ts'

/**
 * AOT-04 criterion 3, in the evidentiary form it is written in — **two OS processes on
 * one host.**
 *
 * *"A translated artifact produced by `tools/aot/cli.ts`, dispatched to a live node
 * started via `bin/agent.ts`, executes successfully — the node constructs a real
 * `WasiExecutor` in production, completing the same admission and verification path as a
 * source-compiled module."*
 *
 * Plan 21-03 gave `WasiExecutor` a production call site and proved it with a hand-written
 * fixture inside one process. Plan 21-04 produced an artifact elfconv actually emitted
 * that can finish a task, also inside one process. This file is the two of them across a
 * real process boundary.
 *
 * ## Why an equality, and not an `instanceof`
 *
 * *"The node constructs a real `WasiExecutor` in production"* is the one clause that
 * cannot be measured by asserting on a type. After `guardSovereignty`,
 * `guardModuleProvenance` and the counting/duty-cycle wrappers have layered the executor
 * several deep, `node.executor instanceof …` proves nothing — and none of those layers is
 * even reachable from here, because everything below runs on the far side of a socket.
 *
 * What does measure it is an equality. A translated artifact **cannot** produce a fabric
 * result through `WasmExecutor` at all: it fails at instantiate, naming
 * `wasi_snapshot_preview1`. So a job that completes over a lifted artifact and agrees
 * field for field with a source-compiled run can only have gone through the WASI path.
 * That equality, plus the planted mutation this plan records — delete the WASI arm of the
 * router and watch this file go red with the instantiate message — is the proof.
 *
 * ## What this is not
 *
 * **One host.** Two operating-system processes on one machine is this project's testing
 * standard, and it is also the strongest available check that the translated artifact is
 * byte-deterministic across processes: two independent V8 instances, two independent
 * `WebAssembly.compile` calls, two independent WASI environments, one compared digest. It
 * is **not** evidence about a second machine, and `CROSS_MACHINE_BLIND_SPOT` stays
 * attached to every artifact and stays printed by the CLI.
 *
 * **Not the sovereignty path.** Every shard here is `public` and no owner is named
 * anywhere in this file, so `guardSovereignty` is traversed and no-ops. DATA-09's own
 * reading is in `fabric-node.node.test.ts`, which dispatches a *sovereign* WASI task.
 *
 * ## Why the artifact is pre-staged, and why that leaves a question this file answers
 *
 * A lifted artifact is far larger than the fixtures this spawn harness was written for —
 * `MODULE_WRITES_PARTITION`, which Phase 12's harness deliberately moves over the wire, is
 * **178 bytes** and `MODULE_ECHOES_INPUT` is **146**, both measured 2026-07-29 by reading
 * `.length` off `packages/core/src/executor/fixtures.ts`. This file measures its own
 * artifact's length rather than quoting one, and the figure goes in the summary.
 *
 * Pre-staging is what a real deployment does — nobody ships an artifact of that size down
 * a dispatch path — so the dispatch carries only CIDs. But whether that block *can* cross
 * the wire is a separate question, and this file answers it as a **number** in its own
 * case rather than assuming either answer. See the third block below; the measured byte
 * count and elapsed time are the report that reaches Phase 13.1, and the five steps in
 * that case are the measurement.
 *
 * ## The spawn harness is copied, not imported
 *
 * `spawnAgent`, `stopAgent`, `startSubmitter`, `AgentProcess`, `Agent` and the
 * `beforeEach`/`afterEach` pair come from `packages/node/src/sovereignty-placement.node.test.ts`,
 * which exports none of them. Extracting a shared harness across two specs that are about
 * different criteria is a refactor this file does not need and should not attempt — but a
 * reader should find the original rather than assume divergence, so it is named here.
 */

// ---------------------------------------------------------------------------
// gates
// ---------------------------------------------------------------------------

const HAVE_IMAGE = imageIsPresent()

/**
 * The guest C, hashed, so a cached artifact can never be one lifted from different source.
 *
 * **What it does not cover, stated rather than left implied:** the toolchain. A re-pull of
 * `ELFCONV_IMAGE_TAG` that moved the image would not move this hash, so a cached artifact
 * survives a toolchain change it should not survive. That is what
 * `TranslationRecord.keyCid` exists to catch on the build path, and this cache deliberately
 * does not reimplement it — delete the file, or point `O2_AOT_ARTIFACT` elsewhere.
 */
function cachePathFor(label: string, source: string): string {
  const digest = createHash('sha256').update(source).digest('hex').slice(0, 16)
  return fileURLToPath(
    new URL(`../../../tools/aot/fixtures/lifted-${label}-${digest}.wasm`, import.meta.url),
  )
}

const ECHO_CACHE = cachePathFor('echo-guest', ECHO_GUEST_C)
const HELLO_CACHE = cachePathFor('hello-guest', HELLO_GUEST_C)

/**
 * Where each guest's bytes can come from, in the order they are tried.
 *
 * The environment override is `wasi-real.node.test.ts`'s `O2_LIFTED_WASM` convention,
 * reached here through `LIFTED_ECHO`/`LIFTED_HELLO`. The **cache** is that same
 * convention applied to this file's own output, and it exists for a measured reason: a
 * lift on this host is ~100 s per guest, this file needs two, and the whole cost lands in
 * a hook — where `--reporter=json` attributes it to nothing and `test:unit` therefore
 * carries it with no entry anywhere saying why (`vitest.config.ts` records that failure
 * mode in its own words, and Plan 21-04 measured a 194 014 ms hook reported as 403 ms).
 * Caching does not make the cost visible; it makes it happen once per host instead of
 * once per run.
 *
 * The path matches `.gitignore`'s `tools/aot/fixtures/lifted-*.wasm`, so a warmed host
 * leaves `git status --porcelain` unchanged — which the repository has a spec that
 * depends on.
 */
const MEASURABLE =
  HAVE_IMAGE ||
  ((LIFTED_ECHO ?? (existsSync(ECHO_CACHE) ? ECHO_CACHE : undefined)) !== undefined &&
    (LIFTED_HELLO ?? (existsSync(HELLO_CACHE) ? HELLO_CACHE : undefined)) !== undefined)

console.log(
  `[aot-dispatch] imageIsPresent()=${HAVE_IMAGE}` +
    ` O2_AOT_ARTIFACT=${LIFTED_ECHO ?? '(unset)'} O2_AOT_HELLO=${LIFTED_HELLO ?? '(unset)'}` +
    ` echoCache=${existsSync(ECHO_CACHE)} helloCache=${existsSync(HELLO_CACHE)}` +
    ` → measurable=${MEASURABLE}`,
)

/** Two container builds plus two lifts, on a host where one lift is minutes. */
const PREPARE_TIMEOUT_MS = 15 * 60 * 1000

/** A job across spawned processes, matching the harness this file copies. */
const JOB_TIMEOUT_MS = 120_000

/**
 * The wire case moves a multi-megabyte block on top of everything a job case does, so it
 * gets more room than the others. Stated as a wall for a wedged fetch, not as a budget
 * anything measured — no figure derived from it belongs in a claim.
 */
const WIRE_TIMEOUT_MS = 180_000

// ---------------------------------------------------------------------------
// the artifacts
// ---------------------------------------------------------------------------

interface Prepared {
  readonly label: string
  readonly artifact: Uint8Array<ArrayBuffer> | undefined
  /** Where the bytes came from, logged so a green run is auditable afterwards. */
  readonly origin: 'environment' | 'cache' | 'cli'
  readonly cliStatus: number | null | undefined
  readonly keyCid: string | undefined
  readonly artifactCid: string | undefined
  /** The CLI's stderr tail when there is one — where a failed lift puts its diagnosis. */
  readonly detail: string
  readonly wallMs: number
}

let echo: Prepared | undefined
let hello: Prepared | undefined

function tail(text: string, lines = 20): string {
  return text.split('\n').slice(-lines).join('\n')
}

function readOr(path: string): Uint8Array<ArrayBuffer> | undefined {
  try {
    return new Uint8Array(readFileSync(path))
  } catch {
    return undefined
  }
}

function prepareGuest(
  label: string,
  source: string,
  override: string | undefined,
  cache: string,
  buildDir: string,
): Prepared {
  const started = performance.now()
  const common = { label, cliStatus: undefined, keyCid: undefined, artifactCid: undefined }

  if (override !== undefined) {
    return {
      ...common,
      artifact: readOr(override),
      origin: 'environment',
      detail: `no artifact was read at ${override} — check the path on the environment`,
      wallMs: performance.now() - started,
    }
  }

  const cached = existsSync(cache) ? readOr(cache) : undefined
  if (cached !== undefined) {
    return {
      ...common,
      artifact: cached,
      origin: 'cache',
      detail: `no artifact was read at ${cache}`,
      wallMs: performance.now() - started,
    }
  }

  const elfPath = buildGuest(source, buildDir, label)
  const run = liftThroughCli(elfPath, join(buildDir, `${label}.wasm`))
  if (run.artifact !== undefined) {
    mkdirSync(dirname(cache), { recursive: true })
    writeFileSync(cache, run.artifact)
  }
  return {
    label,
    artifact: run.artifact,
    origin: 'cli',
    cliStatus: run.status,
    keyCid: run.printedKeyCid,
    artifactCid: run.printedArtifactCid,
    detail: `the CLI exited ${String(run.status)} and left no artifact — stderr tail:\n${tail(run.stderr)}`,
    wallMs: performance.now() - started,
  }
}

/**
 * The artifact of a guest that was prepared, or a failure carrying the diagnosis.
 *
 * `lift.node.test.ts`'s `liftedArtifact` discipline: a **skip** is a host without the
 * image, a **failure** is a lift that ran and came back wrong. This throws rather than
 * returning, so no block can be turned into a no-op by an early exit — four blocks in that
 * file once opened with `if (!first.ok) return` and six tests reported green having
 * executed no expectation.
 */
function artifactOf(guest: Prepared | undefined, label: string): Uint8Array<ArrayBuffer> {
  expect(guest, `beforeAll never prepared the ${label} guest`).toBeDefined()
  if (guest === undefined) throw new Error(`beforeAll never prepared the ${label} guest`)
  expect(guest.artifact, guest.detail).toBeDefined()
  if (guest.artifact === undefined) throw new Error(guest.detail)
  return guest.artifact
}

// ---------------------------------------------------------------------------
// the spawn harness — copied from sovereignty-placement.node.test.ts
// ---------------------------------------------------------------------------

const AGENT = fileURLToPath(new URL('./bin/agent.ts', import.meta.url))

/**
 * DET-03 is not this file's subject — the ABI is. The record exists so that subject can be
 * reached at all: every executor below is a `RemoteExecutor` aimed at a spawned
 * `bin/agent.ts`, which pins the demo's anchor by default, so an unsigned job would have
 * every dispatch refused by `guardModuleProvenance` before any byte of the module was
 * fetched.
 */
const publisher = (() => {
  // Seed 53 — distinct from every other fixture key in the repository.
  const priv = new Uint8Array(32).fill(53)
  return { priv, pub: toHex(ed25519.getPublicKey(priv)) }
})()

function recordFor(moduleCid: CID): NameRecord {
  return signName(publisher.priv, {
    name: 'aot-dispatch-fixture',
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
 * out. See `orphan-leash.node.test.ts`, which demonstrates it and guards that line.
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

function agentDir(name: string): string {
  return join(workdir, name)
}

/**
 * Write blocks into an agent's `--dir` **before the child is spawned**.
 *
 * `FsBlockstore.open` creates the directory and counts what is already in it, which is the
 * restart path; a child started afterwards reads these blocks locally and the dispatch
 * carries only CIDs.
 */
async function preStage(
  name: string,
  blocks: readonly Uint8Array<ArrayBuffer>[],
): Promise<readonly CID[]> {
  const store = await FsBlockstore.open(agentDir(name))
  const cids: CID[] = []
  for (const bytes of blocks) cids.push(await store.put(bytes))
  return cids
}

/** Spawn an agent process and wait for its one-line address handshake. */
async function spawnAgent(name: string, extraArgs: readonly string[] = []): Promise<Agent> {
  const dir = agentDir(name)
  const child: AgentProcess = spawn(
    process.execPath,
    [AGENT, '--dir', dir, '--trust-anchor', publisher.pub, ...extraArgs],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  )

  const handshake = await new Promise<{ peerId: string; multiaddrs: string[] }>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`agent ${name} did not announce in time: ${stderr}`)),
      30_000,
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

async function startSubmitter(rpcTimeoutMs = 30_000): Promise<FabricNode> {
  const node = await FabricNode.start({
    relayAdmission: 'admits-any-peer',
    startReporting: 'reports-its-own-start',
    blockstoreDir: join(workdir, 'submitter'),
    listen: ['/ip4/127.0.0.1/tcp/0'],
    rpcTimeoutMs,
    // The same value the spawned agents get, rather than the opt-out — a submitter
    // declaring a different authority from the nodes it dispatches to would be a lie in a
    // file nobody would re-read.
    trustAnchors: [publisher.pub],
  })
  nodes.push(node)
  return node
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

beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'o2-aot-'))
})

/**
 * Inner 10 s, outer 20 s — and the order is the point.
 *
 * `stopAgent` gives a wedged process 10 s before SIGKILL. Vitest's default `hookTimeout`
 * is also 10 s, so with no explicit budget the two clocks are armed for the same instant
 * and the framework's fires first: the SIGKILL fallback can never run, and a wedged agent
 * is reported as an anonymous hook timeout naming no step.
 */
afterEach(async () => {
  await Promise.all(nodes.splice(0).map((n) => n.stop().catch(() => {})))
  await Promise.all(agents.splice(0).map((a) => stopAgent(a).catch(() => {})))
  await rm(workdir, { recursive: true, force: true })
}, 20_000)

// ---------------------------------------------------------------------------
// what a submitter can see of a finished job
// ---------------------------------------------------------------------------

interface ObservedShard {
  readonly partitionIndex: number
  readonly inputCid: string
  readonly status: VerificationResult['status']
  readonly output: CanonicalValue | null
  readonly resultCid: string | null
  /** Sorted, because placement order across two nodes is not a property of the artifact. */
  readonly agreeing: readonly string[]
}

/**
 * A job reduced to what its submitter can see, with `moduleCid` dropped.
 *
 * Reimplemented here rather than imported from `packages/aot/src/admission.test.ts`, and
 * the reason is one line: that function drops `moduleCid` for a purpose specific to its own
 * two-job comparison, and a version shared between two specs would be one edit away from
 * meaning something different in each.
 *
 * `moduleCid` is the one field that **must** differ — the two runs name two different
 * artifacts — so including it would make the comparison fail for the only reason that is
 * not a defect. Everything else a `JobResult` carries about a shard is kept, including the
 * fuel totals: a kernel that charged a translated artifact differently would be telling the
 * two kinds apart in the one place where it is most tempting and least visible.
 */
function observe(job: JobResult): Record<string, unknown> {
  return {
    complete: job.complete,
    grossFuel: job.grossFuel,
    usefulFuel: job.usefulFuel,
    verificationMultiplier: job.verificationMultiplier,
    shards: job.shards.map(
      (shard): ObservedShard => ({
        partitionIndex: shard.partitionIndex,
        inputCid: shard.inputCid.toString(),
        status: shard.verification.status,
        output: shard.verification.status === 'agreed' ? shard.verification.output : null,
        resultCid:
          shard.verification.status === 'agreed' ? shard.verification.resultCid.toString() : null,
        agreeing:
          shard.verification.status === 'agreed'
            ? shard.verification.agreeing.map((entry) => entry.nodeId).toSorted()
            : [],
      }),
    ),
  }
}

/** Every failure reason a shard collected, whatever arm its verification landed on. */
function failureReasons(job: JobResult): readonly string[] {
  const reasons: string[] = []
  for (const shard of job.shards) {
    const { verification } = shard
    if (verification.status === 'agreed') continue
    for (const failure of verification.failures) reasons.push(failure.reason)
  }
  return reasons
}

/** The four values every job in this file runs, one per shard. */
const SHARD_VALUES: readonly CanonicalValue[] = [
  { n: 1, tag: 'echo' },
  { n: 2, tag: 'echo' },
  { n: 3, tag: 'echo' },
  { n: 4, tag: 'echo' },
]

const SHARD_SPECS = SHARD_VALUES.map((value) => ({ value, label: 'public' as const }))

/** The input block a submitted shard carries: `canonicalCid(value).bytes`. */
function blockFor(value: CanonicalValue): Uint8Array<ArrayBuffer> {
  const encoded = encodeCanonical(value)
  if (!encoded.ok) throw new Error('a shard value in this file does not encode as DAG-CBOR')
  return encoded.bytes
}

/**
 * Dispatch one task and never throw.
 *
 * An RPC that timed out or a peer that vanished is neither *fetched* nor *refused by
 * name*, and the wire case below reads `outcome.ok` as one half of a two-sided
 * observation — so a throw has to arrive as a readable reason rather than as a rejected
 * promise that ends the case before the other half is read.
 */
async function dispatch(executor: Executor, task: Task): Promise<ExecutionOutcome> {
  try {
    return await executor.execute(task)
  } catch (cause) {
    return { ok: false, reason: `dispatch threw: ${cause instanceof Error ? cause.message : String(cause)}` }
  }
}

// ---------------------------------------------------------------------------

describe.skipIf(!MEASURABLE)(
  'AOT-04 — a translated artifact completes a real job across two bin/agent.ts processes (skipped without the elfconv image and without a pre-lifted pair: the criterion is then UNMEASURED on this host, and unmeasured is not met)',
  () => {
    beforeAll(() => {
      if (!MEASURABLE) return
      const dir = guestDir('o2-aot-dispatch-')
      echo = prepareGuest('echo', ECHO_GUEST_C, LIFTED_ECHO, ECHO_CACHE, dir)
      hello = prepareGuest('hello', HELLO_GUEST_C, LIFTED_HELLO, HELLO_CACHE, dir)
      for (const guest of [echo, hello]) {
        console.log(
          `[aot-dispatch] ${guest.label}: origin=${guest.origin}` +
            ` status=${String(guest.cliStatus ?? 'n/a')} artifact=${guest.artifact?.length ?? 'none'} bytes` +
            ` wall=${guest.wallMs.toFixed(0)}ms keyCid=${guest.keyCid ?? 'n/a'}`,
        )
      }
    }, PREPARE_TIMEOUT_MS)

    afterAll(() => {
      cleanupGuests()
    })

    // -----------------------------------------------------------------------
    // the criterion
    // -----------------------------------------------------------------------

    it(
      'completes a 4-shard job at redundancy 2 on two agent processes, and the whole JobResult matches a source-compiled run field for field',
      async () => {
        const artifact = artifactOf(echo, 'echo')

        // Pre-staged before either child exists. Both directories get the same three
        // blocks, so the two jobs below differ in the artifact they name and in nothing
        // else about how the module reached the node.
        const blocks = [artifact, MODULE_ECHOES_INPUT]
        const [aliceCids, bobCids] = await Promise.all([
          preStage('alice', blocks),
          preStage('bob', blocks),
        ])
        // Not a formality. If the two stores disagreed about the same bytes, every later
        // assertion would be measuring the wrong thing, so this fails immediately with
        // both lists rather than letting a CID mismatch surface as a missing block.
        //
        // **This line is a guard against a future edit, not a runtime property, and it is
        // labelled rather than left to be read as evidence.** Two `FsBlockstore.put` calls
        // over the same bytes in one process compute
        // `CID.create(1, dagCbor.code, sha256(bytes))` twice and cannot disagree — so it
        // cannot fail on any behaviour of the code under test. What it *does* catch was
        // observed by planting: staging a different block list into one of the two
        // directories fires it here, with both lists in the message, instead of surfacing
        // three cases later as a missing block on one node.
        expect(aliceCids.map(String), 'the two pre-staged stores named the same bytes differently').toEqual(
          bobCids.map(String),
        )
        const [translatedCid, nativeCid] = aliceCids as [CID, CID]
        expect(translatedCid.toString()).not.toBe(nativeCid.toString())

        const [alice, bob] = await Promise.all([spawnAgent('alice'), spawnAgent('bob')])
        const submitter = await startSubmitter()
        const dialed = await Promise.all([
          submitter.dial(alice.multiaddrs[0]!),
          submitter.dial(bob.multiaddrs[0]!),
        ])
        expect(dialed.toSorted()).toEqual([alice.peerId, bob.peerId].toSorted())

        // The submitter holds every block too, so a shard input can reach either agent.
        // The two *artifacts* are the only thing pre-staging is about.
        await submitter.store.put(artifact)
        await submitter.store.put(MODULE_ECHOES_INPUT)

        const executors = [
          new RemoteExecutor(alice.peerId, submitter.rpc, 'dispatches-unauthenticated'),
          new RemoteExecutor(bob.peerId, submitter.rpc, 'dispatches-unauthenticated'),
        ]

        const translatedStarted = performance.now()
        const translated = await submitJob(
          {
            moduleCid: translatedCid,
            moduleRecord: recordFor(translatedCid),
            shards: SHARD_SPECS,
            executors,
            nodes: publicNodes(executors),
            redundancy: 2,
            onQuorumShortfall: 'runs-at-available-redundancy',
          },
          submitter.store,
        )
        const translatedMs = performance.now() - translatedStarted

        // Success is asserted BEFORE sameness. Two jobs that failed in the same way would
        // satisfy every equality below, and the criterion is not "the translated artifact
        // fails exactly as well".
        expect(
          translated.ok,
          translated.ok ? '' : `translated job refused: ${JSON.stringify(translated.error)}`,
        ).toBe(true)
        if (!translated.ok) return
        expect(
          translated.job.complete,
          `translated job incomplete; failure reasons: ${JSON.stringify(failureReasons(translated.job))}`,
        ).toBe(true)
        expect(
          translated.job.shards.map((shard) => shard.verification.status),
          `failure reasons: ${JSON.stringify(failureReasons(translated.job))}`,
        ).toEqual(['agreed', 'agreed', 'agreed', 'agreed'])

        // The value came back, per shard, from a guest that knows nothing about the codec:
        // `WasiExecutor` writes the input block — already valid DAG-CBOR — onto stdin, and
        // the guest copies stdin to stdout.
        expect(
          translated.job.shards.map((shard) =>
            shard.verification.status === 'agreed' ? shard.verification.output : null,
          ),
        ).toEqual(SHARD_VALUES)

        // Two independently-owned OS processes agreed on every shard, so verification
        // actually ran. At redundancy 1 this reads `agreed` from a single executor and
        // proves nothing about comparison, which is why the redundancy is 2.
        for (const shard of translated.job.shards) {
          expect(shard.verification.status).toBe('agreed')
          if (shard.verification.status !== 'agreed') continue
          expect(shard.verification.replicas).toBe(2)
          expect(shard.verification.agreeing.map((entry) => entry.nodeId).toSorted()).toEqual(
            [alice.peerId, bob.peerId].toSorted(),
          )
        }

        // The identical four shard values, the identical two agent processes, the other
        // ABI.
        const nativeStarted = performance.now()
        const native = await submitJob(
          {
            moduleCid: nativeCid,
            moduleRecord: recordFor(nativeCid),
            shards: SHARD_SPECS,
            executors,
            nodes: publicNodes(executors),
            redundancy: 2,
            onQuorumShortfall: 'runs-at-available-redundancy',
          },
          submitter.store,
        )
        const nativeMs = performance.now() - nativeStarted

        expect(native.ok, native.ok ? '' : `native job refused: ${JSON.stringify(native.error)}`).toBe(
          true,
        )
        if (!native.ok) return
        expect(
          native.job.complete,
          `native job incomplete; failure reasons: ${JSON.stringify(failureReasons(native.job))}`,
        ).toBe(true)

        // The claim, one line. Equality across two ABIs is the only observation that
        // distinguishes "the WASI path ran" from "something ran": a translated artifact
        // cannot produce a fabric result through `WasmExecutor` at all — it fails at
        // instantiate naming `wasi_snapshot_preview1` — so this equality can only have come
        // from the WASI path.
        expect(observe(translated.job)).toEqual(observe(native.job))

        console.log(
          `[aot-dispatch] translated ${artifact.length} bytes, 4 shards R2 in ${translatedMs.toFixed(0)}ms;` +
            ` source-compiled ${MODULE_ECHOES_INPUT.length} bytes in ${nativeMs.toFixed(0)}ms;` +
            ` grossFuel=${translated.job.grossFuel} usefulFuel=${translated.job.usefulFuel}` +
            ` multiplier=${translated.job.verificationMultiplier}`,
        )
      },
      JOB_TIMEOUT_MS,
    )

    // -----------------------------------------------------------------------
    // the falsification
    // -----------------------------------------------------------------------

    it(
      'refuses the hello artifact at the codec on both processes — so the success above discriminates',
      async () => {
        /**
         * Without this, "the translated job completed" is equally well explained by a path
         * that accepts anything.
         *
         * **The rendered sentence is asserted, not the kind.** What crosses the wire and
         * lands in a shard's failure list is `ExecutionOutcome.reason`, a plain string:
         * `WasiExecutor.execute` maps its structured failure through
         * `describeWasiFailure`, whose `not-dag-cbor` arm returns
         * `output is not valid DAG-CBOR: <detail>`. The literal `not-dag-cbor` never
         * appears in that string, so a `toContain('not-dag-cbor')` would fail on a correct
         * run.
         *
         * **That sentence reaching the requestor is itself a router proof.** It means the
         * module compiled, every WASI import was satisfied, it instantiated, `_start` ran
         * to completion and it wrote bytes — only the codec refused them. A hello artifact
         * routed to the *native* executor could not have got that far: it would have
         * failed at instantiate, with `instantiation failed: WebAssembly.instantiate():
         * Import #0 "wasi_snapshot_preview1": …`, and never reached the codec. So the
         * absence of that phrase is asserted beside the presence of this one.
         */
        const artifact = artifactOf(hello, 'hello')

        const [aliceCids, bobCids] = await Promise.all([
          preStage('alice', [artifact]),
          preStage('bob', [artifact]),
        ])
        expect(aliceCids.map(String)).toEqual(bobCids.map(String))
        const helloCid = aliceCids[0]!

        const [alice, bob] = await Promise.all([spawnAgent('alice'), spawnAgent('bob')])
        const submitter = await startSubmitter()
        await Promise.all([
          submitter.dial(alice.multiaddrs[0]!),
          submitter.dial(bob.multiaddrs[0]!),
        ])
        await submitter.store.put(artifact)

        const executors = [
          new RemoteExecutor(alice.peerId, submitter.rpc, 'dispatches-unauthenticated'),
          new RemoteExecutor(bob.peerId, submitter.rpc, 'dispatches-unauthenticated'),
        ]
        const result = await submitJob(
          {
            moduleCid: helloCid,
            moduleRecord: recordFor(helloCid),
            shards: SHARD_SPECS,
            executors,
            nodes: publicNodes(executors),
            redundancy: 2,
            onQuorumShortfall: 'runs-at-available-redundancy',
          },
          submitter.store,
        )

        expect(result.ok).toBe(true)
        if (!result.ok) return
        expect(result.job.complete).toBe(false)
        expect(result.job.shards.map((shard) => shard.verification.status)).toEqual([
          'insufficient',
          'insufficient',
          'insufficient',
          'insufficient',
        ])

        const reasons = failureReasons(result.job)
        // Eight dispatches — four shards, two replicas — and every one of them has to say
        // the same thing. A `some` here would pass on a run where seven failed at
        // instantiate and one reached the codec.
        expect(reasons.length).toBeGreaterThanOrEqual(SHARD_VALUES.length * 2)
        for (const reason of reasons) {
          expect(reason).toContain('output is not valid DAG-CBOR')
          expect(reason).not.toContain('instantiation failed')
        }
      },
      JOB_TIMEOUT_MS,
    )

    // -----------------------------------------------------------------------
    // the number the criterion routes around rather than answers
    // -----------------------------------------------------------------------

    it(
      'answers whether a block the size of a lifted artifact crosses the wire, read from an un-staged agent’s own blockstore directory and cross-checked against the outcome',
      async () => {
        /**
         * **Five steps, and the last two are the measurement.**
         *
         * The instrument is the third agent's own `--dir`. `FabricNode.start` opens an
         * `FsBlockstore` on it and wraps it as the *local* tier of a `FetchingBlockstore`;
         * `FsBlockstore` writes one file per block named by `cid.toString()`; and
         * `FetchingBlockstore` calls `this.#local.put(bytes)` on **every** block it pulls
         * and verifies. So a block that crossed the wire is a file in that directory, and
         * this case can `readdir` and `stat` it.
         *
         * A bare `expect(['fetched','refused']).toContain(branch)` over `ExecutionOutcome`'s
         * two-arm union is a tautology and is explicitly not what this case does: it would
         * pass if the fetch was never attempted, if the agent was never spawned, or if the
         * artifact had been accidentally staged.
         *
         * **Only one of the two arms can happen on a given host, so the instrument is
         * proved in both directions before either arm is read.** Step 1 is a known
         * positive — a small module and a small input, neither pre-staged, that must
         * appear as files — and step 2 is the negative — the same `existsSync` reading
         * `false` for a block that has not crossed. An empty capture is then an absent
         * *block* rather than an absent instrument, which is the whole difference between
         * a measurement and a green.
         *
         * The measured byte count and the measured elapsed milliseconds ride in the log
         * line and reach Phase 13.1 through the summary. **They are the report, not the
         * proof.**
         */
        const artifact = artifactOf(echo, 'echo')

        // NOT pre-staged. `carol`'s directory does not exist until the child creates it.
        const carol = await spawnAgent('carol')
        // 60 s rather than the default 30 s: this dispatch may carry a multi-megabyte
        // fetch on the far side, and a submitter-side timeout would replace the reading
        // with a timeout — which is neither branch.
        const submitter = await startSubmitter(60_000)
        await submitter.dial(carol.multiaddrs[0]!)

        // ---- 1. prove the instrument is live, with a known positive ----------------
        //
        // A small module and a small input, neither pre-staged, dispatched to this same
        // agent. If the directory does not grow, the test fails HERE: an empty capture is
        // an ABSENT INSTRUMENT, not a clean run. Never run the artifact measurement
        // without this passing first.
        const probeModuleCid = await submitter.store.put(MODULE_ECHOES_INPUT)
        const probeInputCid = await submitter.store.put(blockFor(SHARD_VALUES[0]!))
        const executor = new RemoteExecutor(carol.peerId, submitter.rpc, 'dispatches-unauthenticated')

        const probe = await dispatch(executor, {
          moduleCid: probeModuleCid,
          inputCid: probeInputCid,
          partitionIndex: 0,
          partitionCount: 1,
          label: 'public',
          moduleRecord: recordFor(probeModuleCid),
        })
        expect(probe.ok, probe.ok ? '' : `known-positive dispatch refused: ${probe.reason}`).toBe(true)
        const probeModulePath = join(carol.dir, probeModuleCid.toString())
        const probeInputPath = join(carol.dir, probeInputCid.toString())
        expect(
          [existsSync(probeModulePath), existsSync(probeInputPath)],
          `the instrument is dead: ${MODULE_ECHOES_INPUT.length}-byte module and ` +
            `${blockFor(SHARD_VALUES[0]!).length}-byte input dispatched to an un-staged agent, ` +
            `and its --dir holds ${JSON.stringify(readdirSync(carol.dir))}`,
        ).toEqual([true, true])

        // ---- 2. snapshot, and require the artifact to be absent --------------------
        //
        // This line is the **negative** half of the instrument, and it is a reading rather
        // than a formality: step 1 has just shown the directory grows when a block
        // crosses, and this shows the same `existsSync` reads `false` for a block that has
        // not. Both directions of the instrument are therefore exercised before either is
        // used to decide anything.
        const before = readdirSync(carol.dir).toSorted()
        const artifactCid = await submitter.store.put(artifact)
        const artifactPath = join(carol.dir, artifactCid.toString())
        expect(
          existsSync(artifactPath),
          `the artifact was already in the un-staged agent's directory: ${JSON.stringify(before)}`,
        ).toBe(false)

        // ---- 3. dispatch the artifact shard, timed ---------------------------------
        const artifactInputCid = await submitter.store.put(blockFor(SHARD_VALUES[1]!))
        const started = performance.now()
        const outcome = await dispatch(executor, {
          moduleCid: artifactCid,
          inputCid: artifactInputCid,
          partitionIndex: 0,
          partitionCount: 1,
          label: 'public',
          moduleRecord: recordFor(artifactCid),
        })
        const elapsedMs = performance.now() - started

        // ---- 4. branch on the FILESYSTEM, not on the outcome -----------------------
        const fetched = existsSync(artifactPath)
        const after = readdirSync(carol.dir).toSorted()
        const report =
          `${artifact.length} bytes, ${elapsedMs.toFixed(0)}ms, fetched=${String(fetched)}, ` +
          `ok=${String(outcome.ok)}, dir grew ${before.length}→${after.length}` +
          (outcome.ok ? '' : `, reason=${outcome.reason}`)

        // ---- 5. the two observations must agree, asserted BEFORE either is used ----
        //
        // Two independent readings of one event. A truncated block fails `blockCid`
        // verification and is reported as *absent* — indistinguishable from "never
        // fetched" if only the outcome is read — so it shows up here as a mismatch rather
        // than as a clean second state.
        //
        // **Ordered before the branch deliberately.** Written after it, this line reads
        // `true === true` on whichever arm ran, because that arm has just asserted both
        // halves separately — an assertion that cannot fail, dressed as the case's
        // conclusion. Here it is the one line a disagreement fires on, and each arm below
        // then adds only what is specific to it.
        expect(fetched, report).toBe(outcome.ok)

        if (fetched) {
          // A block that crossed and verified is the whole block: `FetchingBlockstore`
          // rejects anything that does not hash to the CID asked for, so a file of the
          // wrong length here would mean the store wrote something it never verified.
          expect(statSync(artifactPath).size, report).toBe(artifact.length)
        } else {
          // Unreachable past the cross-check above, which has already required
          // `outcome.ok === false` on this arm. The narrowing is what lets `reason` be
          // read at all.
          if (outcome.ok) throw new Error(`unreachable: ${report}`)
          //
          // **The reason is reported, not matched against a sentence, and that is a
          // measured decision rather than a soft one.** The plan for this file asked this
          // arm to require the reason to contain the artifact's CID, on the reasoning that
          // an unfetchable module surfaces as `module block missing: <cid>`. That holds
          // when the peer *answers* and the answer is unusable — an oversized frame, a
          // block that fails its `blockCid` check — which is the failure mode this
          // measurement is about. It does **not** hold when nothing can answer at all:
          // probed on this host on 2026-08-04 with a CID no store held, the dispatch
          // instead ended `dispatch to <peer> failed: rpc to <peer> timed out after
          // 60000ms`, naming the peer and never the CID, because `serveAgent` answers a
          // block request out of the node's *network-fallback* tier, so two connected
          // nodes each ask the other for a block neither holds and both spend their whole
          // budget. Requiring the CID here would be an assertion written from an
          // assumption, and it would fire on the wrong thing.
          expect(outcome.reason.length, report).toBeGreaterThan(0)
        }

        console.log(`[aot-dispatch] wire: ${report}`)
      },
      WIRE_TIMEOUT_MS,
    )
  },
)
