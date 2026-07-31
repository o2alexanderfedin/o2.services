---
phase: phase-14-signed-artifact-resolution
plan: 05
subsystem: security
tags: [provenance, signed-names, spawned-process, blockstore-instrument, mutation-capture]

# Dependency graph
requires:
  - phase: phase-14-plan-01
    provides: "guardModuleProvenance and its three refusal wordings — the strings this file asserts substrings of"
  - phase: phase-14-plan-02
    provides: "moduleRecord on JobSpec and on the wire; KERNEL_TRUST_ANCHOR from @o2/demo"
  - phase: phase-14-plan-03
    provides: "the guard composed in FabricNode.start, --trust-anchor on bin/agent.ts, and the trustAnchors field in that binary's handshake line"
provides:
  - "packages/node/src/signed-artifact.node.test.ts — all three ROADMAP Phase 14 criteria across a real operating-system process boundary"
  - "The blockstore-directory instrument, shown taking both values: the module block present after an accepted dispatch, absent after every refusal"
  - "bin/agent.ts's anchor set read out of the running process for both the no-flag default and the flagged value — 'replaces, not extends' as a measurement"
affects: [phase-15-capability-chains, phase-21-aot]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Instrument a refusal by what the refusing process did NOT go and fetch, read off its own blockstore directory"
    - "Prove an instrument by watching it take both values, never by a lone negative assertion"
    - "Read a binary's configuration out of its printed handshake rather than off its argv line"
    - "Falsify every assertion before committing it — the file is watched failing under six planted premises, then restored by cp"

key-files:
  created:
    - packages/node/src/signed-artifact.node.test.ts
  modified: []

key-decisions:
  - "spawnAgent deliberately does NOT bake in --trust-anchor, unlike the copy in egress-refusal.node.test.ts — one case is about what a process with no flag pins, so the flag cannot be a constant in the helper"
  - "Containment by CID string, never a count: the accepted case's executor fetches the task's input right after its module, so a count would couple the reading to how many input blocks a dispatch persists"
  - "The substitution case asserts neither CID's block was fetched, not just the dispatched one — both are in the submitter's store and therefore both were reachable"
  - "afterEach carries an explicit 20 s budget rather than Vitest's 10 s hook default, because stopAgent's own SIGKILL fallback is 10 s and an equal outer clock can never let the inner one fire"
  - "requirements-completed left empty: this is the Node tier's proof; 14-04 owns the browser tier and DET-03 has no public-path exemption for the demo kernel"

patterns-established:
  - "A negative reading needs a positive control in the same file or it is a silence, not a measurement"
  - "Falsify before commit: nothing is recorded as passing until it has been shown able to fail"

requirements-completed: []

# Metrics
duration: 12min
completed: 2026-07-31
---

# Phase 14 Plan 05: The Measurement Summary

**All three of Phase 14's ROADMAP criteria now hold against a real `bin/agent.ts` child process: one signed artifact runs end to end with the spawned process named as the agreeing node, four things that are not a signed artifact are refused by name, and in every refusal the agent's own blockstore directory never acquired the module block — the bytes that would have been instantiated were never fetched.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-07-31T15:49-07:00
- **Completed:** 2026-07-31T16:01-07:00
- **Tasks:** 2 (one commit; Task 2 plants and reverts, by design)
- **Files modified:** 1 created, 0 modified

## Task Commits

| Commit | Task | What |
|---|---|---|
| `332f189` | 1 | `signed-artifact.node.test.ts` — five cases against real spawned agents |
| — | 2 | Mutation planted in `fabric-node.ts`, captured below, reverted by `cp`; **no commit, by design** |

## What was built

One file, `packages/node/src/signed-artifact.node.test.ts`, 479 lines, five `it`s. Each spawns **its own agent into its own directory** — stated in a comment where the fixture is set up — so a block fetched by an earlier case cannot make a later case's directory reading pass or fail for the wrong reason.

