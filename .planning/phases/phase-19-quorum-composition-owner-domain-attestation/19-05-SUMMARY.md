---
phase: phase-19-quorum-composition-owner-domain-attestation
plan: 05
subsystem: enrollment
tags: [auth-04, issuance, budget, ports, sentinel, wire, criterion-5]

requires:
  - phase: phase-17
    provides: "`EnrollmentAuthority`, its per-user window, and the two measurements that defeat it — the limiter keys on `userKey`, and the budget is per provider process"
  - phase: phase-11
    provides: "WIRE-01's required-with-named-sentinel convention, applied here to both new options"
  - phase: phase-19
    plan: 13
    provides: "`packages/core/src/index.ts`'s enrolment export block as it now stands, and four new `EnrollmentAuthority` construction sites this plan's fan-out estimate could not have seen"
provides:
  - "`maxIssuedPerWindow` — how many certificates one provider signs per window, whoever asked; a required union with a named sentinel"
  - "`IssuanceLedger` — a synchronous port the HOST supplies; both budgets read it and the authority holds no history of its own"
  - "`IssuanceHistory` — the port or `'remembers-only-within-this-process'`, required, so the per-process behaviour Phase 17 measured as defeated is something a caller asks for by name"
  - "`issuedToAnybodyWithin(now)` — the aggregate reader beside `issuedWithin(userKey, now)`, so a provider's own budget is measurable from outside"
  - "`issuance-budget-exhausted` — a refusal kind naming the provider's threshold and nothing about the requester, encoded and parsed on the wire"
affects:
  - "19-07 — supplies each tier's durable ledger and an aggregate number, and takes the cross-process reading across a real provider restart"
  - "19-12 — the mutation-ledger entry; the find/replace pair and the observed failure text are recorded below"

tech-stack:
  added: []
  patterns:
    - "A required union with a named sentinel, never an optional — and for `issuance` specifically the default *is* the defect: defaulting it to the in-process history reproduces the per-process budget Phase 17 measured as defeated, with nothing anywhere failing"
    - "A port that must stay synchronous because a *different* file records an argument that depends on it — `agent.ts`'s enrol branch takes no capacity slot *because* `enrol` is synchronous"
    - "Pruning belongs to whoever owns the policy: `windowMs` is the authority's, so the ledger returns everything and the authority filters"
    - "A refusal about the provider names nothing about the requester — its own kind, its own fields, and no key on the wire"
    - "`tsc` finds constructors, not readers: it flagged the wire *encoder* and said nothing about the wire *parser*, which compiles clean while returning null for the new kind"

key-files:
  created: []
  modified:
    - packages/core/src/enrollment.ts
    - packages/core/src/enrollment.test.ts
    - packages/core/src/index.ts
    - packages/net/src/protocol.ts
    - packages/net/src/enrol-protocol.test.ts
    - packages/node/src/fabric-node.ts
    - packages/browser/src/browser-node.ts
    - packages/net/src/enrol-agent.test.ts
    - packages/node/src/enrollment.node.test.ts
    - .planning/REQUIREMENTS.md
    - packages/core/src/codec-refusal.test.ts
    - packages/core/src/discovery.test.ts
    - packages/core/src/executor/attesting-executor.test.ts
    - packages/core/src/job/verify.test.ts
    - packages/core/src/result-attestation.test.ts
    - packages/net/src/discover-candidates.test.ts
    - packages/net/src/discovery.test.ts
    - packages/net/src/protocol.test.ts
    - packages/net/src/provider-merge.test.ts
    - packages/net/src/sovereign-execution.test.ts
    - packages/node/src/identity-store.node.test.ts
    - packages/node/src/peer-verifier.node.test.ts
    - packages/browser/src/insecure-origin.browser.test.ts

