---
phase: phase-24-certificate-gated-admission
plan: 05
subsystem: admission
tags: [AUTH-02, AUTH-04, bootstrap, measurement, gap-closure]
verdict: hypothesis MEASURED TRUE — the bootstrap paradox is false
requires: []
provides:
  - "a measured verdict on whether closing a relay-capable enrolment provider breaks enrolment"
  - "the mechanism account for 24-04's unexplained `reader` reservation, as standing assertions"
affects:
  - "24-06 may proceed"
  - "24-07 and 24-08 inherit a measured premise instead of an assumed one"
tech-stack:
  added: []
  patterns:
    - "awaited `observed` thunks — a promise stringifies to `{}` and makes a failure message vacuous"
key-files:
  created:
    - packages/node/src/enrolment-needs-no-reservation.node.test.ts
  modified:
    - vitest.config.ts
decisions:
  - "The new spec is NOT listed in MEASURED_NODE_SPANS, because it is untracked and slow-specs requires every listed path to be committed. Its span is recorded beside NODE_MEASUREMENT.files instead, on the tree's own job-entry-points precedent."
  - "NODE_MEASUREMENT.files re-sited 164 → 166 rather than 164 → 165: one of the two arrivals is a foreign file (state-frontmatter.node.test.ts, 9af6210) that predates this plan."
metrics:
  duration: ~25 min
  completed: 2026-08-06
  commits: 0
---

# Phase 24 Plan 05: Enrolment Needs No Reservation — Summary

## THE VERDICT

**The bootstrap paradox is FALSE. Enrolment survives a provider that refuses the joiner a
reservation, measured across real `bin/agent.ts` processes.**

A joiner whose enrolment provider was spawned `--admit-issuer eeee…ee` — a well-formed key
nobody holds, so the door refuses **every** peer including the ones it certifies — came away
holding a certificate that `verifyCertificate` accepts against that same provider's own
published issuer key, while its `relays` list was `[]`, that provider's `reservations` answer
taken over the wire was `[]`, and its stderr named `relay reservation refused:
PERMISSION_DENIED`. The joiner with the same argv against a provider spawned with **no**
`--admit-issuer` came away with the certificate **and** exactly one circuit, and appeared in
that provider's answer. Two arms, one fixture, one run.

**24-06 may proceed.** So may 24-07 and 24-08, on this premise.

The mechanism is now a standing assertion rather than a paragraph: `resolveCertificate`
(`fabric-node.ts:1068`) enrols by `libp2p.dial(multiaddr(enrollment.providerAddr))` followed by
an RPC over that connection, and there is **no reservation anywhere in that path**. Case 4 of
the second block asserts the RPC frame is answered on the direct connection at a closed peer
exactly as at an open one. A refused reservation costs that round trip nothing.

---

## The readings, as published by the file's own `[bootstrap]` lines

**Block 1 — the two arms** (green run, 2026-08-06 18:54, load 5.61 → 5.09):

```
closedProvider   : 12D3KooWEyCoRPo5…  posture ["eeeeeeee…eeee"]          (closed)
openProvider     : 12D3KooWCq9zxiWy…  posture "admits-any-peer"          (open)
closedJoiner     : 12D3KooWSWxae8Ma…  certificateIssuer 37d21331b64ca1f6…  relays []
openJoiner       : 12D3KooWPnH6sCU6…  certificateIssuer 4a23a2b58d5eb20a…  relays [1 circuit]
closedProviderHolds : []
openProviderHolds   : [ openJoiner ]
reader              : 12D3KooWKshUVAha…  (in neither answer — it holds no relay transport)
```

`37d21331…` is the closed provider's **own** `issuerKey`, off its own handshake line, and the
certificate verifies against it offline. The door that signed it is the door that refused it.

**Block 2 — the account of `reader`** (same run):

```
reader  (relayAddrs present → circuitRelayTransport installed) : reserved at openHop, NOT at closedHop
bare    (no relayAddrs      → no circuit transport at all)     : connected to openHop, reserved nowhere
openHop   posture "admits-any-peer"   holds [ reader ]
closedHop posture ["eeee…eeee"]       holds []
```

