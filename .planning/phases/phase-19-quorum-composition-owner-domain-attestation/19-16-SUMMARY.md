---
phase: phase-19-quorum-composition-owner-domain-attestation
plan: 16
subsystem: verification
tags: [attestation, ver-08, ver-09, ver-10, reduce, combine, wire, agent-options, ed25519]

requires:
  - phase: phase-19
    provides: "19-13's `combineChallenge`, `ResultAttestation`, `AttestedResult` and its named sentinel — the encoding this plan consumes rather than redefines"
  - phase: phase-17
    provides: "`NodeCertificate`, `EnrollmentAuthority`, `verifyCertificate` and its four named refusals — leg 2, which leg 3 verifies against"
  - phase: phase-16
    provides: "the combine verb, its capacity bound, and the recorded reasoning that a combine's inputs are public map outputs"
  - phase: phase-11
    provides: "WIRE-01's required-with-named-sentinel convention, applied here to the eighth `AgentOptions` hook"
provides:
  - "`CombineProduct` — a combine's result and its producer's statement, travelling together from the dispatch to `ReduceOutcome`"
  - "`ReduceOutcome.attestations` — tree node id → what that combine's producer signed, beside an untouched `executedBy`"
  - "`signCombine` / `verifyCombineAttestation` — the sign/verify pair for the challenge 19-13 defined and left callerless"
  - "`AgentOptions.attest` — one required signing identity per node, for both verbs, proved required at compile time"
  - "the combine reply carrying the statement byte-exact, or refusing the frame"
  - "`combine-signature.node.test.ts` — every combine in a real two-level tree checked against the provider's published key alone"
affects:
  - "19-15 — replaces `attest: 'signs-nothing'` at `fabric-node.ts` and `browser-node.ts` with real signers; the two bench rigs keep theirs"
  - "19-17 — the aggregate receipt, built by verifying the attestations this plan carries"
  - "19-12 — nine mutation readings recorded below, with find/replace pairs and observed text"

tech-stack:
  added: []
  patterns:
    - "A widened return type is where recorded distinctions get flattened; `null` and `LocalStoreWriteFailed` each keep exactly one meaning, asserted"
    - "A sequence is signed in the order it happened; only a set is sorted. `payloadOf` sorting `relayIds` is right there and wrong here"
    - "A required union with a named sentinel, never an optional — measured again here at `tsc` exit 0 with every behavioural spec green"
    - "`tsc` enumerates constructions, not readers — and a concurrent executor's type errors in the same file MASK your own, which is a new way for the worklist to be short"
    - "A property that lives in an encoder is structural: the combine refusal arm has nowhere on the wire to put a signature, which is stronger than a runtime check"

key-files:
  created:
    - packages/node/src/combine-signature.node.test.ts
  modified:
    - packages/core/src/reduce.ts
    - packages/core/src/reduce.test.ts
    - packages/core/src/result-attestation.ts
    - packages/core/src/index.ts
    - packages/net/src/combine.ts
    - packages/net/src/combine.test.ts
    - packages/net/src/combine-wire.test.ts
    - packages/net/src/protocol.ts
    - packages/net/src/agent.ts
    - packages/net/src/agent-contract.test.ts
    - packages/net/src/reduce-job.test.ts
    - packages/node/src/fabric-node.ts
    - packages/browser/src/browser-node.ts
    - packages/node/src/bin/bench.ts
    - packages/bench/src/perf-workload.ts
    - packages/node/src/serve-agent-hooks.node.test.ts
    - packages/node/src/mutation-ledger.ts
    - "17 further spec files — one sentinel each"

