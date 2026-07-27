/** Types for the build-time WAT compiler. See `compile-wasi-fixture.mjs`. */

/** wabt feature flags, all named explicitly so the output does not depend on defaults. */
export declare const FEATURES: Readonly<Record<string, boolean>>

/** The fixture base names, in the order the build script emits them. */
export declare const FIXTURES: readonly string[]

/** Compile WAT source to wasm bytes, validating on the way through. */
export declare function compileWat(name: string, watSource: string): Promise<Uint8Array>
