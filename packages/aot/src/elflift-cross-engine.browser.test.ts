import {
  ConsoleStdout,
  File,
  OpenFile,
  PreopenDirectory,
  WASI,
  WASIProcExit
} from '@bjorn3/browser_wasi_shim'
import { describe, expect, it } from 'vitest'

/**
 * AOTW-06 — **does the translator run, and agree with itself, on engines that are not V8?**
 *
 * `tools/aot/elflift-wasm-determinism.node.test.ts` measured that a lift inside
 * `elflift.wasm` repeats byte for byte while native elfconv scatters across four runs. That
 * was four runs of **one engine**. This file is the same lift on Chromium, Firefox and
 * WebKit, which the browser project already runs as three separate instances.
 *
 * ## Why three engines is the stronger reading, and what it is NOT
 *
 * Two identical machines running the same Node build would test one thing: whether the host
 * allocator and address-space layout leak into the output. Three engines test that **and**
 * whether anything engine-specific leaks in — a different wasm compiler, a different linear
 * memory implementation, a different `Math`, three independent readings of the same
 * specification.
 *
 * `vitest.config.ts` carries an owner ruling on exactly this and it is binding here: three
 * engines on one host are **not** three machines, and no result from this file may be
 * labelled cross-machine or distributed-hardware. What it measures is cross-**engine**
 * agreement, which is its own claim and does not need to borrow another one.
 *
 * ## The expected hash is not a magic number
 *
 * {@link EXPECTED_BITCODE_SHA256} is what the Node arm records for the same input. Naming it
 * here turns three separate "each engine agrees with itself" readings into one "all four
 * engines agree with each other", which is the claim worth having. If the artifacts are
 * regenerated the constant moves with them — and a bare mismatch is exactly the finding this
 * file exists to produce, so it must not be relaxed into a self-comparison.
 *
 * ## The agreement is not a property of one lucky input
 *
 * Watched failing, and the failure said more than the pass. Flipping one byte of the input
 * ELF (`elf[0x1000] ^= 0xff`) turned all three engines red — and turned them red with the
 * *same* answer: `bytes: 7 351 608, sha256: 81856cd9…`, identical across Chromium, Firefox
 * and WebKit. So a second, deliberately different input also produced byte-identical output
 * on three engines, which is a stronger reading than the green alone gives.
 *
 * ## Running this
 *
 * The artifacts are gitignored — 9 MB reproducible from two sources rather than committed:
 *
 *   bash tools/aot/link-elflift-wasm.sh                       # -> elflift.wasm
 *   cp <build-root>/elflift.wasm packages/aot/artifacts/
 *   cp <fixtures>/hello_static  packages/aot/artifacts/hello_static.elf
 *   cp <fixtures>/aarch64.bc    packages/aot/artifacts/
 *
 * `hello_static.elf` carries an extension it does not need on disk, and that is load-bearing
 * here: Vite serves an extensionless file by trying to parse it as a module, so the fetch
 * came back 500 with *"content contains invalid JS syntax"* until it was renamed.
 */

/** Where {@link stage} puts the artifacts. Gitignored — 9 MB reproducible from two sources. */
const ARTIFACTS = '/packages/aot/artifacts'

/**
 * sha256 of the bitcode `elflift.wasm` produces from `hello_static`, as measured in Node.
 *
 * Regenerate with:
 *   node tools/aot/run-elflift-wasm.mjs --elf <hello_static> --semantics <aarch64.bc> --out x
 */
const EXPECTED_BITCODE_SHA256 =
  'd7b67545eace2d4b' // first 16 hex digits; the full digest is asserted by the Node arm

/** And how many bytes of it. Node: 7 352 360, across four runs. */
const EXPECTED_BITCODE_BYTES = 7_352_360

const IN_NAME = 'in.elf'
const OUT_NAME = 'out.bc'
const SEM_NAME = 'aarch64.bc'

async function load (name: string): Promise<Uint8Array> {
  const response = await fetch(`${ARTIFACTS}/${name}`)
  if (!response.ok) {
    throw new Error(
      `${name} is not being served (${String(response.status)}). ` +
        'Copy elflift.wasm, hello_static and aarch64.bc into packages/aot/artifacts/ — ' +
        'see tools/aot/link-elflift-wasm.sh and the elfconv image.'
    )
  }
  return new Uint8Array(await response.arrayBuffer())
}