key-decisions:
  - "`result-attestation.ts` was modified, and it is not in the plan's frontmatter. 19-13 defined `combineChallenge` and no sign/verify pair for it, and `verifyResultAttestation` takes a `ResultWork` that a combine has no way to build. `signCombine` and `verifyCombineAttestation` were added beside their challenge rather than in a second module, and the three questions were factored into one private function so the order the module argues for is decided in one place."
  - "The wire field landed in Task 1's commit rather than Task 2's. `remoteCombineDispatch` cannot 'carry the attestation through unchanged' — Task 1's own stated behaviour — unless the reply has one, so the type, encode and parse moved a commit earlier. Task 2 kept what is actually its own: the hook, and the branch that signs."
  - "`reduce-job.test.ts:307`'s whole-object `toEqual` does not exist. The two `toEqual` sites in that file are on the `{ok:false, reason}` arm, which carries no `ReduceOutcome`, so an additive field did not break them. Nothing was loosened and nothing needed extending."
  - "`localCombineDispatch` does not exist; the function is `localDispatch` (`reduce.ts:547`). It returns the sentinel, as the plan intended."
  - "The plan's reddening for 'a refusal carries no signature' cannot fail, and the reason is better than the check. `encodeResponse`'s refusal arm has no `attestation` key at all, so a node signing before its refusal branches produces a statement the wire cannot carry. A shape guard on the encoder replaced the runtime one."
  - "`combine-signature.node.test.ts` crosses a real TRANSPORT boundary, not a real PROCESS boundary. A spawned `bin/agent.ts` cannot sign until 19-15, so the plan's preferred option was taken: three real `FabricNode`s over tcp + noise + yamux with this file installing the signing identity. The plan's must-have about one `bin/agent.ts` verifying in another is NOT established here and is 19-15's."
  - "No `vitest.config.ts` change. The new spec's measured file span is 363.8 ms, under `SLOW_CUTOFF_MS`, so no `MEASURED_NODE_SPANS` entry was written."
  - "The mutation ledger's M32 was re-anchored: its `find` was the exact line this plan gave an `attestation` key. The mutation is unchanged; only the text it keys on moved."
  - "`serve-agent-hooks.node.test.ts` gained counts for the new sentinel but its `it` titles were NOT renamed, because two mutation-ledger entries key their signature on those titles and the ledger's own docblock records what renaming one costs."

requirements-completed: []
duration: one session
completed: 2026-08-03
---

# Phase 19 · Plan 16 — The aggregation is signed too, and one proof that could not fail

`PROJECT.md` states this project's split as *the owner's contribution is trusted; **the
aggregation over contributions is verified***. Plan 19-13 signed `exec` results only, so a
map/reduce job ended with signed map results feeding an unsigned aggregation — the half
claimed to be the verified one. This plan signs it.

## What changed

| file | what |
|---|---|
| `packages/core/src/reduce.ts` | `CombineProduct`; `CombineDispatch` returns it; `ReduceOutcome.attestations` beside an untouched `executedBy`; `localDispatch` states it signs nothing |
| `packages/core/src/result-attestation.ts` | `signCombine`, `verifyCombineAttestation`, and one private `checkAttested` deciding the three questions for both verbs |
| `packages/net/src/combine.ts` | `remoteCombineDispatch` carries the statement home and deliberately does not check it |
| `packages/net/src/protocol.ts` | the combine reply's type, encode and parse; a malformed statement refuses the frame |
| `packages/net/src/agent.ts` | the ninth `AgentOptions` hook, and the combine success path signing through it |
| `packages/net/src/agent-contract.test.ts` | the compile-time proof the hook cannot be omitted |
| `fabric-node.ts`, `browser-node.ts` | the sentinel, as a burn-down with 19-15's name on it |
| `bin/bench.ts`, `perf-workload.ts` | the sentinel, permanently — nothing enrolled those endpoints |
| `serve-agent-hooks.node.test.ts` | counts for the new sentinel at all four production sites |
| `combine-signature.node.test.ts` | **new** — a stranger checking a real tree |
| 20 further spec files | one property each, subject unchanged |

## The fan-out, measured

The plan predicted **~25 dispatch sites across 9 files**. The real numbers are different
in both directions and the difference is informative.

- **`CombineDispatch`'s widening produced 12 `tsc` errors across 4 files.** Far fewer than
  25, because most stub dispatches either return `null` or delegate to `localDispatch`,
  and neither changes shape.
- **`AgentOptions.attest` produced 46 `tsc` errors across 23 files** — the real fan-out,
  and it is a different type from the one the plan counted. Most files hold one
  `SENTINELS` object covering several `serveAgent` calls, so 23 files took 20 edits.

**Two reader sites the compiler could not see**, found by grep, exactly as this phase's
context warned:

1. `combine.test.ts` read a dispatch result as `cid?.toString()`. `CombineProduct` has a
   `toString` too, so it compiles and yields `[object Object]`.
2. `combine-wire.test.ts` compares a parsed reply with `toEqual`. Not a construction, so
   invisible to `tsc`; it also is not in the plan's frontmatter.

