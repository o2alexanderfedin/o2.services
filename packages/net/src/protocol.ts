/**
 * The agent wire protocol — five request kinds, nothing more.
 *
 * `exec` dispatches one task; `block` fetches one content-addressed block. That
 * is the entire vocabulary needed to run a distributed map: a task is addressed
 * purely by CID, so a node that has never seen a module or an input can obtain
 * both by asking, and needs no payload pushed to it.
 *
 * Phase 6 adds the three that remove the static peer list. `providers` and
 * `records` are the two halves of a lookup — who holds a block, and what a node is
 * allowed and able to do — and `offer` is a node's own answer to "will you take this
 * shard", which is the only authoritative source for that (SCHED-03).
 *
 * Everything arriving here came off a wire, so every field is validated before
 * use. The parsers return `null` rather than throwing — a malformed frame from a
 * peer is an expected condition, not an exception. That matters more for the record
 * kinds than for the others: a certificate is a security input, and a parser that
 * accepted a partially-formed one would hand discovery something to verify that was
 * never what the provider signed.
 *
 * Pure module.
 */

import { CID } from 'multiformats/cid'
import type {
  CanonicalValue,
  CapabilityRecord,
  Delegation,
  Discoverability,
  ExecutionOutcome,
  NodeCertificate,
  NodeRecords,
  PublicKeyHex,
  Task,
} from '@o2/core'

export type AgentRequest =
  | {
      readonly kind: 'exec'
      readonly task: Task
      /** AUTH-03. Absent means unauthenticated, which an authorizing node refuses. */
      readonly capability?: readonly Delegation[]
    }
  | { readonly kind: 'block'; readonly cid: CID }
  /** SCHED-01: who advertises a copy of this block. */
  | { readonly kind: 'providers'; readonly cid: CID }
  /** SCHED-01: the signed records for a node key. */
  | { readonly kind: 'records'; readonly nodeKey: PublicKeyHex }
  /** SCHED-03: will you take this shard? */
  | { readonly kind: 'offer'; readonly shardId: string }

export type AgentResponse =
  | { readonly kind: 'exec'; readonly outcome: ExecutionOutcome }
  /** `bytes: null` means "I do not have that block", which is not an error. */
  | { readonly kind: 'block'; readonly bytes: Uint8Array<ArrayBuffer> | null }
  | { readonly kind: 'providers'; readonly nodeKeys: readonly PublicKeyHex[] }
  /** `records: null` means "I hold none for that key", which is not an error. */
  | { readonly kind: 'records'; readonly records: NodeRecords | null }
  | { readonly kind: 'offer'; readonly accepted: boolean; readonly reason: string }
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

/** A list of hex strings off the wire, or `null` if any element is not one. */
function asKeyList(value: CanonicalValue | undefined): readonly string[] | null {
  if (!Array.isArray(value)) return null
  const keys: string[] = []
  for (const entry of value) {
    if (typeof entry !== 'string') return null
    keys.push(entry)
  }
  return keys
}

function asFiniteNumber(value: CanonicalValue | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return value
}

function certificateToValue(certificate: NodeCertificate): CanonicalValue {
  return {
    nodeKey: certificate.nodeKey,
    userKey: certificate.userKey,
    operatorId: certificate.operatorId,
    discoverability: certificate.discoverability,
    relayIds: [...certificate.relayIds],
    issuedAt: certificate.issuedAt,
    expiresAt: certificate.expiresAt,
    issuer: certificate.issuer,
    signature: certificate.signature,
  }
}

/**
 * Parse a node certificate off the wire.
 *
 * Every field is required and typed. Nothing here judges whether the certificate is
 * *valid* — that is `verifyCertificate`'s job against pinned issuer keys, and keeping
 * the two separate is deliberate: a parser that also verified would tempt a caller to
 * treat "parsed" as "trusted".
 */
function parseCertificate(value: CanonicalValue | undefined): NodeCertificate | null {
  const record = value === undefined ? null : asRecord(value)
  if (record === null) return null
  const { nodeKey, userKey, operatorId, discoverability, issuer, signature } = record
  if (typeof nodeKey !== 'string' || typeof userKey !== 'string') return null
  if (typeof operatorId !== 'string' || typeof issuer !== 'string') return null
  if (typeof signature !== 'string') return null
  if (discoverability !== 'seed' && discoverability !== 'via-relay') return null
  const relayIds = asKeyList(record['relayIds'])
  const issuedAt = asFiniteNumber(record['issuedAt'])
  const expiresAt = asFiniteNumber(record['expiresAt'])
  if (relayIds === null || issuedAt === null || expiresAt === null) return null
  return {
    nodeKey,
    userKey,
    operatorId,
    discoverability: discoverability satisfies Discoverability,
    relayIds,
    issuedAt,
    expiresAt,
    issuer,
    signature,
  }
}

function capabilitiesToValue(capabilities: CapabilityRecord): CanonicalValue {
  return {
    nodeKey: capabilities.nodeKey,
    features: [...capabilities.features],
    sovereignFor: [...capabilities.sovereignFor],
    issuedAt: capabilities.issuedAt,
    expiresAt: capabilities.expiresAt,
    signature: capabilities.signature,
  }
}

