# The judgement/dispatch ordering assertion compared two different clock sources

**2026-09-14.** `packages/node/src/speculation-agents.node.test.ts` (CHURN-02, criterion 3) failed
intermittently on a **quiet** host. Root cause found, reproduced deterministically, fixed,
flip-tested. Three candidate repairs were measured and rejected; they are recorded here so nobody
spends the runs again.

## The symptom, and what it said before it was made to talk

```
AssertionError: the judgement must precede the dispatch it caused:
  judged at 17655 against a duplicate dispatched at 17655:
  expected 17655.0009765625 to be less than or equal to 17654.916875
```

Both figures round to the same millisecond, so the message named no margin and the reader learned
nothing from it. A second occurrence, with the file running alone, read `6994.20703125` against
`6994.182708`. Two inversions, **84.1 us** and **24.3 us**, always the same assertion, always
sub-millisecond, always in the same direction.

## The banner was wrong, and finding that out was the whole investigation

| reading | value | what it settles |
|---|---|---|
| full `node` lane | 1 file / 266 failed, 1 test / 3850 | the failure exists |
| that lane's `[host conditions]` | **oversubscribed**, load/core 1.70 → 17.87, ceiling 4.00 | the banner blamed the host |
| file alone, run 1 | **FAILED**, host **quiet** (2.61 → 2.52) | **not load** |
| file alone, 12 further runs | 12 passed, quiet throughout | rate ≈ **1 in 13**, not "usually" |
| `git diff --name-only aae2396..HEAD` ∩ this spec's import graph | empty | Phase 33 was not the cause |

*"Passes in isolation"* was **false**, which `CLAUDE.md` § Measurement already warns is a claim to
verify rather than a diagnosis. Skipping that one re-run would have filed a real defect as weather.

## The root cause

Both instants are taken in the same process, and they come from **different clock sources**.

- `judgedAt` is `JobClock`'s: `packages/core/src/job/submit.ts:2141` sets `judgedAt = woke`,
  `:2095` sets `const woke = clock.now()`, and `:1660` makes the default `now: () => Date.now()` —
  the **wall** clock.
- `startedAt` is the fixture's own wrapper, `speculation-agents.node.test.ts:1026`:
  `startedAt: performance.now()` — the **monotonic** clock.

The spec converted the first into the second's basis by subtracting `performance.timeOrigin`, on the
strength of a comment claiming that value *"is exactly the distance between the two origins"*. It is
the distance **at process start**. Afterwards the two sources drift apart, and converting the
**basis** is not converting the **source**.

### Measured, not inferred

Sampling the wall clock at the instant it ticks to a new integer millisecond and reading the
monotonic clock there resolves the offset to sub-microsecond precision. On this host the offset
grows linearly:

```
  t=    24 ms   offset=  -2.0 us          t= 11508 ms   offset=  41.7 us
  t=  3236 ms   offset=  10.5 us          t= 13094 ms   offset=  47.6 us
  t=  8223 ms   offset=  29.1 us          t= 16642 ms   offset=  61.0 us
  t=  9848 ms   offset=  35.2 us          t= 18323 ms   offset=  63.0 us
least-squares slope = 3.075 ppm
```

Replaying criterion 3's exact comparison in a bare loop — wall-clock read taken **first**, so
correct code by construction — inverted **3.3 %** of 79 861 148 adjacent pairs, by as much as
**73.8 us** at 20 s. That is the defect reproduced deterministically in two lines.

## A mechanism proposed and refuted by its own arithmetic

The first reading was *"`Date.now()` truncates to the millisecond, so the coarse value can land
after the fine one."* **Wrong, and recorded so it is not proposed again.** Truncation moves a value
only downward, and `floor(judge) <= judge <= dispatch` holds for every input, so quantisation alone
makes the assertion **more** likely to pass. Resolution is not the mechanism; source divergence is.

## The fix

`speculation-agents.node.test.ts` now supplies a `JobClock` reading the log's own source:

```ts
const FIXTURE_CLOCK = { now: () => performance.now(), sleep: ... }
```

