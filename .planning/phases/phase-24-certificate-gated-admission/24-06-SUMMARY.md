---
phase: phase-24-certificate-gated-admission
plan: 06
subsystem: admission
tags: [AUTH-02, AUTH-04, seed, gap-closure, measurement]
verdict: the seed has a knob, and the default did not move — both measured across real processes
requires: [05]
provides:
  - "SeedServerOptions.relayAdmission, required, by indexed access into FabricNodeOptions"
  - "bin/seed.ts --admit-issuer, repeatable, hex-validated in its own loop, two-armed banner"
  - "four guards repaired strictly stronger, none widened"
affects:
  - "24-07 may proceed — it can spawn a seed that is told to close"
  - "24-08 may proceed on the same ground"
tech-stack:
  added: []
  patterns:
    - "a census row that counts raw occurrences must state its declaration count separately, or `total` silently means two different things"
    - "a declaration guard split by SHAPE rather than raised by COUNT — defining + forwarding === declarations"
key-files:
  created: []
  modified:
    - packages/node/src/seed-server.ts
    - packages/node/src/bin/seed.ts
    - packages/libp2p/src/relay-admission.ts
    - packages/node/src/relay-admission.node.test.ts
    - packages/node/src/reservation-exhaustion.node.test.ts
    - packages/node/src/start-unwind.node.test.ts
    - packages/node/src/seed-discovery.e2e.test.ts
decisions:
  - "PRODUCTION_SITES' seed-server.ts row is total: 2, not the plan's predicted 1 — the row compares the RAW ANY_POSTURE count, which the census subtracts the declaration from. Counted on the edited tree, not predicted, exactly as the plan instructed."
  - "PostureSite gained a required `declares` field rather than absorbing the declaration into `total`. Strictly stronger: a declaration migrating into or out of a production file can no longer be hidden by the raw count."
  - "MEASURED_NODE_SPANS' 923 ms row for relay-admission.node.test.ts was NOT re-sited. It was already wrong by 12x before this plan (11 080 ms measured at baseline); re-siting cascades into unitFiles and would pull an admission guard out of `npm run test:unit`, which is a workflow decision this plan does not own and cannot make without observing a `test:unit` run. Reported as a finding instead."
metrics:
  duration: ~40 min
  completed: 2026-08-06
  commits: 0
---

# Phase 24 Plan 06: Give the Seed a Door — Summary

## THE RESULT

**An operator can now tell a seed which issuers it admits, from the command line, and a seed
told nothing is byte-identical to the seed before this plan existed. Both halves are measured
across real `bin/seed.ts` processes, in one run, with the posture read off the seed's own
banner rather than off the argv the fixture passed.**

The verifier's stated condition for changing criterion 8's disposition was that the open
posture become *"a deployment posture an operator can remove"*. It is one. What criterion 8
still turns on is a reading over a **fabric**, which is 24-07's, and no checkbox is moved here.

**24-07 and 24-08 may proceed.**

---

## The six `SeedServer.start` sites, re-derived rather than inherited

`grep -rn "SeedServer.start" packages/ tools/` returns nine lines; three are prose
(`trust-anchors.node.test.ts:518`, `fabric-node.ts:319`, `bin/seed.ts:98`). The six real
construction sites, each of which now states a posture:

| # | site | posture | why |
|---|---|---|---|
| 1 | `packages/node/src/bin/seed.ts:125` | ternary on `--admit-issuer` | the production entry point |
| 2 | `packages/node/src/seed-discovery.e2e.test.ts:43` | open | the closest thing in the repo to a picture of no-flag `bin/seed.ts`; the tab it drives holds no certificate |
| 3 | `packages/node/src/start-unwind.node.test.ts:244` | open | subject is a bound socket, not a door |
| 4 | `packages/node/src/start-unwind.node.test.ts:258` | open | failure path — never finishes starting, so the posture is never consulted |
| 5 | `packages/node/src/relay-admission.node.test.ts:638` | open | arm A of the `trustedIssuers` block |
| 6 | `packages/node/src/relay-admission.node.test.ts:648` | open | arm B — **both** arms open deliberately, so the divergence is attributable to one option |

The `<interfaces>` list was correct this time; it was verified rather than trusted, because the
phase's inventory has been wrong about site counts three times.

---

## The required-field property, measured in both directions

