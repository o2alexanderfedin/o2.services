/**
 * Fetching a translated artifact so that V8's code cache *can* apply — AOT-05.
 *
 * Loading a `.wasm` is trivial. Loading it in the one shape V8 is willing to cache
 * is not, because every way of losing the cache is silent — the module still
 * compiles, the job still runs, and the only symptom is that every visit pays full
 * compile cost forever. There are four conditions, and this loader is built around
 * all four:
 *
 * 1. **`WebAssembly.compileStreaming`, over a `Response`.** `compile()` on an
 *    `ArrayBuffer` is never cached: there is no resource for the cache to be keyed
 *    on. This is the condition most easily lost by refactoring, because
 *    `await response.arrayBuffer()` then `WebAssembly.compile(bytes)` is the obvious
 *    way to write "fetch and verify, then compile" and it destroys the cache.
 * 2. **`Content-Type: application/wasm`.** Required by the streaming API itself,
 *    and checked here first anyway — see below.
 * 3. **A stable resource URL.** The cache key *is* the URL. A content-addressed
 *    gateway URL over a CID is a perfect immutable key; a cache-busting query
 *    parameter turns that key into a fresh miss on every visit. {@link gatewayUrl}
 *    refuses a base that carries one rather than building a URL that quietly never
 *    caches.
 * 4. **Roughly 128 KB or larger.** Below that V8 does not bother. The demo kernel is
 *    about 1.2 KB, so it can never be cached whatever else is correct — which is why
 *    every result carries {@link LoadedArtifact.cacheEligible} rather than leaving a
 *    caller to assume.
 *
 * ## The bytes are untrusted, and must be checked against the CID
 *
 * A gateway is not a peer this node enrolled; it is an HTTP server anyone can
 * operate. `FetchingBlockstore` in `@o2/net` already establishes the rule for
 * blocks pulled over the wire — verify against the CID that was asked for, count
 * the rejections — and an artifact fetched over HTTP is the same situation with a
 * larger blast radius, because the payload is *code*.
 *
 * ## Verification versus streaming: why `clone()`
 *
 * `compileStreaming` consumes the response body, so the bytes cannot also be hashed
 * from the same stream. Three options existed:
 *
 * - **Read to an `ArrayBuffer`, hash, then `WebAssembly.compile`.** Correct, and it
 *   throws away the entire point of this module (condition 1).
 * - **Fetch twice** — once to hash, once to compile. Cheap to write and wrong: the
 *   two requests can return different bytes, so the artifact that was verified is
 *   not necessarily the artifact that was compiled. A gateway wanting to slip code
 *   past this would only have to answer the second request differently.
 * - **`Response.clone()`**, which tees the body into two independent streams with
 *   the headers copied. One branch feeds `compileStreaming`, the other is hashed.
 *   Same bytes, by construction, and the streaming path is intact.
 *
 * The third, with one obligation: the two branches must be consumed
 * **concurrently**. A clone whose reader is started only after `compileStreaming`
 * resolves makes the browser queue the whole artifact in memory waiting for it.
 * Both are therefore started before either is awaited.
 *
 * `response.body.tee()` would do the same thing by hand, and would additionally
 * require rebuilding a `Response` around one branch with its `Content-Type` copied
 * across — a step that, forgotten, fails the compile for a reason that has nothing
 * to do with the artifact. `clone()` has no such step.
 *
 * ## Compiling before verifying is safe; *returning* before verifying is not
 *
 * Compilation runs concurrently with the hash, so an artifact that fails
 * verification has already been compiled by the time it is rejected. That is fine:
 * `WebAssembly.Module` is inert. Execution needs `WebAssembly.instantiate`, and an
 * instantiation is only reachable through a module this function returned — which
 * it does not do unless the digest matched.
 *
 * ## Why the content type is checked here, when the platform checks it too
 *
 * `compileStreaming` rejects a wrong content type with an engine-worded `TypeError`
 * indistinguishable from a corrupt module. The distinction matters operationally: a
 * gateway answering `text/html` is serving an error page and the right move is to
 * try another gateway, whereas a genuine compile failure means the artifact itself
 * is wrong and no gateway will help.
 *
 * ## What was measured, and what was not
 *
 * The four conditions are necessary. **There is a fifth**, and missing it is what
 * produced the negative this comment used to carry.
 *
 * V8 decides to cache on the volume of *top-tier* code a module has produced —
 * `--wasm-caching-threshold=1000`, with `--wasm-caching-timeout-ms=2000` and
 * `--wasm-caching-hard-threshold=1000000`. Bytes of machine code, not bytes of module.
 * A function only reaches top tier when it is called enough times, so a large module
 * nothing calls is, to this mechanism, an empty one.
 *
 * The fixture the negative was measured against was exactly that. Its only export,
 * `run`, called nothing and consisted of constants combined with constants, which
 * Turbofan folds to a single value — so heating it tiered up one function out of 8000
 * and produced a few dozen bytes against a threshold of 1000. **The negative was a
 * property of the fixture.** With an executable shape
 * ({@link SyntheticShape.chained}) the same harness, the same headers and the same
 * URL discipline write a code-cache entry on the first visit and read it back on the
 * second.
 *
 * That correction is carried as data, in {@link CODE_CACHE_EVIDENCE}, and not as
 * prose, because the prose got it wrong twice. It first stated a negative across
 * "220 KB through 10.8 MB, headless and headed, across a browser restart" — four
 * configurations, of which the committed harness drove one; {@link
 * CODE_CACHE_BLIND_SPOTS} was the repair for that, and still is. Then the surviving
 * measured row turned out to be measuring its own fixture. Both repairs point the same
 * way: a row belongs in the table only with a harness here that drives it.
 *
 * Whether the `clone()` above preserves or destroys a cache hit is **no longer
 * unknown**. It could not be asked while no entry existed to consume; now that one
 * does, the loader gets its own Chromium profile in that harness and both writes and
 * reads an entry through it. The clone does not cost the cache.
 */

