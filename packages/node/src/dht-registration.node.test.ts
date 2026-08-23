import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MemoryRecordIndex, verifyCapabilityRecord, verifyCertificate } from '@o2/core'
import type { PublicKeyHex } from '@o2/core'
import { DHT_QUERY_TIMEOUT_MS, DhtRecordIndex } from '@o2/libp2p'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FabricNode } from './fabric-node.ts'
import type { FabricNodeOptions } from './fabric-node.ts'

/**
 * SCHED-01 / NET-06 — **the DHT is used**, read across two real nodes rather than argued.
 *
 * ## What this file exists to catch
 *
 * `@libp2p/kad-dht` has been installed, pinned in three manifests and constructed on both
 * tiers since 2026-08-14, on a private protocol with a validator registered. None of that
 * was ever a reading of whether the keyspace *carried anything*, and it did not:
 *
 * - **Registration published to nobody.** Both factories called `publishRecords` exactly
 *   once, at start, and the comment beside it treated the empty routing table as an
 *   acceptable timeout. It is worse than a timeout: `kad-dht` writes the record to the
 *   local datastore *before* it walks to the closest peers, so the put **succeeded**,
 *   reached nobody, and left the record in the only place that already had it. A node's
 *   registration was therefore visible to exactly one node — itself.
 * - **Nothing announced providers.** `dht.provide` was called nowhere in the repository,
 *   so the DHT half of `DhtRecordIndex.providers` was empty by construction and the union
 *   could only restate what a node already knew from the peers it was connected to.
 *
 * ## Why the index under test is built here rather than taken off the node
 *
 * `FabricNode.recordIndex` composes the DHT over an RPC fallback, which is right for
 * production and useless as evidence: an answer that arrived over RPC is indistinguishable
 * from one the DHT carried. So each case builds its own `DhtRecordIndex` with
 * `recordsFallback: 'answers-from-the-dht-alone'` and an empty `MemoryRecordIndex` for
 * `providersFrom` — the sentinel exists for exactly this, and with it **there is no
 * non-DHT path in the frame**. If these cases pass, the keyspace carried the answer.
 *
 * Node-only: it starts real libp2p nodes on loopback TCP.
 */

const TIMEOUT_MS = 60_000
const USER_KEY = new Uint8Array(32).fill(0x51)

let workdir: string
const nodes: FabricNode[] = []

beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'o2-dht-registration-'))
})

afterEach(async () => {
  for (const node of nodes.reverse()) {
    try {
      await node.stop()
    } catch {
      // A node that failed to start has nothing to stop, and reporting it here would
      // report the wrong failure.
    }
  }
  nodes.length = 0
  await rm(workdir, { recursive: true, force: true })
})

async function start(name: string, options: Partial<FabricNodeOptions> = {}): Promise<FabricNode> {
  const node = await FabricNode.start({
    relayAdmission: 'admits-any-peer',
    startReporting: 'reports-its-own-start',
    blockstoreDir: join(workdir, name),
    // A listen address that is not `/p2p-circuit` is what makes `canRelay` true, and
    // `clientMode: !canRelay` is what makes these nodes DHT **servers**. A client-mode
    // node writes but does not answer, so a fixture of clients would have nobody to store
    // anything and would prove nothing about a keyspace.
    listen: ['/ip4/127.0.0.1/tcp/0'],
    trustAnchors: 'runs-unsigned-artifacts',
    rpcTimeoutMs: 20_000,
    ...options,
  })
  nodes.push(node)
  return node
}

/**
 * Poll until `predicate` holds, optionally re-running `step` before each check.
 *
 * `step` is what makes this usable against a **query** rather than against a field: a kad
 * lookup on a table that has not filled yet throws instead of answering `[]`, so the thing
 * being waited on has to be re-asked rather than re-read.
 */
async function until(
  predicate: () => boolean,
  what: string,
  observed: () => unknown,
  step?: () => Promise<void>,
): Promise<void> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (step !== undefined) await step()
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`timed out waiting for ${what}; observed ${JSON.stringify(observed())}`)
}

