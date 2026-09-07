# 38-03 — SUMMARY: the recruitment message into the tree, the five patterns into one file, and one command for the message that never gets there

**`REQUIREMENTS.md` was not touched.** DEMO-05 and DEMO-06 are left exactly as they were for
the owner to move after reading the evidence below.

## Which criteria this plan closed, and which were already closed before it started

| Criterion | State before this plan | What this plan did | Evidence |
|---|---|---|---|
| 3 — the contribution posture | **already met in full**, `[x] DEMO-05` | nothing; `CONTRIBUTING.md` was not opened | `packages/node/src/licensing-consistency.node.test.ts:199-223` asserts *"triaged, never merged"*, *"independently of the reported diff"*, *"no CLA"*, and the may-fork clause, each by name |
| 4 — no promise of permanent open licensing | **project half already met**, `[x] DEMO-06`; the recruitment half had no subject | wrote the recruitment copy and put it inside the same rule | `licensing-consistency.node.test.ts:168-177` now runs the permanent-licensing rule over six documents, the sixth being `docs/recruitment/telegram-invite.md`; the floor at `:136` rose from `5` to `6` |
| 5 — no payment and no cryptocurrency framing | **in-tree half already met** | brought the recruitment copy into the tree so the in-tree half covers it, and built the out-of-tree half the criterion names by hand | the vocabulary guard was watched reddening on `docs/recruitment/telegram-invite.md` by name and line; `packages/node/src/bin/check-copy.ts` reads the same array for a message that is never a file |

Criterion 3 was not rebuilt and criterion 4's project half was not rebuilt. Neither
`CONTRIBUTING.md` nor any of the five original prose documents was edited.

## What landed

- `packages/node/src/banned-vocabulary.ts` — `Banned`, `BANNED`, `Violation` and `rawMatches`.
  The array moved out of the spec verbatim: same five rows, same patterns, same `why` strings,
  same order, and its docblock carried across including the paragraph about the pronoun sense
  that is deliberately not banned. Not in any barrel; imported by relative path.
- `packages/node/src/vocabulary.node.test.ts` — imports the four, and registers the new module
  in `EXEMPT_PATHS` on the reason its own entry carries. One case added: every row matches its
  own term, and the count is the literal `5` rather than `BANNED.length`.
- `packages/node/src/bin/check-copy.ts` — a file path or `-` for stdin, findings on stdout one
  per line, summary on stderr, exit `0` / `1` / `2`.
- `packages/node/src/check-copy.node.test.ts` — seven cases, the command driven as a real child
  process with the exit code read off the spawn result.
- `docs/recruitment/telegram-invite.md` — the message, the reason its licensing sentence reads
  the way it does, and the send-time command.
- `packages/node/src/licensing-consistency.node.test.ts` — the new path in `PROSE`, the floor
  raised, and one case requiring all three forks by name plus the two words the position is
  stated in.

The message says only what the page already discloses. The claims in it — nothing runs and
nothing is contacted before consent, one background thread dropping to a tenth when the tab is
not in front, a Stop control that ends the work rather than asking it to finish, a measured
kilobyte figure, the answers leaving and nothing else — are each a line of
`packages/browser/src/disclosure.ts`'s `DISCLOSURE`, not a new promise. Its licensing sentence
is `LICENSING.md:119-124` in the message's own register: the grant already made cannot be
withdrawn, and monetisation is additive.

## The four plants

Each was watched failing on its own, restored by reversing exactly the lines that were changed,
and verified `cmp`-identical against a snapshot taken immediately before the plant. No `cp` of
a whole file and no `git checkout --` anywhere: this tree was shared with plan 38-01 for the
whole session.

**The observed text below is redacted in one place only, and this is where it is said.** Two of
the four plants produce output that quotes the words the guard bans, and a summary carrying
them is a violation of the rule the summary is about. Where a banned literal appeared it is
written here as `BANNED[n].term`. Nothing else about the text is changed. The unredacted
readings are in the execution log and in `packages/node/src/banned-vocabulary.ts` itself.

| # | Plant | Guard | Observed |
|---|---|---|---|
| 1 | the new module's `EXEMPT_PATHS` entry deleted | vocabulary | five cases red, each naming the module by path and line |
| 2 | `always be free and open source` into the message | licensing-consistency | one case red, naming the recruitment file |
| 3 | a term read out of `BANNED[3]` into the message | vocabulary | one case red, naming the file **and line 45** |
| 4 | the last row of `BANNED` removed | check-copy | `expected 4 to be 5`, on both the file arm and the stdin arm |

### Plant 1 — the exemption that has to land with the module

```
FAIL  packages/node/src/vocabulary.node.test.ts > no cryptojacking vocabulary reaches a
reviewer who greps > says "BANNED[0].term" nowhere — …
AssertionError: expected [ …(3) ] to deeply equal []
+ [
+   "packages/node/src/banned-vocabulary.ts:43 \"BANNED[0].term\" — * Inflections are …",
+   "packages/node/src/banned-vocabulary.ts:52 \"BANNED[0].term\" — term: '…',",
+ ]
```

Five of the twenty-six cases red, one per row, each naming
`packages/node/src/banned-vocabulary.ts`. This is why the exemption is not a tidiness point:
`scanRepository` reads every file `git ls-files` reports, so a module landing without it fires
the guard on itself and refuses the next commit by whoever happens to make it — somebody who
did not write the line.

### Plant 2 — the promise all three precedents shipped

