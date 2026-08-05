/**
 * The seed node — one command that a phone on the same network can join.
 *
 * ## What "automatic discovery" can and cannot mean
 *
 * A browser cannot do mDNS. There is no API for it, in any browser, so a tab can
 * never autonomously find a peer on the LAN the way `@libp2p/mdns` does in Node.
 * That half is simply not available and no amount of design recovers it.
 *
 * What *is* available is better than it sounds. The phone has to learn one address —
 * and after that, everything else is derived rather than configured:
 *
 *   1. **The name is already published.** macOS advertises its hostname over Bonjour
 *      and iOS resolves `.local` natively, so `http://<hostname>.local:<port>` works
 *      from Safari with no setup and survives the laptop's DHCP lease changing. No IP
 *      to read off a screen and retype.
 *
 *   2. **The relay address is derived from the request.** `/bootstrap.json` is built
 *      per request from the `Host` header, so the page hands back a multiaddr
 *      pointing at *whatever name the phone already used*. Reach the seed as
 *      `macbook.local` and you are told to dial `/dns4/macbook.local/...`; reach it by
 *      IP and you are told `/ip4/.../...`. Nothing is hardcoded, nothing is guessed
 *      from network interfaces, and a stale address cannot be baked into the build —
 *      which is also what criterion 2 asks for.
 *
 * So the phone's flow is: open one URL (or scan its QR code) → the page asks its own
 * origin who to dial → it joins. From the user's side that is automatic; it is just
 * not *magic*, and the distinction is worth being honest about.
 *
 * ## Why this can be plain HTTP
 *
 * A LAN origin is not a secure context, so `crypto.subtle` is unavailable there. The
 * kernel hashes in pure JS precisely so that does not matter — see `@o2/core/hash.ts`.
 * WebSockets over `ws://` are likewise fine from an `http://` page; it is only an
 * `https://` page that would refuse them as mixed content.
 */

import { networkInterfaces, hostname } from 'node:os'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import type { ViteDevServer } from 'vite'
import { FabricNode } from './fabric-node.ts'
import type { FabricNodeOptions } from './fabric-node.ts'

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const PAGE_PATH = '/packages/browser/demo/index.html'

/**
 * What a joining browser is told, derived from how it reached us.
 *
 * One peer id, because there is one node. This carried `relayPeerId` and
 * `seedPeerId` as separate fields for two phases, and they named two processes in
 * one command: a relay that could not compute and a compute node that could not
 * relay. A page that dialled both got two connections and one usable peer, and the
 * demo reported "2 compute peers of 3 connections" without anything being able to
 * explain the missing one. Collapsing the fields is the visible half of collapsing
 * the classes.
 */
export interface BootstrapInfo {
  /**
   * Multiaddrs of the seed node, expressed in terms of the host the client used.
   *
   * Named for what a joining page *does* with it — reserve a circuit on it — and not
   * for a kind of node. The same node serves the page, holds the reservation, and
   * runs shards.
   */
  readonly relayAddrs: readonly string[]
  /** The seed node's peer id. It relays, it serves blocks, and it computes. */
  readonly seedPeerId: string
  /**
   * Everyone currently reachable here, as an address they can be dialled at.
   *
   * A browser cannot announce itself — it binds no listening socket, which is the
   * only difference between nodes in this fabric. So the one node that *can* be
   * dialled cold publishes who else is here, and each page dials the rest. The list
   * is derived from the live reservation store; the seed keeps no registry and
   * grants no authority by holding it.
   *
   * The first entry is the seed itself, over WebSockets. It repeats `relayAddrs[0]`
   * exactly, and that repetition is the point: a page's relay and a page's peer are
   * one node, so anything that treated the two lists as disjoint was wrong.
   *
   * Excludes nobody: a page filters its own address out, because only the page knows
   * which one it is.
   */
  readonly peerAddrs: readonly string[]
}

