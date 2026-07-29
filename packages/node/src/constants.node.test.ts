import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  LIBP2P_INBOUND_CONNECTION_THRESHOLD,
  LIBP2P_MAX_INCOMING_PENDING_CONNECTIONS,
  MAX_CONCURRENT_STREAMS_PER_PEER,
  RELAY_DATA_LIMIT_BYTES,
  RELAY_DURATION_LIMIT_MS,
  RELAY_MAX_RESERVATIONS,
  RELAY_MAX_RESERVATION_TTL_MS,
  WEBRTC_MAX_BUFFERED_BYTES,
  WEBRTC_MAX_MESSAGE_BYTES,
} from '@o2/libp2p'

/**
 * NET-07 — a dependency upgrade that moves a transport limit must fail here.
 *
 * The point is to read the values out of the *installed packages*, not to restate
 * them. Neither package re-exports its constants through its export map, so the
 * module file is resolved relative to the package's own entry point and imported
 * by file URL. That keeps the test independent of where npm chose to hoist the
 * package, and independent of whether a future release starts re-exporting them.
 */

const require = createRequire(import.meta.url)

/** Import a module file that a package's export map does not expose. */
async function importInternal(pkg: string, relative: string): Promise<Record<string, unknown>> {
  // Resolves the package's public entry — dist/src/index.js — whose directory is
  // also where its sibling internal modules live.
  const entry = require.resolve(pkg)
  const url = pathToFileURL(join(dirname(entry), relative)).href
  return (await import(url)) as Record<string, unknown>
}

/**
 * Read a package's own manifest.
 *
 * Modern ESM packages do not list `./package.json` in their export map, so
 * `require.resolve('pkg/package.json')` throws. Resolving the entry point and
 * walking up to the directory whose manifest actually names the package works
 * regardless of export map or hoisting depth.
 */
function packageManifest(from: NodeJS.Require, pkg: string): { version: string } {
  let dir = dirname(from.resolve(pkg))
  for (;;) {
    const candidate = join(dir, 'package.json')
    if (existsSync(candidate)) {
      const manifest = JSON.parse(readFileSync(candidate, 'utf8')) as {
        name?: string
        version: string
      }
      if (manifest.name === pkg) return manifest
    }
    const parent = dirname(dir)
    if (parent === dir) throw new Error(`no manifest found for ${pkg}`)
    dir = parent
  }
}

describe('NET-07 — circuit relay v2 limits', () => {
  it('matches the limits the architecture assumes', async () => {
    const c = await importInternal('@libp2p/circuit-relay-v2', 'constants.js')

    // 2 minutes. This is why a relay is a signalling channel and not a data path.
    expect(c['DEFAULT_DURATION_LIMIT']).toBe(RELAY_DURATION_LIMIT_MS)

    // 128 KiB, as a BigInt. Asserting the type too: a change to Number here would
    // silently alter comparison semantics at the call sites.
    expect(c['DEFAULT_DATA_LIMIT']).toBe(RELAY_DATA_LIMIT_BYTES)
    expect(typeof c['DEFAULT_DATA_LIMIT']).toBe('bigint')

    // 15 concurrent reservations — the backbone's browser-peer capacity unit.
    expect(c['DEFAULT_MAX_RESERVATION_STORE_SIZE']).toBe(RELAY_MAX_RESERVATIONS)

    // 2 hours.
    expect(c['DEFAULT_MAX_RESERVATION_TTL']).toBe(RELAY_MAX_RESERVATION_TTL_MS)
  })
})

describe('NET-07 — connection-manager limits that cap browser-peer capacity', () => {
  it('matches libp2p’s inbound defaults, both of which bind before reservations do', async () => {
    const c = await importInternal('libp2p', 'connection-manager/constants.defaults.js')

    // Simultaneous inbound handshakes. Ten browser tabs joining at once already sit
    // at the edge; the eleventh dies part-way through the noise handshake.
    expect(c['MAX_INCOMING_PENDING_CONNECTIONS']).toBe(LIBP2P_MAX_INCOMING_PENDING_CONNECTIONS)

    // Inbound connections per second from ONE HOST. The limit that actually stops a
    // burst of browser peers, and it binds whenever peers share an IP — every tab in
    // a local test, and every volunteer behind one NAT in production.
    expect(c['INBOUND_CONNECTION_THRESHOLD']).toBe(LIBP2P_INBOUND_CONNECTION_THRESHOLD)

    // Both are below the reservation limit, which is the whole point: tuning
    // reservations alone leaves the extra capacity unreachable.
    expect(LIBP2P_MAX_INCOMING_PENDING_CONNECTIONS).toBeLessThan(RELAY_MAX_RESERVATIONS)
    expect(LIBP2P_INBOUND_CONNECTION_THRESHOLD).toBeLessThan(RELAY_MAX_RESERVATIONS)
  })
})

