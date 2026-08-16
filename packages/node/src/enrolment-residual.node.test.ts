/**
 * What Phase 24 does **not** fix, measured — and what the identity it devalues is now worth.
 *
 * Criterion 8's own rationale requires this: *"the residual is to be measured and pinned, not
 * argued away"*. **Phase 24 has exactly one criterion**, numbered 8 by inheritance from Phase
 * 19, so a verification scores it out of 1.
 *
 * ## THE CLAIM THIS FILE EXISTS TO STOP ANYBODY MAKING
 *
 * **This phase does not shrink the enrolment DoS surface. It cannot, and it must not.**
 * Enrolment stays open because it is how a node gets its first certificate — 24-CONTEXT's
 * sub-decision 1 turns on exactly that, and `enrol-through-a-closed-door.node.test.ts` measured
 * a peer connecting, starting, serving and enrolling *through a door that refused it*.
 *
 * So a provider still pays two Ed25519 verifications per attempt to refuse a request it was
 * always going to refuse, and an attacker still pays less to mint one than the provider pays to
 * turn it away. Phase 19 measured those ratios; **they do not improve here and must not be
 * presented as if they did.** What improves is what the minted identity *buys*, which is a
 * different measurement and is the second half of this file.
 *
 * ## THIS FILE IS NOT A SECOND `enrollment-dos.node.test.ts`
 *
 * That file owns the exposure and its floors. This one **re-reads the method under this phase's
 * tree** — a comparison, not a duplicate — and then measures the three things that file cannot:
 *
 * 1. the ratio is where Phase 19 left it, so "unchanged" is a reading rather than an assertion;
 * 2. the **relay-side refusal reasons**, which have no wire surface at all —
 *    `admission-agents.node.test.ts` records that a refused agent in another process is told
 *    `PERMISSION_DENIED` and nothing more, so the two refusals it can distinguish only by what
 *    each *presented* are distinguished here by what the relay *said*;
 * 3. **what a certificate the provider paid to mint is worth when the door pins somebody else**
 *    — the provider spends the whole issuance cost and the identity it produces buys no
 *    reservation, no advertisement and no address.
 *
 * ## WHAT THIS FILE CANNOT SHOW
 *
 * - That the enrolment DoS surface is smaller. **It is not.** A summary that reads otherwise is
 *   the defect this file was written to prevent.
 * - Anything across a process boundary or in a browser. `admission-agents.node.test.ts` and
 *   `gated-admission.e2e.test.ts` own those.
 * - That a peer refused here is out of the *fabric*. Admission is per-relay; the per-relay case
 *   in `admission-agents.node.test.ts` measures a refused peer getting in elsewhere.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ed25519 } from '@noble/curves/ed25519.js'
import { EnrollmentAuthority, requestEnrollment } from '@o2/core'
import type { EnrollmentRequest, PublicKeyHex } from '@o2/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FabricNode } from './fabric-node.ts'
import type { FabricNodeOptions } from './fabric-node.ts'
import { ReservationWatcher } from './reservation-watch.ts'

// ---------------------------------------------------------------------------------------
// Part 1 — the cost that did not change. Method reproduced from `enrollment-dos.node.test.ts`.
// ---------------------------------------------------------------------------------------

/** The provider's signing key for the timed arms. Fixed, so a failure is reproducible. */
const PROVIDER_SEED = new Uint8Array(32).fill(0x41)

/** A clock far enough from zero that every window arithmetic stays positive. */
const NOW = 1_800_000_000_000

/**
 * One attacker attempt, minted exactly the way an honest node mints one.
 *
 * Both keys fresh: `maxPerWindow` keys on `userKey`, so a fresh user key steps around it and the
 * aggregate budget is the only thing left to spend. `requestEnrollment` performs the two public
 * key derivations and the two signatures, so this call **is** the attacker's per-identity cost.
 */
