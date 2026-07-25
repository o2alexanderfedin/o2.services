/**
 * `@o2/browser` — the browser adapters.
 *
 * Mirrors `@o2/node`: everything here needs a DOM or a browser storage API, so it
 * is kept out of the portable packages. `purity.node.test.ts` enforces that
 * separation in the other direction.
 */

export { IdbBlockstore } from './idb-blockstore.ts'
export { BrowserNode } from './browser-node.ts'
export type { BrowserNodeOptions } from './browser-node.ts'
export type { TabAddresses, TabApi, TabJobReport } from './tab-api.ts'
