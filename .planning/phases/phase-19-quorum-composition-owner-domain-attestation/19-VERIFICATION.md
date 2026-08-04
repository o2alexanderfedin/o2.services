---
phase: 19-quorum-composition-owner-domain-attestation
verified: 2026-08-04T03:46:29Z
status: gaps_found
score: 3/5 criteria MET (2 PARTIAL, 0 FAILED)
verifier: independent goal-backward pass, adversarial stance
re_verification: false
runs:
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
gaps:
  - criterion: 1
    truth: "A verification quorum assembled during a job run through bin/agent.ts rests on no single shared reachability dependency — a run whose members all hang off the same relay is refused rather than silently accepted"
    status: partial
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
      score under that reading.
    artifacts:
      - path: "packages/core/src/enrollment.ts:507-523"
        issue: "the aggregate budget refuses past maxIssuedPerWindow; nothing prices an identity"
      - path: "packages/node/src/enrollment-cost.node.test.ts:41-47"
        issue: "the spec's own header names this reading and asks for PARTIAL"
      - path: ".planning/ROADMAP.md:790-797"
        issue: "'nothing in this phase delivers one — no such price exists in this design and none was built'"
    missing:
      - "Either a mechanism that makes the N-th identity cost more than the first (proof-of-work, an escalating stake), or an owner ruling amending criterion 5's second clause to the bound-made-durable reading. RULING A forbids the second being done silently."
      - "A measured mitigation for the DoS the budget opened: serveAgent answers enrol with no authorization step, so one dialer can burn a provider's whole window at one ed25519.keygen() per attempt. The recovery half is half-measured (a second provider certifies, and a peer pinning only the first refuses untrusted-issuer); the operational half is untested and is pinned by no mutation-ledger entry."
deferred:
  - item: "Nothing an operator can run mints a capability chain, so the sovereign discovery path is spec-only (deferred-items.md item 5)"
    addressed_in: "Phase 23"
    evidence: "Phase 23 success criterion 5: 'bin/bench.ts gains an opt-in sovereign leg, off by default, that mints a real capability chain and dispatches an owner-labelled shard through it — giving delegate and CapabilitySupplier a traced call path from a runnable entry point'"
warnings:
  - id: W1
    where: "packages/core/src/job/submit.ts:124-130"
    what: "A stale docblock heading '## Nothing reads this field yet' on onQuorumShortfall, contradicted by :802-803 in the same file, which is the only place that reads it. 19-18 landed the field in wave 3, 19-06 landed the reader in wave 4, and the doc was never updated."
  - id: W2
    where: ".planning/ROADMAP.md:693-698, .planning/REQUIREMENTS.md:656"
    what: "Line citations for the index/reservations hooks have drifted. ROADMAP cites browser-node.ts:1178/:1201 and fabric-node.ts:1578/:1601; REQUIREMENTS cites fabric-node.ts:1566 and browser-node.ts:1164. Actual: browser-node.ts:1337/:1388, fabric-node.ts:1672/:1695. The wiring exists; only the citations are stale."
  - id: W3
    where: "packages/node/src/static-rendezvous.e2e.test.ts"
    what: "Criterion 4 names two hooks. reservations is read (findReservedPeers asks every connected peer; asked: true). index is NOT read anywhere in this file — discovery uses reservations exclusively (demo/main.ts:149-201), computePeers sends an offer (main.ts:743), and the tabs are unenrolled so peerCertificate returns before asking (main.ts:268). The ROADMAP's inline note that this file 'takes both readings' overstates it. The index hook IS read off a live tab in a sibling file from the same phase (tab-refusals.e2e.test.ts:371,377), which is why criterion 4 still scores MET."
  - id: W4
    where: ".planning/ROADMAP.md:643"
    what: "Phase 19's Requirements line omits AUTH-04, though criterion 5 is entirely AUTH-04's cost clause. Filed as deferred-items.md item 8; the executor was blocked from editing ROADMAP.md. Bookkeeping only."
  - id: W5
    where: "packages/node/src/mutation-ledger.ts:1102 (M45)"
    what: "The ledger's own weakest entry — its only recorded signature is 'expected false to be true', which a flake could produce, and the summary did not record which of two degrading fabrics spoke. Self-declared in the entry's why."
  - id: W6
    where: ".planning/phases/phase-19-.../19-12-SUMMARY.md:177-199"
    what: "Six planted instruments are deliberately absent from the mutation ledger because no failure text was recorded, and 19-18's optional-onQuorumShortfall plant is unencodable because its runner is tsc. Structurally consistent with problemsWith()'s rules and with Mutation's shape, but this verifier did not re-execute any of the seven plants (source mutation was out of scope for a read-only pass)."
---

# Phase 19: Quorum Composition & Owner-Domain Attestation — Verification Report

**Phase goal:** Verification quorums compose under anti-affinity with a backbone-anchored replica,
owner-domain agreement is labelled distinctly from independent-operator agreement, and two browser
tabs on a static bundle find each other with nothing dialed by a harness

**Verified:** 2026-08-04T03:46:29Z (HEAD `fc5a5ad`, branch `feature/bug-fixes-22`, tree clean)
**Status:** gaps_found
**Score: 3/5 criteria MET, 2 PARTIAL, 0 FAILED**

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
