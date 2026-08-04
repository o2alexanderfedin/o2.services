---
phase: phase-19-quorum-composition-owner-domain-attestation
plan: 19
subsystem: testing
tags: [quorum, anti-affinity, circuit-relay, libp2p, mutation-testing, cli]

requires:
  - phase: phase-19 plan 08
    provides: "the three spawned fabrics, and the honest declaration that fabric B's rule-2 claim was carried by an in-process fixture"
  - phase: phase-19 plan 12
    provides: "mutation ledger entry M40, which recorded that in-process reading"
provides:
  - "`bin/agent.ts` can produce a node that binds no listening address, so a spawned agent enrols `via-relay` with its relay named in the certificate a provider process signed"
  - "quorum rule 2 measured across four real operating-system processes — deleting it from `composeQuorum` reddens a fabric built from `bin/agent.ts`"
  - "`M40` re-measured at the process tier, with the observed text"
  - "four comments that had outrun the tree corrected against it"
affects: [phase-20, phase-23, verification of phase 19 criterion 1]

tech-stack:
  added: []
  patterns:
    - "a spawned agent's binding is a flag, not a class — `--port` absent + `--relay-addr` present is the browser topology in a process a test can spawn"
    - "a fixture precondition READ off a child's handshake line rather than polled, because `bin/agent.ts` settles the relay question before it announces"

key-files:
  created: []
  modified:
    - packages/node/src/bin/agent.ts
    - packages/node/src/quorum-agents.node.test.ts
    - packages/node/src/mutation-ledger.ts
    - packages/node/src/reservation-exhaustion.node.test.ts
    - packages/node/src/discovery-agents.node.test.ts
    - packages/node/src/static-rendezvous.e2e.test.ts
    - packages/core/src/job/submit.ts
    - .planning/REQUIREMENTS.md

key-decisions:
  - "`--port` lost `default: '0'` rather than gaining a `--no-listen` sibling: the distinction between *not passed* and *passed as 0* is the only thing that makes a conditional listen list expressible, and a second flag would have been a second way to say one thing"
  - "the conditional keys on `--port` being ABSENT, not on `--relay-addr` being present — the latter is a node-kind decision wearing a flag's clothes, and the regression control was watched catching exactly that mistake"
  - "the three pre-existing `--relay-addr` spawn sites state `--port 0` out loud rather than relying on a default that no longer exists"
  - "the flag fold stayed DECLINED — 19-07 discharged it with three checkable reasons and this plan did not reopen it"
  - "VER-03 and VER-04 are NOT ticked; the plan's frontmatter names them but neither is fully met"

patterns-established:
  - "Which case carries which claim is stated in the file's own header table, and updated when the answer changes — this phase's habit, continued"
  - "A regression control is planted against the plausible WRONG implementation, not only against the absent one"

requirements-completed: []

duration: 20min
completed: 2026-08-04
---

# Phase 19 Plan 19: The Relay Clause Gets a Reading That Can Fail — Summary

**`bin/agent.ts` can now produce a node that binds nothing, so quorum rule 2 is measured across four real processes instead of one heap — and deleting the rule was watched reddening that fabric.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-08-04T03:56Z
- **Completed:** 2026-08-04T04:16Z
- **Tasks:** 3 of 3
- **Files modified:** 8

## The one outcome that mattered

The plan named a single deliverable: *deleting rule 2 from `composeQuorum` must redden a fabric built from REAL SPAWNED PROCESSES.* It does.

```
FAIL |node| packages/node/src/quorum-agents.node.test.ts > criterion 1 engineered —
     one relay: caught by rule 2 and named by its relay > refuses for the shared relay
     and not for the operators, degrades under the default dial, and names the relay in
     the composer's words

AssertionError: expected 'composed' to be 'not-composed' // Object.is equality
  Expected: "not-composed"
  Received: "composed"
  ❯ packages/node/src/quorum-agents.node.test.ts:1064:34

Test Files  1 failed (1)
     Tests  1 failed | 3 passed (4)
```

Fabric B's executors in that run are three spawned `bin/agent.ts` processes plus a spawned provider — four separate operating-system processes, none of which shares a heap, an event loop or a module registry with the requestor. Before this plan the identical plant reddened only in-process `FabricNode`s (19-08 recorded *1 failed, 2 passed*), which is what `19-VERIFICATION.md` scored criterion 1 **PARTIAL** for.

Restored by `cp` + `cmp` (exit 0), never `git checkout --`.

## What was wrong, and what fixed it

