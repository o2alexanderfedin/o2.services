import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ed25519 } from '@noble/curves/ed25519.js'
import { EnrollmentAuthority, requestEnrollment, toHex } from '@o2/core'
import type { NodeCertificate, PublicKeyHex } from '@o2/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DatastoreCertificateCache } from './certificate-cache.ts'
import { FsDatastore } from './fs-datastore.ts'

/**
 * W4 — **a peer verified before this process started is not asked again**, and the cache
 * cannot widen what this node accepts.
 *
 * The second half is the one worth testing. A cache of security-relevant material is
 * normally a hole; here it is not, and the reason is a property rather than care:
 * revocation in this fabric is *non-renewal on the certificate's own clock, not a list*,
 * so `verifyCertificate` reaches nothing and a remembered copy can never be **more**
 * acceptable than a fresh one. `PeerVerifier` runs a cached certificate through the same
 * `#accept` the wire path runs, against the issuers pinned now and the clock now.
 *
 * These cases pin the store's own behaviour. That it is only ever consulted as a hint is
 * structural — there is one `#accept` and both paths call it — and the plant recorded in
 * the commit is what proves the single copy.
 *
 * Node-only: it writes to a real directory.
 */

const NOW = 1_800_000_000_000

let workdir: string

beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'o2-certcache-'))
})
afterEach(async () => {
  await rm(workdir, { recursive: true, force: true })
})

async function certificate(seed: number): Promise<NodeCertificate> {
  const authority = new EnrollmentAuthority({
    providerPrivateKey: new Uint8Array(32).fill(0x90),
    maxPerWindow: 100,
    maxIssuedPerWindow: 'issues-without-an-aggregate-budget',
    issuance: 'remembers-only-within-this-process',
  })
  const outcome = authority.enrol(
    await requestEnrollment(new Uint8Array(32).fill(seed), new Uint8Array(32).fill(0x91), {
      operatorId: 'ops',
      discoverability: 'seed',
      relayIds: [],
    }),
    NOW,
  )
  if (!outcome.ok) throw new Error(`fixture enrolment failed: ${outcome.reason}`)
  return outcome.certificate
}

function cacheIn(dir: string): DatastoreCertificateCache {
  return new DatastoreCertificateCache(new FsDatastore(join(workdir, dir)))
}

describe('W4 — certificates survive the process that learned them', () => {
  it('reads back a saved certificate field for field', async () => {
    const cert = await certificate(0x92)
    await cacheIn('a').save(cert)

    // A second instance over the same directory is a restart.
    const found = await cacheIn('a').load(cert.nodeKey)

    expect(found).toEqual(cert)
  })

  it('answers undefined for a node it has never seen', async () => {
    const unknown = toHex(ed25519.getPublicKey(new Uint8Array(32).fill(0x93)))
    expect(await cacheIn('b').load(unknown as PublicKeyHex)).toBeUndefined()
  })

  it('answers undefined rather than throwing when the stored bytes are not a certificate', async () => {
    // A truncated write, a hand edit, or an older build with a different field set. The
    // caller's only correct response to all three is to ask the peer, so none of them may
    // arrive as an exception — a cache that can throw is a cache that can stop a node
    // verifying its peers.
    const cert = await certificate(0x94)
    const store = new FsDatastore(join(workdir, 'c'))
    await store.put(DatastoreCertificateCache.keyFor(cert.nodeKey), new TextEncoder().encode('{'))

    expect(await new DatastoreCertificateCache(store).load(cert.nodeKey)).toBeUndefined()
  })

  it('answers undefined for JSON that parses but is not a certificate', async () => {
    // **The wire's parser, not a lenient local one.** This is the case that would pass if
    // the cache trusted its own storage: a well-formed JSON object with the wrong fields.
    const cert = await certificate(0x95)
    const store = new FsDatastore(join(workdir, 'd'))
    await store.put(
      DatastoreCertificateCache.keyFor(cert.nodeKey),
      new TextEncoder().encode(JSON.stringify({ nodeKey: cert.nodeKey, hello: 'world' })),
    )

    expect(await new DatastoreCertificateCache(store).load(cert.nodeKey)).toBeUndefined()
  })

  it('keys by node key, so one peer’s entry is not another’s', async () => {
    const first = await certificate(0x96)
    const second = await certificate(0x97)
    const cache = cacheIn('e')
    await cache.save(first)
    await cache.save(second)

    expect((await cache.load(first.nodeKey))?.nodeKey).toBe(first.nodeKey)
    expect((await cache.load(second.nodeKey))?.nodeKey).toBe(second.nodeKey)
    expect(first.nodeKey).not.toBe(second.nodeKey)
  })

  it('namespaces its rows away from libp2p’s own', async () => {
    // The same store holds libp2p's `/peers/…` rows. A collision would corrupt one of the
    // two silently, and which one would depend on write order.
    const cert = await certificate(0x98)
    expect(DatastoreCertificateCache.keyFor(cert.nodeKey).toString()).toMatch(/^\/o2\/certificates\//)
  })
})
