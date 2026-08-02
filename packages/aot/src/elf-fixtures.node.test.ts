import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { arch } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * The real-artifact fixtures are present, and the one that is absent is absent on purpose.
 *
 * ## The failure this exists to prevent, which already happened
 *
 * `elf.real.node.test.ts` and `wasi-real.node.test.ts` hold eighteen cases that check the
 * ELF reader and the WASI executor against binaries a real toolchain produced. Every one
 * is written `it.skipIf(FIXTURE === undefined)`, so when the fixtures vanished — they were
 * built by hand into `/tmp`, and `/tmp` does not survive a reboot — all eighteen reported
 * green by reporting nothing. That is deficiency **D21**, and it survived long enough to
 * be audited, written up, and read past several times, because a skip looks like a pass
 * from any distance.
 *
 * **A conditional guard cannot report its own absence.** Something unconditional has to,
 * and that is this file. It asserts what the conditional files can only assume.
 *
 * ## Gated on whether this host could have built them, not on whether they are there
 *
 * The fixtures are **not committed**, following the rule `.gitignore` already states for
 * `workload-linux` and the lifted wasms: *an opaque artifact in the repository is worse
 * than one reproducible from its source.* The build script is the source.
 *
 * So the question this file asks is not "are they present" — which would strand anyone
 * without Docker on a permanent red — but **"could this host have built them, and did
 * it?"** On an arm64 host with a working Docker, absence is a real failure and the message
 * carries the command. Anywhere else it is a stated skip naming what is missing and why,
 * which is still louder than the nothing that D21 lived inside for weeks.
 *
 * Rebuild with `node tools/aot/build-elf-fixtures.mjs`, and re-lift with
 * `npm run aot:lift -- tools/aot/fixtures/elf/hello_static`.
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const ELF = join(ROOT, 'tools/aot/fixtures/elf')
const R1 = join(ROOT, 'tools/aot/fixtures/r1')

/**
 * What must be on disk, and the shape each one is interesting for.
 *
 * `minBytes` is a floor rather than an exact size — a different gcc lays sections out
 * differently and these are meant to be whatever a real toolchain emits. It is here to
 * catch a truncated or placeholder file, which is the failure a mere `existsSync` would
 * wave through.
 */
const REQUIRED: readonly { readonly path: string; readonly minBytes: number; readonly why: string }[] = [
  { path: join(ELF, 'hello_static'), minBytes: 100_000, why: 'static with a symbol table — must be accepted' },
  {
    path: join(ELF, 'hello_static_stripped'),
    minBytes: 100_000,
    why: 'stripped but keeps .eh_frame — the binary that falsified "elfconv needs unstripped"',
  },
  {
    path: join(ELF, 'hello_no_unwind'),
    minBytes: 100_000,
    why: 'stripped AND no unwind tables — the refusal is the conjunction, not either half',
  },
  { path: join(ELF, 'hello_dynamic'), minBytes: 10_000, why: 'default-gcc PIE — refused on three counts' },
  { path: join(ELF, 'hello_static_pie'), minBytes: 100_000, why: 'static-PIE with no interpreter — refused' },
  { path: join(R1, 'hello.wasm'), minBytes: 1_000_000, why: 'a real elfconv artifact, as the fabric sees it' },
]

/**
 * Whether this host could build the fixtures at all: native arm64 plus a Docker that
 * answers. Checked rather than assumed — a `docker` on PATH whose daemon is down builds
 * nothing, and that is the state this repository has already misdiagnosed twice.
 */
const CAN_BUILD = ((): boolean => {
  if (arch() !== 'arm64') return false
  try {
    execFileSync('docker', ['version', '--format', '{{.Server.Version}}'], {
      stdio: 'pipe',
      timeout: 30_000,
    })
    return true
  } catch {
    return false
  }
})()

describe('the real-artifact fixtures are built on a host that could build them', () => {
  for (const { path, minBytes, why } of REQUIRED) {
    it.skipIf(!CAN_BUILD)(`has ${path.slice(ROOT.length)} — ${why}`, () => {
      expect(
        existsSync(path),
        `missing: ${path}\nRebuild with \`node tools/aot/build-elf-fixtures.mjs\` (and ` +
          `\`npm run aot:lift -- tools/aot/fixtures/elf/hello_static\` for the artifact). ` +
          `Without it the cases that read it skip, and a skip reads as a pass.`,
      ).toBe(true)
      expect(statSync(path).size).toBeGreaterThan(minBytes)
    })
  }

  it.skipIf(!CAN_BUILD)('holds real AArch64 ELF objects and a real wasm, not placeholders', () => {
    // The magic is checked because a file of the right size holding the wrong thing is
    // exactly what a placeholder is, and every assertion above would pass against one.
    for (const { path } of REQUIRED.filter((entry) => !entry.path.endsWith('.wasm'))) {
      const head = readFileSync(path).subarray(0, 20)
      expect([...head.subarray(0, 4)], `${path} is not an ELF`).toEqual([0x7f, 0x45, 0x4c, 0x46])
      // e_machine sits at offset 18 little-endian; 183 is EM_AARCH64.
      expect(head[18] as number, `${path} is not AArch64`).toBe(183)
    }
    const wasm = readFileSync(join(R1, 'hello.wasm')).subarray(0, 4)
    expect([...wasm], 'the lifted artifact is not a wasm module').toEqual([0x00, 0x61, 0x73, 0x6d])
  })
})

describe('the one fixture that is deliberately absent stays declared', () => {
  /**
   * `ls_dynamic` is a binary taken from a Linux distribution, and the case that reads it
   * is about **provenance** — a binary nobody here compiled, carrying whatever a
   * packager's toolchain did to it.
   *
   * It is not committed, and the reason is licensing rather than difficulty. Every
   * candidate — coreutils, busybox, anything in a base image — is copyleft, and this
   * repository preserves a commercial licence track. Vendoring a GPL executable to satisfy
   * one assertion trades a licensing problem for a test.
   *
   * Substituting one built here would be worse than skipping: the case would keep its
   * title, lose its subject, and read as covered.
   *
   * So this is a **declared** exception. The assertion is that it is still exactly one
   * case and still named — if somebody commits an `ls_dynamic`, this fails and they are
   * made to think about the licence; if somebody adds a *second* unbuildable fixture, the
   * count moves and this fails too.
   */
  it('is ls_dynamic, is not committed, and is the only one', () => {
    expect(existsSync(join(ELF, 'ls_dynamic'))).toBe(false)

    const source = readFileSync(join(ROOT, 'packages/aot/src/elf.real.node.test.ts'), 'utf8')
    // Counted off the source rather than written down here: the number is a fact about
    // that file, and a copy of it would be a second place for it to drift.
    //
    // The `it.skipIf(...)` form specifically, not every mention — the body of that case
    // also narrows with `if (SYSTEM_BINARY === undefined) return`, which is a type guard
    // rather than a second exception, and counting both said 2 where the truth is 1.
    const gated = source.match(/it\.skipIf\([A-Z_]+ === undefined\)/g) ?? []
    expect(gated.length).toBeGreaterThan(0)
    const bySystemBinary = gated.filter((line) => line.includes('SYSTEM_BINARY'))
    expect(bySystemBinary).toHaveLength(1)
  })
})
