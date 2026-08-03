/**
 * The verification primitive's own tests — VER-01, VER-05, VER-06.
 *
 * `executeVerified` is where the public-data half of the integrity claim is
 * actually decided; every other layer either calls it (`submitJob`,
 * `sovereign-execution`) or restates its rule in its own words (`executeReduce`,
 * `coordinator`). It had no test file of its own: its behaviour was asserted from
 * `submit.test.ts`, the test file of its caller, so the primitive's contract and
 * its caller's contract could only be read — and only fail — together.
 *
 * Two things are deliberately NOT tested here.
 *
 *   - **No commit-reveal ceremony.** There is none in the source, by ruling
 *     (`855cdf5`), and the module docstring gives the measurement that justified
 *     deleting it. Testing a seam that does not exist would restore the inventory
 *     the deletion removed.
 *   - **No plagiarism resistance (VER-02).** The requestor holds every executor in
 *     one process and calls them itself, so nothing here can stop a replica copying
 *     a peer's answer. That is a two-round cross-node protocol which does not exist
 *     yet; a test asserting it from this side would be asserting a guarantee the
 *     code does not make.
 */

import { ed25519 } from '@noble/curves/ed25519.js'
import { describe, expect, it } from 'vitest'
import { CID } from 'multiformats/cid'
import { canonicalCid } from '../canonical/encode.ts'
import type { CanonicalValue } from '../canonical/encode.ts'
import { toHex } from '../capability.ts'
import type { PublicKeyHex } from '../capability.ts'
import { EnrollmentAuthority, requestEnrollment } from '../enrollment.ts'
import { attestResults } from '../executor/attesting-executor.ts'
import type { Executor, ExecutionOutcome, Task } from '../ports.ts'
import { verifyResultAttestation } from '../result-attestation.ts'
import type { ResultWork } from '../result-attestation.ts'
import { executeVerified } from './verify.ts'

const MODULE_CID = CID.parse('bafyreidykglsfhoixmivffc5uwhcgshx4j465xwqntbmu43nb2dzqwfvae')

const task: Task = {
  moduleCid: MODULE_CID,
  inputCid: MODULE_CID,
  partitionIndex: 2,
  partitionCount: 4,
}

/** Deterministic and honest: the same task always produces the same output. */
function honest(nodeId: string, fuelUsed = 100): Executor {
  return {
    nodeId,
    async execute(t: Task): Promise<ExecutionOutcome> {
      return { ok: true, output: { shard: t.partitionIndex, of: t.partitionCount, sum: 42 }, fuelUsed, attestation: 'signed-by-nobody' }
    },
  }
}

/** Answers, and what it answers is wrong. `sum` is what diverges. */
function liar(nodeId: string, sum: number): Executor {
  return {
    nodeId,
    async execute(t: Task): Promise<ExecutionOutcome> {
      return { ok: true, output: { shard: t.partitionIndex, of: t.partitionCount, sum }, fuelUsed: 100, attestation: 'signed-by-nobody' }
    },
  }
}

/** Answers that it could not do the work — the port's own failure value. */
function failing(nodeId: string, reason: string): Executor {
  return {
    nodeId,
    async execute(): Promise<ExecutionOutcome> {
      return { ok: false, reason }
    },
  }
}

/** A foreign implementation that breaks rather than answering. */
function throwing(nodeId: string, message: string): Executor {
  return {
    nodeId,
    async execute(): Promise<ExecutionOutcome> {
      throw new Error(message)
    },
  }
}

/**
 * One provider, and the nodes it enrolled — the fixture the attestation cases need.
 *
 * A real `EnrollmentAuthority` rather than a hand-built certificate, so a signature
 * these cases accept is one `verifyResultAttestation` accepts against a pinned issuer
 * with nothing stubbed between the two.
 */
const PROVIDER = new Uint8Array(32).fill(70)
const PROVIDER_KEY: PublicKeyHex = toHex(ed25519.getPublicKey(PROVIDER))
const OWNER = new Uint8Array(32).fill(71)
const PINNED: ReadonlySet<PublicKeyHex> = new Set([PROVIDER_KEY])
const ISSUED_AT = 1_800_000_000_000

