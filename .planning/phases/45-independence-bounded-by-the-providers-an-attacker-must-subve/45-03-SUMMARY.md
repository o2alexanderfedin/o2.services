---
phase: 45-independence-bounded-by-the-providers-an-attacker-must-subve
plan: 03
subsystem: guards/attestation-claims
tags: [VER-12, criterion-3, guard, release-copy, attestation]
requires:
  - "AttestationStrength 'single-issuer' and attestationRank's four-way switch (45-01)"
  - "packages/node/src/strip-comments.ts — stripComments, so a comment is never a finding"
  - "packages/node/src/commit-scope.ts — blocking/commitScope/trackedPaths/pathFormProblems"
  - "the ROADMAP gate paragraph committed at 4ff8a36"
provides:
  - "criterion 3's guard half: no non-test source compares a strength against a string"
  - "one exemption scoped to two FUNCTION NAMES in quorum.ts, never to lines or to a path"
  - "a dead-exemption check held per function, with its own positive control"
  - "the release-copy check, with both controls, and the verdict written down"
affects:
  - "packages/core/src/quorum.ts — its two switches are now the only exempted site in the tree"
  - "plan 45-04 — inherits a GREEN slow-specs, not the red the plan predicted"
tech-stack:
  added: []
  patterns:
    - "an exemption located by `export function <name>` through its closing brace, so it survives every edit inside the body"
    - "a guard kept out of its own corpus by construction rather than by an entry naming itself"
    - "a negative control lifted out of the real file and checked alive before it is trusted"
key-files:
  created:
    - packages/node/src/attestation-claims.node.test.ts
  modified: []
decisions:
  - "The corpus is non-test source, so this file is outside it by construction — no exemption for its own prose exists and a case forbids one being added"
  - "The dead-exemption check is held per FUNCTION rather than per entry, which is stricter than the plan's wording"
  - "The release-copy patterns name verbs of CHECKING, never ownership, so README's `independently-owned nodes` is not a finding"
  - "No release-copy file was touched: the corpus measured clean and the obligation is discharged by a check with both controls, not by an edit"
metrics:
  tasks: 2
  commits: 2
  completed: 2026-09-16
---

# Phase 45 Plan 03: The Guard That Keeps Criterion 3, and the Copy Check — Summary

Nothing in 217 files of non-test source reads an attestation strength by matching a
string, and a guard says so now instead of a reader. The release copy promises no
independence this fabric will not report, and that verdict was reached by an instrument
that was watched finding a planted promise first.

**Neither claim is new. Both were true before this plan and neither had an instrument.**
That is the whole of what changed.

---

## What each criterion cost

Every reading taken with `EXIT=$?` on the line **immediately** after the command — no pipe,
no trailing `echo`, no `tail` — **with one exception, labelled in the table below rather than
left to be assumed**: the `slow-specs` baseline taken before the new file existed went through
a pipe, so its exit was never read. That row is the one reading here that does not meet this
repository's own rule, and the comparison it belongs to is carried by the post-change side,
which was retaken directly (`EXIT=0`, `15 passed (15)`, host quiet at load/core 0.85) after
this plan's commits had landed. Host quiet throughout (`load/core` 0.85–1.74 against a
ceiling of 4.00, 8 cores).

| Criterion | Instrument | Result |
|---|---|---|
| `npx vitest run --project node packages/node/src/attestation-claims.node.test.ts` | direct `EXIT=$?` | **0** — 25 passed, 0.75 s |
| the same after Task 1's half alone | direct `EXIT=$?` | **0** — 21 passed |
| `npx tsc --noEmit` | direct `EXIT=$?` | **0**, four times across the plan |
| the nine cheap guards, via the commit hook | twice | **0** — 401 passed, 2.28 s and 2.14 s |
| `packages/node/src/slow-specs.node.test.ts` **before** the new file existed | **piped — the exit was NOT read directly** | 15 passed, and the reading is therefore weaker than every other row here. It is kept because it is the only side of the comparison that can no longer be retaken, and it is labelled rather than deleted |
| the same **after** the new file was tracked | direct `EXIT=$?` | **0** — 15 passed. See the discrepancy below |

