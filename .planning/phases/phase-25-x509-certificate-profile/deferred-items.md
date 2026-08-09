# Deferred items — Phase 25

Out-of-scope discoveries, logged rather than fixed. The scope rule this file exists for:
only issues **directly caused by the current task's changes** are auto-fixed; a repo-wide
guard whose reconciliation is explicitly reserved for its own dedicated register is not.

## `reachability-guard.node.test.ts` ceilings — RESOLVED, not deferred after all (2026-08-09, Plan 25-04)

**Originally logged here as deferred**, on the reasoning that
`packages/node/src/reachability-dispositions.ts` and
`packages/node/src/reachability-guard.node.test.ts` sit outside this plan's declared
`files_modified`, and that ceiling changes are that register's own reserved territory
("22-03's register rather than an edit here", `reachability-dispositions.ts:192`).

**That reasoning did not survive contact with the repo's pre-commit hook.** Staging
`packages/core/src/index.ts`'s new barrel export and attempting to commit it triggered the
"cheap guards" pre-commit check, which runs `reachability-guard.node.test.ts` and **refused
the commit outright** — exit 1, both ceiling assertions red (73 vs a stated 67, 47 vs a
stated `OPEN_FINDING_CEILING` of 40), naming all seven of this plan's new exports by symbol
in the failure text. `Never skip hooks... unless the user has explicitly asked for it. If a
hook fails, investigate and fix the underlying issue` governs here, and `O2_SKIP_GUARDS=1`
was not used.

**Fixed instead**, per the guard's own documented protocol for exactly this situation
("A HIGHER number means a new exported-but-uncalled symbol arrived — run the guard and
read the list"): raised `OPEN_FINDING_CEILING` 40 → 47
(`reachability-dispositions.ts:195`) and the sibling ceiling in
`reachability-guard.node.test.ts` 67 → 73, both with a dated docblock addition naming the
seven new symbols and citing `ed25519-backend.ts`'s own docblock for *why* they are
unwired, rather than duplicating that reason as a disposition-register entry that could
drift from the source. **Not** disposed with a `DispositionCause` — a raw ceiling raise,
which is the smaller and more reversible of the two available fixes, and is exactly what
the guard's own comments describe as the ordinary response to a raise.

Committed together with the barrel export in
`feat(25-04): export the Ed25519 dual-port verifier from @o2/core's barrel`.

**Kept in this file, not deleted**, on the same principle `phase-24`'s deferred-items.md
recorded a resolution rather than removing the entry: a ceiling that moved is exactly the
kind of change a later reader benefits from being able to find explained in one place.

## `reachability.node.test.ts` — pre-existing, unrelated to Plan 25-04 (confirmed 2026-08-09)

**Observed** running `npx vitest run --project node packages/node/src/reachability-guard.node.test.ts packages/node/src/reachability.node.test.ts`
before this plan's changes were staged: *"pins the declarations merged by sharing a file
and a name"* — `expected 13 to be less than or equal to 12`. **Verified pre-existing**: the
same assertion fails identically (`13` vs ceiling `12`) on `git stash`, i.e. the tree
immediately before 25-04's commits. Plan 25-04 adds no declaration that shares a file and a
name with another — `ed25519-backend.ts` is a new file with no merged-declaration siblings.
Not this plan's; not fixed here.
