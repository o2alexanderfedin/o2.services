---
phase: phase-13-egress-manifest-completeness
plan: 07
subsystem: infra
tags: [egress, sovereignty, data-governance, o2-net, lifetime, rpc]

# Dependency graph
requires:
  - phase: phase-13-egress-manifest-completeness
    plan: "04"
    provides: EgressGuard.send records then rejects with EgressRefusal, which is what moved the registered set onto the correctness path and created the bound this plan closes
  - phase: phase-13-egress-manifest-completeness
    plan: "05"
    provides: egress-manifest.node.test.ts's inverted DATA-05 test, which is where two of the five emptiness assertions live
  - phase: phase-13-egress-manifest-completeness
    plan: "01"
    provides: registerSovereignInputs — the production registration whose release point this plan decides
provides:
  - EgressGuard.release(label) with hold counting, and EgressGuard.registrations — a readable set an assertion can name a leak from
  - RpcReply (packages/net/src/rpc.ts), exported from @o2/net — a handler may return a reply body plus an afterSent callback, invoked in a finally around the response send
  - AgentOptions.egress — required, with the 'holds-no-registrations' sentinel for an endpoint whose sends are not tapped
  - serveAgent's exec branch catches its own executor throws, so a failed dispatch reaches the requestor as a named reason instead of a response it calls malformed
  - Five emptiness assertions across two integration files, one of them on the refused path
affects: [phase-19]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Split a decision across the two layers that each hold half of it: serveAgent knows *what* to release because it parsed the task; rpc.ts knows *when* because it saw the frame settle. Neither can do the other's half"
    - "A callback discriminated by `typeof … === 'function'` is unambiguous against CanonicalValue, because no canonically-encodable value can be a function"
    - "Release unconditionally on a label rather than re-testing the condition that registered it — a no-op for an unheld label cannot drift out of step, a conditional release can"
    - "Hold counting rather than delete: two concurrent dispatches of one input are two holds, so the first to finish cannot unguard the second"

key-files:
  created: []
  modified:
    - packages/net/src/egress.ts
    - packages/net/src/rpc.ts
    - packages/net/src/agent.ts
    - packages/net/src/egress.test.ts
    - packages/net/src/agent-contract.test.ts
    - packages/net/src/sovereign-egress.test.ts
    - packages/net/src/sovereign-execution.test.ts
    - packages/net/src/submit-with-egress.test.ts
    - packages/net/src/distributed.test.ts
    - packages/net/src/churn.test.ts
    - packages/net/src/discovery.test.ts
    - packages/net/src/rendezvous.test.ts
    - packages/net/src/start-report.test.ts
    - packages/node/src/fabric-node.ts
    - packages/node/src/bin/bench.ts
    - packages/node/src/egress-manifest.node.test.ts
    - packages/browser/src/browser-node.ts

key-decisions:
  - "The call-site count is 22, not the 21 the plan's table names. `packages/net/src/agent-contract.test.ts` builds an `AgentOptions` literal without writing `serveAgent({`, so the plan's grep missed it. It is the file whose entire subject is that no hook can be omitted silently, so it also gained an omission case for the new field — leaving it out would have made `egress` the only required field with no compile-time proof behind it"
  - "Mutation A was planted in `packages/net/src/sovereign-egress.ts` alone rather than in two files. Hold counting makes the second release a no-op, so adding the release to the executor wrapper reopens the hole whether or not `agent.ts` still releases — the observed behavior is identical to the two-file form, and one file is what the shared working tree's revert rule allows"
  - "The `#closed` early return moved *inside* the `try` rather than staying above it. A registration that leaked whenever an endpoint closed mid-reply would be the same unbounded growth with a rarer trigger"
  - "A throwing executor is caught in `serveAgent` rather than left to `rpc.ts`'s handler catch. That catch replies `{error: …}`, a shape `parseResponse` does not recognise, so the requestor reported the response malformed and the reason was lost. Fixing it was needed for the release path to be reachable on the error exit, and it is a real improvement on its own account"

patterns-established:
  - "Mutation A is the shape of evidence for a *placement* claim rather than an existence claim: it builds the tidier design a reader would propose, and watches the leak reach 'agreed' again. An argument for a release point is not evidence for it"

requirements-completed: [DATA-05, DATA-06]

