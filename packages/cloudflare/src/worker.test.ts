/**
 * `GET /self` carries a per-instance marker, and the reason is criterion 2's evidence.
 *
 * ## The hole this closes
 *
 * Criterion 2 is *"a peer outside Cloudflare dials the object, and gets the **same** PeerId
 * when it dials again after the object has been evicted and after a redeploy."* The owner's
 * runbook takes four readings and compares the PeerId across them.
 *
 * **A plan check on 2026-08-27 found that those four readings cannot distinguish the case the
 * criterion is about from the case that proves nothing.** If the object was never evicted
 * between reading 1 and reading 3, the PeerId is trivially identical — the same live instance
 * answered twice — and the table fills in completely while having tested nothing. Worse, the
 * default makes that the LIKELY outcome rather than an unlucky one:
 * `hibernatable-socket.ts:17-22` records that `@chainsafe/libp2p-yamux@8.0.1` defaults
 * `keepAliveInterval: 30_000`, so a held connection wakes the object every thirty seconds and
 * **an object under a live connection does not hibernate at all.**
 *
 * ## Why a marker rather than the 1012 path
 *
 * `HibernatableSockets` already carries a real eviction signal: a frame arriving on a socket
 * the current instance has no session for is closed with {@link CLOSED_AFTER_HIBERNATION}
 * (`hibernatable-socket.ts:176-179`). That is a stronger reading — it is the connection itself
 * reporting the discontinuity — and it is **not** used here, because whether workerd accepts
 * 1012 as a close code is named UNVERIFIED in that file's own docblock (`:46-47`), and an
 * evidence path that rests on an unverified platform behaviour is one the owner discovers is
 * broken after the deploy that was supposed to use it.
 *
 * This marker rests on nothing platform-specific: a value fixed at construction. Two readings
 * carrying different markers mean two constructions, which is what eviction and redeploy have
 * in common and is the same mechanism `hosted-identity.test.ts` already tests one level down.
 *
 * ## What this file does NOT claim
 *
 * That an eviction *happened* — no local run can evict a Durable Object. It claims only that
 * **if** one happens, the reading says so, and that if one does not, the reading says that too.
 * Turning "the PeerId matched" into "the PeerId matched across a construction boundary" is the
 * whole contribution, and it has to be in the deployed code BEFORE the single deploy, because
 * adding it afterwards costs a second one.
 */

import { describe, expect, it } from 'vitest'
import { FakeDurableObjectAlarms, FakeDurableObjectStorage } from './do-storage.fixture.ts'
import { BootstrapObject } from './worker.ts'
import { DoDatastore } from './do-datastore.ts'
import { writeRelayServiceJournal } from './relay-service-journal.ts'
import type { RelayServiceTotals } from '@o2/libp2p'
import type { CloudflareWebSocket } from './websocket-connection.ts'
import type { HostedEnv, HostedObjectStateWithSockets } from './worker.ts'

/**
 * Storage and alarms as the platform carries them — together on `state.storage`.
 *
 * They are declared apart in `durable-object-storage.d.ts` so `DoDatastore`'s fixture is not
 * made to arm alarms it never touches; this is the intersection the real object sees.
 */
function newState(
  storage: FakeDurableObjectStorage,
  alarms: FakeDurableObjectAlarms,
): HostedObjectStateWithSockets {
  const sockets: CloudflareWebSocket[] = []
  return {
    storage: Object.assign(storage, alarms) as HostedObjectStateWithSockets['storage'],
    acceptWebSocket: (socket: CloudflareWebSocket): void => {
      sockets.push(socket)
    },
    getWebSockets: (): readonly CloudflareWebSocket[] => sockets,
  }
}

/** No namespace and no announce list — `GET /self` reads neither. */
const ENV: HostedEnv = {
  BOOTSTRAP: undefined as unknown as HostedEnv['BOOTSTRAP'],
}

interface TrafficLegReading {
  readonly connectionSeconds: number
  readonly bytes: number
}

interface SelfReading {
  readonly peerId: string
  readonly nodeKey: string
  readonly instance: string
  readonly version: string
  /** NET-14's split. Required here, so a route that stopped reporting it fails at the read. */
  readonly traffic: { readonly direct: TrafficLegReading; readonly relayed: TrafficLegReading }
  /** The relay-service record. Required for the same reason, and it is the DURABLE one. */
  readonly relayService: RelayServiceTotals
}

