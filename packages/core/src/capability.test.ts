import { ed25519 } from '@noble/curves/ed25519.js'
import { describe, expect, it } from 'vitest'
import { delegate, toHex, verifyChain } from './capability.ts'
import type { Delegation } from './capability.ts'

/**
 * AUTH-03 — a task without a valid chain is refused, and the refusal names the link.
 *
 * Deterministic keys: seeded rather than random, so a failure is reproducible and a
 * reader can tell which principal is which from the test alone.
 */
function keypair(seed: number): { priv: Uint8Array; pub: string } {
  const priv = new Uint8Array(32).fill(seed)
  return { priv, pub: toHex(ed25519.getPublicKey(priv)) }
}

const alice = keypair(1) // the data owner
const coord = keypair(2) // a coordinator she delegates to
const worker = keypair(3) // the node that will run the task
const mallory = keypair(9) // uninvited

const NOW = 1_800_000_000_000
const LATER = NOW + 60_000

const base = { ownerId: 'alice', expiresAt: LATER }

/** owner → worker, directly. */
function directChain(): Delegation[] {
  return [delegate(alice.priv, { ...base, audience: worker.pub, abilities: ['execute'] })]
}

/** owner → coordinator → worker. */
function delegatedChain(): Delegation[] {
  const first = delegate(alice.priv, {
    ...base,
    audience: coord.pub,
    abilities: ['execute', 'delegate'],
  })
  const second = delegate(coord.priv, { ...base, audience: worker.pub, abilities: ['execute'] })
  return [first, second]
}

const opts = {
  ownerKey: alice.pub,
  ownerId: 'alice',
  audience: worker.pub,
  ability: 'execute' as const,
  now: NOW,
}

describe('AUTH-03 — a valid chain is accepted', () => {
  it('accepts a direct delegation from the owner', () => {
    const result = verifyChain(directChain(), opts)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.audience).toBe(worker.pub)
    expect(result.expiresAt).toBe(LATER)
  })

  it('accepts a re-delegation through a coordinator', () => {
    expect(verifyChain(delegatedChain(), opts).ok).toBe(true)
  })

  it('expires at the earliest link, not the last', () => {
    // A long-lived tail must not extend a short-lived root.
    const first = delegate(alice.priv, {
      ownerId: 'alice',
      audience: coord.pub,
      abilities: ['execute', 'delegate'],
      expiresAt: NOW + 10_000,
    })
    const second = delegate(coord.priv, {
      ownerId: 'alice',
      audience: worker.pub,
      abilities: ['execute'],
      expiresAt: NOW + 999_999,
    })
    const result = verifyChain([first, second], opts)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.expiresAt).toBe(NOW + 10_000)
  })
})

describe('AUTH-03 — refusals name the link that broke', () => {
  it('refuses an empty chain', () => {
    const result = verifyChain([], opts)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.kind).toBe('empty-chain')
  })

  it('refuses a chain not rooted at the owner', () => {
    const forged = [delegate(mallory.priv, { ...base, audience: worker.pub, abilities: ['execute'] })]
    const result = verifyChain(forged, opts)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.kind).toBe('wrong-root')
    expect(result.reason).toContain(alice.pub)
  })

  it('refuses a chain whose links do not join up, naming the index', () => {
    // Alice delegates to the coordinator; Mallory then issues the next link.
    const first = delegate(alice.priv, {
      ...base,
      audience: coord.pub,
      abilities: ['execute', 'delegate'],
    })
    const spliced = delegate(mallory.priv, { ...base, audience: worker.pub, abilities: ['execute'] })
    const result = verifyChain([first, spliced], opts)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.kind).toBe('broken-link')
    if (result.failure.kind !== 'broken-link') return
    expect(result.failure.index).toBe(1)
    expect(result.reason).toContain('link 1')
  })

  it('refuses a tampered signature', () => {
    const chain = directChain()
    // Same claims, different audience — the signature no longer covers them.
    const tampered: Delegation[] = [{ ...chain[0]!, audience: mallory.pub }]
    const result = verifyChain(tampered, { ...opts, audience: mallory.pub })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.kind).toBe('bad-signature')
  })

  it('refuses an expired link and reports both times', () => {
    const stale = [
      delegate(alice.priv, {
        ownerId: 'alice',
        audience: worker.pub,
        abilities: ['execute'],
        expiresAt: NOW - 1,
      }),
    ]
    const result = verifyChain(stale, opts)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.kind).toBe('expired')
    expect(result.reason).toContain(String(NOW))
  })

  it('refuses a chain scoped to a different owner', () => {
    const other = [
      delegate(alice.priv, { ownerId: 'carol', audience: worker.pub, abilities: ['execute'], expiresAt: LATER }),
    ]
    const result = verifyChain(other, opts)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.kind).toBe('owner-mismatch')
  })

  it('refuses when the requested ability was never granted', () => {
    const readOnly = [delegate(alice.priv, { ...base, audience: worker.pub, abilities: ['read'] })]
    const result = verifyChain(readOnly, opts)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.kind).toBe('missing-ability')
    expect(result.reason).toContain('execute')
  })

  it('refuses re-delegation by a holder never granted "delegate"', () => {
    // The coordinator may execute but was not permitted to pass that on. Without
    // this check, any recipient could widen a capability to anyone.
    const first = delegate(alice.priv, { ...base, audience: coord.pub, abilities: ['execute'] })
    const second = delegate(coord.priv, { ...base, audience: worker.pub, abilities: ['execute'] })
    const result = verifyChain([first, second], opts)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.kind).toBe('not-delegable')
    if (result.failure.kind !== 'not-delegable') return
    expect(result.failure.index).toBe(1)
  })

  it('refuses a chain that ends at a different node', () => {
    // A capability captured in transit must not work anywhere else.
    const result = verifyChain(directChain(), { ...opts, audience: mallory.pub })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.kind).toBe('wrong-audience')
  })

  it('gives a distinct reason for every failure kind', () => {
    // A refusal that reads the same for every cause is no better than "denied".
    const cases = [
      verifyChain([], opts),
      verifyChain([delegate(mallory.priv, { ...base, audience: worker.pub, abilities: ['execute'] })], opts),
      verifyChain([delegate(alice.priv, { ...base, audience: worker.pub, abilities: ['read'] })], opts),
      verifyChain(directChain(), { ...opts, audience: mallory.pub }),
      verifyChain(directChain(), { ...opts, now: LATER + 1 }),
    ]
    const reasons = cases.map((c) => (c.ok ? 'ok' : c.reason))
    expect(new Set(reasons).size).toBe(reasons.length)
  })
})