import { SHA256_CODE, sha256, toHex } from '@o2/core'
import type { CID } from 'multiformats/cid'
// Type-only, and deliberately so: a shape is how a measured module size is
// *regenerated* rather than quoted, but the loader itself must not pull a fixture
// generator into a page's bundle to say so.
import type { SyntheticShape } from './synthetic-artifact.ts'

/** The one MIME type `compileStreaming` accepts. Compared on the essence only. */
export const WASM_CONTENT_TYPE: string = 'application/wasm'

/**
 * Below this, V8 will not cache a compiled module.
 *
 * A documented rule of thumb rather than a specified constant, which is why it is
 * named once here and why `cacheEligible` is reported rather than asserted. Being
 * above it is necessary and demonstrably not sufficient — see the module comment.
 */
export const CODE_CACHE_MIN_BYTES: number = 128 * 1024

/**
 * Bytes of **top-tier** code that trigger a caching event — V8's fifth precondition.
 *
 * Named here because this repository spent a phase publishing a negative that this
 * number explains: nothing in the tree accounted for it, the fixture produced code
 * far below it, and the resulting zero was read as a fact about the platform. The
 * value is `--wasm-caching-threshold`'s default, read from `node --v8-options` on the
 * V8 this project runs.
 *
 * It is not checkable from inside a page — there is no API that reports how much of a
 * module has tiered up — so unlike {@link CODE_CACHE_MIN_BYTES} it gates nothing here.
 * It is recorded so the next person reads five preconditions rather than four.
 */
export const CODE_CACHE_TOP_TIER_THRESHOLD_BYTES: number = 1000

/** Multicodec `raw`. The codec a single-block binary artifact is addressed with. */
export const RAW_CODE: number = 0x55
/** Multicodec `dag-cbor` — what this repository's own `blockCid` produces. */
export const DAG_CBOR_CODE: number = 0x71

/** Ways a gateway base can produce a URL that is not a stable cache key. */
export const URL_DEFECTS = ['not-a-url', 'no-trailing-slash', 'query-string', 'fragment'] as const
export type UrlDefect = (typeof URL_DEFECTS)[number]

/**
 * Why a CID cannot be checked against a stream of bytes.
 *
 * Distinct from a mismatch, and the distinction is the point: reporting an
 * uncheckable CID as `cid-mismatch` sends someone hunting a gateway attack that is
 * not there, when the real answer is that the caller handed over an address of a
 * different kind.
 */
export const CID_DEFECTS = ['hash-not-sha256', 'codec-addresses-a-dag'] as const
export type CidDefect = (typeof CID_DEFECTS)[number]

export type LoadFailure =
  | { readonly kind: 'unstable-url'; readonly base: string; readonly defect: UrlDefect }
  | { readonly kind: 'unsupported-cid'; readonly cid: string; readonly defect: CidDefect; readonly code: number }
  | { readonly kind: 'fetch-failed'; readonly url: string; readonly message: string }
  | { readonly kind: 'bad-status'; readonly url: string; readonly status: number }
  /** `contentType` is `''` when the header was absent altogether. */
  | { readonly kind: 'wrong-content-type'; readonly url: string; readonly contentType: string }
  | {
      readonly kind: 'cid-mismatch'
      readonly expected: string
      /** sha-256 of what actually arrived, hex. Enough to identify the impostor. */
      readonly receivedDigest: string
      readonly bytes: number
    }
  | { readonly kind: 'compile-failed'; readonly url: string; readonly message: string }

export interface LoadedArtifact {
  readonly module: WebAssembly.Module
  /** The stable URL the module came from — the V8 code cache key. */
  readonly url: string
  readonly cid: string
  readonly bytes: number
  /** False below {@link CODE_CACHE_MIN_BYTES}: V8 will never cache this module. */
  readonly cacheEligible: boolean
  /** Wall time across `compileStreaming`, from `performance.now()`. */
  readonly compileMs: number
}

export type LoadResult =
  | { readonly ok: true; readonly artifact: LoadedArtifact }
  | { readonly ok: false; readonly failure: LoadFailure }

