/**
 * The two-round ceremony's own tests — VER-02.
 *
 * ## What this file has to prove, and why the bar is unusually specific
 *
 * A ceremony shipped under VER-02 in Phase 1 and was deleted in `855cdf5` because its
 * check *could not be false*: the requestor minted the nonce, computed the digest,
 * recomputed it from the same two values, and compared. Both failure branches were
 * unreachable, and that was established by making one of them throw and running the whole
 * node project — 1171 tests, no reach.
 *
 * So the standard this file is held to is not "the happy path works". It is: **every
 * refusal in `commit-reveal.ts` is reachable, and was watched go red.** Each case below
 * that carries a refusal drives it with an executor that really behaves that way, and
 * `mutation-ledger.ts` carries the planted-mutation entries with the signature observed
 * from a real failing run.
 *
 * ## The one property that is structural rather than branched, said plainly
 *
 * The barrier. Round 2 begins after `await Promise.all` over round 1, and no arrangement
 * of arguments reorders that, so there is no branch to plant. What is asserted instead is
 * the *consequence*: the executors in
 * `describe('the barrier holds — nobody reveals while an answer is still unfixed')`
 * record the global order of every call, and the assertion is that no `reveal` was entered
 * before the last `commit` returned. That assertion was watched go red against an
 * interleaved implementation before it was written the right way round; the recorded text
 * is in that describe's own comment.
 */

import { describe, expect, it } from 'vitest'
import { CID } from 'multiformats/cid'
import { canonicalCid } from '../canonical/encode.ts'
import type { CanonicalValue } from '../canonical/encode.ts'
import type { Executor, Task } from '../ports.ts'
import {
  CEREMONY_NONCE_BYTES,
  MIN_CEREMONY_REPLICAS,
  commitmentDigest,
  drawCeremonyNonce,
  executeCommitReveal,
  isCommitting,
} from './commit-reveal.ts'
import type { CommitOutcome, CommittingExecutor, RevealOutcome } from './commit-reveal.ts'

const MODULE_CID = CID.parse('bafyreidykglsfhoixmivffc5uwhcgshx4j465xwqntbmu43nb2dzqwfvae')

const task: Task = {
  moduleCid: MODULE_CID,
  inputCid: MODULE_CID,
  partitionIndex: 2,
  partitionCount: 4,
  label: 'public',
}

/** A second shard of the same job — the fixture the cross-shard replay case needs. */
const otherShard: Task = { ...task, partitionIndex: 3 }

function answerFor(t: Task, sum: number): CanonicalValue {
  return { shard: t.partitionIndex, of: t.partitionCount, sum }
}

/**
 * An honest participant, written the way a real serving node behaves.
 *
 * It draws its own nonce, hashes its own answer, publishes only the digest, and hands the
 * answer back on reveal. `serveAgent`'s `commit` branch is this, with an executor and a
 * wire around it — and the duplication is deliberate: a kernel test that imported the
 * node's implementation would be asserting that one implementation agrees with itself.
 */
class Participant implements CommittingExecutor {
  readonly nodeId: string
  readonly #sum: number
  /**
   * Milliseconds this node takes to finish round 1.
   *
   * Not decoration: the barrier cases need one node to still be committing while another
   * has finished, or an interleaved implementation could order correctly by luck of
   * microtask scheduling and the assertion would pass against a broken ceremony. A real
   * fabric always has a slower node; this is that node, made deterministic.
   */
  readonly #commitDelayMs: number
  /** What this node last committed to, so a dishonest subclass can diverge from it. */
  protected pending: { nonce: Uint8Array; output: CanonicalValue } | null = null
  /** Every call this node saw, in order — read by the barrier cases. */
  readonly log: string[]

  constructor(nodeId: string, sum: number, log: string[] = [], commitDelayMs = 0) {
    this.nodeId = nodeId
    this.#sum = sum
    this.log = log
    this.#commitDelayMs = commitDelayMs
  }

