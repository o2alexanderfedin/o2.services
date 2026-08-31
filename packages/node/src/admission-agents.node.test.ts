/**
 * Phase 24's one criterion — number **8** — read across real processes.
 *
 * > *"a node that cannot present a provider-issued certificate cannot join the fabric,
 * > advertise itself, or be dialled by another node"*
 *
 * **Phase 24 has exactly one criterion, so a verification of this phase scores out of 1, not
 * out of 8.** The digit is a label inherited when the owner moved the criterion out of Phase
 * 19 on 2026-08-04; it is not a position in a list of eight.
 *
 * ## THE SUBSTITUTION, recorded here rather than in a planning document
 *
 * The criterion says *a node*. What is spawned below is `bin/agent.ts`, which submits no job
 * and is a serving process. So each clause is satisfied here as *"a node run as a real
 * `bin/agent.ts` process against a gated relay"*. Phase 19 learned that a substitution living
 * in a plan reaches nobody reading the test, so it is written where the reading is.
 *
 * The **reader** is one in-process `FabricNode` rather than a seventh child, and that is the
 * one substitution that buys something: clause 3 is a claim about *what a node was told and
 * what it did with it*, and a child process can be asked neither. Every node whose admission
 * is the subject is a real process; the instrument is not.
 *
 * ## THE GATED RELAY IS AN AGENT PROCESS, AND IT IS NOT A SEED
 *
 * **A `bin/seed.ts` passed `--trusted-issuer` is not a gated relay**, and a reading that
 * assumed otherwise would grade the wrong door. That much is unchanged and is why the relay
 * below is an agent: `--trusted-issuer` on a seed picks whose certificate it *believes about a
 * peer it is already talking to*; who gets **in** is `relayAdmission`. The two are different
 * questions and 24-01's *"not derived from `trustedIssuers`"* still stands.
 *
 * **Corrected 2026-08-06 by Plan 24-07, and the replaced sentence is quoted rather than swapped
 * out.** This paragraph continued: *"24-01 hardcoded the seed's `relayAdmission` posture
 * **open** at `seed-server.ts`'s `FabricNode.start` … and 24-03 kept a seed-side admission flag
 * out of scope."* The second half is now false. Plan 24-06 added
 * `SeedServerOptions.relayAdmission` as a **required** field and `bin/seed.ts --admit-issuer`,
 * so `seed-server.ts` reads an operator's value where it once held a literal, and a seed **can**
 * be told to close. The correction is written out rather than applied silently, because a
 * comment asserting a mechanism is absent is the exact shape this repository has been bitten by:
 * a reader who believes it stops looking. What did **not** change is the default — that
 * binary's ternary has the open literal as its absent arm — so every reading in this file
 * stands unaltered. The fabric-wide reading that turns the new knob is
 * `closed-fabric-agents.node.test.ts`.
 *
 * So the relay below is `bin/agent.ts --port 0 --admit-issuer <hex>`, which 24-03 task 2A
 * built for exactly this reading, and its posture is asserted **off its own handshake line**
 * rather than off the argv this file passed it. A typo in a spawn argument otherwise produces
 * an open agent and clause 1 passes for the wrong reason — the single most likely way this
 * file could lie.
 *
 * ## WHAT THIS FILE DOES NOT SHOW, stated before the readings rather than after
 *
 * - **Clause 3 covers reachability through the fabric's own discovery, and nothing wider.**
 *   A peer that already holds a direct address for the unadmitted node reaches it — that is
 *   asserted below, in the same run, precisely so the clause cannot be read as "the refused
 *   node is unreachable". It is not unreachable; it is **unfindable**, and those are
 *   different claims.
 * - **`records` and `providers` are NOT gated by this phase and are not read here.**
 *   `agent.ts` answers both to any peer that can reach the endpoint. Under this phase an
 *   unadmitted peer has no route *through the fabric* to reach it, and a direct-dialable Node
 *   peer still does. 24-CONTEXT files closing that as a **deferred idea**; nothing here
 *   should be read as having closed it.
 * - **"Cannot join the fabric" is measured of a RELAY, not of the fabric.** Admission is
 *   per-relay by construction, and the last case in this file measures a peer the gate refused
 *   obtaining a reservation on the **open provider it had to dial in order to enrol**. The
 *   criterion's own subject — a node holding no certificate at all, dialling nothing else —
 *   is out of the fabric entirely, and that is asserted. Anything wider than that is not.
 * - **Nothing about the browser tier.** That is `gated-admission.e2e.test.ts`.
 * - **The relay's own reason for a refusal does not cross the process boundary.** The relay
 *   records *why* in `FabricNode.admissionDecisions`, an in-process getter with no wire
 *   surface; what the joiner is told is `PERMISSION_DENIED` and nothing else. So the
 *   wrong-issuer arm below is distinguishable from the no-certificate arm by **what each
 *   presented**, which is published on their handshake lines, and not by what the relay said.
 *   The relay-side reasons are read in-process by `enrolment-residual.node.test.ts`. An
 *   operator debugging a refused agent from that agent's own output cannot tell the two
 *   apart, and that is a finding rather than an omission.
 *
 * ## Budget
 *
 * **Six** child processes plus one in-process reader. `spawnAgent` runs for `provider`,
 * `other-provider` and `relay`, and three more times inside `joinFabric` for `member`,
 * `stranger` and `outsider`. This paragraph read *"Five"* until 2026-08-06, which contradicted
 * the reader paragraph above it calling the reader *"a seventh child"* it declined to spawn —
 * the count was corrected, not the reader paragraph, and the same wrong figure had propagated
 * into `24-04-SUMMARY.md` twice and into the AUTH-02 requirement row drafted from it.
 * `discovery-agents.node.test.ts` runs seven and `tree-reduce-agents.node.test.ts` nine, so
 * this is inside the established budget for this repository and its timeouts are reused rather
 * than re-invented.
 */
import { spawn } from 'node:child_process'
import type { ChildProcessByStdio } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Readable, Writable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import type { NodeCertificate } from '@o2/core'
import { SEED_BYTES } from '@o2/libp2p'
import { encodeRequest, parseResponse } from '@o2/net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FabricNode } from './fabric-node.ts'

const AGENT = fileURLToPath(new URL('./bin/agent.ts', import.meta.url))

/** Announce budget, matching `discovery-agents.node.test.ts` and `reservation-exhaustion`. */
const ANNOUNCE_BUDGET_MS = 60_000

/**
 * Per-`it` budget. Five spawns, three of which enrol, plus a gated relay that spends up to
 * `RELAY_ADMISSION_DEADLINE_MS` per refusal. `discovery-agents.node.test.ts` uses the same
 * figure for seven spawns and two enrolments.
 */
