/**
 * `kernel.wat` → wasm bytes. Side-effect free, so the build script and the test that
 * checks the build can share one compilation path.
 *
 * If the test compiled by a different route — different feature flags, different
 * writer options — a byte mismatch would prove nothing about the committed binary and
 * everything about the two configurations. Sharing this function is what makes the
 * comparison meaningful.
 *
 * Build-time only. `wabt` is a root devDependency and never reaches a bundle.
 */

import wabtInit from 'wabt'

/**
 * Every post-MVP feature named explicitly, almost all of them off.
 *
 * Relying on wabt's defaults would make the emitted bytes a function of the toolchain
 * version rather than of the source, and the byte-identity test would start failing on
 * an unrelated upgrade with no indication why. Naming the set also documents what the
 * kernel is allowed to be: no threads (shared memory is a nondeterminism source and
 * needs COOP/COEP headers a static host cannot set), no relaxed SIMD (nondeterministic
 * by design and with no off switch in V8), no GC, no memory64.
 *
 * `mutable_globals` is on because the kernel keeps one — the address of the triple
 * table, which depends on the CBOR header width and so is not known until run time.
 */
export const FEATURES = {
  exceptions: false,
  mutable_globals: true,
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

/** Compile WAT source to wasm bytes, validating on the way through. */
export async function compileKernel(watSource) {
  const wabt = await wabtInit()
  const module = wabt.parseWat('kernel.wat', watSource, FEATURES)
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