Not argued. Two `tsc --noEmit` readings against the same five omissions, `EXIT=$?` on the line
immediately after the command, no pipes and no trailing `tail`.

| declaration | omissions | exit | output |
|---|---|---|---|
| `readonly relayAdmission: FabricNodeOptions['relayAdmission']` | all five sites | **1** | five `TS2741` errors, **each naming its site by file and line** |
| `readonly relayAdmission?: …` + `?? 'admits-any-peer'` at the forward | the same five | **0** | **zero bytes** |

The RED half, verbatim:

```
packages/node/src/relay-admission.node.test.ts(638,43): error TS2741: Property 'relayAdmission' is missing in type '{ blockstoreDir: string; httpPort: number; wsPort: number; trustAnchors: "runs-unsigned-artifacts"; }' but required in type 'SeedServerOptions'.
packages/node/src/relay-admission.node.test.ts(648,45): error TS2741: …
packages/node/src/seed-discovery.e2e.test.ts(43,33): error TS2741: …
packages/node/src/start-unwind.node.test.ts(244,41): error TS2741: …
packages/node/src/start-unwind.node.test.ts(258,44): error TS2741: …
```

**The plant is two lines, not one, and that is disclosed rather than papered over.** Making the
declaration optional alone does not compile: `exactOptionalPropertyTypes` makes
`options.relayAdmission` a `RelayAdmission | undefined` that a required `FabricNodeOptions`
field will not take, so the plant would have failed for the wrong reason. The second line
`?? 'admits-any-peer'` is what completes the state the required form forbids — **an optional
field with a silent default**, which is precisely the shape `RelayAdmission`'s own docblock and
`PROJECT.md`'s Key Decision name as a hole. Restored with `cp`; `cmp` read 0.

---

## The declaration guard: SPLIT, not raised — and the plant that proves it

`relay-admission.node.test.ts` asserted `expect(REPO.declarations).toBe(1)`. A forwarded
`FabricNodeOptions['relayAdmission']` on `SeedServerOptions` takes that to 2. **Bumping the bar
to 2 would have closed a gap by widening what passes.** The count is split by *shape* instead:

- a **defining** declaration is the field followed by the union type name — exactly one, and it
  must be in `fabric-node.ts`;
- a **forwarding** declaration is the field followed by an indexed access into
  `FabricNodeOptions` — pinned to exactly `seed-server.ts`;
- **defining + forwarding === `REPO.declarations`**, so a third shape lands outside the sum.

### The measurement that makes this a repair rather than a relaxation

**Under plant P2 — a hand-written `ReadonlySet<PublicKeyHex> | 'admits-any-peer'` on
`SeedServerOptions` — the census reads `declarations: 2`, identical to the repaired tree.** So
`expect(REPO.declarations).toBe(2)`, the widening the plan forbade, would have been **GREEN on
exactly the state the old row existed to forbid**. The split is RED on it. That is not an
argument; it is `node` running the census's own `stripComments` over `git ls-files`, printed
under the applied plant.

### And the strictly-stronger direction, also measured

The claim was: *today a hand-written `readonly relayAdmission: 'yes' | 'no'` inside
`fabric-node.ts` satisfies `toBe(1)`; under the repair it must not.* Both halves measured, the
first against `git show HEAD:` so no file was written to make it:

| tree | `REPO.declarations` | old row `toBe(1)` |
|---|---|---|
| HEAD (`68be6a9`), as committed | 1 | **GREEN** |
| HEAD + `readonly relayAdmission: 'yes' \| 'no'` in `fabric-node.ts` | **1** | **GREEN** — the state passed |
| repaired tree + the same substitution (**P2b**) | 2 | **RED**: `expected +0 to be 1` at `defining.count` |

---

## Plants — counted before applied, `cmp`'d to confirm the file differed, watched red, restored with `cp` + `cmp`

Every plant was `cmp`'d against a `/tmp` baseline **before** its run and confirmed to differ, so
an unapplied plant and a green plant could not be mistaken for one another. No `git checkout --`,
no `git stash`, no `git add`.