```
FAIL  packages/node/src/licensing-consistency.node.test.ts > DEMO-06 — no document promises
terms the licence does not carry > does not promise permanent open licensing, which is what
DEMO-06 actually asks
AssertionError: docs/recruitment/telegram-invite.md: expected true to be false
```

The file is named in the assertion message, which is the whole reason `PROSE` carries the name
beside the text.

### Plant 3 — the one that matters

```
FAIL  packages/node/src/vocabulary.node.test.ts > no cryptojacking vocabulary reaches a
reviewer who greps > says "BANNED[3].term" nowhere — …
AssertionError: expected [ Array(1) ] to deeply equal []
+ [
+   "docs/recruitment/telegram-invite.md:45 \"BANNED[3].term\" — There is no payment involved,
     in any direction and in any form. You get 100 BANNED[3].term for the first hour. There is
     nothing",
+ ]
```

The literal was substituted in by a script reading `BANNED[3].term`, never typed, so neither
the plan nor this document carries it. **This is the positive control the whole of criterion 5
rests on.** Without it, the absence claim over `docs/recruitment/` passes exactly as well on a
file the corpus reaches as on one it does not, and this repository has closed a criterion on an
empty read once already. The corpus demonstrably reaches `docs/recruitment/`, by path and by
line number.

### Plant 4 — the array's size is measured, not assumed

```
FAIL  packages/node/src/check-copy.node.test.ts > the checker reports every one of the five,
not the first one it meets > reads a message carrying all five and reports five findings
AssertionError: expected 4 to be 5
```

The same failure on the stdin arm. The row was located structurally — the last `{` before the
array's closing bracket — rather than by naming the word, and re-inserted at the same offset;
`cmp` against the pre-plant snapshot returned `0`.

## Two deviations, both narrowing

**`check-copy.node.test.ts` is not in `EXEMPT_PATHS`, and the plan expected it would have to
be.** The plan's reason was *"a checker for the banned list cannot be tested without naming
what it bans"*, and measured, that is false: the fixture substitutes `BANNED[n].term` into
ordinary sentences, so the spec names none of the five and the vocabulary guard passes over it
with no entry — verified with the file staged. The guard's own stated bias is *"toward
exempting as little as possible"*, and a path exemption is additionally **not** covered by the
dead-exemption check, which holds only line exemptions; an unnecessary one could never be found
and deleted later. The substitution also buys the better control: the terms sit in real prose,
so each pattern's word boundaries are exercised in the position they will be read in.

**The scratch fixture goes under `mkdtempSync(tmpdir())`, not a session directory.** A
committed spec cannot name a session-specific path — it would be dead in CI and in a verifier
run. What the instruction was protecting is satisfied: nothing is written inside the repository
and `git status --porcelain` showed only this plan's own four files.

## A latent type error, and why `tsc` did not report it when it was introduced

The `each row matches its own term` case was written as
`!(term.match(pattern) ?? []).includes(term)`. Inferred, `RegExpMatchArray | never[]` gives
`includes` a parameter of `never`, and the line does not typecheck. **`npx tsc --noEmit` was run
immediately after that edit and reported it clean**, because plan 38-01's
`packages/browser/src/embedded-webview.ts` was mid-edit and failing to *parse* — 55 syntax
errors — so the semantic pass never reached this file. It surfaced two tasks later, on the
first run after that file parsed, and is fixed with an annotated `readonly string[]`. The
lesson is recorded in the case's own comment: on a shared tree, a clean `tsc` taken while
another agent's file has a syntax error is not a clean `tsc`.

## What is red, why, and what fixes it

`packages/node/src/reachability-guard.node.test.ts` fails one of its thirty-five cases:

```
AssertionError: 34 production modules have no production importer, against a ceiling of 33.
A HIGHER number means a new uncounted module arrived: … packages/node/src/bin/check-copy.ts …
```

Exactly one unit over, and it is this plan's. The mechanism is the one that list already
accepts for `commit-scope.ts`, `strip-comments.ts`, `e2e-browser-launch.ts` and `e2e-signin.ts`:
a module no *production* module imports. **The membership moved during the plan and the final
name is `bin/check-copy.ts`, not `banned-vocabulary.ts`** — once the command imported the
module, the module gained a production importer and left the list, and the command took its
place. It is deliberately not in `ENTRY_POINTS`: the plan forbids it, because adding a root
moves verdicts across every barrel.

The repair is the `+1` named raise that list documents for itself, in
`reachability-guard.node.test.ts` — **outside this plan's scope fence, so it was not made.**
The plan anticipated this exact red and instructed that it be recorded rather than widened. The
three commits therefore used `O2_SKIP_GUARDS=1`, each carrying the attribution in its body, and
every other cheap guard was green on every attempt.

The count should be **re-measured at merge time rather than trusted at 34**: it read 35 on the
first attempt, when plan 38-01's `embedded-webview.ts` was also on the list, and dropped to 34
when they wired it. The number is a property of the tree at the moment it is read, and two
agents were writing to that tree.

## Scope kept

Nothing was sent and nothing was published. `.planning/REQUIREMENTS.md`, `.planning/STATE.md`
and `.planning/ROADMAP.md` were not touched. `CONTRIBUTING.md`, `LICENSING.md`, `README.md`,
`LICENSE-COMMERCIAL.md` and `.planning/PROJECT.md` were not touched. No `ocr-checks-worker`
script, no release, no deploy. Committing a document into a repository that is already public
is not the act of posting to a group; the send stays an owner action under Phase 39.