export type UrlResult =
  | { readonly ok: true; readonly url: string }
  | { readonly ok: false; readonly failure: Extract<LoadFailure, { kind: 'unstable-url' }> }

/** Injected so a test can answer without a network, and so a caller can add headers. */
export type FetchLike = (url: string) => Promise<Response>

export interface LoadOptions {
  /**
   * A path-gateway root **with a trailing slash**, e.g. `https://ipfs.io/ipfs/`.
   *
   * The slash is mandatory rather than tolerated: `new URL(cid, 'https://h/ipfs')`
   * resolves to `https://h/<cid>`, silently dropping the path segment and producing
   * a URL that 404s or, worse, serves something else.
   */
  readonly gatewayBase: string
  readonly cid: CID
  readonly fetch?: FetchLike
  readonly now?: () => number
}

const messageOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause)

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false
  for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) return false
  return true
}

/**
 * Build the stable URL for a CID under a path gateway.
 *
 * Refuses rather than repairs. A base with `?bust=1` on it is a request for a URL
 * that cannot be code-cached, and silently stripping the query would change what
 * the caller asked to fetch.
 */
export function gatewayUrl(base: string, cid: CID): UrlResult {
  const refuse = (defect: UrlDefect): UrlResult => ({
    ok: false,
    failure: { kind: 'unstable-url', base, defect },
  })

  // Order matters: a base that is both malformed *and* carries a query should name
  // the query, because that is the defect the caller introduced deliberately.
  if (base.includes('#')) return refuse('fragment')
  if (base.includes('?')) return refuse('query-string')
  if (!base.endsWith('/')) return refuse('no-trailing-slash')

  try {
    return { ok: true, url: new URL(cid.toString(), base).toString() }
  } catch {
    return refuse('not-a-url')
  }
}

/**
 * Whether this CID is one whose digest is the digest of the bytes themselves.
 *
 * Returns the defect, or `null` when the CID is checkable.
 *
 * A `dag-pb` CID is the common trap: it names a UnixFS DAG, and a gateway happily
 * returns the reassembled file — whose sha-256 is not the DAG root's. Verifying it
 * as if it were a raw block reports a mismatch on a perfectly honest gateway. An
 * unknown hash function is the dangerous one: skipping verification because the
 * digest cannot be recomputed would turn "content addressed" into "URL fetched".
 */
export function cidDefect(cid: CID): { readonly defect: CidDefect; readonly code: number } | null {
  if (cid.multihash.code !== SHA256_CODE) {
    return { defect: 'hash-not-sha256', code: cid.multihash.code }
  }
  if (cid.code !== RAW_CODE && cid.code !== DAG_CBOR_CODE) {
    return { defect: 'codec-addresses-a-dag', code: cid.code }
  }
  return null
}

/**
 * Fetch, verify, and compile an artifact from a content-addressed gateway URL.
 *
 * The CID is checked for checkability *before* the fetch: an address this loader
 * could not verify must not cause bytes to be pulled at all, because the only thing
 * to do with them afterwards is throw them away.
 */
export async function loadArtifact(options: LoadOptions): Promise<LoadResult> {
  const { cid } = options
  const defect = cidDefect(cid)
  if (defect !== null) {
    return {
      ok: false,
      failure: { kind: 'unsupported-cid', cid: cid.toString(), defect: defect.defect, code: defect.code },
    }
  }

  const built = gatewayUrl(options.gatewayBase, cid)
  if (!built.ok) return built
  const { url } = built

  const fetchImpl = options.fetch ?? ((target: string) => globalThis.fetch(target))
  const clock = options.now ?? ((): number => performance.now())

  let response: Response
  try {
    response = await fetchImpl(url)
  } catch (cause) {
    return { ok: false, failure: { kind: 'fetch-failed', url, message: messageOf(cause) } }
  }

  if (!response.ok) {
    return { ok: false, failure: { kind: 'bad-status', url, status: response.status } }
  }

  // Exact, parameters and all. The first version of this compared the essence and
  // let `application/wasm; charset=utf-8` through, on the reasonable-sounding theory
  // that a charset is harmless — and Chromium then rejected it inside
  // `compileStreaming`, so the load failed as `compile-failed` and pointed at the
  // artifact instead of at the gateway's header. The WebAssembly Web API spec is
  // explicit: "extra parameters are not allowed, including empty ones."
  const contentType = (response.headers.get('content-type') ?? '').trim().toLowerCase()
  if (contentType !== WASM_CONTENT_TYPE) {
    return { ok: false, failure: { kind: 'wrong-content-type', url, contentType } }
  }

  if (response.body === null) {
    return { ok: false, failure: { kind: 'fetch-failed', url, message: 'response carried no body' } }
  }

  // Both branches are started here, before either is awaited. See the module
  // comment: serialising them makes the browser buffer the whole artifact.
  const verifying = response.clone().arrayBuffer()
  const startedAt = clock()
  const compiling = WebAssembly.compileStreaming(response).then((module) => ({
    module,
    compileMs: clock() - startedAt,
  }))
  const [verified, compiled] = await Promise.allSettled([verifying, compiling])

  if (verified.status === 'rejected') {
    return {
      ok: false,
      failure: { kind: 'fetch-failed', url, message: `body could not be read: ${messageOf(verified.reason)}` },
    }
  }

  const bytes = new Uint8Array(verified.value)
  const digest = await sha256.digest(bytes)
  if (!sameBytes(digest.digest, cid.multihash.digest)) {
    // Never returned, never stored, never compiled-and-handed-back. The compiled
    // module from the other branch is dropped on the floor here.
    return {
      ok: false,
      failure: {
        kind: 'cid-mismatch',
        expected: cid.toString(),
        receivedDigest: toHex(digest.digest),
        bytes: bytes.length,
      },
    }
  }

  if (compiled.status === 'rejected') {
    return { ok: false, failure: { kind: 'compile-failed', url, message: messageOf(compiled.reason) } }
  }

  return {
    ok: true,
    artifact: {
      module: compiled.value.module,
      url,
      cid: cid.toString(),
      bytes: bytes.length,
      cacheEligible: bytes.length >= CODE_CACHE_MIN_BYTES,
      compileMs: compiled.value.compileMs,
    },
  }
}

