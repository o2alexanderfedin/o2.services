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

/**
 * The trimmed argument lines of a file's `authorizeCapability({ … })` call.
 *
 * Line-based rather than brace-matching on purpose: the conditional-spread argument
 * contains `{ ownerKey: sovereignty.ownerKey })`, so the first `})` in the text is
 * *inside* the argument list and a naive index search would stop there. The closing
 * line is the one whose trimmed form starts with `})`; every argument line starts with
 * an identifier or a spread.
 *
 * Returns `[]` when there is no such call, which is what makes deleting the call
 * distinguishable from changing its arguments — provided the reading is taken next to a
 * non-empty one. It always is; see the assertion below.
 */
function authorizerArguments(source: string): readonly string[] {
  const lines = source.split('\n')
  const start = lines.findIndex((line) => line.includes('authorizeCapability({'))
  if (start === -1) return []
  const collected: string[] = []
  for (let index = start + 1; index < lines.length; index += 1) {
    const trimmed = (lines[index] ?? '').trim()
    if (trimmed.startsWith('})')) return collected
    collected.push(trimmed)
  }
  return collected
}

describe('production serveAgent call sites state every hook explicitly', () => {
  it('fabric-node.ts: real authorizer, real reservations, real admission, four sentinels', () => {
    // AUTH-03 burned this one down. A zero on its own is also what deleting the
    // `serveAgent` call entirely produces, so it is only read next to the positive
    // count of what replaced it — the `'relays-for-nobody'` pattern three lines below.
    //
    // **For `FABRIC_NODE` this pair is corroboration, not the evidence.** The evidence
    // is `fabric-node.node.test.ts`'s DATA-09/AUTH-03 block, which dispatches sovereign
    // tasks to three live nodes over real TCP and reads one acceptance and three
    // distinct refusals. See the `BROWSER_NODE` pair below for the case where no such
    // corroboration exists.
    expect(occurrences(FABRIC_NODE, "'serves-unauthenticated'")).toBe(0)
    expect(occurrences(FABRIC_NODE, 'authorizeCapability(')).toBe(1)
    // SCHED-01 / owner ruling D1 burned this one down: the factory hands `serveAgent` a
    // `SelfRecordIndex` on every path, so there is no longer a node it can build that has
    // nothing to answer. A node with no certificate answers `records: null` and a real
    // provider list — two truthful statements rather than one refusal to speak.
    //
    // **A count lowered to zero with nothing replacing it is a guarantee deleted.** The
    // assertion below it is what makes this pair a statement about the *hook* rather than
    // about a string that happened to vanish: zero alone is equally satisfied by deleting
    // the `index:` line, or the whole `serveAgent` call.
    //
    // The trailing comma in the needle is load-bearing and was measured, not assumed.
    // `occurrences` matches a literal substring, and the pre-plan text
    // `index: records ?? 'serves-no-records',` *contains* `index: records` — so without
    // the comma this assertion reads 1 both before and after the change and discriminates
    // nothing. 18-03-PLAN.md's proof block claims the sentinel form makes it read 0; that
    // was planted and read **1**. With the comma it reads 0 for the sentinel form and 1
    // for this one, which is the reddening the plan intended.
    expect(occurrences(FABRIC_NODE, "'serves-no-records'")).toBe(0)
    expect(occurrences(FABRIC_NODE, 'index: records,')).toBe(1)
    expect(occurrences(FABRIC_NODE, "'keeps-no-ledger'")).toBe(1)
    expect(occurrences(FABRIC_NODE, "'reports-no-dispatch'")).toBe(1)
    // AUTH-01. A burn-down heading for 0 on a node started with a provider key, and
    // the correct value for every node that was not — this factory has no way to be
    // given one until Plan 17-03, so 1 is what a truthful node says today.
    expect(occurrences(FABRIC_NODE, "'issues-no-certificates'")).toBe(1)
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
    // AUTH-03, and **this pair is worth much less than the `FABRIC_NODE` pair above.**
    // Stated here rather than left for a reader to assume symmetry, because the two
    // lines look identical and are not:
    //
    // It counts a substring in source text, not a behaviour. It reads 1 for a call site
    // handing `ownerId: sovereignty.ownerKey`, or an `audience` derived from some other
    // node, or a `now` that never advances — measured, not supposed: Plan 15-03 planted
    // exactly that scrambling and nothing in the repository moved. **Do not cite this
    // line as evidence that the browser authorizer works.** Two other instruments do
    // that: the argument-level check in the next `it` (Plan 15-04), and the behavioural
    // one below.
    //
    // **The behaviour is now measured, and this comment no longer claims otherwise.**
    // `packages/node/src/browser-capability.e2e.test.ts` dispatches three sovereign
    // tasks to a live tab pinned to a real owner — an absent chain, an expired one and a
    // valid one — and reads the refusal text plus the tab's own executor call count.
    // Mutation-ledger entry `M30` is 15-03's scrambling planted against it; it goes red.
    //
    // The reason this stood unmeasured for four plans was a false statement everybody
    // inherited, and it is left visible rather than quietly deleted. It read: those
    // nodes start with `relayAddrs: []`, a `BrowserNode` listens on
    // `['/p2p-circuit', '/webrtc']` alone, and a tab holding no relay reservation has no
    // address any peer can dial, *"so it runs in neither vitest project"*. The last
    // clause is the error. The **`browser`** project cannot host such a test, because a
    // Circuit Relay v2 server *"will not work in browsers"* in
    // `@libp2p/circuit-relay-v2`'s own words. The **`e2e`** project drives Playwright
    // from Node and has neither limit — and needs no relay at all, because a relay
    // exists to let two browsers exchange SDP and there is only one browser in that
    // topology: the tab dials a Node submitter's WebSocket listener directly, and the
    // dispatch returns along the connection the tab itself opened.
    expect(occurrences(BROWSER_NODE, "'serves-unauthenticated'")).toBe(0)
    expect(occurrences(BROWSER_NODE, 'authorizeCapability(')).toBe(1)
    // SCHED-01 / owner ruling D1, and **the same count as `fabric-node.ts` deliberately**,
    // for the reason the `'issues-no-certificates'` row below already gives: holding blocks
    // is not a capability enrollment confers and it is not a capability a *tier* confers
    // either. If this row ever diverges from the `FABRIC_NODE` row above without a stated
    // reason, something has started keying on node kind — which is the failure Phases 16
    // and 17 each shipped once.
    //
    // Paired with the positive for the same reason, and with the same comma: see the
    // `FABRIC_NODE` block above for why the needle is `index: records,` and not
    // `index: records`.
    expect(occurrences(BROWSER_NODE, "'serves-no-records'")).toBe(0)
    expect(occurrences(BROWSER_NODE, 'index: records,')).toBe(1)
    expect(occurrences(BROWSER_NODE, "'keeps-no-ledger'")).toBe(1)
    expect(occurrences(BROWSER_NODE, "'relays-for-nobody'")).toBe(1)
    // AUTH-01, and the same count as `fabric-node.ts` deliberately. A browser node
    // issues certificates on identical terms to any other node; it has no signing key
    // here for the same reason the Node factory has none, which is that neither is
    // given one until Plan 17-03. If this row ever diverges from the `FABRIC_NODE` row
    // above without a stated reason, something has started keying on node kind.
    expect(occurrences(BROWSER_NODE, "'issues-no-certificates'")).toBe(1)
    // The real callback is supplied, not the sentinel.
    expect(occurrences(BROWSER_NODE, "'reports-no-dispatch'")).toBe(0)
    // SCHED-06, same burn-down as `fabric-node.ts` above. This factory's admission
    // wiring is **unmeasured, not met**, and this count is not allowed to stand in for
    // running it. The reason is no longer the one that stood here — *"`BrowserNode.start`
    // needs a real `indexedDB` and a relay to dial, so it runs in neither vitest
    // project"* was false, and the `e2e` project now starts this factory against a live
    // tab in `browser-capability.e2e.test.ts`. What is still missing is narrower and is
    // the whole of it: nothing drives an *over-committed* dispatch through a tab, so the
    // number this node would refuse a requestor with has never been read. WIRE-03,
    // Phase 19.
    expect(occurrences(BROWSER_NODE, "'accepts-every-offer'")).toBe(0)
  })

  it('browser-node.ts hands its authorizer the identical arguments fabric-node.ts hands its own', () => {
    // AUTH-03. **The gap this closes, and the exact size of the closure.**
    //
    // Plan 15-03 measured the browser tier's guard and found nothing behind it. The
    // mutation it planted was not a deletion — it transposed the owner id and the owner
    // key, hardcoded the audience to an eight-character literal, and froze the clock at
    // zero. `tsc` exited 0. The count above stayed at 1. All 345 browser tests passed in
    // three engines. A browser node verifying every chain against a made-up audience,
    // with a frozen clock and its two owner fields swapped, was invisible to every
    // instrument in this repository.
    //
    // This is the assertion that sees it. It reads the argument lines of each factory's
    // call and requires them to be the same text. Transpose one pair, hardcode one
    // value, or freeze one clock on either side and the two lists differ.
    //
    // **What it is.** A source-text check, like every other row in this file — not a
    // behaviour, and it is not offered as one. What makes it worth more than a substring
    // count is that it is *relational*: `fabric-node.ts`'s side of this equality is
    // behaviourally proven, by `fabric-node.node.test.ts`'s four dispatches over three
    // live nodes and by `capability-dispatch.node.test.ts`'s three criteria across a real
    // process boundary. So this line transfers evidence from the tier that has it to the
    // tier that has none, and it mechanises the standing rule `fabric-node.ts`'s module
    // comment states in the imperative — all nodes have equal functionality, and the only
    // difference is discovery. Two factories composing *different* authorizers is that
    // rule being violated, whatever either one does.
    //
    // **What it is not, stated so nobody over-reads it.** It cannot tell a correct
    // authorizer from an incorrect one; it can only tell a *divergent* one from a
    // convergent one. A defect planted identically in both factories passes this and
    // every other check here, and it says nothing whatever about a dispatch to a browser
    // node. That limit is real and this check is kept for what it does cover.
    //
    // **What no longer stands is the claim that the other half is unmeasurable.** It
    // read: no dispatch to a browser node exists, because a tab holding no relay
    // reservation has no dialable address and the browser vitest project cannot run a
    // Circuit Relay v2 server. The second clause is true and the conclusion drawn from
    // it was not — the `e2e` project has neither constraint.
    // `packages/node/src/browser-capability.e2e.test.ts` now dispatches to a live tab
    // over a direct WebSocket the tab opened itself, with no relay in the topology at
    // all, and reads three refusal texts and an executor call count against it.
    const fabric = authorizerArguments(FABRIC_NODE)
    const browser = authorizerArguments(BROWSER_NODE)
    // The positive control, and it is not decoration: without it, deleting *both* calls
    // satisfies the equality below with two empty lists.
    expect(fabric.length).toBeGreaterThan(0)
    expect(browser).toEqual(fabric)
  })

  it('bin/bench.ts: two call sites, real admission at both, six sentinels twice', () => {
    // **Two is the permanent correct value here, not a pending item.** The other two
    // production factories burned this count to 0 in Phase 15; this driver does not,
    // and a reader comparing the three rows would otherwise read this as unfinished
    // work. `bench.ts` dispatches `label: 'public'` shards exclusively (`bench.ts:270`),
    // a public task has no owner and therefore no key a chain could be rooted at, and
    // `authorizeCapability`'s first precedence step returns `null` for a public task
    // regardless — so installing one here would add a per-dispatch cost to the published
    // scaling curves in exchange for a branch that can never refuse.
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
    // AUTH-01. Two, one per call site — a benchmark driver signs nothing.
    expect(occurrences(BENCH, "'issues-no-certificates'")).toBe(2)
  })

  it('bench/src/perf-workload.ts: the third production serveAgent file', () => {
    // **Not named in 17-02-PLAN.md, whose interfaces table listed four production
    // `serveAgent` sites across three files.** There are six, across four. This file
    // holds two of them, and it was found the same way the `RemoteExecutor` row at the
    // bottom of this file was found one phase earlier: by re-grepping rather than
    // trusting a plan's count. That row's own comment records the identical miss
    // ("counted two production sites... recorded here so the next reader inherits
    // three"), which makes this the second occurrence of one class of defect — a
    // hand-maintained inventory of call sites drifting from the repository.
    //
    // The lesson worth inheriting: `tsc --noEmit` is what actually establishes that
    // every site states the hook, because a required property cannot be omitted
    // anywhere. These counts state which *choice* each site wrote down; they are not
    // the proof that the set is complete.
    expect(occurrences(PERF_WORKLOAD, "'serves-unauthenticated'")).toBe(2)
    expect(occurrences(PERF_WORKLOAD, "'serves-no-records'")).toBe(2)
    expect(occurrences(PERF_WORKLOAD, "'keeps-no-ledger'")).toBe(2)
    expect(occurrences(PERF_WORKLOAD, "'relays-for-nobody'")).toBe(2)
    expect(occurrences(PERF_WORKLOAD, "'reports-no-dispatch'")).toBe(2)
    expect(occurrences(PERF_WORKLOAD, "'issues-no-certificates'")).toBe(2)
    // Real admission at both, like the other two drivers — the other half of the
    // fact, because a zero above is also what deleting a call site produces.
    expect(occurrences(PERF_WORKLOAD, "'accepts-every-offer'")).toBe(0)
    expect(occurrences(PERF_WORKLOAD, 'new LocalCapacity(')).toBe(2)
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