key-decisions:
  - "**The plan's `No wire change anywhere in this plan` is measured FALSE.** `EnrollmentRefusal` is a wire type — `serveAgent` answers an enrol frame with the `EnrollmentResult` the authority produced — so adding a refusal kind *is* a wire change. `protocol.ts` was opened and both halves fixed."
  - "**The plan's reddening for the synchronous port could not fire.** Giving `IssuanceLedger.record` a `Promise<void>` return leaves `agent.ts` compiling clean. What the compiler does refuse is `enrol` itself becoming async — `agent.ts:724` then reports the response is not an `AgentResponse`. Measured both ways and recorded at the case."
  - "**The plan's Task 1 `<verify>` is unsatisfiable as written.** It asks `tsc --noEmit` to exit 0 after making `maxIssuedPerWindow` required, while Task 2's action explicitly says `making both new options required breaks every site`. tsc is red by construction between the two tasks; the fan-out was done once, in Task 2, as the plan's own action describes."
  - "**The plan's predicted split for the `every issuance is recorded` reddening is not reachable.** It expects `record only in #history` to leave the per-user assertion green and the aggregate empty. One `record(userKey, at)` call writes both, so the split lives inside a ledger implementation rather than inside the authority. Dropping the call was planted instead and is recorded below."
  - "The refusal names nothing about the requester, on the wire as well as in the object. `rate-limited` names a `userKey` because it *is* about that user; this one is about the provider, and an operator who read a user key here would look in the wrong place."
  - "The per-user window is reported first. Both orderings are correct on state — nothing above the sign writes history, so no refusal consumes anybody's budget — so the choice is which reason a requester is told when both bind, and their next actions differ: wait, versus find another provider."
  - "Both production factories write both sentinels, so no production behaviour changed and `enrollment.node.test.ts` stayed green for a reason a reader can see at the construction site rather than because nothing exists."
  - "Pruning stays the authority's. A ledger that pruned would need `windowMs`, which is the authority's policy, and a host that got it wrong would silently move both budgets with nothing failing. The consequence — an implementation accumulates one timestamp per certificate — is stated at the port; compaction is the host's, beside durability."
  - "No certificate-lifetime change, no renewal loop, no revocation list, nothing global. Revocation stays non-renewal on the certificate's own clock."

requirements-completed: []
duration: one session
completed: 2026-08-03
---

# Phase 19 · Plan 05 — The budget that a restart does not hand back

Phase 17 measured its own rate limit and published what it does not buy. The limiter keys
on `userKey`, and a fresh user key is one `ed25519.keygen()`; the budget is per provider
**process**, so a restart forgets it. Both findings have one root — **nothing in an
enrolment request is scarce** — and this plan pulls it: a second budget on the provider's
own issuance, and a history the **host** owns rather than the authority's heap.

It also found that its own "no wire change anywhere" was false, and that one of its named
reddenings cannot fire.

## What changed

| file | what |
|---|---|
| `packages/core/src/enrollment.ts` | `maxIssuedPerWindow` + `IssuanceBudget`; `IssuanceLedger` + `IssuanceHistory`; `issuedToAnybodyWithin`; the `issuance-budget-exhausted` refusal; `#history` deleted; the module header's cost section rewritten |
| `packages/core/src/index.ts` | the three new types exported beside the existing enrolment exports |
| `packages/net/src/protocol.ts` | **not in the plan's file list** — the new refusal arm encoded *and* parsed |
| `packages/node/src/fabric-node.ts`, `packages/browser/src/browser-node.ts` | both sentinels written out, each naming Plan 19-07 as where the tier gets the durable form |
| `packages/core/src/enrollment.test.ts` | nine new cases across two blocks, plus a hand-written test ledger |
| `packages/net/src/enrol-protocol.test.ts` | the fourth arm's round-trip and its malformed-numbers refusal |
| `packages/net/src/enrol-agent.test.ts`, `packages/node/src/enrollment.node.test.ts` | prose corrected — both cited `#history` being a `Map` in the authority object, and one quoted a header sentence this plan deleted |
| `.planning/REQUIREMENTS.md` | AUTH-04's *reason* rewritten; verdict left at **Partial** for 19-12 |
| 15 further spec files | two properties each, from the compiler's enumeration |

### The fan-out, measured

