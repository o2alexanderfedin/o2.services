import { spawn } from 'node:child_process'
import type { ChildProcessByStdio } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Readable, Writable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { ed25519 } from '@noble/curves/ed25519.js'
import { canonicalCid, describeAttestation, toHex } from '@o2/core'
import type { PublicKeyHex } from '@o2/core'
import { PRIMES_RECORD, buildPrimesInput, primesKernelBytes } from '@o2/demo'
import { SEED_BYTES } from '@o2/libp2p'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FsBlockstore } from './fs-blockstore.ts'

/**
 * **AUTH-03 / MR-02 / VER-09 — a sovereign job, end to end, through `bin/agent.ts`.**
 *
 * Four spawned `bin/agent.ts` processes: a provider, two owners, and a coordinator. Nothing
 * in this file submits a job, holds a `JobSpec`, wraps an `Executor` or mints a capability
 * chain. It writes two files, seeds two blockstore directories, spawns four processes, and
 * reads their stdout. **That is the whole point of the file**: the three rows it closes were
 * each open not because the mechanism was missing but because *no runnable entry point
 * reached it*, and the difference between "a spec can do it" and "a command line can do it"
 * is the entire finding.
 *
 * ## What each row needed, and where it is read below
 *
 * | row | what was missing | the reading here |
 * |---|---|---|
 * | `AUTH-03` | *"a no-flag production dispatch that hands a real `CapabilitySupplier` to a `RemoteExecutor` placed on a node whose descriptor `ownerId` equals the shard's"* | each shard agreed on its own owner's process, and `descriptorOwners` — read off certificates, not chosen by the requestor — equals the shards' owner ids |
 * | `VER-09` | *"a default path that reaches an owner-pinned execution at fewer than two live owner nodes and renders `owner-attested` off it"* | the `sovereignAttestation` line, asserted **equal** to a receipt composed here from `describeAttestation` |
 * | `MR-02` | *"a sovereign aggregation reachable without two flags"* | the `sovereignAggregation` line: two owners, one combine at two replicas, coverage 2/2 complete, and a total equal to π(1000) + π(10000) |
 *
 * ## Why the flags this entry point needs are role selectors rather than feature gates
 *
 * `.planning/consults/2026-08-15-owner-ruling-off-by-default-flag.md` rules that a capability
 * reachable only behind an off-by-default flag is not shipped. `.planning/consults/2026-08-18-
 * owner-ruling-role-selector-vs-feature-gate.md` refines it with a test about the **default**:
 * a flag that could correctly have defaulted on is a feature gate; a flag for which no default
 * would be correct, because it names which role this process takes, is a role selector.
 * `--sovereign-owner` names *whose data this process acts for* and `--sovereign-row` names
 * *which rows it contributes*; a shipped binary can default to neither, for the same reason
 * `--owner-key` and `--can-execute-sovereign` have no default on the serving side. The
 * argument is written at the flags themselves, which is the burden that ruling places on any
 * flag claiming the exemption.
 *
 * ## The oracle, and why the aggregate is worth reading at all
 *
 * π(x) was tabulated in the mathematical literature long before this repository, so it is an
 * oracle nothing here produced — `primes-reduce.node.test.ts` states the argument in full and
 * this file quotes its two smallest constants. **And the guest genuinely reads the owner's
 * row.** Every *other* module fixture in this repository emits the partition index, a number
 * the host supplied, so a partial projected from one would be a pure function of something
 * the coordinator already held and the aggregate would be identical whether the guests read
 * anything at all — `sovereign-aggregation.node.test.ts` records that trap. π(n) is a function
 * of the eight bytes in the owner's own block and of nothing else, the two bounds differ, and
 * the sum is decomposable: a fixture that had read one row twice cannot produce it.
 *
 * ## What this file does NOT establish, stated rather than left to be assumed
 *
 * - **It does not read the spawned owners' own egress manifests.** Nothing can reach into
 *   another process's `EgressGuard`. The manifest read here is the **coordinator's**, which
 *   is the one that matters for this arrangement because the coordinator is the only node
 *   holding both rows. What the owners did not send is carried by the far-side store reading
 *   at the end.
 * - **It is not a cross-machine result.** Four processes on one host. Separate processes
 *   share no heap, no event loop and no module registry, which is the boundary the claim is
 *   about — but SAME-MACHINE is the honest label and this comment is where it is applied.
 * - **It says nothing about whether the map's arithmetic is trustworthy.** A sovereign map
 *   cannot be N-version verified; that is what the split gives up. The *aggregation* is
 *   verified, at two replicas per combine, and `minReplicas` is where that is read.
 *
 * ## Why an `.e2e.test.ts` and not a `.node.test.ts`
 *
 * `checkpoint-coordinator.e2e.test.ts`'s reason, and it applies here for a second one of its
 * own: the `e2e` project runs `fileParallelism: false`, and this file spawns four agent
 * processes that enrol, discover, dispatch WASM work and then combine for each other. Under
 * the `node` project's eight-way parallelism the discovery lookups race the machine. It also
 * keeps `slow-specs.node.test.ts`'s measured span table untouched, since `.e2e.test.ts` files
 * are excluded from the node project.
 *
 * ## Budget and seeds
 *
 * Four spawns, two enrolments with a dial each, one job, one reduce — the same shape as
 * `sovereign-aggregation.node.test.ts`, with its in-process requestor replaced by a fourth
 * process. **No publisher seed is needed at all**, which is itself a property worth naming:
 * the module is `@o2/demo`'s prime-counting kernel and `PRIMES_RECORD` is signed under
 * `KERNEL_TRUST_ANCHOR`, this binary's own default `--trust-anchor`, so every agent here runs
 * stock. User seeds **0xbb** and **0xbc** — 0xb7/0xb8 are `owner-domain-agents`', 0xb9/0xba
 * are `sovereign-aggregation`'s.
 */
