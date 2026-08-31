---
status: open
trigger: "`npx vitest run --project browser` once took ~33 minutes to get past collection and produced no test output. It did not reproduce on a re-run. Every hypothesis named at the time has now been tested; none reproduces the magnitude."
created: 2026-08-19T00:00:00Z
updated: 2026-08-31T21:00:00Z
---

## STATE: unreproduced. Three hypotheses dead by measurement; the third took the second's pillar with it

**Amended 2026-08-31.** The line below said *"no agent-executable arm left"*. That was wrong: an
arm existed and is now taken — see Arm 3. It refutes this file's own "difference in kind"
conclusion and the instrument that produced it. The status is unchanged because the registered
decision rule is unchanged, not because nothing was learned.

The original event was never instrumented — no `/usr/bin/time`, no exit code read directly, no
`docker stats`. **Its magnitude is therefore unrecoverable**, and everything below is an attempt to
reproduce the *mechanism* on demand rather than to explain that particular run.

## The control band — and the correction that mattered most

This record previously called the `638.89 s` reading *"a clean-host run with NOTHING else
running."* **That was false.** The log timestamps show it overlapped a concurrent
`--project node` run for ~590 of its 613 seconds. The correction moves the original event from
"3x the baseline" to **~19x**, and it moves the 638.89 s reading out of the baseline entirely
and into the contention table below.

| run | files | tests | real | cpu | share |
|---|---:|---:|---:|---:|---:|
| verify | 294 | 5064 | 94.05 | 151.20 | 1.608 |
| gate-browser | 303 | 5202 | 119.80 | 242.13 | 2.021 |
| gate2-browser | 303 | 5202 | 137.61 | 252.81 | 1.837 |
| 2026-08-21 #1 | 306 | 5214 | 104.03 | 234.39 | 2.253 |
| 2026-08-21 #2 | 306 | 5214 | 103.52 | 231.08 | 2.232 |
| 2026-08-21 gate | 306 | 5247 | 103.19 | — | — |
| 2026-08-21 final gate | 306 | 5247 | 102.92 | — | — |

**`--project browser` takes ~104 s alone.** Site any ceiling against ~140 s, not against 600.

## Arm 1 — the Docker-orphan hypothesis. REFUTED.

Four containers from the real image `ghcr.io/yomaytk/elfconv:arm64`, each running
`sha256sum /dev/zero` with the entrypoint overridden (the image's `/bin/bash --login -c`
entrypoint swallows commands), each measured at 100.0–101.9 % of a core by `docker stats` before
the run and 100.0–100.3 % after — so **half of this 8-core host was held for the entire window.**

| arm | files | tests | real | cpu | share |
|---|---:|---:|---:|---:|---:|
| control (n=2, same day) | 306 | 5214 | 103.78 | 232.74 | 2.243 |
| 4 containers @ 1 core | 306 | 5214 | 122.71 | 232.12 | 1.892 |

**1.18x, exit 0, all 306 files and 5214 tests passed, and total CPU unchanged (−0.3 %).** Taking
half the machine away costs eighteen per cent. An orphan scenario would have to be an order of
magnitude worse than "half the host is gone" to explain a 19x event. Hypothesis dead.

## Arm 2 — concurrent browser automation, run deliberately. INFLATES, BUT NOT TO MAGNITUDE.

`--project node` and `--project browser` started together on purpose, 2026-08-21 05:10:33.
Both exit codes read directly from the log, not from a wrapper.

| project | files | tests | exit | real | cpu | share | vs control | cpu delta |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| browser, concurrent | 306 | 5247 | 0 | **185.07** | 251.39 | 1.358 | **1.78x** | **+8.0 %** |
| node, concurrent | 198 | 2986 | 0 | **434.91** | 802.76 | 1.846 | **1.18x** | −0.6 % |

**Both green. No reds under contention.** Overlap is asymmetric and the table must be read that
way: the browser run was contended for **100 %** of its 185 s window, the node run for only
**43 %** of its 435 s. The node figure is diluted and is not comparable to the accidental
observation below.

## What the three arms say together

| condition | real | cpu | vs control | did it do MORE work? |
|---|---:|---:|---:|---|
| 4 containers holding 4 of 8 cores | 122.71 | 232.12 | 1.18x | no (−0.3 %) |
| node project, deliberate, 100 % overlap | 185.07 | 251.39 | **1.78x** | **yes (+8.0 %)** |
| node project, accidental (g3-browser) | 638.89 | 307.81 | 6.16x | **yes (+32 %)** |

