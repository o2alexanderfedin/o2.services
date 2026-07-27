/**
 * A stand-in for a translated artifact, sized so the load path can be measured.
 *
 * V8 only considers a WebAssembly module for its code cache once the module is
 * roughly 128 KB or larger. That single fact makes the demo kernel useless as a
 * subject: it is about 1.2 KB, so it will *never* be cached, and a test written
 * against it would measure nothing while reporting success. Something over the
 * threshold is required, and committing a multi-megabyte binary to get it would put
 * an opaque blob in the repository that nobody can regenerate or audit.
 *
 * So the module is generated. `syntheticArtifact` emits a valid WASM module of a
 * requested shape — N functions of M arithmetic operations each — which gives a
 * dial from a few hundred bytes to tens of megabytes with no toolchain and no
 * fixture file.
 *
 * ## What a synthetic module does and does not stand in for
 *
 * It **does** stand in for size and for function count, which are the two inputs to
 * V8's caching decision and the two things that dominate compile time. Measurements
 * of fetch, verify, and compile against it are measurements of the real load path.
 *
 * It **does not** stand in for an elfconv artifact in any other respect. It imports
 * nothing, so it exercises none of the 23 `wasi_snapshot_preview1` imports a real
 * `aarch64-wasi32` artifact carries; it has no memory section, no data segments and
 * no `_start`; its control flow is straight-line, where a lifted binary is a large
 * dispatch loop. Nothing measured here is evidence about elfconv output, and any
 * claim that mentions elfconv needs a real artifact behind it.
 *
 * ## Why not `@o2/core`'s fixtures
 *
 * `packages/core/src/executor/fixtures.ts` holds hand-assembled modules whose whole
 * point is that a reader can check every byte by eye. This one's point is bulk.
 * Mixing them would spoil both.
 *
 * Deterministic by construction: the same shape yields byte-identical output, so a
 * gateway URL derived from its CID is stable across runs and machines. That is what
 * lets the code-cache measurement use the same key twice.
 */

/** Unsigned LEB128. Section and body sizes here run into the millions. */
function uleb(value: number): number[] {
  const out: number[] = []
  let rest = value
  do {
    let byte = rest & 0x7f
    rest >>>= 7
    if (rest !== 0) byte |= 0x80
    out.push(byte)
  } while (rest !== 0)
  return out
}

/**
 * Signed LEB128 — `i32.const` immediates are signed.
 *
 * The same trap `@o2/core`'s fixtures document: a bare `0xA1` for 161 sets the
 * continuation bit and swallows the following opcode.
 */
function sleb(value: number): number[] {
  const out: number[] = []
  let rest = value
  for (;;) {
    const byte = rest & 0x7f
    rest >>= 7
    const signBitSet = (byte & 0x40) !== 0
    if ((rest === 0 && !signBitSet) || (rest === -1 && signBitSet)) {
      out.push(byte)
      return out
    }
    out.push(byte | 0x80)
  }
}

function section(id: number, payload: number[]): number[] {
  return [id, ...uleb(payload.length), ...payload]
}

function vector(items: number[][]): number[] {
  const out: number[] = uleb(items.length)
  for (const item of items) out.push(...item)
  return out
}

/**
 * Binary operators over i32, each one byte: add, xor, mul, rotl, and, or.
 *
 * All total — no division, so no trap is reachable and the module can be executed
 * as hot as a measurement needs without a divide-by-zero ending the run.
 */
const BINARY_OPS = [0x6a, 0x73, 0x6c, 0x77, 0x71, 0x72] as const

export interface SyntheticShape {
  /** Function count. Each is exported-reachable through `run`'s type only. */
  readonly functions: number
  /** Arithmetic operations per function body. */
  readonly opsPerFunction: number
}

/**
 * A shape that clears V8's caching threshold with room to spare.
 *
 * Chosen to land near 220 KB rather than exactly 128 KB: the threshold is a
 * documented rule of thumb rather than a specified constant, and a fixture sitting
 * on top of it would turn a V8 change into a mystery failure here.
 */
export const CODE_CACHE_SIZED: SyntheticShape = { functions: 600, opsPerFunction: 120 }

/**
 * A shape near the size of a real `aarch64-wasi32` translation (5.66 MB measured
 * for a 659 KB `hello`), for the load-path timing runs.
 *
 * This is the shape `packages/node/src/code-cache.e2e.test.ts` serves, and therefore
 * the shape behind the one row `CODE_CACHE_READINGS` presents as measured. Change it
 * and that row's `moduleBytes` is stale — which the browser test detects, because it
 * recomputes the size from here rather than quoting the table.
 */
export const ARTIFACT_SIZED: SyntheticShape = { functions: 8000, opsPerFunction: 200 }

/**
 * Build a valid WASM module of the requested shape.
 *
 * Exports one function `run: () -> i32`. Every function has the same type, so the
 * type section stays a single entry however large the module grows.
 */
export function syntheticArtifact(shape: SyntheticShape): Uint8Array<ArrayBuffer> {
  const { functions, opsPerFunction } = shape

  // One type: () -> i32.
  const types = section(1, vector([[0x60, 0x00, 0x01, 0x7f]]))
  const declarations = section(3, vector(Array.from({ length: functions }, () => [0x00])))
  const name = [...new TextEncoder().encode('run')]
  const exports = section(7, vector([[...uleb(name.length), ...name, 0x00, ...uleb(0)]]))

  // A linear congruential sequence, so the constants and operator choices are
  // varied (V8 must actually compile them) yet reproduced exactly on every host.
  let state = 0x9e3779b9
  const advance = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state
  }

  const bodies: number[][] = []
  for (let index = 0; index < functions; index++) {
    const body: number[] = [0x00] // no locals
    body.push(0x41, ...sleb(advance() & 0x3f))
    for (let op = 0; op < opsPerFunction; op++) {
      const next = advance()
      body.push(0x41, ...sleb(next & 0x3f))
      body.push(BINARY_OPS[(next >>> 8) % BINARY_OPS.length] ?? 0x6a)
    }
    body.push(0x0b) // end
    bodies.push([...uleb(body.length), ...body])
  }
  const code = section(10, vector(bodies))

  return new Uint8Array([
    0x00, 0x61, 0x73, 0x6d, // \0asm
    0x01, 0x00, 0x00, 0x00, // version 1
    ...types,
    ...declarations,
    ...exports,
    ...code,
  ])
}
