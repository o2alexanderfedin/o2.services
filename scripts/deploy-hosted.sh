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
#
# ## Usage
#
#   scripts/deploy-hosted.sh                 # dry run: gate + build, deploys nothing
#   scripts/deploy-hosted.sh --live          # the real thing
#   scripts/deploy-hosted.sh --live --skip-tests   # only when the gate just ran; says so loudly
#   scripts/deploy-hosted.sh --verify-only   # read the deployed node's identity and stop
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
    -h|--help) sed -n '2,40p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
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

say "Deploying: $SCRIPT_NAME  v$VERSION  (mode: $([ "$LIVE" = 1 ] && echo LIVE || echo dry-run))"

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
  read_identity "$HOST"
  echo
  exit 0
fi

# ---------------------------------------------------------------------------
# The gate. Before the deploy, in this order, and a failure stops everything.
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
      --var "O2_VERSION:$VERSION" --outdir="$(mktemp -d)" )
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
( cd "$PACKAGE" && WRANGLER_SEND_METRICS=false npx wrangler deploy --var "O2_VERSION:$VERSION" )

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
