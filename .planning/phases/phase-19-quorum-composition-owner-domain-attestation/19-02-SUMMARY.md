---
phase: phase-19-quorum-composition-owner-domain-attestation
plan: 02
subsystem: verification
tags: [quorum, attestation, discovery, eclipse-resistance, certificates]

requires:
  - phase: phase-17-node-identity-enrollment/17-01
    provides: "`NodeCertificate.discoverability`, the `seed` / `via-relay` union this rule reads"
  - phase: phase-6
    provides: "`composeQuorum`, `sharedRelay`, `classifyAttestation` — the first two implemented, the third never called from the composer"
provides:
  - "VER-03 has an implementation for the first time: `composeQuorum` refuses a candidate set with no member reachable without a relay, by the new refusal kind `no-direct-discovery-path`"
  - "The anchor is chosen out of the pool before the remaining slots are filled, so a seed that sorts last by dependency count is still a member"
  - "`composeQuorum`'s ok arm reports `classifyAttestation(members)` instead of the literal `'independent'` it has returned since Phase 6"
  - "The measured fact that rule 3 implies rule 2 over any chosen member set, which is why rule 2 moved onto the candidate pool"
affects:
  - phase-19-quorum-composition-owner-domain-attestation/19-06
  - phase-19-quorum-composition-owner-domain-attestation/19-08
  - phase-19-quorum-composition-owner-domain-attestation/19-12

tech-stack:
  added: []
  patterns:
    - "A constraint is chosen out of the pool, not checked against a selection a preference already made — the same move the per-operator map makes for anti-affinity"
    - "A refusal is named for what the candidate set lacked, never for the kind of node that was absent, or the node tier reappears as an error string"
    - "When a new rule subsumes an older one, the older check moves to where it can still fire rather than being left as dead code or deleted"

key-files:
  created: []
  modified:
    - packages/core/src/quorum.ts
    - packages/core/src/quorum.test.ts

key-decisions:
  - "The refusal kind is `no-direct-discovery-path`, carrying `relayDependent: number`. It names a missing discovery *path*; a name like `no-backbone-node` would be the node tier the cardinal rule forbids, restated as an error string."
  - "Rule 2's `sharedRelay` check moved from the chosen members onto the candidate pool, and now runs BEFORE rule 3. Rule 3 admits only member sets containing a seed and `sharedRelay` answers null the moment it sees one, so left where it was the check could never fire again."
  - "`requireIndependentPaths: false` no longer lets a single-relay fixture compose. The flag waives rule 2 only; what it now decides is which of the two refusals speaks."
  - "No helper was exported for the anchor rule. It is one expression inline (`discoverability === 'seed'`), and a new exported symbol with no caller is the condition this milestone exists to remove."
  - "REQUIREMENTS.md was not touched. VER-03's and VER-04's checkable claim — `composeQuorum has no caller outside its own spec` — is still true, and 19-12 owns the verdicts."

patterns-established:
  - "A rule that makes an older rule unreachable is reported as a subsumption with its direction measured, not resolved by quietly deleting whichever test goes red"

requirements-completed: []

duration: not recorded — see Host conditions
completed: 2026-08-03
---

# Phase 19 Plan 02: The anchor VER-03 never had — Summary

**`composeQuorum` now requires a member a newcomer can dial cold, chooses it out of the
candidate pool before the remaining slots are filled, and reports the strength
`classifyAttestation` computes from its members rather than the literal `'independent'` it
has declared on every ok arm since Phase 6.**

## Host conditions — read before believing any number here

**Load average was 42.69 / 48.44 / 67.62 on 8 cores** at the start of this plan (`uptime`,
23:45), falling from a foreign C++ build's peak; 45.93 / 36.90 / 40.45 at the end. Per the
execution instruction:

- **No duration is recorded and no timeout was added or tuned.** The plan asks for none, and
  the frontmatter's `duration` field is answered with this paragraph. Wall clocks the runner
  printed (1.15 s – 4.82 s) are readings of the contention, not of the tree, and are quoted
  nowhere below as measurements.
- Only the two files the plan names were run, always `--project node`. The full suite was
  never run; `npm run test:node` was never run. `quorum.test.ts` also matches the `browser`
  project's include, and the browser project — three engines under Playwright — was
  deliberately not run.
- **No test failed in a way that looked like a timeout or a flake.** Nothing here is reported
  as unresolved under load. Every failure below was planted on purpose and then removed.
- `tsc --noEmit` is deterministic and is the load-bearing green reading of this plan.

## The shared working tree

Another agent was active in this checkout throughout: `packages/core/src/index.ts` modified
and `packages/core/src/result-attestation.ts` / `.test.ts` untracked, none of them mine and
none of them touched. **Every path was staged explicitly; `git add -A` was never used, `git
checkout --` was never used, `git clean` was never run, and no branch was switched.** Both
commits below contain exactly the one file each names.

## Commits

| Commit | Task | What |
|---|---|---|
| `d04bf88` | 2 (RED) | a quorum nobody can dial cold is not a quorum yet |
| `3407753` | 1 (GREEN) | a quorum is anchored where it is built, not audited after |

