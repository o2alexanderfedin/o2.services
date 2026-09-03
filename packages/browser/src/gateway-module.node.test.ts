import { KERNEL_RECORD, PI_RECORD, kernelBytes, piKernelBytes } from '@o2/demo'
import { describe, expect, it } from 'vitest'
import { grantConsent, memoryConsentStore } from './consent.ts'
import type { GrantedConsent } from './consent.ts'
import { describeFetch, fetchModuleForDispatch } from './gateway-module.ts'
import type { FetchLike } from './streaming-load.ts'

/**
 * AOT-05's last mile, exercised with **no DOM, no page and no network** — the wiring proof.
 *
 * ## What this file is for, and what it is not
 *
 * It is not a second copy of `streaming-load.browser.test.ts`, which owns the loader's own
 * behaviour. It exists because `loadArtifact` spent its whole life with **no production
 * consumer**: the barrel exported it, two specs drove it, and no page ever called it.
 * `reachability-guard.node.test.ts` carried that as an open finding in its own words —
 * *"Nobody has wired a gateway fetch into a page and nobody has decided to."* This file
 * covers the thing that decides, `fetchModuleForDispatch`, which `demo/main.ts#fetchModule`
 * calls and `#fetch-byo` presses.
 *
 * ## Why it runs in the `node` project
 *
 * For `colouring-surface.node.test.ts`'s reason, applied to a decision module rather than a
 * formatter: `document` and `window` do not exist here, so a fetch path that reached for
 * either would stop loading rather than pass. And `fetch` is injected, so every case below
 * says exactly what a gateway answered — including the answers a real gateway gives rarely
 * and a hostile one gives on purpose.
 *
 * Nothing is stubbed *below* the injection point. `WebAssembly.compileStreaming` is the
 * platform's, the digest is `@o2/core`'s over real bytes, and the artifacts are the two
 * kernels this repository actually ships. The one thing a fake `fetch` buys is the ability
 * to hand the loader **the wrong bytes**, which is the case that matters most and which no
 * honest gateway would ever produce.
 *
 * ## The counter is part of the assertion, not instrumentation
 *
 * Two refusals below are supposed to happen *before* anything is pulled — a blank gateway
 * field, and a record that vouches for a different artifact. "Refused" and "refused without
 * fetching" are different claims, and only the second one says the check is where it is
 * supposed to be. So every case counts calls and the early ones assert zero.
 */

/** A gateway root shaped the way `gatewayUrl` requires: trailing slash, no query, no fragment. */
const GATEWAY = 'https://gateway.invalid/ipfs/'

const MODULE_CID = KERNEL_RECORD.cid.toString()
const OTHER_CID = PI_RECORD.cid.toString()

/**
 * A real granted consent — BROW-06.
 *
 * Minted the way a visitor's is, through `grantConsent` over a store, because there is no
 * other way to obtain one and this file is not entitled to a shortcut the page does not
 * have. `built-bundle.e2e.test.ts` states the same rule for the harness that clicks the
 * button: *"There is no test-only bypass: the API refuses for the same reason the button is
 * not there yet."*
 */
const CONSENTED: GrantedConsent = grantConsent(memoryConsentStore(), { anchoredTo: 'test-anchors' })

interface Gateway {
  readonly fetch: FetchLike
  /** Requests actually issued. Asserted, never merely printed. */
  readonly urls: string[]
}

/** A gateway that answers every request with `bytes` under `contentType`. */
function serving(bytes: Uint8Array, contentType = 'application/wasm', status = 200): Gateway {
  const urls: string[] = []
  return {
    urls,
    fetch: async (url: string) => {
      urls.push(url)
      // A fresh copy per request: `Response` consumes its body, and a shared buffer would make
      // the second case in a file silently see an empty artifact.
      return new Response(status === 200 ? new Uint8Array(bytes) : null, {
        status,
        headers: status === 200 ? { 'content-type': contentType } : {},
      })
    },
  }
}

