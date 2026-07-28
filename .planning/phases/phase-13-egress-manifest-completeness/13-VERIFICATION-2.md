---
phase: 13-egress-manifest-completeness
verified: 2026-07-28
pass: 2
status: human_needed
criteria_met: 3
criteria_partial: 0
criteria_total: 3
score: 3/3 amended criteria verified — the exact form each holds in is stated below
overrides_applied: 0
baseline:
  test_files: 124
  tests: 1798
  tsc: clean
  suite_rerun_after_reverts: 124 files / 1798 tests passing, tsc exit 0, tree clean
  head: 465351b
mutations_planted_by_verifier: 8
probes_run_by_verifier: 3
re_verification:
  previous_status: gaps_found
  previous_score: 0/3 against the ORIGINAL criteria
  note: >
    This pass verifies the criteria as amended in ROADMAP.md on 2026-07-28, not the
    wording 13-VERIFICATION.md quotes. Every finding below was produced by planting the
    mutation myself and pasting the real output. No 13-xx-SUMMARY.md claim was taken as
    evidence; three of them were checked and are reported as confirmed or corrected.
  gaps_closed:
    - "Criterion 1: the leaking cross-owner job now fails instead of completing as 'agreed' — and the proof runs across two spawned bin/agent.ts operating-system processes, not two FabricNode.start() calls in one Vitest process"
    - "Criterion 1: EgressGuard.send refuses rather than forwarding; the peer-delivery counter reads 0 for a refused frame and 1 for a legitimate one on the same instrument"
    - "Criterion 2: bin/bench.ts's egress leg is now held by bench-egress.node.test.ts; the edit the first pass identified as invisible — removing the call and its manifest read together — is now caught by a test rather than escaping the whole suite"
    - "The registration set is bounded: released from the serve path once the reply frame has settled, with five emptiness assertions, and the release point is mutation-proved to be load-bearing"
    - "The DATA-05 / DATA-06 ledger rows were rewritten and now state the detection granularity, the response-leg cost, and what the amendment gave up"
  gaps_remaining: []
  regressions: []
warnings:
  - id: W-1
    title: "A sovereignty refusal reaches the requestor as a bare timeout"
    severity: warning
    blocks_criteria: false
    measured: >
      Requestor-side failure reason on a refused sovereign reply, read off a live
      three-node in-process fabric by this pass:
      "dispatch to 12D3KooWBL6f… failed: rpc to 12D3KooWBL6f… timed out after 4000ms".
      No label, no reason, no attribution to egress. At the production default
      (DEFAULT_RPC_TIMEOUT_MS = 30_000) each refused dispatch costs the requestor 30 s
      of wall clock before it learns anything at all.
    verdict: >
      Acceptable under amended criterion 1, which requires only the refusal, the bytes
      staying put, and the job failing — all three verified. NOT acceptable against the
      project's own standing principle "Every exclusion is named" (STATE.md:332). See the
      dedicated section below for the full verdict and a bounded remedy.
  - id: W-2
    title: "PROJECT.md's Key Decision row claims a broader rule than the mechanism enforces"
    severity: warning
    blocks_criteria: false
    measured: >
      With the owner NOT already holding the sovereign row, the submitting node ships the
      raw 95-byte canonical input to the owner inside a 138-byte block-response frame. No
      production tap catches it: registration fires only on the SERVING side, only for a
      task about to execute, only when that node's local store already holds the input. I
      caught the frame only by planting a registration on the submitter's own guard —
      which is not something any production path does.
    impact: >
      PROJECT.md:217 states "The fabric will not move raw sovereign data, even between
      nodes the same owner controls." The mechanism delivers something narrower: raw
      sovereign data does not leave a node that currently holds a registration for it. A
      node holding sovereign bytes it is not executing against — including any submitter —
      has no registration and no refusal. Does not falsify any amended criterion, because
      the criteria are scoped to the owner-pinned configuration, but the row reads wider
      than the code.
info:
  - "ROADMAP.md's plan checklist still shows 13-04, 13-05, 13-06 and 13-07 as `[ ]`, though all four have SUMMARY.md files and landed commits. Bookkeeping only."
  - "ROADMAP.md:51 still carries the parenthetical 'un-checked 2026-07-28: the first independent pass scored it 0/3'. True of the ORIGINAL criteria; a reader arriving after the amendment may take it as current."
  - "EgressGuard.registrations has no non-test reader. It is an assertion surface, and the code says so. Not a defect."
  - "RpcReply is not re-exported from @o2/net's barrel (only RpcHandler is), so an out-of-package handler cannot name its own return type. Internal-only today; both users import from './rpc.ts' directly."
