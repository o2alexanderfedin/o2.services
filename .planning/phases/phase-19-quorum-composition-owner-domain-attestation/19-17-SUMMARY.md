---
phase: phase-19-quorum-composition-owner-domain-attestation
plan: 17
subsystem: reduce, result-attestation, benchmark-driver, cli-display
tags: [VER-08, VER-09, VER-10, SCHED-02, defect-31, aggregate-receipt, combine-signing, guard]
requires:
  - "packages/core/src/result-attestation.ts — signCombine / verifyCombineAttestation (19-16)"
  - "packages/core/src/reduce.ts — ReduceOutcome.attestations, CombineProduct (19-16)"
  - "packages/net/src/agent.ts — the attest hook on the combine branch (19-16)"
  - "packages/node/src/fabric-node.ts, packages/browser/src/browser-node.ts — attestResults composed (19-15)"
  - "packages/core/src/quorum.ts — attestationReceipt, attestationRank, classifyAttestation (pre-existing, UNCHANGED)"
  - "packages/node/src/bin/bench.ts — the map receipt on stdout (19-10)"
provides:
  - "ReduceJobResult.aggregateAttestation — the AGGREGATION's own receipt, over combine signatures the requestor checked, set by the weakest step in the tree"
  - "ReduceJobOptions.trustedIssuers — a required union with a named sentinel, and the recorded argument for why reduceJob takes one and submitJob does not"
  - "two labelled receipts on bin/bench.ts's stdout: `map attestation (…)` and `aggregate attestation (…)`"
  - "DEFECT #31 CLOSED — a guard on `admit: rpcAdmission(requestor.rpc)`, watched going red, with the measurement showing nothing else caught it"
  - "four find/replace pairs for Plan 19-12, each run and each observed"
affects:
  - "19-12 (mutation ledger) — six find/replace pairs recorded below, four in reduce-job.ts and two in bin/bench.ts"
  - "any future reduceJob caller — the trust anchors are REQUIRED; there are eight call sites today and each states its choice"
tech-stack:
  added: []
  patterns:
    - "the merge a replica signed is recorded by wrapping the dispatch the module already builds, rather than by widening a @o2/core port"
    - "the weakest step sets a tree's receipt, by attestationRank and never by averaging"
    - "a duplicate node key across replicas of one combine is a NAMED ABSENCE here and a THROW in submitJob — reachable from the wire versus an assembly defect"
    - "two receipts about two claims each carry a name for the claim they are about"
key-files:
  created: []
  modified:
    - packages/net/src/reduce-job.ts
    - packages/net/src/reduce-job.test.ts
    - packages/net/src/index.ts
    - packages/node/src/bin/bench.ts
    - packages/node/src/bench-reduce.node.test.ts
    - packages/node/src/bench-attestation.node.test.ts
    - packages/node/src/discover-arm.node.test.ts
    - packages/node/src/pi-reduce.node.test.ts
    - packages/node/src/primes-reduce.node.test.ts
    - packages/node/src/tree-reduce-agents.node.test.ts
    - .planning/REQUIREMENTS.md
    - CLAUDE.md
decisions:
  - "the receipt is the weakest combine's, so a weak leaf-level step cannot vanish under a strong root"
  - "the per-combine agreeing set is every replica that answered, not only the accepted one — otherwise every combine is owner-attested by construction and the label can never follow its input"
  - "a duplicate node key answers with the named absence rather than throwing: unlike submitJob's, this condition is reachable from the wire"
  - "reduceJob reads Date.now() once per reduction; the second clock read in production @o2/net"
  - "the driver prints `map attestation` and `aggregate attestation`, and 19-10's parser was moved to the new text rather than loosened"
  - "VER-08/09/10 deliberately NOT ticked — see the ledger section"
metrics:
  duration: ~42m
  completed: 2026-08-04
---

# Phase 19 Plan 17: Two receipts, because there are two claims Summary

