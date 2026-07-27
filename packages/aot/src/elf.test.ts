import { describe, expect, it } from 'vitest'
import { describeRefusal, EM_AARCH64, screenElf } from './elf.ts'
import type { ElfRefusal, ElfScreening } from './elf.ts'

/**
 * AOT-01 — an unsupported binary is refused by name, never translated on a guess.
 *
 * Every refusal below is driven by a *planted* violation: an ELF that is correct in
 * every other respect, with exactly one property changed. That is what distinguishes
 * a check that fires for the stated reason from one that fires because the fixture
 * was broken in several ways at once and something happened to catch it.
 *
 * The headers are synthesised here rather than read off disk, the way
 * `@o2/core`'s WASM fixtures are, so these run unchanged in Node and in a browser
 * and need no toolchain. `elf.real.node.test.ts` points the same screen at a genuine
 * elfconv-lifted binary when one is present, because a checker validated only
 * against its own fixture generator has been validated against nothing.
 */

const ELF64_HEADER_SIZE = 64
const ELF64_PHDR_SIZE = 56
const ELF64_SHDR_SIZE = 64

const ET_REL = 1
const ET_EXEC = 2
const ET_DYN = 3

const PT_LOAD = 1
const PT_DYNAMIC = 2
const PT_INTERP = 3

const SHT_PROGBITS = 1
const SHT_SYMTAB = 2
const SHT_STRTAB = 3
const SHT_NOBITS = 8

const EM_X86_64 = 62
const SHN_XINDEX = 0xffff

interface SectionSpec {
  readonly name: string
  readonly type: number
  /** `sh_size`. Defaults to 0, which is how a hollow `.eh_frame` is planted. */
  readonly size?: number
}

interface ElfSpec {
  readonly magic?: readonly number[]
  readonly elfClass?: number
  readonly elfData?: number
  readonly type?: number
  readonly machine?: number
  readonly entry?: bigint
  /** `p_type` of each program header, in order. */
  readonly segments?: readonly number[]
  /** Written between the mandatory index-0 null section and `.shstrtab`. */
  readonly sections?: readonly SectionSpec[]
  /** Declared `e_phentsize`. The *layout* always uses the real 56. */
  readonly phentsize?: number
  /** Declared `e_shentsize`. The *layout* always uses the real 64. */
  readonly shentsize?: number
  /** Declared `e_shnum`. 0 sends the reader to the `sh_size` escape. */
  readonly shnum?: number
  /** Declared `e_shstrndx`. `SHN_XINDEX` sends the reader to the `sh_link` escape. */
  readonly shstrndx?: number
  /** Section 0's `sh_size` — where a huge `e_shnum` is really stored. */
  readonly section0Size?: number
  /** Section 0's `sh_link` — where a huge `e_shstrndx` is really stored. */
  readonly section0Link?: number
}

interface BuiltElf {
  readonly bytes: Uint8Array
  readonly phoff: number
  readonly shoff: number
  readonly strtabOffset: number
  /** Headers written, counting the index-0 null section and the trailing `.shstrtab`. */
  readonly sectionCount: number
}

/**
 * Write an ELF64 header, program header table, section header table, string table.
 *
 * The offsets come back with the bytes so a truncation test can cut the file at a
 * named boundary instead of re-deriving the layout — the arithmetic exists once, in
 * here, which is the whole point of the helper.
 *
 * Declared sizes and layout sizes are deliberately separable. `phentsize` and
 * `shentsize` change only the header *fields*, so a file can claim a stride it does
 * not have; that is the one interesting thing to do with those fields and it cannot
 * be expressed if the builder honours them when placing bytes.
 */
