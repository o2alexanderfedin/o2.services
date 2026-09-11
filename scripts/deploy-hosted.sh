#!/usr/bin/env bash
#
# Deploy the hosted node to Cloudflare Workers — the same steps locally and in CI.
#
# ## Why this exists as a script rather than as workflow steps
#
# The steps lived only in `.github/workflows/deploy.yml`, which meant they could not be run
# or rehearsed anywhere else, and they DRIFTED: `ci.yml` was corrected to run the unit set
# after three CI failures on host-sensitive specs, and `deploy.yml` was left running the full
# `test:node` — the same three specs, the same failure, in the one workflow where failing
# costs the most. Two copies of a procedure diverge; one copy cannot.
#
# ## The safety properties, each of which is checked rather than assumed
#
# 1. **`--dry-run` is the default.** A real deploy needs `--live`, spelled out. Cloudflare has
#    no hard spending ceiling — its own wording for budget alerts is "informational only. It
#    does not cap your usage."
# 2. **The account's other scripts are never touched.** The name is read from
#    `wrangler.jsonc` and asserted against a refusal list before anything runs. Three
#    production `ocr-checks-worker*` scripts live on this account.
# 3. **The identity is read back after a live deploy, and a change is a FAILURE.** A deploy
#    that mints a new PeerId is Phase 29 criterion 2's silent failure: nothing else notices,
#    and every peer holding the old address is now dialling a node that no longer answers to
#    it.
# 4. **The gate runs before the deploy, in this order**: typecheck, the unit set, the bundle
#    build. A red suite cannot be deployed past, and the ordering is the control rather than
#    a preference.
# 5. **A node this deploy cannot STOP is not deployed, and if it somehow is, the run goes red.**
#    Added 2026-09-07, and it is a repair rather than a precaution. The deployed object was
#    measured that day with `region: null` and no operator key — both halves of RUN-02's kill
#    switch absent — on a node that had already relayed 143 connections for real people. It had
#    been that way since the first deploy and nothing had ever said so, because **this script
#    verified exactly what it injected**: the version it passed as a `--var`, and a PeerId that
#    is stable by construction. The kill switch was neither injected nor read back, so it was
#    invisible in the one place that looks. Three changes close it: the region label is DERIVED
#    from `SERVED_BY` rather than typed by whoever remembers, the operator key is required
#    before a single request is spent, and `killSwitch.operable` is read back off the deployed
#    node afterwards.
#
# ## Usage
#
#   scripts/deploy-hosted.sh                 # dry run: gate + build, deploys nothing
#   scripts/deploy-hosted.sh --live          # the real thing
#   scripts/deploy-hosted.sh --live --skip-tests   # only when the gate just ran; says so loudly
#   scripts/deploy-hosted.sh --verify-only   # read the deployed node's identity and stop
#
# There is no `--region` flag, deliberately. See "Which region this deployment labels itself
# with" below: a flag is a thing that can be forgotten, and forgetting it is the defect this
# script now exists to make impossible.
#
# Requires `CLOUDFLARE_API_TOKEN` for `--live`. `--dry-run` needs no credential — measured, it
# exits 0 on a machine with none configured.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

PACKAGE="packages/cloudflare"
CONFIG="$PACKAGE/wrangler.jsonc"

# The account's other scripts, by prefix. Refused rather than merely documented: the whole
# cost of getting a name wrong here is somebody else's production worker.
FORBIDDEN_PREFIX='ocr-checks-worker'

LIVE=0
SKIP_TESTS=0
VERIFY_ONLY=0

for arg in "$@"; do
  case "$arg" in
    --live) LIVE=1 ;;
    --dry-run) LIVE=0 ;;
    --skip-tests) SKIP_TESTS=1 ;;
    --verify-only) VERIFY_ONLY=1 ;;
    # Every leading comment line, stopping at the first that is not one. A line range drifts
    # the moment the header grows — and it had, silently, before this was written.
    -h|--help) awk 'NR>1 && /^#/ {sub(/^# ?/, ""); print; next} NR>1 {exit}' "$0"; exit 0 ;;
    *) echo "❌ unknown argument: $arg" >&2; exit 2 ;;
  esac
done

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

# ---------------------------------------------------------------------------
# What is being deployed, read from the configuration rather than hardcoded
# ---------------------------------------------------------------------------

