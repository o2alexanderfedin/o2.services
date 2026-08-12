# Design spec — generalized capability registration and discovery

**Status:** design analysis. No implementation, no repo file modified.
**Base:** `c94bc7a` (`docs(audit): G5 closed as a measured negative`), reached by
authorized `git merge --ff-only` from `4dd74fc` in worktree
`worktree-agent-a0bcad3455060454b`. 3 commits fast-forwarded, 0 of my own.
**Date:** 2026-08-11.

**Verdict up front: DEFER the abstraction; FIX the extension seam.** The unifying model is
not warranted on the present evidence, and one of the two things it would unify does not
exist in this repository in the form the brief describes. But `CapabilityRecord` has **no
forward-compatible extension point**, and that cost is paid on the *next* capability kind
whether or not anything is ever generalized. Section 6 is the load-bearing part of this
document.

> **AMENDED 2026-08-11, later the same day. Read this before the body.**
>
> Two things changed after this document was written, and both are recorded *in place* below
> rather than by rewriting it.
>
> 1. **§6.4's finding was implemented.** `CapabilityRecord` has the extension seam as of
>    `32cba89`. §6.4 is struck where it asserts the absence, and §6.5 records what shipped —
>    including the one place the implementation chose **against** this spec's own suggestion.
> 2. **The owner settled a capability model in conversation.** It is three-dimensional, and the
>    three dimensions deliberately do **not** live in the same place. **§9 is that ruling.** §1,
>    §2, §4.2, §7 and §8 carry the corrections it forces.
>
> **Citation base, and a staleness warning that is not a defect but reads like one.** Every
> `file:line` in §0–§8 was read at `c94bc7a` and is **left** at that base, because this is a
> record of what was read. `32cba89` inserted ~260 lines into `packages/core/src/discovery.ts`
> and ~90 into `packages/net/src/protocol.ts`, so **the line numbers this document cites into
> those two files no longer resolve at `HEAD`.** The shift is not a uniform offset — there are
> two insertion sites in `discovery.ts` — so no mechanical correction is possible and none is
> attempted. **Text added on 2026-08-11 cites `32cba89` and says so at the point of citation.**
> Nothing outside those two files moved: `quorum.ts`, `enrollment.ts`, `fabric-node.ts` and
> `packages/net/src/discovery.ts` citations still resolve.

---

## 0. Provenance — what was read, and what was not

Everything below cites `file:line` against the tree at `c94bc7a`. Where I am inferring
rather than reading, the sentence says so in bold.

**Measured negatives** (searched, found nothing — these are readings, not assumptions):

| Claim | How measured |
|---|---|
| No H3 / geographic code or spec exists in this tree | `grep -rn -i "h3\|geohash\|vicinity\|geograph\|latitude\|proximity" --include="*.ts" --include="*.md"` over the repo minus `node_modules`. Every hit is an HTML `<h3>`, a base32 CID substring (`…h3lq…`), or a UI-SPEC row id. **Zero** matches relating to geography. |
| No H3 spec in the shared scratchpad | `ls` of the session scratchpad; no `specs/` directory existed before this file. |
| No DHT, no Helia, no delegated routing | `grep -rn "helia\|kad-dht\|delegated-routing" package.json packages/*/package.json` → **no matches**. Declared `@libp2p/*` set is crypto, interface, circuit-relay-v2, peer-id, identify, logger, webrtc, ping, websockets, tcp. |
| No WASM feature detection | `grep -rn "wasm-feature-detect" package.json packages/*/package.json` → **no matches**. Corroborated by `packages/node/src/fabric-node.ts:1136-1138`, which states it. |

**Therefore: my entire knowledge of the H3-as-content design comes from the task brief.** I
could not read it, could not check its line numbers, and could not verify any claim it makes
about its own mechanism. Every statement below about the H3 design is a statement about *the
design as described to me*, and is flagged where the distinction matters. If that design has
changed, the section-2 argument is the one to re-run first.

---

## 1. Problem

The owner's vision is that *"every cloud node registers itself with a bunch of capabilities,"*
one synthetic kind of which is a geographic index, so nodes can find peers in a vicinity.

Today the fabric has one registration record, `CapabilityRecord`
(`packages/core/src/discovery.ts:64-86`), self-signed by the node key
(`discovery.ts:102-113`), and it already carries **two** capability kinds as separate named
fields:

- `features: readonly string[]` — WASM engine features (`discovery.ts:73`), matched by
  `ExecutorQuery.requiredFeatures` (`discovery.ts:153`) and refused as `missing-features`
  (`discovery.ts:178-182`, applied at `discovery.ts:282-288`).
- `sovereignFor: readonly PublicKeyHex[]` — user keys whose sovereign data this node may
  decrypt and execute, DATA-09 (`discovery.ts:74-82`), matched by `ExecutorQuery.sovereignFor`
  (`discovery.ts:161`) and refused as `not-cleared-for-owner` (`discovery.ts:183-187`, applied
  at `discovery.ts:290-294`).

The brief frames the question as *one and a half examples*. **It is closer to one and a
quarter, and the quarter is the WASM one.** `features` is `[]` on every node this repository
builds — `fabric-node.ts:1181`, `browser-node.ts:616` — and
`packages/net/src/discover-candidates.ts:74-78` states the consequence plainly: *"`CapabilityRecord.features` is `[]` on every node this repository builds, and no feature-detection
dependency exists, so a query naming a feature excludes everybody. Nothing here supplies one."*
`fabric-node.ts:1136-1142` argues the empty list is honest rather than a stub, and it is right,
but honest-and-empty is still **unexercised**. The one capability kind with a non-empty value
in production is `sovereignFor` (`fabric-node.ts:1182`).

So the proposed generalization would abstract over: one exercised field, one declared-but-empty
field, and one design that is not in the tree.

> **Corrected 2026-08-11 (owner ruling, §9 decision 5) — `features` is no longer a discovery
> filter.** The sentence above describes `features` as *"matched by `ExecutorQuery.requiredFeatures`
> and refused as `missing-features`"*, and that is still what the code does
> (`discovery.ts:538-544` at `32cba89`). **The ruling is that it stops being a discovery
> input.** `features` stays on the record — it is a true fact a node states about its own engine —
> but a query no longer narrows on it, and **a node that cannot run a module refuses at dispatch**
> instead. The trade is stated plainly: cheaper discovery, an occasional wasted placement.
>
> This is affordable **because refusal is already first-class in this fabric and has three
> production expressions**, all read at `32cba89`: `guardSovereignty`
> (`packages/core/src/executor/sovereignty-guard.ts:90`), the capability authorizer
> (`packages/net/src/capability-authorizer.ts:76`), and the relay admission gate
> (`packages/libp2p/src/relay-admission.ts`, whose docblock at `:7` is the reason it sits where it
> does). A fourth refusal at dispatch adds a named arm, not a mechanism.
>
> **What it does *not* change:** §4.2's finding that WASM features are the one cleanly
> self-punishing kind. Under this ruling the self-punishment becomes the *whole* enforcement rather
> than a backstop behind a filter — which makes §4.2's observation load-bearing rather than
> incidental.

**The question this spec answers** is not "what would a general capability system look like" —
that is easy and worthless. It is: *does the evidence support building one now, and if not,
what must the two current kinds do so that building one later is not made harder?*

---

## 2. Analysis — what actually varies between capability kinds

Six kinds. Two exist, one is designed-but-absent, three are argued as plausible. For each
plausible kind I say why I think it is plausible rather than asserting it.

