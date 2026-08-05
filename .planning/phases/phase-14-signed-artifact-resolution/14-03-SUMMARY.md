---
phase: phase-14-signed-artifact-resolution
plan: 03
subsystem: security
tags: [provenance, signed-names, node-tier, cli-flags, repo-scan, benchmark]

# Dependency graph
requires:
  - phase: phase-14-plan-01
    provides: "guardModuleProvenance / ModuleProvenance — the adapter this plan gives a production caller"
  - phase: phase-14-plan-02
    provides: "moduleRecord on the wire and on JobSpec, and KERNEL_TRUST_ANCHOR / KERNEL_RECORD from @o2/demo — the default both binaries pin"
  - phase: phase-11
    provides: "AgentOptions' required-field-with-named-sentinel convention that trustAnchors adopts"
provides:
  - "FabricNodeOptions.trustAnchors — required, readonly PublicKeyHex[] | 'runs-unsigned-artifacts'"
  - "SeedServerOptions.trustAnchors — required, passed straight through"
  - "guardModuleProvenance composed innermost in FabricNode.start, on every node the Node tier builds"
  - "--trust-anchor on bin/agent.ts and bin/seed.ts, repeatable, identical default expression"
  - "bin/agent.ts prints trustAnchors in its handshake line — the field 14-05 reads"
  - "bin/bench.ts signs, carries and checks a record in all three rigs"
  - "trust-anchors.node.test.ts — the opt-out scan, the call-site assertion, the two-binaries comparison, the resolver census"
affects: [phase-14-plan-04, phase-14-plan-05, phase-21-aot, phase-23]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "A required option whose escape hatch is a named string literal the call site must write"
    - "A repo scan whose own source assembles every string it matches on, so it cannot report itself"
    - "A guard composed innermost, next to the code it guards, so ordering is structural rather than inspected"
    - "A one-off runtime reading is recorded with both halves — the value as shipped and the value under a planted defect"

key-files:
  created:
    - packages/node/src/trust-anchors.node.test.ts
  modified:
    - packages/node/src/fabric-node.ts
    - packages/node/src/seed-server.ts
    - packages/node/src/bin/agent.ts
    - packages/node/src/bin/seed.ts
    - packages/node/src/bin/bench.ts
    - packages/node/package.json
    - packages/node/src/fabric-node.node.test.ts
    - packages/node/src/bench-egress.node.test.ts
    - packages/node/src/two-process.node.test.ts
    - packages/node/src/sovereignty-placement.node.test.ts
    - packages/node/src/egress-refusal.node.test.ts
    - "and 12 further call sites, each stating its anchors"

key-decisions:
  - "One signed record covers all three benchmark rigs, because a CID is a function of the bytes and both blockstores compute it identically — measured against both put implementations, not assumed"
  - "EXEMPT_PATHS holds one entry, not the two the plan predicted: seed-server.ts declares its field as FabricNodeOptions['trustAnchors'] and never names the literal"
  - "tools/aot/bench-lifted.ts and tools/aot/measure-wasi.ts construct WasiExecutor outside a test — declared with reasons rather than allowed to fail an assertion that would then be weakened"
  - "FabricNode.start loses its `= {}` default parameter, which is what turns an omitted trustAnchors into a compile error at every call site"
  - "The benchmark's incomplete column IS a runtime reading of the signed path, and was watched moving 0 -> 5; only the exit code is worthless"

patterns-established:
  - "Assemble every scanned string from fragments — a scan that names its own query counts itself, and only once committed"
  - "Measure before recording a site as unexercised: replace its anchors with a set that refuses and re-run"

requirements-completed: []

# Metrics
duration: 21min
completed: 2026-07-31
---

# Phase 14 Plan 03: The Node Tier's Half Summary

**`guardModuleProvenance` has a production caller — composed innermost in `FabricNode.start`, on every node the Node tier builds, behind a `trustAnchors` option that is required and has no default, so there is no construction path that yields a bare-CID node without a call site having written down that it wants one.**

## Performance

- **Duration:** 21 min
- **Started:** 2026-07-31T15:20:03-07:00
- **Completed:** 2026-07-31T15:41:27-07:00
- **Tasks:** 3
- **Files modified:** 28 (1 created, 27 modified)

## Task Commits

