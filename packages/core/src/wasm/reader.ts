/**
 * Bounds-checked cursor over a WASM binary.
 *
 * Every read is checked against the buffer length before dereferencing. A read
 * past the end returns an error rather than throwing or returning garbage — a
 * malformed module must never be able to crash an executor (threat T-1-01).
 *
 * LEB128 decoding is deliberately permissive about encoding length: the spec
 * requires minimal encodings and engines reject non-minimal ones, but the
 * admission gate must not depend on the engine catching that first, or a
 * forbidden opcode hidden behind an overlong encoding would slip past
 * (threat T-1-03).
 */

export type ReadError =
  | { kind: 'out-of-bounds'; offset: number; needed: number; length: number }
  | { kind: 'leb-overflow'; offset: number }

export type ReadResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ReadError }

const ok = <T>(value: T): ReadResult<T> => ({ ok: true, value })
const err = <T>(error: ReadError): ReadResult<T> => ({ ok: false, error })

export class Reader {
  readonly bytes: Uint8Array
  #offset: number

  constructor(bytes: Uint8Array, offset = 0) {
    this.bytes = bytes
    this.#offset = offset
  }

  get offset(): number {
    return this.#offset
  }

  get remaining(): number {
    return this.bytes.length - this.#offset
  }

  get atEnd(): boolean {
    return this.#offset >= this.bytes.length
  }

  seek(offset: number): void {
    this.#offset = offset
  }

  /** Read one byte. */
  u8(): ReadResult<number> {
    if (this.#offset + 1 > this.bytes.length) {
      return err({
        kind: 'out-of-bounds',
        offset: this.#offset,
        needed: 1,
        length: this.bytes.length,
      })
    }
    // Checked above; noUncheckedIndexedAccess still widens the type.
    const byte = this.bytes[this.#offset] as number
    this.#offset += 1
    return ok(byte)
  }

  /** Read `n` raw bytes as a subarray view (no copy). */
  take(n: number): ReadResult<Uint8Array> {
    if (n < 0 || this.#offset + n > this.bytes.length) {
      return err({
        kind: 'out-of-bounds',
        offset: this.#offset,
        needed: n,
        length: this.bytes.length,
      })
    }
    const view = this.bytes.subarray(this.#offset, this.#offset + n)
    this.#offset += n
    return ok(view)
  }

  /** Skip `n` bytes. */
  skip(n: number): ReadResult<void> {
    const r = this.take(n)
    return r.ok ? ok(undefined) : err(r.error)
  }

  /**
   * Unsigned LEB128, up to 32 bits of payload.
   *
   * Accepts non-minimal encodings (extra 0x80-continued zero groups) so a
   * forbidden construct cannot hide behind an overlong encoding. Rejects only
   * encodings that would overflow 32 bits of value.
   */
  u32(): ReadResult<number> {
    const start = this.#offset
    let result = 0
    let shift = 0
    for (;;) {
      const b = this.u8()
      if (!b.ok) return err(b.error)
      const byte = b.value
      if (shift < 32) {
        result |= (byte & 0x7f) << shift
      } else if ((byte & 0x7f) !== 0) {
        // Payload bits beyond 32 that are actually set — genuinely out of range.
        return err({ kind: 'leb-overflow', offset: start })
      }
      shift += 7
      if ((byte & 0x80) === 0) break
      if (shift > 70) return err({ kind: 'leb-overflow', offset: start })
    }
    return ok(result >>> 0)
  }

  /** Signed LEB128, up to 33 bits (enough for i32 immediates and block types). */
  i33(): ReadResult<number> {
    const start = this.#offset
    let result = 0
    let shift = 0
    let byte = 0
    do {
      const b = this.u8()
      if (!b.ok) return err(b.error)
      byte = b.value
      if (shift < 32) result |= (byte & 0x7f) << shift
      shift += 7
      if (shift > 70) return err({ kind: 'leb-overflow', offset: start })
    } while ((byte & 0x80) !== 0)
    // Sign-extend if the sign bit of the last group is set.
    if (shift < 32 && (byte & 0x40) !== 0) result |= -(1 << shift)
    return ok(result)
  }

  /** Length-prefixed UTF-8 name. */
  name(): ReadResult<string> {
    const len = this.u32()
    if (!len.ok) return err(len.error)
    const raw = this.take(len.value)
    if (!raw.ok) return err(raw.error)
    return ok(new TextDecoder().decode(raw.value))
  }
}
