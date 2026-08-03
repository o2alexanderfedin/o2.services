import { ed25519 } from '@noble/curves/ed25519.js'
import {
  EnrollmentAuthority,
  MemoryBlockstore,
  MemoryNetwork,
  SelfRecordIndex,
  WasmExecutor,
  publicNodes,
  publishCapabilities,
  requestEnrollment,
  submitJob,
  toHex,
} from '@o2/core'
import type { NodeRecords, PublicKeyHex } from '@o2/core'
import type { CID } from 'multiformats/cid'
import { describe, expect, it } from 'vitest'
// Test-only relative import — see the note in distributed.test.ts.
import { MODULE_WRITES_PARTITION } from '../../core/src/executor/fixtures.ts'
import { RpcEndpoint, discoverCandidates, serveAgent } from './index.ts'

/**
 * SCHED-01's requestor half, end to end over `MemoryNetwork`.
 *
 * **Each serving node is given its own `SelfRecordIndex` over its own store** (Plan
 * 18-02's shape), never a single seed index with `provide` hand-called into it. A
 * fixture that publishes every provider into one index is testing a shape production
 * no longer has — that was the defect 18-CONTEXT.md found in the existing discovery
 * tests, and reproducing it here would make the union this module depends on invisible.
 *
 * The `peerIdFor` mapping is built from this fixture's own key-to-address table.
 * **Production passes `peerIdForNodeKey` from `@o2/libp2p`**; this package may not
 * import that one, which is exactly why the mapping is a parameter.
 */

const NOW = 1_800_000_000_000
const YEAR = 365 * 24 * 3_600_000
const INPUT = new Uint8Array([7, 7, 7, 7])

interface Node {
  readonly nodeKey: PublicKeyHex
  /** The id the transport knows. Deliberately NOT the node key — see below. */
  readonly peerId: string
  readonly rpc: RpcEndpoint
  readonly records: NodeRecords
}

interface Fabric {
  readonly requestorRpc: RpcEndpoint
  readonly nodes: readonly Node[]
  readonly inputCid: CID
  readonly trustedIssuers: ReadonlySet<PublicKeyHex>
  readonly peerIdFor: (nodeKey: PublicKeyHex) => string | null
  close(): void
}

/**
 * `count` serving nodes, each holding the block in its own store and answering
 * `providers` only for itself.
 *
 * A node's transport id here is `peer-<i>` and **not** its public key. That is a
 * deliberate departure from `discovery.test.ts`, whose fixture makes the two equal —
 * a property of that fixture and not of a real node. If they were equal here, a
 * module that returned node keys where peer ids belong would pass every assertion
 * below, and the confusion this module exists to remove would be invisible.
 */
async function fabricOf(options: {
  count: number
  /** Which nodes are cleared for their own user key. Defaults to all. */
  sovereignFor?: (i: number) => boolean
  /** Sign node `i`'s certificate with an issuer the requestor did not pin. */
  rogueIssuer?: (i: number) => boolean
}): Promise<Fabric> {
  const network = new MemoryNetwork()
  const authority = new EnrollmentAuthority({
    providerPrivateKey: new Uint8Array(32).fill(60),
    maxPerWindow: 100,
  })
  const rogue = new EnrollmentAuthority({
    providerPrivateKey: new Uint8Array(32).fill(99),
    maxPerWindow: 100,
  })
  const userPriv = new Uint8Array(32).fill(61)
  const userKey = toHex(ed25519.getPublicKey(userPriv))

  const nodes: Node[] = []
  let inputCid: CID | undefined
  for (let i = 0; i < options.count; i++) {
    const priv = new Uint8Array(32).fill(70 + i)
    const nodeKey = toHex(ed25519.getPublicKey(priv))
    const peerId = `peer-${i}`

    const issuer = options.rogueIssuer?.(i) === true ? rogue : authority
    const enrolled = issuer.enrol(
      requestEnrollment(priv, userPriv, {
        operatorId: `op-${i}`,
        discoverability: 'seed',
        relayIds: [],
      }),
      NOW,
    )
    if (!enrolled.ok) throw new Error(`fixture enrolment failed: ${enrolled.reason}`)

    const records: NodeRecords = {
      certificate: enrolled.certificate,
      capabilities: publishCapabilities(priv, {
        features: [],
        // Cleared for its OWN user key, which is what makes the descriptor's
        // `canExecuteSovereign` true for that user's work.
        sovereignFor: (options.sovereignFor?.(i) ?? true) ? [userKey] : [],
        issuedAt: NOW - 1000,
        expiresAt: NOW + YEAR,
      }),
    }

    const store = new MemoryBlockstore()
    const cid = await store.put(INPUT)
    await store.put(MODULE_WRITES_PARTITION)
    inputCid ??= cid

    const rpc = new RpcEndpoint(network.connect(peerId), { timeoutMs: 5_000 })
    serveAgent({
      rpc,
      executor: new WasmExecutor({ nodeId: peerId, blockstore: store }),
      blockstore: store,
      egress: 'holds-no-registrations',
      authorize: 'serves-unauthenticated',
      index: new SelfRecordIndex({
        nodeKey,
        store,
        records,
        withhold: 'advertises-everything-it-holds',
      }),
      enroll: 'issues-no-certificates',
      capacity: 'accepts-every-offer',
      ledger: 'keeps-no-ledger',
      reservations: 'relays-for-nobody',
      onDispatch: 'reports-no-dispatch',
    })
    nodes.push({ nodeKey, peerId, rpc, records })
  }

  if (inputCid === undefined) throw new Error('fixture built no nodes')
  const requestorRpc = new RpcEndpoint(network.connect('requestor'), { timeoutMs: 5_000 })
  const table = new Map(nodes.map((n) => [n.nodeKey, n.peerId]))
  return {
    requestorRpc,
    nodes,
    inputCid,
    trustedIssuers: new Set([authority.issuerKey]),
    peerIdFor: (nodeKey) => table.get(nodeKey) ?? null,
    close() {
      requestorRpc.close()
      for (const node of nodes) node.rpc.close()
    },
  }
}