| Commit | Task | What |
|---|---|---|
| `2663b5f` | 1 (RED) | Six behaviours read through `node.executor`; five fail, one passes trivially |
| `41a9d52` | 1 (GREEN) | `trustAnchors` required, the guard composed, both binaries flagged |
| `b65a0f1` | 2 (RED) | Two `REQUIREMENTS` entries; real source fails, six planted cases pass |
| `7f81d62` | 2 (GREEN) | The benchmark signs; 19 call sites state their anchors |
| `da448da` | 3 | `trust-anchors.node.test.ts` — the scan, the call site, the binaries, the census |
| `dc8006a` | 3 (fix) | The census had been counting itself |

## What was built

### The option, and why it is shaped this way

`FabricNodeOptions.trustAnchors: readonly PublicKeyHex[] | 'runs-unsigned-artifacts'`, required, no `?`, no default. This is `AgentOptions`'s convention — `authorize: Authorizer | 'serves-unauthenticated'` and its five siblings — adopted for PROJECT.md's Key Decision *"an optional hook with a silent default is a hole"*. Whichever default were chosen, a node would get it without anyone deciding.

`FabricNode.start` also **loses its `= {}` default parameter**. That is the load-bearing half: with it, a call site omitting `trustAnchors` still compiles.

Three values, and `[]` is deliberately not special-cased into meaning the opt-out — an empty set is a node that trusts nobody, which is the correct reading, and there is a word for the other thing.

### The composition, and the two orderings that are decisions

```ts
const executor = new CountingExecutor(guardSovereignty(provenance(compute), sovereignty))
```

`provenance` sits **innermost**, with nothing between it and the executor that reaches `WebAssembly.instantiate` — which makes ROADMAP criterion 2's "before instantiation" true by construction rather than by inspecting whatever is layered above it this month. Sovereignty stays **outside** it: a node that may not decrypt an owner's data should say *that*, whatever module was named, because the clearance answer is about this node and is the more useful one to return.

### Both binaries, one default

`bin/agent.ts` and `bin/seed.ts` both write `values['trust-anchor'] ?? [KERNEL_TRUST_ANCHOR]`. Two processes started with no flags answer the same dispatch the same way, and `--trust-anchor` **replaces** rather than extends. `bin/agent.ts` prints `trustAnchors` in its handshake line — the field 14-05 reads across a real process boundary.

## Where the plan was wrong, measured rather than reasoned

Six corrections. Every one was read off the repository; none was deduced.

### 1. The composition the plan quoted no longer exists

The plan's `<interfaces>` block gives the line to extend as:

```ts
registerSovereignInputs(guardSovereignty(new WasmExecutor(...), sovereignty), { blockstore: store, guard: egress })
```

`registerSovereignInputs` is gone from `fabric-node.ts`, and the module-instantiating executor is a `WorkerExecutor`, not a `WasmExecutor`. The real line was `new CountingExecutor(guardSovereignty(compute, sovereignty))`. Wrapped `compute`, which is the executor that resolves.

### 2. The resolver census is not the three files the plan names

```
$ grep -rn '\.get(task\.moduleCid)' --include='*.ts' --include='*.mts' --include='*.js' --include='*.mjs' packages tools
packages/core/src/executor/worker-executor.ts:175
packages/core/src/executor/wasm.ts:84
packages/core/src/executor/module-provenance.ts:8      <- inside a comment
packages/aot/src/wasi-executor.ts:794
```

The plan (inheriting from 14-CONTEXT.md) names `packages/browser/src/worker-executor.ts`. That file resolves nothing — it delegates to `@o2/core`'s `WorkerExecutor`, which is the one a `FabricNode` actually composes. And `module-provenance.ts` matches the raw grep from inside its own module comment, which is a live demonstration of why the census reads stripped source.

### 3. `new WasiExecutor(` occurs in two non-test files

The plan states it occurs "only in `packages/aot/src/*.test.ts`". Measured:

```
tools/aot/bench-lifted.ts:148
tools/aot/measure-wasi.ts:133
```

Both are hand-run build-time measurement drivers over a local file — no socket, no dispatcher, no publisher for a record to name. Declared in `WASI_TOOL_SITES` with a reason each, and each declaration is itself checked for staleness. **The assertion was not weakened to accommodate them**; the alternative — dropping the `new WasiExecutor(` check — would have deleted the thing that fires when Phase 21 gives it a production caller.

### 4. `EXEMPT_PATHS` is one entry, not two — and the test found it

