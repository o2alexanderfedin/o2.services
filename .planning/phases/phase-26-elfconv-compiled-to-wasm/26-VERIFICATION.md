---
phase: 26-elfconv-compiled-to-wasm
verified: 2026-08-11T03:11:28Z
status: human_needed
score: 13/13 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Take the owner decision 26-03 Task 3 blocks on — four named options in 26-03-PLAN.md, none begun"
    expected: "One of: (a) pay the wasm32-wasi LLVM cross-build, (b) port off glog, (c) re-target stage 2 only, (d) stop here and carry the measured negative"
    why_human: "The plan is `autonomous: false` and terminates in a blocking checkpoint whose done condition is an owner decision about spend. `26-03-SUMMARY.md` records `tasks_completed: 2 of 3` and that STATE.md was deliberately not advanced. No verifier can take this decision."
  - test: "Rule on two ledger sentences that describe more than the code asserts (findings W1 and W2 below)"
    expected: "Either tighten AOTW-01's 'asserted equal to it at run time' and AOTW-04's 'every non-test translation unit of this repository's elfconv fork', or accept both as written with the reason recorded"
    why_human: "Both are prose precision in `.planning/REQUIREMENTS.md`, not defects in the measurement. The evidence underneath each row is real and was independently reproduced; only the sentence describing it reaches further than the assertion does."
---

# Phase 26: elfconv Compiled to Wasm Verification Report

**Phase Goal:** The AOT translator runs as a wasm module on any node, so producing a lifted
artifact stops being a Docker-host privilege and becomes a job the fabric can schedule.

**Verified:** 2026-08-11T03:11:28Z
**Status:** human_needed — 13/13 must-haves verified, 0 gaps, 2 warnings, 2 items for the owner
**Re-verification:** No — initial verification

## Method, and why it is not the usual one

This phase **deliberately did not achieve its goal** and closed on a measured negative
(`26-GATE.md`: NO-GO). Scoring "goal met / not met" would say nothing. What was verified
instead is whether the negative is *real, measured, and honestly scoped* — and the strongest
available evidence for that is not a reading of the harness but a **re-run of it**.

Both container harnesses were executed by this verifier, file-scoped, on this host
(arm64, `docker version` answering), exit codes read on the immediately following line with
no pipe:

| Command | Result |
|---|---|
| `npx vitest run --project node tools/aot/elflift-wasi-gate.node.test.ts` | **8/8 passed**, 1 file, 190.88 s |
| `npx vitest run --project node tools/aot/wasi-preview1-surface.node.test.ts` | **6/6 passed**, 1 file |
| `npx vitest run --project node packages/node/src/acceptance-traceability.node.test.ts packages/node/src/requirements-ledger.node.test.ts` | **61/61 passed**, `VITEST_EXIT=0` |

The gate spec's own `gate.json` (written to `mkdtemp`, not cleaned up) was then read directly
out of this verifier's run — `/var/folders/…/o2-elflift-gate-IR191n/gate.json`, 121 131 bytes,
written 20:04 — so every figure in `26-GATE.md` §3 was checked against a **fourth independent
container run**, not against `26-02-SUMMARY.md` and not against the spec's recorded tables.

