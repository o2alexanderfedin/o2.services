# The node lane re-measured — 242 files, derived three ways, and a standing offset of four

**Date:** 2026-09-04
**Branch:** `feature/node-lane-re-measure`
**Files changed:** `vitest.config.ts` (and this document)
**Trigger:** `packages/node/src/slow-specs.node.test.ts` went red when plan 42-01 landed
`packages/core/src/sealed-secret.test.ts`, taking the file-count drift to 6 against a
`FILE_COUNT_TOLERANCE` of 5.

---

## THIS DOES NOT DISCHARGE PLAN 39-07

`.planning/phases/phase-39-the-public-run/39-07-PLAN.md` owns `vitest.config.ts` and describes
this re-measurement. It was written to re-measure **Phase 39's** specs, its `depends_on` is
`["39-01","39-02","39-04","39-05","39-06"]`, and **none of those plans has run.** On 2026-09-04
the owner ruled that Phase 42 runs before Phase 39, so the phase that lands specs now runs
before the plan that re-measures them.

**Phase 39 still owes its own re-measurement.** Nothing in this document or in the commit it
describes may be read as 39-07 having been executed. Its procedure was followed; its scope was
not. No file under `.planning/phases/phase-39-the-public-run/` was written or modified.

---

## 1. Host conditions

**The host was not quiet and had to be waited for.** It was polled, never signalled or killed.

| moment | 1-minute load | per core (8 cores, banner ceiling 4.00) |
|---|---|---|
| first reading of the session | 20.84 | 2.61 |
| polling samples, 15 s apart | 7.24, 6.08, 6.48, 5.56, 4.85, 5.51 | 0.91 down to 0.61 |
| gate used | three consecutive samples under 6.0 | — |

The load was other work on a shared machine — a C++ build (`cpp2rust`, `ld`), a `python` tool,
and `XprotectService`. None was interfered with.

**The three measured runs**, each a single 16-file invocation carrying two instruments:

| run | load before | load after | `real` | `user` | `sys` | `(user+sys)/real` |
|---|---|---|---|---|---|---|
| 1 | 5.29 | 5.18 | 4.16 | 10.50 | 1.60 | **2.91** |
| 2 | 5.02 | 4.94 | 5.01 | 10.50 | 1.56 | **2.41** |
| 3 | 4.94 | 5.42 | 4.47 | 10.41 | 1.34 | **2.63** |

**What was NOT polled: the peak load during a run.** Only start and end were sampled. Nothing
here is a peak, and the 2026-08-25 rows' own missing peak is not borrowed to cover it. The
`aot` lane's conditions were not taken at all, because it was not run — see §6.

The guard runs quoted in §5 print their own banner, which is reproduced with each.

---

## 2. The routes, and the diff of their LISTS

Three routes that share no code. Each models the population differently — one asks the runner,
one asks the index, one asks the disk — so a disagreement would have been informative.

| route | command | models | reading |
|---|---|---|---|
| **A** | `npx vitest list --project node --filesOnly` | the runner's own collection | **242** |
| **B** | `git ls-files` filtered by the project's globs | the git index | **242** |
| **C** | `find packages` for `*.test.ts` under a `src` path, filtered in the shell | the filesystem | **242** |

**The diff of the lists, verbatim:**

```
$ diff routeA.txt routeB.txt
DIFF_EXIT=0
$ diff routeA.txt routeC.txt
AC_EXIT=0
$ diff routeB.txt routeC.txt
BC_EXIT=0
```

Empty in all three pairwise directions — three identical **lists**, not three counts that
happen to agree. Because route B reads the index and A and C read the disk, an untracked spec
would have split B from the other two; none did.

A fourth reading exists and is **not** counted as a route: the guard's own reimplemented walk
printed `the node project holds 242 test files` in its refusal. It is quoted for corroboration
only, because it is the thing being checked.

The `aot` half was cross-checked the same way: `npx vitest list --project aot --filesOnly` and
`git ls-files` over `tools/**` for `.node.test.ts` both read **13**, `diff` empty.

---

## 3. The finding: the recorded 236 was already four above the population the guard reads

`NODE_MEASUREMENT.files` was **not** 236 files of the same kind as the 242 measured here.

At `cb8bc0d` — the commit that wrote `files: 236` — the node project held **232** files by the
index route. Traced across every commit that has ever written that line:

| recorded | actual node files | offset | commit |
|---|---|---|---|
| 228 | 228 | **0** | `0aa467f` 2026-09-02 |
| 229 | 229 | 0 | `0905b6b` |
| 230 | 230 | 0 | `d43e7dd` |
| 231 | 230 | **1** | `207247a` — `admission-slices.e2e.test.ts` |
| 232 | 231 | 1 | `e967651` |
| 234 | 232 | **2** | `bb86cd2` — `kill-switch-volunteer.e2e.test.ts` |
| 235 | 232 | **3** | `7015f3c` — `kill-switch-regions.e2e.test.ts` |
| 236 | 232 | **4** | `cb8bc0d` — `kill-switch-propagation.e2e.test.ts` |

Every step that opened the offset was an `.e2e.` arrival. `relative()` in
`slow-specs.node.test.ts` filters the `.e2e.` suffix out of `NODE_PROJECT_FILES`, which is what
the drift assertion compares against, so an e2e arrival **cannot** move that count — and a
field that counts one is describing a different population from the one being checked.

The `219 -> 228` entry in the field's own docblock had already ruled that *"this phase's three
e2e specs do NOT move this field."* The four entries written after it moved it anyway.

**What this means for the red.** The drift the guard refused at 6 was **ten arrivals less a
four-file inflation**, and the same guard passing at 5 the day before was passing on two errors
that partly cancelled. This is the failure mode step 4 of the procedure names in as many words:
*"a defensible-looking move that was wrong by five, because five had arrived while it was not
counting."* It is also why the derived number was written and no arithmetic was performed on
the old one.

**Not corrected here:** the `unitFiles` reasoning in those four entries stands. `unitFiles` is
fixed by the identity `files - excludedInNode` whatever lane a file runs in, which is the
`213 -> 214` correction already in the file.

---

## 4. What arrived, and what it costs

Ten files arrived over `cb8bc0d..HEAD` and **none left** (`comm -23` empty). All node lane,
none `.e2e.`.

Spans are the median of three runs of one shared 16-file invocation, taken from the **module
lifecycle** — `prepareDuration + collectDuration + setupDuration + duration` from
`TestModule.diagnostic()` — by a reporter attached in the **same run** as `--reporter=json`, so
the two instruments are comparable without the weather changing between them.

| file | accounted (median of 3) | `--reporter=json` | table |
|---|---|---|---|
| `packages/core/src/sealed-secret.test.ts` | **3 576** | 3 298 | **row added** |
| `packages/node/src/platform-geolocation.node.test.ts` | **1 592** | **5** | **row added** |
| `packages/cloudflare/src/turn-credential.test.ts` | 635 | 81 | no — under the cut |
| `packages/cloudflare/src/turn-regions.test.ts` | 521 | 2 | no — under the cut |
| `packages/node/src/turn-mint-payload.node.test.ts` | 148 | 6 | no |
| `packages/browser/src/turn-credentials.test.ts` | 89 | 38 | no |
| `packages/node/src/built-pages.node.test.ts` | 69 | 6 | no |
| `packages/browser/src/ice-configuration.test.ts` | 45 | 5 | no |
| `packages/cloudflare/src/turn-regions-source.node.test.ts` | 33 | 3 | no |
| `packages/browser/src/ice-configuration-library.node.test.ts` | 31 | 2 | no |

### `platform-geolocation` is step 3 justifying itself, live

`--reporter=json` reads that file at **5 ms**. The module lifecycle reads **1 592**, of which
**1 575 is `collectDuration`** — the module's import. A factor of about 320, straddling the
1 000 ms cut, **on a file that has no `beforeAll` at all**. Had this pass used the reporter
alone, a spec costing more than a second would have stayed in `test:unit` indefinitely and
nothing would have said so.

Confirmed by a third instrument sharing no code with either — solo `/usr/bin/time -p`,
bracketed by the cheapest of the ten as a boot floor, all in the same window:

| file | solo `real` x3 | median | net of floor |
|---|---|---|---|
| `ice-configuration-library.node.test.ts` (the floor) | 1.02 / 0.81 / 0.97 | 0.97 s | — |
| `platform-geolocation.node.test.ts` | 2.39 / 2.10 / 2.16 | 2.16 s | **1.19 s** |
| `sealed-secret.test.ts` | 3.58 / 3.46 / 3.61 | 3.58 s | **2.61 s** |

