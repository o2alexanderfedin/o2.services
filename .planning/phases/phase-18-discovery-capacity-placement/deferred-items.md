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

## 2. `tools/aot/lift.node.test.ts` — CLOSED 2026-08-03. Both readings below were wrong, and the second was wrong in the more expensive direction

> **Read this box before the entry.** The entry is kept whole, retractions and all, because
> it is the record of a diagnosis that cost this project time twice. What was measured on
> 2026-08-03 is in the closing section, *What it actually was*, and in the module docblock of
> `tools/aot/lift.node.test.ts`. In one line: **`60000ms` is that file's own `testTimeout`,
> not a duration anything spent.** Nothing hung for a minute. The retry wrapper's envelope —
> four attempts of a 20 s budget, 81 500 ms — did not fit inside the 60 000 ms case that
> contained it, so the framework killed each case at its own budget and reported its own
> budget back. Ten call sites could reach that state; ten timeouts were recorded.

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

### Re-measured during 18-12, and **the "passes in isolation" half no longer holds**

**Measured 2026-08-02, on a quiet host.** The heading above is now wrong in its second clause
and is left standing so the change is findable rather than edited away.

| run | load at start | result |
|---|---|---|
| full `--project node` | 5.34 | **7 failed** \| 1778 passed \| 2 skipped, 128 files, 707 s |
| `lift.node.test.ts` **alone** | 4.39 | **12 failed** \| 87 passed, 850 s |

Isolation made it **worse**, not better — the opposite of 18-01's reading, and taken with
`docker info` succeeding immediately beforehand. The failure mode has moved too: 10 of the 12
are `Error: Test timed out in 60000ms`, not the `expected 'docker-unavailable' to be …`
assertion 18-01 recorded. The file has also grown from 73 tests to 99 since that reading, and
alone it now takes 850 s against the config table's 217.1 s.

**Still not this plan's, and demonstrably not this plan's doing.** `lift.node.test.ts` imports
only node builtins, vitest and `./lift.ts`; nothing under `tools/` references any file 18-12
touched, and all four of those files are tests or ledger data — `git diff HEAD~3 HEAD` names no
production file at all. Every other one of the 128 node files passed.

**What this changes about the recommendation.** Serialising the file would no longer be enough,
because contention is no longer the whole story: something makes these docker invocations hang
for a full 60 s apiece on an idle machine. The probe's inability to tell a *slow* docker from an
*absent* one is now the primary finding rather than a secondary one, and whoever picks this up
should re-measure before trusting either the 18-01 reading or this one.

### What it actually was — measured and reproduced 2026-08-03, tracked defect 30

The sentence directly above — *"something makes these docker invocations hang for a full 60 s
apiece on an idle machine"* — is **false**, and it is the one that sent the next reader looking
for a hang. `60000` is not a duration anything spent. It is
`vi.setConfig({ testTimeout: 60_000 })` at the top of `lift.node.test.ts`. Every one of those ten
lines reads `Error: Test timed out in 60000ms` because the framework killed the case at *its own
budget* and reported *its own budget* back. **A duration that equals a timeout is evidence of the
timeout.** Reading it as a measurement of the work is how a budget gets mistaken for a hang.

**What was really there.** `despiteAFullProcessTable` — a retry wrapper added 2026-08-02, after
the 18-01 reading and on the same day as the 18-12 one — bounds its retries by a *count* and not
by a *duration*, and an attempt's duration is a budget the caller chose. Four attempts of
`METADATA_BUDGET_MS` plus the backoffs is **81 500 ms of driver budget inside a 60 000 ms case**.
So the framework was always first to fire, always at 60 000 ms, and always with nothing to say —
while the driver's own named refusal, produced twice on the way there, was discarded. Eleven call
sites handed the wrapper a budget that large and **ten of them could actually spend it**; the
eleventh is `/nonexistent/definitely-not-docker`, which fails `ENOENT` in about a millisecond and
is not retried. Ten is the recorded count, exactly. The remaining two of the twelve are the two
deliberate-timeout cases at a 5 s budget, which is the pair 18-01 recorded by name.

**Reproduced, not inferred**, because a count that agrees with a theory is not the theory's proof:

| condition | result | elapsed |
|---|---|---|
| one stub changed to `exec sleep 25`, retry as shipped | `Error: Test timed out in 60000ms` | **60 013 ms** |
| the identical plant, retry disabled | `expected 'docker-not-answering' to be 'image-digest-foreign'` | **20 016 ms** |
| the identical plant, against the fix | `an answer that cost 20005 ms leaves no room for another attempt inside the 30000 ms this wrapper may spend inside a 60000 ms case … attempts so far: 20005 ms` | **20 010 ms** |

