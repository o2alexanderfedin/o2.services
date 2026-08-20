# Phase 19 criterion 5 cannot close from the browser tier, and the reason is a standing rule

**Investigated 2026-08-20**, prompted by a live-browser reading that `owner-domain`
appears nowhere on the demo page (`27-UAT.md`, test 13). The conclusion is **not** that
something is broken. Everything found is deliberate, documented, and guarded.

## What was checked, and what each answer was

**1. Is the sovereign dispatch's refusal a defect?** No. `main.ts:2189-2201` states the
reason and calls it what it is:

> The correct reason is placement… `attestedNodes` declares `ownerId: 'public'` on every
> descriptor this page builds, and `eligibleNodes` places a sovereign shard only on a node
> whose `ownerId` **equals** the shard's — so every sovereign dispatch from this surface is
> unplaceable and no remote executor is ever handed one.
>
> **So this is a bound, not a proof, and the bound has a named edge.** … Wire a chain here
> *before* that day, not after it.

The named edge — a visitor typing the literal `public` — is not an unguarded hole. It is
the arm `demo-byo.e2e.test.ts` calls `OWNER_THE_NODES_DECLARE`, it is dispatched and
measured, and the file carries a **source-text guard** (`:804-808`) that reddens the day
`attestedNodes` stops falling back, with the message *"re-plan this case"*. The sequencing
is enforced, not merely intended.

**2. Is VER-10's "owner-domain on a screen, for the first time anywhere" false?** **No,
and this was the reading most at risk of being called a false claim.** It is true.
`attestation-ui.e2e.test.ts:526` builds the smallest fabric that yields the label — a tab
and a sibling peer enrolled at **one** provider under **one** owner key and operator id,
two replicas under one operator — and asserts the kernel's own sentence on the page. The
live session reached no certificates at all (`lastCandidates().asked === false`), so
classification could never arrive at that label. Absence on one run is not absence
everywhere, and it was wrong of the UAT note to leave the two indistinguishable.

**3. So what is criterion 5 actually missing?** The label shown for a **sovereign** shard.
The two halves exist and they are in different files:

| | dispatches sovereign shards | renders the label |
|---|:---:|:---:|
| `browser-capability.e2e.test.ts` | **yes** — a tab pinned `canExecuteSovereign: true` executes `label: 'sovereign'` work | **no** — zero references to the page, its regions or its report |
| `attestation-ui.e2e.test.ts` | **no** — asserts `registered no sovereign data` | **yes** — `owner-domain`, VER-10 |

## Why the two halves are apart, and why joining them is not a patch

Because **`TabApi.start` deliberately carries no `sovereignty` option**, and that is a
standing rule stated independently in two files:

- `tab-api.ts:816-827` — *"`sovereignty` pins the owner a node will accept work for… it is
  meaningful only to whoever operates the node, and no visitor-facing surface reports it"*,
  contrasted at length with `enrollment`, which **is** on the contract precisely because a
  criterion obliges the page to display attestation.
- `capability-harness.ts:12-26` — the harness exists *"rather than a third option on
  `window.o2`"* because adding `BrowserNodeOptions.sovereignty` there *"would put node
  configuration on the page's own contract to serve a test"*.

So the surface that **renders** attestation cannot be pinned to an owner, and the harness
that **can** be pinned renders nothing. Criterion 5 needs one node that does both.

**Three ways to get there, and all three are owner decisions rather than edits:**

1. **Put `sovereignty` on the page contract.** Closes the criterion directly and breaks the
   rule above in the exact words both files use to forbid it.
2. **Give the harness a rendering surface.** Keeps the rule; means a second page, or the
   demo page driven by a harness-started node — new surface area for a verdict.
3. **Let a visitor's tab hold an owner identity for real**, so the demo page's own node is
   pinned by the visitor's certificate rather than by a test. This is the open item that has
   already had **three design rounds rejected**, and `main.ts` warns the capability chain
   must be wired *before* it, not after.

## What this changes

