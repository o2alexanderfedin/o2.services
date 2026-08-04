import { readFileSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ed25519 } from '@noble/curves/ed25519.js'
import { DEFAULT_ISSUANCE_WINDOW_MS, EnrollmentAuthority, requestEnrollment, toHex } from '@o2/core'
import type { EnrollmentResult } from '@o2/core'
import { SEED_BYTES } from '@o2/libp2p'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FsBlockstore } from './fs-blockstore.ts'
import { FsIssuance, ISSUANCE_FILE } from './fs-issuance.ts'

/**
 * AUTH-04 — the issuance record that outlives the process, at unit scale.
 *
 * ## What this file is for, and what it is not
 *
 * `enrollment-cost.node.test.ts` is the criterion's measurement: real `bin/agent.ts`
 * processes, a provider stopped and restarted, a refusal read off a spawned child. This
 * file is the layer under it, and it exists because three of the properties that
 * measurement rests on are **invisible from outside a process**:
 *
 * 1. the record survives the object that wrote it, which is what a restart tests;
 * 2. the append is **synchronous and complete before `enrol` returns**, which is what
 *    makes "the certificate never reached the wire before the record reached the disk"
 *    a statement about ordering rather than about a race that usually goes the right way;
 * 3. compaction on load drops only entries that can no longer decide anything, so a
 *    long-lived provider's file stays proportional to one window rather than to its
 *    whole history — **without either budget silently widening**.
 *
 * A spawned child can be observed to refuse. It cannot be observed to have written before
 * it replied, and it cannot be observed to have pruned without widening.
 *
 * **No wall-clock claim appears anywhere in this file.** Every clock is a parameter; the
 * authority takes `now` as an argument for exactly that reason.
 */

const USER_A = toHex(ed25519.getPublicKey(new Uint8Array(SEED_BYTES).fill(0xc1)))
const USER_B = toHex(ed25519.getPublicKey(new Uint8Array(SEED_BYTES).fill(0xc2)))

/** A fixed instant. Nothing here reads a real clock. */
const NOW = 1_800_000_000_000

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'o2-issuance-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

/** A provider authority over one ledger, with both budgets stated. */
function authorityOver(
  issuance: FsIssuance,
  maxIssuedPerWindow: number,
  maxPerWindow = 100,
): EnrollmentAuthority {
  return new EnrollmentAuthority({
    providerPrivateKey: new Uint8Array(SEED_BYTES).fill(0xc9),
    maxPerWindow,
    maxIssuedPerWindow,
    issuance,
  })
}

/**
 * One enrolment request, signed for real.
 *
 * A real `requestEnrollment` rather than a hand-built object, because `enrol` verifies
 * both signatures before it consults either budget — a fixture that faked them would
 * measure the refusal path and never reach the one this file is about.
 */
function enrolOnce(
  authority: EnrollmentAuthority,
  nodeSeedByte: number,
  userSeedByte: number,
  at: number,
): EnrollmentResult {
  return authority.enrol(
    requestEnrollment(
      new Uint8Array(SEED_BYTES).fill(nodeSeedByte),
      new Uint8Array(SEED_BYTES).fill(userSeedByte),
      { operatorId: 'issuance-ops', discoverability: 'seed', relayIds: [] },
    ),
    at,
  )
}