# Metrics
duration: 21min
completed: 2026-07-28
---

# Phase 13 Plan 07: A Registration Has a Lifetime Summary

**A sovereign task's registration is now released after its reply frame has settled and never before — `serveAgent` decides what to release, `rpc.ts` decides when, and the obvious alternative (release when the executor returns) was built, watched letting the leak reach `agreed` again, and reverted.**

## Performance

- **Duration:** ~21 min
- **Started:** 2026-07-28T13:14 -0700
- **Completed:** 2026-07-28T13:35 -0700
- **Tasks:** 3
- **Files modified:** 17 (0 created, 17 modified)

## Accomplishments

- **`EgressGuard` can forget.** `#guarded` holds `{payload, holds}`; `guard()` takes a hold rather than replacing the entry, `release(label)` gives one back and drops the payload at zero, and a label the guard does not hold is a no-op. `registrations` names what is held, so an emptiness assertion fails with the label that leaked rather than with a number nobody can act on.
- **The release point is one frame later than where it would naturally be written, and the code says so.** `egress.ts`'s module comment now states the bound — per-frame scan cost proportional to a node's in-flight sovereign tasks rather than its uptime — names the release point, and names the trap. `RpcReply`'s doc in `rpc.ts` says the same thing from the other end.
- **`RpcHandler` may return a reply plus an `afterSent` callback**, invoked in a `finally` that covers three exits: the send succeeded, the send was refused by this node's own tap, and the endpoint closed between the handler returning and the frame going out. The `#closed` check moved inside the `try` to make the third one an exit rather than a leak. The discriminator is `typeof … === 'function'`, which cannot collide with a reply body because no `CanonicalValue` is a function.
- **`AgentOptions.egress` is required, with a sentinel**, and its doc cites `.planning/PROJECT.md`'s "An optional hook with a silent default is a hole" by name. It also states what the hole would be here specifically: a node that omitted it would register on every sovereign dispatch and release none, growing slower for the rest of its life with nothing failing.
- **A throwing executor now reaches its requestor as a named reason.** Before this it propagated to `rpc.ts`'s handler catch, which replies `{error: …}` — a shape `parseResponse` does not recognise — so the requestor reported `malformed response from <node>` and the actual failure was lost on the way home. Measured, not assumed: that exact string is what the new test read before the fix.
- **All 22 call sites supply the field.** Five pass a real guard (`fabric-node.ts`, `browser-node.ts`, and the owner nodes in `sovereign-egress.test.ts`, `submit-with-egress.test.ts`, `sovereign-execution.test.ts`); seventeen pass the sentinel. Every sentinel comment states a fact about that endpoint's sends, never a class of node.
- **Five emptiness assertions**, one of them on the refused path — which is the one a naive implementation leaks, and the one Mutation B duly broke.
- **Both mutations were planted, run, captured verbatim, and reverted.** Mutation A confirmed the leak reaching `agreed` again. It also produced a finding the plan did not predict, recorded below rather than smoothed over.

## Task Commits

Tasks 1 and 2 are TDD, so each is two commits.

1. **Task 1 (RED): a registration must have a lifetime and a readable set** — `b13163f` (test)
2. **Task 1 (GREEN): EgressGuard learns to forget — release, holds, registrations** — `defc1d4` (feat)
3. **Task 2 (RED): the serve path must release after the reply frame settles** — `895fa8e` (test)
4. **Task 2 (GREEN): release the registration after the reply frame has settled** — `2978d5d` (feat)
5. **Task 3: the registration set is empty after a job — five assertions** — `019e562` (test). The two mutations that follow it leave no lasting change, so nothing was staged for them.

**Plan metadata:** (this commit, following)

## Files Created/Modified