const PROCESS_TEST_TIMEOUT = 300_000

/**
 * How long a reservation is given to appear or to be refused.
 *
 * Sited against two measured numbers rather than chosen: libp2p retries a reservation
 * internally (`reservation-exhaustion.node.test.ts` allows 45 s for a refusal to surface),
 * and the gate itself spends up to `RELAY_ADMISSION_DEADLINE_MS` — 3 500 ms — per peer before
 * it answers. This is comfortably above both.
 */
const RESERVATION_BUDGET_MS = 60_000

/**
 * How long the unadmitted arm is held out of the advertisement before its absence is believed.
 *
 * A window and not a sample, for `enrol-through-a-closed-door.node.test.ts`'s reason: an
 * absence read once is also what a fabric that has not got there yet looks like. Comparative
 * rather than absolute — the admitted arm's presence is established **first**, in the same
 * run and on the same relay, so this window is known to be longer than a grant takes here.
 */
const ABSENCE_WINDOW_MS = 5_000

type AgentProcess = ChildProcessByStdio<Writable, Readable, Readable>

/**
 * The key `bin/agent.ts` publishes its admission posture under.
 *
 * A constant, and the posture is read by **indexing** rather than by a declared property on
 * {@link Handshake} below. That is not a style choice and it was found by a red guard:
 * `relay-admission.node.test.ts` requires the field to be **declared in exactly one type in the
 * whole repository**, so that two node factories cannot grow two answers to *"who does this node
 * admit"*. A reader's view of a JSON line is not a second factory — but the census reads text and
 * cannot tell the two apart, and *"never close a gap by widening what counts as passing"* puts
 * the repair on this side. Observed with the declaration present: `declares the field in exactly
 * one type, so two factories cannot drift` — `expected 2 to be 1`.
 *
 * The constant carries no colon, so it matches neither of that file's needles.
 */
const POSTURE_KEY = 'relayAdmission'

/**
 * The handshake line, by name.
 *
 * The posture 24-03 added for a proof requirement is carried as {@link Handshake.posture} and
 * reading it is not decoration: it is the only thing that distinguishes a relay this file *told*
 * to close from a relay that actually closed.
 */
