# Phase 7 — Churn, Stragglers & Coordinator Survival

**Status:** COMPLETE — 6 of 6 criteria met
**Requirements:** CHURN-01 … CHURN-06
**Branch:** `feature/phase-7-churn`

```
tsc --noEmit  clean
745 tests     all green (was 571)
```

| # | Criterion | Status |
|---|---|---|
| 1 | 30% of nodes killed mid-execution; correct aggregate, re-dispatches visible | **met** |
| 2 | Lease expiry re-dispatches; the worker self-terminates and releases, not writes | **met** |
| 3 | Straggler duplicated under a global budget, first result wins, multiplier reported | **met** |
| 4 | Requestor's tab closes; resume from a content-addressed checkpoint or fail cleanly | **met** |
| 5 | Cross-owner job returns `covered: X/Y owners` beside the aggregate | **met** |
| 6 | A sovereign speculative duplicate never reaches another owner's node | **met** — falsified |

## The invariant the whole phase rests on

> **Liveness changes who computes a task and when, never what the answer is.**

That is true because a result is a pure function of `(module, input, partition)` and is
content-addressed, so a re-dispatch recomputes byte-identical output. It is what lets
the loop be aggressive: every recovery action it can take is, at worst, wasted work.
It is also the first thing to re-check if any of this is ever changed.

## A lease is a deadline, not a lock

Criterion 4 asks that a departed requestor never leave "orphaned leases". There is no
cleanup code for that, and there does not need to be: nobody releases a deadline and no
keeper has to notice the coordinator left. The deadline passes and the task is
available again. A lock would have required exactly the holder-liveness protocol that
the deadline replaces.

The same idea makes resume trivial. A checkpoint holds **CIDs, never values**, so
resuming means reading which partitions are answered and dispatching the rest — the
identical path a fresh job takes. There is no "starting" versus "resuming" branch, and
a task that was in flight when the tab closed is simply outstanding.

## Why speculation's loser is harmless

Not because anything cancels it. Because both copies compute the same pure function of
the same content-addressed inputs, so they produce **the same CID** and the loser
dedupes into nothing — the property MR-07 already relies on. That matters because
cancellation is precisely what fails when a node vanishes mid-cancel.

And when two copies *disagree*, that is not a race to resolve. It is a determinism
failure or a dishonest node, and it is **reported, never voted on**: first-result-wins
picks the winner, the disagreement travels beside it and fails the run.

## Three things this phase got wrong first

Each was found by a test, and each was a real defect rather than a test artifact.

**Re-dispatch picked the same dead node every generation.** Placement is deterministic
by design — rendezvous ranking on the shard id — which is exactly what makes
re-placement reproducible, and exactly why a retry re-derived the identical choice
until the generations ran out. Tried nodes are now excluded *before* placement.
Narrowing the input is safe: the sovereignty gate still runs inside `placeWithOffers`
on whatever it is given, so constraint-first ordering survives.

**One `null` collapsed two opposite policies.** "The node is gone" and "the task is
broken" both arrived as failure, so three unlucky dead picks retired a perfectly good
shard — which makes the 30% criterion unachievable, not merely slow. They now carry a
kind: node failures retry until the pool is exhausted, task failures stop after three
independent nodes have failed the same work. The wire mapping lives in `@o2/net`, so
`RemoteExecutor`'s deliberate flattening — which `executeVerified` wants — is untouched.

**The watchdog was an out-of-memory crash waiting for real I/O.** It re-wrapped every
pending promise on each loop iteration and kept racing a timer that provably could no
longer act. Against a dispatch slower than the watchdog that is unbounded allocation.
No kernel test could show it: with a fake dispatch that resolves immediately, the loop
never spins. The first test using real RPC found it in 36 seconds and 4 GB. Fixed by
wrapping once, and by stopping the watchdog when speculation becomes *permanently*
impossible — already duplicated, budget spent, or no eligible node left, all of which
are monotone. "Too new to judge" is the one non-permanent reason, so that keeps waiting.

## A claim corrected rather than left standing

`LeaseTable.complete` refuses a report when the caller is not the current holder **or**
the lease has lapsed. The original comment said this was "the single place a churn
mechanism could change an answer". That is true of the *holder* check and false of the
*deadline* check, which only bites in the window where a lease has lapsed and nothing
has reaped it — and there, accepting the work would in fact be safe.

It is still refused, deliberately: a lease whose expiry is negotiable is not a deadline,
and the worker's reason to self-terminate evaporates the moment a late report might
still count. But the saving being given up is real, and the comment now says what each
half actually buys instead of implying the strict rule prevents a wrong answer.

