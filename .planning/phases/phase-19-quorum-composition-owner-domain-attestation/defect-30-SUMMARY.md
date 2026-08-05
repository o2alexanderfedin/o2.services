# Defect 30 — `tools/aot/lift.node.test.ts` carried a false recorded diagnosis

**Closed 2026-08-03/04.** Commits `59bca14` (diagnosis) and `3d6806b` (code).
Host: 8-core arm64 macOS, 32 GB, with a foreign workload the owner runs and three other
agents on the same tree. Every figure below is `/usr/bin/time -p` on *this* process, never
a system load average.

---

## 1. The measurements

### Both conditions, whole file, before any change

| condition | result | `real` | `user` | `sys` | `(user+sys)/real` | Σ case spans |
|---|---|---|---|---|---|---|
| **A — alone**, host 1-min load 5.9 | **99 passed, exit 0** | 216.83 s | 2.31 s | 0.69 s | **0.0138** | 15.957 s |
| **B — under load I created** (12 CPU burners + 6 fork loops), load 39.98 → 102.59 | **99 passed, exit 0** | 284.29 s | 2.69 s | 0.74 s | **0.0121** | 17.511 s |

Command in both: `npx vitest run --project node tools/aot/lift.node.test.ts --reporter=verbose`.
Exit code read with `EXIT=$?` on the line immediately after, no pipe.

**Neither condition reproduced the recorded failure.** 99/99 twice, exit 0 twice.

Reading the ratio: both are ~0.013, i.e. this process was **waiting, not starving** — the
comparability key for a spec that spends its life in `spawn` and in a Docker daemon whose
CPU lives outside this process tree entirely. The ratio is not a verdict here; it is the
statement that a CPU-starvation explanation does not fit either run.

Three things the two runs establish that the load average cannot:

1. **Load moved the cases by 9.7 %** (15.957 s → 17.511 s of summed case span) while moving
   **the wall clock by 31 %**. The gap is the integration `beforeAll`: 200 s of run A's
   216.83 s — **92.6 %** — is three real container runs that the per-case reporter
   attributes to *no case at all*. That is the `--reporter=json` blind spot the config
   docblock already documents, and it is why "the file takes 850 s" and "the cases take
   850 s" are different claims.
2. **The worst single stub case went 211 ms → 337 ms** at load 102, against the 20 000 ms
   budget it is handed. 59× of headroom at twice the load this file was ever reported
   failing at. The budgets were never it — for the third independent time.
3. The two heaviest cases (deliberate 5 s timeouts) moved 5 218 → 5 360 ms and
   5 224 → 5 325 ms: ~2 %, because they are dominated by the driver's own timer.

### The reproduction, and its control

The recorded state does not occur on a healthy host, so the mechanism was reproduced by
plant. One stub in the digest-mismatch case changed to `exec sleep 25` — a single attempt
that misses its own 20 000 ms budget — and nothing else:

| plant | observed | elapsed |
|---|---|---|
| slow stub, retry **as shipped** | `Error: Test timed out in 60000ms.` | **60 013 ms** (`real 61.50`) |
| slow stub, retry **disabled** | `AssertionError: expected 'docker-not-answering' to be 'image-digest-foreign'` | **20 016 ms** (`real 24.29`) |
| slow stub, against **the fix** | `an answer that cost 20005 ms leaves no room for another attempt inside the 30000 ms this wrapper may spend inside a 60000 ms case, so this case never ran: docker was reached but did not answer within 20000 ms … attempts so far: 20005 ms` | **20 010 ms** (`real 21.39`) |

Row 1 is the recorded symptom, character for character. Row 2 is the same condition with
one line changed, and it costs a third as much and says what happened. The file was
restored from a `cp` snapshot and `cmp`'d to zero after every plant.

### After the fix, whole file

| | result | `real` | `user` | `sys` | `(user+sys)/real` | Σ case spans |
|---|---|---|---|---|---|---|
| **D — alone** | **102 passed, exit 0** | 247.28 s | 2.53 s | 0.69 s | **0.0130** | 22.561 s |

`vitest.config.ts` records this file at **245 713 ms**; D measured **246.28 s** of file
span. **0.2 % apart, so no span moved and the config is untouched** — which is the
condition the brief put on editing it.

The 6.6 s of added case span is accounted for, not absorbed: three new cases at
303 + 701 + 1 505 = **2 509 ms**, the comparative case at **+2 007 ms** over the absolute
it replaces (it now takes two readings instead of one), and the rest ordinary run-to-run
drift on stub cases whose absolute cost is a few hundred milliseconds. **4.5 s deliberate
on a 246 s file, 1.8 %.**

---

## 2. What the recorded diagnosis said, and why it was wrong

