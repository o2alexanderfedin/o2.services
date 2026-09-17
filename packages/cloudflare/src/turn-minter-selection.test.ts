import { describe, expect, it } from 'vitest'
import { selectTurnMinter, turnRefusalStatus } from './worker.ts'
import type { HostedEnv } from './worker.ts'

/**
 * Which credential scheme a deployment runs, and whose fault a refusal is — NET-12.
 *
 * ## Why this is a spec and not a comment
 *
 * Two schemes can be configured at once and only one can answer. That tie is broken in
 * `selectTurnMinter`, and a tie broken in code with nothing asserting it is an accident that
 * happens to be working. `CLAUDE.md`'s rule is the one being followed here: *a comment is not a
 * specification*.
 *
 * ## The cost of getting the OTHER half wrong is measured, not imagined
 *
 * The probe on 2026-09-09 established that Cloudflare's TURN server verifies credentials it
 * issued. So an API credential placed in `O2_TURN_SECRET` would be HMAC'd into a well-formed
 * credential that every Cloudflare TURN server answers `401` to — reaching a tab and failing as
 * a **network fault**, which is exactly what `turn-not-configured` was written to prevent and
 * would have walked straight past. Two names in the environment is what makes that impossible;
 * these cases are what keep the two names apart.
 */

const NOTHING: HostedEnv = {} as HostedEnv

function env(fields: Partial<HostedEnv>): HostedEnv {
  return fields as HostedEnv
}

describe('NET-12 — which minter a deployment gets', () => {
  it('answers null for a deployment that configures neither scheme', () => {
    expect(selectTurnMinter(NOTHING)).toBeNull()
  })

  it('takes the shared secret when only that is set', () => {
    expect(selectTurnMinter(env({ O2_TURN_SECRET: 'a-coturn-secret' }))).not.toBeNull()
  })

  it('takes the provider pair when only that is set', () => {
    expect(
      selectTurnMinter(env({ O2_TURN_KEY_ID: 'a-key-id', O2_TURN_API_SECRET: 'a-credential' })),
    ).not.toBeNull()
  })

  it('PREFERS the provider pair when both are configured — the decision, stated', async () => {
    // Broken toward Cloudflare because that scheme cannot be half-right: it brings its own
    // endpoints, so it cannot be paired with a stale `O2_TURN_URLS` naming a coturn that has
    // been switched off — the likelier accident on a deployment whose shared secret predates the
    // pair. An operator running their own TURN server says so by not setting the pair.
    //
    // Asserted by BEHAVIOUR rather than by identity: the shared-secret minter builds a username
    // locally and never calls out, so a minter that reaches for `fetch` is the provider one.
    const minter = selectTurnMinter(
      env({
        O2_TURN_SECRET: 'a-coturn-secret',
        O2_TURN_KEY_ID: 'a-key-id',
        O2_TURN_API_SECRET: 'a-credential',
        // **Without this line the case below POSTs a fabricated Bearer to
        // `rtc.live.cloudflare.com` on every node-lane run, CI included.** Caught in review on
        // the day it was written, and it is the `hermetic-fixtures.node.test.ts` class one lane
        // over: that guard covers a fixture BROWSER reaching the internet and does not see a
        // `fetch` a node-lane spec makes for itself. What makes it worse than a slow test is
        // that it is outcome-stable — Cloudflare's 401 and an offline `ECONNREFUSED` both land
        // on `provider-refused` — so the case would pass either way and never say it was
        // dialling anyone.
        //
        // Port 9 is `discard`, the same convention `HERMETIC_PROXY` uses, so the refusal is
        // immediate. It also pays for itself: this is the only node-lane reading that the
        // `apiBase` spread inside `selectTurnMinter` happens at all.
        O2_TURN_API_BASE: 'http://127.0.0.1:9/v1/turn/keys',
      }),
    )
    expect(minter).not.toBeNull()
    if (minter === null) return
    const outcome = await minter.mint({
      nodeKey: 'aa',
      region: 'bootstrap-us',
      now: 1_800_000_000_000,
      expiresAt: 1_800_000_600_000,
      urls: ['turn:a-coturn.invalid:3478'],
    })
    // The shared-secret minter would have answered `ok` with `1800000600:bootstrap-us:aa` from
    // that non-empty URL list. The provider one tries to reach the discard port above and
    // refuses by name. Either way it is NOT a shared-secret grant, which is the claim.
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.kind).toBe('provider-refused')
  })

  it('treats HALF the provider pair as no provider, and falls back rather than guessing', async () => {
    // Half a pair is not a hint about the missing half. With a shared secret also present the
    // deployment gets that scheme; with nothing else present it gets `null`, and the mint then
    // refuses as `turn-not-configured` — by name, which is why that refusal exists.
    const withSecret = selectTurnMinter(
      env({ O2_TURN_KEY_ID: 'a-key-id', O2_TURN_SECRET: 'a-coturn-secret' }),
    )
    expect(withSecret).not.toBeNull()
    if (withSecret === null) return
    const outcome = await withSecret.mint({
      nodeKey: 'aa',
      region: 'bootstrap-us',
      now: 1_800_000_000_000,
      expiresAt: 1_800_000_600_000,
      urls: ['turn:a-coturn.invalid:3478'],
    })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.grant.username).toBe('1800000600:bootstrap-us:aa')

    expect(selectTurnMinter(env({ O2_TURN_KEY_ID: 'a-key-id' }))).toBeNull()
    expect(selectTurnMinter(env({ O2_TURN_API_SECRET: 'a-credential' }))).toBeNull()
  })

  it('reads an empty string as absent, because `wrangler dev` injects one for an unset var', () => {
    expect(selectTurnMinter(env({ O2_TURN_SECRET: '' }))).toBeNull()
    expect(selectTurnMinter(env({ O2_TURN_KEY_ID: '', O2_TURN_API_SECRET: '' }))).toBeNull()
    expect(selectTurnMinter(env({ O2_TURN_KEY_ID: 'a-key-id', O2_TURN_API_SECRET: '' }))).toBeNull()
  })
})

describe('NET-12 — a refusal’s status says whose fault it was', () => {
  it('blames the caller, undifferentiated, for everything a caller could have caused', () => {
    // Undifferentiated on purpose: telling `certificate-refused` from `bad-signature` by status
    // would let an unauthenticated caller map the gate. The named reason is in the body.
    for (const kind of [
      'malformed-request',
      'certificate-refused',
      'node-key-mismatch',
      'bad-signature',
      'stale-request',
      'unknown-region',
    ] as const) {
      expect(turnRefusalStatus(kind)).toBe(400)
    }
  })

  it('never blames a caller who did everything right', () => {
    // A tab that presented a certificate and a signature that both verified has nothing to fix.
    // `400` would send it looking for a bug it does not have; these two are the deployment's.
    expect(turnRefusalStatus('turn-not-configured')).toBe(503)
    expect(turnRefusalStatus('no-urls-for-region')).toBe(503)
    expect(turnRefusalStatus('provider-refused')).toBe(502)
  })

  it('separates a provider that would not answer from a deployment that cannot ask', () => {
    // Distinct numbers because the operator's next action differs: 502 is somebody else's
    // server or a wrong API credential, 503 is a var this deployment never set.
    expect(turnRefusalStatus('provider-refused')).not.toBe(
      turnRefusalStatus('turn-not-configured'),
    )
  })
})
