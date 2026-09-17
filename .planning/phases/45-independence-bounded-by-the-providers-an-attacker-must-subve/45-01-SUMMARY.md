---
phase: 45-independence-bounded-by-the-providers-an-attacker-must-subve
plan: 01
subsystem: core/quorum
tags: [VER-12, quorum, attestation, issuer-diversity, census]
requires:
  - "packages/core/src/enrollment.ts NodeCertificate.issuer (Phase 44, VER-11)"
  - "AttestationReceipt.issuers (Phase 44, VER-11)"
  - ".planning/OWNER-ACTIONS.md §3c — the owner ruling of 2026-09-16"
provides:
  - "AttestationStrength gains 'single-issuer', rank 2, with 'independent' moved to 3"
  - "QuorumRules.requireDistinctIssuers, default true"
  - "QuorumRefusal kind 'single-issuer-quorum', carrying the issuer"
  - "issuer-grouped round-robin composition, running unconditionally"
  - "classifyAttestation conjoining the operator and issuer dimensions"
  - "the live job path's explicit waiver of the refusal (never the preference)"
affects:
  - "packages/core/src/job/submit.test.ts — left red, handed to 45-02"
  - "packages/net/src/reduce-job.test.ts — left red, handed to 45-02"
  - "packages/node/src/quorum-agents.node.test.ts — left red, handed to 45-02"
  - "packages/node/src/result-signature.node.test.ts — left red, handed to 45-02"
tech-stack:
  added: []
  patterns:
    - "a rule expressed as construction rather than as a check bolted on after"
    - "a waiver that turns off a refusal while leaving the preference running"
key-files:
  modified:
    - packages/core/src/quorum.ts
    - packages/core/src/enrollment.ts
    - packages/core/src/job/submit.ts
    - packages/node/src/mutation-ledger.ts
    - packages/core/src/quorum.test.ts
decisions:
  - "The issuer refusal is sited AFTER the path check, so shared-relay-dependency keeps speaking for every set it already spoke for"
  - "The round-robin runs outside `if (requireDistinctIssuers)`, so a second provider needs no code change on the live path"
  - "M42's plant is sited on the `single-issuer` branch, not the `independent` conjunct, because the latter is inert on every one-issuer fixture that catches it"
  - "The issuer is read out of the member set with `join` rather than an indexed access with a `?? ''` fallback, so no empty issuer can reach a refusal that names the issuer"
metrics:
  tasks: 2
  commits: 2
  completed: 2026-09-16
---

# Phase 45 Plan 01: The Issuer Dimension Enters the Quorum Rule — Summary

`independent` stops meaning "two operator names" and starts meaning "two providers":
`AttestationStrength` gains `single-issuer` at rank 2, `composeQuorum` builds its member
set across issuers and refuses a single-issuer one by default, and the live job path
waives that **refusal** — never the **preference** — citing the owner's ruling of one
provider.

After this plan, **no result this fabric produces is labelled `independent`**. That is the
point, not a regression.

---

## What each criterion cost

| Criterion | Instrument | Result |
|---|---|---|
| `npx tsc --noEmit` | direct `EXIT=$?`, no pipe | **0**, four times across the plan |
| `npx vitest run --project node packages/core/src/quorum.test.ts` | direct `EXIT=$?` | **0** — 32 passed (was 24) |
| `npx vitest run --project browser packages/core/src/quorum.test.ts` | direct `EXIT=$?` | **0** — 3 files, 96 passed |
| `npx vitest run --project node packages/node/src/mutation-guard.node.test.ts` | direct `EXIT=$?` | **0** — 185 passed |

Host was quiet for every verification run (`load/core` 1.75–2.32 against a ceiling of 4.00,
8 cores). The two earliest runs of `mutation-guard` were taken on an oversubscribed host
(load/core 4.44–5.66) and were re-taken on a quiet one before anything was written down;
both failures they reported were deterministic string checks, which load cannot move.

**`tsc` was the weak instrument the plan said it would be.** With `AttestationStrength`
extended and both switches exhaustive, `tsc --noEmit` named **zero** sites — the two
switches in `quorum.ts` were edited in the same pass, and every other site that had to move
was behavioural. The 14 reds in `quorum.test.ts` and the 9 across four other specs were
found by running the suites, exactly as `45-CONTEXT.md` predicted.

