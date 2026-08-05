/**
 * The stub `docker` harness, lifted out of `lift.node.test.ts` so more than one spec
 * can drive it.
 *
 * Everything here was module-private in that file. It moves because `cli.node.test.ts`
 * has to make the *same* refusal happen one level up — the CLI spawned as a program,
 * pointed at a `docker` that answers with somebody else's digest — and the alternative
 * to moving it is a second copy of a shell script that has been corrected four times.
 *
 * ## It is not a spec, deliberately
 *
 * `vitest.config.ts`'s node project includes, under `tools/`, only files whose name ends
 * `.node.test.ts` — so this one is invisible to the runner and importable from any spec
 * there. Naming it `stubs.node.test.ts` would make vitest collect a file with no cases.
 *
 * ## Why the stub is a shell script rather than a mock
 *
 * `liftElf` and `resolveImage` both already take the executable's path, so the seam
 * exists and nothing needs mocking. The *log* is the point. Every behaviour tested
 * through this stub is something the driver must not do — resolve to somebody else's
 * digest, start a container after refusing, leave one running after a timeout — and
 * none of those is observable from a return value. A driver that refused an image and
 * then ran it anyway satisfies every assertion about its `LiftFailure`.
 *
 * Node-only. Uses `node:*` freely; nothing in `packages/` may import it.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export interface StubDocker {
  readonly path: string
  /** One line per invocation, argv space-joined, in the order they happened. */
  readonly invocations: () => readonly string[]
}

/**
 * Every temporary directory this module made, so one call can remove all of them.
 *
 * Module-private and not exported. The `afterAll` that used to empty it lived in the
 * spec these functions came from, and a second spec importing this module needs the
 * same cleanup without knowing about the first one's.
 */
const stubDirs: string[] = []

/**
 * A temporary directory that {@link cleanupStubs} will remove.
 *
 * Exported because two call sites in `lift.node.test.ts` — the stub `.wasm` and the
 * `RLIMIT_NPROC` child — make their own directories and registered them in the array
 * above when it was in scope. Handing them this keeps one cleanup path rather than two.
 */
export function stubDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  stubDirs.push(dir)
  return dir
}

/**
 * Remove every directory this module made.
 *
 * Called from each importing spec's own `afterAll`, and **removing a directory twice is
 * a no-op** — `rmSync(..., { force: true })` does not complain about a path that is not
 * there — so two specs sharing this module is safe even when both run in one process.
 * That is the first question a reader has, so it is answered here rather than found out.
 */
export function cleanupStubs(): void {
  for (const dir of stubDirs) rmSync(dir, { recursive: true, force: true })
  stubDirs.length = 0
}

/**
 * `body` is `sh`, appended after the logging prologue, with `$1` as the subcommand.
 *
 * The prologue flattens newlines out of the argv before logging, because one of the
 * arguments the driver passes to `docker run` is a twenty-line shell script — logged
 * raw it would turn a single invocation into twenty log lines and every count
 * assertion would be measuring the wrong thing.
 */
export function stubDocker(body: string): StubDocker {
  const dir = stubDir('o2-stub-docker-')
  const log = join(dir, 'invocations.log')
  const path = join(dir, 'docker')
  writeFileSync(
    path,
    `#!/bin/sh\nprintf '%s\\n' "$(printf '%s ' "$@" | tr '\\n' ' ')" >> '${log}'\n${body}\n`,
    { mode: 0o755 },
  )
  return {
    path,
    invocations: () =>
      existsSync(log)
        ? readFileSync(log, 'utf8')
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line !== '')
        : [],
  }
}

/**
 * The smallest byte string `screenElf` accepts, built here rather than committed.
 *
 * These tests have to get *past* the pre-screen to observe what the driver does
 * next, and the only real AArch64 static ELF around is the 659 KB one the integration
 * block compiles inside the image — unavailable exactly when Docker is, and not
 * something to check in. So: 192 bytes of ELF64 little-endian `ET_EXEC` for machine
 * 183, no program headers to be refused as dynamic, and a two-entry section table
 * whose second entry is an `SHT_SYMTAB` so the file reads as unstripped. elfconv would
 * make nothing of it; the pre-screen is the only code that ever looks.
 */
