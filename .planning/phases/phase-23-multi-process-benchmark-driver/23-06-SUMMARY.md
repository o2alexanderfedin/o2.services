---
phase: phase-23-multi-process-benchmark-driver
plan: 06
subsystem: benchmark-driver, capability-dispatch, sovereign-placement, entry-point-reachability
tags: [BENCH-07, criterion-5, AUTH-03, capability-chain, delegate, CapabilitySupplier, opt-in-leg, DATA-10]
requires:
  - "packages/core/src/capability.ts — delegate and verifyChain (UNCHANGED)"
  - "packages/core/src/sovereignty.ts — eligibleNodes, publicNodes, NodeDescriptor (UNCHANGED)"
  - "packages/net/src/capability-authorizer.ts — authorizeCapability's four-step precedence (UNCHANGED)"
  - "packages/net/src/discover-candidates.ts — CandidateOptions.dispatch, the socket that was already open (UNCHANGED)"
  - "packages/net/src/submit-with-egress.ts — DATA-10's per-job sovereign registration (UNCHANGED, and load-bearing here)"
  - "packages/node/src/fabric-node.ts — FabricNodeOptions.sovereignty, ownRecords' sovereignFor derivation (UNCHANGED)"
  - "packages/node/src/capability-fixture.ts — read as a SHAPE, never imported (UNCHANGED)"
  - "packages/node/src/discover-arm.node.test.ts — the verification shape this plan's spec copies (UNCHANGED)"
  - "packages/node/src/bin/bench.ts — 23-03's Fabric-seam import and 23-04's try/finally hand-off flag (EXTENDED here, both preserved)"
provides:
  - "delegate and CapabilitySupplier have a production caller reachable from a runnable entry point: bin/bench.ts --discover --sovereign"
  - "a --sovereign flag that REFUSES rather than implies --discover, with a named message and exit 2"
  - "BENCH_OWNER_KEY, derived through delegate and cross-checked against a worker's own certificate before anything is dispatched"
  - "sovereignSupplierFor — one owner-to-node delegation per candidate, audience from audienceKeyOf, bounded expiry"
  - "a per-node sovereignty clearance on each --sovereign worker, spread rather than fielded"
  - "one owner-labelled shard, dispatched and admitted by a chain the serving node verified against its pinned root"
  - "sovereign-arm.node.test.ts — a 4 s spawn spec reading the leg's own line, and a second case watching the flag refuse"
  - "four new source-text pins holding AUTH-03's requestor half against silent deletion"
affects:
  - "23-05 — the published run is a DEFAULT run and is unmoved; this plan is sequenced before it deliberately"
  - "any later plan touching bin/bench.ts — the count pins over that file now include four AUTH-03 rows and a raised checkpoint opt-out"
tech-stack:
  added: []
  patterns:
    - "an opt-in leg whose dependency on another flag is a REFUSAL, not an implication, so no topology changes for a reason nobody typed"
    - "a derived key cross-checked against the fabric that issued it, at the one moment both exist"
    - "a test-only fixture copied as a shape with the refusal to import it stated at both ends, because the import would manufacture a reachability finding"
    - "a demonstration job run outside every timed region rather than a relabelled shard inside one"
    - "a count pin whose number did not move but whose comment did, because the ground under it did"
decisions:
  - "the leg is its own one-shard job during rig construction, NOT a relabelled shard at runnerOver's submit site — two measured blockers, both recorded below"
  - "the leg runs on the trivial fixture only; seeding the saturating fixture's single shared input would move what the control sweep measures"
  - "no new keypair: the chain roots at BENCH_USER_SEED, so ownerId, ownerKey and the enrolment user key are one string with one answer"
  - "redundancy 1, because every worker enrols under one user key and a sovereign shard is owner-attested by construction"
  - "checkpoint-optout-scope.node.test.ts's bin/bench.ts pin raised 1 -> 2 with the decision written beside it; the file caught the new submitter on its first opportunity"
  - "STATE.md, ROADMAP.md and REQUIREMENTS.md deliberately NOT touched — BENCH-07 is not closed by this plan, and 23-01 through 23-04 all took the same position"
metrics:
  duration: ~40m
  completed: 2026-08-05
---

# Phase 23 Plan 06: The opt-in sovereign leg — AUTH-03's requestor half gets a caller Summary

`delegate` and `CapabilitySupplier` shipped complete in Phase 15 with **zero production
callers**, and now have one:

```
--discover: 1 of 1 workers qualified from 1 providers
--sovereign: 1 of 1 sovereign shards agreed, chain rooted at ea4a6c63, audience 12D3KooWN9Uia3RowqdANian5gYawyDy1hvH84zsPCjaafGJDZ59
    map attestation (first completed run): owner-attested (replicas 1, operators 1) — owner-attested — computed once by the data owner and not independently verified
```

That is one owner-labelled shard, dispatched through a `RemoteExecutor` discovery built,
carrying a chain minted per-candidate for that candidate's own audience, verified by the
serving node's own `authorizeCapability` against a key it was pinned to before it started.
The flag is off by default and refuses to run without `--discover`.

## Commits

| commit | what |
|---|---|
| `63d10d9` | the flag, the refusal, and the owner key checked against the fabric that issued it |
| `58a7f72` | the chain, the clearance, the owner-labelled shard, and the count pins |
| `a39358a` | the spawn spec, and the checkpoint opt-out pin the leg reddened |

## What changed, by symbol

**`packages/node/src/bin/bench.ts`**

| symbol | change |
|---|---|
| `SOVEREIGN` | new. `process.argv.includes('--sovereign')`, beside `DISCOVER`, with a docblock giving four reasons: what it is for, why it is off by default, why it *requires* `--discover`, and that it is not a node kind |
| the refusal | new. `if (SOVEREIGN && !DISCOVER)` writes a named message plus a usage line to stderr and exits `2`, in `bin/agent.ts`'s `refuse` shape, before anything is constructed |
| `BENCH_OWNER_KEY` | new. `delegate(BENCH_USER_SEED, …).issuer` — the hex public half of the seed every `--discover` worker enrols under. Copied derivation, not an import |
| `sovereignSupplierFor` | new. `(nodeId) => (task) => task.label === 'sovereign' && task.ownerId !== undefined ? [delegate(BENCH_USER_SEED, {ownerId, expiresAt: now+1h, audience: audienceKeyOf(nodeId), abilities:['execute']})] : []` |
| `realFabric` — worker loop | a conditional `sovereignty` **spread**: `{ ownerId: BENCH_OWNER_KEY, canExecuteSovereign: true, ownerKey: BENCH_OWNER_KEY }`. Absent, not `undefined`, on the default path |
| `realFabric` — after the worker loop | the certificate cross-check. Throws naming both keys unless `started[0].certificate.userKey === BENCH_OWNER_KEY` |
| `discoverCandidates` call | `dispatch: SOVEREIGN ? sovereignSupplierFor : 'dispatches-unauthenticated'`, and the comment above it rewritten |
| `realFabric` — the leg | new block inside `if (DISCOVER)`, gated `SOVEREIGN && fixture === 'trivial'`: canonicalise one row, seed it onto every worker, submit a one-shard owner-labelled job, print the line, throw rather than report a zero |
| `configurationOf` | a `['sovereign', SOVEREIGN ? 'on' : 'off']` row beside `discover`, at both configuration-row sites |
| `unmet` | a new entry: a `--sovereign` run is not comparable with a default one, the leg is a dispatch-path demonstration and not a measurement, and it establishes no sovereignty claim *about data* |
| `memoryFabric`'s AUTH-03 comment | rewritten. It claimed the sentinel was permanent at *both* dispatch sites because every shard the driver submits is public — narrowed to this rig, with the reason the leg cannot run here: these endpoints serve unauthenticated permanently, so a chain would be accepted without ever being verified |
| `realFabric`'s AUTH-03 comment | rewritten for the same reason |
| `coverageReading` docblock | the phrase *"at the one submit site"* corrected to *"at the measured submit site, which is the only site any rung reaches"*, and the paragraph claiming this driver *"runs no sovereign shard"* corrected and extended |
| `RungAttestation.coverage` docblock | extended: still the named sentinel on every rung, including under `--sovereign`, because the leg's job is not a rung |

**`packages/node/src/serve-agent-hooks.node.test.ts`** — the count pins, and the describe-level
paragraph whose ground moved.

**`packages/node/src/sovereign-arm.node.test.ts`** — new, 359 lines.

**`packages/node/src/checkpoint-optout-scope.node.test.ts`** — the `bin/bench.ts` count raised
1 → 2 with the decision beside it.

## The deviation, and why the plan's version could not be built

