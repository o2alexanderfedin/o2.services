# Git history research — o2.services

Repo: `/Volumes/ProjectsSSD/Projects/o2.services`
Mined read-only on 2026-08-01. All shas verbatim from `git log --all`.

---

## 1. The arc

### Headline numbers

| Fact | Value |
|---|---|
| Commits reachable from HEAD | **504** |
| Commits across all refs | **511** |
| Merge commits | **100** |
| First commit | `1740f79` — 2026-07-24 — *"chore: initialize repository with git-flow setup"* |
| Latest commit | `7fa0088` / `4b51b45` — 2026-08-01 |
| Elapsed wall time | **9 calendar days** (2026-07-24 → 2026-08-01) |
| Authors | `o2alexanderfedin` × 512, `Alexander Fedin <alex_fedin@hotmail.com>` × 1 (`db8ddf3` "Deploy o2.services browser node" — the gh-pages deploy) |
| Tags | exactly one: `v0.1.0` |
| Tracked files / TypeScript files | 457 / 253 |

### Commits per day — the shape of the burn

```
2026-07-24   39
2026-07-25    9
2026-07-26   63
2026-07-27   72
2026-07-28   40
2026-07-29   39
2026-07-30   32
2026-07-31  130   <-- peak
2026-08-01   90
```

500 commits in 9 days. The 2026-07-31 spike (130) is Phases 14/15/16 executed
through parallel worktree agents; note the `chore: merge executor worktree (NN-MM)`
commits all dated 07-31 and 08-01.

### Branch structure

- `main` and `develop` are **259 commits apart**: `git rev-list --left-right --count main...develop` → `1  259`.
  main has one commit develop lacks; develop has 259 main lacks. main was last
  fast-forwarded at `c62bae5` — *"Merge develop into main — v1.0 plus v1.1 phases 11-13"* (2026-07-28).
  Everything from Phase 13.1 onward — four days, ~250 commits — has never reached main.
- 22 local branches + 9 live `worktree-agent-*` worktrees at time of survey.
  Named phase branches: `feature/phase-9-public-demo` … `feature/phase-18-discovery-capacity-placement`,
  plus `bugfix/audit-stale-ledger-rows`, `bugfix/requirement-id-collision`,
  `bugfix/same-machine-testing-standard`, `bugfix/state-progress-accuracy`,
  `feature/bug-fixes-22`, and three `feature/session-handoff*` branches.
- Remote has a `gh-pages` branch — the project publicly disclosed itself mid-arc.

### Phase progression (from the reverse log)

**Days 1–2 (07-24 → 07-25): planning, licensing, and the first deletion.**
`1740f79` init → `b29b1e7` master architecture design → `801b0df` source-available trial
license (DRAFT) → `7bae145` commercial license track → `34be7fc` *"docs: close the project
to contributions"* → `25f25e9`… `25c` roadmap (11 phases). Then, before a single feature
shipped, the roadmap deleted a phase: `ce1ceb0`.

**Day 3–4 (07-26 → 07-27): Phases 1–10 in two days.**
Kernel (`517d145`), loopback transport (`f0a1158`), real network (`1151466`),
browser tier + IndexedDB (`ab34e9f`), backbone relay (`f879441`), two tabs over real
WebRTC (`7f3cfaa`), LAN seed node (`d219c5f`), **public release v0.1.0** (`443e2fb`),
Phase 4 sovereignty (`2e2ee0b`), Phase 5 tree-reduce (`13e616a`), Phase 6 enrollment
(`2c53ab7`), Phase 7 churn (`5ca6e38`), Phase 8 benchmarks (`677a6d2`),
Phase 9 demo (`449b767`), Phase 10 AOT/elfconv pipeline (`f879b9d`, `9d8c1ad`).

**The pivot (07-27): the milestone audit.** `2b76a29` — *"docs: milestone audit — 35
requirements are built, tested, and unwired"*. Everything from here is milestone **v1.1
"Wire What Was Built"** (`431c8ae`, `c3e6fe1` — 12 phases, 44 requirements). Phases 11–18
exist only to connect code that already passed its own tests to something a person can run.

**Days 5–9 (07-28 → 08-01): v1.1.** Phase 11 hooks (`42cbad7`), Phase 12 sovereignty
placement, Phase 13 egress manifest → verified **0/3** (`bd1b737`) → amended → 3/3
(`7cb710f`), Phase 13.1 admission/transport bounds, the **22-bug round**
(`528bfc1`), Phase 14 signed artifacts, Phase 15 capability chains, Phase 16
tree-reduce wiring, Phase 17 identity/enrollment (**1/3 on criteria**, `09f16f3`),
Phase 18 discovery/capacity (in flight at HEAD).

