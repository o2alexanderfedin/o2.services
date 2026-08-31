import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ConnectionGater, PeerId } from '@libp2p/interface'
import { peerIdFromString } from '@libp2p/peer-id'
import { verifyCertificate } from '@o2/core'
import type { PublicKeyHex } from '@o2/core'
import { O2_RPC_PROTOCOL, SEED_BYTES, nodeKeyForPeerId } from '@o2/libp2p'
import { encodeRequest, parseResponse } from '@o2/net'
import { FabricNode } from './fabric-node.ts'
import type { FabricNodeOptions } from './fabric-node.ts'
import { ReservationWatcher, STATUS_PERMISSION_DENIED } from './reservation-watch.ts'

/**
 * AUTH-02 / AUTH-04 — **the blocking measurement for Phase 24, kept as a permanent guard.**
 *
 * ## The question, and why it had to be answered before a gate was built
 *
 * Phase 24 puts admission at the circuit reservation:
 * `connectionGater.denyInboundRelayReservation` refuses a peer that cannot present a
 * provider-issued certificate. That seam is only implementable if a peer refused the
 * reservation can still open a plain connection and **enrol over it** — otherwise the door
 * is shut on the only route through it, and a fabric nobody can join is not a secured
 * fabric. `24-CONTEXT.md` calls this out as the one measurement that could block the phase,
 * and the two arms below are it.
 *
 * The arms are **one fixture, two postures, one run**. Neither arm alone carries the claim:
 * "enrolment worked" against a closed door is unattributable without the open arm showing
 * the same fixture obtaining a reservation, and "the reservation was refused" is
 * unattributable without an assertion that a reservation was ever obtainable.
 *
 * ## Why the gater is installed from the test rather than through an option
 *
 * `FabricNodeOptions` had no way to refuse anybody when this file was written — that is
 * Plan 24-03 task 2, and this task must be able to run and report *before* it exists so
 * that a negative result costs nothing. libp2p's own defaulting is what makes this
 * possible and it is worth writing down, because it looks like a hack and is not:
 * `libp2p/dist/src/config/connection-gater.js` is `connectionGater(gater = {}) { return
 * gater }`, and `libp2p.js` stores that value at `components.connectionGater`. A node
 * given no gater therefore holds a **live, empty, mutable object** that
 * `CircuitRelayServer` reads through `this.components.connectionGater` at call time.
 * Measured 2026-08-06: the keys go from `[]` to `['denyInboundRelayReservation']` and
 * `services.relay.components === libp2p.components`.
 *
 * ## The hinge, which is what this file is really for
 *
 * The plan's original premise for task 2 was *"at reservation time the peer is connected
 * and identified, so the same records exchange `PeerVerifier` uses is available"*. **It is
 * false on the first pass and the case below measures exactly how false.** The hook's whole
 * signature is `denyInboundRelayReservation?(source: PeerId)` — a peer id and nothing else —
 * while `PeerVerifier.#decide` reaches its verdict by *asking the peer* over the fabric's
 * own `records` RPC. On a joining node the relay-dial loop runs before
 * `Libp2pTransport.start` and long before `serveAgent`, so at the moment the relay's gater
 * fires the joiner has **nothing serving** and cannot answer. `peer-verifier.ts`'s header
 * already records that failure shape from a neighbouring case; this file confirms it *at
 * the door*, with numbers.
 */

const USER_SEED = new Uint8Array(SEED_BYTES).fill(0xd0)

/**
 * How long a probe issued from inside the gater is allowed to take.
 *
 * This is the door's `rpcTimeoutMs`, deliberately far below `FabricNode`'s 30 s default,
 * because the hinge case's whole purpose is to find out whether that probe *settles* — and
 * a case that pays the production budget to learn "no" costs 30 s to say something a 4 s
 * budget says identically. The recorded observation states the budget beside the duration
 * for exactly the reason `24-02-SUMMARY.md` records: **a duration equal to a timeout is
 * evidence of the timeout**, so a reading of "~4 s" is only meaningful next to the number
 * it was bounded by.
 */
const GATER_PROBE_BUDGET_MS = 700

/**
 * How long the whole in-gater lookup is allowed to run, retries included.
 *
 * Sited **against {@link LIBP2P_RESERVATION_COMPLETION_TIMEOUT_MS}, not against
 * preference**: a gater that blocks `handleReserve` past the joiner's own 5 s completion
 * ceiling fails the reservation on the client's clock regardless of the verdict it reaches,
 * so any lookup that is going to be useful has to finish inside that. This is the largest
 * round number comfortably below it, which is what makes "the verdict was reachable in time"
 * a comparative reading rather than an absolute one.
 */
const GATER_LOOKUP_DEADLINE_MS = 4_000

let workdir: string
const nodes: FabricNode[] = []

beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'o2-closed-door-'))
})

