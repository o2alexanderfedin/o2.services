import { readdirSync } from 'node:fs'
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { verifyCertificate } from '@o2/core'
import type { NodeCertificate } from '@o2/core'
import { SEED_BYTES, identityFromSeed } from '@o2/libp2p'
import { UNREACHABLE_PROVIDER } from '@o2/net'
import { FabricNode } from './fabric-node.ts'
import type { FabricNodeOptions } from './fabric-node.ts'
import { FsBlockstore } from './fs-blockstore.ts'
import { CERTIFICATE_FILE, loadCertificate } from './identity-store.ts'

/**
 * AUTH-01 / AUTH-04 — the enrollment round trip on the startup path.
 *
 * Two real `FabricNode`s over real libp2p on 127.0.0.1 in one process: a provider holding
 * a signing key, and an applicant given its address. Same-process is not the same as
 * same-object — every request below crosses noise, yamux and the `/o2/rpc/1.0.0` protocol.
 *
 * **`rpcTimeoutMs: 10_000` is set for this file rather than inherited.** Enrollment adds a
 * dial plus a request/response to `start()`, and the production default is
 * `DEFAULT_RPC_TIMEOUT_MS` (`rpc.ts` — the value is written down once in this phase, in
 * `enrol-client.ts`'s comment, and is cited here rather than copied so the two cannot
 * disagree). Nothing in this file measures wall-clock and nothing here should be read as
 * if it did.
 *
 * **Nothing below branches on a kind of node.** The provider is a `FabricNode` with one
 * boolean set; it executes tasks, holds blocks and relays on exactly the same terms as the
 * applicant.
 */

/** Fixed patterns, not random — a failing run must be reproducible. */
const USER_SEED = new Uint8Array(SEED_BYTES).fill(0xb1)
const OTHER_USER_SEED = new Uint8Array(SEED_BYTES).fill(0xb2)

let workdir: string
const nodes: FabricNode[] = []

beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'o2-enrolment-'))
})

/**
 * Inner: `FabricNode.stop()` terminates a worker thread and stops libp2p. Outer 20 s
 * against Vitest's default 10 s `hookTimeout`, for the reason
 * `egress-refusal.node.test.ts` records: a test arms two clocks and the framework's must
 * be the larger, or a wedged shutdown is reported as an anonymous hook timeout naming no
 * step.
 */
afterEach(async () => {
  await Promise.all(nodes.splice(0).map((n) => n.stop().catch(() => {})))
  await rm(workdir, { recursive: true, force: true })
}, 20_000)

const start = async (options: Partial<FabricNodeOptions> = {}): Promise<FabricNode> => {
  const node = await FabricNode.start({
    relayAdmission: 'admits-any-peer',
    startReporting: 'reports-its-own-start',
    listen: ['/ip4/127.0.0.1/tcp/0'],
    trustAnchors: 'runs-unsigned-artifacts',
    rpcTimeoutMs: 10_000,
    ...options,
  })
  nodes.push(node)
  return node
}

/** Stop one node out of turn, so a restart can rebind its port. */
const stop = async (node: FabricNode): Promise<void> => {
  const at = nodes.indexOf(node)
  if (at >= 0) nodes.splice(at, 1)
  await node.stop()
}

/** A provider: one boolean different from every other node in this file. */
const startProvider = async (name = 'provider'): Promise<FabricNode> =>
  start({ blockstoreDir: join(workdir, name), issuesCertificates: 'issues-without-an-aggregate-budget' })

/** The TCP multiaddr a peer dials this node at, peer id included. */
const addrOf = (node: FabricNode): string => {
  const addr = node.multiaddrs.find((ma) => ma.includes('/tcp/') && !ma.includes('/p2p-circuit'))
  if (addr === undefined) throw new Error(`no dialable address on ${node.peerId}`)
  return addr
}

/** Bind an ephemeral port and release it, so the number is real and nothing holds it. */
const freePort = async (): Promise<number> =>
  new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') {
        server.close()
        reject(new Error('no port'))
        return
      }
      const { port } = address
      server.close(() => resolve(port))
    })
  })