const AGENT = fileURLToPath(new URL('./bin/agent.ts', import.meta.url))

/** Announce budget, matching `sovereign-aggregation.node.test.ts`. */
const ANNOUNCE_BUDGET_MS = 60_000
/** How long a coordinator may take to reach a line. Two enrolments, two lookups, one reduce. */
const JOB_BUDGET_MS = 180_000
/** Per-`it` budget. Four spawns, one job, one reduce. */
const PROCESS_TEST_TIMEOUT = 300_000

const ALICE_PRIVATE_KEY = new Uint8Array(SEED_BYTES).fill(0xbb)
const BOB_PRIVATE_KEY = new Uint8Array(SEED_BYTES).fill(0xbc)
const ALICE_USER_KEY: PublicKeyHex = toHex(ed25519.getPublicKey(ALICE_PRIVATE_KEY))
const BOB_USER_KEY: PublicKeyHex = toHex(ed25519.getPublicKey(BOB_PRIVATE_KEY))

/**
 * π(x) — quoted from the mathematical literature, never computed here.
 *
 * `primes-reduce.node.test.ts`' argument for quoting rather than deriving applies unchanged:
 * a JavaScript sieve written in this file would make the test compare the fabric against a
 * second implementation by the same author. These are the standard values, as carried by
 * every introductory number theory text.
 *
 * **The two bounds differ deliberately.** The aggregate is the sum of the two owners'
 * contributions, so equal bounds would make it `2n` for any `n` and a fixture in which the
 * guests' outputs had been swapped, duplicated, or read off one row twice would produce the
 * identical number.
 */
const ALICE_BOUND = 1_000
const BOB_BOUND = 10_000
const PI: { readonly [bound: number]: number } = {
  500: 95,
  1_000: 168,
  5_000: 669,
  10_000: 1229,
}

/**
 * What each owner's guest actually counts, and why it is **not** π of that owner's bound.
 *
 * A shard counts the primes in **its own slice** of its own input's range — the shipped
 * partitioning, and the reason one input block serves a whole colouring or primes job. The
 * arithmetic is `primes.wat`'s, quoted rather than reimplemented:
 *
 *   total = n - 1        (the values 2..n)
 *   chunk = total / count,  rem = total % count
 *   lo(i)  = 2 + i*chunk + min(i, rem),   hi(i) = lo(i + 1)
 *
 * This job has **two** shards, so with alice's `n = 1000`: `total = 999`, `chunk = 499`,
 * `rem = 1`, `lo(0) = 2`, `lo(1) = 502` — shard 0 counts the primes in `[2, 501]`. With
 * bob's `n = 10000`: `chunk = 4999`, `lo(1) = 5002`, `hi(1) = 10001` — shard 1 counts the
 * primes in `[5002, 10000]`.
 *
 * **Both boundaries fall on composites, which is what lets tabulated values name these
 * counts exactly**: 501 = 3 × 167 and 5001 = 3 × 1667, so π(501) = π(500) = 95 and
 * π(5001) = π(5000) = 669. Hence 95 and 1229 − 669 = 560, and the aggregate is 655.
 *
 * So the oracle survives the partitioning: every number below is a difference of quoted π
 * values, and the two contributions are **unequal**, which is what makes the sum decomposable
 * and a swapped or duplicated row detectable.
 */
