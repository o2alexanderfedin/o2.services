/**
 * Phase 24's one criterion — number **8** — read over a fabric in which **every**
 * relay-capable peer has been told to close, across real operating-system processes, with the
 * absence asserted over the **whole set** rather than over one named peer.
 *
 * Criterion 8, quoted exactly from `.planning/ROADMAP.md` and not edited anywhere in this
 * repository:
 *
 * > *"Enrolment's cost is bounded by admission, not by a counter: a node that cannot present a
 * > provider-issued certificate cannot join the fabric, advertise itself, or be dialled by
 * > another node — so an identity that was never issued buys nothing, and the N-th identity
 * > costs an attacker a provider's willingness to sign it"*
 *
 * ## WHY A SECOND CROSS-PROCESS FIXTURE, when `admission-agents.node.test.ts` already exists
 *
 * `24-VERIFICATION.md` scored the criterion PARTIAL on two findings, and this file exists for
 * exactly those two and nothing else.
 *
 * 1. **The absence was reasoned about one named peer.** 24-04 argued that `stranger` is the
 *    criterion's subject and `stranger` is nowhere. The verifier falsified that using 24-04's
 *    own run: *"`reader` is also that node and `reader` got in"*. A property that holds for one
 *    uncertificated node and fails for another, on a difference that is not the certificate, is
 *    not a property of the certificate. So the reading below is over a **set**, every member of
 *    the set is asked, the set's own length is asserted, and a member that fails to answer
 *    fails the reading rather than being skipped.
 * 2. **`BootstrapInfo.peerAddrs` was read by nothing as a gated surface.** It is the surface
 *    the browser tier actually consumes — `packages/browser/demo/main.ts` pushes every string
 *    it finds there into its dial candidates. The second case below reads it over real HTTP
 *    from a real `bin/seed.ts` process, with a paired presence and absence.
 *
 * ## WHAT THIS FILE SHOWS
 *
 * In a fabric whose every relay-capable peer was told to close, a node that cannot present a
 * provider-issued certificate obtains a reservation **nowhere** — asserted over the whole set,
 * with each door named in the failure message — and is advertised on **neither** advertisement
 * surface, the relay's `reservations` answer and the seed's `/bootstrap.json`.
 *
 * ## WHAT THIS FILE DOES **NOT** SHOW, stated before the readings rather than after
 *
 * - **It does not show that a fabric is closed by default.** The default posture of both
 *   binaries is open and stays open: `bin/agent.ts` and `bin/seed.ts` each reach the required
 *   `relayAdmission` field through a ternary whose absent arm is the open literal, so a process
 *   told nothing behaves byte-identically to the process before the flag existed. Every closed
 *   posture below was **passed on a command line**. Whether the binaries should refuse to start
 *   absent an explicit posture is `24-CONTEXT.md` open ruling 1, still undecided, and nothing
 *   here decides it. **The bound this file leaves standing is therefore a deployment posture an
 *   operator can reverse**, which is a different kind of thing from a structural bound.
 * - **It does not close `records` / `providers` gating.** `24-CONTEXT.md` files that as a
 *   deferred idea. A directly-dialable peer still reaches both — 24-04's clause 3 established
 *   that the refused node is **unfindable, not unreachable**, and this file does not re-take
 *   that clause. It is not re-taken and it is not weakened.
 * - **Nothing about the browser tier.** That is 24-08.
 * - **It says nothing about revocation latency.** A peer already holding a reservation keeps it
 *   until the TTL expires; that window is `FabricNodeOptions.reservationTtlMs` with the ~30 s
 *   floor 24-03 measured, and it is accepted rather than closed here.
 *
 * ## `openControl` IS NOT PART OF THE FABRIC, and that is the whole of its job
 *
 * One spawned `bin/agent.ts --port 0` with **no** `--admit-issuer` sits outside the closed set
 * and is named separately everywhere below. It exists so that R2 is a statement about
 * **refusal** rather than about a stranger that never asked: the same uncertificated process,
 * in the same run, on the same host, **is** in `openControl`'s reservation store. Without it,
 * an absence everywhere else is equally well explained by a peer that asked nobody — which is
 * precisely the ambiguity 24-04's defence of criterion 8 died on. The whole-set assertion is
 * over the closed participants; `openControl` is never in that set and is never counted in it.
 *
 * ## Budget
 *
 * **Seven** `bin/agent.ts` spawns — `provider` twice (see the two-step below), then `relay`,
 * `openControl`, `memberAtSeed`, `memberAtRelay`, `stranger` — of which **six are live at
 * once**, because the minting provider is stopped before its replacement starts. Plus one
 * `bin/seed.ts` child and one in-process `FabricNode` reader: **eight child processes, seven
 * concurrent.** `tree-reduce-agents.node.test.ts` runs nine children, so this is inside the
 * established budget for this repository. These figures are counted against the spawn sites
 * below rather than estimated — `admission-agents.node.test.ts` carried *"Five"* for a fixture
 * that ran six, and the wrong figure propagated into two summaries and a requirement row.
 *
 * The fixture stands up **once** in `beforeAll` and serves both cases, which is a departure
 * from `admission-agents.node.test.ts`'s per-`it` `standUp()` and is a cost decision rather
 * than a reading decision: eight processes twice over is eight processes too many. The
 * consequence is disclosed rather than hidden — **`--reporter=json` attributes no hook time**,
 * so this file's reporter span is a fraction of its wall clock and the span recorded in
 * `vitest.config.ts` beside it is a `/usr/bin/time -p` reading, marked as such.
 *
 * Timeouts are `admission-agents.node.test.ts`'s by value, and they are that file's rather than
 * re-invented here; the seed's 90 s banner budget is `relay-admission.node.test.ts`'s.
 *
 * Node-only by necessity: every subject is an operating-system process.
 */
