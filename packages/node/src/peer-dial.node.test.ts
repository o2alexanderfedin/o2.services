import { spawn } from 'node:child_process'
import type { ChildProcessByStdio } from 'node:child_process'
import type { Readable, Writable } from 'node:stream'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ed25519 } from '@noble/curves/ed25519.js'
import { canonicalCid, signName, toHex } from '@o2/core'
import type { ExecutionOutcome, NameRecord, NodeCertificate, Task } from '@o2/core'
import { SEED_BYTES } from '@o2/libp2p'
import { RemoteExecutor } from '@o2/net'
import type { CID } from 'multiformats/cid'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
// Test-only relative import — see the note in packages/net/src/distributed.test.ts.
import { MODULE_ECHOES_INPUT } from '../../core/src/executor/fixtures.ts'
import { FabricNode } from './fabric-node.ts'
import { FsBlockstore } from './fs-blockstore.ts'

/**
 * AUTH-02's **accepting** half, across a real process boundary — and SCHED-06's slot
 * limit reaching a spawned process for the first time.
 *
 * `certificate-verification.node.test.ts` records the gap this file closes, in its own
 * words: criterion 2's accepting side is *"UNMEASURED through `bin/agent.ts`"*, because a
 * verifier has to be connected to the peer it verifies and that binary had no flag making
 * a spawned agent dial anything. `--peer-addr` is that flag. This file is the reading it
 * makes possible.
 *
 * ## What is measured here, and through which instrument
 *
 * Acceptance is measured through **the one production consumer of `verifiedPeers` there
 * is**: `RpcBlockSource.fetch`, reached from a node's `FetchingBlockstore` while it
 * executes a task (`fabric-node.ts:1138`). A node that accepts a dialled peer can fetch a
 * block held only by that peer, so the task runs; a node that refuses it cannot, so the
 * identical task fails. The bytes exist in exactly one place — A's blockstore directory,
 * written there before A was spawned — so there is no second route to them.
 *
 * Dispatch candidate selection and quorum membership are still **not** gated on
 * `verifiedPeers`. That stays **unmeasured**, not descoped: there is no production caller
 * to gate until this phase's placement work, and Plan 18-05 owns whether the caller it
 * adds reads the verified subset.
 *
 * ## This file does not read a verdict, and that is deliberate
 *
 * `verdictFor` does not cross a process boundary and this phase adds no frame that would
 * carry one. The reading taken is therefore the **consequence**, and two controls are what
 * make it a reading rather than an assumption:
 *
 * - **W** — the negative control. It dials the identical peer over the identical wire and
 *   pins a *different* issuer. Its dispatch is byte-identical to V's. If W succeeded, "V
 *   accepted A" would be indistinguishable from "the bytes were reachable anyway".
 * - **U** — the no-anchor control. It dials the identical peer and pins nobody, so it
 *   verifies nobody and treats every connected peer as usable
 *   (`FabricNodeOptions.trustedIssuers`' doc). If U failed, "V succeeded" would be
 *   indistinguishable from "the dial itself is what made the fetch work".
 *
 * ## The one poll, and why it is not papering over a race
 *
 * A verdict is an asynchronous records round trip kicked off from `peer:connect`. The
 * handshake line proves the *connection* happened — it is written after the dials — but
 * says nothing about whether a verdict has landed. So V's reading is taken under a poll
 * with a stated deadline, exactly as `peer-gate.node.test.ts` polls `verdictFor` for the
 * same reason, and W's and U's readings are taken **after** V's has succeeded. That
 * ordering is what stops "W failed" from meaning "W was not ready yet": W dialled A in the
 * same window V did, so a verdict that has landed on V has had at least as long to land on
 * W.
 *
 * Retrying V's dispatch is sound rather than a workaround, and `fabric-node.ts:1133-1137`
 * says why in advance: the block source is a thunk read *per fetch*, so "a retry after the
 * verdict lands succeeds without reconnecting and with no invalidation step anywhere."
 */

const AGENT = fileURLToPath(new URL('./bin/agent.ts', import.meta.url))

/**
 * The announce budget and the verdict budget, both taken from
 * `certificate-verification.node.test.ts`'s own constants rather than invented here. That
 * file sized them against a spawn plus a real cross-process records round trip, which is
 * the identical shape this file waits on.
 */
