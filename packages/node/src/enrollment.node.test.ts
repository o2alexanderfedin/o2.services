import { spawn } from 'node:child_process'
import type { ChildProcessByStdio } from 'node:child_process'
import type { Readable, Writable } from 'node:stream'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ed25519 } from '@noble/curves/ed25519.js'
import { DEFAULT_MAX_PER_WINDOW, requestEnrollment, toHex, verifyCertificate } from '@o2/core'
import type { NodeCertificate } from '@o2/core'
import { SEED_BYTES, peerIdForNodeKey } from '@o2/libp2p'
import { RpcRecordIndex, enrolOverRpc } from '@o2/net'
import type { EnrolOutcome } from '@o2/net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FabricNode } from './fabric-node.ts'
import { FsBlockstore } from './fs-blockstore.ts'

/**
 * AUTH-01 and AUTH-04, measured across real operating-system processes.
 *
 * ## What this file proves
 *
 * ROADMAP criterion 1, in the words the criterion uses: *"Starting a node via
 * `bin/agent.ts` for the first time generates an identity key **on-device** and completes
 * a **rate-limited** enrollment against a provider, receiving a provider-signed
 * certificate — observable as the node's advertised identity being a certificate rather
 * than a bare libp2p peer id."*
 *
 * **Same-process would not have been sufficient here, unlike Phase 13.** 13-CONTEXT.md
 * argued that two `FabricNode`s in one Vitest process are accepted evidence for "started
 * via `bin/agent.ts`". That argument does not carry: this criterion's subject is *what
 * happens on first start of a process against a fresh directory*, and a directory that a
 * previous test in the same heap could have touched is not that. So the nodes here are
 * genuine spawned processes with directories that did not exist a moment earlier, and the
 * "generated on-device" claim is a claim about a **file that was not there before the
 * spawn** — asserted absent, then asserted present at exactly {@link SEED_BYTES} bytes.
 *
 * The certificate is also read back **over the same wire a peer would use**, through a
 * `records` request, rather than off the agent's own stdout. Without that step the whole
 * of criterion 1 would be a self-report: a binary that printed a plausible object would
 * pass.
 *
 * ROADMAP criterion 3 — *"Enrolling many node identities in a burst through the same entry
 * point is rate-limited — refused beyond a **stated threshold** rather than accepted
 * unbounded"* — is measured against a spawned `--issues-certificates` agent over the same
 * `rpc.request(peer, encodeRequest({kind:'enrol', …}))` path production uses.
 *
 * ## What this file does NOT prove, stated here so the rest is not read as covering it
 *
 * **It does not prove that mass fake-node creation is costly.** AUTH-04's wording asks for
 * that and the *per-user* limiter does not do it: it is keyed on `userKey`, and generating
 * a fresh user key is one `ed25519.keygen()` call. The second measurement below issues
 * twenty requests under twenty *distinct* user keys against a provider with a fresh
 * history and records that **all twenty succeed**. No deletion anywhere turns that
 * assertion red, and that is the finding, not a gap in the test.
 *
 * **What changed in Phase 19, and why these numbers did not.** `EnrollmentAuthority` now
 * carries a second budget — `maxIssuedPerWindow`, an aggregate on a quantity no request
 * field can rotate around — and a host-supplied issuance ledger both budgets read. Since
 * Plan 19-07 `bin/agent.ts` has no way to run a provider without stating that bound, so
 * every spawn below carries `--max-issued-per-window 64` — **chosen well above the largest
 * population any measurement here sends** (twenty), so the aggregate budget never binds and
 * every reading below stays a reading about the **per-user** limiter. That is the whole of
 * what changed here. The aggregate bound is measured where it is the subject:
 * `enrollment-cost.node.test.ts`.
 *
 * **The stated threshold is per provider per window, and it now survives a restart.** Plan
 * 19-07 gave this tier a durable record under the provider's own `--dir` (`FsIssuance`),
 * so a provider process that stops and starts again on the same directory resumes with
 * everything it has already signed. What that changes for *this* file is only the
 * explanation of the third measurement below: a second provider on a second directory
 * still has its own budget, and that is because it is a second **provider**, not because
 * the first one forgot.
 *
 * **Nothing here measures verification.** Criterion 2 lives in
 * `certificate-verification.node.test.ts`, where both provider processes are killed before
 * a verdict is taken.
 */

