---
phase: phase-18-discovery-capacity-placement
plan: 07
subsystem: scheduling
tags: [governor, duty-cycle, admission, capacity, placement, kernel]

requires:
  - phase: phase-18-discovery-capacity-placement/18-04
    provides: "`NodeCapacity` on every `Admission`, and `planWithOffers`' cross-shard headroom tally — the figure this plan makes live"
provides:
  - "`DutyCycleGovernor.setDutyCycle` — the first mechanism SCHED-04's *user-adjustable* half has ever had"
  - "`DutyCycleOptions.environment: Governor | 'no-environment-governor'` — composition by minimum, live on both sides"
  - "`CapacityOptions.dutyCycle: number | Governor` — one field, two ways of stating one quantity"
  - "`LocalCapacity.slots` and `.load` derived on every read, so the capacity published in an offer answer follows a cap change with no further wiring"
  - "A stated response to nonsense at 0, above 1, and non-finite: refused with a `RangeError`, never clamped"
  - "A corrected `peakInFlight` doc: the `Governor` arm removes the `peakInFlight <= slots` arithmetic that four other files still state unconditionally"
affects: [phase-18-discovery-capacity-placement/18-08, phase-18-discovery-capacity-placement/18-09]

tech-stack:
  added: []
  patterns:
    - "One validator, two entry points: the constructor and the setter route through one helper so they cannot disagree about what a legal cap is"
    - "A getter over two live sources beats a cached composite: both halves of a minimum move, and anything that cached it would report a rate that was true when it was captured"
    - "One reading per decision: `#decide` reads each moving figure once and passes it down, so a refusal string and the capacity it publishes cannot name different numbers"
    - "Correct the doc your change falsifies, in the file you own, and name the files that still state the old form"

key-files:
  created:
    - .planning/phases/phase-18-discovery-capacity-placement/18-07-SUMMARY.md
  modified:
    - packages/core/src/governor.ts
    - packages/core/src/governor.test.ts
    - packages/core/src/placement.ts
    - packages/core/src/placement.test.ts

key-decisions:
  - "Composition is a MINIMUM, not a product: both numbers are ceilings on the same fraction of wall time, and a product would drive `VisibilityGovernor`'s deliberately-positive background floor toward zero the moment any cap was applied on top of it."
  - "`environment` is required with `'no-environment-governor'` as its named absence, so a Node-tier node states that nothing else binds it rather than reaching that by omission."
  - "Nonsense is refused, never clamped — 0, negative, above 1 and non-finite all fall out of one positive predicate. 18-01 recorded what a clamp costs."
  - "One `dutyCycle` field taking `number | Governor`. A separate `governor` option would be one quantity with two answers and a rule for which wins."
  - "A lowered cap bounds STARTING and never retracts a grant; `load` is reported honestly above 1 while the excess drains rather than clamped."
  - "`packages/core/src/index.ts` was NOT edited — every symbol the tier plans need is already exported, and `tsc` confirms. The contended barrel is untouched."
  - "The browser tier's recorded 'two independent throttles' decision is reversed by criterion 3, but `browser-node.ts` is 18-09's file; the exact replacement wording is recorded below instead of edited here."

patterns-established:
  - "Plant the plan's exact mutation, not a mutation that reddens the same test: claim 1's first planting failed the wrong assertion and was redone"

requirements-completed: []

duration: 25min
completed: 2026-08-01
---

# Phase 18 Plan 07: A duty cycle that can change — Summary

**A node's cap can now be moved while it is running, and the slot count it publishes to a
requestor is a reading of that cap rather than a memory of what it was at startup — so
lowering the cap drops the figure in the very next offer answer, with nothing else wired.
The two tiers get identical mechanism; only the control surface differs, which is a
platform fact and not a node class.**

## Performance

- **Duration:** ~25 min
- **Started:** 2026-08-01T21:47Z
- **Completed:** 2026-08-01T22:12Z
- **Tasks:** 2 of 2 (both `tdd="true"`, both RED→GREEN, neither needed a REFACTOR gate)
- **Files created:** 1 (this summary) · **modified:** 4

