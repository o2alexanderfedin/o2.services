# Phase 22: Reachability Guard — Context

**Gathered:** 2026-08-04
**Status:** Ready for planning
**Requirement:** WIRE-02
**Origin:** `v1.0-MILESTONE-AUDIT.md` — 36 rows moved back to `[ ]` after tracing them from the five
runnable entry points. The audit's own sentence about that finding is the whole of this phase:
*"the audit found this class of defect and **no test could have**."*

<domain>
## Phase Boundary

A guard test fails when a capability exported from a package barrel has no traced call path from
any of the five runnable entry points. That is the whole subject. This phase builds an
**instrument**, and its subject matter is the *claims the other eleven phases made* — so every
plan here must still make sense when executed after Phases 20, 21 and 23 have moved the tree
underneath it.

**What this phase is not.** It is not a wiring phase. It does not fix an unreachable symbol; it
finds one and names it. Where the reading is red, the honest outcome is a stated disposition and a
score, not a wire hurried in to make the guard green — and a guard made green by widening what
counts as passing is the thing this repository keeps removing.
</domain>

<criteria_verbatim>
## The criteria, taken verbatim from ROADMAP.md — not restated

  1. Running the reachability guard after Phases 11-21 land passes clean — every capability
     exported from a package barrel has a traced call path from one of the five runnable entry
     points (`bin/agent.ts`, `bin/seed.ts`, `bin/bench.ts`, `tools/aot/cli.ts`, the browser demo)
  2. Reintroducing the original defect — commenting out a wired call site, or adding a new
     exported-but-uncalled function — fails the guard, naming the unreachable symbol and the
     barrel it came from, the same way `purity.node.test.ts` names a layering violation
  3. The guard runs as part of the same CI gate as the rest of the suite, so a future change that
     builds a mechanism without wiring it to an entry point fails CI rather than merging silently,
     the way the original 36 did

**The count is over criteria, never over requirements.** Three criteria, three verdicts. See
`<unscored_work>` for one body of work the requirements ledger routes here that **none of these
three criteria scores**.
</criteria_verbatim>

<findings>
## Measured findings — build on these, do not re-derive them

Taken 2026-08-04 by read-only probes against the tree at `feature/bug-fixes-22`, while four
executors held it. **Cited by grep-able symbol.** Line citations in this repository drifted three
times in one day (`19-VERIFICATION.md` W7–W9), twice inside the commits written to correct drift.

Every number below is a **starting shape, not an authority**. Phases 20, 21 and 23 land between
this file and execution. Re-measure before building on any of it — a number that agrees with a
theory is not the theory's proof.

### The corpus, counted

`typescript/unstable/sync`'s `checker.getExportsOfModule` over the eight barrels
(`packages/{core,net,node,browser,libp2p,bench,demo,aot}/src/index.ts`) returns **581 exports**:

| package | fn/class | other value | type-only |
|---|--:|--:|--:|
| core | 88 | 26 | 138 |
| net | 32 | 7 | 36 |
| node | 16 | 17 | 9 |
| browser | 25 | 12 | 38 |
| libp2p | 8 | 16 | 2 |
| bench | 11 | 3 | 18 |
| demo | 16 | 20 | 4 |
| aot | 13 | 8 | 18 |
| **total** | **209** | **109** | **263** |

**263 of 581 are type-only and have no call path by construction.** That exclusion must be
*stated and count-pinned*, because a flags predicate that silently stopped classifying would empty
the jurisdiction while the guard read green — the exact failure `disclosure-gate.node.test.ts`
already shipped once with a pattern that matched nothing.

### THE FINDING THAT DECIDES THIS PHASE: three tracers, one corpus, three answers

Three cheap approximations of criterion 1 were run over the same 209 callable barrel exports:

| tracer | unreached |
|---|--:|
| module reachability + *mention* of the name anywhere in a reachable module | **54** |
| module reachability + a *call* (`NAME(` / `new NAME(`) anywhere in a reachable module | **3** |
| function-level call graph, naive (`NAME(` only, no member expressions) | **102** |

**The answer is dominated by the tracer's design, not by the codebase.** So "passes clean" is a
number the instrument chooses unless the instrument's resolving power is itself measured. This is
the phase's central design constraint and plan 22-01 exists for it.

