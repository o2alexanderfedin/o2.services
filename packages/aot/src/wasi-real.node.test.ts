import { readFileSync } from 'node:fs'
import { encodeCanonical, MemoryBlockstore } from '@o2/core'
import { WASI } from '@bjorn3/browser_wasi_shim'
import { describe, expect, it } from 'vitest'
import {
  PINNED_WASI_FUNCTIONS,
  pinnedWasiImports,
  WASI_NAMESPACE,
  WasiExecutor,
} from './wasi-executor.ts'

/**
 * The executor pointed at an artifact elfconv actually produced — AOT-04.
 *
 * Every other test of the WASI bridge runs a hand-written fixture, and those fixtures
 * were written from the same understanding as the executor. That is the shape of every
 * defect this project has recorded: a generator and a parser written in one sitting
 * agree with each other and with nothing else. `elf.real.node.test.ts` exists for
 * exactly this reason on the screening side, and until now the *execution* side had no
 * equivalent — the only use of a real translated artifact anywhere in the tree was as a
 * negative, proving `screenElf` refuses a `.wasm`.
 *
 * So the design's central premise about translated output — 23 WASI imports, `_start`
 * and `memory` and nothing else — was, until this file, an assumption stated in three
 * comments and tested against fixtures built to satisfy it.
 *
 * ## What a hello-world can and cannot establish
 *
 * The artifact is `printf("hello\n")`, so it writes ASCII to stdout, and the fabric's
 * output codec is DAG-CBOR. It therefore *cannot* produce a fabric result, and the run
 * ends in `not-dag-cbor`. That is the correct outcome and it is worth being precise
 * about what it proves: the module compiled, every import it declared was satisfied by
 * the pinned surface, it instantiated, `_start` ran to completion, and it wrote bytes.
 * Only the codec refused them. A missing or misnamed import would have failed earlier
 * and differently — `instantiation-failed`, naming the import — and the test below
 * distinguishes the two, because "it failed" would otherwise be satisfied by the bridge
 * being broken.
 *
 * Producing a *result* from a real artifact needs a guest that speaks the codec, which
 * means compiling one against the fabric's output convention rather than lifting an
 * arbitrary binary. That is a larger piece of work and it is not what AOT-04 asks for.
 *
 * ## The fixture
 *
 * `/tmp/ecvout/r1/hello.wasm`, produced by the lift recorded in
 * `tools/aot/lift.node.test.ts`. Skips cleanly when absent, for the same reason the ELF
 * fixtures do: `/tmp` does not survive a reboot and a suite that fails because a
 * scratch directory was cleaned is a suite people learn to ignore.
 */

const ARTIFACT = process.env['O2_LIFTED_WASM'] ?? '/tmp/ecvout/r1/hello.wasm'

function load(): Uint8Array<ArrayBuffer> | undefined {
  try {
    return new Uint8Array(readFileSync(ARTIFACT))
  } catch {
    return undefined
  }
}

const LIFTED = load()

/**
 * Every import a real `aarch64-wasi32` artifact declares.
 *
 * Hardcoded, and sorted, because the point of the list is that it came from a real
 * lift rather than from this repository's expectations. If elfconv's runtime grows a
 * dependency, this fails and names it — which is the notification the bridge needs,
 * since an unsatisfied import is an instantiation failure at the far end of the
 * pipeline where it reads as a fabric bug.
 */
const REAL_IMPORTS: readonly string[] = [
  'args_get',
  'args_sizes_get',
  'clock_time_get',
  'environ_get',
  'environ_sizes_get',
  'fd_close',
  'fd_fdstat_get',
  'fd_fdstat_set_flags',
  'fd_filestat_set_size',
  'fd_prestat_dir_name',
  'fd_prestat_get',
  'fd_read',
  'fd_seek',
  'fd_sync',
  'fd_write',
  'path_create_directory',
  'path_filestat_get',
  'path_open',
  'path_readlink',
  'path_remove_directory',
  'path_unlink_file',
  'poll_oneoff',
  'proc_exit',
]

