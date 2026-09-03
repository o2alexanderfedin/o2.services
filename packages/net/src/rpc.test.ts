import { MemoryNetwork, SendRefused, decodeCanonical, encodeCanonical } from '@o2/core'
import type { CanonicalValue, Transport } from '@o2/core'
import { describe, expect, it } from 'vitest'
import { RpcEndpoint, RpcFailure } from './rpc.ts'

/**
 * NET-09 — `RpcEndpoint.request` discriminates on the *thrown type*, not on
 * `send-failed`.
 *
 * `RpcEndpoint` has had no spec file of its own; its `send-failed` behaviour is
 * asserted inside `egress.test.ts`, which must stay green because an
 * `EgressRefusal` keeps classifying `send-failed` under this plan. This file
 * exists for the one distinction that plan adds: a `SendRefused` — the marker a
 * `Transport` raises to say *this node* declined — becomes `send-refused`, and
 * every other rejection of `Transport.send` stays `send-failed`.
 *
 * The reason the discriminator cannot be `send-failed` itself is mechanical:
 * `request`'s `.catch` is bare, and `Libp2pTransport.send` awaits `dialProtocol`,
 * so a dead receiver arrives by exactly the same route as a gate refusal.
 */

/** A transport whose `send` always rejects with whatever it was given. */
function rejectingTransport(cause: unknown): Transport {
  return {
    localId: 'local',
    send: async () => {
      throw cause
    },
    onMessage: () => () => {},
    peers: [],
  }
}

async function failureOf(transport: Transport, body: CanonicalValue): Promise<unknown> {
  const rpc = new RpcEndpoint(transport, { timeoutMs: 5_000 })
  try {
    return await rpc.request('remote', body).then(
      () => null,
      (cause: unknown) => cause,
    )
  } finally {
    rpc.close()
  }
}

describe('RpcEndpoint.request — send rejections, by kind', () => {
  it('reports a SendRefused as send-refused, carrying the refusing node', async () => {
    const refusal = new SendRefused('local refused a send to remote: gate full', {
      to: 'remote',
      by: 'local',
      reason: 'per-peer-stream-budget',
    })
    const failure = await failureOf(rejectingTransport(refusal), { hello: 'world' })

    expect(failure).toBeInstanceOf(RpcFailure)
    const detail = (failure as RpcFailure).detail
    expect(detail.kind).toBe('send-refused')
    if (detail.kind !== 'send-refused') return
    expect(detail.to).toBe('remote')
    expect(detail.by).toBe('local')
    // NET-13 — the literal survives the flattening. `detail` below is English and a
    // caller can only substring-match it; this field is what a caller branches on.
    expect(detail.reason).toBe('per-peer-stream-budget')
    expect(detail.detail).toContain('gate full')
    // The rendered message names the refusing node, so a log line is readable.
    expect((failure as RpcFailure).message).toContain('local')
  })

  it('reports every other send rejection as send-failed, unchanged', async () => {
    const failure = await failureOf(
      rejectingTransport(new Error('Can not dial remote: no valid addresses')),
      { hello: 'world' },
    )

    expect(failure).toBeInstanceOf(RpcFailure)
    const detail = (failure as RpcFailure).detail
    // This is the dead-peer case. `Libp2pTransport.send` awaits `dialProtocol`,
    // so an unreachable peer rejects here — and it must NOT be attributed to this
    // node. Widening the branch onto `send-failed` would do exactly that.
    expect(detail.kind).toBe('send-failed')
    if (detail.kind !== 'send-failed') return
    expect(detail.to).toBe('remote')
    expect(detail.detail).toContain('no valid addresses')
  })

  it('reports a non-Error rejection as send-failed too', async () => {
    const failure = await failureOf(rejectingTransport('nope'), { hello: 'world' })
    expect((failure as RpcFailure).detail.kind).toBe('send-failed')
  })
})