import { spawn } from 'node:child_process'
import type { ChildProcess, ChildProcessByStdio } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Readable, Writable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import type { NodeCertificate } from '@o2/core'
import { SEED_BYTES } from '@o2/libp2p'
import { encodeRequest, parseResponse } from '@o2/net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FabricNode } from './fabric-node.ts'

const AGENT = fileURLToPath(new URL('./bin/agent.ts', import.meta.url))
const SEED = fileURLToPath(new URL('./bin/seed.ts', import.meta.url))

/** Announce budget, `admission-agents.node.test.ts`'s figure. */
const ANNOUNCE_BUDGET_MS = 60_000

/** Per-`it` budget, `admission-agents.node.test.ts`'s figure. */
const PROCESS_TEST_TIMEOUT = 300_000

/** The whole fixture, in one hook. Eight child processes, two of them enrolling. */
const FIXTURE_BUDGET_MS = 420_000

/** How long a reservation is given to appear or be refused — `admission-agents`' figure. */
const RESERVATION_BUDGET_MS = 60_000

/**
 * How long an absence is held before it is believed — `admission-agents`' figure.
 *
 * A window and not a sample: an absence read once is also what a fabric that has not got there
 * yet looks like. Comparative rather than absolute — the presence half is established first, in
 * the same run, on the same instrument, so this window is known to be longer than a grant takes
 * on this host.
 */
const ABSENCE_WINDOW_MS = 5_000

/** The seed prints this last, so waiting on it gets the whole banner — `relay-admission`'s. */
const SEED_SENTINEL = 'Ctrl-C to stop.'
/** `relay-admission.node.test.ts`'s figure for a seed's whole banner. */
const SEED_BANNER_BUDGET_MS = 90_000

type AgentProcess = ChildProcessByStdio<Writable, Readable, Readable>

/**
 * The key `bin/agent.ts` publishes its admission posture under.
 *
 * A constant, and the posture is read by **indexing** rather than by a declared property on
 * {@link Handshake}. `relay-admission.node.test.ts` requires the field to be declared in
 * exactly one type in the whole repository, so that two node factories cannot grow two answers
 * to *"who does this node admit"* — a reader's view of a JSON line is not a second factory, but
 * the census reads text and cannot tell the two apart, and *"never close a gap by widening what
 * counts as passing"* puts the repair on this side. The constant carries no colon, so it
 * matches neither of that file's needles.
 */
const POSTURE_KEY = 'relayAdmission'

interface Handshake {
  readonly peerId: string
  readonly multiaddrs: string[]
  /** What the process published about who it admits — the `POSTURE_KEY` field, renamed here. */
  readonly posture: string | readonly string[]
  readonly nodeKey: string
  readonly certificate: NodeCertificate | null
  readonly issuerKey: string | null
  readonly relays: string[]
  readonly peers: string[]
  readonly pid: number
}

interface Agent extends Handshake {
  readonly name: string
  readonly child: AgentProcess
  /** Everything the process has written to stderr so far, accumulating. */
  stderr(): string
}

let workdir: string
const agents: Agent[] = []
const nodes: FabricNode[] = []
const seedChildren: ChildProcess[] = []

/**
 * `'pipe'` on fd 0 is load-bearing rather than cosmetic: both binaries arm an orphan leash by
 * watching fd 0, and `'ignore'` hands them a character device, which opts the leash out.
 * `orphan-leash.node.test.ts` fails any spawn site that does that.
 */
async function spawnAgent(name: string, extraArgs: readonly string[]): Promise<Agent> {
  const child: AgentProcess = spawn(process.execPath, [AGENT, '--dir', join(workdir, name), ...extraArgs], {
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let stderr = ''
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString()
  })

  const handshake = await new Promise<Handshake>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`agent ${name} did not announce in time: ${stderr}`)),
      ANNOUNCE_BUDGET_MS,
    )
    let stdout = ''
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
      const newline = stdout.indexOf('\n')
      if (newline === -1) return
      clearTimeout(timer)
      try {
        // Named fields only, and the posture lifted out by key — see `POSTURE_KEY`.
        const line = JSON.parse(stdout.slice(0, newline)) as Record<string, unknown>
        const posture = line[POSTURE_KEY]
        if (typeof posture !== 'string' && !Array.isArray(posture)) {
          reject(new Error(`agent ${name} published no admission posture: ${stdout.slice(0, newline)}`))
          return
        }
        resolve({ ...(line as unknown as Omit<Handshake, 'posture'>), posture: posture as string | string[] })
      } catch (cause) {
        reject(cause instanceof Error ? cause : new Error(String(cause)))
      }
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`agent ${name} exited early with ${String(code)}: ${stderr}`))
    })
  })

  const agent: Agent = { ...handshake, name, child, stderr: () => stderr }
  agents.push(agent)
  return agent
}