| Property | **WASM features** | **sovereignFor** | **H3 cells** *(described, not read)* | **Available memory** | **Accelerator presence** (GPU/WebGPU) | **Compliance zone** (e.g. "EU-only") |
|---|---|---|---|---|---|---|
| **Exists today?** | field yes, value `[]` everywhere (`fabric-node.ts:1181`) | **yes, exercised** (`fabric-node.ts:1182`) | **no** — measured negative, §0 | no | no | no |
| **Set or scalar** | set of opaque strings | set of public keys | set of cells, and **a set that is a path** — a cell implies all its ancestors | **scalar, ordered** | scalar boolean, or small set of labels | set of jurisdiction labels |
| **Match semantics** | exact set membership, subset test | exact set membership | **hierarchy + adjacency** — "within k rings of cell X at res 9" is neither exact-match nor a simple range | **range** (`≥ 4 GiB`) | exact | exact, but with **implication** (a node in `DE` is in `EU`) |
| **Self-punishing when false?** | **yes** — claim a feature you lack and the module traps; the task fails and names you | **partially** — see §4; a false claim is a *safety* failure, not a liveness one | **no** — a lying node executes perfectly and merely wins work it should not | **no**, and worse: it fails *late*, as OOM mid-task | **no** — falls back to a slow path and still returns a correct answer | **no**, and it is the whole point of the field that it cannot be checked from outside |
| **Churn** | very low — changes on engine upgrade; `fabric-node.ts:1136-1142` treats re-signing on feature gain as the motivating case | low — changes on enrolment/policy change | **very high for a mobile node**; a phone crosses a res-9 cell boundary in seconds at walking pace | medium — pressure-dependent, sawtooths | very low | very low, and it is an attribute of the *operator*, not the machine |
| **Role: filter or entry point** | **filter** — narrows providers already found (`discovery.ts:282-288`) | **filter** (`discovery.ts:290-294`) | **entry point** *as designed* — must start a lookup with no data CID in hand | filter | filter | **either** — a filter for placement, an entry point for "who is in the EU at all" |
| **Correct signer** | node (it is a fact about the node's own engine) | node, **anchored** by the certificate's `userKey` | node, and nothing anchors it | node | node | **provider/operator** — a self-signed jurisdiction claim is worth nothing |
| **Validity window** | certificate's, and that is right | certificate's, and that is right | **cannot** be the certificate's — see §5 | shorter than the certificate's | certificate's | certificate's |

### What the table shows

Read down the columns rather than across the rows. **The two kinds that exist agree on every
axis**: both are exact-set-membership over opaque labels, both are node-signed and
certificate-anchored, both are filters, both are stable enough to share the certificate's
validity window, and both are declared as named fields with named exclusion reasons. They agree
because they were built for the same slot.

**Every proposed kind disagrees on at least three axes, and no two of them disagree on the same
three.** H3 differs on role, churn, match semantics, and validity window. Memory differs on
match semantics (range) and failure timing. Compliance zone differs on *who may sign it*, which
is the deepest disagreement of all — it is not a capability record at all, it is a certificate
field, because a self-signed jurisdiction claim is exactly the thing `discovery.ts:17-23`
explains is worthless without a provider vouching for it.

An abstraction whose members disagree on the signer, the match semantics, the churn class, the
validity window, **and** the role is not an abstraction. It is a tagged union with one arm per
member, which is what the code already has — except the code's version has exhaustiveness
checking and human-readable refusals, and the generalized version would not (§3.3).

---

## 3. The filter-vs-entry-point question

This is the crux the brief names, and my finding is that **the distinction is real but is
being attributed to the wrong layer** — and that in this repository, today, *neither* kind is
an entry point.

### 3.1 There is no transitive content routing in this repository

`RecordIndex` has exactly one lookup that takes a CID and returns node keys:

```
providers(cid: CID): Promise<readonly PublicKeyHex[]>        discovery.ts:143
```

Follow its only production implementation chain:

- `RpcRecordIndex.providers` (`packages/net/src/discovery.ts:96-115`) asks `this.#peers()` —
  a thunk over the **currently connected** peer set — and unions the answers.
- Each peer answers from `SelfRecordIndex.providers` (`core/src/discovery.ts:511-520`), which
  returns `[this.#nodeKey]` if and only if its own local store holds the block, subject to the
  `withhold` predicate. **A node answers about itself and nobody else** — owner ruling D1,
  `discovery.ts:431-440`.
- `packages/net/src/discover-candidates.ts:38-44` states the resulting reach in its own words:
  *"Inherited from `RpcRecordIndex`: no transitive routing and no DHT. The candidate set covers
  the peers this endpoint is currently connected to and nothing beyond them."*
- Measured (§0): no `kad-dht`, no Helia, no delegated routing client is a declared dependency.

**Therefore `providers(cid)` is not a global lookup. It is a fan-out over the connected set.**

### 3.2 Consequence: `providers(cellCid)` is a filter too

The H3 design as described to me addresses a place as content — cell → CID → the node holds a
block per cell → a vicinity query is `providers(cellCid)` — and its claimed virtue is that this
*reuses content routing with no schema change*.

The schema-change half is true and is a genuine advantage. **The entry-point half is not
available in this repository yet**, because it borrows a property that content routing does not
have here. `providers(cellCid)` returns a subset of the peers you are already connected to: the
ones that happen to hold that cell's block. That is a filter over the connected set wearing
content routing's clothes.

Stated as the falsifiable claim: **on the tree at `c94bc7a`, a node that is not already a
directly-connected peer cannot be returned by `providers(anyCid)`, so it cannot be found by a
vicinity query, so vicinity discovery cannot reach beyond the connected set.** I did not run
this — no build is permitted in this worktree — but it is a reading of three files with no
branch between them, and `discover-candidates.ts:38-44` asserts the same thing in prose.

### 3.3 What this does to the "two mechanisms" framing

The brief's central fact is that the two kinds use two different mechanisms and asks whether
that is a defect to unify or a correct split to preserve. My answer is **neither, as stated** —
the premise needs one correction first:

- Today, both kinds are filters over the connected set. There is one mechanism, not two.
- The entry-point property is not a property of the **capability kind**. It is the conjunction
  of two independent choices: (a) mint a CID for the capability *value*, and (b) have routing
  that is transitive. H3-as-content makes choice (a). Nothing in the repository makes choice (b).
- And choice (a) is available to **every** kind. `providers(cidOf("wasm-feature:simd128"))` is
  as well-formed as `providers(cidOf("h3:891fb46..."))`. WASM features could be an entry point
  tomorrow by minting a CID per feature and storing a marker block. Nothing about engine
  features makes them intrinsically filter-shaped.

**So the split is not intrinsic to the capability kinds. It is intrinsic to the two layers.**
There genuinely are two mechanisms in the design space, and they should stay two:

| Layer | Question it answers | Keyed by | Cost of an entry |
|---|---|---|---|
| **Record filter** (`CapabilityRecord` + `ExecutorQuery`) | "of these candidates, which qualify?" | node key | one field in a signed record |
| **Content routing** (`providers`) | "who, anywhere, has property P?" | CID of the property | one stored block, plus whatever the routing layer costs |

What must **not** happen is unifying these by pulling routing into `CapabilityRecord`. A record
is fetched *by node key* (`recordsFor(nodeKey)`, `discovery.ts:145`); you must already know who
a node is to read its record. That is a strict prerequisite, and no amount of schema
generalization removes it. **Any capability that must start a lookup cannot live in
`CapabilityRecord`, for a reason that is structural rather than stylistic.** That is the
sentence to keep from this section.

### 3.4 What would break if you tried the unification anyway

Three concrete breakages, each cited:

1. **Exhaustive refusal naming dies.** `discovery.ts:25-30` states the module's own rule:
   *"Every exclusion is named … Silent filtering is how a requestor ends up staring at an empty
   candidate list with no idea whether the network is down, its clock is wrong, or the module
   needs a feature nobody has."* It is enforced structurally: `ExclusionReason`
   (`discovery.ts:165-187`) is a six-arm union, and `describe` (`discovery.ts:217-232`) is a
   `switch` over it with **no `default` arm**, so TypeScript's exhaustiveness check fails the
   build if an arm is added and left undescribed. A generic
   `capabilities: Record<string, string[]>` matched by a generic query forces one of two
   outcomes, and both are regressions: a catch-all
   `{ kind: 'capability-mismatch', name: string }` whose `detail` cannot say anything specific
   to the axis, or a runtime registry of describers — which moves an exhaustiveness guarantee
   the compiler currently gives for free into code that can silently miss a case. The current
   design pays one union arm per kind and gets a compiler-enforced guarantee. That is a good
   trade at 6 arms and is still a good trade at 10.

2. **The wire parser becomes lossy in the one way this repo has already ruled against.**
   `parseCapabilities` (`packages/net/src/protocol.ts:674-686`) reads exactly six named fields
   and constructs a record from them; unknown keys are dropped. `capabilityPayload`
   (`core/src/discovery.ts:88-99`) signs exactly five of those. A generic map field would have
   to be parsed generically *and* signed generically, and the repository has already written
   down what goes wrong when a parser drops a field the signer covered —
   `protocol.ts:368-375`, about the X.509 field: *"a certificate stripped of a field its issuer
   signed no longer verifies and the reader would be told `bad-signature` about a frame this
   parser had damaged."* §6 shows this hazard is **live today** for `CapabilityRecord` and is
   the one thing worth fixing now.

3. **You would be building the second floor of an unoccupied first floor.** `c94bc7a` closed
   audit finding G5 as a measured negative (`.planning/v1.1-MILESTONE-AUDIT.md:645-655`):
   *"There is no unflagged path in this repository on which `discoverCandidates` can qualify a
   single candidate."* The audit checked three homes and each refuses for a documented reason —
   `bin/agent.ts` is serving-only and never calls `submitJob`; no visitor path on the demo
   enrols, so `trustedIssuers` is empty and every provider is excluded `invalid-certificate`;
   and `bin/bench.ts --discover` is the only place every precondition is built, off by default.
   The audit's conclusion is that *"the work is not wiring, it is a role."* The **filter** half
   of capability discovery has therefore never qualified a candidate on a default path.
   Generalizing the filter mechanism before it has run once end-to-end means the abstraction
   would be validated by its type signature and by nothing else.

   This is also evidence **for** the brief's suspicion that the split is intrinsic rather than
   incidental — but by a different route than expected. It is not that the two kinds resist
   unification; it is that the filter pipeline has no production reader, so there is no
   observation available that could tell a good unification from a bad one.

---

## 4. Trust and self-punishment

### 4.1 What self-signing currently buys

`discovery.ts:17-23` is precise about it: a `CapabilityRecord` on its own is worthless —
anyone mints a keypair and claims anything — and it becomes meaningful *only* because the same
`nodeKey` must also carry a certificate a pinned provider signed. Discovery is an intersection
of three independently-sourced facts (`discovery.ts:8-16`), and the record is one of them.
`discoverExecutors` enforces the binding at `discovery.ts:272-275`: certificate and capability
record must name the same key, refused as `certificate-mismatch` otherwise.

The split exists for a stated operational reason (`discovery.ts:21-23`): a node whose engine
gains a feature re-signs one small record locally instead of going back to the provider for a
fresh certificate. **The self-signature buys cheap re-issuance, and the certificate buys the
identity. Neither buys truthfulness.**

### 4.2 Self-punishment is what covers the truthfulness gap — and it is not uniform

Nothing in `discoverExecutors` verifies that a claim is true. What makes `features` safe is
**not** cryptography, it is that a false claim destroys itself: dispatch a module needing
`simd128` to a node lacking it and the instantiation traps, the task fails, and the failure
names the node. The liar pays, immediately and visibly.

Sorting the six kinds by that property:

| Kind | False claim causes | Detected? | Verdict |
|---|---|---|---|
| WASM features | task fails at instantiation | **immediately, by the requestor** | self-punishing. Self-signing suffices. |
| `sovereignFor` | **plaintext exposure to a node that should not decrypt** | **no** — see 4.3 | **not** self-punishing; anchored elsewhere |
| H3 cells | node wins vicinity work it should not; **executes correctly** | no | not self-punishing |
| Available memory | OOM mid-task | **late** — after work is done, and indistinguishable from churn | weakly self-punishing, at real cost |
| Accelerator | slow path; **correct answer** | no | not self-punishing |
| Compliance zone | a regulatory violation | **never**, by construction | not self-punishing, and not node-signable at all |
| **Capability class** (`parallel-compute`) *(added 2026-08-11, §9 decision 8)* | node wins work it is **bad at**; returns a correct answer, slowly | no | **not** self-punishing — sits with H3, not with `features` |

**Only one of the six is cleanly self-punishing, and it is the one field that is empty in
production.** That is the sharpest single fact in this analysis. The property the self-signing
design leans on is exhibited by exactly the capability kind that no node currently populates.

> **Added 2026-08-11 — capability classes do NOT inherit the feature list's honesty property, and
> this is recorded explicitly so nobody later assumes they do.**
>
> A class such as `parallel-compute` looks like `features` — an opaque label in a set on the same
> record — and the resemblance is misleading in the one way that matters. **A false WASM feature
> claim fails the task and names the liar. A node can claim `parallel-compute` and merely be bad at
> it**: it executes, it returns a correct answer, and nothing anywhere records that the placement
> was poor. On the §4.2 axis a class belongs beside H3 cells, not beside `features`.
>
> **It is nonetheless safe to self-sign, and for §4.3's reason rather than by exception.** The
> claim is not free-floating: the record is only meaningful bound to a certificate a pinned
> provider signed (`discovery.ts:17-23`), and the **operator identity in that certificate** is what
> carries independence. The one attack a false class claim could otherwise mount — one operator
> filling a quorum with many self-declared members — is already refused by VER-04's operator
> anti-affinity, taken by construction rather than as an afterwards check (`quorum.ts:176-179`,
> refusal at `:182-187`; these citations are unmoved by `32cba89`). So a class is a **placement
> hint whose abuse costs throughput, never correctness**, and §4.4's firewall applies to it
> verbatim: **no quorum composition rule may read a capability class**, for exactly the reason no
> quorum composition rule may read a cell.

### 4.3 `sovereignFor` is the interesting counter-example, and it shows the pattern that works

`sovereignFor` is *not* self-punishing — a node falsely claiming clearance for Alice's data
executes it perfectly well; the damage is that plaintext reached a node that should not have
seen it, and nothing fails. Yet it is safely self-signed. Why?

Because it is not really a free-form claim. `fabric-node.ts:1182` publishes
`sovereignFor: canExecuteSovereign ? [certificate.userKey] : []` — the value is **derived from
the certificate**, not chosen. `fabric-node.ts:1144-1158` explains at length why it must carry
`certificate.userKey` and never `sovereignty.ownerId`, invoking 17-CONTEXT decision 10:
*"a signed certificate is the worst possible place for a field with two answers."* So the honest
node's claim is a function of a provider-signed fact, and a dishonest node claiming a `userKey`
its certificate does not name is claiming something a verifier could in principle cross-check
against the certificate it must present anyway.

**That is the general pattern, and it is the right one to hold onto:** a non-self-punishing
capability is safe to self-sign only when its value is *derivable from, or checkable against,
the provider-signed certificate.* Where a capability cannot be tied back to the certificate, the
self-signature adds nothing but a timestamp.

Note the honest caveat: I found the *derivation* at `fabric-node.ts:1182` and the *reasoning* in
its docblock, but I did **not** find a check in `discoverExecutors` that cross-validates
`capabilities.sovereignFor` against `certificate.userKey` — `discovery.ts:290-294` compares it
only against the query. **So the cross-check is a property of how honest nodes construct the
record, not a property the verifier enforces.** Whether that gap is intended is outside this
spec's scope; I flag it because §7 turns on it.

### 4.4 Geographic claims, and VER-03/VER-04

The brief records the settled position — geographic claims are best-effort and may never on
their own satisfy VER-03/VER-04 — and the code supports it more strongly than "best-effort"
suggests.

`packages/core/src/quorum.ts:5-17` composes a quorum under two rules: no two replicas from the
same operator, and no single relay every member is discovered through. The first reads
`NodeCertificate.operatorId`, which `enrollment.ts:156-166` names *"the unit of quorum
diversity"* and deliberately distinguishes from `ownerId`: *"three nodes run by one operator
are one failure domain and one attacker, however many owners' data they hold."* VER-04
(`REQUIREMENTS.md:181-182`) is exactly this.

**A location field cannot improve on that, and could weaken it.** Location is a *proxy* for the
independence that `operatorId` states directly. Three VMs in three different availability
zones — three different H3 cells, honestly claimed — are one operator and one attacker, and the
`operatorId` rule already refuses them. Adding a geographic anti-affinity rule alongside would
at best restate the operator rule and at worst be read as a substitute for it, admitting a
quorum the operator rule refuses.

That failure mode has a name in this tree. `0314208` retracted a rule that *"keys on node
kind, which `STATE.md:1184` forbids outright"*, and the commit message is explicit that
*"naming the refusal after a missing path did not change what the predicate read."*
`quorum.ts:19-35` preserves the retraction in the source. A geographic anti-affinity rule is the
same shape: a proxy attribute standing in for the dependency analysis that already exists. The
cardinal rule generalizes past node kind — **if a decision keys on a proxy for a property the
graph already states directly, it is wrong.**

And the self-punishment analysis closes it: geographic anti-affinity would rest on a claim that
is not self-punishing, not certificate-anchored, and not checkable — the weakest possible
foundation for the one rule in the system that decides whether "3 of 3 agreed" means anything.

**Conclusion for §4:** geographic capability is legitimate for *placement* (latency, data
residency preference, vicinity queries) and must be firewalled from *verification*. Whatever
form H3 takes, no quorum composition rule may read it.

---

## 5. Churn and record validity

### 5.1 The validity window is not independently choosable

`fabric-node.ts:1160-1164` states the design: *"The record's validity window is the
certificate's own. That needs no new policy number, and it makes a node whose certificate has
expired stop advertising capabilities at exactly the moment it stops being verifiable."* The
code does it at `fabric-node.ts:1183-1184` (`issuedAt: certificate.issuedAt`,
`expiresAt: certificate.expiresAt`) and `browser-node.ts:618-619`.

The default certificate lifetime is **30 days** (`enrollment.ts:653`:
`options.certificateLifetimeMs ?? 30 * 24 * 3_600_000`). `verifyCapabilityRecord`
(`discovery.ts:117`) refuses only on `issuedAt > now || expiresAt <= now`.

**So every capability record in this system is signed with a ~30-day window and no
finer-grained freshness concept exists.** A location field inside that record is a statement
that a node is in cell X for the next month. For a mobile node, that is false within seconds.

Three ways out, all with costs:

- **Shorten the window for the whole record.** Destroys the "needs no new policy number"
  property, and worse, decouples record expiry from certificate expiry — which is the exact
  alignment `fabric-node.ts:1163-1164` says makes a node stop advertising at the moment it
  stops being verifiable.
- **Split into two records with two windows.** Now `NodeRecords` (`discovery.ts:129-132`) has
  three members, `recordsFor` returns a triple, and the wire frame grows an arm. This is a
  real design, and it is the one a generalization would have to adopt — but it is a schema
  change of the size the H3-as-content design was chosen specifically to avoid.
- **Re-sign frequently within the same long window.** Signing is cheap (ed25519, local, private
  key never leaves — `discovery.ts:101`). Propagation is not, and this is where it breaks:

### 5.2 The first-non-empty rule for `recordsFor` assumes records are effectively immutable

`RpcRecordIndex.recordsFor` (`packages/net/src/discovery.ts:124-131`) loops over peers and
**returns the first non-empty answer**, with an early return asserted by a request counter in
`provider-merge.test.ts`. The justification is written out at `net/src/discovery.ts:44-47`:

> *"A **record** is a signed document. One copy of it is the whole of it: every field is covered
> by a signature `discoverExecutors` verifies against a pinned issuer, so a second copy from a
> second peer could only agree with the first or be discarded. First-non-empty is the right
> answer and stays."*

That argument is **correct for a low-churn record and false for a re-signed one.** Two vintages
of the same node's record, signed minutes apart, *both verify* — they do not "agree or get
discarded", they are both valid, and they say different things. There is no `issuedAt`
comparison anywhere in the resolution path: the loop returns whichever peer answers first.

**This is the concrete defect a high-churn capability would introduce, and nothing in the code
would notice it.** It would not fail a test, would not produce an exclusion, and would not log.
It would silently return a stale location, and the staleness would be a function of peer
ordering — which is to say, unattributable. The module doc explicitly asks the reader to
*"read that before changing either: they are not two spellings of one policy"*
(`net/src/discovery.ts:20-22`); putting a churning field into the record changes which policy
is correct without changing the code that implements it.

### 5.3 Index and republish load

**Inferred, not measured — I ran nothing:**

- Republish cost per node is one ed25519 signature (negligible) plus propagation. Under the
  current pull model there is no push: a record reaches a requestor only when the requestor asks
  `recordsFor`. So the cost is not republish bandwidth, it is that **the pull model has no
  freshness contract at all** — §5.2.
- Under the D1 ruling (`discovery.ts:431-440`), records and provider lists are *computed at ask
  time*, and the ruling's own stated reasons include that *"a node that evicts a block still
  reads as a provider until something retracts the announcement."* A high-churn location claim
  is precisely a fact that goes stale without retraction. **The D1 reasoning already argues
  against putting churning facts in announced records** — it just was not written about
  location.
- The H3-as-content design sidesteps most of this, which is a real advantage: a cell claim is
  a *stored block*, and `SelfRecordIndex.providers` (`discovery.ts:511-520`) checks
  `store.has(cid)` at ask time. Move the phone, delete the old cell block, add the new one, and
  the answer is fresh with no signature, no window, and no republish. **This is a genuine
  architectural advantage of the content framing and it is independent of the entry-point
  question that §3 casts doubt on.** The costs are storage (one block per cell per resolution
  the node wants to be findable at) and that `withhold` (`discovery.ts:425`) now guards a
  privacy-relevant class of block — a location marker is exactly the sort of block whose
  advertisement is itself a disclosure.

---

## 6. Recommendation

### 6.1 DEFER the unified capability model

Five reasons, in descending strength:

1. **The generalization would abstract over one exercised example.** `sovereignFor` is
   populated in production (`fabric-node.ts:1182`); `features` is `[]` everywhere
   (`fabric-node.ts:1181`, `browser-node.ts:616`, `discover-candidates.ts:74-78`); H3 is not in
   the tree (§0). One is not a pattern.
2. **The filter/entry-point split is real but lives at a layer `CapabilityRecord` cannot
   reach.** A record is fetched by node key (`discovery.ts:145`), so it can never start a
   lookup. Unifying the record schema would unify the wrong thing and leave the actual split
   exactly where it is (§3.3).
3. **The candidate members disagree on signer, semantics, churn, window, and role, and no two
   disagree the same way** (§2). What unifies them is a tagged union — which is what
   `ExclusionReason` already is, with compiler-enforced exhaustiveness the generic version
   would give up (§3.4.1).
4. **The filter pipeline has never qualified a candidate on a default path** (G5,
   `v1.1-MILESTONE-AUDIT.md:645-655`). There is no observation available that could distinguish
   a good abstraction from a bad one.
5. **This tree has retracted an abstraction of exactly this shape** — a proxy attribute
   standing in for an analysis that already existed (`0314208`, preserved at
   `quorum.ts:19-35`, cardinal rule at `STATE.md:1184`). §4.4 shows geographic anti-affinity
   would be the same mistake with a different field.

### 6.2 Trigger condition — when to revisit

Deferral is only honest if the trigger is falsifiable. **Count alone never triggers it.**
Generalize when **three or more** capability kinds simultaneously satisfy **all five**:

| # | Property | Why it is on the list |
|---|---|---|
| T1 | **Filter role** — narrows an existing candidate set; does not start a lookup | An entry-point kind belongs in routing, not in the record (§3.3). Mixing them is the error this whole spec exists to prevent. |
| T2 | **Exact set-membership semantics** — subset test over opaque labels | Range (memory) and hierarchy (H3) each need their own matcher. A "general" mechanism that dispatches to per-kind matchers has not abstracted anything. |
| T3 | **Self-punishing, OR derivable from the provider-signed certificate** | §4.3. Otherwise the self-signature carries no weight and the kind needs a different trust anchor. |
| T4 | **Validity window compatible with the certificate's** (~30 days, `enrollment.ts:653`) | §5.1. A high-churn member forces a second record with a second window, which is a different design. |
| T5 | **At least two of the three carry a non-empty value in production** | §6.1.1. `features: []` proves nothing about how a real capability behaves. |

If three kinds meet all five, the variance is genuinely one-dimensional and the abstraction is
a compression rather than an invention. If any kind fails any of the five, **add a named field
with a named `ExclusionReason` arm** — the pattern that already worked twice.

**Anti-trigger, stated so it is not rediscovered:** "we now have five capability kinds" is not
the trigger. Five kinds that disagree on T1–T4 need five fields, and a mechanism that hides
that disagreement behind one field makes the code shorter and the refusals worse.

### 6.3 What is recommended *now* instead

Not the abstraction. One thing, and it is small:

**Give `CapabilityRecord` a forward-compatible, signature-covered extension seam before a
second writer needs it.** §6.4 is that specification. It is worth doing now precisely
*because* the answer to generalization is "not yet": deferral is only safe if the next
capability kind is cheap to add, and today it is not.

### 6.4 The defect this spec most wants fixed — ~~`CapabilityRecord` has no extension seam~~ **(FIXED in `32cba89`; §6.5)**

> **Superseded 2026-08-11 as to tense, not as to content — do not read this section as a
> description of the tree.** The hazard below was real when written and was **fixed the same day**,
> in `32cba89`. The diagnosis, the misattribution argument and the `payloadOf` precedent are all
> still the reasoning the fix rests on, so the section is kept whole. **What is no longer true is
> the present tense.** §6.5 records what shipped and where the implementation went a different way
> from this section's own suggestion.

~~**This is a live forward-compatibility hazard, readable today, independent of everything above.**~~
**Was live at `c94bc7a`. Closed at `32cba89`.**

The signed payload is built from exactly five named fields:

```
capabilityPayload  →  { nodeKey, features, sovereignFor, issuedAt, expiresAt }
                                                       core/src/discovery.ts:88-99
```

The wire parser reconstructs exactly six:

```
parseCapabilities  →  { nodeKey, features, sovereignFor, issuedAt, expiresAt, signature }
                                                       net/src/protocol.ts:674-686
```

Unknown keys are dropped silently. So the first node that signs a record carrying any new
field — `cells`, `memoryMib`, anything — produces a record that **every peer running an older
parser reports as `invalid-capability-record`** (`discovery.ts:172`, raised at
`discovery.ts:277-280`): the parser strips the field, `capabilityPayload` rebuilds a payload
without it, and the signature over the *with-field* payload does not check.

The repository has already written down that this misattribution is unacceptable —
`protocol.ts:368-375`, about the X.509 field:

> *"a certificate stripped of a field its issuer signed no longer verifies and the reader would
> be told `bad-signature` about a frame this parser had damaged."*

`NodeCertificate` was given the fix. `CapabilityRecord` was not.

**The precedent to copy is `payloadOf`** (`enrollment.ts:224-245`), whose conditional spread
carries its own reasoning at `:234-240`: *"Conditionally spread, never `x509: undefined`. Two
reasons, and both are load-bearing. **Compatibility:** a certificate with no X.509 form must
produce the byte-identical payload it produced before this field existed … **Integrity:** when
the form *is* present it is inside the issuer's own signature."* The parser half is
`protocol.ts:376-377` and `:388` — an absent key parses, a wrong-typed key refuses the whole
frame, and the field is never dropped.

**Be precise about what that pattern buys, because it is not everything.** Conditional spread
gives **backward** compatibility (records signed before the field existed still verify
byte-identically). It does **not** give **forward** compatibility: an old verifier meeting a
new record still drops the field and still fails. X.509 was in fact a lockstep change; the
conditional spread protected already-issued certificates, not old readers. **So a genuine
extension seam for `CapabilityRecord` needs more than the spread** — it needs the parser to
carry unknown fields through into the signed payload verbatim, or an explicit
`extensions: { [k: string]: CanonicalValue }` map that is signed as a unit and parsed
generically. `CanonicalValue` (`core/src/canonical/encode.ts:31-39`) already admits exactly
that shape, and DAG-CBOR's canonical map ordering handles the determinism.

I am **not** specifying which of those two to build — that is a design decision with its own
tradeoffs and it deserves its own analysis. What this spec asserts is the finding: ~~**the seam
does not exist**~~ *(true at `c94bc7a`; false at `32cba89` — §6.5)*, **the failure mode when it is
first needed is a misattributed `invalid-capability-record`, and the repository has already ruled
that class of misattribution out for the sibling record.**

### 6.5 What shipped — `32cba89`, and the one place it chose against §6.4

*Added 2026-08-11. Every citation in this subsection was read at `32cba89` and resolves at `HEAD`.*

`CapabilityRecord` gained `readonly extensions: readonly CapabilityExtension[]`
(`packages/core/src/discovery.ts:195`), where `CapabilityExtension` is
`{ id: string, critical: boolean, value: CanonicalValue }` (`discovery.ts:121-130`) — X.509's own
answer, and the shape this repository already has a profile for. Covered by the node's signature,
canonically ordered by `id`, duplicate ids refused, and **preserved verbatim by the wire parser
including ids the reading build has never heard of** (`packages/net/src/protocol.ts:690-735`).
That preservation is the whole seam: the payload recomputes identically, so **a peer that can do
nothing with an extension can still verify the record that carries it.**

**§6.4 named two candidate designs and the implementation picked neither — it picked a third, and
then closed one of the two off deliberately.** §6.4 offered *"the parser to carry unknown fields
through into the signed payload verbatim, or an explicit `extensions: { [k: string]: CanonicalValue }`
map."* What shipped is a **list of tagged, flagged extensions**, and `parseCapabilities` now
**refuses an unknown top-level key rather than dropping it** (`protocol.ts:749-757` for the closed
key set, applied at `:771`). So §6.4's first option is not merely unchosen, it is now **forbidden by
the parser**. The source states the reason where it lives (`discovery.ts:96-103`): a pass-through
map has nowhere to say *"a reader that cannot honour this must refuse"*, so a security-relevant
field would be ignored by exactly the peers unable to enforce it; and it makes the record's shape
unbounded, so no reader can say what it is holding.

**The `critical` flag is the mechanism §6.4 did not know it needed.** Unknown and
`critical: false` is verified, preserved and ignored. Unknown and `critical: true` is refused under
a **new** `ExclusionReason` arm, `critical-extension-not-understood` (`discovery.ts:383-398`),
whose text names *this build* rather than the peer — *"this build does not understand …, which
`<nodeKey>` marked critical — its record verified, and this reader is the one that cannot honour
it"* (`discovery.ts:463-468`). **The check is asked only after the signature has verified**
(`discovery.ts:527-536`), and that ordering is what makes the attribution structural rather than
conventional: at that point the signature is known good, so anything refused below is refused by
this reader's limits.

**This satisfies G2 exactly.** A new axis arrived with its own named `ExclusionReason` arm and its
own `describe` case, so the exhaustiveness guarantee §3.4.1 defends is intact and the union is now
seven arms rather than six. §3.4.1's trade — *"one union arm per kind, compiler-enforced"* — was
paid once more and is still a good trade.

**Two consequences for the rest of this document:**

1. **G6 is discharged** (§7, struck there).
2. **The next capability field is cheap, which is what made the §6.1 deferral safe.** §6.3 said the
   deferral *"is only safe if the next capability kind is cheap to add, and today it is not."*
   Today it is. That is the precondition §9's model is now spending.

**What it still costs, because the commit states it and this spec should not soften it.** Adding
the field is itself a breaking change for peers built before it existed, and no design removes
that. Two things are true beside it: it is the **last** such break, because after this a capability
field rides inside `extensions`; and the blast radius is narrowed to records that actually carry an
extension, since `extensions` is spread **conditionally** — exactly as `payloadOf` spreads `x509`
— so a record with none produces the byte-identical payload it produced before the field existed
(`discovery.ts:240-259`, and `@o2/net` spreads by the identical rule at `protocol.ts:672-686`).
A node upgrading does not become unreadable to its older neighbours
merely by restarting.

---

## 7. Interim guidance — so the two kinds do not diverge unfixably

The most valuable output of a deferral. Seven rules, each with the specific later-unification
cost it prevents.

**G1 — Do not add a `Record<string, string[]>` capability map "for later."**
That is the abstraction, arriving early and unexercised, and it silently disables the
exhaustiveness guarantee at `discovery.ts:217-232`. Add named fields with named
`ExclusionReason` arms. Two exist; a third is fine.

**G2 — Every new capability field gets its own `ExclusionReason` arm and its own `describe`
case.** Non-negotiable, because it is the module's stated rule (`discovery.ts:25-30`) and
because a future unification is *easier*, not harder, when every axis already has a name and a
human-readable string to migrate. A generic reason kind now would destroy information that
cannot be recovered later.

**G3 — Keep H3 out of `CapabilityRecord`, and keep the reason on record.** Not because
content-addressing is prettier, but because (a) a record is fetched by node key so it can never
start a lookup (§3.3), (b) its validity window is the certificate's 30 days (§5.1), and (c) the
first-non-empty resolution rule has no freshness ordering (§5.2). All three are properties of
the record mechanism, not preferences.

**G4 — Correct the H3 design's entry-point claim, or scope it.** *(Directed at the parallel
spec, which I could not read — §0.)* `providers` reaches directly-connected peers only
(`discover-candidates.ts:38-44`, `net/src/discovery.ts:96-115`), so `providers(cellCid)` is
today a filter over the connected set, not a lookup that starts from nothing. The design still
works — it just delivers vicinity-within-the-connected-set until transitive routing exists.
**Stating that limit is worth more than the claim it replaces**, and the alternative is a
capability whose headline property is unmeasurable on the tree that ships it.

