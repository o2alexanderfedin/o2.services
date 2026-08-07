import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { arch } from 'node:os'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * A/B differential over `third_party/elfconv`'s ELF loader: the same fixtures lifted twice in
 * one container, once by the stock lifter shipped in the image and once by this repository's
 * fork built from source.
 *
 * WHAT THIS PROVES, AND WHY A DIFFERENTIAL RATHER THAN A GOLDEN DIGEST. The fork replaced
 * bfd, libdwarf and libelf with `llvm::object::ELFObjectFile` and `llvm::DWARFContext`. The
 * claim being tested is "three dependencies removed, behaviour unchanged", and behaviour here
 * means the emitted bitcode and wasm. An absolute digest would encode this image, this LLVM
 * and this glibc, and would go red on any of them moving for reasons unrelated to the loader.
 * Both arms run in the SAME container in the SAME run, so image, toolchain and clock cancel.
 *
 * THE HARNESS ONCE FAILED TO FAIL, WHICH IS WHY THE FIRST CASE HERE LOOKS PARANOID. An
 * earlier version reported "bitcode identical" over a build that had FAILED: it piped ninja
 * through grep so `$?` was grep's, and the copy of a STALE previously-built binary succeeded
 * and read as build success. The "patched" arm then ran the unpatched binary, which makes
 * identical digests true by construction. So {@link describe} order matters: nothing about
 * equality means anything until the build is shown to have happened and produced a DIFFERENT
 * binary from the stock one.
 *
 * Budget: one container, one full `ninja elflift`, eight lifts. Minutes, not seconds --
 * skipped entirely without Docker, and gated to arm64 because the image is arm64 and an
 * emulated run would measure qemu.
 */

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const IMAGE = process.env['ELFCONV_IMAGE_TAG'] ?? 'ghcr.io/yomaytk/elfconv:arm64'

/** Generous: a cold `ninja elflift` dominates, and this file has exactly one of them. */
const HARNESS_BUDGET_MS = 900_000
vi.setConfig({ testTimeout: HARNESS_BUDGET_MS, hookTimeout: HARNESS_BUDGET_MS })

interface Lift {
  readonly fixture: string
  readonly exit: number
  readonly funcs: number | null
  readonly bitcode: string
  readonly wasm: string
  readonly wasmBytes: number | null
}

interface Report {
  readonly stockLifter: string
  readonly portedLifter: string
  readonly cmakeExit: number
  readonly ninjaExit: number
  readonly linkage: { readonly lddExit: number; readonly lddLines: number; readonly forbiddenMatches: number }
  readonly baseline: readonly Lift[]
  readonly ported: readonly Lift[]
}

function dockerAvailable(): boolean {
  const probe = spawnSync('docker', ['version', '--format', '{{.Server.Os}}'], {
    timeout: 20_000,
    encoding: 'utf8',
  })
  return probe.status === 0
}

const RUNNABLE = arch() === 'arm64' && dockerAvailable()

/** Paired by fixture name so a reordering in the harness cannot silently compare the wrong two. */
function pair(report: Report, fixture: string): { readonly a: Lift; readonly b: Lift } {
  const a = report.baseline.find((l) => l.fixture === fixture)
  const b = report.ported.find((l) => l.fixture === fixture)
  if (a === undefined || b === undefined) {
    throw new Error(`fixture ${fixture} missing from one arm of the report`)
  }
  return { a, b }
}

