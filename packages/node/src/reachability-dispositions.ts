/**
 * The disposition register — Plan 22-03.
 *
 * ## What a disposition is, and what it is not
 *
 * It is **not an allow-list**. An allow-list says *"ignore this"*; a disposition says *why* the
 * guard cannot reach a symbol, names who owns closing it, and **goes red when it stops being
 * true**. `requirements-ledger.node.test.ts`'s `WITHOUT_A_CHECKABLE_CLAIM` is the precedent — a
 * named exemption rather than a silent filter — and the defences here are the ones
 * `22-CONTEXT.md` § *The disposition register, not an allow-list* asks for:
 *
 * - one entry per symbol, carrying a reason, as **data rather than prose in a comment**;
 * - a **stale entry is a defect**: if a disposed symbol becomes reachable, the guard reddens
 *   rather than letting the entry sit unnoticed;
 * - an entry naming a symbol that is no longer a callable barrel export also reddens;
 * - the register **cannot grow silently** — it carries a ceiling, and the undisposed residue
 *   carries a per-symbol register of its own: see the note where `OPEN_FINDING_CEILING` used
 *   to stand, below.
 *
 * ## Two registers, and the second one is WIRE-02's — added 2026-08-14
 *
 * {@link DISPOSITIONS} says *why the guard cannot reach a symbol that production does reach*.
 * `OPEN_FINDINGS`, in `reachability-guard.node.test.ts`, says the opposite thing about a
 * disjoint population: those have **no call path at all**, they are named one by one, and the
 * guard requires set equality against the walk. Between them the two registers account for
 * **every** unreachable callable barrel export by name, which is what WIRE-02's row asks for
 * and what a ceiling could never give. Why the second one is not in this file is measured, not
 * stylistic — see the note below.
 *
 * ## The criterion this register is written under
 *
 * *"No disposition is granted on the basis of which tier or which factory a symbol belongs to."*
 * Both causes below are **mechanisms**, not tiers. `global-object-hop` is granted to symbols in
 * `@o2/browser`, `@o2/demo` and `@o2/net` alike, because what they share is how they are reached
 * and not where they live — and the spec asserts that spread rather than trusting this sentence.
 * A rule that read differently for `FabricNode` and `BrowserNode` was written once in this
 * repository and retracted at `0314208`.
 *
 * ## Owner decisions taken 2026-08-08, recorded here rather than inferred
 *
 * 1. **The entry-point set stays at five.** `tools/aot/bench-lifted.ts` rescues four `@o2/aot`
 *    symbols and is nonetheless *not* an entry point — it is a benchmark driver, not a way the
 *    fabric is entered. Those four are disposed under {@link BENCHMARK_DRIVER_ONLY} with the
 *    driver named.
 * 2. **Only symbols with a stated cause are disposed.** Everything else stays an **open
 *    finding**. That is why `OPEN_FINDINGS` exists and is large: criterion 1 does
 *    **not** pass clean on this tree, and this file does not pretend otherwise. **Thirty-seven**
 *    callable barrel exports have no production caller at all (re-derived 2026-08-10; it read
 *    *"forty-seven"* until the `global-object-hop` class was measured rather than listed), in a
 *    milestone named *"Wire What Was Built"*, and that number is the honest reading rather than
 *    something to dispose away.
 */

/** Why the guard cannot reach a symbol. A mechanism, never a tier. */
export type DispositionCause =
  | 'global-object-hop'
  | 'benchmark-driver-only'
  | 'deferred-in-source'
  | 'port-member-dispatch'
  | 'proxy-trap-dispatch'

/** One disposed symbol. */
export interface Disposition {
  /** The barrel that publishes it. */
  readonly barrel: string
  /** The exported name. */
  readonly symbol: string
  /** The mechanism that puts it out of the tracer's reach. */
  readonly cause: DispositionCause
  /** Who owns closing it, and what closing it would mean. */
  readonly owner: string
}