## Commits

| Commit | Gate | What |
|---|---|---|
| `2a8f47e` | RED 1 | a cap nobody can move is a configuration, not a control |
| `cf75f7e` | GREEN 1 | a duty cycle the user can move while the node is running |
| `2d04ea7` | RED 2 | a slot count computed once is a memory, not a reading |
| `4435fed` | GREEN 2 | a node's usable slots are what it can run now, not at startup |

`git diff --diff-filter=D --name-only` over the whole range is **empty** — no commit in this
plan deleted a tracked file. `git status --short` is empty; nothing was left untracked.

## Verification

| Check | Result |
|---|---|
| `npx tsc --noEmit` (repo root) | exit 0, against a resolver **proven** to read this worktree |
| `npx vitest run --project node packages/core packages/net` | 48 files, **680 passed** |
| `npm run test:node` (whole project) | 113 files, **1607 passed**, 19 skipped, 2 files skipped |
| `npm run test:browser` (whole project) | 219 files, **3366 passed** |
| `purity.node.test.ts` | 14 passed |
| `vocabulary.node.test.ts` | 24 passed |
| `packages/core/src/governor.test.ts` | 8 → **16** passed |
| `packages/core/src/placement.test.ts` | 39 → **47** passed |

**Base-branch check, run before reading anything else.** The worktree was created from the
repository default branch and `git merge-base --is-ancestor
feature/phase-18-discovery-capacity-placement HEAD` printed nothing. It was reset onto
`feature/phase-18-discovery-capacity-placement` (`4b51b45`) on a clean tree, and the two
sanity markers confirmed: `NodeCapacity` appears 4× in `placement.ts`, `class SelfRecordIndex`
1× in `discovery.ts`.

**The resolver proof, because a wholesale `node_modules` symlink is silently wrong.** The main
install's `@o2/*` entries are relative symlinks back to the main checkout, so `tsc` and
`vitest` would verify the main tree and report clean without reading a line of these changes.
Every top-level entry was symlinked **except `@o2`** (184 of them), and `@o2` built by hand
against this worktree's `packages/`. Proven with `createRequire`, then the probe was deleted:

```
@o2/core    -> …/agent-a6a78fd3c771caff8/packages/core/src/index.ts
@o2/net     -> …/agent-a6a78fd3c771caff8/packages/net/src/index.ts
@o2/browser -> …/agent-a6a78fd3c771caff8/packages/browser/src/index.ts
@o2/node    -> …/agent-a6a78fd3c771caff8/packages/node/src/index.ts
vitest      -> /Volumes/…/o2.services/node_modules/vitest/index.cjs
```

`vitest`'s own banner confirms the same thing independently: every run printed
`RUN v4.1.10 /Volumes/…/.claude/worktrees/agent-a6a78fd3c771caff8`.

**The 19 skips are pre-existing environment gates, not this plan.** Docker-image absence,
absent real ELF fixtures, an absent LAN IP and a host-load gate — the same set 17-04 recorded.

## How a live duty-cycle change reaches the advertised slot count

The whole chain, in the order a change travels it. Every link is a **getter**, which is the
point: there is no push, no listener, no invalidation and therefore nothing to forget to call.

| # | Link | Why it cannot go stale |
|---|---|---|
| 1 | `DutyCycleGovernor.setDutyCycle(v)` assigns `#dutyCycle` | validated first; on a refusal nothing is assigned at all |
| 2 | `DutyCycleGovernor.dutyCycle` is a **getter** returning `min(cap, environment.dutyCycle)` | both halves are read on every access, so a tab backgrounding *under* this object is honoured too |
| 3 | `LocalCapacity.#dutyCycleNow()` reads that getter | the number arm returns the constant; the `Governor` arm re-reads |
| 4 | `LocalCapacity.slots` is a **getter**: `max(1, floor(maxConcurrent × dutyCycleNow()))` | derived per read; was a constructor field before this plan |
| 5 | `#decide` takes **one** reading of `slots` and one of the duty cycle, and passes `slots` into `#capacity(slots)` | the comparison, the refusal string and the published figure are one reading, so they cannot name different numbers |
| 6 | `Admission.capacity` = `{slots, inFlight}` on **every** arm, refusals included (18-04) | already true; this plan only made the figure live |
| 7 | `serveAgent`'s `offer` branch answers from `LocalCapacity.would` | unchanged — it reserves nothing, so answering costs no slot |
| 8 | `planWithOffers` keeps its cross-shard headroom tally from what it was told (18-04) | unchanged |

