---
phase: phase-18-discovery-capacity-placement
plan: 12
subsystem: testing
tags: [instruments, mutation-ledger, sched-04, sched-06, criterion-2b, criterion-3, gap-closure]

requires:
  - phase: phase-18-discovery-capacity-placement/18-06
    provides: "the offer/exec split — `LocalCapacity.would` answers without reserving, which is what makes an accepted offer stale by the time the exec arrives"
  - phase: phase-18-discovery-capacity-placement/18-09
    provides: "the browser tier's runtime cap and the in-page readings this plan's wire reading is the twin of"
provides:
  - "Criterion 2b's absence-instrument, re-armed: a shard whose SELECTED executor refuses at exec, asserted through `verification.failures` — and measured to invert under a planted re-pick"
  - "Criterion 3's browser half as a measurement: a Node-tier peer reads a live tab's `capacity.slots` across `setDutyCycle`, over a direct WebSocket"
  - "Ledger entries `M36` and `M37`, both run for real through `npm run test:mutations` and both `caught`"
affects: []

tech-stack:
  added: []
  patterns:
    - "An assertion bounded by construction is not a guard — `agreeing.length <= redundancy` confines a reading to `{0,1}` however the system behaves"
    - "To measure an absence, assert the state that the missing behaviour would end; a reading taken outside the function that would gain the behaviour can never invert"
    - "Saturate between the offer answer and the dispatch: an accepted offer reserves nothing, so this is the real race the two clauses of SCHED-06 describe"
    - "A divergence defect needs two readings from two vantage points — one object reported to the page, another handed to the wire, and only a peer can tell them apart"

key-files:
  created:
    - .planning/phases/phase-18-discovery-capacity-placement/18-12-SUMMARY.md
  modified:
    - packages/node/src/discovery-agents.node.test.ts
    - packages/node/src/duty-cycle-tab.e2e.test.ts
    - packages/node/src/mutation-ledger.ts
    - packages/node/src/mutation-guard.node.test.ts
    - .planning/phases/phase-18-discovery-capacity-placement/deferred-items.md

key-decisions:
  - "The old `agreeing`-length assertion was REMOVED, not supplemented. `agreeing.length <= redundancy = 1` and the `agreed` narrowing above it excluded 0, so it was a tautology wearing the costume of a guard; leaving it beside a working reading would keep the thing that makes the next reader stop looking."
  - "The peer that takes the browser-tier reading is a SECOND Node-tier node, deliberately not the relay, so it holds no reservation for the tab and a circuit through it does not exist to be taken by accident."
  - "`M36` and `M37` are keyed on source text in the production file they edit, never on a test title — the way this phase lost M14. Their signatures are assertion output and are declared `rendered-at-runtime` honestly."
  - "`mutation-guard.node.test.ts` was edited outside the plan's declared files (Rule 3): it names the unchecked-signature arm explicitly and requires an edit there to justify any addition. The justification is recorded in the file."
  - "No production code was changed. Both gaps were instruments; `submit.ts` and `browser-node.ts` are byte-identical to the base commit, verified by `cmp` and by `git diff HEAD~3 HEAD` naming no production file."

requirements-completed: []
duration: one session
completed: 2026-08-02
---

# Phase 18 · Plan 12 — Two instruments: one that could not fail, one never taken

`18-VERIFICATION.md` scored 7/9 with two gaps. **Neither was a behaviour defect.** SCHED-06's
exec-stage refusal works and is measured; the browser tier's cap is settable, paced, and
composed over the visibility governor. What was wrong was the instrumentation: a reading that
could not fail, and a reading nobody took.

| gap | was | is |
|---|---|---|
| **G-1** criterion 2b | an assertion structurally confined to `{0,1}` | a shard-level reading measured to invert under a planted re-pick |
| **G-2** criterion 3 | the browser half argued from shared construction | a peer's `{kind:'offer'}` reading of a live tab, off the wire |

---

## The finding, stated plainly

**`agreeing.length <= redundancy = 1`, so the assertion that was removed could not have been
moved by any WIRE-04 implementation.**

