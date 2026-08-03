---
phase: phase-19-quorum-composition-owner-domain-attestation
plan: 14
subsystem: verification
tags: [attestation, ver-08, ver-09, ver-10, verification, agreeing, receipt, projection]

requires:
  - phase: phase-19
    provides: "19-13's `ResultAttestation`, its `'signed-by-nobody'` sentinel, and `ExecutionOutcome`'s ok arm carrying one — which `runOne` already put on its internal `Receipt`"
  - phase: phase-17
    provides: "`NodeCertificate` and `verifyCertificate`, which an entry's attestation is checked against"
provides:
  - "`AgreeingReplica` — `{ nodeId, attestation }`, exported from `job/verify.ts` and the core barrel"
  - "`VerificationResult`'s `agreed` arm carrying `agreeing: readonly AgreeingReplica[]`, produced in one expression from one array"
  - "the single place a downstream reader can take an agreeing set from, with no flattening helper beside it"
affects:
  - "19-06 — builds the receipt from this field; there is no names-only path left to build it from"
  - "19-15 — composes `attestResults`, at which point these entries stop reporting the sentinel"
  - "19-10 / 19-11 — the display half, which still reads node ids and is unchanged by this plan"

tech-stack:
  added: []
  patterns:
    - "One field carrying both halves, never a sibling array: a positional correspondence between names and signatures is a second source of truth that drifts silently, and it leaves a downstream reader a CHOICE the leg exists to remove"
    - "`tsc --noEmit` enumerates constructions and assignability, not value comparisons — 4 of 34 read sites, the second consecutive plan to record this"
    - "A projection at the call site rather than a helper returning the old shape: a convenience that hands back `readonly string[]` is a convenience a receipt gets built from"

key-files:
  created: []
  modified:
    - packages/core/src/job/verify.ts
    - packages/core/src/job/verify.test.ts
    - packages/core/src/job/submit.test.ts
    - packages/core/src/index.ts
    - packages/core/src/result-attestation.ts
    - packages/core/src/executor/attesting-executor.ts
    - packages/net/src/distributed.test.ts
    - packages/net/src/reduce-job.test.ts
    - packages/node/src/signed-artifact.node.test.ts
    - packages/node/src/egress-refusal.node.test.ts
    - packages/node/src/discovery-agents.node.test.ts
    - packages/node/src/sovereignty-placement.node.test.ts
    - packages/node/src/relaying.node.test.ts
    - packages/node/src/fabric-node.node.test.ts
    - packages/node/src/two-process.node.test.ts
    - packages/browser/demo/main.ts

key-decisions:
  - "The plan's file list is short by two. `fabric-node.node.test.ts` and `two-process.node.test.ts` each read `verification.agreeing` twice and are named nowhere in the plan. Both were found by grep after `tsc` did not report them — they are `toEqual` comparisons, which compile clean."
  - "The plan's instruction *'Let the compiler enumerate them — `npx tsc --noEmit`, never a grep'* is false, and this is the SECOND consecutive plan to measure it false. `tsc` reported 4 sites of 34. 19-13 recorded the same correction one wave ago and the instruction was repeated anyway."
  - "The plan's third proof predicted its own mutation would not redden. It does redden — because the plan also told me to assert the absence directly, and having done so, adding attestations to `partitions` fails on the key set. Both readings were taken: no PRE-EXISTING assertion catches it, which is what the prediction was actually about."
  - "No requirement is marked complete. VER-08/09/10 remain *Built, not wired* — `attestationReceipt` is still called only by itself and its spec, so the ledger row's stated reason is untouched and no ledger edit was needed."
  - "`submit.test.ts:921` — `expect(a.agreeing).toStrictEqual(b.agreeing)` — was left comparing whole entries rather than projected. It now also asserts the two placement arms agree on the attestations, which is strictly more than it asserted before and is true; weakening it to a projection would have been the only way to make it assert less."
  - "Two module docblocks stated in the present tense that `agreeing` is node-id strings. This plan makes both false, so both were corrected in the same commit rather than left for a reader to trip over."

requirements-completed: []
duration: one session
completed: 2026-08-03
---

# Phase 19 · Plan 14 — The agreeing set says who signed, and the compiler still cannot find its readers

