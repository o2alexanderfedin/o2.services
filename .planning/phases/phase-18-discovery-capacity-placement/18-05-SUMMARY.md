---
phase: phase-18-discovery-capacity-placement
plan: 05
subsystem: scheduling
tags: [placement, discovery, offers, sovereignty, candidate-set, submit-path]

requires:
  - phase: phase-18-discovery-capacity-placement/18-02
    provides: "`SelfRecordIndex`, and `RpcRecordIndex.providers` unioning across peers — which is what leaves more than one candidate to sample"
  - phase: phase-18-discovery-capacity-placement/18-04
    provides: "`planWithOffers` with the cross-shard headroom tally, `NodeCapacity` on every `Admission`, and `AdmissionControl` already exported from `@o2/core`"
provides:
  - "`JobSpec.admit` — an offer arm on the production submit path, selected by whether the caller can ask a node anything"
  - "`ShardResult.rejections` — the refusals collected reaching a shard, in the node's own words, `[]` when no offer was made"
  - "`discoverCandidates` in `@o2/net` — a data CID and a peer thunk in, `RemoteExecutor`s and `NodeDescriptor`s out, correlated by peer id"
  - "`discoverExecutors`' first production-shaped caller since Phase 6"
  - "A measured refutation of the plan's regression bar, and two cases that replace it"
affects: [phase-18-discovery-capacity-placement/18-06, phase-19-wire-03, phase-20-wire-04]

tech-stack:
  added: []
  patterns:
    - "Two arrangements of one gate, selected by a fact about what the caller CAN do rather than by a preference — and the shared gate is a shared call, not a shared comment"
    - "Prove an arm did not move by extracting it from both revisions and comparing char-for-char, not by trusting a test that may not discriminate"
    - "A fixture whose transport id deliberately DIFFERS from its node key, because a fixture that makes them equal hides the exact confusion the module removes"
    - "When one assertion masks another, disable the first and re-read — a leg that never runs is a leg that proves nothing"

key-files:
  created:
    - packages/net/src/discover-candidates.ts
    - packages/net/src/discover-candidates.test.ts
  modified:
    - packages/core/src/job/submit.ts
    - packages/core/src/job/submit.test.ts
    - packages/net/src/index.ts
    - packages/net/src/reduce-job.test.ts

key-decisions:
  - "18-CONTEXT.md's open question is answered NEITHER replace NOR compose: the two placers are alternatives selected by the caller, and composing was rejected on the evidence that `planPlacement` slices to `redundancy` before returning, leaving nothing to re-pick onto."
  - "The plan's regression bar for the no-`admit` arm is FALSE and was measured so: forcing the offer arm unconditional reddened NOTHING in 1596 tests. Two discriminating cases were added; without them that arm was unprotected."
  - "`CandidateOptions.dispatch` is a `CapabilitySupplier`, not the plan's `readonly Delegation[]` — `RemoteExecutor`'s constructor takes a supplier and the plan's type would not compile."
  - "`core/src/index.ts` was NOT touched: 18-04 already exports `AdmissionControl` and `Rejection`, so the contended barrel needed no edit at all."
  - "The candidate fixture gives each node a transport id (`peer-N`) that is NOT its node key, departing from `discovery.test.ts`, whose equality is a property of that fixture rather than of a node."

patterns-established:
  - "Measure the plan's stated reddening claim before trusting it as a regression bar; when it does not discriminate, replace it rather than record it and move on"

requirements-completed: []

duration: 88min
completed: 2026-08-01
---

# Phase 18 Plan 05: From a CID to a candidate set, and offers on the submit path — Summary

**`submitJob` gained an offer arm selected by whether the caller supplied an admission
control, and `discoverExecutors` gained its first production-shaped caller since Phase 6.
The load-bearing finding is that the plan's own regression bar for "the other arm did not
move" does not discriminate — forcing the offer arm unconditional reddens nothing in 1596
tests — so the byte-identity was proved by extracting the loop from both revisions and
comparing it character by character, and two cases that genuinely separate the arms were
added.**

