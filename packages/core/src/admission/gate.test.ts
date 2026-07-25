import { describe, expect, it } from 'vitest'
import { HOST_ABI_ALLOWLIST, scanModule } from './gate.ts'

// ---- minimal WASM builders -------------------------------------------------

const HEADER = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]

const section = (id: number, payload: number[]): number[] => [id, payload.length, ...payload]

/** Type section with a single `() -> ()` type. */
const TYPE_VOID = section(1, [0x01, 0x60, 0x00, 0x00])
/** Function section declaring one function of type 0. */
const FUNC_ONE = section(3, [0x01, 0x00])

/** Code section wrapping a single function body (no locals). */
function codeSection(instrs: number[]): number[] {
  const body = [0x00, ...instrs, 0x0b] // 0 local groups, instrs, end
  return section(10, [0x01, body.length, ...body])
}

const mod = (...parts: number[][]): Uint8Array => new Uint8Array([HEADER, ...parts].flat())

/** A module whose single function body is exactly `instrs`. */
const modWithBody = (instrs: number[]): Uint8Array =>
  mod(TYPE_VOID, FUNC_ONE, codeSection(instrs))

// ---- tests ----------------------------------------------------------------

describe('scanModule — header', () => {
  it('rejects a non-wasm buffer', () => {
    const r = scanModule(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.rejections[0]?.kind).toBe('bad-magic')
  })

  it('rejects an empty buffer without throwing', () => {
    expect(scanModule(new Uint8Array()).ok).toBe(false)
  })

  it('rejects an unknown binary version', () => {
    const bytes = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x09, 0x00, 0x00, 0x00])
    const r = scanModule(bytes)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.rejections[0]?.kind).toBe('bad-version')
  })

  it('accepts a bare valid module with no sections', () => {
    expect(scanModule(new Uint8Array(HEADER)).ok).toBe(true)
  })
})

describe('scanModule — forbidden instruction prefixes', () => {
  it('accepts an ordinary arithmetic body', () => {
    // i32.const 1; i32.const 2; i32.add; drop
    const r = scanModule(modWithBody([0x41, 0x01, 0x41, 0x02, 0x6a, 0x1a]))
    expect(r).toEqual({ ok: true })
  })

  it('rejects a SIMD opcode (0xFD prefix)', () => {
    // 0xFD 0x0C = v128.const — would need 16 more bytes, but we reject at the prefix.
    const r = scanModule(modWithBody([0xfd, 0x0c]))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.rejections.map((x) => x.kind)).toContain('simd')
  })

  it('rejects an atomics opcode (0xFE prefix)', () => {
    const r = scanModule(modWithBody([0xfe, 0x10]))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.rejections.map((x) => x.kind)).toContain('atomics')
  })

  it('ACCEPTS 0xFD appearing inside an f64.const immediate — a byte-grep would fail here', () => {
    // f64.const with 0xFD in its 8 raw bytes, then drop.
    const r = scanModule(
      modWithBody([0x44, 0x00, 0xfd, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x1a]),
    )
    expect(r).toEqual({ ok: true })
  })

  it('ACCEPTS 0xFE appearing inside an f32.const immediate', () => {
    const r = scanModule(modWithBody([0x43, 0xfe, 0xfe, 0xfe, 0xfe, 0x1a]))
    expect(r).toEqual({ ok: true })
  })

  it('ACCEPTS 0xFD inside an i64.const LEB immediate', () => {
    // i64.const with a multi-byte LEB whose continuation bytes include 0xFD.
    const r = scanModule(modWithBody([0x42, 0xfd, 0xfd, 0x7f, 0x1a]))
    expect(r).toEqual({ ok: true })
  })

  it('still finds a SIMD opcode that follows a float constant', () => {
    const r = scanModule(
      modWithBody([0x44, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x1a, 0xfd, 0x0c]),
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.rejections.map((x) => x.kind)).toContain('simd')
  })

  it('skips memarg immediates without mistaking them for opcodes', () => {
    // i32.const 0; i32.load align=2 offset=0xFD; drop
    const r = scanModule(modWithBody([0x41, 0x00, 0x28, 0x02, 0xfd, 0x01, 0x1a]))
    expect(r).toEqual({ ok: true })
  })

  it('skips br_table label vectors', () => {
    // block; i32.const 0; br_table [0 0] 0; end; -- labels include a 0xFD-free vector
    const r = scanModule(modWithBody([0x02, 0x40, 0x41, 0x00, 0x0e, 0x02, 0x00, 0x00, 0x00, 0x0b]))
    expect(r).toEqual({ ok: true })
  })
})

