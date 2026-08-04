---
phase: phase-19-quorum-composition-owner-domain-attestation
plan: 04
subsystem: browser-tier, sovereign-egress, admission
tags: [WIRE-03, DATA-10, SCHED-06, e2e, browser]
requires:
  - "packages/core/src/job/submit.ts — the blockstore-put registration (DATA-10)"
  - "packages/net/src/sovereign-egress.ts — withholdingFrom, SovereignCids"
  - "packages/browser/src/idb-sovereign-cids.ts — the browser tier's durable set"
  - "packages/node/src/browser-capability.e2e.test.ts — the no-relay tab topology"
provides:
  - "a page can submit owner-pinned data, and the row it submits is registered at the put"
  - "the EgressGuard refusal and the providers withholding, executed in a live tab by a real peer"
  - "the capacity refusal, executed in a live tab, with the number read at two limits"
  - "BrowserNode.sovereignCids — the tab's durable set, reachable by its own submitter"
affects:
  - "19-11 (demo UI receipt) — TabApi.runJob gained one option; the includeSelf call sites are untouched"
  - "19-12 (mutation ledger) — two find/replace pairs recorded below, both in browser-node.ts"
tech-stack:
  added: []
  patterns:
    - "one field carrying an inseparable pair, rather than two optionals that can disagree"
    - "the second reading taken from a refusal rather than from an absence of one"
key-files:
  created:
    - packages/node/src/tab-refusals.e2e.test.ts
  modified:
    - packages/browser/src/tab-api.ts
    - packages/browser/demo/main.ts
    - packages/browser/src/browser-node.ts
    - packages/node/src/serve-agent-hooks.node.test.ts
    - packages/node/src/sovereign-block-refusal.node.test.ts
decisions:
  - "one `sovereign?: {ownerId}` field, not a loose label plus a loose owner id — a sovereign shard with no owner is a refusal, not a job"
  - "the public control is the second shard of a two-shard run, because the page derives a shard's value from its index and a one-shard control would content-address to the sovereign block"
  - "the two-slot case reads a refusal at 2, not an absence of one — `2 of 2 slots in use` states its own occupancy"
  - "BrowserNode.sovereignCids has no absent arm: a tab has no `blockstoreDir`-less state"
metrics:
  duration: ~35m
  completed: 2026-08-03
---

# Phase 19 Plan 04: The two refusals a tab had never executed Summary

A live browser tab now refuses, to a real peer over a real connection, the sovereign row
it submitted itself — by name, and withholding the same CID from its own `providers`
answer — and refuses an `exec` past its declared slot limit with the limit in the text.
Both readings are taken from the requestor's own reply frame. Three comments that said
this could not yet be measured stop saying it.

## What was actually open, which was narrower than the roadmap

Both corrections in the plan's objective held up against the source and neither needed
re-deriving. `registerSovereignInputs` does not exist in this repository; the tab's
sovereign *serving* path was already executed by `browser-capability.e2e.test.ts`. What
was genuinely unexecuted was the **submitter** direction — no spec had ever driven a
sovereign payload out of a tab's own `submitJob` and then asked the tab for it — and the
**capacity refusal**, which `browser-node.ts` said in its own words had never been read.

**The route that closes the first is not the one the requirement's prose implies.** It is
DATA-10's registration at `submitJob`'s **blockstore-put**, not `submitJobWithEgress`'s
job-scoped payload hold. The hold is given back in a `finally`; the put's record is
durable, and it is the only one still answering by the time a peer asks. That distinction
is now written at three places rather than inferred.

## What was built

### Task 1 — a tab does not hand over the row it submitted

**Commits:** `335ad9e` (RED), `386ff56` (GREEN)

`TabApi.runJob` gained **one** option, `sovereign?: { ownerId: string }`, rather than the
loose label and loose owner id the plan's letter described. The pair is inseparable
because a sovereign shard with no owner is not a state this fabric has — `submitJob`
refuses it by name (`shard-missing-owner`) — so two optionals would be a way to spell a
refusal rather than a job. `demo/main.ts`'s hardcoded `label: 'public' as const` became
the caller's, defaulting to public, and the page now hands its node's `sovereignCids` to
`submitJob`.