/**
 * Reached only across a global-object hop the tracer cannot follow.
 *
 * `packages/browser/demo/main.ts` assigns an object literal to `window.o2`, and
 * `packages/browser/demo/index.html` invokes its methods from an inline `<script type="module">`.
 * Every symbol below has a **real production caller** inside one of those object-literal methods;
 * none has a traced path, because no static graph crosses an assignment to a global followed by an
 * invocation from HTML.
 *
 * Ten of them sit one or more hops further, behind another member of this same list — the chain
 * is named rather than flattened, so a change in the middle of it is visible. `IdbBlockstore`,
 * `VisibilityGovernor` and `browserWorkerExecutor` sit behind `BrowserNode`; `domThread` sits two
 * hops out, behind `browserWorkerExecutor`; `GrantedConsent` behind `readConsent`/`grantConsent`;
 * `browserLabel` and `identifyBrowser` behind `currentBrowserLabel`; `colourOf` behind
 * `verifyColouring`; `readPiPartial` behind `projectPiPartial`; and `startReportFromCounts` behind
 * `start-outcome.ts`'s own `report`, whose reachable caller is `main.ts#startReport`.
 *
 * **Closing this class means making the entry real**, not excusing it: extract the inline script
 * into a module the tracer can root on, or teach the graph the `window.o2` assignment. Until then
 * these are a fact about static tracing, and the guard's own header says so.
 *
 * ## Grown 16 → 26, measured 2026-08-10 — and the list was never derived until now
 *
 * The v1.1 milestone audit's `G14` reported that **four** π symbols (`demo/buildPiInput`,
 * `demo/estimatePi`, `demo/piErrorBound`, `demo/projectPiPartial`) sit in the open findings while
 * being called from `main.ts#runPi`, a method of the `window.o2` literal, exactly as `answerOf` is
 * from `runColouring`. That was true and it was **under-counted, because it was found by reading
 * rather than by measuring** — and this list had the same provenance, which is why the gap existed
 * at all: sixteen symbols somebody noticed, in a class nobody had ever enumerated.
 *
 * **Derived, this time.** The register's own stated closing condition — *"teach the graph the
 * `window.o2` assignment"* — is executable, so it was executed: every declaration in
 * `packages/browser/demo/main.ts` was given an edge from a root, and `unreachableExports` was run
 * before and after. **Exactly 26 symbols flip from unreachable to reachable**, and the 16 already
 * here are a strict subset of them. The other 10 — `browser/GrantedConsent`,
 * `browser/browserLabel`, `browser/identifyBrowser`, `core/startReportFromCounts`,
 * `demo/buildPiInput`, `demo/colourOf`, `demo/estimatePi`, `demo/piErrorBound`,
 * `demo/projectPiPartial`, `demo/readPiPartial` — were sitting in the open findings. The other 10
 * dispositions (4 `benchmark-driver-only`, 6 `deferred-in-source`) do **not** flip, which is the
 * cross-check that the plant separates this class rather than merely reaching more of the tree.
 *
 * **Every terminus was then read individually rather than taken from the plant**, because a plant
 * that roots all of `main.ts` would also rescue a symbol reached only from dead code in that file.
 * Each of the ten walks back to a member of the `api` literal at `main.ts:449`, assigned to
 * `window.o2` at `:1279`: `runPi` (:774), `verifyAnswer` (:983), `startReport` (:680),
 * `grantConsent` (:465), `consentState` (:461), `revokeConsent` (:473), `start` (:483),
 * `discoverRelays` (:592), `autoStart` (:644).
 *
 * **This paragraph said "two of the ten" and the measured answer is six — FIXED 2026-08-11.**
 * `unreachableExports` filtered same-file callers out of the list it reported, so a symbol whose
 * every caller sits in its own file rendered as *"no production code calls it"*. The count was
 * never measured when it was written; running the repaired guard over the same ten gives
 * `browser/browserLabel` (1), `browser/GrantedConsent` (2), `browser/identifyBrowser` (1),
 * `core/startReportFromCounts` (2), `demo/colourOf` (1) and `demo/readPiPartial` (1) — **all six
 * of the non-hop dispositions, each with zero cross-file callers**, which is why every one of
 * them read empty. The filter is gone (`reachability.ts:916`) and the case that proves it is
 * `reachability-guard.node.test.ts`'s one-edge plant, watched red first.
 *
 * **The caveat it raised has been discharged, not inherited**: an empty caller list now means
 * what it says. The chains above were still walked over the raw graph rather than the verdict,
 * and that remains the right method — but it is no longer forced by a defect.
 *
 * **The list is no longer trusted to be complete**: `reachability-guard.node.test.ts` re-derives
 * it on every run and reddens in both directions — an undisposed symbol that flips, and a
 * `global-object-hop` entry that does not.
 *
 * ## Grown 26 → 27, 2026-08-13 — and the guard named the entrant, nobody read it off
 *
 * `core/describeStartReport` joined when `reachability.ts` learned to resolve a name destructured
 * from `await import(…)`. It is worth stating what changed and what did not. Its production caller
 * — `main.ts#startReport`, a member of the `window.o2` literal — was there all along, but the
 * graph had **no edge into the symbol at all**: `const { describeStartReport } = await
 * import('@o2/core')` binds a local `BindingElement`, and the call below it landed on a node id
 * inside `main.ts` that nothing declares. So this symbol was invisible to the closing condition
 * this very docblock states: teaching the graph the `window.o2` assignment would not have rescued
 * it, because an in-degree of zero does not care what is rooted. It was a **third mechanism**
 * hiding a member of this class, and it read as *"no production code calls it"* in the open
 * findings for as long as it existed.
 *
 * **Not read off the source — the derived case above failed and named it**, verbatim: *"these
 * become reachable the moment the window.o2 assignment is traced … expected
 * `[ 'core/describeStartReport' ]` to deeply equal `[]`"*. That is the G14 defence working the
 * way it was built to: the class was re-derived, the register disagreed, and the register was
 * wrong.
 */
