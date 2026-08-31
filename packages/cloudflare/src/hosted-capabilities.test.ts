/**
 * HOST-04's guard — the hosted tier's record carries no execution, and cannot grow one
 * quietly.
 *
 * ## Why this asserts over the producer's OUTPUT and not over its source
 *
 * A source-level rule ("no file under `packages/cloudflare/src` writes a non-empty
 * `features`") would pass for a record assembled from a variable, from a spread, or from a
 * default two files away. The record is what the fabric reads, so the record is what is
 * asserted — signed by the real `publishCapabilities`, verified by the real
 * `verifyCapabilityRecord`, and read field by field.
 *
 * ## The three plants these cases exist for
 *
 * 1. `features: ['simd128']` — the shape of the defect: a hosted node claiming an engine
 *    feature it has no engine to run.
 * 2. `sovereignFor: [someUserKey]` — the sovereign half, which is the more dangerous one,
 *    because the sovereign branch of `discoverExecutors` matches on it directly.
 * 3. a default window — the record signing a lifetime nobody chose.
 */

import { verifyCapabilityRecord } from '@o2/core'
import { identityFromSeed } from '@o2/libp2p'
import { describe, expect, it } from 'vitest'
import { hostedCapabilities } from './hosted-capabilities.ts'
import type { NodeIdentity } from '@o2/libp2p'

/**
 * A deterministic identity, built by the real derivation.
 *
 * Not a hand-assembled object behind an assertion: this tree does not permit `as`, and a
 * partial stand-in would let the producer read a field the real `NodeIdentity` populates
 * differently. `identityFromSeed` is the same function `hostedIdentity` ends in.
 */
const IDENTITY: NodeIdentity = await identityFromSeed(new Uint8Array(32).fill(7))

const WINDOW = { issuedAt: 1_000, expiresAt: 3_600_000 }

describe('HOST-04 — the hosted tier never advertises execution', () => {
  it('publishes NO engine feature, because there is no engine to detect one with', () => {
    // Written as a literal empty array rather than against a constant the producer also
    // reads: an assertion that reuses the value under test moves with it and can never
    // disagree. Plant that reddens this: `features: ['simd128']`.
    expect(hostedCapabilities(IDENTITY, WINDOW).features).toEqual([])
  })

  it('publishes NO sovereign key, so the sovereign branch can never match it', () => {
    // `discoverExecutors` compares `ExecutorQuery.sovereignFor` against this list directly
    // (`core/src/discovery.ts`). A single entry here is a signed claim that this node can
    // decrypt AND execute someone's sovereign data — the second half of which this runtime
    // cannot do. Plant that reddens this: `sovereignFor: [certificate.userKey]`.
    expect(hostedCapabilities(IDENTITY, WINDOW).sovereignFor).toEqual([])
  })

  it('states its extensions rather than omitting them', () => {
    // "I have none" and "I forgot" must not be the same expression — the seam's own reason.
    expect(hostedCapabilities(IDENTITY, WINDOW).extensions).toEqual([])
  })

  it('signs the window it was GIVEN, and has no window of its own to fall back on', () => {
    // A default here would mint a second lifetime policy free to drift from the
    // certificate's. Two different windows must produce two different records.
    const early = hostedCapabilities(IDENTITY, { issuedAt: 10, expiresAt: 20 })
    const late = hostedCapabilities(IDENTITY, { issuedAt: 30, expiresAt: 40 })

    expect(early.issuedAt).toBe(10)
    expect(early.expiresAt).toBe(20)
    expect(late.issuedAt).toBe(30)
    expect(early.signature).not.toBe(late.signature)
  })

  it('produces a record the fabric’s own verifier accepts — so the emptiness is not a defect', () => {
    // Anti-vacuity in the other direction. Three empty lists would also be produced by a
    // function that returned a malformed record, and every assertion above would still
    // pass. This is what says the record is real.
    expect(verifyCapabilityRecord(hostedCapabilities(IDENTITY, WINDOW), 2_000)).toBe(true)
  })

  it('is REFUSED by the verifier once its window has passed, like every other record here', () => {
    expect(verifyCapabilityRecord(hostedCapabilities(IDENTITY, WINDOW), 3_600_001)).toBe(false)
  })
})
