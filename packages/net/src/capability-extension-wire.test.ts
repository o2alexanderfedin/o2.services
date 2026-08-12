import { ed25519 } from '@noble/curves/ed25519.js'
import { describe, expect, it } from 'vitest'
import {
  EnrollmentAuthority,
  encodeCanonical,
  publishCapabilities,
  requestEnrollment,
  toHex,
  verifyCapabilityRecord,
} from '@o2/core'
import type { CanonicalValue, CapabilityExtension, NodeRecords } from '@o2/core'
import { encodeResponse, parseResponse } from './protocol.ts'

/**
 * A canonical map's entries, or a thrown fixture failure. Never a cast.
 *
 * A `Map` rather than the object itself because `CanonicalValue` includes
 * `readonly CanonicalValue[]`, which `Array.isArray` does not subtract from a union — so
 * the honest way to hand back an indexable value without an assertion is to build one.
 */
function entriesOf(value: CanonicalValue | undefined): Map<string, CanonicalValue> {
  if (value === null || value === undefined || typeof value !== 'object') {
    throw new Error('fixture value is not a canonical map')
  }
  if (value instanceof Uint8Array) throw new Error('fixture value is bytes, not a map')
  if (Array.isArray(value)) throw new Error('fixture value is a list, not a map')
  return new Map(Object.entries(value))
}

/** The same entries back as a frame the codec will accept. */
function frameOf(entries: ReadonlyMap<string, CanonicalValue>): CanonicalValue {
  return Object.fromEntries(entries)
}

/**
 * The wire half of `CapabilityRecord`'s extension seam.
 *
 * `parseCapabilities` used to reconstruct exactly six named fields and drop everything
 * else, which is the mechanism behind the misattribution this seam removes: the reader's
 * own parser deleted a field the signer had signed, so the payload no longer recomputed
 * and the record was reported `invalid-capability-record` — a claim about the signer,
 * caused by the reader. `protocol.ts` already carries the rule, written for the
 * certificate's optional X.509 field:
 *
 * > *"a certificate stripped of a field its issuer signed no longer verifies and the
 * > reader would be told `bad-signature` about a frame this parser had damaged"*
 *
 * **Preservation is the requirement, and preservation of ids this build has never heard
 * of is the only version of it that is worth anything.** A parser that carried through
 * the extensions it recognised would keep exactly the records it did not need to keep.
 */

function keypair(seed: number): { priv: Uint8Array; pub: string } {
  const priv = new Uint8Array(32).fill(seed)
  return { priv, pub: toHex(ed25519.getPublicKey(priv)) }
}

const provider = keypair(210)
const owner = keypair(211)
const NOW = 1_800_000_000_000
const YEAR = 365 * 24 * 3_600_000

/** An id no build in this repository knows, carrying a value no build can interpret. */
const UNKNOWN = 'urn:o2:extension:invented-by-a-later-build'
const UNKNOWN_VALUE = {
  cells: ['8a2a1072b59ffff', '8a2a1072b597fff'],
  depth: 10,
  nested: { flag: true, absent: null },
}

function records(extensions: readonly CapabilityExtension[]): NodeRecords {
  const authority = new EnrollmentAuthority({
    providerPrivateKey: provider.priv,
    maxPerWindow: 50,
    maxIssuedPerWindow: 'issues-without-an-aggregate-budget',
    issuance: 'remembers-only-within-this-process',
  })
  const key = keypair(212)
  const enrolled = authority.enrol(
    requestEnrollment(key.priv, owner.priv, {
      operatorId: 'op-wire',
      discoverability: 'seed',
      relayIds: [],
    }),
    NOW,
  )
  if (!enrolled.ok) throw new Error(`fixture failed to enrol: ${enrolled.reason}`)
  return {
    certificate: enrolled.certificate,
    capabilities: publishCapabilities(key.priv, {
      features: [],
      sovereignFor: [],
      issuedAt: NOW - 1000,
      expiresAt: NOW + YEAR,
      extensions,
    }),
  }
}

/** A records response through the codec and back, or a failure this test can name. */
function roundTrip(source: NodeRecords): NodeRecords {
  const encoded = encodeResponse({ kind: 'records', records: source })
  const parsed = parseResponse(encoded)
  if (parsed === null) throw new Error('the codec refused a frame it had just produced')
  if (parsed.kind !== 'records') throw new Error(`round trip changed kind to ${parsed.kind}`)
  if (parsed.records === null) throw new Error('round trip lost the records')
  return parsed.records
}