`expect(shard.verification.agreeing).toHaveLength(1)` read `answered.map((r) => r.nodeId)`
(`job/verify.ts:158`), where `answered` is a subset of the executors `submitJob` selected —
which is `placement.nodeIds`, whose length **is** `redundancy`. That fixture sets
`redundancy: 1`. So the value was confined to `{0,1}`, and the `status === 'agreed'` narrowing
three lines above it excluded 0. The assertion was a tautology. It was not a weak guard or a
guard that had drifted; it was never capable of failing, and RULING A had accepted criterion 2b
as PARTIAL on the express condition that this clause *"turns red the day WIRE-04 lands"*.

Its companion was broken a second way. `expect(direct.ok).toBe(false)` is taken on a bare
`RemoteExecutor.execute()` **outside** `submitJob`, so a retry added inside
`submitJob`/`runResilient` could not reach it either. That probe is kept — it settles which
refusal a saturated node gives, which is worth having — but it is now labelled as what it is: a
check on the refusal's *identity*, not on the re-pick's absence.

This is why the plan's instruction to prove the replacement inverts was the whole job. A
replacement assertion nobody watched fail would have been the same defect in a new costume.

---

## Task 1 — an absence that can fail

The reading is now taken on a shard whose **selected** executor refuses at exec:

```ts
expect(stalledShard.verification.status).toBe('insufficient')
expect(stalledShard.verification.failures.map((f) => f.nodeId)).toStrictEqual([victim])
expect(stalledShard.verification.failures.some((f) => f.reason.includes('over-committed'))).toBe(true)
```

The arrangement: an `admit` wrapper forwards the real `rpcAdmission` offer, and the first node
to accept is then saturated by a held `MODULE_NEVER_RETURNS` dispatch before the wrapper
returns. Placement therefore chooses a node that was free when it answered and full when the
dispatch arrived. **That race is not contrived** — `LocalCapacity.would` answers an offer
without reserving anything (its doc gives the leak that forced the split), so an accepted offer
is a statement about the past by the time the exec lands. It is exactly what the two clauses of
criterion 2b describe.

Three details are load-bearing:

- **The refusal is read through `verification.failures`, not `rejections`.** `submit.ts:341`
  fills `rejections` from `planWithOffers`' placement-stage refusals only, so an exec-stage
  refusal is *structurally* invisible there. The file now says so, and asserts the corollary:
  the victim appears in no placement rejection, because it accepted.
- **The shard carries its own input value.** A node's slot key is `inputCid:partitionIndex`
  (`agent.ts:757`). Reusing `SHARD_VALUE` would have collided with the held task's key and met
  the DEDUPE branch — `… is already in flight here` — which is a different claim from the
  over-committed one. `EXEC_STAGE_VALUE` exists for that reason and is seeded onto the holders
  so a re-pick, once one exists, can actually run.
- **The reading is not vacuous in the other direction.** A shard never placed on the saturated
  node would also be `insufficient`. Naming the node in the failure is what separates the two.

---

## Task 2 — a peer reads a live tab's slot count

A **second** Node-tier `FabricNode` — deliberately not the relay, so it holds no reservation for
the tab — listens on `/ip4/127.0.0.1/tcp/0/ws`. The tab dials it, and the Node side sends
`{kind:'offer'}` to the tab's peer id, reading `capacity` before and after one `setDutyCycle`:

| reading | vantage | before | after |
|---|---|---|---|
| `capacity.slots` | **the peer, off the wire** | **8** | **2** |
| `window.o2.capacity()` | the page | `{dutyCycle: 1, slots: 8}` | `{dutyCycle: 0.25, slots: 2}` |

The in-page line is stated last and deliberately: it is corroboration, not evidence. A reading
taken in the page proves the setter ran, which 18-09 already proved.

**Both values are asserted, not only the capped one** — a case checking only `slots: 2` would
pass against a tab that had been capped since it started.

**Direct WebSocket, asserted rather than argued.** The case reads `connectionsTo(peer.peerId)`
and requires every connection to be unlimited and free of a `/p2p-circuit` hop. `limited` is
libp2p's own mark for a relayed circuit, so this is the transport's answer to "is this a
circuit", not the test's. `.planning/PROJECT.md` fixes a relayed circuit as a signalling channel
— 2 minutes, 128 KiB — that may not carry a job.

The header's "What it does not measure" section is gone. Its claim that *"no test in this
repository does that yet"* was false by the time it was read: `browser-capability.e2e.test.ts`
had already broken exactly this ground. The replacement says what is now measured, keeps the
note about the `hidden` signal being simulated, and records what the old argument-from-shared-
construction was worth — which `M37` measures.

---

## The planted mutations, what they read, and that they were restored