const GLOBAL_OBJECT_HOP: readonly string[] = [
  'browser/BrowserNode',
  'browser/GrantedConsent',
  'browser/IdbBlockstore',
  'browser/VisibilityGovernor',
  'browser/browserLabel',
  'browser/browserWorkerExecutor',
  'browser/classifyStartError',
  'browser/currentBrowserLabel',
  'browser/domThread',
  // AUTH-02, 2026-08-14. Called from `main.ts#start` — a member of the same `api` literal as
  // `classifyStartError`, `firstGap` and `probeEnvironment` three lines either side of it, and
  // hidden by the same `window.o2` assignment. Not read off the source: the derived case named
  // it verbatim, *"expected [ 'browser/enrolledIssuer' ] to deeply equal []"*, which is the
  // G14 defence doing its job for the second recorded time.
  'browser/enrolledIssuer',
  'browser/firstGap',
  'browser/grantConsent',
  'browser/identifyBrowser',
  'browser/probeEnvironment',
  'browser/readConsent',
  'browser/revokeConsent',
  // CHURN-03, 2026-08-16. `main.ts#runColouring` — a member of the same `api` literal as
  // `runPi` and `verifyAnswer` — passes `checkpointsInto(node.store)` as `SubmitOptions.checkpoints`,
  // which is what closes criterion 7's write half. It is hidden by the same `window.o2`
  // assignment as everything else on this list and by nothing else: there is one caller, it is
  // cross-file, and it is in the literal. Not read off the source — the derived case named it
  // verbatim, *"expected [ 'core/checkpointsInto' ] to deeply equal []"*, which is the G14
  // defence doing its job for the third recorded time.
  'core/checkpointsInto',
  'core/describeStartReport',
  'core/startReportFromCounts',
  'demo/answerOf',
  'demo/buildPiInput',
  // The primes trio, added 2026-08-17 when `TabApi.runPrimes` gave the workload a caller and
  // closed audit finding G4's primes half. **Exactly the same mechanism as the pi entries above
  // and the same reclassification G14 was raised about**: nothing here became unreachable or
  // reachable by accident — `demo/main.ts`'s `runPrimes` calls all three, and they read as
  // unwired only because the `api` literal is reached through the `window.o2` hop the walk
  // cannot see. Not read off the source: the derived case named all three verbatim,
  // *"expected [ 'demo/buildPrimesInput', 'demo/projectPrimeCount', 'demo/readPrimeCount' ] to
  // deeply equal []"*, which is the G14 defence doing its job for the fourth recorded time.
  //
  // `readPrimeCount` has no direct call in `main.ts` and belongs here anyway: `projectPrimeCount`
  // calls it, so it is reachable through the same hop one edge further along.
  'demo/buildPrimesInput',
  'demo/colourOf',
  'demo/estimatePi',
  'demo/piErrorBound',
  'demo/projectPiPartial',
  'demo/projectPrimeCount',
  'demo/readPiPartial',
  'demo/readPrimeCount',
  'demo/verifyColouring',
  'net/findReservedPeers',
  'net/publishStartOutcome',
]

