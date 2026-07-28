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

/** A fully-specified `AgentOptions` — real rpc/executor/blockstore, all six sentinels. */
function buildFull(): AgentOptions {
  const network = new MemoryNetwork()
  const rpc = new RpcEndpoint(network.connect('agent-contract'), { timeoutMs: 500 })
  const blockstore = new MemoryBlockstore()
  const executor = new WasmExecutor({ nodeId: 'agent-contract', blockstore })
  return {
    rpc,
    executor,
    blockstore,
    authorize: 'serves-unauthenticated',
    index: 'serves-no-records',
    capacity: 'accepts-every-offer',
    reservations: 'relays-for-nobody',
    ledger: 'keeps-no-ledger',
    onDispatch: 'reports-no-dispatch',
  }
}

describe('AgentOptions requires all six hooks — the compile-time proof', () => {
  it('accepts a fully-specified AgentOptions and does not throw', () => {
    const full = buildFull()
    expect(() => serveAgent(full)).not.toThrow()
  })

  // None of the seven `serveAgent` calls below is ever sent a request, so nothing
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
})
