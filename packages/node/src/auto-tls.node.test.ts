// `@peculiar/x509` reaches its crypto provider through tsyringe, which needs the
// `Reflect.metadata` polyfill installed before any of its decorators evaluate. Import
// order is the contract: below the other imports this throws at module load.
import 'reflect-metadata'
import { createServer } from 'node:net'
import { lookup } from 'node:dns/promises'
import { connect } from 'node:tls'
import { MemoryDatastore } from 'datastore-core'
import type { Datastore } from 'interface-datastore'
import { X509Certificate } from '@peculiar/x509'
import { afterEach, describe, expect, it } from 'vitest'
import { FabricNode } from './fabric-node.ts'
import { startLocalAcme } from './local-acme.ts'
import type { LocalAcme } from './local-acme.ts'

/**
 * NET-03's first clause, measured: **a backbone relay node auto-acquires a TLS certificate.**
 *
 * ## What was actually blocking this, and what was not
 *
 * This row was carried unmet for weeks behind *"AutoTLS needs a publicly reachable host with
 * a real DNS name."* Half of that is true and the half that is true is about **Let's
 * Encrypt**, not about the code: a public certificate authority will not name a domain it
 * cannot see you control. The acquisition *mechanism* — account key, JWS, dns-01, CSR,
 * chain, listener upgrade, datastore cache — needs no public anything. It needs a CA.
 *
 * `local-acme.ts` supplies one, on loopback, speaking real RFC 8555 over real sockets with
 * real DNS underneath. Read its module comment for the boundary; the one sentence version
 * is that everything here is the shipped code path except the *identity* of the authority.
 *
 * ## The one thing this rig simulates, stated where it cannot be missed
 *
 * `@ipshipyard/libp2p-auto-tls` will not order a certificate for a node holding no address
 * that is both non-loopback and non-RFC-1918 — `supportedAddressesFilter` in its `utils.js`.
 * A laptop behind NAT has no such address to bind, so the rig **declares** one through
 * `appendAnnounce`, which is the same field a relay behind a port-forward uses for the same
 * reason. The address is `233.252.0.1` — RFC 5771 MCAST-TEST-NET-1, reserved for
 * documentation, and the case below *measures* that `@libp2p/utils` does not classify it as
 * private rather than assuming it. Nothing is ever dialled at it: the name AutoTLS derives
 * from it ends in `.localhost`, which resolves to loopback, where the socket really is.
 *
 * So: **reachability is declared here, TLS is acquired here.** A run of this file says
 * nothing about whether a public CA would issue, and everything about whether this node
 * asks correctly and installs what it gets.
 */

/** RFC 5771 §4 MCAST-TEST-NET-1 — reserved for documentation, and routable as far as libp2p cares. */
const DECLARED_PUBLIC_IP = '233.252.0.1'
const DECLARED_PUBLIC_LABEL = '233-252-0-1'

/**
 * Long, and load-bearing: an RSA-2048 account key, an RSA-2048 certificate key, a CSR and
 * three RSA signatures are generated inside it. On a contended host the keygen alone has
 * been seen past ten seconds.
 */
const ACQUIRE_TIMEOUT_MS = 120_000

interface Rig {
  readonly acme: LocalAcme
  readonly node: FabricNode
  readonly port: number
  readonly datastore: Datastore
}

const started: { node?: FabricNode; acme?: LocalAcme }[] = []

afterEach(async () => {
  for (const entry of started.splice(0)) {
    await entry.node?.stop().catch(() => {})
    await entry.acme?.close().catch(() => {})
  }
})

/** A port nobody holds, released before the node binds it. Racy in principle, never in practice. */
async function freePort(): Promise<number> {
  const probe = createServer()
  await new Promise<void>((resolve) => {
    probe.listen(0, '127.0.0.1', resolve)
  })
  const address = probe.address()
  if (address === null || typeof address === 'string') throw new Error('probe did not bind')
  const { port } = address
  await new Promise<void>((resolve) => {
    probe.close(() => {
      resolve()
    })
  })
  return port
}