**26 construction sites across 18 files**, producing **24 `tsc` errors across 17 files**
once `enrollment.test.ts` was already done. The plan states **22 across 14, measured
2026-08-02**, and asks to be told if that differs materially. It does, and the difference
is entirely wave 1: `result-attestation.test.ts`, `executor/attesting-executor.test.ts`,
`job/verify.test.ts` and `protocol.test.ts` are 19-13's, and did not exist when the plan
counted. Two sites are production, as the plan says.

Never a repository-wide substitution. Each file was edited on its own; `provider-merge.test.ts`
took a four-site scripted replacement scoped to that one file, with the occurrence count
asserted before the write.

### `tsc` found the encoder and not the parser

19-CONTEXT.md's *"`tsc` finds construction sites, not reader sites"* fired again, in the
file the plan said it would not open. Adding a kind to `EnrollmentRefusal`:

- **`tsc` flagged `protocol.ts:426`** — `enrollmentResultToValue` destructures `refusal.userKey`
  on the fall-through arm, which no longer exists on the union.
- **`tsc` said nothing about `parseEnrollmentRefusal`.** It returns `null` for a kind it
  does not know and compiles perfectly while doing so. Observed before the fix: the
  provider refuses correctly, and the peer parses `null` — so AUTH-04's *stated threshold*
  never reaches the peer that hit it.

The grep alongside the type-check also found two prose readers the compiler cannot see:
`enrol-agent.test.ts:225` quoting a header sentence this plan deleted, and `:251` plus
`enrollment.node.test.ts:63` asserting `#history` is a `Map` in the authority object. All
three corrected; none of their *readings* moved.

## Mutation readings actually observed

Every one planted by hand into the working tree, restored with `cp` + `cmp` (**exit 0**
each time), `git status --porcelain` confirmed empty afterwards, and the file re-run green.

| # | mutation | reading |
|---|---|---|
| M-1 | *(RED phase, Task 1)* no aggregate check exists yet | **RED** — 4 failed / 18 passed. `expected [ { ok: true, …(1) }, …(19) ] to have a length of 5 but got 20`. Phase 17's finding reproduced exactly: twenty free keygens enrol unslowed |
| M-2 | aggregate branch returns `kind: 'rate-limited'` + `userKey` instead | **RED** — 3 failed / 19 passed, every failure `expected 'rate-limited' to be 'issuance-budget-exhausted'`. **Every `ok === false` assertion stayed green**, exactly as the plan predicted — an operator would be sent to a user key that is not the problem |
| M-3 | the two checks swapped, aggregate first | **RED** — 1 failed / 21 passed: `expected 'issuance-budget-exhausted' to be 'rate-limited'`. The reading flips and a requester whose own window is full is told to find another provider |
| M-4 | *(RED phase, Task 2)* the ledger does not exist | **RED** — 4 failed / 23 passed, `expected +0 to be 2`. The sentinel control passed already, as it must |
| M-5 | constructor ignores `options.issuance` and always builds the in-process history | **RED** — 4 failed / 23 passed, `expected +0 to be 2`. Both budgets read zero and every pre-loaded timestamp is invisible — precisely the pre-plan world, exactly as the plan predicted |
| M-6 | the `this.#issuance.record(...)` line deleted | **RED** — **12** failed / 15 passed; the ledger case reports `expected [] to deeply equal [ 1800000000000 ]`. Far wider than the plan's predicted two-assertion split — see below |
| M-7 | `IssuanceLedger.record` returns `Promise<void>` | **`tsc` exit 1, but not where the plan said.** One error, in this plan's own hand-written test ledger. `agent.ts` compiles clean |
| M-8 | `enrol` itself made `async` | **`tsc` exit 1 at `packages/net/src/agent.ts:724`** — `{ kind: "enrol"; result: Promise<EnrollmentResult> }` is not assignable to `AgentResponse`. *This* is the compile-time proof the recorded argument at `agent.ts:710` still holds |
| M-9 | *(the 19-12 candidate)* the whole aggregate check deleted from `enrol` | **RED** — 6 failed / 21 passed, headline `expected [ { ok: true, …(1) }, …(19) ] to have a length of 5 but got 20` |

### The 19-12 entry, ready to be written rather than predicted

