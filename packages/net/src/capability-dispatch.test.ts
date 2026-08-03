import { MemoryBlockstore, MemoryNetwork, delegate } from '@o2/core'
import type { Delegation, Executor, PublicKeyHex, Task } from '@o2/core'
// Test-only relative import, for the reason `distributed.test.ts` records at its
// own: `@o2/core`'s export map exposes only its public entry, and adding a fixtures
// export would modify the kernel package.
import { MODULE_WRITES_PARTITION } from '../../core/src/executor/fixtures.ts'
import { describe, expect, it } from 'vitest'
import { RemoteExecutor, RpcEndpoint, serveAgent } from './index.ts'
import type { AuthorizedWork } from './index.ts'

/**
 * AUTH-03, criterion 1's *dispatching* half — a chain minted at the requestor
 * reaches the serving node's hook unchanged, and a refusal there still precedes
 * execution across a real transport.
 *
 * What this file does **not** prove, stated so it is not over-read:
 *
 * - Nothing here verifies a chain. The `authorize` hooks below are deliberately
 *   hand-written capture and refuse closures, not `authorizeCapability`, so a
 *   failure here localises to the dispatch path rather than to verification.
 *   Verification is `capability-authorizer.test.ts` (Plan 15-01).
 * - Nothing here runs through `bin/agent.ts`. Two real OS processes are Plan 15-04.
 * - Nothing here derives an audience from a peer id. The audiences below are
 *   literals, and `verifyChain` is never called, so no audience check is happening.
 *
 * Its relationship to `distributed.test.ts`'s round-trip assertion is complementary,
 * not duplicative: that one pins encode/parse in isolation by calling
 * `encodeRequest` and `parseRequest` directly. This one pins **attachment,
 * canonical encoding and parse together**, end to end, by reading what an
 * `authorize` hook was handed after a real `RemoteExecutor` dispatched over a real
 * `RpcEndpoint`. Neither subsumes the other — the round trip stays green if
 * `RemoteExecutor` attaches nothing at all.
 *
 * No `.node.` suffix, so this runs in the node project and in three browser engines.
 */

/**
 * Two clocks, and the framework's is the larger.
 *
 * `uptime` reported a 1-minute load average of **31.29** on this host before either
 * bound was chosen. Neither is a claim about how long a dispatch takes —
 * `MemoryNetwork` is in-process and nothing here approaches either — they exist so a
 * contended host produces a slow pass rather than a spurious failure.
 */
const RPC_TIMEOUT_MS = 10_000
const TEST_TIMEOUT_MS = 30_000

/**
 * A public key derived through `delegate` rather than through `@noble/curves`.
 *
 * `delegate` computes the issuer's public key as part of signing and is the only
 * public-key derivation `@o2/core` exposes. The alternative is adding
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

/** Seeded, so a failure is reproducible and a reader can tell the principals apart. */
function keypair(seed: number): { priv: Uint8Array; pub: PublicKeyHex } {
  const priv = new Uint8Array(32).fill(seed)
  return { priv, pub: publicKeyOf(priv) }
}

const alice = keypair(1) // one data owner
const bob = keypair(2) // a second data owner, so "per task" has two answers
const coord = keypair(4) // a coordinator alice delegates through
const worker = keypair(3) // the serving node

/** Absolute and comfortably in the future; nothing in this file expires anything. */
const EXPIRES_AT = 2_000_000_000_000

/** owner → node, directly. */
function directChain(ownerId: string, priv: Uint8Array): Delegation[] {
  return [
    delegate(priv, {
      ownerId,
      audience: worker.pub,
      abilities: ['execute'],
      expiresAt: EXPIRES_AT,
    }),
  ]
}

/** owner → coordinator → node. Two links, and the order is part of the claim. */
function delegatedChain(): Delegation[] {
  const first = delegate(alice.priv, {
    ownerId: 'alice',
    audience: coord.pub,
    abilities: ['execute', 'delegate'],
    expiresAt: EXPIRES_AT,
  })
  const second = delegate(coord.priv, {
    ownerId: 'alice',
    audience: worker.pub,
    abilities: ['execute'],
    expiresAt: EXPIRES_AT,
  })
  return [first, second]
}

/**
 * What an `Authorizer` is handed. Captured whole rather than field by field.
 *
 * `AuthorizedWork` since 16-05, which widened the hook to a union so a combine reaches
 * it too. Deliberately the exported type rather than a local restatement of the exec
 * arm: a local copy would keep compiling if the production shape changed underneath it,
 * which is the opposite of what capturing the request whole is for.
 */
type AuthorizeRequest = AuthorizedWork

interface Fabric {
  readonly requestorRpc: RpcEndpoint
  readonly nodeId: string
  readonly moduleCid: Awaited<ReturnType<MemoryBlockstore['put']>>
  readonly inputCid: Awaited<ReturnType<MemoryBlockstore['put']>>
  /** Every request the serving node's `authorize` hook saw, in dispatch order. */
  readonly captured: AuthorizeRequest[]
  /** How many times the executor was actually entered. */
  executed(): number
  close(): void
}

/**
 * One serving node and one requestor on the in-process transport.
 *
 * Shaped after `distributed.test.ts:509-566`: every `serveAgent` hook at its
 * sentinel except the two under test, and a counting `Executor` stub rather than a
 * `WasmExecutor` so "did it run" is a number this file owns.
 *
 * @param refusal what `authorize` returns — `null` accepts, a string refuses.
 */
