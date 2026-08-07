/**
 * Whether elfconv can be expected to consume this binary — AOT-01.
 *
 * Phase 10's first criterion asks that an unsupported input be *refused with a named
 * reason* rather than translated into a silently wrong artifact. The refusal has to
 * come from reading the ELF, because the alternative — running the toolchain and
 * interpreting what it says — does not work. elfconv's response to a dynamically
 * linked binary is
 *
 *     __wrap_main code block is not found. entry_point: 0x640
 *
 * which names neither the problem nor the input property that caused it, and which
 * is one refactor away from being different prose. A checker built on tool output
 * rots without failing: the message changes, the pattern stops matching, and the
 * gate quietly starts admitting everything. Reading `e_type` cannot rot, because the
 * ELF header is a fixed layout that predates the tool and will outlive it.
 *
 * ## Stripped is not disqualifying — the recorded assumption was wrong
 *
 * This project's notes said elfconv required unstripped binaries. Measurement says
 * otherwise: a stripped input translates fine **as long as `.eh_frame` survives**,
 * because the loader recovers function entries from the unwind tables via libdwarf.
 * Stripped *and* without `.eh_frame` is the case elfconv rejects outright. So the
 * refusal here is the conjunction, and {@link ElfFacts} reports `stripped` as a
 * *fact* rather than a verdict. Encoding the original assumption would have refused
 * a large and perfectly translatable class of input — release binaries — which is
 * the expensive kind of wrong for a gate to be, because nobody investigates a build
 * that was never attempted.
 *
 * ## This is not static determinism analysis
 *
 * A 1,214-line admission gate that predicted nondeterminism from a WASM instruction
 * stream was built, hardened, fuzzed, and deleted. The rule that replaced it stands:
 * divergence is *detected* by running a module twice and comparing bytes, never
 * predicted. Nothing here contradicts that, and the distinction is not that this
 * code reads fewer bytes — it is where a wrong answer lands. A determinism predictor
 * makes a claim about *executions that have not happened*, so being wrong means
 * shipping a wrong result that verification was supposed to catch. This predicts
 * whether a *compiler* will accept a *file*, so being wrong costs a failed build
 * that the build log then explains. Blast radius, not technique, is what separates
 * the two.
 *
 * The corollary is a boundary: this module reads ELF *headers*. It must never grow a
 * pass over the AArch64 instruction stream hunting indirect or computed jumps. That
 * is the deleted gate wearing a different architecture. Indirect jumps elfconv
 * cannot lift are caught where they are observable — it prints `[Bug] Unsupported
 * instruction at address: ...` and emits `__ecv_warning` calls into the IR — and
 * inspecting that belongs to whatever examines the *artifact*, not to a predictor
 * over the input.
 *
 * ## Malformed input is expected, not exceptional
 *
 * Every multi-byte read is bounds-checked, and every offset is compared as a
 * `bigint` because `e_shoff` is a 64-bit field that a corrupt download or a hostile
 * upload controls, and `offset + count` in `number` arithmetic silently loses
 * precision above 2^53. A file that lies about its own layout gets `truncated`,
 * naming the region that ran off the end. Nothing here throws.
 *
 * Portable: takes bytes, returns a verdict. No filesystem, no container, no platform
 * imports — the same call screens an upload in a browser tab and a file on a build
 * machine.
 */

/** `\x7fELF`. */
export const ELF_MAGIC: readonly number[] = [0x7f, 0x45, 0x4c, 0x46]

/** `EM_AARCH64`. The only machine elfconv's `aarch64-*` targets accept. */
export const EM_AARCH64 = 183

const EI_CLASS = 4
const EI_DATA = 5
/** `e_ident` is 16 bytes in every ELF class — the one region whose size is fixed. */
const EI_NIDENT = 16
/** ELF64 header size. A 32-bit header is 52, which is why the class check comes first. */
const ELF64_HEADER_SIZE = 64
const ELF64_PHDR_SIZE = 56
const ELF64_SHDR_SIZE = 64

const ELFCLASS64 = 2
const ELFDATA2LSB = 1

const PT_DYNAMIC = 2
const PT_INTERP = 3

const SHT_SYMTAB = 2

/** `e_shstrndx` escape: the real index lives in section 0's `sh_link`. */
const SHN_XINDEX = 0xffff

