import { ed25519 } from '@noble/curves/ed25519.js'
import { describe, expect, it } from 'vitest'
import { MemoryBlockstore } from '../blockstore/memory.ts'
import { toHex } from '../capability.ts'
import { SignedNameResolver, signName } from '../naming.ts'
import type { NameRecord } from '../naming.ts'
import type { ExecutionOutcome, Executor, Task } from '../ports.ts'
import { MODULE_ECHOES_INPUT, MODULE_WRITES_PARTITION } from './fixtures.ts'
import { guardModuleProvenance } from './module-provenance.ts'

/**
 * DET-03 / DATA-08 at the executor boundary.
 *
 * `naming.test.ts` already proves the resolver refuses the five things it refuses.
 * This file proves something the resolver cannot prove on its own: that a refusal
 * *stops the module running*. Every test here therefore reads the inner executor's
 * call counter, including the one that succeeds — a guard that reported a refusal
 * and executed anyway would satisfy every reason assertion below and fail every
 * counter assertion, which is the distinction the whole file is built around.
 *
 * Nothing here stubs the resolver. Every record is produced by `signName` and
 * offered to a real `SignedNameResolver`, because a stub would be free to agree
 * with whatever this guard happens to do.
 */

function keypair(seed: number): { priv: Uint8Array; pub: string } {
  const priv = new Uint8Array(32).fill(seed)
  return { priv, pub: toHex(ed25519.getPublicKey(priv)) }
}

const publisher = keypair(21)
const impostor = keypair(22)

const NOW = 1_800_000_000_000
const LATER = NOW + 60_000

/** The one outcome the inner executor ever produces, by identity. */
const INNER_OUTCOME: ExecutionOutcome = { ok: true, output: {}, fuelUsed: 0 }

interface CountingExecutor extends Executor {
  /** How many times `execute` actually ran. The whole point of this file. */
  calls: number
  /** The task it last saw, so "unchanged" can be asserted by identity. */
  lastTask: Task | undefined
}

function countingExecutor(nodeId = 'node-a'): CountingExecutor {
  const inner: CountingExecutor = {
    nodeId,
    calls: 0,
    lastTask: undefined,
    execute(task: Task): Promise<ExecutionOutcome> {
      inner.calls += 1
      inner.lastTask = task
      return Promise.resolve(INNER_OUTCOME)
    },
  }
  return inner
}

/**
 * Two genuinely distinct module CIDs, derived rather than written down.
 *
 * The substitution case needs a record that is valid for one artifact and a task
 * that dispatches another; hand-written CID strings would make that pair a claim
 * about two literals rather than about two modules.
 */
async function cids(): Promise<{ moduleCid: Task['moduleCid']; otherCid: Task['moduleCid']; inputCid: Task['inputCid'] }> {
  const store = new MemoryBlockstore()
  const moduleCid = await store.put(MODULE_WRITES_PARTITION)
  const otherCid = await store.put(MODULE_ECHOES_INPUT)
  const inputCid = await store.put(new Uint8Array([0xa0]))
  return { moduleCid, otherCid, inputCid }
}

function taskFor(moduleCid: Task['moduleCid'], inputCid: Task['inputCid'], moduleRecord?: NameRecord): Task {
  return moduleRecord === undefined
    ? { moduleCid, inputCid, partitionIndex: 0, partitionCount: 1 }
    : { moduleCid, inputCid, partitionIndex: 0, partitionCount: 1, moduleRecord }
}

const reasonOf = (outcome: ExecutionOutcome): string => (outcome.ok ? '' : outcome.reason)