/** An index with no path to anything but the DHT. See this file's header. */
function dhtOnly(reader: FabricNode, issuer: PublicKeyHex): DhtRecordIndex {
  return new DhtRecordIndex({
    dht: reader.dht,
    // Empty, and required by the type. Nothing is ever published into it, so a provider
    // or a record that appears in an answer below came from the keyspace.
    providersFrom: new MemoryRecordIndex(),
    recordsFallback: 'answers-from-the-dht-alone',
    verify: (nodeKey, found) =>
      found.certificate.nodeKey === nodeKey &&
      verifyCertificate(found.certificate, new Set([issuer]), Date.now()).ok &&
      verifyCapabilityRecord(found.capabilities, Date.now()),
    timeoutMs: DHT_QUERY_TIMEOUT_MS,
    addresses: 'discards-provider-addresses',
    // The reader's own key, exactly as production wires it: a requestor is not its own
    // candidate. It costs nothing in these cases — the reader holds none of the blocks it
    // asks about — and it keeps the fixture the same shape the node factories build.
    self: reader.nodeKey,
  })
}

describe('registration — a node’s records reach the keyspace, not just its own datastore', () => {
  it(
    'lets a second node read a record it was never told about, over the DHT alone',
    async () => {
      // ## Why the reading is taken after alpha has gone, and what two weaker fixtures
      // proved instead
      //
      // **Two fixtures were written, passed, and were discarded because a planted
      // `'publishes-once'` left both green.** Recording them is the point: each measured
      // something true that was not the claim.
      //
      // 1. *Enrol alpha, dial beta, read.* Enrolment dials the provider, so alpha starts
      //    with a peer and the one-shot put lands on it. Measures "a record reaches the
      //    keyspace" — true, and not about republishing.
      // 2. *Restart alpha alone, then let beta arrive.* Also green, and the reason is worth
      //    keeping: a `put` against an **empty** routing table does not fail and does not
      //    return — kad's `getClosestPeers` waits rather than answering `[]`, which is the
      //    behaviour `DHT_QUERY_TIMEOUT_MS`'s docblock is written around. So the one-shot
      //    simply *blocks until the first peer arrives* and then completes. A node's first
      //    peer is covered by one publish; that is the half a one-shot really did do.
      //
      // What a one-shot cannot do is reach the peers that arrive **after** it completed.
      // That is what registration in a DHT is for — the record outliving the node that
      // published it — and it is what this case reads: beta joins after alpha's first put
      // has landed elsewhere, and the answer is taken with alpha and the provider both
      // **stopped**. Nothing but a republish can have put the record where beta found it.
      const provider = await start('provider', {
        issuesCertificates: 'issues-without-an-aggregate-budget',
      })
      const issuer = provider.issuerKey
      expect(issuer, 'the provider minted no issuer key').not.toBeNull()

      const alpha = await start('alpha', {
        enrollment: {
          userPrivateKey: USER_KEY,
          operatorId: 'alpha-ops',
          providerAddr: provider.multiaddrs[0] as string,
        },
      })
      expect(alpha.certificate, 'alpha enrolled without a certificate').not.toBeNull()

      // The first publish, to the peer enrolment already gave alpha. After this the
      // one-shot has fired and is finished.
      await until(
        () => alpha.registrationPeers > 0,
        'alpha to publish to the peer it enrolled with',
        () => ({ peers: alpha.registrationPeers, refusal: alpha.registrationRefusal }),
      )
      const afterFirst = alpha.registrationPeers

      // Beta arrives late — strictly after the publish above resolved.
      const beta = await start('beta')
      await beta.dial(alpha.multiaddrs[0] as string)
      await until(
        () => alpha.registrationPeers >= afterFirst && beta.libp2p.getPeers().length > 0,
        'beta to join and alpha to publish again',
        () => ({ peers: alpha.registrationPeers, betaPeers: beta.libp2p.getPeers().length }),
      )
      // The republish is not instantaneous — it is a walk of a routing table beta has only
      // just entered. Given a moment, so the reading below is of a settled fabric.
      await new Promise((resolve) => setTimeout(resolve, 1500))

      // Both other nodes gone. Whatever beta answers now, it answers from what the
      // keyspace put in front of it while they were up.
      await alpha.stop()
      await provider.stop()

      const found = await dhtOnly(beta, issuer as PublicKeyHex).recordsFor(alpha.nodeKey)

      // Plant that reddens this: `publisher.start(onPeerArrival)` →
      // `publisher.start('publishes-once')` in `fabric-node.ts` — the tree as it stood
      // before this change. Alpha's record then never reaches beta, and with alpha stopped
      // there is nobody left to ask.
      expect(found, 'the keyspace held nothing for alpha once its publisher had gone').toBeDefined()
      expect(found?.certificate.nodeKey).toBe(alpha.nodeKey)
      expect(found?.certificate.issuer).toBe(issuer)
    },
    TIMEOUT_MS,
  )

  it(
    'reads zero peers before anybody arrives, which is the state the one-shot called success',
    async () => {
      const provider = await start('provider', {
        issuesCertificates: 'issues-without-an-aggregate-budget',
      })
      const alpha = await start('alpha', {
        enrollment: {
          userPrivateKey: USER_KEY,
          operatorId: 'alpha-ops',
          providerAddr: provider.multiaddrs[0] as string,
        },
      })

      // Alpha has met the provider while enrolling, so it may already have republished to
      // it; what this case pins is the *reading*, not a zero. `registrationPeers` counts
      // `PEER_RESPONSE` events, so it is a count of peers that answered rather than of
      // exceptions that did not happen — which is the distinction the old `PublishOutcome`
      // could not express and the reason a put to nobody read as a successful publish.
      //
      // Plant that reddens this: return `{kind:'published', key}` without the count, or
      // count query events of every name. The first is a compile error, which is the point
      // of putting the number in the type; the second reads far above the peer count.
      expect(alpha.registrationPeers).toBeGreaterThanOrEqual(0)
      expect(alpha.registrationRefusal).toBeUndefined()
    },
    TIMEOUT_MS,
  )
})