**The direction of the mechanism reproduces on demand; the magnitude does not.** Pure core loss
makes the suite slower and does not change its total CPU. Concurrent browser automation makes the
suite do *more work* — +8 % deliberately, +32 % in the accidental instance. That is a difference
in kind, not in degree, and it is why "the host was busy" is not the explanation.

But 1.78x is not 6.16x, and 6.16x is not the ~19x of the original event. **Three unexplained
factors remain between the strongest reproduction and the thing being explained.**

## Decision rule, registered before the arm-2 reading was seen

- **≥3x** → close as attributed. **Not met.**
- **<1.5x** → close as non-reproducing. **Not met.**
- **between** → record the number verbatim, "contention inflates, magnitude varies", stay open.
  **This is where 1.78x landed.**

No further arm was taken. Every measurement an agent can run on this host has been run; what is
left needs the original event to recur *while instrumented*, which cannot be scheduled.

## Arm 3 — 2026-08-31. THE "DIFFERENCE IN KIND" IS REFUTED, AND SO IS THE INSTRUMENT.

The arm nobody had taken: **CPU accounted per process**, splitting the browser engines from the
lane's own vitest workers. Sampled every 2 s from `ps -eo pid,pgid,time,command`, with the
browser lane placed in **its own process group** (`perl -e 'setpgrp(0,0); exec @ARGV'`) so the
load generator's workers cannot be counted as the lane's. Load generator: `--project node`,
started 5 s earlier, running for the whole window.

| reading | alone | under a concurrent `node` lane | ratio |
|---|---:|---:|---:|
| wall | 118.09 | 273.81 | **2.32x** |
| the lane's OWN vitest workers | 18.4 | 20.8 | 1.13x |
| the three browser engines | 288.1 | 313.5 | 1.09x |
| **total CPU** | **306.5** | **334.3** | **1.09x** |

**The +8 % reproduces — and it is not the tests doing more work.** 25.4 of the 27.8 extra
CPU-seconds are in the browser ENGINES, over 155.7 extra wall seconds: **0.163 of a core, drawn
continuously for as long as the run is alive**, across three headless engines. That is idle
overhead charged for longer, not a second mechanism.

Every reading in the tables above is consistent with that one number:

| reading | extra wall | extra CPU | implied constant draw |
|---|---:|---:|---:|
| arm 2 (2026-08-21) | +81.29 | +18.65 | 0.229 core |
| arm 3 (2026-08-31) | +155.72 | +27.8 | 0.179 core |
| accidental g3 | +535.11 | +75.07 | 0.140 core |

**And the container arm no longer contradicts it.** At +19 s of wall, this model predicts about
+3.4 CPU-s — **+1.5 %** on that base. The arm read −0.3 %. That is agreement inside the
instrument's error, not the "no extra work" the row was taken to show. So *"pure core loss does
not change total CPU, browser automation does"* — the sentence this file's conclusion rested on
— is an artefact of reading a ±1.5 % prediction against a ±50 % instrument.

## The instrument, measured rather than assumed

`/usr/bin/time -p` reported `user+sys` of **185.08** and **277.43** for **two runs of the same
arm**, minutes apart, both green, both 357 files and 6024 tests. A **50 % spread on identical
work**: Playwright launches the engines such that whether their CPU lands in the accounted
subtree depends on reaping order. **Every CPU figure in the tables above came from that
instrument**, which is why the per-process sampler was needed to say anything at all.

`CLAUDE.md` § Measurement already says *"never trust an exit code you did not read directly"*;
this is the same rule one column over. A CPU total for a run that spawns browsers is not read
by timing the shell.

## What this leaves, and why the status does NOT move

One mechanism, not two: contention stretches the wall clock by a factor that varies, and the
CPU column follows the wall clock because three engines idle at ~0.16 core. Nothing here
explains the original ~19x **magnitude**, and the registered decision rule is unchanged: today's
reproductions are **2.32x and 2.39x**, inside the "stay open" band.

**Load was not stacked further to cross 3x.** Adding a second concurrent lane until the ratio
clears the threshold would be choosing the load until the rule is satisfied, which is the
`CLAUDE.md` failure *"never close a gap by widening what counts as passing"* run backwards. The
band is where the measurement landed and that is what is recorded.

## READER HAZARD — the most useful line in this file, and it is unchanged

**Vitest browser mode printed NOTHING for the first ~10 minutes of a run that ended green.**
Per-file lines do not stream on this project. *"No output for N minutes" is not evidence of a
deadlock here* — only total elapsed wall clock is. Anyone who kills a quiet browser run and
reports a hang will be reporting this hazard, not a defect.
