import { WasiExecutor } from '@o2/aot'
import { MemoryBlockstore, submitJob, WasmExecutor } from '@o2/core'
import type {
  CanonicalValue,
  ExecutionOutcome,
  Executor,
  JobResult,
  Task,
  VerificationResult,
} from '@o2/core'
import { describe, expect, it } from 'vitest'
import { MODULE_ECHOES_INPUT } from '../../core/src/executor/fixtures.ts'
import { wasiEcho } from './fixtures/wasi-fixtures.ts'

/**
 * The kernel cannot tell a translated artifact from a source-compiled one — AOT-04.
 *
 * `wasi-executor.test.ts` already runs `WasiExecutor` through `submitJob`, and that
 * was not enough. It imports the executor from `./wasi-executor.ts`, so what it
 * established is that the file next to it can build one — a claim about a directory.
 * The acceptance criterion is a claim about a *path*: an artifact produced by binary
 * translation is admitted, sharded, executed redundantly, committed, revealed,
 * compared and costed by exactly the machinery that handles a module compiled from
 * source. Nobody standing outside `packages/aot/src` could check that, because there
 * was no way in. So this spec enters through `@o2/aot`, the way any other package
 * would, and it is the barrel export that makes the check possible at all.
 *
 * ## Why two jobs rather than one mixed one
 *
 * The tempting stronger form — one job, redundancy 2, one WASI node and one native
 * node on the *same* shard — is not merely hard, it is meaningless. A job names one
 * `moduleCid`, and the module decides the ABI: `wasi-echo` exports `_start` and
 * imports `wasi_snapshot_preview1`, `MODULE_ECHOES_INPUT` exports `run` and imports
 * `o2.*`. Handing either to the other executor fails at
 * `WebAssembly.instantiate` — correctly, since the runtime is the sandbox. Executor
 * kinds are interchangeable *per artifact*, not within one.
 *
 * So the property is stated as an equality between two runs of the same logical task
 * in two different ABIs. Both artifacts are the identity function, so every number
 * downstream is forced to agree if — and only if — nothing on the path treats them
 * differently:
 *
 *   - the shard inputs are the same values, so the input CIDs are the same;
 *   - the outputs are those same values, so the result CIDs are the same;
 *   - fuel is `input bytes + output bytes` in both executors, and echo makes those
 *     equal, so the verification multiplier and both fuel totals are the same.
 *
 * And the converse direction is checked too, because equal outcomes could in
 * principle come from a kernel that fed the two kinds different work and got lucky:
 * every executor records the `Task` it was handed, and the two ledgers must match
 * field for field. The kernel's entire contact surface with an executor is those four
 * fields — if `submitJob` ever grew a branch on executor kind, either the ledgers or
 * the outcomes would diverge here.
 */

// ---- what an executor was asked to do ----------------------------------------

/**
 * One dispatch, as seen from inside the port.
 *
 * `moduleCid` is deliberately not recorded: the two jobs run different artifacts, so
 * it is the one field that *must* differ, and including it would make the comparison
 * fail for the only reason that is not a defect. `fields` is recorded instead — the
 * kernel supplying a fifth field to one kind and not the other is precisely the
 * branch this test exists to forbid.
 */
interface Dispatch {
  readonly nodeId: string
  readonly fields: readonly string[]
  readonly inputCid: string
  readonly partitionIndex: number
  readonly partitionCount: number
  readonly outcome: ExecutionOutcome
}

/**
 * Watch an executor without disguising it.
 *
 * The first version of this was a wrapper class, and it assumed the conclusion: two
 * instances of one `Recording` class are the same class, so a `submitJob` that *did*
 * branch on executor kind would have been hidden from this test by the test's own
 * instrumentation. A `Proxy` forwards everything it is not intercepting —
 * `constructor`, `nodeId`, and `run`, which only `WasiExecutor` has — so the kernel
 * is handed something indistinguishable from the real executor and any branch it
 * might take is one this test can watch it take.
 */
function watched(inner: Executor, log: Dispatch[]): Executor {
  const record = async (task: Task): Promise<ExecutionOutcome> => {
    // `inner.execute`, never a call through the proxy: both executors keep their
    // blockstore in a `#` field, which is unreachable when `this` is a proxy.
    const outcome = await inner.execute(task)
    log.push({
      nodeId: inner.nodeId,
      fields: Object.keys(task).sort(),
      inputCid: task.inputCid.toString(),
      partitionIndex: task.partitionIndex,
      partitionCount: task.partitionCount,
      outcome,
    })
    return outcome
  }

  return new Proxy(inner, {
    get: (target, property) => (property === 'execute' ? record : Reflect.get(target, property)),
  })
}

/**
 * Every dispatch in a log, in an order that does not depend on scheduling.
 *
 * `submitJob` runs shards under `Promise.all`, so arrival order is whatever the event
 * loop chose that run. Sorting on the shard and the node makes the comparison about
 * *what* was dispatched rather than about when it happened to land.
 */
function ledger(log: readonly Dispatch[]): readonly Dispatch[] {
  return [...log].sort(
    (a, b) => a.partitionIndex - b.partitionIndex || a.nodeId.localeCompare(b.nodeId),
  )
}

// ---- what a caller can observe of a finished job -----------------------------

interface ObservedShard {
  readonly partitionIndex: number
  readonly inputCid: string
  readonly verification: Record<string, unknown>
}

