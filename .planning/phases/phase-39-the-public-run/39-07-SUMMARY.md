# 39-07 — SUMMARY: the node lane holds 257, derived three ways, and the plan's own premise had moved twice before it ran

**The red was real, the response was a re-derivation, and the number was never computed from the old
one.** `packages/node/src/slow-specs.node.test.ts` refused at *"the node project holds 257 test files,
the recorded measurement covered 248"* — a drift of 9 against a tolerance of 5. Three routes that
share no code now read **257** and their LISTS are byte-identical in all three pairwise directions.
The whole `node` lane runs green at `Test Files 257 passed (257)`, which is the check on the
derivation rather than a restatement of it.

`.planning/REQUIREMENTS.md`, `.planning/ROADMAP.md` and `.planning/STATE.md` were **not** touched.
`RUN-01` is unchanged. No GSD state handler was run, because `STATE.md`'s frontmatter is hand-written
and tooling has wiped it twice.

Everything landed in commit **`8f7f0bd`**. `git show --stat` lists exactly `vitest.config.ts` and
nothing else: 206 insertions, 5 deletions.

## The plan's premise had moved twice before this plan ran, and the plant is where it shows

The plan was written against `files: 236` and a forecast drift of 6. Neither survived. Two passes
re-derived the field in between — `7b234b0`/`e436391` wrote **242** on 2026-09-04 and `b8a771d` wrote
**248** on 2026-09-06 with Phase 43 — and both are ancestors of this branch's base. Meanwhile nine
node-lane files arrived rather than six: Phase 38 landed three (`embedded-webview.test.ts`,
`hidden-gap.test.ts`, `check-copy.node.test.ts`) between the 2026-09-06 reading and this one.

So the plant is `248`, not the `236` the plan's parenthetical names. "The value it held before this
plan" is what the field actually held, and re-planting a two-layers-stale number would have proved
nothing about today's guard.

The plan's own objective lists six files for this phase and the launching brief listed seven. Both
are right about different things: seven files landed, and **six are in the node lane**.
`packages/node/src/funnel-probe.e2e.test.ts` moves nothing, because `relative()` in the guard filters
the `.e2e.` suffix out of `NODE_PROJECT_FILES`, which is the population the drift assertion reads.
Three more `.e2e.` files arrived from other work and are inert for the same reason.

## The derivation

Three routes, no shared code, run on the tree as the entry was written.

| route | what it models | reading |
|---|---|---|
| `npx vitest list --project node --filesOnly` | the runner's own collection | **257** |
| `git ls-files`, filtered by the project's globs and the browser/e2e/perf suffixes | the index | **257** |
| `find packages` for `*.test.ts` under a `src` path, filtered in the shell | the filesystem | **257** |

**The lists were diffed, not the counts.** All three `diff` invocations produced no output and exited
`0`:

```
=== diff A B ===
EXIT_AB=0
=== diff A C ===
EXIT_AC=0
=== diff B C ===
EXIT_BC=0
```

That empty output is the finding. The three routes disagree about what they model — one asks vitest,
one asks git, one asks the disk — so an untracked spec would have split the index route from the
other two. `git status --porcelain --untracked-files=all` reports **0** untracked test files, which
is what makes the index route a real cross-check rather than a restatement of the disk. The guard's
own reimplemented walk printed 257 in its refusal; that is a fourth reading and the one that is *not*
independent, so it corroborates and was not counted as a route.

Nine node-lane arrivals were enumerated over `b8a771d..HEAD` and none departed. That enumeration was
taken **after** the derivation and is an audit of what moved, not an input to the number — the entry
this one follows records what happens when a count is produced by adding to a stale total, and this
summary contains no arithmetic on the old value anywhere.

## The spans, and which instrument said what

Every added file was measured in **one shared twelve-file invocation** — the nine arrivals plus three
already-rowed anchors, so host load cancels instead of being assumed away — run three times with
`--reporter=json` and `tools/measure/module-span-reporter.js` attached to the *same* runs. All three
exited `0`; both instruments returned a row for all twelve and `diagnostic()` threw on none. The
figures are medians of three. "Accounted" is
`prepareDuration + collectDuration + setupDuration + duration`, which is what step 3 of the procedure
mandates and what the table records; "reported" is `--reporter=json`, which brackets from the first
case and therefore sees no import and no top-level hook.

