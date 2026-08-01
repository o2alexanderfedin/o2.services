---
phase: phase-16-decomposable-tree-reduce-wiring
plan: 06
subsystem: scheduling
tags: [SCHED-06, admission, combine, MR-03, MR-05, gap-closure, fetch-amplification]
status: COMPLETE — the combine branch is slot-bounded, measured on two layers, and the disclosure says what is now true
requires:
  - "13.1: LocalCapacity, its peakInFlight instrument, and the exec branch's take/release pattern"
  - "16-05: the combine routed through options.authorize, which stays"
  - "16-VERIFICATION: the measured finding that nothing this repository can start could refuse a combine"
provides:
  - "packages/net: a combine takes an admission slot before its first fetch and releases it on every exit"
  - "MEASURED: a node at its limit refuses a combine with `over-committed: N of M slots in use`, asserted by text on two layers"
  - "MEASURED: a refused combine performs zero reads — 0 blockstore gets in process, 0 blocks fetched on a real FabricNode"
  - "MEASURED: the high-water mark stays at 1 across twenty take/release pairs"
  - "mutation ledger M31 and M32, both signatures read off a real planted run"
  - "REPORTED: admission bounds concurrency, never arrival rate — written into the disclosure rather than left to be inferred"
affects:
  - packages/net/src/agent.ts
  - packages/core/src/placement.ts
  - packages/net/src/combine.test.ts
  - packages/node/src/admission.node.test.ts
  - packages/node/src/mutation-ledger.ts
  - .planning/phases/phase-16-decomposable-tree-reduce-wiring/deferred-items.md
tech-stack:
  added: []
  patterns:
    - "one slot table shared by every branch that costs the node something, with keys namespaced apart"
    - "a bound proved by the pair (refusal text, read count) — the text alone cannot tell where the check sits"
    - "a leak test given more weight than the bound test, because a leak is the failure that looks like health"
key-files:
  created:
    - .planning/phases/phase-16-decomposable-tree-reduce-wiring/16-06-SUMMARY.md
  modified:
    - packages/net/src/agent.ts
    - packages/core/src/placement.ts
    - packages/net/src/combine.test.ts
    - packages/node/src/admission.node.test.ts
    - packages/node/src/mutation-ledger.ts
    - .planning/phases/phase-16-decomposable-tree-reduce-wiring/deferred-items.md
decisions:
  - "The slot key is derived from the input CIDs, not from `combineId`. A combine's output is a pure function of its inputs, so the input set is the work's identity; `combineId` is a requestor's claim and keying on it would let one peer split identical work across N keys by renaming it."
  - "The refusal is returned in the combine reply shape carrying `admission.reason` verbatim, with no prefix — the same string the exec branch sends, composed in one place."
  - "Two mutation-ledger entries rather than one. The taking and the refusing fail independently and are caught by different readings; one entry would have claimed a reach it does not have."
  - "16-05's `Authorizer` routing was not touched. It is structurally right and becomes live the day a sovereign reduce exists; this is a capacity bound beside it."
metrics:
  duration: ~75 min
  completed: 2026-08-01
  tasks: 4
  commits: 3
---

# Phase 16 Plan 06: Bound the Combine Branch at the Admission Hook — Summary

**Every node this repository can start now refuses a combine it has no slot for, in its
own words, before it fetches a single block — and gives the slot back on every exit
including the two that never reach the merge.**

16-05 routed the combine through `options.authorize`, which is the right structure and is
untouched here. What verification measured is that it bounded nothing: `authorizeCapability`
reaches its refusal rules through `task.label === 'sovereign'`, the combine frame carries
no such label, and neither node factory exposes an `authorize` field — so the residue that
the old gate had incidentally held at zero widened to every node. This closes it at the
hook `agent.ts`' own disclosure had already named as the answer.

## Task 1 — the slot, and the release

`packages/net/src/agent.ts:353-427`. `runCombine` now takes a slot before the fetch loop
and delegates the body to a new `combineAdmitted` (`:430`) inside a `try`, releasing in a
`finally` (`:425`).

