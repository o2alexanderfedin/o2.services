---
phase: 45-independence-bounded-by-the-providers-an-attacker-must-subve
plan: 02
subsystem: surfaces/census
tags: [VER-12, attestation, issuer-diversity, census, criterion-5]
requires:
  - "AttestationReceipt.issuers (Phase 44, VER-11)"
  - "AttestationStrength 'single-issuer' and the issuer rule (45-01)"
  - "the four red specs 45-01 handed forward, measured rather than predicted"
provides:
  - "the issuer count on all five surfaces that print a strength"
  - "the F8 region registry, its HTML attribute and the UI-SPEC row moved together"
  - "the end-to-end reading through submitJob, green — 45-01's carried-forward criterion"
  - "bin/bench.ts's real rungs MEASURED below the issuer rule, behind two positive controls"
  - "every absence check in the tree enumerating four strengths, not three"
affects:
  - "packages/node/src/bin/agent.ts and bin/bench.ts — the CLI reading gains a third count"
  - "packages/browser/demo — the page's F8 region and Established-over line gain a provider count"
tech-stack:
  added: []
  patterns:
    - "a positive control whose bytes are lifted from the producer, so it moves when the producer moves"
    - "a second control with three distinct counts, because the producer's own counts cannot distinguish transposed capture groups"
key-files:
  modified:
    - packages/node/src/bin/agent.ts
    - packages/node/src/bin/bench.ts
    - packages/browser/demo/render.ts
    - packages/browser/demo/surfaces/fabric.ts
    - packages/browser/src/demo-regions.ts
    - packages/browser/demo/index.html
    - .planning/phases/phase-27-demo-ui-driven-by-real-fabric/UI-SPEC.md
    - packages/core/src/job/submit.test.ts
    - packages/net/src/reduce-job.test.ts
    - packages/core/src/enrollment.test.ts
    - packages/node/src/quorum-agents.node.test.ts
    - packages/node/src/result-signature.node.test.ts
    - packages/node/src/owner-domain-agents.node.test.ts
    - packages/node/src/bench-attestation.node.test.ts
    - packages/node/src/sovereign-arm.node.test.ts
    - packages/node/src/mutation-guard.node.test.ts
    - packages/node/src/demo-fabric.e2e.test.ts
    - packages/node/src/attestation-ui.e2e.test.ts
    - packages/node/src/owner-domain-tabs.e2e.test.ts
    - packages/node/src/sovereign-agent.e2e.test.ts
decisions:
  - "reduce-job gains a FOURTH arm with a second authority rather than moving its third, so `independent` stays reachable on the reduce path"
  - "the across-process rigs move their labels rather than being handed a second authority — a rig's label describes the rig"
  - "the (c) measurement carries TWO controls: the driver's own bytes cannot distinguish transposed capture groups, because every count on the real rungs is 1 or 2"
  - "M42's ledger signature left untouched again; the stale label is annotated in `mutation-guard`'s prose rather than guessed at in the ledger"
metrics:
  tasks: 2
  commits: 2
  completed: 2026-09-16
---

# Phase 45 Plan 02: The Count Criterion 5 Turns On, and the Census — Summary

Every surface that prints a strength now prints how many certificate authorities stood
behind it, and every spec that was asserting `'independent'` over a one-provider fixture
now asserts what its fixture actually is. **The end-to-end reading 45-01 explicitly did
not claim is met here:** `submit.test.ts` exercises `submitJob` and is green, 105/105.

---

## What each criterion cost

Every reading taken with `EXIT=$?` on the line immediately after the command — no pipe, no
trailing `echo`, no `tail`. Host quiet for all of them (`load/core` 1.05–2.39 against a
ceiling of 4.00, 8 cores).

