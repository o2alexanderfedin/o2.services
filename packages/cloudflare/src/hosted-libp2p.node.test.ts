/**
 * The assembly's decisions, read as data, plus the one claim that makes 6 and 7 one thing.
 *
 * **`.node.test.ts`, deliberately.** This file constructs a real libp2p node, and this
 * session already paid once for finding out what a static `node:*` import does to the browser
 * lane — Vite externalises it and all three engines fail to load the module. A spec that
 * brings a whole network stack in belongs in the lane that has one.
 *
 * What is asserted here is everything on this side of the Cloudflare boundary. What is NOT
 * asserted, and is reported open rather than simulated, is that this configuration dials and
 * is dialled: that is Group B in `ARCHITECTURE.md` §7 and an owner act.
 */

import { readFileSync } from 'node:fs'
import { Key } from 'interface-datastore'
import { afterEach, describe, expect, it } from 'vitest'
import { FakeDurableObjectAlarms, FakeDurableObjectStorage } from './do-storage.fixture.ts'
import {
  HOSTED_INBOUND_THRESHOLD,
  HOSTED_MAX_PENDING_INBOUND,
  NoAnnouncedAddressError,
  announcedAddresses,
  createHostedFabric,
  hostedAddresses,
  hostedConnectionManagerInit,
  hostedDhtInit,
  hostedRelayInit,
} from './hosted-libp2p.ts'
import type { HostedFabric } from './hosted-libp2p.ts'

const ANNOUNCE = ['/dns4/bootstrap.example/tcp/443/tls/ws']

let running: HostedFabric | undefined
afterEach(async () => {
  await running?.libp2p.stop()
  running = undefined
})

describe('the four settings a private keyspace needs, as data rather than in a closure', () => {
  it('states all four, because leaving any of them out is silent', () => {
    // `CLAUDE.md` records what two of them cost: with `peerInfoMapper` left at its default no
    // peer was ever added to a routing table behind a relay, and with `selectors` unregistered
    // every read threw `MissingSelectorError` into a catch that presented it as an empty
    // keyspace. Neither raised anything. Plant that reddens this: drop `peerInfoMapper`.
    const init = hostedDhtInit(() => 1_000)

    expect(init.protocol).toBe('/o2/kad/1.0.0')
    expect(init.clientMode).toBe(false)
    expect(init.peerInfoMapper).toBeTypeOf('function')
    expect(Object.keys(init.validators)).toEqual(['o2'])
    expect(Object.keys(init.selectors)).toEqual(['o2'])
  })

  it('serves records rather than relying on auto-promotion', () => {
    // The hosted node is the always-reachable one; it is the peer that must answer. Leaving
    // `clientMode` unset makes the role follow the RELAY's address class, so the same code
    // promotes on a public relay and stays a client on a LAN one with nothing saying so.
    expect(hostedDhtInit().clientMode).toBe(false)
  })

  it('registers a selector beside every validator', () => {
    // Written as a comparison of the two key sets rather than as two literals, because the
    // defect is precisely that one is present and the other is not.
    const init = hostedDhtInit()
    expect(Object.keys(init.selectors)).toEqual(Object.keys(init.validators))
  })

  it('takes the fabric’s provider lifetime, never the library’s 48 h', () => {
    expect(hostedDhtInit(Date.now, 4_000)).toMatchObject({
      reprovide: { validity: 4_000, interval: 1_000, threshold: 2_000 },
    })
  })
})

describe('the relay’s capacity, and the address it has no way to discover', () => {
  it('grants the fabric’s own reservation count', () => {
    expect(hostedRelayInit().maxReservations).toBe(64)
    expect(hostedRelayInit(3).maxReservations).toBe(3)
  })

  it('counts the data limit in bigint, following the library’s own signature', () => {
    expect(typeof hostedRelayInit().defaultDataLimit).toBe('bigint')
  })

  it('REFUSES to assemble with nothing announced', () => {
    // Measured, consult §13: a relay server with no announced address hands every client an
    // empty reservation and raises nothing. A Durable Object cannot discover its own address,
    // so there is no default that would be a fact rather than a guess. Plant that reddens
    // this: return `{listen: [], announce: []}` instead of throwing.
    expect(() => hostedAddresses([])).toThrow(NoAnnouncedAddressError)
  })

  it('listens on nothing, which is not an oversight', () => {
    // workerd binds no socket. Inbound arrives as an upgraded request, and that half is
    // Phase 30's by the roadmap's own division.
    expect(hostedAddresses(ANNOUNCE)).toEqual({ listen: [], announce: ANNOUNCE })
  })
})

