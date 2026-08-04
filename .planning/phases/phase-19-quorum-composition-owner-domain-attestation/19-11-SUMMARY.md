---
phase: phase-19-quorum-composition-owner-domain-attestation
plan: 11
subsystem: browser-tier, demo-ui, result-attestation
tags: [VER-09, VER-10, criterion-3, display, e2e, defect-34]
requires:
  - "packages/core/src/job/submit.ts — the receipt on JobResult, and receiptFor (19-06)"
  - "packages/core/src/index.ts — ShardAttestation re-exported (19-10)"
  - "packages/browser/src/browser-node.ts — attestResults composed at the factory (19-15)"
  - "packages/browser/demo/main.ts — the sovereign submit option (19-04)"
  - "packages/net/src/discovery.ts — RpcRecordIndex, the client half of `records`"
provides:
  - "criterion 3's demo-UI half: owner-attested read off the rendered page, and a stated absence where a replica could not be checked"
  - "BrowserNode.signingExecutor — defect #34's close, so an in-process dispatch produces a checkable statement"
  - "the page's shipped overstatement removed: 'each cube ran twice, on different nodes' is gone from both places it stood"
  - "a fourth, comparative reading: a strength appears in exactly the run where nothing went unaccounted"
affects:
  - "19-12 (mutation ledger) — six find/replace pairs recorded below, all in files this plan owns"
  - "whoever verifies criterion 3 — both VER-09 and VER-10 stay unticked, with the open clause named in each row"
tech-stack:
  added: []
  patterns:
    - "the page renders the receipt's description and composes no sentence of its own"
    - "a certificate off the wire is pinned against an anchor held before the peer spoke, never against its own issuer"
    - "a comparative reading across runs, in place of an absolute threshold"
key-files:
  created:
    - packages/node/src/attestation-ui.e2e.test.ts
  modified:
    - packages/browser/src/tab-api.ts
    - packages/browser/demo/main.ts
    - packages/browser/demo/index.html
    - packages/browser/src/browser-node.ts
    - .planning/REQUIREMENTS.md
    - .planning/phases/phase-19-quorum-composition-owner-domain-attestation/deferred-items.md
decisions:
  - "defect #34 closed by routing the self-dispatch through the signing wrapper, not by displaying the absence — measured cheap, and it does not disturb BrowserNode.executor's concrete type"
  - "the peer certificate is verified against this tab's own issuer, because BrowserNodeOptions has no trustedIssuers field at all"
  - "TabApi.start gains enrollment; capability-harness.ts's rule against node configuration on the page contract is distinguished rather than broken"
  - "a peer this tab cannot name is still dispatched to — excluding it would be a node class invented by a caption"
  - "VER-09 and VER-10 deliberately NOT ticked: owner-domain is displayed by nothing, anywhere"
metrics:
  duration: ~1h15m
  completed: 2026-08-03
---

# Phase 19 Plan 11: The label a visitor reads Summary

The demo page now tells a visitor how strongly its answer was attested, in the kernel's own
words, and stops telling every visitor that each cube ran twice on different nodes when
sometimes it ran once. An enrolled tab that ran every cube on its own worker was measured
printing **`owner-attested — computed once by the data owner and not independently verified`**
on screen; the same tab beside a peer it could not account for printed the **named absence**
naming that peer, and none of the three strength sentences.

```
Best settled: n = 500, every cube agreed: true
Verification cost 1.00×.
How strongly was it checked: owner-attested — computed once by the data owner and not independently verified
Established over 1 replica from 1 operator.
```

```
Verification cost 2.00×.
How strongly was it checked: nothing established. 2 replicas agreed on the least-attested cube, and 1 of those produced a signed statement this tab could check.
only 1 of 2 agreeing replicas produced a signed statement this requestor could check, and a strength over that subset would state something this requestor cannot account for — 12D3KooWG2nh…: this requestor holds no certificate for it
```

Both off `#run-report`, on the built bundle served by a dumb 404-ing file server.

## Defect #34 — closed by routing the self-dispatch, and here is the measurement

**The brief's reading was that displaying the absence honestly is almost certainly correct, and
it asked for that to be verified rather than assumed. It was verified, and the other answer
won.** The condition for preferring it was stated precisely — *if routing the self-dispatch
through the signing wrapper is both cheap and does not disturb `BrowserNode.executor`'s concrete
type*. Both halves measured true.