async function freshRequest(): Promise<EnrollmentRequest> {
  return await requestEnrollment(ed25519.utils.randomSecretKey(), ed25519.utils.randomSecretKey(), {
    operatorId: 'op-residual',
    discoverability: 'seed',
    relayIds: [],
  })
}

/**
 * Wall time of exactly one call, in ms.
 *
 * Awaits the arm for the reason `enrollment-dos.node.test.ts`'s copy states in full: the
 * attacker arm became a Promise when `requestEnrollment` took a signer port, and timing it
 * unawaited would have measured the creation of one. The added microtask lands on `b`
 * only, and every assertion here is a lower bound on `a ÷ b`, so it can only make the
 * reading harder to pass.
 */
async function span(work: (index: number) => void | Promise<void>, index: number): Promise<number> {
  const started = performance.now()
  await work(index)
  return performance.now() - started
}

/**
 * `a ÷ b`, as the **fastest single call** of each across `samples` alternating pairs.
 *
 * Reproduced from `enrollment-dos.node.test.ts` rather than imported, because importing a helper
 * from another `.test.ts` re-registers that file's whole suite. The estimator is the one that
 * file arrived at the expensive way and its reasoning is not restated here: alternating so
 * neither arm owns a contiguous stretch, and **fastest rather than total** because contention is
 * one-sided — it can only add — so the cheapest of `samples` calls is the closest reading of the
 * work itself. Its own record shows the summing estimator inverting a 3.0 to 0.44 under load.
 */
async function pairedRatio(
  samples: number,
  a: (index: number) => void | Promise<void>,
  b: (index: number) => void | Promise<void>,
): Promise<number> {
  let fastestA = Number.POSITIVE_INFINITY
  let fastestB = Number.POSITIVE_INFINITY
  for (let sample = 0; sample < samples; sample += 1) {
    // `await` suspends this loop; it does not overlap the arms. Alternating and sequential
    // is the estimator, and running them concurrently would time each other's contention.
    fastestA = Math.min(fastestA, await span(a, sample))
    fastestB = Math.min(fastestB, await span(b, sample))
  }
  return fastestA / fastestB
}

/** Calls per timed arm. Thirty-six, for the reason `enrollment-dos.node.test.ts` measured. */
const SAMPLES = 36

function authorityWithBudget(budget: number): EnrollmentAuthority {
  return new EnrollmentAuthority({
    providerPrivateKey: PROVIDER_SEED,
    maxIssuedPerWindow: budget,
    issuance: 'remembers-only-within-this-process',
  })
}

// ---------------------------------------------------------------------------------------
// Part 2 — the live fixture. What the minted identity buys, and why each peer was turned away.
// ---------------------------------------------------------------------------------------

/** How long a verdict is given. Sited above `RELAY_ADMISSION_DEADLINE_MS`, which is 3 500 ms. */
const VERDICT_BUDGET_MS = 30_000

/** How long an absence is held before it is believed. Comparative — see the admitted arm. */
const ABSENCE_WINDOW_MS = 3_000

let workdir: string
const nodes: FabricNode[] = []

beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'o2-enrolment-residual-'))
})

afterEach(async () => {
  await Promise.all(nodes.splice(0).map((node) => node.stop().catch(() => {})))
  await rm(workdir, { recursive: true, force: true })
}, 60_000)

async function start(name: string, options: Partial<FabricNodeOptions> = {}): Promise<FabricNode> {
  const node = await FabricNode.start({
    relayAdmission: 'admits-any-peer',
    startReporting: 'reports-its-own-start',
    blockstoreDir: join(workdir, name),
    listen: ['/ip4/127.0.0.1/tcp/0/ws'],
    trustAnchors: 'runs-unsigned-artifacts',
    rpcTimeoutMs: 20_000,
    ...options,
  })
  nodes.push(node)
  return node
}

const wsAddrOf = (node: FabricNode): string => {
  const address = node.browserDialableAddrs[0]
  if (address === undefined) throw new Error(`no browser-dialable address on ${node.peerId}`)
  return address
}

