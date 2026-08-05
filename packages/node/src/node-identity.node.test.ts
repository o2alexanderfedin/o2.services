import { readdirSync, statSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SEED_BYTES, nodeKeyForPeerId, peerIdForNodeKey } from '@o2/libp2p'
import { FabricNode } from './fabric-node.ts'
import type { FabricNodeOptions } from './fabric-node.ts'
import { FsBlockstore } from './fs-blockstore.ts'
import { IDENTITY_FILE, PROVIDER_FILE } from './identity-store.ts'

/**
 * AUTH-01 — a running node's identity, on the production startup path.
 *
 * Before this plan `createLibp2p` was called with **no `privateKey`**, so libp2p minted a
 * fresh ephemeral key on every process start and nothing about a node's identity outlived
 * its process. These tests bind real sockets on 127.0.0.1 and stop every node in
 * `afterEach`.
 *
 * **Nothing here branches on a kind of node.** Whether a process holds a provider signing
 * key is one boolean option among the others; every node built below has the identical
 * executor, transport, relay capability and protocol surface.
 */

let workdir: string
const nodes: FabricNode[] = []

beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'o2-node-identity-'))
})

/**
 * Inner: `FabricNode.stop()` terminates a worker thread and stops libp2p. Outer 20 s
 * against Vitest's default 10 s `hookTimeout`, for the reason
 * `egress-refusal.node.test.ts` records: a test arms two clocks and the framework's must
 * be the larger, or a wedged shutdown is reported as an anonymous hook timeout naming no
 * step.
 */
afterEach(async () => {
  await Promise.all(nodes.splice(0).map((n) => n.stop().catch(() => {})))
  await rm(workdir, { recursive: true, force: true })
}, 20_000)

const start = async (options: Partial<FabricNodeOptions> = {}): Promise<FabricNode> => {
  const node = await FabricNode.start({
    relayAdmission: 'admits-any-peer',
    listen: ['/ip4/127.0.0.1/tcp/0'],
    trustAnchors: 'runs-unsigned-artifacts',
    ...options,
  })
  nodes.push(node)
  return node
}

/** Stop one node out of turn, so a restart can rebind. */
const stop = async (node: FabricNode): Promise<void> => {
  const at = nodes.indexOf(node)
  if (at >= 0) nodes.splice(at, 1)
  await node.stop()
}

