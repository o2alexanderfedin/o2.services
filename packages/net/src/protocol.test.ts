import { ed25519 } from '@noble/curves/ed25519.js'
import { MemoryBlockstore, SignedNameResolver, delegate, signName, toHex } from '@o2/core'
import type { CanonicalValue, NameRecord } from '@o2/core'
import { describe, expect, it } from 'vitest'
// Test-only relative import, the same one `distributed.test.ts` documents: `@o2/core`'s
// export map exposes only its public entry, and adding a fixtures export would modify
// the kernel package. Reaching the file directly keeps the fixture DRY.
import { MODULE_WRITES_PARTITION } from '../../core/src/executor/fixtures.ts'
import { encodeRequest, encodeResponse, parseRequest, parseResponse } from './protocol.ts'

/**
 * DET-03 / DATA-08 at the wire — a signed name record survives the crossing.
 *
 * `guardModuleProvenance` (`@o2/core`, Plan 14-01) refuses a task whose module was not
 * vouched for. It reads `task.moduleRecord`. This file is about the only route by which
 * a record reaches a *remote* node's copy of that guard: `encodeRequest` on one side,
 * `parseRequest` on the other.
 *
 * The strong assertion here is not field equality — it is re-verification. A signature
 * is over exact bytes, so a field dropped, re-typed or reordered in transit invalidates
 * the record even when a shallow comparison still passes. So every round trip ends by
 * offering the *parsed* record to a resolver pinned to the fixture's own public key.
 */

function keypair(seed: number): { priv: Uint8Array; pub: string } {
  const priv = new Uint8Array(32).fill(seed)
  return { priv, pub: toHex(ed25519.getPublicKey(priv)) }
}

const publisher = keypair(23)

const NOW = 1_800_000_000_000
const EXPIRES = NOW + 86_400_000

/**
 * The CID a blockstore computes for the fixture module.
 *
 * Derived through `MemoryBlockstore.put` rather than parsed from a literal, because
 * that is the code path a real dispatcher's module CID comes from, and a literal could
 * not drift with it.
 */
const moduleCid = await new MemoryBlockstore().put(MODULE_WRITES_PARTITION)

const record: NameRecord = signName(publisher.priv, {
  name: 'colouring',
  cid: moduleCid,
  version: 1,
  expiresAt: EXPIRES,
})

/** A well-formed exec frame, minus whatever the caller wants to corrupt. */
function execFrame(moduleRecord: CanonicalValue): CanonicalValue {
  return {
    kind: 'exec',
    moduleCid,
    inputCid: moduleCid,
    partitionIndex: 0,
    partitionCount: 1,
    label: 'public',
    moduleRecord,
  }
}

/** The six fields as canonical values, so one at a time can be replaced. */
function recordValue(overrides: { readonly [k: string]: CanonicalValue }): CanonicalValue {
  return {
    name: record.name,
    cid: record.cid,
    version: record.version,
    expiresAt: record.expiresAt,
    signer: record.signer,
    signature: record.signature,
    ...overrides,
  }
}

describe('DET-03 — a signed module record crosses the wire and still verifies', () => {
  it('round-trips every field, and the parsed record re-verifies against its anchor', () => {
    const encoded = encodeRequest({
      kind: 'exec',
      task: {
        moduleCid,
        inputCid: moduleCid,
        partitionIndex: 0,
        partitionCount: 1,
        label: 'public',
        moduleRecord: record,
      },
    })
    const parsed = parseRequest(encoded)

    expect(parsed).not.toBeNull()
    if (parsed === null || parsed.kind !== 'exec') return
    const carried = parsed.task.moduleRecord
    expect(carried).toBeDefined()
    if (carried === undefined) return

    expect(carried.name).toBe(record.name)
    expect(carried.cid.toString()).toBe(record.cid.toString())
    expect(carried.version).toBe(record.version)
    expect(carried.expiresAt).toBe(record.expiresAt)
    expect(carried.signer).toBe(record.signer)
    expect(carried.signature).toBe(record.signature)

    // The assertion that matters. Field equality can pass on a record whose numbers
    // were widened or whose CID was rebuilt under a different codec; re-verification
    // cannot, because the signature is over the canonical encoding of five of these
    // six fields.
    expect(new SignedNameResolver([publisher.pub]).accept(carried, NOW).ok).toBe(true)
  })

  it('encodes no moduleRecord key at all for a task that has none', () => {
    const encoded = encodeRequest({
      kind: 'exec',
      task: {
        moduleCid,
        inputCid: moduleCid,
        partitionIndex: 0,
        partitionCount: 1,
        label: 'public',
      },
    })

    // `Object.hasOwn`, not an `undefined` comparison: this project's canonical
    // encoding treats an explicit `undefined` key as a different shape from an absent
    // one, and an `undefined` comparison would pass against either.
    expect(Object.hasOwn(encoded as object, 'moduleRecord')).toBe(false)

    const parsed = parseRequest(encoded)
    expect(parsed).not.toBeNull()
    if (parsed === null || parsed.kind !== 'exec') return
    expect(Object.hasOwn(parsed.task, 'moduleRecord')).toBe(false)
  })

  it('carries a capability chain and a module record together without interference', () => {
    const chain = [
      delegate(keypair(24).priv, {
        ownerId: 'alice',
        audience: 'worker-key',
        abilities: ['execute'] as const,
        expiresAt: EXPIRES,
      }),
    ]

    const parsed = parseRequest(
      encodeRequest({
        kind: 'exec',
        task: {
          moduleCid,
          inputCid: moduleCid,
          partitionIndex: 0,
          partitionCount: 1,
          label: 'public',
          moduleRecord: record,
        },
        capability: chain,
      }),
    )

    expect(parsed).not.toBeNull()
    if (parsed === null || parsed.kind !== 'exec') return
    expect(parsed.capability).toEqual(chain)
    expect(parsed.task.moduleRecord).toBeDefined()
    // Both, verified: the two optional fields are decoded from the same frame and
    // neither may leave the other half-formed.
    expect(new SignedNameResolver([publisher.pub]).accept(parsed.task.moduleRecord!, NOW).ok).toBe(
      true,
    )
  })
})