| Case | What is dispatched | Reading |
|---|---|---|
| Accepted (criterion 3) | Record signed by `publisher` over the dispatched CID | `agreed`; `agreeing` **`toEqual([agent.peerId])`**; agent's dir **contains** the module CID; `agent.trustAnchors` **`toEqual([publisher.pub])`** |
| Bare CID (criterion 1) | `moduleRecord` omitted | `insufficient`; reason contains `signed name record` **and** the module CID; dir does **not** contain it |
| Unpinned key (criterion 2) | Record signed by `impostor` over the correct CID | reason contains `impostor.pub` **and** `not a pinned trust anchor`; dir does **not** contain it |
| Substitution | Valid `publisher` record vouching for `MODULE_ECHOES_INPUT`, task dispatching `MODULE_WRITES_PARTITION` | reason contains **both** CIDs; dir contains **neither** |
| No flag | Stock agent, criterion-3's job verbatim | `agent.trustAnchors` **`toEqual([KERNEL_TRUST_ANCHOR])`**; refused naming `publisher.pub`; dir does not contain the module |

**The instrument.** `FsBlockstore` writes one file per block named by its CID (`fs-blockstore.ts:101-103`); a `FabricNode`'s executor resolves `blockstore.get(task.moduleCid)` as its first act; that blockstore is a `FetchingBlockstore`, which writes a fetched block into the local store on the way through (`net/src/block.ts:120`, verified at that exact line). So the block's presence reads as *this process went and got the bytes* and its absence as *it did not*.

**"Replaces, not extends" is now a measurement.** One handshake field, `trustAnchors`, observed taking `[KERNEL_TRUST_ANCHOR]` in a process started with no flag and `[publisher.pub]` in a process started with one — both by `toEqual`, never `toContain`, because a containment check passes against a merged set, which is exactly the defect the reading exists to catch.

## Every assertion watched failing first — and what was broken to see it

Six premises were planted in the test file, run, captured, and reverted by `cp` from a scratch baseline (`cmp` silent both times). **Nothing was committed until it had been shown able to fail.**

Five planted at once (`Tests 5 failed (5)`):

| # | Case | What was broken | Verbatim failure |
|---|---|---|---|
| 1 | Accepted | Record signed with `impostor.priv` instead of `publisher.priv` | `expected 'insufficient' to be 'agreed'` |
| 2 | Bare CID | Asserted `'not a pinned trust anchor'` instead of `'signed name record'` | `expected 'module provenance refused on 12D3KooWSuow…: no signed name record arrived for bafyreieaeoln2… — a bare CID names bytes, not a publisher' to contain 'not a pinned trust anchor'` |
| 3 | Unpinned key | Asserted `publisher.pub` instead of `impostor.pub` | `Received: "…"signed-artifact-unpinned" is signed by 2c848ad8664ee651…, which is not a pinned trust anchor"` |
| 4 | Substitution | Record signed over `writesCid` instead of `echoCid` — i.e. no longer a substitution | `expected 'agreed' to be 'insufficient'` |
| 5 | No flag | Asserted the *merged* set `[KERNEL_TRUST_ANCHOR, publisher.pub]` | `expected [ Array(1) ] to deeply equal [ …(2) ]`, diff showing only `769c7b0d…` present |

Plants 2 and 3 are the ones worth naming: they prove the four refusals are **four distinct refusals** rather than one refusal wearing different labels. A file where every case merely asserted "insufficient" would pass with a guard that refused everything for one reason.

The sixth had to be run alone, because in the combined run plant #2 failed earlier in the same test and shadowed it:

| # | Case | What was broken | Verbatim failure |
|---|---|---|---|
| 6 | Bare CID, instrument | `not.toContain` inverted to `toContain` on the agent's directory | `AssertionError: expected [] to include 'bafyreieaeoln2jrvncw3my5wb25aiuoztkid…'` |

`expected []` is the reading. The spawned agent's blockstore directory is **empty** after a refused dispatch — printed, not inferred. Set against the accepted case's `toContain` passing on the same helper against the same kind of path, the instrument is shown taking both values, which is what stops every `not.toContain` in this file from being a silence.

## Task 2 — the mutation capture

**Command:**

```
npx vitest run --project node packages/node/src/signed-artifact.node.test.ts packages/node/src/fabric-node.node.test.ts
```

**Mutation:** `packages/node/src/fabric-node.ts:670`, the `provenance(...)` application deleted from the executor composition, so `FabricNode.start` builds exactly the executor it built before this phase while still accepting a `trustAnchors` option that now does nothing:

```
- const executor = new CountingExecutor(guardSovereignty(provenance(compute), sovereignty))
+ const executor = new CountingExecutor(guardSovereignty(compute, sovereignty))
```

**Result — `Tests  8 failed | 10 passed (18)`:**

```
 ❯ |node| packages/node/src/fabric-node.node.test.ts (13 tests | 4 failed) 3090ms
     × executes a task the pinned anchor signed, and refuses the same task with the record omitted 169ms
     × refuses a record signed by a key that was never pinned 176ms
     × trusts nobody when the anchor set is empty, and refuses signed and bare alike 172ms
     × answers a remote dispatch the same way it answers a local one 675ms
 ❯ |node| packages/node/src/signed-artifact.node.test.ts (5 tests | 4 failed) 3397ms
     × refuses a bare CID, naming the missing record and the module it was missing for 735ms
     × refuses a record signed by a key it was not started with, naming that key 664ms
     × refuses a valid record that vouches for a different artifact, naming both CIDs 669ms
     × pins exactly the demo anchor when started with no flag, and refuses a record signed by anyone else 617ms
```

One verbatim assertion from each file, as required:

```
 FAIL  packages/node/src/signed-artifact.node.test.ts > … > refuses a bare CID, naming the missing record and the module it was missing for
AssertionError: expected 'agreed' to be 'insufficient' // Object.is equality
 ❯ packages/node/src/signed-artifact.node.test.ts:333:40
    333|     expect(shard?.verification.status).toBe('insufficient')
```

```
 FAIL  packages/node/src/fabric-node.node.test.ts > DET-03 — a production node runs only a module a pinned anchor vouched for > refuses a record signed by a key that was never pinned
AssertionError: expected true to be false // Object.is equality
 ❯ packages/node/src/fabric-node.node.test.ts:356:24
    356|     expect(outcome.ok).toBe(false)
```

### What the one surviving green test means

**Four refusals red and the accepted case still green is the shape that distinguishes a wired guard from an absent one.** A node with no guard runs everything, so criterion 3's success is exactly as true without the call site as with it. That is why a wiring proof cannot consist of a success — a file containing only the accepted case would have passed under this mutation, unchanged, and reported a phase complete.

### What this capture is, and what it is not

**It is a one-time reading taken on the day it was run.** No command in this plan or any other re-derives it. It is **not** a standing guarantee that the call site is load-bearing and must not be cited as one.

Three things do stand on every later run:

1. `signed-artifact.node.test.ts`'s four refusals — red across a real process boundary if the call is deleted.
2. `fabric-node.node.test.ts`'s DET-03 refusal behaviours (Plan 14-03) — red in-process, faster.
3. `trust-anchors.node.test.ts:331` — `expect(stripped(file)).toContain('guardModuleProvenance(')`, the comment-stripped assertion that the call exists in `fabric-node.ts` at all. This is the cheap one: it fires in milliseconds rather than in spawned processes.

### Revert discipline

`git checkout`, `git restore`, `git stash`, `git reset`, `git add` and `git commit` were **not used on `fabric-node.ts` at any point in Task 2.** Baseline taken by `cp` to `$TMPDIR/o2-14-05-fabric-node.baseline.ts` before planting; restored by `cp` from it; `cmp` silent; `git status --short` empty afterwards. `git clean` was never run anywhere in this plan.

## Corrections to the plan's stated facts

Every `file:line` the plan cites was checked against the source before being relied on. Most were correct; one was not.

### 1. `WasmExecutor` is not what a `FabricNode` composes — the plan repeats a correction 14-03 already recorded

The plan states, in its `<objective>` and again in Task 1's `<action>`, that *"`WasmExecutor`'s first act is `blockstore.get(task.moduleCid)`"* and that this is what the directory reading instruments. Measured:

```
$ grep -n 'get(task.moduleCid)' packages/core/src/executor/worker-executor.ts packages/core/src/executor/wasm.ts
packages/core/src/executor/worker-executor.ts:175:    const moduleBytes = await this.#blockstore.get(task.moduleCid)
packages/core/src/executor/wasm.ts:84:    const moduleBytes = await this.#blockstore.get(task.moduleCid)
```

