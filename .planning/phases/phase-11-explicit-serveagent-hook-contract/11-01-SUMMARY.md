---
phase: phase-11-explicit-serveagent-hook-contract
plan: 01
subsystem: api
tags: [typescript, agent-options, serveAgent, compile-time-guard, type-safety]

# Dependency graph
requires:
  - phase: phase-9-public-demo
    provides: "the FabricNode.reservedPeerIds wire that fabric-node.ts's reservations hook now states explicitly instead of omitting"
provides:
  - "AgentOptions with all six hooks required, each typed as RealType | named-absence-sentinel"
  - "a compile-time proof (agent-contract.test.ts) that omitting any hook fails tsc --noEmit"
  - "a sentinel-count guard (serve-agent-hooks.node.test.ts) that is also the v1.1 burn-down metric for real hook implementations"
affects: [phase-12-through-21-hook-implementations, any-future-serveAgent-call-site]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Named-absence sentinel: a required field typed as RealType | 'sentinel-literal', where the sentinel states what the code does in the code's own voice rather than what it lacks — same shape as Phase 9's GrantedConsent."
    - "@ts-expect-error as a compile-failure regression proof: a deliberately-incomplete call whose suppression comment itself becomes an error if the property it names is ever widened back to optional."
    - "Structural sentinel-count guard reading production source text via readFileSync, following purity.node.test.ts's precedent, rather than a brittle shape-matching regex."

key-files:
  created:
    - packages/net/src/agent-contract.test.ts
    - packages/node/src/serve-agent-hooks.node.test.ts
  modified:
    - packages/net/src/agent.ts
    - packages/node/src/fabric-node.ts
    - packages/browser/src/browser-node.ts
    - packages/node/src/bin/bench.ts
    - packages/net/src/start-report.test.ts
    - packages/net/src/rendezvous.test.ts
    - packages/net/src/discovery.test.ts
    - packages/net/src/distributed.test.ts
    - packages/net/src/churn.test.ts
    - packages/net/src/sovereign-execution.test.ts
    - packages/node/src/vocabulary.node.test.ts

key-decisions:
  - "The six sentinel literals are used verbatim from 11-CONTEXT.md, no renaming."
  - "recordsFor's real return type is NodeRecords | undefined, not NodeRecords | null — the mechanical ternary rewrite initially dropped the `?? null` conversion the old optional-chaining default was silently doing; caught by tsc during Task 1, not by a human read, and fixed to preserve exact prior behaviour."
  - "vocabulary.node.test.ts's exemption list was extended (Rule 1) to cover 11-01-PLAN.md's own read_first/verification notes, which quote the guard's banned-word list in prose — a pre-existing full-suite failure since the plan file's own commit, unrelated to any code this plan otherwise touches, but blocking a green npx vitest run."

patterns-established:
  - "A hook's absence is a value the call site writes, never an omission the type system tolerates."

requirements-completed: [WIRE-01]

# Metrics
duration: 13min
completed: 2026-07-27
---

# Phase 11 Plan 01: Explicit serveAgent Hook Contract Summary

**`serveAgent`'s six hooks (`authorize`, `index`, `capacity`, `ledger`, `reservations`, `onDispatch`) are now required union types with named-absence sentinel literals (`'serves-unauthenticated'`, `'serves-no-records'`, `'accepts-every-offer'`, `'keeps-no-ledger'`, `'relays-for-nobody'`, `'reports-no-dispatch'`) instead of optional fields with silent defaults — proven by a `@ts-expect-error` compile fixture and a sentinel-count guard, both mutation-tested for real.**

## Performance

- **Duration:** 13 min (2026-07-27T17:08:27Z → 2026-07-27T17:21:20Z)
- **Tasks:** 3/3 completed
- **Files modified:** 13 (11 planned + 1 new guard commit modifying `vocabulary.node.test.ts` for a pre-existing, unrelated fix)

## Accomplishments