describe('a malformed module record refuses the whole frame, one field at a time', () => {
  /**
   * Six cases, named for the field each corrupts.
   *
   * Named individually rather than looped over an anonymous list so a parser that
   * validated five fields and forgot one fails with the forgotten field in the test
   * name. Refusing the frame — rather than dropping the record and admitting the task —
   * is the behaviour under test: the alternative converts "this frame is corrupt" into
   * "this task arrived unsigned", and the provenance guard would then refuse it naming
   * the wrong problem.
   */
  it('refuses a name that is not a string', () => {
    expect(parseRequest(execFrame(recordValue({ name: 7 })))).toBeNull()
  })

  it('refuses a cid that is not a CID', () => {
    expect(parseRequest(execFrame(recordValue({ cid: 'bafy-not-a-cid' })))).toBeNull()
  })

  it('refuses a version that is not a non-negative integer', () => {
    // Negative, specifically: a record offering version -1 is one no monotonic check
    // can order, so it would slip past the resolver's rollback protection.
    expect(parseRequest(execFrame(recordValue({ version: -1 })))).toBeNull()
    expect(parseRequest(execFrame(recordValue({ version: 1.5 })))).toBeNull()
  })

  it('refuses an expiresAt that is not a finite number', () => {
    expect(parseRequest(execFrame(recordValue({ expiresAt: 'soon' })))).toBeNull()
  })

  it('refuses a signer that is not a string', () => {
    expect(parseRequest(execFrame(recordValue({ signer: 42 })))).toBeNull()
  })

  it('refuses a signature that is not a string', () => {
    expect(parseRequest(execFrame(recordValue({ signature: null })))).toBeNull()
  })

  it('refuses a moduleRecord that is not a record at all', () => {
    expect(parseRequest(execFrame('not-a-record'))).toBeNull()
    expect(parseRequest(execFrame([1, 2, 3]))).toBeNull()
    expect(parseRequest(execFrame(9))).toBeNull()
  })

  it('still admits the frame these cases were built from', () => {
    // The control. Every assertion above would pass against a parser that refused
    // every exec frame outright, so the uncorrupted frame is required to survive.
    const parsed = parseRequest(execFrame(recordValue({})))
    expect(parsed).not.toBeNull()
    if (parsed === null || parsed.kind !== 'exec') return
    expect(new SignedNameResolver([publisher.pub]).accept(parsed.task.moduleRecord!, NOW).ok).toBe(
      true,
    )
  })
})

/**
 * SCHED-02 / owner ruling D2 — the offer answer carries the node's own room.
 *
 * Two integers and a discriminant. The discriminant is the point: this file's
 * `found: true/false` idiom for `block`, `records` and `combine` exists because the
 * canonical encoding treats an explicit `undefined` key as a different shape from an
 * absent one, so "this node stated nothing" has to be a value the parser can read
 * rather than a gap it has to guess at.
 */
describe('the offer answer states the node’s room, or states that it states none', () => {
  it('round-trips a bounded answer', () => {
    const bounded = {
      kind: 'offer',
      accepted: true,
      reason: '',
      capacity: { slots: 4, inFlight: 1 },
    } as const
    expect(parseResponse(encodeResponse(bounded))).toStrictEqual(bounded)
  })

  it('round-trips a refusal that says how full', () => {
    const refusal = {
      kind: 'offer',
      accepted: false,
      reason: 'over-committed: 1 of 1 slots in use',
      capacity: { slots: 1, inFlight: 1 },
    } as const
    expect(parseResponse(encodeResponse(refusal))).toStrictEqual(refusal)
  })

  it('round-trips an answer that states no capacity', () => {
    const unbounded = { kind: 'offer', accepted: true, reason: '', capacity: null } as const
    expect(parseResponse(encodeResponse(unbounded))).toStrictEqual(unbounded)
  })

  it('refuses a corrupt capacity outright rather than softening it to an absence', () => {
    // The same disposition the `combine` arm takes, for the same reason: a peer able
    // to turn a corrupt answer into an ordinary "I state nothing" would be
    // indistinguishable from an honest node that states nothing — and a requestor
    // treats the latter as unbounded.
    const frame = (extra: Record<string, unknown>): CanonicalValue =>
      ({
        kind: 'offer',
        accepted: true,
        reason: '',
        bounded: true,
        slots: 2,
        inFlight: 0,
        ...extra,
      }) as CanonicalValue

    expect(parseResponse(frame({}))).not.toBeNull() // the control
    expect(parseResponse(frame({ slots: -1 }))).toBeNull()
    expect(parseResponse(frame({ inFlight: -1 }))).toBeNull()
    expect(parseResponse(frame({ slots: 1.5 }))).toBeNull()
    expect(parseResponse(frame({ inFlight: 'two' }))).toBeNull()
    expect(parseResponse(frame({ slots: undefined }))).toBeNull()
    expect(parseResponse(frame({ inFlight: undefined }))).toBeNull()
  })
})