const ANNOUNCE_BUDGET_MS = 60_000
const VERDICT_DEADLINE_MS = 30_000

/**
 * The build authority every spawned agent in this file pins, so a dispatch is refused for
 * the reason under test rather than for provenance.
 *
 * Seed 59 — distinct from every other fixture key in the repository (51 in `two-process`,
 * 53 in `egress-refusal`, 57 in `certificate-verification`).
 */
const publisher = (() => {
  const priv = new Uint8Array(SEED_BYTES).fill(59)
  return { priv, pub: toHex(ed25519.getPublicKey(priv)) }
})()

/**
 * A well-formed issuer key nobody holds — 64 lowercase hex characters, so it survives
 * `bin/agent.ts`'s `--trusted-issuer` validator and is refused for the reason under test
 * rather than for its shape.
 */
const UNHELD_ISSUER = 'ab'.repeat(32)

function recordFor(name: string, moduleCid: CID): NameRecord {
  return signName(publisher.priv, { name, cid: moduleCid, version: 1, expiresAt: Date.now() + 3_600_000 })
}

/**
 * fd 0 is a pipe, so the child's type carries `Writable` for it.
 *
 * Not a stylistic choice: the agent's orphan leash arms only when fd 0 is a socket or a
 * FIFO, and `'ignore'` hands it `/dev/null` — a character device that returns EOF at once,
 * and the same shape as an operator's terminal. A spawned agent whose stdin is ignored
 * outlives a SIGKILLed parent for ever. See `orphan-leash.node.test.ts`.
 */
type AgentProcess = ChildProcessByStdio<Writable, Readable, Readable>

interface Handshake {
  readonly peerId: string
  readonly multiaddrs: string[]
  readonly trustAnchors: string[]
  readonly nodeKey: string
  readonly certificate: NodeCertificate | null
  readonly issuerKey: string | null
  readonly peers: string[]
}

interface Agent extends Handshake {
  readonly dir: string
  readonly child: AgentProcess
}

/** What a process that never announced did instead. */
interface Refusal {
  readonly code: number | null
  readonly stdout: string
  readonly stderr: string
}

let workdir: string
const agents: Agent[] = []
const nodes: FabricNode[] = []

/**
 * Wait until `predicate` holds, or fail after `timeoutMs`.
 *
 * Local to this file and **exported nowhere**, which is deliberate: importing a symbol from
 * a `.test.ts` executes that file's module body inside the importing file's collection, so
 * the whole of the imported suite would be registered and run a second time. The repository
 * settles this by duplication — the identical signature is defined locally in
 * `relaying.node.test.ts`, `relayed-job.node.test.ts`, `rendezvous-wire.node.test.ts`,
 * `peer-gate.node.test.ts` and `certificate-verification.node.test.ts`.
 */
async function until(predicate: () => Promise<boolean>, timeoutMs: number, what: string): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let last = ''
  while (Date.now() < deadline) {
    try {
      if (await predicate()) return
    } catch (cause) {
      last = cause instanceof Error ? cause.message : String(cause)
    }
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error(`timed out waiting for ${what}${last === '' ? '' : `; last error: ${last}`}`)
}

