import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { peerIdFromString } from '@libp2p/peer-id'
import { SEED_BYTES, identityFromSeed } from '@o2/libp2p'
import { FabricNode } from './fabric-node.ts'
import type { FabricNodeOptions } from './fabric-node.ts'

/**
 * AUTH-02, the behavioural half — an unverified peer is never asked for a block.
 *
 * 17-CONTEXT.md decision 8 puts the gate at the block source's peer thunk rather than in
 * the transport, and the whole of the gate is that one line: replacing
 * `() => transport.peers` with `() => verifier.verifiedPeers` means an unverified peer is
 * never asked for a block and never appears as a dispatch candidate, structurally, with no
 * `if` anywhere that could be forgotten. `Transport` stays a three-member datagram port
 * that knows nothing about certificates, which is the property `libp2p-transport.ts`'s
 * module comment exists to protect.
 *
 * **Two limits, said here rather than left in the small print.** "Legitimate peer" means
 * **block fetching and nothing else this phase**, because `RpcBlockSource.fetch` is the
 * only production consumer of `verifiedPeers` there is. Gating dispatch candidate
 * selection, quorum membership and relay use is **UNMEASURED**, not descoped — there is no
 * production caller to gate until Phase 18's placement work, and inventing one here to
 * have something to gate would be this milestone's own defect in the opposite direction.
 *
 * **A verdict is asynchronous.** `libp2p.dial` resolving says nothing about whether a
 * records round trip has finished. Every test that reads one polls for it first, with a
 * stated deadline, and asserts it became defined before asserting anything else.
 */

const USER_SEED = new Uint8Array(SEED_BYTES).fill(0xc1)
const OTHER_USER_SEED = new Uint8Array(SEED_BYTES).fill(0xc2)
const ABSENT_A_SEED = new Uint8Array(SEED_BYTES).fill(0xe1)
const ABSENT_B_SEED = new Uint8Array(SEED_BYTES).fill(0xe2)

/**
 * Wait until `predicate` holds, or fail after `timeoutMs`.
 *
 * Local to this file and **exported nowhere**, which is deliberate: importing a symbol
 * from a `.test.ts` executes that file's module body inside the importing file's
 * collection, so this whole suite would be registered and run a second time. The
 * repository already settles it the same way — the identical signature is defined locally
 * in `relaying.node.test.ts`, `relayed-job.node.test.ts` and `rendezvous-wire.node.test.ts`
 * — and `grep -rn "from '\./[A-Za-z0-9._-]*\.test\.ts'" packages/ --include="*.ts"` finds
 * no match anywhere in the repository.
 */
async function until(predicate: () => boolean, timeoutMs: number, what: string): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise((r) => setTimeout(r, 20))
  }
  throw new Error(`timed out waiting for ${what}`)
}

let workdir: string
const nodes: FabricNode[] = []

beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'o2-peer-gate-'))
})

afterEach(async () => {
  await Promise.all(nodes.splice(0).map((n) => n.stop().catch(() => {})))
  await rm(workdir, { recursive: true, force: true })
}, 20_000)

const start = async (options: Partial<FabricNodeOptions> = {}): Promise<FabricNode> => {
  const node = await FabricNode.start({
    relayAdmission: 'admits-any-peer',
    startReporting: 'reports-its-own-start',
    listen: ['/ip4/127.0.0.1/tcp/0'],
    trustAnchors: 'runs-unsigned-artifacts',
    rpcTimeoutMs: 10_000,
    ...options,
  })
  nodes.push(node)
  return node
}

/** Stop one node out of turn, so `afterEach` does not stop it a second time. */
const stop = async (node: FabricNode): Promise<void> => {
  const at = nodes.indexOf(node)
  if (at >= 0) nodes.splice(at, 1)
  await node.stop()
}

const addrOf = (node: FabricNode): string => {
  const addr = node.multiaddrs.find((ma) => ma.includes('/tcp/') && !ma.includes('/p2p-circuit'))
  if (addr === undefined) throw new Error(`no dialable address on ${node.peerId}`)
  return addr
}

