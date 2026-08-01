# Research: the o2.services planning corpus

All paths relative to `/Volumes/ProjectsSSD/Projects/o2.services`. Line numbers are as of
2026-08-01. Everything in blockquotes is verbatim.

Corpus read: `.planning/PROJECT.md` (256 lines), `.planning/ROADMAP.md` (898),
`.planning/REQUIREMENTS.md` (626), `.planning/v1.0-MILESTONE-AUDIT.md` (316),
`.planning/STATE.md` (1024), `.planning/THREAT-MODEL.md` (167), plus phase artifacts for
2, 3, 4, 5, 6, 7, 8, 9, 10, 13, 13.1, 15, 16, 17, 18.

---

## 1. The mission, in the project's own words

`.planning/PROJECT.md:3-10`

> ## What This Is
>
> A peer-to-peer compute fabric that runs untrusted code safely on volunteer and
> enterprise nodes, moves code to data instead of data to code, and keeps each
> owner's data pinned to their own device for sovereignty. The node agent is
> TypeScript + WASM so it runs unmodified in a browser tab, in Node.js, or
> embedded in a host application — which makes every visitor to a web page a
> potential compute node.

`.planning/PROJECT.md:12-17`

> ## Core Value
>
> **Usable capacity grows super-linearly with the user base, without any raw data
> leaving its owner's device.** If everything else fails, a map/reduce job must
> distribute across N independently-owned nodes, return a result whose integrity is
> demonstrable, and demonstrably never move the underlying data off the owner's node.

The integrity claim is deliberately **split**, because sovereignty and N-version
verification cannot both apply to the same task. `.planning/PROJECT.md:19-24`:

> **What "demonstrable integrity" means precisely** — sovereignty constrains *who*
> may execute, so integrity is layered by threat rather than claimed uniformly.
> Sovereignty is a boundary around the **owner**, not around one device

And the counter-claim it refuses to make, `.planning/PROJECT.md:33-42`:

> **What owner-domain replication does not do.** Redundant execution derives its
> power from executor *independence*. Two devices under one owner are correlated —
> same operator, same intent, likely the same build — so an owner-domain quorum
> catches accidental corruption but **not** a malicious owner biasing their own
> contribution. All replicas under one adversary make a quorum unanimous on a
> forgery rather than degrading, the same structure as an eclipsed DHT lookup.
> [...] Owner-domain agreement must be reported
> distinctly from independent-operator agreement so the stronger claim is never
> implied by the weaker one.

`.planning/PROJECT.md:44-47`:

> **Backbone encrypted replicas are availability-only.** Executing a map requires
> decryption, so a backbone node running a sovereign task would see plaintext —
> reintroducing exactly the exposure sovereignty prevents. Without a TEE (v2),
> execution-eligible replicas are the owner's own devices only.

The roadmap's own one-paragraph account of the arc, `.planning/ROADMAP.md:5-15`:

> The journey runs from a working job to a published number. It opens with a complete
> job — shard, execute redundantly, verify, return a result CID — running inside a single
> process on all three targets, then the same job across two OS processes, then the same
> job across two browsers on one machine. Only once that chain is proven does
> the project add its differentiators, in the order that keeps each one honest: sovereignty
> as a hard constraint *before* the scheduler learns to optimise, tree-reduce *before*
> placement so a placement decision has something real to decide about, decentralized
> discovery and enrollment *after* both, then churn survival, then benchmarks, then a demo
> that is built but deliberately not deployed.

---

## 2. The phase arc

Source of the one-liners: `.planning/ROADMAP.md:39-62` (checkbox list), phase detail
sections `:66-806`, the progress table `:760-783`, and `.planning/STATE.md:6, 17-73, 94-150`
for current verdicts.

### v1.0 — Phases 1-10 (milestone audited, **not archived**)

| # | Phase | One line | Verified status |
|---|---|---|---|
| 1 | Portable Kernel & Loopback Map Slice | A complete redundant, verified job runs end to end in one process, on node/browser/webworker, with no network involved | `[x]` — **6/6 claimed, no artifacts at all**. Audit: "checked complete on the strength of a roadmap checkbox" (`v1.0-MILESTONE-AUDIT.md:156-164`) |
| 2 | Real Network, Node ↔ Node | The same job runs across two OS processes over a real transport, proving the port boundary held | `[x]` 3/3, SUMMARY only |
| 3 | Browser Tier & Backbone Relay | Two browsers on one machine run a distributed redundant job against a self-hosted backbone needing no certificate operations | **`[ ]` 5/6** — real AutoTLS needs a publicly reachable host |
| 4 | Sovereignty, Authorization & Artifact Signing | Owner-pinned data becomes a constraint the placer cannot relax, and every artifact resolves through a signed name | `[x]` 6/6 — **"built and unit-verified, not wired"** |
| 5 | Decomposable Tree-Reduce | Cross-owner aggregation merges up a derived tree with no shuffle, no consensus, no state to migrate | `[x]` 5/5 — **"built and unit-verified, not wired"**; `executeReduce` has no caller |
| 6 | Discovery, Placement & Enrollment | The static peer list disappears; nodes find each other and choose placement under identity and diversity constraints | `[x]` 7/7 — **"built and unit-verified, not wired"** |
| 7 | Churn, Stragglers & Coordinator Survival | A job finishes correctly when the machines running it — including the submitter — vanish mid-flight | `[x]` 6/6 — **"built and unit-verified, not wired"**; `runResilient` has no caller |
| 8 | Benchmark Harness | The scaling claim becomes a reproducible published number with its costs included rather than excluded | `[x]` — 4 of 5 (SUMMARY header) / 5 of 5 (its own table); BENCH-06 distinct-machine half unmet |
| 9 | Public Demo, Consent UX & Disclosure Gate | A visitor consents, contributes to a job someone cares about, and nothing publishes without a deliberate human action | `[x]` 5/5, has a VERIFICATION.md |
| 10 | elfconv AOT Native→WASM Pipeline | A statically-linked native binary becomes a fabric-executable artifact under the same admission checks and verification | `[x]` **3 of 4** — code cache measured and does not happen; cross-machine CID descoped, unmeasured |

Only **Phases 9 and 10 have a `VERIFICATION.md`** in v1.0. `v1.0-MILESTONE-AUDIT.md:9`
records `phase_verifications: 2/10`.

### v1.1 "Wire What Was Built" — Phases 11-23

| # | Phase | One line | Verified status (2026-08-01) |
|---|---|---|---|
| 11 | Explicit serveAgent Hook Contract | `serveAgent`'s six hooks stop defaulting silently — an omission becomes a compile error, not a decision nobody made | **VERIFIED 3/3** — counted |
| 12 | Sovereignty-Pinned Placement | A sovereignty label becomes a constraint the live `submitJob` path cannot relax | **VERIFIED** — counted |
| 13 | Egress Manifest Completeness | `EgressGuard` **refuses** a frame carrying a registered sovereign block rather than recording it afterwards | **VERIFIED 3/3 on amended criteria** — scored **0/3 on the original wording first** |
| 13.1 | Node-Side Admission & Transport Bounds (INSERTED) | A node refuses work it cannot run with a stated reason, and neither side of the wire can be driven past a bound by a peer | **`gaps_found` 6/7** — DATA-10 open. **NOT counted** |
| 14 | Signed Artifact Resolution | Artifacts resolve only through a signed `key → CID` mapping on the live dispatch path, never a bare CID | **VERIFIED 3/3, `passed`** — counted |
| 15 | Capability-Chained Dispatch | A dispatched task carries a capability chain the serving node verifies before `WebAssembly.instantiate` | **VERIFIED 3/3, closed** — counted; **AUTH-03 still open** |
| 16 | Decomposable Tree-Reduce Wiring | A live multi-node job merges partials up `executeReduce`'s derived tree, replacing the demo's linear scan | **`gaps_found` 3/4** — criterion 3 PARTIAL. **NOT counted**; MR-04 open |
| 17 | Node Identity & Enrollment | A node generates its identity on-device and enrols through a rate-limited, provider-signed flow that a peer verifies offline | **`gaps_found` 1/3** — criteria 2 and 3 PARTIAL. **NOT counted**; AUTH-01/02/04 all open |
| 18 | Discovery, Capacity & Placement | Nodes discover candidates, sample and select by load, and refuse over-committed work — no static peer list, on a real job | **In progress, 3/11 plans** |
| 19 | Quorum Composition & Owner-Domain Attestation | Verification quorums compose under anti-affinity and backbone anchoring, and owner-domain agreement is labelled distinctly | Not started |
| 20 | Single Job Path, Ledger & Churn Resilience | `submitJob` becomes the one job path — lease, speculate, account for coverage — and the peer ledger records real outcomes instead of discarding them | Not started |
| 21 | AOT Translation Signing & Runtime | `translationCid` is called by the lift pipeline and a production node constructs a real `WasiExecutor` | Not started (5 plans drafted) |
| 22 | Reachability Guard | A guard test fails when an exported capability has no path from a runnable entry point — the class of defect this milestone exists to fix | Not started |
| 23 | Multi-Process Benchmark Driver | The harness spawns N real operating-system processes instead of N nodes on one event loop, so a parallel speedup is measurable at all | Not started (5 plans drafted) |