deferred:
  - truth: "The browser tier's sovereign-refusal branch has never executed in a real tab"
    addressed_in: "Phase 19 (WIRE-03)"
    evidence: "ROADMAP.md Phase 19 Constraints, recorded 2026-07-28 by Phase 13: 'That refusal path has no runtime coverage in a real tab anywhere… naming it here so the WIRE-03 planner knows there is now a *behavior* to exercise and not only a composition to inspect'. WIRE-03 is in Phase 19's Requirements list."
human_verification:
  - test: "Decide whether the response-leg refusal must become legible, and schedule it if so."
    expected: >
      Either a scheduled item that gives serveAgent's exec branch a pre-send scan so a
      refused reply becomes a small named outcome instead of silence, or an explicit
      ruling that a bare timeout is the accepted permanent behaviour for this leg, written
      where the standing principle is written rather than only in egress.ts's comment.
    why_human: >
      This is a product decision about what the fabric promises a requestor, not a fact
      about the code. The code's behaviour is unambiguous and I measured it. The amended
      criteria do not require the fix, and the standing principle does. Only the owner can
      say which governs.
  - test: "Decide whether PROJECT.md:217's 'the fabric will not move raw sovereign data' should be narrowed to the rule the mechanism actually enforces."
    expected: >
      Either the row is narrowed to 'raw sovereign data does not leave a node holding a
      registration for it', or submitter-side registration is scheduled so the row becomes
      true as written.
    why_human: >
      Scope call. The measurement is unambiguous — I watched the raw row cross — but which
      of the two ways to reconcile it is right is a decision about the fabric's promise.
---

# Phase 13: Egress Manifest Completeness — Second Independent Verification

**Phase Goal (ROADMAP.md):** Both `FabricNode` and the browser node construct their
`RpcEndpoint` over an `EgressGuard`-wrapped transport instead of the raw
`Libp2pTransport`, so the egress manifest is complete by construction on a real job.

**Branch:** `develop`, HEAD `465351b`
**Verified against:** the criteria **as amended 2026-07-28**, quoted below from ROADMAP.md
lines 283–285. `13-VERIFICATION.md` quotes the pre-amendment wording throughout; its
findings were read, its quoted criteria were not.
**Status:** all three amended criteria verified — two decisions escalated.

**Method.** Every mutation below was planted by me, run by me, and its output pasted
verbatim. Nothing was accepted from a SUMMARY. Three claims the executor flagged honestly
were re-derived independently and are reported as confirmed or corrected. Three live
probes were written, run, and deleted.

---

## Baseline, and the tree afterwards

```
$ git status --short
(clean)
$ npx tsc --noEmit
tsc exit: 0
```

After all eight mutation-and-revert cycles and three probes:

```
$ npm test
 Test Files  124 passed (124)
      Tests  1798 passed (1798)
   Duration  285.02s

$ npx tsc --noEmit
tsc exit: 0

$ git status --short --untracked-files=all
(clean)
```

Matches the stated baseline exactly. Every file I mutated was reverted with
`git checkout --` on that single named path, and each revert was confirmed byte-identical
against a copy taken before the edit. No `git add`, no commit, no file touched that I did
not myself write. The one file I created — a throwaway probe under `packages/node/src/` —
was removed, and `--untracked-files=all` confirms it.

---

## The three claims the executor flagged

### Claim 1 — "13-07 Mutation A hits two files, not the three the plan predicted"

**Confirmed, and the reason is exactly the one given.** I planted Mutation A myself and
`packages/net/src/sovereign-execution.test.ts` stayed green:

```
 Test Files  4 failed | 6 passed (10)   [across node + browser(chromium) projects]
```

`sovereign-execution.test.ts`'s owner nodes are `guardSovereignty(new WasmExecutor(...))`,
and the registration is a direct `guard.guard('alice-row', sovereignBytes())` call by the
test itself. A mutation inside `registerSovereignInputs` cannot reach a file that does not
use it. The prediction was wrong; the explanation is right.