The order is inverted against the plan's task numbering on purpose: both tasks are
`tdd="true"` and Task 1's `<proof>` says outright that everything it claims is proved in Task
2's file. Writing the spec first is what makes the RED gate an observation rather than a
formality.

## Verification — every command, and the exit code read directly

Each exit code was taken with `EXIT=$?` on the line immediately after the command, with no
pipe between them. The one run marked *(no code read)* was taken through a `tail` pipe before
the discipline was applied and is reported as the runner's own summary line instead.

| Command | Exit | Reading |
|---|---|---|
| `npx vitest run --project node packages/core/src/quorum.test.ts` (RED, pre-implementation) | *(no code read)* | **5 failed \| 16 passed (21)** |
| `npx tsc --noEmit` after the implementation, first attempt | **1** | one error — `'no-candidates' is not assignable`, my own edit having dropped a union member. Fixed, below |
| `npx tsc --noEmit` after the fix | **0** | no output |
| `npx vitest run --project node packages/core/src/quorum.test.ts` (GREEN) | *(no code read)* | 1 file, **21 passed** |
| `npx vitest run --project node packages/core/src/quorum.test.ts packages/core/src/enrollment.test.ts` | **0** | 2 files, **39 passed** |
| `npx vitest run --project node packages/core/src/quorum.test.ts` — mutation 1 | **1** | **4 failed \| 17 passed (21)** |
| `npx vitest run --project node packages/core/src/quorum.test.ts` — mutation 2 | **1** | **1 failed \| 20 passed (21)** |
| `npx vitest run --project node packages/core/src/quorum.test.ts` — mutation 3 | **1** | **1 failed \| 20 passed (21)** |
| `npx tsc --noEmit` final, every mutation restored | **0** | no output |
| `npx vitest run --project node` × the plan's `<verification>` pair, final | **0** | 2 files, **39 passed** |

**The pre-commit hook ran the cheap guards on both commits** — vocabulary, purity,
mutation-ledger, disclosure, ledgers — and reported **6 files, 156 passed** each time. Neither
commit was refused. `requirements-ledger.node.test.ts` is inside that set, which is the
measurement that VER-03's and VER-04's ledger claims are still true after this change.

## Every mutation, planted and watched

Nothing below is restated from the plan. Each was written into the source with `Edit`, run,
and restored by `cp` from a copy taken before any mutation, verified by `cmp` exit **0** and
`git status --short` showing the file clean against `HEAD`. Both find strings were checked to
occur **exactly once** in the file before being planted.

| # | Mutation | Predicted RED | Observed | Held |
|---|---|---|---|---|
| 1 | the rule deleted — the anchor predicate made vacuous | the three-relays case composes | exit **1**, **4 failed \| 17 passed** | ✅ |
| 2 | the anchor sought only inside the slice the preference already chose | the seed-sorts-last case is refused | exit **1**, **1 failed \| 20 passed** | ✅ |
| 3 | the `'independent'` constant restored | the size-1 reading names both values | exit **1**, **1 failed \| 20 passed** | ✅ |

### Mutation 1 — the rule deleted

```
find:    "  const anchor = ordered.find((candidate) => candidate.discoverability === 'seed')"
replace: "  const anchor = ordered.find(() => true)"
```

Four cases went red, and the spread is itself the reading — the rule is load-bearing in four
independent places, not one:

```
× can be waived deliberately, and the waiver does not reach the anchor rule
× refuses a candidate set nothing can be reached in without a relay
× chooses the anchor before the other slots rather than checking after
× asks for the anchor at size 1 too, where a quorum is one node
```

The plan's named case reddens exactly where predicted, but **its signature does not name the
missing anchor** — see *Anything the plan got wrong*:

```
FAIL  … > VER-03 — a quorum keeps one member a newcomer can reach without a relay
      > refuses a candidate set nothing can be reached in without a relay
AssertionError: expected true to be false // Object.is equality
 ❯ packages/core/src/quorum.test.ts:197:23
    197|     expect(result.ok).toBe(false)
```

### Mutation 2 — a check where a construction should be

```
find:    "  const anchor = ordered.find((candidate) => candidate.discoverability === 'seed')"
replace: "  const anchor = ordered.slice(0, rules.size).find((candidate) => candidate.discoverability === 'seed')"
```

One case, and the right one. The set contains an anchor and is refused anyway, because the
preference filled all three slots before anyone asked:

```
FAIL  … > chooses the anchor before the other slots rather than checking after
AssertionError: expected false to be true // Object.is equality
- Expected  true
+ Received  false
 ❯ packages/core/src/quorum.test.ts:221:23
    221|     expect(result.ok).toBe(true)
```

Note that mutations 1 and 2 share a `find` string. For 19-12 that means two ledger entries
whose `find` is identical and whose `replace` differs — flagged here rather than discovered at
encoding time.

### Mutation 3 — verbatim, for Plan 19-12's ledger

**The plan calls this the reddening that matters most, and it is the one whose signature came
back exactly as predicted — it names both values.**

```
find:    "    strength: classifyAttestation(members),"
replace: "    strength: 'independent',"
```

