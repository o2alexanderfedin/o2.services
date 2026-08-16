import { deleteDB } from 'idb'
import { DEFAULT_ISSUANCE_WINDOW_MS, EnrollmentAuthority, requestEnrollment } from '@o2/core'
import { afterEach, describe, expect, it } from 'vitest'
import { IdbIssuance } from './idb-issuance.ts'

/**
 * AUTH-04, browser side — the same mechanism, the one storage a tab has.
 *
 * **This is not a second kind of node.** Both tiers hold the same authority, the same two
 * budgets and the same refusals; what differs is where a durable record is kept, exactly
 * as it already differs for blocks (`FsBlockstore` / `IdbBlockstore`), for the identity
 * seed, and for the sovereign-CID set. `enrollment.ts`'s own header states the rule this
 * file is held to: all nodes have equal functionality, and only discovery differs.
 *
 * ## The one honest asymmetry, measured here rather than mentioned
 *
 * `IssuanceLedger.record` is **synchronous** — `packages/net/src/agent.ts` records that
 * `EnrollmentAuthority.enrol` being fully synchronous is *why* its `enrol` branch takes no
 * capacity slot — and IndexedDB has no synchronous API. So on this tier the record becomes
 * durable **one turn later**, where the Node tier's append has already returned.
 *
 * The exposure that buys is *at most the issuances made since the last turn of the event
 * loop*, because a write is scheduled on every single `record` rather than batched. A tab
 * answering one enrolment frame at a time therefore risks **one**. That bound is asserted
 * below, not asserted-about: an unstated asymmetry is how a reader six months from now
 * invents a node class out of a storage API.
 *
 * **What is not bounded, and is not this file's to bound:** IndexedDB is evicted silently
 * under storage pressure, so a tab that loses this database comes back having forgotten
 * what it signed. That is the same exposure `idb-sovereign-cids.ts` and
 * `idb-identity-store.ts` already record for the browser, it is a property of the
 * browser's storage rather than of the browser as a node, and it is **unmeasured**.
 */

const USER_A = 'a'.repeat(64)
const USER_B = 'b'.repeat(64)

/** A fixed instant. Nothing here reads a real clock. */
const NOW = 1_800_000_000_000

let dbNames: string[] = []
let seq = 0

function freshName(): string {
  // A unique database per case: IndexedDB is origin-scoped and outlives a test in the
  // same page, so a shared name would leak one reading into the next.
  const name = `o2-issuance-${String(seq++)}`
  dbNames.push(name)
  return name
}

afterEach(async () => {
  const names = dbNames
  dbNames = []
  for (const name of names) await deleteDB(name).catch(() => {})
})

describe('AUTH-04 — a tab that reloads has not been handed its budget back', () => {
  /**
   * The browser tier's restart: a genuinely new store object over the same database, which
   * is what a visitor closing the tab and coming back produces.
   *
   * Reddened by holding the timestamps only in memory — the second `open` reports an empty
   * history and a fresh full budget, which is the pre-plan behaviour on both tiers.
   */
  it('reports on reopen everything it recorded before', async () => {
    const name = freshName()
    const first = await IdbIssuance.open(name, {
      retainMs: DEFAULT_ISSUANCE_WINDOW_MS,
      now: NOW,
    })
    first.record(USER_A, NOW - 10)
    first.record(USER_B, NOW - 5)
    first.record(USER_A, NOW)
    await first.whenDurable()
    first.close()

    const reopened = await IdbIssuance.open(name, {
      retainMs: DEFAULT_ISSUANCE_WINDOW_MS,
      now: NOW,
    })
    try {
      expect(reopened.issuedTo(USER_A)).toEqual([NOW - 10, NOW])
      expect(reopened.issuedTo(USER_B)).toEqual([NOW - 5])
      expect(reopened.issuedToAnybody()).toEqual([NOW - 10, NOW - 5, NOW])
    } finally {
      reopened.close()
    }
  }, 30_000)

  /**
   * The same reading through a real `EnrollmentAuthority`, so the refusal — and not only
   * the array — is what survives the reload.
   */
  it('refuses by name after a reload, with the aggregate budget already spent', async () => {
    const name = freshName()
    const spender = await IdbIssuance.open(name, { retainMs: DEFAULT_ISSUANCE_WINDOW_MS, now: NOW })
    const before = new EnrollmentAuthority({
      providerPrivateKey: new Uint8Array(32).fill(0xd9),
      maxPerWindow: 100,
      maxIssuedPerWindow: 2,
      issuance: spender,
    })

    for (let i = 1; i <= 2; i++) {
      const request = await requestEnrollment(
        new Uint8Array(32).fill(i),
        new Uint8Array(32).fill(i + 40),
        { operatorId: 'tab-ops', discoverability: 'via-relay', relayIds: ['relay-1'] },
      )
      expect(before.enrol(request, NOW).ok).toBe(true)
    }
    await spender.whenDurable()
    spender.close()

    const reopened = await IdbIssuance.open(name, {
      retainMs: DEFAULT_ISSUANCE_WINDOW_MS,
      now: NOW,
    })
    try {
      const after = new EnrollmentAuthority({
        providerPrivateKey: new Uint8Array(32).fill(0xd9),
        maxPerWindow: 100,
        maxIssuedPerWindow: 2,
        issuance: reopened,
      })
      const refused = after.enrol(
        await requestEnrollment(new Uint8Array(32).fill(9), new Uint8Array(32).fill(49), {
          operatorId: 'tab-ops',
          discoverability: 'via-relay',
          relayIds: ['relay-1'],
        }),
        NOW,
      )
      expect(refused.ok).toBe(false)
      if (refused.ok) return
      expect(refused.refusal.kind).toBe('issuance-budget-exhausted')
    } finally {
      reopened.close()
    }
  }, 30_000)
})