### What the `reader` account settles

24-VERIFICATION's sharpest finding was that `admission-agents.node.test.ts`'s in-process
`reader` — handed no `enrollment`, holding no certificate, refused by the gated relay — turned
up in the open provider's reservation store, and it read that as criterion 8 failing over the
fabric. **The mechanism is now measured, and it is a side-effect of dialling, not a precondition
of enrolling:**

| case | what was done | result |
|---|---|---|
| 1 | a node with a relay transport **merely direct-dials** an open HOP-speaking peer; issues no reservation request | granted a reservation there |
| 2 | the same node, the same one dial, at a **closed** peer | granted nothing, held over a 5 s window |
| 3 | a node with **no `relayAddrs`** dials the same open peer | connection stands, never advertised — while case 1's node is still in that same answer |
| 4 | an RPC over the direct connection at **both** hops | answered at both. This is the `enrol` frame's path |

**Case 3 is what makes case 1 a statement about a reservation rather than about a connection**,
and plant P3 is what makes case 3 a control rather than a restatement. So the reservation
`reader` held in 24-04 was caused by dialling a peer that admits everybody, and it was never on
the enrolment path.

---

## Plants — every one counted before it was applied, watched red, restored with `cp` + `cmp`

All five runs below were taken against the **final** baseline (the file as it ships), after the
`observed`-thunk repair described under Finding 1. Each plant was applied, `cmp`'d against a
`/tmp` baseline to confirm the file **differs** before the run, and restored with `cp` followed
by a `cmp` that read 0. No `git checkout --`, no `git stash`, no `git add`.

| plant | edit | exit | observed failure text, verbatim | duration | other block |
|---|---|---|---|---|---|
| **P1** | drop `--admit-issuer` from arm A's provider argv | 1 | `AssertionError: expected 'admits-any-peer' to strictly equal [ Array(1) ]` — at the **fixture posture guard** | 2 067 ms | block 2 **green** |
| **P1b** | P1, plus the fixture expectation moved to the open posture so the guard passes | 1 | `AssertionError: expected [ Array(1) ] to strictly equal []` / `+ ["/ip4/127.0.0.1/tcp/59457/p2p/12D3KooWEKDhc7Lr…/p2p-circuit/p2p/12D3KooWAfYwntj2…"]` at `circuitsThrough(closed.joiner, closed.provider.peerId)` | 2 200 ms | block 2 **green** |
| **P2** | drop `--provider-addr` / `--user-key` / `--operator-id` from **arm A's joiner only** | 1 | `AssertionError: expected null not to be null` at `expect(closed.joiner.certificate).not.toBeNull()` | 2 085 ms | block 2 **green** |
| **P3** *(pre-repair)* | reader's `relayAddrs` set to `[]` in case 1 | 1 | `Error: timed out waiting for the reader to be granted a reservation at the open hop it merely dialled; observed {}` — **plus** `Unhandled Rejection: RpcFailure: rpc endpoint closed` | 60 957 ms vs a 60 000 ms budget | block 1 **green** |
| **P3b** *(post-repair)* | same edit | 1 | `Error: timed out waiting for the reader to be granted a reservation at the open hop it merely dialled; observed {"openHopHolds":[]}` | 60 995 ms vs a 60 000 ms budget | block 1 **green** |

### P1 did not redden the assertion the plan said it would, and that is the guard working

The plan predicted *"Arm A's `relays === []` assertion must redden"*. It did not: the **posture
guard reddened first**, in 2 067 ms, because the posture is read off the spawned process's own
handshake line rather than off the argv this file passed it. That is threat T-24-05-01's stated
mitigation firing exactly as specified — a typo in a spawn argument reddens the fixture instead
of letting the reading pass for the wrong reason. It is a stronger result than the plan
expected, not a weaker one, but it leaves the load-bearing assertion unproven on its own, so
**P1b** was run: the same open provider with the fixture expectation moved to match, which is
what an honest fixture would say about an open provider. P1b reddens
`circuitsThrough(closed.joiner, …)` naming the circuit multiaddr that actually arrived.