const URL_DEFECT_NOTES: Readonly<Record<UrlDefect, string>> = {
  'query-string':
    'carries a query string — the V8 code cache is keyed on the URL, so a query parameter makes every visit a miss',
  fragment: 'carries a fragment, which is not part of a fetched resource and cannot belong in a gateway root',
  'no-trailing-slash': 'has no trailing slash — URL resolution would drop its last path segment',
  'not-a-url': 'is not a URL',
}

export function describeLoadFailure(failure: LoadFailure): string {
  switch (failure.kind) {
    case 'unstable-url':
      return `gateway base "${failure.base}" ${URL_DEFECT_NOTES[failure.defect]}`
    case 'unsupported-cid':
      return failure.defect === 'hash-not-sha256'
        ? `${failure.cid} uses multihash 0x${failure.code.toString(16)}, not sha2-256 — its bytes cannot be verified, so they are not fetched`
        : `${failure.cid} uses codec 0x${failure.code.toString(16)}, which addresses a DAG rather than a block of bytes — a gateway's reassembled file would never hash to it`
    case 'fetch-failed':
      return `${failure.url} could not be fetched: ${failure.message}`
    case 'bad-status':
      return `${failure.url} answered ${failure.status} — try another gateway`
    case 'wrong-content-type':
      return failure.contentType === ''
        ? `${failure.url} sent no Content-Type; application/wasm is required for streaming compilation`
        : `${failure.url} sent Content-Type ${failure.contentType}, not application/wasm — this is usually a gateway error page rather than a bad artifact`
    case 'cid-mismatch':
      return `${failure.expected} was requested but ${failure.bytes} bytes hashing to ${failure.receivedDigest} arrived — the artifact was not stored, returned, or run`
    case 'compile-failed':
      return `${failure.url} is application/wasm and hashes correctly but did not compile: ${failure.message}`
  }
}

/**
 * Two compiles of the same URL, and what can honestly be concluded from them.
 *
 * Note the absence of a `hit` variant. Nothing observable from inside a page
 * distinguishes a V8 code-cache hit from the confounds below, so the type does not
 * offer a way to claim one. Establishing a hit needs an observation from outside
 * the page — the browser profile's `Code Cache/wasm` directory, or the
 * `v8.wasm.moduleCacheHit` trace event — which is what the e2e test looks for.
 */
export type CacheVerdict =
  | { readonly kind: 'ineligible'; readonly bytes: number; readonly threshold: number }
  | { readonly kind: 'inconclusive'; readonly ratio: number; readonly confounds: readonly string[] }

/**
 * Every reason a second compile can be faster that is not the code cache.
 *
 * Carried as data and rendered with the ratio, the same way `@o2/bench` keeps
 * excluded configurations inside the report: a caveat parked next to a number gets
 * separated from it the first time somebody quotes the number.
 */
export const CACHE_CONFOUNDS: readonly string[] = [
  'the HTTP cache served the second fetch, so its bytes never crossed a socket',
  "V8's in-process native-module cache matches on wire bytes within one renderer, with no code cache involved",
  'the CPU, the allocator and the JIT were warm the second time',
  'compileStreaming resolves after baseline compilation only, so the number omits tier-up either way',
]

export interface CompilePair {
  readonly url: string
  readonly bytes: number
  readonly firstMs: number
  readonly secondMs: number
}

export function cacheVerdict(pair: CompilePair): CacheVerdict {
  if (pair.bytes < CODE_CACHE_MIN_BYTES) {
    return { kind: 'ineligible', bytes: pair.bytes, threshold: CODE_CACHE_MIN_BYTES }
  }
  return {
    kind: 'inconclusive',
    ratio: pair.secondMs === 0 ? Number.POSITIVE_INFINITY : pair.firstMs / pair.secondMs,
    confounds: CACHE_CONFOUNDS,
  }
}