describe.skipIf(!RUNNABLE)('elfconv loader port, baseline against ported in one container', () => {
  let report: Report

  beforeAll(() => {
    const out = mkdtempSync(join(tmpdir(), 'o2-elfconv-diff-'))
    const run = spawnSync(
      'docker',
      [
        'run',
        '--rm',
        // read-only, so a harness bug cannot dirty the working tree mid-run -- two specs in
        // this repo snapshot `git status --porcelain` around themselves.
        '-v',
        `${REPO_ROOT}:/repo:ro`,
        '-v',
        `${out}:/out`,
        '--entrypoint',
        '/bin/bash',
        IMAGE,
        '/repo/tools/aot/elfconv-differential.sh',
      ],
      { timeout: HARNESS_BUDGET_MS, encoding: 'utf8' },
    )
    const reportPath = join(out, 'report.json')
    if (run.status !== 0 || !existsSync(reportPath)) {
      throw new Error(
        `harness exited ${String(run.status)} and wrote no report.\n${run.stderr ?? ''}`,
      )
    }
    report = JSON.parse(readFileSync(reportPath, 'utf8')) as Report
    process.env['O2_PORTED_WASM_DIR'] = out
  })

  it('actually built the fork, and produced a different binary from the stock one', () => {
    // Nothing below means anything without this. A stale binary would make every equality
    // true by construction -- which is precisely how this harness once reported a green over
    // a failed build.
    expect(report.cmakeExit).toBe(0)
    expect(report.ninjaExit).toBe(0)
    expect(report.portedLifter).not.toBe(report.stockLifter)
    expect(report.portedLifter).toMatch(/^[0-9a-f]{16}$/)
  })

  it('links none of bfd, libdwarf, libelf or libiberty — and the check is not silence', () => {
    // `lddLines` guards the guard: zero matches over zero lines would mean ldd failed, not
    // that the libraries are absent. An earlier form of this check redirected ldd's stderr
    // and could not tell those two apart.
    expect(report.linkage.lddExit).toBe(0)
    expect(report.linkage.lddLines).toBeGreaterThan(0)
    expect(report.linkage.forbiddenMatches).toBe(0)
  })

  it('emits identical bitcode and wasm on the .symtab path', () => {
    const { a, b } = pair(report, 'hello_static')
    expect(a.bitcode).not.toBe('')
    expect(b.bitcode).toBe(a.bitcode)
    expect(b.wasm).toBe(a.wasm)
    expect(b.funcs).toBe(a.funcs)
  })

  it('emits identical bitcode and wasm on the .eh_frame path, which had never been run', () => {
    // The whole libdwarf half -- GetSblFromEhFrame -- was never executed by the recorded
    // harness, which only ever lifted a NON-stripped binary. LLVM's eh_frame reader
    // reproduces libdwarf exactly here.
    const { a, b } = pair(report, 'hello_static_stripped')
    expect(a.bitcode).not.toBe('')
    expect(b.bitcode).toBe(a.bitcode)
    expect(b.wasm).toBe(a.wasm)
  })

  it('refuses hello_dynamic exactly as before — the port did not change what is rejected', () => {
    // Pre-existing: elfconv aborts on this fixture. Asserted rather than dropped, because a
    // port that started ACCEPTING it would be as much a regression as one that broke a lift.
    const { a, b } = pair(report, 'hello_dynamic')
    expect(a.exit).toBe(b.exit)
    expect(a.bitcode).toBe('')
    expect(b.bitcode).toBe('')
  })

  it('DIFFERS on a freshly linked glibc binary, because function sizing was deliberately fixed', () => {
    // The one intended difference, and the reason this subject exists. bfd carries no symbol
    // size, so the loader used to rejoin sizes by NAME; that join hands the wrong length to
    // any name occurring twice -- `free_mem` appears eight times in static glibc. The
    // committed fixtures carry only two such symbols and neither is material, so they come
    // out byte-identical and CANNOT witness this. If this case ever reads IDENTICAL, either
    // the sizing fix was reverted or the subject stopped containing collisions.
    const { a, b } = pair(report, 'gcc_hello')
    expect(a.bitcode).not.toBe('')
    expect(b.bitcode).not.toBe('')
    expect(b.bitcode).not.toBe(a.bitcode)
    expect(b.wasm).not.toBe(a.wasm)
    // ...and the function count is NOT what moved. A count-only check passes this defect,
    // which is exactly how the ifunc defect survived its first build.
    expect(b.funcs).toBe(a.funcs)
  })
})
