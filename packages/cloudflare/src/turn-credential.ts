import { ed25519 } from '@noble/curves/ed25519.js'
import { TURN_MINT_PURPOSE, encodeCanonical, fromHex, verifyCertificate } from '@o2/core'
import type { CertificateFailure, NodeCertificate, PublicKeyHex } from '@o2/core'

/**
 * The hosted tier mints a short-lived TURN credential, behind a gate that did not exist — NET-12.
 *
 * ## CORRECTION 1: this gate is BUILT here and is not inherited
 *
 * The Phase 34 brief said `packages/cloudflare/` admitted peers behind a certificate check and
 * asked for it to be verified rather than assumed. It was, and it did not.
 * `grep -rn "verifyCertificate\\|EnrollmentAuthority\\|trustedIssuers\\|NodeCertificate"
 * packages/cloudflare/src/` returned **five hits, every one in a `*.test.ts` fixture** and none
 * in production source. The package's own words agreed —
 * `hosted-capabilities.ts:36`: *"The hosted node holds no certificate."* The only inbound gate
 * was `remoteAddrFromRequest`'s `CF-Connecting-IP` refusal, which is an **address**, not a
 * membership.
 *
 * So criterion 1's clause *"a request from outside the fabric is refused"* is not inherited from
 * a gate that exists. This module is that gate, and it is the largest single item in the phase.
 *
 * ## Why this module is pure
 *
 * The deployed Durable Object class is *"the only part of this file that no local spec can
 * reach"* (`hosted-object.ts`). Everything worth asserting therefore sits on this side of that
 * line: the certificate, the pinned issuer set, the shared secret, the clock, the lifetime and
 * the region's URLs all arrive as **parameters**. `worker.ts` supplies them and does nothing
 * else, so a local spec exercises the whole gate.
 *
 * ## The gate, in order, refusing at the first failure with its own name
 *
 * 1. The body parses and carries the four fields.
 * 2. {@link verifyCertificate} against the pinned issuer set — the fabric membership test,
 *    called on the hosted tier for the first time. Its `CertificateFailure` vocabulary is
 *    **reused** rather than paralleled, so one refusal has one name across the fabric.
 * 3. The signed payload's node key equals `certificate.nodeKey`. Without this a caller may
 *    present **somebody else's** certificate: a gate that checks a certificate and not who is
 *    holding it is a gate anyone can borrow.
 * 4. The signature verifies over `turnMintPayload` (`@o2/core`) — canonical bytes of a payload
 *    that names its own purpose, the node key, the region and the timestamp. **That builder
 *    lives in `@o2/core` and not here**, because the signer is a tab in `@o2/browser` and the
 *    verifier is this module in `@o2/cloudflare`: two packages, one set of bytes, and a second
 *    copy of the encoder would be two encoders free to drift across a boundary where the drift
 *    is hard to see.
 * 5. The timestamp is within {@link ACCEPTANCE_WINDOW_MS} of the worker's clock.
 *
 * ## The replay limit is STATED rather than engineered around
 *
 * A nonce needs a round trip and Durable Object storage. A timestamp window does not. Inside the
 * window a captured request re-mints a credential **for the identity it was already minted
 * for**, which is strictly weaker than capturing the client's key, and it expires with the
 * window. That is a choice, not an omission — it is `T-34-03` in the phase threat register with
 * an `accept` disposition.
 *
 * ## Two clocks, and neither is the other's
 *
 * The worker's clock decides freshness; the **TURN server's** clock decides whether a minted
 * credential still works. The lifetime this module states is a *claim*, and `turn-fallback`'s
 * arms C and D are where coturn is observed enforcing it. Note also that Cloudflare's runtime
 * advances `Date.now()` only across I/O, so within one synchronous handler the clock does not
 * move — fine for a window check, and not fine for anything measuring elapsed time here.
 *
 * ## CORRECTION 4: one adapter, and the second is deliberately unwritten
 *
 * Two credential schemes sit behind this one route and only one of them can be measured here.
 * **This module implements the shared-secret scheme** (`coturn`'s `use-auth-secret` mode, RFC
 * 5766 long-term credentials over an HMAC), which a local `coturn` accepts and which every spec
 * in this phase runs against.
 *
 * **Cloudflare's own scheme is NOT implemented**, and that is the point rather than an omission.
 * Cloudflare mints through an authenticated API call against a key this project does not have;
 * the provider probe cannot get past `401` without one. Writing that adapter now would be code
 * standing on documentation — the *"wired is not used"* shape `CLAUDE.md` records being caught
 * three times on the DHT. The seam is {@link TurnMinter}; the runbook's first engineering step
 * is *probe the credentials endpoint with the real key and record the observed response shape*,
 * and the adapter is written against that observation, not before it.
 */

/** How far a request's own timestamp may sit from the worker's clock. */
export const ACCEPTANCE_WINDOW_MS = 60_000