**And a third way for the `tsc` worklist to be short, which is new.** A concurrent
executor's in-progress type errors in `packages/net/src/reduce-job.test.ts` **masked my
own missing sentinel in the same file**. `tsc` never named it, the file's `SENTINELS`
object went unedited, and the defect surfaced only when `npx vitest run --project node
packages/net/src` reported `expected +0 to be 3` — every combine failing because
`signCombine(undefined, …)` threw inside the handler. The grep that caught it is worth
recording as the general form: for every file containing `serveAgent(`, require an
`attest:` occurrence.

## Mutation readings observed

Every one planted by hand, restored with `cp` + `cmp` (**exit 0 each time**), and re-run
green afterwards. Nothing was restored with `git checkout --`.

| # | mutation | file | find → replace | reading |
|---|---|---|---|---|
| M-1 | drop the attestation recording | `reduce.ts` | `attestations.set(result.node.id, result.attestation as AttestedResult)` → `` | **RED** — 3 failed / 29 passed. `expected +0 to be 1`; `executedBy` still fills, the new map is empty — the pre-plan world with a field added |
| M-2 | record an attestation on a disagreement | `reduce.ts` | the `set` hoisted above the `if`, `else` → `else if (result.cids.length === 0)` | **RED** — 1 failed / 31 passed, *records nothing for a combine whose replicas disagreed*, `expected true to be false` |
| M-3 | a malformed attestation degrades to the sentinel | `protocol.ts` | `parseAttestation(record['attestation'])` + `if (… === null) return null` → `parseAttestation(…) ?? 'signed-by-nobody'` | **RED** — 2 failed / 35 passed, `expected { kind: 'combine', …(3) } to be null` |
| M-4 | sign the sorted input list at the branch | `agent.ts` | `signCombine(options.attest, request.inputCids, hashed.cid)` → `signCombine(options.attest, [...request.inputCids].sort(), hashed.cid)` | **RED** — 2 failed / 31 passed. **This is the plant that justifies not sorting** |
| M-5 | sort inside the challenge itself | `result-attestation.ts` | `inputCids: [...inputCids],` → `inputCids: [...inputCids].sort(),` | **RED** — 2 failed / 79 passed; 19-13's own *signs a combine over its inputs in merge order, never sorted* goes red beside this plan's |
| M-6 | sign before the refusal checks | `agent.ts` | a `premature` `signCombine` above `authorize`, carried on the `unauthorized:` arm | **GREEN — the plan's proof could not fail.** See below |
| M-7 | let a refusal carry a signature on the wire | `protocol.ts` | the `found: false` arm gains `attestation: attestationToValue(response.attestation)` | **RED** — 1 failed / 9 passed, `expected [ Array(4) ] to deeply equal [ 'found', 'kind', 'reason' ]` |
| M-8 | make the hook optional, omit it at `fabric-node.ts`, give `serveAgent` a silent default, delete the compile guard | `agent.ts`, `fabric-node.ts`, `agent-contract.test.ts` | `readonly attest: ResultAttestor` → `readonly attest?: …`, `attest: 'signs-nothing',` → `` | **`tsc --noEmit` exit 0**, `combine.test.ts` **51 passed**. Only the source-text sentinel count caught it |
| M-9 | the combine branch stops signing | `agent.ts` | the whole `signCombine` ternary → `const attestation: AttestedResult = 'signed-by-nobody'` | **RED** — 3 of 3 failed in `combine-signature.node.test.ts`, `expected 'signed-by-nobody' not to be 'signed-by-nobody'` |
| M-10 | pin the issuer taken out of the certificate being checked | `combine-signature.node.test.ts` | `PINNED` → `new Set([attested.certificate.issuer])` | **GREEN — a check that cannot fail.** See below |

### M-8 is the load-bearing one, and it reproduced the prediction exactly

With `attest` optional, the hook omitted at a production factory, a `?? 'signs-nothing'`
default in `serveAgent` and the `@ts-expect-error` guard removed:

- `npx tsc --noEmit` exited **0**;
- `combine.test.ts` and `agent-contract.test.ts` were **fully green — 51 passed**;
- a production node had silently stopped signing every aggregation it performed.

The only instrument that moved was `serve-agent-hooks.node.test.ts`'s source-text count
of the sentinel. That is 19-01's and 19-13's finding for a third time: an optional hook
with a silent default is invisible to the type checker *and* to every behavioural spec.