Two of those three are demonstrably wrong at named symbols, and the reasons are the guard's real
specification:

- The 3-answer over-reaches: `estimatePi` is *called* inside `packages/demo/src/pi.ts` by a
  function nothing calls, and `pi.ts` is a reachable module, so a module-granularity tracer scores
  it reached. **Granularity must be the function, not the module.**
- The 102-answer under-reaches: it reports `node/FabricNode` unreachable. `bin/agent.ts` reaches
  it through **`FabricNode.start(...)`** — a *static method* call, which a `(?<![.\w$])NAME\s*\(`
  detector excludes by construction. One missed edge class cascades into most of the 102.

### Four edge classes that are real in this tree and that a static tracer misses

1. **Member-expression entry.** `FabricNode.start`, `BrowserNode.start`. The production entry to
   both node tiers. Invisible to a bare `NAME(` detector.
2. **Vite worker import.** `packages/browser/src/worker-factory.ts` —
   `import TaskExecutorWorker from './task-executor.worker.ts?worker'`. A static specifier with a
   query suffix; a resolver that does not strip `?worker` drops the edge.
3. **`new URL` worker entry.** `packages/node/src/worker-thread.ts` —
   `const ENTRY = new URL('./task-executor.worker-thread.ts', import.meta.url)` then
   `new Worker(ENTRY)`. Not an import at all.
4. **Barrel re-export is not a call.** `requirements-ledger.node.test.ts` already establishes
   this: *"every statement in all eight is `export … from`, so a symbol's appearance in one says
   only that the package publishes it, never that anything calls it. Counting a barrel as a caller
   would make every exported symbol look wired and this whole file vacuous."*

`core/runTask` and `core/runTaskAndPost` are reachable **only** through classes 2 and 3 —
`packages/browser/src/task-executor.worker.ts` imports both. Adding classes 2 and 3 moved the
reachable-module count from 113 to 115. They are the two edges that carry the fabric's entire
execution path, and a tracer without them reports the kernel's task runner dead.

### The added value over `requirements-ledger.node.test.ts`, demonstrable on a real symbol

That file already asks *"does anything call X?"* and its own header states the limit: **"It reads
call syntax, not reachability."** This phase is that limit closed.

`core/delegate` is the demonstration. `requirements-ledger`'s `callSites` finds it called — three
times, from `packages/node/src/capability-fixture.ts`, which is not a `.test.ts` and therefore
sits inside that file's `PRODUCTION` corpus. A **reachability** guard finds no path: nothing on
any of the five entry points imports `capability-fixture.ts`. Two guards, one symbol, opposite
readings, and the reachability one is right. Keep both; they answer different questions.

### The TypeScript 7 API exists, works, and is unstable

`typescript@7.0.2` is pinned **exactly** (no caret) in the root `package.json`. Measured:

- `new API({cwd}).updateSnapshot({ openProjects: ['<abs>/tsconfig.json'] })` loads the whole
  project. **`openProjects` must be a bare path string** — the documented
  `DocumentIdentifier` object form returned **0 projects** in this tree, twice.
- `project.checker` carries `getSymbolAtLocation`, `getExportsOfModule`, `getAliasedSymbol`,
  `getReferencesToSymbolInFile`, `getReferencedSymbolsForNode`, `getResolvedSignature`.
- `project.program.getSourceFileNames()` returns **869** files; `getSourceFile` is ~1 ms warm.
- Cost of the whole barrel enumeration, `/usr/bin/time -p`: `real 0.21` / `user 0.07` /
  `sys 0.02`. The function-level probe: `real 0.31` / `user 0.65` / `sys 0.21`, i.e.
  `(user+sys)/real` ≈ 2.8 — the API spawns a server process, so it is genuinely parallel and
  `real` understates the CPU. **Report both, never `real` alone.**

**The pin is now load-bearing for a guard, and it was not before.** A `typescript` bump moves an
`unstable/*` entry point. Say so at the pin, not only here.

**The alternative, and why it is the fallback rather than the choice:** regex over stripped source,
the way `requirements-ledger` and `purity` work. It needs a comment stripper, and guard defect #40
records that all six strippers in this tree are blindable, three of them **fail-open**. Using the
checker sidesteps stripping entirely. If the API route fails, the fallback **must** import the
shared `packages/node/src/strip-comments.ts` that #40's fix introduces — writing a seventh regex
is forbidden.