/**
 * How long a minted credential is claimed to live.
 *
 * Short because the credential is readable by any script in the page — unavoidable, since
 * `RTCPeerConnection` needs it there. **The short lifetime IS the mitigation** (`T-34-04`),
 * which is exactly why criterion 1 states it, and it is measured being enforced by the TURN
 * server rather than asserted.
 */
export const CREDENTIAL_LIFETIME_MS = 600_000

/**
 * What a caller sends. `signature` is over `turnMintPayload` from `@o2/core`, hex.
 *
 * `nodeKey` is carried **explicitly** rather than read off the certificate, and that is the
 * whole of why step 3 exists. The signature is verified against *this* key; step 3 is what
 * requires it to be the key the certificate names. Fusing the two — building the payload
 * straight from `certificate.nodeKey` — would make the binding true by construction and leave
 * nothing to check, which reads as safe and removes the ability to ever prove it. Held apart,
 * a caller presenting somebody else's certificate alongside their own key and their own
 * perfectly valid signature is refused **by name**, and that refusal is plantable.
 */
export interface TurnCredentialRequest {
  readonly certificate: NodeCertificate
  readonly nodeKey: PublicKeyHex
  readonly region: string
  readonly requestedAt: number
  readonly signature: string
}

/**
 * The bytes a mint request is signed over — the VERIFIER's side.
 *
 * `browser-node.ts` builds the identical object on the signer's side. Only
 * {@link TURN_MINT_PURPOSE} is shared, for the reason `enrollment.ts` records, and
 * `turn-mint-payload.node.test.ts` asserts the two produce byte-identical output rather than
 * leaving a comment to hold them together.
 */
export function turnMintPayload(
  nodeKey: PublicKeyHex,
  region: string,
  requestedAt: number,
): Uint8Array {
  const encoded = encodeCanonical({ purpose: TURN_MINT_PURPOSE, nodeKey, region, requestedAt })
  if (!encoded.ok) throw new Error(`TURN mint payload is not encodable: ${String(encoded.error.kind)}`)
  return encoded.bytes
}

/** Every way this gate says no. One name per reason, so a caller learns which. */
export type TurnMintFailure =
  | { readonly kind: 'malformed-request' }
  | { readonly kind: 'certificate-refused'; readonly failure: CertificateFailure }
  | { readonly kind: 'node-key-mismatch' }
  | { readonly kind: 'bad-signature' }
  | { readonly kind: 'stale-request'; readonly skewMs: number }
  | { readonly kind: 'unknown-region'; readonly region: string }
  | { readonly kind: 'turn-not-configured' }

/** What a caller gets when the gate lets it through. */
export interface TurnCredentialGrant {
  readonly username: string
  readonly credential: string
  readonly urls: readonly string[]
  readonly expiresAt: number
  readonly region: string
}

export type TurnMintResult =
  | { readonly ok: true; readonly grant: TurnCredentialGrant }
  | { readonly ok: false; readonly failure: TurnMintFailure; readonly reason: string }

/**
 * The seam CORRECTION 4 names.
 *
 * {@link sharedSecretMinter} is the only implementation, because it is the only one that can be
 * measured without a key nobody here holds. A Cloudflare implementation goes here — behind this
 * same type — after the runbook's step 3 records what that provider actually answers.
 */
export interface TurnMinter {
  mint(fields: {
    readonly nodeKey: PublicKeyHex
    readonly region: string
    readonly expiresAt: number
    readonly urls: readonly string[]
  }): Promise<TurnCredentialGrant>
}

/** Base64 without assuming Node's `Buffer` — workerd has neither `Buffer` nor `node:` by default. */
function base64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

/**
 * The scheme a local `coturn` in `use-auth-secret` mode accepts, and the one this phase measures.
 *
 * The username carries the expiry as a Unix timestamp, the region tag and the node key, so an
 * allocation logged by the TURN server is **attributable** — to a time, to a region, and to an
 * identity the certificate named. The credential is the base64 of an HMAC-SHA1 over that
 * username with the shared secret, computed with WebCrypto because workerd has it and
 * `node:crypto` is not available there.
 *
 * SHA-1 is not a choice this project is making about hash strength: RFC 5766's long-term
 * credential mechanism specifies HMAC-SHA1 and `coturn` implements that. It authenticates a
 * short-lived credential to one server; it is not used as a content hash anywhere.
 */
export function sharedSecretMinter(secret: string): TurnMinter {
  return {
    async mint(fields) {
      const expirySeconds = Math.floor(fields.expiresAt / 1000)
      const username = `${String(expirySeconds)}:${fields.region}:${fields.nodeKey}`
      const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(secret),
        { name: 'HMAC', hash: 'SHA-1' },
        false,
        ['sign'],
      )
      const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(username))
      return {
        username,
        credential: base64(new Uint8Array(mac)),
        urls: [...fields.urls],
        expiresAt: fields.expiresAt,
        region: fields.region,
      }
    },
  }
}