describe('AUTH-04 — the budget survives the object that spent it', () => {
  /**
   * The load-bearing reading of the whole plan, taken at unit scale.
   *
   * Reddened by holding the timestamps only in memory: the second construction issues a
   * full fresh budget, which is precisely the pre-plan behaviour and precisely Phase 17's
   * second finding — *"the budget was per provider process"*.
   *
   * The user keys are **distinct on every request**, so the per-user limiter is not what
   * refuses. That is the whole point of the aggregate budget: a fresh user key is one
   * `ed25519.keygen()` and bounds nothing.
   */
  it('refuses on reconstruction from the same directory, having forgotten nothing', async () => {
    const first = await FsIssuance.open(dir, { retainMs: DEFAULT_ISSUANCE_WINDOW_MS, now: NOW })
    const spender = authorityOver(first, 3)

    for (let i = 1; i <= 3; i++) {
      expect(enrolOnce(spender, i, i + 40, NOW).ok, `request ${String(i)}`).toBe(true)
    }
    expect(spender.issuedToAnybodyWithin(NOW)).toBe(3)

    // The object is dropped. Nothing is handed from one to the other but the directory.
    const second = await FsIssuance.open(dir, { retainMs: DEFAULT_ISSUANCE_WINDOW_MS, now: NOW })
    const restarted = authorityOver(second, 3)
    expect(restarted.issuedToAnybodyWithin(NOW)).toBe(3)

    const after = enrolOnce(restarted, 9, 49, NOW)
    expect(after.ok).toBe(false)
    if (after.ok) return
    expect(after.refusal.kind).toBe('issuance-budget-exhausted')
    // The refusal names the provider's own bound and nobody's user key — the reason that
    // refusal is its own kind rather than a second `rate-limited`.
    expect(after.refusal).toMatchObject({ limit: 3, windowMs: DEFAULT_ISSUANCE_WINDOW_MS })
    expect(after.reason).not.toContain(USER_A)
  })

  /**
   * The control that stops the reading above being about a fresh directory.
   *
   * A ledger opened over a *different* directory is a different provider's record and
   * starts empty — which is correct, and is asserted here so the restart reading is
   * demonstrably about one provider's memory rather than about ledgers in general.
   */
  it('does not read another directory', async () => {
    const mine = await FsIssuance.open(dir, { retainMs: DEFAULT_ISSUANCE_WINDOW_MS, now: NOW })
    expect(enrolOnce(authorityOver(mine, 1), 1, 41, NOW).ok).toBe(true)

    const elsewhere = await mkdtemp(join(tmpdir(), 'o2-issuance-other-'))
    try {
      const theirs = await FsIssuance.open(elsewhere, {
        retainMs: DEFAULT_ISSUANCE_WINDOW_MS,
        now: NOW,
      })
      expect(theirs.issuedToAnybody()).toEqual([])
      expect(enrolOnce(authorityOver(theirs, 1), 1, 41, NOW).ok).toBe(true)
    } finally {
      await rm(elsewhere, { recursive: true, force: true })
    }
  })

  /** Per-user and aggregate history are both durable, and both are read back by key. */
  it('remembers who each certificate was issued to', async () => {
    const ledger = await FsIssuance.open(dir, { retainMs: DEFAULT_ISSUANCE_WINDOW_MS, now: NOW })
    ledger.record(USER_A, NOW - 10)
    ledger.record(USER_B, NOW - 5)
    ledger.record(USER_A, NOW)

    const reopened = await FsIssuance.open(dir, { retainMs: DEFAULT_ISSUANCE_WINDOW_MS, now: NOW })
    expect(reopened.issuedTo(USER_A)).toEqual([NOW - 10, NOW])
    expect(reopened.issuedTo(USER_B)).toEqual([NOW - 5])
    expect(reopened.issuedToAnybody()).toEqual([NOW - 10, NOW - 5, NOW])
  })
})

describe('AUTH-04 — the write precedes the reply', () => {
  /**
   * Asserted **directly rather than by racing it**, and the difference is the reading.
   *
   * `EnrollmentAuthority.enrol` is fully synchronous — `packages/net/src/agent.ts` records
   * at its `enrol` branch that this is *why* that branch takes no capacity slot — so there
   * is **no suspension point** between `record` returning and `enrol` returning, and none
   * between `enrol` returning and the statement below. A single-threaded runtime cannot
   * have encoded a reply in between. So this is not "the write usually wins": there is no
   * race to win.
   *
   * Both halves are asserted, because only the pair is the property:
   *   - `enrol`'s result is not a promise, so nothing awaited anything;
   *   - the file already holds the timestamp on the very next statement.
   *
   * Reddened by deferring the append to a microtask — `queueMicrotask(() => append…)` —
   * which leaves `record` synchronous to its caller and the file empty here.
   */
  it('has the timestamp on disk on the statement after enrol returns', async () => {
    const ledger = await FsIssuance.open(dir, { retainMs: DEFAULT_ISSUANCE_WINDOW_MS, now: NOW })
    const authority = authorityOver(ledger, 5)

    const result = enrolOnce(authority, 1, 41, NOW)
    const onDisk = readFileSync(join(dir, ISSUANCE_FILE), 'utf8')

    expect(result).not.toBeInstanceOf(Promise)
    expect(result.ok).toBe(true)
    expect(onDisk).toContain(String(NOW))
  })

  /** A refusal writes nothing: no request a provider declined may consume its window. */
  it('records nothing when the request is refused', async () => {
    const ledger = await FsIssuance.open(dir, { retainMs: DEFAULT_ISSUANCE_WINDOW_MS, now: NOW })
    const authority = authorityOver(ledger, 1)

    expect(enrolOnce(authority, 1, 41, NOW).ok).toBe(true)
    expect(enrolOnce(authority, 2, 42, NOW).ok).toBe(false)

    const reopened = await FsIssuance.open(dir, { retainMs: DEFAULT_ISSUANCE_WINDOW_MS, now: NOW })
    expect(reopened.issuedToAnybody()).toHaveLength(1)
  })
})

