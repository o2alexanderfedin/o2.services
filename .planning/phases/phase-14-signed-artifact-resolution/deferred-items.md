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

*Resolved before Plan 14-04 ran.* Base commit `04c2b22` contains `9e721e4 fix(test): a
requirement's state is not a fixture`, and this file's 40 tests pass on it. Left here as
the record of what the entry was for.

## `packages/node/src/transport-bounds.node.test.ts` — a retained-bytes bound that reads the host, not only the code

**Found during:** Plan 14-04, final `--project node` sweep.

**Symptom.**

```
FAIL  |node| packages/node/src/transport-bounds.node.test.ts
      > NET-08 — one peer cannot hold an unbounded accumulation across many streams
      > keeps retained bytes near its budget rather than near what the peer offered
AssertionError: expected 49837224 to be less than 41943040
 ❯ packages/node/src/transport-bounds.node.test.ts:506:22
```

**Measured, not assumed.** Four runs of this file, with the load average taken at each:

| Host load (8 cores) | Result |
|---|---|
| 8.72 → in the full sweep at 16:01:47, all of this plan's work already committed | **16 passed** |
| 12.37 | 1 failed — 49 837 224 retained against a 41 943 040 bound |
| ~12 (immediately after) | 1 failed |
| 7.70 | **16 passed** |
| 10.70 — the whole `--project node` sweep, 86 files | **1280 passed, 0 failed** |

So it is intermittent rather than broken: the final full-project run, on the same tree,
passed it. Recorded anyway, because a bound that reads the host is worth knowing about
before it fails in someone else's phase and is mistaken for a regression.

**Why it is not this plan's.** The file imports `@o2/libp2p`, `SendRefused` from
`@o2/core`, and `RpcEndpoint`/`RpcFailure` from `@o2/net`. This plan modifies **no file in
any of those three packages** — its nine changed files are six under `packages/browser/`
and three `packages/node/src/*.test.ts`. There is no path from any of them to a libp2p
stream's retention. The decisive reading is the first row: the identical committed tree
passed this test 60 seconds before it failed, and the only commit in between
(`4265600`) changes a comment.

The case forces GC through `setFlagsFromString`/`runInNewContext` and then asserts an
absolute byte bound. Under a host running a parallel executor with three browser engines,
collection does not complete inside the window the assertion samples.

**What would fix it, if anyone wants to.** Read the bound as a ratio against what the
peer offered — the test already has that number, and the line below the failure asserts
on it — rather than as an absolute byte count. That makes the reading independent of how
much headroom the collector happened to get. Out of scope here.