### Why admission and not a second authorizer rule

The owner's reasoning, restated because the code has to carry it: a combine's inputs are
the **outputs of public map tasks** — content-addressed and already public by
construction — so there is nothing on that frame to authorize. What a peer can provoke is
CPU and transfer, which is a capacity question. `runCombine`'s pre-existing header said so
before this branch existed: *"the general answer to it is per-request admission
(SCHED-06), not a second bound invented for this branch alone."*

The three rejected options, none of which were built:

| Option | Why not |
|---|---|
| Widen the wire with a sovereignty label | A field nothing would set until Phase 19/20. 16-05 rejected it on the same ground and this plan does not reopen it. |
| Expose `authorize` on `FabricNodeOptions` | Reopens the door Phase 15 closed by hardcoding `authorizeCapability` at both factories. |
| Accept the surface as recorded | It is the option the owner had already rejected once, arriving a second time as inaction. |

### The one decision worth arguing about: what the slot is keyed on

**The input CIDs, namespaced `combine:`** — `combine:${inputCids.join(',')}` at `:388`.

A combine's output is a pure function of `inputCids`: same inputs, same bytes, same CID.
So the input set *is* the work's identity, which is exactly the rule the `exec` branch
already follows with `inputCid` plus `partitionIndex`. **The rejected alternative is
`combineId`**, and it is the tempting one because the frame carries it: but `combineId` is
the *tree node's* derived id (`reduce.ts:224`, `hashOf(children.join('|'))`), i.e. a
requestor's claim about where in a tree this sits. Keying on it would let one peer split
identical work across N keys by renaming it — the same failure the exec branch records
against a per-request monotonic id, which *"never collides, so the dedupe never fires"*.

The `combine:` prefix is not decoration. Exec keys begin with a CID string, so the two
namespaces are disjoint by construction and neither branch can dedupe-refuse the other's
work — while both still spend from **one** slot table, because it is one node's CPU and a
bound a peer could spend twice by choosing which verb to send would not be a bound.

### What the refusal says, and in what shape

`admission.reason` **verbatim, with no prefix** — `over-committed: N of M slots in use`,
composed once in `LocalCapacity.#decide` (`placement.ts:389`) and never reconstructed in
`@o2/net`. The `unauthorized: ` prefix exists so one authorizer's text reads identically on
either branch; a capacity refusal wants the same property, and the exec branch adds no
prefix either.

The **combine reply shape**, not an `error` frame — `{resultCid: null, reason}`. This is a
deliberate divergence from the exec branch and the reason is `executeReduce`: its ranking
walk consumes a null result as *"try the next executor"*, which is precisely the right
response to a busy node. An `error` would be classified as a node condition by a caller
that, as it happens, never sees this string at all — `remoteCombineDispatch` collapses
every failure to `null` by documented design. That cost is recorded at the return site
rather than left to be discovered; this branch does not widen that channel.

**Not a queueing change.** An over-committed node says no with a stated reason and does not
buffer. Written into the code comment because the tempting "fix" for a refused reduce is a
queue, and a queue converts a refusal into unbounded latency while hiding the load signal
the ranking walk consumes.

## Task 2 — proved, on two layers, with the leak test carrying more weight

### Which instrument reads which claim

Three readings, and they are **not** interchangeable — this is written into both test files
because conflating them is how a bound stops being measured:

- **The reply text** is the falsifiable reading of the bound. It can carry any string, so
  `toBe('over-committed: 1 of 1 slots in use')` fails on a handler that refused for the
  wrong reason while the combine still correctly produced nothing.
- **The read count** (`counting.gets` in process, `blockstore.fetched` on a real node) is
  the falsifiable reading of *where the check sits*. **The reply text is identical whether
  the cap sits before or after the loop** — only the count can tell them apart. Measured,
  not asserted: see the ordering mutation below.
