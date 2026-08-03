# Phase 19: Quorum Composition & Owner-Domain Attestation - Context

**Gathered:** 2026-08-02
**Status:** Ready for planning

<domain>
## Phase Boundary

Verification quorums compose under anti-affinity with a backbone-anchored replica; owner-domain
agreement is labelled distinctly from independent-operator agreement, and that label reaches
every surface a job result is displayed on; two browser peers on a static bundle find each
other without a harness dialling for them.

**Read the scouting findings below before planning. The ROADMAP's `Research: None` for this
phase is wrong on two counts**, and both change what the plans must contain.
</domain>

<decisions>
## Implementation Decisions

### The backbone-anchored replica — VER-03 needs BUILDING, not wiring

- **`composeQuorum` does not implement it today.** It sorts candidates by `relayIds.length`
  ascending (`packages/core/src/quorum.ts:140-142`) and refuses on a *shared* relay via
  `sharedRelay` (`:169`). **Nothing requires a member that is backbone-anchored.** There is no
  `backbone` symbol anywhere in `packages/*/src` — the only occurrences are prose in
  `libp2p/src/constants.ts:13,85`, `fabric-node.ts:34` and `sovereignty.ts:46`.
- **Decision: derive it from `discoverability`, not from a new certificate field.** A node whose
  `discoverability` is `seed` is the backbone marker the fabric already understands, and
  `composeQuorum` gains a rule requiring at least one such member.
- **Why this shape and not an explicit `backbone` field.** The project's cardinal rule is that
  **all nodes have equal functionality and the only difference is discovery.** Backbone-anchored
  is therefore a statement about *discovery*, which the certificate already carries. A new
  explicit field would mint a second concept beside `discoverability` and would read as a node
  tier — the one thing a decision here is forbidden to introduce.

### `composeQuorum` has a latent defect aimed straight at criterion 2

- **It returns `strength: 'independent'` unconditionally** on its ok arm
  (`packages/core/src/quorum.ts:159`) and **never calls `classifyAttestation`** — which exists,
  at `:202`, and is the only place the three labels are computed.
- Wire it as-is and every quorum reports `independent`, **including the owner-domain ones**.
  That is precisely the conflation criterion 2 exists to forbid, so this is a Phase 19 fix and
  not a follow-up.