  async commit(t: Task): Promise<CommitOutcome> {
    this.log.push(`commit:${this.nodeId}:enter`)
    if (this.#commitDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.#commitDelayMs))
    }
    const output = answerFor(t, this.#sum)
    const hashed = await canonicalCid(output)
    if (!hashed.ok) return { ok: false, reason: 'not encodable' }
    const nonce = drawCeremonyNonce()
    const digest = await commitmentDigest(nonce, t, hashed.cid)
    this.pending = { nonce, output }
    this.log.push(`commit:${this.nodeId}:leave`)
    return { ok: true, digest, handle: `${this.nodeId}-1` }
  }

  async reveal(handle: string): Promise<RevealOutcome> {
    this.log.push(`reveal:${this.nodeId}:enter`)
    if (this.pending === null || handle !== `${this.nodeId}-1`) {
      return { ok: false, reason: `no commitment pending under that name on ${this.nodeId}` }
    }
    return {
      ok: true,
      nonce: this.pending.nonce,
      output: this.pending.output,
      fuelUsed: 100,
      attestation: 'signed-by-nobody',
    }
  }
}

/**
 * Commits to its own answer, then reveals somebody else's.
 *
 * This is VER-02's adversary in the only form a kernel test can hold it: the peer's
 * answer arrives here between the rounds, by a side channel this test does not model,
 * and the node tries to pass it off. The point of the requirement is **not** that the
 * fabric can stop the seeing — it cannot — but that the answer was already bound, so
 * acting on what was seen is detectable.
 */
class Plagiarist extends Participant {
  readonly #stolen: CanonicalValue

  constructor(nodeId: string, ownSum: number, stolen: CanonicalValue, log: string[] = []) {
    super(nodeId, ownSum, log)
    this.#stolen = stolen
  }

  override async reveal(handle: string): Promise<RevealOutcome> {
    const honest = await super.reveal(handle)
    if (!honest.ok) return honest
    return { ...honest, output: this.#stolen }
  }
}

/** Commits once and hands the same commitment back for every shard it is asked. */
class Replayer implements CommittingExecutor {
  readonly nodeId: string
  #first: { nonce: Uint8Array; output: CanonicalValue; digest: string } | null = null

  constructor(nodeId: string) {
    this.nodeId = nodeId
  }

