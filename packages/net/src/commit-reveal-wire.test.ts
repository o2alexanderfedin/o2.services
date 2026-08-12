/**
 * VER-02 across a wire — the half a kernel test cannot reach.
 *
 * `commit-reveal.test.ts` in `@o2/core` proves the ceremony's arithmetic against
 * hand-built participants. This file proves the two things that only exist once a
 * *frame* and a *serving node* are involved, and both of them are the reason the
 * ceremony deleted in `855cdf5` could not have been repaired in place:
 *
 * 1. **The commit frame discloses nothing.** Round 1 carries a digest and a handle and
 *    has nowhere to put an output, a nonce or a result CID. That is asserted on the
 *    encoded frame's own key set, in the direction the danger comes from — addition.
 * 2. **The node holding an unrevealed answer refuses to hand it to anybody else.** A
 *    replica that could ask the serving node for a co-replica's pending answer would
 *    have the peer's result before revealing its own, which is the plagiarism the
 *    commitment exists to make detectable, arriving by a different door. `serveAgent`
 *    pins the committer and this file drives that refusal with a second real peer.
 *
 * The last describe is the wiring proof: `submitJob` over two served nodes, asserted to
 * have taken the ceremony path by observing which methods the executors were asked for —
 * and, in the case that matters, by a plagiarising node being named rather than counted.
 */

import { MemoryBlockstore, MemoryNetwork, canonicalCid, publicNodes, submitJob } from '@o2/core'
import { CEREMONY_NONCE_BYTES, commitmentDigest } from '@o2/core'
import type {
  CanonicalValue,
  ExecutionOutcome,
  Executor,
  RevealOutcome,
  Task,
} from '@o2/core'
import { CID } from 'multiformats/cid'
import { describe, expect, it } from 'vitest'
import { serveAgent } from './agent.ts'
import {
  MAX_PENDING_COMMITMENTS,
  PENDING_COMMITMENT_TTL_MS,
  PendingCommitments,
} from './commit-store.ts'
import { MAX_COMMITMENT_HANDLE_CHARS, encodeRequest, encodeResponse, parseRequest, parseResponse } from './protocol.ts'
import { RemoteExecutor } from './remote-executor.ts'
import { RpcEndpoint } from './rpc.ts'

const MODULE_CID = CID.parse('bafyreidykglsfhoixmivffc5uwhcgshx4j465xwqntbmu43nb2dzqwfvae')

function taskAt(partitionIndex: number, label: 'public' | 'sovereign' = 'public'): Task {
  return label === 'sovereign'
    ? {
        moduleCid: MODULE_CID,
        inputCid: MODULE_CID,
        partitionIndex,
        partitionCount: 4,
        label,
        ownerId: 'owner-1',
      }
    : { moduleCid: MODULE_CID, inputCid: MODULE_CID, partitionIndex, partitionCount: 4, label }
}

/**
 * A deterministic executor with no WASM in it.
 *
 * The subject here is the ceremony's frames and the serving node's bookkeeping, not
 * guest execution, and a `WasmExecutor` would put a compile and an instantiate between
 * every assertion and the thing it is asserting.
 */
function fakeExecutor(nodeId: string, sum: number): Executor {
  return {
    nodeId,
    async execute(t: Task): Promise<ExecutionOutcome> {
      return {
        ok: true,
        output: { shard: t.partitionIndex, sum },
        fuelUsed: 10,
        attestation: 'signed-by-nobody',
      }
    },
  }
}

interface Served {
  readonly rpc: RpcEndpoint
  readonly id: string
}

/** One `serveAgent` node on a memory network, with every hook at its stated absence. */
function serve(net: MemoryNetwork, id: string, sum: number): Served {
  const rpc = new RpcEndpoint(net.connect(id), { timeoutMs: 2_000 })
  serveAgent({
    paused: 'never-pauses',
    rpc,
    executor: fakeExecutor(id, sum),
    blockstore: new MemoryBlockstore(),
    egress: 'holds-no-registrations',
    authorize: 'serves-unauthenticated',
    index: 'serves-no-records',
    enroll: 'issues-no-certificates',
    capacity: 'accepts-every-offer',
    ledger: 'keeps-no-ledger',
    reservations: 'relays-for-nobody',
    onDispatch: 'reports-no-dispatch',
    attest: 'signs-nothing',
  })
  return { rpc, id }
}

