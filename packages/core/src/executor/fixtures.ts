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
const LAY_PARTITION_MAP = [
  ...i32(0), ...i32(0xa1), ...STORE8,
  ...i32(1), ...i32(0x61), ...STORE8,
  ...i32(2), ...i32(0x70), ...STORE8,
  ...i32(3), ...i32(0x44), ...STORE8,
  // mem[4..7] = partition() >>> 16 — the shard index, little-endian i32
  ...i32(4),
  0x10, 0x03,
  ...i32(16), SHR_U,
  0x36, 0x00, 0x00, // i32.store align=0 offset=0
]

/** `output_write(ptr, len)` — the call, so a module can make several of them. */
const WRITE = (ptr: number, len: number): number[] => [...i32(ptr), ...i32(len), 0x10, 0x02]

export const MODULE_WRITES_PARTITION: Uint8Array<ArrayBuffer> = build([
  ...LAY_PARTITION_MAP,
  ...WRITE(0, 8),
])

/**
 * The same `{"p": <4-byte LE>}` shape, carrying **the input's own byte count** — MR-02.
 *
 * **Why a second fixture rather than a flag on the first.** `MODULE_WRITES_PARTITION`
 * emits a number the *host* supplied: the shard's position in the job. That is exactly
 * right for every test about placement, dispatch and topology, and exactly wrong for the
 * one claim MR-02 makes, which is that **an owner computes a partial over its own data**.
 * A partial derived from the partition index is a pure function of an integer the
 * requestor already holds, so a job whose guests never read a byte of anyone's row would
 * produce the identical aggregate — and the sovereignty reading built on it would be
 * measuring nothing. This guest reads the row.
 *
 * It is also the smallest honest summary: `input_len()` is one call, the answer is four
 * bytes wide regardless of how large the row is, and **no byte of the row is in the
 * output**. That is the map-side half of *nothing raw leaves* stated as a property of the
 * guest rather than as a hope about it — an aggregation over these partials is an
 * aggregation over row sizes, and row sizes are not rows.
 *
 * Deliberately **not** `MODULE_ECHOES_INPUT`, which is the same experiment with the
 * opposite disposition: echoing a sovereign row back is precisely the frame
 * `EgressGuard.send` refuses, and it is useful as a negative rather than as a map.
 */
export const MODULE_COUNTS_INPUT_BYTES: Uint8Array<ArrayBuffer> = build([
  ...i32(0), ...i32(0xa1), ...STORE8,
  ...i32(1), ...i32(0x61), ...STORE8,
  ...i32(2), ...i32(0x70), ...STORE8,
  ...i32(3), ...i32(0x44), ...STORE8,
  // mem[4..7] = input_len() — the row's own size, little-endian i32. Same fixed-width
  // byte-string encoding as `LAY_PARTITION_MAP`, and for the identical reason: a CBOR
  // integer under 24 has to live in the type byte, so a guest emitting one would need a
  // branch and would produce a non-minimal encoding that strict DAG-CBOR rejects.
  ...i32(4),
  0x10, 0x00,
  0x36, 0x00, 0x00, // i32.store align=0 offset=0
  ...WRITE(0, 8),
])

/**
 * Writes once, over the cap, and nothing else.
 *
 * 64 bytes: comfortably inside the fixture's one 64 KiB page, so the host's
 * bounds check is not what refuses it, and far above the 8-byte cap the tests
 * that use it declare. A module that reaches the end having written nothing the
 * host would take is not the same event as one that never called `output_write`,
 * and this fixture is what tells the two apart.
 */
export const MODULE_OUTPUT_OVER_CAP: Uint8Array<ArrayBuffer> = build([...WRITE(0, 64)])

/** A valid 8-byte output, then an over-cap write. The reported instance of B11. */
export const MODULE_OUTPUT_THEN_OVER_CAP: Uint8Array<ArrayBuffer> = build([
  ...LAY_PARTITION_MAP,
  ...WRITE(0, 8),
  ...WRITE(0, 64),
])

/**
 * An over-cap write, then a valid 8-byte one — the mirror.
 *
 * The obvious fix for the case above (clear the slot on refusal) leaves this one
 * returning `ok: true`, so a module can spend its refusal and then launder it.
 */
export const MODULE_OVER_CAP_THEN_OUTPUT: Uint8Array<ArrayBuffer> = build([
  ...LAY_PARTITION_MAP,
  ...WRITE(0, 64),
  ...WRITE(0, 8),
])

/**
 * Declares a negative length.
 *
 * `len` arrives as a wasm `i32`, so negative is representable at the ABI. It is a
 * malformed call and not a policy bound, and an operator must be able to tell the
 * two apart from the reason alone.
 */
export const MODULE_OUTPUT_NEGATIVE_LENGTH: Uint8Array<ArrayBuffer> = build([...WRITE(0, -1)])

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
