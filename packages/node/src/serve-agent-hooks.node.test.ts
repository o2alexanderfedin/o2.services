import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * WIRE-01, criterion 2 — the sentinel-count guard.
 *
 * A grep over source is brittle against reformatting, so this reads the three
 * production files' text off disk (structural, following the pattern
 * `purity.node.test.ts` established) and counts literal occurrences of each
 * sentinel string, rather than parsing shape. This is also the burn-down count the
 * project tracks going forward: every occurrence is a node stating, in one
 * grep-able line, which capability it currently substitutes with a named absence.
 *
 * Node-only: reads real source files off disk by relative path.
 */

const FABRIC_NODE = readFileSync(new URL('./fabric-node.ts', import.meta.url), 'utf8')
const BROWSER_NODE = readFileSync(new URL('../../browser/src/browser-node.ts', import.meta.url), 'utf8')
const BENCH = readFileSync(new URL('./bin/bench.ts', import.meta.url), 'utf8')

/** How many times `needle` occurs in `text`, as a literal substring. */
function occurrences(text: string, needle: string): number {
  return text.split(needle).length - 1
}

describe('production serveAgent call sites state every hook explicitly', () => {
  it('fabric-node.ts: real reservations, five sentinels', () => {
    expect(occurrences(FABRIC_NODE, "'serves-unauthenticated'")).toBe(1)
    expect(occurrences(FABRIC_NODE, "'serves-no-records'")).toBe(1)
    expect(occurrences(FABRIC_NODE, "'accepts-every-offer'")).toBe(1)
    expect(occurrences(FABRIC_NODE, "'keeps-no-ledger'")).toBe(1)
    expect(occurrences(FABRIC_NODE, "'reports-no-dispatch'")).toBe(1)
    // The already-fixed wire — the real thunk is supplied, not the sentinel.
    expect(occurrences(FABRIC_NODE, "'relays-for-nobody'")).toBe(0)
  })

  it('browser-node.ts: real onDispatch, five sentinels', () => {
    expect(occurrences(BROWSER_NODE, "'serves-unauthenticated'")).toBe(1)
    expect(occurrences(BROWSER_NODE, "'serves-no-records'")).toBe(1)
    expect(occurrences(BROWSER_NODE, "'accepts-every-offer'")).toBe(1)
    expect(occurrences(BROWSER_NODE, "'keeps-no-ledger'")).toBe(1)
    expect(occurrences(BROWSER_NODE, "'relays-for-nobody'")).toBe(1)
    // The real callback is supplied, not the sentinel.
    expect(occurrences(BROWSER_NODE, "'reports-no-dispatch'")).toBe(0)
  })

  it('bin/bench.ts: two call sites, every sentinel twice', () => {
    expect(occurrences(BENCH, "'serves-unauthenticated'")).toBe(2)
    expect(occurrences(BENCH, "'serves-no-records'")).toBe(2)
    expect(occurrences(BENCH, "'accepts-every-offer'")).toBe(2)
    expect(occurrences(BENCH, "'keeps-no-ledger'")).toBe(2)
    expect(occurrences(BENCH, "'relays-for-nobody'")).toBe(2)
    expect(occurrences(BENCH, "'reports-no-dispatch'")).toBe(2)
  })
})