**Cheap:** one field. `attestResults(executor, attestor)` was already computed at
`browser-node.ts` and already handed to `serveAgent`; it simply was not held on the class. The
change is `readonly signingExecutor: Executor`, one constructor parameter, one assignment.

**Does not disturb the concrete type:** `BrowserNode.executor` is still exactly a
`GovernedExecutor`. BROW-04 reads `executed` and `dutyCycle` off it and still does; the wrapper
delegates, so the counter still increments. The guards that hold that shape were run and stayed
green — `browser-node-contract.node.test.ts`, `trust-anchors.node.test.ts`'s
`SIGNING_CONSTRUCTION_SITES`, and `serve-agent-hooks.node.test.ts`'s sentinel counts, which are
unmoved at `'signs-nothing'` → 1 and `attest:` → 1.

**Why it is the better answer, and why it is not the special case the brief warned against.**

19-15's recorded reason for leaving the self-dispatch unsigned was *"a node's signed statement
to itself establishes nothing it did not already hold"*. That is true of what the **tab** learns
and false of what the **receipt reports**, and the receipt's audience is whoever is shown the
answer. The scope error had a measured consequence: `demo/main.ts` puts this tab's own executor
into **every** job it composes — `runColouring` unconditionally, not only on `includeSelf` — so
`receiptFor` reported the named absence for every job the demo has ever submitted, including one
an enrolled tab ran entirely by itself. For that run, *"this requestor cannot account for who ran
this shard"* is not a modest statement; it is a false one about a shard the requestor ran in its
own worker.

Nothing is special-cased into a label. The self-replica goes through the same wrapper a peer's
result goes through, is checked by the same `receiptFor` against the same pinned issuer, and is
refused on the same terms if it does not verify. A tab nobody enrolled composes the same field —
`attestResults` returns its argument for a node with no identity — so its self-replica stays
unaccounted and its receipt stays the named absence. The strength follows what was established,
which is the only rule this plan is allowed to follow.

**And the absence is still displayed honestly, because that was never in competition with this.**
Two of the three readings are absences, the page states them rather than blanking, and deferred
item 7 records that a real visitor's receipt is an absence on every run today.

## What the plan's `<interfaces>` block got wrong, measured

**`BrowserNodeOptions` has no `trustedIssuers` field.** `FabricNodeOptions` has one
(`fabric-node.ts:365`); the browser tier does not, and `grep` returns zero for it under
`packages/browser`. The plan's `<behavior>` says a fetched certificate is *"verified against the
anchors the tab already pins"* — the tab pins `trustAnchors`, which are **build** authorities
checked by `NameResolver` against a module's signed record. Using those as certificate issuers
would be this phase's own conflation wearing a new hat.

**So the anchor is this tab's own issuer**, which is the only provider key it holds and is held
before any peer speaks. A tab enrolled by nobody has no anchor and names nobody — the honest
answer, and not a degradation, because *"I checked nothing"* and *"I checked and it failed"* both
mean this tab cannot vouch for that peer.

**Why the check has to be in the page at all**, which is the finding that justifies the whole
`verifyCertificate` call and is measured by the third reading: `receiptFor` verifies a replica's
attestation against **`descriptor.certificate.issuer`** — the issuer named by the descriptor it
was handed. A certificate taken off the wire and put on a descriptor unverified therefore
supplies its own trust root. Plant P5 removed the pin and the page printed, to a visitor:

```
How strongly was it checked: independently verified — replicas from separate operators agreed
Established over 2 replicas from 2 operators.
```

for a run whose second "operator" was a stranger this tab had never pinned. That is exactly a
strength the run did not establish, on the surface with the widest audience.

## What was built

### Task 1 — descriptors carry signed statements, and both reports carry the receipt

**Commits:** `19ae2cf` (RED), `be800a9` (GREEN)

`TabJobReport` and `TabColouringRun` each gained `attestation: ShardAttestation` — `JobResult`'s
own value, passed through, derived from nothing. The visitor-facing report's change is the stated
exception to the rule `TabJobReport.failures` records for itself, and both docs now say so:
criterion 3 requires the label *wherever a result is displayed* and names the demo UI, and that
report is what the demo UI renders.

