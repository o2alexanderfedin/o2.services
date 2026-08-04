---
phase: phase-19-quorum-composition-owner-domain-attestation
plan: 12
subsystem: ledgers
tags: [mutation-ledger, requirements, traceability, VER-03, VER-04, VER-09, VER-10, AUTH-04, NET-06, WIRE-03]

requires:
  - phase: phase-19
    provides: "seventeen summaries, each carrying the find/replace pair its plan planted and the failure text it observed — the input to this plan"
  - phase: phase-18
    provides: "the mutation ledger's two layers, and the finding that 23 of ~45 citations had outrun the tree"
provides:
  - "25 mutation-ledger entries, one per defect this phase planted and watched go red, each signature taken from the run that observed it"
  - "the ledger's floor moved with its count for the first time since Phase 13.1 — it sat at 23 while the ledger held 42"
  - "two expired `why` claims corrected in place (M2b, M28), found by reading rather than by any guard"
  - "WIRE-03 closed; VER-03, VER-04, VER-09 and VER-10 moved off a marker that had become a false statement"
  - "three deferred items filed rather than fixed — the ROADMAP requirements line, guardSovereignty's refusal branch in a tab, and the unmeasured quorum gate on a runnable entry point"
affects:
  - "the Phase 19 verifier — every row this phase touched now says what is true on the day it was written, with each open half named"

tech-stack:
  added: []
  patterns:
    - "A plant that did NOT redden is a ledger entry too: M38 records that the whole across-process file is insensitive to the derived strength, and M40 records which single fabric carries rule 2"
    - "A count written into prose expires exactly the way a `find` string does, and nothing reads it — three stale counts found in guards that were otherwise green"
    - "A marker is a claim: *Built, not wired* asserts nothing calls the mechanism, so it goes stale the day a caller lands even when every sentence beneath it is correct"

key-files:
  created: []
  modified:
    - packages/node/src/mutation-ledger.ts
    - packages/node/src/mutation-guard.node.test.ts
    - .planning/REQUIREMENTS.md
    - .planning/phases/phase-19-quorum-composition-owner-domain-attestation/deferred-items.md

key-decisions:
  - "Six instruments were NOT written into the ledger, because the summary that observed them recorded no failure text. Reported below by name rather than given an invented signature."
  - "VER-03 and VER-04 are not ticked. VER-03 has no across-process reading of rule 2 at all; VER-04 has no MEASURED reading of a runnable entry point reaching the gate. Both move to *Partial* because the mechanism has a production caller and *Built, not wired* had become false."
  - "VER-09 and VER-10 are not ticked, per their own rows, and move to *Partial* for the same marker reason."
  - "WIRE-03 IS ticked. Its own sentence is met with margin by 19-03, and the ROADMAP's own constraint bullet scopes its content to the two refusals 19-04 executed."
  - "`.planning/ROADMAP.md` was not touched, against the plan's own instruction to add AUTH-04 to its Requirements line. The executor brief forbids it; the correction is filed as deferred item 8 rather than lost."

requirements-completed: [WIRE-03]

duration: one session
completed: 2026-08-03
---

# Phase 19 Plan 12: The ledger, and what may honestly be ticked — Summary

**Twenty-five ledger entries, one per defect this phase planted and watched go red — plus
six it planted, watched, and could not honestly pin, named here rather than given a
signature nobody saw. One requirement closed, four markers corrected off a label that had
become a false statement about the tree, and three sentences in three different ledgers
that were measured false on the day they were read.**

## Host conditions

Sole executor on the main working tree; no concurrent agent, `git status --short` empty at
start. The full `--project node` run was measured with `/usr/bin/time -p`:
**real 222.93 s, user 220.63 s, sys 33.22 s**, so `(user+sys)/real` is **1.139** — the
comparability key rather than a verdict, and the value a spawn-heavy suite on a quiet host
should show. No wall-clock assertion was added or tuned anywhere in this plan.

## Commits

| Commit | Task | What |
|---|---|---|
| `4409131` | 1 | one entry per defect this phase watched go red, and two that expired |
| `d5182da` | 2 | the rows, moved only as far as what landed supports |