`file: packages/core/src/enrollment.ts`. The `find` is the whole aggregate block, verified
**unique** in the file before planting (`occurrences: 1`); `replace` is the empty string.

`find` begins `    if (this.#maxIssuedPerWindow !== 'issues-without-an-aggregate-budget') {`
and ends `…(limit ${this.#maxIssuedPerWindow})\`,\n        }\n      }\n    }\n`.

- `caughtBy`: `packages/core/src/enrollment.test.ts`
- `signature`: `refuses past its stated number however many free keygens the requester mints`
- `signatureSource`: `test-title` — the string is in the file, so `rendered-at-runtime`
  would be a false declaration and the guard rejects that.

The failure text was **observed**, not predicted: `AssertionError: expected [ { ok: true,
…(1) }, …(19) ] to have a length of 5 but got 20`.

No entry was added to `mutation-ledger.ts`; that is 19-12's, and its floor and its
`rendered-at-runtime` roster are 19-12's to move.

## Commands run, with real exit codes

`EXIT=$?` on the line immediately after the command it reads, never through a pipe.

| command | exit |
|---|---|
| `npx tsc --noEmit` (final) | **0** |
| `npx vitest run --project node packages/core/src/enrollment.test.ts packages/net/src/enrol-agent.test.ts packages/net/src/enrol-protocol.test.ts packages/net/src/provider-merge.test.ts` | **0** — 66 tests |
| `npx vitest run --project node packages/core/src/codec-refusal.test.ts …/discovery.test.ts …/executor/attesting-executor.test.ts …/job/verify.test.ts …/result-attestation.test.ts` | **0** — 82 tests |
| `npx vitest run --project node packages/net/src/discover-candidates.test.ts …/discovery.test.ts …/protocol.test.ts …/sovereign-execution.test.ts` | **0** — 48 tests |
| `npx vitest run --project node packages/node/src/identity-store.node.test.ts …/peer-verifier.node.test.ts` | **0** — 40 tests |
| `npx vitest run --project browser packages/browser/src/insecure-origin.browser.test.ts` | **0** — 9 tests across 3 browser instances |
| `npx vitest run --project node packages/node/src/enrollment.node.test.ts` | **0** — 7 tests |
| `npx vitest run --project node packages/node/src/requirements-ledger.node.test.ts …/vocabulary.node.test.ts …/mutation-guard.node.test.ts` | **0** — 112 tests |

The six cheap guards ran through the pre-commit hook on **each of the seven commits** and
passed every time — 156 tests each.

**No timing was recorded, and no timeout was added or tuned.** Nothing in this plan's code
asserts on wall-clock time.

## What was not run, and why

The plan's overall verification asks for `--project node` and `--project browser` **in
full**. Neither was run: the host was carrying a foreign build at a load average around 14
on 8 cores, and the instruction was to run only the files this plan names, project-scoped.
Everything the plan lists as load-bearing was run and passed, plus every file the fan-out
touched, plus the three guards named in the brief. `tsc --noEmit` at exit 0 covers every
construction site in the ~90 node files not run.

**Nothing was found unresolvable under load.** No spec failed in a timeout-shaped way and
no re-run was needed. `enrollment.node.test.ts`, which spawns eleven agent processes, ran
in 8.64 s and passed all seven cases.

## What the plan got wrong

1. **"No wire change anywhere in this plan" is false.** `EnrollmentRefusal` crosses the
   wire; adding a kind to it is a wire change by construction. `protocol.ts` and
   `enrol-protocol.test.ts` were opened. The plan named `protocol.ts` as 19-13's and
   untouched by this one; leaving it would have shipped a refusal the provider states and
   no peer can read.
2. **The synchronous proof's reddening cannot fire as written.** *"Reddened by making
   `record` return a promise: `tsc` refuses the serving branch's use"* — it does not.
   `enrol` still returns a value and the write becomes a floating promise. Measured, and
   the mutation that *does* hold the argument (`async enrol`, refused at `agent.ts:724`)
   is now recorded at the case.
