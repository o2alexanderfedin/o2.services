import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { describeGate, gateOnImage, isRunnable } from './docker-gate.ts'

/**
 * AOTW-06 step 4 — **the acceptance test could not be the one that was planned, and the
 * reason is the result.**
 *
 * The plan said: lift a binary inside `elflift.wasm`, lift the same binary with native
 * elfconv, compare the bitcode. That comparison cannot be an equality, because
 * **native elfconv does not equal itself.** Four runs on one machine, same input, same
 * semantics, nothing else touching the box:
 *
 *   native   f6eb6063…  7 375 076 bytes
 *   native   4c2a9def…  7 372 256 bytes
 *   native   11bd0a4c…  7 373 600 bytes
 *   native   c80f35e4…  7 374 204 bytes
 *
 * Four runs, four hashes, four different sizes. The same four runs through the wasm module:
 *
 *   wasm     d7b67545…  7 352 360 bytes   (all four, byte for byte)
 *
 * ## Why this is the point of AOTW-06 rather than a footnote to it
 *
 * `tools/aot/cross-machine.node.test.ts` records `CROSS_MACHINE_BLIND_SPOT`: elfconv's
 * translation is not reproducible across machines, and the project carries that as a
 * structural property, not a bug to be fixed — the lifter iterates containers keyed by
 * pointer, so the output follows the allocator, and the allocator follows the host.
 *
 * A wasm module's linear memory is flat and program-determined. There is no ASLR in it, no
 * host allocator under it, and the same sequence of allocations produces the same addresses
 * on every instantiation and on every host. So the pointer-keyed iteration that makes native
 * elfconv wander stops wandering — not because elfconv was fixed, but because the property it
 * accidentally depends on became true.
 *
 * **Measured here, that prediction holds.** It means running the translator as a wasm job is
 * not merely portable: it is the configuration in which its output is reproducible, which is
 * what an artifact addressed by the hash of its content requires.
 *
 * ## What this file does NOT claim
 *
 * That the two arms agree. They do not, and cannot — the wasm output is one point in the
 * range the native arm scatters over. Spot-checked, the disagreement is of exactly the shape
 * the pointer-order theory predicts: both modules define 2015 functions, declare 220 and
 * carry 1560 globals, on the same datalayout and the same triple, but where several symbols
 * share one address the two arms pick different names for it — `@____strtoul_l_internal…
 * _406160` against `@____strtoull_l_internal…_406160`, the same address `406160` under a
 * different alias. Which alias wins depends on iteration order, which is the thing that
 * differs.
 *
 * Nor does it claim the wasm arm is deterministic across HOSTS. That needs a second machine,
 * which is what AOT-03 is blocked on. What is measured is: deterministic across runs, in one
 * process each time, on this host.
 */

const HERE = fileURLToPath(new URL('.', import.meta.url))
const REPO = join(HERE, '..', '..')

// The build products live outside the repository — they are 66 MB of archives and a 13.5 MB
// module, and none of it belongs in git. Their absence is a skip, not a failure.
const BUILD_ROOT = process.env.O2_WASI_ROOT ?? '/Volumes/ProjectsSSD/o2-wasi-llvm'
const MODULE = join(BUILD_ROOT, 'elflift.wasm')
const FIXTURES = join(BUILD_ROOT, 'fixtures')
const ELF = join(FIXTURES, 'hello_static')
const SEMANTICS = join(FIXTURES, 'aarch64.bc')

const RUNNER = join(REPO, 'tools', 'aot', 'run-elflift-wasm.mjs')

const IMAGE = 'ghcr.io/yomaytk/elfconv:arm64'

function missing (): string[] {
  return [
    [MODULE, 'elflift.wasm — run tools/aot/link-elflift-wasm.sh'],
    [ELF, 'the AArch64 fixture'],
    [SEMANTICS, 'the remill semantics bitcode']
  ]
    .filter(([path]) => !existsSync(path))
    .map(([path, why]) => `${why} (${path})`)
}

const ABSENT = missing()
const WASM_RUNNABLE = ABSENT.length === 0