```
FAIL  |node| packages/core/src/quorum.test.ts > VER-10 / criterion 7 — a weaker claim cannot
      be read as a stronger one > composes a quorum whose strength its own members support,
      not a constant
AssertionError: expected 'independent' to be 'owner-attested' // Object.is equality

Expected: "owner-attested"
Received: "independent"

 ❯ packages/core/src/quorum.test.ts:295:28
    295|     expect(alone.strength).toBe('owner-attested')
```

- `caughtBy`: `packages/core/src/quorum.test.ts`
- `signature`: `composes a quorum whose strength its own members support, not a constant`
- `signatureSource`: `test-title`
- `project`: `node`
- `find` occurs once in `packages/core/src/quorum.ts`, checked by `grep -c` before planting.

## What changed

### `packages/core/src/quorum.ts`

**The module comment's rule list grows from two to three.** Rule 3 carries the same two
paragraphs the others do — what it protects against, and the explicit statement that it reads
the discovery graph and never a node's category. The marker is `discoverability`, and the
comment says what that buys: a Node process that binds no listening address is `via-relay`
exactly as a tab is, and any node that binds one is an anchor. A relay-discovered peer is
excluded from nothing; it fills every slot but the anchor's, and rule 3 refuses only the set in
which *nobody* is dialable.

**A new section states the relationship between rules 2 and 3**, because both directions of it
are things a reader gets wrong. Rule 2 does not already do rule 3's job — three peers on three
different relays pass `sharedRelay` completely while leaving no way in that is not a relay. And
rule 3 *does* do rule 2's job over a chosen member set, which is the finding below.

**The refusal kind**, with its own docblock on why it is named for a missing path:

```ts
| { readonly kind: 'no-direct-discovery-path'; readonly relayDependent: number }
```

**The selection**, chosen and not checked:

```ts
const anchor = ordered.find((candidate) => candidate.discoverability === 'seed')
if (anchor === undefined) { /* refuse, naming what the set lacked */ }
const members = [anchor, ...ordered.filter((candidate) => candidate !== anchor)].slice(0, rules.size)
```

`ordered` is already sorted by fewest dependencies then node key, so `find` over it gives the
anchor the same deterministic tie-break the existing preference uses. The `.slice` on the
concatenation rather than on a `size - 1` tail keeps the function total at `size: 0`, where
`rules.size - 1` would have been `-1` and `slice(0, -1)` drops the last element.

**The strength**, with the defect recorded where it was:

```ts
strength: classifyAttestation(members),
```

**And rule 2 moved** — see the deviation below.

### `packages/core/src/quorum.test.ts`

**21 cases, 18 of which call `composeQuorum`** (11 before). Five new, two reworked, and the
fixture builder's fourth parameter changed from a positional `userKey` — passed by nothing — to
an overrides object so a case can state `discoverability` at the call site.

The builder change is not cosmetic. The combination rule 3 turns on — a node that **is**
directly dialable and *also* advertises through relays — cannot be derived from `relayIds` at
all, and three existing cases reached it by spreading over the result
(`{ ...cert(…), discoverability: 'seed' as const }`). Those three now say it in the call.

New cases, each carrying one line naming what would still pass if the rule were deleted:

| Case | What it pins |
|---|---|
| `refuses a candidate set nothing can be reached in without a relay` | the rule, and **the boundary**: it asserts `sharedRelay(candidates)` is `null` in the same case, so nobody can read rule 2 as covering rule 3 |
| `chooses the anchor before the other slots rather than checking after` | the construction. The only seed advertises through three relays, so it sorts *last* by dependency count, and must still lead the members |
| `composes when the anchor is also what the existing ordering would have picked` | the two orderings agreeing, recorded rather than assumed — and its comment says outright that nothing in it would fail if rule 3 were deleted |
| `asks for the anchor at size 1 too, where a quorum is one node` | the rule stated uniformly, so the function stays total |
| `composes a quorum whose strength its own members support, not a constant` | the derived strength, pinned to `classifyAttestation(three.members)` rather than to a second copy of its answer |

### The two fixtures that changed, and what they kept

Both changes are commented in place with the date and the reason, because a fixture edited
silently to keep a test green is how a rule stops being tested.

**1. `accepts a quorum entirely of relay-discovered peers on different relays`** → *`does not
disqualify relay-discovered peers from the slots of a quorum`*. It gained a fourth candidate,
`cert('n4', 'op-d', [])`, and asks for four instead of three. **No assertion was lost**: it had
two (`ok`, and `members.every(via-relay)`) and now has three (`ok`, the three relay-discovered
peers named individually as members, and exactly one seed). The `every` assertion was replaced
by a strictly stronger one; the claim the case was written for — browser peers are not
disqualified and fill quorum slots on identical terms — is what the new assertions state.

**2. `can be waived deliberately for a single-relay fixture`** → *`can be waived deliberately,
and the waiver does not reach the anchor rule`*. This one **did not** gain an anchor, and its
reading is inverted by design: a single-relay fixture no longer composes with the flag off,
because rule 3 is deliberately not conditioned on it. It went from one assertion to four, and
now pins both refusals — `shared-relay-dependency` with the flag on, `no-direct-discovery-path`
with it off — which is what keeps either from being deleted as redundant.