`VerificationResult`'s `agreed` arm carried `agreeing: readonly string[]` — node ids the
requestor chose, held every executor for, and minted the whole record of. A receipt over
that is the submitter's word about itself. Each entry is now an `AgreeingReplica`: the
node id, and the `ResultAttestation` that replica signed, or its named statement that it
signs nothing.

No behaviour of a running fabric moved. Nothing composes the signing wrapper until 19-15,
so every real replica still reports the sentinel; what changed is the shape that reaches a
reader.

## What changed

| file | what |
|---|---|
| `packages/core/src/job/verify.ts` | `AgreeingReplica` added and exported; the `agreed` arm carries it; the producing expression maps one array; the `disagreed` arm gains a docblock saying why it does **not** |
| `packages/core/src/index.ts` | barrel re-export of the new type |
| `packages/core/src/job/verify.test.ts` | three new cases; five existing readings projected |
| `packages/core/src/job/submit.test.ts` | 12 readings projected |
| `packages/net/src/distributed.test.ts` | 1 |
| `packages/net/src/reduce-job.test.ts` | the one site that **builds** the field rather than reading it; takes the sentinel |
| 7 × `packages/node/src/*.node.test.ts` | 17 readings projected across the five the plan names plus the two it omits |
| `packages/browser/demo/main.ts` | two expressions map to `nodeId`; `tab-api.ts` deliberately untouched |
| `result-attestation.ts`, `attesting-executor.ts` | two docblocks this plan makes false, corrected |

**The fan-out was 34 read sites across 12 files**, plus the declaration and the producer
in `verify.ts` itself — against the plan's *"about 30 read sites across 11 files, measured
2026-08-02"*. The site count is close. The **file** count is short by two, and both
omissions are cross-process specs, which is the population the plan called *"the readings
that would notice if a projection changed a meaning"*:

| omitted file | sites |
|---|---|
| `packages/node/src/fabric-node.node.test.ts` | `:172`, `:218` |
| `packages/node/src/two-process.node.test.ts` | `:215`, `:290` |

Counting the barrel and the two corrected docblocks, **16 files were edited**.

## `tsc` found 4 of 34, and this is the second consecutive plan to record it

The plan's action step says outright: *"Let the compiler enumerate them —
`npx tsc --noEmit`, never a grep."*

With the type changed and nothing else, `tsc --noEmit` reported **four** errors:
`demo/main.ts` twice (assignability against `TabJobReport` / `TabColouringRun`),
`reduce-job.test.ts:127` (a construction), and `discovery-agents.node.test.ts:431` (a
`Set<string>.has` argument). Every other site is `expect(x.agreeing).toEqual([...])`,
whose parameter is `any` — thirty of them, invisible to the compiler and red only at
runtime.

19-13's summary already records this exact correction: *"`tsc` enumerates constructions
but not value comparisons"*. The instruction was carried into this plan unchanged. A grep
found the remaining thirty in one command, including the two files the plan does not name.

## Mutation readings actually observed

Every one planted by hand, restored with `cp` + `cmp` (**exit 0** each time), and re-run
green afterwards.

| # | mutation | file | reading |
|---|---|---|---|
| M-A | `attestation: r.attestation` → `attestation: 'signed-by-nobody' as const` in `executeVerified`'s mapping | `job/verify.ts` | **RED** — 1 failed file, **2 failed / 18 passed**. `expected false to be true` (the attestation no longer verifies) and `expected 'signed-by-nobody' not to be 'signed-by-nobody'`. **Every node-id assertion in the file still passed** — the reading the plan asked for, and it shows the ids were never the evidence |
| M-B | build the attestations from a **separately reverse-sorted** copy of `answered` | `job/verify.ts` | **RED** — **1 failed / 19 passed**, *gives every entry the attestation of the node that entry names*. Failure text `expected 'ed4928c6…' to be '8a88e3dd…'`: node `a`'s entry carrying node `c`'s certificate key. **This is the plant that justifies one field instead of two** |
| M-C | add `attestations` to each entry of `partitions` on the `disagreed` arm | `job/verify.ts` | **RED** — **1 failed / 19 passed**, *puts no signature on a disagreement*. `expected [ Array(3) ] to deeply equal [ 'nodes', 'resultCid' ]`. The plan predicted GREEN; see below |
| M-D | demo maps to `replica.attestation` instead of `replica.nodeId` | `browser/demo/main.ts` | **RED at compile time** — `tsc --noEmit` **exit 1**: `Type 'AttestedResult[][]' is not assignable to type 'readonly string[][]'`. `tab-api.ts`'s declared type caught it, exactly as the plan predicted, and no test had to run |

