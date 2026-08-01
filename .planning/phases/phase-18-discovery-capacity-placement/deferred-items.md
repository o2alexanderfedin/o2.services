# Phase 18 — deferred items

Things found while executing this phase's plans that were **not** fixed, each with what was
measured and why it was left. Out-of-scope discoveries go here rather than into a diff that
was meant to be readable.

---

## 1. `SLOW_NODE_SPECS` in `vitest.config.ts` is stale against its own stated rule

**Found during:** 18-01, after `peer-dial.node.test.ts` landed.

**The rule the config states about itself:** the list is *"every file that came in at or above
1 s"* on a measured per-file span, and its purpose is to keep `npm run test:unit` fast by
excluding those files. The comment records the measurement it was derived from: `test:unit` at
**66 files / 946 tests in 6.46 s**, against `test:node` at **75 files / 1080 tests in 210 s**.

**Measured now, on this worktree:**

| Run | Files | Tests | Wall |
|---|---|---|---|
| `npm run test:unit` (documented) | 66 | 946 | 6.46 s |
| `npm run test:unit` (measured 2026-08-01) | 98 passed + 2 skipped | 1387 | **25.31 s** |
| `npx vitest run --project node peer-dial.node.test.ts` alone | 1 | 6 | ~10–15 s |

`peer-dial.node.test.ts` spawns eight real agent processes across its six tests, so by the
config's own criterion it belongs in `SLOW_NODE_SPECS` — two existing entries are there for
exactly that reason (`sovereignty-placement.node.test.ts`, *"6 real `spawn` calls"*;
`egress-refusal.node.test.ts`, *"10 real `spawn` calls"*).

**Why it was not added.** Adding one file would be a partial application of a rule that is
already broadly unenforced: the list has nine entries and was derived when `test:unit` ran 66
files in 6.46 s. It now runs 98 files in 25.31 s, which means **many** files added since — by
phases 15, 16 and 17 — are also at or above the 1 s cut and also absent. Adding only the newest
one makes the list no more honest while making it look freshly maintained.

**What would close it:** re-run `vitest run --project node --reporter=json`, re-derive the whole
list against the 1 s cut, and update the measurement in the comment so the next reader is
comparing against a real number rather than a 2026-07-29 one. That is its own task with its own
measurement, not a line to slip into an unrelated diff.

---

## 2. `tools/aot/lift.node.test.ts` fails under full-suite load, passes in isolation

**Found during:** 18-01's full `npm run test:node` run.

**Measured.** Three of its 73 tests failed with `expected 'docker-unavailable' to be
'image-digest-foreign'` / `'timed-out'`. Docker was **up** at the time — `docker info` succeeded
and `docker ps` showed a live `o2-lift-…` container. Re-run alone immediately afterwards: **73
passed**. The same file passed in the pre-change baseline run of the same suite, and a **full
`npm run test:node` re-run against the identical tree was green** (107 passed | 2 skipped, exit
0). So the failure is not reproducible and is not a property of the change.

**Reading.** This is host contention, not a regression, and nothing in 18-01 is reachable from
`tools/aot`. The file makes 48 `docker` invocations and is the single heaviest spec in the
repository (217.1 s by the config's own table); running it beside the rest of the suite — which
this plan made marginally heavier — is enough to tip some of those invocations into the
`docker-unavailable` branch.

**Why it was not fixed.** The refusal is correctly named: the driver really could not reach
docker, and reporting that honestly is better than retrying until it gets the answer it wanted.
The defect, if there is one, is that a *contended* docker and an *absent* docker read
identically — and distinguishing them is a change to `tools/aot`'s docker probe, which no plan
in this phase owns.

**What would close it:** either give the probe a distinguishable "docker present but did not
answer in time" refusal, or serialise this file the way the `e2e` and `perf` projects already
serialise (`fileParallelism: false`) so it never competes with the rest of the node project.