describe('fetchModuleForDispatch — the production consumer of loadArtifact', () => {
  it('fetches, verifies against the CID, compiles, and hands back the bytes', async () => {
    const gateway = serving(kernelBytes)
    const outcome = await fetchModuleForDispatch({
      consent: CONSENTED,
      gatewayBase: GATEWAY,
      moduleCid: MODULE_CID,
      recordCid: MODULE_CID,
      recordName: KERNEL_RECORD.name,
      fetch: gateway.fetch,
    })

    expect(outcome.ok, outcome.ok ? '' : outcome.reason).toBe(true)
    if (!outcome.ok) return
    // The URL is the CID under the base, with nothing appended — it is also V8's cache key,
    // and a query parameter here would silently make every visit a miss.
    expect(gateway.urls).toEqual([`${GATEWAY}${MODULE_CID}`])
    expect(outcome.cid).toBe(MODULE_CID)
    expect(outcome.bytes).toBe(kernelBytes.length)
    // The bytes themselves, not a length that agrees. This is the field the page puts in its
    // blockstore, and a loader that returned the *right count of the wrong bytes* would pass
    // every other assertion in this case.
    expect([...outcome.content]).toEqual([...kernelBytes])
    // The demo kernel is about 1.2 KB. Reported rather than asserted true: what is asserted
    // is that the page is told, so nobody reads a fast second visit as a cache hit.
    expect(outcome.cacheEligible).toBe(false)
    expect(outcome.compileMs).toBeGreaterThanOrEqual(0)
  })

  it('refuses bytes that do not hash to the CID, and returns no content at all', async () => {
    // A real, valid, compilable WebAssembly module — the *other* kernel this bundle ships.
    // Deliberately not garbage: garbage would fail to compile and the refusal would be about
    // the module rather than about the substitution, which is the swap this case is for.
    const gateway = serving(piKernelBytes)
    const outcome = await fetchModuleForDispatch({
      consent: CONSENTED,
      gatewayBase: GATEWAY,
      moduleCid: MODULE_CID,
      recordCid: MODULE_CID,
      recordName: KERNEL_RECORD.name,
      fetch: gateway.fetch,
    })

    expect(gateway.urls.length).toBe(1)
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.reason).toContain(MODULE_CID)
    expect(outcome.reason).toContain('was requested but')
    expect(outcome.reason).toContain('the artifact was not stored, returned, or run')
    // The refusal is an object with no `content` key, not an object whose `content` is empty.
    expect(Object.hasOwn(outcome, 'content')).toBe(false)
  })

  it('asks no gateway anything when there is no consent, and names consent as the reason', async () => {
    // BROW-06 at the unit level. The e2e half — `packages/node/src/artifact-fetch-gate.e2e.test.ts`
    // — reads the same property from *outside* a real page, at a real server's own log, which
    // is what the criterion asks for; this case is the one that can enumerate all four gap
    // kinds, which the page cannot be driven into cheaply.
    for (const gap of [
      { kind: 'never-asked' } as const,
      { kind: 'unreadable', detail: 'storage is denied' } as const,
      { kind: 'terms-changed', answered: '1', current: '2' } as const,
      { kind: 'anchor-changed', answered: 'aa', current: 'bb' } as const,
    ]) {
      const gateway = serving(kernelBytes)
      const outcome = await fetchModuleForDispatch({
        consent: gap,
        gatewayBase: GATEWAY,
        moduleCid: MODULE_CID,
        recordCid: MODULE_CID,
        recordName: KERNEL_RECORD.name,
        fetch: gateway.fetch,
      })

      // The whole requirement, in one line: not "it did not run" but "it did not ask".
      expect(gateway.urls, `a ${gap.kind} gap still pulled bytes`).toEqual([])
      expect(outcome.ok).toBe(false)
      if (outcome.ok) return
      expect(outcome.reason).toContain('before you have agreed')
      expect(outcome.reason).toContain('nothing left this device')
    }
  })

  it('refuses an absent consent ahead of a blank gateway field, so the sentence is about consent', async () => {
    // Ordering, asserted rather than assumed. Both refusals apply to this call; which one
    // arrives is the difference between telling a visitor who has agreed to nothing that
    // their gateway field is empty, and telling them why nothing was asked of anybody.
    const gateway = serving(kernelBytes)
    const outcome = await fetchModuleForDispatch({
      consent: { kind: 'never-asked' },
      gatewayBase: '   ',
      moduleCid: 'not-a-cid',
      recordCid: OTHER_CID,
      recordName: KERNEL_RECORD.name,
      fetch: gateway.fetch,
    })

    expect(gateway.urls).toEqual([])
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.reason).toContain('before you have agreed')
    expect(outcome.reason).not.toContain('No gateway was given')
    expect(outcome.reason).not.toContain('is not a CID')
  })

  it('refuses a record that vouches for a different artifact — before pulling anything', async () => {
    const gateway = serving(kernelBytes)
    const outcome = await fetchModuleForDispatch({
      consent: CONSENTED,
      gatewayBase: GATEWAY,
      moduleCid: MODULE_CID,
      recordCid: OTHER_CID,
      recordName: PI_RECORD.name,
      fetch: gateway.fetch,
    })

    // The whole point: bytes that could not be dispatched even if they arrived intact are not
    // pulled. `guardModuleProvenance` would refuse this dispatch at the executor; refusing it
    // here is what turns a wait into a sentence.
    expect(gateway.urls).toEqual([])
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.reason).toContain('the record is for a different artifact')
    expect(outcome.reason).toContain(OTHER_CID)
    expect(outcome.reason).toContain(MODULE_CID)
  })

  it('refuses an empty gateway root without blaming the CID, and pulls nothing', async () => {
    const gateway = serving(kernelBytes)
    const outcome = await fetchModuleForDispatch({
      consent: CONSENTED,
      gatewayBase: '   ',
      moduleCid: MODULE_CID,
      recordCid: MODULE_CID,
      recordName: KERNEL_RECORD.name,
      fetch: gateway.fetch,
    })

    expect(gateway.urls).toEqual([])
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.reason).toContain('No gateway was given')
    // The failure the blank field must NOT be reported as.
    expect(outcome.reason).not.toContain('is not a URL')
  })

  it('names a gateway root that carries a query string rather than building an uncacheable URL', async () => {
    const gateway = serving(kernelBytes)
    const outcome = await fetchModuleForDispatch({
      consent: CONSENTED,
      gatewayBase: 'https://gateway.invalid/ipfs/?bust=1',
      moduleCid: MODULE_CID,
      recordCid: MODULE_CID,
      recordName: KERNEL_RECORD.name,
      fetch: gateway.fetch,
    })

    expect(gateway.urls).toEqual([])
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.reason).toContain('carries a query string')
  })

  it('tells a gateway error page apart from a bad artifact', async () => {
    const gateway = serving(kernelBytes, 'text/html')
    const outcome = await fetchModuleForDispatch({
      consent: CONSENTED,
      gatewayBase: GATEWAY,
      moduleCid: MODULE_CID,
      recordCid: MODULE_CID,
      recordName: KERNEL_RECORD.name,
      fetch: gateway.fetch,
    })

    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.reason).toContain('not application/wasm')
    expect(outcome.reason).toContain('gateway error page')
  })

  it('refuses a CID that is not a CID rather than asking a gateway for it', async () => {
    const gateway = serving(kernelBytes)
    const outcome = await fetchModuleForDispatch({
      consent: CONSENTED,
      gatewayBase: GATEWAY,
      moduleCid: 'not-a-cid',
      recordCid: 'not-a-cid',
      recordName: KERNEL_RECORD.name,
      fetch: gateway.fetch,
    })

    expect(gateway.urls).toEqual([])
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.reason).toContain('is not a CID')
  })
})