function buildElf(spec: ElfSpec = {}): BuiltElf {
  const segments = spec.segments ?? []
  const sections: readonly SectionSpec[] = [
    { name: '', type: 0 },
    ...(spec.sections ?? []),
    { name: '.shstrtab', type: SHT_STRTAB },
  ]

  // Offset 0 of a string table is the empty name by convention, so the table opens
  // with a NUL and every real name is appended after it.
  const strtab: number[] = [0]
  const nameOffsets = sections.map((section) => {
    if (section.name === '') return 0
    const at = strtab.length
    for (const character of section.name) strtab.push(character.charCodeAt(0))
    strtab.push(0)
    return at
  })

  const phoff = segments.length === 0 ? 0 : ELF64_HEADER_SIZE
  const shoff = ELF64_HEADER_SIZE + segments.length * ELF64_PHDR_SIZE
  const strtabOffset = shoff + sections.length * ELF64_SHDR_SIZE
  const bytes = new Uint8Array(strtabOffset + strtab.length)
  const view = new DataView(bytes.buffer)

  bytes.set(spec.magic ?? [0x7f, 0x45, 0x4c, 0x46], 0)
  view.setUint8(4, spec.elfClass ?? 2) // EI_CLASS = ELFCLASS64
  view.setUint8(5, spec.elfData ?? 1) // EI_DATA = ELFDATA2LSB
  view.setUint8(6, 1) // EI_VERSION
  view.setUint16(16, spec.type ?? ET_EXEC, true)
  view.setUint16(18, spec.machine ?? EM_AARCH64, true)
  view.setUint32(20, 1, true)
  view.setBigUint64(24, spec.entry ?? 0x400078n, true)
  view.setBigUint64(32, BigInt(phoff), true)
  view.setBigUint64(40, BigInt(shoff), true)
  view.setUint16(52, ELF64_HEADER_SIZE, true)
  view.setUint16(54, spec.phentsize ?? (segments.length === 0 ? 0 : ELF64_PHDR_SIZE), true)
  view.setUint16(56, segments.length, true)
  view.setUint16(58, spec.shentsize ?? ELF64_SHDR_SIZE, true)
  view.setUint16(60, spec.shnum ?? sections.length, true)
  view.setUint16(62, spec.shstrndx ?? sections.length - 1, true)

  segments.forEach((segmentType, index) => {
    const at = phoff + index * ELF64_PHDR_SIZE
    view.setUint32(at, segmentType, true)
    view.setUint32(at + 4, 4, true) // p_flags = PF_R
    view.setBigUint64(at + 48, 0x1000n, true) // p_align
  })

  sections.forEach((section, index) => {
    const at = shoff + index * ELF64_SHDR_SIZE
    const isNameTable = index === sections.length - 1
    view.setUint32(at, nameOffsets[index] ?? 0, true)
    view.setUint32(at + 4, section.type, true)
    view.setBigUint64(at + 24, BigInt(isNameTable ? strtabOffset : 0), true)
    view.setBigUint64(at + 32, BigInt(isNameTable ? strtab.length : (section.size ?? 0)), true)
    view.setBigUint64(at + 48, 1n, true) // sh_addralign
  })

  if (spec.section0Size !== undefined) {
    view.setBigUint64(shoff + 32, BigInt(spec.section0Size), true)
  }
  if (spec.section0Link !== undefined) view.setUint32(shoff + 40, spec.section0Link, true)

  bytes.set(strtab, strtabOffset)
  return { bytes, phoff, shoff, strtabOffset, sectionCount: sections.length }
}

/** A statically linked AArch64 executable that kept its symbols. The control. */
const STATIC_WITH_SYMTAB: ElfSpec = {
  segments: [PT_LOAD],
  sections: [
    { name: '.text', type: SHT_PROGBITS, size: 512 },
    { name: '.symtab', type: SHT_SYMTAB, size: 240 },
  ],
}

/** The same binary after `strip`, with only the unwind tables left to work from. */
const STRIPPED_WITH_EH_FRAME: ElfSpec = {
  segments: [PT_LOAD],
  sections: [
    { name: '.text', type: SHT_PROGBITS, size: 512 },
    { name: '.eh_frame', type: SHT_PROGBITS, size: 120 },
  ],
}

const screen = (spec: ElfSpec): ElfScreening => screenElf(buildElf(spec).bytes)

/** `entryPoint` is a bigint, which `JSON.stringify` throws on rather than skips. */
const replacer = (_key: string, value: unknown): unknown =>
  typeof value === 'bigint' ? value.toString() : value

/** Narrow to the refusal, failing loudly rather than silently skipping assertions. */
function refusalOf(screening: ElfScreening): ElfRefusal {
  if (screening.ok) {
    throw new Error(`expected a refusal, got facts: ${JSON.stringify(screening.facts, replacer)}`)
  }
  return screening.reason
}

/**
 * A hand-written ELF64 AArch64 executable header, byte by byte.
 *
 * Written out as literals rather than produced by {@link buildElf}, because a
 * checker tested only against the generator that feeds it has proved that two pieces
 * of this file agree with each other and nothing more. `e_shoff` is 0, so this is
 * also a real instance of the section-less case.
 */