export function acceptableElf(): Uint8Array {
  const file = new Uint8Array(64 + 2 * 64)
  const view = new DataView(file.buffer)
  file.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0], 0) // \x7fELF, ELFCLASS64, ELFDATA2LSB
  view.setUint16(16, 2, true) // e_type = ET_EXEC — ET_DYN is refused as position-independent
  view.setUint16(18, 183, true) // e_machine = EM_AARCH64
  view.setBigUint64(40, 64n, true) // e_shoff — the section table follows the header
  view.setUint16(58, 64, true) // e_shentsize
  view.setUint16(60, 2, true) // e_shnum
  // e_phnum and e_shstrndx stay 0: no segments to carry PT_INTERP/PT_DYNAMIC, and no
  // string table, so every section name reads empty. Acceptance turns on the *type*
  // of section 1, never on its name.
  view.setUint32(64 + 64 + 4, 2, true) // section 1 sh_type = SHT_SYMTAB ⇒ not stripped
  return file
}

/**
 * {@link acceptableElf} on disk, at a path `liftElf` can be pointed at.
 *
 * The directory is registered for {@link cleanupStubs}. This was a `beforeAll` in the
 * spec these functions came from; it is a function here so a second spec gets the
 * subject without reproducing four lines of `mkdtemp`/`writeFileSync` that have to
 * agree with the pre-screen.
 */
export function writeAcceptableElf(): string {
  const path = join(stubDir('o2-stub-elf-'), 'subject')
  writeFileSync(path, acceptableElf())
  return path
}

/** `target_features`, as the section name is spelled in a custom section header. */
const FEATURE_SECTION_NAME = 'target_features'

function featureSection(pairs: readonly (readonly [string, number])[]): readonly number[] {
  const body: number[] = [pairs.length]
  for (const [name, prefix] of pairs) {
    body.push(prefix, name.length, ...[...name].map((c) => c.charCodeAt(0)))
  }
  const name = [...FEATURE_SECTION_NAME].map((c) => c.charCodeAt(0))
  const payload = [name.length, ...name, ...body]
  return [0, payload.length, ...payload]
}

/**
 * A `.wasm` a lift is *supposed to accept*: header, and one used feature.
 *
 * Separate from `lift.node.test.ts`'s `bytes(WASM_HEADER, REAL_SECTION)` on purpose,
 * and the separation is the whole reason this constant exists rather than an import.
 * Those two constants are there so that spec can malform them a dozen different ways —
 * truncated, mis-prefixed, over-declared, wrong version. A fixture shared between "must
 * be accepted" and "must be rejected" is one edit away from being neither, and the edit
 * that does it will be made for the rejection half and silently weaken the acceptance
 * half.
 *
 * One feature rather than the three a real artifact declares, because nothing here is a
 * conformance vector: the claim being supported is that the driver read *the artifact's
 * own* section, and one entry carries that as well as three.
 */
export const ACCEPTABLE_ARTIFACT: Uint8Array = new Uint8Array([
  0x00,
  0x61,
  0x73,
  0x6d,
  0x01,
  0x00,
  0x00,
  0x00,
  ...featureSection([['bulk-memory', 0x2b]]),
])

/** The digest a correctly-tagged local image would carry. */
export const MATCHING_DIGEST =
  'ghcr.io/yomaytk/elfconv@sha256:22a404f31c9f7bb5c49e3193081d4876718253d86747aae3d30fcfd971f19c05'

/** Two entries from somewhere else entirely — the shape a re-tag leaves behind. */
export const FOREIGN_DIGESTS: readonly string[] = [
  'docker.io/library/busybox@sha256:1111111111111111111111111111111111111111111111111111111111111111',
  'ghcr.io/someone-else/elfconv@sha256:2222222222222222222222222222222222222222222222222222222222222222',
]