`bin/agent.ts:91` declared `port: { type: 'string', default: '0' }` and `:685` passed `listen: ['/ip4/127.0.0.1/tcp/${port}']` unconditionally. `values.port` was therefore `'0'` whether an operator typed `--port 0` or typed nothing, **no argv could empty that array**, `canRelay` (`fabric-node.ts:1083`) was always true, and `:627-628` signed `discoverability: 'seed'` with `relayIds: []` for every process this binary has ever started. The relay assertion at the three-operator fabric could not fail at the type level.

The fix is the removal of one default and one conditional:

```ts
const listen =
  values.port !== undefined
    ? [`/ip4/127.0.0.1/tcp/${values.port}`]
    : relayAddrs.length === 0
      ? ['/ip4/127.0.0.1/tcp/0']
      : []
```

The middle row is the old default restated where it can be seen beside the case it used to exclude — which is why dropping it changed no existing invocation.

## Task Commits

1. **Task 1 (RED): a spawned agent that binds nothing** — `a2c0734` (test)
2. **Task 1 (GREEN): the binary can make one** — `203e2c3` (feat)
3. **Task 2: fabric B across real processes, and a plant that reddens it** — `499a668` (test)
4. **Task 3: four comments that have become false** — `febd107` (docs)

## Proofs — every one planted, watched, restored

| # | Claim | Plant | Observed | Restored |
|---|---|---|---|---|
| P1 | the binary can produce a via-relay node | `port: { type: 'string', default: '0' }` restored | `expected 'seed' to be 'via-relay'` | `cp` + `cmp` exit 0 |
| P2 | **rule 2 reddens a spawned fabric** | `if (requireIndependentPaths) {` → `if (false as boolean) {` | `expected 'composed' to be 'not-composed'`, 1 failed / 3 passed | `cp` + `cmp` exit 0 |
| P3 | the `--port 0` regression control can fail | listen keyed on `relayAddrs` alone instead of on `--port` | `expected 'via-relay' to be 'seed'` at `:804` | `cp` + `cmp` exit 0 |

**P3 is the one this plan added on its own initiative, and it is the one worth reading.** The plan asked only that the `--port 0` arm be *asserted rather than assumed*. Asserting it is not the same as knowing it can fail, so the plausible wrong implementation was planted — a listen list keyed on `--relay-addr` being *present*, which is a node-kind decision wearing a flag's clothes and is precisely what `STATE.md`'s cardinal rule forbids. The control caught it. Without P3 this summary would have been claiming a regression guard whose falsifiability was untested, which is the exact shape fourteen executors before this one have reported.

## Test evidence — exit codes read directly, no pipes

| Command | Exit | Result |
|---|---|---|
| `npx tsc --noEmit` | **0** | no output (run after each task) |
| `npx vitest run --project node` | **0** | 138 files, 1937 passed / 2 skipped, 233.34 s |
| `npx vitest run --project node quorum-agents` | **0** | 4 passed, 9.40 s |
| `npx vitest run --project node discovery-agents certificate-verification reservation-exhaustion` | **0** | 3 files, 5 passed, 18.36 s |
| `npx vitest run --project node quorum-agents mutation-guard discovery-agents` | **0** | 3 files, 103 passed, 18.20 s |
| `npx vitest run --project node requirements-ledger` | **0** | 16 passed, 215 ms |
| `npx vitest run --project e2e static-rendezvous` | **0** | 5 passed, 9.04 s |

Comparative reading, against `19-VERIFICATION.md`'s baseline on this same host: **138 files then, 138 now; 1936 passed then, 1937 now** — the one added test is this plan's precondition case; **236.80 s then, 233.34 s now**, so no file grew materially. Process figures for the full run: `real 234.08 / user 222.48 / sys 32.75`, giving `(user+sys)/real = 1.09`. That ratio is a comparability key rather than a verdict — this suite spawns hundreds of child processes and legitimately waits on them.

No run used `--no-verify`, and `O2_SKIP_GUARDS=1` was never set. The pre-commit guards ran and passed on all four commits (6 files, 181 tests each time).

## Every existing spawn site — asserted, not assumed

The only invocations whose behaviour could change are those passing `--relay-addr` and no `--port`. Measured by grep across `packages/` and `tools/`:

```
packages/node/src/reservation-exhaustion.node.test.ts:217   startAgent('a', ['--relay-addr', relayAddr])
packages/node/src/reservation-exhaustion.node.test.ts:227   startAgent('b', ['--relay-addr', relayAddr])
packages/node/src/reservation-exhaustion.node.test.ts:248   startAgent('c', ['--relay-addr', '/ip4/127.0.0.1/tcp/1/ws'])
```