afterEach(async () => {
  await Promise.all(nodes.splice(0).map((n) => n.stop().catch(() => {})))
  await rm(workdir, { recursive: true, force: true })
}, 30_000)

async function start(options: Partial<FabricNodeOptions> = {}): Promise<FabricNode> {
  const node = await FabricNode.start({
    relayAdmission: 'admits-any-peer',
    startReporting: 'reports-its-own-start',
    listen: ['/ip4/127.0.0.1/tcp/0/ws'],
    // DET-03 — nothing in this file dispatches a task, so module provenance is not the
    // subject. Stated rather than defaulted, which is what the required field is for.
    trustAnchors: 'runs-unsigned-artifacts',
    ...options,
  })
  nodes.push(node)
  return node
}

/**
 * The node that is both the relay and the enrolment provider.
 *
 * **Co-located deliberately**, because that is the topology sub-decision 1 is about and the
 * one `browser-enrollment.e2e.test.ts` describes for a tab: `relayAddrs: [provider]` and
 * `enrollment.providerAddr` are the same address, so the door a peer is refused at is the
 * same door it must enrol through. A separated deployment would make the question trivial
 * and would not be the case that could block the phase.
 */
async function openDoor(options: Partial<FabricNodeOptions> = {}): Promise<FabricNode> {
  return start({
    blockstoreDir: join(workdir, `door-${nodes.length}`),
    issuesCertificates: 'issues-without-an-aggregate-budget',
    ...options,
  })
}

const wsAddrOf = (node: FabricNode): string => {
  const addr = node.browserDialableAddrs[0]
  if (addr === undefined) throw new Error(`no browser-dialable address on ${node.peerId}`)
  return addr
}

/**
 * Wait until `predicate` holds, or fail after `timeoutMs`, **naming what actually arrived**.
 *
 * The `observed` thunk is not decoration. `24-02-SUMMARY.md` records a plant that reported
 * only `timed out waiting for 3 reservations` at 30 198 ms against a 30 000 ms deadline — a
 * duration equal to a timeout is evidence of the timeout and says nothing about which
 * reading moved. Every call here that could fail informatively passes one.
 *
 * The predicate may be async, because two of the readings in this file are round trips.
 */
async function until(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs: number,
  what: string,
  observed?: () => unknown,
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
    await new Promise((r) => setTimeout(r, 50))
  }
  if (await attempt()) return
  const threw =
    lastError === undefined
      ? ''
      : `; last attempt threw ${lastError instanceof Error ? lastError.message : String(lastError)}`
  const tail = observed === undefined ? '' : `; observed ${JSON.stringify(observed())}`
  throw new Error(`timed out waiting for ${what}${threw}${tail}`)
}

/** Hold `predicate` false for the whole window, or fail naming when it first became true. */
async function stays(
  predicate: () => boolean,
  windowMs: number,
  what: string,
  observed?: () => unknown,
): Promise<void> {
  const deadline = Date.now() + windowMs
  while (Date.now() < deadline) {
    if (predicate()) {
      const tail = observed === undefined ? '' : `; observed ${JSON.stringify(observed())}`
      throw new Error(`${what} stopped holding after ${windowMs - (deadline - Date.now())}ms${tail}`)
    }
    await new Promise((r) => setTimeout(r, 50))
  }
}

/**
 * The live, empty gater object libp2p keeps for a node that was given none.
 *
 * Narrowed through `unknown` rather than declared, because `Libp2p` — the interface
 * `createLibp2p` returns — does not publish `components`; the concrete `Libp2pNode` class
 * does (`libp2p/dist/src/libp2p.d.ts`: `components: Components & T`). Reaching it is a
 * **test-only** move and is confined to this one function so there is exactly one place to
 * repair if a release stops exposing it. The assertion is what makes that repair loud
 * instead of silent: a gater that was never installed and a gater that allowed everything
 * are indistinguishable from the outside, which is the failure mode this whole file exists
 * to refuse.
 */
function gaterOf(node: FabricNode): ConnectionGater {
  const components = (node.libp2p as unknown as { readonly components?: { readonly connectionGater?: ConnectionGater } })
    .components
  const gater = components?.connectionGater
  if (gater === undefined) {
    throw new Error(
      'libp2p no longer exposes components.connectionGater — the mechanism this file measures has moved',
    )
  }
  return gater
}

/**
 * libp2p's own ceiling on how long a reservation may take to complete, read off the
 * installed package rather than assumed.
 *
 * `@libp2p/circuit-relay-v2/dist/src/constants.js` declares
 * `DEFAULT_RESERVATION_COMPLETION_TIMEOUT = 5_000`, and the **joining** side wraps its whole
 * reserve — connection open, RESERVE write, response read — in `AbortSignal.timeout` of that
 * value. It is therefore a hard ceiling on any lookup a gater performs: a gate that blocks
 * `handleReserve` for longer than this fails the reservation on the client's clock no matter
 * what verdict it eventually reaches, and the peer is refused *without ever being judged*.
 *
 * Pinned as a number here and asserted against the installed source below, because the whole
 * design question "can the gate go and ask?" is really "can it ask and answer inside this".
 */
