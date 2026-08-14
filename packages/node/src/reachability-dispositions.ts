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
 * - the register **cannot grow silently** — it carries a ceiling, and so does the open list.
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
 *    finding**. That is why {@link OPEN_FINDING_CEILING} exists and is large: criterion 1 does
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
  'browser/firstGap',
  'browser/grantConsent',
  'browser/identifyBrowser',
  'browser/probeEnvironment',
  'browser/readConsent',
  'browser/revokeConsent',
  'core/describeStartReport',
  'core/startReportFromCounts',
  'demo/answerOf',
  'demo/buildPiInput',
  'demo/colourOf',
  'demo/estimatePi',
  'demo/piErrorBound',
  'demo/projectPiPartial',
  'demo/readPiPartial',
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

/**
 * How many findings may remain **undisposed** before the guard refuses.
 *
 * Sited at **47**, measured 2026-08-08 at `a5fa2bd`: 67 unreachable callable barrel exports, 20
 * of them disposed above. This is not a target and it is not a pass — it is the size of the
 * *"Wire What Was Built"* residue, held still so it cannot grow while nobody is looking.
 *
 * **Lowering it is the work.** Raising it needs a reason written next to it.
 *
 * ## Ratcheted 42 → 40, measured 2026-08-08
 *
 * G7's pair moved from open to disposed, so the open count genuinely fell. **Measured, not
 * derived**: `OPEN_FINDING_CEILING` was temporarily set to 0 and the guard's own verdict read
 * *"40 unreachable callable barrel exports carry no disposition"*, naming all forty. The ceiling
 * follows the measurement down, because a ceiling with slack in it stops binding — a regression
 * of two would have passed silently against 42.
 *
 * **The owner ruled 2026-08-08 to hold this residue rather than work it down.** That governs the
 * *backlog*, not the guard: holding the count still and letting the ceiling drift above it are
 * different things, and only the first was asked for.
 *
 * ## Raised 40 → 47, measured 2026-08-09 (Plan 25-04)
 *
 * Seven new callable barrel exports arrived at once: `core/createLibsodiumSyncVerifier`,
 * `core/createNobleSyncVerifier`, `core/createSubtleAsyncVerifier`,
 * `core/Ed25519NotInitializedError`, `core/getAsyncVerifier`, `core/getSyncVerifier`,
 * `core/initEd25519` — the Ed25519 dual-port verifier `packages/core/src/ed25519-backend.ts`
 * exports from `@o2/core`'s barrel. Not disposed: the module's own docblock already states why
 * it has no production caller yet (a bootstrap-ordering decision across three runtime entry
 * points, not a `deferred-in-source` one-line deferral this register's shape fits), and that
 * statement is this plan's own deliverable rather than something to duplicate here as a second
 * copy that can drift from the first. This is a raise, not a lowering — the residue is larger,
 * honestly, until a future phase wires the port or a disposition is written for it.
 *
 * ## Raised 47 → 49, measured 2026-08-09 (Plan 25-02)
 *
 * `core/decodeX509Certificate` and `core/describeX509Failure` arrived when Plan 25-02
 * barrel-exported `packages/core/src/x509.ts` for the first time. Not disposed, for the
 * same shape of reason as the ed25519-backend.ts raise immediately above: this phase's
 * X.509 profile is fully implemented and tested but has no production caller this
 * phase by design (`.planning/REQUIREMENTS.md`'s X509-01…07 rows state it explicitly —
 * this phase does not wire the decoder into enrollment, issuance, or the demo; that is
 * out of its named scope, and only its bundle cost is measured, in Plan 25-03). Two
 * exports moved the count by exactly two, not five, because
 * `MAX_CERTIFICATE_BYTES`/`MAX_EXTENSION_BYTES`/`MAX_EXTENSION_COUNT` are `const` value
 * exports rather than functions/classes and never entered the "callable" corpus this
 * guard walks.
 *
 * ## Lowered 49 → 47, measured 2026-08-10 (Phase 28, Plan 28-01)
 *
 * `core/createLibsodiumSyncVerifier` and `core/createSubtleAsyncVerifier` left the barrel when
 * Plan 28-01 merged `packages/core`'s two Ed25519 selection paths into one. Both were undisposed
 * findings, so the residue falls by exactly two and nothing arrived to offset it. The five
 * remaining `ed25519-backend.ts` findings — `core/createNobleSyncVerifier`,
 * `core/Ed25519NotInitializedError`, `core/getAsyncVerifier`, `core/getSyncVerifier`,
 * `core/initEd25519` — stay open and stay undisposed for the reason the 40 → 47 note above
 * already gives: the port still has no production caller, and the merge did not change that.
 * The merge is behaviour-neutral in production; it removed a duplication from the package, not a
 * hazard from a trust path, and this lowering should be read as exactly that much.
 *
 * **Measured, not derived, and the arithmetic here is a trap worth naming.** The ceiling was set
 * to 0 before the merge and the guard reported *"49 unreachable callable barrel exports carry no
 * disposition"*, and again after and it reported *"47"*, naming all forty-seven with the two
 * departed symbols visibly absent — a within-run pair, so the difference is the merge. 49 − 2 is
 * also 47, and `reachability-guard.node.test.ts:350` and `.planning/REQUIREMENTS.md:790` have
 * both *said* "47" since before this phase, staled against the 47 → 49 raise above and describing
 * a different population. **Agreement with a stale comment is not confirmation and was not taken
 * as any**; the number here is the one the guard printed.
 *
 * ## Lowered 47 → 37, measured 2026-08-10 — a RECLASSIFICATION, not wiring
 *
 * **Nothing was wired and nothing became reachable.** Ten symbols moved from the open list into
 * {@link GLOBAL_OBJECT_HOP} because they were always members of that class and the class had
 * never been derived; see that constant's `16 → 26` note for the method and the per-symbol
 * chains. The residue this ceiling holds is *"callable barrel exports with no production caller
 * at all"*, and all ten have one — so counting them here was reporting the gap as **larger than
 * it is**, which is the direction the 2026-08-08 re-audit named about itself and the direction
 * `G14` was raised in.
 *
 * **This does not touch the owner's 2026-08-08 ruling to hold the residue rather than work it
 * down.** Holding a count still and correcting what the count is *of* are different acts, and
 * only the second happened here. The 37 that remain are undisposed on the same terms as before.
 *
 * **Measured, not derived, and the trap named in the note above was live again here.** This
 * ceiling was set to 0 before the ten were added and the guard reported *"47 unreachable callable
 * barrel exports carry no disposition"*, and again after and it reported *"37"*, naming all
 * thirty-seven with the ten visibly absent — a within-run pair, so the difference is the
 * reclassification. 47 − 10 is also 37, and the agreement was not taken as the proof.
 *
 * **Raised 37 → 38, 2026-08-11, for `net/reduceSovereignJob` — one symbol, and it is reported
 * as an open finding rather than disposed.** MR-02's sovereign aggregation arm has no
 * production caller, and the blocker was measured rather than assumed: the arm needs a job whose
 * shards are pinned to **two or more** owners, and no rig in this repository stands up two
 * owners. `bin/bench.ts` enrols every worker under one `BENCH_USER_SEED`, so its `--sovereign`
 * leg's one owner-pinned row would be promoted rather than combined and the arm refuses it by
 * name; `demo/main.ts`'s bring-your-own path submits every owner-pinned shard under the single
 * `options.sovereign.ownerId` the harness supplies. Giving either a second owner changes what a
 * published driver measures or what a visitor's page submits, which is an owner decision and not
 * a wiring fix. **A disposition would be the wrong shape for that**: this file's own rule is that
 * a disposition is granted on a *mechanism* the graph cannot see, and there is no mechanism here
 * — the symbol is genuinely uncalled. It is measured, across real `bin/agent.ts` processes, by
 * `sovereign-aggregation.node.test.ts`; measured is not wired, and this ceiling says so.
 *
 * ## Lowered 38 → 36, measured 2026-08-11 — and this one is WIRING, not a reclassification
 *
 * Every prior movement in this note was a raise, a removal, or a correction of what the count was
 * *of*. This is the first that is the work itself. `core/decodeX509Certificate` and
 * `core/describeX509Failure` were raised into this residue by the 47 → 49 note above, on the
 * explicit ground that *"this phase does not wire the decoder into enrollment, issuance, or the
 * demo"*. It is wired now: `checkX509Form` in `packages/core/src/enrollment.ts` calls both — the
 * decoder to parse a presented certificate and the describer to name its refusal — fail-closed,
 * on the trust path. Both symbols leave the open list because they have a production caller, not
 * because anything about them was reclassified.
 *
 * **Measured, not derived.** This ceiling was set to 0 and the guard reported *"36 unreachable
 * callable barrel exports carry no disposition"*, naming all thirty-six with the two visibly
 * absent. 38 − 2 is also 36 and the agreement was not taken as the proof — the 49 → 47 note above
 * records why that coincidence is refused here as a matter of habit.
 *
 * ## Lowered 36 → 29, measured 2026-08-13 — an INSTRUMENT repair, and it is neither of the above
 *
 * Every prior movement was a raise, a reclassification, or wiring. This one is a third kind:
 * **nothing about the tree changed and nothing was reclassified by judgement** — the tracer was
 * repaired, and seven symbols that had a production caller all along stopped being reported as
 * having none. Six could not be seen by any plant, and one was seen only by a plant that had
 * nothing to root:
 *
 * - `core/executeVerified` **leaves the findings entirely** and is not disposed. It is the
 *   fabric's N-version comparison and runs on every shard dispatch; `submitJob` hands `runOn` — a
 *   `const`-arrow at `submit.ts:2933` — to `dispatchUnderLease` at `:3006`, and the reference
 *   filter dropped the edge because `classify` reads declaration flags and an arrow-initialised
 *   `const` is a `Variable`. This is the only symbol in this repair that becomes **reachable**.
 * - `core/describeStartReport` moves to {@link GLOBAL_OBJECT_HOP}; see that constant's `26 → 27`
 *   note. It had an in-degree of zero, so the hop plant could not find it.
 * - `core/signResult`, `core/describeModuleRefusal`, `aot/describeWasiFailure`,
 *   `core/TransportError` and `node/classifyReservationFailure` move to
 *   {@link HIDDEN_BY_DISPATCH}, where each carries the member it is reached through and three
 *   measured legs holding that claim up.
 *
 * **Measured, not derived, and the trap this note names twice above was live a third time.** Both
 * ceilings were set to 0 and the guard reported *"the guard found 71 unreachable callable barrel
 * exports"* and *"29 unreachable callable barrel exports carry no disposition"*, naming all
 * twenty-nine. 36 − 7 is also 29 and the agreement was not taken as the proof.
 *
 * **This does not touch the owner's ruling to hold the residue.** Nothing was worked down; a
 * measuring instrument stopped mis-measuring, and the residue was smaller than reported for as
 * long as the defect existed.
 *
 * **This is where the count of the facades is NOT.** `packages/core/src/cert-lifecycle.ts`
 * publishes nothing to any barrel, so its four facades and three factories were never in this
 * population and no edit here can put them in one. They are ledgered by
 * `reachability-guard.node.test.ts`'s *"a module that reaches no barrel is counted, not
 * invisible"* block, which measures the price of moving them here — **+7, read within one run on
 * 2026-08-11, not the +12 that had been projected** — and holds them out until an owner decides
 * otherwise.
 */
export const OPEN_FINDING_CEILING = 29

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
 */
export const DISPOSITION_CEILING = 42

/** `barrel/symbol` for every disposed entry — the form the guard's verdict list uses. */
export function disposedKeys(register: readonly Disposition[] = DISPOSITIONS): Set<string> {
  return new Set(register.map((one) => `${one.barrel}/${one.symbol}`))
}