describe('AUTH-01 — a node obtains its certificate before start() returns', () => {
  /**
   * Reddened by deleting the `await enrolOverRpc(...)` call and returning `null` from
   * `resolveCertificate`.
   */
  it('holds a provider-signed certificate naming its own key, which verifies against the provider', async () => {
    const provider = await startProvider()
    const applicant = await start({
      blockstoreDir: join(workdir, 'applicant'),
      enrollment: {
        userPrivateKey: USER_SEED,
        operatorId: 'harbour-ops',
        providerAddr: addrOf(provider),
      },
    })

    const certificate = applicant.certificate
    expect(certificate).not.toBeNull()
    expect(certificate?.nodeKey).toBe(applicant.nodeKey)
    expect(certificate?.issuer).toBe(provider.issuerKey)
    expect(certificate?.operatorId).toBe('harbour-ops')
    expect(certificate?.expiresAt).toBeGreaterThan(Date.now())

    // The user key is DERIVED from the private key inside `requestEnrollment`, never
    // named as a field — so a node cannot be configured to claim somebody else's.
    const user = await identityFromSeed(USER_SEED)
    expect(certificate?.userKey).toBe(user.nodeKey)

    const verdict = verifyCertificate(
      certificate as NodeCertificate,
      new Set([provider.issuerKey as string]),
      Date.now(),
    )
    expect(verdict.ok).toBe(true)

    // And the issuer is not the applicant: a provider-signed certificate is never a
    // self-signed one.
    expect(certificate?.issuer).not.toBe(applicant.nodeKey)
  }, 30_000)

  /**
   * Decision 10 — the fields that could be lied about are derived from what this node can
   * actually do, not configured. A signed statement is the worst possible place for a
   * field with two answers.
   *
   * Reddened by replacing `canRelay ? 'seed' : 'via-relay'` with the literal `'seed'`.
   */
  it('derives discoverability seed with no relayIds for a node that bound its own address', async () => {
    const provider = await startProvider()
    const applicant = await start({
      blockstoreDir: join(workdir, 'direct'),
      enrollment: {
        userPrivateKey: USER_SEED,
        operatorId: 'harbour-ops',
        providerAddr: addrOf(provider),
      },
    })

    expect(applicant.certificate?.discoverability).toBe('seed')
    expect(applicant.certificate?.relayIds).toStrictEqual([])
  }, 30_000)

  /**
   * The relayed reading of the same derivation, plus the point of taking the peer id from
   * the connection: a peer id read off a `Connection` is the peer actually **reached**,
   * while one parsed out of a configured address string is a claim about who was *meant*
   * to be reached. (`multiaddr@13` removed `getPeerId()` anyway.)
   *
   * Reddened by deleting `relayPeerIds.push(connection.remotePeer.toString())` from the
   * relay dial loop.
   */
  it('derives via-relay and names the relay it actually reached', async () => {
    const provider = await startProvider()
    const applicant = await start({
      blockstoreDir: join(workdir, 'relayed'),
      // No `listen`, so this node binds nothing and is reachable only through the relay.
      listen: [],
      relayAddrs: [addrOf(provider)],
      enrollment: {
        userPrivateKey: USER_SEED,
        operatorId: 'harbour-ops',
        providerAddr: addrOf(provider),
      },
    })

    expect(applicant.certificate?.discoverability).toBe('via-relay')
    expect(applicant.certificate?.relayIds).toStrictEqual([provider.peerId])
  }, 30_000)

  it('persists the certificate under a dot-prefixed name that FsBlockstore does not count', async () => {
    const dir = join(workdir, 'persisted')
    const provider = await startProvider()
    const applicant = await start({
      blockstoreDir: dir,
      enrollment: {
        userPrivateKey: USER_SEED,
        operatorId: 'harbour-ops',
        providerAddr: addrOf(provider),
      },
    })

    expect(await loadCertificate(dir)).toStrictEqual(applicant.certificate)

    const n = 2
    for (let i = 0; i < n; i++) await applicant.store.put(new Uint8Array([9, i]))
    await stop(applicant)

    // Three non-block files now sit beside the blocks. Named as well as counted, so a
    // count that matches because a file is missing cannot read the same as one that
    // matches because the filter works.
    expect(readdirSync(dir)).toContain(CERTIFICATE_FILE)
    expect((await FsBlockstore.open(dir)).size).toBe(n)
  }, 30_000)
})