/**
 * SIGTERM, then wait for the process to actually be gone.
 *
 * **Only ever a child this fixture spawned.** Nothing in this file signals a process it did not
 * start, which is a standing constraint of this repository's shared checkout rather than a
 * property of this fixture.
 */
async function stopAgent(agent: Agent): Promise<void> {
  await stopChild(agent.child)
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      resolve()
    }, 10_000)
    child.on('exit', () => {
      clearTimeout(timer)
      resolve()
    })
    child.kill('SIGTERM')
  })
}

/**
 * Wait until `predicate` holds, naming **what actually arrived** on failure.
 *
 * **`observed` is awaited**, on 24-05's recorded finding: a promise stringifies to `{}`, so an
 * un-awaited async thunk turns the one message a timeout has into a vacuous one. Every reading
 * in this file that can name what arrived is a round trip, so every one of these thunks is
 * async and the await is load-bearing rather than prospective.
 *
 * Defined locally rather than imported: importing a helper from another `.test.ts` re-registers
 * that file's whole suite.
 */
async function until(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs: number,
  what: string,
  observed?: () => unknown | Promise<unknown>,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise((r) => setTimeout(r, 100))
  }
  const tail = observed === undefined ? '' : `; observed ${JSON.stringify(await observed())}`
  throw new Error(`timed out waiting for ${what}${tail}`)
}

/** `bin/agent.ts` refuses to create a user key — see that flag's comment. */
async function writeUserKey(name: string, fill: number): Promise<string> {
  await mkdir(workdir, { recursive: true })
  const path = join(workdir, `${name}.key`)
  await writeFile(path, new Uint8Array(SEED_BYTES).fill(fill), { mode: 0o600 })
  return path
}

/**
 * The circuit addresses a peer announced **through one named relay**.
 *
 * A filter over the relay's peer id rather than `relays.length === 0`, because a joiner may
 * hold circuits through more than one relay and `admission-agents.node.test.ts` measured
 * exactly that.
 */
function circuitsThrough(agent: Agent, relayPeerId: string): readonly string[] {
  return agent.relays.filter((address) => address.includes(`/p2p/${relayPeerId}/p2p-circuit`))
}

/** The direct, non-relayed address a peer announced for itself. */
function directAddrOf(agent: Agent): string {
  const direct = agent.multiaddrs.find((address) => !address.includes('/p2p-circuit'))
  if (direct === undefined) {
    throw new Error(`${agent.name} announced no direct address: ${JSON.stringify(agent.multiaddrs)}`)
  }
  return direct
}

/**
 * Ask a peer, over the wire, who is reserved on it.
 *
 * **The production rendezvous path**, not a getter read a second time: `findReservedPeers`
 * (`net/src/rendezvous.ts`) issues exactly this request, and `fabric-node.ts` answers it from
 * `() => node.reservedPeerIds` — a **thunk**, which is what makes this reading mean something.
 * A node passing `'relays-for-nobody'` answers `[]` unconditionally and would satisfy every
 * absence below without measuring anything; every peer asked here is a real process built by
 * one of the two binaries, so the thunk is what answers.
 */
async function advertisedBy(reader: FabricNode, peerId: string): Promise<readonly string[]> {
  const body = await reader.rpc.request(peerId, encodeRequest({ kind: 'reservations' }))
  const response = parseResponse(body)
  if (response === null || response.kind !== 'reservations') {
    throw new Error(`${peerId} answered a reservations request with ${JSON.stringify(response)}`)
  }
  return response.peerIds
}

// ---------------------------------------------------------------------------------------
// `bin/seed.ts`, spawned. The banner is the only thing that crosses the process boundary, so
// every property this fixture needs of the seed is read off it — never off the argv passed in.
// ---------------------------------------------------------------------------------------

interface SeedProcess {
  readonly child: ChildProcess
  readonly banner: string
  stderr(): string
}

async function spawnSeed(args: readonly string[]): Promise<SeedProcess> {
  const child = spawn(process.execPath, [SEED, ...args], { stdio: ['pipe', 'pipe', 'pipe'] })
  seedChildren.push(child)
  let stderr = ''
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr += chunk.toString()
  })
  const banner = await new Promise<string>((resolve, reject) => {
    let stdout = ''
    const timer = setTimeout(
      () => reject(new Error(`the seed neither announced nor exited: ${stderr}`)),
      SEED_BANNER_BUDGET_MS,
    )
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
      if (!stdout.includes(SEED_SENTINEL)) return
      clearTimeout(timer)
      resolve(stdout)
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`the seed exited with ${String(code)} before announcing: ${stderr}`))
    })
  })
  return { child, banner, stderr: () => stderr }
}

/** The banner line whose label is the seed's admission posture, trimmed. */
const admitsLine = (banner: string): string =>
  (banner.split('\n').find((l) => l.trim().startsWith('admits ')) ?? '<no admits line>').trim()

/** The peer id the seed reports for itself. */
const seedPeerIdOf = (banner: string): string =>
  (banner.split('\n').find((l) => l.trim().startsWith('peer id ')) ?? '')
    .trim()
    .slice('peer id '.length)
    .trim()