| Criterion | Instrument | Result |
|---|---|---|
| `npx tsc --noEmit` | direct `EXIT=$?` | **0**, four times across the plan |
| `submit.test.ts` alone | `--project node`, direct | **0** — 105 passed (was `5 failed \| 100 passed`) |
| `reduce-job.test.ts` alone | `--project node`, direct | **0** — 20 passed (was `1 failed \| 19 passed`) |
| `quorum-agents.node.test.ts` alone | `--project node`, direct | **0** — 4 passed, 14.91 s |
| `result-signature.node.test.ts` alone | `--project node`, direct | **0** — 2 passed, 4.54 s |
| `sovereign-agent.e2e.test.ts` alone | `--project e2e`, direct | **0** — 4 passed, 7.62 s |
| core/net lane (4 files) | `--project node`, direct | **0** — 202 passed, 1.44 s |
| spawning node lane (6 files) | `--project node`, direct | **0** — 202 passed, 35.81 s wall |
| e2e lane (5 files) | `--project e2e`, direct | **0** — 50 passed, 113.75 s wall |
| `demo-regions.e2e.test.ts` (Task 1 gate) | `--project e2e`, direct | **0** — 19 passed |

Both long lanes were taken under `/usr/bin/time -p`:

| Lane | real | user | sys | `(user+sys)/real` |
|---|---|---|---|---|
| spawning node lane | 37.16 | 79.89 | 22.25 | **2.75** |
| e2e lane | 114.77 | 152.57 | 22.75 | **1.53** |

Both above 1.0 — these lanes compute and spawn rather than wait, so the figures are
comparable to one another and to the `node`-lane figures recorded in `CLAUDE.md`. Quoted
as a comparability key, not a verdict.

**`bench-attestation.node.test.ts` cost 27.17 s in the lane and 16.14 s real when run
alone**, against a `READINGS_BUDGET_MS` of 420 000 and a `SPAWN_TIMEOUT_MS` of 900 000.
That is a long way below its own historical figures (153 s and 213 s are in its header),
and it is recorded rather than explained — nothing in this plan touched the ladder, and
the sweep-shape case that would have caught a moved ladder is green.

---

## Where the plan disagreed with the tree

Three, all measured, none repaired by widening what counts as passing.

### 1. `demo-fabric.e2e.test.ts`'s F8 counts assertions do not move — there are none to move

Task 2's action says *"the F8 counts assertions do move, because Task 1 added a count to
that region"*. **Measured: the receipt arm of that case asserts F6 and F7 and never reads
`fabric/attestation-counts` at all.** The only F8 assertion in the case is
`toContain('2 replicas agreed')` at `:273`, which is in the **absence** arm — and Task 1
did not touch any absence arm on any surface, because an absence reports
`agreeing`/`verified` and holds no receipt to read issuers from.

This is the same file 45-01 measured green and predicted would stay green, and it did:
exit 0, 18/18, before and after Task 1. What was actually owed here was the new
`single-issuer` passthrough arm, which is written — and since a new arm had to be built
anyway, it **does** assert F8, reading `1 provider` off the fixture's single issuer. So the
region gained a reader it did not have, rather than an existing reader being updated.

### 2. `bench-attestation.node.test.ts` gained a case, so its count moved 5 → 6

Not a disagreement so much as a number worth stating, because the plan's verification
section quotes no expected counts: the file ran **5 tests** before this plan and runs
**6** after, the sixth being the (c) measurement.

### 3. 45-01's two corrections, re-checked and confirmed

Both of 45-01's plan-vs-tree corrections held on this tree and are not re-litigated:
`demo-fabric.e2e.test.ts` was never going to be red (four specs moved in this plan, not
five), and `not.toContain(describeAttestation('independent'))` has **one** surface rather
than five. The wording constraint it imposes still holds.

---

## The handover, measured rather than promised — Task 1's three reds

The plan required Task 1's breakage to be **observed**, not asserted. It was, on commit
`d0d5c0c`, on a quiet host, each with `EXIT=$?` read directly.