const HAND_WRITTEN_HEADER = new Uint8Array([
  0x7f, 0x45, 0x4c, 0x46, // \x7fELF
  0x02, // EI_CLASS   = ELFCLASS64
  0x01, // EI_DATA    = ELFDATA2LSB
  0x01, // EI_VERSION = EV_CURRENT
  0x00, 0x00, // EI_OSABI, EI_ABIVERSION
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // EI_PAD
  0x02, 0x00, // e_type      = ET_EXEC
  0xb7, 0x00, // e_machine   = 183 (EM_AARCH64)
  0x01, 0x00, 0x00, 0x00, // e_version
  0x78, 0x00, 0x40, 0x00, 0x00, 0x00, 0x00, 0x00, // e_entry = 0x400078
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // e_phoff = 0
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // e_shoff = 0
  0x00, 0x00, 0x00, 0x00, // e_flags
  0x40, 0x00, // e_ehsize    = 64
  0x38, 0x00, // e_phentsize = 56
  0x00, 0x00, // e_phnum     = 0
  0x40, 0x00, // e_shentsize = 64
  0x00, 0x00, // e_shnum     = 0
  0x00, 0x00, // e_shstrndx  = 0
])

describe('the fixtures are ELF, not merely what this file believes ELF to be', () => {
  it('agrees byte for byte with a hand-written header through e_entry', () => {
    // If the builder and the hand-written literal ever diverge here, one of them is
    // wrong about the ELF64 layout, and every test below is measuring that instead.
    expect([...buildElf().bytes.slice(0, 32)]).toEqual([...HAND_WRITTEN_HEADER.slice(0, 32)])
  })

  it('is exactly 64 bytes, which is what ELF64 declares its header to be', () => {
    expect(HAND_WRITTEN_HEADER.length).toBe(64)
  })
})

describe('a binary elfconv can lift is accepted, with the facts a build log wants', () => {
  it('accepts a statically linked AArch64 executable that kept its symbol table', () => {
    const screening = screen(STATIC_WITH_SYMTAB)
    expect(screening.ok).toBe(true)
    if (!screening.ok) return
    expect(screening.facts.machine).toBe(EM_AARCH64)
    expect(screening.facts.type).toBe('exec')
    expect(screening.facts.stripped).toBe(false)
    expect(screening.facts.hasEhFrame).toBe(false)
    expect(screening.facts.sectionCount).toBe(4)
    expect(screening.facts.entryPoint).toBe(0x400078n)
    expect(screening.facts.sectionNames).toEqual(['', '.text', '.symtab', '.shstrtab'])
  })

  it('accepts a stripped executable whose .eh_frame survived', () => {
    // The recorded project assumption was that unstripped inputs were required. It
    // was wrong: elfconv recovers function entries from the unwind tables through
    // libdwarf, so refusing on `stripped` alone would have turned away every release
    // binary — and nobody investigates a build that was never attempted.
    const screening = screen(STRIPPED_WITH_EH_FRAME)
    expect(screening.ok).toBe(true)
    if (!screening.ok) return
    expect(screening.facts.stripped).toBe(true)
    expect(screening.facts.hasEhFrame).toBe(true)
  })

  it('reports stripped as a fact rather than folding it into the verdict', () => {
    // Two accepted inputs that differ in `stripped` — the field has to carry
    // information, or a later reader cannot tell which path a lift took.
    const kept = screen(STATIC_WITH_SYMTAB)
    const gone = screen(STRIPPED_WITH_EH_FRAME)
    expect(kept.ok && gone.ok).toBe(true)
    if (!kept.ok || !gone.ok) return
    expect(kept.facts.stripped).not.toBe(gone.facts.stripped)
  })

  it('accepts a binary with no program headers at all', () => {
    // A relocatable object has none. It is recorded, not refused: the enumerated
    // refusals are the inputs observed to fail *silently*, and an object file fails
    // loudly the moment elfconv looks for an entry point.
    const screening = screen({ ...STATIC_WITH_SYMTAB, segments: [], type: ET_REL })
    expect(screening.ok).toBe(true)
    if (!screening.ok) return
    expect(screening.facts.type).toBe('rel')
  })

  it('does not mistake a .bss for a truncated file', () => {
    // SHT_NOBITS declares an `sh_size` far larger than anything on disk, by design.
    // Bounds-checking every section's contents would refuse most real binaries for
    // being correctly formed.
    const screening = screen({
      ...STATIC_WITH_SYMTAB,
      sections: [
        { name: '.symtab', type: SHT_SYMTAB, size: 240 },
        { name: '.bss', type: SHT_NOBITS, size: 0x1000000 },
      ],
    })
    expect(screening.ok).toBe(true)
  })
})

