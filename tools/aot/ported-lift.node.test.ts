import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { arch, tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { WasiExecutor } from '@o2/aot'
import { encodeCanonical, MemoryBlockstore } from '@o2/core'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { describeGate, isRunnable, probeDockerReach } from './docker-gate.ts'

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
 * WHY THIS LIVES IN `tools/aot/`. It was written in `packages/aot/src/` first and the purity
 * guard refused the commit, correctly: `aot` is in that guard's `PORTABLE` set, so it must
 * reference no platform-specific module, and this file needs five Node builtins to drive
 * Docker. It went to `packages/node/src/` as an `*.e2e.test.ts`, and **that suffix was a
 * misnomer from the day it was written** -- `aot-tab.e2e.test.ts` names it outright as
 * "the trap here": this file launches no browser, it spawns Docker and drives both arms
 * through {@link WasiExecutor} directly in Node.
 *
 * **MOVED HERE 2026-09-15, and the reason is a measurement rather than tidiness.** The
 * `.e2e` suffix put a CONTAINER spec in a lane of 74 Chromium, Vite and relay files. On
 * 2026-09-15 a full `e2e` lane blew this file's 900 000 ms `beforeAll` budget and it
 * consumed **3 691 536 ms of an 86 minute lane** -- 61.5 minutes, having produced nothing.
 * That is the exact failure `vitest.config.ts` records at the `aot` project: on 2026-08-25
 * a `node` sweep lost five container specs at once, **two of them to a 900 000 ms `beforeAll`
 * budget**, and the owner ruled the repair is serialisation and NOT a larger timeout,
 * because raising the budget widens what counts as passing. `(user+sys)/real` for these
 * specs is ~0.01: they WAIT on a container rather than compute, so a wall-clock budget over
 * one measures the host's contention and never the toolchain.
 *
 * This file is not new work and it is not broken: `42-06-SUMMARY.md` records it passing
 * 4/4. It was in the wrong lane, and starved there.
 *
 * `not-dag-cbor` is the success signal and is not a fudge. It means the module instantiated,
 * `_start` ran to completion, and the guest wrote bytes that the codec then refused -- a
 * hello-world writes ASCII. Every other outcome this executor can produce
 * (`instantiation-failed`, `no-start`, `no-memory`, `trapped`) would mean it did not run.
 */

const HARNESS_BUDGET_MS = 900_000
vi.setConfig({ testTimeout: HARNESS_BUDGET_MS, hookTimeout: HARNESS_BUDGET_MS })

const HARNESS = 'tools/aot/elfconv-differential.sh'
const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url))
const IMAGE = process.env['ELFCONV_IMAGE_TAG'] ?? 'ghcr.io/yomaytk/elfconv:arm64'

/** The subject whose two arms differ: the one the sizing fix actually changes. */
const SUBJECT = 'gcc_hello'

/**
 * Which precondition is missing, or `null` -- named rather than left as a bare skip.
 *
 * A local `dockerAvailable()` stood here: `spawnSync('docker', ['version', ...])`, 20 s,
 * `status === 0`. It was the SIXTH copy of a predicate `tools/aot/` had already reduced to
 * one, and it could not be shared while this file sat under `packages/node/src/`. It also
 * carried a defect the shared gate does not: it read `status` alone, and a `spawnSync` that
 * times out can report `status: 0` (measured 2026-09-15 -- see `docker-gate.ts`'s
 * `ProbeOutcome.errno`), so a probe that never got an answer could be read as an answer.
 * {@link probeDockerReach} classifies on `errno` first and cannot make that mistake.
 */
function missingPrecondition(): string | null {
  if (arch() !== 'arm64') return `host arch is ${arch()}, the pinned image is arm64`
  const reach = probeDockerReach()
  if (!isRunnable(reach)) return describeGate(reach)
  return null
}

const MISSING = missingPrecondition()
const RUNNABLE = MISSING === null
const SKIP_NOTE = MISSING === null ? 'runnable' : `SKIPPED: ${MISSING}`

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

/** The skip reason rides in the title, as every sibling in this directory does it. */
const SUITE = `an artifact lifted by the ported loader actually runs (${SKIP_NOTE})`

describe.skipIf(!RUNNABLE)(SUITE, () => {
  let arms: Arms

  beforeAll(() => {
    const out = mkdtempSync(join(tmpdir(), 'o2-ported-lift-'))
    const container = `o2-ported-lift-${String(process.pid)}`
    const run = spawnSync(
      'docker',
      [
        'run',
        '--rm',
        // Named so the timeout path has something to address. `--rm` removes a container
        // that ENDS; it says nothing about one still running when the client is killed.
        '--name',
        container,
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
      {
        timeout: HARNESS_BUDGET_MS,
        encoding: 'utf8',
        // **Without this the budget above is not a budget.** `spawnSync` sends `killSignal`
        // at the deadline and then waits for the child to actually go, so a client that
        // holds SIGTERM is waited out in full. On 2026-09-15 this file spent **3 691 536 ms**
        // against this same 900 000 ms figure -- four times its budget -- inside an `e2e`
        // lane it then blocked. Measured in `docker-gate.node.test.ts`, which drives a stub
        // that refuses SIGTERM and requires the probe back inside three budgets.
        killSignal: 'SIGKILL',
      },
    )
    // Killing the CLIENT does not stop the CONTAINER: the build would go on burning a core
    // inside the VM for the rest of the lane, as a load source with nothing in the process
    // table to name it. That converts a bounded wait into an unattributable neighbour, which
    // is the failure this whole change is about. `|| true` in effect -- a container that
    // exited on its own is not an error here, and this must not mask the real diagnosis.
    spawnSync('docker', ['rm', '-f', container], {
      timeout: 60_000,
      killSignal: 'SIGKILL',
      encoding: 'utf8',
    })

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