describe('AUTH-02 — the block source reads the verified subset', () => {
  /**
   * The behavioural consequence, with the instrument shown reading **both ways in one
   * test**: a fetch that succeeds beside a fetch that fails. Without the successful half,
   * "the block did not arrive" would be indistinguishable from an instrument that was
   * never switched on.
   *
   * Each block is put with `node.store.put(...)` — the local-only tier, not
   * `node.blockstore` — so it genuinely exists on exactly one node and the fetch under test
   * is a real network fetch rather than a local hit.
   *
   * Reddened by changing the block-source thunk back to `() => transport.peers`. That is
   * Plan 17-05's Mutation A.
   */
  it('fetches from the peer whose certificate chains to a pinned issuer and not from the one that does not', async () => {
    const p1 = await start({ blockstoreDir: join(workdir, 'p1'), issuesCertificates: 'issues-without-an-aggregate-budget' })
    const p2 = await start({ blockstoreDir: join(workdir, 'p2'), issuesCertificates: 'issues-without-an-aggregate-budget' })
    const a = await start({
      blockstoreDir: join(workdir, 'a'),
      enrollment: { userPrivateKey: USER_SEED, operatorId: 'harbour-ops', providerAddr: addrOf(p1) },
    })
    const c = await start({
      blockstoreDir: join(workdir, 'c'),
      enrollment: { userPrivateKey: OTHER_USER_SEED, operatorId: 'trawler-ops', providerAddr: addrOf(p2) },
    })

    const cidOnA = await a.store.put(new Uint8Array([0xa0, 0xa1, 0xa2]))
    const cidOnC = await c.store.put(new Uint8Array([0xc0, 0xc1, 0xc2]))

    const b = await start({
      blockstoreDir: join(workdir, 'b'),
      trustedIssuers: [p1.issuerKey as string],
    })
    await b.dial(addrOf(a))
    await b.dial(addrOf(c))

    // The precondition, asserted rather than slept through. A verdict is an asynchronous
    // RPC round trip kicked off from `peer:connect`; dial resolution says nothing about
    // it. Without this the verified set is empty at assertion time, BOTH fetches return
    // undefined, the success half is a flake and the failure half passes for the wrong
    // reason. This poll waits for an inherently asynchronous verdict — it is not papering
    // over a race.
    await until(
      () => b.verdictFor(a.peerId) !== undefined && b.verdictFor(c.peerId) !== undefined,
      15_000,
      'a verdict for both peers',
    )
    expect(b.verdictFor(a.peerId)).toBeDefined()
    expect(b.verdictFor(c.peerId)).toBeDefined()

    expect(await b.blockstore.get(cidOnA)).toBeDefined()
    expect(await b.blockstore.get(cidOnC)).toBeUndefined()
  }, 60_000)

  /**
   * The excluded peer is connected, not missing — an empty verified set caused by a dead
   * network would read the same as a gate that works, and these two assertions taken
   * together are what tells them apart.
   *
   * Reddened by the same thunk revert.
   */
  it('names the exclusion: C is a connected peer, absent from the verified subset, refused by issuer', async () => {
    const p1 = await start({ blockstoreDir: join(workdir, 'p1'), issuesCertificates: 'issues-without-an-aggregate-budget' })
    const p2 = await start({ blockstoreDir: join(workdir, 'p2'), issuesCertificates: 'issues-without-an-aggregate-budget' })
    const a = await start({
      blockstoreDir: join(workdir, 'a'),
      enrollment: { userPrivateKey: USER_SEED, operatorId: 'harbour-ops', providerAddr: addrOf(p1) },
    })
    const c = await start({
      blockstoreDir: join(workdir, 'c'),
      enrollment: { userPrivateKey: OTHER_USER_SEED, operatorId: 'trawler-ops', providerAddr: addrOf(p2) },
    })
    const b = await start({
      blockstoreDir: join(workdir, 'b'),
      trustedIssuers: [p1.issuerKey as string],
    })
    await b.dial(addrOf(a))
    await b.dial(addrOf(c))

    await until(
      () => b.verdictFor(a.peerId) !== undefined && b.verdictFor(c.peerId) !== undefined,
      15_000,
      'a verdict for both peers',
    )

    expect(b.transport.peers).toContain(c.peerId)
    expect(b.verifiedPeers).not.toContain(c.peerId)
    expect(b.verifiedPeers).toContain(a.peerId)

    const verdict = b.verdictFor(c.peerId)
    expect(verdict?.ok).toBe(false)
    expect(verdict?.ok === false ? verdict.failure : null).toStrictEqual({
      kind: 'untrusted-issuer',
      issuer: p2.issuerKey,
    })
  }, 60_000)

  /**
   * The regression bar, and the reason every existing spec in `packages/node` keeps
   * passing untouched: a node given no `trustedIssuers` fetches from every connected peer
   * exactly as it did before this phase.
   *
   * Reddened by deleting the empty-anchor short-circuit in `PeerVerifier.verifiedPeers` —
   * every existing test in this package loses its peers.
   */
  it('fetches from every connected peer when no trustedIssuers option was given', async () => {
    const holder = await start({ blockstoreDir: join(workdir, 'holder') })
    const cid = await holder.store.put(new Uint8Array([7, 7, 7]))

    const asker = await start({ blockstoreDir: join(workdir, 'asker') })
    await asker.dial(addrOf(holder))

    expect(asker.verifiedPeers).toStrictEqual(asker.transport.peers)
    expect(asker.verdictFor(holder.peerId)).toBeUndefined()
    expect(await asker.blockstore.get(cid)).toBeDefined()
  }, 40_000)
})

