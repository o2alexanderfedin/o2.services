/** Types for the build-time WAT compiler. See `compile-kernel.mjs`. */

/** wabt feature flags, all named explicitly so the output does not depend on defaults. */
export declare const FEATURES: Readonly<Record<string, boolean>>

/** Compile WAT source to wasm bytes, validating on the way through. */
export declare function compileKernel(watSource: string): Promise<Uint8Array>
