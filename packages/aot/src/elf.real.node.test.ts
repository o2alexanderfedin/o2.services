import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { describeRefusal, EM_AARCH64, screenElf } from './elf.ts'

/**
 * The same screen, pointed at binaries a real linker produced — AOT-01.
 *
 * `elf.test.ts` synthesises its headers, which proves the checker agrees with this
 * repository's idea of ELF and nothing more. A generator and a parser written in one
 * sitting share their author's misconceptions, and the synthetic suite would pass
 * every one of them. These fixtures come from GNU ld on Ubuntu 22.04 for aarch64,
 * which had no such conversation.
 *
 * Node-only because it reads files. The suffix is the gate, not a label: the browser
 * project excludes `*.node.test.ts`, so `@o2/aot` stays portable.
 *
 * ## Regenerating the fixtures
 *
 * ```sh
 * node tools/aot/build-elf-fixtures.mjs
 * ```
 *
 * That script replaced a recipe that lived only in this comment, and the replacement is
 * the point rather than the tidying. These fixtures were built by hand into `/tmp`, `/tmp`
 * does not survive a reboot, and all eighteen cases across this file and `wasi-real`
 * silently went inert — reported as deficiency **D21** after they had been reporting green
 * by reporting nothing for some time. A fixture recipe that is prose is a guard with a
 * half-life; one that is a script somebody can run is not.
 *
 * The binaries are now committed under `tools/aot/fixtures/elf/`, which is where this
 * repository already keeps real binary fixtures (`workload-linux`, `lifted-subject.wasm`).
 *
 * `O2_ELF_FIXTURES` still overrides the directory. The cases still skip rather than fail
 * when a file is absent, because one of them — the distribution binary — is deliberately
 * not committed for licensing reasons, and because a checkout on a non-arm64 host cannot
 * rebuild these. What is no longer true is that the absence is silent:
 * `elf-fixtures.node.test.ts` asserts which fixtures must be present, so a fixture that
 * disappears fails a named test instead of quietly subtracting coverage.
 */

const FIXTURES =
  process.env['O2_ELF_FIXTURES'] ?? fileURLToPath(new URL('../../../tools/aot/fixtures/elf/', import.meta.url))

function load(name: string): Uint8Array | undefined {
  try {
    return new Uint8Array(readFileSync(join(FIXTURES, name)))
  } catch {
    return undefined
  }
}

/** Static, non-PIE, symbols kept. What the AOT pipeline is built to accept. */
const STATIC = load('hello_static')
/** The same binary after `strip`. Symbols gone, `.eh_frame` intact. */
const STRIPPED = load('hello_static_stripped')
/** Stripped *and* with the unwind tables removed — elfconv's hard-error case. */
const NO_UNWIND = load('hello_no_unwind')
/** Default `gcc`: PIE with an interpreter. Entry point 0x640. */
const DYNAMIC = load('hello_dynamic')
/** `-static-pie`: no interpreter, so it reads as static until `e_type` is checked. */
const STATIC_PIE = load('hello_static_pie')
/** A distribution binary nobody in this project built. */
const SYSTEM_BINARY = load('ls_dynamic')
/** An elfconv *output*, for the other direction: a .wasm is not an ELF. */
const LIFTED_WASM = load('../r1/hello.wasm')