interface Handshake {
  readonly peerId: string
  readonly multiaddrs: string[]
  /** What the process published about who it admits — the `POSTURE_KEY` field, renamed here. */
  readonly posture: string | readonly string[]
  readonly nodeKey: string
  readonly certificate: NodeCertificate | null
  readonly issuerKey: string | null
  readonly relays: string[]
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

/**
 * `'pipe'` on fd 0 is load-bearing rather than cosmetic: `bin/agent.ts` arms its orphan leash
 * by watching fd 0, and `'ignore'` hands it a character device, which opts the leash out.
 * `orphan-leash.node.test.ts` fails any spawn site that does that.
 */
/**
 * The ONE stand-up failure that is re-attempted, matched on its own text.
 *
 * `rpc to <peer> timed out after <n>ms` is `RpcFailure`'s own rendering
 * (`packages/net/src/rpc.ts:59`), and the budget it names is
 * `DEFAULT_RPC_TIMEOUT_MS` — the PRODUCT default, 30 000 ms, not a number this file
 * chose. A spawned agent whose enrolment RPC misses that budget exits 1 before it ever
 * prints a handshake line, and the whole file fails in `standUp` on a fact about how
 * much CPU the machine had, recorded on 2026-08-25 as *"agent outsider exited early
 * with 1 … timed out after 30000ms"* on a host that spent 262 s inside one `it`.
 *
 * **Keyed on the message, not on a count and not on a timer.** Any other exit — a
 * refusal, a bad flag, a crash — is re-thrown untouched on the first attempt. That is
 * the difference between re-attempting a known host condition and retrying until green.
 */
const RPC_TIMED_OUT = /timed out after \d+ms/

/**
 * Stand an agent up, re-attempting exactly once and only on {@link RPC_TIMED_OUT}.
 *
 * **Why a re-attempt rather than a bigger budget.** The budget belongs to the child and
 * is the product's own default; raising it from here would change what the shipped
 * binary does in a test's favour. And per `CLAUDE.md` § Measurement, a wall-clock bound
 * over a process that is *waiting* measures the host and never the code — so widening
 * it would buy nothing except a later cliff.
 *
 * **Why not silent.** A single re-attempt hides a host hiccup, which is the intent, and
 * would also hide an enrolment path that fails half the time — which is not. So every
 * re-attempt writes to stdout, and a run that needed one says so; `console.log` would
 * not, measured on vitest 4.1.10 for a PASSING test.
 *
 * **What it cannot do.** A second failure is thrown, so an enrolment that is genuinely
 * broken still fails the file on the same message it always did.
 */
async function spawnAgent(name: string, extraArgs: readonly string[]): Promise<Agent> {
  try {
    return await spawnAgentOnce(name, extraArgs)
  } catch (cause) {
    const text = cause instanceof Error ? cause.message : String(cause)
    if (!RPC_TIMED_OUT.test(text)) throw cause
    process.stdout.write(
      `[fixture / re-attempt] agent ${name} exited before announcing because an RPC missed ` +
        `the child's own DEFAULT_RPC_TIMEOUT_MS budget, which on this host is a statement ` +
        `about contention rather than about admission. Standing it up once more; a second ` +
        `failure is thrown. Original: ${text.slice(0, 400)}\n`,
    )
    return await spawnAgentOnce(name, extraArgs)
  }
}

async function spawnAgentOnce(name: string, extraArgs: readonly string[]): Promise<Agent> {
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
        // Named fields only — the handshake line has grown three times and reading it
        // positionally would have broken on each. The posture is lifted out by key rather
        // than destructured, for the reason `POSTURE_KEY` records.
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
 * Wait until `predicate` holds, naming **what actually arrived** on failure.
 *
 * The `observed` thunk is not decoration. `24-02-SUMMARY.md` records a plant that reported
 * only `timed out waiting for 3 reservations` at 30 198 ms against a 30 000 ms deadline — a
 * duration equal to a timeout is evidence of the timeout and says nothing about which reading
 * moved.
 *
 * Defined locally rather than imported: importing a helper from another `.test.ts`
 * re-registers that file's whole suite — see the note in `certificate-verification.node.test.ts`.
 *
 * ## `observed` is AWAITED, and the correction that made it so is recorded rather than swapped
 *
 * `24-05-SUMMARY.md`'s R1 asked for this repair here, and stated its reason as: *"Its `until`
 * and `stays` take `observed?: () => unknown` and are passed **async** thunks at four call
 * sites"*. **That sentence is false about this file, and it was checked mechanically before it
 * was acted on rather than inherited.** Every one of the eight `observed` thunks in this file
 * is synchronous; what is async is the *predicate*, which both helpers already awaited. So the
 * `{}` failure 24-05 measured could not occur here as written.
 *
 * What *was* wrong is narrower and was found by looking: at the five sites whose predicate is a
 * round trip through {@link advertisedBy}, the `observed` thunk reported
 * `{ memberRelays: member.relays }` — a **handshake snapshot taken at spawn and never updated**
 * — while the thing being waited on is the relay's *live* advertisement. For an admitted arm
 * that snapshot is a non-empty circuit list, so a timeout there printed a value that **looks
 * like success** beside a reading that had failed. That is worse than vacuous: `{}` says
 * nothing, and a stale success says the wrong thing. Those five thunks now read the
 * advertisement they are waiting on, keep the snapshot beside it so nothing is lost, and are
 * therefore async — which is what makes this `await` load-bearing rather than prospective.
 *
 * No assertion in this file was changed by that repair, and none of its measurements moved.
 */
async function until(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs: number,
  what: string,
  observed?: () => unknown | Promise<unknown>,
): Promise<void> {
  // Two measured reds on 2026-08-31, both false. (1) A predicate here is a round trip over a
  // live connection or another process, and a drop between two polls is the *"not yet"* the
  // budget exists to absorb — so a throw is `false`, carried to the report rather than
  // swallowed. (2) The predicate is re-checked ONCE after the deadline, or the message is
  // built from a later observation than the last evaluation and can read `waiting for X;
  // observed X`. Full working: `closed-fabric-agents.node.test.ts`'s `until`.
  const deadline = Date.now() + timeoutMs
  let lastError: unknown
  const attempt = async (): Promise<boolean> => {
    try {
      if (await predicate()) return true
      lastError = undefined
      return false
    } catch (cause) {
      lastError = cause
      return false
    }
  }
  while (Date.now() < deadline) {
    if (await attempt()) return
    await new Promise((r) => setTimeout(r, 100))
  }
  if (await attempt()) return
  const threw =
    lastError === undefined
      ? ''
      : `; last attempt threw ${lastError instanceof Error ? lastError.message : String(lastError)}`
  const tail = observed === undefined ? '' : `; observed ${JSON.stringify(await observed())}`
  throw new Error(`timed out waiting for ${what}${threw}${tail}`)
}

/**
 * Hold `predicate` false for the whole window, or fail naming when it first became true.
 *
 * `observed` is awaited for the reason written out at {@link until} immediately above.
 */
async function stays(
  predicate: () => boolean | Promise<boolean>,
  windowMs: number,
  what: string,
  observed?: () => unknown | Promise<unknown>,
): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < windowMs) {
    if (await predicate()) {
      const tail = observed === undefined ? '' : `; observed ${JSON.stringify(await observed())}`
      throw new Error(`${what} stopped holding after ${Date.now() - started}ms${tail}`)
    }
    await new Promise((r) => setTimeout(r, 100))
  }
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
 * Written as a filter over the relay's peer id rather than as `relays.length === 0`, because
 * a joiner may hold circuits through more than one relay and this file measured exactly that
 * — see the per-relay case at the foot of this file.
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

interface Fixture {
  /** The provider whose issuer the relay pins. */
  readonly provider: Agent
  /** A second provider, pinned by nobody. */
  readonly otherProvider: Agent
  /** `bin/agent.ts --port 0 --admit-issuer <provider.issuerKey>` — the gated relay. */
  readonly relay: Agent
  readonly relayAddr: string
  /** Holds no certificate at all. */
  readonly stranger: Agent
  /** Enrolled under `provider` — the arm that inverts every clause. */
  readonly member: Agent
  /** Enrolled under `otherProvider` — a certificate the relay does not pin. */
  readonly outsider: Agent
  /** The in-process instrument. Never a subject. */
  readonly reader: FabricNode
}

/**
 * Six participants, one gated relay, three joiners that differ only in what they enrolled to.
 *
 * The three joiners take **byte-identical argv apart from their provider**: same `--port 0`,
 * same `--relay-addr`, same operator id shape, same key file shape. Without that, an absence
 * below would also be explained by the fixture.
 */
async function standUp(): Promise<Fixture> {
  const [provider, otherProvider] = await Promise.all([
    spawnAgent('provider', ['--port', '0', '--issues-certificates', '--max-issued-per-window', '64']),
    spawnAgent('other-provider', ['--port', '0', '--issues-certificates', '--max-issued-per-window', '64']),
  ])
  const issuer = provider.issuerKey
  const otherIssuer = otherProvider.issuerKey
  if (issuer === null || otherIssuer === null) throw new Error('a provider announced no issuer key')
  expect(issuer).not.toBe(otherIssuer)

  const relay = await spawnAgent('relay', ['--port', '0', '--admit-issuer', issuer])
  const relayAddr = directAddrOf(relay)

  const joinFabric = async (name: string, fill: number, under: Agent | null): Promise<Agent> =>
    spawnAgent(name, [
      '--port',
      '0',
      '--relay-addr',
      relayAddr,
      ...(under === null
        ? []
        : [
            '--provider-addr',
            directAddrOf(under),
            '--user-key',
            await writeUserKey(name, fill),
            '--operator-id',
            `${name}-ops`,
          ]),
    ])

  // Sequential, and the order matters for one reason only: the admitted arm goes first so
  // that every absence read afterwards is read against a relay already known to be granting.
  const member = await joinFabric('member', 0xa1, provider)
  const stranger = await joinFabric('stranger', 0xa2, null)
  const outsider = await joinFabric('outsider', 0xa3, otherProvider)

  const reader = await FabricNode.start({
    // This node relays for nobody in this file — it is the instrument, and giving it a
    // posture that could refuse would put a second door in a fixture about one.
    relayAdmission: 'admits-any-peer',
    startReporting: 'reports-its-own-start',
    blockstoreDir: join(workdir, 'reader'),
    listen: ['/ip4/127.0.0.1/tcp/0'],
    // **Required for clause 3, and the requirement is a measured fact about this factory,
    // not a preference.** `fabric-node.ts` installs `circuitRelayTransport()` only on the
    // `viaRelay` arm — `transports: viaRelay ? [tcp(), webSockets(), circuitRelayTransport()]
    // : [tcp(), webSockets()]` — so a node given no `relayAddrs` **cannot dial a relayed peer
    // at all**. Without this line the reader failed the enrolled arm's dial with
    // `NoValidAddressesError: The dial request has no valid addresses for peer: …`, which
    // would have read as "the enrolled arm is unreachable too" and been an artifact of the
    // instrument.
    //
    // The instrument is therefore itself an **unadmitted peer**: it holds no certificate, so
    // the gated relay refuses it a reservation. That costs nothing here and buys something —
    // every reading below is taken by a node the door turned away, which is the sharpest
    // available statement that a refused node still works.
    relayAddrs: [relayAddr],
    rpcTimeoutMs: 20_000,
    trustAnchors: 'runs-unsigned-artifacts',
  })
  nodes.push(reader)

  // The reader's ONE explicit dial. Everything it learns about anybody else it learns from
  // the relay's own answer. (`relayAddrs` above dials the same address inside `start`; this
  // is idempotent and is written out so the file does not depend on that.)
  await reader.dial(relayAddr)

  return { provider, otherProvider, relay, relayAddr, stranger, member, outsider, reader }
}

/**
 * Ask the relay, over the wire, who is reserved on it.
 *
 * **The production rendezvous path**, not a getter read a second time: `findReservedPeers`
 * (`net/src/rendezvous.ts`) issues exactly this request, and `fabric-node.ts` answers it from
 * `() => node.reservedPeerIds` — a **thunk**, which is what makes this reading mean something.
 * A node passing `'relays-for-nobody'` answers `[]` unconditionally and would satisfy every
 * absence below without measuring anything; the relay here is an agent process, and
 * `bin/agent.ts` builds a `FabricNode`, so the thunk is what answers.
 */
async function advertisedBy(reader: FabricNode, relayPeerId: string): Promise<readonly string[]> {
  const body = await reader.rpc.request(relayPeerId, encodeRequest({ kind: 'reservations' }))
  const response = parseResponse(body)
  if (response === null || response.kind !== 'reservations') {
    throw new Error(`the relay answered a reservations request with ${JSON.stringify(response)}`)
  }
  return response.peerIds
}

beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'o2-admission-agents-'))
})