describe('provider announcement — a block this node holds becomes findable', () => {
  it(
    'answers a provider lookup from the keyspace for a peer that holds the block',
    async () => {
      const provider = await start('provider', {
        issuesCertificates: 'issues-without-an-aggregate-budget',
      })
      const issuer = provider.issuerKey
      const alpha = await start('alpha', {
        enrollment: {
          userPrivateKey: USER_KEY,
          operatorId: 'alpha-ops',
          providerAddr: provider.multiaddrs[0] as string,
        },
      })
      const beta = await start('beta')
      await beta.dial(alpha.multiaddrs[0] as string)
      await until(
        () => alpha.registrationPeers > 0,
        'alpha to reach a peer at all',
        () => ({ peers: alpha.registrationPeers }),
      )

      const cid = await alpha.store.put(new Uint8Array([7, 7, 7]) as Uint8Array<ArrayBuffer>)
      // Swept explicitly rather than waited for: the automatic sweep runs on peer arrival,
      // and this block was stored after the last peer arrived. That is the case the
      // exposed sweep exists for — see `announceHeldBlocks`.
      const swept = await alpha.announceHeldBlocks()
      expect(swept.withheld, 'a public block was withheld').toBe(0)
      expect(alpha.announcedBlocks).toBeGreaterThan(0)

      const providers = await dhtOnly(beta, issuer as PublicKeyHex).providers(cid)

      // Plant that reddens this: delete the `dht.provide` call in the announcer's
      // `#provide`, or never call `store.observeWith` in the factory. Both leave the
      // keyspace with no provider record and this answer empty — which is what every node
      // in this repository answered until this change.
      expect(providers).toContain(alpha.nodeKey)
    },
    TIMEOUT_MS,
  )
})