- `packages/net/src/egress.ts` — `#guarded` becomes `Map<string, {payload, holds}>`; `guard()` counts; `release()` and the `registrations` getter added; `#scan` reads the payload out of the record; `reset()`'s doc states the record/watch-list split; the module comment's "unbounded until Plan 13-07" paragraph replaced by the cost bound, the release point, and the trap
- `packages/net/src/rpc.ts` — `RpcReply` and `unwrapReply`; `RpcHandler`'s return widened to the union; `#receive` restructured so `afterSent` runs in a `finally` and the `#closed` check sits inside the `try`. The existing send catch and its comment are unchanged
- `packages/net/src/agent.ts` — `AgentOptions.egress`; the exec branch wrapped so a throw becomes a named outcome, and returning an `RpcReply` whose `afterSent` releases `request.task.inputCid.toString()` unless the sentinel was passed
- `packages/net/src/egress.test.ts` — four new tests for release, hold counting (both halves in one test, off the delivery counter), the unheld-label no-op, and the named set
- `packages/net/src/agent-contract.test.ts` — `buildFull()` supplies the field; a `fails to compile with egress omitted` case added; the describe title and two comment counts corrected from six/seven to seven/eight
- `packages/net/src/sovereign-egress.test.ts` — `servingNode` gains an optional inner executor; two new tests (sovereign reply sent, throwing executor); three emptiness assertions on the pre-existing behaviors
- `packages/node/src/egress-manifest.node.test.ts` — two emptiness assertions, after the DATA-05 refusal job and after its control job
- `packages/node/src/fabric-node.ts`, `packages/browser/src/browser-node.ts` — the guard each factory already builds, passed through. Confirmed in scope before editing: constructed at `fabric-node.ts:351` and `browser-node.ts:219`, both well above their `serveAgent` calls
- `packages/node/src/bin/bench.ts`, `packages/net/src/{distributed,churn,discovery,rendezvous,start-report,sovereign-execution,submit-with-egress}.test.ts` — one added line each, in the same position in every object literal

## Task 3 — two mutations, planted, run, captured, reverted

`packages/net` runs under two vitest projects (`node` and `browser (chromium)`), so a failure
in that package appears twice; the verbatim blocks below are the `node` project's except where
noted, and the counts are each run's own.

### Mutation A — release when `inner.execute` resolves, not when the frame has settled

The obvious, wrong design, and the reason this is a plan of its own. In
`packages/net/src/sovereign-egress.ts`:

```ts
const outcome = await inner.execute(task)
options.guard.release(task.inputCid.toString())
return outcome
```

Command:
`npx vitest run packages/net/src/sovereign-egress.test.ts packages/net/src/sovereign-execution.test.ts packages/node/src/egress-manifest.node.test.ts`

```
 Test Files  3 failed | 2 passed (5)
      Tests  3 failed | 23 passed (26)
   Duration  6.44s
```

**The leak reached `agreed`.** This is the assertion the whole phase exists to hold, and under
this mutation it falls:

```
 FAIL  |node| packages/node/src/egress-manifest.node.test.ts > DATA-05 — the tap refuses the leaking frame, so the shard fails where it stands > fails the cross-owner shard at its owner, does not relocate it, and carries the refusal on the owner’s own manifest
AssertionError: expected 'agreed' to be 'insufficient' // Object.is equality

Expected: "insufficient"
Received: "agreed"

 ❯ packages/node/src/egress-manifest.node.test.ts:164:40
    162|     // selected executor failed, which is exactly what a refused reply…
    163|     const shard = result.job.shards[0]
    164|     expect(shard?.verification.status).toBe('insufficient')
       |                                        ^
    165|     expect(shard?.verification.status).not.toBe('agreed')
    166|     expect(result.job.complete).toBe(false)
```

```
 FAIL  |node| packages/net/src/sovereign-egress.test.ts > registerSovereignInputs — a production caller for EgressGuard.guard() > registers a sovereign task’s input before it runs, and the tap refuses the leaking reply
AssertionError: expected true to be false // Object.is equality

- Expected
+ Received

- false
+ true

 ❯ packages/net/src/sovereign-egress.test.ts:142:26
    140|       // cost. The added seconds here are an understood consequence, n…
    141|       // test nobody has looked at.
    142|       expect(outcome.ok).toBe(false)
       |                          ^
    143|       if (outcome.ok) return
    144|       expect(outcome.reason).toContain(node.nodeId)
```

The third failure is the same `sovereign-egress.test.ts` assertion under the
`browser (chromium)` project, at `:142:25`.

**What this proves.** The release point is one frame later than the place it would naturally be
written. The guard and the label are both already in scope inside `registerSovereignInputs`,
which is exactly why somebody will propose putting it there — and the gap between
`inner.execute` resolving and the reply frame leaving is the entire window the registration
exists to cover. Move the release into that gap and the reply is scanned against an empty set,
forwarded, and the leaking job completes as `agreed`. The comment in `egress.ts` warning against
it now has this run behind it.