/** `e_type`, named. `unknown` covers the OS- and processor-specific ranges. */
export type ElfType = 'none' | 'rel' | 'exec' | 'dyn' | 'core' | 'unknown'

/**
 * A region whose declared extent ran past the end of the buffer.
 *
 * Named rather than described, so a caller can branch on it. `e-ident` on a
 * four-byte file and `section-header-table` on an interrupted download want
 * different responses, and a message string cannot be branched on without parsing
 * prose — which is the mistake this whole module exists to avoid.
 */
export type ElfRegion =
  | 'e-ident'
  | 'elf-header'
  | 'program-header-table'
  | 'section-header-table'
  | 'section-name-table'

/**
 * Why a binary counts as dynamically linked, as found in the file.
 *
 * Every applicable reason is carried, not the first one hit. A position-independent
 * executable presents all three; a static-PIE presents `shared-object-type` and
 * `dynamic-segment` but no interpreter. Those want different fixes — drop `-pie`,
 * versus drop `-pie` *and* the shared dependencies — and a report that stopped at
 * the first match would send half of them to the wrong one.
 */
export type DynamicEvidence = 'interpreter-segment' | 'dynamic-segment' | 'shared-object-type'

export type ElfRefusal =
  /** `found` holds the leading bytes that were there instead, up to four. */
  | { readonly kind: 'not-an-elf'; readonly found: readonly number[] }
  | { readonly kind: 'not-64-bit'; readonly elfClass: number }
  | { readonly kind: 'not-little-endian'; readonly elfData: number }
  | { readonly kind: 'not-aarch64'; readonly machine: number }
  /** Never empty. See {@link DynamicEvidence}. */
  | { readonly kind: 'dynamically-linked'; readonly evidence: readonly DynamicEvidence[] }
  /** `sectionNames` is what *was* found, so a build log shows how near the miss was. */
  | { readonly kind: 'stripped-without-unwind-tables'; readonly sectionNames: readonly string[] }
  | {
      readonly kind: 'truncated'
      readonly region: ElfRegion
      /** Bytes the file's own headers say must exist. `bigint`: these are u64 fields. */
      readonly needed: bigint
      readonly actual: number
    }

/**
 * What the screen read out of the file, for the build log and the input record.
 *
 * These are observations, not judgements. `stripped` in particular is reported on
 * inputs that were *accepted*, because "lifted from a stripped binary via
 * `.eh_frame`" is worth knowing later, when an artifact behaves oddly and somebody
 * is trying to work out which inputs share a property with it.
 */
export interface ElfFacts {
  /** Always {@link EM_AARCH64} on an accepted input; recorded so the log is explicit. */
  readonly machine: number
  /** Never `dyn` on an accepted input — that is a refusal. See the module comment. */
  readonly type: ElfType
  /** No `SHT_SYMTAB` section. Not a refusal on its own. */
  readonly stripped: boolean
  /** A non-empty `.eh_frame`. An empty one gives the loader nothing to recover. */
  readonly hasEhFrame: boolean
  readonly sectionCount: number
  /** `e_entry`, as a `bigint` because it is a u64 and a build log wants it in hex. */
  readonly entryPoint: bigint
  /** In section-header order, including the empty name of the index-0 null section. */
  readonly sectionNames: readonly string[]
}

export type ElfScreening =
  | { readonly ok: true; readonly facts: ElfFacts }
  | { readonly ok: false; readonly reason: ElfRefusal }

// ---------------------------------------------------------------------------
// Bounds-checked little-endian reads.
//
// Each returns `undefined` rather than throwing or reading zero past the end.
// Reading zero would be the dangerous variant: a file claiming forty sections while
// holding two would parse as thirty-eight sections named "", and a checker that
// hallucinates structure out of absent bytes is reporting on a file nobody has.
//
// `u32` and `u64` are reachable past the end by a file that declares a table stride
// smaller than an entry, and both have a test that fails without the bound. `u16` is
// not: every one of its call sites is behind the `ELF64_HEADER_SIZE` check, and the
// last field it reads ends exactly at byte 64. Its bound is a second lock whose
// absence no test can observe, kept because the argument that makes it unnecessary
// is one refactor away from stopping being true.
// ---------------------------------------------------------------------------

const byteAt = (bytes: Uint8Array, at: number): number => bytes[at] ?? 0

function u8(bytes: Uint8Array, at: number): number | undefined {
  return at >= 0 && at < bytes.length ? byteAt(bytes, at) : undefined
}