The plan's `must_haves` asserts the literal survives in "the option-type declarations that cannot be written without naming it — two at the end of this plan, `fabric-node.ts` and `seed-server.ts`". False. `SeedServerOptions` declares its field as `FabricNodeOptions['trustAnchors']` — an indexed access that names the *option*, not the union — so its stripped source contains zero occurrences. The stale-entry assertion caught this on its first run:

```
× carries no exemption that no longer matches anything
+ ["packages/node/src/seed-server.ts — no longer names the opt-out; delete this entry (…)"]
```

The exemption went, not the type: the indexed access is better code because it cannot drift from `FabricNodeOptions`.

### 5. One record covers all three benchmark rigs

The plan says to "sign one record per rig over the rig's own `moduleCid` (they differ between rigs because each builds its own store)". They do not differ. Both `put` implementations compute `CID.create(1, dagCbor.code, await sha256.digest(bytes))`, and `FsBlockstore`'s own comment says why: *"Same CID scheme as MemoryBlockstore, deliberately."* One record, plus `sameFixtureCid(rig, cid)` asserting agreement per rig so a divergence throws by name instead of silently refusing every shard.

### 6. Five call sites the plan's file list omits

`admission`, `execution-deadline`, `named-refusal`, `sovereign-block-refusal` and `start-unwind` all construct nodes and were not listed. Nothing compiled until they were updated (Rule 3).

## The defect this plan's own test found in itself

`trust-anchors.node.test.ts` reported **itself** as a fourth resolver. The planted case spelled `.get(task.moduleCid)` out as a plain string — one line below the comment explaining why `OPT_OUT` is assembled from fragments for exactly that reason.

**It passed run alone and failed once committed.** The walk reads `git ls-files`, and an untracked file is not in the population:

```
$ npx vitest run --project node packages/node/src/trust-anchors.node.test.ts   # untracked
      Tests  18 passed (18)

$ git commit … && npx vitest run --project node packages/node …                # tracked
AssertionError: expected [ …(4) ] to deeply equal [ …(3) ]
+   "packages/node/src/trust-anchors.node.test.ts",
```

Fixed by assembling the fragment, and turned into a standing assertion (`does not name either census matcher in its own source`) so the next edit that spells one out fails on a message saying so rather than on a census reading that looks like a real finding.

## Measurements

Every reading below was taken; none is derived.

### The benchmark's `incomplete` column is not unmeasured

The plan records as **UNMEASURED** whether a `--quick` run actually completes signed jobs, on the ground that the run exits 0 either way. The exit code is indeed worthless — but the `incomplete` column is not, and both readings were taken:

| `node bin/bench.ts --quick` | exit | `incomplete`, all six sweeps |
|---|---|---|
| as shipped | 0 | **0** |
| `BENCH_TRUST_ANCHOR` planted as a key that signed nothing | 0 | **5** |

A refused shard makes `result.job.complete` false, so a rig whose guard was refusing reports it. The rigs really do complete signed jobs. Two limits stated rather than glossed: the planted case did not isolate *which* rig refused (all six sweeps moved together), and nothing re-derives either reading on a later run. `.planning/BENCHMARK-RESULTS.md` and `.planning/bench/raw.json` were restored to their committed state — re-recording the sweep is out of scope.

### The two demo-tier anchor sets are never consulted

The plan requires this be measured before either site is recorded as unexercised. Both were replaced with `[]` — a set that refuses every module — and the two files re-run:

```
$ npx vitest run --project e2e packages/node/src/colouring-demo.e2e.test.ts packages/node/src/seed-discovery.e2e.test.ts
 Test Files  2 passed (2)
      Tests  15 passed (15)
```

Not one assertion changed. **Neither set is ever consulted.** They hold `[KERNEL_TRUST_ANCHOR]` because that is what `bin/seed.ts` pins with no flags, and these two files are the closest thing in the repository to a picture of that deployment — realism, not coverage.

**The measurement that was available and declined:** adding `relay.peerId` to `colouring-demo`'s `runColouring({peerIds})`, which that file already has in hand, would give the site real coverage. Not done — it would change which nodes the job dispatches to and therefore change DEMO-01's own `expect([...agreeing].sort())` reading, i.e. edit the proof of another phase's criterion to decorate this one.

### The scan can flag a real production file, not only synthetic content

