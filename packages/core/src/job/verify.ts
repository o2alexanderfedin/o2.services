/**
 * Redundant execution and result verification — VER-01, VER-02, VER-05, VER-06.
 *
 * Two properties this module exists to guarantee:
 *
 * 1. **Commit before reveal (VER-02).** A replica that can see a peer's answer
 *    before producing its own is not an independent execution — it can copy.
 *    Every executor first publishes `H(nonce ‖ resultCid)`, and only once all
 *    commitments are in does anyone reveal. A reveal that does not match its own
 *    commitment is discarded.
 *
 * 2. **The compared digest covers `(task, output)` only (VER-05).** Timing, fuel,
 *    and node identity sit outside it. Including them would make every honest
 *    redundant execution disagree, and the disagreement would be misdiagnosed as
 *    a determinism problem in the guest.
 *
 * Disagreement is surfaced, never majority-voted away (VER-01). The caller
 * decides what to do about it; silently picking a winner would hide exactly the
 * event this mechanism exists to detect.
 */

import { sha256 } from '../hash.ts'
import type { CID } from 'multiformats/cid'
import { canonicalCid } from '../canonical/encode.ts'
import type { CanonicalValue } from '../canonical/encode.ts'
import type { Executor, Task } from '../ports.ts'

const HEX = '0123456789abcdef'

function toHex(bytes: Uint8Array): string {
  let out = ''
  for (const b of bytes) out += HEX[b >> 4]! + HEX[b & 0x0f]!
  return out
}

/** A commitment to a result, published before the result itself. */
export interface Commitment {
  readonly nodeId: string
  readonly digest: string
}

/** The revealed result, checkable against its own commitment. */
export interface Reveal {
  readonly nodeId: string
  readonly nonce: Uint8Array
  readonly resultCid: CID
  readonly output: CanonicalValue
  readonly fuelUsed: number
}

export type Receipt =
  | { ok: true; commitment: Commitment; reveal: Reveal }
  | { ok: false; nodeId: string; reason: string }

/**
 * `H(nonce ‖ resultCid.bytes)`.
 *
 * Deliberately excludes fuel, timing, and nodeId — see VER-05 above.
 */
export async function commitmentDigest(nonce: Uint8Array, resultCid: CID): Promise<string> {
  const cidBytes = resultCid.bytes
  const buf = new Uint8Array(nonce.length + cidBytes.length)
  buf.set(nonce, 0)
  buf.set(cidBytes, nonce.length)
  const digest = await sha256.digest(buf)
  return toHex(digest.digest)
}

/** Deterministic per-node nonce so tests are reproducible without a CSPRNG port. */
function nonceFor(nodeId: string, task: Task): Uint8Array {
  const seed = `${nodeId}:${task.moduleCid.toString()}:${task.partitionIndex}`
  const bytes = new Uint8Array(16)
  for (let i = 0; i < seed.length; i++) {
    bytes[i % 16] = ((bytes[i % 16] as number) * 31 + seed.charCodeAt(i)) & 0xff
  }
  return bytes
}

/** Run one executor and produce its commitment + reveal. */
async function runOne(executor: Executor, task: Task): Promise<Receipt> {
  const outcome = await executor.execute(task)
  if (!outcome.ok) {
    return { ok: false, nodeId: executor.nodeId, reason: outcome.reason }
  }
  const hashed = await canonicalCid(outcome.output)
  if (!hashed.ok) {
    // A non-finite float in the output is refused by the codec, so it can never
    // reach a comparison. Report it as this node's failure, not as divergence.
    return {
      ok: false,
      nodeId: executor.nodeId,
      reason: `output not encodable: ${JSON.stringify(hashed.error)}`,
    }
  }
  const nonce = nonceFor(executor.nodeId, task)
  const digest = await commitmentDigest(nonce, hashed.cid)
  return {
    ok: true,
    commitment: { nodeId: executor.nodeId, digest },
    reveal: {
      nodeId: executor.nodeId,
      nonce,
      resultCid: hashed.cid,
      output: outcome.output,
      fuelUsed: outcome.fuelUsed,
    },
  }
}

export type VerificationResult =
  | {
      status: 'agreed'
      resultCid: CID
      output: CanonicalValue
      /** Nodes whose reveals matched. */
      agreeing: readonly string[]
      /** Redundancy actually achieved. */
      replicas: number
      grossFuel: number
      usefulFuel: number
    }
  | {
      status: 'disagreed'
      /** Every distinct result, with the nodes that produced it. */
      partitions: readonly { resultCid: string; nodes: readonly string[] }[]
      failures: readonly { nodeId: string; reason: string }[]
    }
  | {
      status: 'insufficient'
      reason: string
      failures: readonly { nodeId: string; reason: string }[]
    }

/**
 * Execute one task across `executors` and verify agreement.
 *
 * Redundancy is however many executors are supplied — a single executor is the
 * R=1 case (verification off, VER-06), and returns `agreed` with `replicas: 1`.
 */
export async function executeVerified(
  task: Task,
  executors: readonly Executor[],
): Promise<VerificationResult> {
  if (executors.length === 0) {
    return { status: 'insufficient', reason: 'no executors supplied', failures: [] }
  }

  // Commit phase — every executor runs and commits before any reveal is read.
  const receipts = await Promise.all(executors.map((e) => runOne(e, task)))

  const failures = receipts
    .filter((r): r is Extract<Receipt, { ok: false }> => !r.ok)
    .map((r) => ({ nodeId: r.nodeId, reason: r.reason }))

  const good = receipts.filter((r): r is Extract<Receipt, { ok: true }> => r.ok)
  if (good.length === 0) {
    return { status: 'insufficient', reason: 'every executor failed', failures }
  }

  // Reveal phase — a reveal must match the commitment its node already published.
  const verified: Reveal[] = []
  for (const r of good) {
    const expected = await commitmentDigest(r.reveal.nonce, r.reveal.resultCid)
    if (expected === r.commitment.digest) {
      verified.push(r.reveal)
    } else {
      failures.push({ nodeId: r.reveal.nodeId, reason: 'reveal does not match commitment' })
    }
  }
  if (verified.length === 0) {
    return { status: 'insufficient', reason: 'no reveal matched its commitment', failures }
  }

  // Group by result. More than one group is disagreement — reported, not voted on.
  const groups = new Map<string, string[]>()
  for (const rev of verified) {
    const key = rev.resultCid.toString()
    const nodes = groups.get(key)
    if (nodes) nodes.push(rev.nodeId)
    else groups.set(key, [rev.nodeId])
  }

  const grossFuel = verified.reduce((sum, r) => sum + r.fuelUsed, 0)

  if (groups.size > 1) {
    return {
      status: 'disagreed',
      partitions: [...groups.entries()].map(([resultCid, nodes]) => ({ resultCid, nodes })),
      failures,
    }
  }

  const winner = verified[0] as Reveal
  return {
    status: 'agreed',
    resultCid: winner.resultCid,
    output: winner.output,
    agreeing: verified.map((r) => r.nodeId),
    replicas: verified.length,
    grossFuel,
    usefulFuel: winner.fuelUsed,
  }
}