describe('SCHED-01 — a data CID and a peer list become dispatchable candidates', () => {
  it('returns one executor per node holding the block, addressed by peer id', async () => {
    const fabric = await fabricOf({ count: 3 })
    try {
      const found = await discoverCandidates(
        { inputCid: fabric.inputCid },
        {
          rpc: fabric.requestorRpc,
          peers: () => fabric.nodes.map((n) => n.peerId),
          trustedIssuers: fabric.trustedIssuers,
          now: () => NOW,
          peerIdFor: fabric.peerIdFor,
          dispatch: 'dispatches-unauthenticated',
        },
      )

      const peerIds = fabric.nodes.map((n) => n.peerId).sort()
      // Three, not one. Without 18-02's union this collapses to the first answer.
      expect(found.executors.map((e) => e.nodeId).sort()).toStrictEqual(peerIds)
      expect(found.providers).toBe(3)
      expect(found.excluded).toStrictEqual([])
      expect(found.undialable).toStrictEqual([])
      // Addressed by the id the TRANSPORT knows. A node key would satisfy a
      // fixture that made the two equal; this one does not.
      expect(found.executors.map((e) => e.nodeId)).not.toContain(fabric.nodes[0]?.nodeKey)
    } finally {
      fabric.close()
    }
  })

  it('correlates executors with descriptors, so submitJob never reports missing-node-descriptor', async () => {
    const fabric = await fabricOf({ count: 3 })
    try {
      const found = await discoverCandidates(
        { inputCid: fabric.inputCid },
        {
          rpc: fabric.requestorRpc,
          peers: () => fabric.nodes.map((n) => n.peerId),
          trustedIssuers: fabric.trustedIssuers,
          now: () => NOW,
          peerIdFor: fabric.peerIdFor,
          dispatch: 'dispatches-unauthenticated',
        },
      )

      // Both legs are load-bearing and each was measured alone. Keying the descriptor
      // on `nodeKey` while the executor keeps the peer id reddens this comparison; with
      // this line removed, the `submitJob` call below still fails, returning
      // `missing-node-descriptor`. Neither is decoration.
      expect(found.nodes.map((n) => n.nodeId).sort()).toStrictEqual(
        found.executors.map((e) => e.nodeId).sort(),
      )

      // The invariant asserted directly, through the function that names it.
      const r = await submitJob(
        {
          moduleCid: fabric.inputCid,
          shards: [{ value: { n: 1 }, label: 'public' }],
          executors: found.executors,
          nodes: found.nodes,
          redundancy: 1,
        },
        new MemoryBlockstore(),
      )
      expect(r.ok).toBe(true)
      if (!r.ok) expect(r.error.kind).not.toBe('missing-node-descriptor')
    } finally {
      fabric.close()
    }
  })

  it('names an undialable node rather than dropping it', async () => {
    const fabric = await fabricOf({ count: 3 })
    try {
      const orphan = fabric.nodes[0]?.nodeKey as PublicKeyHex
      const found = await discoverCandidates(
        { inputCid: fabric.inputCid },
        {
          rpc: fabric.requestorRpc,
          peers: () => fabric.nodes.map((n) => n.peerId),
          trustedIssuers: fabric.trustedIssuers,
          now: () => NOW,
          // This one qualified in every way and simply names no dialable peer.
          peerIdFor: (key) => (key === orphan ? null : fabric.peerIdFor(key)),
          dispatch: 'dispatches-unauthenticated',
        },
      )

      // BOTH halves. Asserting only the second would leave "reported by name"
      // indistinguishable from "never qualified".
      expect(found.undialable).toStrictEqual([orphan])
      expect(found.executors).toHaveLength(2)
      expect(found.nodes).toHaveLength(2)
      // It qualified — it is absent from `excluded`, which is the whole distinction.
      expect(found.excluded).toStrictEqual([])
    } finally {
      fabric.close()
    }
  })

  it('passes exclusions and the provider count through, so an empty list can be read', async () => {
    const fabric = await fabricOf({ count: 3, rogueIssuer: (i) => i === 2 })
    try {
      const found = await discoverCandidates(
        { inputCid: fabric.inputCid },
        {
          rpc: fabric.requestorRpc,
          peers: () => fabric.nodes.map((n) => n.peerId),
          trustedIssuers: fabric.trustedIssuers,
          now: () => NOW,
          peerIdFor: fabric.peerIdFor,
          dispatch: 'dispatches-unauthenticated',
        },
      )

      expect(found.executors).toHaveLength(2)
      // The unpinned issuer's node was heard from and named, not silently absent.
      expect(found.excluded.map((e) => e.reason.kind)).toStrictEqual(['invalid-certificate'])
      expect(found.excluded[0]?.detail).toContain(fabric.nodes[2]?.nodeKey)
      // It still counted as a provider — it holds the block, it just cannot be trusted.
      expect(found.providers).toBe(3)
    } finally {
      fabric.close()
    }
  })

  it('reads the sovereign pair off the record rather than assuming either constant', async () => {
    // Node 0 is cleared for its own user key; node 1 is not. Two different answers
    // from one run, so neither a hardcoded `true` nor a hardcoded `false` survives.
    const fabric = await fabricOf({ count: 2, sovereignFor: (i) => i === 0 })
    try {
      const found = await discoverCandidates(
        { inputCid: fabric.inputCid },
        {
          rpc: fabric.requestorRpc,
          peers: () => fabric.nodes.map((n) => n.peerId),
          trustedIssuers: fabric.trustedIssuers,
          now: () => NOW,
          peerIdFor: fabric.peerIdFor,
          dispatch: 'dispatches-unauthenticated',
        },
      )

      const cleared = found.nodes.find((n) => n.nodeId === fabric.nodes[0]?.peerId)
      const notCleared = found.nodes.find((n) => n.nodeId === fabric.nodes[1]?.peerId)
      expect(cleared?.canExecuteSovereign).toBe(true)
      expect(notCleared?.canExecuteSovereign).toBe(false)

      // `ownerId` is the certificate's user key on both — the seam this module names
      // rather than unifies: a `PlacementRequest.ownerId` must be this hex key, not
      // an operator label. AUTH-05 / Phase 19 owns unifying the two.
      expect(cleared?.ownerId).toBe(fabric.nodes[0]?.records.certificate.userKey)
      expect(notCleared?.ownerId).toBe(fabric.nodes[1]?.records.certificate.userKey)

      // Discovery learns nothing about load, and says so rather than estimating.
      expect(found.nodes.map((n) => n.load)).toStrictEqual([0, 0])
    } finally {
      fabric.close()
    }
  })
})

