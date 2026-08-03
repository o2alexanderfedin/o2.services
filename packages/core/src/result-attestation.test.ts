import { ed25519 } from '@noble/curves/ed25519.js'
import type { CID } from 'multiformats/cid'
import { describe, expect, it } from 'vitest'
import { canonicalCid } from './canonical/encode.ts'
import { toHex } from './capability.ts'
import { EnrollmentAuthority, requestEnrollment } from './enrollment.ts'
import type { NodeCertificate } from './enrollment.ts'
import {
  WrongSigningKeyError,
  combineChallenge,
  resultChallenge,
  signResult,
  verifyResultAttestation,
} from './result-attestation.ts'
import type { ResultWork } from './result-attestation.ts'

/**
 * VER-08, VER-09, VER-10 — the third signing leg.
 *
 * Every refusal case asserts the **kind**, never merely `ok === false`. A single kind
 * for all three questions would be indistinguishable from a verifier that answers "no"
 * to everything, and this file's whole subject is that a stranger is told *which* of
 * three things failed.
 */

function keypair(seed: number): { priv: Uint8Array; pub: string } {
  const priv = new Uint8Array(32).fill(seed)
  return { priv, pub: toHex(ed25519.getPublicKey(priv)) }
}

const provider = keypair(70)
const rogueProvider = keypair(71)
const alice = keypair(72)
const NOW = 1_800_000_000_000

const PINNED: ReadonlySet<string> = new Set([provider.pub])

function authorityFor(providerKey: Uint8Array): EnrollmentAuthority {
  return new EnrollmentAuthority({ providerPrivateKey: providerKey, maxPerWindow: 50 })
}

/** A real node identity: a seed and the certificate a real authority issued for it. */
function enrolled(
  seed: number,
  issuer: Uint8Array = provider.priv,
): { nodeSeed: Uint8Array; certificate: NodeCertificate } {
  const node = keypair(seed)
  const result = authorityFor(issuer).enrol(
    requestEnrollment(node.priv, alice.priv, {
      operatorId: `op-${seed}`,
      discoverability: 'via-relay',
      relayIds: ['relay-1'],
    }),
    NOW,
  )
  if (!result.ok) throw new Error('fixture failed to enrol')
  return { nodeSeed: node.priv, certificate: result.certificate }
}

let cidCounter = 0
async function cid(label: string): Promise<CID> {
  cidCounter += 1
  const hashed = await canonicalCid({ label, n: cidCounter })
  if (!hashed.ok) throw new Error('fixture cid failed to encode')
  return hashed.cid
}

async function work(overrides: Partial<ResultWork> = {}): Promise<ResultWork> {
  return {
    moduleCid: await cid('module'),
    inputCid: await cid('input'),
    partitionIndex: 0,
    outputCid: await cid('output'),
    ...overrides,
  }
}

describe('a stranger holding only the provider key can check a result', () => {
  it('accepts a statement a certified node signed over this exact work', async () => {
    const node = enrolled(1)
    const task = await work()

    const attestation = signResult(node, task)
    const checked = verifyResultAttestation(attestation, task, PINNED, NOW)

    expect(checked.ok).toBe(true)
    if (!checked.ok) return
    // All three questions answered: the certificate verified against a pinned issuer,
    // the signature verified, and the certificate names the key that signed.
    expect(checked.certificate.nodeKey).toBe(toHex(ed25519.getPublicKey(node.nodeSeed)))
    expect(checked.certificate.issuer).toBe(provider.pub)
    expect(attestation.certificate).toBe(node.certificate)
  })

  it('carries the whole certificate, so nothing has to be fetched to check it', async () => {
    const node = enrolled(2)
    const attestation = signResult(node, await work())
    // The reader is given the issuer, the validity window and the signing key without
    // resolving anything. A bare node key would need an out-of-band lookup, and a
    // reader who has to fetch is not a reader holding only the provider's public key.
    expect(Object.keys(attestation).sort()).toEqual(['certificate', 'signature'])
    expect(attestation.certificate.issuer).toBe(provider.pub)
    // And the key is not repeated beside the certificate — one value, one place.
    expect(Object.keys(attestation)).not.toContain('nodeKey')
  })
})