/**
 * A transport whose delivery side the test drives.
 *
 * `rejectingTransport` above cannot express any of this: it never delivers, so it
 * cannot say *who* a frame came from. Correlation is the whole subject here, and the
 * sender's identity is the half the endpoint used to discard.
 */
interface ScriptedTransport extends Transport {
  /** Frames handed to `send`, in order. */
  readonly sent: readonly { readonly to: string; readonly bytes: Uint8Array<ArrayBuffer> }[]
  /** Deliver `frame` to the endpoint as if it arrived from `from`. */
  deliver(from: string, frame: CanonicalValue): void
}

function scriptedTransport(): ScriptedTransport {
  let handler: ((from: string, message: Uint8Array<ArrayBuffer>) => void) | null = null
  const sent: { to: string; bytes: Uint8Array<ArrayBuffer> }[] = []
  return {
    localId: 'A',
    sent,
    send: async (to, bytes) => {
      sent.push({ to, bytes })
    },
    onMessage: (installed) => {
      handler = installed
      return () => {
        handler = null
      }
    },
    peers: [],
    deliver(from, frame) {
      const encoded = encodeCanonical(frame)
      if (!encoded.ok) throw new Error(`test frame not encodable: ${JSON.stringify(encoded.error)}`)
      handler?.(from, encoded.bytes)
    },
  }
}

/** The id the endpoint issued for its most recent request, read off the wire. */
function idOfLastRequest(transport: ScriptedTransport): number {
  const last = transport.sent.at(-1)
  if (last === undefined) throw new Error('no request was sent')
  const frame = decodeCanonical(last.bytes) as { readonly [k: string]: CanonicalValue }
  return frame['id'] as number
}

/**
 * A reply's identity is (who answered, which request) — never the request number
 * alone.
 *
 * Ids are a per-endpoint counter, and every `RemoteExecutor` in a job shares one
 * endpoint, so a sibling's id is one increment away and guessing one is trivial. When
 * correlation was keyed on the id alone, any peer that could reach this node could
 * answer a request it was never sent, and first frame won — enough to forge N-version
 * agreement out of one machine.
 */
describe('RpcEndpoint — a reply is matched against the peer it was requested from', () => {
  it('ignores a res frame from a peer other than the request destination', async () => {
    const transport = scriptedTransport()
    const rpc = new RpcEndpoint(transport, { timeoutMs: 5_000 })
    try {
      const pending = rpc.request('B', { ask: 'sum' })
      const id = idOfLastRequest(transport)

      transport.deliver('C', { k: 'res', id, body: 'FORGED-BY-C' })
      transport.deliver('B', { k: 'res', id, body: 'ANSWERED-BY-B' })

      // A positive assertion, so it cannot pass by everything having gone quiet.
      expect(await pending).toBe('ANSWERED-BY-B')
    } finally {
      rpc.close()
    }
  })

  it('times out rather than resolving with a forgery when the destination stays silent', async () => {
    const transport = scriptedTransport()
    const rpc = new RpcEndpoint(transport, { timeoutMs: 25 })
    try {
      const pending = rpc.request('B', { ask: 'sum' })
      transport.deliver('C', { k: 'res', id: idOfLastRequest(transport), body: 'FORGED-BY-C' })

      const failure = await pending.then(
        (value: CanonicalValue) => value,
        (cause: unknown) => cause,
      )
      expect(failure).toBeInstanceOf(RpcFailure)
      const detail = (failure as RpcFailure).detail
      expect(detail.kind).toBe('timeout')
      if (detail.kind !== 'timeout') return
      expect(detail.to).toBe('B')
    } finally {
      rpc.close()
    }
  })

  it('still resolves an ordinary round trip, so the key stays reachable', async () => {
    const transport = scriptedTransport()
    const rpc = new RpcEndpoint(transport, { timeoutMs: 5_000 })
    try {
      const pending = rpc.request('B', { ask: 'sum' })
      transport.deliver('B', { k: 'res', id: idOfLastRequest(transport), body: { sum: 42 } })
      expect(await pending).toEqual({ sum: 42 })
    } finally {
      rpc.close()
    }
  })
})

