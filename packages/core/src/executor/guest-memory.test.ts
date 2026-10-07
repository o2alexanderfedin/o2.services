import { describe, expect, it } from 'vitest'
import {
  checkMemoryCap,
  DEFAULT_MAX_MEMORY_PAGES,
  describeMemoryRefusal,
  readDeclaredMemories,
  assertMemoryCap,
} from './guest-memory.ts'
import {
  MODULE_ECHOES_INPUT,
  MODULE_IMPORTS_CLOCK,
  MODULE_METERED,
  moduleEchoImportingMemory,
  moduleEchoWithMemory,
} from './fixtures.ts'

describe('the fixtures this file relies on are valid WebAssembly', () => {
  it('validates every memory shape used below', () => {
    for (const bytes of [
      moduleEchoWithMemory(1, null),
      moduleEchoWithMemory(1, DEFAULT_MAX_MEMORY_PAGES),
      moduleEchoWithMemory(1, DEFAULT_MAX_MEMORY_PAGES + 1),
      moduleEchoImportingMemory(1, null),
      moduleEchoImportingMemory(1, 2),
    ]) {
      expect(WebAssembly.validate(bytes)).toBe(true)
    }
  })
})

describe('readDeclaredMemories — the limits a module declares, read from its bytes', () => {
  it('reads a defined memory with a maximum', () => {
    expect(readDeclaredMemories(MODULE_METERED)).toEqual([
      { origin: 'defined', minimumPages: 1, maximumPages: 3 },
    ])
  })

  it('reads a defined memory with no maximum as null, not as zero', () => {
    expect(readDeclaredMemories(moduleEchoWithMemory(2, null))).toEqual([
      { origin: 'defined', minimumPages: 2, maximumPages: null },
    ])
  })

  it('reads an imported memory past four function imports, and names it', () => {
    expect(readDeclaredMemories(moduleEchoImportingMemory(1, 5))).toEqual([
      { origin: 'imported', importName: 'o2.memory', minimumPages: 1, maximumPages: 5 },
    ])
  })

  it('reads a multi-byte page count', () => {
    expect(readDeclaredMemories(moduleEchoWithMemory(300, 70000))[0]?.maximumPages).toBe(70000)
  })

  it('finds no memory in a module that declares none', () => {
    expect(readDeclaredMemories(MODULE_IMPORTS_CLOCK)).toEqual([])
  })
})

describe('checkMemoryCap — a node refuses a guest that could grow without bound', () => {
  it('uses 256 MiB, the per-task budget the research chose, as the default cap', () => {
    expect(DEFAULT_MAX_MEMORY_PAGES).toBe(4096)
  })

  it('admits the fixtures every other test runs', () => {
    expect(checkMemoryCap(MODULE_ECHOES_INPUT)).toEqual({ ok: true })
    expect(checkMemoryCap(MODULE_METERED)).toEqual({ ok: true })
  })

  it('refuses a defined memory with no maximum', () => {
    expect(checkMemoryCap(moduleEchoWithMemory(1, null))).toEqual({
      ok: false,
      refusal: { kind: 'memory-uncapped', memory: { origin: 'defined', minimumPages: 1, maximumPages: null } },
    })
  })

  it('admits a maximum exactly at the cap and refuses one page above it', () => {
    expect(checkMemoryCap(moduleEchoWithMemory(1, 4096), 4096)).toEqual({ ok: true })
    expect(checkMemoryCap(moduleEchoWithMemory(1, 4097), 4096)).toEqual({
      ok: false,
      refusal: {
        kind: 'memory-over-cap',
        memory: { origin: 'defined', minimumPages: 1, maximumPages: 4097 },
        capPages: 4096,
      },
    })
  })

  it('holds an imported memory to the same rule — no maximum is refused', () => {
    const verdict = checkMemoryCap(moduleEchoImportingMemory(1, null))
    expect(verdict.ok).toBe(false)
    if (verdict.ok) return
    expect(verdict.refusal.kind).toBe('memory-uncapped')
    expect(describeMemoryRefusal(verdict.refusal)).toContain('imports as o2.memory')
  })

  it('holds an imported memory to the same rule — above the cap is refused', () => {
    const verdict = checkMemoryCap(moduleEchoImportingMemory(1, 9), 8)
    expect(verdict.ok ? 'admitted' : verdict.refusal.kind).toBe('memory-over-cap')
    expect(checkMemoryCap(moduleEchoImportingMemory(1, 8), 8)).toEqual({ ok: true })
  })

  it('refuses rather than admits a declaration it cannot read', () => {
    const truncated = moduleEchoWithMemory(1, 2).subarray(0, 40)
    const verdict = checkMemoryCap(truncated)
    expect(verdict.ok ? 'admitted' : verdict.refusal.kind).toBe('memory-unreadable')
  })

  it('admits a memory with no maximum when the caller says so, defined or imported (#47)', () => {
    expect(checkMemoryCap(moduleEchoWithMemory(1, null), DEFAULT_MAX_MEMORY_PAGES, { uncapped: 'admit' })).toEqual({
      ok: true,
    })
    expect(checkMemoryCap(moduleEchoImportingMemory(1, null), DEFAULT_MAX_MEMORY_PAGES, { uncapped: 'admit' })).toEqual(
      { ok: true },
    )
  })

  it('still refuses above the cap and an unreadable declaration when uncapped memory is admitted', () => {
    const admit = { uncapped: 'admit' } as const
    const over = checkMemoryCap(moduleEchoWithMemory(1, 4097), 4096, admit)
    expect(over.ok ? 'admitted' : over.refusal.kind).toBe('memory-over-cap')
    const unreadable = checkMemoryCap(moduleEchoWithMemory(1, 2).subarray(0, 40), 4096, admit)
    expect(unreadable.ok ? 'admitted' : unreadable.refusal.kind).toBe('memory-unreadable')
  })

  it('opens every refusal with its kind, so one grep finds it from either executor', () => {
    const uncapped = checkMemoryCap(moduleEchoWithMemory(1, null))
    const over = checkMemoryCap(moduleEchoWithMemory(1, 4097))
    if (uncapped.ok || over.ok) throw new Error('both should be refused')
    expect(describeMemoryRefusal(uncapped.refusal)).toMatch(/^memory-uncapped: .*no maximum/)
    expect(describeMemoryRefusal(over.refusal)).toMatch(/^memory-over-cap: .*4097 pages .*cap of 4096 pages \(256 MiB\)/)
  })
})

describe('assertMemoryCap — a cap an executor can hold', () => {
  it('accepts 1 through 65536 pages and rejects anything else at construction', () => {
    expect(assertMemoryCap(1)).toBe(1)
    expect(assertMemoryCap(65536)).toBe(65536)
    for (const bad of [0, -1, 1.5, 65537, Number.NaN]) {
      expect(() => assertMemoryCap(bad)).toThrow(RangeError)
    }
  })
})