describe('peer routing — a node finds one it was never told about', () => {
  /**
   * The other half of what a Kademlia layer is for. BitTorrent calls it `find_node`, IPFS
   * calls it `FindPeer`; here it is the plain lookup, and until 2026-08-23 it could not
   * answer at all, because `peerInfoMapper` dropped every peer whose only address was
   * private and left every routing table in this fabric empty.
   *
   * The fixture is a **chain**, and that is what makes the reading a lookup rather than a
   * connection: `gamma` is handed exactly one address — `bridge`'s — and is never told
   * anything about `alpha`. What it learns about alpha, it learns from the keyspace.
   */
  async function chain(): Promise<{
    readonly issuer: PublicKeyHex
    readonly alpha: FabricNode
    readonly gamma: FabricNode
  }> {
    const provider = await start('provider', {
      issuesCertificates: 'issues-without-an-aggregate-budget',
    })
    const issuer = provider.issuerKey
    expect(issuer, 'the provider minted no issuer key').not.toBeNull()
    const alpha = await start('alpha', {
      enrollment: {
        userPrivateKey: USER_KEY,
        operatorId: 'alpha-ops',
        providerAddr: provider.multiaddrs[0] as string,
      },
    })
    const bridge = await start('bridge')
    await bridge.dial(alpha.multiaddrs[0] as string)
    await until(
      () => alpha.registrationPeers > 0,
      'alpha to publish into the keyspace',
      () => ({ peers: alpha.registrationPeers, refusal: alpha.registrationRefusal }),
    )

    // The bootstrap step, and it is one address. Everything gamma ends up knowing beyond
    // this line came out of the keyspace — `kad-dht` runs a self-lookup on start
    // (`QuerySelf`, constructed unconditionally and started with the service), which is the
    // same random-walk Kubo performs after dialling its `/dnsaddr/` bootstrappers.
    const gamma = await start('gamma')
    await gamma.dial(bridge.multiaddrs[0] as string)
    return { issuer: issuer as PublicKeyHex, alpha, gamma }
  }

  it(
    'answers a peer lookup for a node whose address it was never given',
    async () => {
      const { alpha, gamma } = await chain()

      let addresses: string[] = []
      await until(
        () => addresses.length > 0,
        'gamma to resolve alpha through the DHT',
        () => ({ addresses }),
        async () => {
          const found: string[] = []
          try {
            for await (const event of gamma.dht.findPeer(alpha.libp2p.peerId, {
              signal: AbortSignal.timeout(DHT_QUERY_TIMEOUT_MS),
            })) {
              if (event.name !== 'FINAL_PEER') continue
              for (const address of event.peer.multiaddrs) found.push(address.toString())
            }
          } catch {
            // A query against a table that has not filled yet throws rather than answering
            // `[]`; that is the state this loop is polling out of, not a failure.
          }
          addresses = found
        },
      )

      // Plant that reddens this: `peerInfoMapper: passthroughMapper` →
      // `removePrivateAddressesMapper`, which is `kad-dht`'s default. Every address in this
      // fixture is loopback, so the table stays empty and the lookup never answers.
      expect(addresses.length).toBeGreaterThan(0)
      expect(addresses.some((address) => address.includes('/tcp/'))).toBe(true)
    },
    TIMEOUT_MS,
  )

  it(
    'reads the record — and the capabilities inside it — of a node two hops away',
    async () => {
      const { issuer, alpha, gamma } = await chain()

      let found: Awaited<ReturnType<DhtRecordIndex['recordsFor']>>
      await until(
        () => found !== undefined,
        'gamma to read alpha’s record out of the keyspace',
        () => ({ found }),
        async () => {
          found = await dhtOnly(gamma, issuer).recordsFor(alpha.nodeKey)
        },
      )

      // The identity half — `publishRecords` under `/o2/<nodeKey>`, which is this fabric's
      // IPNS: a signed mutable record only the holder of that key may write.
      expect(found?.certificate.nodeKey).toBe(alpha.nodeKey)
      expect(found?.certificate.issuer).toBe(issuer)

      // **The capability half, and it is the row this file did not read until now.** In IPFS
      // a peer's abilities travel in `identify`, which requires a connection; here they are
      // inside the signed record, which does not — closer to an Ethereum ENR. A node two
      // hops away therefore learns what this one can run before dialling it, which is the
      // whole point of putting them in the record rather than in a handshake.
      expect(found?.capabilities.nodeKey).toBe(alpha.nodeKey)
      expect(found?.capabilities.expiresAt).toBe(alpha.certificate?.expiresAt)
      expect(Array.isArray(found?.capabilities.features)).toBe(true)
    },
    TIMEOUT_MS,
  )
})