`fabric-node.ts:664-670` builds a **`WorkerExecutor`**. `WasmExecutor` is a real class with a real resolution point, but it is not on this dispatch path. The instrument is unaffected — both resolve through the same `FetchingBlockstore` — but the class the plan names is the wrong one. **This is correction #1 from 14-03-SUMMARY.md, restated verbatim in a plan written after it.** Recorded in the test file's own header so the next reader is not sent to a class that is not there.

### 2-5. Verified correct, recorded so the next plan need not re-check

| Plan's citation | Status |
|---|---|
| `fs-blockstore.ts:101-103` — `#pathFor` returns `join(this.#dir, cid.toString())` | **correct**, exactly those lines |
| `block.ts:120` — `await this.#local.put(bytes)` in `FetchingBlockstore` | **correct**, exactly that line |
| `naming.test.ts:15-18` — the `keypair(seed)` fixture | **correct**, exactly those lines |
| `bin/agent.ts` prints `trustAnchors` beside `peerId`/`multiaddrs` | **correct**, `agent.ts:89-91` |
| `verify.ts` — `{status:'insufficient', reason:'every executor failed', failures}` | **correct**; `failures[0]` did carry the agent's refusal in all four cases, as the plan predicted it would |

### 6. The scaffolding the plan says to copy could not be copied unchanged

The plan says of `egress-refusal.node.test.ts`'s `spawnAgent`: *"copy this shape, do not invent a new one"*. That helper hard-codes `'--trust-anchor', publisher.pub` into every spawn. Copying it verbatim makes this plan's own no-flag case impossible to write — the flag would always be present. The helper here takes `extraArgs` and passes **no** anchor of its own; the four flagged cases each supply theirs at the call site. Departure named rather than silently absorbed, and the reason is written into the helper's docstring.

## Deviations from Plan

### Auto-fixed

**1. [Rule 3 — Blocking] The worktree had no `node_modules`**

Built a symlink farm: 180 third-party entries linked from the main install, and a **real** `@o2` directory holding absolute symlinks into *this* worktree's `packages/*`. Symlinking `@o2` wholesale would have been silently wrong — the main checkout's `@o2/core` is a relative symlink to the main checkout's `packages/core`, so every tool would have read the wrong sources and reported clean without seeing a line of this work. Proved rather than assumed:

```
$ node -e "…createRequire(cwd).resolve('@o2/core')"
@o2/core   /Volumes/…/worktrees/agent-a51a02fa86a783ebf/packages/core/src/index.ts
@o2/node   /Volumes/…/worktrees/agent-a51a02fa86a783ebf/packages/node/src/index.ts
@o2/demo   /Volumes/…/worktrees/agent-a51a02fa86a783ebf/packages/demo/src/index.ts
vitest     /Users/alexanderfedin/Projects/o2.services/node_modules/vitest/index.cjs
```

A baseline `npx tsc --noEmit` was run on the untouched tree before any edit (exit 0). No tracked file changed — `node_modules/` is gitignored.

**2. [Rule 2 — Missing critical] An explicit `afterEach` budget**

Not in the plan. `stopAgent`'s SIGKILL fallback is a 10 s inner timer and Vitest's default `hookTimeout` is also 10 s, so the inner timer could never fire — the two-clock inversion this project has turned red four times. `afterEach(fn, 20_000)` states the outer clock, and a comment states both. Confined to this file.

### Observation about files this plan does not own — not fixed, not filed

The same 10 s-inner / 10 s-default hook shape exists in `two-process.node.test.ts`, `sovereignty-placement.node.test.ts` and `egress-refusal.node.test.ts`. It is latent, not live: agents exit promptly on SIGTERM, so the fallback has never had to fire in those files. **Not fixed** — out of scope, and those files are not this plan's. **Not filed in `deferred-items.md`** either, deliberately: Plan 14-04 is executing concurrently in another worktree and a same-file append is a merge conflict waiting to happen, for an observation that fits here. Recorded in this summary instead, which is where anyone reading Phase 14's record will find it.

### Timing discipline

