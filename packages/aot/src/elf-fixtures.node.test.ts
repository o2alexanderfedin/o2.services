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
  {
    path: join(ELF, 'ls_dynamic'),
    minBytes: 100_000,
    why: 'a distribution binary nobody here built — the provenance case, absent until 2026-08-07',
  },
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

describe('the distribution binary is still a distribution binary', () => {
  /**
   * `ls_dynamic` is the one fixture that is COPIED rather than compiled: the build image's
   * own Debian coreutils `ls`. The case that reads it -- *"refuses a distribution binary
   * this repo did not build"* -- is about **provenance**, so the failure worth guarding is
   * not absence (`REQUIRED` covers that now) but SUBSTITUTION. Swapping in something built
   * by `build-elf-fixtures.mjs` would leave the case's title intact, silently remove its
   * subject, and read as covered.
   *
   * This case skipped on every host from the day it was written until 2026-08-07, because
   * nothing produced the fixture. It was recorded as a deliberate licensing exception; the
   * licence question is moot here, since `tools/aot/fixtures/elf/` is gitignored and no
   * binary is vendored into the repository at all.
   */
  const BUILT_HERE = [
    'hello_static',
    'hello_static_stripped',
    'hello_no_unwind',
    'hello_dynamic',
    'hello_static_pie',
  ] as const

  it.skipIf(!CAN_BUILD)('is not any of the binaries this repository builds', () => {
    const distro = readFileSync(join(ELF, 'ls_dynamic'))
    for (const name of BUILT_HERE) {
      expect(
        Buffer.compare(distro, readFileSync(join(ELF, name))),
        `ls_dynamic is byte-identical to ${name} — the provenance case has lost its subject`,
      ).not.toBe(0)
    }

    const source = readFileSync(join(ROOT, 'packages/aot/src/elf.real.node.test.ts'), 'utf8')
    // Counted off the source rather than written down here: the number is a fact about
    // that file, and a copy of it would be a second place for it to drift.
    const gated = source.match(/it\.skipIf\([A-Z_]+ === undefined\)/g) ?? []
    expect(gated.length).toBeGreaterThan(0)
    expect(gated.filter((line) => line.includes('SYSTEM_BINARY'))).toHaveLength(1)
  })
})