- **`peakInFlight`** is a **release** reading, never a bound reading. `LocalCapacity.offer`
  returns its refusal before `#inFlight.add`, so `peakInFlight <= slots` is arithmetic and
  cannot fail. What it can say is that a slot really was taken, which is what makes "and
  given back" a measurement rather than a tautology over a counter that never moved.

### In process — `packages/net/src/combine.test.ts:525-680`

Four cases, over `MemoryNetwork` with the file's existing `CountingBlockstore`:

| Case | What it reads |
|---|---|
| `:526` refuses at the limit, reads nothing, combines once a slot frees | reason `toBe('over-committed: 1 of 1 slots in use')`; `gets` **0**; then release, and the identical frame returns the CID a local `fabricCombiner` reference computes, with `gets >= 2` |
| `:577` twenty combines, high-water flat | twenty **distinct** input pairs so the dedupe branch never fires; every reply asserted to have combined; `peakInFlight` **1**, `inFlight` **0** |
| `:613` release on a named failure and on a throw | a missing input, then a store fault (`throwOn`) answered by `serveAgent`'s outer catch, then a success that only a released node can give |
| `:657` release on the authorize refusal | `peakInFlight` **1** with `gets` **0** — a slot held by a path that never entered the loop |

Saturation is **declared, not raced**: the test reserves directly on the node's own
`LocalCapacity` under a key no combine derives, so the incoming frame meets the
over-committed branch and not the dedupe branch. That is the technique
`admission.node.test.ts` already uses on the exec branch.

Every refusal is flanked by a positive control. Without them, `gets === 0` is equally
satisfied by a handler that never reads and the refusal by a node that refuses everything.

### Against real nodes — `packages/node/src/admission.node.test.ts:357-443`

Two `FabricNode`s over tcp + noise + yamux, started by the same `FabricNode.start` call
`bin/agent.ts` makes. **This layer is not redundant and the reason is this phase's own
history**: 16-05's defect survived two milestones precisely because every in-process rig
passed `authorize: 'serves-unauthenticated'`, so no cheap fabric could see a gate keyed on
the real thing's configuration. The node here installs `authorizeCapability`, which admits
every combine — so the only thing that can refuse the frame is the bound under test.

Readings: reason `toBe('over-committed: 1 of 1 slots in use')` after crossing a real
connection; `server.blockstore.fetched` **0** on the refusal and **2** after the slot
frees; the admitted result bit-for-bit against a local `fabricCombiner` reference;
`inFlight` 0, `peakInFlight` 1, `executorPeakInFlight` 0.

### Watched failing first — every new assertion

Planted one at a time, restored with `cp` from `/tmp/o2-16-06-baseline/`, each confirmed
byte-exact with `cmp` (exit 0). **No `git checkout`, `restore`, `stash`, `clean` or
`reset` was run at any point after the startup base correction.**

| # | State / mutation | Assertion turned red | Reading |
|---|---|---|---|
| RED-1 | the four cases run against `agent.ts` **before** the admission block existed | `refused.resultCid` `toBeNull` | `expected CID(bafyreidfwmwpvsywefgaq6tgpj7bjxsdiwyxqcazamty4din6oc77efmta) to be null` — the node at its limit combined anyway |
| RED-2 | same | leak case `peakInFlight` `toBe(1)` | `expected +0 to be 1` |
| RED-3 | same | failure/throw case `peakInFlight` `toBe(1)` | `expected +0 to be 1` |
| RED-4 | same | authorize-refusal case `peakInFlight` `toBe(1)` | `expected +0 to be 1` |
| M31 | `capacity.offer` → `capacity.would` | the three release readings | `expected +0 to be 1`; **the two bound cases stayed green** |
| M32 | the refusal `return` deleted | the bound reading on **both** layers | `expected CID(…) to be null` at `combine.test.ts:545` **and** `admission.node.test.ts:407` |
| ORD | the cap moved **below** the loop — the decision computed before, acted on after | the two **read-count** readings | `gets` **0 → 2** at `combine.test.ts:553` and `fetched` **0 → 2** at `admission.node.test.ts:415`, **with both refusal-text assertions still green** |