/**
 * Called only from `tools/aot/bench-lifted.ts`, which the owner ruled on 2026-08-08 is **not** an
 * entry point.
 *
 * `22-CONTEXT.md` pinned the five-module entry set on the reading that the three
 * runnable-but-unnamed modules rescue *zero* symbols, and instructed that when that stopped being
 * true the set becomes an owner question. It stopped being true — these four are the difference —
 * and the question was put and answered: the set stays at five, and these carry a stated reason
 * instead. Adding `bench-lifted.ts` as a root would close them, and that is the decision that was
 * declined rather than a gap that was missed.
 *
 * ## This cause is measurably INCOMPLETE as of 2026-08-13, and it is flagged rather than rewritten
 *
 * Rooting `packages/aot/src/wasi-executor.ts#execute` alone flips **five** `@o2/aot` symbols:
 * `aot/describeWasiFailure`, disposed under {@link HIDDEN_BY_DISPATCH}, and all four below.
 * Reading the source confirms the measurement — `shardArgv` at `wasi-executor.ts:818`, and
 * `pinnedWasiImports`, `seededStream` and `taskSeed` at `:825`, all inside `run`, which `execute`
 * calls at `:751` — and `WasiExecutor` is constructed in production at `fabric-node.ts:2248` and
 * `browser-node.ts:1426`.
 *
 * So *"called only from `tools/aot/bench-lifted.ts`"* is **not true**: these four have a second
 * caller, on the production dispatch path, hidden by the port-member mechanism. They are left on
 * this cause on purpose. The owner ruling they record is about the **entry-point set**, which
 * nothing in this repair touches, and re-causing four symbols is a decision to *put* rather than
 * to take in passing. What is not left alone is the sentence: it is corrected here, with the
 * measurement beside it, so the next reader is not misled by a cause that has stopped describing
 * the tree.
 */
const BENCHMARK_DRIVER_ONLY: readonly string[] = [
  'aot/pinnedWasiImports',
  'aot/seededStream',
  'aot/shardArgv',
  'aot/taskSeed',
]

/**
 * Not wired **because the source that would wire it says not to, in writing**.
 *
 * These are the ones the v1.1 audit reported as unwired and that turned out, on reading, to be
 * deliberate deferrals with a stated reason and a stated remedy. A guard that reports a
 * documented decision as a defect trains its reader to ignore it, so each carries the sentence
 * that defers it — and if that sentence is ever deleted or reversed, the entry stops describing
 * the tree and the register goes red.
 *
 * - `net/EgressRefusal` — `packages/net/src/churn.ts` states that an `EgressRefusal` on this
 *   node's own outbound request arrives as `send-failed` and classifies `'node'`, *"and it is
 *   stated here deliberately rather than left to be inferred. If a later phase decides an egress
 *   refusal deserves `'sender'`, it makes `EgressRefusal` carry the `SendRefused` marker; it does
 *   not widen this branch back onto `send-failed`."* Catching it by name is the change that
 *   comment declines.
 * - `net/checkBlockstoreConformance` — it fails any store whose `size !== 0`, so it **cannot**
 *   run at construction on a node that already holds blocks. It is a conformance harness over a
 *   fresh store by construction, not a runtime check, and wiring it into a factory would refuse
 *   every restart.
 * - `bench/sweepNodeCount` — `packages/bench/src/index.ts` says of it, in its own words, that it
 *   *"is a separate question and is not settled here"*. `bin/bench.ts` writes its own ladder
 *   because it varies redundancy per rung, which this signature cannot express.
 * - `net/remoteDispatch` — carries NET-09's `'sender'` classification, which is the same deferral
 *   as `EgressRefusal` seen from the other end.
 */
