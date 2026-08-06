---
phase: phase-24-certificate-gated-admission
plan: 02
subsystem: admission
tags: [AUTH-02, BENCH-03, relay, benchmark, demo]
requires:
  - RelayAdmission as a required named union on FabricNodeOptions (24-01)
provides:
  - four rig sites stating an admission posture with the reason at their own call site
  - the measured fact that no bench rig ever requests a reservation, pinned as source text
  - a pre-gate baseline of three host-independent counts, with a paired arm inside one run
  - the demo and tab-api sentences a person meets, and the first source-text guard over them
affects:
  - packages/node/src/bin/bench.ts
  - packages/node/src/bench-fabric.ts
  - packages/node/src/relay-admission.node.test.ts
  - packages/node/src/bench-admission.node.test.ts
  - packages/browser/demo/main.ts
  - packages/browser/src/tab-api.ts
tech-stack:
  added: []
  patterns: [count-pin-guard, paired-arm-in-one-run, flowed-prose-pin, strip-before-scan]
key-files:
  created:
    - packages/node/src/bench-admission.node.test.ts
  modified:
    - packages/node/src/bin/bench.ts
    - packages/node/src/bench-fabric.ts
    - packages/node/src/relay-admission.node.test.ts
    - packages/browser/demo/main.ts
    - packages/browser/src/tab-api.ts
decisions:
  - The rig count is four, not three — the plan's two prior audits both missed bench-fabric.ts
  - Every rig keeps 'admits-any-peer'; nothing this plan touched closes a door
  - The baseline is counts on a real relay fabric, not a rung of bin/bench.ts, because no bench rig requests a reservation at all
  - No MEASURED_NODE_SPANS entry — the file's span is below the cutoff and an unmeasured span is a guard telling a lie
metrics:
  duration: ~2h
  completed: 2026-08-06
---

# Phase 24 Plan 02: The rigs and the demo say what they are, before anything is armed — Summary

Four rig sites — not three — now state their admission posture with a distinct reason at
each call site; the pre-gate baseline is three host-independent counts with a paired arm
inside one run showing that a refusal at the reservation leaves the plain connection
standing; and the demo's first-class `'carries-no-certificate'` state has, for the first
time, a guard that reads its source.

**The criterion is numbered 8**, inherited from Phase 19 by the owner's ruling of
2026-08-04. Phase 24 has exactly one criterion, so a future verification scores it **out of
1, not out of 8** — the digit is a label, not a position.

## What landed

| Thing | Where | State |
|---|---|---|
| Three rig sentences, one per site | `bin/bench.ts` | provider / workers / requestor, each stating what its numbers do not claim |
| A fourth rig sentence | `bench-fabric.ts` | the process rig's in-process half; its other half is 24-03's |
| `RIG_SITES` count pin + the corrections that produced it | `relay-admission.node.test.ts` | 2 files, 4 sites, all open |
| `no rig asks any relay for a reservation` | `relay-admission.node.test.ts` | the reading that makes the three sentences true |
| Pre-gate baseline, two arms, one run | `bench-admission.node.test.ts` | 3 counts, no durations |
| The demo's sentence and the tab API's | `demo/main.ts`, `tab-api.ts` | comments only, pinned by a new guard |

Nothing refuses anybody. Every posture in the tree is still `'admits-any-peer'`, and
`relay-admission.node.test.ts`'s load-bearing row — `total - open === 0` — is still zero.

## Plan claims measured FALSE, and one measured TRUE

### 1. The rig count is FOUR. Both prior audits missed the same file.