---

## Plants: every one watched going red, restored, and verified with `cmp`

Four plants. Each was restored by the **surgical inverse of the plant's own edit** and
verified byte-identical against a snapshot taken immediately before planting —
`cmp` exit 0 in all four cases, and `git status --porcelain` clean for `quorum.ts`
afterwards. No `cp` of a whole file, no `git stash`, no `git checkout --`.

### Plant 1 — the false green this plan exists to prevent

Nested the round-robin inside the flag, which is the tidy-looking edit:

```
const members = requireDistinctIssuers
  ? spreadAcrossIssuers(distinct, rules.size)
  : [...distinct].sort(…).slice(0, rules.size)
```

**Observed, verbatim:**

```
× composes THE SAME spread across issuers when the refusal is waived — the live path
AssertionError: expected [ 'a1', 'a2' ] to deeply equal [ 'a1', 'b9' ]
Tests  1 failed | 31 passed (32)
```

**One case out of thirty-two.** That is the measurement the plan's warning predicted and
the reason the case exists: `tsc` stayed clean, criterion 1's waived half stayed green
(its pool is one-issuer, so the round-robin degenerates to one group and proves nothing),
the two-issuer default case stayed green (it does not waive), and the ROADMAP sentence
*"the day a second provider runs, `independent` becomes reachable with no code change"*
would have become silently false on the only path that runs.

### Plant 2 — softening the default while one provider runs

`rules.requireDistinctIssuers ?? true` → `?? false`, which is the softening
`45-CONTEXT.md` §0 forbids by name.

```
× refuses a one-issuer quorum under the default rule, and composes it when waived
AssertionError: expected true to be false // Object.is equality
Tests  1 failed | 31 passed (32)
```

### Plant 3 — the `size: 1` decision

`members.length >= 2` → `>= 1`.

```
× composes a quorum whose strength its own members support, not a constant
× does not refuse a one-member quorum on an issuer ground
AssertionError: expected false to be true // Object.is equality
Tests  2 failed | 30 passed (32)
```

The second of those is the case written for the decision; the first is a pre-existing case
that turns out to read it too, which is the stronger evidence.

### Plant 4 — M42 as re-sited, to prove it is not a blind instrument

`if (operators.size >= 2) return 'single-issuer'` → `>= 1`.

```
× classifies the three strengths from the certificates, not from a caller’s say-so
× builds a receipt carrying the label everywhere a result surfaces
× classifies all four strengths off one expression, operators and issuers together
× reads one user key enrolled with two providers as owner-domain, not independent
AssertionError: expected 'single-issuer' to be 'owner-domain' // Object.is equality
Tests  4 failed | 28 passed (32)
```

`expected 'single-issuer' to be 'owner-domain'` is exactly the label movement the entry's
`why` now predicts. **Not a green plant.** The counterfactual — siting it on the
`independent` conjunct instead — is argued in the entry and is **not measured here**,
because M42's `caughtBy` is `quorum-agents.node.test.ts`, which this plan deliberately
leaves red for unrelated reasons; a reading taken there now would be confounded. Plan
45-04 plants M42 for real against a green tree and records what it actually sees.

**No green plant was found.**

---

## The census of `quorum.test.ts` — 14 cases, one finding each

Baseline after Task 1, measured: `14 failed | 10 passed (24)`, exit 1 —
3 × `expected 'single-issuer' to be 'independent'` and 11 × `expected false to be true`.

Every existing case built its pool from `cert()`, whose issuer defaults to `'provider'`,
so every one of them composed from a single issuer. Repaired by intent, three ways.

### Repair A — waived, because the case's subject is a different rule (9 cases)

These are given `requireDistinctIssuers: false` and **deliberately not** a second issuer: a
second issuer changes which members the round-robin selects, which would silently move the
very ordering they assert.