passed on **both** arms, and the conversion is deleted rather than corrected — criterion 3 now
compares two raw `performance.now()` readings with no arithmetic between them.

Checked rather than assumed: `submitJob`'s certificate window is judged by a separate `Date.now()`
read this port never reaches (`submit.ts:2618`, *"this module reads the wall clock, once"*); every
other `clock.now()` is elapsed time or a lease this module granted itself, both basis-independent;
and the one absolute-looking use, a checkpoint's `at`, belongs to a sink this fixture does not have
— both arms pass `'checkpoints-nothing'`, whose log writes nothing (`submit.ts:1411`).

### Three repairs measured and rejected

| candidate | why not |
|---|---|
| a tolerance band | the drift grows without bound with process life, so no fixed band is safe — and criterion 3's whole claim is that the invariant holds with **no** band |
| record the wrapper's instant with `Date.now()` too | that clock is integer-milliseconds and the real gap is hundreds of microseconds, so the comparison collapses to `floor(a) <= floor(b)` — true for every input. An instrument that can no longer fail |
| `now: () => performance.timeOrigin + performance.now()` | keeps the epoch basis, but the round trip rounds at 1.788e12 where a double's step is 2^-12 ms. **Measured: 0.122 us of residual inversion** — 5000x below the gap, and still not zero. Dropping the origin removes the arithmetic instead of shrinking its error |

## The flip test, including two plants that stayed green

| plant | result |
|---|---|
| move `judgedAt = clock.now()` to **after** `dispatchCopy` | **GREEN** — `dispatchCopy` does not await, and the wrapper stamps `startedAt` only after its own `await freeze()`, so a clock read there still lands first |
| `judgedAt = woke + 0.05` (50 us late) | **GREEN** — below that run's gap |
| `judgedAt = woke + 1` (1 ms late) | **RED**, on the named case: *"judged at 10289 against a duplicate dispatched at 10288, margin -748.6 us"* |

Restored by the surgical inverse of each edit and verified `cmp`-clean against a snapshot taken
immediately before planting.

**The two green plants are a finding, not a formality.** The assertion's discrimination threshold is
the **asynchronous gap** between the dispatch call and the wrapper's stamp, which varies —
251 us and 642 us in two observed runs. That variability is also why the drift defect failed about
1 run in 13 rather than every time: it fires only when the accumulated drift exceeds that run's gap.
The comment claiming a plant should redden on an instant *"at or after"* the dispatch was wrong on
both halves and has been corrected: **"at" passes**, because this is `toBeLessThanOrEqual`.

## Evidence the fix holds

- **40 consecutive isolated runs, 0 failures.** At the prior rate that is a 4 % outcome by chance.
- The same probe that reproduced the defect reports **0 inversions above one float step** once both
  sides read the monotonic source.
- `npx tsc --noEmit -p .` exits 0.

## What else changed, and what did not

`ShardResult.judgedAt`'s docblock (`submit.ts:812`) told readers to convert and stopped there. That
advice is necessary and **not sufficient**, and it is what sent this fixture into the gap; it now
records the divergence, the measurement, and that a reader ordering this field against a monotonic
span must supply a monotonic `JobClock` rather than convert and hope.

Criterion 3's failure message now carries the **margin in microseconds**, because both instants
round to the same millisecond and the distance between them is the only reading that matters.

**Production behaviour is unchanged.** The default `JobClock` is still `Date.now()`, which is correct
for a field published as epoch milliseconds; the defect was in a fixture's comparison, not in the
scheduler. The only production edit is documentation.

## The generalisation, and its boundary

The silent form of this defect requires a `performance.timeOrigin` conversion — without one, a
cross-source comparison is off by ~1.8e12 and fails loudly every time rather than rarely. After this
change **the tree contains no such conversion at all**: `grep -rn 'performance\.timeOrigin'` over
`packages`, `tools`, `bin` and `scripts` returns only prose describing this fix. Eighteen files use
both clocks, which is not itself a defect — only comparing a value from one against a value from the
other is.
