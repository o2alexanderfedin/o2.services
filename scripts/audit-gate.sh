#!/bin/bash
# The audit lane's verdict, with a dated allowlist instead of a bare pass/fail.
#
# `npm audit --omit=dev --audit-level=high` was the whole lane until 2026-10-05, and it has no
# allowlist of any kind. That is fine while every advisory has a fix, and it stops being fine
# the moment one does not: a lane that cannot be satisfied is a lane nobody reads, and the next
# advisory — a reachable one — hides inside its red.
#
# So this script keeps the refusal and makes the exception cost something. It fails on:
#
#   - an advisory at high or critical severity that `scripts/audit-allowlist.json` does not name
#   - an allowlisted entry whose `until` date has passed
#   - an allowlisted entry that matches nothing any more — a dead exemption is a claim nobody
#     has to justify again, which is how an exemption outlives its reason
#   - an allowlisted id that now appears against a DIFFERENT package than the entry names
#
# ## `npm audit`'s own exit code is not the verdict here, and that is not a shortcut
#
# It exits non-zero whenever it has anything to report, so reading it would reproduce the
# behaviour this script exists to replace. The report is the datum. **But an empty report must
# never read as a clean one**: an audit that could not reach the registry also produces no
# advisories, and this repository has already paid for an absence with no positive control. The
# node program below therefore refuses a report that does not carry `auditReportVersion` and
# `metadata`, before it counts anything.
#
# `packages/node/src/audit-allowlist.node.test.ts` reads the same allowlist file independently
# and holds the synthetic cases for each refusal above. Two readings of one data file, for the
# reason `region-loss-drill-schedule.node.test.ts` gives in its own header: either alone is a
# single point.
set -u

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ALLOWLIST="$REPO_ROOT/scripts/audit-allowlist.json"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

npm audit --omit=dev --json > "$WORK/report.json" 2>"$WORK/audit.err"

node "$REPO_ROOT/scripts/audit-gate.mjs" "$WORK/report.json" "$ALLOWLIST"

VERDICT=$?
if [ "$VERDICT" -ne 0 ] && [ -s "$WORK/audit.err" ]; then
  echo "audit gate: npm audit also wrote to stderr —" >&2
  cat "$WORK/audit.err" >&2
fi
exit "$VERDICT"
