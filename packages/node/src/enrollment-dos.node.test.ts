import { ed25519 } from '@noble/curves/ed25519.js'
import {
  EnrollmentAuthority,
  LocalCapacity,
  MemoryBlockstore,
  MemoryNetwork,
  canonicalCid,
  requestEnrollment,
} from '@o2/core'
import type { EnrollmentRequest, ExecutionOutcome, Executor, Task } from '@o2/core'
import { RemoteExecutor, RpcEndpoint, enrolOverRpc, serveAgent } from '@o2/net'
import type { AuthorizedWork } from '@o2/net'
import { describe, expect, it } from 'vitest'

/**
 * AUTH-04's **cost half** — the exposure the aggregate issuance budget opened, priced.
 *
 * `19-VERIFICATION.md` scored criterion 5 PARTIAL and named this gap in as many words:
 * *"`serveAgent` serves `enrol` with no authorization step, so anyone able to dial a
 * provider can spend its whole window at one `ed25519.keygen()` per attempt… `M54` pins
 * the bound; nothing pins what it cost."* This file is what pins the cost, and
 * `enrollment.ts`' own header calls the exposure *"accepted deliberately rather than
 * mitigated"* (owner decision 2026-08-02). Accepted is not the same as measured, and
 * until this file existed it was the former only.
 *
 * ## What this file deliberately is NOT
 *
 * It builds no mitigation and it amends no criterion. Both are an open owner ruling and
 * this pass was scoped out of taking either route. Every reading below therefore asserts
 * the repository **as it is**, in the direction that turns red the day a price or an
 * authorization step lands — the same shape mutation-ledger entry `M36` already uses to
 * pin an absence. When that day comes, delete the reading; do not widen it.
 *
 * ## Why every reading is a ratio taken inside one run
 *
 * CONVENTIONS' measurement rule, and it binds hardest here. An absolute
 * "N enrolments per second on this laptop" ages into a statement about a machine nobody
 * still has, and this host has been measured holding 95 % of a core at load 33 — so a
 * wall-clock threshold would fire on somebody else's build rather than on a code change.
 * Every figure below is two spans measured microseconds apart and divided, with the arms
 * **interleaved in blocks** so a load spike inflates numerator and denominator together
 * and cancels.
 *
 * The one exception is the wire reading, which is a **count** rather than a time: with
 * the node's single admission slot already occupied, seven of eight `exec` dispatches are
 * refused by name and eight of eight `enrol` frames are served. Counts need no
 * calibration.
 *
 * Node-only. Nothing here needs a `node:` import — the reason is that the three-engine
 * browser matrix would run the timing arms on WebKit and Firefox under Playwright, which
 * is three chances to flake for one reading that says the same thing in each.
 */

/** The provider's signing key. Fixed, so a failure is reproducible. */
const PROVIDER_SEED = new Uint8Array(32).fill(0x40)

/** A clock far enough from zero that every window arithmetic below stays positive. */
const NOW = 1_800_000_000_000

/**
 * One attacker attempt, minted exactly the way an honest node mints one.
 *
 * **Both keys are fresh, and that is the whole point.** `maxPerWindow` keys on `userKey`,
 * so a fresh user key steps around it — Phase 17 measured twenty such enrolments passing
 * unslowed — and the aggregate budget is then the only thing left to spend.
 * `requestEnrollment` performs the two public-key derivations and the two signatures, so
 * this call **is** the attacker's per-identity cost and nothing else is charged to them.
 */
function freshRequest(): EnrollmentRequest {
  return requestEnrollment(ed25519.utils.randomSecretKey(), ed25519.utils.randomSecretKey(), {
    operatorId: 'op-attacker',
    discoverability: 'seed',
    relayIds: [],
  })
}

/** Wall time of `iterations` calls, in ms. */
function span(iterations: number, work: (index: number) => void): number {
  const started = performance.now()
  for (let index = 0; index < iterations; index += 1) work(index)
  return performance.now() - started
}

/**
 * `a ÷ b`, with the two arms interleaved in `rounds` blocks of `iterations` each.
 *
 * Interleaving is what makes the quotient survive a busy host: both arms sample the same
 * instants of machine load. A ratio of two separately-measured totals would not — the
 * first arm could run during somebody else's build and the second after it finished, and
 * the quotient would report that as a property of the code.
 */
function pairedRatio(
  rounds: number,
  iterations: number,
  a: (index: number) => void,
  b: (index: number) => void,
): number {
  let totalA = 0
  let totalB = 0
  for (let round = 0; round < rounds; round += 1) {
    totalA += span(iterations, (i) => a(round * iterations + i))
    totalB += span(iterations, (i) => b(round * iterations + i))
  }
  return totalA / totalB
}