function readLeg(value: unknown, name: string): TrafficLegReading {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('connectionSeconds' in value) ||
    !('bytes' in value) ||
    typeof value.connectionSeconds !== 'number' ||
    typeof value.bytes !== 'number'
  ) {
    throw new Error(`GET /self reported a ${name} leg that is not two numbers: ${JSON.stringify(value)}`)
  }
  return { connectionSeconds: value.connectionSeconds, bytes: value.bytes }
}

async function readSelf(object: BootstrapObject): Promise<SelfReading> {
  const response = await object.fetch(new Request('https://example.invalid/self'))
  expect(response.status).toBe(200)
  const body: unknown = await response.json()
  if (
    typeof body !== 'object' ||
    body === null ||
    !('peerId' in body) ||
    !('nodeKey' in body) ||
    !('instance' in body) ||
    !('version' in body) ||
    // **Six fields as of 2026-08-30, not four** — NET-14's split joined them, and then the
    // relay-service record did. Read here rather than in one case, so a route that dropped
    // one fails everywhere it is read instead of in the one place somebody remembered to
    // look. That is not a hypothetical: the split was added as a fifth field on a reader
    // that required four, and it took a deliberate edit here to make its absence detectable.
    !('traffic' in body) ||
    !('relayService' in body)
  ) {
    throw new Error(`GET /self did not answer with the six declared fields: ${JSON.stringify(body)}`)
  }
  const { peerId, nodeKey, instance, version, traffic, relayService } = body
  if (
    typeof peerId !== 'string' ||
    typeof nodeKey !== 'string' ||
    typeof instance !== 'string' ||
    typeof version !== 'string'
  ) {
    throw new Error(`GET /self answered non-string fields: ${JSON.stringify(body)}`)
  }
  if (typeof traffic !== 'object' || traffic === null || !('direct' in traffic) || !('relayed' in traffic)) {
    throw new Error(`GET /self answered no two-column traffic split: ${JSON.stringify(body)}`)
  }
  return {
    peerId,
    nodeKey,
    instance,
    version,
    traffic: { direct: readLeg(traffic.direct, 'direct'), relayed: readLeg(traffic.relayed, 'relayed') },
    relayService: readRelayService(relayService),
  }
}

/**
 * Narrow the relay-service reading, refusing anything that is not six declared values.
 *
 * Each counter is checked by name rather than the object being cast: a route that stopped
 * reporting one of the four directions would otherwise present as a node that had never done
 * that thing, which is exactly the false reading the log exists to prevent.
 */
function readRelayService(value: unknown): RelayServiceTotals {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`GET /self reported a relayService that is not an object: ${JSON.stringify(value)}`)
  }
  const source: Record<string, unknown> = { ...value }
  const counter = (name: string): number => {
    const read = source[name]
    if (typeof read !== 'number') {
      throw new Error(`GET /self reported relayService.${name} as ${JSON.stringify(read)}`)
    }
    return read
  }
  const marker = source['firstInboundHopStreamAt']
  if (marker !== undefined && typeof marker !== 'number') {
    throw new Error(`GET /self reported a non-numeric marker: ${JSON.stringify(marker)}`)
  }
  return {
    inboundHopStreams: counter('inboundHopStreams'),
    outboundHopStreams: counter('outboundHopStreams'),
    outboundStopStreams: counter('outboundStopStreams'),
    inboundStopStreams: counter('inboundStopStreams'),
    bytes: counter('bytes'),
    firstInboundHopStreamAt: marker,
  }
}