Three of these are worth more than their row.

- **Under ORD only the read counts moved.** That is the measured form of the inherited
  rule *"a cap applied after a loop has already paid for the allocation it exists to
  prevent"* — the reason string was correct in both placements, the transfers were not.
  It is why `gets` and `fetched` are asserted at all, and it is the same shape 16-05's
  mutation C established for the authorize ordering one line up.
- **M31 deliberately does not catch the bound cases**, because they declare saturation by
  reserving directly, so `would()` still sees a full table and still refuses. The ledger
  entry says so in those words rather than claiming a reach it does not have.
- **M32 is caught on both layers**, which is the whole argument for the real-node file
  existing beside the in-process one.

## Task 3 — the disclosure, corrected to what is now true

`agent.ts:307-352`. The old text opened *"bounded, accepted, and not closed"*, listed three
bounds, and named admission as the future answer. It now opens **"slot-bounded per node,
and not eliminated"** and lists four bounds **with the quantity each one measures**,
because the tempting misreading is that they compose:

| Bound | What it bounds | Where |
|---|---|---|
| `MAX_COMBINE_INPUTS` | *k* — how many reads **one frame** may provoke | at the parser (`protocol.ts:557`); a larger frame never becomes a request |
| the sequential loop with an early return | a frame's cost at **the first input this node refuses** | the loop's shape, asserted by `store.fetched === 1` on a five-input frame |
| **admission (new)** | how many combines this node has **in flight at once**, at its own `LocalCapacity.slots` | `agent.ts:387-405`, at zero reads |
| the `Authorizer` refusal | zero reads on that exit — but it **admits every combine on this build**, so bound 3 and not this one is what binds today | `combineAdmitted` |
| NET-08's `MAX_INBOUND_MESSAGE_BYTES` | the size of **one inbound message**, with a per-peer accumulation cap beside it | `@o2/libp2p` |

**No product of these is written, and the comment says none may be** — a residency figure
nobody measured against a running node is not a guarantee, which is the standard the
comment already held itself to and the reason the previous version was careful too.

**What remains open is stated, not implied.** Admission bounds *concurrency*, never
*arrival rate*: a peer sending combines one at a time, waiting for each, meets no refusal
at all and can keep a slot busy indefinitely. And an *admitted* combine still performs real
reads — each already pulled over the wire, hash-verified and written locally by the time
`MAX_PARTIAL_BYTES` sees it. **Slot-bounded per node, not eliminated.** That phrase is the
whole of the honest claim.

Two docstrings that my change would otherwise have made false were corrected with it, since
a comment describing code has to land in the commit that changes the code:

- `AgentOptions.capacity` said *"the two branches use it differently"*. Three do now, and
  the entry for the combine branch states why its refusal takes the combine shape.
- `LocalCapacity.offer` said *"the only production caller of the reserving form is
  `serveAgent`'s exec branch"*. Two now. And `LocalCapacity.peakInFlight` said the peak and
  the `execute` count *"coincide"* — they no longer do on a node that has served a combine,
  which matters because `admission.node.test.ts` reads that counter.

## Task 4 — the mutation ledger

**Two entries, not one.** The taking and the refusing fail independently and are caught by
different readings, so one entry would have overstated its reach — the split follows the
ledger's own M3a/M3b and M2a/M2b precedent.

| id | Mutation | `caughtBy` | Signature (read off a planted run) |
|---|---|---|---|
| M31 | `capacity.offer` → `capacity.would` on the combine branch | `combine.test.ts` | `does not climb its high-water mark across twenty combines` |
| M32 | the refusal `return` deleted | `combine.test.ts`, `admission.node.test.ts` | `AssertionError: expected CID(` |

Neither `caughtBy` names an `*.e2e.test.ts`, so `project` correctly stays at its `node`
default — the Phase 14 trap named in the brief does not apply.

