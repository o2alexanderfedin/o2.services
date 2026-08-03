import { MAX_COMBINE_INPUTS, MemoryBlockstore, MemoryNetwork } from '@o2/core'
import type { CanonicalValue, Executor } from '@o2/core'
import { CID } from 'multiformats/cid'
import { describe, expect, it } from 'vitest'
import { RpcEndpoint } from './rpc.ts'
import { blockCid } from './block.ts'
import { encodeRequest, encodeResponse, parseRequest, parseResponse } from './protocol.ts'
import { serveAgent } from './agent.ts'

/**
 * MR-03 / MR-06 — the combine frame, judged on its own.
 *
 * Deliberately about the codec and nothing else: no `FetchingBlockstore`, no
 * `WasmExecutor`, no fabric. A combine names its inputs by CID and carries no
 * payload, so everything worth asserting here is a shape or a refusal. Plan 16-02
 * adds the handler and its own tests; keeping them apart is what makes a failure
 * here unambiguous about which layer broke.
 */

/** `howMany` distinct CIDs, built the way the existing round-trip test builds one. */
async function cids(howMany: number): Promise<CID[]> {
  const made: CID[] = []
  for (let i = 0; i < howMany; i++) {
    made.push(await blockCid(new Uint8Array([i & 0xff, (i >> 8) & 0xff, 7])))
  }
  return made
}

/** An encoded combine frame naming `howMany` inputs. */
async function frameWith(howMany: number): Promise<CanonicalValue> {
  return {
    kind: 'combine',
    combineId: 'node-a',
    inputCids: await cids(howMany),
    level: 1,
  }
}

describe('MR-06 — a combine can be named on the wire', () => {
  it('round-trips through encodeRequest and parseRequest unchanged', async () => {
    const inputCids = await cids(4)
    const request = { kind: 'combine' as const, combineId: 'node-a', inputCids, level: 1 }

    const parsed = parseRequest(encodeRequest(request))

    expect(parsed).toEqual(request)
    // CIDs must survive the codec as CIDs, not as strings that merely print alike.
    expect(parsed?.kind).toBe('combine')
    if (parsed?.kind !== 'combine') return
    for (const cid of parsed.inputCids) {
      expect(CID.asCID(cid)).not.toBeNull()
    }
  })

  it('carries exactly four keys, all of them addresses', async () => {
    const encoded = encodeRequest({
      kind: 'combine',
      combineId: 'node-a',
      inputCids: await cids(3),
      level: 2,
    })

    // The property under test is that a combine frame carries addresses and nothing
    // else: a fifth key is how a payload would arrive. This guard fires on
    // *addition*, which is the direction the danger comes from.
    expect(Object.keys(encoded as object).sort()).toEqual([
      'combineId',
      'inputCids',
      'kind',
      'level',
    ])
  })
})

describe('MR-06 — a frame the tree could not have produced is not a request', () => {
  it('refuses one input more than the bound, and accepts the bound itself', async () => {
    // Both boundaries, so the check is proven an inequality rather than an accident.
    expect(parseRequest(await frameWith(MAX_COMBINE_INPUTS))).not.toBeNull()
    expect(parseRequest(await frameWith(MAX_COMBINE_INPUTS + 1))).toBeNull()
  })

  it('refuses fewer than two inputs', async () => {
    // `deriveReduceTree` promotes a lone child rather than wrapping it, so a
    // one-input combine cannot come from a tree anybody derived — and running one
    // would re-canonicalise its single input, which is work an unauthenticated peer
    // could ask for and get nothing from.
    expect(parseRequest(await frameWith(0))).toBeNull()
    expect(parseRequest(await frameWith(1))).toBeNull()
    expect(parseRequest(await frameWith(2))).not.toBeNull()
  })

  it('refuses a malformed combineId, level or input list', async () => {
    const inputCids = await cids(3)
    const base = { kind: 'combine', combineId: 'node-a', inputCids, level: 1 }

    expect(parseRequest({ ...base, combineId: '' })).toBeNull()
    expect(parseRequest({ ...base, combineId: 42 })).toBeNull()
    expect(parseRequest({ kind: 'combine', inputCids, level: 1 })).toBeNull()

    // Level 1 is the first combine layer above the leaves, so 0 is not a level any
    // derived tree produces.
    expect(parseRequest({ ...base, level: 0 })).toBeNull()
    expect(parseRequest({ ...base, level: -1 })).toBeNull()
    expect(parseRequest({ ...base, level: 1.5 })).toBeNull()
    expect(parseRequest({ ...base, level: 'first' })).toBeNull()

    const withString: CanonicalValue = [inputCids[0] as CID, 'not-a-cid']
    const withNumber: CanonicalValue = [inputCids[0] as CID, 5]
    expect(parseRequest({ ...base, inputCids: 'not-an-array' })).toBeNull()
    expect(parseRequest({ ...base, inputCids: withString })).toBeNull()
    expect(parseRequest({ ...base, inputCids: withNumber })).toBeNull()
  })
})

