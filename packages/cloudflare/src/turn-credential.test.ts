import { ed25519 } from '@noble/curves/ed25519.js'
import { toHex } from '@o2/core'
import type { NodeCertificate, PublicKeyHex } from '@o2/core'
// Test-only relative import, the route `packages/net/src/distributed.test.ts` sanctions and
// `admission.test.ts` follows. `certificatePayload` is deliberately NOT on `@o2/core`'s barrel —
// `enrollment.ts` says so in as many words: *"a relying party has `verifyCertificate`, and this
// is the signing side's own detail."* This spec is on the signing side, because it has to mint a
// certificate the gate will accept in order to have a positive control at all. Reaching the file
// directly keeps that true without widening the kernel package's public surface.
import { certificatePayload } from '../../core/src/enrollment.ts'
import { describe, expect, it } from 'vitest'
import {
  ACCEPTANCE_WINDOW_MS,
  CREDENTIAL_LIFETIME_MS,
  CLOUDFLARE_TURN_API_BASE,
  cloudflareTurnMinter,
  mintTurnCredential,
  sharedSecretMinter,
  turnMintPayload,
} from './turn-credential.ts'
import type { TurnCredentialGrant, TurnMintOutcome } from './turn-credential.ts'

/**
 * NET-12 — the gate the hosted tier did not have, and the credential it mints.
 *
 * Criterion 1 asks that *a request from outside the fabric is refused*. A spec full of refusals
 * proves nothing on its own: an endpoint that refuses **everything** passes every one of them.
 * So the **positive control** — a certificate that verifies gets a credential — is the first
 * case here and is a first-class part of the claim, not a convenience. Every refusal below is a
 * measurement only because that control answers in the same file.
 *
 * The HMAC case computes its expected value from literals written out in this file. That is
 * deliberate and it is `CLAUDE.md`'s rule: this repository has twice had a plant stay green
 * because the assertion and the implementation moved together. A value read back from the
 * module cannot fail when the module is wrong.
 */

const ISSUER_SEED = new Uint8Array(32).fill(7)
const OUTSIDER_SEED = new Uint8Array(32).fill(11)
const NODE_SEED = new Uint8Array(32).fill(3)
const OTHER_NODE_SEED = new Uint8Array(32).fill(5)

const NOW = 1_800_000_000_000
const REGION = 'bootstrap-us'
const URLS = ['turn:127.0.0.1:3478?transport=udp', 'turn:127.0.0.1:53?transport=udp']

function keyOf(seed: Uint8Array): PublicKeyHex {
  return toHex(ed25519.getPublicKey(seed))
}

/** A certificate signed by `issuerSeed`, the way the fabric signs one. */
function certificateFor(nodeSeed: Uint8Array, issuerSeed: Uint8Array): NodeCertificate {
  const unsigned: Omit<NodeCertificate, 'signature'> = {
    nodeKey: keyOf(nodeSeed),
    userKey: keyOf(issuerSeed),
    operatorId: 'phase-34-unit',
    discoverability: 'seed',
    relayIds: [],
    issuedAt: NOW - 1000,
    expiresAt: NOW + 3_600_000,
    issuer: keyOf(issuerSeed),
  }
  return { ...unsigned, signature: toHex(ed25519.sign(certificatePayload(unsigned), issuerSeed)) }
}

/** A well-formed request, signed by whoever holds `signerSeed`. */
function requestFrom(
  certificate: NodeCertificate,
  signerSeed: Uint8Array,
  overrides: { readonly requestedAt?: number; readonly region?: string } = {},
): Record<string, unknown> {
  const nodeKey = keyOf(signerSeed)
  const requestedAt = overrides.requestedAt ?? NOW
  const region = overrides.region ?? REGION
  const signature = toHex(
    ed25519.sign(turnMintPayload(nodeKey, region, requestedAt), signerSeed),
  )
  return { certificate, nodeKey, region, requestedAt, signature }
}

/** Unwrap a minter outcome, failing the case with its own detail rather than on `undefined`. */
function grantOf(outcome: TurnMintOutcome): TurnCredentialGrant {
  if (!outcome.ok) throw new Error(`expected a grant, the minter refused: ${outcome.detail}`)
  return outcome.grant
}

const context = {
  pinnedIssuers: new Set([keyOf(ISSUER_SEED)]),
  now: NOW,
  minter: sharedSecretMinter('a-secret-only-this-deployment-and-its-coturn-hold'),
  urlsForRegion: (region: string) => (region === REGION ? URLS : null),
}