**No existing entry's `find` text was invalidated**, and it was checked rather than assumed.
M1's exec-branch line is
`const admission = capacity.offer({ shardId: slotKey, nodeId: executor.nodeId })`; the new
combine line differs by `options.` and neither is a substring of the other. `grep -c` reads
**1** for each, and for M32's return line.

**Both signatures were read off a real planted run, never predicted:**

```
$ npm run test:mutations -- --only=M31,M32
  M31  packages/net/src/agent.ts … caught (1.2s)
  M32  packages/net/src/agent.ts … caught (8.8s)
  M31  PASS  caught  1.2s  exit 1 with the recorded signature
  M32  PASS  caught  8.8s  exit 1 with the recorded signature
```

The **full** suite was then run: **36 of 37 caught.** The one that was not is `M2b`, and it
is **pre-existing and unrelated** — caught in substance (`serve-agent-hooks.node.test.ts`
goes red at `:141`, `expected 1 to be +0`) but recorded with a signature one word off the
test's actual name, *"four sentinels"* against *"three sentinels"*. Confirmed pre-existing:
`git show a3fc168` reads `three sentinels` in the test and `four sentinels` in the ledger,
and the rename landed in `19412e5` (Phase 15-03). Logged to `deferred-items.md` with the
reading, the cause and the fix that would prevent the next occurrence, and **not fixed** —
it is an unrelated entry about the browser factory's `capacity` wiring, and the script's own
instruction is to report a survivor by id rather than edit around it.

## Corrections to what I was handed

| Claim | Actual | Verdict |
|---|---|---|
| *"`LocalCapacity.would` reserves nothing…; `LocalCapacity.offer` does not reserve"* | `offer` **does** reserve — `placement.ts:372-378` calls `#decide` and then `#inFlight.add`. It is `serveAgent`'s **`offer` request branch** that reserves nothing, by answering through `would`. | **wrong as written**; read as a slip for the wire branch, and the code follows the source |
| *"The hook is named `admission`, not `capacity`"* | Both names exist and name different things. `FabricNode.admission` (`fabric-node.ts:378`) is the instrument; `AgentOptions.capacity` (`agent.ts:171`) is the hook. `fabric-node.ts:365` explains the split — `capacity` on that class already means relay reservation capacity since NET-05. | **half right**, and the half that is wrong would have led to renaming an `AgentOptions` field |
| `agent.ts` disclosure *"around `:305-323`"* | The block runs `:292-323` at the base commit — the header is at `:292`, not `:305`. | **imprecise**; the paragraph named is at `:310-323` and is the one that was accurate |
| *"the existing combine tests use a counting blockstore (`combine.test.ts`)"* | `CountingBlockstore` at `:269-294`, used by `authorizingNode` at `:302` | **correct** |
| *"`admission.node.test.ts` — Phase 13.1's proof of the exec-branch bound"* | confirmed; `:302` is the declared-saturation technique this plan reuses | **correct** |
| *"`LocalCapacity` has a high-water instrument from 13.1"* | `peakInFlight`, `placement.ts:330`, with a docstring that already warns it is not a bound reading | **correct** |
| *"grep `over-committed: N of M slots in use`, do not transcribe"* | grepped; composed once at `placement.ts:389`, and the exec branch sends it with no prefix | **correct**, and the no-prefix detail is why the combine branch adds none either |
| *"`bin/bench.ts` ships `SHARDS = 16`"* | `bench.ts:90` | **correct** |
| *"the tree over 8 leaves at fanout 4 is `nodes: 3, depth: 2`; over 16 it is `nodes: 5, depth: 2`"* | matches the four passing process tests and the artifact | **correct** |
| *"`discovery.test.ts` pins four shards on one 1-slot node… do not let your change alter it"* | `git diff --stat` empty; 35 → 39 in the trio it runs in only because `combine.test.ts` grew | **correct**, and unaltered |
| *"Two entries added in Phase 14 failed because their `project` field was wrong"* | neither new entry names an e2e file, so the default applies | **correct**, not applicable here |
| *"The worktree has no `node_modules`; `@o2/*` are relative symlinks"* | both confirmed — `ls -l` shows `core -> ../../packages/core`; farm built and proven | **correct** |
| *"Assume every `file:line` is stale until you re-grep it"* | Every citation above was re-grepped. Two were off (rows 2 and 3). | **correct, and load-bearing** |