No other existing case was edited. The nine untouched ones include both cases that assert
`shared-relay-dependency` by kind and relay id, and all four of the `sharedRelay` readings.

## Deviations from Plan

### Auto-fixed

**1. [Rule 1 — bug] My own edit dropped `no-candidates` from `QuorumRefusal`**

- **Found during:** Task 1, by `tsc --noEmit` exit **1**, one error at `quorum.ts:158`.
- **Issue:** the edit that added the new union member replaced the trailing
  `| { readonly kind: 'no-candidates' }` line instead of inserting before it, silently deleting
  a refusal the function still returns.
- **Fix:** restored, before either commit. `tsc` exit 0.
- **Files:** `packages/core/src/quorum.ts` — **caught pre-commit; not in the tree at any point
  a commit was made.**

### Departures from the plan's letter, each with its reason

**2. Rule 2's `sharedRelay` check moved from the chosen members onto the candidate pool, and
now runs before rule 3. This is the substantive one.**

The plan says the two rules *"overlap in exactly one case and are otherwise independent"*. The
overlap is one-directional and, in that direction, total:

- `sharedRelay` returns `null` the moment any member has no discovery dependency, and a seed
  has none by its own definition (`quorum.ts:181-182`, unchanged).
- Rule 3 admits only member sets containing a seed.
- Therefore **once rule 3 holds, `sharedRelay(members)` is `null` for every quorum this
  function can ever return**, and a rule-2 check standing after rule 3 is dead code. The
  `shared-relay-dependency` refusal would have become unreachable through `composeQuorum`, and
  the existing VER-09 case that asserts it by kind and relay id would have had to be weakened
  into a direct `sharedRelay` call.

The converse does not hold, which is why rule 3 had to be built: three peers on three different
relays pass rule 2 and fail rule 3.

Asked of the **pool**, before rule 3 chooses from it, rule 2 still fires and still names the
one relay a pool hangs off. The move refuses nothing that would otherwise compose — a pool
sharing one relay contains no seed, so rule 3 refuses it regardless — and it stops refusing one
thing it used to refuse wrongly: a pool whose *chosen* members shared a relay while the pool
held an anchor the old ordering had left out. That set is precisely the plan's own second proof
case, so the two changes are the same correction seen from two sides.

The refusal reason string was corrected with it, from *"every member of the quorum is
discoverable only through relay R"* to *"every candidate is…"*, because the members have not
been chosen at that point and the old sentence would have been false.

**3. `requireIndependentPaths: false` no longer composes a single-relay fixture.** A direct
consequence of the plan's own instruction that rule 3 is not conditioned on the flag, but the
plan does not say the flag becomes near-inert, and it does: any pool that passes rule 3
contains a seed, so rule 2 has nothing left to waive. What the flag still decides is *which*
refusal a caller hears. The option's docblock now says exactly this, and the reworked case
asserts both halves. The option was **not** removed — that is public API and out of scope.

**4. The size-1 anchor case uses two candidates for one slot.** The obvious fixture — one
relay-dependent candidate, `size: 1` — is refused by **rule 2**, because a pool of one node
shares a relay with itself. The case would have been reading rule 2's answer while claiming to
read rule 3's. Caught by running it: the first RED reading returned
`expected 'shared-relay-dependency' to be 'no-direct-discovery-path'`, which is the right
refusal for the wrong reason. The fixture is now two candidates on two different relays, and
its comment says why.

**5. No helper was extracted.** 19-CONTEXT leaves *"whether the rule lives in `composeQuorum`
itself or in a small helper beside it"* to discretion. Inline: the rule is one `find` and one
refusal, the plan's `key_links` pattern (`discoverability === 'seed'`) reads directly in the
composer, and a newly exported symbol with no caller is the *built, not wired* condition this
milestone exists to remove.

**6. `.planning/REQUIREMENTS.md` was not touched.** VER-03's and VER-04's rows both read
*"**Built, not wired** — composeQuorum has no caller outside its own spec"*, and that sentence
— the one `requirements-ledger.node.test.ts` actually parses and re-derives — **is still true**;
this plan wires no caller. The pre-commit guard re-measured it on both commits and passed. Worth
recording that the word *Built* over-claimed until this plan and is accurate for the first time
now; the verdict is 19-12's to move, and moving it here would move header arithmetic.

## Findings the next plans need

**1. 19-06 must ensure a seed is among the candidates, or `submitJob` will be refused.** After
this change a candidate set drawn purely from browser tabs — every one `via-relay` — **cannot
compose a quorum at all**. That is VER-03 working as specified, not a defect, but it is a live
constraint on the wiring plan and on any e2e fixture built out of tabs behind one relay. The
fabric's own relay is a `FabricNode` and therefore a seed; whether it appears in the *candidate
executor* set is a separate question this plan did not measure and 19-06 will have to.

