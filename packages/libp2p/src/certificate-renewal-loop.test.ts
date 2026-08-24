import { ed25519 } from '@noble/curves/ed25519.js'
import {
  CertificateHolder,
  EnrollmentAuthority,
  MemoryBlockstore,
  MemoryNetwork,
  SelfRecordIndex,
  WasmExecutor,
  publishCapabilities,
  requestEnrollment,
  toHex,
  verifyCertificate,
} from '@o2/core'
import type { NodeCertificate, NodeRecords, PublicKeyHex } from '@o2/core'
import { RpcEndpoint, enrolOverRpc, serveAgent } from '@o2/net'
import { describe, expect, it } from 'vitest'
import { startCertificateRenewal } from './certificate-renewal.ts'

/**
 * AUTH-04 — **a node renews, and what it renewed becomes what peers are served.**
 *
 * Plain `.test.ts`: node plus all three browser engines, because a tab is the node most
 * likely to still be running when its certificate lapses — it has no operator watching it
 * and no restart to fall back on.
 *
 * ## Why the exchange here is real and only the transport is not
 *
 * The certificate is minted by a real {@link EnrollmentAuthority} answering a real
 * `serveAgent` over a real `enrolOverRpc` two-leg exchange, nonce and all. What is
 * substituted is `MemoryNetwork` for libp2p, and the loop cannot tell: it calls a `renew`
 * thunk and never sees a transport. A short **certificate lifetime** is what makes this
 * runnable in a second, and it is set on the authority — where it is an ordinary option —
 * rather than through a node factory, which `fabric-node.ts` deliberately does not expose.
 *
 * ## The reading that matters
 *
 * Not merely that the loop obtained a second certificate. That would be satisfied by a
 * node holding a fresh certificate nobody can see. The case below reads the **record index
 * a peer's `records` request is answered from**, and requires that it has moved — because
 * the defect this closes was three snapshots, and a renewal that updates the node's own
 * field while the index keeps serving the expired one is precisely the failure.
 */

const LIFETIME_MS = 3_000
const PROVIDER_ID = 'provider'
const JOINER_ID = 'joiner'

const providerSeed = new Uint8Array(32).fill(0x51)
const nodeSeed = new Uint8Array(32).fill(0x52)
const userSeed = new Uint8Array(32).fill(0x53)
const nodeKey: PublicKeyHex = toHex(ed25519.getPublicKey(nodeSeed))

function fabric(): { rpc: RpcEndpoint; authority: EnrollmentAuthority } {
  const network = new MemoryNetwork()
  const authority = new EnrollmentAuthority({
    providerPrivateKey: providerSeed,
    // Generous, because renewal asks again under the **same user key** and a per-user
    // limiter sized for one enrolment would refuse the very thing under test — which
    // would look exactly like the loop not working.
    maxPerWindow: 1_000,
    maxIssuedPerWindow: 'issues-without-an-aggregate-budget',
    issuance: 'remembers-only-within-this-process',
    certificateLifetimeMs: LIFETIME_MS,
  })
  const store = new MemoryBlockstore()
  const providerRpc = new RpcEndpoint(network.connect(PROVIDER_ID), { timeoutMs: 4_000 })
  serveAgent({
    paused: 'never-pauses',
    rpc: providerRpc,
    executor: new WasmExecutor({ nodeId: PROVIDER_ID, blockstore: store }),
    blockstore: store,
    egress: 'holds-no-registrations',
    authorize: 'serves-unauthenticated',
    index: 'serves-no-records',
    enroll: authority,
    capacity: 'accepts-every-offer',
    ledger: 'keeps-no-ledger',
    reservations: 'relays-for-nobody',
    onDispatch: 'reports-no-dispatch',
    attest: 'signs-nothing',
  })
  return { rpc: new RpcEndpoint(network.connect(JOINER_ID), { timeoutMs: 4_000 }), authority }
}

async function enrol(rpc: RpcEndpoint): Promise<NodeCertificate> {
  const outcome = await enrolOverRpc(
    rpc,
    PROVIDER_ID,
    await requestEnrollment(nodeSeed, userSeed, {
      operatorId: 'ops',
      discoverability: 'seed',
      relayIds: [],
    }),
  )
  if (!outcome.ok) throw new Error(`enrolment failed: ${outcome.reason}`)
  return outcome.certificate
}