async function spawnAgent(name: string, extraArgs: readonly string[] = []): Promise<Agent> {
  const dir = join(workdir, name)
  const child: AgentProcess = spawn(
    process.execPath,
    [AGENT, '--dir', dir, '--trust-anchor', publisher.pub, ...extraArgs],
    // fd 0 must be a pipe, not `'ignore'`: the agent's orphan leash arms only on a
    // socket or FIFO, and `'ignore'` gives it `/dev/null`, which returns EOF at once.
    // See `orphan-leash.node.test.ts`, whose source guard fails this file otherwise.
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

  const agent: Agent = { ...handshake, dir, child }
  agents.push(agent)
  return agent
}

/**
 * Spawn an agent that is **expected** to refuse, and report what it printed on each stream.
 *
 * Separate from `spawnAgent` rather than a flag on it, because the two want opposite
 * outcomes and a shared helper would have to decide which of them is an error. This one
 * resolves on exit and rejects if the process announces instead — so "it started anyway" is
 * a named failure rather than a hang.
 */
async function spawnRefusal(name: string, extraArgs: readonly string[]): Promise<Refusal> {
  const child: AgentProcess = spawn(
    process.execPath,
    [AGENT, '--dir', join(workdir, name), '--trust-anchor', publisher.pub, ...extraArgs],
    // fd 0 must be a pipe, not `'ignore'`: the agent's orphan leash arms only on a
    // socket or FIFO, and `'ignore'` gives it `/dev/null`, which returns EOF at once.
    // See `orphan-leash.node.test.ts`, whose source guard fails this file otherwise.
    { stdio: ['pipe', 'pipe', 'pipe'] },
  )
  return new Promise<Refusal>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`agent ${name} neither announced nor exited within the budget`)),
      ANNOUNCE_BUDGET_MS,
    )
    let stdout = ''
    let stderr = ''
    const done = (error: Error): void => {
      clearTimeout(timer)
      child.kill('SIGKILL')
      reject(error)
    }
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
      // **Fail fast, and name what happened.** A whole handshake line means the process
      // started a node instead of refusing — which is the defect these tests exist to
      // catch, and waiting out the announce budget to report it as an anonymous timeout
      // would hide the one fact a reader of a red run needs. The line is quoted back,
      // because `peers: []` for an address that was never reached is the exact silent
      // absence the refusal prevents.
      if (stdout.includes('\n')) {
        done(
          new Error(
            `agent ${name} announced instead of refusing: ${stdout.slice(0, stdout.indexOf('\n'))}`,
          ),
        )
      }
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr })
    })
  })
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

async function startNode(name: string): Promise<FabricNode> {
  const node = await FabricNode.start({
    blockstoreDir: join(workdir, name),
    listen: ['/ip4/127.0.0.1/tcp/0'],
    rpcTimeoutMs: 10_000,
    trustAnchors: [publisher.pub],
  })
  nodes.push(node)
  return node
}

/** Write a user key file. `bin/agent.ts` refuses to create one — see that flag's comment. */
async function writeUserKey(name: string, seed: Uint8Array): Promise<string> {
  await mkdir(workdir, { recursive: true })
  const path = join(workdir, `${name}.key`)
  await writeFile(path, seed, { mode: 0o600 })
  return path
}

const A_USER_SEED = new Uint8Array(SEED_BYTES).fill(0x91)

beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'o2-peer-dial-'))
})

/**
 * Inner 10 s, outer 40 s — the order is the point, and the reasoning is
 * `certificate-verification.node.test.ts`'s. `stopAgent` gives a wedged process 10 s before
 * SIGKILL and this hook may be waiting on five of them; vitest's default `hookTimeout` is
 * also 10 s, so with no explicit budget the framework's clock fires first, the SIGKILL
 * fallback never runs, and a wedged agent is reported as an anonymous hook timeout naming
 * no step.
 */
afterEach(async () => {
  await Promise.all(nodes.splice(0).map((n) => n.stop().catch(() => {})))
  await Promise.all(agents.splice(0).map((a) => stopAgent(a).catch(() => {})))
  await rm(workdir, { recursive: true, force: true })
}, 40_000)