| file | phase / lane | accounted | reported | outcome |
|---|---|---|---|---|
| `packages/node/src/switch-observation.node.test.ts` | 39-06, node | **8 957** | 8 194 | row added — **above the 1 000 ms cut** |
| `packages/browser/src/funnel-probe.test.ts` | 39-02, node | **731** | 48 | row added |
| `packages/node/src/check-copy.node.test.ts` | 38, node | **656** | 558 | row added |
| `packages/node/src/machine-claim-guard.node.test.ts` | 39-04, node | **451** | 5 | row added |
| `packages/node/src/go-no-go-checklist.node.test.ts` | 39-01, node | 116 | 53 | below the 300 ms listing floor |
| `packages/bench/src/participants.test.ts` | 39-04, node | 94 | 2 | below the listing floor |
| `packages/browser/src/embedded-webview.test.ts` | 38-01, node | 55 | 4 | below the listing floor |
| `packages/browser/src/hidden-gap.test.ts` | 38-02, node | 44 | 5 | below the listing floor |
| `packages/node/src/stage-budget.node.test.ts` | 39-05, node | 35 | 5 | below the listing floor |

`packages/node/src/funnel-probe.e2e.test.ts` has no row and must not have one: it is outside
`MEASURED_PROJECT_FILES`, so a row for it would itself be a `slow-specs/stray-path` finding.

**A third instrument, sharing no code with either.** Solo
`/usr/bin/time -p npx vitest run --project node <file>`, three rounds over this phase's six, all
**eighteen runs exit 0**, taken in one window against a boot floor of `real 0.81 / 0.81 / 0.83` s
read in the same window from the cheapest of them:

| file | solo `real` ×3 | net of the floor | accounted |
|---|---|---|---|
| `switch-observation.node.test.ts` | 9.34 / 9.39 / 9.35 s | **8.54 s** | 8.957 s |
| `funnel-probe.test.ts` | 1.16 / 1.16 / 1.16 s | 0.35 s | 0.731 s |
| `machine-claim-guard.node.test.ts` | 1.06 / 1.10 / 1.08 s | 0.27 s | 0.451 s |
| `participants.test.ts` | 1.06 / 1.02 / 1.06 s | 0.25 s | 0.094 s |
| `go-no-go-checklist.node.test.ts` | 0.83 / 0.89 / 0.84 s | 0.03 s | 0.116 s |
| `stage-budget.node.test.ts` | 0.81 / 0.81 / 0.83 s | the floor itself | 0.035 s |

**The one decision that matters is unambiguous on every instrument.** `switch-observation` is 8 540 ms
solo-net against 8 957 ms accounted — 4.7 % apart on two instruments that share no arithmetic — and
8 194 ms on the reporter. All three are more than eight times the cut. None of the other five is
within a factor of two of the cut on any instrument. The solo and accounted windows disagree freely
about the small files (`participants` reads 250 ms net against 94 accounted; `funnel-probe` 350
against 731), and that disagreement changes nothing, because no decision this table drives turns on
a file at 94 ms versus one at 250.

**`machine-claim-guard` is an import shadow of about 90x, and it is the reason step 3 is not optional
here either.** `--reporter=json` calls it a **5 ms** file; the module lifecycle reads **451**. It
reads the tree in top-level constants — the mechanism the `vocabulary` and `opt-in-only-sources` rows
already record. `funnel-probe` is 48 against 731 for the same reason. Neither straddles the cut, so
nothing behavioural turns on either; they are recorded because a pass using the reporter alone would
have called both of them sub-50 ms files and been wrong by two orders of magnitude.

**The comparative reading, because twelve files are not two hundred and fifty-seven.** The three
already-rowed anchors read high in this window against their recorded spans: `libp2p/identity` 542
against 304 (**1.78**), `slow-specs` 477 against 338 (**1.41**), `one-crypto-implementation` 393
against 316 (**1.24**). These rows are therefore upper readings rather than like-for-like with their
neighbours — the same direction the 2026-09-04 pass found. At the least favourable anchor
`switch-observation` is still 5 032 ms, five times the cut. `machine-claim-guard` at 451 is the one
row that straddles the **listing** floor under that correction (451 / 1.78 = 253); it is listed
anyway, because that floor is a presentation choice about which neighbourhood stays visible and
nothing behavioural turns on it.

## The subtrahend moved, which is the trap the plan named and it really fired

`excludedInNode` — the spans at or above `SLOW_CUTOFF_MS` that the **node** project holds — moved
**80 → 81**, because `switch-observation`'s row puts it on `SLOW_NODE_SPECS`. So `unitFiles` is
`257 - 81 = 176`, not the 177 that stepping it by the same nine as `files` would give. It was written
as 177 first, provisionally, and the identity would have refused it; it was computed before the
guard was asked.

