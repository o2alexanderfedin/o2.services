# Deferred items — Phase 16

Out-of-scope discoveries, logged rather than fixed. Each names what was measured and
what would close it.

## `bin/bench.ts` does not exit after a full run, and can stall for tens of minutes

**Found during:** 16-04 Task 4, regenerating `.planning/BENCHMARK-RESULTS.md` with a full run.

Two symptoms of what is very likely one cause. **Both are intermittent**, which is stated
first because the first draft of this entry called the second one deterministic and the
next run falsified it.

**Symptom 1 — the process does not exit.** The published run wrote its artifact 14 s after
starting and was still alive 73 s later at 0 % CPU, having done all its work. Something
keeps the event loop referenced after `main()` resolves. A `--quick` run exits promptly, so
whatever it is arrives with the larger real-transport ladder.

**Symptom 2 — an intermittent multi-minute stall in the leg after the real ladder.**
Measured 2026-07-31, every run below with the reduce leg present:

| Run | `REAL_LADDER` | skewed leg (4 nodes, 20 runs, memory transport) |
|---|---|---|
| A | `[1,2,4,8,16]` (full) | **> 40 min**, ~0.4 % CPU — blocked, not computing |
| B | `[1,2,4,8,16]` (full, the published run) | **≈ 1 s** — 19/19 reduces `ok`, reduce p50 1.26 ms |
| C | `[]` | ≈ 1 s — 20/20 reduces `ok`, reduce p50 1.3 ms |
| D | `[16]` (the rung that ECONNRESETs) | ≈ 1 s |
| E | `[1,2]` (`--quick`) | whole run 4.3 s |

A and B are the **same configuration** and differ by a factor of ~2400. Run A was taken
while a second agent worktree was spawning `bin/agent.ts` processes and the 1-minute load
average was 8.35 on 8 cores; run B at load 5.58. The ~2 min per run in A is consistent
with serialized 30 s `RpcEndpoint` timeouts (four rendezvous rank positions × 30 s), so
the likely shape is *contention pushes an in-process RPC past a 30 s deadline*, not a
deadlock.

**The reduce leg is not the cause.** It is present in every row above, healthy in all four
fast ones, and costs 1.3 ms against a 45 ms map — 3 % of a run. The variable is the
preceding real ladder plus machine load, not the reduce.

**Why it was not fixed here.** 16-04's scope is the reduce leg. Fixing this means finding
what a stopped `FabricNode` leaves referenced — worker threads, file descriptors and
libp2p timers are the candidates, none of them measured.

**What would close it.** Instrument `FabricNode.stop()` against
`process.getActiveResourcesInfo()` across the ladder and find what does not return to its
pre-ladder count; that same handle is the prime suspect for both symptoms. **Phase 23**
rewrites this driver for out-of-process fabrics and is the natural home: per-rung process
isolation would make both symptoms structurally impossible.

**Consequence for the published artifact:** none of the pre-registered figures. Both
ladders complete before the skewed leg begins, and the skewed leg feeds exactly one
supplementary line (`skewed.makespan.p50`). It costs wall-clock, not correctness — but a
30 s timeout that fires under load *could* silently turn a measured rung into an
em-dashed one, so a future run that reports unexpected em dashes should suspect this
before suspecting the fabric.

**Symptom 1 reproduced independently, 16-05 (2026-08-01, load 6.77 on 8 cores.)** A full
run wrote its artifact and every leg completed — including the skewed leg, so symptom 2
did **not** appear at this load — and the process was still alive afterwards with all its
work done. It had to be SIGTERMed. Two things this adds to the entry above:

- Symptom 1 survives the 16-05 combine fix, so nothing about the refused real-transport
  reduce was keeping the loop referenced. That was a live possibility while every combine
  on that ladder was failing, and it is now ruled out.
- It is the **symptom that reproduces**; symptom 2 has now been absent at loads 5.58 and
  6.77 and present at 8.35, which is consistent with the contention explanation above and
  is not further evidence for it.

Still Phase 23's, unchanged.