const DEFERRED_IN_SOURCE: readonly string[] = [
  'bench/sweepNodeCount',
  // Audit finding G7, owner decision 2026-08-08. `discovery.ts`'s docblock now carries the
  // whole argument: a fallback chain needs a genuine second source, and an empty
  // `MemoryRecordIndex` in front of the RPC index would compose the types and demonstrate
  // nothing, because a first link that is always empty always falls through. Composed on
  // those terms the finding would go green and NET-06 would be no truer, so it stays open
  // and says so. **Disposed on the source's stated deferral, not on the finding being tiresome.**
  'core/FallbackRecordIndex',
  'core/MemoryRecordIndex',
  'net/EgressRefusal',
  'net/checkBlockstoreConformance',
  'net/remoteDispatch',
]

/**
 * Reached only from a member **nothing in the tree ever names** — a port implementation invoked
 * through its interface, or a `Proxy` handler invoked by the engine.
 *
 * ## Why this is a disposition and not a graph edge
 *
 * `attestResults` returns `{ nodeId, execute }` and `signResult` is called inside that `execute`.
 * `attestResults` is **reached** — `fabric-node.ts:2319` and `browser-node.ts:1504` compose it on
 * every node — and yet `attesting-executor.ts#execute` has an in-degree of **zero**, because every
 * caller in the repository writes `executor.execute(task)` against the `Executor` port and the
 * member edge lands on `packages/core/src/ports.ts#execute`. The interface member is reached; the
 * implementation is not; and the checker cannot say which object is behind the reference, because
 * that is a run-time fact.
 *
 * **Three graph edges were considered and each is over-connection**, which is why this is a
 * register entry instead:
 *
 * 1. *"A member call on an interface member reaches every implementation of that member."* Every
 *    `execute` in the tree becomes reached from any `.execute()` call anywhere — thirteen
 *    implementations off one call site, whether or not anything composes them.
 * 2. *"An object-literal method is reached when the declaration that evaluates the literal is."*
 *    Measured, and it fails on the anchor: `demo/main.ts` writes `const api = { … }` at **module
 *    scope**, so the evaluator is `main.ts#<module>`, which is a root. `demo/estimatePi` would
 *    read reachable, `reachability-guard.node.test.ts`'s over-connection anchor would go green
 *    when it must stay red, and all twenty-seven {@link GLOBAL_OBJECT_HOP} entries would have to
 *    be deleted. Restricting the rule to a non-module evaluator saves the anchor and is not a
 *    principle — it is a rule shaped to preserve a canary, which is how a guard stops guarding.
 * 3. *"Root every declaration with no in-edges."* **Measured 2026-08-13: 71 of the 71 findings
 *    flip.** The plant separates nothing, which is also why this class is **not derived** the way
 *    `global-object-hop` is — no plant distinguishes it from the hop class or from genuinely dead
 *    code. That is a real weakness of this register and it is written here rather than left to be
 *    discovered: *this list is assembled by reading, and reading is what `G14` showed to be
 *    incomplete.*
 *
 * ## What IS checked, per entry, rather than asserted
 *
 * Each row names the member the symbol is reached through, and
 * `reachability-guard.node.test.ts` requires all three legs of the mechanism to hold on the real
 * graph: the member exists and has **zero in-edges** (nothing names it), the interface member it
 * implements is **reached** (the port really is dispatched in production), and rooting *that one
 * member* makes *this one symbol* flip from unreachable to reachable. An entry whose mechanism
 * stops describing the tree reddens, which is the whole contract of this file.
 *
 * `composedAt` is the production site where the object carrying the member is built. It is prose
 * and it is cited, so a reader can check the claim that the symbol runs at all.
 */
