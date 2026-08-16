import { ed25519 } from '@noble/curves/ed25519.js'
import { describe, expect, it } from 'vitest'
import { canonicalCid } from './canonical/encode.ts'
import { toHex } from './capability.ts'
import {
  DuplicateExtensionError,
  MemoryRecordIndex,
  discoverExecutors,
  publishCapabilities,
  verifyCapabilityRecord,
} from './discovery.ts'
import type { CapabilityExtension, NodeRecords } from './discovery.ts'
import { EnrollmentAuthority, requestEnrollment } from './enrollment.ts'

/**
 * `CapabilityRecord`'s forward-compatible extension seam.
 *
 * ## The defect this file was written against
 *
 * `capabilityPayload` signed five named fields and `parseCapabilities` reconstructed six,
 * **dropping every key it had never heard of**. So the first node to sign a record carrying
 * a new field was reported `invalid-capability-record` by every older peer: the reader's own
 * parser removed a field the signer had signed, the payload no longer recomputed, and the
 * signature no longer checked. The reader then blamed the signer for a frame the reader had
 * damaged.
 *
 * The repository had already ruled this class out for the sibling record — `protocol.ts`, on
 * the certificate's optional X.509 field:
 *
 * > *"a certificate stripped of a field its issuer signed no longer verifies and the reader
 * > would be told `bad-signature` about a frame this parser had damaged"*
 *
 * **That pattern is necessary and not sufficient here, and the difference is the whole
 * point.** A known-optional field buys BACKWARD compatibility: a new signer that omits it
 * produces bytes an old reader still parses. It buys no FORWARD compatibility at all — an old
 * reader meeting a field it has never heard of still drops it, and the signature still fails.
 * X.509 was a lockstep change; the conditional spread protected already-issued certificates,
 * not older readers.
 *
 * So the seam is X.509's own answer, which this repository already has a profile for: a list
 * of `{ id, critical, value }` extensions, covered by the signature, **preserved verbatim by
 * the parser including ids this build has never heard of**, with criticality deciding what a
 * reader that does not understand one must do.
 *
 * ## What this still costs, said plainly rather than discovered later
 *
 * A peer built before the seam existed cannot read a record that uses it. Nothing in this
 * design changes that and nothing here pretends otherwise. What it changes is the *last* time
 * that is true: after this, a new capability field rides inside `extensions` and an older
 * reader verifies the record, preserves the field, and either ignores it or refuses **by
 * name**. The blast radius is also narrowed to records that actually carry an extension — a
 * record with none produces the byte-identical payload it produced before this field existed,
 * which the legacy-signature case below pins.
 */

function keypair(seed: number): { priv: Uint8Array; pub: string } {
  const priv = new Uint8Array(32).fill(seed)
  return { priv, pub: toHex(ed25519.getPublicKey(priv)) }
}

const provider = keypair(190)
const owner = keypair(191)
const NOW = 1_800_000_000_000
const YEAR = 365 * 24 * 3_600_000

const trusted = new Set([provider.pub])

const authority = (): EnrollmentAuthority =>
  new EnrollmentAuthority({
    providerPrivateKey: provider.priv,
    maxPerWindow: 50,
    maxIssuedPerWindow: 'issues-without-an-aggregate-budget',
    issuance: 'remembers-only-within-this-process',
  })

/** An enrolled node whose capability record carries exactly these extensions. */
async function node(
  auth: EnrollmentAuthority,
  seed: number,
  extensions: readonly CapabilityExtension[],
): Promise<{ nodeKey: string; records: NodeRecords }> {
  const key = keypair(seed)
  const enrolled = auth.enrol(
    await requestEnrollment(key.priv, owner.priv, {
      operatorId: `op-${seed}`,
      discoverability: 'seed',
      relayIds: [],
    }),
    NOW,
  )
  if (!enrolled.ok) throw new Error(`fixture failed to enrol: ${enrolled.reason}`)
  return {
    nodeKey: key.pub,
    records: {
      certificate: enrolled.certificate,
      capabilities: publishCapabilities(key.priv, {
        features: [],
        sovereignFor: [],
        issuedAt: NOW - 1000,
        expiresAt: NOW + YEAR,
        extensions,
      }),
    },
  }
}