/** Everything the gate needs, supplied by the caller so a local spec can reach all of it. */
export interface TurnMintContext {
  readonly pinnedIssuers: ReadonlySet<PublicKeyHex>
  readonly now: number
  readonly minter: TurnMinter | null
  /** The region's TURN URLs, or `null` when the region is not one this deployment declares. */
  readonly urlsForRegion: (region: string) => readonly string[] | null
  readonly lifetimeMs?: number
}

/** Narrow an unknown body to a request shape without trusting any of its values. */
export function parseMintRequest(body: unknown): TurnCredentialRequest | null {
  if (typeof body !== 'object' || body === null) return null
  const candidate = body as Partial<TurnCredentialRequest>
  if (typeof candidate.region !== 'string') return null
  if (typeof candidate.requestedAt !== 'number' || !Number.isFinite(candidate.requestedAt)) {
    return null
  }
  if (typeof candidate.signature !== 'string' || candidate.signature.length === 0) return null
  if (typeof candidate.nodeKey !== 'string' || candidate.nodeKey.length === 0) return null
  const certificate = candidate.certificate
  if (typeof certificate !== 'object' || certificate === null) return null
  if (typeof (certificate as NodeCertificate).nodeKey !== 'string') return null
  if (typeof (certificate as NodeCertificate).issuer !== 'string') return null
  return candidate as TurnCredentialRequest
}

/**
 * Run the gate and, if it opens, mint.
 *
 * The order of the checks is the security argument — see this file's header. Each refusal
 * carries its own name so a caller learns *which* thing was wrong, and the positive control (a
 * certificate that verifies gets a credential) is a first-class case in the specs: without it,
 * every refusal below is just an endpoint that refuses everything.
 */
export async function mintTurnCredential(
  body: unknown,
  context: TurnMintContext,
): Promise<TurnMintResult> {
  const request = parseMintRequest(body)
  if (request === null) {
    return {
      ok: false,
      failure: { kind: 'malformed-request' },
      reason: 'body is not a TURN credential request: expected certificate, nodeKey, region, requestedAt, signature',
    }
  }

  // (2) Membership. The first time this tier has asked the question at all.
  const verdict = verifyCertificate(request.certificate, context.pinnedIssuers, context.now)
  if (!verdict.ok) {
    return {
      ok: false,
      failure: { kind: 'certificate-refused', failure: verdict.failure },
      reason: `certificate refused (${verdict.failure.kind}): ${verdict.reason}`,
    }
  }

  // (5) Freshness before signature work: it is the cheapest refusal available and it bounds
  // how long a captured request stays useful.
  const skewMs = Math.abs(context.now - request.requestedAt)
  if (skewMs > ACCEPTANCE_WINDOW_MS) {
    return {
      ok: false,
      failure: { kind: 'stale-request', skewMs },
      reason: `request timestamp is ${String(skewMs)} ms from this worker's clock, outside the ${String(ACCEPTANCE_WINDOW_MS)} ms acceptance window`,
    }
  }

  // (3) THE BINDING. A certificate says *this node key is in the fabric*; it says nothing about
  // who is holding the certificate. Without this line a caller may present a certificate they
  // copied off the wire together with their own key and their own valid signature, and the gate
  // would open for them — a gate that checks a certificate and not who is holding it is a gate
  // anyone can borrow.
  const nodeKey = request.nodeKey
  if (nodeKey !== request.certificate.nodeKey) {
    return {
      ok: false,
      failure: { kind: 'node-key-mismatch' },
      reason: `request is signed for ${nodeKey} but presents a certificate naming ${request.certificate.nodeKey} — a certificate is not transferable`,
    }
  }

  // (4) Possession. The signature must be one the claimed key made over this exact request.
  const payload = turnMintPayload(nodeKey, request.region, request.requestedAt)
  let signatureValid = false
  try {
    signatureValid = ed25519.verify(fromHex(request.signature), payload, fromHex(nodeKey))
  } catch {
    // A signature or key that is not hex at all is a bad signature, not a crash. Kept narrow:
    // only the decode and verify are inside the `try`.
    signatureValid = false
  }
  if (!signatureValid) {
    return {
      ok: false,
      failure: { kind: 'bad-signature' },
        reason: `signature does not verify over this request under ${nodeKey} — a certificate is not enough, the caller must hold the key it names`,
    }
  }

  const urls = context.urlsForRegion(request.region)
  if (urls === null) {
    return {
      ok: false,
      failure: { kind: 'unknown-region', region: request.region },
      reason: `"${request.region}" is not a region this deployment declares`,
    }
  }

  // Absent means REFUSE BY NAME rather than mint something that cannot work. A credential
  // minted with no secret would be a credential every TURN server answers 401 to, which
  // presents to a caller as a network fault rather than as a deployment that is not configured.
  if (context.minter === null) {
    return {
      ok: false,
      failure: { kind: 'turn-not-configured' },
      reason: 'this deployment holds no TURN shared secret, so it cannot mint a credential',
    }
  }

  const expiresAt = context.now + (context.lifetimeMs ?? CREDENTIAL_LIFETIME_MS)
  return { ok: true, grant: await context.minter.mint({ nodeKey, region: request.region, expiresAt, urls }) }
}
