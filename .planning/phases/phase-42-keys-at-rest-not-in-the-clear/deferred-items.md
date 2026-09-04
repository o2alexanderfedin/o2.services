# Deferred items — Phase 42

Out-of-scope discoveries, logged rather than fixed. Each names what was measured, why it is
not this phase's, and what a reader would need to close it.

---

## `lease-expiry.e2e.test.ts` is intermittent in a full `e2e` sweep — found 42-03, not caused by it

**What was observed.** Two full `e2e` lane runs on 2026-09-04, both with a quiet
`[host conditions]` banner:

| Run | Result |
|---|---|
| first | `2 tests \| 2 failed`, both `AssertionError: expected 0 to be greater than 0` at `readArm:501` |
| second | `2 tests \| 1 failed`, the *other* case, same assertion and message |

and, run **alone** on a quiet host between the two, `2 passed (2)`, `EXIT=0`
(`load/core 1.53 before, 1.34 after`).

**Why it is not 42-03's.** Two independent readings, neither of them plausibility:

1. **There is no path from the diff to the file.** `lease-expiry.e2e.test.ts` imports
   `DEFAULT_LEASE_MS` from `@o2/core` and `DEFAULT_PROBE_TIMEOUT_MS` from `@o2/net` and nothing
   else from this repository's packages. 42-03 touched `@o2/core`'s `sealed-secret.ts` and its
   barrel line, and `@o2/browser` — this spec drives no browser, opens no identity store, and
   spawns `bin/agent.ts` agents that run under the node tier's `writes-no-new-secret` default,
   which 42-02 set and 42-03 did not move.
2. **The spec's own docblock records this exact failure as a known flake**, in these words
   (`lease-expiry.e2e.test.ts:108-113`):

   > The failure that buys against is real and was observed: at eight shards, with the CPU
   > baseline still taken before the coordinator's dials, a full `e2e` sweep produced an arm
   > where the holder had answered **everything** before the poll saw it, and it failed on
   > `expected 0 to be greater than 0` — correctly, by name, and still a flake.

   Same assertion, same message, same condition (*a full `e2e` sweep*), written down by the
   author of the file before this phase existed.

**What would close it.** The docblock's own analysis points at the margin between `BURN_MS` and
a holder's queue depth: the arm fails when the holder answers everything before the poll sees
it, so the reading depends on the shard count buying enough queue. Closing it means re-siting
that margin as a within-run comparison rather than as a count chosen against one host — which
is a re-measurement of that file's two paired constants and belongs to whoever owns CHURN-04.

**Not fixed here**, per 42-03's scope fence: it is a pre-existing sensitivity in a file this
plan does not touch, and widening the plan to re-site another feature's timing constants would
be the plan absorbing work nobody classified.