// ---------------------------------------------------------------------------
// The frames
// ---------------------------------------------------------------------------

describe('VER-02 — round 1 crosses the wire without the answer on it', () => {
  it('carries a digest and a handle and has nowhere to put an output', () => {
    const encoded = encodeResponse({
      kind: 'commit',
      outcome: { ok: true, digest: 'ab'.repeat(32), handle: 'deadbeef' },
    })
    // Asserted on the whole key set rather than on the absence of three names, so it
    // fires on *addition* — which is the direction hiding is lost from. A future field
    // called anything at all fails here before it can reach a peer, and that was measured
    // rather than reasoned: one extra key on this arm of `encodeResponse` was watched red
    // on `expected [ 'digest', 'handle', 'hint', …(2) ] to deeply equal [ 'digest',
    // 'handle', 'kind', 'ok' ]` (2026-08-11), then removed and the file compared
    // byte-identical against a snapshot taken before planting.
    expect(Object.keys(encoded as object).sort()).toEqual(['digest', 'handle', 'kind', 'ok'])
  })

  it('round-trips both arms of a commit reply', () => {
    const ok = parseResponse(
      encodeResponse({ kind: 'commit', outcome: { ok: true, digest: 'ff', handle: 'h1' } }),
    )
    expect(ok).toEqual({ kind: 'commit', outcome: { ok: true, digest: 'ff', handle: 'h1' } })
    const refused = parseResponse(
      encodeResponse({ kind: 'commit', outcome: { ok: false, reason: 'busy' } }),
    )
    expect(refused).toEqual({ kind: 'commit', outcome: { ok: false, reason: 'busy' } })
  })

  it('refuses a malformed commit reply rather than degrading it to a refusal', () => {
    // `parseAttestation`'s disposition, applied here. A frame that parsed to `ok: false`
    // would report a peer's protocol error as an honest refusal to commit, and the
    // requestor would drop that replica from the ceremony and never learn the frame was
    // broken.
    expect(parseResponse({ kind: 'commit', ok: true, handle: 'h1' })).toBeNull()
    expect(parseResponse({ kind: 'commit', ok: true, digest: 'ff' })).toBeNull()
    expect(parseResponse({ kind: 'commit', ok: true, digest: '', handle: 'h1' })).toBeNull()
    expect(parseResponse({ kind: 'commit', ok: 'yes', digest: 'ff', handle: 'h1' })).toBeNull()
    expect(
      parseResponse({ kind: 'commit', ok: true, digest: 'ff', handle: 'h'.repeat(MAX_COMMITMENT_HANDLE_CHARS + 1) }),
    ).toBeNull()
  })

  it('sends a commit request over the identical payload an exec carries', () => {
    const task = taskAt(2)
    const asExec = encodeRequest({ kind: 'exec', task }) as Record<string, CanonicalValue>
    const asCommit = encodeRequest({ kind: 'commit', task }) as Record<string, CanonicalValue>
    // One builder, so the two differ in the discriminant and in nothing else. A commit
    // that encoded its capability chain or its sovereignty label differently from the
    // exec carrying the same task would be judged on different terms by one authorizer.
    expect(Object.keys(asCommit).sort()).toEqual(Object.keys(asExec).sort())
    expect({ ...asCommit, kind: 'exec' }).toEqual(asExec)
    expect(parseRequest(asCommit)).toEqual({ kind: 'commit', task })
  })

  it('names only a handle on the reveal request, with nowhere to assert anything else', () => {
    const encoded = encodeRequest({ kind: 'reveal', handle: 'h1' })
    expect(Object.keys(encoded as object).sort()).toEqual(['handle', 'kind'])
    expect(parseRequest(encoded)).toEqual({ kind: 'reveal', handle: 'h1' })
  })

  it('refuses a reveal request naming an absent, empty or over-long handle', () => {
    expect(parseRequest({ kind: 'reveal' })).toBeNull()
    expect(parseRequest({ kind: 'reveal', handle: '' })).toBeNull()
    expect(parseRequest({ kind: 'reveal', handle: 42 })).toBeNull()
    // Both sides of the bound, so it is proved an inequality rather than an accident.
    expect(parseRequest({ kind: 'reveal', handle: 'h'.repeat(MAX_COMMITMENT_HANDLE_CHARS) })).not.toBeNull()
    expect(parseRequest({ kind: 'reveal', handle: 'h'.repeat(MAX_COMMITMENT_HANDLE_CHARS + 1) })).toBeNull()
  })
})