**Measured, not asserted** — `placement.test.ts` "drops the figure a requestor is offered next
— criterion 3's observable": `maxConcurrent: 8`, governor at 1, `would(...).capacity` is
`{slots: 8, inFlight: 0}`; `governor.setDutyCycle(0.25)`; the very next `would(...)` on the
**same object** answers `{slots: 2, inFlight: 0}`.

The pacing half needs no edit at all, and that is the finding the plan asked for: `GovernedExecutor`
reads `governor.dutyCycle` per `execute` (`net/src/governed-executor.ts:63`), so a getter is
honoured with nothing changed in `@o2/net`. `packages/net` passed unedited — 680 tests with
`packages/core`.

## What happens at 0, above 1, and at a non-finite value

**Refused with a `RangeError` naming the value. Never clamped.** All of it falls out of one
positive predicate, written that way so no kind of nonsense needs its own arm:

```ts
if (!(value > 0 && value <= 1)) {
  throw new RangeError(`${field} must be in (0, 1], got ${value}`)
}
```

| Input | Result | Why that answer |
|---|---|---|
| `0` | `RangeError` | 0 is a **stop**, not a throttle — a task in flight would never get another slice, and `1/0 - 1` is an infinite off-period. `VisibilityGovernor`'s background floor is positive for exactly this reason |
| negative | `RangeError` | `-0.5 > 0` is false |
| `> 1` | `RangeError` | a ceiling above full rate is not a ceiling |
| `NaN` | `RangeError` | `NaN > 0` is false — every comparison with `NaN` is, which is why the predicate is positive |
| `Infinity` | `RangeError` | `Infinity <= 1` is false |
| `-Infinity` | `RangeError` | `> 0` is false |

**A refusal is not a change**: `setDutyCycle` validates before it assigns, so a rejected call
leaves the node running at the cap it already had. Asserted separately, because a setter that
threw *after* writing would pass a throw-assertion and have already changed the node.

**Why not a clamp.** 18-01 found that a `Math.max(1, …)` clamp silently turned an operator's
mistake into a differently-configured node. The same shape here would be worse: a clamp at the
governor sets the rate at which real work is paced, and the operator would have no reading
anywhere that disagreed with what they asked for.

**The one place a bound is applied rather than refused, and why it is not the same thing.**
`slots` is floored at 1. That is not a clamp on operator input — the input was already
validated — it is the statement that a heavily throttled node stays a *participant*. At zero
slots `#decide` refuses everything, which is a node that has left rather than a node going
slowly. Asserted at `maxConcurrent: 8, dutyCycle: 0.01`.

**Two ranges, deliberately not two checks.** `LocalCapacity`'s numeric arm keeps its own
`RangeError` byte-for-byte. Its `Governor` arm has **none**: a governor validated its cap when
it was built and validates again on every set, and a second check here would be a second place
for one rule to live. Pinned by a test that takes all three refusals — `LocalCapacity` with
`NaN`, and the governor at 0 and 1.5.

**The composed reading's range, stated precisely rather than re-checked.** The upper half of
(0, 1] holds *structurally*: the result is a minimum with a validated cap on one side, so it
can never exceed the cap. The lower half is the environment's own contract — the `Governor`
port states the range and both implementations check it at construction. This is written into
the getter's doc rather than enforced a third time.

## Every reddening claim, planted and watched