**Checked before adding, as the plan required.** The page's submit path did **not** supply
`sovereignCids`. What it did supply — `[n.egress]`, the third argument — is the job-scoped
payload-scanning hold, a different mechanism with a different lifetime. So this is an
addition and not a second registration that could disagree with a first, and the line says
so. `runColouring` deliberately did not get it: every cube it submits is public.

`BrowserNode.sovereignCids` is exposed for the reason `FabricNode.sovereignCids` is — the
put writes into *this* node's store, so it is *this* node's set that has to record it. It
carries **no** named-absence arm, and the asymmetry with the Node tier is a storage fact
rather than a capability: that tier's sentinel answers for a node with no `blockstoreDir`,
and a tab has no such state, because an origin that cannot open IndexedDB cannot host a
`BrowserNode` at all.

### Task 2 — the number an over-committed tab answers with

**Commits:** `eaba07f` (the readings), `c350cf6` (the comments)

A tab started through `window.o2` with `maxConcurrentTasks: 1`, two concurrent `exec`
dispatches from a Node peer, and the reading taken from the second one's reply:

```
[browser tier] one slot  -> over-committed: 1 of 1 slots in use
[browser tier] two slots -> over-committed: 2 of 2 slots in use
```

The refused task, re-dispatched, succeeds — so the slot releases, and the same bytes to
the same tab are admitted with nothing changed but the moment.

## The proofs, and the one this plan strengthened

### The RED gate was the plan's first plant, run for real

The plan asked for `sovereignCids` to be *planted* out of the page's submit options. That
was unnecessary: the RED phase of the TDD cycle **is** that state. `tab-api.ts` declared
the option, nothing implemented it, and the run reported

```
AssertionError: expected 'block' to be 'error'
packages/node/src/tab-refusals.e2e.test.ts:356
```

with everything around it already green in the same 699 ms — the tab held both rows,
served the public one byte-for-byte, both submissions returned. So the failure was the
reading the file exists to take and not a harness that never started.

### Plants that reddened, with find/replace pairs for Plan 19-12

| # | file | find | replace | observed |
|---|------|------|---------|----------|
| P1 | `packages/browser/src/browser-node.ts` | `withholdingFrom(egressDisposition),` | `'advertises-everything-it-holds',` | `tab-refusals.e2e.test.ts:371` RED — `expected [ Array(1) ] to deeply equal []`, the tab's own node key advertised for the CID **while the block assertion 15 lines above stayed green**. The divergence is the whole reason both answers are read |
| P2 | `packages/browser/src/browser-node.ts` | `capacity: admission,` | `capacity: <the hook's named opt-out>,` | both capacity cases RED — the one-slot case at `expected […] to have a length of 1 but got 2`, i.e. **the second dispatch succeeded**; the three-dispatch case at `length of 2 but got 3`. The sovereign-egress case in the same file stayed green |

Both restored by `cp` + `cmp`, exit 0 each time, never by `git checkout --`.
`git diff HEAD --stat` showed only the concurrent executor's own files after each restore.

P2's replacement is written descriptively above **on purpose**: `serve-agent-hooks.node.test.ts`
requires zero occurrences of that literal anywhere in `browser-node.ts`, counting raw text
including comments. See the deviation below — this document is not scanned, but the habit
is what stopped the second occurrence.

### A proof the plan called for that was NOT run, and why

The plan asked for the slot-release reading to be reddened *"by taking the slot outside
the `finally`"*. That release lives in `packages/net/src/agent.ts` — shared production
code serving **both** tiers — and this plan ran on the main working tree with a concurrent
executor active on it. A transient plant there would have reddened their suite for a
reason that was not theirs, and this phase has already lost work to exactly that class of
cross-agent interference. **Not run, and stated rather than quietly omitted.**

What carries the property instead: `admission.node.test.ts` asserts `inFlight` returns to
0 on the Node tier across three cases, and the reading here is the behavioural half —
the task that was refused, re-dispatched, is admitted. A leaked slot fails that.

### The reading that would have been vacuous, and the fix