function u16(bytes: Uint8Array, at: number): number | undefined {
  if (at < 0 || at + 2 > bytes.length) return undefined
  return byteAt(bytes, at) | (byteAt(bytes, at + 1) << 8)
}

function u32(bytes: Uint8Array, at: number): number | undefined {
  if (at < 0 || at + 4 > bytes.length) return undefined
  return (
    (byteAt(bytes, at) |
      (byteAt(bytes, at + 1) << 8) |
      (byteAt(bytes, at + 2) << 16) |
      (byteAt(bytes, at + 3) << 24)) >>>
    0
  )
}

function u64(bytes: Uint8Array, at: number): bigint | undefined {
  if (at < 0 || at + 8 > bytes.length) return undefined
  let value = 0n
  for (let i = 7; i >= 0; i--) value = (value << 8n) | BigInt(byteAt(bytes, at + i))
  return value
}

function elfTypeOf(value: number): ElfType {
  switch (value) {
    case 0:
      return 'none'
    case 1:
      return 'rel'
    case 2:
      return 'exec'
    case 3:
      return 'dyn'
    case 4:
      return 'core'
    default:
      return 'unknown'
  }
}

/** A NUL-terminated name from the section string table, bounded by that table. */
function nameAt(bytes: Uint8Array, tableStart: number, tableEnd: number, offset: number): string {
  const start = tableStart + offset
  if (offset < 0 || start >= tableEnd) return ''
  let end = start
  while (end < tableEnd && byteAt(bytes, end) !== 0) end++
  let name = ''
  for (let i = start; i < end; i++) name += String.fromCharCode(byteAt(bytes, i))
  return name
}

const truncated = (region: ElfRegion, needed: bigint, actual: number): ElfScreening => ({
  ok: false,
  reason: { kind: 'truncated', region, needed, actual },
})

/** The ELF64 header fields this screen depends on. Everything else is skipped. */
interface Elf64Header {
  readonly type: ElfType
  readonly machine: number
  readonly entryPoint: bigint
  readonly phoff: bigint
  readonly shoff: bigint
  /**
   * Honoured rather than assumed to be 56 / 64.
   *
   * A hand-built or hostile file can declare any stride, and striding by the
   * constant instead would read `p_type` out of the middle of a neighbouring header
   * — which could miss a `PT_INTERP` and *admit* a dynamic binary. Honouring the
   * declared stride can only mis-read a file that is already malformed, and it
   * mis-reads it towards a refusal. That is the safe direction to be wrong in.
   */
  readonly phentsize: number
  readonly phnum: number
  readonly shentsize: number
  readonly shnum: number
  readonly shstrndx: number
}

interface SectionHeader {
  readonly name: string
  readonly type: number
  readonly size: bigint
}

type SectionParse =
  | { readonly ok: true; readonly sections: readonly SectionHeader[] }
  | { readonly ok: false; readonly screening: ElfScreening }

/**
 * Parse the section header table, resolving both `e_shnum` and `e_shstrndx` escapes.
 *
 * A binary with 65,280 or more sections stores its real section count in section 0's
 * `sh_size` and its real string-table index in section 0's `sh_link`. Rare, but
 * `-ffunction-sections` on a large program reaches it — and the failure mode without
 * this is not an error. It is a file that reports zero sections and gets refused as
 * stripped: a wrong answer wearing a right answer's clothes.
 *
 * Section *contents* are deliberately not bounds-checked, with one exception. The
 * string table is read here, so it must be in the file. Everything else is only
 * described, and `SHT_NOBITS` (`.bss`) legitimately declares an `sh_size` far larger
 * than anything on disk — bounds-checking every section would refuse most real
 * binaries for being correctly formed.
 */