- `classifyAttestation`'s rule, for reference: `<=1 operator → 'owner-attested'`; `>=2 operators
  → 'independent'`; otherwise `'owner-domain'`.

### `composeQuorum` can NEVER return `owner-domain`, so criterion 2 must not run through it

**Added 2026-08-02 during planning. This is the most likely way to get this phase wrong**, and
nothing in the ROADMAP or in the rest of this file says it.

`composeQuorum` reduces its candidates to **one certificate per operator, by construction**
(`packages/core/src/quorum.ts:123-126`) — the comment there says so outright: *"Taking the first
per operator … is what makes 'no two from the same operator' a property of the construction
rather than a check bolted on after."*

`classifyAttestation` returns `'owner-domain'` only for **two or more certificates sharing one
operator**. Those two facts are incompatible: after the per-operator reduction there is exactly
one certificate per operator, so the `owner-domain` arm is unreachable through `composeQuorum`,
and a sovereign shard routed through it would be **refused with `insufficient-operators`**.

**Criterion 2 therefore runs through `resolveReplicaSets` + `attestationReceipt`, not through
`composeQuorum`.** A planner who wired "quorum composition" uniformly across both criteria would
have made criterion 2 unreachable while every unit test stayed green — the two mechanisms answer
different questions:

| | asks | admits |
|---|---|---|
| `composeQuorum` | who may verify *together* | one node per operator, anti-affinity by construction |
| `resolveReplicaSets` + `attestationReceipt` | how strong is the agreement we *got* | several nodes under one owner, which is the whole point |

The gate belongs at the composition site: quorum composition applies to `label === 'public'` with
`redundancy >= 2` and all candidates certificated. Sovereign shards take the replica-set path.

### The certificate seam — widen `NodeDescriptor` where the certificate is already in hand

- **The type gap.** `composeQuorum`, `attestationReceipt` and `resolveReplicaSets` all take
  `NodeCertificate[]`. `submitJob`'s path carries `NodeDescriptor`
  (`packages/core/src/sovereignty.ts:39`) — `{nodeId, ownerId, canExecuteSovereign, load}`, with
  no certificate, no operator, no relays, no discoverability. **None of the three can be called
  anywhere on the current path.**
- **Decision: widen `NodeDescriptor` at `packages/net/src/discover-candidates.ts:161-186`**,
  which already holds the certificate and deliberately discards everything but
  `certificate.userKey`. One seam, no `JobSpec` change.
- **Why not thread certificates through `JobSpec`.** Four production submitters would each have
  to supply them (`bin/bench.ts:759`, `packages/bench/src/perf-workload.ts:345`,
  `packages/browser/demo/main.ts:449` and `:682`), and a caller that forgot would get silent
  degradation — the exact shape WIRE-01 exists to prevent.
- **Why not a parallel `nodeId → certificate` map.** A second source of truth that can disagree
  with `NodeDescriptor`, with nothing able to catch the disagreement.

### Owner-id unification is this phase's, and the tree already says so

- A discovery-derived descriptor's `ownerId` is `certificate.userKey` (hex), while `OwnerId` is
  an opaque string and `--owner-id` takes an operator label. Two different things in one field.
- `packages/net/src/discover-candidates.ts:46-58` and
  `packages/node/src/sovereignty-placement.node.test.ts:279-284` **both already assign this to
  AUTH-05 / Phase 19 by name.** Do not rediscover it; close it.

### The receipt reaches all three display sites

- **No receipt slot exists anywhere.** `ShardResult` (`packages/core/src/job/submit.ts:121`) and
  `JobResult` (`:153`) have no `strength`/`receipt` field, and `VerificationResult`'s `agreed`
  arm (`packages/core/src/job/verify.ts:85-95`) carries `agreeing: readonly string[]` — node
  **ids**, not certificates.
- **Decision: all three sites carry it** — `JobResult`/`ShardResult`, the CLI
  (`bin/bench.ts`'s `Observation`, `:860-873`), and the demo UI
  (`packages/browser/demo/index.html:367-383`, sourced from `TabJobReport` /`TabColouringRun` in
  `packages/browser/src/tab-api.ts:37-66` and `:145-160`).
- **Why not defer the display half.** Criterion 3 says the receipt reads owner-attested
  *"wherever it is displayed"*. A receipt nothing renders is **built, not wired** — the single
  condition this entire milestone exists to eliminate, reappearing in a new place.
- The only place a receipt is built and asserted today is a spec that constructs it itself:
  `packages/net/src/sovereign-execution.test.ts:329` and `:464`. **No node emits one.** That file
  is the closest existing prototype of criteria 2 and 3.

### Criterion 4 — the relay answers rendezvous; tabs keep the sentinel

- **`browser-node.ts:1187` supplies `reservations: 'relays-for-nobody'` — a named absence.**
  `FabricNode` supplies a real thunk (`fabric-node.ts:1589`). So **a tab cannot answer another
  tab's rendezvous**, and criterion 4's phrase *"the wired `index`/`reservations` hooks"* is
  half-true: `index` is genuinely wired (`browser-node.ts:1164`, byte-identical to the Node
  tier's), `reservations` is not.
- **Decision: two tabs discover each other by both asking the relay**, which is a `FabricNode`
  holding a real thunk. No browser-tier protocol change. This matches the recorded constraint
  requiring *"a locally-started Circuit Relay v2 peer to dial"*.
- **This is not a node-class decision and must not be planned as one.** A tab holds no
  reservations of its own, so a tab answering `reservations` would be reporting on peers it
  learned from a relay — a different claim than the hook makes. The asymmetry is about *what
  each node knows*, not about what it is permitted to do.
- **Criterion 4's wording should be corrected to name `index` alone**, in the same pass, rather
  than left to read as though both hooks were wired on both tiers.

### The signing triangle — owner decision 2026-08-02, and it settles criterion 5

**Two of the three legs already exist. The phase adds the third.**

| leg | who signs | verified against | status |
|---|---|---|---|
| the **code** a node runs | the service provider (publisher) | `NameResolver`'s pinned `trustAnchors` (`packages/core/src/naming.ts:99-103`); `guardModuleProvenance` composed at every executor construction site | **exists** (Phase 14) |
| the **node's certificate** | the service provider (issuer) | `verifyCertificate` against `trustedIssuers`, refusing `untrusted-issuer` by name (`packages/core/src/enrollment.ts:340-352`) | **exists** (Phase 17) |
| the **result** a node returns | the node, with its node key | the `nodeKey` in its own certificate, which the provider signed | **MISSING — this phase adds it** |

**What the third leg buys, and why it is not cosmetic.** Agreement is attested today by
**transport authentication only** — Noise proves peer X sent this frame, but that proof is not
transferable and cannot be shown to anyone else. `VerificationResult`'s `agreed` arm carries
`agreeing: readonly string[]` — **plain node-id strings**
(`packages/core/src/job/verify.ts:85-95`). A receipt built on that is worth exactly the
submitter's word about itself, which is not what VER-08/09/10 promise.

With results signed, a third party holding **only the provider's public key** can verify: *this
result came from a node that provider enrolled, running code that provider published.* That is
what makes `attestationReceipt` a transferable attestation rather than a self-report.

**Criterion 5 is answered by this architecture, not by proof-of-work.** The scarce thing an
identity must present already exists — **a provider-issued certificate**, which an attacker
cannot mint because `verifyCertificate` refuses an untrusted issuer. What is broken is that
**issuance is not scarce**, and Phase 17 measured exactly how: the limit is keyed on `userKey`,
which is one `ed25519.keygen()`, and the budget is per provider **process**, so a second
provider process resets it.

So criterion 5's work is **one thing**: a **persistent, cross-process issuance budget**, closing
the hole Phase 17 named. The N-th fake identity costs a fresh issuance against a budget that does
not reset. Measured across processes **and a provider restart** — the restart is the load-bearing
reading, because a per-process budget passes every other one.

**Certificate lifetimes are NOT part of the cost argument — owner correction 2026-08-02.** An
earlier draft of this section also called for *short* lifetimes. That was over-engineering, and
the reason is that **the attack radius is far too small to justify it**:

- Results are signed and attributable, so a bad result names its author.
- Integrity rests on **N-version comparison, not on trusting an identity**. A single fake node
  cannot change an answer; it can only disagree and be caught.
- `composeQuorum` already enforces anti-affinity by `operatorId` — one certificate per operator
  by construction (`quorum.ts:123-126`) — so **N sybils under one operator buy exactly one
  quorum slot.**
- Sovereign data never leaves the owner's node, so a fake node cannot exfiltrate anything by
  being admitted.

Net: a sybil attacker can waste compute and be refused. **That is a nuisance, not a breach.**
Relatively long expiration periods are fine. Do not plan renewal churn, re-certification loops,
or lifetime tuning — and if a future argument seems to need short lifetimes, re-read this list
first.

**NO BLOCKCHAIN. Owner constraint, and the one place a design drifts toward one is revocation.**
A global revocation list is shared mutable state and needs consensus. **This design does not have
one: revocation is non-renewal.** A misbehaving node is simply not re-certified, and its
certificate lapses on its own clock. Combined with per-verifier pinned `trustAnchors` /
`trustedIssuers`, trust stays **local**, several independent providers coexist by construction,
and nothing global has to be agreed by anyone.

**Do not introduce**: a shared revocation list, a global reputation score, a consensus round, an
append-only shared log, or any structure requiring nodes to agree on one view of the world. If a
plan seems to need one, re-read the attack-radius list above — the answer is almost always that
the threat does not warrant the machinery. It is **not** "a shorter certificate lifetime"; this
sentence used to say that and was superseded by the owner correction three paragraphs above.

### The combine result is signed too — owner decision 2026-08-02

**The signing triangle covers `exec` only unless this is said explicitly, and that would leave
the project's headline claim resting on an unsigned step.** `PROJECT.md` states it as: *the
owner's contribution is trusted; the aggregation over contributions is verified.* Sign only map
results and a map/reduce job ends with **signed map results feeding an unsigned aggregation** —
precisely the half claimed to be the verified one.

So the combine frame carries an attestation slot on the same terms as `exec`: the combining node
signs over what it combined and what it produced, verifiable against its provider-signed
certificate.

**No sovereignty complication.** Combine partials are outputs of public map tasks and therefore
public by construction — the reasoning Phase 16 already recorded when it bounded combine at the
`capacity` hook rather than the `authorize` hook. There is nothing here to authorize; the
question is only whether the aggregation can be shown to a third party, and unsigned it cannot.

### The aggregate issuance budget's exposure is accepted, and named

**Accepted trade, owner decision 2026-08-02.** The persistent cross-process issuance budget that
closes criterion 5 also opens a denial-of-service: `serveAgent` serves enrolment
**unauthenticated**, so anyone who can dial a provider can burn its whole window at the cost of
one `ed25519.keygen()` per attempt. Before the aggregate budget, an attacker could burn only
*their own* user key's window.

**Why it is accepted rather than mitigated.** The architectural answer is real and is the same
one the whole design rests on: **trust is per-verifier and pinned**, so a burned provider is
routed around by trusting or running another. Nothing global has to recover, because nothing
global was ever agreed.

**What must be recorded rather than assumed, because it is not measured.** Every fixture in this
repository and the demo itself are **single-provider**. So the multi-provider recovery that makes
this exposure acceptable is an argument, not a reading. Say so in the plan and in the ledger row
— *unmeasured is not met* applies to the mitigation as much as to the mechanism.

### Two consequences measured during wave 1 — read before planning 19-06 or touching the challenges

**1. A quorum cannot be composed from browser tabs alone, and that is VER-03 working.** Plan 19-02
implemented the anchor rule as `discoverability === 'seed'`. A browser tab cannot bind a listening
socket, so it is never seed-discoverable — therefore **a candidate set drawn purely from tabs, all
`via-relay`, is refused with `no-direct-discovery-path`.**

This does **not** contradict *all nodes have equal functionality; the only difference is
discovery*. It is a statement about discovery, which is exactly why the rule was derived from
`discoverability` rather than from a minted field. Tabs compute, hold blocks, serve records and
take quorum slots on identical terms — what a quorum additionally needs is **one member reachable
without relay mediation**, which is what "backbone-anchored" means and what VER-03 asks for.

The consequence to design around rather than rediscover: **a fabric of only browser visitors can
have its work verified, but cannot form the verifying quorum by itself.** Any tabs-behind-one-relay
fixture must include an anchored member. This binds 19-06's wiring and criterion 4's rig.

19-02 also found that **rule 3 implies rule 2 over any chosen member set** — `sharedRelay` returns
`null` the moment it sees a seed, so a rule-2 check placed after rule 3 is dead code and
`shared-relay-dependency` would have become unreachable. Rule 2 therefore runs on the **candidate
pool**, ahead of rule 3. A side effect worth knowing: `requireIndependentPaths: false` no longer
lets a single-relay fixture compose; the flag now decides *which refusal speaks*.

**2. `nodeKey` inside a challenge does NOT bind a statement to its signer.** Plan 19-13 measured
this: deleting `nodeKey` from `resultChallenge` left all fourteen cases green — **including the one
presenting node A's signature under node B's certificate.** Ed25519 verification under
`certificate.nodeKey` already does that work, and the challenge field adds nothing to it.

The field was kept, because it does buy something real and narrower: **two replicas of one shard
sign different bytes**, so their attestations cannot be confused or swapped. The docblock now says
that instead of the binding claim it used to make.

**`possessionChallenge` carries `nodeKey` under the same conditions and the same correction
applies** — nobody has re-read it yet. Do not repeat the binding claim in any new challenge; state
what the field actually buys.

### Claude's Discretion

- Plan sequencing, wave structure, and how many plans to split this into.
- Whether the `discoverability`-derived backbone rule lives in `composeQuorum` itself or in a
  small helper beside it.
- The exact field names added to `NodeDescriptor`, provided they do not read as a node class.

</decisions>

<code_context>
## Existing Code Insights

### The four symbols, measured rather than assumed

| symbol | definition | production callers | test callers |
|---|---|---|---|
| `composeQuorum` | `packages/core/src/quorum.ts:110` | **zero** (barrel re-export only, `core/src/index.ts:289`) | `quorum.test.ts` ×11 |
| `attestationReceipt` | `packages/core/src/quorum.ts:225` | **zero** (barrel `core/src/index.ts:287`) | `quorum.test.ts` ×3, `sovereign-execution.test.ts:329,464` |
| `resolveReplicaSets` | `packages/core/src/enrollment.ts:405` | **zero** (barrel `core/src/index.ts:269`) | `enrollment.test.ts` ×3, `sovereign-execution.test.ts:279` |
| `discoverCandidates` | `packages/net/src/discover-candidates.ts:147` | **one** — `bin/bench.ts:680`, inside `if (DISCOVER)`, **off by default** | `discover-candidates.test.ts` ×5, `discovery-agents.node.test.ts` ×3 |

The first three ledger claims are **confirmed**. The fourth is already recorded as corrected —
NET-06's row and `requirements-ledger.node.test.ts:316` both note the "callerless" wording was
measured false against `bin/bench.ts:680`.

### Reusable assets

- `classifyAttestation` (`quorum.ts:202`), `attestationRank` (`:49`), `describeAttestation`
  (`:61`) — the label machinery is complete and unit-verified; only its caller is missing.
- `findReservedPeers` (`packages/net/src/rendezvous.ts:76`) issuing `{kind:'reservations'}`,
  answered by `serveAgent` at `packages/net/src/agent.ts:622-625`.
- `planDials` (`packages/browser/src/dial-plan.ts:59`) — pure, with an 8-dial budget.
- `packages/node/src/seed-discovery.e2e.test.ts:264-345` — *"two devices on one seed find each
  other with nobody dialling for them"*, with a comment at `:273-275` stating it deliberately
  calls no `window.o2.dial`. **The closest existing analogue to criterion 4**, failing three of
  its conditions: a live `SeedServer` serves the page, `/bootstrap.json` is the answering
  directory, and both pages are `context.newPage()` on **one** context so they share origin
  storage.
- `packages/node/src/built-bundle.e2e.test.ts` covers the static-bundle half (a dumb 404-ing
  file server, `:57-72`; `?relay=` at `:249-251`) but opens one page and never discovers peers.

### Integration points

- `submitJob` — `packages/core/src/job/submit.ts:233`. Path: `spec.nodes` → `candidateNodes`
  (`:249`) → `planPlacement` (`:325`) / `planWithOffers` (`:340`) → `executeVerified` (`:389`) →
  `ShardResult` (`:121`) → `JobResult` (`:153`).
- The certificate discard: `discover-candidates.ts:161-186`, looping `DiscoveredExecutor`
  (`packages/core/src/discovery.ts:196` — `{nodeKey, certificate, capabilities}`).
- Demo bootstrap: `api.discoverRelays()` (`packages/browser/demo/main.ts:299-328`) with
  precedence `?relay=` → `/bootstrap.json` → none; and `runDiscoveryRound()` (`:141-194`,
  exposed as `connectDiscoveredPeers()` at `:518`), whose comment at `:161-163` names
  `findReservedPeers` as *"the only route on a static host"*.

### The e2e project, and what criterion 4's standard actually costs

- `vitest.config.ts`'s `e2e` project is `environment: 'node'`, `fileParallelism: false`, **no
  `browser` block, no `instances`, no provider** — each spec launches Playwright itself.
- **All ten e2e specs are chromium-only.** Zero occurrences of `firefox` or `webkit` under
  `packages/node/src/*.e2e.test.ts`. Multi-browser `instances` exist only in the `browser`
  project.
- Isolated contexts are already used (`two-tabs.e2e.test.ts:106`,
  `browser-capability.e2e.test.ts`), and a locally-started relay is already used
  (`two-tabs.e2e.test.ts:146-153`, `built-bundle.e2e.test.ts:81-85`). **The three pieces exist
  individually; the combination does not exist anywhere.**
- **Every existing multi-tab test dials from the harness** — `two-tabs.e2e.test.ts:223`,
  `colouring-demo.e2e.test.ts:139`, `background-tab.e2e.test.ts:255`,
  `duty-cycle-tab.e2e.test.ts:273`. Criterion 4 forbids exactly this.

### Guards that will read this phase's edits

- `packages/node/src/requirements-ledger.node.test.ts` parses REQUIREMENTS.md rows and
  re-derives call sites (regex at `:322-328`, excluding the declaring file). Its scope was
  widened to *Partial* rows on 2026-08-02 — **any Phase 19 row edit will be read by it.**
- `packages/node/src/slow-specs.node.test.ts` parses `vitest.config.ts`'s source, so changing
  `SLOW_NODE_SPECS`/`MEASURED_NODE_SPANS` has a guard.

</code_context>

<specifics>
## Specific Ideas

**Two claims in the ROADMAP's own Phase 19 Constraints block are false and must not be planned
against.** Both were measured on 2026-08-02:

1. **`registerSovereignInputs` does not exist in this repository.** Zero definitions, zero calls.
   The name was retired; the real symbols are `takeSovereignHold` and `withholdingFrom`, both
   exported at `packages/net/src/index.ts:77`. `packages/net/src/capability-authorizer.ts:20-25`
   already records this verbatim, including that `takeSovereignHold` runs at `agent.ts:385`,
   *before* `options.authorize` at `:405`. The planning documents inherited a name the source
   had already dropped.
2. **"No sovereign job has ever run in a browser" is refuted.**
   `packages/node/src/browser-capability.e2e.test.ts` dispatches three `label:'sovereign'` tasks
   (`:280-281`) to a live tab started with `canExecuteSovereign: true` (`:213`) and asserts the
   third is **accepted and executed** (`:349-353`).

**What genuinely remains unexecuted in a tab is narrower than the constraint states**, and the
source is more precise than the roadmap:

- The **`authorize`/AUTH-03 refusal** — *executed* in a real tab (the absent-chain and
  expired-chain arms, `browser-capability.e2e.test.ts:296-338`).
- The **`EgressGuard`/`withholdingFrom` refusal** — **unconfirmed as executed**. No e2e spec
  drives a sovereign payload out of a tab and reads the guard's refusal.
  `two-tabs.e2e.test.ts:275-277` reads the *clean* manifest on a **public** job — the positive
  arm only. `packages/node/src/sovereign-block-refusal.node.test.ts:53` states outright that it
  does not prove the browser submitter path, and names WIRE-03 / Phase 19.
- The **`capacity`/SCHED-06 refusal** — **explicitly unexecuted, and the source names this
  phase**: `packages/browser/src/browser-node.ts:1176-1184` says *"nothing drives a refusal
  through this hook … WIRE-03, Phase 19 builds the harness that would measure it."* Note that
  `duty-cycle-tab.e2e.test.ts:263` reads a tab's advertised slots fall 8 → 2 — an **offer
  answer, not a refusal**.

**Criterion 1's entry point has the same substitution Phase 18 hit.** `bin/agent.ts` never
submits a job — zero hits for `submitJob`/`JobSpec`/`executeVerified`; it is a serving node whose
only stdout is a handshake JSON at `:601`. *"A job run through `bin/agent.ts`"* is satisfiable
only as *"a job run **across** `bin/agent.ts` processes"*, the shape
`packages/node/src/discovery-agents.node.test.ts` uses. Record the substitution at planning time
the way Phase 18 did at `ROADMAP.md:592`, rather than discovering it at verification.
</specifics>

<deferred>
## Deferred Ideas

- **Giving the browser tier a real `reservations` thunk.** Decided against for this phase; a tab
  holds no reservations of its own. If a later phase wants tabs answerable directly, it is a
  protocol question about what the hook asserts, not a wiring task.
- **Multi-browser (`firefox`, `webkit`) coverage for the other nine e2e specs.** Criterion 4
  brings the standard to one spec. Retrofitting the rest is its own measured task — all ten are
  chromium-only today.
- **`admit:` at `bin/bench.ts:723` is guarded by nothing** — carried from Phase 18, recorded
  against Phase 20 in `ROADMAP.md`, and touched by this phase only if a plan moves that line.
- **`tools/aot/lift.node.test.ts`** — its recorded "passes in isolation" diagnosis is false
  (12 failures, ten 60 s timeouts, 850 s alone on a quiet host). Phase 21 owns `tools/aot`.
</deferred>