**Confirmed behaviourally, not only by the identity.** `O2_UNIT_ONLY=1 npx vitest list --project node
--filesOnly` reads **176**, and `O2_UNIT_ONLY=1 npx vitest run --project node` exits `0` at
`Test Files 176 passed (176)`. The same list shows `switch-observation` gone from the unit lane and
the other five of this phase's six still in it — the intended shape: the fast loop sheds the file
that spawns two `workerd` processes and keeps every guard.

## The plant, watched red — and it reddened two cases, not one

`vitest.config.ts` was snapshotted immediately before planting
(`sha256 7e547af7…`), then `files` alone was set from `257` back to `248` by a one-line `sed` on line
595. `diff` against the snapshot showed exactly that one line and nothing else, which is the check
that no other writer was in the file.

`npx vitest run --project node slow-specs` with `EXIT=$?` on the next line returned **1**, at
`Tests 2 failed | 13 passed (15)`. The drift case fired with its own long refusal, verbatim:

> the node project holds 257 test files, the recorded measurement covered 248. Re-measure by the
> procedure in MEASURED_NODE_SPANS's docblock in vitest.config.ts ("So this is the procedure, and it
> is not optional"), then update MEASURED_NODE_SPANS and NODE_MEASUREMENT there. `--reporter=json` is
> step 2 of that procedure and is not sufficient alone: it stamps a file's startTime at its FIRST
> CASE, not at file pickup, so a beforeAll registered above that case is charged to nothing — on the
> 2026-08-05 run 2 retake, start-reporting.node.test.ts reported 90 ms against a real 765 ms and
> echo-guest.node.test.ts 600 ms against 255 540 ms, a factor of 426. The 1000 ms cutoff falls inside
> both gaps, so the reporter alone would keep a node-spawning spec in test:unit forever. Step 3 is
> the one that closes it: find every file whose beforeAll/beforeEach runs BEFORE its first it/test
> and does real work — the test is positional, not "has a hook", and a TOP-LEVEL hook runs first
> wherever it is written — then re-run each one alone under `/usr/bin/time -p`, bracket it with a
> solo trivial spec to subtract the ~1.2 s boot floor, and let the wall clock win where the reporter
> UNDERSTATED. Where its span already exceeds the whole solo run there is nothing to repair;
> aot-dispatch.node.test.ts is that case. Record the counts in
> NODE_MEASUREMENT.hookShadowCandidates / hookShadowDisagreed.

**The second failure was not forecast and is worth more than the first**, because it proves the
identity is load-bearing rather than decorative:

```
FAIL  |node| … > states figures consistent with the table they came from
AssertionError: expected 176 to be 167 // Object.is equality
- Expected
+ Received
- 167
+ 176
```

A wrong `files` is caught twice over: once by the drift walk, and once by
`unitFiles === files - excludedInNode`, which no longer holds when `files` moves alone. **No plant
stayed green.**

Restored by the surgical inverse of exactly that one line — `sed` on line 595, `248` back to `257`,
never `cp`. `cmp` against the snapshot exited `0` and printed nothing, and the SHA-256 of the restored
file equals the snapshot's byte for byte.

## Conditions, recorded including where nothing had to be waited for

The three shared span runs and the eighteen solo runs were taken on a quiet host and nothing had to
be waited for: the shared runs at 1-minute load `4.96 / 4.75 / 4.63` before and `4.88 / 4.63 / 4.54`
after — **0.57 to 0.62 per core** on 8 cores against the banner's ceiling of 4.00 — and every solo
run printed its own `[host conditions]` banner at **load/core 0.45 to 0.52**. `/usr/bin/time -p` over
the three shared runs: `real 10.53 / 9.76 / 9.82`, `user 4.53 / 4.27 / 4.45`, `sys 1.07 / 0.91 / 0.90`,
so `(user+sys)/real` is **0.53 / 0.53 / 0.55**. That is well under 1 and it is waiting rather than
starving — nine of the twelve files are trivial and the wall clock is dominated by one file blocked
on two `wrangler dev` children. **What was not polled: the peak load during any run.** Only start and
end were sampled, so nothing here may be read as a peak.