**G5 — No quorum composition rule may read a geographic claim.** §4.4. `operatorId`
(`enrollment.ts:166`) already states the independence that location proxies for, and a proxy
standing in for a direct graph property is the retracted-rule shape (`0314208`,
`quorum.ts:19-35`, `STATE.md:1184`). If a geographic input to VER-03/VER-04 is ever proposed,
it must first answer why `operatorId` is insufficient.

**~~G6 — Before adding any third field to `CapabilityRecord`, close the extension seam (§6.4).~~
DISCHARGED 2026-08-11 in `32cba89` — and it inverted into a prohibition.**
~~Whoever adds field three pays a lockstep wire upgrade and gets a misattributed
`invalid-capability-record` for their trouble. Cheapest possible moment to fix it is before
there is a third field; the cost rises monotonically.~~

> **The rule that replaces it, and it points the opposite way.** The seam is closed (§6.5), so the
> cost this rule was protecting against is paid. **In its place: a third capability field must be
> an entry in `extensions`, not a new top-level key** — and this is no longer advice, it is
> enforced. `parseCapabilities` refuses a frame carrying a top-level key outside
> `CAPABILITY_KEYS` (`packages/net/src/protocol.ts:749-757`, applied at `:771`, read at
> `32cba89`), and refuses an extension carrying a fourth key beside `{id, critical, value}`. The
> envelope is closed **because `value` is open**. G1 is unchanged and now has a second reason: the
> `Record<string, string[]>` map G1 forbids is also the pass-through design §6.5 records the
> implementation deliberately rejecting.

