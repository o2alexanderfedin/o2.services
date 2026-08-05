---
phase: phase-20-single-job-path-ledger-churn-resilience
plan: 02
subsystem: net
tags: [brow-02, start-outcome, ledger, disclosure, wire-bounds, node-parity]

requires:
  - phase: phase-11
    provides: "`serveAgent`'s `ledger` hook, required with a named opt-out at every call site"
  - phase: phase-17
    provides: "`MAX_REPORTED_COUNT` and `isStartBrowserLabel`, both enforced in `parseCounts` — the two conditions the demo's deferral named"
provides:
  - "both node factories build a real `StartOutcomeLedger` and record their own start row into it, so a peer that asks is answered with counts it did not itself supply"
  - "a measured foreign-family reading over an in-process fabric, with two controls isolating the own row from the ledger"
  - "both wire bounds re-measured over the wire and shown falsifiable, with the observed failure text"
  - "the row-count question answered with a number: 43.90 bytes a row, crossover at 191 099 rows against NET-08's 8 MiB ceiling — so NET-08 does not meaningfully bound it"
  - "each node exposes `startReport`, a snapshot with no method by which reading could write"
affects: [phase-20 plan 06, phase-20 plan 09, phase-20 plan 13]

tech-stack:
  added: []
  patterns:
    - "a derived fact is derived, and a stated choice is a required union with a named sentinel — the two are told apart by asking whether a caller has anything to say"
    - "a bound-refusal case anchors on an absolute the bound must stay below, plus a relational assertion naming why, because `ceiling + 1` is above the ceiling by construction and can never detect the ceiling moving"
    - "a cross-tier equality over *code* lines with comments stripped — the two factories' docblocks point at each other by name, so a raw-text equality could only ever fail"

key-files:
  created: []
  modified:
    - packages/node/src/fabric-node.ts
    - packages/browser/src/browser-node.ts
    - packages/node/src/bin/bench.ts
    - packages/bench/src/perf-workload.ts
    - packages/node/src/serve-agent-hooks.node.test.ts
    - packages/net/src/start-report.test.ts
    - packages/node/src/requirements-ledger.node.test.ts
    - .planning/REQUIREMENTS.md

key-decisions:
  - "the node's own outcome is DERIVED inside each factory rather than taken as a required `FabricNodeOptions` / `BrowserNodeOptions` field — measured fan-out of the required field was 75 construction sites across 51 files against a six-file plan and three concurrent executors, and the value is not a choice a caller has: a node reaching that line started"
  - "the required-union-with-named-sentinel shape is kept where a choice genuinely exists — `ownStartOutcome`'s return and `ownStartLedger`'s parameter — and its sentinel arm is REACHABLE in production on the browser tier"
  - "all four benchmark-rig sites keep the opt-out: N in-process endpoints are one process start, not N visitors, and a `started` row apiece would be manufactured population"
  - "`serve-agent-hooks.node.test.ts` gained an own-row pin rather than leaving the divergence the plan predicted, because the predicted divergence is impossible by package dependency direction"
  - "no row-count cap was added — the measurement is the deliverable, closing it is a new decision"

patterns-established:
  - "measure the fan-out of a required field before committing to it, and reconcile the tsc worklist against the grep worklist in both directions"
  - "a plant that leaves a file green is reported by name, and the case that actually carries the claim is named beside it"

requirements-completed: []

duration: ~2h
completed: 2026-08-04
---

# Phase 20 Plan 02: Every Node Keeps a Real Ledger, and Puts Its Own Row in It — Summary

**Both node factories now hold a `StartOutcomeLedger` containing their own start row, so a peer that asks one is answered with a browser family it has no expression to produce — measured over an in-process fabric against two controls, with both wire bounds re-measured and shown falsifiable, and the row-count question answered with 43.90 bytes a row rather than an assumption.**

## What landed

