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
"

# A worktree that was never installed into has no runner. Skip loudly rather than failing:
# this repository's own workflow creates worktrees per agent, and a gate that blocks every
# commit in a fresh one would be removed within a day.
if [ ! -x "$REPO_ROOT/node_modules/.bin/vitest" ]; then
  echo "⏭️  no node_modules/.bin/vitest in $REPO_ROOT — skipping the cheap guards"
  echo "   (run 'npm install' to enable them)"
  exit 0
fi

echo "🔍 cheap guards (vocabulary, purity, mutation-ledger, disclosure, ledgers, reachability)…"

# `--project node` is required — five projects exist, and a bare path argument runs the file
# under all of them. `--silent=true`, not a bare `--silent`: the flag takes an OPTIONAL value,
# so a bare one swallows the next argument as its value and vitest refuses. That is what the
# hook shipped with, which made it refuse every commit including its own.
#
# Word-splitting `$GUARDS` is deliberate and is why it holds bare paths with no spaces.
# shellcheck disable=SC2086
"$REPO_ROOT/node_modules/.bin/vitest" run --project node --silent=true $GUARDS