- `AgentOptions` in `packages/net/src/agent.ts` widened from six optional hooks to six required unions, each `RealType | 'sentinel-literal'`; the dispatch body now branches on the sentinel string instead of `?.`/`??`.
- All four production call sites (`fabric-node.ts:354`, `browser-node.ts:209`, `bench.ts:123`, `bench.ts:139`) state all six hooks explicitly — five sentinels plus the one real hook each already supplied (`reservations` on `fabric-node.ts`, `onDispatch` on `browser-node.ts`).
- All 13 `serveAgent` call sites across the six net-package test files state all six hooks explicitly; the conditional-spread default-filling pattern (`...(x === undefined ? {} : { x })`) is fully removed from the test suite.
- `agent-contract.test.ts` proves criterion 1 (compile failure naming the hook) with one fully-specified case and six `@ts-expect-error` per-hook-omitted cases.
- `serve-agent-hooks.node.test.ts` proves criterion 2 (every production call site's sentinel count) by reading the three production files' text off disk and counting literal occurrences — this file doubles as the v1.1 sentinel burn-down metric for Phases 12–21.
- Both new guards were mutation-tested for real: a planted regression in each produced the exact expected failure, then was reverted and reconfirmed clean.

## Task Commits

Each task was committed atomically:

1. **Task 1: Define the required six-hook contract and sweep the 4 production call sites** - `42cbad7` (feat)
2. **Task 2: Sweep the six net-package test files that call serveAgent directly** - `23742f2` (test)
3. **Task 3: Build the criterion-1 compile fixture and criterion-2 sentinel-count guard, mutation-test both, run full regression** - `82df80f` (test)

## Files Created/Modified

- `packages/net/src/agent.ts` - `AgentOptions`'s six hooks required, each a `RealType | sentinel` union; dispatch body branches on sentinel
- `packages/net/src/agent-contract.test.ts` - criterion-1 compile-failure proof: 1 fully-specified case + 6 `@ts-expect-error` per-hook-omitted cases
- `packages/node/src/fabric-node.ts` - `serveAgent` call states all six hooks; `reservations: () => node.reservedPeerIds` unchanged
- `packages/browser/src/browser-node.ts` - `serveAgent` call states all six hooks; the real `onDispatch` callback unchanged
- `packages/node/src/bin/bench.ts` - both `serveAgent` calls (requestor, per-worker) state all six sentinels
- `packages/node/src/serve-agent-hooks.node.test.ts` - criterion-2 sentinel-count guard reading production source text
- `packages/net/src/start-report.test.ts`, `rendezvous.test.ts`, `discovery.test.ts`, `distributed.test.ts`, `churn.test.ts`, `sovereign-execution.test.ts` - all `serveAgent` call sites (13 total) state all six hooks explicitly; conditional-spread helpers removed
- `packages/node/src/vocabulary.node.test.ts` - one new `EXEMPT_LINES` entry for `11-01-PLAN.md`'s own quoted banned-word list (pre-existing failure fix, see Deviations)

## Decisions Made

- Sentinel spelling used verbatim from `11-CONTEXT.md` — no renaming, no new mechanism considered (the context document had already ruled out `RealType | undefined` as reintroducing the omission it was meant to close).
- Preserved `(await options.index.recordsFor(...)) ?? null` in the `records` branch rather than dropping it, because `RecordIndex.recordsFor` genuinely returns `NodeRecords | undefined` — the original optional-chaining `?? null` was doing double duty (both the omitted-hook default *and* a real-return-value conversion), and a naive mechanical rewrite would have changed behaviour for a supplied index answering "not found." Caught by `tsc`, not by inspection.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `records` branch lost a value coercion during the mechanical `?.`/`??` → sentinel-branch rewrite**
- **Found during:** Task 1 verification (`npx tsc --noEmit`)
- **Issue:** The plan's described rewrite (`await options.index.recordsFor(...)` on the non-sentinel branch) dropped the `?? null` the original `(await options.index?.recordsFor(...)) ?? null` was performing — `recordsFor` returns `NodeRecords | undefined`, and the response type requires `NodeRecords | null`. This was a genuine behaviour change (undefined would flow to the wire unconverted) caught only by the type checker, not by reading the diff.
- **Fix:** `records: options.index === 'serves-no-records' ? null : (await options.index.recordsFor(request.nodeKey)) ?? null`
- **Files modified:** `packages/net/src/agent.ts`
- **Verification:** `npx tsc --noEmit` clean on this file; `discovery.test.ts` and `sovereign-execution.test.ts` (which exercise `records` with real indexes) pass unchanged.
- **Committed in:** `42cbad7` (Task 1 commit)

**2. [Rule 1 - Bug] Pre-existing, plan-file-caused `vocabulary.node.test.ts` failure**
- **Found during:** Task 3, running the two repo-wide guards (`vocabulary.node.test.ts`, `purity.node.test.ts`) as instructed
- **Issue:** `11-01-PLAN.md` (committed in `64ac6da`, before this execution began) quotes the vocabulary guard's own banned-word list twice in prose ("mining, miner, hashrate, earn, credits, token") — once in its `<read_first>` block, once in its `<verification>` block. `EXEMPT_LINES` had no entry for this file, so the guard flagged 12 violations across 5 banned terms. Confirmed pre-existing by running the same test at `git stash` / prior commits before any of this plan's edits — same 5 failures, same file.
- **Fix:** Added one `EXEMPT_LINES` entry for `.planning/phases/phase-11-explicit-serveagent-hook-contract/11-01-PLAN.md`, phrase `'mining, miner, hashrate, earn, credits, token'` — same shape as the existing `bench.ts` and `ROADMAP.md` entries for the identical situation (a document telling the reader what the rule bans).
- **Files modified:** `packages/node/src/vocabulary.node.test.ts`
- **Verification:** `npx vitest run packages/node/src/vocabulary.node.test.ts packages/node/src/purity.node.test.ts` — 38/38 passing (was 33/38 before the fix).
- **Committed in:** `82df80f` (Task 3 commit)

---

**Total deviations:** 2 auto-fixed (1 bug, 1 pre-existing blocking issue)
**Impact on plan:** Both were necessary to reach a genuinely green full-suite run, which Task 3's own acceptance criteria require. No scope creep — neither touched a hook's behaviour or added a hook implementation.

## Mutation Test Results (the phase's real deliverable)

**Criterion-1 guard (`agent-contract.test.ts`), mutated via `agent.ts`:**
Temporarily reverted `readonly authorize: Authorizer | 'serves-unauthenticated'` to `readonly authorize?: Authorizer`. `npx tsc --noEmit` then reported:
```
packages/net/src/agent-contract.test.ts(54,5): error TS2578: Unused '@ts-expect-error' directive.
```
Line 54 is exactly the `authorize`-omission case's suppression comment. Confirmed the guard fails in the correct direction — the exact regression it exists to catch. Reverted; `diff` against the pre-mutation file byte-identical; `tsc --noEmit` clean again.

**Criterion-2 guard (`serve-agent-hooks.node.test.ts`), mutated via `fabric-node.ts`:**
Temporarily inserted a comment line adjacent to the real `authorize: 'serves-unauthenticated'` call, forcing a second literal occurrence of the string in the file. `npx vitest run packages/node/src/serve-agent-hooks.node.test.ts` then reported:
```
fabric-node.ts: real reservations, five sentinels
AssertionError: expected 2 to be 1
```
Reverted; `diff` against the pre-mutation file byte-identical; the same test then passed 3/3.

Both mutations produced the specific, expected failure — neither guard is vacuous.

## Issues Encountered

None beyond the two auto-fixed items above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `serveAgent`'s six omissions are now individually grep-able (`serve-agent-hooks.node.test.ts` is the burn-down count): `authorize` and `ledger` are sentinel everywhere (0 real implementations); `index` is real at one production call site (`bench.ts`'s worker path uses the sentinel, `fabric-node.ts`/`browser-node.ts` use the sentinel too — no production node currently serves records); `capacity` and `reservations` each have exactly one real production supplier (`fabric-node.ts`'s `reservations`, none for `capacity` yet); `onDispatch` is real only on `browser-node.ts`.
- Phases 12–21 each pick up one hook and change its sentinel-vs-real ratio at named call sites — the mechanism this plan built is what makes that change visible in a diff and checkable by `serve-agent-hooks.node.test.ts` without editing the guard itself (the guard's counts will need updating per phase, which is expected and is the burn-down signal, not a guard health problem).
- Full regression: `tsc --noEmit` clean; `npx vitest run` 115 test files / 1690 tests passing (baseline was 112/1673; the +3 files / +17 tests are exactly the two new guard files, accounting for the dual node+browser project multiplier on the non-`.node.test.ts` file). No regressions.

---
*Phase: phase-11-explicit-serveagent-hook-contract*
*Completed: 2026-07-27*

## Self-Check: PASSED

All 13 files claimed as created/modified verified present on disk. All 3 task commit hashes (`42cbad7`, `23742f2`, `82df80f`) verified present in `git log`.
