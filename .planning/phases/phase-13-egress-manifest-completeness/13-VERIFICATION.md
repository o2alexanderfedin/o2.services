---
status: gaps_found
phase: 13
verified: 2026-07-28
criteria_met: 0
criteria_partial: 3
criteria_total: 3
score: 0/3 criteria fully verified — all three met in strictly weaker forms than written
reopened: 2026-08-08
reopened_by: owner ruling on audit finding L3
reopened_note: >-
  STATE.md counted this phase among the closed while this file read 0/3. The contradiction was put
  to the owner and resolved IN THIS FILE'S FAVOUR: the verification is authoritative, the milestone
  count drops 12 -> 11, and Phase 13 rejoins the counted set when its three criteria are met AS
  WRITTEN rather than in the weaker forms recorded below. Nothing in the scoring was edited.
baseline:
  test_files: 122
  tests: 1775
  tsc: clean
  suite_rerun_after_reverts: 122 files / 1775 tests passing
mutations_planted_by_verifier: 5
gaps:
  - truth: "A stream tap installed on the wire between two nodes started via bin/agent.ts fails a running cross-owner job if a single raw sovereign byte crosses it"
    status: partial
    reason: >
      The tap is real, is on the sole code path out of both node classes, and both of its
      guards were watched failing by this pass. Three literal elements of the criterion are
      nonetheless untrue. (a) No test spawns bin/agent.ts and reads a manifest; the proof
      uses two in-process FabricNode.start() calls. The two files that do spawn real agent
      processes contain no reference to egress at all. (b) The job is not failed — the
      DATA-05 test asserts the shard reaches 'agreed' while the raw block crosses, and no
      production code anywhere reads manifest.violations, so nothing can convert a
      violation into a job outcome. (c) Detection is whole-block, not per-byte: a frame
      carrying the raw SSN characters alone crossed the tap with no violation in a direct
      probe.
    artifacts:
      - path: "packages/node/src/egress-manifest.node.test.ts"
        issue: "Two in-process FabricNode.start() calls, not two bin/agent.ts operating-system processes. Asserts result.job.shards[0].verification.status === 'agreed' — the leaking job succeeds."
      - path: "packages/net/src/egress.ts"
        issue: "contains() requires the entire registered payload as a contiguous byte-identical run; violations is an observational field with zero production readers."
      - path: ".planning/phases/phase-13-egress-manifest-completeness/13-03-PLAN.md"
        issue: "Justifies the in-process standard by claiming 12-VERIFICATION.md 'independently confirmed' it satisfies a criterion worded 'through bin/agent.ts'. 12-VERIFICATION.md says the opposite — it marked that criterion PARTIAL for exactly this reason and closed the gap with a three-real-process spawn test."
    missing:
      - "A test that spawns two or more real bin/agent.ts processes, runs a cross-owner job through them, and obtains the owner process's manifest — which today requires a wire message kind that does not exist (protocol.ts carries exec/block/providers/records/offer/reservations/report/error and nothing else)."
      - "A decision, recorded in ROADMAP.md, on whether a recorded violation must fail or degrade the running job, or whether detect-and-record is the intent and the criterion's wording should change."
      - "An honest statement of detection granularity — whole registered block, contiguous and byte-identical — wherever the criterion's 'a single raw sovereign byte' is repeated, including the DATA-05 ledger row in REQUIREMENTS.md."
  - truth: "Every job run through bin/agent.ts or the browser demo emits an egress manifest recording exactly what left each owner's node, with byte counts, retrievable from the job's own result metadata after completion — not only inside a test harness"
    status: partial
    reason: >
      The browser-demo half is genuinely met and was independently mutation-verified. The
      bin/agent.ts half is not met at all — agent.ts never submits a job and no submitter
      can obtain a spawned agent's manifest. And "each owner's node" is not met at any
      production entry point: every production call supplies exactly one guard and it is
      the submitting node's own, never the executing owner's. The one place the owner's
      guard is the one read is egress-manifest.node.test.ts — that is, only inside a test
      harness, which is the clause the criterion explicitly excludes.
    artifacts:
      - path: "packages/node/src/bin/bench.ts"
        issue: "Supplies requestor.egress / requestorGuard — the submitter's tap. The executing nodes' manifests are never read, and in memoryFabric the worker endpoints are built over a raw transport with no guard at all. No test covers this leg; tsc is its only regression guard."
      - path: "packages/browser/demo/main.ts"
        issue: "Both call sites supply only [node.egress] / [n.egress] — the local tab. Peer tabs' manifests are never collected."
      - path: "packages/node/src/bin/agent.ts"
        issue: "71 lines, serving-only, never calls submitJob. Prints peerId/multiaddrs and nothing about egress. Its FabricNode.egress is unreachable from any other process."
    missing:
      - "Either a cross-process manifest retrieval path (a new protocol message kind plus a submitter-side collection step), or a ROADMAP.md amendment stating that 'each owner's node' means 'the submitting node's own tap' and that bin/agent.ts is named as the serving side only."
      - "Automated coverage for bin/bench.ts's egress leg — today only tsc would notice its removal, and only because the manifest read was left in place."
  - truth: "The manifest for a job with zero sovereign data crossing the network reports zero sovereign bytes, and the manifest for a job that legitimately moves an aggregate reports only the aggregate's size, never the raw input's"
    status: partial
    reason: >
      First clause met in a weaker form — EgressManifest has no sovereign-byte figure at
      all, so "zero sovereign bytes" is expressed as an empty violation-label list, and
      that list is correctly paired with entries.length > 0 in every assertion. Second
      clause measured false. On the exact pushdown shape the phase's own test uses, the
      owner node's manifest.totalBytes is 130 while the raw sovereign input is 95 canonical
      bytes and the aggregate is 8 — the manifest reports more than the raw input, not the
      aggregate's size. 13-03-SUMMARY discloses that it deliberately dropped this
      assertion; the pushdown property is instead proven by comparing encoded output to
      encoded input, which is the same evidence Phase 12's criterion 3 already produced and
      to which the manifest contributes nothing.
    artifacts:
      - path: "packages/net/src/egress.ts"
        issue: "EgressManifest fields are nodeId, ownerId, entries, totalBytes, violations. totalBytes sums every frame, including block fetches unrelated to the aggregate. There is no per-job sovereign-byte or aggregate-byte figure."
      - path: "packages/node/src/egress-manifest.node.test.ts"
        issue: "The pushdown test's size comparison is encodeCanonical(output) vs encodeCanonical(raw) — job output values, not manifest readings. No assertion connects the manifest to the aggregate's size."
    missing:
      - "Either a manifest field that isolates result-carrying egress from protocol and block-fetch traffic, or a ROADMAP.md amendment saying pushdown is evidenced by output-vs-input encoded size rather than by the manifest."