| Task | What | Where |
|---|---|---|
| 1 | Both factories build a real ledger, record their own row, and expose it as a read-only snapshot | `fabric-node.ts`, `browser-node.ts` |
| 1 | The hook, the construction, the own-row record, and a cross-tier code equality, all pinned | `serve-agent-hooks.node.test.ts` |
| 2 | Four rig sites each state their choice with a reason at the call site; the guard re-pinned and its docblock rewritten to say what the numbers mean | `bin/bench.ts`, `perf-workload.ts`, `serve-agent-hooks.node.test.ts` |
| 3 | The foreign-row reading with two controls, both bounds re-measured with paired discrimination, and the row-count measurement | `start-report.test.ts` |
| — | The BROW-02 ledger row corrected and the requirements guard's negative control replaced (forced by the pre-commit guard) | `REQUIREMENTS.md`, `requirements-ledger.node.test.ts` |

## The plan claim I measured FALSE

**Task 1's proof block says both of its plants must redden "Task 3's cross-process case" in `packages/net/src/start-report.test.ts`. That is impossible, and I measured it rather than reasoning about it.**

`@o2/node` and `@o2/browser` depend on `@o2/net`, not the other way round. No test in `packages/net/` can import either factory, and there is no cross-process case in that file — every case there runs over `MemoryNetwork` in one process. I planted the opt-out back into `fabric-node.ts` and ran both files:

```
PLANT-1 vitest exit 1
 × fabric-node.ts: real authorizer, real reservations, real admission, four sentinels
 Test Files  1 failed | 1 passed (2)
      Tests  1 failed | 30 passed (31)
```

`serve-agent-hooks.node.test.ts` went red. **`start-report.test.ts` stayed green.** Same for the skipped-own-row plant.

**Consequence, and what I did instead.** The plan intended a *recorded divergence* — the own-row plant reddening the behavioural file while every structural pin stayed green — as evidence that a structural pin cannot see the defect. That divergence cannot be produced here, and worse, taking the plan at its word would have left the factories' own-row **completely unguarded**: nothing in the repository would have seen `held.record(outcome)` being deleted. So I added the structural pin (`held.record(outcome)` counted at both factories, plus a cross-tier equality naming the line) and recorded the plant observation instead. The behavioural file covers the same defect *in the mechanism* — arm (ii) of the foreign-row case is exactly a peer that holds a ledger and skipped its own row.

## The plan instruction I did not follow, and the measurement behind it

**Task 1 requires the own outcome as a required field on `FabricNodeOptions` and `BrowserNodeOptions`, and its action says to update every construction site `tsc` names. I derived it inside each factory instead.**

Measured before deciding, by planting a required field on both options types and running `tsc --noEmit`:

| Worklist | Sites | Files |
|---|---|---|
| `tsc --noEmit` (constructs the options type) | **75** | **51** |
| `grep 'FabricNode\.start(\|BrowserNode\.start('` | **74** | **51** |

**The two lists reconcile in both directions, and each names one file the other misses** — which is the reconciliation the plan asks for, with the inverse it did not predict:

- In grep, not in tsc: `packages/net/src/enrol-client.ts` — a prose mention of `FabricNode.start()` in a docblock. This is the direction the plan warned about.
- In tsc, not in grep: `packages/browser/src/browser-node-contract.node.test.ts` — `function buildFull(): BrowserNodeOptions` constructs the options type with no `.start(` call anywhere. **A grep worklist alone would have missed a real site.**

Three reasons for deriving instead:

1. **My file list is six files and three other executors are live in this working tree.** Editing 51 files concurrently is the hazard `CLAUDE.md` records as having already cost ~250 lines here.
2. **The plan contradicts itself.** Its own `files_modified` frontmatter names exactly six files; a required field touches 51.
3. **On the merits, this is a derivable value and not a choice.** 20-CONTEXT.md's own coverage decision draws the line: *"That field encodes a choice the caller must state; this one encodes a fact already present in the caller's own input. WIRE-01 is about choices with silent defaults, not about derivable values."* A node reaching the construction line **started** — there is no path through `#compose` that arrives otherwise — and the label is `'other'` on one tier and `currentBrowserLabel()` on the other. There is nothing for a caller to say.

**The required-union-with-named-sentinel shape is kept where a choice does exist**, and its sentinel arm is *reachable in production*, not ceremony: `ownStartOutcome` returns `StartOutcome | 'reports-no-start-outcome'`, and `browserLabel` composes `${family} ${major}` with no bound on the major while `isStartBrowserLabel`'s pattern admits at most four digits. A tab can therefore produce a label no peer can file — and a row that evaporates one hop away, leaving the local report and every merged report disagreeing with nothing naming why, is worse than a node saying it has nothing to report. Requiredness was planted and measured:

