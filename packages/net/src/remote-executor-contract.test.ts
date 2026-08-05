import { MemoryNetwork, delegate } from '@o2/core'
import type { CanonicalValue, Delegation, Task } from '@o2/core'
import { CID } from 'multiformats/cid'
import { describe, expect, it } from 'vitest'
import { encodeResponse, parseRequest } from './protocol.ts'
import type { AgentRequest } from './protocol.ts'
import { RemoteExecutor } from './remote-executor.ts'
import type { CapabilitySupplier } from './remote-executor.ts'
import { RpcEndpoint } from './rpc.ts'

/**
 * AUTH-03, the dispatching half — the compile-failure proof, plus the four runtime
 * facts about the same constructor.
 *
 * The first claim under test cannot be exercised at runtime: "constructing a
 * `RemoteExecutor` without saying what capability chain it dispatches with fails
 * `tsc --noEmit`, naming the argument" is a fact about the type checker, not about
 * the program. `@ts-expect-error` is the mechanism that turns that fact into
 * something `npx tsc --noEmit` verifies on every run, exactly as
 * `agent-contract.test.ts` does for `serveAgent`'s seven hooks: the case below
 * deliberately passes two arguments, so without the suppression comment `tsc`
 * reports "Expected 3 arguments, but got 2". If the third parameter is ever widened
 * back to optional, the omission stops being an error and the suppression itself
 * becomes an "Unused '@ts-expect-error' directive" error — so this guard fails
 * loudly in the direction that matters, rather than silently agreeing with whatever
 * the signature happens to allow.
 *
 * The runtime cases beside it read the frame `RemoteExecutor` **actually sent**,
 * captured at a peer `RpcEndpoint`'s handler. They deliberately do not rebuild a
 * frame by calling `encodeRequest` here: that expression is a fact about
 * `protocol.ts:355-356` alone, it was already true before Phase 15, and it stays
 * green with `RemoteExecutor`'s third argument deleted entirely. An assertion that
 * survives the deletion of the code it is about is not a test of that code.
 *
 * The capture sits at the RPC handler rather than at `serveAgent`'s `authorize`
 * because `agent.ts:402-408` coalesces an absent `capability` and an empty one to
 * the same value, so an authorizer physically cannot tell them apart — and the
 * "no key at all" claim is exactly about that distinction. The authorizer-level
 * reading, that a minted chain arrives deep-equal over the real serving path, is
 * `capability-dispatch.test.ts`.
 */

/**
 * Two clocks, and the framework's is the larger.
 *
 * Read off this host before either was chosen: `uptime` reported a 1-minute load
 * average of **31.29**. Neither number is a claim about how long a dispatch takes —
 * `MemoryNetwork` is in-process and nothing here approaches either bound. They exist
 * so a contended host produces a slow pass rather than a spurious failure, and so
 * that if one ever does fire it is the RPC budget, which names the peer, and not
 * vitest's, which names only the test.
 */
const RPC_TIMEOUT_MS = 10_000
const TEST_TIMEOUT_MS = 30_000

/** A stable CID; this file never fetches a block, so the content is irrelevant. */
const FIXED_CID = CID.parse('bafyreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku')

/**
 * `label` is not decoration. `parseRequest` refuses an `exec` frame carrying no
 * label (`protocol.ts:507-508`), so a task without one would make every capture
 * below read `null` and the assertions would pass or fail for the wrong reason.
 */
function taskFor(partitionIndex: number): Task {
  return {
    moduleCid: FIXED_CID,
    inputCid: FIXED_CID,
    partitionIndex,
    partitionCount: 4,
    label: 'public',
  }
}

/**
 * One link, seeded so a failure is reproducible.
 *
 * The audience is a literal rather than a derived key: nothing in this file verifies
 * a chain, so a real audience would suggest a check that is not happening here.
 * Verification is `capability-authorizer.test.ts`'s subject.
 */
function chainFor(ownerId: string): Delegation[] {
  return [
    delegate(new Uint8Array(32).fill(7), {
      ownerId,
      audience: 'worker-key',
      abilities: ['execute'] as const,
      expiresAt: 2_000_000_000_000,
    }),
  ]
}

/**
 * The `exec` frame a capture holds, or `null` if it is not one.
 *
 * `capability` lives only on the `exec` member of `AgentRequest`, so the narrowing
 * is not ceremony — reading the field off the bare union is a compile error, and
 * every assertion below wants to have proved the frame was an `exec` anyway.
 */
function execFrame(body: CanonicalValue): Extract<AgentRequest, { kind: 'exec' }> | null {
  const parsed = parseRequest(body)
  if (parsed === null || parsed.kind !== 'exec') return null
  return parsed
}

interface Parts {
  readonly rpc: RpcEndpoint
  readonly peer: string
  /** Every frame the peer's handler received, in order, exactly as sent. */
  readonly captured: CanonicalValue[]
  close(): void
}

/**
 * A real `RpcEndpoint` pair on a `MemoryNetwork`, with the peer capturing.
 *
 * The `body` an `RpcHandler` receives is exactly the `CanonicalValue`
 * `RemoteExecutor` passed to `rpc.request`: `rpc.ts:183` wraps it as
 * `{k:'req',id,body}`, and `#receive` reads `record['body']` back out at `:256`
 * and hands it to the handler at `:278`. So `captured[i]` **is** the frame the
 * executor produced, not a reconstruction of one.
 */