Both were applied by script so the ledger's `find`/`replace` are verbatim what ran, and both
were restored with `cp` + `cmp` — never `git checkout --`, this being a shared working tree.

### M36 — a WIRE-04-shaped re-pick in `submitJob`

| | |
|---|---|
| **File** | `packages/core/src/job/submit.ts` |
| **Planted** | `const verification = await executeVerified(task, selectedExecutors)` → `let`, plus a loop dispatching to each executor the placement did **not** choose, taking the first `agreed` |
| **Observed RED** | `VITEST_EXIT=1` — `AssertionError: expected 'agreed' to be 'insufficient'`, on `discovery-agents.node.test.ts` |
| **Restored** | `cp /tmp/submit.ts.orig …` then `cmp` → **exit 0**; `git diff --stat` on the file empty |
| **Green after restore** | `VITEST_EXIT=0`, 2 passed, 23.36 s |

With the retry planted the shard reaches a free second executor and stops being `insufficient`.
That is the inversion RULING A asked for, and it is now a measurement rather than a claim.

### M37 — a browser-tier slot count that does not follow the cap

| | |
|---|---|
| **File** | `packages/browser/src/browser-node.ts` |
| **Planted** | `capacity: admission,` → a **second** `LocalCapacity` built without the governor, handed to `serveAgent` |
| **Observed RED** | `VITEST_EXIT=1` — `AssertionError: expected { slots: 8, inFlight: +0 } to deeply equal { slots: 2, inFlight: +0 }` |
| **The divergence** | **1 failed \| 5 passed.** The failure is the peer's reading; **all five in-page assertions stayed green** |
| **Restored** | `cp /tmp/browser-node.ts.orig …` then `cmp` → **exit 0**; `git diff --stat` on the file empty |
| **Green after restore** | `VITEST_EXIT=0`, 6 passed, 4.90 s |

That 1-vs-5 split is the entire content of gap G-2. The defect is a *divergence*, not a
breakage: the page keeps reporting `slots: 2` from `node.admission` while the tab advertises 8
to every peer that asks, taking on four times the work its user capped it to. Nothing already in
the repository could see it, because nothing asked the tab from outside.

### Both entries run for real as ledger data

```
npm run test:mutations -- --only=M36,M37
  M36  packages/core/src/job/submit.ts      … caught (7.3s)   exit 1 with the recorded signature
  M37  packages/browser/src/browser-node.ts … caught (3.2s)   exit 1 with the recorded signature
```

The script restores the tree itself; `cmp` against both backups afterwards returned 0.

---

## Deviations from Plan

**1. [Rule 3 — blocking] `mutation-guard.node.test.ts` edited, outside the plan's declared files**

- **Found during:** Task 3.
- **Issue:** the guard pins the set of `rendered-at-runtime` entries by name — *"moving an entry
  into the unchecked arm is an edit somebody has to justify here"* — so adding M36/M37 failed it
  with `expected [ …(12) ] to deeply equal [ …(10) ]`.
- **Fix:** added both ids to the named list with the justification the case asks for. A
  test-title signature was the available alternative and is the **weaker** key here: each
  catching file has one `it` carrying dozens of assertions — `discovery-agents.node.test.ts` has
  40 — so a title would accept a red produced by any of them, including one produced by load, on
  a host that demonstrably produces those. The assertion strings pin the exact inversion.
  Neither string exists in any source file, so `test-title` would also have been a false
  declaration — the guard rejects that mistake in the opposite direction one case earlier.
- **Files modified:** `packages/node/src/mutation-guard.node.test.ts`
- **Commit:** `f29a8a8`

**2. [Rule 3 — blocking] the plan's Task 3 verify command matches no test files**

- **Issue:** `npx vitest run --project node mutation-ledger` exits 1 with `No test files found`.
  `mutation-ledger.ts` is data; the guard is `mutation-guard.node.test.ts`.
- **Fix:** ran `--project node mutation-guard` instead → 72 passed. Worth recording because the
  failure presents as a red exit code that has nothing to do with the ledger, which is the exact
  trap the executor brief warns about.

**3. [scope] `EXEC_STAGE_VALUE` seeded in `standUp`, which criterion 1's test shares**

- Seeding a second block cannot change criterion 1's counts: every reading there asks who holds
  `SHARD_VALUE`'s CID, and holding an unrelated block makes a node no more and no less a
  provider of the first. Asserted by the run — criterion 1's test is unchanged and green.

