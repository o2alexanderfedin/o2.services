import { MemoryBlockstore, MemoryNetwork, delegate } from '@o2/core'
import type { Delegation, ExecutionOutcome, Executor, PublicKeyHex, Task } from '@o2/core'
import { CID } from 'multiformats/cid'
import { describe, expect, it } from 'vitest'
import { RpcEndpoint, authorizeCapability, encodeRequest, parseResponse, serveAgent } from './index.ts'
import type { AuthorizedWork } from './index.ts'

/**
 * AUTH-03 — the first real `Authorizer` in the repository, proven in isolation.
 *
 * No `.node.` suffix: this runs in the node project *and* in real browser engines.
 * Everything on the path is `@noble/curves` pure JS and never touches
 * `crypto.subtle`, so the kernel's "must never require a secure context" constraint
 * is satisfied here by construction rather than by a check — a LAN origin is not a
 * secure context, and this file passing in three engines is what says so.
 */

/** A stable CID; the executor stub never reads a block, so the content is irrelevant. */
const FIXED_CID = CID.parse('bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku')

/**
 * A public key derived through `delegate` rather than through `@noble/curves`.
 *
 * Deliberate: `delegate` computes the issuer's public key as part of signing and is
 * the only public-key derivation `@o2/core` exposes. The alternative is adding
 * `@noble/curves` to `packages/net/package.json` for a fixture, which would mean an
 * `npm install` in a working tree several agents share.
 */
function publicKeyOf(priv: Uint8Array): PublicKeyHex {
  return delegate(priv, {
    ownerId: 'throwaway',
    audience: 'throwaway',
    abilities: ['execute'],
    expiresAt: 1,
  }).issuer
}

/** Seeded, the way `capability.test.ts:12-15` seeds them, so a failure is reproducible. */
function keypair(seed: number): { priv: Uint8Array; pub: PublicKeyHex } {
  const priv = new Uint8Array(32).fill(seed)
  return { priv, pub: publicKeyOf(priv) }
}

const alice = keypair(1) // the data owner this node is pinned to
const bob = keypair(2) // a different owner
const node = keypair(3) // this serving node's own identity

/**
 * The audience is a real 64-hex key, and the test would pass with any string.
 *
 * `verifyChain` compares the final audience as an opaque string and never asks it to
 * sign anything, so nothing here depends on `node.priv` existing. What makes the
 * *production* audience meaningful is that it comes out of the noise-authenticated
 * peer id (`audienceKeyOf`, 15-CONTEXT.md decision 1) — a property proved across
 * processes in Plan 15-04, not here.
 */
const AUDIENCE = node.pub

const NOW = 1_800_000_000_000
const frozen = (): number => NOW

const sovereignTask: Task = {
  moduleCid: FIXED_CID,
  inputCid: FIXED_CID,
  partitionIndex: 0,
  partitionCount: 1,
  label: 'sovereign',
  ownerId: 'alice',
}

const publicTask: Task = {
  moduleCid: FIXED_CID,
  inputCid: FIXED_CID,
  partitionIndex: 0,
  partitionCount: 1,
  label: 'public',
}

/**
 * A dispatched task, in the shape `Authorizer` now takes.
 *
 * 16-05 widened that shape to a union so a combine could reach the same hook without a
 * `Task` being fabricated for it. This helper keeps every case below reading as
 * `(task, chain)`, so the widening changed how the calls are spelled and nothing about
 * what they assert.
 */
function execWork(task: Task, capability: readonly Delegation[]): AuthorizedWork {
  return { kind: 'exec', task, capability }
}

/** owner → this node, directly, valid at `NOW`. */
function directChain(expiresAt = NOW + 60_000): Delegation[] {
  return [
    delegate(alice.priv, {
      ownerId: 'alice',
      audience: AUDIENCE,
      abilities: ['execute'],
      expiresAt,
    }),
  ]
}