Both committed with explicit paths and read back with `git show --stat`; each contains
exactly the files it names.

## Verification — every command, exit code read directly

`EXIT=$?` on the line immediately after the command it reads, never through a pipe and
never after a trailing `tail`.

| Command | Exit | Reading |
|---|---|---|
| `npx tsc --noEmit` (after Task 1) | **0** | no output |
| `npx vitest run --project node …/mutation-guard.node.test.ts` (first attempt) | **1** | 2 failed \| 95 passed — `M54` drifted, below |
| `npx vitest run --project node …/mutation-guard.node.test.ts` (after the fix) | **0** | 97 passed |
| `npx vitest run --project node` × the six cheap guards + `trust-anchors` | **0** | 6 files, 143 passed |
| `npx vitest run --project node …/requirements-ledger …/acceptance-traceability …/vocabulary` | **0** | 3 files, 81 passed |
| the pre-commit hook, on both commits | **0** | 6 files, 181 passed each time |
| `npx tsc --noEmit` (final) | **0** | no output |
| `/usr/bin/time -p npx vitest run --project node` | **0** | **138 files, 1936 passed, 2 skipped** |

`git add` was run only between runs, never during one — `discover-arm.node.test.ts`
snapshots `git status --porcelain` around itself, and it passed in the full run.

---

## Task 1 — the ledger

**25 entries added: `M38`…`M62`. The ledger goes 42 → 67, of which 45 carry a test title
and 22 carry rendered output.**

### The guard caught a drift on the first run, which is the instrument working

`M54`'s `find` is the whole aggregate-issuance block in `enrollment.ts`, and I transcribed
one comment line inside it with a typographic apostrophe where the source has a straight
one. The cheap layer reported it by name — *"no longer contains its find text"* — with the
whole 18-line string quoted back. Fixed by dumping the block's exact bytes with
`JSON.stringify` rather than by retyping it. **One character in eighteen lines**, and it is
precisely the failure mode the layer exists for: the entry would have read healthy and
planted nothing.

### The entries, and what each pins

| id | file | what goes if the line goes | caught by |
|---|---|---|---|
| `M38` | `core/quorum.ts` | the derived strength replaced by the constant it returned from Phase 6 | `quorum.test.ts` |
| `M39` | `core/quorum.ts` | rule 2 asked of the candidate **pool** instead of the chosen members | `quorum.test.ts` |
| `M40` | `core/quorum.ts` | rule 2 deleted outright | `quorum-agents.node.test.ts` |
| `M41` | `core/quorum.ts` | the **retracted** node-kind rule reinstated | `quorum.test.ts` |
| `M42` | `core/quorum.ts` | one operator read as independent agreement | `quorum-agents.node.test.ts` |
| `M43` | `core/job/submit.ts` | `onQuorumShortfall` ignored, every shortfall degraded | `quorum-agents.node.test.ts` |
| `M44` | `core/job/submit.ts` | every shortfall refused — the pre-ruling behaviour | `quorum-agents.node.test.ts` |
| `M45` | `core/job/submit.ts` | `degraded` back to its pre-19-06 meaning | `quorum-agents.node.test.ts` |
| `M46` | `core/job/verify.ts` | node ids and attestations built from separately ordered arrays | `verify.test.ts` |
| `M47` | `core/result-attestation.ts` | `outputCid` dropped from the result challenge | `result-attestation.test.ts` |
| `M48` | `core/result-attestation.ts` | `nodeKey` dropped from it | `result-attestation.test.ts` |
| `M49` | `core/result-attestation.ts` | the combine challenge signed over a **sorted** input list | `result-attestation.test.ts` |
| `M50` | `core/executor/attesting-executor.ts` | the wrapper's output replaced by the unsigned sentinel | `result-signature.node.test.ts` |
| `M51` | `node/fabric-node.ts` | the signing wrapper dropped from the factory's composition | `trust-anchors.node.test.ts` |
| `M52` | `node/fabric-node.ts` | the **combine** hook at the sentinel while exec keeps signing | `result-signature.node.test.ts` |
| `M53` | `net/reduce-job.ts` | a combine certificate counted without its signature checked | `reduce-job.test.ts` |
| `M54` | `core/enrollment.ts` | the aggregate issuance budget deleted | `enrollment.test.ts` |
| `M55` | `node/bin/bench.ts` | the reduce told to check combine signatures against nothing | `bench-reduce.node.test.ts` |
| `M56` | `node/bin/bench.ts` | the two receipts stop naming which claim each is about | `bench-reduce.node.test.ts` |
| `M57` | `node/bin/bench.ts` | `admit: rpcAdmission(...)` deleted — **defect #31** | `bench-reduce.node.test.ts` |
| `M58` | `browser/browser-node.ts` | a tab advertises the sovereign CID it just refused | `tab-refusals.e2e.test.ts` |
| `M59` | `browser/browser-node.ts` | the tab's admission bound, read through a live tab | `tab-refusals.e2e.test.ts` |
| `M60` | `node/fabric-node.ts` | the relay's `reservations` thunk — the rendezvous itself | `static-rendezvous.e2e.test.ts` |
| `M61` | `browser/demo/main.ts` | the issuer pin, so a stranger reads as independent agreement | `attestation-ui.e2e.test.ts` |
| `M62` | `core/sovereignty.ts` | the descriptor's certificate absence written rather than defaulted | `discover-candidates.test.ts` |

