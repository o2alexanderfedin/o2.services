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
 * **The import object is the sandbox.** A module importing anything else — a
 * clock, an RNG, a WASI function — fails at `WebAssembly.instantiate` with a
 * TypeError naming the import. There is no allow-list to maintain, because the
 * runtime enforces it.
 *
 * There is deliberately no static determinism analysis here. Divergence is
 * *detected*, not predicted: two nodes run the task, their outputs are serialized
 * and compared, and a mismatch is reported with the dissenting node named (see
 * `../job/verify.ts`). Trying to prove ahead of time that a module cannot diverge
 * is a far harder problem than comparing two byte strings, and the comparison is
 * the mechanism regardless. The cost of a nondeterministic module is one wasted
 * redundant execution and a reported disagreement — which is exactly what
 * redundancy exists to surface.
 *
 * `WebAssembly` is a global in Node and in every browser, so this file has no
 * platform import and runs unchanged in all three targets.
 */

import { decodeCanonical } from '../canonical/encode.ts'
import type { CanonicalValue } from '../canonical/encode.ts'
import type { Blockstore, ExecutionOutcome, Executor, Task } from '../ports.ts'

/** Name of the export a task module must provide. */
export const TASK_ENTRYPOINT = 'run'

/** Shards are limited to 16 bits each by the packed `partition()` encoding. */
export const MAX_PARTITIONS = 0xffff

export interface WasmExecutorOptions {
  readonly nodeId: string
  readonly blockstore: Blockstore
  /**
   * Cap on output size, to bound a misbehaving module. Default 1 MiB.
   *
   * **Per node, and that is a disagreement this file does not close.** Two honest
   * nodes configured differently reach different verdicts on the same
   * content-addressed module and input, and the verdict is then committed to and
   * compared as though it were the module's answer. What this file does is make that
   * disagreement diagnosable — the refusal names the cap and the attempted length —
   * rather than mysterious. Closing it means the bound belonging to the artifact or
   * the task rather than to the node, which is a different requirement.
   */
  readonly maxOutputBytes?: number
}

/**
 * What one execution's `output_write` calls came to.
 *
 * Three states in one value, so the host cannot hold a refusal and a set of bytes at
 * the same time. That combination is exactly what a pair of fields made
 * representable, and it is what let a refused write be reported as no write at all.
 */
type OutputSlot =
  | { state: 'empty' }
  | { state: 'written'; bytes: Uint8Array<ArrayBuffer> }
  | { state: 'refused'; reason: string }

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

    // One slot holding three states, not two fields whose agreement somebody has to
    // remember. "Bytes present alongside a refusal" is the shape this executor used
    // to be able to reach, and it is not expressible here.
    //
    // Behind an object for the reason the previous shape was: the assignments happen
    // inside host callbacks, and TypeScript's control-flow analysis cannot see them —
    // a bare `let` stays narrowed to the state it was initialised with.
    const sink: { at: OutputSlot } = { at: { state: 'empty' } }
    let readCursor = 0
    let memory: WebAssembly.Memory | null = null

    const imports = {
      o2: {
        input_len: (): number => inputBytes.length,
        input_read: (ptr: number, len: number): number => {
          if (memory === null) return 0
          const view = new Uint8Array(memory.buffer)
          const available = inputBytes.length - readCursor
          const n = Math.max(0, Math.min(len, available))
          if (ptr < 0 || ptr + n > view.length) return 0
          view.set(inputBytes.subarray(readCursor, readCursor + n), ptr)
          readCursor += n
          return n
        },
        output_write: (ptr: number, len: number): void => {
          // A refusal is absorbing. Without this a module spends a refusal and then
          // launders it with a smaller acceptable write, and the host reports the
          // small one as the module's answer.
          if (sink.at.state === 'refused') return
          if (memory === null) {
            sink.at = { state: 'refused', reason: 'module exported no memory to read output from' }
            return
          }
          if (len < 0) {
            sink.at = { state: 'refused', reason: `output_write called with a length of ${len}` }
            return
          }
          if (len > this.#maxOutputBytes) {
            // `output-too-large` is `packages/aot/src/wasi-executor.ts`'s term for the
            // same condition, repeated verbatim so an operator greps once and finds
            // both executors. The term is shared; the code is not — the two have
            // different ABIs and different failure types and change for different
            // reasons.
            sink.at = {
              state: 'refused',
              reason: `output-too-large: output of ${len} bytes exceeds the ${this.#maxOutputBytes}-byte cap`,
            }
            return
          }
          const view = new Uint8Array(memory.buffer)
          if (ptr < 0 || ptr + len > view.length) {
            sink.at = {
              state: 'refused',
              reason: `output_write at ${ptr} for ${len} bytes is outside the module's ${view.length}-byte memory`,
            }
            return
          }
          // Copy out — the guest's memory is not stable after it returns.
          sink.at = { state: 'written', bytes: view.slice(ptr, ptr + len) }
        },
        partition: (): number =>
          ((task.partitionIndex & 0xffff) << 16) | (task.partitionCount & 0xffff),
      },
    }

    let instance: WebAssembly.Instance
    try {
      const module = await WebAssembly.compile(moduleBytes)
      instance = await WebAssembly.instantiate(module, imports)
    } catch (cause) {
      // Covers malformed bytes, a failed validation, and — importantly — any
      // import the host does not provide.
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

    const wrote = sink.at
    if (wrote.state === 'refused') return { ok: false, reason: wrote.reason }
    // Now means literally what it says: the module never called `output_write`.
    if (wrote.state === 'empty') return { ok: false, reason: 'module produced no output' }
    const output = wrote.bytes

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
