import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * The properties of the committed ELF fixtures that elfconv's ELF loader turns on.
 *
 * This file tests **fixtures, not code**, and that is deliberate. `third_party/elfconv`'s
 * loader was ported off bfd/libdwarf/libelf onto `llvm::object::ELFObjectFile` and
 * `llvm::DWARFContext`, and the proof that the port changed nothing is a differential lift
 * (`tools/aot/elfconv-differential.node.test.ts`) whose subjects are these fixtures. That
 * proof is only as sharp as the fixtures are interesting: a fixture with no indirect
 * functions cannot catch the STT_GNU_IFUNC defect, and one with no aliased addresses cannot
 * catch a reordering.
 *
 * So this is a **guard on the guard**. If the fixture toolchain is ever regenerated and the
 * new binaries happen to carry no ifuncs, or no two symbols on one address, the differential
 * harness silently loses its teeth and every downstream verdict keeps reading green. These
 * cases go red instead, and name what was lost.
 *
 * Every number below was measured from the committed bytes, not predicted. The fixtures are
 * checked in and byte-stable, so exact equality is the right assertion here rather than a
 * ratio — there is no machine, load or clock in this measurement to cancel out.
 *
 * The reader is local to this file on purpose. `packages/aot/src/elf.ts` screens ELFs for the
 * production admission path and deliberately reads only headers, program headers and section
 * names; it has no symbol-table reader and does not need one. Growing production code to
 * serve a test would be the wrong direction.
 */

const SHT_SYMTAB = 2
const SHT_DYNSYM = 11
const STT_NOTYPE = 0
const STT_FUNC = 2
/** The type whose omission by bfd is the whole reason {@link IFUNC_COUNT} is asserted. */
const STT_GNU_IFUNC = 10

interface Section {
  readonly name: string
  readonly type: number
  readonly offset: number
  readonly size: number
  readonly link: number
  readonly entsize: number
}

interface Symbol {
  readonly name: string
  readonly type: number
  readonly value: number
  readonly size: number
}

interface ElfFixture {
  readonly sections: readonly Section[]
  readonly symtab: readonly Symbol[]
  readonly dynsym: readonly Symbol[]
}

function cstring(bytes: Buffer, at: number): string {
  let end = at
  while (end < bytes.length && bytes[end] !== 0) end++
  return bytes.toString('utf8', at, end)
}

function readSections(bytes: Buffer): readonly Section[] {
  const shoff = Number(bytes.readBigUInt64LE(0x28))
  const shentsize = bytes.readUInt16LE(0x3a)
  const shnum = bytes.readUInt16LE(0x3c)
  const shstrndx = bytes.readUInt16LE(0x3e)

  const raw = Array.from({ length: shnum }, (_unused, i) => {
    const at = shoff + i * shentsize
    return {
      nameOff: bytes.readUInt32LE(at),
      type: bytes.readUInt32LE(at + 4),
      offset: Number(bytes.readBigUInt64LE(at + 24)),
      size: Number(bytes.readBigUInt64LE(at + 32)),
      link: bytes.readUInt32LE(at + 40),
      entsize: Number(bytes.readBigUInt64LE(at + 56)),
    }
  })

  const strtab = raw[shstrndx]
  if (strtab === undefined) {
    throw new Error(`section header string table index ${shstrndx} is out of range`)
  }
  return raw.map((s) => ({
    name: cstring(bytes, strtab.offset + s.nameOff),
    type: s.type,
    offset: s.offset,
    size: s.size,
    link: s.link,
    entsize: s.entsize,
  }))
}

function readSymbols(bytes: Buffer, sections: readonly Section[], kind: number): readonly Symbol[] {
  const table = sections.find((s) => s.type === kind)
  if (table === undefined || table.entsize === 0) return []
  const strtab = sections[table.link]
  if (strtab === undefined) return []

  const count = Math.floor(table.size / table.entsize)
  return Array.from({ length: count }, (_unused, i) => {
    const at = table.offset + i * table.entsize
    return {
      name: cstring(bytes, strtab.offset + bytes.readUInt32LE(at)),
      type: (bytes[at + 4] ?? 0) & 0xf,
      value: Number(bytes.readBigUInt64LE(at + 8)),
      size: Number(bytes.readBigUInt64LE(at + 16)),
    }
  })
}

function fixture(name: string): ElfFixture {
  const path = fileURLToPath(new URL(`../../../tools/aot/fixtures/elf/${name}`, import.meta.url))
  const bytes = readFileSync(path)
  const sections = readSections(bytes)
  return {
    sections,
    symtab: readSymbols(bytes, sections, SHT_SYMTAB),
    dynsym: readSymbols(bytes, sections, SHT_DYNSYM),
  }
}

/** The loader's own filter, transcribed: STT_FUNC, or literally named `_start`. */
function pickedByLoader(elf: ElfFixture): readonly Symbol[] {
  return elf.symtab.filter((s) => s.type === STT_FUNC || s.name === '_start')
}