describe('the wire codec preserves extensions it cannot interpret', () => {
  it('carries an unknown extension through unchanged, and the record still verifies', () => {
    const source = records([{ id: UNKNOWN, critical: false, value: UNKNOWN_VALUE }])
    const parsed = roundTrip(source)

    expect(parsed.capabilities.extensions).toEqual(source.capabilities.extensions)
    // The property the seam exists for: an older reader — one that has never heard of
    // this id and can do nothing with it — can still VERIFY the record.
    expect(verifyCapabilityRecord(parsed.capabilities, NOW)).toBe(true)
  })

  it('re-encodes byte-identically, so a relayed record is the record that was signed', () => {
    const source = records([
      { id: 'urn:o2:z-last', critical: true, value: 'z' },
      { id: UNKNOWN, critical: false, value: UNKNOWN_VALUE },
    ])
    const first = encodeCanonical(encodeResponse({ kind: 'records', records: source }))
    const again = encodeCanonical(encodeResponse({ kind: 'records', records: roundTrip(source) }))

    if (!first.ok || !again.ok) throw new Error('fixture did not encode')
    expect(Array.from(again.bytes)).toEqual(Array.from(first.bytes))
  })

  it('puts the extensions on the wire at all — a frame without them is the defect', () => {
    const source = records([{ id: UNKNOWN, critical: false, value: UNKNOWN_VALUE }])
    // Read the frame rather than the parse, so an encoder that dropped the field and a
    // parser that re-invented it could not cancel each other out.
    const frame = entriesOf(encodeResponse({ kind: 'records', records: source }))
    expect(entriesOf(frame.get('capabilities')).get('extensions')).toEqual([
      { id: UNKNOWN, critical: false, value: UNKNOWN_VALUE },
    ])
  })

  it('omits the key entirely when there are no extensions', () => {
    const frame = entriesOf(encodeResponse({ kind: 'records', records: records([]) }))
    // Not `extensions: []`. A node that uses none produces the frame it produced before
    // the field existed, which is the same rule `certificateToValue` states for `x509`.
    expect(entriesOf(frame.get('capabilities')).has('extensions')).toBe(false)
  })

  it('accepts a frame with no extensions key, because every older peer sends one', () => {
    const source = records([])
    const encoded = encodeResponse({ kind: 'records', records: source })
    const parsed = parseResponse(encoded)
    expect(parsed?.kind === 'records' ? parsed.records?.capabilities.extensions : null).toEqual([])
    expect(verifyCapabilityRecord(roundTrip(source).capabilities, NOW)).toBe(true)
  })
})

describe('what the extension parser refuses, and why refusing beats dropping', () => {
  /** A well-formed records frame whose capability record carries these extensions. */
  const frameWith = (extensions: CanonicalValue): CanonicalValue => {
    const frame = entriesOf(encodeResponse({ kind: 'records', records: records([]) }))
    const capabilities = entriesOf(frame.get('capabilities'))
    capabilities.set('extensions', extensions)
    frame.set('capabilities', frameOf(capabilities))
    return frameOf(frame)
  }

  it('refuses an extension list that is not a list', () => {
    expect(parseResponse(frameWith({ id: 'x', critical: false, value: 1 }))).toBe(null)
  })

  it('refuses an extension with a wrong-typed id or criticality', () => {
    expect(parseResponse(frameWith([{ id: 7, critical: false, value: 1 }]))).toBe(null)
    expect(parseResponse(frameWith([{ id: 'x', critical: 'yes', value: 1 }]))).toBe(null)
  })

  it('refuses an extension with no value key, which is not the same as a null value', () => {
    expect(parseResponse(frameWith([{ id: 'x', critical: false }]))).toBe(null)
    expect(parseResponse(frameWith([{ id: 'x', critical: false, value: null }]))).not.toBe(null)
  })

  it('refuses an extension carrying a fourth key rather than dropping it', () => {
    // The envelope is closed BECAUSE `value` is open: anything a later build needs to
    // say goes inside `value`, never as a sibling of it. So a fourth key is a frame this
    // build cannot represent, and dropping it would recreate the exact defect this seam
    // removes — one level further down, where it would be harder to find.
    expect(parseResponse(frameWith([{ id: 'x', critical: false, value: 1, extra: 'dropped?' }]))).toBe(
      null,
    )
  })

  it('refuses a capability record carrying a top-level key this build does not know', () => {
    // The seam is now the sanctioned way to add a field, so a new TOP-LEVEL key is a
    // mistake rather than a later build talking — and dropping it is precisely the silent
    // damage this change removes. `parseCertificate` is deliberately not strict in the
    // same way: `NodeCertificate` has no seam, so refusing unknown keys there would
    // forbid extension rather than direct it.
    const frame = entriesOf(encodeResponse({ kind: 'records', records: records([]) }))
    const capabilities = entriesOf(frame.get('capabilities'))
    capabilities.set('memoryMib', 4096)
    frame.set('capabilities', frameOf(capabilities))
    expect(parseResponse(frameOf(frame))).toBe(null)
  })

  it('refuses duplicate ids on the wire', () => {
    expect(
      parseResponse(
        frameWith([
          { id: 'urn:o2:twice', critical: false, value: 1 },
          { id: 'urn:o2:twice', critical: true, value: 2 },
        ]),
      ),
    ).toBe(null)
  })
})
