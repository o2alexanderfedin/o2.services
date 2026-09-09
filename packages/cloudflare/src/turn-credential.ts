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
 *
 * ## AMENDED 2026-09-09 — the second adapter now exists, and the paragraph above is why it can
 * ## be trusted
 *
 * CORRECTION 4 is kept rather than rewritten, because the discipline it states is the whole
 * reason {@link cloudflareTurnMinter} is worth having: it was written **after** the probe it
 * demanded, against an observed response and not against a vendor page. The owner created a
 * Cloudflare TURN application on 2026-09-09 and the probe was taken the same day:
 *
 *     POST https://rtc.live.cloudflare.com/v1/turn/keys/<key id>/credentials/generate-ice-servers
 *     Authorization: Bearer <API credential>        body: {"ttl": 3600}
 *     → 201  {"iceServers": [ … ]}
 *
 * **What came back is not what this module was built for.** `iceServers` was an ARRAY of two
 * entries: one carrying `urls: ["stun:stun.cloudflare.com:3478"]` and no credentials at all, and
 * one carrying five `turn:`/`turns:` forms — including `turns:turn.cloudflare.com:443` — beside
 * a `username` and a `credential` of **64 hex characters each**. The username has no `expiry:`
 * prefix, so this is not RFC 5766's long-term credential form: Cloudflare's TURN server verifies
 * credentials **it** issued, and there is no shared secret for this module to HMAC over.
 *
 * That matters more than a shape difference. Putting the API credential into `O2_TURN_SECRET`
 * would have produced a well-formed HMAC credential that every Cloudflare TURN server answers
 * `401` to — a credential that reaches a tab, is installed into `RTCPeerConnection`, and fails
 * as a **network fault**. It would have walked straight past the `turn-not-configured` refusal
 * this module wrote specifically to stop that. The two schemes therefore get two names in the
 * environment, and `worker.ts` says which wins.
 *
 * **And the adapter itself was then run against that endpoint once, which is a different claim
 * from the probe.** The `curl` above proved the API; it did not prove this code reads it.
 * `cloudflareTurnMinter` was invoked with the real pair on 2026-09-09 and answered `ok`: a
 * 64-character `username` and `credential`, **five** URLs, `turns:turn.cloudflare.com:443`
 * among them, and `urls.some(u => u.startsWith('stun:'))` **false** — so
 * {@link providerTurnEntry} skipped the credential-less STUN entry on a real response and not
 * only on a fixture. Nothing in the test lanes repeats that call: the node lane injects a
 * `fetch` and the e2e lane points `O2_TURN_API_BASE` at a loopback stub, because a suite whose
 * greenness depends on somebody else's uptime is a suite that reports the weather.
 *
 * So {@link cloudflareTurnMinter} does not mint. It **asks**, and hands on what it is given.
 * Three consequences, recorded rather than smoothed over:
 *
 * 1. **The region stops choosing the URL on this path.** Cloudflare answers with its own
 *    endpoints, and a credential is only valid at them. The region is still checked — an
 *    undeclared name is still refused by name — but it is now an *admission* question alone.
 *    `turn-regions.ts` was re-split for this: `null` means undeclared, `[]` means declared with
 *    no URLs of the deployment's own, and only a minter that needs them refuses `[]`.
 * 2. **Attribution moves to the provider.** The shared-secret username carries
 *    `expiry:region:nodeKey`, so an allocation in a `coturn` log is attributable to an identity
 *    the certificate named. Cloudflare's username is opaque and this module cannot put anything
 *    into it, so on this path server-side attribution is **theirs, not ours**. `grant.region`
 *    still rides back to the caller; that is a client-side tag and is not the same claim.
 * 3. **The lifetime is a claim on this path, not a measurement.** `turn-fallback.e2e.test.ts`
 *    arms C and D observe a real TURN server enforcing an expiry, and they run against `coturn`
 *    with the shared-secret scheme. Nothing here has watched Cloudflare refuse an expired
 *    credential, and the `ttl` this module sends is not echoed in the response. Do not restate
 *    the measured-enforcement property for this path without a live observation of it.
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
  /**
   * The region is declared and this deployment names no TURN URLs for it, under a minter that
   * needs them. Distinct from `turn-not-configured` on purpose: the secret is present and the
   * URLs are not, which is a different line of the deployment to go and look at.
   */
  | { readonly kind: 'no-urls-for-region'; readonly region: string }
  /**
   * The gate opened and the credential provider would not supply one.
   *
   * **This is not the caller's fault and must not be answered `400`.** A tab that presented a
   * valid certificate and a valid signature has done everything right; a `401` from Cloudflare
   * means this deployment's API credential is wrong, and a `5xx` or a socket failure means the
   * provider is having a bad minute. Both are the operator's to read, which is why the detail
   * travels with the refusal.
   */
  | { readonly kind: 'provider-refused'; readonly detail: string }

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
 * What a minter answers.
 *
 * A minter can fail, and the two that exist fail for reasons a caller must be able to tell
 * apart from *your request was wrong*. `mint` therefore returns a verdict rather than throwing
 * or resolving to a grant it could not build — the same shape the rest of this module uses, and
 * the reason `TurnMintFailure` gained two members on 2026-09-09.
 */