const LIBP2P_RESERVATION_COMPLETION_TIMEOUT_MS = 5_000

/** What one firing of the hook saw, recorded rather than reasoned about. */
interface Firing {
  readonly peerId: string
  /** Non-null iff the peer id names an Ed25519 key — available with no I/O at all. */
  readonly nodeKeyFromPeerId: string | null
  /** Connections the relay holds to this peer at the instant the hook fires. */
  readonly connections: number
  /** Protocols identify has recorded for the peer by then, `null` if it knows the peer at all. */
  readonly knownProtocols: readonly string[] | null
  /** Whether the peer is known to speak the fabric's own RPC — i.e. could answer `records`. */
  readonly speaksFabricRpc: boolean
  /** How long the peerStore read took. */
  readonly peerStoreMs: number
}

describe('AUTH-02 — the door refuses the reservation and enrolment goes through it anyway', () => {
  /**
   * **The blocking measurement.** Both arms, one run, and the claim is the difference.
   *
   * Five readings carry it, and each closes a different way this case could report success
   * for the wrong reason:
   *
   * 1. **the open arm is really open** — the same fixture with no gater obtains a
   *    reservation. Without it, "enrolment worked" says nothing about the door.
   * 2. **the closed arm is really closed** — `reservedPeerIds` never contains the joiner,
   *    held over a window rather than sampled once. A test that thought it closed the door
   *    and did not is the single most likely way this file lies.
   * 3. **the gater fired** — the call count, not the outcome. `denyInboundRelayReservation`
   *    is invoked with `?.`, so a method that is absent, misspelled, or attached to the
   *    wrong object fails **open, silently**, and the peer still gets in.
   * 4. **the node started** — asserted as *serving*, not as "`start` did not reject". The
   *    joiner answers a `records` request over the fabric's own RPC, which is a fact about
   *    `serveAgent` being up rather than about a promise having resolved.
   * 5. **the enrolment is real** — the certificate `verifyCertificate` accepts against the
   *    door's own issuer key, not merely a non-null field.
   */
  it('refuses the reservation, and the same peer still connects, starts, serves and enrols', async () => {
    const door = await openDoor()
    const doorAddr = wsAddrOf(door)
    const issuer = door.issuerKey
    expect(issuer, 'the door must issue certificates or there is nothing to enrol against').not.toBeNull()

    // ---- arm A: the door is open. Nothing is installed; this is today's fabric. -------
    const openWatcher = new ReservationWatcher()
    const admitted = await start({
      blockstoreDir: join(workdir, 'admitted'),
      listen: [],
      relayAddrs: [doorAddr],
      reservationWatcher: openWatcher,
      rpcTimeoutMs: 20_000,
      enrollment: { userPrivateKey: USER_SEED, operatorId: 'harbour-ops', providerAddr: doorAddr },
    })
    await until(
      () => door.reservedPeerIds.includes(admitted.peerId),
      30_000,
      'the open arm to obtain a reservation',
      () => ({ reserved: door.reservedPeerIds.length, failures: openWatcher.failures }),
    )
    expect(door.reservedPeerIds).toContain(admitted.peerId)
    expect(openWatcher.failures).toEqual([])

    // ---- arm B: the same door, now refusing. -----------------------------------------
    const refused: string[] = []
    gaterOf(door).denyInboundRelayReservation = (source: PeerId): boolean => {
      refused.push(source.toString())
      return true
    }

    const closedWatcher = new ReservationWatcher()
    const joiner = await start({
      blockstoreDir: join(workdir, 'joiner'),
      listen: [],
      relayAddrs: [doorAddr],
      reservationWatcher: closedWatcher,
      rpcTimeoutMs: 20_000,
      enrollment: { userPrivateKey: USER_SEED, operatorId: 'harbour-ops', providerAddr: doorAddr },
    })

    // 3. The gater fired, and fired for *this* peer. Asserted before anything downstream,
    //    because every reading below is unattributable without it.
    await until(
      () => refused.includes(joiner.peerId),
      30_000,
      'the gater to be consulted about the joiner',
      () => ({ refused }),
    )

    // 2. And the refusal took: the reservation never happens, held over a window. The open
    //    arm above took well under this to appear, so a window of the same order is a
    //    comparative reading rather than an absolute one.
    await stays(
      () => door.reservedPeerIds.includes(joiner.peerId),
      3_000,
      'the joiner staying out of the reservation store',
      () => ({ reserved: door.reservedPeerIds }),
    )
    expect(door.reservedPeerIds).not.toContain(joiner.peerId)
    // The open arm's reservation is untouched. The refusal is per-peer, not a switch on
    // the relay — which is the third of the three properties the seam rests on.
    expect(door.reservedPeerIds).toContain(admitted.peerId)

    // 1'. The relay is reachable throughout — the plain connection stands. This is the
    //     property `bench-admission.node.test.ts`'s baseline measured before any gate
    //     existed, re-read here with a real refusal rather than a capacity cap.
    expect(joiner.transport.peers).toContain(door.peerId)

    // 4. The node *started*, and started means serving. A `records` request answered over
    //    `/o2/rpc/1.0.0` is `serveAgent` being up; a resolved `start` promise is not.
    const nodeKey = nodeKeyForPeerId(joiner.peerId)
    expect(nodeKey).not.toBeNull()
    const answer = parseResponse(
      await door.rpc.request(joiner.peerId, encodeRequest({ kind: 'records', nodeKey: nodeKey as PublicKeyHex })),
    )
    expect(answer?.kind).toBe('records')

    // 5. The enrolment is real: a certificate that verifies against the door's issuer key.
    expect(joiner.certificate).not.toBeNull()
    const verdict = verifyCertificate(
      joiner.certificate as NonNullable<typeof joiner.certificate>,
      new Set<PublicKeyHex>([issuer as PublicKeyHex]),
      Date.now(),
    )
    expect(verdict.ok, verdict.ok ? '' : verdict.reason).toBe(true)

    // And the refusal is a *named* condition on the joining side, not a silence. This is
    // the operator-facing text 24-04 needs and it already existed: libp2p throws
    // `reservation failed with status PERMISSION_DENIED`, which `classifyReservationFailure`
    // turns into `refused` — distinct from the `at-capacity` a full relay produces.
    await until(
      () => closedWatcher.failures.some((f) => f.kind === 'refused'),
      20_000,
      'the joiner to be told it was refused, by name',
      () => ({ failures: closedWatcher.failures }),
    )
    const named = closedWatcher.failures.find((f) => f.kind === 'refused')
    expect(named).toEqual({ kind: 'refused', status: STATUS_PERMISSION_DENIED })
    // Not a capacity refusal. Under an armed gate the two are the failure modes an operator
    // must be able to tell apart, and a fixture that could not would satisfy this case with
    // the wrong mechanism.
    expect(closedWatcher.failures.some((f) => f.kind === 'at-capacity')).toBe(false)
  }, 180_000)

  /**
   * **THE HINGE.** What can the gate actually learn about a peer at the moment it fires?
   *
   * This is a reading, not an assertion about a design. It records three things and the
   * plan's task 2 is designed against them rather than against a sentence:
   *
   * - what is available with **no I/O at all** — the hook's argument is a `PeerId`, and a
   *   peer id derived from an Ed25519 key *is* the node key, so the one thing the gate gets
   *   for free is the identity a certificate would have to name;
   * - what **identify** has finished by then — read off the relay's own peer store;
   * - whether a **`records` request issued from inside the gater** is answered, and in how
   *   long, against a stated budget.
   *
   * The last is the one that decides the shape of the gate, and it is why this case exists
   * rather than a paragraph.
   */
  it('records what the gate can learn at the instant the hook fires, and what it cannot', async () => {
    const door = await openDoor({ rpcTimeoutMs: GATER_PROBE_BUDGET_MS })
    const doorAddr = wsAddrOf(door)

    const firings: Firing[] = []
    const probes: {
      peerId: string
      attempt: number
      issuedAfterMs: number
      outcome: string
      ms: number
    }[] = []
    /** Wall clock at which the hook fired, so "how much later" is measurable afterwards. */
    const firedAt = new Map<string, number>()
    /**
     * Peers whose in-gater lookup has run to completion.
     *
     * Waited on rather than waiting for "the first attempt to appear", which was measured
     * reading a snapshot **mid-loop** and reporting one attempt where the loop went on to
     * make several. A guard that reads its subject while the subject is still moving is the
     * same defect as reading a duration off the instrument that bounded it.
     */
    const lookupDone = new Set<string>()

    gaterOf(door).denyInboundRelayReservation = async (source: PeerId): Promise<boolean> => {
      const peerId = source.toString()
      if (!firedAt.has(peerId)) firedAt.set(peerId, Date.now())

      // (a)+(b) What is here with no network at all, and what identify has settled.
      const startedAt = Date.now()
      let known: readonly string[] | null = null
      try {
        known = (await door.libp2p.peerStore.get(source)).protocols
      } catch {
        known = null
      }
      firings.push({
        peerId,
        nodeKeyFromPeerId: nodeKeyForPeerId(peerId),
        connections: door.libp2p.getConnections(source).length,
        knownProtocols: known,
        speaksFabricRpc: known?.includes(O2_RPC_PROTOCOL) ?? false,
        peerStoreMs: Date.now() - startedAt,
      })

      // (c) The lookup the retracted premise assumed would work: ask the peer for its
      //     records, from inside the hook, exactly as `PeerVerifier.#decide` does — and
      //     then **ask again**, because the first attempt's failure turned out not to be
      //     slowness. Every attempt is recorded; none is summarised.
      const nodeKey = nodeKeyForPeerId(peerId)
      const deadline = Date.now() + GATER_LOOKUP_DEADLINE_MS
      let attempt = 0
      while (Date.now() < deadline) {
        attempt += 1
        const at = Date.now() - (firedAt.get(peerId) ?? Date.now())
        const started = Date.now()
        let outcome: string
        try {
          const body = await door.rpc.request(
            peerId,
            encodeRequest({ kind: 'records', nodeKey: nodeKey as PublicKeyHex }),
          )
          const response = parseResponse(body)
          if (response?.kind !== 'records') {
            outcome = `answered:${response?.kind ?? 'unparseable'}`
          } else if (response.records === null) {
            // The peer answered and said it holds nothing. This is a *verdict* — the
            // `no-records` refusal — not a failure to reach it, and the two must never read
            // the same, which is the whole reason `PeerFailure` separates them.
            outcome = 'answered:no-records'
          } else {
            // The reading the whole design turns on: does the answer carry a certificate
            // this relay would admit on? Verified here rather than assumed, against the
            // door's own issuer key, offline, exactly as `PeerVerifier.#decide` step 4 does.
            const verdict = verifyCertificate(
              response.records.certificate,
              new Set<PublicKeyHex>([door.issuerKey as PublicKeyHex]),
              Date.now(),
            )
            outcome = verdict.ok ? 'answered:certificate-verified' : `answered:${verdict.failure.kind}`
          }
        } catch (cause) {
          outcome = `threw:${cause instanceof Error ? cause.message : String(cause)}`
        }
        probes.push({ peerId, attempt, issuedAfterMs: at, outcome, ms: Date.now() - started })
        if (outcome.startsWith('answered:')) break
      }
      lookupDone.add(peerId)

      // Refuse regardless. This case measures the *lookup*, and a gater whose verdict
      // depended on a lookup it is measuring would be measuring itself.
      return true
    }

    const watcher = new ReservationWatcher()
    const joiner = await start({
      blockstoreDir: join(workdir, 'hinge'),
      listen: [],
      relayAddrs: [doorAddr],
      reservationWatcher: watcher,
      rpcTimeoutMs: 20_000,
      enrollment: { userPrivateKey: USER_SEED, operatorId: 'harbour-ops', providerAddr: doorAddr },
    })
    /**
     * The independent clock, and it replaces one that could not fail.
     *
     * The obvious way to measure "how much later did the peer become answerable" is to poll
     * it with the same `records` request. **That reading is an artifact and was caught being
     * one**: the poll can only begin once the gater has returned, i.e. once the in-hook probe
     * has spent its whole budget, so the answer is floored by the budget. Measured on
     * 2026-08-06 by varying only that constant — budget 4 000 ms gave "answerable after
     * 4 028 ms", budget 1 200 ms gave "answerable after 1 230 ms". A number that tracks the
     * instrument is a number about the instrument.
     *
     * `FabricNode.start` resolving is the honest clock: `serveAgent(…)` is the last thing
     * `#compose` does, so the promise settling *is* the peer becoming able to answer, and it
     * is observed from outside the gater with nothing of this file's on the path.
     */
    const startResolvedAt = Date.now()

    await until(
      () => firings.some((f) => f.peerId === joiner.peerId) && lookupDone.has(joiner.peerId),
      120_000,
      'the hook to fire for the joiner and its whole lookup to run out',
      () => ({ firings: firings.length, attempts: probes.length, done: [...lookupDone] }),
    )

    const firing = firings.find((f) => f.peerId === joiner.peerId)
    const mine = probes.filter((p) => p.peerId === joiner.peerId)
    expect(firing).toBeDefined()
    expect(mine.length).toBeGreaterThan(0)
    const probe = mine[0]
    if (firing === undefined || probe === undefined) return
    const answered = mine.find((p) => p.outcome.startsWith('answered:'))

    // How much later the peer could answer anybody, on the independent clock above.
    const fired = firedAt.get(joiner.peerId) ?? startResolvedAt
    const serveAgentReadyAfterMs = startResolvedAt - fired

    // eslint-disable-next-line no-console -- this case's product IS the reading; a number
    // recorded only in an assertion is a number the next reader has to re-derive.
    console.log(
      '[hinge] firing', JSON.stringify(firing),
      'attempts', JSON.stringify(mine),
      'serveAgentReadyAfterMs', serveAgentReadyAfterMs,
      'gaterProbeBudgetMs', GATER_PROBE_BUDGET_MS,
      'gaterLookupDeadlineMs', GATER_LOOKUP_DEADLINE_MS,
      'libp2pCeilingMs', LIBP2P_RESERVATION_COMPLETION_TIMEOUT_MS,
    )

    // --- What the gate HAS. -----------------------------------------------------------
    // The peer id names the key any certificate would have to be *for*. Free, synchronous,
    // and already proved by the Noise handshake — this is `PeerVerifier.#decide` step 1,
    // and it is the only one of that method's four steps the gate gets without asking
    // anybody.
    expect(firing.nodeKeyFromPeerId).not.toBeNull()
    expect(firing.nodeKeyFromPeerId).toBe(nodeKeyForPeerId(joiner.peerId))
    // A live connection, so the relay really is talking to the peer. The retracted premise
    // was right about this much, and wrong about what it yields.
    expect(firing.connections).toBeGreaterThan(0)

    // --- What the gate is TOLD, which is worse than being told nothing. ----------------
    //
    // **Identify has completed, and it says the peer speaks the fabric's own RPC.** That is
    // the measurement that overturns both the plan's premise *and* the plan's correction of
    // it: the gate is not short of information, it is given information that is true about
    // the protocol table and false about the peer's readiness to answer.
    //
    // The mechanism, cited by symbol so the next reader does not have to re-derive it:
    // `Libp2pTransport.start` calls `libp2p.handle(O2_RPC_PROTOCOL, …)`, which is what makes
    // identify advertise `/o2/rpc/1.0.0` — but the thing that *answers* is a handler
    // registered later through `onMessage`, by `serveAgent`. Between those two lines the
    // joiner accepts the stream and replies to nothing.
    expect(firing.knownProtocols).not.toBeNull()
    expect(firing.speaksFabricRpc).toBe(true)

    // --- And yet the FIRST request cannot be answered. --------------------------------
    //
    // It runs to its full deadline. That is not slowness, and the difference is the whole
    // design consequence: `Libp2pTransport.#dispatch` is
    // `for (const handler of [...this.#handlers]) handler(from, message)`, and `#handlers`
    // is empty until `serveAgent` subscribes through `onMessage`. A request that lands in
    // that window is **accepted at the protocol level and dropped** — no reply is ever
    // written for it, not even late. So the caller can only ever learn about it by giving
    // up. This is the mechanism behind the 30 s silence `peer-verifier.ts`'s header records,
    // now measured at the door rather than inferred.
    expect(probe.attempt).toBe(1)
    expect(probe.outcome.startsWith('threw:')).toBe(true)
    expect(probe.outcome).toContain('timed out')
    // Sited against the budget it was given, because an absolute would encode this host.
    expect(probe.ms).toBeGreaterThanOrEqual(GATER_PROBE_BUDGET_MS * 0.5)

    // --- What the window actually is, and why waiting is the wrong repair. -------------
    //
    // `serveAgent` comes up almost immediately after the hook fires — single-digit
    // milliseconds on this host, against a request that then failed for 700. The gap is
    // therefore **not** the thing to wait out; the lost request is. A gate that re-asks
    // crosses it, a gate that waits on the first answer never does.
    //
    // Recorded as a comparison rather than as a threshold: the interesting fact is
    // `serveAgentReadyAfterMs` being *far smaller* than the failed attempt beside it, both
    // taken in the same run.
    expect(serveAgentReadyAfterMs).toBeLessThan(probe.ms)

    // --- Is a bounded, retrying lookup viable at all? ---------------------------------
    //
    // Yes on this topology, and the number is what task 2 is designed against: a second ask
    // is answered, and the whole lookup settles inside libp2p's own reservation-completion
    // ceiling — which is the only budget that matters, because past it the joiner has
    // already given up and the verdict is moot.
    expect(answered, `no attempt was ever answered: ${JSON.stringify(mine)}`).toBeDefined()
    if (answered === undefined) return
    expect(answered.attempt).toBeGreaterThan(1)
    const settledAfterMs = answered.issuedAfterMs + answered.ms
    expect(settledAfterMs).toBeLessThan(LIBP2P_RESERVATION_COMPLETION_TIMEOUT_MS)

    // --- And the answer is a *usable* one, which is the finding that unblocks task 2. ---
    //
    // The peer does not merely reply — it replies with a certificate that verifies against
    // this relay's own issuer, offline. So the plan's expectation that *"a node reaches the
    // door before it can possibly hold a certificate"* does not hold on this topology
    // either: `resolveCertificate` runs before `serveAgent`, the hook fires within
    // single-digit milliseconds of `serveAgent`, and by then the enrolment round trip is
    // already **done**. What the peer lacked at the first ask was not a certificate; it was
    // a handler.
    expect(answered.outcome).toBe('answered:certificate-verified')

    // The two things a green here must not be read as. The gate refused this peer, and the
    // peer enrolled anyway — the reading above is about what a gate *could* learn, never
    // about this peer having been admitted.
    expect(door.reservedPeerIds).not.toContain(joiner.peerId)
    expect(joiner.certificate).not.toBeNull()
  }, 180_000)

  /**
   * The ceiling the case above compares against, pinned to the installed package.
   *
   * A number this file reasons with must not be a number this file invented. `relaying.node.test.ts`
   * pins libp2p's reservation-failure message template the same way and for the same reason:
   * an upgrade that moves the value should fail here, loudly, rather than quietly turn a
   * comparative reading into an arbitrary one.
   */
  it('pins libp2p’s own reservation-completion ceiling, which is what bounds any in-gater lookup', async () => {
    const { readFileSync } = await import('node:fs')
    const { createRequire } = await import('node:module')
    const { dirname, join: joinPath } = await import('node:path')
    const require = createRequire(import.meta.url)
    const pkg = dirname(require.resolve('@libp2p/circuit-relay-v2'))

    const constants = readFileSync(joinPath(pkg, 'constants.js'), 'utf8')
    expect(constants).toContain(
      `DEFAULT_RESERVATION_COMPLETION_TIMEOUT = ${LIBP2P_RESERVATION_COMPLETION_TIMEOUT_MS.toLocaleString('en-US').replace(',', '_')}`,
    )
    // And that the joining side really does apply it to the whole reserve, not to one leg.
    const store = readFileSync(joinPath(pkg, 'transport', 'reservation-store.js'), 'utf8')
    expect(store).toContain('AbortSignal.timeout(this.reservationCompletionTimeout)')
  })
})

