#!/usr/bin/env bash
#
# The cheap guards — the specs that are fast enough to run on every commit, in ONE place.
#
# ## Why this file exists, and it is a defect this closes rather than tidiness
#
# The list was spelled out inside `.githooks/pre-commit` and nowhere else. When CI's node lane
# was narrowed to `O2_UNIT_ONLY=1` on 2026-08-27 — correctly, for three host-sensitive specs
# that fail on a runner and pass locally — it silently took **three of the seven guards** with
# it, because they cost more than `SLOW_CUTOFF_MS`:
#
#   vocabulary          1 535 ms   ABSENT from CI
#   disclosure-gate                ABSENT from CI
#   reachability-guard  3 483 ms   ABSENT from CI
#
# `disclosure-gate` is the guard that keeps a paid Cloudflare deploy from happening by itself.
# It was rewritten that same day to permit CI at all, and the lane that rewrite enabled could
# not run it. **A guard that is correct and unreached is indistinguishable from one that is
# absent** — the second time that sentence has proved itself here in two days.
#
# ## Why a LIST and not a rule, in a repository that refuses lists
#
# `slow-specs.node.test.ts` exists because *a list maintained beside a rule drifts from the
# rule*, and `SLOW_NODE_SPECS` was rewritten as a derivation for exactly that reason. This list
# is not derivable: what makes a spec a **guard** is what it asserts, not what it costs, and
# the two are unrelated — `reachability-guard` is the slowest of the seven and `purity` among
# the fastest. A derivation would be a proxy, and a proxy is what the disclosure gate itself
# was until yesterday.
#
# So it stays a list, and the drift is prevented by SINGLE-SOURCING instead: the hook and the
# CI workflow both call this script, `slow-specs.node.test.ts` asserts that both do, and it
# asserts the hook spells out no spec path of its own.
#
# ## Two added 2026-09-02, and the gap they close was measured twice in one evening
#
# `acceptance-traceability` and `state-frontmatter` were **outside** this list, and a phase
# addition that evening passed every guard the hook runs — 345/345 green — while leaving the
# ledger inconsistent in two places: a requirement with no traceability row, and a frontmatter
# phase count of 13 against a roadmap holding 14. Neither is visible to any spec that was in
# the list, so the green was accurate about what it covered and silent about the rest. **A
# check that cannot see a defect is not evidence there is none** — the same sentence this file
# already carries about a guard that is correct and unreached.
#
# The cost argument favours them and was measured rather than assumed: `acceptance-traceability`
# 271 ms and `state-frontmatter` 7 ms, against `reachability-guard`'s 3 483 ms already here.
# Roughly a twelfth of what the list already costs. Added on the owner's ruling, not on an
# agent's judgement, because what runs on every commit is a decision with a price on every
# commit.
#
# **Both are load-bearing by plant, not by presence.** `state-frontmatter`: `total_phases`
# 14 -> 13 — the exact defect that walked past the hook — refused with `expected 13 to be 14`,
# `1 failed | 8 passed (9)`. `acceptance-traceability`: the `AUTH-06` traceability row deleted,
# one hunk, one deletion, refused with `expected [ 'AUTH-06' ] to deeply equal []`. Each was
# restored by the surgical inverse of its own edit and `cmp`-verified against a snapshot taken
# immediately before planting, and the set re-read 400/400 afterwards. Adding a spec here
# without watching it refuse something would be adding a name to a list, which is what this
# file's own docblock says a guard is not.
#
# ## NEVER set O2_UNIT_ONLY here
#
# That is the whole hole. `slow-specs.node.test.ts` asserts this file does not mention it.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

# THE LIST. One entry per line, bare paths, nothing else on the line — `slow-specs` parses it
# with exactly that shape, so a path wrapped in flags or quotes would read as absent.
GUARDS="
packages/node/src/vocabulary.node.test.ts
packages/node/src/purity.node.test.ts
packages/node/src/mutation-guard.node.test.ts
packages/node/src/disclosure-gate.node.test.ts
packages/node/src/requirements-ledger.node.test.ts
packages/node/src/slow-specs.node.test.ts
packages/node/src/reachability-guard.node.test.ts
packages/node/src/acceptance-traceability.node.test.ts
packages/node/src/state-frontmatter.node.test.ts
"

# A worktree that was never installed into has no runner. Skip loudly rather than failing:
# this repository's own workflow creates worktrees per agent, and a gate that blocks every
# commit in a fresh one would be removed within a day.
if [ ! -x "$REPO_ROOT/node_modules/.bin/vitest" ]; then
  echo "⏭️  no node_modules/.bin/vitest in $REPO_ROOT — skipping the cheap guards"
  echo "   (run 'npm install' to enable them)"
  exit 0
fi

echo "🔍 cheap guards (vocabulary, purity, mutation-ledger, disclosure, ledgers, reachability, traceability, state)…"

# `--project node` is required — five projects exist, and a bare path argument runs the file
# under all of them. `--silent=true`, not a bare `--silent`: the flag takes an OPTIONAL value,
# so a bare one swallows the next argument as its value and vitest refuses. That is what the
# hook shipped with, which made it refuse every commit including its own.
#
# Word-splitting `$GUARDS` is deliberate and is why it holds bare paths with no spaces.
# shellcheck disable=SC2086
"$REPO_ROOT/node_modules/.bin/vitest" run --project node --silent=true $GUARDS