const AGENT = fileURLToPath(new URL('./bin/agent.ts', import.meta.url))

/**
 * How long a spawned agent gets to print its handshake line.
 *
 * **Not inherited from the 30 s the three existing spawn helpers allow**, and the reason
 * is 17-CONTEXT.md Risk 4: those budgets were sized for a node that binds a socket and
 * prints. An enrolling agent additionally dials a provider, exchanges a request and a
 * response over `RpcEndpoint`, verifies two signatures on the far side and writes a
 * certificate to disk — all *before* the line is printed. No pre-existing test passes a
 * provider address, so no pre-existing budget covers that work.
 *
 * **And the measurement says the premise is smaller than it looks, so it is recorded here
 * rather than left as a reason nobody checked.** Instrumented over all eleven spawns this
 * file performs, timing `spawn()` to the handshake line, on this machine at a 1-minute
 * load average of 23.7:
 *
 * | spawn | announce, measured |
 * |---|---|
 * | not enrolling (8 spawns, providers and plain agents) | 421–655 ms |
 * | enrolling — dial, `enrol` round trip, certificate written (3 spawns) | 468–552 ms |
 *
 * The enrolling range sits **inside** the non-enrolling one. Against a provider on
 * loopback the extra dial and round trip are below the variance of Node process startup,
 * so Risk 4's cost is real in principle and unmeasurable here. The budget is raised
 * anyway, because the reading is about *this* topology: a provider across a real network,
 * or one that accepts a connection and then never answers, spends up to this node's
 * `rpcTimeoutMs` before `start()` rejects, and inheriting a budget sized for a node that
 * only binds a socket would report that as an anonymous announce timeout.
 *
 * 60 s is roughly ninety times the slowest reading. Nothing in this file asserts on
 * wall-clock time and this number is not a bound anything is measured against; it exists
 * only so a genuinely wedged process is reported as a wedged process rather than as a hang.
 */
const ANNOUNCE_BUDGET_MS = 60_000

/**
 * stdin is piped and never written to, so the child's type carries a `Writable` for it.
 *
 * The pipe is the point rather than the type: `bin/agent.ts` watches fd 0 and leaves when
 * it closes, which is what stops a spawned agent outliving a parent that was killed rather
 * than asked. Handing it `ignore` would put `/dev/null` on fd 0 and silently opt this file
 * out. See `orphan-leash.node.test.ts`, which demonstrates it and guards this line.
 */
type AgentProcess = ChildProcessByStdio<Writable, Readable, Readable>

/**
 * The handshake line, widened to the five keys `bin/agent.ts` now prints.
 *
 * `certificate` is the **whole** certificate rather than a summary, so the object compared
 * against what a peer fetches over the wire below is the same object in both readings.
 */
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

/** Spawn an agent process and wait for its one-line handshake. */
async function spawnAgent(name: string, extraArgs: readonly string[] = []): Promise<Agent> {
  const dir = join(workdir, name)
  const child: AgentProcess = spawn(process.execPath, [AGENT, '--dir', dir, ...extraArgs], {
    stdio: ['pipe', 'pipe', 'pipe'],
  })

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

/**
 * A node in the test process, used only as a client: it dials a spawned agent and asks it
 * something over the wire.
 *
 * It pins no issuer, so it verifies nobody and treats every connected peer as usable —
 * 17-CONTEXT.md decision 9's third row, and what every node in this repository did before
 * this phase. Verification is `certificate-verification.node.test.ts`'s subject.
 */
async function startClient(name: string): Promise<FabricNode> {
  const node = await FabricNode.start({
    relayAdmission: 'admits-any-peer',
    startReporting: 'reports-its-own-start',
    blockstoreDir: join(workdir, name),
    listen: ['/ip4/127.0.0.1/tcp/0'],
    rpcTimeoutMs: 10_000,
    trustAnchors: 'runs-unsigned-artifacts',
  })
  nodes.push(node)
  return node
}

/**
 * Write a user key file and return the path plus the public half it implies.
 *
 * `bin/agent.ts` refuses to create one — see that flag's comment for why a user key is not
 * a node's to mint — so a test that wants an agent to enrol must put the bytes there
 * itself. That is also what makes the assertion on `certificate.userKey` below a real
 * reading: this file knows which key it wrote, so a certificate naming a different one is
 * visible rather than merely well-formed.
 */
async function writeUserKey(name: string, seed: Uint8Array): Promise<{ path: string; publicKey: string }> {
  await mkdir(workdir, { recursive: true })
  const path = join(workdir, `${name}.key`)
  await writeFile(path, seed, { mode: 0o600 })
  return { path, publicKey: toHex(ed25519.getPublicKey(seed)) }
}

/** Seeds for the user keys in this file. Distinct from every other fixture key. */
const ALICE_USER_SEED = new Uint8Array(SEED_BYTES).fill(0x71)
const BURST_USER_SEED = new Uint8Array(SEED_BYTES).fill(0x72)

beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'o2-enrol-'))
})