```
packages/node/src/fabric-node.ts(1761,25): error TS2554: Expected 1 arguments, but got 0.
```

**What a follow-up plan would need to do** if the owner wants the field on the options type: 75 sites, 51 files, listed in the `tsc` output.

## Mutations planted, and the exact text observed

| # | Plant | File | Observed |
|---|---|---|---|
| 1 | `ledger:` given the named opt-out again | `fabric-node.ts` | RED `serve-agent-hooks`: `AssertionError: expected 1 to be +0 // Object.is equality` — **`start-report.test.ts` GREEN** |
| 2 | ledger built, own row not recorded | `fabric-node.ts` | RED ×2 `serve-agent-hooks`: `expected +0 to be 1` at the `held.record(outcome)` row, and `expected [ …(10) ] to deeply equal [ …(10) ]` at the cross-tier equality — **`start-report.test.ts` GREEN** |
| 3 | the outcome argument omitted at the construction site | `fabric-node.ts` | `tsc` exit 1: `packages/node/src/fabric-node.ts(1761,25): error TS2554: Expected 1 arguments, but got 0.` |
| 4 | browser tier drops the fileable-label check (tiers diverge) | `browser-node.ts` | RED: `expected [ …(8) ] to deeply equal [ …(10) ]`, diff naming the three removed lines. **The count rows stayed green** — which is the whole reason the relational check exists |
| 5 | a rig site silently given a real ledger | `bin/bench.ts` | RED naming the file: `expected 1 to be 2 // Object.is equality` |
| 6 | the same at the other rig | `perf-workload.ts` | RED naming the file: `expected 1 to be 2 // Object.is equality` |
| 7 | `MAX_REPORTED_COUNT` raised to `65_536_000` | `protocol.ts` | **GREEN — a proof that could not fail. See below.** |
| 7b | `MAX_REPORTED_COUNT` raised to `8_000_000_000` after the case was rewritten | `protocol.ts` | RED: `expected [ 'safari 18', 'firefox 130', …(1) ] to not include 'safari 18'` — the refused row arrives |
| 8 | `isStartBrowserLabel` weakened to `typeof value === 'string'` | `start-outcome.ts` | RED: `expected [ 'firefox 130', …(2) ] to not include 'Mozilla/5.0 (X11; Linux x86_64) Apple…'` |
| 9 | the report branch answers `counts: []` however full the ledger is | `agent.ts` | RED on the load-bearing reading: `expected [ 'chromium 141' ] to include 'firefox 130'` |

Every plant restored by `cp` + `cmp`, each `cmp` observed clean. No `git checkout --` and no `git stash` was used on any path.

### The proof that could not fail (plant 7)

My first magnitude case sent `count: MAX_REPORTED_COUNT + 1`. **Raising the constant raises the probe with it**, so the entry stays above the ceiling and the case stays green — it can detect the check being *deleted* and can never detect the ceiling being *moved*. That matters here specifically: this plan lifts a deferral that was conditional on this bound existing, so a silent raise re-opens the surface the deferral guarded.

Rewritten to anchor on an absolute (`BEYOND_ANY_CEILING = 4_000_000_000`) with a relational assertion beside it (`expect(MAX_REPORTED_COUNT).toBeLessThan(BEYOND_ANY_CEILING)`) so the literal cannot silently stop meaning anything. The relational line is deliberately **last**: placed first it fired before the behaviour, and the plant showed only why the case was void rather than the refused row arriving.

**Two pre-existing cases in this file have the same `ceiling + 1` shape** — `'files an entry at the ceiling and refuses the one above it'` and `'refuses a decline count that would bury the blind spot it belongs to'`. I did **not** change them, and the reason is that relative is right for *their* subject: they assert *where the boundary is*, for whatever the ceiling is, and a raise is a decision rather than a defect they should report. The third, `'lets no single peer decide the aggregate…'`, uses a literal `4_000_000_000` and did redden under plant 7b, which corroborates the new case.

## The row-count question, answered with a number

**Reading taken through** the real `encodeRequest` / `parseResponse` path over `MemoryNetwork`, so every label and magnitude check in `parseCounts` is in play on all 10 000 rows.

