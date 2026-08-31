---
phase: 41-cross-host-determinism-for-the-aot-track
plan: 1
subsystem: aot
tags: [aot-03, elfconv, determinism, github-actions, blocker-refuted]
provides:
  - "the second aarch64 Linux host, shown obtainable rather than impossible"
  - "a dispatch-only workflow and a one-host reading driver, both guarded"
  - "AOT-03's blocker sentence retired with the measurement that retires it"
affects:
  - .github/workflows/aot-cross-host.yml
  - tools/aot/cross-host-lift.mjs
  - tools/aot/cross-host-workflow.node.test.ts
  - tools/aot/cross-machine.node.test.ts
  - .planning/REQUIREMENTS.md
  - .planning/ROADMAP.md
decisions:
  - "No criterion is claimed met — the dispatch is an owner act and no second reading exists"
  - "The workflow is workflow_dispatch-only, guarded, because a job with a cost does not start by itself"
  - "AOTW-06 is untouched: 26-GATE.md's NO-GO stands"
metrics:
  duration: ~30 min
  completed: 2026-08-30
---

# Phase 41 — the blocker was the finding

## What was claimed, and what is true

`tools/aot/cross-machine.node.test.ts` carried a careful, well-evidenced argument. Swapping
elfconv's `:amd64` image does not move the translator to another machine, it swaps the
translator — `backend/remill/lib/Arch/Arch.cpp` gates the AArch64 dispatch behind
`ELFCONV_AARCH64_BUILD` and no build defines both fronts, so the `:amd64` image handed an
AArch64 fixture reaches `LOG(FATAL)` (measured 2026-08-17, exit 134). All of that stands.

Its conclusion did not. It said AOT-03 needs a second `aarch64` Linux machine, *"which is a
thing this repository does not have and cannot synthesise."*

```
$ gh repo view --json visibility,nameWithOwner
{"nameWithOwner":"o2alexanderfedin/o2.services","visibility":"PUBLIC"}
```

A public repository, and GitHub offers hosted **Linux arm64** runners. The second host is
**obtainable**. What the sentence described was effort, not a physical wall — and this project
has a standing record of stating the second when it means the first. That is the whole result
of this phase, and it is worth more than a partial measurement would have been.

## What was built

- `.github/workflows/aot-cross-host.yml` — `workflow_dispatch` and nothing else, every job on
  an `-arm` runner, a cheap `report-host` job first, and a refusal to lift on a host whose own
  `uname -m` is not `aarch64`. A label is a request; the uname is what was granted.
- `tools/aot/cross-host-lift.mjs` — one host's reading: the sha256 of the lifted bytes, the
  artifact itself, the toolchain versions, the blind spots, and **that host's own reported
  platform**, read from its own process. Criterion 2's discipline, the same one
  `announcedMachine` applies to spawned agents. It never compares and never normalises:
  comparing is a separate act, so the thing that decides "identical" is not the thing that
  produced the bytes.
- `tools/aot/cross-host-workflow.node.test.ts` — four cases. Two plants watched red and
  restored `cmp`-clean: a `push:` trigger added under `on:`, and one job moved to
  `ubuntu-latest`. Both are two-word diffs, which is why they are read rather than trusted.

## What is NOT met, stated plainly

**No criterion.** Criterion 1 asks for two readings compared; one does not exist.
`CROSS_MACHINE_BLIND_SPOT` stays attached to every artifact and `AOT-03` stays `Partial`
with its verdict unchanged — only its blocker moved.

Two things are read off documentation rather than run, and are named as such:

1. Whether `ubuntu-24.04-arm` is schedulable for this repository, and at what cost. The
   workflow's `report-host` job is that experiment — a job that never starts is the answer as
   much as one that finishes.
2. That a hosted arm64 runner's elfconv lift is comparable at all. It may diverge for reasons
   that are about the runner rather than about elfconv, and criterion 1 says a divergence is
   reported **as a divergence** rather than normalised away.

**The dispatch is an owner act**, because running it means pushing to a public repository, and
this project treats publication as a separately-triggered gate rather than as a consequence of
a phase progressing.

## Criterion 3 is untouched

`AOTW-06` stays gated on a `wasm32-wasi` LLVM nobody has built. `26-GATE.md`'s NO-GO stands,
its symbol half is still an upper bound conclusive in neither direction, and nothing in this
phase reports progress on it. The first deliverable there is a compiler, not a feature.