export function describeCacheVerdict(verdict: CacheVerdict): string {
  if (verdict.kind === 'ineligible') {
    return (
      `${verdict.bytes} bytes is below V8's ~${verdict.threshold}-byte caching threshold — ` +
      'this module can never be code-cached, so any timing difference is something else'
    )
  }
  const ratio = Number.isFinite(verdict.ratio) ? `${verdict.ratio.toFixed(2)}×` : 'unmeasurable'
  return [
    `second compile was ${ratio} the first — this does NOT establish a code-cache hit`,
    ...verdict.confounds.map((confound) => `  equally explains it: ${confound}`),
  ].join('\n')
}

export type RepeatMeasurement =
  | { readonly ok: false; readonly on: 'first' | 'second'; readonly failure: LoadFailure }
  | { readonly ok: true; readonly pair: CompilePair; readonly verdict: CacheVerdict }

/**
 * Load the same URL twice and report the pair.
 *
 * Deliberately returns a {@link CacheVerdict} that cannot say "hit". Within a single
 * page the two loads share a renderer, an HTTP cache and a V8 isolate, so this
 * measures the *shape* of a repeat load and nothing about persistence across visits.
 */
export async function measureRepeatLoad(options: LoadOptions): Promise<RepeatMeasurement> {
  const first = await loadArtifact(options)
  if (!first.ok) return { ok: false, on: 'first', failure: first.failure }
  const second = await loadArtifact(options)
  if (!second.ok) return { ok: false, on: 'second', failure: second.failure }

  const pair: CompilePair = {
    url: first.artifact.url,
    bytes: first.artifact.bytes,
    firstMs: first.artifact.compileMs,
    secondMs: second.artifact.compileMs,
  }
  return { ok: true, pair, verdict: cacheVerdict(pair) }
}

/**
 * A code-cache configuration, in the terms that could change the answer.
 *
 * `visits` because the cache is written on one load and read back on the next, so a
 * single visit can only ever produce a null. `browserRestart` because a cache held
 * in the renderer would survive a second page load and not a second process, and
 * those two nulls mean different things. `display` because headless Chromium is a
 * different code path and was one of the standing suspects for the null below.
 */
export interface CodeCacheConfiguration {
  /**
   * Module size in bytes.
   *
   * On a measured row this is recomputed from the harness's arms by the browser
   * test, so it cannot drift from what is actually served. On an unmeasured row it
   * is the figure the original claim named and nothing re-derives it — which is a
   * large part of what "unmeasured" means here.
   */
  readonly moduleBytes: number
  readonly visits: number
  readonly display: 'headless' | 'headed' | 'both'
  readonly browserRestart: boolean
}

/**
 * An apparatus **in this tree** that produces a code-cache reading.
 *
 * The point of the type is that it is a small, closed list. A reading may only cite
 * a harness that appears in {@link CODE_CACHE_HARNESSES}, and only with the exact
 * configuration that harness is committed to drive, so a row cannot be added to the
 * measured table by writing it down.
 */
export interface CodeCacheHarness {
  /** Path from the repository root. */
  readonly file: string
  /** The `it(…)` whose output carries the reading. */
  readonly test: string
  /** How to run it, so the number is checkable rather than citable. */
  readonly command: string
  /**
   * The synthetic shapes it serves, one per arm.
   *
   * Two arms, of near-identical size and deliberately distinct byte counts: the
   * platform API unmediated, and `loadArtifact` as shipped. Identical bytes would be
   * one CID, hence one URL, and the second arm would be reading whatever the first
   * left behind.
   */
  readonly arms: readonly SyntheticShape[]
  readonly configuration: CodeCacheConfiguration
}

/**
 * The one apparatus here that reads a code cache off disk.
 *
 * It has to be an e2e. Nothing inside a page can see the code cache — a second
 * `compileStreaming` of the same URL in the same document is faster for at least the
 * four reasons in {@link CACHE_CONFOUNDS}, none of them the cache — so the
 * observation is made from outside the browser, across page loads, in one profile.
 */
export const CODE_CACHE_E2E_HARNESS: CodeCacheHarness = {
  file: 'packages/node/src/code-cache.e2e.test.ts',
  test: 'reports what was seen for WebAssembly without asserting a hit that was not observed',
  command: 'npx vitest run --project=e2e packages/node/src/code-cache.e2e.test.ts',
  arms: [
    { functions: 8000, opsPerFunction: 200 },
    { functions: 8001, opsPerFunction: 200 },
  ],
  configuration: { moduleBytes: 4_856_036, visits: 3, display: 'headless', browserRestart: false },
}

/**
 * The executable shape, through the platform API — the row that refutes the negative.
 *
 * Its own Chromium profile in the same file. Separate profiles rather than two arms in
 * one, because a trace event says *a* module was serialised and not *which* one, and
 * the whole point of this row and the next is to tell the platform's answer apart from
 * the loader's.
 */