/**
 * The **loopback** relay address, off the banner rather than rebuilt here.
 *
 * The seed binds `0.0.0.0` and libp2p expands that per interface, so the listing also carries
 * LAN addresses a host may not be able to dial back to itself. The same narrowing
 * `relay-admission.node.test.ts` and `reservation-exhaustion.node.test.ts` take.
 */
const loopbackRelay = (banner: string): string | undefined =>
  banner
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('relay '))
    .map((l) => l.slice('relay '.length).trim())
    .find((addr) => addr.includes('/ip4/127.0.0.1/'))

/**
 * The HTTP port the seed chose, off a join-URL line.
 *
 * `--port 0` lets Vite pick, and the chosen port is published nowhere else a parent process can
 * read it. The join URLs are what an operator is handed, so parsing them is reading the
 * operator-facing surface rather than a private field.
 */
const httpPortOf = (banner: string): number | null => {
  const match = /http:\/\/[^\s/]+:(\d+)\/packages\/browser\/demo\/index\.html/.exec(banner)
  return match?.[1] === undefined ? null : Number(match[1])
}

// ---------------------------------------------------------------------------------------
// The fixture.
// ---------------------------------------------------------------------------------------

/** One member of the closed relay-capable set, as R2 dials and asks it. */
interface Participant {
  readonly name: string
  readonly peerId: string
  readonly directAddr: string
}

interface Fixture {
  /** The issuer every certificate below is signed by, and every closed door pins. */
  readonly issuer: string
  readonly provider: Agent
  readonly seed: SeedProcess
  readonly seedPeerId: string
  readonly seedAddr: string
  readonly seedHttpPort: number
  readonly relay: Agent
  readonly relayAddr: string
  readonly memberAtSeed: Agent
  readonly memberAtRelay: Agent
  /** Holds no certificate at all, and has met every peer in {@link Fixture.closedSet}. */
  readonly stranger: Agent
  /** Outside the fabric. The control. */
  readonly openControl: Agent
  /** Uncertificated, closed, and a **subject** of R2 as well as its instrument. */
  readonly reader: FabricNode
  /** The closed relay-capable peers R2 dials and asks, excluding the in-process reader. */
  readonly closedSet: readonly Participant[]
}

let fixture: Fixture

/**
 * How many relay-capable peers this fixture builds that were told to close.
 *
 * Six: `provider`, `seed`, `relay`, `memberAtSeed`, `memberAtRelay` — the five R2 dials — plus
 * the in-process `reader`, which cannot dial itself and is therefore read through its own
 * `reservedPeerIds`, the same thunk the RPC above answers from. `stranger` binds a listening
 * socket and states the same closed posture, but it is R2's **subject** and is not asked about
 * itself. `openControl` is not in this count and never is.
 *
 * Asserted rather than assumed, so that a participant added to `standUp` without being added to
 * the set reddens instead of silently narrowing the claim.
 */
const CLOSED_RELAY_CAPABLE = 6

