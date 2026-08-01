---
phase: phase-18-discovery-capacity-placement
plan: 04
subsystem: scheduling
tags: [placement, admission, capacity, wire-protocol, power-of-d, advisory-bound]

requires:
  - phase: phase-13-1
    provides: "the offer branch answering through `LocalCapacity.would` — non-reserving — and the recorded consequence this plan turns into an assertion"
  - phase: phase-18-discovery-capacity-placement/18-02
    provides: "`RpcRecordIndex.providers` unioning across peers, which is what leaves more than one candidate to bound"
provides:
  - "`NodeCapacity` on every `Admission`, populated by `LocalCapacity` from counters it already had"
  - "The offer response frame carries `slots` and `inFlight`, or a stated absence, validated on the way in"
  - "`planWithOffers` bounds placement across the shards of one job from what each node published"
  - "`rpcAdmission` hands the figures to the placer, and a named absence whenever it learned nothing"
  - "The case that pinned the cross-shard over-commit now asserts the bound, under the same fixture"
affects: [phase-18-discovery-capacity-placement/18-05, phase-18-discovery-capacity-placement/18-07, phase-20-wire-04]

tech-stack:
  added: []
  patterns:
    - "A named absence over a silent default: `NodeCapacity | 'states-no-capacity'` on the port, `NodeCapacity | null` on the wire, and the absence is asserted rather than reached by omission"
    - "The requestor's bound removes a candidate *before* offering it, so it never synthesises a `Rejection` — a node held back was never asked, and `probed: 0` is what says so"
    - "Refuse a corrupt nested value outright rather than folding it into the absent arm, because the absent arm means *unbounded* and a corrupt frame would inherit that"
    - "Assert the read count, not only the reason string: three of this plan's mutations leave the reason text intact and move `probed` instead"

key-files:
  created: []
  modified:
    - packages/core/src/placement.ts
    - packages/core/src/placement.test.ts
    - packages/core/src/index.ts
    - packages/net/src/protocol.ts
    - packages/net/src/protocol.test.ts
    - packages/net/src/agent.ts
    - packages/net/src/discovery.ts
    - packages/net/src/discovery.test.ts

key-decisions:
  - "The bound is ADVISORY and every place it appears says so. Nothing is reserved by answering; the authoritative refusal is still SCHED-06's `exec` branch, untouched by this plan."
  - "No offer reservation and no shard id on `exec`. The `offer` branch still calls `would()`; `exec` and `combine` still call `offer()`. Proven by a `peakInFlight` of 0 after a run of probes over a real endpoint."
  - "A node that states no capacity is left unbounded, never assumed full — assuming full would make every node running an older build invisible to one running this build."
  - "`inFlight` is captured before the offer's own reservation, so two answers compose; planting the opposite reddens the cross-shard tally as well as the local reading."
  - "`planWithOffers` composes the held-back reason itself, on `OfferedPlacement.reason` which is already requestor-composed, and never on a `Rejection`."

patterns-established:
  - "Plant every reddening claim; one of the plan's sixteen was measured to redden a different case than predicted, and the reason is structural"

requirements-completed: [SCHED-02, SCHED-03]

duration: 42min
completed: 2026-08-01
---

# Phase 18 Plan 04: The offer answer says how much room there is — Summary

**A node's answer to an offer now publishes what it can run at once and what it is
running now, and a requestor placing a whole job never hands a node more shards than it
said it had room for — while the offer branch still reserves nothing, proven by a
`peakInFlight` of 0 after a run of probes over a real endpoint.**

## Performance

- **Duration:** 42 min
- **Started:** 2026-08-01T20:12Z
- **Completed:** 2026-08-01T20:54Z
- **Tasks:** 3 of 3
- **Files created:** 0 · **modified:** 8

## Commits