/**
 * Inner 10 s, outer 40 s — and the order is the point.
 *
 * `stopAgent` gives a wedged process 10 s before SIGKILL, and this hook may be waiting on
 * as many as four of them plus two in-process nodes. Vitest's default `hookTimeout` is
 * also 10 s, so with no explicit budget the two clocks are armed for the same instant, the
 * framework's fires first, the SIGKILL fallback can never run, and a wedged agent is
 * reported as an anonymous hook timeout naming no step. A test arms two clocks and the
 * framework's must be the larger — the same reasoning `two-process.node.test.ts` and
 * `egress-refusal.node.test.ts` record for their own, with a larger outer number because
 * this file stops more processes than either of them.
 */
afterEach(async () => {
  await Promise.all(nodes.splice(0).map((n) => n.stop().catch(() => {})))
  await Promise.all(agents.splice(0).map((a) => stopAgent(a).catch(() => {})))
  await rm(workdir, { recursive: true, force: true })
}, 40_000)

describe('AUTH-01 — criterion 1, across two real bin/agent.ts processes', () => {
  /**
   * The seven steps criterion 1's own wording implies, in one test because each step is a
   * precondition for the next: an identity that was not generated cannot be certified, and
   * a certificate nobody can fetch is a self-report.
   */
  it('generates an identity on-device, enrols against a provider process, and advertises a certificate a peer can fetch and verify', async () => {
    const user = await writeUserKey('alice-user', ALICE_USER_SEED)

    // Step 1 — the provider. A process that issues certificates is a *configuration* of
    // the one node type: it executes tasks, holds blocks, serves records and relays
    // exactly as every other agent does. Its handshake carries a non-null `issuerKey`,
    // which is the public half of a key it generated on its own disk.
    const provider = await spawnAgent('provider', ['--issues-certificates', '--max-issued-per-window', '64'])
    expect(provider.issuerKey).not.toBeNull()
    expect(provider.certificate).toBeNull()
    const issuerKey = provider.issuerKey as string

    // Step 2 — "generated on-device" is a claim about a file that was not there a moment
    // ago. Asserted absent first, so a pre-existing key could not satisfy it.
    const aliceDir = join(workdir, 'alice')
    expect(existsSync(join(aliceDir, '.identity.key'))).toBe(false)

    const alice = await spawnAgent('alice', [
      '--provider-addr',
      provider.multiaddrs[0] as string,
      '--user-key',
      user.path,
      '--operator-id',
      'harbour-ops',
    ])

    expect(existsSync(join(aliceDir, '.identity.key'))).toBe(true)
    expect(statSync(join(aliceDir, '.identity.key')).size).toBe(SEED_BYTES)

    // Step 3 — the three files this phase writes beside the blocks are dot-prefixed and
    // none of them is counted as a block. `FsBlockstore.open`'s filter *is* the block
    // counter, so a `0` that came from an empty directory and a `0` that came from a
    // working filter are different readings: the `readdirSync` assertion is what tells
    // them apart. The `0` itself is what nobody `put` — alice's own controlled starting
    // state, not a prediction about a node under load.
    expect(readdirSync(aliceDir)).toContain('.identity.key')
    expect(readdirSync(aliceDir)).toContain('.certificate.json')
    expect((await FsBlockstore.open(aliceDir)).size).toBe(0)

    // Step 4 — the advertised identity is a certificate, not only a peer id, and it was
    // signed by the process spawned in step 1 rather than by alice herself.
    expect(alice.certificate).not.toBeNull()
    const certificate = alice.certificate as NodeCertificate
    expect(certificate.issuer).toBe(issuerKey)
    expect(certificate.issuer).not.toBe(certificate.nodeKey)
    expect(certificate.nodeKey).toBe(alice.nodeKey)
    expect(certificate.userKey).toBe(user.publicKey)
    expect(certificate.operatorId).toBe('harbour-ops')
    expect(certificate.expiresAt).toBeGreaterThan(Date.now())

    // Step 5 — what makes step 4 mean something rather than being a string the binary
    // chose to print: the certificate is about the very key the peer id is derived from.
    expect(peerIdForNodeKey(alice.nodeKey)).toBe(alice.peerId)

    // Step 6 — read back over the same wire a peer would use, not off alice's stdout.
    // This is the step that stops the whole test being a self-report.
    const client = await startClient('client')
    await client.dial(alice.multiaddrs[0] as string)
    const fetched = await new RpcRecordIndex(client.rpc, () => [alice.peerId]).recordsFor(alice.nodeKey)
    expect(fetched).toBeDefined()
    expect(fetched?.certificate).toStrictEqual(certificate)
    expect(verifyCertificate(fetched?.certificate as NodeCertificate, new Set([issuerKey]), Date.now()).ok).toBe(true)

    // Step 7 — "for the first time" made measurable. The same directory, the same live
    // provider: the node is the same node and the certificate is the same certificate,
    // so no second issuance was spent.
    await stopAgentNow(alice)
    const restarted = await spawnAgent('alice', [
      '--provider-addr',
      provider.multiaddrs[0] as string,
      '--user-key',
      user.path,
      '--operator-id',
      'harbour-ops',
    ])
    expect(restarted.nodeKey).toBe(alice.nodeKey)
    expect(restarted.peerId).toBe(alice.peerId)
    expect(restarted.certificate?.issuedAt).toBe(certificate.issuedAt)
    expect(restarted.certificate).toStrictEqual(certificate)
  }, 180_000)

  /**
   * A partial flag set is a usage error, never a signed statement over a defaulted
   * operator id.
   *
   * The positive control is in the same test on purpose: an exit 2 next to a spawn that
   * succeeds is a refusal, while an exit 2 on its own would be equally well explained by a
   * binary that cannot start at all.
   *
   * **The refusal *text* is asserted, not only the exit code, and that is not decoration.**
   * Measured: with the `--user-key` companion clause deleted, this binary still exits 2 —
   * `readUserSeed` is handed `undefined`, `readFile` rejects, and the refusal path catches
   * it. So an assertion on `exit 2` plus `usage` alone stays **green under the mutation
   * that removes the check it exists to prove**, which was the plan's stated reddening for
   * this behaviour and is false as written. What actually changes is what the operator
   * reads: `--provider-addr requires --user-key <path>` becomes
   * `--user-key undefined could not be read: The "path" argument must be of type string…`,
   * which blames a file read for a flag nobody passed. A refusal that names the wrong thing
   * is a defect even when the request correctly fails, so the name is what is asserted.
   */
  it('exits 2 naming the missing companion when --provider-addr is given without it, and starts when both are given', async () => {
    const user = await writeUserKey('control-user', ALICE_USER_SEED)
    const provider = await spawnAgent('provider', ['--issues-certificates', '--max-issued-per-window', '64'])

    await expect(
      spawnAgent('partial', ['--provider-addr', provider.multiaddrs[0] as string, '--operator-id', 'op-a']),
    ).rejects.toThrow(/exited early with 2[\s\S]*--provider-addr requires --user-key[\s\S]*usage/)

    await expect(
      spawnAgent('partial-2', ['--provider-addr', provider.multiaddrs[0] as string, '--user-key', user.path]),
    ).rejects.toThrow(/exited early with 2[\s\S]*--provider-addr requires --operator-id[\s\S]*usage/)

    // The control: the identical spawn with the full set starts and holds a certificate.
    const complete = await spawnAgent('complete', [
      '--provider-addr',
      provider.multiaddrs[0] as string,
      '--user-key',
      user.path,
      '--operator-id',
      'op-a',
    ])
    expect(complete.certificate).not.toBeNull()
  }, 120_000)

  /**
   * A `--user-key` that names nothing is refused, and the refusal names the flag and the
   * value.
   *
   * The value used is 64 characters of `z`, and that specific shape is the point. When
   * `--user-key` carried a hex key this was the case `fromHex` would silently zero-fill
   * into a *valid-looking* key that a provider then signed over — a confident wrong
   * answer, not an error. The flag now names a file instead, precisely because a public
   * key cannot produce the `ownerProof` `enrol` requires and a private one on argv is
   * readable in `ps`; so the same input is now refused as a path that cannot be read. Both
   * readings are the same guarantee — a mistyped user key never reaches a signed
   * certificate — and this one additionally names the input rather than deriving a key
   * from it.
   */
  it('exits 2 naming the flag and the value when --user-key does not name a readable 32-byte file', async () => {
    const provider = await spawnAgent('provider', ['--issues-certificates', '--max-issued-per-window', '64'])

    const nonsense = 'z'.repeat(64)
    await expect(
      spawnAgent('bad-key', [
        '--provider-addr',
        provider.multiaddrs[0] as string,
        '--user-key',
        nonsense,
        '--operator-id',
        'op-a',
      ]),
    ).rejects.toThrow(new RegExp(`exited early with 2[\\s\\S]*--user-key[\\s\\S]*${nonsense}`))

    // A file of the wrong length is refused too, and by size rather than by absence — so
    // "the path did not exist" is not the only thing this check can see.
    const short = join(workdir, 'short.key')
    await writeFile(short, new Uint8Array(16).fill(9))
    await expect(
      spawnAgent('short-key', [
        '--provider-addr',
        provider.multiaddrs[0] as string,
        '--user-key',
        short,
        '--operator-id',
        'op-a',
      ]),
    ).rejects.toThrow(/exited early with 2[\s\S]*--user-key[\s\S]*16 bytes/)
  }, 120_000)

  /**
   * A `--trusted-issuer` that is not 64 lowercase hex characters is refused rather than
   * zero-filled.
   *
   * Without this, `fromHex` would turn the same input into 32 zero bytes,
   * `publicKeyFromRaw` would accept them, and the node would start and then refuse every
   * peer it ever meets as `untrusted-issuer` — with nothing anywhere reporting that the
   * input was never hex. The paired positive spawn is what shows the check is a check and
   * not a flag that never works.
   */
  it('exits 2 naming the rejected --trusted-issuer value, and accepts a well-formed one', async () => {
    const nonsense = 'z'.repeat(64)
    await expect(spawnAgent('bad-issuer', ['--trusted-issuer', nonsense])).rejects.toThrow(
      new RegExp(`exited early with 2[\\s\\S]*--trusted-issuer[\\s\\S]*${nonsense}`),
    )

    const wellFormed = toHex(ed25519.getPublicKey(new Uint8Array(SEED_BYTES).fill(0x73)))
    const pinned = await spawnAgent('good-issuer', ['--trusted-issuer', wellFormed])
    expect(pinned.certificate).toBeNull()
    expect(pinned.issuerKey).toBeNull()
  }, 120_000)
})