## Falsification

`speculativeCandidates` was replaced with "pick anyone, quickly" — the obvious
implementation a straggler fix invites. Four tests failed, and the failure detail showed
the breach itself rather than an incidental assertion: `['alice-2', 'bob-0', 'bob-1', …]`
— eight of Bob's nodes offered as targets for Alice's sovereign shard. Reverted.

The stale-completion guard was also relaxed and caught. Notably only **one** test
failed, which is what prompted the correction above: the tests were measuring the
holder check, and the deadline check needed a claim that matched what it does.

## What an adversarial review found afterwards

The implementation passed 733 tests and `tsc` before review. Five lenses then ran over
it independently, each finding verified by execution and attacked by a separate
skeptic. **Five defects were confirmed and none refuted** — three of them severe, and
one of them the phase's own central claim failing.

**Speculation could change the answer.** Breaking out of the race on the first arrival
meant `settleRace` never saw a second result, so `disagreed` could not become true on
any input; `outcome.disagreements`, the `ok` term reading it, and every `ledger.discard`
call were dead code. A probe made both copies answer with *different* CIDs: timing alone
decided which became the job's answer, and the run reported ok. Majority-vote-by-race —
the one thing this project has explicitly refused — arriving through the mechanism built
to improve latency.

The fix keeps speculation's point. Waiting for the loser would undo the latency saving,
because the loser is usually the straggler. So the winner returns immediately and the
outstanding copies are compared once *every* shard has settled, which costs nothing —
the job was already waiting for its slowest shard. A copy still unanswered by then is
`uncompared`, never "agreed": silence is not evidence, and folding it into agreement
asserts something nobody checked.

**The test guarding that was vacuous, and it was written by the same person who wrote
the warning against it.** Every assertion sat inside `if (outcome.disagreements.length >
0)`, a condition that could never hold. The reviewer proved it by mutation — deleting
disagreement reporting outright left all 374 node tests green. The handoff file's
anti-pattern table already contained "assertions guarded by an `if()` so they can be
skipped entirely". Knowing the rule did not prevent breaking it; only running the
mutation did.

**Nothing enforced the lease deadline.** This module's own header said silence gets a
bounded wait. The code never read `expiresAt` anywhere. Once speculation became
impossible the loop awaited the dispatch with no timer at all, so a peer that never
answered hung the shard and, through `Promise.all`, the job — on *default* settings,
since `floor(tasks * 0.1)` is 0 for any job under ten shards.

**Coverage counted an owner on any single shard.** Four shards, three failed, and the
report said `complete`. Exactly the failure `coverage.ts` exists to prevent, arriving
through the composition rather than through `coverageOf`. Both CHURN-05 tests used one
shard per owner, so neither could see it.

**A lapsed completion leaked its lease**, leaving finished tasks listed as outstanding
forever.

Every fix was mutation-tested afterwards. The lease-deadline mutant is worth noting: it
does not fail an assertion, it *crashes the worker* — which is itself the finding, since
the deadline is what bounds the loop at all.

### The lesson, stated so it survives

Three of these were invisible to a suite that used a fake dispatch resolving on a
microtask. **A test whose fake is faster than the real thing cannot see a timing bug**,
and the two worst defects here — the hang and the unexamined loser — are both timing.
The 30%-churn integration test found the OOM spin; nothing found these until code was
read specifically looking for what the tests could not reach.

## Where the honesty is

- **A dead node costs one RPC timeout per attempt.** Unavoidable without a liveness
  signal — you cannot know a peer is gone without waiting. A *clean* departure (the
  connection drops) fails fast; a **silent** peer that stays connected costs the full
  timeout. Both shapes are covered by separate tests because they behave differently.
- **The straggler heuristic assumes roughly equal-sized shards.** Comparing elapsed time
  against the median completed duration is the simple estimator; shards of one job
  usually are equal-sized and shards of different jobs are not. A progress-rate
  estimator (LATE) would handle uneven tasks and needs the guest to report progress,
  which the ABI does not expose.
- **A checkpoint chain cannot be walked backwards past a block you cannot read**, because
  the link lives inside that block. Recovery therefore works from the *handles the
  caller kept*, newest first. The chain walk is a separate audit function that stops at
  the first missing link. An earlier draft of `recoverCheckpoint` pretended otherwise
  and was wrong.
- **`maxTaskFailures` is a policy, `maxGenerations` is a backstop.** The coordinator
  sizes the backstop to the node pool so it cannot fire before the policy does — two
  caps that both bite would make "why did this shard stop" unanswerable. A caller
  supplying their own `LeaseTable` is choosing their own cap.
