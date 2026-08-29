import { generateSubtleKeyPair, toHex, verifyChain } from '@o2/core'
import { subtleUserSigner } from '@o2/core'
import { audienceKeyOf } from '@o2/libp2p'
import { describe, expect, it } from 'vitest'
import { TAB_CHAIN_TTL_MS, chainsForOwner } from './dispatch-chain.ts'

/**
 * AUTH-03's browser half, run in a browser — Plan: the resume session of 2026-08-20.
 *
 * **This file exists in `browser` and not in `node` for one reason that is the whole
 * point:** the key it signs with is generated `extractable: false`, and that property only
 * exists on a real engine. A node test with a seed-backed signer would exercise
 * `chainsForOwner`'s logic and prove nothing about the situation it was written for — a tab
 * holding a key its own page cannot read. `capability.test.ts` covers the pure arithmetic;
 * this covers the arrangement.
 *
 * The far-end check is `verifyChain` with the **same options a serving node uses**, rather
 * than an assertion about the delegation's fields. A chain that "looks right" and is refused
 * at the node is the failure this whole piece exists to remove, so the test has to ask the
 * question the node asks.
 */
describe('chainsForOwner — a tab mints a chain for a key it cannot export', () => {
  /**
   * A real non-extractable pair, which is what a visitor's tab holds.
   *
   * **Through the production helper as of 2026-08-29, not `crypto.subtle` directly.** This
   * function wants *a key*; it is not measuring key generation. Asking the engine raw made
   * seven draws per run against a WebKit build that refuses ~0.78% of them, and this file
   * was the most frequent single casualty in CI. `visitor-key.ts:144` already asks this way.
   * See `.planning/consults/2026-08-29-webkit-linux-ed25519-keygen-rca.md`.
   */
  async function visitorPair(): Promise<CryptoKeyPair> {
    return generateSubtleKeyPair()
  }

  // Two well-formed peer ids. Their exact value does not matter; that they are DIFFERENT
  // does, because the audience is derived per node and the point of the factory is that
  // one chain is not reused across the set.
  const NODE_A = '12D3KooWB73d8eEKXuG6HyF4hmUDZRWpqLpLUXcTYmLeHu3GtJ1N'
  const NODE_B = '12D3KooWQ9VVFLTc5ZNnskwdP3UEc7iRJFW7ecdFJXvhg6Yfpwzv'

  const NOW = 1_700_000_000_000
  const task = (ownerId: string) =>
    ({ label: 'sovereign', ownerId }) as unknown as Parameters<
      ReturnType<NonNullable<Awaited<ReturnType<typeof chainsForOwner>>>>
    >[0]

  it('the private half really is unexportable, which is the premise and not an aside', async () => {
    const pair = await visitorPair()
    await expect(crypto.subtle.exportKey('pkcs8', pair.privateKey)).rejects.toThrow()
  })

  it('mints a chain a serving node accepts, per node, addressed to that node', async () => {
    const pair = await visitorPair()
    const signer = await subtleUserSigner(pair)
    const factory = await chainsForOwner(signer, {
      ownerId: signer.userKey,
      nodeIds: [NODE_A, NODE_B],
      now: () => NOW,
    })
    expect(factory).not.toBeNull()
    if (factory === null) return

    for (const nodeId of [NODE_A, NODE_B]) {
      const chain = factory(nodeId)(task(signer.userKey))
      // The question the serving node asks, with the node's own derivation of its audience.
      const verdict = verifyChain(chain, {
        ownerKey: signer.userKey,
        ownerId: signer.userKey,
        audience: audienceKeyOf(nodeId),
        ability: 'execute',
        now: NOW + 1_000,
      })
      expect(verdict.ok, `chain for ${nodeId} was refused`).toBe(true)
    }
  })

  it("refuses node B's chain at node A, so one chain is not being reused across the set", async () => {
    const pair = await visitorPair()
    const signer = await subtleUserSigner(pair)
    const factory = await chainsForOwner(signer, {
      ownerId: signer.userKey,
      nodeIds: [NODE_A, NODE_B],
      now: () => NOW,
    })
    if (factory === null) throw new Error('factory was null')

    // B's chain, checked as if it had arrived at A. This is the assertion that would still
    // pass if the audience were derived once and shared — and it is exactly the bug that
    // makes a sovereign dispatch fail at every node but one.
    const verdict = verifyChain(factory(NODE_B)(task(signer.userKey)), {
      ownerKey: signer.userKey,
      ownerId: signer.userKey,
      audience: audienceKeyOf(NODE_A),
      ability: 'execute',
      now: NOW + 1_000,
    })
    expect(verdict.ok).toBe(false)
    if (verdict.ok) return
    expect(verdict.failure.kind).toBe('wrong-audience')
  })

  it('answers null for an owner this tab is not, rather than minting a refusable chain', async () => {
    const pair = await visitorPair()
    const signer = await subtleUserSigner(pair)
    const somebodyElse = toHex(new Uint8Array(32).fill(4))
    const factory = await chainsForOwner(signer, {
      ownerId: somebodyElse,
      nodeIds: [NODE_A],
      now: () => NOW,
    })
    // Not a supplier returning `[]` — see the module docblock. A caller must be able to tell
    // "this tab cannot speak for that owner" from "this task needs no chain".
    expect(factory).toBeNull()
  })

  it('expires from the injected clock, not from when the page loaded', async () => {
    const pair = await visitorPair()
    const signer = await subtleUserSigner(pair)
    const factory = await chainsForOwner(signer, {
      ownerId: signer.userKey,
      nodeIds: [NODE_A],
      now: () => NOW,
    })
    if (factory === null) throw new Error('factory was null')
    const chain = factory(NODE_A)(task(signer.userKey))
    const opts = {
      ownerKey: signer.userKey,
      ownerId: signer.userKey,
      audience: audienceKeyOf(NODE_A),
      ability: 'execute' as const,
    }
    expect(verifyChain(chain, { ...opts, now: NOW + TAB_CHAIN_TTL_MS - 1 }).ok).toBe(true)
    const late = verifyChain(chain, { ...opts, now: NOW + TAB_CHAIN_TTL_MS + 1 })
    expect(late.ok).toBe(false)
    if (late.ok) return
    expect(late.failure.kind).toBe('expired')
  })

  it('stops a dispatch to a node it minted nothing for instead of sending it bare', async () => {
    const pair = await visitorPair()
    const signer = await subtleUserSigner(pair)
    const factory = await chainsForOwner(signer, {
      ownerId: signer.userKey,
      nodeIds: [NODE_A],
      now: () => NOW,
    })
    if (factory === null) throw new Error('factory was null')
    // The node set changed after minting. `[]` here would be indistinguishable from the
    // correct answer for a public task and the shard would go unauthenticated.
    expect(() => factory(NODE_B)(task(signer.userKey))).toThrow(/no chain was minted/)
  })

  it('returns [] for a public task, which needs no chain at all', async () => {
    const pair = await visitorPair()
    const signer = await subtleUserSigner(pair)
    const factory = await chainsForOwner(signer, {
      ownerId: signer.userKey,
      nodeIds: [NODE_A],
      now: () => NOW,
    })
    if (factory === null) throw new Error('factory was null')
    const publicTask = { label: 'public' } as unknown as Parameters<
      ReturnType<NonNullable<Awaited<ReturnType<typeof chainsForOwner>>>>
    >[0]
    expect(factory(NODE_A)(publicTask)).toEqual([])
  })
})
