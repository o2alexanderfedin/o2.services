---
phase: phase-18-discovery-capacity-placement
plan: 03
subsystem: discovery
tags: [discovery, content-routing, sovereignty, egress, node-factory, browser-tier]

requires:
  - phase: phase-18-discovery-capacity-placement/18-02
    provides: "`SelfRecordIndex` in `@o2/core`, and `withholdingFrom` in `@o2/net` — the one correct construction of the withholding predicate"
  - phase: phase-17-node-identity-enrollment/17-04
    provides: "`recordsFor` live on both tiers, and the recorded fact that `providers` answers `[]` from every node"
provides:
  - "Both node factories hand `serveAgent` a `SelfRecordIndex` on every construction path — `providers` has a production answer for the first time since the request kind was added in Phase 6"
  - "`'serves-no-records'` removed from both factories; the named absence moved inward to `records: 'holds-no-records'`, which describes the identity half alone"
  - "The withholding predicate wired from the same `EgressDisposition` value `serveAgent` receives, so the `providers` and `block` branches cannot read different guards"
  - "`packages/node/src/provider-answering.node.test.ts` — the answer read off a real wire, both ways, with and without a certificate, plus the agreement invariant as three readings in one window"
  - "A measured correction to the plan's own reddening proof: its `index: records` needle does not discriminate"
affects: [phase-18-discovery-capacity-placement/18-05, phase-18-discovery-capacity-placement/18-06, phase-18-discovery-capacity-placement/18-08]

tech-stack:
  added: []
  patterns:
    - "Bind the shared value once and pass it twice: `egressDisposition` goes to both the withholding predicate and `serveAgent`, so the two branches cannot disagree by construction rather than by assertion"
    - "A count lowered to zero gains a paired positive assertion, and the needle is measured against the pre-change text before it is trusted"
    - "Retire a decision by replacing its text and saying it was retired, never by deleting it — a reader who finds two halves conditional on each other will reunite them"
    - "When a plan's fixture cannot open the window it asks for, use the production function the serve path itself calls and write the reason into the test"

key-files:
  created:
    - packages/node/src/provider-answering.node.test.ts
  modified:
    - packages/node/src/fabric-node.ts
    - packages/browser/src/browser-node.ts
    - packages/node/src/serve-agent-hooks.node.test.ts
    - packages/node/src/node-records.node.test.ts

key-decisions:
  - "The index is unconditional on both tiers and `'serves-no-records'` leaves both factories: a node with no certificate answers `records: null` and a real provider list, which are two truthful statements rather than one refusal to speak."
  - "The withholding predicate is `withholdingFrom(egressDisposition)`, never `egress.registrations.includes(cid.toString())` — the plan's line 202 is keyed on a label while the `block` branch is keyed on a payload."
  - "The egress disposition is bound once and passed to both readers, upgrading 'the predicate reads the same guard' from a comment into a property of the code."
  - "The paired positive assertion needs the trailing comma (`index: records,`). Measured: without it the needle reads 1 under the sentinel form and would not have reddened."
  - "The sovereign window is opened with `takeSovereignHold` — the function `serveAgent` calls at `agent.ts:763` — because `submitJobWithEgress` releases every hold in a `finally` and leaves no window after a job."
  - "SCHED-01 is advanced and NOT closed: it asks for the intersection, and `discoverExecutors` still has no production caller. That is Plan 18-05's."

patterns-established:
  - "Plant a reddening claim in both directions when one mutation masks another: the sentinel plant hides the paired positive, so a second plant that leaves zero sentinels isolates it"
  - "Two variants of 'the predicate was resolved once' fail at different lines and both are worth planting"

requirements-completed: []

duration: 25min
completed: 2026-08-01
---

# Phase 18 Plan 03: Both tiers answer for what they hold — Summary

**Every started node — Node tier and browser tier, certificate or none — now answers a
`providers` request truthfully about its own store, and neither advertises a block its own
`block` branch would refuse. The two factories were changed in one plan and their
expressions came out byte-identical, variable names included, so the standing rule survived
a change to the one hook most likely to break it.**

## Performance

- **Duration:** 25 min
- **Tasks:** 2 of 2
- **Files created:** 1 · **modified:** 4

## Commits

