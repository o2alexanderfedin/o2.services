import { readdirSync, statSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SEED_BYTES, nodeKeyForPeerId, peerIdForNodeKey } from '@o2/libp2p'
import { FabricNode } from './fabric-node.ts'
import type { FabricNodeOptions } from './fabric-node.ts'
import { FsBlockstore } from './fs-blockstore.ts'
import { IDENTITY_FILE, PROVIDER_FILE, SEALED_IDENTITY_FILE, SEALED_PROVIDER_FILE } from './identity-store.ts'
import type { IdentityProtection } from '@o2/libp2p'

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
 *
 * ## AUTH-06 — persistence now costs a passphrase, and saying nothing costs the peer id
 *
 * Plan 42-02 made `FabricNodeOptions.identityProtection` default to `writes-no-new-secret`,
 * so a node told nothing writes no identity to its directory. Every case below whose subject
 * is *the identity surviving* therefore states {@link PERSISTS} — **not** because the
 * assertion was weakened to accommodate the change, but because persistence is now a thing a
 * caller asks for and these are the cases that ask. The two cases whose subject is a node
 * with no directory are untouched: they never persisted anything.
 *
 * The no-passphrase arm gained a case of its own rather than being left as the default
 * nobody reads — see *"a node given no passphrase is a different node on its next start"*.
 */

/**
 * The protection every case about persistence states. At least `PASSPHRASE_MIN_LENGTH`
 * characters; the floor itself is `identity-at-rest.node.test.ts`'s subject, not this file's.
 */
const PERSISTS: IdentityProtection = { kind: 'passphrase', passphrase: 'node-identity-spec-passphrase' }

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
    startReporting: 'reports-its-own-start',
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

    const first = await start({ blockstoreDir: dir, identityProtection: PERSISTS })
    const firstPeerId = first.peerId
    const firstNodeKey = first.nodeKey
    // Stopped before the second starts, so the socket is free. This is the restart case
    // reduced to the one fact that makes it true.
    await stop(first)

    const second = await start({ blockstoreDir: dir, identityProtection: PERSISTS })
    expect(second.peerId).toBe(firstPeerId)
    expect(second.nodeKey).toBe(firstNodeKey)
  })

  it('gives nodes in different directories different identities', async () => {
    const a = await start({ blockstoreDir: join(workdir, 'a'), identityProtection: PERSISTS })
    const b = await start({ blockstoreDir: join(workdir, 'b'), identityProtection: PERSISTS })

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
      await start({ blockstoreDir: join(workdir, 'derived'), identityProtection: PERSISTS }),
      await start(),
    ]) {
      expect(peerIdForNodeKey(node.nodeKey)).toBe(node.peerId)
      expect(nodeKeyForPeerId(node.peerId)).toBe(node.nodeKey)
    }
  })

  /**
   * **AUTH-06 inverted the on-disk half of this case, and the inversion is the phase.** It
   * asserted the identity file held exactly `SEED_BYTES`; the whole claim now is that no file
   * in this directory does. So it reads the dot-prefixed ENVELOPE, asserts it is longer than a
   * seed, and asserts the plaintext name is not there at all.
   *
   * Reddened by dropping the leading dot from `SEALED_IDENTITY_FILE`, or by making the node
   * write the plaintext name again.
   */
  it('writes a dot-prefixed envelope that is longer than a seed, and no plaintext seed file', async () => {
    const dir = join(workdir, 'seeded')
    await start({ blockstoreDir: dir, identityProtection: PERSISTS })

    expect(readdirSync(dir)).toContain(SEALED_IDENTITY_FILE)
    expect(statSync(join(dir, SEALED_IDENTITY_FILE)).size).toBeGreaterThan(SEED_BYTES)
    expect(readdirSync(dir)).not.toContain(IDENTITY_FILE)
  })

  /**
   * AUTH-06 — the honest cost of the default arm, asserted rather than left in a docblock.
   *
   * A node told nothing about protection writes no identity, so it is a different node on its
   * next start and its directory holds no secret to lose. That is what `writes-no-new-secret`
   * promises, and a promise nothing reads is a comment.
   *
   * Reddened by making the default arm persist a plaintext seed again.
   */
  it('gives a node with no passphrase a new identity on its next start, and leaves no secret behind', async () => {
    const dir = join(workdir, 'ephemeral')

    const first = await start({ blockstoreDir: dir })
    const firstPeerId = first.peerId
    await stop(first)

    expect(readdirSync(dir)).not.toContain(IDENTITY_FILE)
    expect(readdirSync(dir)).not.toContain(SEALED_IDENTITY_FILE)

    const second = await start({ blockstoreDir: dir })
    expect(second.peerId).not.toBe(firstPeerId)
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
   * Reddened by dropping the leading dot from `SEALED_IDENTITY_FILE`, or by reverting
   * `fs-blockstore.ts`'s filter to `!name.startsWith('.tmp-')`. **A `.enc` suffix on a dotted
   * name still starts with a dot**, which is why AUTH-06 could rename the file without
   * touching the filter — and this case is where that is read rather than assumed.
   */
  it('does not count the identity envelope among the blocks', async () => {
    const dir = join(workdir, 'counted')
    const node = await start({ blockstoreDir: dir, identityProtection: PERSISTS })

    const n = 3
    for (let i = 0; i < n; i++) {
      await node.store.put(new Uint8Array([i, i + 1, i + 2]))
    }
    await stop(node)

    expect(readdirSync(dir)).toContain(SEALED_IDENTITY_FILE)
    expect((await FsBlockstore.open(dir)).size).toBe(n)
  })
})

