---
phase: phase-21-aot-translation-signing-runtime
plan: 02
subsystem: build-tooling
tags: [aot, cli, argv, content-addressing, cache-key, docker, image-digest]

requires:
  - phase: phase-21-aot-translation-signing-runtime
    plan: 01
    provides: LiftedArtifact.translation, translationKeyOf, tools/aot/stubs.ts
  - phase: phase-10-elfconv-aot
    provides: resolveImage and its two digest refusals, describeLift, the CLI entry guard
provides:
  - "describeLift renders both CIDs on their own labelled lines, inside the one string it returns"
  - "parseAotArgs reads --image and --docker in any position, with no -1 sentinel left in it"
  - "ArgFailure.missing-flag-value — one failure carrying the flag, replacing missing-out-value"
  - "main forwards both flags into liftElf, so the image refusal is reachable from a typed command"
  - "cli.node.test.ts drives both halves of AOT-02 through the spawned program"
affects: [phase-21-plan-04, phase-21-plan-05, phase-14-signed-artifact-resolution]

tech-stack:
  added: []
  patterns:
    - "A CID is read off its own labelled line, never matched by shape: both CIDs the CLI prints render `bafyrei…`"
    - "An expected CID is recomputed in the test from inputs the test handed over, never pinned as a literal"
    - "A flag table plus a consumed-index set, so no parser state can mean 'not found'"

key-files:
  created: []
  modified:
    - tools/aot/lift.ts
    - tools/aot/lift.node.test.ts
    - tools/aot/cli.ts
    - tools/aot/cli.node.test.ts

key-decisions:
  - "describeKey is deliberately not called: giving it a production caller would redden requirements-ledger.node.test.ts's AOT-02 row, and the three lines describeKey would print are already on the lines around the CID"
  - "The emission case arranges a reservations lift rather than asserting exit 0, because a default stub lift was measured clean — the plan's stated reason for exit 2 is false of the stub"
  - "The real-re-tag case measures why the refusal does not fire on Docker 29.4.0 instead of asserting a refusal that this host cannot produce"

patterns-established:
  - "Six mutations planted, each observed red with its text recorded, each restored by cp and cmp'd to zero"
  - "A case written to prove X that measured not-X keeps its measurement and says so, rather than being deleted"

requirements-completed: []

duration: 70min
completed: 2026-08-04
---

# Phase 21 Plan 02: the operator sees the name, and the borrowed name is — measured — Summary

**The CID the pipeline emits is now printed to whoever ran the command, on its own
labelled line inside the same string as the reservations; `--image` and `--docker` are on
argv; and the criterion's re-tag half was measured rather than asserted, which is how it
came back *not met on this host* for a reason that is about Docker and not about this
code.**

## Performance

- **Duration:** ~70 min
- **Tasks:** 3 of 3
- **Files modified:** 4 (0 created)
- **Cases:** 140 → **154** in `tools/aot` (+2 in `lift.node.test.ts`, +12 in `cli.node.test.ts`)

| Commit | What |
|---|---|
| `c3b747a` | RED — both spec files, against an API that did not exist |
| `765283b` | GREEN — `describeLift` carries the CIDs; the CLI takes the two flags |

## The host, so every figure below can be read

MacBookPro18,3, 8 cores, 32 GB, Darwin 25.5.0, **Docker Server 29.4.0**. **Three other
agents were executing plans 20-01/02/03 in this same checkout and this same git index
throughout.** Every duration below is `/usr/bin/time -p` on the process that produced it,
never a system load average.

`docker image inspect ghcr.io/yomaytk/elfconv:arm64` returns
`sha256:22a404f31c9f7bb5c49e3193081d4876718253d86747aae3d30fcfd971f19c05`, so
**`HAVE_IMAGE` was true and the one `it.skipIf(!HAVE_IMAGE)` case in `cli.node.test.ts`
RAN.** The full `tools/aot` run reports `154 passed (154)` with no skip line at all.
21-CONTEXT.md's Risk 2 asks for this sentence: the real-image half of this plan was
measured on the host named above, against the image at `sha256:22a404f3…`.

## What was built