A reduced job now says how strongly its **aggregation** is attested — derived from combine
signatures the requestor checked against issuers it pinned, set by the weakest step in the
tree — and the one CLI in this repository that runs jobs prints it beside the map receipt,
each line naming the claim it is about.

And **defect #31 is closed**: `admit: rpcAdmission(requestor.rpc)` in `bin/bench.ts`, the
sole production call of `rpcAdmission` in this repository and the whole of SCHED-02's
runnable-entry-point claim, now has a guard that was watched going red.

```
    map attestation (first completed run): owner-attested (replicas 1, operators 1) —
      owner-attested — computed once by the data owner and not independently verified
    aggregate attestation (first completed run): none established (combines 5, verified 0)
      — this requestor checks no combine signatures, so it holds no statement about who
      performed this aggregation
```

(Wrapped here for width; each is one line. The aggregate half reads the named absence on a
default run **by construction** — no provider is started and no worker enrols, so the rig
truthfully states that it checks nothing.)

## What was built

### Task 1 — the aggregation's own receipt

**Commits:** `ddc48d8` (RED), `0fd0367` (GREEN)

`ReduceJobOptions` gains a **required** `trustedIssuers`: a `ReadonlySet<PublicKeyHex>` or
the literal `'checks-no-combine-signatures'`. `ReduceJobResult`'s `ok` arm gains
`aggregateAttestation`, which is either an `AttestationReceipt` or the new
`NoVerifiedAggregation`.

- **The asymmetry with `submitJob` is written down at both ends**, because the two entry
  points read as inconsistent otherwise. `submitJob` reaches its trust decision through a
  seam that already made it — `NodeDescriptor` carries the certificate discovery verified
  against pinned issuers — so a second issuer set there would be a second place one
  decision is made. **`reduceJob` has no such seam**: its `executors` are bare peer id
  strings and there is no certificate anywhere on the reduce path.
- **The weakest combine sets the aggregate**, by `attestationRank`.
- **A partial verification, a duplicate node key, a reduction that merged nothing, and the
  no-checking literal each read the named absence** with counts, never a strength over
  whatever happened to check out.
- `NoVerifiedAggregation` counts **combines**, not replicas, and uses a distinct `kind`
  string from `submitJob`'s `NoVerifiedAttestation` — a reader handed both must not be
  able to answer an aggregation question with a map answer.
- `quorum.ts` is **untouched** and `quorum.test.ts` passes **unedited**, which the plan
  named as the thing to check.

### Task 2 — both receipts on the CLI, labelled

**Commits:** `88efe4f`, `5b5007d`

- `RungAttestation` carries both receipts, recorded **in one statement**, so the pair a
  reader compares is always one job's.
- The aggregate reading is taken whenever `reduced.ok` — deliberately **not** under the
  conjunction the *timing* uses. A reduce that ran and had a combine fail has a receipt
  worth printing: it names the step nobody could account for.
- A rung that reduced nothing prints **no aggregate line at all**, and `raw.json` omits
  the key rather than carrying a placeholder.
- **The sweep's shape did not move**, measured rather than promised: the 16 lines carrying
  `LADDER`, `REAL_LADDER`, `SHARDS`, `RUNS`, `QUICK`, `redundancy: Math.min(…)`, `skew:`
  and `runs: RUNS` are byte-identical to the previous commit, checked with `diff`.
- **No benchmark curve was taken or published.** `.planning/BENCHMARK-RESULTS.md` and
  `.planning/bench` are untouched, and `vitest.config.ts` was not edited — no new test
  file was created, so `MEASURED_NODE_SPANS` needs no entry and none was guessed.

## DEFECT #31 — closed, and the gap measured rather than inherited

The guard is `bench-reduce.node.test.ts`'s new call-site requirement *"the discover rig
supplies admit, and the job spec passes it on"*. It matches the **whole**
`...(DISCOVER ? { admit: rpcAdmission(requestor.rpc) } : {})` spread and the
`...(fabric.admit === undefined ? {} : { admit: fabric.admit })` that consumes it — two
halves that fail differently and neither of which implies the other.

