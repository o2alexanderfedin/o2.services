---
status: passed
phase: 12
verified: 2026-07-27
criteria_met: 4
criteria_total: 4
score: 4/4 criteria verified
gap_closed_after_verification:
  - truth: "criterion 1 — placement discrimination through bin/agent.ts"
    closed_by: "packages/node/src/sovereignty-placement.node.test.ts (commit 7680fd5)"
    note: >
      This pass reported criterion 1 as PARTIAL because plan 12-03 had never been
      executed — the orchestrator dropped it between two dispatches. The finding was
      correct and is preserved verbatim below. 12-03 was then run and the gap closed;
      see the addendum at the end of this file. The frontmatter reads 4/4 because that
      is now true, not because the finding was wrong.
gaps_as_originally_found:
  - truth: "A job submitted through bin/agent.ts whose input carries an owner's sovereignty label places its map task only on that owner's nodes; a test that applies artificial load pressure specifically to force relocation onto a non-owner node fails to move it, because the live placement path has no branch that can"
    status: partial
    reason: >
      The placement mechanism itself is real and mutation-verified (a widen-under-pressure
      branch planted in submitJob's placement loop was independently reproduced and caused
      exactly the four-test failure signature 12-CONTEXT.md predicts). But the roadmap's
      literal evidentiary requirement — "a job submitted through bin/agent.ts" — has zero
      coverage. Plan 12-03, whose entire and only purpose was to build this exact real
      OS-process proof, was never executed. No file named sovereignty-placement*.node.test.ts
      exists anywhere in git history. The only load-pressure discrimination test that exists
      (packages/core/src/job/submit.test.ts) runs inside a single Vitest process against
      fake in-memory executors and never touches bin/agent.ts. 12-04-SUMMARY.md's "Next Phase
      Readiness" section nonetheless cites "placement discrimination (12-02/12-03)" as
      evidence criterion 1 is satisfied — a false claim, since 12-03 does not exist.
    artifacts:
      - path: "packages/node/src/sovereignty-placement.node.test.ts"
        issue: "Never created. 12-03-PLAN.md names this exact path as 'the real cross-process placement proof ROADMAP criterion 1 literally names' — the plan exists, the file it specifies does not."
    missing:
      - "A test that spawns two or more real bin/agent.ts child processes (reusing two-process.node.test.ts's spawnAgent/stopAgent/startSubmitter scaffolding, per 12-03-PLAN.md's own interfaces section), submits a sovereign job through submitJob with the owner's process described as saturated and foreign processes as idle, and asserts the map task never lands on a foreign process — closing the exact gap two-process.node.test.ts already closed for the non-sovereignty case."
      - "ROADMAP.md's own Phase 12 checklist already shows this honestly: the top-level Phase 12 line and the 12-03-PLAN.md line are both unchecked ([ ]), unlike 12-01/12-02/12-04. The gap is visible in the roadmap; it is the SUMMARY narrative that overstates it."
human_verification:
  - test: "Dispatch a sovereign-labelled Task at a running BrowserNode (via a real IndexedDB + relay, e.g. a fake-indexeddb-backed unit test or a window.o2 API extension + new e2e scenario) and confirm it refuses exactly as fabric-node.ts does over real RPC."
    expected: "The default-constructed BrowserNode (no sovereignty option) refuses the sovereign task with a reason naming the node and 'sovereignty', identical in shape to fabric-node.node.test.ts's DATA-09 test."
    why_human: "BrowserNode.start() requires a real indexedDB and dials a real relay; it cannot run in the node vitest project, and vitest's browser-mode project has no Node-side relay to dial against. No test in the repo currently exercises this path — confirmed independently: zero occurrences of 'sovereign' in any file under packages/browser or in any *.e2e.test.ts. The wiring is structurally identical to fabric-node.ts's (same guardSovereignty call, same safe default, tsc-clean) but composition-correctness at runtime is unproven for the browser tier."
---

# Phase 12: Sovereignty-Pinned Placement — Verification Report

**Phase Goal (ROADMAP.md):** A sovereignty label travels with its data and pins its map
task to the owner's node on the one live job path, with pushdown and backbone
execution-ineligibility enforced — not only in a test that builds its own fabric by hand.