if [ ! -f "$CONFIG" ]; then
  echo "❌ $CONFIG not found — is this the right repository?" >&2
  exit 1
fi

# `wrangler.jsonc` carries comments, so `node --experimental-strip-types` is not enough and a
# JSON parser is not either. The name is a single quoted field; grep is exact enough for it
# and adds no dependency.
SCRIPT_NAME="$(grep -oE '"name"[[:space:]]*:[[:space:]]*"[^"]+"' "$CONFIG" | head -1 | sed 's/.*"\([^"]*\)"$/\1/')"

if [ -z "$SCRIPT_NAME" ]; then
  echo "❌ could not read \"name\" from $CONFIG" >&2
  exit 1
fi

case "$SCRIPT_NAME" in
  "$FORBIDDEN_PREFIX"*)
    echo "❌ REFUSED: '$SCRIPT_NAME' matches the account's production prefix '$FORBIDDEN_PREFIX'." >&2
    echo "   Those three scripts are not this repository's to deploy." >&2
    exit 1
    ;;
esac

# ---------------------------------------------------------------------------
# Which region this deployment labels itself with — DERIVED, never typed
# ---------------------------------------------------------------------------
#
# **There is no `--region` flag and there must not be one.** The label is read out of
# `worker.ts`'s `SERVED_BY`, which is the constant the fetch handler passes to `stubFor` — so it
# is not a name somebody chose for this deploy, it is *the name every request that reaches this
# object was routed under*. Deriving it makes two values one:
#
#   - a flag can be forgotten, and on 2026-09-07 it had been, on every deploy there had ever
#     been. `.github/workflows/deploy.yml` runs this script with no arguments but `--live`, so
#     a required flag would have had to be remembered in two places instead of none.
#   - a flag can be WRONG in a way nothing catches. `O2_REGION` is the label a halt is addressed
#     to and `SERVED_BY` is the object that receives the traffic; a deploy that labelled the
#     object `bootstrap-eu` while routing to `bootstrap-us` would answer every reading correctly
#     and refuse every halt an operator ever sent it.
#
# Narrowed against the same closed set `narrowRegion` narrows against, read from the same file
# that declares it. A `SERVED_BY` outside that set is refused HERE rather than becoming an
# object that reports `region: null` after the money is spent.
SOURCE_DIR="$PACKAGE/src"

declared_region_names() {
  sed -n '/^export const HOSTED_OBJECT_NAME = {/,/^} as const/p' "$SOURCE_DIR/hosted-object.ts" |
    grep -oE "'[^']+'" |
    tr -d "'"
}

# `|| true` on both: under `pipefail` a `grep` that matches nothing kills the script with no
# message, and a missing constant deserves the sentence below rather than a silent exit 1.
REGION="$(
  grep -oE "^const SERVED_BY: HostedObjectName = '[^']+'" "$SOURCE_DIR/worker.ts" |
    head -1 |
    sed "s/.*'\([^']*\)'.*/\1/" || true
)"

if [ -z "$REGION" ]; then
  echo "❌ could not read SERVED_BY from $SOURCE_DIR/worker.ts." >&2
  echo "   That constant is the object every request is routed to, and it is where this" >&2
  echo "   deploy takes its region label from. Without it the deploy would produce a node" >&2
  echo "   that reports region: null and refuses every halt — which is what happened before" >&2
  echo "   this check existed." >&2
  exit 1
fi

if ! declared_region_names | grep -qx "$REGION"; then
  echo "❌ REFUSED: SERVED_BY is '$REGION', which is not one of the declared object names:" >&2
  declared_region_names | sed 's/^/     /' >&2
  echo "   An object labelled with a name that exists nowhere else reads correctly and" >&2
  echo "   accepts no halt addressed to any real region." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Which build. ONE source, and the release tag is checked against it.
# ---------------------------------------------------------------------------
#
# The repository carries exactly one version: the root `package.json`'s. The nine workspace
# packages are all `0.0.0`, all private, and link to each other with `*` — none is published, so
# per-package versions would be nine copies of one fact and nine chances to drift.
#
# **Measured 2026-08-27, and it is why this is a `--var` and not a `wrangler.jsonc` key:**
# `--var` MERGES with the file's `vars` rather than replacing them, so `ANNOUNCE_MULTIADDRS`
# survives. Had it replaced them, the relay would announce nothing and hand every client an
# empty reservation SILENTLY (consult §13) — a var injection that quietly disarmed the address.
VERSION="$(node -p "require('./package.json').version || ''" 2>/dev/null || true)"
if [ -z "$VERSION" ]; then
  echo "❌ the root package.json carries no \"version\" — there is nothing to deploy AS." >&2
  exit 1