describe('a file that is not an ELF is named as such, with what was there instead', () => {
  it('refuses a WASM module, the likeliest thing to arrive by mistake', () => {
    const reason = refusalOf(screenElf(new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00])))
    expect(reason.kind).toBe('not-an-elf')
    if (reason.kind !== 'not-an-elf') return
    expect(reason.found).toEqual([0x00, 0x61, 0x73, 0x6d])
  })

  it('refuses a single wrong byte in the magic', () => {
    // Planted: `\x7fELG`. Nothing else about the file is changed.
    const built = buildElf({ magic: [0x7f, 0x45, 0x4c, 0x47] })
    const reason = refusalOf(screenElf(built.bytes))
    expect(reason.kind).toBe('not-an-elf')
    if (reason.kind !== 'not-an-elf') return
    expect(reason.found).toEqual([0x7f, 0x45, 0x4c, 0x47])
  })

  it('refuses an empty buffer without reading past it', () => {
    const reason = refusalOf(screenElf(new Uint8Array(0)))
    expect(reason.kind).toBe('not-an-elf')
    if (reason.kind !== 'not-an-elf') return
    expect(reason.found).toEqual([])
    expect(describeRefusal(reason)).toContain('(empty)')
  })
})

describe('the wrong ELF flavour is named before anything is parsed out of it', () => {
  it('refuses a 32-bit ELF, carrying the EI_CLASS found', () => {
    const reason = refusalOf(screen({ elfClass: 1 })) // ELFCLASS32
    expect(reason.kind).toBe('not-64-bit')
    if (reason.kind !== 'not-64-bit') return
    expect(reason.elfClass).toBe(1)
  })

  it('refuses a big-endian ELF, carrying the EI_DATA found', () => {
    const reason = refusalOf(screen({ elfData: 2 })) // ELFDATA2MSB
    expect(reason.kind).toBe('not-little-endian')
    if (reason.kind !== 'not-little-endian') return
    expect(reason.elfData).toBe(2)
  })

  it('refuses a 32-bit ELF as 32-bit rather than as truncated', () => {
    // A 32-bit header is 52 bytes. Checking for 64 before checking EI_CLASS would
    // report a complete file as a partial one and send its author hunting a corrupt
    // download instead of a wrong `-m` flag.
    const reason = refusalOf(screenElf(buildElf({ elfClass: 1 }).bytes.slice(0, 52)))
    expect(reason.kind).toBe('not-64-bit')
  })

  it('refuses a foreign machine, carrying the value found', () => {
    const reason = refusalOf(screen({ machine: EM_X86_64 }))
    expect(reason.kind).toBe('not-aarch64')
    if (reason.kind !== 'not-aarch64') return
    expect(reason.machine).toBe(EM_X86_64)
    expect(describeRefusal(reason)).toContain('62')
  })

  it('reports an x86-64 shared object as the wrong machine, not as dynamic', () => {
    // Both are true of it. The architecture is the one worth acting on, because
    // rebuilding for aarch64 has to happen either way.
    const reason = refusalOf(
      screen({ machine: EM_X86_64, type: ET_DYN, segments: [PT_INTERP, PT_DYNAMIC] }),
    )
    expect(reason.kind).toBe('not-aarch64')
  })
})