async function fabric(refusal: string | null = null): Promise<Fabric> {
  const network = new MemoryNetwork()
  const store = new MemoryBlockstore()
  const moduleCid = await store.put(MODULE_WRITES_PARTITION)
  const inputCid = await store.put(new Uint8Array([0x80]))

  const captured: AuthorizeRequest[] = []
  let executed = 0
  const watched: Executor = {
    nodeId: 'w0',
    async execute() {
      executed += 1
      return { ok: true, output: null, fuelUsed: 1, attestation: 'signed-by-nobody' }
    },
  }

  const workerRpc = new RpcEndpoint(network.connect('w0'), { timeoutMs: RPC_TIMEOUT_MS })
  serveAgent({
    rpc: workerRpc,
    executor: watched,
    blockstore: store,
    egress: 'holds-no-registrations',
    authorize: (request) => {
      captured.push(request)
      return refusal
    },
    index: 'serves-no-records',
    enroll: 'issues-no-certificates',
    capacity: 'accepts-every-offer',
    ledger: 'keeps-no-ledger',
    reservations: 'relays-for-nobody',
    onDispatch: 'reports-no-dispatch',
  })

  const requestorRpc = new RpcEndpoint(network.connect('requestor'), { timeoutMs: RPC_TIMEOUT_MS })
  return {
    requestorRpc,
    nodeId: 'w0',
    moduleCid,
    inputCid,
    captured,
    executed: () => executed,
    close() {
      requestorRpc.close()
      workerRpc.close()
    },
  }
}

function sovereignTask(f: Fabric, ownerId: string, partitionIndex = 0): Task {
  return {
    moduleCid: f.moduleCid,
    inputCid: f.inputCid,
    partitionIndex,
    partitionCount: 4,
    label: 'sovereign',
    ownerId,
  }
}

describe('AUTH-03 — a minted chain reaches the serving node intact', () => {
  it(
    'delivers a direct chain deep-equal to what was minted',
    async () => {
      const f = await fabric()
      try {
        const chain = directChain('alice', alice.priv)
        await new RemoteExecutor(f.nodeId, f.requestorRpc, () => chain).execute(
          sovereignTask(f, 'alice'),
        )

        expect(f.captured).toHaveLength(1)
        // Deep equality against the minted value, not a length check. A signature is
        // over exact bytes, so a field reordered or a number widened in transit
        // would invalidate the chain at a verifier while still passing a length
        // check. `distributed.test.ts:606-635` pins that failure mode at the
        // encode/parse level; this pins it end to end, over a dispatch.
        expect(f.captured[0]?.capability).toEqual(chain)
      } finally {
        f.close()
      }
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'delivers a two-link chain with both links, in the minted order',
    async () => {
      const f = await fabric()
      try {
        const chain = delegatedChain()
        await new RemoteExecutor(f.nodeId, f.requestorRpc, () => chain).execute(
          sovereignTask(f, 'alice'),
        )

        expect(f.captured).toHaveLength(1)
        expect(f.captured[0]?.capability).toHaveLength(2)
        // A chain truncated to a prefix that happens to verify is the failure this
        // rules out, and order is what makes the prefix meaningful: alice issues to
        // the coordinator, the coordinator issues to the node.
        expect(f.captured[0]?.capability.map((link) => link.issuer)).toEqual([alice.pub, coord.pub])
        expect(f.captured[0]?.capability).toEqual(chain)
      } finally {
        f.close()
      }
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'selects the chain per task, through one RemoteExecutor',
    async () => {
      // The property that makes a supplier the right shape rather than a fixed
      // array: one adapter serves every shard of a job, and shards may name
      // different owners.
      const f = await fabric()
      try {
        const aliceChain = directChain('alice', alice.priv)
        const bobChain = directChain('bob', bob.priv)
        const remote = new RemoteExecutor(f.nodeId, f.requestorRpc, (task) =>
          task.ownerId === 'alice' ? aliceChain : bobChain,
        )
        await remote.execute(sovereignTask(f, 'alice', 0))
        await remote.execute(sovereignTask(f, 'bob', 1))

        expect(f.captured).toHaveLength(2)
        expect(f.captured[0]?.capability).not.toEqual(f.captured[1]?.capability)
        expect(f.captured[0]?.capability).toEqual(aliceChain)
        expect(f.captured[1]?.capability).toEqual(bobChain)
      } finally {
        f.close()
      }
    },
    TEST_TIMEOUT_MS,
  )
})

describe('AUTH-03 — the refusal still precedes execution across a transport', () => {
  it(
    'never enters the executor when the serving node refuses',
    async () => {
      const f = await fabric('no capability chain supplied')
      try {
        const outcome = await new RemoteExecutor(f.nodeId, f.requestorRpc, () => []).execute(
          sovereignTask(f, 'alice'),
        )

        expect(outcome.ok).toBe(false)
        if (outcome.ok) return
        expect(outcome.reason).toContain('unauthorized:')
        expect(outcome.reason).toContain('no capability chain supplied')
        // The point of the test, and strictly stronger evidence than an
        // instantiate-level instrument would be: `WasmExecutor.execute` is the only
        // caller of `WebAssembly.instantiate` on this path, so a counter inside the
        // executor is upstream of every instantiate there is. No instrument in this
        // repository observes `instantiate` directly and none is invented here.
        expect(f.executed()).toBe(0)
      } finally {
        f.close()
      }
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'enters the executor exactly once when the serving node accepts',
    async () => {
      // The zero above is only worth reading beside a non-zero off the same counter
      // in the same file — otherwise it is equally consistent with a counter that
      // never counts.
      const f = await fabric(null)
      try {
        const outcome = await new RemoteExecutor(
          f.nodeId,
          f.requestorRpc,
          () => directChain('alice', alice.priv),
        ).execute(sovereignTask(f, 'alice'))

        expect(outcome.ok).toBe(true)
        expect(f.executed()).toBe(1)
      } finally {
        f.close()
      }
    },
    TEST_TIMEOUT_MS,
  )
})