human_verification:
  - test: "Decide the intended reading of criterion 1's verb: should a recorded egress violation fail, degrade, or annotate the running job, or is detect-and-record the intent?"
    expected: "Either production code that reads manifest.violations and acts on it (today there are zero such readers), or a reworded criterion matching DATA-05's own text, which says a stream-tap *test* fails."
    why_human: "This is a product decision about what the fabric promises, not a fact about the code. The code's behaviour is unambiguous and was observed: the leaking job completes as 'agreed'."
  - test: "Decide whether 'each owner's node' in criterion 2 requires retrieving a remote node's manifest, which needs a wire message kind that does not exist and which 13-CONTEXT.md deferred as 'not needed'."
    expected: "Either a cross-process retrieval path is scheduled, or the roadmap line is amended to say the submitting node's own manifest is what is promised."
    why_human: "The deferral was a documented planning decision; whether it under-delivers the criterion is a scope call, not a defect the code can settle."
  - test: "Run a sovereign-labelled job inside a real browser tab and confirm BrowserNode's registerSovereignInputs composition registers the input against that tab's own tap."
    expected: "The tab's egress manifest carries the input CID as a violation when the module echoes its input, exactly as fabric-node.ts's path does."
    why_human: "Confirmed independently that no sovereign job runs in a browser anywhere in the repo — the two e2e tests that read report.egress run public jobs only, so the browser tier's sovereign branch is compiled and never executed. BrowserNode.start needs a real IndexedDB and a relay, so it cannot run in the node project, and the browser project has no relay to dial. Same structural gap Phase 12 routed to human verification, one layer down."
