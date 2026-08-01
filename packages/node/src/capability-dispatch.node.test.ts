import { spawn } from 'node:child_process'
import type { ChildProcessByStdio } from 'node:child_process'
import type { Readable } from 'node:stream'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ed25519 } from '@noble/curves/ed25519.js'
import { canonicalCid, signName, toHex } from '@o2/core'
import type { CanonicalValue, Delegation, NameRecord, Task } from '@o2/core'
import { RemoteExecutor, encodeRequest, parseRequest, sliceManifest } from '@o2/net'
import type { CID } from 'multiformats/cid'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
// Test-only relative import — see the note in packages/net/src/distributed.test.ts.
import { MODULE_WRITES_PARTITION } from '../../core/src/executor/fixtures.ts'
import {
  OWNER_ID,
  OWNER_KEY,
  brokenLinkChainFor,
  chainSupplierFor,
  delegatedChainFor,
  directChainFor,
  undelegableChainFor,
} from './capability-fixture.ts'
import { FabricNode } from './fabric-node.ts'
import { FsBlockstore } from './fs-blockstore.ts'

/**
 * AUTH-03 — all three of ROADMAP Phase 15's success criteria, across a real
 * operating-system process boundary.
 *
 * In the ROADMAP's own words (`.planning/ROADMAP.md:419-421`):
 *
 * 1. *"A task dispatched through `bin/agent.ts` between two live nodes carries a
 *    capability chain attached by `RemoteExecutor`, and the receiving node's
 *    `authorize` hook verifies it before calling `WebAssembly.instantiate`."*
 * 2. *"A task arriving with no capability chain, or one that has expired, is refused
 *    before instantiation, and the refusal names the missing or expired link,
 *    observable in the node's response."*
 * 3. *"A validly delegated sub-chain (owner → intermediate → executor) is accepted, and
 *    a chain with a broken delegation link is refused, proving delegation depth is
 *    checked and not merely the chain's presence."*
 *
 * One `it` per criterion, in that order.
 *
 * ## 1. What "started via `bin/agent.ts`" means here
 *
 * What `egress-refusal.node.test.ts:27-32` states outright and
 * `sovereignty-placement.node.test.ts` established: the node under test is a genuine
 * operating-system process spawned from that binary, sharing nothing with this process
 * but a socket. The submitter is a `FabricNode` in the test process, as it is in every
 * existing spawn file, because the binary is serving-only and never calls `submitJob` —
 * there is no second process it could be.
 *
 * ## 2. The instrument for "before `WebAssembly.instantiate`", and what it is worth
 *
 * **A literal `WebAssembly.instantiate` counter across a process boundary is
 * unmeasured, and this file invents none.** The call happens inside a Worker inside a
 * spawned child; there is no seam to watch it through from here. Two proxies are read
 * instead, and they are proxies, not the clause:
 *
 * *(a) The child's own blockstore directory* — the stronger of the two, and the one
 * Phase 14 established for exactly this clause (`signed-artifact.node.test.ts`).
 * `FsBlockstore` writes one file per block named by its CID string
 * (`fs-blockstore.ts:102`); the executor a `FabricNode` composes resolves
 * `blockstore.get(task.moduleCid)` as the first thing it does
 * (`worker-executor.ts:175`); and that blockstore is a `FetchingBlockstore`, which pulls
 * a block it does not hold from its peers and writes it into the local store on the way
 * through (`packages/net/src/block.ts:120`). So a file named for the module's CID
 * appearing in the agent's directory says *this process went and got the module's
 * bytes*, and its absence says *it did not*. Every `not.toContain` below sits in the
 * same `it` as a `toContain` off the same instrument, so none of them is a silence.
 *
 * *(b) The submitter's outbound frame count to that child.* Only the submitter holds
 * the module — the property `two-process.node.test.ts:41-52` establishes for NET-01 —
 * so a child that never came back for it never compiled anything. Both counts are
 * **read and asserted only as a relation**, never against a literal, and no arithmetic
 * deriving either is written down here or in the summary.
 *
 * **Both are proxies.** Whether the relation between them *is* criterion 1's "before
 * calling `WebAssembly.instantiate`" clause, or merely stands in for it, is a judgement
 * written in prose rather than a measurement. At this boundary that clause can only be
 * **reported** as met, and this file says so rather than letting a passing relation
 * stand in for it.
 *
 * ## 3. Where the stronger, in-process reading lives
 *
 * A counting `Executor` reading `0` — strictly stronger, because it measures "the
 * executor was never called" rather than "the bytes were never fetched". It lives in
 * `packages/net/src/capability-dispatch.test.ts` and
 * `packages/net/src/capability-authorizer.test.ts`, against the same code path minus the
 * process boundary. It is stronger because `packages/core/src/executor/wasm.ts:161` is
 * the only caller of `WebAssembly.instantiate` **on the `serveAgent` dispatch path** —
 * not the only caller in the repository; `packages/aot/src/wasi-executor.ts:827` is a
 * second one, off this path. The two halves are deliberately separate and neither is
 * asked to carry the other.
 *
 * ## 4. No sovereign byte is fetched back to the submitter by any test in this file
 *
 * The single-node reference in the third `it` runs over a **separate public row already
 * in the submitter's own store**, asserted present before the run and asserted to have
 * added nothing to the submitter's egress manifest. `WasmExecutor.execute` reads
 * `task.inputCid` unconditionally before it compiles anything
 * (`packages/core/src/executor/wasm.ts:88-90`), and this file dispatches
 * `RemoteExecutor.execute(task)` directly rather than going through `submitJob` — which
 * is what writes every shard's canonical bytes into the *submitter's* blockstore. So a
 * reference run that reused the sovereign `inputCid` would resolve it through the
 * submitter's `FetchingBlockstore` (`fabric-node.ts:643`) and pull the owner-pinned row
 * back over the wire from alice, in the same phase whose sibling file
 * `egress-refusal.node.test.ts` exists to prove that cannot happen — or stall and return
 * `input block missing`. Either outcome would also silently inflate the frame counts the
 * first two cases read. The public row removes the possibility rather than relying on
 * ordering.
 *
 * ## 5. Criterion 2 is met at two different strengths, and the split is stated
 *
 * The expired refusal names `link 0`. The absent-chain refusal names **no index and
 * cannot**: `capability.ts:104` produces the literal `'no capability chain supplied'`
 * and nothing more, because an empty chain has no link to index. Both are asserted, the
 * absence of an index only alongside a case where an index *is* present. A summary that
 * claims the missing-chain refusal names a link is claiming a string `describeFailure`
 * never produces.
 *
 * ## 6. Two clocks, and a correction to the plan this file was written from
 *
 * The submitter's RPC budget is 10 s and each `it`'s `testTimeout` is 120 s, matching
 * the two existing spawn files. Every refusal here arrives as a returned `reason` rather
 * than a timeout, so the budget only has to cover a real cross-process dispatch
 * including a module pull; the accepted dispatch in the first case is the evidence that
 * 10 s is ample rather than merely convenient. Nothing in this file measures wall-clock
 * and nothing here should be read as if it did.
 *
 * The plan states that on a refusal *"`registerSovereignInputs` never runs, nothing is
 * registered, and the reply frame is scanned against nothing"*. **That is false as
 * written and is recorded rather than absorbed:** `takeSovereignHold` runs at
 * `agent.ts:382-388`, *before* the `authorize` call at `:402-408`, so alice's tap does
 * hold this file's seeded row across every refused dispatch. The conclusion the plan
 * draws from it survives intact for a different reason — a refusal frame carries only
 * `unauthorized: <text>` and none of the owner's bytes, so the scan passes it and the
 * refusal reaches the submitter as a returned outcome. Phase 13.1's criterion 6 still
 * does not apply to this path; the mechanism is the reply's contents, not the absence of
 * a registration.
 */