const ALICE_COUNT = PI[500] as number
const BOB_COUNT = (PI[10_000] as number) - (PI[5_000] as number)

type AgentProcess = ChildProcessByStdio<Writable, Readable, Readable>

/** One JSON object off an agent's stdout. Keys are read, never assumed. */
type Line = Record<string, unknown>

interface Spawned {
  readonly name: string
  readonly dir: string
  readonly child: AgentProcess
  readonly handshake: Line
  readonly lines: readonly Line[]
  readonly waitFor: (match: (line: Line) => boolean, what: string) => Promise<Line>
  readonly stderr: () => string
}

let workdir: string
const spawned: Spawned[] = []

/**
 * Spawn `bin/agent.ts`, wait for its one-line handshake, and keep reading its stdout.
 *
 * Copied from `checkpoint-coordinator.e2e.test.ts` rather than imported: importing a helper
 * out of another `.test.ts` re-registers that file's whole suite.
 *
 * `'pipe'` on fd 0 is load-bearing — `bin/agent.ts` arms its orphan leash by watching fd 0,
 * and `'ignore'` would opt this file out. `orphan-leash.node.test.ts` fails any spawn site
 * that does that.
 */
async function spawnAgent(name: string, args: readonly string[]): Promise<Spawned> {
  const dir = join(workdir, name)
  const child: AgentProcess = spawn(process.execPath, [AGENT, '--dir', dir, ...args], {
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  const lines: Line[] = []
  const waiters: { match: (line: Line) => boolean; resolve: (line: Line) => void }[] = []
  let stderr = ''
  let buffer = ''
  let handshake: Line | null = null
  let announce: (line: Line) => void = () => {}
  let announceFailed: (cause: Error) => void = () => {}
  const announced = new Promise<Line>((resolve, reject) => {
    announce = resolve
    announceFailed = reject
  })

  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString()
  })
  child.stdout.on('data', (chunk: Buffer) => {
    buffer += chunk.toString()
    for (;;) {
      const newline = buffer.indexOf('\n')
      if (newline === -1) return
      const text = buffer.slice(0, newline)
      buffer = buffer.slice(newline + 1)
      let line: Line
      try {
        line = JSON.parse(text) as Line
      } catch (cause) {
        announceFailed(
          new Error(`${name} wrote a stdout line that is not JSON: ${text} (${String(cause)})`),
        )
        return
      }
      if (handshake === null) {
        handshake = line
        announce(line)
        continue
      }
      lines.push(line)
      // Spliced rather than filtered, so a waiter cannot fire twice on two lines that both
      // match — the caller asked for the first.
      for (let i = waiters.length - 1; i >= 0; i--) {
        const waiter = waiters[i]
        if (waiter !== undefined && waiter.match(line)) {
          waiters.splice(i, 1)
          waiter.resolve(line)
        }
      }
    }
  })
  child.on('exit', (code, signal) => {
    const cause = new Error(
      `${name} exited with ${String(code)}/${String(signal)}: ${stderr}`,
    )
    announceFailed(cause)
    // A waiter still outstanding when the process is gone will never be satisfied, so it is
    // failed with the process's own words rather than left to time out on a budget — which
    // would report "never wrote X" for a process that had already said why.
    for (const waiter of waiters.splice(0)) waiter.resolve({ exited: String(code), stderr })
  })

  const timer = setTimeout(
    () => announceFailed(new Error(`${name} did not announce in time: ${stderr}`)),
    ANNOUNCE_BUDGET_MS,
  )
  const line = await announced.finally(() => clearTimeout(timer))

  const agent: Spawned = {
    name,
    dir,
    child,
    handshake: line,
    lines,
    stderr: (): string => stderr,
    waitFor: (match: (l: Line) => boolean, what: string): Promise<Line> => {
      const already = lines.find(match)
      if (already !== undefined) return Promise.resolve(already)
      return new Promise<Line>((resolve, reject) => {
        const budget = setTimeout(
          () => reject(new Error(`${name} never wrote ${what} — stderr: ${stderr}`)),
          JOB_BUDGET_MS,
        )
        waiters.push({
          match,
          resolve: (l: Line): void => {
            clearTimeout(budget)
            resolve(l)
          },
        })
      })
    },
  }
  spawned.push(agent)
  return agent
}

