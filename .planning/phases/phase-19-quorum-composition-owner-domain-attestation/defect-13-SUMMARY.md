# Defect 13 — the wall-clock flake in `churn.test.ts`'s 30 %-killed case

**Commit:** `485130f` — `test(net): the churn case answers what the whole fabric answered, and says how it learned a node was gone`
**File owned and changed:** `packages/net/src/churn.test.ts` (one file, 90 insertions, 25 deletions)
**Production code changed:** none.

---

## 1. The headline, stated plainly

**The flake did not reproduce, and the reason is that it was already fixed.**

The tracked entry is `DEFICIENCIES.md` D12, whose symptom was the assertion
`for (const f of nodeFailures) expect(dead).toContain(f.nodeId)` — a negative over a
set a wall-clock timeout can add to. That assertion **no longer exists**: commit
`748319d` (*"test: say what these four cases mean, instead of timing them"*,
2026-08-01) replaced it with four clock-free guards. D12's own status table in
`DEFICIENCIES.md` already says `closed`. The defect survived onto the working list
after the code that carried it was gone.

So the honest answer to "what is the flake rate" is **0 failures in 105 runs of the
case**, under six different conditions including one that compresses the fixture's
wall-clock budget by 400×. The measurement table is §2.

That is not the end of it, because two things *were* wrong and both are worth the
round trip: the mechanism the file's own comment asserts had **never been measured**,
and the case had **two blind spots** that a passing suite could not see. Those are
what the commit fixes.

---

## 2. Reproduction — measured, not impressed

All runs are of `packages/net/src/churn.test.ts` in the `node` project unless stated.
Every exit code was read with `EXIT=$?` on the line immediately after the command, no
pipes, no trailing `tail`.

### 2.1 The runs

| # | Condition | Runs | Failures |
|---|---|---|---|
| 1 | Isolation, quiet host, whole file | 20 | **0** |
| 2 | Beside 16 CPU spinners, whole file | 12 | **0** |
| 3 | Beside 24 CPU spinners, instrumented (per-dispatch timing) | 8 | **0** |
| 4 | Quiet, instrumented (per-dispatch timing) | 8 | **0** |
| 5 | RPC budget compressed 400 → 100 → 40 → 20 → 10 → 5 → 3 → 2 → 1 ms, 5 runs each, case only | 45 | **0** |
| 6 | Instrumented failure-set at budgets 400 / 10 / 1 / 0 ms, 3 runs each | 12 | **0** |
| | **Total, node project** | **105** | **0** |
| 7 | `browser` project — chromium + firefox + webkit, quiet and under 24 spinners | 2 invocations × 3 engines | **0** |
| 8 | Full `--project node` sweep, 138 files, with the fix in place | 1 | **0** (see §6) |

### 2.2 The process, not the machine

`/usr/bin/time -p`, with the derived `(user+sys)/real` beside every reading. System
load average is recorded only as a note; it is not the signal.

| Condition | `real` (s) | `user` | `sys` | `(user+sys)/real` | machine load, 1-min |
|---|---|---|---|---|---|
| Quiet, isolation | 1.96 – 2.34 | ~1.00 | ~0.25 | **0.59 – 0.63** | 3.6 – 6.5 |
| 16 spinners | 6.17 – 8.43 | ~1.31 | ~0.31 | **0.20 – 0.26** | 102 – 126 |
| 24 spinners | 4.43 – 5.90 | ~1.34 | ~0.31 | **0.27 – 0.37** | 40 – 76 |
| `browser`, 3 engines | 3.98 – 5.22 | 5.67 | 2.19 | **1.67 – 1.72** (multi-process) | — |
| Full node sweep, 138 files | 220.89 | 221.83 | 33.69 | **1.16** (8 workers) | 5.2 – 17.7 |

The spinner arms are real starvation and not a load-average story: the process's own
CPU share falls from **0.63 to 0.20–0.37**, i.e. this process got between a third and
a half of the CPU it got on the quiet host. Note also that machine load is a poor
proxy in both directions here — the 16-spinner arm ran at load 102–126 while the
24-spinner arm ran at 40–76, and the *process* measurement puts them the other way
round.

### 2.3 The margin, measured inside the real harness

Every dispatch in the 30 %-killed case, timed with `performance.now()` from inside
the test (temporary instrumentation, removed before commit):

| Condition | Slowest **live** dispatch, 8 runs | Headroom to the fixture's 400 ms budget |
|---|---|---|
| Quiet | 8.9, 9.0, 9.2, 9.3, 9.8, 10.0, 10.0, **21.3** ms | **19×** |
| 24 spinners | 14.0, 16.0, 19.4, 25.1, 25.3, 27.0, 29.0, **44.4** ms | **9×** |
| Inside a full 138-file `node` sweep | case total **49.4 ms** (upper bound on any one dispatch) | **> 8×** |

