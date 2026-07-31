# Deferred items — Phase 14

Out-of-scope discoveries logged during execution. Not fixed, by the scope boundary
rule: nothing here was caused by this phase's changes.

## `packages/net/src/churn.test.ts` — "completes every shard with 30% of the fabric killed" is load-sensitive

**Found during:** Plan 14-02, final full-suite verification.

**Symptom.** `expect(dead).toContain(failure.nodeId)` (`churn.test.ts:192`) failed once
in a full `packages/net packages/core packages/demo` run — a *live* node's RPC was
attributed as a node failure, so a nodeId outside `['n2','n5','n8']` appeared in
`outcome.shards[].failures`.

**Measured, not assumed.**

| Observation | Result |
|---|---|
| Host load at the failing run (`uptime`, 8 cores) | 17.52 / 29.75 / 40.81, rising to 34.98 / 59.40 / 56.80 |
| Same full suite, immediately re-run | 172 files, 2363 tests, 0 failures |
| `churn.test.ts` alone, 3 consecutive runs | 48/48 passed each time |
| `grep -c moduleRecord packages/net/src/churn.test.ts` | 0 |

**Why it is not this plan's.** The test builds no `moduleRecord`, and `parseRequest`'s
new block is skipped entirely when the key is absent — the frames this test encodes
take the identical path they took before Plan 14-02. The failure is an RPC timeout on
a live node under a host running 4–7x oversubscribed, surfacing through the
`kind: 'node'` attribution the test asserts on.

**What would fix it, if anyone wants to.** The timeout is a wall-clock bound in a test
that is otherwise deterministic (`MemoryNetwork`, no sockets). Either raise it, or make
the dispatch failure injected rather than timing-derived so the test stops depending on
scheduler latency at all. Neither belongs in this phase.

## `packages/node/src/acceptance-traceability.node.test.ts` — a spot-check that the ledger has moved past

**Found during:** Plan 14-03, Task 2's `--project node` run.

**Symptom.**

```
FAIL  |node| packages/node/src/acceptance-traceability.node.test.ts
      > the ledger this suite parses is the real ledger
      > found the ids that are certainly in the ledger, in the state the ledger gives them
AssertionError: expected true to be false
 ❯ packages/node/src/acceptance-traceability.node.test.ts:615:43
    615|     expect(locate('SCHED-06')?.satisfied).toBe(false)
```

**Measured, not assumed.** Proved pre-existing by running it against the untouched base
commit `6289882`, with this plan's work stashed:

```
$ git stash push --include-untracked
$ npx vitest run --project node packages/node/src/acceptance-traceability.node.test.ts
 Test Files  1 failed (1)
      Tests  1 failed | 39 passed (40)     # the identical assertion
$ git stash pop
```

**Why it is not this plan's.** The assertion reads exactly two files, and this plan
modifies neither:

| Input | State |
|---|---|
| `.planning/REQUIREMENTS.md:447` | `- [x] **SCHED-06**: …` — flipped to `[x]` by `03b91cf` (verify 13.1) |
| `packages/node/src/acceptance-traceability.node.test.ts` | last touched by `855cdf5`, *before* that flip |
| `git status --short .planning/` during this plan | empty |

So the spot-check is simply stale: `03b91cf` marked SCHED-06 satisfied and did not
update the hand-picked `[ ]` example that had been chosen to be an open row.

**What would fix it.** One line — either change `expect(locate('SCHED-06')?.satisfied)`
to `true`, or pick a different id that is genuinely still open, which is the better fix
because the case's stated purpose is to spot-check *one of each state*. That belongs to
whoever owns the ledger's verification pass, not to a wiring plan.