describe('AUTH-01 — a node told to enrol that cannot enrol does not start', () => {
  /**
   * Decision 9's middle row. A node told to enrol, unable to, and running anyway is a node
   * whose identity claim is silently absent — the exact shape `.planning/PROJECT.md` calls
   * a hole.
   *
   * Reddened by deleting the `throw` in `resolveCertificate`'s final step and returning
   * `null` instead.
   */
  it('rejects with the provider’s own words when the peer issues no certificates, and leaves no socket bound', async () => {
    // A perfectly healthy node that simply was not told to issue.
    const notAProvider = await start({ blockstoreDir: join(workdir, 'not-a-provider') })
    const port = await freePort()

    await expect(
      FabricNode.start({
        relayAdmission: 'admits-any-peer',
        startReporting: 'reports-its-own-start',
        blockstoreDir: join(workdir, 'refused'),
        listen: [`/ip4/127.0.0.1/tcp/${port}`],
        trustAnchors: 'runs-unsigned-artifacts',
        rpcTimeoutMs: 10_000,
        enrollment: {
          userPrivateKey: USER_SEED,
          operatorId: 'harbour-ops',
          providerAddr: addrOf(notAProvider),
        },
      }),
    ).rejects.toThrow(/issues no certificates/)

    // The socket the failed start bound must be gone. A second node taking the SAME
    // explicit port is the only reading of that which cannot be explained away.
    const successor = await start({
      blockstoreDir: join(workdir, 'successor'),
      listen: [`/ip4/127.0.0.1/tcp/${port}`],
    })
    expect(successor.multiaddrs.some((ma) => ma.includes(`/tcp/${port}`))).toBe(true)
  }, 30_000)

  /**
   * The case an operator actually hits: a provider address with nothing listening on it.
   *
   * It fails inside `libp2p.dial`, one step **before** `enrolOverRpc` is entered, so
   * without the `try/catch` in `resolveCertificate` the raw libp2p dial error escapes and
   * `EnrolOutcome`'s three-arm design has two arms in production. The mapping is the thing
   * under test, so this asserts on **our** string — `UNREACHABLE_PROVIDER`, the constant
   * `@o2/net` exports for exactly this — and on the provider address being named.
   * Asserting only on libp2p's own error text would pass whether or not the mapping
   * exists.
   *
   * Reddened by deleting that `try/catch`.
   */
  it('rejects naming the address and our own unreachable wording when nothing answers', async () => {
    const port = await freePort()
    const nowhere = `/ip4/127.0.0.1/tcp/${port}`

    const failure = await FabricNode.start({
      relayAdmission: 'admits-any-peer',
      startReporting: 'reports-its-own-start',
      blockstoreDir: join(workdir, 'unreachable'),
      listen: ['/ip4/127.0.0.1/tcp/0'],
      trustAnchors: 'runs-unsigned-artifacts',
      rpcTimeoutMs: 10_000,
      enrollment: {
        userPrivateKey: USER_SEED,
        operatorId: 'harbour-ops',
        providerAddr: nowhere,
      },
    }).then(
      (node) => {
        nodes.push(node)
        return null
      },
      (cause: unknown) => cause,
    )

    expect(failure).toBeInstanceOf(Error)
    const message = (failure as Error).message
    expect(message).toContain(UNREACHABLE_PROVIDER)
    expect(message).toContain(nowhere)
  }, 30_000)
})