describe('criterion 2’s evidence — one PeerId across a construction boundary, and the boundary is visible', () => {
  it('holds the marker steady inside one instance, so a repeated read is not mistaken for a new object', async () => {
    const object = new BootstrapObject(
      newState(new FakeDurableObjectStorage(), new FakeDurableObjectAlarms()),
      ENV,
    )

    const first = await readSelf(object)
    const second = await readSelf(object)

    expect(second.instance, 'two reads of one live instance must carry one marker').toBe(
      first.instance,
    )
    expect(second.peerId).toBe(first.peerId)
  })

  it('changes the marker across a fresh instantiation while the PeerId does not — the criterion’s exact shape', async () => {
    const storage = new FakeDurableObjectStorage()
    const alarms = new FakeDurableObjectAlarms()

    // The first object writes the seed. Nothing is shared with the second: no memo, no field,
    // no closure — the same mechanism eviction and redeploy have in common.
    const before = await readSelf(new BootstrapObject(newState(storage, alarms), ENV))
    const after = await readSelf(new BootstrapObject(newState(storage, alarms), ENV))

    expect(after.peerId, 'the identity is the store’s, not the instance’s').toBe(before.peerId)
    expect(after.nodeKey).toBe(before.nodeKey)
    expect(
      after.instance,
      'a second construction must be visible, or reading 3 of the runbook proves nothing',
    ).not.toBe(before.instance)
  })

  it('gives two objects over DIFFERENT storage two PeerIds, so the marker is not the only thing moving', async () => {
    const one = await readSelf(
      new BootstrapObject(newState(new FakeDurableObjectStorage(), new FakeDurableObjectAlarms()), ENV),
    )
    const other = await readSelf(
      new BootstrapObject(newState(new FakeDurableObjectStorage(), new FakeDurableObjectAlarms()), ENV),
    )

    expect(other.peerId).not.toBe(one.peerId)
    expect(other.instance).not.toBe(one.instance)
  })

  it('still answers 404 for every other path — the marker adds a field, never a surface', async () => {
    const object = new BootstrapObject(
      newState(new FakeDurableObjectStorage(), new FakeDurableObjectAlarms()),
      ENV,
    )

    const response = await object.fetch(new Request('https://example.invalid/instance'))

    expect(response.status).toBe(404)
  })
})
describe('`GET /self` names the build it is running', () => {
  /**
   * The value is the DEPLOYMENT's, injected as a var by `scripts/deploy-hosted.sh`, so the
   * assertion here is a literal rather than a re-read of the same source. Reusing the value
   * under test is how a plant stays green while both sides move together.
   */
  it('returns the injected version verbatim', async () => {
    const object = new BootstrapObject(
      newState(new FakeDurableObjectStorage(), new FakeDurableObjectAlarms()),
      { ...ENV, O2_VERSION: '9.9.9-fixture' },
    )

    expect((await readSelf(object)).version).toBe('9.9.9-fixture')
  })

  /**
   * **A sentinel, not an absent field.** A build that cannot say what it is must say SO — a
   * missing key reads as an older node to anything parsing the answer, while this string
   * cannot be mistaken for a release. `deploy-hosted.sh` refuses a live deploy that reads it
   * back, so it can only ever be seen locally or under `wrangler dev`.
   */
  it('says so, in a word no release can be confused with, when the deployment injected nothing', async () => {
    const object = new BootstrapObject(
      newState(new FakeDurableObjectStorage(), new FakeDurableObjectAlarms()),
      ENV,
    )

    expect((await readSelf(object)).version).toBe('unversioned')
  })

  /**
   * The version travels with the deployment and the identity travels with the store. A
   * redeploy moves one and not the other, which is why they are separate fields and why this
   * case pins that they are independent.
   */
  it('changes the version across a redeploy while the PeerId does not', async () => {
    const storage = new FakeDurableObjectStorage()
    const alarms = new FakeDurableObjectAlarms()

    const before = await readSelf(
      new BootstrapObject(newState(storage, alarms), { ...ENV, O2_VERSION: '2.0.0-rc.1' }),
    )
    const after = await readSelf(
      new BootstrapObject(newState(storage, alarms), { ...ENV, O2_VERSION: '2.0.0' }),
    )

    expect(before.version).toBe('2.0.0-rc.1')
    expect(after.version).toBe('2.0.0')
    expect(after.peerId, 'a version bump must not mint a new identity').toBe(before.peerId)
  })
})

