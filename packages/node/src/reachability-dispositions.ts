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
 *    **not** pass clean on this tree, and this file does not pretend otherwise. Forty-seven
 *    callable barrel exports have no production caller at all, in a milestone named *"Wire What
 *    Was Built"*, and that number is the honest reading rather than something to dispose away.
 */

/** Why the guard cannot reach a symbol. A mechanism, never a tier. */
export type DispositionCause =
  | 'global-object-hop'
  | 'benchmark-driver-only'
  | 'deferred-in-source'

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
 * Four of them — `IdbBlockstore`, `VisibilityGovernor`, `browserWorkerExecutor` and `domThread` —
 * sit one hop further, behind `BrowserNode`, which is itself in this list. The chain is named in
 * the guard rather than flattened, so a change in the middle of it is visible.
 *
 * **Closing this class means making the entry real**, not excusing it: extract the inline script
 * into a module the tracer can root on, or teach the graph the `window.o2` assignment. Until then
 * these are a fact about static tracing, and the guard's own header says so.
 */
const GLOBAL_OBJECT_HOP: readonly string[] = [
  'browser/BrowserNode',
  'browser/IdbBlockstore',
  'browser/VisibilityGovernor',
  'browser/browserWorkerExecutor',
  'browser/classifyStartError',
  'browser/currentBrowserLabel',
  'browser/domThread',
  'browser/firstGap',
  'browser/grantConsent',
  'browser/probeEnvironment',
  'browser/readConsent',
  'browser/revokeConsent',
  'demo/answerOf',
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
 */
export const OPEN_FINDING_CEILING = 47

/**
 * How large the register may grow before something reddens.
 *
 * The anti-vacuity device, and the floor's failure mode is itself on record: 19-12 found the
 * mutation ledger's floor stale at 23 while the ledger held 42, and nothing said so. Set two
 * above the current 20 so a genuinely-forced addition lands, and a third one has to argue.
 */
export const DISPOSITION_CEILING = 26

/** `barrel/symbol` for every disposed entry — the form the guard's verdict list uses. */
export function disposedKeys(register: readonly Disposition[] = DISPOSITIONS): Set<string> {
  return new Set(register.map((one) => `${one.barrel}/${one.symbol}`))
}
