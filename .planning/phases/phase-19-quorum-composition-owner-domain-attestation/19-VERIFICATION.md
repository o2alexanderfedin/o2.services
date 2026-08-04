---
phase: 19-quorum-composition-owner-domain-attestation
verified: 2026-08-04T03:46:29Z
status: gaps_found
score: >-
  4/5 criteria MET (1 PARTIAL, 0 FAILED) — amended 2026-08-04T08:00:25Z.
  The 2026-08-04T03:46 initial pass scored 3/5 MET (2 PARTIAL); plan 19-19 closed
  criterion 1 and its closure was re-executed rather than accepted. See the Amendment.
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
    status: partial
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
  - item: "Nothing an operator can run mints a capability chain, so the sovereign discovery path is spec-only (deferred-items.md item 5)"
    addressed_in: "Phase 23"
    evidence: "Phase 23 success criterion 5: 'bin/bench.ts gains an opt-in sovereign leg, off by default, that mints a real capability chain and dispatches an owner-labelled shard through it — giving delegate and CapabilitySupplier a traced call path from a runnable entry point'"
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
    status: NEW 2026-08-04
    where: "packages/core/src/job/submit.ts:126"
    what: >-
      W1's fix cites '`:802-803` of this file, and nowhere else — confirmed by grep'. The
      readers are at :816-817. The correction's own commit (febd107) added 28 lines and
      removed 10 in that same docblock, net +14, so the number it states was true only
      before its own edit landed. Same class as 18-VERIFICATION.md's F-2, one phase later.
      One line off the same paragraph — 'the reader 670 lines below' — is also now 658.
  - id: W8
    status: NEW 2026-08-04
    where: "packages/node/src/static-rendezvous.e2e.test.ts:43"
    what: >-
      Cites `browser-node.ts:1201` as the site of `reservations: 'relays-for-nobody'`.
      That line is a duty-cycle comment ('is the whole of that requirement on this tier.');
      the hook is at :1389 today and was at :1388 when febd107 landed. It was wrong when
      written, it was NOT one of the three citations febd107 corrected in that header, and
      the sentence febd107 added six lines below it says 'Four line citations in this
      header had drifted and were re-checked against the tree on 2026-08-04.'
  - id: W9
    status: NEW 2026-08-04 — not 19-19's error
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