### There is no CI, there may not be one, and criterion 3 must be read against that

**Measured: no `.github` directory exists.** `disclosure-gate.node.test.ts` asserts *"has no
`.github` directory at all, at the root or anywhere below it"* and *"no workflow file under any
`.github` path, tracked or untracked"*. `.githooks/pre-commit` states the reason in its own words:

> **WHY THIS IS A HOOK AND NOT CI.** It must stay local. … Adding CI to close this would break the
> invariant it is meant to protect. **Do not "fix" the absence of `.github/` by adding it.**

So criterion 3's *"the same CI gate as the rest of the suite"* has no referent as written. See
`<open_rulings>` 1. The honest reading is **`vitest run --project node` plus the
`.githooks/pre-commit` cheap-guard list**, and a plan may not create anything under `.github/`
under any circumstance — DEMO-04 is a permanent, irreversible legal constraint, and the US
provisional deadline is 2027-07-26.

### The cheap-guard budget is a real bound with a stated number

`.githooks/pre-commit` runs six specs in one vitest invocation and its own comment records the
budget: *"Deliberately not run here: `tsc --noEmit` (~10 s) and the full node suite (~290 s). A
hook slow enough to be resented is a hook that gets disabled with `--no-verify`, and then it
guards nothing at all. These three take about 1.5 s of test time."* (The list has since grown to
six; the sentence is stale by three and is itself a small instance of what this repository keeps
finding.)

A guard added to that list is charged to every commit by every concurrent agent. Its cost is
therefore a **comparative** measurement — the new guard against the existing list in the same
run — never an absolute, and 22-04 must state what ratio would break it.

### `MEASURED_NODE_SPANS` and `slow-specs.node.test.ts`

`vitest.config.ts` carries a per-file span table with `SLOW_CUTOFF_MS = 1000`, and
`slow-specs.node.test.ts` parses that file's source and asserts the derived exclusion list against
`NODE_MEASUREMENT.files`/`unitFiles` within a `FILE_COUNT_TOLERANCE`. A new node spec is not free:
it moves a count two files read. Reconcile it in the same plan that adds the spec, or leave a red
for somebody who did not cause it.
</findings>

<cardinal_rule>
## ALL NODES HAVE EQUAL FUNCTIONALITY. Only discovery differs.

A reachability guard is unusually prone to breaking this, and the failure is easy to miss because
it looks like bookkeeping. The temptations, named so a plan or an executor can be checked against
them:

- **An entry-point list read as a tier list.** The five entry points are **modules**, not node
  kinds. `packages/browser/demo/main.ts` is on the list on exactly the same footing as the three
  `bin/*.ts` files. A browser peer is a full peer: `browser-node.ts` listens on
  `['/p2p-circuit', '/webrtc']`, and Phase 3 dialled an iPhone at its `/p2p-circuit/webrtc`
  address and it ran half of a 2×-redundant job.
- **A per-tier disposition.** *"`browser/*` symbols are excused because the demo is small"* is a
  node-class rule with a reachability costume on. A disposition is per **symbol**, with its own
  reason.
- **A verdict keyed on which factory declares a symbol.** `FabricNode` and `BrowserNode` are two
  constructions of one thing. If a rule reads differently for them, it is wrong.

One rule keying on node kind was retracted at `0314208`. It had been implemented as
`discoverability === 'seed'`, it read as sound engineering, and it collided head-on with a
measured result. **The shape to remember: that defect turned a repair into a refusal and put the
refusal before the thing it was about.**
</cardinal_rule>

<proof_discipline>
## A proof that cannot fail is not a proof — and this guard is the worst case for it

*"Everything is reachable"* is trivially true of an instrument that never dials. Fourteen
consecutive Phase 19 executors each found an assertion in their own plan that could not fail; a
reachability guard offers four separate ways to produce a clean verdict from an instrument that is
not working:

1. the barrel enumeration returns nothing (flags predicate, API shape change, wrong tsconfig);
2. the edge builder returns no edges, so **everything** is unreachable — loud, and therefore the
   safe direction;
