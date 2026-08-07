/**
 * **THE BOOTSTRAP PARADOX IS FALSE. Measured, 2026-08-06, before the readings below.**
 *
 * `24-VERIFICATION.md` left an apparent paradox standing: if every relay-capable peer refuses
 * an uncertificated peer a circuit reservation, how does anybody ever enrol? This file answers
 * it by measurement rather than by argument, and the answer is that **enrolment never needed a
 * reservation**.
 *
 * A `bin/agent.ts` joiner whose enrolment provider was spawned `--admit-issuer <a key nobody
 * holds>` — so it refuses **every** peer, including the ones it certifies — came away holding
 * a certificate that `verifyCertificate` accepts against that same provider's own published
 * issuer key, while its `relays` list was `[]`, that provider's `reservations` answer was `[]`
 * over the wire, and its stderr named `relay reservation refused: PERMISSION_DENIED`. The
 * byte-identical joiner against a provider spawned with **no** `--admit-issuer` came away with
 * the certificate **and** exactly one circuit, and appeared in that provider's answer. Two
 * arms, one fixture, one run.
 *
 * The mechanism is in `fabric-node.ts` and is now a standing assertion rather than a
 * paragraph: `resolveCertificate` enrols by `libp2p.dial(multiaddr(enrollment.providerAddr))`
 * followed by an RPC over that connection. **There is no reservation anywhere in that path**,
 * and case 4 of the second block below asserts that the RPC frame is answered on the direct
 * connection at a closed peer exactly as at an open one. A refused reservation costs that
 * round trip nothing.
 *
 * ## And the reservation 24-04 saw was a side-effect of dialling, not a precondition
 *
 * `24-VERIFICATION.md`'s sharpest finding was that `admission-agents.node.test.ts`'s in-process
 * `reader` — handed no `enrollment` option, holding no certificate, refused by the gated relay
 * — nevertheless appeared in the open provider's reservation store. The second block below is
 * the account of that, and it separates three things the single observation could not:
 *
 *   1. a node that holds a relay transport and **merely direct-dials** an open HOP-speaking
 *      peer is granted a reservation there, having asked for nothing — libp2p's
 *      `RelayDiscovery` fires off **identify** for any peer speaking HOP;
 *   2. the same node, the same one dial, at a **closed** peer, is granted nothing, held over a
 *      window rather than sampled;
 *   3. a node built with **no `relayAddrs`** installs no `circuitRelayTransport()`, holds the
 *      connection to the same open peer, and is never advertised — while the node in (1) is
 *      still in that peer's answer in the same read.
 *
 * (3) is what stops (1) being read as *"any connected peer is reserved"*. So the reservation
 * `reader` held was **caused by dialling a peer that admits everybody**, and no part of
 * enrolling required it.
 *
 * ## WHAT THIS FILE DOES NOT SHOW, stated before the readings rather than after
 *
 * - **Nothing about the browser tier.** Every process here is `bin/agent.ts` over TCP. A tab
 *   dials WSS/WebRTC and its enrolment path is `gated-admission.e2e.test.ts`'s and 24-07's.
 * - **Nothing about `records` / `providers` gating.** Those answers are ungated by this phase
 *   and `24-CONTEXT.md` files closing them as a deferred idea. Nothing here touches them.
 * - **Nothing about a fabric in which every door is closed.** Both blocks below close *one*
 *   named process at a time. The reading that criterion 8's own wording needs — a fabric with
 *   no open relay-capable peer reachable by an unadmitted node — is 24-07's and 24-08's, and
 *   this file licenses building it rather than substituting for it.
 * - **Nothing about `bin/seed.ts`.** The seed's posture is still hardcoded open
 *   (`seed-server.ts`) and is 24-06's subject. What this file establishes is only that closing
 *   it cannot lock the front door against a joiner that has an address to dial.
 * - **Nothing about whether a closed provider is a good deployment.** It is a measurement that
 *   the deployment is *possible*, not an argument that it is wise.
 */
