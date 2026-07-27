/**
 * `*.wat` → wasm bytes for the WASI fixtures. Side-effect free, so the build script
 * and the test that checks the build share one compilation path.
 *
 * Copied in shape from `packages/demo/scripts/compile-kernel.mjs`, and for the same
 * reason: if the test compiled by a different route — different feature flags,
 * different writer options — a byte mismatch would prove nothing about the committed
 * binary and everything about the two configurations.
 *
 * Build-time only. `wabt` is a root devDependency and never reaches a bundle.
 */

import wabtInit from 'wabt'

/**
 * Every post-MVP feature named explicitly, all of them off.
 *
 * The fixtures are hand-written and use nothing past the MVP, so unlike the demo
 * kernel they do not even need `mutable_globals`. Naming the whole set anyway keeps
 * the emitted bytes a function of the source rather than of the wabt version, which
 * is what makes the byte-identity test mean something across a toolchain upgrade.
 *
 * It is worth noting what this set is *not*: it is not the feature set of a real
 * translated artifact. `aarch64-wasi32` output carries `+bulk-memory,
 * +mutable-globals, +sign-ext`. The fixtures stand in for the module *shape* — the
 * `wasi_snapshot_preview1` import namespace, the `_start`/`memory` export pair — and
 * deliberately not for its instruction mix, because the executor is indifferent to
 * the latter and V8 is the only thing that gets a say about it.
 */
export const FEATURES = {
  exceptions: false,
  mutable_globals: false,
  sat_float_to_int: false,
  sign_extension: false,
  simd: false,
  threads: false,
  function_references: false,
  multi_value: false,
  tail_call: false,
  bulk_memory: false,
  reference_types: false,
  annotations: false,
  code_metadata: false,
  gc: false,
  memory64: false,
  extended_const: false,
  relaxed_simd: false,
}

/**
 * The fixtures, in one list so the build script and the build test cannot disagree
 * about which files exist. A `.wat` added to the directory and forgotten here would
 * simply never be compiled, and nothing would say so — hence the test that walks the
 * directory and requires every `.wat` in it to appear below.
 */
export const FIXTURES = [
  'wasi-echo',
  'wasi-shard',
  'wasi-probe',
  'wasi-fail',
  'wasi-fdstat',
  'wasi-env',
  'wasi-hostcall',
  'wasi-noisy',
  'wasi-no-start',
  'wasi-no-memory',
  'wasi-thread-spawn',
]

/** Compile WAT source to wasm bytes, validating on the way through. */
export async function compileWat(name, watSource) {
  const wabt = await wabtInit()
  const module = wabt.parseWat(`${name}.wat`, watSource, FEATURES)
  try {
    module.validate()
    // No debug names: they would put the toolchain's idea of local naming into the
    // committed artifact, and the CID of a task module has to be a function of its
    // behaviour, not of how it was spelled.
    const { buffer } = module.toBinary({ write_debug_names: false })
    return new Uint8Array(buffer)
  } finally {
    module.destroy()
  }
}
