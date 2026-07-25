/**
 * The agent wire protocol — two request kinds, nothing more.
 *
 * `exec` dispatches one task; `block` fetches one content-addressed block. That
 * is the entire vocabulary needed to run a distributed map: a task is addressed
 * purely by CID, so a node that has never seen a module or an input can obtain
 * both by asking, and needs no payload pushed to it.
 *
 * Everything arriving here came off a wire, so every field is validated before
 * use. The parsers return `null` rather than throwing — a malformed frame from a
 * peer is an expected condition, not an exception.
 *
 * Pure module.
 */

import { CID } from 'multiformats/cid'
import type { CanonicalValue, ExecutionOutcome, Task } from '@o2/core'

export type AgentRequest =
  | { readonly kind: 'exec'; readonly task: Task }
  | { readonly kind: 'block'; readonly cid: CID }

export type AgentResponse =
  | { readonly kind: 'exec'; readonly outcome: ExecutionOutcome }
  /** `bytes: null` means "I do not have that block", which is not an error. */
  | { readonly kind: 'block'; readonly bytes: Uint8Array<ArrayBuffer> | null }
  | { readonly kind: 'error'; readonly reason: string }

/** Copy any byte view into a plainly-owned ArrayBuffer-backed one. */
function ownBytes(view: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(view.byteLength)
  copy.set(view)
  return copy
}

function asRecord(value: CanonicalValue): { readonly [k: string]: CanonicalValue } | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  if (value instanceof Uint8Array) return null
  if (CID.asCID(value) !== null) return null
  return value as { readonly [k: string]: CanonicalValue }
}

/** Accepts `undefined` deliberately: an absent field is one of the inputs it rejects. */
function asIndex(value: CanonicalValue | undefined): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return null
  return value
}

export function encodeRequest(request: AgentRequest): CanonicalValue {
  if (request.kind === 'block') {
    return { kind: 'block', cid: request.cid }
  }
  const { task } = request
  return {
    kind: 'exec',
    moduleCid: task.moduleCid,
    inputCid: task.inputCid,
    partitionIndex: task.partitionIndex,
    partitionCount: task.partitionCount,
  }
}

export function parseRequest(body: CanonicalValue): AgentRequest | null {
  const record = asRecord(body)
  if (record === null) return null

  if (record['kind'] === 'block') {
    const cid = CID.asCID(record['cid'] ?? null)
    if (cid === null) return null
    return { kind: 'block', cid }
  }

  if (record['kind'] !== 'exec') return null
  const moduleCid = CID.asCID(record['moduleCid'] ?? null)
  const inputCid = CID.asCID(record['inputCid'] ?? null)
  const partitionIndex = asIndex(record['partitionIndex'])
  const partitionCount = asIndex(record['partitionCount'])
  if (moduleCid === null || inputCid === null) return null
  if (partitionIndex === null || partitionCount === null) return null
  // A partition index outside its own count is incoherent — refuse it here rather
  // than letting the executor derive a nonsensical shard.
  if (partitionCount === 0 || partitionIndex >= partitionCount) return null
  return {
    kind: 'exec',
    task: { moduleCid, inputCid, partitionIndex, partitionCount },
  }
}

export function encodeResponse(response: AgentResponse): CanonicalValue {
  switch (response.kind) {
    case 'error':
      return { kind: 'error', reason: response.reason }
    case 'block':
      return response.bytes === null
        ? { kind: 'block', found: false }
        : { kind: 'block', found: true, bytes: response.bytes }
    case 'exec':
      return response.outcome.ok
        ? {
            kind: 'exec',
            ok: true,
            output: response.outcome.output,
            fuelUsed: response.outcome.fuelUsed,
          }
        : { kind: 'exec', ok: false, reason: response.outcome.reason }
  }
}

export function parseResponse(body: CanonicalValue): AgentResponse | null {
  const record = asRecord(body)
  if (record === null) return null

  switch (record['kind']) {
    case 'error': {
      const reason = record['reason']
      return { kind: 'error', reason: typeof reason === 'string' ? reason : 'unspecified' }
    }
    case 'block': {
      if (record['found'] !== true) return { kind: 'block', bytes: null }
      const bytes = record['bytes']
      if (!(bytes instanceof Uint8Array)) return null
      return { kind: 'block', bytes: ownBytes(bytes) }
    }
    case 'exec': {
      if (record['ok'] === true) {
        const output = record['output']
        const fuelUsed = record['fuelUsed']
        if (output === undefined || typeof fuelUsed !== 'number' || !Number.isFinite(fuelUsed)) {
          return null
        }
        return { kind: 'exec', outcome: { ok: true, output, fuelUsed } }
      }
      if (record['ok'] !== false) return null
      const reason = record['reason']
      return {
        kind: 'exec',
        outcome: { ok: false, reason: typeof reason === 'string' ? reason : 'unspecified' },
      }
    }
    default:
      return null
  }
}