describe('AUTH-02 — stopping a node removes its verifier’s listeners', () => {
  /**
   * The absence is paired with a presence, so an inert instrument cannot pass. Both halves
   * dispatch a synthetic `peer:connect` on the node's own libp2p object, so the two
   * readings differ in exactly one thing — whether `stop()` has run.
   *
   * Neither peer id is served by anybody, so an attached listener yields an `unreachable`
   * verdict. That is a **defined** verdict, which is the reading: before `stop` one
   * appears, after it none does. Asserting only that `verifiedPeers` is empty after stop
   * would be satisfied by a verifier that never worked at all.
   *
   * Reddened by deleting `this.#verifier.stop()` from `FabricNode.stop()`.
   */
  it('produces a verdict for a connect before stop, and none for a connect after it', async () => {
    const p1 = await start({ blockstoreDir: join(workdir, 'p1'), issuesCertificates: 'issues-without-an-aggregate-budget' })
    const b = await start({
      blockstoreDir: join(workdir, 'b'),
      trustedIssuers: [p1.issuerKey as string],
    })

    const before = (await identityFromSeed(ABSENT_A_SEED)).peerId
    const after = (await identityFromSeed(ABSENT_B_SEED)).peerId

    b.libp2p.dispatchEvent(new CustomEvent('peer:connect', { detail: peerIdFromString(before) }))
    await until(() => b.verdictFor(before) !== undefined, 15_000, 'a verdict for the pre-stop connect')

    await stop(b)

    b.libp2p.dispatchEvent(new CustomEvent('peer:connect', { detail: peerIdFromString(after) }))
    await new Promise((r) => setTimeout(r, 300))
    expect(b.verdictFor(after)).toBeUndefined()

    // And the earlier verdict is still there, so this is not a verifier that never worked.
    expect(b.verdictFor(before)).toBeDefined()
  }, 40_000)

  /**
   * Why `PeerVerifier.stop()` cannot rely on `removeEventListener`, pinned against a **real
   * libp2p object** — the same discipline `RESERVATION_FAILURE_PREFIX` uses against the
   * installed relay source.
   *
   * This was not deduced. The test above failed against real libp2p while the equivalent
   * reading over a stub `EventTarget` in `peer-verifier.node.test.ts` passed, and this is
   * what the difference turned out to be: `Libp2p` extends `main-event`'s
   * `TypedEventEmitter` (`libp2p/dist/src/libp2p.js:25`), whose `addEventListener`
   * registers an **anonymous wrapper** with `super.addEventListener`
   * (`main-event/dist/src/index.js:89-104`) while `removeEventListener` hands the
   * *caller's* listener to `super.removeEventListener` (`:116-124`) — a function that was
   * never registered.
   *
   * The shape is the worst available: `listenerCount` reports the listener gone **while it
   * is still being called**. A `stop()` built on removal alone would therefore have read as
   * correct through libp2p's own counter and done nothing. If a future release fixes this,
   * this test fails and the `#stopped` flag can be reconsidered — which is the whole reason
   * to write the finding down as an assertion rather than as a comment.
   */
  it('pins the upstream defect: libp2p keeps calling a listener it reports as removed', async () => {
    const node = await start({ blockstoreDir: join(workdir, 'pin') })

    let calls = 0
    const listener = (): void => {
      calls += 1
    }

    node.libp2p.addEventListener('peer:connect', listener)
    node.libp2p.dispatchEvent(new CustomEvent('peer:connect', { detail: peerIdFromString(node.peerId) }))
    expect(calls).toBe(1)

    node.libp2p.removeEventListener('peer:connect', listener)
    node.libp2p.dispatchEvent(new CustomEvent('peer:connect', { detail: peerIdFromString(node.peerId) }))

    // The two readings that disagree. If `calls` ever reads 1 here, the package was fixed.
    expect(calls).toBe(2)
    expect(node.libp2p.listenerCount('peer:connect')).toBe(0)
  }, 40_000)
})
