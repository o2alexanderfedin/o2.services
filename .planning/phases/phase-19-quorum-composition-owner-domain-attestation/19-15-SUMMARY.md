---
phase: phase-19-quorum-composition-owner-domain-attestation
plan: 15
subsystem: node-factories, browser-factory, result-attestation
tags: [VER-08, VER-09, VER-10, signing, wiring, cross-process]
requires:
  - "packages/core/src/executor/attesting-executor.ts (19-13)"
  - "packages/core/src/result-attestation.ts (19-13)"
  - "packages/core/src/job/verify.ts — AgreeingReplica (19-14)"
  - "packages/net/src/agent.ts — the attest hook (19-16)"
  - "packages/core/src/job/submit.ts — receiptFor (19-06)"
provides:
  - "both production factories sign exec results and combines from one identity"
  - "a textual composition guard for leg 3, over the same two files leg 1 is held to"
  - "a cross-process measurement of what a stranger can learn from a signed result"
  - "the first non-absent receipt this fabric has ever produced"
affects:
  - "19-10 (CLI receipt) and 19-11 (demo UI receipt) can now read a real strength"
  - "19-12 (mutation ledger) — four find/replace pairs recorded below"
tech-stack:
  added: []
  patterns:
    - "the signing identity is resolved once, on one line, and reaches both verbs"
    - "unconditional composition with a named literal, never a null-branch"
key-files:
  created:
    - packages/node/src/result-signature.node.test.ts
  modified:
    - packages/node/src/fabric-node.ts
    - packages/browser/src/browser-node.ts
    - packages/node/src/trust-anchors.node.test.ts
    - packages/node/src/serve-agent-hooks.node.test.ts
    - packages/node/src/requirements-ledger.node.test.ts
    - packages/core/src/executor/attesting-executor.ts
    - .planning/REQUIREMENTS.md
    - vitest.config.ts
decisions:
  - "outermost: the wrapper signs the outcome that leaves the node, so nothing composed later can alter a signed answer"
  - "unconditional: a node with no certificate composes the same wrapper and writes the named absence"
  - "node.executor stays the GovernedExecutor on both tiers, so an in-process dispatch is unsigned — stated at both lines"
  - "the sentinel count in serve-agent-hooks does NOT burn to 0; it moved, and 1 is now permanent"
  - "vitest.config.ts re-measured in full rather than blended across two runs"
metrics:
  duration: ~2h25m
  completed: 2026-08-03
---

# Phase 19 Plan 15: Wired — both factories sign, and a stranger can check it Summary

The fabric signs its results. Both production factories compose `attestResults` outermost
from an identity resolved once and handed to `serveAgent`'s signing hook on the same line;
the textual guard that proves leg 1 composed now proves leg 3 composed; and a result
produced in one `bin/agent.ts` process verifies in another against nothing but the
provider's public key, with an uncertified signer refused by name.

## Why this ran first, and it was deliberate

The orchestrator resequenced wave 5 before dispatching this plan, and the reason belongs in
the phase's history rather than in a dispatch message.

`attestResults` was composed **nowhere** in production — `fabric-node.ts:1608` named it in a
comment and that was the whole of it. `receiptFor` (`packages/core/src/job/submit.ts:506`)
treats `'signed-by-nobody'` as unaccounted, and one unaccounted replica collapses the whole
receipt to `holds-no-verified-attestation`. **So every receipt in the fabric was a named
absence**, truthfully and uselessly.

Plans 19-08 and 19-10 both assert on receipt *strength* — `independent`, `owner-domain`,
`owner-attested`. Neither could reach those labels until this plan composed the signer.
Grouping all three into one wave was a planning defect; they now run after this. Nothing ran
concurrently with this plan.

The inversion is measured, not argued:
`result-signature.node.test.ts` reads `strength: 'independent'`, `replicas: 2`, operators
`['a-ops','b-ops']` off `ShardResult.attestation` on the production submit path.

## What was built

### Task 1 — both factories sign, and the guard says so textually

**Commits:** `dcac25c` (RED), `2e1d506` (GREEN)

Both factories now resolve one value:

```ts
const attestor: ResultAttestor =
  certificate === null ? 'signs-nothing' : { nodeSeed: identity.seed, certificate }
```

and compose the wrapper outermost, outside `GovernedExecutor`:

```ts
const signing = attestResults(executor, attestor)
```

`signing` fills `serveAgent`'s `executor`, and `attestor` fills its signing hook. One
identity, one line, both verbs — which is why this was one plan and not two.