function parseSections(bytes: Uint8Array, header: Elf64Header): SectionParse {
  const { shoff } = header
  if (shoff === 0n) return { ok: true, sections: [] }

  const stride = header.shentsize === 0 ? ELF64_SHDR_SIZE : header.shentsize
  const total = BigInt(bytes.length)

  // Section 0 must be readable before anything else, because both escapes live in
  // it and both are needed to know how much of the table there is.
  const first = shoff + BigInt(stride)
  if (first > total) {
    return { ok: false, screening: truncated('section-header-table', first, bytes.length) }
  }
  const base = Number(shoff)

  const count = header.shnum === 0 ? Number(u64(bytes, base + 32) ?? 0n) : header.shnum
  const stringIndex =
    header.shstrndx === SHN_XINDEX ? (u32(bytes, base + 40) ?? 0) : header.shstrndx

  const tableBytes = shoff + BigInt(count) * BigInt(stride)
  if (tableBytes > total) {
    return { ok: false, screening: truncated('section-header-table', tableBytes, bytes.length) }
  }

  // Resolve the name table before naming anything. A table that is itself out of
  // bounds has to be reported as such, rather than silently yielding the empty name
  // for every section and thereby losing `.symtab` and `.eh_frame` at once.
  let nameStart = 0
  let nameEnd = 0
  if (stringIndex > 0 && stringIndex < count) {
    const at = base + stringIndex * stride
    const offset = u64(bytes, at + 24) ?? 0n
    const end = offset + (u64(bytes, at + 32) ?? 0n)
    if (end > total) {
      return { ok: false, screening: truncated('section-name-table', end, bytes.length) }
    }
    nameStart = Number(offset)
    nameEnd = Number(end)
  }

  const sections: SectionHeader[] = []
  for (let i = 0; i < count; i++) {
    const at = base + i * stride
    sections.push({
      name: nameAt(bytes, nameStart, nameEnd, u32(bytes, at) ?? 0),
      type: u32(bytes, at + 4) ?? 0,
      size: u64(bytes, at + 32) ?? 0n,
    })
  }
  return { ok: true, sections }
}

/**
 * Decide whether elfconv can be expected to translate `bytes`.
 *
 * Checks run in order of how fundamental the mismatch is, so the reason a caller
 * sees is the one worth acting on first: an x86-64 shared object is reported as
 * `not-aarch64` rather than `dynamically-linked`, because rebuilding for AArch64 is
 * the step that has to happen either way.
 *
 * Accepting is a prediction, not a guarantee. elfconv can still fail on an
 * instruction it decodes but has no semantics for, and it announces that on stdout
 * while exiting 0 — so a successful screen means "attempt the build", never "the
 * artifact will be right". Deliberately not compensated for here; see the module
 * comment on the boundary this must not cross.
 */
export function screenElf(bytes: Uint8Array): ElfScreening {
  for (let i = 0; i < ELF_MAGIC.length; i++) {
    if (u8(bytes, i) !== ELF_MAGIC[i]) {
      const found = [...bytes.slice(0, Math.min(ELF_MAGIC.length, bytes.length))]
      return { ok: false, reason: { kind: 'not-an-elf', found } }
    }
  }

  if (bytes.length < EI_NIDENT) return truncated('e-ident', BigInt(EI_NIDENT), bytes.length)

  // Class before anything that reads past `e_ident`: a 32-bit header is 52 bytes, so
  // demanding 64 first would report a perfectly complete 32-bit ELF as truncated and
  // send its author hunting for a corrupt download.
  const elfClass = u8(bytes, EI_CLASS) ?? 0
  if (elfClass !== ELFCLASS64) return { ok: false, reason: { kind: 'not-64-bit', elfClass } }

  const elfData = u8(bytes, EI_DATA) ?? 0
  if (elfData !== ELFDATA2LSB) return { ok: false, reason: { kind: 'not-little-endian', elfData } }

  if (bytes.length < ELF64_HEADER_SIZE) {
    return truncated('elf-header', BigInt(ELF64_HEADER_SIZE), bytes.length)
  }

  const header: Elf64Header = {
    type: elfTypeOf(u16(bytes, 16) ?? 0),
    machine: u16(bytes, 18) ?? 0,
    entryPoint: u64(bytes, 24) ?? 0n,
    phoff: u64(bytes, 32) ?? 0n,
    shoff: u64(bytes, 40) ?? 0n,
    phentsize: u16(bytes, 54) ?? 0,
    phnum: u16(bytes, 56) ?? 0,
    shentsize: u16(bytes, 58) ?? 0,
    shnum: u16(bytes, 60) ?? 0,
    shstrndx: u16(bytes, 62) ?? 0,
  }

  if (header.machine !== EM_AARCH64) {
    return { ok: false, reason: { kind: 'not-aarch64', machine: header.machine } }
  }

  const evidence: DynamicEvidence[] = []
  if (header.phnum > 0 && header.phoff > 0n) {
    const stride = header.phentsize === 0 ? ELF64_PHDR_SIZE : header.phentsize
    const needed = header.phoff + BigInt(header.phnum) * BigInt(stride)
    if (needed > BigInt(bytes.length)) {
      return truncated('program-header-table', needed, bytes.length)
    }
    const base = Number(header.phoff)
    for (let i = 0; i < header.phnum; i++) {
      const segment = u32(bytes, base + i * stride) ?? 0
      if (segment === PT_INTERP && !evidence.includes('interpreter-segment')) {
        evidence.push('interpreter-segment')
      }
      if (segment === PT_DYNAMIC && !evidence.includes('dynamic-segment')) {
        evidence.push('dynamic-segment')
      }
    }
  }

  // ET_DYN costs the most to diagnose without this check. A static-PIE has no
  // interpreter and can have nothing in its dynamic segment worth the name, so it
  // reads as static — and elfconv aborts on it with exit 134 and no explanation.
  if (header.type === 'dyn') evidence.push('shared-object-type')

  if (evidence.length > 0) return { ok: false, reason: { kind: 'dynamically-linked', evidence } }

  const parsed = parseSections(bytes, header)
  if (!parsed.ok) return parsed.screening

  const sectionNames = parsed.sections.map((section) => section.name)
  const stripped = !parsed.sections.some((section) => section.type === SHT_SYMTAB)
  // Size, not mere presence. A zero-length `.eh_frame` is a section header with no
  // unwind entries behind it, and libdwarf recovers exactly nothing from it — so
  // counting it as present would admit the one input elfconv hard-errors on, while
  // reporting that the safeguard held.
  const hasEhFrame = parsed.sections.some(
    (section) => section.name === '.eh_frame' && section.size > 0n,
  )

  if (stripped && !hasEhFrame) {
    return { ok: false, reason: { kind: 'stripped-without-unwind-tables', sectionNames } }
  }

  return {
    ok: true,
    facts: {
      machine: header.machine,
      type: header.type,
      stripped,
      hasEhFrame,
      sectionCount: parsed.sections.length,
      entryPoint: header.entryPoint,
      sectionNames,
    },
  }
}

