#!/bin/bash
# The git-flow rules, in one place and callable, so a spec can exercise them.
#
# WHY A SEPARATE FILE. Until 2026-08-26 these rules lived inline in `pre-commit`, where
# nothing could reach them: a hook runs only during a commit, so the only way to learn what
# it accepts was to attempt a commit and see. `packages/node/src/git-flow-rules.node.test.ts`
# now runs this file directly with a matrix of inputs, which is why it takes its subject as
# arguments and prints to stderr rather than reading git state itself.
#
# WHY NOT CI. There is none and there must not be one — `disclosure-gate.node.test.ts`
# asserts `.github/workflows` does not exist. Local hooks are the only gate this repository
# has, and that is recorded rather than an omission to fix.
#
# Usage:
#   git-flow-rules.sh check-name  <branch>            exit 0 if the name is allowed
#   git-flow-rules.sh check-merge <target> <source>   exit 0 if the merge is allowed

set -u

# ── Branch naming ──────────────────────────────────────────────────────────────────────
#
# **The list is the one in USE, not the one git-flow ships, and the difference was
# measured.** Of 108 local branches on 2026-08-26, forty-four carried prefixes outside
# git-flow's own four: `fix/` 15, `chore/` 13, `docs/` 12, `test/` 1, and three
# `worktree-agent-*`. The old rule warned on every one of them and then said *"Proceeding
# with commit (not enforced for other branches)"*, so it recorded a divergence forty-four
# times and prevented nothing. A rule that a fifth of the tree ignores is not a rule.
#
# So the list widened to what the work actually produces and the warning became a refusal.
# `fix/` and `bugfix/` are BOTH allowed and that is deliberate: `git flow bugfix start`
# generates the second, and practice overwhelmingly writes the first.
#
# `worktree-agent-*` is the harness's, not a person's — an isolated agent gets a worktree
# and a branch named for it. Refusing that name would break agents rather than discipline
# anybody, so it is allowed by an exact shape instead of a free prefix.
VALID_PREFIXES="feature|release|hotfix|bugfix|support|fix|chore|docs|test"
HARNESS_BRANCH="^worktree-agent-[0-9a-f]+$"

check_name() {
  local branch=$1
  [[ $branch =~ ^($VALID_PREFIXES)/.+ ]] && return 0
  [[ $branch =~ $HARNESS_BRANCH ]] && return 0
  {
    echo ""
    echo "❌ Branch '$branch' does not follow this repository's branch naming."
    echo ""
    echo "   Allowed:  <prefix>/<name>  where prefix is one of:"
    echo "             $VALID_PREFIXES"
    echo "   Also:     worktree-agent-<hex>   (created by the harness, not by hand)"
    echo ""
    echo "   Rename without losing anything:"
    echo "     git branch -m <prefix>/<name>"
    echo ""
    echo "   This was a warning until 2026-08-26 and let 44 of 108 branches through."
    echo ""
  } >&2
  return 1
}

