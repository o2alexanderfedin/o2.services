/**
 * Two things a node can measure about a guest for free, exactly, and the same on every
 * engine: how many times it called the host, and how much linear memory it ended with.
 *
 * Fuel is bytes moved across the guest ABI, so it says nothing about the work in between.
 * These two say a little more, and unlike execution time they are properties of the
 * program and its input rather than of the machine: the same module on the same input
 * makes the same host calls and grows to the same size on V8, SpiderMonkey and
 * JavaScriptCore. See `.planning/consults/2026-09-29-what-a-browser-node-can-measure-about-a-guest.md`
 * §3 item 1, which is what this implements.
 *
 * Shared by `WasmExecutor` (the four-function `o2` ABI) and `@o2/aot`'s `WasiExecutor`
 * (`wasi_snapshot_preview1`), so "a host call" means the same thing on both.
 */

/** One WebAssembly page — the unit linear memory grows in, fixed by the spec. */
export const WASM_PAGE_BYTES = 65536

/**
 * `namespace` with every function in it wrapped to count its calls, and the count.
 *
 * **Every** function, by construction rather than by list: a list would have to be kept
 * in step with the ABI, and a function added to the ABI and forgotten here would be a
 * host call nobody counted. Values that are not functions pass through untouched.
 *
 * The count is taken **as the call is entered**, before the host function runs. A host
 * function that never returns — WASI's `proc_exit` ends the run by throwing through the
 * host — is still a call the guest made, and counting on the way out would miss exactly
 * the call every WASI command module ends with.
 *
 * The wrappers forward `this`-free: every namespace this is used on is a bag of arrow
 * functions or of functions already detached by a spread, so none of them reads `this`.
 */
export function countingHostCalls<T extends object>(namespace: T): { readonly imports: T; calls(): number } {
  let calls = 0
  const imports: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(namespace)) {
    imports[name] =
      typeof value === 'function'
        ? (...args: unknown[]): unknown => {
            calls += 1
            return (value as (...a: unknown[]) => unknown)(...args)
          }
        : value
  }
  return { imports: imports as T, calls: () => calls }
}

/**
 * The size of `memory` in whole WebAssembly pages, read **after** the run.
 *
 * Linear memory never shrinks, so its size when the guest returns is the largest it ever
 * was — the peak, with no sampling. Read from the `Memory` object rather than from a
 * buffer taken earlier: a `memory.grow` detaches the old buffer, and a stale one reports
 * the size before the growth. `0` when the module exports no memory for the host to see.
 */
export function memoryPages(memory: WebAssembly.Memory | null): number {
  return memory === null ? 0 : memory.buffer.byteLength / WASM_PAGE_BYTES
}