`trust-anchors.node.test.ts` gained `SIGNING_CONSTRUCTION_SITES` beside
`GUARDED_CONSTRUCTION_SITES`: the same two files, the same comment-stripped source, plus a
`stripComments` pair proving a comment cannot satisfy it.

### Task 2 — a stranger with the provider's public key, and nothing else

**Commit:** `b70be3d`

`packages/node/src/result-signature.node.test.ts` — one spawned provider, two spawned
`bin/agent.ts` agents enrolled under it with distinct operator ids, one in-process
submitter. **The provider is stopped and waited for before anything is verified**, so
"offline, with no live call" is falsified rather than argued —
`certificate-verification.node.test.ts`'s technique applied one leg over.

Seven readings, each a precondition for the next: no replica reports the sentinel; every
attestation verifies against the provider's published key alone; the certificate's
`nodeKey` **derives** the peer id that answered; the receipt reads `independent`; a signer
no trusted provider certified is refused `untrusted-issuer` and **not** the signature kind;
a statement stands for its own work and for nothing else; and a combine dispatched to the
same agent carries a real attestation under the same node key.

Plus a cheap in-process case: a node nobody enrolled runs, answers, and states what it
signs, and a reader is told `not-attested` rather than a bare `false`.

Fixture seeds taken: **63** (publisher), **64** (stranger provider), **65** (stranger node),
`0xf1`/`0xf2` (user keys) — checked against the repository's whole seed census first.

## The proofs, and the two that could not fail

### Plants that reddened, with find/replace pairs for Plan 19-12

| # | file | find | replace | observed |
|---|------|------|---------|----------|
| P1 | `packages/node/src/fabric-node.ts` | `const signing = attestResults(executor, attestor)` | `const signing = executor` | `trust-anchors.node.test.ts` RED on **fabric-node.ts alone**, browser entry stays green: `AssertionError: expected ' \n\nimport { noise } from '@chainsa…' to contain 'attestResults('` |
| P2 | `packages/node/src/fabric-node.ts` | `const signing = executor` | `// composed with attestResults(executor, attestor) — see the block above` + `const signing = executor` | still RED, **with the raw text present** (`grep -c 'attestResults(' → 1`). `stripped`'s whole purpose, shown working |
| P3 | `packages/core/src/executor/attesting-executor.ts` | the `attestation: signResult(attestor, {…})` return object | `attestation: 'signed-by-nobody'` | `result-signature.node.test.ts:449` RED — the "every entry carries a real attestation" assertion |
| P4 | `packages/node/src/fabric-node.ts` | `attest: attestor,` | `attest: 'signs-nothing',` | `result-signature.node.test.ts:**545**` RED — the combine assertion, **while every exec reading stayed green**. A reader checking only the exec leg sees nothing wrong. This is the plant that justifies one plan rather than two |

Every plant was restored by `cp` + `cmp` (exit 0 each time) and never by `git checkout --`.
`git diff HEAD --stat` was empty after each restore.

### The check that could not fail — run, and it passed

**The plan required this and it was done.** The trust input was reseeded from the
**submitter's own discovery state** — `found.nodes[0].certificate.issuer` — instead of from
the provider process's published key, and **the whole file passed, all seven readings
including the exclusion arm**. It proves nothing about a stranger, because the value came
from the submitter; it happens to equal the right key, which is exactly what makes the
substitution invisible. This is Phase 18's finding in miniature and the only defence is to
have run it and noticed.

A sharper variant was also run: pinning **per attestation** from `attestation.certificate.issuer`.
That one the file *does* catch — the exclusion arm goes RED (`expected true to be false`),
because the stranger's self-issued certificate then verifies. So the file is insensitive to
the first substitution and sensitive to the second, and the header says which input it takes
and why.

### A proof the plan called for that is NOT available, and the honest reading

The plan asked for the issuer/signature arm to be reddened "by checking the result signature
first and returning early". **It was planted and it did not redden.** `checkAttested` was
reordered so the signature is checked before the certificate; `result-signature.node.test.ts`
passed unchanged, 2 tests, exit 0.

That is 19-13's own recorded finding reproduced: *the order is visible only in the case where
questions 2 and 3 both fail.* This arm's stranger signs correctly with a key its own
certificate names, so its signature is good and a signature-first verifier falls through to
report `untrusted-certificate` anyway.