async function startRig(
  options: {
    acme?: LocalAcme
    datastore?: Datastore
    port?: number
    /** Declare the address in its `/tls/ws` form — see the published-address case. */
    secureAnnounce?: boolean
  } = {},
): Promise<Rig> {
  const acme = options.acme ?? (await startLocalAcme())
  const datastore = options.datastore ?? new MemoryDatastore()
  const port = options.port ?? (await freePort())
  const node = await FabricNode.start({
    // Stated rather than defaulted, as this package requires. None of the three bears on
    // certificate acquisition: this node runs no dispatched module, admits any reserving
    // peer, and reports its own start.
    trustAnchors: 'runs-unsigned-artifacts',
    relayAdmission: 'admits-any-peer',
    startReporting: 'reports-its-own-start',
    listen: [`/ip4/127.0.0.1/tcp/${port}/ws`],
    appendAnnounce: [
      `/ip4/${DECLARED_PUBLIC_IP}/tcp/${port}${options.secureAnnounce === true ? '/tls/ws' : '/ws'}`,
    ],
    datastore,
    autoTls: {
      acmeDirectory: acme.directoryUrl,
      forgeEndpoint: acme.forgeEndpoint,
      forgeDomain: acme.forgeDomain,
      // The library debounces address changes by 5 s before ordering. Nothing here adds
      // addresses after start, so the wait buys nothing but wall clock.
      provisionDelayMs: 50,
    },
  })
  // The rig owns the CA only when it created it; a caller that passed one in is
  // responsible for closing it, and closing it twice would tear down the second node's
  // authority in the restart case.
  started.push(options.acme === undefined ? { node, acme } : { node })
  return { acme, node, port, datastore }
}

/** Poll until a condition holds, or fail naming it. Nothing here is driven by a call. */
async function until(holds: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (holds()) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`condition did not hold within ${timeoutMs}ms`)
}

/** Poll rather than await an event: the acquisition is kicked off by a debounce, not a call. */
async function awaitCertificate(node: FabricNode, timeoutMs: number): Promise<void> {
  await until(() => node.tlsCertificate !== undefined, timeoutMs).catch(() => {
    throw new Error(`no certificate after ${timeoutMs}ms`)
  })
}

