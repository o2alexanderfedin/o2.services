---
phase: phase-19-quorum-composition-owner-domain-attestation
plan: 18
subsystem: verification
tags: [ver-03, ver-04, jobspec, strictness, degrade, fan-out, wire-01]

requires:
  - phase: phase-19
    provides: "the owner ruling recorded in 19-CONTEXT.md under *The quorum is the default and it is OPTIONAL* — degrade by default, refusal only when the caller asked for it"
  - phase: phase-12
    provides: "the retirement of `not-enough-executors` in favour of marking a shard `degraded` rather than failing a job, which is the precedent the degrade arm restates"
provides:
  - "`JobSpec.onQuorumShortfall` — a required union of `'runs-at-available-redundancy' | 'refuses-the-shard'`, with no third arm and no `undefined`"
  - "ninety-four `JobSpec` literals across twenty-nine files, each now stating its choice"
  - "four production submitters stating theirs with the reason written beside it"
  - "a compile-time refusal that is itself checked — `@ts-expect-error` in `submit.test.ts`, which becomes an error the moment the field is widened back to optional"
affects:
  - "19-06 — reads the field; until then both arms travel the submission path identically"
  - "19-08 — the across-process strictness cases"
  - "19-10 / 19-11 — the CLI and demo readings, both of which now sit on a driver that degrades deliberately"

tech-stack:
  added: []
  patterns:
    - "A required union with named arms, never an optional with a default — `AgentOptions`' eight hooks are the house pattern and this is the ninth instance"
    - "The dial lives on `JobSpec` and not `SubmitOptions`: an optional-as-a-whole options object cannot host a required field, because omitting the object omits the field"
    - "`tsc` is a complete oracle in BOTH directions for a required-property fan-out — a missing property is TS2741 and a misplaced one is TS2353 — which is what made a position-driven insertion safe where a pattern sweep would not have been"

key-files:
  created: []
  modified:
    - packages/core/src/job/submit.ts
    - packages/core/src/job/submit.test.ts
    - packages/core/src/coordinator.ts
    - packages/core/src/executor/task-worker.ts
    - packages/core/src/executor/wasm.test.ts
    - packages/net/src/submit-with-egress.test.ts
    - packages/net/src/distributed.test.ts
    - packages/net/src/discover-candidates.test.ts
    - packages/net/src/reduce-job.test.ts
    - packages/net/src/sovereign-execution.test.ts
    - packages/browser/demo/main.ts
    - packages/browser/src/visibility-governor.test.ts
    - packages/bench/src/perf-workload.ts
    - packages/demo/src/kernel.test.ts
    - packages/aot/src/admission.test.ts
    - packages/aot/src/wasi-executor.test.ts
    - packages/node/src/bin/bench.ts
    - packages/node/src/discovery-agents.node.test.ts
    - packages/node/src/egress-manifest.node.test.ts
    - packages/node/src/egress-refusal.node.test.ts
    - packages/node/src/fabric-node.node.test.ts
    - packages/node/src/named-refusal.node.test.ts
    - packages/node/src/pi-reduce.node.test.ts
    - packages/node/src/primes-reduce.node.test.ts
    - packages/node/src/relaying.node.test.ts
    - packages/node/src/signed-artifact.node.test.ts
    - packages/node/src/sovereign-at-rest.node.test.ts
    - packages/node/src/sovereign-block-refusal.node.test.ts
    - packages/node/src/sovereignty-placement.node.test.ts
    - packages/node/src/tree-reduce-agents.node.test.ts
    - packages/node/src/two-process.node.test.ts

