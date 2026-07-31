import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { BrowserNodeOptions } from './browser-node.ts'
import type { WorkerFactory } from './worker-executor.ts'

/**
 * BROW-04 / SCHED-06 — a browser node cannot be built without a thread to kill.
 *
 * A guest `run()` is a synchronous call (`wasm.ts`, `(entry as () => void)()`), so on
 * this tab's main thread there is nothing a deadline could interrupt: the `setTimeout`
 * that would fire is queued on the very loop the guest is holding. The bound is not
 * weaker there, it is absent — a 52-byte `loop br 0` from any peer wedged the tab
 * permanently, `stop()` included. Ending the thread is the only mechanism there is, so
 * the fix is to refuse to put a guest anywhere else.
 *
 * That is a fact about the type checker rather than about the program, and this file
 * proves it the way `packages/net/src/agent-contract.test.ts` proves WIRE-01's required
 * hooks: `@ts-expect-error` over an omission, so widening `createWorker` back to
 * optional turns the suppression itself into an "Unused '@ts-expect-error' directive"
 * error under `npm run typecheck`. The guard fails in the direction that matters
 * instead of silently agreeing with whatever the type happens to allow.
 *
 * The second half is a structural count, because `tsc` is not something
 * `mutation-guard.mutate.ts` can run — it drives vitest. It is the same weaker
 * instrument the ledger already accepts for this file at `M2b`, for the same reason:
 * `BrowserNode.start` needs a real `indexedDB` and a relay to dial, so no Node-project
 * test can reach this factory. A count of literals is not a measurement of behaviour
 * and is not allowed to stand in for one.
 *
 * Node-only: reads a real source file off disk by relative path.
 */

/**
 * Never invoked. The claim is about the factory's presence in the type, and a body
 * that throws infers `never`, which is assignable to `Worker` without a cast — so this
 * file needs no DOM and starts no node.
 */
const createWorker: WorkerFactory = () => {
  throw new Error('the contract is about the type, so this is never invoked')
}

function buildFull(): BrowserNodeOptions {
  // DET-03: this file's subject is `createWorker`'s requiredness, and it constructs no
  // node at all — `buildFull` only has to type-check. Stated rather than defaulted for
  // the reason `trustAnchors` is required at all: a reader counting this literal learns
  // exactly which files do not exercise the signed path, and this is one of them.
  return { relayAddrs: [], createWorker, trustAnchors: 'runs-unsigned-artifacts' }
}

const BROWSER_NODE = readFileSync(new URL('./browser-node.ts', import.meta.url), 'utf8')

/** How many times `needle` occurs in `text`, as a literal substring. */
function occurrences(text: string, needle: string): number {
  return text.split(needle).length - 1
}

describe('BrowserNodeOptions requires a killable thread — the compile-time proof', () => {
  it('accepts a fully-specified BrowserNodeOptions', () => {
    expect(buildFull().relayAddrs).toEqual([])
  })

  it('fails to compile with createWorker omitted', () => {
    const { createWorker: _unused, ...rest } = buildFull()
    // @ts-expect-error BROW-04/SCHED-06 — createWorker is required; omitting it must fail `tsc --noEmit`, naming 'createWorker'.
    const withoutAThread: BrowserNodeOptions = rest
    expect(withoutAThread.relayAddrs).toEqual([])
  })
})

describe('browser-node.ts composes a killable thread and nothing else', () => {
  it('constructs no main-thread executor, one worker-backed one, and branches on neither', () => {
    // Zero *constructions*, not zero mentions: the file header still names the class,
    // correctly — `WasmExecutor` is what runs inside the thread.
    expect(occurrences(BROWSER_NODE, 'new WasmExecutor(')).toBe(0)
    // The other half, because zero is also what deleting the composition produces.
    expect(occurrences(BROWSER_NODE, 'browserWorkerExecutor(')).toBe(1)
    // And the branch itself, which is the shape the defect had. A node that computes
    // is a node with a thread, so the option's absence is not a case to handle.
    expect(occurrences(BROWSER_NODE, 'options.createWorker === undefined')).toBe(0)
  })
})