describe('the statement is bound to the work, the answer and the signer', () => {
  it('does not verify against a different partition of the same input', async () => {
    const node = enrolled(3)
    const shard0 = await work({ partitionIndex: 0 })
    const shard1 = { ...shard0, partitionIndex: 1 }

    const attestation = signResult(node, shard0)

    expect(verifyResultAttestation(attestation, shard0, PINNED, NOW).ok).toBe(true)
    const lifted = verifyResultAttestation(attestation, shard1, PINNED, NOW)
    expect(lifted.ok).toBe(false)
    if (lifted.ok) return
    expect(lifted.failure.kind).toBe('bad-result-signature')
  })

  it('does not verify against a different module or input', async () => {
    const node = enrolled(4)
    const task = await work()

    const attestation = signResult(node, task)

    const otherModule = { ...task, moduleCid: await cid('other-module') }
    const otherInput = { ...task, inputCid: await cid('other-input') }
    for (const lifted of [otherModule, otherInput]) {
      const checked = verifyResultAttestation(attestation, lifted, PINNED, NOW)
      expect(checked.ok).toBe(false)
      if (checked.ok) continue
      expect(checked.failure.kind).toBe('bad-result-signature')
    }
  })

  it('does not verify against a different answer', async () => {
    const node = enrolled(5)
    const task = await work()

    const attestation = signResult(node, task)

    const differentAnswer = { ...task, outputCid: await cid('a-different-answer') }
    const checked = verifyResultAttestation(attestation, differentAnswer, PINNED, NOW)
    expect(checked.ok).toBe(false)
    if (checked.ok) return
    expect(checked.failure.kind).toBe('bad-result-signature')
  })

  it("does not verify as another node's, even with that node's own certificate", async () => {
    const a = enrolled(6)
    const b = enrolled(7)
    const task = await work()

    // A's signature presented under B's certificate.
    const forged = { certificate: b.certificate, signature: signResult(a, task).signature }

    const checked = verifyResultAttestation(forged, task, PINNED, NOW)
    expect(checked.ok).toBe(false)
    if (checked.ok) return
    expect(checked.failure.kind).toBe('bad-result-signature')
    // …and B's own certificate verified fine. The refusal is about the signature.
    expect(b.certificate.nodeKey).not.toBe(a.certificate.nodeKey)
  })

  it('gives two nodes different bytes to sign for the same shard and the same answer', async () => {
    const a = enrolled(17)
    const b = enrolled(18)
    const task = await work()

    // This — not the case above — is the reading that `nodeKey`-in-the-challenge
    // carries. The case above passes with `nodeKey` deleted from the encoding, because
    // Ed25519 already refuses A's signature under B's key whatever bytes were signed.
    // What goes when the field goes is that two honest replicas of one shard sign
    // byte-identical challenges, and an attestation stops being self-describing.
    expect(a.certificate.nodeKey).not.toBe(b.certificate.nodeKey)
    expect(toHex(resultChallenge(task, a.certificate.nodeKey))).not.toBe(
      toHex(resultChallenge(task, b.certificate.nodeKey)),
    )
  })
})