**The property is guarded, one level down.** Under the same plant,
`packages/core/src/result-attestation.test.ts` goes RED on *"says it does not trust the
issuer before it says the peer forged anything"*. So this file measures the reading an
operator acts on — issuer-kind and not signature-kind, on a good signature — and the unit
spec owns the order. Neither is asked to carry the other, and this file does not claim to.

### The correspondence arm's weaker sibling, for the record

Asserting only that *some* attestation verifies would be satisfied by two forwarded copies of
one node's work, which is exactly the replica inflation the check exists to stop. The file
therefore derives the peer id from the certificate (`peerIdForNodeKey(certificate.nodeKey)`)
and compares it to the node that answered, and separately asserts the two answering node ids
are distinct and are A's and B's.

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 2 — missing correctness] Three comments had become false predictions**
- **Found during:** Task 1
- **Issue:** `serve-agent-hooks.node.test.ts` stated in two places that this plan takes the
  sentinel count to 0. It does not. `attesting-executor.ts`'s docblock opened *"Nothing in
  this repository composes this wrapper yet"* and said outright that reading it after 19-15
  landed would mean a defect.
- **Fix:** The sentinel **moved** rather than vanishing — from the hook argument to the
  resolved identity, where the `certificate === null` arm still names it exactly once. So 1
  is now the *permanent* correct value and both rows say why: a 0 would mean a factory that
  branched around the absence instead of naming it. `attesting-executor.ts` now records
  where it is composed and what checks it.
- **Files:** `packages/node/src/serve-agent-hooks.node.test.ts`,
  `packages/core/src/executor/attesting-executor.ts`
- **Commit:** `2e1d506`

**2. [Rule 3 — blocking] The requirements ledger refused the commit, correctly**
- **Found during:** Task 1, at the pre-commit hook
- **Issue:** Four rows — VER-08, VER-09, VER-10, AUTH-05 — claimed *"`attestResults` has no
  production caller"*. It now has two, and `requirements-ledger.node.test.ts` said so by
  name. This is the guard working as designed.
- **Fix:** All four rows corrected. VER-09 and VER-10 keep a **checkable** claim through
  `describeAttestation`, which renders the three labels for a human and is genuinely called
  by nothing — measured, not assumed. VER-08 and AUTH-05 lost their only checkable claim *by
  being satisfied*, leaving argument-value claims the guard cannot read, so both were added
  to `WITHOUT_A_CHECKABLE_CLAIM` with the reason recorded in its docblock. **A row losing its
  claim by being satisfied must be pinned in the same commit or the file reports it unread**
  — which is the correct behaviour, and is now written down.
- **Files:** `.planning/REQUIREMENTS.md`, `packages/node/src/requirements-ledger.node.test.ts`
- **Commit:** `2e1d506`

**3. [Rule 3 — blocking] `vitest.config.ts` had to be re-measured in full**
- **Found during:** Task 2
- **Issue:** The node project already held **132** files against a recorded **127** — drift
  of exactly 5, sitting on `slow-specs.node.test.ts`'s tolerance. Adding one file took it to
  6 and the guard refused the commit. `result-signature.node.test.ts` also measured **6066
  ms**, above `SLOW_CUTOFF_MS`, so it had to be listed regardless.
- **Why the whole table and not one entry:** `MEASURED_NODE_SPANS`'s own docblock forbids the
  cheap fix — *"pinning entries at their old values would make this table a blend of two
  runs, and its whole worth is that it is one run somebody can reproduce."* Raising the
  tolerance was the other option and is weakening a guard to avoid work.
- **Fix:** Full re-measurement, 2026-08-03: 133 files / 1883 tests, sum-of-spans 689.4 s,
  wall clock 306.8 s, 36 files at or above the cut. `test:unit` observed **directly** at 97
  files / 1515 tests / 9.97 s on a **green** run.
- **The honest caveat, recorded at the field:** this run was taken on a **contended** host
  (load 8.98 → 11.28) and replaced a **quiet** one — the reverse of the last two
  replacements. `loadPeak` is set to the highest figure actually sampled (11.28) and the
  docblock says plainly that it is *not* a peak: no mid-run 1-minute sample was taken, and
  the 5-minute average read 16.13 at the end, so the true peak was higher and is
  **unmeasured**. Re-measuring on a quiet host is worth doing and the docblock is the
  instruction.
- **Files:** `vitest.config.ts`
- **Commit:** `b70be3d`

