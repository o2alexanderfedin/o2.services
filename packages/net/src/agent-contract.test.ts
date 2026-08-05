import { MemoryBlockstore, MemoryNetwork, WasmExecutor } from '@o2/core'
import { describe, expect, it } from 'vitest'
import type { AgentOptions } from './agent.ts'
import { serveAgent } from './agent.ts'
import { RpcEndpoint } from './rpc.ts'

/**
 * WIRE-01, criterion 1 — the compile-failure proof.
 *
 * The claim under test cannot be exercised at runtime: "removing a hook argument
 * fails `tsc --noEmit`, naming the hook" is a fact about the type checker, not the
 * program. `@ts-expect-error` is the mechanism that turns that fact into something
 * `npx tsc --noEmit` verifies on every run: each case below deliberately omits one
 * required hook, so without the suppression comment `tsc` reports "Property
 * '<hook>' is missing in type '...' but required in type 'AgentOptions'". If a hook
 * is ever widened back to optional, the omission stops being an error and the
 * suppression itself becomes an "Unused '@ts-expect-error' directive" error — so
 * this guard fails loudly in the direction that matters, rather than silently
 * agreeing with whatever the type happens to allow.
 */

/** A fully-specified `AgentOptions` — real rpc/executor/blockstore, all nine sentinels. */
function buildFull(): AgentOptions {
  const network = new MemoryNetwork()
  const rpc = new RpcEndpoint(network.connect('agent-contract'), { timeoutMs: 500 })
  const blockstore = new MemoryBlockstore()
  const executor = new WasmExecutor({ nodeId: 'agent-contract', blockstore })
  return {
    rpc,
    executor,
    blockstore,
    egress: 'holds-no-registrations',
    authorize: 'serves-unauthenticated',
    index: 'serves-no-records',
    capacity: 'accepts-every-offer',
    reservations: 'relays-for-nobody',
    ledger: 'keeps-no-ledger',
    onDispatch: 'reports-no-dispatch',
    enroll: 'issues-no-certificates',
    attest: 'signs-nothing',
  }
}

describe('AgentOptions requires all nine hooks — the compile-time proof', () => {
  it('accepts a fully-specified AgentOptions and does not throw', () => {
    const full = buildFull()
    expect(() => serveAgent(full)).not.toThrow()
  })

  // None of the ten `serveAgent` calls below is ever sent a request, so nothing
  // throws at runtime regardless of which hook a given case omits — the whole
  // proof lives in whether `tsc` accepts the line without the suppression.

  it('fails to compile with authorize omitted', () => {
    const full = buildFull()
    const { authorize: _unused, ...rest } = full
    // @ts-expect-error WIRE-01 — authorize is required; omitting it must fail `tsc --noEmit`, naming 'authorize'.
    expect(() => serveAgent(rest)).not.toThrow()
  })

  it('fails to compile with index omitted', () => {
    const full = buildFull()
    const { index: _unused, ...rest } = full
    // @ts-expect-error WIRE-01 — index is required; omitting it must fail `tsc --noEmit`, naming 'index'.
    expect(() => serveAgent(rest)).not.toThrow()
  })

  it('fails to compile with capacity omitted', () => {
    const full = buildFull()
    const { capacity: _unused, ...rest } = full
    // @ts-expect-error WIRE-01 — capacity is required; omitting it must fail `tsc --noEmit`, naming 'capacity'.
    expect(() => serveAgent(rest)).not.toThrow()
  })

  it('fails to compile with reservations omitted', () => {
    const full = buildFull()
    const { reservations: _unused, ...rest } = full
    // @ts-expect-error WIRE-01 — reservations is required; omitting it must fail `tsc --noEmit`, naming 'reservations'.
    expect(() => serveAgent(rest)).not.toThrow()
  })

  it('fails to compile with ledger omitted', () => {
    const full = buildFull()
    const { ledger: _unused, ...rest } = full
    // @ts-expect-error WIRE-01 — ledger is required; omitting it must fail `tsc --noEmit`, naming 'ledger'.
    expect(() => serveAgent(rest)).not.toThrow()
  })

  it('fails to compile with onDispatch omitted', () => {
    const full = buildFull()
    const { onDispatch: _unused, ...rest } = full
    // @ts-expect-error WIRE-01 — onDispatch is required; omitting it must fail `tsc --noEmit`, naming 'onDispatch'.
    expect(() => serveAgent(rest)).not.toThrow()
  })

  it('fails to compile with egress omitted', () => {
    // DATA-05. The omission this one rules out is the quietest of the eight: a node
    // that left `egress` out would register a sovereign input on every dispatch and
    // release none, and would grow slower for the rest of its life with nothing
    // failing. The type checker is the only thing that catches it at the call site.
    const full = buildFull()
    const { egress: _unused, ...rest } = full
    // @ts-expect-error WIRE-01 — egress is required; omitting it must fail `tsc --noEmit`, naming 'egress'.
    expect(() => serveAgent(rest)).not.toThrow()
  })

  it('fails to compile with enroll omitted', () => {
    // AUTH-01 / AUTH-04. What this omission would cost is specific: a node *told* to
    // issue certificates that silently issues none. Enrollment against it fails while
    // the provider looks correctly configured from the outside, and the operator has
    // nothing to read — which is the "optional hook with a silent default is a hole"
    // decision applied to the one hook where the absence is indistinguishable from an
    // unreachable node.
    const full = buildFull()
    const { enroll: _unused, ...rest } = full
    // @ts-expect-error WIRE-01 — enroll is required; omitting it must fail `tsc --noEmit`, naming 'enroll'.
    expect(() => serveAgent(rest)).not.toThrow()
  })

  it('fails to compile with attest omitted', () => {
    // VER-08 / VER-09 / VER-10. The quietest omission of the nine, and the one this
    // guard is worth the most for. A node that left `attest` out would answer every
    // combine unsigned: the frames stay well-formed, every existing assertion stays
    // green, the reduce completes with the right aggregate — and the aggregation over
    // contributions silently stops being checkable by anybody, which is the one thing
    // `PROJECT.md` names as the verified half of its own claim.
    //
    // It is also the hook that keeps a node from signing one verb and not the other.
    // `exec` reaches this identity through `attestResults`; a combine reaches it here,
    // because `serveAgent` runs a combine itself and there is no `Executor` to wrap. One
    // required hook is what stops those two routes diverging.
    //
    // The type checker is the only thing that catches this at a call site: this phase
    // measured twice that an optional field leaves `tsc --noEmit` at exit 0 while the
    // behavioural assertion fails.
    const full = buildFull()
    const { attest: _unused, ...rest } = full
    // @ts-expect-error WIRE-01 — attest is required; omitting it must fail `tsc --noEmit`, naming 'attest'.
    expect(() => serveAgent(rest)).not.toThrow()
  })
})