| Commit | Task | What |
|---|---|---|
| `30a0fd1` | 1 | a node's answer to an offer says how much room it has |
| `8b9143d` | 2 | the offer answer carries the node's figures across the wire |
| `b909466` | 3 | the case that recorded the over-commit now asserts the bound |

No commit deleted a tracked file: `git diff --diff-filter=D --name-only 30a0fd1~1 b909466`
returns empty.

## Verification

| Check | Result |
|---|---|
| `npx tsc --noEmit` (repo root) | exit 0, against a resolver **proven** to read this worktree |
| `npx vitest run --project node packages/core` | 24 files, **391 passed** |
| `npx vitest run --project node packages/net` | 24 files, **270 passed** |
| `npm run test:node` (whole project) | 108 files + 2 skipped, **1569 passed**, 18 skipped |
| `purity.node.test.ts` | passed — no `node:` import, libp2p or `@chainsafe` reached `@o2/core` or `@o2/net` |
| `vocabulary.node.test.ts` | passed, `BANNED` read from the file rather than transcribed |

The 18 skips are pre-existing environment gates (Docker image absence, absent real ELF
fixtures, absent LAN IP) and are unrelated to this plan.

### The base branch was wrong, and it is worth recording that it was caught first

This worktree was created from **`main`** (`c62bae5`), not from
`feature/phase-18-discovery-capacity-placement`. `git merge-base --is-ancestor` said so
before anything was read, and the tree was reset onto the phase branch (`b858c46`) on a
clean tree with no stash. The sanity checks then held: `SelfRecordIndex` at
`core/src/discovery.ts:474`, `bin/agent.ts` at 458 lines. Had this gone unnoticed, every
plan citation would have read as stale and the natural conclusion would have been that
the plan was wrong. **This is the third occurrence today.**

### The resolver proof, because a wholesale `node_modules` symlink is silently wrong

The main install's `@o2/*` entries are **relative** symlinks (`../../packages/core`), so
following them through a symlinked `node_modules` resolves back into the main checkout —
`tsc` and `vitest` would verify the wrong tree and report clean without reading a line of
these changes. 184 top-level entries were symlinked individually with `@o2` **excluded**,
and a real `@o2` directory built pointing at this worktree's packages by absolute path.
Proven with `createRequire`, then the probe deleted:

```
WORKTREE core     …/agent-a574eb174aca68831/packages/core/src/index.ts
WORKTREE net      …/agent-a574eb174aca68831/packages/net/src/index.ts
WORKTREE libp2p   …/agent-a574eb174aca68831/packages/libp2p/src/index.ts
WORKTREE node     …/agent-a574eb174aca68831/packages/node/src/index.ts
WORKTREE browser  …/agent-a574eb174aca68831/packages/browser/src/index.ts
PROBE PASS: every @o2 resolves inside the worktree
```

`vitest` and `typescript` resolve from the main install, which is correct — they are tool
binaries, not the code under test.

## The case that was supposed to turn red, and did

`packages/net/src/discovery.test.ts:352` — *"no longer bounds anything across shards —
four land on one 1-slot node"* — was written by Phase 13.1 as a **recorded consequence**
and written to fail when the bound was rebuilt. It failed at exactly the right moment: at
the end of Task 2, with the wire change in and nothing else touched.

```
FAIL  packages/net/src/discovery.test.ts > SCHED-03 over the wire — a node refuses for itself
      > no longer bounds anything across shards — four land on one 1-slot node
AssertionError: expected false to be true
 ❯ packages/net/src/discovery.test.ts:383:62
    383|       expect(placements.every((p) => p.status === 'placed')).toBe(true)
```

**How it was rewritten** — it kept its fixture (one worker, `maxConcurrent: 1`, four
shards, `planWithOffers` + `rpcAdmission`) and its two closing capacity readings, and
changed what it asserts:

| Before | After |
|---|---|
| `nodeIds` = `[only, only, only, only]` | `nodeIds` = `[only]`, three `unplaceable` |
| `rejections` 0 across all four | `rejections` `[]` **per held-back shard**, and `probed` **0** |
| — | `reason` contains `headroom` |
| `inFlight` 0, `peakInFlight` 0 | **retained verbatim** |

Its name is now *"bounds placement across shards — one lands on a 1-slot node, three are
held back"*. Its comment carries the history: what it used to record, which ruling changed
it (**D2**, 2026-08-01), that the bound is advisory, and that the authoritative refusal is
still the `exec` branch's. **It was not deleted, and it was not weakened** — the two
capacity readings that prove nothing was reserved are the same two lines, and their
meaning changed rather than their text: they used to say the offer branch reserves nothing
*and therefore bounds nothing*, and now say it **still** reserves nothing and the bound is
the requestor's own.

A positive case was added beside it — four shards across four 1-slot workers, one each,
with `peakInFlight` 0 on all four — because a bound only ever shown refusing is
indistinguishable from a placer that stopped working.

## `'re-picks onto the one node that did not refuse'` — numbers, as required

**Unedited and unmoved.** `git diff -U0` shows hunks at `268-274`, `352-400` and `400+`
only; nothing between `:277` and `:351` changed, so both pre-existing refusal cases are
byte-identical.

| Reading | Before | After |
|---|---|---|
| `probed` | 4 | **4** |
| `rejections.length` | 3 | **3** |
| chosen node | `order[3]` = `ee93a4f66f8d16b8…` | **same** |
| rejection reasons | all contain `over-committed`, in the nodes' own words | **same** |

This is the case that would expose a requestor-side filter firing on knowledge it does not
yet have. It does not fire, because the tally is built **only** from answers already
received and nothing has been learned about any node before the first offer of the first
shard. That is now stated in the `describe` block's doc rather than left to be rediscovered
— and it is measured, not asserted: mutation 16 below seeds the tally from a pre-placement
probe and this case immediately fails with `expected 'unplaceable' to be 'placed'`, while
`'reports the shard unplaceable when every node refuses'` drops from `probed` 4 to **0**
and loses all three real refusals.

## Every reddening claim, planted and watched

Nothing below is restated from the plan. Each row was written into the source, run, and
reverted from a `cp` snapshot confirmed by `diff -q` — never `git checkout`, and never
`git clean`.

| # | Mutation | Where | Reddened |
|---|---|---|---|
| 1 | refusing arm returns `capacity: 'states-no-capacity'` | `placement.ts` `#decide` | 1 — the refusal-states-capacity case |
| 2 | re-capture capacity **after** `#inFlight.add` | `placement.ts` `offer` | 4 — incl. **both** `planWithOffers` tallies |
| 3 | delete the `available` filter | `placement.ts` | 1 — `probed` 0→1, `rejections` []→[1] |
| 4 | `headroom` initialised to `0` for every node | `placement.ts` | 6 |
| 5 | `'states-no-capacity'` treated as headroom `0` | `placement.ts` | 1 — the named-absence case only |
| 6 | synthesise a `Rejection` per held-back node | `placement.ts` | 1 — `rejections` `[{…}]` vs `[]` |
| 7 | unlearned headroom defaults to `1` | `placement.ts` | 1 — **not the predicted case; see below** |
| 8 | encode capacity as a spread, no discriminant | `protocol.ts` | 2 round trips |
| 9 | corrupt capacity falls back to `capacity: null` | `protocol.ts` | 1 — the refuse-outright case |
| 10 | hardcode `capacity: null` in the offer branch | `agent.ts` | 2 |
| 11 | `would(...)` → `offer(...)` in the offer branch | `agent.ts` | 2 — incl. the `peakInFlight` reading |
| 12 | unreachable arm defaults to `{slots: 0, inFlight: 0}` | `discovery.ts` | 2 |
| 13 | delete the `available` filter | `placement.ts` | 2 wire cases — all four land on `only` again |
| 14 | `would(...)` → `offer(...)` | `agent.ts` | 3 wire cases |
| 15 | `headroom` initialised to `0` | `placement.ts` | 6 wire cases |
| 16 | seed `headroom` from a pre-placement probe | `placement.ts` | 4 — incl. the two **unedited** refusal cases |