fi

# The tag that triggered this run must be the version being deployed.
#
# Without this the two drift in the one direction nobody notices: a release tagged `v2.0.1` over
# an unbumped manifest deploys reporting `2.0.0-rc.1`, and the node's answer to "what are you
# running" is a lie that looks like a version. `GITHUB_REF_NAME` is set only on the release path,
# so a laptop run skips the check rather than failing it.
if [ -n "${GITHUB_REF_NAME:-}" ] && [ "$GITHUB_REF_NAME" != "v$VERSION" ]; then
  echo "❌ REFUSED: the release tag and the manifest disagree about what this is." >&2
  echo "   tag:              $GITHUB_REF_NAME" >&2
  echo "   package.json:     $VERSION  (the deploy would announce itself as this)" >&2
  echo "   Bump package.json to match the tag, or tag v$VERSION." >&2
  exit 1
fi

say "Deploying: $SCRIPT_NAME  v$VERSION  region $REGION  (mode: $([ "$LIVE" = 1 ] && echo LIVE || echo dry-run))"

# ---------------------------------------------------------------------------
# --verify-only: read the deployed identity and stop
# ---------------------------------------------------------------------------

# The host the node announces, read from the deploy configuration — the same value the node
# hands to peers, so a mismatch between what is verified and what is published cannot happen.
announced_host() {
  grep -oE '"ANNOUNCE_MULTIADDRS"[[:space:]]*:[[:space:]]*"[^"]*"' "$CONFIG" |
    head -1 |
    sed 's/.*"\(.*\)"$/\1/' |
    sed -E 's#^/dns4/([^/]+)/.*#\1#'
}

read_identity() {
  local host="$1"
  curl -sS --fail --max-time 30 "https://${host}/self"
}

if [ "$VERIFY_ONLY" = 1 ]; then
  HOST="$(announced_host)"
  if [ -z "$HOST" ]; then
    echo "❌ no announced host in $CONFIG — nothing to verify against" >&2
    exit 1
  fi
  say "Reading the deployed identity from $HOST"
  SELF="$(read_identity "$HOST")"
  echo "$SELF"
  echo
  # The one reading somebody checking on a live node most needs and would otherwise have to
  # infer from a `region` field whose meaning is three files away.
  case "$SELF" in
    *'"operable":true'*) say "Kill switch: ARMED." ;;
    *) say "⚠️  KILL SWITCH INOPERATIVE — this node cannot be halted by anyone. See killSwitch.reason above." ;;
  esac
  exit 0
fi

# ---------------------------------------------------------------------------
# The gate. Before the deploy, in this order, and a failure stops everything.
# ---------------------------------------------------------------------------
# AUTH-01 — the enrolment vars, and the trap they exist to close
# ---------------------------------------------------------------------------
#
# **`wrangler deploy` replaces a Worker's vars with what THIS invocation declares.** `--var`
# merges with `wrangler.jsonc`'s `vars` (measured 2026-08-27, recorded above) — it does not merge
# with what a *previous deploy* happened to set. So a budget set by a standalone
# `wrangler deploy --var O2_MAX_ISSUED_PER_WINDOW:600` survives exactly until the next release,
# and then vanishes.
#
# **What that failure looks like, which is why it is worth a section.** Issuance turns off
# silently. `deploy-pages.sh` then probes `/self`, reads `enrolment.issues: false`, and publishes
# a `bootstrap.json` with no `enrollmentProvider` in it — correctly, because the node really has
# stopped issuing. Every visitor after that holds no certificate, so the TURN rung refuses them
# all, and the whole chain reads as "TURN is broken" with nothing anywhere saying a variable was
# dropped by a deploy two steps earlier.
#
# So the values travel with the deploy, out of the environment, exactly as the region does.
ENROLMENT_VARS=""
if [ -n "${O2_MAX_ISSUED_PER_WINDOW:-}" ]; then
  ENROLMENT_VARS="--var O2_MAX_ISSUED_PER_WINDOW:$O2_MAX_ISSUED_PER_WINDOW"