import { spawn } from 'node:child_process'
import type { ChildProcessByStdio } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Readable, Writable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { verifyCertificate } from '@o2/core'
import type { NodeCertificate, PublicKeyHex } from '@o2/core'
import { SEED_BYTES } from '@o2/libp2p'
import { encodeRequest, parseResponse } from '@o2/net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FabricNode } from './fabric-node.ts'

const AGENT = fileURLToPath(new URL('./bin/agent.ts', import.meta.url))

/**
 * The four budgets below are `admission-agents.node.test.ts`'s, **by value and not by
 * import**, because that file sited each of them against a measured number and importing a
 * constant from another `.test.ts` re-registers that file's whole suite.
 *
 * `ANNOUNCE_BUDGET_MS` matches `discovery-agents.node.test.ts` and
 * `reservation-exhaustion.node.test.ts`. `RESERVATION_BUDGET_MS` sits above both libp2p's
 * internal reservation retry and the gate's own `RELAY_ADMISSION_DEADLINE_MS` of 3 500 ms.
 * `ABSENCE_WINDOW_MS` is a window rather than a sample, and every absence read against it in
 * this file is read **after** a presence was established in the same run on the same fixture,
 * so the window is known to be longer than a grant takes on this host.
 */
const ANNOUNCE_BUDGET_MS = 60_000
const PROCESS_TEST_TIMEOUT = 300_000
const RESERVATION_BUDGET_MS = 60_000
const ABSENCE_WINDOW_MS = 5_000

/**
 * A well-formed issuer key nobody in this file holds — the pinned posture of every closed
 * process below.
 *
 * Deliberately unheld rather than "some other provider's key": a door pinned to a key that
 * exists could, in principle, have admitted somebody, and the sharpest available statement
 * is that the joiner **could not have satisfied the door even if it had already enrolled**.
 * So the certificate it ends up holding cannot have come through the door.
 *
 * 64 lowercase hex characters, which is what `bin/agent.ts` validates `--admit-issuer`
 * against — anything else is exit 2 and the fixture would fail to stand up rather than
 * silently produce an open process.
 */
const NOBODY = 'e'.repeat(64)

type AgentProcess = ChildProcessByStdio<Writable, Readable, Readable>

/**
 * The key `bin/agent.ts` publishes its admission posture under.
 *
 * A constant, and the posture is read by **indexing** rather than by a declared property on
 * {@link Handshake}. `relay-admission.node.test.ts` requires the field to be declared in
 * exactly one type in the whole repository, so that two node factories cannot grow two
 * answers to *"who does this node admit"*; a reader's view of a JSON line is not a second
 * factory, but that census reads text and cannot tell the two apart.
 * `admission-agents.node.test.ts` records the observed failure and the same repair.
 */
const POSTURE_KEY = 'relayAdmission'

/** The handshake line, by name. */
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

/** SIGTERM, then wait for the process to actually be gone; SIGKILL after 10 s. */
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
 * The `observed` thunk is not decoration: a failure that reports only `timed out waiting for
 * …` at a duration equal to its own budget is evidence of the timeout and of nothing else.
 * Defined locally rather than imported, for the reason `spawnAgent` above is.
 *
 * ## `observed` is AWAITED, and that was a defect caught by a plant rather than by reading
 *
 * Every reading in this file that could name what arrived is a **round trip** — an RPC to a
 * spawned process — so its thunk is `async`. `admission-agents.node.test.ts`'s `until` takes
 * `() => unknown` and stringifies the value directly, which for a promise produces `{}`.
 * Measured here, not reasoned about: plant P3 first failed as
 * `timed out waiting for the reader to be granted a reservation at the open hop it merely
 * dialled; observed {}` at **60 957 ms against a 60 000 ms budget** — a duration equal to the
 * timeout **and** an observation that named nothing, which is the exact failure the thunk
 * exists to prevent, reproduced by the mechanism meant to prevent it. It also left an
 * unhandled `RpcFailure: rpc endpoint closed` behind, because the un-awaited request was still
 * in flight when `afterEach` stopped the node.
 *
 * With the `await` below the same plant reports the list. The `Awaited` in the signature is
 * what makes a synchronous thunk still legal, so this is a widening rather than a new rule.
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