async function sha256Hex (bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

interface Outcome {
  readonly exit: number
  readonly bitcode: Uint8Array | undefined
  readonly stderr: string
}

/**
 * One lift, start to finish, with nothing on disk.
 *
 * The filesystem the module sees is a `Map` this function builds and reads back, so the run
 * depends on no path, no clock the caller controls, and nothing the browser persists.
 */
async function lift (
  moduleBytes: Uint8Array,
  elf: Uint8Array,
  semantics: Uint8Array
): Promise<Outcome> {
  const dir = new Map<string, File>([
    [IN_NAME, new File(elf)],
    [SEM_NAME, new File(semantics)]
  ])

  const stderr: string[] = []
  const fds = [
    new OpenFile(new File(new Uint8Array())),
    ConsoleStdout.lineBuffered(() => {}),
    ConsoleStdout.lineBuffered((line: string) => stderr.push(line)),
    new PreopenDirectory('/work', dir)
  ]

  const argv = [
    'elflift',
    '--arch=aarch64',
    `--target_elf=/work/${IN_NAME}`,
    `--bc_out=/work/${OUT_NAME}`,
    '--target_arch=wasi32',
    '--bitcode_path=/work',
    '--logtostderr=1'
  ]

  const wasi = new WASI(argv, [], fds)
  const compiled = await WebAssembly.compile(moduleBytes as BufferSource)
  const instance = await WebAssembly.instantiate(compiled, {
    wasi_snapshot_preview1: wasi.wasiImport
  })

  let exit = 0
  try {
    wasi.start(instance as never)
  } catch (error) {
    if (error instanceof WASIProcExit) exit = error.code
    else throw error
  }

  const produced = dir.get(OUT_NAME)
  return {
    exit,
    bitcode: produced === undefined ? undefined : produced.data,
    stderr: stderr.join('\n')
  }
}

describe('AOTW-06 — elflift.wasm on an engine that is not Node', () => {
  it('instantiates, and imports nothing but WASI preview1', async () => {
    const moduleBytes = await load('elflift.wasm')
    const compiled = await WebAssembly.compile(moduleBytes as BufferSource)

    const namespaces = new Set(WebAssembly.Module.imports(compiled).map((i) => i.module))
    expect([...namespaces]).toEqual(['wasi_snapshot_preview1'])

    // No thread_spawn: the translator creates no thread, which is what makes a single
    // linear memory the whole of its state.
    const names = WebAssembly.Module.imports(compiled).map((i) => i.name)
    expect(names).not.toContain('thread_spawn')

    const exports = WebAssembly.Module.exports(compiled).map((e) => e.name).sort()
    expect(exports).toEqual(['_start', 'memory'])
  }, 300_000)

  it('lifts an AArch64 binary to the same bitcode Node produced', async () => {
    const [moduleBytes, elf, semantics] = await Promise.all([
      load('elflift.wasm'),
      load('hello_static.elf'),
      load('aarch64.bc')
    ])

    const outcome = await lift(moduleBytes, elf, semantics)

    expect(outcome.exit, `elflift stderr:\n${outcome.stderr.slice(-2000)}`).toBe(0)
    expect(outcome.bitcode).toBeDefined()

    const bitcode = outcome.bitcode as Uint8Array
    // `BC\xC0\xDE`. Checked rather than assumed — elfconv's driver exits 0 on binaries it
    // could not fully translate, so its exit code proves nothing about what came out.
    expect([...bitcode.subarray(0, 4)]).toEqual([0x42, 0x43, 0xc0, 0xde])

    const digest = await sha256Hex(bitcode)

    // Asserted as one object rather than two separate expectations, so that a failure prints
    // both readings together and a reader of this file sees the measurement without running
    // it. The length is a second, independent check: a digest mismatch alone leaves open
    // whether the engines disagreed about the content or about how much of it there was.
    expect({ bytes: bitcode.length, sha256: digest.slice(0, 16) }).toEqual({
      bytes: EXPECTED_BITCODE_BYTES,
      sha256: EXPECTED_BITCODE_SHA256
    })
  }, 900_000)
})
