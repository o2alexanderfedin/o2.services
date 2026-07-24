/**
 * Module admission gate — DET-01 / DET-02.
 *
 * A task module is admissible only if its result is a pure function of its
 * declared inputs. This gate rejects the nondeterminism sources that the output
 * codec cannot handle:
 *
 *   - SIMD (`0xFD` prefix) — relaxed-SIMD results legitimately vary with hardware
 *   - threads / atomics (`0xFE` prefix) and shared memory — interleaving
 *   - imports outside a frozen allow-list — a clock or RNG defeats determinism
 *   - `memory.initial !== memory.maximum` — growth-dependent OOM divergence
 *
 * Float bit patterns are deliberately NOT this gate's problem. Output is encoded
 * with strict DAG-CBOR, which rejects `NaN`/`Infinity`/`-Infinity` and normalizes
 * `-0.0`, so no float-bit divergence can reach a hash. See `../canonical/encode.ts`.
 *
 * The code-section walk is a real instruction walk with immediate skipping. A
 * byte-scan for `0xFD`/`0xFE` would produce both false positives (those bytes
 * occur inside immediates and constants) and false negatives.
 *
 * This module is pure: no platform imports, no I/O. It runs identically at
 * publish time and inside an executor before instantiation.
 */

import { Reader } from '../wasm/reader.ts'

export type Rejection =
  | { kind: 'bad-magic'; offset: number }
  | { kind: 'bad-version'; offset: number; version: number }
  | { kind: 'malformed'; offset: number; detail: string }
  | { kind: 'simd'; offset: number }
  | { kind: 'atomics'; offset: number }
  | { kind: 'shared-memory'; offset: number }
  | { kind: 'unbounded-memory'; offset: number }
  | { kind: 'forbidden-import'; offset: number; module: string; name: string }

export type AdmissionResult =
  | { ok: true }
  | { ok: false; rejections: Rejection[] }

/** The frozen host ABI. Anything else is refused. */
export const HOST_ABI_ALLOWLIST: readonly string[] = [
  'o2.input_len',
  'o2.input_read',
  'o2.output_write',
  'o2.partition',
]

const SECTION_IMPORT = 2
const SECTION_MEMORY = 5
const SECTION_CODE = 10

const IMPORT_KIND_MEMORY = 2

/** Skip a LEB128 run of any width. */
function skipLeb(r: Reader): Rejection | null {
  for (let i = 0; i < 12; i++) {
    const b = r.u8()
    if (!b.ok) return { kind: 'malformed', offset: r.offset, detail: 'truncated LEB128' }
    if ((b.value & 0x80) === 0) return null
  }
  return { kind: 'malformed', offset: r.offset, detail: 'LEB128 too long' }
}

/**
 * Immediate shapes for single-byte opcodes, keyed by opcode.
 * `l` = one LEB, `ll` = two LEBs, `b` = one raw byte, `4`/`8` = raw bytes.
 */
const IMMEDIATES = new Map<number, 'l' | 'll' | 'b' | '4' | '8'>([
  [0x02, 'l'], [0x03, 'l'], [0x04, 'l'],            // block / loop / if — blocktype
  [0x0c, 'l'], [0x0d, 'l'],                          // br / br_if
  [0x10, 'l'],                                       // call
  [0x11, 'll'],                                      // call_indirect
  [0x20, 'l'], [0x21, 'l'], [0x22, 'l'],             // local.get/set/tee
  [0x23, 'l'], [0x24, 'l'],                          // global.get/set
  [0x25, 'l'], [0x26, 'l'],                          // table.get/set
  [0x3f, 'l'], [0x40, 'l'],                          // memory.size / memory.grow
  [0x41, 'l'], [0x42, 'l'],                          // i32.const / i64.const
  [0x43, '4'], [0x44, '8'],                          // f32.const / f64.const
  [0xd0, 'b'],                                       // ref.null
  [0xd2, 'l'],                                       // ref.func
])

/** Memory load/store opcodes carry a memarg: align + offset. */
const isMemArg = (op: number): boolean => op >= 0x28 && op <= 0x3e

/**
 * Walk one function body's instruction stream, rejecting forbidden prefixes.
 * Returns the first rejection found, or null if the body is clean.
 */