---

# Phase 13: Egress Manifest Completeness — Verification Report

**Phase Goal (ROADMAP.md):** Both `FabricNode` and the browser node construct their
`RpcEndpoint` over an `EgressGuard`-wrapped transport instead of the raw
`Libp2pTransport`, so the egress manifest is complete by construction on a real job.

**Branch:** `develop`, HEAD `63598c2`
**Verified:** 2026-07-28
**Status:** gaps_found — real work landed and is falsifiable; all three roadmap criteria
are nonetheless satisfied only in weaker forms than they are written.

**Mandate for this pass:** find the next defect, not confirm the last two were fixed.
Every mutation below was planted by me, run by me, and its output pasted verbatim. No
claim in any 13-xx-SUMMARY.md was taken as evidence.

---

## Baseline

```
$ npm test
 Test Files  122 passed (122)
      Tests  1775 passed (1775)
   Duration  282.89s

$ npx tsc --noEmit
tsc exit: 0

$ git status --short
(clean)
```

Matches the stated baseline exactly. After all five mutation-and-revert cycles below,
re-run:

```
$ npm test
 Test Files  122 passed (122)
      Tests  1775 passed (1775)
   Duration  299.21s

$ npx tsc --noEmit
tsc exit: 0

$ git status --short
(clean)
```

---

## What is genuinely there — established by mutation, not by reading

Before the gaps, the parts that hold up. This phase is not a stub, and saying so is part
of an honest report.

### Mutation 1 — the production registration call is load-bearing

`packages/net/src/sovereign-egress.ts`, `options.guard.guard(...)` removed from
`registerSovereignInputs`:

```
$ npx tsc --noEmit          # clean, exit 0
$ npx vitest run packages/node/src/egress-manifest.node.test.ts packages/net/src/sovereign-egress.test.ts

 FAIL |node| egress-manifest.node.test.ts > DATA-05 … > a map step that forgot to aggregate names its own violation
 AssertionError: expected [] to include 'bafyreiccwgqag45rbtsfri5zatieqprf5yxk…'
   ❯ packages/node/src/egress-manifest.node.test.ts:119:45

 FAIL |node| sovereign-egress.test.ts > registers a sovereign task’s input before it runs, and the tap catches a leak
 AssertionError: expected [] to include 'bafyreiccwgqag45rbtsfri5zatieqprf5yxk…'

 Test Files  3 failed (3)
      Tests  3 failed | 7 passed (10)
```

Reverted with `git checkout --`; `git status --short` clean; `tsc --noEmit` exit 0.

`EgressGuard.guard()` really does have its first production caller, and it is really
reachable from `FabricNode.start` — the falsification test fails when it is removed, with
no test-side `.guard()` call anywhere in either file.

### Mutation 2 — the transport wrap is load-bearing, and the empty-manifest trap is closed

`packages/node/src/fabric-node.ts:353`, `new RpcEndpoint(egress, …)` → `new
RpcEndpoint(transport, …)`:

```
$ npx tsc --noEmit          # clean, exit 0
$ npx vitest run packages/node/src/egress-manifest.node.test.ts

 FAIL > DATA-05 … names its own violation                          expected [] to include 'bafyrei…'
 FAIL > a clean pushdown job reports zero violations …              expected 0 to be greater than 0   (:161)
 FAIL > a public job also gets a genuine, non-empty manifest …      expected 0 to be greater than 0   (:189)
 FAIL > a pushdown job's manifest reflects only the aggregate …     expected 0 to be greater than 0   (:227)

 Test Files  1 failed (1)
      Tests  4 failed (4)
```

Reverted; clean; `tsc` exit 0. All four, exactly as 13-03-SUMMARY reported — and the
three `expected 0 to be greater than 0` failures are the direct proof that
`entries.length > 0` is genuinely paired with `violations == []` rather than decorative.
An absent instrument and a clean run do **not** look alike in this file. That is the one
thing this milestone most needed, and it is real.

### Mutation 3 — the browser demo's manifest reaches a real entry point