### `sovereign-agent.e2e.test.ts` — exit **1**, `1 failed | 3 passed (4)`

```
AssertionError: expected 'owner-attested (replicas 1, operators…' to be 'owner-attested (replicas 1, operators…' // Object.is equality

Expected: "owner-attested (replicas 1, operators 1) — owner-attested — computed once by the data owner and not independently verified"
Received: "owner-attested (replicas 1, operators 1, issuers 1) — owner-attested — computed once by the data owner and not independently verified"
```

### `sovereign-arm.node.test.ts` — exit **1**, `1 failed | 3 passed (4)`

```
Expected: "owner-attested (replicas 1, operators 1) — owner-attested — computed once by the data owner and not independently verified"
Received: "owner-attested (replicas 1, operators 1, issuers 1) — owner-attested — computed once by the data owner and not independently verified"
```

### `bench-attestation.node.test.ts` — exit **1**, `2 failed | 3 passed (5)`, and the third pass is the finding

```
Error: real/1 reported no strength: owner-attested (replicas 1, operators 1, issuers 1) — …
 ❯ strengthOf packages/node/src/bench-attestation.node.test.ts:480:11

Error: real/2 reported no strength: owner-domain (replicas 2, operators 1, issuers 1) — …
 ❯ strengthOf packages/node/src/bench-attestation.node.test.ts:480:11
```

**The case that stayed green is the measurement.** `reports the named absence for a rung
whose descriptors carry no certificate` passed — ✓, 13 837 ms — while its only instrument,
`expect(STRENGTH.test(reading)).toBe(false)` at what was then `:542`, was a pattern that
could no longer match **any** line the driver emits. `toBe(false)` was satisfied for free,
on all three memory rungs, and the run reported it green.

That is the exact shape this file's own note warns about, and this plan's action calls "the
dangerous half, and it is silent". It has now been **observed** rather than reasoned about,
and the observation is written into the `STRENGTH` docblock beside the pattern so the next
reader of that regex meets it there rather than here.

It also happens to be a live instance of what `MEMORY.md` records as *a green plant means a
blind instrument* — except no plant was needed. The ordinary course of changing a producer
produced it.

---

## The census — one finding per file, in Phase 44's form

### (a) Reddened by the mechanism

#### `packages/core/src/job/submit.test.ts` — six sites, five labels moved, one strengthened

| Site | What it was relying on | Was it true? |
|---|---|---|
| `reads independent when two verified replicas answer under different operators` | that two operator names make a live-path result independent | **True of the operator dimension, silent about the provider one.** `op-a` and `op-b` are two owner keys, so two genuinely distinct operators agreed — and every `enrol` defaults to `PROVIDER_KEY`, so one authority vouched for both. Moved to `'single-issuer'`, title moved with it, and `issuers` asserted to have length 1 so a fixture that silently grew a second authority fails saying which dimension moved. **This case is the end-to-end reading 45-01 carried forward** |
| `excludes a replica whose signature is over a different output` (`:3225`) | that refusing `'independent'` covers "this receipt carries no strength" | **No — and it was already weaker than it read before this phase.** The receipt is `holds-no-verified-attestation`, which carries no `strength` key at all, so refusing one word was never the property. Strengthened the named way (a second `not.toMatchObject` for `'single-issuer'`) **and** with `expect('strength' in shard.attestation).toBe(false)`, which is exhaustive and will not go stale on a fifth label. No `expect.stringMatching` — a regex over a strength field is the string coupling this phase removes, and a test file is outside 45-03's guard corpus |
| `builds the receipt from the replicas that agreed, never from the nodes that were placed` | that a node asked-and-failed contributes nothing | Yes, and untouched. Only the label moved; `replicas: 2` is the case's subject and did not |
| `reports the job at its weakest shard, not its strongest and not its first` | that the job reads its weakest shard | Yes. The comparison is by `attestationRank`, so **inserting a label between the two being compared does not move it** — which is why this case reads as it did with a different pair of labels in it |
| `composes across two operators on independent paths, and the shard is not degraded` | that composition succeeds and the shard is not degraded | Yes, and this is the case that shows the waiver working end to end: the live path waives the issuer **refusal**, so one authority costs the label and not the composition. `degraded === false` beside the moved label is the pairing |
| `degrades when every member depends on one relay, and names the relay` | that the receipt carries `sharedRelay` beside the strength | Yes; the `sharedRelay` half did not move. Worth naming which refusal fired: `shared-relay-dependency`, **not** the issuer one — 45-01 sited the issuer check after the path check, so a set failing both is reported by the rule it failed first |