**But I found a third file the executor's run could not have seen**, because it did not
include it in the mutation command: `packages/node/src/egress-refusal.node.test.ts` — the
two-spawned-process test — **also falls under Mutation A**, and it falls on precisely the
assertion that matters. See the next section.

### Claim 2 — "22 `serveAgent` call sites, not 21"

**Confirmed, and I can say exactly why both numbers appear.** There are **29** `serveAgent(...)`
invocation lines. **21** of them are object literals written at the call site. The other
eight all consume one options object built by `buildFull()` in `agent-contract.test.ts`.
So there are **22 places where `egress:` has to be written** — 21 literals plus `buildFull`
— and 22 is the number that matters, because it counts the sites a missing field would
have to be added to.

I also verified the summary's breakdown line by line: **five** supply a real guard
(`fabric-node.ts:411`, `browser-node.ts:264` — both shorthand `egress,` — plus
`sovereign-egress.test.ts:86`, `submit-with-egress.test.ts:83`,
`sovereign-execution.test.ts:176`), **seventeen** supply the sentinel. 5 + 17 = 22. Exact.

### Claim 3 — "`13-VERIFICATION.md`'s mutation 4 is not reproducible as written"

**Confirmed.** `submitJob` is exported from `packages/core/src/index.ts:42` and appears
nowhere in `packages/net/src/index.ts`'s export list. `bin/bench.ts` imports
`submitJobWithEgress` from `@o2/net` and does not import `submitJob` at all. Reverting the
call to bare `submitJob` as the first pass describes gives:

```
packages/node/src/bin/bench.ts(267,26): error TS2304: Cannot find name 'submitJob'.
```

— an unresolved-name error, not the `TS2339: Property 'manifests' does not exist` the
first pass quoted. To produce that quoted error the first pass must also have added the
import, which its text does not mention.

**The correction does not change that mutation's verdict, and the verdict is now moot
anyway.** I reproduced the substance both ways (see Mutation E / E2 below): a regression
in that leg was caught by `tsc` alone, and it is now caught by a test.

---

## Amended criterion 1

> A stream tap installed on the wire between two nodes started via `bin/agent.ts`
> **refuses the send** when a registered sovereign block would cross it, so the bytes
> never leave the node, and the running cross-owner job fails rather than completing as
> `agreed`

**VERIFIED.** Three elements, each measured.

### "refuses the send … so the bytes never leave the node"

`egress.ts:238-256` scans, pushes the entry, then throws `EgressRefusal` **before**
`#inner.send()`. I read the consequence off a live fabric rather than off the code:

```
alice's manifest, refused sovereign reply:
{"entries":[{"to":"…sCkY","bytes":73},
            {"to":"…sCkY","bytes":91,"violation":"bafyreieb6rt4tip4bww…"}],
 "totalBytes":73,
 "violations":["bafyreieb6rt4tip4bww…"]}
```

`totalBytes` reads **73**, not 164: the 91-byte frame is present in `entries` and
contributes zero, exactly as `EgressManifest.totalBytes`'s doc promises. A manifest holding
one refused frame is therefore distinguishable from a node that sent nothing — which is the
property the field exists for.

`egress.test.ts` closes the other half properly: the destination peer's delivery counter
reads **0** for the refused frame and **1** for a legitimate aggregate, **on the same
counter, in the same file**. "Nothing arrived" is asserted off an instrument shown able to
read something.

### "the running cross-owner job fails rather than completing as `agreed`"

`egress-refusal.node.test.ts` spawns two genuine `bin/agent.ts` processes via
`spawn(process.execPath, [AGENT, '--dir', dir, …])`, seeds alice's blockstore on disk
before her process opens it, dispatches an echoing module, and reads:

- `shard.verification.status === 'insufficient'`, never `'agreed'`
- `job.complete === false`
- exactly one failure, naming **alice's spawned peerId**
- the idle non-owner process, flagged `canExecuteSovereign: true` with `load: 0`, is
  never asked — the shard stalls where it stands rather than relocating the leak
- `alice.child.exitCode === null` and `signalCode === null` — a refused frame, not a dead
  process
- a control job on the **same two processes afterwards**, same row, same owner, same
  budget, module the only variable, reaching `'agreed'` with
  `verification.agreeing === [alice.peerId]`