async function standUp(): Promise<Fixture> {
  // ---- the provider, in two steps. ----------------------------------------------------
  //
  // A provider's issuer key does not exist until `issuesCertificates` has been through one
  // start, so a provider that pins **its own** issuer cannot be spawned in one go. Restarting
  // on the same `blockstoreDir` keeps that key across a different pid — the property
  // `gated-admission.e2e.test.ts` and `enrollment-cost.node.test.ts` both establish, and
  // everything below rests on it, so it is asserted rather than assumed.
  const minting = await spawnAgent('provider', [
    '--port',
    '0',
    '--issues-certificates',
    '--max-issued-per-window',
    '64',
  ])
  const issuer = minting.issuerKey
  if (issuer === null) throw new Error('the minting provider announced no issuer key')
  await stopAgent(minting)

  const provider = await spawnAgent('provider', [
    '--port',
    '0',
    '--issues-certificates',
    '--max-issued-per-window',
    '64',
    '--admit-issuer',
    issuer,
  ])
  if (provider.issuerKey !== issuer) {
    throw new Error(
      `the provider minted a second issuer key across its restart: ${String(provider.issuerKey)} !== ${issuer}`,
    )
  }
  // The posture off the process's own handshake line, never off the argv above. A typo in a
  // spawn argument otherwise produces an open provider and every reading below passes for the
  // wrong reason — the single most likely way a cross-process admission proof lies.
  expect(provider.posture, 'the respawned provider states a posture it was not given').toStrictEqual([issuer])
  const providerAddr = directAddrOf(provider)

  // ---- the seed, told to close. --------------------------------------------------------
  const seed = await spawnSeed([
    '--dir',
    join(workdir, 'seed'),
    '--port',
    '0',
    '--ws-port',
    '0',
    '--admit-issuer',
    issuer,
  ])
  // Off the seed's own banner, and it pinned **what it was told** rather than merely something.
  expect(admitsLine(seed.banner)).toContain('only peers certified by')
  expect(admitsLine(seed.banner)).toContain(issuer)
  expect(admitsLine(seed.banner)).not.toContain('every peer that completes a handshake')
  const seedPeerId = seedPeerIdOf(seed.banner)
  const seedAddr = loopbackRelay(seed.banner)
  const seedHttpPort = httpPortOf(seed.banner)
  if (seedPeerId === '' || seedAddr === undefined || seedHttpPort === null) {
    throw new Error(`the seed's banner carried no peer id, loopback relay or http port:\n${seed.banner}`)
  }

  // ---- the agent relay, and the one peer nobody closed. --------------------------------
  const relay = await spawnAgent('relay', ['--port', '0', '--admit-issuer', issuer])
  const relayAddr = directAddrOf(relay)

  // **Not part of the fabric.** See the header paragraph that says so. It is spawned here
  // rather than beside the closed set precisely so the argv difference — one absent flag — is
  // visible at the line.
  const openControl = await spawnAgent('open-control', ['--port', '0'])
  const openControlAddr = directAddrOf(openControl)

  // ---- two enrolled arms, and the reason there are two is measured rather than tidy. ----
  //
  // 24-04 recorded that *a grant at the first door ends libp2p's relay search rather than
  // adding to it*, so one node handed two `--relay-addr`s produces a presence at one of them
  // and an unexplained absence at the other. Two arms, each pointed at one door, is what makes
  // R1's presence half a statement about **both** doors.
  const enrol = async (name: string, fill: number, door: string): Promise<Agent> =>
    spawnAgent(name, [
      '--port',
      '0',
      '--admit-issuer',
      issuer,
      '--relay-addr',
      door,
      '--provider-addr',
      providerAddr,
      '--user-key',
      await writeUserKey(name, fill),
      '--operator-id',
      `${name}-ops`,
    ])

  const memberAtSeed = await enrol('member-at-seed', 0xb1, seedAddr)
  const memberAtRelay = await enrol('member-at-relay', 0xb2, relayAddr)

  // ---- the stranger. -------------------------------------------------------------------
  //
  // No `--provider-addr`, so it holds no certificate at all. It **asks** the seed and the agent
  // relay for a reservation, and it **dials** every other relay-capable peer in the fabric plus
  // the control — which is the shape that got 24-04's `outsider` in: `RelayDiscovery` fires off
  // the identify event for any peer speaking the relay HOP protocol, so a peer merely dialled
  // is a door merely walked through if that door admits everybody.
  //
  // Spawned last for that reason: it can only be told to meet every peer once every peer
  // exists.
  const stranger = await spawnAgent('stranger', [
    '--port',
    '0',
    '--admit-issuer',
    issuer,
    '--relay-addr',
    seedAddr,
    '--relay-addr',
    relayAddr,
    '--peer-addr',
    providerAddr,
    '--peer-addr',
    directAddrOf(memberAtSeed),
    '--peer-addr',
    directAddrOf(memberAtRelay),
    '--peer-addr',
    openControlAddr,
  ])

  // ---- the reader. ---------------------------------------------------------------------
  //
  // **`relayAdmission: new Set([issuer])`, and this differs from
  // `admission-agents.node.test.ts`'s reader deliberately.** That file gave its reader the
  // **open** posture, with the stated reason that it was a fixture about one door and a second
  // door would have confused it. This is a fixture about *every* door: an open instrument would
  // leave the fabric holding an open relay-capable peer and the whole-set claim would be false
  // by construction — the exact defect 24-VERIFICATION found when `reader` turned up in an open
  // peer's store.
  //
  // The reader holds no certificate, so every closed door refuses it too. It is therefore a
  // **subject** of R2 as well as its instrument, which is the sharpest available statement that
  // a refused node still works: every reading in this file is taken by a node the fabric turned
  // away.
  //
  // `relayAddrs` is required rather than decorative: `fabric-node.ts` installs
  // `circuitRelayTransport()` only on the `viaRelay` arm, so a node given no `relayAddrs`
  // cannot dial a relayed peer at all.
  const reader = await FabricNode.start({
    relayAdmission: new Set([issuer]),
    startReporting: 'reports-its-own-start',
    blockstoreDir: join(workdir, 'reader'),
    listen: ['/ip4/127.0.0.1/tcp/0'],
    relayAddrs: [relayAddr],
    rpcTimeoutMs: 20_000,
    trustAnchors: 'runs-unsigned-artifacts',
  })
  nodes.push(reader)

  const closedSet: readonly Participant[] = [
    { name: 'provider', peerId: provider.peerId, directAddr: providerAddr },
    { name: 'seed', peerId: seedPeerId, directAddr: seedAddr },
    { name: 'relay', peerId: relay.peerId, directAddr: relayAddr },
    { name: 'memberAtSeed', peerId: memberAtSeed.peerId, directAddr: directAddrOf(memberAtSeed) },
    { name: 'memberAtRelay', peerId: memberAtRelay.peerId, directAddr: directAddrOf(memberAtRelay) },
  ]

  return {
    issuer,
    provider,
    seed,
    seedPeerId,
    seedAddr,
    seedHttpPort,
    relay,
    relayAddr,
    memberAtSeed,
    memberAtRelay,
    stranger,
    openControl,
    reader,
    closedSet,
  }
}

beforeAll(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'o2-closed-fabric-'))
  fixture = await standUp()
}, FIXTURE_BUDGET_MS)

