import { ed25519 } from '@noble/curves/ed25519.js'
import { describe, expect, it } from 'vitest'
import { toHex } from './capability.ts'
import {
  EnrollmentAuthority,
  honoursKeyCommitment,
  keyCommitment,
  requestEnrollment,
  verifyCertificate,
} from './enrollment.ts'
import type { PublicKeyHex } from './capability.ts'
import type { NodeCertificate } from './enrollment.ts'

/**
 * AUTH-05 — **a node can announce the key it will move to, before it moves.**
 *
 * Owner ruling 2026-08-23. Today a node that changes its key becomes a stranger to every
 * peer: nothing links the new `nodeKey` to the old one, so the new identity is trusted
 * from scratch — and the gap where an attacker can claim to *be* the rotated node is
 * exactly that. A commitment closes it: the certificate a node holds now, signed by an
 * issuer peers already accept, names the key it will move to.
 *
 * Plain `.test.ts` — node and all three browser engines, because a tab rotates on the same
 * terms a server does.
 *
 * **This is the format and the check. Nothing rotates yet.** The field lands now because
 * the alternative is changing a signed format later, with certificates in circulation.
 */

const NOW = 1_800_000_000_000
const providerSeed = new Uint8Array(32).fill(0x71)
const userSeed = new Uint8Array(32).fill(0x72)

function authority(): EnrollmentAuthority {
  return new EnrollmentAuthority({
    providerPrivateKey: providerSeed,
    maxPerWindow: 100,
    maxIssuedPerWindow: 'issues-without-an-aggregate-budget',
    issuance: 'remembers-only-within-this-process',
  })
}

async function issue(
  auth: EnrollmentAuthority,
  nodeSeed: Uint8Array,
  nextKeyCommitment?: string,
): Promise<NodeCertificate> {
  const outcome = auth.enrol(
    await requestEnrollment(nodeSeed, userSeed, {
      operatorId: 'ops',
      discoverability: 'seed',
      relayIds: [],
      ...(nextKeyCommitment === undefined ? {} : { nextKeyCommitment }),
    }),
    NOW,
  )
  if (!outcome.ok) throw new Error(`enrolment failed: ${outcome.reason}`)
  return outcome.certificate
}

function keyOf(seed: Uint8Array): PublicKeyHex {
  return toHex(ed25519.getPublicKey(seed))
}

describe('AUTH-05 — the commitment itself', () => {
  it('is a hash, so the certificate does not reveal the key it names', () => {
    const nextSeed = new Uint8Array(32).fill(0x73)
    const commitment = keyCommitment(keyOf(nextSeed))

    // The whole point. Publishing the next public key early would let an attacker work
    // against it before its owner ever used it, and would link the two identities in the
    // keyspace long before the rotation happened.
    expect(commitment).not.toContain(keyOf(nextSeed))
    expect(commitment).not.toBe(keyOf(nextSeed))
    // Deterministic, or two nodes computing it from the same key would disagree.
    expect(keyCommitment(keyOf(nextSeed))).toBe(commitment)
  })

  it('names one key and not another', () => {
    expect(keyCommitment(keyOf(new Uint8Array(32).fill(0x73)))).not.toBe(
      keyCommitment(keyOf(new Uint8Array(32).fill(0x74))),
    )
  })
})

