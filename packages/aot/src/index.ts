/**
 * `@o2/aot` — naming and admitting AOT-translated artifacts.
 *
 * The translation itself is a C++/LLVM/Remill toolchain that runs in a container at
 * build time and has no TypeScript in it. What lives here is everything the fabric
 * needs *around* that step: what a translation is called, whether an input can be
 * translated at all, and how the result joins the same signed, verified path as a
 * source-compiled module.
 *
 * **This is not static determinism analysis.** That was built, hardened, fuzzed and
 * deleted in Phase 1, and must not come back: divergence is *detected* by running a
 * module twice and comparing bytes, never predicted from its instruction stream. The
 * checks here answer a different question — can this toolchain translate this input
 * — and answering it wrongly costs a failed build, not a wrong result.
 *
 * ## Why the WASI executor is on the public surface
 *
 * AOT-04's claim is about a *path*: a translated artifact is admitted and verified by
 * the same machinery as a source-compiled one. A claim about a path cannot be
 * demonstrated from inside the module that implements it. While `WasiExecutor` was
 * reachable only through a relative import from its own spec, the strongest statement
 * available was "this file can construct one and run it", which is a claim about the
 * file — the interesting clause, that `submitJob` accepts it without knowing what it
 * is, was untestable by anyone standing outside. So the executor, its structured
 * failure type, and every constant that forms its pinned-environment contract are
 * exported here, and `admission.test.ts` reaches them through this barrel on purpose:
 * delete a line below and that test stops compiling, which is the point.
 *
 * ## What is deliberately absent
 *
 * The lift driver. `tools/aot/lift.ts` shells out to Docker and imports
 * `node:child_process`, `node:fs/promises` and `node:os`; re-exporting its types from
 * here would pull a Node builtin into a package `purity.node.test.ts` requires to run
 * unchanged in a browser, and would close a cycle, because `lift.ts` already imports
 * `screenElf` from this barrel. Build tooling depends on the portable package; the
 * portable package never depends back.
 *
 * Portable: no platform imports, no filesystem, no container.
 */

export { describeKey, describeKeyFailure, normaliseFeatures, translationCid } from './cache-key.ts'
export type {
  KeyFailure,
  KeyResult,
  ToolchainVersions,
  TranslationKey,
  TranslationRecord,
} from './cache-key.ts'

export { describeRefusal, screenElf } from './elf.ts'
export type {
  DynamicEvidence,
  ElfFacts,
  ElfRefusal,
  ElfRegion,
  ElfScreening,
  ElfType,
} from './elf.ts'

// Running a translated WASI command module on the fabric — AOT-04.
//
// The constants are exported beside the class because they *are* the contract. A
// caller cannot check that the environment it was promised is the environment it
// got by reading the prose; it checks `WASI_ENV`, `FIXED_REALTIME_NANOS` and
// `PINNED_WASI_FUNCTIONS`, which is also how a conformance test notices that a shim
// upgrade renamed a function out from under the pinning.
export {
  describeWasiFailure,
  FIXED_MONOTONIC_NANOS,
  FIXED_REALTIME_NANOS,
  MAX_STDERR_BYTES,
  PINNED_WASI_FUNCTIONS,
  pinnedWasiImports,
  seededStream,
  shardArgv,
  taskSeed,
  WASI_ARGV0,
  WASI_ENTRYPOINT,
  WASI_ENV,
  WASI_NAMESPACE,
  WasiExecutor,
} from './wasi-executor.ts'
export type {
  RandomStream,
  WasiExecutorOptions,
  WasiFailure,
  WasiHostFunction,
  WasiHostFunctions,
  WasiRunOutcome,
} from './wasi-executor.ts'