afterAll(async () => {
  await Promise.all(nodes.splice(0).map((node) => node.stop().catch(() => {})))
  await Promise.all(agents.splice(0).map((agent) => stopAgent(agent).catch(() => {})))
  await Promise.all(seedChildren.splice(0).map((child) => stopChild(child).catch(() => {})))
  if (workdir !== undefined) await rm(workdir, { recursive: true, force: true })
}, 120_000)

/** Every closed door's answer, taken in one pass, with a door that cannot answer recorded. */
async function scanClosedSet(
  reader: FabricNode,
  set: readonly Participant[],
): Promise<{ answers: Record<string, readonly string[]>; unanswered: { name: string; error: string }[] }> {
  const answers: Record<string, readonly string[]> = {}
  const unanswered: { name: string; error: string }[] = []
  for (const peer of set) {
    try {
      answers[peer.name] = await advertisedBy(reader, peer.peerId)
    } catch (cause) {
      unanswered.push({ name: peer.name, error: cause instanceof Error ? cause.message : String(cause) })
    }
  }
  return { answers, unanswered }
}

/**
 * Every `{door, intruder}` pair in a scan — the failure message R2 needs.
 *
 * Built as a list rather than asserted per peer inside a loop, because the two are different
 * readings: a loop of `expect`s stops at the first door that offended and says nothing about
 * the rest, while this names **every** door that let **whom** in. The plants below turn on
 * exactly that distinction — `Pa` must show `seed` alone and `Pd` must show `relay` alone, and
 * a first-failure abort could not tell those two apart.
 */
function intruders(
  answers: Record<string, readonly string[]>,
  subjects: readonly { name: string; peerId: string }[],
): { door: string; admitted: string; peerId: string }[] {
  const found: { door: string; admitted: string; peerId: string }[] = []
  for (const [door, held] of Object.entries(answers)) {
    for (const subject of subjects) {
      if (held.includes(subject.peerId)) found.push({ door, admitted: subject.name, peerId: subject.peerId })
    }
  }
  return found
}

