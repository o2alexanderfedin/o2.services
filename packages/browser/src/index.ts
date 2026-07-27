/**
 * `@o2/browser` — the browser adapters.
 *
 * Mirrors `@o2/node`: everything here needs a DOM or a browser storage API, so it
 * is kept out of the portable packages. `purity.node.test.ts` enforces that
 * separation in the other direction.
 *
 * `worker-factory.ts` is deliberately absent from this barrel — it uses Vite's
 * `?worker` suffix, so importing it outside a bundler fails at resolution. Pages
 * import that file directly.
 *
 * Everything else is here on purpose, including the artifact loader. `@o2/aot`'s
 * barrel gives the reasoning at length and it applies unchanged: a loader reachable
 * only from its own spec cannot be shown to sit on the path a page actually takes,
 * so "the artifact a visitor runs was verified against its CID before it was
 * compiled" would be a statement about a file rather than about the fabric. The
 * failure and verdict types travel with `loadArtifact` for the same reason its
 * caveats travel inside its results — a caller that cannot name `cid-mismatch`
 * cannot distinguish a hostile gateway from a broken one.
 */

export { IdbBlockstore } from './idb-blockstore.ts'
export { BrowserNode } from './browser-node.ts'
export type { BrowserNodeOptions } from './browser-node.ts'
export type {
  TabActivity,
  TabAddresses,
  TabApi,
  TabConsentState,
  TabGovernorState,
  TabIsolation,
  TabJobReport,
  TabStartReport,
} from './tab-api.ts'
export { VisibilityGovernor } from './visibility-governor.ts'
export type { Sleep, VisibilityGovernorOptions, VisibilitySource } from './visibility-governor.ts'

// Consent — BROW-01.
export {
  CONSENT_KEY,
  GrantedConsent,
  grantConsent,
  localConsentStore,
  memoryConsentStore,
  readConsent,
  revokeConsent,
} from './consent.ts'
export type { ConsentGap, ConsentRecord, ConsentStore, GrantOptions } from './consent.ts'
export { CONSENT_VERSION_NOTE, DISCLOSURE, DISCLOSURE_VERSION } from './disclosure.ts'
export type { Disclosure, DisclosureLine } from './disclosure.ts'

// Stopping for real — BROW-04.
export { WorkerExecutor } from './worker-executor.ts'
export type { WorkerExecutorOptions, WorkerFactory } from './worker-executor.ts'

// The blocking metric — BROW-02.
export { BROWSER_FAMILIES, browserLabel, currentBrowserLabel, identifyBrowser } from './browser-id.ts'
export type { BrowserFamily, BrowserId } from './browser-id.ts'
export { classifyStartError, firstGap, probeEnvironment } from './start-probe.ts'
export type { ProbeGlobals, StartEnvironment } from './start-probe.ts'

// Fetching and verifying a translated artifact, in the one shape V8 can cache — AOT-05.
export {
  CACHE_CONFOUNDS,
  cacheVerdict,
  CID_DEFECTS,
  cidDefect,
  CODE_CACHE_MIN_BYTES,
  DAG_CBOR_CODE,
  describeCacheVerdict,
  describeLoadFailure,
  gatewayUrl,
  loadArtifact,
  measureRepeatLoad,
  RAW_CODE,
  URL_DEFECTS,
  WASM_CONTENT_TYPE,
} from './streaming-load.ts'
export type {
  CacheVerdict,
  CidDefect,
  CompilePair,
  FetchLike,
  LoadedArtifact,
  LoadFailure,
  LoadOptions,
  LoadResult,
  RepeatMeasurement,
  UrlDefect,
  UrlResult,
} from './streaming-load.ts'