function parseCapabilities(value: CanonicalValue | undefined): CapabilityRecord | null {
  const record = value === undefined ? null : asRecord(value)
  if (record === null) return null
  const { nodeKey, signature } = record
  if (typeof nodeKey !== 'string' || typeof signature !== 'string') return null
  const features = asKeyList(record['features'])
  const sovereignFor = asKeyList(record['sovereignFor'])
  const issuedAt = asFiniteNumber(record['issuedAt'])
  const expiresAt = asFiniteNumber(record['expiresAt'])
  if (features === null || sovereignFor === null) return null
  if (issuedAt === null || expiresAt === null) return null
  return { nodeKey, features, sovereignFor, issuedAt, expiresAt, signature }
}

export function encodeRequest(request: AgentRequest): CanonicalValue {
  if (request.kind === 'block') {
    return { kind: 'block', cid: request.cid }
  }
  if (request.kind === 'providers') {
    return { kind: 'providers', cid: request.cid }
  }
  if (request.kind === 'records') {
    return { kind: 'records', nodeKey: request.nodeKey }
  }
  if (request.kind === 'offer') {
    return { kind: 'offer', shardId: request.shardId }
  }
  const { task } = request
  const base: { readonly [k: string]: CanonicalValue } = {
    kind: 'exec',
    moduleCid: task.moduleCid,
    inputCid: task.inputCid,
    partitionIndex: task.partitionIndex,
    partitionCount: task.partitionCount,
  }
  if (request.capability === undefined) return base
  return { ...base, capability: request.capability.map(delegationToValue) }
}

/** Delegations are plain records, but must be listed explicitly to stay canonical. */
function delegationToValue(link: Delegation): CanonicalValue {
  return {
    issuer: link.issuer,
    audience: link.audience,
    ownerId: link.ownerId,
    abilities: [...link.abilities],
    expiresAt: link.expiresAt,
    signature: link.signature,
  }
}

/** Parse a delegation off the wire. Every field validated — this is a security input. */
function parseDelegation(value: CanonicalValue): Delegation | null {
  const record = asRecord(value)
  if (record === null) return null
  const { issuer, audience, ownerId, expiresAt, signature } = record
  if (typeof issuer !== 'string' || typeof audience !== 'string') return null
  if (typeof ownerId !== 'string' || typeof signature !== 'string') return null
  if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt)) return null
  const abilities = record['abilities']
  if (!Array.isArray(abilities)) return null
  const parsed: ('execute' | 'read' | 'delegate')[] = []
  for (const ability of abilities) {
    if (ability !== 'execute' && ability !== 'read' && ability !== 'delegate') return null
    parsed.push(ability)
  }
  return { issuer, audience, ownerId, abilities: parsed, expiresAt, signature }
}

export function parseRequest(body: CanonicalValue): AgentRequest | null {
  const record = asRecord(body)
  if (record === null) return null

  if (record['kind'] === 'block') {
    const cid = CID.asCID(record['cid'] ?? null)
    if (cid === null) return null
    return { kind: 'block', cid }
  }

  if (record['kind'] === 'providers') {
    const cid = CID.asCID(record['cid'] ?? null)
    if (cid === null) return null
    return { kind: 'providers', cid }
  }

  if (record['kind'] === 'records') {
    const nodeKey = record['nodeKey']
    if (typeof nodeKey !== 'string') return null
    return { kind: 'records', nodeKey }
  }

  if (record['kind'] === 'offer') {
    const shardId = record['shardId']
    if (typeof shardId !== 'string') return null
    return { kind: 'offer', shardId }
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
  const task: Task = { moduleCid, inputCid, partitionIndex, partitionCount }

  const capabilityValue = record['capability']
  if (capabilityValue === undefined) return { kind: 'exec', task }
  if (!Array.isArray(capabilityValue)) return null
  const capability: Delegation[] = []
  for (const value of capabilityValue) {
    const link = parseDelegation(value)
    // A malformed chain is refused outright rather than silently truncated to the
    // links that happened to parse.
    if (link === null) return null
    capability.push(link)
  }
  return { kind: 'exec', task, capability }
}

export function encodeResponse(response: AgentResponse): CanonicalValue {
  switch (response.kind) {
    case 'error':
      return { kind: 'error', reason: response.reason }
    case 'block':
      return response.bytes === null
        ? { kind: 'block', found: false }
        : { kind: 'block', found: true, bytes: response.bytes }
    case 'providers':
      return { kind: 'providers', nodeKeys: [...response.nodeKeys] }
    case 'records':
      return response.records === null
        ? { kind: 'records', found: false }
        : {
            kind: 'records',
            found: true,
            certificate: certificateToValue(response.records.certificate),
            capabilities: capabilitiesToValue(response.records.capabilities),
          }
    case 'offer':
      return { kind: 'offer', accepted: response.accepted, reason: response.reason }
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
    case 'providers': {
      const nodeKeys = asKeyList(record['nodeKeys'])
      if (nodeKeys === null) return null
      return { kind: 'providers', nodeKeys }
    }
    case 'records': {
      if (record['found'] !== true) return { kind: 'records', records: null }
      const certificate = parseCertificate(record['certificate'])
      const capabilities = parseCapabilities(record['capabilities'])
      // Half a record is not a record. Returning one would leave discovery holding a
      // certificate with nothing to check it against, or claims with no identity.
      if (certificate === null || capabilities === null) return null
      return { kind: 'records', records: { certificate, capabilities } }
    }
    case 'offer': {
      const accepted = record['accepted']
      const reason = record['reason']
      if (typeof accepted !== 'boolean') return null
      return { kind: 'offer', accepted, reason: typeof reason === 'string' ? reason : '' }
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
