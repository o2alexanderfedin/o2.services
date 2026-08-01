import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { canonicalCid } from '@o2/core'
import type { CanonicalValue, NodeRecords } from '@o2/core'
import { SEED_BYTES } from '@o2/libp2p'
import { encodeRequest, parseResponse, takeSovereignHold } from '@o2/net'
import type { EgressHold } from '@o2/net'
import { CID } from 'multiformats/cid'
import * as raw from 'multiformats/codecs/raw'
import { sha256 } from 'multiformats/hashes/sha2'
import { FabricNode } from './fabric-node.ts'
import type { FabricNodeOptions } from './fabric-node.ts'

/**
 * SCHED-01, owner ruling D1 — **a node names itself as a provider of what it holds**,
 * read off a real transport rather than out of a fixture.
 *
 * The `providers` request kind, its wire encoding and its handler branch have existed
 * since Phase 6, and every production node answered `[]` to it: `MemoryRecordIndex.provide()`
 * had no caller outside test files, so the index each factory served had nothing in it.
 * Plan 18-02 built `SelfRecordIndex`, which computes the answer from the node's own store
 * at ask time; Plan 18-03 gave it its production callers. **This file is where that answer
 * is read by a peer**, which is the only reading that distinguishes a wired mechanism from
 * a well-built one.
 *
 * ## What this file measures
 *
 * The `providers` answer over real libp2p over TCP, in both directions — a CID the serving
 * node holds and one nobody holds — from a node **with** a certificate and from one
 * **without**; and the agreement between the two serving branches, `block` and `providers`,
 * inside one window in which a sovereign registration is outstanding.
 *
 * ## What it does not measure
 *
 * **Discovery.** Nothing here calls `discoverExecutors`. The intersection of the two
 * lookups is Plan 18-05's, and asserting it here would be asserting a fixture: every node
 * in this file is dialled by the harness, so a "discovered" peer would only ever be one
 * this test had already introduced.
 *
 * Nor does it measure whether an **unverified** peer should be able to ask. A node answers
 * `providers` to any peer that can dial it, exactly as it answers `block` and `records`;
 * gating that on `verifiedPeers` is a question this phase raises and does not settle, and
 * it is **unmeasured, not descoped**.
 *
 * ## Why the frames are built by hand rather than through `RpcRecordIndex`
 *
 * `RpcRecordIndex.providers` **unions across every connected peer** after Plan 18-02, so a
 * test asserting one node's answer through it is asserting a union of one — and a union of
 * one is exactly the shape that would still pass if the serving node answered nothing and
 * some other peer answered instead. `encodeRequest`/`parseResponse` read the frame that one
 * named peer sent back, which is the claim these tests are making. The same reasoning, and
 * the same helper, as `node-records.node.test.ts`'s `providersOf`.
 *
 * `rpcTimeoutMs: 10_000` is set for this file rather than inherited, for the reason
 * `node-enrollment.node.test.ts` records; nothing here measures wall-clock.
 */

/** Fixed patterns, not random — a failing run must be reproducible. */
const ALICE_SEED = new Uint8Array(SEED_BYTES).fill(0xd1)

const OWNER = 'alice'

/**
 * The row the sovereign window is about.
 *
 * Distinct from every fixture in `sovereign-block-refusal.node.test.ts` and the
 * `egress-*` files, for the reason those files already record: a shared row would let one
 * file's seeding satisfy another's assertion, so a failure to seed would be invisible.
 */
const PINNED_ROW: CanonicalValue = {
  ssn: '512-77-4013',
  salary: 98_400,
  dob: '1974-11-02',
  branch: 'north-quay',
}

let workdir: string
const nodes: FabricNode[] = []

beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'o2-providers-'))
})

/** Outer 20 s against Vitest's default 10 s `hookTimeout` — see `node-enrollment.node.test.ts`. */
afterEach(async () => {
  await Promise.all(nodes.splice(0).map((n) => n.stop().catch(() => {})))
  await rm(workdir, { recursive: true, force: true })
}, 20_000)

const start = async (name: string, options: Partial<FabricNodeOptions> = {}): Promise<FabricNode> => {
  const node = await FabricNode.start({
    blockstoreDir: join(workdir, name),
    // Port 0: the OS picks a free port, so concurrent test runs cannot collide.
    listen: ['/ip4/127.0.0.1/tcp/0'],
    trustAnchors: 'runs-unsigned-artifacts',
    rpcTimeoutMs: 10_000,
    ...options,
  })
  nodes.push(node)
  return node
}

/** A provider: one boolean different from every other node in this file. */
const startIssuer = async (): Promise<FabricNode> =>
  start('issuer', { issuesCertificates: true })

/** The TCP multiaddr a peer dials this node at, peer id included. */
const addrOf = (node: FabricNode): string => {
  const addr = node.multiaddrs.find((ma) => ma.includes('/tcp/') && !ma.includes('/p2p-circuit'))
  if (addr === undefined) throw new Error(`no dialable address on ${node.peerId}`)
  return addr
}