const AGENT = fileURLToPath(new URL('./bin/agent.ts', import.meta.url))

/**
 * DET-03 is not this file's subject — the capability chain is. The record exists so
 * that subject can still be reached: every executor below aims at a spawned
 * `bin/agent.ts`, which pins the demo's anchor by default, so an unsigned task would be
 * refused for provenance and this file's whole point is which refusal arrives.
 *
 * Seed 56 — distinct from every other fixture key in the repository, and adjacent to
 * 51/52/53 and 54/55 so the four spawn files' keys read as one family. Re-grepped
 * 2026-07-31 across every `fill(n)` and `keypair(n)` site: 0-4, 7, 9, 11, 12, 21-24, 30,
 * 31, 40-42, 50-55, 60, 61, 80-82, 90-99 and 111-113 are taken; 56 is free.
 */
const publisher = (() => {
  const priv = new Uint8Array(32).fill(56)
  return { priv, pub: toHex(ed25519.getPublicKey(priv)) }
})()

function recordFor(name: string, moduleCid: CID): NameRecord {
  return signName(publisher.priv, {
    name,
    cid: moduleCid,
    version: 1,
    expiresAt: Date.now() + 3_600_000,
  })
}

/** stdin is `ignore`d, so the child's type carries `null` for it. */
type AgentProcess = ChildProcessByStdio<null, Readable, Readable>

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
 * Two clocks: this handshake budget is 30 s and it is the *inner* one; each `it`'s
 * 120 s `testTimeout` is the outer. Sized that way round on purpose — if the inner
 * budget were the larger, a child that never announced would surface as an anonymous
 * framework timeout naming no step instead of as this function's message carrying the
 * child's stderr.
 */