Corpus, measured by the guard's own scan and reproduced independently:
**217 non-test `.ts`/`.tsx` files under `packages/`**, of which **10** are
`packages/browser/demo/**` — source that sits under no `src/` directory and would have
been dropped silently by the obvious glob. **363 specs are excluded**, and they hold
34 / 26 / 31 occurrences of the three pre-existing strength names, every one an assertion
and every one correct.

---

## Plants: four, every one watched going red, restored by the surgical inverse, `cmp`-verified

`cmp` exit **0** in all four cases, against a snapshot taken immediately before planting.
No `cp` of a whole file to undo a plant, no `git stash`, no `git checkout --`.
`git status --porcelain` clean for each planted path afterwards. **No green plant.**

### Plant 1 — an ordinary caller starts reading the label by string

`packages/net/src/reduce-job.ts:530`, one line, the comparison this phase's criterion is
named after:

```
-    attestationRank(receipt.strength) < attestationRank(weakest.strength) ? receipt : weakest,
+    receipt.strength === 'owner-attested' ? receipt : weakest,
```

**Observed, verbatim:**

```
× finds no comparison, no case label and no switch on a strength outside the definition
AssertionError: expected [ Array(1) ] to deeply equal []
+ [
+   "packages/net/src/reduce-job.ts:530 comparison — receipt.strength === 'owner-attested' ? receipt : weakest,",
+ ]

× still compares — through attestationRank, at both of the sites that do
AssertionError: expected '\n\n\n\n\n…' to contain 'attestationRank('

Tests  2 failed | 23 passed (25)
```

**The second red was not planned for and is the better half of the reading.** The absence
case and the presence case are coupled: removing the `attestationRank` call is what made
room for the string comparison, so the same one-line plant proves the guard can fail
**and** proves the positive assertion is not decoration. An absence that passes because
nothing compares at all is the failure `MEMORY.md` records as *an absence needs a positive
control*, and this is that control firing.

### Plant 2 — a comparison inside `quorum.ts` but outside both exempted bodies

`packages/core/src/quorum.ts:376`, inside `composeQuorum`'s receipt construction:

```
-    strength: classifyAttestation(members),
+    strength: classifyAttestation(members) === 'independent' ? 'independent' : 'owner-attested',
```

**Observed, verbatim:**

```
× finds no comparison, no case label and no switch on a strength outside the definition
+ [
+   "packages/core/src/quorum.ts:376 comparison — strength: classifyAttestation(members) === 'independent' ? 'independent' : 'owner-attested',",
+ ]

× suppresses something real, all of it inside the two named bodies
AssertionError: expected 9 to be 8

× still reports a comparison outside both bodies — the narrowness a path entry would hide
AssertionError: expected 2 to be 1

Tests  3 failed | 22 passed (25)
```

**This is the narrowness claim proved on the real file rather than on a synthetic one.**
A path-shaped exemption — the shape anyone would reach for, because `quorum.ts` is
"the file that legitimately names the strengths" — would have hidden all three reds.

### Plant 3 — a promise planted in the copy that will actually be sent

`docs/recruitment/telegram-invite.md:43`, one line:

```
-you agree, and that figure comes off a real run rather than a guess.
+you agree, and every result is independently verified before you see it.
```

**Observed, verbatim:**

```
× makes no independent-verification promise anywhere in the release copy
AssertionError: expected [ Array(1) ] to deeply equal []
+ [
+   "docs/recruitment/telegram-invite.md promises independent verification — \"independently verified\" in: …istory. The page tells you roughly how many kilobytes that is before you agree, and every result is independently verified before you see it. There is no payment involved, in any direction and in any form. There is nothing…",
+ ]

Tests  1 failed | 24 passed (25)
```

The finding prints the surrounding sentence, so a reader gets the claim rather than a
line number for a hard-wrapped file whose lines are not sentences.

### Plant 4 — the exemption pointed at a function that does not exist

In the guard's own `EXEMPT_FUNCTIONS`, `'describeAttestation'` → `'describeAttestationRENAMED'`.
This is the dead-exemption check's plant, and it also shows the exemption is load-bearing.