The four planted cases run through the pure classifier. To prove the *walk* reaches production files, one real occurrence was appended to `packages/browser/src/browser-node.ts`:

```
+ "packages/browser/src/browser-node.ts:345 names the provenance opt-out outside a test —
   \"const wouldBeAHole = 'runs-unsigned-artifacts'\". A production path that wants to run
   unsigned artifacts is a decision for the owner of the deployment, not a value to pass…"
```

Reverted by `cp` from a baseline copy; `cmp` silent, `git status --short` clean. `git clean`, `git checkout --`, `git restore` and `git reset` were not used on any source file during this plan.

## Every new test watched failing first

| Task | RED evidence | GREEN |
|---|---|---|
| 1 | 6 failed / 7 passed (13) — five DET-03 behaviours plus both `bin/agent.ts` source assertions | 13 passed |
| 2 | 1 failed / 8 passed (9) — real `bin/bench.ts` fails both new requirements; the six planted cases already pass, so each new entry was shown reportable on its own before the driver had a line of it | 9 passed |
| 3 | 1 failed / 17 passed (18) — the stale `seed-server.ts` exemption; then 1 failed / 18 passed after commit — the self-matching census | 19 passed |

The sixth Task-1 behaviour (`runs an unsigned task when the call site wrote down that it wants one`) **passed** in RED. That is correct and is stated rather than hidden: the escape hatch doing nothing is exactly what a repository with no guard looks like.

## Verification

| Check | Result |
|---|---|
| The resolver reads *this* worktree | `@o2/core -> .../agent-ae927f3d4e4bbd61e/packages/core/src/index.ts` |
| `npx tsc --noEmit` (whole repository) | exit 0 |
| `npx vitest run --project node packages/node packages/core packages/net packages/demo` | 66/67 files, **858 passed**, 1 pre-existing failure |
| `npx vitest run --project e2e` × the 6 touched files | **30 passed (30)** |
| `node packages/node/src/bin/bench.ts --quick` | completes, writes its output, `incomplete=0` everywhere |
| `vocabulary.node.test.ts`, `purity.node.test.ts` | pass — run **after** committing, since both scan `git ls-files` |
| Assertions weakened | **none** — see below |

### No assertion was weakened

Every deleted line across all 27 modified files, in full:

```
$ git diff 6289882..HEAD -- <the sensitive test files> | grep '^-' | grep -v '^---'
-import { canonicalCid, submitJob } from '@o2/core'                       (import, re-added wider)
-import type { CanonicalValue, NodeDescriptor } from '@o2/core'           (import, re-added wider)
-  const child: AgentProcess = spawn(process.execPath, [AGENT, …], {      (reformatted, args appended)
-async function spawnAgent(name: string): Promise<Agent> {                (gained an extraArgs param)
-/** Every fragment except `omit`, joined — a source satisfying three of the four. */   (stale count)
-      // `toEqual` rather than `toContain` on purpose: it asserts the other three are  (stale count)
-  const node = await FabricNode.start({ listen: [...] })                 (reformatted, anchors added)
```

Imports, reformatted construction calls, a signature that gained a parameter, and two comments whose counts went stale when `REQUIREMENTS` grew from four to six. No `expect` was changed, relaxed or removed anywhere.

### Pre-existing failure, proved pre-existing

`acceptance-traceability.node.test.ts > found the ids that are certainly in the ledger` fails on `expect(locate('SCHED-06')?.satisfied).toBe(false)`. Proved not mine by stashing this plan's work and running it against the untouched base commit `6289882` — the identical assertion failed, 1 failed / 39 passed. It reads only `.planning/REQUIREMENTS.md:447` (`[x]`, set by `03b91cf`) and its own source (last touched by the earlier `855cdf5`), neither of which this plan modifies. Logged to `deferred-items.md` with the reproduction; not fixed, per the scope boundary.

## Deviations from Plan

### Auto-fixed

**1. [Rule 3 — Blocking] The worktree had no `node_modules`**

Built a symlink farm: third-party from the main install, every `@o2/*` repointed at this worktree's `packages/*`. Proved rather than assumed — `createRequire(...).resolve('@o2/core')` reports the worktree path, and the baseline `tsc --noEmit` was run on the untouched tree before any edit. No tracked file changed (`node_modules/` is gitignored).

**2. [Rule 3 — Blocking] Five call sites the plan's file list omitted**

