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
