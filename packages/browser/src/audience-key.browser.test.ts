import { noise } from '@chainsafe/libp2p-noise'
import { yamux } from '@chainsafe/libp2p-yamux'
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2'
import { identify, identifyPush } from '@libp2p/identify'
import { webRTC } from '@libp2p/webrtc'
import { webSockets } from '@libp2p/websockets'
import { audienceKeyOf } from '@o2/libp2p'
import { createLibp2p } from 'libp2p'
import { describe, expect, it } from 'vitest'

/**
 * 15-CONTEXT.md decision 1's one labelled assumption, held to the tier it was
 * assumed for.
 *
 * The decision measured `peerId.type === 'Ed25519'` against a real Node-tier
 * `createLibp2p` and then *assumed* the browser tier takes the same default, on the
 * grounds that it is the same function with no `privateKey` option. That is a good
 * reason to expect it and not a measurement of it, so it is measured here, in a real
 * browser engine, rather than inherited.
 *
 * There is **no production deletion behind this file.** It measures a property of
 * `createLibp2p`'s own default, not of anything in this repository — so nothing in
 * `packages/` can be deleted to turn it red, and claiming otherwise would be inventing
 * a mutation that does not exist.
 */
describe('the browser tier default identity is Ed25519 — decision 1, measured', () => {
  it('yields a peer id whose audience key both derivations agree on', async () => {
    const libp2p = await createLibp2p({
      // Empty rather than `['/p2p-circuit', '/webrtc']`, which is what
      // `browser-node.ts:376-386` uses. The default key type is a property of
      // `createLibp2p`'s own `privateKey` default and has nothing to do with the
      // listen set; an empty one removes any need for a live relay in a unit test.
      addresses: { listen: [] },
      // Otherwise the browser tier's own module set, unmodified.
      transports: [webSockets(), webRTC(), circuitRelayTransport()],
      connectionEncrypters: [noise()],
      streamMuxers: [yamux()],
      services: { identify: identify(), identifyPush: identifyPush() },
    })

    try {
      expect(libp2p.peerId.type).toBe('Ed25519')

      const fromObject = audienceKeyOf(libp2p.peerId)
      expect(fromObject).toHaveLength(64)
      expect(fromObject).toMatch(/^[0-9a-f]{64}$/)

      // The property the whole design rests on: the serving node reads its own
      // `PeerId`, the requestor reads the string it was handed, and the two agree.
      expect(audienceKeyOf(libp2p.peerId.toString())).toBe(fromObject)
    } finally {
      await libp2p.stop()
    }
  })
})