/** 60 s, which must exceed `stopAgent`'s inner 10 s or its SIGKILL fallback could never fire. */
afterEach(async () => {
  await Promise.all(nodes.splice(0).map((node) => node.stop().catch(() => {})))
  await Promise.all(agents.splice(0).map((agent) => stopAgent(agent).catch(() => {})))
  await rm(workdir, { recursive: true, force: true })
}, 60_000)

describe('criterion 8 — the three clauses, across real processes, in three arms', () => {
  /**
   * Everything the three clause readings below rest on, asserted first and separately.
   *
   * A composite case that established these inline would report "the fixture is wrong" as a
   * failure of whichever clause happened to run first.
   */
  it('stands the fixture up: the relay really is closed, and the three joiners differ only in their certificate', async () => {
    const { provider, otherProvider, relay, stranger, member, outsider } = await standUp()

    // **The posture off the handshake line, never off the argv this file passed.** The two
    // can disagree and only one of them is what the process is doing.
    expect(relay.posture).toStrictEqual([provider.issuerKey])
    expect(relay.posture).not.toBe('admits-any-peer')
    // And the three joiners are on an open posture themselves, so nothing below is a second
    // door refusing on the joiner's own side.
    for (const joiner of [stranger, member, outsider]) {
      expect(joiner.posture, `${joiner.name} states a posture it was not given`).toBe('admits-any-peer')
    }

    // What each joiner presents, which is the whole of the difference between the arms.
    expect(stranger.certificate).toBeNull()
    expect(member.certificate?.issuer).toBe(provider.issuerKey)
    expect(outsider.certificate?.issuer).toBe(otherProvider.issuerKey)
    // The wrong-issuer arm carries a REAL certificate, not a broken one. Without this the
    // arm would be indistinguishable from a failed enrolment.
    expect(outsider.certificate?.nodeKey).toBe(outsider.nodeKey)

    // Every process is alive and serving, so no absence below is a node that fell over.
    for (const agent of [provider, otherProvider, relay, stranger, member, outsider]) {
      expect(agent.child.exitCode, `${agent.name} exited: ${agent.stderr()}`).toBeNull()
      expect(agent.pid).toBe(agent.child.pid)
    }
  }, PROCESS_TEST_TIMEOUT)

  /**
   * **Clause 1 — cannot join.**
   *
   * ## Read entirely from the JOINERS' side, deliberately, and this was a repair
   *
   * The obvious instrument is the relay's own reservation store, asked over the wire. It was
   * the first thing written here and it was **wrong**, for a reason worth recording: that is
   * the *same list* clause 2 reads, so the two clauses would have shared one instrument and
   * **neither could have been shown to fail alone**. A mutation that widened the relay's
   * `reservations` thunk reddened both, which is not three independent readings — it is one
   * reading asserted three times. 24-CONTEXT's own finding says why the two are one list:
   * *"both advertisement surfaces are derived from `reservedPeerIds`… structurally — no filter
   * to add, no `if` to forget"*.
   *
   * So clause 1 asks the question of the **peer**: does it hold a circuit, and was it told
   * why? Both are on `bin/agent.ts`'s own handshake and stderr, neither is derived from the
   * relay's advertisement, and the relay's store is not consulted here at all.
   *
   * Of the two, **the stderr grant/refusal line is load-bearing on the admitted arm** and
   * the circuit address carries the absences. That is the reverse of what this docblock said
   * until task #53, and the reversal is forced rather than stylistic: the circuit address on
   * the admitted arm comes from a handshake snapshot frozen before the grant necessarily
   * exists, so it could report absence for a member the relay had admitted. The absences
   * below are still read off `relays`, where a *stale* snapshot can only under-report — and
   * they are now paired with a live line that can contradict them.
   *
   * **The ordering lesson recorded below survives this change.** With the gate planted open
   * the member is still granted promptly, so its wait returns fast and the stranger's
   * assertions still fail in seconds rather than at a timeout.
   */
  it('clause 1 — a spawned agent with no certificate holds no circuit through a gated relay, while an enrolled one does', async () => {
    const { relay, stranger, member } = await standUp()

    // The admitted arm, asserted FIRST. Every absence below is then read against a relay this
    // run has already watched grant a circuit, which is what makes the absence attributable to
    // the certificate rather than to a relay that grants nothing to anybody.
    //
    // **Read from the live grant line, NOT from `member.relays` — task #53.** The handshake
    // carries a snapshot taken at spawn and never updated (see `spawnAgent`), and the agent
    // prints it after a settle loop bounded by `RELAY_SETTLE_BUDGET_MS`. libp2p's circuit
    // relay makes exactly one reservation attempt ever, so a grant that lands after that
    // budget is absent from the snapshot **permanently**. `circuitsThrough(member, …)` was
    // therefore measuring when the grant arrived relative to a 30 s budget, not whether the
    // relay admitted the member — and it failed once, on a hot host, for exactly that reason.
    //
    // The grant line is not the weaker reading of the two. It is the relay's own decision,
    // reported by the process that received it, at the moment it arrived. A snapshot cannot
    // be waited for; this can.
    await until(
      () => member.stderr().includes(`relay reservation granted: ${relay.peerId}`),
      RESERVATION_BUDGET_MS,
      'the enrolled agent to name its grant on stderr',
      // `awaited` beside `stderr`, added 2026-08-31: without it a red here is UNDIAGNOSABLE.
      // A run failed with this message while the stderr it printed contained a grant line, and
      // the two readings that separate "the wrong relay granted" from "the right one granted
      // late" are the awaited id and the observed id — only one of which was in the message.
      () => ({
        awaited: `relay reservation granted: ${relay.peerId}`,
        stderr: member.stderr(),
        snapshot: member.relays,
      }),
    )
    expect(member.stderr()).toContain(`agent.ts: relay reservation granted: ${relay.peerId}`)

    // **The load-bearing reading, and it is deliberately FIRST.**
    //
    // Both halves are asserted: no circuit through the gated relay, **and** no circuit at all.
    // The second is the stronger claim and it holds here only because this arm dialled no
    // other relay-capable peer — see the per-relay case at the foot of this file, where an arm
    // that dialled one is admitted by it.
    //
    // Ordered ahead of the stderr reading below because of what was **observed** when the gate
    // was planted open: with the stderr wait first, this case failed as
    // `timed out waiting for the refused agent to name its refusal on stderr` at 62 499 ms
    // against a 60 000 ms budget — a duration equal to a timeout, which this repository's
    // standing rule says is evidence of the timeout and of nothing else. With the order below
    // it fails in about two seconds naming the fact: a refused peer that holds a circuit.
    expect(circuitsThrough(stranger, relay.peerId)).toStrictEqual([])
    expect(stranger.relays).toStrictEqual([])

    // The joiner's own side, which is the operator-facing half. `bin/agent.ts` prints this
    // through `ReservationWatcher`; libp2p throws `PERMISSION_DENIED` and
    // `classifyReservationFailure` turns it into `refused` — distinct from the `at-capacity`
    // a **full** relay produces, which is the distinction an operator has to be able to make.
    await until(
      () => stranger.stderr().includes('relay reservation refused: PERMISSION_DENIED'),
      RESERVATION_BUDGET_MS,
      'the refused agent to name its refusal on stderr',
      () => ({ stderr: stranger.stderr() }),
    )
    expect(stranger.stderr()).toContain('agent.ts: relay reservation refused: PERMISSION_DENIED')
    expect(stranger.stderr()).not.toContain('at-capacity')

    // The refused agent is **still serving directly** — this phase closes a door, it does not
    // kill a node — and the refusal is **final**, which is measured elsewhere rather than
    // assumed here.
    //
    // The handshake is a one-shot reading, so on its own it would be a sample. 24-03 measured
    // that a refused peer schedules no retry at all — libp2p arms its refresh timer only
    // inside the success path — and held that over 15 s with the door *opened* underneath it.
    // What is checkable from here is the consequence: over a window longer than the enrolled
    // arm's whole grant took, the refused process reports nothing further and stays alive.
    // ## MEASURED 2026-08-23 — this clause moved, and it moved because the DHT started working
    //
    // It read `expect(stranger.stderr()).not.toContain('relay reservation granted')` — the
    // claim that a peer the gate refuses holds **no circuit anywhere**. That claim was never
    // what criterion 8 says; it says admission is **per-relay**, and it was only *incidentally*
    // true because this fabric's peer discovery did not work.
    //
    // **Isolated by ablation, not by argument.** Reverting exactly one line —
    // `peerInfoMapper: passthroughMapper` back to `kad-dht`'s default
    // `removePrivateAddressesMapper` — takes this file from 2 failed to 6 passed with every
    // other change in place. The default drops any peer left with no addresses after
    // filtering, and on loopback that is every peer, so before that line no routing table in
    // this fabric ever had an entry: `put` yielded no events and `getClosestPeers` never
    // returned. With it, kad-dht populates its table, emits the peers it learns as
    // `peer:discovery`, and `circuit-relay-v2`'s relay discovery dials any peer advertising
    // the HOP protocol (`transport/discovery.ts` — it searches the peer store and subscribes
    // to `peer:discovery`). So the stranger reserves on the open provider **without dialling
    // it**, because the DHT told it the address.
    //
    // **That is `FindPeer`, which is one of the two things a DHT is for**, and the owner ruled
    // on 2026-08-23 that it stays enabled. What this file may therefore assert is what
    // criterion 8 actually claims — the *gate* refused, and the refused peer is not at the
    // gate — and not the stronger sentence, which was a reading of a fabric whose discovery
    // layer was broken.
    //
    // **The narrower question this does NOT settle, named so nobody reads silence as a
    // ruling**: whether a node should *automatically* take a reservation on a relay it merely
    // discovered, rather than only on ones an operator named. IPFS's auto-relay does exactly
    // this; a policy of operator-named-relays-only is a separate client decision and is not
    // taken here.
    const refusalsAt = stranger.stderr().length
    await stays(
      () => stranger.child.exitCode !== null || stranger.stderr().length !== refusalsAt,
      ABSENCE_WINDOW_MS,
      'the refused agent staying alive and saying nothing further about relays',
      () => ({ exitCode: stranger.child.exitCode, stderr: stranger.stderr().slice(refusalsAt) }),
    )

    // **Task #53, and the placement is the point.** `stranger.relays === []` above reads the
    // handshake snapshot, and a snapshot's silence is not evidence: a grant that landed after
    // it was taken is invisible there, so that clause would pass *because* the contradicting
    // evidence arrived late. This line reads the live channel instead.
    //
    // Asserted HERE rather than beside the snapshot, because there it would be close to
    // vacuous — a late grant has not arrived yet at refusal time. After the window above, it
    // has had `ABSENCE_WINDOW_MS` to show up. The window itself already reddens on any new
    // stderr byte, so this is the assertion that *names* what a failure would mean.
    // The clause that survives: the **gate** granted nothing. Read off the refusal the gate
    // itself produced rather than off the absence of any grant anywhere — see the block above.
    expect(stranger.stderr()).toContain('agent.ts: relay reservation refused: PERMISSION_DENIED')
    expect(stranger.stderr()).not.toContain('at-capacity')
    expect(directAddrOf(stranger)).toContain('/tcp/')
    expect(stranger.child.exitCode).toBeNull()
  }, PROCESS_TEST_TIMEOUT)

  /**
   * **Clause 2 — cannot advertise itself.**
   *
   * The instrument is the relay's `reservations` answer taken over the fabric's own RPC —
   * the surface `findReservedPeers` reads and the only advertisement surface a gated relay
   * has. The seed's `/bootstrap.json` is the other, and it is **not read here**: this fixture
   * builds no seed, and pointing joiners at a seed they never reserved on would produce an
   * absence for want of asking rather than for want of a certificate.
   *
   * **Corrected 2026-08-06 by Plan 24-07.** The reason given here was: *"a seed's
   * `relayAdmission` is hardcoded open (`seed-server.ts`), so it advertises an uncertificated
   * peer that reserved on it"*. That premise is now false — Plan 24-06 made the field a
   * required `SeedServerOptions` option and added `bin/seed.ts --admit-issuer` — so the reason
   * this case does not read `/bootstrap.json` is the fixture's shape and not the seed's posture.
   * The reading itself is unchanged and no assertion below moved.
   * `closed-fabric-agents.node.test.ts` reads `/bootstrap.json` off a **closed** seed process,
   * with a paired presence and absence.
   *
   * **Every absence is paired with a presence in the same list, in the same run**, so the
   * reading cannot be satisfied by an empty list.
   *
   * **Clause 3 rides on this list, and clause 1 does not.** That is by construction rather than
   * by choice — 24-CONTEXT: *"both advertisement surfaces are derived from `reservedPeerIds`…
   * no filter to add, no `if` to forget"* — so a mutation that widens the relay's `reservations`
   * thunk reddens this case and clause 3 together while clause 1 stays green. That grouping is
   * the honest shape of the mechanism and it is stated rather than papered over with a third
   * instrument that would have been the same list under another name.
   */
  it('clause 2 — the unadmitted arms are absent from the same advertisement the enrolled arm is present in', async () => {
    const { relay, stranger, member, outsider, reader } = await standUp()

    await until(
      async () => (await advertisedBy(reader, relay.peerId)).includes(member.peerId),
      RESERVATION_BUDGET_MS,
      'the enrolled arm to appear in the relay’s advertisement',
      async () => ({ relayHolds: await advertisedBy(reader, relay.peerId).catch(String), memberRelays: member.relays }),
    )

    const advertised = await advertisedBy(reader, relay.peerId)

    // The presence half. Without it every `not.toContain` below is satisfied by `[]`.
    expect(advertised).toContain(member.peerId)
    // The absence half, twice — no certificate, and the wrong issuer's certificate.
    expect(advertised).not.toContain(stranger.peerId)
    expect(advertised).not.toContain(outsider.peerId)
    // And the relay does not advertise itself into its own answer, so the list is genuinely
    // the reservation store and not a peer list with a relay bolted on.
    expect(advertised).not.toContain(relay.peerId)
    // Nor the instrument that is asking. The reader holds no certificate either, so the relay
    // refused it too — it is connected, it is asking, and it is not in the answer. A list that
    // was "peers I am talking to" would contain it.
    expect(advertised).not.toContain(reader.peerId)
    expect(advertised).toStrictEqual([member.peerId])
  }, PROCESS_TEST_TIMEOUT)

  /**
   * **Clause 3 — cannot be dialled by another node.**
   *
   * Measured as a **process**, not as a timeout: what the reader was told, what it derived
   * from it, and what it did. A dial that fails after thirty seconds and a dial that was never
   * attempted are different facts and only the second is the claim.
   *
   * The reader's only source of addresses is the relay's advertisement. For a peer named
   * there, a circuit address exists — `<relay>/p2p-circuit/p2p/<peer>` — and the reader dials
   * it. For a peer not named there, **there is no address to build**, so nothing is attempted.
   *
   * The final assertion is the one that keeps the clause honest: handed the unadmitted peer's
   * **direct** address, the reader reaches it immediately. The refused node is not broken and
   * is not unreachable. It is unfindable, and that is the whole of what this clause says.
   */
  it('clause 3 — a third node given only what the relay advertises derives no address for the unadmitted arm, and one for the enrolled arm', async () => {
    const { relay, relayAddr, stranger, member, reader } = await standUp()

    await until(
      async () => (await advertisedBy(reader, relay.peerId)).includes(member.peerId),
      RESERVATION_BUDGET_MS,
      'the enrolled arm to appear in the relay’s advertisement',
      async () => ({ relayHolds: await advertisedBy(reader, relay.peerId).catch(String), memberRelays: member.relays }),
    )

    // Everything the reader knows about anybody, derived from the one answer it was given.
    // This is `findReservedPeers`' own construction with the Node tier's transport in place
    // of `/webrtc`: a reservation is held *on* the relay, so the route to its holder goes
    // through the relay.
    const advertised = await advertisedBy(reader, relay.peerId)
    const routesTo = (peerId: string): readonly string[] =>
      advertised.filter((held) => held === peerId).map((held) => `${relayAddr}/p2p-circuit/p2p/${held}`)

    const toStranger = routesTo(stranger.peerId)
    const toMember = routesTo(member.peerId)

    // **The reading.** Nothing to attempt for the unadmitted arm — not a dial that failed.
    expect(toStranger).toStrictEqual([])
    expect(toMember).toHaveLength(1)

    // The enrolled arm is reached over the route discovery produced, which is what makes the
    // empty list above an absence of *address* rather than an absence of *mechanism*.
    const dialled = await reader.dial(toMember[0] as string)
    expect(dialled).toBe(member.peerId)
    expect(reader.transport.peers).toContain(member.peerId)

    // And the unadmitted arm was never dialled, because there was nothing to dial.
    //
    // **Read by DIRECTION and by ROUTE, and this line read `expect(reader.transport.peers)
    // .not.toContain(stranger.peerId)` until 2026-08-25.** That instrument is the connected
    // SET — `Libp2pTransport.peers` is `libp2p.getPeers()`, which says who this node is
    // connected to and nothing about who dialled whom — while the clause's claim is about
    // what the READER derived and attempted. The two come apart, and the coming-apart was
    // measured rather than supposed: a whole-lane run on 2026-08-25 printed the reader's
    // connections at exactly this point and found **three**, of which one was `inbound` from
    // a fixture node the reader never dialled. A node that dials this one does not falsify
    // "the reader derived no address"; it falsifies nothing at all.
    //
    // So the set-membership reading could report the clause broken on a fact that is not
    // about the clause, and it did — recorded against this assertion while
    // `expect(toStranger).toStrictEqual([])`, the reading that actually carries the claim,
    // passed in every failing run.
    //
    // **Two assertions, because there are two ways the clause could genuinely break.**
    // A connection the reader OPENED means something derived an address for a peer the
    // advertisement does not name. A connection over `/p2p-circuit` in EITHER direction
    // means the relay is routing for a peer it refused, which is the admission gate itself
    // failing. Neither is weakened; what is dropped is only the inbound-direct case, which
    // was never this clause's subject.
    const connectionsTo = (peerId: string): readonly string[] =>
      reader.libp2p
        .getConnections()
        .filter((connection) => connection.remotePeer.toString() === peerId)
        .map((connection) => `${connection.direction} ${connection.remoteAddr.toString()}`)
    const everyConnection = reader.libp2p
      .getConnections()
      .map(
        (connection) =>
          `${connection.remotePeer.toString()} ${connection.direction} ${connection.remoteAddr.toString()}`,
      )
      .join(' | ')
    const strangerConnections = connectionsTo(stranger.peerId)
    expect(
      strangerConnections.filter((held) => held.startsWith('outbound')),
      `the reader OPENED a connection to the unadmitted arm, so something derived an address ` +
        `for a peer the relay does not advertise. Every connection the reader holds: ` +
        `${everyConnection}`,
    ).toEqual([])
    expect(
      strangerConnections.filter((held) => held.includes('/p2p-circuit')),
      `a connection to the unadmitted arm runs through the relay, so the relay is routing for ` +
        `a peer it refused — the admission gate, not the discovery half. Every connection the ` +
        `reader holds: ${everyConnection}`,
    ).toEqual([])

    // **The limit of the clause, asserted rather than asserted-around.** The refused node is
    // alive and directly dialable; a peer holding its address reaches it. Discovery is what
    // was closed.
    const direct = await reader.dial(directAddrOf(stranger))
    expect(direct).toBe(stranger.peerId)
    expect(reader.transport.peers).toContain(stranger.peerId)
  }, PROCESS_TEST_TIMEOUT)

  /**
   * **The wrong-issuer arm.**
   *
   * A peer holding a real, verifiable certificate signed by a provider this relay does not pin
   * is refused, and the fixture can tell it apart from a peer holding none — by what each
   * **presented**, which is on their handshake lines.
   *
   * **The relay's own reason is not readable from here**, and that is the finding. It exists —
   * `FabricNode.admissionDecisions` distinguishes *"holds no provider-issued certificate"* from
   * *"certificate issued by …, which is not a pinned provider"* — but it is an in-process
   * getter with no wire surface, and what reaches the joiner is `PERMISSION_DENIED` in both
   * cases. `enrolment-residual.node.test.ts` reads the reasons in-process.
   */
  it('refuses a certificate from an unpinned issuer, and the joiner is told the same thing as one holding no certificate at all', async () => {
    const { provider, otherProvider, relay, stranger, member, outsider, reader } = await standUp()

    await until(
      async () => (await advertisedBy(reader, relay.peerId)).includes(member.peerId),
      RESERVATION_BUDGET_MS,
      'the enrolled arm to obtain a reservation',
      async () => ({ relayHolds: await advertisedBy(reader, relay.peerId).catch(String), memberRelays: member.relays }),
    )
    await stays(
      async () => (await advertisedBy(reader, relay.peerId)).includes(outsider.peerId),
      ABSENCE_WINDOW_MS,
      'the wrong-issuer arm staying out of the reservation store',
      async () => ({
        relayHolds: await advertisedBy(reader, relay.peerId).catch(String),
        outsiderRelays: outsider.relays,
      }),
    )

    // It really did enrol, against a provider that really is a different one.
    expect(outsider.certificate).not.toBeNull()
    expect(outsider.certificate?.issuer).toBe(otherProvider.issuerKey)
    expect(otherProvider.issuerKey).not.toBe(provider.issuerKey)

    // No circuit **through the gated relay** — stated that way rather than as
    // `relays === []`, because `relays === []` is FALSE here and the reason is the next
    // case. See `admission is per-relay` below.
    expect(circuitsThrough(outsider, relay.peerId)).toStrictEqual([])

    // The two refusals are indistinguishable on the wire. Asserted, because a summary that
    // claimed the operator can tell them apart would be describing a surface that does not
    // exist on this side of the process boundary.
    await until(
      () => outsider.stderr().includes('relay reservation refused: PERMISSION_DENIED'),
      RESERVATION_BUDGET_MS,
      'the wrong-issuer arm to name its refusal',
      () => ({ stderr: outsider.stderr() }),
    )
    const refusalLines = (agent: Agent): string[] =>
      agent
        .stderr()
        .split('\n')
        .filter((line) => line.includes('relay reservation refused'))
    expect(refusalLines(outsider)).toStrictEqual(refusalLines(stranger))
    expect(refusalLines(outsider).length).toBeGreaterThan(0)
  }, PROCESS_TEST_TIMEOUT)

  /**
   * **ADMISSION IS PER-RELAY, AND THE FABRIC IS ONLY AS CLOSED AS ITS MOST OPEN RELAY.**
   *
   * This case was not planned. It was **found** by the wrong-issuer arm above failing an
   * assertion that its `relays` list would be empty, and it is the sharpest limit on what
   * criterion 8 can be read as delivering.
   *
   * The mechanism, measured rather than reasoned about: `--provider-addr` makes a joining node
   * **dial its enrolment provider directly** — deliberately, because 24-CONTEXT's sub-decision
   * 1 depends on enrolment riding a plain connection that no reservation gates. But libp2p's
   * `RelayDiscovery` fires off the **identify** event for *any* peer that speaks the relay HOP
   * protocol, and a `bin/agent.ts` provider started with `--port` is relay-capable and, absent
   * `--admit-issuer`, admits everybody. So the peer the joiner had to dial in order to be
   * certified is itself an open door, and the joiner walks through it.
   *
   * The three arms make the mechanism visible without a fourth process, because each dialled a
   * different number of relay-capable peers:
   *
   * | arm | dialled | circuit through |
   * |---|---|---|
   * | `stranger` | the gated relay only | **nothing** — refused, and no second door existed |
   * | `member` | gated relay + provider | the **gated relay**, which admitted it first |
   * | `outsider` | gated relay + other provider | the **other provider**, after the gate refused it |
   *
   * **What this does and does not qualify.** Criterion 8's subject is a node *"that cannot
   * present a provider-issued certificate"*, and `stranger` is that node: it holds none, it is
   * refused, and it gets in nowhere. The clause holds. What it does **not** license is reading
   * "cannot join the fabric" as a property of the fabric rather than of a relay: any
   * relay-capable peer an unadmitted node can reach and that has not been told to close will
   * admit it. In this repository that includes every `bin/agent.ts --port` and every
   * `bin/seed.ts` that was **not passed `--admit-issuer`**.
   *
   * **Corrected 2026-08-06 by Plan 24-07, with the replaced clause quoted.** That sentence
   * ended: *"and **every `bin/seed.ts`**, whose posture 24-01 hardcoded open."* The word doing
   * the work there was *every*, and it is now false: Plan 24-06 gave `SeedServerOptions` a
   * required `relayAdmission` and `bin/seed.ts` an `--admit-issuer`, so a seed's posture is a
   * deployment choice like an agent's. The **default** did not move — a seed told nothing still
   * admits every peer that completes a handshake — so this case's own finding is untouched and
   * so is the fixture it measures, in which nobody was told to close.
   *
   * What follows from the correction is that "the fabric is only as closed as its most open
   * relay" is a statement about a **deployment** rather than about a mechanism that has no
   * knob. `closed-fabric-agents.node.test.ts` builds the other deployment — every relay-capable
   * peer told to close — and reads the absence over the whole set.
   *
   * Not a defect of the gate. `denyInboundRelayReservation` is per-relay by construction and
   * 24-CONTEXT chose it for exactly that property. It is a statement about deployment, and it
   * is recorded here because a summary that omitted it would read wider than the evidence.
   */
  it('admission is per-relay — a peer the gate refuses reserves instead on the open provider it dialled to enrol', async () => {
    const { provider, otherProvider, relay, stranger, member, outsider, reader } = await standUp()

    // The two providers were never told to close, and say so on their own handshake lines.
    expect(provider.posture).toBe('admits-any-peer')
    expect(otherProvider.posture).toBe('admits-any-peer')

    // **Read live off the other provider's own advertisement, not off the joiner's handshake
    // line — and that was a repair.** The handshake is written as soon as `bin/agent.ts` sees
    // *either* a circuit address *or* a reservation failure, so for a peer the gate refuses the
    // failure can arrive first and the line is printed before the fall-through has completed.
    // The first version of this case asserted on that snapshot and failed once in four runs
    // for exactly that reason. A one-shot reading of a state that is still moving is the same
    // defect `enrol-through-a-closed-door.node.test.ts` records for its own first attempt.
    await reader.dial(directAddrOf(otherProvider))
    await until(
      async () => (await advertisedBy(reader, otherProvider.peerId)).includes(outsider.peerId),
      RESERVATION_BUDGET_MS,
      'the arm the gate refused to turn up in the open provider’s reservation store',
      async () => ({
        openProviderHolds: await advertisedBy(reader, otherProvider.peerId).catch(String),
        outsiderRelays: outsider.relays,
        stderr: outsider.stderr().slice(-300),
      }),
    )

    // eslint-disable-next-line no-console -- the topology IS this case's product; a reading
    // recorded only inside an assertion is one the next reader has to re-derive.
    console.log(
      '[per-relay]',
      JSON.stringify({
        gatedRelay: relay.peerId,
        gatedRelayPosture: relay.posture,
        provider: { id: provider.peerId, posture: provider.posture },
        otherProvider: { id: otherProvider.peerId, posture: otherProvider.posture },
        gatedRelayHolds: await advertisedBy(reader, relay.peerId),
        openProviderHolds: await advertisedBy(reader, otherProvider.peerId),
        // Named so that the **second** id in `openProviderHolds` is attributable rather than
        // mysterious: it is this file's own instrument. The reader holds no certificate, the
        // gate refused it, and dialling the open provider one line above was enough to get it
        // a reservation there. An unexplained id in a published reading is worse than no
        // reading — and this one is the same finding as the outsider's, arrived at by
        // accident, which is why it is recorded rather than tidied away.
        reader: reader.peerId,
        stranger: { id: stranger.peerId, relays: stranger.relays },
        member: { id: member.peerId, relays: member.relays },
        outsider: { id: outsider.peerId, relays: outsider.relays },
      }),
    )

    // Refused at one door, admitted at another, in the same run, on two answers taken seconds
    // apart from the same instrument.
    const atGate = await advertisedBy(reader, relay.peerId)
    const atOpenProvider = await advertisedBy(reader, otherProvider.peerId)
    expect(atGate).not.toContain(outsider.peerId)
    expect(atOpenProvider).toContain(outsider.peerId)

    // The arm the gate admitted is at the gate and **not** at the open provider it also
    // dialled — so a grant at the gate ends libp2p's relay search rather than adding to it,
    // and the fall-through is a consequence of the refusal rather than of dialling two peers.
    expect(atGate).toContain(member.peerId)
    expect(atOpenProvider).not.toContain(member.peerId)

    // ## The stranger clause, amended 2026-08-23 — see clause 1 for the ablation
    //
    // It read *"the arm that dialled no second relay-capable peer is in neither"*, asserting
    // `atOpenProvider` does not contain the stranger. That stopped being true the moment
    // `peerInfoMapper: passthroughMapper` made this fabric's routing tables non-empty: the
    // stranger no longer has to *dial* a second relay-capable peer, because `FindPeer` hands
    // it one. Ablating that single line takes this file back to 6 passed, which is how the
    // cause was established rather than guessed.
    //
    // **What the criterion claims is unchanged and is still read here**: admission is
    // per-relay. The gate refused the stranger and the gate does not carry it — that is the
    // subject, and it is asserted below. Where an *open* relay chooses to carry it is that
    // relay's own posture, and the `outsider` arm above already reads exactly that outcome as
    // the expected one; the stranger differing from the outsider was a fact about a broken
    // discovery layer, not about admission.
    expect(atGate).not.toContain(stranger.peerId)

    // Task #53's silent instance, kept and narrowed. The live `advertisedBy` reading above is
    // what carries the clause; a frozen snapshot alone could be satisfied by a grant that
    // simply arrived after it was taken. What the stranger's own process is asked is now the
    // gate-shaped question — it was refused there, and says so — rather than "no relay
    // anywhere", which is no longer a statement about admission.
    expect(stranger.stderr()).toContain('relay reservation refused: PERMISSION_DENIED')
  }, PROCESS_TEST_TIMEOUT)
})