---

## 2. The best commit messages — verbatim, with shas

The house style: a lowercase conventional-commit prefix followed by a sentence that
is an *epistemological claim*, almost always of the form "X is not Y". Collected
25, roughly in order of quality.

1. `d7e932f` — **fix(core): a copy that answered by failing is not a copy that stayed silent**
2. `7b66883` — **fix(core): a certificate may only name a user who signed for it**
3. `c6d23d0` — **fix(core): a write the host refused is an event, not a write that never happened**
4. `fdf1d39` — **fix(browser): a tab may not run a stranger's code where nothing can interrupt it**
5. `09164ed` — **refactor(browser): a getter with one possible answer is not an instrument**
6. `3606313` — **fix(net): a request this node turned away is not work it did for that peer**
7. `ba33bd7` — **fix(net): a node that could not read the block is not a node without it**
8. `0b6e30d` — **fix(net,demo): an opt-out that travels to a peer is not an opt-out**
9. `f7f2c43` — **fix(net): only the taker of an egress hold can give it back**
10. `b6dea90` — **fix(core): a reported count is a number, never that many objects**
11. `f9e22c2` — **fix(net): a reply's identity is who answered, not the request number**
12. `4d908dd` — **fix(core): one replica breaking must not discard what its co-replicas finished**
13. `31aeaac` — **fix(browser): a budget no test can reach is not a budget**
14. `319430b` — **fix(node): a verdict about a peer is a fact with an expiry date**
15. `8640b53` — **fix(aot): a host with no room to fork is not a host without Docker**
16. `2a8f47e` — **test(18-07): a cap nobody can move is a configuration, not a control**
17. `4435fed` — **feat(18-07): a node's usable slots are what it can run now, not at startup**
18. `2d04ea7` — **test(18-07): a slot count computed once is a memory, not a reading**
19. `b0f2694` — **fix(17): a finding about forbidden text cannot be written in the forbidden text**
20. `94227b6` — **test(core): a test whose body is a call and no assertion asserts nothing**
21. `3bab2d8` — **test(core): attribution that is correct by inspection is not attribution that is guarded**
22. `320af51` — **feat(16-02): a node that serves also combines, because combining is not a capability a node can lack**
23. `5dbbf53` — **feat(16-04): a reduce that is not measured is not a reduce that did nothing**
24. `b56b0b5` — **feat(demo): a workload whose answer this project did not write**
25. `726c41b` — **test(17-03): a node restarted is a different node, measured before it is fixed**

Runners-up worth quoting:

- `c2cf4a0` — *"test(14-01): a refusal that still runs the module is not a refusal"*
- `8cd19dc` — *"fix(test): the clock that kills a wedged agent could never fire"*
- `dc8006a` — *"fix(14-03): a census that named its own query counted itself as a resolver"*
- `9f7bac3` — *"fix(15): a comment that named a function this repository does not have"*
- `11e2d2e` — *"fix(17-05): a comment that said \"verified\" about a line it had stopped describing"*
- `0f5caec` — *"test(17-05): criterion 2, with nobody left alive to have been consulted"*
- `e652a16` — *"docs(16): a header that told readers to go look at a skipped test"*
- `a092410` — *"docs(16): verify Phase 16 — 3/4, and a guard that does not guard"*
- `1f2f082` — *"feat(16-02): a job's shards become a tree, over eight peers blind to each other's stores"*
- `5d97578` — *"docs(roadmap): naming a defect is not fixing it — AUTH-03's requestor half goes to Phase 23"*
- `bd6df2d` — *"test(18-01): name the defect a refusal test is looking for, instead of timing out on it"*
- `7d33ec6` — *"fix(demo): the always-visible bar was always visible"*
- `f671b07` — *"fix(demo): two devices on one relay never heard of each other"*
- `5b8f4bd` — *"fix(demo): the relay was being counted as a peer, and given work"*
- `b5c1784` — *"fix(seed): the lone-visitor peer was a comment, not a mechanism"*
- `a481976` — *"fix(node): seed now serves the .local URL it prints"*
- `20d3d89` — *"test(18-02): measure the union's cost instead of asserting it"*
- `6b48e12` — *"test(node): the primes below N, counted across the fabric and checked against pi(x)"*
- `1de4d91` — *"feat(15-02): make all 53 dispatch sites name the chain they carry"*
- `5ea3c76` — *"fix(node,browser): a start that fails must leave the machine as it found it"*
- `1286ffb` — *"fix(libp2p): a legal message repeated is still a peer holding too much"*
- `d9ea757` — *"feat(17-01): one seed a node reads as both of its names"*
- `bd3df6e` — *"test(17-01): a node's two names, asserted before either exists"*
- `534d057` — *"feat(17-03): a node told to enrol gets a certificate, or does not start"*
- `2bc6e85` — *"feat(17-04): an unverified peer is never asked for a block, and there is no if to forget"*
- `36458ad` — *"fix(17): two words the vocabulary guard is right to refuse"*

