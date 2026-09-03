import { describe, expect, it } from 'vitest'
import { iceConfiguration } from './ice-configuration.ts'
import { REFRESH_MARGIN_MS, turnCredentialHolder } from './turn-credentials.ts'

/**
 * NET-12 — the credential holder, and what happens when it cannot get one.
 *
 * The fetch and the clock are injected, so a refetch inside the margin is exercised without a
 * real minute passing. Runs in the node lane and the browser lane both: the module touches no
 * global at import time.
 *
 * **The failure case is the important one and its assertion is about `ice-configuration.ts`**,
 * not about this module's return value. A holder that answers `null` is only safe because the
 * configuration built from `null` still carries the explicit STUN list — see THE TRAP.
 */

const NOW_START = 1_800_000_000_000

/** A minter that answers a credential expiring `lifetimeMs` from the current clock. */
function fakeMinter(state: { now: number; calls: number }, lifetimeMs = 600_000) {
  return async (): Promise<Response> => {
    state.calls += 1
    return new Response(
      JSON.stringify({
        ok: true,
        username: `${String(Math.floor((state.now + lifetimeMs) / 1000))}:bootstrap-us:node-${String(state.calls)}`,
        credential: `credential-${String(state.calls)}`,
        urls: ['turn:127.0.0.1:3478?transport=udp'],
        expiresAt: state.now + lifetimeMs,
        region: 'bootstrap-us',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  }
}

function holderOver(
  state: { now: number; calls: number },
  fetchImpl: typeof fetch,
): ReturnType<typeof turnCredentialHolder> {
  return turnCredentialHolder({
    endpoint: 'http://127.0.0.1:8814/turn-credential',
    requestBody: () => ({
      certificate: { nodeKey: 'aa', issuer: 'bb' },
      nodeKey: 'aa',
      region: 'bootstrap-us',
      requestedAt: state.now,
      signature: 'cc',
    }),
    fetchImpl,
    now: () => state.now,
  })
}

describe('NET-12 — a tab holds its credential and refetches before it dies', () => {
  it('fetches once and answers a rung', async () => {
    const state = { now: NOW_START, calls: 0 }
    const holder = holderOver(state, fakeMinter(state) as unknown as typeof fetch)

    const rung = await holder.rung()

    expect(rung).not.toBeNull()
    expect(rung?.credential).toBe('credential-1')
    expect(state.calls).toBe(1)
  })

  it('serves a second ask from cache rather than minting again', async () => {
    const state = { now: NOW_START, calls: 0 }
    const holder = holderOver(state, fakeMinter(state) as unknown as typeof fetch)

    await holder.rung()
    const second = await holder.rung()

    expect(second?.credential).toBe('credential-1')
    expect(state.calls, 'a cache hit must not mint a second credential').toBe(1)
  })

  it('refetches once the clock is inside the refresh margin', async () => {
    const state = { now: NOW_START, calls: 0 }
    const holder = holderOver(state, fakeMinter(state) as unknown as typeof fetch)

    await holder.rung()
    // Inside the margin but NOT yet expired: the credential still works, and that is exactly
    // when it must be replaced. A tab that waits for expiry has already lost the dial.
    state.now = NOW_START + 600_000 - REFRESH_MARGIN_MS + 1
    const refreshed = await holder.rung()

    expect(state.calls, 'a credential inside its margin must be replaced, not reused').toBe(2)
    expect(refreshed?.credential).toBe('credential-2')
  })

  it('shares one in-flight fetch between concurrent askers', async () => {
    const state = { now: NOW_START, calls: 0 }
    const holder = holderOver(state, fakeMinter(state) as unknown as typeof fetch)

    // libp2p asks once per connection, and a tab may dial several peers at once.
    const [a, b, c] = await Promise.all([holder.rung(), holder.rung(), holder.rung()])

    expect(state.calls).toBe(1)
    expect(a?.credential).toBe(b?.credential)
    expect(b?.credential).toBe(c?.credential)
  })
})

describe('NET-12 — a failed fetch yields the STUN list, never the package defaults', () => {
  const failing = (async () => {
    throw new Error('connection refused')
  }) as unknown as typeof fetch

  const refusing = (async () =>
    new Response(JSON.stringify({ ok: false, kind: 'certificate-refused', reason: 'not a pinned issuer' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })) as unknown as typeof fetch

  it('answers null rather than throwing when the minter is unreachable', async () => {
    const state = { now: NOW_START, calls: 0 }
    const holder = holderOver(state, failing)

    // A throw here would take down the dial instead of falling back to STUN, because the
    // caller is `rtcConfiguration`'s function form.
    await expect(holder.rung()).resolves.toBeNull()
    expect(holder.lastFailure()).toContain('could not reach the minter')
  })

  it('keeps the gate’s named reason when the minter refuses', async () => {
    const state = { now: NOW_START, calls: 0 }
    const holder = holderOver(state, refusing)

    expect(await holder.rung()).toBeNull()
    expect(holder.lastFailure()).toContain('certificate-refused')
    expect(holder.lastFailure()).toContain('not a pinned issuer')
  })

  /**
   * THE TRAP, asserted where it actually bites.
   *
   * The claim is not *the holder answered null*. It is *the configuration a page hands
   * `RTCPeerConnection` after a failed fetch still names this repository's three servers and
   * does not name the dead default*. That is the whole reason `iceConfiguration` is imported
   * into this spec at all.
   */
  it('builds a configuration carrying the explicit STUN list and NOT the dead default', async () => {
    const state = { now: NOW_START, calls: 0 }
    const holder = holderOver(state, failing)

    const config = iceConfiguration({ turn: await holder.rung() })

    expect(config.iceServers).toHaveLength(3)
    expect(JSON.stringify(config)).not.toContain('stun.services.mozilla.com')
    expect(JSON.stringify(config)).toContain('stun.cloudflare.com')
  })
})