export interface HiddenCaller {
  /** `barrel/symbol`, the form the guard's verdict list uses. */
  readonly key: string
  /** The declaration node that calls it, which no call expression in the tree names. */
  readonly through: string
  readonly cause: 'port-member-dispatch' | 'proxy-trap-dispatch'
  /** Where the object carrying {@link through} is composed in production. */
  readonly composedAt: string
}

export const HIDDEN_BY_DISPATCH: readonly HiddenCaller[] = [
  {
    // `attesting-executor.ts:116`, inside the executor `attestResults` returns at `:85`.
    key: 'core/signResult',
    through: 'packages/core/src/executor/attesting-executor.ts#execute',
    cause: 'port-member-dispatch',
    composedAt: 'fabric-node.ts:2319, browser-node.ts:1504 — `attestResults(executor, attestor)`',
  },
  {
    // `module-provenance.ts:133`, inside `const refuse = …` at `:129`, called from the executor
    // `guardModuleProvenance` returns. Two hops, both inside the unnamed member.
    key: 'core/describeModuleRefusal',
    through: 'packages/core/src/executor/module-provenance.ts#execute',
    cause: 'port-member-dispatch',
    composedAt:
      'fabric-node.ts:2183, browser-node.ts:1195, bin/bench.ts:545 — `guardModuleProvenance(inner, …)`',
  },
  {
    // `wasi-executor.ts:752`, inside `WasiExecutor#execute`. A class member rather than an object
    // literal's, and it makes no difference: the call site still writes the port.
    key: 'aot/describeWasiFailure',
    through: 'packages/aot/src/wasi-executor.ts#execute',
    cause: 'port-member-dispatch',
    // Written descriptively rather than as the constructor call it is, because
    // `trust-anchors.node.test.ts` counts every construction of this class in the tree and a
    // citation is not a construction — the same reason `packages/core/src/index.ts` names two
    // departed exports by description instead of by identifier.
    composedAt: 'fabric-node.ts:2248, browser-node.ts:1426 — the WASI executor is built there',
  },
  {
    // `transport/memory.ts:87` and `:88`, inside `route`, whose only caller is
    // `MemoryTransport#send` — the `Transport` port's member. `bin/bench.ts` IS an entry point, so
    // this one is on a real published driver's dispatch path and not a test fixture's.
    key: 'core/TransportError',
    through: 'packages/core/src/transport/memory.ts#send',
    cause: 'port-member-dispatch',
    composedAt: 'bin/bench.ts:779 — `new MemoryNetwork()`, then `connect(nodeId)` per peer',
  },
  {
    // `reservation-watch.ts:178`, inside `const observe = …`, whose callers are the `apply` and
    // `get` traps of the `Proxy` that `get logger()` returns. **A different mechanism from the
    // four above and it is not a variant of them**: there is no call expression anywhere, in this
    // repository or in libp2p, that names these members — the JavaScript engine invokes them. The
    // graph would have to model the `Proxy` meta-protocol to see it, and it does not.
    key: 'node/classifyReservationFailure',
    through: 'packages/node/src/reservation-watch.ts#get',
    cause: 'proxy-trap-dispatch',
    composedAt:
      'bin/agent.ts:812 — `new ReservationWatcher()`, handed to libp2p at fabric-node.ts:1823',
  },
]

