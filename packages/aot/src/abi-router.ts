/**
 * One `Executor` over two — the module's declared imports pick which — AOT-04.
 *
 * A node composes both a native executor and a WASI one and chooses **per artifact**.
 * The alternative — a flag on `bin/agent.ts`, or a second node factory — would make a
 * node's capability a property of how it was started, which is the one thing this
 * project does not permit. `admission.test.ts` settled the shape and is worth quoting
 * rather than re-deriving: *"A job names one `moduleCid`, and the module decides the
 * ABI … Handing either to the other executor fails at `WebAssembly.instantiate` —
 * correctly, since the runtime is the sandbox. Executor kinds are interchangeable
 * per artifact, not within one."*
 *
 * ## This is not the deleted static analysis, and it is not an import allow-list
 *
 * Read that twice before deleting this file. It predicts **nothing** about the guest's
 * behaviour, and it decides **nothing** about which imports are permitted.
 * `WebAssembly.instantiate` still refuses anything the chosen host object does not
 * supply and still names what it refused — `wasm.ts`'s `instantiation failed` arm and
 * `wasi-executor.ts`'s `{kind:'instantiation-failed'}` arm are untouched by this file
 * and are still the sandbox.
 *
 * What that buys is the cost of being wrong: routing wrongly costs **one honest
 * instantiation failure naming the missing import**, and it cannot produce a wrong
 * result. Measured, not asserted from the armchair. On this host on 2026-08-04, under
 * Node 24's V8, handing `wasiEcho` to a bare `WasmExecutor` yields
 *
 *   `instantiation failed: WebAssembly.instantiate(): Import #0 "wasi_snapshot_preview1": module is not an object or function`
 *
 * and handing `MODULE_ECHOES_INPUT` to a bare `WasiExecutor` yields the same sentence
 * with `"o2"` in place of the namespace. That is **one engine's wording**, which is why
 * `abi-router.test.ts` asserts containment of {@link WASI_NAMESPACE} rather than the
 * whole string: that spec runs in Chromium, Firefox and WebKit as well, and containment
 * is what was measured in all three. The wording in the other two was not measured and
 * is deliberately not written down here.
 *
 * The predicate reads the module's *declared* imports, which the module itself
 * supplies. That declaration is not a credential and is not treated as one: a module
 * that declares imports it does not use, or uses imports it did not declare, fails at
 * instantiate naming what it actually asked for. The declaration decides which host
 * object the module meets, and nothing else.
 *
 * ## Two alternatives, rejected, with why
 *
 * **Run the WASI executor first and fall back on `{kind:'instantiation-failed'}`.**
 * Saves the extra compile. But when both paths fail, the reported reason is the
 * second one's — so a corrupt WASI artifact would be reported as a broken native
 * module, and an operator would go looking in the wrong place. One honest reason beats
 * one saved compile.
 *
 * **Scan the raw bytes for the ASCII `wasi_snapshot_preview1`.** Free, and a heuristic
 * that any data segment containing that string defeats. This project removes
 * heuristics.
 *
 * ## The cost, stated
 *
 * One extra `Blockstore.get` and one extra `WebAssembly.compile` per dispatch: this
 * router reads and compiles the module to decide, and the executor it delegates to
 * then reads and compiles it again. On a node the second read is local — a
 * `FetchingBlockstore` writes what it pulled into the local tier — so the extra read
 * is not a second network fetch, but it is a second read.
 *
 * **No module size and no duration appears in this comment**, because none was
 * measured on the host that wrote it. The only lifted artifact this repository has
 * ever measured is Phase 10's, and its 5.66 MB is a measurement of *that* subject; a
 * compile time derived from it would be a number nobody took.
 *
 * Memoising `moduleCid → route` is deliberately **not** done, and the reason is the
 * resource bound rather than the difficulty: an unbounded per-node map is precisely
 * what the roadmap already has open against `EgressGuard.#entries`, and opening a
 * second one while that is unresolved is not a trade this phase makes quietly.
 * `abi-router.test.ts` asserts the absence as a read count rather than leaving it as a
 * claim about source.
 *
 * Portable: no platform imports, no filesystem, no container.
 */

import { MAX_PARTITIONS } from '@o2/core'
import type { Blockstore, ExecutionOutcome, Executor, Task } from '@o2/core'
import { WASI_NAMESPACE } from './wasi-executor.ts'

export interface AbiExecutorOptions {
  /**
   * Where the module block is read from, to decide.
   *
   * The same blockstore the two executors hold, in every production composition —
   * routing off one store while executing against another is a state this interface
   * admits and no call site should build.
   */
  readonly blockstore: Blockstore
  /** Runs modules importing the fabric's own `o2.*` ABI. */
  readonly native: Executor
  /** Runs WASI command modules — a translated artifact, typically. */
  readonly wasi: Executor
}

export class AbiExecutor implements Executor {
  /**
   * Taken from `native`, never supplied separately.
   *
   * A fourth constructor argument would be a value that can drift from the one it
   * duplicates, and a node id that disagrees with the executor that produced a result
   * misnames the machine a disagreement is attributed to. Same reasoning
   * `fabric-node.ts` records for hoisting the sovereignty default.
   */
  readonly nodeId: string
  readonly #blockstore: Blockstore
  readonly #native: Executor
  readonly #wasi: Executor

  constructor(options: AbiExecutorOptions) {
    this.nodeId = options.native.nodeId
    this.#blockstore = options.blockstore
    this.#native = options.native
    this.#wasi = options.wasi
  }

  async execute(task: Task): Promise<ExecutionOutcome> {
    // Hoisted **above the read**, and this is not a duplicated check: the router
    // produces no reason of its own, it hands the task straight to the executor that
    // already refuses it. What the hoist buys is what the refusal costs.
    //
    // Today that refusal costs one integer comparison. Without this line it would cost
    // a blockstore `get` first — over the network, on a `FetchingBlockstore` — and
    // `protocol.ts` validates an incoming exec frame only for `partitionCount !== 0`
    // and `partitionIndex < partitionCount`, so a peer can put `partitionCount: 1e9`
    // on the wire with any `moduleCid` at all and choose when that fetch happens.
    // Peer-driven allocation is the subject of Phase 13.1's own criterion.
    //
    // A reader who sees only "the native executor checks this anyway" will delete
    // this; the cost, not the check, is the reason it is here.
    if (task.partitionCount > MAX_PARTITIONS) return this.#native.execute(task)

    // The two delegate-on-failure branches below are the load-bearing part.
    //
    // This router reads the module block *before* either executor does, so if it
    // invented a reason of its own for a missing or malformed module, every existing
    // test asserting on a refusal **reason** would get a different answer for a change
    // that was supposed to be behaviour-preserving. Delegating puts the report back
    // where it was — the executor reads the same block, fails the same way, and says
    // the same words. `abi-router.test.ts` compares those words against a real
    // `WasmExecutor` over the same blocks, one row per reason.
    const moduleBytes = await this.#blockstore.get(task.moduleCid)
    if (moduleBytes === undefined) return this.#native.execute(task)

    let module: WebAssembly.Module
    try {
      module = await WebAssembly.compile(moduleBytes)
    } catch {
      // Bytes that are not a module. The cause is deliberately discarded rather than
      // wrapped: the executor is about to compile the identical bytes and produce the
      // identical message, and two reports of one fault is one too many.
      return this.#native.execute(task)
    }

    const wantsWasi = WebAssembly.Module.imports(module).some(
      (entry) => entry.module === WASI_NAMESPACE,
    )
    return wantsWasi ? this.#wasi.execute(task) : this.#native.execute(task)
  }
}
