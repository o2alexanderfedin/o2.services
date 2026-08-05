import { spawn } from 'node:child_process'
import type { ChildProcessByStdio } from 'node:child_process'
import type { Readable, Writable } from 'node:stream'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ed25519 } from '@noble/curves/ed25519.js'
import { canonicalCid, signName, toHex } from '@o2/core'
import type { NameRecord, NodeCertificate, Task } from '@o2/core'
import { SEED_BYTES } from '@o2/libp2p'
import { RemoteExecutor } from '@o2/net'
import type { CID } from 'multiformats/cid'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
// Test-only relative import — see the note in packages/net/src/distributed.test.ts.
import { MODULE_ECHOES_INPUT } from '../../core/src/executor/fixtures.ts'
import { FabricNode } from './fabric-node.ts'
import { FsBlockstore } from './fs-blockstore.ts'

/**
 * AUTH-02 — criterion 2, across real `bin/agent.ts` processes, with the authorities dead.
 *
 * ROADMAP criterion 2: *"A **second** node started via `bin/agent.ts` verifies the first
 * node's certificate **offline**, with no live call to any certificate authority, before
 * treating it as a legitimate peer — and rejects a self-signed or forged certificate
 * **with a named reason**."*
 *
 * ## "Offline, with no live call" is falsified here, not argued
 *
 * Both provider processes are sent SIGTERM and **waited for** before the verifier exists.
 * A node that then reaches a verdict demonstrably contacted nobody, because there was
 * nobody to contact. That is strictly stronger than instrumenting a call count — a counter
 * measures the code path somebody thought to instrument, and a dead process measures every
 * path there is — and it is the technique Plan 17-03 used to prove certificate reuse.
 *
 * ## The half of criterion 2 this file cannot reach — closed elsewhere, since Phase 18
 *
 * The **verifying** node below is a `FabricNode` in the test process, not a spawned one,
 * and this file measures criterion 2's accepting side in process only.
 *
 * When this file was written `bin/agent.ts` had **no flag that made a spawned agent dial
 * another agent** — the only outbound dial it could be told to make was `--provider-addr`,
 * which also enrols — and a verifier has to be connected to the peers it verifies. So the
 * accepting side was recorded here as **UNMEASURED through `bin/agent.ts`**, in that word,
 * and the remedy named was a dial-address flag on the binary.
 *
 * **Plan 18-01 added it, and the reading is now taken.** `--peer-addr` makes a spawned
 * agent dial a named peer, and `packages/node/src/peer-dial.node.test.ts` measures a
 * spawned node accepting a dialled peer's provider-signed certificate — through
 * `RpcBlockSource`, over a block that exists in exactly one blockstore, with a
 * different-issuer negative control and a no-anchor control on the same wire. This file's
 * in-process reading is retained rather than deleted: it is the one that kills both
 * authorities first, which the cross-process file does not do for its no-anchor control.
 *
 * What **is** measured across a real process boundary is `--trusted-issuer` itself and the
 * fail-closed gate it turns on: the last test spawns one agent with the flag and one
 * without, connects both to a node that can never be verified by anybody, dispatches the
 * identical task to each, and reads opposite outcomes.
 *
 * ## What this file proves and what it leaves to others
 *
 * It proves the *consequence* across a process boundary. The mechanism-level proofs live
 * in `peer-verifier.node.test.ts` (every failure kind, against real and synthetic peers)
 * and `packages/net/src/enrol-protocol.test.ts` (the literal self-signed shape,
 * `issuer === nodeKey`, refused at the wire). Neither half is asked to carry the other.
 *
 * **"Before treating it as a legitimate peer" means block fetching and nothing else this
 * phase**, because `RpcBlockSource.fetch` is the only production consumer of
 * `verifiedPeers` there is. Dispatch candidate selection, quorum membership and relay use
 * are **unmeasured**, not descoped: there is no production caller to gate until Phase 18's
 * placement work, and inventing one here to have something to gate would be this
 * milestone's own defect committed in the opposite direction.
 */

const AGENT = fileURLToPath(new URL('./bin/agent.ts', import.meta.url))

/**
 * The announce budget, sized the same way and for the same reason as
 * `enrollment.node.test.ts`'s — see that file's constant for the readings it was set from.
 */
const ANNOUNCE_BUDGET_MS = 60_000

/**
 * How long a verdict gets to land.
 *
 * **Longer than `peer-gate.node.test.ts`'s 15 s, deliberately**, and the shape is copied
 * from that file rather than imported from it. The round trip here crosses a real process
 * boundary — B asks a spawned agent for its records over TCP and that process answers from
 * its own event loop — so the window is wider, not different.
 */