`publicNodes(executors)` is gone from both submit sites, replaced by `attestedNodes`, which keeps
that function's placeholders exactly (`ownerId: 'public'`, `canExecuteSovereign: true`,
`load: 0` — moving either would change *placement* in a plan whose subject is a label) and
answers the one field that was not a placeholder. This tab's own certificate comes from memory; a
peer's comes over the `records` request this tier already **serves** on terms byte-identical to
the Node tier's, which is NET-06's claim exercised from the reading side.

Three properties the plan asked for, each built rather than promised:

- **A peer this tab cannot name is still dispatched to.** `attestedNodes` maps over the executor
  list and never filters it. Excluding an unnamed peer would be a node class invented by a
  caption, and the second and third readings both run jobs across a peer whose certificate the
  tab refuses.
- **A records fetch cannot fail a job.** `RpcRecordIndex` already swallows a transport error into
  `undefined`; the call adds a `catch` for anything it does not, and races a
  `RECORDS_DEADLINE_MS` (5 s) timer so a wedged peer cannot hold a job for this page's
  `rpcTimeoutMs` of 60 s. Both arms land on the same named absence.
- **The identity is checked.** The node key is derived offline from the peer id
  (`nodeKeyForPeerId`) and the answer's `nodeKey` is compared against it, so asking a peer who it
  is and believing the reply is not a path.

`TabApi.start` gained `enrollment`, and `capability-harness.ts`'s recorded rule against putting
node configuration on the page's contract is **distinguished rather than broken**: `sovereignty`
pins which dispatches a node accepts and no visitor-facing surface reports it, while `enrollment`
decides whether this node's statements can be checked by anybody else — which criterion 3
requires this page to display on every run. A surface obliged to say how strongly an answer was
attested, with no way to be given an identity to attest with, can only ever display the absence.

### Task 2 — the page says it, and a test reads it off the screen

**Commits:** `c31041a` (RED), `57b6165` (GREEN), `d118b6d` (the comparative reading)

The report block renders `attestation.description` — the kernel's sentence — with the replica and
operator counts beside it, and on the absence arm says how many replicas agreed, how many of
those this tab could check, and `receiptFor`'s own reason naming each one it could not.