key-decisions:
  - "`coordinator.ts` is listed above because the plan listed it, and it received NO edit. Its `shards` is `readonly ShardOutcome[]` — a result reader with its own type, unrelated to `JobSpec`. Seven of the plan's thirty-eight listed files are of this kind."
  - "The plan's `shards:` measurement — 37 files, 120 occurrences — reproduced EXACTLY, but only when `packages/browser/dist/` is excluded. Including the committed bundle gives 39 files and 122 occurrences. The two extra hits are build artifacts."
  - "The plan's call-site count is short by one. A grep for `submitJob(`/`submitJobWithEgress(` names 32 files, not 31; the extra is `bench-egress.node.test.ts`, which is absent from `files_modified`. It correctly needs no edit — it names both symbols only inside string literals and regexes, being a source-shape guard over `bin/bench.ts`."
  - "For THIS change the grep found no reader site `tsc` missed, and that is a reasoned finding rather than a skipped check: `onQuorumShortfall` is brand new, so no reader of its value can pre-exist. The reader class that could have bitten is a whole-`JobSpec` comparison — `toEqual(spec)`, `JSON.stringify(spec)`, `Object.keys(spec)`, a snapshot — and a grep for all four returns nothing anywhere in `packages/`."
  - "Task 2's second predicted proof CANNOT FAIL at this wave, and was measured rather than recorded green. The plan says taking the strict arm in the demo reddens because 'a two-tab fabric refuses every shard and the demo shows nothing'. Planted, `colouring-demo.e2e.test.ts` stayed 6/6 green — because nothing reads the field until 19-06. The mutation becomes meaningful only after 19-06 lands."
  - "No requirement is marked complete. VER-03 and VER-04 still read *Built, not wired — composeQuorum has no caller outside its own spec*, and this plan added no caller to `composeQuorum`, so the rows' stated reason is untouched and no ledger edit was needed. The verdict is 19-12's."
  - "Helper-fronting is essentially absent and the number is worth recording for future estimates: of 29 constructor files, ONE contains a helper returning `JobSpec` (`submit-with-egress.test.ts`'s `specFor`, fronting 2 sites). 94 literals cover 96 submission sites."

requirements-completed: []
duration: one session
completed: 2026-08-03
---

# Phase 19 Plan 18: Every submitter says what it wants when verification is not available Summary

`JobSpec` gained `onQuorumShortfall`, a required two-armed strictness dial that nothing reads
until Plan 19-06, and ninety-four spec literals across twenty-nine files now state their choice.

## What changed

**`packages/core/src/job/submit.ts`** — one required property and its doc. No branch, no read, no
change to `ShardResult.degraded`. The diff in that file is a type and a comment, as the plan
asked:

```ts
readonly onQuorumShortfall: 'runs-at-available-redundancy' | 'refuses-the-shard'
```

The doc carries the four things the plan required — what degrading does, why it is the default
answer to an uncomposable quorum, why it is not silent, and when to ask for refusal — plus the
scheduled arrival (19-06) and the recorded reason the field is required rather than optional.

**`packages/core/src/job/submit.test.ts`** — thirty-one literals updated, and a new block
carrying the compile-time refusal. The omission case uses `@ts-expect-error`, the same instrument
`agent-contract.test.ts` uses on `AgentOptions`' required hooks, so that widening the field back
to optional turns the suppression into an "Unused '@ts-expect-error' directive" error.

**Twenty-eight further files** — one property each. Every fixture takes the degrade arm. No
fixture grew, no assertion moved, no spec acquired a strictness case.

**Four production submitters carry a reason at the call site**, not a bare value:

| site | arm | reason written there |
|---|---|---|
| `node/src/bin/bench.ts:775` | degrade | a measurement driver that refuses work measures nothing; a degraded reading is still a reading, and this matters most on the `--discover` arm where 19-10 takes criterion 3's readings |
| `bench/src/perf-workload.ts:350` | degrade | the same reason on the workload it drives |
| `browser/demo/main.ts:471` | degrade | a tab fabric is routinely one operator behind one relay — refusing would fail the demo on exactly the topology it exists to show, and rendering the weaker strength is the demo being honest rather than broken |
| `browser/demo/main.ts:712` | degrade | the same choice, cross-referenced to `runColouring` above |

## The fan-out, measured against the plan's 31 / 37

The plan asked for the worklist to be built twice and reconciled. It was.

| instrument | count | what it names |
|---|---|---|
| `tsc --noEmit` | **29 files, 94 sites** | every site that CONSTRUCTS a `JobSpec` |
| grep `submitJob(` / `submitJobWithEgress(` | **32 files** | constructors + the declaring file + the forwarding wrapper + one source-shape guard |
| grep `shards:` (source) | **37 files, 120 occurrences** | the superset — constructors, shard *counts*, and result readers |
| grep `shards:` (incl. `dist/`) | 39 files, 122 occurrences | the two extra hits are committed browser bundles |

**The plan's 37 / 120 reproduced exactly.** Its "31 call-site files" is short by one.

The 37 `shards:` source files split cleanly into two populations:

- **29 are `JobSpec` constructors** — all edited. `tsc` named every one of them, and `tsc`'s list
  is a strict subset of the grep's.
- **8 are not**, and none needed an edit:
  - `submit.ts` — the declaring file; its `shards:` is the interface declaration.
  - `coordinator.ts` — `readonly shards: readonly ShardOutcome[]`, a result reader with its own
    type.
  - `bench/harness.ts`, `harness.test.ts`, `perf-baseline.ts`, `browser/tab-api.ts`,
    `two-tabs.e2e.test.ts`, `background-tab.e2e.test.ts` — all `shards: <number>`, a shard
    **count** on a benchmark or tab-config object. The identifier collides; the type does not.

### Listed but not edited — eight of the plan's thirty-eight

`files_modified` lists **38** entries while the plan's prose says 37. Eight received no edit:
the seven above, plus `net/src/submit-with-egress.ts` — which the plan itself already predicted,
since it takes a `JobSpec` and forwards it whole and "needs its own call sites to state one".

`perf-baseline.ts` deserves a specific note, because the plan asserted a choice for it:
*"`perf-workload.ts` and `perf-baseline.ts` degrade"*. `perf-baseline.ts` constructs no `JobSpec`
at all — it names `submitJobWithEgress` once, in a doc comment. There was nothing there to
choose.

### Unlisted but edited — none. Unlisted and found by grep — one.

No file needed an edit that the plan failed to list. The one grep-positive file the plan omits,
`packages/node/src/bench-egress.node.test.ts`, correctly needs no edit: it names `submitJob` and
`submitJobWithEgress` only inside string literals and regular expressions, being a call-site
**shape guard** over `bin/bench.ts`. It is exactly the class of file a grep-driven edit would have
corrupted and `tsc` cannot see — the hazard running in the opposite direction from the one
19-CONTEXT warns about.

### On the reader class 19-CONTEXT warns about

19-13 and 19-14 each measured that `tsc` lists constructors and not readers. **For this change
that class is empty by construction**, and it was checked rather than assumed: `onQuorumShortfall`
is new, so no reader of its value can pre-exist. What could still have bitten is a comparison
against a whole `JobSpec` — `toEqual(spec)`, `toStrictEqual(spec)`, `JSON.stringify(spec)`,
`Object.keys(spec)`, or a snapshot. A grep for all six patterns across `packages/` returns
nothing. The guard was run; it found nothing to report, and that is different from not running it.

## Mutation readings — observed, not asserted

**1. The field made optional — the plan's first proof, and it reddens hard.**

Planted `readonly onQuorumShortfall?:` on `submit.ts`, the exact defect 19-01 and 19-13 each
planted.

| reading | before | with the mutation |
|---|---|---|
| `tsc --noEmit` error lines | 63 | **5** |
| files carrying an error | 28 | **1** |

**Twenty-eight of twenty-nine files went silent** — the fan-out evaporated exactly as the plan
predicted. The two surviving error sites are both in `submit.test.ts` and both are the guard
working:

- `TS2578: Unused '@ts-expect-error' directive` — the compile-time refusal noticing it is no
  longer refusing anything.
- `TS2375` under `exactOptionalPropertyTypes: true` — an **unpredicted second reading**. The
  repository's own tsconfig catches the widening independently, because `JobSpec['onQuorumShortfall']`
  gains `| undefined` and stops being assignable back.

Restored by `cp` + `cmp` (exit 0), and `tsc` output confirmed byte-identical to pre-mutation.

**2. The demo takes the strict arm — the plan's second proof, and it CANNOT FAIL at this wave.**

The plan predicts: *"Reddened by taking the strict arm in the demo: a two-tab fabric refuses every
shard and the demo shows nothing."* Planted `'refuses-the-shard'` at `demo/main.ts:471` and ran
`colouring-demo.e2e.test.ts`, the spec the mutation ledger's `M29` names as that file's catcher.

**Exit 0. Six of six still passing.** The predicted reddening did not occur, and it could not
have: no branch anywhere reads `onQuorumShortfall` until Plan 19-06, which is what this plan set
out to be true. The proof as written is unfalsifiable at wave 3 and becomes meaningful only once
19-06 lands. Reporting it rather than recording a green, per the standing rule that a proof that
cannot fail is a finding.