/**
 * The bfd-era NAME -> size map, reproduced exactly: FUNC or NOTYPE, size > 0, `.symtab`
 * then `.dynsym`, last writer wins. bfd's `asymbol` carries no size, so the loader could
 * only rejoin sizes by name; this reconstructs that join so its losses can be counted.
 */
function bfdEraSizeMap(elf: ElfFixture): ReadonlyMap<string, number> {
  const map = new Map<string, number>()
  for (const s of [...elf.symtab, ...elf.dynsym]) {
    if ((s.type === STT_FUNC || s.type === STT_NOTYPE) && s.size > 0 && s.name !== '') {
      map.set(s.name, s.size)
    }
  }
  return map
}

function hasSection(elf: ElfFixture, name: string): boolean {
  return elf.sections.some((s) => s.name === name && s.size > 0)
}

/** Measured 2026-08-07 from the committed bytes of `hello_static` and `hello_static_pie`. */
const IFUNC_COUNT = 10
/** Addresses in `hello_static` carrying more than one symbol the loader picks. */
const TIED_ADDRESS_COUNT = 176

describe('the .symtab fixture exercises the path that broke, and still can', () => {
  const elf = fixture('hello_static')

  it('has a static symbol table, so the loader takes the .symtab path and not .eh_frame', () => {
    // `symbol_table_size == 0` is exactly the loader's stripped test.
    expect(elf.symtab.length).toBeGreaterThan(1)
    expect(pickedByLoader(elf).length).toBe(1208)
  })

  it('carries STT_GNU_IFUNC symbols — the class whose mis-admission produced wrong bitcode', () => {
    // The first build of the port admitted these because bfd's source flags them
    // BSF_FUNCTION. The bfd in the build image does not, so the original loader admitted
    // none of them. Admitting 10 extra symbols shifted every later index and, through an
    // unstable sort over tied addresses, changed which alias named each lifted function --
    // while the function COUNT stayed identical. A count-only check passes that defect.
    //
    // If this ever reads 0, the differential harness can no longer catch that class at all.
    const ifuncs = elf.symtab.filter((s) => s.type === STT_GNU_IFUNC)
    expect(ifuncs.length).toBe(IFUNC_COUNT)
    expect(ifuncs.map((s) => s.name)).toContain('memcpy')

    // ...and the loader must NOT pick them, which is what makes their presence a live test.
    const picked = new Set(pickedByLoader(elf).map((s) => s.name))
    for (const ifunc of ifuncs) {
      expect(picked.has(ifunc.name)).toBe(false)
    }
  })

  it('puts several symbols on one address, so an unstable sort has ties to reorder', () => {
    const perAddress = new Map<number, number>()
    for (const s of pickedByLoader(elf)) {
      perAddress.set(s.value, (perAddress.get(s.value) ?? 0) + 1)
    }
    const tied = [...perAddress.values()].filter((n) => n > 1)
    expect(tied.length).toBe(TIED_ADDRESS_COUNT)
  })

  it('proves the bfd-era name join was lossy, which is why sizing moved to the symbol', () => {
    // bfd could not report a symbol's size, so the loader rejoined sizes by NAME. Where one
    // name occurs twice with different sizes the join returns the wrong function's length,
    // and TraceManager prefers that length over section arithmetic -- so the lifter read the
    // wrong number of bytes. Reading st_size off the symbol in hand removes the join.
    const map = bfdEraSizeMap(elf)
    const divergent = pickedByLoader(elf).filter((s) => (map.get(s.name) ?? 0) !== s.size)
    expect(divergent.length).toBeGreaterThan(0)
    expect(divergent.length).toBe(2)
  })
})

describe('the other fixtures pin the loader paths that .symtab never reaches', () => {
  it('hello_static_stripped has no symbol table but does have .eh_frame — the libdwarf path', () => {
    const elf = fixture('hello_static_stripped')
    expect(elf.symtab.length).toBe(0)
    expect(hasSection(elf, '.eh_frame')).toBe(true)
  })

  it('hello_no_unwind is the CONJUNCTION the loader must refuse: stripped AND no unwind tables', () => {
    // Recorded in CLAUDE.md against a real binary: "unstripped" was the wrong reading. A
    // binary with no .symtab lifts fine as long as .eh_frame survives. The refusal is the
    // conjunction, and this fixture is the only one that satisfies it.
    const elf = fixture('hello_no_unwind')
    expect(elf.symtab.length).toBe(0)
    expect(hasSection(elf, '.eh_frame')).toBe(false)
  })

  it('hello_static_pie carries the same ifunc population, so PIE is not a weaker subject', () => {
    const elf = fixture('hello_static_pie')
    expect(elf.symtab.filter((s) => s.type === STT_GNU_IFUNC).length).toBe(IFUNC_COUNT)
  })

  it('hello_dynamic has no ifuncs, so it cannot stand in for the static subject', () => {
    // Stated so nobody swaps the differential harness onto the cheaper fixture: this one
    // would not have caught the defect that harness caught.
    const elf = fixture('hello_dynamic')
    expect(elf.symtab.filter((s) => s.type === STT_GNU_IFUNC).length).toBe(0)
    expect(pickedByLoader(elf).length).toBe(13)
  })
})