describe('AUTH-04 — compaction does not widen either budget', () => {
  /**
   * An issuance timestamp older than the window decides nothing — both budgets filter to
   * it — so it may be forgotten. **This is deliberately unlike a spend record**, which can
   * never be forgotten because a spent thing stays spent; a reader arriving from the
   * invitation draft this plan replaced will expect that rule and this is not it.
   *
   * The reading that makes the difference safe: a record holding stale entries alongside
   * fresh ones refuses at **the same point** as one holding only the fresh ones. Reddened
   * by compacting the aggregate list and not the per-user one, or the reverse — the two
   * budgets then disagree about one window and one of them silently widens.
   */
  it('refuses at the same point whether or not the stale entries were dropped', async () => {
    const windowMs = 60_000
    const stale = [NOW - windowMs * 4, NOW - windowMs * 3, NOW - windowMs * 2]
    const fresh = [NOW - 1_000, NOW - 500]

    // Written as the file's own format, so this fixture is a *record* and not a mock.
    await writeFile(
      join(dir, ISSUANCE_FILE),
      [...stale, ...fresh].map((at) => `${String(at)} ${USER_A}\n`).join(''),
    )

    const compacting = await FsIssuance.open(dir, { retainMs: windowMs, now: NOW })
    expect(compacting.issuedToAnybody()).toEqual(fresh)
    expect(compacting.issuedTo(USER_A)).toEqual(fresh)

    // The same two fresh entries, with nothing stale to drop.
    const elsewhere = await mkdtemp(join(tmpdir(), 'o2-issuance-fresh-'))
    try {
      await writeFile(
        join(elsewhere, ISSUANCE_FILE),
        fresh.map((at) => `${String(at)} ${USER_A}\n`).join(''),
      )
      const untouched = await FsIssuance.open(elsewhere, { retainMs: windowMs, now: NOW })

      // Both authorities carry the same window, so "the same point" is a comparison and
      // not a coincidence: three per window, two already spent, one left, then refused.
      const a = new EnrollmentAuthority({
        providerPrivateKey: new Uint8Array(SEED_BYTES).fill(0xc9),
        maxPerWindow: 100,
        maxIssuedPerWindow: 3,
        windowMs,
        issuance: compacting,
      })
      const b = new EnrollmentAuthority({
        providerPrivateKey: new Uint8Array(SEED_BYTES).fill(0xc9),
        maxPerWindow: 100,
        maxIssuedPerWindow: 3,
        windowMs,
        issuance: untouched,
      })

      expect(a.issuedToAnybodyWithin(NOW)).toBe(b.issuedToAnybodyWithin(NOW))
      expect(enrolOnce(a, 1, 41, NOW).ok).toBe(enrolOnce(b, 1, 41, NOW).ok)
      const lastA = enrolOnce(a, 2, 42, NOW)
      const lastB = enrolOnce(b, 2, 42, NOW)
      expect(lastA.ok).toBe(false)
      expect(lastB.ok).toBe(false)
    } finally {
      await rm(elsewhere, { recursive: true, force: true })
    }
  })

  /** Compaction is a rewrite, so the dropped entries do not come back on the next open. */
  it('leaves the file holding only what it still reports', async () => {
    const windowMs = 60_000
    await writeFile(
      join(dir, ISSUANCE_FILE),
      [NOW - windowMs * 5, NOW - 100].map((at) => `${String(at)} ${USER_A}\n`).join(''),
    )

    await FsIssuance.open(dir, { retainMs: windowMs, now: NOW })
    const text = await readFile(join(dir, ISSUANCE_FILE), 'utf8')
    expect(text).toBe(`${String(NOW - 100)} ${USER_A}\n`)
  })
})

describe('AUTH-04 — the record lives beside the keys, not among the blocks', () => {
  /**
   * `FsBlockstore.open`'s filter **is** the block counter — every non-dot entry it finds
   * becomes part of `size`. An undotted issuance file would inflate the count of every
   * provider in this repository by one, which is the defect `identity-store.ts` records
   * having already been measured once, for this same directory.
   */
  it('is dot-prefixed, so it is not counted as a block', async () => {
    expect(ISSUANCE_FILE.startsWith('.')).toBe(true)

    const ledger = await FsIssuance.open(dir, { retainMs: DEFAULT_ISSUANCE_WINDOW_MS, now: NOW })
    ledger.record(USER_A, NOW)
    expect((await FsBlockstore.open(dir)).size).toBe(0)
  })

  /** A directory that has never issued anything is an empty record, not a failure. */
  it('opens a directory with no record at all', async () => {
    const ledger = await FsIssuance.open(dir, { retainMs: DEFAULT_ISSUANCE_WINDOW_MS, now: NOW })
    expect(ledger.issuedToAnybody()).toEqual([])
    expect(ledger.issuedTo(USER_A)).toEqual([])
  })
})
