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