Nothing below is restated from the plan. Each row was written into the source, run, and
reverted by a harness that restores the original bytes in a `finally`. **Every claim the plan
made reddened; none was found false.**

| # | Mutation | File | Reddened |
|---|---|---|---|
| 1b | `yieldSlice` paces from a value captured at construction | `governor.ts` | 5, incl. *moves both the reading and the pacing* — and **only its second assertion**, exactly as the plan predicted |
| 2 | `Math.min(1, Math.max(Number.EPSILON, value))` instead of throwing | `governor.ts` | 4, incl. both the constructor and the setter refusal cases |
| 3a | `dutyCycle` returns the cap unconditionally | `governor.ts` | 3, incl. *binds from whichever side is lower* (**first** assertion) |
| 3b | `dutyCycle` returns the environment unconditionally | `governor.ts` | 2, same test (**second** assertion) |
| 4 | the sentinel treated as an environment reading of 0 | `governor.ts` | 9 |
| 5 | `advertisedCapacity` returns a captured constructor value | `governor.ts` | 3 |
| 6 | `slots` memoised — computed once and remembered | `placement.ts` | 6, incl. criterion 3's observable |
| 7 | the `Math.max(1, …)` floor dropped | `placement.ts` | 2 — the new case **and the pre-existing one** |
| 8 | `slots` clamped up to `inFlight` (the tempting "fix") | `placement.ts` | 2 |
| 9 | `load` clamped to 1 | `placement.ts` | 1 |
| 10 | the numeric arm removed — `slots` requires a `Governor` | `placement.ts` | **19**, of which 15 are pre-existing |
| 11 | the refusal suffix reads the constructor value, not the live one | `placement.ts` | 2 |

**Mutation 1 was planted twice, and the first attempt is worth recording.** The first version
made `setDutyCycle` assign a private field nothing read. It reddened — but it failed the
*reading* assertion, not the *pacing* one, so it did not test the plan's actual claim ("the
first assertion passes and the second fails, which is why both are here"). Version 1b moves the
getter correctly and captures the value inside `yieldSlice`; that is the claim, and it holds.
A mutation that reddens the same test for a different reason proves nothing about why the
test was written.

**Mutation 10 is the "numeric arm did not move" proof.** Removing it fails 15 tests that
predate this plan — including all four cases passing a numeric `dutyCycle`. The stronger proof
is mechanical: `git diff` of `placement.test.ts` over the whole plan contains **exactly one
`-` line, and it is the `--- a/…` header**. The change is byte-for-byte additive; no existing
assertion was edited, weakened or deleted.

## What each task measured

### Task 1 — a governor whose cap can move, and which composes

Sixteen tests, eight new. The three carrying the most weight:

- **The reading and the pacing are asserted separately, in one case.** A `setDutyCycle` that
  moved the getter while `yieldSlice` used a captured value satisfies the first and leaves the
  node running at the old rate — a control that reports success and changes nothing. Planted
  (1b) and watched: the reading assertion passes and the pacing one fails.
- **The minimum binds from either side, in one test, not two.** Environment 0.1 with a cap of
  0.5 reads 0.1; move the environment to 1 and it reads 0.5. An implementation returning either
  side unconditionally fails one half. Planted both ways (3a, 3b).
- **Pacing follows the composed reading, not the cap.** Cap 0.5, environment 0.1, `sliceMs` 50:
  the recorded sleep is **450ms**, not 50ms. This is the case that proves the minimum is not
  merely a reported number.

Also measured: the sentinel is a real arm (cap 0.4 with `'no-environment-governor'` reads 0.4,
not 0); a refused set leaves the previous cap; the refusal names the offending value;
`advertisedCapacity` tracks the reading after a set; and no sleep occurs when both sides are at
full rate.

### Task 2 — a slot count that is a reading, not a memory

Forty-seven tests, eight new plus one regression pin. The four carrying the most weight:

- **Criterion 3's observable, in the kernel.** `would(...).capacity` answers `{slots: 8}` then
  `{slots: 2}` on the same object across a `setDutyCycle(0.25)`. Asserting it here means 18-08
  and 18-09 measure a *wired path* rather than re-proving the mechanism.