3. the edge builder over-connects, so **everything** is reachable — silent, and the dangerous one;
4. the corpus filter excludes the population the verdict is about.

**Therefore the instrument's own ability to fail is a separate, named proof in every plan**, and
it is not satisfied by a green run:

- **Anchors in both directions.** A known-TRUE set that must be reported reachable and a
  known-FALSE set that must be reported unreachable, both asserted, both able to redden. Candidate
  known-TRUE: `node/FabricNode` (via `FabricNode.start` in `bin/agent.ts`), `core/submitJob`,
  `net/reduceJob` (called at `bin/bench.ts`), `core/runTaskAndPost` (via the `?worker` edge),
  `aot/translationCid` (via `tools/aot/lift.ts`, landed by 21-01). Candidate known-FALSE:
  `core/delegate` (three callers, all inside `capability-fixture.ts`, which no entry point
  imports). **Re-measure each before relying on it** — 20, 21 and 23 move them.
- **Floors, not equalities**, on corpus size — `purity`'s and `acceptance-traceability`'s pattern.
  A floor catches a collapse; an equality freezes a count that legitimately grows.
- **A resolving-power reading**, comparative and inside one run: the same corpus scored at module
  granularity and at function granularity. If the two agree, the tracer is not tracing functions
  and the phase has built the 3-answer while believing it built the other. **State what value
  would break it.**
- **Planted mutations, watched.** Plant, watch it redden, record the observed text, restore by
  `cp` + `cmp`. A green you did not watch fail is worse than a gap you reported.
</proof_discipline>

<decisions>
## Implementation Decisions

### Four plans, four waves, and why nothing here parallelises

This phase builds one instrument in layers, so its plans serialize on the artifact rather than on
the file list.

- **22-01 — the tracer, and proof it can fail.** The corpus, the edge classes, the anchors, the
  resolving-power reading. Nothing is asserted about the tree's health.