### One claim reddened a different case than the plan predicted — and the reason is structural

The plan's claim 7 says defaulting unlearned headroom to `1` reddens *"a caller that makes
no offers is unaffected"*. **It does not, and cannot.** With no `admit`, the recording
wrapper is never constructed, so `headroom` is never written and the filter reads `?? 1`,
which is `> 0` — every node stays available and the case passes. What that mutation
actually reddens is the **states-no-capacity** case, where offers *are* made but no figure
is learned.

The no-offers case is nevertheless load-bearing rather than a test that passes either way:
it is reddened by mutation 4 (initialising headroom to `0`), which is the mutation that
genuinely represents "bound a caller that learned nothing".

### One claim was strengthened rather than reddened

Mutation 3 (deleting the `available` filter) does **not** change the placed/unplaceable
split in the `packages/core` case, because that fixture's `admit` calls
`LocalCapacity.offer`, which reserves — so the node refuses the second shard for real. The
reason string stays plausible (`every eligible node refused s1 (1 refusal)`). What moves is
the **read count**: `probed` 0→1 and `rejections` `[]`→`[{…}]`. Both are asserted, so the
case catches it. This is the in-process shadow of the real thing; the wire case (mutation
13, where `would()` reserves nothing) is where the over-commit is genuine, and there all
four shards land on one node again.

## Plan errors corrected — every `file:line` re-read

| Plan says | Actually | What it is |
|---|---|---|
| `net/src/discovery.ts:88-132` | **`:166-203`** | `rpcAdmission` — the whole function |
| `net/src/discovery.ts:101-114` | **`:182-184`** | where the wire answer becomes an `Admission` |
| `placement.ts:288-304` (`slots`/`inFlight` getters) | **`:292-299`** | `:288` is the `nodeId` getter |
| *"`LocalCapacity.#decide`'s **two** returns"* | **three** | the already-in-flight refusal is a third arm, and it states capacity too |
| *"Every existing assertion in `placement.test.ts`'s `planWithOffers` block that does not pass `admit`"* | **no such case existed** | both pre-existing cases pass `admit`; the regression bar was **added** by this plan |

The `net/src/discovery.ts` drift is explained: Plan 18-02 rewrote `providers` in that file
in wave 1 and moved everything below it down ~70 lines. **Correct as written, verified
individually:** `placement.ts:61-82`, `:169`, `:198-203`, `:216-242`, `:244-410`,
`:412-481`; `job/submit.ts:229`; `protocol.ts:145`, `:199-202`, `:824-847`, `:838-839`,
`:899-904`; `agent.ts:616-652`, `:653-660`; `discovery.test.ts:157`, `:263-275`,
`:352-399`, `:277`.

Two pre-existing assertions in `placement.test.ts` changed outcome, both predicted by the
type widening and **neither weakened** — `toEqual({accepted: true})` became
`toStrictEqual({accepted: true, capacity: {...}})`, which is strictly stronger, with the
reason written at each case. In the `would`-reserves-nothing case the widening is a real
gain: the *published* in-flight count is now asserted to stay 0 across all ten probes, so a
reader of the answer sees the node as free too.

## What each task measured

### Task 1 — every `Admission` states a capacity, or states that it states none

`LocalCapacity` publishes from `this.#slots` and `this.#inFlight.size` on all three arms of
`#decide`. `offer()` returns `#decide`'s answer **unchanged**, so the figure it carries was
read on the line above the reservation — which is why two successive offers on a 2-slot node
read `{slots: 2, inFlight: 0}` then `{slots: 2, inFlight: 1}`. The duty-cycled slot count is
published, not the unthrottled one (`maxConcurrent: 8, dutyCycle: 0.25` publishes `slots: 2`).