Two claims lived in
`.planning/phases/phase-18-discovery-capacity-placement/deferred-items.md` item 2.

**Claim 1 — the heading: *"fails under full-suite load, passes in isolation."*** Already
retracted in the tree by an 18-12 re-measurement, and falsified again here: the file
passes in isolation *and* under a load twice as heavy as the band it was reported failing
in. The 18-01 reading attributed a failure by plausibility — "the file makes 48 docker
invocations and is the heaviest spec, so contention" — which is the move `CONVENTIONS.md`
now forbids by name.

**Claim 2 — the 18-12 re-measurement's conclusion, and the actively harmful one:**

> *"something makes these docker invocations hang for a full 60 s apiece on an idle
> machine."*

**`60000` is not a duration anything spent. It is that file's own
`vi.setConfig({ testTimeout: 60_000 })`.** Every one of those ten lines reads
`Error: Test timed out in 60000ms` because the *framework* killed the case at *its own
budget* and reported *its own budget* back. A duration that equals a timeout is evidence
of the timeout and of nothing else. The reading inverted that: it took the budget for a
measurement of the work, and then sent the next reader to look for a hang in Docker — the
one place there was nothing to find. That reader was me, twice, before I ran the plant.

The tell was in the file the whole time. Its opening docblock documents the identical
error one level down, from 2026-08-01: *"Two timers armed for the same instant, and
vitest's is armed first — so a stub that was slow to spawn killed the test rather than
letting the driver's own timer fire, and the case reported `Error: Test timed out in
5000ms` at 5006 ms instead of asserting the classification it exists to check."*

---

## 3. The real cause

**An unbounded retry — bounded in count, unbounded in time.**

`despiteAFullProcessTable` (added 2026-08-02, after the 18-01 reading and on the same day
as the 18-12 one) retries up to `HOST_SPAWN_ATTEMPTS = 4` times with 250/500/750 ms
backoff. It counted attempts and measured nothing. But **an attempt's duration is a budget
the caller chose**, and the budget nine call sites choose is `METADATA_BUDGET_MS = 20 000`:

```
4 × 20 000 ms  +  250 + 500 + 750 ms  =  81 500 ms   of driver budget
                                          60 000 ms   of framework budget