### P3's duration is evidence of the timeout, and the observation beside it is not

Both P3 runs failed at ~61 s against a 60 000 ms budget. **A duration equal to a timeout is
evidence of the timeout and of nothing else**, and it is recorded as such — the load-bearing
half is the `observed` payload, which after the repair reads `{"openHopHolds":[]}` while the hop
is alive and still answering RPC. That is a reading of the fabric; the 60 995 ms is a reading of
the clock. The budget was **not** shortened to make the plant cheaper, because the budget is
sited against libp2p's own reservation retry and the gate's 3 500 ms deadline.

### Separation

Each plant reddened **one `describe` block and left the other green**, in every one of the five
runs. That is the evidence the two readings are independent: the two-arm cross-process reading
and the in-process mechanism account do not share an instrument.

Cases 1–4 sit in a single `it` and therefore cannot fail independently of one another. That is
forced by the plan's own design and is disclosed rather than papered over: case 2's absence
window is only a reading if case 1's grant has been watched on the same host in the same run,
and case 3 is only a control if case 1 held.

---

## Findings — including premises of this plan measured false

### Finding 1 — **this file's own failure messages were vacuous, and a plant found it**

Every reading in this file that can name what arrived is a **round trip**, so its `observed`
thunk is `async`. `admission-agents.node.test.ts`'s `until` — which this file copied — takes
`() => unknown` and `JSON.stringify`s the value directly. **A promise stringifies to `{}`.**

So P3's first run reported `timed out waiting for … ; observed {}` at 60 957 ms against a
60 000 ms budget: a duration equal to the timeout **and** an observation naming nothing — the
exact failure the `observed` thunk exists to prevent, reproduced by the mechanism meant to
prevent it. It also left an unhandled `RpcFailure: rpc endpoint closed` behind, because the
un-awaited request was still in flight when `afterEach` stopped the node.

Repaired here (Rule 1) by awaiting the thunk; P3b then reported `observed
{"openHopHolds":[]}` and no unhandled rejection. **The same latent defect exists in
`admission-agents.node.test.ts`**, whose `until`/`stays` take four async `observed` thunks
(`advertisedBy` round trips). It is not this plan's file to edit — see LEDGER EDITS R1.

### Finding 2 — the plan's task 3 and its own constraints cannot both be satisfied

The plan says *"Do not `git add`, `git commit` or `git stash`"* **and** *"add its measured span
to `MEASURED_NODE_SPANS`"* **and** *"`slow-specs.node.test.ts` — exit 0"*. Those three are
mutually exclusive: `slow-specs.node.test.ts:316` asserts, as an equality and not a floor, that
every path in `MEASURED_NODE_SPANS` is git-**tracked** — *"a hand-typed span git does not know
about is a typo, and a typo there is a permanently foreign finding"*.

Resolved on the tree's own recorded precedent rather than by inventing one: `vitest.config.ts`
already documents this exact collision for `job-entry-points.node.test.ts` and
`opt-in-only-sources.node.test.ts` — *"counted here, absent from the table"*. So the span is
**measured and recorded in the `NODE_MEASUREMENT.files` docblock**, the file is **counted** in
`files`, and the table is untouched. The cost is stated where the precedent states it: the file
pays its 19.2 s into every `test:unit` run until it is committed and the row can land.

**No tolerance was widened.** `FILE_COUNT_TOLERANCE` is untouched at 5 and drift is 0.

### Finding 3 — the count had already drifted by one, and it is not this plan's file

The plan says to *"move `NODE_MEASUREMENT.files` by exactly the number of node-project files
this plan adds"* — which would give 165. **Measured 166.** The extra file is
`packages/node/src/state-frontmatter.node.test.ts`, landed in `9af6210` *after* 24-04 sited the
field at 164. Absorbing it into a `+1` would have credited this plan with another agent's file
and left the count wrong by one, so `files` was re-sited to **166** with both components named.

Verified by **three** routes sharing no code:

| route | reading |
|---|---|
| the filesystem walk `slow-specs.node.test.ts` derives `NODE_PROJECT_FILES` from | **166** |
| `git ls-files packages tools` filtered by the same globs, plus the one untracked spec in `git status --porcelain` | 165 + 1 = **166** |
| vitest itself, on the full `--project node` run | `Test Files 166 passed (166)` |

