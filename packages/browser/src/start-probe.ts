/**
 * Why a node could not start, established rather than guessed — BROW-02.
 *
 * The tempting implementation is to catch whatever `start()` throws and pattern-
 * match its message. That produces a metric made of string matching against error
 * text from three browsers and half a dozen libraries, which drifts silently and is
 * wrong in exactly the cases that matter — a new browser version wording a security
 * error differently is precisely the event this measurement exists to notice.
 *
 * So the environment is probed *first*, and a missing capability is a fact about
 * this browser rather than an inference from prose. Only when everything needed is
 * present does a thrown error get classified, and then it is classified honestly as
 * `other` unless it names something specific.
 *
 * ## The crypto probe is `getRandomValues`, never `subtle`
 *
 * This is load-bearing and was learned the hard way. A LAN origin such as
 * `http://laptop.local:5173` is **not a secure context**, so `crypto.subtle` is
 * absent — while `crypto.getRandomValues` is present. The kernel must never require
 * `subtle` (its hashing is pure JS for exactly this reason), so a probe that checked
 * for it would report every LAN visitor as blocked and manufacture a cliff that does
 * not exist.
 */

import type { StartFailure } from '@o2/core'

export interface StartEnvironment {
  readonly wasm: boolean
  readonly webrtc: boolean
  readonly storage: boolean
  /** `crypto.getRandomValues`. Deliberately **not** `crypto.subtle`. */
  readonly crypto: boolean
}

/** The globals this probe reads. Injectable so a test can remove one. */
export interface ProbeGlobals {
  readonly WebAssembly?: unknown
  readonly RTCPeerConnection?: unknown
  readonly indexedDB?: unknown
  readonly crypto?: unknown
}

const hasFunction = (host: unknown, key: string): boolean =>
  typeof host === 'object' && host !== null && typeof (host as Record<string, unknown>)[key] === 'function'

export function probeEnvironment(globals: ProbeGlobals = globalThis): StartEnvironment {
  return {
    wasm: hasFunction(globals.WebAssembly, 'instantiate') && hasFunction(globals.WebAssembly, 'compile'),
    webrtc: typeof globals.RTCPeerConnection === 'function',
    storage: typeof globals.indexedDB === 'object' && globals.indexedDB !== null,
    crypto: hasFunction(globals.crypto, 'getRandomValues'),
  }
}

/**
 * The first missing capability, in the order a visitor would care about.
 *
 * WASM before WebRTC before storage: a browser with no WASM cannot contribute at
 * all, one with no WebRTC can only ever be a spectator, and one with no storage
 * works but forgets. Reporting the most fundamental gap keeps the metric readable —
 * a browser that blocks everything would otherwise appear under whichever cause
 * happened to be checked first.
 */
export function firstGap(environment: StartEnvironment): StartFailure | null {
  if (!environment.wasm) return 'wasm-unavailable'
  if (!environment.webrtc) return 'webrtc-unavailable'
  if (!environment.crypto) return 'crypto-unavailable'
  if (!environment.storage) return 'storage-denied'
  return null
}

/**
 * Classify a failure that happened despite a complete environment.
 *
 * Only one message is matched, and only because the page raises it itself: "no
 * relay" is this application's own error, not a browser's. Everything else is
 * `other`, which is honest — and a report where `other` dominates is the finding
 * that this function needs another case, rather than a case quietly mislabelled.
 */
export function classifyStartError(error: unknown, environment: StartEnvironment): StartFailure {
  const gap = firstGap(environment)
  if (gap !== null) return gap
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes('no relay')) return 'no-relay-reachable'
  return 'other'
}