Both clear the cut on the wall clock too. `sealed-secret` is a memory-hard key derivation, so
the cost is the thing it measures.

### A comparative reading, because sixteen files are not one hundred and ninety-eight

Six files that already carry a row rode in the same invocation. Their medians against their
recorded spans:

| file | recorded | this window | ratio |
|---|---|---|---|
| `packages/core/src/enrollment.test.ts` | 1 288 | 1 044 | **0.81** |
| `packages/core/src/job/submit.test.ts` | 901 | 1 054 | 1.17 |
| `packages/node/src/one-crypto-implementation.node.test.ts` | 316 | 388 | 1.23 |
| `packages/node/src/requirements-ledger.node.test.ts` | 911 | 1 456 | 1.60 |
| `packages/node/src/slow-specs.node.test.ts` | 338 | 604 | 1.79 |
| `packages/libp2p/src/identity.test.ts` | 304 | 597 | **1.96** |

This window reads high for small files, so the two new rows are upper readings rather than
like-for-like with their neighbours. It changes no decision the table drives: at the most
favourable anchor both new rows still clear the cut (3 576 x 0.81 = 2 897; 1 592 x 0.81 =
1 290), and the highest of the eight left out fails to reach it at the least favourable one
(635 / 0.81 = 784).

### What moved in `vitest.config.ts`

| field | from | to | how |
|---|---|---|---|
| `files` | 236 | **242** | derived, three routes, lists diffed |
| `unitFiles` | 158 | **162** | the identity `files - excludedInNode`; the subtrahend was **computed**, moving 78 to 80 |
| `sumOfFileSpansMs` | 2 420 917 | **2 427 656** | plus the ten arrivals' 6 739 ms, stated as a third contribution |
| `MEASURED_NODE_SPANS` | 132 rows | **134 rows** | two inserted at their descending positions |

**`unitFiles` was confirmed behaviourally as well as by the identity.**
`O2_UNIT_ONLY=1 npx vitest list --project node --filesOnly` reads **162** — the runner applying
the exclusions for real, which is a different question from whether two numbers in the config
subtract correctly. That is a fourth independent reading, and the only one that exercises the
`SLOW_NODE_SPECS` derivation end to end.

`tests` (2 948) and `unitTests` (2 317) were **left alone**, on the `219 -> 228` entry's own
reasoning: the count is what the tolerance reads, and inventing a test total nobody counted is
the defect the table exists to prevent. `date`, `load`, `wallClockMs` and the cross-check
counts likewise still describe the 2026-08-25 run.

**A stale figure found and deliberately left standing:** `sumOfFileSpansMs`'s docblock states
the listed-row total as 2 269 462 and the slack as 10 942. Summing the rows as the guard does
reads **2 407 825** before this edit and **2 412 993** after — the prose was stale before this
pass touched anything. It is dated in place rather than quietly overwritten, and the actual
figures are recorded beside it.

---

## 5. The plants — both watched red, both restored by surgical inverse

`39-07` declares `plant_target: vitest.config.ts`. Two plants were run, because this pass
makes two claims that could otherwise be assertions.

### Plant 1 — the wrong count

Snapshot taken immediately before planting. Edit: `files: 242,` -> `files: 236,`, one line,
`diff` confirming one hunk of one line.

`npx vitest run --project node slow-specs`, `EXIT=$?` on the next line: **EXIT=1**,
`Tests 2 failed | 13 passed (15)`. Observed text, verbatim:

```
AssertionError: expected [ Array(1) ] to deeply equal []

- Expected
+ Received

- []
+ [
+   "the node project holds 242 test files, the recorded measurement covered 236. Re-measure by
+   the procedure in MEASURED_NODE_SPANS's docblock in vitest.config.ts (\"So this is the
+   procedure, and it is not optional\"), then update MEASURED_NODE_SPANS and NODE_MEASUREMENT
+   there. [...] Record the counts in NODE_MEASUREMENT.hookShadowCandidates /
+   hookShadowDisagreed.",
+ ]

 ❯ packages/node/src/slow-specs.node.test.ts:328:69
```

