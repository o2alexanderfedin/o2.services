/**
 * Host side of the colouring job: build the shard input, read a shard's partial,
 * and pick an answer out of a completed job.
 *
 * Every shard of a job receives the *same* input block. That is not a simplification
 * — it is what makes the job cheap to distribute: one block, content-addressed once,
 * fetched by every node from whoever is nearest. Shards differ only by what
 * `partition()` tells the guest, which costs zero bytes on the wire.
 *
 * Pure module: no platform imports. `@o2/core` is portable by the same rule.
 */

import type { CanonicalValue, ShardResult } from '@o2/core'
import { CID } from 'multiformats/cid'
import { assignmentOrder, enumerateTriples } from './triples.ts'
import type { Triple } from './triples.ts'

/**
 * Largest bound the guest's fixed memory layout supports.
 *
 * The kernel declares `initial === maximum` memory, so this is a hard property of
 * the artifact rather than a configuration knob: an input above it is rejected by
 * the guest with an honest "unknown", never by growing memory that might grow
 * differently elsewhere.
 */
export const MAX_N: number = 8192

/**
 * Width of the packed colouring field, in bytes — always this, whatever `n` is.
 *
 * 1024 bytes covers every value up to 8192, so the DAG-CBOR length prefix is the
 * same three bytes on every shard of every job. A variable-width field would force
 * the guest to branch on magnitude to keep the encoding minimal, and strict DAG-CBOR
 * refuses a non-minimal encoding.
 */
export const COLOURING_BYTES: number = 1024

/**
 * Backtracking steps a shard may spend before returning "unknown".
 *
 * Five million caps a shard at roughly 75 ms — short enough that a visitor's tab stays
 * responsive and a straggler is cheap to abandon. Measured on this kernel with this
 * budget, the reachable bound grows with the number of cubes: 300 with one, 500 with
 * eight, 600 with 256. Raising the budget instead of the participant count is the
 * losing move — the cost per shard is linear in it while the search tree is not.
 *
 * The budget travels in the input rather than living on the node, so two machines
 * running the same shard stop at the same step. That is what makes "unknown" a
 * deterministic, comparable answer instead of a race against a clock — a timeout
 * would make honest nodes disagree, and disagreement is the one signal this fabric
 * cannot afford to render meaningless.
 */
export const DEFAULT_BUDGET: number = 5_000_000

/** What a shard reports back. */
export type PartialStatus =
  /** Proof: this cube contains no valid colouring. Search was completed. */
  | 'exhausted'
  /** A colouring, in `bits`. */
  | 'found'
  /** Budget reached. Nothing is claimed either way. */
  | 'budget'

export interface ShardPartial {
  readonly status: PartialStatus
  /** Packed colouring, bit `v-1` for value `v`. All zero unless `status` is 'found'. */
  readonly bits: Uint8Array
}

/**
 * Payload layout the guest expects. Bumped when the layout changes; the guest refuses
 * anything else with an honest "unknown" rather than misreading it.
 */
export const INPUT_VERSION: number = 2

/**
 * Ceiling on the triple count the guest will accept, so its address arithmetic cannot
 * wrap on a malformed block. `MAX_N` yields 9971 triples; 20000 is a comfortable
 * bound that still keeps every offset far inside the guest's fixed memory.
 */
export const MAX_TRIPLES: number = 20_000

/**
 * The shard input, little-endian throughout and read by the guest with align=1
 * (the payload begins at a CBOR header boundary, so nothing in it is naturally
 * aligned). `submitJob` wraps this in DAG-CBOR as a byte string; the guest skips
 * that header.
 *
 *   off 0    u32   n
 *   off 4    u32   budget
 *   off 8    u32   tripleCount            T
 *   off 12   T × { u16 a, u16 b, u16 c }  ascending by c
 *            u32   version                = INPUT_VERSION
 *            n × u16   order              assignment order, most-constrained first
 *            (n+2) × u32  csrOffset       csrOffset[v]..csrOffset[v+1] index csrIndex
 *            3T × u16  csrIndex           triple indices, grouped by value
 *
 * The first three fields and the triple table stay exactly where version 1 put them;
 * everything the reordering needs is appended. That keeps the diff readable and keeps
 * a v1 block distinguishable from a truncated v2 one.
 *
 * The order and the value→triples index are computed host-side rather than in the
 * guest for the same reason the triples are: they are a deterministic function of `n`
 * that every node would otherwise recompute identically, and getting them wrong is
 * caught by the verifier rather than believed. Shipping them costs bytes on a block
 * that is fetched once and shared by every shard.
 *
 * At `MAX_N` the whole payload is about 165 KiB, which is what sizes the guest's
 * fixed memory.
 */