describe('a real statically linked AArch64 executable is accepted', () => {
  it.skipIf(STATIC === undefined)('accepts one that kept its symbol table', () => {
    if (STATIC === undefined) return
    const screening = screenElf(STATIC)
    expect(screening.ok, screening.ok ? '' : describeRefusal(screening.reason)).toBe(true)
    if (!screening.ok) return
    expect(screening.facts.machine).toBe(EM_AARCH64)
    expect(screening.facts.type).toBe('exec')
    expect(screening.facts.stripped).toBe(false)
    expect(screening.facts.hasEhFrame).toBe(true)
    expect(screening.facts.sectionNames).toContain('.symtab')
    expect(screening.facts.sectionNames).toContain('.eh_frame')
    // A linker writes several dozen sections. Anything near zero means the section
    // header table was misread and the accept came from luck.
    expect(screening.facts.sectionCount).toBeGreaterThan(10)
    expect(screening.facts.entryPoint).toBeGreaterThan(0n)
  })

  it.skipIf(STRIPPED === undefined)('accepts one that was stripped but kept .eh_frame', () => {
    // The correction that matters. The recorded assumption was that elfconv needed
    // unstripped input; this binary has no `.symtab` at all and lifts fine, because
    // the loader recovers function entries from the unwind tables through libdwarf.
    if (STRIPPED === undefined) return
    const screening = screenElf(STRIPPED)
    expect(screening.ok, screening.ok ? '' : describeRefusal(screening.reason)).toBe(true)
    if (!screening.ok) return
    expect(screening.facts.stripped).toBe(true)
    expect(screening.facts.hasEhFrame).toBe(true)
    expect(screening.facts.sectionNames).not.toContain('.symtab')
  })

  it.skipIf(STATIC === undefined || STRIPPED === undefined)(
    'reports the same entry point before and after stripping',
    () => {
      // `strip` does not relocate code, so a screen that disagreed here would be
      // reading `e_entry` out of the wrong offset in one of the two.
      if (STATIC === undefined || STRIPPED === undefined) return
      const before = screenElf(STATIC)
      const after = screenElf(STRIPPED)
      expect(before.ok && after.ok).toBe(true)
      if (!before.ok || !after.ok) return
      expect(after.facts.entryPoint).toBe(before.facts.entryPoint)
    },
  )
})

describe('a real binary elfconv cannot lift is refused, by name', () => {
  it.skipIf(NO_UNWIND === undefined)('refuses one stripped of symbols and unwind tables', () => {
    if (NO_UNWIND === undefined) return
    const screening = screenElf(NO_UNWIND)
    expect(screening.ok).toBe(false)
    if (screening.ok) return
    expect(screening.reason.kind).toBe('stripped-without-unwind-tables')
    if (screening.reason.kind !== 'stripped-without-unwind-tables') return
    // It still has plenty of sections — the refusal is about *which* ones are gone,
    // not about the section header table being missing.
    expect(screening.reason.sectionNames.length).toBeGreaterThan(10)
    expect(screening.reason.sectionNames).not.toContain('.eh_frame')
  })

  it.skipIf(DYNAMIC === undefined)('refuses a default-gcc PIE with all three reasons', () => {
    if (DYNAMIC === undefined) return
    const screening = screenElf(DYNAMIC)
    expect(screening.ok).toBe(false)
    if (screening.ok) return
    expect(screening.reason.kind).toBe('dynamically-linked')
    if (screening.reason.kind !== 'dynamically-linked') return
    expect([...screening.reason.evidence].sort()).toEqual([
      'dynamic-segment',
      'interpreter-segment',
      'shared-object-type',
    ])
  })

  it.skipIf(DYNAMIC === undefined)('reads the entry point elfconv complains about', () => {
    // elfconv's own message on this class of input is
    // `__wrap_main code block is not found. entry_point: 0x640`, and 0x640 is what
    // `e_entry` holds here. That correspondence is why the message is diagnosable at
    // all — and why parsing it would still have been the wrong way to find out.
    if (DYNAMIC === undefined) return
    const screening = screenElf(DYNAMIC)
    expect(screening.ok).toBe(false)
    // Refused before facts exist, so read the field directly: e_entry is a
    // little-endian u64 at offset 24 of every ELF64 header.
    expect(new DataView(DYNAMIC.buffer, DYNAMIC.byteOffset).getBigUint64(24, true)).toBe(0x640n)
  })

  it.skipIf(STATIC_PIE === undefined)('refuses a static-PIE that has no interpreter', () => {
    // The expensive case. Nothing about it looks dynamic from the outside — no
    // interpreter, no shared libraries — and elfconv aborts on it with exit 134.
    if (STATIC_PIE === undefined) return
    const screening = screenElf(STATIC_PIE)
    expect(screening.ok).toBe(false)
    if (screening.ok) return
    expect(screening.reason.kind).toBe('dynamically-linked')
    if (screening.reason.kind !== 'dynamically-linked') return
    expect(screening.reason.evidence).not.toContain('interpreter-segment')
    expect(screening.reason.evidence).toContain('shared-object-type')
  })

  it.skipIf(SYSTEM_BINARY === undefined)('refuses a distribution binary this repo did not build', () => {
    if (SYSTEM_BINARY === undefined) return
    const screening = screenElf(SYSTEM_BINARY)
    expect(screening.ok).toBe(false)
    if (screening.ok) return
    expect(screening.reason.kind).toBe('dynamically-linked')
  })
})

