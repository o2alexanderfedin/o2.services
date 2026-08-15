import { CID } from 'multiformats/cid'
import * as Digest from 'multiformats/hashes/digest'
import { sha256 } from '@o2/core'
import { kernelBytes } from '@o2/demo'
import { describe, expect, it } from 'vitest'
import {
  CACHE_CONFOUNDS,
  CODE_CACHE_BLIND_SPOTS,
  CODE_CACHE_E2E_HARNESS,
  CODE_CACHE_EVIDENCE,
  CODE_CACHE_HARNESSES,
  CODE_CACHE_HOT_LOADER_HARNESS,
  CODE_CACHE_HOT_PLATFORM_HARNESS,
  CODE_CACHE_MIN_BYTES,
  CODE_CACHE_READINGS,
  CODE_CACHE_ROWS,
  RAW_CODE,
  cacheVerdict,
  codeCacheHarnessFor,
  describeCacheVerdict,
  describeCodeCacheEvidence,
  describeLoadFailure,
  gatewayUrl,
  loadArtifact,
  measureRepeatLoad,
} from './streaming-load.ts'
import { ARTIFACT_SIZED, CHAINED_HOT, CODE_CACHE_SIZED, syntheticArtifact } from './synthetic-artifact.ts'

/**
 * AOT-05 — loading a translated artifact the way V8 can cache it.
 *
 * Browser-only, and not merely for convenience: `WebAssembly.compileStreaming`,
 * `Response.clone()` and the code-cache rules are all platform behaviour, so a Node
 * run of these would be testing a different engine's opinion of the same code.
 *
 * These tests establish the *loader*: that the URL it builds is a usable cache key,
 * that bytes from a gateway are verified against the CID before a module is handed
 * back, and that every refusal names a reason. They establish **nothing about
 * whether a code-cache hit actually occurs** — that needs two page loads in one
 * browser profile, and it lives in `packages/node/src/code-cache.e2e.test.ts`.
 * Read it before quoting anything from here.
 *
 * That file reported a negative until 2026-08-14 and now reports a hit. The negative
 * was not wrong about what it saw; it was wrong about what it was looking at. The
 * module it served exports one function that calls nothing and folds to a constant,
 * so almost none of it ever reached top tier, and V8 decides to cache on the volume
 * of top-tier code. The tests below that quote the table quote it as data for exactly
 * this reason — the prose in three docblocks had to be corrected, and the data did
 * not, because a row cannot claim a configuration no harness here drives.
 *
 * The CIDs and byte counts below are hardcoded literals, never recomputed from the
 * generator. An expectation derived from the code under test only proves the code
 * agrees with itself.
 */

/** sha-256, raw codec, CIDv1 — of `syntheticArtifact(CODE_CACHE_SIZED)`. */
const BIG_CID = 'bafkreidyqtlzpqxb73iz27f6i6cwey62sdoytxgmzfr6je4vlxupfqqjri'
const BIG_BYTES = 220_235

/** The demo kernel: valid, useful, and permanently too small to be cached. */
const KERNEL_CID = 'bafkreihyux7jlsrv4sbeyqucghtarabmugo322frpsc5h2ed4ezb3omm5m'
const KERNEL_BYTES = 1200
const KERNEL_SHA256 = 'f8a5fe95ca35e4824c428231e608802ca19dbd68b17c85d3e883e1321db98ceb'

const GATEWAY = 'https://gateway.example/ipfs/'
const BIG_URL = `https://gateway.example/ipfs/${BIG_CID}`

/** The exact bytes of a three-function module — the generator's conformance vector. */
const TINY_MODULE = [
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x05, 0x01, 0x60, 0x00, 0x01, 0x7f, 0x03,
  0x04, 0x03, 0x00, 0x00, 0x00, 0x07, 0x07, 0x01, 0x03, 0x72, 0x75, 0x6e, 0x00, 0x00, 0x0a, 0x22,
  0x03, 0x0a, 0x00, 0x41, 0x04, 0x41, 0x13, 0x71, 0x41, 0x16, 0x77, 0x0b, 0x0a, 0x00, 0x41, 0x3d,
  0x41, 0x38, 0x72, 0x41, 0x37, 0x73, 0x0b, 0x0a, 0x00, 0x41, 0x2a, 0x41, 0x01, 0x71, 0x41, 0x2c,
  0x72, 0x0b,
]