| Case | What it was relying on | Was it true? |
|---|---|---|
| `does not disqualify relay-discovered peers from the slots of a quorum` | that a three-relay, three-operator pool composes | Yes, of the discovery graph — which is its subject. The issuer refusal was answering for it and hiding the path reading |
| `applies the same rule to seed nodes — no exemption for servers` | that two discovery graphs can be compared arm-to-arm | Yes; a second provider in either arm would make the pair differ in two things at once |
| `can be waived deliberately for a single-relay fixture` | that waiving `requireIndependentPaths` is observable | **Only half true after Task 1.** Without the second waiver the composition is still refused — by the *issuer* rule — so the case would have gone on reading `ok === false` while reading nothing about `requireIndependentPaths` at all. The guarded arm needs no waiver: rule 2 is asked first and still speaks |
| `composes a quorum no member of which can be dialled cold` | see Repair C — this one moved both ways | — |
| `prefers the fewest discovery dependencies when filling the slots` | that `['z9','n1']` is a dependency-count ordering | Yes, and it is the within-*group* comparator. A second issuer would split `z9` and `n1` into different round-robin groups and move the answer for a reason unrelated to dependency counts |
| `does not refuse seeds that merely advertise through one relay` | the `seed` reading of `sharedRelay` | Yes. The issuer refusal would have answered for the whole block at once, leaving it green while reading nothing about seeds |
| `lets one seed break a shared dependency among relay-discovered peers` | same | Yes |
| `refuses when the seed that broke the dependency IS the relay the others name` | that the **control** arm composes, so the refusal below can only have come from the `peerIdOf` mapping | Yes, and this is the case where the waiver is load-bearing: under the default rule the control arm would refuse for an unrelated reason and the pair would stop being a comparison |
| `does not refuse a member merely for being some peer’s relay when another survives it` | the boundary of rule 2's second arm | Yes |

### Repair B — a second authority, because the case's subject is that independent parties agreed (4 cases)