**The shipped overstatement is corrected in both places it stood.** The plan names the report
line; a second copy sat in the static prose above the Run button (*"each cube is run twice, on
different nodes, and the two must agree"*), asserted to every visitor before any run at all. Both
are now conditional on what happened. The verification-cost figure is measured and correct at any
redundancy and stays.

`describeAttestation` is **not** called. The page renders `attestation.description`, which
`attestationReceipt` filled from it — so 19-10's warning is honoured and both ledger rows keep a
claim that is still true. Measured, not assumed: the only production occurrence is inside
`quorum.ts` itself.

## The proofs

### Plants, with find/replace pairs for Plan 19-12

Every plant was run, watched, and restored by `cp` + `cmp` (exit 0 each time), never by
`git checkout --`. `git diff HEAD --stat` was read after each restore.

| # | file | find | replace | observed |
|---|------|------|---------|----------|
| P1 | `packages/browser/demo/index.html` | `` `How strongly was it checked: ${attestation.description}` `` | `` `How strongly was it checked: checked properly` `` | **solo case RED alone**, both absence cases green: `expected … to contain 'owner-attested — computed once by the…'`, with `How strongly was it checked: checked properly` on screen |
| P2 | `packages/browser/demo/index.html` | `` `Verification cost ${…}×.` `` | the old two-line form ending `on different nodes, and the two had to agree.` | **all three RED**: `expected … not to contain 'on different nodes'`, at `1.00×` and `2.00×` alike |
| P3 | `packages/browser/demo/index.html` | the absence arm's two composed lines | `attestationReceipt([])`'s answer — `owner-attested …` + `Established over 0 replicas from 0 operators.` | **the two absence cases RED, solo green**: `expected … not to contain 'owner-attested — computed once by the…'` |
| P4 | `packages/browser/demo/index.html` | `lines.push(...attestationLines(best.attestation))` | `window.__attestation = attestationLines(best.attestation)` | **all three RED** while the page computed the right value — the plant that proves the assertions read the screen and not `window.o2` |
| P5 | `packages/browser/demo/main.ts` | the `verifyCertificate(…)` pin and its ternary | `return answered.certificate` | **case 3 RED alone**, printing `independently verified — replicas from separate operators agreed` / `Established over 2 replicas from 2 operators.` for a stranger |
| P6 | `packages/browser/demo/index.html` | the absence arm's first line | `owner-attested — computed once by the data owner and not independently verified` | **the comparative case RED**: `expected { label: 'unenrolled peer', strength: false } to deeply equal { …, strength: true }` |

**P5 is this plan's most valuable plant** and it is the one the third reading exists for.
`attestationReceipt([])` returning `owner-attested` for an empty set — the failure the plan named
— is P3, and it reddened only the two absence cases, exactly as designed. P5 is worse and less
obvious: nothing is empty, two real nodes sign two real attestations under two real certificates,
and the fabric reports the strongest label it has for a run in which one of the two was never
checked by anybody the tab trusts.

**P1 was substituted, and the substitution is stated rather than quietly made.** The plan asked
for `describeAttestation` in `packages/core/src/quorum.ts` to be planted. That file is shared
production code and 19-17 was executing concurrently on this working tree with a spec that reads
all three strength sentences; a transient plant there would have reddened their suite for a
reason that was not theirs, which is the class of interference this phase has already lost work
to. The property planted instead is the same one — *the page renders rather than paraphrases* —
and it is planted in a file this plan owns. What it does not prove is that `description` came
from `describeAttestation`; `quorum.test.ts` owns that link, and the assertion constants here are
`describeAttestation(...)` calls, so a change to the kernel's words moves both sides together.

### The RED gates, observed

**Task 1's** RED is the type-level one, and it named exactly the two sites that build a report:

```
packages/browser/demo/main.ts(406,9): error TS2322: … Property 'attestation' is missing …
packages/browser/demo/main.ts(670,9): error TS2719: … Property 'attestation' is missing …
```

**Task 2's** RED ran the whole fixture and failed on content, not on a harness that never
started: all three cases reached a settled ladder and each report ended
`Verification cost N× — each cube ran twice, on different nodes, and the two had to agree.`

**One gap in the RED gate, stated.** `TabApi.start`'s `enrollment` is optional and
`BrowserNodeOptions.enrollment` is optional, so a forgotten passthrough would have type-checked
clean — this phase's recorded defect twice over. It is guarded behaviourally instead: the first
reading cannot produce `owner-attested` without the passthrough, because an unenrolled tab has no
certificate and its own replica goes unaccounted.

### The comparative reading

Added under the owner rule at `f22275a`. The fourth case reads no absolute — no count, no
threshold, no wall clock — only the three rendered reports against each other, and requires a
strength to appear in **exactly** the run where nothing went unaccounted. It encodes defect #34's
own statement: *one replica this requestor could not check* is a comparison between what was
checked and what was not, never a threshold. Before this plan the solo run failed it in the other
direction. P6 confirms it can fail.

The engine-against-engine comparison is **not available** here — the `e2e` project is
chromium-only for all thirteen specs, and `static-rendezvous.e2e.test.ts` is the repository's only
multi-engine reading. The file says so rather than claiming it.

## Deviations from Plan

### Auto-fixed issues

**1. [Rule 3 — blocking] `BrowserNode` did not expose the executor that signs**

- **Found during:** Task 1, and it is defect #34 itself.
- **Issue:** the plan's first proof requires a one-replica run on the tab's own worker to produce
  `owner-attested`. It could not: `node.executor` is the unsigned `GovernedExecutor`, so the
  tab's own replica reported the sentinel and `receiptFor` returned the named absence.
  `browser-node.ts` is not in `files_modified`, and the task is unreachable without it — 19-04
  hit the same shape in the same file for the same kind of reason.
- **Fix:** `readonly signingExecutor: Executor`, holding the value the factory already computed.
  The composition-site comment that recorded the old reading is retracted at the line rather than
  deleted, with the scope error named.
- **Commit:** `be800a9`

**2. [Rule 2 — a false statement left standing] The static prose carried the same overstatement**

- **Issue:** the plan names `index.html`'s report line. The claim also stood in the page's own
  description of the job, above the button, where every visitor reads it before any run exists.
- **Fix:** both corrected. Leaving one to keep to the plan's letter would have left the defect on
  the page while reporting it closed.
- **Commit:** `57b6165`

**3. [Rule 3 — blocking, and not this plan's] A vocabulary violation refused every commit**

- **Found during:** the first commit.
- **Issue:** `CLAUDE.md:382` carried a banned term, arriving in `7b00121` seven minutes earlier
  from a concurrent writer. The pre-commit guard reads `git ls-files` and refused. Attributed by
  measurement — the line was at `HEAD` and unmodified in the working tree — rather than assumed.
- **Fix:** none by this plan. The first commit used `O2_SKIP_GUARDS=1` with the reason in its
  message, and the six cheap guards were run by hand and read. `ff2146a` fixed it minutes later
  from the same other agent, and every subsequent commit ran the hook normally.

### Deliberate departures from the plan's letter

**Three readings, not two, and no relay.** The plan asks for a one-cube redundancy-1 run and a
peer run over the `?relay=` fixture. A first draft used two browser contexts over a real relay
and **measured badly for this file's question**: the relay is itself a `FabricNode` serving the
agent protocol, so `computePeers()` counted it and three nodes computed —
`1 peer(s)` became `2 peer(s) · 24 cubes per rung`. `JobResult.attestation` reports the *first*
shard carrying an absence, so which unaccounted node the page named depended on which pair took
cube 0, and the assertion would have had to be weakened to *"some node was unnamed"*. With a
`FabricNode` peer dialled directly there is one answer, deterministically. All nodes have equal
functionality and only discovery differs, so the peer being a Node process changes nothing on the
page's path — the same offer, the same `records` request, the same `RemoteExecutor`.

The third reading is an addition: a peer holding a **valid** certificate from a provider this tab
does not pin. It is the sharpest of the three and the only one that guards the fix rather than
the display.

**What that gives up, stated:** no reading here is taken over WebRTC or through a relay.
`colouring-demo.e2e.test.ts` drives the identical page path across two tabs and
`static-rendezvous.e2e.test.ts` does it on this same built bundle across three engines; neither
reads a label, and this file reads no transport.

**The `vite build` cost the plan asked me to weigh.** Measured rather than estimated: **1943 ms**
cold and **943 ms** warm, against a whole-file wall clock of 14.91 s. Sharing one build across the
three specs that run one would save about a second and would cost a real coupling — a spec that
no longer builds cannot fail when the sources break the bundle, which is the single property
`built-bundle.e2e.test.ts` exists for. Not worth doing on these numbers, and the numbers are in
the file header so the next reader does not have to guess.

## Requirements deliberately NOT ticked

**VER-09 and VER-10 keep their unchecked boxes**, and both rows were edited to say what closed and
what did not, rather than to say "19-11 will do it".

- **VER-09.** Both display sites now carry the label and both were measured. What stays open is
  that every reading in existence is of a **public** job at `redundancy: 1`, while the row's own
  wording is about *an owner with fewer than two live nodes* — the sovereign path. The label is
  computed by one expression for both, so the mechanism is shared; but no surface has shown it
  for a sovereign shard, and *unmeasured is not met*.
- **VER-10.** `owner-domain` is displayed by **nothing, anywhere** — measured on both surfaces.
  19-10 recorded that no `bin/bench.ts` rung produces two nodes under one operator; no demo
  topology does either. The middle label, which is what this row's first clause is about, is read
  only off `ShardResult` in `quorum-agents.node.test.ts`. Filed as deferred item 6.

`.planning/STATE.md` and `.planning/ROADMAP.md` were **not** touched, per the executor brief.

## What this does not establish

- **That a real visitor ever sees a strength.** They do not. `autoStart` passes no `enrollment`,
  deliberately, and the demo has no provider to enrol with — so the published page reads the named
  absence on every run, correctly. Filed as deferred item 7, because it is easy to misread as
  broken.
- **`owner-domain` on any surface.** Deferred item 6.
- **Anything over WebRTC or through a relay.** See the departures above.
- **One engine.** Chromium, like all thirteen `e2e` specs.
- **That the receipt is transferable from the page.** The attestation carries the whole
  certificate on the wire and a third party holding the provider's key could check it —
  `result-signature.node.test.ts` measures exactly that one tier over — but nothing on this page
  exports a receipt, and no reading here leaves the browser.

## Verification

Every exit code was read with `EXIT=$?` on the line immediately after the command, never through
a pipe and never after a trailing `tail`. Wall-clock figures carry the `/usr/bin/time -p`
readings that make them comparable, per the orchestrator's correction: the machine's load average
counts I/O-blocked threads and says nothing about whether this process got CPU.

| command | result |
|---|---|
| `npx tsc --noEmit` | **exit 0** |
| `npx vitest run --project browser` | **exit 0** — 243 files, 3792 tests; real 41.01 s, user 89.70 s, sys 20.78 s, ratio **2.69** |
| `npx vitest run --project e2e` (with the 3 cases) | **exit 0** — 13 files, 61 tests; real 116.24 s, user 82.64 s, sys 17.31 s, ratio **0.86** |
| `npx vitest run --project e2e` (final, with the comparative case) | **exit 0** — 13 files, 62 tests, 103.8 s. Not wrapped in `/usr/bin/time`, so it carries no ratio and is **not comparable** with the row above; it is here as a pass/fail reading only |
| `npx vitest run --project e2e packages/node/src/attestation-ui.e2e.test.ts` | **exit 0** — 4 tests; real 14.91 s, user 24.33 s, sys 2.05 s, ratio **1.77** |
| `browser-node-contract` + `trust-anchors` + `serve-agent-hooks` | **exit 0** — 38 tests |
| the six cheap guards, by hand and via the hook | **exit 0** — 156 tests, on every commit |

The ratios differ by kind and not by contention: the `browser` project runs three engines in
parallel and reads 2.69; the `e2e` project serialises files and waits on spawned processes and
browsers, so 0.86 is I/O and not starvation — the caveat the orchestrator stated. The
`attestation-ui` file alone reads 1.77, above 1, so it held more CPU than wall clock.

**No `MEASURED_NODE_SPANS` entry was written and the table was not re-measured.**
`slow-specs.node.test.ts` filters `.e2e.test.ts` out of the node project's population by
construction, so this file is outside that table's jurisdiction and there is no honest gap to
leave.

`colouring-demo.e2e.test.ts` and `built-bundle.e2e.test.ts` — the two files the plan names as
load-bearing, both of which read the same report block — pass unedited.

## Notes for the concurrent executor and for whoever merges

- Five commits, each staged and committed by **explicit path**, and `git show --stat` was read on
  every one to confirm it held only files this plan owns. Defect #37's hazard is real here: the
  shared index carried 19-17's `reduce-job.ts`, `bin/bench.ts`, `bench-reduce.node.test.ts`,
  `bench-attestation.node.test.ts` and `discover-arm.node.test.ts` staged at various points, and a
  bare `git commit` would have swept them in.
- `npx tsc --noEmit` was red for 16 errors in `packages/net/src/reduce-job.test.ts` for most of
  this plan. Attributed by measurement — `grep -v reduce-job` returned nothing at every check —
  and left alone. It reads exit 0 now that 19-17's side has landed.
- Nothing outside `packages/browser/`, `packages/node/src/attestation-ui.e2e.test.ts`,
  `.planning/REQUIREMENTS.md` and the phase's `deferred-items.md` was written, reverted, stashed
  or checked out. No branch was switched. No `git clean`, no `git stash`.

## Self-Check: PASSED

- `packages/node/src/attestation-ui.e2e.test.ts` — FOUND
- `packages/browser/src/tab-api.ts`, `demo/main.ts`, `demo/index.html`, `src/browser-node.ts` — FOUND
- `.planning/phases/…/19-11-SUMMARY.md` — FOUND
- `19ae2cf`, `be800a9`, `c31041a`, `57b6165`, `d118b6d` — FOUND in `git log`
- `signingExecutor` present at 5 sites in `browser-node.ts` and 5 in `demo/main.ts` — the field,
  its constructor parameter, its assignment, and both submit sites
- working tree clean of every path this plan owns after each of the six plant restores
  (`cp` + `cmp` exit 0 each time, `git diff HEAD --stat` read after each)
