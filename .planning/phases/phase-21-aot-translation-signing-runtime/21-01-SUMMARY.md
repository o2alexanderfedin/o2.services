---
phase: phase-21-aot-translation-signing-runtime
plan: 01
subsystem: build-tooling
tags: [aot, elfconv, content-addressing, cache-key, dag-cbor, translation-record]

requires:
  - phase: phase-10-elfconv-aot
    provides: translationCid, TranslationRecord, the lift driver and its stub harness
  - phase: phase-3-block-exchange
    provides: blockCid — the function FetchingBlockstore verifies a fetched block with
provides:
  - "A production call site for translationCid: tools/aot/lift.ts:1158, on every successful lift"
  - "LiftedArtifact.translation — a required TranslationRecord, so no lift returns bytes without a name"
  - "translationKeyOf — the key construction as a pure exported function, so coverage is measurable with no container"
  - "LiftFailure.unnameable — a lift the key refuses is a named failure, not a success with 'unknown' hashed into it"
  - "tools/aot/stubs.ts — the stub docker harness, importable by any spec under tools/"
affects: [phase-21-plan-02, phase-21-plan-04, phase-21-plan-05, phase-14-signed-artifact-resolution]

tech-stack:
  added: []
  patterns:
    - "The pipeline names its own output: identity is a required field of the success value, not metadata attached afterwards"
    - "Key construction extracted as a pure function so its coverage can be swept field by field with no container"
    - "A shared stub harness as a plain module under tools/, invisible to the runner's *.node.test.ts include"

key-files:
  created:
    - tools/aot/stubs.ts
  modified:
    - tools/aot/lift.ts
    - tools/aot/lift.node.test.ts
    - .planning/REQUIREMENTS.md

key-decisions:
  - "artifactCid comes from @o2/net's blockCid rather than a fifth local copy of the same two lines — the codec is dag-cbor even though the payload is WASM"
  - "A blank toolchain version is a refusal (unnameable), not a defaulted 'unknown' — which reverses one existing driver-level assertion, deliberately"
  - "RENDERED_ARTIFACT's translation is built at module scope with top-level await; verified to run in this runner rather than assumed"
  - "The refusal covers blank and only blank; a toolchain entry reading the literal 'unknown' is still hashed, and that limit is asserted rather than left implied"

patterns-established:
  - "Four mutations planted and each observed red, then restored by cp and cmp'd to zero"
  - "A shared harness gets a positive-control case, because a harness that only ever produces refusals can be broken in a way no refusal notices"

requirements-completed: []

duration: 55min
completed: 2026-08-04
---

# Phase 21 Plan 01: the lift pipeline names what it produced — Summary

**`translationCid` went from zero production callers to one: `tools/aot/lift.ts` now names every artifact it produces, refuses one it cannot name, and the coverage of that name is swept in both directions with no container in it.**

## Performance

- **Duration:** ~55 min
- **Tasks:** 2 of 2
- **Files modified:** 4 (1 created)
- **Commits:** 3 (plus this summary)

| Commit | What |
|---|---|
| `09086e9` | Task 1 — `tools/aot/stubs.ts`, the harness extracted |
| `c4c882a` | Task 2 RED — the assertions, against an API that did not exist |
| `c19d348` | Task 2 GREEN — `liftElf` calls `translationCid`; `REQUIREMENTS.md` corrected |

## The host, so every figure below can be read

MacBookPro18,3, 8 cores, 32 GB, Darwin 25.5.0. **Two other agents were working the same
checkout throughout**, one executing Plan 21-03 and one planning Phase 20. Load average
moved between 5.7 and 15.9 across this plan's runs, and one of them was taken while a
second full `--project node` suite was running. Every duration is `/usr/bin/time -p` on
the process that produced it, never a system load average.

`docker image inspect ghcr.io/yomaytk/elfconv:arm64` returns
`sha256:22a404f31c9f7bb5c49e3193081d4876718253d86747aae3d30fcfd971f19c05`, so
**`HAVE_IMAGE` was true and the `it.skipIf(!HAVE_IMAGE)` integration block RAN.** It did
not skip. The verification section of the plan asks for that sentence specifically, and
this is it: same-host repeatability of the emitted CID is **measured**, on this host,
against two real lifts of the same bytes.

## What was built

### Task 1 — one stub harness (`09086e9`)