/**
 * The same three-function module in the chained shape — the second conformance vector.
 *
 * Readable against the first: a global section (`0x06`) appears before the exports,
 * every body opens `0x23 0x00` (`global.get 0`) instead of an `i32.const`, and function
 * 0 is now `call 1; add; call 2; add; local.tee; global.get; add; global.set; local.get`
 * rather than arithmetic of its own.
 */
const TINY_CHAINED = [
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x05, 0x01, 0x60, 0x00, 0x01, 0x7f, 0x03,
  0x04, 0x03, 0x00, 0x00, 0x00, 0x06, 0x06, 0x01, 0x7f, 0x01, 0x41, 0x01, 0x0b, 0x07, 0x07, 0x01,
  0x03, 0x72, 0x75, 0x6e, 0x00, 0x00, 0x0a, 0x2d, 0x03, 0x15, 0x01, 0x01, 0x7f, 0x41, 0x00, 0x10,
  0x01, 0x6a, 0x10, 0x02, 0x6a, 0x22, 0x00, 0x23, 0x00, 0x6a, 0x24, 0x00, 0x20, 0x00, 0x0b, 0x0a,
  0x00, 0x23, 0x00, 0x41, 0x05, 0x6a, 0x41, 0x0d, 0x77, 0x0b, 0x0a, 0x00, 0x23, 0x00, 0x41, 0x17,
  0x6a, 0x41, 0x1f, 0x77, 0x0b,
]

const big = (): Uint8Array<ArrayBuffer> => syntheticArtifact(CODE_CACHE_SIZED)

function wasmResponse(bytes: Uint8Array<ArrayBuffer>): Response {
  return new Response(bytes, { headers: { 'content-type': 'application/wasm' } })
}

/** A stub gateway that counts its calls — a double fetch is a defect, not a detail. */
function stubGateway(answer: () => Response): { fetch: (url: string) => Promise<Response>; calls: string[] } {
  const calls: string[] = []
  return {
    calls,
    fetch: async (url: string) => {
      calls.push(url)
      return answer()
    },
  }
}

describe('AOT-05 — the gateway URL is the cache key, so it is built rather than assembled', () => {
  it('produces the path-gateway URL for a CID', () => {
    const result = gatewayUrl(GATEWAY, CID.parse(BIG_CID))
    expect(result.ok).toBe(true)
    // Hardcoded, not concatenated in the test: the string is the cache key, and a
    // test that builds it the same way the code does would accept any change to it.
    if (result.ok) expect(result.url).toBe('https://gateway.example/ipfs/bafkreidyqtlzpqxb73iz27f6i6cwey62sdoytxgmzfr6je4vlxupfqqjri')
  })

  it('refuses a base carrying a query string, which is exactly what defeats the cache silently', () => {
    const result = gatewayUrl('https://gateway.example/ipfs/?bust=1', CID.parse(BIG_CID))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.failure.defect).toBe('query-string')
      // The explanation has to say *why*, or the next person removes the check.
      expect(describeLoadFailure(result.failure)).toContain('code cache')
    }
  })

  it('refuses a base with no trailing slash, because URL resolution would eat /ipfs/', () => {
    const result = gatewayUrl('https://gateway.example/ipfs', CID.parse(BIG_CID))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.failure.defect).toBe('no-trailing-slash')
  })

  it('refuses a fragment, which is never sent to a server and cannot be part of a root', () => {
    const result = gatewayUrl('https://gateway.example/ipfs/#frag', CID.parse(BIG_CID))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.failure.defect).toBe('fragment')
  })

  it('refuses a base that is not a URL at all', () => {
    const result = gatewayUrl('not a url/', CID.parse(BIG_CID))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.failure.defect).toBe('not-a-url')
  })
})