/** The register: one entry per symbol, with its cause and its owner. */
export const DISPOSITIONS: readonly Disposition[] = [
  ...GLOBAL_OBJECT_HOP.map((entry) => ({
    barrel: entry.split('/')[0] ?? '',
    symbol: entry.split('/')[1] ?? '',
    cause: 'global-object-hop' as const,
    owner: 'demo entry: extract index.html\'s inline script, or teach the graph window.o2',
  })),
  ...BENCHMARK_DRIVER_ONLY.map((entry) => ({
    barrel: entry.split('/')[0] ?? '',
    symbol: entry.split('/')[1] ?? '',
    cause: 'benchmark-driver-only' as const,
    owner: 'owner ruled 2026-08-08 that tools/aot/bench-lifted.ts is not an entry point',
  })),
  ...DEFERRED_IN_SOURCE.map((entry) => ({
    barrel: entry.split('/')[0] ?? '',
    symbol: entry.split('/')[1] ?? '',
    cause: 'deferred-in-source' as const,
    owner: 'the module that would wire it states why it does not; reversing that is a phase decision',
  })),
  ...HIDDEN_BY_DISPATCH.map((entry) => ({
    barrel: entry.key.split('/')[0] ?? '',
    symbol: entry.key.split('/')[1] ?? '',
    cause: entry.cause,
    owner: `reached through ${entry.through}, composed at ${entry.composedAt}`,
  })),
]

// ---------------------------------------------------------------------------
// The other register — WIRE-02's, and it is NOT here. Read this before looking for it.
// ---------------------------------------------------------------------------
//
// `OPEN_FINDING_CEILING` stood on this line until 2026-08-14: a bound, `open.length <= 24`,
// green about twenty-four unwired capabilities without naming one of them and **equally green
// about any other twenty-four**. The owner replaced it with a per-symbol register — a ceiling
// permits any new unreachable export up to N, a named register permits only the ones somebody
// wrote down — and that register, `OPEN_FINDINGS`, together with the whole movement history
// this constant carried, now lives in `reachability-guard.node.test.ts`.
//
// **It lives in the spec rather than beside `DISPOSITIONS`, and the reason was measured twice
// on the day of the move rather than argued.** A register has to spell the symbol names it
// registers, and this module is production source under `packages/`, which four guards scan
// for exactly those names:
//
//  1. `requirements-ledger.node.test.ts` counts `NAME(` over comment-stripped production
//     source as a call site. Quoting `ed25519-backend.ts`'s own sentence about `initEd25519`
//     — with the empty argument list the original writes — put the call form in a **string
//     literal**, which the comment stripper leaves standing, and CRYPTO-01 reddened with
//     *"initEd25519 is called by packages/node/src/reachability-dispositions.ts"*. A citation
//     read as a caller.
//  2. `demo-primes.e2e.test.ts` greps `packages/` and `tools/` for the five symbols that are
//     G4's open half and reddens on any file outside the module and the barrel that names one
//     **on a code line**. Three of the register's rows are those symbols, and a `key:` line is
//     a code line. **That guard is correct and must not be widened**: its own words are *"a
//     third entry here is Option A having landed"*, so admitting a citation would destroy the
//     sentence that makes it worth having. The three are named in the spec's own docblock,
//     which that grep excludes; naming them again here would re-trip it, so this note does not.
//
// Both scans exclude `*.test.ts` by construction, because test files are where symbol names get
// spelled. `ACCEPTED_SIGNATURE_COMPARISONS` lives inside `one-crypto-implementation.node.test.ts`
// for the same reason, and it is the register whose both-directions shape this one copies.
//
// `DISPOSITIONS` stays here: it is imported by the spec and by nothing else either, but no
// guard in this tree watches the symbols it happens to name. That is luck rather than design,
// and it is written down so the next register does not have to rediscover it.