That control ordering kills four alternative explanations at once — unreachability,
process death, module-fetch failure, and too short a budget — and it is ordered *after* the
refusal on purpose, which is the right way round.

**Four independent mutations each made this fall, all planted by me:**

| # | Mutation | File | Result |
|---|---|---|---|
| A | release the registration when `inner.execute()` resolves instead of after the reply frame leaves | `sovereign-egress.ts` + `agent.ts` | `expected 'agreed' not to be 'agreed'` at `egress-refusal.node.test.ts:228` |
| B | `EgressGuard.send` records and forwards anyway (the pre-13-04 behaviour) | `egress.ts` | 18 tests fail; same `'agreed'` failure across the two spawned processes |
| C | `new RpcEndpoint(egress, …)` → `new RpcEndpoint(transport, …)` | `fabric-node.ts` | 5 fail, including the same spawned-process assertion |
| D | remove `options.guard.guard(...)` from `registerSovereignInputs` | `sovereign-egress.ts` | 4 fail, including the same spawned-process assertion |

Every one is `tsc`-clean, so none of them would be caught by the type-checker. Verbatim
capture for the load-bearing one:

```
$ npx tsc --noEmit
tsc exit: 0
$ npx vitest run packages/node/src/egress-manifest.node.test.ts \
    packages/node/src/egress-refusal.node.test.ts \
    packages/net/src/egress.test.ts packages/net/src/sovereign-egress.test.ts \
    packages/net/src/submit-with-egress.test.ts packages/net/src/sovereign-execution.test.ts

 FAIL |node| egress-refusal.node.test.ts > DATA-05 — the refusal across two real bin/agent.ts processes
 AssertionError: expected 'agreed' not to be 'agreed' // Object.is equality
  ❯ packages/node/src/egress-refusal.node.test.ts:228:44

 FAIL |node| egress-manifest.node.test.ts > DATA-05 …
 AssertionError: expected 'agreed' to be 'insufficient'

 FAIL |node| sovereign-egress.test.ts > … the tap refuses the leaking reply
 FAIL |node| sovereign-egress.test.ts > turns a throwing executor into a named failure and still releases

 Test Files  4 failed | 6 passed (10)
      Tests  6 failed | 57 passed (63)
```

**This is the finding the executor's own run could not produce.** Its Mutation A command
covered three files and not `egress-refusal.node.test.ts`. Run against that file, the
mutation lets the leak reach `'agreed'` **across a real operating-system process
boundary** — which is a materially stronger demonstration than the in-process one the
summary captured. The release point is doing the work claimed for it, at the boundary the
criterion is about.

### "between two nodes started via `bin/agent.ts`" — the form this holds in, stated

Two nodes **are** started via `bin/agent.ts` and both participate in the job. The tap that
refuses is alice's, built by `FabricNode.start` inside her spawned process — production
wiring, no test-only path. What is not literally true: the refused frame's destination is
the submitter, which is a `FabricNode` in the Vitest process, because `bin/agent.ts` is
serving-only and never calls `submitJob`. There is no third process it could be without a
submitting binary that does not exist.

I am recording this as **met, in a named form**, not as partial, and the distinction is
deliberate. The defect the amendment was written to close was that the whole proof lived in
one heap; that is closed — the refusal happens inside a spawned process, on a real socket,
and its consequence is read from outside that process. The residual is a phrase no code
could satisfy today. Naming it is the honest treatment; calling it a shortfall would be
scoring against a sentence rather than against the thing it is about.

---

## Amended criterion 2

> Every job run through the browser demo emits an egress manifest recording exactly what
> left the **submitting** node, with byte counts, retrievable from the job's own result
> metadata after completion — not only inside a test harness

**VERIFIED.** Four elements.

**"Every job run through the browser demo."** Both — and only both — job entry points on
`window.o2` call `submitJobWithEgress`: `runColouring` (`demo/main.ts:312`) and `runJob`
(`demo/main.ts:552`). There is no bare `submitJob` anywhere in `packages/browser` outside
`visibility-governor.test.ts`. "Every" is exhaustive here, not a sample.

**"the submitting node."** Both call sites supply `[node.egress]` / `[n.egress]` — the
tab's own guard, which `BrowserNode.start:219-223` constructs over the transport and builds
`rpc` on top of. The submitting node's tap is the one read, which is precisely what the
amendment narrowed the promise to.

