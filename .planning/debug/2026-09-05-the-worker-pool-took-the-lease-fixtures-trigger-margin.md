# The worker pool took the lease fixture's trigger margin

**2026-09-05.** `packages/node/src/lease-expiry.e2e.test.ts` (CHURN-04) failed intermittently
on both `develop` and a feature branch. Root cause found, flip-tested, fixed. Two candidate
fixes were measured and rejected; they are recorded here so nobody spends the runs again.

## The symptom, and what it said before it was made to talk

```
AssertionError: expected 0 to be greater than 0
 ❯ readArm packages/node/src/lease-expiry.e2e.test.ts:501
```

That is the whole message. It names no arm, no tally, no reading — and the arm it fired on
*scattered*: `short`, `long`, `stopped`, `killed`, a different one most runs.

**Scatter argued for one shared cause rather than against it**, which this project has read
backwards before. So the first act was not a hypothesis but an instrument: the assertion now
carries the fabric's own tally, the arm's name, and the CPU each executor held at the instant
it was signalled. It then said everything at once.

## The measurement

```
arm 'short'   {"granted":12,"completed":12}  silenced executor held 1290 ms of CPU, survivor 60 ms
arm 'stopped' {"granted":12,"completed":12}  silenced executor held 1440 ms of CPU, survivor 40 ms
arm 'long'    {"granted":12,"completed":12}  silenced executor held 1350 ms of CPU, survivor 40 ms
```

`BURN_MS` — the CPU the trigger waits for before silencing the holder — is **60**.

Every shard granted once and answered; nothing lost, nothing surrendered, nothing expired.
The signal landed after the holder had finished the entire job.

## The cause

`WorkerExecutor` posted to exactly **one** worker when this fixture was written on 2026-08-18.
On **2026-08-28**, commit `095fce3` — *"a worker pool sized by the host's cores, one task per
thread"* — made it a pool. Ten days apart, and nothing failed in between because the fixture's
margin was wide enough to absorb the change for a while.

The fixture's floor is a **wall-clock** window: silence the holder while it still has
un-answered shards. Its arithmetic was `SHARDS × cube` — twelve cubes at about 60 ms, so
roughly 720 ms of queue with the trigger firing one cube in. With an eight-thread pool the
queue is `SHARDS / threads × cube` — **two waves, about a tenth of a second**.

Two effects push the same way and both are the pool:

1. the work finishes eight times sooner in wall time;
2. two executors × eight threads saturate all eight cores, so the polling process cannot get
   scheduled to fork `ps`. That is why the first reading above 60 is already 1290.

## The flip test

`hostCoreCount` forced to return `1` — the pool exactly as it stood before 2026-08-28, nothing
else changed, the fixture untouched:

| pool | runs | green |
|---|---|---|
| eight threads | 6 (3 on `develop`, 3 on the branch) | **2** |
| one thread | 3 | **3** |

## Two candidate fixes, measured and rejected

**`--max-concurrent-tasks 1` on each executor.** The trigger fires honestly again — 70 and
110 ms of CPU against a threshold of 60 — but the job stalls at
`{"granted":2,"completed":2}`, 3 runs of 3. That flag bounds **admission**, which is a
different question from how many threads drain what was admitted.

**`SHARDS` scaled by the pool** (twelve per thread, 96 here). Restores the wall-clock queue
exactly and exhausts the fabric: `expected 'no-untried-node' to be 'agreed'`. The constant's
documented ceiling — the survivor's queue against its own renewal point — is real, and the
pool divided it by the same eight, so it did not move.

## The fix

`COORDINATE_N` 300 → 900. A dearer cube widens the wall-clock window without adding shards,
so it moves the floor and leaves the ceiling alone. It costs the survivor the same
parallelism it costs the holder, which is why the wall clock barely moves.

| shard cost | runs | green | wall clock |
|---|---|---|---|
| 300 | 6 | **2** | ~20 s |
| 900 | 7 | **7** | 23.2–23.9 s |

Same host, same day, one constant differing.

## What is left standing

The 900 is an absolute in a file that prefers comparatives, so what it was sited against is
recorded beside it: **eight cores, two executors, sixteen compute threads**. A host with many
more cores narrows the window again by the same arithmetic — and when it does, the failure
now names the tally and the CPU reading instead of saying `expected 0 to be greater than 0`.

**The generalisable lesson is not about this fixture.** A performance change that makes a
component N times more parallel divides every wall-clock margin in the tree by N, including
margins in test fixtures that name no relationship to it. The two are ten days and one
package apart, and nothing linked them.