**Two caveats on the instruments, stated rather than left to be discovered.** The three shared runs
carry CLI `--reporter=` flags, which override the config's `reporters` array and therefore print **no
`[host conditions]` banner** — their load figures are `uptime` read immediately before and after,
which is a weaker reading than the banner's. And the host stopped being quiet partway through: by the
time the full lanes ran, `XprotectService` and a `clang++` build had taken the 1-minute load to 23
and later to 99.

That is why **`wallClockMs` and `unitWallClockMs` were deliberately not moved.** The full node lane
ran `real 289.79  user 979.39  sys 238.39`, ratio **4.20**, from load/core 1.02 to 3.48; the unit
lane's own banner printed **HOST WAS OVERSUBSCRIBED** at 2.98 before and **12.38** after and declared
every duration in that run void. Counts survive contention and wall clocks do not, so the counts were
taken from those runs and the durations were not. The 289 s figure lives in a sentence in the
docblock, not in a field.

## What the field now says, and what it deliberately still does not

| field | was | now |
|---|---|---|
| `files` | 248 | **257** — derived three ways, lists diffed |
| `unitFiles` | 168 | **176** — computed from the identity, confirmed by the runner |
| `tests` | 2 948 | **3 687** — read off a green `node` lane |
| `unitTests` | 2 317 | **2 966** — read off a green `O2_UNIT_ONLY` lane |
| `sumOfFileSpansMs` | 2 427 656 | **2 438 795** — a fourth contribution of 11 139 ms, stated as such |
| `wallClockMs`, `unitWallClockMs`, `date`, `load` | — | unchanged; the host was oversubscribed and this pass did not retake the table |
| `crossCheckedFiles` / `crossCheckDisagreed` | 206 / 177 | unchanged — see below |

The listed rows now sum to **2 423 788**, so the slack under `sumOfFileSpansMs` is **15 007** — the
previous 14 663 plus exactly the 344 ms of the five arrivals that stay below the listing floor. That
arithmetic was checked against the table by re-parsing it the way the guard does, not by hand.

**`crossCheckedFiles` was left at 206 rather than overwritten with 12.** The procedure says a pass
that skipped step 3 must write a smaller number. This pass did *not* skip step 3 — it performed it
for every span it wrote — but it performed it over twelve files rather than a project. Overwriting a
project-wide reading with a twelve-file one would lose more than it records, and the immediately
preceding incremental pass set the precedent by saying it "did not re-establish" these fields. The
twelve-file figures are recorded in the docblock where they cannot be mistaken for the project's:
**11 of 12 differ by more than 10 %**, and **0 of 12 cross the 1 000 ms cut between the two
instruments**. That zero is a positive reading rather than an absence — the same run that found no
crossing is the run that found `machine-claim-guard` at 5 ms reported against 451 accounted, so the
instrument was demonstrably able to see one.

## A defect found while reading, recorded rather than repaired

`crossCheckedFiles`, `crossCheckDisagreed`, `hookShadowCandidates` and `hookShadowDisagreed` have
disagreed with their own docblocks for twelve days. The prose says *"164 of 198"* and *"136 of 198"*;
the fields say 206/177 and 142/14. Both are real. `2e8c13f` (2026-08-26) re-ran the whole project at
206 files and moved `files`, `tests`, `sumOfFileSpansMs`, `sumOfReportedSpansMs`, both cross-check
fields, both shadow fields and both unit fields **in one hunk of a commit whose subject is a Durable
Object and whose message says nothing about it**. Nothing was fabricated and nothing was narrated, so
no docblock moved with it.

A dated note now records this on `crossCheckedFiles`. The prose itself is left standing, because
repairing a paragraph about a run nobody can re-run would be inventing it — the same rule the
`sumOfFileSpansMs` docblock already applies to its own stale sentence.

## Deviations from the plan

1. **The plant is 248, not 236.** The plan's parenthetical named a value two re-derivations stale.
2. **Nine arrivals, not six.** Three came from Phase 38 between the 2026-09-06 reading and this one.
   All nine are named in the docblock, because the entry above it records the cost of not naming an
   arrival.
3. **"One `MEASURED_NODE_SPANS` row per file" was applied subject to the table's own 300 ms listing
   floor.** The table states three paragraphs above itself that *"everything down to roughly 300 ms
   is here… faster files are omitted"*, and writing a 5 ms row would contradict the rule the table
   is built on. Four rows were added; the five files under the floor have their measured spans
   recorded in the docblock instead, so every added path still greps to at least one hit in
   `vitest.config.ts` — which is what the acceptance criterion asks for.
4. **`tests` and `unitTests` were re-derived**, as the plan asks, from two green lanes. The plan also
   says to derive them "from the same run route A used"; route A is `vitest list`, which counts no
   tests, so they come from the full runs instead and the summary says which.