`packages/browser/demo/main.ts`, `runJob` reverted to bare `submitJob` with the
`result.manifests[0]` read left in place:

```
$ npx vitest run packages/node/src/two-tabs.e2e.test.ts

 FAIL |e2e| two-tabs.e2e.test.ts > NET-02 — two tabs on one machine > completes a 2x-redundant map job over a direct WebRTC connection
 Error: page.evaluate: TypeError: Cannot read properties of undefined (reading '0')
     at Object.runJob (http://localhost:5174/packages/browser/demo/main.ts:512:36)

 Test Files  1 failed (1)
      Tests  1 failed | 2 passed (3)
```

Reverted; clean; `tsc` exit 0. Real Chromium, real WebRTC, the demo's own `window.o2`
entry point. This is not a harness reading a guard it built itself.

### Mutation 5 — delta-slicing is load-bearing

`packages/net/src/submit-with-egress.ts`, `full.entries.slice(from)` → `full.entries`:

```
$ npx tsc --noEmit          # clean, exit 0
$ npx vitest run packages/net/src/submit-with-egress.test.ts packages/node/src/egress-manifest.node.test.ts

 FAIL > slices two sequential jobs on the same guard without double-counting
 AssertionError: expected 5 to be 8 // Object.is equality
   ❯ packages/net/src/submit-with-egress.test.ts:180:52
```

Reverted; clean; `tsc` exit 0.

### Behavioural spot-checks, run on this host

```
$ node --experimental-strip-types packages/node/src/bin/bench.ts --quick
  memory transport egress manifest: 287 frames, 46438 bytes
  real transport egress manifest: 171 frames, 27593 bytes
wrote .planning/BENCHMARK-RESULTS.md and .planning/bench/raw.json
```

Reproduces 13-03-SUMMARY's figures exactly. (`BENCHMARK-RESULTS.md` and `bench/raw.json`
were reverted afterwards — this was a verification run, not a phase change.)

```
$ node --experimental-strip-types packages/node/src/bin/agent.ts --dir <tmp>
{"peerId":"12D3KooWKFrpYTgHg9tkjVvocKdbovBiV1B7LSK3rJSo7eB1emN8","multiaddrs":["/ip4/127.0.0.1/tcp/58013/p2p/12D3KooW…"]}
```

The binary still starts under the new wiring.

### Reachability — every symbol this phase introduced

| Symbol | Non-test callers | Verdict |
|---|---|---|
| `registerSovereignInputs` | `fabric-node.ts:376`, `browser-node.ts:257` | reachable from both real factories |
| `submitJobWithEgress` | `bin/bench.ts:260`, `demo/main.ts:312`, `demo/main.ts:552` | reachable from two runnable entry points |
| `FabricNode.egress` | `bin/bench.ts:224` | reachable |
| `BrowserNode.egress` | `demo/main.ts:321`, `demo/main.ts:564` | reachable |
| `TabColouringRun.egress` / `TabJobReport.egress` | set in `demo/main.ts:353,585`; read by two e2e tests | reachable |
| `sliceManifest` | none outside its own module | barrel export with no external caller |

Claimed commits all exist: `ade1295`, `3146de1`, `644f833`, `7d621b8`, `deef8d5`, plus an
undocumented fourth wave `b0116b4`, `17705e5`, `65ba81e` (the criterion-2 closure appended
to 13-03-SUMMARY.md; ROADMAP.md still says "3 plans").

No `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER` in any file this phase touched.

---

## Criterion 1 — the tap fails a cross-owner job on a raw sovereign byte

> A stream tap installed on the wire between two nodes started via `bin/agent.ts` fails a
> running cross-owner job if a single raw sovereign byte crosses it

**PARTIAL — three separate literal elements are untrue.**

### (a) Not "two nodes started via `bin/agent.ts`"

`egress-manifest.node.test.ts` calls `FabricNode.start()` twice in one Vitest process. The
only two files in the repository that spawn real `bin/agent.ts` operating-system processes
both call bare `submitJob`, and neither mentions egress:

```
$ grep -n "egress\|manifest" packages/node/src/two-process.node.test.ts packages/node/src/sovereignty-placement.node.test.ts
(no output)
```