describe('real bytes, read at the offsets ELF64 actually puts them', () => {
  it.skipIf(STATIC === undefined)('finds the identification the standard specifies', () => {
    // Hardcoded, not derived. If the screen ever agrees with the synthetic fixture
    // generator but not with this, the generator is the thing that is wrong.
    if (STATIC === undefined) return
    expect([...STATIC.slice(0, 7)]).toEqual([
      0x7f, 0x45, 0x4c, 0x46, // \x7fELF
      0x02, // EI_CLASS   = ELFCLASS64
      0x01, // EI_DATA    = ELFDATA2LSB
      0x01, // EI_VERSION = EV_CURRENT
    ])
    expect([...STATIC.slice(16, 20)]).toEqual([
      0x02, 0x00, // e_type    = ET_EXEC
      0xb7, 0x00, // e_machine = 183
    ])
  })

  it.skipIf(STATIC === undefined)('does not depend on EI_OSABI, which real linkers vary', () => {
    // Found by pointing this suite at reality. The synthetic fixtures write
    // ELFOSABI_NONE, and this statically linked glibc binary declares ELFOSABI_GNU
    // (3) instead, because it uses IFUNC. Nothing in the screen reads the field —
    // asserted here so that stays deliberate rather than accidental.
    if (STATIC === undefined) return
    expect(STATIC[7]).toBe(0x03)
    const forced = new Uint8Array(STATIC)
    for (const osabi of [0x00, 0x03, 0x09, 0xff]) {
      forced[7] = osabi
      expect(screenElf(forced).ok, `EI_OSABI ${osabi}`).toBe(true)
    }
  })

  it.skipIf(DYNAMIC === undefined)('sees ET_DYN where the standard puts e_type', () => {
    if (DYNAMIC === undefined) return
    expect([...DYNAMIC.slice(16, 20)]).toEqual([0x03, 0x00, 0xb7, 0x00])
  })

  it.skipIf(STATIC === undefined)('refuses a real file cut short, naming the region', () => {
    // A partial download is the realistic version of this. It reaches a different
    // region depending on where it stops, and each stop has to be named rather than
    // collapsed into "malformed".
    if (STATIC === undefined) return
    for (const [length, region] of [
      [8, 'e-ident'],
      [40, 'elf-header'],
      [200, 'program-header-table'],
    ] as const) {
      const screening = screenElf(STATIC.slice(0, length))
      expect(screening.ok, `${length} bytes`).toBe(false)
      if (screening.ok) continue
      expect(screening.reason.kind, `${length} bytes`).toBe('truncated')
      if (screening.reason.kind !== 'truncated') continue
      expect(screening.reason.region, `${length} bytes`).toBe(region)
      expect(screening.reason.actual, `${length} bytes`).toBe(length)
    }
  })

  it.skipIf(LIFTED_WASM === undefined)('refuses elfconv output, which is a .wasm', () => {
    // The pipeline runs input → screen → lift → artifact. Feeding an artifact back
    // to the screen is a plausible wiring mistake, and the magic catches it.
    if (LIFTED_WASM === undefined) return
    const screening = screenElf(LIFTED_WASM)
    expect(screening.ok).toBe(false)
    if (screening.ok) return
    expect(screening.reason.kind).toBe('not-an-elf')
    if (screening.reason.kind !== 'not-an-elf') return
    expect(screening.reason.found).toEqual([0x00, 0x61, 0x73, 0x6d])
  })
})