5. **The commit prefix is `measure(39-07):` rather than the plan's literal `test(39):`.** This file's
   own history uses `measure(vitest):` for exactly this operation twice, and nothing about test
   behaviour changed.
6. **A mechanical error, caught and recorded.** The first attempt to insert the four rows lost every
   single quote, because the insertion text was nested inside a single-quoted shell string under zsh —
   the rows landed as `[packages/…, 8_957],`, which is not valid TypeScript. It was caught within one
   command by re-parsing the table the way the guard does and seeing the row count still at 134, and
   repaired by rewriting exactly those four lines. Nothing else was touched and no whole-file restore
   was used.

## What was not done

- **The full step-3 retake of the project was not performed.** 257 files with two instruments is a
  ~290 s run plus reconciliation, the plan does not ask for it, and the fields it would move are
  named above as unchanged.
- **The `aot` lane was not run.** It is a separate lane by owner ruling, nothing in it asserts on a
  file count, and folding it in is the thing the tree's conventions forbid.
- **`aotCrossCheckedFiles` is still 11 against an `aot` project that holds 13.** That gap was
  recorded by the 2026-09-04 pass and is still owed a retake; this plan's red was entirely in the
  node half.
- **No duration was recorded from an oversubscribed run.** The banner declared the unit lane's wall
  clock void and it was not written down.
- **`FILE_COUNT_TOLERANCE` was not touched.** It is 5, it fired at 9, and re-deriving the count is the
  response its own docblock designs for. Nothing here argues it is the wrong number.

## Every command, with the exit code read on the line immediately after it

| command | exit |
|---|---|
| `npx vitest run --project node slow-specs` (before the fix — the red) | **1** |
| `npx vitest list --project node --filesOnly` (route A) | **0** |
| `git ls-files` (route B) | **0** |
| `find packages -path … -name '*.test.ts'` (route C) | **0** |
| `diff routeA routeB` / `diff routeA routeC` / `diff routeB routeC` | **0 / 0 / 0**, no output |
| `npx vitest run --project node slow-specs` (after `files` → 257) | **0**, 15 passed |
| shared span invocation ×3, both instruments | **0 / 0 / 0**, 12 files, 196 tests, 0 failed |
| solo `/usr/bin/time -p` ×18 (6 files × 3 rounds) | **0** ×18 |
| `npx vitest run --project node slow-specs` (after rows + docblocks) | **0**, 15 passed |
| `O2_UNIT_ONLY=1 npx vitest list --project node --filesOnly` | **0**, 176 files |
| `npx vitest run --project node slow-specs` (**planted at 248**) | **1**, 2 failed / 13 passed |
| `cmp snapshot vitest.config.ts` (after surgical restore) | **0**, silent |
| `npx vitest run --project node` (**the whole lane, alone**) | **0**, `Test Files 257 passed (257)`, `Tests 3685 passed \| 2 skipped (3687)` |
| `O2_UNIT_ONLY=1 npx vitest run --project node` | **0**, `Test Files 176 passed (176)`, `Tests 2966 passed (2966)` |
| `npx vitest run --project node slow-specs vocabulary opt-in-only-sources host-conditions-wired` | **0**, 4 files, 52 tests |
| `git commit -- vitest.config.ts` (pre-commit cheap guards ran: 9 files, 401 tests) | **0** |

## Self-Check: PASSED

- `vitest.config.ts` — FOUND, `files: 257`, `unitFiles: 176`, `tests: 3687`, `unitTests: 2966`,
  `sumOfFileSpansMs: 2_438_795`
- commit `8f7f0bd` — FOUND; `git show --stat` lists exactly `vitest.config.ts`, 206 insertions,
  5 deletions
- `.planning/phases/phase-39-the-public-run/39-07-SUMMARY.md` — FOUND
- each of this phase's six node-lane paths greps to at least one hit in `vitest.config.ts`
- `packages/node/src/funnel-probe.e2e.test.ts` has **no** `MEASURED_NODE_SPANS` row, which is correct
- the span table is still in descending order and parses to 138 rows summing to 2 423 788
- `git status --porcelain` reports the tree clean after the commit; no untracked files were left
- `.planning/REQUIREMENTS.md`, `.planning/ROADMAP.md` and `.planning/STATE.md` are untouched — they
  do not appear in `git show --stat` and the tree is clean
- this summary contains no arithmetic on the superseded value
