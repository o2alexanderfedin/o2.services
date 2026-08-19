---
phase: phase-22-reachability-guard
amended: 2026-08-18T17:05:00Z # SECOND amendment. Criterion 1 NARROWED again, 2 open to 1, and is STILL DECLINED; see the AMENDMENT at the end of this file
status: gaps_found # UNCHANGED. Criterion 1 is still PARTIAL — on ONE named symbol, core/isComplete
score: 2/3 criteria MET (1 PARTIAL, 0 FAILED) — UNCHANGED. The gap is one symbol wide; it is not closed
original_status: gaps_found
original_score: 2/3
date: 2026-08-08
verified_at: d7beefe
amended_at: 9035ee6 # branch feature/phase-20-checkpoint-agent; second amendment. First amendment was 14a2670,
                   # code for it at f65ada1 and 14a2670; this one's code is f5a8c66, 0bbddb4 and 9035ee6
requirements: [WIRE-02]
amendment_runs: # exit codes read with EXIT=$? on the line immediately after the command, no pipes
  - command: "npx tsc --noEmit"
    exit: 0
    result: "no output"
  - command: "npx vitest run --project node packages/node/src/reachability-guard.node.test.ts"
    exit: 0
    result: "1 file, 35 passed (35)"
  - command: "npx vitest run --project node"
    exit: 1
    result: >-
      197 files, 195 passed | 2 failed; 2937 passed | 1 skipped | 6 failed (2944); real 472.08
      user 693.81 sys 97.07, i.e. (user+sys)/real = 1.68. BOTH failing files are pre-existing and
      neither is this pass's: `slow-specs.node.test.ts` on the file-count drift (197 node spec
      files against a recorded 191 — no test file was added or deleted here), and
      `vocabulary.node.test.ts` × 5 on `.planning/milestones/v1.1-ROADMAP.md`, a file this pass
      never touched, committed at `6b99588`.
  - command: "npx vitest run --project browser packages/browser/src/streaming-load.browser.test.ts"
    exit: 0
    result: "3 files, 114 passed (114)"
  - command: "npx vitest run --project node <the nine specs of every edited module>"
    exit: 0
    result: "9 files, 244 passed (244)"
  - command: "npx vitest run --project node requirements-ledger + acceptance-traceability + mutation-guard"
    exit: 0
    result: "3 files, 256 passed (256)"
---

# Phase 22 — Reachability Guard · Verification

**2 of 3 criteria met. Criterion 1 is DECLINED, and it is declined on the reading rather than on
the instrument.** The guard exists, catches both named defects, and gates every commit. What it
reports is that 67 of 217 callable barrel exports have no traced path from the five entry points,
47 of them with no production caller anywhere. Criterion 1 asks for *"passes clean"*, and this
tree does not.

## Criterion 1 — DECLINED

> *Running the reachability guard after Phases 11-21 land passes clean — every capability exported
> from a package barrel has a traced call path from one of the five runnable entry points.*

**It does not pass clean.** Measured 2026-08-08 at `d7beefe`, over 217 callable exports across
eight barrels, 139 production files, 1 827 declaration nodes and 698 callers:

| | |
|---|--:|
| unreachable from the five entry points | **67** |
| …disposed with a stated cause | 20 |
| …**open, with no production caller anywhere** | **47** |

The 47 are the milestone's own subject seen from the other side: *"Wire What Was Built"* left this
many exported capabilities unwired. `sweepNodeCount` is the clearest single case — its own barrel
documents it as *"a separate question and is not settled here"*.

**RULING A forbids closing this by rewriting the criterion**, and it is not closed. Two things that
are *not* the reason for the decline, said so they are not mistaken for it:

- **Not an instrument failure.** The tracer's resolving power is measured inside one run: the same
  corpus at module granularity reports **0** unreached against the declaration arm's 67, a gap of
  67 against a stated floor of 20 whose breaking value is 0. Five known-TRUE anchors, each on a
  different edge class, all report reachable; two known-FALSE anchors, verified by grep
  independently, report unreachable and can be made to flip.
