/**
 * WASM task executor — DET-06.
 *
 * The guest sees exactly four host functions and nothing else:
 *
 *   o2.input_len()            -> i32   bytes of input available
 *   o2.input_read(ptr, len)   -> i32   copy input into guest memory, return count
 *   o2.output_write(ptr, len) -> void  take len bytes at ptr as the declared output
 *   o2.partition()            -> i32   (index << 16) | count
 *
 * No clock, no randomness, no environment, no filesystem, no WASI. WASI would
 * hand the guest all four of those, which is four nondeterminism vectors in the
 * one place determinism is the requirement.
 *
 * The module is re-validated by the admission gate here, before instantiation
 * (DET-02) — a node never runs a module it did not itself check, because it
 * cannot know whether publish-time validation was performed honestly.
 *
 * `WebAssembly` is a global in Node and in every browser, so this file has no
 * platform import and runs unchanged in all three targets.
 */

import type { CID } from 'multiformats/cid'
import { decodeCanonical } from '../canonical/encode.ts'
import type { CanonicalValue } from '../canonical/encode.ts'
import { scanModule } from '../admission/gate.ts'
import type { Blockstore, ExecutionOutcome, Executor, Task } from '../ports.ts'

/** Name of the export a task module must provide. */
export const TASK_ENTRYPOINT = 'run'

/** Shards are limited to 16 bits each by the packed `partition()` encoding. */
export const MAX_PARTITIONS = 0xffff

export interface WasmExecutorOptions {
  readonly nodeId: string
  readonly blockstore: Blockstore
  /** Cap on output size, to bound a misbehaving module. Default 1 MiB. */
  readonly maxOutputBytes?: number
}

export class WasmExecutor implements Executor {
  readonly nodeId: string
  readonly #blockstore: Blockstore
  readonly #maxOutputBytes: number

  constructor(options: WasmExecutorOptions) {
    this.nodeId = options.nodeId
    this.#blockstore = options.blockstore
    this.#maxOutputBytes = options.maxOutputBytes ?? 1024 * 1024
  }

  async execute(task: Task): Promise<ExecutionOutcome> {
    if (task.partitionCount > MAX_PARTITIONS) {
      return { ok: false, reason: `partitionCount exceeds ${MAX_PARTITIONS}` }
    }

    const moduleBytes = await this.#blockstore.get(task.moduleCid)
    if (moduleBytes === undefined) {
      return { ok: false, reason: `module block missing: ${task.moduleCid.toString()}` }
    }
    const inputBytes = await this.#blockstore.get(task.inputCid)
    if (inputBytes === undefined) {
      return { ok: false, reason: `input block missing: ${task.inputCid.toString()}` }
    }

    // DET-02: re-validate before instantiation, with the same pure function used
    // at publish time.
    const admission = scanModule(moduleBytes)
    if (!admission.ok) {
      const kinds = admission.rejections.map((r) => r.kind).join(', ')
      return { ok: false, reason: `module refused by admission gate: ${kinds}` }
    }

    // A holder rather than a bare `let`: the value is assigned inside a host
    // callback, and TypeScript's control-flow analysis cannot see that, so a
    // plain `let` narrows to `never` after the null check below.
    const sink: { bytes: Uint8Array<ArrayBuffer> | null } = { bytes: null }
    let readCursor = 0

    const imports = {
      o2: {
        input_len: (): number => inputBytes.length,
        input_read: (ptr: number, len: number): number => {
          const mem = memory
          if (mem === null) return 0
          const view = new Uint8Array(mem.buffer)
          const available = inputBytes.length - readCursor
          const n = Math.max(0, Math.min(len, available))
          if (ptr < 0 || ptr + n > view.length) return 0
          view.set(inputBytes.subarray(readCursor, readCursor + n), ptr)
          readCursor += n
          return n
        },
        output_write: (ptr: number, len: number): void => {
          const mem = memory
          if (mem === null) return
          if (len < 0 || len > this.#maxOutputBytes) return
          const view = new Uint8Array(mem.buffer)
          if (ptr < 0 || ptr + len > view.length) return
          // Copy out — the guest's memory is not stable after it returns.
          sink.bytes = view.slice(ptr, ptr + len)
        },
        partition: (): number =>
          ((task.partitionIndex & 0xffff) << 16) | (task.partitionCount & 0xffff),
      },
    }

    let memory: WebAssembly.Memory | null = null
    let instance: WebAssembly.Instance
    try {
      const module = await WebAssembly.compile(moduleBytes)
      instance = await WebAssembly.instantiate(module, imports)
    } catch (cause) {
      return {
        ok: false,
        reason: `instantiation failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      }
    }

    const exportedMemory = instance.exports['memory']
    if (exportedMemory instanceof WebAssembly.Memory) {
      memory = exportedMemory
    }

    const entry = instance.exports[TASK_ENTRYPOINT]
    if (typeof entry !== 'function') {
      return { ok: false, reason: `module exports no "${TASK_ENTRYPOINT}" function` }
    }

    try {
      ;(entry as () => void)()
    } catch (cause) {
      return {
        ok: false,
        reason: `trap during execution: ${cause instanceof Error ? cause.message : String(cause)}`,
      }
    }

    const output = sink.bytes
    if (output === null) {
      return { ok: false, reason: 'module produced no output' }
    }

    let decoded: CanonicalValue
    try {
      decoded = decodeCanonical(output)
    } catch (cause) {
      return {
        ok: false,
        reason: `output is not valid DAG-CBOR: ${cause instanceof Error ? cause.message : String(cause)}`,
      }
    }

    // Fuel is a deterministic proxy — bytes moved across the ABI. Wall time would
    // be nondeterministic, and fuel sits outside the compared digest (VER-05)
    // precisely so a cost metric can never cause honest nodes to disagree.
    return { ok: true, output: decoded, fuelUsed: inputBytes.length + output.length }
  }
}

/** Store a module in the blockstore and confirm it passes admission. */
export async function publishModule(
  bytes: Uint8Array<ArrayBuffer>,
  blockstore: Blockstore,
): Promise<{ ok: true; cid: CID } | { ok: false; reason: string }> {
  const admission = scanModule(bytes)
  if (!admission.ok) {
    return {
      ok: false,
      reason: `refused: ${admission.rejections.map((r) => r.kind).join(', ')}`,
    }
  }
  return { ok: true, cid: await blockstore.put(bytes) }
}