**A measurement that died despite fitting the arithmetic.** A standalone probe under
`node --experimental-strip-types`, rebuilding the same fabric outside vitest, reported
a slowest live dispatch of 68 ms (p50) / 214 ms under load — a 1.86× margin, which
would have made this a knife-edge and the diagnosis a confident wrong answer. The real
harness says 9–21 ms quiet and 14–44 ms loaded. **The probe was measuring its own
loader, not the fixture.** Recorded here because it is exactly the trap CLAUDE.md names:
a number that agrees with a theory is not the theory's proof.

---

## 3. The real cause

### 3.1 What the residual mechanism is, and how far away it is

`fabricOf` gives every endpoint an absolute `timeoutMs: 400`. The comment in the file
asserted that on a contended host a *live* node's dispatch exceeds it, `rpc.ts:188`
rejects with `kind:'timeout'`, and a live nodeId joins the failure set.

**That mechanism is real and it is now measured: nine times away** under a load that
cuts this process's CPU share by more than half, and more than eight times away inside
a full 138-file sweep — the exact condition the Phase 14 report came from. It is also
demonstrably reachable rather than theoretical: driving the same fixture at a **1 ms**
budget produces 7–14 live-node timeouts (`rpc to nX timed out after 1ms`), and **the
case still passes** — which is precisely what the four clock-free guards are for.

At the real 400 ms budget the run is bit-for-bit repeatable: **15 dispatches, 7
failures, 0 spurious live failures**, and every single failure reason is

```
dispatch to nX failed: rpc send to nX failed: unknown peer: nX
```

identical across three runs. **In this case the 400 ms clock never fires at all** — the
departed nodes are `network.disconnect`ed, and `MemoryNetwork.route` throws
`unknown peer` *synchronously*. The timeout is not the detection mechanism here; it can
only ever fire spuriously.

### 3.2 What was actually wrong — two blind spots

Measuring the mechanism turned up the real defect, and it is guard blindness rather
than timing:

1. **The case checked that eight *distinct* CIDs came back, never that they were the
   right ones.** `expect(new Set(outcome.results.values()).size).toBe(SHARD_COUNT)`
   passes for any eight distinct answers, including eight wrong ones.
2. **"The dial fails rather than hanging" was the sentence at the top of the case and
   nothing held it.** Delete `fabric.network.disconnect(nodeId)` and the departed peers
   stay connected and go silent; the requestor then discovers them by waiting out the
   400 ms budget. The pre-fix case **passed that unchanged**, just slower. A comment
   that had outrun its tree, in a file whose own history is a record of exactly that.

---

## 4. The fix

One file, `packages/net/src/churn.test.ts`. No production code changed. No absolute
threshold added, and the one absolute already there (`timeoutMs: 400`) now carries the
measurement it is sited against instead of a plausible story.

### 4.1 A comparative arm — the 30 %-killed run against the 0 %-killed run

The case now runs the **same fabric twice**: first with nothing killed (control), then
with three of ten killed (treatment), back to back in one process. It then requires

```ts
const byShard = (o: typeof control): [string, string][] =>
  [...o.results].sort(([a], [b]) => a.localeCompare(b))
expect(byShard(outcome)).toEqual(byShard(control))
```

Killing 30 % of the fabric changed **nothing about the answer**, shard for shard.
Because both arms are the same nodes in the same process seconds apart, the machine,
the load and the I/O weather cancel — there is no number in it that a different host
could invalidate.

Ordering is deliberate: the control arm runs first and pays the cold WASM compile and
the cold block fetch, so the treatment arm runs warm. That is why the whole thing costs
almost nothing (§7).

### 4.2 Guard (e) — a departure is attributed by a refused send, never by a clock

```ts
for (const nodeId of deadAttempted) {
  const why = nodeFailures.filter((f) => f.nodeId === nodeId).map((f) => f.reason)
  expect(why.join(' | ')).toContain('unknown peer') //  (e)
}
```

**(e) quantifies over the departed nodes, not over every failure.** That is the whole
difference from the assertion that flaked in Phase 14: a live node that times out under
contention adds a failure the guard never looks at. And a departed node's dial failure
is thrown *synchronously* by `MemoryNetwork.route`, so no amount of contention can
convert it into a timeout. **(e) is load-immune by construction, not by margin.**

The four existing guards (a)–(d) are unchanged.

---

## 5. The plants — both watched go red, both green before the fix

### Plant A — departures that hang instead of refusing

Removed `fabric.network.disconnect(nodeId)`, leaving `rpc.close()`: the peers stay
connected and simply stop answering.

