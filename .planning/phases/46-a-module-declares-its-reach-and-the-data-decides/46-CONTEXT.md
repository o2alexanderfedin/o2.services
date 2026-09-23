# Phase 46 — A Module Declares Its Reach, and the Data Decides — CONTEXT

**The design is `.planning/ROADMAP.md`'s Phase 46 block and `CAP-01`.** Both are committed.
This file records only what was **measured on 2026-09-23** while scoping, and the decisions
that measurement forced. Nothing here re-derives the design, and nothing here re-opens a
ruling.

## 0. The phase is a field, a check and a codec — the seam already exists

`Task` (`packages/core/src/ports.ts:52-94`) already carries all three inputs the decision
needs, and **all three arrive from whoever dispatched the task**:

| Input | Where | Carried because |
|---|---|---|
| `label?: Sovereignty` | `ports.ts:73` | "so a refusal can be made there (DATA-09) rather than trusted to whoever dispatched the task" |
| `ownerId?: OwnerId` | `ports.ts:74` | same sentence |
| `moduleRecord?: NameRecord` | `ports.ts:93` | "it travels with the task so the refusal can be made on the serving node" |

`guardModuleProvenance` (`packages/core/src/executor/module-provenance.ts:130`) already
resolves and verifies that record — `provenance.resolver.accept(record, provenance.now())`
against anchors pinned at construction, then signed-CID against `task.moduleCid`. Its refusals
are a discriminated union `ModuleRefusal` rendered by `describeModuleRefusal`. **That is this
repository's shape for a named refusal; copy it rather than inventing one.**

`guardSovereignty` (`packages/core/src/executor/sovereignty-guard.ts:90`) already refuses
before `inner.execute`, and its own docblock already carries criterion 2's ordering argument
verbatim: *"`inner.execute` for a real `WasmExecutor` is what reaches
`WebAssembly.instantiate`, and this function never reaches that line when it refuses."*

Composition, identical at `packages/node/src/fabric-node.ts:2929` and
`packages/browser/src/browser-node.ts:2532`:
`new CountingExecutor(guardSovereignty(provenance(abi), sovereignty))` — sovereignty
**outermost**, provenance **inside** it. The two sites are identical by design. If one moves,
the other moves in the same task, or the tiers refuse different things.

## 1. The trap, and this repository has already shipped it once

`NameRecord` crosses the wire through a **hand-written** codec, not a spread:
`nameRecordToValue` (`packages/net/src/protocol.ts:1079`) lists every field explicitly, and
`parseNameRecord` (`:1161`) parses each one back. A new signed optional field added to
`NameRecord` and `payloadOf` but **not** to both halves of that codec reproduces a bug already
shipped and fixed here. The fix's own words, `protocol.ts:1064-1068`:

> `payloadOf` hashes `translationKeyCid` and `delegation` when they are present, so a record
> carrying either used to arrive on the far side with the field gone — and the receiver then
> recomputed a payload the publisher never signed and reported `bad-signature`. **A transport
> bug wearing a forgery's name, and unfalsifiable from the receiving end.**

**Decision: the round trip is a case, not a note**, and it is copied from the case that already
exists for exactly this — `packages/net/src/protocol.test.ts:122`, *"carries a DELEGATED record
across the wire so it still verifies against the root"*. Its shape is the requirement:
round-trip through `encodeRequest`/`parseRequest`, then **re-verify with
`SignedNameResolver.accept`**, because its own comment records why field equality is not
enough — *"equality above would pass on a delegation whose `expiresAt` had been widened by a
JSON round trip; only accepting it proves the bytes the root signed survived intact."*

`parseNameRecord`'s rule for an optional field is also the rule here (`:1172-1174`): absent is
fine; **present-and-unparseable refuses the whole record**, because dropping it hands the
resolver a payload that differs from the signed one.

## 2. The field follows `translationKeyCid` and `delegation` exactly

`payloadOf` (`naming.ts:160`) **spread-omits** an absent field —
`...(x === undefined ? {} : { x })`, never `x: record.x` — because "an explicit `undefined` is
not the same as an absent key to a canonical encoder". `nameRecordToValue` states the same rule
at `:1075-1077` and says the two must agree or nothing verifies. **That spread is what makes
criterion 1's second half true**: a record omitting the declaration hashes byte-identically to
one signed before the field existed.