describe('DET-03 — a module runs only when a signed record vouches for it', () => {
  it('refuses a bare CID, naming the CID and the record that did not arrive', async () => {
    const { moduleCid, inputCid } = await cids()
    const inner = countingExecutor()
    const guarded = guardModuleProvenance(inner, {
      resolver: new SignedNameResolver([publisher.pub]),
      now: () => NOW,
    })

    const outcome = await guarded.execute(taskFor(moduleCid, inputCid))

    expect(outcome.ok).toBe(false)
    expect(reasonOf(outcome)).toContain(moduleCid.toString())
    expect(reasonOf(outcome)).toContain('signed name record')
    // Reporting a refusal and refusing are different events. This is the one that
    // says the module's bytes were never fetched, let alone instantiated.
    expect(inner.calls).toBe(0)
  })

  it('refuses a perfectly-signed record from a key that was never pinned', async () => {
    const { moduleCid, inputCid } = await cids()
    const inner = countingExecutor()
    const guarded = guardModuleProvenance(inner, {
      resolver: new SignedNameResolver([publisher.pub]),
      now: () => NOW,
    })
    const forged = signName(impostor.priv, {
      name: 'kernel',
      cid: moduleCid,
      version: 1,
      expiresAt: LATER,
    })

    const outcome = await guarded.execute(taskFor(moduleCid, inputCid, forged))

    expect(outcome.ok).toBe(false)
    expect(reasonOf(outcome)).toContain(impostor.pub)
    expect(reasonOf(outcome)).toContain('not a pinned trust anchor')
    expect(inner.calls).toBe(0)
  })

  it('refuses a record altered after signing', async () => {
    const { moduleCid, otherCid, inputCid } = await cids()
    const inner = countingExecutor()
    const guarded = guardModuleProvenance(inner, {
      resolver: new SignedNameResolver([publisher.pub]),
      now: () => NOW,
    })
    const record = signName(publisher.priv, {
      name: 'kernel',
      cid: otherCid,
      version: 1,
      expiresAt: LATER,
    })

    // Swap the CID to the one the task dispatches, keep the signature — the naive
    // way to defeat the check below, and the signature is what catches it.
    const outcome = await guarded.execute(taskFor(moduleCid, inputCid, { ...record, cid: moduleCid }))

    expect(outcome.ok).toBe(false)
    expect(reasonOf(outcome)).toContain('invalid signature')
    expect(inner.calls).toBe(0)
  })

  it('refuses a genuine record that vouches for a different artifact, naming both CIDs', async () => {
    // The case a valid signature does not catch. Every anchor is pinned, the
    // signature verifies, the expiry is fresh — and the record is for another
    // module entirely.
    const { moduleCid, otherCid, inputCid } = await cids()
    const inner = countingExecutor()
    const guarded = guardModuleProvenance(inner, {
      resolver: new SignedNameResolver([publisher.pub]),
      now: () => NOW,
    })
    const elsewhere = signName(publisher.priv, {
      name: 'other-kernel',
      cid: otherCid,
      version: 1,
      expiresAt: LATER,
    })

    const outcome = await guarded.execute(taskFor(moduleCid, inputCid, elsewhere))

    expect(outcome.ok).toBe(false)
    expect(reasonOf(outcome)).toContain(otherCid.toString())
    expect(reasonOf(outcome)).toContain(moduleCid.toString())
    expect(reasonOf(outcome)).toContain('other-kernel')
    expect(inner.calls).toBe(0)
  })

  it('refuses a genuine record that has expired at the supplied clock', async () => {
    const { moduleCid, inputCid } = await cids()
    const inner = countingExecutor()
    const guarded = guardModuleProvenance(inner, {
      resolver: new SignedNameResolver([publisher.pub]),
      // The clock is injected and consulted per dispatch, so this is a decision
      // about the record and not about when the suite happened to run.
      now: () => LATER + 1,
    })
    const stale = signName(publisher.priv, {
      name: 'kernel',
      cid: moduleCid,
      version: 1,
      expiresAt: LATER,
    })

    const outcome = await guarded.execute(taskFor(moduleCid, inputCid, stale))

    expect(outcome.ok).toBe(false)
    expect(reasonOf(outcome)).toContain('expired')
    expect(inner.calls).toBe(0)
  })

  it('refuses a replay of an older version of a name it has already seen higher', async () => {
    // The guard calls `accept` on every dispatch rather than `resolve`, so the
    // resolver's own rollback protection applies per request. A guard that used a
    // throwaway resolver, or read with `resolve`, leaves the counter at 2 here.
    const { moduleCid, inputCid } = await cids()
    const inner = countingExecutor()
    const guarded = guardModuleProvenance(inner, {
      resolver: new SignedNameResolver([publisher.pub]),
      now: () => NOW,
    })
    const current = signName(publisher.priv, {
      name: 'kernel',
      cid: moduleCid,
      version: 2,
      expiresAt: LATER,
    })
    const replayed = signName(publisher.priv, {
      name: 'kernel',
      cid: moduleCid,
      version: 1,
      expiresAt: LATER,
    })

    const first = await guarded.execute(taskFor(moduleCid, inputCid, current))
    const second = await guarded.execute(taskFor(moduleCid, inputCid, replayed))

    expect(first.ok).toBe(true)
    expect(second.ok).toBe(false)
    expect(reasonOf(second)).toContain('offered version 1')
    expect(reasonOf(second)).toContain('already known')
    expect(inner.calls).toBe(1)
  })

  it('runs the task when the record verifies and names exactly the dispatched CID', async () => {
    // The positive control. Without it, every `toBe(0)` above would be satisfied by
    // a guard that refuses everything.
    const { moduleCid, inputCid } = await cids()
    const inner = countingExecutor()
    const guarded = guardModuleProvenance(inner, {
      resolver: new SignedNameResolver([publisher.pub]),
      now: () => NOW,
    })
    const record = signName(publisher.priv, {
      name: 'kernel',
      cid: moduleCid,
      version: 1,
      expiresAt: LATER,
    })
    const task = taskFor(moduleCid, inputCid, record)

    const outcome = await guarded.execute(task)

    expect(inner.calls).toBe(1)
    expect(inner.lastTask).toBe(task)
    expect(outcome).toBe(INNER_OUTCOME)
  })

  it('reports which node refused, and carries the inner executor nodeId', async () => {
    const { moduleCid, inputCid } = await cids()
    const inner = countingExecutor('node-zeta')
    const guarded = guardModuleProvenance(inner, {
      resolver: new SignedNameResolver([publisher.pub]),
      now: () => NOW,
    })

    expect(guarded.nodeId).toBe('node-zeta')
    const outcome = await guarded.execute(taskFor(moduleCid, inputCid))
    expect(reasonOf(outcome)).toContain('node-zeta')
    expect(inner.calls).toBe(0)
  })
})
