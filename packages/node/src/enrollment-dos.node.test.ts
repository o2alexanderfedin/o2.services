import { ed25519 } from '@noble/curves/ed25519.js'
import {
  EnrollmentAuthority,
  LocalCapacity,
  MemoryBlockstore,
  MemoryNetwork,
  canonicalCid,
  requestEnrollment,
} from '@o2/core'
import type { EnrollmentRequest, ExecutionOutcome, Executor, PendingEnrollment, Task } from '@o2/core'
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
 * alternating call-by-call and each reading taken as the **fastest** call rather than the
 * mean or the total. `pairedRatio` states why.
 *
 * **A ratio is not automatically load-proof, and this file learned that the expensive
 * way.** The paragraph here used to claim interleaving made "a load spike inflate
 * numerator and denominator together and cancel". It does not cancel: a stall is an
 * absolute number of milliseconds, so it lands on the cheaper arm proportionally harder,
 * and summing the arms hands one stall unbounded leverage over the smaller total. The
 * fresh-identity reading below inverted from 3.0 to 0.44 that way. Interleaving is
 * necessary and it was never sufficient.
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
async function freshRequest(): Promise<PendingEnrollment> {
  return await requestEnrollment(ed25519.utils.randomSecretKey(), ed25519.utils.randomSecretKey(), {
    operatorId: 'op-attacker',
    discoverability: 'seed',
    relayIds: [],
  })
}

/**
 * Wall time of exactly one call, in ms.
 *
 * **Awaits the arm, since 2026-08-16, and the direction of that change is the whole
 * argument for it.** `requestEnrollment` became async when its user half turned into a
 * signer port, so the attacker arm below is now a Promise; timing it without awaiting
 * would have measured the *creation* of one. Awaiting adds one microtask turn to that arm
 * and nothing to the provider arm — the file's own floor discussion puts a
 * `performance.now()` tick at 0.5–0.75 µs against an arm that costs hundreds — and every
 * assertion here is a **lower bound on `fastestA / fastestB`**, so anything added to `b`
 * lowers the quotient. The change can therefore only make these cases harder to pass,
 * never easier, which is the only direction an instrument may quietly move in.
 */
async function span(work: (index: number) => void | Promise<void>, index: number): Promise<number> {
  const started = performance.now()
  await work(index)
  return performance.now() - started
}

/**
 * `a ÷ b`, as the **fastest single call** of each across `samples` alternating pairs.
 *
 * Two properties, and the second is the one that was missing:
 *
 * **Alternating** so neither arm owns a contiguous stretch of the run. The arms swap
 * `samples` times inside about a tenth of a second, so a load spike is seen by both.
 *
 * **Fastest rather than total**, because a spike seen by both is not a spike that
 * cancels. Contention is one-sided — it can only add — so the cheapest of `samples`
 * calls is the closest reading of the work itself, and taking it discards the stalls
 * instead of averaging them in. That one-sidedness is measured, not assumed, and the
 * measurement is written out beside `perFreshIdentity` below along with the twenty
 * trials per estimator that chose this one over the total.
 *
 * A denominator can therefore sit at the clock's own resolution when arm `b` is cheap
 * enough — the replay arm below reads 0.5–0.75 µs, a couple of `performance.now()`
 * ticks. That direction is safe for every reading here: the true cost is *lower* than
 * the floor of a sample, so a quotient built on it **understates** the amplification it
 * claims, and the assertions are all lower bounds.
 */