- **Not a disposition shortfall.** The owner ruled that only symbols with a stated cause get an
  entry. Disposing the other 47 would have made criterion 1 pass and the guard decoration — the
  exact failure `22-CONTEXT.md` § *The disposition register, not an allow-list* names.

**What would close it:** wiring the 47, or retiring the ones that are genuinely superseded. That is
work this milestone did not do, and the ceiling holds the number still meanwhile.

## Criterion 2 — MET

> *Reintroducing the original defect — commenting out a wired call site, or adding a new
> exported-but-uncalled function — fails the guard, naming the unreachable symbol and the barrel it
> came from.*

Both halves, each watched red, each restored and `cmp`-confirmed:

- **Commenting out a wired call site.** `tools/aot/lift.ts:1158`'s `translationCid` call. Two cases
  failed — *"aot/translationCid is wired and must not be reported unreachable"* — and the finding
  count moved 58 → 60.
- **A new exported-but-uncalled function.** Added to `packages/aot/src/cache-key.ts` and exported
  from the barrel the way that barrel already exports things. The message names both halves:
  `@o2/aot exports "plantedCacheSummary" (packages/aot/src/cache-key.ts) — no production code calls
  it, so no path reaches it from any of the 5 entry points`.

Neither substitutes for the other, which is why criterion 2 names both: A is a wiring regression
that adds no symbol, B adds a symbol and breaks no path.

**The naming clause is asserted as two independent `toContain`s**, following `purity.node.test.ts`,
so a wording change cannot turn it into a false red that gets fixed by loosening the guard.

## Criterion 3 — MET, with the substitution stated

> *The guard runs as part of the same CI gate as the rest of the suite, so a future change that
> builds a mechanism without wiring it to an entry point fails CI rather than merging silently.*

**Demonstrated, not asserted.** A real commit adding an unwired export was attempted and the hook
refused it at exit 1, naming `aot/gateProofUnwired` inside the finding list.

**The substitution is stated rather than assumed: there is no CI and there must not be one.**
`disclosure-gate.node.test.ts` asserts `.github/workflows` does not exist — DEMO-04, because public
hosting is public disclosure and the EPO and China have no patent grace period. `.githooks/pre-commit`
is this repository's only gate, and the hook records that so nobody "fixes" the absence.

Cost is comparative, in one run window: six guards **2.96 / 3.13 s**, seven **3.40 s** — +12% wall
clock, +80% CPU, with the breaking value written at the line (more than 2× and it comes out).

## What this phase corrected in its own planning documents

Six claims the plans made about the tree measured false and were reported rather than adjusted
around — the habit the phase exists to enforce, applied to the phase:

1. The corpus was 209 callable / 581 total / 869 files; it is **217 / 604 / 907**.
2. `core/delegate` — the plan's known-FALSE anchor — **changed sides**; Phase 23 gave it a module-scope caller in `bin/bench.ts`.
3. The five-module entry set **no longer holds silently**; the three unnamed runnable modules now rescue four `@o2/aot` symbols. Put to the owner and answered.
4. `runTaskAndPost` is **not** reachable only through the `?worker` edge — it has two independent paths.
5. `estimatePi` is **not** called inside `pi.ts`; nothing calls it anywhere.
6. `FabricNode.start` has **six** production call sites across four files, not one, so the blast-radius plant the plan describes is not obtainable.

## Two defects in the instrument, both found by watching a plant rather than by reading

- The first graph had **zero edges** — a trailing-slash root and the API's lowercased paths. Loud, and the anchors caught it in one run.
- The reference edge class counted **type annotations** as call paths, so `let node: FabricNode | undefined` kept `FabricNode` reachable with its call site removed. Silent, and it moved the reading 58 → 67 once fixed. This is the over-connection failure `22-CONTEXT.md` names as the dangerous one, and it would have shipped as a clean run.

## Unscored, and stated so it is not read as scored

- **WIRE-02 is `Partial`, not `[x]`.** The ledger refused the `[x]` across four
  `acceptance-traceability` cases. The guard is delivered; the finding is open.