```

So the framework always fired first, always at 60 000 ms, and always with nothing to say —
while the driver's own named refusal, produced **twice** on the way there, was discarded
by the wrapper that had asked for it.

**The count matches exactly.** Eleven wrapped call sites hand the driver a budget whose
four-attempt envelope exceeds the case budget:

| call sites | budget handed to the driver | worst envelope |
|---|---|---|
| 9 × `resolveImage`/`liftElf` at `METADATA_BUDGET_MS` | 20 000 ms | 81 500 ms |
| 1 × `liftElf` with **no `timeoutMs` at all** → capped at `IMAGE_RESOLVE_CAP_MS` | 60 000 ms | 241 500 ms |
| 1 × `resolveImage('/nonexistent/definitely-not-docker')` | 20 000 ms | fails `ENOENT` in ~1 ms, never retried |

Ten can actually spend it. **Ten `Error: Test timed out in 60000ms` were recorded.** The
remaining two of the recorded twelve are the two deliberate-timeout cases at a 5 000 ms
budget (envelope 21 500 ms, inside the case), which is the pair 18-01 recorded by name
with an assertion failure rather than a timeout.

And the wall clock closes too: ~250 s of real work (measured: 216.8 s here, and the run
that produced the 850 s figure had a heavier host) plus **ten framework kills of 60 s
each** ≈ 850 s. The 217 s in the config table was never wrong.

The sharpest single instance is the tenth: a `liftElf` call with no `timeoutMs`, so the
inspect budget is `IMAGE_RESOLVE_CAP_MS` = 60 000 ms — **the same instant as the case
budget.** One timer against an identical timer, in the file whose docblock says that
defect was corrected.

**The retry did not make this file flaky. It made the file's flake unreadable, and tripled
what each instance cost.**

---

## 4. What changed

All in `tools/aot/lift.node.test.ts` unless stated.

1. **`CASE_BUDGET_MS = 60_000`** — the framework budget is now a named constant that
   `vi.setConfig` and the wrapper both read, instead of a literal only vitest knew about.
2. **`RETRY_ENVELOPE_SHARE = 0.5`** — the retry is bounded by a *share of the framework
   budget*, not by a count. A share and not a millisecond figure so the two can never
   again be armed for the same instant by arithmetic that happened somewhere else.
3. **The wrapper's stopping rule is comparative and taken within one run.** It refuses to
   *start* an attempt that — judged by the **worst attempt it has already seen in this same
   run** — could not finish inside the envelope, and it abandons one still running when the
   envelope is spent. Consequence, with no number written down about either case: a
   millisecond-cheap `EAGAIN` keeps all four retries on any host, and a 20 s non-answer
   buys none. That is the correct policy either way — an attempt that spent 20 s of a 60 s
   case did not fail to *start*, it failed to *answer*, and asking a swamped daemon three
   more times spends the case's whole budget on hope.
4. **Every exit from the wrapper is now the caller's answer or a thrown sentence carrying a
   number this run measured** — the driver's diagnosis plus each attempt's cost. Nothing
   waits for vitest to end it.
5. **The `liftElf` call with no `timeoutMs` now passes one.**
6. **The absolute wall-clock bound is gone** (§5).
7. **`describes every failure it can produce` is a mapped type now.** It was an array whose
   closing comment claimed *"`describeLiftFailure` has no `default:` arm, so this count and
   `tsc` between them make an unnamed failure impossible to add quietly."* That is false —
   the missing `default:` obliges the *renderer* to handle every arm and says nothing about
   whether the *list* names every arm, and a `Set` of what is present can only count what
   somebody remembered to write. `docker-not-answering` entered `LiftFailure` on
   2026-08-02 and never reached the list: **the one kind at the centre of this defect was
   the arm the completeness case did not cover, for two days, reading green.** It is now
   `{ readonly [K in LiftFailure['kind']]: Extract<LiftFailure, { kind: K }> }`, so leaving
   a kind out does not compile.
8. **`deferred-items.md`** — the false diagnosis corrected in place, with the entry left
   whole so the retraction is findable rather than edited away.

**Untouched:** `vitest.config.ts` (no span moved — 246.28 s against 245 713 ms recorded),
`.planning/STATE.md`, `.planning/ROADMAP.md`, `packages/node/src/mutation-ledger.ts`, and
every file outside `tools/aot/`. `tsc --noEmit` on the whole tree: **0 errors.**

### `STATE.md` line 149 still points here

It reads *"`deferred-items.md` item 2's 'passes in isolation' diagnosis is false. Phase 21
owns it."* That is now closed by the two commits above. **I did not edit `STATE.md` — the
brief forbids it.** The orchestrator may want to update that line.

---

## 5. The comparative bound, and exactly what makes it fail

**Replaced:** `TIMER_BEAT_A_HARDCODED_MINUTE_MS = 8_000` and one
`expect(elapsed).toBeLessThan(8_000)` — this file's only wall-clock assertion, and so the
whole of its exposure to machine load. It was *well* sited (64 replays: passing population
max 418 ms at load 10, max 702 ms at load 64; failing population ~60 000 ms). It is
replaced anyway, because a well-sited absolute is still an absolute: 8 000 ms encodes this
machine on that day, and the same reading elsewhere is either a false red or a bound so
generous it stopped saying anything.

**With:** the same claim as a **difference between two arms of one case**, taken seconds
apart on the same host:

```
elapsed(2 000 ms budget) − elapsed(400 ms budget)   ≈   2 000 − 400  =  1 600 ms
```

Spawn cost, machine speed and the I/O weather of the day appear in **both** terms and
cancel **algebraically** — a property a ratio of raw elapsed times would not have. What
survives is only the driver's response to what it was asked for.

**It fails when the observed difference falls below `0.5 × 1 600 = 800 ms`, or rises above
`2 × 1 600 = 3 200 ms`.** Concretely:

- **A driver that stops tracking the caller's budget** makes both arms cost the same and
  the difference collapses to ~0. **Planted and watched**: `resolveImage`'s `run(…,
  timeoutMs)` changed to `run(…, 400)` — a driver that *spends* a fixed budget while still
  *reporting* the caller's, so every non-timing assertion in the case still passes. Red in
  813 ms:

  > `AssertionError: asking for 1600 ms more budget bought 0 ms more wall clock (403 ms → 403 ms): expected 0 to be greater than 800`

  That is the anti-vacuity argument for keeping a timing assertion at all: the kind check
  and both message checks pass under this plant, and only the difference sees it.
- **The historical defect** (`Math.min(timeoutMs, IMAGE_RESOLVE_CAP_MS)` → the bare cap)
  was also planted: red in 16.3 s with `expected 'image-has-no-digest' to be
  'docker-not-answering'` — **by assertion, not by framework kill**, which is why the stub
  now sleeps 8 s rather than 30. A plant that reds by timeout is a plant nobody can read.
- **Accidental red** would need the jitter between two arms taken seconds apart to exceed
  800 ms. The worst *drift* ever measured on this host, load 10 → 102, is ~300 ms. The
  signal is 5× the worst recorded noise.

The completeness guard was proved failable the same way: deleting one entry gives
`error TS2741: Property '"docker-not-answering"' is missing`.

The wrapper's own envelope is proved by three cases at ~1/30th scale (injected
`caseBudgetMs`, so they cost 303 ms / 701 ms / 1 505 ms rather than a minute), and the
fourth — the pre-existing `gives up loudly rather than skipping` — is their anti-vacuity:
it proves a **cheap** failure still buys all four attempts, so the envelope cannot have
quietly repealed the retry it bounds.

---

## 6. What is still not known, named as one measurement

**Why an attempt missed its 20 000 ms budget on that host on 2026-08-02.** The same stub
measures 337 ms here at load 102 — 59× under — so I cannot explain a 20 s non-answer, and
I will not guess at one. Two candidates I could neither confirm nor exclude: a Docker
Desktop VM degraded by a container left behind by an earlier killed run, and macOS
`syspolicyd` exec-scanning of freshly written stub binaries. **Neither was measured and
neither should be written down as a cause.**

**The one measurement that settles it: the per-attempt elapsed time.** The old behaviour
destroyed exactly that — which is the point of this whole entry — because the framework
kill reported its own budget and threw away the driver's two 20 s observations. The fix
records it. The next occurrence arrives reading:

> `an answer that cost 20005 ms leaves no room for another attempt inside the 30000 ms this wrapper may spend inside a 60000 ms case … attempts so far: 20005 ms`

If that figure comes back at ~20 000 ms, the driver's timer fired and the daemon really
was silent. If it comes back at a few hundred milliseconds with the case still red, the
condition is not the daemon at all. One reading distinguishes them. Until then this is a
**named uncertainty, not a cause**, and the timing envelope — which is fixed and proved —
was the defect regardless of what triggered it.

---

## 7. Ledger entry — text only, for the orchestrator to apply

`packages/node/src/mutation-ledger.ts` is owned by another agent right now, so this was
**not** written. The `find` string was verified to occur **exactly once** in
`tools/aot/lift.ts`.

```ts
  {
    id: 'M63',
    why:
      'AOT-01. The bound this replaced was absolute — `expect(elapsed).toBeLessThan(8_000)` — and ' +
      'an absolute encodes the machine, the load and the I/O weather of the day it was written. ' +
      'The claim is "the caller\'s timeout reached `resolveImage`", so the case now asks twice in ' +
      'one run, with a 400 ms budget and a 2 000 ms budget, and reads the difference: spawn cost ' +
      'cancels algebraically and only the driver\'s response to the request survives. This plant is ' +
      'the reason the timing half is kept at all — it spends a fixed budget while still *reporting* ' +
      'the caller\'s, so the classification assertion and both message assertions pass untouched and ' +
      'nothing but the difference sees it. Measured: `asking for 1600 ms more budget bought 0 ms ' +
      'more wall clock (403 ms → 403 ms): expected 0 to be greater than 800`, red in 813 ms.',
    file: 'tools/aot/lift.ts',
    find: '[\'image\', \'inspect\', image, \'--format\', \'{{join .RepoDigests "\\\\n"}}\'],\n    timeoutMs,',
    replace: '[\'image\', \'inspect\', image, \'--format\', \'{{join .RepoDigests "\\\\n"}}\'],\n    400,',
    caughtBy: ['tools/aot/lift.node.test.ts'],
    signature: 'gives up on a wedged inspect in the time it was given, not in a hardcoded minute',
    signatureSource: 'test-title',
  },
```

Two notes for whoever applies it. `tools/aot/lift.node.test.ts` is in `SLOW_NODE_SPECS`
(245.7 s), so `npm run test:mutations` will spend that on this entry unless the driver can
be pointed at a `-t` filter — the case itself costs 2.4 s. And the signature is the title
rather than the assertion text because the assertion carries per-run millisecond figures,
which is the `rendered-at-runtime` trap the ledger's own docblock describes.

---

## 8. Verification

| check | result |
|---|---|
| `npx vitest run --project node tools/aot/lift.node.test.ts` | **102 passed, exit 0**, 247.28 s |
| `npx tsc --noEmit` (whole tree) | **0 errors** |
| pre-commit cheap guards (vocabulary, purity, mutation-ledger, disclosure, ledgers) | 186 passed, both commits |
| `git show --stat` on each commit | only my own files |
| every plant restored by `cp` + `cmp` | `cmp` exit 0, four times |

Files committed: `tools/aot/lift.node.test.ts`,
`.planning/phases/phase-18-discovery-capacity-placement/deferred-items.md`, and this
summary. `tools/aot/lift.ts` was planted twice and restored byte-identically both times —
it carries **no** change.
