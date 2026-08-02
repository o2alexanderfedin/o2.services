/**
 * Canonical output encoding — DET-05.
 *
 * Anything hashed or content-addressed goes through strict DAG-CBOR. That single
 * choice is the whole determinism story for numeric output, because the DAG-CBOR
 * spec mandates:
 *
 *   - `NaN`, `Infinity`, `-Infinity` "must not be accepted"
 *   - `-0.0` "should always be encoded as 0x0000000000000000"
 *   - floats "must always be encoded in 64-bit, double-precision form"
 *
 * So no float-bit divergence can reach a hash: a NaN cannot be encoded at all,
 * signed zero is normalized by the codec, and there is no f32/f64 width ambiguity.
 * The WASM spec makes a generated NaN's sign bit nondeterministic, which is
 * precisely why the value must never survive to a comparison — and it cannot.
 *
 * Protobuf is never used here. Protocol Buffers' own documentation states that
 * serialization "is not canonical" and is unstable across languages, builds, and
 * schema versions — field order is explicitly undefined, non-minimal varints are
 * legal, and unknown fields are retained. Hashing protobuf bytes would reintroduce
 * divergence that has nothing to do with floats.
 *
 * Pure module: no platform imports.
 */

import * as dagCbor from '@ipld/dag-cbor'
import { CID } from 'multiformats/cid'
import { sha256 } from '../hash.ts'

/** Values the IPLD data model admits. Deliberately excludes non-finite floats. */
export type CanonicalValue =
  | null
  | boolean
  | number
  | string
  | Uint8Array
  | CID
  | readonly CanonicalValue[]
  | { readonly [k: string]: CanonicalValue }

export type EncodeError =
  | { kind: 'non-finite-float'; path: string; value: string }
  | { kind: 'codec-rejected'; detail: string }

export type EncodeResult =
  | { ok: true; bytes: Uint8Array<ArrayBuffer> }
  | { ok: false; error: EncodeError }

/**
 * A record this package built and then could not canonically encode.
 *
 * Thrown by the payload builders that feed a signature — `payloadOf`,
 * `possessionChallenge`, `capabilityPayload` — and deliberately **never** returned
 * as a verdict. That is the whole reason the type exists.
 *
 * A payload that will not encode and a signature that does not check are different
 * claims about different parties. The second says *this peer sent a record it did
 * not sign*; the first says *this package built a record its own codec rejects*, and
 * the peer is not mentioned in it at all. Six verify paths used to report the first
 * as the second, so a defect in our encoder read on the wire as a peer forging a
 * signature. A caller that must tell them apart branches on this type; a caller with
 * nothing useful to do about a codec defect lets it propagate, which is the honest
 * outcome for a bug in this package.
 *
 * `what` is the record being built, not the field that failed — `error` carries the
 * field, with its path, from {@link EncodeError}.
 */
export class NotEncodableError extends Error {
  /** The record that failed to encode, e.g. `'certificate'`. */
  readonly what: string
  readonly error: EncodeError
  constructor(what: string, error: EncodeError) {
    super(`${what} not encodable: ${JSON.stringify(error)}`)
    this.name = 'NotEncodableError'
    this.what = what
    this.error = error
  }
}

/**
 * Walk a value and report the first non-finite float, with its path.
 *
 * `@ipld/dag-cbor` rejects these too, but its error does not say *where*. For a
 * task author debugging a rejected output, the path is the useful part.
 */
function findNonFinite(value: unknown, path: string): EncodeError | null {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return { kind: 'non-finite-float', path, value: String(value) }
    }
    return null
  }
  if (value === null || typeof value !== 'object') return null
  if (value instanceof Uint8Array) return null
  if (CID.asCID(value) !== null) return null
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const found = findNonFinite(value[i], `${path}[${i}]`)
      if (found) return found
    }
    return null
  }
  for (const [k, v] of Object.entries(value)) {
    const found = findNonFinite(v, path === '' ? k : `${path}.${k}`)
    if (found) return found
  }
  return null
}

/** Encode a declared output value to canonical DAG-CBOR bytes. */
export function encodeCanonical(value: CanonicalValue): EncodeResult {
  const nonFinite = findNonFinite(value, '')
  if (nonFinite) return { ok: false, error: nonFinite }
  try {
    // dag-cbor allocates a fresh ArrayBuffer-backed view; the annotation records
    // that a block is never SharedArrayBuffer-backed, which matches the admission
    // gate refusing shared memory in the first place.
    const bytes = dagCbor.encode(value) as Uint8Array<ArrayBuffer>
    return { ok: true, bytes }
  } catch (cause) {
    return {
      ok: false,
      error: { kind: 'codec-rejected', detail: cause instanceof Error ? cause.message : String(cause) },
    }
  }
}

export type HashResult =
  | { ok: true; cid: CID; bytes: Uint8Array<ArrayBuffer> }
  | { ok: false; error: EncodeError }

/**
 * Content-address a declared output value.
 *
 * The CID is over the DAG-CBOR bytes, never over a raw linear-memory slice — so
 * allocator residue and struct padding cannot make two equal results differ.
 */
export async function canonicalCid(value: CanonicalValue): Promise<HashResult> {
  const encoded = encodeCanonical(value)
  if (!encoded.ok) return { ok: false, error: encoded.error }
  const digest = await sha256.digest(encoded.bytes)
  return { ok: true, cid: CID.create(1, dagCbor.code, digest), bytes: encoded.bytes }
}

/** Decode canonical bytes back to a value. */
export function decodeCanonical(bytes: Uint8Array<ArrayBuffer>): CanonicalValue {
  return dagCbor.decode(bytes) as CanonicalValue
}
