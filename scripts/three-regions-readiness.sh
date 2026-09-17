#!/usr/bin/env bash
# Three Durable Objects — what is ready, what is not, and what is irreversible.
#
# **This script creates nothing and spends no money.** Every reading is a read: three local
# files, and — only with `--account` — one `wrangler deployments list` per configuration, which
# lists and does not deploy. `wrangler dev`, `wrangler deploy` and `curl` against a
# not-yet-existing host appear nowhere in it.
#
# ## Why this exists beside `deploy-hosted.sh` rather than inside it
#
# `deploy-hosted.sh --dry-run` already builds all three configurations, and it is NOT a
# readiness read: it runs the full gate first — typecheck, the unit set, the bundle — which is
# minutes of CPU and answers a different question (*would this build?*). The owner's question
# before an irreversible act is *am I ready, and what would it cost me to be wrong?*, and that
# must be answerable in a second, repeatedly, without a credential. So: a separate read, whose
# only overlap with the deploy script is the allow-list of configurations, which both derive
# from the same three files rather than from a copied list.
#
# ## What it will not do, by construction
#
# **It does not read the billing alert, and it does not pretend to.** `HOST-10` asks that the
# alert precede the first resource; `deploy-hosted.sh` enforces that by REQUIRING
# `--alert-configured <n>` on a configuration's first `--live`, which is a **declaration by the
# operator**, not a check against the account. Nothing in this repository reads alert policies
# from Cloudflare — measured, not assumed — and a script that printed "alert: ok" from a
# declaration would be inventing a reading. So this script prints the ordering, the figures, and
# what is actually known, and says plainly that the alert's state is the one thing here a human
# must confirm in the dashboard.
#
# That is the whole of `HOST-10`'s lesson: its verdict is `Refuted` — permanently unsatisfiable
# for `bootstrap-us`, because the alert did not precede that object and no later alert makes it
# true. The ordering can only be lost once per resource, and three more resources are about to
# exist.
#
# ## Usage
#
#   scripts/three-regions-readiness.sh              # local files only, no credential, no network
#   scripts/three-regions-readiness.sh --account    # also: has each configuration ever deployed?
#
# `--account` needs `CLOUDFLARE_API_TOKEN` and makes one `wrangler deployments list` call per
# configuration. Without it the script still answers every local question and says which
# readings it could not take, rather than leaving them blank.

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PACKAGE="$ROOT/packages/cloudflare"

ACCOUNT=0
while [ $# -gt 0 ]; do
  case "$1" in
    --account) ACCOUNT=1; shift ;;
    -h|--help) awk 'NR>1 && /^#/ {sub(/^# ?/, ""); print; next} NR>1 {exit}' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

# The closed list, one row per region. Held here as three fields rather than a name alone
# because the placement mechanism is what makes the three NOT symmetric, and a reader of this
# output needs to see that difference rather than infer it.
#
# `us` is deliberately first and deliberately marked already-live: it is the object whose
# `HOST-10` ordering was lost, and the row exists so the loss is visible next to the two that
# have not happened yet.
REGIONS=(
  "us|packages/cloudflare/wrangler.jsonc|src/worker.ts|already live"
  "eu|packages/cloudflare/wrangler.eu.jsonc|src/worker-eu.ts|jurisdiction eu — BINDING"
  "sam|packages/cloudflare/wrangler.sam.jsonc|src/worker-sam.ts|locationHint only — best effort"
)

ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
no()   { printf '  \033[31m✗\033[0m %s\n' "$1"; }
huh()  { printf '  \033[33m?\033[0m %s\n' "$1"; }
head_() { printf '\n\033[1m%s\033[0m\n' "$1"; }

FAULTS=0

head_ "The three configurations"

for row in "${REGIONS[@]}"; do
  IFS='|' read -r region config entry placement <<< "$row"
  printf '\n  \033[1m%s\033[0m — %s\n' "$region" "$placement"

  if [ -f "$ROOT/$config" ]; then
    ok "configuration $config"
  else
    no "configuration $config is MISSING"
    FAULTS=$((FAULTS + 1))
    continue
  fi

  if [ -f "$PACKAGE/$entry" ]; then
    ok "entry module $entry"
  else
    no "entry module $entry is MISSING"
    FAULTS=$((FAULTS + 1))
  fi

  # The announced host, read out of the configuration the same way `deploy-hosted.sh` reads it,
  # so the two cannot disagree about which host a region publishes.
  announced="$(
    grep -oE '"ANNOUNCE_MULTIADDRS"[[:space:]]*:[[:space:]]*"[^"]*"' "$ROOT/$config" |
      head -1 | sed 's/.*"\(.*\)"$/\1/' | sed -E 's#^/dns4/([^/]+)/.*#\1#'
  )"
  if [ -n "$announced" ]; then
    ok "announces $announced"
  else
    no "announces nothing — hostedAddresses refuses to build with an empty announce list"
    FAULTS=$((FAULTS + 1))
  fi