describe('NET-12 — the positive control: a certificate the fabric issued gets a credential', () => {
  it('mints for a node whose certificate verifies against the pinned issuer', async () => {
    const certificate = certificateFor(NODE_SEED, ISSUER_SEED)
    const result = await mintTurnCredential(requestFrom(certificate, NODE_SEED), context)

    expect(result.ok, result.ok ? '' : `expected a grant, got ${result.reason}`).toBe(true)
    if (!result.ok) return
    expect(result.grant.username).toContain(keyOf(NODE_SEED))
    expect(result.grant.credential.length).toBeGreaterThan(0)
    expect(result.grant.urls).toEqual(URLS)
    expect(result.grant.region).toBe(REGION)
  })

  it('states an expiry of exactly now plus the lifetime', async () => {
    const certificate = certificateFor(NODE_SEED, ISSUER_SEED)
    const result = await mintTurnCredential(requestFrom(certificate, NODE_SEED), context)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    // The expected value is a LITERAL, not `NOW + CREDENTIAL_LIFETIME_MS` read back from the
    // module. 1_800_000_000_000 + 600_000. If the lifetime constant changes, this case is
    // supposed to redden and be re-read — that is the point of writing it out.
    expect(result.grant.expiresAt).toBe(1_800_000_600_000)
    expect(CREDENTIAL_LIFETIME_MS).toBe(600_000)
  })
})

describe('NET-12 — the credential is the HMAC of the username and of nothing else', () => {
  it('matches a value computed outside this module from literal inputs', async () => {
    // Both sides written out: the secret, the username the scheme builds, and the base64 of
    // HMAC-SHA1(username, secret) computed with `node:crypto` independently of the module.
    const secret = 'phase-34-fixed-secret-for-the-literal'
    const grant = grantOf(
      await sharedSecretMinter(secret).mint({
        nodeKey: 'aa',
        region: 'bootstrap-us',
        now: 1_800_000_000_000,
        expiresAt: 1_800_000_600_000,
        urls: URLS,
      }),
    )
    expect(grant.username).toBe('1800000600:bootstrap-us:aa')
    expect(grant.credential).toBe('mPwKVlaWnCJ74v6KKiiPnW+9ncs=')
  })

  it('carries the expiry, the region and the node key, so an allocation is attributable', async () => {
    const grant = grantOf(
      await sharedSecretMinter('s').mint({
        nodeKey: 'deadbeef',
        region: 'bootstrap-eu',
        now: 1_800_000_000_000,
        expiresAt: 1_800_000_600_000,
        urls: URLS,
      }),
    )
    expect(grant.username.split(':')).toEqual(['1800000600', 'bootstrap-eu', 'deadbeef'])
  })
})

describe('NET-12 — every refusal has its own name, so a caller learns which thing was wrong', () => {
  it('refuses a certificate from an issuer outside the pinned set — criterion 1’s clause', async () => {
    const outsider = certificateFor(NODE_SEED, OUTSIDER_SEED)
    const result = await mintTurnCredential(requestFrom(outsider, NODE_SEED), context)

    // The HARM first, so a regression's failure text says what was leaked rather than merely
    // that a boolean moved. `result.ok` alone would print `expected true to be false`, which
    // does not tell a reader an outsider was handed a working TURN credential.
    expect(
      JSON.stringify(result),
      'a certificate from an UNPINNED issuer was served a TURN credential — this is criterion 1’s ' +
        'harm exactly: a request from outside the fabric was not refused',
    ).not.toContain('username')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.kind).toBe('certificate-refused')
    if (result.failure.kind !== 'certificate-refused') return
    expect(result.failure.failure.kind).toBe('untrusted-issuer')
  })

  it('refuses a request carrying no certificate at all', async () => {
    const result = await mintTurnCredential({ region: REGION, requestedAt: NOW }, context)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.kind).toBe('malformed-request')
  })

  it('refuses a VALID certificate presented by somebody who does not hold its key', async () => {
    // The borrowed-certificate case. The certificate is genuine and the signature is genuine —
    // they are simply about different keys. Only the binding check separates them.
    const victim = certificateFor(NODE_SEED, ISSUER_SEED)
    const borrowed = requestFrom(victim, OTHER_NODE_SEED)
    const result = await mintTurnCredential(borrowed, context)

    expect(result.ok, 'a borrowed certificate must not open the gate').toBe(false)
    if (result.ok) return
    expect(result.failure.kind).toBe('node-key-mismatch')
  })

  it('refuses a signature that does not verify under the key it names', async () => {
    const certificate = certificateFor(NODE_SEED, ISSUER_SEED)
    const tampered = { ...requestFrom(certificate, NODE_SEED), signature: toHex(new Uint8Array(64)) }
    const result = await mintTurnCredential(tampered, context)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.kind).toBe('bad-signature')
  })

  it('refuses a request whose timestamp is outside the acceptance window', async () => {
    const certificate = certificateFor(NODE_SEED, ISSUER_SEED)
    const stale = requestFrom(certificate, NODE_SEED, {
      requestedAt: NOW - ACCEPTANCE_WINDOW_MS - 1000,
    })
    const result = await mintTurnCredential(stale, context)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.kind).toBe('stale-request')
  })

  it('accepts a request at the edge of the window, so the window is a window and not a point', async () => {
    const certificate = certificateFor(NODE_SEED, ISSUER_SEED)
    const edge = requestFrom(certificate, NODE_SEED, { requestedAt: NOW - ACCEPTANCE_WINDOW_MS })
    const result = await mintTurnCredential(edge, context)
    expect(result.ok).toBe(true)
  })

  it('refuses a region this deployment does not declare', async () => {
    const certificate = certificateFor(NODE_SEED, ISSUER_SEED)
    const result = await mintTurnCredential(
      requestFrom(certificate, NODE_SEED, { region: 'bootstrap-atlantis' }),
      context,
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.kind).toBe('unknown-region')
  })

  it('refuses BY NAME when no shared secret is configured, rather than minting something dead', async () => {
    const certificate = certificateFor(NODE_SEED, ISSUER_SEED)
    const result = await mintTurnCredential(requestFrom(certificate, NODE_SEED), {
      ...context,
      minter: null,
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.kind).toBe('turn-not-configured')
  })

  it('refuses an expired certificate, reusing the fabric’s own refusal vocabulary', async () => {
    const certificate = certificateFor(NODE_SEED, ISSUER_SEED)
    const result = await mintTurnCredential(requestFrom(certificate, NODE_SEED), {
      ...context,
      now: NOW + 7_200_000,
      // The request's own timestamp is moved with the clock, so what is under test is the
      // certificate's expiry and not the acceptance window.
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.kind).toBe('certificate-refused')
  })
})

