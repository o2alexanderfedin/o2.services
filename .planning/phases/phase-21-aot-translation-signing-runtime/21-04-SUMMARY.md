---
phase: phase-21-aot-translation-signing-runtime
plan: 04
subsystem: build-tooling
tags: [aot, elfconv, wasi, guest, echo, content-addressing, cache-key, provenance]

requires:
  - phase: phase-21-aot-translation-signing-runtime
    plan: 01
    provides: LiftedArtifact.translation, the emitted key CID, tools/aot/stubs.ts
  - phase: phase-21-aot-translation-signing-runtime
    plan: 02
    provides: describeLift's two labelled CID lines, --image/--docker on argv
  - phase: phase-10-elfconv-aot
    provides: WasiExecutor, the pinned WASI environment, the lift driver
provides:
  - "ECHO_GUEST_C — a stdio-free stdin→stdout copy, the first guest a lifted artifact can finish a fabric job with"
  - "HELLO_GUEST_C — the printf counterpart, held here rather than in /tmp, as the negative control"
  - "buildGuest / liftThroughCli — a guest compiled inside the pinned image and lifted through the real command, with both printed CIDs read off their labels"
  - "The measurement: an artifact elfconv produced returns a fabric result, with fuel equal to a source-compiled echo's"
  - "The end-to-end half of roadmap criterion 2's second clause: two real lifts, two different key CIDs, the moved input named"
affects: [phase-21-plan-05, phase-13.1-message-bounds, phase-22-reachability]

tech-stack:
  added: []
  patterns:
    - "A guest is reproducible from C in the repository, compiled by the toolchain image itself — never committed as a binary"
    - "C is written into a container through a quoted heredoc, so no character in it can become shell"
    - "A CID is read off its own labelled line; both CIDs the CLI prints render bafyrei… and no assertion in this plan matches one by shape"
    - "An assertion that cannot fail is labelled at the line rather than deleted or left to be read as evidence"

key-files:
  created:
    - tools/aot/echo-guest.ts
    - tools/aot/echo-guest.node.test.ts
  modified: []

key-decisions:
  - "The env override gates separately from the image: a host pointing at pre-lifted bytes has no CLI stdout, so criterion 1's emission half skips on its own rather than inside one combined gate"
  - "toolchain is read off the CLI's stdout and inputDigest/features are derived independently — stated as two-of-four rather than left to read as a full recomputation"
  - "A plant that left the file green is reported as such, and the unexercised code it exposed is labelled in the source"

patterns-established:
  - "Three mutations planted and observed red with their text recorded; a fourth left the file green and that is reported rather than replaced silently"
  - "Every restore verified by cmp to exit 0, never by git checkout"

requirements-completed: []

duration: 105min
completed: 2026-08-04
---

# Phase 21 Plan 04: a guest a translated artifact can finish a job with — Summary

**An artifact `elfconv` produced, from C held in this repository, lifted by the command a
person types, ran under `WasiExecutor` and returned the shard's own value. That had never
happened before. The risk this plan could have lost to — the lifted glibc startup reaching
one of the 174 addresses elfconv left untranslated — was measured and did not land.**

## Performance

