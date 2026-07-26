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
import { RelayNode } from './relay-node.ts'

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const PAGE_PATH = '/packages/browser/demo/index.html'

/** What a joining browser is told, derived from how it reached us. */
export interface BootstrapInfo {
  /** Relay multiaddrs to dial, expressed in terms of the host the client used. */
  readonly relayAddrs: readonly string[]
  readonly relayPeerId: string
  /** The seed's own compute node, so a lone phone still has a peer to work with. */
  readonly seedPeerId: string
}

export interface SeedServerOptions {
  /** HTTP port for the page and `/bootstrap.json`. 0 picks a free one. */
  readonly httpPort?: number
  /** TCP port the relay listens on for WebSockets. 0 picks a free one. */
  readonly relayPort?: number
  readonly blockstoreDir: string
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

/** Build a browser-dialable relay multiaddr for the host the client actually used. */
export function relayAddrForHost(host: string, relayPort: number, relayPeerId: string): string {
  const bare = hostWithoutPort(host)
  // A literal IPv4 needs /ip4; anything else is a name and needs /dns4. Getting this
  // wrong produces a multiaddr that parses and never dials.
  const isIpv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(bare)
  const prefix = isIpv4 ? `/ip4/${bare}` : `/dns4/${bare}`
  return `${prefix}/tcp/${relayPort}/ws/p2p/${relayPeerId}`
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
  readonly relay: RelayNode
  readonly node: FabricNode
  readonly #http: ViteDevServer
  readonly #httpPort: number
  readonly #relayPort: number

  private constructor(parts: {
    relay: RelayNode
    node: FabricNode
    http: ViteDevServer
    httpPort: number
    relayPort: number
  }) {
    this.relay = parts.relay
    this.node = parts.node
    this.#http = parts.http
    this.#httpPort = parts.httpPort
    this.#relayPort = parts.relayPort
  }

  static async start(options: SeedServerOptions): Promise<SeedServer> {
    const relayPort = options.relayPort ?? 0

    // 0.0.0.0, not loopback: the point is to be reachable from another device.
    const relay = await RelayNode.start({
      listen: [`/ip4/0.0.0.0/tcp/${relayPort}/ws`],
      maxReservations: options.maxReservations ?? 64,
    })

    const boundRelayPort = readPort(relay.multiaddrs)
    if (boundRelayPort === null) throw new Error('relay bound no TCP port')

    // The seed contributes compute too, so a single phone still has a peer to run a
    // 2x-redundant job against.
    const node = await FabricNode.start({
      blockstoreDir: options.blockstoreDir,
      listen: ['/ip4/0.0.0.0/tcp/0'],
    })

    const relayPeerId = relay.peerId
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
                const info: BootstrapInfo = {
                  relayAddrs: [relayAddrForHost(host, boundRelayPort, relayPeerId)],
                  relayPeerId,
                  seedPeerId,
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
    await http.listen()

    const httpPort = http.config.server.port ?? 0
    const resolved = http.resolvedUrls?.local[0]
    const actualHttpPort = resolved === undefined ? httpPort : readUrlPort(resolved) ?? httpPort

    return new SeedServer({ relay, node, http, httpPort: actualHttpPort, relayPort: boundRelayPort })
  }

  get httpPort(): number {
    return this.#httpPort
  }

  get relayPort(): number {
    return this.#relayPort
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
    await this.relay.stop()
  }
}

/** First TCP port in a set of multiaddrs. */
function readPort(multiaddrs: readonly string[]): number | null {
  for (const address of multiaddrs) {
    const match = /\/tcp\/(\d+)/.exec(address)
    if (match?.[1] !== undefined) return Number(match[1])
  }
  return null
}

function readUrlPort(url: string): number | null {
  try {
    const port = new URL(url).port
    return port === '' ? null : Number(port)
  } catch {
    return null
  }
}