`stubDocker`, the `StubDocker` interface, `acceptableElf`, `MATCHING_DIGEST`,
`FOREIGN_DIGESTS` and `emitDigests` moved out of `lift.node.test.ts` into
`tools/aot/stubs.ts` unchanged, with their doc comments intact. `stubDirs` became
module-private with `cleanupStubs()` beside it, and `stubDir(prefix)` replaced the four
hand-rolled `mkdtempSync` + push sites — including one at the top of the file that was
not in the plan's list.

Two things were added rather than moved:

- **`writeAcceptableElf()`** — the spec's own `beforeAll` body, lifted verbatim.
- **`ACCEPTABLE_ARTIFACT`** — an eight-byte header plus a `target_features` section
  declaring one used feature. Deliberately *not* `bytes(WASM_HEADER, REAL_SECTION)`:
  those exist so the feature-reader block can malform them a dozen ways, and a fixture
  shared between "must be accepted" and "must be rejected" is one edit away from being
  neither.
- **`stubLift(options)`** — a `docker` that completes a lift, imitating
  `CONTAINER_SCRIPT` and nothing more. The artifact bytes are staged to a host file and
  `cp`d in rather than emitted by `printf`, because a shell cannot be trusted to
  reproduce arbitrary bytes.

No assertion was edited in this task. The one that had to survive the move verbatim —
`expect(log.join('\n')).not.toContain('run ')`, the only assertion in the file a return
value cannot make — passes unchanged.

One case was added, and it is what makes the extraction more than a move: every stub in
that file until now existed to make the driver *stop*, so a harness that never wrote an
artifact at all would satisfy all of them. The new case reads the result back.

### Task 2 — the pipeline names its output (`c4c882a`, `c19d348`)

- `LiftedArtifact.translation` is a **required** `TranslationRecord`.
- `translationKeyOf(artifact)` is exported and pure: four fields, no `await`.
- `liftElf` builds the whole artifact-minus-its-name as one local, calls
  `translationCid`, and returns `{...lifted, translation: {...}}`. One literal, not two.
- `artifactCid` is `blockCid(new Uint8Array(artifactBytes))` from `@o2/net` — *the*
  function `FetchingBlockstore` verifies a fetched block with, not a convenience.
- `LiftFailure` gains `unnameable`, and `describeLiftFailure` delegates its sentence to
  `describeKeyFailure` so the codec's own wording survives.

## What was measured

### The suite

| run | result | `real` | `user` | `sys` | `(user+sys)/real` |
|---|---|---|---|---|---|
| `tools/aot`, before this plan | **127 passed, exit 0** | 356.92 s | 4.57 | 1.70 | 0.018 |
| `tools/aot`, after | **140 passed, exit 0** | 205.24 s | 3.61 | 0.81 | 0.021 |
| whole `--project node`, after | **1994 passed, 1 skipped, exit 0** | 216.92 s | 233.13 | 32.27 | 1.22 |

`npx tsc --noEmit` on the whole tree: **0 errors.**

The two `tools/aot` figures are **not comparable as a speed claim and are not offered as
one.** The before-run was taken while another agent's full node suite ran concurrently;
93 % of this file's wall clock is one integration `beforeAll` that waits on Docker, so
the difference is the host's, not the code's. The 13 new cases are what the counts say:
1 + 7 + 5.

### The four mutations, each observed red and each restored

Every plant was made in `tools/aot/lift.ts`, run, then restored from a `cp` snapshot and
`cmp`'d to exit 0. All four restores verified.

| # | plant | observed | fires on |
|---|---|---|---|
| 1 | `features: []` in `translationKeyOf` | two CIDs equal, `expected 'bafyreifkgftu2e…' not to be 'bafyreifkgftu2e…'` | *moves when the required feature set moves*, and nothing else |
| 2 | `?? 'unknown'` → `\|\| 'unknown'` for `clang` | `expected true to be false` | *refuses a lift whose toolchain reported a blank version* |
| 3 | raw (0x55) instead of dag-cbor for `artifactCid` | `expected 'bafkreiciyldzs5…' to be 'bafyreiciyldzs5…'` | *names the artifact by the CID a blockstore would answer to* |
| 4 | `target` seeded with `Date.now()` | `expected false to be true` | **only** the same-host repeatability case, against two real lifts |