The refusal strings are untouched: `over-committed: N of M slots in use` is still composed
in exactly one place, and SCHED-06 still requires it by name.

`planWithOffers` keeps a headroom tally and offers a later shard only to nodes with room.
When every candidate is held back it composes the `unplaceable` **itself**, with `probed: 0`
and `rejections: []`.

### Task 2 — the figures cross the wire

The offer arm became `{accepted, reason, capacity}`, encoded with this file's existing
`found`-style discriminant (`bounded: true/false`) rather than as an explicit `undefined`
key, and parsed with both integers through the existing `asIndex` helper. A frame claiming
capacity with a negative, a non-integer, a string or a missing field is **refused outright**
— seven readings in one case, with the uncorrupted frame asserted as the control so the
case cannot pass against a parser that refuses everything.

Read over a real endpoint: a `maxConcurrent: 1` worker answers `{slots: 1, inFlight: 0}` to
five successive probes — the same figures every time, because answering consumes nothing —
and the seed on the `'accepts-every-offer'` sentinel answers `capacity: null`. A worker with
its one slot genuinely occupied answers `accepted: false` with `{slots: 1, inFlight: 1}`.

### Task 3 — the rewrite

Covered above.

## Deviations from Plan

### Auto-fixed

**1. [Rule 3 — Blocking] `net/src/discovery.ts` had to be threaded in Task 1, not Task 2**

- **Found during:** Task 1, at the first `tsc` run after widening `Admission`.
- **Issue:** widening the type breaks every `Admission` construction site, and
  `rpcAdmission` is one. Task 1's own verify requires `tsc --noEmit` to exit 0.
- **Fix:** all four of `rpcAdmission`'s returns were given `capacity: 'states-no-capacity'`
  in Task 1. That is not a placeholder — at that commit the wire frame genuinely carried no
  figure, so a requestor genuinely learned nothing, and the named absence was the honest
  answer. Task 2 replaced it with `response.capacity ?? 'states-no-capacity'`.
- **Files:** `packages/net/src/discovery.ts`
- **Commit:** `30a0fd1`

### Departures from the plan's letter, each with its reason

**2. `planWithOffers` builds its per-shard options explicitly instead of spreading.** The
plan writes `{ ...options, admit: recording }`. Under `exactOptionalPropertyTypes: true`
that is a type error when `recording` is `undefined` (`admit?: AdmissionControl` will not
accept an explicit `undefined`). The options object is built conditionally instead, which
is the same behaviour and typechecks.

**3. The stub `admit` helpers in `placement.test.ts` return `'states-no-capacity'`, via a
shared `STATES_NOTHING` constant.** Those cases are about sampling, re-pick and the
sovereignty gate, none of which reads a capacity figure. A stub that invented one would
bound the headroom tally on a number no node ever published, and those cases would then be
measuring the fixture. The reason is written at the constant.

**No existing assertion was weakened, altered or deleted.** Every mutation above was
reverted from a `cp` snapshot and confirmed with `diff -q`.

## Limits, in the words the plan requires

- ***The bound is advisory, and "advisory" is not decoration.*** Nothing is reserved by
  answering; the tally lives in one requestor's memory; a dishonest or careless requestor
  over-commits exactly as before and is then refused for real by the `exec` branch's
  SCHED-06 admission, which this plan did not touch. **What D2 removes is wasted round
  trips, not the bound.**
- ***`planWithOffers` still has zero production callers.*** This plan leaves the production
  submit path exactly as it was — `submitJob` places via `planPlacement` from
  `sovereignty.ts`. Making the production path place through offers is **Plan 18-05**, kept
  separate so the two changes can be reviewed apart.
