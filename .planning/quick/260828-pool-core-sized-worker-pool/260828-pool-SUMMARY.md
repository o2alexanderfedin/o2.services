---
task: core-sized worker pool for task execution
slug: 260828-pool-core-sized-worker-pool
requested_by: owner, 2026-08-28
requested_as: "Единственное что нам реально надо - это ограничивать число одновременно исполняемых задач количеством ядер CPU. Ну и выполнять задачи в WebWorkers."
subsystem: core/executor
completed: 2026-08-28
---

# The worker pool, and the two things I got wrong about what was already there

## The correction that comes first

I told the owner this was **measured absent** — *"ничем не ограничено"*. That was wrong twice,
and wrong in the direction that matters, because the tree's actual defect was the **opposite**
of the one I described.

| what I said | what is true |
|---|---|
| tasks are not executed in workers | they were, since BROW-04 — `WorkerExecutor` posts to a real worker |
| nothing bounds concurrent tasks | `LocalCapacity`'s `DEFAULT_MAX_CONCURRENT_TASKS` = 64 has bounded admission all along |

So a node was not over-committing its cores. It was **using exactly one**, because
`WorkerExecutor` held a single thread and posted every task to it. The ask is a performance
win, not a safety fix.

## Two numbers, two questions — and they must not be reconciled

`LocalCapacity.maxConcurrent` (64) is an **admission** bound on work peers send. `placement.ts`
records why it is deliberately not a core count: admission refusal has no re-pick behind it on
the production submit path — `submitJob` calls `executeVerified` once — so lowering it to a core
count would turn slow jobs into **failed** ones. It was left alone.

The pool is the other question: *how many can actually run?* A node may hold 64 accepted tasks
and run eight.

## What landed

- **`packages/core/src/executor/core-count.ts`** — `hostCoreCount()`, read lazily from
  `navigator.hardwareConcurrency`. Not `os.cpus()`: `@o2/core` is imported by the browser and
  Cloudflare tiers and may not import `node:os` at all. **Measured, not read from docs** — Node
  v23.11.0 reports `navigator.hardwareConcurrency === 8`, agreeing with `os.cpus().length === 8`
  on this host. Fallback is **1**, not a guessed 4: a host that will not say gets a slow node
  rather than a thrashing one.
- **`WorkerExecutor` grew a pool.** `maxThreads` defaults to `hostCoreCount()`. One task per
  thread; work above the bound waits in a queue the executor owns rather than in the worker's
  message queue, where it was invisible and where its deadline ran against a wait nobody could
  see. `threadCount`, `queued` and `maxThreads` are observable.
- **A runaway now takes only itself.** The class docblock had stated the old cost openly and
  named the remedy it lacked — *"a thread pool or one thread per task, and neither is built
  here."* Both are built; there are no co-residents left to abort.
- **The deadline still starts at submission** and covers the queue wait, deliberately: it must
  stay below `DEFAULT_RPC_TIMEOUT_MS` so a requestor gets a named reason instead of its whole
  budget. A clock started at dispatch would let a queued task blow that budget silently.

## One branch is written and cannot be driven, and it says so

`#expire` forks: a **running** task loses its thread, a **queued** one does not. The queued fork
is **unreachable from outside the class**, by arithmetic over two properties it does not control:
one deadline value per executor, and FIFO dispatch. A task queued at *t* expires at *t + d*; the
head it waits behind was submitted earlier, so the head expires first, frees a thread, and the
queued task is dispatched **before** its own deadline can fire. No submission order inverts this.

The fork is kept as defence for the day a per-task deadline or a priority queue lands. The spec
says so in place of a case that would have gone green having exercised nothing.

## Verification

Three plants, each watched red, each restored by the surgical inverse and `cmp`-verified
byte-identical against a snapshot taken immediately before planting:

| plant | red cases |
|---|---|
| pool bound removed (`>= maxThreads` → `>= Infinity`) | 5 |
| default from a literal `4` instead of `hostCoreCount()` | 1 |
| a dying thread also fails the queue (the pre-pool behaviour) | 2 |

`tsc --noEmit` EXIT=0. `--project node` **212 files passed, 1 skipped, 3066 tests, EXIT=0**,
325.67 s real at `(user+sys)/real` **3.73** on a host the banner read as quiet (0.98 → 2.75 per
core). Cheap guards 342/342 EXIT=0. `vitest.config.ts` `files` 212 → 213 and `unitFiles`
134 → 135 for the one new spec, comparative reading, not a re-run of the span table.

**Not covered locally: the browser lane**, where `worker-executor.browser.test.ts` runs against
three real engines. This machine was carrying an unrelated `cpp2rust` build for much of the
session, so CI on a clean runner is the reading that counts for it.

## Not done, and named rather than left implied

- **No reserve.** The pool is *cores*, exactly as asked — not cores minus one. `maxThreads` is an
  option, so a reserve is one line the day somebody measures that it is wanted.
- **No ledger row.** Nothing in `REQUIREMENTS.md` covers pool sizing; this is owner-directed work
  outside the ledger, and inventing a row for it would be fitting the ledger to the work.
- **The win is unmeasured.** No benchmark in this repository reads throughput against pool size.
  That a node now uses N cores instead of 1 is a fact about the code; what it is worth is not
  claimed here, and `bin/bench.ts` declaring its own numbers explicitly is the right place to
  find out.