const hex = (values: readonly number[]): string =>
  values.length === 0
    ? '(empty)'
    : values.map((value) => value.toString(16).padStart(2, '0')).join(' ')

/**
 * One sentence naming the property that was found and the thing to do about it.
 *
 * Every sentence states the observation, because a refusal a person cannot check
 * against their own file is a refusal they route around rather than fix.
 */
export function describeRefusal(reason: ElfRefusal): string {
  switch (reason.kind) {
    case 'not-an-elf':
      return `not an ELF file — expected the magic 7f 45 4c 46 and found ${hex(reason.found)}`
    case 'not-64-bit':
      return `not a 64-bit ELF (EI_CLASS ${reason.elfClass}) — the aarch64 targets lift ELF64 only, so rebuild for a 64-bit target`
    case 'not-little-endian':
      return `not a little-endian ELF (EI_DATA ${reason.elfData}) — big-endian AArch64 is a different ABI and is not supported`
    case 'not-aarch64': {
      // `EM_X86_64`. Named rather than left as a constant because it is the machine this
      // refusal overwhelmingly meets, and "machine 62" sends a reader to a header file.
      const named = reason.machine === 62 ? ' (x86-64)' : ''
      return (
        `built for machine ${reason.machine}${named}, not AArch64 (${EM_AARCH64}) — ` +
        `if you have the source, cross-compile it for aarch64 and translate that. ` +
        `If you have only the binary, it is out of scope for this tier: elfconv lifts ` +
        `AArch64 ELF input only, and its x86-64 support is upstream work in progress, ` +
        `not a flag this driver is withholding`
      )
    }
    case 'dynamically-linked':
      return `dynamically linked or position-independent (${reason.evidence.join(', ')}) — relink with -static and without -pie, because elfconv aborts on these complaining that __wrap_main is missing`
    case 'stripped-without-unwind-tables': {
      const named = reason.sectionNames.filter((name) => name !== '')
      return `stripped with no .eh_frame to recover function entries from (${reason.sectionNames.length} sections: ${named.length === 0 ? 'none named' : named.join(' ')}) — keep either the symbol table or the unwind tables; stripping one is fine, stripping both is not`
    }
    case 'truncated':
      return `truncated — the ${reason.region} needs ${reason.needed} bytes but the file holds ${reason.actual}, so this is a partial or corrupt copy`
  }
}