describe('NET-03 — a relay acquires its own TLS certificate, with nobody managing one', () => {
  it('the two facts the rig stands on are measured, not assumed', async () => {
    // (1) Every `*.localhost` name resolves to loopback, so the name AutoTLS derives from a
    // declared address reaches the socket the node really bound. RFC 6761 §6.3 requires
    // this; macOS and Chromium both honour it. If a host ever stops, this fails first and
    // names itself rather than surfacing as a TLS error three cases down.
    const resolved = await lookup(`${DECLARED_PUBLIC_LABEL}.k51example.localhost`, { all: true })
    expect(resolved.map((entry) => entry.address)).toContain('127.0.0.1')

    // (2) The declared address passes AutoTLS's own filter. Read through the very module
    // the library reads it through, so a change of classification in `@libp2p/utils` breaks
    // this rather than silently disabling the acquisition path everywhere.
    const { isPrivate, isLoopback } = await import('@libp2p/utils')
    const { multiaddr } = await import('@multiformats/multiaddr')
    const declared = multiaddr(`/ip4/${DECLARED_PUBLIC_IP}/tcp/1/ws`)
    expect(isPrivate(declared)).toBe(false)
    expect(isLoopback(declared)).toBe(false)
    // And the arrangement is not vacuous: the address it replaces would have been refused.
    expect(isPrivate(multiaddr('/ip4/127.0.0.1/tcp/1/ws'))).toBe(true)
  })

  it(
    'orders, receives and installs a certificate for its own peer id — no certificate configured anywhere',
    async () => {
      const { acme, node } = await startRig()
      await awaitCertificate(node, ACQUIRE_TIMEOUT_MS)

      const held = node.tlsCertificate
      expect(held).toBeDefined()
      if (held === undefined) throw new Error('unreachable')

      // The CA issued exactly one, and it is the one the node is holding.
      expect(acme.issued().length).toBe(1)
      const parsed = new X509Certificate(held.cert)
      expect(parsed.serialNumber).toBe(acme.issued()[0]?.serialNumber)

      // It chains to the rig's root and to nothing else.
      const root = new X509Certificate(acme.caCertificatePem)
      expect(parsed.issuer).toBe(root.subject)
      expect(await parsed.verify({ publicKey: root.publicKey })).toBe(true)

      // It is for a wildcard under this node's *own* peer id, which is what makes the
      // per-address name below match. A certificate for anybody else would still verify.
      const { base36 } = await import('multiformats/bases/base36')
      const { peerIdFromString } = await import('@libp2p/peer-id')
      const domain = `${base36.encode(peerIdFromString(node.peerId).toCID().bytes)}.${acme.forgeDomain}`
      expect(held.key).toContain('PRIVATE KEY')
      expect(parsed.subject).toContain(`*.${domain}`)

      // The forge was reached, and it authenticated the caller rather than believing a
      // field: the peer id below came out of the libp2p PeerID-auth handshake.
      const calls = acme.forgeCalls()
      expect(calls.length).toBeGreaterThanOrEqual(1)
      expect(calls[0]?.peerId).toBe(node.peerId)
      expect(calls[0]?.record).toBe(`_acme-challenge.${domain}`)
      // And the addresses it offered are the ones that made it eligible.
      expect(calls[0]?.addresses.some((addr) => addr.includes(DECLARED_PUBLIC_IP))).toBe(true)
    },
    ACQUIRE_TIMEOUT_MS,
  )

  it(
    'serves the acquired certificate on the socket it already had, under the name it derived',
    async () => {
      const { acme, node, port } = await startRig()
      await awaitCertificate(node, ACQUIRE_TIMEOUT_MS)

      const { base36 } = await import('multiformats/bases/base36')
      const { peerIdFromString } = await import('@libp2p/peer-id')
      const domain = `${base36.encode(peerIdFromString(node.peerId).toCID().bytes)}.${acme.forgeDomain}`
      const servername = `${DECLARED_PUBLIC_LABEL}.${domain}`

      // A real TLS handshake to the port the node bound before it had any certificate —
      // `@libp2p/websockets` multiplexes http and https on one socket and switches on the
      // first byte, so this is the same listener that was serving plain `ws` a moment ago.
      const presented = await new Promise<X509Certificate>((resolve, reject) => {
        const socket = connect(
          { host: '127.0.0.1', port, servername, ca: [acme.caCertificatePem] },
          () => {
            const peer = socket.getPeerX509Certificate()
            socket.end()
            if (peer === undefined) {
              reject(new Error('handshake presented no certificate'))
              return
            }
            resolve(new X509Certificate(peer.raw))
          },
        )
        socket.on('error', reject)
      })

      // `authorized` would have been false and the handshake would have thrown had the
      // chain not validated, so reaching here is the assertion. This names what was served.
      expect(presented.serialNumber).toBe(acme.issued()[0]?.serialNumber)
      expect(presented.subject).toContain(`*.${domain}`)

      // The listener upgraded itself: the node now publishes a secure WebSocket address it
      // did not and could not publish before, on the port it was already bound to.
      const advertised = node.libp2p.getMultiaddrs().map((ma) => ma.toString())
      expect(advertised.some((addr) => addr.includes(`/tcp/${port}/tls/ws`))).toBe(true)
    },
    ACQUIRE_TIMEOUT_MS,
  )

  it(
    'publishes the browser-dialable name once the address it certifies is a secure one',
    async () => {
      // **The address a browser is actually handed**, and the case that found out how it is
      // built. libp2p attaches the certified name as an **SNI component inside an existing
      // address** rather than as a `/dns4/` address of its own — `dns-mappings.js:90`
      // `maybeAddSNIComponent` inserts `/sni/<domain>` immediately after a `/tls` tuple and
      // returns null when there is no `/tls` tuple to insert after. So the published form
      // is `/ip4/<ip>/tcp/<port>/tls/sni/<name>/ws`, and it exists only for an address that
      // was already secure.
      //
      // On a public host that address is the listener's own, because the socket is bound to
      // a routable IP and `listener.js:286` adds `/tls/ws` to it the moment the certificate
      // lands. This host has no routable IP to bind — measured: every interface is RFC 1918
      // or a ULA — so the secure form is declared instead. That declaration is the *only*
      // difference from a deployment, and it is what the previous case's handshake shows is
      // not a fiction: the name below is the name a client completed a TLS handshake under.
      const { acme, node } = await startRig({ secureAnnounce: true })
      await awaitCertificate(node, ACQUIRE_TIMEOUT_MS)

      const { base36 } = await import('multiformats/bases/base36')
      const { peerIdFromString } = await import('@libp2p/peer-id')
      const domain = `${base36.encode(peerIdFromString(node.peerId).toCID().bytes)}.${acme.forgeDomain}`
      const advertised = node.libp2p.getMultiaddrs().map((ma) => ma.toString())
      const published = advertised.find((addr) => addr.includes('/sni/'))

      expect(published).toBeDefined()
      expect(published).toContain(`/sni/${DECLARED_PUBLIC_LABEL}.${domain}/ws`)
      // And it names this peer, so a browser handed it dials this node and not a relay of it.
      expect(published).toContain(`/p2p/${node.peerId}`)
    },
    ACQUIRE_TIMEOUT_MS,
  )

  it(
    'gets no certificate when the record the forge placed does not answer the challenge',
    async () => {
      // **The negative that reaches the authority**, and it exists because the sibling
      // below does not. With a *missing* forge, AutoTLS's `challengeCreateFn` throws and
      // retries and the challenge is never submitted, so no amount of laxity in the CA
      // could show up there — verified by planting `if (true)` over the rig's dns-01
      // comparison and watching that case stay green.
      //
      // Here the forge answers, with the wrong value. The record is placed, the challenge
      // *is* submitted, and the only thing standing between this node and a certificate is
      // the CA comparing a TXT record against a digest. The same plant turns this red, and
      // this is the text it printed:
      //
      //   AssertionError: expected 1 to be +0 // Object.is equality
      //     ❯ auto-tls.node.test.ts  expect(acme.issued().length).toBe(0)
      const acme = await startLocalAcme({ forgeAnswersWrongly: true })
      const { node } = await startRig({ acme })

      // **Wait for the stage, not for a duration.** A fixed sleep made this case read the
      // clock rather than the code: the first plant run failed on the forge-call assertion
      // instead of the certificate one, because two RSA-2048 keygens had not finished
      // inside the window. Whether a defect exists must not depend on how loaded the host
      // is, so the precondition is *awaited* and only the refusal is timed.
      await until(() => acme.forgeCalls().length >= 1, ACQUIRE_TIMEOUT_MS)
      expect([...acme.txtRecords().keys()].length).toBeGreaterThanOrEqual(1)

      // From here the node has done everything it can and the authority is the only thing
      // left. Several full retry cycles — the library waits 5 s between attempts.
      await new Promise((resolve) => setTimeout(resolve, 12_000))
      expect(acme.issued().length).toBe(0)
      expect(node.tlsCertificate).toBeUndefined()
    },
    ACQUIRE_TIMEOUT_MS,
  )

  it(
    'refuses to hand out a certificate when the forge cannot answer for the domain',
    async () => {
      // The *other* negative, and it fails earlier than the one above: with no forge to
      // reach, nothing is ever placed in the zone and the challenge is never submitted.
      // What this case proves is that the forge call is not optional — remove the retry and
      // let AutoTLS proceed regardless, and a certificate would appear here.
      const acme = await startLocalAcme({ forgeDomain: 'localhost' })
      const port = await freePort()
      const node = await FabricNode.start({
        trustAnchors: 'runs-unsigned-artifacts',
        relayAdmission: 'admits-any-peer',
        startReporting: 'reports-its-own-start',
        listen: [`/ip4/127.0.0.1/tcp/${port}/ws`],
        appendAnnounce: [`/ip4/${DECLARED_PUBLIC_IP}/tcp/${port}/ws`],
        autoTls: {
          acmeDirectory: acme.directoryUrl,
          // A forge that is not there. AutoTLS's `challengeCreateFn` retries this on a
          // 5 s cycle for the whole provision timeout and never gives up early.
          forgeEndpoint: `http://127.0.0.1:${await freePort()}/`,
          forgeDomain: acme.forgeDomain,
          provisionDelayMs: 50,
          provisionTimeoutMs: 4_000,
        },
      })
      started.push({ node, acme })

      await new Promise((resolve) => setTimeout(resolve, 8_000))
      expect(node.tlsCertificate).toBeUndefined()
      expect(acme.issued()).toEqual([])
      // The zone stayed empty, which names the stage that stopped it: not the CA, not the
      // CSR, but the forge never being reached.
      expect([...acme.txtRecords().keys()]).toEqual([])
    },
    ACQUIRE_TIMEOUT_MS,
  )

  it(
    'a restart reuses the stored certificate instead of ordering a second one',
    async () => {
      // The other half of `without manual certificate management`: not just acquiring one,
      // but not re-acquiring one. A relay that ordered afresh on every restart would be
      // rate-limited off a real CA within a day.
      const datastore = new MemoryDatastore()
      const first = await startRig({ datastore })
      await awaitCertificate(first.node, ACQUIRE_TIMEOUT_MS)
      const original = first.node.tlsCertificate?.cert
      expect(first.acme.issued().length).toBe(1)
      await first.node.stop()

      const second = await startRig({
        acme: first.acme,
        datastore,
        // The same port, because the certificate is bound to the peer and the *name*, and
        // reusing the port keeps the second node's address set identical to the first's.
        port: first.port,
      })
      await awaitCertificate(second.node, ACQUIRE_TIMEOUT_MS)

      expect(second.node.tlsCertificate?.cert).toBe(original)
      // The reading that carries the claim: the CA saw one order across two starts.
      expect(first.acme.issued().length).toBe(1)
      // And the forge was not asked to place a second challenge record either.
      expect(first.acme.forgeCalls().length).toBe(1)
    },
    ACQUIRE_TIMEOUT_MS * 2,
  )
})