describe('MR-06 — a combine reply says what happened, or is refused', () => {
  it('round-trips both arms', async () => {
    const [resultCid] = await cids(1)

    const answered = parseResponse(
      encodeResponse({
        kind: 'combine',
        resultCid: resultCid as CID,
        reason: '',
        attestation: 'signed-by-nobody',
      }),
    )
    expect(answered).toEqual({
      kind: 'combine',
      resultCid,
      reason: '',
      attestation: 'signed-by-nobody',
    })

    // The null arm keeps its reason: that string is the only thing a requestor gets
    // before it falls through the ranking to the next executor. It carries no
    // attestation key on the wire and reads back as the sentinel — a refusal produced
    // nothing, so there is nothing it could have signed.
    const declined = parseResponse(
      encodeResponse({
        kind: 'combine',
        resultCid: null,
        reason: 'input not held',
        attestation: 'signed-by-nobody',
      }),
    )
    expect(declined).toEqual({
      kind: 'combine',
      resultCid: null,
      reason: 'input not held',
      attestation: 'signed-by-nobody',
    })
  })

  it('carries a real attestation byte-exact, certificate and all', async () => {
    // VER-08/09/10 on the aggregation. The statement is only worth carrying if it
    // arrives unchanged: every field of the certificate the provider signed is part of
    // what `verifyCertificate` re-derives, so one dropped field surfaces downstream as
    // an unexplainable `bad-signature` against a node that did nothing wrong.
    const [resultCid] = await cids(1)
    const attestation = {
      certificate: {
        nodeKey: 'a'.repeat(64),
        userKey: 'b'.repeat(64),
        operatorId: 'operator-one',
        discoverability: 'via-relay' as const,
        relayIds: ['relay-a', 'relay-b'],
        issuedAt: 1_700_000_000_000,
        expiresAt: 1_800_000_000_000,
        issuer: 'c'.repeat(64),
        signature: 'd'.repeat(128),
      },
      signature: 'e'.repeat(128),
    }

    const parsed = parseResponse(
      encodeResponse({ kind: 'combine', resultCid: resultCid as CID, reason: '', attestation }),
    )
    expect(parsed).toEqual({ kind: 'combine', resultCid, reason: '', attestation })
  })

  it('gives a refusal nowhere to put a signature, whatever it is handed', () => {
    // **The property "a refusal carries no attestation" is structural, not a check**, and
    // that was measured rather than assumed. Planting a `serveAgent` that signs *before*
    // its refusal branches — a statement about a combine it never ran — left every case
    // in `combine.test.ts` green, because the refusal arm has no `attestation` key on the
    // wire at all and the parse supplies the sentinel on the far side. So the encoder is
    // where the property lives and this is the reading that holds it: hand the refusal
    // arm a real attestation and the frame still has three keys.
    const encoded = encodeResponse({
      kind: 'combine',
      resultCid: null,
      reason: 'input not held',
      attestation: {
        certificate: {
          nodeKey: 'a'.repeat(64),
          userKey: 'b'.repeat(64),
          operatorId: 'operator-one',
          discoverability: 'via-relay',
          relayIds: [],
          issuedAt: 1,
          expiresAt: 2,
          issuer: 'c'.repeat(64),
          signature: 'd'.repeat(128),
        },
        signature: 'e'.repeat(128),
      },
    })
    // Fires on **addition**, which is the direction a signature on a refusal would
    // arrive from.
    expect(Object.keys(encoded as object).sort()).toEqual(['found', 'kind', 'reason'])
    // And the far side reads the sentinel rather than an absence it has to interpret.
    expect(parseResponse(encoded)).toEqual({
      kind: 'combine',
      resultCid: null,
      reason: 'input not held',
      attestation: 'signed-by-nobody',
    })
  })

  it('refuses a corrupt reply rather than degrading it to the null arm', () => {
    // Folding this into `{resultCid: null}` would let a peer turn a corrupt answer
    // into an indistinguishable "I could not", which the requestor would count as an
    // ordinary fallthrough.
    expect(
      parseResponse({
        kind: 'combine',
        found: true,
        resultCid: 'not-a-cid',
        reason: '',
        attestation: 'signed-by-nobody',
      }),
    ).toBeNull()
    expect(
      parseResponse({ kind: 'combine', found: true, reason: '', attestation: 'signed-by-nobody' }),
    ).toBeNull()
  })

  it('refuses a reply whose attestation is malformed, rather than reading it as unsigned', async () => {
    // The choice this pins is the one that looks safer the other way round. A frame
    // that degraded to `'signed-by-nobody'` would report a peer's **protocol error** as
    // an honest peer holding no certificate: the requestor would accept the reply,
    // record an unsigned combine, and never learn the frame was broken. Refusing turns
    // it into a dead executor, and `executeReduce` walks to the next in the ranking.
    const [resultCid] = await cids(1)
    const base: CanonicalValue = { kind: 'combine', found: true, resultCid: resultCid as CID, reason: '' }

    // Absent altogether.
    expect(parseResponse(base)).toBeNull()
    // A word that is not the sentinel.
    expect(parseResponse({ ...base, attestation: 'signed-by-somebody' })).toBeNull()
    // Present, structured, and missing its certificate.
    expect(parseResponse({ ...base, attestation: { signature: 'f'.repeat(128) } })).toBeNull()
    // Certificate present and one field of it dropped.
    expect(
      parseResponse({
        ...base,
        attestation: {
          signature: 'f'.repeat(128),
          certificate: {
            nodeKey: 'a'.repeat(64),
            userKey: 'b'.repeat(64),
            operatorId: 'operator-one',
            discoverability: 'via-relay',
            issuedAt: 1,
            expiresAt: 2,
            issuer: 'c'.repeat(64),
            signature: 'd'.repeat(128),
          },
        },
      }),
    ).toBeNull()
  })
})

// Plan 16-01's placeholder branch — and the `describe` that asserted its reply — are
// gone. The branch now runs the real handler, and what a node *does* with a combine is
// judged in `combine.test.ts`, where a fabric exists to judge it against. Leaving a
// test that asserts a stub's reply is how a stub survives its own replacement.