async function until(
  predicate: () => boolean,
  timeoutMs: number,
  what: string,
  observed?: () => unknown,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((r) => setTimeout(r, 50))
  }
  const tail = observed === undefined ? '' : `; observed ${JSON.stringify(observed())}`
  throw new Error(`timed out waiting for ${what}${tail}`)
}

async function stays(
  predicate: () => boolean,
  windowMs: number,
  what: string,
  observed?: () => unknown,
): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < windowMs) {
    if (predicate()) {
      const tail = observed === undefined ? '' : `; observed ${JSON.stringify(observed())}`
      throw new Error(`${what} stopped holding after ${Date.now() - started}ms${tail}`)
    }
    await new Promise((r) => setTimeout(r, 50))
  }
}

describe('AUTH-04 — the enrolment cost this phase does not remove', () => {
  /**
   * The ratio, re-read under this phase's tree, and **stated as unchanged**.
   *
   * The floors are `enrollment-dos.node.test.ts`'s and are deliberately identical: this file's
   * product is the *comparison*, and a floor of its own would be a second opinion nobody could
   * reconcile with the first. What is new is that the reading is taken on a tree where the
   * reservation gate exists and is armed — so a claim that the gate improved the provider's
   * refusal economics has somewhere to be false.
   *
   * **If a figure here came out materially different, that would be a finding about the method
   * and not an improvement to claim.** Nothing this phase added is on the path either arm runs.
   */
  it('still costs a provider more to refuse an identity than it costs an attacker to mint one', async () => {
    const authority = authorityWithBudget(1)
    expect(authority.enrol(await freshRequest(), NOW).ok).toBe(true)

    const pool = await Promise.all(Array.from({ length: SAMPLES }, freshRequest))
    const sink: EnrollmentRequest[] = []

    // The positive control. Both arms must be shown reaching the path claimed for them, or the
    // ratio is two numbers that happen to divide.
    const overBudget = authority.enrol(pool[0] as EnrollmentRequest, NOW)
    if (overBudget.ok) throw new Error('expected a refusal past the budget')
    expect(overBudget.refusal.kind).toBe('issuance-budget-exhausted')

    const perFreshIdentity = await pairedRatio(
      SAMPLES,
      (i) => void authority.enrol(pool[i] as EnrollmentRequest, NOW),
      async () => void sink.push(await freshRequest()),
    )
    expect(sink).toHaveLength(SAMPLES)

    const replayed = pool[0] as EnrollmentRequest
    const perReplay = await pairedRatio(
      SAMPLES,
      (i) => void authority.enrol(pool[i] as EnrollmentRequest, NOW),
      () => void sink.push({ ...replayed }),
    )

    // eslint-disable-next-line no-console -- the numbers ARE this case's product; a reading kept
    // only inside an assertion is one the next reader has to re-derive.
    console.log('[residual] perFreshIdentity', perFreshIdentity, 'perReplay', perReplay)

    // Phase 19's floors, unchanged and not to be widened. `enrollment-dos.node.test.ts` records
    // nine readings spanning a thirty-fold range of host load inside 2.96–3.16 for the first,
    // and 3758×–7501× for the second.
    //
    // **Observed here on 2026-08-06, 1-minute load 3.44 on an 8-core host: 3.070 and 9351.2.**
    //
    // The first sits inside Phase 19's band, which is the whole point of taking it: the
    // provider's refusal economics are where that phase left them, on a tree where the
    // reservation gate exists and is armed.
    //
    // The second is **above** the band, and that is a statement about the instrument rather
    // than about the code. `enrollment-dos.node.test.ts` records its replay denominator sitting
    // at 0.5–0.75 µs — a couple of `performance.now()` ticks — so the quotient is floored by the
    // clock's resolution and every reading of it *understates* the amplification it claims. A
    // larger number on a quieter host is the same fact measured against a slightly finer floor,
    // and reading it as an increase in exposure would be reading the clock.
    // ## Both directions planted and watched, 2026-08-06
    //
    // **Numerator — can the reading move at all?** Six extra `ed25519.verify` calls added to
    // `enrollment.ts`'s possession check, on top of the two it already makes. Observed
    // **3.070 → 11.946**, a factor of 3.9 against an arithmetic expectation of 4. So this is
    // measuring the provider's refusal path and not something adjacent to it. The first attempt
    // at this plant was **too weak to record**: six extra `possessionChallenge` calls moved the
    // figure 3.070 → 3.051, because a canonical encode is nothing beside two curve operations.
    // A plant that does not move the instrument is not evidence the instrument is stuck.
    //
    // **Denominator — can the floor fail?** Eight extra signatures charged to `freshRequest`,
    // which is what a proof-of-work at the enrolment frame would look like from here. Observed
    // `expected 0.8775283789015611 to be greater than 1.5` — beside `enrollment-dos.node.test.ts`'s
    // own recorded 0.8938 at the same stake, which is what makes the two files comparable rather
    // than merely both green.
    expect(perFreshIdentity).toBeGreaterThan(1.5)
    expect(perReplay).toBeGreaterThan(50)
  })

  /**
   * **What the provider paid for, and what the attacker got for it.**
   *
   * The arms are one fixture, one run, and the pairing is the claim:
   *
   * - `spender` enrols **at the door itself**, so the door performs the whole issuance — two
   *   verifications, a signature, a durable ledger write — and hands back a real certificate.
   *   The door pins a **different** provider, so the identity it just minted buys that peer
   *   **no reservation**. Every millisecond of that cost was spent and bought the attacker
   *   nothing.
   * - `member` presents a certificate from the issuer the door does pin, and gets in. Without
   *   it the refusal above is also what a door that refuses everybody looks like.
   *
   * This is criterion 8's own economic argument, read rather than asserted: *"under gated
   * admission an unissued identity is worth nothing… the cost of the N-th identity is not CPU,
   * it is a provider's signature"*. The half this file adds is that **a signature from the wrong
   * provider is worth nothing either**, and the provider still paid to produce it.
   */
  it('serves an enrolment in full and then refuses the identity it just minted, when the door pins somebody else', async () => {
    // The issuer the door pins — a second provider, which nothing else in this fixture uses.
    const pinned = await start('pinned-provider', {
      issuesCertificates: 'issues-without-an-aggregate-budget',
    })
    const pinnedIssuer = pinned.issuerKey
    expect(pinnedIssuer, 'the pinned provider minted no issuer key').not.toBeNull()

    // The door: it issues certificates of its own **and** pins somebody else's. Both at once,
    // deliberately — that is what makes the cost and the worthlessness the same event.
    const door = await start('door', {
      issuesCertificates: 'issues-without-an-aggregate-budget',
      relayAdmission: new Set<PublicKeyHex>([pinnedIssuer as PublicKeyHex]),
    })
    const doorAddr = wsAddrOf(door)
    expect(door.issuerKey).not.toBe(pinnedIssuer)

    // The arm that gets in, established FIRST so every absence below is read against a door
    // already watched granting.
    const member = await start('member', {
      listen: [],
      relayAddrs: [doorAddr],
      enrollment: {
        userPrivateKey: new Uint8Array(32).fill(0x71),
        operatorId: 'member-ops',
        providerAddr: wsAddrOf(pinned),
      },
    })
    await until(
      () => door.reservedPeerIds.includes(member.peerId),
      VERDICT_BUDGET_MS,
      'the peer holding the pinned issuer’s certificate to be admitted',
      () => ({ reserved: door.reservedPeerIds, decisions: door.admissionDecisions }),
    )
    expect(member.certificate?.issuer).toBe(pinnedIssuer)

    // The arm that pays the provider and gets nothing.
    const watcher = new ReservationWatcher()
    const spender = await start('spender', {
      listen: [],
      relayAddrs: [doorAddr],
      reservationWatcher: watcher,
      enrollment: {
        userPrivateKey: new Uint8Array(32).fill(0x72),
        operatorId: 'spender-ops',
        providerAddr: doorAddr,
      },
    })

    // The provider **did the work**: a real certificate, signed by the door, naming this peer.
    expect(spender.certificate).not.toBeNull()
    expect(spender.certificate?.issuer).toBe(door.issuerKey)
    expect(spender.certificate?.nodeKey).toBe(spender.nodeKey)

    // And it bought nothing. Held over a window, against a door this run has already seen grant.
    await stays(
      () => door.reservedPeerIds.includes(spender.peerId),
      ABSENCE_WINDOW_MS,
      'the identity the door itself minted staying out of the door’s reservation store',
      () => ({ reserved: door.reservedPeerIds, decisions: door.admissionDecisions }),
    )
    expect(door.reservedPeerIds).not.toContain(spender.peerId)
    expect(door.reservedPeerIds).toContain(member.peerId)

    // Named, on the joiner's side, as a refusal rather than as capacity or as silence.
    await until(
      () => watcher.failures.some((failure) => failure.kind === 'refused'),
      VERDICT_BUDGET_MS,
      'the spender to be told it was refused, by name',
      () => ({ failures: watcher.failures }),
    )
  }, 180_000)

  /**
   * **The two refusal reasons, read where they exist.**
   *
   * `FabricNode.admissionDecisions` is an in-process getter with **no wire surface**, so this is
   * the only place in the repository where the door's own words can be read.
   * `admission-agents.node.test.ts` measured the consequence across a process boundary: a peer
   * holding no certificate and a peer holding the wrong issuer's are both told
   * `PERMISSION_DENIED` and nothing else, so an operator debugging a refused agent from that
   * agent's output cannot tell them apart. Here they are distinguished, and the distinction is
   * asserted to be a real one — two different sentences, not one sentence twice.
   *
   * The admitted arm is in the same log for the same reason it is in every case above: a log
   * that only ever held refusals would satisfy both readings without discriminating.
   */
  it('records why each peer was turned away, and the no-certificate reason is not the wrong-issuer one', async () => {
    const pinned = await start('pinned-provider', {
      issuesCertificates: 'issues-without-an-aggregate-budget',
    })
    const pinnedIssuer = pinned.issuerKey
    expect(pinnedIssuer).not.toBeNull()

    const door = await start('door', {
      issuesCertificates: 'issues-without-an-aggregate-budget',
      relayAdmission: new Set<PublicKeyHex>([pinnedIssuer as PublicKeyHex]),
    })
    const doorAddr = wsAddrOf(door)

    const member = await start('member', {
      listen: [],
      relayAddrs: [doorAddr],
      enrollment: {
        userPrivateKey: new Uint8Array(32).fill(0x73),
        operatorId: 'member-ops',
        providerAddr: wsAddrOf(pinned),
      },
    })
    await until(
      () => door.reservedPeerIds.includes(member.peerId),
      VERDICT_BUDGET_MS,
      'the admitted arm, so the decision log is not refusals only',
      () => ({ decisions: door.admissionDecisions }),
    )

    // Holds nothing at all.
    const stranger = await start('stranger', { listen: [], relayAddrs: [doorAddr] })
    // Holds a real certificate from a provider this door does not pin.
    const outsider = await start('outsider', {
      listen: [],
      relayAddrs: [doorAddr],
      enrollment: {
        userPrivateKey: new Uint8Array(32).fill(0x74),
        operatorId: 'outsider-ops',
        providerAddr: doorAddr,
      },
    })
    expect(stranger.certificate).toBeNull()
    expect(outsider.certificate?.issuer).toBe(door.issuerKey)

    const decisionFor = (peerId: string) =>
      [...door.admissionDecisions].reverse().find((decision) => decision.peerId === peerId)

    await until(
      () => decisionFor(stranger.peerId) !== undefined && decisionFor(outsider.peerId) !== undefined,
      VERDICT_BUDGET_MS,
      'the door to have judged both refused arms',
      () => ({ decisions: door.admissionDecisions }),
    )

    const noCertificate = decisionFor(stranger.peerId)
    const wrongIssuer = decisionFor(outsider.peerId)
    const admitted = decisionFor(member.peerId)

    // eslint-disable-next-line no-console -- the operator-facing text IS this case's product.
    console.log('[reasons]', JSON.stringify({ noCertificate, wrongIssuer, admitted }))

    expect(noCertificate?.admitted).toBe(false)
    expect(wrongIssuer?.admitted).toBe(false)
    expect(admitted?.admitted).toBe(true)

    expect(noCertificate?.reason).toContain('holds no provider-issued certificate')
    // **Observed, not predicted.** The first draft of this line expected `untrusted-issuer` —
    // `verifyCertificate`'s own failure kind — and it is not what reaches an operator: the gate
    // renders its own sentence. Recorded because a guess that happens to be close is the way a
    // reading stops describing the tree.
    expect(wrongIssuer?.reason).toContain('which is not a pinned provider')
    // And it **names the issuer**, which is what makes the line actionable rather than a label.
    expect(wrongIssuer?.reason).toContain(door.issuerKey as PublicKeyHex)
    // Two different sentences. Without this the pair could be one template that happened to be
    // read twice, which is exactly the surface `admission-agents.node.test.ts` reports missing
    // on the wire.
    expect(noCertificate?.reason).not.toBe(wrongIssuer?.reason)
    expect(admitted?.reason).toContain('holds a certificate from a pinned issuer')
  }, 180_000)

  /**
   * **The gate is never on the enrolment path, and that is why the residual is unchanged.**
   *
   * `denyInboundRelayReservation` fires on the reservation and on nothing else, so the peers
   * above enrolled through a door that was refusing them. This case reads that as a **count**,
   * which needs no calibration: every peer in the fixture obtained a certificate from the
   * provider it asked, and the door's decision log holds a verdict for each of them — the two
   * numbers are equal, and every refusal is a full issuance the provider paid for.
   *
   * A phase that had closed the DoS surface would show fewer issuances than askers. It shows the
   * same number, which is the reading, not an oversight.
   */
  it('issues one certificate per asker even while refusing every one of them a reservation', async () => {
    const pinned = await start('pinned-provider', {
      issuesCertificates: 'issues-without-an-aggregate-budget',
    })
    const door = await start('door', {
      issuesCertificates: 'issues-without-an-aggregate-budget',
      relayAdmission: new Set<PublicKeyHex>([pinned.issuerKey as PublicKeyHex]),
    })
    const doorAddr = wsAddrOf(door)

    const askers: FabricNode[] = []
    for (const [index, fill] of [0x81, 0x82, 0x83].entries()) {
      askers.push(
        await start(`asker-${String(index)}`, {
          listen: [],
          relayAddrs: [doorAddr],
          enrollment: {
            userPrivateKey: new Uint8Array(32).fill(fill),
            operatorId: `asker-${String(index)}-ops`,
            providerAddr: doorAddr,
          },
        }),
      )
    }

    // Every one of them holds a certificate the door signed. Three askers, three full issuances.
    const issued = askers.filter((asker) => asker.certificate?.issuer === door.issuerKey)
    expect(issued).toHaveLength(askers.length)

    await until(
      () => askers.every((asker) => door.admissionDecisions.some((d) => d.peerId === asker.peerId)),
      VERDICT_BUDGET_MS,
      'the door to have judged every asker',
      () => ({ decisions: door.admissionDecisions.length, askers: askers.length }),
    )

    // And none of them is in. Issuances paid: 3. Reservations bought: 0.
    for (const asker of askers) expect(door.reservedPeerIds).not.toContain(asker.peerId)
    const refusals = door.admissionDecisions.filter((d) => !d.admitted && !d.reason.includes('not yet serving'))
    expect(refusals.length).toBeGreaterThanOrEqual(askers.length)
    expect(issued.length).toBe(askers.length)
  }, 180_000)
})