describe('a dynamically linked binary is refused with the evidence that says so', () => {
  it('refuses on a PT_INTERP segment', () => {
    // Planted into an otherwise identical copy of the accepted control.
    const reason = refusalOf(screen({ ...STATIC_WITH_SYMTAB, segments: [PT_LOAD, PT_INTERP] }))
    expect(reason.kind).toBe('dynamically-linked')
    if (reason.kind !== 'dynamically-linked') return
    expect(reason.evidence).toEqual(['interpreter-segment'])
  })

  it('refuses on a PT_DYNAMIC segment', () => {
    const reason = refusalOf(screen({ ...STATIC_WITH_SYMTAB, segments: [PT_LOAD, PT_DYNAMIC] }))
    expect(reason.kind).toBe('dynamically-linked')
    if (reason.kind !== 'dynamically-linked') return
    expect(reason.evidence).toEqual(['dynamic-segment'])
  })

  it('refuses a static-PIE on e_type alone', () => {
    // This is the expensive one. No interpreter, nothing in the dynamic segment
    // worth the name — it reads as static, and elfconv aborts on it with exit 134
    // and no explanation whatsoever.
    const reason = refusalOf(screen({ ...STATIC_WITH_SYMTAB, type: ET_DYN }))
    expect(reason.kind).toBe('dynamically-linked')
    if (reason.kind !== 'dynamically-linked') return
    expect(reason.evidence).toEqual(['shared-object-type'])
  })

  it('carries every applicable reason, not the first one hit', () => {
    // A PIE presents all three, and "drop -pie" versus "drop -pie and relink
    // statically" are different fixes. Stopping at the first match sends half of
    // these to the wrong one.
    const reason = refusalOf(
      screen({ ...STATIC_WITH_SYMTAB, type: ET_DYN, segments: [PT_INTERP, PT_LOAD, PT_DYNAMIC] }),
    )
    expect(reason.kind).toBe('dynamically-linked')
    if (reason.kind !== 'dynamically-linked') return
    expect([...reason.evidence].sort()).toEqual([
      'dynamic-segment',
      'interpreter-segment',
      'shared-object-type',
    ])
  })

  it('names each reason once however many segments carry it', () => {
    // A linker emits one PT_INTERP, but nothing in the format forbids two, and a
    // reason listed twice reads as two distinct findings to whoever gets the log.
    const reason = refusalOf(screen({ ...STATIC_WITH_SYMTAB, segments: [PT_INTERP, PT_INTERP] }))
    expect(reason.kind).toBe('dynamically-linked')
    if (reason.kind !== 'dynamically-linked') return
    expect(reason.evidence).toEqual(['interpreter-segment'])
  })

  it('finds PT_INTERP even when the file declares no program header stride', () => {
    // `e_phentsize` of 0 is malformed. Falling back to 56 keeps the segment scan
    // working; treating the stride as 0 would read the same header n times and,
    // worse, could stride past the interpreter entry entirely.
    const reason = refusalOf(
      screen({ ...STATIC_WITH_SYMTAB, segments: [PT_LOAD, PT_INTERP], phentsize: 0 }),
    )
    expect(reason.kind).toBe('dynamically-linked')
  })

  it('does not invent evidence in a file with no segments', () => {
    expect(screen({ ...STATIC_WITH_SYMTAB, segments: [] }).ok).toBe(true)
  })
})

describe('stripping is only fatal when the unwind tables went with it', () => {
  it('refuses a binary with neither .symtab nor .eh_frame, listing what it had', () => {
    const reason = refusalOf(
      screen({ segments: [PT_LOAD], sections: [{ name: '.text', type: SHT_PROGBITS, size: 512 }] }),
    )
    expect(reason.kind).toBe('stripped-without-unwind-tables')
    if (reason.kind !== 'stripped-without-unwind-tables') return
    expect(reason.sectionNames).toEqual(['', '.text', '.shstrtab'])
  })

  it('refuses a hollow .eh_frame, which has no entries to recover from', () => {
    // Planted: the section header is present and correctly named, and `sh_size` is
    // 0. Checking presence rather than size would admit exactly the input elfconv
    // hard-errors on, while reporting that the safeguard held.
    const reason = refusalOf(
      screen({
        segments: [PT_LOAD],
        sections: [
          { name: '.text', type: SHT_PROGBITS, size: 512 },
          { name: '.eh_frame', type: SHT_PROGBITS, size: 0 },
        ],
      }),
    )
    expect(reason.kind).toBe('stripped-without-unwind-tables')
  })

  it('refuses a binary with its section headers removed entirely', () => {
    // `e_shoff` of 0. The hand-written header is one, so this case is proved against
    // a fixture the builder did not produce.
    const reason = refusalOf(screenElf(HAND_WRITTEN_HEADER))
    expect(reason.kind).toBe('stripped-without-unwind-tables')
    if (reason.kind !== 'stripped-without-unwind-tables') return
    expect(reason.sectionNames).toEqual([])
    expect(describeRefusal(reason)).toContain('none named')
  })

  it('is satisfied by .symtab alone and by .eh_frame alone', () => {
    // The refusal is the conjunction. Either survivor is enough, and asserting both
    // directions is what stops a later edit turning the `&&` into an `||`.
    expect(screen(STATIC_WITH_SYMTAB).ok).toBe(true)
    expect(screen(STRIPPED_WITH_EH_FRAME).ok).toBe(true)
  })
})