This is not merely an unbuilt test. A spawned agent's manifest is **architecturally
unreachable** from the submitting process. `packages/net/src/protocol.ts` defines exactly
these request kinds — `exec`, `block`, `providers`, `records`, `offer`, `reservations`,
`report` — and no response kind carries a manifest. `bin/agent.ts` (71 lines) prints one
JSON line of peerId and multiaddrs and nothing else. 13-CONTEXT.md's `<specifics>` section
deferred a cross-process retrieval path as "not needed for Phase 13's criteria"; that
deferral is precisely what makes this element of criterion 1 unreachable.

**And the precedent 13-03-PLAN.md cites for accepting the in-process form says the
opposite of what it is quoted as saying.** 13-03-PLAN.md, lines 38-42:

> *"a same-process test spinning up multiple real `FabricNode.start()` instances over real
> TCP sockets is accepted evidence in this repo … which 12-VERIFICATION.md's addendum
> independently confirmed satisfies a roadmap criterion worded 'through `bin/agent.ts`'"*

12-VERIFICATION.md marked its criterion 1 **PARTIAL** for exactly this reason — *"the
roadmap's literal evidentiary requirement — 'a job submitted through bin/agent.ts' — has
zero coverage"* — and its addendum closed that gap by building
`sovereignty-placement.node.test.ts`, which spawns **three genuine operating-system
processes** via `spawn(process.execPath, [AGENT, …])`. The precedent is that in-process is
*not* sufficient for a criterion worded this way. Phase 13's weaker standard rests on an
inversion of the document it cites.

### (b) The job is not failed

The DATA-05 test asserts the opposite:

```ts
// egress-manifest.node.test.ts:117
expect(result.job.shards[0]?.verification.status).toBe('agreed')
```

The echo module ships the raw sovereign block, the block crosses, the job **succeeds**,
and the violation is recorded as an observation. Nothing converts it into an outcome:

```
$ grep -rn "violations" packages --include="*.ts" | grep -v "\.test\.ts"
packages/net/src/submit-with-egress.ts:43   (doc comment)
packages/net/src/submit-with-egress.ts:54   (constructing the field)
packages/net/src/egress.ts:44               (declaring the field)
packages/net/src/egress.ts:104              (constructing the field)
```

Zero production readers. `egress.ts:49-53` states the design intent explicitly — *"A match
is recorded as a violation rather than thrown"* — so this is deliberate, and DATA-05's own
requirement text says *"a stream-tap **test** fails"*, which is satisfied. Criterion 1 says
the **job** fails, which is not.

### (c) Detection is whole-block, not per-byte

`egress.ts:118` skips any registered payload larger than the frame, and `contains()`
(`:126-135`) requires the whole payload as a contiguous byte-identical run. I probed this
directly against a real `EgressGuard`, registering the canonical block for
`{ssn, salary, dob}` (44 bytes) and sending four frames:

```
registered block size : 44
entries    : [{"to":"bob","bytes":44,"violation":"the-row"},   # whole block            -> caught
              {"to":"bob","bytes":11},                          # raw SSN characters     -> NOT caught
              {"to":"bob","bytes":43},                          # block minus last byte  -> NOT caught
              {"to":"bob","bytes":44}]                          # block, one byte flipped-> NOT caught
violations : ["the-row"]
```

Eleven bytes of genuinely raw sovereign data crossed the tap with no violation. What the
tap catches is *"a map step that forgot to aggregate and shipped its input"* — which is
what `egress.ts:18-22` honestly claims — not *"a single raw sovereign byte".*

**Verdict: PARTIAL.** The mechanism is real and falsifiable; the sentence is not true as
written on any of its three named elements.

---

## Criterion 2 — every job through `bin/agent.ts` or the browser demo emits a manifest

> Every job run through `bin/agent.ts` or the browser demo emits an egress manifest
> recording exactly what left each owner's node, with byte counts, retrievable from the
> job's own result metadata after completion — not only inside a test harness

**PARTIAL — the browser-demo half is met and mutation-proven; the `bin/agent.ts` half and
"each owner's node" are not met.**

### The browser demo: met

