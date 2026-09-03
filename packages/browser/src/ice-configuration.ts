/**
 * This repository's own ICE configuration — NET-12.
 *
 * ## Why this file exists, and it is a stronger reason than adding TURN
 *
 * `browser-node.ts` constructed `webRTC()` with **no options**, so the four defaults in
 * `node_modules/@libp2p/webrtc/dist/src/constants.js:11-16` were this fabric's live ICE
 * configuration — a list nobody here chose, measured, or could notice rotting. **It rotted.**
 * Probed 2026-09-02 (`.planning/consults/2026-09-02-turn-provider-measured.md`):
 *
 * | default | probed |
 * |---|---|
 * | `stun.l.google.com:19302` | Binding success |
 * | `global.stun.twilio.com:3478` | Binding success |
 * | `stun.cloudflare.com:3478` | Binding success |
 * | `stun.services.mozilla.com:3478` | **`ENOTFOUND` — the name does not resolve** |
 *
 * Confirmed against three independent public resolvers, so it is not this host's DNS:
 * `8.8.8.8`, `1.1.1.1` and `9.9.9.9` all answer **`NXDOMAIN`**, while the same three return
 * `162.159.207.0` for `stun.cloudflare.com` in the same breath. That control is what separates
 * *this name is gone* from *DNS is not working here*, and it is the shape
 * `ice-servers-alive.e2e.test.ts` reproduces on every run.
 *
 * So every tab performed a failing DNS lookup on every ICE gathering. Three servers answered,
 * so nothing was broken; what was spent was latency on exactly the path `RUN-04`'s fourth
 * funnel stage measures. The dead entry is dropped here and each survivor carries the reason it
 * survived and the date it was last probed — because a list without a probe date is a list that
 * can rot again in silence.
 *
 * ## THE TRAP — why {@link IceConfiguration} makes `iceServers` non-optional
 *
 * This is not style. Read `node_modules/@libp2p/webrtc/dist/src/util.js:69-80`:
 *
 * ```js
 * config = config ?? {}
 * if (typeof config === 'function') { config = await config() }
 * config.iceServers = config.iceServers ?? DEFAULT_ICE_SERVERS.map(url => ({ urls: [url] }))
 * ```
 *
 * **A returned configuration without an `iceServers` key is not "no opinion". It is an
 * instruction to use the four package defaults, dead entry included.** The obvious thing to
 * write when a credential fetch fails — `return {}` — therefore hands every subsequent
 * gathering back the exact rot this file exists to remove, silently, and only on the failure
 * path. The return type below makes `iceServers` non-optional so a branch that forgets it
 * **fails to compile** rather than reinstating the dead name at runtime.
 *
 * ## The four-entry ceiling, and what it actually counts
 *
 * The library's own comment above `DEFAULT_ICE_SERVERS` says *"Using five or more servers
 * causes warnings to be printed so ensure we limit it to max x4."* Measured in Chromium
 * 2026-09-02: four entries carrying five URLs, and five entries, were **both** accepted with an
 * empty console — so the ceiling is the library's advice about gathering latency rather than an
 * engine limit. It is honoured anyway, and honoured without dropping a survivor: the two TURN
 * ports ride in **one** entry's `urls` array, because one entry's username and credential apply
 * to every URL in it. Three STUN entries plus one TURN entry is four.
 *
 * Nothing here touches a global at import time — `consent.ts`'s rule — so this module is safe
 * in the node lane and in an embedding host.
 */

/** A STUN entry, carrying the reason it is in the list and the day that reason was checked. */
export interface StunEntry {
  /** The `stun:` URL handed to `RTCPeerConnection`. */
  readonly urls: string
  /** Why this third party is in this fabric's configuration at all. */
  readonly why: string
  /** ISO date this entry was last observed answering a STUN Binding. */
  readonly probedOn: string
}

/**
 * The three survivors, with the reading that kept each one.
 *
 * `stun.services.mozilla.com:3478` is **deliberately absent** — see this file's header. Do not
 * add it back without a probe that answers; `ice-servers-alive.e2e.test.ts` reddens on any
 * entry here that stops resolving, and it was watched reddening on that exact name.
 */