describe('AUTH-01 — the identity survives the process that made it', () => {
  /**
   * The whole point of the phase, at the layer an operator sees it.
   *
   * Reddened by deleting `privateKey: identity.privateKey` from the `createLibp2p` options
   * — libp2p mints an ephemeral key again, which is the pre-phase behaviour.
   */
  it('gives a node restarted against the same directory the same peerId and nodeKey', async () => {
    const dir = join(workdir, 'stable')

    const first = await start({ blockstoreDir: dir })
    const firstPeerId = first.peerId
    const firstNodeKey = first.nodeKey
    // Stopped before the second starts, so the socket is free. This is the restart case
    // reduced to the one fact that makes it true.
    await stop(first)

    const second = await start({ blockstoreDir: dir })
    expect(second.peerId).toBe(firstPeerId)
    expect(second.nodeKey).toBe(firstNodeKey)
  })

  it('gives nodes in different directories different identities', async () => {
    const a = await start({ blockstoreDir: join(workdir, 'a') })
    const b = await start({ blockstoreDir: join(workdir, 'b') })

    expect(b.peerId).not.toBe(a.peerId)
    expect(b.nodeKey).not.toBe(a.nodeKey)
  })

  /**
   * Decision 2's stated behaviour, asserted rather than left to be discovered: a process
   * given nowhere to persist gets a fresh identity per start. That is a deployment choice
   * — whether this process should survive its own restart — and not a kind of node.
   *
   * Reddened by replacing `generateSeed()` in the no-directory branch with a constant seed.
   */
  it('gives two nodes with no directory two different identities', async () => {
    const a = await start()
    const b = await start()

    expect(b.peerId).not.toBe(a.peerId)
    expect(b.nodeKey).not.toBe(a.nodeKey)
  })

  /**
   * The assertion that makes "the advertised identity is a certificate rather than a bare
   * peer id" structurally checkable rather than a string a binary chose to print. Asserted
   * in BOTH directions, because a rejection-only check would pass against `() => null`.
   *
   * Reddened by the same `privateKey` deletion, from the other side: the seed's nodeKey and
   * libp2p's ephemeral peer id would then be unrelated.
   */
  it('reads peerId and nodeKey as two encodings of one identity, both ways', async () => {
    for (const node of [
      await start({ blockstoreDir: join(workdir, 'derived') }),
      await start(),
    ]) {
      expect(peerIdForNodeKey(node.nodeKey)).toBe(node.peerId)
      expect(nodeKeyForPeerId(node.peerId)).toBe(node.nodeKey)
    }
  })

  it('writes exactly SEED_BYTES to the dot-prefixed identity file', async () => {
    const dir = join(workdir, 'seeded')
    await start({ blockstoreDir: dir })

    expect(readdirSync(dir)).toContain(IDENTITY_FILE)
    expect(statSync(join(dir, IDENTITY_FILE)).size).toBe(SEED_BYTES)
  })

  /**
   * `FsBlockstore.open`'s filter **is** the block counter, so any non-block file in a
   * node's blockstore directory would inflate `size` by one. This plan is what first puts
   * one there.
   *
   * `n` is this test's own controlled input, not a prediction about a running node's
   * directory. And the `readdirSync` assertion is what stops a count that matches because
   * the file is MISSING from reading identically to a count that matches because the
   * filter works.
   *
   * Reddened by dropping the leading dot from `IDENTITY_FILE`, or by reverting
   * `fs-blockstore.ts`'s filter to `!name.startsWith('.tmp-')`.
   */
  it('does not count the identity file among the blocks', async () => {
    const dir = join(workdir, 'counted')
    const node = await start({ blockstoreDir: dir })

    const n = 3
    for (let i = 0; i < n; i++) {
      await node.store.put(new Uint8Array([i, i + 1, i + 2]))
    }
    await stop(node)

    expect(readdirSync(dir)).toContain(IDENTITY_FILE)
    expect((await FsBlockstore.open(dir)).size).toBe(n)
  })
})

describe('AUTH-01 — holding a provider key is a configuration, not a class', () => {
  /**
   * Decision 6's separate-file rule, asserted rather than assumed, so a provider-signed
   * certificate can never be confused with a self-signed one.
   *
   * Reddened by changing `PROVIDER_FILE` to `IDENTITY_FILE` in the authority block.
   */
  it('reports an issuerKey that is never the nodeKey, from a second file on disk', async () => {
    const dir = join(workdir, 'provider')
    const node = await start({ blockstoreDir: dir, issuesCertificates: 'issues-without-an-aggregate-budget' })

    expect(node.issuerKey).not.toBeNull()
    expect(node.issuerKey).not.toBe(node.nodeKey)
    expect(readdirSync(dir)).toContain(PROVIDER_FILE)
    expect(readdirSync(dir)).toContain(IDENTITY_FILE)
    expect(statSync(join(dir, PROVIDER_FILE)).size).toBe(SEED_BYTES)
  })

  it('reports issuerKey null when it was not told to issue', async () => {
    const node = await start({ blockstoreDir: join(workdir, 'plain') })
    expect(node.issuerKey).toBeNull()
  })

  /**
   * A process holding a provider key is the same node in every other respect. If a
   * decision keyed on node kind it would show up here.
   */
  it('gives a provider the identical executor binding every other node has', async () => {
    const provider = await start({ blockstoreDir: join(workdir, 'p'), issuesCertificates: 'issues-without-an-aggregate-budget' })
    const plain = await start({ blockstoreDir: join(workdir, 'q') })

    for (const node of [provider, plain]) {
      // The executor id binding is unchanged by this phase, so a disagreement still names
      // the machine that produced the dissenting result.
      expect(node.executor.nodeId).toBe(node.peerId)
      expect(node.admission.slots).toBeGreaterThan(0)
      expect(node.relays).toBe(true)
    }
  })
})