// Three runs, not two. Two agreeing could be one code path taken twice; three agreeing while
// the native arm produces three distinct answers over the same span is a comparison rather
// than an absolute reading.
const RUNS = 3

interface Lift {
  readonly bytes: number
  readonly sha256: string
  readonly exit: number
}

function liftInWasm (outDir: string, index: number): Lift {
  const out = join(outDir, `wasm.${index}.bc`)
  const run = spawnSync(
    process.execPath,
    [RUNNER, '--module', MODULE, '--elf', ELF, '--semantics', SEMANTICS, '--out', out],
    { encoding: 'utf8', timeout: 600_000, cwd: REPO }
  )
  if (run.status !== 0 || !existsSync(out)) {
    return { bytes: 0, sha256: `no output (exit ${String(run.status)})`, exit: run.status ?? -1 }
  }
  const data = readFileSync(out)
  return {
    bytes: statSync(out).size,
    sha256: createHash('sha256').update(data).digest('hex'),
    exit: 0
  }
}

describe('AOTW-06 — a lift inside the wasm module repeats itself; the native one does not', () => {
  // 600 s, not the 5 s default: one lift of a statically-linked hello-world takes ~12 s
  // through the shim. The default timeout failed this test on its first run for that reason
  // and nothing else.
  it.runIf(WASM_RUNNABLE)('produces bitcode at all, and it is bitcode', () => {
    const dir = mkdtempSync(join(tmpdir(), 'o2-elflift-wasm-'))
    const out = join(dir, 'once.bc')
    const run = spawnSync(
      process.execPath,
      [RUNNER, '--module', MODULE, '--elf', ELF, '--semantics', SEMANTICS, '--out', out],
      { encoding: 'utf8', timeout: 600_000, cwd: REPO }
    )

    expect(run.status, `runner stderr:\n${run.stderr ?? ''}`).toBe(0)
    expect(existsSync(out)).toBe(true)

    // `BC\xC0\xDE` — the LLVM bitcode magic. Checked rather than assumed, because elfconv's
    // driver exits 0 on binaries it could not fully translate, so its exit code proves
    // nothing about what came out.
    const head = readFileSync(out).subarray(0, 4)
    expect([...head]).toEqual([0x42, 0x43, 0xc0, 0xde])

    // A hello-world lifted against glibc is millions of bytes. A file that is bitcode-shaped
    // but tiny would mean the lift bailed after writing a header.
    expect(statSync(out).size).toBeGreaterThan(1_000_000)
  }, 600_000)

  it.runIf(WASM_RUNNABLE)(
    `gives byte-identical output across ${String(RUNS)} runs`,
    () => {
      const dir = mkdtempSync(join(tmpdir(), 'o2-elflift-repeat-'))
      const lifts = Array.from({ length: RUNS }, (_unused, i) => liftInWasm(dir, i))

      for (const lift of lifts) expect(lift.exit).toBe(0)

      const hashes = new Set(lifts.map((lift) => lift.sha256))
      const sizes = new Set(lifts.map((lift) => lift.bytes))

      process.stdout.write(
        `[wasm-determinism] ${String(RUNS)} runs -> ${String(hashes.size)} hash(es), ` +
          `${String(sizes.size)} size(s): ${[...sizes].join(', ')}\n`
      )

      expect(hashes.size).toBe(1)
      expect(sizes.size).toBe(1)
    },
    900_000
  )

  it('says why it skipped, when it skips', () => {
    // A suite that skips silently is indistinguishable from one that passed.
    if (!WASM_RUNNABLE) {
      process.stdout.write(`[wasm-determinism] SKIPPED, missing: ${ABSENT.join('; ')}\n`)
    }
    expect(typeof WASM_RUNNABLE).toBe('boolean')
  })
})

const LINK_SCRIPT = join(REPO, 'tools', 'aot', 'link-elflift-wasm.sh')
const RELINKABLE = existsSync(LINK_SCRIPT) && existsSync(join(BUILD_ROOT, 'obj')) &&
  existsSync(join(BUILD_ROOT, 'lib'))