/**
 * A reply this node could not encode, answered rather than left to expire.
 *
 * `#encode`'s own comment says a frame that cannot be encoded is a programming error
 * in this package and must **fail loudly rather than send a partial frame**. It sat
 * inside a `catch` written for a *send* failure, two lines below that comment, and
 * was swallowed there. Nothing was sent, nothing was recorded — the module is pure
 * and has no logger — and the requester waited out its whole budget and was told the
 * request had timed out. A defect in this node's own encoder, filed as the network
 * being slow.
 *
 * The budget here is deliberately short. It is not a timing bound: the assertion is
 * that the request **resolves** rather than rejecting, and 150 ms only decides how
 * long the failing case takes to prove itself. `timeoutMs` at the default 30 s would
 * assert exactly the same thing and take 200× longer to do it.
 */
describe('RpcEndpoint — a reply that will not encode comes back named, not as a timeout', () => {
  /** A pair of endpoints on one in-process network. B serves, A asks. */
  function pair(timeoutMs: number) {
    const network = new MemoryNetwork()
    const server = new RpcEndpoint(network.connect('B'), { timeoutMs: 5_000 })
    const client = new RpcEndpoint(network.connect('A'), { timeoutMs })
    return {
      server,
      client,
      close: () => {
        client.close()
        server.close()
      },
    }
  }

  it('answers with the encoder\'s own account of what it refused, naming the field', async () => {
    const { server, client, close } = pair(150)
    // A handler that did its job and produced a value DAG-CBOR will not accept. The
    // spec is explicit that NaN and the infinities "must not be accepted", so this is
    // the ordinary shape of the defect rather than a contrived one.
    server.serve(async () => ({ total: Number.POSITIVE_INFINITY, rows: 3 }))
    try {
      const reply = await client.request('B', { ask: 'sum' }).then(
        (value: CanonicalValue) => value,
        (cause: unknown) => cause,
      )

      // Not an `RpcFailure{kind:'timeout'}` — that is the defect, and it is what this
      // line fails on when the encode throw goes back inside the send `catch`.
      expect(reply).not.toBeInstanceOf(RpcFailure)

      const record = reply as { readonly error?: unknown }
      expect(typeof record.error).toBe('string')
      const text = String(record.error)
      // The text, not merely the shape. Each clause is a different question a reader
      // has at 3am: whose fault, what kind of fault, and which field.
      expect(text).toContain('reply')
      expect(text).toContain('rpc frame not encodable')
      expect(text).toContain('non-finite-float')
      expect(text).toContain('body.total')
      expect(text).toContain('Infinity')
    } finally {
      close()
    }
  })

  it('still releases afterSent, because the frame has settled either way', async () => {
    const { server, client, close } = pair(150)
    let released = 0
    server.serve(async () => ({
      body: { total: Number.NaN } as CanonicalValue,
      afterSent: () => {
        released += 1
      },
    }))
    try {
      // Deliberately indifferent to how the request settles. This case is only about
      // the callback, so that the two claims fail separately and each names its own
      // subject rather than one masking the other.
      await client.request('B', { ask: 'sum' }).catch(() => undefined)

      // `serveAgent` holds a sovereign task's egress registration on this callback. A
      // reply that could not be encoded is a frame that has settled — it will never
      // go out — so the registration must be released, or an unencodable reply becomes
      // an unbounded leak with a rare trigger.
      expect(released).toBe(1)
    } finally {
      close()
    }
  })

  it('leaves an encodable reply untouched', async () => {
    const { server, client, close } = pair(150)
    server.serve(async () => ({ total: 7, rows: 3 }))
    try {
      expect(await client.request('B', { ask: 'sum' })).toEqual({ total: 7, rows: 3 })
    } finally {
      close()
    }
  })
})