export const CODE_CACHE_HOT_PLATFORM_HARNESS: CodeCacheHarness = {
  file: 'packages/node/src/code-cache.e2e.test.ts',
  test: 'writes an entry on the first visit through the platform API',
  command: 'npx vitest run --project=e2e packages/node/src/code-cache.e2e.test.ts',
  arms: [{ functions: 2000, opsPerFunction: 100, chained: true }],
  configuration: { moduleBytes: 621_623, visits: 2, display: 'headless', browserRestart: false },
}

/** The same shape through the shipped `loadArtifact`, so `Response.clone()` is on trial. */
export const CODE_CACHE_HOT_LOADER_HARNESS: CodeCacheHarness = {
  file: 'packages/node/src/code-cache.e2e.test.ts',
  test: 'does the same through the shipped loader, so Response.clone() does not cost the hit',
  command: 'npx vitest run --project=e2e packages/node/src/code-cache.e2e.test.ts',
  arms: [{ functions: 2001, opsPerFunction: 100, chained: true }],
  configuration: { moduleBytes: 621_934, visits: 2, display: 'headless', browserRestart: false },
}

export const CODE_CACHE_HARNESSES: readonly CodeCacheHarness[] = [
  CODE_CACHE_E2E_HARNESS,
  CODE_CACHE_HOT_PLATFORM_HARNESS,
  CODE_CACHE_HOT_LOADER_HARNESS,
]

/**
 * Every configuration the code-cache negative has ever been claimed for.
 *
 * Declared as one closed list rather than implied by two: the invariant that matters
 * is that each of these is accounted for *exactly once*, as either a reading or a
 * blind spot. A row that quietly leaves both lists is the failure this table exists
 * to prevent, and only a declared total can catch it.
 */
export const CODE_CACHE_ROWS = [
  '220kb-2-visits',
  '1.1mb-2-visits',
  '4.8mb-3-visits',
  '10.8mb-3-visits-restart',
  'disabled-cache-calibration',
  '622kb-chained-2-visits-platform',
  '622kb-chained-2-visits-loader',
] as const

export type CodeCacheRow = (typeof CODE_CACHE_ROWS)[number]

export interface CodeCacheReading {
  readonly row: CodeCacheRow
  readonly configuration: CodeCacheConfiguration
  /** The {@link CodeCacheHarness.file} that produces it. Checked, not decorative. */
  readonly harness: string
  /**
   * Bytes in the profile's `Default/Code Cache/wasm` after the last visit.
   *
   * The harness prints this on every run and deliberately does not assert it: pinning
   * the null would turn a future Chromium that starts caching into a red build, when
   * the entire point is to find out. So this figure is the last reading, and re-running
   * {@link CodeCacheHarness.command} reproduces or contradicts it.
   */
  readonly wasmCacheBytes: number
  /** What makes this row's figure a finding rather than a broken instrument. */
  readonly control: CodeCacheControl
  readonly note: string
}

/**
 * How a reading is calibrated — and it must be, in the direction its figure points.
 *
 * A **zero** needs a positive control, or it cannot be told from an instrument that
 * sees nothing. A **non-zero** needs the opposite: something in the same apparatus
 * that stays at zero, or the figure could be an artefact of the apparatus rather than
 * of the thing under test. The two cases need different evidence, so they are
 * different variants rather than one nullable number.
 *
 * The field this replaces was `jsControlFloorBytes: number`, which encoded only the
 * first case. Carrying it onto a positive row would have meant writing down a floor no
 * harness enforces for that row — a number nobody re-derives, which is the precise
 * defect {@link CODE_CACHE_BLIND_SPOTS} exists to prevent, reintroduced through the
 * control field instead of the reading field.
 */
export type CodeCacheControl =
  /**
   * The sibling `Default/Code Cache/js` directory, in the same profile over the same
   * visits, asserted to pass `floorBytes` and to grow between the first visit and the
   * last. One directory fills and the other does not.
   */
  | { readonly kind: 'js-code-cache-floor'; readonly floorBytes: number }
  /**
   * Another row of this table, measured in the same run, whose figure stays at the
   * index-only floor. For a positive reading this is the stronger control: same
   * Chromium, same origin, same headers, same settle, and the only difference is the
   * property under test.
   */
  | { readonly kind: 'contrasting-row'; readonly against: CodeCacheRow }