#### `packages/net/src/reduce-job.test.ts` — the arm was ADDED, not moved

What the third arm was relying on: that `'alice-op'` beside `'bob-op'` makes an aggregation
independent. **True of the operator dimension and silent about the provider one** — both
workers enrolled with `FIXTURE_PROVIDER_SEED`, so one party vouched for the pair.

Moving that third reading to `'single-issuer'` would have satisfied the plan and **cost the
case its own argument**: three readings ending at `'single-issuer'` no longer show
`'independent'` is reachable at all, and a label nothing can reach is one no case can
distinguish from a constant it never returns. So a **fourth** arm was added instead — two
operators under two authorities — and `readings` reads
`['owner-attested', 'owner-domain', 'single-issuer', 'independent']`.

The fixture change is contained and deliberately non-disturbing: `SECOND_PROVIDER_SEED`,
an optional `issuer` field on `FixtureWorker` defaulting to the existing provider, and the
second authority's key entering `trustedIssuers` **only when a worker asked for it** — so
no existing case in the file runs against a requestor that trusts two providers. 20/20
green, one more test than before is not the count (the arm is inside an existing case).

#### `packages/node/src/quorum-agents.node.test.ts` — a rig, so the labels describe the rig

| Site | What it was relying on | Was it true? |
|---|---|---|
| `:603-604` (title too) | that distinct operators across real processes make a result independent | **True of the operator dimension only.** These are real spawned agents enrolled against ONE live provider. `45-CONTEXT.md` §4: a fixture may be handed a second authority, a rig may not. Moved to `'single-issuer'`, description moved with it, `issuers` asserted to have length 1, and the `it(...)` title moved from *"labels it independent"* to *"labels it single-issuer"* — grepped against `mutation-ledger.ts` first, no entry keyed on it |
| `:724` `not.toBe('independent')` | that refusing the stronger label guards against an implementation returning it unconditionally | **It was true and its reach halved** when a third label appeared above `owner-domain`. `not.toBe('single-issuer')` added beside it |
| `:1140` | that a receipt can honestly read `'independent'` on a shard that is `degraded` | **The three-way pairing is the point of the case and it survives intact**: a receipt above `owner-domain`, a shard `degraded`, and a named shared relay, at once. What moved is which label sits above `owner-domain` on a one-provider rig. The operator half is asserted exactly as before (`new Set(operators).size === 2`); the issuer count is asserted beside it |

#### `packages/node/src/result-signature.node.test.ts:484`

What it was relying on: that two owner seeds make a result independent. **Two user keys is
what makes them two operators** — the comment beside it already said so since VER-11 — and
an attacker reaching one certificate provider mints as many user keys as they please. This
rig runs one provider, so the two operators are still one party's reach. Moved to
`'single-issuer'`, `issuers` asserted to have length 1, and the VER-11 sentence extended
with the clause the plan asked for. One word further down was corrected as collateral: the
old comment ended *"which is what made these two nodes **independent**"*, now *"distinct
operators"*, because the old wording is the exact conflation this phase ends.

#### `packages/node/src/demo-fabric.e2e.test.ts` — a formatter fixture, which legitimately keeps its label