Plant 3 is the one worth reading twice: the two CIDs differ in one character of their
prefix, and nothing else in the repository would have noticed until an agent failed to
resolve an artifact by a name that looks perfectly well-formed.

Plant 4 is the anti-vacuity argument for the one line added to the integration block.
Six other cases in that block passed under it; only the repeatability one saw it.

### The coverage sweep, both directions

Six flips move the emitted CID — `inputDigest`, `target`, each toolchain entry present
(iterated, not enumerated), an added toolchain entry, `requiredFeatures` — and nine
fields leave it still: `durationMs`, `stdout`, `stderr`, `findings`, `unparsed`,
`declaredFeatures`, `unidentifiedTools`, `undecoded`, `blindSpots`. `translationKeyOf`'s
own output is additionally checked key-set-exact, because the CID sweep alone would pass
for a function that hashed the whole artifact.

## Deviations from plan

### 1. [Rule 1 — the plan's `<interfaces>` block was stale, and one of its claims was measured false]

The plan describes `LiftedArtifact` as a **fifteen**-field interface and says the fixture
literal is fifteen fields, adding *"Its own doc comment at :472 says 'seventeen-field';
that comment is stale … Do not chase the missing two."*

Measured: `LiftedArtifact` declares **sixteen** members today and the fixture sets all
sixteen. `unidentifiedTools` landed after the plan was written. So the plan's correction
of the stale comment was itself off by one, in the other direction.

**Fixed by deleting the number rather than updating it.** The fixture's doc now makes the
same argument without a count — a number in a comment that no test reads is precisely the
drift the sentence is warning about, and it has now been wrong twice.

Every plan line reference in `21-01-PLAN.md` is stale by 300–1100 lines (the repeatability
block is at `:2270`, not `:1158`; `stubDocker` was at `:1046`, not `:638`). Located by
content, not by line.

### 2. [Rule 1 — one existing driver-level assertion is reversed, deliberately]

`lift.node.test.ts` carried *"reports an empty value as unidentified, not as a version"*:
a lift whose `meta.txt` reads `clang=` returned **`ok: true`** with `clang` in
`unidentifiedTools`. Once `liftElf` calls `translationCid`, that lift has no name and is
not returned, so the case could not keep its old assertion.

This is not a plan conflict discovered late — it is the outcome
`LiftedArtifact.unidentifiedTools`' own doc was already written against: *"An absent key
stays `'unknown'` and a present-but-empty one stays `''`, because `translationCid` refuses
`''` as `blank-version`."* The refusal was simply unreachable while nothing asked for a
name.

The case now asserts the refusal, and says in its own doc that it used to assert the
opposite and why. **The claim it was written for is unchanged and still held**, by the
`unidentifiedIn` unit cases that assert `''` and `'   '` both count as unidentified.

### 3. [Rule 3 — `stubDir` was added; the plan did not name it]

`stubDirs` becoming module-private orphaned four `stubDirs.push(dir)` sites in the spec,
one of which the plan's read-list did not mention. Exporting `stubDir(prefix)` keeps one
cleanup path rather than two.

### 4. [Rule 2 — `.planning/REQUIREMENTS.md`, AOT-02]

`requirements-ledger.node.test.ts` reads the **working tree**, so AOT-02's row went false
the moment `lift.ts` on disk called `translationCid` — before the GREEN commit, not
because of the RED one. It blocked every agent's commits until corrected.

AOT-02 moved *Built, not wired* → *Partial*, the header's marker arithmetic moved with it
(8 + 22 + 1 → 7 + 23 + 1), and the outstanding halves are named. The row keeps a
**checkable** claim rather than going onto `WITHOUT_A_CHECKABLE_CLAIM`: `describeKey` has
no production caller, which is true, is exactly the gap Plan 21-02 closes, and keeps the
row inside the guard.

Two things learned in the doing, both already documented in that spec and both hit anyway:
the row must **paraphrase** what it disowns — my first attempt quoted the false sentence
and had it read back as its own claim — and changing a marker moves the header's counts.

**Only the AOT-02 hunks were staged.** That file also carries another agent's uncommitted
AOT-04 and Partials rows; those were reverted in the staged blob via
`git hash-object` + `git update-index` and left untouched in the working tree. Because
`git commit -- <path>` commits working-tree content and would have swept them in, that one
commit was made from a verified-clean index instead; `git show --stat` confirms two files.

## A finding for defect 30's one open measurement