/** Wrap `inner` so it signs what it produced, as a node this provider enrolled. */
function attesting(inner: Executor, seed: number): { executor: Executor; nodeKey: PublicKeyHex } {
  const nodeSeed = new Uint8Array(32).fill(seed)
  const issued = new EnrollmentAuthority({
    providerPrivateKey: PROVIDER,
    maxPerWindow: 50,
    maxIssuedPerWindow: 'issues-without-an-aggregate-budget',
    issuance: 'remembers-only-within-this-process',
  }).enrol(
    requestEnrollment(nodeSeed, OWNER, {
      operatorId: `op-${inner.nodeId}`,
      discoverability: 'via-relay',
      relayIds: ['relay-1'],
    }),
    ISSUED_AT,
  )
  if (!issued.ok) throw new Error('fixture failed to enrol')
  return {
    executor: attestResults(inner, { nodeSeed, certificate: issued.certificate }),
    nodeKey: issued.certificate.nodeKey,
  }
}

/** The work `honest` answers, as a verifier of an attestation rebuilds it. */
async function workFor(output: CanonicalValue): Promise<ResultWork> {
  const hashed = await canonicalCid(output)
  if (!hashed.ok) throw new Error('fixture output failed to encode')
  return {
    moduleCid: task.moduleCid,
    inputCid: task.inputCid,
    partitionIndex: task.partitionIndex,
    outputCid: hashed.cid,
  }
}

/** Produces a value the canonical codec refuses — a NaN can never be hashed. */
function nanProducer(nodeId: string): Executor {
  return {
    nodeId,
    async execute(): Promise<ExecutionOutcome> {
      return { ok: true, output: { mean: Number.NaN } as CanonicalValue, fuelUsed: 100, attestation: 'signed-by-nobody' }
    },
  }
}

describe('what an agreement claims', () => {
  it('treats a lone executor as verification off, and reports the redundancy it actually achieved', async () => {
    // VER-06. R=1 is a legitimate configuration, not a degenerate one — but the
    // result must never read as if it had been verified, so `replicas` is the
    // number that answered rather than the number that was asked for.
    const r = await executeVerified(task, [honest('solo')])
    expect(r.status).toBe('agreed')
    if (r.status === 'agreed') {
      expect(r.replicas).toBe(1)
      expect(r.agreeing.map((e) => e.nodeId)).toEqual(['solo'])
    }
  })

  it('names every executor that answered, and nobody else', async () => {
    // B01 was a forged quorum: a peer answered a request it was never sent and
    // appeared in `agreeing` while the honest node's result never did. A name in
    // this list is a claim that that node ran this task and produced this result,
    // so it is derived from the answers, never from the list of nodes asked.
    const r = await executeVerified(task, [honest('a'), failing('b', 'oom'), honest('c')])
    expect(r.status).toBe('agreed')
    if (r.status === 'agreed') {
      expect(r.agreeing.map((e) => e.nodeId)).toEqual(['a', 'c'])
      expect(r.replicas).toBe(2)
    }
  })

  it('reports a CID that addresses the output it reports', async () => {
    // `submitJob` persists an agreed shard by re-encoding `output` and storing the
    // bytes; the block is then retrievable under whatever `resultCid` said. If the
    // two could drift apart, a result would be announced under one address and
    // stored at another, and nobody fetching it would find anything.
    const r = await executeVerified(task, [honest('a'), honest('b')])
    expect(r.status).toBe('agreed')
    if (r.status === 'agreed') {
      const rehashed = await canonicalCid(r.output)
      expect(rehashed.ok).toBe(true)
      if (rehashed.ok) expect(r.resultCid.toString()).toBe(rehashed.cid.toString())
    }
  })

  it('gives every replica the identical task, exactly once each', async () => {
    // The comparison means nothing unless the thing compared was computed from the
    // same question. Redundancy is also real work, not a cached first answer —
    // short-circuiting once one executor replies would turn R=3 into R=1 silently.
    const seen: { nodeId: string; task: Task }[] = []
    const recorder = (nodeId: string): Executor => ({
      nodeId,
      async execute(t: Task): Promise<ExecutionOutcome> {
        seen.push({ nodeId, task: t })
        return { ok: true, output: { sum: 42 }, fuelUsed: 100, attestation: 'signed-by-nobody' }
      },
    })

    const r = await executeVerified(task, [recorder('a'), recorder('b'), recorder('c')])
    expect(r.status).toBe('agreed')
    expect(seen.map((s) => s.nodeId)).toEqual(['a', 'b', 'c'])
    for (const s of seen) {
      expect(s.task.moduleCid.toString()).toBe(MODULE_CID.toString())
      expect(s.task.inputCid.toString()).toBe(MODULE_CID.toString())
      expect(s.task.partitionIndex).toBe(2)
      expect(s.task.partitionCount).toBe(4)
    }
  })
})

