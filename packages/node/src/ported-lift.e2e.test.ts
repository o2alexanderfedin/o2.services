import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { arch, tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { WasiExecutor } from '@o2/aot'
import { encodeCanonical, MemoryBlockstore } from '@o2/core'
import { beforeAll, describe, expect, it, vi } from 'vitest'

/**
 * End to end for the ELF-loader port: lift a binary with BOTH lifters, then actually RUN both
 * artifacts through the fabric's own WASI executor.
 *
 * THIS EXISTS TO CLOSE A STATED LIMIT. The commit that changed how function sizes are read
 * (off `st_size`, rather than through bfd's lossy NAME -> size rejoin) recorded plainly that
 * the new sizes were "argued correct from the ELF, not demonstrated by execution" -- the build
 * image has no wasmedge, so `elfconv.sh` exits 127 after emitting the wasm and nothing ever
 * ran it. o2 does not need wasmedge: it has {@link WasiExecutor} over
 * `@bjorn3/browser_wasi_shim`, which is the same executor the fabric uses for real tasks.
 * So the artifact can be executed here, on the tier that will actually run it.
 *
 * WHY BOTH ARMS AND NOT JUST THE NEW ONE. On `gcc_hello` the two lifters emit DIFFERENT
 * bitcode by design -- that binary carries the symbol-name collisions (`free_mem`, eight
 * times) that the sizing fix corrects. "The new artifact runs" would be weak evidence on its
 * own; "both run, and reach the same terminal state" is the claim worth making, because it
 * says the change moved function boundaries without moving observable behaviour.
 *
 * WHY THIS LIVES IN `@o2/node` AND NOT BESIDE THE EXECUTOR IT DRIVES. It was written in
 * `packages/aot/src/` first and the purity guard refused the commit, correctly: `aot` is in
 * that guard's `PORTABLE` set, so it must reference no platform-specific module, and this file
 * needs five Node builtins to drive Docker. `*.node.test.ts` is exempt from that rule and
 * `*.e2e.test.ts` is not -- so the choice was to move the file or to widen the guard, and
 * widening a guard to admit a new violation is how a portable package stops being portable.
 *
 * `not-dag-cbor` is the success signal and is not a fudge. It means the module instantiated,
 * `_start` ran to completion, and the guest wrote bytes that the codec then refused -- a
 * hello-world writes ASCII. Every other outcome this executor can produce
 * (`instantiation-failed`, `no-start`, `no-memory`, `trapped`) would mean it did not run.
 */

const HARNESS_BUDGET_MS = 900_000
vi.setConfig({ testTimeout: HARNESS_BUDGET_MS, hookTimeout: HARNESS_BUDGET_MS })

const HARNESS = 'tools/aot/elfconv-differential.sh'
const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const IMAGE = process.env['ELFCONV_IMAGE_TAG'] ?? 'ghcr.io/yomaytk/elfconv:arm64'

/** The subject whose two arms differ: the one the sizing fix actually changes. */
const SUBJECT = 'gcc_hello'

function dockerAvailable(): boolean {
  return (
    spawnSync('docker', ['version', '--format', '{{.Server.Os}}'], {
      timeout: 20_000,
      encoding: 'utf8',
    }).status === 0
  )
}

const RUNNABLE = arch() === 'arm64' && dockerAvailable()

interface Arms {
  readonly baseline: Uint8Array<ArrayBuffer>
  readonly ported: Uint8Array<ArrayBuffer>
}

async function runToCompletion(wasm: Uint8Array<ArrayBuffer>, nodeId: string): Promise<string> {
  const blockstore = new MemoryBlockstore()
  const moduleCid = await blockstore.put(wasm)
  const encoded = encodeCanonical({})
  if (!encoded.ok) throw new Error('the empty map must encode')
  const inputCid = await blockstore.put(encoded.bytes)

  const outcome = await new WasiExecutor({ nodeId, blockstore }).run({
    moduleCid,
    inputCid,
    partitionIndex: 0,
    partitionCount: 1,
  })
  return outcome.ok ? 'ok' : outcome.failure.kind
}

describe.skipIf(!RUNNABLE)('an artifact lifted by the ported loader actually runs', () => {
  let arms: Arms

  beforeAll(() => {
    const out = mkdtempSync(join(tmpdir(), 'o2-ported-lift-'))
    const run = spawnSync(
      'docker',
      [
        'run',
        '--rm',
        '-e',
        `SUBJECTS=${SUBJECT}`,
        // read-only: two specs in this repo snapshot `git status --porcelain` around
        // themselves, so the harness must not be able to touch the working tree.
        '-v',
        `${REPO_ROOT}:/repo:ro`,
        '-v',
        `${out}:/out`,
        '--entrypoint',
        '/bin/bash',
        IMAGE,
        `/repo/${HARNESS}`,
      ],
      { timeout: HARNESS_BUDGET_MS, encoding: 'utf8' },
    )

    const baseline = join(out, `${SUBJECT}.baseline.wasm`)
    const ported = join(out, `${SUBJECT}.ported.wasm`)
    if (run.status !== 0 || !existsSync(baseline) || !existsSync(ported)) {
      throw new Error(
        `harness exited ${String(run.status)} without producing both arms.\n${run.stderr ?? ''}`,
      )
    }
    // Copied into fresh ArrayBuffers: `readFileSync` hands back a Buffer over an
    // ArrayBufferLike, which neither the blockstore nor WebAssembly.compile will accept.
    arms = {
      baseline: new Uint8Array(readFileSync(baseline)),
      ported: new Uint8Array(readFileSync(ported)),
    }
  })

  it('produced two genuinely different artifacts, so the comparison is not trivial', () => {
    // Guards the guard. If the sizing fix were reverted these bytes would be equal and every
    // assertion below would still pass while testing one artifact twice.
    expect(arms.baseline.length).toBeGreaterThan(0)
    expect(Buffer.compare(Buffer.from(arms.ported), Buffer.from(arms.baseline))).not.toBe(0)
  })

  it('declares the shape WasiExecutor requires — _start and memory, WASI imports only', async () => {
    const module = await WebAssembly.compile(arms.ported)
    expect(
      WebAssembly.Module.exports(module)
        .map((e) => e.name)
        .sort(),
    ).toEqual(['_start', 'memory'])
    expect([...new Set(WebAssembly.Module.imports(module).map((e) => e.module))]).toEqual([
      'wasi_snapshot_preview1',
    ])
  })

  it('instantiates and runs _start to completion — the limit the sizing commit recorded', async () => {
    // `not-dag-cbor` = it ran and wrote bytes. This is the assertion that turns "argued
    // correct from the ELF" into "observed to execute".
    expect(await runToCompletion(arms.ported, 'ported')).toBe('not-dag-cbor')
  })

  it('reaches the SAME terminal state as the artifact it replaced', async () => {
    // The pair, which is the real claim: different bitcode, different wasm, same behaviour.
    const before = await runToCompletion(arms.baseline, 'baseline')
    const after = await runToCompletion(arms.ported, 'ported')
    expect(after).toBe(before)
    expect(after).toBe('not-dag-cbor')
  })
})