**Branch:** `feature/v1.1-wire-what-was-built`, HEAD `13a204c` ("Merge Phase 12 —
sovereignty onto the live job path, and guarded at the far end")

**Verified:** 2026-07-27
**Status:** gaps_found — 3 of 4 criteria fully met; criterion 1 is met at the mechanism
level and unmet at the evidentiary level the roadmap literally specifies.

**My mandate for this pass:** find the third defect, not confirm the first two were fixed.
Everything below marked MET was executed on this host, on this date, with real command
output pasted in. The one criterion marked PARTIAL was measured, not rounded up.

---

## Baseline

```
$ npx tsc --noEmit
(clean, no output)

$ npx vitest run
 Test Files  116 passed (116)
      Tests  1758 passed (1758)
   Duration  288.08s

$ npx vitest run packages/node/src/vocabulary.node.test.ts packages/node/src/purity.node.test.ts
 Test Files  2 passed (2)
      Tests  38 passed (38)
```

Matches the stated baseline exactly (116 files / 1758 tests, tsc exit 0). This confirms
nothing regressed on the merge — it does not by itself confirm the four criteria, which
is the rest of this report.

---

## Criterion 1 — Load-pressure placement, through `bin/agent.ts`

> A job submitted through `bin/agent.ts` whose input carries an owner's sovereignty label
> places its map task only on that owner's nodes; a test that applies artificial load
> pressure specifically to force relocation onto a non-owner node fails to move it,
> because the live placement path has no branch that can.

**PARTIAL. Mechanism proven; the roadmap's named evidentiary form (`bin/agent.ts`) does
not exist.**

### The mechanism is real

`submitJob` (`packages/core/src/job/submit.ts`) builds one `PlacementRequest` per shard
and calls `sovereignty.ts`'s `planPlacement`/`eligibleNodes` before touching an
`Executor` — there is no other branch in the file that selects a node. I planted the
exact mutation the task brief asked for and watched it fail:

```
$ git diff packages/core/src/job/submit.ts   # widen-under-pressure fallback added:
+    if (placement.status === 'placed') {
+      const chosenLoad = Math.min(...)
+      if (chosenLoad >= 0.9) {
+        const widenedPlan = planPlacement([{ ...request, label: 'public' as const }], nodesForShard)
+        plan = widenedPlan; placement = widenedPlan.placements[0] as Placement
+      }
+    }

$ npx tsc --noEmit          # clean
$ npx vitest run packages/core/src/job/submit.test.ts
 Test Files  2 failed (2)
      Tests  4 failed | 48 passed (52)

 FAIL > places a sovereign shard on its owner's node under load pressure engineered to force relocation
   expected [ 'bob-1' ] to deeply equal [ 'alice-1' ]
 FAIL > DATA-09 — a node that genuinely holds the shard data but cannot decrypt it is still excluded from execution
   expected [ 'replica-1' ] to deeply equal [ 'alice-1' ]
 (each doubled across the node + browser vitest projects = 4 failures)
```

This is exactly the "four tests fail" signature 12-CONTEXT.md predicts for this class of
mutation. Reverted; `git diff` empty; `npx tsc --noEmit` clean;
`npx vitest run packages/core/src/job/submit.test.ts` → 52/52 passing again.

**So: the live placement path genuinely has no branch that can widen under load.** That
part of the criterion is true.

### What is not proven: "a job submitted through `bin/agent.ts`"

I read the load-pressure test that exists, in full
(`packages/core/src/job/submit.test.ts:373-411`):

```ts
const nodes = [
  { nodeId: 'alice-1', ownerId: 'alice', canExecuteSovereign: true, load: 1 },
  { nodeId: 'bob-1',  ownerId: 'bob',   canExecuteSovereign: true, load: 0 },
  ... (bob-2..4) ...
]
const executors = nodes.map((n) => honest(n.nodeId))   // <- in-memory fake, not RemoteExecutor
```

`honest()` is a hand-written in-memory `Executor` fixture defined at the top of the same
test file. This test runs entirely inside one Vitest process. It never imports
`RemoteExecutor`, never spawns a child process, and never touches
`packages/node/src/bin/agent.ts`. It is, plainly, a `submitJob` unit test — valuable, and
it is the thing that let the mutation above fail — but it is not what the roadmap's
sentence names.

I searched for any test in the repo that both spawns `bin/agent.ts` and carries a
sovereignty label:

```
$ grep -rl "bin/agent" packages --include="*.test.ts"
packages/node/src/fabric-node.node.test.ts
packages/node/src/two-process.node.test.ts

$ grep -n "sovereign" packages/node/src/two-process.node.test.ts
(no matches — this file is entirely public-shard jobs)

$ grep -n "sovereign" packages/node/src/fabric-node.node.test.ts
... a single test, "a node started with no sovereignty option refuses; one started
    cleared for the owner accepts" — a direct RemoteExecutor.execute() dispatch of one
    Task to one node. No submitJob call, no load pressure, no second candidate node to
    relocate onto.
```

That single real-process test proves DATA-09's serving-side refusal over real RPC
(covered under Criterion 4 below). It does not exercise `submitJob`'s placement
discrimination at all, let alone under load pressure, let alone across multiple real
`bin/agent.ts` processes representing an owner's node and foreign nodes.

### Why this specific gap, and not something smaller

`packages/phases/.../12-03-PLAN.md` exists in the repo and its entire, sole stated
objective is: *"Prove ROADMAP criterion 1 literally... Plan 12-02's proof runs entirely
inside one Vitest process against in-memory executors — sufficient to prove the wiring,
but not sufficient to prove it survives a real OS-process boundary."* Its
`must_haves.artifacts` names the exact deliverable:
`packages/node/src/sovereignty-placement.node.test.ts`.

```
$ find /Users/alexanderfedin/Projects/o2.services -name "sovereignty-placement*"
(no output — the file does not exist)

$ git log --all --diff-filter=A --name-only | grep -i "sovereignty-placement"
(no output — it was never added, in any branch, at any point in history)
```

There is no `12-03-SUMMARY.md`. `12-01-SUMMARY.md` and `12-02-SUMMARY.md` both note "not
executed by this agent" for 12-03. `ROADMAP.md` itself is honest about this:

```
- [ ] **Phase 12: Sovereignty-Pinned Placement** - ...
...
- [ ] 12-03-PLAN.md — Prove sovereignty-pinned placement across real bin/agent.ts
      operating-system processes (criterion 1, literally)
```

both the phase line and the 12-03 line are unchecked, unlike 01/02/04. **But
`12-04-SUMMARY.md`'s "Next Phase Readiness" section says:** *"All four ROADMAP criteria
for Phase 12 are now demonstrated on the live `submitJob` path... placement
discrimination (12-02/12-03)..."* — citing a plan that was never run as joint evidence.
That is the exact shape of defect this verification pass exists to catch: a SUMMARY
narrative claiming completeness that the roadmap's own checklist already contradicts.

**Verdict: PARTIAL.** The property ("no code path can relocate a sovereign shard under
load") is real and independently reproduced by mutation. The specific proof the roadmap
names — through `bin/agent.ts`, across a real OS-process boundary, is 0% built.

---

## Criterion 2 — Non-optional owner label

> `JobSpec` and `Task` objects constructed by `submitJob` carry a non-optional owner
> label; submitting without one is rejected rather than silently treated as unowned.

**MET, at the boundary the criterion is actually about — with a documented and verified
type-level nuance.**

`ShardSpec` (`packages/core/src/job/submit.ts:29-31`) is a closed discriminated union:

```ts
export type ShardSpec =
  | { readonly value: CanonicalValue; readonly label: 'public' }
  | { readonly value: CanonicalValue; readonly label: 'sovereign'; readonly ownerId: OwnerId }
```

There is no way to construct a `ShardSpec` in normal TypeScript without naming `label`,
and a `'sovereign'` one without `ownerId`. The only bypass is an `as ShardSpec` cast, and
`submitJob` has a runtime backstop for exactly that (`shard-missing-owner`,
`submit.ts:155-159`), which I confirmed rejects `ownerId.length === 0` as well as a
missing field.

`Task.label`/`ownerId` (`packages/core/src/ports.ts:46-47`) **is** optional at the port
level. I checked whether this "relocates the hole" per the hunt brief, by finding every
production (non-test) site that constructs a `Task` with the
`moduleCid/inputCid/partitionIndex/partitionCount` shape:

```
$ grep -rln "moduleCid" packages --include="*.ts" | grep -v test
packages/net/src/protocol.ts       # parseRequest — wire boundary
packages/core/src/job/submit.ts    # submitJob — in-process boundary
... (checkpoint.ts, verify.ts, task-worker.ts, wasm.ts, wasi-executor.ts, worker-executor.ts
     — all *receive* task: Task as a parameter; none of them construct a bare Task)
```

Exactly two production sites construct a real `Task` for dispatch, and both enforce the
label unconditionally:

- `submit.ts:220-236` — every `Task` it builds sets `label: shard.label`, sourced from
  the non-optional `ShardSpec`.
- `protocol.ts:409-420` (`parseRequest`) — `if (labelValue !== 'public' && labelValue !==
  'sovereign') return null`. An exec request that omits the label at the wire is refused
  outright before a `Task` is ever built. I mutation-tested this directly (see Criterion
  1's neighbor, Mutation 2, below) and it fails in exactly the expected way.

So `Task.label` stays optional at the *type* level (a deliberate, documented compromise
to avoid touching ~65 unrelated `Task` literals in unrelated tests), but every
*production* construction path enforces it. I did not find a production caller, a local
self-dispatch path (`includeSelf` in `packages/browser/demo/main.ts:538` just adds
`n.executor` to the array `submitJob` already labels correctly), or an internal shortcut
that reaches a guarded executor with a genuinely sovereign task carrying no label.

**Verdict: MET.** The type-level optionality is real but does not create a reachable
hole in production; the enforcement genuinely lives at the two construction boundaries,
not merely relocated to a place nothing reaches.

---

## Criterion 3 — Pushdown

> Running that job with a filter/projection/partial-aggregation step shows the owner's
> node performing the reduction locally — the bytes crossing the network are the reduced
> output... not the raw input itself.

**MET.**

```
$ npx vitest run packages/net/src/sovereign-execution.test.ts -t "criterion 3|criterion 4"
 Test Files  2 passed (2)
      Tests  4 passed | 8 skipped (12)
```

I read `packages/net/src/sovereign-execution.test.ts:462-507` in full. The test submits a
sovereign shard **through `submitJob`** (the live job path, not a hand-called
`executeVerified`), dispatched over real `RpcEndpoint`/`serveAgent` protocol machinery
(`MemoryNetwork` transport — real protocol encode/decode and RPC framing, not raw
in-process function calls):

```ts
expect(outputEncoded.bytes.length).toBeLessThan(rawEncoded.bytes.length)   // DATA-07
expect(owned.guard.manifest.violations).toEqual([])
expect(owned.guard.manifest.entries.length).toBeGreaterThan(0)
```

This is exactly Risk 1 in `12-CONTEXT.md`'s proposed resolution: prove pushdown without
the Phase-13 egress manifest, by asserting the emitted partial is smaller than the raw
input, using the existing `EgressGuard` tap reused as a test instrument (not newly wired
into production — that stays Phase 13's job, honestly noted in the SUMMARY and confirmed
by grep: `EgressGuard` is not constructed in `fabric-node.ts` or `browser-node.ts`).

**Verdict: MET**, on the live `submitJob` path, over real RPC framing, without borrowing
Phase 13's manifest.

---

## Criterion 4 — Backbone execution-ineligibility

> Dispatching a sovereign task at a node holding only an encrypted replica is refused
> before instantiation and names the violation, even though that node answers
> availability queries for the data.

**MET for the node/backbone tier — the tier DATA-09's own requirement text names
("Backbone encrypted replicas..."). NOT independently proven for the browser tier; see
Human Verification.**

### Two independent, real proofs

**1. Real OS process, real RPC, default-safe wiring** —
`packages/node/src/fabric-node.node.test.ts:229-260`, spawning `bin/agent.ts` via the
same `FabricNode.start()` factory the binary calls:

```
$ npx vitest run packages/node/src/fabric-node.node.test.ts -t "DATA-09"
 Test Files  1 passed (1)
      Tests  1 passed | 5 skipped (6)
```

A node started with **no** `sovereignty` option refuses a sovereign `Task` dispatched via
`RemoteExecutor` over a real TCP socket; a node started `{ownerId: 'alice',
canExecuteSovereign: true}` accepts the identical task. No hand-built fabric.

**2. Genuine replica holder, still answers block queries** —
`packages/net/src/sovereign-execution.test.ts:428-460` ("criterion 4"), included in the
4/4 pass above. Bob's node genuinely holds the sovereign block in its own
`MemoryBlockstore` (proven by a direct `{kind: 'block', cid}` RPC request returning the
bytes), and is `canExecuteSovereign: false`. A directly-dispatched sovereign `Task`
(bypassing placement entirely, deliberately, the same way `distributed.test.ts`'s AUTH-03
test bypasses placement) is refused, naming both the node id and "sovereignty" in the
reason string — the assertion checks the literal string, not just `ok: false`.

### I confirmed the refusal is real, not vacuous, by mutation

```
$ git diff packages/node/src/fabric-node.ts   # removed guardSovereignty wrap
-    const executor = guardSovereignty(new WasmExecutor(...), options.sovereignty ?? {...})
+    const executor = new WasmExecutor({ nodeId: ..., blockstore })

$ npx tsc --noEmit          # clean (no unused-import error under this repo's config)
$ npx vitest run packages/node/src/fabric-node.node.test.ts --project node -t "DATA-09"
 FAIL > a node started with no sovereignty option refuses; one started cleared for the owner accepts
   AssertionError: expected true to be false
     - false
     + true
```

Reverted; `git diff` empty; `npx tsc --noEmit` clean; test green again (6/6, wider file).

```
$ git diff packages/net/src/protocol.ts   # removed parseRequest's label requirement
-  if (labelValue !== 'public' && labelValue !== 'sovereign') return null

$ npx tsc --noEmit          # clean
$ npx vitest run packages/net/src/distributed.test.ts --project node -t "refuses an exec request with the label omitted"
 FAIL > refuses an exec request with the label omitted, before it reaches the executor
   AssertionError: expected { ok: true, kind: 'exec', ... } to deeply equal { kind: 'error', reason: 'malformed request' }
```

Reverted; `git diff` empty; `npx tsc --noEmit` clean; test green again.

Both mutations — the two the task brief specifically asked me to plant — fail exactly as
claimed. `git status --short` is clean after all three mutation-and-revert cycles above.

### What is not proven

`packages/browser/src/browser-node.ts:228-234` wraps `guardSovereignty` around the
executor before it reaches `GovernedExecutor`, structurally identical to
`fabric-node.ts`'s pattern (same function, same safe default
`{ownerId: '', canExecuteSovereign: false}`, `tsc`-clean against the same types). I
confirmed, independently of the SUMMARY's own disclosure, that no test exercises this at
runtime:

```
$ grep -rl "sovereign" packages/browser --include="*.test.ts"
(no output)

$ grep -ln "sovereign" packages/node/src/*.e2e.test.ts
(no output — checked two-tabs, many-tabs, colouring-demo, background-tab, seed-discovery,
 code-cache, built-bundle — none reference sovereignty)
```

`BrowserNode.start()` requires a real `indexedDB` and dials a real relay, so it cannot
run in the `node` vitest project, and the browser-mode vitest project has no relay to
dial against — the SUMMARY's own stated reason for not building this test. I confirm the
reason is accurate, not just that it was given. This is a real, disclosed, independently
verified gap — routed to Human Verification below rather than silently accepted, because
call-site existence and composition-correctness are not the same claim and only the
former is checked for this file.

**Verdict: MET** for the criterion as DATA-09 names it (backbone/Node execution-side
refusal, over real RPC, with a genuine replica holder). The browser tier's identical
wiring is unverified at runtime and needs a human/follow-up decision, not a code fix.

---

## Empty-`ownerId` collision check (hunt item 4)

The default sovereignty on both node constructors is `{ownerId: '', canExecuteSovereign:
false}`. I checked whether an empty-string owner could ever collide with a real sovereign
task:

- `submitJob`'s `shard-missing-owner` check rejects `shard.ownerId.length === 0` before a
  `Task` is ever built (`submit.ts:156`).
- `parseRequest` rejects `ownerId.length === 0` for a `'sovereign'` label at the wire
  (`protocol.ts:416`).
- Even if both were bypassed, `guardSovereignty`'s check is a conjunction —
  `task.ownerId === node.ownerId && node.canExecuteSovereign` — and the default's
  `canExecuteSovereign: false` makes the whole expression `false` regardless of what
  `ownerId` is. An operator who explicitly misconfigures `canExecuteSovereign: true` with
  a blank `ownerId` is a real threat (already flagged in 12-04-SUMMARY.md's own "Threat
  Flags" table), but no production path can produce that combination by omission.

**No hole found here.**

---

## Public work regression check (hunt item 5)

```
$ timeout 90 node --experimental-strip-types packages/node/src/bin/bench.ts --quick
o2 benchmark — quick run, 6 iterations
  memory transport, 1 node(s)… / 2 / 4
  real transport, 1 node(s)… / 2
  skewed configuration, memory transport…
  single-threaded baseline…
wrote .planning/BENCHMARK-RESULTS.md and .planning/bench/raw.json
```

Ran to completion, no errors, using `publicNodes(executors)` through the new `JobSpec`
shape. (Output files reverted with `git checkout` after this check — this was a
verification run, not a phase change.) The browser demo path (`packages/browser/demo/
main.ts`, also using `publicNodes`) is exercised by the e2e suite already included in the
1758/1758 full-suite pass (`colouring-demo.e2e.test.ts`, `two-tabs.e2e.test.ts`, etc.).

**No regression found.**

---

## Summary

| # | Criterion | Verdict |
|---|-----------|---------|
| 1 | Load-pressure placement, through `bin/agent.ts` | **PARTIAL** — mechanism real and mutation-verified; the roadmap-named real-OS-process proof (Plan 12-03) was never built |
| 2 | Non-optional owner label on `JobSpec`/`Task` | **MET** — enforced at both production `Task`-construction boundaries; type-level optionality does not create a reachable hole |
| 3 | Pushdown, observed without Phase 13's manifest | **MET** — through `submitJob`, over real RPC framing |
| 4 | Backbone execution-ineligibility | **MET** for node/backbone; browser tier structurally wired but has zero runtime proof (routed to human verification) |

**3 of 4.** Criterion 1's gap is not cosmetic: it is the literal, named reason
`12-03-PLAN.md` exists as a separate plan, and its absence is misrepresented as closed in
`12-04-SUMMARY.md`'s completion narrative even though `ROADMAP.md`'s own checklist
already shows it open. This is the third defect the task brief asked me to find, in the
same family as the two already caught this phase (zero production callers; fails open) —
a mechanism that is real and tested, but not tested at the layer the roadmap actually
specified, with a SUMMARY that rounds the gap up to "demonstrated."

---

## Requirements Coverage

| Requirement | Description | Status | Evidence |
|---|---|---|---|
| DATA-03 | Sovereignty label travels with data, hard scheduling constraint | **PARTIAL** — same gap as Criterion 1: the constraint is real and mutation-verified in-process; not proven across a real OS-process boundary |
| DATA-04 | Sovereignty-pinned task executes only within owner's node set, scheduler cannot relocate under load | **PARTIAL** — same gap as Criterion 1 |
| DATA-07 | Filters/projections/partial-aggregation push down | **SATISFIED** — Criterion 3 |
| DATA-09 | Backbone encrypted replicas never execution-eligible | **SATISFIED** (node/backbone tier) — Criterion 4; browser tier unverified at runtime |

Note: `.planning/REQUIREMENTS.md`'s own audit table (lines 380-386) independently
corroborates this split — it already marks DATA-07 and DATA-09 "Done" with citations to
12-04, but leaves DATA-03/DATA-04 with the pre-Phase-12 "Built, not wired" text
unchanged. That table was not updated by this verification pass; it is cited here only as
independent evidence that the same gap was visible before this report was written.

---

## Anti-Patterns

None found. No `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER` markers in any file this
phase touched (`submit.ts`, `sovereignty.ts`, `sovereignty-guard.ts`, `protocol.ts`,
`fabric-node.ts`, `browser-node.ts`, `ports.ts`).

---

## Working Tree State

All three planted mutations were reverted before this report was written:

```
$ git status --short
(clean)
$ npx tsc --noEmit
(clean)
```

---

*Verified: 2026-07-27*
*Verifier: Claude (gsd-verifier)*

---

# Addendum — criterion 1 closed, 2026-07-27

The finding above was correct: plan 12-03 had never been executed. The orchestrator
dispatched 12-02 alone as "Wave 2", told that executor 12-03 was not its plan, and went
on to Wave 3. The plan fell between two dispatches. Nothing about the finding is revised
here; it is closed.

## What was built

`packages/node/src/sovereignty-placement.node.test.ts` — commit `7680fd5`.

Three genuine operating-system processes via
`spawn(process.execPath, [AGENT, '--dir', dir, ...])` where `AGENT` resolves to
`bin/agent.ts`, the same mechanism `two-process.node.test.ts` already uses for NET-01.
Alice, bob1 and bob2 each run their own `FabricNode`, dialled after a one-line stdout
handshake, sharing nothing but a TCP socket.

The arrangement is the discrimination:

| node | owner | `canExecuteSovereign` | load |
|---|---|---|---|
| alice | alice | true | **1** (saturated) |
| bob1 | bob | true | 0 (idle) |
| bob2 | bob | true | 0 (idle) |

Both bob nodes are `canExecuteSovereign: **true**` — they are fully capable of sovereign
work in general, and excluded solely by *ownership*. That separates the sovereignty
constraint from the clearance constraint, so this test cannot pass for the wrong reason.

## Confirmed independently

```
npx tsc --noEmit                                                    clean, exit 0
npx vitest run packages/node/src/sovereignty-placement.node.test.ts 1 passed
```

Checked for a skip guard rather than assuming: the verbose reporter shows `✓` not `↓`,
and the file contains no `skipIf`/`skip`/`todo`. The 638 ms runtime looked implausible
for three process spawns, so it was compared against precedent — `two-process.node.test.ts`
runs 3 real-spawn tests in 1.47 s. Node's native type stripping plus loopback TCP is
genuinely that fast.

## The mutation, and what it revealed

The widen-under-pressure branch was planted in `submitJob`'s placement loop and the new
test watched failing: `expected 'insufficient' to be 'agreed'`.

The captured output is more interesting than a plain failure. Placement *did* leak — the
mutation picked `bob2`, idle and foreign — and then **bob2's own process refused it**,
through the `guardSovereignty` wrap Phase 12 put on every production node:

> `sovereignty violation: node … is not cleared to execute sovereign data for owner alice`

So the shard stalled as `insufficient` rather than completing as a silently-wrong
`agreed`. That is a strictly stronger signature than plan 12-02's in-memory equivalent,
which has no serving-side guard and does execute on the wrong node. The two defences —
placement and the serving-side gate — are independent, and this test shows both firing in
the real production composition.

Reverted; `git diff` empty; `tsc` clean.

## Plan adaptation

`bin/agent.ts` parsed only `--dir`/`--port`, so a spawned process could not be cleared for
its own owner and the central assertion could never reach `agreed`. Added `--owner-id` and
`--can-execute-sovereign` as a pass-through to the `FabricNodeOptions.sovereignty` option
that already existed — not a new mechanism, and no branch on node kind. Omitting
`--owner-id` keeps the safe default: cleared for nobody.

## Still open, unchanged by this addendum

The `human_verification` item stands. The browser tier's `guardSovereignty` wiring remains
structurally identical to `fabric-node.ts`'s and unproven at runtime — zero occurrences of
`sovereign` under `packages/browser` or in any `*.e2e.test.ts`. Phase 19's WIRE-03 is where
the browser tier gets real coverage.