const VERDICT_DEADLINE_MS = 30_000

/**
 * Wait until `predicate` holds, or fail after `timeoutMs`.
 *
 * Local to this file and **exported nowhere**, which is deliberate: importing a symbol from
 * a `.test.ts` executes that file's module body inside the importing file's collection, so
 * the whole of `peer-gate.node.test.ts` would be registered and run a second time here. The
 * repository already settles it the same way — the identical signature is defined locally in
 * `relaying.node.test.ts`, `relayed-job.node.test.ts`, `rendezvous-wire.node.test.ts` and
 * `peer-gate.node.test.ts` — and
 * `grep -rn "from '\./[A-Za-z0-9._-]*\.test\.ts'" packages/ --include="*.ts"` finds no match
 * anywhere in the repository.
 */
async function until(predicate: () => boolean, timeoutMs: number, what: string): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((r) => setTimeout(r, 20))
  }
  throw new Error(`timed out waiting for ${what}`)
}

/**
 * The build authority every spawned agent in this file pins, so a dispatch can be refused
 * for the reason under test rather than for provenance.
 *
 * DET-03 is not this file's subject; the verification gate is. Seed 57 — distinct from
 * every other fixture key in the repository (51 in `two-process`, 53 in `egress-refusal`).
 */
const publisher = (() => {
  const priv = new Uint8Array(SEED_BYTES).fill(57)
  return { priv, pub: toHex(ed25519.getPublicKey(priv)) }
})()

function recordFor(name: string, moduleCid: CID): NameRecord {
  return signName(publisher.priv, { name, cid: moduleCid, version: 1, expiresAt: Date.now() + 3_600_000 })
}

/**
 * stdin is piped and never written to, so the child's type carries a `Writable` for it.
 *
 * The pipe is the point rather than the type: `bin/agent.ts` watches fd 0 and leaves when
 * it closes, which is what stops a spawned agent outliving a parent that was killed rather
 * than asked. Handing it `ignore` would put `/dev/null` on fd 0 and silently opt this file
 * out. See `orphan-leash.node.test.ts`, which demonstrates it and guards this line.
 */
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

async function startNode(name: string, options: { trustedIssuers?: readonly string[] } = {}): Promise<FabricNode> {
  const node = await FabricNode.start({
    relayAdmission: 'admits-any-peer',
    blockstoreDir: join(workdir, name),
    listen: ['/ip4/127.0.0.1/tcp/0'],
    rpcTimeoutMs: 10_000,
    trustAnchors: [publisher.pub],
    ...(options.trustedIssuers === undefined ? {} : { trustedIssuers: options.trustedIssuers }),
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

const A_USER_SEED = new Uint8Array(SEED_BYTES).fill(0x81)
const C_USER_SEED = new Uint8Array(SEED_BYTES).fill(0x82)

beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'o2-certverify-'))
})

/**
 * Inner 10 s, outer 40 s — and the order is the point.
 *
 * `stopAgent` gives a wedged process 10 s before SIGKILL and this hook may be waiting on
 * four of them plus two in-process nodes. Vitest's default `hookTimeout` is also 10 s, so
 * with no explicit budget the two clocks are armed for the same instant, the framework's
 * fires first, the SIGKILL fallback can never run, and a wedged agent is reported as an
 * anonymous hook timeout naming no step. A test arms two clocks and the framework's must be
 * the larger.
 */
afterEach(async () => {
  await Promise.all(nodes.splice(0).map((n) => n.stop().catch(() => {})))
  await Promise.all(agents.splice(0).map((a) => stopAgent(a).catch(() => {})))
  await rm(workdir, { recursive: true, force: true })
}, 40_000)