A partial variant is worth recording separately: with the hook merely optional and
nothing else changed, `tsc` reported **`agent-contract.test.ts(138,5): Unused
'@ts-expect-error' directive`** — the guard failing loudly in the direction that matters,
which is exactly what that file's own header claims for it.

## The two proofs that could not fail

The prompt asked for every proof to be observed. Two were, and could not be.

### M-6 — "a refusal carries no signature" is structural, not a check

The plan: *"Reddened by signing before the refusal checks: a node signs a statement about
a combine it never ran."*

Planted a `serveAgent` that signs at the top of `combineAdmitted` and carries that
statement on the `unauthorized:` arm. **All 33 cases in `combine.test.ts` stayed green.**

The reason is better than the proof. `encodeResponse`'s combine branch emits
`{kind, found: false, reason}` for `resultCid === null` — there is **no `attestation` key
on the refusal arm at all** — and the parse supplies the sentinel on the far side. A
signed refusal is therefore unrepresentable on this wire, whatever the handler does. So
the property was moved to where it actually lives: `combine-wire.test.ts` now hands the
refusal arm a full attestation and asserts the frame still has three keys, and M-7 shows
that reading goes red when the encoder is changed.

### M-10 — the stranger has to be a stranger, and it is one line away from not being

The plan asked for this variant explicitly, and it is the reason the file's header opens
with what is being measured rather than with what is being built.

Replacing the pinned set with `new Set([attested.certificate.issuer])` — the issuer named
inside the very certificate under test — leaves **all 3 cases passing**, including the
arm whose entire job is to *refuse* a signer no trusted provider certified. That arm's
node was enrolled by `STRANGER_SEED`, and the self-pinned verifier accepts it without
complaint.

That variant was run, it passed, and it proves nothing. It is recorded here because a
check that cannot fail was Phase 18's whole finding, and the only defence is to have run
the version that could not fail and noticed.

## Commands run, with real exit codes

`EXIT=$?` on the line immediately after the command it reads, never through a pipe.

| command | exit |
|---|---|
| `npx tsc --noEmit` (final) | **0** |
| `npx vitest run --project node packages/net/src packages/core/src` | **0** — 55 files, 810 tests |
| `npx vitest run --project node packages/net/src` | **0** — 25 files, 300 tests |
| `npx vitest run --project node packages/core/src` | **0** — 30 files, 510 tests |
| `npx vitest run --project node` × 13 node-tier specs incl. the six cheap guards | **0** — 205 tests |
| `npx vitest run --project node packages/node/src/combine-signature.node.test.ts` | **0** — 3 tests |
| `npx vitest run --project node packages/node/src/mutation-guard.node.test.ts` | **0** — 72 tests |
| `npx vitest run --project browser packages/browser/src/start-unwind.browser.test.ts` | **0** — 3 files, 15 tests |
| the six cheap guards, via the pre-commit hook, on **each of the three commits** | **0** |

**No timing was asserted and no timeout was tuned.** The one number recorded is the new
spec's file span — **363.8 ms**, from `--reporter=json` — read solely to answer whether
`vitest.config.ts` needed a `MEASURED_NODE_SPANS` entry. It does not, so that file was
not touched. Nothing was found unresolvable under load: no spec failed in a
timeout-shaped way and no re-run was needed.

### What was not run, and why

`--project node` in full and `--project browser` in full. The instruction was to run only
the files this plan names, project-scoped, on a host carrying a second executor. Every
file the plan lists as load-bearing was run: `agent-contract.test.ts`,
`combine.test.ts` (**including the two `Object.keys` request guards at `:948-958`, which
were checked rather than assumed unaffected — the combine request is still four keys and
the block request two**), `reduce.test.ts`, `reduce-job.test.ts`, `admission.test.ts`,
and the new `combine-signature.node.test.ts`.

## What the plan got wrong

1. **`result-attestation.ts` had to be modified and is not in the frontmatter.** 19-13
   defined `combineChallenge` and no signer or verifier for it, and
   `verifyResultAttestation` takes a `ResultWork` — `{moduleCid, inputCid,
   partitionIndex, outputCid}` — that a combine cannot build. Task 3's behaviour
   ("`verifyResultAttestation` called with … the input CIDs and the result CID") is not a
   call that exists. `signCombine` and `verifyCombineAttestation` were added beside the
   challenge, per the brief's rule that one file stays the authority.
