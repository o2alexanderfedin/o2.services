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
      encodeResponse({ kind: 'combine', resultCid: resultCid as CID, reason: '' }),
    )
    expect(answered).toEqual({ kind: 'combine', resultCid, reason: '' })

    // The null arm keeps its reason: that string is the only thing a requestor gets
    // before it falls through the ranking to the next executor.
    const declined = parseResponse(
      encodeResponse({ kind: 'combine', resultCid: null, reason: 'input not held' }),
    )
    expect(declined).toEqual({ kind: 'combine', resultCid: null, reason: 'input not held' })
  })

  it('refuses a corrupt reply rather than degrading it to the null arm', () => {
    // Folding this into `{resultCid: null}` would let a peer turn a corrupt answer
    // into an indistinguishable "I could not", which the requestor would count as an
    // ordinary fallthrough.
    expect(
      parseResponse({ kind: 'combine', found: true, resultCid: 'not-a-cid', reason: '' }),
    ).toBeNull()
    expect(parseResponse({ kind: 'combine', found: true, reason: '' })).toBeNull()
  })
})

describe('MR-06 — the eighth kind does not fall through to the exec branch', () => {
  it('answers the null arm with a stated reason', async () => {
    const network = new MemoryNetwork()
    const store = new MemoryBlockstore()

    // A combine must never reach the exec branch, which would read `request.task`.
    const never: Executor = {
      nodeId: 'w0',
      async execute() {
        throw new Error('the exec branch ran for a combine request')
      },
    }

    const serverRpc = new RpcEndpoint(network.connect('w0'), { timeoutMs: 5_000 })
    serveAgent({
      rpc: serverRpc,
      executor: never,
      blockstore: store,
      egress: 'holds-no-registrations',
      authorize: 'serves-unauthenticated',
      index: 'serves-no-records',
      capacity: 'accepts-every-offer',
      ledger: 'keeps-no-ledger',
      reservations: 'relays-for-nobody',
      onDispatch: 'reports-no-dispatch',
    })

    const client = new RpcEndpoint(network.connect('client'), { timeoutMs: 5_000 })
    const reply = parseResponse(
      await client.request(
        'w0',
        encodeRequest({
          kind: 'combine',
          combineId: 'node-a',
          inputCids: await cids(2),
          level: 1,
        }),
      ),
    )

    // The null arm and not an `error` frame: the frame parsed, so this is a combine
    // that could not be run — exactly what the ranking walk expects. Plan 16-02
    // replaces both the branch and this assertion.
    expect(reply).toEqual({
      kind: 'combine',
      resultCid: null,
      reason: 'combine not implemented in this build',
    })
  })
})
