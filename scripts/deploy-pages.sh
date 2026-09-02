#!/usr/bin/env bash
#
# Publish the browser client to GitHub Pages — the same steps locally and in CI.
#
# ## Why this is a script and not workflow steps
#
# `deploy-hosted.sh` was extracted for a measured reason: the steps lived only in a workflow,
# could be rehearsed nowhere, and DRIFTED until the one workflow where failing costs most was
# running a suite CI had already corrected. Two copies of a procedure diverge; one cannot. The
# owner's instruction is that every deployment work from a terminal and from a workflow, and
# this file is the browser tier's half of that.
#
# ## What it publishes, and why the address is generated rather than written down
#
# A page fetches `bootstrap.json` from its own origin to learn where to knock. On a static host
# nobody serves that dynamically, so it has to be a file — and `tab-api.ts` warns in as many
# words against *"an address that can go stale in a build"*.
#
# The answer is to derive it from the deployment that just happened rather than from a constant:
#
#   * the relay address comes from `ANNOUNCE_MULTIADDRS` in `wrangler.jsonc` — the same value
#     the node itself announces, so what the page dials and what the node publishes cannot
#     disagree;
#   * the PeerId is read LIVE from `https://<host>/self`.
#
# **The PeerId is the one thing that cannot go stale**, and that is not an assumption: it is
# persisted in Durable Object storage and `deploy-hosted.sh` rolls a deploy back if it changes.
#
# **`bootstrapInfoFor` is deliberately NOT used, and this was measured rather than assumed.**
# That function builds `/dns4/<host>/tcp/<port>/ws` — a PLAINTEXT WebSocket, correct for the
# `laptop.local` seed it was written for. GitHub Pages enforces HTTPS, and a secure page cannot
# dial `ws://` at all: the browser refuses it as mixed content, before any libp2p code runs.
# `wrangler.jsonc` already carries the `/tls/ws` form, so the config is the source and the
# helper is not.
#
# ## Usage
#
#   scripts/deploy-pages.sh              # dry run: generate, build, verify — publishes nothing
#   scripts/deploy-pages.sh --live       # the real thing
#   scripts/deploy-pages.sh --verify-only  # read the published site and stop
#
# `--live` needs push rights on `gh-pages`. `--dry-run` needs no credential.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

CONFIG="packages/cloudflare/wrangler.jsonc"
DIST="packages/browser/dist"
PUBLIC="packages/browser/demo/public"
PAGES_BRANCH="gh-pages"
PAGES_URL="https://o2alexanderfedin.github.io/o2.services"

LIVE=0
VERIFY_ONLY=0
SKIP_TESTS=0

for arg in "$@"; do
  case "$arg" in
    --live) LIVE=1 ;;
    --dry-run) LIVE=0 ;;
    --verify-only) VERIFY_ONLY=1 ;;
    --skip-tests) SKIP_TESTS=1 ;;
    -h|--help) sed -n '2,44p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "❌ unknown argument: $arg" >&2; exit 2 ;;
  esac
done

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }

# ---------------------------------------------------------------------------
# --verify-only: read what is actually published and stop
# ---------------------------------------------------------------------------

if [ "$VERIFY_ONLY" = 1 ]; then
  say "Reading the published client at $PAGES_URL"
  # The build first, because it is the question this mode is usually asked in order to answer:
  # *what is actually live?* Before the stamp existed the only answer available was a `gh-pages`
  # commit message naming the deployed NODE's version, and that was misread as the client's.
  LIVE_ID="$(
    curl -sS --fail --max-time 30 "$PAGES_URL/index.html" 2>/dev/null |
      sed -n 's/.*<meta name="o2-build" content="\([^"]*\)".*/\1/p' | head -1
  )"
  echo "   build: ${LIVE_ID:-<the published page carries no o2-build stamp — it predates it>}"
  curl -sS --fail --max-time 30 "$PAGES_URL/bootstrap.json"
  echo
  exit 0
fi

# ---------------------------------------------------------------------------
# Where the page should knock — both halves from live sources, neither hardcoded
# ---------------------------------------------------------------------------