**G8 — A capability class is a FILTER and must never be a discovery anchor.** *(Added 2026-08-11,
§9 decision 3.)* `'parallel-compute'` is the least selective key in the system; anchoring a lookup
on it and intersecting with a second anchor returns approximately nothing, **silently**. The
arithmetic is in the DHT spec (`2026-08-11-dht-record-index-design.md` §5.4) and it is a hard
bound, not a tuning matter. One selective anchor, then local filters. A class may appear inside a
**composite** anchor (`app:X + cell`), which is selective again.

**G9 — Anything that rides the connection with a record is bounded by the measured transport
budget.** *(Added 2026-08-11, §9 decision 7.)* WebRTC's maximum message is 16 KiB and a relayed
connection's total is 128 KiB — both measured constraints recorded in `CLAUDE.md`. A certificate
plus a small record fits; a record enumerating hundreds of cells does not. This is an **independent**
argument for a floor resolution in the H3 design, separate from that spec's storage argument, and it
is an argument against ever letting a set-valued capability field grow unbounded.

**G7 — If a non-self-punishing capability is added to `CapabilityRecord`, tie its value to the
certificate the way `sovereignFor` is tied (`fabric-node.ts:1182`, reasoning at `:1144-1158`),
and consider making `discoverExecutors` enforce the tie.** §4.3 notes the honest gap: today the
`sovereignFor`↔`userKey` relationship is a property of how honest nodes *construct* the record,
not something `discovery.ts:290-294` checks. That is tolerable for one derived field and
becomes a real hole once a second non-self-punishing field exists.