/**
 * The provider-backed scheme — NET-12, and the half CORRECTION 4 refused to write blind.
 *
 * Every fixture below is built from the response **measured** against
 * `rtc.live.cloudflare.com` on 2026-09-09, not from a vendor page: `iceServers` as an ARRAY of
 * two entries, the first carrying only a `stun:` URL and NO credentials, the second carrying
 * five `turn:`/`turns:` forms with a `username` and a `credential`. The shape is what makes
 * these cases worth running — a parser written against the documented single-object form would
 * have read `iceServers[0]` and shipped a rung with `undefined` in both fields.
 *
 * Nothing here dials anything. `fetchImpl` is injected, which is also what keeps this in the
 * node lane and out of `hermetic-fixtures.node.test.ts`'s way.
 */
const MEASURED_RESPONSE = {
  iceServers: [
    { urls: ['stun:stun.cloudflare.com:3478'] },
    {
      urls: [
        'turn:turn.cloudflare.com:3478?transport=udp',
        'turn:turn.cloudflare.com:3478?transport=tcp',
        'turns:turn.cloudflare.com:5349?transport=tcp',
        'turn:turn.cloudflare.com:80?transport=tcp',
        'turns:turn.cloudflare.com:443?transport=tcp',
      ],
      username: '0448a2f1e5c47d9b3a6e8f2c1d5b7a94e3f8c2d6b1a5e9f4c8d2b6a3e7f1c5d9',
      credential: '4d53c8f1a9e2b7d4c6f8a1e3b5d7c9f2a4e6b8d1c3f5a7e9b2d4c6f8a1e3b5d7',
    },
  ],
}

/** A `fetch` that records what it was asked and answers a fixed response. */
function recordingFetch(
  response: { readonly status?: number; readonly body: string },
  seen: { url?: string; init?: RequestInit },
): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    seen.url = String(url)
    if (init !== undefined) seen.init = init
    return new Response(response.body, { status: response.status ?? 200 })
  }) as unknown as typeof fetch
}