describe('VER-02 — the nonce is bounded at the wire, exactly rather than at a ceiling', () => {
  const output: CanonicalValue = { sum: 1 }

  function revealFrame(nonceBytes: number): CanonicalValue {
    return encodeResponse({
      kind: 'reveal',
      outcome: {
        ok: true,
        nonce: new Uint8Array(nonceBytes),
        output,
        fuelUsed: 1,
        attestation: 'signed-by-nobody',
      },
    })
  }

  it('accepts the sited width and refuses one byte either side of it', () => {
    // Watched red on `expected { kind: 'reveal', …(1) } to be null` with the exact test
    // relaxed to a ceiling of four times the width (2026-08-11) — the shape of the
    // mistake somebody makes who reads this as a size limit rather than as an ambiguity
    // fix. Restored and compared byte-identical.
    expect(parseResponse(revealFrame(CEREMONY_NONCE_BYTES))).not.toBeNull()
    // The commitment preimage concatenates the nonce with CIDs and carries no length
    // prefixes, so a variable-width nonce lets one preimage be produced from two
    // different claims. Refusing at the parser is the only place that can be removed.
    expect(parseResponse(revealFrame(CEREMONY_NONCE_BYTES - 1))).toBeNull()
    expect(parseResponse(revealFrame(CEREMONY_NONCE_BYTES + 1))).toBeNull()
    expect(parseResponse(revealFrame(0))).toBeNull()
  })

  it('refuses a reveal with no nonce at all rather than reading it as unsigned', () => {
    expect(
      parseResponse({ kind: 'reveal', ok: true, output, fuelUsed: 1, attestation: 'signed-by-nobody' }),
    ).toBeNull()
    expect(
      parseResponse({
        kind: 'reveal',
        ok: true,
        nonce: 'not-bytes',
        output,
        fuelUsed: 1,
        attestation: 'signed-by-nobody',
      }),
    ).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// The serving node's own refusals
// ---------------------------------------------------------------------------

describe('VER-02 — a served node hands its pending answer to nobody but the committer', () => {
  it('commits to a real answer and reveals it only to the peer that asked', async () => {
    const net = new MemoryNetwork()
    const worker = serve(net, 'w0', 42)
    const alice = new RpcEndpoint(net.connect('alice'), { timeoutMs: 2_000 })
    const bob = new RpcEndpoint(net.connect('bob'), { timeoutMs: 2_000 })
    try {
      const task = taskAt(1)
      const committed = await new RemoteExecutor('w0', alice, 'dispatches-unauthenticated').commit(task)
      expect(committed.ok).toBe(true)
      if (!committed.ok) return

      // Bob asks for Alice's answer. This is the whole of the serving-side property: if
      // it succeeded, Bob would hold a co-replica's result before revealing its own.
      // Watched red on `expected true to be false` with `PendingCommitments.take`'s
      // committer check disabled (2026-08-11); restored and compared byte-identical.
      const stolen = await new RemoteExecutor('w0', bob, 'dispatches-unauthenticated').reveal(
        committed.handle,
      )
      expect(stolen.ok).toBe(false)
      if (stolen.ok) return
      expect(stolen.reason).toBe('that commitment was made to another peer on w0')

      // …and Alice's own reveal still works, so the refusal above consumed nothing. A
      // wrong-peer request that destroyed the entry would be a denial primitive built
      // out of a check that exists to prevent disclosure.
      const revealed = await new RemoteExecutor('w0', alice, 'dispatches-unauthenticated').reveal(
        committed.handle,
      )
      expect(revealed.ok).toBe(true)
      if (!revealed.ok) return
      expect(revealed.output).toEqual({ shard: 1, sum: 42 })

      // The digest the requestor was handed in round 1 checks out against the answer it
      // hashes itself in round 2 — computed here the way `executeCommitReveal` computes
      // it, over a CID this side derived and never accepted.
      const hashed = await canonicalCid(revealed.output)
      expect(hashed.ok).toBe(true)
      if (!hashed.ok) return
      expect(await commitmentDigest(revealed.nonce, task, hashed.cid)).toBe(committed.digest)
    } finally {
      alice.close()
      bob.close()
      worker.rpc.close()
    }
  })

  it('refuses a second reveal of the same handle, so a captured frame replays into nothing', async () => {
    const net = new MemoryNetwork()
    const worker = serve(net, 'w0', 42)
    const alice = new RpcEndpoint(net.connect('alice'), { timeoutMs: 2_000 })
    try {
      const remote = new RemoteExecutor('w0', alice, 'dispatches-unauthenticated')
      const committed = await remote.commit(taskAt(1))
      expect(committed.ok).toBe(true)
      if (!committed.ok) return
      expect((await remote.reveal(committed.handle)).ok).toBe(true)
      // Watched red on `expected true to be false` with the `#entries.delete` on the
      // entitled path removed (2026-08-11); restored and compared byte-identical.
      const again = await remote.reveal(committed.handle)
      expect(again.ok).toBe(false)
      if (again.ok) return
      expect(again.reason).toBe('no commitment pending under that name on w0')
    } finally {
      alice.close()
      worker.rpc.close()
    }
  })

  it('refuses a handle it never minted, in the same words as one it has already given back', async () => {
    const net = new MemoryNetwork()
    const worker = serve(net, 'w0', 42)
    const alice = new RpcEndpoint(net.connect('alice'), { timeoutMs: 2_000 })
    try {
      const guessed = await new RemoteExecutor('w0', alice, 'dispatches-unauthenticated').reveal(
        'ffffffffffffffffffffffffffffffff',
      )
      expect(guessed.ok).toBe(false)
      if (guessed.ok) return
      // Identical wording to the taken case above, deliberately: a peer guessing names
      // must not be able to tell "there is nothing here" from "there was, and it is
      // gone", because the second is a fact about somebody else's exchange.
      expect(guessed.reason).toBe('no commitment pending under that name on w0')
    } finally {
      alice.close()
      worker.rpc.close()
    }
  })

  it('refuses to commit to a sovereign shard, naming the tier rather than degrading', async () => {
    const net = new MemoryNetwork()
    const worker = serve(net, 'w0', 42)
    const alice = new RpcEndpoint(net.connect('alice'), { timeoutMs: 2_000 })
    try {
      const outcome = await new RemoteExecutor('w0', alice, 'dispatches-unauthenticated').commit(
        taskAt(1, 'sovereign'),
      )
      // Watched red on `expected true to be false` with the label test disabled
      // (2026-08-11); restored and compared byte-identical.
      expect(outcome.ok).toBe(false)
      if (outcome.ok) return
      expect(outcome.reason).toBe(
        'commit refused: the commit-reveal ceremony runs on public shards only, and this task is labelled sovereign on w0',
      )
    } finally {
      alice.close()
      worker.rpc.close()
    }
  })

  it('refuses to hold more unrevealed answers than its sited bound, naming the count', async () => {
    const net = new MemoryNetwork()
    const worker = serve(net, 'w0', 42)
    const alice = new RpcEndpoint(net.connect('alice'), { timeoutMs: 5_000 })
    try {
      const remote = new RemoteExecutor('w0', alice, 'dispatches-unauthenticated')
      // Each commit is a distinct shard, so nothing is deduped by the slot key and the
      // store fills for the reason it exists to bound: a peer committing and not
      // returning.
      for (let i = 0; i < MAX_PENDING_COMMITMENTS; i++) {
        const outcome = await remote.commit({ ...taskAt(0), partitionIndex: i, partitionCount: MAX_PENDING_COMMITMENTS })
        expect(outcome.ok).toBe(true)
      }
      // Watched red on `expected true to be false` with the size test disabled
      // (2026-08-11), which also reddened the expiry case below; restored and compared
      // byte-identical.
      const over = await remote.commit({
        ...taskAt(0),
        partitionIndex: MAX_PENDING_COMMITMENTS,
        partitionCount: MAX_PENDING_COMMITMENTS + 1,
      })
      expect(over.ok).toBe(false)
      if (over.ok) return
      expect(over.reason).toBe(
        `commit refused: ${String(MAX_PENDING_COMMITMENTS)} of ${String(MAX_PENDING_COMMITMENTS)} commitments already pending on w0`,
      )
    } finally {
      alice.close()
      worker.rpc.close()
    }
  })
})

describe('VER-02 — the holding area expires what nobody came back for', () => {
  const entry = {
    committedBy: 'alice',
    nonce: new Uint8Array(CEREMONY_NONCE_BYTES),
    output: { sum: 1 } as CanonicalValue,
    fuelUsed: 1,
    attestation: 'signed-by-nobody' as const,
  }

  it('holds an entry up to the TTL and drops it at the TTL', () => {
    const store = new PendingCommitments('w0')
    const reserved = store.reserve(0)
    expect(reserved.ok).toBe(true)
    if (!reserved.ok) return
    store.file(reserved.handle, { ...entry, at: 0 })

    // Both sides of the bound. An expiry asserted only past its edge would pass against
    // a store that expired everything immediately. Watched red on
    // `expected 1 to be +0` with the TTL doubled (2026-08-11); restored and compared
    // byte-identical.
    expect(store.size(PENDING_COMMITMENT_TTL_MS - 1)).toBe(1)
    expect(store.size(PENDING_COMMITMENT_TTL_MS)).toBe(0)
  })

  it('frees the bound again once entries expire, so a flood is not permanent', () => {
    const store = new PendingCommitments('w0')
    for (let i = 0; i < MAX_PENDING_COMMITMENTS; i++) {
      const reserved = store.reserve(0)
      expect(reserved.ok).toBe(true)
      if (!reserved.ok) return
      store.file(reserved.handle, { ...entry, at: 0 })
    }
    expect(store.reserve(0).ok).toBe(false)
    // The refusal is a statement about now, not a permanent condition — a node that
    // refused forever after one flood would be a node a peer could switch off.
    expect(store.reserve(PENDING_COMMITMENT_TTL_MS).ok).toBe(true)
  })

  it('mints unguessable handles rather than a counter', () => {
    const store = new PendingCommitments('w0')
    const first = store.reserve(0)
    const second = store.reserve(0)
    expect(first.ok && second.ok).toBe(true)
    if (!first.ok || !second.ok) return
    expect(first.handle).not.toBe(second.handle)
    expect(first.handle).toMatch(/^[0-9a-f]{32}$/)
  })
})

// ---------------------------------------------------------------------------
// The wiring
// ---------------------------------------------------------------------------

/** Records which of the three verbs a job actually used on this node. */
class WatchedExecutor extends RemoteExecutor {
  readonly calls: string[] = []

  override async execute(task: Task): Promise<ExecutionOutcome> {
    this.calls.push('execute')
    return super.execute(task)
  }

  override async commit(task: Task) {
    this.calls.push('commit')
    return super.commit(task)
  }

  override async reveal(handle: string): Promise<RevealOutcome> {
    this.calls.push('reveal')
    return super.reveal(handle)
  }
}

/**
 * Substitutes a value it was handed for the one its node actually produced.
 *
 * **Both verbs, and that is what makes the counterfactual exact.** The `execute`
 * override is not decoration: it is how the same node behaves on the route
 * `executeVerified` takes, and it is what lets one fixture measure both readings —
 * with the ceremony the theft is a named refusal, without it the job reports two
 * agreeing replicas and a forged answer as verified. A double that stole only in
 * round 2 would make the no-ceremony arm read `disagreed`, which is a *different*
 * and much easier defect to notice, and the comparison would flatter the ceremony.
 */
class PlagiarisingExecutor extends WatchedExecutor {
  stolen: CanonicalValue = null

  override async execute(task: Task): Promise<ExecutionOutcome> {
    const honest = await super.execute(task)
    if (!honest.ok) return honest
    return { ...honest, output: this.stolen }
  }

  override async reveal(handle: string): Promise<RevealOutcome> {
    const honest = await super.reveal(handle)
    if (!honest.ok) return honest
    return { ...honest, output: this.stolen }
  }
}

describe('VER-02 — submitJob takes the ceremony path, and the ledger row says so', () => {
  it('asks a public redundancy-2 shard for two rounds and never for a one-call execute', async () => {
    const net = new MemoryNetwork()
    const w0 = serve(net, 'w0', 42)
    const w1 = serve(net, 'w1', 42)
    const origin = new RpcEndpoint(net.connect('origin'), { timeoutMs: 5_000 })
    const store = new MemoryBlockstore()
    try {
      const executors = [
        new WatchedExecutor('w0', origin, 'dispatches-unauthenticated'),
        new WatchedExecutor('w1', origin, 'dispatches-unauthenticated'),
      ]
      const result = await submitJob(
        {
          moduleCid: MODULE_CID,
          shards: [{ value: { a: 0 } as CanonicalValue, label: 'public' as const }],
          executors,
          nodes: publicNodes(executors),
          redundancy: 2,
          onQuorumShortfall: 'runs-at-available-redundancy',
        },
        store,
        { checkpoints: 'checkpoints-nothing' },
      )
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.job.shards[0]?.verification.status).toBe('agreed')
      // The wiring claim, read off the executors rather than inferred from a green job:
      // two rounds happened and the one-call route was never taken. Watched red on
      // `expected [ 'execute' ] to deeply equal [ 'commit', 'reveal' ]` with `submitJob`'s
      // selection forced false (2026-08-11); restored and compared byte-identical.
      for (const executor of executors) expect(executor.calls).toEqual(['commit', 'reveal'])
    } finally {
      origin.close()
      w0.rpc.close()
      w1.rpc.close()
    }
  })

  it('names a plagiarising node on a job the comparison alone would have passed', async () => {
    const net = new MemoryNetwork()
    const w0 = serve(net, 'w0', 42)
    const w1 = serve(net, 'w1', 7)
    const origin = new RpcEndpoint(net.connect('origin'), { timeoutMs: 5_000 })
    const store = new MemoryBlockstore()
    try {
      const honest = new WatchedExecutor('w0', origin, 'dispatches-unauthenticated')
      const thief = new PlagiarisingExecutor('w1', origin, 'dispatches-unauthenticated')
      // `w1` really computes 7 and commits to it; between the rounds it comes into
      // possession of `w0`'s answer and reveals that instead. Byte-identical output, so
      // `executeVerified` would have reported two agreeing replicas.
      thief.stolen = { shard: 0, sum: 42 }
      const result = await submitJob(
        {
          moduleCid: MODULE_CID,
          shards: [{ value: { a: 0 } as CanonicalValue, label: 'public' as const }],
          executors: [honest, thief],
          nodes: publicNodes([honest, thief]),
          redundancy: 2,
          onQuorumShortfall: 'runs-at-available-redundancy',
        },
        store,
        { checkpoints: 'checkpoints-nothing' },
      )
      expect(result.ok).toBe(true)
      if (!result.ok) return
      const verification = result.job.shards[0]?.verification
      expect(verification?.status).toBe('agreed')
      if (verification?.status !== 'agreed') return
      // One replica, not two: the copied answer is refused rather than counted, and the
      // job honestly reports the redundancy it actually achieved.
      //
      // **The counterfactual was measured on this same fixture, not argued.** With
      // `submitJob`'s ceremony selection forced false the shard came back
      // `replicas: 2` — `expected 2 to be 1` (2026-08-11) — which is this job reporting
      // a forged answer as verified agreement between two independent replicas, silently
      // and with nothing in the result to indicate it. That reading is what the line
      // below is worth.
      expect(verification.replicas).toBe(1)
      expect(verification.agreeing.map((r) => r.nodeId)).toEqual(['w0'])
      expect(verification.failures.map((f) => f.reason)).toContain(
        'reveal does not match the commitment w1 published in round 1',
      )
    } finally {
      origin.close()
      w0.rpc.close()
      w1.rpc.close()
    }
  })

  it('leaves a redundancy-1 shard on the one-call route, because a ceremony over one binds nothing', async () => {
    const net = new MemoryNetwork()
    const w0 = serve(net, 'w0', 42)
    const origin = new RpcEndpoint(net.connect('origin'), { timeoutMs: 5_000 })
    const store = new MemoryBlockstore()
    try {
      const executors = [new WatchedExecutor('w0', origin, 'dispatches-unauthenticated')]
      const result = await submitJob(
        {
          moduleCid: MODULE_CID,
          shards: [{ value: { a: 0 } as CanonicalValue, label: 'public' as const }],
          executors,
          nodes: publicNodes(executors),
          redundancy: 1,
          onQuorumShortfall: 'runs-at-available-redundancy',
        },
        store,
        { checkpoints: 'checkpoints-nothing' },
      )
      expect(result.ok).toBe(true)
      expect(executors[0]?.calls).toEqual(['execute'])
    } finally {
      origin.close()
      w0.rpc.close()
    }
  })

  it('leaves a sovereign shard on the one-call route, which is the tier split enforced', async () => {
    // `.planning/PROJECT.md`'s integrity table: sovereign data is owner-attested and what
    // is verified is the aggregation over contributions. This is the requestor-side half
    // of that split; the serving side refuses a sovereign `commit` by name as well, above.
    const net = new MemoryNetwork()
    const w0 = serve(net, 'w0', 42)
    const w1 = serve(net, 'w1', 42)
    const origin = new RpcEndpoint(net.connect('origin'), { timeoutMs: 5_000 })
    const store = new MemoryBlockstore()
    try {
      const executors = [
        new WatchedExecutor('w0', origin, 'dispatches-unauthenticated'),
        new WatchedExecutor('w1', origin, 'dispatches-unauthenticated'),
      ]
      const result = await submitJob(
        {
          moduleCid: MODULE_CID,
          shards: [
            { value: { a: 0 } as CanonicalValue, label: 'sovereign' as const, ownerId: 'owner-1' },
          ],
          executors,
          // `publicNodes` stamps `ownerId: 'public'`, which no sovereign shard is
          // eligible for — placement would refuse and nothing would dispatch, and the
          // assertion below would then be green against a job that never ran. The
          // descriptors say `owner-1` so the shard is genuinely placed and genuinely
          // executed, and the claim is about the route it took rather than about
          // placement declining to take any.
          nodes: executors.map((executor) => ({
            nodeId: executor.nodeId,
            ownerId: 'owner-1',
            canExecuteSovereign: true,
            load: 0,
            certificate: 'carries-no-certificate' as const,
          })),
          redundancy: 2,
          onQuorumShortfall: 'runs-at-available-redundancy',
        },
        store,
        { checkpoints: 'checkpoints-nothing' },
      )
      expect(result.ok).toBe(true)
      if (!result.ok) return
      // The shard really ran — without this the assertion below passes against a job
      // placement declined to dispatch at all.
      expect(result.job.shards[0]?.verification.status).toBe('agreed')
      for (const executor of executors) expect(executor.calls).toEqual(['execute'])
    } finally {
      origin.close()
      w0.rpc.close()
      w1.rpc.close()
    }
  })
})
