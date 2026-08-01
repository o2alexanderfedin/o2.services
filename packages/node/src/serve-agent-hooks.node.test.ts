import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * WIRE-01, criterion 2 — the sentinel-count guard.
 *
 * A grep over source is brittle against reformatting, so this reads the production
 * files' text off disk (structural, following the pattern `purity.node.test.ts`
 * established) and counts literal occurrences of each sentinel string, rather than
 * parsing shape. This is also the burn-down count the project tracks going forward:
 * every occurrence is a node stating, in one grep-able line, which capability it
 * currently substitutes with a named absence.
 *
 * AUTH-03 extended it to cover **both sides of a dispatch** — the hooks a node
 * serves with, and the chain it dispatches with. The two are not symmetric in one
 * respect that has to be written down or somebody will drive it to zero: the
 * `'serves-unauthenticated'` counts are a burn-down heading for 0, but the
 * `'dispatches-unauthenticated'` counts have a **permanent floor**. Every shard
 * these three drivers submit is `label: 'public'`, and a public task has no owner
 * and therefore no root key a chain could be rooted at, so the sentinel is the
 * correct value at those sites forever rather than a stub awaiting wiring.
 *
 * What these counts do **not** prove is anything about a dispatch. They are
 * substring counts over source text, like every other row in this file: they prove
 * the string is present and state the floor it must not fall below. The behaviour
 * is `remote-executor-contract.test.ts` and `capability-dispatch.test.ts`.
 *
 * Node-only: reads real source files off disk by relative path.
 */

const FABRIC_NODE = readFileSync(new URL('./fabric-node.ts', import.meta.url), 'utf8')
const BROWSER_NODE = readFileSync(new URL('../../browser/src/browser-node.ts', import.meta.url), 'utf8')
const BENCH = readFileSync(new URL('./bin/bench.ts', import.meta.url), 'utf8')
const DEMO_MAIN = readFileSync(new URL('../../browser/demo/main.ts', import.meta.url), 'utf8')
const PERF_WORKLOAD = readFileSync(new URL('../../bench/src/perf-workload.ts', import.meta.url), 'utf8')

/** How many times `needle` occurs in `text`, as a literal substring. */
function occurrences(text: string, needle: string): number {
  return text.split(needle).length - 1
}

describe('production serveAgent call sites state every hook explicitly', () => {
  it('fabric-node.ts: real reservations, real admission, four sentinels', () => {
    expect(occurrences(FABRIC_NODE, "'serves-unauthenticated'")).toBe(1)
    expect(occurrences(FABRIC_NODE, "'serves-no-records'")).toBe(1)
    expect(occurrences(FABRIC_NODE, "'keeps-no-ledger'")).toBe(1)
    expect(occurrences(FABRIC_NODE, "'reports-no-dispatch'")).toBe(1)
    // The already-fixed wire — the real thunk is supplied, not the sentinel.
    expect(occurrences(FABRIC_NODE, "'relays-for-nobody'")).toBe(0)
    // SCHED-06 burned this one down: the factory constructs a real `LocalCapacity`.
    // Structural, and deliberately not the evidence that it works — the behaviour is
    // measured in `admission.node.test.ts` against real nodes over TCP, because
    // 13-VERIFICATION-2.md recorded what a composition an inspection can confirm is
    // worth when the behaviour has never run.
    expect(occurrences(FABRIC_NODE, "'accepts-every-offer'")).toBe(0)
  })

  it('browser-node.ts: real onDispatch, real admission, four sentinels', () => {
    expect(occurrences(BROWSER_NODE, "'serves-unauthenticated'")).toBe(1)
    expect(occurrences(BROWSER_NODE, "'serves-no-records'")).toBe(1)
    expect(occurrences(BROWSER_NODE, "'keeps-no-ledger'")).toBe(1)
    expect(occurrences(BROWSER_NODE, "'relays-for-nobody'")).toBe(1)
    // The real callback is supplied, not the sentinel.
    expect(occurrences(BROWSER_NODE, "'reports-no-dispatch'")).toBe(0)
    // SCHED-06, same burn-down as `fabric-node.ts` above. This factory's wiring is
    // **unmeasured, not met**: `BrowserNode.start` needs a real `indexedDB` and a
    // relay to dial, so it runs in neither vitest project, and this count is not
    // allowed to stand in for running it. WIRE-03, Phase 19 builds that harness.
    expect(occurrences(BROWSER_NODE, "'accepts-every-offer'")).toBe(0)
  })

  it('bin/bench.ts: two call sites, real admission at both, five sentinels twice', () => {
    expect(occurrences(BENCH, "'serves-unauthenticated'")).toBe(2)
    expect(occurrences(BENCH, "'serves-no-records'")).toBe(2)
    // SCHED-06 burn-down, and the reason it matters here is not tidiness. The
    // memory-transport curve in `.planning/BENCHMARK-RESULTS.md` was measured with
    // this sentinel at both of this driver's `serveAgent` calls while the
    // real-transport curve went through `FabricNode.start` and did admit, so the two
    // published curves were measured under different node behaviour. Zero, not one:
    // re-adding the sentinel at *either* call site takes this count to 1 and fails.
    expect(occurrences(BENCH, "'accepts-every-offer'")).toBe(0)
    // The other half of the same fact, because a count of zero is also what deleting
    // a call site produces. Two constructions, one per `serveAgent` call in this
    // driver — the requestor endpoint and the worker loop.
    expect(occurrences(BENCH, 'new LocalCapacity(')).toBe(2)
    expect(occurrences(BENCH, "'keeps-no-ledger'")).toBe(2)
    expect(occurrences(BENCH, "'relays-for-nobody'")).toBe(2)
    expect(occurrences(BENCH, "'reports-no-dispatch'")).toBe(2)
  })
})

describe('production RemoteExecutor call sites state the chain explicitly', () => {
  // AUTH-03. The other half of a dispatch. `RemoteExecutor`'s third constructor
  // argument is required — `remote-executor-contract.test.ts` holds the
  // compile-failure proof — so these counts are not "is it wired", they are "which
  // choice did the call site write down".
  //
  // Each expected number is a **floor that is also the ceiling**, and is expected to
  // stay where it is rather than fall to 0. Every one of these five dispatch sites
  // submits `label: 'public'` shards.

  it('demo/main.ts: both peer dispatches are public work', () => {
    expect(occurrences(DEMO_MAIN, "'dispatches-unauthenticated'")).toBe(2)
    // The other half of the same fact, because a count of two is also what moving a
    // sentinel onto a *third*, newly-added site would produce. Two constructions,
    // one per job the demo can run — `runColouring` and `runJob`.
    expect(occurrences(DEMO_MAIN, 'new RemoteExecutor(')).toBe(2)
  })

  it('bin/bench.ts: both drivers dispatch public shards', () => {
    expect(occurrences(BENCH, "'dispatches-unauthenticated'")).toBe(2)
    expect(occurrences(BENCH, 'new RemoteExecutor(')).toBe(2)
  })

  it('bench/src/perf-workload.ts: the third production dispatch site', () => {
    // Not named in this phase's plan, which counted two production sites. Found by
    // re-grepping rather than trusting the count, and recorded here so the next
    // reader inherits three rather than re-discovering the third.
    expect(occurrences(PERF_WORKLOAD, "'dispatches-unauthenticated'")).toBe(1)
    expect(occurrences(PERF_WORKLOAD, 'new RemoteExecutor(')).toBe(1)
  })
})