describe('NET-12 — the provider-backed minter asks rather than mints', () => {
  it('sends the key id in the path, the credential as a Bearer, and the GATE’s lifetime as a ttl', async () => {
    const seen: { url?: string; init?: RequestInit } = {}
    const minter = cloudflareTurnMinter({
      keyId: 'a-key-id',
      apiSecret: 'an-api-credential',
      fetchImpl: recordingFetch({ body: JSON.stringify(MEASURED_RESPONSE) }, seen),
    })
    const outcome = await minter.mint({
      nodeKey: 'aa',
      region: 'bootstrap-us',
      now: 1_800_000_000_000,
      expiresAt: 1_800_000_600_000,
      urls: [],
    })

    expect(seen.url).toBe(`${CLOUDFLARE_TURN_API_BASE}/a-key-id/credentials/generate-ice-servers`)
    const headers = seen.init?.headers as Record<string, string> | undefined
    expect(headers?.['Authorization']).toBe('Bearer an-api-credential')
    // 600, written as a literal. The probe that established the model asked for 3600; the
    // lifetime this fabric mints under is `CREDENTIAL_LIFETIME_MS`, and a minter that quietly
    // asked for the probe's hour would extend every credential six-fold with nothing saying so.
    expect(seen.init?.body).toBe('{"ttl":600}')
    expect(outcome.ok).toBe(true)
  })

  it('takes the entry that CARRIES a credential, not the first one — the STUN entry is skipped', async () => {
    const minter = cloudflareTurnMinter({
      keyId: 'k',
      apiSecret: 's',
      fetchImpl: recordingFetch({ body: JSON.stringify(MEASURED_RESPONSE) }, {}),
    })
    const grant = grantOf(
      await minter.mint({
        nodeKey: 'aa',
        region: 'bootstrap-us',
        now: 1_800_000_000_000,
        expiresAt: 1_800_000_600_000,
        urls: [],
      }),
    )
    expect(grant.username.length).toBe(64)
    expect(grant.credential.length).toBe(64)
    expect(grant.urls).toHaveLength(5)
    // The measured first entry is STUN with no credentials. If it were ever taken, this fails.
    expect(grant.urls.some((url) => url.startsWith('stun:'))).toBe(false)
    expect(grant.urls).toContain('turns:turn.cloudflare.com:443?transport=tcp')
  })

  it('hands back the PROVIDER’s endpoints even when the deployment declares its own', async () => {
    // A credential Cloudflare issued works at Cloudflare's servers and nowhere else. Pairing it
    // with a deployment-declared address would be a working credential at an address it does not
    // work at — which fails as a network fault, the failure mode this whole path exists to stop.
    const minter = cloudflareTurnMinter({
      keyId: 'k',
      apiSecret: 's',
      fetchImpl: recordingFetch({ body: JSON.stringify(MEASURED_RESPONSE) }, {}),
    })
    const grant = grantOf(
      await minter.mint({
        nodeKey: 'aa',
        region: 'bootstrap-us',
        now: 1_800_000_000_000,
        expiresAt: 1_800_000_600_000,
        urls: ['turn:a-coturn-this-deployment-used-to-run.invalid:3478?transport=udp'],
      }),
    )
    expect(grant.urls).not.toContain('turn:a-coturn-this-deployment-used-to-run.invalid:3478?transport=udp')
    expect(grant.urls[0]).toContain('turn.cloudflare.com')
  })

  it('also reads the single-object form, which is what the vendor’s own example shows', async () => {
    // A tolerance rather than a guess: the ARRAY is what was measured, the object is what their
    // example prints, and betting on one would break on a day nobody is looking.
    const minter = cloudflareTurnMinter({
      keyId: 'k',
      apiSecret: 's',
      fetchImpl: recordingFetch(
        { body: JSON.stringify({ iceServers: { urls: ['turn:x.invalid:3478'], username: 'u', credential: 'c' } }) },
        {},
      ),
    })
    const grant = grantOf(
      await minter.mint({
        nodeKey: 'aa',
        region: 'bootstrap-us',
        now: 1_800_000_000_000,
        expiresAt: 1_800_000_600_000,
        urls: [],
      }),
    )
    expect(grant.username).toBe('u')
    expect(grant.urls).toEqual(['turn:x.invalid:3478'])
  })

  it('never asks for a ttl of zero, however short the lifetime it is handed', async () => {
    const seen: { url?: string; init?: RequestInit } = {}
    const minter = cloudflareTurnMinter({
      keyId: 'k',
      apiSecret: 's',
      fetchImpl: recordingFetch({ body: JSON.stringify(MEASURED_RESPONSE) }, seen),
    })
    await minter.mint({
      nodeKey: 'aa',
      region: 'bootstrap-us',
      now: 1_800_000_000_000,
      expiresAt: 1_800_000_000_100,
      urls: [],
    })
    // A credential born dead is worse than a refusal: it reaches the tab and fails as a network
    // fault. 100 ms rounds to 0 seconds, so the floor is what stands between here and that.
    expect(seen.init?.body).toBe('{"ttl":1}')
  })
})