**One prediction the plan got wrong, reported rather than smoothed over.** The plan expected
failures in *three* files. `packages/net/src/sovereign-execution.test.ts` stayed green, and the
reason is structural, not a weakness in the mutation: that file's owner nodes are **not** wrapped
in `registerSovereignInputs`. Their executor is `guardSovereignty(new WasmExecutor(...))`, and
the registration is a direct `guard.guard('alice-row', sovereignBytes())` call by the test
itself, standing in for the owner's declaration. A mutation inside `registerSovereignInputs`
cannot reach a file that does not use it. The same fact is why that file's `serveAgent` call
sites carry a comment saying the label under watch is not a label any reply would release. Two
files is what the mutation can reach, and two files is what it hit.

**Why this mutation is one file where the plan described two.** The plan asked for the release
also to be removed from `agent.ts`'s `afterSent`. With hold counting, the wrapper's release
takes the count to zero and deletes the entry, so the later `afterSent` release is a no-op —
the observed behavior is identical either way, and confining the mutation to one path is what
this shared working tree's revert rule permits.

Reverted with `git checkout -- packages/net/src/sovereign-egress.ts`;
`git status --short packages/net/src/sovereign-egress.ts` empty afterwards.

### Mutation B — `afterSent` on the successful path instead of in the `finally`

In `packages/net/src/rpc.ts`, `afterSent?.()` moved from the `finally` to the last line of the
`try`, so a refused or failed reply never releases.

Command: the same three files plus `packages/net/src/egress.test.ts`.

```
 Test Files  3 failed | 4 passed (7)
      Tests  3 failed | 53 passed (56)
   Duration  6.99s
```

```
 FAIL  |node| packages/node/src/egress-manifest.node.test.ts > DATA-05 — the tap refuses the leaking frame, so the shard fails where it stands > fails the cross-owner shard at its owner, does not relocate it, and carries the refusal on the owner’s own manifest
AssertionError: expected [ Array(1) ] to deeply equal []

- Expected
+ Received

- []
+ [
+   "bafyreiccwgqag45rbtsfri5zatieqprf5yxk37gw5thagemu5vi3osymsu",
+ ]

 ❯ packages/node/src/egress-manifest.node.test.ts:197:40
    195|     // that makes that a failure rather than a slow leak nobody measur…
    196|     // the label, so a failure says what leaked.
    197|     expect(alice.egress.registrations).toEqual([])
       |                                        ^
    198|
    199|     // The control, and it runs *after* the refusal on purpose: one th…
```

```
 FAIL  |node| packages/net/src/sovereign-egress.test.ts > registerSovereignInputs — a production caller for EgressGuard.guard() > registers a sovereign task’s input before it runs, and the tap refuses the leaking reply
AssertionError: expected [ Array(1) ] to deeply equal []

- Expected
+ Received

- []
+ [
+   "bafyreiccwgqag45rbtsfri5zatieqprf5yxk37gw5thagemu5vi3osymsu",
+ ]

 ❯ packages/net/src/sovereign-egress.test.ts:157:40
    155|       // its life. The assertion names the label, so growth fails loud…
    156|       // rather than showing up as a node that slowly got slower.
    157|       expect(node.guard.registrations).toEqual([])
       |                                        ^
    158|     } finally {
    159|       node.close()
```

The third failure is the same `sovereign-egress.test.ts` assertion under `browser (chromium)`,
at `:157:39`.

**Read the line numbers against Mutation A's.** In `egress-manifest.node.test.ts` the failure
moved from `:164` to `:197`; in `sovereign-egress.test.ts` from `:142` to `:157`. Every refusal
assertion above those lines now passes — `outcome.ok === false`, the shard `insufficient`, the
manifest carrying the violated label. The leak is still stopped; only the forgetting fails. That
is the separation this mutation exists to demonstrate, and it is visible in the line numbers
alone: "the tap works" and "the tap forgets" are two guarantees, and a single test could have
conflated them.

Reverted with `git checkout -- packages/net/src/rpc.ts`; clean afterwards.

### After both reverts