- The guard reads a **static** call graph. Everything behind `demo/main.ts`'s `window.o2` assignment
  is unreachable by construction — 12 findings — and that is a fact about static tracing, not about
  the browser tier. Extracting `index.html`'s inline script would close it properly.
- **Liveness is not correctness.** Every liveness case passes for a tracer wrong in some middle way;
  correctness rests on the anchors.

## Evidence

```
tsc --noEmit          exit 0
tracer + guard        exit 0    57 passed
mutation-guard        exit 0   151 passed
slow-specs            exit 0     9 passed
ledger + traceability exit 0    61 passed  (same count before and after the REQUIREMENTS.md edit)
npm run test:unit     exit 0   111 files   1697 passed   real 22.71
gate refusal proof    exit 1   naming aot/gateProofUnwired
```

Plants: 11 planted, 11 watched red, 11 restored by the surgical inverse with `cmp` exit 0.

---

# AMENDMENT — 2026-08-18, criterion 1 is NARROWED from 47 open to 2, and still DECLINED

**Amended:** 2026-08-18T09:55:00Z
**Code commits:** `f65ada1` and `14a2670` on branch `feature/phase-20-checkpoint-agent`
**Host:** MacBookPro18,3, 8 cores, 32 GB, Darwin 25.5.0
**Status after amendment:** `gaps_found` — unchanged
**Score after amendment: 2/3** — unchanged. Criterion 1 is still PARTIAL, on **two** named
symbols instead of forty-seven.

Everything above this line stays as written. Its verdict was right, its refusal to close the
criterion by mass-disposal was right, and this amendment is that refusal being honoured rather
than reversed: thirteen of the fifteen remaining findings closed by **wiring**, by **retiring**,
or by a **stated cause somebody ruled on**, and the two that could be closed only by inventing a
caller are still open and still named.

---

## RULING A held. Nothing here rewrites the criterion.

The criterion still reads exactly as it did:

> *Running the reachability guard after Phases 11-21 land passes clean — every capability exported
> from a package barrel has a traced call path from one of the five runnable entry points.*

**It still does not pass clean, so criterion 1 does not tick.** `core/localDispatch` and
`core/isComplete` are callable barrel exports with no traced path and no disposition. Two is not
zero, and this pass declines to make it zero the two ways that were available: adding a call site
that exists to be counted, or retiring an export to move a question out of the instrument that
holds it.

## The superseded verdict, quoted before it is replaced

From **Criterion 1 — DECLINED**, and this is the table this amendment moves:

> | | |
> |---|--:|
> | unreachable from the five entry points | **67** |
> | …disposed with a stated cause | 20 |
> | …**open, with no production caller anywhere** | **47** |

and the closing condition the same section states in its own words:

> **What would close it:** wiring the 47, or retiring the ones that are genuinely superseded. That
> is work this milestone did not do, and the ceiling holds the number still meanwhile.

and the refusal that governs this pass:

> - **Not a disposition shortfall.** The owner ruled that only symbols with a stated cause get an
>   entry. Disposing the other 47 would have made criterion 1 pass and the guard decoration — the
>   exact failure `22-CONTEXT.md` § *The disposition register, not an allow-list* names.

## The reading now

Measured 2026-08-18 by calling the guard's own exported API — `barrelExports()`,
`buildCallGraph()`, `unreachableExports()`, `disposedKeys()` — over this tree, and cross-read
against the spec's own zero-ceiling plant. The corpus is **687 barrel exports, 251 of them
callable**; the rest are type-only and out of jurisdiction by construction.

| | before this pass | after |
|---|--:|--:|
| unreachable from the five entry points | **75** | **68** |
| …disposed with a stated cause | 60 | 66 |
| …**open, with no production caller anywhere** | **15** | **2** |

**The "before" column is not the 67/20/47 above.** Ten phases of work sit between them, and the
75/60/15 reading was reproduced from scratch at the start of this pass rather than inherited —
it is what the tree said before a line of it was touched.

## The thirteen, by route, because the routes are not equivalent

### Wired — a real production call site now exists (2)

