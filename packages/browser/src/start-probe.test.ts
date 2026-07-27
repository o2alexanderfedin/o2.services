import { describe, expect, it } from 'vitest'
import { classifyStartError, firstGap, probeEnvironment } from './start-probe.ts'
import type { ProbeGlobals, StartEnvironment } from './start-probe.ts'

/** BROW-02 — the cause of a failure to start, established rather than guessed. */

const complete: ProbeGlobals = {
  WebAssembly: { instantiate: () => undefined, compile: () => undefined },
  RTCPeerConnection: () => undefined,
  indexedDB: {},
  crypto: { getRandomValues: () => undefined },
}

const environment = (overrides: Partial<StartEnvironment> = {}): StartEnvironment => ({
  wasm: true,
  webrtc: true,
  storage: true,
  crypto: true,
  ...overrides,
})

describe('the probe sees what is actually there', () => {
  it('reports a complete environment as complete', () => {
    expect(probeEnvironment(complete)).toEqual({ wasm: true, webrtc: true, storage: true, crypto: true })
    expect(firstGap(probeEnvironment(complete))).toBeNull()
  })

  it.each([
    ['WebAssembly', 'wasm-unavailable'],
    ['RTCPeerConnection', 'webrtc-unavailable'],
    ['crypto', 'crypto-unavailable'],
    ['indexedDB', 'storage-denied'],
  ])('names %s missing as %s', (missing, cause) => {
    // A planted absence per capability. Every checker in this repository gets a
    // planted violation before it is trusted — an unfalsified check has been wrong
    // here before, in six of eighteen cases.
    const crippled: ProbeGlobals = { ...complete, [missing]: undefined }
    expect(firstGap(probeEnvironment(crippled))).toBe(cause)
  })

  it('is not fooled by a WebAssembly object that cannot compile', () => {
    // Some hardening extensions leave the global in place and remove its methods.
    const stub: ProbeGlobals = { ...complete, WebAssembly: {} }
    expect(probeEnvironment(stub).wasm).toBe(false)
  })
})

describe('the crypto probe is getRandomValues, never subtle', () => {
  it('passes on an insecure origin, where subtle is absent', () => {
    // The trap: `http://laptop.local:5173` is not a secure context, so
    // `crypto.subtle` is undefined there while `getRandomValues` works. The kernel
    // must never require `subtle` — its hashing is pure JS for exactly this reason.
    // A probe that checked for it would report every LAN visitor as blocked and
    // manufacture a cliff that does not exist.
    const insecure: ProbeGlobals = { ...complete, crypto: { getRandomValues: () => undefined } }
    expect('subtle' in (insecure.crypto as object)).toBe(false)
    expect(firstGap(probeEnvironment(insecure))).toBeNull()
  })
})

describe('a gap is reported before an error message is read', () => {
  it('prefers the missing capability over whatever was thrown', () => {
    // Otherwise the metric is string matching against error text from three
    // browsers, which drifts silently and is wrong precisely when a browser
    // changes its wording — the event this measurement exists to notice.
    expect(classifyStartError(new Error('something inscrutable'), environment({ wasm: false }))).toBe(
      'wasm-unavailable',
    )
  })

  it('reports the most fundamental gap when several are missing', () => {
    const nothing = environment({ wasm: false, webrtc: false, storage: false, crypto: false })
    expect(firstGap(nothing)).toBe('wasm-unavailable')
  })

  it('recognises the one error this page raises itself', () => {
    expect(classifyStartError(new Error('no relay available: …'), environment())).toBe(
      'no-relay-reachable',
    )
  })

  it('says other rather than inventing a cause', () => {
    // A report where `other` dominates is the finding that this needs another
    // case, which beats a case quietly mislabelled as something it is not.
    expect(classifyStartError(new Error('ICE failed'), environment())).toBe('other')
    expect(classifyStartError('a string, not an error', environment())).toBe('other')
  })
})