describe('steps 6 and 7 are one deliverable — proven as a value, not as a rule', () => {
  it('ARMS THE ALARM AND ADMITS RECORDS, and there is no ordering that does one without the other', async () => {
    // ARCHITECTURE:510-517 — *"there is no safe intermediate state where 6 exists alone."*
    // This is that sentence as a check. The admitting store is constructed FROM the sweep,
    // and the only producer of a sweep arms the alarm, so a record-accepting hosted node
    // that would accumulate forever is not something a caller can build by getting the
    // argument order wrong. Plant that reddens this: hand `createHostedLibp2p` a
    // `new DoDatastore(init.storage)` with no sweep.
    const storage = new FakeDurableObjectStorage()
    const alarms = new FakeDurableObjectAlarms()

    running = await createHostedFabric({ storage, alarms, announce: ANNOUNCE })

    expect(await alarms.getAlarm()).not.toBeNull()
    expect(alarms.setCalls.length).toBe(1)

    // **The store the assembly actually handed libp2p**, read back off the result. Building
    // one here with `new DoDatastore(storage, running.sweep)` was the first version of this
    // and it was worthless: a plant that gave libp2p an UNSWEPT store left it green, because
    // it was asserting the constructor the test itself had just called.
    expect(running.datastore.admitsRecords).toBe(true)
    await expect(
      running.datastore.put(new Key('/dht/record/AAAA'), new Uint8Array([1])),
    ).resolves.toBeDefined()
  }, 30_000)

  it('keeps `/o2/` refused even with a sweep, because the sweep does not walk it', async () => {
    // `/o2/<nodeKey>` names are DHT KEYS, hashed into `/dht/record/<base32>` before they
    // reach any datastore — so a correctly-wired kad-dht never presents one here, and the
    // reason that refusal was written survives the sweep landing. Plant that reddens this:
    // make `#admits` return true for any refused namespace.
    const storage = new FakeDurableObjectStorage()
    const alarms = new FakeDurableObjectAlarms()

    running = await createHostedFabric({ storage, alarms, announce: ANNOUNCE })

    await expect(
      running.datastore.put(new Key('/o2/abcdef'), new Uint8Array([1])),
    ).rejects.toThrow(/refus/i)
  }, 30_000)

  it('gives the node the identity its own storage holds, not a fresh one', async () => {
    const storage = new FakeDurableObjectStorage()
    const alarms = new FakeDurableObjectAlarms()

    running = await createHostedFabric({ storage, alarms, announce: ANNOUNCE })
    const first = running.identity.peerId

    // A second assembly over the SAME storage — no memo is shared between them, so an equal
    // answer is the store's and not an instance's.
    const second = await createHostedFabric({ storage, alarms, announce: ANNOUNCE })
    try {
      expect(second.identity.peerId).toBe(first)
      expect(running.libp2p.peerId.toString()).toBe(first)
    } finally {
      await second.libp2p.stop()
    }
  }, 30_000)
})

describe('what the node announces comes from the deployment, never from a visitor', () => {
  it('splits a comma-separated var and trims it', () => {
    expect(announcedAddresses('/dns4/a.example/tcp/443/tls/ws , /dns4/b.example/tcp/443/tls/ws')).toEqual([
      '/dns4/a.example/tcp/443/tls/ws',
      '/dns4/b.example/tcp/443/tls/ws',
    ])
  })

  it('drops empty entries rather than announcing one', () => {
    // A trailing comma is the ordinary way this var gets edited wrong. Passed through, the
    // empty string would reach `hostedAddresses` as an address, and the refusal it raises
    // would then be about the wrong thing. Plant that reddens this: drop the length filter.
    expect(announcedAddresses('/dns4/a.example/tcp/443/tls/ws,,')).toEqual([
      '/dns4/a.example/tcp/443/tls/ws',
    ])
  })

  it('answers [] for an unset var, so the refusal comes from `hostedAddresses`', () => {
    // One refusal, in one place, with one message — rather than a second one here that would
    // say the same thing differently.
    expect(announcedAddresses(undefined)).toEqual([])
    expect(() => hostedAddresses(announcedAddresses(undefined))).toThrow(NoAnnouncedAddressError)
  })
})

describe('NET-11 — the inbound limits, because the library defaults are a fabric-wide ceiling', () => {
  /**
   * **Measured, not reasoned, and the measurement is in `inbound-listener.e2e.test.ts`.**
   * Eight libp2p peers dialling the locally-run object together were admitted four and
   * refused four — `EncryptionFailedError: The operation was aborted due to timeout` on peers
   * 4 through 7, which is what a rate-limited handshake looks like from the dialling side.
   *
   * The cause is libp2p's `inboundConnectionThreshold`, whose default is **5 per second per
   * remote host** and whose limiter keys on the host derived from `remoteAddr`. On this tier
   * that is the whole fabric's admission rate, and it is silent in both directions: nothing
   * surfaces above `log()`, and the dialler is told its encryption timed out.
   */
  it('raises the per-host inbound threshold above the library default of five', () => {
    // The literal is written out rather than compared against the library's constant: reading
    // `INBOUND_CONNECTION_THRESHOLD` here would make the assertion agree with whatever the
    // dependency happens to say, which is the mistake this repository has paid for before.
    expect(HOSTED_INBOUND_THRESHOLD).toBeGreaterThan(5)
    expect(hostedConnectionManagerInit().inboundConnectionThreshold).toBe(HOSTED_INBOUND_THRESHOLD)
  })

  it('raises the in-flight inbound handshake bound above the library default of ten', () => {
    expect(HOSTED_MAX_PENDING_INBOUND).toBeGreaterThan(10)
    expect(hostedConnectionManagerInit().maxIncomingPendingConnections).toBe(
      HOSTED_MAX_PENDING_INBOUND,
    )
  })

  it('leaves both bounds FINITE, so a flood still meets a wall', () => {
    // Raising a bound is not removing it. `Infinity` here would trade a silent ceiling for a
    // silent absence of one, which is the same class of defect in the other direction.
    expect(Number.isFinite(HOSTED_INBOUND_THRESHOLD)).toBe(true)
    expect(Number.isFinite(HOSTED_MAX_PENDING_INBOUND)).toBe(true)
  })

  it('is actually reached by the assembly, not merely exported', async () => {
    // The failure this guards: a constant declared, documented, and never passed to
    // `createLibp2p` — which is exactly the state this file found the package in.
    const source = readFileSync(
      new URL('./hosted-libp2p.ts', import.meta.url),
      'utf8',
    )
    expect(source).toContain('connectionManager: hostedConnectionManagerInit()')
  })
})
