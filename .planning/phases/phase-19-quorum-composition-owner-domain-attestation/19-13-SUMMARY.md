---
phase: phase-19-quorum-composition-owner-domain-attestation
plan: 13
subsystem: verification
tags: [attestation, ver-08, ver-09, ver-10, signing, ed25519, ports, wire, executor]

requires:
  - phase: phase-17
    provides: "`NodeCertificate`, `EnrollmentAuthority` and `verifyCertificate`'s four named refusals — leg 2, which leg 3 verifies against"
  - phase: phase-14
    provides: "`guardModuleProvenance` — leg 1, and the wrapper shape leg 3 copies"
  - phase: phase-11
    provides: "WIRE-01's required-with-named-sentinel convention, applied here to `ExecutionOutcome`"
provides:
  - "`resultChallenge` and `combineChallenge` — the two things this fabric signs, in one file"
  - "`signResult` / `verifyResultAttestation` — a statement a third party holding only the provider's public key can check, refused by name in three distinguishable ways"
  - "`ExecutionOutcome`'s ok arm carrying `attestation: ResultAttestation | 'signed-by-nobody'`, required, across 33 sites in 16 files"
  - "`attestResults` — the wrapper, composed nowhere until 19-15"
  - "the exec reply carrying an attestation byte-exact, or refusing the frame"
affects:
  - "19-14 — `VerificationResult.agreeing` reads what `runOne` now carries on its internal `Receipt`"
  - "19-15 — composes `attestResults` at `fabric-node.ts` and `browser-node.ts`"
  - "19-16 — consumes `combineChallenge`, which has no caller yet"

tech-stack:
  added: []
  patterns:
    - "A required union with a named sentinel, never an optional — proved necessary by measurement, not asserted: the optional form leaves `tsc` at exit 0 while the behavioural assertion fails"
    - "A refusal forwarded rather than re-implemented keeps the four names `verifyCertificate` already gives, on `ModuleRefusal`'s `unresolvable` pattern"
    - "A sequence is encoded in the order it happened; only a set is sorted. `payloadOf` sorting `relayIds` is right there and wrong here"
    - "`tsc` enumerates constructions but not value comparisons: three `toEqual` sites on an outcome were invisible to the compiler and were found by running the specs"

key-files:
  created:
    - packages/core/src/result-attestation.ts
    - packages/core/src/result-attestation.test.ts
    - packages/core/src/executor/attesting-executor.ts
    - packages/core/src/executor/attesting-executor.test.ts
  modified:
    - packages/core/src/ports.ts
    - packages/core/src/index.ts
    - packages/core/src/job/verify.ts
    - packages/net/src/protocol.ts
    - packages/net/src/protocol.test.ts
    - packages/core/src/executor/wasm.ts
    - packages/core/src/executor/worker-executor.ts
    - packages/core/src/executor/task-run.ts
    - packages/aot/src/wasi-executor.ts

key-decisions:
  - "The plan's claim that `nodeKey` inside the challenge binds a statement to its signer is FALSE, and was measured false. Deleting the field leaves the A-signature-under-B's-certificate case green — Ed25519 verification under `certificate.nodeKey` already refuses it. The field is kept, its docblock corrected, and a case added that reads what it does buy: two replicas of one shard sign different bytes."
  - "The plan's reddening for the check order could not fail either. With a good signature a signature-first verifier does not return early, so it falls through and reports `untrusted-certificate` anyway. The order is observable only when both questions fail, and a case for that was added."
  - "The attestation is 612 DAG-CBOR bytes, measured, not the ~300 the plan estimated. Three 64-char hex keys and two 128-char hex signatures, stored as text. Still under 4% of a 16 KiB WebRTC message."
  - "A third named refusal, `not-attested`, covers the sentinel arm — so the verifier is total over exactly the type the port carries. The plan's third question (the challenge is rebuilt from the caller's own data) is structural and cannot fail, so it has no refusal of its own."
  - "`'signs-nothing'` composes to the identity and returns `inner` unchanged, rather than a wrapper forcing the sentinel. A node saying it signs nothing has said nothing about what an inner adapter already signed."
  - "The sentinel crosses the wire as the type's own literal, not a `found:`-style discriminant. Those model nested-or-absent; this is a first-class named state."
  - "`WorkerTaskResponse` deliberately does not widen. A thread has no identity and signing material has no business crossing a postMessage boundary."

requirements-completed: []
duration: one session
completed: 2026-08-03
---

# Phase 19 · Plan 13 — The third leg, and two of the plan's own proofs that could not fail

Two of the three signing legs already existed. The code a node runs is signed by its
publisher; the node's certificate is signed by its provider; the **result** was signed by
nobody, so agreement was attested by transport authentication alone — Noise proves peer X
sent this frame, and that proof is not transferable.

This plan built the third leg and wired none of it, deliberately. It also found that two
of its own named reddenings do not redden, which is the more useful half of the output.

## What changed