export type TurnMintOutcome =
  | { readonly ok: true; readonly grant: TurnCredentialGrant }
  | {
      readonly ok: false
      readonly kind: 'no-urls-for-region' | 'provider-refused'
      readonly detail: string
    }

/**
 * The seam CORRECTION 4 names — now with both implementations behind it.
 *
 * {@link sharedSecretMinter} speaks `coturn`'s `use-auth-secret` scheme and is the one every
 * arm of `turn-fallback.e2e.test.ts` measures against a real TURN server.
 * {@link cloudflareTurnMinter} asks Cloudflare's API instead, and was written against the
 * response recorded in this file's AMENDED block rather than against their documentation.
 *
 * `now` is supplied rather than read, because a minter that needs a relative lifetime — which
 * Cloudflare's does, it takes a `ttl` in seconds — must not reach for a clock the gate did not
 * choose. `worker.ts` passes the same `Date.now()` the freshness window was checked against.
 */
export interface TurnMinter {
  mint(fields: {
    readonly nodeKey: PublicKeyHex
    readonly region: string
    readonly now: number
    readonly expiresAt: number
    /**
     * The URLs this deployment declares for the region — possibly empty.
     *
     * A minter that builds a credential FOR those URLs refuses an empty list; a minter whose
     * provider answers with its own endpoints ignores this entirely. Which of the two is in
     * force is the minter's own knowledge and is not a flag the gate carries.
     */
    readonly urls: readonly string[]
  }): Promise<TurnMintOutcome>
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
      // This scheme mints a credential FOR a set of servers the deployment names, so an empty
      // list is not a credential with no address — it is no credential at all. Refusing here
      // rather than upstream keeps the knowledge with the minter that has it: the provider-backed
      // minter is handed the same empty list and is right to ignore it.
      if (fields.urls.length === 0) {
        return {
          ok: false,
          kind: 'no-urls-for-region',
          detail: `"${fields.region}" is declared but this deployment names no TURN URLs for it, and the shared-secret scheme mints a credential for named servers`,
        }
      }
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
        ok: true,
        grant: {
          username,
          credential: base64(new Uint8Array(mac)),
          urls: [...fields.urls],
          expiresAt: fields.expiresAt,
          region: fields.region,
        },
      }
    },
  }
}

/** Where Cloudflare issues TURN credentials. Overridable so a spec can point it at a stub. */
export const CLOUDFLARE_TURN_API_BASE = 'https://rtc.live.cloudflare.com/v1/turn/keys'

/**
 * One entry of a provider's `iceServers`, narrowed to what this module reads.
 *
 * Everything is `unknown` because it arrived over the network from somebody else's server. The
 * probe on 2026-09-09 returned `urls` as an array of strings, and the vendor's own example shows
 * a single object rather than a list; {@link providerTurnEntry} accepts both rather than betting
 * on which — a tolerance, not a guess, and the array form is the one that was measured.
 */
interface ProviderIceServer {
  readonly urls?: unknown
  readonly username?: unknown
  readonly credential?: unknown
}

/**
 * The one entry of a provider answer that carries a credential, or `null`.
 *
 * The measured response held two entries and the first was **STUN with no credentials at all**,
 * so "take `iceServers[0]`" would have shipped a rung with `undefined` in both fields. Selecting
 * by *carries a username and a credential* is what makes that impossible, and it drops the STUN
 * entry for free — this fabric ships its own STUN list from `ice-configuration.ts` and does not
 * want a second opinion mixed into a TURN rung.
 */
function providerTurnEntry(
  payload: unknown,
): { readonly urls: string[]; readonly username: string; readonly credential: string } | null {
  if (typeof payload !== 'object' || payload === null) return null
  const iceServers = (payload as { readonly iceServers?: unknown }).iceServers
  const entries: unknown[] = Array.isArray(iceServers) ? iceServers : [iceServers]
  for (const entry of entries) {
    if (typeof entry !== 'object' || entry === null) continue
    const { urls, username, credential } = entry as ProviderIceServer
    if (typeof username !== 'string' || typeof credential !== 'string') continue
    if (username === '' || credential === '') continue
    const listed: unknown[] = Array.isArray(urls) ? urls : [urls]
    const list = listed.filter((url): url is string => typeof url === 'string' && url !== '')
    if (list.length === 0) continue
    return { urls: list, username, credential }
  }
  return null
}