## Deviations

### [Rule 2 — missing critical] Two `LocalCapacity` docstrings corrected with the code

Not asked for. `LocalCapacity.offer` claimed a single production caller and
`peakInFlight` claimed the peak coincides with `execute` calls; both become false the moment
the combine branch reserves. A comment that describes code has to land in the commit that
changes it, or one commit ships a lie. Recorded here rather than buried because it widens
the diff into `@o2/core`.

### [Rule 3 — blocking] No `node_modules` in the worktree

Farm built: 238 third-party entries absolute-linked into the main install, every `@o2/*`
repointed here. **Proven, not assumed** — `createRequire(worktree/package.json).resolve` +
`realpathSync` reads 8/8 `@o2` packages inside this worktree, with `vitest` and `typescript`
from the main install. A wholesale symlink would have resolved `@o2/*` back to the main
checkout through their relative links and reported clean without reading a line of this work.

### Not a deviation, but worth stating

- **`STATE.md` and `ROADMAP.md` were not modified**, as instructed.
- **`REQUIREMENTS.md` was not edited.** SCHED-06 is already recorded; this plan extends its
  reach to a second branch rather than satisfying a new requirement, and ticking anything
  would have risked the traceability guard for no gain.
- **No assertion anywhere was weakened.** The only change to existing test infrastructure is
  additive: `CountingBlockstore` gained an opt-in `throwOn` field defaulting to `null`, so
  every existing reading through it is byte-identical.
- **The startup `git reset --hard`** to the required base `a3fc168` was the sanctioned
  worktree base correction and the only `reset` in this session. `HEAD` was at `c62bae5`
  (a Phase 13-era merge), the tree was clean, and nothing was discarded.

## Deferred, not fixed

**`M2b`'s recorded signature drifted off the test it names** — see Task 4 and
`deferred-items.md`. Pre-existing since `19412e5`, caught in substance, and loud rather than
silent: the script reports it as a survivor by id, which is the correct failure mode.

## Verification

Every gate run against a resolver **proven** to read this worktree, never the main checkout:

```
OK   @o2/core   -> …/agent-a86f9fb8b201c4842/packages/core/src/index.ts
OK   @o2/net    -> …/agent-a86f9fb8b201c4842/packages/net/src/index.ts
OK   @o2/node   -> …/agent-a86f9fb8b201c4842/packages/node/src/index.ts
     (8/8 @o2 inside the worktree; vitest + typescript from the main install)
```

| Gate | Command | Result |
|---|---|---|
| Typecheck | `npx tsc --noEmit`, repository root | **exit 0** (run five times across the session) |
| Node suite | `O2_UNIT_ONLY=1 vitest run --project node` | **1251 passed, 18 skipped, 0 failed** (88 files) |
| Browser suite | `vitest run --project browser` | **3063 passed, 0 failed** (204 files) |
| `@o2/net` package | `vitest run --project node packages/net/src` | **224 passed** (21 files) |
| Real `FabricNode`s | `vitest run --project node packages/node/src/admission.node.test.ts` | **7 passed** |
| Eight/nine real processes | `vitest run --project node packages/node/src/tree-reduce-agents.node.test.ts` | **4 passed** — Phase 16's criteria still hold with the bound in place |
| `combine.test.ts` in three engines | `vitest run --project browser packages/net/src/combine.test.ts` | **75 passed** (25 × chromium/firefox/webkit) |
| `discovery.test.ts` | `git diff --stat` | **empty** — unchanged, and passing |
| Repo guards, run **after** committing | `vocabulary` + `purity` + `serve-agent-hooks` + `mutation-guard` + `acceptance-traceability` | **141 passed** |
| Mutation ledger, cheap layer | `vitest run --project node packages/node/src/mutation-guard.node.test.ts` | **56 passed** |
| Mutation ledger, planting layer | `npm run test:mutations` | **36 of 37 caught**; the one survivor is pre-existing `M2b`, logged |
| Working tree | `git status --short` | empty; `md5` identical to scratch baselines after every restore |