The plan's 2026-08-05 amendment says **"THE RIG COUNT IS THREE, NOT FOUR — `grep -n
"relayAdmission" packages/node/src/bin/bench.ts` returns exactly three hits."** That
sentence is **true**, and I verified it. What is false is the inference drawn from it, that
`bin/bench.ts` holds every rig site.

`packages/node/src/bench-fabric.ts` holds a fourth: `startSubmitter` calls
`FabricNode.start({ relayAdmission: 'admits-any-peer', … })` and binds
`/ip4/127.0.0.1/tcp/0`, so it runs a relay service. It is BENCH-07's process-per-node rig —
the one whose figures the connectivity-tax comparison is built on.

**Why both audits missed it, measured from git rather than guessed:** 24-01 landed at
2026-08-04 20:56 and made the field required. `bench-fabric.ts` was created by Plan **23-02
at 2026-08-05 12:08** — after that, so it had to state a posture, and plausibly after the
audit that produced the amendment. `git log -S relayAdmission -- packages/node/src/bench-fabric.ts`
returns exactly that one commit.

So **the plan's original number was right and its file was wrong, and the amendment
corrected the file by lowering the number.** Both corrections are recorded in `RIG_SITES`'s
docblock rather than overwritten, because the arithmetic is the whole content of the list.

**I stated the posture there rather than stopping.** The plan's `must_haves.truths` opens
with *"Every rig and every demo surface states whether it holds a certificate, at its own
call site, with a reason"* — leaving the fourth unstated would have made my own plan's
first stated truth false at the moment it was declared done. The edit is a comment; the
value is unchanged; no door moved. It is a Rule 2 deviation and it is flagged here for
24-04 rather than buried.

The plan's explicit stop condition was different and **did not fire**: it said to stop if
`perf-workload.ts` turned out to build a relay-capable node. It does not. Verified: zero
postures, `FabricNode` present only inside one docblock sentence and never as a
constructor, and `reservations: 'relays-for-nobody'` at both of its two `serveAgent` calls.
All three are now pinned in `relay-admission.node.test.ts` rather than left as prose.

### 2. Nothing pins the demo's `'carries-no-certificate'` in source. Ten files read that file and none mentions it.

The plan's task 3 assumed a guard existed to extend: *"The wording of the demo's sentence is
checked by whatever guard already reads that string."* Measured — ten test files read
`packages/browser/demo/main.ts` as text (`serve-agent-hooks`, `trust-anchors`, `purity`,
`opt-in-only-sources`, `checkpoint-optout-scope`, `sovereign-block-refusal`,
`kernel-build`, and the three e2e specs) and **not one of them mentions the literal**.

The plan's own contingency governs — *"If no guard reads it, that is the finding: add one"* —
and one was added.

**The state was not unguarded, and the new block says so rather than overclaiming.**
`attestation-ui.e2e.test.ts` pins the *rendered consequence*: an unenrolled peer makes the
panel print `this requestor holds no certificate for it`, an enrolled one must not. That is
a stronger reading than a substring count and an expensive one — `vite build` plus
Playwright over the built bundle, in a project that sets `fileParallelism: false`. The two
are complements. Only the new one is cheap enough to run on every commit; I ran the
expensive one too (below).

### 3. TRUE, and stronger than the plan claimed: the published curves cannot move.

The plan reasoned that stating the posture protects the curves. The measurement is
sharper: **neither bench rig passes `relayAddrs` to any node.** A reservation is requested
by the *joining* peer, so a rig that hands out no relay address never reaches the
reservation protocol at all, whatever posture its relay-capable nodes state. Every relay
service either rig starts has an empty store for the whole of a run.

So arming the gate in 24-03 cannot move a committed figure — not because the posture is
open, but because **the reservation path is never exercised**. Pinned over stripped source
as `has no rig that asks any relay for a reservation, so no published curve can move`, and
planted to prove it can fail.

This is also why the baseline in task 2 is **not** a rung of `bin/bench.ts`: a rung would
have measured zero reservations, and a count that is structurally zero cannot move.

## The divergence with `24-01-SUMMARY.md`, recorded here as the plan required

`24-01-SUMMARY.md` carries the same wrong pairing in two sentences:

1. *"`bin/bench.ts` and `perf-workload.ts` build nodes in-process and spawn nothing"* —
   **the first half is true, the second is not.** `perf-workload.ts` builds no node at all;
   it composes `serveAgent` directly.
2. *"`bin/bench.ts` and `perf-workload.ts` are deliberately **absent from the count-pin
   guard**"* — **still true and still load-bearing**, and this plan is what took
   `bin/bench.ts` out of that absence. `perf-workload.ts` remains outside `RIG_SITES` and is
   instead pinned by a negative, so it is no longer merely absent.

**`24-01-SUMMARY.md` was not edited.** A summary records what an executor observed and
rewriting it destroys the audit trail. The correction lands in the live guard's docblock —
where a reader meets the measurement — and again here.

`relay-admission.node.test.ts`'s own `PRODUCTION_SITES` docblock inherited the same pairing
(*"whose posture Plan 24-02 decides and pins, alongside `perf-workload.ts`"*). That one **is**
a live guard rather than a landed summary, so it was corrected in place, with the retracted
sentence quoted beside the correction.

## The baseline — the reading 24-04 inherits

Four runs, counts byte-identical every time:

| Arm | `maxReservations` | connected | granted | advertised |
|---|---|---|---|---|
| `room-for-everyone` | 4 | **4** | **3** | **3** |
| `room-for-all-but-one` | 2 | **4** | **2** | **2** |

**Conditions.** 2026-08-06, Darwin 25.5.0, 8 logical cores. One relaying host on
`/ip4/127.0.0.1/tcp/0/ws`; three joiners in the browser's position (`listen: []` with a
relay address, so a reservation is the only thing that makes them reachable); one observer
that dials the host directly and is never handed a relay address. `maxReservations` is the
**only** difference between the arms. Every node states `'admits-any-peer'`; nothing
enrolled any of them.

**Why these three counts.** `advertised` is asked **over the wire** through
`findReservedPeers` — the production rendezvous path a browser tab uses — rather than read
off the host's getter a second time, so it measures 24-CONTEXT's claim that *"both
advertisement surfaces are derived from `reservedPeerIds`"* rather than restating it.

**The load-bearing reading is the first column against the other two.** `connected` is
identical across both arms while `granted` and `advertised` move together. So **a refusal at
the reservation leaves the plain connection standing**, and the three counts are genuinely
independent rather than three names for one number. That independence is the premise
sub-decision 1 rests on: enrolment rides a plain connection, and
`denyInboundRelayReservation` fires on the reservation and on nothing else. The observer
occupies exactly the position 24-04 must measure — connected and unreserved at the same
moment — and it occupies it **today, before any gate exists**.

**Capacity is not admission**, and the file says so in those words. The capped arm refuses
on `maxReservations` because that is the only refusal this tree has. It demonstrates that
the counts *can* separate. It demonstrates nothing whatever about a certificate.

**Inertness, taken as given from 24-01 and cited rather than re-derived:** plant 4 of that
plan set `relayAdmission: new Set<never>()` and ran the whole node project — 2073 passed
against 2074 clean, the single delta being its own census row, with `relaying.node.test.ts`
green. So this baseline was taken on a fabric where stating a posture changes nothing.

## Plants — every one counted before it was applied, watched, and restored by `cp` + `cmp`

| # | Plant | Instrument | Observed |
|---|---|---|---|
| 1 | one of `bin/bench.ts`'s three postures → a pinned set | `relay-admission` | **exit 1**, 2 rows: `packages/node/src/bin/bench.ts states a rig posture, and it is open` — `expected 2 to be 3`; and `holds the door open at every site…` — `expected 1 to be +0` |
| 2 | the same at `bench-fabric.ts` | `relay-admission` | **exit 1**: `packages/node/src/bench-fabric.ts states a rig posture, and it is open` — `expected +0 to be 1` |
| 3 | `relayAddrs` planted as **code** at the requestor | `relay-admission` | **exit 1**: `has no rig that asks any relay for a reservation…` — `expected '…' not to contain 'relayAddrs'` |
| 4 | one joiner's relay address dropped | `bench-admission` | **exit 1** — see below, this one changed the file |
| 5 | the capped arm widened back to open | `bench-admission` | **exit 1**: `expected 3 to be 2`, evidence line printing `3/3/3` for both arms |
| 6 | an upper-bound assertion carrying its unit in a trailing block comment | `bench-admission` | **GREEN** — see below, this one was a defect in my guard |
| A | the demo's promise sentence reworded | `relay-admission` | **exit 1**: `says at the demo what the absence will mean once admission is gated` |
| B | one `'carries-no-certificate'` hoisted to a constant | `relay-admission` | **exit 1**: `keeps the demo's first-class absence as a value…` — `expected 6 to be 7` |
| C | `A gated node behaves differently here.` into `tab-api.ts` | `relay-admission` | **exit 1**: `grows no node kind on either surface`, naming `gated node` |
| D | the tab API's front-door sentence reworded | `relay-admission` | **exit 1**: `says at the tab API that a supplied relay address is the door admission is decided at` |