describe('AUTH-04 — the browser tier’s durability gap is one issuance, and it is stated', () => {
  /**
   * The bound written down as an assertion rather than as a caveat.
   *
   * A write is scheduled on **every** `record`, so what is not yet durable at any instant
   * is exactly what was recorded since the last turn. Answering one enrolment frame at a
   * time — which is what `serveAgent` does — that is one.
   *
   * Reddened by batching: with writes flushed every N records, `outstanding` climbs past
   * one and the reopen below reports fewer entries than were recorded, so the assertion
   * names the count rather than leaving the gap unstated.
   */
  it('never holds more than one issuance undurable when it answers one at a time', async () => {
    const name = freshName()
    const ledger = await IdbIssuance.open(name, { retainMs: DEFAULT_ISSUANCE_WINDOW_MS, now: NOW })
    try {
      for (let i = 0; i < 4; i++) {
        ledger.record(USER_A, NOW - i)
        expect(ledger.outstanding).toBe(1)
        await ledger.whenDurable()
        expect(ledger.outstanding).toBe(0)

        // Durable *now*, not eventually: a fresh store over the same database sees it.
        const witness = await IdbIssuance.open(name, {
          retainMs: DEFAULT_ISSUANCE_WINDOW_MS,
          now: NOW,
        })
        try {
          expect(witness.issuedToAnybody()).toHaveLength(i + 1)
        } finally {
          witness.close()
        }
      }
    } finally {
      ledger.close()
    }
  }, 30_000)

  /**
   * The in-memory answer is authoritative for the authority **immediately**, gap or no gap.
   *
   * This is what stops the asymmetry becoming a capability difference: a tab's *running*
   * budget is exact from the instant it signs, exactly as the Node tier's is. Only what a
   * reload would recover lags, and only by the turn measured above.
   */
  it('counts an issuance against the budget before the write has resolved', async () => {
    const name = freshName()
    const ledger = await IdbIssuance.open(name, { retainMs: DEFAULT_ISSUANCE_WINDOW_MS, now: NOW })
    try {
      ledger.record(USER_A, NOW)
      expect(ledger.issuedToAnybody()).toEqual([NOW])
      expect(ledger.issuedTo(USER_A)).toEqual([NOW])
      expect(ledger.outstanding).toBe(1)
      await ledger.whenDurable()
    } finally {
      ledger.close()
    }
  }, 30_000)
})

describe('AUTH-04 — one origin, several independent nodes', () => {
  /**
   * `IdbSovereignCids`'s suffix convention, applied here for the same reason it exists
   * there: one origin can hold several independent nodes, and two of them sharing a budget
   * would make each one's refusals a statement about the other.
   */
  it('keeps two stores on one origin apart', async () => {
    const mine = await IdbIssuance.open(freshName(), {
      retainMs: DEFAULT_ISSUANCE_WINDOW_MS,
      now: NOW,
    })
    const theirs = await IdbIssuance.open(freshName(), {
      retainMs: DEFAULT_ISSUANCE_WINDOW_MS,
      now: NOW,
    })
    try {
      mine.record(USER_A, NOW)
      await mine.whenDurable()
      expect(theirs.issuedToAnybody()).toEqual([])
      expect(theirs.issuedTo(USER_A)).toEqual([])
    } finally {
      mine.close()
      theirs.close()
    }
  }, 30_000)
})

describe('AUTH-04 — compaction on load, on this tier too', () => {
  /**
   * An entry older than the retained window decides nothing, because both budgets filter
   * to the window before reading it. Dropping it on load is what keeps a long-lived tab's
   * database proportional to one window rather than to its whole history.
   *
   * Deliberately unlike a spend record, which can never be forgotten — the same sentence
   * `fs-issuance.ts` carries, because a reader will meet whichever tier they meet first.
   */
  it('drops what the window can no longer reach, and keeps what it can', async () => {
    const name = freshName()
    const windowMs = 60_000
    const writer = await IdbIssuance.open(name, { retainMs: windowMs, now: NOW })
    writer.record(USER_A, NOW - windowMs * 3)
    writer.record(USER_A, NOW - 1_000)
    await writer.whenDurable()
    writer.close()

    const compacted = await IdbIssuance.open(name, { retainMs: windowMs, now: NOW })
    try {
      expect(compacted.issuedToAnybody()).toEqual([NOW - 1_000])
      expect(compacted.issuedTo(USER_A)).toEqual([NOW - 1_000])
    } finally {
      compacted.close()
    }

    // The rewrite stuck: the dropped entry does not come back on the next open.
    const again = await IdbIssuance.open(name, { retainMs: windowMs, now: NOW })
    try {
      expect(again.issuedToAnybody()).toEqual([NOW - 1_000])
    } finally {
      again.close()
    }
  }, 30_000)
})