/** A `providers` answer, read straight off the wire from the one peer that was asked. */
const providersOf = async (
  asker: FabricNode,
  servedBy: FabricNode,
  cid: CID,
): Promise<readonly string[]> => {
  const body: CanonicalValue = await asker.rpc.request(
    servedBy.peerId,
    encodeRequest({ kind: 'providers', cid }),
  )
  const response = parseResponse(body)
  if (response === null || response.kind !== 'providers') {
    throw new Error(`expected a providers answer, got ${String(response?.kind)}`)
  }
  return response.nodeKeys
}

/** A `records` answer, read the same way — so both halves come off one wire. */
const recordsOf = async (
  asker: FabricNode,
  servedBy: FabricNode,
  nodeKey: string,
): Promise<NodeRecords | null> => {
  const body: CanonicalValue = await asker.rpc.request(
    servedBy.peerId,
    encodeRequest({ kind: 'records', nodeKey }),
  )
  const response = parseResponse(body)
  if (response === null || response.kind !== 'records') {
    throw new Error(`expected a records answer, got ${String(response?.kind)}`)
  }
  return response.records
}

/** The raw `block` reply, whichever kind it is — the refusal is one of the readings. */
const blockReplyOf = async (
  asker: FabricNode,
  servedBy: FabricNode,
  cid: CID,
): Promise<{ kind: string; reason?: string; bytes?: Uint8Array | null }> => {
  const body: CanonicalValue = await asker.rpc.request(
    servedBy.peerId,
    encodeRequest({ kind: 'block', cid }),
  )
  const response = parseResponse(body)
  if (response === null) throw new Error('unparseable response')
  return response as { kind: string; reason?: string; bytes?: Uint8Array | null }
}

/** A CID nobody in this file ever puts anywhere. */
const unheldCid = async (marker: number): Promise<CID> =>
  CID.createV1(raw.code, await sha256.digest(new Uint8Array([0xbe, 0xef, marker])))

describe('SCHED-01 — a node answers a providers request about its own store', () => {
  /**
   * Both directions in one test, deliberately: an implementation that answered
   * `[a.nodeKey]` unconditionally passes the first assertion and fails the second, and one
   * that answered `[]` unconditionally does the reverse. Neither reading is worth anything
   * without the other.
   *
   * Reddened by changing `SelfRecordIndex.providers` to `return []`.
   */
  it('names itself for a block it holds, and answers [] for one nobody holds', async () => {
    const issuer = await startIssuer()
    const a = await start('a', {
      sovereignty: { ownerId: OWNER, canExecuteSovereign: true },
      enrollment: {
        userPrivateKey: ALICE_SEED,
        operatorId: 'harbour-ops',
        providerAddr: addrOf(issuer),
      },
    })
    const b = await start('b')
    await b.dial(addrOf(a))

    // Into A's **local-only** tier and nowhere else. `a.store` is the store the index was
    // given; `a.blockstore` has network fallback and is deliberately not used here,
    // because a question about what this node holds must not become a fetch.
    const held = await a.store.put(new Uint8Array([7, 7, 7, 7]))

    // The node holding it is the node named — and it is named by its **node key**, not its
    // peer id, which is what `discoverExecutors` will later intersect against `recordsFor`.
    expect(await providersOf(b, a, held)).toStrictEqual([a.nodeKey])

    // Non-vacuity, and it is not decoration: without it, `[a.nodeKey]` for everything
    // passes the line above.
    expect(await providersOf(b, a, await unheldCid(1))).toStrictEqual([])
  }, 60_000)

  /**
   * **Holding blocks is not a capability enrollment confers.**
   *
   * This is the case the pre-plan code answered `[]` for — the index was built only when a
   * certificate existed, and a node without one passed `'serves-no-records'`, so it
   * disclaimed blocks it really held in order to keep a sentinel true. It is also the case
   * a future "simplification" will reintroduce, which is why the reason is named here and
   * not merely the behaviour.
   *
   * The `records` half is read in the same test and off the same wire, so the two are shown
   * to be **independent** rather than assumed to be: this node answers `records: null` and
   * a real provider list at the same time. A test that read only `providers` could not tell
   * an unconditional index from one that had quietly started issuing itself a certificate.
   *
   * Reddened by restoring `certificate === null ? null : ownRecords(...)` and the
   * `?? 'serves-no-records'` fallback in `fabric-node.ts`.
   */
  it('answers for its blocks with no certificate at all, while still answering records with null', async () => {
    const a = await start('plain-a')
    const b = await start('plain-b')
    await b.dial(addrOf(a))

    // The premise of the test, asserted rather than assumed.
    expect(a.certificate).toBeNull()

    const held = await a.store.put(new Uint8Array([9, 9, 9, 9]))

    // Two truthful statements from one node, rather than one refusal to speak.
    expect(await recordsOf(b, a, a.nodeKey)).toBeNull()
    expect(await providersOf(b, a, held)).toStrictEqual([a.nodeKey])
    expect(await providersOf(b, a, await unheldCid(2))).toStrictEqual([])
  }, 60_000)
})