export interface SeedServerOptions {
  /** HTTP port for the page and `/bootstrap.json`. 0 picks a free one. */
  readonly httpPort?: number
  /** TCP port the node listens on for WebSockets. 0 picks a free one. */
  readonly wsPort?: number
  readonly blockstoreDir: string
  /**
   * The build authorities this seed's node will run a module for — DET-03, DATA-08.
   *
   * Required and passed straight through to {@link FabricNodeOptions.trustAnchors},
   * where the three values and the reason none of them is a default are documented in
   * full. A seed executes tasks like any other node — the only difference between
   * nodes is discovery — so it needs the same anchors any other node needs, and the
   * binary above it is what supplies them.
   */
  readonly trustAnchors: FabricNodeOptions['trustAnchors']
  /**
   * Provider keys whose certificates this seed accepts from a peer — AUTH-02.
   *
   * **A different pinning from {@link SeedServerOptions.trustAnchors} above, and
   * conflating the two is the mistake this field exists to prevent.** An anchor says whose
   * *build* records this seed will run a module for (DET-03); an issuer says whose
   * *enrollment* signature it will believe about a peer (AUTH-02). A module and a peer are
   * different subjects, and a key pinned for one says nothing about the other — so one
   * line cannot carry both, and overloading `trustAnchors` would silently make a seed's
   * build authority into its identity authority.
   *
   * Optional, and passed straight through to {@link FabricNodeOptions.trustedIssuers},
   * where the meaning of omitting it is documented in full: a seed that pins nobody
   * verifies nobody and treats every connected peer as usable, which is what every node in
   * this repository did before this option existed. That is a **stated** absence rather
   * than a safe default, and it is not defaulted here for the same reason `trustAnchors`
   * is not.
   *
   * **This is a selection gate, not an admission one, and the difference matters here more
   * than anywhere else.** Pinning an issuer changes which peers this seed will fetch a
   * *block* from. It does **not** decide who may join: this seed keeps granting circuit
   * reservations to every peer that completes a handshake, and keeps publishing all of
   * them through `BootstrapInfo.peerAddrs`. Who gets *in* is
   * {@link FabricNodeOptions.relayAdmission}, which the construction below states as open
   * and which nothing reads yet.
   */
  readonly trustedIssuers?: FabricNodeOptions['trustedIssuers']
  readonly maxReservations?: number
  /**
   * Hostnames the page may be requested by.
   *
   * Vite refuses any `Host` it does not recognise, as protection against DNS
   * rebinding, and **allows only `localhost`, `.localhost`, and IP literals by
   * default**. A seed exists to be reached from another device — typically by the
   * machine's Bonjour name — so the default here adds `.local`, which covers every
   * name mDNS can hand out and nothing else.
   *
   * Extend it for other naming schemes (a Tailscale `.ts.net` name, say). `true`
   * disables the check entirely and is not recommended.
   */
  readonly allowedHosts?: readonly string[] | true
}

/** Strip a `:port` suffix from a Host header, leaving IPv6 brackets intact. */
function hostWithoutPort(host: string): string {
  if (host.startsWith('[')) {
    const close = host.indexOf(']')
    return close === -1 ? host : host.slice(0, close + 1)
  }
  const colon = host.lastIndexOf(':')
  return colon === -1 ? host : host.slice(0, colon)
}

/** Build a browser-dialable multiaddr for the host the client actually used. */
export function relayAddrForHost(host: string, wsPort: number, peerId: string): string {
  const bare = hostWithoutPort(host)
  // A literal IPv4 needs /ip4; anything else is a name and needs /dns4. Getting this
  // wrong produces a multiaddr that parses and never dials.
  const isIpv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(bare)
  const prefix = isIpv4 ? `/ip4/${bare}` : `/dns4/${bare}`
  return `${prefix}/tcp/${wsPort}/ws/p2p/${peerId}`
}

/** LAN IPv4 addresses of this machine, for printing a fallback URL. */
export function lanAddresses(): readonly string[] {
  const found: string[] = []
  for (const addrs of Object.values(networkInterfaces())) {
    for (const addr of addrs ?? []) {
      if (addr.family === 'IPv4' && !addr.internal) found.push(addr.address)
    }
  }
  return found
}

/**
 * The `.local` name this machine already answers to.
 *
 * Not advertised by us — macOS and most Linux desktops publish it over
 * mDNS/Bonjour already, and iOS resolves it without any app or profile.
 */
export function localHostname(): string {
  const name = hostname()
  return name.endsWith('.local') ? name : `${name}.local`
}

export class SeedServer {
  /**
   * The node. Singular.
   *
   * This was two — a relay and a compute node, two peer ids in one process, one of
   * them deliberately unable to run a task. Nothing about binding a socket for
   * someone else's handshake stops a process from also executing shards, so the
   * split bought nothing and cost a peer.
   */
  readonly node: FabricNode
  readonly #http: ViteDevServer
  readonly #httpPort: number
  readonly #wsPort: number