**Nothing in the tree.** No code was edited, because every candidate edit either breaks a
standing rule or pre-empts a sequencing constraint the repository states explicitly.

**One thing in the record**: `27-UAT.md`'s test 13 read as though the label were simply
missing. It is not missing — it is unreachable *for a sovereign shard* from the only
surface that draws it, for a stated reason. That file is amended rather than back-edited.

**And one thing is now named that was not before**: criterion 5 and the open item "a
sovereign dispatch from the demo page is still refused" are **one item with one blocker**,
and the blocker is a design decision about the page contract — not missing wiring, not a
bug, and not something a verifier can close by re-reading the code.

---

# AMENDMENT 2026-08-20 (later) — the criterion number in this file's title is WRONG

Found while writing the session handoff, by reading Phase 19's criteria list instead of
trusting the label three of this session's own artifacts had already agreed on.

**Phase 19 criterion 5 is not this.** `ROADMAP.md:816` and `.planning/milestones/v1.1-ROADMAP.md:816`
carry the same text, word for word:

> 5. **Enrolling a node costs an attacker something they cannot mint for free**, and the cost
>    is measured: creating the N-th fake identity is demonstrably more expensive than creating
>    the first.

That is the sybil-cost clause, scored PARTIAL and **deferred to Phase 24 by owner ruling**
(`19-VERIFICATION.md:131`). It has nothing to do with attestation labels.

**Where the property is actually written down.** `19-VERIFICATION.md:647`, as VER-09's open
clause, in the requirements table:

> | VER-09 | `[ ]` Partial | Correct, and the open clause is named: no display site has shown
> | the label for a **sovereign** shard. |

**And that row has since closed on words that do not include it.** `REQUIREMENTS.md:1230`
marks VER-09 **Done, 2026-08-19**, on its own quoted test — *"a default path that reaches an
owner-pinned execution at fewer than two live owner nodes and renders `owner-attested` off
it"* — which `bin/agent.ts`'s sovereign coordinator leg satisfies. `owner-attested` at
redundancy 1, on the CLI. Not `owner-domain`, and not on a display site.

**So what is the standing of this item, stated precisely rather than assumed:**

| | |
|---|---|
| Phase 19 criterion 2 (owner-domain for a sovereignty-pinned task, via `bin/agent.ts`) | **MET** |
| Phase 19 criterion 3 (the strength label wherever displayed) | **MET** |
| Phase 19 criterion 5 (sybil cost) | PARTIAL, deferred to Phase 24 — **a different item entirely** |
| VER-09 | **Done** 2026-08-19, on the CLI route |
| VER-10 | **Done** 2026-08-14 |

**No open numbered criterion and no open requirement row currently carries "owner-domain, for
a sovereign shard, on a display site."** It survives in exactly two places: the open-item list
(*"a sovereign dispatch from the demo page is still refused"*) and this file.

**What this changes and what it does not.** The analysis above is untouched — the two halves
really are in different files, `TabApi.start` really does carry no `sovereignty` option by
standing rule, and the three routes really are owner decisions. **What changes is the item's
weight**: it is a self-imposed residue, not an unmet criterion, so nothing is blocked on it
and no score moves when it closes. That strengthens this file's conclusion rather than
weakening it — there is now no scoring pressure to break a standing rule.

**The title is left as it is, and the file is not renamed.** Two commits and a test docblock
cite it by name. A dated correction that a reader meets is worth more than a tidy title that
silently rewrites what three artifacts said.

**The same mis-citation is in two other places**, listed here rather than back-edited:
`27-UAT.md` test 13 and its Gaps entry (`phase: 19, criterion: 5`), and
`packages/node/src/attestation-ui.e2e.test.ts:677` (*"Phase 19 criterion 5 — `owner-domain`
for a SOVEREIGN shard"*) with the test name at `:752`. The test's **assertions** are unaffected —
it measures `unauthorized: no capability chain supplied` and that reading stands whatever the
clause is numbered.