describe('AOT-05 — the synthetic stand-in is reproducible, so its CID is a stable key', () => {
  it('emits byte-identical output for a given shape', () => {
    // If this drifts, every hardcoded CID in this file is stale — which is the
    // point of checking the bytes rather than only the length.
    expect([...syntheticArtifact({ functions: 3, opsPerFunction: 2 })]).toEqual(TINY_MODULE)
  })

  it('emits a module V8 validates and will run', () => {
    const bytes = syntheticArtifact({ functions: 3, opsPerFunction: 2 })
    expect(WebAssembly.validate(bytes)).toBe(true)
    const instance = new WebAssembly.Instance(new WebAssembly.Module(bytes), {})
    const run = instance.exports['run']
    expect(typeof run).toBe('function')
    // The value is incidental; that the call completes is what matters — a module
    // that trapped would throw here and the fixture would be useless for timing.
    if (typeof run === 'function') expect(run()).toBe(0)
  })

  it('clears the caching threshold at the shape the measurements use', () => {
    expect(big().length).toBe(BIG_BYTES)
    expect(BIG_BYTES).toBeGreaterThanOrEqual(CODE_CACHE_MIN_BYTES)
  })

  it('leaves the straight-line output byte-identical when the chained flag is absent', () => {
    // The additive guarantee, stated as a test rather than as an intention. Every
    // hardcoded CID in this file, and both straight-line arms in the e2e, are CIDs of
    // the output above; a generator change that touched them would invalidate the
    // control the refutation is measured against.
    expect([...syntheticArtifact({ functions: 3, opsPerFunction: 2, chained: false })]).toEqual(TINY_MODULE)
  })

  it('emits the chained shape byte-identically too, so its CID is a stable key as well', () => {
    // Same discipline as TINY_MODULE and for the same reason: the e2e addresses these
    // modules by CID, so a silent drift in the generator would change the URL and turn
    // a cache hit into a miss for a reason that has nothing to do with the cache.
    expect([...syntheticArtifact({ functions: 3, opsPerFunction: 2, chained: true })]).toEqual(TINY_CHAINED)
  })

  it('makes the chained shape depend on a value no optimiser can fold away', () => {
    // The property the whole refutation rests on. A body that folds to a constant is
    // a body that produces no top-tier code, and a module of those cannot be cached
    // however large it is — which is precisely what the published negative measured.
    //
    // Executed rather than inspected: `run` mutates the global it reads, so successive
    // calls must return different values. If they stop doing so, the arithmetic has
    // collapsed and the e2e is measuring the old fixture again under a new name.
    const bytes = syntheticArtifact({ functions: 40, opsPerFunction: 100, chained: true })
    expect(WebAssembly.validate(bytes)).toBe(true)
    const run = new WebAssembly.Instance(new WebAssembly.Module(bytes), {}).exports['run']
    expect(typeof run).toBe('function')
    if (typeof run !== 'function') return
    const seen = new Set([run(), run(), run(), run(), run()])
    expect(seen.size, 'chained bodies folded to a constant — the fixture is inert again').toBe(5)
  })
})

