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
export { enrolledIssuer, enrolledUserKey } from './browser-node.ts'
export type { BrowserNodeOptions } from './browser-node.ts'
export type {
  TabActivity,
  TabAddresses,
  TabApi,
  // SCHED-01 — exported for the reason `TabNameRecord` below is: the shape crosses
  // `page.evaluate` into `packages/node`'s e2e harnesses, and a hand-written literal
  // there would drift from what `lastCandidates()` actually returns.
  TabCandidateLookup,
  TabConsentState,
  TabDiscoveryRound,
  TabEnrolmentOffer,
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
  describeAnchors,
  readConsent,
  revokeConsent,
} from './consent.ts'
export type { ConsentGap, ConsentRecord, ConsentStore, GrantOptions } from './consent.ts'
export { CONSENT_VERSION_NOTE, DISCLOSURE, DISCLOSURE_VERSION } from './disclosure.ts'
export type { Disclosure, DisclosureLine } from './disclosure.ts'
// BROW-10 — the disclosed byte figure, what it covers, and where it was read. Exported for
// one consumer and it is not a page: `colouring-demo.e2e.test.ts` has to hold the disclosed
// literal beside a real run of the task, and both sides of that comparison have to be
// obtainable independently or the guard proves nothing. `disclosure.ts` reaches the figure by
// relative import, so no surface depends on these being here.
export {
  DATA_COST_BAND,
  DATA_COST_COVERS,
  DATA_COST_MEASURED_ON,
  DISCLOSED_DATA_COST_BYTES,
} from './data-cost.ts'

// The visitor's enrolment decision — AUTH-01, AUTH-02, AUTH-04. The second explicit,
// revocable, persisted visitor decision in this package, and deliberately the same shape as
// the first: `enrolment-consent.ts`'s header states why it is a near-copy of `consent.ts`
// rather than a generalisation of it.
export {
  acceptEnrolment,
  ENROLMENT_KEY,
  GrantedEnrolment,
  readEnrolment,
  revokeEnrolment,
} from './enrolment-consent.ts'
export type { AcceptOptions, EnrolmentGap, EnrolmentRecord } from './enrolment-consent.ts'
// The visitor's own key — the one input an origin may not supply, held where the page that
// serves it cannot read it.
export {
  canHoldVisitorKey,
  forgetVisitorKey,
  InsecureOriginError,
  VISITOR_DB,
  visitorKeyPair,
  visitorOperatorId,
} from './visitor-key.ts'

// Stopping for real, and bounding an untrusted guest — BROW-04, SCHED-06.
// AUTH-03's browser half — chains minted in a tab, for a key the tab cannot read.
export { chainsForOwner, TAB_CHAIN_TTL_MS } from './dispatch-chain.ts'
export type { TabChainOptions } from './dispatch-chain.ts'

export { browserWorkerExecutor, WorkerExecutor } from './worker-executor.ts'
export type { BrowserWorkerExecutorOptions, WorkerFactory } from './worker-executor.ts'
export { domThread } from './dom-thread.ts'

// The blocking metric — BROW-02.
export { BROWSER_FAMILIES, browserLabel, currentBrowserLabel, identifyBrowser } from './browser-id.ts'
export type { BrowserFamily, BrowserId } from './browser-id.ts'
export { classifyStartError, firstGap, probeEnvironment } from './start-probe.ts'
export type { ProbeGlobals, StartEnvironment } from './start-probe.ts'

// Fetching and verifying a translated artifact, in the one shape V8 can cache — AOT-05.
//
// ## The two-visit code-cache measurement is NOT on this barrel — retired 2026-08-18
//
// `cacheVerdict`, `describeCacheVerdict` and `measureRepeatLoad` stood in the three lines
// this note replaces, and they are **retired from the barrel rather than deleted**: the
// declarations, their docblocks and `streaming-load.browser.test.ts`'s cases are all
// untouched, and the spec imports them module-relative, so nothing measured stops being
// measured. What stops is publishing them as capabilities of `@o2/browser`.
//
// The reason is the one this file already acts on for their five siblings.
// `CODE_CACHE_EVIDENCE`, `CODE_CACHE_BLIND_SPOTS`, `CODE_CACHE_HARNESSES`,
// `codeCacheHarnessFor` and `describeCodeCacheEvidence` are declared in the same module and
// deliberately kept off this list, because they are the *apparatus of a measurement* rather
// than something a page does to a visitor. These three are the same apparatus: a verdict
// needs two loads of one URL in one page, and the production path — `fetchModuleForDispatch`
// behind `#fetch-byo` — loads **once** and reports `cacheEligible` off the byte count.
// Wiring them would mean manufacturing a second load nobody asked for, which is inventing a
// measurement rather than wiring a capability.
//
// So this is the *"retiring the ones that are genuinely superseded"* half of Phase 22's
// stated closing condition, taken on an in-file precedent rather than on a count.
export {
  CACHE_CONFOUNDS,
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
  describeLoadFailure,
  gatewayUrl,
  loadArtifact,
  RAW_CODE,
  URL_DEFECTS,
  WASM_CONTENT_TYPE,
} from './streaming-load.ts'
// `CacheVerdict`, `CompilePair` and `RepeatMeasurement` left with the three functions
// above, in the same change and for the same reason: they are the *types of the
// measurement*, produced by nothing this barrel still publishes, and a type a consumer
// cannot obtain a value of is a published shape rather than a published capability.
// Nothing outside `streaming-load.ts` named any of the three — measured over `packages`
// and `tools` before they were removed, not assumed.
export type {
  CidDefect,
  FetchLike,
  LoadedArtifact,
  LoadFailure,
  LoadOptions,
  LoadResult,
  UrlDefect,
  UrlResult,
} from './streaming-load.ts'
