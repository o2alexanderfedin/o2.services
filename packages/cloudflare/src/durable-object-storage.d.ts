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
 * ## Compatibility with the real declaration is MEASURED, not argued
 *
 * This block read *"reasoned, not compiled"* until 2026-08-25, when the probe that would
 * settle it was actually run — **by the adversary review of this package, not by this
 * file's author**, and it is recorded with that attribution because a measurement nobody
 * here took is not this file's to claim. `@cloudflare/workers-types@5.20260825.1` was
 * installed in a scratchpad and a probe compiled under this repository's own flags:
 *
 * ```
 * const asLocal: DurableObjectStorage = state.storage   // real DurableObjectState
 * new DoDatastore(state.storage)
 *                                                       EXIT=0
 * ```
 *
 * Anti-vacuity was confirmed in the same probe — it errors `TS2322` when the target type is
 * wrong and `TS2741` against an interface carrying an extra member — so the real
 * declaration genuinely resolved rather than the check passing over nothing.
 *
 * **Assignability is version-relative.** That result binds `5.20260825.1` and nothing else.
 * Whoever installs the package for real — the Durable Object class itself, Phase 29
 * criteria 2 and 7 — should keep a `const _: DurableObjectStorage = state.storage` line in
 * the tree so the next version that widens a signature fails a compile instead of a deploy.
 * That is the reason this interface stays here rather than being deleted in favour of the
 * dependency: it is one line to check and a whole platform to import.
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

/**
 * The alarm half of the platform's storage API — the whole of what `expiry-alarm.ts` uses.
 *
 * Separate from {@link DurableObjectStorage} rather than merged into it, because the two
 * are used by different things and merging them would put alarms into `DoDatastore`'s
 * fixture, which does not arm any. The real platform object carries both, so a caller that
 * needs both declares a parameter of both types and the same `state.storage` satisfies it.
 *
 * `getAlarm()` answers `null` when none is scheduled — the platform's own spelling, and the
 * distinction the arming path reads: an alarm that is already set must not be pushed
 * forward on every request, or a busy object never sweeps.
 */
export interface DurableObjectAlarms {
  getAlarm(): Promise<number | null>
  setAlarm(scheduledTime: number): Promise<void>
}