**Observed, verbatim — six reds, and each names a different property:**

```
× finds no comparison, no case label and no switch on a strength outside the definition
+ [
+   "packages/core/src/quorum.ts:155 case-label — case 'owner-attested':",
+   "packages/core/src/quorum.ts:157 case-label — case 'owner-domain':",
+   "packages/core/src/quorum.ts:165 case-label — case 'single-issuer':",
+   "packages/core/src/quorum.ts:167 case-label — case 'independent':",
+ ]

× carries no exemption that no longer suppresses anything
+ [
+   "packages/core/src/quorum.ts :: describeAttestationRENAMED — suppresses nothing; either the
+    function no longer names the strengths, or it is gone. Delete the name from EXEMPT_FUNCTIONS
+    (was: the two exhaustive switches that DEFINE the ordering and the sentences — …)",
+ ]

× would report the entry dead if the function stopped naming the strengths
AssertionError: expected false to be true

× is exactly one entry, scoped to two function names and not to a path or a line
-   "describeAttestation",
+   "describeAttestationRENAMED",

× suppresses something real, all of it inside the two named bodies
× still reports a comparison outside both bodies — the narrowness a path entry would hide

Tests  6 failed | 19 passed (25)
```

---

## The exemption, and why its shape is not a preference

One entry. It names `packages/core/src/quorum.ts` and the two functions
`attestationRank` and `describeAttestation`, and nothing else in the tree is exempt.

- **Located structurally**: `export function <name>` through the first `}` in column zero
  after it. Never a line number — the finding count inside that file moved **6 → 8** during
  this very phase when 45-01 inserted `single-issuer` into both switches, and a line-shaped
  entry would have died on that edit or, worse, survived it pointing at the wrong lines.
- **Measured today**: 8 findings with the exemption off, **all 8 inside the two bodies**
  (`:141/143/145/147` and `:155/157/165/167`), 0 with it on. The 8 is written as a literal
  so a switch that silently stops being exhaustive reddens.
- **The narrowness is proved twice** — once against synthetic source built from the real
  file (a case), once against the real file with a real plant (Plant 2 above).
- **`packages/node/src/mutation-ledger.ts` passes with NO exemption**, asserted as its own
  case. Its `find` / `replace` / `signature` strings carry strength names as data about
  mutations, and none of the three patterns reaches them — including after 45-01 re-sited
  M41 and M42.

**Stricter than the plan asked, stated so nobody reads it as drift:** the dead-exemption
check is held **per function name**, not per entry. The plan's wording is *"if neither named
function still produces findings, the entry is dead"*. Per-function means rewriting
`describeAttestation` as a lookup table demands its name be removed, rather than leaving
half a dead entry alive on the other half's findings.

## Why the guard's own prose cannot trip it

Structural, not registered. The corpus is non-test source; this file's name ends
`.node.test.ts`; `isSpec` puts it outside. **No entry in `EXEMPT_FUNCTIONS` names it and a
case asserts none may be added** — an exemption for a guard's own prose is exactly the
shape that makes a guard stop seeing. This is the collision that reddened
`vocabulary.node.test.ts` twice during Phase 44 and is recorded twice more in
`wrangler.jsonc`'s header, and it is answered here by construction rather than by care.

The comment link is proved rather than assumed: a case feeds the checker a comment
carrying all four names, requires no finding, **and then requires the same text outside a
comment to produce exactly one** — so the case is about comments and not about the pattern
having quietly stopped working.

---

## The release-copy check — the obligation at `4ff8a36`, discharged

**Verdict: GREEN. The release copy makes no independent-verification promise.**

**The corpus** is named by path because the ROADMAP names it, and every path is asserted
present so an absent one is a red rather than a silently smaller corpus:
`docs/recruitment/telegram-invite.md`, `packages/browser/demo/index.html`,
`packages/browser/demo/policy.html`, `packages/browser/demo/status.html`, `README.md`.
Read as flattened text (`text.replace(/\s+/g, ' ')`) because the markdown is hard-wrapped
at ~78 columns — the reading `licensing-consistency.node.test.ts` established by writing
four rules line-wise first and watching them fail on correct documents.