async function spawnAgent(name: string, extraArgs: readonly string[] = []): Promise<Agent> {
  const dir = join(workdir, name)
  const child: AgentProcess = spawn(
    process.execPath,
    [AGENT, '--dir', dir, '--trust-anchor', publisher.pub, ...extraArgs],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  )

  const handshake = await new Promise<{ peerId: string; multiaddrs: string[] }>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`agent ${name} did not announce in time: ${stderr}`)), 30_000)
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

/**
 * The submitter, with an RPC budget chosen for this file rather than inherited.
 *
 * 10 s, the same figure `egress-refusal.node.test.ts` uses, and for the surviving half
 * of that file's justification: every accepted dispatch below runs a full cross-process
 * round trip — exec request out, module block pulled back over the wire by a child that
 * has never seen it, WASM compiled and run in that child, reply returned — on this
 * budget, so it cannot fail for want of time. Every refusal below arrives as a returned
 * outcome rather than at this budget's expiry, so nothing here waits on it.
 *
 * `trustAnchors` is the publisher's key rather than the opt-out: a submitter declaring a
 * different authority from the process it dispatches to would be a lie in a file nobody
 * would re-read. It is also load-bearing for the third case's local reference run, which
 * goes through this node's own provenance guard.
 */
async function startSubmitter(): Promise<FabricNode> {
  const node = await FabricNode.start({
    blockstoreDir: join(workdir, 'submitter'),
    listen: ['/ip4/127.0.0.1/tcp/0'],
    rpcTimeoutMs: 10_000,
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

/**
 * The CIDs of the blocks an agent's store holds on disk.
 *
 * Filters `.tmp-` exactly as `FsBlockstore.open` does (`fs-blockstore.ts:45`), because a
 * write interrupted mid-rename leaves one behind and it is not a block. Every assertion
 * against this is containment by CID string, never a count.
 */
async function blockNames(dir: string): Promise<string[]> {
  const entries = await readdir(dir)
  return entries.filter((name) => !name.startsWith('.tmp-'))
}

/** Outbound frames the submitter sent to `peerId` since manifest index `from`. */
function framesTo(node: FabricNode, peerId: string, from: number): number {
  return sliceManifest(node.egress, from).entries.filter((entry) => entry.to === peerId).length
}

/**
 * Alice's row, distinct from every fixture in `egress-refusal.node.test.ts` and
 * `egress-manifest.node.test.ts`.
 *
 * Deliberately not shared: if two files used one row, either file's seeding could
 * satisfy the other's assertion and a failure to seed would be invisible.
 */
const SOVEREIGN_ROW: CanonicalValue = {
  ssn: '412-88-0176',
  salary: 98_400,
  dob: '1974-02-19',
  branch: 'east-quay',
}

/**
 * The **public** row the third case's single-node reference computes over — different
 * bytes from the sovereign one, in the submitter's own store, never on the wire.
 *
 * A public-labelled task over different input bytes is a legitimate reference for a
 * sovereign task's output because `MODULE_WRITES_PARTITION` never calls `input_read` at
 * all: it lays down a four-byte CBOR prefix and then `partition() >>> 16`, read off the
 * four-function host ABI (`packages/core/src/executor/fixtures.ts:113-131`, and
 * `wasm.ts:153-154` for what `partition()` packs). Neither the label nor the input bytes
 * are anything the module can observe, so the output is a function of `partitionIndex`
 * alone.
 */
const PUBLIC_REFERENCE_ROW: CanonicalValue = { region: 'east-quay', headcount: 31 }

/** Non-zero on purpose: an index of 0 would make a module that emitted nothing agree. */
const PARTITION_INDEX = 2
const PARTITION_COUNT = 5

interface Fixture {
  readonly alice: Agent
  readonly submitter: FabricNode
  readonly moduleCid: CID
  readonly referenceInputCid: CID
  readonly task: Task
}

/**
 * One spawned owner, one submitter, one dial, and the two rows in the two places they
 * belong.
 *
 * Alice's row is seeded into her blockstore directory **before her process opens it**,
 * with the CID computed here from the same bytes that are seeded and never read back off
 * the code under test. Two reasons, both worth stating: it makes the owner-pinned
 * premise literal rather than assumed, and it means the *only* block alice must fetch is
 * the module — which is what makes both instruments in this file clean readings.
 *
 * Each case calls this with its own `name`, so each gets its own agent in its own
 * directory. That is what makes the directory reading attributable: a module block
 * fetched by an earlier case living on in a shared store would make a later
 * `not.toContain` fail, or — worse — make a later `toContain` pass, for a reason that
 * has nothing to do with the case being read.
 */
async function setUp(name: string): Promise<Fixture> {
  const owned = await canonicalCid(SOVEREIGN_ROW)
  if (!owned.ok) throw new Error('sovereign fixture not encodable')
  const aliceStore = await FsBlockstore.open(join(workdir, name))
  const seeded = await aliceStore.put(owned.bytes)
  expect(seeded.toString()).toBe(owned.cid.toString())

  const alice = await spawnAgent(name, [
    '--owner-id',
    OWNER_ID,
    '--owner-key',
    OWNER_KEY,
    '--can-execute-sovereign',
  ])
  const submitter = await startSubmitter()
  await submitter.dial(alice.multiaddrs[0]!)

  // Only the submitter holds the module, so alice must pull it over the wire.
  const moduleCid = await submitter.store.put(MODULE_WRITES_PARTITION)

  const reference = await canonicalCid(PUBLIC_REFERENCE_ROW)
  if (!reference.ok) throw new Error('reference fixture not encodable')
  const referenceInputCid = await submitter.store.put(reference.bytes)

  const task: Task = {
    moduleCid,
    moduleRecord: recordFor('capability-dispatch', moduleCid),
    inputCid: owned.cid,
    partitionIndex: PARTITION_INDEX,
    partitionCount: PARTITION_COUNT,
    label: 'sovereign',
    ownerId: OWNER_ID,
  }

  return { alice, submitter, moduleCid, referenceInputCid, task }
}

beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'o2-capability-'))
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

describe('AUTH-03 — the three criteria across two real bin/agent.ts processes', () => {
  it('criterion 1: a chained dispatch is accepted and an unchained one refused, and only the accepted one made the child fetch the module', async () => {
    const { alice, submitter, moduleCid, task } = await setUp('criterion-1')

    const unauthenticated = new RemoteExecutor(alice.peerId, submitter.rpc, 'dispatches-unauthenticated')
    const chained = new RemoteExecutor(alice.peerId, submitter.rpc, chainSupplierFor(alice.peerId))

    // The refused dispatch runs **first**, deliberately. A control that ran first would
    // leave "alice died during the refused dispatch" standing as an explanation for it.
    const beforeRefused = submitter.egress.manifest.entries.length
    const refused = await unauthenticated.execute(task)
    const refusedFrames = framesTo(submitter, alice.peerId, beforeRefused)

    expect(refused.ok).toBe(false)
    // A refused frame, not a crashed node. Without this reading, "the process died
    // mid-dispatch" explains the refusal just as well.
    expect(alice.child.exitCode).toBeNull()
    expect(alice.child.signalCode).toBeNull()

    // The stronger of the two proxies, read on the child's own side of the boundary:
    // the module's bytes were reachable — the submitter holds them and the socket is
    // open — and alice never went and got them.
    expect(await blockNames(alice.dir)).not.toContain(moduleCid.toString())

    const beforeAccepted = submitter.egress.manifest.entries.length
    const accepted = await chained.execute(task)
    const acceptedFrames = framesTo(submitter, alice.peerId, beforeAccepted)

    expect(accepted.ok).toBe(true)
    expect(alice.child.exitCode).toBeNull()

    // The positive reading of the same instrument, in the same case, so the
    // `not.toContain` above is a reading rather than a silence.
    expect(await blockNames(alice.dir)).toContain(moduleCid.toString())

    // The frame-count relation. Never against a literal: a child that refused before
    // fetching the module cannot produce the larger count, and a child that never
    // received the request cannot produce the smaller one. Both figures are recorded as
    // measured in 15-04-SUMMARY.md — the ROADMAP's own Phase 13 amendment note
    // (`ROADMAP.md:332-336`) exists because a byte figure was once asserted from
    // prediction rather than read.
    expect(refusedFrames).toBeGreaterThanOrEqual(1)
    expect(acceptedFrames).toBeGreaterThan(refusedFrames)

    // Printed rather than only asserted, so the reading is available on every run
    // instead of surviving as a note somebody took once.
    console.log(`[criterion 1] frames to child — refused: ${refusedFrames}, accepted: ${acceptedFrames}`)
  }, 120_000)

  it('criterion 2: an absent chain is refused in the mechanism’s own words with no index, an expired one by link index, and a valid one still accepted afterwards', async () => {
    const { alice, submitter, moduleCid, task } = await setUp('criterion-2')

    const unauthenticated = new RemoteExecutor(alice.peerId, submitter.rpc, 'dispatches-unauthenticated')
    // No sleep: the child's clock is this machine's clock, which this project's testing
    // standard makes exact rather than approximate, so an absolute expiry one second in
    // the past is precise. `expiresAt` is absolute Unix ms, *"absolute rather than a
    // duration so it cannot drift"* (`capability.ts:56`).
    const stale = new RemoteExecutor(alice.peerId, submitter.rpc, () =>
      directChainFor(alice.peerId, OWNER_ID, Date.now() - 1_000),
    )
    const valid = new RemoteExecutor(alice.peerId, submitter.rpc, chainSupplierFor(alice.peerId))

    const beforeAbsent = submitter.egress.manifest.entries.length
    const absent = await unauthenticated.execute(task)
    const absentFrames = framesTo(submitter, alice.peerId, beforeAbsent)

    expect(absent.ok).toBe(false)
    if (absent.ok) return
    // `describeFailure`'s own text, passed through untouched — `agent.ts:419` adds the
    // prefix and `remote-executor.ts:139` returns the outcome verbatim. An assertion
    // here must never be satisfied by rewording a message in `capability.ts`.
    expect(absent.reason).toContain('unauthorized:')
    expect(absent.reason).toContain('no capability chain supplied')
    // The half of criterion 2 that names **no** link, and cannot: an empty chain has no
    // link to index, and `capability.ts:104` produces that literal and nothing more.
    // Asserted as an absence only because the expired case below shows the same
    // instrument producing an index.
    expect(absent.reason).not.toContain('link ')
    expect(alice.child.exitCode).toBeNull()
    expect(await blockNames(alice.dir)).not.toContain(moduleCid.toString())

    const beforeExpired = submitter.egress.manifest.entries.length
    const expired = await stale.execute(task)
    const expiredFrames = framesTo(submitter, alice.peerId, beforeExpired)

    expect(expired.ok).toBe(false)
    if (expired.ok) return
    expect(expired.reason).toContain('unauthorized:')
    expect(expired.reason).toContain('expired at')
    // The index survived the whole trip: minted here, encoded, parsed in another
    // process, judged there, and named in a string this process reads back.
    expect(expired.reason).toContain('link 0')
    expect(alice.child.exitCode).toBeNull()
    expect(await blockNames(alice.dir)).not.toContain(moduleCid.toString())

    // The control, ordered last so neither refusal can be explained by a child that had
    // already stopped serving. One argument changes: the chain.
    const beforeControl = submitter.egress.manifest.entries.length
    const control = await valid.execute(task)
    const controlFrames = framesTo(submitter, alice.peerId, beforeControl)

    expect(control.ok).toBe(true)
    expect(await blockNames(alice.dir)).toContain(moduleCid.toString())

    // The same relation the first case reads, so "refused before instantiation" has the
    // same reading behind it here. Recorded as measured; no literal is asserted.
    expect(absentFrames).toBeGreaterThanOrEqual(1)
    expect(expiredFrames).toBeGreaterThanOrEqual(1)
    expect(absentFrames).toBeLessThan(controlFrames)
    expect(expiredFrames).toBeLessThan(controlFrames)

    console.log(
      `[criterion 2] frames to child — absent: ${absentFrames}, expired: ${expiredFrames}, control: ${controlFrames}`,
    )
  }, 120_000)

  it('criterion 3: a delegated two-link chain is accepted while one re-delegated without the right and one whose second link is issued by a third party are both refused, and the accepted output matches a local reference', async () => {
    const { alice, submitter, moduleCid, referenceInputCid, task } = await setUp('criterion-3')

    const delegated = delegatedChainFor(alice.peerId)
    const undelegable = undelegableChainFor(alice.peerId)
    const broken = brokenLinkChainFor(alice.peerId)

    // **Before any of them is dispatched.** This trio is the whole point: all three are
    // length 2, all three survive the wire, and all three carry real signatures. They
    // differ from the accepted chain in exactly one thing each — one ability string, and
    // one issuer — so a check that counted links would accept all three, and only a
    // check of the chain's *structure* can tell them apart. Drop these assertions and
    // what remains proves only that a two-link chain sometimes fails.
    for (const chain of [delegated, undelegable, broken]) {
      expect(chain).toHaveLength(2)
      const frame = parseRequest(encodeRequest({ kind: 'exec', task, capability: chain }))
      expect(frame).not.toBeNull()
      if (frame === null || frame.kind !== 'exec') throw new Error('chain did not survive the wire')
      expect(frame.capability).toHaveLength(2)
    }

    const withChain = (chain: readonly Delegation[]): RemoteExecutor =>
      new RemoteExecutor(alice.peerId, submitter.rpc, () => chain)

    // Refused for **depth**: the coordinator holds `execute` and not `delegate`, and
    // re-delegated anyway. Decision 8's sharpest reading — one ability string apart from
    // the accepted chain.
    const depth = await withChain(undelegable).execute(task)
    expect(depth.ok).toBe(false)
    if (depth.ok) return
    expect(depth.reason).toContain('unauthorized:')
    expect(depth.reason).toContain('was re-delegated, but its issuer was never granted')
    expect(alice.child.exitCode).toBeNull()
    expect(await blockNames(alice.dir)).not.toContain(moduleCid.toString())

    // Refused for a **broken delegation link** — the failure kind ROADMAP criterion 3
    // names in its own words. `broken-link` is a named `ChainFailure` kind
    // (`capability.ts:92`) with its own text (`:108`) reached at `:162-167`. Decision 8
    // was right that `not-delegable` proves depth most sharply and wrong to conclude the
    // other could therefore be dropped: without this dispatch the kind the criterion
    // literally names would never cross a wire in this repository, and an auditor
    // checking criterion 3 against the source would correctly conclude it had been
    // answered with a different mechanism. Both are dispatched; neither substitutes for
    // the other.
    const link = await withChain(broken).execute(task)
    expect(link.ok).toBe(false)
    if (link.ok) return
    expect(link.reason).toContain('unauthorized:')
    expect(link.reason).toContain('is issued by')
    expect(link.reason).toContain('delegated to')
    expect(link.reason).toContain('link 1')
    expect(alice.child.exitCode).toBeNull()
    expect(await blockNames(alice.dir)).not.toContain(moduleCid.toString())

    // Accepted, and ordered last so the two refusals cannot be explained by a child that
    // had already stopped serving.
    const beforeAccepted = submitter.egress.manifest.entries.length
    const accepted = await withChain(delegated).execute(task)
    const afterAccepted = submitter.egress.manifest.entries.length

    expect(accepted.ok).toBe(true)
    if (!accepted.ok) return
    expect(await blockNames(alice.dir)).toContain(moduleCid.toString())

    // The single-node reference. Over the **public** row already in the submitter's own
    // store, never over the sovereign `inputCid` — see this file's header, section 4.
    // `store` is the local tier, not the `FetchingBlockstore`, so this reading is about
    // bytes that are here rather than bytes that could be got.
    expect(await submitter.store.has(referenceInputCid)).toBe(true)

    const referenceTask: Task = {
      moduleCid,
      moduleRecord: recordFor('capability-dispatch-reference', moduleCid),
      inputCid: referenceInputCid,
      partitionIndex: PARTITION_INDEX,
      partitionCount: PARTITION_COUNT,
      label: 'public',
    }
    const reference = await submitter.executor.execute(referenceTask)
    const afterReference = submitter.egress.manifest.entries.length

    expect(reference.ok).toBe(true)
    if (!reference.ok) return
    expect(reference.output).toEqual(accepted.output)

    // The pair that turns "the reference ran locally" from a claim into a measurement.
    // The first is the positive control — without it, "no new frames" is equally well
    // explained by a manifest nobody is writing to. An assertion of the form "nothing
    // happened" is worth nothing in this repository unless the same instrument is shown,
    // in the same case, recording something.
    expect(afterAccepted).toBeGreaterThan(beforeAccepted)
    expect(afterReference).toBe(afterAccepted)
  }, 120_000)
})