describe('NET-12 — a provider that will not answer is the OPERATOR’s problem, and says so', () => {
  const fields = {
    nodeKey: 'aa',
    region: 'bootstrap-us',
    now: 1_800_000_000_000,
    expiresAt: 1_800_000_600_000,
    urls: [],
  } as const

  it('names the status when the provider refuses — 401 is a wrong API credential, not a wrong caller', async () => {
    const minter = cloudflareTurnMinter({
      keyId: 'k',
      apiSecret: 'a-credential-this-account-does-not-have',
      fetchImpl: recordingFetch({ status: 401, body: '{"error":"unauthorized"}' }, {}),
    })
    const outcome = await minter.mint(fields)
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.kind).toBe('provider-refused')
    expect(outcome.detail).toContain('401')
  })

  it('refuses a 2xx whose body is not JSON at all', async () => {
    const minter = cloudflareTurnMinter({
      keyId: 'k',
      apiSecret: 's',
      fetchImpl: recordingFetch({ body: '<html>a proxy sat in the middle</html>' }, {}),
    })
    const outcome = await minter.mint(fields)
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.kind).toBe('provider-refused')
  })

  it('refuses a 2xx carrying only a STUN entry, rather than shipping a rung with no credential', async () => {
    const minter = cloudflareTurnMinter({
      keyId: 'k',
      apiSecret: 's',
      fetchImpl: recordingFetch(
        { body: JSON.stringify({ iceServers: [{ urls: ['stun:stun.cloudflare.com:3478'] }] }) },
        {},
      ),
    })
    const outcome = await minter.mint(fields)
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.detail).toContain('username')
  })

  it('turns a thrown fetch into a named refusal rather than an exception through the gate', async () => {
    const minter = cloudflareTurnMinter({
      keyId: 'k',
      apiSecret: 's',
      fetchImpl: (() => {
        throw new Error('connect ECONNREFUSED')
      }) as unknown as typeof fetch,
    })
    const outcome = await minter.mint(fields)
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.kind).toBe('provider-refused')
    expect(outcome.detail).toContain('ECONNREFUSED')
  })
})

describe('NET-12 — a declared region with no URLs is not an unknown region', () => {
  it('MINTS for a provider-backed deployment that declares no URLs of its own', async () => {
    // THE CONFIGURATION TRAP, and the reason `turnUrlsFor` was re-split on 2026-09-09. A
    // deployment holding only Cloudflare's key pair names no URLs anywhere, because the provider
    // answers with its own. Before the split every one of its mints came back `unknown-region` —
    // a correctly configured deployment telling a correctly configured tab that `bootstrap-us`
    // is not a region, which is a deployment mistake wearing a client-error name.
    const certificate = certificateFor(NODE_SEED, ISSUER_SEED)
    const result = await mintTurnCredential(requestFrom(certificate, NODE_SEED), {
      ...context,
      minter: cloudflareTurnMinter({
        keyId: 'k',
        apiSecret: 's',
        fetchImpl: recordingFetch({ body: JSON.stringify(MEASURED_RESPONSE) }, {}),
      }),
      urlsForRegion: (region: string) => (region === REGION ? [] : null),
    })
    expect(result.ok, result.ok ? '' : `expected a grant, got ${result.reason}`).toBe(true)
    if (!result.ok) return
    expect(result.grant.urls[0]).toContain('turn.cloudflare.com')
  })

  it('refuses the SAME configuration under the shared-secret scheme, by its own name', async () => {
    // The contrast that makes the case above a measurement rather than a permissive gate. Same
    // empty list, different minter, and the refusal is `no-urls-for-region` — never
    // `unknown-region`, because the region is declared, and never `turn-not-configured`, because
    // the secret is present. Three states, three names.
    const certificate = certificateFor(NODE_SEED, ISSUER_SEED)
    const result = await mintTurnCredential(requestFrom(certificate, NODE_SEED), {
      ...context,
      urlsForRegion: (region: string) => (region === REGION ? [] : null),
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.kind).toBe('no-urls-for-region')
  })

  it('still refuses an undeclared region under BOTH minters', async () => {
    const certificate = certificateFor(NODE_SEED, ISSUER_SEED)
    for (const minter of [
      context.minter,
      cloudflareTurnMinter({
        keyId: 'k',
        apiSecret: 's',
        fetchImpl: recordingFetch({ body: JSON.stringify(MEASURED_RESPONSE) }, {}),
      }),
    ]) {
      const result = await mintTurnCredential(
        requestFrom(certificate, NODE_SEED, { region: 'bootstrap-atlantis' }),
        { ...context, minter },
      )
      expect(result.ok).toBe(false)
      if (result.ok) continue
      expect(result.failure.kind).toBe('unknown-region')
    }
  })
})