/** A provider with a stated aggregate budget and its own in-process history. */
function authorityWithBudget(
  budget: number | 'issues-without-an-aggregate-budget',
): EnrollmentAuthority {
  return new EnrollmentAuthority({
    providerPrivateKey: PROVIDER_SEED,
    maxIssuedPerWindow: budget,
    issuance: 'remembers-only-within-this-process',
  })
}

/** Rounds × iterations per timed arm. Six blocks, so one slow block cannot decide a ratio. */
const ROUNDS = 6
const SAMPLES = 36

describe('AUTH-04 — what one unauthenticated enrolment attempt costs each side', () => {
  it('makes a provider pay two signature verifications to refuse a request it was always going to refuse', () => {
    const authority = authorityWithBudget(1)
    expect(authority.enrol(freshRequest(), NOW).ok).toBe(true)

    // Minted **outside** the timed region on purpose: what is compared is the provider's
    // cost along two refusal paths, not the requester's cost to reach either.
    const wellFormed = Array.from({ length: SAMPLES }, freshRequest)
    // The same requests carrying a proof that is valid hex and the wrong length. Ed25519
    // rejects it on a length check before any curve arithmetic, so this arm is the
    // provider's floor: what a refusal costs when there is nothing to verify.
    const shortProof = wellFormed.map((request) => ({ ...request, proofOfPossession: 'ff' }))

    // **The positive control, and the ratio means nothing without it.** Each arm has to
    // be shown reaching the path this test claims for it. A well-formed request past an
    // exhausted budget must be refused by the *aggregate* reason and not the per-user
    // one, or the two arms would differ in something other than the crypto.
    const overBudget = authority.enrol(wellFormed[0]!, NOW)
    if (overBudget.ok) throw new Error('expected a refusal past the budget')
    expect(overBudget.refusal.kind).toBe('issuance-budget-exhausted')
    const shortRefusal = authority.enrol(shortProof[0]!, NOW)
    if (shortRefusal.ok) throw new Error('expected a refusal on the short proof')
    expect(shortRefusal.refusal.kind).toBe('bad-proof-of-possession')

    const tax = pairedRatio(
      ROUNDS,
      SAMPLES / ROUNDS,
      (i) => void authority.enrol(wellFormed[i]!, NOW),
      (i) => void authority.enrol(shortProof[i]!, NOW),
    )

    // **Observed 56×, 116×, 118× and 146× across four runs on 2026-08-04**, on a host
    // running three other agents' suites — the spread is the denominator, which is a
    // handful of microseconds and therefore the arm scheduling noise lands on. The floor
    // is set five times below the *worst* of those readings rather than near the best,
    // because the claim is an order of magnitude and not a value: the two arms differ by
    // exactly two Ed25519 verifications against a length check.
    //
    // **What it pins.** A provider that has already decided to refuse still verifies two
    // signatures first, because possession and consent are checked before either budget
    // is read. That ordering is correct — `enrollment.ts` records why, and reversing it
    // would let a refusal consume a victim's window — and it is also the whole of the CPU
    // exposure. Hoist either budget check above the verifications and this collapses to
    // about 1. That is mutation-ledger entry `E1`.
    expect(tax).toBeGreaterThan(10)
  })

  it('costs an attacker less to mint an identity than it costs the provider to refuse it', () => {
    const authority = authorityWithBudget(1)
    expect(authority.enrol(freshRequest(), NOW).ok).toBe(true)

    const pool = Array.from({ length: SAMPLES }, freshRequest)
    const sink: EnrollmentRequest[] = []

    // Arm A: the provider refusing one attempt past its exhausted budget — two Ed25519
    // verifications. Arm B: the attacker minting the next attempt — two key derivations
    // and two signatures, under a user key this provider has never seen.
    const perFreshIdentity = pairedRatio(
      ROUNDS,
      SAMPLES / ROUNDS,
      (i) => void authority.enrol(pool[i]!, NOW),
      () => void sink.push(freshRequest()),
    )
    expect(sink).toHaveLength(SAMPLES)

    // The same numerator against the cheaper attack. `possessionChallenge` carries no
    // nonce and no validity window — `enrollment.ts` states that replay gap outright — so
    // an attacker who wants provider CPU rather than provider *budget* re-presents one
    // request for ever and pays a memory copy for each. The spread below is a generous
    // overestimate of that: a real one holds the encoded frame and pays nothing.
    const replayed = pool[0]!
    const perReplay = pairedRatio(
      ROUNDS,
      SAMPLES / ROUNDS,
      (i) => void authority.enrol(pool[i]!, NOW),
      () => void sink.push({ ...replayed }),
    )

    // **Observed 3.02×, 3.06× and 3.01× across three runs, and 1397× for the replay
    // arm**, on 2026-08-04, each taken with this file running alone.
    //
    // **CORRECTED 2026-08-04, later the same day.** This comment previously called the
    // first number *"an algorithmic property rather than a timing"* on the grounds that
    // it *"did not move in the third significant figure while the host's load moved the
    // absolute spans by a factor of five."* **That is measurably false, and it was the
    // defect** — the same shape as a claim asserting its own safety that this repository
    // has now been wrong about several times. Under a full `--project node` run the
    // quotient reads **0.44**, a seven-fold move, and the case fails. Run alone it passes
    // five times out of five. Both arms are sub-millisecond, so whole-suite scheduling
    // swamps the paired ratio; five runs of a *quiet* host is not evidence of immunity to
    // a *busy* one, and the third significant figure was stability of the sample, not of
    // the quantity.
    //
    // **The mechanism is not established.** There are two measured facts and no measured
    // cause. Do not write one in here until it has been measured — that is exactly how
    // the false claim above got written.
    //
    // The repair is to make the two arms comparable *within one run under contention*,
    // per this project's own rule that a reading be sited against a calibration workload
    // in the same run. **It is NOT to move either floor** — see below for why.
    //
    // Read them together, because they are the two halves of the accepted exposure:
    //
    // - To spend a provider's *window*, an attacker must mint a fresh identity per
    //   attempt, and that costs them about a third of what refusing it costs the
    //   provider. The exchange rate runs **against the defender** — Ed25519 signing uses
    //   a precomputed base point and verification does not — so there is no asymmetry
    //   here to lean on, and none is claimed.
    // - To spend a provider's *CPU* alone, an attacker need not mint anything. One
    //   captured or self-made request replayed costs them a copy and costs the provider
    //   two verifications, which is three orders of magnitude of amplification.
    //
    // **Both floors are the direction a mitigation would break.** A proof-of-work or an
    // escalating stake at the enrolment frame raises the *denominator* of the first, and
    // a nonce or a validity window inside `possessionChallenge` removes the second
    // outright. Either lands as a red test here, which is the point: criterion 5's second
    // clause is an open owner ruling, and this file's job is to make its current answer
    // a reading rather than an argument.
    expect(perFreshIdentity).toBeGreaterThan(1.5)
    expect(perReplay).toBeGreaterThan(50)
  })
})