describe('AUTH-02 — criterion 2, with both provider processes dead', () => {
  /**
   * One test, because every reading in it is a precondition for the next: an unnamed
   * refusal cannot be shown to be about a *connected* peer, and a gate cannot be shown to
   * exclude a peer whose verdict never landed.
   *
   * The blocks are seeded into A's and C's directories with `FsBlockstore` **before either
   * process is spawned**, so each block genuinely exists on exactly one node and B's fetch
   * is a real network fetch rather than a local hit.
   */
  it('accepts the certificate that chains to its pinned issuer, refuses the other by name, and never asks it for a block', async () => {
    const aUserKey = await writeUserKey('a-user', A_USER_SEED)
    const cUserKey = await writeUserKey('c-user', C_USER_SEED)

    // Seeded before the spawn, so the block is resident on exactly one node.
    const onA = new Uint8Array([0xa0, 0xa1, 0xa2, 0xa3])
    const onC = new Uint8Array([0xc0, 0xc1, 0xc2, 0xc3])
    const cidOnA = await (await FsBlockstore.open(join(workdir, 'a'))).put(onA)
    const cidOnC = await (await FsBlockstore.open(join(workdir, 'c'))).put(onC)

    // Two independent authorities. C's certificate is signed by a provider B does not pin,
    // which is the self-signed case seen from the verifier's side and is constructible with
    // production flags only — no test-only branch in the binary. The literal
    // `issuer === nodeKey` shape is measured at the wire in
    // `packages/net/src/enrol-protocol.test.ts`.
    const p1 = await spawnAgent('p1', ['--issues-certificates', '--max-issued-per-window', '64'])
    const p2 = await spawnAgent('p2', ['--issues-certificates', '--max-issued-per-window', '64'])
    expect(p1.issuerKey).not.toBeNull()
    expect(p2.issuerKey).not.toBeNull()
    expect(p1.issuerKey).not.toBe(p2.issuerKey)

    const a = await spawnAgent('a', [
      '--provider-addr', p1.multiaddrs[0] as string,
      '--user-key', aUserKey,
      '--operator-id', 'harbour-ops',
    ])
    const c = await spawnAgent('c', [
      '--provider-addr', p2.multiaddrs[0] as string,
      '--user-key', cUserKey,
      '--operator-id', 'trawler-ops',
    ])
    expect(a.certificate?.issuer).toBe(p1.issuerKey)
    expect(c.certificate?.issuer).toBe(p2.issuerKey)

    // **The falsification.** Both authorities are stopped and waited for before the
    // verifier exists. Their death is asserted rather than assumed, so "the provider was
    // still answering" is not an available explanation for the verdicts below.
    await stopAgentNow(p1)
    await stopAgentNow(p2)
    expect(p1.child.exitCode !== null || p1.child.signalCode !== null).toBe(true)
    expect(p2.child.exitCode !== null || p2.child.signalCode !== null).toBe(true)

    const b = await startNode('b', { trustedIssuers: [p1.issuerKey as string] })
    await b.dial(a.multiaddrs[0] as string)
    await b.dial(c.multiaddrs[0] as string)

    // The precondition, asserted rather than slept through. A verdict is an inherently
    // asynchronous records round trip kicked off from `peer:connect`; `dial` resolving says
    // nothing about whether it has landed, and `FabricNode` exposes no awaitable verify.
    // Without this the verified set is empty at assertion time, BOTH fetches below return
    // undefined, the success half flakes and the failure half passes for the wrong reason —
    // which is the exact failure shape this phase exists to eliminate. This poll waits for
    // an asynchronous verdict; it is not papering over a race.
    await until(
      () => b.verdictFor(a.peerId) !== undefined && b.verdictFor(c.peerId) !== undefined,
      VERDICT_DEADLINE_MS,
      'a verdict for both A and C',
    )
    expect(b.verdictFor(a.peerId)).toBeDefined()
    expect(b.verdictFor(c.peerId)).toBeDefined()

    // Accepted, with no authority alive anywhere to have been consulted.
    expect(b.verdictFor(a.peerId)).toMatchObject({ ok: true })

    // Refused, by name, naming the issuer it refused.
    const verdict = b.verdictFor(c.peerId)
    expect(verdict?.ok).toBe(false)
    expect(verdict?.ok === false ? verdict.failure : null).toStrictEqual({
      kind: 'untrusted-issuer',
      issuer: p2.issuerKey,
    })

    // The exclusion is a filter over a peer that is genuinely connected, not an empty list:
    // a dead network would produce the same empty verified set as a working gate, and these
    // two readings together are what tells them apart.
    expect(b.transport.peers).toContain(c.peerId)
    expect(b.verifiedPeers).toContain(a.peerId)
    expect(b.verifiedPeers).not.toContain(c.peerId)

    // The behavioural consequence, with the instrument shown reading **both ways**. Without
    // the successful half, "the block did not arrive" would be indistinguishable from an
    // instrument that was never switched on.
    expect(await b.blockstore.get(cidOnA)).toStrictEqual(onA)
    expect(await b.blockstore.get(cidOnC)).toBeUndefined()

    // A refused peer, not a dead one.
    expect(c.child.exitCode).toBeNull()
    expect(c.child.signalCode).toBeNull()
  }, 180_000)
})