**The patterns** name verbs of *checking*: `independently verified`,
`independent verification`, `verified independently`, `independently checked`,
`independent check` (with `(?!list)`), `independent operators agreed`.

**Both controls, and the negative ones are lifted out of the real files and checked alive
before they are trusted:**

| Control | Fixture | Required | Observed |
|---|---|---|---|
| positive | *"Every answer is independently verified by separate operators."* | 1 finding | 1 finding, naming `independent verification` and attributing to `['README.md', SELF]` |
| negative | `README.md`'s own core-value sentence, sliced around `independently-owned nodes` | 0 findings | 0 |
| negative | `index.html`'s prose card, sliced around `independent cubes` | 0 findings | 0 |

The second negative control's slice also carries **"every cube is run on two of them and
the two must agree"**, and the case asserts that phrase is in the slice. That is the
redundancy claim the demo does make, it is about **replicas** rather than **providers**, it
is true, and this phase does not touch it. It must not be a finding either, and it is not.

**Nothing in the release copy was edited. No file outside the new spec was modified by
this plan at all** — the corpus measured clean before the check was written and clean
after, and the obligation is discharged by an instrument that was watched finding a
planted promise, not by a reader deciding the copy is fine.

**One deliberate over-fire, stated rather than left to be discovered.**
`describeAttestation('owner-attested')` ends *"not independently verified"* — a **refusal**
of the promise — and these patterns would report it. That is intended: a release page
carrying any arm of the kernel's sentence statically holds a copy of words whose author is
`quorum.ts`, and the wider scan below found exactly such a copy that has already drifted.
The demo's own attestation card does the right thing instead — it is a
`data-kind="reading"` region and prints whatever the kernel hands it, so it holds no
sentence for this scan to find.

---

## The wider one-off scan — every hit, with a decision

Run across **all of `docs/` and all of `packages/browser/demo/`**, tracked files only.
**Zero hits in `packages/browser/demo/`.** Twelve in `docs/`, none of it release copy.
A supplementary pass was run for `independent operators` / `independently derived` /
`independent oracle`, because **one of the two hits the plan names is NOT matched by the
guard's own patterns** and reporting it anyway is the point of the obligation.

### The guard's patterns — 12 hits

| Hit | Decision |
|---|---|
| `docs/business/o2-vs-aws-study.md:964` + its `.html:729` and `.standalone.html:600` renderings — *"requires **independently verified** aggregation, which a single vendor cannot produce by definition"* | **Out of scope, and true.** A market argument about what an insurer SKU requires, not a promise this fabric makes a visitor. Not release copy. It stays true after this phase in the sharpest possible way: a single vendor cannot produce it, and neither can this fabric while one provider vouches for every member — which is the subject of the phase |
| `docs/design/mockups/o2-fabric-demo/o2 Fabric Demo.dc.html:650` and `:652` — an `ATT_DESC` map hardcoding three strength sentences | **Reported, not moved — this is the real drift.** It hardcodes `owner-attested`, `owner-domain` and `independent` and therefore now disagrees with `describeAttestation` by a whole arm: `single-issuer`, the label this fabric will actually report, does not exist in it. A design mockup, not release copy, and nothing loads it — but a reader can reach it and would read a strength set that no longer exists |
| `docs/design/templates/ui-mockup-requirements.md:93` — *"### The independent check (a separate, deliberate act)"* | **Out of scope.** A UI template describing a button the **user** presses to re-derive an answer themselves. The independence is the user's, not a quorum's |
| `docs/perf/prime-and-pi-benchmarks.md:24` + `.html:325` — *"That is a genuinely **independent check**, and it is blind in one direction"* | **Out of scope, and true.** The oracle is pi(N) tabulated in the mathematical literature before this repository existed. Independence **of an oracle**, saying nothing about providers or operators |
| `docs/story/research/02-planning-corpus.md:176` — *"**Independently verified** before being recorded"* | **Out of scope.** A block quotation of `.planning/v1.0-MILESTONE-AUDIT.md`'s procedure for checking that a symbol appears in the repository. About the audit, not about a result |
| `docs/story/the-author-forgets.md:199` + its `.html:417` and `.standalone.html:411` renderings — a diagram label, *"the aggregation over contributions, **verified independently** of how each partial was produced"* | **Out of scope, true, and the one genuine over-fire.** `independently **of how**` is a statement about what the aggregation does *not* depend on — it is `CLAUDE.md`'s own sovereign row said as a diagram. The pattern fires on it as a substring. If any of these three ever entered the release-copy corpus the pattern would need a `(?! of)`; they are not in it, and narrowing the pattern now for a file outside the corpus would be weakening an instrument to suit a document it does not read |