describe('NET-07 — WebRTC message limits', () => {
  it('matches the ceiling on the browser data path', async () => {
    const c = await importInternal('@libp2p/webrtc', 'constants.js')

    // 16 KiB, hardcoded rather than negotiated. Chromium closes the channel above
    // it and will not reassemble Firefox's fragments.
    expect(c['MAX_MESSAGE_SIZE']).toBe(WEBRTC_MAX_MESSAGE_BYTES)
    expect(c['MAX_BUFFERED_AMOUNT']).toBe(WEBRTC_MAX_BUFFERED_BYTES)
  })

  it('leaves protobuf overhead inside the message budget', async () => {
    const c = await importInternal('@libp2p/webrtc', 'constants.js')
    const overhead = c['PROTOBUF_OVERHEAD']
    // A payload budget is only meaningful if the framing overhead is smaller than
    // the frame. If a release ever inverts this, chunking silently produces
    // zero-or-negative-length payloads.
    expect(typeof overhead).toBe('number')
    expect(overhead as number).toBeGreaterThan(0)
    expect(overhead as number).toBeLessThan(WEBRTC_MAX_MESSAGE_BYTES)
  })
})

describe('NET-09 — the muxer default MAX_CONCURRENT_STREAMS_PER_PEER sits below', () => {
  it('detects drift in yamux’s declared — but unread — maxEarlyStreams', async () => {
    // Imported through the package's own `./config` export rather than through
    // `importInternal`: `@chainsafe/libp2p-yamux` publishes no CJS entry, so
    // `require.resolve` on it throws `No "exports" main defined` and the helper
    // this file uses elsewhere cannot reach it. The export map exposes the module
    // directly, which is a better read anyway — no path assumption.
    const { defaultConfig } = await import('@chainsafe/libp2p-yamux/config')

    // **This is a drift detector on the library's declared intent. It is NOT the
    // operative value.** `YamuxMuxer`'s constructor
    // (`@chainsafe/libp2p-yamux/dist/src/muxer.js:64-75`) spreads `init` into
    // `AbstractStreamMuxer` and reads `enableKeepAlive`, `keepAliveInterval`,
    // `maxInboundStreams` and `maxOutboundStreams` off `defaultConfig` — and not
    // this field, which is therefore declared and never read.
    //
    // The value that actually decides is `AbstractStreamMuxer`'s hardcoded
    // `init.maxEarlyStreams ?? 10`
    // (`@libp2p/utils/dist/src/abstract-stream-muxer.js:24`), which is not exported
    // and has no importable form. Its only runtime read in this repository is the
    // denominator of the `MaxEarlyStreamsError` that
    // `packages/node/src/transport-bounds.node.test.ts` reproduces, asserted inside
    // that reproduction. Separate vitest files share no runtime state, so it could
    // not be pinned from here without falling back to a `.d.ts` comment — which
    // would read as though a runtime value had been checked.
    expect(defaultConfig.maxEarlyStreams).toBe(10)
    expect(MAX_CONCURRENT_STREAMS_PER_PEER).toBeLessThan(10)
  })
})

describe('NET-07 — dependency pinning', () => {
  const manifest = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  ) as { dependencies?: Record<string, string> }

  it('pins every third-party dependency to an exact version', () => {
    const deps = manifest.dependencies ?? {}
    const ranged = Object.entries(deps)
      // Workspace siblings are intentionally `*` — they are not third-party.
      .filter(([name]) => !name.startsWith('@o2/'))
      .filter(([, range]) => !/^\d+\.\d+\.\d+$/.test(range))

    expect(ranged).toEqual([])
  })

  it('depends on libp2p v3, whose stream API is not v2-compatible', () => {
    // v3 streams are EventTargets (`.send()` / `message`), not streaming-iterables
    // (`.source` / `.sink`). A v2 module resolving here fails at runtime with
    // confusing symbol errors rather than at install time.
    expect(packageManifest(require, '@libp2p/interface').version.startsWith('3.')).toBe(true)
  })

  it('resolves exactly one copy of multiformats and uint8arrays', () => {
    // A v13/v14 multiformats boundary makes `CID instanceof` fail across package
    // boundaries, and libp2p v3 needs uint8arrays v6. Both are held by `overrides`
    // in the root manifest; this test is what keeps the override honest.
    for (const pkg of ['multiformats', 'uint8arrays']) {
      const versions = new Set<string>()
      // Resolve from several distinct points in the tree, so a nested duplicate
      // under any of them is caught rather than hidden by hoisting.
      for (const from of ['@o2/net', '@o2/core', 'libp2p', '@libp2p/interface']) {
        const nested = createRequire(pathToFileURL(require.resolve(from)).href)
        versions.add(packageManifest(nested, pkg).version)
      }
      expect([...versions]).toHaveLength(1)
    }
  })
})
