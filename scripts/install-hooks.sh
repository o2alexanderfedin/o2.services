#!/usr/bin/env bash
#
# Install this repository's git hooks.
#
# Git does not clone .git/hooks, so hooks are tracked in .githooks/ and wired up
# by pointing core.hooksPath at that directory. Run once after cloning.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

if [ ! -d .githooks ]; then
  echo "❌ .githooks/ not found in $REPO_ROOT" >&2
  exit 1
fi

chmod +x .githooks/*
git config core.hooksPath .githooks

echo "✅ core.hooksPath -> .githooks"
echo "   Installed hooks:"
for hook in .githooks/*; do
  [ -f "$hook" ] && echo "     - $(basename "$hook")"
done
echo ""
echo "🔒 Protected branches: main, develop (direct commits rejected)"
