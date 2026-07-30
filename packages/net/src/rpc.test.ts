import { SendRefused, decodeCanonical, encodeCanonical } from '@o2/core'
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
    })
    const failure = await failureOf(rejectingTransport(refusal), { hello: 'world' })

    expect(failure).toBeInstanceOf(RpcFailure)
    const detail = (failure as RpcFailure).detail
    expect(detail.kind).toBe('send-refused')
    if (detail.kind !== 'send-refused') return
    expect(detail.to).toBe('remote')
    expect(detail.by).toBe('local')
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