The plan's second capacity proof — *"run the same case at `maxConcurrentTasks: 2` and
confirm the second dispatch succeeds"* — **is vacuous as written**, and this is the plan
claim that did not survive measurement. Two dispatches that never overlapped produce no
refusal at any limit, so "no refusal at 2" is satisfied by a tab that refuses whichever
request arrives second *and* by one whose pair simply did not collide. The first version
of the case was written that way and passed in 431 ms, which is exactly what a vacuous
pass looks like.

It now dispatches **three** against two slots and reads the refusal:
`over-committed: 2 of 2 slots in use`. That frame states `inFlight === 2` at the instant
the third arrived, so the same string that carries the number carries the evidence that
two tasks really ran at once in that tab. The number is read at two values, from two
refusals, rather than from one refusal and one silence.

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 3 — blocking] `BrowserNode` did not expose its durable set**
- **Found during:** Task 1
- **Issue:** The plan's `<behavior>` requires the page to supply *its node's*
  `sovereignCids` to `submitJob`. `FabricNode` has had that accessor since DATA-10;
  `BrowserNode` did not, so the page had no way to reach the object its own factory had
  opened. The plan's `## Files touched` lists `browser-node.ts` only for the `capacity:`
  comment, but the file is in `files_modified` and the task is unreachable without this.
- **Fix:** `readonly sovereignCids: SovereignCids` on the class, threaded through the
  private constructor, with the tier asymmetry documented at the field.
- **Commit:** `386ff56`