describe('scanModule — 0xFC prefix immediates must be skipped exactly', () => {
  // The bulk-memory/table prefix is permitted (it is deterministic), but its
  // immediates must be consumed with the exact arity from the binary spec. Skip
  // one byte too many and the walker swallows the FOLLOWING opcode — so a SIMD or
  // atomics instruction placed right after one of these disappears, which is a
  // false negative in a security gate. Skip one too few and the walker
  // desynchronizes and reads an index byte as an opcode.
  //
  // Arity per https://webassembly.github.io/spec/core/binary/instructions.html:
  //   0..7 none | 8 memory.init: dataidx,memidx | 9 data.drop: dataidx
  //   10 memory.copy: memidx,memidx | 11 memory.fill: memidx
  //   12 table.init: elemidx,tableidx | 13 elem.drop: elemidx
  //   14 table.copy: tableidx,tableidx | 15/16/17 table.grow/size/fill: tableidx
  const ARITY: readonly [number, number][] = [
    [0, 0], [7, 0],
    [8, 2], [9, 1], [10, 2], [11, 1],
    [12, 2], [13, 1], [14, 2], [15, 1], [16, 1], [17, 1],
  ]

  it.each(ARITY)(
    'still detects a SIMD opcode placed immediately after 0xFC %i',
    (sub, arity) => {
      const immediates = Array(arity).fill(0x00)
      const r = scanModule(modWithBody([0xfc, sub, ...immediates, 0xfd, 0x0c]))
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.rejections.map((x) => x.kind)).toContain('simd')
    },
  )

  it.each(ARITY)(
    'still detects an atomics opcode placed immediately after 0xFC %i',
    (sub, arity) => {
      const immediates = Array(arity).fill(0x00)
      const r = scanModule(modWithBody([0xfc, sub, ...immediates, 0xfe, 0x10]))
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.rejections.map((x) => x.kind)).toContain('atomics')
    },
  )

  it.each(ARITY)('accepts 0xFC %i on its own — the prefix is deterministic', (sub, arity) => {
    const immediates = Array(arity).fill(0x00)
    const r = scanModule(modWithBody([0xfc, sub, ...immediates]))
    expect(r).toEqual({ ok: true })
  })

  it('handles a multi-byte index immediate without desynchronizing', () => {
    // data.drop with a two-byte LEB dataidx (200), then SIMD.
    const r = scanModule(modWithBody([0xfc, 9, 0xc8, 0x01, 0xfd, 0x0c]))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.rejections.map((x) => x.kind)).toContain('simd')
  })

  it('rejects an unknown 0xFC subopcode rather than guessing its arity', () => {
    // 0xFC 99 is not a defined instruction. Guessing how many immediates to skip
    // is exactly how a walker desynchronizes, so refuse instead.
    const r = scanModule(modWithBody([0xfc, 99, 0x00]))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.rejections[0]?.kind).toBe('malformed')
  })
})

describe('scanModule — unknown opcodes fail closed', () => {
  // "Not in the immediates table" must mean "refuse", not "assume no immediates".
  // An unrecognised opcode that actually carries immediates would desynchronize the
  // walker, and a desynchronized walker silently stops finding forbidden
  // instructions — the exact failure the 0xFC arity bug produced.

  it('rejects the 0xFB GC-proposal prefix', () => {
    const r = scanModule(modWithBody([0xfb, 0x00]))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.rejections.map((x) => x.kind)).toContain('unknown-opcode')
  })

  it('rejects unassigned encodings, naming the opcode', () => {
    for (const op of [0x06, 0x27, 0xd3, 0xe0]) {
      const r = scanModule(modWithBody([op]))
      expect(r.ok).toBe(false)
      if (!r.ok) {
        const found = r.rejections.find((x) => x.kind === 'unknown-opcode')
        expect(found).toBeDefined()
        if (found?.kind === 'unknown-opcode') expect(found.opcode).toBe(op)
      }
    }
  })

  it('still accepts every genuinely immediate-free opcode', () => {
    // unreachable, nop, end-of-block markers, return, drop, select, ref.is_null
    for (const op of [0x00, 0x01, 0x0f, 0x1a, 0x1b, 0xd1]) {
      expect(scanModule(modWithBody([op]))).toEqual({ ok: true })
    }
  })

  it('accepts the contiguous numeric and comparison block 0x45..0xC4', () => {
    for (let op = 0x45; op <= 0xc4; op++) {
      const r = scanModule(modWithBody([op]))
      expect(r, `opcode 0x${op.toString(16)} should be accepted`).toEqual({ ok: true })
    }
  })
})

describe('scanModule — memory', () => {
  const memSection = (flags: number, min: number, max?: number): number[] =>
    section(5, max === undefined ? [0x01, flags, min] : [0x01, flags, min, max])

  it('accepts a memory whose initial equals its maximum', () => {
    expect(scanModule(mod(memSection(0x01, 1, 1))).ok).toBe(true)
  })

  it('rejects a memory with no maximum', () => {
    const r = scanModule(mod(memSection(0x00, 1)))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.rejections.map((x) => x.kind)).toContain('unbounded-memory')
  })

  it('rejects a memory whose maximum exceeds its initial', () => {
    const r = scanModule(mod(memSection(0x01, 1, 16)))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.rejections.map((x) => x.kind)).toContain('unbounded-memory')
  })

  it('rejects shared memory', () => {
    const r = scanModule(mod(memSection(0x03, 1, 1)))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.rejections.map((x) => x.kind)).toContain('shared-memory')
  })
})