## Performance

- **Duration:** 88 min
- **Tasks:** 2 of 2
- **Files created:** 2 · **modified:** 4

## Commits

| Commit | Task | What |
|---|---|---|
| `b07231f` | 1 | submitJob places by offers when it is given a way to ask |
| `9f1b014` | 2 | a data CID and a peer list become dispatchable candidates |

No commit deleted a tracked file: `git diff --diff-filter=D --name-only` returned empty
after each.

## Verification

| Check | Result |
|---|---|
| `npx tsc --noEmit` | **exit 0**, against a resolver proven to read this worktree |
| `npm run test:node` (full) | **112 files passed**, 2 skipped · **1602 passed**, 19 skipped |
| Baseline, measured before any edit | 111 files, 2 skipped · **1588 passed**, 19 skipped |
| Delta | **+1 file, +14 tests** — exactly the 9 + 5 added here |
| `npx vitest run --project node packages/core packages/net` | 50 files, **689 passed** |
| `purity.node.test.ts` | passed — `@o2/core` and `@o2/net` remain PORTABLE |
| `vocabulary.node.test.ts` | passed, `BANNED` read from the file, never transcribed |
| `mutation-guard.node.test.ts` | passed — no ledger `find` text disturbed |

The 19 skips are the pre-existing environment gates and match the baseline exactly.

### The base branch was wrong, for the fourth time today

This worktree was created from **`main`** (`c62bae5`), not from
`feature/phase-18-discovery-capacity-placement`. `git merge-base --is-ancestor` said so
before anything was read; the tree was clean (`git status --porcelain -uall` empty) and was
reset onto the phase branch at `4b51b45`. The three sanity markers then held:
`class SelfRecordIndex` in `core/src/discovery.ts`, `NodeCapacity` in `core/src/placement.ts`
(4 occurrences), and `bin/agent.ts` at exactly **458** lines with `--peer-addr` present
5 times.

### The resolver proof

184 top-level entries were symlinked from the main install with **`@o2` excluded**, and a
real `@o2` directory built pointing at this worktree's packages by absolute path. Proven
with `createRequire` before any result was believed, then the probe deleted:

```
OK   @o2/core   -> …/agent-ab46ded2b7024181c/packages/core/src/index.ts
OK   @o2/net    -> …/agent-ab46ded2b7024181c/packages/net/src/index.ts
OK   @o2/node, @o2/libp2p, @o2/aot, @o2/bench, @o2/browser, @o2/demo  (same tree)
vitest -> /Volumes/…/o2.services/node_modules/vitest/package.json
PROBE PASS
```

`@o2/core/package.json` initially threw `ERR_PACKAGE_PATH_NOT_EXPORTED` — the error text
itself carried the worktree path, which was the first confirmation the farm was right.

## How the ~60 call sites were proved to place byte-identically

Three independent readings, because "every existing test passes" turned out **not** to be
one of them.

**1. The count is exact, not approximate.** `grep -rn "submitJob("` over `packages/` and
`tools/`, excluding the definition, reads **60**. Fifty-eight are in `*.test.ts`; two are
production — `net/src/submit-with-egress.ts:164` and `core/src/executor/task-worker.ts:43`.
`submitJobWithEgress` passes its `spec` through verbatim, so `admit` flows to `submitJob`
untouched when a future caller sets one.

**2. Not one of them supplies `admit`.** `grep -rn "admit:"` finds nine sites; every one is
a `planWithOffers` / `placeWithOffers` / `runResilient` **options** object
(`net/src/discovery.test.ts` ×6, `net/src/sovereign-execution.test.ts` ×2,
`core/src/coordinator.ts:324`). None is a `JobSpec`. So all 60 take the `planPlacement` arm.

