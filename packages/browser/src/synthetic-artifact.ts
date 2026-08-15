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

/**
 * The operators the chained shape may use, and why they are fewer.
 *
 * `and` (0x71) and `or` (0x72) are gone. They are the two lossy operators in
 * {@link BINARY_OPS}, and over a long chain they destroy the dependence the chained
 * shape is built to preserve: `(x & 1) & 2` is `x & (1 & 2)`, which is `0`. That is
 * not a subtle risk, it was **measured** — at 100 ops per function the first version
 * of this shape returned a byte-identical result on every call, meaning every body
 * had collapsed to a value the global no longer reached. Turbofan's machine-operator
 * reducer performs exactly that reassociation statically, so a chain that is dead at
 * runtime is a chain that folds at compile time, and folded code is not top-tier code.
 *
 * What remains is bijective over i32 for odd multipliers: add, xor, mul, rotl.
 * Nothing is lost, so nothing can be dropped.
 */
const CHAINED_OPS = [0x6a, 0x73, 0x6c] as const

/** `i32.rotl` — interleaved between every {@link CHAINED_OPS} step. */
const ROTL = 0x77

export interface SyntheticShape {
  /** Function count. Each is exported-reachable through `run`'s type only. */
  readonly functions: number
  /** Arithmetic operations per function body. */
  readonly opsPerFunction: number
  /**
   * Emit the *executable* shape instead of the straight-line one.
   *
   * Absent or `false` reproduces the original generator byte for byte — the
   * conformance vector in `streaming-load.browser.test.ts` pins those exact bytes,
   * and every published CID in this tree is a CID of that output.
   *
   * `true` changes two things, and both of them exist because of what the original
   * shape turned out to be unable to measure. See {@link CHAINED_HOT}.
   */
  readonly chained?: boolean
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
 * A shape that can actually *become hot*, which the three shapes above cannot.
 *
 * ## What was wrong with measuring the code cache against the shapes above
 *
 * `ARTIFACT_SIZED` was chosen for size, on the documented rule that V8 considers a
 * module for its code cache once it is roughly 128 KB. That rule is real and it is
 * not the whole rule. `node --v8-options` names a threshold nothing in this tree was
 * built around:
 *
 * ```
 * --wasm-caching-threshold=1000        (top-tier code that triggers the next caching event)
 * --wasm-caching-timeout-ms=2000       (only cache if no new code compiled within this window)
 * --wasm-caching-hard-threshold=1000000 (top-tier code that triggers caching immediately)
 * ```
 *
 * The unit is **bytes of top-tier code**, not bytes of module. Only functions that
 * tier up contribute, and a function tiers up only when it is called enough times.
 * The shapes above have exactly one entry point, `run` — function 0 — and function 0
 * *never calls anything*: every body is a straight `i32.const` / binop chain (see the
 * loop below). So heating `run()` three million times tiers up one function out of
 * 8000, and that one function's body is a chain of constants over constants, which
 * Turbofan folds to a single materialised value. The top-tier code produced is a few
 * dozen bytes against a threshold of 1000.
 *
 * A 4.8 MB module that can only ever produce a few dozen bytes of top-tier code
 * cannot trigger caching **whatever** its URL, MIME type or size. The published
 * negative measured against it was therefore a fact about the fixture.
 *
 * ## What `chained: true` changes
 *
 * 1. **Function 0 calls every other function**, so heating `run()` heats the whole
 *    module rather than one function of it.
 * 2. **Every body starts from a mutable global** rather than an `i32.const`, so the
 *    arithmetic depends on a value Turbofan cannot know and the chain survives
 *    constant folding into real machine code. `run` also writes the global back, so
 *    the input genuinely differs between calls and nothing can be hoisted out.
 *
 * 2000 x 100 is deliberately far smaller than `ARTIFACT_SIZED`: the useful axis here
 * is top-tier code, not module bytes, and 2000 tiered-up functions produce vastly
 * more of it than 8000 never-called ones. Keeping the module small also keeps the
 * heat loop affordable — every visit pays for it.
 */
export const CHAINED_HOT: SyntheticShape = { functions: 2000, opsPerFunction: 100, chained: true }

/**
 * Build a valid WASM module of the requested shape.
 *
 * Exports one function `run: () -> i32`. Every function has the same type, so the
 * type section stays a single entry however large the module grows.
 */
export function syntheticArtifact(shape: SyntheticShape): Uint8Array<ArrayBuffer> {
  if (shape.chained === true) return chainedArtifact(shape)
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

/**
 * The executable variant — see {@link CHAINED_HOT} for why it exists.
 *
 * Same module type throughout (`() -> i32`), same deterministic constant sequence,
 * same single export. Two structural differences, and only two:
 *
 * - a **mutable i32 global** (section 6, which must precede the export section), read
 *   at the top of every body so no body is a closed expression over constants;
 * - **function 0 calls functions 1..N-1** and sums the results, so one call to `run`
 *   is one call to every function in the module.
 *
 * The constants are forced odd and non-zero (`| 1`). A zero immediate reaching an
 * `i32.and` would collapse the accumulator to a constant and hand the rest of that
 * body back to the folder — the exact failure this shape exists to avoid, reintroduced
 * one function at a time.
 */
function chainedArtifact(shape: SyntheticShape): Uint8Array<ArrayBuffer> {
  const { functions, opsPerFunction } = shape

  const types = section(1, vector([[0x60, 0x00, 0x01, 0x7f]]))
  const declarations = section(3, vector(Array.from({ length: functions }, () => [0x00])))
  // One mutable i32 global, initialised to 1. `0x7f` i32, `0x01` mutable, then a
  // constant init expression terminated by `end`.
  const globals = section(6, vector([[0x7f, 0x01, 0x41, ...sleb(1), 0x0b]]))
  const name = [...new TextEncoder().encode('run')]
  const exports = section(7, vector([[...uleb(name.length), ...name, 0x00, ...uleb(0)]]))

  let state = 0x9e3779b9
  const advance = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state
  }

  const bodies: number[][] = []

  // Function 0 — the driver. One i32 local, because the accumulated sum has to be
  // both folded into the global and returned, and there is no `dup` in wasm.
  const driver: number[] = [0x01, 0x01, 0x7f]
  driver.push(0x41, ...sleb(0)) // i32.const 0 — the accumulator seed
  for (let index = 1; index < functions; index++) {
    driver.push(0x10, ...uleb(index)) // call index
    driver.push(0x6a) // i32.add
  }
  driver.push(0x22, ...uleb(0)) // local.tee 0 — keep the sum on the stack
  driver.push(0x23, ...uleb(0)) // global.get 0
  driver.push(0x6a) // i32.add
  driver.push(0x24, ...uleb(0)) // global.set 0 — the next call sees a different input
  driver.push(0x20, ...uleb(0)) // local.get 0
  driver.push(0x0b) // end
  bodies.push([...uleb(driver.length), ...driver])

  for (let index = 1; index < functions; index++) {
    const body: number[] = [0x00] // no locals
    body.push(0x23, ...uleb(0)) // global.get 0 — the value Turbofan cannot know
    for (let op = 0; op < opsPerFunction; op++) {
      const next = advance()
      // Every other step is a rotate. Two adjacent `add`s (or `xor`s, or `mul`s)
      // reassociate into one — `((x+a)+b)` is `(x+(a+b))` — so a chain of one
      // operator class is worth a single instruction however long it is written.
      // A rotate between them distributes over none of the three, which is what
      // makes the emitted length proportional to `opsPerFunction` rather than to
      // the number of operator classes present.
      if (op % 2 === 1) {
        // Rotate distances 1..31: a rotate by 0 is a no-op and would be elided.
        body.push(0x41, ...sleb((next % 31) + 1))
        body.push(ROTL)
        continue
      }
      // Odd immediates only: an even multiplier discards low bits, and enough of
      // those in sequence is the same loss `and` was removed for.
      body.push(0x41, ...sleb((next & 0x3f) | 1))
      body.push(CHAINED_OPS[(next >>> 8) % CHAINED_OPS.length] ?? 0x6a)
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
    ...globals,
    ...exports,
    ...code,
  ])
}