Restored by `cp` + `cmp` (exit 0); `tsc --noEmit` exit 0 after restore.

## Commands and real exit codes

Every exit code read with `EXIT=$?` on the line immediately after its command, never through a
pipe.

| command | exit |
|---|---|
| `npx tsc --noEmit` (baseline, before any edit) | 0 |
| `npx tsc --noEmit` (RED — assertion present, field absent) | **1** — 8 errors, incl. the TS2578 the plan wanted |
| `npx tsc --noEmit` (field added, before fan-out) | **1** — 94 sites in 29 files |
| `npx tsc --noEmit` (mutation: field optional) | **1** — 5 lines, 1 file |
| `npx tsc --noEmit` (restored) | **1** — byte-identical to pre-mutation |
| `npx tsc --noEmit` (after full fan-out) | **0** |
| `npx vitest run --project node` (batch A, 11 files) | 0 — 277 passed |
| `npx vitest run --project node` (batch B, 10 files) | 0 — 120 passed |
| `npx vitest run --project node` (batch C, 7 files) | 0 — 39 passed |
| `npx vitest run --project browser` (11 files × 3 engines) | 0 — 33 files, 831 passed |
| `npx vitest run --project e2e two-tabs.e2e.test.ts` | 0 — 6 passed |
| `npx vitest run --project e2e background-tab.e2e.test.ts` | 0 — 3 passed |
| `npx vitest run --project e2e colouring-demo.e2e.test.ts` | 0 — 6 passed |
| pre-commit cheap guards (both commits) | 0 — 156 passed each |

Run by project and by file throughout; never the full suite, never a bare path. No timings
recorded, no timeouts added or tuned. No timeout-shaped failure occurred, so nothing is
*unresolved under load*. Host load ran 5.9 → 21.6 across the session, below the ~30 ceiling.

**Why three e2e specs and not the two the plan named.** The plan's verification names
`two-tabs.e2e.test.ts` and `background-tab.e2e.test.ts` — neither of which needed an edit, but
both of which **load `demo/main.ts`**, which did. `colouring-demo.e2e.test.ts` was added because
it drives `runColouring`, the exact site edited, and is what the mutation ledger names as that
file's catcher.

## Deviations from Plan

None requiring a rule. No auto-fix was needed: the tree compiled and every touched spec passed on
the first run after the fan-out. The findings above are measurements against the plan's own
figures, not repairs.

One method note. The fan-out was applied by a script driven off **`tsc`'s own reported
(file, line) positions**, scoped per invocation to a named file list — not by a repository-wide
`sed`, which the plan forbids and which this project has recorded as a shared-tree hazard. The
script locates each literal by its opening brace, walks to the matching close by brace depth, and
anchors on the single `redundancy:` property at that literal's own depth; anything ambiguous is
refused loudly rather than guessed. It did refuse, twice, on one-line literals it had no rule for,
and the file was verified untouched by `cmp` before the rule was added. This is safe precisely
because **`tsc` is a complete oracle in both directions here** — a missing property is TS2741 and
a stray one is TS2353 — so both under- and over-insertion are caught by the same run.

## What the plan got wrong

1. **`files_modified` lists 38 entries while the prose says 37.** Eight of the 38 needed no edit.
2. **"31 call-site files" is 32.** The missing one is `bench-egress.node.test.ts`.
3. **`perf-baseline.ts` was assigned a choice it has no site to make.** It constructs no `JobSpec`.
4. **Task 2's second proof cannot fail at this wave** — measured above.
5. **The three e2e/browser specs the plan told me to run in their own projects needed no edit**
   — but two of them were still the right thing to run, for a reason the plan does not give: they
   load `demo/main.ts`. The instruction was right and its stated justification was not.

None of these changed what was built. Recorded because the next fan-out plan in this phase will
be written against these numbers.

## Self-Check: PASSED

- `packages/core/src/job/submit.ts` — FOUND, carries `onQuorumShortfall` at line 139
- `packages/core/src/job/submit.test.ts` — FOUND, carries the `@ts-expect-error` omission case
- `.planning/phases/phase-19-quorum-composition-owner-domain-attestation/19-18-SUMMARY.md` — FOUND
- commit `6d6c073` — FOUND
- commit `fb10acf` — FOUND
- `npx tsc --noEmit` exit 0 on the committed tree