fi
if [ -n "${O2_RESERVED_USER_KEYS:-}" ]; then
  ENROLMENT_VARS="$ENROLMENT_VARS --var O2_RESERVED_USER_KEYS:$O2_RESERVED_USER_KEYS"
fi

# **Refuse to silently switch issuance OFF.** If the deployed object is issuing today and this
# invocation carries no budget, the deploy would turn it off — so it stops and names the variable
# instead. Turning issuance off deliberately is `O2_MAX_ISSUED_PER_WINDOW=0`, which is explicit
# and reads as a decision rather than as an omission.
#
# A pre-flight that cannot READ only warns, on `require_configured_secrets`' stated reasoning: the
# read-back after the deploy measures the same property directly.
#
# **Placed BEFORE the gate, unlike the secrets pre-flight.** A refusal that arrives after five
# minutes of typecheck and unit tests is the same refusal, later — and this one needs nothing the
# gate produces, only the deployed node's own answer.
refuse_to_drop_enrolment() {
  local host before
  # **Only a live deploy can drop anything.** A dry run replaces no vars, so refusing there would
  # be a network call and a refusal bought for nothing — and it would reach every scratch-repository
  # case in `hosted-tier-deploy.node.test.ts`, which rehearses this script against fixtures that
  # have no deployed node behind them.
  [ "$LIVE" = 1 ] || return 0
  host="$(announced_host)"
  [ -n "$host" ] || return 0
  before="$(curl -sS --fail --max-time 20 "https://${host}/self" 2>/dev/null || true)"
  [ -n "$before" ] || { say "⚠️  could not read the node before deploying — the enrolment pre-flight is skipped."; return 0; }
  case "$before" in
    *'"issues":true'*) ;;
    *) return 0 ;;
  esac
  if [ -z "${O2_MAX_ISSUED_PER_WINDOW:-}" ]; then
    echo "" >&2
    echo "❌ REFUSED: this node is issuing certificates today and this deploy carries no budget." >&2
    echo "" >&2
    echo "   A deploy replaces the Worker's vars. Going ahead would turn issuance OFF, and the" >&2
    echo "   next client publish would then offer no enrolment — so no visitor could hold the" >&2
    echo "   certificate the TURN rung asks for, and nothing would say why." >&2
    echo "" >&2
    echo "   Carry it:   O2_MAX_ISSUED_PER_WINDOW=<n> $0 $*" >&2
    echo "   Or mean it: O2_MAX_ISSUED_PER_WINDOW=0 $0 $*" >&2
    echo "" >&2
    echo "   Nothing was deployed." >&2
    exit 1
  fi
}

refuse_to_drop_enrolment

# ---------------------------------------------------------------------------

if [ "$SKIP_TESTS" = 1 ]; then
  # Loud, not silent. A skipped gate is a decision somebody has to be able to see in the log.
  say "⚠️  GATE SKIPPED by --skip-tests. Nothing here has been verified this run."
else
  say "1/3  typecheck"
  npm run typecheck

  # **`O2_UNIT_ONLY=1`, and it is not a shortcut.** It excludes specs above `SLOW_CUTOFF_MS`,
  # DERIVED from `MEASURED_NODE_SPANS` in `vitest.config.ts` rather than from a curated list.
  # Those specs spawn real agent processes and assert on real timing, so on a shared or loaded
  # host they measure the host: three of them failed on GitHub Actions while passing locally,
  # and the instrument settled why — `transport-bounds` reported 32 of 32 received with none
  # rejected, i.e. the condition it reproduces did not occur.
  #
  # Run them in full with `npm run test:node` on a quiet machine. This gate covers the cases
  # that measure CODE.
  say "2/3  the unit set (O2_UNIT_ONLY=1)"
  O2_UNIT_ONLY=1 npx vitest run --project node

  # The SAME flag the live deploy uses, so the dry run rehearses the real command rather than a
  # near-relative of it. It is also where the merge is visible: wrangler prints the binding table,
  # and `ANNOUNCE_MULTIADDRS` standing beside `O2_VERSION` there is the measurement that says
  # `--var` added a var rather than replacing the file's.
  say "3/3  the bundle builds"
  ( cd "$PACKAGE" && WRANGLER_SEND_METRICS=false npx wrangler deploy --dry-run \
      --var "O2_VERSION:$VERSION" --var "O2_REGION:$REGION" $ENROLMENT_VARS --outdir="$(mktemp -d)" )