export function buildInput(n: number, budget: number): Uint8Array<ArrayBuffer> {
  const triples = enumerateTriples(n)
  const order = assignmentOrder(n)
  const count = triples.length

  // CSR over values: every triple appears three times, once under each member.
  const perValue: number[] = new Array<number>(n + 2).fill(0)
  for (const { a, b, c } of triples) {
    perValue[a] = (perValue[a] ?? 0) + 1
    perValue[b] = (perValue[b] ?? 0) + 1
    perValue[c] = (perValue[c] ?? 0) + 1
  }
  const csrOffset: number[] = new Array<number>(n + 2).fill(0)
  for (let v = 0; v <= n; v++) csrOffset[v + 1] = (csrOffset[v] ?? 0) + (perValue[v] ?? 0)
  const cursor = csrOffset.slice()
  const csrIndex: number[] = new Array<number>(count * 3).fill(0)
  for (let t = 0; t < count; t++) {
    const { a, b, c } = triples[t] as Triple
    csrIndex[cursor[a] as number] = t
    cursor[a] = (cursor[a] ?? 0) + 1
    csrIndex[cursor[b] as number] = t
    cursor[b] = (cursor[b] ?? 0) + 1
    csrIndex[cursor[c] as number] = t
    cursor[c] = (cursor[c] ?? 0) + 1
  }

  const triplesBytes = count * 6
  const orderBytes = n * 2
  const offsetBytes = (n + 2) * 4
  const indexBytes = count * 3 * 2
  const bytes = new Uint8Array(12 + triplesBytes + 4 + orderBytes + offsetBytes + indexBytes)
  const view = new DataView(bytes.buffer)

  view.setUint32(0, n, true)
  view.setUint32(4, budget, true)
  view.setUint32(8, count, true)

  let at = 12
  for (const triple of triples) {
    view.setUint16(at, triple.a, true)
    view.setUint16(at + 2, triple.b, true)
    view.setUint16(at + 4, triple.c, true)
    at += 6
  }

  view.setUint32(at, INPUT_VERSION, true)
  at += 4
  for (const value of order) {
    view.setUint16(at, value, true)
    at += 2
  }
  for (let v = 0; v < n + 2; v++) {
    view.setUint32(at, csrOffset[v] ?? 0, true)
    at += 4
  }
  for (const index of csrIndex) {
    view.setUint16(at, index, true)
    at += 2
  }

  return bytes
}

const STATUS_BY_CODE: readonly PartialStatus[] = ['exhausted', 'found', 'budget']

/** Narrow a decoded value to an IPLD map. A guard, so no cast is needed below. */
function isRecord(value: CanonicalValue): value is { readonly [k: string]: CanonicalValue } {
  return (
    value !== null &&
    typeof value === 'object' &&
    !(value instanceof Uint8Array) &&
    !Array.isArray(value) &&
    CID.asCID(value) === null
  )
}

/**
 * Parse a shard output without trusting its shape.
 *
 * Returns `null` rather than throwing, so a caller sweeping many shards is not
 * forced to decide that one malformed output ends the job.
 */
function partialOf(output: CanonicalValue): ShardPartial | null {
  if (!isRecord(output)) return null

  const bits = output['c']
  if (!(bits instanceof Uint8Array) || bits.length !== COLOURING_BYTES) return null

  const statusField = output['s']
  if (!(statusField instanceof Uint8Array) || statusField.length !== 1) return null
  const code = statusField[0]
  if (code === undefined) return null
  const status = STATUS_BY_CODE[code]
  if (status === undefined) return null

  return { status, bits }
}

/**
 * Parse a shard output. Throws when it is not a colouring partial at all.
 *
 * A malformed output here means the module that ran was not this kernel, which is a
 * different problem from a failed search and deserves a different signal.
 */
export function readPartial(output: CanonicalValue): ShardPartial {
  const partial = partialOf(output)
  if (partial === null) {
    throw new Error('output is not a colouring partial')
  }
  return partial
}

/**
 * The first colouring any shard found, or `null` if none did.
 *
 * Takes `JobResult['shards']` directly, so a caller holding a `submitJob` result can
 * pass `job.shards` unchanged. Shards that disagreed or failed are skipped rather
 * than guessed at: an unverified answer is not an answer, and the caller should be
 * checking whatever comes back with `verifyColouring` regardless.
 */
export function answerOf(results: readonly ShardResult[]): Uint8Array | null {
  for (const shard of results) {
    if (shard.verification.status !== 'agreed') continue
    const partial = partialOf(shard.verification.output)
    if (partial !== null && partial.status === 'found') return partial.bits
  }
  return null
}