**"retrievable from the job's own result metadata … not only inside a test harness."**
Surfaced on `TabColouringRun.egress` / `TabJobReport.egress` (`tab-api.ts:28,127`) and read
back by two real-Chromium e2e tests off the `window.o2` API's own return value.

**Mutation G, planted by me** — `browser-node.ts`, `new RpcEndpoint(egress, …)` →
`new RpcEndpoint(transport, …)`, `tsc` exit 0:

```
$ npx vitest run packages/node/src/colouring-demo.e2e.test.ts

 FAIL |e2e| colouring-demo.e2e.test.ts > DEMO-01 … > runs every cube on two nodes and shows which two
 AssertionError: expected 0 to be greater than 0
  ❯ packages/node/src/colouring-demo.e2e.test.ts:156:39
    156|     expect(run.egress.entries.length).toBeGreaterThan(0)

 Test Files  1 failed (1)
```

Real Chromium, real WebRTC, the demo's own entry point. The manifest a visitor's page gets
back comes from that tab's real transport tap, and unwrapping it is visible.

**"with byte counts."** The e2e assertions read `entries.length > 0` and
`violations == []` and stop there, so I measured the byte figures myself rather than infer
them from the type. Planted a temporary reading in the same e2e test:

```
PROBE totalBytes: 5483  entries: [{"to":"12D3KooWSdUk…","bytes":173},
                                  {"to":"12D3KooWSdUk…","bytes":173},
                                  {"to":"12D3KooWSdUk…","bytes":173},
                                  {"to":"12D3KooWSdUk…","bytes":173}]
 Test Files  1 passed (1) — 6 tests
```

Byte counts are real in a browser tab. Reverted immediately. Worth stating plainly: the
byte figures are **true and unasserted** on the browser leg — the e2e tests would not
notice if they went to zero. A one-line `toBeGreaterThan(0)` in each of the two e2e tests
would close that, and I confirmed it passes.