/** Hold `predicate` false for the whole window, or fail naming when it first became true. */
async function stays(
  predicate: () => boolean | Promise<boolean>,
  windowMs: number,
  what: string,
  observed?: () => unknown | Promise<unknown>,
): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < windowMs) {
    if (await predicate()) {
      const elapsed = Date.now() - started
      const tail = observed === undefined ? '' : `; observed ${JSON.stringify(await observed())}`
      throw new Error(`${what} stopped holding after ${elapsed}ms${tail}`)
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

/** The direct, non-relayed address a peer announced for itself. */
function directAddrOf(agent: Agent): string {
  const direct = agent.multiaddrs.find((address) => !address.includes('/p2p-circuit'))
  if (direct === undefined) {
    throw new Error(`${agent.name} announced no direct address: ${JSON.stringify(agent.multiaddrs)}`)
  }
  return direct
}

/** The circuit addresses a peer announced **through one named relay**. */
function circuitsThrough(agent: Agent, relayPeerId: string): readonly string[] {
  return agent.relays.filter((address) => address.includes(`/p2p/${relayPeerId}/p2p-circuit`))
}

/**
 * Ask a peer, over the wire, who is reserved on it.
 *
 * **The production rendezvous path**, not a getter read a second time: `findReservedPeers`
 * (`net/src/rendezvous.ts`) issues exactly this request and `fabric-node.ts` answers it from
 * the thunk `() => node.reservedPeerIds`. Every process asked below is a `bin/agent.ts`,
 * which builds a `FabricNode`, so the thunk is what answers.
 */
async function advertisedBy(reader: FabricNode, peerId: string): Promise<readonly string[]> {
  const body = await reader.rpc.request(peerId, encodeRequest({ kind: 'reservations' }))
  const response = parseResponse(body)
  if (response === null || response.kind !== 'reservations') {
    throw new Error(`${peerId} answered a reservations request with ${JSON.stringify(response)}`)
  }
  return response.peerIds
}

beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'o2-enrol-no-reservation-'))
})

/** 60 s, which must exceed `stopAgent`'s inner 10 s or its SIGKILL fallback could never fire. */
afterEach(async () => {
  await Promise.all(nodes.splice(0).map((node) => node.stop().catch(() => {})))
  await Promise.all(agents.splice(0).map((agent) => stopAgent(agent).catch(() => {})))
  await rm(workdir, { recursive: true, force: true })
}, 60_000)

/**
 * One arm of the reading: a provider, and a joiner whose only route to a certificate is that
 * provider.
 */
interface Arm {
  readonly name: string
  readonly provider: Agent
  readonly joiner: Agent
  readonly providerAddr: string
}

/**
 * Stand one arm up.
 *
 * The joiner's argv is **the same list in both arms** apart from `--dir` (two processes
 * cannot share a blockstore) and the provider address itself — same `--port 0`, same
 * `--relay-addr`, same `--user-key` **file**, same `--operator-id`. Without that, a
 * difference below would also be explained by the fixture. The single shared key file is
 * deliberate: both joiners enrol as the same user, so the only variable across the two arms
 * is the provider's posture.
 */
async function standUpArm(name: string, providerArgs: readonly string[], userKey: string): Promise<Arm> {
  const provider = await spawnAgent(`${name}-provider`, [
    '--port',
    '0',
    '--issues-certificates',
    '--max-issued-per-window',
    '64',
    ...providerArgs,
  ])
  if (provider.issuerKey === null) throw new Error(`${name}: the provider announced no issuer key`)
  const providerAddr = directAddrOf(provider)

  // `--relay-addr` and `--provider-addr` name the SAME peer, deliberately. That is the
  // co-located topology 24-CONTEXT's sub-decision 1 is about and the one a browser tab
  // meets: the door a peer is refused at is the same door it must enrol through. A
  // separated deployment would make the question trivial.
  const joiner = await spawnAgent(`${name}-joiner`, [
    '--port',
    '0',
    '--relay-addr',
    providerAddr,
    '--provider-addr',
    providerAddr,
    '--user-key',
    userKey,
    '--operator-id',
    'bootstrap-ops',
  ])

  return { name, provider, joiner, providerAddr }
}

