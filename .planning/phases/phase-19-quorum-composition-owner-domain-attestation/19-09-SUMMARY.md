---
phase: phase-19-quorum-composition-owner-domain-attestation
plan: 09
subsystem: agent-binary, discovery-seam, owner-domain-attestation
tags: [AUTH-05, VER-08, VER-09, VER-10, sovereignty, cross-process, capability-chains]
requires:
  - "packages/core/src/enrollment.ts — resolveReplicaSets, CandidateSet.replicaSets (19-01)"
  - "packages/core/src/job/submit.ts — receiptFor and the sovereign gate (19-06)"
  - "packages/node/src/fabric-node.ts — attestResults composed at the factory (19-15)"
  - "packages/core/src/enrollment.ts — EnrollmentAuthority's required issuance ledger (19-05)"
provides:
  - "a node's owner id and its enrolled user key are one value, and a disagreement is exit 2"
  - "owner-domain and owner-attested read off a JobResult across real bin/agent.ts processes"
  - "a per-candidate capability supplier, without which discovery could authorise no sovereign placement"
  - "a re-measured MEASURED_NODE_SPANS taken at the highest load this history records"
affects:
  - "19-07 — inherits bin/agent.ts and the undischarged flag fold, now with a named successor"
  - "19-12 (mutation ledger) — eight find/replace pairs recorded below"
  - "AUTH-05 and VER-08 are ticked; VER-09 deliberately is not"
tech-stack:
  added: []
  patterns:
    - "a clearance may be derived from a signed statement; a trust anchor stays configuration"
    - "one submit closure, two candidate sets, so the two labels cannot come from two code paths"
    - "a disagreement between two configured identities is refused, never resolved by precedence"
key-files:
  created:
    - packages/node/src/owner-domain-agents.node.test.ts
  modified:
    - packages/node/src/bin/agent.ts
    - packages/net/src/discover-candidates.ts
    - packages/node/src/sovereignty-placement.node.test.ts
    - packages/node/src/requirements-ledger.node.test.ts
    - vitest.config.ts
    - .planning/REQUIREMENTS.md
    - .planning/phases/phase-19-quorum-composition-owner-domain-attestation/deferred-items.md
decisions:
  - "the owner id is derived from --user-key; a passed --owner-id that disagrees is exit 2 naming both"
  - "--owner-key is deliberately NOT derived: defaulting a trust anchor would turn a safe refusal into an acceptance"
  - "CandidateOptions.dispatch takes the node id, because a chain's audience is one node's key"
  - "both arms in one test over one fixture, so the two labels are one expression on two inputs"
  - "AUTH-05 and VER-08 ticked; VER-09 left open because its display half is 19-11"
metrics:
  duration: ~1h05m
  completed: 2026-08-03
---

# Phase 19 Plan 09: One owner, two processes, and a label that says so — Summary

A sovereignty-pinned shard is placed from a **discovered** candidate set onto two
`bin/agent.ts` processes enrolled under one user key, both execute it, the outputs are
compared, both nodes sign what they produced, and the receipt `submitJob` builds from those
checked signatures reads **`owner-domain`**. One process is then stopped and the identical
submission reads **`owner-attested`**. Neither reads `independent`, and a third owner's node
that holds the same block is excluded by name and demonstrably ran nothing.

## What was built

### Task 1 — a node's owner is the user it enrolled under

**Commit:** `60a4204`

`bin/agent.ts` derives `FabricNodeOptions.sovereignty.ownerId` from `--user-key` through
`identityFromSeed`, whose own docblock pins the property that makes it the right call: its
`nodeKey` is `toHex(ed25519.getPublicKey(seed))`, *byte for byte* the derivation
`requestEnrollment` uses to fill `NodeCertificate.userKey` from the same private key. There is
one derivation, so the binary and the provider's signature cannot disagree — rather than two
kept in step. (`@noble/curves` is not a declared dependency of `@o2/node`, so deriving it a
second way here would also have been the second source of truth this repository keeps
refusing.)

A `--owner-id` that disagrees with the derived key is **exit 2 naming both values**. Not a
precedence rule: whichever value won, the loser's operator would get a node that starts,
serves every peer, and is cleared for an identity nothing in the fabric will ever ask about —
the exact silent stall AUTH-05 closes, relocated from discovery time to configuration time and
made *harder* to see. An equal value is accepted, so every existing spawn is unaffected.

`--owner-id` survives for a node that does not enrol; it is the only way to clear one, and
every spawn in the repository that uses it (`sovereignty-placement`, `egress-refusal`,
`capability-dispatch`) passes it *without* `--provider-addr`, so none of them changed.