  private constructor(parts: {
    node: FabricNode
    http: ViteDevServer
    httpPort: number
    wsPort: number
  }) {
    this.node = parts.node
    this.#http = parts.http
    this.#httpPort = parts.httpPort
    this.#wsPort = parts.wsPort
  }

  /**
   * Stand a seed up, or leave the machine as it was found.
   *
   * Same split as `FabricNode.start`, and for the same reason: `#compose` pushes a
   * release on the line after each acquisition, and this method is the only thing
   * that knows what to do when one of the later steps says no. A seed that failed
   * half-way used to strand a whole node holding two bound listeners — the WebSocket
   * port a browser dials and the plain TCP one another node dials.
   */
  static async start(options: SeedServerOptions): Promise<SeedServer> {
    const undo: (() => Promise<void> | void)[] = []
    try {
      return await SeedServer.#compose(options, undo)
    } catch (cause) {
      for (const release of undo.reverse()) {
        try {
          await release()
        } catch {
          // Nothing to do about it, and reporting it would report the wrong failure.
        }
      }
      throw cause
    }
  }

  static async #compose(
    options: SeedServerOptions,
    undo: (() => Promise<void> | void)[],
  ): Promise<SeedServer> {
    const wsPort = options.wsPort ?? 0

    // 0.0.0.0, not loopback: the point is to be reachable from another device.
    //
    // WebSockets **and** plain TCP. `/ws` is the only one of these a browser can
    // dial, and TCP is what another Node peer prefers; a node that bound only the
    // second was unreachable from the tier this seed exists to serve, while its
    // comment claimed otherwise. Binding a real address here is also what makes this
    // node able to relay — `FabricNode` derives the circuit-relay service from the
    // listen list rather than from an option, so there is nothing further to switch
    // on.
    const node = await FabricNode.start({
      // AUTH-02 — **the door this seed holds open, stated by name rather than by
      // omission.** A seed binds a real listening socket, so it relays, so this value is
      // the one that will decide who may join through it once something reads it. Nothing
      // does yet.
      //
      // `'admits-any-peer'` is what this process does today and is written here rather
      // than derived from `trustedIssuers` below, because the two are different questions
      // and collapsing them would be the mistake that field exists to prevent: pinning an
      // issuer says whose certificate this node *believes about a peer it is already
      // talking to*, and this says who is let in at all. A seed that pinned issuers and
      // silently closed its door would strand every browser tab that had not yet enrolled
      // — and a relay that pins issuers must serve enrolment itself or name a reachable
      // provider, which is a deployment requirement stated in full at `RelayAdmission`.
      //
      // Pinning it is a later decision and is deliberately not taken here.
      relayAdmission: 'admits-any-peer',
      // BROW-01 — open, and on this node the reason is sharper than on the agent. A seed
      // is what every tab in the fabric reserves on, so it is the one peer a blocked
      // visitor is most likely to have reached; a seed that withheld its own row would
      // subtract the single most-connected data point from the metric that exists to show
      // where visitors are being blocked. Nothing about the machine travels with it: the
      // row is `other`, the coarsest label the range has.
      startReporting: 'reports-its-own-start',
      blockstoreDir: options.blockstoreDir,
      listen: [`/ip4/0.0.0.0/tcp/${wsPort}/ws`, '/ip4/0.0.0.0/tcp/0'],
      maxReservations: options.maxReservations ?? 64,
      // Straight through, never defaulted here — see `SeedServerOptions.trustAnchors`.
      trustAnchors: options.trustAnchors,
      // AUTH-02, straight through and **never merged with the line above**. The
      // conditional spread is required by `exactOptionalPropertyTypes`, which makes an
      // absent key and an explicit `undefined` different types — the same idiom
      // `bin/agent.ts` uses to thread its own `--trusted-issuer`, so a seed that was told
      // nothing pins nothing rather than pinning an empty set.
      ...(options.trustedIssuers === undefined ? {} : { trustedIssuers: options.trustedIssuers }),
    })
    undo.push(() => node.stop())

    const boundWsPort = readWsPort(node.multiaddrs)
    if (boundWsPort === null) throw new Error('seed node bound no WebSocket port')

    const seedPeerId = node.peerId

    const http = await createServer({
      root: ROOT,
      logLevel: 'error',
      // host: true binds every interface. Without it the phone cannot reach the page
      // at all, however good the discovery story is.
      server: {
        port: options.httpPort ?? 0,
        host: true,
        // Without this the `.local` URL this very class prints is rejected with
        // "Blocked request. This host is not allowed." IP literals are exempt by
        // default, which is exactly why an IP-only test would not notice.
        allowedHosts:
          options.allowedHosts === true ? true : [...(options.allowedHosts ?? ['.local'])],
      },
      plugins: [
        {
          name: 'o2-bootstrap',
          configureServer(server) {
            server.middlewares.use(
              '/bootstrap.json',
              (request: IncomingMessage, response: ServerResponse) => {
                // Derived from the Host header, so the client is told to dial the
                // same name it already reached us by.
                const host = request.headers.host ?? `127.0.0.1:${options.httpPort ?? 0}`
                const seedAddr = relayAddrForHost(host, boundWsPort, seedPeerId)
                const info: BootstrapInfo = {
                  relayAddrs: [seedAddr],
                  seedPeerId,
                  // Expressed through the same host the client reached us by, so a
                  // phone on `laptop.local` is never handed a `127.0.0.1` circuit.
                  peerAddrs: [
                    // This node first, dialled directly over WebSockets. A lone
                    // visitor has a peer from the moment they join, without waiting
                    // for a second device to appear — and it is the same address
                    // they reserved on, because it is the same node.
                    seedAddr,
                    // Then everyone holding a reservation, reached through the
                    // circuit that will carry their WebRTC handshake.
                    ...node.reservedPeerIds.map(
                      (peerId) => `${seedAddr}/p2p-circuit/webrtc/p2p/${peerId}`,
                    ),
                  ],
                }
                response.setHeader('content-type', 'application/json')
                // A joining phone must never be handed a stale relay address.
                response.setHeader('cache-control', 'no-store')
                response.end(JSON.stringify(info))
              },
            )
          },
        },
      ],
    })
    undo.push(() => http.close())
    await http.listen()

    const httpPort = http.config.server.port ?? 0
    const resolved = http.resolvedUrls?.local[0]
    const actualHttpPort = resolved === undefined ? httpPort : readUrlPort(resolved) ?? httpPort

    return new SeedServer({ node, http, httpPort: actualHttpPort, wsPort: boundWsPort })
  }

  get httpPort(): number {
    return this.#httpPort
  }

  /** The port a browser dials — for a reservation and for a peer, being one node. */
  get wsPort(): number {
    return this.#wsPort
  }

  /** The URL to hand a phone. Prefers the Bonjour name, which survives DHCP churn. */
  get joinUrl(): string {
    return `http://${localHostname()}:${this.#httpPort}${PAGE_PATH}`
  }

  /** Fallback URLs by raw IP, for networks where `.local` resolution is blocked. */
  get joinUrlsByIp(): readonly string[] {
    return lanAddresses().map((ip) => `http://${ip}:${this.#httpPort}${PAGE_PATH}`)
  }

  async stop(): Promise<void> {
    await this.#http.close()
    await this.node.stop()
  }
}

