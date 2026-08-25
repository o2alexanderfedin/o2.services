import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MemoryRecordIndex, verifyCapabilityRecord, verifyCertificate } from '@o2/core'
import type { PublicKeyHex } from '@o2/core'
import { DhtRecordIndex, discoverRelays } from '@o2/libp2p'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FabricNode } from './fabric-node.ts'
import type { FabricNodeOptions } from './fabric-node.ts'

/**
 * NET-05 — **a node finds a relay by asking the keyspace**, read across three real nodes.
 *
 * Until this plan the relay set was a startup argument and nothing else: `--relay-addr` on
 * the command line, `relayAddrs` in a tab. That makes a relay the same kind of single point
 * of failure the bootstrap seed is, except at run time rather than at start — a relay goes
 * away and every node whose only address ran through it leaves the fabric, unable to be
 * told about a replacement because being told requires being reachable.
 *
 * ## Why this needs real nodes and not a fixture
 *
 * The unit cases in `packages/libp2p/src/relay-service.test.ts` cover what
 * `discoverRelays` does with an answer. What they cannot cover is that the answer **exists**
 * — that a relay's `provide` of the well-known key reaches another node's keyspace, and
 * that the certificate the announcement is checked against travels with it. Both halves are
 * network facts.
 *
 * The reading is taken through a `DhtRecordIndex` built with
 * `recordsFallback: 'answers-from-the-dht-alone'` over an empty `MemoryRecordIndex`, so no
 * non-DHT path is in the frame. If this passes, the keyspace carried both the announcement
 * and the certificate that justifies it.
 *
 * Node-only: it starts real libp2p nodes on loopback TCP.
 */

const TIMEOUT_MS = 90_000
const USER_KEY = new Uint8Array(32).fill(0x41)

let workdir: string
const nodes: FabricNode[] = []

beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'o2-relay-discovery-'))
})

afterEach(async () => {
  for (const node of nodes.reverse()) {
    try {
      await node.stop()
    } catch {
      // A node that failed to start has nothing to stop.
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
    // A listen address that is not `/p2p-circuit` is what makes `canRelay` true, which is
    // both what puts `'seed'` in this node's certificate and what makes it announce. The
    // two are the same signal on purpose: a node cannot advertise a service its own
    // certificate does not claim.
    listen: ['/ip4/127.0.0.1/tcp/0'],
    trustAnchors: 'runs-unsigned-artifacts',
    rpcTimeoutMs: 20_000,
    ...options,
  })
  nodes.push(node)
  return node
}

async function until(
  predicate: () => Promise<boolean>,
  what: string,
  observed: () => unknown,
): Promise<void> {
  const deadline = Date.now() + 40_000
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`timed out waiting for ${what}; observed ${JSON.stringify(observed())}`)
}

/** The production reader, with no path to anything but the DHT. */
function dhtOnly(reader: FabricNode, issuer: PublicKeyHex): DhtRecordIndex {
  return new DhtRecordIndex({
    dht: reader.dht,
    providersFrom: new MemoryRecordIndex(),
    recordsFallback: 'answers-from-the-dht-alone',
    verify: (nodeKey, found) =>
      found.certificate.nodeKey === nodeKey &&
      verifyCertificate(found.certificate, new Set([issuer]), Date.now()).ok &&
      verifyCapabilityRecord(found.capabilities, Date.now()),
    timeoutMs: 5_000,
    addresses: 'discards-provider-addresses',
    self: reader.nodeKey,
  })
}

describe('NET-05 — a relay is found through the keyspace, not only through a flag', () => {
  it(
    'discovers a relay it was never given the address of, and the certificate is what admits it',
    async () => {
      // Three nodes and not two, and the third one is the point rather than scaffolding.
      // The certificate is what admits a relay, so a relay with no certificate of its own
      // is correctly invisible — which is exactly what the two-node version of this case
      // measured before it was rewritten: the issuer never enrols with itself, held no
      // record, and was discarded by the check this file exists to prove. So issuance sits
      // on a node of its own, and both of the others enrol.
      const provider = await start('provider', {
        issuesCertificates: 'issues-without-an-aggregate-budget',
      })
      const issuer = provider.issuerKey
      expect(issuer, 'the provider minted no issuer key').not.toBeNull()
      const providerAddr = provider.multiaddrs[0] as string

      const relay = await start('relay', {
        enrollment: { userPrivateKey: USER_KEY, operatorId: 'relay-ops', providerAddr },
      })
      expect(relay.certificate, 'the relay enrolled without a certificate').not.toBeNull()
      expect(
        relay.certificate?.discoverability,
        'the relay did not describe itself as a seed, so nothing would admit it',
      ).toBe('seed')

      const seeker = await start('seeker', {
        enrollment: {
          userPrivateKey: new Uint8Array(32).fill(0x42),
          operatorId: 'seeker-ops',
          providerAddr,
        },
      })
      expect(seeker.certificate, 'the seeker enrolled without a certificate').not.toBeNull()

      const index = dhtOnly(seeker, issuer as PublicKeyHex)

      await until(
        async () =>
          (await discoverRelays({ index, self: seeker.nodeKey })).includes(relay.nodeKey),
        'the seeker to find the relay through the keyspace',
        () => ({ relay: relay.nodeKey, seeker: seeker.nodeKey }),
      )

      // The seeker is itself a `'seed'` here — it binds a loopback socket — so it announces
      // too. Finding itself would be the same double-count `DhtRecordIndexOptions.self`
      // exists to stop, and it would spend a reservation slot connecting to its own
      // address.
      const found = await discoverRelays({ index, self: seeker.nodeKey })
      expect(found, 'the seeker offered itself as its own relay').not.toContain(seeker.nodeKey)
    },
    TIMEOUT_MS,
  )
})