/** The production shape: one function, three readers, no second construction. */
function recordsFrom(certificate: NodeCertificate | null): NodeRecords | 'holds-no-records' {
  if (certificate === null) return 'holds-no-records'
  return {
    certificate,
    capabilities: publishCapabilities(nodeSeed, {
      features: [],
      sovereignFor: [],
      issuedAt: certificate.issuedAt,
      expiresAt: certificate.expiresAt,
      extensions: [],
    }),
  }
}

async function within(deadlineMs: number, predicate: () => boolean, what: string): Promise<void> {
  const until = Date.now() + deadlineMs
  while (Date.now() < until) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`timed out waiting for ${what}`)
}

describe('AUTH-04 — the renewal loop, against a real authority', () => {
  it(
    'obtains a second certificate and the index a peer reads has moved to it',
    async () => {
      const { rpc, authority } = fabric()
      const first = await enrol(rpc)
      const holder = new CertificateHolder(first)

      // Built exactly as both tiers build it: a thunk over the holder, never a value.
      const index = new SelfRecordIndex({
        nodeKey,
        store: new MemoryBlockstore(),
        records: () => recordsFrom(holder.current),
        withhold: 'advertises-everything-it-holds',
      })
      const republished: string[] = []

      const stop = startCertificateRenewal({
        holder,
        renew: async () => enrol(rpc),
        renewed: (certificate) => {
          republished.push(`${certificate.issuedAt}`)
        },
        retryFloorMs: 100,
      })

      try {
        // A three-second certificate is due at two seconds. Four is that plus the
        // exchange, with margin — and the wait is on the observable rather than on a
        // sleep, so a fast machine finishes early instead of idling.
        await within(
          8_000,
          () => holder.current !== null && holder.current.issuedAt > first.issuedAt,
          'the loop to obtain a second certificate',
        )

        const renewed = holder.current
        expect(renewed, 'the holder emptied itself').not.toBeNull()
        if (renewed === null) throw new Error('unreachable')

        // The window moved forward. Not merely "a certificate exists".
        expect(renewed.expiresAt).toBeGreaterThan(first.expiresAt)
        // And it is genuinely issued by the same authority, not a copy with fields moved:
        // a renewal that did not verify would be worse than no renewal, because a node
        // holding it would stop trying while every peer discarded it.
        expect(
          verifyCertificate(renewed, new Set([authority.issuerKey]), Date.now()).ok,
          'the renewed certificate does not verify against the issuer that signed the first',
        ).toBe(true)

        // **The reading this file exists for.** Peers are answered from the index, not
        // from the node's own field, and the index held a snapshot until AUTH-04.
        const served = await index.recordsFor(nodeKey)
        expect(served?.certificate.issuedAt).toBe(renewed.issuedAt)
        // The capability record beside it moved too — it signs the window it was given,
        // so one still signed over the old window would expire under a valid certificate.
        expect(served?.capabilities.expiresAt).toBe(renewed.expiresAt)

        // And the caller was told, once per accepted renewal, which is what drives the
        // DHT republish in production.
        expect(republished.length).toBeGreaterThanOrEqual(1)
      } finally {
        stop()
      }
    },
    30_000,
  )

  it('stops asking once it is stopped', async () => {
    const { rpc } = fabric()
    const holder = new CertificateHolder(await enrol(rpc))

    let asked = 0
    const stop = startCertificateRenewal({
      holder,
      renew: async () => {
        asked += 1
        return enrol(rpc)
      },
      renewed: () => {},
      retryFloorMs: 50,
    })
    stop()

    // Past the two-second due point of a three-second certificate. A loop that kept its
    // timer would have asked by now, and on the node tier that is a process that will not
    // exit and a peer that keeps being dialled after `node.stop()` resolved.
    await new Promise((resolve) => setTimeout(resolve, 2_500))
    expect(asked).toBe(0)
  }, 30_000)
})