Three, all in one file, all through one helper. Every other spawn site of this binary passes no `--relay-addr`, so it reaches the unchanged middle row of the listen table. `--port 0` is now stated inside that helper — see the deviation below for why this was not left to chance.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `reservation-exhaustion.node.test.ts` would have silently stopped measuring what it claims**

- **Found during:** Task 1
- **Issue:** Its three `startAgent` calls pass `--relay-addr` with no `--port`. Under the new conditional those agents bind **nothing**, and cases B and C assert in as many words that a node refused by a full relay, and a node whose relay is not there, *"started anyway"* and is *"still serving directly"*. A node that binds nothing serves nobody. Both sentences would have become false while both assertions stayed green — the plan's own instruction is that every existing spawn site keeps its current behaviour.
- **Fix:** `'--port', '0'` added inside the `startAgent` helper (one place, three call sites), with a docblock recording that the binding is now stated rather than defaulted and why this file specifically needs it.
- **Files modified:** `packages/node/src/reservation-exhaustion.node.test.ts`
- **Commit:** `203e2c3`

**2. [Rule 1 - Bug] `discovery-agents.node.test.ts` asserted the limit this plan removed**

- **Found during:** Task 2
- **Issue:** Its header stated that relay use is read over in-process `FabricNode`s *"because `bin/agent.ts` binds a port unconditionally and so can never produce a `via-relay` node."* False the moment Task 1 landed. This repository treats a false comment as serious — one has governed a decision twice in this phase already.
- **Fix:** rewritten to say what is true and when it stopped being false, keeping the old sentence's content as history rather than deleting it.
- **Files modified:** `packages/node/src/discovery-agents.node.test.ts`
- **Commit:** `499a668`

**3. [Rule 1 - Bug] `static-rendezvous.e2e.test.ts` carried W2's drifted citations**

- **Found during:** Task 3
- **Issue:** Its header cites `browser-node.ts:1178` / `fabric-node.ts:1578` for the `index` hook and `fabric-node.ts:1601` for `reservations` — the same drift W2 reports in `ROADMAP.md`, in a `packages/` file W2 does not name. Measured against the tree: `browser-node.ts:1337`, `fabric-node.ts:1672`, `fabric-node.ts:1695`.
- **Fix:** the three numbers corrected, plus a paragraph making W3's distinction explicit in the file itself — this spec **wires** the `index` hook and does not **read** it, and `tab-refusals.e2e.test.ts:371,377` is where that clause is measured off a live tab.
- **Files modified:** `packages/node/src/static-rendezvous.e2e.test.ts`
- **Commit:** `febd107`

**4. [Rule 1 - Bug] the module docblock's handshake example omitted `relays`**

- **Found during:** Task 1
- **Issue:** `bin/agent.ts`'s worked example listed every field the binary prints except `relays`, which `--relay-addr` added. The same file's rule is that a stated absence and an absent field are different things.
- **Fix:** `"relays": []` added to the example, plus one sentence on what a node binding nothing reports there.
- **Files modified:** `packages/node/src/bin/agent.ts`
- **Commit:** `203e2c3`

### Scope extension, declared

W2's four drifted citations live in `ROADMAP.md` (out of scope by the plan) and `REQUIREMENTS.md` (not). The `REQUIREMENTS.md` half was corrected in `febd107`; the `ROADMAP.md` half is reported below. `REQUIREMENTS.md` was treated as in-jurisdiction because the executor workflow writes to it directly via `requirements mark-complete`; `requirements-ledger.node.test.ts` was run after the edit and is green.

### Traps honoured

- The `watcher?.onFailure(...)` subscription was **not moved**. It stays above `FabricNode.start` where `919f8e0` put it, and the ~20 % lost-wakeup comment is untouched — the `listen` const was inserted *below* it.
- The flag fold stays **declined**. `--port` was documented at its own key, in the plain way, and 19-07's three reasons were not reopened.
- The job still travels a **direct** connection. Fabric B's agents dial the requestor via `--peer-addr`; only the certificate's `relayIds` comes off the relay. The fixture now says this out loud, names deferred item 3, and tells the next reader not to route the job over the circuit.
- **Not a node kind** is stated at `--port`, at `--relay-addr`, at the `listen` expression, and in the new test's docblock — four places, because this is the mistake the phase already retracted a rule for.
- `ROADMAP.md` and `STATE.md` were not edited. `git status` confirms.

## FOR THE ORCHESTRATOR — ROADMAP.md corrections needed

This plan may not edit `ROADMAP.md`. Four corrections are owed there, all verified against the tree at HEAD `febd107`:

**1. W3 — `ROADMAP.md:715-716` overstates what `static-rendezvous.e2e.test.ts` measures.**

Current text:

> `MEASURED, not argued from construction: packages/node/src/static-rendezvous.e2e.test.ts takes both readings on the built bundle with no origin to ask and no harness dial.`

`takes both readings` is false. Verified by grep: that file contains no `records` or `providers` request anywhere. Discovery is `findReservedPeers` alone (`demo/main.ts:149-201`), `computePeers` sends an `offer` (`main.ts:743`), and the tabs are unenrolled so `peerCertificate` returns at `main.ts:268` before asking. Suggested replacement:

> `MEASURED, not argued from construction: packages/node/src/static-rendezvous.e2e.test.ts takes the reservations reading on the built bundle with no origin to ask and no harness dial, and tab-refusals.e2e.test.ts:371,377 takes the index reading off a live tab over the wire.`

**The clause still holds and criterion 4 remains MET** — `tab-refusals.e2e.test.ts:371,377` asks a live tab for `providers` and gets `[]` for the withheld sovereign row and exactly one key, derived back to the tab's own peer id, for the public one. Only the sentence naming which file takes which reading is wrong. The same correction has already been applied inside `static-rendezvous.e2e.test.ts` itself, in `febd107`.

**2. W2 — `ROADMAP.md:693-698` cites four line numbers that have drifted.** Measured at HEAD:

| Cited | Actual |
|---|---|
| `browser-node.ts:1178` (`index`) | `browser-node.ts:1337` |
| `fabric-node.ts:1578` (`index`) | `fabric-node.ts:1672` |
| `fabric-node.ts:1601` (`reservations`) | `fabric-node.ts:1695` |
| `browser-node.ts:1201` (`'relays-for-nobody'`) | `browser-node.ts:1388` |

The wiring exists exactly as described; only the citations are stale. `REQUIREMENTS.md`'s copy of the same pair was corrected in `febd107`.

**3. W4 — `ROADMAP.md:643` omits `AUTH-04` from Phase 19's Requirements line.** Criterion 5 is entirely AUTH-04's cost clause. Bookkeeping only; already filed as `deferred-items.md` item 8.

**4. Criterion 1's PARTIAL is now closable on its relay clause.** The gap `19-VERIFICATION.md` named — *"the relay half has NO across-process reading"* — is closed and pinned by `M40`. This does not by itself flip the criterion; a re-verification should read `quorum-agents.node.test.ts:996-1111` and `M40` and score it. **Criterion 5 (G2) is untouched and remains PARTIAL** — it needs an owner ruling or a per-identity cost, and both were explicitly out of this plan's scope.

## Requirements — deliberately NOT ticked

The plan's frontmatter names `requirements: [VER-03, VER-04]`. **Neither was marked complete, and that is a decision rather than an omission.**

- **VER-03** — its eclipse-resistance half now has the across-process reading it lacked, which is real progress. But its **durability half remains deliberately unimplemented**, scoped and argued at `quorum.ts:44-65`: a certificate carries no field saying whether a node pins durably, and this repository has already ruled against a precondition that reads a claim. VER-03 stays **Partial**.
- **VER-04** — untouched by this plan. Its gap is that the gate is reached by no *measured* runnable entry point (`bin/bench.ts` prints no quorum verdict). Nothing here changed that.

*Descoped is not satisfied; unmeasured is not met.* Ticking either would have closed a gap by widening what counts as passing.

## Known Stubs

None. No hardcoded empty value, placeholder string, or unwired component was introduced.

## Threat Flags

None. This plan adds no network endpoint, no auth path and no schema change. `--port` widens the binary's argv surface by removing a default, and the resulting node is strictly *less* reachable (it binds no socket), so the change removes listening surface rather than adding it.

## Self-Check: PASSED

Files claimed, verified present:

- `packages/node/src/bin/agent.ts` — FOUND
- `packages/node/src/quorum-agents.node.test.ts` — FOUND
- `packages/node/src/mutation-ledger.ts` — FOUND
- `packages/node/src/reservation-exhaustion.node.test.ts` — FOUND
- `packages/node/src/discovery-agents.node.test.ts` — FOUND
- `packages/node/src/static-rendezvous.e2e.test.ts` — FOUND
- `packages/core/src/job/submit.ts` — FOUND
- `.planning/REQUIREMENTS.md` — FOUND

Commits claimed, verified in `git log`: `a2c0734`, `203e2c3`, `499a668`, `febd107` — all FOUND.

`git status` clean at the time of writing; `git diff --stat HEAD` empty after every plant was restored.