(The message is reproduced in full in the guard's source; the elision above is only of the
paragraph explaining the reporter's blind spot, which is unchanged from the file.)

It reddened a **second** case as well, which was not anticipated:

```
AssertionError: expected 162 to be 156 // Object.is equality

- Expected
+ Received

- 156
+ 162

 ❯ packages/node/src/slow-specs.node.test.ts:340:43
```

— the identity `unitFiles === files - excludedInNode`, since 236 - 80 = 156.

Restored by the surgical inverse of exactly that one line, `236,` -> `242,`; **not** by `cp`,
because this is a shared file. `cmp` against the pre-plant snapshot: **silent, exit 0**. Hunk
count 6 before and 6 after — a one-way test, so it proves nothing on its own and `cmp` is what
carried the check.

### Plant 2 — the value an assumed subtrahend would have produced

The docblock claims that assuming the exclusion count unchanged would have produced 164 and
that the identity would have refused it. That claim is proved rather than asserted.

Fresh snapshot; edit `unitFiles: 162,` -> `unitFiles: 164,` (= 242 - 78, the un-recomputed
subtrahend). **EXIT=1**, `Tests 1 failed | 14 passed (15)`:

```
AssertionError: expected 164 to be 162 // Object.is equality

- Expected
+ Received

- 162
+ 164

 ❯ packages/node/src/slow-specs.node.test.ts:340:43
```

Restored by surgical inverse; `cmp` against both the plant-2 snapshot and the plant-1 snapshot
**silent, exit 0**.

### One more red, and it was mine

The first full guard-set run after the edit still read **399 of 400** — `slow-specs` green,
`vocabulary` red:

```
+   "vitest.config.ts:428 \"<the banned term>\" — * re-<the banned term>."
```

The word planted, unintentionally, was the prefix `re-` in front of the term this repository
bans for framing volunteered compute as paid work — a prose word in this pass's own docblock,
caught by the guard the repository runs on every commit. The finding is quoted with the term
elided so that this document does not reproduce the violation it describes. Reworded to
`re-established`; nothing was skipped and `O2_SKIP_GUARDS` was not used.

### Final reading

```
$ bash scripts/cheap-guards.sh
 Test Files  9 passed (9)
      Tests  400 passed (400)
EXIT=0
[host conditions] host was quiet — load/core 0.56 before, 0.76 after (8 cores, ceiling 4.00)
[host conditions] wall clock 2.62 s
```

---

## 6. The `aot` lane — measured, and deliberately not retaken

**It holds 13 files and `NODE_MEASUREMENT.aotCrossCheckedFiles` says 11.** Two arrived since
the split at `d251771`: `tools/aot/cross-host-lift.node.test.ts` and
`tools/aot/cross-host-workflow.node.test.ts`. Neither carries a span. Both routes agree and
their lists were diffed (§2).

**It was not retaken, and the reasons are stated rather than the skip being silent:**

1. **The red this pass was asked to clear is entirely in the node half.** The drift case reads
   `NODE_PROJECT_FILES.length` alone (`slow-specs.node.test.ts:295-296`). `aot` reaches the
   guard only through `MEASURED_PROJECT_FILES`, which is used for the *stray-path* check —
   a check that an `aot` arrival cannot fail, because it adds files rather than removing them.
2. **Nothing asserts on an `aot` file count at all.** The only `aot` assertions are membership
   ones: `lift.node.test.ts` is in that set, and nothing outside `tools/` is. That absence is
   precisely why two files could arrive there unnoticed while ten in the node half could not.
3. **The cost is a serial container lane of about 1 182 s** at `(user+sys)/real` 0.090, which
   would answer a question nobody asked and which `CLAUDE.md` requires be run as its own lane.

**This is a reason, not a defence. The `aot` half is owed a retake**, and a count assertion
over it is owed with it. Recorded in `aotCrossCheckedFiles`'s docblock so the next pass finds
it there rather than here.

---

## 7. What could not be done, and what is still open

- **Phase 39's re-measurement is not done.** Restated because it is the thing most likely to be
  misread: 39-07 is not executed, not summarised, not marked. Its specs have not landed.
- **The `aot` half is not retaken** — §6, with the two unmeasured files named.
- **The `aot` lane has no file-count assertion.** Two files arrived there silently. Worth
  closing; not closed here, because this pass was scoped to one red guard and adding an
  assertion to a spec is outside it.
- **`sumOfFileSpansMs`'s prose figures are stale** (§4). Dated in place, not corrected.
- **The two new rows are upper readings** relative to their neighbours (§4). They decide the
  same thing at either end of the anchor range, but they are not like-for-like and a whole-node
  retake would move them.
