# Guard defects #39 and #40 — investigated 2026-08-04, NOT YET FIXED

Read-only investigation, run while four executors held the tree. The fix is deliberately
**not applied yet**: editing the pre-commit hook and five guard specs while four agents are
committing through them could break all four at once, and would make any red they hit
un-attributable. Apply when the tree is quiet, and **re-measure §4 first** — the "no verdict
differs today" reading below was taken before Phase 20 wave 1 and Phase 21 wave 2 landed.

**Sequence: #40 before #39.** #40 is a correctness defect (guards silently miss), #39 is an
availability defect (guards block the wrong person). A guard that misses is worse than a guard
that over-blocks. They also both edit `requirements-ledger.node.test.ts`, so they cannot run in
parallel.

---

## #40 — the recorded diagnosis is WRONG in the direction that matters

Recorded: *"a `/*` inside a `//` comment blinds three source-scanning guards … produced five
failures that looked like real findings."*

Measured:

- **Six strippers, not three.** Five share one regex pair verbatim (`bench-egress`,
  `bench-reduce`, `sovereign-block-refusal`, `trust-anchors`, and `requirements-ledger` with an
  extra `[^:]` guard for `https://`). The sixth, in `identity-store.node.test.ts`, is a
  line-prefix filter with the *mirror-image* bugs instead.
- **The trigger is wider than "inside a `//`".** It is *any* `/*` occurring outside a block
  comment — line comments **and string literals**. The `//` form was fixed and is gone from the
  tree. **The string-literal form is live**: 54 stray openers across 20 tracked files, of which
  10 lose identifiers to the regex that a real tokenizer keeps. Four of those 10 sit inside
  `requirements-ledger`'s `PRODUCTION` corpus or `trust-anchors`' jurisdiction.
- **"Five failures that looked like real findings" describes only the fail-CLOSED half of the
  population.** The other half fails silently and produced no failures at all — which is why it
  was never counted.

### The finding that matters most

The claim *"the failure direction is the safe one"* sits in **three docblocks** and is **false in
three of the five guards**. This is the project's own named anti-pattern: a false claim in a
comment that reads like evidence.

| guard | claim | measured |
|---|---|---|
| `requirements-ledger` | "both errors are in the safe direction" | **FAIL OPEN** — under desync an obvious caller reads as absent, so a false "no caller" row **passes**. That is precisely the defect the file exists to prevent, produced by the file's own stripper. |
| `trust-anchors` | docblock does flag stripping as dangerous | **FAIL OPEN** — absence guard; over-stripping hides the opt-out and the tree reads clean. Its stated defence is a planted-pair block that plants an *ordinary* comment, never a desync, so the defence does not cover the case. |
| `sovereign-block-refusal` | "can only hide a real call site … fails this scan loudly" | **FAIL OPEN on new call sites** — true for the three pinned files (`toEqual` catches a disappearance), false for a NEW file with a blinded `submitJob(`: `found === expected` and the scan passes. |
| `bench-reduce` | same claim | **FAIL OPEN in its `forbidden` arm** — `forbidden` is a must-NOT-match pattern, so over-stripping makes the requirement pass wrongly. |
| `bench-egress` | same claim | FAIL CLOSED. Claim holds. |

### Blast radius

From the stray `/*` to the next `*/` **anywhere in the file** — not to EOF, not one line. With no
following `*/` the lazy quantifier matches nothing and **nothing is stripped**, so a stray at the
tail of a file is harmless. It is self-correcting after one block comment: the stray consumes both
the opener and closer of the next real docblock.

### Fix — a shared tokenizer, `packages/node/src/strip-comments.ts`

~30 lines tracking line-comment, block-comment and string/template state; comments removed,
string literals **preserved**; newlines inside block comments preserved so line numbers survive.
Then delete all five regex `stripComments` definitions and import the one.

Rejected alternatives, with the project's own reasons: **scanning without stripping** is not
viable (`bin/agent.ts` must be able to say in prose that it carries no opt-out switch, and
`runResilient` is named in comments in four files and called by none — the file would be
permanently red). **A stricter regex** is a parser written badly; `requirements-ledger`'s `[^:]`
is the empirical argument — one special case, added for one input, that covers `https://` and not
`'a // b'`.

Two behaviour changes to expect: `requirements-ledger`'s `https://` case starts passing
*properly* rather than via the `[^:]` hack (delete the hack with the code), and `identity-store`'s
trailing-comment false-red goes away.

**Stated limits, not to be discovered later:** regex literals are not tracked (`/a"b/` could
mis-pair the quote arm), and a backtick inside a template interpolation would end the span early.
Both must be in the docblock — a false claim of totality here would be the same defect this fix
removes.

### Proof — a comparative reading, not a green

A test that only drives the fixed stripper asserts that a working thing works. The proof must hold
**both arms in one run**: keep the old regex beside the new one as `BLINDABLE`, and require every
case to **MISS under `BLINDABLE` and CATCH under `stripComments`, on the same input**.