---

## Test Results

| command | result |
|---|---|
| `npx tsc --noEmit` | **exit 0** |
| `npx vitest run --project e2e` (full project) | **exit 0** — 10 files, 50 tests |
| `npx vitest run --project node` (full project) | 128 files, **127 passed**; 1 failed — `tools/aot/lift.node.test.ts` only |
| `npx vitest run --project node discovery-agents.node.test.ts` | exit 0 — 2 passed |
| `npx vitest run --project e2e duty-cycle-tab.e2e.test.ts` | exit 0 — 6 passed (was 5) |
| `npx vitest run --project node mutation-guard` | exit 0 — 72 passed |
| `npm run test:mutations -- --only=M36,M37` | both **caught** |

Every exit code was captured on the line immediately after its command, never through a pipe.

**`tools/aot/lift.node.test.ts` is pre-existing, unrelated, and its recorded diagnosis has
changed** — see the new section in `deferred-items.md`. Re-run **alone** on a quiet host
(load 4.39, `docker info` succeeding) it failed **worse** than in the full suite: 12 failed
alone versus 7 in the suite, 10 of them `Error: Test timed out in 60000ms`. The "passes in
isolation" half of 18-01's reading no longer holds. It cannot be this plan's doing: that file
imports only node builtins, vitest and `./lift.ts`; nothing under `tools/` references anything
18-12 touched; and `git diff HEAD~3 HEAD` names four files, all of them tests or ledger data.
Logged, not fixed — nothing in this phase is reachable from `tools/aot`.

---

## What this plan did NOT do

- **WIRE-04.** The re-pick behaviour remains Phase 20 criterion 1's. This plan makes its absence
  measurable; it does not add the retry. When WIRE-04 lands, `M36` is the entry to delete — not
  the assertion, which by then has a behaviour to describe.
- **Any production change.** `submit.ts` and `browser-node.ts` were mutated and restored;
  `git diff HEAD~3 HEAD` names no production file.
- **Criterion text.** RULING A is explicit that a criterion is not rewritten to let a phase
  close, and none was touched.

## Re-verification against `18-VERIFICATION.md`

| criterion | was | now | why |
|---|---|---|---|
| **2b** | FAILED | **PARTIAL** | the re-pick is still absent — correctly, it is WIRE-04's — but the absence is now held by a reading measured to invert |
| **3** | PARTIAL | **MET** | a peer reads the tab's advertised slot count across a runtime cap change, off the wire, on a direct WebSocket |

## Two things a later plan should pick up

1. **`browser-node.ts:1158-1168` is now partly stale.** It says the browser admission hook is
   *"unmeasured on this factory"* because *"nothing drives a refusal through this hook, so the
   number this node would answer an over-committed requestor with has never been read."* The
   sentence stays **literally true** — this plan drives no *refusal* through the hook — but the
   capacity figure it publishes is now read off the wire. A comment correction belongs to 18-13,
   which owns stale documents; it was deliberately not made here because this plan changes no
   production file.
2. **`M2b`'s `caughtBy` is probably now stronger than it claims.** Its entry records that the
   only instrument seeing it is a structural count, and that *"closing this is a matter of
   writing the case"*. The new `offerToTab` helper throws a named error when a tab answers an
   offer while stating no capacity at all — which is precisely what `capacity:
   'accepts-every-offer'` produces. **This was not measured**, so nothing was added to that
   entry: an unmeasured `caughtBy` is the substitution the ledger exists to prevent. One plant
   and one run would settle it.

## Self-Check: PASSED

- `packages/node/src/discovery-agents.node.test.ts` — FOUND
- `packages/node/src/duty-cycle-tab.e2e.test.ts` — FOUND
- `packages/node/src/mutation-ledger.ts` — FOUND
- `packages/node/src/mutation-guard.node.test.ts` — FOUND
- `.planning/phases/phase-18-discovery-capacity-placement/18-12-SUMMARY.md` — FOUND
- commit `b9f700a` (Task 1) — FOUND
- commit `3a74371` (Task 2) — FOUND
- commit `f29a8a8` (Task 3) — FOUND
- `packages/core/src/job/submit.ts` unchanged vs base — VERIFIED (`cmp` exit 0)
- `packages/browser/src/browser-node.ts` unchanged vs base — VERIFIED (`cmp` exit 0)