---

## 8. Open questions

1. **Does the H3 design assume transitive content routing?** §3.2 says the entry-point property
   needs it and this tree does not have it. **I could not read that spec** (§0). If it already
   scopes itself to the connected set, G4 is satisfied and should be struck.

   > **Answered 2026-08-11 by reading it — G4 was already satisfied, and is struck.** The H3 spec
   > (`2026-08-11-h3-geographic-discovery-design.md`) scopes itself explicitly: its §8.3 gives a
   > per-use-case table of what works at relay scope and marks use cases 2 and 5 **"No"**, quoting
   > the same `net/src/discovery.ts:73-79` limit this section reads; its §8.4 states
   > index-agnosticism as the load-bearing property and says the design *gains* global reach when a
   > DHT is installed. So the entry-point claim was scoped, not overstated, and §3.2's correction
   > was aimed at a claim that spec did not make. **§3.2's underlying finding stands unchanged** —
   > `providers(cellCid)` is a filter over the connected set until transitive routing exists — and
   > it is now the DHT spec's problem, where §9 decision 9 reframes what that routing is *for*.

2. **Is `sovereignFor`'s uncheckedness intended?** `discoverExecutors` compares
   `capabilities.sovereignFor` against the query but never against `certificate.userKey`
   (`discovery.ts:290-294`). Honest construction supplies the tie (`fabric-node.ts:1182`).
   Whether a verifier-side check was considered and rejected, I did not find; I looked in
   `discovery.ts` and `fabric-node.ts` and did not search the phase records.