async function pairedRatio(
  samples: number,
  a: (index: number) => void | Promise<void>,
  b: (index: number) => void | Promise<void>,
): Promise<number> {
  let fastestA = Number.POSITIVE_INFINITY
  let fastestB = Number.POSITIVE_INFINITY
  for (let sample = 0; sample < samples; sample += 1) {
    // Still strictly alternating and still sequential — `await` here suspends this loop,
    // it does not overlap the arms. Two arms running concurrently would time each other's
    // contention and the estimator's whole point is that they do not.
    fastestA = Math.min(fastestA, await span(a, sample))
    fastestB = Math.min(fastestB, await span(b, sample))
  }
  return fastestA / fastestB
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

/**
 * Calls per timed arm — and therefore the number of chances each arm gets at a clean one.
 *
 * Thirty-six is the same total work the file did when it summed six blocks of six, so
 * this is a change of estimator and not a change of cost. See `pairedRatio` for why the
 * count matters more than the block size: what buys stability is *how many* independent
 * chances the minimum has, not how much work each one contains.
 */
const SAMPLES = 36

describe('AUTH-04 — what one unauthenticated enrolment attempt costs each side', () => {
  it('makes a provider pay two signature verifications to refuse a request it was always going to refuse', async () => {
    const authority = authorityWithBudget(1)
    expect(authority.enrol(await freshRequest(), NOW).ok).toBe(true)

    // Minted **outside** the timed region on purpose: what is compared is the provider's
    // cost along two refusal paths, not the requester's cost to reach either.
    const wellFormed = await Promise.all(Array.from({ length: SAMPLES }, freshRequest))
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

    const tax = await pairedRatio(
      SAMPLES,
      (i) => void authority.enrol(wellFormed[i]!, NOW),
      (i) => void authority.enrol(shortProof[i]!, NOW),
    )

    // **Observed 102.8×, 114.0× and 106.9× across three runs on 2026-08-04**, on a host
    // at 1-minute load 191–205 with this process holding under a quarter of a core:
    // 2.49–2.56 ms for the fastest well-formed refusal, against 22.3–23.9 µs for the
    // fastest short-proof one. The readings this file used to carry under the summing
    // estimator were 56×, 116×, 118× and 146×; the spread is an order of magnitude
    // narrower now, for the reason `pairedRatio` gives.
    //
    // The floor stays an order of magnitude below the worst of those, because the claim
    // is an order of magnitude and not a value: the two arms differ by exactly two
    // Ed25519 verifications against a length check.
    //
    // **What it pins.** A provider that has already decided to refuse still verifies two
    // signatures first, because possession and consent are checked before either budget
    // is read. That ordering is correct — `enrollment.ts` records why, and reversing it
    // would let a refusal consume a victim's window — and it is also the whole of the CPU
    // exposure. Hoist either budget check above the verifications and this collapses to
    // about 1. That is mutation-ledger entry `E1`.
    expect(tax).toBeGreaterThan(10)
  })

  it('costs an attacker less to mint an identity than it costs the provider to refuse it', async () => {
    const authority = authorityWithBudget(1)
    expect(authority.enrol(await freshRequest(), NOW).ok).toBe(true)

    const pool = await Promise.all(Array.from({ length: SAMPLES }, freshRequest))
    const sink: EnrollmentRequest[] = []

    // Arm A: the provider refusing one attempt past its exhausted budget — two Ed25519
    // verifications. Arm B: the attacker minting the next attempt — two key derivations
    // and two signatures, under a user key this provider has never seen.
    const perFreshIdentity = await pairedRatio(
      SAMPLES,
      (i) => void authority.enrol(pool[i]!, NOW),
      async () => void sink.push(await freshRequest()),
    )
    expect(sink).toHaveLength(SAMPLES)

    // The same numerator against the cheaper attack. `possessionChallenge` carries no
    // nonce and no validity window, so an attacker who wants provider CPU rather than
    // provider *budget* re-presents one request for ever and pays a memory copy for each.
    // The spread below is a generous overestimate of that: a real one holds the encoded
    // frame and pays nothing.
    //
    // **NARROWED 2026-08-06 — this is now true of THIS ARM ONLY, and the arm is the
    // point.** The clause used to read that `enrollment.ts` "states that replay gap
    // outright", and that is no longer where the gap lives. At the **wire**, an enrolment
    // request now carries a `freshness` answer to a provider-minted nonce, and replaying an
    // observed frame is refused `stale-challenge` — so the attack this ratio prices is not
    // available to a peer holding captured bytes.
    //
    // What this arm measures is `authority.enrol` **in process**, where freshness is
    // deliberately absent: replay is a property of an *exchange*, and an in-process caller
    // holding the authority object has none — it can simply call again. So the numerator is
    // still the right cost model for the residual it names, and the residual is exact: **a
    // host that wires `enrol` to a transport of its own gets no freshness.** `serveAgent` is
    // the only such wiring in this repository.
    const replayed = pool[0]!
    const perReplay = await pairedRatio(
      SAMPLES,
      (i) => void authority.enrol(pool[i]!, NOW),
      () => void sink.push({ ...replayed }),
    )

    // **Observed 2.96×, 3.02×, 3.05×, 3.05×, 3.06× and 3.16× — and 3758× to 7501× for
    // the replay arm — across three full `--project node` runs on 2026-08-04**, at
    // 1-minute load 6–125 on an 8-core host. Six readings from three runs because the
    // suite spawns nested vitest processes of its own, so this file executes more than
    // once per run; the extra executions are the most contended context the project
    // has, and are kept for exactly that reason.
    //
    // Three further runs of this file alone, at load 191–205 with `/usr/bin/time -p`
    // reporting `(user+sys)/real` of 0.23–0.29 — a quarter of one core — read 2.97×,
    // 3.04× and 3.05×. **Nine readings, spanning a thirty-fold range of host load,
    // inside 2.96–3.16.** Taken under contention on purpose: a reading only ever taken
    // on a quiet host is a reading whose load-dependence nobody looked for, which is
    // precisely the defect below.
    //
    // ## The estimator this file used to use, and why it inverted
    //
    // This reading read **0.44 under a full `--project node` run and 1.44 running
    // alone** on 2026-08-04, against a floor of 1.5, while a comment three lines up
    // called it *"an algorithmic property rather than a timing"*. It was a timing, and
    // the mechanism is now measured rather than asserted:
    //
    // 1. **Contention only ever adds.** Four block sizes were timed across host loads
    //    from 8 to 213, and the *minimum* of each arm barely moves. At load 8 the
    //    cheapest six-call block worked out at 2.525 ms per refusal and 0.774 ms per
    //    mint; at loads 138–172 the cheapest **single** call read 2.407–2.507 ms and
    //    0.756–0.776 ms. (The first pair is derived from a block and the second measured
    //    directly, which is why they are quoted as two instruments and not one series.)
    //    Over those same runs the *slowest* single call inflated to 43–51 ms and
    //    18–20 ms — twenty- and twenty-five-fold. So a stall is an additive excursion,
    //    never a discount, and the floor of a sample is the arm's own cost.
    // 2. **An additive stall is not scale-free, so interleaving cannot cancel it.** The
    //    refusal costs 2.5 ms and the mint 0.77 ms. The same 60 ms stall is a 24× hit on
    //    one and a 78× hit on the other, so a spike seen by both arms still moves their
    //    quotient — toward 1, and then past it.
    // 3. **Summing six blocks gave one stall unbounded leverage.** A block was six mints,
    //    about 4.7 ms, and the arm totalled about 28 ms. A single 68 ms stall — one was
    //    caught, at load 60, in a run whose `sumRatio` was 1.337 while its `minRatio` was
    //    3.312 — more than tripled the denominator on its own.
    //
    // Twenty trials of each estimator at load 138–172 settle it:
    //
    // | estimator                        | range        | spread |
    // |----------------------------------|--------------|--------|
    // | total of 6 blocks of 6 (the old) | 1.09 – 5.11  | 4.69×  |
    // | total of 12 blocks of 3          | 1.76 – 6.22  | 3.53×  |
    // | total of 36 single calls         | 1.56 – 4.87  | 3.12×  |
    // | **fastest of 36 single calls**   | **3.15 – 3.27** | **1.04×** |
    // | fastest of 72 single calls       | 3.15 – 3.25  | 1.03×  |
    //
    // The old estimator's own worst trial, 1.09, is below this floor — the defect
    // reproduces on demand under load, and is not a rare coincidence of scheduling.
    // Doubling to 72 samples buys 1 % and costs twice the wall clock, so 36 stands.
    //
    // **Neither floor moved, and neither may.** The repair was the estimator, which is
    // what this project's measurement rule asks for — a comparative reading taken inside
    // one run — and moving a floor would have destroyed the only thing this file is for.
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
    //
    // ## Both directions planted and watched go red, 2026-08-04
    //
    // **Numerator.** `enrollment.ts`' aggregate-budget check hoisted above the two
    // verifications — mutation-ledger `E1`, named in the sibling case above. Observed:
    // `AssertionError: expected 0.003615248196637649 to be greater than 1.5`. The sibling
    // case went red beside it on its ordering control, which is `E1`'s own recorded
    // signature and is deliberately not quoted here — `E1` declares that signature
    // `rendered-at-runtime`, and `mutation-guard.node.test.ts` fails any entry whose
    // signature it can find verbatim in a `caughtBy` file. Writing the observed text into
    // this comment broke that guard once already; the string belongs in the ledger.
    //
    // **Denominator.** A stake of *n* extra Ed25519 signatures charged to `freshRequest`,
    // which is what a proof-of-work at the frame would look like from here. It takes a
    // real stake to trip: `n = 3` still passed at 1.85, `n = 5` gave
    // `expected 1.20071527625726 to be greater than 1.5` and `n = 8` gave `0.8938`. So
    // this floor fires once minting costs an attacker about **twice** what it costs
    // today, and not before — the guard is stated, and it is not hair-trigger.
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
    paused: 'never-pauses',
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
        Array.from({ length: 8 }, async () => enrolOverRpc(rig.caller, rig.provider, await freshRequest())),
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
      paused: 'never-pauses',
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
        expect((await enrolOverRpc(attacker, 'provider', await freshRequest())).ok).toBe(true)
      }

      // An honest node now, under a user key this provider has never seen, refused by the
      // **aggregate** reason and explicitly not by the per-user one. The two are
      // different events with different next actions, and the text is asserted rather
      // than the kind alone because a refusal naming the wrong thing is a defect here
      // even when the request correctly fails.
      const honest = await enrolOverRpc(attacker, 'provider', await freshRequest())
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
