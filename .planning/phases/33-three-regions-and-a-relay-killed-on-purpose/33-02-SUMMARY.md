---
phase: 33-three-regions-and-a-relay-killed-on-purpose
plan: 02
subsystem: infra
tags: [cloudflare, durable-objects, wrangler, bash, vitest]

requires:
  - phase: 33-three-regions-and-a-relay-killed-on-purpose
    plan: 01
    provides: euJurisdictionOf, samLocationHint, stubFor's optional third argument, the
      one-call-site guard's two-file allow-list

provides:
  - "Two deployed entry modules (worker-eu.ts, worker-sam.ts) and two build configurations
    (wrangler.eu.jsonc, wrangler.sam.jsonc), each building under --dry-run with no credential"
  - "scripts/deploy-hosted.sh --config <path>, taking exactly one of a closed three-member
    allow-list per invocation, deriving the region label from the SELECTED configuration's own
    entry module rather than from worker.ts unconditionally"
  - "The HOST-10 gate: before the first --live of a never-deployed configuration, an explicit
    --alert-configured <threshold> is required or the run refuses, naming HOST-10 and quoting
    Cloudflare's own budget-alert wording"
  - "hosted-tier-deploy.node.test.ts extended to all three configurations: the four-way
    (config, entry, script-name, object-name) agreement per region, the placement shape pinned
    as source for all three entries, and a .get( call-count floor alongside idFromName's"
  - "OWNER-ACTIONS.md row 2 extended in place with the per-region deploy command and which
    configuration serves which region"

affects: ["33-03", "33-04", "33-05"]

tech-stack:
  added: []
  patterns:
    - "Region descriptor array (REGION_CONFIGS) read once and iterated with it.each, so a
      fourth region is one array row rather than a duplicated block of assertions"
    - "A guard's own docblock is text the guard reads too — any new raw-text count (here,
      .get() ) needs its target file's prose checked for the literal before the count is
      trusted, the same class of hazard 33-01 already recorded for idFromName("

key-files:
  created:
    - packages/cloudflare/src/worker-eu.ts
    - packages/cloudflare/src/worker-sam.ts
    - packages/cloudflare/wrangler.eu.jsonc
    - packages/cloudflare/wrangler.sam.jsonc
  modified:
    - scripts/deploy-hosted.sh
    - packages/node/src/hosted-tier-deploy.node.test.ts
    - .planning/OWNER-ACTIONS.md
    - packages/node/src/reachability.ts
    - packages/node/src/reachability.node.test.ts
    - packages/cloudflare/src/hosted-object.ts
    - vitest.config.ts

key-decisions:
  - "Added worker-eu.ts and worker-sam.ts to reachability.ts's ENTRY_POINTS (6 -> 8). Each is a
    deployed Worker's own \"main\", on the identical footing worker.ts was added under in
    Phase 29 — the orphan-module ceiling in reachability-guard.node.test.ts caught their
    absence within one commit, exactly as it exists to do."
  - "wrangler's --config wants a path relative to the invocation's cwd, and every wrangler call
    in the script runs with cwd=$PACKAGE — so a CONFIG_BASENAME derived from the
    repo-root-relative $CONFIG is threaded into both the rehearsal and the live deploy call,
    rather than passing $CONFIG directly (which would resolve against the wrong root)."
  - "The never-deployed detection and the pre-existing rollback-target read share ONE
    `wrangler deployments list` call, moved earlier in the script — the same output answers
    both \"has this ever been deployed\" and \"what do we roll back to\", so the HOST-10 gate
    costs no second network round trip."
  - "Reworded two hosted-object.ts docblock passages that quoted the literal namespace.get(...)
    call in prose, because this plan's new .get( raw-text count would otherwise read 3 instead
    of 1. Wording only; no call site moved."

requirements-completed: []  # HOST-06 spans plans 01-03; the ledger's "is created" text is still
  # ahead of the tree, exactly as 33-01-SUMMARY.md's Requirements Ledger section explains. Left
  # unmarked here for the same reason, unchanged from wave 1.

duration: ~50min
completed: 2026-09-13
---

# Phase 33 Plan 02: Two More Region Configurations and an Owner Script That Deploys One at a Time Summary

**Two deployed entry modules and two build configurations for `eu` (jurisdiction-bound) and `sam` (hint-only) regions, an owner script extended to select exactly one configuration per invocation and refuse a never-deployed region's first live deploy until a billing-alert threshold is stated, and a deploy guard that now reads all three configurations' four-way agreement rather than one.**

## Performance

- **Duration:** ~50 min
- **Tasks:** 3 completed
- **Files modified:** 11 (4 created, 7 modified)

## Accomplishments

- `packages/cloudflare/src/worker-eu.ts` narrows the namespace with `euJurisdictionOf` before
  siting (`stubFor(euJurisdictionOf(env.BOOTSTRAP), SERVED_BY)`), with a docblock recording the
  measured fact that this entry cannot be exercised under a local `wrangler dev` at all — a
  local `workerd` throws `Jurisdiction restrictions are not implemented in workerd.` for every
  value, so its only local verifications are the `--dry-run` build and plan 33-01's spy-namespace
  cases.
- `packages/cloudflare/src/worker-sam.ts` sites on the plain namespace carrying only a hint
  (`stubFor(env.BOOTSTRAP, SERVED_BY, samLocationHint())`), documenting that the platform
  validates no hint value at all (measured: `{ locationHint: 'notareal' }` returned a live
  stub) — the closed set in `hosted-object.ts` is the only refusal that exists.
- `wrangler.eu.jsonc` and `wrangler.sam.jsonc` copy every key from `wrangler.jsonc` with only
  `name`, `main` and `ANNOUNCE_MULTIADDRS`'s host differing (each host is exactly the
  configuration's own `"name"` plus `.af-4a0.workers.dev`); no `O2_REGION` var in either.
  All three configurations build under `wrangler deploy --dry-run` with `CLOUDFLARE_API_TOKEN=''`
  and no other credential: exit 0, ~2074 KiB each (`worker.js`, `worker-eu.js`, `worker-sam.js`
  — wrangler names the emitted file after `main`'s own basename, not uniformly `worker.js`).
- `scripts/deploy-hosted.sh` gained `--config <path>` (a closed three-member allow-list, a
  second `--config` on one invocation refused non-zero), derives `SERVED_BY` from the
  *selected* configuration's own `"main"` entry module, and gates the first `--live` of a
  never-deployed configuration behind an explicit `--alert-configured <threshold>` — refusing
  otherwise with `HOST-10` named and Cloudflare's own `"informational only. It does not cap
  your usage."` quoted, plus the exact `$5`/`$15`/two-thirds figures already in
  `OWNER-ACTIONS.md` row 2 (no new numbers invented). `--dry-run` reads no account state and
  needs neither the argument nor a credential. Three `--dry-run` invocations in one session
  produced three different region labels: `bootstrap-us`, `bootstrap-eu`, `bootstrap-sam`.
- `hosted-tier-deploy.node.test.ts` grew from 27 to 37 cases: `emittedBundleFor(configFile)`
  memoises one build per configuration; one `it.each` case per region asserts the four-way
  (`name`/`main`/`SERVED_BY`/`ANNOUNCE_MULTIADDRS` host) agreement plus the shared
  `preview_urls`/`workers_dev`/`class_name`/`new_sqlite_classes`/no-owner-prefix checks; four
  new cases pin each entry's placement shape as source, including the case that refuses a
  future "tidy the three into symmetry" edit on `worker.ts`; a new `.get(` call-count case
  holds `hosted-object.ts` at exactly one siting call now reached by three explicitly different
  argument shapes; the dry-run envelope case is now `it.each`-parameterised over all three
  configurations.
- `OWNER-ACTIONS.md` row 2 extended in place (no new row, no new top-level heading) with a
  configuration-to-region table, the exact `--live --config … --alert-configured <n>` command
  per new region, and the statement that the first `get()` remains the irreversible act.

## Task Commits

1. **Task 1: Two entry modules and two deploy configurations, each visibly its own placement** - `6c3f757` (feat)
2. **Task 2: One region per invocation, and the alert's state read before the first spend** - `3a1c1de` (feat)
3. **Task 3: Extend the deploy guard to all three configurations, and watch it fail** - `11cb197` (test)

## Files Created/Modified

- `packages/cloudflare/src/worker-eu.ts` — created: the `eu` region's deployed entry
- `packages/cloudflare/src/worker-sam.ts` — created: the `sam` region's deployed entry
- `packages/cloudflare/wrangler.eu.jsonc` — created: the `eu` deploy configuration
- `packages/cloudflare/wrangler.sam.jsonc` — created: the `sam` deploy configuration
- `scripts/deploy-hosted.sh` — `--config` allow-list, per-configuration region derivation, the
  `HOST-10` gate, `--config` threaded into both wrangler invocations
- `packages/node/src/hosted-tier-deploy.node.test.ts` — 27 → 37 cases (see above)
- `.planning/OWNER-ACTIONS.md` — row 2 extended in place
- `packages/node/src/reachability.ts` — `ENTRY_POINTS` 6 → 8 (Rule 1)
- `packages/node/src/reachability.node.test.ts` — three hardcoded counts moved 6→8, 6→8, 9→11 (Rule 1)
- `packages/cloudflare/src/hosted-object.ts` — two docblock passages reworded (Rule 1)
- `vitest.config.ts` — `tests` 3802 → 3812, `files` unchanged at 263; `unitTests`/`unitFiles` unchanged

## Decisions Made

- `worker-eu.ts` and `worker-sam.ts` were added to `reachability.ts`'s `ENTRY_POINTS`. Both are
  deployed Workers' own `"main"` modules — the identical shape `worker.ts` was added under in
  Phase 29 — and the orphan-module ceiling in `reachability-guard.node.test.ts` caught their
  absence within the same commit that introduced them, which is exactly the property that
  guard exists to hold.
- `CONFIG_BASENAME` (derived from `$CONFIG`) rather than `$CONFIG` itself is passed to every
  `wrangler --config` invocation, because every wrangler call in the script runs with
  `cwd="$PACKAGE"` and wrangler's `--config` is resolved relative to the invocation's own cwd,
  not the repo root.
- The `HOST-10` never-deployed detection reuses the same `wrangler deployments list` call the
  script already made for the rollback-target read, moved earlier in the script — one network
  round trip answers both questions rather than two.
- Two `hosted-object.ts` docblock passages that quoted the literal `namespace.get(...)` call in
  prose were reworded (not the code) because this plan's new `.get(` raw-text count would
  otherwise read 3 instead of 1 — the same class of hazard 33-01's SUMMARY already recorded for
  `idFromName(`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `ENTRY_POINTS`'s new members were absent from `reachability.node.test.ts`'s three hardcoded counts**
- **Found during:** Task 3 (running the full node project once, per this repo's own convention, to derive `vitest.config.ts`'s counts)
- **Issue:** `packages/node/src/reachability.node.test.ts` hardcodes `ENTRY_POINTS.length === 6`, `built.roots.length === 6`, and a wider-graph `wider.roots.length === 9` — all three dated 2026-08-26 against the six-member set. Task 1 raised `ENTRY_POINTS` to 8 members, and all three assertions reddened in the full run (`packages/node/src/reachability-guard.node.test.ts`, the DIFFERENT file with the orphan-module ceiling, was already caught and fixed in Task 1's own commit — this is a second, separate file with its own hardcoded counts).
- **Fix:** Updated the three literals to 8, 8 and 11 (8 + the same three runnable-but-absent modules already named in that case), with dated notes matching the file's existing convention.
- **Files modified:** `packages/node/src/reachability.node.test.ts`
- **Verification:** `npx vitest run --project node packages/node/src/reachability.node.test.ts` — 37/37, up from 3 failures.
- **Committed in:** `11cb197` (Task 3 commit)

**2. [Rule 1 - Bug] `hosted-object.ts`'s own prose tripped this plan's new `.get(` call-count case**
- **Found during:** Task 3, writing the `.get(` count case
- **Issue:** Two docblock passages (added by plan 33-01) quote the literal `namespace.get(id, ...)` call in prose to describe measured platform behaviour. A raw `source.match(/\.get\(/g)` count — the same style the pre-existing `idFromName(` count already uses — read 3 instead of 1.
- **Fix:** Reworded both passages to describe the mechanism without the literal call syntax (e.g. "obtaining a stub with an explicit `undefined` in that position" rather than `namespace.get(id, undefined)`). No code or call site changed.
- **Files modified:** `packages/cloudflare/src/hosted-object.ts`
- **Verification:** `grep -c '\.get(' packages/cloudflare/src/hosted-object.ts` returns 1; full test file 37/37.
- **Committed in:** `11cb197` (Task 3 commit)

**3. [Rule 1 - Bug] a comment's word choice tripped the cryptojacking-vocabulary guard as a singular inflection of one of its five banned terms**
- **Found during:** Task 2's commit attempt
- **Issue:** `vocabulary.node.test.ts` flags every inflection of five banned terms; a `deploy-hosted.sh` comment explaining the new `while`/`shift` argument loop used a word whose plural is one of the five, read as cryptocurrency vocabulary by the same instrument meant to catch it hiding in prose.
- **Fix:** Reworded the comment to avoid the word entirely. No behavior change.
- **Files modified:** `scripts/deploy-hosted.sh`
- **Verification:** `npx vitest run --project node packages/node/src/vocabulary.node.test.ts` — 26/26.
- **Committed in:** `3a1c1de` (Task 2 commit)

---

**Total deviations:** 3 auto-fixed (all Rule 1, all discovered via this plan's own verification commands or the repo's stated full-sweep convention, none changing runtime behavior of anything outside the file it was found in).
**Impact on plan:** No scope creep. Two fixes are prose-only corrections to guards this plan's own new checks made visible; the third is a wording fix to a comment this plan added. No guard was weakened.

## Issues Encountered

**Pre-existing, out-of-scope `tsc -p packages/cloudflare` gap — unchanged from 33-01, re-confirmed rather than re-investigated.** `npx tsc --noEmit -p packages/cloudflare` still reports the same 6 `TS2339: Property 'o2' does not exist` errors `deferred-items.md` already logs from wave 1, in the same two files this plan does not touch (`stop-closes-the-billed-socket.e2e.test.ts`, `e2e-signin.ts`). Diffed against the pre-plan-02 tree: byte-identical error list. `npx tsc --noEmit -p .` (the whole workspace) exits 0 after all three of this plan's commits — the meaningful signal, per 33-01's own resolution of this same question. Not re-logged to `deferred-items.md` since it is the identical, already-recorded finding.

**A dated, calendar-based `requirements-ledger.node.test.ts` failure (`AOT-03`, unrelated to this plan) surfaced by the required full-sweep count.** Same finding every commit's own pre-commit guard already reported as "1 finding(s) outside this commit — reported, not blocking" throughout this session. Confirmed unrelated: it names `tools/aot/cross-host-lift.node.test.ts` and two sibling AOT specs, nothing in `packages/cloudflare` or this plan's files.

**`closed-fabric-agents.node.test.ts` failed only in the full `--project node` sweep, whose own banner reported the host OVERSUBSCRIBED (load/core 5.79 against an 8-core, 4.00-ceiling host).** Re-run alone on a quiet host: 7/7 passed. Attributed by measurement (isolated re-run), not by plausibility, per `CLAUDE.md` § Measurement.

## Plant Proofs (Task 3's three required plants, sequential, `git status --porcelain` read clean before and after each)

**Plant 1 — the address disagreement, isolating the `eu` four-way-agreement case.**
- Snapshot: `cp packages/cloudflare/wrangler.eu.jsonc` to a scratchpad path outside the repo.
- Plant: changed `wrangler.eu.jsonc`'s `ANNOUNCE_MULTIADDRS` host from `o2-bootstrap-eu…` to `o2-bootstrap-sam…`.
- Observed (named in advance, and this is what reddened): `FAIL … the three configurations agree with their own entry modules, on all four counts > 'wrangler.eu.jsonc': name, main, SERVED_BY and the announced host all name the same region` — `AssertionError: expected … to match /"ANNOUNCE_MULTIADDRS":\s*"\/dns4\/o2-bootstrap-eu\.af-4a0\.workers\.dev\//`. 36/37 passed; exactly the named case reddened.
- Restoration: reversed the exact host string. `cmp` against the pre-plant snapshot: byte-identical. Re-run: 37/37.

**Plant 2 — the import-only edit, the one that isolates the new claim from the pre-existing one.**
- Snapshot: `cp packages/cloudflare/src/worker.ts` to a scratchpad path.
- Plant: added `euJurisdictionOf` to `worker.ts`'s import list — nothing else changed, `stubFor`'s call site untouched.
- Observed (named in advance): `FAIL … HOST-06 — each region places its object through a differently-shaped call, pinned as source > the us entry is unwrapped … > AssertionError: expected '…' not to contain 'euJurisdictionOf'`. 36/37 passed. The pre-existing `stubFor(env.BOOTSTRAP, SERVED_BY)` case (`derives no object name from a request`) stayed GREEN — confirming it is blind to an import-only edit, which is exactly why the new case was needed.
- Restoration: not yet — plant 3 builds on this one, per the plan's own sequencing instruction.

**Plant 3 — the wrapped argument, for the pre-existing case.**
- Plant (on top of plant 2): also wrapped `stubFor`'s call to `stubFor(euJurisdictionOf(env.BOOTSTRAP), SERVED_BY)`.
- Observed (named in advance, and it reddened a second case too — expected, not a blind-instrument finding, since both assert the identical unwrapped string): `FAIL … HOST-08 and HOST-12 … > derives no object name from a request > AssertionError: expected '…' to contain 'stubFor(env.BOOTSTRAP, SERVED_BY)'` AND `FAIL … HOST-06 … > the us entry is unwrapped … > AssertionError: expected '…' to contain 'stubFor(env.BOOTSTRAP, SERVED_BY)'`. 35/37 passed.
- Restoration: reversed both the wrapped call and the import, in that order (the surgical inverse of both edits together). `cmp` against the plant-2 snapshot (taken before EITHER edit): byte-identical; `git diff --stat -- packages/cloudflare/src/worker.ts` empty. Re-run: 37/37.

No plant stayed green; no plant reddened a case other than the one named in advance for it (plant 3's second reddened case was itself named — the plan's own wording only required the pre-existing case "as well as" the new one, not "only").

## User Setup Required

None — no external service configuration required. Every task in this plan was `agent-now`.
`--live` was never invoked; `OWNER-ACTIONS.md` row 2 already carries the exact command for
whoever runs the real deploy once the budget and alert are approved.

## Next Phase Readiness

- `wrangler.eu.jsonc` and `wrangler.sam.jsonc` build clean, and `scripts/deploy-hosted.sh
  --config <path> --dry-run` rehearses either without a credential — ready for plan 33-03's
  negative-proof spec, which reads `hosted-object.ts`'s `DurableObjectJurisdiction` directly
  and does not touch either new configuration.
- The `--config` allow-list is a literal three-member array in the script; a fourth region
  needs a source edit there in addition to the two files `HOSTED_OBJECT_NAME`'s own docblock
  already names.
- `HOST-10`'s gate is written and its refusal text is guard-tested for its literal content, but
  the live path (`--live` against a never-deployed configuration) is necessarily untested here
  — `--live` is prohibited in this plan and needs the owner's credential and alert.
- `hosted-tier-deploy.node.test.ts`'s two-file `idFromName` allow-list still holds at exactly
  two, confirmed by direct measurement (`git ls-files '*.ts' | xargs grep -l idFromName`)
  rather than assumed — no third file appeared, and none of this plan's new entry modules calls
  it directly (they all go through `stubFor`).

---
*Phase: 33-three-regions-and-a-relay-killed-on-purpose*
*Completed: 2026-09-13*

## Self-Check: PASSED

- FOUND: `packages/cloudflare/src/worker-eu.ts`
- FOUND: `packages/cloudflare/src/worker-sam.ts`
- FOUND: `packages/cloudflare/wrangler.eu.jsonc`
- FOUND: `packages/cloudflare/wrangler.sam.jsonc`
- FOUND: `scripts/deploy-hosted.sh`
- FOUND: `packages/node/src/hosted-tier-deploy.node.test.ts`
- FOUND: `.planning/OWNER-ACTIONS.md`
- FOUND: `packages/node/src/reachability.ts`
- FOUND: `packages/node/src/reachability.node.test.ts`
- FOUND: `packages/cloudflare/src/hosted-object.ts`
- FOUND: `vitest.config.ts`
- FOUND commit: `6c3f757` (Task 1)
- FOUND commit: `3a1c1de` (Task 2)
- FOUND commit: `11cb197` (Task 3)