### Finding 4 — the ROADMAP's structural claim now has a measurement

`.planning/ROADMAP.md`'s Phase 24 block carries `<!-- CORRECTED 2026-08-05 -->` stating
*"Enrolment is a DIRECT dial on both tiers"*. That is now measured on the Node tier across real
processes, through the production `--provider-addr` argv path, and it is the claim that makes
the bootstrap paradox false. **The browser tier half is still unmeasured here** and is 24-07's.

### Finding 5 — what this reading does NOT license, stated so 24-06 does not over-read it

- It says nothing about a fabric in which **every** door is closed. Both blocks close one named
  process at a time. That reading is 24-07's and 24-08's, and this file licenses building it
  rather than substituting for it.
- It says nothing about `bin/seed.ts`, whose posture is still hardcoded open in
  `seed-server.ts`. What it establishes is only that closing the seed cannot lock the front door
  against a joiner that has an address to dial.
- It says nothing about the browser tier, and nothing about `records` / `providers` gating.

All five limits are written into the file's own header, **before** the readings rather than
after.

---

## Measurements, with their conditions

Every exit code below was read with `EXIT=$?` on the line **immediately** after the command —
no pipes, no trailing `tail`, no `echo` in between.

| command | exit | result | process reading |
|---|---|---|---|
| `npx vitest run --project node enrolment-needs-no-reservation.node.test.ts` | **0** | 2 tests | `real 20.68 user 7.25 sys 1.32` |
| `npx vitest run --project node enrolment-needs-no-reservation.node.test.ts slow-specs.node.test.ts` | **0** | 11 tests, 2 files | `20.04 s` reported |
| `npx vitest run --project node slow-specs.node.test.ts` | **0** | 9 tests, drift 0 against tolerance 5 | `344 ms` |
| `npx tsc --noEmit` | **0** | **zero output** | — |
| `npx vitest run --project node` | **0** | **166 files, 2316 passed, 2 skipped** | `real 273.05 user 397.08 sys 56.59`, ratio **1.66** |