| plant | edit | exit | rows reddened | observed failure text, verbatim |
|---|---|---|---|---|
| **P1** | restore `relayAdmission: 'admits-any-peer',` at `seed-server.ts`'s `FabricNode.start` | 1 | **(a)** census row + **task 3's closed arm** | `AssertionError: expected 1 to be +0 // Object.is equality` at `occurrences(code(site.file), OPEN_POSTURE)`; and `AssertionError: expected [ …(6) ] to deeply equal []` naming six real circuit multiaddrs through the seed that had been *told to close* |
| **P2** | `SeedServerOptions.relayAdmission` → hand-written `ReadonlySet<PublicKeyHex> \| 'admits-any-peer'` | 1 | **(c)** only | `AssertionError: expected [] to deeply equal [ 'packages/node/src/seed-server.ts' ]` |
| **P2b** | `fabric-node.ts`'s declaration → hand-written `'yes' \| 'no'` | 1 | **(c)** + `declares the option required` | `AssertionError: expected +0 to be 1 // Object.is equality`; and `expected '…' to contain 'readonly relayAdmission: RelayAdmissi…'` |
| **P3** | cross-wire `bin/seed.ts` so `--trusted-issuer` reaches `relayAdmission` | 1 | **(e)** + **task 3's closed arm** | ``AssertionError: expected '…' to match /relayAdmission:\s*\n?\s*values\['admi…/``; and `AssertionError: expected [ …(6) ] to deeply equal []` |
| **P4** | delete the closed arm of the banner, leaving only the open text | 1 | **(d)** + **(e)** + **task 3's posture read** | `AssertionError: expected '…' to contain 'admits     only peers certified by'`; `expected 3 to be greater than or equal to 4`; `AssertionError: expected 'admits     every peer that completes …' to contain 'only peers certified by'` |

### Which rows stayed green — the separation is the evidence

- **P1**: 35 of 37 green. The declaration split, the banner guard and the wiring case all
  stayed green, so the census row that reddened is reading the production file's *construction
  site* and not its documentation or its type.
- **P2**: **36 of 37 green — one row, and it is the split.** Nothing behavioural moved, which
  is correct: a type annotation cannot change what a process does. This is the cleanest
  separation in the table and it is the reason P2 is the load-bearing plant.
- **P3** and **P4**: in both, a **source census row and a real-process reading reddened
  together on the same defect**. Those two instruments share no code — one reads text off disk,
  the other spawns a binary and asks a live libp2p node for its circuit addresses.

### Two plants produced a stronger result than the plan predicted, and it is worth naming

P1 and P3 were specified as census plants. Both also reddened **task 3's behavioural closed
arm**, because each produces the same field failure from a different direction: **the banner
says the door is shut and the door is open.** P1 does it by overriding the operator's flag with
a literal; P3 by routing the flag to the wrong option while the banner still reads the right
one. That is the exact class of defect an operator has no way to detect, and it is now caught
twice per run by two independent instruments.

