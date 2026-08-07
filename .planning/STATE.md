---
gsd_state_version: 1.0
milestone: v1.1
milestone_name: Wire What Was Built
status: executing
stopped_at: >-
  PHASE 24 IS EXECUTED AND VERIFIED AT 0 OF 1, AND IT IS NOT COUNTED - four plans, four summaries,
  `24-VERIFICATION.md` dated 2026-08-06 at `753d298`, `status` reading `gaps_found`. THE COUNT IS
  9 OF 15 - PHASE 16 CLOSED 2026-08-06 AT 4/4, by a dated amendment to `16-VERIFICATION.md` rather
  than a table edit. Its criterion 3 closes on Phase 20 criterion 6, whose arriving-late reading
  is STRONGER than the clause carried to it: a SIGSTOPped `bin/agent.ts` child, awaited to `ps`
  state T, resumed after `executeReduce` had already RETURNED, with unsolicitedness asserted by
  construction. Two plants were watched red and restored by `cp` + `cmp`. ONE CLAUSE DOES NOT
  MATCH LITERALLY AND THE VERDICT TURNS ON IT - "because it carries the same CID" is causally
  INERT on the late path, since `rpc.ts` drops the frame on a missing correlation entry BEFORE the
  payload matters, and no assertion anywhere reads the late frame's CID; the verifier closed on
  the reading that the duplicate is harmless because content-addressing makes it redundant, and an
  owner who reads it the other way should say so. THE FIVE STILL UNCOUNTED ARE 17 (2/3), 19 (4/5),
  20 (6/7), 21 (2/3) AND 24 (0/1). Criterion 8 is the phase's ONLY criterion, carried into it from
  Phase 19 criterion 5 and Phase 17 criterion 3, so a score reads out of 1 and never out of 8 -
  and it verifies PARTIAL, not NOT MET. THE MECHANISM IS REAL AND ARMED -
  `connectionGater.denyInboundRelayReservation` on `fabric-node.ts` asks a joining peer for its
  records over the fabric's own RPC, verifies the certificate offline against a pinned issuer set,
  refuses inside libp2p's own 5000 ms ceiling, and every path out of it is a decision; it refuses
  and admits by certificate across SIX real `bin/agent.ts` processes and three browser engines,
  and mutation M66 was planted and caught by the verifier itself. WHAT DOES NOT HOLD IS THE
  CRITERION'S OWN WORD, FABRIC. The evidence reads "cannot join a relay that has been told to
  close". Admission is per-relay by construction, and the enrolment provider a joiner MUST dial in
  order to be certified is itself an open door, so a refused joiner reserves there - demonstrated
  twice in one run, once by accident. 24-04 argued the clause still held because `stranger` is
  nowhere; the verifier falsified that using 24-04's own run, because the in-process `reader` is
  ALSO a node handed no `enrollment` option and holding no certificate, and its id is the second
  entry in `openProviderHolds`, so what separates the node that is out from the node that is in is
  not the certificate but which peers each happened to dial. AND `bin/seed.ts` CANNOT BE TOLD TO
  CLOSE - no `--admit-issuer` flag, no `SeedServerOptions` field, `relayAdmission` hardcoded
  `'admits-any-peer'` at `seed-server.ts`'s `FabricNode.start` call - so the bound is STRUCTURAL
  rather than a deployment posture an operator can remove, and the seed is the relay every browser
  tab reserves on and the source of `BootstrapInfo.peerAddrs`, the one advertisement surface no
  test in the tree reads as a gated one and the one `demo/main.ts` consumes for peer discovery. SO
  PHASE 19 CRITERION 5 AND PHASE 17 CRITERION 3 DO NOT CLOSE EITHER - RULING A, a carried
  criterion stays PARTIAL until its destination lands, and its destination landed PARTIAL. Neither
  phase's score moves. AUTH-02 AND AUTH-04 STAY `[ ]` AND STAY `Partial`; both traceability rows
  were extended 2026-08-06 with what Phase 24 measured and with the three things it does not
  close. The refuse-over-mint residual is UNCHANGED on two independent readings at different host
  loads - 3.070 by 24-04 and 3.0895 by the verifier, both inside Phase 19's 2.96-3.16 band - so
  Phase 19's economics survive on an armed tree; refuse-over-replay reads above its band for a
  reason that is about the clock and not the code. THREE OWNER RULINGS ARE PENDING, all named in
  `24-VERIFICATION.md` - whether a seed may be told which issuers it admits, whether Phase 22
  still runs next now that it will certify a fabric gated at agent relays and open at every seed,
  and the `**Mode -** mvp` label on Phase 24's roadmap block, which cannot be verified under MVP
  mode's User Flow Coverage contract because the phase goal is a security property rather than a
  User Story. Three stale source comments were repaired in the same pass - `fabric-node.ts`'s
  "Nothing reads this yet", `relay-admission.ts`'s "Consulted by nothing", and a process count of
  five that was wrong in the test's own Budget section and twice in `24-04-SUMMARY.md`. NEXT IS
  PHASE 22, which runs LAST, then the v1.1 milestone audit. Phase 23's notes follow and are
  superseded wherever they disagree with the above. WAS - PHASE 23 IS COMPLETE AND COUNTED - 5/5
  criteria MET, `23-VERIFICATION.md` dated 2026-08-06, `status` reading `human_needed` only
  because a verifier may not apply the ledger edits it recommends, and this STATE.md update is one
  of them. THE COUNT IS 8 OF 15 - 11, 12, 13, 13.1, 14, 15, 18 and 23 are closed; 16 (3/4), 17
  (2/3), 19 (4/5), 20 (6/7) and 21 (2/3) are each verified and each UNCOUNTED on one criterion; 22
  has four plans and no execution; 24 is 1 of 4 and running. RULING A has now held across six
  phases without being bent once. WHAT MOVED SINCE 2026-08-04 - 13.1 IS 7/7, criterion 7's at-rest
  half having landed 2026-08-02, so this frontmatter read 6/7 for four days while the body two
  paragraphs below already said it had landed; 18 IS 9/9 AND CLOSED by the second amendment of
  2026-08-04, the day WIRE-04 landed, which is criterion 2b's tripwire doing exactly what RULING A
  required of it; 17 IS 2/3, amended up 2026-08-05, with criterion 3's COST clause carried to
  Phase 24 criterion 8. PHASE 23 MEASURED THE CLAIM THIS PROJECT EXISTS TO MAKE AND THE NUMBER IS
  SMALLER THAN THE STORY - N real OS processes with published pids per rung (`nodes + 1`,
  submitter in-process), makespan 1591.1 ms at N=1 falling to 590.0 ms at N=8, a 2.70x speedup
  re-derived from `.planning/bench/raw.json` rather than transcribed, against an ideal bound of
  9.78x (`sum / max` over 16 calibrations). THREE EARLIER PUBLISHED BOUNDS ARE VOID and were
  withdrawn rather than reconciled - the old bound averaged sixteen calibration calls THAT NEVER
  RAN, because `Task.label` is optional in-process and REQUIRED at the wire while `execute`
  returns `{ok:false}` instead of throwing, so all sixteen failed silently and every one was
  counted as a success. TWO OF THE PHASE'S OWN HEADLINE HYPOTHESES CAME BACK FALSE AND WERE
  PUBLISHED AS FALSE - the recorded cause for the excluded 16-node rung was REFUTED by the phase's
  own eight-cell factorial, since outcomes partition on DIAL DIRECTION and a live node announces
  `inboundConnectionThreshold=15` rather than the blamed 5; and WHETHER THE TWO DRIVERS DIFFER AT
  ALL IS UNSETTLED and is published as unsettled, three runs with the curves crossing twice and
  the spread between runs exceeding the difference between drivers. Criterion 3 passes on its
  FIRST disjunct, so the refutation costs the phase nothing and the criterion takes a dated
  correction note rather than a rewrite. BENCH-07 CLOSED 2026-08-06. AUTH-03 STAYS `Partial` - its
  requestor half now has production callers, `bin/bench.ts` calling `delegate` twice and shipping
  a `'sovereign'` shard, which is more than it had and is still not the reachability question;
  that ruling belongs to Phase 22 criterion 1. NEXT IS PHASE 24, 1 of 4 with three plans amended
  and ready, AND IT HAS A PRE-EXECUTION BLOCKER recorded under Session Continuity. Order is 24,
  then 22, then the milestone audit. Two older readings carried forward and NOT re-checked since
  2026-08-04 - TEN TRACKED DEFECTS CLOSED and every one had a wrong recorded diagnosis, and FOUR
  GUARD DEFECTS SHARE ONE SHAPE, the population a guard acts on not being the population that pays
  for it (defect 38 fixed, defects 39 and 40 open). Phase 19's notes follow and are superseded
  wherever they disagree with the above. WAS - PHASE 19 IS CLOSED, verified twice, 4/5 MET, 1
  PARTIAL, 0 FAILED, and NOT COUNTED, following 13.1 (then 6/7, now 7/7), 16 (3/4), 17 (then 1/3,
  now 2/3) and 18 (then 8/9, now 9/9 and closed): a phase at less than full marks stays uncounted
  until its last criterion is settled. Criterion 5 needs an OWNER RULING - the N-th identity is
  refused inside the window, not priced, and both routes are open. PHASE 20 IS EXECUTED AND
  VERIFIED AT 6/7 - 13 plans, 13 summaries, `20-VERIFICATION.md` dated 2026-08-05, ten plants each
  watched red and restored by `cp` + `cmp`. This clause used to read "PHASE 20 IS PLANNED (13
  plans, 7 waves, none executed)". Criterion 7's checkpoint-WRITE half has NO production submitter
  - no shipped entry point supplies a `checkpoints` sink and no guard pins the set, so CHURN-03
  stays Partial and the phase does not close. Its planner had surfaced two further rulings: the
  roadmap Research:None line is measured FALSE about lease renewal (LeaseTable.renew has no caller
  anywhere and runResilient never renews, so renewal needs BUILDING), and CHURN-03 sits on the
  Requirements line and on none of the six criteria so a verifier will not score it. PHASE 21 IS 5
  OF 5 PLANS AND VERIFIED AT 2/3 - this clause used to read "2 OF 5 PLANS (wave 1 done)". The
  owner ruling of 2026-08-05 recorded criterion 2's re-tag refusal as a MEASURED NEGATIVE on
  AOT-05's precedent; the clause is CARRIED, not cleared, and the score did NOT move. TEN TRACKED
  DEFECTS CLOSED and EVERY ONE HAD A WRONG RECORDED DIAGNOSIS - a timeout ceiling read as a
  measurement, a bug deleted three days earlier, a rate wrong by 3x, a race a comment declared
  impossible, and an assertion excluded from failing at the type level; in three of them the false
  claim sat in a comment that read like evidence. FOUR GUARD DEFECTS SHARE ONE SHAPE - the
  population a guard acts on is not the population that pays for it (#38 fixed, #39 and #40 open).
  Phase 19 details follow. WAS: - all four remaining waves landed 2026-08-03, tsc 0, node 138
  files 1936 passed 2 skipped. A phase is done when a verifier says so, not when its plans are, so
  it is NOT counted yet. WHAT THE PHASE ESTABLISHED - the third leg of the signing triangle is
  wired at fabric-node.ts:1543 and browser-node.ts:1078 and verifies across real processes against
  nothing but the provider's public key; criterion 3's CLI half is MET off a spawned driver's own
  stdout; the demo names who ran a cube from statements it checked. WHAT IT DID NOT - VER-03 has
  NO across-process reading of rule 2 at all, because bin/agent.ts cannot produce a via-relay
  node, and 19-08's P5 proved only the in-process fabric carries that claim; VER-04's gate is
  reached by no MEASURED runnable entry point; VER-09/VER-10 stay untickd because every reading in
  existence is of a public job while VER-09's wording is about a sovereign one. All four moved off
  'Built, not wired', which had become false the moment 19-06 gave composeQuorum a production
  caller. FOUR DEFECTS WERE CLOSED AND THE BEST OF THEM WAS NOT A FEATURE - NET-05's ~20% flake
  was a LOST WAKEUP: agent.ts subscribed its refusal listener after FabricNode.start, the relay
  dial happens inside start, and onFailure had no replay, so the refusal was recorded and never
  printed; the comment directly above that subscription asserted the opposite and was the defect,
  written down and shipped. Also closed - the pre-commit guard's trigger was narrower than its own
  git ls-files corpus, so a violation committed in a root-level .md ran no guard at all and then
  blocked an unrelated agent; same shape as Phase 18's ledger guard, where editing a row exempted
  it. THE PHASE'S REAL OUTPUT IS STILL THE HABIT - fourteen consecutive executors each found at
  least one proof in their own plan that COULD NOT FAIL, several found their plan's own interfaces
  block asserting things measured FALSE, and 19-12 recorded the greens as ledger entries in their
  own right rather than erasing them. Wave 5 was resequenced before dispatch because 19-15 had to
  precede the two plans that read receipt strength - depends_on could not catch it, the dependency
  ran through node behaviour rather than a file or an API. WAVE 5 WAS RESEQUENCED BEFORE DISPATCH
  AND THAT IS THE REUSABLE PART - 19-15 ran first and alone because attestResults was composed
  nowhere in production, so receiptFor returned holds-no-verified-attestation for every shard and
  19-08's and 19-10's assertions on receipt strength were unreachable; depends_on could not catch
  it because the dependency ran through node behaviour rather than through a file or an API. THE
  THIRD LEG IS NOW WIRED at fabric-node.ts:1543 and browser-node.ts:1078, measured across real
  processes against nothing but the provider's public key. CRITERION 3's CLI HALF IS MET - a
  spawned bin/bench.ts --quick --discover prints owner-attested at the 1-node real rung,
  independent at the 2-node one, and a named absence at every memory rung, all three read off the
  child's own stdout. CRITERION 1 IS HALF-MEASURED - anti-affinity has a cross-process reading;
  the shared-relay half does not, because bin/agent.ts cannot produce a via-relay node (port
  defaults to 0 and the listen address is passed unconditionally, so canRelay is always true),
  which the plan's own interface block claimed the opposite of and which was measured false.
  NET-05 HAS A REAL DEFECT, not a flake - roughly one node in five that connects to a full relay
  is never told it was refused; the armed instrument caught agent b's entire stderr as 'no relay
  granted a reservation yet; still serving directly', which proves the dial SUCCEEDED and
  RESERVATION_REFUSED never arrived at all, so no larger timeout can fix it. The signing
  triangle's third leg exists - a node signs its result with the nodeKey its provider-issued
  certificate carries, and the combine result is signed on the same terms, so a third party
  holding only the provider's public key can verify a result came from a node that provider
  enrolled running code that provider published. composeQuorum and attestationReceipt have their
  first production callers. Criterion 4 is MET across three browser engines with no harness dial.
  FIVE RULINGS ARE RECORDED IN THE TREE - the signing triangle; no blockchain with revocation as
  non-renewal and lifetimes explicitly NOT part of the cost argument; VER-03 reworded to eclipse
  resistance because the seed-based anchor rule I proposed keyed on node kind and was retracted in
  0314208; the quorum is the default and OPTIONAL with a JobSpec.onQuorumShortfall dial; and the
  aggregate issuance budget's enrolment-denial exposure accepted and named. AN INCIDENT WORTH THE
  LESSON - git stash on a path you do not own reverted ~250 lines of a concurrent executor's work;
  resolved with nothing lost, verified rather than assumed, and the defence is git add immediately
  after each edit group because staged content lives where a working-tree revert cannot reach it.
  Nine consecutive executors found proofs in their own plans that COULD NOT FAIL and reported them
  rather than recording a green. Phase 18 was VERIFIED at 8/9 and UNCOUNTED by owner ruling
  2026-08-02 applying RULING A, and is now CLOSED AT 9/9 - second amendment 2026-08-04, the day
  WIRE-04 landed, which is the day criterion 2b's tripwire was written to turn red on. Thirteen
  plans, thirteen summaries, one verification amended once. The first independent pass scored 7/9
  and found the thing that mattered - criterion 2b's absence-instrument COULD NOT FAIL. RULING A
  had accepted 2b at PARTIAL on one condition, that the missing re-pick was held by a reading
  which turns red the day WIRE-04 lands; it would not have. The assertion read
  verification.agreeing, whose length is redundancy, and the status==='agreed' narrowing three
  lines above excluded zero - a tautology, confirmed at the type level, not a weak guard. Plans
  18-12 and 18-13 closed both gaps with ZERO production change; re-verification moved 2b
  FAILED->PARTIAL and criterion 3 PARTIAL->MET. Ledger entries M36 and M37 pin the two new
  instruments and were run as ledger data, both caught. THE PHASE DOES NOT CLOSE ON 2b - the
  re-pick is WIRE-04's, scheduled to Phase 20 criterion 1, and the tripwire now fires when it
  lands. Three findings outlived the phase and are tracked, not fixed - admit at bin/bench.ts:723
  can be deleted with the whole suite green and is the SOLE production caller behind SCHED-02's
  runnable-entry-point claim; tools/aot/lift.node.test.ts failed WORSE alone on a quiet host than
  under load, contradicting its own recorded diagnosis; and 23 of ~45 ledger citations had outrun
  the tree, nine of them inside the very plan written to correct drift.
last_updated: "2026-08-07T01:35:00.000Z"
last_activity: 2026-08-06
progress:
  total_phases: 15
  completed_phases: 9
  total_plans: 99
  completed_plans: 99
  percent: 60
---

<!--
progress counts the v1.1 milestone only: phases 11, 12, 13, 13.1, 14-24. **Fifteen** of
them. This line read "14-23. Fourteen of them" until 2026-08-06: Phase 24
(Certificate-Gated Admission) was inserted by owner ruling 2026-08-05, ahead of 22, which
still runs last. 11, 12 and 13 are verified done. Phase 13 was counted incomplete for most of
2026-07-28 — its first independent pass scored the original criteria 0/3, the criteria
were amended on three owner rulings, four more plans closed the gaps, and a second
independent pass then scored 3/3 against the amended text. It counts now because a
verifier said so, which is the rule: a phase is done when a verifier says so, not when
its plans are.

**`completed_phases` is 9 as of 2026-08-06.** The nine are 11, 12, 13, **13.1**, 14, 15,
**16**, **18** and **23**. 18 joined on 2026-08-04 when WIRE-04 landed and its second
amendment moved it 8/9 → 9/9; 23 joined on 2026-08-06 at 5/5; **16 joined the same day at
4/4**. The verified-but-uncounted phases are now **five**: 17 (2/3), 19 (4/5), 20 (6/7),
21 (2/3) and **24 (0/1)** — one PARTIAL criterion each, every one of them **carried** to a
named destination rather than rewritten.

**Phase 16 closed 2026-08-06 by a dated amendment, and it is the second time RULING A has
paid out rather than cost anything.** Its criterion 3 was carried to Phase 20 criterion 6
on 2026-07-31; Phase 20 scored that criterion MET; the amendment re-measured it rather than
transcribing the earlier verdict. **`criterion_text_unchanged: true`** — both texts were
extracted to files and `cmp`'d at exit 0, and `git log -L` returns exactly one commit for
each line, so neither was ever edited. The destination's reading is **stronger** than the
clause carried into it: a spawned `bin/agent.ts` child SIGSTOPped and *awaited to `ps` state
`T`*, resumed only after `executeReduce` had already **returned**, with unsolicitedness
asserted by construction rather than by timing. Two mutations were planted, watched red, and
restored by `cp` + `cmp`.

**One clause does not match literally, the amendment says so, and the verdict turns on it.**
Criterion 3 reads *"discarded harmlessly **because it carries the same CID**"*, and on the
late path that causal claim is **inert**: `rpc.ts` drops the frame because the correlation
entry is gone, *before* the payload matters, so a late reply carrying a **different** CID
would be dropped identically — and no assertion anywhere reads the late frame's CID at all.
The verifier closed on the reading *"the duplicate is harmless because content-addressing
makes it redundant"*, and stated plainly that the stricter reading would demand a mechanism
that should not exist. **An owner who reads it the other way should say so**; that would move
16 back to 3/4 and the count back to 8.

**Phase 24 joined that list on 2026-08-06 and it did NOT join the count.** It has exactly
one criterion, numbered 8, and `24-VERIFICATION.md` scores it **0 of 1 — PARTIAL**: the
admission gate is built, armed and measured, and the criterion's own word is *"the
fabric"* while the evidence reads *"a relay that has been told to close"*. Its destination
is the thing that has not landed — admission as a property of the fabric — and `bin/seed.ts`
cannot be told to close at all, so the bound is structural rather than a deployment
posture. **Criterion 8 is also where Phase 19's criterion 5 and Phase 17's criterion 3 were
carried**, so under RULING A neither of those closes either, and neither phase's score
moves. A destination that lands PARTIAL settles nothing.

**Phase 13.1 joined on 2026-08-02**: it was verified 2026-07-31 at `gaps_found` 6/7 with DATA-10
open, and criterion 7's at-rest half has now landed — a durable per-node sovereign-CID set
(`sovereign-cids.ts`, `idb-sovereign-cids.ts`) registered at `submit.ts`'s blockstore-put and
consulted by the `block` branch. The verification carries a dated amendment rather than being
rewritten, so what it found on 2026-07-31 is still readable.

**The fix deliberately did NOT hold the EgressGuard registration forever.** That would have
closed the criterion and reintroduced the unbounded per-frame scan `egress.ts` forbids by
name. The durable set is keyed on CID and answers by lookup; the guard stays keyed on payload
and stays job-scoped. Two mechanisms, each cheap at its own question — do not merge them.

**The count is over criteria, never over requirements, and Phases 24 and 15 are the
pair that shows why.** 24 is uncounted because its own single **criterion** is PARTIAL.
Phase 15 is counted because all three of its criteria are MET — even though its
requirement, AUTH-03, is *also* Partial. A requirement can outlive the phase that opened
it; a criterion cannot. **The left-hand example of this pair has now been three different
phases, and each one leaving it is the rule being satisfied rather than repealed** — 13.1
held the slot until 2026-08-02 and closed at 7/7, **16 held it until 2026-08-06 and closed
at 4/4**, and 24 holds it now. The slot is not supposed to stay empty and it is not supposed
to keep the same occupant. AUTH-03's requestor half was scheduled, by owner ruling, to Phase
23 criterion 5, and Phase 23 **delivered it** on 2026-08-06 — `bin/bench.ts` calls
`delegate` twice, hands a `(nodeId) => CapabilitySupplier` to `discoverCandidates`, and
ships `shards: [{ value: row, label: 'sovereign', ownerId: BENCH_OWNER_KEY }]`. **The row
is still `Partial` and that is deliberate**: the leg is reached only behind two
off-by-default flags (`--discover --sovereign`), and whether that counts as *entry-point
reachable* is Phase 22 criterion 1's guard to rule, not this row's. REQUIREMENTS.md's row
says exactly that. **`completed_phases` is not a count of
closed requirements and must never be reconciled against one.**

- **Phase 14** — `passed`, 3/3, both mutation probes re-run independently and both red;
  DET-03 and DATA-08 ticked and moved off *Built, not wired*.
- **Phase 15** — 3/3 on criteria. The verifier returned `human_needed` on three
  escalations, **all three since closed**: a production comment naming a function this
  repository does not have, a SUMMARY frontmatter claiming AUTH-03 complete, and an
  unproven browser-tier authorizer. The last was closed behaviourally in 15-05 and is
  pinned by mutation-ledger entry **M30**.

`total_plans` counts plans that exist, and it is not a milestone denominator.

**The clause that used to sit here — *"phases 19, 20 and 22 still have no directory, so it
will grow"* — is FALSE, and it stayed in this file for days after it stopped being true.**
All three exist: `phase-19-quorum-composition-owner-domain-attestation`,
`phase-20-single-job-path-ledger-churn-resilience`, `phase-22-reachability-guard`. So does
`phase-24-certificate-gated-admission`, which did not exist when the sentence was written.
It did grow — **56 → 99** — and nobody moved the number with it. A sentence predicting
growth is not a substitute for recounting.

**Recounted on disk 2026-08-02**, because both figures had gone stale by the width of a
whole wave: 11:1, 12:4, 13:7, 13.1:5, 14:5, 15:4, 16:4, 17:5, **18:11**, 21:5, 23:5 =
**56**, of which **50** have a summary. Phase 18 reads 11 plans / 11 summaries, which is
exactly the "all eleven merged" in `stopped_at` — the two are derived from the same
directory and should be checked against each other.

**Recounted on disk again 2026-08-06**, four days stale and off by 23 plans. Counting
`*-NN-PLAN.md` and `*-NN-SUMMARY.md` per directory: 11 1/1, 12 4/4, 13 7/7, 13.1 5/5,
14 5/5, 15 4/**5**, 16 4/**6**, 17 5/**6**, 18 **13**/13, 19 **19**/19, 20 **13**/13,
21 5/5, **22 4/0**, 23 **6**/6, **24 4/1** = **99 plans, 96 summaries**. **Re-counted again
after Phase 24 finished executing, 2026-08-06: 24 is now 4/4, so the summaries figure is
99 and `completed_plans` moved 96 → 99.** The plans figure did not move — Phase 24 minted
no new plan — and `percent` is phases and not plans, so it stays 53. Phase 18 went
11 → 13 when 18-12 and 18-13 landed as gap-closure plans, so the "all eleven merged"
reading above is now historical and must not be re-derived from it. **Phase 22 is the only
directory with plans and no summaries** — four planned, none executed, and it runs last.
`percent` is phases, not plans: 8/15 = 53%.

**`completed_plans` counts summaries, and in three phases that is MORE than the plans.**
15, 16 and 17 each carry a gap-closure summary with no plan of its own, so the figure is
not a subset of `total_plans` and must not be read as a percentage of it. A `find` across
`.planning/phases/` returns more still — the extra are v1.0 phases, outside this count.

**18-08 and 18-09 had merged code and no summary for a day**, which is what made the
recount necessary: their work was in `git log` while the artifact a verifier reads did not
exist. A plan is not finished when its commit lands.

Do not take these from `gsd-sdk query progress.bar` — it counts plan files across the
nine unarchived v1.0 phase directories and reports "17/9 plans (100%)".

**Three separate writers have now corrupted this frontmatter, so treat the whole family
as unsafe and maintain it by hand:**

- `gsd-sdk query state.begin-phase` — overwrites this block from that same bad count
  (2026-07-28: rewrote 25% to 62%) and mangles the Current focus paragraph.
- The `pause-work` workflow's own state update (2026-08-01) — rewrote `total_phases`
  14 to 24, reset `completed_phases`, regressed `last_activity` by a day, and mangled
  `milestone_name` to "— Wire What Was Built".
- `gsd-sdk query state.record-metric` (2026-08-01, found by plan 18-03) — asked for a
  single metrics row, it *also* rewrote `status` and `stopped_at`, regressed
  `last_activity`, and rewrote every progress count: **percent 36 to 74**.

`roadmap.update-plan-progress` is the one measured exception and is safe.

**If you must add a metrics row, write it by hand.** And after any tool touches
`.planning/`, `git diff .planning/STATE.md` before committing — every one of these was
caught that way and not by the tool reporting a failure. None of them errored.

**MEASURED 2026-08-06, and it may be why none of them errored: THIS FRONTMATTER HAS NOT
BEEN VALID YAML FOR SOME TIME.** `yaml.safe_load` over the block raises
`ScannerError: mapping values are not allowed here` — at HEAD before this update, on
`stopped_at` at column 149, which is the `": "` inside *"…and 18 (8/9): a phase at less
than full marks…"*. A `": "` cannot appear inside a plain (unquoted) YAML scalar. There
are **five** such sites in `stopped_at`, all pre-existing; this update added none and
removed none, and wrote `WAS -` rather than `WAS:` so as not to add a sixth.

**This is a finding, not a diagnosis, and it is deliberately not fixed here.** That a
writer which cannot parse the block goes on to rewrite it is *plausible* as the mechanism
behind all three corruptions above — and plausible is not measured, which is this
project's own rule. The fix is one owner ruling wide: make `stopped_at` a folded block
scalar (`stopped_at: >-` with the text indented), which is the idiom every
`*-VERIFICATION.md` already uses for `score:` and which makes `": "` and `" #"` safe. The
risk to weigh against it is any consumer that line-greps `^stopped_at:` for its value
rather than parsing. **Not taken autonomously.**
-->


# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-07-27)

**Core value:** Usable capacity grows super-linearly with the user base, without any raw data leaving its owner's device.
**Current focus:** Phase 24 (Certificate-Gated Admission) is **EXECUTED at 4/4 plans and
verified at 0 of 1 criteria**, `24-VERIFICATION.md` 2026-08-06 — criterion 8 PARTIAL, so
the phase is **not counted**. Next is **Phase 22 (Reachability Guard), which runs last**,
then the v1.1 milestone audit. That order is an owner ruling of 2026-08-05, which inserted
24 ahead of 22; 22 was already last, because it is the guard that rules on everything the
other phases wire. **The premise that ruling rested on has moved and needs re-confirming**:
22 was put after 24 so the reachability guard would certify a *gated* fabric, and it will
now certify a fabric gated at agent relays and open at every seed.

**Five phases are verified and stay uncounted, and that is the rule working rather than
the rule failing**: 17 at 2/3, 19 at 4/5, 20 at 6/7, 21 at 2/3 and **24 at
0/1**. Each has exactly one PARTIAL criterion, and each of those was **carried to a named
destination rather than rewritten** — 17's and 19's to Phase
24 criterion 8, 20's to a checkpoint sink no shipped entry point supplies, 21's recorded as
a measured negative on AOT-05's precedent, and **24's own criterion 8 to a fabric-wide
admission that has not landed**. **This read "six … 16 at 3/4" until 2026-08-06**, when 16's
carried criterion closed against a destination that had landed MET — the outcome RULING A
was written to produce, and the opposite of Phase 24's, where the destination landed and
settled nothing. Phase 15 is counted at 3/3 despite a Partial
*requirement*. **The count is over criteria, never over requirements** — a requirement can
outlive the phase that opened it; a criterion cannot. **RULING A**: a criterion is not
rewritten to let a phase close, and a carried criterion stays PARTIAL until its destination
phase lands. Phase 18 is the proof that this costs nothing in the end — it sat at 8/9 for
two days and closed at 9/9 on 2026-08-04, the day WIRE-04 landed, exactly as the tripwire
was written to. **Phase 24 is the first case of the other outcome, and it is the harder
one**: 17 and 19 both carried their open criterion *to* criterion 8, criterion 8 landed
PARTIAL, and so all three stay PARTIAL together. A destination that arrives and does not
settle the clause settles nothing, and RULING A does not let the arrival be read as a
close.

DATA-10 closed on 2026-08-02 and 13.1 is counted. The at-rest half landed as a durable
per-node sovereign-CID set registered at `submit.ts`'s blockstore-put; the bare-`submitJob`
half is covered by the same boundary rather than deferred to Phase 20 as the 2026-07-31
ruling anticipated.

## Current Position

Phase: 24 (Certificate-Gated Admission) — **0/1 on criteria, NOT closed and NOT counted**
Status: 4 plans, 4 summaries, `24-VERIFICATION.md` dated 2026-08-06 at `753d298`,
`status: gaps_found`. **The phase has exactly one criterion, numbered 8**, carried into it
from Phase 19 criterion 5 and Phase 17 criterion 3 by owner ruling 2026-08-04, so a score
reads **out of 1 and never out of 8**. The verdict is **PARTIAL, not NOT MET**, and the
distinction is the whole of what this entry records.

**The mechanism is real, armed and measured.** `RelayAdmission` is a required named union
at 70 construction sites; `relayAdmissionGate` reads it and returns *no gater method at
all* for the open posture, so an unarmed node is byte-identical to before; the gate asks a
joining peer for its records over the fabric's own RPC, retries because the first request
is *destroyed* rather than delayed, verifies the certificate offline against a pinned
issuer set, and refuses inside libp2p's own 5 000 ms ceiling. It refuses and admits by
certificate across **six** real `bin/agent.ts` processes and in chromium, firefox and
webkit, and **mutation M66 was planted and caught by the verifier itself**. Nothing here
is decoration.

**What does not hold is the criterion's own word — "the fabric".** The evidence reads
*"cannot join a relay that has been told to close"*. `denyInboundRelayReservation` is
per-relay by construction, and the enrolment provider a joiner **must** dial in order to be
certified is itself an open door, so a refused joiner reserves there. That was demonstrated
twice in one run, once by accident. **24-04's defence of the clause was falsified by
24-04's own run**: it argued that criterion 8's subject is *"a node that cannot present a
provider-issued certificate"*, that `stranger` is that node, and that `stranger` is
nowhere — but the in-process `reader` is **also** that node, handed no `enrollment` option
and holding no certificate, and its id is the second entry in `openProviderHolds`. Two
nodes, the same clause, opposite answers, and the difference between them is not the
certificate but which peers each happened to dial.

**And `bin/seed.ts` cannot be told to close.** No `--admit-issuer` flag, no
`SeedServerOptions` field, and `seed-server.ts` writes `relayAdmission: 'admits-any-peer'`
at its `FabricNode.start` call. So the bound is **structural**, not a deployment posture an
operator can remove — which is why this verifies PARTIAL rather than passing with a stated
bound. The seed is the relay **every browser tab in this fabric reserves on**, and the
source of `BootstrapInfo.peerAddrs` — the one advertisement surface no test in the tree
reads as a gated one, and the one `packages/browser/demo/main.ts` consumes for peer
discovery.

**The residual is unchanged on two independent readings, which is the point of taking it.**
refuse-over-mint read **3.070** (24-04, load 3.44) and **3.0895** (verifier, load 5.92),
both inside Phase 19's 2.96–3.16 band across nine prior readings — so Phase 19's refusal
economics survive on a tree where the gate exists and is armed. refuse-over-replay reads
**9 351** / **9 576.8** against a recorded 3 758–7 501 band, and that is the instrument
rather than the code: the replay denominator sits at 0.5–0.75 µs, a couple of
`performance.now()` ticks, so every reading of the quotient is floored by the clock and
understates. Neither number is evidence of a regression **or** of an improvement. **The
counted half is the load-bearing one and it holds**: three full issuances for three askers
against **zero** reservations. Counts need no calibration.

**The revocation window is a measured number with a measured floor.** A refused renewal
never resets the relay's timer, so an entry runs out on its original clock — measured
`ttlMs 40000 renewalAskedAfterMs 30031 droppedAfterMs 40049`. The window **is** the
reservation TTL, and it cannot be shortened below about 30 s, because
`@libp2p/circuit-relay-v2`'s `REFRESH_TIMEOUT_MIN` clamps the renewal ask at 30 000 ms;
under that, a reservation expires before its holder ever tries to renew, which is churn and
not revocation. A refused peer also never retries by itself — libp2p arms its refresh timer
only inside the success path — so a **reconnection** is what gets an admitted peer in.

**Two things this phase's own reports got wrong, both now corrected rather than carried.**
The process count is **six**, not five: `spawnAgent` runs for `provider`, `other-provider`,
`relay`, and three times inside `joinFabric`. It was wrong in the test's own Budget section
and twice in `24-04-SUMMARY.md`, and it had propagated into the AUTH-02 row drafted for the
permanent ledger. And two docblocks on the phase's own central field said the opposite of
the code beside them — `FabricNodeOptions.relayAdmission`'s *"Nothing reads this yet"* and
`relay-admission.ts`'s *"Consulted by nothing"* / *"MEASUREMENTS not yet taken"*. Both
repaired 2026-08-06.

**Three owner rulings are pending, all named in `24-VERIFICATION.md`:** whether a seed may
be told which issuers it admits (`SeedServerOptions.relayAdmission` +
`bin/seed.ts --admit-issuer`) — under which criterion 8 can reach MET; whether Phase 22
still runs next, given it will now certify a fabric gated at agent relays and open at every
seed; and the `**Mode:** mvp` label on Phase 24's ROADMAP block, which cannot be verified
under MVP mode's User Flow Coverage contract because the goal is a security property rather
than a User Story. **Criterion 8's wording was not edited** — restating it as a property of
*a relay* is exactly the rewrite RULING A forbids, and it is an owner's edit if it is
anyone's.

Previous phase: 23 (Multi-Process Benchmark Driver) — **5/5 on criteria, COMPLETE**
Status: 6 plans, 6 summaries, `23-VERIFICATION.md` dated 2026-08-06. Its `status:
human_needed` carries **no gap**: it names the ledger edits a verifier is forbidden to
apply, and this file is one of them. All six plans deferred those edits to verification on
the stated ground that *"a phase is done when a verifier says so, not when its plans are"*,
and the verifier confirmed on disk that the phase touched none of `REQUIREMENTS.md`,
`ROADMAP.md` or `STATE.md`. **BENCH-07 closed 2026-08-06.**

**The harness now spawns real operating-system processes** — `nodes + 1` per rung, the
submitter in-process, every pid published — so a parallel speedup is measurable at all
rather than asserted. **The measured speedup is 2.70×**: makespan **1591.1 ms at N=1 to
590.0 ms at N=8**, against an **ideal bound of 9.78×** (`sum ÷ max` over 16 calibrations).
Both figures were **re-derived from `.planning/bench/raw.json` by the verifier**, not
transcribed from a summary.

**Three previously published bounds are void, and that is the phase's best finding.** The
old bound was computed over sixteen calibration calls **that never ran**: `Task.label` is
optional in-process and **REQUIRED at the wire**, and `execute` returns `{ok: false}`
rather than throwing — so sixteen silent failures were averaged in as though they had
succeeded. A bound computed over calls that did not happen is not a conservative bound, it
is a wrong one. The three were **withdrawn, not reconciled**.

**Two of the phase's own headline hypotheses came back FALSE and were published as false.**
First, the recorded cause for the excluded 16-node rung was **refuted by the phase's own
eight-cell factorial**: outcomes partition on **dial direction**, and a live node announces
`inboundConnectionThreshold=15` — not the 5 the note blamed. Criterion 3 passes on its
**first** disjunct, so the refutation costs the phase nothing; the criterion takes a dated
correction note rather than a rewrite, because changing a criterion's text after the fact
is an owner ruling and not a verifier's edit. Second, **whether the two drivers differ at
all is UNSETTLED, and is published as unsettled**: three runs, the curves crossed twice,
and the spread *between runs* exceeds the difference *between drivers*. The experiment
cannot separate them, and the artifact says so instead of picking a winner.

**AUTH-03 stays `Partial`, and not because nothing happened.** Its requestor half now has
production callers — `bin/bench.ts` calls `delegate` twice, hands a
`(nodeId) => CapabilitySupplier` to `discoverCandidates`, and ships
`shards: [{ value: row, label: 'sovereign', ownerId: BENCH_OWNER_KEY }]`. A spawned run
printed `--sovereign: 1 of 1 sovereign shards agreed, chain rooted at ea4a6c63…`, and a
chain minted under a different key was refused with `unauthorized: link 0 is issued by
1398f62c…`. The leg is still reached only behind two off-by-default flags
(`--discover --sovereign`), and **whether that is entry-point reachable is Phase 22
criterion 1's guard to rule.** Ticking ahead of the guard is the shape this milestone
exists to remove.

**Two stale claims live in production source and will mislead Phase 22 if left**:
`packages/net/src/remote-executor.ts`'s class comment beginning *"AUTH-03: the *minting*
side of this is still entry-point-unreachable"*, and `packages/bench/src/index.ts`'s
*"Exported here with no production caller yet. Plan 23-03 supplies it"*. Both are now
measurably false; both are source edits the verifier could not make.

Previous phase: 21 (AOT Translation, Signing & Runtime) — **2/3 on criteria, NOT closed**
Status: 5 plans, 5 summaries, `21-VERIFICATION.md` 2026-08-05, `status: ruled`. Criteria 1
and 3 MET and **both re-executed from source by the verifier**, including both router
mutations in `packages/aot/src/abi-router.ts` and a real CLI lift of both guests.
**Criterion 2 is PARTIAL on one clause only** — the re-tag refusal — while its second
clause, that changing a covered input moves the emitted CID, is MET.

**The owner ruling of 2026-08-05 recorded the re-tag refusal as a MEASURED NEGATIVE, on
AOT-05's precedent, and the score did not move.** What the ruling settles is the *reason*,
which had been pending since the pass was written; the number was never in question. Both
alternatives were declined on the pass's own measurement: a name allow-list decides the
clause but makes `--image` pointless, which is that flag's entire purpose; and amending the
clause had already been rejected once as unmeasurable, because the classic-store daemon
exits 1. A third option — scoring it MET off the unit-level `resolveImage` refusal — was
**never available**, because unmeasured is not met. The clause is **carried, not cleared.**
`REQUIREMENTS.md` already carried the measured-negative wording in three places; the ruling
makes the verification agree with the ledger rather than the other way round.

Conditions, because they are load-bearing here: MacBookPro18,3, 8 cores, Docker with the
**containerd** image store, elfconv image present at `sha256:22a404f3…`, **three other
agents working this same checkout**, load average between **24 and 277** across the pass.

Previous phase: 20 (Single Job Path, Ledger & Churn Resilience) — **6/7 on criteria, NOT closed**
Status: 13 plans, 13 summaries, `20-VERIFICATION.md` 2026-08-05. Scored against seven
criteria, including criterion 7 as **ADDED 2026-08-04** by owner ruling; **criterion 8 was
moved OUT to Phase 24 by the same ruling** and is not scored here. Every MET verdict rests
on an assertion this pass **planted against and watched go red** — ten plants, each
restored by `cp` + `cmp`, `git status` confirmed clean after.

**Criterion 7's write half has no production submitter, and that is the whole gap.** The
recovery half is delivered and falsifiable across six real processes. The write half runs
on a `checkpoints` sink **no shipped entry point supplies**, and no call-site guard pins
which files may pass `SubmitOptions.checkpoints` — so the omission is **unguarded in both
directions**. The precedent exists and was not followed:
`sovereign-block-refusal.node.test.ts` pins the file set allowed to pass
`SubmitOptions.sovereignCids`, and `checkpoints` has no equivalent. The natural candidate
for the sink is `bin/bench.ts`, which already holds the only production `admit` and already
opens an `FsBlockstore`. **CHURN-03 stays Partial, and it is Partial on the wiring alone.**
An owner ruling that the criterion's first clause is satisfied by the production
`writeCheckpoint`/`checkpointOf` path running under a *test-supplied* sink would move it to
7/7 — **RULING A forbids taking that route silently**, and it has not been taken.

**WIRE-04 landed in this phase, and landing it is what closed Phase 18.** A tripwire written
in one phase firing two phases later is the argument for RULING A stated as an event rather
than as a principle.

Previous phase: 19 (Quorum Composition & Owner-Domain Attestation) — **4/5 on criteria, NOT closed**
Status: 19 plans, 19 summaries, `19-VERIFICATION.md` verified **three times** — 3/5 MET on
2026-08-04T03:46, then 4/5 once plan 19-19 closed criterion 1, and **UNCHANGED at 4/5** on
the third pass, which re-measured all four MET criteria against a tree where `submit.ts`
(+719), `fabric-node.ts` (+210) and `browser-node.ts` (+197) had been rewritten underneath
it. `criterion_text_unchanged: true` — both criteria were re-read word-for-word before
re-scoring, which is the only thing that makes a re-verification comparable to the first.

**Criterion 5 does not move to MET and the score does not read 5/5.** The owner carried it
to **Phase 24 criterion 8**, which has not landed, and under RULING A — re-confirmed the
same day, when Phase 18 closed at 9/9 only once WIRE-04 *actually landed* — a carried
criterion stays PARTIAL until its destination phase does. The gap is exact: enrolling is
**a bound made durable, not a rising price.** The N-th identity is refused inside the
window rather than priced; the limit is keyed on `userKey`, which is one
`ed25519.keygen()`; and the budget is per provider **process**, so a second provider
defeats it without a second key.

**Criterion 1's relay clause got the across-process reading it lacked.** Deleting rule 2
from `composeQuorum` reddens a fabric of four spawned `bin/agent.ts` processes at
`quorum-agents.node.test.ts:1064` with `expected 'composed' to be 'not-composed'`, and the
regression control was proved non-vacuous by planting the plausible **wrong**
implementation as well as the deletion. Separately, an **unledgered** plant by the verifier
— keying `bin/agent.ts`'s `listen` on `--relay-addr` being present rather than `--port`
being absent — reddened `quorum-agents` alone, proving that case is **the only guard in the
tree** for that production change.

**Four findings outlived the pass and are recorded rather than fixed:** a `submit.ts`
citation that the fix's own +14-line edit moved out from under; `static-rendezvous.e2e.test.ts`
citing a duty-cycle comment for `reservations: 'relays-for-nobody'` — wrong when written,
and not among the three that same commit claimed to have re-checked;
`reservation-exhaustion.node.test.ts`'s stated claim that a relay-refused node is *"still
serving directly"* asserted **nowhere**, measured by a plant that makes its agents bind
nothing and leaves the file GREEN; and `bench-attestation.node.test.ts:478` going red once
in three full node runs under contention, because its retry gate deliberately does not
cover a rung that completed at reduced redundancy.

Previous phase: 18 (Discovery, Capacity & Placement) — **9/9 on criteria, CLOSED 2026-08-04**
Status: 11 planned plans + 2 gap-closure plans (18-12, 18-13), 13 summaries, 1 verification
amended **twice**. **No automated gap remains.** Criteria 1, 2, 2c, 2d, 3, 4, 5 and 6 were
MET at the first amendment; **criterion 2b was PARTIAL and the phase was not permitted to
close on it** — RULING A, written at planning time in `ROADMAP.md` precisely so this would
not need re-deciding. It closed on **2026-08-04, the day WIRE-04 landed in Phase 20**, and
the tripwire turned red on cue. The phase spent two days looking unfinished and got a real
criterion out of it; nothing was rewritten to make it close.

**The first pass found a tautology, and that is the phase's real finding.** Criterion 2b's
absence-instrument — the thing RULING A required in exchange for accepting PARTIAL, so the
clause would *"turn red the day WIRE-04 lands"* — could not fail at all.
`expect(shard.verification.agreeing).toHaveLength(1)` reads a subset of `placement.nodeIds`,
whose length **is** `redundancy` = 1, and the `status === 'agreed'` narrowing three lines
above excludes 0. Confirmed at the type level on re-verification. Its companion,
`expect(direct.ok).toBe(false)`, was broken a second and independent way: taken on a bare
`RemoteExecutor.execute()` **outside** `submitJob`, where a retry inside `submitJob` can
never reach it. **A guard that cannot fail is worse than no guard, because the next reader
stops looking** — and this one was load-bearing for a ruling.

Both gaps closed with **zero production change** (`git diff` over `packages/core`,
`packages/browser`, `packages/net`, `packages/libp2p` is empty across 18-12). The
replacements were each planted, watched RED, and restored by `cmp`: **M36** re-picks inside
`submitJob` and reads `expected 'agreed' to be 'insufficient'`; **M37** builds a second
`LocalCapacity` without the governor and turns the peer's wire reading red while **every
in-page assertion stays green** — 1 failed, 5 passed, which is the whole content of
criterion 3's browser half.

**Three findings outlived the phase and are tracked rather than fixed:**
- **`admit:` at `bin/bench.ts:723` is guarded by nothing.** Deleting it moves `submitJob`
  from `planWithOffers` to `planPlacement`, and on a rig where nothing refuses the two place
  identically. It is the **sole production caller** behind SCHED-02's runnable-entry-point
  claim. Closing it needs a rig where a node actually refuses.
- **`tools/aot/lift.node.test.ts` failed WORSE alone on a quiet host** (12 failures, ten
  60 s timeouts, 850 s against the config's recorded 217 s) than under suite load, so
  `deferred-items.md` item 2's *"passes in isolation"* diagnosis is false. **CLOSED 2026-08-04.**
  Measured in both conditions before anything was changed, and the file was green 99/99 in each:
  alone at load 5.9 it ran 216.83 s, and under twelve CPU burners at load 102 it ran 284.29 s —
  but **92.6% of that wall clock is one integration `beforeAll` the per-case reporter attributes
  to nothing**, and the cases themselves moved only 9.7%. The real cause is an unbounded retry:
  bounded in count, unbounded in time. `despiteAFullProcessTable` retries four times, an attempt's
  duration is a budget the caller chose, and 4 × 20 000 ms plus backoffs is 81 500 ms of driver
  budget inside a 60 000 ms case — so the framework always fired first, always at exactly
  60 000 ms, always with nothing to say. **The recorded diagnosis had read 60 000 ms as evidence
  that docker hangs for a minute; 60 000 is that file's own `vi.setConfig({ testTimeout })`.** A
  duration equal to a timeout is evidence of the timeout. The absolute bound is now comparative —
  two arms of one case, 400 ms against 2 000 ms of budget, reading the difference so spawn cost
  cancels algebraically — and it reds below 800 ms or above 3 200 ms against a worst measured
  drift of ~300 ms.
- **23 of ~45 ledger citations had outrun the tree**, nine of them introduced by the very
  plan written to correct drift. A blanket offset would have been wrong twice over — one
  citation was out by 117, and five were already exact. A cheap guard was **measured and
  declined**: the tractable check catches 16 of 22 and needs four exemptions, which reads
  green and retires the question.

**18-13 found the defect under the stale rows.** Both claim-checking cases in
`requirements-ledger.node.test.ts` iterated `BUILT_NOT_WIRED`, so a row marked *Partial* left
the guard's population entirely — **the act of fixing a row was the act of exempting it**.
SCHED-03 was corrected on 2026-08-01 and went stale by the next day, unwatched. Widening to
every row immediately surfaced a fourth stale row nobody had reported (NET-06).
`WITHOUT_A_CHECKABLE_CLAIM` went 2 → 17 without anything becoming less checked: the
consuming assertion demands **exact set equality**, so a row with a bindable claim cannot be
parked there.

Previous phase: 17 (Node Identity & Enrollment) — **2/3 on criteria, NOT closed**
(**amended up from 1/3 on 2026-08-05**; this entry read 1/3 until 2026-08-06)
Status: 5 planned plans + 1 gap closure (17-06), 6 summaries, 1 verification pass amended
once. **Criterion 1 MET** cross-process, and not as a self-report: `.identity.key` absent
before the spawn and present after, `peerIdForNodeKey(nodeKey) === peerId`, and the
certificate re-fetched over the production `records` RPC by a **third** process and verified
there. **Criterion 2 moved to MET** on the 2026-08-05 amendment. **Criterion 3 stays
PARTIAL** on its COST clause, which is **carried to Phase 24 criterion 8** — the same
destination as Phase 19 criterion 5, and the same reason: a bound made durable is not a
rising price. **AUTH-01, AUTH-02 and AUTH-04 all stay open**; nothing ticked.

**Two halves were scheduled rather than lowered** (owner rulings 2026-08-01):
- **Phase 18 criterion 2d** — a flag that makes a spawned agent dial a named peer, plus a
  cross-process proof of *acceptance*. `bin/agent.ts` parses eleven flags and none dials a
  peer, so a spawned verifier can reach only `no-records`. Until such a flag exists **no
  phase can prove any peer-to-peer acceptance cross-process**, not just this one.
- **Phase 19 criterion 5** — enrolling must cost something an attacker cannot mint free.
  AUTH-04's rate limit is fully proven; what it does not buy is the cost clause. The limit
  is keyed on `userKey`, which is one `ed25519.keygen()`, and the budget is per provider
  **process**, so a second provider defeats it without a second key.

**The regression it introduced is closed.** The fail-closed gate had excluded *every*
browser peer as a block source — a fabric partitioned by tier, against the cardinal rule.
17-06 gave browser tabs their own persisted identity and enrollment, and the partition
instrument was observed at **both** values against the same gate node with the same pinned
issuer. The insecure-origin path 17-01 left unmeasured is now measured in three engines.

**⚠ ONE DEFECT IS OPEN AND NEEDS AN OWNER DECISION — see Pending Todos.**

Previous phase: 16 (Decomposable Tree-Reduce Wiring) — **4/4 on criteria, CLOSED 2026-08-06**
Status: 4 planned plans + 2 gap-closure plans (16-05, 16-06), 6 summaries, 1 verification
pass **amended once**. Criteria 1, 2 and 4 were MET on the original pass; **criterion 3 was
PARTIAL** — its dedupe half proven across nine real `bin/agent.ts` processes, its
*"arriving late"* half not, because `executeReduce` stops at `wanted` replicas and had no
channel on which a late result could arrive at all. Scheduled to **Phase 20 criterion 6** by
owner ruling rather than rewritten, and **closed there**.

**The amendment re-measured; it did not transcribe.** `criterion_text_unchanged: true`, both
texts `cmp`'d at exit 0, and `git log -L` returns one commit per line — neither was ever
edited. Phase 20's reading is *stronger* than the clause carried into it: a spawned agent
SIGSTOPped and awaited to `ps` state `T`, resumed only after `executeReduce` had **returned**,
unsolicitedness asserted by construction. Two plants watched red, restored by `cp` + `cmp`.
The numbers differ from `20-VERIFICATION.md`'s — 3 asks and 3 late replies against its 2 and
2 — and that is correct rather than alarming, because the assertion is a **relation inside
the run** (`late.length === victimAsks.length`), so a different rendezvous draw moves both
sides together.

**The one clause that does not match literally is recorded, not smoothed over.** *"because it
carries the same CID"* is causally **inert** on the late path — `rpc.ts` drops the frame on a
missing correlation entry before the payload matters, and nothing reads the late frame's CID.
Closed on the reading that the duplicate is harmless because content-addressing makes it
redundant. **The verdict turns on that choice and an owner may overturn it**, which would
return the phase to 3/4.

**MR-04 and MR-07 stay `Partial` and nothing was ticked** — deliberately. Both rows already
record the arriving-late closure; what keeps them open is the **demo** half, which is WIRE-02
and Phase 22's. Ticking either would contradict its own row and redden
`acceptance-traceability.node.test.ts`.

**Two attribution facts worth keeping.** The owner ruling and `ROADMAP.md` both say *"Phase 16
keeps **MR-04** open on this account"* while `16-VERIFICATION.md` attributes criterion 3 to
**MR-07**; `REQUIREMENTS.md` extended both rows identically, and the destination spec names
both cases. And `late-combine.node.test.ts`'s own header claim — that this was *"the first
time in this file's history that `expect(arrived)` had ever actually failed"* — is **false**:
`20-03-SUMMARY.md` records that same assertion failing under the SIGCONT-withheld plant, the
file contradicts itself thirty lines earlier, and the amendment's second plant reproduced it.
Documentary only; tracked, not fixed.

**One finding was closed after the verifier wrote its report:** 16-06 bounded the combine
branch at the `capacity` hook, closing the widened fetch surface that routing combine
through the `Authorizer` had opened. The report predates it and still records it as open.

Previous phase: 15 (Capability-Chained Dispatch) — **3/3 on criteria, closed; AUTH-03 open**
Status: 4 planned plans + 1 gap-closure plan (15-05), 5 summaries, 1 verification pass.
The serving half of AUTH-03 is wired and verified between two spawned `bin/agent.ts`
processes; the requestor half — `delegate`, `CapabilitySupplier`, `RemoteExecutor`'s
supplier branch — was routed to Phase 23 criterion 5 by owner ruling, and **Phase 23
carried it out on 2026-08-06**: the "zero production callers" clause this entry used to
carry is now measurably false and is corrected rather than left to be grepped. The row is
**still `Partial`**, because reachability behind two off-by-default flags is Phase 22
criterion 1's ruling. Mutation-ledger entry **M30** pins the browser tier's authorizer
behaviourally.
Next: **22, then the v1.1 milestone audit.** 23 and 24 are both executed and verified; the
line read "24, then 22, then the v1.1 milestone audit" until 2026-08-06, before that "23,
then 24, then 22", and before that "…20, 21, 23, 22" — which was already right about 22
being last, and the owner ruling of 2026-08-05 inserted 24 ahead of it. **Whether 22 still
runs next is one of the three pending rulings**: it was placed after 24 so the reachability
guard would certify a *gated* fabric, and criterion 8 landing PARTIAL means it will certify
one gated at agent relays and open at every seed. That ruling's own escape hatch — that
`22-VERIFICATION.md` states plainly what it covered — applies in a partial form the ruling
did not anticipate. **These
run strictly sequentially, not concurrently** — measured 2026-07-31 from their own
`files_modified`: `fabric-node.ts` is touched by 14/15/17/21 and now by 24-01 and 24-03,
`bin/bench.ts` by 14/15/16/17/23 and now by 24-02, `browser-node.ts` by 14/15/17/21.
"Wire What Was Built" means every phase converges on the same construction sites, so the
earlier note that six phases "can run concurrently" was wrong.
Last activity: 2026-08-06

```
Test Files  ~320 · Tests 4772 · exit 0 · tsc --noEmit clean   (2026-08-01, load 7.1)
node 106 files/1521 · browser 3207 (chromium+firefox+webkit) · e2e 9/44
```

**A later full reading exists and is transcribed, not taken here** — `20-VERIFICATION.md`
2026-08-05, exit codes read with `EXIT=$?` on the next line, no pipes. This state update
ran no tests and claims none of its own.

```
tsc --noEmit  exit 0, no output
node    150 files · 2158 passed | 2 skipped · 249.94 s
browser 243 files · 3930 passed · 33.14 s
e2e      15 files ·   72 passed · 179.81 s
perf      1 file  ·    2 passed ·   1.90 s   (O2_PERF=1)
```

The 272 counts vitest *file-runs*, not files, because the browser project runs its share
three times over. **Run vitest by project, never by bare path** — `npx vitest run <path>`
fans out across all four projects (`node`, `browser`, `e2e`, `perf`) and exceeded ten
minutes twice on 2026-07-31 before this was understood. **Do not take a fresh reading
without checking `uptime` first**: at 12:42 that day the host was at load 213 and no
timing-sensitive result taken then would have meant anything; the reading above was taken
at load 6.6-10.5 once the competing build finished.

### v1.0 carried forward, unarchived

```
Checkboxes  v1 section    45 of 72 ticked · 27 open
            v1.1 section   9 of 10 ticked ·  1 open (WIRE-02)
            whole file    54 of 82
Markers     76 traceability rows: 48 Done · 22 Partial · 1 Built, not wired
            (MR-02) · 5 neither — AOT-03, BENCH-06, NET-03, VER-02, WIRE-02
v1.1        9 of 50 requirements closed  (numerator NOT recomputed — see below)
Historical  v1.0 closed at 112 test files / 1673 tests; 122 / 1775 on 2026-07-28
```

**Recounted on disk 2026-08-06, and every field of the previous block was stale.** It
read *"35 / 72 wired · 27 built-not-wired · 6 partial · 4 open"* and *"Whole file 40 of 82
ticked (35 in the v1 section + 5 in v1.1's)"*. Measured: **45** ticked in the v1 section,
**9** in v1.1's, **54** whole-file; and on the traceability rows, built-not-wired is down
to **1** while Partial is up to **22**. `REQUIREMENTS.md`'s own header already said
*"45 of 72 are `[x]`"* — so **the ledger was current and this summary of it was not**,
which is the same shape as the progress table that said "Not started" for seven finished
phases. A file that summarises another file needs an owner too.

**The old line merged two populations and that is why it drifted unnoticed.** *"35 / 72"*
counts **checkboxes in the v1 section**; *"27 built-not-wired · 6 partial"* counts
**markers on traceability rows**, a different set with a different denominator (76 rows
against 82 requirements — six requirements carry no row). They are split above so the next
reader cannot re-merge them.

**`v1.1 9 of 50` was deliberately NOT recomputed.** Its numerator's definition is contested
*inside this same file*: the paragraph above says the four IDs 13.1 closed are among the ten
new ones and so "do not move this numerator", while WIRE-01 — also a new ID — is counted in
it. Recomputing under a guessed definition would replace a stale number with a wrong one.
This needs the definition settled first, and that is an owner's call, not a recount.

**The 27 and the 6 moved together and the ticked counts did not.** Phase 15 took AUTH-03
off *Built, not wired* and onto **Partial** without closing it: its serving half is wired
and verified, its requestor half has zero production callers. A requirement can leave
"built, not wired" without arriving at "done", and the ledger has to be able to say so —
otherwise the only way to record progress is to overstate it.

The 27 reconciles with the audit's 36: eight have been wired since — DATA-03, DATA-04,
DATA-05, DATA-06, DATA-07 and DATA-09 in Phase 12, then DET-03 and DATA-08 in Phase 14 —
and one, AUTH-03, moved to Partial in Phase 15.
Count them from the **traceability table** rows (`^| ID |` … `**Built, not wired**`),
which is the only place that marker lives; a whole-file grep also catches the legend and
one line of prose and overcounts by two.

**Ticking a requirement is three edits, not one.** Phase 14's verification found this:
the checkbox, the traceability row's *Built, not wired* marker, and the section header's
own count all have to move together, and ticking alone leaves the ledger disagreeing with
itself. There is a fourth: `packages/node/src/acceptance-traceability.node.test.ts` pins
specific ids in specific states, and 13.1's verification broke it by closing SCHED-06
while that spot-check still asserted it open — **`develop` was red from that commit until
it was caught by an unrelated executor.** Run that file after any ledger edit.

**Two denominators, and confusing them is the trap.** REQUIREMENTS.md's own header reads
*"35 of 72 are `[x]`"* — that is the **v1 section alone** (35 ticked + 37 not = 72) and it
is correct as written, not stale. v1.1 then minted 10 further IDs in its own sections
(WIRE-01…04, SCHED-06, NET-08, NET-09, NET-10, DATA-10, BENCH-07), of which five are now
ticked: WIRE-01, plus SCHED-06, NET-08, NET-09 and NET-10 from 13.1's verification.
DATA-10 is the one 13.1 left open. So the whole-file count is **40 of 82** and neither
number contradicts the other. Recount with the section ranges, never with a whole-file grep.

**v1.1's scope is 50, not 44.** Forty existing IDs to be wired, plus those 10 new ones.
The line said 44 because it was written when only WIRE-01…04 existed; SCHED-06, NET-08,
NET-09, NET-10 and DATA-10 were minted on 2026-07-28 with Phase 13.1 and BENCH-07 with
Phase 23. **The numerator is 9:** DATA-03, DATA-04, DATA-05, DATA-06, DATA-07 and DATA-09
from the existing forty (Phase 12), DET-03 and DATA-08 (Phase 14), plus WIRE-01. The four
that 13.1's verification closed are among the 10 new IDs, not the forty, so they raise the
whole-file count without moving this numerator.

**Read `.planning/v1.0-MILESTONE-AUDIT.md` before planning.** It carries `file:line` for
every claim. v1.0 was deliberately **not archived** — its audit returned `gaps_found`,
and filing 36 unwired requirements under a completed milestone would have made the
ledger say something untrue. The phase directories for 2–10 are intact for the same
reason.

The 36 are not undone work. Sovereignty labelling, tree-reduce, discovery, enrollment,
quorum composition, capability chains and the whole churn coordinator are implemented,
exported and covered by their own specs — and nothing a person can run calls any of
them. Verified symbol by symbol: `runResilient`, `EgressGuard`, `translationCid`,
`composeQuorum`, `discoverExecutors`, `executeReduce`, `requestEnrollment`, `signName`
and `verifyChain` each appear only as their own definition, a barrel re-export, or a
prose comment.

**The structural cause is one shape, and it is v1.1's first target.** `serveAgent`
declares six optional hooks with silent defaults — `authorize`→allow, `index` and
`reservations`→empty, `capacity`→accept. `ledger` is supplied nowhere at all, in
production or in one test. A hook whose default is indistinguishable from the feature
working is why no test failed.

**One of the 36 was a live bug and is already fixed.** Static-host rendezvous answered
`[]` forever — `FabricNode.reservedPeerIds` held the right data and `serveAgent` was
never given it — with the signature `{asked: true, dialed: [], failed: []}`: nothing
attempted, nothing failed, no error. `rendezvous-wire.node.test.ts` starts three real
nodes and requires two to find each other with nothing supplied by the harness.

### Where Phase 10 landed

**The finding is the exit code.** A pipeline trusting elfconv's `0` would cache an
artifact that aborts at runtime under a name asserting it is clean. Two greps —
abort call sites and recovered addresses — must agree before the count is called
evidence, because a single grep that stopped matching would report zero and look
like good news.

**A real artifact was pointed at the executor for the first time**, and every
execution-side test before it used hand-written fixtures written from the same
understanding as the executor. The ABI held exactly: 23 WASI imports, `_start` and
`memory`, every import answered. And it turned up something fixtures could not — a
`printf("hello\n")` imports **`clock_time_get` and `poll_oneoff`**, because glibc's
stdio pulls them in whether the program asks or not. Pinning the clock is
load-bearing on the very first task anyone runs.

**The V8 code cache does not happen.** At 4.8 MB, `application/wasm`, query-free CID
URL, `compileStreaming`, hot enough to tier up: no WASM code-cache entry across three
visits, while the same profile grows a 2 MB *JavaScript* cache and a
`--v8-cache-options=none` calibration reads the identical 72B. Reported unmet rather
than reworded — a criterion that can only be reported as met is not a measurement.

**A recorded project assumption was wrong.** `CLAUDE.md` said elfconv needs
unstripped binaries. It does not: `.eh_frame` is enough, via libdwarf. Corrected in
`CLAUDE.md` and the roadmap.

**Two reviewer findings outlived the phase and were real.** A file carrying raw NUL
bytes had silently left the vocabulary guard's jurisdiction — an exemption with no
entry, which the guard's own planted violations could not detect because they scan
synthetic content rather than the tree. And `PINNED_WASI_FUNCTIONS` was checked only
for *identity*, which a replacement returning the wrong value satisfies exactly.
Both fixed; 8 mutations planted, 8 caught.

### Where Phase 9 landed

**Consent is a value, not a check.** `GrantedConsent` is minted only by
`grantConsent`, and `start` takes one as a parameter — a caller without one does not
fail a check, it fails to compile. No test-only bypass: the e2e harnesses consent
for the same reason a visitor clicks the button.

**Nothing touches the network before consent either.** Criterion 3 names CPU; the
owner's decision went further, because "we spent no cycles" is not an answer to "you
told a third party I was here". Proved by watching every request the tab makes.

**Stopping had to become real before it could be claimed.** `WasmExecutor` ran on
the main thread, where a synchronous `run()` cannot be interrupted — so "one click
drops CPU to zero" meant "zero once the current task finishes". Tasks now run in a
Worker; Stop calls `terminate()`. The probe that proves it is a bare `loop br 0`.

**A guard caught the exact trap it was written for.** Replacing `terminate()` with
a cooperative flag left every test green *except one* — the one that messages the
thread directly, past the executor, and requires silence. Rejecting the pending
promises makes a stop look instant while the thread keeps burning; resolving the
caller and killing the worker are two different acts.

**Ordering is what makes cubes worth having.** The colouring search first walled at
n = 205 and no parallelism moved it: assigning values in increasing order means a
cube fixes the *least* constrained numbers — 1 and 2 appear in no triple at all — so
cubing split the work without splitting the difficulty. Ordering by constraint
degree moves the wall with cube count: 1 cube → 300, 8 → 500, 256 → 600.

**Chromium throttles timers hard in a tab that is not in front** — measured, a
400 ms poll produced one tick per second. Anything the always-visible surface
depends on is pushed, never polled. This bit twice in one phase.

Numbers: 6 mutations planted, 6 caught. `verifyColouring` re-derives 484 triples at
n = 600 and accepts in under a millisecond, trusting no node.

### Where Phase 8 landed

**The ordering was the requirement.** `BENCHMARK-METHODOLOGY.md` went in before any
harness existed — checkable in `git log`. Three pre-registered predictions all held: the
node axis would be sub-linear (it was flat), the COST crossover would be embarrassing
(none, ~570×), and the fixture bias would dominate (it did).

**The headline caveat is what the numbers cannot show.** Every node in both curves runs
in one OS process on one event loop, so no parallel speedup is measurable at all. The
flat makespan is the consequence of that, not a finding about scaling. The scaling claim
is therefore **unmeasured** — which is neither disproved nor supported.

**The incomplete-run rule paid for itself immediately.** The first full run reported
19/19 incomplete at every memory rung rather than a suspiciously fast success: the memory
workers could not fetch shard inputs. A harness that averaged failures in would have
published a beautiful fictional curve.

**A misnamed field, caught before publication.** `JobResult.grossNodeSeconds` named a
quantity that was *bytes across the guest ABI*, not seconds — deterministic, which is
right for a cost metric, and off by a factor nobody could guess if published as time.
Renamed to `grossFuel`/`usefulFuel`; the driver measures real node-seconds itself.

**Two ladder rungs published as excluded, not dropped.** Real transport at 8 and 16 nodes
dies on `INBOUND_CONNECTION_THRESHOLD = 5` per host — the limit Phase 3 already found.
A rung that vanishes between plan and results is indistinguishable from one removed for
being inconvenient.

Numbers: connectivity tax **8–10×**; no COST crossover; decomposition native 0.002ms →
WASM in-process 0.61ms → distributed 1.3ms, so most of the gap is the ABI on a trivial
fixture rather than the fabric.

### Where Phase 7 landed

A job survives its machines — and its submitter — vanishing mid-flight. A lease is a
deadline, not a lock, so "never orphaned leases" needs no cleanup code and resume is the
same path as start. Then an adversarial review found five defects and refuted none, the
worst being that speculation could change the answer: breaking on the first arrival meant
a losing copy was never compared, so timing alone could pick between two different CIDs.
The test guarding it was vacuous. All fixed and mutation-tested.

### Where Phase 3 stands

Two browser tabs, and separately an iPhone running Safari and a laptop running Chromium,
complete a 4-shard 2×-redundant job over a **direct WebRTC** connection with the relay
carrying only SDP. Remaining: real AutoTLS, which needs a publicly reachable host.

## Performance Metrics

**This section is a partial record and must not be read as a velocity figure.** The
per-plan rows below are appended by the executor, and only 8 of the 17 executed plans
ever got one: Phase 13's plans 04-07 and all five of Phase 13.1's are missing. The
template header that used to sit here read *"Total plans completed: 0"* directly above
eight rows of real data, with the By-Phase table left as placeholder dashes — replaced
2026-07-31 with what the rows actually say.

**Logged: 8 plans, 247 min, 4.1 hours, mean 31 min/plan.** The mean is not meaningful —
the spread is 7 min to 100 min, and this project's own benchmark methodology records
that straggler-dominated distributions have meaningless means.

| Phase | Plans logged | Total | Median | Range |
|-------|--------------|-------|--------|-------|
| 11 | 1 of 1 | 13min | 13min | — |
| 12 | 4 of 4 | 190min | 35min | 20-100min |
| 13 | 3 of 7 | 44min | 12min | 7-25min |
| 13.1 | 0 of 5 | — | — | — |

*Rows appended after each plan completion:*

| Phase 11 P01 | 13min | 3 tasks | 13 files |
| Phase 12 P01 | 25min | 2 tasks | 17 files |
| Phase 12 P02 | 20min | 2 tasks | 4 files |
| Phase 12 P04 | 100min | 2 tasks | 8 files |
| Phase 12 P03 | 45min | 1 tasks | 2 files |
| Phase 13 P01 | 12min | 2 tasks | 5 files |
| Phase 13 P02 | 7min | 2 tasks | 2 files |
| Phase 13 P03 | 25min | 2 tasks | 1 files |
| Phase 18 P03 | 25min | 2 tasks | 5 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Verification compares the SAME module run on two nodes, byte for byte. Not multiple implementations of the same computation — cross-implementation verification is explicitly out of scope.
- There is no static determinism analysis. Divergence is detected by the comparison, not predicted ahead of it. The admission gate was built and then deleted; do not reintroduce it. The import object is the sandbox — WebAssembly.instantiate refuses any import the host does not supply.
- The verification claim is split (C3, decided): redundant execution on public/shared data and on the aggregation tree; sovereign maps run redundantly within the owner's own node set when two or more are live, and are owner-attested otherwise.
- Relay decision inverted by evidence: own backbone relay primary (AutoTLS + webRTCDirect), public infra opportunistic only. Browsers structurally cannot dial the majority of public libp2p nodes.
- Ordering is load-bearing: sovereignty before placement, tree-reduce before placement, artifact signing at content-addressing time (not at elfconv time), coordinator checkpointing in the churn phase, governor + benchmark instrumentation in the kernel phase.
- **A remote executor is just an `Executor` (Phase 2).** `submitJob` takes `Executor[]` and cannot tell where one runs, so the network arrived without a kernel change. Any future "distributed" feature should first be checked against this: if it can be an adapter behind an existing port, it must be.
- **Packages split on the portability line, not the feature line (Phase 2).** `@o2/net` is portable and its tests run in Node *and* Chromium; `@o2/node` holds everything a browser cannot do. `purity.node.test.ts` enforces it — no `node:`/`libp2p`/`@chainsafe` import may appear in a portable package.
- **`Transport` stays a one-way datagram port (Phase 2).** Request/response correlation lives in `@o2/net` instead, because a datagram shape is the smallest thing an in-process table, a libp2p stream, and a relayed WebRTC channel can all implement.
- **All nodes have equal functionality (owner decision, 2026-07-26, restated twice).**
  There is no tier, no class, no lesser node. Every node executes tasks, holds blocks,
  serves records, hosts reduce combines, and takes quorum slots on identical terms.
  **The only difference is discovery**: a browser cannot bind a listening socket, so it
  cannot act as a seed a newcomer dials cold — it must be found through a relay that
  can. That is narrower than "reachability", which was the previous wording and was
  still wrong: once connected, the peers are indistinguishable. Proven in Phase 3, where
  an iPhone was dialled at its `/p2p-circuit/webrtc` address and ran half of a
  2×-redundant job. "Client-mode-only DHT" and "browsers are leaves" were inherited
  assumptions, both reversed. Background-tab throttling is a lease-duration problem, not
  a capability one. **If a decision keys on node kind, it is wrong** — the only
  legitimate use is shared-dependency analysis over the discovery graph.

- **Liveness changes who computes and when, never what the answer is (Phase 7).** The
  invariant every churn mechanism rests on. True because a result is a pure function of
  (module, input, partition) and content-addressed, so a re-dispatch recomputes
  byte-identical output and every recovery action is at worst wasted work. Re-check this
  first if any of the churn code changes.

- **A lease is a deadline, not a lock (Phase 7).** Nobody releases it and no keeper
  notices the coordinator left, so "never orphaned leases" needs no cleanup code. A lock
  would have required the holder-liveness protocol the deadline replaces.

- **A node failure and a task failure warrant opposite policies (Phase 7).** Collapsing
  both into `null` makes the 30%-node-loss criterion unachievable — three unlucky dead
  picks retire a good shard. Node failures retry until the pool is exhausted; task
  failures stop after three independent nodes fail the same work.

- **Re-dispatch must exclude tried nodes before placement (Phase 7).** Placement is
  deterministic by design, so a retry otherwise re-derives the identical dead choice.
  Narrowing the input is safe — the sovereignty gate still runs inside `placeWithOffers`.

- **Pre-registration is an ordering, not a document (Phase 8).** The methodology commit
  contains no harness and no number, so `git log` proves the analysis was not chosen
  after seeing the data. Predicting the disappointing results in advance is what stops
  a flat curve being spun as a surprise.

- **A fast failure is not a fast run (Phase 8).** Excluding incomplete runs from
  makespan statistics is what turned a silent 19/19 failure into a visible bug instead
  of a beautiful fictional curve.

- **A unit in a field name is a claim (Phase 8).** `grossNodeSeconds` held bytes. The
  ratio was fine, the absolute number would have been published wrong by a factor
  nobody could guess. Rename rather than document — a comment does not travel with the
  number into a report.

- **Publish excluded configurations with the reason (Phase 8).** A rung that vanishes
  between the plan and the results is indistinguishable, to a reader, from one removed
  because its number was inconvenient.

- **A fake that is faster than the real thing cannot see a timing bug (Phase 7).** The
  worst two churn defects — a hang, and a losing copy never compared — were both
  invisible to a suite whose dispatch resolved on a microtask. The integration test with
  real RPC found the OOM spin; the rest needed code read specifically for what the tests
  could not reach.

- **Speculation must not become a vote (Phase 7).** Returning the first arrival and
  discarding the other copy unexamined lets timing choose between two different answers.
  The winner may return immediately, but the loser has to be *compared* — after every
  shard settles, which costs nothing — and a copy that never answers is `uncompared`,
  never "agreed".

- **A documented bound is not an enforced one (Phase 7).** The coordinator's header
  promised silence gets a bounded wait while the code never read `expiresAt`. Grep for
  the mechanism whenever a comment states a guarantee.

- **Never race a timer that provably cannot act (Phase 7).** The straggler watchdog
  re-wrapped every pending promise per iteration and kept polling after speculation
  became impossible; against real I/O that is unbounded allocation, not a slow loop.
  Fake-dispatch tests cannot show this class of bug.

- **Discovery is an intersection, and each part is worthless alone (Phase 6).** Who
  holds the block, who the node is, and what it can run come from three independent
  sources — content routing, a provider-signed certificate, a node-signed capability
  record. The self-signed record looks like theatre until you see what it is bolted to;
  a test mints a valid one for an uncertified key and shows it buys nothing. Splitting
  it lets a node re-sign locally when its engine changes.

- **Every exclusion is named (Phase 6).** Silent filtering leaves a requestor unable to
  tell a dead network from a wrong clock from a module nobody can run.

- **The power-of-d sample is derived, not drawn (Phase 6).** Rendezvous ranking on the
  shard id instead of `random()`: same load result, but two requestors racing on one
  shard converge, re-placement re-derives the same candidates, the tail is already the
  re-pick list, and a decision can be replayed from its inputs.

- **Load is a hint; the offer is the authority (Phase 6).** `LocalCapacity` takes no
  ports and makes no calls, so "local information only" is a property of the type. A
  refusal is not an error path — it is how a stale guess becomes a correct decision.

- **A probe needs its own deadline (Phase 6).** An unreachable node cost a full RPC
  timeout before the re-pick, destroying the saving power-of-d exists to buy. Offers
  carry a 2s deadline and silence is a *stated* refusal. Only the wired-up test could
  find this — a unit test's admission callback returns immediately.

- **Attestation strength is derived, never declared (Phase 6).** owner-attested /
  owner-domain / independent, computed from certificates. Owner-domain and independent
  both show two replicas, so the count cannot distinguish them and the label must travel
  with the result.

- **Derive topology, never agree on it (Phase 5).** The reduce tree is a pure function
  of sorted partial CIDs, so every participant computes the same one with zero
  messages — no leader election, no consensus, nothing to lose. Assignment is HRW, and
  the ranking *is* the fallback list. Repair is recompute from CIDs, not state
  transfer; a late duplicate dedupes into nothing.

- **Associativity is the reduce contract; commutativity is not (Phase 5).** An earlier
  comment claimed both were required and justified it wrongly — a probe showed an
  order-dependent reducer breaks nothing, because grouping is canonical. The
  bit-identical single-node reference test is what enforces associativity.

- **Sovereignty is structural, never a preference (Phase 4).** `planPlacement` narrows
  to the owner's nodes *before* load is consulted; there is no branch that widens it.
  A sovereign shard with nowhere to run stalls. Verified by adding the forbidden
  relax-under-pressure branch and watching four tests fail.

- **Authorisation runs before execution, and the test proves the ordering (Phase 4).**
  A node that executes and *then* refuses has already read the data, so the test
  asserts the executor was never called, not merely that the reply said "unauthorized".

- **Integrity is not provenance (Phase 4).** A CID proves bytes match a hash; it says
  nothing about who published them. Nothing executes a bare CID — names resolve through
  signed records from anchors pinned at construction, and the resolver has no method to
  learn a new one.

- **A blockstore adapter must not alias its input or its storage (Phase 3).** Found
  by the conformance suite in `MemoryBlockstore`; the persistent adapters copy, so an
  aliasing in-memory adapter made kernel tests pass on semantics no real backend has.

- **Conformance vectors are hardcoded literals, never computed (Phase 3).** A
  computed expectation only proves an implementation agrees with itself.

- **The kernel must never need `crypto.subtle` (Phase 3).** A LAN origin
  (`http://10.144.82.249:5173`, `http://laptop.local:5173`) is *not* a secure context,
  so WebCrypto is absent. `multiformats/hashes/sha2` uses it, which silently broke every
  CID on any non-localhost page — while the node still *started*, so it failed at the
  first block rather than at join. Hashing is now `@noble/hashes`, pure JS. The
  import-scanning purity tests cannot catch this class of bug; a dedicated browser test
  removes `crypto.subtle` and requires the hashing path to survive.

- **A browser cannot do mDNS (Phase 3).** No API, any browser. LAN discovery is
  therefore: one URL (preferably the machine's existing `.local` Bonjour name, which
  iOS resolves natively and which survives DHCP churn), after which the page fetches
  `/bootstrap.json` from *its own origin* and is told to dial the same host it already
  reached. Nothing hardcoded, nothing guessed from network interfaces.

- **A relay's browser capacity is capped by inbound limits, not reservations (Phase 3).**
  `INBOUND_CONNECTION_THRESHOLD` is 5 **per host** and
  `MAX_INCOMING_PENDING_CONNECTIONS` is 10 — both below the 15 reservation default.
  Per-host matters in production too: every volunteer behind one NAT shares the budget.
  Exceeding either kills the noise handshake and looks like a network fault.

- **A duty cycle must serialize to mean anything (Phase 3).** Shards dispatch
  concurrently, so per-task yielding lets every yield resolve at once and the cap is
  bypassed. `GovernedExecutor` serializes while throttled, and only while throttled.

- **A relayed circuit cannot carry a job (Phase 3).** The relay is a signalling
  channel; the data path is WebRTC. A test that runs a job over `/p2p-circuit` is
  testing an unsupported configuration.

- **Packages form three tiers (Phase 3).** `core`/`net` portable — no platform *and no
  libp2p*; `libp2p`/`browser` dual-target — libp2p but no `node:`; `node` anything.
  Enforced by `purity.node.test.ts`.

- **Wire framing is uniform across transports (Phase 2).** One stream per message, completion signalled by the sender closing its write end — so no length prefix and no framing state machine. Chunked at 16 KiB with `runOnLimitedConnection: true` even on TCP, so the same path survives relaying in Phase 3.
- Part I (elfconv AOT) sequenced last and run as a parallel track; it must not block the capacity-scaling thesis.

- **Consent is a value, not a check (Phase 9).** `GrantedConsent` is minted only by
  `grantConsent` and `start` takes one, so "check consent before starting" is not a
  rule anyone has to remember. The obvious `if (hasConsent())` is exactly the shape
  that has failed twice here — a documented bound nothing enforced.

- **A stop that resolves the caller is not a stop (Phase 9).** Rejecting pending
  promises makes termination look instant while the thread keeps burning. Only a
  test that messages the thread directly, past the executor, can tell them apart.

- **Cooperative stopping cannot exist for WASM (Phase 9).** A synchronous `run()`
  admits no flag, no duty cycle and no governor. Off-main-thread execution is not an
  optimisation here, it is the requirement.

- **A metric must publish its own blind spot (Phase 9).** A node that cannot reach a
  peer cannot report that it cannot reach a peer, so the reported population is never
  the visited one — and that gap *is* the cliff being measured.

- **Overlapping views are merged by maximum, never by sum (Phase 9).** Asking eight
  peers for the same population and adding would multiply every sample size by eight
  while leaving the percentages unchanged: a correct-looking rate over a fictional n.

- **Chromium throttles timers in a background tab (Phase 9).** Measured: 400 ms poll,
  one tick per second. Anything a visible surface depends on must be pushed.

- **A cube must fix the *constrained* variables (Phase 9).** Splitting on the first k
  values split the work without splitting the difficulty, because the lowest values
  are the least constrained. Ordering by constraint degree is what makes more nodes
  reach further rather than merely reach faster.

- **`exhausted` and `budget` must stay different answers (Phase 9).** One is a proof,
  the other is a shortage of compute. Conflating them turns a limit into a false
  mathematical claim.

- **"Was not run" is not "works" (Phase 9).** DEMO-01's multi-machine half was about
  to be closed by reasoning from Phase 3's transport proof. Running it found two
  real defects instead — one of which every multi-tab test had structurally been
  unable to catch, because they all dial from the harness.

- **Assert what is on screen, not what the attribute says (Phase 9).** An id rule
  setting `display` outranks the browser's own `[hidden]`, so `getAttribute` was
  right while the element was visible. `isVisible`, always.

- [Phase 11]: A hook's absence is a value the call site writes (named sentinel literal), never an omission the type system tolerates — same shape as Phase 9's GrantedConsent. — AgentOptions's six hooks moved from optional to required unions with sentinel literals, closing the hole where an omitted hook silently defaulted to allow/empty/accept and made no fact recordable.
- [Phase 12]: not-enough-executors retired; a shard below requested redundancy is placed at what is available and marked degraded on ShardResult/JobResult instead of failing the whole job
- [Phase 12]: submitJob's placement now runs entirely through sovereignty.ts's planPlacement/eligibleNodes, correlating Executor to NodeDescriptor by nodeId; no other code path in submit.ts selects a node
- [Phase 12]: guardSovereignty is a pure Executor adapter (no Executor/AgentOptions port change), mirroring GovernedExecutor's shape
- [Phase 12]: Added a DATA-09 replica-holder test beyond the plan's four (Rule 2): a canExecuteSovereign:false node whose data genuinely exists in the shared blockstore is still excluded from execution, proving the refusal is about clearance, not missing data
- [Phase 12]: parseRequest refuses an exec request with no label; Task.label stays optional in-process, only the wire boundary enforces it — Correction 2: an absent label reaching guardSovereignty is a no-op, trusting whoever dispatched the task not to omit the field the refusal depends on
- [Phase 12]: guardSovereignty wired into both fabric-node.ts and browser-node.ts production constructors, defaulting to cleared-for-nobody — Correction 1: guardSovereignty had zero production callers before this plan, the exact built-not-wired shape the v1.0 audit exists to catch
- [Phase 12]: Plan 12-03 (skipped by the orchestrator in Wave 2/3) closes the exact gap the Phase 12 verification pass found: submitJob's sovereignty-pinned placement is now proven across three real bin/agent.ts operating-system processes, not only in-process. bin/agent.ts gained --owner-id/--can-execute-sovereign CLI flags (a pass-through of the existing FabricNodeOptions.sovereignty option) so a spawned process can be cleared for its own owner; the required widen-under-pressure mutation failed as expected (insufficient, not agreed) and revealed a second, independent defense already holding: the mutated process's own guardSovereignty wrap refused the wrongly-widened dispatch.
- [Phase 13]: registerSovereignInputs composed outside guardSovereignty, not inside — registering a task guardSovereignty is about to refuse is harmless, keeps composition order identical at both Plan 13-02 call sites
- [Phase 13]: submitJobWithEgress delta-slices EgressGuard.manifest.entries before/after submitJob rather than calling reset(), so job-scoped manifests compose with concurrent reads instead of discarding shared history
- [Phase 13]: egress is a new field on FabricNode/BrowserNode, not a type change to transport — EgressGuard lacks .stop()/.peers that existing callers (including packages/browser/demo/main.ts) depend on
- [Phase 13]: Both node factories now compose registerSovereignInputs(guardSovereignty(inner, sovereignty), {blockstore: store, guard: egress}) identically — the sovereignty default is resolved exactly once per start() call, feeding both the guard's ownerId and the clearance check
- [Phase 13]: Sovereign test fixtures must be pre-seeded onto the executing node's local-only store before dispatch, not just onto the requestor's store -- registerSovereignInputs reads only the local tier and silently skips registration otherwise, which would make a falsification test pass vacuously
- [Phase 13]: Mutation 2 (removing the EgressGuard transport wrap) breaks all four production-wiring tests, not only the one the plan named -- reported as observed rather than narrowed to fit the plan's prediction

- **[Phase 13.1] A reservation with no release is a leak, so the reservation moved to the
  branch that has one.** `LocalCapacity.offer` reserved a slot that nothing on the wire ever
  redeemed — a liveness probe would have leaked one slot per peer per call — so the `offer`
  branch became `LocalCapacity.would`, which reserves nothing, and the slot is now taken in
  the `exec` branch before the `try` and released in a `finally` that covers success, a
  failed outcome, a throw, and the `authorize` refusal that never calls the executor at all.
- **[Phase 13.1] That deliberately removed cross-shard over-commit protection, and it is
  Phase 18's to rebuild.** `placeWithOffers` rebuilds `pool` per request, so the reserving
  offer branch was the only thing bounding placement *across* shards. `planWithOffers` +
  `rpcAdmission` will now put all N shards of a job on one node with `maxConcurrent: 1`.
  `packages/net/src/discovery.test.ts` pins this as a recorded consequence — four shards on
  one 1-slot node, zero refusals — and **that test is expected to turn red when Phase 18
  closes criterion 2c.** Do not "fix" it before then. The two candidate mechanisms, both
  protocol changes, are in `agent.ts`'s own comment.
- **[Phase 13.1] A cap applied after the loop has already paid for the allocation it
  exists to prevent.** `readMessage` accumulated every peer-sent chunk and then allocated
  their sum, both peer-driven and neither bounded; the check now sits *inside* the
  `for await`, immediately after the byte count grows, and calls `stream.abort()`. That
  placement is the whole content of NET-08 — a 64 MiB frame was accepted over the real
  transport before it.
- **[Phase 13.1] `'sender'` is a third `DispatchOutcome.kind`, because a connection the
  sender tore down is not a failure of the receiver.** Produced only from a
  `SendRefused`; `coordinator.ts`'s single policy read is unchanged and its fall-through
  carries a comment saying it is a decision rather than an omission.
- **[Phase 13.1] A pre-scan is the same check, earlier — not a weaker one.** `EgressGuard`
  gained `violationIn(frame)` (pure query, records nothing) and `refuse(to, frame)`
  (records on a hit only). Scanning a reply *body* suffices because `contains` is a
  contiguous-run search and dag-cbor encodes a byte string as a header plus raw bytes, so
  the payload is the same contiguous run once nested. `refuse` records only on a hit
  because it may be asked about a frame never offered to the exit; recording clean answers
  would count every reply twice.
- **[Phase 13.1] The pre-change capture was planted, watched, and restored by `cp` with
  `cmp` exit 0 — no `git` write command.** The proof the restore was byte-exact is that
  `git status --porcelain` afterwards listed only the new untracked test file. Worth
  copying: on a shared working tree a `git checkout --` to "restore" is how another
  session's work gets destroyed.
- **[Phase 13.1 — CORRECTED 2026-08-01] The hook is `AgentOptions.capacity`; `admission`
  is the instrument.** This line used to read *"the hook is named `admission`, not
  `capacity`"* and that is wrong — `agent.ts:171` declares
  `readonly capacity: LocalCapacity | 'accepts-every-offer'`, and `admission` is the
  local holding what `capacity.offer()` returns, plus `FabricNode.admission` as the
  high-water instrument. `fabric-node.ts:365` explains why the two names differ.
  **A second error rode along with it:** `LocalCapacity.offer` *does* reserve
  (`placement.ts:372-378`). What reserves nothing is `serveAgent`'s **`offer` request
  branch**, via `would`. Both errors were propagated into a Phase 16 executor's brief
  verbatim; following them literally would have renamed the wrong symbol. A note that
  compresses two names into one sentence is how that happens.

- **[Phase 14] A guard wrapped at every construction site, not at one resolution point.**
  The plan opened by correcting its own earlier draft: **three** `Executor` implementations
  independently turn `task.moduleCid` into bytes — `core/src/executor/wasm.ts`,
  `browser/src/worker-executor.ts` and `aot/src/wasi-executor.ts` — so "one resolution
  point" was false and the guarantee `guardModuleProvenance` carries is composition at
  every site instead.
- **[Phase 14] A census that counts call sites cannot tell a composed guard from a
  decorative one.** Deleting `provenance(...)` from `browser-node.ts` turns two tab
  refusals red while `trust-anchors.node.test.ts` stays **20/20**, because
  `guardModuleProvenance(` is still textually present, just applied to nothing. Recorded
  as M28. This is the same shape as the disclosure gate's pattern that matched nothing and
  read green — a text census answers "is it mentioned", never "is it wired".
- **[Phase 14] `trustAnchors` is required and typed `readonly PublicKeyHex[] |
  'runs-unsigned-artifacts'`**, on both `FabricNodeOptions` and `BrowserNodeOptions` —
  Phase 11's sentinel convention. `TabApi` deliberately exposes **no opt-out at all**:
  there is no value a page or a Playwright harness can pass through `window.o2` that
  yields a tab resolving bare CIDs. All 22 uses of the opt-out are inside `*.test.ts`;
  `bin/agent.ts` has no off-switch.
- **[Phase 14] "Built, not wired" has a measurable signature, and it was measured in both
  directions.** Before the phase, emptying both demo trust-anchor sets changed nothing
  across fifteen e2e tests. After it, the same plant takes the colouring job down.
  Recorded as M29 — the one ledger entry that pins a *change* rather than a guard.
- **[Phase 14] A `not.toContain` never observed as a `toContain` is a silence, not a
  reading.** Criterion 2's "before `WebAssembly.instantiate`" rests on two instruments —
  an in-process call counter and a cross-process blockstore-directory census — and the
  verification required each to have been seen taking **both** values. The cross-process
  one is upstream of instantiation: the block never reached the agent's disk.
- **[Phase 14] Corrections do not propagate between sibling plans.** 14-03 corrected six
  wrong `file:line` facts in its own plan; 14-05's plan, written earlier, then restated
  one of those same corrections verbatim. A correction living in a SUMMARY reaches nobody.
  Feed each wave the prior wave's corrections explicitly, and verify every citation before
  relying on it.

- **[Phase 15] Plan citations drift far worse than anyone assumed: 41 wrong `file:line`
  references across four plans** (6, 9, 14, 12). These plans were written weeks before
  they ran. Two were wrong rather than merely stale, and both would have shipped a false
  statement into source: `purity.node.test.ts:167-174` does **not** keep the `Executor`
  port narrow (it is the "no dependency edge from `@o2/core` to any adapter" test, and the
  string `Executor` appears nowhere in it), and **no test in this repository asserts the
  `Executor` port carries no chain**. Assume every citation in an unexecuted plan is stale.
- **[Phase 15] A wave field can lie where `depends_on` cannot.** Phase 15's four plans all
  declared `wave: 1`, which would have launched four agents into a chain where 15-03 needs
  01 and 02 and 15-04 needs all three. Derive waves from `depends_on` and from
  `files_modified` overlap, never from the `wave` field alone — 15-01 and 15-02 also both
  write `packages/net/src/index.ts`.
- **[Phase 15] "It cannot be tested" survived four plans and was false.** Every plan
  repeated that `BrowserNode.start` "needs a real `indexedDB` and a relay to dial, so it
  runs in neither vitest project", and the browser tier's authorizer went unproven because
  of it — a scrambling mutation left 345 browser tests green. The true statement is
  narrower: the **`browser`** project cannot host it, because a Circuit Relay v2 server
  cannot run inside a browser; the **`e2e`** project can, and `two-tabs.e2e.test.ts`
  already did. 15-05 closed it there, and needed no relay at all — a relay exists to let
  two browsers exchange SDP, and there is one browser in that test. **Six shipped comments
  carried the false claim, one of them sitting directly on the authorize hook.**
- **[Phase 15] A refusal that names the wrong thing is a defect even when the job
  correctly fails.** M30's mutated tab still refuses — at a different precedence step,
  naming the owner *key* where the owner *id* belongs. Any assertion of the form "the job
  failed" passes against it. Assert the refusal **text**. The same trap caught 15-03: a
  node with no `sovereignty` option resolves to `ownerId: ''` and falls through to a
  different `unauthorized` refusal naming the same peer.
- **[Phase 16] A fabric cheaper than the real thing cannot observe a gate keyed on the
  real thing's configuration.** `agent.ts` refused every combine on any node holding a
  real `Authorizer`, and both node classes install one — so combine never worked in
  production, from the moment the branch was written. Plan 16-02 could not see it because
  every in-process fabric it tested builds `serveAgent({...SENTINELS})`, and the sentinel
  is exactly what the branch keyed on. **Two plans hit it independently** (16-03 from
  spawned processes, 16-04 from the benchmark) and **neither took the cheap way through**:
  16-03 refused to change an auth path outside its scope, 16-04 refused to pass the
  sentinel to `FabricNode` to make a benchmark row appear. Sibling of the Phase 15 lesson
  and a stronger form of it.
- **[Phase 16] The gate's premise was true when written and one phase later was not.**
  Its comment read *"Every production call site passes the sentinel today, so this is a
  no-op now."* Phase 15 installed real authorizers and falsified it silently. **A comment
  asserting a fact about every call site is a claim with an expiry date**; if it matters,
  a test must hold it, because nothing else will notice when it stops being true.
- **[Phase 16] Routing combine through the `Authorizer` made a security property worse,
  and that was measured rather than argued.** The old refusal had incidentally bounded
  combine fetches to zero on any real node. Removing it widened the residue to every
  node — and `authorizeCapability` admits every combine, because the frame carries no
  sovereignty label and no node exposes an `authorize` option. Owner ruling: bound it at
  the `capacity` hook, because combine partials are outputs of public map tasks and
  therefore public by construction — **there is nothing to authorize; the exposure is CPU
  and transfer, which is a capacity question.** Closed in 16-06.
- **[Phase 16] The read count, not the reason string, is what proves a bound's placement.**
  16-06 planted its cap *below* the fetch loop: both refusal-text assertions stayed green
  while reads went 0 → 2. The reply is byte-identical in both placements. Same shape as
  NET-08 — *a cap applied after a loop has already paid for the allocation it prevents.*
- **[Phase 16] A mutation entry can be caught in substance and still be wrong.** The full
  run found `M2b` catching its defect while its recorded signature says *"four sentinels"*
  where the test says *"three"* — drifted in Phase 15 and unnoticed since. The cheap guard
  checks that `find` still matches; it does not check that `signature` still does.
- **[Phase 15] Naming a defect is not fixing it (owner ruling, 2026-07-31).** Plan 15-04
  amended Phase 15's goal down to the truth — correct — and then proposed accepting
  AUTH-03's requestor half as entry-point-unreachable. Declined. Recording a built-not-wired
  adapter in three places is not the same as wiring it; it went to Phase 23 criterion 5,
  where `bin/bench.ts` is already being rewritten and the most contended file in the
  repository is fought once rather than twice.

### Pending Todos

**⚠ OPEN DEFECT NEEDING A DECISION — `PeerVerifier` settles a verdict once and never
revisits it (found by 17-06, 2026-08-01, deliberately not fixed).**

`PeerVerifier` decides a peer's verdict on `peer:connect` and never asks again. **So a node
that enrols *after* a peer has already connected to it is permanently excluded by that
peer.** Observed directly, not inferred: an enrolled tab holding a valid certificate sat at
`'not asked yet'` for 20 s. It is **not browser-specific** — `FabricNode` also dials its
provider before `serveAgent` is up, so the same window exists on the Node tier.

Held under Rule 4 because every candidate fix changes how often a node re-asks its peers
across the whole fabric — re-ask on a timer, re-ask on a records-changed push, or re-ask on
first refusal. That is a fabric-wide behaviour decision, not a bug fix, and it interacts
with Phase 18's discovery work. **Decide before Phase 18 plans, because 18 owns the dial
path this defect lives on.**

**Also from 17-06, and it corrects 17-04:** `PeerVerifier` should **not** move to
`@o2/libp2p`. 17-04's portability half was right (no Node-only imports) and its
"one-file fix" half was wrong — `@o2/libp2p` does not depend on `@o2/net`, which
`PeerVerifier` imports four symbols from, so it is six files. Left in place for the stronger
reason: no browser consumer exists, and **an export with no traced call path is exactly what
Phase 22's guard fails on.**

**Scheduled work carried out of 13.1's and 14's verifications (2026-07-31):**

- **DATA-10's at-rest half — owner-scheduled, not deferred.** A node still serves a raw
  sovereign block once the job that registered it has ended: `submit-with-egress.ts:155`
  takes the registration and a `finally` releases it. Close it at a boundary the node owns
  — a per-node set of sovereign CIDs that outlives the job — rather than at one entry
  point. The second half, that bare `submitJob` registers nothing at all, folds into
  **Phase 20**, where `submitJob` becomes the single job path and the fix lands at one
  boundary instead of two. `sovereignty-placement.node.test.ts` currently drives a real
  spawned-agent sovereign scenario through bare `submitJob` and **passes because the gap
  is real**.
- **Two load-sensitive bounds, same family.** `churn.test.ts`'s 30%-killed case failed once
  at load 17.5-59.4 and passed 3/3 in isolation; `transport-bounds.node.test.ts`'s
  retained-bytes bound failed twice at load ~12.4 and passed at 8.72 and 7.70. Both are
  wall-clock bounds inside otherwise deterministic tests — a bound that reads host
  contention as a defect. Recorded in `phase-14-.../deferred-items.md`.
- **Closed on 2026-07-31, listed so it is not re-found:** the `stopAgent` hookTimeout
  inversion in `two-process`, `sovereignty-placement` and `egress-refusal` — a 10 s
  SIGKILL fallback inside Vitest's 10 s default `hookTimeout`, so the fallback could never
  fire and a wedged agent reported an anonymous timeout naming no step.

**Two open owner decisions**, both deferred with the measurement they were waiting for now
in hand.

1. **The `lift.node.test.ts` integration timeout.** `INTEGRATION_TIMEOUT_MS` is 15 min and
   wraps 45 min of internal budget (a 5 min compile plus 2 × 20 min `DEFAULT_TIMEOUT_MS`) —
   the outer clock is the smaller one, so the inner budgets can never fire. A real lift is
   now measured at **152.7-304.3 s**, a 2× swing with load, so any fixed budget must be
   sized against the top of that range and not the middle. An earlier attempt to set it to
   300 s turned six tests red and was reverted.
2. **The benchmark's row-order confound.** Load drifted 29→49 during a run, so no
   inter-row difference under ~20% is claimed. Fixing it needs interleaved rows rather
   than blocks, or a quiet host.

Four smaller follow-ups recorded during the 22-bug round, none load-bearing:
`SpeculationLedger.discarded` has zero readers; `submit.test.ts:79-206` duplicates
`verify.test.ts`; the `agreed` outcome carries no `failures` field; and
`classifyStartFailure` can only ever return `other` for an unreachable relay.

### Blockers/Concerns

**Three items are owner-blocked and unaffected by the 2026-07-28 testing-standard ruling:**
the US provisional patent deadline (below), a hosted relay with real AutoTLS (NET-03,
Phase 3 criterion 2), and GitHub Pages serving the pre-Phase-9 bundle (below). *"A second
machine"* used to be a fourth. It is not a blocker any more — it has been struck, and its
residual is recorded immediately below rather than dropped.

- **What the lifted-vs-native benchmark costs Phase 21 (measured 2026-07-31).** Timing
  `wasi.start()` alone, on a 32 MiB memory-and-ALU workload that all three routes agree on
  (checksum `9584708361817009923`): native 58.78 ms, direct-compiled WASM 65.19 ms (1.11×),
  elfconv-lifted WASM 122.81 ms (**2.09×** native, 1.88× direct). That is the emulation
  tax, and it is the honest number to plan AOT-04 against.
- **The ~43 ms startup floor cannot be cached away, and this was tested rather than
  assumed.** On a trivial subject the lifted `_start` alone is 42.83 ms and
  instantiate+start is 42.65 ms — indistinguishable, so the entire floor executes *inside*
  the guest, in elfconv's emulated machine-state init, and is re-paid per task. Compile
  (~4 ms, and V8 compiles lazily) and instantiate (~1.8 ms) are not where it lives. Direct
  WASM's `_start` for the same program is 0.03 ms, ~1400× less. Content addressing fully
  solves distributing the 5.40 MiB artifact — which is 5.40 MiB whether the program does
  nothing or 128 MiB of traffic — but the floor stays, and under N-version execution it is
  paid per replica, which puts a floor on useful shard size. AOT-05 independently recorded
  V8's WASM code cache as NOT OBSERVED, so that route is closed twice over.

- **Residual of the same-machine testing standard (owner ruling, 2026-07-28) — recorded,
  not blocking.** Same machine, different browsers and/or different browser contexts and
  different OS processes, is the project's testing standard everywhere. So no criterion of
  this project's own is waiting on a second machine. The residual is that
  **cross-machine reproducibility (AOT-03) and distinct-machine benchmarking (BENCH-06)
  are unverified by choice**, and closing either would need hardware the project does not
  have. Both requirements were rewritten to what one host genuinely establishes; **neither
  descoped half may be reported as demonstrated.** `CROSS_MACHINE_BLIND_SPOT` stays on
  every lifted artifact — Phase 10 showed it is structural, not configurational — and the
  same-machine benchmark label stays required and derived from the recorded inventory.

- **Relay hosting investigated 2026-07-28 — Cloudflare cannot carry the relay, and the reason
  is structural.** Confirmed verbatim from Cloudflare's docs: *"it is not possible to make an
  inbound TCP connection to your Worker"*, and no Cloudflare compute product exposes UDP (which
  independently rules out WebRTC-Direct). The codebase already refuses the deployment on its own
  terms — `canRelay` (`fabric-node.ts:289`) is false without a non-circuit listen address, so
  `circuitRelayServer()` is never added and the reservation limit is 0.
  - **Correction to the first pass, which was wrong:** Cloudflare **Containers** are *not* ruled
    out by transport. A container is a real Linux process on a real port and
    `@libp2p/websockets`' Node listener runs unmodified; the `browser`-condition stub that kills
    workerd does not apply. Containers fail on **lifecycle** instead — no minimum uptime
    guarantee and irregular restarts against a 2-hour reservation TTL (`constants.ts:68`), and a
    relay can never re-dial a browser to recover. Cost was also wrong in both directions: wall-
    minutes are not vCPU-minutes (a `lite` instance is 1/16 vCPU), and the Durable Object figure
    double-counted — 331,776 GB-s is *inside* the 400,000 included, so ~$0 marginal duration.
  - **Recommendation:** a small always-on host with a public IP and arbitrary port binding.
    **But the sizing must carry a full node, not a relay daemon** — `fabric-node.ts:394-396`
    records that no construction path yields a node which will not compute, and `bin/seed.ts:45`
    says the seed executes tasks, serves blocks *and* relays. A relay-only budget reintroduces
    the class that was deleted, which the module comment notes already *"survived three rounds
    of renaming."*
  - **Two defects found incidentally, both fixed 2026-07-28.** The disclosure gate's wrangler
    pattern missed `wrangler pages deploy` — the command someone would actually type — and
    nothing noticed because every test asserted *absence*, so a pattern matching nothing read
    green. Each pattern now carries the commands it must catch and must ignore, asserted
    directly. Separately: `stun:stun.cloudflare.com:3478` is **already** in `@libp2p/webrtc`'s
    `DEFAULT_ICE_SERVERS` and in use, so "add Cloudflare STUN" is a no-op — and pinning to it
    alone would cut four independent STUN operators to one.
  - **Unverified, worth chasing upstream:** `@libp2p/circuit-relay-v2` appears to write
    `defaultDurationLimit` in milliseconds into a protobuf field the spec defines in seconds, so
    a dialer computes 33.3 hours where the server enforces 120 s.

- **Disclosure gate: CROSSED on 2026-07-26.** The repository was made public by explicit
  owner decision, after being told that EPO and China have no patent grace period and
  that the loss is permanent. **EPO and China patent rights for everything disclosed as
  of that date are forfeit.** Do not plan around recovering them. A US provisional
  remains possible for 12 months from first disclosure under §102(b)(1), and that
  window is now running — it is the only patent option left, and it is time-limited.

- **GitHub Pages is serving the pre-Phase-9 bundle.** It was deployed by hand on
  2026-07-26 and has *not* been redeployed since; the consent gate, the running bar,
  the colouring job and the policy page are in the repository but not on that URL.
  Redeploying is a human action by design (DEMO-04) — run `npm run build:demo` and
  publish `packages/browser/dist/` deliberately.

- **GitHub Pages is live** at <https://o2alexanderfedin.github.io/o2.services/>, served
  from the `gh-pages` branch, deployed **by hand** on 2026-07-26. Verified against the
  real URL: loads with zero page errors, correctly reports that no relay is reachable
  with Start disabled, `crossOriginIsolated` false (BROW-05 holding in production), and
  the kernel computes a CID byte-identical to local. It cannot join a peer until a
  public `wss://` relay exists — an HTTPS page cannot dial `ws://`, and Pages runs no
  server process.

- **DEMO-04 still holds, and is now enforced.** No deploy workflow file may exist in
  the repository at all — absent, not disabled — and no `package.json` script may
  publish. `disclosure-gate.node.test.ts` asserts both, checks for workflow files by
  *content* so relocation does not evade it, and is mutation-proved by planting one
  in two places. `build:demo` builds and publishes nothing.

- **Version traps (C5): resolved in Phase 2.** js-libp2p 3.x installed with exact pins; none of the four trap packages are present. Two duplicate resolutions were found and fixed with npm `overrides` — `multiformats` had both 14.0.5 and 13.4.2 (a v13/v14 `CID instanceof` boundary), and an invalid `uint8arrays@5.1.1` was hoisted above the 6.1.1 libp2p v3 needs. **`npm install` alone kept the stale tree; a clean re-resolution was required.** `constants.node.test.ts` now asserts one copy of each plus every relay/transport limit.
- **Doc correction:** the relay constants are named `DEFAULT_DURATION_LIMIT`, `DEFAULT_DATA_LIMIT`, `DEFAULT_MAX_RESERVATION_STORE_SIZE` — `DEFAULT_`-prefixed, unlike what PROJECT.md and STACK.md record. Values are as documented (2 min / 128 KiB / 15 / 2 h).
- **Node 23.11.0 is the host runtime and is not LTS.** Outside vitest's declared range (`^20 || ^22 || >=24`), so every install prints `EBADENGINE`, and `packages/node/src/bin/agent.ts` depends on Node's experimental native type stripping. Everything passes today. `STACK.md` specifies Node 24 LTS — switching the toolchain is a human action, deliberately not taken autonomously.
- **Open decisions carried into planning:** aegir vs. vitest for the three-target test discipline (Phase 2); WASM fuel metering has no maintained JS-side tool (Phase 1/2); Safari + WebRTC-Direct is unverified with a WSS-only fallback branch (Phase 4).

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| *(none)* | | | |

## Session Continuity

Last session: 2026-08-06T22:30:00.000Z
Stopped at: **Phase 24 executed at 4/4 plans and verified at 0 of 1 criteria**
(`24-VERIFICATION.md`, 2026-08-06, `gaps_found`) and its ledger edits applied — this file
is one of them. **The count stays 8 of 15**; Phase 24 does not join it, and neither Phase
19's criterion 5 nor Phase 17's criterion 3 closes, because criterion 8 is where both were
carried and criterion 8 landed PARTIAL. AUTH-02 and AUTH-04 both stay `[ ]` / **Partial**
with their traceability rows extended; BENCH-03 did not move. The session before this one
closed Phase 23 at 5/5.

Next unit: **Phase 22 (Reachability Guard)** — 4 plans, no summaries, and it runs last.
**Confirm the ordering ruling before dispatching it.** 22 was placed after 24 so the guard
would certify a *gated* fabric; with criterion 8 PARTIAL it will certify a fabric gated at
agent relays and **open at every seed**, which is not what the 2026-08-05 ruling assumed.
The ruling's own escape hatch is that `22-VERIFICATION.md` states plainly what it covered,
and it should be told what to say.

**The pre-execution blocker that stood here has been overtaken by events, and what replaced
it is narrower and worse.** The blocker read that 24-03 would arm the gate on
`fabric-node.ts` with no spawnable entry point in its `files_modified`, leaving
`bin/agent.ts` open by a value no plan touched. **That half is closed**: `bin/agent.ts`
now takes a hex-validated, repeatable `--admit-issuer`, writes
`relayAdmission: new Set(values['admit-issuer'])`, and publishes its posture as a sorted
array on the handshake line — verified by the phase's own census. **The other half is not,
and it cannot be closed by a flag that does not exist**: `bin/seed.ts` has no
`--admit-issuer`, `SeedServerOptions` has no `relayAdmission` field, and `seed-server.ts`
writes `relayAdmission: 'admits-any-peer'` at its `FabricNode.start` call. `--trusted-issuer`
threads to `trustedIssuers` — *selection* — and never to `relayAdmission`, which is the
conflation that field exists to prevent. 24-01 left this open deliberately, saying so above
the value: *"Pinning it is a later decision and is deliberately not taken here."* **It is
now the reason criterion 8 does not close, so the deferral has a price and the price is
recorded.**

**The owner ruling this waits on, stated as a choice rather than a description.** Either
(a) `SeedServerOptions.relayAdmission` and `bin/seed.ts --admit-issuer` are added and
criterion 8 is re-read over a fabric in which every relay-capable peer an unadmitted node
can reach has been told to close — under which criterion 8 can reach **MET**, and 19's and
17's carried clauses close with it; or (b) the owner rules that the seed stays open and
criterion 8 is restated as a property of *a relay*. **A verifier may not take route (b)**,
and neither may an executor: RULING A forbids rewriting a criterion to let a phase close.
If (b) is chosen, the instrument is an `overrides:` entry on the verification or a dated
owner note beside the criterion — **not** a change to the criterion's words.

**Two further deferrals are recorded rather than fixed, and both are named in the source.**
The relay-side refusal reasons have **no wire surface**: in-process the gate distinguishes
*"holds no provider-issued certificate"* from *"certificate issued by …, which is not a
pinned provider"*, and both reach a joiner in another process as one undifferentiated
`PERMISSION_DENIED`, so an operator debugging a refused agent from its own stderr cannot
tell the two apart. And gating the `records` / `providers` answers on the certificate is
filed in `24-CONTEXT.md` as a deferred idea — a directly-dialable peer still reaches both.
Neither is descoped; both are unbuilt.

**Phases run sequentially from here, and that is a measured constraint rather than a
preference.** Their declared `files_modified` overlap heavily — `fabric-node.ts` in
14/15/17/21, `bin/bench.ts` in 14/15/16/17/23, `browser-node.ts` in 14/15/17/21 — because
"Wire What Was Built" means every phase converges on the same construction sites. Only
verification of one phase overlaps safely with execution of another, and only when their
planning directories differ.

**How Phase 14 was actually run, for whoever picks this up:** five plans, four waves, each
executor in its own `isolation="worktree"` agent, merged back one wave at a time with a
`tsc` + targeted-vitest gate between waves. Two things made it work that are not obvious.
First, **a worktree has no `node_modules`, and symlinking the main checkout's wholesale is
silently wrong** — `node_modules/@o2/*` are relative symlinks back to the *main* checkout,
so `tsc` and `vitest` verify the wrong tree and report clean without reading the agent's
changes. Every executor built a resolver farm and proved it with
`createRequire().resolve()` before editing. Second, **each wave's prompt carried the prior
wave's corrections**, because a correction recorded in a SUMMARY reaches no sibling plan.

### Off-roadmap work, 2026-07-29 → 2026-07-31

Not attributable to any phase, and recorded here so it is not mistaken for phase progress.
65 commits, all merged to `develop` and pushed; `develop` and `main` both match origin and
the tree is clean.

- **A 22-bug round.** Seven verification gaps and four timing defects closed. The timing
  class is the one worth remembering: **a test arms two clocks — its own internal budget
  and the framework's `testTimeout` — and the framework's must be the larger.** Inverted,
  the internal timer can never fire and the test cannot express the thing it was written
  to express. Related, and learned the hard way three times in a row: **size a bound
  against the worst case the file can construct, not the typical one**, and **never set a
  timing bound from a number you did not measure yourself.** One such guess set
  `timeoutMs` to 300 s against a lift that really takes 304.3 s and turned six tests red;
  it was reverted.
- **A security residual closed in `browser-node.ts`.** `createWorker` became required and
  the `worker ?? new WasmExecutor(...)` fallback was deleted, so a browser node can no
  longer silently execute on the main thread. The `offMainThread` getter went with it —
  once it could only return one value, the four e2e assertions reading it were tautologies.
- **31/31 mutations caught**, and the full suite passed at load 89-160.
- **The elfconv lifted-vs-native benchmark** (`tools/aot/bench-lifted.ts`, `fixtures/workload.c`).
  Findings in `.planning/BENCHMARK-RESULTS.md` and in commit `ce05cf2`; the two that bear
  on Phase 21 are below under Blockers/Concerns.

Two items were deferred to the owner and are still open: the benchmark's row-order confound
(load drifted 29→49 mid-run, so no inter-row difference under ~20% is claimed — fixing it
needs interleaved rows or a quiet host), and the `lift.node.test.ts` integration timeout,
where `INTEGRATION_TIMEOUT_MS` of 15 min wraps 45 min of internal budget. The measurement
that decision was waiting on now exists: a real lift takes **152.7-304.3 s** depending on
load, a 2× swing, so any fixed budget has to be sized against that whole range.

The three paragraphs below this line are older sessions' notes that were appended here
rather than replaced; they describe Phases 9 and 3 and are kept because they are still
accurate about those phases. They are not a description of the current position.
DEMO-04 still holds and is now enforced by `disclosure-gate.node.test.ts`: no deploy
workflow file may exist in the repository at all, absent rather than disabled, and no
`package.json` script may publish. `build:demo` builds; nothing deploys.

**The two-device run happened, and was worth it.** The owner ran the demo on an
iPhone and a laptop against one LAN seed on 2026-07-26: both joined, one peer
connected, the search distributed, the answer verified in the page. It found two
defects the whole e2e suite had passed over — an always-visible bar that was
literally always visible (an id `display` rule outranks `[hidden]`, and the tests
asserted the attribute rather than the screen), and a peer filter that matched the
relay's own id inside every circuit address, so two devices on one relay skipped
every candidate and never heard of each other. Both fixed and now tested.
Resume file: `.planning/.continue-here.md` (rewritten 2026-07-31, `status: merged_clean` —
nothing in flight, and it leads with the two open owner decisions listed under Pending
Todos above)
(no static determinism analysis, no cross-implementation verification, no host-import
allow-list). Still current; they apply to every later phase.

**Phase 3 still needs a human decision for the "public host" half.** Real AutoTLS
(criterion 2) requires publicly reachable infrastructure — outward-facing and hard to
reverse, and it collides with the disclosure gate above (now crossed — but a public relay
is still a hosting decision, not a disclosure one). Deliberately not done autonomously.
**Criterion 1 is no longer part of this.** It was restated on 2026-07-28 to two browsers
or two isolated browser contexts on one machine, per the testing-standard ruling, and it
had already been closed in a stronger form than the restatement asks — an iPhone running
Safari and a laptop running Chromium, on genuinely different machines, over direct WebRTC
with the relay carrying SDP only. That stronger result stands in the record.