/** `printf` that emits each argument on its own line, the way `{{join}}` does. */
export const emitDigests = (digests: readonly string[]): string =>
  digests.length === 0 ? 'exit 0' : `printf '%s\\n' '${digests.join("' '")}'\nexit 0`

/** POSIX single-quoting, so a version string with a space in it survives the script. */
function quote(text: string): string {
  return `'${text.replaceAll("'", `'\\''`)}'`
}

/**
 * The `meta.txt` a container writes when everything worked.
 *
 * Six keys in the order `CONTAINER_SCRIPT` writes them (`lift.ts`, the `> /o2/meta.txt`
 * block) plus the seventh it appends afterwards when the disassembly probe ran. Five of
 * the six are toolchain versions; `exit` is not one, and neither is
 * `undecoded-callsites`.
 *
 * The five versions are plausible non-blank strings and none of them is `'unknown'`,
 * because a stub whose default output cannot be named would make every case built on it
 * assert the failure path by accident.
 */
const DEFAULT_META: Readonly<Record<string, string>> = {
  exit: '0',
  clang: 'Debian clang version 16.0.6 (++20230710042027+7cbf1a259152)',
  'wasi-sdk': 'wasi-sdk-20.0',
  wasmedge: 'wasmedge version 0.13.5',
  'elfconv-commit': 'f4c1d2ab9e7350b6c8d4e1f209a3b5c7d8e9f012',
  'elflift-sha256': '9f8e7d6c5b4a39281706f5e4d3c2b1a09876543210fedcba9876543210fedcba',
  'undecoded-callsites': '0',
}

export interface StubLiftOptions {
  /** What the `image inspect` subcommand answers. Defaults to {@link MATCHING_DIGEST}. */
  readonly digest?: string
  /** What lands at `artifact.wasm`. Defaults to {@link ACCEPTABLE_ARTIFACT}. */
  readonly artifact?: Uint8Array
  /** Merged over {@link DEFAULT_META}; a value of `''` writes a `key=` line. */
  readonly meta?: Readonly<Record<string, string>>
}

/**
 * A `docker` that completes a lift — the positive case the refusal stubs invert.
 *
 * It imitates `lift.ts`'s `CONTAINER_SCRIPT` and nothing more: it finds the host directory
 * out of its own argv (the element ending in `:/o2`, which is how `liftElf` passes the
 * bind mount), writes `artifact.wasm`, `meta.txt` and an empty `undecoded.txt` into it,
 * and exits 0.
 *
 * **The artifact bytes are staged to a host file and `cp`d in, never emitted by
 * `printf`.** A shell cannot be trusted to reproduce arbitrary bytes — a NUL or a `\`
 * is enough — and the point of the fixture is that whatever the driver reads back is
 * exactly what the caller handed over.
 */
export function stubLift(options: StubLiftOptions = {}): StubDocker {
  const staged = join(stubDir('o2-stub-artifact-'), 'artifact.wasm')
  writeFileSync(staged, options.artifact ?? ACCEPTABLE_ARTIFACT)
  const meta = { ...DEFAULT_META, ...options.meta }
  const lines = Object.entries(meta)
    .map(([key, value]) => quote(`${key}=${value}`))
    .join(' ')
  return stubDocker(
    'case "$1" in\n' +
      `  image) printf '%s\\n' ${quote(options.digest ?? MATCHING_DIGEST)}; exit 0 ;;\n` +
      '  run)\n' +
      '    for a in "$@"; do case "$a" in *:/o2) d="${a%:/o2}" ;; esac; done\n' +
      `    cp ${quote(staged)} "$d/artifact.wasm"\n` +
      `    printf '%s\\n' ${lines} > "$d/meta.txt"\n` +
      '    : > "$d/undecoded.txt"\n' +
      '    exit 0 ;;\n' +
      '  *) exit 0 ;;\n' +
      'esac',
  )
}