3. **What is the freshness contract for `recordsFor`, now that it is written down that there
   is none?** §5.2. The current rule is correct for the records that exist. It is worth a
   deliberate decision — even "records stay low-churn and first-non-empty stays" — rather than
   an assumption inherited from a comment written when only low-churn records existed.

   > **Largely answered 2026-08-11 by §9 decision 2, and answered by removing the question rather
   > than settling it.** If **records arrive with the peer** — the peer presents the record it
   > signed, on the connection it is already holding open — then there is no third party choosing
   > which vintage you see, and §5.2's "two vintages both verify and the loop returns whichever
   > peer answers first" cannot arise: there is exactly one answerer, and it is the signer.
   > **What remains open** is the case where a record is fetched from an index rather than
   > presented, which is precisely the DHT's `/o2rec/<nodeKey>` value record — see that spec's §5.2
   > selector, and this document's §9 decision 2 for why that machinery is now questionable.

4. **Does a location marker block need `withhold` treatment?** `SelfRecordIndex`'s `withhold`
   predicate (`discovery.ts:425`, invariant at `:452-470`) exists so the index never advertises
   a block `serveAgent`'s `block` branch would refuse. A cell marker's *advertisement* is itself
   the disclosure, which is a different shape from a block whose *contents* are sovereign.
   Unanalysed here.