describe('a file that lies about its own extent is refused, never read past', () => {
  it('names e-ident when the file stops inside the identification bytes', () => {
    const reason = refusalOf(screenElf(buildElf().bytes.slice(0, 6)))
    expect(reason.kind).toBe('truncated')
    if (reason.kind !== 'truncated') return
    expect(reason.region).toBe('e-ident')
    expect(reason.needed).toBe(16n)
    expect(reason.actual).toBe(6)
  })

  it('names elf-header when the file stops inside the ELF64 header', () => {
    const reason = refusalOf(screenElf(buildElf().bytes.slice(0, 40)))
    expect(reason.kind).toBe('truncated')
    if (reason.kind !== 'truncated') return
    expect(reason.region).toBe('elf-header')
    expect(reason.needed).toBe(64n)
    expect(reason.actual).toBe(40)
  })

  it('names the program header table when it runs off the end', () => {
    const built = buildElf({ ...STATIC_WITH_SYMTAB, segments: [PT_LOAD, PT_LOAD] })
    const cut = built.bytes.slice(0, built.phoff + ELF64_PHDR_SIZE) // one of two headers
    const reason = refusalOf(screenElf(cut))
    expect(reason.kind).toBe('truncated')
    if (reason.kind !== 'truncated') return
    expect(reason.region).toBe('program-header-table')
    expect(reason.needed).toBe(176n) // 64 header + 2 × 56
    expect(reason.actual).toBe(120)
  })

  it('names the program header table when the declared stride overruns the file', () => {
    // Planted: `e_phentsize` of 4096 on a file laid out for 56. The declared stride
    // is honoured deliberately — striding by the constant instead would read
    // `p_type` out of a neighbouring header and could *admit* a dynamic binary.
    const reason = refusalOf(screen({ ...STATIC_WITH_SYMTAB, phentsize: 4096 }))
    expect(reason.kind).toBe('truncated')
    if (reason.kind !== 'truncated') return
    expect(reason.region).toBe('program-header-table')
  })

  it('does not read a program header out of bytes the file does not hold', () => {
    // Declared stride 1, cut one byte after the table starts: the table's *declared*
    // extent fits in the file while the header it describes does not. Reading
    // `p_type` as 32 bits over the end and padding with zeroes would decide the
    // segment type from a single available byte — here that reconstructs PT_INTERP
    // by luck of little-endian and a small value, and on a larger `p_type` it would
    // invent a different type entirely. The honest answer is that the file is short.
    const built = buildElf({ ...STATIC_WITH_SYMTAB, segments: [PT_INTERP], phentsize: 1 })
    const reason = refusalOf(screenElf(built.bytes.slice(0, built.phoff + 1)))
    expect(reason.kind).toBe('truncated')
  })

  it('names the section header table when it starts past the end', () => {
    const built = buildElf(STATIC_WITH_SYMTAB)
    const reason = refusalOf(screenElf(built.bytes.slice(0, built.shoff + 8)))
    expect(reason.kind).toBe('truncated')
    if (reason.kind !== 'truncated') return
    expect(reason.region).toBe('section-header-table')
  })

  it('names the section header table when only some of its entries are present', () => {
    const built = buildElf(STATIC_WITH_SYMTAB)
    const cut = built.bytes.slice(0, built.shoff + 2 * ELF64_SHDR_SIZE) // 2 of 4
    const reason = refusalOf(screenElf(cut))
    expect(reason.kind).toBe('truncated')
    if (reason.kind !== 'truncated') return
    expect(reason.region).toBe('section-header-table')
    expect(reason.actual).toBe(built.shoff + 128)
  })

  it('names the section name table when the names themselves are missing', () => {
    // The subtle one: every header is present and self-consistent, and only the
    // string table's bytes are gone. Reading names out of absent bytes would yield
    // the empty name for every section — losing `.symtab` and `.eh_frame` at once
    // and refusing a perfectly good binary as stripped.
    const built = buildElf(STATIC_WITH_SYMTAB)
    const reason = refusalOf(screenElf(built.bytes.slice(0, built.strtabOffset)))
    expect(reason.kind).toBe('truncated')
    if (reason.kind !== 'truncated') return
    expect(reason.region).toBe('section-name-table')
  })

  it('names the table when e_shnum sends the reader to a section that is not there', () => {
    // With the count escape in play, a section header table starting past the end
    // reads as *zero* sections rather than as an error — and zero sections is
    // refused as stripped. Bounds-checking section 0 before borrowing its fields is
    // what keeps the reason honest, and the reason is the whole deliverable here.
    const built = buildElf({ ...STATIC_WITH_SYMTAB, shnum: 0, section0Size: 4 })
    const reason = refusalOf(screenElf(built.bytes.slice(0, built.shoff + 8)))
    expect(reason.kind).toBe('truncated')
    if (reason.kind !== 'truncated') return
    expect(reason.region).toBe('section-header-table')
  })

  it('does not invent a section list from a count that is only half present', () => {
    // The verdict is the same either way here; the *evidence* is not. Reading the
    // borrowed count as 64 bits over the end of the file yields four sections, and
    // the refusal would then list four sections in a file whose section header table
    // is not there — a build log confidently describing something nobody has.
    const built = buildElf({ ...STATIC_WITH_SYMTAB, shentsize: 8, shnum: 0, section0Size: 4 })
    // Three bytes into the eight-byte `sh_size` field the count is borrowed from.
    const reason = refusalOf(screenElf(built.bytes.slice(0, built.shoff + 32 + 3)))
    expect(reason.kind).toBe('stripped-without-unwind-tables')
    if (reason.kind !== 'stripped-without-unwind-tables') return
    expect(reason.sectionNames).toEqual([])
  })

  it('returns a verdict for every prefix of a valid binary, and accepts none', () => {
    // Truncation is the commonest corruption and the cheapest fuzz there is. Every
    // prefix must produce a value rather than an exception, and none may be
    // accepted: a partial file that screened clean would be handed to a two-minute
    // container run that could not possibly succeed.
    const complete = buildElf(STATIC_WITH_SYMTAB).bytes
    for (let length = 0; length < complete.length; length++) {
      expect(screenElf(complete.slice(0, length)).ok, `${length} bytes`).toBe(false)
    }
    expect(screenElf(complete).ok).toBe(true)
  })

  it('calls an absurd e_shoff truncated rather than reading zero sections from it', () => {
    // One flipped high byte, which is what a corrupt download looks like. The
    // failure this guards is not a crash — it is the *wrong reason*: indexing at
    // `Number(e_shoff)` without checking first yields `undefined` from every read,
    // which collapses to zero sections and gets refused as stripped. The file would
    // then be reported as needing a rebuild when what it needs is a re-download.
    const built = buildElf(STATIC_WITH_SYMTAB)
    new DataView(built.bytes.buffer).setBigUint64(40, 0xffff_ffff_ffff_fff0n, true)
    const reason = refusalOf(screenElf(built.bytes))
    expect(reason.kind).toBe('truncated')
    if (reason.kind !== 'truncated') return
    expect(reason.region).toBe('section-header-table')
  })
})