The two comments recording this as open were **corrected, not deleted**:
`discover-candidates.ts`'s sovereign-seam paragraph now says what closed and what deliberately
did not, and `sovereignty-placement.node.test.ts`'s note points at the file that exercises the
path it does not — and says why its own fixture is right to keep the operator label.

### Task 2 — two of one owner's nodes agree, sign, and the receipt says whose

**Commit:** `23b9e2c`

`packages/node/src/owner-domain-agents.node.test.ts`. One spawned provider; two agents enrolled
under the **same** `--user-key` file with the **same** `--operator-id`, both
`--can-execute-sovereign`, both with **no `--owner-id`** (the derived case); a third agent
enrolled under a different user key with the identical treatment, so the only thing separating
it is whose data it is cleared for. One in-process requestor.

Both submissions go through **one closure** whose only varying argument is the candidate set
discovery returned — 19-08's technique — so `owner-domain` and `owner-attested` are
demonstrably one expression reading two node sets.

Readings, in order:

- three providers, two qualified, the third excluded `not-cleared-for-owner` **by name**, its
  `nodeKey` and the owner's user key both asserted in the exclusion
- `replicaSets` holds **one** set (taken over the qualified set, so the excluded node is not in
  it), two certificates, `canVerifyWithinOwnerDomain` true, both operator ids equal
- every discovery-derived descriptor's `ownerId` **is** the user key — the unification made
  literal, since that is what the shard pins to
- Arm A: `agreed` on exactly the owner's two peer ids; **both agreeing entries carry a real
  attestation**, asserted *before* the strength; `owner-domain`, `replicas: 2`, `operators:
  ['harbour-ops']`, `userKeys: [ownerKey]`, description containing *"not across operators"*;
  `strength !== 'independent'` asserted directly; `quorum.kind === 'not-attempted'`,
  `degraded: false`, `job.complete: true`
- between the arms: the second owner process is stopped and **asserted dead** before anything
  is submitted, and the requestor is waited on until it drops the peer — an arm that read
  `owner-attested` because a node was merely slow would be measuring latency
- Arm B: one executor, `canVerifyWithinOwnerDomain` now false on the same field,
  `owner-attested`, `replicas: 1`, description containing *"not independently verified"*,
  `degraded: true`, `job.complete: false`
- the third owner's node, read from **its own store** after it is stopped: it does not hold the
  module (so it ran nothing) and does hold the input (so the store is readable and the reading
  is not vacuous)

Fixture seeds taken: publisher **67**, user keys **0xb7** / **0xb8**, checked against the
repository's whole census first.

Phase 13's constraint governs the fixture rather than decorating it: the row is written into
both owner agents' `--dir` through `FsBlockstore` **before** the spawn, because `EgressGuard`
will not move a registered sovereign payload between nodes — including two nodes one owner
controls — and a node that has executed a sovereign task keeps withholding its CID afterwards.

## Two interface claims measured, and one of them was false

### The plan predicted `unplaceable`; the stall is one step later and louder

The plan's proof list said that removing Task 1's derivation would make Arm A's shard
`unplaceable`. **Measured: it does not.** Two separate readings:

- **With the fixture unchanged** (no `--owner-id` at all), an enrolled agent falls back to
  `FabricNode`'s cleared-for-nobody default, publishes `sovereignFor: []`, and is excluded at
  *discovery*. `found.executors` is `[]` and the file reddens there.
- **With the pre-19-09 shape** — an operator label in `--owner-id`, which the binary accepts
  only once the refusal is also removed — `ownRecords` still publishes
  `sovereignFor: [certificate.userKey]`, because it reads the **certificate** and not
  `sovereignty.ownerId`. So discovery qualifies both nodes, placement places the shard on both,
  and both refuse at dispatch:

```
{"status":"insufficient","reason":"every executor failed","failures":[
  {"nodeId":"12D3KooWKAV3…","reason":"unauthorized: task names owner 7b242f97…, but this node is pinned to owner harbour-ops"},
  {"nodeId":"12D3KooWKFAK…","reason":"unauthorized: task names owner 7b242f97…, but this node is pinned to owner harbour-ops"}]}
```

That is the stall `discover-candidates.ts` describes, and it is `insufficient` rather than
`unplaceable` because Plan 19-01 put the certificate on the descriptor: placement now matches
on a value the *provider* signed, so it succeeds and the node's own local clearance is what
disagrees. The prediction was written before that landed. Recorded here rather than in a
comment, because the plan is the artifact that was wrong.