What it was relying on: that F7 renders `description` **verbatim** rather than composing a
sentence. Yes, and unaffected — its `issuers: []` is a fixture, not a fabric reading, and
nothing in it composes a quorum. Kept at `'independent'` as the plan allows, and given a
second arm for `'single-issuer'` built the same way: a description string **deliberately
not** `describeAttestation('single-issuer')`, because a fixture that asked the kernel for
the sentence and then checked the page printed the kernel's sentence would pass against a
page composing its own, as long as the two happened to agree. The new arm also asserts
`1 provider` in F8 — the first reader that region's receipt arm has ever had here.

### (a2) Broken by Task 1's format change

#### `packages/node/src/sovereign-agent.e2e.test.ts:524` and `sovereign-arm.node.test.ts:200`

Both carry the third count and **both are still `toBe`**. Neither was weakened to
`toContain` — verified by grep after the edit. `sovereign-arm`'s `EXPECTED_RECEIPT`
docblock gained a paragraph saying why `issuers 1` is the honest figure for that rig and
why an equality that reproduced only part of the line would be reading a prefix.

#### `packages/node/src/bench-attestation.node.test.ts:206` — both halves, one edit

1. alternation → four-way, gaining `single-issuer`;
2. parenthetical → `\(replicas (\d+), operators (\d+), issuers (\d+)\)`.

`strengthOf`'s returned record gains `issuers`, and the description capture moved
`hit[4]` → `hit[5]`. `strengthOf` was split so its parsing half — `parseStrength` — can be
applied to the controls below by the **same call** the real rungs go through; a control
that parsed its input some other way would be a reading of a second parser.

### (b) Green but stale

| Site | What it was relying on | Was it true? |
|---|---|---|
| `bench-attestation:543` absence loop | that enumerating three sentences is exhaustive | **It was, and stopped being.** Four labels now; the loop enumerates four. Without this, a driver appending the new sentence after an absence would walk past the check written to catch exactly that |
| `bench-attestation:124` prose | that the recorded plant had two wrong answers available | True as taken. A bracketed note records that a plant of that shape today has one more, and that the observation was **not** re-run — it stands as taken |
| `owner-domain-agents:600` and `:650` | that one `not.toBe` covers "returned the stronger label unconditionally" | **True when written, half-reach now.** Both gained `not.toBe('single-issuer')`. Neither was reddened by the insertion, which is why they needed reading: a check that keeps passing while its reach shrinks is the kind nobody revisits |
| `attestation-ui.e2e.test.ts` (5 `not.toContain` sites + 1 `.some(...)`) | that *"the page showed no strength"* and *"the page showed a strength"* are both decidable from three sentences | **No, from the moment a fourth existed.** `SINGLE_ISSUER` added and used at every site. Two of those sites had stale prose — one said the run has *"everything `classifyAttestation` needs for `independent` EXCEPT a second operator"*, which is now two things missing, not one; the other guards an untrusted-root fixture where **the operator dimension is already satisfied**, so `single-issuer` is the strongest thing a tab trusting the wrong root could be made to print, and until this plan it was the one label nothing there refused. Both amended. The shared helper `readsNoStrongerLabel` is where this cost one edit instead of four — which is what it was written for |
| `owner-domain-tabs.e2e.test.ts:768` | same | Same. `SINGLE_ISSUER` added; the comment explaining *"`independent` is what an unshared key would produce"* amended, because an unshared key produces `single-issuer` on a one-provider fabric and `independent` only with a second authority behind it |
| `sovereign-arm.node.test.ts:510` | that an equality beats `not.toContain('independent')` because the correct line contains that substring | **Strengthened, not invalidated** — said in one clause: a substring refusal would now have to enumerate four sentences and would still collide with this one. A second stale number was fixed in the same docblock: *"the weakest of the **three** labels"* is four |
| `mutation-guard.node.test.ts:464` | that `expected 'independent' to be 'owner-domain'` is M42's observed signature | **True of the string recorded, stale as a description of what a plant produces today** — 45-01 watched the re-sited plant produce `expected 'single-issuer' to be 'owner-domain'`. Annotated in a bracket; the ledger signature was **not** guessed at, for 45-01's stated reason (the cheap layer compares a `rendered-at-runtime` signature against nothing, so an unobserved sentence there is worse than a dated observed one). 45-04 plants it |
| `enrollment.test.ts:982` | that `classifyAttestation` returns `'independent'` the moment two certificates carry two different strings | **Was true, is not.** Rewritten to past tense, with a paragraph saying the tense is load-bearing and that VER-11's hole — who decides the operator field — is closed by the same check whatever label sits above it |

