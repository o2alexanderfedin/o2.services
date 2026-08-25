import type { DurableObjectListOptions, DurableObjectStorage } from './durable-object-storage.d.ts'

/**
 * A complete in-process implementation of {@link DurableObjectStorage}.
 *
 * **Complete, not partial.** Every member of the interface is implemented with real
 * behaviour; nothing throws `not implemented` and nothing is a stub that returns a fixed
 * value. That is possible only because the interface was declared as narrowly as
 * `DoDatastore` actually uses it — a fake of the whole platform surface could not honestly
 * claim this.
 *
 * ## The two asymmetries, which are the point
 *
 * **`put` clones; `get` does not.** Both halves model something real, and they model
 * *different* things:
 *
 * - A write to Durable Object storage is unconditionally a serialisation — the value has to
 *   reach SQLite — so the store can never hold the caller's object. Cloning on `put` is the
 *   faithful behaviour and there is no second case.
 * - A read is served from the isolate's cache when the value is still resident and from a
 *   deserialisation when it is not. Two behaviours, and this fake picks the **weaker** one:
 *   it returns the stored object by reference. A fake that cloned on read would make a
 *   missing defensive copy in `DoDatastore.get` invisible — the aliasing spec would pass
 *   against the fake and the bug would ship. Modelling the worse of two real behaviours is
 *   what lets a spec prove the store is safe under both.
 *
 * `structuredClone` is used for the write rather than a hand-rolled `Uint8Array` copy so
 * that a value which is *not* bytes round-trips the way the platform would handle it too.
 * It is a global in Node ≥17 and in every browser this repository's `browser` project runs.
 *
 * ## What it records
 *
 * {@link listCalls} exists because "the prefix was pushed down to the storage layer" is a
 * claim about a call that has no other observable effect — `BaseDatastore.query` re-filters
 * by the same prefix, so a store that listed everything and let the base class sort it out
 * would return byte-identical results. Without this the optimisation is untestable and the
 * assertion would be measuring the base class instead.
 */
export class FakeDurableObjectStorage implements DurableObjectStorage {
  readonly #values = new Map<string, unknown>()

  /** Every `list` option object this fake was handed, in call order. */
  readonly listCalls: (DurableObjectListOptions | undefined)[] = []

  /**
   * What the store holds, by reference, for assertions the interface cannot express — the
   * byte length actually written, or that a refused `put` wrote nothing.
   *
   * Not part of {@link DurableObjectStorage}; a spec reaching for it is stepping outside
   * the API on purpose.
   */
  inspect(key: string): unknown {
    return this.#values.get(key)
  }

  /** How many keys the store holds. */
  get size(): number {
    return this.#values.size
  }

  async get(key: string): Promise<unknown> {
    // By reference, deliberately — see the class doc.
    return this.#values.get(key)
  }

  async put(key: string, value: Uint8Array): Promise<void> {
    // A write is a serialisation on the real platform; it cannot keep the caller's object.
    this.#values.set(key, structuredClone(value))
  }

  /** Seeds a value the datastore itself could not write. Not part of the interface. */
  putRaw(key: string, value: unknown): void {
    this.#values.set(key, structuredClone(value))
  }

  async delete(key: string): Promise<boolean> {
    return this.#values.delete(key)
  }

  async list(options?: DurableObjectListOptions): Promise<Map<string, unknown>> {
    this.listCalls.push(options)
    const prefix = options?.prefix
    const listed = new Map<string, unknown>()
    // Lexicographic by key, which is the order a SQLite scan of a string-keyed table
    // produces. Sorting here rather than relying on Map insertion order stops a spec from
    // passing because of the order this fake happened to be written to.
    for (const name of [...this.#values.keys()].sort()) {
      if (prefix !== undefined && !name.startsWith(prefix)) continue
      listed.set(name, this.#values.get(name))
    }
    return listed
  }
}