Nineteen are keyed on a source line rather than a test title, per the plan's instruction and
Phase 18's loss of `M14` and `M8`. Six carry a compound or template-assembled title where no
narrower source key exists.

### The plants that did NOT redden — recorded, because that is the finding

**A plant that did not fire is a ledger entry too**, and in two cases the green *is* the
entry:

- **`M38` — 19-08 planted `strength: classifyAttestation(members)` → `'independent'` and
  `quorum-agents.node.test.ts` stayed GREEN, 3 passed.** The whole across-process file is
  insensitive to it, because a shard's receipt comes from `attestationReceipt(verified)` in
  `receiptFor` and never from `QuorumResult.strength`. That separation is *correct*, and the
  entry records it as a dependency rather than letting a reader take the file as evidence.
  The claim is carried by `quorum.test.ts`'s size-1 case and by 19-10's CLI reading.
- **`M40` — 19-08 deleted rule 2 and only ONE of three fabrics went red (1 failed, 2
  passed).** The two spawned-agent fabrics are seeds with empty `relayIds`, so `sharedRelay`
  answers `null` on sight of one and their relay assertions cannot fail whatever the composer
  does. This is why VER-03 is not ticked, and it is the single most load-bearing green in the
  phase.

Two more greens were recorded by their own plans and are pinned by the entry that replaced
them rather than by an entry of their own:

- **19-13's `nodeKey`-drop prediction was false.** Dropping it left all 14 cases green,
  because `verifyResultAttestation` verifies under `certificate.nodeKey` and Ed25519's own
  key binding does that work. `M48` pins the property that survived — two replicas of one
  shard sign *different bytes* — and its `why` records the correction.
- **19-13 and 19-15 both reordered the certificate and signature checks and both stayed
  green.** The order is visible only where both questions fail, which is
  `result-attestation.test.ts`'s and not `result-signature.node.test.ts`'s. No entry claims
  otherwise.

### Instruments this phase planted that are NOT in the ledger, and why

Each of these was planted and watched go red by its own plan. **None is written, because the
summary that observed it recorded no failure text**, and the ledger's own rule is that a
signature is output rather than a prediction.

| instrument | plan | what is missing |
|---|---|---|
| `FsIssuance`'s load-at-construction returning empty, so a restart hands the budget back | 19-07 M2 | "RED at n3 and only n3" — no text |
| `FsIssuance.record`'s append made asynchronous | 19-07 P2 | an `ENOENT` path, not an assertion |
| the combine branch signing over a sorted list at the call site | 19-16 M-4 | "2 failed / 31 passed" — no text. `M49` pins the same property at the challenge |
| a refusal carrying a signature on the wire | 19-16 M-7 | text recorded but the `find` is an insertion the summary describes rather than quotes |
| the duplicate-node-key check made vacuous | 19-17 P4 | instrumented output recorded, no failure signature |
| the whole `composeQuorum` call forced to `null` | 19-08 P8 | "3 failed" — no text |