describe('AUTH-05 — carrying it through issuance', () => {
  it('puts the joiner’s commitment inside the issuer’s signature', async () => {
    const auth = authority()
    const nextSeed = new Uint8Array(32).fill(0x75)
    const commitment = keyCommitment(keyOf(nextSeed))
    const cert = await issue(auth, new Uint8Array(32).fill(0x76), commitment)

    expect(cert.nextKeyCommitment).toBe(commitment)
    // Signed, not merely attached. If the commitment sat outside the payload, anyone could
    // graft their own onto somebody else's envelope and name the key a rotated node moves
    // to — which is the attack the whole mechanism is supposed to close, inverted.
    expect(verifyCertificate(cert, new Set([auth.issuerKey]), NOW + 1000).ok).toBe(true)
    const tampered: NodeCertificate = {
      ...cert,
      nextKeyCommitment: keyCommitment(keyOf(new Uint8Array(32).fill(0x77))),
    }
    expect(
      verifyCertificate(tampered, new Set([auth.issuerKey]), NOW + 1000).ok,
      'a certificate whose commitment was swapped still verified',
    ).toBe(false)
  })

  it('leaves a certificate without one byte-identical to what was always issued', async () => {
    // Compatibility, and it is not theoretical: every certificate this repository has ever
    // signed must still verify. `payloadOf` omits the key entirely rather than encoding a
    // null, so an absent commitment changes no bytes.
    const auth = authority()
    const cert = await issue(auth, new Uint8Array(32).fill(0x78))

    expect(cert.nextKeyCommitment).toBeUndefined()
    expect(verifyCertificate(cert, new Set([auth.issuerKey]), NOW + 1000).ok).toBe(true)
  })

  it('does not invent a commitment the node never made', async () => {
    // Only the node knows its own next key. A commitment the node did not choose is one it
    // can never honour, so an authority that helpfully supplied one would be minting a
    // promise on somebody else's behalf.
    const auth = authority()
    expect((await issue(auth, new Uint8Array(32).fill(0x79))).nextKeyCommitment).toBeUndefined()
  })
})

describe('AUTH-05 — whether a rotation was the one announced', () => {
  it('accepts the key the previous certificate committed to', async () => {
    const auth = authority()
    const nextSeed = new Uint8Array(32).fill(0x7a)
    const previous = await issue(auth, new Uint8Array(32).fill(0x7b), keyCommitment(keyOf(nextSeed)))
    const next = await issue(auth, nextSeed)

    expect(honoursKeyCommitment(previous, next)).toBe(true)
  })

  it('refuses a different key, however valid its own certificate is', async () => {
    const auth = authority()
    const announced = new Uint8Array(32).fill(0x7c)
    const previous = await issue(auth, new Uint8Array(32).fill(0x7d), keyCommitment(keyOf(announced)))
    // A perfectly good certificate for a perfectly good node — just not the one announced.
    const impostor = await issue(auth, new Uint8Array(32).fill(0x7e))

    expect(verifyCertificate(impostor, new Set([auth.issuerKey]), NOW + 1000).ok).toBe(true)
    expect(honoursKeyCommitment(previous, impostor)).toBe(false)
  })

  it('refuses when no commitment was ever made, collapsing that with a mismatch', async () => {
    // Deliberately the same answer as a mismatch. A caller acts identically on "no
    // commitment was made" and "the commitment does not match" — both mean this rotation
    // was not pre-announced and must be trusted on its own terms. Splitting them would invite a
    // caller to treat the first as benign, which is the fail-open this prevents.
    const auth = authority()
    const previous = await issue(auth, new Uint8Array(32).fill(0x7f))
    const next = await issue(auth, new Uint8Array(32).fill(0x80))

    expect(previous.nextKeyCommitment).toBeUndefined()
    expect(honoursKeyCommitment(previous, next)).toBe(false)
  })

  it('does not require the same issuer, because continuity is not admission', async () => {
    // A node that rotates while moving between issuers still honoured what it committed
    // to. Whether the new issuer is acceptable is `trustedIssuers`' question, and folding
    // it in here would make a continuity check silently also a trust decision — with a
    // reader unable to tell which one they had.
    const first = authority()
    const second = new EnrollmentAuthority({
      providerPrivateKey: new Uint8Array(32).fill(0x81),
      maxPerWindow: 100,
      maxIssuedPerWindow: 'issues-without-an-aggregate-budget',
      issuance: 'remembers-only-within-this-process',
    })
    const nextSeed = new Uint8Array(32).fill(0x82)
    const previous = await issue(first, new Uint8Array(32).fill(0x83), keyCommitment(keyOf(nextSeed)))
    const next = await issue(second, nextSeed)

    expect(next.issuer).not.toBe(previous.issuer)
    expect(honoursKeyCommitment(previous, next)).toBe(true)
  })
})