| file | what |
|---|---|
| `packages/core/src/result-attestation.ts` | new — both challenges, the signature, its verification, three named refusals |
| `packages/core/src/executor/attesting-executor.ts` | new — `attestResults`, composed nowhere until 19-15 |
| `packages/core/src/ports.ts` | `ExecutionOutcome`'s ok arm gains `attestation`, required |
| `packages/core/src/job/verify.ts` | `runOne` carries it onto the internal `Receipt`; not on `VerificationResult` — that is 19-14 |
| `packages/net/src/protocol.ts` | the exec reply encodes and parses it field by field, or refuses |
| `wasm.ts`, `worker-executor.ts`, `wasi-executor.ts` | report the sentinel, and say in their own source why |
| `task-run.ts` | `WorkerTaskResponse` documented as deliberately not carrying one |
| 12 spec files | one property each, subject unchanged |

**The fan-out was 33 sites across 16 files**, against the plan's measured 41 across 20.
The difference is reads counted as constructions — `verify.ts` and `protocol.ts` each
*read* `fuelUsed` at sites that never build an outcome, and `task-run.ts` builds a
`WorkerTaskResponse` rather than an `ExecutionOutcome`.

**`tsc` did not enumerate everything, and the plan said it would.** Three sites in
`sovereignty-guard.test.ts` compare an outcome by value with `toEqual`. They compile
clean and fail at runtime. The plan's instruction — *"`npx tsc --noEmit` enumerates them;
a grep does not"* — is true of constructions and false of value comparisons; a grep would
in fact have found these three. They were caught by running the specs.

## The two proofs that could not fail

The prompt asked for every proof to be observed. Two were, and could not be.

### `nodeKey` in the challenge does not bind the statement to its signer

The plan: *"Reddened by dropping `nodeKey` from the challenge: B's certificate plus A's
signature verifies, and one honest node's work counts as several nodes'."*

Deleted the field. **All 14 cases stayed green**, including the one presenting node A's
signature under node B's certificate. The reason is that `verifyResultAttestation`
verifies under `certificate.nodeKey`, so a signature made with A's seed cannot check
under B's key whatever bytes were signed — Ed25519's own key binding does that work, and
the challenge field does not.

The field is kept: it makes two replicas of one shard sign **different bytes**, so an
attestation is self-describing rather than meaningful only in company with the
certificate it travels with. That reading is now its case, and deleting the field fails
it. The module docblock states the correction, and notes that `possessionChallenge`
carries `nodeKey` under exactly the same conditions — the same correction applies there.

### The check order is invisible unless both questions fail

The plan: *"Reddened by checking the signature first and returning early … even though
the result signature itself is perfectly good."*

Moved the signature check above the certificate check. **All 15 cases stayed green.** A
signature-first verifier does not return early on a signature that *passes* — it falls
through and reports `untrusted-certificate` anyway. The order changes the answer only
when both fail, and there the argument is real and worth keeping: verifying a signature
under a key taken from a certificate nobody vouched for is checking nothing, so calling
that `bad-result-signature` accuses a peer of forging with a key this verifier never had
reason to associate with it.

A case for the both-fail shape was added, and the reorder then reddens it.

## Mutation readings observed

Every one planted by hand, restored with `cp` + `cmp` (exit 0 each time), and re-run
green afterwards.

| # | mutation | file | reading |
|---|---|---|---|
| M-A | drop `partitionIndex` from `resultChallenge` | `result-attestation.ts` | **RED** — 2 failed / 12 passed. Partition 0's signature verifies against partition 1; the distinguishability case reports `accepted` where it expected `bad-result-signature` |
| M-B | drop `outputCid` | `result-attestation.ts` | **RED** — 1 failed / 13 passed, *does not verify against a different answer* |
| M-C | drop `nodeKey` | `result-attestation.ts` | **GREEN — the plan's proof could not fail.** See above |
| M-C2 | drop `nodeKey`, against the corrected reading | `result-attestation.ts` | **RED** — 1 failed / 14 passed, *gives two nodes different bytes to sign* |
| M-D | check the signature before the certificate | `result-attestation.ts` | **GREEN — the plan's proof could not fail.** See above |
| M-D2 | same reorder, against the both-fail case | `result-attestation.ts` | **RED** — 1 failed / 15 passed |
| M-E | sign `task.inputCid` instead of the inner's output CID | `attesting-executor.ts` | **RED** — 1 failed / 7 passed; verification names the signature |
| M-F | make the signer optional and omit it at the call site | `attesting-executor.ts` | **`tsc` exit 0**, vitest **RED** 1 failed / 7 passed. 19-01's finding reproduced exactly: the type system alone does not catch it |
| M-G | derive `nodeId` from the certificate | `attesting-executor.ts` | **RED** — 1 failed / 7 passed, *keeps the inner executor node id* |
| M-H | kernel executor stops reporting the sentinel | `worker-executor.ts` | **RED** — 1 failed / 7 passed, *reports the sentinel from WorkerExecutor's own outcome* |
| M-I | malformed attestation degrades to the sentinel | `protocol.ts` | **RED** — 2 failed / 17 passed |
| M-J | drop `relayIds` from the encoded certificate | `protocol.ts` | **RED** — 3 failed / 16 passed; the round-trip case names the field |

