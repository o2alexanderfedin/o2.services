---
phase: 19-quorum-composition-owner-domain-attestation
verified: 2026-08-04T03:46:29Z
status: human_needed # was gaps_found; criterion 5 is no longer a gap, it is deferred under an owner ruling
score: >-
  4/5 criteria MET (1 PARTIAL, 0 FAILED) — UNCHANGED at the third pass, 2026-08-04T19:40Z.
  The 2026-08-04T03:46 initial pass scored 3/5 MET (2 PARTIAL); plan 19-19 closed criterion 1.
  The third pass re-measured all four MET criteria against a tree in which submit.ts (+719),
  fabric-node.ts (+210) and browser-node.ts (+197) had been rewritten under it, and confirmed
  all four. Criterion 5 does NOT move to MET and the score does NOT read 5/5: the owner ruled
  on it 2026-08-04 and CARRIED it to Phase 24 criterion 8, which has not run. Under RULING A
  and the Phase 17 → 18 → 20 precedent — re-confirmed the same day, when Phase 18 closed at
  9/9 only once WIRE-04 actually LANDED — a carried criterion stays PARTIAL until its
  destination phase lands. See the Second Amendment.
verifier: independent goal-backward pass, adversarial stance
re_verification:
  verified: 2026-08-04T08:00:25Z
  head: 01a168b
  previous_status: gaps_found
  previous_score: 3/5 MET, 2 PARTIAL, 0 FAILED
  criterion_text_unchanged: true # ROADMAP.md:651 and :723 re-read; both word-for-word as first scored
  gaps_closed:
    - >-
      G1 — criterion 1's relay clause now has an across-process reading that CAN fail.
      Re-derived from source and then re-executed: deleting rule 2 from composeQuorum
      reddens a fabric of four spawned bin/agent.ts processes at
      quorum-agents.node.test.ts:1064 with "expected 'composed' to be 'not-composed'",
      1 failed | 3 passed (4). The regression control was independently proved
      non-vacuous by planting the plausible wrong implementation.
  gaps_remaining:
    - >-
      G2 — criterion 5's cost clause. Deliberately untouched by 19-19 and confirmed
      untouched here. Still a bound made durable, not a rising price. Needs an owner
      ruling or a built per-identity cost.
  regressions: []
  new_findings:
    - "W7 — submit.ts's W1 fix cites :802-803 for a reader its own +14-line edit moved to :816-817"
    - "W8 — static-rendezvous.e2e.test.ts:43 cites browser-node.ts:1201 for `reservations: 'relays-for-nobody'`; that line is a duty-cycle comment and the hook is at :1389. Wrong when written, and not among the three the same commit corrected, while the sentence that commit added says four citations were re-checked"
    - "W9 — post-19-19 drift: commit 5e60f2f (defect work, outside 19-19) shifted browser-node.ts +1 above :1337, re-staling the four citations 19-19/1f60045 had just corrected. Not 19-19's error"
    - "W10 — reservation-exhaustion.node.test.ts's stated claim that a relay-refused node is 'still serving directly' is asserted NOWHERE. Measured: the file stays GREEN under a plant that makes its agents bind nothing"
    - "W11 — bench-attestation.node.test.ts:478 (criterion 3's CLI two-operator rung) went red once in three full node runs under host contention; its retry gate deliberately does not cover a rung that completed at reduced redundancy"
    - "Criterion 5's second `missing` bullet — the DoS opened by the aggregate budget — was closed by defect work (483775e), outside 19-19: enrollment-dos.node.test.ts plus ledger entries E1/E2"
  probes_executed:
    - mutation: "M40 — quorum.ts `if (requireIndependentPaths) {` -> `if (false as boolean) {`"
      command: "npx vitest run --project node quorum-agents --reporter=verbose"
      exit: 1
      result: "1 failed | 3 passed (4); expected 'composed' to be 'not-composed' at quorum-agents.node.test.ts:1064:34"
      restored: "cp + cmp, exit 0; git status clean"
    - mutation: >-
        UNLEDGERED, planted by this verifier — bin/agent.ts `listen` keyed on --relay-addr
        being PRESENT rather than --port being ABSENT
      command: "npx vitest run --project node quorum-agents discovery-agents reservation-exhaustion --reporter=verbose"
      exit: 1
      result: >-
        quorum-agents 1 failed | 3 passed — expected 'via-relay' to be 'seed' at :804:47.
        discovery-agents 2 passed and reservation-exhaustion 1 passed, i.e. the new
        precondition case is the ONLY guard in the tree for this production change.
      restored: "cp + cmp, exit 0; git status clean"
overrides_applied: 0
runs: # re-verification runs, 2026-08-04T07:xx–08:00Z, HEAD 01a168b, exit codes read directly
  - command: "npx tsc --noEmit"
    exit: 0
  - command: "npx vitest run --project node"
    exit: 1
    result: >-
      139 files, 7 failed | 1955 passed | 2 skipped (1964), 361.97 s real,
      (user+sys)/real = 0.777. 6 of the 7 are tools/aot/lift.node.test.ts docker
      timeouts at ~20 s each; the 7th is bench-attestation.node.test.ts:478 (W11).
  - command: "npx vitest run --project node (second run)"
    exit: 0
    result: "139 files, 1962 passed | 2 skipped, 281.70 s real, (user+sys)/real = 0.974"
  - command: "npx vitest run --project node --reporter=verbose (third run)"
    exit: 0
    result: "139 files, 1962 passed | 2 skipped"
  - command: "npx vitest run --project browser"
    exit: 0
    result: "243 files, 3819 passed, 40.48 s"
  - command: "npx vitest run --project e2e"
    exit: 0
    result: "14 files, 65 passed, 194.75 s"
  - command: "npx vitest run --project node quorum-agents --reporter=verbose"
    exit: 0
    result: "1 file, 4 passed, 10.35 s"
  - command: "npx vitest run --project node bench-attestation --reporter=verbose"
    exit: 0
    result: "1 file, 4 passed (isolated; the full-run failure did not reproduce)"
initial_pass_runs: # the 2026-08-04T03:46 pass, retained
  - command: "npx tsc --noEmit"
    exit: 0
  - command: "npx vitest run --project node"
    exit: 0
    result: "138 files, 1936 passed | 2 skipped, 236.80 s"
  - command: "O2_UNIT_ONLY=1 npx vitest run --project node"
    exit: 0
    result: "103 files, 1631 passed | 1 skipped, 9.62 s"
  - command: "npx vitest run --project browser"
    exit: 0
    result: "243 files, 3792 passed, 36.52 s"
  - command: "npx vitest run --project e2e static-rendezvous attestation-ui tab-refusals"
    exit: 0
    result: "3 files, 12 passed, 25.39 s"
  - command: "npx vitest run --project e2e"
    exit: 0
    result: "13 files, 62 passed, 106.24 s"
# G1 CLOSED 2026-08-04 by plan 19-19 (a2c0734, 203e2c3, 499a668, febd107, 096b101), re-executed
# rather than accepted. Retained verbatim as the first pass's record — see
# `re_verification.gaps_closed` and the Amendment for current state.
gaps:
  - criterion: 1
    status: closed_2026-08-04 # was: partial
    truth: "A verification quorum assembled during a job run through bin/agent.ts rests on no single shared reachability dependency — a run whose members all hang off the same relay is refused rather than silently accepted"
    reason: >-
      The operator half (rule 1) is measured across three real bin/agent.ts processes on both
      dial arms with a redundancy-1 control. The relay half (rule 2) has NO across-process
      reading: bin/agent.ts cannot produce a via-relay node, so its three spawned fabrics'
      relay assertions are unfalsifiable, and the only fabric that can redden on rule 2 uses
      in-process FabricNodes. The criterion names bin/agent.ts as the entry point; half of it
      is one tier below that.
    artifacts:
      - path: "packages/node/src/bin/agent.ts:91,685"
        issue: "port defaults to '0' and listen: ['/ip4/127.0.0.1/tcp/${port}'] is passed unconditionally, so canRelay (fabric-node.ts:1083) is always true and discoverability is always 'seed' with relayIds: [] (fabric-node.ts:627-628)"
      - path: "packages/node/src/quorum-agents.node.test.ts:552-558"
        issue: "the relay assertion on the three-operator spawned fabric cannot fail — the certificates are seeds, so sharedRelay returns null at quorum.ts:267 and the intersection is [] whatever composeQuorum does. Declared as incidental in the file's own header table at :26-36"
      - path: "packages/node/src/quorum-agents.node.test.ts:818-832"
        issue: "fabric B's three via-relay executors are in-process FabricNode.start({ listen: [] }) calls, not spawned bin/agent.ts processes"
      - path: "packages/node/src/mutation-ledger.ts:1003-1017"
        issue: "M40 records the phase's own measurement: with rule 2 deleted only the one-relay fabric went red — 1 failed, 2 passed"
    missing:
      - "One flag on bin/agent.ts that lets it bind nothing (--port none / --no-listen, or a conditional listen list when --relay-addr is present and --port was not passed, which needs --port's default removed so 'not passed' is distinguishable from 0)"
      - "Fabric B in quorum-agents.node.test.ts rebuilt from spawned agent processes; nothing else in that file changes (deferred-items.md item 2)"
  - criterion: 5
    truth: "Enrolling a node costs an attacker something they cannot mint for free, and the cost is measured: creating the N-th fake identity is demonstrably more expensive than creating the first"
    status: deferred_2026-08-04 # was: partial. Owner ruled and carried it to Phase 24 criterion 8; see `deferred:` below and the Second Amendment. The criterion still scores PARTIAL — deferred is a disposition, not a pass.
    reason: >-
      The unmintable half is delivered and measured — a certificate needs a provider signature
      and verifyCertificate refuses an untrusted issuer across real processes. The cost half is
      a bound made durable, not a rising price: the N-th identity inside the window is REFUSED,
      and no graduated per-identity cost exists in this design or was built. The phase says so
      itself in three places, and the ROADMAP's own planning note states PARTIAL is the honest
      score under that reading. UNCHANGED at 2026-08-04T08:00 — re-read at
      enrollment.ts:507-523 and ROADMAP.md:723; 19-19 deliberately did not touch it.
    artifacts:
      - path: "packages/core/src/enrollment.ts:507-523"
        issue: "the aggregate budget refuses past maxIssuedPerWindow; nothing prices an identity"
      - path: "packages/node/src/enrollment-cost.node.test.ts:41-47"
        issue: "the spec's own header names this reading and asks for PARTIAL"
      - path: ".planning/ROADMAP.md:790-797"
        issue: "'nothing in this phase delivers one — no such price exists in this design and none was built'"
    missing:
      - "Either a mechanism that makes the N-th identity cost more than the first (proof-of-work, an escalating stake), or an owner ruling amending criterion 5's second clause to the bound-made-durable reading. RULING A forbids the second being done silently."
      - >-
        CLOSED 2026-08-04 by 483775e (defect work, outside 19-19), re-checked here: the
        DoS the aggregate budget opened is now measured and pinned —
        enrollment-dos.node.test.ts (4 cases, in-process over MemoryNetwork) plus ledger
        entries E1 and E2, the latter pinning the ABSENCE of an authorization step on
        serveAgent's enrol branch. The operational half (an operator noticing a starved
        provider) remains untested.
deferred:
  # ADDED 2026-08-04 by the third pass. Criterion 5 moved OUT of `gaps:` and into here.
  # It is NOT counted as met. `deferred` records that the clause has an owner ruling and a
  # named home, so it is no longer an open escalation an executor could be asked to close.
  - truth: "Enrolling a node costs an attacker something they cannot mint for free, and the cost is measured: creating the N-th fake identity is demonstrably more expensive than creating the first"
    addressed_in: "Phase 24 — Certificate-Gated Admission (criterion 8), scheduled after phases 20–23 by owner ruling 2026-08-04"
    scores_as: "PARTIAL — unchanged. The phase stays at 4/5 and stays UNCOUNTED until Phase 24 lands."
    evidence: >-
      Phase 24 success criterion 8: "Enrolment's cost is bounded by admission, not by a counter:
      a node that cannot present a provider-issued certificate cannot join the fabric, advertise
      itself, or be dialled by another node — so an identity that was never issued buys nothing,
      and the N-th identity costs an attacker a provider's willingness to sign it." The final
      clause is criterion 5's second clause re-expressed, so the match is specific rather than
      tangential. ROADMAP.md's own note on criterion 8 says it was "ADDED 2026-08-04 BY OWNER
      RULING" and is "THE ANSWER TO PHASE 19's CRITERION 5". Phase 24 is fully planned —
      24-01…24-04 plus 24-CONTEXT.md exist on disk.
    owner_ruling: >-
      2026-08-04 — "The lifecycle of the node in the network starts from connecting to the relay.
      If the node that connects in can authenticate itself with certificate issued by provider,
      then it gets in… If it cannot authenticate — it cannot join the network." And on the
      scheduling: "yes, I know. Plan it for later."
    why_not_met: >-
      RULING A: "The criterion text is NOT amended, and the phase is NOT allowed to close on it."
      Criterion 5's text at ROADMAP.md is re-read and UNCHANGED, so neither route the previous
      escalation offered was taken; a third was — relocate the guard, keep the bar. The house
      precedent is thrice-applied and was re-confirmed on 2026-08-04 while this pass was running:
      Phase 17 criterion 2 → Phase 18 criterion 2d (17 stayed uncounted at 1/3); Phase 16
      criterion 3 → Phase 20 criterion 6; Phase 18 criterion 2b → Phase 20 criterion 1, which
      sat PARTIAL at 8/9 for two days and moved to MET **only when WIRE-04 actually landed**,
      whereupon Phase 18 was re-verified and closed at 9/9. Phase 24 has not run. Deciding a
      carry-forward does not raise a score; the destination phase landing does.
  - item: "Nothing an operator can run mints a capability chain, so the sovereign discovery path is spec-only (deferred-items.md item 5)"
    addressed_in: "Phase 23"
    evidence: "Phase 23 success criterion 5: 'bin/bench.ts gains an opt-in sovereign leg, off by default, that mints a real capability chain and dispatches an owner-labelled shard through it — giving delegate and CapabilitySupplier a traced call path from a runnable entry point'"
human_verification: # ADDED 2026-08-04 by the third pass
  - test: "Decide whether Phase 19 may be marked COMPLETE at 4/5 with criterion 5 carried to Phase 24."
    expected: >-
      A scheduling judgement, not a finding. Every criterion this phase can prove is proved and
      re-proved. What stops a `passed` verdict is RULING A, which forbids closing on a PARTIAL
      criterion. Phase 18 sat in exactly this position at 8/9 and its verifier recorded that this
      "is a scheduling judgement under an owner ruling, which a verifier may not make for itself".
    why_human: "Only the owner may apply or waive RULING A; a verifier may not."
  - test: "Arm a tripwire for criterion 5's carry-forward, or rule that none is required."
    expected: >-
      Something red must arrive when Phase 24 lands, per the Phase 20 criterion 1 precedent
      ("A scheduled clause is only scheduled if something red arrives to collect it"). Measured
      by this pass: none exists. See W12.
    why_human: "Whether to arm it now or at Phase 24 planning time is a scheduling decision."