**2. `composeQuorum` still has zero production callers**, unchanged by this plan and its own
`Out of scope`. The anchor rule is implemented and unreached; a verifier must not read the
implementation as the wiring.

**3. `sharedRelay(members)` is now provably `null` for every quorum `composeQuorum` returns.**
Any later code tempted to read `sharedRelay` off a composed quorum's members — the receipt in
`attestationReceipt` is the obvious candidate — will get `null` and should not treat that as
evidence of anything. `attestationReceipt` takes *agreeing replicas*, which are not
anchor-constrained, so it is unaffected; the trap is only for a future caller that passes
`result.members`.

**4. The `owner-domain` arm is still unreachable through `composeQuorum`, and this plan
preserved that deliberately.** One certificate per operator by construction, so
`classifyAttestation(members)` can only ever return `owner-attested` (size 1) or `independent`
(size ≥ 2). Criterion 2 runs through `resolveReplicaSets` + `attestationReceipt`, per 19-CONTEXT.
The per-operator reduction was not touched.

## Anything the plan got wrong

| Plan says | Measured | Weight |
|---|---|---|
| The two rules *"overlap in exactly one case and are otherwise independent"* | Rule 3 implies rule 2 over any chosen member set, totally. The independence holds in one direction only, and the consequence is that rule 2 had to move to keep firing | **Substantive.** Analysed above |
| Proof 1 is *"reddened by removing the rule: the composition succeeds and **the assertion names the missing anchor**"* | The composition does succeed, and the case does redden — at `expect(result.ok).toBe(false)`, whose signature is `expected true to be false`. The assertion that names the refusal kind never runs, because the `ok` assertion throws first | Wording. The reddening is real and was observed; its **signature** is generic, which matters only because 19-12 wants signature text |
| Task 2 predicts *"the eleven existing cases, plus the four this rule needs"* | Five new cases, not four — the plan's own body lists four *plus* a boundary case, and the boundary is folded into the first of them, so the count in the title is one short of the count in the text | Immaterial |
| `size: 1` is described only as *"still requires the anchor"* | True, and it is also the **only** size at which the `'independent'` constant was ever wrong, which is why the same fixture carries both readings | Not an error; recorded because the two proofs are one fixture apart |

Every `file:line` citation in the plan was re-read against source before being relied on and
was correct: `quorum.ts:110` (`composeQuorum`), `:140-142` (the ascending sort), `:145-153`
(the `sharedRelay` check), `:159` (the `'independent'` literal), `:169-193` (`sharedRelay` and
its seed clause), `:202-211` (`classifyAttestation`), `:120-160` (the construction, quoted
verbatim and matching), `:123-126` (the per-operator comment), `enrollment.ts:90-94`
(`Discoverability`). The claim that no `backbone` symbol exists in `packages/*/src` was
re-checked and holds — this plan adds none.

## Known stubs

None. The rule reads the certificate field the enrollment authority signs, the refusal is
returned from the same `refuse` helper as the other three, and the strength is the output of
the production `classifyAttestation` over the actual members. No placeholder value, no
hardcoded empty collection, nothing wired to mock data.

The one deliberate absence — **nothing calls `composeQuorum` in production** — is the plan's
own `Out of scope` and is recorded under *Findings*, because the plan names 19-06 as its owner.

## Threat flags

None. No new wire frame, request kind, network endpoint, auth path, file access pattern or
schema at a trust boundary. The change is a pure module's internal decision procedure.

Both behavioural changes are in the **restricting** direction: one candidate set shape that
composed now refuses, and one refusal is now more specific than it was. The single case that
newly *composes* — a pool whose chosen members shared a relay while the pool held an anchor —
is strictly safer than the refusal it replaces, because the composed quorum contains a member
that survives losing every relay in it.

## Self-Check: PASSED

Files claimed modified, listed off disk:

```
FOUND  packages/core/src/quorum.ts        318 lines
FOUND  packages/core/src/quorum.test.ts   393 lines
```

The plan's `must_haves.artifacts` requires `packages/core/src/quorum.ts` to contain
`classifyAttestation` — present, and now **called** from `composeQuorum`'s ok arm rather than
only declared. `must_haves.key_links` requires `quorum.ts` to reach `enrollment.ts` via the
pattern `discoverability === 'seed'` — present, in the anchor selection, and reading the type
`enrollment.ts` declares.

Commits claimed, found in `git log --oneline`:

```
FOUND  3407753  feat(19-02): a quorum is anchored where it is built, not audited after
FOUND  d04bf88  test(19-02): a quorum nobody can dial cold is not a quorum yet
```

Neither commit deleted a tracked file. Every path was staged explicitly and `git status
--short` was read before each commit; both commits contain exactly one file. All three
mutations were restored by `cp` and verified by `cmp` exit **0**, with the file reading clean
against `HEAD` after each restore. `git checkout --` was never used, `git clean` was never run,
no branch was switched, and the other agent's in-flight files in this shared tree were never
staged, edited or reverted. `.planning/STATE.md` was not touched and no criterion text in
`.planning/ROADMAP.md` was amended.

### TDD Gate Compliance