### Watched going red

The expression was deleted from the **real** `bin/bench.ts`, everything plausible was run,
and only then was it restored by `cp` + `cmp` (exit 0), never by `git checkout --`.

| run, with `admit:` deleted | result |
|---|---|
| `npx tsc --noEmit` | **exit 0** — `Fabric.admit` is optional, so its absence is legal |
| the six cheap guards, incl. `requirements-ledger.node.test.ts` | **exit 0** — 156 passed |
| `discover-arm.node.test.ts` (reads the driver's own stdout) | **exit 0** |
| `bench-reduce.node.test.ts` | **exit 1** — the only thing that noticed |

Observed failure text:

```
AssertionError: expected [ Array(1) ] to deeply equal []

+   "packages/node/src/bin/bench.ts — missing: the discover rig supplies admit, and the
+    job spec passes it on. Why it matters: DEFECT #31, carried from Phase 18 and closed
+    here. `bin/bench.ts` holds the ONLY production call of `rpcAdmission` in this
+    repository — every other is a spec — so REQUIREMENTS.md's SCHED-02 row rests on
+    these two expressions for its claim that `planWithOffers` has a caller from a
+    runnable entry point. …"
```

### The `if (DISCOVER)` question, answered

`--discover` is off by default, so **no default-path run reaches the expression at all**.
The guard is textual and therefore unaffected by that gate — it reads the source, not a
run — and that is *why* a textual guard is the right instrument here rather than second
best:

- the only run that reaches it is `bin/bench.ts --quick --discover`, whose readings arrive
  minutes in (`bench-attestation.node.test.ts` measures **155 s** to reach its own);
- **nothing that driver prints changes when `admit` is removed.** On a healthy rig no node
  refuses, so `planWithOffers` and `planPlacement` place identically; the `rejections` the
  difference would populate are not on this driver's output at all. `discover-arm`'s own
  header already recorded this and it is unchanged. A behavioural reading here would have
  to be **invented before it could be taken**.

What the guard does **not** do is say the call works. That is
`discovery-agents.node.test.ts`, which measures `planWithOffers` + `rpcAdmission` across
real processes. Behaviour proves the mechanism; the source guard proves this entry point
still composes it — the same division `trust-anchors.node.test.ts` records for signing legs
1 and 3, which is the two-instance precedent this follows rather than invents.

### A claim in `discover-arm.node.test.ts` that was false

Its header said SCHED-02's entry-point leg *"rests on the source-text count in
`serve-agent-hooks.node.test.ts`"*. **Measured false**: that file names neither
`rpcAdmission` nor `admit:` anywhere — its only `admit` is an unrelated comment. The leg
rested on nothing. The header now records the closure, and the stale `bin/bench.ts:723`
line number was **dropped rather than renumbered**: it was already 16 lines stale when
19-10 measured it, and a guard keyed on text does not need one.

`.planning/REQUIREMENTS.md`'s SCHED-02 row gained the same pointer (`16cf7c2`), with no
verdict changed and no box ticked.

## The plants, with find/replace pairs for Plan 19-12

All run, all observed, each restored by `cp` + `cmp` (exit 0 each time) and never by
`git checkout --`. `git status --short` and `git diff HEAD --stat` were clean of the file
after every restore.

| # | file | find | replace | observed |
|---|---|---|---|---|
| P1 | `reduce-job.ts` | `receipts.push(attestationReceipt(verified))` | `receipts.push({ ...attestationReceipt(verified), strength: 'owner-attested' })` | RED on the three-label case **only**, with the diff naming exactly the two readings that moved: `["owner-attested", -"owner-domain", -"independent", +"owner-attested", +"owner-attested"]`. The weakest-step case stayed green, which is the control |
| P2 | `reduce-job.ts` | the `if (!checked.ok) {…}` arm + `verified.push(checked.certificate)` | `void checked` + `verified.push(replica.attestation.certificate)` | RED on *"does not count a combine whose signature covers an input order it did not merge"*: `expected false to be true` at the named-absence assertion. **This is the assertion the combine leg exists for** — the requestor reports a strength on its own say-so |
| P3 | `reduce-job.ts` | `return receipts.reduce((weakest, receipt) => …)` | `return receipts[receipts.length - 1]` (the root's alone) | RED on the weakest-step case: `expected 'independent' to be 'owner-attested'`. The weak leaf-level combine vanished under the strong root |
| P4 | `reduce-job.ts` | `if (keys.size !== verified.length) {` | `if ((false as boolean) && keys.size !== verified.length) {` | RED on the duplicate case. Instrumented to record what it reports: `{"strength":"independent","replicas":2,"operators":["alice-op","bob-op"],…}` — **`independent`, two replicas, two operators, for an aggregation ONE node key attested** |
| P5 | `bin/bench.ts` | `trustedIssuers: fabric.combineIssuers,` | `trustedIssuers: new Set<string>(),` | RED: *"missing: the reduce is told what this rig checks combine signatures against"* — the "second place the decision is made" defect |
| P6 | `bin/bench.ts` | `map attestation (` | `attestation (` | RED: *"missing: both receipts reach stdout, each naming the claim it is about"* |

`(false as boolean)` is the form that plants cleanly on a conditional, and it is worth
knowing for 19-12 beside 19-10's `(true as boolean)` note: a plant that does not
type-check is a plant whose run proves less than it appears to.

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 3 — blocking] `CLAUDE.md` failed the vocabulary guard and refused every commit**

- **Found during:** the first commit of Task 1.
- **Issue:** `7b00121` (a `docs:` commit by a third writer, ten minutes before this plan
  started) added a Conventions bullet under *Proofs* whose closing clause used the reward
  verb `vocabulary.node.test.ts` bans — the Coinhive term, in its ordinary-English sense.
  That guard scans tracked `.md` files from the **git index**, so the hook refused every
  commit in the tree and `--project node` was red for a reason unrelated to any plan.
  19-11 recorded it independently at `19ae2cf` as pre-existing.
- **Why fixed rather than deferred:** it blocked a declared success criterion
  (`--project node` passes), not only convenience.
- **Fix:** the clause now reads *"a green you did not watch fail"* — the same paragraph's
  own instruction two lines above. **Reworded rather than exempted**, which is the remedy
  this repository already chose for its own prose: the `EXEMPT_LINES` entry for the
  aws-study records that the word was reworded everywhere it was the author's own and
  exempted only where it is somebody else's identifier.
- **The same guard then caught this summary**, which had quoted the removed clause
  verbatim while describing the fix. Reworded here too, on the identical reasoning — a
  file that describes a ban is not exempt from it, and this repository has an
  `EXEMPT_LINES` mechanism precisely so the few genuine exceptions are named one at a
  time rather than waived by category.
- **Commit:** `ff2146a`

**2. [Rule 3 — blocking] A required option is a fan-out, and `tsc` listed all of it**

- **Issue:** `trustedIssuers` broke eight `reduceJob` construction sites — three test files
  outside this plan's declared list, plus `bin/bench.ts`.
- **Fix:** each states the sentinel with the reason. **Truthful rather than convenient**:
  nothing in `pi-reduce`, `primes-reduce` or `tree-reduce-agents` enrols — no provider is
  spawned and no agent gets an `enrollment` option — so every `FabricNode` there resolves
  `certificate === null` and hands `serveAgent` the no-signing sentinel. An issuer set
  would have claimed those requestors checked signatures and found none, which is a
  different and false claim.
- **19-CONTEXT's rule was applied and its answer recorded:** a `tsc` worklist is not the
  whole worklist. Grepped for reader sites — `toEqual`, `toMatchObject`, `Object.keys` —
  over every `reduceJob` result in the repository. **There are none**: no test does a
  whole-object comparison on an `ok: true` reduce result. So on this fan-out the two lists
  agreed, which is worth recording because the last two plans found they did not.
- **Commit:** `0fd0367`

**3. [Rule 1 — bug] A comment of mine quoted a sentinel a guard counts**

- **Found during:** the first full `--project node` run — **not** by the pre-commit set,
  which does not include this guard.
- **Issue:** `serve-agent-hooks.node.test.ts` counts the **raw** text of `'signs-nothing'`
  and `attest:` in `bin/bench.ts` and requires exactly 2 of each, one per `serveAgent`
  call. A comment I added quoted both, so the counts read 3.
- **Fix:** the comment names the sentinel in prose and says at the line why it may not
  quote it. **The guard was right and the prose was wrong; no assertion was touched.**
- **Commit:** `5b5007d`

### Deliberate departures from the plan's letter

**`bin/bench.ts`'s issuer threading landed in Task 1's commit, not Task 2's.** A required
field cannot be half-applied: leaving it out would have left the shared working tree
uncompilable between two commits, with a concurrent executor running in it. The display
half — `Observation`, the printing, the guard — is Task 2's as planned.

**`packages/net/src/index.ts` was edited though it is not in `files_modified`.** It is
`@o2/net`'s only entry point, so a type absent from it cannot be named anywhere else, and
`bin/bench.ts` has to be able to write `AggregateAttestation` and `CombineTrustAnchors`.

**Three test files and `discover-arm.node.test.ts` were edited for the same class of
reason** — a required-field fan-out and a claim measurement made false. None is owned by
the concurrent 19-11.

**`.planning/REQUIREMENTS.md` was committed alone, after a wait.** My SCHED-02 sentence was
written, then **reverted**, because 19-11 had two in-progress row edits in the same file
and `git commit -- <path>` commits the *working tree* for that path — so committing mine
would have swept theirs in. That is defect #37 at line granularity. The sentence was
re-applied and committed alone (`16cf7c2`) once their rows had landed.

### Four things the plan asserted that measurement contradicted

The plan's `<interfaces>` block is written as *"everything this plan builds against, no
codebase exploration needed."* Four of its statements are false against the tree, and this
is the twelfth consecutive plan in this phase to find at least one.

1. **"one whole-object `toEqual` at `reduce-job.test.ts:307`"** — `:307` is
   `expect(corruptedReference.cid.toString()).not.toBe(outcome.rootCid)`. There is no
   whole-object `toEqual` on an `ok: true` result anywhere in the file; the two that exist
   are on the `ok: false` arm, which this plan does not change. **The property the plan
   wanted was real and was missing**, so it was added in the form that survives: the
   eight-node case asserts `Object.keys(result).sort()`, which fails when a field is added
   to that arm and reported nowhere. A whole-object literal was rejected on purpose —
   `outcome` carries two `Map`s and `tree` carries every leaf, so it would be rewritten
   rather than read.
2. **"`verifyResultAttestation` checks out against that combine's own input CIDs"** — that
   function takes a `ResultWork` (a map task's module/input/partition/output) and cannot
   describe a merge. The combine verb is `verifyCombineAttestation`, which 19-16 built for
   exactly this.
3. **"`Observation` carries the aggregate receipt beside the map receipt Plan 19-10
   added"** — 19-10 put no receipt on `Observation`; its own summary records the decision
   to keep it off a `@o2/bench` type. The map receipt lives on `RungAttestation` and the
   report object. This plan followed 19-10's actual shape, which its own `<action>` also
   instructed.
4. **"the guard on the `reduceJob(` call moves because the call gains an argument"** — it
   does not. That guard's patterns are `/\breduceJob\s*\(/` and `/\bproject\s*[,:]/`, and
   an added key breaks neither. Nothing needed updating; what was needed was a **new**
   requirement for the new argument, which is what landed. Relatedly, the plan's proof
   *"reddened by giving the call the wrong argument order"* is not measurable —
   `reduceJob` takes one options object and an object literal has no argument order. P5
   and P6 above are the measurable substitutes.

## A structural gap the plan did not anticipate, and how it was closed

**`ReduceOutcome` cannot tell you what any combine signed over.** A combine attestation
covers `(inputCids in merge order, resultCid, nodeKey)`. `ReduceOutcome` carries
`executedBy` (peer ids), `attestations` (the accepted replica's statement) and `rootCid` —
and the map from a tree node to the CID its value resolved to **never leaves
`executeReduce`**. From the tree alone, only a level-1 combine's *inputs* and only the
root's *result* are recoverable, so any tree deeper than one level would have had nothing
checkable in it at all. `bin/bench.ts` runs a depth-2 tree.

Widening `ReduceOutcome` was the obvious answer and was rejected: it is `@o2/core`'s port,
the plan puts it out of scope, and it would break every construction site of that type.
Instead `reduceJob` **wraps the dispatch it already builds** and records, per combine, the
`inputCids` it dispatched and what each replica answered. One `Map`, no port change.

**The related correction, and it is the one that makes the labels reachable at all.**
`ReduceOutcome.attestations` holds **one** statement per combine — the accepted replica's
— by `executeReduce`'s own recorded decision. A receipt built from that set is
`attestationReceipt([oneCertificate])`, which is `owner-attested` for **every** combine
under every configuration, so `owner-domain` and `independent` would have been
unreachable and the plan's first proof could not have passed. The receipt is therefore
built over **every replica that answered that combine**, which is the exact analogue of
the map half's agreeing set. Replicas that disagreed are excluded by construction: a
combine whose replicas disagreed is absent from `attestations`, and this receipt does not
invent a statement where `executeReduce` declined to record one.

## What this does not establish

- **That the peer which answered is the node whose certificate it presented.** An
  attestation is transferable by design — `result-attestation.ts` records the replay
  property as intended — and this module holds no way to derive a peer id from a node key:
  that derivation is `@o2/libp2p`'s, which `@o2/net` may not import. `submitJob` closes
  the same gap with the descriptor a node was discovered under; there is no descriptor
  here. **What stands in its place is the duplicate-node-key check**, which stops the
  inflation that absence would otherwise permit — and P4 above measures exactly what it
  stops. Written down at `ReduceJobResult.aggregateAttestation`.
- **That a signed aggregation is a correct one.** Reduce redundancy and `disagreements`
  are untouched and stay the only thing that says an answer is right.
- **`owner-domain` on the CLI.** No rung of this driver produces two combine producers
  under one operator — every `--discover` worker enrols with a distinct `operatorId` — so
  the middle label is displayed by nothing there. It is measured in
  `reduce-job.test.ts`'s three-label case.
- **The demo UI.** 19-11's, and the browser demo runs no reduce at all.
- **Any performance claim.** This plan adds no timing assertion, no span, no threshold and
  no absolute millisecond figure. `vitest.config.ts` is untouched, no new test file was
  created, and no benchmark curve was taken or published. The two absolute figures in
  `bench-reduce.node.test.ts` — `MEASURED_TREE_DEPTH` and `MEASURED_COMBINES` — are
  pre-existing and **structural**: a pure function of `SHARDS` and `DEFAULT_FANOUT`, not
  of any machine.

## Requirements deliberately NOT ticked

**VER-08, VER-09 and VER-10 keep their boxes and their verdicts.** VER-09's and VER-10's
display half has two surfaces and 19-11 was mid-flight on the second when this ran;
VER-08's sovereign multi-node redundancy clause is open independently. Ticking a box for
part of a half would put a false checkbox in a ledger this repository guards, and
*unmeasured is not met* applies to a checkbox as much as to a mechanism — 19-10's and
19-15's precedent, followed here.

Their **rows** were also left alone, deliberately: 19-11 had uncommitted edits to VER-09
and VER-10 throughout, and a shared index makes a doc edit to the same file a way to commit
somebody else's unfinished prose. Only SCHED-02's row — which nobody else was touching —
was edited.

`.planning/STATE.md` and `.planning/ROADMAP.md` were **not** touched, per the executor
brief.

## Sharing one working tree with 19-11, and what it cost

**Defect #37 honoured throughout.** Every commit used `git commit -- <explicit paths>` and
every one was read back with `git show --stat`. This was not theoretical: at the time of
Task 1's commit, `git status --short` showed 19-11's `attestation-ui.e2e.test.ts` staged
(`A `) in the shared index. A bare `git commit` would have taken it. It did not appear in
`0fd0367`.

**The observer specs fired twice, and attribution was measured rather than assumed.**
`bench-attestation.node.test.ts` compares `git status --porcelain` across its 155 s run.

| run | expected vs received | attributed to |
|---|---|---|
| first | `+ M packages/browser/demo/index.html`, `+ M packages/node/src/attestation-ui.e2e.test.ts` | 19-11 editing their own files mid-run. My three files appear in **both** readings, unchanged |
| second (full suite) | received `''`, expected two ` M .planning/…` lines | 19-11 **committing** `REQUIREMENTS.md` and `deferred-items.md` mid-run |

In both cases the file's **three attestation readings passed** — which is what mattered,
because this plan changed that file's parser. The final full run, taken from a clean tree,
was green including this file.

**Every `git add` was between runs, never during one.**

## Verification

| command | result | conditions (`/usr/bin/time -p`) |
|---|---|---|
| `npx tsc --noEmit` | **exit 0** | real 1.14, user 1.82, sys 0.43 — ratio 1.97 |
| `npx vitest run --project node` | **exit 0** — 138 files, 1911 passed, 2 skipped | real 218.61, user 228.95, sys 32.92 — ratio **1.198** |
| `npx vitest run --project browser` | **exit 0** — 243 files, 3792 passed | real 38.79, user 89.34, sys 20.49 — ratio 2.83 |
| `npx vitest run --project node packages/net/src/reduce-job.test.ts …quorum.test.ts …reduce.test.ts …combine.test.ts` | **exit 0** — 4 files, 101 tests. `quorum.test.ts` **unedited** | — |
| `npx vitest run --project node …bench-reduce …discover-arm …slow-specs` | **exit 0** — 27 tests | real 3.02, user 2.93, sys 0.48 — ratio 1.13 |
| `npx vitest run --project node …bench-attestation.node.test.ts` (parser change) | 3 readings passed; observer assertion red from 19-11's concurrent edits (green in the final full run) | real 155.60, user 6.24, sys 1.13 — ratio 0.047, dominated by the spawned child |

Every exit code was read with `EXIT=$?` on the line **immediately** after its command,
never through a pipe and never after a trailing `tail`. The one time a `${PIPESTATUS[0]}`
was tried it printed empty, and the run was redone without the pipe.

**Ratios, not bare figures**, per the owner's ruling at `f22275a`: the full node run's
`(user+sys)/real` of 1.198 is the comparability key for its 218 s, and the browser run's
2.83 says the same 38.79 s is far more parallel work. Machine-wide load average was 7–33
over the session and is **not** reported as the condition, because it counts I/O-blocked
threads and says nothing about whether this process got CPU.

## Self-Check: PASSED

- `packages/net/src/reduce-job.ts` — FOUND, contains `aggregateAttestation` and `attestationReceipt(`
- `packages/node/src/bin/bench.ts` — FOUND, contains `map attestation (` and `aggregate attestation (`
- `packages/node/src/bench-reduce.node.test.ts` — FOUND, contains the defect #31 requirement
- `.planning/phases/…/19-17-SUMMARY.md` — FOUND
- `ff2146a`, `ddc48d8`, `0fd0367`, `88efe4f`, `5b5007d`, `16cf7c2` — FOUND in `git log`
- working tree clean after every plant restore (`cp` + `cmp` exit 0; `git diff HEAD --stat` empty for the restored file each time)
- `vitest.config.ts`, `.planning/STATE.md`, `.planning/ROADMAP.md`, `.planning/BENCHMARK-RESULTS.md` — **untouched**, confirmed by `git diff`