/** A serving node with a real authority, a one-slot admission bound and a counting authorizer. */
async function rigWithOneSlot(): Promise<{
  readonly caller: RpcEndpoint
  readonly provider: string
  readonly authorizerCalls: () => readonly AuthorizedWork['kind'][]
  readonly release: () => void
  readonly close: () => void
}> {
  const network = new MemoryNetwork()
  const store = new MemoryBlockstore()
  const provider = 'provider'
  const seen: AuthorizedWork['kind'][] = []

  let release = (): void => {}
  const gate = new Promise<void>((resolve) => {
    release = () => resolve()
  })
  // A stub rather than a `WasmExecutor`: what this rig measures is which branch reaches
  // an admission slot, and a real module would only add a compile to every reading. The
  // gate is what lets one dispatch hold the node's only slot open while the enrolments
  // below are served.
  const executor: Executor = {
    nodeId: provider,
    async execute(_task: Task): Promise<ExecutionOutcome> {
      await gate
      return { ok: false, reason: 'stub executor ran' }
    },
  }

  const providerRpc = new RpcEndpoint(network.connect(provider), { timeoutMs: 5_000 })
  serveAgent({
    rpc: providerRpc,
    executor,
    blockstore: store,
    egress: 'holds-no-registrations',
    authorize: (work) => {
      seen.push(work.kind)
      return null
    },
    index: 'serves-no-records',
    enroll: authorityWithBudget('issues-without-an-aggregate-budget'),
    capacity: new LocalCapacity({ nodeId: provider, maxConcurrent: 1 }),
    ledger: 'keeps-no-ledger',
    reservations: 'relays-for-nobody',
    onDispatch: 'reports-no-dispatch',
    attest: 'signs-nothing',
  })

  const caller = new RpcEndpoint(network.connect('caller'), { timeoutMs: 5_000 })
  return {
    caller,
    provider,
    authorizerCalls: () => seen,
    release,
    close: () => {
      caller.close()
      providerRpc.close()
    },
  }
}

/** `count` distinct public tasks, so each takes an admission slot key of its own. */
async function distinctTasks(count: number): Promise<readonly Task[]> {
  const tasks: Task[] = []
  for (let i = 0; i < count; i += 1) {
    const encoded = await canonicalCid({ shard: i })
    if (!encoded.ok) throw new Error('fixture input is not encodable')
    tasks.push({
      moduleCid: encoded.cid,
      inputCid: encoded.cid,
      partitionIndex: i,
      partitionCount: count,
      label: 'public',
    })
  }
  return tasks
}