export const CODE_CACHE_READINGS: readonly CodeCacheReading[] = [
  {
    row: '4.8mb-3-visits',
    configuration: CODE_CACHE_E2E_HARNESS.configuration,
    harness: CODE_CACHE_E2E_HARNESS.file,
    wasmCacheBytes: 72,
    control: { kind: 'js-code-cache-floor', floorBytes: 500_000 },
    note:
      'three visits to one persistent profile with application/wasm, a cacheable response, a ' +
      'query-free CID URL and compileStreaming. Code Cache/wasm never grew beyond its index file ' +
      'on any visit — and the reason is the fixture, not the loader. This row previously claimed ' +
      'the module was "executed hot enough to tier up"; it was executed, and one function of 8000 ' +
      'tiered up, because the straight-line shape\'s only export calls nothing and folds to a ' +
      'constant. The harness prints the giveaway: this arm completes 3,000,000 run() calls in ' +
      'about 24 ms, upwards of 10^8 calls a second, which no 200-operation body can do. Retained ' +
      'as the control it turned out to be, not as evidence about the platform',
  },
  {
    row: '622kb-chained-2-visits-platform',
    configuration: CODE_CACHE_HOT_PLATFORM_HARNESS.configuration,
    harness: CODE_CACHE_HOT_PLATFORM_HARNESS.file,
    wasmCacheBytes: 61_528,
    control: { kind: 'contrasting-row', against: '4.8mb-3-visits' },
    note:
      'the same apparatus, the same headers and the same URL discipline, on a module whose export ' +
      'calls every other function and whose bodies start from a mutable global so nothing folds. ' +
      'wasm.SerializeModule on visit 1; wasm.GetNativeModuleFromCache, wasm.Deserialize and ' +
      'wasm.CompilationAfterDeserialization on visit 2. The figure is reported, not asserted — ' +
      'what is asserted is that it clears the 72-byte index-only floor and that the trace events fire',
  },
  {
    row: '622kb-chained-2-visits-loader',
    configuration: CODE_CACHE_HOT_LOADER_HARNESS.configuration,
    harness: CODE_CACHE_HOT_LOADER_HARNESS.file,
    wasmCacheBytes: 61_570,
    control: { kind: 'contrasting-row', against: '4.8mb-3-visits' },
    note:
      'the shipped loadArtifact rather than the platform API, in its own profile so the answer is ' +
      'unambiguously the loader\'s. It clones the response to verify bytes against the CID while ' +
      'compileStreaming consumes the original, and the worry was that the clone would detach ' +
      'whatever Blink attaches for cached metadata. It does not: the same write on visit 1 and the ' +
      'same read on visit 2',
  },
]

/** How a declared row fails to be reproducible from this tree. */
export const CODE_CACHE_GAPS = ['configuration-not-driven', 'control-not-committed'] as const
export type CodeCacheGap = (typeof CODE_CACHE_GAPS)[number]

/**
 * A row of the negative result that nothing here re-derives.
 *
 * Not a caveat beside the table — a member of it, for the reason `StartReport` carries
 * its blind spots as a field and `LiftedArtifact` carries `blindSpots` beside the
 * bytes: a qualification kept next to a number gets separated from it the first time
 * somebody quotes the number, and what survives the quoting is the number.
 *
 * `wouldNeed` is required, not optional. A gap without a stated cost is indistinguishable
 * from a gap nobody intends to close, and these are all cheap enough to be neither.
 */
export interface CodeCacheBlindSpot {
  readonly kind: CodeCacheGap
  readonly row: CodeCacheRow
  /** The row as the original table wrote it, kept verbatim so nothing is lost. */
  readonly claim: string
  /** Why this tree cannot produce it. */
  readonly note: string
  /** What committing it would take. */
  readonly wouldNeed: string
}

export const CODE_CACHE_BLIND_SPOTS: readonly CodeCacheBlindSpot[] = [
  {
    kind: 'configuration-not-driven',
    row: '220kb-2-visits',
    claim: '220 KB, 2 visits — Code Cache/wasm 72 B',
    note:
      'an exploratory run from the same series; no harness here serves a 220 KB artifact across ' +
      'two visits, so the row is a memory of a result rather than a result. It is now doubly ' +
      'unusable: it was run against the straight-line shape, whose single export folds to a ' +
      'constant, so its 72 B says nothing about 220 KB modules and only repeats what the fixture ' +
      'made inevitable at every size',
    wouldNeed:
      'a chained arm at 220 KB with its own profile. Cheap in harness time and no longer very ' +
      'interesting: the size axis it covers is not the axis that decided the result',
  },
  {
    kind: 'configuration-not-driven',
    row: '1.1mb-2-visits',
    claim: '1.1 MB, 2 visits — Code Cache/wasm 72 B',
    note:
      'same series, and the weakest row of the four: the shape that produced 1.1 MB was not ' +
      'recorded, so the module itself cannot be regenerated. A size is not a module, and a row ' +
      'whose subject cannot be rebuilt could not be re-run even with the harness time to spare. ' +
      'Superseded in substance — whatever that module was, it was straight-line',
    wouldNeed:
      'a recorded SyntheticShape first — the missing half — then a chained arm at that size',
  },
  {
    kind: 'configuration-not-driven',
    row: '10.8mb-3-visits-restart',
    claim: '10.8 MB, 3 visits including a browser restart, headed and headless — Code Cache/wasm 72 B',
    note:
      'the strongest of the discarded rows and the most expensive, and the two axes it covers are ' +
      'still uncovered: a restart separates a cache held in the renderer from one written to the ' +
      'profile, and a headed run rules out headless Chromium as a factor. Both were run by hand ' +
      'once, against the straight-line shape, so neither axis was ever really exercised — the ' +
      'null they returned was the fixture\'s. Now that an entry is produced on demand, a restart ' +
      'arm would finally be able to distinguish something',
    wouldNeed:
      'a second chromium.launchPersistentContext over the chained profile directory after the ' +
      'first is closed, asserting the entry survives and is read back, plus a headless:false arm ' +
      'gated on a display being present — the gate is the awkward part, since CI has no display ' +
      'and a silently skipped arm would restore exactly the ambiguity this table is removing',
  },
  {
    kind: 'control-not-committed',
    row: 'disabled-cache-calibration',
    claim: 'relaunched with --v8-cache-options=none, Code Cache/js reads 72 B — the same figure Code Cache/wasm reads on every ordinary run',
    note:
      'the negative control for the 72 B figure, establishing that it means "nothing was written" ' +
      'rather than "nothing was found". Still run only by hand. It matters less than it did: the ' +
      'chained rows now show the same directory in the same harness filling to about 61.5 KB, which ' +
      'calibrates the instrument in the direction that was missing without anyone relaunching ' +
      'anything. What it would still add is proof that 72 B specifically is an empty store',
    wouldNeed:
      'one more launchPersistentContext over a fresh profile with args ["--v8-cache-options=none"], ' +
      'asserting Code Cache/js collapses to the figure Code Cache/wasm shows — about thirty lines, ' +
      'and the cheapest of the four to close',
  },
]