Defect 30 closed with a named uncertainty: *"Why an attempt missed its 20 000 ms budget on
that host on 2026-08-02"*, and said the one reading that settles it is the per-attempt
elapsed time the fix now records.

**That reading arrived during this plan.** The first post-Task-1 full run produced three
reds, all in *an image whose digests name another repository is refused, never run*, all
carrying the new wrapper's own sentence:

> `an answer that cost 20010 ms leaves no room for another attempt inside the 30000 ms this wrapper may spend inside a 60000 ms case … attempts so far: 20010 ms`

20 010 / 20 006 / 20 007 ms — the driver's timer fired; the stub really was silent for 20 s.
That is defect 30's first branch, not its second.

Three further measurements bound it:

1. **The stub is not slow.** 30 spawns of that exact `#!/bin/sh` stub, taken minutes later
   at load 10: min 7 ms, p50 9 ms, p90 9 ms, **max 247 ms** (the first exec of a
   freshly-written file). Three orders of magnitude under the budget.
2. **It did not reproduce.** The same three cases re-run alone: **6 passed, 2.55 s**, each
   spawning case ~190 ms.
3. **The condition present when it fired**, and absent when it did not: a **second full
   `vitest --project node` suite running concurrently** on the same host, at load ~15.

The process ratio was 0.014 in the failing run — waiting, not starving — which is the same
reading defect 30 recorded and is why a CPU-starvation account does not fit this either.
**I am not naming a cause.** What is new is the correlation with a concurrent second suite,
and the fact that the failure now arrives with its own number attached instead of as
`Error: Test timed out in 60000ms`. That is the fix working as designed.

Practical note for whoever runs this file next: `-t '<describe name>'` skips the
integration `beforeAll` entirely — the whole file drops from ~205 s to **2.55 s**.

## Known limits, stated rather than implied

- **The refusal covers blank and only blank.** A `meta.txt` reading `wasi-sdk=unknown` is
  still hashed into the key, and `unidentifiedIn` does not report it either, because the
  value is not empty. The container writes that literal string itself — twice:
  `${WASI_VERSION_FULL:-unknown}` and `git rev-parse HEAD || echo unknown`. So an artifact
  can claim full provenance while carrying an entry that identifies nothing. This is the
  failure `provenance-unreadable`'s own doc calls *"the one wrong value `translationCid`
  cannot catch"*, reached through the partial branch rather than the wholesale one. It has
  its own passing case, whose title says *the limit of the refusal*, so it reads as a
  measurement and not as a green. **Closing it would move the line between the two halves
  of the provenance split and was not this plan's to do.**
- **Cross-machine anything stays unmeasured.** `CROSS_MACHINE_BLIND_SPOT` is untouched and
  still on every artifact.
- **The emitted CID has never been compared across two genuinely different inputs end to
  end.** The differing-input half of the roadmap criterion is Plan 21-04's; what is closed
  here is the repeat half, and the field sweep that stands in for the rest with no
  container.
- **The RED commit `c4c882a` does not typecheck** — 13 `tsc` errors in one file, by
  construction. The window to `c19d348` was minutes, and the file is one no other agent
  owns. Recorded because a `git bisect` through it will not build.

## Two questions the plan told me to answer

**Which fixture shape was used.** Top-level await at module scope, the plan's first
option. It was **verified rather than assumed**: the RED run failed with
`TypeError: translationKeyOf is not a function` raised *from inside*
`translationRecordFor` at module scope, which is only reachable if the runner evaluated
the top-level `await`. No `it` body was moved.

**Did the repeatability block run or skip.** It **ran**, on the host named above, against
the image at `sha256:22a404f3…`. A skip there would have been a plan failure and not a
host limitation; it was neither.

## Self-Check: PASSED

- `tools/aot/stubs.ts` — FOUND (265 lines)
- `tools/aot/lift.ts` — FOUND (1311 lines), `translationCid` called at `:1158`
- `tools/aot/lift.node.test.ts` — FOUND (2579 lines)
- `09086e9`, `c4c882a`, `c19d348` — all FOUND in `git log`
- `npx tsc --noEmit` — exit 0
- `npx vitest run --project node` — 1994 passed, 1 skipped, exit 0
- `git show --stat` on each commit — only files this plan owns, plus the AOT-02 hunks of
  `REQUIREMENTS.md`