5. ~~**Should the extension seam be pass-through unknown fields or an explicit signed
   `extensions` map?** §6.4 establishes the need and declines to pick. Both are expressible in
   `CanonicalValue` (`canonical/encode.ts:31-39`).~~
   **ANSWERED 2026-08-11 in `32cba89` — and by a third option neither arm named.** An X.509-style
   list of `{id, critical, value}`, with pass-through of unknown *top-level keys* now explicitly
   **refused** rather than merely unchosen. §6.5. The deciding consideration was one this question
   did not contain: a pass-through map has nowhere to carry *"a reader that cannot honour this must
   refuse"*.

6. **Does G5's "no unflagged path" finding block this work?** `v1.1-MILESTONE-AUDIT.md:655`
   says closing it *"needs an enrolled requestor on a default path."* Until that role exists, a
   third capability kind is unobservable in production for the same reason the first two are.
   That is an argument for sequencing the role before any capability work, and it is the owner's
   call, not this spec's.

---

## 9. Settled 2026-08-11 — the capability model is three-dimensional, and the dimensions live apart

*Owner ruling, taken in conversation on 2026-08-11 and recorded here rather than re-argued. Where a
decision contradicts something this document already argued, the contradiction is named in the
decision itself rather than left for a reader to find. Citations added in this section were read at
`32cba89`.*

### 9.1 Decision 1 — three dimensions, three homes

| Dimension | Where it lives | Why there | Usable as a discovery anchor? |
|---|---|---|---|
| `appIds` | the signed `CapabilityRecord` | **stable** — an app a node serves does not change at the rate a record expires | **YES** — `cidOf(appId)` |
| **Capability class**: `parallel-compute`, a **closed union**, currently one member | the signed `CapabilityRecord` | **stable** | **NO** — §9.3 |
| **H3 location** | **not the record.** Place blocks plus the `withhold` hook, answered at ask time | **MOBILE** — a signed record carries a validity window; a vehicle invalidates one in minutes | **YES** — `cellCid(cell)` |

**`cidOf` and `cellCid` are proposed derivations, not existing functions.** Neither name exists in
`packages/` at `32cba89` (`cidOf` appears only as a per-file test helper, e.g.
`packages/core/src/job/submit.test.ts:2820`). `cellCid` is specified in the H3 spec §5.1, over
`canonicalCid` (`packages/core/src/canonical/encode.ts:138`); an `appId` anchor would be derived by
the identical path. Stating this so the table is not read as a citation.

**Location is deliberately not a record field, and that is this document's own §7 G3 ratified
rather than overturned.** G3 gave three reasons — a record is fetched by node key so it cannot start
a lookup, its window is the certificate's ~30 days, and `recordsFor` has no freshness ordering — and
the ruling keeps all three. The positive form: **the record is a hint; the live answer is the peer's
`has(cid)` plus `withhold` at ask time**, which is owner ruling D1 already
(`packages/core/src/discovery.ts:689-697` for D1's own statement,
`:767-776` for `SelfRecordIndex.providers` computing it).

**Note the shape this table actually has, because it is not what §2 predicted.** §2 concluded that
the candidate kinds *"disagree on the signer, the match semantics, the churn class, the validity
window, and the role"* and that an abstraction over them is a tagged union wearing a hat. The
settled model **agrees**, and resolves it by splitting on the axis §2 identified as deepest:
**churn**. Two stable kinds share the signed record; the high-churn kind is expelled from it
entirely. That is not a generalization of `CapabilityRecord` — it is §6.1's deferral, held.

### 9.2 Decision 2 — records arrive **with** the peer; there is no per-candidate `recordsFor` round trip

The pipeline is: **`providers(anchor)`, then filter locally on the record the peer already
presented.**

**The justification is that the signature is what matters and the channel never was.**
`PeerVerifier`'s docblock says it outright (`packages/node/src/peer-verifier.ts:6-9`):