/**
 * The readings and the gaps, as one value.
 *
 * There is deliberately no way to obtain the table without the blind spots: they are
 * fields of the same object and {@link describeCodeCacheEvidence} renders them into
 * one string, so a caller cannot present the measured row and drop the rest any more
 * than `describeStartReport` can print a failure rate without what it cannot see.
 */
export interface CodeCacheEvidence {
  readonly readings: readonly CodeCacheReading[]
  /** Never empty. */
  readonly blindSpots: readonly CodeCacheBlindSpot[]
}

export const CODE_CACHE_EVIDENCE: CodeCacheEvidence = {
  readings: CODE_CACHE_READINGS,
  blindSpots: CODE_CACHE_BLIND_SPOTS,
}

function sameConfiguration(left: CodeCacheConfiguration, right: CodeCacheConfiguration): boolean {
  return (
    left.moduleBytes === right.moduleBytes &&
    left.visits === right.visits &&
    left.display === right.display &&
    left.browserRestart === right.browserRestart
  )
}

/**
 * The harness that produces a reading, or `null` if this tree has none for it.
 *
 * Both halves are load-bearing. Naming a harness that does not exist is the obvious
 * error; naming one that exists but drives a *different* configuration is the subtle
 * one, and it is how a row gets promoted to "measured" by association with a run that
 * did not measure it.
 */
export function codeCacheHarnessFor(reading: CodeCacheReading): CodeCacheHarness | null {
  // `filter`, not `find`. One file now holds three harnesses — a straight-line profile
  // and two chained ones — and `find` would have returned whichever was declared first
  // and then failed the configuration check for the other two. That failure mode is
  // benign here (a true row reads as unmeasured) but it is the mirror of the one this
  // function exists to catch, so it is fixed rather than worked around at the call site.
  const inFile = CODE_CACHE_HARNESSES.filter((harness) => harness.file === reading.harness)
  return inFile.find((harness) => sameConfiguration(harness.configuration, reading.configuration)) ?? null
}

/** One line of prose for a reading's calibration, in the direction its figure points. */
export function describeCodeCacheControl(control: CodeCacheControl): string {
  return control.kind === 'js-code-cache-floor'
    ? `positive control: Code Cache/js passes ${control.floorBytes} B and grows, same profile, same visits`
    : `contrast: ${control.against} stays at the index-only floor in the same run`
}

const describeConfiguration = (configuration: CodeCacheConfiguration): string =>
  `${configuration.moduleBytes} B module, ${configuration.visits} visits, ${configuration.display}` +
  (configuration.browserRestart ? ', with a browser restart' : '')

/** Render the whole table — measured rows and unmeasured rows in one block. */
export function describeCodeCacheEvidence(evidence: CodeCacheEvidence): string {
  const lines: string[] = ['V8 WebAssembly code cache across visits — what this tree reproduces']
  for (const reading of evidence.readings) {
    lines.push(
      `  measured: ${describeConfiguration(reading.configuration)} → Code Cache/wasm ${reading.wasmCacheBytes} B`,
    )
    lines.push(`    ${reading.note}`)
    lines.push(`    ${describeCodeCacheControl(reading.control)}`)
    lines.push(`    produced by ${reading.harness}`)
  }
  for (const spot of evidence.blindSpots) {
    lines.push(`  not measured here: ${spot.claim}`)
    lines.push(`    ${spot.note}`)
    lines.push(`    would need: ${spot.wouldNeed}`)
  }
  return lines.join('\n')
}