The retry did not make this file flaky. It made the file's flake **unreadable**, and tripled what
each instance cost — which is where 850 s came from: ~250 s of real work plus ten framework kills
of 60 s each. The 217 s in the config table was never wrong.

**And the "fails under load" half is wrong too, in the heading and in the 18-01 body.** Two whole
runs on 2026-08-03, timed with `/usr/bin/time -p` because a system load average says nothing
about whether *this* process got a core:

| condition | result | `real` | `user` | `sys` | `(user+sys)/real` | Σ case spans |
|---|---|---|---|---|---|---|
| alone, host at 1-min load 5.9 | **99 passed, exit 0** | 216.83 s | 2.31 s | 0.69 s | 0.0138 | 15.96 s |
| under 12 CPU burners + 6 fork loops, load 40 → 102 | **99 passed, exit 0** | 284.29 s | 2.69 s | 0.74 s | 0.0121 | 17.51 s |

Load past twice the band this file was ever reported failing in moved the **cases** by 9.7 % and
the worst single stub case from 211 ms to 337 ms — against the 20 000 ms budget it is handed. It
moved the **wall clock** by 31 %, and that lands almost entirely on the integration `beforeAll`:
93 % of this file's wall clock is three real container runs that the per-case reporter attributes
to nothing at all. Neither reading is a bound failing under load, and the recommendations above —
serialise the file, gate on `loadavg()` — would have bought nothing.

**Fixed** in `tools/aot/lift.node.test.ts`: the wrapper now bounds its retries by an envelope
that is a *share* of the framework budget rather than by a count, refuses to start an attempt
that (judged by the worst attempt it has already seen in the same run) would not fit, abandons
one that outlives the envelope, and throws a sentence carrying the driver's diagnosis and every
attempt's measured cost. The one call site that handed `liftElf` no `timeoutMs` at all — and so
armed a 60 000 ms inspect inside a 60 000 ms case — now passes one.

**What is still not known**, stated plainly rather than guessed at: *why* an attempt missed its
20 s budget on that host on 2026-08-02, when the same stub measures 337 ms at load 102 here. The
old behaviour destroyed the only measurement that could answer it, which is the point of this
entry. The fix records it: the per-attempt cost is now in the failure text, so the next
occurrence arrives carrying `attempts so far: … ms` and the question closes on one reading
instead of on another theory.

---

## 3. No guard reads a `file:line` citation in `REQUIREMENTS.md`, and the cheap one would read green

**Found during:** the F-2 follow-up fix on 2026-08-03.

**What went wrong first.** `a5a70c7` corrected four ledger rows; `548e119`, three commits later
in the same plan, inserted fifteen comment lines into `fabric-node.ts` and sixteen into
`browser-node.ts`. Every coordinate written below those points was stale before the plan closed.
Sweeping the rest of the file found the same rot in citations written earlier and by other
plans: **22 of the 27 `fabric-node.ts` / `browser-node.ts` coordinates in the ledger pointed at
the wrong line**, one of them out by 117. Every claim was true; only the coordinates had moved.

**Why a guard is wanted.** `requirements-ledger.node.test.ts` already parses these rows and
already holds their *sentences* against the tree. It reads no coordinate, so this whole class is
unguarded, and it is a class this repository keeps producing — a citation is a claim with an
expiry date in the same way a call-site comment is.

**The cheap version was measured rather than assumed, and it fails.** The tractable check is
"a cited line must not be a comment or blank", since a drifted coordinate usually lands in the
comment block that displaced it. Run against the 22 known-wrong coordinates before they were
fixed, it flags **16 and reads green on 6** — including `SCHED-04`'s `fabric-node.ts:1460`
(landed on `createThread: workerThread,`) and `AUTH-01`'s `fabric-node.ts:1077` (landed on a
`Math.max(…)`). It also needs four exemptions up front, for the citations that deliberately name
prose inside a comment. A guard that misses six of twenty-two while carrying an exemption list is
the failure mode this repository keeps rediscovering: it reads green and it retires the question.

**What a real one needs, and why it is not a line to slip into this diff.** To say *"the cited
line shows what the row names"* the check must first extract what the row names, and the rows
name things in at least six shapes — a constructor call, a property in an object literal, a
method declaration, prose inside a comment, a `describe` title, and a string inside a data table.
An extractor over English rows is a research task with its own measurement, and the alternative —
re-shaping the citation syntax so it carries the text it points at, which is how
`vocabulary.node.test.ts` solved the same problem for its exemptions — is a rewrite of every
citation in the ledger. Either is a plan, not an addition to a documentation fix.