The plan put the owner-labelled shard **at `runnerOver`'s submit site**, beside the fifteen
public ones. It is instead its own one-shard job inside `realFabric`. Two facts, both read
from source before the change and both since watched failing:

1. **`runnerOver`'s submit site is shared by every rig.** `publicNodes` (`core/src/sovereignty.ts`)
   hardcodes `ownerId: 'public'`, so `eligibleNodes` matches nothing for an owner-labelled
   shard against memory-rig descriptors. The memory sweeps run **before** the first real rig
   is built, so the driver would have failed on the arm the leg is not about, before the arm
   it is about existed.
2. **`submitJobWithEgress` registers every sovereign shard's canonical bytes on every guard it
   is handed, for the job's duration** — DATA-10, and its own module comment states the
   consequence: *"the submitter used to ship the raw bytes when the owner's `RpcBlockSource`
   asked for the input block; now that response is refused and the job fails."* This requestor
   **is** the block source for every worker. So the owner's own node has to hold the owner's row
   before dispatch, which is only possible where the nodes are built.

**Fact 2 was measured with a two-arm control, not asserted.** Same unseeded row, same rig,
same dispatch, one character different:

| shard label | outcome |
|---|---|
| `sovereign` | `insufficient: every executor failed; 12D3KooWFyk1…: input block missing: bafyreib5lrxgjvn6v3svidp2y7kqsu5qonyh3lqeav2vbrt7i4o35qgcsy` |
| `public` | `--sovereign: 1 of 1 sovereign shards agreed` — it fetched the row from the requestor and ran |

The only thing the label changes on the submitting side is DATA-10's registration. So the
refusal is the egress guard's, and the seeding is the mechanism working rather than a
workaround for a missing block source.

**Both facts make the leg a stronger reading than the plan's version, not a weaker one.** The
row really is resident on the owner's node, the submitter's guard really does refuse to ship
it, and the measured sweeps are untouched because the leg is not in them.

**Third deviation, smaller:** the leg runs on the **trivial fixture only**. The saturating
rig's sixteen shards all carry one identical value (`@o2/demo`'s design, not a shortcut), so
seeding a sovereign row there would put the control sweep's own input into every worker's
store and move what that sweep measures. The dispatch path is identical on both fixtures.
Named at the site and here, so it is a scheduled absence rather than an oversight.

## Proof that the default curve is unmoved