describe('AUTH-02 — --trusted-issuer measured through two spawned processes', () => {
  /**
   * The half of criterion 2 that *is* reachable across a real process boundary: the flag
   * and the fail-closed gate it turns on.
   *
   * **Without this test the whole argv → `FabricNodeOptions.trustedIssuers` mapping would
   * have zero coverage anywhere in this phase.** `values['trusted-issuer']` is
   * `string[] | undefined` from `multiple: true`, and every other assertion about
   * `trustedIssuers` in the repository reaches `FabricNodeOptions` directly — so a typo in
   * the flag name or a forgotten conditional spread would leave every test green while the
   * flag did nothing at all.
   *
   * Neither spawned agent enrols: a verifier needs no certificate of its own. The only node
   * either of them is connected to is the one in this process, which holds no certificate
   * and answers the production `'serves-no-records'` sentinel, so it can never be verified
   * by anybody. One flag is the only difference between the two spawns.
   *
   * **What this covers and what it does not.** It covers the gate, fail-closed, in a real
   * process. It does **not** cover a spawned verifier *accepting* a certificate — that
   * needs the spawned agent connected to an enrolled peer. Since Plan 18-01 that is what
   * `--peer-addr` does, and the accepting reading lives in
   * `packages/node/src/peer-dial.node.test.ts`. Neither file is asked to carry the other:
   * this one connects both agents to a peer that can never be verified by anybody, which
   * is what makes its refusal a property of the flag rather than of the peer.
   */
  it('a spawned agent given --trusted-issuer refuses an unverifiable peer as a block source, and an identical one without it does not', async () => {
    // A real issuer key to pin, obtained from a provider process rather than invented, so
    // the value on the command line is the shape production uses.
    const p1 = await spawnAgent('p1', ['--issues-certificates', '--max-issued-per-window', '64'])
    await stopAgentNow(p1)

    const g = await spawnAgent('g', ['--trusted-issuer', p1.issuerKey as string])
    const g2 = await spawnAgent('g2')

    // This process holds the module and the input and nothing else does, so each agent must
    // pull both over the wire — the property `two-process.node.test.ts` establishes for
    // NET-01, reused here as the thing the gate can prevent.
    const client = await startNode('client')
    await client.dial(g.multiaddrs[0] as string)
    await client.dial(g2.multiaddrs[0] as string)

    const moduleCid = await client.store.put(MODULE_ECHOES_INPUT)
    const input = await canonicalCid({ a: 1 })
    if (!input.ok) throw new Error('fixture not encodable')
    await client.store.put(input.bytes)

    const task: Task = {
      moduleCid,
      inputCid: input.cid,
      partitionIndex: 0,
      partitionCount: 1,
      label: 'public',
      moduleRecord: recordFor('certificate-verification-echo', moduleCid),
    }

    // The identical task, through the identical adapter, to two processes that differ in
    // exactly one flag.
    const viaG = await new RemoteExecutor(g.peerId, client.rpc, 'dispatches-unauthenticated').execute(task)
    const viaG2 = await new RemoteExecutor(g2.peerId, client.rpc, 'dispatches-unauthenticated').execute(task)

    // G2 pins nobody, so it treats every connected peer as usable, the module arrives, and
    // the task actually runs — measured as the echoed input rather than as a bare `ok`, so
    // a node that answered success without executing would not pass.
    expect(viaG2).toMatchObject({ ok: true, output: { a: 1 } })

    // G pins an issuer; its only peer serves no records and can therefore never be
    // verified; `verifiedPeers` is empty; `RpcBlockSource` has nobody to ask; the module
    // never arrives.
    //
    // **The reason is asserted, not only the `false`.** A refusal that names the wrong
    // thing is a defect even when the request correctly fails, and this dispatch could
    // equally have failed for want of provenance, for a dead process, or on a timeout —
    // all of which would satisfy a bare `ok === false`. Measured, with the flag in place:
    // `module block missing: <moduleCid>`, which is the block source finding nobody to ask.
    expect(viaG.ok).toBe(false)
    expect(viaG.ok === false ? viaG.reason : '').toContain('module block missing')
    expect(viaG.ok === false ? viaG.reason : '').toContain(moduleCid.toString())

    // "The process died" is not an available explanation for either reading.
    expect(g.child.exitCode).toBeNull()
    expect(g.child.signalCode).toBeNull()
    expect(g2.child.exitCode).toBeNull()
    expect(g2.child.signalCode).toBeNull()
  }, 180_000)
})
