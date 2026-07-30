/**
 * Hand-assembled WASM test modules.
 *
 * Built as raw bytes rather than compiled from WAT so the tests need no build
 * step and no toolchain dependency. Every fixture is asserted against
 * `WebAssembly.validate` in the test file — that is what proves the assembly is
 * genuinely correct, rather than merely accepted by our own admission gate.
 */

const utf8 = (s: string): number[] => [s.length, ...[...s].map((c) => c.charCodeAt(0))]

/** Unsigned LEB128 — section and body sizes can exceed 127. */
function uleb(n: number): number[] {
  const out: number[] = []
  let v = n
  do {
    let byte = v & 0x7f
    v >>>= 7
    if (v !== 0) byte |= 0x80
    out.push(byte)
  } while (v !== 0)
  return out
}

/**
 * Signed LEB128 — `i32.const` immediates are *signed*, so a value like 161
 * encodes as `A1 01`, not the bare `A1` (which sets the continuation bit and
 * would swallow the following opcode).
 */
function sleb(n: number): number[] {
  const out: number[] = []
  let v = n
  for (;;) {
    const byte = v & 0x7f
    v >>= 7
    const signBitSet = (byte & 0x40) !== 0
    if ((v === 0 && !signBitSet) || (v === -1 && signBitSet)) {
      out.push(byte)
      return out
    }
    out.push(byte | 0x80)
  }
}

/** `i32.const n` */
const i32 = (n: number): number[] => [0x41, ...sleb(n)]

const section = (id: number, payload: number[]): number[] => [id, ...uleb(payload.length), ...payload]

const HEADER = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]

// Host ABI function types.
const T_VOID_TO_I32 = [0x60, 0x00, 0x01, 0x7f] //  () -> i32
const T_I32I32_TO_I32 = [0x60, 0x02, 0x7f, 0x7f, 0x01, 0x7f] // (i32,i32) -> i32
const T_I32I32_TO_VOID = [0x60, 0x02, 0x7f, 0x7f, 0x00] // (i32,i32) -> ()
const T_VOID_TO_VOID = [0x60, 0x00, 0x00] //  () -> ()

const TYPES = section(1, [
  0x04,
  ...T_VOID_TO_I32,
  ...T_I32I32_TO_I32,
  ...T_I32I32_TO_VOID,
  ...T_VOID_TO_VOID,
])

/** The four host imports, in ABI order — func indices 0..3. */
const IMPORTS = section(2, [
  0x04,
  ...utf8('o2'), ...utf8('input_len'), 0x00, 0x00,
  ...utf8('o2'), ...utf8('input_read'), 0x00, 0x01,
  ...utf8('o2'), ...utf8('output_write'), 0x00, 0x02,
  ...utf8('o2'), ...utf8('partition'), 0x00, 0x00,
])

const FUNCS = section(3, [0x01, 0x03]) // one local func of type 3: () -> ()
const MEMORY = section(5, [0x01, 0x01, 0x01, 0x01]) // flags=has-max, min=1, max=1
const EXPORTS = section(7, [
  0x02,
  ...utf8('run'), 0x00, 0x04, // func 4 = first non-imported function
  ...utf8('memory'), 0x02, 0x00,
])

const I32_LOCALS = (n: number): number[] => (n === 0 ? [0x00] : [0x01, ...uleb(n), 0x7f])

function code(body: number[], i32Locals = 0): number[] {
  const withLocals = [...I32_LOCALS(i32Locals), ...body, 0x0b] // ..., end
  return section(10, [0x01, ...uleb(withLocals.length), ...withLocals])
}

const build = (body: number[], i32Locals = 0): Uint8Array<ArrayBuffer> =>
  new Uint8Array([
    ...HEADER, ...TYPES, ...IMPORTS, ...FUNCS, ...MEMORY, ...EXPORTS,
    ...code(body, i32Locals),
  ])

const STORE8 = [0x3a, 0x00, 0x00] // i32.store8 align=0 offset=0
const SHR_U = 0x76
const LOCAL_SET_0 = [0x21, 0x00]
const LOCAL_GET_0 = [0x20, 0x00]

/**
 * Writes `{"p": <4-byte LE partitionIndex>}` as DAG-CBOR.
 *
 * The index goes out as a fixed-width **byte string**, not a CBOR integer.
 * That is deliberate: CBOR integers under 24 must be encoded in the type byte
 * itself, so a guest emitting `18 03` for the value 3 produces a non-minimal
 * encoding that strict DAG-CBOR rightly rejects. Emitting the index as four raw
 * bytes has one encoding regardless of magnitude, so the guest needs no branch —
 * which is exactly the kind of trap the codec is supposed to catch, and does.
 *
 * Prefix: `a1` (map, 1 pair), `61 70` (text "p"), `44` (byte string, length 4).
 */
export const MODULE_WRITES_PARTITION: Uint8Array<ArrayBuffer> = build([
  ...i32(0), ...i32(0xa1), ...STORE8,
  ...i32(1), ...i32(0x61), ...STORE8,
  ...i32(2), ...i32(0x70), ...STORE8,
  ...i32(3), ...i32(0x44), ...STORE8,
  // mem[4..7] = partition() >>> 16 — the shard index, little-endian i32
  ...i32(4),
  0x10, 0x03,
  ...i32(16), SHR_U,
  0x36, 0x00, 0x00, // i32.store align=0 offset=0
  // output_write(0, 8)
  ...i32(0), ...i32(8), 0x10, 0x02,
])

/**
 * Echoes its input straight back as the output.
 *
 * Needs one local: `input_read` leaves the byte count on the stack, but
 * `output_write` wants `(ptr, len)` — so the count is parked in a local and the
 * pointer pushed beneath it.
 */
export const MODULE_ECHOES_INPUT: Uint8Array<ArrayBuffer> = build(
  [
    ...i32(0), // ptr for input_read
    0x10, 0x00, // call input_len
    0x10, 0x01, // call input_read -> count
    ...LOCAL_SET_0,
    ...i32(0), // ptr for output_write
    ...LOCAL_GET_0, // len
    0x10, 0x02, // call output_write
  ],
  1,
)

/** Produces no output — the executor must report that rather than hang. */
export const MODULE_NO_OUTPUT: Uint8Array<ArrayBuffer> = build([0x01]) // nop

/** Traps immediately. */
export const MODULE_TRAPS: Uint8Array<ArrayBuffer> = build([0x00]) // unreachable

/**
 * Spins forever — `loop … br 0 … end` with no exit.
 *
 * `run()` is a synchronous call, and V8 has no fuel metering, so nothing on the
 * thread executing this can interrupt it: not a timer, not a flag, not a stop
 * button. Only killing the thread ends it. That is what makes this the only honest
 * probe for a wall-clock bound — a module that finishes on its own cannot tell a
 * deadline that fired from a deadline that was never armed.
 *
 * Shared by both tiers deliberately, so the browser probe and the Node one spin
 * identical bytes.
 */
export const MODULE_NEVER_RETURNS: Uint8Array<ArrayBuffer> = build([
  0x03, 0x40, // loop (void)
  0x0c, 0x00, // br 0
  0x0b, // end loop
])



/**
 * Imports `env.now`, which the host does not provide.
 *
 * No allow-list check is needed for this: `WebAssembly.instantiate` refuses the
 * module with a TypeError naming the import. The runtime is the sandbox.
 */
export const MODULE_IMPORTS_CLOCK: Uint8Array<ArrayBuffer> = new Uint8Array([
  ...HEADER,
  ...TYPES,
  ...section(2, [0x01, ...utf8('env'), ...utf8('now'), 0x00, 0x00]),
])
