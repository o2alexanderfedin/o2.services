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
import { countingHostCalls, memoryPages } from './guest-meter.ts'
import { assertMemoryCap, checkMemoryCap, DEFAULT_MAX_MEMORY_PAGES, describeMemoryRefusal } from './guest-memory.ts'

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
  /**
   * The most linear memory a guest may declare, in 64 KiB pages. Default
   * {@link DEFAULT_MAX_MEMORY_PAGES} (256 MiB).
   *
   * A module whose memory — defined or imported — declares a maximum above this is
   * refused before it is instantiated, so the engine never allocates for it. The engine
   * then holds every admitted guest to its own declared maximum, exactly and the same way
   * on every host. A memory that declares **no** maximum is admitted and runs unbounded,
   * as it did before the cap (#47; the reason is in `guest-memory.ts`). Per node, with the same caveat as `maxOutputBytes`: two nodes
   * with different caps can reach different verdicts on one module, and the refusal names
   * both numbers so that is diagnosable.
   */
  readonly maxMemoryPages?: number
  /**
   * The monotonic clock the guest's run time is read from, in milliseconds. Defaults to
   * `performance.now()`, which exists in Node and in every browser; injected so a test
   * can state the time rather than wait for it. Read exactly twice per run — just before
   * the guest's entrypoint is called and just after it returns — and never by the guest,
   * whose only imports are the four above.
   */
  readonly now?: () => number
}

/** The default guest-time clock: monotonic, and present on every tier this file runs on. */
function monotonicNow(): number {
  return performance.now()
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
  readonly #maxMemoryPages: number
  readonly #now: () => number

  constructor(options: WasmExecutorOptions) {
    this.nodeId = options.nodeId
    this.#blockstore = options.blockstore
    this.#maxOutputBytes = options.maxOutputBytes ?? 1024 * 1024
    this.#maxMemoryPages = assertMemoryCap(options.maxMemoryPages ?? DEFAULT_MAX_MEMORY_PAGES)
    this.#now = options.now ?? monotonicNow
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

    // Every import counted, by wrapping the namespace rather than by editing each function:
    // a function added to the ABI later is counted without anyone remembering to. A call a
    // start function makes during instantiation is counted too — the guest made it.
    const counted = countingHostCalls(imports.o2)

    let module: WebAssembly.Module
    let instance: WebAssembly.Instance
    try {
      module = await WebAssembly.compile(moduleBytes)
    } catch (cause) {
      // Malformed bytes or a failed validation.
      return {
        ok: false,
        reason: `instantiation failed: ${cause instanceof Error ? cause.message : String(cause)}`,
      }
    }
    // Between compiling and instantiating, on purpose. After compiling, because the bytes
    // are then known to be a valid module, so a declaration the reader cannot follow is a
    // refusal rather than a malformed module's error. Before instantiating, because that is
    // where the engine allocates the memory and runs any start function.
    const memoryCap = checkMemoryCap(moduleBytes, this.#maxMemoryPages, { uncapped: 'admit' })
    if (!memoryCap.ok) return { ok: false, reason: describeMemoryRefusal(memoryCap.refusal) }
    try {
      instance = await WebAssembly.instantiate(module, { o2: counted.imports })
    } catch (cause) {
      // Covers — importantly — any import the host does not provide, and a start
      // function that traps.
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

    // The guest's run and nothing else: compilation, instantiation and decoding are the
    // host's work and sit outside the two readings.
    const started = this.#now()
    try {
      ;(entry as () => void)()
    } catch (cause) {
      return {
        ok: false,
        reason: `trap during execution: ${cause instanceof Error ? cause.message : String(cause)}`,
      }
    }

    const execMs = this.#now() - started

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
    // `execMs` is that wall time, carried beside fuel rather than instead of it: this
    // node's own reading, outside the digest for the same reason, and unverifiable.
    // Unsigned by construction, and the sentinel is what says so. This class is kernel
    // code: it holds a blockstore and a node id, and no key and no certificate. A
    // kernel that signed would need an identity, which is the thing `ports.ts` exists to
    // keep out. Signing is a wrapper composed at a node's construction —
    // `executor/attesting-executor.ts` — exactly as module provenance is.
    return {
      ok: true,
      output: decoded,
      fuelUsed: inputBytes.length + output.length,
      execMs,
      // Exact and the same on every engine, unlike `execMs` — and outside the digest all
      // the same, beside fuel: holding replicas to them is a decision not taken yet.
      hostCalls: counted.calls(),
      // Read after the run from the `Memory` object; memory never shrinks, so this is the peak.
      peakMemoryPages: memoryPages(memory),
      attestation: 'signed-by-nobody',
    }
  }
}