P4's second red — `expected 3 to be greater than or equal to 4` — is the consumer count in case
(e) falling when the banner arm was deleted. The floor of 4 was **measured** (`grep -o` reads 4:
the validator loop, the ternary's two halves, the banner), not guessed, which is why it
discriminates here.

---

## The default posture did not move — and this is the measurement, not the claim

Three independent readings, all in the green tree:

1. **Across a real process, in the same run as the closed arm.** Task 3's open arm spawns
   `bin/seed.ts` with **no** `--admit-issuer`, reads `admits     every peer that completes a
   handshake` off the seed's own banner, and an uncertificated in-process `FabricNode` obtains a
   circuit through it. The closed arm, byte-identical but for the flag, obtains none — held over
   an 8 s window rather than sampled once. Ordered **open first**, so the absence is read
   against a grant this run has already watched happen on this host.
2. **`reservation-exhaustion.node.test.ts` arm A**, which passes no `--admit-issuer` and asserts
   joiner A was granted a circuit with `expect(a.stderr()).not.toContain('PERMISSION_DENIED')`
   beside it. That was an ambient fact; the header now records it as a **live guard on the
   default**, which is a strengthening of that file rather than a cost.
3. **The census.** `bin/seed.ts` holds zero `OPEN_POSTURE` occurrences and one `ANY_POSTURE`,
   because the ternary's absent arm is the open literal — so the nineteen `bin/agent.ts` and
   three `bin/seed.ts` argv sites keep working unchanged, and `tsc --noEmit` exits 0 across all
   of them.

The operator-facing lines, taken off three live processes:

```
NO FLAG            admits     every peer that completes a handshake (this seed pins no admission issuer)
--admit-issuer …   admits     only peers certified by 1 pinned admission issuer (from --admit-issuer): ffff…ffff
                              — a relay that pins issuers must serve enrolment itself or name a provider a
                                joining peer can reach without a reservation
--admit-issuer nothex   (exit 2)   seed.ts: --admit-issuer nothex is not 64 lowercase hex characters
```

The refusal names `--admit-issuer` and `nothex` and does **not** name `--trusted-issuer`, which
is why the two validator loops are separate rather than merged.

---

## Measurements, with their conditions

Every exit code read with `EXIT=$?` on the line **immediately** after the command — no pipes, no
trailing `tail`, no `echo` in between. 8-core host; load is the 1-minute average.

| command | exit | result | process reading | load |
|---|---|---|---|---|
| `npx tsc --noEmit` | **0** | **zero output** | — | — |
| `npx vitest run --project node relay-admission.node.test.ts` | **0** | 37 tests | `real 22.95 user 7.45 sys 1.47` | 5.67 → 4.55 |
| `npx vitest run --project node reservation-exhaustion.node.test.ts` | **0** | 1 test — **arm A still granted** | — | 6.72 |
| `npx vitest run --project node trust-anchors.node.test.ts orphan-leash.node.test.ts` | **0** | 33 tests, 2 files | — | — |
| `npx vitest run --project node start-unwind.node.test.ts` | **0** | 7 tests | — | — |
| `npx vitest run --project node slow-specs.node.test.ts` | **0** | 9 tests, drift 0 against tolerance 5 | — | — |
| `npx vitest run --project e2e seed-discovery.e2e.test.ts` | **0** | 9 tests | — | 5.68 |
| `npx vitest run --project node` | **0** | **166 files, 2320 passed, 2 skipped** | `real 301.80 user 428.88 sys 63.83`, ratio **1.63** | **4.84 → 10.10** |
| `npx vitest run --project browser` | **0** | 249 files, 4101 tests | — | 10.05 |

**Nothing moved in the browser project**, as expected — a move would have been a finding.

**File count unchanged at 166.** This plan adds no test *file*; it extends an existing one, so
`NODE_MEASUREMENT.files` is untouched and `FILE_COUNT_TOLERANCE` was not looked at, let alone
widened.

**Test count +4, fully accounted for**: 2316 → 2320 = one `PRODUCTION_SITES` row (`bin/seed.ts`)
+ one wiring case + two spawn cases. No test was deleted or renamed into invisibility.

**The `1.63` ratio sits beside 24-05's 1.66, 24-04's 1.79 and the verifier's 1.85 on this host**,
so the three are comparable rather than merely all green. It is a comparability key and not a
verdict: much of this suite waits on spawned children and sockets.

### `relay-admission.node.test.ts`'s solo span, before and after

| reading | **before** (baseline, pre-edit) | **after** run A | **after** run B |
|---|---|---|---|
| `/usr/bin/time -p` solo `real` | **13.18** | **22.95** | **23.45** |
| `user` / `sys` | 3.52 / 0.81 | 7.45 / 1.47 | 7.51 / 1.55 |
| reporter `Duration` | 12.26 s | 22.25 s | 22.38 s |
| reporter `tests` | 11.08 s | 21.18 s | 21.12 s |
| 1-min load, start → end | 4.86 → 4.78 | 5.67 → 4.55 | 4.98 → 5.40 |
| `real` less the boot floor | 12.10 | **21.87** | 22.37 |

**Boot floor 1.08 s**, measured in the same session by a solo run of
`packages/core/src/blockstore/memory.test.ts` at load 5.40.

**The cost of task 3 is ≈ +9.8 s**, and it is dominated by the 8 s absence window the closed arm
holds, not by the spawns — `trust-anchors.node.test.ts` measured a full seed banner at **590 ms**
after spawn and this run is consistent with that. The window was **not** shortened to make the
file cheaper: an absence sampled once is also what a fabric that has not got there yet looks
like, and the open arm establishes how long "got there" takes on this host.

`(user+sys)/real` is **0.39** on the after runs: three spawned `bin/seed.ts` children, two
libp2p joiners and an 8 s hold, so most of that wall clock is waiting rather than computing.

---

## Deviations from Plan

### Auto-fixed / measured-and-corrected

**1. [Rule 1 — Bug] `PRODUCTION_SITES`' `total` is a RAW count, not the census's posture count,
and the plan predicted the wrong number.** The plan said the `seed-server.ts` row moves
`open: 1 → 0` with *"`total: 1` unchanged"*. Measured: `total` must be **2**. The per-site case
compares `occurrences(code(site.file), ANY_POSTURE)` against `site.total` **without** subtracting
the declaration, while `census()` subtracts it to get posture *sites*. For every file that
declared nothing the two were the same number, which is why no row had ever had to say which it
was — `seed-server.ts` now declares the forwarded field, so they differ by one there. Found by
running the guard (`AssertionError: expected 2 to be 1`), not by reading it. This is exactly what
the plan meant by *"count it, do not predict it"*.

**2. [Rule 2 — missing guard] `PostureSite` gained a required `declares` field.** Repairing (1)
by writing `total: 2` alone would have left a row that cannot distinguish *one declaration beside
one construction site* from *two construction sites*, and those are different claims about a
deployment. Every row now states its declaration count, including the three that state `0`; a
default would have been the silent-default shape this very option's docblock forbids, applied to
the guard that watches it. **Strictly stronger than what it replaced**: per-file declaration
counts were previously unconstrained except repository-wide.

**3. [Rule 1 — stale title] The per-site case was retitled.** It read
`${site.file} states its posture, and it is open`, which stopped being true of `bin/agent.ts` at
24-03 and is now false for both seed rows. A title naming a value the row does not assert is a
title a reader trusts instead of reading the row.

### Deliberate departures, each with its reason

**4. P2b was added to the plan's four plants.** The plan's P2 (a hand-written union in
`seed-server.ts`) proves the split is not the `toBe(2)` widening. It does **not** prove the
second, stronger property — that a hand-written union in `fabric-node.ts`, which the old row
*accepted*, is now rejected. P2b measures that directly, and the pre-plan half was measured
through `git show HEAD:` so that establishing it required writing no file.

**5. The `MEASURED_NODE_SPANS` row for this file was NOT re-sited.** See the finding below.

**6. No commits, no staging.** The plan and the orchestrator both forbid it. Seven files are
modified and uncommitted in a shared checkout, which is a real risk in this tree and is recorded
rather than quietly resolved by disobeying the constraint.

---

## Findings

### Finding 1 — `MEASURED_NODE_SPANS` records **923 ms** for a file that measured **11 080 ms before this plan touched it**

`vitest.config.ts:707` carries `['packages/node/src/relay-admission.node.test.ts', 923]`. The
baseline reading taken **before any edit in this plan** was `real 13.18` / reporter `tests
11.08 s`. The row is wrong by a factor of twelve, and it was wrong before this plan opened —
plausibly since 24-03 added that file's three behavioural `describe` blocks without re-measuring
its row. After this plan it reads ~21 s.

**`slow-specs.node.test.ts` does not go red**, because it never re-measures: it asserts the table
is sorted descending, that every listed path is git-tracked, that `sumOfFileSpansMs >= listed`,
and that `unitFiles === files - EXCLUDED.length`. Verified green, drift 0.

**It was not re-sited, and the reason is that the repair is not local.** Moving 923 → ~21 200
carries the row above `SLOW_CUTOFF_MS` (1 000), which adds it to the derived `EXCLUDED` list,
which forces `unitFiles` down by one — and `unitFiles`/`unitTests` are documented as *"also
observed directly by running `npm run test:unit`"*, so writing them from a derivation alone would
be writing numbers nobody measured, the exact failure that table exists to prevent. Worse, the
consequence is substantive: it would **remove this repository's admission census and its two
cross-process admission fixtures from the fast commit loop**. That is a workflow decision with a
security-coverage consequence, it is not the gap this plan was chartered to close, and the plan's
own instruction was conditional (*"if a `slow-specs.node.test.ts` row goes red"*) on a row that
is green.

**Recommended repair, for whoever takes it:** re-site the row to a freshly measured span, move it
to its sorted position, add the delta to `sumOfFileSpansMs`, drop `unitFiles` by one, **and
observe `npm run test:unit` directly** to confirm the derivation and the runner agree. Do not
transcribe the ~21 200 ms figure above without re-running — it was taken on a host at load 4.5–5.7
and this table's own method section requires the cross-check.

### Finding 2 — two plants specified as source-census plants also reddened the behavioural block

Recorded because it is a property of the design rather than luck: P1 and P3 each produce **a
banner that says the door is shut beside a door that is open**, from opposite directions. The
census catches the source shape; the spawn block catches the field behaviour. Neither would have
caught both, and the plan's design put them in the same file so that one run reads both.

### Finding 3 — 24-05's finding 1 was applied prospectively rather than inherited

The new block's `until` **awaits** its `observed` thunk. 24-05 found by plant that an un-awaited
async thunk stringifies to `{}`, making the one message a timeout has vacuous. This block's
thunks are synchronous today, so the repair costs nothing and cannot regress — and the sibling
`until` in the same file (the `AUTH-02 — the relay consults RelayAdmission` block) still does
not await. That is 24-05's **R1**, still open, still not this plan's file to widen into.

### Finding 4 — every falsified sentence in the tree was corrected, and each correction quotes what it replaced

`grep` for `cannot be told to close` / `no admission flag` returns four hits. **All four are
inside a correction note that quotes the old wording**, which is `relay-admission.ts`'s own
established practice for its two prior corrections and the reason it gives for it: *a comment
asserting a mechanism is inert is the exact shape this repository has been bitten by; a reader
who believes it stops looking.* No claim was swapped in silently and none was deleted.

---

## What this does NOT license, stated so 24-07 does not over-read it

- It closes **one** seed. A fabric in which every door is closed is unmeasured here.
- It says nothing about the browser tier.
- It is not a claim that a closed seed is a good deployment. 24-05 measured that enrolment
  survives a closed *provider*; a closed seed with **no** reachable provider strands every new
  tab, and the mechanism cannot detect that. T-24-06-05 is `accept, and document` — the
  documenting is at `RelayAdmission`, at `SeedServerOptions.relayAdmission`, and printed in the
  closed arm of the banner where an operator who has just shut a door will meet it.
- **No checkbox moved.** The mechanism existing is not criterion 8 being read over a fabric.

---

## LEDGER EDITS — recommended only; this plan applies none

**L1 — `.planning/REQUIREMENTS.md`, AUTH-02 traceability row.** The text 24-04 landed contains
*"and every `bin/seed.ts` is still open — 24-01 hardcoded that posture deliberately"*, and
`24-VERIFICATION.md` L1 added *"cannot be told to close"*. **Both are now false.** The row needs
an appended sentence naming `SeedServerOptions.relayAdmission` and `bin/seed.ts --admit-issuer`.
**The checkbox does not move and the verdict cell stays `Partial`.**

**L2 — `.planning/ROADMAP.md`, Phase 24 block.** The comment stating the seed's posture is a
literal needs the owner ruling of 2026-08-06 recorded beside it.

**L3 — `.planning/STATE.md`.** Untouched, and it should stay untouched.

**L4 — `vitest.config.ts`.** Finding 1's re-site, with the `npm run test:unit` observation it
requires. Not this plan's, and stated with its full cascade so it is not taken casually.

---

## Threat Flags

None. No new network endpoint, auth path, file access pattern or schema change beyond the one
this plan exists to add, which is in the threat register as T-24-06-01 … 06. Both `mitigate`
dispositions with a source-text mitigation were **watched firing**: T-24-06-02 (flags folded
together) as plant P3, T-24-06-04 (an operator unable to tell which posture their seed runs) as
plant P4. T-24-06-03 (the open default silently becoming closed) is held by three independent
readings, listed above.

---

## Self-Check: PASSED

- `packages/node/src/seed-server.ts` — FOUND, modified
- `packages/node/src/bin/seed.ts` — FOUND, modified
- `packages/libp2p/src/relay-admission.ts` — FOUND, modified
- `packages/node/src/relay-admission.node.test.ts` — FOUND, modified
- `packages/node/src/reservation-exhaustion.node.test.ts` — FOUND, modified
- `packages/node/src/start-unwind.node.test.ts` — FOUND, modified
- `packages/node/src/seed-discovery.e2e.test.ts` — FOUND, modified
- Commits: **none, by the plan's own constraint and the orchestrator's.** No commit hash is
  claimed anywhere above.
- `git status --porcelain` after the final restore: exactly the seven paths above, all `M`.
  **No plant residue** — `seed-server.ts`, `bin/seed.ts` and `fabric-node.ts` each `cmp`'d
  identical against their pre-plant baselines, and `fabric-node.ts` is absent from `git status`
  entirely. No path belonging to any other agent was touched, and no file was created, deleted
  or staged while a vitest run was in flight.