warnings:
  - id: W1
    status: CLOSED 2026-08-04 by febd107 — but see W7
    where: "packages/core/src/job/submit.ts:124-130"
    what: "A stale docblock heading '## Nothing reads this field yet' on onQuorumShortfall, contradicted by :802-803 in the same file, which is the only place that reads it. 19-18 landed the field in wave 3, 19-06 landed the reader in wave 4, and the doc was never updated."
  - id: W2
    status: CLOSED 2026-08-04 by 1f60045 and febd107 — but see W8 and W9
    where: ".planning/ROADMAP.md:693-698, .planning/REQUIREMENTS.md:656"
    what: "Line citations for the index/reservations hooks have drifted. ROADMAP cites browser-node.ts:1178/:1201 and fabric-node.ts:1578/:1601; REQUIREMENTS cites fabric-node.ts:1566 and browser-node.ts:1164. Actual: browser-node.ts:1337/:1388, fabric-node.ts:1672/:1695. The wiring exists; only the citations are stale."
  - id: W3
    status: CLOSED 2026-08-04 by 1f60045 and febd107
    where: "packages/node/src/static-rendezvous.e2e.test.ts"
    what: "Criterion 4 names two hooks. reservations is read (findReservedPeers asks every connected peer; asked: true). index is NOT read anywhere in this file — discovery uses reservations exclusively (demo/main.ts:149-201), computePeers sends an offer (main.ts:743), and the tabs are unenrolled so peerCertificate returns before asking (main.ts:268). The ROADMAP's inline note that this file 'takes both readings' overstates it. The index hook IS read off a live tab in a sibling file from the same phase (tab-refusals.e2e.test.ts:371,377), which is why criterion 4 still scores MET."
  - id: W4
    status: CLOSED 2026-08-04 by 1f60045 (.planning/ROADMAP.md:643 now reads 'AUTH-04, AUTH-05, NET-06, …')
    where: ".planning/ROADMAP.md:643"
    what: "Phase 19's Requirements line omits AUTH-04, though criterion 5 is entirely AUTH-04's cost clause. Filed as deferred-items.md item 8; the executor was blocked from editing ROADMAP.md. Bookkeeping only."
  - id: W5
    status: OPEN, carried forward unchanged
    where: "packages/node/src/mutation-ledger.ts:1102 (M45)"
    what: "The ledger's own weakest entry — its only recorded signature is 'expected false to be true', which a flake could produce, and the summary did not record which of two degrading fabrics spoke. Self-declared in the entry's why."
  - id: W6
    status: PARTLY ANSWERED — M40 was re-executed by this pass; the other six plants were not
    where: ".planning/phases/phase-19-.../19-12-SUMMARY.md:177-199"
    what: "Six planted instruments are deliberately absent from the mutation ledger because no failure text was recorded, and 19-18's optional-onQuorumShortfall plant is unencodable because its runner is tsc. Structurally consistent with problemsWith()'s rules and with Mutation's shape, but this verifier did not re-execute any of the seven plants (source mutation was out of scope for a read-only pass)."
  - id: W7
    status: >-
      CLOSED 2026-08-04 by the third pass — the `:802-803` citation is gone; the docblock now
      cites by symbol and records its own drift. Its checkable claim re-measured TRUE —
      `onQuorumShortfall` occurs exactly three times in submit.ts.
    where: "packages/core/src/job/submit.ts:126"
    what: >-
      W1's fix cites '`:802-803` of this file, and nowhere else — confirmed by grep'. The
      readers are at :816-817. The correction's own commit (febd107) added 28 lines and
      removed 10 in that same docblock, net +14, so the number it states was true only
      before its own edit landed. Same class as 18-VERIFICATION.md's F-2, one phase later.
      One line off the same paragraph — 'the reader 670 lines below' — is also now 658.
  - id: W8
    status: >-
      CLOSED 2026-08-04 by the third pass — the `browser-node.ts` line citation is gone,
      replaced by a reference to that file's `serveAgent` call. Hook re-derived by symbol at
      HEAD and present.
    where: "packages/node/src/static-rendezvous.e2e.test.ts:43"
    what: >-
      Cites `browser-node.ts:1201` as the site of `reservations: 'relays-for-nobody'`.
      That line is a duty-cycle comment ('is the whole of that requirement on this tier.');
      the hook is at :1389 today and was at :1388 when febd107 landed. It was wrong when
      written, it was NOT one of the three citations febd107 corrected in that header, and
      the sentence febd107 added six lines below it says 'Four line citations in this
      header had drifted and were re-checked against the tree on 2026-08-04.'
  - id: W9
    status: >-
      CLOSED 2026-08-04 by the third pass — all four numeric citations are gone. The ROADMAP
      note now states the general rule, "CITED BY SYMBOL, NOT BY LINE… Three rounds of chasing
      the same four numbers is enough evidence."
    where: ".planning/ROADMAP.md:694,698; .planning/REQUIREMENTS.md:656; packages/node/src/static-rendezvous.e2e.test.ts:54"
    what: >-
      All four cite browser-node.ts:1337 (index) and :1388 (reservations). Verified correct
      at febd107 and at 1f60045 by `git show <rev>:packages/browser/src/browser-node.ts`.
      Commit 5e60f2f — defect work on the same branch, after 19-19 — added one line above
      :1337, so the hooks are now at :1338 and :1389 and all four citations are off by one.
      The wiring is unchanged; only the numbers drifted, again, four hours later.
  - id: W10
    status: NEW 2026-08-04, MEASURED
    where: "packages/node/src/reservation-exhaustion.node.test.ts:136-140, :254-257, :275-278"
    what: >-
      The docblock 19-19 added states that 'cases B and C assert that a node refused by a
      full relay, and a node whose relay is not there, each started anyway and is still
      serving directly', and that a node binding nothing 'would silently stop being' that
      'while the assertions stayed green'. The diagnosis is exactly right and the file does
      not close it: B asserts only `relays === []` and `exitCode === null`; C adds
      `peerId !== ''`. Neither reads a dialable address, though `multiaddrs` is on the
      handshake type at :122. Proved rather than argued — under a plant that makes every
      `--relay-addr` agent bind nothing, this file exits 0 with 1 passed.
  - id: W11
    status: NEW 2026-08-04, MEASURED
    where: "packages/node/src/bench-attestation.node.test.ts:478, gate at :329-333"
    what: >-
      Criterion 3's CLI two-operator rung failed once in three full `--project node` runs at
      HEAD — 'expected owner-attested to be independent' — and passed in isolation. The run
      that failed was the contended one ((user+sys)/real 0.777 against 0.974; 361.97 s
      against 281.70 s). `everyRealRungCompleted` gates retries on 'a completed run
      existed', deliberately not on the strength — but it also does not distinguish
      'completed at the redundancy it asked for' from 'completed at fewer replicas', so a
      contention-reduced rung is kept and fails on a label that was honest for what it ran.
      Criterion 3 keeps MET (three surfaces, two of them unaffected), but the CLI leg is
      load-sensitive and this is where it shows.
  - id: W12
    status: NEW 2026-08-04, MEASURED — the deferral of criterion 5 has no armed tripwire
    where: "packages/node/src/peer-gate.node.test.ts (docblock), packages/node/src/seed-server.ts (`SeedServerOptions`)"
    what: >-
      The Phase 20 criterion 1 note states the rule for a carried clause: "A scheduled clause is only
      scheduled if something red arrives to collect it", and it NAMES what will fire. Criterion 5's
      carry-forward to Phase 24 names nothing. Measured, not argued: the only record of the open front
      door inside a spec is a DOCBLOCK — peer-gate.node.test.ts's "Gating dispatch candidate selection,
      quorum membership and relay use is **UNMEASURED**, not descoped" — and "a comment is not a
      specification". `SeedServerOptions` has no `trustedIssuers` field, so nothing can even be asked
      to check. No instrument asserts the absence, so nothing goes red when Phase 24 lands.
      Sharpened by an irony this pass measured: criterion 4's OWN evidence is a live demonstration of
      the unlocked door — static-rendezvous.e2e.test.ts's three tabs are **unenrolled** (stated in its
      own header) and still reserve circuits and are advertised to each other by the relay, and
      reservation-exhaustion.node.test.ts's agents never enrol at all (zero hits for `enrol`,
      `--provider-addr`, `--issues-certificates`). Phase 24's plan 24-04 lists three NEW spec files in
      `files_modified` and neither of these two, so the collision is currently unrecorded on both ends.
  - id: W13
    status: NEW 2026-08-04, MEASURED TWICE — distinct from W11
    where: "packages/node/src/bench-attestation.node.test.ts, the `repoStatus()` case"
    what: >-
      `repoStatus()` snapshots `git status --porcelain` for the WHOLE repository, `.planning/` included.
      It failed twice in this pass for reasons unrelated to load and unrelated to Phase 19: once naming
      `M packages/node/src/peer-verifier.ts` (a concurrent agent's source edit) and once naming
      `M .planning/phases/phase-18-discovery-capacity-placement/18-VERIFICATION.md` — the Phase 18
      verifier writing its own report while my sweep ran. Every concurrent verifier reddens this case
      BY DOING ITS JOB, since producing a VERIFICATION.md is a `.planning/` write. W11 is about
      contention changing a LABEL; this is about the hygiene assertion having a repository-wide blast
      radius. Both failures are shared-tree artifacts, not Phase 19 regressions: the three attestation
      readings passed in the same runs.
---

# Phase 19: Quorum Composition & Owner-Domain Attestation — Verification Report

**Phase goal:** Verification quorums compose under anti-affinity with a backbone-anchored replica,
owner-domain agreement is labelled distinctly from independent-operator agreement, and two browser
tabs on a static bundle find each other with nothing dialed by a harness

**Verified:** 2026-08-04T03:46:29Z (HEAD `fc5a5ad`, branch `feature/bug-fixes-22`, tree clean)
**Status:** gaps_found
**Score: 3/5 criteria MET, 2 PARTIAL, 0 FAILED**

> **AMENDED 2026-08-04T08:00:25Z — score is now 4/5. Everything between here and the
> Amendment is the record of the initial pass and is left standing.** Criterion 1 moved
> PARTIAL → **MET**; criterion 5 did not move. See [the Amendment](#amendment--2026-08-04-criterion-1-closed-criterion-5-did-not-move).

Scored against the criteria as they read at `.planning/ROADMAP.md:651-722`, including criterion 1's
first clause as **reworded 2026-08-03 by owner ruling** (`:653-678`) and criterion 4's hook phrasing
as corrected the same day (`:684-716`). The rewording is faithful: VER-03's rationale clause has
always been eclipse resistance, `composeQuorum`'s rule 2 over the **member set** delivers exactly
that, and the retracted `discoverability === 'seed'` rule is confirmed gone from `quorum.ts` with its
retraction recorded in place at `:19-65`.

---

## Criterion scores

| # | Criterion | Score | Where the evidence is |
|---|---|---|---|
| 1 | Quorum through `bin/agent.ts`: no shared reachability dependency, no two replicas from one operator; one-operator fabric and one-relay fabric each refused rather than silently accepted | **PARTIAL** | operator half: `quorum-agents.node.test.ts:585-726`; relay half: `:880-995` — but not through `bin/agent.ts` |
| 2 | Certificates chaining to one owner resolve through `bin/agent.ts` as one replica set; a sovereign task on two of that owner's nodes agrees and reports **owner-domain** | **MET** | `owner-domain-agents.node.test.ts:522-605` |
| 3 | The same task with one node live executes once and the receipt reads **owner-attested**, wherever it is displayed | **MET** | job result `owner-domain-agents.node.test.ts:628-651`; CLI `bench-attestation.node.test.ts:457-473`; demo UI `attestation-ui.e2e.test.ts:405-431` |
| 4 | Two browser peers on the static bundle, no seed, no `/bootstrap.json`, nothing dialled by a harness, discover each other and complete a job — one host, three engines, labelled as one host | **MET** | `static-rendezvous.e2e.test.ts:256-497` |
| 5 | Enrolling a node costs an attacker something they cannot mint for free, and the N-th fake identity is demonstrably more expensive than the first | **PARTIAL** | `enrollment-cost.node.test.ts:265-367` |

---

## Criterion 1 — PARTIAL

**Mechanism.** `composeQuorum` (`packages/core/src/quorum.ts:163-241`) applies rule 1 by
construction — one certificate per operator, taken deterministically (`:176-187`) — and rule 2 over
the **chosen member set**, not the candidate pool (`:216-224`), with the reason for that position
written out at `:200-215`. `sharedRelay` (`:249-273`) treats a seed as having no discovery
dependency. `strength` on the ok arm is `classifyAttestation(members)` (`:239`), not the constant
`'independent'` the roadmap's `Research: None` line was corrected for. The retracted node-kind rule
is gone and its retraction is recorded at `:19-65`.

**Production caller.** `submitJob` composes the quorum job-level for public shards at
`redundancy >= 2` when every candidate carries a certificate (`packages/core/src/job/submit.ts:724-730`),
narrows the placement pool to the members (`:733-739`), applies the gate **before** the load
preference (`:686-694`), and consults `onQuorumShortfall` only where composition was attempted and
refused (`:796-804`). The field is required on `JobSpec` (`:144`) and every production submitter
states it: `bin/bench.ts:1036`, `demo/main.ts:641,909`, `core/executor/task-worker.ts:53`,
`bench/perf-workload.ts:364`.

**What is measured across `bin/agent.ts` processes — rule 1.**
`packages/node/src/quorum-agents.node.test.ts:585-726` stands up one spawned provider and three
spawned agents sharing `--operator-id one-ops`, asserts the concentration off the **certificates a
provider process signed** (`:616-619`), then submits the identical shard three times over one live
fixture through one closure whose only varying field is the dial (`:622-637`):

- default arm → `not-composed` / `insufficient-operators` / `wanted: 2` / `distinctOperators: 1`,
  the composer's own sentence on the shard, `agreed` at two replicas, `degraded: true` **at full
  redundancy**, receipt `owner-domain` and explicitly `not 'independent'` (`:646-682`);
- strict arm → `insufficient`, and `refused.verification.reason` asserted **equal to** the degrade
  arm's `quorum.reason` and `refused.quorum` deep-equal to it, so the two arms are demonstrably
  reading one refusal (`:684-700`);
- redundancy-1 control on **both** arms → `not-attempted`, undegraded, `owner-attested` (`:702-724`).

Distinguishability is read first: `discoverCandidates` returned three executors with none excluded,
before any outcome (`:429-438`, called at `:611-612`). This is a genuine reading — `agreeing.length`
is `answered.length` in `core/src/job/verify.ts:226`, which can be below the placed count, so
`toHaveLength(2)` is falsifiable.

**What is NOT measured across `bin/agent.ts` processes — rule 2.** Confirmed by re-derivation, not
by trusting 19-08:

- `bin/agent.ts:91` declares `port: { type: 'string', default: '0' }`; `:685` passes
  `listen: ['/ip4/127.0.0.1/tcp/${values.port}']` **unconditionally**. There is no argv that empties
  that array.
- `fabric-node.ts:1083` derives `canRelay = listen.some(a => !a.includes('/p2p-circuit'))`;
  `:627-628` signs `discoverability: canRelay ? 'seed' : 'via-relay'` and
  `relayIds: canRelay ? [] : [...relayPeerIds]`. A spawned agent is therefore always a seed with
  `relayIds: []`, whatever `--relay-addr` it was given — asserted in the fixture itself at
  `quorum-agents.node.test.ts:370-371`.
- **The relay assertion on the three-operator fabric cannot fail.** At `:552-558` the reduce starts
  from `agreeingCertificates[0]?.relayIds ?? []` = `[]` and filters `[]`, and
  `attestation.sharedRelay` is `sharedRelay(seeds)`, which returns `null` at `quorum.ts:267` on the
  first member. **19-08's claim that this assertion is INCIDENTAL is confirmed**, and the file
  declares it in its own header table at `:26-36` rather than presenting it as evidence.
- Fabric B — the only case that can redden on rule 2 — builds its three `via-relay` executors as
  in-process `FabricNode.start({ listen: [], relayAddrs: [relayAddr] })` (`:818-832`). Its provider
  is a real spawned process, so `operatorId`, `discoverability` and `relayIds` are still
  provider-signed statements; what is lost is that the executors are not separate processes.
- The phase pinned this against itself: `mutation-ledger.ts:1003-1017` (`M40`) records that deleting
  rule 2 reddens **only** the one-relay fabric — *"1 failed, 2 passed"*.

Fabric B's own readings are correct and complete on both arms (`:944-993`): refusal kind
`shared-relay-dependency` (not `insufficient-operators`, which is the assertion that would catch a
mis-built fixture), the relay's peer id in the refusal, `degraded: true` beside a receipt that
honestly reads `independent` because two operators did agree — the two tests
`ShardResult.degraded`'s doc says cannot be inferred from each other.

**Verdict.** The criterion names `bin/agent.ts` as the entry point. Its first half holds there; its
second half holds one tier below it and cannot hold there until the binary can produce a node that
binds nothing. PARTIAL.

---

## Criterion 2 — MET

`packages/node/src/owner-domain-agents.node.test.ts:481-665`, over one spawned provider and three
spawned `bin/agent.ts` agents:

- **Several certificates chaining to one owner's user key.** `n1` and `n2` enrol under one
  `--user-key` with **no `--owner-id`**, so their clearance is derived from the key they enrolled
  under (19-09's change at `bin/agent.ts`); `n3` is a third owner given identical treatment under a
  different key. The premise is asserted off the certificates, not the spawn args (`:406-413`).
- **Resolve as a single discoverable replica set.** `discoverCandidates` returns
  `replicaSets` of length 1, two certificates, `canVerifyWithinOwnerDomain: true`, both under one
  operator (`:545-552`); `found.providers === 3` with the third excluded by name
  `not-cleared-for-owner` and its user key in the detail (`:531-539`), so the exclusion is a
  selection rather than an empty answer. `discover-candidates.ts:233,248,263-265` fills
  `ownerId` from `certificate.userKey` and the whole certificate onto the descriptor.
- **Executes on two, outputs compared.** `status: 'agreed'` with the agreeing node ids equal to
  exactly `[n1, n2]` (`:569-575`).
- **The receipt reports owner-domain.** `:589` `owner-domain`, `:593` explicitly `not
  'independent'`, `:594-597` two replicas / one operator / one user key / the kernel's sentence.
  `:602` asserts the shard's quorum is `not-attempted`, so the label is visibly not something a
  quorum produced.
- **It is a receipt, not a lookup.** `:581-583` asserts every agreeing replica carries a real
  attestation rather than `'signed-by-nobody'` **before** the strength is read. That is the line
  that separates this from `sovereign-execution.test.ts`, which builds its receipt itself.
  `receiptFor` (`submit.ts:487-561`) verifies each signature against the descriptor's own issuer
  over `(moduleCid, inputCid, partitionIndex, resultCid)` rebuilt from the caller's task, and
  returns the named absence on any partial verification.
- **No data left the owner's domain**, on the placement half and from the far side: the third
  owner's store, read after it is stopped, does not hold the module but does hold the input
  (`:656-661`) — so it is an idle node rather than an unreadable directory.

The signing leg both tiers compose is real and identical: `fabric-node.ts:1549-1579` and
`browser-node.ts:1141-1181` build the same `ResultAttestor` from `(identity.seed, certificate)` with
the named literal `'signs-nothing'` for a node holding none, wrap the executor **outermost**, and
hand the wrapper to `serveAgent` (`fabric-node.ts:1625`, `browser-node.ts:1261`) plus
`attest: attestor` for the combine verb (`fabric-node.ts:1715`).

---

## Criterion 3 — MET

Three surfaces, all read rather than argued.

**Job result** — the sovereign instance the criterion is literally about.
`owner-domain-agents.node.test.ts:607-651`: `n2` is stopped, asserted dead by exit code, and the
requestor is polled until it drops the peer, before anything is submitted; the identical closure is
called on the re-discovered set; `canVerifyWithinOwnerDomain` reads `false` on the same expression
that read `true`; the shard agrees at one replica and the receipt reads `owner-attested`, explicitly
`not 'independent'`, `degraded: true`, `complete: false`.

**CLI** — `bench-attestation.node.test.ts` spawns `bin/bench.ts --discover` into a temporary `cwd`
(asserted, with `git status --porcelain` compared across the run) and reads three lines off its own
stdout: every memory rung prints the **named absence** with `STRENGTH.test(reading) === false` and
none of the three kernel sentences (`:443-453`); `real/1` prints `owner-attested` at 1 replica /
1 operator (`:457-473`); `real/2` prints `independent` at 2 replicas / 2 operators (`:475-482`); and
the pair is asserted together (`:488`). Sentences are compared against `describeAttestation`, not
transcribed. The retry is bounded to 2 and discards only an **observation** (a rung that completed
no job), never an assertion — argued at `:131-153`.

**Demo UI** — `attestation-ui.e2e.test.ts`, on `vite build` output served by a dumb 404-ing file
server. An enrolled solo tab reads `owner-attested` / `1 replica` / `1 operator` **on screen**
(`:405-431`) with the page's `1 node(s) computing` read as the population; a tab beside an
unenrolled peer reads the named absence naming that peer and none of the three strengths
(`:433-467`); a tab beside a peer holding a **valid certificate from a provider it does not pin**
reads the same absence (`:469-507`) — the case that guards `demo/main.ts:296`'s `verifyCertificate`
against a certificate supplying its own trust root. The fourth case compares the three screens
against each other and requires a strength in exactly the run where nothing went unaccounted
(`:524-546`). The old unconditional claim *"each cube ran twice, on different nodes"* is asserted
absent in all three.

One source of words: `attestationReceipt` fills `description` from `describeAttestation`
(`quorum.ts:309`), and both surfaces render that field (`bin/bench.ts:915-920`,
`demo/index.html:352-365`). `describeAttestation` has no second production caller — confirmed by
grep; the only non-comment hits outside `quorum.ts` are the barrel export and test imports.

**Recorded caveat, which does not change the score.** The *sovereign* instance of this label reaches
only the job-result site. No CLI rung and no demo topology can produce a sovereign shard (deferred
items 5 and 7), and none can produce `owner-domain` at all (deferred item 6) — confirmed by grep:
`owner-domain` appears in no display surface, and `bin/bench.ts` prints no quorum verdict. That is
why VER-09 and VER-10 stay `[ ]`. The criterion's clause is *"wherever it is displayed"*, every site
that can display the label was measured displaying it correctly and refusing to display a strength
it had not established, so the criterion is met and the requirements outlive it.

---

## Criterion 4 — MET

`packages/node/src/static-rendezvous.e2e.test.ts`, on **three** engines (chromium, firefox, webkit),
each its own `browserType.launch()` and therefore its own implementation and its own storage:

- **The bundle is built in the fixture** (`:180-183`), so the spec fails when sources break the
  bundle rather than when somebody forgot to rebuild.
- **No seed, no origin.** A deliberately dumb file server over `dist/` (`:188-205`); `/bootstrap.json`
  asserted `404` (`:285-286`); every page's own `discoverRelays()` reads
  `{ source: 'query', relayAddrs: [relayAddr] }` (`:288-295`).
- **Nothing dialled by the harness.** There is no `window.o2.dial(...)` in the file — verified by
  grep. The only address supplied is the relay's, through the page's own `?relay=` query string
  (`:149`), which is what the ROADMAP's browser-tier testing standard requires.
- **Discovery via the relay's `reservations` answer.** Each round asserts `asked: true` and
  `attempted === undiscovered` — an exact anti-vacuity reading rather than a non-zero one — with the
  totals pinned so the fabric introduces every pair exactly once (`:349-369`). The rounds are
  sequential, and the reason (a measured ICE loss on a simultaneous firefox↔webkit dial) is filed
  as deferred item 1 rather than hidden.
- **Full peers.** Every peer holds every other, filters its own address, and holds the relay
  (`:371-384`); every peer's `computePeers()` lists every other, established by asking rather than
  assuming (`:386-397`); every non-submitter's own `tasksExecuted > 0` (`:489-495`).
- **The relay dropped out.** Every pair holds an unlimited `/webrtc` connection, `limited: false`
  asserted per connection (`:410-435`) — so the job did not travel the 2-minute / 128 KiB circuit.
- **A job completed together.** Two cubes at `redundancy = peers.length`; the agreement per cube is
  asserted as a **set equal to all three peer ids** with a non-submitter present, placed before the
  multiplier so the proof reads as a distribution reading (`:450-480`); egress manifest non-empty
  with no violations.
- **One host, labelled.** `:59-70` states it, and an engine that could not take part is published
  with its reason and fails the first case (`:265-274`) rather than vanishing.

**Warning W3.** The criterion names two hooks. `reservations` is read. `index` is **not** read
anywhere in this file: discovery is `findReservedPeers` alone (`demo/main.ts:149-201`, `net/src/rendezvous.ts:75-100`),
`computePeers` sends an `offer` (`main.ts:743`), and the tabs are unenrolled so `peerCertificate`
returns at `main.ts:268` before asking. The ROADMAP's inline note that this file *"takes both
readings"* overstates what it measures. The clause still holds, because the browser tier's `index`
hook is (a) wired identically to the Node tier's — `browser-node.ts:1337` against
`fabric-node.ts:1672`, count-pinned at `serve-agent-hooks.node.test.ts:99,184` — and (b) **read off a
live tab over the real wire in the same phase**: `tab-refusals.e2e.test.ts:371,377` asks a tab
`providers` and gets `[]` for the withheld sovereign row and exactly one key, derived back to the
tab's own peer id, for the public one.

---

## Criterion 5 — PARTIAL

**The unmintable half is delivered and measured.** A node identity is a provider-signed certificate,
and `verifyCertificate` refuses an untrusted issuer. `bin/agent.ts` requires
`--issues-certificates --max-issued-per-window <n>` together (`:458-463`), refuses a non-integer or
`< 1` budget with exit 2 (`:474-477`), and `issuesCertificates` carries the budget on both options
types, so a provider with no stated bound is unrepresentable. The aggregate budget sits on the one
quantity a request cannot rotate — the provider's own issuance — checked after the per-user window
and immediately before signing, recorded only on success, into a host-supplied `IssuanceLedger`
(`core/src/enrollment.ts:499-546`).

**Measured across real processes** (`enrollment-cost.node.test.ts:265-367`): a provider at budget 1
certifies the first enroller and its certificate verifies; a second enroller under a **freshly
generated** user key is refused by the **aggregate** reason (`'this provider has issued 1
certificates'` / `'(limit 1)'`) and explicitly not by the per-user one (`not.toContain('has
enrolled')`), with exit code separated from the argv-error code 2; the provider is stopped and
asserted dead; a **different pid** on the same `--dir` with the same issuer key still refuses; and a
second provider certifies the turned-away node while a peer pinning only the first refuses that
certificate `untrusted-issuer` by name. The refusal is read from outside the process, and a
successful enrolment (which every plant would produce) fails immediately rather than at a 60 s
announce budget.

**What is not delivered.** Criterion 5's second clause asks that the N-th identity be *demonstrably
more expensive* than the first. What exists is a **refusal inside the window**, not a price — an
unpayable cost rather than a larger one. No graduated cost exists in this design and none was built.
Three independent places in the tree say so against their own interest: `enrollment-cost.node.test.ts:41-47`,
`ROADMAP.md:790-797`, and AUTH-04's own row. Under the rising-price reading this is PARTIAL, and
RULING A forbids rewording the criterion to close the phase.

**Second, unmeasured cost.** The aggregate budget **opened** a denial of service: `serveAgent` serves
`enrol` with no authorization step, so anyone able to dial a provider can spend its whole window at
one `ed25519.keygen()` per attempt — where before, they could spend only their own user key's window.
The per-verifier answer (trust or run another provider) is half a reading and half an argument: the
*recovery* is measured, the *operational* half is not, every other fixture in the repository is
single-provider, and the surface is pinned by no mutation-ledger entry. `M54` pins the bound; nothing
pins what it cost.

---

## Re-derived claims (asked for explicitly, checked rather than trusted)

| Claim | Verdict | Evidence |
|---|---|---|
| 19-08: task 1's relay assertion is INCIDENTAL; only fabric B carries rule 2 | **Confirmed** | `quorum-agents.node.test.ts:552-558` reduces from `[]` and `sharedRelay` short-circuits at `quorum.ts:267`; seeds asserted at `:370-371`; ledger `M40` records 1 failed / 2 passed |
| 19-12: six planted instruments deliberately absent from the ledger | **Consistent, not re-executed** | Each is named with what is missing at `19-12-SUMMARY.md:177-188`; `problemsWith` (`mutation-ledger.ts`) rejects an empty `signature` or `caughtBy`, so an invented signature would be a false entry. This pass did not re-plant them — source mutation was out of scope. |
| 19-12: 19-18's optional-`onQuorumShortfall` guard is `tsc`, not vitest | **Consistent** | The field is required at `submit.ts:144` and stated at all five production call sites; `Mutation` has no runner field for the type checker and `M2c`'s `why` already records that limit. Not re-executed, for the same reason. |
| 19-11: `BrowserNode.executor` is still exactly a `GovernedExecutor` | **Confirmed** | Field typed `GovernedExecutor` at `browser-node.ts:563`; `parts.executor: GovernedExecutor` at `:675`; assigned at `:692`; constructed at `:1117`; passed as `executor` at `:1249`. The signing wrapper is a **separate** field `signingExecutor` (`:598,1181,1250`), and `serveAgent` is served from it (`:1261`). The demo's self-dispatch uses `node.signingExecutor` at `demo/main.ts:602`. No branch was added and no type moved. |

## Executor-reported limits (confirm / refute)

| Reported limit | Verdict |
|---|---|
| `bin/agent.ts` cannot produce a `via-relay` node, so quorum rule 2 has no across-process reading | **Confirmed** — `agent.ts:91,685`; `fabric-node.ts:1083,627-628`. This is criterion 1's PARTIAL. |
| VER-04's gate is reached by no MEASURED runnable entry point | **Confirmed** — `bin/bench.ts` prints no quorum verdict (grep: the only `quorum` occurrence is a comment at `:1028`); `bench-attestation.node.test.ts` asserts only strength/replicas/operators off stdout, which a degraded shard would print identically. |
| VER-09/VER-10 unticked; every reading is of a PUBLIC job, and `owner-domain` is displayed nowhere | **Confirmed** — grep finds `owner-domain` on no display surface; the label is read only off `ShardResult` in `quorum-agents.node.test.ts` and `owner-domain-agents.node.test.ts`. |
| A redundant job does not run over `/p2p-circuit`; every stall measured exactly `rpcTimeoutMs` | **Not re-measured.** Recorded at `deferred-items.md` items 3 and 4 with per-iteration figures; both are pre-existing and neither is asserted on by any spec. Accepted as reported, not independently confirmed. |
| `reservation-exhaustion.node.test.ts`'s ~20 % flake was root-caused and fixed in `919f8e0` | **Holds** — green in isolation and in the full 138-file node run. |

## Test evidence (exit codes read directly, no pipes)

| Command | Exit | Result |
|---|---|---|
| `npx tsc --noEmit` | **0** | no output |
| `npx vitest run --project node` | **0** | 138 files, 1936 passed / 2 skipped, 236.80 s |
| `O2_UNIT_ONLY=1 npx vitest run --project node` | **0** | 103 files, 1631 passed / 1 skipped, 9.62 s |
| `npx vitest run --project browser` | **0** | 243 files, 3792 passed, 36.52 s |
| `npx vitest run --project e2e static-rendezvous attestation-ui tab-refusals` | **0** | 3 files, 12 passed, 25.39 s |
| `npx vitest run --project e2e` | **0** | 13 files, 62 passed, 106.24 s |
| `npx vitest run --project node quorum-agents owner-domain-agents` | **0** | 2 files, 4 passed, 6.36 s |
| `npx vitest run --project node bench-attestation enrollment-cost requirements-ledger reservation-exhaustion discover-arm bench-reduce combine-signature result-signature` | **0** | 8 files, 48 passed, 155.74 s |

## Anti-pattern scan

Fifty-two `packages/` files changed across this phase's commit span. Zero `TBD`, `FIXME` or `XXX`.
Zero `TODO`, `HACK` or `PLACEHOLDER`. The one documentation defect found is W1 above — a stale
docblock heading in `core/src/job/submit.ts` asserting that `onQuorumShortfall` is unread, 670 lines
above the code that reads it. It is the class this repository treats as serious (a comment governing
a reader's conclusion), but it changes no behaviour and no criterion.

## Requirements coverage

| Requirement | Marker | Verified against the tree |
|---|---|---|
| VER-03 | `[ ]` Partial | Correct. Rule 2 is implemented and correct; it has no across-process reading (criterion 1's gap) and the durability half is deliberately unimplemented, scoped at `quorum.ts:44-65`. |
| VER-04 | `[ ]` Partial | Correct. The gate is real and reached only through `submitJob`; no runnable entry point has been **measured** reaching it (deferred item 10). |
| VER-08 | `[x]` Done | Supported: `owner-domain-agents.node.test.ts` closes the clause that had no entry point; the receipt is derived from checked signatures at `submit.ts:487-561`. |
| VER-09 | `[ ]` Partial | Correct, and the open clause is named: no display site has shown the label for a **sovereign** shard. |
| VER-10 | `[ ]` Partial | Correct, and the open clause is named: `owner-domain` is displayed by nothing, anywhere. |
| AUTH-04 | `[ ]` Partial | Correct. Provider-gating and the durable aggregate budget are wired and measured; the cost clause is a bound rather than a price, and the DoS it opened is unmitigated and unpinned. Also absent from Phase 19's `Requirements:` line (W4). |
| AUTH-05 | `[x]` Done | Supported: `discoverCandidates` fills `replicaSets` from qualified certificates; `bin/agent.ts` derives a node's clearance from its enrolled user key; `CandidateOptions.dispatch` became a function of the node id. |
| SCHED-02 | `[x]` Done | Supported, and its entry-point claim is now guarded — defect #31 closed by 19-17's call-site requirement in `bench-reduce.node.test.ts` (which proves each requirement falsifiable via `plantedSource` at `:335`). |
| NET-06 | `[ ]` Partial | Correct, and its own row states the narrow open leg: no browser-tier path *selects* whom to compute with by querying an index. |
| WIRE-03 | `[x]` Done | Supported by 19-03 and 19-04, with the one unblocked item still open — `guardSovereignty`'s **refusal** branch has never fired in a tab — named rather than absorbed (deferred item 9). |

---

## What a gap-closure plan would have to do

**G1 — criterion 1's relay clause across `bin/agent.ts` processes.**
Add one flag to `bin/agent.ts` that produces a node binding nothing: `--port none`, `--no-listen`, or
a `listen` list built conditionally when `--relay-addr` is present and `--port` was not passed —
which requires removing `--port`'s `default: '0'` so *not passed* is distinguishable from `0`. The
binary's own comment asks that the next phase touching that `parseArgs` block with no other plan
behind it fold `--owner-id` / `--trust-anchor` / `--owner-key` into one flags object; the via-relay
knob belongs in that fold. Then replace `standUpBehindOneRelay`'s three in-process
`FabricNode.start({ listen: [] })` calls with spawned agents given `--relay-addr` and the new flag.
Nothing else in `quorum-agents.node.test.ts` changes, and `M40` becomes a reading over three real
processes. Note that the *job* must still travel a direct connection — deferred item 3 records that
routing it over the circuit stalls at exactly `rpcTimeoutMs` — so the executors keep dialling the
requestor.

**G2 — criterion 5's cost clause.** Two mutually exclusive routes, and the phase may not take the
second silently:
1. Build a per-identity cost the N-th enroller pays and the first does not, and measure the two.
2. Obtain an owner ruling amending criterion 5's second clause to the bound-made-durable reading,
   recorded in `ROADMAP.md` the way criterion 1's rewording was, with the reason it is faithful.

Either way, the DoS opened by the aggregate budget needs an entry in the mutation ledger or a
measured mitigation. `serveAgent`'s `enrol` branch takes no capacity slot and performs no
authorization; today the only thing bounding it is NET-08's inbound message ceiling.

**W1** is a one-paragraph edit to `core/src/job/submit.ts:124-130`. **W2** is four line citations.
**W4** is one identifier added to a list. **W3** is either an assertion in
`static-rendezvous.e2e.test.ts` that asks a tab for `records`/`providers`, or a correction to the
ROADMAP note's *"takes both readings"*.

---

_Verified: 2026-08-04T03:46:29Z_
_Verifier: independent goal-backward pass (gsd-verifier), adversarial stance_
_No source file was modified by this verification. `git status` clean at HEAD `fc5a5ad` before and after._

---

## Amendment — 2026-08-04: criterion 1 closed, criterion 5 did not move

**Status stays `gaps_found`. Score: 3/5 → 4/5.** Everything above is the record of the
2026-08-04T03:46 initial pass and is left standing. Nothing in it is retracted: G1 was real
when it was written, and plan 19-19 closed it. What changes is **criterion 1 (PARTIAL →
MET)** and the closure of W1–W4. Criterion 5 is unmoved and unmovable without an owner
decision, which is the escalation at the end of this amendment.

Re-verified at HEAD `01a168b`, branch `feature/phase-18-discovery-capacity-placement`, tree
clean before and after. All five 19-19 commits and the orchestrator's `1f60045` confirmed
ancestors of HEAD by `git merge-base --is-ancestor` (exit 0 each).

**The contract is the same contract.** `.planning/ROADMAP.md:651` (criterion 1) and `:723`
(criterion 5) were re-read and are word-for-word what the initial pass scored against.
`1f60045` touched only the `Requirements:` line (W4), the W2 citations, and the W3 note —
never a criterion. This amendment scores against the same text.

### What moved

| # | 2026-08-04T03:46 | 2026-08-04T08:00 | Why it moved |
|---|---|---|---|
| 1 | PARTIAL | **MET** | The relay half now has an across-process reading that CAN fail, and this pass made it fail. |
| 2, 3, 4 | MET | **MET** | Re-run, no regression. Criterion 3 carries a new load-sensitivity warning (W11) that does not change its score. |
| 5 | PARTIAL | **PARTIAL** | Untouched by design. The cost clause is still a bound, not a price. |

**Score: 4/5 criteria MET, 1 PARTIAL, 0 FAILED.**

---

### Criterion 1 — now MET

The initial pass refused this criterion because the assertion standing in for rule 2 across
processes *could not fail*. The claim now is that it can. That claim was not accepted; it was
re-derived from source and then executed.

**1. The production change is real, and the chain is derivable end to end.**

- `packages/node/src/bin/agent.ts:120` — `port: { type: 'string' }`. The `default: '0'` is
  gone, and the docblock at `:95-119` states why in the terms the initial pass used.
- `packages/node/src/bin/agent.ts:758-763` — the listen list is now one conditional
  expression:
  ```ts
  const listen =
    values.port !== undefined
      ? [`/ip4/127.0.0.1/tcp/${values.port}`]
      : relayAddrs.length === 0
        ? ['/ip4/127.0.0.1/tcp/0']
        : []
  ```
  The third row is the new one and it is keyed on `--port` being **absent**, which is the
  only reason the default had to go.
- `packages/node/src/fabric-node.ts:1072-1076` — `listen: []` plus one relay yields
  `['/p2p-circuit']`; `:1083` reads `canRelay` off exactly that list and gets `false`;
  `:627-628` therefore signs `discoverability: 'via-relay'` with `relayIds:
  [...relayPeerIds]`, and `relayPeerIds` is filled at `:1240-1249` from the peer id of a
  **successful** relay dial — so it is non-empty by construction on the arm that reaches it.
- `packages/core/src/quorum.ts:261-272` — `dependenciesOf` returns `member.relayIds` for a
  non-seed, so `common` **starts non-empty** and the intersection survives. The initial
  pass's finding that the reduce began from `[]` no longer describes fabric B.

**2. Fabric B is four separate operating-system processes.**
`packages/node/src/quorum-agents.node.test.ts:906-994` (`standUpBehindOneRelay`): one spawned
provider (`:928`) and three spawned agents (`:954-967`) given `--relay-addr` and **no
`--port`**, plus an in-process relay and an in-process requestor. The three in-process
`FabricNode.start({ listen: [] })` calls the initial pass found at `:818-832` are gone. The
requestor is stood up *before* the agents (`:931-946`) because a node binding nothing cannot
be dialled, and `--peer-addr` is taken at startup — which also makes the peering a
precondition rather than a hope. Circuits are **read** off each agent's own handshake line
(`:978-980`), not waited for.

**3. The certificates rule 2 reads carry a relay, and it is asserted before anything is
built on it.** `:1031-1034`, off `discoverCandidates`' answer rather than off the spawn args:

```ts
expect(certificate.discoverability).toBe('via-relay')
expect(certificate.relayIds).toStrictEqual([relay.peerId])
```

Those two assertions ran and passed in the planted run below (the failure was 30 lines
later), so the composer was reading provider-signed `via-relay` certificates naming one
shared relay when it was asked to compose.

**4. The plant. Executed by this verifier, not read from a summary.**
`M40`'s own mutation, applied literally — `packages/core/src/quorum.ts`, `  if
(requireIndependentPaths) {` → `  if (false as boolean) {`:

| | |
|---|---|
| command | `npx vitest run --project node quorum-agents --reporter=verbose` |
| exit | **1** (read on the next line, no pipe) |
| result | `Tests  1 failed \| 3 passed (4)` |
| failure | `AssertionError: expected 'composed' to be 'not-composed'` at `packages/node/src/quorum-agents.node.test.ts:1064:34` |
| which case | *"criterion 1 engineered — one relay: caught by rule 2 and named by its relay"* — the spawned fabric |
| the other three | green, including the three-operator fabric, exactly as the file's header table at `:26-39` predicts |
| restore | `cp` then `cmp` → exit 0; `git status --porcelain` → empty |

This is the reading the initial pass said did not exist. `M40`'s ledger entry
(`mutation-ledger.ts:1019-1040`) now records the same text and the same counts, and its
`why` states in full which cases still cannot redden and why that is by construction. The
entry is honest.

**5. The regression control is real and is NOT vacuous — proved by a second plant.**
`quorum-agents.node.test.ts:751-813` reads both arms of one closure whose only varying
argument is the flag: no `--port` must sign `via-relay` naming the relay (`:790-796`);
`--port 0` must stay a `seed` with `relayIds: []` (`:803-811`). To test whether that control
can fail, this verifier planted the plausible wrong implementation the 19-19 executor
reported — a listen list keyed on `--relay-addr` being **present** rather than `--port`
being **absent**:

```ts
const listen =
  relayAddrs.length > 0 ? [] : [`/ip4/127.0.0.1/tcp/${values.port ?? '0'}`]
```

| | |
|---|---|
| exit | **1** |
| failure | `AssertionError: expected 'via-relay' to be 'seed'` at `quorum-agents.node.test.ts:804:47` |
| counts | `Tests  1 failed \| 3 passed (4)` |
| restore | `cp` then `cmp` → exit 0; tree clean |

The executor's reported signature is confirmed verbatim. **And a second reading came out of
the same plant, which the executor did not report:** with the plant still in place,
`discovery-agents.node.test.ts` (2 passed) and `reservation-exhaustion.node.test.ts`
(1 passed) both stayed **green**, exit 0. The precondition case at `:751-813` is therefore
the *only* thing in the tree guarding this production change. That is not a defect — it is
what the case was added for — but it is worth stating that the guard is singular.

**Verdict: MET.** Both halves of criterion 1 are now measured across spawned `bin/agent.ts`
processes, each on a fabric where the rule under test is the only thing that can produce the
refusal, and each proved falsifiable by mutation.

**The one substitution that remains, unchanged and previously accepted.** The *requestor* is
still an in-process `FabricNode`. `bin/agent.ts` submits no job — zero occurrences of
`submitJob`, `JobSpec` or `executeVerified` — so *"a job run through `bin/agent.ts`"* is
satisfiable only as *"a job run **across** `bin/agent.ts` processes"*. The file states this
at `:5-13` rather than leaving it in a planning document, it is the shape
`discovery-agents.node.test.ts` already uses for Phase 18, and the initial pass accepted it
for rule 1. It is not a new gap and it is not what held the criterion at PARTIAL.

---

### Criterion 5 — still PARTIAL, and it needs a decision rather than a plan

Re-read at `packages/core/src/enrollment.ts:507-523` and `.planning/ROADMAP.md:723`: unchanged.
The N-th identity inside the window is **refused**, not **priced**. Nothing in the 19-19 span
touches it, which is what 19-19 said it would do.

**What did move, from outside 19-19.** The initial pass listed a second `missing` item under
criterion 5: *"`M54` pins the bound; nothing pins what it cost."* Commit `483775e` (defect
work) closed that half:

- `packages/node/src/enrollment-dos.node.test.ts` — four cases pricing the exposure as
  **ratios taken inside one run**, interleaved so a load spike cancels: what a provider pays
  to refuse a request it was always going to refuse (`:123`); that minting costs the attacker
  less than refusing costs the provider (`:169`); that a node at its one admission slot
  refuses seven of eight `exec` dispatches and serves eight of eight `enrol` frames in the
  same instant (`:307`); and that one dialer can burn a three-certificate window and lock out
  an honest enroller by name (`:354`).
- Ledger entries `E1` and `E2` (`mutation-ledger.ts:1600-1676`). `E2` pins an **absence** —
  planting an authorization step on `serveAgent`'s enrol branch turns the counted call list
  from `['exec']` into `['exec']` plus one per enrolment — and its `why` records that a
  capacity slot is *not* the mitigation, measured rather than argued.

The file states in its own header that it builds no mitigation and amends no criterion, and
that both are an open owner ruling. That is the correct disposition and it is why the score
does not move.

**ESCALATION — this gap cannot be closed by an executor.** Two mutually exclusive routes,
and RULING A forbids taking the second silently:

1. **Build a per-identity cost** the N-th enroller pays and the first does not (proof-of-work
   over the request, an escalating stake), and measure the two side by side the way
   `enrollment-dos.node.test.ts` already measures ratios.
2. **Amend criterion 5's second clause** to the bound-made-durable reading, recorded in
   `ROADMAP.md` the way criterion 1's first clause was on 2026-08-03 — with the reason it is
   faithful stated in place, and the superseded wording kept.

Until one of those happens, *"the N-th fake identity is demonstrably more expensive than the
first"* is unmeasured, and unmeasured is not met.

---

### Warnings W1–W4 — closed, and two new ones came out of closing them

| id | verdict |
|---|---|
| **W1** | **Closed** by `febd107`. `'## Nothing reads this field yet'` is gone from `packages/core/src/job/submit.ts`; the replacement names the reader and what each arm decides, and keeps the scheduled-arrival argument rather than deleting it. **But see W7.** |
| **W2** | **Closed** by `1f60045` (ROADMAP) and `febd107` (REQUIREMENTS, static-rendezvous). Each corrected number was checked against the line it named **at the commit that wrote it** — verified here by `git show <rev>:packages/browser/src/browser-node.ts`. **But see W8 and W9.** |
| **W3** | **Closed** by `1f60045`. `.planning/ROADMAP.md:715-725` now says `static-rendezvous.e2e.test.ts` takes the `reservations` reading and `tab-refusals.e2e.test.ts:371,377` takes the `index` reading, with the superseded *"takes both readings"* recorded in place rather than deleted. `febd107` put the same distinction in the spec's own header at `:59-67`. Both citations re-checked: `:371` is `expect(await askProviders(tab.peerId, sovereignRow.cid)).toEqual([])` and `:377` reads the public row. Correct. |
| **W4** | **Closed** by `1f60045`. `.planning/ROADMAP.md:643` now reads `**Requirements**: AUTH-04, AUTH-05, NET-06, VER-03, VER-04, VER-08, VER-09, VER-10, WIRE-03`. |
| **W5** | Open, carried forward unchanged. |
| **W6** | Partly answered — `M40` was re-executed by this pass and its recorded signature and counts are confirmed. The other six plants of `19-12` were not re-executed. `mutation-guard.node.test.ts` was read and it plants **nothing**: it checks only that every `find` string still matches its source, with the actual planting in an on-demand script. So a ledger entry's *signature* remains a claim until somebody runs it — which is precisely what this pass did for one of them. |

**W7 — the W1 fix cites a line its own edit moved.** `packages/core/src/job/submit.ts:126`
states *"**`:802-803` of this file, and nowhere else** — confirmed by grep"*. Grep now finds
the readers at **`:816-817`**. `febd107` added 28 lines and removed 10 in that same docblock
— net +14 — so `:802-803` was true only until the paragraph asserting it was written. This is
the same class as `18-VERIFICATION.md`'s F-2, one phase later. (The neighbouring *"the reader
670 lines below"* is likewise now 658.)

**W8 — one of the four citations that commit says it re-checked is wrong, and was wrong when
written.** `packages/node/src/static-rendezvous.e2e.test.ts:43` cites
`browser-node.ts:1201` as the site of `reservations: 'relays-for-nobody'`. At `febd107` that
line read `// is the whole of that requirement on this tier.` — a duty-cycle comment — and
the hook was at `:1388`. `febd107` corrected three citations in that header
(`fabric-node.ts:1601→1695`, `browser-node.ts:1178→1337`, `fabric-node.ts:1578→1672`) and did
not touch `:1201`, while adding the sentence *"Four line citations in this header had drifted
and were re-checked against the tree on 2026-08-04."* The hook is at `:1389` today.

**W9 — the corrections were re-staled four hours later, by work outside this phase.** All
four of `.planning/ROADMAP.md:694`, `:698`, `.planning/REQUIREMENTS.md:656` and
`static-rendezvous.e2e.test.ts:54` cite `browser-node.ts:1337` (`index: records`) and `:1388`
(`reservations: 'relays-for-nobody'`). Both were correct at `febd107` and at `1f60045`.
Commit `5e60f2f` — *"a peer reachable only over a relay is not a peer this tab is done
with"*, defect work on the same branch — added one line above `:1337`. The hooks are now at
`:1338` and `:1389`. **Not 19-19's error**, and recorded here only because a reader following
those numbers today lands one line short. `fabric-node.ts:1672` and `:1695` are still exact.

---

### W10 — `reservation-exhaustion.node.test.ts` does not measure the sentence it now states

This was the fourth thing asked of this pass and it is the one place where the answer is no.

`203e2c3` added a docblock at `packages/node/src/reservation-exhaustion.node.test.ts:126-141`
stating `--port 0` out loud and explaining why: *"cases B and C assert that a node refused by
a full relay, and a node whose relay is not there, each started anyway and is still serving
directly. A node binding nothing would announce a handshake carrying no dialable address at
all, and both of those sentences would quietly stop being true while the assertions stayed
green."*

**The diagnosis is exactly right. The file does not close it.** Every spawn goes through one
helper (`:142-148`), which now passes `--port 0` — so under today's production code the
sentence is true. What is asserted, though, is only:

- case B (`:256-257`) — `expect(b.relays).toStrictEqual([])` and `expect(b.child.exitCode).toBeNull()`
- case C (`:275-278`) — the same pair plus `expect(c.peerId).not.toBe('')`

Neither reads a **dialable address**, though `multiaddrs` is on the handshake type this file
parses at `:122`. Measured rather than argued: with the `--relay-addr`-keyed plant from the
criterion-1 section in place — which makes exactly these three agents bind nothing — this
file ran `npx vitest run --project node reservation-exhaustion`, **exit 0, 1 passed**. Its
own stated failure mode is the one it cannot see.

One line in each case closes it, e.g.
`expect(b.multiaddrs.some((ma) => ma.includes('/tcp/') && !ma.includes('/p2p-circuit'))).toBe(true)`.
Not a blocker — no criterion rests on it, the production behaviour is correct today, and the
binary's own behaviour *is* guarded by `quorum-agents.node.test.ts:803-811`. It is a warning
because the comment asserting the property and the assertions failing to check it sit twelve
lines apart.

### W11 — criterion 3's CLI leg is load-sensitive, and the retry gate does not cover the way it fails

`npx vitest run --project node` was run three times at HEAD. The first exited **1**:

```
Test Files  2 failed | 137 passed (139)
     Tests  7 failed | 1955 passed | 2 skipped (1964)
```

Six of the seven are `tools/aot/lift.node.test.ts` docker timeouts at ~20 s each. The seventh
is `packages/node/src/bench-attestation.node.test.ts:478` —
`expected 'owner-attested' to be 'independent'` — which is criterion 3's CLI two-operator
rung. Runs two and three exited **0** (`1962 passed | 2 skipped`), and the file passes in
isolation (4 passed).

The comparative reading says contention, not regression: the failing run took **361.97 s
real** at `(user+sys)/real = 0.777`; the green run took **281.70 s** at **0.974**. The host
was doing other work.

What is worth recording is *why the file's own retry did not absorb it*.
`everyRealRungCompleted` (`:329-333`) gates a re-spawn on whether each real rung had a
completed run to attest, and deliberately not on the strength — *"a rung that ran and printed
the wrong label must fail, not be spawned again until it agrees."* That line is right. But the
gate does not distinguish **completed at the redundancy it asked for** from **completed at
fewer replicas**, and a contended `real/2` rung that ran on one node prints `owner-attested`
honestly and then fails an assertion expecting `independent`. Criterion 3 keeps **MET** — the
job-result and demo-UI surfaces are unaffected and the CLI leg passes on an uncontended host —
but the gap between the gate's two categories is where this file will keep flaking.

---

### Test evidence for this amendment (exit codes read directly, no pipes, `EXIT=$?` on the next line)

| Command | Exit | Result |
|---|---|---|
| `npx tsc --noEmit` | **0** | no output |
| `npx vitest run --project node` (run 1) | **1** | 139 files, 7 failed / 1955 passed / 2 skipped; 361.97 s real, ratio 0.777 — see W11 |
| `npx vitest run --project node` (run 2) | **0** | 139 files, 1962 passed / 2 skipped; 281.70 s real, ratio 0.974 |
| `npx vitest run --project node --reporter=verbose` (run 3) | **0** | 139 files, 1962 passed / 2 skipped |
| `npx vitest run --project browser` | **0** | 243 files, 3819 passed, 40.48 s |
| `npx vitest run --project e2e` | **0** | 14 files, 65 passed, 194.75 s |
| `npx vitest run --project node quorum-agents --reporter=verbose` | **0** | 1 file, 4 passed, 10.35 s |
| `npx vitest run --project node bench-attestation --reporter=verbose` | **0** | 1 file, 4 passed (isolated) |
| **planted** `M40` → `quorum-agents` | **1** | `1 failed \| 3 passed`; `expected 'composed' to be 'not-composed'` at `:1064:34` |
| **planted** relay-keyed `listen` → `quorum-agents` | **1** | `1 failed \| 3 passed`; `expected 'via-relay' to be 'seed'` at `:804:47` |
| **planted** relay-keyed `listen` → `discovery-agents reservation-exhaustion` | **0** | 2 files, 3 passed — neither guards the change |

The two skips are both self-declaring and neither is silent: `transport-bounds.node.test.ts`
skips one case above a host-load threshold and names the number, and
`elf.real.node.test.ts` skips a case needing a distribution binary this repo did not build.

### Working tree

Both plants were restored with `cp` followed by `cmp` (exit 0 each), never
`git checkout --`. `git status --porcelain` produced no output before the first plant and
after the last restore. HEAD unchanged at `01a168b`. **No file in this repository was
modified by this verification except `19-VERIFICATION.md`.** `STATE.md` and `ROADMAP.md` were
read and not written.

---

_Amended: 2026-08-04T08:00:25Z_
_Verifier: independent goal-backward re-verification (gsd-verifier), adversarial stance_
_Two source mutations planted and restored; every exit code read directly on the line after the command._

---

## Second Amendment — 2026-08-04: the score stays 4/5, and criterion 5 becomes *deferred* rather than *escalated*

**Score: 4/5 criteria MET, 1 PARTIAL, 0 FAILED — UNCHANGED. Status: `gaps_found` → `human_needed`.**
Everything above is the record of the first two passes and is left standing. Nothing in it is
retracted except the four statements listed under *"What this pass measured false"* below.

Third independent pass. Re-verified at HEAD `cb01e76`; two commits landed mid-sweep (`03766a2`,
`3522812`, both verification artifacts of other phases) taking HEAD to `3522812`, and
`git diff --stat cb01e76 3522812 -- packages/` is **empty**, so every source measurement below
holds at both. Tree clean before and after. One source mutation planted and restored.

### Why this pass was run at all, and what it found

A phase verified before its dependencies were rewritten is a phase verified against a tree that
no longer exists. Between the 2026-08-04T08:00 amendment (HEAD `01a168b`) and this pass, Phase 20
wave 1 and a day of defect work rewrote three of the files criteria 1–4 rest on:

| file | change since `01a168b` |
|---|---|
| `packages/core/src/job/submit.ts` | **+719 / −16** — the production caller of `composeQuorum` |
| `packages/node/src/fabric-node.ts` | **+210 / −3** — the `canRelay` → `discoverability` chain, and the signing leg |
| `packages/browser/src/browser-node.ts` | **+197 / −17** — the `index` / `reservations` hooks, and the signing leg |

What did **not** change is worth stating first, because it bounds the risk:
`packages/core/src/quorum.ts`, `packages/node/src/bin/agent.ts`,
`quorum-agents.node.test.ts`, `owner-domain-agents.node.test.ts`, `bench-attestation.node.test.ts`,
`enrollment-cost.node.test.ts`, `core/src/enrollment.ts`, `attestation-ui.e2e.test.ts` and
`tab-refusals.e2e.test.ts` are all **byte-identical** to the tree that scored 4/5.

### Criterion verdicts

| # | 08:00 | now | How it was re-established |
|---|---|---|---|
| 1 | MET | **MET** | Behaviour re-run *and* falsifiability re-planted — see below |
| 2 | MET | **MET** | `owner-domain-agents` green; `ResultAttestor` still composed on both tiers, `'signs-nothing'` named absence intact |
| 3 | MET | **MET** | All three readings green in isolation **and** in a full uncontended sweep; W11 did not reproduce |
| 4 | MET | **MET** | `static-rendezvous` 5/5, `tab-refusals` 3/3, `attestation-ui` 4/4; both hooks re-derived by symbol |
| 5 | PARTIAL | **PARTIAL** | Unmoved and unmovable here. Disposition changes from *escalated* to *deferred* |

**Criterion 1 — the falsifiability survived the rewrite, and that is the finding.** The 08:00
amendment moved criterion 1 to MET on the strength of a plant. That plant tested `quorum.ts`, but
the *path* from the composer to the assertion runs through `submitJob`, which has since been
rewritten around a new `ShardGate` structure. A green assertion on a rewritten path is exactly the
shape that passes for a new reason. So `M40` was re-planted at this HEAD — `packages/core/src/quorum.ts`,
`  if (requireIndependentPaths) {` → `  if (false as boolean) {`:

| | |
|---|---|
| command | `npx vitest run --project node quorum-agents --reporter=verbose` |
| exit | **1** (`EXIT=$?` on the next line, no pipe) |
| result | `Tests  1 failed \| 3 passed (4)` |
| failure | `expected 'composed' to be 'not-composed'` |
| which case | *"criterion 1 engineered — one relay: caught by rule 2 and named by its relay"* — the **spawned** fabric |
| restore | `cp` then `cmp` → exit 0; `git status --porcelain` empty |

Identical signature, identical counts, identical case, on a tree whose composer's caller grew by 719
lines. `M40`'s ledger entry (`mutation-ledger.ts`, `id: 'M40'`) was read against this run and is
accurate — including its own statement of which three cases *cannot* redden and why that is by
construction. The mechanism was re-derived by symbol rather than trusted: `composeQuorum` is still
called from `submit.ts`; `onQuorumShortfall` still occurs exactly **three** times in that file — the
declaration and the two readers — which is the checkable claim its own docblock makes.

### Criterion 5 — how it should be recorded now

**It should be recorded as PARTIAL and DEFERRED. The score should read 4/5, not 5/5.**

The previous pass ended with an escalation offering two mutually exclusive routes: build a
per-identity price, or amend criterion 5's second clause. **Neither was taken.** A third was, and it
is better than both: the owner ruled on 2026-08-04 that admission is the guard — a node that cannot
authenticate with a provider-issued certificate does not join — and **carried the clause to Phase 24
criterion 8**, which is fully planned (`24-01`…`24-04`, `24-CONTEXT.md`) and deliberately scheduled
after phases 20–23. In the ROADMAP's own words this *"relocates the guard rather than lowering the
bar"*, and the reasoning is sound: a price only deters when the thing bought is worth something, and
under gated admission an unissued identity is worth nothing.

**Why that does not make it 5/5.** Criterion 5's text at `.planning/ROADMAP.md` was re-read this pass
and is **unchanged**, so RULING A applies exactly as written: *"The criterion text is NOT amended, and
the phase is NOT allowed to close on it… A criterion is not rewritten to let a phase close."* The
house precedent is thrice-applied, and one instance closed **while this pass was running**:

- Phase 17 criterion 2 → Phase 18 criterion 2d. Criterion 2 still scored PARTIAL; Phase 17 stayed
  uncounted at 1/3.
- Phase 16 criterion 3 → Phase 20 criterion 6.
- Phase 18 criterion 2b → Phase 20 criterion 1. It sat **PARTIAL at 8/9 for two days**, and moved to
  MET only when WIRE-04 **actually landed** in plan 20-01 and the armed tripwire fired — whereupon
  Phase 18 was re-verified and closed at 9/9 (commit `3522812`, landed during this sweep).

The pattern is unambiguous: **deciding a carry-forward does not raise a score; the destination phase
landing does.** Phase 24 has not run. Criterion 5 therefore stays PARTIAL, Phase 19 stays at 4/5, and
Phase 19 stays UNCOUNTED — and becomes 5/5 by re-verification on the day Phase 24 lands, exactly as
Phase 18 just did.

**What genuinely changes is the disposition, and it is not cosmetic.** Criterion 5 moves out of
`gaps:` and into `deferred:`. A gap is something an executor can be dispatched to close; this is not
one, and leaving it in `gaps:` invites a planner to route work at a phase the owner has explicitly
scheduled for later. The status moves `gaps_found` → `human_needed` for the same reason Phase 18's
did: nothing is missing that this phase can supply, and the only open question is *"may Phase 19 be
marked complete at 4/5 with criterion 5 carried"* — a scheduling judgement under an owner ruling,
which a verifier may not make for itself.

**What the first half of criterion 5 is worth, re-measured.** The unmintable half is not deferred —
it is delivered. `enrollment-cost.node.test.ts` passed at this HEAD (3 cases), and the residual the
ruling says must be *"measured and pinned, not argued away"* is measured:
`enrollment-dos.node.test.ts` passed 4/4, including the ratio readings and the case proving one
dialer can burn a three-certificate window and lock out an honest enroller by name.

### What this pass measured false

Four statements in this file, and three outside it. All are documentation; none changes a criterion.

**In this file.** The 08:00 amendment closed criterion 1 but left the initial pass's supporting tables
standing without a retraction marker, so the file now asserts both a thing and its negation:

1. *Executor-reported limits* table — **"`bin/agent.ts` cannot produce a `via-relay` node, so quorum
   rule 2 has no across-process reading | Confirmed"**. **FALSE at HEAD.** `agent.ts` declares
   `port: { type: 'string' }` with **no default**, and builds `listen` conditionally so that
   `--relay-addr` with no `--port` yields `[]`. Measured: the case *"criterion 1's precondition —
   `bin/agent.ts` can produce a node that binds nothing"* passes, and `M40` reddens the spawned fabric.
2. *Requirements coverage* table, VER-03 row — **"it has no across-process reading (criterion 1's
   gap)"**. FALSE for the same reason.
3. The criterion 5 **ESCALATION** section — *"Two mutually exclusive routes"*. Now stale: a third
   route was taken.
4. **W7, W8 and W9** are recorded as OPEN/NEW. All three are **CLOSED**, re-measured this pass — the
   line citations they flagged were replaced with grep-able symbols in `submit.ts`, in
   `static-rendezvous.e2e.test.ts`'s header and in the ROADMAP's criterion 4 note, which now states
   the general rule rather than another set of numbers.

**Outside this file — reported, not edited, as these are shared and other verifiers are live.**

- **`.planning/REQUIREMENTS.md`, VER-03 row — the serious one.** It states as fact: *"rule 2 has no
  across-process reading at all"*; that `bin/agent.ts` *"passes `listen: ['/ip4/127.0.0.1/tcp/${port}']`
  unconditionally and can therefore only ever produce a `seed` with empty `relayIds`"*; and that
  under `M40` *"only that fabric went red and the two spawned-agent fabrics stayed green"*. **All
  three are false**, and the third is contradicted by the `M40` ledger entry the row cites, which was
  updated by 19-19 and is correct. A requirements row and the ledger it cites disagree, and the row
  is the wrong one. `requirements-ledger.node.test.ts` pins no VER-03 text, so nothing guards it.
- **`.planning/STATE.md`.** `stopped_at` still reads *"Criterion 5 needs an OWNER RULING… both routes
  are open"* — the owner ruled, and took a route neither of them was. The open-rulings list further
  down still carries *"Phase 19 criterion 5 — enrolling must cost something an attacker cannot mint
  free"* as live. (The stale VER-03 sentences in the same field sit under the `WAS:` marker and are
  correctly historical.)
- **`.planning/ROADMAP.md`, Phase 19 entry.** It records **no** carry-forward to Phase 24 — `Phase 24`
  appears nowhere in it, while criterion 5's rationale paragraph still reads as live Phase 19 work.
  This is asymmetric with the established convention: Phase 18's own entry names its destination in
  place (*"WIRE-04 is **Phase 20 criterion 1**, so the work is already scheduled"*). Today the
  carry-forward is recorded only at the receiving end, in Phase 24's criterion 8 note. A reader who
  opens Phase 19 to ask why it is uncounted finds an unamended criterion and no explanation.
  Those two notes also disagree with each other in one phrase — one calls criterion 8
  *"replacing a stalled criterion in Phase 19"*, the other *"the answer to Phase 19's criterion 5
  **rather than a replacement for it**"*. The second is the one consistent with RULING A.

### The recorded Phase 19 limits, re-checked

| Recorded limit | Verdict now |
|---|---|
| VER-03 has no across-process reading of rule 2, because `bin/agent.ts` cannot produce a via-relay node | **REFUTED** — the `--port` default was removed by plan 19-19 and the listen list is now conditional. This was already superseded by the 08:00 amendment; what this pass adds is that `REQUIREMENTS.md` and this file's own tables never caught up |
| VER-04's gate is reached by no measured runnable entry point | **STILL TRUE** — `bin/bench.ts`'s only occurrence of `quorum` is a comment; it prints no quorum verdict |
| VER-09/VER-10 stay unticked because every reading is of a **public** job | **STILL TRUE** — `owner-domain` appears on no display surface. Its only production occurrences are the type, `classifyAttestation`'s return, and `describeAttestation`'s sentence. Both surfaces render the `description` field rather than calling `describeAttestation`, so its "no second production caller" claim also still holds |

### Test evidence (exit codes read directly on the next line, no pipes)

| Command | Exit | Result |
|---|---|---|
| `npx tsc --noEmit` | **0** | no output; `real 1.15` |
| `npx vitest run --project node quorum-agents owner-domain-agents` | **0** | 2 files, **5 passed** |
| `npx vitest run --project node bench-attestation enrollment-cost reservation-exhaustion` | **1** | 8 tests, 7 passed; the only failure is the `repoStatus()` hygiene case — see W13 |
| `npx vitest run --project e2e static-rendezvous attestation-ui tab-refusals` | **0** | 3 files, **12 passed** |
| `npx vitest run --project node enrollment-dos` | **0** | 1 file, **4 passed** |
| `npx vitest run --project node` (full sweep) | **1** | 143 files, **2058 passed** / 2 skipped; 1 failed — `repoStatus()` again, naming another verifier's `18-VERIFICATION.md`. `real 262.03`, `(user+sys)/real = 1.239` |
| `npx vitest run --project browser` | **0** | 246 files, **3927 passed** |
| **planted** `M40` → `quorum-agents` | **1** | `1 failed \| 3 passed`; `expected 'composed' to be 'not-composed'` on the spawned one-relay fabric |

**On the two red exits, read comparatively rather than absolutely.** Both are the same assertion, and
neither is Phase 19's. The full sweep ran at `(user+sys)/real = 1.239` against the 08:00 pass's
contended `0.777` and green `0.974`, so this host was *less* loaded than either — and W11's
load-sensitive `expected 'owner-attested' to be 'independent'` did **not** reproduce, which supports
the contention diagnosis rather than a regression. The three attestation readings criterion 3 rests
on passed in every run.

### Working tree

One mutation planted and restored with `cp` then `cmp` (exit 0), never `git checkout --`.
`git status --porcelain` empty before the plant and after the restore. **No file in this repository
was modified by this verification except `19-VERIFICATION.md`.** `ROADMAP.md`, `REQUIREMENTS.md` and
`STATE.md` were read and **not** written — every correction they need is reported above rather than
applied, because three other verifiers were live in this tree.

---

_Amended: 2026-08-04T19:40:00Z_
_Verifier: independent goal-backward third pass (gsd-verifier), adversarial stance_
_Score unchanged at 4/5. Criterion 5 deferred to Phase 24 criterion 8 under owner ruling; deferred is a disposition, not a pass._

---

## Third Amendment — 2026-08-07: criterion 5 is MET **with criterion 8's bound carried verbatim**, and the score is 5/5

**Score: 4/5 → 5/5 criteria MET (0 PARTIAL, 0 FAILED).** Everything above is the record of the
three passes of 2026-08-04 and is **left standing; nothing in it is retracted.** The frontmatter
above is **untouched** — it still reads `status: human_needed` and a `score:` block saying
*"4/5 criteria MET … UNCHANGED at the third pass"* — and both are **superseded by this amendment
rather than edited by it**, on the form `16-VERIFICATION.md` set on 2026-08-06 and
`24-VERIFICATION.md` repeated the same day. The frontmatter update is listed under
**LEDGER EDITS RECOMMENDED** below, because this pass was instructed to append and not to rewrite.

This is a re-verification triggered by the **destination phase landing MET**, on the pattern
`18-VERIFICATION.md` set on 2026-08-04 and `16-VERIFICATION.md` repeated on 2026-08-06. It is an
independent pass: **every reading below was executed in this verifier's own process.** Nothing is
transcribed from `24-VERIFICATION.md`, from any `-SUMMARY.md`, or from the amendment that closed
criterion 8. One mutation was planted, watched red, and restored.

**Re-verified:** 2026-08-07T04:19–04:28Z, at HEAD `1028cc1`, branch
`feature/phase-18-discovery-capacity-placement`
**Status:** `human_needed` — **not `passed`**, and for two reasons stated at the verdict rather
than in a footnote: the ledger edits below are ones a verifier may not apply, and the reading of
*"the fabric"* this closure **inherits** is itself awaiting owner ratification
(`24-VERIFICATION.md` human item 1). Phase 23's and Phase 24's precedent exactly.

---

### The verdict, and the bound it carries

| | |
|---|---|
| **Criterion 5** | **MET**, with the bound below carried **verbatim** from criterion 8 |
| Score | **5 / 5** |
| Phase | **human_needed** — every criterion satisfied; the open items are ledger edits and one inherited owner ratification |

> **THE BOUND THIS MET CARRIES, quoted verbatim from `24-VERIFICATION.md`'s amendment of
> 2026-08-06 and not paraphrased.** *"The default posture of `bin/agent.ts`, `bin/seed.ts` and
> `bin/bench.ts` is **open**, and must be: nineteen `bin/agent.ts` and three `bin/seed.ts` argv
> sites depend on it, and `reservation-exhaustion.node.test.ts` arm A is a **live behavioural
> guard** on it … Criterion 8 is MET **of a fabric an operator has closed**, and this repository
> ships open by default on purpose."* And the reading of the criterion's subject that MET rests
> on: *"**"The fabric" means a fabric this repository can be deployed and operated as, with an
> admission posture stated on every relay-capable door — not the default argv of its
> binaries.**"*

**A carried criterion cannot inherit more than its destination delivered.** Criterion 5 therefore
closes **of a fabric an operator has closed**, on exactly the reading criterion 8 closed on, and
**not** of the default argv of this repository's binaries. A closure that dropped that sentence
would be the softening RULING A exists to prevent, and it is repeated at the verdict, in the
score line, and in this amendment's closing paragraph so that no single deletion can lose it.

**The bound was checked at the source, not transcribed.** `bin/agent.ts:900-901` and
`bin/seed.ts:197-198` are the same ternary whose absent arm is the open literal
(`values['admit-issuer'] === undefined ? 'admits-any-peer' : new Set(...)`); `bin/bench.ts`
writes the open literal at `:1057`, `:1102` and `:1211` with no flag, and `bench-fabric.ts:534`
is a fourth site outside the binary; `seed-server.ts:329` reads `options.relayAdmission` and the
field at `:179` is **required with no `?`**. And `reservation-exhaustion.node.test.ts:284-317` is
the live guard it is claimed to be — arm A asserts `a.relays.length > 0` **and**
`expect(a.stderr()).not.toContain('PERMISSION_DENIED')` **before** B's capacity refusal is read,
with its own comment stating that a seed whose no-flag posture changed reddens there by name.

---

### Criterion 5's text is unchanged, checked rather than assumed

`.planning/ROADMAP.md:734` was extracted, normalised (leading `  5. ` stripped, `**` stripped,
whitespace collapsed, cut at the routing sentence) and byte-compared against the quotation this
file carries at `19-VERIFICATION.md:132` and again at `:162`: **`cmp` exit 0.**
`git log -L734,734:.planning/ROADMAP.md` returns **exactly one commit** — `3e1c03e` (2026-08-01,
*"docs(roadmap): two halves Phase 17 could not close, scheduled rather than assumed"*) — so the
line has never been edited since it was written.

> 5. **Enrolling a node costs an attacker something they cannot mint for free**, and the cost is
>    measured: creating the N-th fake identity is demonstrably more expensive than creating the
>    first. Routed here by owner ruling 2026-08-01 from Phase 17's AUTH-04, whose rate-limiting
>    half is proven and whose cost half is not

`criterion_text_unchanged: true`. **RULING A is honoured: this amendment reads the criterion, it
does not rewrite it, and no character of `ROADMAP.md` was touched by this pass.**

### The destination's text is unchanged too, and it landed MET

`.planning/ROADMAP.md:1189` was extracted and normalised against the quotation at
`24-VERIFICATION.md:173-176`: **`cmp` exit 0.** `git log -L1189,1189:.planning/ROADMAP.md` returns
**exactly one commit** — `3cc5a83` (2026-08-04, *"docs: Phase 24 — Certificate-Gated Admission,
scheduled later by owner ruling"*).

> 8. Enrolment's cost is bounded by admission, not by a counter: a node that cannot present a
>    provider-issued certificate cannot join the fabric, advertise itself, or be dialled by
>    another node — so an identity that was never issued buys nothing, and the N-th identity
>    costs an attacker a provider's willingness to sign it

Criterion 8 was re-scored **MET with a stated bound** by a dated amendment appended to
`24-VERIFICATION.md` on 2026-08-06 (commit `580e461`, **513 insertions and zero deletions**), after
four gap-closure plans (`68be6a9`, `afe8b0b`, `241a9cc`, `1b7f99d`) built the seed knob the first
pass had named as the one thing that would change its mind.

**One thing a reader must not be allowed to miss.** `24-VERIFICATION.md`'s **frontmatter is still
`status: gaps_found` and `score: 0/1 criteria MET — criterion 8 verifies PARTIAL`.** That is
deliberate and the amendment says so, but it means **any tool that reads criterion 8's disposition
out of frontmatter reads PARTIAL.** This closure rests on the amendment's **body**, which is where
the MET verdict lives, and this paragraph exists so nobody later reconstructs a contradiction from
the frontmatter alone. See L2.

---

### Do the clauses match? Asked of the source, not of the two roadmap sentences

Criterion 5's second clause was carried with a **three-part recorded gap**, quoted from this
file's own `gaps:` entry and from `ROADMAP.md:747-757`. Each part is scored separately, and two of
the three were never Phase 24's to answer.

| # | The recorded gap, quoted | Answered by | Status | Where it is measured |
|---|---|---|---|---|
| i | *"The N-th identity is **refused inside the window rather than priced**"* | **Phase 24 criterion 8** — the price of the N-th identity is a provider's signature, because an identity no door will admit is worth nothing | **MET, within the bound** | `enrolment-residual.node.test.ts` case 4 (3 issuances / 0 reservations); `closed-fabric-agents.node.test.ts` R2 (two uncertificated subjects, six closed doors, absent from all) |
| ii | *"the limit is keyed on `userKey`, which is one `ed25519.keygen()`"* | **Phase 19 itself**, by 19-05's aggregate `maxIssuedPerWindow` on the one quantity a request cannot rotate | **MET — never carried** | `enrollment-cost.node.test.ts` case 1: the second enroller under a **freshly generated** user key is refused by the **aggregate** reason and explicitly `not.toContain('has enrolled')` |
| iii-a | *"the budget is per provider **process**"* | **Phase 19 itself**, by 19-07's host-owned durable `IssuanceLedger` | **MET — never carried** | same case: provider stopped, asserted dead, **different pid** on the same `--dir`, still refuses |
| iii-b | *"so a second provider defeats it without a second key"* | **Phase 24 criterion 8** — a certificate from a provider a door does not pin buys nothing at that door | **MET, within the bound, and narrower than the bound states — see F1** | `admission-agents.node.test.ts` (`outsider`); `enrolment-residual.node.test.ts` (`wrongIssuer` reason); **caught by plant P1 below** |

**On (i), and it is the crux.** Criterion 5 asks for a *rising price*, and there is still no rising
price — my own re-reading of the residual is `perFreshIdentity` **3.0130**, inside the 2.96–3.16
band nine prior readings spanned and beside 24-04's 3.070 and the Phase 24 verifier's 3.0895. **An
attacker still mints a fresh identity for about a third of what the provider pays to refuse it,
and that is unchanged and is not presented here as improved.** What changed is what the minted
identity *buys*: at a door that has been told to close, nothing. That is a **relocation of the
guard by owner ruling of 2026-08-04**, recorded at both ends of the ROADMAP before Phase 24 was
verified, and it is not a verifier's reinterpretation. The house has now closed three carried
criteria on exactly this shape — 18's 2b, 16's 3, 17's 2 — and in 16's case the closing verifier
recorded a clause of the source criterion that is **causally inert** on the destination path and
closed anyway, with the reading stated. This amendment does the same thing and states the same
kind of reading.

**On (iii-b), which the parent instruction asked to be tested hard, and it is the one that could
have gone the other way.** It survives, and the whole of what makes it survive is the bound. Read
live off `admission-agents.node.test.ts` in this verifier's own run (`[per-relay]`, run 4):

```
gatedRelayPosture ["b6ee249…"]        provider "admits-any-peer"   otherProvider "admits-any-peer"
gatedRelayHolds   [ member ]
openProviderHolds [ outsider , reader ]
stranger  { relays: [] }
outsider  { relays: [ /…/p2p/<otherProvider>/p2p-circuit/p2p/<outsider> ] }
```

`outsider` holds a **real, verifiable certificate signed by a second provider** — asserted in the
same file as `outsider.certificate.issuer === otherProvider.issuerKey` and
`otherProvider.issuerKey !== provider.issuerKey`. At the door that pins the first issuer it holds
**nothing**. At the second provider — which is itself relay-capable and was told nothing — it
holds a circuit. **So a second provider still issues freely, and what it issues is worth nothing at
any door an operator has closed and everything at any door an operator has not.** That is the
bound, stated as a measurement rather than as a caveat, and it is why the bound must travel with
this closure rather than sit in a footnote.

---

### F1 — a real narrowing this pass found, unrecorded at either end. WARNING, not a blocker

**The whole-set reading and the wrong-issuer reading are two different readings, and they have
never been taken together.**

- `closed-fabric-agents.node.test.ts` takes the **whole-set** reading — six closed doors, absence
  asserted over the set with a live control — but its fixture stands up **exactly one provider**
  (`standUp` spawns `provider` twice, the first only to mint the issuer key), and **both** of its
  uncertificated subjects, `stranger` and `reader`, hold **no certificate at all**. There is no
  wrong-issuer subject in it.
- `admission-agents.node.test.ts` and `enrolment-residual.node.test.ts` take the **wrong-issuer**
  reading — an I₂ certificate refused where I₁ is pinned — but each does so at **one** door.

So *"a second provider's certificate buys nothing **anywhere in a closed fabric**"* is a
**composition of two readings, not a reading.** It is a sound inference — the gate is per-peer and
per-door, and `verifyCertificate(certificate, issuers, …)` is the same call at every door — but it
is an inference, and this repository's own standard is *"unmeasured is not met."*

**Why it is a WARNING and does not move the verdict.** It is a refinement **inside** the bound
already being carried, not a new kind of gap: at any door not closed, a wrong-issuer node and a
no-certificate node get in on identical terms — which `[per-relay]`'s `openProviderHolds
[outsider, reader]` shows in one line, one of each. And criterion 5's clause is about the **price**
of the N-th identity, not about the topology of refusal; the topology is criterion 8's subject and
its bound is stated. **The cheap repair, recorded so it is not rediscovered:** add a second
provider to `closed-fabric-agents.node.test.ts`'s fabric — closed, pinning I₁, so it is a door and
not a hole — and one arm enrolled against it, then assert that arm absent from all six doors
alongside `stranger` and `reader`. That would make the composition a reading. It is not requested
as a gap-closure plan.

---

### F2 — the standing *"verifies PARTIAL, not MET"* sentence: **addressed, not left standing**

The parent instruction flagged this as a possible blocker. Measured:

1. **The sentence is not in `24-VERIFICATION.md`'s own first-pass body.** `grep -n "not MET\|PARTIAL, not"`
   over lines **1–760** of that file returns **nothing**. The first pass recorded clause 5 as
   `PARTIAL` in a table and in its `gaps:` frontmatter; it never wrote that sentence.
2. **Its only occurrence in that file is at `:1126 — inside the amendment itself**, where the
   amendment quotes it *from `.planning/REQUIREMENTS.md`'s AUTH-04 traceability row* and names it
   **false in its stated cause**, recommending replacement as ledger edit **L3**:
   *"Its closing sentence — 'The N-th-identity clause therefore verifies PARTIAL, not MET … because
   admission is per-relay and every seed is structurally un-closable' — is false in its stated
   cause. Replace with the MET verdict **and its bound**."*
   **So the amendment does address it. It does not leave it standing.**
3. **L3 was then applied by `1028cc1`, and not as recommended.** The row today keeps the sentence
   as quoted history, qualifies its causal clause with *"at the time of that run"*, records that
   *"criterion 8 was re-scored **MET with a stated bound** on 2026-08-06 (`580e461`)"* — and then
   adds a sentence L3 did not ask for: *"The N-th-identity clause itself is unaffected by that and
   stays as written: what closed is the door, not the price … it is still not a rising cost per
   identity."*

**That added sentence is ambiguous, and the ambiguity is exactly where this could have failed.**
Read as *"AUTH-04's requirement text is not rewritten, and there is still no rising per-identity
price"* it is **true, and compatible with this closure** — it is the bound, restated. Read as
*"the PARTIAL verdict on the N-th-identity clause is unaffected"* it would **contradict** both
criterion 8's amendment and this one.

**The first reading is the one the author held, and it is not inferred — it is written in the same
commit.** `1028cc1`'s own message: *"17 AND 19 ARE NOT TICKED HERE AND THAT IS THE POINT. Both
carried their open criterion into criterion 8, so RULING A's precondition is now satisfied for both
— but each needs its OWN dated amendment on the 16/18 precedent, and each must carry criterion 8's
stated bound VERBATIM."* And `.planning/STATE.md:248-253` says the same in the body: *"17 and 19 can
now close too … each must carry the bound verbatim."*

**Verdict on F2: it does not block.** It is recorded as a WARNING with a one-sentence
disambiguation filed under **L4**, because a sentence that can be read as a live PARTIAL verdict
sitting in a permanent record is precisely the shape this repository has been bitten by.

---

### What this verifier ran, and read directly

Every exit code was captured with `EXIT=$?` on the line **immediately** following the command —
**no pipes, no trailing filter, no `tail`.** Host: 8 cores, 13 days uptime, 25 users, `uptime`
1-minute load recorded per row; **a sibling verifier was live in this same working tree throughout**
(see F5). `--project node` only, targeted paths only; `bench-attestation.node.test.ts` and
`discover-arm.node.test.ts` were **deliberately not run** — both snapshot `git status --porcelain`
around themselves and a concurrent agent's edit reddens them for reasons unrelated to any code.

| # | Command | Exit | Result | `/usr/bin/time -p` | ratio | load |
|---|---|---|---|---|---|---|
| 1 | `npx vitest run --project node enrolment-residual.node.test.ts --reporter=verbose` | **0** | **4 passed**; `[residual] perFreshIdentity 3.0130078689574917 perReplay 9472.836002377791` | `real 8.73 user 2.21 sys 0.49` | 0.31 | 10.93 |
| 2 | `npx vitest run --project node enrollment-cost.node.test.ts --reporter=verbose` | **0** | **3 passed** | `real 8.00 user 11.06 sys 2.06` | 1.64 | 10.77 |
| 3 | **plant P1** → `enrolment-residual.node.test.ts --reporter=verbose` | **1** | **3 failed \| 1 passed (4)** | — | — | 6.28 |
| 4 | `npx vitest run --project node admission-agents.node.test.ts --reporter=verbose` | **0** | **6 passed**; `[per-relay]` reading below | `real 38.55 user 31.73 sys 5.62` | 0.97 | 7.00 |
| 5 | `npx vitest run --project node closed-fabric-agents.node.test.ts --reporter=verbose` | **0** | **2 passed**; `[closed-fabric]` + `[closed-fabric bootstrap]` below | `real 19.32 user 9.87 sys 2.05` | 0.62 | 15.60 |
| 6 | `npx tsc --noEmit` | **0** | zero output | `real 1.31 user 2.04 sys 0.46` | — | — |
| 7 | `npx vitest run --project node quorum-agents owner-domain-agents --reporter=verbose` | **0** | **5 passed** — criteria 1 and 2 regression | `real 14.17 user 20.97 sys 3.74` | 1.74 | 11.14 |
| 8 | `npx vitest run --project node requirements-ledger acceptance-traceability` | **0** | **61 passed** — the pairing guards that redden on an overstatement | `real 1.89 user 1.45 sys 0.33` | 0.94 | 10.22 |

**Read the ratios comparatively, not absolutely.** Rows 1, 4 and 5 sit below 1.0 because they
spawn real `bin/agent.ts` processes and then *wait* — `real` legitimately exceeds CPU time for a
spawn-heavy spec, and row 1's 0.31 against row 2's 1.64 on the same host minutes apart is the
signature of waiting, not of starving. Row 5 took its reading at 1-minute load **15.60**, the
highest of the session, and still passed both cases; row 3's plant reddened at load **6.28**, the
lowest, so the red is not a contention artefact in either direction.

**Two load-bearing readings, reproduced in this verifier's own process rather than quoted:**

```
[closed-fabric]  postures  provider [4d65defd…]  seed "admits only peers certified by 1 pinned
                           admission issuer (from --admit-issuer): 4d65defd…"  relay [4d65defd…]
                           memberAtSeed [4d65defd…]  memberAtRelay [4d65defd…]
                           stranger [4d65defd…]  reader [4d65defd…]   openControl "admits-any-peer"
                 closedSetHolds  first  {provider [], seed [memberAtSeed], relay [memberAtRelay],
                                         memberAtSeed [], memberAtRelay []}   reader []
                                 second — byte-identical to first, 5 s later
                 openControlHolds  [ stranger , reader ]
                 strangerRelays    one circuit, through openControl and nothing else

[closed-fabric bootstrap]  status 200  cache-control no-store
                 peerAddrs [ seedAddr , seedAddr/p2p-circuit/webrtc/p2p/<memberAtSeed> ]
                 wantAbsent { stranger, reader }  — neither present
```

Six closed doors; two uncertificated subjects absent from all of them across two scans bracketing a
five-second window; both present at the one peer nobody closed, so the absence is a **refusal and
not inaction**; and the `/bootstrap.json` surface the browser tier consumes carries the enrolled arm
and nothing else. **This is the fabric-level reading criterion 5's closure inherits, taken here and
not transcribed.**

---

### Plant P1 — this verifier's own, **unledgered**, and neither `M66` nor `M67`

It targets the exact sub-clause the closure is weakest on: *a second provider defeats it.* One
line, inside `relayAdmissionGate`, at `packages/node/src/fabric-node.ts:961`:

```diff
       const verdict = verifyCertificate(certificate, issuers, Date.now())
-      if (!verdict.ok) return decide(false, `${peerId} refused: ${verdict.reason}`)
+      if (!verdict.ok) return decide(true, `${peerId} refused: ${verdict.reason}`)
       return decide(true, `${peerId} holds a certificate from a pinned issuer`)
```

Under it the gate **admits a certificate whose issuer it does not pin** — i.e. a second provider's
certificate buys a reservation — while every other check, every message and the whole option
surface stay byte-identical. It is the sharpest available test of whether the reading reads the
**issuer** or merely the **presence of a certificate**.

**It reads the issuer. Exit 1, three of four cases red.** Exact text:

```
Error: the identity the door itself minted staying out of the door’s reservation store stopped
holding after 853ms; observed {"reserved":["12D3KooWHVMd…","12D3KooWKnf6…"],"decisions":[
 {"peerId":"12D3KooWHVMd…","admitted":true,"reason":"… holds a certificate from a pinned issuer"},
 {"peerId":"12D3KooWKnf6…","admitted":true,"reason":"… refused: certificate issued by
  6efdbcdabfa5ab1697a422fa685e705ccb17e28dbf197bbb57480385e179f8bd, which is not a pinned
  provider"}]}
    at stays  packages/node/src/enrolment-residual.node.test.ts:186:13
    at        packages/node/src/enrolment-residual.node.test.ts:344:5

AssertionError: expected true to be false // Object.is equality
    at packages/node/src/enrolment-residual.node.test.ts:438:35
       expect(wrongIssuer?.admitted).toBe(false)

AssertionError: expected [ …(3) ] to not include '12D3KooWBfYS7bebk2xFF1aVu35xvJrTAtrdn…'
    at packages/node/src/enrolment-residual.node.test.ts:505:66
       for (const asker of askers) expect(door.reservedPeerIds).not.toContain(…)

Test Files  1 failed (1)
     Tests  3 failed | 1 passed (4)
```

**The decision record under the plant is the finding in one line:** `"admitted":true` beside
`"reason":"… certificate issued by 6efdbcda…, which is not a pinned provider"` — the door
announcing the refusal and granting the reservation anyway. That is precisely the world in which
*"a second provider defeats it without a second key"* is true, and the fixture turns red in it.

**The one case that stayed green is informative and is recorded rather than tidied away.** *"still
costs a provider more to refuse an identity than it costs an attacker to mint one"* passed under the
plant, at `perFreshIdentity 3.0130` in the clean run. **The ratio arm carries no admission claim and
must never be cited as evidence for one** — it measures the residual this phase does not remove, and
it is indifferent to whether the gate works.

**Restored, and the method was forced by the shared tree — see F5.** Restoration was a **surgical
inverse string replacement of this verifier's own line**, *not* a `cp` of a whole-file backup,
because a concurrent agent's plant had already landed in the same file once in this session and a
`cp` restore would have silently reverted work this verifier did not write. Verified afterwards by
`cmp <pre-plant copy> packages/node/src/fabric-node.ts` → **exit 0**, and
`git status --porcelain` → **empty**. Nothing was staged, committed, stashed or `git checkout --`'d
at any point.

---

### Regression: what was re-measured, and what was carried forward unre-measured

Stated plainly, because a score that moves on one criterion should say which of the others it
actually looked at.

| Criterion | This pass | Basis |
|---|---|---|
| 1 — quorum independence across `bin/agent.ts` processes | **re-measured MET** | run 7: all four `quorum-agents` cases green, including *"criterion 1's precondition — `bin/agent.ts` can produce a node that binds nothing"* and *"one relay: caught by rule 2 and named by its relay"* |
| 2 — owner-domain replica set, agreement labelled | **re-measured MET** | run 7: `owner-domain-agents` green — `owner-domain` with two of the owner's nodes live, `owner-attested` with one, off receipts those nodes signed |
| 3 — receipt reads owner-attested wherever displayed | **carried forward, NOT re-measured** | its CLI rung is `bench-attestation.node.test.ts`, which the parent instruction forbids running while a sibling verifier is live because it snapshots `git status --porcelain`. MET at three prior passes; W11 records it as load-sensitive |
| 4 — two tabs on the static bundle, nothing dialled by a harness | **carried forward, NOT re-measured** | deliberate restraint: three browser engines under a live sibling. MET at three prior passes |
| 5 — enrolment costs something unmintable, N-th vs first | **PARTIAL → MET, with the bound** | this amendment |

`tsc --noEmit` exit **0** (run 6). The two pairing guards that redden by name on an overstatement —
`requirements-ledger` and `acceptance-traceability` — are green at 61 tests (run 8) **with the
requirement checkboxes unmoved**, which is the state this amendment leaves them in.

---

### AUTH-04 does **not** tick, and that is the point

**Criterion 5 closing MET does not move AUTH-04's checkbox, and the two are not the same claim.**
AUTH-04's row stays `[ ]` and stays `Partial`: the enrolment DoS surface is untouched — measured
again here at `perFreshIdentity 3.0130` — the `serveAgent` `enrol` branch still takes no
authorization step, and the operational half (an operator noticing a starved provider, a fabric
re-pinning at scale) is still untested. **The house precedent is exact:** Phase 16 closed 4/4 on
2026-08-06 with MR-04 explicitly kept open by its own ROADMAP entry. A phase criterion and a
requirement row are different instruments, and `acceptance-traceability.node.test.ts` reddens by
name if a row overstates. Nothing here asks it to.

---

### New warnings raised by this pass

| id | where | issue | severity |
|---|---|---|---|
| **F1** | `packages/node/src/closed-fabric-agents.node.test.ts` | The whole-set reading has **one provider and no wrong-issuer subject**; the wrong-issuer reading is taken at **one** door. *"A second provider's certificate buys nothing anywhere in a closed fabric"* is a **composition of two readings, not a reading.** Repair named above and not requested as a plan | WARNING |
| **F2** | `.planning/REQUIREMENTS.md`, AUTH-04 row (line 694) | Post-`1028cc1` the row keeps *"verifies PARTIAL, not MET"* as quoted history **and** adds *"The N-th-identity clause itself is unaffected by that and stays as written."* The second sentence is ambiguous between *"the requirement text is not rewritten"* (true, compatible) and *"the PARTIAL verdict stands"* (would contradict criterion 8's amendment and this one). Disambiguate — **L4** | WARNING |
| **F3** | `.planning/ROADMAP.md:1140` and `:1142` | Progress rows **17** and **19** both assert *"24 landed 2026-08-06 and criterion 8 verified PARTIAL, so criterion 5/3 does NOT close."* **False since `580e461`**, and row **24** at `:1147` — corrected by the same commit that left these two — now says the opposite three lines below them. Two permanent records asserting the negation of their neighbour — **L3** | BLOCKER for the ledger, not for the phase |
| **F4** | `packages/libp2p/src/relay-admission.ts:81-83` and `:95-96` | Still asserts *"`24-VERIFICATION.md` scores criterion 8 PARTIAL on exactly that"* and *"What criterion 8 still turns on is a reading over a **fabric** rather than over one relay, and that reading is not this mechanism's to make."* Both stale since `580e461` / plan 24-07. This file has corrected two prior claims **in place with the replaced text quoted**, for the reason it states twice — *a comment asserting a mechanism is inert is the exact shape this repository has been bitten by* — and it is now the file needing that treatment a third time. **Phase 24's residue, reported not scored** | WARNING |
| **F5** | working tree | **Measured, twice.** A concurrent agent planted `&& expected === ''` into `packages/node/src/fabric-node.ts:949` **between this verifier's `git status --porcelain` returning empty and its own edit of the same file**, producing a two-hunk diff on a one-line plant; and modified the same file again during run 8. CLAUDE.md's *"restore a planted mutation with `cp` + `cmp`"* assumes **exclusive ownership of the file at that moment**, and that assumption was false twice in one session. The safe form under concurrency is the **surgical inverse of one's own edit, then `cmp` against the pre-plant copy** — a `cp` restore here would have reverted ~1 line of another agent's live work with the tree looking clean afterwards | WARNING — a process finding, and it generalises |
| **F6** | `packages/node/src/peer-gate.node.test.ts:24` | *"Gating dispatch candidate selection, quorum membership and **relay use** is **UNMEASURED**, not descoped."* **Relay use is now measured** — Phase 24 armed `denyInboundRelayReservation` and read it over six doors. W12 named this docblock as the only in-spec record of the open front door; it is now stale in the opposite direction | WARNING |
| **F7** | this file, W12 | **W12 stands, and its point is now demonstrated rather than argued.** It recorded that criterion 5's carry-forward *"names nothing"* that goes red when Phase 24 lands. Phase 24 landed; **nothing went red.** This closure was collected by a human-directed re-verification, not by a tripwire. The house rule — *"a scheduled clause is only scheduled if something red arrives to collect it"* — was **not** satisfied, even though the outcome is correct. Recorded because the next carry-forward will be argued from this one | INFO, and it is the shape worth keeping |

---

## LEDGER EDITS RECOMMENDED (not applied)

**This verifier modified no source, ledger, roadmap or state file.** `.planning/STATE.md`,
`.planning/ROADMAP.md` and `.planning/REQUIREMENTS.md` were **read and not written** — a verifier
may not apply the edits it recommends, and a sibling verifier was live in this tree throughout. The
only file written by this pass is `19-VERIFICATION.md`, appended to.

**L1 — this file's own frontmatter.** `status:` should read `human_needed` (unchanged) and the
`score:` block should record **5/5 criteria MET, 0 PARTIAL, 0 FAILED**, by this dated amendment,
**with the bound**. The `gaps:` entry for criterion 5 and the `deferred:` entry for it are both
superseded; on the `16`/`24` form they are left standing and this amendment supersedes them, but a
machine reading the frontmatter still reads 4/5. This pass was instructed to append and not to
rewrite, so the edit is recommended rather than made.

**L2 — `.planning/phases/phase-24-certificate-gated-admission/24-VERIFICATION.md` frontmatter.**
Still `status: gaps_found` / `score: 0/1 criteria MET — criterion 8 verifies PARTIAL`, superseded
by its own body since `580e461`. Same class as L1 and the more urgent of the two, because **this
closure depends on criterion 8's disposition** and anything reading it out of frontmatter reads
PARTIAL.

**L3 — `.planning/ROADMAP.md`, progress rows 17 (`:1140`) and 19 (`:1142`). URGENT, and this is F3.**
Both assert in the present tense that criterion 8 verified PARTIAL and that their carried criteria
therefore do not close. Both were true when written and are false since `580e461`. Row 24 three
lines below already says so. Recommended for row 19, dated 2026-08-07, on the *quote-what-you-replace*
practice this repository uses:

> `19/19 | **Complete — 5 of 5 criteria.** Criterion 5's second clause was carried to Phase 24
> criterion 8 by owner ruling 2026-08-04; criterion 8 landed **MET with a stated bound** on
> 2026-08-06 (`580e461`), so RULING A's precondition is satisfied and criterion 5 closes by dated
> amendment to `19-VERIFICATION.md`, 2026-08-07 — re-measured, not transcribed:
> `criterion_text_unchanged: true` (`cmp` exit 0, `git log -L734,734` one commit), one plant watched
> red and restored by inverse-edit + `cmp`. **THE BOUND, CARRIED VERBATIM:** the default posture of
> `bin/agent.ts`, `bin/seed.ts` and `bin/bench.ts` is open and must be — 19 + 3 argv sites, with
> `reservation-exhaustion` arm A a live behavioural guard — so criterion 5 closes **of a fabric an
> operator has closed**, never of the default argv of its binaries. There is still **no rising price
> per identity** and the enrolment DoS residual is unchanged at `perFreshIdentity` 3.0130;
> **AUTH-04 stays `[ ]` and stays `Partial`.** WAS: *"24 landed 2026-08-06 and criterion 8 verified
> PARTIAL, so criterion 5 does NOT close"* — true when written, false since `580e461` | 2026-08-07`

Row 17 needs the same correction; **Phase 17's own closure is not this amendment's to make** and
belongs in a dated amendment to `17-VERIFICATION.md`, carrying the same bound verbatim.

**L4 — `.planning/REQUIREMENTS.md`, AUTH-04 row (line 694). This is F2.** Keep every clause about
the untouched enrolment DoS surface — nothing here shrank it and this amendment's own reading
confirms it. **Disambiguate the one added sentence**, e.g.: *"The N-th-identity clause is unaffected
as a **mechanism** — what closed is the door, not the price, and there is still no rising cost per
identity. **As a verdict it did close**: Phase 24 criterion 8 is MET with a stated bound, and Phase
19 criterion 5 closed on it by dated amendment 2026-08-07, of a fabric an operator has closed."*
And append this pass's independent reading: `perFreshIdentity` **3.0130**, a third host-condition
inside the 2.96–3.16 band.

**L5 — `.planning/STATE.md`.** The count moves **10 → 11 of 15** on Phase 19 alone, and to **12 of
15** if Phase 17's own amendment is written and scores as `24-VERIFICATION.md` expects. The
frontmatter `stopped_at` still carries the pre-`580e461` text — *"SO PHASE 19 CRITERION 5 AND PHASE
17 CRITERION 3 DO NOT CLOSE EITHER … its destination landed PARTIAL"* — which the body at
`:248-253` already contradicts. Uncounted drops to 20 (6/7), 21 (2/3), 22 (not executed), and 17
until its amendment is written.

**L6 — `packages/libp2p/src/relay-admission.ts` (F4) and `packages/node/src/peer-gate.node.test.ts:24`
(F6).** Two source comments now false in the present tense, both governing a reader's conclusion.
Correct **in place with the replaced text quoted**, which is `relay-admission.ts`'s own established
practice at two prior corrections. Not planning-ledger edits, but due in the same sweep.

### MUST NOT change

- **Criterion 5's wording, and criterion 8's.** Both verified unedited, one commit each, both
  `cmp`'d against their quoted copies at exit 0. This amendment reads criterion 5 and states the
  reading; it does not narrow it. If the owner disagrees, the instrument is an `overrides:` entry or
  a dated owner note beside the criterion — **not** a change to its words.
- **The stated bound, in either direction.** It must not be dropped from any record that inherits
  this closure, and the default posture must **not** be closed to make the criterion read better:
  that is `24-CONTEXT.md` open ruling 1 and it is the owner's, and
  `reservation-exhaustion.node.test.ts` arm A reddens by name if it moves.
- **AUTH-04's checkbox and its `Partial` cell.** Live clauses remain and the pairing guard reddens
  on an overstatement.
- **This file's first three passes.** 513 lines of prior record, appended to and not rewritten.

---

### Human verification required

1. **Ratify — or reject — the inherited reading of *"the fabric"*.** This closure is downstream of
   `24-VERIFICATION.md` human item 1, which is **still open**. If the owner intends the wider
   reading (*any fabric this repository can be deployed as, including a default-argv one*),
   criterion 8 returns to PARTIAL **and criterion 5 returns to PARTIAL with it**, and Phase 19
   returns to 4/5. A verifier may not settle it, and this amendment does not pretend to: it inherits.
2. **Confirm that closing criterion 5 on a relocated guard is the ruling's intent.** There is still
   no rising price per identity and this amendment says so three times. What closes it is the owner
   ruling of 2026-08-04 plus its destination landing MET — the 16/17/18 pattern applied a fourth
   time. If the owner reads criterion 5 as demanding a graduated cost *irrespective* of the
   relocation, it stays PARTIAL and the correct instrument is an `overrides:` entry, not an edit.
3. **Apply L1–L6.** L2 and L3 are urgent: three permanent records currently assert in the present
   tense that criterion 8 verified PARTIAL, and one of them sits three lines above the row that says
   it did not.
4. **Write Phase 17's own amendment (L3, row 17), with the bound carried verbatim.** Not this
   amendment's to make.
5. **Decide whether F1's cheap repair is worth a plan** — a second, closed provider and one arm
   enrolled against it inside `closed-fabric-agents.node.test.ts`, turning a composition into a
   reading.
6. **Rule on F7.** Nothing went red when Phase 24 landed. Either arm a tripwire for the remaining
   carry-forwards or record that none is required — the rule was stated by Phase 20's own note and
   this is the second carried criterion to close without one.

---

### Gaps summary

**There are no gaps in this phase's own criteria.** All five are MET; criterion 5 is the last, and
it closes on its destination landing rather than on a rewrite — its text is byte-identical to the
day it was written, and so is its destination's.

What is **not** delivered, and is not delivered on purpose, is a rising price per identity. There
is none, there never was one in this design, and this amendment measured the economics again rather
than assuming them: an attacker still mints a fresh identity for about a third of what a provider
pays to refuse it. What changed is that the identity is worth nothing at a door an operator has
closed — and **only at a door an operator has closed.** This repository ships open by default, held
there by nineteen plus three argv sites and one live behavioural guard, and whether it should is an
owner ruling deliberately left unplanned.

**That is the bound criterion 8 stated, it is carried here verbatim, and criterion 5 inherits
exactly it and no more.**

---

_Amended: 2026-08-07T04:28:00Z, at HEAD `1028cc1`; tree clean before the plant and after the
restore, verified by `cmp` exit 0 and `git status --porcelain` empty._
_Verifier: independent goal-backward fourth pass (gsd-verifier), adversarial stance._
_No source, ledger, roadmap or state file was modified. Nothing was staged, committed, stashed, or
`git checkout --`'d. One mutation planted, watched red, and restored by inverse edit — not by `cp`
— because a concurrent agent was writing the same file._
_**Score 4/5 → 5/5. Criterion 5 MET of a fabric an operator has closed, not of the default argv of
this repository's binaries.**_