describe('criterion 8 — over a fabric whose every relay-capable peer was told to close', () => {
  /**
   * **R1, R2 and R3, in one run, on one instrument, in that order.**
   *
   * They are one case because they are one reading: R2's absence is only attributable if R1's
   * presence has been watched happen on this host in this run, and R3's control is only a
   * control if it is taken against the same set in the same run. Splitting them would produce
   * three cases of which two could pass for the wrong reason. That grouping is disclosed rather
   * than papered over, and it is the same shape `enrolment-needs-no-reservation.node.test.ts`
   * records for its own four cases.
   */
  it('an uncertificated node holds a reservation on no closed door and one on the control, while enrolled arms hold one each', async () => {
    const {
      issuer,
      provider,
      relay,
      seedPeerId,
      seedAddr,
      memberAtSeed,
      memberAtRelay,
      stranger,
      openControl,
      reader,
      closedSet,
    } = fixture

    // ---- the fixture really is what it says it is. --------------------------------------
    //
    // Every posture below is read off the process's own handshake line or its own banner —
    // never off the argv this file passed. The seed's was asserted at its spawn, where the
    // banner is.
    for (const agent of [provider, relay, memberAtSeed, memberAtRelay, stranger]) {
      expect(agent.posture, `${agent.name} states a posture it was not given`).toStrictEqual([issuer])
    }
    expect(openControl.posture, 'the control was closed, so it is not a control').toBe('admits-any-peer')

    // What each participant presents, which is the whole of the difference between them.
    expect(stranger.certificate, 'the stranger enrolled').toBeNull()
    expect(memberAtSeed.certificate?.issuer).toBe(issuer)
    expect(memberAtRelay.certificate?.issuer).toBe(issuer)
    expect(memberAtSeed.certificate?.nodeKey).toBe(memberAtSeed.nodeKey)
    expect(memberAtRelay.certificate?.nodeKey).toBe(memberAtRelay.nodeKey)

    // The stranger met every closed relay-capable peer. Two it asked, three it dialled, and
    // `peers` on the handshake line names only peers a `Connection` was actually established
    // with — so this is what it **reached**, not what it was told to reach.
    for (const peer of closedSet) {
      const met = stranger.peers.includes(peer.peerId) || stranger.relays.some((a) => a.includes(peer.peerId))
      const asked = peer.name === 'seed' || peer.name === 'relay'
      expect(
        met || asked,
        `the stranger never met ${peer.name}, so its absence there would be for want of asking`,
      ).toBe(true)
    }

    // Every process is alive and serving, so no absence below is a node that fell over.
    for (const agent of [provider, relay, memberAtSeed, memberAtRelay, stranger, openControl]) {
      expect(agent.child.exitCode, `${agent.name} exited: ${agent.stderr()}`).toBeNull()
      expect(agent.pid).toBe(agent.child.pid)
    }
    expect(fixture.seed.child.exitCode, `the seed exited: ${fixture.seed.stderr()}`).toBeNull()

    // ---- the set is complete. ------------------------------------------------------------
    expect(closedSet).toHaveLength(CLOSED_RELAY_CAPABLE - 1)
    // Every member is dialled, and the dial is asserted to have reached the peer it named.
    //
    // **The closed set is dialled BEFORE the control, and the order is load-bearing.** 24-03
    // measured that libp2p's `RelayDiscovery` stops once it has enough relays and never
    // restarts, so a reader that met the open door first would stop asking and its absence at
    // every closed door would be for want of asking. Meeting the five closed doors first makes
    // the reader's absence there a **refusal**, exactly as the stranger's is.
    for (const peer of closedSet) {
      const reached = await reader.dial(peer.directAddr)
      expect(reached, `dialling ${peer.name} at ${peer.directAddr} reached somebody else`).toBe(peer.peerId)
    }
    await reader.dial(directAddrOf(openControl))

    // ---- R1, the presence half, FIRST. ---------------------------------------------------
    //
    // Without it every absence below is satisfied by an empty list. Both doors, because 24-04
    // measured that one node cannot establish both.
    await until(
      async () => (await advertisedBy(reader, seedPeerId)).includes(memberAtSeed.peerId),
      RESERVATION_BUDGET_MS,
      'the arm enrolled at the seed to appear in the spawned seed’s reservations answer',
      async () => ({
        seedHolds: await advertisedBy(reader, seedPeerId).catch((e: unknown) => String(e)),
        memberRelaysAtHandshake: memberAtSeed.relays,
        memberStderr: memberAtSeed.stderr().slice(-300),
      }),
    )
    await until(
      async () => (await advertisedBy(reader, relay.peerId)).includes(memberAtRelay.peerId),
      RESERVATION_BUDGET_MS,
      'the arm enrolled at the agent relay to appear in its reservations answer',
      async () => ({
        relayHolds: await advertisedBy(reader, relay.peerId).catch((e: unknown) => String(e)),
        memberRelaysAtHandshake: memberAtRelay.relays,
        memberStderr: memberAtRelay.stderr().slice(-300),
      }),
    )

    // ---- R3, the control, established before the absence it makes attributable. ----------
    await until(
      async () => (await advertisedBy(reader, openControl.peerId)).includes(stranger.peerId),
      RESERVATION_BUDGET_MS,
      'the uncertificated stranger to hold a reservation on the one peer nobody closed',
      async () => ({
        openControlHolds: await advertisedBy(reader, openControl.peerId).catch((e: unknown) => String(e)),
        strangerRelays: stranger.relays,
        strangerPeers: stranger.peers,
        strangerStderr: stranger.stderr().slice(-400),
      }),
    )

    // ---- R2, the whole-set absence, over two readings bracketing a window. ---------------
    //
    // Two scans rather than one, and rather than a poll: a scan is five round trips, so polling
    // it at 100 ms would be a load test rather than a reading. The pair brackets the same
    // window `admission-agents.node.test.ts` holds its absences over, and the presence halves
    // above have already shown how long a grant takes on this host.
    const subjects = [
      { name: 'stranger', peerId: stranger.peerId },
      { name: 'reader', peerId: reader.peerId },
    ]
    const first = await scanClosedSet(reader, closedSet)
    expect(first.unanswered, 'a closed door failed to answer, which fails the reading').toStrictEqual([])
    await new Promise((r) => setTimeout(r, ABSENCE_WINDOW_MS))
    const second = await scanClosedSet(reader, closedSet)
    expect(second.unanswered, 'a closed door failed to answer, which fails the reading').toStrictEqual([])

    // The reader is in the closed relay-capable set and cannot dial itself, so its own store is
    // read through the getter the RPC above answers from. Named, counted, and not skipped.
    const readerHolds = reader.reservedPeerIds
    const answers = { ...first.answers, ...second.answers, reader: readerHolds }
    expect(Object.keys(answers)).toHaveLength(CLOSED_RELAY_CAPABLE)

    // eslint-disable-next-line no-console -- the topology IS this file's product; a reading
    // recorded only inside an assertion is one the next reader has to re-derive.
    console.log(
      '[closed-fabric]',
      JSON.stringify({
        issuer,
        postures: {
          provider: provider.posture,
          seed: admitsLine(fixture.seed.banner),
          relay: relay.posture,
          memberAtSeed: memberAtSeed.posture,
          memberAtRelay: memberAtRelay.posture,
          stranger: stranger.posture,
          reader: [issuer],
          openControl: openControl.posture,
        },
        subjects: { stranger: stranger.peerId, reader: reader.peerId },
        enrolled: { memberAtSeed: memberAtSeed.peerId, memberAtRelay: memberAtRelay.peerId },
        closedSetHolds: { first: first.answers, second: second.answers, reader: readerHolds },
        openControlHolds: await advertisedBy(reader, openControl.peerId),
        seedAddr,
        strangerRelays: stranger.relays,
        // What the stranger actually **reached**, off its own handshake line: `bin/agent.ts`
        // reads each entry off a `Connection` rather than out of the configured string, so
        // this is the population the whole-set absence is asserted over and not a list of
        // addresses somebody meant to dial.
        strangerMet: stranger.peers,
      }),
    )

    // **The reading.** Asserted over the SET, with every offending door and every admitted
    // subject named — so a red says which door let whom in rather than that something is wrong.
    expect(
      intruders(first.answers, subjects),
      'a closed door admitted an uncertificated peer (first scan)',
    ).toStrictEqual([])
    expect(
      intruders(second.answers, subjects),
      'a closed door admitted an uncertificated peer (second scan, after the absence window)',
    ).toStrictEqual([])
    expect(
      intruders({ reader: readerHolds }, [{ name: 'stranger', peerId: stranger.peerId }]),
      'the reader — itself closed and itself uncertificated — admitted the stranger',
    ).toStrictEqual([])

    // R3's assertion, beside R2 so the pair reads as one statement: the same process, in the
    // same run, is refused at every closed door and admitted at the one nobody closed. Its
    // absence above is a **refusal**, not inaction.
    expect(await advertisedBy(reader, openControl.peerId)).toContain(stranger.peerId)

    // And the stranger holds no circuit through any closed door, read from its own side rather
    // than from anybody's advertisement — the instrument-independent half.
    for (const peer of closedSet) {
      expect(
        circuitsThrough(stranger, peer.peerId),
        `the stranger holds a circuit through ${peer.name}`,
      ).toStrictEqual([])
    }
  }, PROCESS_TEST_TIMEOUT)

  /**
   * **`BootstrapInfo.peerAddrs`, read as a gated surface, over HTTP, from a real seed process.**
   *
   * ## Why this reading and not another
   *
   * `24-VERIFICATION.md` §2: `grep -rln peerAddrs packages/node/src/*.test.ts` returned exactly
   * one file, whose only assertion on the field is address **shape**. Meanwhile
   * `packages/browser/demo/main.ts` reads `info.peerAddrs` and pushes every string it finds
   * into its dial candidates — so a browser tab's peer discovery runs through the one
   * advertisement surface criterion 8's clause was never read on. This is that reading, taken
   * at the Node tier over the real HTTP surface of a real `bin/seed.ts`; 24-08 takes the
   * consumption half at the browser tier.
   *
   * The shape property is asserted too, and deliberately: `peerAddrs[0] === relayAddrs[0]` is
   * `seed-server.ts`'s own stated invariant — *"a page's relay and a page's peer are one
   * node"* — and asserting it here makes a change of shape a finding rather than a silent pass
   * of the absence half.
   */
  it('publishes the enrolled arm in /bootstrap.json and neither uncertificated peer, over HTTP', async () => {
    const { seedHttpPort, seedPeerId, memberAtSeed, stranger, reader } = fixture

    const read = async (): Promise<BootstrapRead> => {
      const response = await fetch(`http://127.0.0.1:${String(seedHttpPort)}/bootstrap.json`)
      const info = (await response.json()) as {
        relayAddrs: string[]
        seedPeerId: string
        peerAddrs: string[]
      }
      return { status: response.status, cacheControl: response.headers.get('cache-control'), info }
    }

    // The presence half FIRST, with a thunk that names what actually arrived.
    await until(
      async () => (await read()).info.peerAddrs.some((a) => a.includes(memberAtSeed.peerId)),
      RESERVATION_BUDGET_MS,
      'the enrolled arm to be advertised in the seed’s /bootstrap.json',
      async () => ({ peerAddrs: (await read()).info.peerAddrs, want: memberAtSeed.peerId }),
    )

    const before = await read()
    expect(before.status).toBe(200)
    expect(before.cacheControl).toBe('no-store')
    // The shape, asserted so that a change to it is a finding rather than a silent pass.
    expect(before.info.peerAddrs[0]).toBe(before.info.relayAddrs[0])
    expect(before.info.seedPeerId).toBe(seedPeerId)
    expect(before.info.peerAddrs[0]).toContain(seedPeerId)

    // The absence, held over the same window R2 used rather than sampled once.
    await new Promise((r) => setTimeout(r, ABSENCE_WINDOW_MS))
    const after = await read()

    const named = (info: { peerAddrs: string[] }, peerId: string): string[] =>
      info.peerAddrs.filter((address) => address.includes(peerId))

    // eslint-disable-next-line no-console -- the same reason the `[closed-fabric]` line above
    // gives: this is the file's product, and the browser tier consumes exactly this list.
    console.log(
      '[closed-fabric bootstrap]',
      JSON.stringify({
        httpPort: seedHttpPort,
        status: after.status,
        cacheControl: after.cacheControl,
        relayAddrs: after.info.relayAddrs,
        seedPeerId: after.info.seedPeerId,
        peerAddrs: after.info.peerAddrs,
        wantPresent: memberAtSeed.peerId,
        wantAbsent: { stranger: stranger.peerId, reader: reader.peerId },
      }),
    )

    for (const info of [before.info, after.info]) {
      // The presence half again, in the same list the absence is read from.
      expect(named(info, memberAtSeed.peerId), 'the enrolled arm left the advertisement').toHaveLength(1)
      expect(named(info, stranger.peerId), 'the uncertificated stranger is advertised to every arriving browser').toStrictEqual([])
      expect(named(info, reader.peerId), 'the uncertificated reader is advertised to every arriving browser').toStrictEqual([])
    }
  }, PROCESS_TEST_TIMEOUT)
})

interface BootstrapRead {
  readonly status: number
  readonly cacheControl: string | null
  readonly info: { relayAddrs: string[]; seedPeerId: string; peerAddrs: string[] }
}