M-F is the load-bearing one. It is the reading the prompt asked for in advance and it
came out exactly as predicted: `tsc --noEmit` exit **0** while the behavioural assertion
failed. A required union with a named sentinel is not a stylistic preference here.

M-J deserves its note: `relayIds` is the field `payloadOf` sorts when it signs a
certificate, so a drop in the encoder would have surfaced downstream as an unexplainable
`bad-signature` against a node that did nothing wrong.

## Commands run, with real exit codes

`EXIT=$?` on the line immediately after each command, never through a pipe.

| command | exit |
|---|---|
| `npx tsc --noEmit` (final) | **0** |
| `npx vitest run --project node packages/core/src/result-attestation.test.ts packages/core/src/enrollment.test.ts` | **0** — 34 tests |
| `npx vitest run --project node packages/core/src/executor/attesting-executor.test.ts` | **0** — 8 tests |
| `npx vitest run --project node packages/net/src packages/core/src/executor packages/core/src/job` | **0** — 34 files, 397 tests |
| `npx vitest run --project node packages/net/src/protocol.test.ts …/remote-executor-contract.test.ts …/agent-contract.test.ts …/distributed.test.ts` | **0** — 60 tests |
| `npx vitest run --project node packages/aot/src/wasi-executor.test.ts` | **0** — 121 tests |
| `npx vitest run --project browser packages/browser/src/visibility-governor.test.ts` | **0** — 33 tests |
| `npx vitest run --project node` × the five cheap guards | **0** — 141 tests |

The six cheap guards — vocabulary, purity, mutation-ledger, disclosure, requirements-ledger,
slow-specs — also ran on **each of the three commits** through the pre-commit hook, and
passed each time.

**No timing was recorded and no timeout was added or tuned**, per the host constraint. No
wall-clock assertion exists anywhere in the code this plan added, and the module says so
at the place a later reader would be tempted to add one.

## What was not run, and why

The plan's overall verification asks for `--project node` and `--project browser` **in
full**. Neither was run: the host was carrying a large foreign build and a second executor
was working a different plan in the same tree, and the instruction was to run only the
files this plan names, project-scoped. Everything the plan lists as load-bearing was run
and passed. The unrun remainder is the ~90 node files this plan does not touch, and
`tsc --noEmit` at exit 0 covers every construction site in them.

**Nothing was found unresolvable under load.** No spec failed in a timeout-shaped way and
no re-run was needed.

## What the plan got wrong

1. **`nodeKey` in the challenge is not the signer binding.** Stated as a fact, measured
   false. Corrected in the module and in the spec.
2. **The check-order reddening could not fire** in the shape the plan described. The
   underlying decision is right; the proof was pointed at a case that cannot distinguish
   it.
3. **The attestation is 612 bytes, not ~300** — low by a factor of two. The arithmetic is
   unavoidable rather than sloppy, and the corrected figure is recorded in both
   `result-attestation.ts` and at the parse in `protocol.ts`.
4. **`tsc` does not enumerate value comparisons.** 33/16, not 41/20, and three runtime-only
   sites the compiler could not see.
5. **The plan asks for "a distinct named refusal per question" for three questions, but
   only two of its questions can fail.** The third — the challenge being rebuilt from the
   caller's own task and output — is structural: `verifyResultAttestation` takes `work`
   as an argument and the attestation carries no copy of it, so there is nothing to
   refuse. `not-attested` was made the third name instead, covering the sentinel arm, so
   the verifier is total over exactly the type `ExecutionOutcome` carries.

## Scheduled arrivals, stated rather than left to be discovered

- **Nothing composes `attestResults`.** 19-15, at `fabric-node.ts` and `browser-node.ts`,
  with the textual guard in `trust-anchors.node.test.ts` that leg 1 already has. The
  wrapper's own header says this and says it is the defect if it is still true afterwards.
- **Nothing reads the attestation.** 19-14 makes `VerificationResult.agreeing` carry it.
- **`combineChallenge` has no caller.** 19-16 builds the combine wire.
- **Every executor in the tree reports `'signed-by-nobody'` today**, so no observable
  behaviour of a running fabric changed. No spec's behaviour changed either — only its
  literals.

## No blockchain

Nothing global was added. Revocation stays non-renewal on the certificate's own clock,
trust stays pinned per verifier, and `verifyResultAttestation` takes its trust anchors as
an argument and has nothing to reach out to. The replay property is stated honestly in
the module: an attestation is valid forever for its `(work, output, node)` triple, which
is what makes it transferable, and freshness — if a later phase needs it — is the
certificate's `expiresAt` rather than a nonce.

## Commits

| hash | subject |
|---|---|
| `f6212f9` | `feat(19-13): a node can sign its result, and a stranger can check it` |
| `4d4ac90` | `feat(19-13): every executor now states whether it signs, and the kernel's do not` |
| `534d8b9` | `feat(19-13): the attestation crosses the exec reply, or the frame is refused` |

Two commits by the other executor working 19-02 landed between them; the branch was left
clean, no branch was created or switched, and nothing outside this plan's file list was
staged.