ANNOUNCE="$(
  grep -oE '"ANNOUNCE_MULTIADDRS"[[:space:]]*:[[:space:]]*"[^"]*"' "$CONFIG" |
    head -1 | sed 's/.*"\(.*\)"$/\1/'
)"
if [ -z "$ANNOUNCE" ]; then
  echo "❌ no ANNOUNCE_MULTIADDRS in $CONFIG — there is no address to publish." >&2
  exit 1
fi

# A page served over HTTPS cannot dial a plaintext WebSocket; the browser refuses it as mixed
# content before libp2p sees it. Refused here rather than discovered by a tester on a phone.
case "$ANNOUNCE" in
  */tls/ws*) : ;;
  *)
    echo "❌ REFUSED: the announced address is not a SECURE WebSocket:" >&2
    echo "     $ANNOUNCE" >&2
    echo "   GitHub Pages is HTTPS-only, so every visitor's browser would refuse this as" >&2
    echo "   mixed content and the published client could never join." >&2
    exit 1
    ;;
esac

HOST="$(printf '%s' "$ANNOUNCE" | sed -E 's#^/dns4/([^/]+)/.*#\1#')"
say "Asking the deployed node who it is: https://$HOST/self"
SELF="$(curl -sS --fail --max-time 30 "https://${HOST}/self")"
PEER_ID="$(printf '%s' "$SELF" | sed -n 's/.*"peerId"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
NODE_VERSION="$(printf '%s' "$SELF" | sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
if [ -z "$PEER_ID" ]; then
  echo "❌ the node answered without a peerId — there is nothing to point visitors at." >&2
  echo "   $SELF" >&2
  exit 1
fi
echo "   peerId  $PEER_ID"
echo "   running $NODE_VERSION"

RELAY_ADDR="${ANNOUNCE}/p2p/${PEER_ID}"

# ---------------------------------------------------------------------------
# The gate, before the build. A red tree cannot be published past.
# ---------------------------------------------------------------------------

if [ "$SKIP_TESTS" = 1 ]; then
  say "⚠️  GATE SKIPPED by --skip-tests. Nothing here has been verified this run."
else
  say "1/2  typecheck"
  npm run typecheck
  say "2/2  the unit set (O2_UNIT_ONLY=1)"
  O2_UNIT_ONLY=1 npx vitest run --project node
fi

# ---------------------------------------------------------------------------
# Generate, then build
# ---------------------------------------------------------------------------

say "Writing $PUBLIC/bootstrap.json"
mkdir -p "$PUBLIC"
# `peerAddrs` carries the relay itself and nothing else. Live reservation holders cannot be
# known when a static file is written, and guessing them would publish addresses that are wrong
# by the time anybody loads the page — peers are found through the relay and the DHT once the
# tab is connected, which is the mechanism that is supposed to do this.
cat > "$PUBLIC/bootstrap.json" <<JSON
{
  "relayAddrs": ["$RELAY_ADDR"],
  "seedPeerId": "$PEER_ID",
  "peerAddrs": ["$RELAY_ADDR"]
}
JSON
cat "$PUBLIC/bootstrap.json"

say "Building the browser client"
npm run build:demo

# ---------------------------------------------------------------------------
# Verify the BUILD before anything is published — the subpath is what breaks silently
# ---------------------------------------------------------------------------

say "Checking the build would work from a subpath"
FAILED=0
check() {
  if [ "$2" = 1 ]; then echo "   ✅ $1"; else echo "   ❌ $1" >&2; FAILED=1; fi
}

[ -f "$DIST/index.html" ] && check "index.html emitted" 1 || check "index.html emitted" 0
[ -f "$DIST/bootstrap.json" ] && check "bootstrap.json reached the output" 1 \
  || check "bootstrap.json reached the output" 0

# The defect that fails silently: a root-absolute asset reference resolves to the domain apex,
# where this site is not. `base: './'` is what prevents it and this is the reading of it.
if grep -qE '(src|href)="/[^/]' "$DIST/index.html"; then
  check "every asset reference is relative, so /o2.services/ resolves" 0