| Quantity | Measured |
|---|---|
| Rows sent, all well-formed (`firefox 0`…`firefox 9999`) | 10 000 |
| Rows that arrived and merged | 10 000, plus the asking node's own row = **10 001** |
| Anything that refused any of it | **nothing** |
| Encoded frame size (`encodeCanonical`, the encoder `rpc.ts` uses) | **438 967 bytes** |
| Bytes per row | **43.90** |
| NET-08's `MAX_INBOUND_MESSAGE_BYTES` (`@o2/libp2p`, written down not imported) | 8 388 608 |
| Implied crossover | **191 099 rows** |

**Conditions:** deterministic rather than timing-shaped — `encodeCanonical` over a fixed row set has no dependence on machine or load, so unlike a wall-clock span this reproduces anywhere. It *does* depend on the row shape, which is why the assertions are a bound and a floor rather than equalities.

**The finding, stated as 20-CONTEXT.md asked:** NET-08 does **not** meaningfully bound the row count. It bounds a *frame*, and `MemoryNetwork` has no byte limit at all, so in-process nothing refuses it whatsoever. Nearly two hundred thousand rows is not a bound on a quantity that grows by one row per distinct `(browser, result)` a node is ever told about, for as long as it runs. **No cap was added** — the plan says closing it is a new decision, and it is.

I also had to write the constant down rather than import it: `@o2/net` depends only on `@o2/core`, so importing `@o2/libp2p` would be the wrong direction and `purity.node.test.ts` refuses it. Same treatment `perf-workload.ts` gives the driver's `SHARDS`, with the same consequence recorded at the line.

## The four rig sites, and what they mean for the published numbers

All four keep the opt-out, each with its reason at the call site. **Decided by reading what each site constructs, not from the file name:** all four build an `RpcEndpoint` over `MemoryNetwork` with a `WasmExecutor` and a `MemoryBlockstore`, inside the driver's or the gate's own process.

**The reason is honesty about population, not cost.** BROW-02 counts *visitors* whose node failed to start. A rig standing up N in-process endpoints had **one process start**, not N visitor starts. Filing a `started` row per endpoint would put manufactured population into a metric whose entire value is that its `n` is real — the failure `mergeOverlapping`'s own docblock calls *"a rate whose sample size is a fiction"*.

**Does this recreate the `'accepts-every-offer'` divergence?** No, and the difference is measurable rather than asserted. That sentinel changed behaviour on the *measured* path — a slot taken and released per `exec` — so the memory curve and the real curve were measured under different node behaviour. This hook is reached only by a `report` frame, and neither rig sends one: they dispatch `exec`, `block` and `combine`. So the two curves stay comparable and `perf-baseline.ts` needs no re-baseline.

**The honest converse, which the plan asked me to state rather than leave a reader to assume:** the benchmark's published numbers **say nothing about BROW-02**, and never did. These endpoints are fixtures, not visitors. `bin/bench.ts`'s `--real` arm is different and now diverges deliberately — those nodes come from `FabricNode.start`, so each holds a real ledger with its own row. That divergence is stated at the call site so nobody "tidies" the two arms into agreement.

## The needle-prefix question, measured rather than reasoned about

The plan asked whether the new ledger needle has the defect `index: records` had (matching inside `index: records ?? 'serves-no-records'`, reading 1 both before and after a change). Measured under plant 1, with the opt-out in place of the real value:

```
ledger: startLedger,           0
'keeps-no-ledger'              1
new StartOutcomeLedger(        1
held.record(outcome)           1
```

`ledger: startLedger,` reads **0** when the value is the opt-out. It discriminates.

**A second, unexpected substring hazard found while planting**, worth recording because it is the same class one indentation level down: `"    ledger: 'keeps-no-ledger',\n"` (four spaces) occurs **twice** in `bin/bench.ts`, because the six-space worker line *contains* the four-space string as a suffix-substring. It bit my plant script, not the guard — the guard's needle is the quoted literal, which has no such hazard — but any future needle that leads with leading whitespace has it.

## Deviations from the plan