describe('the bootstrap question — a provider that refuses the joiner a reservation', () => {
  /**
   * **Both arms, one fixture, one run, because neither arm alone carries the claim.**
   *
   * *"Enrolment worked against a closed provider"* says nothing without the open arm showing
   * the same fixture obtaining a reservation; *"the reservation was refused"* says nothing
   * without an assertion that a reservation was ever obtainable from that fixture.
   *
   * ## Order
   *
   * The certificate and the empty `relays` list are asserted **before** the stderr wait, and
   * that ordering was paid for: `24-04-SUMMARY.md` finding 4 records a planted failure
   * reporting `timed out waiting for …` at 62 499 ms against a 60 000 ms budget — a duration
   * equal to a timeout, which this repository reads as evidence of the timeout and of nothing
   * else. Reordered, the same plant named the fact in about two seconds. stderr is the
   * operator-facing consequence, not the load-bearing reading.
   *
   * ## Budget
   *
   * Four child processes — two providers, two joiners — plus one in-process reader that is
   * never a subject. `admission-agents.node.test.ts` runs six and
   * `tree-reduce-agents.node.test.ts` nine.
   */
  it('a joiner the provider refuses a reservation still holds that provider’s certificate, and the open arm holds both', async () => {
    const userKey = await writeUserKey('joiner', 0xb1)
    // Sequential rather than parallel: the open arm is stood up **first**, so every absence
    // read afterwards is read against a fixture this run has already watched grant.
    const open = await standUpArm('open', [], userKey)
    const closed = await standUpArm('closed', ['--admit-issuer', NOBODY], userKey)

    // ---- the fixture, asserted off the processes' own handshake lines ------------------
    //
    // **Never off the argv this file passed.** The two can disagree and only one of them is
    // what the process is doing; a typo in a spawn argument otherwise produces an open
    // provider and the whole reading passes for the wrong reason.
    expect(closed.provider.posture).toStrictEqual([NOBODY])
    expect(closed.provider.posture).not.toBe('admits-any-peer')
    expect(open.provider.posture).toBe('admits-any-peer')
    // Both providers really issue, or there is nothing to enrol against and every
    // certificate assertion below would be about a fixture rather than about a door.
    expect(closed.provider.issuerKey).not.toBeNull()
    expect(open.provider.issuerKey).not.toBeNull()
    expect(closed.provider.issuerKey).not.toBe(open.provider.issuerKey)
    // And neither joiner is a second door refusing on its own side.
    for (const arm of [open, closed]) {
      expect(arm.joiner.posture, `${arm.joiner.name} states a posture it was not given`).toBe('admits-any-peer')
    }

    // ---- ARM A, the load-bearing reading, deliberately first ---------------------------
    //
    // A certificate that `verifyCertificate` accepts against the **closed** provider's own
    // issuer key, held by a peer that provider pinned itself shut against. Not a non-null
    // field: the verdict, offline, against the key the door published.
    expect(closed.joiner.certificate).not.toBeNull()
    expect(closed.joiner.certificate?.issuer).toBe(closed.provider.issuerKey)
    expect(closed.joiner.certificate?.nodeKey).toBe(closed.joiner.nodeKey)
    const closedVerdict = verifyCertificate(
      closed.joiner.certificate as NonNullable<typeof closed.joiner.certificate>,
      new Set<PublicKeyHex>([closed.provider.issuerKey as PublicKeyHex]),
      Date.now(),
    )
    expect(closedVerdict.ok, closedVerdict.ok ? '' : closedVerdict.reason).toBe(true)
    // And it holds no circuit — not through this provider, and not through anybody, because
    // this arm dialled no other relay-capable peer.
    expect(circuitsThrough(closed.joiner, closed.provider.peerId)).toStrictEqual([])
    expect(closed.joiner.relays).toStrictEqual([])

    // ---- ARM B, the control that makes arm A a reading rather than an absence ----------
    expect(open.joiner.certificate).not.toBeNull()
    expect(open.joiner.certificate?.issuer).toBe(open.provider.issuerKey)
    const openVerdict = verifyCertificate(
      open.joiner.certificate as NonNullable<typeof open.joiner.certificate>,
      new Set<PublicKeyHex>([open.provider.issuerKey as PublicKeyHex]),
      Date.now(),
    )
    expect(openVerdict.ok, openVerdict.ok ? '' : openVerdict.reason).toBe(true)
    // Exactly one circuit, and it is through the provider it enrolled with.
    expect(circuitsThrough(open.joiner, open.provider.peerId)).toHaveLength(1)
    expect(open.joiner.relays).toHaveLength(1)

    // ---- the operator-facing consequence, read after the facts above -------------------
    await until(
      () => closed.joiner.stderr().includes('relay reservation refused: PERMISSION_DENIED'),
      RESERVATION_BUDGET_MS,
      'the refused joiner to name its refusal on stderr',
      () => ({ stderr: closed.joiner.stderr() }),
    )
    expect(closed.joiner.stderr()).toContain('agent.ts: relay reservation refused: PERMISSION_DENIED')
    // Not a capacity refusal — the distinction NET-05 exists to make legible.
    expect(closed.joiner.stderr()).not.toContain('at-capacity')
    // The open arm was refused nothing.
    expect(open.joiner.stderr()).not.toContain('relay reservation refused')

    // ---- and the same fact taken over the wire from each provider's own store ----------
    //
    // The reader holds **no `relayAddrs`**, so `fabric-node.ts` installs no
    // `circuitRelayTransport()` for it and it cannot take a reservation anywhere. That is
    // what makes each answer below the joiner's reading and not partly the instrument's.
    const reader = await FabricNode.start({
      relayAdmission: 'admits-any-peer',
      startReporting: 'reports-its-own-start',
      blockstoreDir: join(workdir, 'reader'),
      listen: ['/ip4/127.0.0.1/tcp/0'],
      rpcTimeoutMs: 20_000,
      trustAnchors: 'runs-unsigned-artifacts',
    })
    nodes.push(reader)
    await reader.dial(open.providerAddr)
    await reader.dial(closed.providerAddr)

    // The presence half FIRST. Without it every absence below is satisfied by `[]`.
    await until(
      async () => (await advertisedBy(reader, open.provider.peerId)).includes(open.joiner.peerId),
      RESERVATION_BUDGET_MS,
      'the open arm’s joiner to appear in its provider’s reservation store',
      () => ({ relays: open.joiner.relays }),
    )
    const openHolds = await advertisedBy(reader, open.provider.peerId)
    expect(openHolds).toContain(open.joiner.peerId)
    // The instrument is connected to that provider and is not in its answer, because it
    // installed no circuit-relay transport. A list that was "peers I am talking to" would
    // contain it.
    expect(openHolds).not.toContain(reader.peerId)

    // The absence half, held over a window rather than sampled once, and read against a
    // fixture already watched granting.
    await stays(
      async () => (await advertisedBy(reader, closed.provider.peerId)).length > 0,
      ABSENCE_WINDOW_MS,
      'the closed provider’s reservation store staying empty',
      () => ({ stderr: closed.joiner.stderr().slice(-300) }),
    )
    const closedHolds = await advertisedBy(reader, closed.provider.peerId)
    expect(closedHolds).toStrictEqual([])

    // eslint-disable-next-line no-console -- the topology IS this file's product; a reading
    // recorded only inside an assertion is one the next reader has to re-derive.
    console.log(
      '[bootstrap]',
      JSON.stringify({
        closedProvider: { id: closed.provider.peerId, posture: closed.provider.posture },
        openProvider: { id: open.provider.peerId, posture: open.provider.posture },
        closedJoiner: {
          id: closed.joiner.peerId,
          certificateIssuer: closed.joiner.certificate?.issuer ?? null,
          relays: closed.joiner.relays,
        },
        openJoiner: {
          id: open.joiner.peerId,
          certificateIssuer: open.joiner.certificate?.issuer ?? null,
          relays: open.joiner.relays,
        },
        closedProviderHolds: closedHolds,
        openProviderHolds: openHolds,
        reader: reader.peerId,
      }),
    )

    // Every process is alive and serving, so no absence above is a node that fell over.
    for (const agent of [open.provider, open.joiner, closed.provider, closed.joiner]) {
      expect(agent.child.exitCode, `${agent.name} exited: ${agent.stderr()}`).toBeNull()
      expect(agent.pid).toBe(agent.child.pid)
    }
  }, PROCESS_TEST_TIMEOUT)
})