**3. That arm's loop is byte-identical, and this was measured rather than asserted.** The
loop moved inside an `if`, so `git diff` shows it re-indented. Both revisions were parsed,
the placement loop extracted by brace-matching, each line trimmed, and the two compared:

```
IDENTICAL (indentation normalised): true
lines: base=16 head=16
```

All sixteen lines, `dispatchCount` nudge included, character for character.

## The plan's regression bar is FALSE, and it was the whole bar

The plan states the no-`admit` arm's protection as *"every pre-existing case in this file
passes unedited… Reddened by making the `planWithOffers` arm unconditional"*, and calls it
*"the whole regression bar for this task"*.

**Planted, and it reddens nothing.** With the arm forced unconditional:

```
Test Files  111 passed | 2 skipped (113)
     Tests  1596 passed | 18 skipped (1614)
```

Zero failures across the entire repository.

**The reason is structural, not accidental.** `planWithOffers` called with no `admit` builds
no recording wrapper, so it bounds nothing, and `placeWithOffers` with `admit === undefined`
accepts every candidate. The two arms then differ only in *how* an eligible set is narrowed —
ordering versus sampling — and on every fixture in this repository the node sets are small
enough that both narrowings pick the same nodes. The bar the plan named would have been
satisfied by the defect it existed to catch.

**Two cases were added that do discriminate** (`SCHED-02 — the no-offer arm places exactly
as it did before this phase`), each targeting one property the arms genuinely differ on:

| Case | Property | Reading under the mutation |
|---|---|---|
| takes the globally least-loaded node | `planPlacement` orders **all** eligible; `placeWithOffers` samples `DEFAULT_D` | `['n-b']`, expected `['n-idle']` |
| keeps the `dispatchCount` nudge | the nudge exists on the no-offer arm alone | `['w1','w2','w0','w2']`, expected `['w0','w1','w2','w3']` |

The second reading is the more telling one: **`w2` took two shards and `w3` took none**,
which is precisely the round-robin spread the nudge reproduces, lost. Without these two
cases the no-`admit` arm was pinned by nothing at all.

## Every reddening claim, planted and watched

Nothing below is restated from the plan. Each row was written into the source, run, and
reverted from a `cp` snapshot confirmed by `diff -q` — never `git checkout`, never
`git clean`.

| # | Mutation | Where | Reddened | Held |
|---|---|---|---|---|
| 1 | delete the `spec.admit` branch (always `planPlacement`) | `job/submit.ts` | **6** of the 7 offer cases | ✅ |
| 2 | compose the reason from the node id | `job/submit.ts` | **2** — exactly the two asserting reason text | ✅ |
| 3 | make the `planWithOffers` arm unconditional | `job/submit.ts` | **0 of 1596** — see above | ❌ **FALSE** |
| 3b | the same mutation, against the two cases added here | `job/submit.ts` | **2**, both new | ✅ |
| 4 | `eligibleNodes(request, nodes)` → `nodes` | `placement.ts` (temporary) | **2** sovereignty cases | ✅ |
| 5 | restore `providers`' first-non-empty return | `net/discovery.ts` (temporary) | **4** of 5 candidate cases | ✅ |
| 6 | descriptor keyed on `nodeKey`, executor on peer id | `discover-candidates.ts` | **2**, incl. the correlation case | ✅ |
| 6b | mask-probe: the same, first assertion disabled | test file (temporary) | the `submitJob` leg alone | ✅ |
| 7 | drop the undialable node without recording it | `discover-candidates.ts` | **1** — isolates it exactly | ✅ |
| 8 | discard `excluded` and `providers` | `discover-candidates.ts` | **2** | ✅ |
| 9 | `canExecuteSovereign: true` unconditionally | `discover-candidates.ts` | **1** — `expected true to be false` | ✅ |
| 10 | `canExecuteSovereign: false` unconditionally | `discover-candidates.ts` | **1** — `expected false to be true` | ✅ |