1. **Derived the outcome rather than adding a required options field.** Measured, argued and reported above. This is the one substantive departure.
2. **Added an own-row structural pin instead of recording a divergence that cannot exist.** Reported above.
3. **Edited two files outside my list, both forced by the pre-commit guard and both directly caused by this change:**
   - `.planning/REQUIREMENTS.md` — the BROW-02 traceability row asserted *"no node supplies serveAgent's `ledger` hook"*, which the requirements guard parses as a machine-checkable claim and which my change made false. Corrected; the box is **not** ticked, because the reading is 20-06.
   - `packages/node/src/requirements-ledger.node.test.ts` — its negative control was `expect(hookSuppliers('ledger')).toEqual([])`, i.e. exactly the absence I removed. Replaced with a **sharper** comparative reading of the same hook inside one run: the two factories supply it, the two rigs state the opt-out, and a reader that stopped discriminating breaks both halves at once. Also added `BROW-02` to `WITHOUT_A_CHECKABLE_CLAIM` — the file's own rule is that *"a row losing its checkable claim by being satisfied must be added here in the same commit"* — with the old sentence left visible rather than rewritten, per that file's own convention.
4. **`demo/index.html`'s deferral comment is NOT replaced.** 20-CONTEXT.md says the plan that flips these sites must replace it, but `demo/index.html` is not in my file list and 20-06 owns the demo. The deferral now reads against the tree: it says *"No node supplies `serveAgent`'s `ledger` hook — every production call site passes ['keeps-no-ledger'] — so the merged report has nothing else in it to present"*, and both clauses are now false at the two node factories. **Handing to 20-06**, quoted here so it is not lost.
5. **Tasks 1 and 2 landed in one commit.** `serve-agent-hooks.node.test.ts` carries edits from both and `git commit -- <path>` takes the working tree, so splitting was not possible without a stash, which is forbidden in this tree.

## An unfixed latent issue, reported not closed

`browserLabel` (`packages/browser/src/browser-id.ts`) composes `${family} ${major}` with **no bound on the major**, while `isStartBrowserLabel` admits `\d{1,4}`. A five-digit major produces a label the browser tier can generate and `parseCounts` refuses. My change handles it locally — `ownStartOutcome` returns the sentinel rather than filing an uncorroborable row — but the same label still travels on the *request* path from `demo/main.ts`'s `lastOutcome`, where it is dropped at the far end with nothing naming why. `browser-id.ts` is not in my file list. Chrome is at 141, so this is years out, but it is a real gap.

## Verification

**`npx tsc --noEmit` → exit 0.** Read directly, whole tree, no errors anywhere.

**`npx vitest run --project browser packages/browser/src/` → exit 0.** 39 files, 399 tests.

**`npx vitest run --project node` → EXIT=1**, read from `$?` on the line immediately after the command, no pipe and no trailing `tail`. Four full runs were taken across the session; the last is the reported one.

```
 Test Files  2 failed | 139 passed (141)
      Tests  2 failed | 2023 passed | 1 skipped (2026)
   Duration  240.86s
```
`/usr/bin/time -p`: `real 241.90`, `user 237.36`, `sys 37.20` — `(user+sys)/real = 1.135`, i.e. genuinely parallel and sharing the host with three other executors. The cleanest of the four runs read `1 failed | 140 passed (141)` / `1 failed | 2023 passed | 2 skipped`, `real 225.84 / user 236.27 / sys 35.46`.

**Neither failure is this plan's, attributed by measurement rather than by plausibility.**

### `bench-attestation.node.test.ts` — the index-snapshot spec, and it is in my blast radius

This is one of the two specs that snapshot `git status --porcelain` around themselves, and I edited `bin/bench.ts`, so `CLAUDE.md`'s rule applies directly: *"if it fails, check what the index was doing before you look at the code."* I did, three times, and **its own diff names the cause every time — a different agent's files each time:**

| Run | Delta between the before and after snapshots |
|---|---|
| 1 | `?? .planning/phases/phase-22-reachability-guard/` |
| 2 | `20-03-SUMMARY.md` moving out of the index, `20-01-SUMMARY.md` appearing |
| 4 | ` M packages/browser/demo/index.html`, ` M packages/browser/demo/main.ts`, ` M packages/browser/src/tab-api.ts` — 20-06 starting on the demo |

