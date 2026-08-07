import { ed25519 } from '@noble/curves/ed25519.js'
import { describe, expect, it } from 'vitest'
import { MAX_CHAIN_DEPTH, delegate, toHex, verifyChain } from './capability.ts'
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
      verifyChain(chainOfDepth(MAX_CHAIN_DEPTH + 1), opts),
    ]
    const reasons = cases.map((c) => (c.ok ? 'ok' : c.reason))
    expect(new Set(reasons).size).toBe(reasons.length)
  })
})

/**
 * The chain's length comes off the wire, so it is an input and needs a bound.
 *
 * Raised by the RFC-0003 review (Praxis point 7, which names "maximum chain depth" among
 * the minimum a cryptographic profile must state) and by an independent read of
 * `verifyChain`, which had **no** depth bound at all.
 *
 * ## The bound is sited, not picked
 *
 * The deepest chain anywhere in this repository is **two** links — `delegatedChain()`,
 * owner → coordinator → worker. Production builds **one**: `bin/bench.ts` delegates owner →
 * node. `MAX_CHAIN_DEPTH` is 8, so the bound is 4× the deepest chain the tree has ever
 * constructed and 8× the one it ships. If a legitimate topology ever needs more, the
 * constant moves and this comment gets a new number — that is the intended maintenance,
 * and it is cheaper than discovering the bound by having an attacker find it.
 */
function chainOfDepth(depth: number): Delegation[] {
  // Each link delegates to the next principal, so the chain is genuinely well-formed:
  // the refusal under test must be the depth, not a broken link the checker meets first.
  const principals = Array.from({ length: depth }, (_, i) => keypair(20 + i))
  const links: Delegation[] = []
  let issuer = alice.priv
  for (let i = 0; i < depth; i++) {
    const last = i === depth - 1
    links.push(
      delegate(issuer, {
        ...base,
        audience: last ? worker.pub : (principals[i] as { pub: string }).pub,
        abilities: last ? ['execute'] : ['execute', 'delegate'],
      }),
    )
    issuer = (principals[i] as { priv: Uint8Array }).priv
  }
  return links
}

describe('chain depth is bounded', () => {
  it('accepts a chain exactly at the bound', () => {
    // The other half of the bound, and the half that makes it a bound rather than a ban.
    // Without this, narrowing MAX_CHAIN_DEPTH to 1 would leave the suite green.
    const result = verifyChain(chainOfDepth(MAX_CHAIN_DEPTH), opts)
    expect(result.ok, result.ok ? '' : result.reason).toBe(true)
  })

  it('refuses a chain one link past the bound, naming the depth and the limit', () => {
    const result = verifyChain(chainOfDepth(MAX_CHAIN_DEPTH + 1), opts)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.kind).toBe('too-deep')
    expect(result.reason).toContain(String(MAX_CHAIN_DEPTH))
  })

  it('refuses a long chain instead of throwing on it', () => {
    // The defect this closes was not the unbounded loop — it was `Math.min(...chain.map())`
    // on the SUCCESS path. Spreading a wire-length array into a call blows the argument
    // stack: measured on this host, 100 000 elements is fine and 200 000 raises
    // `RangeError: Maximum call stack size exceeded`. A throw out of a security check is a
    // worse outcome than a refusal, because the caller's catch decides the verdict.
    //
    // Reaching it required a *fully valid* chain, so it was privilege abuse rather than a
    // remote crash — the loop fails fast at the first link whose issuer does not match.
    // That makes it narrow, not absent, and 250 000 forged links are cheap to send.
    // Signed ONCE and repeated. Building 250 000 real signatures took 99 s when this case
    // was first written, which is a spec that would pay that on every suite run — and this
    // file has a slow-specs guard watching for exactly that.
    const one = directChain()[0] as Delegation
    const forged: Delegation[] = new Array(250_000).fill(one)
    const result = verifyChain(forged, opts)
    expect(result.ok).toBe(false)
    if (result.ok) return
    // `too-deep` and NOT `broken-link`: the depth check must come before the loop. Measured
    // before the fix, this chain refused `broken-link` at link 1 — a correct refusal that
    // reached the right answer for a reason that does not generalise, since a chain forged
    // to be internally consistent walks the whole way.
    expect(result.failure.kind).toBe('too-deep')
  })
})