### Plant 3's first attempt refused to apply itself, and that was the rule working

Its needle carried six spaces of indent and matched **three** sites, not one, because the
six-space form is a substring of the eight- and ten-space forms. The script counted before
writing and threw. That is the standing rule — *count the plant's own effect before running
it* — and it exists because a `perl s///` without `/g` produced misleading greens three
times on 2026-08-05. Re-anchored on a unique line, it applied once and reddened.

### Plant 4 improved the file it was testing

First attempt reported only `timed out waiting for 3 reservations` at **30 198 ms against a
30 000 ms deadline**. A duration equal to a timeout is evidence of the timeout: it says the
fabric never reached the state and says **nothing about which count moved**, which is the
one thing the file exists to report. The readiness wait had swallowed the reading.

`until` therefore gained an `observed` thunk, on `reservation-exhaustion.node.test.ts`'s
idiom (*"both now name what arrived"*), and the re-plant reported
`timed out waiting for 3 reservations; the counts were {"connected":3,"granted":2}`.

**Recorded because that plant also removes the connection**, so it is the capped **arm**,
not this plant, that shows `connected` and `granted` separating. The plan's prescribed
plant cannot show that, and the file says so.

### Plant 6 found that my own guard could not fail — twice over

The no-timings guard matched *a number followed by a unit*. Planted with the form a
duration threshold actually takes — an upper-bound assertion whose unit sits in a trailing
block comment — it stayed **green**: the separator between number and unit was not
whitespace, so the two never met. **A proof that cannot fail is not a proof.**