### The supplementary pass — including the hit the guard's patterns do not match

| Hit | Decision |
|---|---|
| `docs/business/o2-vs-aws-study.md:1194` — the glossary: *"**Quorum** \| A set of independent operators that must agree before a result is published"* | **Out of scope, and true — named by the plan and reported here as required.** It defines the term *quorum*, and a quorum **is** that. It is not matched by the guard's patterns (`must agree`, not `agreed`), which is why the supplementary pass exists. What this phase changed is which **label** the fabric reports when one certificate provider vouched for those operators — not what a quorum is |
| `docs/business/o2-vs-aws-study.md:203`, `:229`, `:248` + the two renderings — *"2+ independent operators each"*, *"INDEPENDENT OPERATORS — subscriber balance sheet"* | **Out of scope.** A proposed consortium whose members are separate legal entities running their own clusters, several of whom would hold their own certificate authorities. That is the two-provider world in which `independent` becomes reachable again, described as a market rather than claimed as a shipped reading |
| `docs/architecture/RFC-0003-RESPONSE-05-operator-identity-and-quorum-diversity.md:39` — *"receive a receipt that says **independent operators** concurred"* | **Reported.** The one hit that is genuinely about this fabric's receipt — and it is the design document **this phase implements**, stating its goal. Not release copy, and the phase's own answer to it is `single-issuer`. Flagged so a later reader does not quote a design goal as a shipped promise |
| `docs/architecture/RFC-0003-RESPONSE-02-capability-algebra-and-envelope.md:526` — *"independent oracle"* | **Out of scope.** The oracle sense again |
| `packages/browser/demo/index.html:931` — *"an **independent oracle** is only a check if something reaches it"* | **In the release-copy corpus, correctly no finding.** The oracle is the pi(N) table. This is one of the sentences the plan names as a must-not-match, confirmed not matched |
| `packages/browser/demo/surfaces/primes.ts:51` and `:374` — *"the two are **independently derived**"* | **In the criterion-3 source corpus, correctly no finding**, and named by the plan as a must-not-match. Confirmed |

---

## Where the plan disagreed with the tree

Four. All measured. None closed by widening what counts as passing.

### 1. `slow-specs.node.test.ts` does NOT go red — the handover 45-04 actually inherits

The plan's verification section states: *"`slow-specs.node.test.ts` will therefore read red
on `files`/`tests` between this plan and 45-04's last task — that is expected, is named
here, and is closed there. Record the observed failure text in the SUMMARY."*

**There is no failure text, because there is no failure.** Measured both sides of the
change, `--project node`, `EXIT=$?` read directly:

| When | Reading | Exit |
|---|---|---|
| before the new file existed | `15 passed (15)`, 10 ms | **not read directly — piped.** See the table above |
| after it was tracked | `15 passed (15)`, 9 ms | **0** |
| again, twice, through the commit hook | `15 passed (15)` | **0** |

Two reasons, both read out of the spec rather than guessed:

1. **The file-count check has a tolerance of five**, and says so at length —
   `FILE_COUNT_TOLERANCE = 5` in `slow-specs.node.test.ts:199`, chosen *"against the drift
   that actually happened: the project grew by thirty-six files between measurements"*, with
   equality explicitly considered and rejected because *"a guard that expensive to satisfy
   gets deleted"*. `NODE_PROJECT_FILES` reads **270** against a recorded `files: 269` —
   drift **1** of a permitted **5**.