describe('AUTH-04 — criterion 3, the burst through the production request path', () => {
  /**
   * Twenty enrollment requests naming **one** user key with twenty distinct node keys,
   * sent over the same `rpc.request(peer, encodeRequest({kind:'enrol', …}))` path
   * production uses, to a spawned `--issues-certificates` agent.
   *
   * **The split is never written down here.** It is asserted against the threshold the
   * refusal itself carries, so the stated threshold is discoverable by the peer that hit
   * it rather than only from the provider's source. `limit` and `windowMs` *are* asserted
   * as literals, because the refusal is required to carry them onto the wire: a threshold
   * that only the provider knows is not a stated threshold.
   *
   * Outcomes are collected into two arrays rather than asserted in arrival order — the
   * authority answers requests as they arrive and nothing here may depend on which of them
   * won, nor on how many did.
   */
  it('refuses past the threshold the refusal states, under one user key', async () => {
    const provider = await spawnAgent('burst-provider', ['--issues-certificates', '--max-issued-per-window', '64'])
    const client = await startClient('burst-client')
    await client.dial(provider.multiaddrs[0] as string)

    // Reproducible node seeds: a failure names which request it was. The population is
    // derived from the shipped default rather than written down — it read `length: 20`
    // until 2026-08-17, when the default moved from 5 to 32 and twenty stopped being a
    // burst at all. A fixed literal beside a moving default does not fail loudly; it goes
    // green and stops measuring, which is worse.
    const outcomes = await Promise.all(
      Array.from({ length: DEFAULT_MAX_PER_WINDOW + 3 }, async (_, i) =>
        enrolOverRpc(
          client.rpc,
          provider.peerId,
          await requestEnrollment(new Uint8Array(SEED_BYTES).fill(i + 1), BURST_USER_SEED, {
            operatorId: 'burst-ops',
            discoverability: 'seed',
            relayIds: [],
          }),
        ),
      ),
    )

    const accepted = outcomes.filter((o) => o.ok)
    const refused = outcomes.filter(
      (o): o is Extract<EnrolOutcome, { kind: 'refused' }> => !o.ok && o.kind === 'refused',
    )

    expect(accepted.length + refused.length).toBe(DEFAULT_MAX_PER_WINDOW + 3)
    expect(refused.length).toBeGreaterThan(0)

    const first = refused[0]?.refusal
    // `limit: 5` stood here until 2026-08-17. The literal is kept — the refusal has to carry
    // a specific number onto the wire, and reading it back out of the constant alone would
    // prove only that this file and that file agree — and it is pinned to the shipped
    // default on the line below so the two cannot drift apart in either direction.
    //
    // **64 since 2026-08-23**, and not because this bound was re-sized. What moved is what
    // it is measured against: `DEFAULT_CERTIFICATE_LIFETIME_MS` went from 30 days to 1 hour,
    // so a node now spends an issuance in every window instead of one in 720, and the worst
    // ordinary case became the tab restore plus every already-enrolled node of the same
    // owner renewing inside it.
    expect(first).toMatchObject({ kind: 'rate-limited', limit: 64, windowMs: 3_600_000 })
    expect(
      first?.kind === 'rate-limited' ? first.limit : null,
      'the number crossing the wire and the shipped default are one number',
    ).toBe(DEFAULT_MAX_PER_WINDOW)
    if (first?.kind !== 'rate-limited') throw new Error('expected a rate-limited refusal')
    expect(first.retryAfterMs).toBeGreaterThan(0)
    expect(first.userKey).toBe(toHex(ed25519.getPublicKey(BURST_USER_SEED)))

    // The threshold read out of the refusal, not looked up from the source.
    expect(accepted).toHaveLength(first.limit)
    // And every refusal states the same one, so the limit is a property of the provider
    // rather than of whichever request happened to be answered first.
    for (const outcome of refused) {
      expect(outcome.refusal).toMatchObject({ kind: 'rate-limited', limit: first.limit, windowMs: first.windowMs })
    }

    // A refusal is an answer, not a dropped frame: the provider is alive afterwards.
    expect(provider.child.exitCode).toBeNull()
    expect(provider.child.signalCode).toBeNull()
  }, 180_000)

  /**
   * The honest counter-measurement, published beside the first.
   *
   * **Rate-limiting is measured; the per-user limiter buys no cost.** Twenty requests
   * naming twenty *distinct* user keys all succeed, unslowed, because that limiter is
   * keyed on `userKey` and generating a fresh user key is one `ed25519.keygen()` call.
   * **No deletion turns this assertion red** — there is nothing in *that* mechanism for a
   * mutation to remove. It is here so the repository stops implying that AUTH-04's
   * *"so mass fake-node creation is costly"* has been demonstrated by the per-user window.
   *
   * The bound that does answer it is `maxIssuedPerWindow`, and this spawned agent states
   * **64** — three times the population it meets, deliberately, so the twenty still
   * succeed and this reading stays about the per-user limiter. Against a provider that
   * named a number below twenty they would not, which is the whole difference and is
   * measured in `enrollment-cost.node.test.ts` at a budget of one.
   * `enrollment.test.ts` runs this exact population against both configurations side by
   * side, in process.
   *
   * A **second** provider process rather than a reuse of the first, deliberately: neither
   * number may depend on the other measurement having run, and the first test deliberately
   * exhausts one user key's budget on the provider it uses.
   */
  it('does nothing at all against twenty distinct user keys — rate-limiting measured, cost unmeasured', async () => {
    const provider = await spawnAgent('cost-provider', ['--issues-certificates', '--max-issued-per-window', '64'])
    const client = await startClient('cost-client')
    await client.dial(provider.multiaddrs[0] as string)

    const outcomes = await Promise.all(
      Array.from({ length: 20 }, async (_, i) =>
        enrolOverRpc(
          client.rpc,
          provider.peerId,
          await requestEnrollment(
            new Uint8Array(SEED_BYTES).fill(i + 1),
            new Uint8Array(SEED_BYTES).fill(i + 101),
            { operatorId: 'cost-ops', discoverability: 'seed', relayIds: [] },
          ),
        ),
      ),
    )

    expect(outcomes.filter((o) => o.ok)).toHaveLength(20)
    // Twenty different subjects, so this is twenty node identities and not one repeated.
    expect(new Set(outcomes.map((o) => (o.ok ? o.certificate.nodeKey : ''))).size).toBe(20)
  }, 180_000)

  /**
   * The limit's real scope, asserted rather than left for a reader to infer: it is a
   * threshold per **provider**, and a provider is a directory.
   *
   * The same user key that was refused above is accepted immediately by a second provider
   * process — and since Plan 19-07 that is no longer because the record is per *process*.
   * `FsIssuance` keys the record on the provider's own `--dir`, and these two spawns are
   * given different directories by `spawnAgent`, so they are two providers with two
   * signing keys and two budgets. That is correct rather than a hole: a peer that pinned
   * the first one's issuer takes nothing from the second, because `verifyCertificate`
   * refuses `untrusted-issuer`.
   *
   * **The reading this file no longer takes** is the one that used to be recorded here as
   * unmeasured: a provider stopped and restarted on the *same* directory. That is
   * `enrollment-cost.node.test.ts`'s, where it is the load-bearing measurement rather than
   * a side note.
   */
  it('a second provider process has a fresh budget for the same user key', async () => {
    const first = await spawnAgent('scope-provider-1', ['--issues-certificates', '--max-issued-per-window', '64'])
    const second = await spawnAgent('scope-provider-2', ['--issues-certificates', '--max-issued-per-window', '64'])
    const client = await startClient('scope-client')
    await client.dial(first.multiaddrs[0] as string)
    await client.dial(second.multiaddrs[0] as string)

    const requestFor = (nodeSeedByte: number): ReturnType<typeof requestEnrollment> =>
      requestEnrollment(new Uint8Array(SEED_BYTES).fill(nodeSeedByte), BURST_USER_SEED, {
        operatorId: 'scope-ops',
        discoverability: 'seed',
        relayIds: [],
      })

    // Exhaust the first provider's budget for this user key, one request at a time so the
    // refusal below cannot be an artefact of concurrency.
    // Derived from the shipped default rather than written: this read `i <= 7` against a
    // default of 5, and 7 stopped exhausting anything when the default became 32.
    const exhausting = DEFAULT_MAX_PER_WINDOW + 2
    const againstFirst: EnrolOutcome[] = []
    for (let i = 1; i <= exhausting; i++) againstFirst.push(await enrolOverRpc(client.rpc, first.peerId, await requestFor(i)))
    expect(againstFirst.some((o) => !o.ok && o.kind === 'refused')).toBe(true)

    // One more node key, refused by the first provider and accepted by the second.
    const nextSeed = exhausting + 1
    const refusedByFirst = await enrolOverRpc(client.rpc, first.peerId, await requestFor(nextSeed))
    expect(refusedByFirst.ok).toBe(false)
    const acceptedBySecond = await enrolOverRpc(client.rpc, second.peerId, await requestFor(nextSeed))
    expect(acceptedBySecond.ok).toBe(true)
  }, 180_000)
})