Sequencing note, `.planning/STATE.md:145-149`:

> Next: Phase 16, then 17, 18, 19, 20, 21, 23, 22. **These run strictly sequentially, not
> concurrently** — measured 2026-07-31 from their own `files_modified`: `fabric-node.ts` is
> touched by 14/15/17/21, `bin/bench.ts` by 14/15/16/17/23, `browser-node.ts` by 14/15/17/21.
> "Wire What Was Built" means every phase converges on the same construction sites, so the
> earlier note that six phases "can run concurrently" was wrong.

---

## 3. The v1.0 → v1.1 turn: "Wire What Was Built"

### The exact framing and the exact number

`.planning/v1.0-MILESTONE-AUDIT.md:1-10` (frontmatter):

> ```
> milestone: v1.0
> audited: 2026-07-27
> status: gaps_found
> scores:
>   requirements_ledger: 68/72
>   requirements_wired: 32/72
>   phases: 8/10
>   phase_verifications: 2/10
>   integration: 36 requirements built and unit-verified but on no reachable path
> ```

`.planning/v1.0-MILESTONE-AUDIT.md:86-103`:

> # Milestone v1.0 — Audit
>
> **Status: gaps_found**, and not for the reason the ledger suggested.
>
> The requirement ledger says 68 of 72. The four it marks open are all blocked on
> hardware, hosting, or a measured negative — none is unwritten code, and that part of
> the ledger is accurate.
>
> **The integration check found something larger.** Of the 68 marked Done, **36 have no
> production call path.** Phases 4, 5, 6 and 7 built sovereignty, tree-reduce, discovery,
> enrollment, quorum composition, capability chains and the whole churn coordinator —
> each one genuinely implemented and genuinely tested — and nothing a person can run
> calls any of it. The mechanisms are exported from the barrels and exercised by their
> own specs; the five production entry points reach none of them.
>
> This is the project's own recorded anti-pattern at milestone scale: *whenever a comment
> states a guarantee, grep for the mechanism*. The mechanisms exist. What is missing is
> the wire.

The shape, `.planning/v1.0-MILESTONE-AUDIT.md:146-149`:

> The shape is stark and worth naming: **Phases 1, 2, 3, 9 and half of 10 are wired;
> Phases 4, 5, 6 and 7 are not wired at all.** Those four are the phases whose output is
> a *capability the kernel offers* rather than a step in the demo's own path, and nothing
> ever came back to connect them.

The twelve symbols, verified individually — `.planning/v1.0-MILESTONE-AUDIT.md:206-212`:

> **Independently verified before being recorded.** Each of the following appears in the
> repository *only* as its own definition, a barrel re-export, or a prose comment — zero
> call sites outside `*.test.ts`:
>
> `runResilient` · `EgressGuard` · `translationCid` · `composeQuorum` ·
> `discoverExecutors` · `executeReduce` · `deriveReduceTree` · `requestEnrollment` ·
> `signName` · `verifyChain` · `DutyCycleGovernor` · `recoverCheckpoint`

The 36, mapped — `.planning/v1.0-MILESTONE-AUDIT.md:276-286`:

> ### Requirements marked Done whose mechanism is on no reachable path
>
> **36 of them** — counted and verified symbol by symbol — mapping almost exactly onto four phases:
>
> | Phase | Requirements affected |
> |---|---|
> | 4 — Sovereignty | DET-03, DATA-03…DATA-09, AUTH-03 |
> | 5 — Tree-reduce | MR-02 … MR-07 |
> | 6 — Discovery & enrollment | AUTH-01, AUTH-02, AUTH-04, AUTH-05, SCHED-01, SCHED-02, SCHED-03, SCHED-05, NET-06, VER-03, VER-04, VER-08, VER-09, VER-10 |
> | 7 — Churn | CHURN-01 … CHURN-06 |
> | 10 — AOT | AOT-02 (`translationCid` never called by the pipeline) |

### The structural cause — the silent default

`.planning/v1.0-MILESTONE-AUDIT.md:214-228`:

> ### The structural cause
>
> `packages/net/src/agent.ts:65-120` declares six optional hooks on `serveAgent`, each
> with a silent-default fallback. Production supplies almost none of them:
>
> | Hook | Default | Effect on a running node |
> |---|---|---|
> | `authorize` | `undefined` → execute | every dispatched task runs unauthorized |
> | `index` | `?? []` | no node ever serves a capability record |
> | `capacity` | `undefined` → `accepted: true` | no node can refuse an offer |
> | `ledger` | `ledger?.record(...)` | reported outcomes are discarded |
> | `reservations` | `?? []` | fabric rendezvous always returns nobody |
>
> `ledger` is supplied nowhere at all — not in production, not in one test.
> `fabric-node.ts:327` passes `{ rpc, executor, blockstore }` and nothing else.

Stated as a Key Decision, `.planning/PROJECT.md:235`:

> **An optional hook with a silent default is a hole** (v1.0 audit) | `serveAgent`'s six
> hooks default to allow/empty/accept, so four phases of unwired mechanism produced a
> *working system that quietly did nothing*. One of them was a live bug — static-host
> rendezvous answered `[]` forever with the signature `{asked: true, dialed: [], failed: []}`.
> Make the omission a decision someone records | ✓ Good

And the companion, `.planning/PROJECT.md:234`:

> **A capability with no consumer is not delivered** (v1.0 audit, 2026-07-27) | 36
> requirements were marked Done on the strength of a unit-tested mechanism that no runnable
> entry point reaches. The ledger was corrected rather than the work undone: `[ ]` +
> *Built, not wired*. Tracing must start **at the entry point**, not at the module — a
> barrel export is not a wire, and a passing spec proves only that the pieces compose when
> someone composes them | ✓ Good

### The three specific breaks

`.planning/v1.0-MILESTONE-AUDIT.md:230-244`:

> 1. **`RemoteExecutor` never sends a capability chain.** `remote-executor.ts:39` sends
>    `{kind:'exec', task}`. The protocol carries the field, the parser validates it, the
>    agent forwards it, `verifyChain` exists — and no submitter attaches one while no
>    node checks one. **AUTH-03.**
> 2. **`submitJob` has no placement.** `submit.ts:82-92` is unconditional round-robin
>    over `spec.executors`. [...] so
>    "the placer cannot relocate a sovereign task" is true of a placer no job runs
>    through. **DATA-03, DATA-04, DATA-09, SCHED-02, SCHED-05.**
> 3. **`EgressGuard` wraps no production transport.** [...] The decorator designed to make
>    the manifest "complete by construction" decorates nothing outside a test.
>    **DATA-05, DATA-06.**

And the one that was a live bug, `.planning/v1.0-MILESTONE-AUDIT.md:256-261`:

> The failure signature is the one this code was written to prevent: the seed answers, so
> `asked` becomes true, and the result is `{asked: true, dialed: [], failed: []}` —
> nothing attempted, nothing failed, no error. That is the same signature as the two-device
> defect found on hardware last session, relocated one tier down.

### The milestone name and its reasoning

`.planning/PROJECT.md:49-66`:

> ## Current Milestone: v1.1 Wire What Was Built
>
> **Goal:** Every requirement the v1.0 audit reclassified as *Built, not wired* becomes
> reachable from a runnable entry point — or is descoped with the reason recorded.
>
> **Why this milestone exists.** v1.0 executed all ten phases and the audit found that
> **36 of 68 requirements marked Done have no production call path.** Phases 4, 5, 6 and
> 7 — sovereignty, tree-reduce, discovery/enrollment, churn — are genuinely implemented,
> genuinely tested, and reached by nothing a person can run. [...]
>
> **The structural cause is one shape.** `serveAgent` declares six optional hooks with
> silent defaults — `authorize`→allow, `index`/`reservations`→empty, `capacity`→accept.
> A default indistinguishable from the feature working is not a default, it is a hole,
> and it is why no test failed. `ledger` is supplied nowhere at all, in production or in
> a single test.

The last target feature is the milestone's own self-check, `.planning/PROJECT.md:80-82`:

> - **A reachability guard** — a test that fails when an exported capability has no path
>   from an entry point. The audit found this class; no test could have

Sequencing rationale, `.planning/ROADMAP.md:874-887`:

> **The sequencing is deliberate, not alphabetical.** Phase 11 fixes the structural
> cause — `serveAgent`'s six silently-defaulting hooks become an explicit, compile-checked
> contract — before anything else, because that is what turns the remaining 35
> requirements into build failures at their call sites rather than something a person has
> to go looking for a year later. [...] Phase 22 is the reachability guard that would have caught this
> milestone happening in the first place — it runs last because it verifies the other
> eleven phases actually did what they claim.
>
> Almost no code here is algorithmically novel — the mechanisms already exist, unit-tested,
> in the v1.0 phase directories. Each v1.1 phase's job is to make a runnable entry point
> [...] actually call it.

### Why the ledger, not the work, was corrected

`.planning/PROJECT.md:236`:

> **v1.0 not archived** (owner decision, 2026-07-27) | The audit returned `gaps_found`.
> Archiving would file 36 unwired requirements under a completed milestone. The live bug
> was fixed, the ledger corrected to an honest 32/72, and full integration scoped as v1.1
> instead | — Done

`.planning/REQUIREMENTS.md:39-43` — why the checkbox moved and not only the table:

> **Why the checkbox rather than only the table.** A requirement is a claim about what
> the system does. "The placer cannot relocate a sovereign task" is true of a placer no
> job runs through, and a `[x]` next to it would be the project's own recorded
> anti-pattern — *a documented bound that is not enforced* — written into the ledger
> itself. The work is real and the table says so; the box tracks delivery.

The three-state ledger, `.planning/REQUIREMENTS.md:27-33`:

> | Marker | Means |
> |---|---|
> | `[x]` | Delivered on a path reachable from a runnable entry point |
> | `[ ]` + **Built, not wired** | Mechanism exists and is unit-verified; nothing calls it |
> | `[ ]` + **Partial** | One leg reaches production, another does not |

And the point that v1.1 mints almost no new IDs, `.planning/REQUIREMENTS.md:356-360`:

> **v1.1 mints almost no new requirement IDs, and that is deliberate.** The 36 entries
> marked *Built, not wired* above are not missing requirements — they are the same
> requirements, unsatisfied. "The placer cannot relocate a sovereign task" is DATA-03
> whether or not a job runs through that placer; wiring it is what makes DATA-03 true.

Representative traceability rows (`.planning/REQUIREMENTS.md`):

- `:577` — `| SCHED-01 | Phase 18 | **Built, not wired** — discoverExecutors has no caller outside tests |`
- `:579` — `| SCHED-03 | Phase 18 | **Built, not wired** — no node supplies serveAgent's `capacity` hook, so every offer is accepted |`
- `:589` — `| CHURN-01 | Phase 20 | **Built, not wired** — runResilient has no caller; submitJob is the only job path and does not speculate or re-dispatch |`
- `:591` — `| CHURN-03 | Phase 20 | **Built, not wired** — checkpoint.ts is not even imported by coordinator.ts, and runResilient itself has no caller |`
- `:611` — `| AOT-02 | Phase 21 | **Built, not wired** — translationCid is never called by the lift pipeline; the CLI emits no CID and builds no TranslationRecord |`

---

## 4. Owner rulings — the decision record, with rejected alternatives

The pattern that recurs: **a proposal to accept a gap is declined, and the gap is
scheduled to a named phase and criterion instead.** Twelve, verbatim.

### R1 — "Naming a defect is not fixing it" (Phase 15 → Phase 23 criterion 5)

`.planning/ROADMAP.md:442-446`:

> **Owner ruling, 2026-07-31: named is not fixed.** This plan proposed accepting the
> requestor half as entry-point-unreachable. Declined. **The opt-in sovereign leg is Phase 23
> criterion 5**, landing where `bin/bench.ts` is already being rewritten so the most
> contended file in the repository is fought once rather than twice. **AUTH-03 stays open
> until then** — Phase 15 closes its serving half only, and this phase may not tick it.

The rejected option is preserved with its cost, `.planning/ROADMAP.md:448-459`:

> The option declined, and its real cost, so a later reader does not re-derive it. An opt-in
> sovereign leg on `bin/bench.ts`, off by default, would give `delegate` a traced call path
> without moving the default scaling curve, which stays `label: 'public'`. It was declined
> **in this phase** rather than rejected outright, and the cost is larger than one flag:
> `realFabric`'s worker nodes start with no `sovereignty` configuration at all, so each
> would need an owner id, an owner key and clearance; the requestor would need a per-node
> chain minted against each worker's peer id; and `memoryFabric`'s nodes are raw
> `serveAgent` calls on `authorize: 'serves-unauthenticated'`, so the same leg would prove
> nothing on the memory fabric and the two published curves would stop measuring the same
> thing.

Restated in `.planning/STATE.md:763-768`:

> - **[Phase 15] Naming a defect is not fixing it (owner ruling, 2026-07-31).** Plan 15-04
>   amended Phase 15's goal down to the truth — correct — and then proposed accepting
>   AUTH-03's requestor half as entry-point-unreachable. Declined. Recording a built-not-wired
>   adapter in three places is not the same as wiring it; it went to Phase 23 criterion 5,
>   where `bin/bench.ts` is already being rewritten and the most contended file in the
>   repository is fought once rather than twice.

And in the Phase 22 entry, `.planning/ROADMAP.md:729-735`:

> **Superseded — do not read the paragraph below as the standing decision.** Plan 15-04
> proposed accepting the requestor half as entry-point-unreachable. That was declined:
> shipping an adapter with no callers is the defect this milestone exists to remove, and
> naming it is not the same as fixing it. **The opt-in sovereign leg is now Phase 23
> criterion 5** [...] So criterion 1 above should find `delegate` reachable by the time this phase
> runs; if it does not, Phase 23 did not finish its job and that is the finding.

### R2 — Amend criteria *down to what is true*, never up to what is tickable (Phase 13)

