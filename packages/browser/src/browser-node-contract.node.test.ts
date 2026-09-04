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
 * instrument the ledger already accepts for this file at `M2b`. The reason given here
 * until 2026-07-31 — that `BrowserNode.start` *"needs a real `indexedDB` and a relay to
 * dial, so no Node-project test can reach this factory"* — was false, and the true one
 * is narrower: no *Node-environment* test can reach it because there is no `indexedDB`
 * in that environment, but the `e2e` project drives a real browser from Node and does
 * reach it (`packages/node/src/browser-capability.e2e.test.ts`, via
 * `packages/browser/src/capability-harness.ts`). What keeps this half structural is
 * therefore the subject rather than the factory: the claim under test is about the
 * *type*, and no runtime test of any kind can observe a required constructor argument.
 * A count of literals is not a measurement of behaviour and is not allowed to stand in
 * for one.
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
  // `whenSeedIsGone` is stated for the same reason and reads the same way: it is required
  // with no default, so it appears in every literal, and this file constructs no node so
  // the value is never taken. `startReporting` (BROW-01) is the third of the same kind and
  // the one whose requiredness cost the most to establish: it is what a visitor answered
  // about whether a row describing their device may leave it, and it is required here so
  // that no call site anywhere can build a node without having answered.
  return {
    relayAddrs: [],
    createWorker,
    trustAnchors: 'runs-unsigned-artifacts',
    whenSeedIsGone: 'mints-a-new-identity',
    startReporting: 'reports-its-own-start',
    // AUTH-06, and the fourth of the same kind: required with no default, so it appears in
    // every literal, and this file constructs no node so the value is never taken.
    identityProtection: { kind: 'writes-no-new-secret' },
  }
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

  it('fails to compile with startReporting omitted', () => {
    // BROW-01. **The guard that stops the defect coming back as a default rather than as
    // a deletion**, and it is the only kind of guard that can: a field with a default is
    // written at no call site, so every text count in this repository reads zero for it
    // and every behavioural test passes on whichever value the default happened to be.
    //
    // What the option carries is a visitor's answer to whether one row describing their
    // device may leave it. It was un-askable for the whole of Phase 20 — the factory
    // recorded the row at construction with no consent to consult — and
    // `packages/node/src/peer-ledger.e2e.test.ts` holds the measurement of what that
    // cost. `packages/node/src/start-reporting.node.test.ts` carries the identical
    // suppression for `FabricNodeOptions`, because the requiredness is not a property of
    // a tier.
    const { startReporting: _unused, ...rest } = buildFull()
    // @ts-expect-error BROW-01 — startReporting is required; omitting it must fail `tsc --noEmit`, naming 'startReporting'.
    const withoutAChoice: BrowserNodeOptions = rest
    expect(withoutAChoice.relayAddrs).toEqual([])
  })

  it('fails to compile with identityProtection omitted', () => {
    // AUTH-06, and the same guard for the same reason `startReporting`'s exists: a field
    // with a default is written at no call site, so every text count reads zero for it and
    // every behavioural test passes on whichever value the default happened to be.
    //
    // What this option carries is where a long-lived secret lives on somebody else's
    // device. `FabricNodeOptions.identityProtection` is deliberately optional — its default
    // is the arm that writes nothing, and it has 169 sibling call sites — and this one is
    // deliberately not, because `whenSeedIsGone:` has 22 and every one of them is a place
    // this goes too. The asymmetry is a count, not a preference, and this case is what stops
    // it being closed by adding a default here.
    const { identityProtection: _unused, ...rest } = buildFull()
    // @ts-expect-error AUTH-06 — identityProtection is required; omitting it must fail `tsc --noEmit`, naming 'identityProtection'.
    const withoutAPolicy: BrowserNodeOptions = rest
    expect(withoutAPolicy.relayAddrs).toEqual([])
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

describe('browser-node.ts hands the block source a verified peer list — AUTH-02', () => {
  /**
   * The one behavioural line AUTH-02's browser leg turned on, and the only instrument in
   * this repository that sees it.
   *
   * `#compose` read `new RpcBlockSource(rpc, () => transport.peers)` — the raw connected
   * set, verified against nothing — from the day the file was written until 2026-08-14.
   * The Node tier passed `() => verifier.verifiedPeers` at the matching line for the whole
   * of that period, so the asymmetry was one argument wide.
   *
   * **This is a count of literals and therefore not a measurement of behaviour**, exactly
   * as this file's header forbids treating it. It is here because the alternative is
   * nothing, and the reason is worth stating precisely rather than waving at:
   * `packages/browser/src/peer-verifier.browser.test.ts` measures the *verifier* in three
   * real engines — that a tab reaches `untrusted-issuer`, `nodeKey-mismatch`, and an
   * acceptance — but it constructs the verifier directly. It cannot observe which thunk
   * `#compose` chose. Observing that needs a tab holding a peer it *refuses*, and a tab's
   * only peer is the relay it reserved on, which puts it in the `e2e` project behind a
   * live relay.
   *
   * **`BrowserNode.verifiedPeers` is not that instrument and must not be mistaken for
   * one.** That getter reads the verifier directly, so reverting the line below to
   * `transport.peers` leaves it returning exactly the same answer — a test on the getter
   * would stay green across the reversion and would be a proof that cannot fail. What
   * follows catches the reversion and claims nothing further.
   */
  it('passes the verified set and not the raw connected set', () => {
    expect(occurrences(BROWSER_NODE, 'new RpcBlockSource(rpc, () => verifier.verifiedPeers)')).toBe(1)
    // The other half, in this file's established idiom: the count above is also satisfiable
    // by a second block source built beside the first, so the raw form is asserted absent
    // rather than merely outnumbered. The full call literal is matched, not the bare
    // `() => transport.peers` — that fragment appears in the prose two lines above the
    // composition, where it is quoting the history, and a scanner has no notion of a
    // comment. That is not hypothetical here: `peer-verifier.ts`'s own move was reported as
    // a forbidden import twice for this exact reason.
    expect(occurrences(BROWSER_NODE, 'new RpcBlockSource(rpc, () => transport.peers)')).toBe(0)
    // And the verifier the thunk reads, because deleting the construction is the other way
    // to reach a tab that verifies nobody — this time with no option left to state it.
    expect(occurrences(BROWSER_NODE, 'PeerVerifier.start(')).toBe(1)
  })
})
