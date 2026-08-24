import { ed25519 } from '@noble/curves/ed25519.js'
import { describe, expect, it } from 'vitest'
import {
  CERTIFICATE_RENEW_AT,
  CertificateHolder,
  EnrollmentAuthority,
  msUntilRenewalDue,
  requestEnrollment,
  shouldRenewCertificate,
} from './enrollment.ts'
import type { NodeCertificate } from './enrollment.ts'

/**
 * AUTH-04 — **the arithmetic of keeping a certificate alive**, and the one cell it lives
 * in.
 *
 * Plain `.test.ts`, so this runs in the node project and in all three browser engines. A
 * tab renews on exactly the fraction a server does — the rule this repository states as
 * *"all nodes have equal functionality; the only difference is discovery"* — and a tier
 * that computed a different one would have a different reachability window with nothing
 * in a certificate recording which produced it.
 *
 * The loop itself lives in `@o2/libp2p` because it needs a timer. What is checked here is
 * everything that does not: when renewal is due, how long until it is, and the refusal
 * that stops an out-of-order renewal from shortening a node's own window.
 */

const NOW = 1_800_000_000_000

function certificate(issuedAt: number, expiresAt: number): NodeCertificate {
  // Only the two clock fields are read by anything under test, but a hand-built object
  // literal would drift from the real shape the first time a field is added. So this is a
  // real issued certificate with its window rewritten.
  return { ...real, issuedAt, expiresAt }
}

const authority = new EnrollmentAuthority({
  providerPrivateKey: new Uint8Array(32).fill(7),
  maxPerWindow: 100,
  maxIssuedPerWindow: 'issues-without-an-aggregate-budget',
  issuance: 'remembers-only-within-this-process',
})
const issued = authority.enrol(
  await requestEnrollment(new Uint8Array(32).fill(8), new Uint8Array(32).fill(9), {
    operatorId: 'ops',
    discoverability: 'seed',
    relayIds: [],
  }),
  NOW,
)
if (!issued.ok) throw new Error(`fixture enrolment failed: ${issued.reason}`)
const real: NodeCertificate = issued.certificate

describe('AUTH-04 — when a node should start trying to renew', () => {
  it('is two-thirds of the way through, not at the deadline', () => {
    // **The span is chosen so two-thirds is an exact integer, and the instants below are
    // written as literals rather than as `span * CERTIFICATE_RENEW_AT`.** The first
    // version of this case did the latter and a plant setting the constant to `1` — renew
    // at the deadline, the exact defect the fraction exists to prevent — left it green:
    // both sides moved together, so it checked that the function agreed with the constant
    // and never that the constant was two-thirds. It is recorded here because it is the
    // same mistake `issuance-rate.node.test.ts` made in the same week.
    const cert = certificate(NOW, NOW + 3_000_000)

    expect(shouldRenewCertificate(cert, NOW + 1_999_999)).toBe(false)
    // The remaining third is what the two-round exchange gets to happen in, against a
    // provider that may be down.
    expect(shouldRenewCertificate(cert, NOW + 2_000_000)).toBe(true)
    // And the constant itself, so a change to it is a change somebody has to make here.
    expect(CERTIFICATE_RENEW_AT).toBeCloseTo(2 / 3, 12)
  })

  it('stays true after expiry, which is where it deliberately disagrees with shouldRenew', () => {
    // `lease.ts`' `shouldRenew` answers false once a lease has lapsed: the worker lost the
    // task and should stop. A certificate is the opposite — a node whose issuer was down
    // across the whole window is now refused by every peer and cannot get back in by
    // giving up. If this ever returns false here, a node that missed its window is out of
    // the fabric until somebody restarts it.
    const cert = certificate(NOW, NOW + 1000)

    expect(shouldRenewCertificate(cert, NOW + 5_000_000)).toBe(true)
  })

  it('treats a certificate with no positive span as already due', () => {
    expect(shouldRenewCertificate(certificate(NOW, NOW), NOW)).toBe(true)
    expect(shouldRenewCertificate(certificate(NOW, NOW - 1), NOW)).toBe(true)
  })
})

describe('AUTH-04 — how long a caller waits before asking', () => {
  it('is the distance to two-thirds while that is still ahead', () => {
    // Literal, for the reason the case above records at length.
    const cert = certificate(NOW, NOW + 3_000_000)

    expect(msUntilRenewalDue(cert, NOW, 60_000)).toBe(2_000_000)
    // Half-way through, a third of the span is left before it is due.
    expect(msUntilRenewalDue(cert, NOW + 1_500_000, 60_000)).toBe(500_000)
  })

  it('never returns zero or less, however overdue', () => {
    // A caller arms a timer with this. A zero would spin, and a negative is a timer that
    // fires immediately forever — the shape that turns a down provider into a busy loop.
    const cert = certificate(NOW, NOW + 1000)

    expect(msUntilRenewalDue(cert, NOW + 9_000_000, 60_000)).toBe(60_000)
    expect(msUntilRenewalDue(certificate(NOW, NOW), NOW, 60_000)).toBe(60_000)
  })
})

describe('AUTH-04 — the one cell a certificate lives in', () => {
  it('accepts a strictly newer certificate and reports that it did', () => {
    const holder = new CertificateHolder(certificate(NOW, NOW + 1000))

    expect(holder.replace(certificate(NOW + 500, NOW + 1500))).toBe(true)
    expect(holder.current?.issuedAt).toBe(NOW + 500)
  })

  it('refuses one that is not newer, so an out-of-order renewal cannot shorten the window', () => {
    // Two exchanges overlapping, or a provider replaying an older signature. Either way
    // the node must not end up holding the shorter window: it would go on believing it is
    // enrolled while peers running `verifyCertificate` had already discarded it.
    const holder = new CertificateHolder(certificate(NOW + 500, NOW + 5000))

    expect(holder.replace(certificate(NOW, NOW + 1000))).toBe(false)
    expect(holder.current?.expiresAt).toBe(NOW + 5000)
    // Equal is not newer either — a replay of the identical certificate is a no-op, and a
    // caller told `true` would republish for nothing.
    expect(holder.replace(certificate(NOW + 500, NOW + 5000))).toBe(false)
  })

  it('takes the first certificate a node with none is given', () => {
    // A node that started unenrolled and later obtained one. `null` is not a window, so
    // there is nothing for the monotonicity rule to compare against.
    const holder = new CertificateHolder(null)

    expect(holder.current).toBeNull()
    expect(holder.replace(certificate(NOW, NOW + 1000))).toBe(true)
    expect(holder.current).not.toBeNull()
  })
})