describe('NET-14 — `GET /self` carries the split, and carries it before there is one', () => {
  /**
   * The unit half of criterion 3's ordering. The e2e file reads the same field off a real
   * workerd after eight peers have dialled; what belongs here is the state that exists for
   * most of a Durable Object's life and is the harder one to get right — **nothing has
   * connected yet.**
   *
   * Two zeroed columns is what a counter that exists and has seen nothing looks like. A
   * missing field is what a counter added later looks like. A reader must be able to tell
   * them apart, which is why `readSelf` refuses a body without `traffic` rather than letting
   * one case assert it.
   */
  it('answers two zeroed columns on an object that has never built a libp2p node', async () => {
    // **`ENV` declares no announce list, and that is the evidence rather than a detail.**
    // `createHostedFabric` REFUSES to assemble with nothing announced — `hosted-libp2p`'s own
    // `NoAnnouncedAddressError`, read by `hosted-libp2p.node.test.ts`. So this reading is
    // only obtainable because `/self` did NOT construct the network stack: a version holding
    // the counter on the fabric and reaching it through `#fabricOnce()` would throw here
    // rather than answer. That is the plant, and it is structural instead of hypothetical.
    const object = new BootstrapObject(
      newState(new FakeDurableObjectStorage(), new FakeDurableObjectAlarms()),
      ENV,
    )

    expect((await readSelf(object)).traffic).toEqual({
      direct: { connectionSeconds: 0, bytes: 0 },
      relayed: { connectionSeconds: 0, bytes: 0 },
    })
  })

  it('gives two separate objects two separate counters, so the split is per-instance', async () => {
    // The granularity NET-14's row states: a Durable Object is reconstructed constantly and a
    // hibernation-woken socket is closed 1012 and redialled, so the counter is a LIVE reading
    // and not a lifetime total. Two objects over one storage share a PeerId and share no
    // count — which is the same distinction `instance` draws for identity.
    const storage = new FakeDurableObjectStorage()
    const alarms = new FakeDurableObjectAlarms()
    const first = await readSelf(new BootstrapObject(newState(storage, alarms), ENV))
    const second = await readSelf(new BootstrapObject(newState(storage, alarms), ENV))

    expect(second.peerId).toBe(first.peerId)
    expect(second.instance).not.toBe(first.instance)
    expect(second.traffic).toEqual(first.traffic)
  })
})

/**
 * `relayService` — the field that answers a question the split could not.
 *
 * The block above records the split's own granularity honestly: *the counter is a LIVE
 * reading and not a lifetime total*, so two objects over one storage share a PeerId and share
 * no count. On 2026-08-30 that turned out to have a cost nobody had priced. Asked *did a
 * browser reserve on this relay before the counters existed?*, the deployed node could not
 * answer — not because the answer was no, but because an evicted instance holds no history
 * and the question was about an ordering.
 *
 * So this field is deliberately **not** like `traffic`, and the pair of cases below is written
 * to make the difference visible in one reading rather than described in a docblock.
 */
describe('`GET /self` carries a relay-service record that OUTLIVES the instance', () => {
  it('answers zeroed counters and no marker on a node that has never relayed', async () => {
    const object = new BootstrapObject(
      newState(new FakeDurableObjectStorage(), new FakeDurableObjectAlarms()),
      ENV,
    )

    // `undefined` and not `0` for the marker, which is the one field where the difference
    // matters: `0` is a real instant (the epoch), and a node that had genuinely relayed at
    // some point would be indistinguishable from one that never had.
    expect((await readSelf(object)).relayService).toEqual({
      inboundHopStreams: 0,
      outboundHopStreams: 0,
      outboundStopStreams: 0,
      inboundStopStreams: 0,
      bytes: 0,
      firstInboundHopStreamAt: undefined,
    })
  })

  it('reports a stored history to a FRESH object — while `traffic` reads zero in the same answer', async () => {
    const storage = new FakeDurableObjectStorage()
    const alarms = new FakeDurableObjectAlarms()

    // Written through the same store the object reads, and by the same function the object
    // banks with — not injected into the object, which would be asserting a setter.
    await writeRelayServiceJournal(new DoDatastore(storage), {
      inboundHopStreams: 7,
      outboundHopStreams: 0,
      outboundStopStreams: 5,
      inboundStopStreams: 0,
      bytes: 1_024,
      firstInboundHopStreamAt: 1_756_000_000_000,
    })

    // A brand-new object. It has observed nothing, holds no memo from the write above, and
    // has not built a libp2p node — the state a Durable Object spends most of its life in.
    const reading = await readSelf(new BootstrapObject(newState(storage, alarms), ENV))

    // Literals, not the object written above: an assertion that reused the value it tests
    // would stay green if the restore silently dropped a field and the fixture followed.
    expect(reading.relayService.inboundHopStreams).toBe(7)
    expect(reading.relayService.outboundStopStreams).toBe(5)
    expect(reading.relayService.bytes).toBe(1_024)
    // **The marker is the whole point.** This instance was constructed long after that
    // moment and has no way to know it other than the store.
    expect(reading.relayService.firstInboundHopStreamAt).toBe(1_756_000_000_000)

    // **And the contrast, in the same answer.** The split reads zero for this object because
    // it is per-instance; the relay record does not because it is not. One reading carrying
    // both is what says the difference is designed rather than accidental.
    expect(reading.traffic).toEqual({
      direct: { connectionSeconds: 0, bytes: 0 },
      relayed: { connectionSeconds: 0, bytes: 0 },
    })
  })
})