2. **`reduce-job.test.ts:307` does not assert a whole `ReduceJobResult` with `toEqual`.**
   Its two `toEqual` sites are on the `{ok:false, reason}` arm, which carries no
   `ReduceOutcome`. The additive field broke nothing there and nothing was extended.
3. **`localCombineDispatch` does not exist.** The function is `localDispatch`.
4. **The dispatch fan-out is 12 sites in 4 files, not ~25 in 9.** The hook fan-out —
   which the plan did not size — is 46 in 23.
5. **Two files the plan does not name had to be modified**: `combine-wire.test.ts` (a
   `toEqual` reader of the parsed reply) and `mutation-ledger.ts` (M32's `find` was the
   exact line that grew a key). Plus `fabric-node.ts` and `browser-node.ts`, which the
   plan's own behaviour section requires but its frontmatter omits, and
   `serve-agent-hooks.node.test.ts`, which is where a production sentinel count belongs.
6. **The refusal reddening could not fire** — see M-6. The design is right; the proof was
   pointed at a property the wire already makes unrepresentable.
7. **Task 3's must-have — "a combine attestation produced by one `bin/agent.ts` process
   verifies in another" — is not established, and could not be by this plan.** Every
   `serveAgent` site holds the sentinel until 19-15, which the plan's own execution
   context says. The plan's preferred option was taken and the file says so in its header
   rather than implying more.

## An incident: I destroyed ~250 lines of the concurrent executor's work

**Read this before the next parallel wave.** While diagnosing a `requirements-ledger`
failure that was attributable to 19-06's unstaged `packages/core/src/job/submit.ts`, I
ran:

```
git stash push --keep-index -- packages/core/src/job/submit.ts
```

to test whether the guard read disk or the index. It reverted that file to `HEAD`,
discarding **their live in-progress edits** — about 250 lines including
`NoVerifiedAttestation`, `receiptFor` and `noAgreementToAttest`. `git stash pop` then
refused, because they had already begun re-typing into the reverted file.

What was done about it, and what remains available:

- **Their file was never written to by me.** The stash entry was left in place rather
  than dropped, and two snapshots were kept at `/tmp/their-submit-stashed.ts` (the
  destroyed version, 743 lines) and `/tmp/their-submit-live.ts` (their state at the
  moment of discovery, 499 lines).
- The destroyed version is recoverable from git with
  `git show stash@{0}:packages/core/src/job/submit.ts`.
- 19-06 subsequently landed `c8a132d`, `818989e`, `b80d2ab` and `d696c6a`, so the work
  appears to have been redone; the stash entry should be dropped by whoever confirms that.

**The rule this violated is already written down**: on a shared tree, never run a
destructive git operation on a file you do not own — and `git stash` on somebody else's
path is destructive even though the word does not sound like it. The diagnosis it was
serving was answerable without touching their file at all: the guard's failure named
`packages/core/src/job/submit.ts` in its own output, which was already sufficient.

## Scheduled arrivals, stated rather than left to be discovered

- **No production node signs a combine yet.** All four `serveAgent` sites hold
  `attest: 'signs-nothing'`. 19-15 replaces the two factories'; the two bench rigs keep
  theirs permanently, and `serve-agent-hooks.node.test.ts` now holds both counts so the
  burn-down and the floor are separately readable.
- **Nothing verifies these attestations in production.** `remoteCombineDispatch` carries
  them and deliberately checks nothing — it holds no trust anchors. 19-17 builds the
  aggregate receipt and puts it on the CLI beside the map receipt.
- **A running fabric's behaviour changed only in frame size**, and only on an attested
  reply, which none exists in production today. No existing spec's timing or size
  assertion moved.

## No blockchain

Nothing global was added. `verifyCombineAttestation` takes its trusted issuers as an
argument and has nothing to reach out to; trust stays pinned per verifier; revocation
stays non-renewal on the certificate's own clock. The replay property is 19-13's and
unchanged: an attestation is valid forever for its `(inputs, result, node)` triple, which
is what makes it transferable.

## Commits

| hash | subject |
|---|---|
| `18dd790` | `feat(19-16): a combine's result and what its producer signed travel together` |
| `8378c68` | `feat(19-16): one signing identity per node, and the combine branch uses it` |
| `921e55c` | `test(19-16): the aggregation's signature, checked by a stranger over a real transport` |

Four commits by the executor working 19-06 landed between them. The branch was left
clean, no branch was created or switched, every commit staged explicit paths, and
`git status --porcelain` was read before each one.
