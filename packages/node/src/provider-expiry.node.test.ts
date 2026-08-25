import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MemoryRecordIndex, verifyCapabilityRecord, verifyCertificate } from '@o2/core'
import type { PublicKeyHex } from '@o2/core'
import { DhtRecordIndex, providerRecordPolicy } from '@o2/libp2p'
import { CID } from 'multiformats/cid'
import { sha256 } from 'multiformats/hashes/sha2'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FabricNode } from './fabric-node.ts'
import type { FabricNodeOptions } from './fabric-node.ts'

/**
 * NET-06 — **a statement that some node holds a block stops being true, and stops being
 * served.** Read across two real nodes, because the thing under test is what one node does
 * with a record another node gave it.
 *
 * ## The reading this file exists to replace
 *
 * `@libp2p/kad-dht@16.4.0` splits provider-record lifetime across two modules, and this
 * project reached the wrong conclusion from the first one **twice** — once at 48 hours,
 * once at 24 — before reading the second. Both figures came from documentation for options
 * that are declared publicly, spread into a constructor, and read by nothing:
 * `providers.provideValidity` and `providers.cleanupInterval` do not appear in
 * `src/providers.ts`'s `ProvidersInit`, and `getProviders` returns every entry under the
 * key prefix with no date comparison at all.
 *
 * Expiry is real and lives in `src/reprovider.ts`, started with the other components by
 * `kad-dht.ts`'s `start(...)`: every `interval` it walks that same prefix, deletes an entry
 * older than `validity` **whose provider is not this node**, and republishes its own within
 * `threshold` of expiring.
 *
 * So the claim under test is not "we built expiry". It is narrower and checkable: **the
 * knob this fabric sets is the one that is honoured, and setting it makes a foreign record
 * go away.** Three readings of source produced two wrong answers; one behavioural case
 * settles it.
 *
 * ## Why the reading is taken with the provider stopped
 *
 * `findProviders` yields what the local store holds *and then walks the network*
 * (`content-routing/index.ts:185`). With the holder still up, an answer could have come
 * back over the wire from the node that owns the record — which never expires it, by
 * design, because `reprovider.ts` exempts `isSelf` so that *"if user node is down for a
 * while, we still persist provide intent"*. Stopping the holder first removes that path,
 * so what the keeper answers is what the keeper still stores.
 *
 * Node-only: it starts real libp2p nodes on loopback TCP.
 */

const TIMEOUT_MS = 60_000
const USER_KEY = new Uint8Array(32).fill(0x62)

/**
 * Short enough to observe, long enough to see the record before it goes.
 *
 * `providerRecordPolicy` derives a 2 s sweep and a 4 s republish threshold from this, so
 * the whole cycle is bounded by 10 s and the case does not encode a second number that
 * could drift away from the first.
 */
const VALIDITY_MS = 8_000

let workdir: string
const nodes: FabricNode[] = []

beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'o2-provider-expiry-'))
})

afterEach(async () => {
  for (const node of nodes.reverse()) {
    try {
      await node.stop()
    } catch {
      // A node already stopped inside a case has nothing to stop, and reporting it here
      // would report the wrong failure.
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
    // Not `/p2p-circuit`, so `canRelay` is true and `clientMode: !canRelay` makes these
    // nodes DHT **servers**. A client-mode keeper would never be handed a provider record
    // to keep, and the case would pass by having nothing to expire.
    listen: ['/ip4/127.0.0.1/tcp/0'],
    trustAnchors: 'runs-unsigned-artifacts',
    rpcTimeoutMs: 20_000,
    providerRecordValidityMs: VALIDITY_MS,
    ...options,
  })
  nodes.push(node)
  return node
}

/** Stop one node out of turn, so a case can read what survives it. */
async function stop(node: FabricNode): Promise<void> {
  const at = nodes.indexOf(node)
  if (at >= 0) nodes.splice(at, 1)
  await node.stop()
}

async function until(
  predicate: () => Promise<boolean>,
  what: string,
  observed: () => unknown,
): Promise<void> {
  const deadline = Date.now() + 30_000
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
    // Well under the case's own 30 s poll ceiling: with the holder stopped the walk has
    // nowhere to go, and a long timeout here would spend the case's budget proving that.
    timeoutMs: 3_000,
    addresses: 'discards-provider-addresses',
    self: reader.nodeKey,
  })
}