```
$ git status --short
(empty)

$ git status --short packages/net/src/sovereign-egress.ts packages/net/src/rpc.ts
(empty)
```

`git status --short` over the whole tree was empty — no other agent's uncommitted work was
present, and nothing outside this plan's own files was touched. The vitest browser project
writes a failure screenshot under `packages/net/src/__screenshots__/`; that directory is
untracked test output and was removed after each mutation run, leaving no untracked file behind.

## Verification — real counts from real runs

```
$ npx tsc --noEmit
tsc exit: 0        (no output)

$ npx vitest run packages/net packages/browser
 Test Files  34 passed (34)
      Tests  351 passed (351)

$ npm test
 Test Files  123 passed (123)
      Tests  1792 passed (1792)
   Duration  291.90s
```

**The counts reconcile exactly.** The repository was at 123 files / 1778 tests when this plan
started. It adds 7 tests across three files, each run under both the `node` and
`browser (chromium)` projects: four in `egress.test.ts`, two in `sovereign-egress.test.ts`, one
in `agent-contract.test.ts`. 7 × 2 = 14, and 1778 + 14 = **1792**. No new file, so the file count
is unchanged. Nothing went red at any point outside the two deliberate mutations.

### The call-site invariant, counted rather than quoted

Every `serveAgent` options object in the repository supplies `egress`, and none relies on a
default — the field is not optional, so `npx tsc --noEmit` exiting 0 *is* that proof. The
distribution:

| | Sites |
|---|---|
| `serveAgent({` literals | 21 |
| …of those, supplying a real guard | 5 |
| …of those, supplying the sentinel | 16 |
| `AgentOptions` literals not written as `serveAgent({` | 1 |
| **Total supplying `egress`** | **22** |

The plan's table says 21. The real number is 22, and the extra site is
`packages/net/src/agent-contract.test.ts:23` — `buildFull(): AgentOptions` returns a literal and
hands it to `serveAgent(full)` on a separate line, so a grep for `serveAgent({` does not see it.
The plan's prose also splits the 21 as "seventeen sentinel, four real guard"; its own table names
five real-guard sites, and five is what the code has. The sentinel total across the repository is
17 because `buildFull()` is one of them.

## Decisions Made

- **The `#closed` early return moved inside the `try`.** The plan asked for this and it is worth
  restating why: leaving it as a bare `return` above the `try` would mean an endpoint closing
  between the handler returning and the frame going out leaks a registration permanently. That is
  the same unbounded growth the plan closes, with a rarer trigger and no test that would notice.
- **`unwrapReply` is a module-level function, not inline branching in `#receive`.** `#receive` is
  already the longest method in `rpc.ts` and the discriminator's safety argument needs somewhere
  to live that a reader will find before they change it.
- **The sentinel is `'holds-no-registrations'`**, as the plan's `must_haves` specified, and every
  call-site comment describes that endpoint's sends. `bench.ts`'s two say the manifest this rig
  reads belongs to the submitting endpoint; `sovereign-execution.test.ts`'s Bob node says its
  transport has no tap on it. None says anything about a kind of node.
- **`egress` sits immediately after `blockstore` at every call site**, so a reviewer diffing the
  22 sees one shape. It is wiring, like `rpc`/`executor`/`blockstore`, rather than one of the
  behavioral hooks below it.
- **The new `agent-contract.test.ts` case names the specific omission.** The other seven cases
  read as "this hook is required". This one says what an omission would cost, because it is the
  quietest of the eight: nothing throws, nothing fails, the node just gets slower forever.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 — Missing critical functionality] A 22nd call site, and the compile-time proof for the new field**

- **Found during:** Task 2, on the first `npx tsc --noEmit` after making `egress` required
- **Issue:** `packages/net/src/agent-contract.test.ts` builds an `AgentOptions` literal in
  `buildFull()` and passes it to `serveAgent` on a later line, so it does not match
  `serveAgent({` and is absent from the plan's table of 21. That file's entire subject is
  WIRE-01's claim that omitting a required hook fails `tsc --noEmit` naming the hook. Supplying
  the field without adding its omission case would have left `egress` the only required field in
  `AgentOptions` with no compile-time proof behind it — the exact silent-omission shape the field
  exists to prevent.