- **Duration:** ~105 min
- **Tasks:** 2 of 2
- **Files:** 2 created, 0 modified
- **Cases:** `tools/aot` 154 → **165** (+9 here, +2 from another agent's work in the same window)

| Commit | What |
|---|---|
| `5401bc3` | Task 1 — `tools/aot/echo-guest.ts`, the guests and the two harnesses |
| `fe804be` | Task 2 — `tools/aot/echo-guest.node.test.ts`, the measurement |
| `7049469` | The two lines that cannot fail, labelled — both found by planting |

## The host, so every figure below can be read

MacBookPro18,3, 8 cores, 32 GB, Darwin 25.5.0, Docker Server 29.4.0 (containerd image
store, OrbStack). **Two other agents were working this same checkout throughout** — one on
`browser-node.ts`/`fabric-node.ts` and ~59 call sites, one on
`packages/core/src/job/submit.ts`. Neither touched `tools/aot`, verified at start and
again at end. Every duration is `/usr/bin/time -p` on the process that produced it, never
a system load average.

```
$ docker image inspect ghcr.io/yomaytk/elfconv:arm64 --format '{{.Id}}'
sha256:22a404f31c9f7bb5c49e3193081d4876718253d86747aae3d30fcfd971f19c05   # exit 0
```

That is the digest `MATCHING_DIGEST` (`tools/aot/stubs.ts`) pins. **`imageIsPresent()`
returned `true`, and every one of this file's nine cases RAN.** Vitest reports
`9 passed (9)` with no skip line. 21-CONTEXT.md's Risk 2 asks for this sentence
specifically: the real-image half of this plan was measured on the host named above, and a
skip here would have been a plan failure rather than a host limitation. It was neither.

## The two guests, so the run is auditable afterwards

Both built by `buildGuest` inside the image and lifted by `spawnSync`-ing
`tools/aot/cli.ts` as a program.

| | **echo** | **hello** |
|---|---|---|
| ELF bytes | 659 256 | 659 392 |
| ELF sha-256 | `cebf934f57bf0e668dd4e65dab80b742fcb909b9fa9579666cc7b8bbd4311887` | `2ca56b82b951a6d2c8905468319ddd42200b07e6993f8428e59f6a76488921ed` |
| build | 667 ms | 640 ms |
| lift (CLI wall) | 99 538 ms | 101 292 ms |
| CLI exit | **2** | **2** |
| artifact bytes | **5 660 003** | **5 662 885** |
| artifact sha-256 | `26461143b035f4ca63f147acf8324499b1318956f7953e5ffb126be575145fd1` | `73a27c689c8a20e4840d3239eb34791f56a4147e559e1d3581daad86817998a1` |
| **emitted key CID** | `bafyreiexejqg25mxzjlybzrzq5sfdk2roy7kkjs5e4jrnfl46jatw73pgm` | `bafyreid77bug7uea74pkfb26rqn6yidrn2bajl2uxylylvngaeiyu3s2ja` |
| artifact CID | `bafyreibgiyiuhmbv6tfgh4khvt4derezweyysvxxsu7f76ysnpsxkfc72e` | `bafyreidtuj6grhekedsiidjshhvti6i7k2sbi7svtyotlao2vwdic6myue` |
| required features | `bulk-memory mutable-globals sign-ext` | `bulk-memory mutable-globals sign-ext` |
| untranslated | 174 addresses / 259 call sites, from `0x4179d4` | 174 addresses / 259 call sites, from `0x41cf54` |

**The two key CIDs differ**, and the one covered input that moved is `inputDigest` —
asserted from the two recomputed keys, with `toolchain` and `features` asserted equal
beside it. That is the end-to-end half of roadmap criterion 2's second clause; the repeat
half is `lift.node.test.ts`'s, closed by Plan 21-01.

Exit **2** on both, not 0. `cli.ts`'s own docblock says a glibc-static input always lands
on reservations, and both did — so a case asserting 0 would have failed on a correct run.
21-02 had to *arrange* a reservation because a stub lift is `clean`; here the reservation
is real and the driver's own.

## The claim

```
expect(outcome.ok).toBe(true)
expect(outcome.value).toEqual({ n: 1, tag: 'echo' })
expect(outcome.stdoutBytes).toBe(inputBytes)   // 13
expect(outcome.stdinConsumed).toBe(inputBytes) // 13
```

All four hold. Fuel is `13 + 13 = 26` on the WASI side and the same on a real
`WasmExecutor` over `MODULE_ECHOES_INPUT` and the identical value, and `wasiOutcome.output`
deep-equals `nativeOutcome.output` — so Plan 21-05's cross-ABI comparison has something to
compare, and the equality it will repeat across two real processes is already true in one
heap.

**The hello guest ends `not-dag-cbor` in the same file**, so the success is discriminating
rather than permissive.

## What was measured

### The suite

| run | result | `real` | `user` | `sys` | `(user+sys)/real` |
|---|---|---|---|---|---|
| `tools/aot/echo-guest.node.test.ts`, first green | **9 passed, exit 0** | 198.44 s | 2.81 | 0.70 | 0.018 |
| the same, after the two annotations | **9 passed, exit 0** | 210.08 s | 2.92 | 0.73 | 0.017 |
| the standalone two-guest lift probe | — | 202.45 s | 1.67 | 0.30 | 0.010 |
| `tools/aot`, whole | **4 files, 165 passed, exit 0** | 366.12 s | 8.15 | 1.93 | 0.028 |
| whole `--project node` | 147 files, **2124 passed, 2 skipped, 2 failed, exit 1** | 390.72 s | 283.68 | 45.54 | 0.84 |

`npx tsc --noEmit` on the whole tree: **exit 0**, read directly from `$?`.

Every exit code above was taken with `EXIT=$?` on the line immediately after the command,
with output redirected to a file and the file grepped afterwards. **One commit in this plan
was reported as `EXIT=0` when it had in fact failed**, because the command was piped to
`tail` — the trap CLAUDE.md names, hit once, caught by re-running without the pipe. See
deviation 4.

The three ratios in the 0.01–0.03 band are the same shape `tools/aot`'s other integration
file has: nearly all of that wall clock is a container the process is waiting on, not CPU
it is being denied.

### The two failures in the whole-project run, and why neither is this plan's

**Attributed by reading the diff in the failure message, not by plausibility.**

| file | what it said | the evidence |
|---|---|---|
| `bench-attestation.node.test.ts` | `expected 'M  packages/core/src/job/submit.test…' to be 'M  packages/core/src/job/submit.test…'` | The `git status --porcelain` sweep. The two lines that moved are `packages/net/src/reduce-job.test.ts` (unstaged → staged) and `packages/node/src/commit-scope.ts` (vanished — another agent committed it mid-run). **No `tools/aot` path appears in the diff at all.** |
| `late-combine.node.test.ts` | `expected 1500 to be greater than 3213.284160000003` | A within-run ratio between a constant `RPC_TIMEOUT_MS` and a measured healthy-combine time. 21-02 recorded the identical file failing the identical way under the identical conditions. |

`tools/aot`'s four files are green inside that run, and green again in the dedicated
`tools/aot` run above at exit 0.

### The plants — three observed red, one observed green

Every plant was snapshotted with `cp`, run, restored from the snapshot, and `cmp`'d to
exit 0. **All restores verified; `git status --short -- tools/aot/` was empty after each.**
No `git checkout --` was used anywhere.

| # | plant | observed | fires on |
|---|---|---|---|
| A | point `O2_AOT_ARTIFACT` and `O2_AOT_HELLO` at the **hello** artifact | `AssertionError: output is not valid DAG-CBOR: CBOR decode error: not enough data for type: expected false to be true` — 2 failed \| 4 passed \| 3 skipped | *runs under WasiExecutor…* and *reports the fuel…* |
| B | `describeLift` prints the **artifact** CID under the key label (21-CONTEXT mutation 5) | `AssertionError: expected 'bafyreibgiyiuhmbv6tfgh4khvt4derezweyy…' to be 'bafyreiexejqg25mxzjlybzrzq5sfdk2roy7k…'` — 1 failed \| 8 passed | *shows the operator the key CID of this artifact…* |
| C1 | `while (put < got)` → `while (put < got - 1)` in `ECHO_GUEST_C` | **GREEN — 6 passed \| 3 skipped.** The plant did not fire. | nothing |
| C2 | `buf[got - 1] ^= 1;` — the guest flips the last bit it echoes | `AssertionError: expected { n: 1, tag: 'echn' } to deeply equal { n: 1, tag: 'echo' }` — 2 failed \| 4 passed \| 3 skipped | *runs under WasiExecutor…* and *reports the fuel…* |

**C2 is the one that matters.** It fires on `expect(outcome.value).toEqual(SHARD_VALUE)`
itself, which is the single strongest line this plan writes: a one-bit change in what the
guest emits is caught on the *value*, not on a byte count and not on the codec. The value
coming back is the shard's own value, byte for byte, and that is now proved rather than
observed.

**C1 left the file green and that is reported rather than replaced silently.** The reason
is measurable and is now written into `ECHO_GUEST_C`'s own doc: the shard's input block is
**13 bytes** (measured 2026-08-04 by reading `.length` off
`encodeCanonical({n: 1, tag: 'echo'}).bytes`), so `read` returns the whole block on its
first call and `write` takes all of it in one — **neither loop in the guest iterates
twice.** The loops stay, because they are correct for an input nobody has sent yet, but
they are labelled as unexercised instead of left to read as covered. The case that
actually carries the echo claim is C2's.

**Plant B fires on the first of that case's three assertions and stops there**, so the
other two (`printedArtifactCid === blockCid(artifact)` and `printedKeyCid !== printedArtifactCid`)
are not *separately* observed red under it. The `not.toBe` would also have caught it — the
mutation makes the two strings identical — but "would have" is not "was", so it is stated
that way. Note also that *emits a different key CID for a different guest* **passes** under
plant B, because the two artifact CIDs differ too; it is not a check on which CID was
printed and is not offered as one.

### The two assertions that cannot fail, labelled at the line

- **`expect(echoKey.target).toBe(helloKey.target)`** — both sides read the same imported
  `LIFT_TARGET` in the same process. It carries no evidence. Labelled rather than deleted,
  because a reader who found three equalities beside one inequality would otherwise read
  all four as evidence. `toolchain` and `features` beside it *are* real: both are parsed
  out of two separate CLI stdouts.
- **The three byte-count lines** in the central case (`inputBytes`, `stdoutBytes`,
  `stdinConsumed`) are guarded by the same case as `outcome.ok` and `outcome.value`, and
  every plant tried here fires on one of those two first. **No plant in this plan
  independently shows a byte-count line can fail.** Stated rather than implied.

## Deviations from plan

### 1. [Rule 1 — 21-CONTEXT decision 9's stated reason for avoiding stdio is measured NOT SUPPORTED]

Decision 9 and this plan's Task 1 both say: use `read(2)`/`write(2)` and not stdio, because
*"fewer glibc paths, fewer chances"* of reaching an address elfconv left untranslated.

**Measured, on this host, against these two guests:** the stdio-free echo carries **174
untranslated addresses over 259 call sites**, and the `printf` hello carries **174
untranslated addresses over 259 call sites**. The counts are identical. The *addresses*
differ (`0x4179d4…` vs `0x41cf54…`) because the binaries are laid out differently, but the
count-based argument for choosing `read`/`write` over `printf` is not supported by this
measurement.

What actually decided the outcome is the other clause of the same risk — whether execution
*reaches* one of them — and **neither guest does**: the echo runs `_start` to completion and
returns a value, and the hello runs `_start` to completion and writes ASCII. So the choice
was harmless and the reason given for it was not the reason it worked. The guest's doc no
longer asserts a count and says the count for this guest was unmeasured until it was
lifted; that instruction from the plan was followed, and this row is what the measurement
then said.

**This does not change the guest.** Rewriting it around stdio now would spend a lift to
learn nothing, and the stdio-free version is the one that has been measured end to end.

### 2. [Rule 1 — the plan's `<interfaces>` quotes a line of `wasi-real.node.test.ts` that no longer exists]

The plan gives the "a real artifact if you have one" convention as
`wasi-real.node.test.ts:51`:

```ts
const ARTIFACT = process.env['O2_LIFTED_WASM'] ?? '/tmp/ecvout/r1/hello.wasm'
```

**Measured false.** That file now reads
`process.env['O2_LIFTED_WASM'] ?? fileURLToPath(new URL('../../../tools/aot/fixtures/r1/hello.wasm', import.meta.url))`,
and its own docblock records why: *"It lived in `/tmp` until 2026-08-02, which is how this
file's five cases went inert (deficiency D21)."* The plan quotes the **pre-fix** line and
holds it up as the convention to follow.

The convention was followed in its corrected form — the falsification guest is `HELLO_GUEST_C`,
held in the repository, and `HELLO_GUEST_C`'s own doc names D21 as the reason. Worth
knowing for whoever reads that fixture path: `tools/aot/fixtures/r1/hello.wasm` is
**gitignored** (`.gitignore:64`) and present on this host at 5 451 576 bytes, so
`wasi-real.node.test.ts` runs here and would skip on a fresh clone.

### 3. [Rule 1 — the plan's line numbers are stale, as 21-01 and 21-02 both found]

Located by content, never by offset. The subject-building `beforeAll` the plan cites at
`lift.node.test.ts:1046-1076` is at `:2489-2509`; the `> 1_000_000` floor cited at `:1093`
is at `:2523`; `liftedArtifact` cited at `:1026-1050` is at `:2462`; `WasiExecutor.run`
cited at `wasi-executor.ts:766-900` is at `:777`; the stdio observation cited at
`wasi-real.node.test.ts:118-130` is at `:124-136`. The plan's read-list also names
`cli.ts:158-176 (invokedAsCommand)` — **there is no `invokedAsCommand` in that file**; the
guard is `classifyEntry` at `:309`, and the old name survives only inside a docblock
describing what it used to be. `tools/aot/features.ts:208 (readTargetFeatures)` is the one
citation in the plan that was exactly right.

### 4. [Rule 1 — a commit reported success while failing, because it was piped to `tail`]

The third commit's shell line ended `... 2>&1 | tail -6; EXIT=$?`, so `$?` was **`tail`'s**
exit code and the run reported `EXIT=0`. The commit had in fact been refused by the
pre-commit guard. Caught by reading `git log` rather than the reported code, then re-run
with output redirected to a file:

```
FAIL  |node| packages/node/src/vocabulary.node.test.ts > no cryptojacking vocabulary reaches a reviewer who greps
AssertionError: expected [ Array(1) ] to deeply equal []
```

The finding named one line of `tools/aot/echo-guest.node.test.ts` and the currency word in
it — the same word the vocabulary case's own title is about. It was mine, in a comment.
Reworded to *"read all four as evidence"*; the commit then landed at exit 0.
`O2_SKIP_GUARDS=1` was **not** used. This is the trap CLAUDE.md names in its own words and
it was hit anyway — recorded so the next reader sees that the rule is not theoretical.

**And the finding is paraphrased above rather than quoted, for a second reason learned the
same way.** The first version of this section pasted the guard's own output verbatim, which
put the banned word into *this* file and made the summary's own commit fail the identical
case — twice over, once per copy of the quoted string. That is 21-01's lesson about
`REQUIREMENTS.md` rows, in a different file: **a document that reproduces the sentence it is
reporting has that sentence read back as its own.**

### 5. [Rule 3 — `tsc --noEmit` reported seven errors in another agent's mid-edit files]

`packages/core/src/job/submit.ts` and `packages/net/src/reduce-job.test.ts`, mid-edit for
plan 20-07, with **zero** errors in anything under `tools/`. Both cleared on a later run
with nothing on this side changing, and one intermediate probe failed to even *load* with
`ERR_INVALID_TYPESCRIPT_SYNTAX` at `submit.ts:2271`. Re-run before diagnosing; that is what
it is for. Nothing outside this plan's two files was touched.

## Span movement — two findings the table's owner needs

**`tools/aot` went 218.61 s → 366.12 s**, a move of ~148 s, and it is this plan's: the new
file is ~200 s of container wall clock running in parallel with `lift.node.test.ts`'s
~235 s. That is material and is reported rather than left to be discovered.

**But `--reporter=json` will not see it, and that is the part that matters.** Measured
directly on this file:

```
run   startTime  1785908136702
file  startTime  1785908330716   endTime 1785908331119
file duration    403 ms          sum of the nine assertion durations 402 ms
```

The 194 014 ms `beforeAll` is attributed to **nothing**. So a re-measurement of
`MEASURED_NODE_SPANS` taken the documented way — `npx vitest run --project node
--reporter=json` — would record `tools/aot/echo-guest.node.test.ts` at **403 ms**, i.e.
*below* `SLOW_CUTOFF_MS` (1000), which means:

- it would be listed **below the cut** rather than excluded, and
- `test:unit` (`O2_UNIT_ONLY=1`) would carry ~200 s of Docker with no entry anywhere saying
  why.

This is the same defect 21-02 recorded in one sentence (*"a 154 s file once reported
235 ms"*), now with the arithmetic attached and a concrete file it will land on. It also
raises a question about `lift.node.test.ts`'s recorded **235 551 ms**: that file has the
identical shape, so whatever produced that figure was **not** the file duration this
reporter emits. Somebody should establish which.

**`vitest.config.ts` was not edited.** It is not one of this plan's two files, and writing a
span into that table from a different run than the one it records would be exactly the
thing the table exists to prevent. The file-count drift check is still inside tolerance:
`NODE_PROJECT_FILES` is now **147** against a recorded 144, drift **3**, tolerance **5** —
but the margin is two files, and two other agents are adding specs in this same checkout.

> **The two-file margin was spent, and has since been restored. Recorded 2026-08-05.**
> Drift reached **6 of 5** and `slow-specs.node.test.ts` went red — `21-VERIFICATION.md`'s
> W2, which attributes it to 20-11's `checkpoint-agents.node.test.ts` and explicitly not to
> this plan. `MEASURED_NODE_SPANS` was then retaken in full at `files: 150`, and a run
> today reads **EXIT=0, 9 passed**. The sentence above was accurate when written, became
> false, and is accurate again; it is annotated rather than edited, because a count in a
> summary is a dated reading and not a standing claim.

> **The prediction in the section above was borne out exactly.** This plan wrote that a
> `--reporter=json` re-measurement *"would record `tools/aot/echo-guest.node.test.ts` at
> **403 ms**, i.e. below `SLOW_CUTOFF_MS`"*, and asked *"somebody should establish"* what
> produced `lift.node.test.ts`'s recorded 235 551 ms. Both were settled on 2026-08-05 in
> `vitest.config.ts`: `echo-guest` is recorded at **520 986 ms** of solo wall clock with
> the note `// wall clock; reporter said 2_019`, and `lift.node.test.ts` was measured to
> **agree** with the reporter within 1.2 % because all three of its `beforeAll`s sit
> *below* its first case — so the discriminator is positional, and this plan's suspicion
> about that file was reasonable and wrong. Noted here so the open question does not read
> as still open.

## Known limits, stated rather than implied

- **This is one process on one host.** The cross-ABI fuel equality, the value, the repeat —
  all in one heap. Plan 21-05 owns the across-real-processes half, and `CROSS_MACHINE_BLIND_SPOT`
  is still on both artifacts, untouched.
- **The guest's short-read and short-write loops are unexercised.** 13-byte input; see plant
  C1. They are correct and they are unmeasured, and the source now says so.
- **No byte-count assertion is independently shown able to fail.** See above.
- **`echoKey.target === helloKey.target` cannot fail** and is labelled at the line.
- **The 174 untranslated addresses are still there in both artifacts.** Nothing here shows
  they are unreachable in general — only that neither guest reached one on this host, on
  these runs, under the emulated auxv. `REACHABILITY_BLIND_SPOT` is on both artifacts and
  stays.
- **`clean → 0` is still unmeasured from the CLI** — carried forward from 21-02 untouched;
  both guests here are `reservations`.
- **The refusal covers blank and only blank** — carried forward from 21-01 and 21-02
  untouched. Both guests' `meta.txt` reported real versions and none of them is the literal
  `unknown`, so nothing here widened or narrowed that limit.
- **The re-tag half of AOT-02 remains a measured negative on this host.** Not re-litigated;
  nothing in this plan touches `resolveImage`.

## What this changes in the ledger, and what it does not

**AOT-04 is deliberately NOT marked complete, and neither is AOT-02.** `.planning/REQUIREMENTS.md`
was not modified, per the execution instruction for this shared working tree. Two rows now
carry prose this plan made false, and their owner should know:

- **AOT-02's row** says *"the emitted CID has never been compared across two genuinely
  different inputs end to end (Plan 21-04)."* That is now false: two real lifts, two
  different key CIDs, the moved input named. The row's **checkable** claim —
  *"`describeKey` is reachable only through `describeLift`"* — is untouched and still true;
  nothing in this plan calls `describeKey`, so `requirements-ledger.node.test.ts` does not
  redden. Verified by grep and by the whole-project run.
- **AOT-04's row** says the outstanding half is *"the ABI verified against a real elfconv
  artifact rather than a hand-written fixture, across real processes (Plan 21-05)."* The
  *real artifact* clause is now closed; the *across real processes* clause is not, and it is
  still 21-05's. Marking AOT-04 done here would report a criterion met on the strength of an
  in-process run.

`STATE.md` and `ROADMAP.md` were not modified, for the same reason.

## Self-Check: PASSED

- `tools/aot/echo-guest.ts` — FOUND, 409 lines (plan asked for ≥ 90)
- `tools/aot/echo-guest.node.test.ts` — FOUND, 543 lines (plan asked for ≥ 120), 9 cases
- `5401bc3`, `fe804be`, `7049469` — all FOUND in `git log`
- `git show --stat` on each — **only this plan's two files**, in a checkout where another
  agent had three files staged throughout
- `git status --short -- tools/aot/` — empty; both plant restores `cmp`'d to exit 0
- `npx tsc --noEmit` — exit 0
- `npx vitest run --project node tools/aot` — **4 files, 165 passed, exit 0**, read from `$?`
- `npx vitest run --project node` — 2124 passed, 2 skipped, 2 failed, exit 1; both failures
  are other agents' files and are attributed above by the diff in their own failure messages

---
*Phase: phase-21-aot-translation-signing-runtime*
*Completed: 2026-08-04*