describe('AUTH-04 — the enrol branch beside the branch that is bounded', () => {
  it('refuses seven of eight dispatches at its one slot and serves eight of eight enrolments in the same instant', async () => {
    const rig = await rigWithOneSlot()
    try {
      const tasks = await distinctTasks(8)
      const remote = new RemoteExecutor(rig.provider, rig.caller, 'dispatches-unauthenticated')

      // The first dispatch takes the node's only slot and parks inside the executor, so
      // everything below is read against a node that is genuinely at its declared bound.
      const held = remote.execute(tasks[0]!)
      const refused = await Promise.all(tasks.slice(1).map((task) => remote.execute(task)))

      for (const outcome of refused) {
        if (outcome.ok) throw new Error('expected a capacity refusal')
        expect(outcome.reason).toContain('over-committed: 1 of 1 slots in use')
      }
      // Consulted once, for the dispatch that was admitted. A refused dispatch never
      // reaches the authorizer at all — admission is ordered first, deliberately.
      expect(rig.authorizerCalls()).toEqual(['exec'])

      // **The same node, the same instant, the slot still held.** Eight enrolments under
      // eight fresh user keys, every one of them served. This is the comparative reading
      // the whole file exists for: an authenticated dispatch is refused seven times out
      // of eight by a bound the node states in the refusal, and an unauthenticated
      // enrolment meets no bound at all on the same frame-handling ladder.
      const enrolled = await Promise.all(
        Array.from({ length: 8 }, () => enrolOverRpc(rig.caller, rig.provider, freshRequest())),
      )
      expect(enrolled.filter((outcome) => outcome.ok)).toHaveLength(8)

      // **This is the assertion that pins the accepted exposure, and it must not be
      // relaxed to close a gap.** `serveAgent`'s enrol branch consults no authorizer, so
      // eight enrolments leave this count exactly where the single admitted dispatch left
      // it. The day an authorization step lands on that branch this goes red — delete
      // this reading and mutation-ledger entry `E2` with it, rather than widening what
      // counts as passing. *Descoped is not satisfied.*
      expect(rig.authorizerCalls()).toEqual(['exec'])

      rig.release()
      expect((await held).ok).toBe(false)
    } finally {
      rig.release()
      rig.close()
    }
  })
})

describe('AUTH-04 — what a burned window costs the node that did not burn it', () => {
  it('lets one dialer spend a three-certificate window and lock out an honest enroller by name', async () => {
    const network = new MemoryNetwork()
    const store = new MemoryBlockstore()
    const providerRpc = new RpcEndpoint(network.connect('provider'), { timeoutMs: 5_000 })
    serveAgent({
      rpc: providerRpc,
      executor: {
        nodeId: 'provider',
        execute: async () => ({ ok: false, reason: 'not dispatched here' }),
      },
      blockstore: store,
      egress: 'holds-no-registrations',
      authorize: 'serves-unauthenticated',
      index: 'serves-no-records',
      enroll: authorityWithBudget(3),
      capacity: new LocalCapacity({ nodeId: 'provider', maxConcurrent: 1 }),
      ledger: 'keeps-no-ledger',
      reservations: 'relays-for-nobody',
      onDispatch: 'reports-no-dispatch',
      attest: 'signs-nothing',
    })
    const attacker = new RpcEndpoint(network.connect('attacker'), { timeoutMs: 5_000 })

    try {
      // Three attempts, three fresh user keys, one dialer. Nothing about this dialer is
      // enrolled, pinned, or known to the provider — the frame is served because the
      // branch has nobody to ask.
      for (let i = 0; i < 3; i += 1) {
        expect((await enrolOverRpc(attacker, 'provider', freshRequest())).ok).toBe(true)
      }

      // An honest node now, under a user key this provider has never seen, refused by the
      // **aggregate** reason and explicitly not by the per-user one. The two are
      // different events with different next actions, and the text is asserted rather
      // than the kind alone because a refusal naming the wrong thing is a defect here
      // even when the request correctly fails.
      const honest = await enrolOverRpc(attacker, 'provider', freshRequest())
      if (honest.ok || honest.kind !== 'refused') throw new Error('expected a refusal')
      expect(honest.refusal.kind).toBe('issuance-budget-exhausted')
      expect(honest.reason).toContain('this provider has issued 3 certificates')
      expect(honest.reason).not.toContain('has enrolled')
    } finally {
      attacker.close()
      providerRpc.close()
    }
  })
})