/** SIGTERM, then wait for the process to actually be gone. */
async function stopAgent(agent: Spawned): Promise<void> {
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
async function stopAgentNow(agent: Spawned): Promise<void> {
  const at = spawned.indexOf(agent)
  if (at >= 0) spawned.splice(at, 1)
  await stopAgent(agent)
}

/** `bin/agent.ts` refuses to create a user key — it takes a path, never key material. */
async function writeKeyFile(name: string, seed: Uint8Array): Promise<string> {
  await mkdir(workdir, { recursive: true })
  const path = join(workdir, `${name}.key`)
  await writeFile(path, seed, { mode: 0o600 })
  return path
}

/** Run `bin/agent.ts` to completion and report what it said. Used for the argv refusals. */
async function runAgent(args: readonly string[]): Promise<{ code: number | null; stderr: string }> {
  const child = spawn(process.execPath, [AGENT, ...args], { stdio: ['pipe', 'pipe', 'pipe'] })
  let stderr = ''
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString()
  })
  return new Promise((resolve) => {
    child.on('exit', (code) => resolve({ code, stderr }))
  })
}

interface Fixture {
  readonly provider: Spawned
  readonly alice: Spawned
  readonly bob: Spawned
  readonly aliceRowPath: string
  readonly bobRowPath: string
  readonly aliceSeedPath: string
  readonly bobSeedPath: string
  readonly aliceCid: string
  readonly bobCid: string
}

/**
 * A provider and two owner agents, each holding its own row and nothing else.
 *
 * **Each store is seeded BEFORE its agent is spawned.** Seeding afterwards races the agent's
 * own open of the same directory — `discovery-agents.node.test.ts`'s reason — and giving a
 * node the other owner's row would delete the far-side reading this file takes at the end.
 *
 * **And the seeding is the premise rather than a convenience.** `submitJobWithEgress`
 * registers each owner-pinned row's canonical bytes on the coordinator's own `EgressGuard`
 * for the job's duration, so an owner that did not already hold its row would ask the
 * coordinator for the block and the guard would refuse the reply. The job completing at all
 * is therefore evidence that no raw row crossed the wire.
 */
async function standUp(): Promise<Fixture> {
  const aliceRow = buildPrimesInput(ALICE_BOUND)
  const bobRow = buildPrimesInput(BOB_BOUND)
  const aliceEncoded = await canonicalCid(aliceRow)
  const bobEncoded = await canonicalCid(bobRow)
  if (!aliceEncoded.ok || !bobEncoded.ok) throw new Error('a fixture row is not encodable')
  // The fixture's own premise, asserted rather than assumed: two rows that address apart. A
  // change making them equal would silently delete the strongest reading in this file.
  expect(aliceEncoded.cid.toString()).not.toBe(bobEncoded.cid.toString())

  const aliceStore = await FsBlockstore.open(join(workdir, 'alice'))
  await aliceStore.put(aliceEncoded.bytes)
  await aliceStore.put(primesKernelBytes)
  const bobStore = await FsBlockstore.open(join(workdir, 'bob'))
  await bobStore.put(bobEncoded.bytes)
  await bobStore.put(primesKernelBytes)

  // The row files the coordinator is handed. The same bytes the owners hold — one value, two
  // readers — but a *file*, not a blockstore: the coordinator addresses it itself.
  await mkdir(workdir, { recursive: true })
  const aliceRowPath = join(workdir, 'alice.row')
  const bobRowPath = join(workdir, 'bob.row')
  await writeFile(aliceRowPath, aliceRow)
  await writeFile(bobRowPath, bobRow)

  const provider = await spawnAgent('p', ['--issues-certificates', '--max-issued-per-window', '64'])
  const providerKey = provider.handshake['issuerKey']
  if (typeof providerKey !== 'string') throw new Error('the provider announced no issuer key')

  const aliceSeedPath = await writeKeyFile('alice', ALICE_PRIVATE_KEY)
  const bobSeedPath = await writeKeyFile('bob', BOB_PRIVATE_KEY)

  const enrol = async (name: string, seedPath: string, userKey: PublicKeyHex): Promise<Spawned> =>
    spawnAgent(name, [
      '--provider-addr',
      (provider.handshake['multiaddrs'] as string[])[0] as string,
      '--user-key',
      seedPath,
      '--operator-id',
      `${name}-ops`,
      // A pinned trust anchor, deliberately not derived by the binary — see `--owner-key`.
      '--owner-key',
      userKey,
      '--can-execute-sovereign',
    ])

  const alice = await enrol('alice', aliceSeedPath, ALICE_USER_KEY)
  const bob = await enrol('bob', bobSeedPath, BOB_USER_KEY)

  // The premise again, asserted: two owners, two user keys, two operators, one issuer.
  const aliceCert = alice.handshake['certificate'] as { userKey?: string; operatorId?: string }
  const bobCert = bob.handshake['certificate'] as { userKey?: string; operatorId?: string }
  expect(aliceCert.userKey).toBe(ALICE_USER_KEY)
  expect(bobCert.userKey).toBe(BOB_USER_KEY)
  expect(aliceCert.operatorId).not.toBe(bobCert.operatorId)

  return {
    provider,
    alice,
    bob,
    aliceRowPath,
    bobRowPath,
    aliceSeedPath,
    bobSeedPath,
    aliceCid: aliceEncoded.cid.toString(),
    bobCid: bobEncoded.cid.toString(),
  }
}