- **22-02 — the guard.** The verdict, the naming (criterion 2's *"the unreachable symbol and the
  barrel it came from"*), and the two required plants.
- **22-03 — the reading.** Criterion 1 taken against the tree as it then stands, and a disposition
  per unreachable symbol with an anti-vacuity floor.
- **22-04 — the gate.** Criterion 3, the comparative cost, the `slow-specs` reconciliation, and
  the mutation-ledger entries.

**22-04 may not run before 22-03 is green.** Arming a red guard in `.githooks/pre-commit` is a
repo-wide commit outage for every concurrent agent — guard defect #39's exact shape, which already
cost seven stated `O2_SKIP_GUARDS=1` commits. That ordering is behavioural, so it is written as a
`# WAVE NOTE` in both plans as well as in `depends_on`.

### Granularity is the function, not the module — and the disposition is per symbol

Settled by the three-tracer finding above. A verdict is *"is there a path from an entry point's
top-level code, through called functions, to this declaration"*. `estimatePi` is the case that
decides it.

### Where the guard lives

`packages/node/src/` — it needs `node:fs` and the TypeScript API, and `purity.node.test.ts`
forbids `node:` in `core`, `net`, `bench`, `demo` and `aot`. Splitting a pure predicate out of the
I/O, the way `mutation-ledger.ts` splits `problemsWith` and `purity.node.test.ts` splits
`violationsIn`, is **not** discretionary: it is the only way a planted input can be handed to the
instrument directly, and every assertion here has the shape "this list is empty".

### The disposition register, not an allow-list

Criterion 1 says *passes clean*. The reading in 22-03 will not be clean without a register of
stated dispositions, and a register is exactly how a guard becomes decoration. The defences, all
of them copied from patterns this repository already runs:

- **A disposition is per symbol and carries a reason**, in the shape `mutation-ledger.ts` uses for
  its entries — data, not prose in a comment.
- **An anti-vacuity floor**, and the floor is itself a known failure: 19-12 found the mutation
  ledger's floor stale at 23 while the ledger held 42. Whatever floor is chosen, something must
  redden when the register grows past it.
- **A disposition that stops describing the tree is a defect.** If a symbol in the register
  becomes reachable, the register must go red — the mirror of `mutation-guard.node.test.ts`'s
  cheap layer asking whether each entry still *describes* the source.
- **`WITHOUT_A_CHECKABLE_CLAIM` is the precedent** — `requirements-ledger.node.test.ts` already
  carries a named exemption list rather than a silent filter. Follow it.

### What counts as an entry point, stated and pinned

The five from `v1.0-MILESTONE-AUDIT.md`: `packages/node/src/bin/agent.ts`, `bin/seed.ts`,
`bin/bench.ts`, `tools/aot/cli.ts`, and `packages/browser/demo/index.html` → `demo/main.ts`.

**Measured: the list is defensible today and it is not complete as a statement about what runs.**
Three further modules are runnable and are not on it —
`packages/node/src/mutation-guard.mutate.ts` (`npm run test:mutations`),
`tools/aot/bench-lifted.ts`, `tools/aot/measure-wasi.ts`. Adding all three gains **4 modules and
zero exclusive callable barrel exports**, so no verdict changes today. Pin that reading, so the
five-entry-point list stops being defensible *silently*. `index.html` also carries an inline
`<script type="module">` which reads `window.o2` and imports no barrel symbol; `policy.html`
imports nothing. Say both, rather than leaving a reader to wonder.

### Comparative readings, and citation by symbol

Standing rules (`CLAUDE.md` § Measurement), both biting here.

- Every timing bound in this phase is **comparative**: the guard against the existing cheap-guard
  list in the same run, or the same corpus under two granularities in the same run. Absolutes
  encode the machine, the load and the I/O weather. Where one is unavoidable, say what it was
  sited against, and **state what value would break it**.
- `/usr/bin/time -p` and `(user+sys)/real`. Never load average — this host has shown load 33 while
  a CPU-bound process held 95% of a core.
- **Cite by grep-able symbol, never by line number.**
</decisions>

<unscored_work>
## Work the requirements ledger routes here that NO criterion scores — surfaced, not planned

**Five rows in `.planning/REQUIREMENTS.md` — MR-03, MR-04, MR-05, MR-06, MR-07 — each end with:**

> *"The demo still merges with a linear scan: `answerOf` in `packages/demo/src/job.ts`, called from
> `packages/browser/demo/main.ts`. That half is WIRE-02, Phase 22"*

and the in-scope table's Phase-5 row says the same: *"the demo replacement is WIRE-02, Phase 22"*.

**None of Phase 22's three criteria scores that work.** This is the CHURN-03 situation from Phase
20 exactly — work a `Requirements:` line claims and no criterion measures, so a verifier will not
score it and it becomes "built, not wired" reappearing in the ledger instead of the code. The
owner ruled in that case: *add a criterion*.

**It is also, measurably, not a reachability defect.** `answerOf` is reachable — `demo/main.ts`
calls it. `executeReduce` is reachable too, through `reduceJob` from `bin/bench.ts`. So the guard
this phase builds will find nothing wrong with either, and replacing the demo's linear scan would
be an unrelated wiring job carried in on a routing note. See `<open_rulings>` 2.

**No plan in this phase implements it.** Planning unscored work silently is the thing this
section exists to prevent.
</unscored_work>

<known_and_accepted>
## Known open weaknesses — do NOT re-discover these as new

Read `.planning/.continue-here.md` for the full list. The ones that touch this phase:

- **`PeerVerifier` fails open and no `FabricNode` in the tree pins an anchor**; the relay
  authenticates nothing; every certificate check is *selection*, not *admission*. That is Phase
  24's job, it is **planned and scheduled after this phase**, and the owner already knows. See
  `<open_rulings>` 3 for the ordering question this raises.
- **Guard defects #39 and #40 are open and being fixed separately** (`.planning/GUARD-DEFECTS-39-40.md`).
  **No plan here works on them.** But if any plan here scans source text, it must import the
  shared `packages/node/src/strip-comments.ts` that #40's fix introduces rather than writing a
  seventh regex — three of the six existing strippers fail **open**.
- **`@libp2p/webrtc` can leave two tabs disagreeing about a connection** (defect 32, one session,
  two irreconcilable views). Not this phase's, and nothing here should touch it.
- **`admit:` at `bin/bench.ts` can be deleted with the whole suite green**, and it is the sole
  production caller behind SCHED-02's runnable-entry-point claim. This phase's guard is the
  natural thing to notice that; it is a *finding to report*, not a wire to add here.
</known_and_accepted>

<specifics>
## Claude's Discretion

- Whether the tracer sits behind `typescript/unstable/sync`'s checker or behind a source scan,
  provided the choice is **measured** rather than assumed and the fallback imports the shared
  stripper.
- The module and file names, provided the pure predicate is separable from the I/O and can be
  handed a planted input.
- The exact anchor sets, provided each is re-measured at execution time and each can redden.
- The shape of the disposition register, provided it is data with an anti-vacuity floor and a
  disposition that stops describing the tree turns red.
- Whether the guard joins `.githooks/pre-commit`'s list or runs only under `--project node`,
  provided the decision rests on the comparative cost reading and the reason is written at the
  hook.

## Not this phase's

- Wiring an unreachable symbol. This phase finds and names; it does not fix.
- The demo's linear scan — see `<unscored_work>`.
- Guard defects #39 and #40.
- Anything under `.github/`. **DEMO-04 is absolute.** If a plan finds itself wanting a workflow
  file, that is a finding to report, not a path to plan around.
- Phase 24's admission gate.
</specifics>

<open_rulings>
## Needs an owner ruling, not an implementation choice

1. **Criterion 3 names a "CI gate" this repository does not have and may not have.** Measured: no
   `.github` directory exists at any depth, `disclosure-gate.node.test.ts` asserts its absence
   tracked *and* untracked, and `.githooks/pre-commit` says in its own words *"Do not 'fix' the
   absence of `.github/` by adding it."* The honest reading is that the gate is
   `vitest run --project node` plus the pre-commit cheap-guard list. **The criterion is not
   rewritten here.** Either it is read against those two gates and scored MET, or it is read
   literally and scored PARTIAL for as long as the disclosure constraint stands. RULING A applies:
   a criterion is not rewritten to let a phase close.

2. **MR-03…MR-07 route the demo's linear-scan replacement to WIRE-02 / Phase 22, and no criterion
   here scores it.** Add a criterion 4, or defer the demo half explicitly with the five rows left
   honest. Phase 20's CHURN-03 is the precedent and the owner ruled *"add criterions"* there. The
   difference worth weighing: CHURN-03's work was in-phase and unscored, whereas this work is not
   a reachability defect at all and would be an unrelated wiring job carried in on a routing note.

3. **Does Phase 22 run before or after Phase 23?** The ROADMAP's own Phase 22 entry says
   *"criterion 1 above should find `delegate` reachable by the time this phase runs; if it does
   not, Phase 23 did not finish its job and that is the finding"* — but the execution order line
   reads `… → 21 → 22`, and Phase 23 is listed after the Progress table with 5 plans and 0
   executed. **Measured today: `delegate` is called only from `packages/node/src/capability-fixture.ts`,
   which no entry point imports.** So on the current order, criterion 1 cannot pass clean on
   `delegate`, and the roadmap's own sentence predicts the opposite. Either 23 runs first, or
   `delegate` enters 22-03's disposition register with Phase 23 named as its owner.

4. **`24-CONTEXT.md` open ruling 2 asks the mirror question** — *"Should Phase 24 run before or
   after Phase 22? A reachability guard that runs before admission is gated passes over a fabric
   with an open door."* Recorded here so the two questions are answered together rather than
   separately with different answers.
</open_rulings>

<deferred>
## Deferred Ideas

- **Extending the guard to non-barrel exports.** The criterion says *"exported from a package
  barrel"*, and that is 581 symbols. Every `export` in `packages/*/src` is a much larger corpus
  (`requirements-ledger`'s `EXPORTED` held 435 by a narrower regex) and a different claim.
- **Extending it to type-only exports.** They have no call path by construction; an unused *type*
  is a different defect with a different remedy.
- **Making the guard report an unreachable symbol's nearest reachable caller.** Useful, and it is
  a debugging affordance rather than part of any criterion.
- **Retiring `requirements-ledger.node.test.ts`'s call-syntax check** now that a reachability
  check exists. They answer different questions and `delegate` is the proof; keep both.
- **Adding the three unnamed runnable modules to the entry-point set.** Measured to change no
  verdict today. Pin the reading; do not change the set on this phase's authority.
</deferred>