describe('authorizeCapability — refusal precedence, as a pure function', () => {
  it('never asks a public task for a chain, even an empty one', () => {
    // Decision 2. A public task has no owner (`ShardSpec`, `submit.ts:30-32`) and so
    // no root key to be rooted at; demanding a chain would mean inventing an owner.
    // This is what keeps `bin/bench.ts`'s scaling curve measuring what it measured
    // before, and it is the branch most likely to be mistaken for an oversight.
    const authorize = authorizeCapability({
      ownerId: 'alice',
      ownerKey: alice.pub,
      audience: AUDIENCE,
      now: frozen,
    })
    expect(authorize(execWork(publicTask, []))).toBeNull()
    expect(authorize(execWork(publicTask, directChain()))).toBeNull()
  })

  it('refuses every sovereign task when no owner key is pinned', () => {
    // Absence refuses; it never passes. A node that quietly accepted would be
    // indistinguishable from one that verified.
    const authorize = authorizeCapability({ ownerId: 'alice', audience: AUDIENCE, now: frozen })
    const refusal = authorize(execWork(sovereignTask, directChain()))
    expect(refusal).not.toBeNull()
    expect(refusal).toContain('alice')
    expect(refusal).toContain('no pinned')
  })

  it('refuses a task naming an owner this node is not pinned to, naming both', () => {
    const authorize = authorizeCapability({
      ownerId: 'bob',
      ownerKey: bob.pub,
      audience: AUDIENCE,
      now: frozen,
    })
    const refusal = authorize(execWork(sovereignTask, directChain()))
    expect(refusal).not.toBeNull()
    expect(refusal).toContain('alice')
    expect(refusal).toContain('bob')
  })

  it("returns describeFailure's own empty-chain text, unreworded", () => {
    const authorize = authorizeCapability({
      ownerId: 'alice',
      ownerKey: alice.pub,
      audience: AUDIENCE,
      now: frozen,
    })
    // `toBe`, not `toContain`: an authorizer that composed its own message fails here.
    //
    // What this case does **not** show: that text carries no link index, and it
    // cannot, because an empty chain has no link to index (`capability.ts:104`).
    // Anything in this repository claiming that a *missing* link is named by index is
    // claiming a string `describeFailure` never produces. The index-naming half of
    // ROADMAP criterion 2 is met by the expired case below, never by this one.
    expect(authorize(execWork(sovereignTask, []))).toBe('no capability chain supplied')
  })

  it('admits a combine from the same instance that refuses a sovereign exec', async () => {
    // 16-05. Both readings come from **one** authorizer instance, which is the point:
    // before 16-05 a combine never reached this function at all, and `serveAgent`
    // refused it precisely *because* the node held one of these. The pairing is what
    // says the two work kinds now share an admission path rather than sit on either
    // side of a gate keyed on the node's configuration.
    const authorize = authorizeCapability({ ownerId: 'alice', audience: AUDIENCE, now: frozen })

    // The refusal is asserted by its text, not by its kind. A refusal that names the
    // wrong thing is a defect in this repository even when the work correctly fails.
    expect(authorize(execWork(sovereignTask, directChain()))).toBe(
      'no pinned owner key for alice on this node',
    )

    // The same instance, asked about a combine over content-addressed partials: admitted
    // under rule 1, the rule that admits a public exec, because a combine names no owner.
    const combine: AuthorizedWork = {
      kind: 'combine',
      combine: { combineId: 'tree-node-a', inputCids: [FIXED_CID, FIXED_CID], level: 1 },
      capability: [],
    }
    expect(authorize(combine)).toBeNull()
  })

  it('has no reachable sovereign-combine refusal on this build, and the wire is why', async () => {
    // **A recorded gap, asserted rather than described.** The owner ruling asks that a
    // sovereign combine with no chain be refused by the same code that refuses a
    // sovereign exec. That code is rules 2-4 above and it is reached by `task.label ===
    // 'sovereign'`. A combine cannot present that label, because the combine frame
    // carries four keys — `kind`, `combineId`, `inputCids`, `level` — and no sovereignty
    // label at all, by the deliberate rule in `protocol.ts` that *"a fifth key is how a
    // payload would arrive, so there is deliberately nowhere to put one"*
    // (`combine-wire.test.ts` holds that shape).
    //
    // So the sovereign arm is **unreachable for a combine on this build** — not
    // permissive, unreachable. This case exists so that fact fails the day the frame
    // grows an owner, rather than being a sentence in a summary nobody re-reads: if
    // `CombineWork` ever gains a field that could carry sovereignty, {@link EveryCombineKey}
    // below stops compiling and the refusal rules above have to be extended to it
    // deliberately.
    //
    // **This guard replaces one that could not fail, on 2026-08-19.** Until then the
    // line read
    //
    // ```ts
    // const combineKeys: (keyof AuthorizedWorkCombine['combine'])[] = ['combineId', 'inputCids', 'level']
    // expect(combineKeys).toEqual(['combineId', 'inputCids', 'level'])
    // ```
    //
    // — a three-element array literal compared to itself. `(keyof X)[]` only requires
    // each element to *be* a key of `X`, and widening `keyof X` by adding a key leaves
    // all three of them valid, so the annotation carried nothing. Measured, not
    // reasoned about: `16-VERIFICATION.md`'s mutation M2 added `readonly ownerId?: string`
    // to `CombineWork` on 2026-08-01 and read `npx tsc --noEmit` at exit 0 with all
    // eleven cases in this file green, and re-measured it byte-for-byte intact on
    // 2026-08-06. The optional form is the realistic one and not a contrived one —
    // `ports.ts` makes `Task.label` and `Task.ownerId` optional by an explicit decision
    // so existing literals keep compiling, and whoever grows the combine frame reaches
    // for the same shape.
    //
    // **Where this one fires, stated exactly, because the sentence it replaces was
    // imprecise in the same way twice.** `CombineWork` is a type and types are erased,
    // so *no* runtime assertion in any spec can fail on a field being added to it. This
    // guard therefore fires at `npx tsc --noEmit` — `TS2741`, at the declaration below —
    // and **not** in a vitest run. `Record<keyof X, true>` was measured to do the same
    // thing; `-?` is written out anyway so the property does not depend on a mapped
    // type's homomorphism rule staying where it is.
    type EveryCombineKey = { readonly [K in keyof AuthorizedWorkCombine['combine']]-?: true }
    const combineKeys: EveryCombineKey = { combineId: true, inputCids: true, level: true }
    // The runtime half, in the shape `combine-wire.test.ts` uses for the frame — it
    // fires on **addition**, which is the direction a payload or an owner arrives from.
    // Its scope is narrower than the type above and saying so is the point: it cannot
    // see `CombineWork` at all, it can only see this witness, so what it holds is that
    // the witness was not quietly widened to satisfy `tsc` without this list moving with
    // it. `tsc` guards the witness against `CombineWork`; this guards the list against
    // the witness. Neither half is sufficient alone.
    expect(Object.keys(combineKeys).sort()).toEqual(['combineId', 'inputCids', 'level'])

    // And the consequence, measured rather than asserted from the type: a node pinned to
    // an owner, which refuses every sovereign exec, still admits every combine.
    const authorize = authorizeCapability({ ownerId: 'alice', audience: AUDIENCE, now: frozen })
    expect(
      authorize({
        kind: 'combine',
        combine: { combineId: 'tree-node-a', inputCids: [FIXED_CID, FIXED_CID], level: 9 },
        capability: [],
      }),
    ).toBeNull()
  })
})

