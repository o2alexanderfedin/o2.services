# Deferred items — Phase 26

Out-of-scope discoveries, logged rather than fixed. Each names what was measured and
what would close it.

## 2026-08-10 — two ledger sentences reached past their assertion; one was closed by moving the code, one by moving the sentence

**Found during:** the goal-backward verification of phases 26, 27 and 28
(`26-VERIFICATION.md` warnings W1 and W2), and corrected in the pass that follows it.

**AOTW-01 — "asserted *equal* to it at run time". Direction chosen: strengthen the code.**
The row was describing a guard that did not exist. The gate spec asserted
`expect(gate.image).toMatch(/@sha256:[0-9a-f]{64}$/)` — a shape any digest satisfies — and
`wasi-preview1-surface.sh` emitted **no `image` field at all**, so the surface spec's AOTW-01
case could only run `expect(IMAGE).toMatch(...)`: a constant against a regex, with no
run-time reading behind it, which would pass identically if the container had never been
started. The sentence was the better of the two, so the code was moved to it. `IMAGE_DIGEST`
is now passed into **both** containers, `surface.json` echoes it exactly as `gate.json`
already did, and both reports are asserted **equal** to the pinned constant. Watched red
rather than reasoned about: both harnesses were planted to echo `…-planted`, and exactly one
case reddened in each file —

```
 × AOTW-01 — the report names the pinned image's own wasi-sdk, not a host toolchain
 × AOTW-04 — the harness configured the FORK and replayed real translation units
   Expected: "ghcr.io/yomaytk/elfconv@sha256:22a404…f19c05"
   Received: "ghcr.io/yomaytk/elfconv@sha256:22a404…f19c05-planted"
```

`2 failed | 12 passed`, `AOT_PLANT_EXIT=1`; restored by the surgical inverse of each plant
and `cmp`-verified byte-identical against pre-plant snapshots (`CMP_SURFACE=0 CMP_GATE=0`),
so the green reading of the same two files taken before the plant — `2 passed / 14 tests`,
`AOT_EXIT=0`, 149.94 s — stands for the restored tree.

**AOTW-04 — "*Every* non-test translation unit of this repository's elfconv fork". Direction
chosen: tighten the sentence.** Measured is the **27 non-test entries of the elflift compile
database** (38 entries minus 11 named skips). Eight files in `third_party/elfconv` are in no
cmake target this phase configures — `runtime/Entry.cpp`, `runtime/Memory.cpp`,
`runtime/Runtime.cpp`, `runtime/VmIntrinsics.cpp`, `runtime/syscalls/SyscallWasi.cpp`,
`SyscallBrowser.cpp`, `SyscallNative.cpp` and `utils/elfconv.cpp` — all **stage-2 runtime**
sources, verified present on disk. Widening the code to compile them would be measuring a
stage this phase's NO-GO does not depend on and explicitly prices as unbuilt (`26-GATE.md`
§6, §7), so the population is right and the word "every" was not. The requirement now reads
*"every non-test translation unit of the elflift build's own compile database"*, and the
traceability row names the eight excluded files rather than leaving the difference to be
inferred. `26-GATE.md` needed no change; it was precise already.

**The pattern, recorded because it repeated six times in one verification.** Six documents
claimed more than their code. Three of the six were `file:line` citations that had drifted,
and one of those was stale **in the same commit that wrote it**. A sentence and an assertion
diverge silently in both directions: prose that overstates never reddens, and prose that
understates hides how much the assertion has stopped covering.
