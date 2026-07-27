/**
 * Two tiny WASM modules used to probe the worker executor.
 *
 * Assembled as bytes rather than compiled, for the same reason the kernel's own
 * fixtures are: no build step, no toolchain, and every module is asserted against
 * `WebAssembly.validate` by the test that uses it — which is what proves the
 * assembly is genuinely correct rather than merely accepted by our own code.
 *
 * One emits a result immediately. The other never returns. The second is the
 * interesting one: it is the only honest way to test that stopping a node really
 * stops the work, because a task that finishes on its own cannot distinguish
 * `Worker.terminate()` from politely waiting.
 *
 * Not a test file so it can be shared by the portable and browser-only suites.
 */

const uleb = (n: number): number[] => {
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

const name = (s: string): number[] => [s.length, ...[...s].map((c) => c.charCodeAt(0))]
/** Section sizes are computed, so no hand arithmetic can be wrong. */
const section = (id: number, payload: number[]): number[] => [id, ...uleb(payload.length), ...payload]
/**
 * One function body, with its own length computed.
 *
 * Hand-counting this is what produced the first version's `section was shorter
 * than expected size` — the size byte said 6 where the body was 7. Deriving it
 * removes the only arithmetic in the file that a human was doing.
 */
const code = (body: number[]): number[] => {
  const withLocals = [0x00, ...body, 0x0b] // no locals, ..., end
  return section(10, [0x01, ...uleb(withLocals.length), ...withLocals])
}
const HEADER = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]

const T_VOID_VOID = [0x60, 0x00, 0x00]
const T_I32I32_VOID = [0x60, 0x02, 0x7f, 0x7f, 0x00]

/**
 * Writes the DAG-CBOR encoding of the integer 10 and returns.
 *
 * Ten because a CBOR unsigned integer below 24 is a single byte that *must* be
 * encoded in the type byte — so the guest needs no length prefix, and any codec
 * that accepts the output has accepted a minimal encoding.
 */
export const PROBE_EMITS_TEN: Uint8Array<ArrayBuffer> = new Uint8Array([
  ...HEADER,
  ...section(1, [0x02, ...T_VOID_VOID, ...T_I32I32_VOID]),
  ...section(2, [0x01, ...name('o2'), ...name('output_write'), 0x00, 0x01]),
  ...section(3, [0x01, 0x00]),
  ...section(5, [0x01, 0x01, 0x01, 0x01]), // one memory, min = max = 1 page
  ...section(7, [0x02, ...name('run'), 0x00, 0x01, ...name('memory'), 0x02, 0x00]),
  ...code([
    0x41, 0x00, // i32.const 0        (address)
    0x41, 0x0a, // i32.const 10       (the CBOR byte)
    0x3a, 0x00, 0x00, // i32.store8
    0x41, 0x00, // i32.const 0        (ptr)
    0x41, 0x01, // i32.const 1        (len)
    0x10, 0x00, // call output_write
  ]),
])

/**
 * Spins forever.
 *
 * `loop … br 0 … end` with no exit. Nothing on the thread running this can
 * interrupt it — which is exactly the point: only killing the thread stops it.
 */
export const PROBE_NEVER_RETURNS: Uint8Array<ArrayBuffer> = new Uint8Array([
  ...HEADER,
  ...section(1, [0x01, ...T_VOID_VOID]),
  ...section(3, [0x01, 0x00]),
  ...section(7, [0x01, ...name('run'), 0x00, 0x00]),
  ...code([
    0x03, 0x40, // loop (void)
    0x0c, 0x00, // br 0
    0x0b, // end loop
  ]),
])