interface Observed {
  readonly complete: boolean
  readonly grossFuel: number
  readonly usefulFuel: number
  readonly verificationMultiplier: number
  readonly shards: readonly ObservedShard[]
}

/** CIDs rendered as strings so a mismatch reports an address, not an object graph. */
function observeVerification(verification: VerificationResult): Record<string, unknown> {
  return verification.status === 'agreed'
    ? { ...verification, resultCid: verification.resultCid.toString() }
    : { ...verification }
}

/**
 * A job reduced to what its submitter can see.
 *
 * `moduleCid` is dropped for the reason {@link Dispatch} drops it. Everything else a
 * `JobResult` carries is kept, including the fuel totals — a kernel that charged a
 * translated artifact differently would be telling the two kinds apart in the one
 * place where it is most tempting and least visible.
 */
function observe(job: JobResult): Observed {
  return {
    complete: job.complete,
    grossFuel: job.grossFuel,
    usefulFuel: job.usefulFuel,
    verificationMultiplier: job.verificationMultiplier,
    shards: job.shards.map((shard) => ({
      partitionIndex: shard.partitionIndex,
      inputCid: shard.inputCid.toString(),
      verification: observeVerification(shard.verification),
    })),
  }
}

// ---- the claim ---------------------------------------------------------------

describe('a translated artifact reaches the fabric through the public entry point — AOT-04', () => {
  it('is admitted, verified and costed identically to a source-compiled one, and the kernel is handed the same task either way', async () => {
    // The same four shard values, run by two artifacts that compute the identity in
    // two unrelated ABIs.
    const shards: readonly CanonicalValue[] = [{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }]
    const blockstore = new MemoryBlockstore()
    const sourceCompiled = await blockstore.put(MODULE_ECHOES_INPUT)
    const translated = await blockstore.put(wasiEcho)

    // If these were the same block the equality below would be a tautology, and a
    // tautology that passes for years is worse than no test.
    expect(sourceCompiled.toString()).not.toBe(translated.toString())

    // Identical node names on both sides. `nodeId` is outside the compared digest
    // (VER-05) but it is inside `agreeing`, so differing names would make the two
    // jobs differ for a reason that has nothing to do with the artifact.
    const names = ['n1', 'n2', 'n3']
    const nativeLog: Dispatch[] = []
    const wasiLog: Dispatch[] = []
    const nativeNodes = names.map((nodeId) =>
      watched(new WasmExecutor({ nodeId, blockstore }), nativeLog),
    )
    const wasiNodes = names.map((nodeId) =>
      watched(new WasiExecutor({ nodeId, blockstore }), wasiLog),
    )

    // The kernel *could* tell these apart — the two pools are different classes and
    // only one of them has a `run` method. Everything below is the claim that it does
    // not. Asserted rather than assumed, because instrumentation that flattened the
    // difference would make the rest of this test vacuous.
    expect(nativeNodes.map((node) => node.constructor.name)).toEqual([
      'WasmExecutor',
      'WasmExecutor',
      'WasmExecutor',
    ])
    expect(wasiNodes.map((node) => node.constructor.name)).toEqual([
      'WasiExecutor',
      'WasiExecutor',
      'WasiExecutor',
    ])
    expect(wasiNodes.every((node) => 'run' in node)).toBe(true)
    expect(nativeNodes.some((node) => 'run' in node)).toBe(false)

    const fromSource = await submitJob(
      { moduleCid: sourceCompiled, shards, executors: nativeNodes, redundancy: 2 },
      blockstore,
    )
    const fromTranslation = await submitJob(
      { moduleCid: translated, shards, executors: wasiNodes, redundancy: 2 },
      blockstore,
    )

    expect(fromSource.ok).toBe(true)
    expect(fromTranslation.ok).toBe(true)
    if (!fromSource.ok || !fromTranslation.ok) return

    // Assert success before asserting sameness. Two jobs that failed in the same way
    // would satisfy every equality that follows, and the criterion is not "the
    // translated artifact fails exactly as well".
    expect(fromTranslation.job.complete).toBe(true)
    expect(fromTranslation.job.shards.map((shard) => shard.verification.status)).toEqual([
      'agreed',
      'agreed',
      'agreed',
      'agreed',
    ])
    expect(
      fromTranslation.job.shards.map((shard) =>
        shard.verification.status === 'agreed' ? shard.verification.output : null,
      ),
    ).toEqual(shards)

    // The claim, one line: the translated run and the source-compiled run are the
    // same job as far as anything downstream of `submitJob` can tell.
    expect(observe(fromTranslation.job)).toEqual(observe(fromSource.job))

    // The converse: the kernel also fed them the same work. Four shards at
    // redundancy 2 is eight dispatches, and each must match its counterpart in the
    // other pool — same node, same shard, same input CID, same outcome.
    const translatedLedger = ledger(wasiLog)
    expect(translatedLedger).toHaveLength(shards.length * 2)
    expect(translatedLedger).toEqual(ledger(nativeLog))

    // Stated separately because the equality above would also hold if the kernel
    // handed *both* kinds a fifth, kind-dependent field. The executor's whole view
    // of a job is the four fields of `Task`.
    for (const dispatch of translatedLedger) {
      expect(dispatch.fields).toEqual([
        'inputCid',
        'moduleCid',
        'partitionCount',
        'partitionIndex',
      ])
    }
  })
})
