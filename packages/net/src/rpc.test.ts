import { SendRefused } from '@o2/core'
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