- **`aot/describeRefusal`.** `tools/aot/lift.ts`'s `describeLiftFailure` rendered a screening
  refusal as the discriminant alone, so the one sentence this function exists to produce — *"built
  for machine 62 (x86-64), not AArch64 … cross-compile it for aarch64 and translate that"* —
  reached nobody outside `elf.test.ts`. It now renders `describeRefusal(failure.reason)`, on the
  path `tools/aot/cli.ts:346` writes to stderr. The row's own words were *"Nobody has decided
  whether the lift driver should print it, and nothing in the source declines to."* Somebody
  decided, in the direction the row left open. No test pinned the old sentence — checked before
  the edit, not after: the only case over that arm is a mapped-type completeness scan asserting
  the rendering is longer than ten characters and is not `[object Object]`.
- **`core/checkLease`.** The predicate was hand-inlined at two sites of `job/submit.ts`'s lease
  loop, `at >= lease.expiresAt` and `woke >= lease.expiresAt`. `checkLease(lease, now).expired` is
  that comparison exactly — the function returns its `expired: false` arm only when
  `expiresAt > now` — and `lease.test.ts:213` already pinned the boundary instant, so the
  equivalence is spec-held rather than comment-asserted. Behaviour-neutral. **The row's deferral
  is untouched and is not claimed closed**: nobody has wired self-termination into an executor,
  and this is not that. What closed is the narrower thing the guard asserts.

### Retired from a barrel — declaration, docblock and spec all untouched (5)

Every one of these has a spec that imports it **module-relative**, so nothing that was measured
stops being measured. What stops is the barrel advertising a capability nothing consumes.

- **`browser/cacheVerdict`, `browser/describeCacheVerdict`, `browser/measureRepeatLoad`**, and
  with them the three types that only they produce. This is the two-visit code-cache measurement,
  and the precedent is **in the same file**: `CODE_CACHE_EVIDENCE`, `CODE_CACHE_BLIND_SPOTS`,
  `CODE_CACHE_HARNESSES`, `codeCacheHarnessFor` and `describeCodeCacheEvidence` are declared in
  `streaming-load.ts` and were already deliberately kept off the barrel for exactly this reason.
  Wiring them was considered and refused on the merits: a verdict needs two loads of one URL in
  one page, and the production path loads **once** and reports `cacheEligible` off a byte count.
  Manufacturing the second load would be inventing a measurement.
  **A FALSE REASON was found and corrected rather than carried out of sight.**
  `measureRepeatLoad`'s row read *"Driven by `code-cache.e2e.test.ts` as a measurement"*. That was
  never true: `code-cache.e2e.test.ts` imports `loadArtifact` and nothing else from that module.
  The only driver of all three is `streaming-load.browser.test.ts`.
- **`core/settleRace`.** The one site that would consume it refuses it **in writing on a
  correctness ground**: `job/submit.ts` compares CIDs directly rather than re-deriving a winner
  from arrival instants, because *"on a clock that reports the same instant for both, it could
  name the **loser** as the winner, overturning a decision this module has already taken and
  already closed a lease against."* A barrel entry for it is an invitation to make the mistake
  that comment exists to prevent.
- **`core/startReport`.** Genuinely superseded, which is the criterion's own word: production
  folds **counts**, `StartOutcomeLedger#report()` calls `startReportFromCounts` directly, and
  nothing in the tree ever holds a `readonly StartOutcome[]` to hand this overload. **The
  declaration is kept and its docblock now says why**: `start-outcome.test.ts` uses it as a
  *differential oracle* against the ledger's fold, so deleting it would remove a check rather than
  dead code.

### Re-caused into `DISPOSITIONS` — no call path is gained, and none is claimed (6)

- **`node/relayAddrForHost` → `HIDDEN_BY_DISPATCH`, `proxy-trap-dispatch`.** This symbol **runs in
  production**, on every `/bootstrap.json` request, and its open row already said so and named the
  whole mechanism. It was held open on an explicitly stated ground: *"re-causing a symbol is a
  decision to **put** rather than to take in passing … Moving this row would lower the residue by
  one on nobody's ruling."* The ruling is now somebody's. **The mechanism was re-measured on the
  day it moved rather than copied from the row**: `packages/node/src/seed-server.ts#configureServer`
  is a graph node, its in-degree is **0**, and rooting it flips exactly
  `["node/relayAddrForHost"]`. The guard re-measures all three legs on every run — see Plant G.