/** The issuer key the provider announced, as a string. */
function issuerKeyOf(fixture: Fixture): string {
  return fixture.provider.handshake['issuerKey'] as string
}

/** The first multiaddr an agent announced. */
function addrOf(agent: Spawned): string {
  return (agent.handshake['multiaddrs'] as string[])[0] as string
}

beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'o2-sov-agent-'))
})

/** 60 s, which must exceed `stopAgent`'s inner 10 s or its SIGKILL fallback could never fire. */
afterEach(async () => {
  await Promise.all(spawned.splice(0).map((agent) => stopAgent(agent).catch(() => {})))
  await rm(workdir, { recursive: true, force: true })
}, 60_000)

describe('AUTH-03/MR-02/VER-09 — bin/agent.ts coordinates a sovereign job over two owners', () => {
  it('dispatches each owner’s row to that owner’s own process under a chain rooted at that owner, and aggregates the partials', async () => {
    const fixture = await standUp()

    const coordinator = await spawnAgent('coordinator', [
      '--trusted-issuer',
      issuerKeyOf(fixture),
      '--peer-addr',
      addrOf(fixture.alice),
      '--peer-addr',
      addrOf(fixture.bob),
      '--sovereign-owner',
      fixture.aliceSeedPath,
      '--sovereign-row',
      fixture.aliceRowPath,
      '--sovereign-owner',
      fixture.bobSeedPath,
      '--sovereign-row',
      fixture.bobRowPath,
    ])

    // ---- What the coordinator says it is about to do -------------------------------
    const opening = (await coordinator.waitFor(
      (line) => 'coordinatingSovereign' in line,
      'a coordinatingSovereign line',
    ))['coordinatingSovereign'] as {
      owners: number
      rows: number
      candidates: string[]
      descriptorOwners: string[]
      inputCids: string[]
    }
    expect(opening.owners).toBe(2)
    expect(opening.rows).toBe(2)
    // **The candidate set is exactly the two owner processes**, which is the lookup half of
    // "the data never moved": neither owner holds the other's block, so neither answers as a
    // provider for it.
    expect([...opening.candidates].sort()).toStrictEqual(
      [fixture.alice.handshake['peerId'] as string, fixture.bob.handshake['peerId'] as string].sort(),
    )
    // **AUTH-03's placement half.** A discovery-derived `NodeDescriptor.ownerId` IS
    // `certificate.userKey` — a fact about a signed statement the coordinator verified, not
    // a value it chose. `publicNodes` would have written `'public'` here and every sovereign
    // shard would be `unplaceable`, which is exactly the state the demo page's
    // bring-your-own arm is measured in.
    expect([...opening.descriptorOwners].sort()).toStrictEqual([ALICE_USER_KEY, BOB_USER_KEY].sort())
    expect([...opening.inputCids].sort()).toStrictEqual([fixture.aliceCid, fixture.bobCid].sort())

    // ---- VER-09: the receipt, per shard --------------------------------------------
    const aggregation = (await coordinator.waitFor(
      (line) => 'sovereignAggregation' in line,
      'a sovereignAggregation line',
    ))['sovereignAggregation'] as {
      attempted: boolean
      ok?: boolean
      reason?: string
      combines?: number
      minReplicas?: number
      disagreements?: number
      coverage?: { covered: number; total: number; complete: boolean }
      contributors?: string[]
      egress?: { registeredSovereign: number; pinnedShards: number }
      total?: number | null
    }

    const attestations = coordinator.lines
      .filter((line) => 'sovereignAttestation' in line)
      .map(
        (line) =>
          line['sovereignAttestation'] as {
            partitionIndex: number
            ownerId: string | null
            status: string
            ranOn: string[]
            attempted: string[]
            count: number | null
            reading: string
          },
      )
    expect(attestations).toHaveLength(2)

    // **The receipt, asserted EQUAL rather than by substring.** `owner-attested`'s own
    // description ends *"not independently verified"*, so the obvious refusal of the
    // strongest label is a substring of the correct line — `sovereign-arm.node.test.ts`
    // records that as the reason its own assertion is an equality, and the same trap is here.
    const expectedReading = `owner-attested (replicas 1, operators 1) — ${describeAttestation('owner-attested')}`
    //
    // **The reading is asserted BEFORE the status**, deliberately: `strengthReading` renders
    // a shard that established nothing as `none established (…) — <the fabric's own reason>`,
    // so when this case is red the failure text carries *why* the fabric refused rather than
    // only that it did. Asserting `status` first reduces every refusal to `expected
    // 'insufficient' to be 'agreed'`, which is the same message whatever went wrong.
    for (const attestation of attestations) {
      expect(attestation.reading).toBe(expectedReading)
      expect(attestation.status).toBe('agreed')
    }

    // **AUTH-03's dispatch half: each shard ran on its own owner's process and on no other.**
    const byIndex = [...attestations].sort((a, b) => a.partitionIndex - b.partitionIndex)
    expect(byIndex.map((one) => one.ownerId)).toStrictEqual([ALICE_USER_KEY, BOB_USER_KEY])
    expect(byIndex.map((one) => one.ranOn)).toStrictEqual([
      [fixture.alice.handshake['peerId'] as string],
      [fixture.bob.handshake['peerId'] as string],
    ])
    // **The set ASKED, not the set that answered.** `sovereign-aggregation.node.test.ts`
    // measured that a foreign node offered the wrong owner's shard refuses it and the
    // generation loop then repairs the placement onto the right node — so `ranOn` alone stays
    // green through a widened eligibility gate. `attempted` cannot.
    expect(byIndex.map((one) => one.attempted)).toStrictEqual([
      [fixture.alice.handshake['peerId'] as string],
      [fixture.bob.handshake['peerId'] as string],
    ])

    // **MR-02's map half as arithmetic.** Each count is over the slice of that owner's own
    // bound the shipped partitioning gives it, and the two are unequal — so a fixture whose
    // guests had been handed the same row, or the other owner's row, produces different
    // numbers here. Both are differences of tabulated π values, quoted rather than computed.
    expect(byIndex.map((one) => one.count)).toStrictEqual([ALICE_COUNT, BOB_COUNT])

    // ---- MR-02: the aggregation over the two owners' partials -----------------------
    expect(aggregation.attempted).toBe(true)
    expect(aggregation.ok, JSON.stringify(aggregation)).toBe(true)
    expect(aggregation.combines).toBe(1)
    // The whole of the sovereign split's second half: the map cannot be redundant and the
    // aggregation must be.
    expect(aggregation.minReplicas).toBe(2)
    expect(aggregation.disagreements).toBe(0)
    // Coverage over owners, complete, derived from the partials that were admitted rather
    // than from the shards that were submitted.
    expect(aggregation.coverage).toStrictEqual({ covered: 2, total: 2, complete: true })
    expect([...(aggregation.contributors ?? [])].sort()).toStrictEqual(
      [ALICE_USER_KEY, BOB_USER_KEY].sort(),
    )
    // **EGR-01's reading, and it is the sovereignty claim rather than a footnote.** Two
    // owner-pinned rows were registered on the coordinator's guard for the job's duration and
    // no frame it was offered carried one. A guard reporting zero registrations for a job
    // with sovereign shards is a guard that was never given them, which is the difference
    // this figure exists to make visible.
    expect(aggregation.egress).toStrictEqual({ registeredSovereign: 2, pinnedShards: 2 })

    // **The number.** The root of the tree is the sum of two counts, each produced by a
    // different operating-system process over a row only that process held, and read back
    // out of the block a combine node wrote. Both terms are differences of tabulated π
    // values — see {@link ALICE_COUNT} for the partition arithmetic that decides which
    // slice each owner's guest counted.
    const expectedTotal = ALICE_COUNT + BOB_COUNT
    expect(aggregation.total).toBe(expectedTotal)
    // Decomposable, so a fixture that had read one row twice cannot pass: the sum is not
    // 2×either contribution, because the two contributions are unequal.
    expect(ALICE_COUNT).not.toBe(BOB_COUNT)
    expect(aggregation.total).not.toBe(ALICE_COUNT * 2)
    expect(aggregation.total).not.toBe(BOB_COUNT * 2)

    // ---- The far-side reading: neither owner's node ever held the other's row --------
    //
    // Taken after each process is stopped, so its own writes have landed. A node that had
    // fetched the other row to compute over it would hold it.
    await stopAgentNow(fixture.alice)
    await stopAgentNow(fixture.bob)
    const { CID } = await import('multiformats/cid')
    const aliceStore = await FsBlockstore.open(fixture.alice.dir)
    const bobStore = await FsBlockstore.open(fixture.bob.dir)
    // Not a vacuous reading of an empty or unreadable directory: each holds its own row and
    // the module it computed over it with.
    expect(await aliceStore.has(CID.parse(fixture.aliceCid))).toBe(true)
    expect(await bobStore.has(CID.parse(fixture.bobCid))).toBe(true)
    expect(await aliceStore.has(PRIMES_RECORD.cid)).toBe(true)
    // And the claim itself.
    expect(await aliceStore.has(CID.parse(fixture.bobCid))).toBe(false)
    expect(await bobStore.has(CID.parse(fixture.aliceCid))).toBe(false)
  }, PROCESS_TEST_TIMEOUT)
})