/**
 * A CID for a fixture that is never stored — only announced.
 *
 * **sha-256 and not `identity`, and the reason is a measured refusal.** ADD_PROVIDER puts
 * `key.multihash.bytes` on the wire and the receiving handler calls `CID.decode` on it
 * (`rpc/handlers/add-provider.ts`), relying on a sha-256 multihash being byte-identical to
 * a CIDv0. An identity multihash begins `0x00`, which that decoder reads as a version and
 * refuses — so the first draft of this case announced into a keeper that threw
 * `InvalidMessageError('Invalid CID')` on every message and stored nothing, and the case
 * failed as *"the keeper was never handed the record"* with no hint of why.
 */
async function cidFor(label: string): Promise<CID> {
  return CID.createV1(0x55, await sha256.digest(new TextEncoder().encode(label)))
}

describe('provider records — the fabric sets the lifetime, and a foreign record is swept', () => {
  it(
    'stops answering for a provider once the record it was given has outlived its validity',
    async () => {
      // The keeper is also the enrolment provider, which is what gives the holder a peer
      // to walk to: enrolment dials, and the dial is what puts each node in the other's
      // routing table. Nothing about issuance is under test here — it is the cheapest way
      // to get two nodes that can find each other.
      const keeper = await start('keeper', {
        issuesCertificates: 'issues-without-an-aggregate-budget',
      })
      const issuer = keeper.issuerKey
      expect(issuer, 'the keeper minted no issuer key').not.toBeNull()

      const holder = await start('holder', {
        enrollment: {
          userPrivateKey: USER_KEY,
          operatorId: 'holder-ops',
          providerAddr: keeper.multiaddrs[0] as string,
        },
      })
      expect(holder.certificate, 'the holder enrolled without a certificate').not.toBeNull()

      const cid = await cidFor('provider-expiry-fixture')

      // Draining is what performs the announcement — the same laziness `DhtProviderAnnouncer`
      // documents. `addProvider` writes locally before the walk begins
      // (`content-routing/index.ts:86`), so the holder's own copy exists either way; what
      // this loop is for is the walk that hands a copy to the keeper.
      for await (const _event of holder.dht.provide(cid, { signal: AbortSignal.timeout(15_000) })) {
        // Events are progress. `provide` reports success by not throwing.
      }

      const index = dhtOnly(keeper, issuer as PublicKeyHex)

      await until(
        async () => (await index.providers(cid)).includes(holder.nodeKey),
        'the keeper to be handed the holder’s provider record',
        () => ({ keeper: keeper.nodeKey, holder: holder.nodeKey }),
      )

      // With the holder gone, the only place an answer can come from is the keeper's own
      // store. See this file's header for why that is the whole point.
      await stop(holder)

      const before = await index.providers(cid)
      expect(before, 'the keeper stopped answering as soon as the holder went, which would make the sweep unobservable').toContain(
        holder.nodeKey,
      )

      const policy = providerRecordPolicy(VALIDITY_MS)
      await until(
        async () => !(await index.providers(cid)).includes(holder.nodeKey),
        `the sweep to delete a record older than ${policy.validity} ms`,
        () => ({ policy, holder: holder.nodeKey }),
      )
    },
    TIMEOUT_MS,
  )

  it('derives one coherent set of three figures from a single validity', () => {
    const policy = providerRecordPolicy(VALIDITY_MS)

    // The staleness bound is `validity + interval` and not `validity`, because reads are
    // not filtered by date — an entry is served until a sweep removes it. Deriving the
    // interval fixes that bound at 1.25x rather than leaving it to two numbers chosen
    // apart. The library's own defaults are 48 h / 1 h / 24 h, which are individually
    // reasonable and jointly republish a record at about the instant it would expire.
    expect(policy.interval).toBe(VALIDITY_MS / 4)
    expect(policy.threshold).toBe(VALIDITY_MS / 2)
    expect(policy.threshold).toBeLessThan(policy.validity)

    // A validity too small to quarter must still yield a runnable timer rather than a
    // zero-delay loop.
    const tiny = providerRecordPolicy(1)
    expect(tiny.interval).toBeGreaterThan(0)
    expect(tiny.threshold).toBeGreaterThan(0)
  })
})