describe('the escapes for very large section counts resolve rather than mislead', () => {
  it('reads the real section count out of section 0 when e_shnum is 0', () => {
    // A file with 65,280+ sections stores the count in section 0's `sh_size`. Not
    // resolving it yields zero sections, which is refused as stripped — a wrong
    // answer in the shape of a right one.
    const built = buildElf({ ...STATIC_WITH_SYMTAB, shnum: 0, section0Size: 4 })
    const screening = screenElf(built.bytes)
    expect(screening.ok).toBe(true)
    if (!screening.ok) return
    expect(screening.facts.sectionCount).toBe(4)
    expect(screening.facts.sectionNames).toContain('.symtab')
  })

  it('reads the real string table index out of section 0 on SHN_XINDEX', () => {
    const built = buildElf({ ...STATIC_WITH_SYMTAB, shstrndx: SHN_XINDEX, section0Link: 3 })
    const screening = screenElf(built.bytes)
    expect(screening.ok).toBe(true)
    if (!screening.ok) return
    expect(screening.facts.sectionNames).toEqual(['', '.text', '.symtab', '.shstrtab'])
  })

  it('falls back to 64 when the file declares no section header stride', () => {
    const screening = screenElf(buildElf({ ...STATIC_WITH_SYMTAB, shentsize: 0 }).bytes)
    expect(screening.ok).toBe(true)
    if (!screening.ok) return
    expect(screening.facts.sectionNames).toContain('.symtab')
  })
})