/** The combine arm of `AuthorizedWork`, named so the case above can index its shape. */
type AuthorizedWorkCombine = Extract<AuthorizedWork, { kind: 'combine' }>

/**
 * A counting executor stub — the instrument the ordering claim is read off.
 *
 * `expect(executed).toBe(0)` is only a reading worth having if the same instrument is
 * shown able to count, so both the 0 and the 1 live in this file.
 */
function countingExecutor(): { executor: Executor; count: () => number } {
  let executed = 0
  return {
    executor: {
      nodeId: 'w0',
      async execute(): Promise<ExecutionOutcome> {
        executed += 1
        return { ok: true, output: null, fuelUsed: 1, attestation: 'signed-by-nobody' }
      },
    },
    count: () => executed,
  }
}

/**
 * The two clocks this file arms, and why they are the sizes they are.
 *
 * The RPC budget is the test's own internal clock and the vitest timeout is the
 * framework's, and the framework's must be the larger or a slow reply is reported as
 * a suite timeout with the real reading lost. Measured before choosing: `uptime` on
 * this host read a 1-minute load average of 8.80, so both are set with headroom
 * rather than tight. Neither is a claim about how long anything takes — `MemoryNetwork`
 * is in-process and nothing here should approach either bound.
 */
const RPC_BUDGET_MS = 10_000
const SUITE_TIMEOUT_MS = 30_000

interface Fabric {
  readonly dispatch: (
    task: Task,
    capability: readonly Delegation[],
  ) => Promise<{ ok: boolean; reason: string }>
  readonly count: () => number
  readonly close: () => void
}

/**
 * A two-node fabric shaped the way `distributed.test.ts:509-566` shapes one.
 *
 * Dispatch goes through `rpc.request` with a hand-built `exec` frame rather than
 * through `RemoteExecutor`, deliberately: `RemoteExecutor` does not carry a chain
 * until Plan 15-02, and going around it keeps this plan independent of that one. The
 * `RemoteExecutor` half is proved in 15-02's own file.
 */