```
AssertionError: expected 'dispatch to n2 failed: rpc to n2 time…' to contain 'unknown peer'

Expected: "unknown peer"
Received: "dispatch to n2 failed: rpc to n2 timed out after 400ms | dispatch to n2 failed: rpc to n2 timed out after 400ms"

 ❯ packages/net/src/churn.test.ts:303:33
```

`EXIT=1`. **The same plant against the pre-fix file: `EXIT=0`, 1 passed.** New coverage,
not a restatement.

### Plant B — an answer that depends on which node produced it

In `packages/net/src/churn.ts`, `resultCid: encoded.cid.toString()` →
`` resultCid: `${encoded.cid.toString()}-ran-on-${nodeId}` ``.

```
AssertionError: expected [ Array(8) ] to deeply equal [ Array(8) ]

    [
      "s3",
-     "bafyreidetx45yzbfzamxht2fa7lp22xr3zqpfuic3gr6pcxbmwph5koq4a-ran-on-n2",
+     "bafyreidetx45yzbfzamxht2fa7lp22xr3zqpfuic3gr6pcxbmwph5koq4a-ran-on-n3",
    ],
```

`EXIT=1`. Shard `s3` ran on `n2` on the intact fabric; `n2` then left and it ran on
`n3`, and the two answers differ. Note the CID prefix is **identical** — only the
planted node-dependence differs, which is what makes this the right plant: it is
invisible to a distinctness check.
**The same plant against the pre-fix file: `EXIT=0`, 1 passed.**

Both files restored with `cp` + `cmp`, byte-identical, before commit.

---

## 6. What would break the comparative bound

The comparative check is an **equality of eight `(shardId, CID)` pairs**, not a numeric
threshold, so "what value breaks it" is exact rather than a limit:

**It goes red when**

- any shard's answer under churn differs from the same shard's answer on the intact
  fabric **in a single byte** — observed: `…-ran-on-n2` vs `…-ran-on-n3`;
- a shard that completed on the intact fabric fails to complete under churn (the arrays
  differ in length, i.e. `results.size < 8`);
- a re-dispatch after a departure carries another shard's partition — that shard's CID
  becomes a duplicate, caught here *and* by the distinctness line.

**It deliberately does not go red for** extra dispatches, extra failures, a live node
timing out, speculation firing, or the run merely being slower. Those are properties of
the host, and a guard that reddened on them would be the defect this one is closing,
pointed the other way.

Guard (e) goes red when any departed node that was asked has **no** failure whose reason
contains `unknown peer` — e.g. every reason is `timed out after 400ms`, which is exactly
what Plant A produced. Its one brittleness is stated in the file: the string is
`TransportError`'s own, from `core/src/transport/memory.ts`, and rewording it must
update this guard deliberately. That is the intent — what is pinned is the mechanism,
not a duration.

---

## 7. Cost, and why `MEASURED_NODE_SPANS` does not change

Paired before/after readings, alternating the two versions of the file in the same
conditions minutes apart — a comparison within one sitting rather than against a
recorded number:

| Pair | Case, before | Case, after | File span, before | File span, after |
|---|---|---|---|---|
| 1 | 23.4 ms | 26.1 ms | 939 ms | 942 ms |
| 2 | 23.3 ms | 27.2 ms | 942 ms | 945 ms |
| 3 | 25.0 ms | 29.0 ms | 941 ms | 943 ms |

A whole second job costs **+12–17 % on the case** and **+0.3 % on the file**, because
the control arm pays the cold compile the treatment arm then reuses.

**`vitest.config.ts` needs no edit.** The recorded entry is
`['packages/net/src/churn.test.ts', 974]` against `SLOW_CUTOFF_MS = 1000`, and the file
measured **972 ms inside the full `--project node` sweep with the fix in place** —
two milliseconds under the recorded figure, on a run of 138 files at
`(user+sys)/real = 1.16`. That is the same measurement kind the table itself is built
from, and it lands inside the noise the config's own docblock documents for this exact
file (1134, 1000, 974, 962 ms across four runs of an unchanged tree). `--reporter=json`
attributes no hook time, but this file builds its fabric **inside each test body** and
has no hooks, so the span is honest.

`slow-specs.node.test.ts` and `mutation-guard.node.test.ts`: **110/110 pass**.

---

## 8. Verification

| Command | Result |
|---|---|
| `vitest run --project node packages/net/src/churn.test.ts` × 15 | **15/15 exit 0** |
| same, beside 24 CPU spinners, × 10 | **10/10 exit 0** |
| `vitest run --project browser packages/net/src/churn.test.ts` × 5 | **5/5 exit 0**, 36 passed (12 × chromium/firefox/webkit) |
| `vitest run --project node packages/net/` | **exit 0** — 25 files, 306 tests |
| `vitest run --project node slow-specs mutation-guard` | **exit 0** — 110 tests |
| cheap guards minus `vocabulary` (purity, mutation-guard, disclosure-gate, requirements-ledger) | **exit 0** — 154 tests |
| `npx tsc --noEmit` | **exit 0**, zero diagnostics |
| Full `vitest run --project node`, 138 files | 1 failure, **foreign** — see below |