Repaired to match the two things a timing assertion cannot avoid — a **clock**, and an
**upper bound**. `toBeGreaterThan` is deliberately not on that list: the anti-vacuity floor
beside it is one, and floors over counts are the idiom the whole file is written in.

The repaired guard then **fired on its own documentation**: the paragraph explaining the
plant quoted it verbatim, and a raw-text scan cannot tell a construction from a mention. So
the clean tree went red naming a comment. That is the identical hazard
`relay-admission.node.test.ts` records for its own matchers and `trust-anchors.node.test.ts`
for `OPT_OUT`, and it has the same established answer: **strip comments before scanning**,
and describe the plant in prose rather than writing it out. Both were done, and a paired
case (`is not satisfied by a comment`) now keeps the stripping honest. Re-planted after the
repair: exit 1, exactly one line named, the plant's.

Two hazards, met in sequence, on the first guard I wrote in this repository. Both are
already written down here; neither was avoided by reading them first.

## Deviations from plan

**1. [Rule 2 — missing critical coverage] `bench-fabric.ts` was stated and pinned.** Not in
`files_modified`. Reasoning above; comment only, no value changed, flagged for 24-04.

**2. [Rule 2] A source-text guard over the demo surfaces was created, not extended.** The
plan assumed one existed. It does not. Its own contingency instructed this.

**3. [Rule 1 — bug in my own work] The published benchmark artifacts were overwritten and
restored.** Proving *"the rig still runs"* I ran
`node packages/node/src/bin/bench.ts --quick` **from the repository root**. The driver
writes to `join(process.cwd(), '.planning', …)`, so it rewrote `.planning/BENCHMARK-RESULTS.md`
and `.planning/bench/raw.json`.

Caught within one command by an md5 taken **before** the run
(`18b1d3744179bb5327392adcc79cc01d`), and restored by writing the exact `HEAD` bytes of both
files with `git show HEAD:<path>` and `cmp`-ing — not by a blanket `git checkout --`, and
not to any path I had not myself dirtied: `git status` immediately before the run listed
only my three source files. md5 after restore is identical.

Re-run correctly from a temporary cwd, which is `coverage-agents.node.test.ts`'s own idiom
and is what I should have read first: exit 0, all five rungs (`memory/1,2,4`, `real/1,2`),
`real 4.95 user 4.05 sys 0.73`, `(user+sys)/real` **0.97**, and the repository's published
report byte-identical across the run.

**4. `vitest.config.ts` was not touched.** `bench-admission.node.test.ts` has **no**
`MEASURED_NODE_SPANS` entry and that is a statement, not an omission — see the metrics
section.