3. **Task 1's `<verify>` asks for `tsc` exit 0 at a point where it cannot be 0.** Making
   `maxIssuedPerWindow` required breaks 24 sites, and Task 2's own action says so. The
   fan-out was done once, in Task 2. `tsc` was red across exactly one commit boundary.
4. **The `every issuance is recorded` reddening predicts a split that does not exist.**
   One `record(userKey, at)` call writes both views, so "record only in `#history`" cannot
   leave the per-user assertion green and the aggregate empty. Dropping the call was
   planted instead — and it reddens **12** cases, not two, because the per-user window
   depends on the same write.
5. **22 sites across 14 files is now 26 across 18.** Wave 1's four new sites, which the
   plan could not have counted.
6. **`files_modified` is missing five files that had to change**: `packages/net/src/protocol.ts`,
   `packages/net/src/protocol.test.ts`, `packages/core/src/executor/attesting-executor.test.ts`,
   `packages/core/src/job/verify.test.ts`, `packages/core/src/result-attestation.test.ts` —
   plus `packages/node/src/enrollment.node.test.ts` and `.planning/REQUIREMENTS.md` for
   prose the work falsified.

## The exposure, recorded rather than softened

Written into `enrollment.ts`'s header beside the cost paragraph, and into AUTH-04's row:

- `serveAgent` serves enrolment **unauthenticated**, so anyone who can dial a provider can
  consume its whole window at one `ed25519.keygen()` per attempt. Before the aggregate
  budget they could consume only *their own* user key's window. An attacker who does it
  also denies honest enrolment against that provider for the rest of the window.
- The architectural answer — trust pinned **per verifier**, several independent providers
  coexisting by construction, a starved one routed around — **is untested here.** Every
  fixture in this repository and the demo itself are single-provider, so the recovery is
  an argument and not a reading. *Unmeasured is not met* applies to a mitigation as much
  as to a mechanism.
- The phrase "mitigated by design" appears nowhere. No mitigation machinery was built: no
  proof-of-work at the enrolment frame, no authenticated enrolment, no per-peer quota.

## Scheduled arrivals, stated rather than left to be discovered

- **Both production tiers have no aggregate budget and no durable history.** They write
  the sentinels, each with a comment naming **Plan 19-07** as where the durable form
  arrives. The reading `enrollment.node.test.ts` takes — a second provider process has a
  fresh budget for the same user key — is therefore unchanged and still true.
- **The cross-process measurement is 19-07's.** What is measured here is the in-process
  form: two authorities over one host ledger, where the second already counts what the
  first issued, and the sentinel control beside it where it does not.
- **19-12 writes the mutation-ledger entry.** The pair and the observed signature are
  above.
- `trustAnchors`'s precedent is the state 19-07 has to reach for `issuance`: all 22 uses
  of its opt-out live in `*.test.ts` and `bin/agent.ts` has no off-switch at all.

## No blockchain

Nothing global was added or implied. There is no shared revocation list, no reputation
score, no consensus round and no append-only shared log. Revocation stays non-renewal on
the certificate's own clock, `certificateLifetimeMs` keeps its default, and the header
sends a reader who reaches for a global list back to `19-CONTEXT.md`'s constraint. The
aggregate budget is per provider, read from that provider's own host, and no two providers
have to agree on anything.

## Commits

| hash | subject |
|---|---|
| `5a0c9ac` | `test(19-05): twenty free keygens should meet a budget the requester cannot rotate` |
| `f36247b` | `feat(19-05): a second budget, on the one quantity an attacker cannot rotate` |
| `230242d` | `fix(19-05): a refusal the provider can state is a refusal the peer can read` |
| `dfa2259` | `test(19-05): a budget the authority holds is a budget a restart hands back` |
| `91d60f6` | `feat(19-05): neither budget lives in the authority's heap any more` |
| `7b53f9f` | `docs(19-05): name the mutation that actually holds the synchronous argument` |
| `59e93a7` | `docs(19-05): AUTH-04's reason no longer describes a Map that is gone` |

Shared working tree throughout: no branch created or switched, no `git add -A`, no
`git checkout --` for any restore, every path staged explicitly, and
`git status --porcelain` confirmed empty before each commit and after each mutation.
