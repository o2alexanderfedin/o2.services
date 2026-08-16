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
// AUTH-02 — the anchor a tab pins in production, read from the certificate this origin
// already holds. Exported because the *caller* has to apply it: the set is fixed before
// `resolveCertificate` runs, so `BrowserNode.start` cannot read it for itself. See the
// function's own docblock for the ordering argument.
export { enrolledIssuer } from './browser-node.ts'
export type { BrowserNodeOptions } from './browser-node.ts'
export type {
  TabActivity,
  TabAddresses,
  TabApi,
  TabConsentState,
  TabDiscoveryRound,
  TabGovernorState,
  TabHeldPeer,
  TabIsolation,
  TabJobReport,
  // DET-03/DATA-08: exported because the shape has a caller outside this package. The
  // e2e harnesses in `packages/node` sign a record and hand it across `page.evaluate`,
  // and a hand-written object literal there would drift from `runJob`'s parameter
  // silently — which is exactly what this file's own header says the type exists to stop.
  TabNameRecord,
  TabStartReport,
} from './tab-api.ts'
// `subtle-digest-fallback.ts` is deliberately absent from this barrel, for the reason
// `worker-factory.ts` above is: it has exactly one caller, `BrowserNode.#compose`, which
// imports it directly. Exporting it "for a host application that wires libp2p itself"
// would add three symbols with no call path — which is precisely what
// `reachability-guard.node.test.ts` reddens on, and it watched this file do it.
export { VisibilityGovernor } from './visibility-governor.ts'
export type { Sleep, VisibilityGovernorOptions, VisibilitySource } from './visibility-governor.ts'

// Consent — BROW-01.
export {
  CONSENT_KEY,
  GrantedConsent,
  grantConsent,
  localConsentStore,
  memoryConsentStore,
  pageConsentStore,
  readConsent,
  revokeConsent,
} from './consent.ts'
export type { ConsentGap, ConsentRecord, ConsentStore, GrantOptions } from './consent.ts'
export { CONSENT_VERSION_NOTE, DISCLOSURE, DISCLOSURE_VERSION } from './disclosure.ts'
export type { Disclosure, DisclosureLine } from './disclosure.ts'

// Stopping for real, and bounding an untrusted guest — BROW-04, SCHED-06.
export { browserWorkerExecutor, WorkerExecutor } from './worker-executor.ts'
export type { BrowserWorkerExecutorOptions, WorkerFactory } from './worker-executor.ts'
export { domThread } from './dom-thread.ts'

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
  // The fifth precondition, exported beside the fourth on purpose. `CODE_CACHE_MIN_BYTES`
  // alone is what a reader of this barrel used to see, and reading only it is how this
  // package published a negative that turned out to be a fact about its own fixture:
  // a module can clear the size bar and still never cache, because what V8 counts is
  // top-tier code. Neither constant is checkable from inside a page; both are here so
  // the list a consumer sees is the whole list.
  CODE_CACHE_TOP_TIER_THRESHOLD_BYTES,
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