fi

# ---------------------------------------------------------------------------
# The deploy
# ---------------------------------------------------------------------------

if [ "$LIVE" != 1 ]; then
  say "✅ dry run complete — nothing was deployed."
  echo "   Pass --live to deploy for real."
  exit 0
fi

if [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
  echo "❌ --live needs CLOUDFLARE_API_TOKEN in the environment." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# The secrets this deploy depends on, checked BEFORE a request is spent
# ---------------------------------------------------------------------------
#
# Two bindings decide whether the thing being deployed can be operated at all, and neither is in
# `wrangler.jsonc` — both are secrets, deliberately, because that file is tracked.
#
#   O2_ADMISSION_KEY    without it every halt is refused, INCLUDING the owner's. The object runs
#                       perfectly and cannot be stopped by anybody.
#   O2_IDENTITY_SECRET  without it the object refuses to mint and answers `GET /self` with 500,
#                       so the read-back below would roll back a perfectly good deploy while the
#                       real fault was a binding.
#
# **Refusing here rather than warning, and the direction is deliberate.** A refusal costs one
# unspent deploy and prints the command that fixes it. Deploying anyway costs a node the fabric
# cannot stop, which is the failure this whole section exists to prevent — and on a cohort that
# is spendable once, it is the failure with no second attempt.
#
# **But a pre-flight that cannot RUN only warns.** This is a proxy for the property; the
# read-back after the deploy measures the property itself. A credential scoped without permission to
# list secrets is a reason to fall through to the real check, not a reason to block a release.
require_configured_secrets() {
  local listed
  listed="$(
    cd "$PACKAGE" &&
      WRANGLER_SEND_METRICS=false npx wrangler secret list \
        --name "$SCRIPT_NAME" --format json 2>/dev/null || true
  )"
  if [ -z "$listed" ]; then
    say "⚠️  this script's secrets could not be listed — the PRE-FLIGHT is skipped."
    echo "   The read-back after the deploy measures the same property directly and still runs."
    return 0
  fi

  local missing=""
  local required
  for required in O2_ADMISSION_KEY O2_IDENTITY_SECRET; do
    case "$listed" in
      *"\"$required\""*) ;;
      *) missing="$missing $required" ;;
    esac
  done
  if [ -n "$missing" ]; then
    echo "" >&2
    echo "❌ REFUSED: '$SCRIPT_NAME' is missing secrets this deploy depends on:$missing" >&2
    echo "" >&2
    for required in $missing; do
      echo "   (cd $PACKAGE && npx wrangler secret put $required)" >&2
    done
    echo "" >&2
    echo "   Nothing was deployed. Set them and run this again." >&2
    exit 1
  fi
  say "Secrets: O2_ADMISSION_KEY and O2_IDENTITY_SECRET are both configured."
}

require_configured_secrets

# The identity BEFORE, so the check afterwards is a comparison rather than an assertion about
# a value nobody recorded. A first-ever deploy has nothing to read and that is not an error.
BEFORE=""
HOST="$(announced_host)"
if [ -n "$HOST" ]; then
  BEFORE="$(read_identity "$HOST" 2>/dev/null || true)"
fi

# **The version to roll back TO, captured before anything replaces it.**
#
# Without this, a failed read-back left the bad version live and the operator holding an error
# message — the deploy's own docblock said "roll back with wrangler rollback" and named no
# version, which is a instruction to go and find one under time pressure.
#
# `|| true`: a first-ever deploy has no previous version, and that is not an error. It does
# mean there is nothing to roll back to, which the failure path below says out loud rather
# than discovering.
PREVIOUS_VERSION="$(
  cd "$PACKAGE" &&
    WRANGLER_SEND_METRICS=false npx wrangler deployments list --name "$SCRIPT_NAME" 2>/dev/null |
    grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' |
    head -1 || true
)"
if [ -n "$PREVIOUS_VERSION" ]; then
  echo "   rollback target if this goes wrong: $PREVIOUS_VERSION"
else
  echo "   ⚠️  no previous version found — a failed deploy CANNOT be rolled back automatically"
fi