function fabric(options: {
  readonly ownerId: string
  readonly ownerKey?: PublicKeyHex
  readonly now: () => number
}): Fabric {
  const network = new MemoryNetwork()
  const store = new MemoryBlockstore()
  const { executor, count } = countingExecutor()

  const workerRpc = new RpcEndpoint(network.connect('w0'), { timeoutMs: RPC_BUDGET_MS })
  serveAgent({
    paused: 'never-pauses',
    rpc: workerRpc,
    executor,
    blockstore: store,
    egress: 'holds-no-registrations',
    authorize: authorizeCapability({
      ownerId: options.ownerId,
      ...(options.ownerKey === undefined ? {} : { ownerKey: options.ownerKey }),
      audience: AUDIENCE,
      now: options.now,
    }),
    index: 'serves-no-records',
    enroll: 'issues-no-certificates',
    capacity: 'accepts-every-offer',
    ledger: 'keeps-no-ledger',
    reservations: 'relays-for-nobody',
    onDispatch: 'reports-no-dispatch',
    attest: 'signs-nothing',
  })

  const callerRpc = new RpcEndpoint(network.connect('caller'), { timeoutMs: RPC_BUDGET_MS })

  return {
    count,
    close: () => {
      callerRpc.close()
      workerRpc.close()
    },
    dispatch: async (task, capability) => {
      const body = await callerRpc.request('w0', encodeRequest({ kind: 'exec', task, capability }))
      const response = parseResponse(body)
      if (response === null || response.kind !== 'exec') return { ok: false, reason: 'malformed' }
      return response.outcome.ok
        ? { ok: true, reason: '' }
        : { ok: false, reason: response.outcome.reason }
    },
  }
}

describe('authorizeCapability — over a real endpoint, refusal precedes execution', () => {
  it(
    'runs the executor exactly once for a valid chain',
    async () => {
      const f = fabric({ ownerId: 'alice', ownerKey: alice.pub, now: frozen })
      try {
        const outcome = await f.dispatch(sovereignTask, directChain())
        expect(outcome.ok).toBe(true)
        expect(f.count()).toBe(1)
      } finally {
        f.close()
      }
    },
    SUITE_TIMEOUT_MS,
  )

  it(
    'never calls the executor when no chain arrives',
    async () => {
      const f = fabric({ ownerId: 'alice', ownerKey: alice.pub, now: frozen })
      try {
        const outcome = await f.dispatch(sovereignTask, [])
        expect(outcome.ok).toBe(false)
        expect(outcome.reason).toContain('unauthorized')
        expect(outcome.reason).toContain('no capability chain supplied')
        // The point of the test. A node that ran the module and *then* refused has
        // already read the owner's data.
        expect(f.count()).toBe(0)
      } finally {
        f.close()
      }
    },
    SUITE_TIMEOUT_MS,
  )

  it(
    'carries the expired link index home to the requestor',
    async () => {
      const f = fabric({ ownerId: 'alice', ownerKey: alice.pub, now: frozen })
      try {
        // Differs from the accepted chain in exactly one field.
        const outcome = await f.dispatch(sovereignTask, directChain(NOW - 1_000))
        expect(outcome.ok).toBe(false)
        expect(outcome.reason).toContain('expired at')
        // The index survives the trip through this module untouched.
        expect(outcome.reason).toContain('link 0')
        expect(f.count()).toBe(0)
      } finally {
        f.close()
      }
    },
    SUITE_TIMEOUT_MS,
  )

  it(
    'refuses a chain minted for a different audience',
    async () => {
      const f = fabric({ ownerId: 'alice', ownerKey: alice.pub, now: frozen })
      try {
        const forElsewhere = [
          delegate(alice.priv, {
            ownerId: 'alice',
            audience: bob.pub,
            abilities: ['execute'],
            expiresAt: NOW + 60_000,
          }),
        ]
        const outcome = await f.dispatch(sovereignTask, forElsewhere)
        expect(outcome.ok).toBe(false)
        expect(outcome.reason).toContain('chain ends at')
        expect(f.count()).toBe(0)
      } finally {
        f.close()
      }
    },
    SUITE_TIMEOUT_MS,
  )

  it(
    'consults the clock per call, so one chain is accepted then refused',
    async () => {
      // The thunk is the whole point: `verifyChain` takes `now` as a *value* and says
      // why (`capability.ts:135` — verification is deterministic and has no clock
      // port). Keeping the indirection one layer up preserves that and still lets a
      // caller freeze time. No sleep, no fake timers.
      let clock = NOW
      const f = fabric({ ownerId: 'alice', ownerKey: alice.pub, now: () => clock })
      try {
        const chain = directChain(NOW + 60_000)

        const accepted = await f.dispatch(sovereignTask, chain)
        expect(accepted.ok).toBe(true)
        expect(f.count()).toBe(1)

        clock = NOW + 120_000

        const refused = await f.dispatch(sovereignTask, chain)
        expect(refused.ok).toBe(false)
        expect(refused.reason).toContain('expired at')
        expect(refused.reason).toContain('link 0')
        // Same instance, same chain, and the executor was not reached the second time.
        expect(f.count()).toBe(1)
      } finally {
        f.close()
      }
    },
    SUITE_TIMEOUT_MS,
  )
})