export const STUN_SERVERS: readonly StunEntry[] = [
  {
    urls: 'stun:stun.l.google.com:19302',
    why: 'answered a STUN Binding; free, and STUN is all this needs to be — the owner ruling of 2026-09-02 kept STUN with Google while moving TURN to Cloudflare',
    probedOn: '2026-09-02',
  },
  {
    urls: 'stun:global.stun.twilio.com:3478',
    why: 'answered a STUN Binding; a second independent operator, so one operator withdrawing does not leave this fabric with a single reflexive-address source',
    probedOn: '2026-09-02',
  },
  {
    urls: 'stun:stun.cloudflare.com:3478',
    why: 'answered a STUN Binding; also the resolver control in the rot guard, because it resolved on 8.8.8.8, 1.1.1.1 and 9.9.9.9 in the same breath the dead entry did not',
    probedOn: '2026-09-02',
  },
]

/**
 * A TURN rung: the URLs, and the credential the server will accept for them.
 *
 * `urls` is a list because the provider was measured answering on **two** ports and both belong
 * in the configuration — see {@link turnEntry}.
 */
export interface TurnRung {
  readonly urls: readonly string[]
  readonly username: string
  readonly credential: string
}

/**
 * An `RTCConfiguration` whose `iceServers` is **present, always**.
 *
 * The non-optional key is the whole point of the type — see THE TRAP in this file's header. A
 * branch that omits it does not compile, which is what stops the dead default coming back on a
 * path nobody exercises.
 *
 * The array is `RTCIceServer[]` and not `readonly RTCIceServer[]` because `lib.dom`'s own
 * `RTCConfiguration.iceServers` is mutable, and a `ReadonlyArray` cannot widen to it under
 * `exactOptionalPropertyTypes`. The `readonly` that matters here is on the **property** — the
 * key cannot be dropped — which is the half THE TRAP is about.
 */
export interface IceConfiguration extends RTCConfiguration {
  readonly iceServers: RTCIceServer[]
}

/** What {@link iceConfiguration} needs to decide what to return. */
export interface IceConfigurationOptions {
  /**
   * The TURN rung, when one is held. Absent — no minting endpoint configured, TURN switched
   * off, or **the credential fetch failed** — yields the STUN list alone, never `{}`.
   */
  readonly turn?: TurnRung | null
  /**
   * Forces `iceTransportPolicy: 'relay'`, which makes a direct candidate impossible **by
   * policy**. Only a harness sets this, and only through the demo's `?iceTransportPolicy=`
   * parameter. It is never a default: a tab that could pair directly must be allowed to.
   */
  readonly relayOnly?: boolean
}

/**
 * The two ports the provider was measured answering on, as one entry.
 *
 * Port 3478 is the RFC 5766 default. **Port 53 is not decoration**: it survives the restrictive
 * corporate and mobile-carrier firewalls that drop 3478 — precisely the population TURN exists
 * to serve. Whether both ports are equally reachable from the cohort's networks is **not
 * measured and must not be assumed**; that is a question the public run answers.
 */
export function turnEntry(rung: TurnRung): RTCIceServer {
  return { urls: [...rung.urls], username: rung.username, credential: rung.credential }
}

/**
 * This fabric's ICE configuration, on every path.
 *
 * There is no branch that returns `{}`, `undefined`, or an object without `iceServers` — the
 * type forbids it and `ice-configuration.test.ts` enumerates the paths rather than sampling
 * them.
 */
export function iceConfiguration(options: IceConfigurationOptions = {}): IceConfiguration {
  const stun: RTCIceServer[] = STUN_SERVERS.map((entry) => ({ urls: entry.urls }))
  const iceServers = options.turn ? [...stun, turnEntry(options.turn)] : stun
  return options.relayOnly ? { iceServers, iceTransportPolicy: 'relay' } : { iceServers }
}