- **Fix:** `buildFull()` supplies `egress: 'holds-no-registrations'`; a
  `fails to compile with egress omitted` case added alongside the seven existing ones, with a
  comment naming what the omission would cost; the describe title corrected from "six hooks" to
  "seven", and the two comment counts from six/seven to seven/eight.
- **Files modified:** `packages/net/src/agent-contract.test.ts`
- **Verification:** `npx tsc --noEmit` exits 0 — which for a `@ts-expect-error` case means the
  suppression is *used*, i.e. omitting `egress` genuinely fails the type check. If the field were
  ever widened back to optional, the directive would become an "Unused '@ts-expect-error'" error.
- **Committed in:** `2978d5d`

---

**Total deviations:** 1 auto-fixed (1 missing-functionality). Two further departures from the
plan's *text* are recorded above as findings rather than deviations, because neither changes what
was built: Mutation A was confined to one file (identical observed behavior, and the shared-tree
revert rule), and it failed in two of the three files the plan named (the third does not use
`registerSovereignInputs` at all).

**Impact on plan:** None on scope. Every `<action>` in all three tasks was executed as written.
Nothing forbidden was added: there is no eviction, no cap, and no least-recently-used policy, and
`release`'s doc says why.

## Issues Encountered

**Nothing red that this plan did not deliberately create.** The suite was 123/1778 green at the
start and is 123/1792 green now. The only red readings in this whole plan are the two RED-phase
runs and the two mutation runs, all four of them intended and all four reverted or made green.

**`reset()`'s existing behavior and its test are untouched.** `resets without losing the guarded
set` passes unchanged; the only edit to `reset()` was to its doc comment, stating the split
between the record and the watch list so a later reader does not conflate them.

**One limit worth stating plainly.** The "present during the scan, absent afterwards" claim is
carried by two different tests, not one. That a registration is *absent* after a dispatch is read
directly. That it was *present* while the reply was scanned is proven by the refusal tests — the
frame was refused, so the set was not empty at that moment — and by Mutation A, which is what
happens when it is not. No single assertion observes the set mid-flight, and none claims to.

## Next Phase Readiness

- **The bound `egress.ts` claims is now assertable, and is asserted.** Five readings require the
  registration set empty after a job. A future change that leaks one fails at the label rather
  than showing up months later as a node that got slower.
- **`RpcReply` is available to any handler that needs work sequenced after a frame leaves**, and
  its contract is stated: `afterSent` must not throw, and it runs inside the transport's delivery
  path. The only implementation this plan creates is a `Map` delete behind a sentinel check.
- **A dispatch failure is now legible on the exec path**, where before a throwing executor
  produced a response the requestor called malformed. The *other* legibility gap Plan 13-04
  recorded is untouched and still open: on the responding leg a refused reply is swallowed by
  documented design, so a cross-owner requestor learns that the dispatch failed and not why. This
  plan did not close that and does not claim to.
- **Not claimed:** that a node's registration set is bounded when a reply frame is never
  attempted at all. Every exit through `rpc.ts`'s `#receive` releases, but a task dispatched
  directly through `node.executor` — bypassing RPC, which `fabric-node.ts`'s own comment notes is
  a supported path — registers without a reply frame to release against. That path has no leak
  today because nothing in the repository dispatches sovereign work that way, and it is stated
  here so the next person to add one knows it is theirs to handle.

---
*Phase: phase-13-egress-manifest-completeness*
*Completed: 2026-07-28*

## Self-Check: PASSED

All 17 modified files verified present on disk. All five task commit hashes (`b13163f`,
`defc1d4`, `895fa8e`, `2978d5d`, `019e562`) plus this summary's own (`8f2aa4e`) verified present
in `git log`. `packages/net/src/sovereign-egress.ts` and `packages/net/src/rpc.ts` verified clean
after their mutation reverts, and `git status --short` was empty over the whole tree at that
point. `vocabulary.node.test.ts` and `purity.node.test.ts` re-run with this summary committed and
therefore inside the scan's own jurisdiction: **38/38 passing**.

`.planning/STATE.md` and `.planning/ROADMAP.md` were not touched by this plan. `ROADMAP.md`
belongs to Plan 13-06 and is load-bearing for a test; its last commit is still `0379ec5`, from
planning.
</content>
</invoke>