| Case | What it was relying on | Was it true? |
|---|---|---|
| `composes from distinct operators, one node each` | that two operator names make a result `'independent'` | **True of the operator dimension and silent about the provider one** — which is what this phase ends. The issuer is put on `n3` and not `n2`: `n2` is shadowed by `n1` in the one-per-operator map and never reaches the member set, so an issuer there would have left the members single-issuer and the case red |
| `classifies the three strengths from the certificates, not from a caller’s say-so` | same | Same. Its intent is that genuinely independent replicas agreed, so it gets two authorities; the one-issuer reading of the same shape is now asserted in the VER-12 block |
| `composes a quorum whose strength its own members support, not a constant` (M38's signature) | that a real cross-operator quorum reads `'independent'` | Yes given two parties. All three candidates are members at `size: 3` whatever the grouping, so only the label's input moved, not the selection. **M38's plant still reddens** — its `alone` arm (size 1) is untouched |
| `builds a receipt carrying the label everywhere a result surfaces` | two receipts differing only in strength | Yes; the stronger one now has to be a fixture the stronger label is true of |

### Repair C — the expectation moves, because that is what a one-provider fabric is (2 cases)

| Case | What it was relying on | Was it true? |
|---|---|---|
| `composes a quorum no member of which can be dialled cold` | that three distinct operators make a result independent | **No, after 2026-09-16.** Three tabs, three operators, one certificate provider — one party vouched for all three. Moved to `'single-issuer'`, and also waived, because its `nodeKey` ordering must not move |
| `names the providers that vouched for the members, which is one on this fabric` | see below — the sharpest entry in the file | — |

#### The sharpest census entry, written out because it is an inversion rather than a move

`names the providers that vouched for the members, which is one on this fabric` carried:

```ts
// The strength is UNCHANGED across the pair, which is what makes this field worth
// carrying rather than inferring: the two sets are indistinguishable by strength and
// differ in exactly the dimension Phase 45 will act on.
expect(twoProviders.strength).toBe(oneProvider.strength)
```

That sentence was the honest description of Phase 44, where the issuer dimension was
**visible and inert**. It is false now. The assertion is **inverted**, not extended:
`oneProvider.strength` is `'single-issuer'`, `twoProviders.strength` is `'independent'`,
both written as literals, and the pair is additionally compared by `attestationRank` so
neither side is recomputed from the thing under test. The comment recording what it used
to say is kept in the file.

### The re-anchoring, which was a false green one edit away

`describes each distinctly, so a reader cannot conflate them` reached into its array by
**position** — the third slot — rather than by strength. Inserting `'single-issuer'`
between `'owner-domain'` and `'independent'` moves the single-issuer sentence into that
slot, and by the specified wording it also contains `separate operators`. The assertion
would have **stayed green while testing a different strength**, leaving `'independent'`
with no content assertion at all in the phase that is about it. Every assertion is now
keyed on its own literal; the array survives only for the four-distinct-sentences check.

---

## The new cases

In a `describe` naming VER-12: criterion 1 with both halves in one case (the refusal names
`sole-provider` as a literal on both sides, and the waived half composes at `size: 3` and
reads `'single-issuer'`); the refusal precedence in two arms (`insufficient-operators` for
a one-operator pool, `shared-relay-dependency` for a one-relay one — both of which are also
single-issuer pools the new rule would happily have answered for); the `size: 1` decision,
with a note that its candidate must be a **seed** or rule 2 answers first; criterion 2
across all four labels from one expression; one user key under two providers reading
`'owner-domain'`; round-robin as construction, asserting `['a1','b9']` where the old
`slice` would have returned `['a1','a2']`; the live path's two-issuer waived composition;
and `'independent'` reachable under **default** rules.

The rank case keeps its two original assertions and adds both new inequalities rather than
one — a rank above `'independent'` would still satisfy one half, and one below
`'owner-domain'` would still satisfy the other.

---

## What is knowingly left red, measured rather than promised

Handover to plan 45-02. Every reading below was taken on a quiet host with `EXIT=$?` read
on the line immediately after the command.

| Spec | Lane | Exit | Reading |
|---|---|---|---|
| `packages/core/src/job/submit.test.ts` | node | **1** | `5 failed \| 100 passed (105)` |
| `packages/net/src/reduce-job.test.ts` | node | **1** | `1 failed \| 19 passed (20)` |
| `packages/node/src/quorum-agents.node.test.ts` | node | **1** | 2 failed (in a 6-test run shared with the next row) |
| `packages/node/src/result-signature.node.test.ts` | node | **1** | 1 failed (same run) |
| `packages/node/src/demo-fabric.e2e.test.ts` | e2e | **0** | **18 passed — GREEN. See below** |

**Observed failure text, verbatim:**

- `submit.test.ts` — `expected { strength: 'single-issuer', …(6) } to match object { strength: 'independent' }` (×2), plus one each of the `…(1)`, `…(2)` and `Object (strength, replicas)` shapes. Failing cases: *reads independent when two verified replicas answer under different operators*; *builds the receipt from the replicas that agreed, never from the nodes that were placed*; *reports the job at its weakest shard, not its strongest and not its first*; *composes across two operators on independent paths, and the shard is not degraded*; *degrades when every member depends on one relay, and names the relay*.
- `reduce-job.test.ts` — `expected [ 'owner-attested', …(2) ] to deeply equal [ 'owner-attested', …(2) ]`, in *reads owner-attested at one producer, owner-domain within one operator, independent across two*.
- `quorum-agents.node.test.ts` and `result-signature.node.test.ts` — `expected 'single-issuer' to be 'independent'` ×3, in *composes across two distinct operators that share no relay, and labels it independent*; *refuses for the shared relay and not for the operators, degrades under the default dial, and names the relay in the composer's words*; *carries a real attestation from every replica, verifiable against the provider key alone*.

### Plan-vs-tree discrepancy 1 — `demo-fabric.e2e.test.ts` is green, and was never going to be red

The plan's verification section names it among the five specs left red. **Measured: exit 0,
18/18 passed, 18.18 s on a quiet host.** Reading the file explains it: its `'independent'`
occurrences are a **hand-built attestation object passed into the formatter**
(`demo-fabric.e2e.test.ts:242-256`), with a hand-written description string that is
deliberately *not* `describeAttestation('independent')` — the case exists to prove F7 renders
`description` verbatim rather than composing a sentence. Nothing in it composes a quorum or
calls `classifyAttestation`, so the rule cannot reach it. Four specs move in 45-02, not five.

### Plan-vs-tree discrepancy 2 — the `not.toContain` count

Task 1's action says *"five surfaces assert `not.toContain(describeAttestation('independent'))`"*.
Measured across `packages/`: **one** site, `bench-attestation.node.test.ts:544`, inside a
loop over the three strengths and over three rungs. The wording constraint it imposes is
unchanged and holds — `describeAttestation('single-issuer').includes(describeAttestation('independent'))`
is `false`, probed directly — but the count in the plan is wrong against the tree.

### Deviation — one acceptance grep needed a comment reworded, not an assertion changed

Task 2's criterion `grep -c "descriptions\[" packages/core/src/quorum.test.ts` is 0 read 1
after the rewrite: the single remaining occurrence was **inside the comment recording the
retracted reading**, not in any assertion. The comment was rephrased to name the position
without the bracket literal, so the criterion now holds as written and the record is fully
intact. No assertion was weakened; none was ever keyed on an index after the rewrite.

---

## The mutation ledger

`mutation-guard.node.test.ts` named exactly two entries and they were repaired, no others:

```
M41: packages/core/src/quorum.ts no longer contains its find text …
     Was: "  const members = ordered.slice(0, rules.size)"
M42: packages/core/src/quorum.ts no longer contains its find text …
     Was: "  if (operators.size >= 2) return 'independent'"
```

- **M41 re-sited** onto `const members = spreadAcrossIssuers(distinct, rules.size)` — the
  point where the member set is **complete**, because the predicate it reinstates reads
  `members`. Sited on a declaration still being filled, the same plant would refuse every
  composition, which is an over-broad new rule rather than a re-site of the retracted one.
- **M42 re-sited** onto `if (operators.size >= 2) return 'single-issuer'`, and the choice of
  branch is the whole of the entry. The obvious new home — relaxing the operator conjunct of
  `operators.size >= 2 && issuers.size >= 2` — is **inert** on every fixture that catches
  M42, because those fixtures carry one issuer, `issuers.size >= 2` is false, and control
  falls straight through. That is the Phase 44 shape that stayed green and was reported as a
  blind instrument. Plant 4 above confirms the chosen branch moves the label.
- **Every `signature` left untouched**, with a comment on both entries saying so. M42's was
  observed against the pre-Phase-45 expression and the label it now produces has moved — but
  the cheap layer checks a `rendered-at-runtime` signature against nothing, so guessing a new
  string would put an **unobserved** sentence in the ledger, which is worse than a stale
  observed one. 45-04 plants it and records what it sees.

Each repaired `find` was counted with `grep -cF` before the guard was run: both exactly 1.

---

## Success criteria

- [x] ROADMAP criterion 1 — a case refuses under the default rule and composes when waived
- [x] ROADMAP criterion 2 — `'single-issuer'` for many operators and one issuer,
      `'independent'` only when both dimensions exceed one, with the one-key/two-provider
      arm asserting the conjunction really is one
- [x] ROADMAP criterion 3, **ordering half only** — `attestationRank` orders the four across
      the insertion. Its guard half is plan 45-03's
- [x] The live path's waiver is wired and **its construction is proved** — plant 1 reddened
      exactly the two-issuer waived case and nothing else
- [ ] **The end-to-end reading is NOT met and is not claimed.** No verify command in this
      plan exercises `submitJob`; `submit.test.ts` is left red for 45-02. *Carried forward
      to 45-02.* (For the record and as a by-product of the handover measurement: every
      `submit.test.ts` failure reads `expected 'single-issuer' to be 'independent'` and none
      reads a refusal or a degraded shard, which is consistent with the waiver holding — but
      that is an observation from a red spec, not a criterion met. `CLAUDE.md`: unmeasured is
      not met.)
- [x] `tsc` clean; `mutation-guard.node.test.ts` green

## Commits

| Commit | Task |
|---|---|
| `cd52b0e` | `feat(45-01)` — the issuer dimension enters the quorum rule at full strength |
| `363956e` | `test(45-01)` — the cases carrying criteria 1 and 2, and the census |

Both committed with explicit paths and `git show --stat` read afterwards: 4 files and 1 file
respectively, all this plan's own. The untracked `.gitkeep` in the phase directory was left
alone — not this plan's.

`.planning/STATE.md` and `.planning/ROADMAP.md` were **not** modified.

## Self-Check: PASSED

All five modified source files and this SUMMARY are on disk; both commit hashes resolve in
`git log`. `.planning/STATE.md` and `.planning/ROADMAP.md` are unmodified by this plan — their
most recent touching commits are `fd3fbce` and `4ff8a36`, both predating it.