function walkBody(r: Reader, endOffset: number): Rejection | null {
  while (r.offset < endOffset) {
    const opAt = r.offset
    const op = r.u8()
    if (!op.ok) return { kind: 'malformed', offset: opAt, detail: 'truncated body' }
    const opcode = op.value

    // Forbidden prefixes — reject at the opcode position, not somewhere downstream.
    if (opcode === 0xfd) return { kind: 'simd', offset: opAt }
    if (opcode === 0xfe) return { kind: 'atomics', offset: opAt }

    // Bulk-memory / table prefix: deterministic, but its immediates must be skipped.
    if (opcode === 0xfc) {
      const sub = r.u32()
      if (!sub.ok) return { kind: 'malformed', offset: opAt, detail: '0xFC subopcode' }
      // memory.init(8)=1 LEB+1 byte, data.drop(9)=1, memory.copy(10)=2 bytes,
      // memory.fill(11)=1 byte, table.* (12..17)=1-2 LEBs. Skipping LEBs covers all
      // shapes because every immediate in this space is a LEB or a zero byte.
      const extra = sub.value === 10 ? 2 : sub.value === 11 || sub.value === 8 ? 1 : sub.value <= 7 ? 0 : 2
      for (let i = 0; i < extra; i++) {
        const e = skipLeb(r)
        if (e) return e
      }
      continue
    }

    if (isMemArg(opcode)) {
      for (let i = 0; i < 2; i++) {
        const e = skipLeb(r)
        if (e) return e
      }
      continue
    }

    // br_table: vec(labelidx) + default labelidx
    if (opcode === 0x0e) {
      const count = r.u32()
      if (!count.ok) return { kind: 'malformed', offset: opAt, detail: 'br_table count' }
      for (let i = 0; i <= count.value; i++) {
        const e = skipLeb(r)
        if (e) return e
      }
      continue
    }

    // select with explicit types: vec(valtype)
    if (opcode === 0x1c) {
      const count = r.u32()
      if (!count.ok) return { kind: 'malformed', offset: opAt, detail: 'select types' }
      const s = r.skip(count.value)
      if (!s.ok) return { kind: 'malformed', offset: opAt, detail: 'select types body' }
      continue
    }

    const shape = IMMEDIATES.get(opcode)
    if (shape === undefined) continue // no immediates
    if (shape === 'b') {
      if (!r.u8().ok) return { kind: 'malformed', offset: opAt, detail: 'byte immediate' }
    } else if (shape === '4') {
      if (!r.skip(4).ok) return { kind: 'malformed', offset: opAt, detail: 'f32 immediate' }
    } else if (shape === '8') {
      if (!r.skip(8).ok) return { kind: 'malformed', offset: opAt, detail: 'f64 immediate' }
    } else {
      const n = shape === 'll' ? 2 : 1
      for (let i = 0; i < n; i++) {
        const e = skipLeb(r)
        if (e) return e
      }
    }
  }
  return null
}

/** Parse memory limits. Flags bit 0 = has max, bit 1 = shared. */
function checkLimits(r: Reader, rejections: Rejection[]): void {
  const at = r.offset
  const flags = r.u8()
  if (!flags.ok) {
    rejections.push({ kind: 'malformed', offset: at, detail: 'memory limits flags' })
    return
  }
  const hasMax = (flags.value & 0x01) !== 0
  const shared = (flags.value & 0x02) !== 0

  const min = r.u32()
  if (!min.ok) {
    rejections.push({ kind: 'malformed', offset: at, detail: 'memory minimum' })
    return
  }
  let max: number | null = null
  if (hasMax) {
    const m = r.u32()
    if (!m.ok) {
      rejections.push({ kind: 'malformed', offset: at, detail: 'memory maximum' })
      return
    }
    max = m.value
  }

  if (shared) rejections.push({ kind: 'shared-memory', offset: at })
  if (max === null || max !== min.value) {
    rejections.push({ kind: 'unbounded-memory', offset: at })
  }
}

/**
 * Scan a WASM module for admissibility.
 *
 * Collects every rejection rather than stopping at the first, so a caller sees
 * all reasons a module was refused. Malformed input is a rejection, never a throw.
 */