No `git add`, no commit, no branch switch, no full-project vitest run. `git status --porcelain`
was clean before and after.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | The toolchain is named by a container image **digest**, asserted at run time rather than in a comment (AOTW-01) | ✓ VERIFIED | One constant `ghcr.io/yomaytk/elfconv@sha256:22a404f…f19c05` shared by both specs (`wasi-preview1-surface.node.test.ts:110`, `elflift-wasi-gate.node.test.ts:96`), overridable by `ELFCONV_IMAGE_DIGEST`. My run's `gate.json` echoes it exactly. Run-time toolchain identity is asserted from the report: `clangVersion` contains `wasi-sdk` (read back `clang version 18.1.2-wasi-sdk`), `wasiSdkPath` matches `^/root/wasi-sdk` (`/root/wasi-sdk-24.0-arm64-linux`), `targetTriple` contains `wasm32`. See **W1** for one sentence in the ledger that describes more than the code asserts |
| 2 | Preview1's provided set is read out of the sysroot's own archives, and every probe is recorded present/absent by measurement, checked live (AOTW-03) | ✓ VERIFIED | `wasi-preview1-surface.sh:110-138` computes each probe by `grep -qxF "$symbol" provided.txt` — **the harness measures, it asserts nothing**; the 39-entry `RECORDED_PROBE` table is checked element-for-element against the live report (`…node.test.ts:365-373`). `providedCount` **3963**, `nmExit` **0**, reproduced in my own gate run (`providedCount 3963`, `nmExits.provided 0`) |
| 3 | A module the pinned toolchain produced is **executed** under preview1 and its output asserted — a module that only compiled is not a success (AOTW-02) | ✓ VERIFIED | The container compiles `smoke.wasm` and does not run it; execution is host-side under `@bjorn3/browser_wasi_shim` with a `Collect extends Fd` sink, asserting the decoded bytes equal `'O2 preview1 smoke ok\n'` and `total > 0` (`…node.test.ts:407-453`). `smoke.exit` is recorded in the report and is deliberately not what any case passes on. Exports asserted exactly `_start` + `memory`, import namespaces exactly `wasi_snapshot_preview1`. 6/6 green in my run |
| 4 | Every non-test TU is compiled for `wasm32-wasi`, each result carrying its own error text and produced-object size; **the object is the evidence, not the exit code** (AOTW-04) | ✓ VERIFIED | `elflift-wasi-gate.sh:250-277` stats the object per TU and records `exit`, `objectBytes`, `firstError`, `errorFile`, `includedFrom`, `droppedFlags`. The pass/fail split is taken on `exit === 0 && objectBytes > 0`, asserted in **both directions** (`…node.test.ts:553-578`). My run: `entriesTotal 38`, `skipped 11`, `tus 27`, **6 produced an object / 21 did not** — byte-identical to the GATE table (7 584 / 1 189 222 / 2 467 / 301 / 3 110 / 802, summing to 1 203 486). See **W2** on the ledger's wording of "every" |
| 5 | The cause is attributed to glog rather than to the toolchain, and the threads arm settles what the error means | ✓ VERIFIED | All 21 `wasm32-wasi` failures carry one distinct `includedFrom` — `/root/elfconv/dependencies/install/include/glog/logging.h:51:` (asserted as a set equality at `…node.test.ts:576-577`; reproduced in my run). Threads arm: same 21 units, one distinct `firstError` = `glog/platform.h:58:2: error: Platform not supported by glog…`, include-chain root `glog/flags.h:48:`. **Independently corroborated outside the harness**: `glog/platform.h` branches on Windows, Cygwin, Linux(+Android), macOS, FreeBSD, NetBSD, OpenBSD, `__EMSCRIPTEN__`, then `#error` at line 58 — **no `__wasi__` branch exists** |
| 6 | The residue is measured by subtraction from the provided set, named in full for the seven named families, and attributed to the archive member that references it (AOTW-05) | ✓ VERIFIED | `residue = undefined − provided − self-defined` (`elflift-wasi-gate.sh:578`); families classified by an explicit ordered table, not a regex; `memberOf` built from `llvm-nm`'s own member headers. My run reproduces every recorded family count exactly (B: 13/8/2/10/30/2/1/6/9/1/180 = **262**; C: 11/8/7/2/9/0/1/4/1/5/37 = **85**) and every attribution row (`fork`, `execve`, `posix_spawn` = `count 1`, `Program.cpp.o`, in **both** alive readings; `__cxa_throw` = `count 102` in C) |
| 7 | The residue is read from more than one independent source, each reading's bias stated (AOTW-05) | ✓ VERIFIED | Four readings emitted (A, AT, B, C), two alive. B = host LLVM 16 ELF closure (40 archives, 10 844 undefined) declared an **overstating upper bound**; C = real wasm objects (5 archives, 2 116 undefined) declared **Emscripten-not-WASI, 17.0.6 vs 16.0.6, missing `libLLVMPasses.a`**. `readingCPassesPresent` asserted **false** *always*, present or not. Reading C's absence degrades rather than breaks: the spec asserts the disjunction "fully populated **or** null with a stated reason" (`…node.test.ts:627-649`) |
| 8 | **A zero-residue reading is proved real before it is believed** — instrument liveness asserted before any absence claim | ✓ VERIFIED | Two independent guards, both re-run by me. (a) Surface spec: the control group `printf, malloc, memcpy, write, exit` is asserted **all present** in the case at `:349`, which precedes the absence case at `:375` in declaration order. (b) Gate spec: the liveness case at `:604` runs before any residue is read and asserts `insufficient` **equals `['A','AT']`** — so a floor lowered to admit a blind reading goes red. My `gate.json` confirms the refusal is real, not narrated: `A` and `AT` each carry `alive: false`, 6 objects, `undefinedCount 5`, and `insufficientReason` "undefinedCount 5 is at or below the liveness floor of 100; this reading is reported but no absence may be concluded from it" |
| 9 | The verdict is written as GO/NO-GO with the blocking wall named **and its own scope stated** | ✓ VERIFIED | `26-GATE.md` §1 NO-GO, §2 carries the distinction intact and unsmoothed: *"The compile half is conclusive and it is a negative"* / *"The symbol half is an upper bound and is conclusive in NEITHER direction"*, naming the six LLVMSupport members (`Program.cpp.o`, `Signals.cpp.o`, `CrashRecoveryContext.cpp.o`, `Process.cpp.o`, `LockFileManager.cpp.o`, `Watchdog.cpp.o`) and stating that a non-empty residue does not prove the link fails and an empty one would not prove it succeeds. §2 also records that **26-02's plan asserted "a NO-GO is conclusive" and its executor claimed less on measurement** — the weaker claim was carried forward deliberately rather than being reconciled back to the plan |
| 10 | "The measurement cannot see past glog" is stated, not implied | ✓ VERIFIED | `26-GATE.md` §2: *"Twenty-one units abort at the first glog include, so nothing downstream of it in those units was type-checked — not remill's code, not the lifter's, not LLVM's headers. **Whether glog is the only wall or the first of several is UNMEASURED**, and this document does not say 'only glog blocks it'."* Repeated in §7's not-measured list, and in §5's two qualifications on item 7 (elflift's own demand for fork/exec is unmeasured entirely) |
| 11 | Stage 2 is priced from what is in hand and explicitly **not built** | ✓ VERIFIED | `26-GATE.md` §6: six-row price table, each row sourced; the load-bearing line is marked as an inference not a measurement (*"Stage 1's blocking dependency — glog — is not on stage 2's path at all… an inference from the dependency list rather than a measurement"*), and §7 states "Stage 2 is untested — no `llc`, no `wasm-ld`, no bitcode-to-wasm run of any kind" |
| 12 | Six AOTW ids exist in the ledger in the state the evidence supports, and both ledger guards pass over them | ✓ VERIFIED | `.planning/REQUIREMENTS.md:670-675` — `AOTW-01…05` `[x]`, `AOTW-06` `[ ]`. Each `[x]` is named by a **running** `describe`/`it` title: AOTW-01 ×1, AOTW-02 ×2, AOTW-03 ×3, AOTW-04 ×3, AOTW-05 ×5 — matching the traceability counts the ledger rows themselves claim. `AOTW-06` appears in **no** source file (`grep` over `tools/` + `packages/` returns 0). Both guards re-run by me: `acceptance-traceability` + `requirements-ledger`, 61/61 passed, `VITEST_EXIT=0`, with no `EXEMPT`/`FINDINGS` entry for any AOTW id |
| 13 | Two falsified roadmap findings are corrected **in place** with the originals preserved, and the phase deliverable is reported unmet rather than reworded | ✓ VERIFIED | ROADMAP item 7: heading struck, *"The original item, unedited:"* block-quoted verbatim, then "WHY IT IS FALSE" **and** "WHAT THAT DOES NOT SAY" (the upper-bound qualification). Item 11(ii): struck, *"Kept verbatim below"*, original quoted, then "WHY IT IS WRONG — it is the population rather than the arithmetic", plus "NOTE WHAT SURVIVES AND WHAT DOES NOT". Item 11(i): weakened, not deleted, with the reason (the neighbouring LLVM is Emscripten-targeted). `AOTW-06` stays `[ ]` and its ledger row states plainly that no `elflift.wasm` was linked, no bitcode produced, no `sha256` comparison possible |

**Score:** 13/13 truths verified. **0 gaps.**

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `tools/aot/wasi-preview1-surface.sh` | Digest-pinned harness emitting `surface.json`, `provided.txt`, `smoke.wasm`; exit codes read with no pipe | ✓ VERIFIED | 211 lines. Named exit codes 31 (nm dead / under floor), 32 (smoke compiled nothing). Delete-before-build on `smoke.wasm`. Probe computed by `grep -qxF`, never hardcoded |
| `tools/aot/wasi-preview1-surface.node.test.ts` | Liveness checks, recorded-vs-live probe table, shim execution | ✓ VERIFIED | 455 lines, 6 cases, all green in my run. Control group asserted before any absence. Planted-mutation proof recorded with verbatim terminal red (`expected magic word 00 61 73 6d, found 01 61 73 6d`), restored by surgical inverse and `cmp`-verified |
| `tools/aot/elflift-wasi-gate.sh` | cmake reconfigure over **this repo's fork**, per-TU replay ×2 arms, four nm readings, residue classification, `gate.json` | ✓ VERIFIED | 691 lines. `/repo` mounted `:ro`; fork placed over the image tree by the same four `cp -a` lines `elfconv-differential.sh:109-112` uses; `-DCMAKE_EXPORT_COMPILE_COMMANDS=ON` on the command line (27 → 38 entries) with the directory-scoped-variable cause named at `settings.cmake:25`; `-i` hazard documented; exit codes 40–44 each named |
| `tools/aot/elflift-wasi-gate.node.test.ts` | Instrument-alive assertions, per-TU tables, recorded-vs-live classification, "judges the measurement, not the verdict" | ✓ VERIFIED | 698 lines, 8 cases, all green in my run. Docblock states the design explicitly: *"Every case below asks 'did the instrument read something', never 'is the answer the one we wanted'."* Planted-mutation proof chosen by measurement (`printf`, undefined in reading **B only**) so it moves exactly one row — observed `1 failed \| 7 passed`, restored and `cmp`-verified |
| `.planning/phases/…/26-GATE.md` | The verdict, named residue, four readings + biases, stage-2 price, what was not measured | ✓ VERIFIED | 349 lines. Every §3 figure I re-derived from my own `gate.json` matched exactly, including the 11-skip breakdown (5 remill AArch64 tests / 4 vendored googletest / 1 elfconv integration test / 1 duplicate `utils/Util.cpp`), which no spec asserts |
| `.planning/REQUIREMENTS.md` (Phase 26 section) | Six AOTW rows + traceability rows | ✓ VERIFIED | Section present with a preamble that states AOTW-06 is "open by design rather than by omission"; six traceability rows at 869-874. Two rows reach slightly further than their evidence — W1, W2 |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `elflift-wasi-gate.sh` | `third_party/elfconv` (this repo's fork) | four `cp -a` lines over the image tree | ✓ WIRED | Lines 79-82; the measured tree is the fork, not the stock image — otherwise the gate would answer a different question (a lifter still linking bfd/libdwarf/libelf) |
| `elflift-wasi-gate.sh` | the preview1 provided set | regenerated in the **same** container run and subtracted | ✓ WIRED | Step 4 re-runs 26-01's extraction verbatim; `providedCount 3963` in my run agrees with 26-01's figure exactly. Both sides of the subtraction come from one invocation, per CLAUDE.md's within-one-run rule |
| `wasi-preview1-surface.node.test.ts` | `@bjorn3/browser_wasi_shim` | `WebAssembly.instantiate` against `new WASI(...).wasiImport`, stdout collected | ✓ WIRED | `new WASI([...], [...], [...], { debug: false })` at `:422`; `wasi.start(...)` return code asserted `0`; bytes asserted |
| `26-GATE.md` | `gate.json` | every figure transcribed from the report | ✓ WIRED **and independently re-derived** | `gate.json` is not committed (T-26-09), so "transcribed" could have meant "copied from 26-02-SUMMARY.md". 26-03 re-ran the container; I re-ran it a fourth time and every sampled figure matched |
| `.planning/REQUIREMENTS.md` | both spec files | each `[x]` row named by a running test title | ✓ WIRED | Enforced generically by `acceptance-traceability.node.test.ts` (`titled` classification), green over all five |

### Data-Flow Trace (Level 4)

| Artifact | Data | Source | Produces real data | Status |
|---|---|---|---|---|
| `gate.json` | 27×2 TU results, 4 readings, residue, attribution | `clang++ --target=wasm32-wasi -c` ×54 + `llvm-nm` ×9 inside the pinned image | Yes — re-produced by this verifier, 121 131 bytes | ✓ FLOWING |
| `surface.json` / `provided.txt` | 3963 symbols, 39 probes | `llvm-nm --defined-only` over 19 sysroot archives | Yes — `nmExit 0`, count asserted equal to `wc -l` of the emitted list | ✓ FLOWING |
| `smoke.wasm` | stdout bytes | container `clang++`, executed host-side under the shim | Yes — `'O2 preview1 smoke ok\n'` decoded from the sink | ✓ FLOWING |
| `26-GATE.md` tables | every §3 figure | `gate.json` | Yes — matched against an independent run | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| The gate measurement still reproduces | `npx vitest run --project node tools/aot/elflift-wasi-gate.node.test.ts` | 8 passed, 190.88 s | ✓ PASS |
| The preview1 surface still reproduces | `npx vitest run --project node tools/aot/wasi-preview1-surface.node.test.ts` | 6 passed | ✓ PASS |
| Both ledger guards green over the new ids | `npx vitest … acceptance-traceability … requirements-ledger …` | 61 passed, `VITEST_EXIT=0` | ✓ PASS |
| glog really has no `__wasi__` branch | read `glog/platform.h` (v0.7.1, `dependencies/CMakeLists.txt:43`) directly | 9 platform branches, `#error` at :58, no `__wasi__` | ✓ PASS |
| Any claim of a produced `elflift.wasm` anywhere in the tree | `grep -rn "elflift.wasm"` over `*.md`, `*.ts`, `*.sh` | Every hit is a **denial** of its existence | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Status | Evidence |
|---|---|---|---|
| AOTW-01 | 26-01, 26-03 | ✓ SATISFIED (with W1 on wording) | Shared digest constant; run-time toolchain identity asserted from the report |
| AOTW-02 | 26-01, 26-03 | ✓ SATISFIED | Module executed under the shim; passes on written bytes, not on `smoke.exit` |
| AOTW-03 | 26-01, 26-03 | ✓ SATISFIED | 3963 symbols, 39 probes measured, control group asserted first, two rows carried as qualified (`setjmp` absent-as-symbol / present-as-feature; `__cxa_*` genuinely absent, corroborated by 32 sibling `__cxa_*`) |
| AOTW-04 | 26-02, 26-03 | ✓ SATISFIED (with W2 on scope wording) | 6/21 of 27, per-TU, two arms, added-flag control failing at `Arch/Name.h:82` as designed |
| AOTW-05 | 26-02, 26-03 | ✓ SATISFIED | Four readings, two refused, biases stated, residue named in full for seven families with member attribution |
| AOTW-06 | 26-03 | ✗ **OPEN BY DESIGN — correctly unmet** | No link was attempted; no bitcode; no `sha256` comparison. Reported unmet rather than reworded, on the AOT-05 precedent |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|---|---|---|---|---|
| — | — | `TBD` / `FIXME` / `XXX` / `TODO` / `HACK` / `PLACEHOLDER` across all four `tools/aot/` phase files and `26-GATE.md` | — | **None found.** `grep` exit 1 |

## Warnings — two sentences that reach further than their assertion

Neither is a defect in the measurement. Both are prose in `.planning/REQUIREMENTS.md`
describing evidence that is real and was reproduced. Both are the kind of thing this project's
own conventions say to fix rather than tolerate ("A comment is not a specification").

### W1 — AOTW-01: "asserted **equal** to it at run time"

The ledger row (`REQUIREMENTS.md:869`) reads: *"It is passed into the container as
`IMAGE_DIGEST` and the report's own `image` field is asserted equal to it at run time rather
than described in a comment."*

What the code does: `expect(gate.image).toMatch(/@sha256:[0-9a-f]{64}$/)`
(`elflift-wasi-gate.node.test.ts:520`) — a **shape** assertion, not an equality against the
pinned constant. The surface harness emits **no `image` field at all**; its AOTW-01 case
asserts `expect(IMAGE).toMatch(...)`, which is a constant against a regex with no run-time
reading behind it.

**The guard still does real work** — if `ELFCONV_IMAGE_DIGEST` were pointed at a mutable tag,
`gate.image` would carry no `@sha256:` and the case would go red — and the *substantive*
claim of AOTW-01 ("the report names the pinned image's own wasi-sdk, not a host toolchain") is
carried by the `clangVersion` / `wasiSdkPath` / `targetTriple` assertions, which are genuine
readings. Only the word "equal" overstates. One line would close it:
`expect(gate.image).toBe(IMAGE)`.

### W2 — AOTW-04: "**Every** non-test translation unit of this repository's elfconv fork"

Measured: the 27 non-test entries of the **elflift cmake compile database** (38 entries minus
11 named skips). Not compiled, and not in that database at all: `runtime/Entry.cpp`,
`runtime/Memory.cpp`, `runtime/Runtime.cpp`, `runtime/VmIntrinsics.cpp`,
`runtime/syscalls/Syscall{Wasi,Browser,Native}.cpp`, `utils/elfconv.cpp` — the **stage-2
runtime sources**, which this phase explicitly does not build and which would not change the
verdict.

`26-GATE.md` is precise about this (27 TUs, 38 entries, 11 skips named by reason, the six
passes and twenty-one failures named individually); the imprecision is confined to the ledger
sentence, which a reader could take as covering the whole fork. Suggested tightening:
*"every non-test translation unit of the elflift build's own compile database"*.

### Informational — one loose attribution sentence in `26-GATE.md` §3

*"In reading B, `popen` and `pclose` are referenced by `logging.cc.o`, and `kill`, `sigaction`
and `sigemptyset` are referenced by `signalhandler.cc.o` and `utilities.cc.o` — all three are
glog's own members."*

Measured in my run: `popen`/`pclose` → `logging.cc.o` (count 1) ✓. `kill` → count **2**,
`{Program.cpp.o, signalhandler.cc.o}` — glog's member is one of two, and it is not in
`utilities.cc.o`. `sigaction`/`sigemptyset` → count **5** each,
`{CrashRecoveryContext.cpp.o, Program.cpp.o, Signals.cpp.o, signalhandler.cc.o,
utilities.cc.o}` — glog's two members among five.

The point the sentence makes — *glog is both the compile wall and a process/signal consumer in
the upper bound* — is **true and measured**. The phrasing just omits that three of those five
symbols are also LLVM's, which the same document's attribution table states correctly two
paragraphs earlier. No claim is inverted; the sentence is merely tighter than the data.

## What the phase claims that the tree does not support

**Nothing found.** This is stated as a result, not as a formality — the phase was searched for
exactly this shape of failure:

- No `elflift.wasm` is claimed anywhere. Every one of the 17 tree-wide mentions of the string
  is a **denial** of its existence, in the harness docblock, the spec docblock, the plans, the
  summaries, the GATE (twice) and the AOTW-06 ledger row.
- No GO is claimed, and no reading is promoted past what it can carry: the two readings that
  could have produced a flattering zero-residue answer (A and AT) are **refused by the
  instrument's own disposition**, that refusal is asserted as data (`EXPECTED_INSUFFICIENT_READINGS`),
  and their residue of 1 (`__stack_pointer`, linker-supplied) is never read into the verdict.
- The verdict's weaker half is not smoothed back to the plan's stronger wording. 26-02's plan
  asserted "a NO-GO is conclusive"; the GATE carries the executor's narrower claim and
  **says that it is doing so**.
- AOTW-05's own sentence was narrowed before it was ticked ("the symbol residue an elflift link
  **could** demand … attributed to the archive member that references it") rather than ticking
  the plan's literal wording, which the measurement disowns.
- `descoped is not satisfied` was not used to close anything: AOTW-06 stays `[ ]`, STATE.md was
  not advanced, and 26-03's Task 3 is left open as a blocking owner decision.

## Verdict on the central question

**The negative is real, measured, and honestly scoped.** It was re-measured by this verifier in
its own container run and reproduced to the byte — including the figures no spec asserts (the
skip breakdown, the six object sizes, the per-reading undefined/defined counts, the
`insufficientReason` text). The wall named — glog with no `__wasi__` branch — was corroborated
outside the harness by reading glog v0.7.1's `platform.h` directly.

A measured negative is a legitimate terminal state and this phase reached it honestly rather
than avoiding it. The two warnings are prose precision in the ledger, not gaps in the evidence,
and are put to the owner rather than closed by this verifier.

---

_Verified: 2026-08-11T03:11:28Z_
_Verifier: Claude (gsd-verifier), goal-backward, FORCE stance_