describe('AUTH-02 — a spawned agent dials a peer and accepts it', () => {
  /**
   * One test, because every reading in it is a precondition for the next. A refusal from W
   * means nothing unless V succeeded over the same bytes on the same wire, and V's success
   * means nothing unless V is demonstrably connected to A.
   *
   * The module and the input are written into A's blockstore directory with `FsBlockstore`
   * **before A is spawned**, so the bytes exist on exactly one node in the world. Neither V
   * nor W nor U nor the submitter has a local copy, and the only route to them is A.
   */
  it('fetches a block held only by the dialled peer, refuses the identical dispatch when it pins another issuer, and succeeds when it pins nobody', async () => {
    const aUserKey = await writeUserKey('a-user', A_USER_SEED)

    // Seeded before the spawn, into the directory A will be started on.
    const aStore = await FsBlockstore.open(join(workdir, 'a'))
    const moduleCid = await aStore.put(MODULE_ECHOES_INPUT)
    const input = await canonicalCid({ a: 1 })
    if (!input.ok) throw new Error('fixture not encodable')
    await aStore.put(input.bytes)

    const p = await spawnAgent('p', ['--issues-certificates'])
    expect(p.issuerKey).not.toBeNull()

    const a = await spawnAgent('a', [
      '--provider-addr', p.multiaddrs[0] as string,
      '--user-key', aUserKey,
      '--operator-id', 'harbour-ops',
    ])
    expect(a.certificate?.issuer).toBe(p.issuerKey)
    // A is the peer being dialled and is not itself dialling anybody: `peers` is a stated
    // `[]`, not an absent field. The distinction is the module comment's own rule, and
    // `toStrictEqual` is what tells the two apart — `toEqual` treats `undefined` as `[]`.
    expect(a.peers).toStrictEqual([])

    const aAddr = a.multiaddrs[0] as string

    // Three agents that differ in exactly one argument each, all dialling the same peer.
    const v = await spawnAgent('v', ['--trusted-issuer', p.issuerKey as string, '--peer-addr', aAddr])
    const w = await spawnAgent('w', ['--trusted-issuer', UNHELD_ISSUER, '--peer-addr', aAddr])
    const u = await spawnAgent('u', ['--peer-addr', aAddr])

    // **The precondition, read off the handshake line rather than assumed.** Asserted
    // before anything is dispatched, because "the block did not arrive" is worthless from a
    // node that never connected. The line is written after the dials, so a parent holding
    // it is reading a completed peering.
    //
    // Compared against A's **peer id**, read from A's own handshake line, and not against
    // the address string that was passed. The address does contain `/p2p/<peerId>` — so the
    // peer id is not absent from it — but the field is required to hold the bare id a
    // `Connection` reported, which an echo of the configured string could not satisfy.
    expect(v.peers).toStrictEqual([a.peerId])
    expect(w.peers).toStrictEqual([a.peerId])
    expect(u.peers).toStrictEqual([a.peerId])

    // The provider is stopped and waited for before any verdict is reached, so "the
    // authority was still answering" is not an available explanation for V's acceptance.
    await stopAgentNow(p)
    expect(p.child.exitCode !== null || p.child.signalCode !== null).toBe(true)

    // The submitter holds neither the module nor the input — it only knows their CIDs,
    // because it computed them by writing into A's directory above. So a node that runs
    // this task fetched both from A.
    const client = await startNode('client')
    await client.dial(v.multiaddrs[0] as string)
    await client.dial(w.multiaddrs[0] as string)
    await client.dial(u.multiaddrs[0] as string)

    const task: Task = {
      moduleCid,
      inputCid: input.cid,
      partitionIndex: 0,
      partitionCount: 1,
      label: 'public',
      moduleRecord: recordFor('peer-dial-echo', moduleCid),
    }

    const dispatchTo = async (peerId: string): Promise<ExecutionOutcome> =>
      new RemoteExecutor(peerId, client.rpc, 'dispatches-unauthenticated').execute(task)

    // V's reading is taken under a poll, because a verdict is asynchronous and the
    // handshake line proves only the connection. See the header for why a retry is sound
    // here rather than a workaround.
    let vOutcome = await dispatchTo(v.peerId)
    await until(
      async () => {
        if (vOutcome.ok) return true
        vOutcome = await dispatchTo(v.peerId)
        return vOutcome.ok
      },
      VERDICT_DEADLINE_MS,
      "V to accept A and fetch the module from it",
    )

    // **Acceptance, measured as its consequence.** V verified A's provider-signed
    // certificate offline, accepted it, fetched a module and an input that exist nowhere
    // else, and ran the task — read as the echoed input rather than as a bare `ok`, so a
    // node that answered success without executing would not pass.
    expect(vOutcome).toMatchObject({ ok: true, output: { a: 1 } })

    // W's and U's readings are taken **after** V's succeeded, so "not ready yet" is not an
    // available explanation for W's failure: W dialled A in the same window V did.
    const wOutcome = await dispatchTo(w.peerId)
    const uOutcome = await dispatchTo(u.peerId)

    // The negative control. Byte-identical dispatch, same wire, same peer dialled — and it
    // fails, because W pins an issuer A's certificate does not chain to.
    expect(wOutcome.ok).toBe(false)

    // **The refusal names a fetch that could not be made, not a certificate.** W is
    // refusing *A*; the symptom V's success rules out is "the module was never fetchable at
    // all". Asserted by text and not only by `false`, because a refusal naming the wrong
    // thing is a defect even when the dispatch correctly fails — this could equally have
    // failed for want of provenance, for a dead process, or on a timeout.
    const wReason = wOutcome.ok === false ? wOutcome.reason : ''
    expect(wReason).toContain('block missing')
    expect(wReason).toContain(moduleCid.toString())

    // The no-anchor control. A node that pins nobody verifies nobody and treats every
    // connected peer as usable, so it fetches from A over the identical connection. This is
    // what distinguishes "V accepted A" from "the dial itself is what made the fetch work".
    expect(uOutcome).toMatchObject({ ok: true, output: { a: 1 } })

    // "The process died" is not an available explanation for any of the three readings.
    for (const agent of [a, v, w, u]) {
      expect(agent.child.exitCode).toBeNull()
      expect(agent.child.signalCode).toBeNull()
    }
  }, 180_000)

  /**
   * A dial that cannot be made stops the process, rather than producing a node that
   * silently has no peers — the same disposition `--provider-addr` takes, for the reason
   * its own doc gives.
   *
   * **No handshake line at all** is half the reading. A process that printed a line and
   * then died would still be a process a parent could read `peers: []` from, which is the
   * exact silent absence this refusal exists to prevent.
   */
  it('stops with a named reason and prints no handshake line when a --peer-addr cannot be dialled', async () => {
    // Port 1 on loopback: nothing listens there, and the refusal comes back promptly as
    // ECONNREFUSED rather than as a timeout.
    const refusal = await spawnRefusal('unreachable', ['--peer-addr', '/ip4/127.0.0.1/tcp/1'])

    expect(refusal.code).not.toBe(0)
    // Nothing on stdout: a parent waiting for the handshake gets the process's death, not a
    // line describing a node with no peers.
    expect(refusal.stdout).toBe('')
    // The **text**, naming the flag and the value that was refused, so an operator who
    // passed several does not have to guess which one failed.
    expect(refusal.stderr).toContain('--peer-addr /ip4/127.0.0.1/tcp/1 could not be dialled')
    // ...and the usage line still follows the reason, which is `refuse`'s stated contract.
    expect(refusal.stderr).toContain('usage: agent.ts')
  }, 120_000)

  /**
   * A malformed multiaddr takes the same exit, through the same catch, with no second
   * validator anywhere in the binary — which is the decision recorded beside the
   * `--trusted-issuer` loop. Without this reading, "there is no format validator" would be
   * an assertion about the source rather than about the behaviour.
   */
  it('refuses a malformed multiaddr through the same named refusal, with no separate validator', async () => {
    const refusal = await spawnRefusal('malformed', ['--peer-addr', 'not-a-multiaddr'])

    expect(refusal.code).not.toBe(0)
    expect(refusal.stdout).toBe('')
    expect(refusal.stderr).toContain('--peer-addr not-a-multiaddr could not be dialled')
  }, 120_000)
})