describe('scanModule — imports', () => {
  const str = (s: string): number[] => [s.length, ...[...s].map((c) => c.charCodeAt(0))]
  const importFn = (m: string, n: string): number[] =>
    section(2, [0x01, ...str(m), ...str(n), 0x00, 0x00])

  it('accepts an import on the frozen host ABI', () => {
    expect(scanModule(mod(importFn('o2', 'input_len'))).ok).toBe(true)
  })

  it('rejects an import outside the allow-list, naming it', () => {
    const r = scanModule(mod(importFn('env', 'now')))
    expect(r.ok).toBe(false)
    if (!r.ok) {
      const bad = r.rejections.find((x) => x.kind === 'forbidden-import')
      expect(bad).toBeDefined()
      if (bad?.kind === 'forbidden-import') {
        expect(bad.module).toBe('env')
        expect(bad.name).toBe('now')
      }
    }
  })

  it('rejects a WASI import', () => {
    const r = scanModule(mod(importFn('wasi_snapshot_preview1', 'clock_time_get')))
    expect(r.ok).toBe(false)
  })

  it('rejects an imported shared memory', () => {
    // import kind 2 (memory) with shared flags
    const bytes = mod(
      section(2, [0x01, ...str('o2'), ...str('mem'), 0x02, 0x03, 0x01, 0x01]),
    )
    const r = scanModule(bytes)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.rejections.map((x) => x.kind)).toContain('shared-memory')
  })

  it('exposes exactly four host functions in the allow-list', () => {
    expect(HOST_ABI_ALLOWLIST).toHaveLength(4)
  })

  it('rejects an unknown import descriptor kind instead of desynchronizing', () => {
    // Kind 9 is not a defined external kind. Its descriptor length is unknown, so
    // continuing would misread the remaining imports and could let a forbidden one
    // through unchecked.
    const bytes = mod(section(2, [0x01, ...str('env'), ...str('mystery'), 0x09, 0x00]))
    const r = scanModule(bytes)
    expect(r.ok).toBe(false)
    if (!r.ok) {
      const found = r.rejections.find((x) => x.kind === 'unknown-import-kind')
      expect(found).toBeDefined()
      if (found?.kind === 'unknown-import-kind') expect(found.importKind).toBe(9)
    }
  })

  it('does not report a table import as a memory problem', () => {
    // Table import: reftype funcref (0x70), flags 0x00 (no max), min 1.
    // A table without a maximum is not `unbounded-memory` — that rule is about
    // linear-memory growth, and mislabelling it would send a reader hunting the
    // wrong construct.
    const bytes = mod(
      section(2, [0x01, ...str('o2'), ...str('input_len'), 0x01, 0x70, 0x00, 0x01]),
    )
    const r = scanModule(bytes)
    if (!r.ok) {
      expect(r.rejections.map((x) => x.kind)).not.toContain('unbounded-memory')
    }
  })
})

describe('scanModule — start section', () => {
  it('rejects a module with a start section', () => {
    // A start function runs during instantiation, before the host can resolve the
    // exported memory, so host calls from it would see none.
    const bytes = mod(section(8, [0x00]))
    const r = scanModule(bytes)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.rejections.map((x) => x.kind)).toContain('start-section')
  })
})

describe('scanModule — malformed input never throws (threat T-1-01)', () => {
  it('rejects a section claiming more bytes than remain', () => {
    const bytes = new Uint8Array([...HEADER, 0x0a, 0x7f, 0x00])
    const r = scanModule(bytes)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.rejections[0]?.kind).toBe('malformed')
  })

  it('survives every truncation of a valid module', () => {
    const full = modWithBody([0x41, 0x01, 0x1a])
    for (let i = 0; i < full.length; i++) {
      expect(() => scanModule(full.subarray(0, i))).not.toThrow()
    }
  })

  it('terminates and never throws on randomized code-section bodies', () => {
    // The instruction walker advances at least one byte per iteration on every
    // path, so it must terminate regardless of input. A hang here would show up
    // as a test timeout; a desync must still be a rejection, never a crash.
    let seed = 0x2545f491
    const next = (): number => {
      // xorshift — deterministic, so a failure is reproducible from the seed.
      seed ^= seed << 13
      seed ^= seed >>> 17
      seed ^= seed << 5
      return (seed >>> 0) & 0xff
    }
    for (let iter = 0; iter < 500; iter++) {
      const len = 1 + (next() % 40)
      const body = Array.from({ length: len }, next)
      const bytes = modWithBody(body)
      expect(() => scanModule(bytes)).not.toThrow()
    }
  })

  it('survives arbitrary garbage after a valid header', () => {
    for (let seed = 0; seed < 64; seed++) {
      const noise = new Uint8Array(24)
      for (let i = 0; i < noise.length; i++) noise[i] = (seed * 31 + i * 17) & 0xff
      const bytes = new Uint8Array([...HEADER, ...noise])
      expect(() => scanModule(bytes)).not.toThrow()
    }
  })
})