- **The five `ed25519-backend.ts` rows → `DEFERRED_IN_SOURCE`**: `core/createNobleSyncVerifier`,
  `core/Ed25519NotInitializedError`, `core/getAsyncVerifier`, `core/getSyncVerifier`,
  `core/initEd25519`. Their shared reason ended *"An open decision, not a decision against
  wiring."* **That was false when it was written.** CRYPTO-03 had already ruled, with measurement:
  routing the nine direct verification sites through the port *"would select nothing"* — the
  backend union has one member and the initialiser sets the sync verifier to the noble arm
  unconditionally — and it *"would only **add** a failure mode the trust path does not have"*. Its
  sentence, which the entry carries: *"The port therefore stays unwired **as a decision** rather
  than as a deferral."*
  Both other routes are closed for these five, and neither closure is a preference.
  **Wiring is affirmatively wrong**, and would also redden `requirements-ledger.node.test.ts`,
  which holds WIRE-02's own sentence that `getSyncVerifier` has no production caller.
  **Retiring is blocked**: `libsodium-absence.e2e.test.ts` imports two of the five *from the
  `@o2/core` barrel* to build the page CRYPTO-05 gzips against `VERIFIER_BUDGET_BYTES`, so
  removing them from the barrel would delete a measurement rather than a capability.

## The two that remain, and why each is left open rather than closed

This is the part of the amendment that decides the score, so it is argued rather than asserted.

### `core/localDispatch` — a PARKED OWNER DECISION, and the honest answer is (c)

Three possibilities were checked against the tree and only the third survives.

1. *Is there a real production destination?* **No.** `packages/net/src/reduce-job.ts:510` composes
   `remoteCombineDispatch` once and unconditionally and wraps it at `:516`. A requestor's own
   combines go out over RPC like everyone else's; nothing composes the "local blockstore plus pure
   combiner" form.
2. *Does the source decline it in writing?* **No.** `net/combine.ts:4` names the pair and draws the
   contrast — *"The remote sibling of `localDispatch`"* — and says nothing against wiring it. A
   `deferred-in-source` row here would be a cause invented for the occasion, which is the failure
   `HIDDEN_BY_DISPATCH`'s own docblock says this register must not commit.
3. *Is it a genuine open owner call?* **Yes.** Does `reduce-job`'s dispatcher want a local combine
   arm? Nobody has built one and nobody has decided to.

Retiring the barrel export was considered and refused: `reduce.test.ts` exercises this function
under twenty-odd cases, it is a real capability, and hiding it from the barrel would remove the
question from the one instrument that holds it without answering the question. **So it stays open,
criterion 1 does not close clean, and this pass says so plainly.**

### `core/isComplete` — no honest site exists, and retiring it would move a gap out of sight

The prior classification suggested wiring this, on the ground that `remainingWork` — the function
`isComplete` is `remainingWork(x).length === 0` over — is now production-reached from
`bin/agent.ts`'s `--coordinate` leg. That was checked at the site and **does not hold**:

- The `--coordinate` leg's only consumer of a recovered checkpoint is a JSON report that already
  prints `remaining: [...remainingWork(recovered.checkpoint)]` in the same object. A `complete`
  field beside it is the same fact twice, added to make a list shorter.
- `submit.ts`'s resume branches **per partition**; an early return on a whole-job boolean would be
  a behaviour change for a case nobody has asked about.
- Retiring the export was refused for a specific reason rather than a general one: **CHURN-03 still
  holds `isComplete has no production caller` as the stated reason its own box does not tick**, and
  `requirements-ledger.node.test.ts` reads that sentence. Taking the symbol off the barrel would
  make this instrument green while the other one still carries the gap — which is decoration by a
  different route.

So the row stays, with its reason re-read and extended to record all of the above.

## Ceilings

Both moved, and they moved in opposite directions in the same change, which is stated here because
that is exactly the shape a reader should be suspicious of.