describe.skipIf(LIFTED === undefined)('a real elfconv artifact, as the fabric sees it', () => {
  it('declares the ABI the whole bridge was built for, verified against a real lift', async () => {
    if (LIFTED === undefined) return
    const module = await WebAssembly.compile(LIFTED)

    const imports = WebAssembly.Module.imports(module)
    expect([...new Set(imports.map((entry) => entry.module))]).toEqual([WASI_NAMESPACE])
    expect(imports.map((entry) => entry.name).sort()).toEqual([...REAL_IMPORTS])
    expect(imports.length).toBe(23)

    // Exactly two exports. `WasiExecutor` looks up both by name and would report a
    // command module it cannot start; every fixture in this package was built to this
    // shape on the strength of a comment, and this is the observation behind it.
    expect(
      WebAssembly.Module.exports(module)
        .map((entry) => entry.name)
        .sort(),
    ).toEqual(['_start', 'memory'])
  })

  it('reaches for the wall clock, so pinning is load-bearing and not theoretical', async () => {
    if (LIFTED === undefined) return
    const declared = new Set(
      WebAssembly.Module.imports(await WebAssembly.compile(LIFTED)).map((entry) => entry.name),
    )
    // A `printf("hello\n")` imports `clock_time_get` and `poll_oneoff` — glibc's stdio
    // pulls them in whether the program asks or not. Two nodes running this artifact
    // against the shim's own imports would read two different wall clocks on the very
    // first task anyone tries.
    const reached = PINNED_WASI_FUNCTIONS.filter((name) => declared.has(name))
    expect(reached).toContain('clock_time_get')
    expect(reached).toContain('poll_oneoff')
  })

  it('is satisfied entirely by the pinned surface — no import goes unanswered', async () => {
    if (LIFTED === undefined) return
    const pinned = pinnedWasiImports(
      new WASI([], [], [], { debug: false }).wasiImport,
      { memory: null },
      () => undefined,
    )
    const missing = WebAssembly.Module.imports(await WebAssembly.compile(LIFTED))
      .map((entry) => entry.name)
      .filter((name) => typeof pinned[name] !== 'function')
    // Named rather than counted: an unsatisfied import is a one-line fix once you know
    // which one, and an unreadable failure until you do.
    expect(missing).toEqual([])
  })

  it('instantiates, runs _start to completion, and is refused only by the codec', async () => {
    if (LIFTED === undefined) return
    const blockstore = new MemoryBlockstore()
    const moduleCid = await blockstore.put(LIFTED)
    const encoded = encodeCanonical({})
    if (!encoded.ok) throw new Error('empty map does not encode')
    const inputCid = await blockstore.put(encoded.bytes)

    const outcome = await new WasiExecutor({ nodeId: 'real', blockstore }).run({
      moduleCid,
      inputCid,
      partitionIndex: 0,
      partitionCount: 1,
    })

    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    // The whole point of the assertion. `not-dag-cbor` means the guest ran and wrote
    // bytes the codec would not take — a hello-world writing ASCII. Any of
    // `instantiation-failed`, `no-start`, `no-memory` or `trapped` would mean the
    // bridge does not fit real output, and each is a distinct failure this executor
    // can produce, so the equality below is a real discrimination rather than a
    // restatement.
    expect(outcome.failure.kind).toBe('not-dag-cbor')
  })

  it('fails the same way twice, on the same host', async () => {
    if (LIFTED === undefined) return
    const blockstore = new MemoryBlockstore()
    const moduleCid = await blockstore.put(LIFTED)
    const encoded = encodeCanonical({})
    if (!encoded.ok) throw new Error('empty map does not encode')
    const inputCid = await blockstore.put(encoded.bytes)
    const task = { moduleCid, inputCid, partitionIndex: 0, partitionCount: 1 }

    const first = await new WasiExecutor({ nodeId: 'a', blockstore }).run(task)
    const second = await new WasiExecutor({ nodeId: 'b', blockstore }).run(task)
    // Weak evidence deliberately stated as weak: two runs in one process on one host.
    // It is not cross-machine reproducibility, which the lift driver reports as a
    // standing blind spot for this artifact and every other.
    expect(first).toEqual(second)
  })
})