**Decision on naming: the field names a wish, not a permission.** This phase grants nothing, so
`grantsNetwork`, `canFetch`, `allowNetwork` or anything in that family would be a lie in the
type system. The roadmap and `CAP-01` both call it the module's *wish* to reach the network;
the identifier must read that way to somebody who has never opened this file.

## 3. Where the check sits, and the reasoning that must ship beside it

The check needs the declaration (inside `task.moduleRecord`) **and** the label (`task.label`).
The placement is the planner's call — inside `guardModuleProvenance` after `accept()` succeeds,
or a third adapter composed between the two. **What is not the planner's call is that this
reasoning is written where the next reader meets it, in the code:**

Reading a declaration off a record that has not yet been verified is safe **only because this
phase refuses and never grants**. A forged declaration refuses its own forger; lying in it wins
nothing. **The moment grants exist that stops being true**, and a grant decision must never be
made at a point that reads an unverified record.

A plan file nobody opens is not where that belongs.

## 4. The audience question is settled — do not re-open it

Owner ruling 2026-09-17, recorded in the ROADMAP's Phase 46 block on 2026-09-23 in the
paragraph beginning *"Why this phase's refusal may be read in full"*. Short form: every field
this refusal reads is dispatcher-supplied, so the requestor may read the whole reason.
**Criterion 6 stands exactly as written**; narrowing it would cost diagnosis and buy no
security. The split by audience binds the phase where refusals begin consulting node-side
state, which is the next one.

Criterion 6 needs **no new plumbing**. `ExecutionOutcome` is `{ ok: false; reason: string }`
(`ports.ts:124-126`) and `submit.ts` merges those into `failures: { nodeId, reason }[]`
(`:1695`, `:1735`) on the job's own result — the same path `guardModuleProvenance` already
uses. The work is that the reason is **named and distinguishable** from a provenance refusal
and from a sovereignty refusal, not that a channel is built.

## 5. Two controls, and neither is optional

Criterion 3 — the same declaring module against a **public** shard runs — is the positive
control. Without it, criterion 2's refusal could be a broken fixture refusing everything, which
is the exact failure this repository met when a script that died at line 284 refused
everything including what it was supposed to refuse, and every refusal case stayed green for
twenty merges. Criterion 4 is the second control: a module declaring nothing is unaffected on
both labels.

## 6. The mutation ledger gains entries; none go stale

Measured: `packages/node/src/mutation-ledger.ts` names `protocol.ts` three times (`:743`,
`:2448`, `:3715`) and names `naming.ts`, `module-provenance.ts` and `sovereignty-guard.ts`
**zero** times. So nothing in the ledger goes stale from this phase.

`:3715` is the template for the codec plant and should be read before writing one — it plants a
spread-omitted optional field out of the encoder with `|| true`, is caught by the round-trip
spec, and records `EXIT=1`, the observed counts, and `cmp` exit 0.

**A ledger entry's `signature` is output that was observed, never predicted** (the file's own
rule). An entry may only be added after a real planted run produced that text.

## 7. What this phase does not touch

Nothing implements `fetch`. Nothing grants network access. No host import is added, no stub, and
nothing is handed to a guest — a task doing any of that is the wrong phase. **Who may sign a declaration,
and whether a signer can be trusted to declare honestly, is explicitly the next phase's
subject**; it is not half-built here.

## 8. One guard will fire on this phase's own prose, and it already has

`packages/node/src/vocabulary.node.test.ts` refuses five words anywhere in the tree — read the
file for the list — because each one reads as cryptocurrency to a reviewer who does not stop to
check the sense. **It fired on the first draft of this very file**, on a two-word phrase in §7
naming a thing handed to a guest, and it was right: a phase about network permissions is
exactly where a reviewer would read that word the wrong way.

Three things follow. It scans **plans, summaries and comments, not only source**, so a plan file
trips it as readily as a `.ts` file. Its allowlist is per-file with a stated reason, so widening
it is a decision somebody has to defend rather than a way around a red. And there is already a
correct word in use here — the repository's own type is `Delegation`
(`packages/core/src/capability.ts`), and *warrant*, *capability chain* and *grant* all read
correctly.

**Nothing evades it.** A zero-width character or a NUL spliced into a banned word is not a fix,
and the guard has cases for exactly that trick (*"would have caught the real thing: banned
words hidden behind a NUL"*).