describe('AUTH-05 — the certificate that qualified a node survives into the descriptor', () => {
  it('carries the certificate the provider signed, not a rebuild of the parts it used', async () => {
    const fabric = await fabricOf({ count: 2 })
    try {
      const found = await discoverCandidates(
        { inputCid: fabric.inputCid },
        {
          rpc: fabric.requestorRpc,
          peers: () => fabric.nodes.map((n) => n.peerId),
          trustedIssuers: fabric.trustedIssuers,
          now: () => NOW,
          peerIdFor: fabric.peerIdFor,
          dispatch: 'dispatches-unauthenticated',
        },
      )

      const signed = fabric.nodes[0]?.records.certificate
      const carried = found.nodes.find((n) => n.nodeId === fabric.nodes[0]?.peerId)?.certificate
      // The whole object, by identity of contents. A descriptor assembled from the
      // fields the old code kept — the user key, and whatever else a reader guessed at
      // — satisfies every field-by-field check below and fails this one.
      expect(carried).toStrictEqual(signed)

      if (carried === undefined || carried === 'carries-no-certificate') {
        throw new Error('the descriptor carries no certificate')
      }
      // Named individually as well, because these two are what a rebuild cannot
      // produce: they are the provider's statement about the node, not the node's
      // description of itself, and they are what makes the certificate transferable.
      expect(carried.issuer).toBe(signed?.issuer)
      expect(carried.signature).toBe(signed?.signature)
      // And the three fields the quorum machinery reads, which the discard threw away.
      expect(carried.operatorId).toBe('op-0')
      expect(carried.discoverability).toBe('seed')
      expect(carried.relayIds).toStrictEqual([])
    } finally {
      fabric.close()
    }
  })

  it('states the absence where there is no certificate to carry, rather than omitting it', () => {
    // `publicNodes` is the other producer of a `NodeDescriptor` in this repository, and
    // it has no certificate to hand. That is a fact about what the caller knows, not a
    // property of the nodes — so it is written down as a value somebody chose.
    const built = publicNodes([{ nodeId: 'peer-0' }, { nodeId: 'peer-1' }])

    expect(built.map((node) => node.certificate)).toStrictEqual([
      'carries-no-certificate',
      'carries-no-certificate',
    ])
    // The key is PRESENT. An optional field left off would satisfy a `=== undefined`
    // reading and would be indistinguishable from a builder that forgot — which is the
    // whole reason the field is required.
    expect(built.every((node) => Object.hasOwn(node, 'certificate'))).toBe(true)
  })

  it('groups the qualified certificates into per-owner replica sets', async () => {
    // All three nodes enrol under one user key; node 2's certificate is signed by an
    // issuer the requestor never pinned.
    const fabric = await fabricOf({ count: 3, rogueIssuer: (i) => i === 2 })
    try {
      const found = await discoverCandidates(
        { inputCid: fabric.inputCid },
        {
          rpc: fabric.requestorRpc,
          peers: () => fabric.nodes.map((n) => n.peerId),
          trustedIssuers: fabric.trustedIssuers,
          now: () => NOW,
          peerIdFor: fabric.peerIdFor,
          dispatch: 'dispatches-unauthenticated',
        },
      )

      expect(found.replicaSets).toHaveLength(1)
      const set = found.replicaSets[0]
      expect(set?.userKey).toBe(fabric.nodes[0]?.records.certificate.userKey)
      // Two nodes under one owner, so the owner can verify inside their own domain.
      expect(set?.canVerifyWithinOwnerDomain).toBe(true)
      expect(set?.certificates.map((c) => c.nodeKey).toSorted()).toStrictEqual(
        [fabric.nodes[0]?.nodeKey, fabric.nodes[1]?.nodeKey].toSorted(),
      )
      // The unpinned issuer signed for the SAME user key, which is exactly how an
      // owner-attested result would be made to look verified. It is absent.
      expect(set?.certificates.map((c) => c.nodeKey)).not.toContain(fabric.nodes[2]?.nodeKey)
    } finally {
      fabric.close()
    }
  })

  it('does not call one node under an owner owner-domain redundancy', async () => {
    // The contrast that stops the assertion above being satisfiable by a constant: the
    // same code path, one qualified node, and the opposite answer.
    const fabric = await fabricOf({ count: 1 })
    try {
      const found = await discoverCandidates(
        { inputCid: fabric.inputCid },
        {
          rpc: fabric.requestorRpc,
          peers: () => fabric.nodes.map((n) => n.peerId),
          trustedIssuers: fabric.trustedIssuers,
          now: () => NOW,
          peerIdFor: fabric.peerIdFor,
          dispatch: 'dispatches-unauthenticated',
        },
      )

      expect(found.replicaSets).toHaveLength(1)
      expect(found.replicaSets[0]?.certificates).toHaveLength(1)
      expect(found.replicaSets[0]?.canVerifyWithinOwnerDomain).toBe(false)
    } finally {
      fabric.close()
    }
  })
})
