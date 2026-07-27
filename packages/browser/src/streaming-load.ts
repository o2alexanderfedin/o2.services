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
 * The four conditions are necessary. That they are **sufficient** is not
 * established, and on the one configuration this repository actually drives they
 * demonstrably were not: `packages/node/src/code-cache.e2e.test.ts` loads a ~4.8 MB
 * artifact three times over one stable URL in a persistent Chromium profile and
 * reads `Default/Code Cache/wasm` off disk, and no WASM entry has ever appeared —
 * while the *JavaScript* code cache in the same profile, over the same visits, grew
 * past the floor that test asserts.
 *
 * That finding is carried as data, in {@link CODE_CACHE_EVIDENCE}, and not as prose,
 * because the prose got it wrong. This comment previously stated the negative across
 * "220 KB through 10.8 MB, headless and headed, across a browser restart" — four
 * configurations, of which the committed harness drives one. The other three, and the
 * disabled-cache calibration that gives the null its meaning, were run by hand and
 * never committed. Nothing in the sentence told a reader which was which, so a
 * measured zero and a remembered one read identically. {@link CODE_CACHE_BLIND_SPOTS}
 * is the repair: every configuration the result was ever claimed for is named, with a
 * reason it is not reproducible here and what committing it would take. The negative
 * result is not softened by this — it is the same negative, minus three rows it was
 * being credited with.
 *
 * Whether the `clone()` above preserves or destroys a cache hit stays unknown, and
 * for a structural reason rather than an unfinished one: no entry was ever produced
 * for a second visit to consume, so there is nothing for the comparison to run
 * against.
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

export const CODE_CACHE_HARNESSES: readonly CodeCacheHarness[] = [CODE_CACHE_E2E_HARNESS]

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
  /**
   * The positive control, as the floor the harness asserts.
   *
   * A floor rather than a figure, because a figure would be a number nobody re-derives
   * — the same defect as the rows below. What the harness actually enforces is that
   * `Default/Code Cache/js`, in the same profile over the same visits, passes this and
   * grows between the first visit and the last. One directory fills and its sibling
   * does not; that comparison is what makes the null a finding rather than a broken
   * instrument.
   */
  readonly jsControlFloorBytes: number
  readonly note: string
}

export const CODE_CACHE_READINGS: readonly CodeCacheReading[] = [
  {
    row: '4.8mb-3-visits',
    configuration: CODE_CACHE_E2E_HARNESS.configuration,
    harness: CODE_CACHE_E2E_HARNESS.file,
    wasmCacheBytes: 72,
    jsControlFloorBytes: 500_000,
    note:
      'three visits to one persistent profile with application/wasm, a cacheable response, a ' +
      'query-free CID URL, compileStreaming, and the module executed hot enough to tier up — ' +
      'because blink serialises top-tier code and a module that is never called never tiers up. ' +
      'Code Cache/wasm never grew beyond its index file on any visit',
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
      'two visits, so the row is a memory of a result rather than a result. The size axis is the ' +
      'one it covers, and a smaller module is the less likely of the two to be cached — so this ' +
      'row was never the load-bearing evidence, only the widest-sounding',
    wouldNeed:
      'a second pair of arms in the e2e harness at the CODE_CACHE_SIZED shape, with its own ' +
      'profile so the 4.8 MB arms cannot contaminate it — one more Chromium launch and one more ' +
      '25-second settle, which is why it was dropped rather than committed',
  },
  {
    kind: 'configuration-not-driven',
    row: '1.1mb-2-visits',
    claim: '1.1 MB, 2 visits — Code Cache/wasm 72 B',
    note:
      'same series, and the weakest row of the four: the shape that produced 1.1 MB was not ' +
      'recorded, so the module itself cannot be regenerated. A size is not a module, and a row ' +
      'whose subject cannot be rebuilt could not be re-run even with the harness time to spare',
    wouldNeed:
      'a recorded SyntheticShape first — the missing half — then an arm like the one above',
  },
  {
    kind: 'configuration-not-driven',
    row: '10.8mb-3-visits-restart',
    claim: '10.8 MB, 3 visits including a browser restart, headed and headless — Code Cache/wasm 72 B',
    note:
      'the strongest of the discarded rows and the most expensive. It is also the only one that ' +
      'covers axes the committed harness does not touch at all: a restart separates a cache held ' +
      'in the renderer from one written to the profile, and a headed run rules out headless ' +
      'Chromium as the cause. Both were run by hand once; neither is in the tree, so "across a ' +
      'browser restart" and "headed" are claims nothing here supports',
    wouldNeed:
      'a second chromium.launchPersistentContext over the same profile directory after the first ' +
      'is closed, plus a headless:false arm gated on a display being present — the gate is the ' +
      'awkward part, since CI has no display and a silently skipped arm would restore exactly the ' +
      'ambiguity this table is removing',
  },
  {
    kind: 'control-not-committed',
    row: 'disabled-cache-calibration',
    claim: 'relaunched with --v8-cache-options=none, Code Cache/js reads 72 B — the same figure Code Cache/wasm reads on every ordinary run',
    note:
      'the negative control, and the row that turns 72 B from "nothing was found" into "nothing ' +
      'was written". Note what the harness does commit: the *positive* control, Code Cache/js ' +
      'filling in the same profile over the same visits, asserted rather than printed. So the ' +
      'instrument is calibrated in one direction here and only by hand in the other',
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
  const named = CODE_CACHE_HARNESSES.find((harness) => harness.file === reading.harness)
  if (named === undefined) return null
  return sameConfiguration(named.configuration, reading.configuration) ? named : null
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
    lines.push(
      `    positive control: Code Cache/js passes ${reading.jsControlFloorBytes} B and grows, same profile, same visits`,
    )
    lines.push(`    produced by ${reading.harness}`)
  }
  for (const spot of evidence.blindSpots) {
    lines.push(`  not measured here: ${spot.claim}`)
    lines.push(`    ${spot.note}`)
    lines.push(`    would need: ${spot.wouldNeed}`)
  }
  return lines.join('\n')
}