Both `window.o2` entry points call `submitJobWithEgress`, surface the manifest on
`TabColouringRun.egress` / `TabJobReport.egress` (`packages/browser/src/tab-api.ts:28,127`),
and two real-Chromium e2e tests read it back from the API's own return value with the
non-vacuous pairing:

```
colouring-demo.e2e.test.ts:156   expect(run.egress.entries.length).toBeGreaterThan(0)
colouring-demo.e2e.test.ts:157   expect(run.egress.violations).toEqual([])
two-tabs.e2e.test.ts:212         expect(report.egress.entries.length).toBeGreaterThan(0)
two-tabs.e2e.test.ts:213         expect(report.egress.violations).toEqual([])
```

Mutation 3 above proved these are load-bearing. This leg is genuinely outside a test
harness.

### `bin/bench.ts`: wired, real numbers, but only `tsc` guards it

Confirmed running (287 / 171 frames above). Mutation 4 — `bin/bench.ts` reverted to bare
`submitJob`:

```
$ npx tsc --noEmit
packages/node/src/bin/bench.ts(276,31): error TS2339: Property 'manifests' does not exist
  on type '{ ok: true; job: JobResult; }'.
tsc exit: 1
```

Reverted; clean; `tsc` exit 0. So a regression here is caught — but by the type-checker
only, and only because the `result.manifests[0]` read was left in place. No test covers
this leg; an edit removing both together would pass the whole suite.

### `bin/agent.ts`: not met

`agent.ts` never calls `submitJob` — it is serving-only, 71 lines. The 13-03-SUMMARY
addendum argues *"the ROADMAP wording naming `bin/agent.ts` refers to the serving side of
the same running node, not a fourth submission call site."* Taken at its word, that reading
makes the criterion **harder**, not easier: it means the manifest the criterion asks for is
the *serving agent's own*, and there is no path by which a submitter obtains it. Under
either reading, no job run against a `bin/agent.ts` process emits a retrievable manifest
today.

### "Recording exactly what left each owner's node": not met in production

Every production call supplies exactly one guard, and in every case it is the **submitting**
node's own, never the executing owner's:

| Entry point | Guard supplied | Whose egress that is |
|---|---|---|
| `bin/bench.ts` `realFabric` | `requestor.egress` | the submitter's |
| `bin/bench.ts` `memoryFabric` | `requestorGuard` | the submitter's — and the N worker endpoints are built over a **raw** transport (`new RpcEndpoint(network.connect(id), …)`), so they have no tap at all |
| `demo/main.ts` `runColouring` | `[node.egress]` | the local tab's |
| `demo/main.ts` `runJob` | `[n.egress]` | the local tab's |

The single place where the *owner's* guard is the one read is
`egress-manifest.node.test.ts` (`[alice.egress]`, four times) — obtainable only because the
test holds alice's `FabricNode` object in its own process. That is exactly and only inside
a test harness, which is the clause the criterion writes out in full.

**Verdict: PARTIAL.** "Retrievable from the job's own result metadata, not only inside a
test harness" is genuinely satisfied for the browser demo. "`bin/agent.ts`" and "each
owner's node" are not.

---

## Criterion 3 — zero sovereign bytes clean; only the aggregate's size on a pushdown

> The manifest for a job with zero sovereign data crossing the network reports zero
> sovereign bytes, and the manifest for a job that legitimately moves an aggregate reports
> only the aggregate's size, never the raw input's

**PARTIAL — first clause met in a weaker form, second clause measured false.**

### First clause: met as "no violation labels", not as a byte count

`EgressManifest`'s fields are `nodeId`, `ownerId`, `entries`, `totalBytes`, `violations`
(confirmed at runtime: `["nodeId","ownerId","entries","totalBytes","violations"]`). There
is no sovereign-byte figure. "Zero sovereign bytes" is expressed as an empty list of
violation labels, and to this phase's genuine merit it is never asserted alone.
Four assertion sites pair it with `entries.length > 0`, and mutation 2 proved that pairing
fires.

### Second clause: measured false

I ran the phase's own pushdown shape and read the numbers off the owner node's manifest:

```
raw sovereign input, canonical bytes : 95
aggregate output, canonical bytes    : 8
manifest.totalBytes (owner node)     : 130
manifest.entries                     : [{"to":"seed","bytes":73},{"to":"requestor","bytes":57}]
manifest.violations                  : []
```