/**
 * VER-08, VER-09, VER-10 — the agreeing set says who **signed**, not only who answered.
 *
 * Until this arm carried attestations, a receipt computed over an agreement was worth
 * the submitter's own word about itself: the submitter chose the node ids, held every
 * executor and minted the whole record. These cases are about the *shape* reaching a
 * reader. Every executor a running fabric composes still reports the sentinel, because
 * nothing wires the signing wrapper yet, so the signed readings here compose it
 * themselves.
 */
describe('an agreement says what each replica signed', () => {
  it('hands a reader a statement it can check without trusting the requestor', async () => {
    const a = attesting(honest('a'), 1)
    const r = await executeVerified(task, [a.executor])
    expect(r.status).toBe('agreed')
    if (r.status !== 'agreed') return

    const [entry] = r.agreeing
    expect(entry?.nodeId).toBe('a')
    if (entry === undefined) return

    // Rebuilt from the caller's own view of the work — `r.output` and the task it
    // asked for — never from anything the attestation carries.
    const checked = verifyResultAttestation(entry.attestation, await workFor(r.output), PINNED, ISSUED_AT)
    expect(checked.ok).toBe(true)
    if (!checked.ok) return
    expect(checked.certificate.nodeKey).toBe(a.nodeKey)
    expect(checked.certificate.issuer).toBe(PROVIDER_KEY)
  })

  it('gives every entry the attestation of the node that entry names', async () => {
    // The reading that justifies one field instead of two. A sibling `attestations`
    // array beside `agreeing` would correspond to it only positionally, and a
    // positional correspondence can drift with nothing able to notice. Here the two
    // halves come off one array in one expression, so this case is what fails if the
    // ids and the signatures are ever assembled separately.
    const a = attesting(honest('a'), 1)
    const c = attesting(honest('c'), 3)
    // `b` is a replica nobody enrolled. The sentinel is its truthful statement, not a
    // degraded reading of a signature that failed.
    const r = await executeVerified(task, [a.executor, honest('b'), c.executor])
    expect(r.status).toBe('agreed')
    if (r.status !== 'agreed') return

    expect(r.agreeing.map((e) => e.nodeId)).toEqual(['a', 'b', 'c'])
    const work = await workFor(r.output)
    const signers = new Map<string, PublicKeyHex>([
      ['a', a.nodeKey],
      ['c', c.nodeKey],
    ])
    for (const entry of r.agreeing) {
      const expected = signers.get(entry.nodeId)
      if (expected === undefined) {
        expect(entry.attestation).toBe('signed-by-nobody')
        continue
      }
      expect(entry.attestation).not.toBe('signed-by-nobody')
      if (entry.attestation === 'signed-by-nobody') continue
      // The certificate this entry carries names this entry's node, and the signature
      // checks out under it.
      expect(entry.attestation.certificate.nodeKey).toBe(expected)
      expect(verifyResultAttestation(entry.attestation, work, PINNED, ISSUED_AT).ok).toBe(true)
    }
  })

  it('puts no signature on a disagreement, so nobody can pick a winner out of them', async () => {
    // Asserted as an absence by shape rather than left to a reading that would pass
    // either way. Attestations on a disagreement would invite somebody to choose the
    // side with the better-signed nodes, which is precisely what this module's header
    // forbids: divergence is surfaced, never voted away.
    const a = attesting(honest('a'), 1)
    const c = attesting(liar('c', 999), 3)
    const r = await executeVerified(task, [a.executor, c.executor])
    expect(r.status).toBe('disagreed')
    if (r.status !== 'disagreed') return

    expect(r.partitions).toHaveLength(2)
    for (const partition of r.partitions) {
      expect(Object.keys(partition).sort()).toEqual(['nodes', 'resultCid'])
      for (const node of partition.nodes) expect(typeof node).toBe('string')
    }
  })
})