> *"it does so **offline by construction**: the trust anchors are an argument to
> `verifyCertificate`, so there is nothing for the verification step to reach out to. **The only
> network call this class makes is the `records` request that *fetches* the certificate; deciding
> whether to believe it touches nothing.**"*

And the fabric already takes a peer's certificate from the peer at the earliest possible moment —
the relay reservation, which `packages/libp2p/src/relay-admission.ts:7` calls the place *"a node's
lifecycle in this fabric begins"*, arguing that both advertisement surfaces derive from the
reservation store *structurally, with no filter to add and no `if` to forget*.

**So taking a record from the peer that signed it removes a third party who would otherwise choose
which peers you are permitted to evaluate.** It cannot weaken anything, because nothing was ever
trusted about the channel.

> **Where this contradicts existing code, stated rather than glossed.** `discoverExecutors` calls
> `index.recordsFor(nodeKey)` **once per provider**, inside the loop
> (`packages/core/src/discovery.ts:501`, provider set built at `:492`). That is exactly the
> per-candidate round trip this decision removes. **The resolution is not a change to
> `discoverExecutors`** — nothing about its shape is wrong — **but a `RecordIndex` implementation
> whose `recordsFor` is a local lookup over records peers have already presented.** The port was
> designed for precisely this substitution: its module doc says keeping the two methods together is
> *"what lets a single implementation be swapped for a DHT, a delegated HTTP router, or an
> in-memory fixture without the discovery logic noticing"* (`discovery.ts:344-350`). Whoever
> implements this must not conclude that `discoverExecutors` needs editing; the `RecordIndex` does.

### 9.3 Decision 3 — classes are filters, never anchors, and the reason is a hard bound

**Full statement, with the arithmetic, is in the DHT spec §5.4** (added the same day). In summary: a
Kademlia provider lookup is **truncated** — `ProvidersInit.cacheSize` defaults to 256 and
`kBucketSize` to 20, both already cited in that spec — and **intersecting two truncated samples of
large sets returns approximately nothing**. Worked example: 10 000 nodes in a cell, 9 900 of them
sharing a class, two capped lookups of 256 drawn from a keyspace population of ~1e6 → expected
intersection **≈ 0.07 nodes**, while 9 900 actually qualify.

**And it fails silently**, which is what makes it a defect rather than a limitation: an empty result
is indistinguishable from *"nobody matches"*. That is the exact shape `discovery.ts:25-30` was
written against — *"silent filtering is how a requestor ends up staring at an empty candidate list."*

**Rule: one selective anchor, then local filters.** `'parallel-compute'` is the least selective key
in the system and must never be an anchor. A class may appear inside a **composite** anchor
(`app:X + cell`), which is selective again — the composite is one key, not an intersection of two
lookups, and that is the whole difference.

### 9.4 Decision 4 — query API shape: the caller names the anchor, and truncation is named

**No query planner.** The caller states which anchor to use. Choosing it automatically is a planner,
the evidence to build one does not exist, and YAGNI applies with force in a repository whose §6.1
deferral rests on the same argument.

**The query carries `onTruncated: 'refuse' | 'report-partial'`.** If the anchor lookup returns *at*
the cap, the result is a **SAMPLE, not a SET**. This codebase names every exclusion rather than
letting an unmeasured thing read as measured (`discovery.ts:25-30`), and a silently-capped provider
list is an unmeasured thing reading as measured. Neither value is a default here; the caller states
which failure it wants.

### 9.5 Decision 5 — exact WASM features leave the discovery path

Recorded at §1 above, where the claim it corrects lives.

### 9.6 Decision 6 — the anchor is hashed for free

`cidOf(appId)` means the DHT lookup key is **opaque to anyone who does not already know the app id**.
That **softens — and does not remove** — the traffic-analysis exposure the DHT spec §9.1 records,
whose own honest statement is that *"DHT-primary discovery is strictly more exposure than what it
replaces."* Plaintext ids appear only in a record handed to a peer that is already connected.

**Do not generalize this to cells.** The H3 spec's Q5 already records that cell CIDs are computable
by anyone, so a cell anchor is enumerable by construction and hashing buys nothing there. The two
anchor kinds have genuinely different disclosure properties and the difference must not be averaged.

### 9.7 Decision 7 — presented-record size bound

Recorded as **G9** in §7, where the interim rules live.

### 9.8 Decision 8 — classes are not self-punishing

Recorded in **§4.2**, where the self-punishment analysis lives, as a seventh row and a note.

### 9.9 Decision 9 — the DHT is **existence discovery only**

It tells you a peer **exists**; the **facts** come from the peer (decision 2). Stated in full in the
DHT spec §5.5. Its largest consequence there: the 48 h un-retractable provider record becomes much
less damaging, because the peer's live answer overrides a stale one — which is D1's own reasoning
arriving at the DHT rather than being contradicted by it.

### 9.10 Decision 10 — deferred, deliberately, and recorded so it is not re-discovered as new

**A coarse cell (res ~5, ~250 km) could also sit in the signed record as a cheap pre-filter.** It is
stable even for a moving vehicle — a driver does not leave a metropolitan-region cell in a shift —
so it does not carry the churn objection that expels fine cells from the record, and it would save a
lookup on *"roughly near me"*.

**Deferred under YAGNI until something measures the need.** It is recorded here because a later
reader meeting the idea should know it was considered and parked, not overlooked — and because it
would be the **first** use of the extension seam §6.5 just built, which makes it the natural test of
whether that seam works as designed.

### 9.11 Decision 11 — a lookup is **one capability plus an appId**, and nothing else

**Settled 2026-08-11, after §9.3 and §9.4 were written, and it supersedes the part of them that
built machinery for the general case.**

A lookup names **exactly one** capability and **exactly one** `appId`:

```
cidOf(appId + capability)     capability ∈ 'parallel-compute' | cell:<h3>
```

There is no intersection of several capability lookups. There is no query planner. The caller
supplies both halves or it does not have a query.

**What this retires.** §9.3's arithmetic — two capped lookups of 256 each drawn from ~1e6 giving an
expected intersection near zero while thousands qualify — was an argument against *intersecting*.
Nothing intersects now, so that failure mode cannot arise. §9.3's *conclusion* still stands and is
now structural rather than advisory: `'parallel-compute'` is never an anchor **on its own**, because
an anchor is always the pair. §9.4's "the caller names the anchor" likewise stops being a discipline
a caller could get wrong — the signature admits nothing else.

**What survives, and it is the only piece of §9.4 that does.** A *single* key still truncates:
`ProvidersInit.cacheSize` defaults to 256, and a widely-deployed app in a dense cell will exceed it.
An empty or short answer remains indistinguishable from *"nobody matches"* unless the reader is told,
so `onTruncated: 'refuse' | 'report-partial'` stays. It is now one field rather than the entry point
to a subsystem, and it carries the whole of this design's obligation not to let a **sample** read as
a **set**.

**Advertisement stays bounded, and the bound is worth stating.** A node publishes one key per
(`appId` × capability) pair it satisfies — two apps offering compute is two keys. The combinatorial
objection that rules out a general capability-conjunction mechanism does not bite at this size. Cells
are the one multiplying term, which is exactly why §9.1 keeps them on the live `withhold` path with
the published record as a hint the peer's own ask-time answer overrides.

**What it costs, stated rather than left to be found.** A caller wanting *"nodes for app X that
compute **and** are near me"* must pick one and filter the other locally from the presented record —
or publish a purpose-built composite key for that pair. The general answer is deliberately not
available, and this paragraph is the record that it was declined rather than missed.