Not one of those paths is mine, and all of mine are committed. It runs **green** whenever the tree is not moving: exit 0 on its own (`real 188.13 / user 6.81 / sys 1.27`, spawn-bound), and exit 0 again beside `discover-arm.node.test.ts`, the other index-snapshot spec — 2 files, 5 tests. That is corroboration rather than only an absence, because this spec **spawns the driver**, so it exercises my `bin/bench.ts` edit end to end.

### `discovery-agents.node.test.ts` — 20-01's armed tripwire, arriving on schedule

`packages/node/src/discovery-agents.node.test.ts > criterion 2 — sample, refuse, re-pick, complete > re-picks past a node genuinely at its slot limit, on the production submit path` — `AssertionError: expected 'agreed' to be 'insufficient'`.

- `grep -cE "StartOutcome|startLedger|startReport" packages/node/src/discovery-agents.node.test.ts` → **0**. There is no path from anything I changed to that assertion.
- `git log -- packages/core/src/job/submit.ts` shows `e68455a feat(20-01): a shard that lost its executor is placed again, under a lease` landing during this run.
- 20-CONTEXT.md predicts it verbatim: *"A tripwire is already armed… **Adding the re-pick makes that test go RED, and that is CORRECT** — it is the scheduled clause arriving, not a regression. 20-04 rewrites the assertion."*

### A third failure appeared once and cleared

`enrollment-dos.node.test.ts` — `expected 0.8371757679983127 to be greater than 1.5`, an **absolute** cost-ratio floor read during a 292-second whole-suite run with three other executors on the host. Attributed structurally rather than by re-running, because *"passes in isolation"* is a claim to verify and not a diagnosis: that spec calls `serveAgent` directly with the named opt-out at both its sites, builds no `FabricNode`, and imports nothing I touched. It has read green on every run since.

### Per-package readings, all green

`npx vitest run --project node packages/net/` → exit 0, 25 files, 310 tests.
`npx vitest run --project node packages/core/` → exit 0, 30 files, 516 tests.

**Every spec that actually reads my changed files, run together → exit 0**, 9 files, 228 tests: `start-report.test.ts`, `protocol.test.ts`, `agent-contract.test.ts`, `serve-agent-hooks.node.test.ts`, `requirements-ledger.node.test.ts`, `mutation-guard.node.test.ts`, `fabric-node.node.test.ts`, `browser-node-contract.node.test.ts`, `purity.node.test.ts`.

## Concurrency notes

- Every commit used explicit paths. At the time of committing, three other agents had staged work in the index (`packages/core/src/job/submit.ts`, `packages/net/src/reduce-job.test.ts`, `tools/aot/*`); a bare `git commit` would have swept all of it.
- `tsc --noEmit` and the mutation guard both reported another agent's mid-edit `packages/core/src/job/submit.ts` — including a raw parse error (`Identifier 'gate' has already been declared`) that failed `fabric-node.node.test.ts` at transform time, and `M36`/`M45` ledger drift. **20-CONTEXT.md predicted exactly this**: *"that is not a surprise to diagnose; it is the scheduled arrival."* Nothing outside my file list was touched.
- The pre-commit guard refused three attempts on findings that were **not mine** — `M36`/`M45` drift and the unchecked-arm equality, all in `packages/core/src/job/submit.ts` and `packages/node/src/mutation-ledger.ts` while 20-01 was mid-edit. This is `#39` from 20-CONTEXT.md: *"a repo-wide guard blocks every agent when any one has an in-flight violation."* I waited it out rather than reaching for the escape hatch: **`O2_SKIP_GUARDS=1` was never set**, and every commit here passed the guards on their own terms.
- The summary commit was blocked for ~11 minutes by another agent's stalled `git commit` holding `.git/index.lock` (pid 37742, `STAT SN`, its guard subprocess already exited, committing 20-03's summary — which had in fact already landed as `ae13a4b`). I did **not** remove the lock file and did **not** kill the process; I waited, running real verification work between polls.

## What this does and does not close

- **Closes:** criterion 5's mechanism clause — every node now supplies `serveAgent`'s `ledger` hook and reported outcomes are recorded rather than discarded — and BROW-02's cross-node merge at the wire.
- **Does not close:** the reading. No tab has been shown displaying counts it could only have learned from a peer. That is 20-06, and BROW-02 stays **Partial** and unticked.
- **Not closed and not this plan's:** the row-count cap. Measured, reported, deliberately left open.