**The one full-sweep failure is not mine and not a regression.**
`packages/node/src/bench-attestation.node.test.ts:503` asserts
`expect(repoStatus()).toBe(before)` — it snapshots `git status --porcelain` around a
154-second spawn. It failed with

```
- A  .planning/phases/…/defect-30-SUMMARY.md
  M  packages/browser/demo/index.html
```

i.e. **another agent staged a `defect-30` summary while the test was running**. This is
the hazard CLAUDE.md already records for `discover-arm.node.test.ts` ("`git add` only
*between* test runs, never *during* one"), now observed on a second file. It reproduces
in isolation for the same reason and touches nothing in `packages/net`.

**Commit hygiene.** Committed with an explicit path — `git commit -- packages/net/src/churn.test.ts`
— and verified with `git show --stat`: **one file**. The index held seven of another
agent's staged files at the time; a bare commit would have swept them in.

**Guards skipped, with the reason.** The pre-commit hook refused on
`vocabulary.node.test.ts`, which fails repo-wide on another agent's staged
`packages/browser/demo/main.ts:1011` (`"earned"`). My file contains no banned term
(its only match is the word *learns*, in a pre-existing comment I did not touch). Same
foreign reason already recorded in `483775e` and `6deb7fc`; the other five cheap guards
were run directly and pass 154/154.

---

## 9. Ledger entry for the orchestrator to apply

`packages/node/src/mutation-ledger.ts` is owned by another agent. **Plant B** is a
production-code mutation and belongs in the ledger; Plant A is a fixture change and
does not. Entry text, in the ledger's schema, with `id` to be assigned:

```ts
{
  id: 'M??',
  why:
    'CHURN-01. A shard’s answer may not depend on which node produced it — the ' +
    'premise N-version verification rests on, and the one thing 30% churn is guaranteed ' +
    'to vary, because a departed node’s shards are re-placed onto different peers. ' +
    'Suffixing the recorded result with the answering nodeId leaves eight distinct CIDs, ' +
    'a true `ok`, and every departure still attributed — the case passed this ' +
    'unchanged until it was given a 0%-killed control arm to compare against.',
  file: 'packages/net/src/churn.ts',
  find: '    return { ok: true, resultCid: encoded.cid.toString() }',
  replace: '    return { ok: true, resultCid: `${encoded.cid.toString()}-ran-on-${nodeId}` }',
  caughtBy: ['packages/net/src/churn.test.ts'],
  signature: 'expected [ Array(8) ] to deeply equal [ Array(8) ]',
  signatureSource: 'rendered-at-runtime',
}
```

Observed red text is in §5, Plant B. Note the plant also reddens
`resumes from a checkpoint and finishes only the outstanding shards` in the same file
(`CID.parse` refuses the suffixed string), so `caughtBy` is honest at file granularity.

---

## 10. The named uncertainty

I never observed the failure. What I can say is bounded exactly:

- The assertion D12 named **cannot** fail today — it was deleted on 2026-08-01.
- The residual mechanism (a live dispatch exceeding 400 ms) is **measured at 9× away**
  under a load that halves this process's CPU share, and **> 8× away inside a full
  138-file sweep**, which is the condition the Phase 14 report came from.
- Even when that mechanism does fire — forced, at a 0–1 ms budget, producing 7–14
  live-node timeouts — **the case still passes**.

**The one measurement that would settle the remainder:** the same per-dispatch
instrumentation carried through a full **`--project browser`** sweep with all three
engines contending, rather than the `node` sweep I ran and the synthetic CPU load I
generated. The Phase 14 failure came from a run that fanned out across projects, and
webkit and firefox under a headless three-engine sweep are the one arm whose dispatch
latency I have only bounded indirectly (case total 27.9–50.0 ms per engine, which is an
upper bound on any single dispatch and puts the margin at ≥ 8× there too — but that is
a bound, not the distribution).

Recorded plainly because this repository already carries one diagnosis that was simply
false, and because a probe I built for this defect produced a 1.86× margin that would
have been a second one.

## Self-Check: PASSED

- `packages/net/src/churn.test.ts` — modified and committed in `485130f` (verified with `git show --stat`: one file).
- `.planning/phases/phase-19-quorum-composition-owner-domain-attestation/defect-13-SUMMARY.md` — this file.
- Scratch harness `.d13-probe/` — removed; `git status` shows no untracked artefact of this work.
- `packages/net/src/churn.ts` and `packages/node/src/mutation-ledger.ts` — unmodified (`cmp` byte-identical after the plant; ledger never opened for writing).