### (c) The belief `45-CONTEXT.md` §4 says must not be assumed

New case, `bench-attestation.node.test.ts`: **VER-12 — no real rung reaches single-issuer,
and the instrument could have seen it.**

The absence: over `real/1` and `real/2`, no reading's strength is `'single-issuer'`, no
reading contains `describeAttestation('single-issuer')`, and no quorum line contains
`single-issuer-quorum`. The mechanism is asserted beside the absence as literals —
`operators === 1` and `issuers === 1` on both rungs, so the case says *why* the rung is
below the rule's reach and not merely that it is.

**Two controls, because one cannot do the job.** The plan asked for a synthetic line built
from the driver's own shape rather than typed beside the regex, and that is control one:
the parenthetical is lifted **verbatim** out of a line the driver emitted in this run
(sliced on its own `' ('` and `') — '`, never through `STRENGTH`), with only the label and
`describeAttestation('single-issuer')` substituted. That control moves if and only if the
driver's template moves, which is precisely what a hand-typed one cannot do.

It is also **not sufficient**, and this is a finding: every count on the real rungs is 1 or
2 — `(replicas 1, operators 1, issuers 1)` and `(replicas 2, operators 1, issuers 1)`, both
read directly off stdout — so a pattern whose capture groups were transposed would read
them back indistinguishably, and the `hit[4]` → `hit[5]` renumbering is exactly that class
of defect. Control two is therefore a line with three **different** counts (5, 3, 2),
asserted as literals against the parsed record. Both run through `parseStrength`, and both
are asserted **before** the absence, so a blind instrument fails naming itself rather than
truthfully and uselessly reporting the negative.

Verdict: `bin/bench.ts`'s real rungs are **measured** below the issuer rule's reach.
6/6 green.

---

## Plants

**None, and that is the plan's design rather than an omission.** `45-02-PLAN.md` mandates
no plant; the (c) case's proof burden is carried by its two positive controls, which are
run and green. No green plant to report, because none was taken.

What was observed instead is stronger than a plant would have been and is recorded above:
**a real vacuous green**, produced by the ordinary course of changing a producer, caught
between two tasks of this plan, and now written beside the regex it was about.

---

## Task 1's acceptance criteria, each checked

- `grep -c "issuers" packages/node/src/bin/agent.ts` → **2**; the template match is
  `agent.ts:2450`, inside `strengthReading`. (The second is a pre-existing discovery comment
  at `:1062`, unrelated.)
- `grep -c "issuers" packages/node/src/bin/bench.ts` → **5**; `:2141` in `strengthReading`
  and `:2193` in `aggregateReading` are the two required. The other three are pre-existing
  relay/rig comments.
- `render.ts` emits the third count through the existing `plural`, so a one-provider run
  reads `1 provider`, not `1 providers`.
- `fabric.ts`'s F8 names the provider count **before** the ` · shared relay: ` suffix, so
  the relay clause stays last.
- F8 `source` and `data-source` byte-identical: `diff <(grep -o …) <(grep -o …)` exit **0**.
- `demo-regions.e2e.test.ts` exit **0**, 19/19.
- `tsc --noEmit` exit **0**.
- **The sentence grep is comment-inclusive and returns nothing.**
  `grep -n "independently verified\|single-issuer agreement"` over the four surfaces exits
  1. Because that grep *does* see comments, passing it is itself the proof that none of the
  five added comments quotes either sentence — no `stripComments` pass was needed. Checked
  before editing as well, so the empty result is not a pre-existing condition being
  inherited: it was empty on `ea57e81` too.