describe('AUTH-01 — holding a provider key is a configuration, not a class', () => {
  /**
   * Decision 6's separate-file rule, asserted rather than assumed, so a provider-signed
   * certificate can never be confused with a self-signed one.
   *
   * Reddened by changing `SEALED_PROVIDER_FILE` to `SEALED_IDENTITY_FILE` in the authority
   * block.
   */
  it('reports an issuerKey that is never the nodeKey, from a second file on disk', async () => {
    const dir = join(workdir, 'provider')
    const node = await start({
      blockstoreDir: dir,
      issuesCertificates: 'issues-without-an-aggregate-budget',
      identityProtection: PERSISTS,
    })

    expect(node.issuerKey).not.toBeNull()
    expect(node.issuerKey).not.toBe(node.nodeKey)
    // AUTH-06 — two envelopes, and neither plaintext name. The provider signing key is the
    // higher-value of the two secrets in this directory and is sealed on identical terms.
    expect(readdirSync(dir)).toContain(SEALED_PROVIDER_FILE)
    expect(readdirSync(dir)).toContain(SEALED_IDENTITY_FILE)
    expect(readdirSync(dir)).not.toContain(PROVIDER_FILE)
    expect(readdirSync(dir)).not.toContain(IDENTITY_FILE)
    expect(statSync(join(dir, SEALED_PROVIDER_FILE)).size).toBeGreaterThan(SEED_BYTES)
  })

  it('reports issuerKey null when it was not told to issue', async () => {
    const node = await start({ blockstoreDir: join(workdir, 'plain'), identityProtection: PERSISTS })
    expect(node.issuerKey).toBeNull()
  })

  /**
   * A process holding a provider key is the same node in every other respect. If a
   * decision keyed on node kind it would show up here.
   */
  it('gives a provider the identical executor binding every other node has', async () => {
    const provider = await start({
      blockstoreDir: join(workdir, 'p'),
      issuesCertificates: 'issues-without-an-aggregate-budget',
      identityProtection: PERSISTS,
    })
    const plain = await start({ blockstoreDir: join(workdir, 'q'), identityProtection: PERSISTS })

    for (const node of [provider, plain]) {
      // The executor id binding is unchanged by this phase, so a disagreement still names
      // the machine that produced the dissenting result.
      expect(node.executor.nodeId).toBe(node.peerId)
      expect(node.admission.slots).toBeGreaterThan(0)
      expect(node.relays).toBe(true)
    }
  })
})
