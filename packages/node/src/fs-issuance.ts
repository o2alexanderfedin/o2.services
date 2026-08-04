/**
 * The Node tier's durable issuance record — AUTH-04, criterion 5.
 *
 * ## What this protects, in the words the hole was found in
 *
 * Phase 17 measured `EnrollmentAuthority`'s aggregate budget and named its defect exactly:
 * **the budget was per provider *process*.** The history was a `Map` in the authority
 * object, so a restart handed the provider back everything it had already signed, and a
 * second provider process defeated the bound without so much as a second user key. This
 * file is where that history goes instead, so a provider that comes back is the same
 * provider with the same window already spent.
 *
 * It is **not** a per-identity price and no such price exists in this design. What it buys
 * is *a bound made durable* — issuance stays finite per provider per window, on a quantity
 * no request field can rotate around, and exhausting it survives the process. That
 * sentence is short on purpose; this repository has twice been burned by a mechanism whose
 * description outran its measurement.
 *
 * ## Where it lives, and why there
 *
 * `<dir>/.issuance`, beside `.identity.key` and `.provider.key`, carrying exactly the
 * authority the filesystem permissions on that directory already carry. **Not a wire
 * frame**: `serveAgent` serves enrolment unauthenticated, so a request that could clear an
 * issuance record would let any peer able to dial a provider hand its whole budget back —
 * the same argument the duty-cycle control file is placed by, and note which property of
 * `--dir` is being used. The keys live there because they are *secret*; this lives there
 * because it is *owned*.
 *
 * **The leading dot is not style.** `FsBlockstore.open`'s filter *is* the block counter,
 * so an undotted file in this directory is counted among the blocks — measured once
 * already, and recorded in `identity-store.ts` for this same directory.
 *
 * ## Synchronous, and that is a requirement rather than a preference
 *
 * `IssuanceLedger.record` is synchronous because `EnrollmentAuthority.enrol` is, and
 * `packages/net/src/agent.ts` records at its `enrol` branch that this is *why* that branch
 * takes no capacity slot. So the append here is `appendFileSync`: **the write syscall has
 * returned before `enrol` returns**, and therefore before the certificate could have been
 * encoded, let alone put on the wire. There is no window in which a provider has signed
 * something its record does not hold — not "a window that is usually lost", none. That
 * ordering is what makes the restart reading in `enrollment-cost.node.test.ts` mean
 * anything, and `fs-issuance.node.test.ts` asserts it directly rather than by racing it.
 *
 * **The honest bound on "durable", stated rather than implied:** nothing here calls
 * `fsync`. The record survives the process dying — the bytes are the kernel's before
 * `enrol` returns — and a power loss may still take the last entries with it. That is a
 * smaller claim than the one `fs-sovereign-cids.ts` makes for itself, deliberately, and it
 * is the one this file can support.
 *
 * ## What it costs
 *
 * One append per issued certificate, on a path that has just done an ed25519 signature and
 * two verifications. It is not the expensive step, and it is bounded below by nothing this
 * file can improve: the alternative is not remembering.
 *
 * ## Compaction, which is deliberately unlike a spend record
 *
 * An issuance timestamp older than the window **decides nothing** — both budgets filter to
 * the window before reading it — so it can safely be forgotten. A reader arriving from the
 * provider-issued-invitation design this plan replaced will expect the never-forget rule
 * that a *spend* record needs, and this is not that: a spent thing stays spent, an
 * expired issuance does not stay counted.
 *
 * So this compacts **on load and never on write**. On load, because that is once per
 * process and a rewrite there costs nothing measurable; on write, it would put an O(n)
 * rewrite on the enrolment path and would put the whole record at risk of a torn write
 * every time one certificate was signed. The rewrite goes through `.tmp-` + `rename`,
 * atomic within a directory on POSIX, so a process killed mid-compaction leaves the old
 * record rather than half of a new one.
 *
 * The retained window is handed in rather than assumed. `IssuanceLedger`'s own docblock
 * says pruning-for-decisions is the authority's, because a host that got `windowMs` wrong
 * would silently widen or narrow both budgets — so this reads
 * `DEFAULT_ISSUANCE_WINDOW_MS` from the same module the authority defaults from, through
 * its caller, and there is one number rather than two kept in step.
 *
 * ## This is not a node class
 *
 * `IdbIssuance` is the browser tier's counterpart and holds the same authority, the same
 * two budgets and the same refusals. Only the storage differs, exactly as it already does
 * for blocks, for the identity seed and for the sovereign-CID set. The one asymmetry — a
 * tab's write is durable a turn later, because IndexedDB has no synchronous API — is
 * stated and measured there rather than left for a reader to discover and mistake for a
 * capability difference.
 */

import { appendFileSync } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { IssuanceLedger, PublicKeyHex } from '@o2/core'

/** One issuance per line, `<millis> <userKey>`. Dot-prefixed — see this module's header. */
export const ISSUANCE_FILE = '.issuance'