| Commit | Task | What |
|---|---|---|
| `6cbf8f6` | 1 | both tiers answer for what they hold, certificate or not |
| `d29177f` | 2 | the providers answer, read off a real wire both ways |
| `7681cbb` | — | correct two reasons in `node-records` that this plan retired |

## Verification

| Check | Result |
|---|---|
| `npx tsc --noEmit` | **exit 0**, against a resolver proven to read this worktree |
| `npm run test:node` (full) | **109 files passed**, 2 skipped · **1556 tests passed**, 18 skipped |
| Base, derived from the diff | 108 files · 1553 tests |
| Delta | **+1 file, +3 tests** — exactly this plan's new file |
| `npx vitest run --project browser` | **219 files passed · 3261 tests passed** |
| `browser-capability.e2e.test.ts` (`--project e2e`) | **2 passed** — a live Chromium tab, so the browser factory is proved to *construct and serve*, not merely to compile |
| `purity.node.test.ts` | passed — `@o2/core` and `@o2/net` remain PORTABLE |
| `vocabulary.node.test.ts` | passed (`BANNED` read from the file, never transcribed) |
| `mutation-guard.node.test.ts` | passed — no ledger `find` text was disturbed |
| `node-records`, `enrollment`, `certificate-verification` | passed **with no assertion edited** — the regression bar the plan names |

**The base numbers are derived, not guessed.** `git diff --name-only b858c46 HEAD` touches
exactly five files; the only new test file is `provider-answering.node.test.ts` with three
`it` blocks. Of the two pre-existing test files edited, `serve-agent-hooks.node.test.ts`
gained assertions inside existing `it` blocks and no new one, and `node-records.node.test.ts`
changed comments only. So base = 109 − 1 files and 1556 − 3 tests.

**18-02-SUMMARY.md records a different baseline (107 files / 1546 tests) and it does not
reconcile with mine**, although my base commit *is* 18-02's merge. Recorded as an open
observation rather than silently normalised — see *Out-of-scope findings*.

**The `node_modules` trap, handled before any result was believed.** A fresh worktree has no
`node_modules`, and the main install's `@o2/*` entries are **relative** symlinks
(`../../packages/core`), so symlinking wholesale resolves back into the main checkout and
`tsc`/`vitest` verify the wrong tree while reporting clean. 184 third-party entries were
linked at the main install and a real `@o2` directory built pointing at **this worktree's**
packages. Proven with `createRequire(...).resolve` before anything else:

```
OK   @o2/core    -> …/agent-a981d89ec300b4601/packages/core/src/index.ts
OK   @o2/net     -> …/agent-a981d89ec300b4601/packages/net/src/index.ts
OK   @o2/libp2p  -> …/agent-a981d89ec300b4601/packages/libp2p/src/index.ts
OK   @o2/node    -> …/agent-a981d89ec300b4601/packages/node/src/index.ts
OK   @o2/browser -> …/agent-a981d89ec300b4601/packages/browser/src/index.ts
OK   @o2/aot, @o2/bench, @o2/demo   (same tree)
vitest     -> /Volumes/…/o2.services/node_modules/vitest/index.cjs
RESOLVER PROOF: PASSED
```

The probe and the farm script were deleted afterwards and appear in no commit.