- **A cap below what is in flight bounds starting and retracts nothing.** Four in flight at
  `slots: 4`; the cap drops to 0.25 and `slots` reads 2. `would` refuses with the exact string
  `over-committed: 4 of 2 slots in use at duty cycle 0.25`, **and** publishes
  `{slots: 2, inFlight: 4}` — one reading, not two answers. All four keys then release, `inFlight`
  returns to 0, and the next offer is accepted. Three properties in one case, because a bound
  that refused but leaked a slot would satisfy the refusal alone.
- **`load` reads 2 in that window and is not clamped.** Both `toBeGreaterThan(1)` and the exact
  `toBe(2)`, so a clamp to 1 fails and so does a wrong divisor.
- **Any `Governor`, not only the kernel's own.** A local stub class implementing the port is
  driven directly, because the browser tier's source is `VisibilityGovernor` — a different
  class the kernel must not import. What `LocalCapacity` depends on is the port.

Two more the plan did not ask for, both cheap and both closing a real gap: the refusal suffix
**disappears** when a live cap returns to full rate (proving its absence means "unthrottled
now", not "never throttled"), and the refusal names the live rate rather than the constructed
one (`0.25`, and asserted *not* to contain `0.5`).

## The recorded decision this plan reverses, and the exact wording 18-09 must apply

`browser-node.ts` states that the visibility duty cycle is *deliberately not* passed as
`dutyCycle`, calling them two independent throttles. **Criterion 3 reverses that.** The file is
18-09's and is contended, so it was **not edited here**. The paragraph is at
**`browser-node.ts:914-921`** (the plan said `:885-894` — stale by 29 lines), immediately above
`const admission = new LocalCapacity({` at `:926`.

**The code change 18-09 applies** — note it is the *composed* governor that must be passed, not
the `VisibilityGovernor` alone, or the browser tier gains a live environment reading but still
no user-settable cap:

```ts
// `governor` here must be the composed one, e.g.
//   const visibility = new VisibilityGovernor({...})
//   const governor = new DutyCycleGovernor({
//     dutyCycle: options.dutyCycle ?? 1,
//     sleep,
//     environment: visibility,          // <- what `environment` exists for
//   })
// and the same object is handed to `GovernedExecutor` and to `LocalCapacity`.
const admission = new LocalCapacity({
  nodeId,
  maxConcurrent: options.maxConcurrentTasks ?? DEFAULT_MAX_CONCURRENT_TASKS,
  dutyCycle: governor,
})
```

**The replacement comment, verbatim.** It rewrites the paragraph rather than deleting it, and
names the criterion that changed it:

```ts
    // **The governor IS passed as `dutyCycle`, reversing what stood here until
    // Phase 18.** This paragraph read: *"The visibility duty cycle is deliberately
    // not passed as `dutyCycle` … two independent throttles on one path produce a
    // number nobody can predict … The slot count is what this tab will hold at
    // once; the governor is how fast it runs them. They are different questions."*
    //
    // **Criterion 3 is what changed it.** The criterion requires a duty cycle set at
    // runtime to drop this node's advertised capacity *"observable in what the
    // requestor is offered next"* — so the slot count a peer reads is not a separate
    // question from the rate, it is the statement **about** the rate. Two throttles
    // was the wrong frame: there is one throttle with two expressions. **Pacing is
    // the mechanism** — `GovernedExecutor` yields between tasks and never inside one.
    // **The advisory slot count is what this node says about it** — `NodeCapacity` on
    // every `Admission`, which reserves nothing and bounds nothing on its own.
    //
    // The old worry was real and is answered rather than dismissed. A backgrounded
    // tab does now refuse earlier as well as run slower, and that is the intent
    // rather than a compounding of two mechanisms. It is not unpredictable: `slots`
    // is one reading, `max(1, floor(maxConcurrent × dutyCycle))`, floored so a hidden
    // tab stays a participant instead of disappearing. And it retracts nothing — a
    // cap falling below what is in flight bounds *starting* only, every held key
    // stays releasable, and `load` reads honestly above 1 while the excess drains.
    // 18-07 put all three properties under test in `packages/core/src/placement.test.ts`.
```

**Why the reversal is right rather than merely required.** `CapacityOptions`' own doc already
argued for the coupling — *"A node at 25% does not run a quarter of a task; it runs fewer of
them"* — so the old comment was the odd one out, not the settled position. And the "unpredictable
number" objection was answered by 18-04 rather than by this plan: the slot count is **advisory**,
reserves nothing, and the authoritative bound is still the `exec` branch's SCHED-06 admission.
There is no second bound to compound with.

**18-08 (Node tier) needs the mirror of this**, and it is the reason `environment` is required:
a Node-tier node writes `environment: 'no-environment-governor'`, which *states* that nothing
but the user's cap binds it. Left optional, that would be indistinguishable from having
forgotten to pass a governor — a throttle silently not applied.

## Plan errors corrected — the source won every time

Every `file:line` in 18-07-PLAN.md was re-read before it was relied on. 18-04 moved
`placement.ts` after the plan was written, as warned.

| Plan says | Actually | What it is |
|---|---|---|
| `placement.ts:244-304` | **`:386-446`** | `CapacityOptions`, the constructor, and the `slots`/`inFlight`/`load` getters |
| `placement.ts:306-410` | **`:505-568`** | `would`, `offer`, `#decide`, `release` |
| `placement.ts:412-481` | **`:571-640`** | `DEFAULT_MAX_CONCURRENT_TASKS` and its doc |
| `placement.ts:285` | **`:427`** | `this.#slots = Math.max(1, Math.floor(…))` |
| `placement.ts:249-255` | **`:390-397`** | `CapacityOptions.dutyCycle`'s doc |
| `placement.test.ts:292, :303, :326, :343` | **`:319`, `:330`, `:376`, `:456`** | the four numeric `dutyCycle` cases. The count is right; every line number is wrong, by +27 to +113 |
| `browser-node.ts:885-894` | **`:914-921`** | the "two independent throttles" paragraph |
| `browser-node.ts:804-808`, `:884` | **`:831`**, **`:911`** | `new VisibilityGovernor(` and `new GovernedExecutor(counter, governor)` |
| `visibility-governor.ts:111-114` | correct | the `dutyCycle` getter |
| `governor.ts:21-27, 34-59` | correct | `DutyCycleOptions` and the class body |
| `governed-executor.ts:59-91` | correct | `execute` |
| `ports.ts:182-187` | correct | the `Governor` port |
| `fabric-node.ts:1202` | **`:1249`** | `new CountingExecutor(guardSovereignty(provenance(compute), sovereignty))`. `:1202` is inside an unrelated doc comment. Off by **+47** — and a first draft of this row guessed `:1201`, which was also wrong and was corrected by grepping rather than by reasoning about the neighbourhood |

**Claims re-verified rather than taken:**

- *"`DutyCycleGovernor` has zero production callers"* — **TRUE.** `grep -rn "new
  DutyCycleGovernor(" packages/ tools/` returns 17 hits, and filtering out `.test.ts` leaves
  **0**. This is why making `environment` a **required** field broke nothing.
- *"`FabricNode` composes no governor at all"* — **TRUE**, and by the strongest available
  reading: `grep -c "Governor" packages/node/src/fabric-node.ts` returns **0**. The word does
  not occur in the file, so there is no composition to have missed.
- *"`advertisedCapacity` is not on the `Governor` port and nothing reads it"* — **TRUE.** The
  port is four lines; `advertisedCapacity` appears only on the two implementations and in their
  own tests.
- *"`Governor` is already exported from `packages/core/src/index.ts`"* — **TRUE**, and so are
  `DutyCycleGovernor`, `DutyCycleOptions`, `LocalCapacity` and `CapacityOptions`. The plan says
  to add nothing "unless `tsc` requires it"; `tsc` does not. **The contended barrel was not
  touched.**
- *"the plan's `must_haves` truth about a governor composing with an environment-driven one"* —
  measured directly at cap 0.5 / environment 0.1 → 0.1, which is the plan's own worked example.

## Deviations from Plan

### Auto-fixed

**1. [Rule 1 — Bug] `peakInFlight`'s doc stated an invariant this plan falsifies**

- **Found during:** Task 2, reading `placement.ts:463-465` before editing around it.
- **Issue:** the doc said `peakInFlight <= slots` *"is arithmetic and can never fail"*. With
  `slots` a reading, a cap lowered below what is in flight leaves `peakInFlight > slots`
  legitimately until the excess drains. The claim was true when written and is not any more.
- **Fix:** qualified to *"on a node whose duty cycle is a constant"*, with a second paragraph
  stating that the `Governor` arm removes the arithmetic and naming the condition under which
  the unconditional form is still accurate elsewhere.
- **Files:** `packages/core/src/placement.ts`
- **Commit:** `4435fed`

**2. [Rule 2 — Correctness] `#decide` read each moving figure once**

- **Found during:** Task 2, writing the shrinking-cap case.
- **Issue:** `#decide` compared against `this.slots` and then called `#capacity()`, which read
  it again. With a constant that is free; with a governor, a cap moving between the two reads
  would let a node refuse `4 of 2` while publishing a third number — two answers to one
  question, from one call.
- **Fix:** `#decide` takes one reading of `slots` and one of the duty cycle and passes `slots`
  into `#capacity(slots)`. Pinned by `expect(refused.capacity).toStrictEqual({slots: 2,
  inFlight: 4})` beside the refusal-string assertion.
- **Files:** `packages/core/src/placement.ts`, `packages/core/src/placement.test.ts`
- **Commit:** `4435fed`

### Departures from the plan's letter, each with its reason

**3. `Infinity` and `-Infinity` are asserted, not only the plan's four values.** The plan's
proof lists 0, a negative, 1.5 and `NaN`. The standing constraint asks for a stated response at
"a non-finite value", and `NaN` is only one kind. Both are refused by the same predicate;
asserting them costs one line and closes a declared gap.

**4. Two assertions the plan did not name were added, both about the refusal suffix.** That the
suffix *disappears* when a live cap returns to full rate, and that it names the live rate rather
than the constructed one. Without the first, "no suffix" cannot be told from "never throttled".

**5. A regression pin was added that was green on arrival**, and is labelled as such: the
numeric arm's `RangeError` plus the governor's own two. It proves no new behaviour — it pins
that the numeric guard did not move and that no second check appeared on the `Governor` arm.

**6. `packages/core/src/index.ts` is in the plan's `files_modified` and was not modified.** The
plan conditions it on `tsc` requiring it. It does not. Flagging prominently because the barrel
is contended by 18-02 and 18-04: **this plan leaves it byte-identical.**

**No existing assertion was weakened, altered or deleted.** `git diff` of `placement.test.ts`
across the plan contains exactly one `-` line, the diff header. `governor.test.ts`'s six
existing constructions gained the new required field and **kept every one of their asserted
values** — 50ms, 10ms, 90ms, 0.25 and the four `RangeError` inputs are unchanged.

## Limits, stated rather than implied

- **Nothing composes this governor in production yet, and that is 18-08's and 18-09's work.**
  `FabricNode` still composes no governor at all and `BrowserNode` still passes only
  `maxConcurrent` to `LocalCapacity`. What this plan provides is a mechanism with its observable
  under test; what it does **not** provide is a node you can turn down. Criterion 3 is not
  closed by this plan and no part of this summary should be read as closing it.
- **`requirements-completed` is empty, deliberately.** SCHED-04's *user-adjustable* half now has
  a mechanism for the first time since Phase 6, but "user-set at runtime … both tiers …
  honoured immediately" is a claim about tiers, and neither tier is wired. Marking it complete
  here would be marking a requirement complete from the file that cannot demonstrate it.
- **The `Governor` arm has no production construction anywhere**, so `peakInFlight > slots` is a
  state this repository can reach only in a test today. The four files stating the bound
  unconditionally (`net/src/admission.test.ts`, `net/src/counting-executor.ts`,
  `net/src/combine.test.ts`, `node/src/admission.node.test.ts`, and both node factories) are
  **still accurate about their own rigs**, every one of which passes a number or omits the
  field. They were deliberately not edited — several are contended, and rewriting a true
  statement to be more conditional than the code it describes is not an improvement. The
  condition is recorded at `placement.ts`'s own `peakInFlight` doc, where a reader arrives.
- **`advertisedCapacity` remains off the `Governor` port and remains unread.** It was kept
  consistent with the live reading rather than promoted or deleted; deleting it is not this
  plan's call and promoting it would add a port member nothing consumes.

## Known stubs

None. Every path added is reached by a test in this plan. `'no-environment-governor'` is not a
stub — it is a named absence that is exercised, asserted to read as the cap alone, and planted
against (mutation 4).

## Threat flags

None. No network endpoint, auth path, file access pattern or schema at a trust boundary was
added or changed. `packages/core` gained no import outside itself — the only new import is
`type { Governor } from './ports.ts'`, a type-only edge inside the kernel — and
`purity.node.test.ts` passes, so the portable tier still carries no `node:` import, no libp2p
and no `@chainsafe`. The slot count crossing the wire is unchanged in shape and remains
advisory; the authoritative bound is still the `exec` branch's SCHED-06 admission, which this
plan did not touch.

## Self-Check: PASSED

Files claimed, listed off disk:

```
FOUND  packages/core/src/governor.ts             8098 bytes   176 lines
FOUND  packages/core/src/governor.test.ts        8278 bytes   230 lines
FOUND  packages/core/src/placement.ts           33826 bytes   724 lines
FOUND  packages/core/src/placement.test.ts      32649 bytes   748 lines
FOUND  .planning/…/18-07-SUMMARY.md
```

The plan's `must_haves.artifacts` requires `packages/core/src/governor.ts` to provide "a
settable cap and a composed environment source" — `setDutyCycle` and
`environment: Governor | 'no-environment-governor'` are both present and both under test — and
`packages/core/src/placement.ts` to provide "`LocalCapacity.slots` derived live from a duty
cycle that may change", which is the `slots` getter over `#dutyCycleNow()`.

Commits claimed, found in `git log --oneline --all`:

```
FOUND  4435fed  feat(18-07): a node's usable slots are what it can run now, not at startup
FOUND  2d04ea7  test(18-07): a slot count computed once is a memory, not a reading
FOUND  cf75f7e  feat(18-07): a duty cycle the user can move while the node is running
FOUND  2a8f47e  test(18-07): a cap nobody can move is a configuration, not a control
```

## TDD Gate Compliance

Both tasks ran RED → GREEN with the gates committed separately and in order:
`test(18-07)` → `feat(18-07)` for Task 1, then `test(18-07)` → `feat(18-07)` for Task 2. Each
RED was run and **observed failing before any implementation existed** — 8 of 16 failing for
Task 1, 8 of 47 for Task 2, with the pre-existing cases green throughout. No REFACTOR gate was
needed: neither implementation had duplication to remove once green.

## Files this plan did NOT touch, and why

- `packages/core/src/index.ts` — contended; `tsc` did not require an edit.
- `packages/browser/src/browser-node.ts` — 18-09's; the exact wording is recorded above.
- `packages/node/src/fabric-node.ts` — 18-08's.
- `packages/core/src/job/submit.ts`, `packages/net/src/discover-candidates.ts`,
  `packages/net/src/index.ts` — under concurrent edit by another agent.
- `packages/net/src/governed-executor.ts`, `packages/browser/src/visibility-governor.ts` — the
  plan predicted neither would need an edit and said that if one did, that was the finding.
  Neither did, and both packages pass unchanged.