async function indexOf(...nodes: readonly { nodeKey: string; records: NodeRecords }[]) {
  const cid = await canonicalCid({ dataset: 'extension-seam' })
  if (!cid.ok) throw new Error('fixture cid')
  const index = new MemoryRecordIndex()
  for (const n of nodes) {
    index.provide(cid.cid, n.nodeKey)
    index.publish(n.records)
  }
  return { index, cid: cid.cid }
}

/** An id no build in this repository knows, and the point is that none ever will. */
const UNKNOWN = 'urn:o2:extension:invented-by-a-later-build'

describe('the extension seam is covered by the signature', () => {
  it('signs the extensions, so stripping one breaks the record it was stripped from', () => {
    const key = keypair(11)
    const record = publishCapabilities(key.priv, {
      features: [],
      sovereignFor: [],
      issuedAt: NOW,
      expiresAt: NOW + YEAR,
      extensions: [{ id: UNKNOWN, critical: false, value: { region: 'nowhere' } }],
    })

    expect(verifyCapabilityRecord(record, NOW)).toBe(true)
    // This is the defect, expressed as a property: a reader that drops the field is a
    // reader that computes a different payload, and the only honest report of that is
    // "does not verify" — which is why the parser must not drop it in the first place.
    expect(verifyCapabilityRecord({ ...record, extensions: [] }, NOW)).toBe(false)
    // And tampering with the value inside an extension is caught for the same reason.
    expect(
      verifyCapabilityRecord(
        { ...record, extensions: [{ id: UNKNOWN, critical: false, value: { region: 'elsewhere' } }] },
        NOW,
      ),
    ).toBe(false)
    // The criticality flag is inside the signature too — a peer must not be able to
    // flip a `critical: true` extension to `false` to get past a reader that refuses it.
    expect(
      verifyCapabilityRecord(
        { ...record, extensions: [{ id: UNKNOWN, critical: true, value: { region: 'nowhere' } }] },
        NOW,
      ),
    ).toBe(false)
  })

  it('orders extensions canonically, so the order they were handed in cannot change the signature', () => {
    const key = keypair(12)
    const first: CapabilityExtension = { id: 'urn:o2:a', critical: false, value: 1 }
    const second: CapabilityExtension = { id: 'urn:o2:b', critical: true, value: 'two' }

    const forwards = publishCapabilities(key.priv, {
      features: [],
      sovereignFor: [],
      issuedAt: NOW,
      expiresAt: NOW + YEAR,
      extensions: [first, second],
    })
    const backwards = publishCapabilities(key.priv, {
      features: [],
      sovereignFor: [],
      issuedAt: NOW,
      expiresAt: NOW + YEAR,
      extensions: [second, first],
    })

    expect(backwards.extensions.map((one) => one.id)).toEqual(['urn:o2:a', 'urn:o2:b'])
    expect(forwards.extensions.map((one) => one.id)).toEqual(['urn:o2:a', 'urn:o2:b'])
    expect(backwards.signature).toBe(forwards.signature)
  })

  /**
   * The comparator, pinned against the one input that separates the two candidate rules.
   *
   * There is no divergence in this repository today and there cannot be: every peer here
   * runs the same JS `<`, so every peer computes the same wrong order together. The seam
   * is explicitly a contract for builds that do not exist yet, and a peer sorting these
   * ids by their UTF-8 bytes — what a language without UTF-16 strings does by default —
   * would compute a different signed payload and report `invalid-capability-record`
   * about a record that was signed correctly. That is the same misattribution the seam
   * was built to remove, waiting for a second implementation to arrive.
   */
  it('orders ids by their UTF-8 bytes, which is not what JS `<` does', () => {
    const key = keypair(16)
    // `\u{10000}` is a single astral code point stored as the surrogate pair `𐀀`.
    // `'\uD800' < '＀'`, so `<` sorts it FIRST; its UTF-8 bytes are `f0 90 80 80`
    // against `＀`'s `ef bc 80`, so bytewise sorts it SECOND.
    const astral = 'urn:o2:\u{10000}'
    const fullwidth = 'urn:o2:＀'
    expect(astral < fullwidth).toBe(true) // the rule that was in force, stated so it is visible

    const record = publishCapabilities(key.priv, {
      features: [],
      sovereignFor: [],
      issuedAt: NOW,
      expiresAt: NOW + YEAR,
      extensions: [
        { id: astral, critical: false, value: 1 },
        { id: fullwidth, critical: false, value: 2 },
      ],
    })
    expect(record.extensions.map((one) => one.id)).toEqual([fullwidth, astral])
    expect(verifyCapabilityRecord(record, NOW)).toBe(true)
  })

  it('verifies a record whose extensions arrive out of order, because the payload sorts them', () => {
    const key = keypair(13)
    const first: CapabilityExtension = { id: 'urn:o2:a', critical: false, value: 1 }
    const second: CapabilityExtension = { id: 'urn:o2:b', critical: true, value: 'two' }
    const record = publishCapabilities(key.priv, {
      features: [],
      sovereignFor: [],
      issuedAt: NOW,
      expiresAt: NOW + YEAR,
      extensions: [first, second],
    })

    // A wire codec that preserves order verbatim — which is what this repository's does,
    // so that an unknown extension survives a round trip untouched — can hand a verifier
    // the list in the order it was sent. Sorting inside the payload is what makes that
    // harmless rather than a second way to fail.
    expect(verifyCapabilityRecord({ ...record, extensions: [second, first] }, NOW)).toBe(true)
  })

  it('refuses duplicate extension ids at signing time, by name and not as a verdict', () => {
    const key = keypair(14)
    const build = (): unknown =>
      publishCapabilities(key.priv, {
        features: [],
        sovereignFor: [],
        issuedAt: NOW,
        expiresAt: NOW + YEAR,
        extensions: [
          { id: 'urn:o2:twice', critical: false, value: 1 },
          { id: 'urn:o2:twice', critical: true, value: 2 },
        ],
      })

    expect(build).toThrow(DuplicateExtensionError)
    expect(build).toThrow('urn:o2:twice')
  })

  it('refuses a record carrying duplicate extension ids at verification time', () => {
    const key = keypair(15)
    const record = publishCapabilities(key.priv, {
      features: [],
      sovereignFor: [],
      issuedAt: NOW,
      expiresAt: NOW + YEAR,
      extensions: [{ id: 'urn:o2:twice', critical: false, value: 1 }],
    })

    // A peer can put anything on the wire. Two extensions with one id have no single
    // meaning, so there is nothing to verify — and this is a defect in the record the
    // signer produced, which is why it is `false` here rather than a thrown error.
    const doubled = {
      ...record,
      extensions: [record.extensions[0]!, { id: 'urn:o2:twice', critical: true, value: 2 }],
    }
    expect(verifyCapabilityRecord(doubled, NOW)).toBe(false)
  })

  /**
   * The compatibility half, and the reason the field is spread conditionally.
   *
   * These bytes were produced by the build **before** `extensions` existed, on
   * 2026-08-11, from `new Uint8Array(32).fill(77)` and the four fields below. A record
   * with no extensions must go on verifying against them, which is `payloadOf`'s own
   * rule for the certificate's X.509 field — *"a certificate with no X.509 form must
   * produce the byte-identical payload it produced before this field existed"* — applied
   * to the sibling record.
   *
   * That is what keeps adding the seam free for every node that is not yet using it: a
   * peer upgrading to this build does not become unreadable to its older neighbours the
   * moment it restarts. Only a record that actually carries an extension does that, and
   * that record is the one the seam exists for.
   */
  it('still verifies a record signed before the extension seam existed', () => {
    const priv = new Uint8Array(32).fill(77)
    const legacy = {
      nodeKey: '62a611b472d89b0e5fc93c069b9f700b4c552d55bc0e87b56008ef17b6b2bebe',
      features: ['bulk-memory', 'simd128'],
      sovereignFor: [],
      issuedAt: 1_800_000_000_000,
      expiresAt: 1_800_000_100_000,
      extensions: [],
      signature:
        '6136f33d79333ef5b70ec50580907089c5ce68c2d47e5432aad831312a621383ed956493496d975939a5396dd4318cd36a12bab89fdd7eeb0f295edddd10bf02',
    }
    expect(legacy.nodeKey).toBe(toHex(ed25519.getPublicKey(priv)))
    expect(verifyCapabilityRecord(legacy, 1_800_000_050_000)).toBe(true)

    // And the current signer reproduces those exact bytes for the same four fields.
    const resigned = publishCapabilities(priv, {
      features: ['simd128', 'bulk-memory'],
      sovereignFor: [],
      issuedAt: 1_800_000_000_000,
      expiresAt: 1_800_000_100_000,
      extensions: [],
    })
    expect(resigned.signature).toBe(legacy.signature)
  })
})