### M-B's find/replace pair, recorded for Plan 19-12

```
file:   packages/core/src/job/verify.ts
find:       agreeing: answered.map((r) => ({ nodeId: r.nodeId, attestation: r.attestation })),
replace:    agreeing: (() => {
              const signatures = [...answered].sort((x, y) => y.nodeId.localeCompare(x.nodeId))
              return answered.map((r, i) => ({ nodeId: r.nodeId, attestation: signatures[i]!.attestation }))
            })(),
caughtBy:   packages/core/src/job/verify.test.ts
signature:  gives every entry the attestation of the node that entry names
source:     test-title
```

The `find` text is present exactly once. The signature is a real `it` title in the
catching file, so it belongs in the checked arm rather than `rendered-at-runtime`.

## The plan's third proof, and the sense in which it was right

The plan says of the disagreement case: *"Reddened by adding them to `partitions`: nothing
fails, which is the point — so assert the absence directly rather than relying on a
failure."*

Taken literally as a prediction about M-C, it is **wrong**: the mutation reddens, hard.
Taken as the argument it is making — that no assertion which *already existed* would have
caught it — it is **right**, and that was measured too. With M-C planted, all nineteen
other cases in `verify.test.ts` passed, including both pre-existing disagreement cases
(`reports a two-against-one split…`, `reports three different answers as three
partitions…`) and the failure-alongside-the-split case. The absence is only falsifiable
because the plan told me to assert it directly, and having done so, it is falsifiable.

That is worth stating precisely rather than filed as a proof that could not fail: it is
the opposite case. The plan named an unfalsifiable proof **in advance** and specified the
fix in the same sentence.

## Every existing reading is preserved, and one is deliberately not projected

All 34 sites read the same node ids, in the same order, through `.map((e) => e.nodeId)` or
a destructure. **No assertion's meaning changed**, with one exception, stated because the
plan asked for it:

`submit.test.ts:921` — `expect(a.agreeing).toStrictEqual(b.agreeing)`, comparing the plan
arm and the offer arm of `submitJob` — was left comparing **whole entries**. It now also
asserts the two arms agree on the attestations. That is strictly more than it asserted
before and it is true; projecting it would have been the only way to make it assert less.
Its neighbour on line 922 is projected, because it compares against a literal id.

`discovery-agents.node.test.ts:579-586` carries a recorded correction about an assertion
that *"used to sit here"*. It was not disturbed and its wording did not become inaccurate:
the reading it quotes is `.toHaveLength(1)`, which is about the array's length and is as
true of the new shape as of the old. `mutation-ledger.ts`'s `M36` restates the same
sentence and was likewise left alone; its own `find` text is in `submit.ts` and is
untouched.

## Commands run, with real exit codes

`EXIT=$?` on the line immediately after each command, never through a pipe.

| command | exit |
|---|---|
| `npx vitest run --project node packages/core/src/job/verify.test.ts` (RED, before the type change) | **1** — 2 failed / 18 passed |
| `npx tsc --noEmit` (type changed, readers not yet) | **1** — 4 errors, listed above |
| `npx tsc --noEmit` (after Task 1) | **1** — 3 errors, all in Task 2's files |
| `npx tsc --noEmit` (final) | **0** |
| `npx vitest run --project node verify.test.ts submit.test.ts distributed.test.ts reduce-job.test.ts` | **0** — 4 files, 93 tests |
| `npx vitest run --project node signed-artifact egress-refusal discovery-agents sovereignty-placement relaying` (`.node.test.ts`) | **0** — 5 files, 24 tests |
| `npx vitest run --project node fabric-node.node.test.ts two-process.node.test.ts` | **0** — 2 files, 16 tests |
| `npx vitest run --project node attesting-executor.test.ts result-attestation.test.ts` | **0** — 2 files, 24 tests |
| `npx vitest run --project node sovereign-execution.test.ts coordinator.test.ts packages/core/src/job` | **0** — 4 files, 92 tests |
| `cp` + `cmp` restore, ×5 | **0** each |

