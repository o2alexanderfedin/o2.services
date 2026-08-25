/**
 * The exact slice of Cloudflare's Durable Object storage API that `DoDatastore` uses.
 *
 * ## Why a declaration here rather than `@cloudflare/workers-types`
 *
 * The package is **not installed** — `ls node_modules/@cloudflare/` reports no such
 * directory as of 2026-08-25 — and adding it would buy a ~1 MB `.d.ts` that declares the
 * whole Workers platform (Fetcher, R2, KV, Queues, WebSocketPair, the lot) in exchange for
 * four method signatures. It would also be a `types` entry every other package in this
 * workspace has to keep out of its own compilation, because the root `tsconfig.json`
 * declares `"types": ["node"]` for the whole tree and Workers' globals contradict Node's in
 * several places (`caches`, `crypto`, `WebSocket`).
 *
 * The cost of declaring it here instead is stated rather than hidden: **structural
 * compatibility with the real `DurableObjectStorage` is reasoned, not compiled.** Nothing
 * in this repository proves a real `DurableObjectState['storage']` is assignable to the
 * interface below, because there is no real declaration present to check it against. The
 * reasoning is that each real member is *wider* than the one declared here — the real `get`
 * is `get<T>(key, options?): Promise<T | undefined>`, and instantiating `T` at its
 * `unknown` constraint gives exactly `Promise<unknown>`; the real `put` and `list` are
 * generic and optioned in the same way; the real `delete` is overloaded and one overload
 * matches. A signature with extra optional parameters is assignable to one with fewer.
 *
 * **The check that would settle it** is `@cloudflare/workers-types` installed and one
 * `const _: DurableObjectStorage = realState.storage` line. That is a dependency decision
 * for whoever wires the Durable Object itself (Phase 29 criteria 2 and 7), not for the
 * storage binding, and it is recorded as the known-weak seam of this file.
 *
 * ## Deliberately narrower than the platform
 *
 * Only `prefix` is declared on the list options, because only `prefix` is used. Declaring
 * `start`/`end`/`reverse`/`limit` and not using them would put four behaviours into the
 * fake in this package's spec that nothing exercises — and a fake that implements more than
 * the class under test can ask for is a fake nobody has checked.
 *
 * This is a module, not an ambient declaration, so that the day `@cloudflare/workers-types`
 * *is* installed these names do not collide with the global ones.
 */

/** The subset of `DurableObjectListOptions` this package uses. */
export interface DurableObjectListOptions {
  /** Keys are listed by `String.prototype.startsWith` against this. */
  readonly prefix?: string
}

/**
 * The subset of `DurableObjectStorage` this package uses.
 *
 * `get` and `list` answer `unknown` rather than a caller-chosen generic on purpose. The
 * real API's `get<T>` lets the caller *name* a type nothing ever checks — a type assertion
 * wearing a type parameter — and this repository forbids assertions. `unknown` forces the
 * one runtime check that is actually true of the storage layer: it holds whatever was
 * structured-cloned into it, and `DoDatastore` must prove a value is bytes before returning
 * it as bytes.
 */
export interface DurableObjectStorage {
  get(key: string): Promise<unknown>
  put(key: string, value: Uint8Array): Promise<void>
  delete(key: string): Promise<boolean>
  list(options?: DurableObjectListOptions): Promise<Map<string, unknown>>
}