**Eleven of twelve reddened; one was measured false and replaced.** Four are worth calling
out.

- **Mutation 4 is the sovereignty leak, observed rather than argued.** With
  `placeWithOffers`' gate removed, the sovereign shard came back `agreed` instead of
  `insufficient`, and the paired arms read `['bob-3']` against `['alice-1']`. That
  disagreement is what makes the pair a *comparison* rather than two assertions — under the
  mutation the offer arm moves and the plan arm does not.
- **Mutation 6 masked a second assertion, so the mask was lifted.** Vitest stops an `it` at
  the first failure, so the correlation comparison hid the `submitJob` leg entirely. With
  the comparison commented out, `submitJob` returned `ok: false` with
  `missing-node-descriptor` — the invariant proved through the function that names it. The
  comment above those lines now records that both were measured alone. This is the same
  masking lesson 18-03 recorded for its 1/1b pair.
- **Mutations 9 and 10 fail at opposite readings**, which is what says the field is read
  from the record rather than being a constant that happens to match. `descriptorsOf` in
  `discovery.test.ts` hardcodes `false`; either constant is wrong for the same reason, and
  a fixture with one cleared node and one uncleared node catches both from one run.
- **Mutation 4 was planted in a file this plan may not commit.** `placement.ts` is being
  edited concurrently by another agent. Because each agent has its own worktree, the plant
  was local to this filesystem; it was restored from a `cp` snapshot and
  `git diff --name-only 4b51b45 HEAD` confirms `placement.ts` is absent from the change set.

## Plan errors corrected — every `file:line` re-read

The plan was written before 18-04 landed, and 18-04 added ~200 lines to `placement.ts`.
Every citation into that file is stale by ~60 lines.

| Plan says | Actually | What it is |
|---|---|---|
| `placement.ts:169` | **`:230`** | `placeWithOffers`' `eligibleNodes` call — the plan's central citation |
| `placement.ts:167-176` | **`:228-230`** | the comment + that call |
| `placement.ts:130-132` | **`:190-193`** | `leastLoaded` |
| `placement.ts:183` | **`:244`** | where `leastLoaded` is applied |
| `placement.ts:216-242` | **`:321-384`** (doc from `:277`) | `planWithOffers` |
| `discovery.ts:191-205` | **`:193-206`** | `DiscoveredExecutor` + `DiscoveryResult` |
| `discovery.ts:230-296` | **`:231-297`** | `discoverExecutors` |
| `CandidateOptions.dispatch: readonly Delegation[] \| …` | **`CapabilitySupplier \| …`** | **a type error, not a drift** — see below |

**The `dispatch` type is the one that would not have compiled.** `RemoteExecutor`'s third
constructor parameter is `CapabilitySupplier | 'dispatches-unauthenticated'` — a *function of
the task*, not an array — and its own doc gives the reason: one `RemoteExecutor` serves every
shard of a job, shards may name different owners, and a chain minted for node A is refused at
node B with `wrong-audience`. The plan's array would have had to be wrapped or the executor's
contract widened. The supplier is carried through unchanged, and `CandidateOptions.dispatch`'s
doc now states why it is required rather than optional, quoting the same rule
`RemoteExecutor`'s constructor doc does.

**Verified correct individually, each re-read rather than assumed:** `job/submit.ts:1-17`,
`:11-14`, `:24`, `:140-151`, `:169-173`, `:205-227`, `:219`, `:267`;
`sovereignty.ts:27`, `:116-141`, `:124-128`, `:130-141`, `:149-200`, `:169`, `:184`, `:185`;
`net/src/discovery.test.ts:178-187` (`descriptorsOf`, hardcoding `canExecuteSovereign: false`);
`libp2p/src/identity.ts:159` (`peerIdForNodeKey`); `fabric-node.ts:494-517` (the plan cites
`:501-515`, inside it).