**And one that must not be written at all.** 19-18's `onQuorumShortfall` made optional is the
defect this phase would most easily ship unpinned — the plan says so, and 19-01, 19-13 and
19-16 each measured the same shape. But its guard is `tsc`, not a run: with the field
optional, 28 of 29 files went silent and the two survivors are `TS2578` and `TS2375` in
`submit.test.ts`. Under vitest that file **passes**, because type errors do not execute. A
`caughtBy` naming it would be false, and `Mutation` admits no entry whose runner is the type
checker — `M2c`'s own `why` already records that limit. Reported rather than encoded.

### The existing entries, re-read against the tree

The cheap layer proves every `find` still matches, and it passed on the pre-commit hook of
every Phase 19 commit — so the citation half of the population this phase touched
(`net/agent.ts`, `core/job/verify.ts`, `net/protocol.ts`, both factories, `core/enrollment.ts`,
`core/job/submit.ts`, `demo/index.html`, `demo/main.ts`, `bin/bench.ts`) was already current.
**What nothing checks is the prose, and two claims there had expired:**

1. **`M2b` said the browser admission bound had never been read through a tab**, and named
   writing that case as what would close it. 19-04 wrote it. Corrected at the line, with
   `M59` named as the reading and the reason both entries stay: a source-text count and a
   live tab fail differently, and a fix to one has never implied a fix to the other.
2. **`M28` said `trust-anchors.node.test.ts` stays green "at 20/20"** under its mutation. The
   file now carries **26** cases, because 19-15 added the `attestResults` composition ones.
   The number is **struck rather than renumbered** — the mutation has not been re-planted
   against the 26, so renumbering it would report a reading nobody took.

### Three counts in the guards themselves had expired

Found while raising the floors, and worth stating because all three sat inside files whose
whole subject is stale claims:

- `mutation-guard.node.test.ts`'s anti-vacuity floor was **23** while the ledger held **42**.
  Its own docblock says leaving the floor behind the count "would let the newest entries go
  quietly"; nineteen entries could have gone. Raised to 67, and the `it` title with it.
- The signature-arm floor said *"26 of the 40"*, measured 2026-08-01 — already two stale,
  because 18-12 added `M36` and `M37` without moving it. Re-measured: **45 of 67**.
- `mutation-ledger.ts`'s module docblock repeated *"26 of the 40"* and *"14 of the 40"* in two
  places. Corrected, with the reason recorded in place: a count written into prose expires
  exactly the way a `find` string does, and nothing reads it.

The `rendered-at-runtime` roster is an exact set equality, so the six new entries in that arm
(`M40`, `M42`, `M43`, `M44`, `M45`, `M51`) are listed with the justification that case
demands — five because `quorum-agents.node.test.ts`'s three `it`s each carry dozens of
assertions across three fabrics, so a title would accept a red produced by any of them
including contention; and `M51` because its title is a template literal assembled per file at
run time, so `test-title` would be a false declaration the guard rejects.

**`M45` is the weakest entry in this ledger and says so in its own `why`.** The only text
19-08 recorded for it is `expected false to be true`, and the summary did not say which of
the two degrading fabrics spoke. A flake could produce that string. The cheap layer still
holds the `find`; closing the rest is a re-plant and a paste.

---

## Task 2 — the rows

### The four counts, taken from the section ranges

Counted with a parser over the section headings, never with a whole-file grep — which catches
the legend and a line of prose and overcounts by two.

| count | value |
|---|---|
| v1 section, ticked | **41 of 72** |
| v1.1 section, ticked | **7 of 10** |
| whole file | **48 of 82** |
| *Built, not wired*, from the traceability rows alone | **8** |