/**
 * The port of a **WebSocket** listener specifically.
 *
 * Not "the first `/tcp/<n>`". This node listens on both transports, and the first
 * match is the plain TCP one — an address no browser can dial, handed out as though
 * it could be. That bug shipped once already.
 */
function readWsPort(multiaddrs: readonly string[]): number | null {
  for (const address of multiaddrs) {
    const match = /\/tcp\/(\d+)\/ws/.exec(address)
    if (match?.[1] !== undefined) return Number(match[1])
  }
  return null
}

/**
 * The port a join URL names, or `null` when it names none this function can read.
 *
 * **`null` means two things and the caller cannot tell them apart, which is on purpose
 * here and would not be elsewhere.** A well-formed URL with no explicit port (`https://
 * host/`, port defaulted by scheme) and a string that is not a URL at all both answer
 * `null`. The caller wants "is there a port to reuse", and for that question the two
 * are the same answer; nothing downstream branches on which it was.
 *
 * Recorded rather than left silent because its sibling `readWsPort` above carries a
 * comment about a bug that shipped once, and a reader arriving from that comment is
 * entitled to know whether this one hides the same class of mistake. It does not — but
 * that is a claim worth writing down rather than leaving to be re-derived.
 */
function readUrlPort(url: string): number | null {
  try {
    const port = new URL(url).port
    return port === '' ? null : Number(port)
  } catch {
    // Not a URL. Indistinguishable from "no port" to every caller, by design above.
    return null
  }
}