- **The total, 78 → 68.** 78 was recorded on 2026-08-17 and was **not a reading of this tree**: the
  2026-08-18 `--coordinate` change wired `core/remainingWork` and `core/checkpointChain` and moved
  `core/checkpointsInto` to a traced route, leaving three entries of slack. The live reading at the
  start of this pass was 75, and it is 68 now.
- **`DISPOSITION_CEILING`, 60 → 66, and this is the only number here that goes up.** It absorbs the
  six re-caused symbols. Every prior raise in that constant's history absorbed symbols that had
  just been *created and wired* behind `window.o2`; this one absorbs symbols that already existed
  and already counted. **The defence is the arithmetic beside it**: the population the ceiling
  bounds fell 75 → 68 in the same change, and the undisposed residue fell 15 → 2. A register that
  grows while the thing it excuses shrinks is the good direction; a register that grows while the
  total holds still is the alarm this constant exists to sound. Both figures are recorded at the
  constant so the next reader can tell which one they are looking at, and the no-slack rule is
  kept — 66 is exactly the register's size.

## One guard case was changed, and it is a check MOVED rather than relaxed

`WIRE-02`'s anti-vacuity pair asserted that `OPEN_FINDINGS` itself exhibits both values of the
`callers` column. With the residue at two rows, both `'none'`, that went red on a register that had
stopped being wrong about anything — the failure mode of a proxy. The claim worth holding is *"the
instrument can still tell the two apart"*, and it is now read where that is a fact about the
instrument: over the **whole** unreachable population, **10 `'none'` / 58 `'unreachable-only'`
across 68 findings**, measured. The per-row re-measurement — the load-bearing half, the one Plant C
reddened on 2026-08-14 — is untouched and still fails per row at any register size. The previous
form was satisfiable by two hand-written rows; this one is satisfiable by no hand-written row at
all.

## Plants — four, each watched red, each restored by the surgical inverse

`--project node`, exit 1 read directly with `EXIT=$?` on the line after the command, no pipes.
Each file was snapshotted with `cp` **and** `shasum -a 256` immediately before planting, restored
by reversing exactly the lines the plant changed, then `cmp`-verified against that snapshot —
**all four `cmp`s exited 0**, all four hashes matched, and `git status --porcelain` was empty after
each.

**Plant D — a newly-wired symbol loses its call site.** `tools/aot/lift.ts`, one line: the
`describeRefusal(failure.reason)` interpolation replaced by a literal. **3 failed | 32 passed:**

```
AssertionError: these callable barrel exports have no call path from any of the five entry
points and are in neither register. Wire them, or add a row to OPEN_FINDINGS with a reason a
reader can check — a count no longer covers for them: expected [ 'aot/describeRefusal' ] to
deeply equal []
```

with the count ceiling beside it: *"the guard found 69 unreachable callable barrel exports … expected 69 to be less than or equal to 68"*.

**Plant E — the same, for the other wire.** `packages/core/src/job/submit.ts`, two lines: both
`checkLease(lease, …).expired` calls put back to the `>=` comparison they replaced. **3 failed |
32 passed**, same assertion, `expected [ 'core/checkLease' ] to deeply equal []`.

**Plant F — a NEW exported-but-uncalled function**, repeated from 2026-08-14's Plant A because the
population it is asserted over changed. `packages/demo/src/index.ts`, +4 lines. **3 failed | 32
passed**, `expected [ 'demo/plantedUnwiredCapability' ] to deeply equal []`.

**Plant G — the new hidden-caller row names the wrong member.** `relayAddrForHost`'s `through`
planted from `…seed-server.ts#configureServer` to `…#bootstrapInfoFor`, a member the graph *can*
see. **1 failed | 34 passed**, and only the mechanism case moved:

```
AssertionError: packages/node/src/seed-server.ts#bootstrapInfoFor has a caller the graph CAN see,
so "proxy-trap-dispatch" is not what hides node/relayAddrForHost — the row names the wrong
mechanism: expected 1 to be +0
```

This is the one that matters for a disposition arriving: it proves the new row is held against the
real graph rather than against its own prose.