The header's own arithmetic moved from `12 + 18 + 1` to `8 + 22 + 1`, and both the split and
the marker sentence were updated together — `requirements-ledger.node.test.ts` parses both
and asserts each against the rows.

### The dispositions, written down before anything was edited

| id | before | after | why |
|---|---|---|---|
| **WIRE-03** | Not started | **Done, `[x]`** | its own sentence met with margin |
| **VER-03** | Built, not wired | Partial | mechanism has a caller; rule 2 has no across-process reading |
| **VER-04** | Built, not wired | Partial | mechanism has a caller; no entry point *measured* reaching the gate |
| **VER-09** | Built, not wired | Partial | marker false; open clause unchanged |
| **VER-10** | Built, not wired | Partial | marker false; open clause unchanged |
| **VER-08** | Done | Done | closed by 19-09, untouched |
| **AUTH-05** | Done | Done | closed by 19-09, untouched |
| **AUTH-04** | Partial (Phase 17) | Partial (Phase **19**) | phase cell corrected; the trade the budget bought is now stated |
| **NET-06** | Partial | Partial | both stated open legs measured **false**; corrected |

**Four markers were wrong, and not because work landed in this commit.** *Built, not wired*
means *nothing calls it*. By the end of Phase 19 `composeQuorum`, `attestationReceipt` and
`classifyAttestation` each had a production caller and, for the last two, two display
surfaces — while four rows went on carrying a label that says the opposite of what their own
prose says three sentences later. That is the same shape as the five reasons corrected on
2026-08-01: the sentence moved and the label did not.

### WIRE-03 — ticked, and the one item still open is named in the row

The requirement's own sentence is *two browser peers served a static bundle, nothing dialled
by the harness, discover each other and complete a job*. 19-03 delivered **three** peers in
**three engines**, each its own `browserType.launch()`, on a file server that 404s
`/bootstrap.json`, with no `window.o2.dial(...)` anywhere in the file, and a per-pair census
showing one limited `/p2p-circuit` and one unlimited `/webrtc` per direction. The ROADMAP's
2026-08-02 constraint bullet scopes this requirement's *content* to the two tab refusals in
as many words — *"Those two are WIRE-03's real content"* — and 19-04 executed both.

**Of the four items the requirement's prose lists as unblocked, three are closed and one is
not**: `guardSovereignty`'s *refusal* branch has still never fired in a tab. Its admitting
branch has (`browser-capability.e2e.test.ts` executes the third of three sovereign tasks),
and `tab-refusals.e2e.test.ts` excludes that guard by construction in its own header. That is
an unblocked item still open rather than a clause unmet, and it is written into the row and
filed as deferred item 9 rather than absorbed by the tick.

### VER-03 and VER-04 — why neither is ticked, measured rather than assumed

The plan predicted both would close. They do not, and the two fail for **different** reasons,
which is itself the finding:

- **VER-03's mechanism is rule 2** — `sharedRelay` over the chosen members — and it has **no
  across-process reading at all**. 19-08's one-relay fabric measured the refusal by kind with
  the relay's own peer id in it, but its three executors are in-process `FabricNode`s started
  `listen: []`, because `bin/agent.ts` passes its listen list unconditionally and can only
  ever produce a `seed` with empty `relayIds`. `M40` is what turns that from a caveat into
  the load-bearing gap: with rule 2 deleted, **only that fabric went red**. Deferred item 2 of
  this phase (defect #35) holds the one flag that would close it, and it is not mine.
- **VER-04's mechanism is rule 1**, and its across-process reading **did** land — three real
  `bin/agent.ts` processes under one `--operator-id`, both dials, the two arms asserted equal
  so they are demonstrably reading one refusal. What is open is narrower and is about
  reachability: no runnable entry point has been *measured* reaching the gate.
  `bin/bench.ts --discover` composes by construction (each worker enrols under its own
  `bench-worker-N` id), and what `bench-attestation.node.test.ts` reads off that binary's
  stdout is a rung's **receipt** strength — which a degraded shard would print identically.
  One inference short. Defect #31, found and closed *inside this phase*, is this repository's
  own record of what a reachability claim resting on an unread expression was worth.

**The `2ddc9e5` correction is recorded in VER-03's row**: `quorum.ts`'s header carried a flat
*"VER-03 is therefore unimplemented"* for part of 2026-08-03, that was an overstatement scoped
to the durability half alone, and it is what led 19-08 to decline the row. The eclipse half is
implemented, as rule 2.

### NET-06 — both stated open legs were measured false

This is the row's **third** correction in the same direction, and each was written by somebody
who read the mechanism rather than ran it:

1. *A default run of every entry point queries no index.* **False.** The demo page performs a
   `records` lookup per peer per job on no flag at all, pinned against the issuer that signed
   the tab's own certificate (19-11, `demo/main.ts`). `M61` is what keeps that pin honest, and
   it was watched printing an independent-agreement claim for a stranger when the pin came off.
2. *A `providers` request answers `[]` from every node because nothing announces.* **False.**
   Owner ruling D1 replaced the announcement with an answer computed from a node's own store
   at ask time; **both factories carry the retraction in their own source**, and the answer was
   read across real processes — 19-08's three-of-three advertisement wait, and 19-09's
   `expected 2 to be 3` when one seed is withheld.

What is honestly open is narrower than either: **no browser-tier path selects whom to compute
with by querying an index.** A tab computes with the peers it is connected to. Both refuted
sentences are paraphrased rather than quoted, because the guard reads a quoted claim as an
asserted one.

### AUTH-04 — the trade, stated as a trade

Stays *Partial* for the reason 19-07 recorded: the clause asks that mass creation be
*measurably costly*, and what landed makes the N-th identity **refused inside the window**
rather than dearer than the first. A bound made durable is not a per-identity price, and the
criterion is not rewritten to close a phase.

Two things were added, both measured against the tree rather than transcribed:

- **The surface the budget opened.** `serveAgent` answers an `enrol` frame with **no
  authorization step of any kind** — read at `packages/net/src/agent.ts`, where the branch is
  named, takes no capacity slot, and reaches the authority directly — so anyone able to dial a
  provider can spend its whole window at one `ed25519.keygen()` and two signatures per
  attempt, where before the aggregate bound they could spend only their own user key's window.
  The row says so, and says the surface is bounded by NET-08's inbound ceiling and by nothing
  else on that branch. No phrase of the *mitigated by design* shape appears.
- **The plan's own sentence about this was falsified and is not transcribed.** It asks the row
  to say the per-verifier answer is *untested* because *"every fixture in this repository and
  the demo are single-provider"*. `enrollment-cost.node.test.ts` has **two** providers and
  measures the recovery half — a node the exhausted provider turned away is certified by a
  second one, and a peer pinning only the first refuses `untrusted-issuer` by name. The row
  therefore says **half measured**, names which half, and leaves the operational half untested.

**The phase cell moved from Phase 17 to Phase 19**, with the move and its date recorded in the
row. It had been wrong since 2026-08-01, when the owner routed criterion 5 — which is entirely
this requirement's cost clause — here.

---

## Deviations from Plan

### 1. [Rule 3 — blocking] The ledger's guard had to move with the ledger

`mutation-guard.node.test.ts` is not in the plan's `files_modified`, and adding entries is
impossible without it: the `rendered-at-runtime` roster is an **exact set equality**, so six
new entries in that arm fail the file until they are listed with a justification. The two
floors were raised in the same edit, because leaving them behind the count is the failure that
file's own docblock describes. The plan anticipates a fourth edit of this kind
(`acceptance-traceability.node.test.ts`) and this is the same class.

### 2. [Rule 1 — a false statement left standing] Two ledger `why` claims and three counts

`M2b`, `M28`, and the three expired counts above. None was caught by any guard; all were
found by reading, which is what the plan's action step asks for and what nothing automates.

### 3. `.planning/ROADMAP.md` was NOT touched, against the plan's letter

The plan sanctions two ROADMAP edits: adding AUTH-04 to Phase 19's `Requirements:` line as a
factual correction, and ticking this phase's plan checkboxes via
`gsd-sdk query roadmap.update-plan-progress`. **The executor brief states
`No modifications to STATE.md or ROADMAP.md` as a success criterion**, and the later
instruction wins. Neither edit was made. The AUTH-04 omission is filed as deferred item 8 with
the disagreement recorded, so the correction is not lost; the plan-checkbox tick matches
19-01, 19-02, 19-03, 19-05, 19-13 and 19-14, all of which have summaries and unticked boxes.

`.planning/STATE.md` was not touched, and no criterion text anywhere was amended.

### 4. Six entries not written, one entry that must never be written

Listed above with the reason for each. This is the plan's own instruction followed rather than
a shortfall: *"If a summary recorded a plausible substitute rather than an observation, the
entry is not written and the gap is reported."*

---

## What the plan got wrong, measured

Twelve consecutive plans in this phase found at least one false statement in their own
`<interfaces>` or `<behavior>` block. This is the thirteenth.

1. **"VER-03, VER-04 — closed if 19-02, 19-06, 19-08 and 19-18 all landed."** 19-02 was
   **retracted** (`0314208`), and 19-08 explicitly declined both rows. Neither closes, and they
   fail for different reasons — VER-03 on a reading that cannot be taken yet, VER-04 on one
   that could be taken and has not.
2. **"WIRE-03 — closed if 19-04 landed. Its content is the two refusals."** The two refusals
   are the ROADMAP's scoping of its *content*; the requirement's own **sentence** is the
   static-bundle rendezvous, which is 19-03's. Both were needed, and the plan names only one.
3. **AUTH-04's "the per-verifier answer is untested: every fixture in this repository and the
   demo are single-provider."** False against the tree — `enrollment-cost.node.test.ts` runs
   two providers and measures the recovery.
4. **NET-06's "`provide()` is never called … check whether that is still true."** It is not,
   and neither is the row's other open leg. The plan anticipated one stale sentence; there were
   two.
5. **"`.planning/REQUIREMENTS.md:602-670`" and ":115-137", ":225-232", ":245-254".** The file is
   693 lines and the traceability table starts at 602; the VER checkboxes are at 117-150, not
   115-137. Coordinates in this file expire, which the file's own header says at length.
6. **The mutation-ledger interface citation "`:62-90`"** is `:62-125` — the interface grew a
   `project` field and a long `signatureSource` docblock. Not load-bearing, but it is the same
   expiry.
7. **"The ten `M*` entries … the two `B*` entries"** — the plan's `<interfaces>` implies a
   ledger around the size the module doc describes. It held **42**, and the guard's own floor
   said 23. The plan's estimate of what needed re-reading was therefore low by about a factor
   of two.

## Threat Flags

None. This plan added no network endpoint, no auth path, no file access pattern and no schema
at a trust boundary. Every change is data in a ledger, prose in a ledger, or a floor in a
guard.

## Self-Check: PASSED

Files claimed modified, listed off disk:

```
FOUND  packages/node/src/mutation-ledger.ts           1600 lines
FOUND  packages/node/src/mutation-guard.node.test.ts   398 lines
FOUND  .planning/REQUIREMENTS.md                        707 lines
FOUND  .planning/phases/…/deferred-items.md            323 lines
```

Commits claimed, found in `git log --oneline`:

```
FOUND  4409131  docs(19-12): one entry per defect this phase watched go red, and two that expired
FOUND  d5182da  docs(19-12): the rows, moved only as far as what landed supports
```

Neither commit deleted a tracked file (`git diff --diff-filter=D` empty for each), and
`git show --stat` on each names only the files that commit's message claims. Every path was
staged explicitly; `git add -A` was never used, `git checkout --` was never used, `git clean`
was never run, `git stash` was never used, no branch was created or switched, and no commit
used `--no-verify` or `O2_SKIP_GUARDS=1`. `.planning/STATE.md` and `.planning/ROADMAP.md` are
absent from `git diff --name-only 824f18e..HEAD`.
