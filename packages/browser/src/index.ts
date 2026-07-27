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