The manifest reports **130** — more than the raw input's 95, and sixteen times the
aggregate's 8. It cannot report "only the aggregate's size" because `totalBytes` sums every
frame the node sent, including a 73-byte block fetch that has nothing to do with the
result.

13-03-SUMMARY discloses this plainly and says it deliberately dropped a
`manifest.totalBytes < rawEncoded.bytes.length` assertion for exactly this reason. That
disclosure is honest. The consequence is that the pushdown half of criterion 3 is proven
by `encodeCanonical(output).length < encodeCanonical(raw).length` — a comparison of job
output values — which is the identical evidence Phase 12's criterion 3 already produced
(`sovereign-execution.test.ts:462-507`). **The manifest contributes nothing to the clause
that is written about the manifest.**

**Verdict: PARTIAL.**

---

## Summary

| # | Criterion | Verdict |
|---|---|---|
| 1 | Tap between two `bin/agent.ts` nodes fails a cross-owner job on a raw sovereign byte | **PARTIAL** — mechanism real and mutation-verified; not `bin/agent.ts`, does not fail the job, whole-block not per-byte |
| 2 | Every job through `bin/agent.ts` or the browser demo emits a retrievable manifest | **PARTIAL** — browser demo met and mutation-proven; `bin/agent.ts` not met; "each owner's node" met only inside a test |
| 3 | Zero sovereign bytes when clean; only the aggregate's size on a pushdown | **PARTIAL** — clean case met as empty violation labels; the pushdown clause measured false (130 vs 95 vs 8) |

**True score: 0 of 3 fully met; 3 of 3 met in strictly weaker forms.**

This is not a "nothing was built" verdict, and it should not be read as one. The two
defects this milestone was created to catch — a mechanism with zero production callers,
and a guard nobody watched fail — are both genuinely closed here, and I closed them myself
rather than taking the SUMMARY's word: `EgressGuard.guard()` has a real production caller
reachable from both node factories, the transport wrap is on the sole code path out, the
empty-manifest trap is guarded at every assertion site, and five independent mutations
produced five real failures.

The defect this pass found is a different one, and it is the same shape in all three
criteria: **the phase built the mechanism the goal names and then verified it against a
weaker sentence than the roadmap wrote.** Criterion 1's sentence says a job fails; the code
records and continues. Criterion 1 and 2 say `bin/agent.ts`; the proof and the wiring both
stop at in-process `FabricNode`. Criterion 2 says each owner's node; production reads only
the submitter's. Criterion 3 says the manifest reports the aggregate's size; the manifest
reports 130 for an 8-byte aggregate and the proof quietly moved to a different measurement.
None of these is hidden — 13-03-SUMMARY discloses two of them in its own prose — but every
one of them was rounded up to `[x]` in ROADMAP.md and REQUIREMENTS.md before any
independent pass ran.

### The ledger rows overstate what was built

`.planning/REQUIREMENTS.md:382` (DATA-05) reads:

> *"`egress-manifest.node.test.ts` fails a running job between real `FabricNode`s when a
> raw sovereign byte crosses"*

Two errors in one clause. The test does not fail a running job — it asserts the job reaches
`'agreed'` and checks a recorded label. And "a raw sovereign byte" is not what the scan
detects; an 11-byte raw field crossed the tap unremarked in the probe above. The row's own
bold caveat — *"Rests on the executors' own reports plus a call-site check"* — was accurate
and is now discharged: the reports were optimistic in the specific ways listed here.

### Working tree state

All five mutations were planted by this pass and reverted by this pass, each with
`git checkout --` on the single named file I had modified. No `git add`, no commit, no
file touched that I did not myself mutate. One browser-mode failure screenshot directory
that my own mutation run produced (`packages/net/src/__screenshots__/`, gitignored) was
removed.

```
$ git status --short
(clean)
$ npx tsc --noEmit
tsc exit: 0
$ npm test
 Test Files  122 passed (122)
      Tests  1775 passed (1775)
```

---

*Verified: 2026-07-28*
*Verifier: Claude (gsd-verifier)*