export function scanModule(
  bytes: Uint8Array,
  allowlist: readonly string[] = HOST_ABI_ALLOWLIST,
): AdmissionResult {
  const rejections: Rejection[] = []
  const r = new Reader(bytes)

  const magic = r.take(4)
  if (!magic.ok) return { ok: false, rejections: [{ kind: 'bad-magic', offset: 0 }] }
  const m = magic.value
  if (m[0] !== 0x00 || m[1] !== 0x61 || m[2] !== 0x73 || m[3] !== 0x6d) {
    return { ok: false, rejections: [{ kind: 'bad-magic', offset: 0 }] }
  }
  const ver = r.take(4)
  if (!ver.ok) return { ok: false, rejections: [{ kind: 'bad-version', offset: 4, version: -1 }] }
  const v = ver.value
  const version = (v[0] as number) | ((v[1] as number) << 8) | ((v[2] as number) << 16) | ((v[3] as number) << 24)
  if (version !== 1) {
    return { ok: false, rejections: [{ kind: 'bad-version', offset: 4, version }] }
  }

  while (!r.atEnd) {
    const idAt = r.offset
    const id = r.u8()
    if (!id.ok) break
    const size = r.u32()
    if (!size.ok) {
      rejections.push({ kind: 'malformed', offset: idAt, detail: 'section size' })
      break
    }
    const bodyStart = r.offset
    const bodyEnd = bodyStart + size.value
    if (bodyEnd > bytes.length) {
      rejections.push({
        kind: 'malformed',
        offset: idAt,
        detail: `section ${id.value} claims ${size.value} bytes, ${bytes.length - bodyStart} remain`,
      })
      break
    }

    if (id.value === SECTION_IMPORT) {
      const count = r.u32()
      if (count.ok) {
        for (let i = 0; i < count.value; i++) {
          const at = r.offset
          const mod = r.name()
          const nm = r.name()
          if (!mod.ok || !nm.ok) {
            rejections.push({ kind: 'malformed', offset: at, detail: 'import name' })
            break
          }
          const kind = r.u8()
          if (!kind.ok) {
            rejections.push({ kind: 'malformed', offset: at, detail: 'import kind' })
            break
          }
          const key = `${mod.value}.${nm.value}`
          if (!allowlist.includes(key)) {
            rejections.push({
              kind: 'forbidden-import',
              offset: at,
              module: mod.value,
              name: nm.value,
            })
          }
          // Skip the kind-specific descriptor.
          if (kind.value === 0) {
            skipLeb(r) // typeidx
          } else if (kind.value === 1) {
            r.u8() // reftype
            checkLimits(r, rejections)
          } else if (kind.value === IMPORT_KIND_MEMORY) {
            checkLimits(r, rejections)
          } else if (kind.value === 3) {
            r.u8() // valtype
            r.u8() // mutability
          }
        }
      }
    } else if (id.value === SECTION_MEMORY) {
      const count = r.u32()
      if (count.ok) {
        for (let i = 0; i < count.value; i++) checkLimits(r, rejections)
      }
    } else if (id.value === SECTION_CODE) {
      const count = r.u32()
      if (count.ok) {
        for (let i = 0; i < count.value; i++) {
          const bodySize = r.u32()
          if (!bodySize.ok) {
            rejections.push({ kind: 'malformed', offset: r.offset, detail: 'body size' })
            break
          }
          const fnEnd = r.offset + bodySize.value
          if (fnEnd > bodyEnd) {
            rejections.push({ kind: 'malformed', offset: r.offset, detail: 'body overruns section' })
            break
          }
          // locals: vec(count, valtype)
          const localGroups = r.u32()
          if (!localGroups.ok) {
            rejections.push({ kind: 'malformed', offset: r.offset, detail: 'locals' })
            break
          }
          let bad = false
          for (let g = 0; g < localGroups.value; g++) {
            if (skipLeb(r) !== null || !r.u8().ok) {
              rejections.push({ kind: 'malformed', offset: r.offset, detail: 'local group' })
              bad = true
              break
            }
          }
          if (bad) break
          const rejection = walkBody(r, fnEnd)
          if (rejection) rejections.push(rejection)
          r.seek(fnEnd)
        }
      }
    }

    r.seek(bodyEnd)
  }

  return rejections.length === 0 ? { ok: true } : { ok: false, rejections }
}
