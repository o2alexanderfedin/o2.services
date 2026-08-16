import { ed25519 } from '@noble/curves/ed25519.js'
import { describe, expect, it } from 'vitest'
import { MemoryBlockstore } from '../blockstore/memory.ts'
import { canonicalCid, encodeCanonical } from '../canonical/encode.ts'
import { toHex } from '../capability.ts'
import { EnrollmentAuthority, requestEnrollment } from '../enrollment.ts'
import type { NodeCertificate } from '../enrollment.ts'
import type { ComputeThread, ExecutionOutcome, Executor, Task } from '../ports.ts'
import { verifyResultAttestation } from '../result-attestation.ts'
import type { ResultSigner } from '../result-attestation.ts'
import { attestResults } from './attesting-executor.ts'
import type { WorkerTaskRequest, WorkerTaskResponse } from './task-run.ts'
import { WorkerExecutor } from './worker-executor.ts'

/**
 * VER-08, VER-09, VER-10 — the wrapper that signs, and the kernel that does not.
 *
 * The subject here is composition, not cryptography: `result-attestation.test.ts` owns
 * what a signature is worth. What these cases establish is that the wrapper signs its
 * *inner executor's* answer rather than its own arguments, that it moves no identity,
 * and that a node configured not to sign is visibly different from one that does.
 */

const provider = new Uint8Array(32).fill(80)
const alice = new Uint8Array(32).fill(81)
const NOW = 1_800_000_000_000
const PINNED: ReadonlySet<string> = new Set([toHex(ed25519.getPublicKey(provider))])

async function enrolled(seed: number): Promise<ResultSigner> {
  const nodeSeed = new Uint8Array(32).fill(seed)
  const result = new EnrollmentAuthority({
    providerPrivateKey: provider,
    maxIssuedPerWindow: 'issues-without-an-aggregate-budget',
    issuance: 'remembers-only-within-this-process',
  }).enrol(
    await requestEnrollment(nodeSeed, alice, {
      operatorId: `op-${seed}`,
      discoverability: 'via-relay',
      relayIds: ['relay-1'],
    }),
    NOW,
  )
  if (!result.ok) throw new Error('fixture failed to enrol')
  return { nodeSeed, certificate: result.certificate satisfies NodeCertificate }
}

async function aTask(partitionIndex = 0): Promise<Task> {
  const store = new MemoryBlockstore()
  return {
    moduleCid: await store.put(new Uint8Array([1, 2, 3]) as Uint8Array<ArrayBuffer>),
    inputCid: await store.put(new Uint8Array([4, 5, 6]) as Uint8Array<ArrayBuffer>),
    partitionIndex,
    partitionCount: 4,
  }
}

/** An inner executor whose answer depends on the task, so a lift is detectable. */
function inner(nodeId: string, calls: { count: number } = { count: 0 }): Executor {
  return {
    nodeId,
    execute(task: Task): Promise<ExecutionOutcome> {
      calls.count += 1
      return Promise.resolve({
        ok: true,
        output: { shard: task.partitionIndex, sum: task.partitionIndex * 7 },
        fuelUsed: 11,
        attestation: 'signed-by-nobody',
      })
    },
  }
}

describe('the wrapper signs what the inner executor returned', () => {
  it('produces an attestation that verifies against that exact task and output', async () => {
    const signer = await enrolled(1)
    const task = await aTask(2)
    const executor = attestResults(inner('server-1'), signer)

    const outcome = await executor.execute(task)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return

    // The work is rebuilt from the caller's own task and the caller's own hash of the
    // output — never from anything the attestation supplied.
    const hashed = await canonicalCid(outcome.output)
    expect(hashed.ok).toBe(true)
    if (!hashed.ok) return

    const checked = verifyResultAttestation(
      outcome.attestation,
      {
        moduleCid: task.moduleCid,
        inputCid: task.inputCid,
        partitionIndex: task.partitionIndex,
        outputCid: hashed.cid,
      },
      PINNED,
      NOW,
    )
    expect(checked.ok).toBe(true)
    if (!checked.ok) return
    expect(checked.certificate.nodeKey).toBe(toHex(ed25519.getPublicKey(signer.nodeSeed)))
  })

  it('passes a failure through untouched, because a failure attests nothing', async () => {
    const signer = await enrolled(2)
    const failing: Executor = {
      nodeId: 'server-2',
      execute: () => Promise.resolve({ ok: false, reason: 'the guest trapped' }),
    }

    const outcome = await attestResults(failing, signer).execute(await aTask())

    // Not merely "no attestation" — the failure arm has no attestation slot at all, so
    // there is nothing here that could be read as an unsigned success.
    expect(outcome).toEqual({ ok: false, reason: 'the guest trapped' })
    expect(outcome.ok).toBe(false)
  })

  it('calls the inner executor exactly once and returns its output and fuel', async () => {
    const calls = { count: 0 }
    const executor = attestResults(inner('server-3', calls), await enrolled(3))

    const outcome = await executor.execute(await aTask(1))

    expect(calls.count).toBe(1)
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.output).toEqual({ shard: 1, sum: 7 })
    expect(outcome.fuelUsed).toBe(11)
  })
})