**4. [Rule 1 — stale reference] The plan's own out-of-scope cross-reference**
- **Issue:** *"Plan 19-06, wave 3 alongside this one"*. 19-06 is wave 4 and already merged.
- **Fix:** Corrected in `19-15-PLAN.md`, with the dependency direction it states preserved
  (19-06 works from unit-level signed outcomes and does not need this composition) and a
  note not to infer an ordering from the corrected sentence either.

### Deliberate departures from the plan's letter

**`node.executor` stays the `GovernedExecutor` on both tiers.** The plan says the wrapper is
composed outermost, and it is — `signing` is the outermost layer of the executor stack and is
what `serveAgent` serves from. It is **not** what either node class holds, because
`BrowserNode.executor` must stay exactly a `GovernedExecutor` for BROW-04's
`.executed`/`.dutyCycle` surface. That constraint is recorded twice — `browser-node.ts:525-528`
and `packages/net/src/counting-executor.ts:48` — and `packages/browser/demo/main.ts:354-355`
reads both properties off it.

**The consequence, stated at both composition sites and here:** a caller reaching
`node.executor` in-process gets the **unsigned** outcome. That is the truthful reading —
nothing left the node, and a node's signed statement to itself establishes nothing it did not
already hold — but it has one visible effect worth flagging for **Plan 19-11**: the demo's
`includeSelf` self-dispatch (`demo/main.ts:436`, `:677`) puts `node.executor` into the job, so
a tab's own replica will report the sentinel and its shard's receipt will read the named
absence. If 19-11 wants a self-included job to show a strength, that is a decision about
`BrowserNode`'s surface, not a wiring omission here.

**The three load-bearing orderings were not disturbed**, as instructed: provenance innermost
against `compute`, sovereignty outside provenance, the counter inside the governor. The new
layer never required moving one. `signed-artifact.node.test.ts`, `sovereignty-placement.node.test.ts`,
`admission.node.test.ts`, `execution-deadline.node.test.ts`, `duty-cycle.node.test.ts` and
`fabric-node.node.test.ts` all pass unedited.

**No spec's frame-size or timing assertion moved.** Every `exec` reply now grows by one
certificate — 612 DAG-CBOR bytes, the figure 19-13 measured — and nothing in either project
noticed.

## The known flake, observed and not chased

`packages/node/src/reservation-exhaustion.node.test.ts` (defect #33, ~20 % on a byte-identical
tree) **did not fire** in either full node run taken for this plan — it passed in the
`--reporter=json` measurement run and again in the final verification run. Nothing was
adjusted, no timeout raised, no load gate added. There is no stderr text for agent `b` to
report, because the armed instrument never printed.

## Verification

| command | result |
|---|---|
| `npx tsc --noEmit` | **exit 0** |
| `npx vitest run --project node` | **exit 0** — 133 files, 1881 passed, 2 skipped, 253.5 s |
| `npx vitest run --project browser` | **exit 0** — 240 files, 3756 passed, 46.9 s |
| `npm run test:unit` | **exit 0** — 97 files, 1514 passed, 1 skipped, 9.97 s |

Every exit code was read directly with `EXIT=$?` on the line after the command, never through
a pipe, and appended into each log.

## What this does not establish

- **A signature is not correctness.** It says a certified node computed this output and
  nothing about whether the output is right. `executeVerified`'s N-version comparison remains
  the only thing that says an answer is right, and both compositions say so at the line
  because the proposal to reduce redundancy will arrive.
- **The browser tier's composition is source-level here.** The textual guard says the call
  site is present; no e2e spec drives a signed result out of a live tab. That is the same
  standing limit leg 1 has on that tier and the same one `two-tabs.e2e.test.ts` closes for it.
- **The receipt is not displayed anywhere.** `describeAttestation` still has no production
  caller — 19-10 (CLI) and 19-11 (demo UI) own that, and the ledger rows now say so as a
  call-site fact rather than as a plan reference.
- **Requirements VER-08/09/10 were deliberately NOT ticked.** The signing half is closed and
  the rows say so with the date; the display half is open for VER-09 and VER-10 and the
  sovereign multi-node redundancy clause is open for VER-08. Ticking them would put a false
  checkbox in a ledger this repository guards, and *unmeasured is not met* applies to a
  checkbox as much as to a mechanism.

## Self-Check: PASSED

- `packages/node/src/result-signature.node.test.ts` — FOUND
- `dcac25c`, `2e1d506`, `b70be3d` — FOUND in `git log`
- working tree clean after every plant restore (`git diff HEAD --stat` empty)