**2. [Rule 2 — a false statement left standing] Two more comments carried the retired claim**
- **Found during:** Task 2
- **Issue:** The plan names the `capacity:` comment in `browser-node.ts`. Two others said
  the same thing and are the places a reader actually looks:
  `serve-agent-hooks.node.test.ts:195-203` (*"nothing drives an over-committed dispatch
  through a tab … WIRE-03, Phase 19"*) and `sovereign-block-refusal.node.test.ts:53-62`
  (*"what is genuinely unproven is the **submitter** half in a tab"*). Neither file is in
  `files_modified`; neither is owned by the concurrent executor.
- **Fix:** Both rewritten, both retiring the old sentence visibly rather than deleting it.
  The plan's own must-have says *"the two production comments"*; there were three sites,
  and leaving one to keep the count would be the defect this milestone exists to remove.
- **Commit:** `c350cf6`

**3. [Rule 1 — bug in my own work] An unawaited assertion**
- **Issue:** `expect(page.evaluate(…)).resolves.toBe(0)` was written without `await`.
  Vitest auto-awaits it today and warned that it will fail in the next major — so the
  assertion was live but the file was one version away from silently losing it.
- **Fix:** Awaited. Caught by reading the run's own output rather than only its exit code.
- **Commit:** `eaba07f`

**4. [Rule 1 — bug in my own work] The `capacity:` rewrite named the literal it must not**
- **Issue:** The first draft spelled the hook's named opt-out inside the comment, and
  `serve-agent-hooks.node.test.ts` went red at `expected 1 to be +0`. That guard counts
  raw text across the whole of `browser-node.ts`, comments included, and cannot tell a
  construction from a mention. `browser-node.ts` writes that rule down twice already.
- **Fix:** Described rather than spelled, with the trip recorded at the line so the next
  editor of that paragraph does not rediscover it. **The guard was not weakened.**
- **Commit:** `c350cf6`

### Deliberate departures from the plan's letter

**One option, not two.** The plan says `runJob` *"gains an optional sovereignty label and
owner id"*. It gains `sovereign?: { ownerId: string }` — the same two facts, in a shape
where they cannot be half-supplied. A loose `label: 'sovereign'` with a loose `ownerId?`
lets a caller spell `shard-missing-owner`, which is a refusal rather than a job, and this
repository's standing convention is that an invalid state should have no spelling.

**The public control is not a second one-shard run.** The page derives a shard's value
from its index alone, so a one-shard public run content-addresses to the byte-identical
block the sovereign run registered, and the control would have been measuring the same CID
under two names. The public run submits two shards and the control reads the second. The
reasoning is at the line, because it is the kind of thing an editor would "simplify".

**No `includeSelf` anywhere in the new spec, and no change near the demo's.** The
`executors` arrays at `demo/main.ts` are untouched, so item #34 — a self-included job's
receipt reading the named absence, because `node.executor` is deliberately the unsigned
`GovernedExecutor` — is exactly as 19-15 left it. **Plan 19-11 inherits an unchanged
picture.**

## What this does not establish

- **No sovereign task *executed* in a tab in this file.** The sovereign job is submitted
  with no executors — the browser twin of `sovereign-at-rest.node.test.ts`'s `executors: []`
  — because what is measured is what the submitter holds and refuses afterwards. A
  sovereign task accepted and run in a live tab is already covered by
  `browser-capability.e2e.test.ts`, and re-proving it here would read as progress.
- **The capacity *bound* is not falsified here, only the refusal.** Whether more than
  `slots` tasks ever ran at once is answerable only from a counter around the executor —
  `BrowserNode.executorPeakInFlight` — which no e2e case reads, because `TabApi` does not
  expose it. `admission.node.test.ts` reads the Node-tier twin. Stated at the hook.
- **The durable set's durability across a *restart* is unmeasured on this tier.** The Node
  tier has that reading (`sovereign-at-rest.node.test.ts` opens a second process over the
  same directory). A tab's equivalent is a reload against the same origin, and this file
  does not take it. `idb-sovereign-cids.ts` separately records that IndexedDB is evicted
  silently under storage pressure, which is unmeasured too.
- **One engine.** These are `e2e`-project specs and therefore chromium-only, like the
  other eleven. WIRE-03's multi-browser standard is met by `static-rendezvous.e2e.test.ts`,
  not by this file.
- **WIRE-03 is not ticked.** This plan closes two of the four items the requirement lists
  and does not touch the static-bundle discovery clause. `.planning/REQUIREMENTS.md` was
  not edited — a checkbox this repository guards must not be set by a plan that closed
  part of a row.

## A failure observed and not chased

`packages/node/src/static-rendezvous.e2e.test.ts` (19-03's, landed this wave) failed once
in the first full `--project e2e` run, at `run.agreeing` holding two peer ids where three
were expected — a discovery race, one tab absent from a cube. **Attributed by measurement
rather than by assumption:** it passed in isolation (5 tests, exit 0, 7.99 s), and the
full project passed twice more afterwards (12 files / 58 tests, exit 0, at 99.2 s and
109.0 s against the red run's 150.8 s — the red run was the contended one, with the
concurrent executor active). Nothing was adjusted and no timeout raised. Recorded because
a new e2e file's first sighting of an intermittent neighbour is worth a line.

## Verification

| command | result |
|---|---|
| `npx tsc --noEmit` | **exit 0** |
| `npx vitest run --project e2e` | **exit 0** — 12 files, 58 tests, 109.0 s |
| `npx vitest run --project browser` | **exit 0** — 240 files, 3756 tests, 45.7 s |
| `npx vitest run --project e2e packages/node/src/tab-refusals.e2e.test.ts` | **exit 0** — 3 tests |
| node-project specs reading the changed files (11 files) | **exit 0** — 154 tests |

Every exit code was read with `EXIT=$?` on the line immediately after the command, never
through a pipe and never after a trailing `tail`.

`duty-cycle-tab.e2e.test.ts` passes unedited, which the plan named as load-bearing: a
tab's advertised slot count falling 8 → 2 is an **offer answer**, and this plan's reading
is a **refusal**. The two questions stay separate and neither file borrows the other's
claim.

## Notes for the concurrent executor and for whoever merges

- Four commits, each staged by explicit path. The last used `git commit -- <paths>`
  because `packages/node/src/owner-domain-agents.node.test.ts` was sitting **staged** in
  the shared index at that moment; a bare `git commit` would have swept 19-09's file into
  a 19-04 commit. `git show --stat` was read on all four to confirm none did.
- Nothing outside `packages/browser/`, `packages/node/src/tab-refusals.e2e.test.ts`,
  `serve-agent-hooks.node.test.ts` and `sovereign-block-refusal.node.test.ts` was written,
  reverted, stashed or checked out. No branch was switched. No `git clean`, no `git stash`.

## Self-Check: PASSED

- `packages/node/src/tab-refusals.e2e.test.ts` — FOUND
- `335ad9e`, `386ff56`, `eaba07f`, `c350cf6` — FOUND in `git log`
- working tree clean across every path this plan owns, after every plant restore