**A fifth reading, not a plant in the same sense.** The total ceiling was set to 0 and the guard
reported, verbatim, *"the guard found 68 unreachable callable barrel exports … expected 68 to be
less than or equal to 0"*. `75 − 7 = 68` was refused as the proof. **And the note that recorded it
was corrected against its own output**: this assertion carries a *count*, not a list, so the claim
that it "named all sixty-eight" would have been describing output nobody saw. The names were taken
separately by calling `unreachableExports` outside the runner, and all seven departing symbols are
absent from the 68 it returns.

## What is NOT claimed

- **Criterion 1 is not met.** Two capabilities on two barrels have no call path from any of the
  five entry points. The phase stays 2/3 and stays `gaps_found`.
- **Six symbols moved into `DISPOSITIONS` and five of those six still have no caller of any kind.**
  A `deferred-in-source` row records *who decided not to wire it and on what measurement*; it does
  not manufacture a path, and this pass does not pretend it does. Only `node/relayAddrForHost`
  among the six actually runs.
- **Nothing was disposed to make a number smaller.** Every one of the six carries a ruling that
  predates this pass — CRYPTO-03 for five of them, and for the sixth a mechanism its own open row
  had already measured and written out in full.
- **The `slow-specs/file-count-drift` finding is red and is not this pass's.** The node project
  holds 197 test files against a recorded 191; no test file was added or deleted here. Both commits
  used `O2_SKIP_GUARDS=1` **for that one finding**, with the reason in the message, after running
  all seven hook guards by hand and reading the results directly. The five `vocabulary` findings
  the hook printed are in `.planning/milestones/v1.1-ROADMAP.md`, untouched here, and the hook
  itself classified them as *"outside this commit — reported, not blocking"*.

---

# AMENDMENT — 2026-08-18 (second that day), criterion 1 is NARROWED from 2 open to 1, and still DECLINED

**Amended:** 2026-08-18T17:05:00Z
**Code commits:** `f5a8c66`, `0bbddb4`, `9035ee6` on branch `feature/phase-20-checkpoint-agent`
**Host:** MacBookPro18,3, 8 cores, 32 GB, Darwin 25.5.0
**Status after amendment:** `gaps_found` — unchanged
**Score after amendment: 2/3** — unchanged. Criterion 1 is still PARTIAL, on **one** named symbol
instead of two.

Everything above this line stays as written, including the first amendment. This one closes one of
the two symbols that amendment named, by the only route it counts as work: **production calls it
now.** Nothing was disposed, nothing was retired from a barrel, and the remaining symbol is
reported rather than made to disappear.

---

## The superseded verdict, quoted before it is replaced

From the AMENDMENT of 2026-08-18T09:55:00Z, § *RULING A held. Nothing here rewrites the criterion*:

> **It still does not pass clean, so criterion 1 does not tick.** `core/localDispatch` and
> `core/isComplete` are callable barrel exports with no traced path and no disposition. Two is not
> zero, and this pass declines to make it zero the two ways that were available: adding a call site
> that exists to be counted, or retiring an export to move a question out of the instrument that
> holds it.

and the table it moved:

> | | before this pass | after |
> |---|--:|--:|
> | unreachable from the five entry points | **75** | **68** |
> | …disposed with a stated cause | 60 | 66 |
> | …**open, with no production caller anywhere** | **15** | **2** |

and, from `OPEN_FINDINGS`' own row for the symbol that has now left it:

> Nobody has built a local-only combine path and nobody has decided to. **This is the whole of why
> criterion 1 does not close clean, re-read 2026-08-18, and it is a PARKED OWNER DECISION rather
> than a gap somebody forgot.**

**The parked decision was taken.** Owner ruling, 2026-08-18, verbatim: *"Always prefer local
execution, unless it must be executed remotely (requested to do so, or needs certain permissions
that cannot be satisfied or data ownership requires, etc.) or the current node is fully loaded."*

## The reading now

Measured by calling the guard's own exported API over this tree — `barrelExports()`,
`buildCallGraph()`, `unreachableExports()`, `disposedKeys()` — run under
`node --experimental-strip-types`, exit `0`:

| | before this pass | after |
|---|--:|--:|
| unreachable from the five entry points | **68** | **67** |
| …disposed with a stated cause | 66 | **66** |
| …**open, with no production caller anywhere** | **2** | **1** |

```
unreachable 67
disposed 66
open 1
openKeys ["core/isComplete"]
```

`68 − 1 = 67` was refused as the proof, per this file's standing habit: the number above is what
the probe printed, and the open list is a **list** rather than a count, so the remaining symbol is
named rather than inferred. `DISPOSITION_CEILING` did not move — this is wiring, not a cause being
written down — and the total ceiling in `reachability-guard.node.test.ts` followed the measurement
down, **68 → 67**, with the note recording the route.

## What the wiring is

`core/localDispatch` is now composed by `@o2/net`'s `reduceJob` as the `dispatch` half of a
`LocalCombinePlacement`, so a requestor performs a combine **in its own process** whenever its own
capacity and its own authorizer admit it, and walks the rendezvous ranking only for the combines
they refuse. The two ports are the ones a peer answers a combine with — `LocalAdmission.would` and
the node's `Authorizer` — asked in `runCombine`'s own order, so a requestor is not more permissive
to itself than to everybody else. `packages/browser/demo/main.ts` supplies both from the tab that
is running the job.

**This is a real call path and not a decoration.** The guard re-derives it on every run: deleting
the `localDispatch(` call in `reduce-job.ts` would put the row back, and the row is gone because
the path is there.

## Criterion 1 does NOT close, and here is exactly what remains

The criterion still reads:

> *Running the reachability guard after Phases 11-21 land passes clean — every capability exported
> from a package barrel has a traced call path from one of the five runnable entry points.*

**One capability does not: `core/isComplete`.** One is not zero. Its `OPEN_FINDINGS` row is
unchanged and was re-read again here rather than re-stated:

- **Wiring it would be the same fact twice.** `bin/agent.ts`'s `--coordinate` leg already prints
  `remaining: [...remainingWork(...)]` in the same JSON object. A `complete` field beside it would
  be a boolean over a list already in the frame, added to make this list shorter — which is a call
  site that exists to be counted, the exact thing the first amendment refused.
- **Retiring the export would move the question out of the instrument that holds it.** CHURN-03's
  ledger row states `isComplete has no production caller` as the reason its own box does not tick;
  taking the symbol off the barrel would silence the guard and leave that row unsupported.
- **Disposing it would be widening what counts as passing.** There is no mechanism hiding this
  symbol from the graph — no global-object hop, no proxy trap, no source sentence declining it. A
  `DISPOSITIONS` row would be a cause invented for the occasion, which is the failure
  `22-CONTEXT.md` § *The disposition register, not an allow-list* names.

So the honest call is the one the first amendment made about two symbols, made again about one:
**the phase stays `gaps_found` at 2/3**, and closing criterion 1 requires an owner decision about
`isComplete` — wire it and accept the duplicated fact, or rule the duplication acceptable grounds
for a disposition. Neither is this pass's to take.

## What is NOT claimed

- **Criterion 1 is not met.** `core/isComplete` has no traced path from any of the five entry
  points and no disposition.
- **Nothing was disposed to obtain the lower number.** `DISPOSITION_CEILING` is untouched at 66 and
  no barrel lost an export.
- **The reduce curve `bin/bench.ts` publishes is unaffected**, and deliberately so: that driver
  states `placement: 'requires-remote-combining'`, because every reduce figure it publishes —
  `combineExecutors` off `executedBy`, `recomputes`, `treeDepth` — is a measurement of the
  *fabric's* combine placement. An instrument pins the variable it measures.
- **A locally combined aggregate is self-attested, and that is carried rather than hidden.**
  `ReduceOutcome.locallyCombined` names every combine the requestor performed, and
  `reduceJob`'s `aggregateAttestation` reads the named absence with a reason that says the
  aggregation *"was performed by the party that wanted the answer"*. Whether that is acceptable for
  the public tier is an open question for the owner — recorded in
  `.planning/consults/2026-08-18-owner-ruling-prefer-local-execution.md`, not settled here.