/**
 * One instance of every refusal, keyed by the discriminant it is an instance of.
 *
 * This was a bare array with a comment claiming the checks below "cannot drift". A
 * comment is not a check: adding a variant to {@link ElfRefusal} and forgetting to
 * add it here left the list quietly short, and both tests below went on passing over
 * the subset — a suite reporting full coverage of a set it no longer knows the size
 * of. `elf.ts` publishes no enumeration to derive the list from; `ElfRefusal` is a
 * union of object types with no `as const` array behind it, and inventing one there
 * is not this file's call to make.
 *
 * So the check is made at the type level instead. The mapped type has exactly one
 * *required* property per union member, so a new variant makes this object stop
 * compiling with the missing key named; `Extract` pins each value to the variant its
 * key announces, so the wrong shape under a right key does not compile either. That
 * makes `tsc --noEmit` load-bearing for this file rather than incidental to it —
 * which is the trade, and it is the right one: the alternative is a runtime count
 * that has to be updated by the same hand that forgot the entry.
 */
const ONE_OF_EACH_REFUSAL: {
  readonly [K in ElfRefusal['kind']]: Extract<ElfRefusal, { kind: K }>
} = {
  'not-an-elf': { kind: 'not-an-elf', found: [0x00, 0x61, 0x73, 0x6d] },
  'not-64-bit': { kind: 'not-64-bit', elfClass: 1 },
  'not-little-endian': { kind: 'not-little-endian', elfData: 2 },
  'not-aarch64': { kind: 'not-aarch64', machine: EM_X86_64 },
  'dynamically-linked': { kind: 'dynamically-linked', evidence: ['interpreter-segment'] },
  'stripped-without-unwind-tables': {
    kind: 'stripped-without-unwind-tables',
    sectionNames: ['', '.text'],
  },
  truncated: { kind: 'truncated', region: 'section-name-table', needed: 4096n, actual: 900 },
}

/** Derived, never hand-listed — that is the whole point of the object above. */
const EVERY_REFUSAL: readonly ElfRefusal[] = Object.values(ONE_OF_EACH_REFUSAL)

describe('a refusal tells a person what to do next', () => {
  it('carries one instance of every refusal the union declares, under its own kind', () => {
    // Not asserted against a count — a count is the same hand-maintained list in a
    // different shape, and it drifts the same way. Exhaustiveness is enforced by the
    // mapped type on ONE_OF_EACH_REFUSAL and is checked by `tsc --noEmit`; what this
    // adds is that the derivation to an array kept every entry, in its own slot.
    expect(EVERY_REFUSAL.map((reason) => reason.kind)).toEqual(Object.keys(ONE_OF_EACH_REFUSAL))
  })

  it('describes every refusal in one actionable sentence', () => {
    for (const reason of EVERY_REFUSAL) {
      const sentence = describeRefusal(reason)
      expect(sentence.length, reason.kind).toBeGreaterThan(20)
      // One line. This goes into a build log line and into a UI toast, and both
      // truncate at the first line break — a reason split across lines loses its
      // second half exactly where the actionable part lives.
      expect(sentence, reason.kind).not.toContain('\n')
    }
  })

  it('gives every refusal a distinct sentence', () => {
    // A shared sentence means two reasons a reader cannot tell apart, which defeats
    // the point of naming them separately in the first place.
    const sentences = EVERY_REFUSAL.map(describeRefusal)
    expect(new Set(sentences).size).toBe(EVERY_REFUSAL.length)
  })

  it('names the fix for the two refusals a rebuild can clear', () => {
    const dynamic = describeRefusal({
      kind: 'dynamically-linked',
      evidence: ['shared-object-type'],
    })
    expect(dynamic).toContain('-static')
    expect(dynamic).toContain('-pie')

    const stripped = describeRefusal({
      kind: 'stripped-without-unwind-tables',
      sectionNames: ['', '.text'],
    })
    expect(stripped).toContain('.eh_frame')
  })

  it('quotes the evidence rather than merely asserting the verdict', () => {
    // A refusal a person cannot check against their own file is one they route
    // around instead of fixing.
    expect(describeRefusal({ kind: 'not-aarch64', machine: 3 })).toContain('183')
    expect(
      describeRefusal({ kind: 'truncated', region: 'elf-header', needed: 64n, actual: 12 }),
    ).toContain('12')
  })
})