`d04bf88` is the `test(…)` RED gate and `3407753` the `feat(…)` GREEN gate after it. No
`refactor(…)` gate: nothing needed cleaning after green. Both gates were observed, not
assumed — the RED run returned **5 failed | 16 passed** before any implementation existed, and
each of the five failures is named above or in the deviations.

---

# Correction — 2026-08-03: the anchor rule is retracted

**Everything above is left as written.** The plan was executed faithfully, the measurements in
it are real and were re-checked here, and the finding it reported about rules 2 and 3 is
correct. What was wrong was the *instruction*, and the error is the owner's rather than the
executor's. This section is appended rather than folded in, because a summary rewritten to
match a later ruling stops being evidence of what was found.

| Commit | What |
|---|---|
| `0314208` | `fix(19-02)` — the rule and its refusal kind removed, rule 2 moved back onto the member set |
| `b1fc0ae` | `docs(19-01)` — the same premise removed from `NodeDescriptor.certificate`'s docblock |

## 1. What was removed

Rule 3 in `composeQuorum` (`const anchor = ordered.find((c) => c.discoverability === 'seed')`),
its refusal kind `no-direct-discovery-path` carrying `relayDependent`, and the four spec cases
that asserted it.

**It keys on node kind, which `STATE.md:479-480` forbids** — *"the only legitimate use is
shared-dependency analysis over the discovery graph"*, and rule 2 already **is** that analysis.
Naming the refusal for a missing *path* rather than a missing *node class* was careful and did
not change what the predicate read. The counter-example sat three lines above the rule in this
repository's own record: an iPhone dialled at its `/p2p-circuit/webrtc` address ran half of a
2×-redundant job in Phase 3. A relay-discovered peer has already held a verification slot here.

The correct reading, owner ruling 2026-08-03: **`backbone-anchored` describes the replica, not
the node** — at least one copy of the result pinned somewhere durable, so the verification
outlives the nodes that produced it. Three tabs behind one relay are a perfectly good quorum
provided one of them pins its result.

`classifyAttestation(members)` on the ok arm is **untouched**. That half of 19-02 was correct,
is unrelated to the rule, and its mutation was re-planted and re-observed here (M5 below).

## 2. Where rule 2 ended up, and the measurement that decided it

**Back on the member set, where it was before 19-02.** Not because the old position was old,
but because the pool position is *strictly weaker* and the difference is exactly what VER-09
exists to refuse.

19-02's reasoning — that rule 3 made a post-hoc rule-2 check dead code — was correct, and the
premise is now gone. But the move was not merely unnecessary; it left a hole, and the hole was
**observed rather than argued**. With rule 3 deleted and rule 2 still on the pool
(`sharedRelay(distinct)`), the run returned exit **1**, **2 failed | 19 passed**, both with the
signature `expected true to be false` — that is, `result.ok === true`:

```
× refuses a quorum whose own members share a relay the wider pool does not
× refuses a one-member quorum that hangs off a single relay
```

The fixture is a pool on `relay-1`, `relay-1`, `relay-2`. `sharedRelay` over the pool is `null`
— the paths really are independent across all three — so rule 2 asked of the pool passes, and
the two members drawn at `size: 2` **both hang off relay-1**. That composition reports a
redundancy of two against a single point of failure.

The general statement: members are a subset of the pool, so a relay common to every candidate is
common to every member — **pool-refusal implies member-refusal, and the converse fails**. The
member set is also what the caller receives and what the failure domain is a property of.

**The side effect 19-02 recorded was rule 3's, not the move's.** `requireIndependentPaths: false`
composes a single-relay fixture again, and it would have done so wherever rule 2 sat: rule 3 was
deliberately not conditioned on the flag, which is what left the flag deciding *which refusal
spoke* rather than whether one did. It is wanted — it is the flag's documented purpose and it is
public API — and the reworked case now asserts both halves rather than the one assertion it
carried before 19-02.

**One consequence worth flagging for 19-06 and 19-12 rather than leaving to be found.** At
`size: 1` a lone relay-discovered node is refused by rule 2, because a quorum of one has exactly
the failure domain of its only member. This is pre-19-02 behaviour, restored rather than
invented, and it is genuine shared-dependency analysis. But it is the one place where rule 2's
verdict correlates perfectly with `discoverability`, and anybody auditing the cardinal rule will
stop on it. It is recorded here so that the answer is on file before the question is asked.

## 3. Where the anchor requirement belongs — finding, not implementation

**It cannot live in `composeQuorum`, and nothing was built on a guess.**

`composeQuorum` runs *before* execution over `NodeCertificate[]`. Durability of a result is a
fact that only exists *after* execution, and the certificate type was re-read field by field
(`enrollment.ts:100-124`): `nodeKey`, `userKey`, `operatorId`, `discoverability`, `relayIds`,
`issuedAt`, `expiresAt`, `issuer`, `signature`. **Nothing states whether a node pins durably**,
and no node-level durability advertisement exists anywhere in `packages/*/src`.

The three candidates named for investigation, each checked:

| Candidate | Verdict |
|---|---|
| A durability claim on `CapabilityRecord` | **Structurally plausible, and wrong.** It is the right *shape* — node-signed, re-signable locally, meaningful only bolted to a provider-signed certificate, already carrying `features` and `sovereignFor`. Two things kill it. First, it is a **claim**, and `discovery.ts` records owner ruling **D1** rejecting exactly this shape for provider records: *"a node that evicts a block still reads as a provider until something retracts the announcement."* A node that claims durable pinning and then evicts reads as an anchor on identical terms. Second, and worse, it answers the wrong question — a capability record states what a node *can* do, while VER-03 is about **one specific replica of one specific result**. A node able to pin, that did not pin this output, satisfies the claim and not the requirement. Also note `composeQuorum` does not take capability records at all, so this would not reach it without a further type change |
| `attestationReceipt` | **The right place to _report_ it, the wrong place to _establish_ it.** It takes `agreeing: readonly NodeCertificate[]` and derives every field from certificates, so it cannot answer a storage question either. It is nonetheless the natural surface — it already exists to be *"a receipt a reader can act on without knowing how the quorum was built"*, and it already carries `sharedRelay`, a fact of exactly this kind. An `anchored` field belongs beside it, but the receipt must **receive** the fact, not derive it |
| The point the result is pinned / provided | **Where it belongs.** The result is already content-addressed: `ResultWork.outputCid` is *"`canonicalCid` of the output the node produced — the answer being attested"* (`result-attestation.ts:89-101`). So the anchor is a statement about a CID that already exists, and the repository already holds both halves of the machinery — `providers(cid)` answered **at ask time from a node's own store** (`SelfRecordIndex`, per ruling D1, i.e. an observation rather than an announcement), and `SovereignCids` / `FsSovereignCids` as the worked precedent for durability done honestly, where `add` resolves only once the append is flushed so *"a node that recorded a CID and then lost power comes back still refusing it"* |

**Proposed shape, for whoever owns VER-03 next.** A post-execution check over a completed job:
for each verified shard, at least one agreeing replica's `outputCid` is held by a node whose
store is durable, established by **asking** rather than by reading a claim, and surfaced as an
`anchored` field on the receipt. It is a property of a finished result, not a precondition on a
quorum — and when it is unmet the remedy is to **pin another copy**, never to refuse the
composition. That distinction is the whole of what 19-02 got wrong: it turned a repair into a
refusal, and put the refusal before the thing it was about.

## 4. Anything else on the wrong premise

**`packages/core/src/sovereignty.ts` — `NodeDescriptor.certificate`'s docblock, from 19-01, not
19-02.** It read *"`discoverability` is what makes a member backbone-anchored"* and listed VER-03
among the requirements the field carries onto the dispatch path. **This is where the rule came
from** — 19-02 implemented what this sentence asserted. Corrected in `b1fc0ae`: the field still
genuinely carries VER-04 and VER-08…VER-10, and VER-03 is struck with the reason recorded in
place. Comment only; no behaviour changed, and `sovereignty.test.ts` was run alongside.

**Nothing else.** `no-direct-discovery-path` was referenced only in `quorum.ts` and
`quorum.test.ts` — confirmed by grep across the tree and by `tsc --noEmit` exit **0** after
removal, which is the load-bearing reading that no other module consumed the kind. The
**mutation ledger holds no entry for `packages/core/src/quorum.ts`** (`grep` exit **1**), so
nothing needed re-aiming: 19-02 flagged its three mutations for 19-12 to encode and they were
never added. Of those three, M1 and M2 keyed on the deleted `anchor` line and are now void —
**19-12 must not encode them**; M3 (the `strength` constant) is live and re-proved below.

## 5. Verification — every command, exit code read directly

`EXIT=$?` on the line immediately after each command, no pipe between them. The single piped run
early on is reported as the runner's own summary line and was re-taken unpiped.

| Command | Exit | Reading |
|---|---|---|
| `vitest run --project node …/quorum.test.ts` (baseline, before any edit) | **0** | 1 file, **21 passed** |
| same (RED, new spec against unchanged source) | **1** | **5 failed \| 16 passed (21)** |
| same (**stage A** — rule 3 deleted, rule 2 left on the pool) | **1** | **2 failed \| 19 passed (21)** — the hole, quoted in §2 |
| same (**stage B** — rule 2 moved onto the members) | **0** | 1 file, **21 passed** |
| `tsc --noEmit` | **0** | no output — and the reading that nothing else used the deleted kind |
| same spec — mutation 1 | **1** | **6 failed \| 15 passed (21)** |
| same spec — mutation 2 | **1** | **2 failed \| 19 passed (21)** |
| same spec — mutation 3 | **1** | **1 failed \| 20 passed (21)** |
| same spec — mutation 4 | **1** | **1 failed \| 20 passed (21)** |
| same spec — mutation 5 | **1** | **1 failed \| 20 passed (21)** |
| `vitest run --project node …/quorum.test.ts …/sovereignty.test.ts` (final) | **0** | 2 files, **30 passed** |
| `tsc --noEmit` (final, every mutation restored) | **0** | no output |
| the six cheap guards, against the staged index | **0** | 6 files, **156 passed** — re-run by the hook on both commits |