describe('each of the three questions is refused by its own name', () => {
  it('names the issuer, not the signature, when the provider is not pinned', async () => {
    const stranger = enrolled(8, rogueProvider.priv)
    const task = await work()

    // The result signature here is perfectly good. Only the issuer is unpinned.
    const attestation = signResult(stranger, task)

    const checked = verifyResultAttestation(attestation, task, PINNED, NOW)
    expect(checked.ok).toBe(false)
    if (checked.ok) return
    expect(checked.failure.kind).toBe('untrusted-certificate')
    if (checked.failure.kind !== 'untrusted-certificate') return
    // Forwarded from `verifyCertificate` under the name it already gives.
    expect(checked.failure.failure.kind).toBe('untrusted-issuer')
    // And the signature really was good — checked against the issuer's own anchors.
    expect(verifyResultAttestation(attestation, task, new Set([rogueProvider.pub]), NOW).ok).toBe(
      true,
    )
  })

  it('says it does not trust the issuer before it says the peer forged anything', async () => {
    const stranger = enrolled(19, rogueProvider.priv)
    const task = await work()

    // Both questions fail: the provider is not pinned AND the signature is for other
    // work. This is the only shape in which the check order is observable — with a
    // *good* signature the order does not change the answer, because a signature-first
    // verifier falls through to the certificate check and reports the same thing.
    //
    // The order matters because verifying a signature under a key taken from a
    // certificate nobody vouched for is checking nothing at all. Reporting that as
    // `bad-result-signature` accuses a peer of forging using a key this verifier never
    // had any reason to associate with it; `untrusted-certificate` is the honest
    // answer, and it is a statement about this verifier's own pinning.
    const lifted = signResult(stranger, { ...task, partitionIndex: 41 })

    const checked = verifyResultAttestation(lifted, task, PINNED, NOW)
    expect(checked.ok).toBe(false)
    if (checked.ok) return
    expect(checked.failure.kind).toBe('untrusted-certificate')
    // …and the signature really is bad, so this is a choice between two true
    // statements rather than a lucky pass.
    expect(
      verifyResultAttestation(lifted, task, new Set([rogueProvider.pub]), NOW),
    ).toMatchObject({ ok: false, failure: { kind: 'bad-result-signature' } })
  })

  it('forwards expiry under its own name too', async () => {
    const node = enrolled(9)
    const task = await work()
    const attestation = signResult(node, task)

    const checked = verifyResultAttestation(
      attestation,
      task,
      PINNED,
      node.certificate.expiresAt + 1,
    )
    expect(checked.ok).toBe(false)
    if (checked.ok) return
    expect(checked.failure.kind).toBe('untrusted-certificate')
    if (checked.failure.kind !== 'untrusted-certificate') return
    expect(checked.failure.failure.kind).toBe('expired')
  })

  it('names an absent statement as absent, not as a bad signature', async () => {
    const checked = verifyResultAttestation('signed-by-nobody', await work(), PINNED, NOW)
    expect(checked.ok).toBe(false)
    if (checked.ok) return
    // A node that signs nothing is a truthful state, not misconduct. Reporting it as
    // `bad-result-signature` would accuse an honest peer of forging.
    expect(checked.failure.kind).toBe('not-attested')
  })

  it('gives the three refusals three distinguishable kinds', async () => {
    const node = enrolled(10)
    const stranger = enrolled(11, rogueProvider.priv)
    const task = await work()

    const kinds = [
      verifyResultAttestation('signed-by-nobody', task, PINNED, NOW),
      verifyResultAttestation(signResult(stranger, task), task, PINNED, NOW),
      verifyResultAttestation(signResult(node, { ...task, partitionIndex: 99 }), task, PINNED, NOW),
    ].map((checked) => (checked.ok ? 'accepted' : checked.failure.kind))

    expect(kinds).toEqual(['not-attested', 'untrusted-certificate', 'bad-result-signature'])
    expect(new Set(kinds).size).toBe(3)
  })
})

describe('a node can only sign for a key it holds', () => {
  it('refuses a seed whose public half the certificate does not name', async () => {
    const node = enrolled(12)
    const somebodyElse = keypair(13)
    const task = await work()

    expect(() =>
      signResult({ nodeSeed: somebodyElse.priv, certificate: node.certificate }, task),
    ).toThrow(WrongSigningKeyError)
  })

  it('derives the signing key rather than accepting one', async () => {
    const node = enrolled(14)
    const task = await work()
    // There is no field on `ResultSigner` through which a caller could name another
    // node's key — the same discipline `requestEnrollment` applies to `userKey`.
    const attestation = signResult(node, task)
    expect(attestation.certificate.nodeKey).toBe(toHex(ed25519.getPublicKey(node.nodeSeed)))
  })
})

describe('the challenges are domain-separated and order-honest', () => {
  it('gives exec and combine different bytes for the same values', async () => {
    const node = enrolled(15)
    const task = await work()
    const nodeKey = node.certificate.nodeKey

    const exec = resultChallenge(task, nodeKey)
    const combine = combineChallenge([task.moduleCid, task.inputCid], task.outputCid, nodeKey)

    expect(toHex(exec)).not.toBe(toHex(combine))
  })

  it('signs a combine over its inputs in merge order, never sorted', async () => {
    const node = enrolled(16)
    const nodeKey = node.certificate.nodeKey
    const resultCid = await cid('merged')
    // Two orderings of one input set. A combine's output depends on input order, so
    // these are statements about different work and must not share bytes. `payloadOf`
    // sorts `relayIds` — correctly, a relay set is a set — and copying that reflex
    // here would make the two identical.
    const first = await cid('partial-a')
    const second = await cid('partial-b')

    const forward = combineChallenge([first, second], resultCid, nodeKey)
    const reversed = combineChallenge([second, first], resultCid, nodeKey)

    expect(toHex(forward)).not.toBe(toHex(reversed))
    // And the encoding is stable for the same order — otherwise nothing would verify.
    expect(toHex(combineChallenge([first, second], resultCid, nodeKey))).toBe(toHex(forward))
  })
})