### `discoverCandidates` could authorise no sovereign placement at all — Rule 2

`CandidateOptions.dispatch` was a bare `CapabilitySupplier`, handed to **every**
`RemoteExecutor` the helper builds. A chain's audience is one node's key — `verifyChain`
refuses another's with `wrong-audience`, and `RemoteExecutor`'s own docblock says so — so one
supplier could authorise at most one candidate in a set. Both node factories install
`authorizeCapability`, which refuses every sovereign task without a valid chain whether or not
an owner key is pinned. **So there was no path by which discovery could place an authenticated
sovereign shard**, on any production node, and `tsc` was clean and every test green over it
because every caller passes `'dispatches-unauthenticated'` and a public task returns `[]`.

Fixed under Rule 2, in the one file this plan already owns: `dispatch` is now
`((nodeId: string) => CapabilitySupplier) | 'dispatches-unauthenticated'`. Every existing call
site passes the sentinel and is unchanged; a caller with one chain for everybody writes
`() => supplier`. The plant that reverts it to a shared supplier takes Arm A to **one**
agreeing replica — the one whose audience the shared chain happened to name.

What this does **not** close is filed as deferred item 5: no runnable entry point mints a chain,
so the requestor half of AUTH-03 stays spec-only. That is the same gap `SCHED-05`'s row names
from the placement side, and the two should close together.

## The plants, with find/replace pairs for Plan 19-12

Every plant was restored by `cp` + `cmp` (exit 0 each time) and never by `git checkout --`.
`git diff --stat` over the five touched paths was empty after each restore pass.

| # | file | find | replace | observed |
|---|---|---|---|---|
| P1 | `core/src/quorum.ts` | `if (agreeing.length <= 1) return 'owner-attested'` … `if (operators.size >= 2) return 'independent'` | `… return 'independent'` … `if (operators.size >= 1) …` | **RED, Arm A**: `expected 'independent' to be 'owner-domain'` |
| P1b | same plant, Arm A's three label assertions scratched | — | — | **RED, Arm B**: `expected 'independent' to be 'owner-attested'`. Both arms move under one plant — the evidence that one expression produces both labels |
| P2 | `core/src/executor/attesting-executor.ts` | the `attestation: signResult(attestor, {…})` return object | `attestation: 'signed-by-nobody' as const` | **RED** at the sentinel assertion |
| P2b | same plant, sentinel assertion scratched | — | — | **RED** at the receipt, and it falls to `{"kind":"holds-no-verified-attestation",…,"agreeing":2,"verified":0}` naming *both* replicas — a named absence, not a weaker label |
| P3 | `owner-domain-agents.node.test.ts` | `enrol('n3', THIRD_PRIVATE_KEY, THIRD_USER_KEY, …)` | `enrol('n3', OWNER_PRIVATE_KEY, OWNER_USER_KEY, …)` | **RED at the fixture guard**, naming the substitution before anything downstream reads it |
| P3b | same plant, fixture guard scratched | — | — | `{"executors":3,"excluded":0,"replicas":3}` — the third node joins the replica set and the exclusion cannot be read. The set is a **selection** |
| P3c | same file | `foreignStore.put(encoded.bytes)` | deleted | **RED**: `expected 2 to be 3` on `providers`. Unseeded, the third node never appears at all — which is why it holds the block |
| P4 | same file | `await stopAgentNow(n2)` + the drop wait | deleted (with four intermediate assertions scratched) | **RED**: `expected 'owner-domain' to be 'owner-attested'`. Arm B is not a slow Arm A |
| P5a | `node/src/bin/agent.ts` | `const ownerId = enrolledOwnerId ?? values['owner-id']` | `const ownerId = values['owner-id']` | **RED**: `expected [] to strictly equal […(2)]` — discovery qualifies nobody |
| P5b | same, plus the refusal block deleted and the fixture passing an operator label | — | — | **RED**: `insufficient`, both nodes answering `unauthorized: task names owner 7b24…, but this node is pinned to owner harbour-ops`. The silent stall, reproduced |
| P6 | `net/src/discover-candidates.ts` | `options.dispatch(peerId)` per candidate | one supplier memoised across the set | **RED**: one agreeing replica instead of two. The per-node mint is load-bearing |

### What is NOT guarded here, stated rather than left to be assumed

- **The signatures themselves.** One assertion says every agreeing replica carries a real
  attestation; verifying one against a stranger's pinned key is `result-signature.node.test.ts`'s
  job. Duplicating it here would be two files measuring one thing and neither measuring the other.