describe('the sentinel is a configuration, not a hole', () => {
  it('shows the two configurations differing in one run', async () => {
    const task = await aTask(3)
    const signing = await attestResults(inner('server-4'), await enrolled(4)).execute(task)
    const silent = await attestResults(inner('server-4'), 'signs-nothing').execute(task)

    expect(signing.ok && silent.ok).toBe(true)
    if (!signing.ok || !silent.ok) return

    // Asserted beside each other deliberately. A wrapper that signed nothing in either
    // configuration would satisfy the silent case alone, and that is the pre-plan world
    // reading green — the reading a required-with-sentinel field exists to prevent.
    expect(silent.attestation).toBe('signed-by-nobody')
    expect(signing.attestation).not.toBe('signed-by-nobody')
    expect(signing.output).toEqual(silent.output)
  })

  it('leaves the inner executor exactly as it found it when this node signs nothing', () => {
    const bare = inner('server-5')
    // `'signs-nothing'` composes to the identity. A node declaring it signs nothing has
    // said nothing about what an inner adapter may already have signed, so replacing a
    // real statement with the sentinel would be a false one.
    expect(attestResults(bare, 'signs-nothing')).toBe(bare)
  })
})

describe('composing the wrapper moves no identity', () => {
  it('keeps the inner executor node id, rather than deriving one from the certificate', async () => {
    const signer = await enrolled(6)
    const bare = inner('12D3KooWHPSVMPEezVCXvka2ahwT26JGL8EBr61LpGEU3ujHQM9Q')
    const wrapped = attestResults(bare, signer)

    expect(wrapped.nodeId).toBe(bare.nodeId)
    // Deriving it from the certificate would put a hex key where every caller expects a
    // peer id, and `submitJob`'s `missing-node-descriptor` would fire across the tree.
    expect(wrapped.nodeId).not.toBe(signer.certificate.nodeKey)
  })

  it('refuses at composition when the seed and the certificate name different keys', async () => {
    const signer = await enrolled(7)
    const somebodyElse = new Uint8Array(32).fill(99)

    // Once, where the two values were put together — not once per task, which would
    // surface as every shard failing for a reason that names the task.
    expect(() =>
      attestResults(inner('server-7'), { nodeSeed: somebodyElse, certificate: signer.certificate }),
    ).toThrow(/cannot sign for a key it does not hold/)
  })
})

describe('the kernel executors are unsigned by construction', () => {
  /**
   * The assertion that stops a later reader "helpfully" giving the kernel a key.
   *
   * `WorkerExecutor` is driven through a fake `ComputeThread` because the claim is
   * about what the executor *constructs*, not about threads.
   */
  it("reports the sentinel from WorkerExecutor's own successful outcome", async () => {
    const store = new MemoryBlockstore()
    const task: Task = {
      moduleCid: await store.put(new Uint8Array([1, 2, 3]) as Uint8Array<ArrayBuffer>),
      inputCid: await store.put(new Uint8Array([4, 5, 6]) as Uint8Array<ArrayBuffer>),
      partitionIndex: 0,
      partitionCount: 1,
    }
    const encoded = encodeCanonical({ answer: 42 })
    expect(encoded.ok).toBe(true)
    if (!encoded.ok) return

    let posted: WorkerTaskRequest | null = null
    let respond: ((response: WorkerTaskResponse) => void) | null = null
    const thread: ComputeThread = {
      post: (request) => {
        posted = request
      },
      onResponse: (handler) => {
        respond = handler
      },
      onError: () => {},
      kill: () => {},
    }

    const executor = new WorkerExecutor({
      nodeId: 'server-8',
      blockstore: store,
      createThread: () => thread,
    })
    const pending = executor.execute(task)
    // Let the executor resolve both blocks and post before answering.
    await new Promise((resolve) => setTimeout(resolve, 0))
    const request = posted as WorkerTaskRequest | null
    expect(request).not.toBeNull()
    ;(respond as unknown as (response: WorkerTaskResponse) => void)({
      id: request?.id ?? 0,
      ok: true,
      outputBytes: encoded.bytes,
      fuelUsed: 3,
    })

    const outcome = await pending
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    // Kernel code holds a blockstore and a node id, and no identity. A kernel that
    // signed would need one, which is what `ports.ts` exists to keep out.
    expect(outcome.attestation).toBe('signed-by-nobody')
  })
})