else
  check "every asset reference is relative, so /o2.services/ resolves" 1
fi

grep -q "$PEER_ID" "$DIST/bootstrap.json" 2>/dev/null \
  && check "the published address names the live node" 1 \
  || check "the published address names the live node" 0

# Checked in the DRY run and not only at publish time, because a stamp that vanished would
# otherwise be found by the read-back — after the push, with the wrong site already live.
DRY_ID="$(
  sed -n 's/.*<meta name="o2-build" content="\([^"]*\)".*/\1/p' "$DIST/index.html" | head -1
)"
if [ -n "$DRY_ID" ]; then
  check "the page names the build it came from: $DRY_ID" 1
else
  check "the page names the build it came from — <meta name=\"o2-build\"> is missing" 0
fi

if [ "$FAILED" = 1 ]; then
  echo "" >&2
  echo "❌ the build would not work when served from $PAGES_URL — publishing nothing." >&2
  exit 1
fi

if [ "$LIVE" != 1 ]; then
  say "✅ dry run complete — nothing was published."
  echo "   Output is in $DIST. Pass --live to publish."
  exit 0
fi

# ---------------------------------------------------------------------------
# Publish
# ---------------------------------------------------------------------------

BEHIND="$(git rev-list --count "origin/${PAGES_BRANCH}..HEAD" 2>/dev/null || echo unknown)"
say "Publishing to $PAGES_BRANCH (it is $BEHIND commits behind this one)"

WORK="$(mktemp -d)"
cp -R "$DIST/." "$WORK/"

# **Everything the build did not emit is dropped here, and `.git` is why.**
#
# Vite's `emptyOutDir` clears the output directory between builds but DELIBERATELY PRESERVES
# DOTFILES — that is upstream's guard against nuking a git-based deploy setup. So anything
# dot-prefixed that ever landed in `dist` stays there through every later build, and the copy
# above carries it into the publish.
#
# That is not hypothetical and it is not cosmetic. Measured 2026-09-01: this repository's own
# `packages/browser/dist/` held a FULL CLONE checked out on `gh-pages` at `v2.0.0-rc.4`, left
# behind when this script moved from `git checkout gh-pages` to the temp worktree below. Copied
# into `$PAGES_TREE` it lands on top of that worktree's own `.git`, and `git add -A` then reads
# a foreign index: the staging came out with FIVE `src-*` assets from an August build and
# WITHOUT `bootstrap.json`, without the stylesheet and without the task-executor worker. A
# `--live` run from that laptop would have published a site whose discovery endpoint was
# missing outright.
#
# CI never saw it — a fresh checkout has no stray — which is exactly the shape of defect that
# breaks the "one script, and it runs identically on a laptop" claim `deploy.yml` makes about
# this file. So the fix belongs here rather than in a cleanup somebody has to remember.
find "$WORK" -mindepth 1 -maxdepth 1 -name '.*' -exec rm -rf {} +
touch "$WORK/.nojekyll"

# A worktree rather than a branch switch: this repository runs concurrent agents in one tree,
# and `git checkout gh-pages` in a shared tree is how another agent's work disappears.
PAGES_TREE="$(mktemp -d)"
git fetch -q origin "$PAGES_BRANCH"
git worktree add -q --detach "$PAGES_TREE" "origin/${PAGES_BRANCH}"
trap 'git worktree remove --force "$PAGES_TREE" 2>/dev/null || true' EXIT