/**
 * Ask Cloudflare for a credential rather than minting one — see this file's AMENDED block.
 *
 * The key id is not a secret and the API credential is; both are read off the environment by
 * `worker.ts` and neither appears in a refusal, because a refusal is handed to a caller who has
 * only proved fabric membership. What a caller learns on failure is the status and a truncated
 * body, which is what an operator needs and nothing more.
 *
 * A non-2xx, an unparseable body and a socket failure all land on `provider-refused` with their
 * own detail. None of them throws: the gate above has already decided this caller is entitled to
 * an answer, and an exception here would surface as a 500 that says nothing.
 */
export function cloudflareTurnMinter(config: {
  readonly keyId: string
  readonly apiSecret: string
  readonly fetchImpl?: typeof fetch
  readonly apiBase?: string
}): TurnMinter {
  const call = config.fetchImpl ?? fetch
  const base = config.apiBase ?? CLOUDFLARE_TURN_API_BASE
  return {
    async mint(fields) {
      // Seconds, from the gate's own clock and the lifetime it chose — never from `Date.now()`
      // here. `Math.max(1, …)` because a ttl of 0 would be a credential born dead, and the one
      // path that could produce it is a caller-supplied lifetime of under a second.
      const ttl = Math.max(1, Math.round((fields.expiresAt - fields.now) / 1000))
      let response: Response
      try {
        response = await call(
          `${base}/${encodeURIComponent(config.keyId)}/credentials/generate-ice-servers`,
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${config.apiSecret}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ ttl }),
          },
        )
      } catch (cause) {
        return {
          ok: false,
          kind: 'provider-refused',
          detail: `could not reach the credential provider: ${cause instanceof Error ? cause.message : String(cause)}`,
        }
      }

      const text = await response.text()
      if (!response.ok) {
        // Truncated: the body is somebody else's and an unbounded one would go into a response
        // this worker hands to a caller from outside.
        return {
          ok: false,
          kind: 'provider-refused',
          detail: `the credential provider answered ${String(response.status)}: ${text.slice(0, 200)}`,
        }
      }

      let payload: unknown
      try {
        payload = JSON.parse(text)
      } catch {
        return {
          ok: false,
          kind: 'provider-refused',
          detail: `the credential provider answered ${String(response.status)} with a body that is not JSON`,
        }
      }

      const entry = providerTurnEntry(payload)
      if (entry === null) {
        return {
          ok: false,
          kind: 'provider-refused',
          detail: 'the credential provider answered without an iceServers entry carrying a username and a credential',
        }
      }

      return {
        ok: true,
        grant: {
          username: entry.username,
          credential: entry.credential,
          // The provider's own endpoints, NOT `fields.urls`. A credential it issued is valid at
          // its servers and nowhere else, so handing back a deployment-declared list here would
          // pair a working credential with an address it does not work at.
          urls: entry.urls,
          // A claim, not an observation — consequence 3 of the AMENDED block.
          expiresAt: fields.expiresAt,
          region: fields.region,
        },
      }
    },
  }
}

/** Everything the gate needs, supplied by the caller so a local spec can reach all of it. */
export interface TurnMintContext {
  readonly pinnedIssuers: ReadonlySet<PublicKeyHex>
  readonly now: number
  readonly minter: TurnMinter | null
  /**
   * The region's TURN URLs, or `null` when the region is not one this deployment declares.
   *
   * **An empty array is a legal answer and means something different from `null`** — the region
   * is declared and the deployment names no URLs of its own. Whether that is fatal belongs to
   * the minter: the shared-secret scheme refuses it, the provider-backed one brings its own
   * endpoints and ignores it. Before 2026-09-09 the two were fused into `null`, which made a
   * Cloudflare-only deployment refuse **every** mint as `unknown-region` — a configuration
   * mistake wearing a client-error name.
   */
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
  const outcome = await context.minter.mint({
    nodeKey,
    region: request.region,
    now: context.now,
    expiresAt,
    urls,
  })
  if (!outcome.ok) {
    // The minter's own refusal, carried through under its own name. Both members of that closed
    // set are the OPERATOR's to read: this caller presented a certificate and a signature that
    // both verified, so nothing it can change would help.
    return outcome.kind === 'provider-refused'
      ? {
          ok: false,
          failure: { kind: 'provider-refused', detail: outcome.detail },
          reason: outcome.detail,
        }
      : {
          ok: false,
          failure: { kind: 'no-urls-for-region', region: request.region },
          reason: outcome.detail,
        }
  }
  return { ok: true, grant: outcome.grant }
}