describe('the sovereign coordinator refuses a configuration it could only fail on', () => {
  /**
   * Each of these is a command line that would otherwise start a node, bind a socket, dial
   * peers, and then produce nothing — the `unplaceable`-with-nothing-obviously-wrong failure
   * `--owner-id`'s own docblock records the cost of. Exit 2 and the usage line is the answer
   * to a misconfiguration; the reason comes first so an operator reads which input was
   * refused before reading the grammar.
   */
  it('refuses unpaired --sovereign-owner/--sovereign-row', async () => {
    const dir = join(workdir, 'refused')
    const seed = await writeKeyFile('solo', ALICE_PRIVATE_KEY)
    const run = await runAgent(['--dir', dir, '--sovereign-owner', seed])
    expect(run.code).toBe(2)
    expect(run.stderr).toContain('they are read in order and pair one row to one owner')
    expect(run.stderr).toContain('usage: agent.ts')
  })

  it('refuses a single contribution, which is promoted rather than combined', async () => {
    const dir = join(workdir, 'refused')
    const seed = await writeKeyFile('solo', ALICE_PRIVATE_KEY)
    const row = join(workdir, 'solo.row')
    await writeFile(row, buildPrimesInput(ALICE_BOUND))
    const run = await runAgent([
      '--dir',
      dir,
      '--sovereign-owner',
      seed,
      '--sovereign-row',
      row,
      '--peer-addr',
      '/ip4/127.0.0.1/tcp/1',
      '--trusted-issuer',
      'a'.repeat(64),
    ])
    expect(run.code).toBe(2)
    expect(run.stderr).toContain('promoted rather than combined')
  })

  it('refuses a coordinator that pins no issuer, because it would qualify nobody', async () => {
    const dir = join(workdir, 'refused')
    const seed = await writeKeyFile('solo', ALICE_PRIVATE_KEY)
    const row = join(workdir, 'solo.row')
    await writeFile(row, buildPrimesInput(ALICE_BOUND))
    const run = await runAgent([
      '--dir',
      dir,
      '--sovereign-owner',
      seed,
      '--sovereign-row',
      row,
      '--sovereign-owner',
      seed,
      '--sovereign-row',
      row,
      '--peer-addr',
      '/ip4/127.0.0.1/tcp/1',
    ])
    expect(run.code).toBe(2)
    expect(run.stderr).toContain('requires at least one --trusted-issuer')
  })
})