**One plan claim about the purity guard is imprecise and worth recording.** The plan says
`@o2/net` must not import `@o2/libp2p` because *"`purity.node.test.ts` enforces the
layering"*. Read from source, `FORBIDDEN` lists `node:`, `libp2p`, `@libp2p/`, `@chainsafe/`
and `@o2/node` — **not `@o2/libp2p`** — so that import would pass the guard. What actually
forbids it is the dependency direction: `packages/net/package.json` declares only
`@ipld/dag-cbor`, `@o2/core` and `multiformats`, and `@o2/libp2p` imports libp2p, which would
reach a browser bundle through the portable tier. The decision (take `peerIdFor` as a
parameter) is unchanged and correct; the *reason* is the dependency graph, not the guard.

## What each task measured

### Task 1 — the offer arm, and the two arms as one gate

`submitJob` branches on `spec.admit === undefined`. The absent arm is the original loop,
unmoved. The present arm builds the same `PlacementRequest`s through the same `requestFor`
and makes one `planWithOffers` call, inheriting 18-04's headroom tally rather than
re-implementing it — read off a real `LocalCapacity`, a 1-slot node takes **one** of four
shards, the three held back carry `rejections: []` because a node held back was never asked,
and `peakInFlight` is **0** because `would()` reserves nothing.

`ShardResult.rejections` reaches the caller on both arms of the result, and the unplaceable
arm is where it matters most: the reason reaches `verification.status === 'insufficient'`
exactly as it always did, now with the refusals beside it, so *"nobody would take it"* is
distinguishable from *"there was nobody"*.

The two-arm comparison is written as one assertion (`expect(a.agreeing).toStrictEqual(
b.agreeing)`) rather than two, from one shared fixture with one eligible node and three
cheaper foreign ones. Under mutation 4 the two disagree, which is what makes it a comparison.

RED was taken literally: **7 failed | 30 passed**, the 30 being every pre-existing case in
the file, untouched.

### Task 2 — `discoverCandidates`

Five tests over `MemoryNetwork`, each serving node given its **own** `SelfRecordIndex` over
its own store — 18-02's shape, never a seed index with `provide` hand-called into it.

The fixture's deliberate departure: a node's transport id is `peer-N`, **not** its node key.
`discovery.test.ts` makes the two equal, which is a property of that fixture and not of a
node, and under that equality a module returning node keys where peer ids belong would pass
every assertion. Here `expect(found.executors.map(e => e.nodeId)).not.toContain(nodeKey)` is
a real reading.

Three nodes each answering `providers` for themselves yield **three** executors and three
descriptors — the case that returns one without 18-02's union, and the reason power-of-d has
anything to sample.

## Deviations from Plan

### Auto-fixed

**1. [Rule 3 — blocking] `ShardResult.rejections` broke two fixture builders**

- **Found during:** Task 1, at the first `tsc` run after adding the field.
- **Issue:** `net/src/reduce-job.test.ts` constructs `ShardResult` literals directly
  (`agreed` at `:111`, `insufficient` at `:129`), and a required field is a compile error at
  every construction site.
- **Fix:** `rejections: []` on both, with the reason written at each — these fixtures stand
  for shards of a job that made no offers, which is the same truthful `[]` the no-`admit`
  arm produces. **No assertion was touched**; both are builder functions.
- **Files:** `packages/net/src/reduce-job.test.ts`
- **Commit:** `b07231f`

**2. [Rule 2 — missing critical functionality] The no-`admit` arm had no discriminating test**

- **Found during:** planting the plan's claim 3.
- **Issue:** measured above — the stated bar reddens nothing in 1596 tests, so the arm the
  whole plan promises is unchanged was protected by no assertion that could detect a change.
- **Fix:** two cases added, each reddening under the very mutation the plan named.
- **Commit:** `b07231f`

### Departures from the plan's letter, each with its reason

**3. `CandidateOptions.dispatch` is a `CapabilitySupplier`.** Measured above; the plan's type
would not compile against `RemoteExecutor`.