describe('AUTH-01 — a persisted, unexpired certificate is reused on restart', () => {
  /**
   * Decision 11, measured the decisive way rather than the convenient one.
   *
   * The plan offers `EnrollmentAuthority.issuedWithin(userKey, now) === 1`, read through a
   * test-visible route. **No such route exists and none was added**: `issuesCertificates`
   * is a boolean by design, `#authority` is private on purpose, and adding a public field
   * to expose the count would put certificate issuance one property access away from every
   * holder of a node.
   *
   * So this asserts something strictly stronger than `issuedAt` equality. The provider is
   * **stopped** before the restart. If the node re-enrolled it could not possibly succeed —
   * the dial would fail and `start()` would reject, which the test above proves it does.
   * A node that starts anyway, holding a byte-identical certificate, did not contact
   * anybody. That is decision 11's "and do not contact the provider" read directly rather
   * than inferred from a count.
   *
   * Reddened by deleting the `loadCertificate(dir)` reuse branch in `resolveCertificate`.
   */
  it('starts from the persisted certificate with the provider switched off', async () => {
    const dir = join(workdir, 'reused')
    const provider = await startProvider()
    const providerAddr = addrOf(provider)

    const first = await start({
      blockstoreDir: dir,
      enrollment: { userPrivateKey: USER_SEED, operatorId: 'harbour-ops', providerAddr },
    })
    const issued = first.certificate
    // `not.toBeNull()` alone would pass against `undefined`, which is what an unbuilt
    // field reads as — so the issuer is named instead, and there is no vacuous green here.
    expect(issued?.issuer).toBe(provider.issuerKey)
    await stop(first)

    // The provider is gone. Nothing could issue a second certificate now.
    await stop(provider)

    const restarted = await start({
      blockstoreDir: dir,
      enrollment: { userPrivateKey: USER_SEED, operatorId: 'harbour-ops', providerAddr },
    })
    expect(restarted.certificate).toStrictEqual(issued)
    expect(restarted.certificate?.issuedAt).toBe(issued?.issuedAt)
    // Same node, too — the identity is what makes the certificate still apply.
    expect(restarted.nodeKey).toBe(first.nodeKey)
  }, 40_000)

  /**
   * Reddened by deleting the `expiresAt > Date.now()` condition from the reuse branch.
   */
  it('replaces an expired certificate rather than presenting it', async () => {
    const dir = join(workdir, 'expired')
    const provider = await startProvider()
    const providerAddr = addrOf(provider)

    const first = await start({
      blockstoreDir: dir,
      enrollment: { userPrivateKey: USER_SEED, operatorId: 'harbour-ops', providerAddr },
    })
    await stop(first)

    // Age the persisted certificate past its own expiry, leaving every other field —
    // including `nodeKey` — correct, so expiry is the only reason to re-enrol.
    const stored = JSON.parse(await readFile(join(dir, CERTIFICATE_FILE), 'utf8')) as NodeCertificate
    const planted = { ...stored, issuedAt: Date.now() - 90_000, expiresAt: Date.now() - 60_000 }
    await writeFile(join(dir, CERTIFICATE_FILE), JSON.stringify(planted))

    const restarted = await start({
      blockstoreDir: dir,
      enrollment: { userPrivateKey: USER_SEED, operatorId: 'harbour-ops', providerAddr },
    })
    expect(restarted.certificate?.issuedAt).toBeGreaterThan(planted.issuedAt)
    expect(restarted.certificate?.expiresAt).toBeGreaterThan(Date.now())
    expect(restarted.certificate?.nodeKey).toBe(restarted.nodeKey)
  }, 40_000)

  /**
   * The real-world shape of the mistake: a directory cloned from another host. The
   * certificate is intact, unexpired and genuinely signed — it simply names somebody else.
   *
   * Reddened by deleting the `peerIdForNodeKey(loaded.nodeKey) === identity.peerId`
   * condition from the reuse branch.
   */
  it('does not present another node’s certificate as its own', async () => {
    const provider = await startProvider()
    const providerAddr = addrOf(provider)

    const donorDir = join(workdir, 'donor')
    const donor = await start({
      blockstoreDir: donorDir,
      enrollment: { userPrivateKey: USER_SEED, operatorId: 'harbour-ops', providerAddr },
    })
    const donorKey = donor.nodeKey
    await stop(donor)

    // A fresh directory, then somebody else's certificate copied into it.
    const dir = join(workdir, 'cloned')
    const seeded = await start({ blockstoreDir: dir })
    const ownKey = seeded.nodeKey
    await stop(seeded)
    expect(ownKey).not.toBe(donorKey)
    await copyFile(join(donorDir, CERTIFICATE_FILE), join(dir, CERTIFICATE_FILE))

    const node = await start({
      blockstoreDir: dir,
      enrollment: { userPrivateKey: OTHER_USER_SEED, operatorId: 'harbour-ops', providerAddr },
    })
    expect(node.certificate?.nodeKey).toBe(ownKey)
    expect(node.certificate?.nodeKey).not.toBe(donorKey)
  }, 40_000)
})

describe('AUTH-01 — a node not told to enrol behaves exactly as it did before this phase', () => {
  /**
   * Decision 9's first row, and the regression bar every existing spawn test relies on.
   *
   * **No deletion turns this red, and that is the point.** It is not a feature proof; it
   * asserts that a configuration nobody sets still behaves as it always did. Its value is
   * that a deletion *elsewhere* — making enrollment unconditional — reddens it.
   */
  it('starts with certificate null and still has a nodeKey and a peerId', async () => {
    const node = await start({ blockstoreDir: join(workdir, 'plain') })

    expect(node.certificate).toBeNull()
    expect(node.nodeKey).toMatch(/^[0-9a-f]{64}$/)
    expect(node.peerId.length).toBeGreaterThan(0)
    expect(node.issuerKey).toBeNull()
  }, 30_000)
})