**`bin/bench.ts` — the first pass's open hole is closed.** 13-06 added
`bench-egress.node.test.ts`, a call-site shape guard that strips comments first (so the
file's own prose describing a deleted call site cannot satisfy it) and proves it can report
each of its four requirements. Two mutations, both mine:

*Mutation E* — delete `guard: requestor.egress` from `realFabric`:

```
 FAIL bench-egress.node.test.ts > satisfies every call-site requirement in the real source
 +  "packages/node/src/bin/bench.ts — missing: realFabric hands the submitting node's own
     tap to the job path. Why it matters: Amended ROADMAP criterion 2 promises the manifest
     of the *submitting* node, and this is the site that supplies it. …"
```

*Mutation E2* — the edit the first pass named as invisible: revert to bare `submitJob`
**and** delete the `result.manifests[0]` read together:

```
 FAIL bench-egress.node.test.ts > satisfies every call-site requirement in the real source
 +  "… missing: the measured job path calls submitJobWithEgress with a guard array …"
 +  "… missing: the returned manifest is read, not merely requested …"
```

Two named requirements, each with the reason it matters. The edit that would have passed
the whole suite before now fails a test, and the failure message says which call site and
why. That is the gap `13-VERIFICATION.md` identified, closed and independently proven
closed.

---

## Amended criterion 3

> A job with zero sovereign data crossing the network records no violation over a
> non-empty manifest, and a job that legitimately moves an aggregate carries its raw input
> nowhere on the wire — with the pushdown size claim evidenced by `encodeCanonical(output)`
> against `encodeCanonical(rawInput)`, not by `manifest.totalBytes`

**VERIFIED**, and the second clause holds more strongly than the phase's own test asserts.

### "records no violation over a non-empty manifest"

The empty-manifest trap is closed at every assertion site. Five in-process sites pair
`violations == []` with `entries.length > 0`, plus two browser e2e sites. Mutation C makes
three of them fail with `expected 0 to be greater than 0`, which is the direct proof that
the pairing fires rather than decorating:

```
 FAIL > a clean pushdown job reports zero violations and a non-empty manifest …
 AssertionError: expected 0 to be greater than 0
 FAIL > a public job also gets a genuine, non-empty manifest …
 AssertionError: expected 0 to be greater than 0
 FAIL > a pushdown job's manifest reflects only the aggregate that crossed …
 AssertionError: expected 0 to be greater than 0
```

An absent instrument and a clean run do not look alike anywhere in this phase.

### "the pushdown size claim evidenced by `encodeCanonical(output)` against `encodeCanonical(rawInput)`"

`egress-manifest.node.test.ts:344-351` does exactly that and nothing else. Measured on a
live fabric by my own probe: raw input **95** canonical bytes, aggregate output **8**. The
amendment moved the evidence off `manifest.totalBytes` and the test follows it — I
confirmed `totalBytes` still reads **130** on that job, which is why the amendment was
right to move it.

### "carries its raw input nowhere on the wire" — measured, not assumed

The phase's test reads this off alice's tap alone. I checked it from the other side. I
registered the raw canonical row on the **submitting** node's own guard and re-ran the
pushdown job, so any frame in which the submitter shipped the raw input would be recorded
as its own violation:

```
PROBE[seeded] status  : agreed        rawBytes: 95   outBytes: 8
PROBE[seeded] alice   : {"entries":[{"bytes":73},{"bytes":57}],"totalBytes":130,"violations":[]}
PROBE[seeded] request : {"entries":[{"bytes":190},{"bytes":221}],"totalBytes":411,"violations":[]}
```

Zero violations on **both** taps. The raw input crosses in neither direction. The clause
holds, and it holds for a reason the test does not assert.

### The boundary, measured — see warning W-2

The same probe with the owner **not** already holding the row:

```
PROBE[unseeded] request : {"entries":[{"bytes":190},{"bytes":221},
                                      {"bytes":138,"violation":"raw-row-on-requestor"}],
                           "violations":["raw-row-on-requestor"]}
```

A 138-byte frame carrying the raw 95-byte row, submitter → owner, refused only because I
had planted a registration on the submitter's guard. **No production path plants one.**
Registration happens in `registerSovereignInputs`, on the serving side, only for a task
about to execute, only when that node's local store already holds the input.

This does not falsify criterion 3, and I am not scoring it as one: the criterion is about
"a job that legitimately moves an aggregate", and a submitter that holds another owner's
raw sovereign row has already broken the sovereignty premise before the fabric is involved.
`sovereign-egress.ts` states that premise explicitly and the phase's tests honour it.

What it does falsify is one sentence in the ledger. `.planning/PROJECT.md:217` reads *"The
fabric will not move raw sovereign data, even between nodes the same owner controls."* The
mechanism delivers something narrower and checkable: **raw sovereign data does not leave a
node holding a registration for it.** A reader of that row would not derive the boundary I
just measured. Recorded as W-2 and routed to a decision.

---

## The response-leg timeout — the verdict you asked for

> Is a sovereignty refusal arriving at the requestor as a timeout acceptable within these
> amended criteria, or is it a gap?

**Both, and the two answers are not in tension. Within the amended criteria: acceptable.
Against the project's own standing principle: an open, unclosed defect.**

### What I measured, not what the comment says

```
shard.verification.failures[0] = {
  "nodeId": "12D3KooWBL6f8u4apiC9nEkeaavHo4B1NuCcdncMrsCajwiUEF9G",
  "reason": "dispatch to 12D3KooWBL6f… failed: rpc to 12D3KooWBL6f… timed out after 4000ms"
}
```

No label. No mention of egress. No attribution. A requestor holding that string cannot
distinguish *"your data may not leave that node"* from *"that node is gone."* The
disclosure in `egress.ts:117-128` is accurate.

### Why it does not fail criterion 1

Criterion 1, as amended, asks for three things: the send is refused, the bytes never leave,
and the job fails rather than reaching `'agreed'`. All three are verified above, by four
independent mutations at a real process boundary. The criterion says nothing about the
requestor learning **why**, and it should not be read as implying it — the amendment note
is explicit that the criteria were moved to what is true and up where the refusal makes a
stronger claim available. Reading a legibility requirement into it now would be exactly the
move the amendment exists to stop.

### Why it is nonetheless a gap, and against what

`.planning/STATE.md:332` records, as a standing principle from Phase 6:

> **Every exclusion is named.** Silent filtering leaves a requestor unable to tell a dead
> network from a wrong clock from a module nobody can run.

The refused reply is an exclusion. It is not named. The requestor gets the exact
failure-mode ambiguity that sentence was written to remove — and gets it in the one place
the fabric's central promise is being enforced, which is the worst place for it. The phase
is owed acknowledgement here for two things and no more: the **requesting** leg *is* named
(`RpcFailure{kind:'send-failed'}` carrying the violated label, asserted to arrive in under
one second), and the responding leg's silence is disclosed in four separate places rather
than hidden. Disclosure is not closure.

### The cost the disclosure understates

`egress.ts:124-128` calls this "a latency and legibility complaint, not a correctness one."
The correctness half is right. The latency half is stated without its number, and the
number is load-bearing: `DEFAULT_RPC_TIMEOUT_MS = 30_000`. Every test that exercises the
refusal quietly shortens its budget to 4–10 s precisely because the wait dominates —
`egress-refusal.node.test.ts` documents choosing 10 s for this reason, and
`egress-manifest.node.test.ts` chooses 5 s. In production nobody shortens it. A sovereign
job whose map step forgot to aggregate stalls **30 seconds per shard, per replica**, and
then reports a timeout. That belongs in the disclosure alongside the word "latency".

### The remedy is bounded, and I want to be specific rather than rhetorical

`serveAgent`'s exec branch already holds the guard, the label, and the encoded reply. It
could scan its own reply against the guard before returning, and on a match return a small
`{ok: false, reason: 'egress refused: <label>'}` outcome instead — a frame that by
construction cannot carry the payload it is refusing. The requestor then learns the reason
immediately, on the existing `outcome.reason` path, with no change to any peer's
response-leg failure semantics, and the 30-second wait disappears. `rpc.ts` stays exactly
as it is. I have not implemented or measured this; I am naming it because "closing it would
mean changing every peer's response-leg failure semantics" is the reason `egress.ts` gives
for not closing it, and that reason does not obviously survive contact with this
alternative. Whoever takes the decision should evaluate it rather than take my sketch on
trust.

### Verdict

**Not a gap against Phase 13's amended criteria — do not re-open the phase for it.** It
*is* an open defect against a principle this project treats as standing, it is one of the
two things a second pass should surface, and it should be scheduled explicitly rather than
left as a paragraph in a doc comment. Escalated as a human decision, above.

---

## Reachability — every symbol this phase's gap-closure plans added

| Symbol | Non-test callers | Verdict |
|---|---|---|
| `EgressRefusal` | thrown at `egress.ts:253`; exported from the barrel | reachable in production; Mutation B proves load-bearing. No `instanceof` branch outside its own test — by design, the requesting leg branches on `RpcFailure.detail` |
| `EgressGuard.release` | `agent.ts:249` | reachable; Mutation A proves the placement load-bearing |
| `EgressGuard.registrations` | none outside tests | assertion surface, documented as such |
| `RpcReply` / `afterSent` | `agent.ts:235-251`, `rpc.ts:239-259` | reachable; not on the barrel |
| `AgentOptions.egress` | all 22 sites | required; Mutation F confirms `tsc` names it |
| `registerSovereignInputs` | `fabric-node.ts:376`, `browser-node.ts:257` | reachable from both real factories |
| `submitJobWithEgress` | `bin/bench.ts:267`, `demo/main.ts:312`, `demo/main.ts:552` | reachable from two runnable entry points |
| `sliceManifest` | none outside its own module | barrel export with no external caller (unchanged since pass 1) |

**Mutation F** — delete `egress,` from `fabric-node.ts`'s `serveAgent` call:

```
packages/node/src/fabric-node.ts(411,16): error TS2741: Property 'egress' is missing in
type '{ rpc: …; executor: …; blockstore: …; authorize: …; index: …; capacity: …;
reservations: …; ledger: …; onDispatch: … }' but required in type 'AgentOptions'.
tsc exit code: 1
```

The sentinel is not decorative. A node that omitted the field would register on every
sovereign dispatch and release none, and the type-checker is what stops that being written.

**Anti-patterns.** No `TBD`, `FIXME`, `XXX`, `TODO`, `HACK` or `PLACEHOLDER` in any of the
fourteen source and test files this phase touched.

---

## Mutation ledger — all planted, run, captured and reverted by this pass

| # | Mutation | File(s) | `tsc` | Test result |
|---|---|---|---|---|
| A | release on `execute` resolve, not after the frame settles | `sovereign-egress.ts`, `agent.ts` | 0 | 6 fail across 4 files — **leak reaches `'agreed'` across two spawned processes** |
| B | `send` records and forwards instead of refusing | `egress.ts` | 0 | 18 fail across 8 files |
| C | `RpcEndpoint` over raw transport (Node tier) | `fabric-node.ts` | 0 | 5 fail, incl. spawned-process assertion |
| D | registration call removed | `sovereign-egress.ts` | 0 | 4 fail, incl. spawned-process assertion |
| E | `guard: requestor.egress` deleted | `bin/bench.ts` | 1 | `bench-egress` names the missing call site |
| E2 | call **and** manifest read deleted together | `bin/bench.ts` | 1 | `bench-egress` names both missing requirements |
| F | `egress` field dropped from `serveAgent` call | `fabric-node.ts` | 1 | `TS2741` naming `'egress'` |
| G | `RpcEndpoint` over raw transport (browser tier) | `browser-node.ts` | 0 | real-Chromium e2e: `expected 0 to be greater than 0` |

Probes: (1) requestor-visible failure reason on a refused reply; (2) raw-input crossing
under seeded vs unseeded owner, with a submitter-side tap; (3) browser-tab byte counts.
All three written, run, and removed.

---

## Requirements coverage

| Requirement | Status | Evidence |
|---|---|---|
| DATA-05 | SATISFIED | Refusal verified by four independent mutations at a real process boundary; ledger row rewritten and now states the whole-payload granularity, the response-leg cost, and the registration lifetime. The row's claims match what I measured. |
| DATA-06 | SATISFIED | Submitting node's manifest reachable from three runnable entry points; browser leg mutation-proved in real Chromium; `bin/bench.ts` leg now held by a test rather than by `tsc`. The row's statement of what the amendment gave up is accurate. |

Both rows were rewritten by 13-06 and I checked them clause by clause against the code
rather than against the summaries. They no longer overstate.

---

## Score

| # | Amended criterion | Verdict |
|---|---|---|
| 1 | Tap on two `bin/agent.ts` nodes refuses the send, bytes stay put, job fails not `agreed` | **VERIFIED** — refusal, retention and failure all measured across two spawned processes; the destination of the refused leg is the in-process submitter, because the binary never submits |
| 2 | Every browser-demo job emits the submitting node's manifest with byte counts, from its own result | **VERIFIED** — both entry points, mutation-proved in real Chromium, byte counts measured in a tab. Byte figures are true but unasserted on the browser leg |
| 3 | No violation over a non-empty manifest when clean; aggregate job carries raw input nowhere, sized by `encodeCanonical` | **VERIFIED** — and the "nowhere on the wire" half holds on the submitter's tap too, which the phase's own test does not check |

**True score: 3 of 3 amended criteria verified.** Two of the three hold in a form worth
naming, and I have named both rather than letting the table carry them silently.

### What changed between the two passes, honestly

The first pass's three findings were real and all three are closed. The job now fails
instead of completing; the proof now runs across real processes; the `bin/bench.ts` leg now
has a test. None of that was accepted from a summary — I re-planted every mutation and one
of them (A against `egress-refusal.node.test.ts`) produced stronger evidence than the
executor's own run captured.

The criteria were amended before this pass, and it is fair to ask whether they were
weakened to be tickable. Reading the amendment note against what I measured: criterion 1
was made **stronger** (a refusal is a harder property than a post-hoc report, and it is the
one that took four mutations to falsify); criterion 3's second clause was moved off a
figure that was measurably wrong (130 vs 95 vs 8) onto one that is right, and the property
it now claims turns out to hold more broadly than asserted; criterion 2 alone was narrowed,
from "each owner's node" to "the submitting node", and the thing given up — cross-process
manifest retrieval — is recorded as a named future item in two places rather than quietly
dropped. That is an amendment I can verify against, and it is not the shape of a criterion
bent to fit its implementation.

What this pass adds is two things the first pass did not reach: a measured boundary on the
sovereignty guarantee that the Key Decisions row states more broadly than the code delivers
(W-2), and a verdict on the response-leg silence (W-1). Neither blocks the phase. Both need
a decision.

---

*Verified: 2026-07-28*
*Verifier: Claude (gsd-verifier), second independent pass*
*Working tree: clean at `465351b`; every mutation reverted with `git checkout --` on the single file I had written; no `git add`, no commit, no file touched that I did not myself mutate.*