- ***Criterion 2b's re-pick after an `exec` refusal is UNMEASURED on the production path,
  not descoped.*** `submitJob` calls `executeVerified(task, selectedExecutors)` once with no
  retry, and the re-pick is demonstrable only on `runResilient`. Merging the two is
  WIRE-04 / Phase 20's criterion 1.
- ***A duty cycle that changes `slots` at runtime is Plan 18-07's.*** The figure published
  here reads `LocalCapacity.slots`, so it will follow a live slot count without further
  change in this file.
- ***No quantity in this plan describes a workload.*** Every number written down — 1, 2, 4
  slots and shards — is a fixture's configuration, and the source comments say so.

## Known stubs

None. `'states-no-capacity'` and `capacity: null` are **not** stubs — they are named
absences with asserted behaviour on both sides: the port arm is measured by *"does not bound
a node that states no capacity"* and the wire arm by the seed node's `capacity: null`
reading and by *"bounds nothing on a node it could not reach"*.

## Threat flags

None. No new network endpoint, auth path, file access pattern or schema at a trust boundary
was introduced. The `offer` request kind, its handler branch and its encoding all predate
this plan; two non-negative integers were added to an existing response arm and are
validated through the same helper the rest of the file uses.

Worth stating explicitly because it is the tempting misreading: the published figures are a
**capacity disclosure**, not an authorisation surface. They tell a peer how busy this node
is, which is information the fabric's load hints already carry; they grant nothing, and a
peer that lies about its own figures only makes itself less likely to be chosen. The
direction that *would* matter — a requestor lying to itself — is bounded by the `exec`
branch, unchanged.

## Constraints honoured

- **Portable tier clean.** `packages/core` and `packages/net` gained no `node:` import, no
  libp2p and no `@chainsafe` — `purity.node.test.ts` passes.
- **No decision keys on node kind.** The capacity a node publishes is read from its own
  `LocalCapacity` and nothing else; the seed in the fixture answers `null` because it holds
  the `'accepts-every-offer'` sentinel, which is a per-node **setting**, not a kind of node.
- **Contended files untouched.** `git diff --name-only` against the base confirms
  `fabric-node.ts`, `browser-node.ts` and `serve-agent-hooks.node.test.ts` are absent from
  the change set.
- **Mutation ledger intact.** M26 keys on `' || count > MAX_REPORTED_COUNT'` in
  `protocol.ts` and M1/M6/M8/M10/M31/M32 key on text in `agent.ts`; none sits on a line this
  plan touched, and `mutation-guard.node.test.ts` passes.
- **Staged explicitly.** No `git add -A`, no `git clean`, no `git checkout --` of a file
  this agent did not write.

## Self-Check: PASSED

Files claimed modified, confirmed present and in the change set:

```
FOUND  packages/core/src/placement.ts          +203 −  (NodeCapacity, tally)
FOUND  packages/core/src/placement.test.ts     +193
FOUND  packages/core/src/index.ts              +1     (type export)
FOUND  packages/net/src/protocol.ts            +51    (offer arm, encode, parse)
FOUND  packages/net/src/protocol.test.ts       +63
FOUND  packages/net/src/agent.ts               +51    (answer + corrected comment)
FOUND  packages/net/src/discovery.ts           +24    (rpcAdmission's four returns)
FOUND  packages/net/src/discovery.test.ts      +179
FOUND  .planning/…/18-04-SUMMARY.md
```

The plan's `must_haves.artifacts` require `interface NodeCapacity` in
`packages/core/src/placement.ts` — present at `:106` — and the offer response's capacity
fields encoded and parsed in `packages/net/src/protocol.ts` — present in `encodeResponse`
and `parseResponse`.

Commits claimed, found in `git log --oneline --all`:

```
FOUND  b909466  test(18-04): the case that recorded the over-commit now asserts the bound
FOUND  8b9143d  feat(18-04): the offer answer carries the node's figures across the wire
FOUND  30a0fd1  feat(18-04): a node's answer to an offer says how much room it has
```