Seven cases: `//` form; **string-literal form** (live in the tree today); call-site form (the shape
that makes a false REQUIREMENTS row pass); forbidden-pattern form (`bench-reduce`'s arm); blast
radius in *both* directions — with a following `*/` and without — so the fix is not credited with
repairing damage that never occurred; the mirror bug (`'https://x'` and `'a // b'` survive intact,
with the `[^:]` variant as a third arm); and an over-stripping control, because "strip nothing"
passes cases 1–6 and destroys every guard.

Plus mutation-ledger entries, one per fail-open guard, each replacing the import with `BLINDABLE`
and recording the observed red. Without those the new stripper is a guard nobody has watched fail.

### How the #40 fix could fail open

- **Partial migration.** Five call sites; migrating the fail-*closed* ones first leaves the three
  silent misses on the old regex. Do `trust-anchors`, `requirements-ledger` and
  `sovereign-block-refusal` first.
- **`BLINDABLE` deleted as dead code.** It is the only thing that makes the proof a proof. Needs a
  docblock saying so and a case that fails if it is ever made identical to `stripComments`.

---

## #39 — the recorded diagnosis is CORRECT, and the scope is wider than "some guards"

Corroborated independently: `git log --all --grep=O2_SKIP_GUARDS` returns **7** commits. `01a168b`
states the mechanism in the same words; `7717ade` records the canonical instance — *a requirements
row says nothing calls `translationCid`, and the concurrently running 21-01 has just given it a
caller.*

**That instance is the design test for the fix.** Done right: 21-01, who staged the file that
gained the caller, **must be blocked**; the planner, who staged only plan documents, **must not
be**.

**All six guards have the mismatch**, not a subset. Three read the working tree directly
(`purity`, `requirements-ledger`, `slow-specs`), two read `git ls-files` for the *list* but the
working tree for the *contents* (`vocabulary`, `disclosure-gate`), one reads a hand-maintained
file list (`mutation-guard`). `.githooks/pre-commit` does compute `STAGED`, but uses it **only**
as an "is anything staged" gate — nothing downstream ever sees it.

### Fix — option 2, partition findings into own vs foreign

New `packages/node/src/commit-scope.ts` exporting `commitScope()`, `partition()` and
`reportForeign()`. Repo-wide **visibility** is preserved (a foreign violation is still printed —
hiding it would recreate #38, where a guard's trigger was narrower than its corpus and a violation
ran no guard at all); only **blocking** narrows to paths in the current commit.

Four properties carry the whole change:

1. **Absence means STRICT.** Missing, unreadable, or empty scope returns `NO_COMMIT_SCOPE`, and
   `partition` treats that as "every finding is own". A guard run by `npm test`, by a verifier, or
   by a hook whose env did not reach the worker must block on **everything**, never on nothing.
2. **The path list goes through a FILE, not an env var.** Measured on bash 5.3.9: `$( )` over
   NUL-separated output **silently concatenates** — `a.ts` + `b.ts` becomes `a.tsb.ts`, warning on
   stderr only. Every finding would then be foreign and the guards would block on nothing. This is
   the single most dangerous "simplification" available and needs a comment at the assignment site.
3. **The union rule.** A finding is attributed to `paths: readonly string[]` — *every* path that
   participates, not just the one it is reported against. A ledger row broken by a new caller
   names **both** the ledger and the caller. This is the `translationCid` case and it is the real
   fail-open of naïve option 2. A future single `path:` field reopens it silently.
4. **`--diff-filter=ACMRD --no-renames -z`.** Measured on git 2.33.0: `ACMR` **omits deletions**,
   and a deletion is a violation *cause* — deleting a file a ledger entry names breaks that entry.
   Default rename detection prints **only the destination**, so a finding keyed on the old path
   reads as foreign. Without `-z`, an odd path is C-quoted and never matches.

Initial commit: `git rev-parse --verify HEAD` fails; use an explicit
`git hash-object -t tree /dev/null` base.

### `disclosure-gate` is deliberately EXCLUDED — write the reason into the file

Two reasons, and leaving them unwritten would make this look like an oversight. (i)
`TREE.dirs.filter(isUnderDotGithub)` yields a *directory* path and git never stages directories,
so a foreign `.github/` would be permanently foreign and permanently unblocking. (ii) The
constraint is a permanent, irreversible legal event — public hosting is public disclosure, and EPO
and China forfeit permanently. It is the one guard where "somebody else's problem" is not an
acceptable verdict. Its findings are structurally rare (a workflow file appearing, a `deploy`
script), not the shape of an in-flight edit, so excluding it costs ~nothing and removes the
highest-consequence fail-open in the change.

### Residual fail-opens, stated

- **Path-form drift.** Every guard today emits repo-relative POSIX with no leading slash, matching
  `git diff-index`. A future `./` prefix, leading `/`, or Windows separator makes every finding
  foreign — fail-open with **no symptom**. This is the failure mode most likely to actually
  happen. Mitigation: a round-trip assertion in `commit-scope`'s own spec, plus one per guard that
  its `paths` values are all in `git ls-files` form.
- **Deliberate abuse.** `O2_COMMIT_PATHS_FILE=/dev/null` is safe (empty ⇒ strict), but a file
  holding one unrelated path makes everything foreign — a bypass equivalent to `O2_SKIP_GUARDS=1`.
  `reportForeign` should print the scope size so a run that blocked on nothing says so out loud.

### Narrower fallback if the full change looks too broad

Partition **`vocabulary` and `mutation-guard` only**. Those two account for the recorded
`O2_SKIP_GUARDS` commits, they have exact single-path attribution, and they carry none of the
ambiguity of `requirements-ledger`'s union or `slow-specs`'s file-count drift.

---

## Before applying: re-measure

The differential was run at **guard-verdict level** across all 311 tracked source files and **no
verdict currently differs** — `requirements-ledger` `EXPORTED` 435 both ways with 0 symbols
differing, `trust-anchors` 2 hits both ways, `sovereign-block-refusal` the same 3 files. So the
#40 mechanism is live and today's damage is zero; it simply is not overlapping anything a guard
searches for.

**That reading predates Phase 20 wave 1 and Phase 21 wave 2.** Re-run it before applying, or the
fix ships on a stale measurement — and a number that agrees with a theory is not the theory's
proof.