The six cheap guards — vocabulary, purity, mutation-ledger, disclosure,
requirements-ledger, slow-specs — ran through the pre-commit hook on **each of the three
commits** and passed each time (156 tests).

**No timing was recorded and no timeout was added or tuned.** Nothing failed in a
timeout-shaped way, so no re-run was needed and **nothing is unresolved under load**.

## What was not run, and why

- **The full `--project node` and `--project browser` runs.** The host was carrying a
  foreign C++ build at load ~14 on 8 cores with a second executor in the same tree, and
  the instruction was to run only the files this plan names, project-scoped. Everything
  the plan lists as load-bearing was run, plus the two files it omitted and the four
  nearest unit-level neighbours. `tsc --noEmit` at exit 0 covers assignability everywhere
  else; the residual risk is a `toEqual` on `agreeing` in an unrun file, and the grep that
  produced the 34-site tally found none.
- **The two e2e readings of the demo's `agreeing`** — `two-tabs.e2e.test.ts:274` and
  `colouring-demo.e2e.test.ts:160-162`. Both read `TabJobReport` / `TabColouringRun`,
  whose declared type is unchanged, and both are Playwright specs the plan does not name.
  The page-is-unchanged claim therefore rests on two readings rather than three: the
  projection is `.map` over the same array in the same order, and the compile-time refusal
  recorded as M-D. **Stated rather than implied: this is an argument plus a type check,
  not an end-to-end reading.**

## What the plan got wrong

1. **Its file list is short by two.** `fabric-node.node.test.ts` and
   `two-process.node.test.ts` read the field four times between them and appear nowhere in
   the plan — not in `files_modified`, not in either task's `<files>`.
2. **`tsc` does not enumerate the readers.** 4 of 34. This correction is one wave old and
   was repeated anyway; it is now recorded twice.
3. **Task 1's `<verify>` block cannot pass as written.** It runs a repository-wide
   `npx tsc --noEmit` and expects exit 0, while Task 2's six files are still unconverted at
   that point. Exit 1 there is the correct reading, not a failure. Only Task 2's identical
   block can reach 0.
4. **The third proof's prediction is inverted** — though its instruction is right. See
   above; both readings were taken.
5. **VER-08/09/10 are in the plan's `requirements` frontmatter and are not closed by it.**
   The plan's own prose says so — *"VER-08/09/10's **input**"* — but the frontmatter would
   have an executor following the standard flow check three boxes. Nothing was marked; the
   ledger rows still read *Built, not wired* and their stated reason is still true, since
   `attestationReceipt` remains called only by itself and its spec.

## What is still not true, stated rather than left to be discovered

- **Every entry reports `'signed-by-nobody'` in every running configuration.** 19-15
  composes `attestResults` at `fabric-node.ts` and `browser-node.ts`; until then the only
  signed entries in this repository are the ones `verify.test.ts` composes for itself.
- **No receipt is built.** 19-06 consumes this field. The point of the shape is that when
  it does, there is no names-only array beside the signatures for it to be built from
  instead — and no helper that hands one back.
- **The `disagreed` and `insufficient` arms carry no attestation and must not grow one.**
  Signatures on a disagreement would invite choosing the better-attested side, which is
  the majority vote `verify.ts`'s header refuses to take in different clothes. M-C is the
  reading that holds it.

## No blockchain

Nothing global was added. The attestation an entry carries is self-contained — the
provider-signed certificate plus a signature — and is checked offline against trust
anchors the verifier passes in. Nothing is fetched, no list is consulted, and revocation
remains non-renewal on the certificate's own clock.

## Commits

| hash | subject |
|---|---|
| `157dbc2` | `test(19-14): an agreement should say what each replica signed, and cannot yet` |
| `03f0293` | `feat(19-14): an agreed shard says what each replica signed, not just who answered` |
| `f1b98a4` | `feat(19-14): every cross-process reading takes its node ids from a field` |

One commit by the other executor (`cf50647`, retracting 19-02's anchor rule) landed
between the first and second. The branch was left clean, no branch was created or
switched, every `git add` named explicit paths, and `git status --porcelain` was read
before each commit and showed only this plan's files.