export interface FsIssuanceOptions {
  /**
   * How far back entries are kept on load.
   *
   * Must be **at least** the authority's `windowMs`; both production sites pass
   * `DEFAULT_ISSUANCE_WINDOW_MS`, which is what that authority defaults to. Retaining more
   * than the window is harmless — the authority filters again — and retaining less would
   * hand a provider back part of its budget, which is the whole defect this file closes.
   */
  readonly retainMs: number
  /**
   * The instant compaction is measured from. A parameter rather than `Date.now()` so the
   * behaviour is deterministic in tests, exactly as `EnrollmentAuthority`'s clock is.
   */
  readonly now?: number
}

let tmpSeq = 0

export class FsIssuance implements IssuanceLedger {
  readonly #path: string
  readonly #byUser: Map<PublicKeyHex, number[]>
  readonly #anybody: number[]

  private constructor(path: string, entries: readonly Entry[]) {
    this.#path = path
    this.#byUser = new Map()
    this.#anybody = []
    for (const entry of entries) this.#remember(entry.userKey, entry.at)
  }

  /**
   * Read the record into memory, compacting what the window can no longer reach.
   *
   * Loaded eagerly and completely, because both budgets must be complete **before the
   * authority answers anything**: a provider that started answering while its history was
   * still arriving would issue against a budget it had not finished reading.
   *
   * A missing file is an empty record and not an error — a provider that has never signed
   * anything has nothing to remember, and treating that as a failure would stop every
   * fresh provider from starting.
   */
  static async open(dir: string, options: FsIssuanceOptions): Promise<FsIssuance> {
    await mkdir(dir, { recursive: true })
    const path = join(dir, ISSUANCE_FILE)
    const now = options.now ?? Date.now()

    let text: string | null = null
    try {
      text = await readFile(path, 'utf8')
    } catch (cause) {
      // Anything other than "not there" is a real failure and is not swallowed. A record
      // this provider cannot read is a record it would silently under-report, and
      // under-reporting here means signing certificates it has already signed the quota
      // for — which is the failure this file exists to make impossible.
      if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause
    }

    if (text === null) return new FsIssuance(path, [])

    const all = parse(text)
    const kept = all.filter((entry) => entry.at > now - options.retainMs)
    // Rewritten only when something was actually dropped, so an ordinary start does no
    // write at all. Atomic, so a process killed here leaves the previous record whole.
    if (kept.length !== all.length) {
      const tmp = join(dir, `.tmp-${String(process.pid)}-${String(tmpSeq++)}`)
      await writeFile(tmp, kept.map(render).join(''))
      await rename(tmp, path)
    }
    return new FsIssuance(path, kept)
  }

  /**
   * Every issue timestamp recorded for one user key, **unpruned**.
   *
   * Unpruned by contract: `IssuanceLedger` states that filtering to the window is the
   * authority's, because a ledger that filtered would need to hold the authority's policy
   * and a host that got it wrong would move a budget with nothing failing. Compaction on
   * load is a different thing from filtering on read — see this module's header.
   */
  issuedTo(userKey: PublicKeyHex): readonly number[] {
    return this.#byUser.get(userKey) ?? []
  }

  /** Every issue timestamp recorded for anybody, unpruned. See {@link issuedTo}. */
  issuedToAnybody(): readonly number[] {
    return this.#anybody
  }

  /**
   * Record one issuance, on disk before this returns.
   *
   * The append happens **before** the in-memory maps are updated, so the two cannot end up
   * with the file behind the memory. If the append throws, the entry is still remembered
   * for this process — a running provider that cannot write is still bound by what it has
   * signed — and the throw is then let go rather than swallowed: a provider whose record
   * has stopped being written has lost the property this file exists to give it, and
   * carrying on quietly is exactly the pre-plan behaviour.
   */
  record(userKey: PublicKeyHex, at: number): void {
    try {
      appendFileSync(this.#path, render({ userKey, at }))
    } finally {
      this.#remember(userKey, at)
    }
  }

  /** How many issuances are recorded. For tests and for anyone sizing the growth. */
  get size(): number {
    return this.#anybody.length
  }

  #remember(userKey: PublicKeyHex, at: number): void {
    const existing = this.#byUser.get(userKey)
    if (existing === undefined) this.#byUser.set(userKey, [at])
    else existing.push(at)
    this.#anybody.push(at)
  }
}

interface Entry {
  readonly userKey: PublicKeyHex
  readonly at: number
}

function render(entry: Entry): string {
  return `${String(entry.at)} ${entry.userKey}\n`
}

/**
 * Read the record, skipping any line that is not one.
 *
 * A line this build cannot read is dropped rather than throwing, and the direction is
 * deliberate: the alternative is a provider that refuses to start because one byte of its
 * own history was torn, and a provider that will not start is a provider that issues
 * nothing at all. A dropped line costs at most one certificate's worth of budget, which is
 * the same exposure a deleted directory already carries.
 */
function parse(text: string): readonly Entry[] {
  const entries: Entry[] = []
  for (const line of text.split('\n')) {
    const space = line.indexOf(' ')
    if (space <= 0) continue
    const at = Number(line.slice(0, space))
    const userKey = line.slice(space + 1).trim()
    if (!Number.isFinite(at) || userKey.length === 0) continue
    entries.push({ userKey, at })
  }
  return entries
}