describe('AOT-05 — bytes from a gateway are verified against the CID before a module exists', () => {
  it('returns a compiled module when the bytes hash to the CID that was asked for', async () => {
    const bytes = big()
    const gateway = stubGateway(() => wasmResponse(bytes))
    const result = await loadArtifact({ gatewayBase: GATEWAY, cid: CID.parse(BIG_CID), fetch: gateway.fetch })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.artifact.url).toBe(BIG_URL)
    expect(result.artifact.bytes).toBe(BIG_BYTES)
    expect(WebAssembly.Module.exports(result.artifact.module).map((e) => e.name)).toEqual(['run'])
    expect(gateway.calls).toEqual([BIG_URL])
  })

  it('refuses bytes that do not hash to the CID even though they compile perfectly', async () => {
    // The kernel is genuine, valid WASM. Substituting it for the requested artifact
    // is precisely the attack content addressing exists to stop, and "it compiled"
    // must not be mistaken for "it is the right artifact".
    const gateway = stubGateway(() => wasmResponse(kernelBytes))
    const result = await loadArtifact({ gatewayBase: GATEWAY, cid: CID.parse(BIG_CID), fetch: gateway.fetch })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.kind).toBe('cid-mismatch')
    if (result.failure.kind === 'cid-mismatch') {
      expect(result.failure.expected).toBe(BIG_CID)
      expect(result.failure.receivedDigest).toBe(KERNEL_SHA256)
      expect(result.failure.bytes).toBe(KERNEL_BYTES)
    }
    // No module reaches the caller. There is no field it could arrive in.
    expect('artifact' in result).toBe(false)
  })

  it('fetches once, so the bytes that were verified are the bytes that were compiled', async () => {
    // Verifying one fetch and compiling another would let a gateway answer the two
    // requests differently. `Response.clone()` is what removes that gap; a single
    // recorded call is what proves the clone is being used rather than a re-fetch.
    let served = 0
    const bytes = big()
    const impostor = kernelBytes
    const result = await loadArtifact({
      gatewayBase: GATEWAY,
      cid: CID.parse(BIG_CID),
      fetch: async () => {
        served += 1
        return wasmResponse(served === 1 ? bytes : impostor)
      },
    })

    expect(served).toBe(1)
    expect(result.ok).toBe(true)
  })

  it('compiles through the streaming API, because compile() over an ArrayBuffer is never cached', async () => {
    // Condition 1 of four, and the one a well-meaning refactor removes: reading the
    // body to an ArrayBuffer first and calling WebAssembly.compile still works, still
    // passes every other test here, and silently costs the cache forever.
    const original = WebAssembly.compileStreaming
    let streamingCalls = 0
    const patched = async (source: Response | PromiseLike<Response>): Promise<WebAssembly.Module> => {
      streamingCalls += 1
      return original(source)
    }
    expect(Reflect.set(WebAssembly, 'compileStreaming', patched)).toBe(true)
    try {
      const gateway = stubGateway(() => wasmResponse(big()))
      const result = await loadArtifact({ gatewayBase: GATEWAY, cid: CID.parse(BIG_CID), fetch: gateway.fetch })
      expect(result.ok).toBe(true)
      expect(streamingCalls).toBe(1)
    } finally {
      Reflect.set(WebAssembly, 'compileStreaming', original)
    }
  })

  it('names a gateway error page as a content-type failure, not a compile failure', async () => {
    const gateway = stubGateway(
      () => new Response('<html>504 upstream</html>', { headers: { 'content-type': 'text/html' } }),
    )
    const result = await loadArtifact({ gatewayBase: GATEWAY, cid: CID.parse(BIG_CID), fetch: gateway.fetch })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.kind).toBe('wrong-content-type')
    if (result.failure.kind === 'wrong-content-type') expect(result.failure.contentType).toBe('text/html')
    // The wording has to point at the gateway, because that is the thing to change.
    expect(describeLoadFailure(result.failure)).toContain('gateway error page')
  })

  it('refuses a content type carrying parameters, and blames the header rather than the artifact', async () => {
    // Measured, not assumed. This test was first written the other way round — a
    // charset looks harmless — and Chromium rejected the response inside
    // compileStreaming, so the load surfaced as `compile-failed` and pointed at the
    // artifact when the gateway's header was at fault. The WebAssembly Web API spec
    // says "extra parameters are not allowed, including empty ones", so the check
    // here is exact and the diagnosis stays correct.
    const bytes = big()
    const gateway = stubGateway(
      () => new Response(bytes, { headers: { 'content-type': 'application/wasm; charset=utf-8' } }),
    )
    const result = await loadArtifact({ gatewayBase: GATEWAY, cid: CID.parse(BIG_CID), fetch: gateway.fetch })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.kind).toBe('wrong-content-type')
    if (result.failure.kind === 'wrong-content-type') {
      expect(result.failure.contentType).toBe('application/wasm; charset=utf-8')
    }
  })

  it('treats an absent content type as a content-type failure with an empty value', async () => {
    const gateway = stubGateway(() => new Response(big(), { headers: {} }))
    const result = await loadArtifact({ gatewayBase: GATEWAY, cid: CID.parse(BIG_CID), fetch: gateway.fetch })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.kind).toBe('wrong-content-type')
    // A Response built with no content-type still gets one from the Blob path in
    // some engines; whatever it is, it is not application/wasm and is named as such.
    expect(describeLoadFailure(result.failure)).toContain('application/wasm')
  })

  it('reports the status when a gateway does not hold the artifact', async () => {
    const gateway = stubGateway(() => new Response('not found', { status: 404 }))
    const result = await loadArtifact({ gatewayBase: GATEWAY, cid: CID.parse(BIG_CID), fetch: gateway.fetch })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.kind).toBe('bad-status')
    if (result.failure.kind === 'bad-status') expect(result.failure.status).toBe(404)
    // A 404 means "ask elsewhere"; the message says so rather than looking fatal.
    expect(describeLoadFailure(result.failure)).toContain('another gateway')
  })

  it('turns a thrown fetch into a named failure rather than propagating it', async () => {
    const result = await loadArtifact({
      gatewayBase: GATEWAY,
      cid: CID.parse(BIG_CID),
      fetch: async () => {
        throw new TypeError('Failed to fetch')
      },
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.kind).toBe('fetch-failed')
    if (result.failure.kind === 'fetch-failed') expect(result.failure.message).toBe('Failed to fetch')
  })

  it('reports a compile failure only when the bytes are addressed correctly and still are not WASM', async () => {
    // Four bytes that hash to their own CID: verification passes, so the failure
    // that surfaces is the real one rather than a mismatch masking it.
    const junk = new Uint8Array([0x01, 0x02, 0x03, 0x04])
    const cid = CID.create(1, RAW_CODE, await sha256.digest(junk))
    const gateway = stubGateway(() => wasmResponse(junk))
    const result = await loadArtifact({ gatewayBase: GATEWAY, cid, fetch: gateway.fetch })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.kind).toBe('compile-failed')
  })
})