Host load read before every run: **4.26 – 25.83** on 8 cores across the session (the peak is
the three-engine browser run's own). **No timing bound was set or changed by this work, and
no verdict above rests on a duration.**

### Count reconciliation, so 1251 is a reading rather than a number

The baseline was **measured, not quoted**. All five modified files were replaced with
`git show HEAD:<path>` (read-only) via a scratch script, the identical command was run, and
the files were restored from `/tmp/o2-16-06-mine/` with a byte-equality check on each:

```
before:  Test Files  86 passed | 2 skipped (88)   Tests  1245 passed | 18 skipped (1263)
after:   Test Files  86 passed | 2 skipped (88)   Tests  1251 passed | 18 skipped (1269)
```

**1245 is exactly 16-05's figure, independently reproduced.** The +6 is attributed per file
from the JSON reporter, before against after — nothing else in the tree moved:

| File | Before | After |
|---|---|---|
| `packages/net/src/combine.test.ts` | 21 | 25 (+4) |
| `packages/node/src/mutation-guard.node.test.ts` | 54 | 56 (+2, one per new ledger entry) |

**The fifth new test is not in that +6, and that is a reading rather than an oversight:**
`admission.node.test.ts` is one of the two files `O2_UNIT_ONLY=1` skips, so its 6 → 7 does
not appear in that total. It was measured separately at **7 passed**. The 18 skipped is the
pre-existing baseline, unchanged: **no test was skipped to make this pass.**

## Known Stubs

None.

## Threat Flags

| Flag | File | Description |
|---|---|---|
| threat_flag: combine-arrival-rate-unbounded | `packages/net/src/agent.ts` | The concurrency half of 16-02's `unauthenticated-fetch-amplification` flag is now closed on every node the repository can start: at most `LocalCapacity.slots` combines are in flight at once, and one over that is refused by name at zero reads. **The rate half is not, and must not be read as such.** Admission bounds concurrency, never arrival rate — a peer that sends combines serially, waiting for each, meets no refusal at all. This is the same residue the `exec` and `block` branches carry and is answered the same way; a rate limit is a different mechanism and no criterion in this phase asks for one. Disclosed in the code at `runCombine`'s header under *"What remains open"* rather than only here. |

## Self-Check: PASSED

- `packages/net/src/agent.ts` — FOUND. `grep -c 'const admission = capacity.offer({ shardId: slotKey, nodeId: options.executor.nodeId })'` → **1**; `grep -c 'capacity?.release(slotKey)'` → **2** (one per reserving branch, which is the intended count and was checked rather than assumed).
- `packages/net/src/combine.test.ts` — FOUND, four new cases at `:526`, `:577`, `:613`, `:657`.
- `packages/node/src/admission.node.test.ts` — FOUND, new describe at `:357`.
- `packages/node/src/mutation-ledger.ts` — FOUND, `M31` and `M32` present; `mutation-guard.node.test.ts` green at 56.
- `.planning/phases/phase-16-decomposable-tree-reduce-wiring/deferred-items.md` — FOUND, M2b entry appended.
- Commits `3b54897`, `0f5e769`, `a3114f4` — all FOUND in `git log a3fc168..HEAD`.
- `cmp` exit 0 for `packages/net/src/agent.ts` against the scratch baseline after **every**
  restore, including the one the mutation script performed itself (`git status --porcelain
  is empty — the tree is as it was found`).
- `STATE.md` and `ROADMAP.md` — untouched; absent from `git status` and from all three
  commits throughout.