# ── Merge direction ────────────────────────────────────────────────────────────────────
#
# **The gap this closes: `pre-commit` never saw a merge.** It refuses direct commits to
# `main` and `develop` and exits 1, and every merge into those branches went straight past
# it — because git runs `pre-merge-commit` for an automatic merge, and that hook did not
# exist here. The refusal held exactly what it was written for, a hand-edit on a protected
# branch, and nothing about where a merge came from.
#
# The rule is git-flow's own: `main` takes `develop`, a `hotfix/` or a `release/` and
# nothing else; `develop` takes anything except `main`; every other branch is unrestricted,
# because a topic branch merging another topic branch is normal work.
check_merge() {
  local target=$1 source=$2
  case "$target" in
    main)
      if [[ $source == "develop" || $source =~ ^(hotfix|release)/.+ ]]; then return 0; fi
      {
        echo ""
        echo "❌ '$target' may not take a merge from '$source'."
        echo ""
        echo "   Into main:  develop, hotfix/<version>, release/<version> — and nothing else."
        echo ""
        echo "   A feature reaches main THROUGH develop, so that what ships is what was"
        echo "   integrated. Merge into develop first."
        echo ""
      } >&2
      return 1
      ;;
    develop)
      # **This arm is REACHABLE ONLY WHEN main AND develop HAVE DIVERGED, and that was
      # measured rather than assumed.** In a healthy tree `git merge-base main develop`
      # equals develop — main is develop plus merge commits — so merging main into develop
      # is a FAST-FORWARD, and git does not invoke `pre-merge-commit` for a fast-forward.
      # Watched on 2026-08-26: the merge printed `Already up to date.` followed by
      # `Merge made by the 'recursive' strategy.`, created a commit, exited 0, and this hook
      # never ran. Even `--no-ff` does not bring it back.
      #
      # So the plant for this arm CANNOT go red through the hook, and saying otherwise would
      # be a proof that cannot fail. What carries the claim instead is the spec, which calls
      # this function directly — and what carries the diverged case is the same code path
      # `main` uses, which WAS planted and did go red.
      #
      # The one mechanism that would catch a fast-forward is `reference-transaction`, which
      # fires on every ref update and can refuse. Deliberately not used: it would sit in
      # front of every commit, fetch, reset and rebase in the repository to police one merge
      # direction whose fast-forward form changes no content at all. The blast radius is not
      # worth the case.
      if [[ $source == "main" ]]; then
        {
          echo ""
          echo "❌ 'develop' may not take a merge from 'main'."
          echo ""
          echo "   main is downstream of develop. Merging it back inverts the flow and"
          echo "   makes the next develop→main merge report changes nobody wrote."
          echo ""
          echo "   If main carries a hotfix develop needs, merge the hotfix/ branch."
          echo ""
        } >&2
        return 1
      fi
      return 0
      ;;
    *) return 0 ;;
  esac
}

# ── Resolving what is being merged ─────────────────────────────────────────────────────
#
# Git hands a merge hook no arguments, so the source has to be recovered — and the two hooks
# that need it get it from DIFFERENT places, which was measured on git 2.33.0 after the
# first version of this function silently gave up on every merge.
#
# **`MERGE_HEAD` does not exist yet when `pre-merge-commit` runs.** A probe hook installed
# through `-c core.hooksPath` during a real merge reported `rev-parse --verify MERGE_HEAD`
# exiting 1, no `MERGE_MSG` in the git directory, and one environment variable:
# `GITHEAD_ef63ccec…=chore/probe-source`. That is git naming the head it is merging, and it
# is the only thing in scope that carries the branch NAME rather than a commit.
#
# `MERGE_HEAD` is what the OTHER path has. A conflicted merge is finalised by `git commit`,
# where the merge is already in progress and `MERGE_HEAD` is written — but no `GITHEAD_*`
# survives into that separate process. So both are read, in the order they become available.
#
# When neither names exactly one branch the source cannot be identified, and the merge is
# ALLOWED with a line saying so. A hook that refused what it could not identify would block
# legitimate work on an ambiguity of its own making — and, as the first version proved, one
# that stays silent instead is worse: it reports nothing and enforces nothing.
merge_source() {
  # git 2.33.0 sets exactly one `GITHEAD_<sha>=<name>` per merged head. More than one is a
  # so-called octopus merge, which this rule has nothing to say about.
  local from_env
  from_env=$(env | grep '^GITHEAD_' | sed 's/^GITHEAD_[0-9a-f]*=//')
  if [ "$(printf '%s\n' "$from_env" | grep -c .)" = "1" ]; then
    printf '%s\n' "$from_env"
    return 0
  fi

  local head
  head=$(git rev-parse --verify -q MERGE_HEAD) || return 1
  local names
  names=$(git for-each-ref --format='%(refname:short)' --points-at "$head" refs/heads)
  [ "$(printf '%s\n' "$names" | grep -c .)" = "1" ] || return 1
  printf '%s\n' "$names"
}

case "${1-}" in
  check-name) check_name "${2-}" ;;
  check-merge) check_merge "${2-}" "${3-}" ;;
  merge-source) merge_source ;;
  *)
    echo "usage: $0 check-name <branch> | check-merge <target> <source> | merge-source" >&2
    exit 2
    ;;
esac