Full-run load: **3.22 at the start, 9.31 at the end**, 1-minute average, 8-core host. The ratio
of **1.66** sits beside 24-04's **1.79** and the verifier's **1.85** on the same host — this run
started on a quieter machine (3.22 against the verifier's 5.92), so the three are comparable
rather than merely all green.

### The new spec's span — measured, not estimated

| reading | run A | run B |
|---|---|---|
| `--reporter=json` file span | **19 202 ms** | 19 080 ms |
| Σ case durations | 19 201 ms | 19 081 ms |
| `/usr/bin/time -p` solo `real` | 20.50 | 20.64 |
| `user` / `sys` | 7.48 / 1.38 | 7.36 / 1.34 |
| `real` less the boot floor | **19.37** | 19.51 |

**No hook shadow.** Σ case durations equals the reporter span to within 1 ms in both runs — the
file's only hook is a `beforeEach` that makes a temp directory, so the reporter's start *is* the
file's start. The reporter and the wall clock agree to within 2 %, which is why the recorded
figure carries no `// wall clock` note.

**Boot floor 1.13 s**, the mean of two solo runs of `packages/core/src/blockstore/memory.test.ts`
(`real 1.20` and `1.06`) **bracketing** the pair in the same session, at load 4.84 → 5.86.

`(user+sys)/real` is **0.43**: the file spawns six `bin/agent.ts` children and holds two 5 s
absence windows, so most of that wall clock is waiting rather than computing. That is a
comparability key, not a verdict.

**Recorded span: 19 202 ms**, in the `NODE_MEASUREMENT.files` docblock — not in
`MEASURED_NODE_SPANS`, for the reason in Finding 2.

---

## Deviations from Plan

### Auto-fixed

**1. [Rule 1 — Bug] `observed` thunks were stringified un-awaited, making every round-trip
failure message vacuous.** Found during the P3 plant. `until`/`stays` now `await observed()`.
Files: `packages/node/src/enrolment-needs-no-reservation.node.test.ts`. Not committed (see
below). Full account under Finding 1.

### Deliberate departures from the plan's letter, each with its reason

**2. The new spec is not added to `MEASURED_NODE_SPANS`** — Finding 2. The plan's constraint,
its task-3 instruction and its own verification command cannot all hold; the tree's recorded
precedent decides it.

**3. `NODE_MEASUREMENT.files` moved by two, not one** — Finding 3. One of the two arrivals is
foreign and predates this plan.

**4. P1 was run twice (P1, P1b).** The plan's predicted assertion is guarded by an earlier
one, so a second variant was needed to redden the load-bearing assertion in isolation. Both are
recorded; neither is substituted for the other.

**5. No commits were made, and no file was staged.** The plan forbids `git add`, `git commit`
and `git stash` outright. **The work is therefore uncommitted in a shared checkout** —
`packages/node/src/enrolment-needs-no-reservation.node.test.ts` is untracked and
`vitest.config.ts` is modified. This is a real risk (a concurrent agent could revert either)
and it is recorded rather than quietly resolved by disobeying the constraint.

### Nothing else

No production source file was modified by this plan. `.planning/STATE.md`,
`.planning/ROADMAP.md` and `.planning/REQUIREMENTS.md` are untouched. Criterion 8's wording is
untouched.

---

## LEDGER EDITS — recommended only; this plan applies none

**L1 — `.planning/ROADMAP.md`, Phase 24 block, the `<!-- CORRECTED 2026-08-05 -->` comment.**
*"Enrolment is a DIRECT dial on both tiers"* should cite
`packages/node/src/enrolment-needs-no-reservation.node.test.ts` for the **Node** half, and
should say that the browser half remains unmeasured pending 24-07. It is a structural claim that
now has a cross-process measurement on one of the two tiers it names.

**L2 — `.planning/REQUIREMENTS.md`.** **No row moves.** AUTH-02 and AUTH-04 stay `[ ]` /
`Partial`. This plan measured a premise; it closed no clause of criterion 8.
`acceptance-traceability.node.test.ts` enforces the pairing and 24-04 watched the overstatement
plant redden five cases by name.

**L3 — `.planning/STATE.md`.** Untouched, and it should stay untouched: nothing here changes the
phase's score.

**R1 — source repair, `packages/node/src/admission-agents.node.test.ts`.** Its `until` and
`stays` take `observed?: () => unknown` and are passed **async** thunks at four call sites
(`() => ({ memberRelays: member.relays })` is fine; the `advertisedBy` ones are not). Any
timeout there will print `observed {}` and may leave an unhandled `RpcFailure`. The repair is
the two-character one made here — `await observed()` plus the widened signature. Not applied:
that file is another plan's, this plan modifies no file it does not own, and the defect is
latent rather than active on a green run.

**R2 — whoever commits this plan's spec** should add
`['packages/node/src/enrolment-needs-no-reservation.node.test.ts', 19_202]` to
`MEASURED_NODE_SPANS`, add 19 202 to `sumOfFileSpansMs`, and drop `unitFiles` from 110 to 109 —
or re-measure. The instruction is written into `vitest.config.ts` beside the count so it is
found by whoever hits it.

---

## Threat Flags

None. This plan modifies no production source and introduces no network endpoint, auth path,
file access pattern or schema change. T-24-05-01's mitigation — posture read off the spawned
process's own handshake line — was **watched firing** as plant P1.

---

## Self-Check: PASSED

- `packages/node/src/enrolment-needs-no-reservation.node.test.ts` — FOUND (untracked, by design)
- `vitest.config.ts` — FOUND, modified
- `.planning/phases/phase-24-certificate-gated-admission/24-05-SUMMARY.md` — FOUND
- Commits: **none, by the plan's own constraint.** There are no commit hashes to verify and none
  is claimed anywhere above.
- `git status --porcelain` after the final restore: `M vitest.config.ts` and
  `?? packages/node/src/enrolment-needs-no-reservation.node.test.ts` (plus this summary). **No
  plant residue**, and no path belonging to any other agent was touched.