( cd "$PAGES_TREE" && git rm -rq --ignore-unmatch . )
cp -R "$WORK/." "$PAGES_TREE/"
(
  cd "$PAGES_TREE"
  git add -A
  if git diff --cached --quiet; then
    echo "   nothing changed — the published site already matches this build."
    exit 0
  fi
  # **The subject names the SOURCE first and the node second, and one misreading is why.**
  # It read `Publish the browser client — node $NODE_VERSION, …`, which parses as *"the client
  # is at that version"* — and on 2026-09-01 it was read exactly that way, producing a reported
  # gap that did not exist: `gh-pages` said `rc.7` while the deployed node said `rc.8`, so the
  # client was called a release behind. It was not. `$NODE_VERSION` is read from the deployed
  # node's `/self` and says nothing about the client, and the site is republished only when its
  # CONTENT changes — the `git diff --cached --quiet` above — so a commit dated at `rc.7` is the
  # last time the built site differed, not the last time it was checked.
  #
  # The published site carries no version of its own at all: no build identity in `index.html`,
  # none in `bootstrap.json`, none in any asset. This commit is therefore the ONLY record of
  # what is published, which is why it names the commit it was built from in its own subject.
  git commit -q -m "Publish the browser client built from $(git -C "$REPO_ROOT" rev-parse --short HEAD) — verified against node $NODE_VERSION, relay $PEER_ID

Published by scripts/deploy-pages.sh, and only because the built site DIFFERS from what
gh-pages already held — an unchanged build commits nothing, so the gap between this commit's
date and the newest release is not a staleness reading.

'$NODE_VERSION' is the DEPLOYED NODE's version, read live from /self. It is not the client's.
The client's own identity is $BUILD_ID, stamped into index.html as <meta name=\"o2-build\">
and read back off the live site below.

bootstrap.json points at $RELAY_ADDR, read from the deployed node rather than written down."
  git push -q origin "HEAD:${PAGES_BRANCH}"
)

say "Published. Reading it back"

# **Both halves are read back, and the second one is why the stamp exists.**
#
# `bootstrap.json` naming the live PeerId says the site can find the fabric. It says nothing
# about WHICH BUILD is serving that address — and until 2026-09-01 nothing did, which is how a
# site that was byte-identical to a fresh build came to be reported a release behind. So the
# published page is also asked to name itself, and the expected answer is not derived a second
# time here: it is lifted out of the page this run just built, so the two cannot disagree by
# being computed differently.
BUILD_ID="$(
  sed -n 's/.*<meta name="o2-build" content="\([^"]*\)".*/\1/p' "$DIST/index.html" | head -1
)"
if [ -z "$BUILD_ID" ]; then
  echo "❌ the built index.html carries no <meta name=\"o2-build\"> — stampBuildIdentity() is" >&2
  echo "   not in the vite config, or a later transform dropped the tag. Refusing to publish a" >&2
  echo "   site that cannot say what it is." >&2
  exit 1
fi
say "This build is $BUILD_ID"
# Pages needs a moment to build; the equality is given a window rather than one shot.
ATTEMPT=0
while [ "$ATTEMPT" -lt 10 ]; do
  ATTEMPT=$((ATTEMPT + 1))
  LIVE_JSON="$(curl -sS --fail --max-time 30 "$PAGES_URL/bootstrap.json" 2>/dev/null || true)"
  LIVE_HTML="$(curl -sS --fail --max-time 30 "$PAGES_URL/index.html" 2>/dev/null || true)"
  case "$LIVE_JSON" in *"$PEER_ID"*)
    case "$LIVE_HTML" in *"$BUILD_ID"*) break ;; esac
  ;; esac
  [ "$ATTEMPT" -lt 10 ] && sleep 15
done

case "$LIVE_JSON" in
  *"$PEER_ID"*)
    case "$LIVE_HTML" in
      *"$BUILD_ID"*)
        say "✅ published. The site names the live node $PEER_ID, and names itself $BUILD_ID"
        echo "   $PAGES_URL"
        ;;
      *)
        echo "" >&2
        echo "❌ the site answers, but does not name the build this run published." >&2
        echo "   expected <meta name=\"o2-build\"> to carry: $BUILD_ID" >&2
        echo "   An older page is still being served, or the stamp did not survive the build." >&2
        echo "   GitHub Pages may still be building; re-check with --verify-only." >&2
        exit 1
        ;;
    esac
    ;;
  *)
    echo "" >&2
    echo "❌ the published site does not name $PEER_ID after $ATTEMPT reads." >&2
    echo "   got: ${LIVE_JSON:-<nothing>}" >&2
    echo "   GitHub Pages may still be building; re-check with --verify-only." >&2
    exit 1
    ;;
esac