describe('SCHED-01/DATA-05 — providers never contradicts block', () => {
  /**
   * **The invariant, measured in one window rather than argued across two.**
   *
   * `serveAgent`'s `block` branch refuses a reply carrying a registered sovereign payload,
   * and the owner ruling recorded in `egress.ts` knowingly accepts that a peer **cannot
   * tell refusal from absence**. A `providers` answer of `[a.nodeKey]` about such a block
   * would convert *cannot tell* into *can tell*: the peer would learn the node holds it
   * without ever asking for the bytes and without anything appearing on the refusing node's
   * manifest. That is a side channel around a refusal.
   *
   * Three readings, in one window, and the third is what makes the second admissible:
   * without `a.store.has(cid)` being true, an answer of `[]` is indistinguishable from
   * "A does not hold it" and the test would pass against a node that had simply lost the
   * block. Without the `block` refusal, the test asserts a rule nobody is enforcing on the
   * other branch.
   *
   * **Why the hold is taken with `takeSovereignHold` rather than by running a job.**
   * 18-03-PLAN.md asks for a registration produced by the real submit path, on the grounds
   * that a hand-made one would prove the predicate reads a set nobody fills. The grounds are
   * right and the route does not exist: `submitJobWithEgress` releases every hold it took in
   * a `finally` (`submit-with-egress.ts:171-176`), which
   * `sovereign-block-refusal.node.test.ts:297` asserts outright — so **after** a job there is
   * no window, and during one there is no synchronisation point a test can name.
   * `takeSovereignHold` is not a hand-made registration: it is the exact function
   * `serveAgent` calls on every sovereign `exec` (`agent.ts:763`), given this node's own
   * `store` and its own `egress`, which are the same two values the factory passes
   * `serveAgent`. The registration is therefore byte-identical to the production one and its
   * lifetime — a hold that is given back — is precisely what the invariant is about.
   *
   * Reddened by passing `withhold: 'advertises-everything-it-holds'` at the `fabric-node.ts`
   * construction site: the block branch still refuses and `providers` starts confirming the
   * holding, which is exactly the side channel this test exists to close.
   */
  it('withholds a registered block from providers while its own block branch refuses it', async () => {
    const a = await start('holder', {
      sovereignty: { ownerId: OWNER, canExecuteSovereign: true },
    })
    const b = await start('asker')
    await b.dial(addrOf(a))

    // `canonicalCid`'s own bytes, so the CID asserted against is never read back off the
    // code under test.
    const row = await canonicalCid(PINNED_ROW)
    if (!row.ok) throw new Error('fixture not encodable')
    const stored = await a.store.put(row.bytes)
    expect(stored.toString()).toBe(row.cid.toString())

    // The instrument is shown reading before it is allowed to report a suppression: with
    // no hold outstanding, A advertises this block. Without this line, an `[]` below is
    // equally explained by a predicate that withholds everything.
    expect(a.egress.registrations).toStrictEqual([])
    expect(await providersOf(b, a, row.cid)).toStrictEqual([a.nodeKey])

    // ---- The window opens. The production registrar, on this node's own store and guard.
    const hold: EgressHold | null = await takeSovereignHold(
      {
        moduleCid: await unheldCid(3),
        inputCid: row.cid,
        partitionIndex: 0,
        partitionCount: 1,
        label: 'sovereign',
        ownerId: OWNER,
      },
      { blockstore: a.store, guard: a.egress },
    )
    expect(hold).not.toBeNull()
    if (hold === null) return

    try {
      // (1) A still holds the bytes. Without this, `[]` means nothing.
      expect(await a.store.has(row.cid)).toBe(true)

      // (2) The `block` branch refuses, by name. This is the rule the other branch must
      // agree with, read rather than assumed to be in force.
      const blockReply = await blockReplyOf(b, a, row.cid)
      expect(blockReply.kind).toBe('error')
      expect(blockReply.reason ?? '').toContain('egress refused: ')

      // (3) And `providers` says nothing about it — the two branches agree.
      expect(await providersOf(b, a, row.cid)).toStrictEqual([])
    } finally {
      hold.release()
    }

    // ---- The suppression is a **hold, not a blacklist**. A predicate resolved once — into
    // a boolean, a copied set, or a per-CID memo — would go on withholding a block whose
    // hold was given back, and this is the reading that catches it. It is also what shows
    // the two branches track each other rather than one being conservatively silent
    // forever: the block branch serves this block again too.
    expect(a.egress.registrations).toStrictEqual([])
    expect(await providersOf(b, a, row.cid)).toStrictEqual([a.nodeKey])
    expect((await blockReplyOf(b, a, row.cid)).kind).toBe('block')
  }, 60_000)
})