`bench --quick` with no other flag, run from `7061828` (the plan's base) and from this work,
in two temporary cwds, with every digit-run masked:

| comparison | masked stdout diff | masked report diff |
|---|---|---|
| base `7061828` vs this work | **4 lines** | 1 line added |
| this work vs **itself**, two runs | **4 lines** | — |

The four differing lines are the same four in both comparisons, and they are the two
`map attestation` lines that carry freshly-generated **libp2p peer ids**. A node's identity is
new on every start, so those lines differ between any two runs of any binary — which the
self-comparison establishes rather than assumes. **The base-vs-this-work difference is
entirely that noise: nothing else in the default run's stdout moved.**

The one added report line is the `unmet` entry — prose stating that a `--sovereign` run is
not comparable, in the section whose whole job is to say what a run did not establish. **No
figure, no table, no column, and no configuration row moved on a default run.** The
`['sovereign', …]` row renders only inside an excluded rung's or a criterion-3 attempt's
configuration list, and a clean run has neither.

At the source level the same claim is structural: every construction the leg adds is inside
`if (SOVEREIGN)`, and the clearance is a **spread** rather than a field, so on the default
path no `sovereignty` key reaches any `FabricNode.start` at all — the distinction
`exactOptionalPropertyTypes` makes, and the reason the `enrollment` spread beside it has the
same shape.

## Count pins, before and after

Read off the **edited** source with `grep -o -F | wc -l`, never assumed.

| pattern | before | after | note |
|---|---|---|---|
| `'dispatches-unauthenticated'` | 3 | **3** | unchanged — a ternary keeps the literal in the file. The **comment** was rewritten: its ground was *every shard this driver submits is public*, which is now false on one arm |
| `new RemoteExecutor(` | 2 | **2** | unchanged — the discover arm builds none of its own, which is why the supplier is one argument |
| `await discoverCandidates(` | 1 | **1** | unchanged |
| `function sovereignSupplierFor(` | — | **1** | new |
| `SOVEREIGN ? sovereignSupplierFor :` | — | **1** | new — the use, pinned by a pattern that can only be code |
| `label: 'sovereign'` | — | **1** | new |
| `canExecuteSovereign: true` | — | **1** | new |
| `'checkpoints-nothing'` in `bin/bench.ts` | 1 | **2** | raised, in `checkpoint-optout-scope.node.test.ts`, with the decision beside it |

Every other pin over this file was re-read and is unmoved: `'serves-unauthenticated'` 2,
`'serves-no-records'` 2, `'accepts-every-offer'` 0, `new LocalCapacity(` 2, `'keeps-no-ledger'` 2,
`'relays-for-nobody'` 2, `'reports-no-dispatch'` 2, `'issues-no-certificates'` 2,
`'signs-nothing'` 2, `attest:` 2, `'holds-no-registrations'` 2, `guardModuleProvenance(` 1,
`guarded(new WasmExecutor(` 3, `coverageReading(` 2.

**The obligation no assertion can enforce, stated because the plan required it be stated.**
Changing a pinned number without changing the comment beside it reddens nothing. The
`'dispatches-unauthenticated'` row is exactly that case here — the number held at 3 while the
sentence justifying it became false — and the only thing that fixed it was somebody reading
it. That file's own thesis rests on this discipline and no test in the repository checks it.

## Planted mutations, and the text each produced

All six applied, run, and restored in a single shell invocation each, with the occurrence
count of the plant target checked **before** running so an unapplied plant could not be
mistaken for a green one. Every restore verified with `cmp`.

| # | plant | observed |
|---|---|---|
| 1 | `BENCH_OWNER_KEY` derived from a different seed | both real rungs `excluded: --sovereign: the derived owner key fd172438… is not the key a worker enrolled under (ea4a6c63…); every sovereign shard would be unplaceable`, and `real transport egress manifest: 0 frames, 0 bytes` |
| 2 | `sovereignSupplierFor` returns nothing | `--sovereign: 0 of 1 …` then `excluded: … (insufficient: every executor failed; 12D3KooWHZc1…: unauthorized: no capability chain supplied)` |
| 3 | **the chain minted with a different private key** | `unauthorized: link 0 is issued by 1398f62c6d1a457c51ba6a4b5f3dbd2f69fca93216218dc8997e416bd17d93ca, but the data owner's key is ea4a6c63e29c520abef5507b132ec5f9954776aebebe7b92421eea691446d22c` |
| 4 | `canExecuteSovereign: false` | `--sovereign: 0 of 1 …, audience nobody` then `excluded: … (insufficient: no executable node for owner ea4a6c63…)` — refused before any node was asked, in 1 ms |
| 5 | the owner's row not seeded onto the owner's node | `insufficient: every executor failed; …: input block missing: bafyreib5lrxgjvn6v3svidp2y7kqsu5qonyh3lqeav2vbrt7i4o35qgcsy` |
| 6 | the leg's block made unreachable | `sovereign-arm.node.test.ts` Case 1 fails: `bench exited with 0 before the leg spoke` |
| 7 | the refusal replaced with an implication | Case 2 fails on the exit code, after a **full** run it should never have started (83 s) |

**Plant 3 is the one that matters.** It is what separates *a chain was minted* from *a chain
was verified*: the leg cannot pass by producing something merely shaped like a chain, because
`verifyChain` checks the root against the key the serving node was pinned to, and says both
keys when they disagree.

**Plant 1 is weaker than the plan predicted, and this is a correction rather than a
confirmation.** The plan says the run *"stops"*. It does not — this driver sets no exit code
(its own header says so at length: *"The exit code tells you nothing"*), so a rung that throws
is reported as `excluded:` and the process exits `0`. What the check buys is still the whole of
what it was for: the failure is **named, at the rung, with both keys in it**, and the real
curve is absent rather than silently zero. But nothing about the exit code carries it, and a
CI gate keyed on `$?` would not see it.

## What `sovereign-arm.node.test.ts` cannot prove, and what does

Stated in the file's own header rather than only here. **It cannot tell a chain that verified
from a chain the worker was never asked for** — both produce an agreed shard, and from stdout
the two are the same sentence. A driver printing `--sovereign: 1 of 1 …` from a constant would
pass every assertion in it; the count is parsed rather than matched, but a constant parses.

What carries that half is the **driver's own throw**, and plants 2–5 above are the readings
that make it a proof rather than a branch.

What the spec *does* carry, beyond a source-text count:

- the leg **ran**, in a real process, against real libp2p nodes;
- the printed root equals a key **the spec derives itself** through `delegate` from
  `new Uint8Array(32).fill(7)` — so a leg rooted at another key disagrees, and the value is
  not transcribed from the driver's output;
- the audience is a peer id and not the driver's word for `nobody`, which distinguishes
  *dispatched and admitted* from *unplaceable and reported*;
- the `--discover:` line appeared too — the anti-vacuity reading, since a sovereign shard is
  placed only against a descriptor the discover arm builds;
- the denominator is **exactly 1**, so a run that labelled every shard sovereign fails;
- `cwd` is asserted under `tmpdir()` **before** anything is spawned, and
  `.planning/BENCHMARK-RESULTS.md` and `.planning/bench/raw.json` are compared by
  `git status --porcelain -- <those two paths>` across the run, with the report also compared
  byte-for-byte.

The porcelain check is narrowed to two paths rather than the whole tree, for
`coverage-agents.node.test.ts`'s stated reason: two sibling specs snapshot the whole tree and
both went red because a concurrent agent staged a file mid-run.

**Measured, recorded, not asserted:** the `--sovereign:` line arrives at **t+1494 ms** at load
4.5; the whole `--quick --discover --sovereign` run is **6.4 s** wall. Both files together run
in 4.4 s. The spec asserts no duration.

## Verification

| reading | result |
|---|---|
| `npx tsc --noEmit` | **exit 0** (`EXIT=$?` on the next line, no pipe) |
| `npx vitest run --project node` | **exit 0** — 159 files, 2258 passed, 2 skipped |
| baseline at `7061828` | 158 files, 2255 passed — so **+1 file, +3 tests**, all new |
| `/usr/bin/time -p` on the full node project | `real 256.85` `user 334.92` `sys 48.55` → `(user+sys)/real` = **1.49** |
| load | 7.08 at start, 16.31 at end (this run's own contribution) |
| `pgrep -f "agent.ts --dir"` after the full run | **0** |
| `pgrep -f "bin/bench.ts"` after the full run | **0** |
| `.planning/BENCHMARK-RESULTS.md`, `.planning/bench/raw.json` | byte-identical across everything above; `git status --porcelain` clean but for the commits |

23-04's two lifetime repairs are intact and were re-read rather than assumed: `realFabric`
still declares as `async function realFabric` (three source-scanning guards read it by name),
its `try`/`finally` and `handedOver` flag are untouched, and the leg is **inside** that `try`
— so a leg that throws releases every node the rig started on the way out, which is what the
`pgrep` readings above measure.

## Gaps, stated rather than narrowed away

1. **`--project browser`, `--project e2e` and `--project perf` were not run.** Every file
   touched is either `bin/bench.ts` — which no browser-tier spec imports — or a
   `*.node.test.ts`, and the browser project's config excludes `**/*.node.test.ts` by name.
   That is a reasoned scope, and it is not a measurement: those projects were not executed.
2. **No full (non-`--quick`) run was taken under `--sovereign`.** The leg was measured on
   `--quick`, whose real ladder is `[1, 2]`. Rungs of 4, 8 and 16 nodes have not run it. Nothing
   in the leg depends on node count — it submits one shard at redundancy 1 whatever the rung —
   but that is an argument, not a reading.
3. **The leg establishes nothing about *data* sovereignty.** The shard carries an owner label
   and a verified chain; its value is a fixture row this driver invented. The egress manifest
   and coverage machinery are what would make a data claim. Recorded in the report's `unmet`
   list as well as here.
4. **`memoryFabric` and `processFabric` have no sovereign leg**, as the plan scoped. The first
   because its endpoints serve unauthenticated permanently, so a chain there would be accepted
   without being verified and would prove nothing; the second because it would need a provider
   reachable from every child and three more flags per spawned agent, for a criterion already
   closed on the discover arm.
5. **Plant 1's failure mode is `excluded:` and exit 0, not a stopped process** — see the
   correction above. Anything that wants a non-zero exit from this driver has to add one, and
   that is this driver's contract to change rather than this plan's.
6. **The count-pin comment discipline is unenforced.** Recorded above because it is the one
   obligation in this plan that no assertion in the repository can check.

## Self-Check: PASSED

Every file this summary names exists on disk; every commit hash it names is in
`git log --all`. Checked 2026-08-05 after the final commit.