say "Deploying for real"
( cd "$PACKAGE" && WRANGLER_SEND_METRICS=false npx wrangler deploy \
    --var "O2_VERSION:$VERSION" --var "O2_REGION:$REGION" $ENROLMENT_VARS )

# ---------------------------------------------------------------------------
# The read-back. A changed PeerId is a failure, not a note.
# ---------------------------------------------------------------------------

if [ -z "$HOST" ]; then
  say "⚠️  deployed, but no announced host is configured — the identity was NOT verified."
  echo "   Fill ANNOUNCE_MULTIADDRS in $CONFIG so the next deploy can check itself."
  exit 0
fi

# One reader for the response's string fields, because there are now two that matter and a
# second copy of the same sed is a second place for the pattern to be wrong in.
extract_field() {
  printf '%s' "$2" | sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"\\([^\"]*\\)\".*/\\1/p"
}

extract_peer_id() {
  extract_field peerId "$1"
}

# Roll back, and say exactly what happened either way. Called on any verification failure:
# the whole point of capturing the version above is that this needs no human decision at the
# moment it is least available.
roll_back() {
  local why="$1"
  echo "" >&2
  echo "❌ $why" >&2
  if [ -z "$PREVIOUS_VERSION" ]; then
    echo "   NO PREVIOUS VERSION to roll back to — the bad version is LIVE." >&2
    echo "   This is a first deploy, or the version list could not be read." >&2
    return 1
  fi
  echo "   Rolling back to $PREVIOUS_VERSION…" >&2
  if ( cd "$PACKAGE" && WRANGLER_SEND_METRICS=false npx wrangler rollback "$PREVIOUS_VERSION" \
        --name "$SCRIPT_NAME" --message "automatic: $why" ); then
    echo "   ✅ rolled back to $PREVIOUS_VERSION." >&2
    return 1
  fi
  echo "   ❌ THE ROLLBACK ALSO FAILED. The bad version is LIVE and needs a human." >&2
  return 1
}

say "Reading the deployment back from $HOST"

# **A bounded wait, and it exists because `version` is the first field that CHANGES per deploy.**
#
# The PeerId check above was immune to propagation by construction: the value it expects is the
# value that was already there, so a read that reached the previous deployment agreed anyway.
# `version` does not have that property — a read landing on the deployment being replaced returns
# the OLD string, and a single read would then roll back a perfectly good deploy. So the equality
# is given a window to become true, and only a window that closes without it is a failure.
#
# Retries are the version's alone; the PeerId is compared once, on the last reading.
AFTER=""
ATTEMPT=0
while [ "$ATTEMPT" -lt 6 ]; do
  ATTEMPT=$((ATTEMPT + 1))
  AFTER="$(read_identity "$HOST" 2>/dev/null || true)"
  if [ "$(extract_field version "$AFTER")" = "$VERSION" ]; then break; fi
  [ "$ATTEMPT" -lt 6 ] && sleep 5
done
echo "$AFTER"

AFTER_VERSION="$(extract_field version "$AFTER")"
if [ "$AFTER_VERSION" != "$VERSION" ]; then
  echo "" >&2
  echo "   deployed:  $VERSION" >&2
  echo "   answering: ${AFTER_VERSION:-<no version field>}" >&2
  echo "" >&2
  echo "   The node is not running what this deploy sent, or the version never reached it." >&2
  echo "   'unversioned' means the --var did not arrive; anything else means the old build" >&2
  echo "   is still serving. Either way the deployment cannot be taken at its word." >&2
  roll_back "THE DEPLOYED NODE DOES NOT REPORT THE VERSION THAT WAS DEPLOYED" || exit 1
fi

AFTER_ID="$(extract_peer_id "$AFTER")"
if [ -z "$AFTER_ID" ]; then
  roll_back "the deployed node answered without a peerId" || exit 1
fi