describe('AOT-05 — a CID this loader cannot check is refused, never skipped', () => {
  it('refuses a non-sha2-256 multihash without fetching anything', async () => {
    // The dangerous shape: a digest that cannot be recomputed. Verifying nothing and
    // returning the module anyway would quietly downgrade content addressing to
    // "whatever that URL served". Refusing before the fetch also means the bytes are
    // never pulled, because there would be nothing to do with them.
    const sha512 = Digest.create(0x13, new Uint8Array(64))
    const gateway = stubGateway(() => wasmResponse(big()))
    const result = await loadArtifact({
      gatewayBase: GATEWAY,
      cid: CID.create(1, RAW_CODE, sha512),
      fetch: gateway.fetch,
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.kind).toBe('unsupported-cid')
    if (result.failure.kind === 'unsupported-cid') {
      expect(result.failure.defect).toBe('hash-not-sha256')
      expect(result.failure.code).toBe(0x13)
    }
    expect(gateway.calls).toEqual([])
  })

  it('refuses a dag-pb CID as uncheckable rather than reporting a mismatch against an honest gateway', async () => {
    // A UnixFS root names a DAG. A gateway returns the reassembled file, whose
    // sha-256 is not the root's — so calling that a mismatch would accuse a correct
    // gateway of substituting bytes.
    const dagPb = CID.create(1, 0x70, await sha256.digest(big()))
    const gateway = stubGateway(() => wasmResponse(big()))
    const result = await loadArtifact({ gatewayBase: GATEWAY, cid: dagPb, fetch: gateway.fetch })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.kind).toBe('unsupported-cid')
    if (result.failure.kind === 'unsupported-cid') {
      expect(result.failure.defect).toBe('codec-addresses-a-dag')
      expect(result.failure.code).toBe(0x70)
    }
    expect(gateway.calls).toEqual([])
  })

  it('accepts the dag-cbor CID this repository’s own blockCid produces', async () => {
    const bytes = big()
    const cid = CID.create(1, 0x71, await sha256.digest(bytes))
    const gateway = stubGateway(() => wasmResponse(bytes))
    const result = await loadArtifact({ gatewayBase: GATEWAY, cid, fetch: gateway.fetch })
    expect(result.ok).toBe(true)
  })
})

describe('AOT-05 — cache eligibility is reported, because the demo kernel can never be cached', () => {
  it('marks the 1.2 KB demo kernel ineligible', async () => {
    const gateway = stubGateway(() => wasmResponse(kernelBytes))
    const result = await loadArtifact({ gatewayBase: GATEWAY, cid: CID.parse(KERNEL_CID), fetch: gateway.fetch })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.artifact.bytes).toBe(KERNEL_BYTES)
    // A test written against the kernel would measure nothing while passing. This
    // flag is what makes that visible instead of silent.
    expect(result.artifact.cacheEligible).toBe(false)
  })

  it('marks the 220 KB artifact eligible', async () => {
    const gateway = stubGateway(() => wasmResponse(big()))
    const result = await loadArtifact({ gatewayBase: GATEWAY, cid: CID.parse(BIG_CID), fetch: gateway.fetch })

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.artifact.cacheEligible).toBe(true)
  })
})