Only the two projects' worth of files touched were run, always `--project node`. The full suite
was never run and `npm run test:node` was never run. `quorum.test.ts` also matches the `browser`
project's include; that project was deliberately not run. **No failure looked like a timeout or
a flake**, and nothing here is reported as unresolved under load. Load average was 18.43 on 8
cores at the start; **no duration is recorded and no timeout was added or tuned.**

## 6. Every mutation, planted and observed

Each `find` string was confirmed to occur **exactly once** by `grep -Fc` before planting. Each
was restored by `cp` from a snapshot taken while green and verified by `cmp` exit **0**;
`git checkout --` was never used.

| # | Mutation | Predicted | Observed | Held |
|---|---|---|---|---|
| 1 | the node-kind rule reinstated — `if (!members.some((c) => c.discoverability === 'seed')) return refuse(…)` | the two counter-example cases refuse | exit **1**, **6 failed \| 15 passed** | ✅ |
| 2 | rule 2 back on the pool — `sharedRelay(members)` → `sharedRelay(distinct)` | the two member-set cases compose | exit **1**, **2 failed \| 19 passed** | ✅ |
| 3 | the dependency-count preference dropped from the sort | the ordering case picks the shared-relay pair | exit **1**, **1 failed \| 20 passed** | ✅ |
| 4 | the waiver ignored — `rules.requireIndependentPaths ?? true` → `true` | the waived half refuses | exit **1**, **1 failed \| 20 passed** | ✅ |
| 5 | 19-02's M3 re-planted — `classifyAttestation(members)` → `'independent'` | the size-1 strength reading names both values | exit **1**, **1 failed \| 20 passed** | ✅ |

**Mutation 1 is the one that matters**, because it is the deleted rule coming back. Six cases
see it, and the two written for the retraction name it exactly:

```
× does not disqualify relay-discovered peers from the slots of a quorum
      AssertionError: expected false to be true
× composes a quorum no member of which can be dialled cold
      AssertionError: expected false to be true
```

**Mutation 5 came back verbatim as 19-02 recorded it** — `expected 'independent' to be
'owner-attested'`, naming both values — which is the cross-check that the untouched half of
19-02 is still guarded by the case it was built with.

## 7. A proof that could not fail, said out loud

The ordering case as first written (`prefers the fewest discovery dependencies when filling the
slots`) **passed under mutation 3 and was therefore proving nothing.** Its fixture named the
zero-dependency node `n1`, which sorts first by node key *and* by dependency count, so removing
the dependency-count term from the comparator left the answer identical. It was rewritten before
being committed: the seed is now `z9`, so the two orderings genuinely disagree, and two slots
are asked of three candidates so that the preference decides whether the members share relay-1
at all. Mutation 3 reddens it only after that change.

Recorded because it is the same class of defect this correction is about — a check that reads as
load-bearing and cannot fail — and because it was caught by planting, not by reading.

## 8. What is deliberately not touched

- **`.planning/REQUIREMENTS.md`.** VER-03's row still reads *"Built, not wired"*, which now
  over-claims: after this change VER-03 has **no implementation at all**. That is the honest
  state and 19-12 owns row verdicts. Note also that VER-03's own requirement text still says
  *"anchored on a **backbone node**"* — the wording that produced this error. Correcting it is an
  owner decision, not this correction's, and weakening it here would have hidden the finding.
- **`.planning/ROADMAP.md`** criterion text, and **`.planning/STATE.md`**.
- **`packages/core/src/job/verify.ts` and the `agreeing` type**, which plan 19-14 holds in this
  shared tree. Neither was read for edit nor staged.

## Self-Check: PASSED

Both commits found in `git log --oneline`, and neither deleted a tracked file (`git diff
--diff-filter=D` empty for each):

```
FOUND  0314208  fix(19-02): a seed requirement is a node class, not a discovery-graph rule
FOUND  b1fc0ae  docs(19-01): VER-03 is not carried by a certificate field
```

Files claimed modified, off disk: `packages/core/src/quorum.ts`, `packages/core/src/quorum.test.ts`,
`packages/core/src/sovereignty.ts`.

**One claim in this section was written wrong and is corrected rather than quietly fixed**, since
that is the discipline this whole correction is about. It first read that `no-direct-discovery-path`
*"matches only this planning directory's prose, never `packages/`"*. Checked, and false: it still
occurs twice under `packages/` — `quorum.ts:23` and `quorum.test.ts:179` — in the two retraction
docblocks that name what was removed, which is deliberate. The claim that is true and was the one
worth making: it occurs **nowhere as a type member or a value**, verified by grepping
`kind: 'no-direct-discovery-path'`, `kind === 'no-direct-discovery-path'` and
`toBe('no-direct-discovery-path')` across `packages/` for `grep` exit **1**, and corroborated by
`tsc --noEmit` exit **0**.

Every path was staged explicitly; `git add -A` was never used, `git checkout --` was never used,
`git clean` was never run, and no branch was created or switched. The other agent's in-flight
files were never staged, edited or reverted, and `git status --porcelain` was read before each
commit.