## What this plan did NOT do, and must not be read as having done

- **Nothing refuses anybody.** `total - open` is still `0`. No `connectionGater`, no change
  to `circuitRelayServer`'s arguments, no `admitsAnyPeer` caller.
- **`bin/agent.ts` is untouched.** It is a rig's other half — the process rig's children are
  that binary — and 24-03 task 2A owns giving it a way to state a closed posture. Said at
  `bench-fabric.ts`'s call site so a reader of that file does not adopt it.
- **`browser-node.ts` is untouched and defect #55 is not mine.** Assigned to 24-03 task 3
  case 2 by the 2026-08-06 amendment.
- **`packages/bench/src/perf-workload.ts` is untouched.** Out of scope, and now pinned as a
  negative so the scope statement is checkable.
- **`24-01-SUMMARY.md` is untouched.**
- **`STATE.md`, `ROADMAP.md`, `REQUIREMENTS.md` are untouched** — see the ledger note below.

## Measurements, exit codes read directly

| Command | Exit | Result | Process reading |
|---|---|---|---|
| `npx tsc --noEmit` | **0** | zero output, three times | — |
| `npx vitest run --project node` | **0** | 161 files, 2282 passed, 2 skipped | `real 274.74 user 343.05 sys 51.43`, ratio **1.43** |
| `npx vitest run --project browser` | **0** | 249 files, 4092 tests | `real 50.11 user 95.88 sys 23.62`, ratio **2.38** (8 workers) |
| `npx vitest run --project e2e attestation-ui.e2e.test.ts` | **0** | 4 tests | `real 15.99 user 24.77 sys 2.27`, ratio **1.69** |
| `bin/bench.ts --quick`, temp cwd | **0** | all 5 rungs | `real 4.95 user 4.05 sys 0.73`, ratio **0.97** |
| `bench-admission.node.test.ts` ×4 | **0** | identical counts each time | `real 2.18 / 1.88 / 1.75 / 1.96`; ratios `1.00 / 1.12 / 1.14 / 1.09` |

**`slow-specs.node.test.ts` passed.** 24-01 recorded it red at drift 6 against a tolerance
of 5; `NODE_MEASUREMENT` was re-taken on 2026-08-05 at 157 files, and the node project now
holds **161** — drift **4**, one file of headroom left. Adding a second spec in this area
will trip it.

The e2e run's ratio of **1.69** sits beside that file's own recorded **1.70** from
2026-08-03, so the two readings are comparable rather than merely both green.

## Notes for the verifier — ledger changes this plan did not make

`STATE.md`, `ROADMAP.md` and `REQUIREMENTS.md` were **not** edited, on instruction. What
this plan would otherwise have recorded:

- **AUTH-02** advances but does **not** close. Every surface now *states* a posture with a
  reason; nothing *enforces* one. The requirement closes with 24-03/24-04.
- **BENCH-03** — the pre-gate baseline exists, is dated, carries its conditions, and has a
  demonstrated ability to move.
- Phase 24 progress: plans 1 and 2 of 4 complete.
- **A new item for 24-04, and it is the most important line here:** the phase's plan
  inventory has now been wrong about rig sites **three times** — the original count, the
  2026-08-05 amendment, and this correction. 24-04 should re-derive the site list from
  `git ls-files` rather than from any plan, exactly as `relay-admission.node.test.ts`'s
  census already does.

## Known stubs

None. Every sentence added is documentation beside a value that already existed, and every
value is unchanged.

## Self-Check: PASSED

- `packages/node/src/bench-admission.node.test.ts` — FOUND
- `packages/node/src/relay-admission.node.test.ts` — FOUND
- `packages/node/src/bin/bench.ts` — FOUND
- `packages/node/src/bench-fabric.ts` — FOUND
- `packages/browser/demo/main.ts` — FOUND
- `packages/browser/src/tab-api.ts` — FOUND
- `f5d9fe2` — FOUND (3 files, nothing foreign swept in)
- `7639014` — FOUND (1 file)
- `938068b` — FOUND (3 files)
- `.planning/BENCHMARK-RESULTS.md` md5 `18b1d3744179bb5327392adcc79cc01d` — unchanged from
  before this plan ran