/**
 * VER-05 — what is compared is the content address of `(task, output)`, nothing
 * else. Each case below differs in something a plausible implementation might have
 * folded into the digest, and must agree anyway: folding any of them in would make
 * every honest redundant execution disagree, and the disagreement would be
 * misdiagnosed as nondeterminism in the guest.
 */
describe('what is compared covers (task, output) only', () => {
  it('does not compare node identity — two unrelated node ids with one answer still agree', async () => {
    const first = honest('12D3KooWHPSVMPEezVCXvka2ahwT26JGL8EBr61LpGEU3ujHQM9Q')
    const second = honest('a-node-id-sharing-nothing-with-the-first')
    const r = await executeVerified(task, [first, second])
    expect(r.status).toBe('agreed')
    if (r.status === 'agreed') expect(r.replicas).toBe(2)
  })

  it('does not compare fuel — a replica that burned 1000× more still agrees', async () => {
    const r = await executeVerified(task, [honest('slow', 99999), honest('fast', 1)])
    expect(r.status).toBe('agreed')
  })

  it('makes the redundancy tax readable as the difference between gross and useful fuel', async () => {
    // VER-06's cost, and the number `submitJob` divides to publish a verification
    // multiplier. Gross is every replica that answered; useful is the single run
    // whose output is the answer, so the tax is what redundancy cost over running
    // once. Honest replicas of a deterministic task burn identical fuel — fuel is
    // an instruction count, not a wall clock — so `usefulFuel` being taken from the
    // first answering replica is not a choice between different numbers here.
    const r = await executeVerified(task, [honest('a'), honest('b'), honest('c')])
    expect(r.status).toBe('agreed')
    if (r.status === 'agreed') {
      expect(r.grossFuel).toBe(300)
      expect(r.usefulFuel).toBe(100)
      expect(r.grossFuel - r.usefulFuel).toBe(200)
    }
  })
})

describe('disagreement is surfaced, never voted away (VER-01)', () => {
  it('reports a two-against-one split as a disagreement, not as a two-to-one win', async () => {
    // The property this module exists to guarantee, and the one most likely to be
    // "fixed" by someone who thinks the majority is obviously the answer. A
    // majority is evidence about how many nodes said something, not evidence that
    // what they said is right — and the case where the two collude is exactly the
    // case worth detecting. Both sides are named so the caller can act.
    const r = await executeVerified(task, [honest('a'), honest('b'), liar('c', 999)])
    expect(r.status).toBe('disagreed')
    if (r.status === 'disagreed') {
      expect(r.partitions).toHaveLength(2)
      expect(r.partitions.map((p) => [...p.nodes]).sort((x, y) => y.length - x.length)).toEqual([
        ['a', 'b'],
        ['c'],
      ])
    }
  })

  it('reports three different answers as three partitions, each naming who gave it', async () => {
    const r = await executeVerified(task, [honest('a'), liar('b', 1), liar('c', 2)])
    expect(r.status).toBe('disagreed')
    if (r.status === 'disagreed') {
      expect(r.partitions).toHaveLength(3)
      expect(r.partitions.flatMap((p) => [...p.nodes]).sort()).toEqual(['a', 'b', 'c'])
      // Distinct answers get distinct addresses; a grouping keyed on anything
      // coarser would merge two disagreeing nodes into one apparent agreement.
      expect(new Set(r.partitions.map((p) => p.resultCid)).size).toBe(3)
    }
  })

  it('names a replica that failed alongside the split rather than folding it into one side', async () => {
    // A node that could not run the task said nothing about the answer, so it
    // belongs in neither partition — but dropping it would leave the caller
    // reading a 2-way split among four nodes and unable to see that one of them
    // never got as far as an answer.
    const r = await executeVerified(task, [honest('a'), honest('b'), liar('c', 999), failing('d', 'oom')])
    expect(r.status).toBe('disagreed')
    if (r.status === 'disagreed') {
      expect(r.partitions.flatMap((p) => [...p.nodes]).sort()).toEqual(['a', 'b', 'c'])
      expect(r.failures).toEqual([{ nodeId: 'd', reason: 'oom' }])
    }
  })
})