/**
 * How large the register may grow before something reddens.
 *
 * The anti-vacuity device, and the floor's failure mode is itself on record: 19-12 found the
 * mutation ledger's floor stale at 23 while the ledger held 42, and nothing said so.
 *
 * **Raised 26 → 36, 2026-08-10, and the sentence that stood here was itself stale.** It read
 * *"set two above the current 20 so a genuinely-forced addition lands, and a third one has to
 * argue"* — but the register reached 26 when G7-G11 were disposed at `36c2800`/`97a127d` and this
 * ceiling was moved to 26 with it, so the slack the sentence describes had been **zero** for two
 * days while the sentence went on describing it. Recorded rather than quietly rewritten: a
 * comment that survives the arithmetic it explains is how this repository's guards go decorative,
 * and this file's whole subject is entries that stop describing the tree.
 *
 * **Sited at 36, exactly the register's size, with no slack — deliberately.** The "two spare"
 * design assumed a register that grows by somebody's judgement one entry at a time. It does not
 * any more: `reachability-guard.node.test.ts` now *derives* the `global-object-hop` class and
 * reddens if the register disagrees in either direction, so a forced addition arrives with a red
 * test naming the symbol rather than needing a slot to land in quietly. Slack would only let a
 * `benchmark-driver-only` or `deferred-in-source` entry — the two causes that are still
 * judgement — appear without argument.
 *
 * **Raised 36 → 42, measured 2026-08-13.** One `global-object-hop` entrant the derived case named
 * by itself, and five {@link HIDDEN_BY_DISPATCH} rows. The no-slack design above survives the
 * raise on the same terms it was written under: `global-object-hop` is still derived and still
 * reddens in both directions, and the five new rows are the *third* cause class whose membership
 * is machine-checked rather than judged — each carries the member it is reached through, and
 * `reachability-guard.node.test.ts` re-measures all three legs of that claim on every run. The
 * ceiling is again exactly the register's size, deliberately. The guard printed it: *"the register
 * holds 42 entries against a ceiling of 36"*.
 *
 * **Raised 42 → 43, measured 2026-08-14.** One `global-object-hop` entrant, `browser/enrolledIssuer`,
 * and it arrived the way the no-slack design above says a forced addition should: the derived case
 * went red first and named it — *"expected [ 'browser/enrolledIssuer' ] to deeply equal []"* — and
 * the register was edited to agree with a measurement rather than a judgement. It is AUTH-02's
 * production anchor read, called from `main.ts#start`, hidden by the same `window.o2` assignment as
 * the fifteen `browser/` entries it sits among. No new cause class and no new mechanism: had the
 * graph been able to trace that one assignment, this entry would not exist.
 *
 * **Raised 43 → 44, measured 2026-08-16.** One `global-object-hop` entrant, `core/checkpointsInto`,
 * arriving by the same route as the last one: the derived case went red first and named it —
 * *"expected [ 'core/checkpointsInto' ] to deeply equal []"* — and the register was edited to agree
 * with a measurement. It is CHURN-03's checkpoint sink, called from `main.ts#runColouring`, hidden
 * by the same `window.o2` assignment as everything else on that list. No new cause class and no new
 * mechanism: had the graph been able to trace that one assignment, this entry would not exist
 * either. **The direction is worth stating** — this raise records wiring debt being *paid*, not
 * incurred: the symbol exists solely to give criterion 7's write half a production caller.
 *
 * **Raised 44 → 47, measured 2026-08-17.** Three `global-object-hop` entrants at once —
 * `demo/buildPrimesInput`, `demo/projectPrimeCount`, `demo/readPrimeCount` — and they arrived by
 * the established route: the derived case went red first and named all three verbatim, and the
 * register was edited to agree with a measurement rather than a judgement. `TabApi.runPrimes`
 * calls them from `main.ts`, hidden by the same `window.o2` assignment as everything else on that
 * list. No new cause class and no new mechanism.
 *
 * **This is the largest single raise so far and it is the good direction, which is worth saying
 * plainly because a growing register looks like debt accruing.** The three did not appear from
 * nowhere: they came *out of `OPEN_FINDINGS`*, where they sat as the v1.1 audit's G4 primes half
 * with the reason *"zero production callers"*. They now have one. So the register grew by three
 * and the open-findings list shrank by three, and what moved between them is a workload that
 * went from unrunnable to runnable — the owner taking UI-SPEC section 10's Option A. Had the
 * graph been able to trace that one assignment, none of the three entries would exist.
 */
export const DISPOSITION_CEILING = 47

/** `barrel/symbol` for every disposed entry — the form the guard's verdict list uses. */
export function disposedKeys(register: readonly Disposition[] = DISPOSITIONS): Set<string> {
  return new Set(register.map((one) => `${one.barrel}/${one.symbol}`))
}