# ---------------------------------------------------------------------------
# The kill switch, read off the node rather than assumed from the flags
# ---------------------------------------------------------------------------
#
# **Two checks with two different remedies, which is why they are not one check.**
#
# The region is a `--var` this script injected, exactly like the version — so a label that did
# not arrive means the deploy did not carry what it was told to carry, and the treatment is the
# version's: roll back, because the deployment cannot be taken at its word.
#
# `killSwitch.operable` is NOT something this script injected. It is the node's own answer to
# *could anybody stop me*, and if it is false after a deploy whose pre-flight passed, rolling
# back would revert a good build without arming anything — the previous version has the same
# bindings. So it fails LOUD and leaves the deployment standing. In CI that reddens the job and
# `publish-client` never runs, which is the right coupling and not a side effect: a client is not
# put in front of visitors while the node behind it cannot be stopped.
# AUTH-01 — and the same read-back discipline applied to the thing a deploy can silently drop.
#
# Fails LOUD rather than rolling back, on `killSwitch.operable`'s stated reasoning: rolling back
# would revert a good build without arming anything, because the previous version has the same
# problem. In CI this reddens the job so `publish-client` never runs — which is the right
# coupling, since a client published against a node that stopped issuing offers visitors an
# enrolment nothing can honour.
AFTER_ISSUES="$(printf '%s' "$AFTER" | grep -c '"issues":true' || true)"
if [ -n "${O2_MAX_ISSUED_PER_WINDOW:-}" ] && [ "${O2_MAX_ISSUED_PER_WINDOW}" != "0" ]; then
  if [ "$AFTER_ISSUES" = "0" ]; then
    echo "" >&2
    echo "❌ this deploy carried O2_MAX_ISSUED_PER_WINDOW=$O2_MAX_ISSUED_PER_WINDOW and the node" >&2
    echo "   reports it is NOT issuing. The var did not arrive, or it was refused as above the" >&2
    echo "   tier's ceiling. The deployment stands; enrolment does not." >&2
    exit 1
  fi
  say "Enrolment: the node reports it is issuing."
else
  say "Enrolment: not configured — this node issues no certificates, and the published client will offer none."
fi

AFTER_REGION="$(extract_field region "$AFTER")"
if [ "$AFTER_REGION" != "$REGION" ]; then
  echo "" >&2
  echo "   deployed with:  O2_REGION=$REGION" >&2
  echo "   answering with: ${AFTER_REGION:-null}" >&2
  echo "" >&2
  echo "   A halt is addressed to a region. A node reporting the wrong one — or none — refuses" >&2
  echo "   every halt an operator sends it, while every other reading looks correct." >&2
  roll_back "THE DEPLOYED NODE DOES NOT REPORT THE REGION THAT WAS DEPLOYED" || exit 1
fi

# A literal match rather than `extract_field`, which reads quoted string values only and would
# find nothing in `"operable":true`. `Response.json` emits compact JSON, and `operable` appears
# in exactly one place in the body, so the needle is unambiguous wherever the field sits.
case "$AFTER" in
  *'"operable":true'*)
    say "✅ the kill switch is ARMED: region $AFTER_REGION, operator key configured."
    ;;
  *)
    echo "" >&2
    echo "❌ THE DEPLOYED NODE CANNOT BE STOPPED BY ANYBODY." >&2
    echo "" >&2
    echo "   It reports \`killSwitch.operable: false\`, and its own reason is in the body above." >&2
    echo "" >&2
    echo "   The deployment is LEFT STANDING and was NOT rolled back — the previous version" >&2
    echo "   carries the same bindings, so a rollback would revert this build and arm nothing." >&2
    echo "   Fix the binding it names and deploy again:" >&2
    echo "" >&2
    echo "     (cd $PACKAGE && npx wrangler secret put O2_ADMISSION_KEY)" >&2
    echo "" >&2
    echo "   Until then this node runs and no operator can halt it. Do not invite anyone." >&2
    exit 1
    ;;
esac

if [ -z "$BEFORE" ]; then
  say "✅ deployed v$VERSION. PeerId $AFTER_ID — no earlier reading to compare against."
  exit 0
fi

BEFORE_ID="$(extract_peer_id "$BEFORE")"
if [ "$BEFORE_ID" != "$AFTER_ID" ]; then
  echo "" >&2
  echo "   before: $BEFORE_ID" >&2
  echo "   after:  $AFTER_ID" >&2
  echo "" >&2
  echo "   The node's identity is supposed to survive a redeploy — it is persisted in Durable" >&2
  echo "   Object storage by hosted-identity.ts. A new one means every peer holding the old" >&2
  echo "   address is now dialling a node that no longer answers to it." >&2
  roll_back "THE PEER ID CHANGED ACROSS THIS DEPLOY" || exit 1
fi

say "✅ deployed v$VERSION, and the identity survived: $AFTER_ID"