**The worktree was cut from the wrong branch, for the third time today.** It was created from
`feature/bug-fixes-22`'s tip lineage at `c62bae5` (a `main` merge) — no phase-18 planning
directory and none of 18-01/18-02's source. `git reset --hard
feature/phase-18-discovery-capacity-placement` was run at startup against a clean tree with
nothing of this plan's work in it. Sanity checks then passed: `bin/agent.ts` is 458 lines
with `--peer-addr` present (5 occurrences), and `core/src/discovery.ts:474` holds
`class SelfRecordIndex`. Base commit is `b858c46`.

## What each task measured

### Task 1 — both factories serve a `SelfRecordIndex`, unconditionally

`ownRecords` now takes `NodeCertificate | null` and returns a `SelfRecordIndex` over the
node's **local-only** `store`. Its four-decision doc block kept three decisions verbatim and
replaced the first — *"`provide()` is never called … Phase 17 publishes; Phase 18 queries"* —
with the two that now hold: that the index answers **two independent questions**, and that
`providers` reads the local-only tier and never `blockstore`. The retired text is quoted in
place rather than deleted, because the failure mode is a reader reuniting the two halves.

The construction site binds the disposition once:

```ts
const egressDisposition = { guard: egress, sovereignInputs: store }
```

and passes it to both `withholdingFrom(egressDisposition)` and `serveAgent`'s `egress:` hook.
**This is stronger than the plan asked for.** The plan's invariant — *the predicate names
exactly the set `refusedReason` consults* — was to be written into a comment; binding one
value and passing it twice makes it a property of the code, and two object literals saying
the same thing were exactly the shape 18-02 found leaking.

The two lowered counts in `serve-agent-hooks.node.test.ts` each gained a paired positive
assertion, in the idiom that file already uses for `'relays-for-nobody'`.

### Task 2 — the answer, read over a real wire, both ways

`provider-answering.node.test.ts`, three tests over real libp2p on loopback TCP:

- a block put into A's `store` and nowhere else is answered `[A.nodeKey]`, **beside** a CID
  nobody holds answered `[]` in the same test;
- the same pair against a node with **no certificate**, with `records: null` read off the
  same wire in the same test — so the two halves are shown independent rather than assumed;
- the agreement invariant as **three readings in one window**: `a.store.has(cid)` is true,
  the `block` branch answers `error` with a reason containing `egress refused: `, and
  `providers` answers `[]`. Then the hold is released and the same CID is advertised again
  *and* served again.

Frames are built with `encodeRequest`/`parseResponse` rather than through `RpcRecordIndex`,
and the test says why: after 18-02 that adapter **unions across peers**, so asserting one
node's answer through it is asserting a union of one — which would still pass if the serving
node answered nothing and some other peer answered instead.

## Every reddening claim, planted and watched

Nothing below is restated from the plan. Each row is a mutation written into the source, run,
and reverted by editing the source back — never by `git checkout`. `git diff` was empty after
the reverts, which is how the exactness is known.

| # | Mutation | Where | Reddened | Held |
|---|---|---|---|---|
| 1 | restore `index: records ?? 'serves-no-records'` | `fabric-node.ts` | hooks test, line 98: sentinel count read **1**, expected 0 | ✅ |
| 1b | rename the binding so the hook reads `index: ownIndex,` (sentinel count stays 0) | `fabric-node.ts` | hooks test, line 99: positive read **0**, expected 1 | ✅ |
| 2 | pass `records: 'holds-no-records'` unconditionally | `fabric-node.ts` | **14 tests failed** across `node-records`, `enrollment`, `certificate-verification` | ✅ |
| 3 | `SelfRecordIndex.providers` → `return []` | `core/discovery.ts` | all **3** provider-answering tests | ✅ |
| 4 | restore `certificate === null ? null : ownRecords(…)` + the sentinel fallback | `fabric-node.ts` | **2 of 3** — the certificate-holding test still passed | ✅ |
| 5 | `withhold: 'advertises-everything-it-holds'` at the construction site | `fabric-node.ts` | exactly **1**, at the in-window `providers` reading: `expected [ Array(1) ] to strictly equal []` | ✅ |
| 6a | per-CID memo instead of a per-lookup consult | `fabric-node.ts` | line 319, the **in-window** reading | ✅ |
| 6b | sticky set — once withheld, always withheld | `fabric-node.ts` | line 330, the **post-release** reading: `expected [] to strictly equal [ Array(1) ]` | ✅ |

**All eight reddened. None was found false.** Four are worth calling out:

- **1 masks 1b, which is why both exist.** Vitest stops an `it` at the first failing
  assertion, so plant 1 fails on the sentinel count and never evaluates the paired positive.
  Plant 1b leaves the sentinel count at 0 and breaks only the positive — which is the
  *precise* claim the pair is making, and the only way to show the second assertion is not
  decoration.
- **5 is the side channel, observed rather than argued.** With withholding disabled the node
  advertised `[a.nodeKey]` for a block whose bytes its own `block` branch refused **in the
  same test window** — the refusal assertions passed and only the `providers` assertion
  failed. That is exactly the *cannot tell refusal from absence* ruling being converted into
  *can tell*, obtained without asking for the bytes.
- **6a and 6b are different defects and fail at different lines.** The memo caches the
  pre-window lookup (`false`), so it reddens the **in-window** reading; it does *not* isolate
  "the suppression ends when the hold does". The sticky variant passes the window and reddens
  the **post-release** reading instead. Planting only one would have left the other claim
  under-measured — the same lesson 18-02 recorded for its own 5a/5b pair.
- **4 is discriminating in the right direction.** Under it the certificate-holding node still
  answered `[a.nodeKey]`, and only the two tests about a certificate-less node failed. A
  mutation that broke everything would not have shown that the certificate and the blocks are
  independent.

## Plan errors found and corrected

### 1. Line 202's predicate — the label/payload defect (inherited, and confirmed)

The plan writes `egress.registrations.includes(cid.toString())`. 18-02 planted and measured
that this advertises a block the `block` branch refuses whenever a payload is registered
under a label that is not its CID. `withholdingFrom(egress)` was used instead, as the
prompt's binding correction and 18-02-SUMMARY.md both direct. **Not re-planted here** — it is
already a measured result with a test of its own (`provider-merge.test.ts`), and re-planting a
closed finding is restating it.

### 2. Line 238's reddening proof does not discriminate — measured, not reasoned

The plan's proof reads: *"Reddened by restoring `index: records ?? 'serves-no-records'` in
either file — the first assertion reads 1 and **the second reads 0**."*

`occurrences` matches a **literal substring**, and `index: records ?? 'serves-no-records',`
*contains* `index: records`. Measured against the pre-change source:

```
fabric-node.ts:  'index: records' = 1  |  'index: records,' = 0  |  "'serves-no-records'" = 1
browser-node.ts: 'index: records' = 1  |  'index: records,' = 0  |  "'serves-no-records'" = 1
```

So the plan's needle reads **1**, not 0, under the very mutation it names — the paired
positive assertion would have been satisfied by the defect it exists to catch. The needle
used is `index: records,` **with the trailing comma**, which reads 0 before and 1 after. The
comment above the assertion states this and names the measurement, so the next reader does
not re-derive it.

### 3. Task 2's sovereign-window fixture cannot open the window it asks for

The plan says to follow `sovereign-block-refusal.node.test.ts` and produce the registration
through the real submit path. The real submit path **releases every hold in a `finally`**
(`submit-with-egress.ts:171-176`), which that same file asserts outright at its line 297
(`expect(submitter.egress.registrations).toEqual([])`). So there is no window *after* a job,
and *during* one there is no synchronisation point a test can name.

`takeSovereignHold` was used instead, on node A's own `store` and `egress`. **This is not the
hand-made registration the plan warns against**: it is the exact function `serveAgent` calls
on every sovereign `exec` (`agent.ts:763`), given the same two values the factory passes
`serveAgent`, so the registration is identical to the production one and its lifetime — a
hold that is given back — is precisely what the invariant is about. The reason is written into
the test, not left as a silent departure.

### 4. The plan under-promised on tier identity

`must_haves` asks that the two expressions be *"textually identical apart from the local
variable names"*. They came out **byte-identical, variable names included** — same helper
name, same five arguments, same `egressDisposition` binding. Recorded because the weaker
promise would have been satisfied by a diverging pair.

## `file:line` citations, re-derived before being relied on

Every citation in the plan was checked against source. **All were correct** — unusual, and
worth recording against Phase 15's forty-one wrong ones. Numbers are pre-edit, at base
`b858c46`:

`fabric-node.ts:581-621` (the four-decision doc), `:622-638` (`ownRecords`), `:1058` (the
`EgressGuard`), `:1103-1106` (the conditional), `:1248` (`egress:` hook), `:1272-1274` (the
comment saying `providers` answers `[]`), `:1278` (the `index` hook);
`browser-node.ts:439-447` and `:442` (its `ownRecords`), `:778-781` (the conditional), `:988`
(the hook); `serve-agent-hooks.node.test.ts:38-39` (`occurrences`), `:81` and `:131` (the two
counts), `:154` (the tier-drift test); `net/src/agent.ts:575-599` (the two branches under
test); `core/src/discovery.ts` `SelfRecordIndexOptions` and `class SelfRecordIndex`.

The one plan statement that is *not* a citation error but is now stale by its own action:
`fabric-node.ts:1272-1274`'s comment is the text this plan retires.

## Deviations from Plan

### Auto-fixed

**1. [Rule 1 — bug] Two comments in `node-records.node.test.ts` described mechanism this plan
retired**

- **Found during:** Task 1, running the file as the regression bar.
- **Issue:** one read *"Such a node still passes the sentinel, so `'serves-no-records'`
  appears exactly once in `fabric-node.ts` and `serve-agent-hooks.node.test.ts` needs no
  change"* — **both halves false after this plan**. The other gave *"`provide()` is never
  called"* as the reason a `providers` answer is empty; the reason is now that the node does
  not hold the block.
- **Fix:** both replaced, each quoting what it replaced and why, in the discipline 18-02 used
  for `net/src/discovery.ts`'s module header.
- **Assertions untouched.** `git diff -U0` filtered to non-comment lines returns **empty**,
  and the file passed unedited *before* the correction — so the plan's regression bar was
  measured on the untouched file and the correction is documentation only.
- **Commit:** `7681cbb`

### Departures from the plan's letter, each with its reason

**2. The withholding predicate's source is a bound value, not an inline literal.** The plan
shows the predicate built at the construction site from `egress`; binding
`egressDisposition` once and passing it to both `withholdingFrom` and `serveAgent` gives the
same result and removes the possibility of the two readers ever being given different
objects.

**3. The needle is `index: records,`.** Measured above; the plan's form does not discriminate.

**4. The sovereign window uses `takeSovereignHold`.** Measured above; the plan's route has no
window.

**5. An eighth reddening plant.** The plan's Task 2 proof lists four claims. Eight mutations
were planted, because two of the plan's claims turned out to need two plants each to isolate
what they assert (1/1b and 6a/6b).

**No existing assertion was weakened, altered or deleted.** The two lowered counts each gained
a paired positive, `node-records`/`enrollment`/`certificate-verification` passed with no
assertion edited, and `serve-agent-hooks.node.test.ts`'s tier-drift test (`:154`) — the file's
own instrument for exactly the failure this plan risks — still passes untouched.
`BENCH` and `PERF_WORKLOAD`'s counts were left alone, as the plan directs; those are Plan
18-06's.

## Limits, in the words the plan requires

- **Gating `providers` on `verifiedPeers` is unmeasured, not descoped.** A node answers
  `providers` to any peer that can dial it, exactly as it answers `block` and `records`.
  Whether an unverified peer should be able to ask is a question this phase raises and does
  not settle. The sentence is in the test file's header too, so it is not only in a planning
  document.
- **SCHED-01 is advanced and not closed**, so `requirements-completed` is empty. The
  requirement asks for candidate nodes discovered by *"querying providers of a data CID
  intersected with required capability records"* — this plan delivers the providers half's
  production answer, and `discoverExecutors` still has **no production caller**. That is Plan
  18-05's.
- **NET-06 is advanced and not closed.** Every node, browser tier included, now answers a
  provider lookup about its own store. What NET-06 asks beyond that — two browser peers
  discovering each other on a static bundle with nothing dialled by a harness — is Phase 19
  criterion 4's.
- **The browser tier's provider answer is not read over a browser-to-browser wire.** It is
  proved to *construct and serve* in a live tab (the e2e run above) and to be built from an
  expression byte-identical to the Node tier's. The `browser` project cannot host the
  two-tab case, because a Circuit Relay v2 server *"will not work in browsers"* in
  `@libp2p/circuit-relay-v2`'s own words.
- **The reach is directly-connected peers only** — no transitive routing, no DHT. That is
  ruling D1's stated limit, not a new restriction.

## Out-of-scope findings

**1. The full-suite baseline does not reconcile with 18-02's.** 18-02-SUMMARY.md records
107 files / 1546 tests after its work, and its merge is my base commit — but my run reads
109 / 1556 with a diff that adds exactly one file and three tests, implying a base of
108 / 1553. Not investigated and not fixed; it does not affect this plan's delta, which is
derived from the diff rather than from the difference of two totals. Worth one command from
whoever runs 18-04: measure the base explicitly rather than inheriting a predecessor's number.

**2. `tools/aot/lift.node.test.ts` did not reproduce 18-02's flake.** That summary records
three load-sensitive failures in one full-suite run. My full run was green, so the file is
recorded as intermittent rather than broken — consistent with 18-02's own diagnosis
(a 20 s per-spawn budget against process-spawn latency under a loaded parallel run).

**3. `RpcRecordIndex` still has no production caller.** Unchanged from 17-04 and 18-02. Every
use is a `.test.ts`, including this plan's — which deliberately does not use it, for the
union-of-one reason above. Its first production caller is 18-05's.

**4. `bin/bench.ts` and `bench/src/perf-workload.ts` still pass the sentinel twice each**, and
are deliberately untouched: whether a benchmark's own workers answer provider lookups is a
decision about what the published curve measures, and Plan 18-06 owns it.

**5. `gsd-sdk query state.record-metric` corrupts STATE.md's frontmatter — reproduced, and
reverted.** Asked only to append one metrics row, it also rewrote the frontmatter to stale and
wrong values: `status` `executing` → `verifying`; `stopped_at` replaced with Phase 14 text;
`last_activity` **regressed** 2026-08-01 → 2026-07-31; and the progress block rewritten
`total_phases` 14 → 20, `completed_phases` 5 → 8, `completed_plans` 39 → 42, **`percent` 36 →
74**. It also reflowed ~30 unrelated list blocks.

This is the hazard STATE.md's own maintenance comment already documents — *"it rewrote 25% to
62% … Maintain this frontmatter by hand"* — so the tool is doing a known-bad thing and the
warning is one scroll above the data it damages. The whole file was reverted with
`git checkout -- .planning/STATE.md` (a file this plan had just modified itself, not
another agent's work) and the single row was added by hand. `git diff` now shows exactly one
added line.

**Whoever runs 18-04 onward: do not call `state.record-metric` on this repository.** Append
the row by hand. `roadmap.update-plan-progress` was checked separately and is **safe** — its
edit derives from the summaries on disk and ticked 18-01/18-02/18-03 correctly.

## Known stubs

None. `SelfRecordIndex` reads a real store, the predicate scans real bytes against the real
guard, and both are read by a peer over a real transport in this plan's own test. There is no
placeholder value, no hardcoded empty collection reaching a UI, and no component wired to mock
data.

The deliberate absence is that **nothing queries yet**: `discoverExecutors` has no production
caller, so the answer this plan makes truthful is not yet intersected with anything. That is
the plan's own boundary and it is why `requirements-completed` is empty.

## Threat flags

None. No new wire frame, no new request kind, no new endpoint, no auth path, no file-access
pattern and no schema at a trust boundary. `providers` was already a request kind, already
parsed and already served; this plan changed only *what a node computes as the answer*.

The one security-relevant change is in the **restricting** direction, and it is the plan's
centre: a node that previously advertised nothing now advertises what it holds **minus**
anything its `block` branch would refuse — wired from the same guard value that branch reads,
so the two cannot diverge. Mutation 5 above is the measurement that the subtraction is load-
bearing rather than decorative.

## Self-Check: PASSED

Files claimed, listed off disk:

```
FOUND  packages/node/src/provider-answering.node.test.ts   333 lines (new)
FOUND  packages/node/src/fabric-node.ts                    modified
FOUND  packages/browser/src/browser-node.ts                modified
FOUND  packages/node/src/serve-agent-hooks.node.test.ts    modified
FOUND  packages/node/src/node-records.node.test.ts         modified (comments only)
```

The plan's `must_haves.artifacts` require `fabric-node.ts` to provide an `ownRecords`
returning a `SelfRecordIndex` over the local-only store handed unconditionally to the index
hook — present; `browser-node.ts` to carry the byte-identical wiring — present and verified
byte-identical; and `provider-answering.node.test.ts` to read the answer over a real wire both
ways plus the withholding invariant — present, three tests, all green.

`'serves-no-records'` count in each factory: **0**. `index: records,` count in each: **1**.

Commits claimed, found in `git log --oneline --all`:

```
FOUND  7681cbb  docs(18-03): correct two reasons in node-records that this plan retired
FOUND  d29177f  test(18-03): the providers answer, read off a real wire both ways
FOUND  6cbf8f6  feat(18-03): both tiers answer for what they hold, certificate or not
```

No commit in this plan deleted a tracked file: `git diff --diff-filter=D --name-only HEAD~1 HEAD`
was run after each and returned empty every time. Nothing was staged with `git add -A`; every
path was staged explicitly. None of `packages/core/src/placement.ts`,
`packages/core/src/index.ts`, `packages/net/src/protocol.ts`, `packages/net/src/agent.ts` or
`packages/net/src/discovery.ts` was modified — the concurrently-edited set is untouched, and
`git diff --name-only b858c46 HEAD` returns exactly the five files listed above (the four the
plan names, plus the comment-only correction to `node-records.node.test.ts`).