- **The egress manifest.** Nothing can reach into a spawned process's `EgressGuard`. VER-08's
  *no data leaves the owner's trust domain* clause is carried here by placement and by the third
  node's empty store; the manifest half is `sovereign-execution.test.ts`'s and
  `egress-manifest.node.test.ts`'s, in process.
- **`sovereign-execution.test.ts` needed no edit.** It passes unaltered, which is the outcome the
  plan asked for — its receipt is built by the spec over *whoever the owner enrolled*, and this
  file's comes off a `JobResult` derived from *whoever ran and signed*. The two readings agree,
  which is worth more than either alone.

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 2 — missing correctness] `CandidateOptions.dispatch` could not express a per-node chain**

- **Found during:** Task 2, writing the fixture's capability supplier
- **Issue:** see above — the sovereign discovery path was unreachable on any production node
- **Fix:** `dispatch` takes the node id and returns the supplier; the chain is minted for the
  same peer id the executor dispatches to and the descriptor is keyed on
- **Files:** `packages/net/src/discover-candidates.ts` (already in this plan's declared set)
- **Commit:** `23b9e2c`

**2. [Rule 3 — blocking] The span table had to be re-measured in full**

- **Found during:** verification
- **Issue:** the new file measures **6 405 ms**, above `SLOW_CUTOFF_MS`, so it must be excluded
  from `test:unit`. `MEASURED_NODE_SPANS`'s docblock forbids pasting one entry from another run
  — *"its whole worth is that it is one run somebody can reproduce"*
- **Fix:** full re-measurement, 2026-08-03: 136 files / 1891 tests **green**, sum-of-spans
  696.4 s against 262.6 s wall clock, 35 files at or above the cut. `test:unit` observed
  **directly** at 101 files / 1576 tests / 9.25 s on a green run
- **The load is the honest caveat and it is recorded at the field:** polled every 40 s,
  13.43 → **59.60** → 23.67, the highest peak in that history, because a second agent was
  running its own suites on the same host throughout. Left as measured: over-excluding is the
  cheap direction, and a contended run is a *worse* case than a quiet one
- **A reading worth keeping:** `churn.test.ts` now reads **exactly 1 000 ms** — on the cut —
  after 1 134 and 962 in the two runs before it, and nothing about it changed. Two files crossed
  up and one down, so the count moving 34 → 35 is *not* "the new file was added"
- **Files:** `vitest.config.ts`
- **Commit:** `db70dd3`

**3. [Rule 3 — blocking] Ticking two requirements meant editing the guard that reads them**

- **Issue:** `requirements-ledger.node.test.ts` asserts `WITHOUT_A_CHECKABLE_CLAIM` is *exactly*
  the set of unreached rows carrying no checkable claim. AUTH-05 and VER-08 were added to it by
  19-15 one day earlier — when composing `attestResults` made their previous claim false — and
  moving them to `Done` takes them out of the unreached population, so the set equality fails
  unless both are removed in the same commit
- **Fix:** both removed, and the docblock records the one-day lifecycle rather than deleting the
  entry silently. The rule it already stated now has its mirror written down: *a row losing its
  checkable claim by being satisfied must be added in the same commit as the correction, and
  removed in the same commit as the tick*
- **Files:** `packages/node/src/requirements-ledger.node.test.ts`, `.planning/REQUIREMENTS.md`
- **Commit:** `5c6a1ec`

### Deliberate departures from the plan's letter

- **Both arms live in one `it`, not two.** The plan asked for one file; one test over one
  fixture is what makes "the same task with one node stopped" literal and halves the process
  budget. The cost is that a plant reddening Arm A hides Arm B, so P1 was run twice — once
  plain, once with Arm A's label assertions scratched — and both readings are recorded above.
- **No `admit`.** The offer arm adds a failure mode without adding a reading either arm needs,
  and `sovereignty-placement.node.test.ts` already carries the sovereign offer loop.
- **`--owner-key` is not derived.** It would be tempting — once a node's clearance *is* its user
  key, the natural chain root is that same key — but defaulting it would silently pin every
  already-enrolling agent to an owner key it was never given, turning `authorizeCapability`'s
  "no pinned owner key" refusal into an acceptance nobody asked for. Stated at the flag.

## `bin/agent.ts`'s two carried-forward items, neither taken

- **The flag fold is still undischarged**, and its successor is now named in source: Plan 19-07
  (wave 7, `depends_on: ["05", "09", "15"]`) is the phase's last touch of this binary and the
  first with nothing behind it. This plan added no flag and still declined the fold, because
  handing 19-07 a rewritten `parseArgs` object to rebase onto buys nothing it asked for.
- **Deferred item 2 is untouched and still open.** `bin/agent.ts` still cannot produce a
  `via-relay` node — `port` defaults to `'0'` and the listen list is passed unconditionally — so
  `composeQuorum`'s rule 2 still has no across-process reading. This plan's work never needed a
  relayed agent, and the brief said not to take it on speculatively. It remains 19-07's or a
  later phase's, in the same fold.

## The known flake, observed and not chased

`packages/node/src/reservation-exhaustion.node.test.ts` (defect #33, ~20 % on a byte-identical
tree) **did not fire** in either full node run taken for this plan — it passed in the
`--reporter=json` measurement run at 6 070 ms and again in the final verification run. Nothing
was adjusted, no timeout raised, no load gate added. There is no stderr text for agent `b` to
report, because the armed instrument never printed.

## Verification

| command | result |
|---|---|
| `npx tsc --noEmit` | **exit 0** |
| `npx vitest run --project node packages/node/src/owner-domain-agents.node.test.ts packages/net/src/sovereign-execution.test.ts packages/node/src/slow-specs.node.test.ts` | **exit 0** — 3 files, 17 tests |
| `npx vitest run --project node packages/node/src/sovereignty-placement.node.test.ts packages/node/src/trust-anchors.node.test.ts packages/net/src/discover-candidates.test.ts` | **exit 0** — 3 files, 38 tests |
| `npx vitest run --project node --reporter=json` (the measurement run) | **exit 0** — 136 files, 1889 passed, 2 skipped, 262.6 s wall |
| `npm run test:unit` | **exit 0** — 101 files, 1575 passed, 1 skipped, 9.25 s |
| `npx vitest run --project node` (final) | **exit 0** — 136 files, 1889 passed, 2 skipped |

Every exit code was read with `EXIT=$?` on the line immediately after the command it reads,
never through a pipe.

## Running beside another executor, and what it cost

Plan 19-04 ran concurrently on this one checkout throughout. Nothing was lost and nothing of
theirs was staged: every `git add` named my own paths, every plant restore was `cp` + `cmp`, and
no `git stash`, `git clean`, `git checkout --` or branch switch was run at any point. Two of
their files (`serve-agent-hooks.node.test.ts`, `sovereign-block-refusal.node.test.ts`) appeared
as modified mid-session and were left alone.

Two shared paths were unavoidable and are named: `.planning/REQUIREMENTS.md` and
`packages/node/src/requirements-ledger.node.test.ts`. Both were edited **last**, in one commit,
with the pre-commit guard re-run over the result — which is the mechanism that would catch a
collision in the header arithmetic if 19-04 had touched the same numbers. It did not; the WIRE
rows live in the v1.1 section, which the header's counts deliberately exclude.

The measurement run's load peak (59.60) is the visible cost of the overlap, and it is recorded
at the field rather than smoothed away.

## What this does not establish

- **A signature is not correctness.** It says a certified node computed this output.
  `executeVerified`'s N-version comparison is the only thing here that says the answer is right.
- **The requestor half of AUTH-03 is still entry-point-unreachable.** Deferred item 5.
- **VER-09 is deliberately NOT ticked.** Its `owner-attested` reading is closed here and on the
  CLI (19-10), but the requirement says *wherever it is displayed*, and the demo UI is 19-11.
  Ticking it would put a false checkbox in a ledger this repository guards.
- **VER-10 is not ticked either**, for the same reason and by 19-10's own account: the demo UI
  is open. This file asserts `strength !== 'independent'` on both arms, which is that
  requirement's content, but the display half is not its.
- **Rule 2's cross-process reading.** Deferred item 2, unchanged by this plan.

## Self-Check: PASSED

- `packages/node/src/owner-domain-agents.node.test.ts` — FOUND
- `packages/node/src/bin/agent.ts`, `packages/net/src/discover-candidates.ts`,
  `packages/node/src/sovereignty-placement.node.test.ts`,
  `packages/node/src/requirements-ledger.node.test.ts`, `vitest.config.ts`,
  `.planning/REQUIREMENTS.md`, `deferred-items.md` — FOUND
- `60a4204`, `23b9e2c`, `db70dd3`, `5c6a1ec`, `13dbeea` — FOUND in `git log`
- no commit in this plan deletes a tracked file (`git diff --diff-filter=D` empty on all five)
- working tree clean after every plant restore (`cp` + `cmp` exit 0, `git diff --stat` empty
  over the five touched paths)
- `.planning/STATE.md` and `.planning/ROADMAP.md` **not** touched, per the executor brief