`.planning/ROADMAP.md:310-341` (the HTML comment after Phase 13's criteria), closing lines
`:338-340`:

> A criterion that can only be reported as met is not a measurement. These were amended
> down to what is true and up where the refusal makes a stronger claim available; none was
> weakened merely so it could be ticked.

The three amendments, `.planning/ROADMAP.md:314-336` — abridged but verbatim in part:

> 1. "fails a running job if a single raw sovereign byte crosses" -> "refuses the send ...
>    so the bytes never leave". Owner's call. `EgressGuard.send()` already computes the
>    violation before calling `#inner.send()`, so refusing costs one branch. Failing a job
>    after the bytes crossed cannot un-send them, and an observer that reports after the
>    fact is not what "data stays on the owner's device" promises.
> [...]
> 3. "reports only the aggregate's size" removed as a manifest claim. Measured false:
>    `manifest.totalBytes` read 130 where the raw input was 95 canonical bytes and the
>    aggregate 8, because totalBytes sums every frame including unrelated block fetches.

### R3 — Raw sovereign data does not move between nodes, even between one owner's own

`.planning/PROJECT.md:230` (Key Decisions):

> **Raw sovereign data does not move between nodes** (owner decision 2026-07-28; narrows the row above) | Redundant sovereign execution within an owner's node set requires the owner to have placed the data on each of their nodes already. The fabric will not move raw sovereign data, even between nodes the same owner controls. [...] The mechanism is `EgressGuard.send`, which refuses any frame containing a registered sovereign payload instead of forwarding it (Plan 13-04) — so the rule is checkable against the code rather than a policy someone has to remember. [...] **Narrowed 2026-07-28 by `13-VERIFICATION-2.md`, which measured the difference:** what the code delivers is *raw sovereign data does not leave a node **holding a registration for it***, and only the **executing** node registers. A submitting node that never ran the task holds no registration, and was measured shipping the raw 95-byte input inside a 138-byte block-response frame. The sentence above is the intent; DATA-10 (Phase 13.1) is what closes the distance | — Partial

### R4 — All nodes have equal functionality; only discovery differs

`.planning/PROJECT.md:222` and restated at `.planning/STATE.md:400-411`:

> - **All nodes have equal functionality (owner decision, 2026-07-26, restated twice).**
>   There is no tier, no class, no lesser node. Every node executes tasks, holds blocks,
>   serves records, hosts reduce combines, and takes quorum slots on identical terms.
>   **The only difference is discovery**: a browser cannot bind a listening socket, so it
>   cannot act as a seed a newcomer dials cold — it must be found through a relay that
>   can. [...] "Client-mode-only DHT" and "browsers are leaves" were inherited
>   assumptions, both reversed. Background-tab throttling is a lease-duration problem, not
>   a capability one. **If a decision keys on node kind, it is wrong** — the only
>   legitimate use is shared-dependency analysis over the discovery graph.

### R5 — The same-machine testing standard, and its residual (2026-07-28)

`.planning/PROJECT.md:88-99`:

> **Residual, recorded rather than blocking (owner ruling, 2026-07-28).** Same machine —
> different browsers and/or different browser contexts, and different OS processes — is now
> the project's testing standard **everywhere**, so *"a second machine"* is no longer a
> blocker on any of the project's own criteria and has been struck from the blocker lists.
> What it was blocking does not disappear with it: **cross-machine reproducibility and
> distinct-machine benchmarking are unverified by choice, and closing either would need
> hardware this project does not have.** The ruling was made with the argument that one host
> cannot establish those two already on the table. Descoped is not satisfied — neither
> BENCH-06 nor AOT-03 may be reported as having demonstrated anything across machines [...]

The refusal to backfill a completed phase's score, `.planning/ROADMAP.md:249-255`:

> **Criterion 2 above is left at its original wording deliberately, and the score is
> unchanged at 3 of 4** (2026-07-28). The *requirement* AOT-03 was rewritten to what one
> host establishes under the same-machine testing-standard ruling, but rewording a completed
> phase's criterion to match would convert an unmet half into a met one by editing rather
> than by measuring. The criterion stands as it was scored; the cross-machine half is
> **descoped and still unmeasured, not met** [...]

And the stronger-result-stands ruling for Phase 3, `.planning/ROADMAP.md:110-120`:

> **Criterion 1 was restated on 2026-07-28, and it was already closed in a stronger form
> than the restatement asks for.** [...] What was
> actually done on 2026-07-26 was more than that: an **iPhone running Safari and a laptop
> running Chromium, on genuinely different machines**, completed a 4-shard 2×-redundant job
> over a **direct** WebRTC connection with the relay carrying SDP only. **That stronger
> result stands in the record and is not withdrawn.** The restatement lowers what future
> work has to re-demonstrate; it does not lower what was demonstrated.

### R6 — Browser-tier testing standard: three engines are not three machines

`.planning/ROADMAP.md:646`:

> - **Browser-tier testing standard, one host and several browsers** (owner ruling, 2026-07-28): Playwright multi-browser on this machine — `instances: [{browser:'chromium'},{browser:'firefox'},{browser:'webkit'}]` — each peer in its own **isolated browser context** so it gets its own origin storage and IndexedDB, plus a **locally-started Circuit Relay v2 peer to dial**. Three engines on one host are three independent implementations and three independent storage backends; they are **not** three machines, and no result obtained this way may be labelled cross-machine or distributed-hardware.

### R7 — Phase 16's late-arrival clause: scheduled, not rewritten (→ Phase 20 criterion 6)

`.planning/ROADMAP.md:671` and its rationale `:674-676`:

> **Criterion 6 exists because Phase 16 could measure half of its own criterion 3 and said so.** The dedupe property is fully established there across nine real `bin/agent.ts` processes — probe-store deltas `+1/+0/+1`, a ninth fresh process returning the identical CID, two holders at redundancy 2 — but *"arriving late"* is not, because `executeReduce` stops at `wanted` replicas and **has no channel on which a late result could be received at all**. The duplicate in Phase 16's test is therefore solicited by the test, and `tree-reduce-agents.node.test.ts` says so about itself rather than letting the reading pass for more than it is.
>
> This phase is where the clause becomes measurable [...] **Phase 16 keeps MR-04 open on this account** — the criterion was scheduled rather than rewritten, on the same principle that sent AUTH-03's requestor half to Phase 23: lowering a bar is not clearing it.

### R8 — Phase 17's AUTH-04 cost clause: scheduled to Phase 19 criterion 5

`.planning/ROADMAP.md:652`, then `:654-656`:

> **Criterion 5 exists because Phase 17 measured its own rate limit and found what it does not buy.** The burst limit is real and fully proven — a stated threshold read out of the refusal the peer received, `limit: 5 / windowMs: 3_600_000` on the wire. But AUTH-04's text asks that mass fake-node creation be *"measurably costly"*, and Phase 17's verification established two things that defeat it. The limit is keyed on `userKey`, which is **one `ed25519.keygen()`** — so twenty distinct user keys all enrol unslowed, and removing the rate guard entirely leaves that test green. And the budget is per provider **process**: a second provider defeats it without needing a second user key at all, asserted across two spawned providers.
>
> It lands here rather than in Phase 17 because the remedy is a design decision this phase is already making — what scarce thing an identity must present. [...] **AUTH-04 stays open until then**; Phase 17 records the rate-limiting half as measured and the cost half as not, in those words.

### R9 — Phase 17's acceptance clause: scheduled to Phase 18 criterion 2d

`.planning/ROADMAP.md:504`, with the comment at `:506-518`:

> <!-- Criterion 2d added 2026-08-01. Phase 17 proved certificate verification is offline the
>      strong way — both provider processes stopped and asserted dead before the verifier exists —
>      and proved the *rejecting* half cross-process with a named `{kind:'untrusted-issuer'}`. It
>      could not prove the *accepting* half through `bin/agent.ts`, and the reason is structural
>      rather than a missing test: that binary parses eleven flags and **none of them dials a
>      peer**. [...]
>      It lands here because a dial flag is discovery-shaped and this phase owns discovery — and
>      because until one exists, **no phase can prove any peer-to-peer acceptance cross-process**,
>      not just this one. Phase 17's verifier explicitly declined to defer it to this phase on its
>      own authority, since neither AUTH-02 nor certificate acceptance appeared in these criteria;
>      it is written in now rather than assumed. -->

### R10 — Ruling A: a PARTIAL score accepted *in advance*, criterion not amended

`.planning/ROADMAP.md:601-619`:

> <!-- TWO RULINGS TAKEN AT PLANNING TIME, 2026-08-01. Both are recorded here rather than in a
>      summary because both decide how this phase is *scored*, and a scoring rule that lives
>      only in a summary is one nobody reads at verification time.
>
>      RULING A — criterion 2b is expected to score PARTIAL, and that is accepted in advance.
>      Its second clause, "and the requestor re-picks", is not reachable in this phase. [...]
>
>      The criterion text is NOT amended, and the phase is NOT allowed to close on it. This
>      follows the ruling made for Phase 17's criterion 2 on 2026-08-01, where the unprovable
>      clause was rescheduled to Phase 18 criterion 2d *and* criterion 2 still scored PARTIAL
>      *and* Phase 17 stayed uncounted at 1/3. A criterion is not rewritten to let a phase
>      close. Plan 18-06 Task 2 therefore asserts the **absence** as a measurement — a direct
>      dispatch refused, and no shard recording a second attempt — so the clause turns red the
>      day WIRE-04 lands instead of surviving as a sentence in a summary.

### R11 — Ruling B: a control file + SIGHUP, for a security reason, and it creates no node class

`.planning/ROADMAP.md:621-634`:

> RULING B — criterion 3's "user-set at runtime" is satisfied by a control file plus
> `SIGHUP` on the Node tier, and an in-page setter on the browser tier. No wire frame is
> added, and the reason is a security one rather than a convenience one: `serveAgent`
> serves unauthenticated, so a request kind that set a CPU cap would let any peer able to
> dial this node throttle a machine it does not own. [...]
>
> This does NOT create a node class. The governor, its coupling to the advertised slot
> count, and the criterion it satisfies are identical on both tiers; only the control
> surface differs, because a browser tab has no signals. That is a platform fact of the
> same kind as "a browser cannot bind a listening socket", not a capability difference —
> and 18-09 is required to prove the browser tier's cap is read by a *peer*, off a live
> tab, so the equality is measured rather than asserted. -->

### R12 — The PeerVerifier re-ask ruling, with three named rejected alternatives

`.planning/ROADMAP.md:546-583` (Phase 18 criterion 6's comment). The defect:

> THE DEFECT. `PeerVerifier` settled a peer's verdict once, on `peer:connect`, and cached
> it for the life of the connection. A node that enrolled afterwards was excluded by that
> peer permanently — with a correctly-named refusal the whole time, which is why nothing
> reported it. Found by 17-06 on its first test failure and deliberately left unfixed
> under Rule 4: every candidate changed how often nodes re-ask each other across the whole
> fabric, and that is a protocol decision rather than a bug fix.

The ruling and the rejected options:

> THE RULING — retryable/final split, refreshed lazily on read. Chosen over a timer, a
> `records-changed` push, and a dial-ordering fix. The split falls out of `PeerFailure`'s
> own structure, which already separates a fact about a **signed document** from a fact
> about a **conversation** [...]
>
> WHY NOT THE OTHERS. A timer costs every node the sweep forever whether or not anything
> needs a block, and puts a wall-clock bound inside a class that had none — the repo
> already carries two open flakes of exactly that shape. A `records-changed` push has the
> best latency but adds a wire frame and lets an *unverified* peer command work on demand,
> which needs its own bound. Fixing the dial ordering alone closes only the startup race;
> a node enrolling an hour later stays invisible, and Phases 19 and 20 both reopen the
> window.

Plus the second-order defect the fix itself exposed:

> WHAT IT COST TO GET RIGHT. The first implementation of the anti-race guard was
> unmeasured, and probing it found a second real defect: the generation counter was
> per-peer, and `#onDisconnect` deletes the peer's entry — so the ask issued after a
> reconnect was handed the same number as the one still in flight from before the
> disconnect, and a stale refusal could overwrite a fresh acceptance.

### Bonus ruling — bound the combine at `capacity`, not at `authorize`

`.planning/STATE.md:747-754`:

> - **[Phase 16] Routing combine through the `Authorizer` made a security property worse,
>   and that was measured rather than argued.** The old refusal had incidentally bounded
>   combine fetches to zero on any real node. Removing it widened the residue to every
>   node — and `authorizeCapability` admits every combine, because the frame carries no
>   sovereignty label and no node exposes an `authorize` option. Owner ruling: bound it at
>   the `capacity` hook, because combine partials are outputs of public map tasks and
>   therefore public by construction — **there is nothing to authorize; the exposure is CPU
>   and transfer, which is a capacity question.** Closed in 16-06.

---

## 5. The counting rules — criteria, never requirements

The whole rule lives in the HTML comment at the top of `.planning/STATE.md:17-73`.
Frontmatter it governs, `.planning/STATE.md:9-14`:

> ```
> progress:
>   total_phases: 14
>   completed_phases: 5
>   total_plans: 54
>   completed_plans: 39
>   percent: 36
> ```

`.planning/STATE.md:18-24` — what a phase being done means:

> progress counts the v1.1 milestone only: phases 11, 12, 13, 13.1, 14-23. Fourteen of
> them; 11, 12 and 13 are verified done. Phase 13 was counted incomplete for most of
> 2026-07-28 — its first independent pass scored the original criteria 0/3, the criteria
> were amended on three owner rulings, four more plans closed the gaps, and a second
> independent pass then scored 3/3 against the amended text. It counts now because a
> verifier said so, which is the rule: **a phase is done when a verifier says so, not when
> its plans are.**

`.planning/STATE.md:26-37` — **the key passage**:

> **That rule is why `completed_phases` is 5 and not 6.** The five are 11, 12, 13, 14 and 15.
> **Phase 13.1 is not among them**: verified 2026-07-31, `gaps_found` at 6/7 — SCHED-06,
> NET-08, NET-09 and NET-10 closed, DATA-10 open. It stays uncounted until criterion 7's
> at-rest half lands.
>
> **The count is over criteria, never over requirements, and Phases 13.1 and 15 are the
> pair that shows why.** 13.1 is uncounted because one of its own **criteria** is PARTIAL.
> Phase 15 is counted because all three of its criteria are MET — even though its
> requirement, AUTH-03, is *also* Partial. A requirement can outlive the phase that opened
> it; a criterion cannot. AUTH-03's requestor half is scheduled, by owner ruling, to Phase
> 23 criterion 5, and REQUIREMENTS.md's row says so. **`completed_phases` is not a count of
> closed requirements and must never be reconciled against one.**

Restated when Phase 16 lands in the same state, `.planning/STATE.md:129-132`:

> **Uncounted for the same reason Phase 13.1 is, and it is worth seeing the pair together.**
> Phase 15 was counted with a Partial *requirement* because all its *criteria* were MET.
> Phases 13.1 and 16 are uncounted because one of their own *criteria* is PARTIAL. The rule
> does not bend for how nearly done a phase looks.

`total_plans` is explicitly **not** a denominator, `.planning/STATE.md:47-51`:

> `total_plans` counts plans that exist, and it is not a milestone denominator — phases
> 18, 19, 20 and 22 have no directory yet, so it will grow.

### The counting rules exist because tools kept corrupting them

`.planning/STATE.md:53-72`:

> **Three separate writers have now corrupted this frontmatter, so treat the whole family
> as unsafe and maintain it by hand:**
>
> - `gsd-sdk query state.begin-phase` — overwrites this block from that same bad count
>   (2026-07-28: rewrote 25% to 62%) and mangles the Current focus paragraph.
> - The `pause-work` workflow's own state update (2026-08-01) — rewrote `total_phases`
>   14 to 24, reset `completed_phases`, regressed `last_activity` by a day, and mangled
>   `milestone_name` to "— Wire What Was Built".
> - `gsd-sdk query state.record-metric` (2026-08-01, found by plan 18-03) — asked for a
>   single metrics row, it *also* rewrote `status` and `stopped_at`, regressed
>   `last_activity`, and rewrote every progress count: **percent 36 to 74**.
>
> `roadmap.update-plan-progress` is the one measured exception and is safe.
>
> **If you must add a metrics row, write it by hand.** And after any tool touches
> `.planning/`, `git diff .planning/STATE.md` before committing — every one of these was
> caught that way and not by the tool reporting a failure. **None of them errored.**

### The requirement-ledger counting rules are separate and equally explicit

`.planning/STATE.md:186-192`:

> **Ticking a requirement is three edits, not one.** Phase 14's verification found this:
> the checkbox, the traceability row's *Built, not wired* marker, and the section header's
> own count all have to move together, and ticking alone leaves the ledger disagreeing with
> itself. There is a fourth: `packages/node/src/acceptance-traceability.node.test.ts` pins
> specific ids in specific states, and 13.1's verification broke it by closing SCHED-06
> while that spot-check still asserted it open — **`develop` was red from that commit until
> it was caught by an unrelated executor.** Run that file after any ledger edit.

`.planning/STATE.md:194-200` — two denominators:

> **Two denominators, and confusing them is the trap.** REQUIREMENTS.md's own header reads
> *"35 of 72 are `[x]`"* — that is the **v1 section alone** (35 ticked + 37 not = 72) and it
> is correct as written, not stale. v1.1 then minted 10 further IDs [...] So the whole-file count is **40 of 82** and neither
> number contradicts the other. Recount with the section ranges, never with a whole-file grep.

`.planning/STATE.md:174-179` — the "Partial" state exists so progress can be recorded
without overstating it:

> **The 27 and the 6 moved together and the ticked counts did not.** Phase 15 took AUTH-03
> off *Built, not wired* and onto **Partial** without closing it: its serving half is wired
> and verified, its requestor half has zero production callers. A requirement can leave
> "built, not wired" without arriving at "done", and the ledger has to be able to say so —
> otherwise the only way to record progress is to overstate it.

---

## 6. Phases that discovered their own goal did not work in production

### 6a. Phase 16 — the combine gate: *combine never worked in production, from the moment the branch was written*

**The discovery.** `.planning/STATE.md:733-742`:

> - **[Phase 16] A fabric cheaper than the real thing cannot observe a gate keyed on the
>   real thing's configuration.** `agent.ts` refused every combine on any node holding a
>   real `Authorizer`, and both node classes install one — so **combine never worked in
>   production, from the moment the branch was written.** Plan 16-02 could not see it because
>   every in-process fabric it tested builds `serveAgent({...SENTINELS})`, and the sentinel
>   is exactly what the branch keyed on. **Two plans hit it independently** (16-03 from
>   spawned processes, 16-04 from the benchmark) and **neither took the cheap way through**:
>   16-03 refused to change an auth path outside its scope, 16-04 refused to pass the
>   sentinel to `FabricNode` to make a benchmark row appear.

**Why the gate's premise expired silently.** `.planning/STATE.md:743-746`:

> - **[Phase 16] The gate's premise was true when written and one phase later was not.**
>   Its comment read *"Every production call site passes the sentinel today, so this is a
>   no-op now."* Phase 15 installed real authorizers and falsified it silently. **A comment
>   asserting a fact about every call site is a claim with an expiry date**; if it matters,
>   a test must hold it, because nothing else will notice when it stops being true.

**The first fix (16-05) and what it cost.** `phases/phase-16-decomposable-tree-reduce-wiring/16-05-SUMMARY.md:71-77`:

> # Phase 16 Plan 05: Route the Combine Through the Authorizer — Summary
>
> **Every combine on every real node was refused. It is not any more, and Phase 16's three
> criteria now run against eight real OS processes rather than sitting skipped.**
>
> The gate is gone, the criteria are measured, and the benchmark's real-transport reduce
> table is populated for the first time. One clause of the owner ruling turned out not to be
> expressible on this build; it is reported rather than faked, and made into a test that
> fails the day it becomes expressible.

The type-widening decision rather than a fabricated `Task`, same file `:82-92`:

> The ruling says to pass a *"`Task`-shaped value"*. **A combine has none of `Task`'s four
> required fields.** [...] Building a `Task` literal would have meant fabricating
> `moduleCid`, `inputCid`, `partitionIndex` and `partitionCount` — and an authorizer that
> later read `moduleCid` would be admitting or refusing on the strength of a CID naming
> nothing. That is the defect class this repository hunts hardest, so the type widened
> instead

**Verification then found 16-05's own mitigation claimed a control that does not exist.**
`phases/phase-16-decomposable-tree-reduce-wiring/16-VERIFICATION.md:46-63`:

> - truth: "A deployment can refuse combines by supplying an authorizer that does"
>   status: failed
>   reason: >-
>     16-05's threat-flag states this as the mitigation that makes unconditional
>     admission acceptable. There is no injection point. `FabricNodeOptions` has no
>     `authorize` field and neither does the browser equivalent; `fabric-node.ts:764`
>     and `browser-node.ts:616` both hardcode `authorizeCapability(...)`, which
>     returns `null` for every combine at `capability-authorizer.ts:100`. **No node this
>     repository can start — via `bin/agent.ts`, `FabricNode.start` or `BrowserNode` —
>     can refuse a combine.** Only a direct `serveAgent` caller could, and no production
>     path is one. OWNER DECISION REQUESTED

Verification also falsified a claimed compile-time guard by mutation,
`16-VERIFICATION.md:9-21`:

> Mutation M2 falsifies it: adding `readonly ownerId?: string`
> to `CombineWork` leaves `npx tsc --noEmit` at exit 0 and all 11 tests in that
> file green. The assertion is a tautology — a three-element array literal
> compared to itself — and `(keyof X)[]` stays satisfied when `X` gains a key.

**The close (16-06).** `phases/phase-16-decomposable-tree-reduce-wiring/16-06-SUMMARY.md:61-70`:

> **Every node this repository can start now refuses a combine it has no slot for, in its
> own words, before it fetches a single block — and gives the slot back on every exit
> including the two that never reach the merge.**
>
> 16-05 routed the combine through `options.authorize`, which is the right structure and is
> untouched here. What verification measured is that it bounded nothing: `authorizeCapability`
> reaches its refusal rules through `task.label === 'sovereign'`, the combine frame carries
> no such label, and neither node factory exposes an `authorize` field — so the residue that
> the old gate had incidentally held at zero widened to every node.

And the instrument that proved *where* the bound sits, `.planning/STATE.md:755-759`:

> - **[Phase 16] The read count, not the reason string, is what proves a bound's placement.**
>   16-06 planted its cap *below* the fetch loop: both refusal-text assertions stayed green
>   while reads went 0 → 2. The reply is byte-identical in both placements.

Timeline note, `.planning/STATE.md:134-137`: *"One finding was closed after the verifier
wrote its report [...] The report predates it and still records it as open."*

### 6b. Phase 17 — the fail-closed gate partitioned the fabric by tier

**The discovery.** `phases/phase-17-node-identity-enrollment/17-VERIFICATION.md:41-49`:

> - truth: "A browser node can obtain and advertise a provider-signed certificate (project cardinal rule: all nodes have equal functionality)"
>   status: failed
>   reason: >-
>     Criteria 1-3 are established for the Node tier only. `browser-node.ts` has no on-device
>     seed, passes no `privateKey` to `createLibp2p`, has no `enrollment` option, holds no
>     certificate, and passes the `'serves-no-records'` / `'issues-no-certificates'` sentinels
>     unconditionally. **Nothing branches on node kind — the mechanisms are simply absent.**
>     Consequence: a Node agent run with `--trusted-issuer` refuses every browser peer as a
>     block source. No later ROADMAP phase covers browser enrollment.

The escalation it raised, `17-VERIFICATION.md:63-65`:

> - test: "Decide whether Phase 17 may close with criteria 1-3 established for the Node tier only, given the project's cardinal rule that all nodes have equal functionality."
>   expected: "Either a browser-enrollment phase is scheduled, or the tier asymmetry is accepted and recorded in ROADMAP.md."
>   why_human: "Weighs a stated project invariant against milestone scope."

**The close (17-06), and the sentence that names the failure mode.**
`phases/phase-17-node-identity-enrollment/17-06-SUMMARY.md:57-72`:

> ## The regression this closes
>
> 17-VERIFICATION found that any node started with `--trusted-issuer` excluded **every**
> browser peer from its block sources. `PeerVerifier` takes only peers whose certificate
> verifies, and no tab could hold one. The fabric partitioned by tier, against the rule this
> project has restated three times: *all nodes have equal functionality; the only difference
> is discovery.*
>
> 17-04 was right that nothing branches on node kind. The cause was four *absences* in
> `packages/browser/src/browser-node.ts`, and **an absence partitions as effectively as a
> branch while being much harder to see.** All four are now present:
>
> | Absent before | Now |
> |---|---|
> | no persisted seed | `IdbIdentityStore`, a database of its own |
> | no `privateKey` at `createLibp2p` | `privateKey: identity.privateKey` |
> | no `enrollment` option | same shape as `FabricNodeOptions.enrollment`, with `userPrivateKey` |
> | `index:`/`enroll:` sentinels passed unconditionally | `records ?? …` and `authority ?? …` |

The eviction decision made explicit rather than defaulted, `17-06-SUMMARY.md:74-78`:

> `BrowserNodeOptions.whenSeedIsGone` is **required, with no `?` and no default**, taking
> `'mints-a-new-identity'` or `'refuses-to-start-without-its-seed'`. The reason and its cost
> are written at the field and again at every call site.

Confirmed in `.planning/STATE.md:113-117`:

> **The regression it introduced is closed.** The fail-closed gate had excluded *every*
> browser peer as a block source — a fabric partitioned by tier, against the cardinal rule.
> 17-06 gave browser tabs their own persisted identity and enrollment, and the partition
> instrument was observed at **both** values against the same gate node with the same pinned
> issuer. The insecure-origin path 17-01 left unmeasured is now measured in three engines.

### 6c. Phase 13 — scored 0/3 against its own original criteria

`phases/phase-13-egress-manifest-completeness/13-VERIFICATION.md:1-13`:

> ```
> status: gaps_found
> phase: 13
> verified: 2026-07-28
> criteria_met: 0
> criteria_partial: 3
> criteria_total: 3
> score: 0/3 criteria fully verified — all three met in strictly weaker forms than written
> ```

Sample of what it caught, `13-VERIFICATION.md:17-27`:

> (a) No test spawns bin/agent.ts and reads a manifest; the proof
> uses two in-process FabricNode.start() calls. [...] (b) The job is not failed — the
> DATA-05 test asserts the shard reaches 'agreed' while the raw block crosses, and no
> production code anywhere reads manifest.violations, so nothing can convert a
> violation into a job outcome. (c) Detection is whole-block, not per-byte: a frame
> carrying the raw SSN characters alone crossed the tap with no violation in a direct
> probe.

And the plan-citation defect it found, `13-VERIFICATION.md:34-36`:

> Justifies the in-process standard by claiming 12-VERIFICATION.md 'independently confirmed'
> it satisfies a criterion worded 'through bin/agent.ts'. **12-VERIFICATION.md says the
> opposite** — it marked that criterion PARTIAL for exactly this reason [...]

### 6d. Phase 13.1 — three defects found by a subagent told to refute the claim

`.planning/ROADMAP.md:376-388`:

> **Why this phase exists, and why it is inserted rather than appended.**
>
> Three defects, each measured against tcp + noise + yamux with real `FabricNode`s, not reasoned about:
>
> | Defect | Measurement |
> |---|---|
> | `serveAgent`'s `exec` branch has no admission control of any kind | 800 concurrent `execute()` calls, 0 refused |
> | `readMessage` accumulates peer-controlled chunks with no cap | one 64 MiB frame accepted |
> | Per-peer send opens one stream per message with no bound | cliff between 8 and 12 shards, whole connection torn down |

`.planning/ROADMAP.md:398`:

> **How these were found.** A subagent was told to refute the claim that the fabric had no
> backpressure gap, and did, at a named site with a reproduction. Two of the claim's three
> legs broke. The leg that broke worst was the assertion that `over-committed: N of M slots
> in use` proved the project had chosen refusal deliberately — **that string cannot be
> produced by any running node, because the only thing that emits it is constructed nowhere
> outside tests. A well-built mechanism was read and its wiring assumed. That is the defect
> this milestone exists to remove, reproduced in the course of arguing about it.**

`.planning/ROADMAP.md:390` — the urgency:

> **The urgency is `bin/bench.ts`.** It ships `const SHARDS = 8`, one below a measured cliff
> at 12. The approved multi-process benchmark phase would otherwise publish a scaling curve
> measured against an unfixed connection-killing limit, and the failure it produces blames
> the wrong node — so a straggler analysis would be reading sender overrun as receiver death.

### 6e. Phase 14/15 — the "built, not wired" signature made measurable, and a false-impossibility

`.planning/STATE.md:687-691`:

> - **[Phase 14] "Built, not wired" has a measurable signature, and it was measured in both
>   directions.** Before the phase, emptying both demo trust-anchor sets changed nothing
>   across fifteen e2e tests. After it, the same plant takes the colouring job down.
>   Recorded as M29 — the one ledger entry that pins a *change* rather than a guard.

`.planning/STATE.md:679-686`:

> - **[Phase 14] A census that counts call sites cannot tell a composed guard from a
>   decorative one.** Deleting `provenance(...)` from `browser-node.ts` turns two tab
>   refusals red while `trust-anchors.node.test.ts` stays **20/20**, because
>   `guardModuleProvenance(` is still textually present, just applied to nothing. [...]
>   a text census answers "is it mentioned", never "is it wired".

`.planning/STATE.md:713-722`:

> - **[Phase 15] "It cannot be tested" survived four plans and was false.** Every plan
>   repeated that `BrowserNode.start` "needs a real `indexedDB` and a relay to dial, so it
>   runs in neither vitest project", and the browser tier's authorizer went unproven because
>   of it — a scrambling mutation left 345 browser tests green. The true statement is
>   narrower: the **`browser`** project cannot host it, because a Circuit Relay v2 server
>   cannot run inside a browser; the **`e2e`** project can [...] **Six shipped comments
>   carried the false claim, one of them sitting directly on the authorize hook.**

`.planning/STATE.md:704-708`:

> - **[Phase 15] Plan citations drift far worse than anyone assumed: 41 wrong `file:line`
>   references across four plans** (6, 9, 14, 12). These plans were written weeks before
>   they ran. Two were wrong rather than merely stale [...] Assume every citation in an unexecuted plan is stale.

---

## 7. Explicitly unmet things, in the exact language used

The governing phrase, used repeatedly: **"a criterion that can only be reported as met is
not a measurement"** (`.planning/v1.0-MILESTONE-AUDIT.md:121`, `.planning/ROADMAP.md:338`,
`.planning/STATE.md:290`). And: **"unmeasured is not met."**

### The four v1.0 requirements that stay open, and why

`.planning/v1.0-MILESTONE-AUDIT.md:105-121`:

> ## The four open requirements
>
> | Requirement | Phase | What it needs |
> |---|---|---|
> | NET-03 — real AutoTLS | 3 | A publicly reachable host |
> | BENCH-06 — distinct-machine benchmarks | 8 | A second machine |
> | AOT-03 — cross-machine reproducible CID | 10 | **The same second machine** |
> | AOT-05 — V8 code-cache hit | 10 | Nothing. It was measured and does not happen |
>
> BENCH-06 and AOT-03 are one blocker wearing two numbers. [...]
>
> AOT-05 is a different kind of entry. It is not waiting on anything — the experiment
> ran, with two controls, and the answer was no. **It is recorded as unsatisfied rather
> than reworded into something that could be ticked, because a criterion that can only be
> reported as met is not a measurement.**

### AOT-05 — a measured negative

`.planning/REQUIREMENTS.md:344-349`:

> - [ ] **AOT-05**: Browser artifact loading uses `compileStreaming` against a stable
>       gateway URL so V8 code caching applies. **Loading done; caching does not
>       happen.** No WASM code-cache entry at 4.8 MB over three visits, while the
>       same profile caches 2 MB of JavaScript. Published as a measured negative
>       with two controls, not deferred

`.planning/REQUIREMENTS.md:502`:

> | **AOT-05** — V8 code-cache hit | Not blocked on anything. It was measured with two controls and the answer is no. Re-running it against an `https` origin and a non-automated Chromium is worth doing, but it stays a negative until that says otherwise |

### BENCH-06 — descoped and unmeasured, not met

`.planning/REQUIREMENTS.md:281-296`:

> - [ ] **BENCH-06**: Benchmarks run across N independent operating-system processes on one
>       host [...]
>       **The distinct-machine claim is descoped, not satisfied.** It is unmeasured, and
>       unmeasured is not met. A same-host run **cannot** detect divergence between machines,
>       because it has one CPU, one V8 and one libc: every process shares an instruction set,
>       an engine build and a system library, so the very variables a cross-machine benchmark
>       exists to expose are held constant by construction. The original cross-machine risk
>       stands exactly where Phase 8 left it, unmeasured and now unscheduled. [...] That is the
>       honest one-machine win. **It is not a distributed measurement and must never be
>       published as one**

Phase 8's own SUMMARY, `phases/phase-8-benchmark/SUMMARY.md:20-23`:

> BENCH-06 asks for two things. The labelling half is enforced structurally and derived
> from the host count. The distinct-machine half is **not met** and cannot be until a
> second machine exists — stated in the report's opening section, not a footnote.

`phases/phase-8-benchmark/SUMMARY.md:33-36`:

> **The headline caveat is what the numbers cannot show.** Every node in both curves runs
> in one OS process on one event loop, so no parallel speedup is measurable at all. The
> flat makespan is the consequence of that, not a finding about scaling. **The scaling claim
> is therefore unmeasured — which is neither disproved nor supported.**

### AOT-03 — a structural blind spot, not a configuration one

`.planning/REQUIREMENTS.md:323-341`:

> - [ ] **AOT-03**: Translation is reproducible on one host [...]
>       **The cross-machine claim is descoped, not satisfied.** It is unmeasured, and
>       unmeasured is not met — two lifts on two hosts have still never been compared.
>       **`CROSS_MACHINE_BLIND_SPOT` stays attached to every artifact and stays printed by
>       the CLI.** Phase 10 established that the blind spot is **structural, not
>       configurational**: elfconv's virtual-register promotion iterates a pointer-keyed
>       `std::unordered_map` and a `std::set<BBBag*>`, whose iteration order is an
>       address-space property, so no flag, no version pin and no image digest removes it.
>       Descoping this requirement removes neither the marker nor the risk it names [...]
>       *(Status: the one-host half is established. The box stays unchecked because the
>       descoped cross-machine half is carried as unmeasured rather than as met — an
>       unchecked box here understates on purpose, which is the safe direction.)*

### VER-02 — a box cleared because the mechanism checked nothing

`.planning/REQUIREMENTS.md:14-17`:

> **35 of 72 are `[x]`.** That is down from 68, and the 37 that moved did **not** move
> because the work was undone — with one exception, **VER-02, whose box was cleared on
> 2026-07-30 because the mechanism behind it was found to check nothing and was deleted.**

### DATA-10 — scheduled, not deferred

`phases/phase-13.1-node-side-admission-transport-bounds/13.1-VERIFICATION.md:9-16`:

> - truth: "Criterion 7 — A node asked for a raw sovereign block refuses, whether or not it executed a task over that block"
>   status: partial
>   reason: >-
>     What ships is a property of one *function* over one *job's duration*, not a
>     property of a node. [...] The source says so itself:
>     `sovereign-block-refusal.node.test.ts:52` — "Criterion 7 is a property of a
>     *node*; what ships here is a property of one *function*."

`.planning/STATE.md:783-791`:

> - **DATA-10's at-rest half — owner-scheduled, not deferred.** A node still serves a raw
>   sovereign block once the job that registered it has ended [...]
>   `sovereignty-placement.node.test.ts` currently drives a real
>   spawned-agent sovereign scenario through bare `submitJob` and **passes because the gap
>   is real**.

### The threat model's own stated gaps

`.planning/THREAT-MODEL.md:12-13`:

> Scoped to what is built and tested today. Where a defence is partial, it says so — **an
> overstated threat model is worse than none, because it stops people looking.**

`.planning/THREAT-MODEL.md:17`:

> > **An attacker may control up to `k` nodes in a quorum of `n`, where `k = 0`.**

`.planning/THREAT-MODEL.md:76-82`:

> **Sybil resistance is rate-limiting, not cost (attacker 15).** `EnrollmentAuthority`
> caps certificates per user key per window. An attacker with many *user* identities is
> not slowed at all, and the cap is a policy number rather than a physical one. [...]
> **This is the weakest link in the model**, because attacker 3's defence assumes operator
> identities are scarce.

`.planning/THREAT-MODEL.md:84-89`:

> **Egress control is a detector, not a prover (attacker 12).** [...] It cannot
> prove that no *encoding* of a sovereign value could slip past — compressed, encrypted,
> or re-encoded copies would not match. It catches the failure that actually happens: a
> map step that forgot to aggregate. A stronger claim needs taint tracking through the guest.

`.planning/THREAT-MODEL.md:118-124`:

> **A false task-failure report is taken at its word (attacker 21). This is new surface
> that Phase 7 introduced and it should not be glossed.** [...] a node that claims
> "the module trapped" is believed. Three nodes making that claim for the same shard cause
> it to be declared failed.

### Open owner decisions and blockers

`.planning/STATE.md:815-824` — two open owner decisions (the `lift.node.test.ts` timeout
where "the outer clock is the smaller one, so the inner budgets can never fire", and the
benchmark's row-order confound where "Load drifted 29→49 during a run, so no inter-row
difference under ~20% is claimed").

`.planning/STATE.md:830-833`:

> **Three items are owner-blocked and unaffected by the 2026-07-28 testing-standard ruling:**
> the US provisional patent deadline (below), a hosted relay with real AutoTLS (NET-03,
> Phase 3 criterion 2), and GitHub Pages serving the pre-Phase-9 bundle (below). *"A second
> machine"* used to be a fourth. It is not a blocker any more — it has been struck, and its
> residual is recorded immediately below rather than dropped.

The measured AOT cost that Phase 21 must plan against, `.planning/STATE.md:835-848`:

> - **What the lifted-vs-native benchmark costs Phase 21 (measured 2026-07-31).** Timing
>   `wasi.start()` alone [...] native 58.78 ms, direct-compiled WASM 65.19 ms (1.11×),
>   elfconv-lifted WASM 122.81 ms (**2.09×** native, 1.88× direct). That is the emulation
>   tax, and it is the honest number to plan AOT-04 against.
> - **The ~43 ms startup floor cannot be cached away, and this was tested rather than
>   assumed.** [...] the entire floor executes *inside* the guest, in elfconv's emulated
>   machine-state init, and is re-paid per task. [...] Direct WASM's `_start` for the same
>   program is 0.03 ms, ~1400× less.

Phase 21's unanswered design question, `.planning/ROADMAP.md:690-707`:

> **OPEN QUESTION FOR THE PLANNER — how does a 5.40 MiB artifact reach a node that does not
> have it? Answer this in the discuss step; do not let a plan assume it.** (Raised by the
> owner 2026-08-01. It is not rhetorical: criterion 3 cannot be met without an answer,
> because a node that cannot obtain the artifact fails at instantiate.)
>
> **The problem is not content addressing — we have that. It is durability and fan-out.** A
> CID tells you whether you got the right bytes; it says nothing about whether anyone still
> holds them. [...]
> - **A resolvable name for unfetchable content is worse than no name.**

Also recorded there: the repo **does not depend on Helia at all today** despite `STACK.md`
recommending it at length (`ROADMAP.md:701`), and two traps that must not be re-derived —
"Do not justify a gateway with V8 code caching" and "The ~43 ms lifted-startup floor is not
a distribution problem" (`ROADMAP.md:705-707`).

### Record gaps, as distinct from work gaps

`.planning/v1.0-MILESTONE-AUDIT.md:151-176`:

> ## Gaps in the record, as distinct from gaps in the work
>
> **Phase 1 has no phase artifacts at all.** No directory, no SUMMARY, no VERIFICATION. It
> is checked complete on the strength of a roadmap checkbox, and ten requirements [...] are
> attributed to it. The work is not in doubt [...] But **an
> audit that accepts a checkbox as evidence for ten requirements is not auditing.**
>
> **Eight of ten phases have no VERIFICATION.md.** [...] so the three-source cross-reference this audit is
> supposed to perform runs on two sources for nine phases and one for Phase 1. Recorded as
> a shape gap, not as an absence of work.
>
> **Two SUMMARY headers understate their own tables.** Phase 4 says "5 of 6 criteria met"
> above a table marking all six met; Phase 8 says "4 of 5" above a table marking all five.
> The error is in the conservative direction, which is the harmless one, but the header
> and the table should not disagree.

### Explicitly clean — stated so the finding list is not read as worse than the truth

`.planning/v1.0-MILESTONE-AUDIT.md:294-306`:

> ### Explicitly clean
>
> Stated because a finding list without them reads as worse than the truth:
>
> - **The `Executor` port is honoured by every implementation** [...] and `submitJob` has no branch on kind.
> - **The demo job really does flow through the net agent path**, proved across two real tabs.
> - **The benchmark measures the real `submitJob` path**, not a parallel one.
> - **Package layering holds**, no cycles, and `purity.node.test.ts` enforces it against real files.
> - **No dead re-exports** — every barrel symbol resolves.

---

## 8. Recurring maxims worth quoting as a set

Each of these appears in more than one document and functions as a project rule.

| Maxim | Location |
|---|---|
| "A capability with no consumer is not delivered" | `PROJECT.md:234` |
| "An optional hook with a silent default is a hole" | `PROJECT.md:235` |
| "A default indistinguishable from the feature working is not a default, it is a hole" | `PROJECT.md:63-64` |
| "A criterion that can only be reported as met is not a measurement" | `AUDIT:121`, `ROADMAP:338`, `STATE:290` |
| "Unmeasured is not met" | `REQUIREMENTS:287, 329` |
| "A phase is done when a verifier says so, not when its plans are" | `STATE.md:23-24` |
| "The count is over criteria, never over requirements" | `STATE.md:31` |
| "Naming a defect is not fixing it" / "lowering a bar is not clearing it" | `STATE:763`, `ROADMAP:676` |
| "A barrel export is not a wire" | `PROJECT.md:234` |
| "Whenever a comment states a guarantee, grep for the mechanism" | `AUDIT:101-102` |
| "A comment asserting a fact about every call site is a claim with an expiry date" | `STATE.md:745-746` |
| "A text census answers 'is it mentioned', never 'is it wired'" | `STATE.md:685-686` |
| "An absence partitions as effectively as a branch while being much harder to see" | `17-06-SUMMARY.md:65-66` |
| "If a decision keys on node kind, it is wrong" | `STATE.md:409-410` |
| "An overstated threat model is worse than none, because it stops people looking" | `THREAT-MODEL.md:13` |
| "A guard that silently stops guarding is the shape this project keeps removing" | `ROADMAP.md:396` |
| "A rung that vanishes between plan and results is indistinguishable from one removed for being inconvenient" | `STATE.md:322-324` |

---

## Appendix — file inventory with line counts

| Path | Lines | Notes |
|---|---|---|
| `.planning/PROJECT.md` | 256 | mission, milestone, 20-row Key Decisions table |
| `.planning/ROADMAP.md` | 898 | 23 phases; the long HTML comments at `:310-341`, `:424-466`, `:506-518`, `:520-539`, `:546-583`, `:601-634` are the densest decision record in the repo |
| `.planning/REQUIREMENTS.md` | 626 | three-state ledger, traceability table at `:540-620` |
| `.planning/v1.0-MILESTONE-AUDIT.md` | 316 | the turn |
| `.planning/STATE.md` | 1024 | counting rules `:17-73`; lessons `:640-770`; pending todos `:770-830` |
| `.planning/THREAT-MODEL.md` | 167 | 22 attackers, k=0 bound, stated gaps |
| `phases/phase-13-.../13-VERIFICATION.md` | ~29 KB | the 0/3 pass |
| `phases/phase-13-.../13-VERIFICATION-2.md` | ~37 KB | the 3/3 re-pass on amended criteria, 8 verifier-planted mutations |
| `phases/phase-13.1-.../13.1-VERIFICATION.md` | ~30 KB | 6/7, DATA-10 open |
| `phases/phase-16-.../16-VERIFICATION.md` | ~13 KB | 3/4, combine-gate finding |
| `phases/phase-16-.../16-05-SUMMARY.md`, `16-06-SUMMARY.md` | — | the combine-gate discovery and its close |
| `phases/phase-17-.../17-VERIFICATION.md` | ~15 KB | 1/3, browser-partition finding |
| `phases/phase-17-.../17-06-SUMMARY.md` | — | the browser-partition close |
| `phases/phase-{2,3,4,5,6,7,8}/SUMMARY.md` | — | v1.0 phases with no VERIFICATION.md |