---

## 3. Deletions and reversals

### Ranked by lines deleted (all refs, no merges)

```
-2780 +160   ce1ceb0  refactor(planning): delete determinism gate — NaN is a codec concern, not a phase
-2363 +2162  2f9f2c8  plan(v1.1): strip metadata layers from 33 phase plans
-1864 +420   a8bb686  feat(bench): declare the admission limit and shard count the run was measured under
-1351 +1365  725410d  docs(16-05): the real-transport reduce, measured instead of refused
-1214 +106   afb3cad  refactor(core): delete the admission gate — divergence is detected, not predicted
 -572 +10838 f879b9d  feat(aot): the Phase 10 pipeline, and what three adversarial lenses found in it
 -368 +875   9d8c1ad  feat(aot): close Phase 10 — and point the executor at a real artifact
 -304 +773   92dc854  plan(v1.1): repair the strip — restores, CONTEXT sweep, and a blocking fix
 -283 +986   3f8c7f1  fix(core): bound untrusted guest code by wall clock, on both tiers at once
 -269 +491   f7f2c43  fix(net): only the taker of an egress hold can give it back
 -269 +0     3f678c2  chore: remove a review scratch test swept in by a concurrent commit
 -137 +493   eb13d50  fix(node): answer the rendezvous, and correct a ledger that overstated 36 requirements
 -120 +83    855cdf5  refactor(core): delete a commitment check that compared a value with itself
 -106 +240   5c057c0  refactor(core): all nodes have equal functionality; only discovery differs
```

### 3a. THE BIG ONE — the static determinism analyser + WASM parser, deleted together

**`afb3cad`** — 2026-07-24 17:40:40 -0700 — `refactor(core): delete the admission gate — divergence is detected, not predicted`
**10 files changed, 106 insertions(+), 1214 deletions(-)**

Files removed: `packages/core/src/admission/gate.ts` (431 lines),
`packages/core/src/admission/gate.test.ts` (363), `packages/core/src/wasm/reader.ts`
(143 — **the WASM parser**), `packages/core/src/wasm/reader.test.ts` (91), plus
`publishModule` and the SIMD/growable-memory fixtures.

Verbatim body (the whole reasoning, this is the spine of the article):

> Removes ~1030 lines of WASM instruction parsing that existed to prove
> statically that a task module could not produce different output on two
> machines. That was the wrong problem.
>
> Verification is a byte comparison. Two nodes execute, both serialize their
> result, the bytes are compared, and a mismatch is reported with the
> dissenting node named. That already worked. The gate was an attempt to
> predict ahead of time what the comparison detects empirically — an
> unboundedly harder problem, and the reason a hardware-level NaN table and
> a byte-exact opcode walker ended up in a job scheduler.
>
> Every check the gate performed is either impossible anyway or self-reporting:
>
> - Import allow-list — redundant. The host supplies four functions;
>   WebAssembly.instantiate refuses anything else with a TypeError naming the
>   import. The import object IS the sandbox. […]
> - Shared memory — a single thread is deterministic regardless.
> - Atomics opcodes — require shared memory to matter; already moot.
> - memory.grow divergence — rare, and surfaces as a disagreement.
> - Start section — degrades to "module produced no output", already reported.
> - relaxed-SIMD — surfaces as a disagreement. Banning the whole 0xFD prefix
>   also banned deterministic fixed-width SIMD, which is the main throughput
>   feature of the target workload.
>
> Worst case for every one of those is a single wasted redundant execution
> plus a reported disagreement, which is precisely what redundancy is for.
> […]
> Requirements DET-01 and DET-02 removed (74 -> 72) […] REQUIREMENTS.md now
> records why no static analysis exists, so it does not get reinvented.
>
> **144 tests -> 60. Every removed test exercised machinery that should not
> have existed.**

Note the date: 2026-07-24, **day one of the repository**. The gate was written and
deleted within hours.

### 3b. The phase deleted before it ran

**`ce1ceb0`** — 2026-07-24 16:35 — `refactor(planning): delete determinism gate — NaN is a codec concern, not a phase`
**13 files changed, 160 insertions(+), 2780 deletions(-)**

Deleted the whole of Phase 1: eight PLAN files, CONTEXT, RESEARCH (656 lines),
VALIDATION. Body:

> DAG-CBOR forbids NaN/Infinity/-Infinity and canonicalizes -0.0 and float
> width, so no NaN can be hashed or content-addressed. The WASM spec makes
> NaN sign nondeterministic anyway, so measuring it could never change the
> design. Protobuf is never hashed — its own docs state serialization is
> not canonical across languages, builds, or schema versions.
>
> - Delete Phase 1 (determinism gate); 11 phases -> 10 […]
> - 76 -> 74 requirements

This lands **65 minutes before** `afb3cad` deletes the code. The plan died first,
then the implementation.

### 3c. The class about node equality — `NodeRole`

**`5c057c0`** — 2026-07-26 — `refactor(core): all nodes have equal functionality; only discovery differs`
8 files, +240 / −106. Preceded by a weaker first attempt (`e8a49dd`) that the
commit itself disowns.

> Applying the owner's correction properly. My first pass was too weak —
> backbone/edge survived as node CLASSES and the quorum rule discriminated on
> them, which still encodes a tier however the comment is worded.
>
>   "all nodes are of equal functionality. The only difference is in the
>    connectivity capabilities"
>
>   "it is not 'reachable with relay', it is 'cannot be discovered as seed node
>    directly, only via relay'"
>
> **NodeRole is gone.** A certificate now carries:
>
>   discoverability: 'seed' | 'via-relay'
>   relayIds:        the relays a node is discovered through
>
> "Reachability" was itself wrong, and the second correction sharpened it: once
> two peers are connected they are indistinguishable in every respect. […]
>
> The quorum rule no longer mentions kinds of node anywhere. It refuses a quorum
> whose members are all discoverable only through one relay […] Three browser
> peers discoverable through three different relays pass. Three servers published
> behind one do not, and a test asserts that symmetry explicitly: **servers get no
> exemption.**
>
> Also removed: the last of the value-laden framing ("edge nodes are the cheapest
> thing for an attacker to manufacture") — that was the assumption the correction
> rejects, and it had no business justifying a quorum rule.

`RelayNode` was also deleted in Phase 10 (`f879b9d` mentions "the RelayNode
deletion" in its own summary line).

### 3d. The commit-reveal that compared a value with itself

**`855cdf5`** — 2026-07-30 — `refactor(core): delete a commitment check that compared a value with itself`
6 files, +83 / −120.

> runOne computed the digest from (nonce, resultCid) and put both in the record;
> the reveal phase recomputed it from the same two values through the same pure
> function. **The comparison could not be false.** Measured 2026-07-30 by making the
> mismatch branch throw and running the whole node project: 1171 tests, no
> reach — and the nonce derived from nodeId:moduleCid:partitionIndex, all
> public, so the commitment was not hiding either.
>
> Kept as a seam it would only have misled: a real two-round ceremony needs a
> wire message, a cross-node barrier and a hiding commitment, none of which this
> shape could grow into. **Deleting it is what stops the next reader deriving a
> guarantee from it.** […] VER-02 goes back to unclaimed in both places that record it

Follow-on: `262c34b` — *"docs(coverage): re-measure after a deletion, because assuming
it would have read wrong"* — re-measures coverage because "Executed-but-unfalsified
statements count as covered, so the figure was resting on them."

### 3e. Deletion as a security fix — making the dangerous thing unspellable

**`fdf1d39`** — 2026-07-30 — `fix(browser): a tab may not run a stranger's code where nothing can interrupt it`

> `createWorker` was optional, so omitting it fell back to a bare `WasmExecutor` on
> the tab's own main thread. **That is not a weaker bound, it is no bound**: a guest
> `run()` is a synchronous call […], so the deadline timer is queued on the very loop
> the guest is holding and can never fire, and there is no thread to terminate.
> **A 52-byte `loop br 0` from any peer wedged the tab permanently**, `stop()` included.
>
> The escape hatch was justified in its own comment by "tests that have no bundler".
> **No such test was ever written** […] So the option is now required and the branch
> is deleted rather than bounded: the dangerous arrangement has no spelling, the way
> `EgressHold` left "release a hold you never took" unspellable.

Same pattern in the 22-bug round summary (`4f53f1f`) for B02: *"A hold is now a value,
and release-by-label was DELETED so the invalid operation has no spelling."*

Its own follow-up, `09164ed`, deletes the instrument the fix made vacuous:
*"`offMainThread` could only return `true` once `createWorker` became required. Two
e2e assertions and a demo badge still read it, so three call sites were asserting a
literal and reporting it as a measurement — the same defect class this round exists
to remove, introduced by the fix that closed the one before it."*

### 3f. Reversals

- `5274dd8` — *"docs(planning): pause — round merged, two decisions open, one revert recorded"*:
  *"the integration timeout ordering, where **my own attempted fix put six tests red and was
  reverted**"*, and: *"Keeps the rule the session cost the most to learn — **never set a
  timing bound from a number you did not measure yourself** — with the three occasions it
  was broken."*
- `3f678c2` — *"chore: remove a review scratch test swept in by a concurrent commit"*, −269/+0.
  A reviewer agent's planted mutation was found uncommitted in the tree after an
  interrupted session (also recorded in `4f53f1f`).
- `e9e4920` — deletes an assertion rather than adding one: *"test(demo): stop a case
  advertising cross-node agreement it never checked"* —
  `expect(assignmentOrder(204)).toEqual(assignmentOrder(204))` *"compares one call of a pure
  function against another with the same literal in the same process. It holds for every
  implementation, including a reversed comparator."*

---

## 4. Corrections in flight

This repo treats "I was wrong two commits ago" as a first-class commit type.

### 4a. The 0/3 verification and the self-correction

**`bd1b737`** — 2026-07-28 — `verify(13): 0/3 — and a correction to a row I wrote two commits ago`

> The first independent pass over Phase 13 scores it gaps_found, 0 of 3 criteria
> fully verified. […]
>
> 1. The job is NOT failed. […] a probe sending the raw SSN characters alone
>    crossed the tap with no violation.
> 2. "Each owner's node" holds nowhere in production. […]
> 3. manifest.totalBytes reads 130 where the raw input is 95 canonical bytes and
>    the aggregate is 8. **The manifest reports MORE than the raw input.**
>
> My own DATA-05 ledger row, written in 7a7747b, claimed the test "fails a running
> job … when a raw sovereign byte crosses". **That is wrong on both counts and is
> corrected here.** I wrote it from the executors' reports plus a call-site grep,
> having verified that the code was *reachable* but not what it *did* — **the same
> gap in kind, one level up, as the one this milestone exists to close.**

Sequel: `fb85e45` *"docs(13): amend criteria to what is true"* → `7cb710f` *"verify(13):
3/3 on the amended criteria"*. The criteria were rewritten, not the evidence.

### 4b. The milestone audit — 36 requirements marked back to "built, not wired"

**`2b76a29`** — 2026-07-27 — `docs: milestone audit — 35 requirements are built, tested, and unwired`
and **`eb13d50`** — `fix(node): answer the rendezvous, and correct a ledger that overstated 36 requirements` (+493/−137).

> The v1.0 milestone audit traced every requirement from the five runnable entry
> points inward. **For 36 of them the trace does not arrive.** Sovereignty
> labelling, tree-reduce, discovery, enrollment, quorum composition, capability
> chains and the entire churn coordinator are implemented, exported, and covered
> by their own specs — and **nothing a person can run calls any of it.**
>
> The structural cause is one shape: `serveAgent` declares six optional hooks
> with silent defaults, and production supplies almost none. `authorize`
> defaults to allow. `index` and `reservations` default to empty. `capacity`
> defaults to accept. `ledger` is supplied **nowhere** — not in production, not
> in one test. **A default indistinguishable from the feature working is not a
> default; it is a hole, and it is why none of this failed anything.**
>
> So the ledger goes from **68/72 to 32/72**, with 36 marked *Built, not wired*

Same commit, the live bug: `findReservedPeers` *"answered `[]` for the whole of Phase 9. […]
The failure was silent in the worst available way. The relay *does* answer, so `answered`
is non-zero and the caller records `asked: true`, then dials an empty list and reports
`{asked: true, dialed: [], failed: []}` — nothing attempted, nothing failed, no error."*

This audit **is the origin of milestone v1.1 "Wire What Was Built"** (`431c8ae`).

### 4c. Plans caught lying about themselves

- `6ef25b6` — *"docs(15-01): record what was measured, including **the five things the plan got wrong**"*
- `0d29d05` — *"docs(15-02): record what was measured, including **the twelve things the plan got wrong**"*
  > Nine drifted or wrong file:line citations, one wrong count (44 -> 53 sites in 18
  > files, not 13) […] The worst is not a drift: purity.node.test.ts:167-174 was cited as
  > keeping the Executor port narrow, and **the string "Executor" appears nowhere in that
  > file. No such guard exists.**
- `5348bba` — *"docs(17-04): complete the serving-an-identity plan, **with two of its own claims measured false**"*
  > the plan's fourth Task 1 reddening claim was planted and left every test green […]
  > **a first draft of the file:line corrections table was itself wrong in four rows**;
  > every row is now checked against the file rather than against memory
- `42e854e` — *"docs(17-01): summarise one seed read as two names, and **two plan claims that were false**"*
  > the uppercase justification — Number.parseInt is case-insensitive over hex, so an
  > uppercase key gives the SAME bytes and the SAME peer id. **The rejection is right;
  > the stated reason was not.**
- `024ea3a` — *"docs(12): correct a SUMMARY that cited a plan which was never run"*
- `7681cbb` — *"docs(18-03): correct two reasons in node-records that this plan retired"*
- `c521d68` — *"fix(aot): reconcile the code-cache control figure, which the file stated three ways"*
- `854e812` — *"docs(15-05): a limit about one vitest project, restated as a limit about all of them"*
- `9f7bac3` — *"fix(15): a comment that named a function this repository does not have"*
- `11e2d2e` — *"fix(17-05): a comment that said \"verified\" about a line it had stopped describing"*
- `f4cfab2` — *"test(15-05): record the mutation that survived four plans, now that something sees it"*
  > M2b's reason is corrected in the same file. It claimed the browser factory was
  > unreachable by any behavioural test. It is not

### 4c. The Phase 10 assumptions that were wrong

**`f879b9d`**:
> **Two recorded assumptions were wrong and are corrected in the code:** stripped
> binaries lift fine when `.eh_frame` survives, and the browser target needs
> -pthread and shared memory — which settles aarch64-wasi32 as the only target.
> Measured: **elfconv exits 0 on a hello-world while leaving 174 addresses
> untranslated**, so the driver reads the lifter's own `__ecv_warning` record out
> of the bitcode rather than believing the exit code.

### 4d. Planning-tool corrections

- `2d0b9ae` — *"fix(planning): STATE.md reported 89% for a milestone that is 25% done"*
- `9630afc` — *"fix(planning): STATE.md did not know Phase 13.1 had been executed"*
- `36c46bb` — *"plan: insert Phase 13.1, append Phase 23, and **stop STATE.md lying about progress**"*
- `64f6def` — *"docs(planning): **name every writer that has corrupted STATE.md's frontmatter**"*
- `5653c84` — *"fix(planning): NET-07 was minted twice — renumber the new ones to NET-08/09/10"*
- `ecf7959` — *"fix(planning): stop four rows claiming delivery the table denies"*
- `771fce5` — *"fix(planning): stop a reason column asserting something about the code that is not so"*
- `4e6040e` / `e8ea6e9` — *"docs(planning): reconcile requirement status with what is delivered"*
- `aeb229e` — *"docs(planning): Phase 3 at 4 of 6; **withdraw the mis-scoped open problem**"*
- `170f501` — *"docs: correct vitest browser provider in STACK.md (phase 1 research finding)"*
- `cf1a132` — *"docs: correct phase 1 criterion 1 — drop Android, require raw+canonical hashes"*
- `25f25e9` — *"docs: rewrite README, **correct the DHT claim**, record relay-hosting findings"*
  (this is the correction quoted at length in CLAUDE.md's "DHT reality check" section)

---

## 5. Genuinely surprising

### 5a. The disclosure gate had never matched anything — for its whole life

**`1e2aa72`** — 2026-07-28 — `fix(disclosure-gate): catch \`wrangler pages deploy\`, and test the patterns`

> The pattern was `/\bwrangler\s+(?:publish|deploy)\b/`, which requires the verb to
> follow the tool name directly. `wrangler pages deploy` — **the command a person
> actually types** — did not match. […]
>
> The pattern is now the fix; **the missing test is the point.** Every other check in
> this file asserts an ABSENCE: no manifest matches, no workflow file exists. **A
> pattern that matches nothing at all satisfies all of them and reads exactly like
> a clean repository. This one did, for as long as it has existed, and the suite
> was green throughout.** An empty result was standing in for a clean one — the
> failure mode this project keeps removing, **found inside the guard that protects
> the disclosure constraint.**

The disclosure gate exists because publishing forfeits EPO/China patent rights
permanently. The guard protecting an irrevocable legal decision was vacuous.

### 5b. A guard that fails on the report of its own failure

**`36458ad`** and **`b0f2694`**. There is a `vocabulary.node.test.ts` that greps the
whole repo for cryptojacking vocabulary. Phase 17's verification doc used the word
two innocent English words that the guard forbids — one in a sentence about what a
browser node cannot do, one in a line of acknowledgement:

> Both are innocent English and both are exactly what the guard exists to stop: its
> test is named "no cryptojacking vocabulary reaches a reviewer who greps", and a
> reviewer grepping this repository for the term must find nothing whatever the
> sentence meant.
>
> Caught only because the guard scans `git ls-files` — the verification pass reported
> its guards green, but **a run before its own final commit cannot have read this file.**

Then the *log entry documenting the violation* quoted the two banned terms — and
re-armed the guard from a second file:

> 17-06 logged the vocabulary failure it found, and the log quoted the two terms to
> document them — so merging the report of the problem re-armed the same two readings
> from a second file. **The guard failed again on the merge commit.** […]
> **Recorded rather than deleted, because the entry failing its own guard is the more
> useful half of it.**

Earlier precedent, `306d8b5`: an exemption was refused because *"Every remaining v1.1
phase plan would have needed one, and each SUMMARY explaining one would trip the guard
in turn — **a treadmill with eleven more laps in it.**"*

### 5c. The executable mutation ledger

**`25b6246`** — 2026-07-29 — `test(node): make the mutation ledger permanent and executable`
(+804 lines, three new files)

> Phase 13.1 planted ten defects by hand and watched nine go red. The record lived
> in a prose report, so nothing re-checked any of it: delete one of those lines
> today and no instrument notices.

`mutation-ledger.ts` stores, per entry: why the line is load-bearing, the exact
`find` text, the `replace`, the test files measured to catch it, and **the signature
observed in the failing output**. `mutation-guard.node.test.ts` asserts each `find`
string appears exactly once — *"zero means the mutation has silently stopped applying,
which reads identically to a healthy guard, and is the exact shape of the `wrangler
pages deploy` blind spot this repository already shipped once in its own disclosure
gate."* The driver *"requires a non-zero exit **and** the recorded signature — a red run
from a port collision or an OOM worker is not evidence a guard fired."* By `528bfc1`
the ledger holds **31 entries, 31/31 caught with recorded signatures**.

### 5d. The traceability check that could have certified itself

**`b02b9ff`** — *"test(node): the requirements ledger is checked, and it names three rows
it cannot back"*. Notable line among the proofs-of-failure:

> the self-exclusion removed: all three findings evaporate, and the equality
> catches their disappearance — **the checker would have certified the ledger by
> quoting its own data**

### 5e. Choosing an oracle the project could not have been wrong with

**`b56b0b5`** / **`6b48e12`** — 2026-08-01, the last feature before HEAD.

> Every existing workload is checked against a reference from this repository […]
> Those are strong checks, but **the fabric and its oracle share an author, so a
> misconception held in both is invisible to the pair — they are wrong together and
> agree.**
>
> **pi(x) cannot be talked into agreeing.** It was tabulated long before this
> repository existed, so the expected totals are quoted rather than computed and
> **there is deliberately no JavaScript sieve anywhere near them.**

And the near-miss that justifies the test sweep:

> The `min(i, rem)` term in the range split is load-bearing and nearly invisible
> to the obvious test. Deleting it leaves the top `total mod count` numbers
> covered by no shard. Planted and measured […] that defect was caught at n = 1000
> only, and there only at 5, 7 and 8 — **a power of ten sits far above the prime
> below it, so the uncovered tail holds no prime and the sum comes out right by
> luck.** […] a headline assertion at 10^6 alone would certify that defect as passing.

### 5f. The "same machine" descoping — and the refusal to launder it

**`1ae2268`** — 2026-07-28 — *"docs(planning): adopt same-machine testing standard — and
record what it does NOT prove"*. An owner ruling replaced "different machines" with
"same machine, different processes/browsers". The commit then spends most of its body
enumerating what that does **not** buy:

> **WHAT WAS NOT THEREBY PROVEN — descoped is not satisfied**
> - Cross-machine reproducibility is NOT demonstrated. It is unmeasured, and it is
>   now unscheduled. CROSS_MACHINE_BLIND_SPOT stays attached to every lifted
>   artifact and stays printed by the CLI: Phase 10 established the blind spot is
>   structural — **elfconv's virtual-register promotion iterates a pointer-keyed
>   std::unordered_map and a std::set<BBBag*> whose order is address-space
>   dependent** — and no configuration removes it. **Descoping removed neither the
>   marker nor the risk.**
> - […] **BENCH-07 […] does not close BENCH-06 and must not be published as if it did.**
> - Phase 3 criterion 1 had already been closed in a STRONGER form than the
>   restatement asks — iPhone Safari to laptop Chromium, genuinely different
>   machines, direct WebRTC.

### 5g. Reporting a criterion NOT MET rather than rewording it

**`9d8c1ad`**:
> Criterion 4 is **NOT MET**: no WASM code-cache entry at 4.8 MB over three
> visits, while the same profile grows a 2 MB JavaScript cache and a
> `--v8-cache-options=none` calibration reads the identical 72B. **Reported unmet
> rather than reworded — a criterion that can only be reported as met is not a
> measurement.**

And the discovery from running a real artifact for the first time:
> **A `printf("hello\n")` imports `clock_time_get` and `poll_oneoff`** — glibc's stdio
> pulls them in whether the program asks or not. **Pinning the clock is load-bearing
> on the very first task anyone runs, not theoretically.**

Also from `9d8c1ad`, on why real artifacts mattered:
> Every execution-side test used hand-written WASI fixtures, written from the
> same understanding as the executor — **the shape of nearly every defect this
> project has recorded.**

### 5h. Phase 17 shipped at 1 of 3 criteria — deliberately

`09f16f3` — *"merge: Phase 17 — node identity and enrollment, **1/3 on criteria**"*.
`6665906` — *"docs(17): one criterion met, two scheduled, **one defect left open on purpose**"*.
`3e1c03e` — *"docs(roadmap): two halves Phase 17 could not close, **scheduled rather than assumed**"*.
`f6a172b` — *"docs(17): one criterion met, and **the two that name a thing nobody measured**"*.

### 5i. The 22-bug round, and the load-induced flake that read as a regression

`528bfc1` — *"merge: close the 22-bug round — seven verification gaps and four timing defects"*.
Method: *"22 bugs found by a seven-lens hunt, each **adversarially refuted before any
fix was written**, then fixed through an Emergent Design session (three rival designers blind to
each other, judged and synthesised), TDD, and an independent verifier that plants the
deletion which should break each new test."* (`4f53f1f`)

The three criticals:
> B01 replies correlated by id ALONE — **a forged quorum was reproduced through the real
> executeVerified.** Now keyed on (destination, id) […]
> B02 the exec branch released an egress hold it never took — **132 raw sovereign bytes
> measured on the wire.** […]
> B03 a 52-byte looping module wedged a node permanently.

And the correction on the gate failure (`4f53f1f`, `5edfb39`):
> **THE HEADLINE CORRECTION.** A verifier reported `3 failed | 249 passed (252)` and
> called it blocking. Run in isolation, those files pass […] They are **load-induced
> flakes** […] **Any full-suite number taken under parallel agent load is unreliable.**

Confirmed the next day at *"252 files / 3886 tests passed, 306.09s, exit 0"* on an idle
machine. Also from `4f53f1f`: *"cost calibration for the 4h28m run — **34 full-suite runs
at ~5 min accounted for ~2h50m of it**"*.

### 5j. Test-count growth (a spine for the article)

| Moment | sha | Tests |
|---|---|---|
| Before the admission gate deletion | `afb3cad` | 144 |
| After it | `afb3cad` | **60** |
| Phase 6 | `5c057c0` | 461 |
| Phase 11 | `306d8b5` | 1690 (115 files) |
| Phase 13 gap closure | `bd1b737` | 1775 (122 files) |
| Disclosure gate fix | `1e2aa72` | 1801 (124 files) |
| 22-bug round, quiet machine | `5edfb39` | 3886 (252 files) |
| 22-bug round merged | `528bfc1` | **4008 (262 files)** |
| Phase 18 (HEAD-ish) | `319430b` | node 1529, browser 3207, e2e 44 |

### 5k. Miscellaneous surprises

- **`b6dea90` — "a reported count is a number, never that many objects."** A whole class
  of defect named in seven words.
- **The demo counted the relay as a peer and gave it work** (`5b8f4bd`), and
  **"two devices on one relay never heard of each other"** (`f671b07`) — both found only
  by running it on real hardware (iPhone + laptop, `8261c1b`).
- **`7d33ec6` — "fix(demo): the always-visible bar was always visible."** Deadpan.
- **`3f8c7f1`** bounds untrusted guest code by wall clock *"on both tiers at once"* — +986/−283,
  one of the largest fix commits.
- **`8640b53`**, the newest fix at HEAD, is a masterclass in refusing the plausible cause:
  *"The suspicion was `METADATA_BUDGET_MS`. It was the wrong suspicion, and the measurement
  says so."* … *"456 ms is 44x under the 20 s budget […] So the budget was never the cause
  and is unchanged; what fires is the spawn failure, in about a millisecond."*
- **Nine live `worktree-agent-*` worktrees** at survey time — the project runs parallel
  agents in isolated worktrees and merges them with `chore: merge executor worktree (NN-MM)`.
- **`cf0cbfe`** rewrites the README to lead with the number the milestone is about:
  *"v1.0 left 36 capabilities built but unreachable […] and that count is 22, with 11
  partly wired. **Reducing it is the measure.**"* — then **adds four items to the "not
  demonstrated" list**, *"because the section is only worth having if it grows."*
- The project **closed itself to contributions on day one** (`34be7fc`): *"Sole authorship
  is what keeps the commercial track available for the entire codebase, so refusing
  contributions preserves the dual-license model by construction rather than depending
  on a CLA."*
- `main` carries the one commit by a differently-named identity — `db8ddf3` "Deploy
  o2.services browser node" by `Alexander Fedin <alex_fedin@hotmail.com>` — on gh-pages.
  Every other commit in 511 is `o2alexanderfedin`.