describe('the account of the reader — a reservation nobody asked for', () => {
  /**
   * **What produced the second peer id in 24-04's `openProviderHolds`.**
   *
   * `24-VERIFICATION.md` found `admission-agents.node.test.ts`'s in-process `reader` — a node
   * handed no `enrollment` option, holding no certificate, refused by the gated relay —
   * sitting in the open provider's reservation store, and read that as the criterion failing
   * over the fabric. The mechanism was never measured. These four cases measure it.
   *
   * The four are one `it` because they are one causal chain: case 2's absence window is only
   * a reading if case 1's grant has already been watched on the same host in the same run,
   * and case 3 is only a control if case 1 held.
   */
  it('acquires a reservation at an open peer it merely dialled, none at a closed one, and none at all without a relay transport', async () => {
    const openHop = await spawnAgent('open-hop', ['--port', '0'])
    const closedHop = await spawnAgent('closed-hop', ['--port', '0', '--admit-issuer', NOBODY])

    // Postures off the processes' own handshake lines, before anything else.
    expect(openHop.posture).toBe('admits-any-peer')
    expect(closedHop.posture).toStrictEqual([NOBODY])

    const openAddr = directAddrOf(openHop)
    const closedAddr = directAddrOf(closedHop)

    /**
     * The reader. **No `enrollment` key at all**, so it holds no certificate and could not
     * satisfy either door.
     *
     * `relayAddrs` names an address it will never be admitted at — `closedHop`'s — which is
     * honest and is also what `admission-agents.node.test.ts` did by accident. The value is
     * not decoration: `fabric-node.ts` installs `circuitRelayTransport()` only on the
     * `viaRelay` arm, so this line is what gives the node the ability to hold a reservation
     * anywhere at all. Case 3 below is the same node without it.
     */
    const reader = await FabricNode.start({
      relayAdmission: 'admits-any-peer',
      startReporting: 'reports-its-own-start',
      blockstoreDir: join(workdir, 'reader'),
      listen: ['/ip4/127.0.0.1/tcp/0'],
      relayAddrs: [closedAddr],
      rpcTimeoutMs: 20_000,
      trustAnchors: 'runs-unsigned-artifacts',
    })
    nodes.push(reader)

    // ---- CASE 1 — one direct dial, no reservation request, and a reservation appears ---
    //
    // This is the whole account of the second id in 24-04's `openProviderHolds`: libp2p's
    // `RelayDiscovery` fires off the **identify** event for any peer speaking the relay HOP
    // protocol, and a `bin/agent.ts --port` without `--admit-issuer` is relay-capable and
    // admits everybody. Nothing here asks for anything.
    await reader.dial(openAddr)
    await until(
      async () => (await advertisedBy(reader, openHop.peerId)).includes(reader.peerId),
      RESERVATION_BUDGET_MS,
      'the reader to be granted a reservation at the open hop it merely dialled',
      async () => ({ openHopHolds: await advertisedBy(reader, openHop.peerId) }),
    )
    const openHopHolds = await advertisedBy(reader, openHop.peerId)
    expect(openHopHolds).toContain(reader.peerId)

    // ---- CASE 2 — the same node, the same one dial, at a closed peer -------------------
    //
    // Held over a window rather than sampled once, and case 1 established in the same run
    // that a grant on this host takes far less than the window. A comparative reading.
    await reader.dial(closedAddr)
    await stays(
      async () => (await advertisedBy(reader, closedHop.peerId)).includes(reader.peerId),
      ABSENCE_WINDOW_MS,
      'the reader staying out of the closed hop’s reservation store',
      async () => ({ closedHopHolds: await advertisedBy(reader, closedHop.peerId) }),
    )
    const closedHopHolds = await advertisedBy(reader, closedHop.peerId)
    expect(closedHopHolds).not.toContain(reader.peerId)
    // The connection stands regardless. This phase closes a door; it does not drop a peer.
    expect(reader.transport.peers).toContain(closedHop.peerId)
    expect(reader.transport.peers).toContain(openHop.peerId)

    // ---- CASE 3 — the control that makes case 1 about a reservation, not a connection ---
    //
    // A node with **no `relayAddrs` key at all** installs no `circuitRelayTransport()` and so
    // has nothing to reserve with. It dials the same open hop, holds the connection, and is
    // never advertised. Without this, case 1 could be read as "any connected peer is
    // reserved" — which would make case 2 a statement about the connection.
    const bare = await FabricNode.start({
      relayAdmission: 'admits-any-peer',
      startReporting: 'reports-its-own-start',
      blockstoreDir: join(workdir, 'bare'),
      listen: ['/ip4/127.0.0.1/tcp/0'],
      rpcTimeoutMs: 20_000,
      trustAnchors: 'runs-unsigned-artifacts',
    })
    nodes.push(bare)
    await bare.dial(openAddr)
    expect(bare.transport.peers).toContain(openHop.peerId)
    await stays(
      async () => (await advertisedBy(bare, openHop.peerId)).includes(bare.peerId),
      ABSENCE_WINDOW_MS,
      'the transport-less node staying out of the OPEN hop’s reservation store',
      async () => ({ openHopHolds: await advertisedBy(bare, openHop.peerId) }),
    )
    const openHopHoldsAfterBare = await advertisedBy(bare, openHop.peerId)
    expect(openHopHoldsAfterBare).not.toContain(bare.peerId)
    // And the open hop is still granting — the reader is still in it — so this absence is
    // the missing transport and not a hop that stopped granting.
    expect(openHopHoldsAfterBare).toContain(reader.peerId)

    // ---- CASE 4 — the mechanism, and the reason enrolment survives a closed provider ----
    //
    // **This is the load-bearing half of the whole file.** An `enrol` round trip is an RPC
    // over exactly this connection — `resolveCertificate` dials `providerAddr` and calls
    // `enrolOverRpc` on the resulting connection, with no reservation anywhere in the path.
    // So a refused reservation costing the RPC nothing IS the mechanism by which a closed
    // provider can still certify. The same frame that carries `reservations` here carries
    // `enrol` there.
    for (const hop of [openHop, closedHop]) {
      const body = await reader.rpc.request(hop.peerId, encodeRequest({ kind: 'reservations' }))
      const answer = parseResponse(body)
      expect(answer?.kind, `${hop.name} did not answer an RPC on the direct connection`).toBe('reservations')
    }

    // eslint-disable-next-line no-console -- the mechanism IS this case's product.
    console.log(
      '[bootstrap] reader',
      JSON.stringify({
        reader: reader.peerId,
        bare: bare.peerId,
        openHop: { id: openHop.peerId, posture: openHop.posture, holds: openHopHoldsAfterBare },
        closedHop: { id: closedHop.peerId, posture: closedHop.posture, holds: closedHopHolds },
        readerHasRelayTransport: true,
        bareHasRelayTransport: false,
      }),
    )

    for (const agent of [openHop, closedHop]) {
      expect(agent.child.exitCode, `${agent.name} exited: ${agent.stderr()}`).toBeNull()
    }
  }, PROCESS_TEST_TIMEOUT)
})
