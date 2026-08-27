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

interface SelfReading {
  readonly peerId: string
  readonly nodeKey: string
  readonly instance: string
  readonly version: string
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
    !('version' in body)
  ) {
    throw new Error(`GET /self did not answer with the four declared fields: ${JSON.stringify(body)}`)
  }
  const { peerId, nodeKey, instance, version } = body
  if (
    typeof peerId !== 'string' ||
    typeof nodeKey !== 'string' ||
    typeof instance !== 'string' ||
    typeof version !== 'string'
  ) {
    throw new Error(`GET /self answered non-string fields: ${JSON.stringify(body)}`)
  }
  return { peerId, nodeKey, instance, version }
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
