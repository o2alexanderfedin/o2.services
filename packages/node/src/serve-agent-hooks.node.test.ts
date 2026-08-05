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
 * ## What a pinned number means here, and why three of them stopped meaning it
 *
 * A number in this file is not "how far along the burn-down is". It is **which choice
 * this call site wrote down**, and Plan 20-02 is the third time a row's number moved for
 * a reason that had nothing to do with progress — after `'signs-nothing'`, whose
 * prediction of 0 was wrong because a node nobody enrolled still has to say what it
 * signs, and `'dispatches-unauthenticated'`, whose plan said the count must stay at 2 and
 * where holding it there would have meant hoisting the literal into a constant and making
 * the floor unreadable. **A count with a stale comment beside it is how a guard becomes
 * decoration**, so each row below states what its number means rather than only what it
 * is, and the three dispositions in this file are now distinguishable:
 *
 * - **A burn-down heading for 0** — `'serves-unauthenticated'`, `'serves-no-records'`,
 *   `'accepts-every-offer'` at the factories. A real value replaced the named absence.
 * - **A permanent correct value** — `'signs-nothing'` at a node nobody certified,
 *   `'dispatches-unauthenticated'` at a site submitting public work, `'keeps-no-ledger'`
 *   at the four benchmark-rig endpoints. Nothing is pending; the named absence is the
 *   truthful answer and is expected to stay.
 * - **A scope statement** — `'holds-no-registrations'`, which records where a real guard
 *   was sent *instead* rather than that none exists.
 *
 * `'keeps-no-ledger'` moved in Plan 20-02 and is the clearest case of the second kind
 * sitting beside the first: it went to **0** at both node factories, which now build a
 * real `StartOutcomeLedger` and record their own start row into it, and stays at **2** in
 * each of `bin/bench.ts` and `perf-workload.ts`, whose endpoints are fixtures in one
 * process rather than that many visitors. Each of those four sites states its reason at
 * the call site, so a later reader finds the argument beside the code rather than here.
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

/**
 * The **code** lines of a file's `ownStartOutcome` / `ownStartLedger` pair — BROW-02.
 *
 * Comments and blank lines are stripped, deliberately and not for convenience: the two
 * factories' docblocks point at each other by name, so they differ by construction, and an
 * equality over raw text would be a check that could only ever fail. What has to match is
 * the derivation — the predicate that decides whether a label is fileable, the shape of
 * the outcome, and the line that puts this node's own row in its own ledger.
 *
 * Same line-based technique as {@link authorizerArguments}, and the same limit: it tells a
 * *divergent* derivation from a convergent one, and cannot tell a correct one from an
 * incorrect one. A defect planted identically in both files passes it.
 *
 * Returns `[]` when there is no such pair, which is what makes deleting them
 * distinguishable from changing them — provided the reading is taken next to a non-empty
 * one. It is; see the positive control at the assertion.
 */