describe('AOT-05 — what a repeat load inside one page can and cannot establish', () => {
  it('reports a ratio and refuses to call it a cache hit', async () => {
    const bytes = big()
    const measurement = await measureRepeatLoad({
      gatewayBase: GATEWAY,
      cid: CID.parse(BIG_CID),
      fetch: async () => wasmResponse(bytes),
    })

    expect(measurement.ok).toBe(true)
    if (!measurement.ok) return
    expect(measurement.pair.bytes).toBe(BIG_BYTES)
    expect(measurement.pair.firstMs).toBeGreaterThan(0)
    expect(measurement.pair.secondMs).toBeGreaterThan(0)
    // There is no `hit` verdict to return. That is a property of the type, not of
    // this run being unlucky.
    expect(measurement.verdict.kind).toBe('inconclusive')
    if (measurement.verdict.kind === 'inconclusive') {
      expect(measurement.verdict.confounds).toEqual(CACHE_CONFOUNDS)
      expect(measurement.verdict.confounds.length).toBeGreaterThan(0)
    }

    // The caveats live inside the rendered string, so they survive being quoted —
    // the rule `describeStartReport` and `@o2/bench`'s report already follow.
    const rendered = describeCacheVerdict(measurement.verdict)
    expect(rendered).toContain('does NOT establish')
    expect(rendered).toContain('HTTP cache')

    // Reported, never asserted: a threshold here would be a claim with no evidence
    // behind it. See code-cache.e2e.test.ts for what was actually observed.
    // eslint-disable-next-line no-console -- the measurement is the deliverable
    console.log(
      `AOT-05 in-page repeat load: ${measurement.pair.bytes} bytes, ` +
        `${measurement.pair.firstMs.toFixed(2)}ms then ${measurement.pair.secondMs.toFixed(2)}ms\n` +
        describeCacheVerdict(measurement.verdict),
    )
  })

  it('says plainly that a module under the threshold cannot be cached at all', () => {
    const verdict = cacheVerdict({ url: BIG_URL, bytes: KERNEL_BYTES, firstMs: 4, secondMs: 1 })
    expect(verdict.kind).toBe('ineligible')
    // No ratio is offered for an ineligible module: 4× faster would look like a hit
    // and cannot be one.
    expect(describeCacheVerdict(verdict)).toContain('can never be code-cached')
  })

  it('propagates which of the two loads failed rather than collapsing them', async () => {
    let calls = 0
    const bytes = big()
    const measurement = await measureRepeatLoad({
      gatewayBase: GATEWAY,
      cid: CID.parse(BIG_CID),
      fetch: async () => {
        calls += 1
        return calls === 1 ? wasmResponse(bytes) : new Response('gone', { status: 410 })
      },
    })

    expect(measurement.ok).toBe(false)
    if (measurement.ok) return
    expect(measurement.on).toBe('second')
    expect(measurement.failure.kind).toBe('bad-status')
  })
})

/**
 * The published negative result must distinguish a measured zero from a remembered one.
 *
 * The table once presented four configurations as observed while one harness existed,
 * so a reader had no way to tell which rows this repository could still produce. These
 * tests pin the repair: the measured side is exactly what a harness here drives, the
 * unmeasured side is named rather than dropped, and the two together account for every
 * row that was ever claimed.
 */