/**
 * Running the same bytes twice and building the same bytes twice are different properties,
 * and this repository needs both: an artifact addressed by the hash of its content is only
 * addressable if the same inputs produce that hash again.
 *
 * They also came apart here. The lift was byte-identical across four runs while the module
 * doing the lifting was NOT byte-identical across three links — so run determinism held over
 * a build that did not reproduce, and nothing in the tree would have noticed.
 */
describe('AOTW-06 — building the module twice gives the same module', () => {
  it.runIf(RELINKABLE)(
    'links byte-identically from the same objects',
    () => {
      const dir = mkdtempSync(join(tmpdir(), 'o2-relink-'))
      const hashes = ['a', 'b'].map((tag) => {
        const out = join(dir, `elflift.${tag}.wasm`)
        const run = spawnSync('bash', [LINK_SCRIPT], {
          encoding: 'utf8',
          timeout: 900_000,
          cwd: REPO,
          env: { ...process.env, OUTPUT: out }
        })
        expect(run.status, `link stderr:\n${run.stderr ?? ''}`).toBe(0)
        return createHash('sha256').update(readFileSync(out)).digest('hex')
      })

      process.stdout.write(
        `[build-reproducibility] ${hashes.map((h) => h.slice(0, 16)).join(' vs ')}\n`
      )
      expect(hashes[0]).toBe(hashes[1])
    },
    1_800_000
  )

  it('says why it skipped, when it skips', () => {
    if (!RELINKABLE) {
      process.stdout.write('[build-reproducibility] SKIPPED: no obj/ or lib/ to link from\n')
    }
    expect(typeof RELINKABLE).toBe('boolean')
  })
})

const IMAGE_GATE = gateOnImage(IMAGE)
const NATIVE_RUNNABLE = isRunnable(IMAGE_GATE) && existsSync(ELF)

describe('AOTW-06 — the native arm, which is what makes the comparison a finding', () => {
  it.runIf(NATIVE_RUNNABLE)(
    'does NOT repeat itself across two runs on one machine',
    () => {
      // This asserts a defect, deliberately. If elfconv upstream ever becomes deterministic
      // this test goes red — and that red is the correct signal, because the whole argument
      // for lifting inside wasm rests on the native arm scattering. A green here would mean
      // the argument needs re-deriving, not that the test needs relaxing.
      //
      // Two runs suffice for the assertion: four runs produced four distinct hashes AND four
      // distinct sizes, so the scatter is wide, not a rare collision.
      const dir = mkdtempSync(join(tmpdir(), 'o2-elflift-native-'))
      const script = [
        'for i in 1 2; do',
        '  /root/elfconv/build/lifter/elflift --arch aarch64 --target_elf /out/hello_static',
        '    --bc_out /out/native.$i.bc --target_arch wasi32 --logtostderr=1 > /dev/null 2>&1;',
        'done'
      ]
        .join(' ')
        .replace(/\s+/g, ' ')

      const run = spawnSync(
        'docker',
        [
          'run',
          '--rm',
          '--platform',
          'linux/arm64',
          '--entrypoint',
          '/bin/bash',
          '-v',
          `${FIXTURES}:/out`,
          IMAGE,
          '-c',
          `${script}; sha256sum /out/native.1.bc /out/native.2.bc`
        ],
        { encoding: 'utf8', timeout: 900_000 }
      )

      expect(run.status, `docker stderr:\n${run.stderr ?? ''}`).toBe(0)

      const hashes = (run.stdout ?? '')
        .split('\n')
        .map((line) => line.trim().split(/\s+/)[0])
        .filter((h) => h !== undefined && h.length === 64)

      expect(hashes.length).toBe(2)
      process.stdout.write(
        `[native-scatter] ${hashes.map((h) => h.slice(0, 16)).join(' vs ')}\n`
      )
      expect(hashes[0]).not.toBe(hashes[1])
    },
    900_000
  )

  it('says why it skipped, when it skips', () => {
    if (!NATIVE_RUNNABLE) {
      process.stdout.write(`[native-scatter] SKIPPED: ${describeGate(IMAGE_GATE)}\n`)
    }
    expect(typeof NATIVE_RUNNABLE).toBe('boolean')
  })
})