function ledgerDerivation(source: string): readonly string[] {
  const lines = source.split('\n')
  const start = lines.findIndex((line) => line.startsWith('function ownStartOutcome('))
  if (start === -1) return []
  const collected: string[] = []
  let inLedger = false
  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index] ?? ''
    const trimmed = line.trim()
    if (
      trimmed !== '' &&
      !trimmed.startsWith('*') &&
      !trimmed.startsWith('/*') &&
      !trimmed.startsWith('//')
    ) {
      collected.push(trimmed)
    }
    if (line.startsWith('function ownStartLedger(')) inLedger = true
    if (inLedger && line === '}') return collected
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
    // BROW-02 burned this one down in Plan 20-02: the factory constructs a real
    // `StartOutcomeLedger` and hands it over, so a peer asking this node is answered with
    // counts rather than with `[]`.
    //
    // **Three positives beside the zero, and they pin three different facts**, because a
    // zero alone is equally what deleting the `ledger:` line — or the whole `serveAgent`
    // call — produces:
    //
    // - `ledger: startLedger,` says the hook is filled with the real value. The trailing
    //   comma is not decoration and the prefix hazard was **measured, not reasoned about**:
    //   `index: records` matched inside `index: records ?? 'serves-no-records'` and read 1
    //   both before and after that change. Restoring the named opt-out on this line was
    //   planted here and this needle read **0**, so it does discriminate.
    // - `new StartOutcomeLedger(` says a ledger is built at all.
    // - `held.record(outcome)` says the node puts **its own row** in it, and that is the
    //   half nothing else in this repository can see. Handing `serveAgent` an empty ledger
    //   type-checks, satisfies the two rows above, and leaves every merged report across
    //   any number of nodes reading 1 forever, because `serveAgent` records only what a
    //   *peer* told it and `mergeOverlapping` takes the maximum per key. A behavioural
    //   reading in `packages/net/src/start-report.test.ts` covers the same defect in the
    //   *mechanism* and **cannot cover it here**: `@o2/net` is a dependency of `@o2/node`,
    //   so no test in that package can see this file. 20-02-PLAN.md predicted that plant
    //   would redden `start-report.test.ts`; it was planted and that file stayed green.
    //   This row is what was put in its place.
    expect(occurrences(FABRIC_NODE, "'keeps-no-ledger'")).toBe(0)
    expect(occurrences(FABRIC_NODE, 'ledger: startLedger,')).toBe(1)
    expect(occurrences(FABRIC_NODE, 'new StartOutcomeLedger(')).toBe(1)
    expect(occurrences(FABRIC_NODE, 'held.record(outcome)')).toBe(1)
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
    // VER-08 / VER-09 / VER-10 — **1 is now the permanent correct value, and this
    // sentence replaces a prediction that was wrong.** It used to read that Plan 19-15
    // composes a real signer and this count goes to 0, the way `'serves-no-records'` and
    // `'accepts-every-offer'` already had. 19-15 landed and it did not, for a reason
    // worth keeping rather than quietly correcting: the other two sentinels were
    // *replaced* by a real value, whereas this one is the answer a node that nobody
    // enrolled still has to give. It moved — from the hook argument to the identity the
    // factory resolves once for both verbs — and at that line it is written exactly
    // once, on the arm where the certificate is `null`. A count of 0 here would mean a
    // factory that had branched around the absence instead of naming it, which is the
    // thing the required-with-sentinel rule exists to prevent.
    //
    // Paired with the hook's presence, because a 0 alone is also what deleting the
    // `attest:` line produces — and *that* deletion no longer compiles, which is the
    // stronger guard `agent-contract.test.ts` holds.
    //
    // **This `it`'s title says "four sentinels" and is not renamed to five.** Two
    // mutation-ledger entries key their `signature` on the titles in this file, and the
    // ledger's own docblock records the cost of renaming one: `B1` and `B2` named a test
    // that had been renamed four commits earlier and every run stayed green because
    // nothing compared the signature to anything. A number in a title is worth less than
    // a guard that still fires.
    expect(occurrences(FABRIC_NODE, "'signs-nothing'")).toBe(1)
    expect(occurrences(FABRIC_NODE, 'attest:')).toBe(1)
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
    // BROW-02, and **the same four numbers as `fabric-node.ts` deliberately** — read that
    // block for what each of the three positives pins. Holding a start-outcome ledger is
    // not a capability a tier confers: `start-outcome.ts`'s own comment says *"a browser
    // tab that took a report from a peer aggregates exactly as a listening server does"*.
    // If this row ever diverges from the `FABRIC_NODE` row above without a stated reason,
    // something has started keying on node kind — which is the failure Phases 16 and 17
    // each shipped once.
    expect(occurrences(BROWSER_NODE, "'keeps-no-ledger'")).toBe(0)
    expect(occurrences(BROWSER_NODE, 'ledger: startLedger,')).toBe(1)
    expect(occurrences(BROWSER_NODE, 'new StartOutcomeLedger(')).toBe(1)
    expect(occurrences(BROWSER_NODE, 'held.record(outcome)')).toBe(1)
    expect(occurrences(BROWSER_NODE, "'relays-for-nobody'")).toBe(1)
    // AUTH-01, and the same count as `fabric-node.ts` deliberately. A browser node
    // issues certificates on identical terms to any other node; it has no signing key
    // here for the same reason the Node factory has none, which is that neither is
    // given one until Plan 17-03. If this row ever diverges from the `FABRIC_NODE` row
    // above without a stated reason, something has started keying on node kind.
    expect(occurrences(BROWSER_NODE, "'issues-no-certificates'")).toBe(1)
    // The real callback is supplied, not the sentinel.
    expect(occurrences(BROWSER_NODE, "'reports-no-dispatch'")).toBe(0)
    // SCHED-06, same burn-down as `fabric-node.ts` above, and this count is still not
    // allowed to stand in for running it — but as of Plan 19-04 something does run it.
    // `packages/node/src/tab-refusals.e2e.test.ts` dispatches concurrently at a tab's own
    // declared limit and reads the refusal off the requestor's reply:
    // `over-committed: 1 of 1 slots in use` at `maxConcurrentTasks: 1`, and `2 of 2` at
    // `2`, so the figure is shown tracking the option. That retires the sentence that
    // stood here — *"nothing drives an over-committed dispatch through a tab, so the
    // number this node would refuse a requestor with has never been read. WIRE-03,
    // Phase 19"* — which was true when written and is not now. Retired rather than
    // deleted, because the sentence it had itself replaced (*"needs a real `indexedDB`
    // and a relay to dial, so it runs in neither vitest project"*) was false and kept
    // four items deferred across four plans, and this row is where a reader goes looking.
    expect(occurrences(BROWSER_NODE, "'accepts-every-offer'")).toBe(0)
    // VER-08 / VER-09 / VER-10, and **the same count as `fabric-node.ts` deliberately**.
    // Signing is not a capability a tier confers: an enrolled tab signs on identical
    // terms to any other node. If this row ever diverges from the `FABRIC_NODE` row
    // above without a stated reason, something has started keying on node kind.
    //
    // The prediction that used to close this comment — *Plan 19-15 takes both to 0 in one
    // pass* — was wrong in the same way its twin above was, and for the same reason: 19-15
    // moved the literal to the resolved identity rather than deleting it, because a tab
    // nobody enrolled still has to say what it signs. See the `FABRIC_NODE` row for the
    // full account. Both tiers moved it identically, which is the row's real subject.
    expect(occurrences(BROWSER_NODE, "'signs-nothing'")).toBe(1)
    expect(occurrences(BROWSER_NODE, 'attest:')).toBe(1)
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

  it('browser-node.ts derives its own start row the identical way fabric-node.ts does', () => {
    // BROW-02, and the same *relational* move the authorizer check above makes, applied to
    // the hook Plan 20-02 changed. It exists because the count rows above cannot see a
    // divergence: `ledger: startLedger,` reads 1 for a factory that records nothing, for
    // one that files a label the wire refuses, and for one that files a *failure* row for
    // a node that plainly started — all three satisfy every substring count in this file.
    //
    // What it mechanises is the standing rule `fabric-node.ts`'s module comment states in
    // the imperative: **all nodes have equal functionality, and the only difference is
    // discovery.** The two tiers file different *labels* — `'other'` for a process that is
    // not a browser, `currentBrowserLabel()` for a tab — and that is one field taking two
    // values, not two kinds of node. The derivation *around* the label must be one thing,
    // and this is what says so.
    //
    // Its limit is the authorizer check's limit and is stated for the same reason: it can
    // tell a divergent derivation from a convergent one and nothing more. A defect planted
    // identically in both files passes it.
    const fabric = ledgerDerivation(FABRIC_NODE)
    const browser = ledgerDerivation(BROWSER_NODE)
    // The positive control: without it, deleting both pairs satisfies the equality with
    // two empty lists — the identical hole this file's authorizer check records.
    expect(fabric.length).toBeGreaterThan(0)
    expect(browser).toEqual(fabric)
    // Named rather than inferred from the equality, because two files that both lost the
    // record line would still be equal to each other. This is the line that turns a ledger
    // holding only what peers said into one a peer can learn something from.
    expect(fabric).toContain("if (outcome !== 'reports-no-start-outcome') held.record(outcome)")
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
    // BROW-02 — **two is the permanent, correct value here and is not a burn-down**, and
    // it is the row a reader comparing this file's five blocks will most easily misread,
    // because the two node factories above just went to 0. Plan 20-02 read each of these
    // four rig sites and decided per site on a stated rule: a site standing up a *node*
    // supplies a real ledger, a site standing up a *measurement fixture* states the
    // opt-out and says why at the call site.
    //
    // These are fixtures. Both are endpoints on `MemoryNetwork` inside the driver's own
    // process, and this driver's N endpoints are one process start rather than N
    // visitors — so a `started` row per endpoint would be manufactured population in a
    // metric whose whole value is that its `n` is real.
    //
    // **The comparison a reader will reach for is the admission sentinel three rows up,
    // and it does not carry over.** That one changed behaviour on the *measured* path, so
    // the published memory curve and real curve were taken under different node
    // behaviour. This hook is reached only by a `report` frame and this driver sends
    // none. What follows is the honest converse and is written down rather than left to
    // be assumed: **the published benchmark numbers say nothing about BROW-02**, because
    // these endpoints are fixtures rather than visitors and always were.
    expect(occurrences(BENCH, "'keeps-no-ledger'")).toBe(2)
    expect(occurrences(BENCH, "'relays-for-nobody'")).toBe(2)
    expect(occurrences(BENCH, "'reports-no-dispatch'")).toBe(2)
    // AUTH-01. Two, one per call site — a benchmark driver signs nothing.
    expect(occurrences(BENCH, "'issues-no-certificates'")).toBe(2)
    // VER-08 / VER-09 / VER-10. **Two is the permanent correct value here**, exactly as
    // `'dispatches-unauthenticated'` is below and unlike the two node factories, which
    // burn theirs to 0 in Plan 19-15. Nothing enrolled this driver's endpoints: a node
    // signs with a *provider-issued* certificate and there is no provider in this rig,
    // so a signature made here would verify against no trust anchor any reader holds
    // while adding an Ed25519 sign per combine to a published scaling curve.
    expect(occurrences(BENCH, "'signs-nothing'")).toBe(2)
    expect(occurrences(BENCH, 'attest:')).toBe(2)
    // DATA-05, and **the one `AgentOptions` field no row in this file counted at any
    // production call site** until defect #19 was investigated. Two, one per site, and
    // it is a *scope statement* rather than a burn-down: `bench-egress.node.test.ts`'s
    // second requirement rules that this driver's worker endpoints are deliberately
    // untapped because the amended criterion promises the **submitting** node's
    // manifest, and this driver does construct a real `EgressGuard` — it simply hands
    // it to `submitJobWithEgress` rather than to `serveAgent`. Counting it is what makes
    // the difference between those two destinations legible; without this row a "we
    // built the guard right here, pass it in too" tidy moves a published curve's
    // measured path with nothing anywhere failing.
    expect(occurrences(BENCH, "'holds-no-registrations'")).toBe(2)
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
    // BROW-02 — permanent here too, on the ground stated in full in the `BENCH` block
    // above: both are fixture endpoints in the gate's own process, so a `started` row
    // apiece would be population this rig never had. It also leaves what the gate
    // measures untouched — the hook is reached only by a `report` frame and this workload
    // sends none — so no re-baseline is owed, which is the question `perf-baseline.ts`
    // makes any change to this file answer.
    expect(occurrences(PERF_WORKLOAD, "'keeps-no-ledger'")).toBe(2)
    expect(occurrences(PERF_WORKLOAD, "'relays-for-nobody'")).toBe(2)
    expect(occurrences(PERF_WORKLOAD, "'reports-no-dispatch'")).toBe(2)
    expect(occurrences(PERF_WORKLOAD, "'issues-no-certificates'")).toBe(2)
    // Real admission at both, like the other two drivers — the other half of the
    // fact, because a zero above is also what deleting a call site produces.
    expect(occurrences(PERF_WORKLOAD, "'accepts-every-offer'")).toBe(0)
    expect(occurrences(PERF_WORKLOAD, 'new LocalCapacity(')).toBe(2)
    // VER-08 / VER-09 / VER-10 — permanent, on the same ground as `bin/bench.ts` above.
    expect(occurrences(PERF_WORKLOAD, "'signs-nothing'")).toBe(2)
    expect(occurrences(PERF_WORKLOAD, 'attest:')).toBe(2)
    // DATA-05 — see the `BENCH` row above for why this field was uncounted everywhere
    // and what counting it buys. Two here as well, and for the same reason: this rig
    // also builds a real `EgressGuard` over the submitting endpoint's transport and
    // hands it to `submitJobWithEgress`, not to either `serveAgent`.
    expect(occurrences(PERF_WORKLOAD, "'holds-no-registrations'")).toBe(2)
  })

  it('bench/src/perf-workload.ts composes no provenance guard where bin/bench.ts composes one at every rig', () => {
    // DET-03, and **the divergence defect #19 asked about.** It is recorded here rather
    // than repaired, deliberately, and the reason is in the last paragraph.
    //
    // These two files claim to measure the same shape. `perf-workload.ts`'s own module
    // comment says so at length — *"this rig reproduces the shape of the driver's memory
    // rig — same fixture module, same shard count, same declared admission limit, same
    // redundancy rule, same `measure()`, same `EgressGuard`… and the same
    // `submitJobWithEgress` call over it"*. Nine hooks over four call sites match
    // exactly, which is what the rows above establish. **This one does not.**
    //
    // `bin/bench.ts` wraps every executor it builds in `guardModuleProvenance`, at all
    // three rigs, and its header states the reason against its own interest: *"after this
    // phase there is no production dispatch path that skips the signature check, so a rig
    // that skipped it would be measuring a path that no longer exists… That is also why
    // `wasmInProcess` is wrapped. It is the baseline the two fabrics are compared
    // against; if the fabrics pay for the check and the baseline does not, every reported
    // speedup is inflated by exactly the difference."* `bench-egress.node.test.ts`'s
    // seventh requirement pins that wrapping.
    //
    // The perf gate wraps **neither side of its own ratio** — not its two `serveAgent`
    // executors and not `referenceWorkload()`'s. So its `coordinationRatio` is a
    // fabric-over-local quotient in which neither term pays DET-03, while the published
    // curve pays it in both. The two rigs' numbers are therefore not the same quantity,
    // and until this row existed nothing in the repository said so.
    //
    // **Why this is not fixed here.** Wrapping them changes what `measureGateLadder`
    // measures, and `perf-baseline.ts` holds committed wall-clock numbers the gate
    // asserts against — so the wiring and a full re-baseline are one change, not two, and
    // the gate is opt-in (`O2_PERF=1`) and minutes long. A patch that wired the guard
    // without retaking the baseline would turn the gate red for a change of workload and
    // be read as a regression. This row is what makes that a decision somebody takes on
    // purpose: wire it and this test goes red, which is the prompt to retake the
    // baseline in the same commit. Mutation-ledger entry `P3` plants exactly that.
    //
    // Relational, not absolute — the positive half is what stops this reading from being
    // satisfied by `bin/bench.ts` losing its guard too.
    expect(occurrences(BENCH, 'guardModuleProvenance(')).toBe(1)
    expect(occurrences(BENCH, 'guarded(new WasmExecutor(')).toBe(3)
    expect(occurrences(PERF_WORKLOAD, 'guardModuleProvenance')).toBe(0)
    // The other half of the same fact, because a zero above is equally what deleting
    // every executor construction in that file would produce.
    expect(occurrences(PERF_WORKLOAD, 'new WasmExecutor(')).toBe(3)
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

  it('bin/bench.ts: both drivers dispatch public shards, and so does the discovered set', () => {
    // **Three, raised from two by 18-06, and the raise is the honest answer rather than
    // the convenient one.** The third is not a new dispatch *site* in the sense the other
    // two are — it is `discoverCandidates`' required `dispatch` option, which is handed to
    // every `RemoteExecutor` that helper builds on the `--discover` arm. So it states the
    // same sentinel for the same permanent reason the other two do: every shard this
    // driver submits is `label: 'public'`, and a public task has no owner and therefore no
    // key a capability chain could be rooted at.
    //
    // The plan for 18-06 said this count must stay at 2. It could only have stayed at 2 by
    // hoisting the literal into a constant, which would have taken it to 1 and made the
    // floor this file exists to hold unreadable — a worse outcome than a number that moved
    // for a stated reason. `CandidateOptions.dispatch` is required precisely so that a
    // candidate built without one cannot dispatch unauthenticated silently.
    expect(occurrences(BENCH, "'dispatches-unauthenticated'")).toBe(3)
    // Unmoved: the discover arm builds no `RemoteExecutor` of its own — it takes the ones
    // `discoverCandidates` returns, which is the entire point of the helper.
    expect(occurrences(BENCH, 'new RemoteExecutor(')).toBe(2)
  })

  it('bin/bench.ts: discoverCandidates is reachable from the entry point', () => {
    // SCHED-01's entry-point call path, and the reason it is asserted at all: Phase 22's
    // guard fails on an exported capability with no path from a runnable entry point, and
    // that phase's roadmap section records an overruled proposal to accept one as
    // unreachable — *naming it is not the same as fixing it*.
    //
    // **The pattern is the call and not the name**, because the name appears four times in
    // that file — an import, two doc comments, and the call — so a bare substring count
    // would have been satisfied by the prose alone and would have read `4` while meaning
    // nothing. `await discoverCandidates(` can only be the invocation.
    //
    // **What this cannot do, and what now does it**: it is source text, so it proves the
    // call is written, not that the branch runs. It used to be the only thing holding the
    // arm — recorded as W-1 in `18-VERIFICATION.md` — because `bin/bench.ts` writes its
    // report under `process.cwd()`, so a test that invoked the driver would overwrite the
    // repository's committed measurements as a side effect of checking a flag.
    //
    // `discover-arm.node.test.ts` closes that: it spawns the driver with `cwd` in a
    // temporary directory, reads `--discover: 1 of 1 workers qualified from 1 providers`
    // off its stdout, and kills it once the arm has spoken. So the count below is no
    // longer load-bearing on its own, and is kept as the cheap half of a pair — this one
    // fails in milliseconds when the call is deleted, that one fails on what it did.
    expect(occurrences(BENCH, 'await discoverCandidates(')).toBe(1)
  })

  it('bench/src/perf-workload.ts: the third production dispatch site', () => {
    // Not named in this phase's plan, which counted two production sites. Found by
    // re-grepping rather than trusting the count, and recorded here so the next
    // reader inherits three rather than re-discovering the third.
    expect(occurrences(PERF_WORKLOAD, "'dispatches-unauthenticated'")).toBe(1)
    expect(occurrences(PERF_WORKLOAD, 'new RemoteExecutor(')).toBe(1)
  })
})