### Task 1 — `describeLift` carries the emitted CID

Two lines, pushed after the `needs …` feature line and before the toolchain versions:

```
  translation key cid: bafyrei…
  artifact cid: bafyrei…
```

Inside the one string, not written beside it by `main`, for the reason the function's own
docblock already gave about the reservations. The code comment borrows `cache-key.ts`'s
own distinction: hashing the artifact answers *are these the same bytes*, hashing the key
answers *should these be the same bytes*, and the gap between the two answers is a
reproducibility defect detectable only because both are printed.

**`describeKey` is not called, and that is a decision rather than an omission.** Task 1's
read-list points at it. Two facts against: the three things `describeKey` renders — target,
toolchain, feature set — are already on the lines immediately around these two; and
`requirements-ledger.node.test.ts` treats every non-test `.ts` under `tools/` as
production and holds AOT-02's row to its own claim that *`describeKey` has no production
caller*. Calling it would have turned that row false and reddened a guard whose fix lives
in `.planning/REQUIREMENTS.md`, which this plan does not own. The gap stays open and stays
named.

> **REVERSED 2026-08-04, recorded here 2026-08-05.** The paragraph above is retained
> verbatim because its reasoning is still the reasoning — but it no longer describes the
> tree. Commit `ddca460` (*"show the input digest, and record the borrowed name as
> measured"*, defect #41) gave `describeKey` its production caller: `tools/aot/lift.ts`
> pushes `key as hashed: ${describeKey(artifact.translation.key)}` inside `describeLift`,
> and the file's own comment at that line names this summary — *"21-02 declined this on the
> grounds that `describeKey` would only repeat the target…"*. `AOT-02`'s row was corrected
> in the same commit, so nothing in the tree is inconsistent; what is stale is this
> document's statement of the decision. Verified 2026-08-05 by
> `grep -rn describeKey --include='*.ts'`: two non-test callers, `tools/aot/lift.ts` and
> `packages/aot/src/index.ts`'s re-export. See `## Correction 2026-08-05` at the foot.

### Task 2 — `--image` and `--docker` on the argv surface

`parseAotArgs` is one left-to-right pass over a three-entry `VALUE_FLAGS` table,
collecting consumed indices into a `Set<number>`. The `-1` sentinel is gone rather than
guarded a fourth time: there is no state in the new parser that means "not found", so
there is no value that can be mistaken for a position.

`ArgFailure`'s `missing-out-value` became `{ kind: 'missing-flag-value'; flag: string }`.
The plan enumerated **five** sites for that rename and the count was right; the line
numbers were stale by 3–9 lines in each case. Before the task,
`grep -rn "missing-out-value" tools/aot/` returned exactly those five lines and exited 0;
after it, it returns nothing and exits 1. **Exactly the two pre-existing assertions the
plan named were edited**, both by the rename.

`main` forwards both flags with the conditional-spread idiom from `bin/agent.ts`, so an
absent flag passes no property at all — under `exactOptionalPropertyTypes` an explicit
`undefined` is a different value from an omitted key, and only the omission lets
`liftElf`'s own defaults apply.

### Task 3 — the two proofs that need the real program

A fourth describe block in `cli.node.test.ts`, four cases, all through
`spawnSync(process.execPath, ['--experimental-strip-types', CLI, …])`:

1. **The emitted CID is printed.** The key-CID line is compared to a `TranslationCid`
   recomputed in the test from the ELF's own sha-256, `LIFT_TARGET`, the digest the stub
   answers `image inspect` with, the five `meta.txt` versions this file handed the stub,
   and the feature set read out of the artifact's own `target_features` section. The
   artifact-CID line is compared to `blockCid` of the bytes read back off the `--out`
   path. The two are then required to differ.
2. **A foreign digest list is refused, and no container is started** — exit 1, stderr
   naming the wanted repository and a found digest, and the stub's invocation log holding
   exactly one entry, that entry an `image inspect`, and the joined log free of `run `.
   The exit code cannot make that last claim; only the log can.
3. **`--image` reaches the driver** — the stub logs the tag typed on the command line.
   No image needed on the host.
4. **What `docker tag` leaves in `RepoDigests`** — see the deviation below.

## What was measured

### The suite

| run | result | `real` | `user` | `sys` | `(user+sys)/real` |
|---|---|---|---|---|---|
| `tools/aot`, whole, after | **154 passed, exit 0** | 218.61 s | 5.77 | 1.22 | 0.032 |
| `tools/aot/cli.node.test.ts` alone, after | **31 passed, exit 0** (before the last case was added) | 5.12 s | 3.76 | 0.67 | 0.87 |
| `tools/aot/lift.node.test.ts -t '<rendering block>'`, green | **7 passed, exit 0** | 1.41 s | 1.10 | 0.29 | 0.99 |

The two `tools/aot` figures from 21-01 (356.92 s / 205.24 s) and this one are **not
comparable as a speed claim and are not offered as one**: ~93 % of that wall clock is one
integration `beforeAll` waiting on Docker, and three other agents were running suites
throughout.

`npx tsc --noEmit` on the whole tree: **0 errors in any file this plan owns**, and after
the commits below, **0 errors in the whole tree, exit 0**. Two intermediate runs reported
errors in `packages/core/src/job/submit.ts` and `packages/net/src/reduce-job.test.ts` —
both another agent's mid-edit files, both untouched here, both cleared by a later run
without anything on this side changing. Re-run before diagnosing; that is what it is for.

### The whole node project, and the three failures that are not this plan's

`npx vitest run --project node` after the commits: **2021 passed, 2 skipped, 3 failed,
exit 1** — `real 290.34 s`, `user 238.66`, `sys 37.97`, ratio **1.22**. All 141 test files
ran; **`tools/aot`'s three files are green inside that run**, and every one of the three
failures is another agent's in-flight work in this shared checkout:

| file | what it said | why it is not this plan's |
|---|---|---|
| `bench-attestation.node.test.ts` | `expected '?? .planning/phases/phase-20-single-j…' to be '?? .planning/phases/phase-20-single-j…'` | the `git status --porcelain` sweep CLAUDE.md names as a shared hazard, tripped by an untracked file appearing under **phase-20**'s directory mid-run |
| `discovery-agents.node.test.ts` | `expected 'agreed' to be 'insufficient'` | plan 20-0x's placement work |
| `late-combine.node.test.ts` | `expected 1500 to be greater than 4569.14…` | a file that did not exist when this plan started — it was `??` in `git status` throughout |

Nothing in `packages/` or `demo/` names `describeLift`, `parseAotArgs` or `aot/cli`
(measured by `grep -rln`), so this plan has no reverse dependencies outside `tools/aot`.

### The load correlation 21-01 recorded — did not reproduce

21-01 recorded three cases in `lift.node.test.ts` failing at 20 006 / 20 007 / 20 010 ms,
correlated with a second full `--project node` suite running concurrently. **No such
clustering appeared in this plan's runs**, including the 218.61 s whole-`tools/aot` run
taken while three other agents were working the same checkout. Nothing here confirms or
refutes 21-01's correlation; it is one more reading, in the arm where the failure did not
occur.

**Where `-t` was used, and what it skipped.** The Task 1 loop used
`-t 'a rendered lift carries its reservations in the same string as its numbers'`, which
skips the integration `beforeAll` entirely — 110 of 117 cases skipped, 1.4–1.8 s instead
of ~205 s. Two parser-mutation runs used `-t 'the input binary is found wherever --out is
not'`, skipping 23 of 32 including the whole subprocess block. **Every claim about the
whole file rests on the full 218.61 s run above, not on those.**

### The six mutations, each observed red and each restored

Every plant was made in a file this plan owns, run, then restored from a `cp` snapshot and
`cmp`'d to exit 0. **All six restores verified.**

| # | plant | observed | fires on |
|---|---|---|---|
| 1 | `describeLift` prints the artifact CID under the key label (21-CONTEXT mutation 5) | `expected 'aarch64-wasi32 · 67 bytes · 95.0s · R…' to contain 'translation key cid: bafyreian3ggun42…'` — 2 failed | *carries the name…* and *labels the key and the artifact…* |
| 2 | restore `resolveImage`'s `digests[0]` fallback (21-CONTEXT mutation 4) | `expected [ …(2) ] to have a length of 1 but got 2` — the container was started after the refusal was skipped | *refuses an image whose digests…* and *inspects the image the operator named…* |
| 3 | `main` stops forwarding `--docker` | `expected '…' to contain 'docker.io/library/busybox@sha256:1111…'`; and `expected [] to have a length of 1 but got +0` — the stub was never invoked at all | all three stub-driven subprocess cases |
| 4 | `main` stops forwarding `--image` | `expected 'image inspect ghcr.io/yomaytk/elfconv…' to contain 'image inspect o2-local/elfconv:borrow…'` | *inspects the image the operator named…* and the `docker tag` case |
| 5 | drop the `index++` step-over in `parseAotArgs` | `expected { ok: false, …(1) } to deeply equal { ok: true, input: './hello', …(1) }` | *takes the argument after a value-flag as its value…* |
| 6 | `image,` instead of the conditional spread (present-and-`undefined`) | `expected true to be false` | *carries neither an image nor a docker…* |

Mutations 5 and 6 are the ones worth reading twice. **Both were planted because an
assertion looked like it might not be able to fail**, and both found that the obvious
assertion could not:

- The `toEqual` in *carries neither an image nor a docker* passes under mutation 6, because
  `toEqual` ignores a property whose value is `undefined`. The two `Object.hasOwn` lines
  under it are what carries that claim — without them the case is decorative.
- Nothing asserted the step-over at all until mutation 5 was considered; the behaviour was
  described in a code comment, and *a comment is not a specification*. The case was added
  first, then the mutation planted against it.

These are recorded here rather than in `packages/node/src/mutation-ledger.ts`, matching
21-01: that file is not this plan's, and adding entries to it is a separate decision about
what `npm run test:mutations` re-proves on demand.

## Deviations from plan

### 1. [Rule 1 — the plan's exit-code claim for a stub lift is measured false]

Task 3 says: *"the process exits 2 … `cli.ts:36-38` records that a glibc-static input
always lands on `reservations`, **and the stub artifact's probe does not run either, so
`2` is the correct code for a stub lift as well**"*.

**Measured before writing the assertion.** A default `stubLift()` writes
`undecoded-callsites=0` *and* an empty `undecoded.txt`, so `readUndecoded` returns
`{kind:'measured', callSites:0, addresses:[]}` — a probe that **ran and found nothing** —
`verdictOf` returns `clean`, and the CLI exits **0**:

```
VERDICT: clean
UNDECODED: {"kind":"measured","callSites":0,"addresses":[]}
aarch64-wasi32 · 40 bytes · 0.0s · CLEAN
```

The plan's *conclusion* (assert 2, never 0) is right and is honoured; its *reason* is not.
The emission case therefore **arranges** the reservation it asserts —
`meta: { 'undecoded-callsites': '3' }` with the stub's empty address file, which is the
`counted-only` probe and a genuine reservation — and says so in its own comment. That is
the only reservations state reachable through this harness, because `stubLift` always
writes an empty `undecoded.txt` and prints nothing a scanner could turn into a finding.

**Known limit this leaves:** no case asserts `status === 0`, so the `clean → 0` arm of
`cli.ts`'s exit mapping stays unmeasured from the CLI. It is not left implied — an
implementation that returned 2 unconditionally is caught by the three cases here that
require 1, but one that returned 2 for a `clean` lift is not caught by anything. The plan
forbids asserting 0 on a happy path and that instruction was followed rather than
overridden.

### 2. [Rule 1 — "a real re-tag is refused" is measured FALSE on this host]

This is the substantive finding of the plan.

Task 3, 21-CONTEXT.md decision 6 and the roadmap criterion all assume that
`docker tag A B` leaves `B`'s `RepoDigests` naming only `A`'s repository, so
`resolveImage`'s repository match fails and `image-digest-foreign` fires. The case was
written that way and **failed on the first run**, with the driver's own progress line in
the output:

```
  image o2-local/elfconv@sha256:22a404f31c9f7bb5c49e3193081d4876718253d86747aae3d30fcfd971f19c05
  lifting — expect a minute or two
elfconv exited 134: what():  [ERROR] Failed to get program headers.
```

Measured directly, by hand, on Docker Server **29.4.0**:

```
$ docker tag ghcr.io/yomaytk/elfconv:arm64 o2-local/elfconv:borrowed
$ docker image inspect o2-local/elfconv:borrowed --format '{{json .RepoDigests}}'
["o2-local/elfconv@sha256:22a404f3…","ghcr.io/yomaytk/elfconv@sha256:22a404f3…"]
```

**The containerd image store gives the borrowed repository an entry of its own**, carrying
the same manifest digest. The repository match therefore *succeeds*, the driver proceeds,
and the toolchain identity recorded in the key is `o2-local/elfconv@sha256:22a404f3…` — the
borrowed name. That is the classic dockerd image store's behaviour changing underneath a
criterion written against it.

**So AOT-02's "re-tagging a local image under a different name and pointing the CLI at it
is refused rather than hashed under the borrowed name" is, by the `docker tag` route,
measured and NOT MET on this host.** Two things keep that honest rather than alarming:

- The harm is the milder half. The digest is truthful, so no *unknown toolchain* runs
  under a trusted name — the failure `lift.ts:268-291` documents does not occur. What is
  recorded is a *local* name no other host can resolve, which makes the key unportable
  rather than wrong.
- The refusal itself is not in doubt and is proved through the program, one case above,
  against a digest list that really does name only other repositories.

The case now measures the *reason* — both halves of the digest list, and the driver's own
adoption of the borrowed name on stderr — with its own text saying that if it ever fails,
that is the good news and the refusal assertions the plan expected should replace it. **It
reads the exit code nowhere**: on that path 1 means the refusal and the container's abort
alike, and an exit code that cannot tell two outcomes apart is the thing this driver exists
to stop trusting.

### 3. [Rule 3 — the plan's own `<action>` contradicts itself about `translationKeyOf`]

Task 3 says to import `translationKeyOf` from `./lift.ts`, and in the same bullet says to
*"build the same `TranslationKey` the pipeline would from the stub's `meta.txt` values, the
stub artifact's feature set, the stub ELF's sha-256 and `LIFT_TARGET`"*. Only the second is
possible and only the second is a measurement: `translationKeyOf` takes a whole
`Omit<LiftedArtifact, 'translation'>`, which this spec has no way to build and no reason
to, and using the pipeline's own extractor on both sides of the comparison would make the
assertion a tautology. The key is built as a literal from values this file handed over.

`stubs.ts`'s `DEFAULT_META` is module-private, so the five versions are **passed in**
rather than imported — a test that recomputed an expected CID from a constant it could not
see would be asserting that two copies of one value agree.

### 4. [Rule 2 — `describeKey` deliberately not called]

Recorded above under Task 1. `requirements-ledger.node.test.ts` reads every non-test `.ts`
under `packages/` and `tools/` as production and holds AOT-02's row to *"`describeKey` has
no production caller"*. Giving it one is a two-file change, and the second file is
`.planning/REQUIREMENTS.md`.

> **REVERSED 2026-08-04 by `ddca460`.** Both files were changed together, which is exactly
> the two-file change this deviation said it was declining. See the note under Task 1 and
> `## Correction 2026-08-05`.

### 5. [Rule 3 — the commit sequence was compressed by another agent's tree]

The RED/GREEN split was **observed** for every task and the failing text recorded above,
but the pre-commit guard refused every commit in this checkout for roughly forty minutes —
first `requirements-ledger.node.test.ts` (another agent's `fabric-node.ts` had begun
supplying `serveAgent`'s `ledger` hook while BROW-02's row still said it did not), then
`mutation-guard.node.test.ts` (M36 and M45's `find` text no longer matching another
agent's `packages/core/src/job/submit.ts`). Neither failure is about anything this plan
touched. `O2_SKIP_GUARDS=1` was **not** used.

The RED commit was therefore made after the fact by committing **only the two spec files**,
which reproduces a genuinely red tree — new assertions against unchanged sources. As in
21-01, **that commit does not typecheck**: `cli.node.test.ts` names `missing-flag-value`
and reads `args.image`, neither of which exists in the `cli.ts` of that commit. A
`git bisect` through it will not build; the window to the GREEN commit is seconds.

### 6. [Rule 1 — the plan's line numbers are stale, as 21-01 also found]

`describeLift` is at `:1267`, not `:838`; `LiftOptions` at `:534`, not `:316`; `main`'s
`liftElf` call at `:144`, not `:139`; the five rename sites at `cli.ts:77/:94/:118` and
`cli.node.test.ts:91/:110`, not `:72/:89/:113` and `:82/:101`. Everything was located by
content. The plan's *counts* were right every time; only its offsets were wrong.

## Known limits, stated rather than implied

- **The real-re-tag half of AOT-02 is measured and not met on this host** — deviation 2. It
  is not unmeasured, and it is not met; those are different states and this is the second.
- **`clean → 0` is unmeasured from the CLI** — deviation 1.
- **The refusal covers blank and only blank.** Carried forward from 21-01 untouched: a
  `meta.txt` reading `wasi-sdk=unknown` is still hashed into the key, and that limit still
  has its own passing case in `lift.node.test.ts` whose title says it is the limit of the
  refusal. Nothing here widened it — the five versions this plan hands the stub are
  deliberately plausible and none of them is the literal `unknown`.
- **The emitted CID has still never been compared across two genuinely different inputs end
  to end.** That is Plan 21-04's, and this plan did not touch it.
- **`cleanupStubs()` is called from two specs' `afterAll` now.** `stubs.ts` documents that
  removing a directory twice is a no-op, which is what makes that safe; it is not
  re-asserted here.
- **The `docker rmi` in this file removes a tag, not six gigabytes** — asserted, not
  assumed: the `afterAll` inspects `ghcr.io/yomaytk/elfconv:arm64` afterwards and requires
  it to still resolve. Verified by hand after the run as well:
  `o2-local/elfconv:borrowed` → `No such image`, `ghcr.io/yomaytk/elfconv:arm64` →
  `sha256:22a404f3…`.

## Self-Check: PASSED

- `tools/aot/lift.ts` — FOUND (1325 lines), CID lines at `:1286-1287`
- `tools/aot/lift.node.test.ts` — FOUND (2604 lines), 114 cases
- `tools/aot/cli.ts` — FOUND (345 lines), `VALUE_FLAGS` and `missing-flag-value` present
- `tools/aot/cli.node.test.ts` — FOUND (703 lines, plan asked for ≥200), 32 cases
- `grep -rn "missing-out-value" tools/aot/` — no output, exit 1
- `npx tsc --noEmit` — 0 errors in these four files
- `npx vitest run --project node tools/aot` — **154 passed, exit 0**, read directly from `$?`

## Correction 2026-08-05 — one decision this file records was reversed inside the phase window

**Original wording, retained verbatim in place** (Task 1, and deviation 4):

> **`describeKey` is not called, and that is a decision rather than an omission.**

**Measured false as a description of the tree**, though it was true when written and the
reasoning behind it was sound. Commit `ddca460` — `fix(aot): show the input digest, and
record the borrowed name as measured`, 2026-08-04, closing defect #41 — added
`lines.push(\`  key as hashed: ${'${describeKey(artifact.translation.key)}'}\`)` to
`describeLift` in `tools/aot/lift.ts` **and** corrected AOT-02's row in
`.planning/REQUIREMENTS.md` in the same commit. That is the two-file change deviation 4
declined to make, made two days later for a different reason.

Re-verified 2026-08-05 by reading the tree, not the report:
`grep -rn "describeKey" --include="*.ts"` returns `tools/aot/lift.ts` (the call, plus a
comment naming this summary) and `packages/aot/src/index.ts` (the re-export); the rest are
tests. `requirements-ledger.node.test.ts` is green, so nothing in the tree is inconsistent
— only this document was.

`21-VERIFICATION.md` records the same thing as its row 4. Retained for the reasoning, not
the verdict.

---
*Corrected: 2026-08-05*