2. **`tests` is never asserted at all.** `measurementField` is called four times in that
   spec — `files`, `unitFiles`, `sumOfFileSpansMs`, `load` — and `tests` / `unitTests` have
   no reader. A test count cannot redden it.

**What 45-04 inherits, stated as a number rather than a promise:** four files of headroom
before `vitest.config.ts`'s counts must be retaken by the ~400 s procedure in
`MEASURED_NODE_SPANS`'s docblock. 45-04 adds **no** test file (two mutation-ledger entries,
one `it` each), so on the plan's own description it will not consume any of it. The
counts were **not** updated here, which is what the plan directed, and the direction turns
out to have been right for a different reason than the one given: not "the number would be
stale before it is committed" but "nothing asserts it".

### 2. Three positive-control fixtures produce **four** findings, not three

The plan's acceptance criterion reads *"Three positive-control fixtures each produce a
finding, asserted against the literal `3`."* The third fixture —
`switch (receipt.strength) { case 'single-issuer': }` — trips **two** rules at once, because
a switch on a strength is also a file carrying a case label. Both numbers are asserted as
literals rather than one being fudged: **3** fixtures report, and **4** findings come back.
A third assertion requires all **three** rule kinds to be present in that set, without which
two rules could be dead and the count still satisfied by the third firing twice.

### 3. The corpus instruction's second sentence is already implied by its first

The plan says to filter *"paths under `packages/` ending `.ts` or `.tsx`"* and then *"Also
include `packages/browser/demo/**` `.ts` files, which are source and are not under a `src/`
directory."* The second sentence adds nothing to the first — it is a warning against
narrowing to `src/`. Implemented as the plain filter, and the warning is discharged as a
**measurement** instead: 10 demo files are in the corpus, and a case names
`packages/browser/demo/surfaces/fabric.ts` by path so a future `src/` narrowing reddens.

### 4. `tsc` names a fifth strength, which the plan did not ask for

A one-line function whose parameter is `AttestationStrength` and whose return type is the
literal list's member type. It only typechecks while the list covers the union, so adding a
fifth strength without adding it here is a compile error — the one failure mode a runtime
guard over a hand-written list cannot see for itself. It is **called** from the ordering
case rather than left as an unused declaration, so nobody deletes it as decoration.

---

## Success criteria

- [x] **ROADMAP criterion 3 is met in full.** The ordering half landed in 45-01; the guard
      half is here, over 217 non-test files, with three positive controls, three negative
      controls and two plants in real source watched going red
- [x] **The guard is outside its own corpus by construction**, asserted as a case, and a
      case forbids an exemption naming it being added
- [x] **The release-copy obligation at `4ff8a36` is discharged** by a check with both
      controls, the positive one watched finding a planted promise in the copy that will
      actually be sent, and the verdict written down
- [x] Exactly one exemption, scoped to two function names, with a stated reason of more
      than 20 characters and a per-function dead-exemption check that has its own control
- [x] `npx tsc --noEmit` exit **0**
- [x] Every hit in the wider scan of `docs/` and `packages/browser/demo/` carries a
      recorded decision, including both the plan names
- [x] `.planning/STATE.md` and `.planning/ROADMAP.md` **not** modified

## Commits

| Commit | Task |
|---|---|
| `f381675` | `test(45-03)` — a guard keeping every strength comparison inside `attestationRank` |
| `f21a78a` | `test(45-03)` — the release copy checked against the independence the fabric reports |

Both committed with **explicit paths** and `git show --stat` read afterwards: **one file
each, and it is the same file, this plan's only one** — Task 1 added 545 lines, Task 2
added 138. The hook's nine cheap guards ran on both, 401/401 green each time; neither used
`--no-verify`. `git add` happened only **between** vitest runs, never during one. The
untracked `.gitkeep` in the phase directory was left alone — not this plan's.

## Self-Check: PASSED

`packages/node/src/attestation-claims.node.test.ts` and this SUMMARY are on disk; both
commit hashes resolve in `git log`. `git diff HEAD` over `.planning/STATE.md` and
`.planning/ROADMAP.md` is empty and neither appears in either commit's `--stat`.
