import type { TurnRung } from './ice-configuration.ts'

/**
 * A tab's TURN credential: fetched from the hosted minter, held, and refetched before it dies.
 *
 * ## Why a holder rather than a value
 *
 * `@libp2p/webrtc` invokes `rtcConfiguration`'s function form **once per connection, in both
 * directions** — `private-to-private/transport.js:100` for an outbound dial and `:131` for an
 * inbound one, each `await getRtcConfiguration(this.init.rtcConfiguration)`. That is a measured
 * reading of the installed package, and it is what makes "short-lived" possible at all: a
 * credential captured once at start would expire mid-session with nothing to replace it. This
 * module is what the function form consults.
 *
 * ## THE FAILURE PATH IS THE IMPORTANT ONE
 *
 * When the fetch fails this holder answers `null`, and `iceConfiguration` turns `null` into
 * **the explicit STUN list**. It must never turn into `{}` or a configuration without an
 * `iceServers` key, because `getRtcConfiguration` reads a missing key as *use the four package
 * defaults* — including `stun.services.mozilla.com`, which does not resolve. So a failed
 * credential fetch would silently reinstate the rot Phase 34 removed, on the one path nobody
 * exercises. See THE TRAP in `ice-configuration.ts`; `turn-fallback.e2e.test.ts` plants exactly
 * this and reads what the page actually handed `RTCPeerConnection`.
 *
 * ## Rotation
 *
 * A credential is refetched once the clock is within {@link REFRESH_MARGIN_MS} of `expiresAt`,
 * not at it. A tab that discovers its credential is dead at the moment it needs one has already
 * lost the connection it needed it for.
 *
 * Everything is injected — the fetch and the clock — so this is unit-testable without a network
 * and without a real minute passing. Nothing touches a global at import time (`consent.ts`'s
 * rule), so the module is safe in the node lane.
 */

/** Refetch this long before the stated expiry. */
export const REFRESH_MARGIN_MS = 60_000

/** What the hosted minter answers on success. Narrowed to what this module uses. */
export interface MintedCredential {
  readonly ok: true
  readonly username: string
  readonly credential: string
  readonly urls: readonly string[]
  readonly expiresAt: number
  readonly region: string
}

/** How a caller proves it belongs to the fabric. Built by the page; this module only carries it. */
export interface MintRequestBody {
  readonly certificate: unknown
  readonly nodeKey: string
  readonly region: string
  readonly requestedAt: number
  readonly signature: string
}

export interface TurnCredentialHolderOptions {
  /** Where the minter lives, e.g. `http://127.0.0.1:8814/turn-credential`. */
  readonly endpoint: string
  /** Builds a freshly-signed request body. Called once per fetch, because it carries a timestamp. */
  readonly requestBody: () => MintRequestBody | Promise<MintRequestBody>
  readonly fetchImpl?: typeof fetch
  readonly now?: () => number
  readonly refreshMarginMs?: number
  /** Told about a refusal, so a page can show why it has no rung. Never throws into the caller. */
  readonly onFailure?: (reason: string) => void
}

export interface TurnCredentialHolder {
  /**
   * The rung to use right now, or `null` when there is none.
   *
   * `null` is a first-class answer and not an error: it means *no TURN this time*, and the
   * configuration built from it still carries the explicit STUN list.
   */
  rung(): Promise<TurnRung | null>
  /** The last refusal, for a page that wants to say why. */
  lastFailure(): string | null
}

/**
 * Hold a credential, refetching inside the margin.
 *
 * Concurrent callers share one in-flight fetch. `@libp2p/webrtc` asks per connection and a tab
 * may dial several peers at once; without this, six simultaneous dials would be six mint
 * requests for one credential.
 */
export function turnCredentialHolder(
  options: TurnCredentialHolderOptions,
): TurnCredentialHolder {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis)
  const now = options.now ?? (() => Date.now())
  const margin = options.refreshMarginMs ?? REFRESH_MARGIN_MS

  let held: MintedCredential | null = null
  let inFlight: Promise<TurnRung | null> | null = null
  let failure: string | null = null

  const usable = (credential: MintedCredential | null): boolean =>
    credential !== null && now() < credential.expiresAt - margin

  async function refetch(): Promise<TurnRung | null> {
    try {
      const response = await fetchImpl(options.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(await options.requestBody()),
      })
      const body = (await response.json()) as Partial<MintedCredential> & { reason?: string; kind?: string }
      if (!response.ok || body.ok !== true) {
        // A named refusal from the gate, kept as the reason rather than flattened to "failed".
        failure = `minter refused (${String(body.kind ?? response.status)}): ${String(body.reason ?? 'no reason given')}`
        options.onFailure?.(failure)
        return null
      }
      held = body as MintedCredential
      failure = null
      return { urls: held.urls, username: held.username, credential: held.credential }
    } catch (cause) {
      // A network failure is a refusal too, from this module's point of view: there is no rung.
      // It must NOT throw — the caller is `rtcConfiguration`'s function form, and a throw there
      // takes down the dial rather than falling back to STUN.
      failure = `could not reach the minter at ${options.endpoint}: ${String(cause)}`
      options.onFailure?.(failure)
      return null
    }
  }

  return {
    async rung() {
      if (usable(held) && held !== null) {
        return { urls: held.urls, username: held.username, credential: held.credential }
      }
      // The held credential is inside its margin or gone. Drop it before refetching so a
      // failure answers `null` rather than handing back a credential that is about to die.
      held = null
      inFlight ??= refetch().finally(() => {
        inFlight = null
      })
      return inFlight
    },
    lastFailure: () => failure,
  }
}
