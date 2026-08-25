import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { BaseDatastore } from 'datastore-core'
import { Key } from 'interface-datastore'
import type { KeyQuery, Pair, Query } from 'interface-datastore'
import { base32 } from 'multiformats/bases/base32'

/**
 * A libp2p datastore that survives a restart — DATA-08.
 *
 * ## Why this exists rather than `datastore-level`
 *
 * The obvious answer is a published package, and it was tried first. `datastore-level@13`
 * and a hand-written predecessor of this file both hung this fabric's enrolment RPC, and
 * that produced a recorded claim — *"any datastore whose operations are asynchronous hangs
 * enrolment"* — which is **false**, measured on 2026-08-23 against the very specs that
 * failed: an in-memory store proxied to await a macrotask before every operation, to
 * serialize every operation behind one queue, to yield lazily inside `query`, and to throw
 * an unmapped storage-layer error, enrols fine in all four shapes. Neither asynchrony,
 * latency, laziness, serialization nor error type is the cause.
 *
 * That left a narrower question than the one the register carried for a week — *what did
 * those two implementations do?* — and a cheaper way past it: this store, whose whole
 * surface is small enough to read.
 *
 * ## The design, and each decision is one somebody would otherwise re-litigate
 *
 * **Synchronous `node:fs`, deliberately.** Not because asynchrony is dangerous — it is
 * measurably not — but because a peer store is a few dozen small values and every async
 * boundary is a chance for an ordering nobody reasoned about. `writeFileSync` on a
 * kilobyte is a microsecond-scale call; the concurrency it buys back is not worth spending.
 * The interface permits it: every method's return type is `T | Promise<T>`.
 *
 * **One file per key, flat.** Keys here are `/peers/<id>`-shaped and few. A tree would buy
 * nothing and would need directory creation on every write.
 *
 * **Base32 file names.** Not percent-encoding and not base64url, both of which preserve
 * case. **APFS is case-insensitive by default**, and libp2p keys carry mixed-case base58
 * peer IDs, so two keys differing only in case would silently become one file on the
 * platform this repository is developed on and stay distinct in CI. Base32 as multiformats
 * spells it is lowercase-only, so the question cannot arise.
 *
 * **Write-then-rename.** `rename` within a directory is atomic, so a reader never sees a
 * half-written value and a crash mid-write leaves the previous one intact. The same shape
 * `FsBlockstore` uses, for the same reason.
 */
export class FsDatastore extends BaseDatastore {
  readonly #dir: string

  constructor(dir: string) {
    super()
    this.#dir = dir
    mkdirSync(dir, { recursive: true })
  }

  /** A key as a file name. See the class doc for why base32 and not something shorter. */
  #pathFor(key: Key): string {
    return join(this.#dir, base32.encode(new TextEncoder().encode(key.toString())))
  }

  override put(key: Key, val: Uint8Array): Key {
    const target = this.#pathFor(key)
    // A temp name in the SAME directory: `rename` is only atomic within a filesystem, and
    // a system temp dir is frequently a different one.
    const staging = `${target}.tmp`
    writeFileSync(staging, val)
    renameSync(staging, target)
    return key
  }

  /**
   * **`async`, and this is the one method where that is not a style choice.**
   *
   * The interface types every method `T | Promise<T>`, so a synchronous return is
   * permitted — and for a hit it is what this does, since `readFileSync` on a small value
   * costs microseconds. But a **miss** must reach the caller as a *rejected promise* and
   * not as a synchronous throw: a caller written as `store.get(k).catch(…)` never enters
   * its handler when the call throws before returning, and the exception escapes to
   * whatever is above it. `async` makes both paths a promise, so the two cannot differ.
   *
   * Found by the first run of this file's own miss case, which is why the case is written
   * as `rejects` rather than as a `try`/`catch` — the latter would have passed either way
   * and proved nothing.
   */
  override async get(key: Key): Promise<Uint8Array> {
    try {
      return new Uint8Array(readFileSync(this.#pathFor(key)))
    } catch (cause) {
      // The interface's own miss, not the filesystem's. libp2p branches on this, and a
      // raw ENOENT reaching a caller that expected a `NotFoundError` is the shape of bug
      // this store is small enough to not have.
      throw Object.assign(new Error(`Not Found: ${key.toString()}`), {
        name: 'NotFoundError',
        code: 'ERR_NOT_FOUND',
        cause,
      })
    }
  }

  override has(key: Key): boolean {
    try {
      statSync(this.#pathFor(key))
      return true
    } catch {
      return false
    }
  }

  override delete(key: Key): void {
    rmSync(this.#pathFor(key), { force: true })
  }

  *#pairs(): Generator<Pair> {
    for (const name of readdirSync(this.#dir)) {
      // A staging file is a write in flight, not a value. Yielding one would hand a caller
      // bytes that are about to be replaced and a key that does not decode.
      if (name.endsWith('.tmp')) continue
      let key: Key
      try {
        key = new Key(new TextDecoder().decode(base32.decode(name)))
      } catch {
        // A file this store did not write. Skipped rather than thrown on: a query is a
        // read of what is here, and one foreign file must not make the whole store
        // unreadable.
        continue
      }
      try {
        yield { key, value: new Uint8Array(readFileSync(join(this.#dir, name))) }
      } catch {
        // Deleted between the listing and the read. An ordinary race on a live store.
      }
    }
  }

  override *_all(_q: Query): Generator<Pair> {
    yield* this.#pairs()
  }

  override *_allKeys(_q: KeyQuery): Generator<Key> {
    for (const pair of this.#pairs()) yield pair.key
  }
}