describe('what a reader does with an extension it has never heard of', () => {
  it('qualifies a node whose unknown extension is not critical — this is forward compatibility', async () => {
    const auth = authority()
    const later = await node(auth, 21, [{ id: UNKNOWN, critical: false, value: { cells: ['8a2a1072b59ffff'] } }])
    const { index, cid } = await indexOf(later)

    const found = await discoverExecutors({ inputCid: cid }, index, { trustedIssuers: trusted, now: NOW })

    expect(found.excluded).toEqual([])
    expect(found.executors.map((one) => one.nodeKey)).toEqual([later.nodeKey])
    // Preserved, not merely tolerated: the record this reader hands on still carries the
    // field, so a reader that does understand it gets the same bytes the signer signed.
    expect(found.executors[0]?.capabilities.extensions).toEqual([
      { id: UNKNOWN, critical: false, value: { cells: ['8a2a1072b59ffff'] } },
    ])
  })

  it('refuses an unknown CRITICAL extension by a name that blames this build, not the signature', async () => {
    const auth = authority()
    const later = await node(auth, 22, [{ id: UNKNOWN, critical: true, value: { policy: 'refuse' } }])
    const { index, cid } = await indexOf(later)

    const found = await discoverExecutors({ inputCid: cid }, index, { trustedIssuers: trusted, now: NOW })

    expect(found.executors).toEqual([])
    expect(found.excluded).toHaveLength(1)
    const only = found.excluded[0]
    // The whole point of the named arm: the record VERIFIES. Reporting this as
    // `invalid-capability-record` would say the signer sent a record it did not sign,
    // which is false and unfixable by whoever reads it.
    expect(verifyCapabilityRecord(later.records.capabilities, NOW)).toBe(true)
    expect(only?.reason.kind).toBe('critical-extension-not-understood')
    // The `.not.toBe('invalid-capability-record')` that stood here could not fail: the
    // line above already fixes the kind exactly, so the negative was a restatement of
    // the docblock wearing an assertion's clothes. What it was reaching for is the line
    // above it — the record VERIFIES — which can fail and does carry the claim.
    expect(only?.detail).toContain(UNKNOWN)
    expect(only?.detail).toContain('this build')
  })

  it('names every critical extension it does not understand, not just the first', async () => {
    const auth = authority()
    const later = await node(auth, 23, [
      { id: 'urn:o2:unknown-a', critical: true, value: null },
      { id: 'urn:o2:unknown-b', critical: true, value: null },
      { id: 'urn:o2:unknown-c', critical: false, value: null },
    ])
    const { index, cid } = await indexOf(later)

    const found = await discoverExecutors({ inputCid: cid }, index, { trustedIssuers: trusted, now: NOW })

    const reason = found.excluded[0]?.reason
    expect(reason?.kind === 'critical-extension-not-understood' ? reason.extensionIds : null).toEqual([
      'urn:o2:unknown-a',
      'urn:o2:unknown-b',
    ])
  })

  it('qualifies a node whose critical extension this reader declares it understands', async () => {
    const auth = authority()
    const later = await node(auth, 24, [{ id: UNKNOWN, critical: true, value: { policy: 'refuse' } }])
    const { index, cid } = await indexOf(later)

    const found = await discoverExecutors({ inputCid: cid }, index, {
      trustedIssuers: trusted,
      now: NOW,
      understands: new Set([UNKNOWN]),
    })

    expect(found.excluded).toEqual([])
    expect(found.executors.map((one) => one.nodeKey)).toEqual([later.nodeKey])
  })

  it('understands nothing by default, so the omission of the option fails closed', async () => {
    const auth = authority()
    const later = await node(auth, 25, [{ id: UNKNOWN, critical: true, value: null }])
    const { index, cid } = await indexOf(later)

    // No `understands`. The default is the empty registry this build ships with, so the
    // node is refused — the opposite disposition from the "optional hook with a silent
    // default" this repository refuses elsewhere, and it is opposite on purpose.
    const found = await discoverExecutors({ inputCid: cid }, index, { trustedIssuers: trusted, now: NOW })
    expect(found.excluded[0]?.reason.kind).toBe('critical-extension-not-understood')
  })
})