describe('a replica that could not answer is that replica failing, not divergence', () => {
  it('does not turn one executor’s failure into a disagreement among the rest', async () => {
    const r = await executeVerified(task, [honest('a'), failing('b', 'oom')])
    expect(r.status).toBe('agreed')
    if (r.status === 'agreed') {
      expect(r.agreeing.map((e) => e.nodeId)).toEqual(['a'])
      expect(r.replicas).toBe(1)
    }
  })

  it('carries each failed node’s own reason, not a shared one', async () => {
    // The reasons are the whole diagnostic value of an insufficient result: "both
    // nodes failed" is not actionable, "one ran out of memory and one was refused
    // admission" is.
    const r = await executeVerified(task, [failing('a', 'out of memory'), failing('b', 'module not admitted')])
    expect(r.status).toBe('insufficient')
    if (r.status === 'insufficient') {
      expect(r.failures).toEqual([
        { nodeId: 'a', reason: 'out of memory' },
        { nodeId: 'b', reason: 'module not admitted' },
      ])
    }
  })

  it('does not let a replica that throws discard its co-replica’s completed work', async () => {
    // An `Executor` is foreign code and can break instead of returning the port's
    // failure value. If that rejection escaped, `Promise.all` would abandon every
    // sibling's finished result along with it — one node's collapse would cost the
    // whole shard.
    const r = await executeVerified(task, [honest('good'), throwing('bad', 'blockstore ENOSPC')])
    expect(r.status).toBe('agreed')
    if (r.status === 'agreed') {
      expect(r.agreeing.map((e) => e.nodeId)).toEqual(['good'])
      expect(r.replicas).toBe(1)
    }
  })

  it('reports a thrown error as that node failing, with what it threw', async () => {
    const r = await executeVerified(task, [throwing('bad', 'blockstore ENOSPC')])
    expect(r.status).toBe('insufficient')
    if (r.status === 'insufficient') {
      expect(r.failures).toHaveLength(1)
      expect(r.failures[0]?.nodeId).toBe('bad')
      expect(r.failures[0]?.reason).toContain('bad')
      expect(r.failures[0]?.reason).toContain('blockstore ENOSPC')
    }
  })

  it('treats an output the codec refuses as that node failing, not as divergence', async () => {
    // A NaN cannot be encoded, so it can never reach a comparison at all. Reporting
    // it as divergence would accuse two nodes of disagreeing about a value that was
    // never hashed.
    const r = await executeVerified(task, [honest('a'), nanProducer('b')])
    expect(r.status).toBe('agreed')
    if (r.status === 'agreed') {
      expect(r.agreeing.map((e) => e.nodeId)).toEqual(['a'])
    }
  })

  it('says the output was unencodable, so a NaN is not misread as a dead node', async () => {
    // The two are fixed in completely different places — one is the guest's
    // arithmetic, the other is the node. The reason carries the codec's own error,
    // including the path to the offending field, because that is what tells a task
    // author which value went non-finite.
    const r = await executeVerified(task, [nanProducer('b')])
    expect(r.status).toBe('insufficient')
    if (r.status === 'insufficient') {
      expect(r.failures[0]?.nodeId).toBe('b')
      expect(r.failures[0]?.reason).toContain('not encodable')
      expect(r.failures[0]?.reason).toContain('non-finite-float')
      expect(r.failures[0]?.reason).toContain('mean')
    }
  })
})

describe('nothing to verify', () => {
  it('distinguishes having asked nobody from everybody asked having failed', async () => {
    // Same status, and they are not the same event: one is a placement that found
    // no node, the other is a fabric that ran and could not produce an answer. A
    // caller reading only `status` would retry the second and loop forever on the
    // first.
    const asked = await executeVerified(task, [failing('a', 'oom')])
    const none = await executeVerified(task, [])
    expect(none.status).toBe('insufficient')
    expect(asked.status).toBe('insufficient')
    if (none.status === 'insufficient' && asked.status === 'insufficient') {
      expect(none.reason).not.toBe(asked.reason)
      // Nobody was asked, so there is no node to blame for anything.
      expect(none.failures).toEqual([])
      expect(asked.failures).toEqual([{ nodeId: 'a', reason: 'oom' }])
    }
  })
})