  async commit(t: Task): Promise<CommitOutcome> {
    if (this.#first === null) {
      const output = answerFor(t, 42)
      const hashed = await canonicalCid(output)
      if (!hashed.ok) return { ok: false, reason: 'not encodable' }
      const nonce = drawCeremonyNonce()
      this.#first = { nonce, output, digest: await commitmentDigest(nonce, t, hashed.cid) }
    }
    return { ok: true, digest: this.#first.digest, handle: 'replay' }
  }

  async reveal(): Promise<RevealOutcome> {
    const first = this.#first
    if (first === null) return { ok: false, reason: 'nothing committed' }
    return {
      ok: true,
      nonce: first.nonce,
      output: first.output,
      fuelUsed: 100,
      attestation: 'signed-by-nobody',
    }
  }
}

function refusesToCommit(nodeId: string, reason: string): CommittingExecutor {
  return {
    nodeId,
    async commit(): Promise<CommitOutcome> {
      return { ok: false, reason }
    },
    async reveal(): Promise<RevealOutcome> {
      return { ok: false, reason: 'never committed' }
    },
  }
}

function refusesToReveal(nodeId: string, reason: string, log: string[] = []): CommittingExecutor {
  const inner = new Participant(nodeId, 42, log)
  return {
    nodeId,
    commit: (t: Task) => inner.commit(t),
    async reveal(): Promise<RevealOutcome> {
      log.push(`reveal:${nodeId}:enter`)
      return { ok: false, reason }
    },
  }
}

function throwsOnCommit(nodeId: string, message: string): CommittingExecutor {
  return {
    nodeId,
    async commit(): Promise<CommitOutcome> {
      throw new Error(message)
    },
    async reveal(): Promise<RevealOutcome> {
      return { ok: false, reason: 'unreachable' }
    },
  }
}

function throwsOnReveal(nodeId: string, message: string): CommittingExecutor {
  const inner = new Participant(nodeId, 42)
  return {
    nodeId,
    commit: (t: Task) => inner.commit(t),
    async reveal(): Promise<RevealOutcome> {
      throw new Error(message)
    },
  }
}

function reasonsIn(result: { failures: readonly { nodeId: string; reason: string }[] }): string[] {
  return result.failures.map((f) => `${f.nodeId}: ${f.reason}`)
}

// ---------------------------------------------------------------------------
// The commitment itself
// ---------------------------------------------------------------------------

describe('VER-02 — the commitment hides the answer it binds', () => {
  it('gives two different digests for one answer, because the nonce is secret and fresh', async () => {
    const hashed = await canonicalCid(answerFor(task, 42))
    expect(hashed.ok).toBe(true)
    if (!hashed.ok) return
    const first = await commitmentDigest(drawCeremonyNonce(), task, hashed.cid)
    const second = await commitmentDigest(drawCeremonyNonce(), task, hashed.cid)
    // The whole of the hiding property, in one line. The deleted ceremony's nonce was
    // `nodeId:moduleCid:partitionIndex` — all public — so this assertion would have been
    // false there: anybody could recompute the digest for a guessed answer and check it.
    expect(first).not.toBe(second)
    expect(first).toHaveLength(64)
  })

  it('draws a nonce of the sited width, which is what makes the search infeasible', () => {
    expect(drawCeremonyNonce()).toHaveLength(CEREMONY_NONCE_BYTES)
    // Two draws differing is a weak signal on its own and a strong one against the
    // specific defect that killed the last ceremony: a *derived* nonce is stable.
    expect([...drawCeremonyNonce()]).not.toEqual([...drawCeremonyNonce()])
  })

  it('binds the shard, so one commitment cannot stand in for another shard of the same job', async () => {
    const output = answerFor(task, 42)
    const hashed = await canonicalCid(output)
    expect(hashed.ok).toBe(true)
    if (!hashed.ok) return
    const nonce = drawCeremonyNonce()
    expect(await commitmentDigest(nonce, task, hashed.cid)).not.toBe(
      await commitmentDigest(nonce, otherShard, hashed.cid),
    )
  })

  it('binds the answer, so the same nonce over a different result is a different digest', async () => {
    const a = await canonicalCid(answerFor(task, 42))
    const b = await canonicalCid(answerFor(task, 43))
    expect(a.ok && b.ok).toBe(true)
    if (!a.ok || !b.ok) return
    const nonce = drawCeremonyNonce()
    expect(await commitmentDigest(nonce, task, a.cid)).not.toBe(
      await commitmentDigest(nonce, task, b.cid),
    )
  })
})

// ---------------------------------------------------------------------------
// The refusals — each driven by an executor that really behaves that way
// ---------------------------------------------------------------------------

describe('VER-02 — a reveal that does not reproduce its own commitment is refused', () => {
  it('refuses a replica that reveals a peer answer it did not commit to', async () => {
    // The requirement's own sentence, made into a fixture. `n2` commits to its own
    // answer and then reveals `n1`'s — which is what a replica that has seen a peer's
    // result would do — and the ceremony names it rather than counting it as agreement.
    const honestAnswer = answerFor(task, 42)
    const result = await executeCommitReveal(task, [
      new Participant('n1', 42),
      new Plagiarist('n2', 7, honestAnswer),
    ])
    expect(result.status).toBe('agreed')
    if (result.status !== 'agreed') return
    // The plagiarised answer is *identical* to the honest one, so a post-hoc comparison
    // would have called this two agreeing replicas. It is one replica and one refusal.
    expect(result.replicas).toBe(1)
    expect(result.agreeing.map((r) => r.nodeId)).toEqual(['n1'])
    expect(reasonsIn(result)).toEqual([
      'n2: reveal does not match the commitment n2 published in round 1',
    ])
  })

  it('would have counted that same plagiarist as agreement without the ceremony', async () => {
    // The counterfactual, stated as a measurement rather than as an argument. Both nodes
    // produce byte-identical output when the plagiarist copies, so the *comparison* — the
    // only thing `executeVerified` has — cannot tell them apart. This is why VER-02 is a
    // separate requirement from VER-01, and it is the reading that makes the case above
    // mean something.
    const honestAnswer = answerFor(task, 42)
    const stolen = await canonicalCid(honestAnswer)
    const own = await canonicalCid(answerFor(task, 7))
    expect(stolen.ok && own.ok).toBe(true)
    if (!stolen.ok || !own.ok) return
    const honestCid = await canonicalCid(honestAnswer)
    expect(honestCid.ok).toBe(true)
    if (!honestCid.ok) return
    // Copied output and honest output are the same address; nothing in a comparison
    // distinguishes them.
    expect(stolen.cid.toString()).toBe(honestCid.cid.toString())
    // And the commitment does distinguish them, because it was made over the other one.
    const nonce = drawCeremonyNonce()
    expect(await commitmentDigest(nonce, task, own.cid)).not.toBe(
      await commitmentDigest(nonce, task, stolen.cid),
    )
  })

  it('refuses a replica replaying one commitment across two shards', async () => {
    const replayer = new Replayer('n2')
    // Shard 2 first: the replayer commits honestly here, so this one passes.
    const first = await executeCommitReveal(task, [new Participant('n1', 42), replayer])
    expect(first.status).toBe('agreed')
    if (first.status !== 'agreed') return
    expect(first.replicas).toBe(2)
    // Shard 3, same node, same commitment handed back. The shard is in the preimage, so
    // the digest it published for shard 2 does not check out here.
    const second = await executeCommitReveal(otherShard, [
      new Participant('n1', 42),
      replayer,
    ])
    expect(second.status).toBe('agreed')
    if (second.status !== 'agreed') return
    expect(second.replicas).toBe(1)
    expect(reasonsIn(second)).toEqual([
      'n2: reveal does not match the commitment n2 published in round 1',
    ])
  })

  it('reports insufficient when every reveal fails its own commitment', async () => {
    const stolen = answerFor(task, 999)
    const result = await executeCommitReveal(task, [
      new Plagiarist('n1', 1, stolen),
      new Plagiarist('n2', 2, stolen),
    ])
    expect(result.status).toBe('insufficient')
    if (result.status !== 'insufficient') return
    expect(result.reason).toBe('no reveal matched its commitment')
    expect(reasonsIn(result)).toHaveLength(2)
  })
})

describe('VER-02 — a ceremony refuses the sets it cannot be run over', () => {
  it('refuses a set smaller than the sited floor, naming the floor', async () => {
    const result = await executeCommitReveal(task, [new Participant('n1', 42)])
    expect(result.status).toBe('insufficient')
    if (result.status !== 'insufficient') return
    expect(result.reason).toBe(
      `a commit-reveal ceremony needs at least ${String(MIN_CEREMONY_REPLICAS)} executors, 1 supplied`,
    )
    // Nothing ran. A ceremony that had dispatched and then refused would have spent the
    // CPU it declined to use the answer from.
    expect(result.failures).toEqual([])
  })

  it('refuses an empty set for the same reason rather than a different one', async () => {
    const result = await executeCommitReveal(task, [])
    expect(result.status).toBe('insufficient')
    if (result.status !== 'insufficient') return
    expect(result.reason).toContain('0 supplied')
  })

  it('reports insufficient when nobody commits at all', async () => {
    const result = await executeCommitReveal(task, [
      refusesToCommit('n1', 'over-committed: 4 of 4 slots in use'),
      refusesToCommit('n2', 'over-committed: 4 of 4 slots in use'),
    ])
    expect(result.status).toBe('insufficient')
    if (result.status !== 'insufficient') return
    expect(result.reason).toBe('every executor failed to commit')
    expect(reasonsIn(result)).toEqual([
      'n1: over-committed: 4 of 4 slots in use',
      'n2: over-committed: 4 of 4 slots in use',
    ])
  })
})

describe('VER-02 — a peer dying is degradation, not a job failure', () => {
  it('agrees at one replica when a co-replica never commits, and names the refusal', async () => {
    // The floor is on how many were **asked**, not on how many survived. A floor on the
    // survivors was written here first and turned a mid-job node death — which
    // `fabric-node.node.test.ts` and `two-process.node.test.ts` each stage deliberately —
    // into `insufficient` where the tree had always reported `agreed` at one replica.
    // This case is what holds that line.
    const result = await executeCommitReveal(task, [
      new Participant('n1', 42),
      refusesToCommit('n2', 'dispatch to n2 failed: peer gone'),
    ])
    expect(result.status).toBe('agreed')
    if (result.status !== 'agreed') return
    expect(result.replicas).toBe(1)
    expect(reasonsIn(result)).toEqual(['n2: dispatch to n2 failed: peer gone'])
  })

  it('carries a round-2 refusal into failures rather than losing it on the agreed arm', async () => {
    const result = await executeCommitReveal(task, [
      new Participant('n1', 42),
      refusesToReveal('n2', 'no commitment pending under that name on n2'),
    ])
    expect(result.status).toBe('agreed')
    if (result.status !== 'agreed') return
    expect(result.replicas).toBe(1)
    expect(reasonsIn(result)).toEqual(['n2: no commitment pending under that name on n2'])
  })

  it('converts a throw in either round into that node named, not a rejected ceremony', async () => {
    const onCommit = await executeCommitReveal(task, [
      new Participant('n1', 42),
      throwsOnCommit('n2', 'socket reset'),
    ])
    expect(onCommit.status).toBe('agreed')
    if (onCommit.status !== 'agreed') return
    expect(reasonsIn(onCommit)).toEqual(['n2: commit threw on n2: socket reset'])

    const onReveal = await executeCommitReveal(task, [
      new Participant('n1', 42),
      throwsOnReveal('n2', 'stream closed'),
    ])
    expect(onReveal.status).toBe('agreed')
    if (onReveal.status !== 'agreed') return
    expect(reasonsIn(onReveal)).toEqual(['n2: reveal threw on n2: stream closed'])
  })
})

// ---------------------------------------------------------------------------
// The barrier
// ---------------------------------------------------------------------------

describe('VER-02 — the barrier holds: nobody reveals while an answer is still unfixed', () => {
  /**
   * Structural, so there is no branch to plant — and therefore this is the one claim in
   * the file whose instrument had to be proved a different way.
   *
   * It was: one line — `await executor.reveal(outcome.handle)` — inserted into round 1's
   * map immediately after the commit returns, which is the interleaving somebody writes
   * when they do not know why the barrier is there. **Watched red on
   * `AssertionError: expected 3 to be greater than 4`** (2026-08-11), which reads as the
   * first `reveal:` entering the log at index 3 while the last `commit:` did not leave
   * until index 4 — the reveal of the fast node happening while the slow node's answer
   * was still unfixed, which is precisely the disclosure the ceremony exists to prevent.
   * Restored by the inverse of that one insertion and verified byte-identical against a
   * snapshot taken immediately before planting; the case is green.
   *
   * That text is the *observed* output and not a prediction, which matters here more than
   * usual: `mutation-ledger.ts`'s whole argument is that a signature somebody expected is
   * not evidence that anything saw anything.
   */
  it('enters no reveal until every commit has returned', async () => {
    const log: string[] = []
    const result = await executeCommitReveal(task, [
      new Participant('n1', 42, log),
      // The slow node. Without it, an interleaved implementation can still order
      // correctly by luck of microtask scheduling — see {@link Participant} on why the
      // delay is the instrument rather than noise.
      new Participant('n2', 42, log, 5),
    ])
    expect(result.status).toBe('agreed')
    const lastCommit = log.lastIndexOf('commit:n2:leave')
    const firstReveal = log.findIndex((entry) => entry.startsWith('reveal:'))
    expect(lastCommit).toBeGreaterThanOrEqual(0)
    expect(firstReveal).toBeGreaterThan(lastCommit)
    // The stronger form, and the one that catches an interleaving that happens to order
    // correctly by luck of scheduling: every commit precedes every reveal.
    const commits = log.filter((entry) => entry.startsWith('commit:'))
    expect(log.slice(0, commits.length)).toEqual(commits)
  })

  it('holds the barrier even when one node refuses, because the round still settles', async () => {
    const log: string[] = []
    const result = await executeCommitReveal(task, [
      new Participant('n1', 42, log),
      refusesToReveal('n2', 'nothing to give back', log),
    ])
    expect(result.status).toBe('agreed')
    const commits = log.filter((entry) => entry.startsWith('commit:'))
    expect(log.slice(0, commits.length)).toEqual(commits)
  })
})

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

describe('VER-02 — the ceremony composes with what already verifies', () => {
  it('returns the shape executeVerified returns, so nothing downstream can tell which ran', async () => {
    const result = await executeCommitReveal(task, [
      new Participant('n1', 42),
      new Participant('n2', 42),
    ])
    expect(result.status).toBe('agreed')
    if (result.status !== 'agreed') return
    const hashed = await canonicalCid(answerFor(task, 42))
    expect(hashed.ok).toBe(true)
    if (!hashed.ok) return
    expect(result.resultCid.toString()).toBe(hashed.cid.toString())
    expect(result.replicas).toBe(2)
    expect(result.grossFuel).toBe(200)
    expect(result.usefulFuel).toBe(100)
    // The attestation rides on the agreeing entry, so `attestationReceipt` and
    // `classifyAttestation` read this result exactly as they read the other one.
    expect(result.agreeing).toEqual([
      { nodeId: 'n1', attestation: 'signed-by-nobody' },
      { nodeId: 'n2', attestation: 'signed-by-nobody' },
    ])
  })

  it('reports disagreement rather than voting on it, which is VER-01 unchanged', async () => {
    const result = await executeCommitReveal(task, [
      new Participant('n1', 42),
      new Participant('n2', 42),
      new Participant('n3', 7),
    ])
    expect(result.status).toBe('disagreed')
    if (result.status !== 'disagreed') return
    expect(result.partitions).toHaveLength(2)
    expect(result.partitions.flatMap((p) => p.nodes).sort()).toEqual(['n1', 'n2', 'n3'])
  })
})

describe('VER-02 — which executors the ceremony is selected for', () => {
  it('says yes to an object that speaks both rounds and no to one that speaks neither', () => {
    const kernelShaped: Executor = {
      nodeId: 'local',
      async execute() {
        return { ok: true, output: null, fuelUsed: 0, attestation: 'signed-by-nobody' }
      },
    }
    expect(isCommitting(kernelShaped)).toBe(false)
    // `RemoteExecutor` is the production case and lives in `@o2/net`; asserting it from
    // here would import a package this one does not depend on. The shape is asserted
    // instead, and `packages/net/src/commit-reveal-wire.test.ts` asserts the real class.
    const bothRounds = new Participant('n1', 42) as unknown as Executor
    expect(isCommitting(bothRounds)).toBe(true)
  })

  it('says no to an object carrying only one of the two rounds', () => {
    // Half a participant is not a participant. A structural predicate that accepted this
    // would put a node into a ceremony it cannot finish, and the ceremony would report
    // the resulting `undefined is not a function` as that node's failure — a refusal
    // naming the wrong thing.
    const halfway = { nodeId: 'n1', async execute() { return { ok: false as const, reason: 'x' } }, async commit() { return { ok: false as const, reason: 'x' } } }
    expect(isCommitting(halfway as unknown as Executor)).toBe(false)
  })
})