function buildParts(): Parts {
  const network = new MemoryNetwork()
  const rpc = new RpcEndpoint(network.connect('requestor'), { timeoutMs: RPC_TIMEOUT_MS })
  const peerRpc = new RpcEndpoint(network.connect('peer'), { timeoutMs: RPC_TIMEOUT_MS })
  const captured: CanonicalValue[] = []
  peerRpc.serve(async (_from, body) => {
    captured.push(body)
    // Capture only. This peer never executes anything, so the outcome is a named
    // refusal rather than a fabricated success — nothing in this file reads it.
    return encodeResponse({ kind: 'exec', outcome: { ok: false, reason: 'capture-only' } })
  })
  return {
    rpc,
    peer: 'peer',
    captured,
    close() {
      rpc.close()
      peerRpc.close()
    },
  }
}

describe('RemoteExecutor requires a capability argument — the compile-time proof', () => {
  it('accepts the dispatches-unauthenticated sentinel', () => {
    const parts = buildParts()
    try {
      const executor = new RemoteExecutor(parts.peer, parts.rpc, 'dispatches-unauthenticated')
      expect(executor.nodeId).toBe('peer')
    } finally {
      parts.close()
    }
  })

  it('accepts a per-task supplier', () => {
    const parts = buildParts()
    try {
      const supplier: CapabilitySupplier = () => chainFor('alice')
      const executor = new RemoteExecutor(parts.peer, parts.rpc, supplier)
      expect(executor.nodeId).toBe('peer')
    } finally {
      parts.close()
    }
  })

  it('fails to compile with the capability argument omitted', () => {
    // Nothing is dispatched here, so nothing throws at runtime whatever the
    // signature is — the whole proof lives in whether `tsc` accepts the line
    // without the suppression below.
    const parts = buildParts()
    try {
      // @ts-expect-error AUTH-03 — the capability argument is required; omitting it must fail `tsc --noEmit`, naming it.
      expect(() => new RemoteExecutor(parts.peer, parts.rpc)).not.toThrow()
    } finally {
      parts.close()
    }
  })
})

describe('RemoteExecutor attaches what the call site named', () => {
  it(
    'sends no capability key under the sentinel, and one under a supplier',
    async () => {
      const parts = buildParts()
      try {
        await new RemoteExecutor(parts.peer, parts.rpc, 'dispatches-unauthenticated').execute(
          taskFor(0),
        )
        await new RemoteExecutor(parts.peer, parts.rpc, () => chainFor('alice')).execute(taskFor(1))

        // The positive reading is what proves the instrument was live. An empty
        // capture array satisfies "no capability key" perfectly, and an empty
        // capture array is exactly what an uninstalled handler produces — so the
        // negative reading below only means something beside this one.
        expect(parts.captured).toHaveLength(2)
        expect(execFrame(parts.captured[1]!)?.capability).toHaveLength(1)

        // Byte-identical to a pre-Phase-15 frame: not merely `capability: []`, but
        // no such key at all. This project's canonical encoding treats an explicit
        // `undefined` as a different shape from an absent key, so the second
        // assertion is not redundant with the first.
        expect(execFrame(parts.captured[0]!)?.capability).toBeUndefined()
        expect(Object.keys(parts.captured[0] as object)).not.toContain('capability')
      } finally {
        parts.close()
      }
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'sends no capability key when the supplier returns an empty chain',
    async () => {
      // Not a loophole. `agent.ts:402-408` coalesces an absent `capability` and an
      // empty one to the same value before any `Authorizer` sees them, so the two
      // are indistinguishable to an authorizer by construction — which makes `[]`
      // the honest way for a supplier to say "nothing to state for this task".
      const parts = buildParts()
      try {
        await new RemoteExecutor(parts.peer, parts.rpc, () => []).execute(taskFor(0))
        expect(parts.captured).toHaveLength(1)
        expect(execFrame(parts.captured[0]!)).not.toBeNull()
        expect(execFrame(parts.captured[0]!)?.capability).toBeUndefined()
        expect(Object.keys(parts.captured[0] as object)).not.toContain('capability')
      } finally {
        parts.close()
      }
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'consults the supplier once per execute, with the task being dispatched',
    async () => {
      const parts = buildParts()
      try {
        const seen: Task[] = []
        const executor = new RemoteExecutor(parts.peer, parts.rpc, (task) => {
          seen.push(task)
          return chainFor('alice')
        })
        await executor.execute(taskFor(0))
        expect(seen).toHaveLength(1)
        await executor.execute(taskFor(2))
        expect(seen).toHaveLength(2)
        expect(seen.map((t) => t.partitionIndex)).toEqual([0, 2])
      } finally {
        parts.close()
      }
    },
    TEST_TIMEOUT_MS,
  )

  it(
    'carries a different chain per task through one instance',
    async () => {
      // The property that makes a supplier the right shape rather than a fixed
      // array: one `RemoteExecutor` serves every shard of a job, and shards may
      // name different owners.
      const parts = buildParts()
      try {
        const executor = new RemoteExecutor(parts.peer, parts.rpc, (task) =>
          chainFor(task.partitionIndex === 0 ? 'alice' : 'bob'),
        )
        await executor.execute(taskFor(0))
        await executor.execute(taskFor(1))

        expect(parts.captured).toHaveLength(2)
        const first = execFrame(parts.captured[0]!)?.capability
        const second = execFrame(parts.captured[1]!)?.capability
        expect(first).toEqual(chainFor('alice'))
        expect(second).toEqual(chainFor('bob'))
        expect(first).not.toEqual(second)
      } finally {
        parts.close()
      }
    },
    TEST_TIMEOUT_MS,
  )
})