describe('AOT-05 — the code-cache table separates what this tree measures from what it does not', () => {
  it('accounts for every declared row exactly once, as either a reading or a blind spot', () => {
    // A row that leaves both lists disappears silently, and a vanished row is
    // indistinguishable from one removed because it was inconvenient. The declared
    // total is what makes that impossible.
    const accounted = [
      ...CODE_CACHE_EVIDENCE.readings.map((reading) => reading.row),
      ...CODE_CACHE_EVIDENCE.blindSpots.map((spot) => spot.row),
    ].sort()
    expect(accounted).toEqual([...CODE_CACHE_ROWS].sort())
    expect(new Set(accounted).size).toBe(accounted.length)
  })

  it('names a harness in this tree, at that exact configuration, for every row it calls measured', () => {
    // The invariant the whole repair rests on. Citing a harness that exists but drives
    // a *different* configuration is the subtle version of the original defect: it
    // promotes a claim to "measured" by association with a run that did not measure it.
    expect(CODE_CACHE_READINGS.length).toBeGreaterThan(0)
    for (const reading of CODE_CACHE_READINGS) {
      expect(
        CODE_CACHE_HARNESSES.some((harness) => harness.file === reading.harness),
        `${reading.row} cites ${reading.harness}, which is not a harness in this tree`,
      ).toBe(true)
      expect(
        codeCacheHarnessFor(reading),
        `${reading.row}: no harness here drives ${reading.configuration.moduleBytes} B over ` +
          `${reading.configuration.visits} visits (${reading.configuration.display}` +
          `${reading.configuration.browserRestart ? ', restart' : ''})`,
      ).not.toBeNull()
    }
  })

  it('recomputes the module size of every measured row instead of quoting it', () => {
    for (const reading of CODE_CACHE_READINGS) {
      const harness = codeCacheHarnessFor(reading)
      expect(harness).not.toBeNull()
      if (harness === null) continue
      // Generated here, now, from the same shapes the harness serves. If the generator
      // or the shape drifts, the published figure is stale and this fails — which is
      // the difference between a number produced by this tree and a number written in it.
      const armBytes = harness.arms.map((shape) => syntheticArtifact(shape).length)
      expect(armBytes).toContain(reading.configuration.moduleBytes)
      // Every arm must clear the caching threshold, or the harness measured a module V8
      // would never have cached anyway — the trap the 1.2 KB demo kernel sets.
      for (const bytes of armBytes) expect(bytes).toBeGreaterThanOrEqual(CODE_CACHE_MIN_BYTES)
    }
  })

  it('drives the shape `ARTIFACT_SIZED` names, so the fixture and the harness cannot drift apart', () => {
    expect(CODE_CACHE_E2E_HARNESS.arms[0]).toEqual(ARTIFACT_SIZED)
    // Two arms, and distinct: identical bytes would be one CID, hence one URL, and the
    // loader arm would be reading whatever the platform arm left behind.
    expect(CODE_CACHE_E2E_HARNESS.arms.length).toBe(2)
    expect(new Set(CODE_CACHE_E2E_HARNESS.arms.map((shape) => shape.functions)).size).toBe(2)
  })

  it('gives every unmeasured row a verbatim claim, a reason, and what closing it would take', () => {
    // Never empty: the four preconditions were only ever shown necessary, so there is
    // no state of this repository in which nothing about the cache is unknown.
    expect(CODE_CACHE_BLIND_SPOTS.length).toBeGreaterThan(0)
    for (const spot of CODE_CACHE_BLIND_SPOTS) {
      expect(spot.claim.length, `${spot.row} lost the claim it is standing in for`).toBeGreaterThan(0)
      expect(spot.note.length, `${spot.row} has no reason`).toBeGreaterThan(0)
      // A gap with no stated cost is indistinguishable from one nobody intends to close.
      expect(spot.wouldNeed.length, `${spot.row} says nothing about closing it`).toBeGreaterThan(0)
    }
  })

  it('keeps the refuted negative as the control it turned out to be, rather than deleting it', () => {
    // ## This assertion used to pin the negative, and its reasoning is now inverted
    //
    // It read `expect(measured.wasmCacheBytes).toBeLessThan(4096)` under the heading
    // "keeps the negative result rather than trimming the table down to nothing", and
    // it was right to exist: an over-claimed negative is repaired by splitting it,
    // never by deleting it, and a row that quietly vanishes is indistinguishable from
    // one removed because it was inconvenient.
    //
    // The negative has since been **refuted** — see `622kb-chained-2-visits-platform`.
    // The straight-line module could not reach `--wasm-caching-threshold` however it
    // was served, because its only export folds to a constant, so its zero was a fact
    // about the fixture. Deleting this row on that news would look exactly like the
    // trimming the original assertion existed to prevent, so the row stays and the
    // assertion changes meaning: the zero is still required, and it is now required
    // *as the contrast* that makes the positive rows evidence. If the straight-line
    // row ever starts reporting a hit, the two chained rows lose their control and
    // this must fail.
    const measured = CODE_CACHE_READINGS.find((reading) => reading.row === '4.8mb-3-visits')
    expect(measured).toBeDefined()
    if (measured === undefined) return
    expect(measured.wasmCacheBytes).toBeLessThan(4096)
    // Its own calibration is unchanged: a zero still needs a positive control.
    expect(measured.control.kind).toBe('js-code-cache-floor')
    if (measured.control.kind === 'js-code-cache-floor') {
      expect(measured.control.floorBytes).toBeGreaterThan(measured.wasmCacheBytes)
    }
    // The disabled-cache calibration is what gives that figure its meaning, and it is
    // named as uncommitted rather than quoted as if it were.
    expect(CODE_CACHE_BLIND_SPOTS.some((spot) => spot.kind === 'control-not-committed')).toBe(true)
  })

  it('carries the refutation as a measured row, not as a correction in prose', () => {
    // The whole reason the table is data. The negative was stated in three docblocks
    // and one table before it was refuted; had the refutation been written the same
    // way, the next reader would have had four claims and no way to tell which the
    // tree still produces.
    const platform = CODE_CACHE_READINGS.find((r) => r.row === '622kb-chained-2-visits-platform')
    const loader = CODE_CACHE_READINGS.find((r) => r.row === '622kb-chained-2-visits-loader')
    expect(platform).toBeDefined()
    expect(loader).toBeDefined()
    if (platform === undefined || loader === undefined) return

    for (const reading of [platform, loader]) {
      // A positive figure, well clear of the 72-byte index-only floor.
      expect(reading.wasmCacheBytes).toBeGreaterThan(4096)
      // ...calibrated in the direction a positive figure needs: something in the same
      // run that stayed at zero. A JS floor would say nothing about whether *this*
      // number is an artefact of the apparatus.
      const control = reading.control
      expect(control.kind).toBe('contrasting-row')
      if (control.kind === 'contrasting-row') {
        // The contrast must be a row this tree measures, or it is a rhetorical one.
        const against = CODE_CACHE_READINGS.find((r) => r.row === control.against)
        expect(against, `${reading.row} contrasts against an unmeasured row`).toBeDefined()
        expect(against?.wasmCacheBytes).toBeLessThan(4096)
      }
      // And a harness here at exactly this configuration — the invariant every row obeys.
      expect(codeCacheHarnessFor(reading), `${reading.row} has no harness`).not.toBeNull()
    }

    // The two are distinct modules in distinct profiles: one CID, one URL, one cache
    // entry, so sharing bytes would make the second row a reading of the first.
    expect(platform.configuration.moduleBytes).not.toBe(loader.configuration.moduleBytes)
  })

  it('drives a chained shape, because a straight-line one cannot tier up whatever its size', () => {
    // The fifth precondition, pinned where it can be checked. `CHAINED_HOT` is the only
    // shape in this tree that produces a cache entry, and the property that makes it
    // one is `chained` — not its size, which is a seventh of `ARTIFACT_SIZED`'s.
    expect(CODE_CACHE_HOT_PLATFORM_HARNESS.arms[0]).toEqual(CHAINED_HOT)
    expect(CHAINED_HOT.chained).toBe(true)
    for (const harness of [CODE_CACHE_HOT_PLATFORM_HARNESS, CODE_CACHE_HOT_LOADER_HARNESS]) {
      for (const shape of harness.arms) expect(shape.chained).toBe(true)
    }
    // The straight-line harness is left alone: it is the control now, and a control
    // that quietly acquires the property under test stops being one.
    for (const shape of CODE_CACHE_E2E_HARNESS.arms) expect(shape.chained).not.toBe(true)
    // Smaller, and it caches while the larger one does not — which is the whole point.
    expect(syntheticArtifact(CHAINED_HOT).length).toBeLessThan(syntheticArtifact(ARTIFACT_SIZED).length)
  })

  it('renders the unmeasured rows into the same string as the measured one', () => {
    // The rule `describeStartReport` follows: a qualification parked beside a number is
    // separated from it the first time somebody quotes the number.
    const rendered = describeCodeCacheEvidence(CODE_CACHE_EVIDENCE)
    for (const reading of CODE_CACHE_READINGS) {
      expect(rendered).toContain(reading.harness)
      expect(rendered).toContain(`Code Cache/wasm ${reading.wasmCacheBytes} B`)
    }
    for (const spot of CODE_CACHE_BLIND_SPOTS) {
      expect(rendered).toContain(spot.claim)
      expect(rendered).toContain(spot.wouldNeed)
    }
    expect(rendered).toContain('not measured here')
  })
})
