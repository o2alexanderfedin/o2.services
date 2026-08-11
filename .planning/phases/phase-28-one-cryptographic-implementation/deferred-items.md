# Phase 28 — deferred items

Out-of-scope discoveries logged rather than fixed, per CLAUDE.md's scope boundary
(only issues DIRECTLY caused by the current task's changes are auto-fixed).

## 1. `demo-viewport.e2e.test.ts` B5 fails at 393 CSS pixels — pre-existing, attributed by measurement

**Found during:** Plan 28-02, the full `--project e2e` run (the first full e2e run this
phase has recorded; 28-01 verified `node` and `browser` in full but ran only targeted
e2e files, so this failure was carried, not introduced).

**Failure, verbatim:**

```
FAIL  |e2e| packages/node/src/demo-viewport.e2e.test.ts > UI-SPEC section 6.3 — the bar fits, and Stop is reachable > holds B1-B7 at 393 CSS pixels, in both bar states
AssertionError: B5 393px / idle / surface 5 of 6: at the end of the page, #main's last child (section#s-fabric) has its bottom at y=953.03, below #bar's top at y=632.41 — the bar covers it: expected 953.03125 to be less than or equal to 632.40625
 ❯ packages/node/src/demo-viewport.e2e.test.ts:668:13
```

**Attributed by measurement, not by plausibility** (CLAUDE.md § Measurement: *"'passes in
isolation' is a claim to verify, not a diagnosis"*). A two-arm control was run on
2026-08-10, both arms a single-file `--project e2e` run of the spec:

| Arm | `libsodium-wrappers` state | Result |
|---|---|---|
| A | removed (this plan's end state) | 1 failed / 6 passed, y=953.03 vs y=632.41 |
| B | reinstalled via `npm install`, `node_modules/libsodium-wrappers` present | 1 failed / 6 passed, y=953.03 vs y=632.41 |

Byte-identical assertion text in both arms. The failure is therefore independent of
Plan 28-02's dependency removal. Arm B was created by the surgical inverse of this plan's
own one-line manifest edit and reverted the same way; `packages/core/package.json` and
`package-lock.json` were both `cmp`-verified byte-identical to their pre-experiment
snapshots afterwards, and the bare-specifier resolution throws again.

**Not fixed here.** It is a demo-page layout defect in `packages/browser/demo/` — the
`#s-fabric` section overflows under `#bar` at a 393 px viewport — and belongs to whoever
owns the UI-SPEC section 6.3 surface. Nothing in Phase 28's scope touches demo layout.

**Note for the next agent who runs the full e2e project:** it is **not** green on
`feature/phase-28-one-cryptographic-implementation`. Baseline as measured on 2026-08-10:
**28 files, 1 failed / 27 passed; 183 tests, 1 failed / 182 passed**, `real 455.10`.

> **CLOSED 2026-08-10 — this item is fixed and the note above is superseded.** The B5
> failure was repaired on this branch by `dde1ff5`/`f42e985`: the instrument read the box
> geometry two frames after scrolling and the page grew 703 px into that gap. Plan 28-03
> recorded the first whole-project e2e run after the fix, and **Plan 28-04 re-measured it
> independently: 28 files, 183 passed, exit 0, `real 468.53`, `(user+sys)/real` 0.51.** The
> low CPU ratio is expected rather than a starvation reading — e2e is Playwright-driven with
> `fileParallelism: false`, so the process spends most of `real` waiting on browsers and
> servers. The repair is **not** Phase 28 work and this phase does not claim it; it is
> recorded here only because this file is where the red baseline was written down, and a
> deferred item that is silently fixed elsewhere is how a stale "known red" outlives the
> defect. **Phase 27 merged with `--project e2e` red** because every invocation across its
> ten summaries was file-scoped, which is the reading this item exists to prevent repeating.

## 2. `npm audit` reports 1 high-severity advisory — pre-existing, unrelated

`npm install` printed "1 high severity vulnerability" both before and after this plan's
removal. Identified as `nanoid` (GHSA-2v37-7h3g-55p8, "custom generators can loop
indefinitely when size is zero"), a transitive dependency with no relationship to
libsodium. Vulnerability counts were unchanged by the removal
(`{"info":0,"low":0,"moderate":0,"high":1,"critical":0,"total":1}`). Not addressed —
out of scope for a crypto de-duplication phase.

## 3. `packages/core/src/index.ts:401-402` still quotes the pre-merge barrel price

**Found during:** Plan 28-04, Task 1, while writing `CRYPTO-03`'s verdict.

The comment records the cost of barrel-exporting the certificate-lifecycle facades as
**"75 → 87 and OPEN_FINDING_CEILING 49 → 61"**. Both left-hand figures are pre-merge.
Plan 28-01 lowered the unreachable ceiling 75 → 73 and `OPEN_FINDING_CEILING` 49 → 47, and
Plan 28-04 re-derived both against the live tree on 2026-08-10 and read **73 unreachable of
225 callable barrel exports, 26 disposed, 47 open**, each sitting exactly at its bound. So
the same `+12` price is today **73 → 85 and 47 → 59**.

**Not fixed here.** `packages/core/src/index.ts` is outside this plan's `files_modified`
(`.planning/REQUIREMENTS.md` only), and the drift is in a comment rather than in an
assertion — nothing goes red because of it, which is precisely the 19-12 shape the
repository already has a name for. It is recorded in the `CRYPTO-03` traceability row as
well as here, so the next agent to touch that barrel finds it stated rather than having to
re-find it.

**This is the third copy of the same triple.** `reachability-guard.node.test.ts:350` was
corrected by Plan 28-01, `.planning/REQUIREMENTS.md`'s WIRE-02 row by Plan 28-04, and this
one is still open. A figure duplicated into three places drifts in three places.

## 2026-08-10 — nine copies of `capability.ts:219`, re-cited by symbol

**Found during:** the goal-backward verification of phases 26, 27 and 28
(`28-VERIFICATION.md`'s first INFO row), and corrected in the pass that follows it.

**The true line is `capability.ts:249`, re-measured in this pass** —
`valid = ed25519.verify(fromHex(link.signature), payload, fromHex(link.issuer))`, inside
`verifyChain`, which begins at `:209`. The other five sites in the same list were checked and
were all still right: `enrollment.ts:702` (`EnrollmentAuthority.redeemChallenge`), `:740` and
`:759` (`EnrollmentAuthority.enrol`), `:874` (`verifyCertificate`), `discovery.ts:122`
(`verifyCapabilityRecord`). One number in six drifted, and it drifted **30 lines in the same
commit that wrote the citation** — `31b64a6` moved `toBase64Url`/`fromBase64Url` into
`capability.ts` while 28-01 was writing the docblock that cited it.

**Direction chosen: replace the line numbers with symbols, not just correct the digits.**
Phase 27 converted its ledger citations to greppable symbols for exactly this reason, and
this was the third `file:line` drift of the verification run. A symbol survives the next
move; a line number is a claim about a file's layout that nothing re-measures and nothing
reddens. All six sites are now cited as `verifyChain` / `redeemChallenge` / `enrol` (twice) /
`verifyCertificate` / `verifyCapabilityRecord`, with the old number preserved beside the
correction so the drift is visible rather than erased.

**Nine live copies, not eight.** The verification named eight; a tenth grep in this pass found
one more in a source file — `packages/core/src/ed25519-backend.test.ts:177`, in the docblock
telling a future wiring pass which call sites to replace, which is the citation most likely to
be acted on. Fixed with the other eight.

**Three further copies are left alone, deliberately, and this is the line drawn.**
`25-04-PLAN.md:555`, `25-04-PLAN.md:601` and `25-04-SUMMARY.md:14` also say
`capability.ts:219` — and they were **true when they were written**, before `31b64a6` existed.
Phase 28's copies were wrong from the hour they were typed; correcting those restores what
their authors meant. Editing a Phase 25 record to reflect a commit that had not happened yet
would be rewriting an accurate history to match a later tree, which is a worse defect than the
one being fixed. Anyone grepping the string will find them, and will find this note.

**The pattern.** Six documents in this correction pass claimed more than their code. **Three
of the six were `file:line` citations that had drifted**, and this one was stale in the same
commit that wrote it — then copied to eight further places before anybody re-read it. A line
number is a measurement that expires silently; a symbol is one that does not.
