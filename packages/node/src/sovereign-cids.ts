/**
 * The Node tier's durable sovereign-CID set — DATA-10, criterion 7's at-rest half.
 *
 * ## What this closes
 *
 * Before it, a node that came to hold another owner's raw row served those bytes to any
 * peer that asked, as soon as the job that registered them finished. `EgressGuard`'s
 * registration is job-scoped and given back in a `finally`, for a reason that is correct
 * about `EgressGuard` and does not reach this question — see `SovereignCids` in
 * `@o2/net`, which states why a byte-scan and a CID lookup want different lifetimes.
 *
 * ## The file
 *
 * One CID per line, appended, under the directory the node was already handed. Read once
 * at `open`, kept in memory, appended on every new CID — so `has` costs a hash lookup on
 * the `block` branch's hot path and `add` costs one append.
 *
 * **The leading dot is not style.** `FsBlockstore.open` counts every non-dot entry in the
 * directory as a block, so an undotted file here would inflate `size` — the rule
 * `identity-store.ts` already carries, for the same directory.
 *
 * **Append, not rewrite.** A rewrite of the whole set on every add would make the cost of
 * recording one CID grow with the number already recorded, and would put the entire set at
 * risk of a torn write. An append that fails leaves every previously recorded CID intact.
 *
 * ## Durability, and the honest limit
 *
 * `add` resolves after the append has been flushed, so a node that recorded a CID and then
 * lost power comes back still refusing it. What it does **not** survive is deletion of the
 * directory — a node whose `blockstoreDir` is removed loses this set exactly as it loses
 * its identity and its blocks. That is the same exposure `idb-identity-store.ts` records
 * for the browser, and it is a property of the storage rather than of the node.
 */
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { SovereignCids } from '@o2/net'

/** One CID per line. Dot-prefixed — see this module's header. */
export const SOVEREIGN_CIDS_FILE = '.sovereign-cids'

export class FsSovereignCids implements SovereignCids {
  readonly #path: string
  readonly #known: Set<string>

  private constructor(path: string, known: Set<string>) {
    this.#path = path
    this.#known = known
  }

  /**
   * Read the set into memory, creating neither the file nor an entry.
   *
   * A missing file is an empty set and not an error: a node that has never held a
   * sovereign row has nothing to record, and treating that as a failure would make every
   * fresh node refuse to start.
   */
  static async open(dir: string): Promise<FsSovereignCids> {
    await mkdir(dir, { recursive: true })
    const path = join(dir, SOVEREIGN_CIDS_FILE)
    let known = new Set<string>()
    try {
      const text = await readFile(path, 'utf8')
      known = new Set(
        text
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.length > 0),
      )
    } catch (cause) {
      // Anything other than "not there" is a real failure and is not swallowed: a set
      // this node cannot read is a set it would silently under-report, and under-reporting
      // here means serving a sovereign row.
      if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause
    }
    return new FsSovereignCids(path, known)
  }

  async add(cid: string): Promise<void> {
    if (this.#known.has(cid)) return
    // The append happens BEFORE the in-memory set is updated, so a failed write leaves
    // this node reporting the CID as unknown rather than reporting it as recorded when it
    // is not. Of the two wrong answers that is the one that fails loudly on the next
    // start, and the other would be a node that believes it is guarding something it did
    // not write down.
    await appendFile(this.#path, `${cid}\n`)
    this.#known.add(cid)
  }

  has(cid: string): boolean {
    return this.#known.has(cid)
  }

  /** How many CIDs are recorded. For tests and for anyone sizing the growth. */
  get size(): number {
    return this.#known.size
  }
}