describe('describeFetch — the sentence the page shows', () => {
  it('says what was fetched and, in the same breath, what has not been established', async () => {
    const outcome = await fetchModuleForDispatch({
      consent: CONSENTED,
      gatewayBase: GATEWAY,
      moduleCid: MODULE_CID,
      recordCid: MODULE_CID,
      recordName: KERNEL_RECORD.name,
      fetch: serving(kernelBytes).fetch,
    })
    const text = describeFetch(outcome.ok ? outcome : { ok: false, reason: 'unreachable' })

    expect(text).toContain(MODULE_CID)
    expect(text).toContain(`${GATEWAY}${MODULE_CID}`)
    expect(text).toContain(String(kernelBytes.length))
    // The half that keeps this honest. A visitor who has just read "verified" is one step from
    // concluding the module is cleared to run, and it is not — the signature is checked by
    // every executor the shard reaches, and that has not happened yet.
    expect(text).toContain('Verified is not cleared to run')
    expect(text).toContain('pinned anchors')
    // Below V8's threshold, and the page says so rather than letting a reader assume caching.
    expect(text).toContain('can never be code-cached')
  })

  it('renders a refusal verbatim, with nothing added but the fact that nothing was fetched', () => {
    const text = describeFetch({ ok: false, reason: 'the gateway answered 502.' })
    expect(text).toBe('Nothing was fetched: the gateway answered 502.')
  })
})