describe('SCHED-06 — the slot limit reaches a spawned agent', () => {
  /**
   * `FabricNodeOptions.maxConcurrentTasks` exists so a refusal can be **observed** rather
   * than hoped for — its own doc says so. Until `--max-concurrent-tasks` existed that
   * argument only reached callers inside one process, so no later phase could make a
   * spawned agent refuse on purpose.
   *
   * Both readings are in one test, because a refusal from the one-slot agent means nothing
   * unless the identical pair of dispatches was answered by an agent that differs from it
   * in exactly one flag.
   *
   * **Distinct `inputCid`s are load-bearing**, and the reason is easy to get wrong: the
   * exec slot key is derived from `inputCid` plus `partitionIndex`, because an `exec` frame
   * carries no shard id. With one shared input the two requests would collide on the same
   * key and the reply would read `already in flight here` — the dedupe branch, not the
   * over-committed branch under test. If the reason-string assertion below ever fails,
   * check these are still distinct before changing anything else.
   */
  it('refuses a concurrent dispatch with its own words when spawned with --max-concurrent-tasks 1, while an agent without the flag answers both', async () => {
    const oneSlot = await spawnAgent('one-slot', ['--max-concurrent-tasks', '1'])
    const unbounded = await spawnAgent('unbounded')

    // Held by the submitter alone, so each agent must pull both blocks over the wire before
    // it can run anything — which is what keeps the first dispatch occupying its slot while
    // the second arrives.
    const client = await startNode('slot-client')
    await client.dial(oneSlot.multiaddrs[0] as string)
    await client.dial(unbounded.multiaddrs[0] as string)

    const moduleCid = await client.store.put(MODULE_ECHOES_INPUT)
    const first = await canonicalCid({ a: 1 })
    const second = await canonicalCid({ a: 2 })
    if (!first.ok || !second.ok) throw new Error('fixture not encodable')
    await client.store.put(first.bytes)
    await client.store.put(second.bytes)
    expect(first.cid.toString()).not.toBe(second.cid.toString())

    const record = recordFor('peer-dial-slots', moduleCid)
    const taskFor = (inputCid: CID): Task => ({
      moduleCid,
      inputCid,
      partitionIndex: 0,
      partitionCount: 1,
      label: 'public',
      moduleRecord: record,
    })

    const bothTo = async (peerId: string): Promise<ExecutionOutcome[]> => {
      const executor = new RemoteExecutor(peerId, client.rpc, 'dispatches-unauthenticated')
      return Promise.all([executor.execute(taskFor(first.cid)), executor.execute(taskFor(second.cid))])
    }

    // The paired positive control, taken first so an inert instrument cannot pass: an agent
    // spawned with no slot flag takes `DEFAULT_MAX_CONCURRENT_TASKS` and answers both.
    // Measured as the echoed input rather than as a bare `ok`, so a node that answered
    // success without executing would not pass either half.
    const [uA, uB] = await bothTo(unbounded.peerId)
    expect(uA).toMatchObject({ ok: true, output: { a: 1 } })
    expect(uB).toMatchObject({ ok: true, output: { a: 2 } })

    const outcomes = await bothTo(oneSlot.peerId)

    // Exactly one of the pair is refused. The other runs, which is what says the agent is
    // serving rather than refusing everything.
    const refused = outcomes.filter((o) => !o.ok)
    const ran = outcomes.filter((o) => o.ok)
    expect(ran).toHaveLength(1)
    expect(refused).toHaveLength(1)

    // **The text, composed by `LocalCapacity` inside the spawned process and carried back
    // over a real TCP + noise + yamux connection.** Asserted by text and not by kind: this
    // dispatch could equally have failed for want of a block, on a timeout, or on the
    // dedupe branch, all of which satisfy a bare `ok === false`. `1 of 1` is the value that
    // says the flag arrived — a node that ignored it would say `1 of 64`.
    const reason = refused[0]?.ok === false ? refused[0].reason : ''
    expect(reason).toContain('over-committed: 1 of 1 slots in use')

    // "The process died" is not an available explanation for the refusal.
    expect(oneSlot.child.exitCode).toBeNull()
    expect(oneSlot.child.signalCode).toBeNull()
  }, 180_000)

  /**
   * A nonsense limit is exit 2 at the binary, **not** a clamp.
   *
   * `LocalCapacity`'s own `RangeError` guard exists to be reached, and sanitising an
   * operator's mistake at the binary would turn it into a silently different node. The
   * value is named back, so an operator reads which input was rejected.
   */
  it('refuses a --max-concurrent-tasks below 1 by name and by value, rather than clamping it', async () => {
    const refusal = await spawnRefusal('zero-slots', ['--max-concurrent-tasks', '0'])

    expect(refusal.code).toBe(2)
    expect(refusal.stdout).toBe('')
    expect(refusal.stderr).toContain('--max-concurrent-tasks 0 is not an integer of at least 1')
  }, 120_000)

  /**
   * ...and the same for a value that is not an integer at all, which `Number` reads as NaN
   * rather than as a number out of range. Two different ways of being wrong, one refusal.
   */
  it('refuses a --max-concurrent-tasks that is not a number', async () => {
    const refusal = await spawnRefusal('nan-slots', ['--max-concurrent-tasks', 'plenty'])

    expect(refusal.code).toBe(2)
    expect(refusal.stdout).toBe('')
    expect(refusal.stderr).toContain('--max-concurrent-tasks plenty is not an integer of at least 1')
  }, 120_000)
})