describe('AUTH-04 — the two questions the gate’s revocation story rests on', () => {
  /**
   * **(ii) Does a peer refused at first boot get in after enrolling, without a restart?**
   *
   * 24-04's single-page-load transition depends entirely on the answer, so it is measured
   * here rather than left as a sentence. The arms are: refuse everything, let the peer start
   * and enrol through the closed door, then **open the door** and watch — for a window far
   * longer than the grant took in the open arm above.
   *
   * The second half then measures what *does* work short of a restart, because "no" alone
   * would leave 24-04 with a dead end and no route out of it.
   */
  it('does not retry a refused reservation on its own, and reconnecting is what gets the peer in', async () => {
    const door = await openDoor()
    const doorAddr = wsAddrOf(door)

    let refusing = true
    const consulted: string[] = []
    gaterOf(door).denyInboundRelayReservation = (source: PeerId): boolean => {
      consulted.push(source.toString())
      return refusing
    }

    const watcher = new ReservationWatcher()
    const joiner = await start({
      blockstoreDir: join(workdir, 'later'),
      listen: [],
      relayAddrs: [doorAddr],
      reservationWatcher: watcher,
      rpcTimeoutMs: 20_000,
      enrollment: { userPrivateKey: USER_SEED, operatorId: 'harbour-ops', providerAddr: doorAddr },
    })

    await until(
      () => watcher.failures.some((f) => f.kind === 'refused'),
      30_000,
      'the joiner to be refused at first boot',
      () => ({ failures: watcher.failures, consulted }),
    )
    expect(joiner.certificate).not.toBeNull()
    const asksBeforeOpening = consulted.length

    // The door opens. Nothing else changes — the peer is not restarted, not re-dialled, and
    // holds the same connection it has held since it started.
    refusing = false

    // **Nothing happens.** libp2p arms its refresh timer only on a *successful* reservation
    // (`transport/reservation-store.js` sets the `setTimeout` inside the success path, after
    // `#createReservation` resolves), so a reservation that failed leaves no timer behind and
    // no retry is ever scheduled. The window is deliberately many times the ~1 s the open arm
    // in the case above needed, so this is "did not happen" rather than "had not happened
    // yet".
    await stays(
      () => door.reservedPeerIds.includes(joiner.peerId),
      15_000,
      'the joiner staying out even after the door opened',
      () => ({ reserved: door.reservedPeerIds, consulted: consulted.length }),
    )
    expect(door.reservedPeerIds).not.toContain(joiner.peerId)
    // And the gate was not even asked again, which is the sharper half: this is not a peer
    // being re-judged and refused, it is a peer that never asks a second time.
    expect(consulted.length).toBe(asksBeforeOpening)

    // What *does* work, short of a restart: a new connection. The reservation is attempted
    // once per connection — off the `relay:discover` topology event, which fires from
    // identify on connect — so hanging up and dialling again re-enters the same path with
    // the door now open. That is the route 24-04 has available for a page that has just
    // enrolled, and it is measured rather than proposed.
    await joiner.libp2p.hangUp(peerIdFromString(door.peerId))
    await joiner.dial(doorAddr)

    await until(
      () => door.reservedPeerIds.includes(joiner.peerId),
      30_000,
      'the reconnected peer to obtain a reservation',
      () => ({ reserved: door.reservedPeerIds, consulted: consulted.length }),
    )
    expect(door.reservedPeerIds).toContain(joiner.peerId)
    expect(consulted.length).toBeGreaterThan(asksBeforeOpening)
  }, 180_000)

  /**
   * **(i) Does `@libp2p/circuit-relay-v2` re-consult the gater on a reservation RENEWAL?**
   *
   * This is the difference between a bounded revocation window and an unbounded one, and
   * `24-CONTEXT.md`'s sub-decision 3 rests entirely on it. Both halves are measured:
   *
   * 1. **the gate is asked again** — the hook fires a second time for the same peer, with no
   *    reconnection in between, which is what makes the window bounded at all;
   * 2. **the refusal takes effect** — the relay's own store drops the peer, which is what
   *    makes the bound equal to the TTL rather than to something longer.
   *
   * ### Why this case costs half a minute and cannot be made cheaper
   *
   * The renewal instant is not configurable down. `transport/reservation-store.js` computes
   * `Math.min(Math.max(expiration - REFRESH_TIMEOUT, REFRESH_TIMEOUT_MIN), 2**31 - 1)` with
   * `REFRESH_TIMEOUT` 5 min and `REFRESH_TIMEOUT_MIN` **30 s**. For any TTL under five
   * minutes the first term is negative, so the clamp wins and the refresh lands at 30 s
   * flat however short the TTL is. A cheaper version of this case would be a case that never
   * observes a renewal.
   */
  it('re-consults the gate on renewal, so the revocation window is the reservation TTL', async () => {
    // Chosen so the renewal (fixed at 30 s, above) falls inside the reservation's life and
    // the expiry falls shortly after it — the smallest arrangement in which both halves are
    // observable.
    const ttlMs = 40_000
    const door = await openDoor({ reservationTtlMs: ttlMs })
    const doorAddr = wsAddrOf(door)

    let refusing = false
    const consulted: string[] = []
    gaterOf(door).denyInboundRelayReservation = (source: PeerId): boolean => {
      consulted.push(source.toString())
      return refusing
    }

    const joiner = await start({
      blockstoreDir: join(workdir, 'renewal'),
      listen: [],
      relayAddrs: [doorAddr],
      rpcTimeoutMs: 20_000,
    })
    const grantedAt = Date.now()
    await until(
      () => door.reservedPeerIds.includes(joiner.peerId),
      30_000,
      'the initial grant',
      () => ({ reserved: door.reservedPeerIds, consulted }),
    )
    const asksAtGrant = consulted.filter((p) => p === joiner.peerId).length
    expect(asksAtGrant).toBeGreaterThan(0)

    // Admission is withdrawn. Nothing else is touched: same node, same connection, same
    // reservation, still held.
    refusing = true

    // 1. The gate is asked again, with no reconnection in between. This is the answer to
    //    question (i), and a "no" here would have made the window unbounded.
    await until(
      () => consulted.filter((p) => p === joiner.peerId).length > asksAtGrant,
      60_000,
      'the gate to be consulted a second time, on renewal',
      () => ({
        asks: consulted.filter((p) => p === joiner.peerId).length,
        sinceGrantMs: Date.now() - grantedAt,
      }),
    )
    const renewalAskedAfterMs = Date.now() - grantedAt

    // 2. And the refusal takes: the relay's own store drops the peer. The server arms a
    //    `retimeableSignal(reservationTtl)` whose `abort` deletes the entry, and only a
    //    *granted* RESERVE resets it — so a renewal the gate refuses is a renewal that never
    //    reaches the reset, and the entry runs out on its original clock.
    await until(
      () => !door.reservedPeerIds.includes(joiner.peerId),
      ttlMs + 30_000,
      'the refused peer to fall out of the reservation store',
      () => ({ reserved: door.reservedPeerIds, sinceGrantMs: Date.now() - grantedAt }),
    )
    const droppedAfterMs = Date.now() - grantedAt

    // eslint-disable-next-line no-console -- the window is this case's product.
    console.log(
      '[revocation] ttlMs', ttlMs,
      'renewalAskedAfterMs', renewalAskedAfterMs,
      'droppedAfterMs', droppedAfterMs,
    )

    // The window, stated as a comparison against the TTL that produced it rather than as an
    // absolute: the peer is gone by the time its own TTL runs out, and not before the
    // renewal was refused. Those two together are what "the revocation window is the
    // reservation TTL" means, and neither alone says it.
    expect(renewalAskedAfterMs).toBeLessThan(droppedAfterMs)
    expect(droppedAfterMs).toBeLessThan(ttlMs * 2)
    expect(door.reservedPeerIds).not.toContain(joiner.peerId)
  }, 180_000)
})