`admission`, `execution-deadline`, `named-refusal`, `sovereign-block-refusal`, `start-unwind`. Nothing compiled without them. All take `'runs-unsigned-artifacts'`; `start-unwind`'s seven sites read one named constant so they cannot drift apart. Commit `7f81d62`.

**3. [Rule 1 — Bug] The census counted itself**

Described in full above. Commit `dc8006a`.

**4. [Rule 2 — Missing critical] A fourth pattern on the benchmark requirement**

The plan specifies patterns for `guardModuleProvenance(`, `new SignedNameResolver(` and `moduleRecord:`. `realFabric` composes neither guard directly — it asks `FabricNode.start` for one by naming `trustAnchors` — so a deletion of that rig's anchors would have been invisible to all three. Added `/\btrustAnchors\s*:\s*\[/` as a fourth.

**5. [Rule 2 — Missing critical] `sameFixtureCid`**

Not in the plan. Once one record covers three rigs, a store that addressed the fixture differently would refuse every shard and report an incomplete run with no clue why. One named throw at start-up instead.

### Corrections to the plan's stated facts

Six, all in *Where the plan was wrong* above. None changed the plan's structure, scope or intent — each replaces a quoted fact with a read one, which is the discipline the plan itself asks for.

### Departure worth naming

`packages/node/src/bin/seed.ts`'s printed summary gained the anchors line the plan specifies, and its comment says plainly that **nothing asserts it** — no test spawns that binary. That is the plan's own instruction, recorded here so it is not mistaken for coverage.

## Requirements

`requirements-completed` is **empty**. DET-03 and DATA-08 are closed only "in part" by this plan — the Node tier's half. `packages/browser/src/browser-node.ts` still composes no guard, and `packages/demo/src/kernel.ts`'s bundle-embedded bytes still reach `runColouring` unguarded. Plan 14-04 owns both. Marking the requirements complete here would assert a property of the browser dispatch path that does not hold.

## Known Stubs

None. Every export this plan adds is reached: `trustAnchors` is read by `FabricNode.start` and observed through four behaviours plus a remote dispatch, `--trust-anchor` is passed to real spawned processes in three files, and the benchmark's records are checked at runtime by the `incomplete` reading above.

One **stated absence**, not a stub: `bin/seed.ts`'s anchors line is unasserted, and both its own comment and this summary say so, along with what would measure it.

## Threat Flags

None. This plan adds no network endpoint, no auth path, no file access pattern and no schema at a trust boundary. It removes surface rather than adding it: every Node-tier executor now refuses a module no pinned anchor vouched for. The one new *input* is `--trust-anchor`, an operator-supplied public key on the local command line of a process the operator started.

## Next Plan Readiness

- **14-04** appends two one-line data edits to `trust-anchors.node.test.ts` in the same task that adds the literal to `browser-node.ts`: an `EXEMPT_PATHS` entry (**only if** it writes the union out longhand — if it references `BrowserNodeOptions['trustAnchors']` as `seed-server.ts` does, no entry is needed and adding one fails the stale-entry assertion) and a `GUARDED_CONSTRUCTION_SITES` entry. The census entry for `wasm.ts` already names `browser-node.ts` as a future construction site.
- **14-05** can read `trustAnchors` out of `bin/agent.ts`'s handshake line — it is a top-level field beside `peerId` and `multiaddrs`, and the value printed is the array actually passed to `FabricNode.start`.
- **Phase 21** will fail `constructs no WasiExecutor outside a test or a declared build-time tool` the moment it gives `WasiExecutor` a production caller. That is intended; the failure message says to compose the guard at that site and update the census, and explicitly not to add a path to `WASI_TOOL_SITES`.
- **Unchanged and not mine:** 14-CONTEXT.md Risk 1 stands. The demo kernel's bundle-embedded bytes have no record on the browser path and DET-03 has no public-path exemption for them.

## Self-Check: PASSED

All 28 files claimed above exist on disk. All six commit hashes (`2663b5f`, `41a9d52`, `b65a0f1`, `7f81d62`, `da448da`, `dc8006a`) resolve in `git log`. `packages/node/src/fabric-node.ts` contains `guardModuleProvenance(`; both binaries contain `--trust-anchor`; `packages/node/package.json` lists `@o2/demo`. `STATE.md` and `ROADMAP.md` were not touched — the orchestrator owns those writes.