**4. `core/src/index.ts` was not edited at all.** The plan does not list it, but `JobSpec.admit`
and `ShardResult.rejections` reference `AdmissionControl` and `Rejection` — both **already
exported** by 18-04 (`index.ts:93`, `:99`). The contended barrel needed no line, so none was
added. `packages/net/src/index.ts` gained one export block, as the plan specifies.

**5. Task 2's RED was taken as the mutation set rather than as test-before-code.** The module
and its test were written together, then every assertion was shown load-bearing by mutations
5–10 plus the mask probe. Recorded plainly rather than claimed as a literal RED.

**6. `firstAsked` derives which node is sampled first** instead of hardcoding one. The sample
comes from rendezvous rank on the shard id; naming a node would make the re-pick cases depend
on a hash they do not test.

**No existing assertion was weakened, altered or deleted.** `submit.test.ts` keeps all 30 of
its prior tests unedited — checked before and after — and the only pre-existing file otherwise
touched gained a field on two builders and no assertion.

## Limits, in the words the plan requires

- ***Nothing is wired to an entry point, deliberately and temporarily.*** Both halves exist
  and neither is reachable from `bin/agent.ts` or `bin/bench.ts`. **Shipping an adapter with
  no callers is the defect this milestone exists to remove**, so this plan's output is not
  finished work until **18-06** lands. That is why `requirements-completed` is **empty**:
  SCHED-01, SCHED-02 and SCHED-03 are each *advanced* and none is closed by this plan.
- ***The bound a requestor applies to itself is advisory.*** Inherited unchanged from 18-04:
  nothing is reserved by answering, the tally lives in one requestor's memory, and a
  dishonest requestor is refused for real by the `exec` branch's SCHED-06 admission, which
  this plan did not touch.
- ***Criterion 2b's re-pick after an `exec` refusal is UNMEASURED on the production path,
  not descoped.*** `submitJob` still calls `executeVerified` exactly once per shard with no
  retry. The offer arm re-picks on an **offer** refusal, which is a different event.
  WIRE-04 / Phase 20 criterion 1 owns it.
- ***The reach is directly-connected peers only.*** No transitive routing and no DHT —
  ruling D1's stated limit, now also stated where a caller of `discoverCandidates` reads it.
- ***The sovereign owner-id seam is named, not fixed.*** A `PlacementRequest.ownerId` must be
  the certificate's **user key** for `eligibleNodes` to match a descriptor this module builds;
  `OwnerId` is an opaque string, so an operator label will not match and the shard stalls
  silently. AUTH-05 / Phase 19 owns unifying them.
- ***`requiredFeatures` is passed by nobody.*** `CapabilityRecord.features` is `[]` on every
  node this repository builds, so a query naming a feature excludes everybody.
- ***No quantity here describes a workload.*** Every number written down — 1, 2, 3, 4, 5 nodes
  and shards, and the loads 0…0.9 — is a fixture's configuration.

## Known stubs

None. `JobSpec.admit`'s absence is a **named, asserted arm** rather than a silent default:
it selects `planPlacement`, and *"a caller that made no offers gets an empty refusal list"*
asserts the `[]` directly rather than reaching it by omission. `load: 0` on a descriptor is
not a placeholder either — discovery genuinely learns nothing about load, the comment says
so, and the offer answer is where a real figure comes from.

The one deliberate absence is that nothing constructs either half from a runnable entry
point. That is the plan's own boundary, stated above.

## Threat flags

None. No new wire frame, no new request kind, no new network endpoint, no auth path, no file
access pattern and no schema at a trust boundary. `discoverCandidates` composes three
existing pieces (`RpcRecordIndex`, `discoverExecutors`, `RemoteExecutor`) and adds no
protocol; `JobSpec.admit` runs in the requestor's own process and grants nothing.

Two things worth stating because they are the tempting misreadings:

- **The offer arm does not weaken any bound.** It is a requestor bounding *itself*. The
  authoritative refusal is still the serving node's `LocalCapacity` on `exec`, unchanged and
  unaffected by anything a requestor supplies or omits.
- **`dispatch` is required, not optional**, and deliberately mirrors `RemoteExecutor`'s own
  required third parameter. An optional chain here would mean a candidate set built without
  one dispatches unauthenticated with nothing failing — the precise defect that requirement
  exists to remove.

## Constraints honoured

- **Portable tier clean.** `packages/core` and `packages/net` gained no `node:` import, no
  libp2p and no `@chainsafe` — `purity.node.test.ts` passes. `discover-candidates.ts` takes
  the libp2p-side derivation as a function for exactly this reason.
- **No decision keys on node kind.** `discoverCandidates` takes a peer thunk and a mapping
  function; there is no field on which it could branch on what kind of node a peer is, and
  the descriptor it builds is computed from a certificate and a capability record alone.
- **Contended files untouched.** `git diff --name-only 4b51b45 HEAD` returns exactly six
  paths; `packages/core/src/placement.ts`, `packages/core/src/governor.ts` and
  `packages/core/src/index.ts` are **all absent**.
- **Planning files untouched.** `STATE.md`, `ROADMAP.md` and `REQUIREMENTS.md` were not read
  for modification and not written. `state.record-metric` was **not** called — 18-03 measured
  it corrupting STATE.md's frontmatter.
- **Staged explicitly.** No `git add -A`, no `git clean`, no `git checkout --` of any file.
  Every mutation was reverted from a `cp` snapshot verified with `diff -q`.

## Out-of-scope findings

**1. `RpcRecordIndex` now has a production-shaped caller, but still no runnable one.**
17-04, 18-02 and 18-03 each recorded that every use was a `.test.ts`. `discoverCandidates`
constructs one from production code — but nothing constructs `discoverCandidates`. The
finding is *advanced*, not closed, and 18-06 closes it.

**2. `purity.node.test.ts` does not forbid `@o2/libp2p` in the portable tier.** Measured
above: `FORBIDDEN` has no pattern matching it, so `import … from '@o2/libp2p'` inside
`packages/net/src` would pass the guard while pulling libp2p into a browser bundle through
the portable tier. Not fixed — adding a pattern is a change to a guard three phases rely on
and belongs to whoever owns the layering rule, not to this plan. Worth one line in
`FORBIDDEN` if someone agrees.

**3. The baseline reconciles cleanly this time.** 18-03 recorded that its numbers did not
reconcile with 18-02's. This plan measured its own baseline before touching anything
(111 files / 1588 tests) rather than inheriting one, and the final delta (+1 file, +14 tests)
matches the added cases exactly. Measuring rather than inheriting is what made it check out.

## Self-Check: PASSED

Files claimed, listed off disk:

```
FOUND  packages/net/src/discover-candidates.ts        189 lines (new)
FOUND  packages/net/src/discover-candidates.test.ts   317 lines (new)
FOUND  packages/core/src/job/submit.ts                modified
FOUND  packages/core/src/job/submit.test.ts           modified (+9 cases, 0 edited)
FOUND  packages/net/src/index.ts                      modified (+1 export block)
FOUND  packages/net/src/reduce-job.test.ts            modified (2 builders)
```

The plan's `must_haves.artifacts` require `packages/core/src/job/submit.ts` to provide
`JobSpec.admit`, the offer arm and `rejections` on `ShardResult` — all present — and
`packages/net/src/discover-candidates.ts` to provide `discoverCandidates` at **min_lines: 60**
— present at 189.

Commits claimed, found in `git log --oneline --all`:

```
FOUND  9f1b014  feat(18-05): a data CID and a peer list become dispatchable candidates
FOUND  b07231f  feat(18-05): submitJob places by offers when it is given a way to ask
```