Host load was measured before anything timing-sensitive was trusted: `load averages: 8.39 9.58 15.39` on 8 cores, i.e. contended. **No timing bound in this file was derived from a number that was not measured here.** The two budgets that exist are both inherited, both bounds and not measurements, and both stated with their outer clock in a comment: the 30 s handshake budget (inner) against each `it`'s 120 s `testTimeout` (outer), and the 10 s SIGKILL fallback (inner) against the 20 s `afterEach` budget (outer). Nothing in the file measures wall-clock and its header says so.

## Verification

| Check | Result |
|---|---|
| Module resolution reads **this** worktree | `@o2/core → .../agent-a51a02fa86a783ebf/packages/core/src/index.ts` |
| `npx tsc --noEmit` (whole repository), after restore | **exit 0** |
| `--project node packages/node/src/signed-artifact.node.test.ts` | **5 passed (5)**, 3.14 s |
| `--project node` × `signed-artifact` + `fabric-node` + `trust-anchors` | **37 passed (37)** |
| `--project node packages/node packages/core packages/net packages/demo` | 68 files, **864 passed, 0 failed** |
| `vocabulary.node.test.ts`, `purity.node.test.ts` | **38 passed** — run **after** committing, since both scan `git ls-files` |
| `cmp` baseline vs `fabric-node.ts` after revert | **silent** |
| `git status --short` after Task 2 | **empty** |
| Files modified outside this plan | **none** |
| Assertions weakened | **none** — this plan deletes no line of any existing file |

**The pre-existing failure 14-03 logged is gone on this base.** `acceptance-traceability.node.test.ts`'s `SCHED-06` spot-check was fixed by `9e721e4 fix(test): a requirement's state is not a fixture`, which is an ancestor of this plan's base commit — which is why the four-package run above is 68/68 rather than 14-03's 66/67. The entry in `deferred-items.md` is now stale; leaving it is not this plan's call.

## Requirements

`requirements-completed` is **empty**, and deliberately, for the reason 14-03 gives. DET-03 and DATA-08 are closed for the **Node tier** by this plan's measurement. The browser tier is Plan 14-04's, executing concurrently, and DET-03 has no public-path exemption for `packages/demo`'s bundle-embedded kernel bytes. Marking the requirements complete here would assert a property of the browser dispatch path that this plan measured nothing about.

## Known Stubs

None. Every case in this file dispatches to a real spawned process over a real socket and reads a real filesystem directory. No fake, no mock, no in-process substitute for the boundary — which is the plan's own hard constraint and the reason it exists.

## Threat Flags

None. This plan adds no network endpoint, no auth path, no file access pattern and no schema at a trust boundary. It adds one test file and no production code. Its only new file access is `readdir` on a temporary directory the test itself created.

## Next Plan Readiness

- **ROADMAP Phase 14 criterion 3 is met in the form it is written** — `bin/agent.ts`, a real signed artifact, resolved and executed end to end, with the spawned process named as the agreeing node. Criteria 1 and 2 are met across the same boundary for the Node tier.
- **Criterion 2's "before `WebAssembly.instantiate`" is proved by absence of fetch, not by observing the call.** The file header says so in those words. Anyone tempted to quote this file as "we watched instantiation not happen" should read that paragraph first.
- **`bin/seed.ts`'s no-flag runtime behaviour remains unmeasured**, here and everywhere. The recipe is written into the test file's header: spawn `bin/seed.ts --port 0 --ws-port 0 --dir <tmp>` and read its printed anchors line. Not done because that binary boots a Vite dev server.
- **Phase 15** (AUTH-03 capability chains) composes with this rather than replacing it: a chain proves the *caller* may ask, a record proves the *module* is the one the build authority meant to ship. The spawn scaffolding in this file is the shape a capability-chain equivalent would copy.

## Self-Check: PASSED

- `packages/node/src/signed-artifact.node.test.ts` exists on disk (479 lines, 22,677 bytes).
- Commit `332f189` resolves in `git log` and is the only commit this plan's Task 1 made.
- `packages/node/src/fabric-node.ts` is byte-identical to its pre-mutation baseline (`cmp` silent) and contains `guardModuleProvenance(`.
- `git status --short` shows no modification to any file this plan does not own, and none to the files Plan 14-04 owns.
- `STATE.md` and `ROADMAP.md` were **not** touched — the orchestrator owns those writes.