done

if [ "$ACCOUNT" = 1 ]; then
  head_ "Which of them already exist on the account"
  if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
    huh "CLOUDFLARE_API_TOKEN is not set, so this section could not be read."
    huh "Re-run without --account for the local half, or export the credential."
  else
    for row in "${REGIONS[@]}"; do
      IFS='|' read -r region config entry placement <<< "$row"
      name="$(grep -oE '"name"[[:space:]]*:[[:space:]]*"[^"]*"' "$ROOT/$config" | head -1 | sed 's/.*"\(.*\)"$/\1/')"
      # Lists deployments. It does not create one. `|| true` because a never-deployed script
      # is not an error — it is the answer.
      found="$(
        cd "$PACKAGE" &&
          WRANGLER_SEND_METRICS=false npx wrangler deployments list --name "$name" 2>/dev/null |
          grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' |
          head -1 || true
      )"
      # **An unreadable answer is reported as unreadable, never as "not deployed".** An
      # instrument that cannot read is not evidence the resource is absent — the same rule
      # `deploy-hosted.sh` states for its own gate, where the consequence is the opposite
      # direction: there it fails toward asking, here it fails toward saying so.
      if [ -n "$found" ]; then
        ok "$region ($name) has a live deployment — its placement is ALREADY FIXED"
      else
        huh "$region ($name): no deployment listed. Either it has never been deployed, or the"
        huh "     credential cannot list it. This script does not distinguish the two."
      fi
    done
  fi
else
  head_ "Which of them already exist on the account"
  huh "not read — pass --account (needs CLOUDFLARE_API_TOKEN) to make one list call per region"
fi

head_ "What the irreversible act costs, and what it forecloses"

cat <<'FACTS'
  ≈ $5/month per always-on object — measured, not guessed: 128 MB ⇒ 331 776 GB-s/month
  against 400 000 included. Three ⇒ ≈ $15/month, which is the whole stated budget.

  TWO REGIONS ALSO WORK, at two thirds the cost. The drill needs only that one region can be
  taken out while others answer. Building all three configurations was deliberate so that N is
  the owner's choice at the last moment rather than a decision baked in earlier.

  An object's location is fixed by its VERY FIRST get() and never moves. A wrong placement is
  not repairable, only replaceable. That is why no agent runs the live deploy.
FACTS

head_ "The billing alert — the one reading this script cannot take for you"

cat <<'ALERT'
  HOST-10 asks that the alert be configured BEFORE the first Durable Object exists. For
  bootstrap-us that ordering was lost on 2026-08-27, permanently: the object exists, its
  creation time is fixed, and no later alert makes the row true. It is the ledger's first
  Refuted verdict.

  It can only be lost once per resource. Two more resources are about to exist.

  Nothing in this repository reads alert policies from Cloudflare. deploy-hosted.sh requires
  --alert-configured <n> on a configuration's first --live, and that argument is YOUR
  DECLARATION of what number means stop -- not a check against the account. Confirm the alert
  in the dashboard yourself before the deploy.

  And Cloudflare's own wording, which is why a number is a signal rather than a ceiling:
  budget alerts are "informational only. It does not cap your usage."
ALERT

head_ "The commands, when you have decided"

cat <<'CMDS'
  scripts/deploy-hosted.sh --live --config packages/cloudflare/wrangler.eu.jsonc  --alert-configured <n>
  scripts/deploy-hosted.sh --live --config packages/cloudflare/wrangler.sam.jsonc --alert-configured <n>

  One --config per invocation; a second on the same command line is refused, so one approval
  cannot become three bills. --alert-configured is required only the first time a given
  configuration goes live.

  Running one of those is the irreversible act. Running THIS script is not.
CMDS

printf '\n'
if [ "$FAULTS" -gt 0 ]; then
  no "$FAULTS local fault(s) above — the configurations are not ready to deploy."
  exit 1
fi
ok "The local half is ready. What remains is a decision and an alert, both yours."