## Task 2's acceptance criteria, each checked

- All three verify commands exit **0**, `EXIT=$?` direct after each.
- `grep -rn "'independent'" packages --include='*.test.ts'` — every remaining occurrence
  outside `quorum.test.ts` (45-01's) is a comment, a negative assertion now paired with
  `single-issuer`, a `describeAttestation('independent')` constant used only in
  `not.toContain` groups, the hand-built formatter fixture, the four-element absence loop,
  or the **two-authority** fourth arm in `reduce-job.test.ts`. No site asserts a strength
  over a fixture carrying a single issuer.
- `bench-attestation.node.test.ts` contains a four-element strength list including
  `single-issuer`.
- **Both halves of `:206` moved** — four-way alternation **and** `issuers (\d+)`.
- `strengthOf` returns the issuer count; the description capture index moved with the group.
- The (c) control is interpolated from the driver's own emitted bytes, and the case asserts
  the parsed record's three counts rather than only that `.test()` is true.
- `sovereign-agent.e2e.test.ts` and `sovereign-arm.node.test.ts` both still `toBe`.
- `grep -rn "replicas 1, operators 1)" packages --include='*.ts'` exits 1 — **no consumer
  of the old two-count format survives.**
- `owner-domain-agents.node.test.ts` carries `not.toBe('single-issuer')` at both sites.
- Both page specs define `SINGLE_ISSUER` and use it everywhere `INDEPENDENT` is used.
- `mutation-guard.node.test.ts` exit **0**, 185 passed — no title moved out from under a
  ledger signature. Three titles were renamed and each was grepped against
  `mutation-ledger.ts` first (`submit.test.ts`, `reduce-job.test.ts`,
  `quorum-agents.node.test.ts`); none appears there, and the ledger keys on
  `caughtBy` file paths for these entries rather than on titles.

---

## Success criteria

- [x] ROADMAP criterion 5 met **where a human reads it** — all five surfaces print the
      issuer count beside the replica and operator counts, and `describeAttestation`'s
      `single-issuer` sentence (45-01's) names which dimension fell short
- [x] No spec in the tree asserts `'independent'` over a one-issuer fixture
- [x] Every absence check that enumerated three strengths now enumerates four
- [x] `bin/bench.ts`'s real rungs **measured** below the issuer rule, with two positive
      controls proving the measurement could have found otherwise
- [x] Each repaired fixture has a written finding
- [x] **The end-to-end reading through `submitJob`, carried forward from 45-01 — met.**
      `submit.test.ts` alone, `--project node`, exit 0, 105/105
- [x] `.planning/STATE.md` and `.planning/ROADMAP.md` **not** modified

## Commits

| Commit | Task |
|---|---|
| `d0d5c0c` | `feat(45-02)` — every surface that names a strength names how many providers stood behind it |
| `baeb42a` | `test(45-02)` — the census: every spec that was reading `independent` over one provider |

Both committed with explicit paths and `git show --stat` read afterwards: 7 files and 13
files respectively, all this plan's own. The untracked `.gitkeep` in the phase directory was
left alone — not this plan's. Staging happened only **between** vitest runs, never during
one; `bench-attestation`'s `repoStatus()` comparison is green in every run.

## Self-Check: PASSED

All seven Task 1 files and all thirteen Task 2 files are on disk; both commit hashes
resolve in `git log`. `.planning/STATE.md` and `.planning/ROADMAP.md` are unmodified by this
plan — `git diff HEAD` over both is empty, and their most recent touching commits (`a70964a`
and `fd3fbce`) both predate `d0d5c0c`.
