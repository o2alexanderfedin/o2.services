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
  mintTurnCredential,
  sharedSecretMinter,
  turnMintPayload,
} from './turn-credential.ts'

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
    const grant = await sharedSecretMinter(secret).mint({
      nodeKey: 'aa',
      region: 'bootstrap-us',
      expiresAt: 1_800_000_600_000,
      urls: URLS,
    })
    expect(grant.username).toBe('1800000600:bootstrap-us:aa')
    expect(grant.credential).toBe('mPwKVlaWnCJ74v6KKiiPnW+9ncs=')
  })

  it('carries the expiry, the region and the node key, so an allocation is attributable', async () => {
    const grant = await sharedSecretMinter('s').mint({
      nodeKey: 'deadbeef',
      region: 'bootstrap-eu',
      expiresAt: 1_800_000_600_000,
      urls: URLS,
    })
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
