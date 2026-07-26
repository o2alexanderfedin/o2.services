import { ed25519 } from '@noble/curves/ed25519.js'
import {
  EnrollmentAuthority,
  MemoryBlockstore,
  MemoryNetwork,
  MemoryRecordIndex,
  WasmExecutor,
  attestationReceipt,
  discoverExecutors,
  encodeCanonical,
  executeVerified,
  planWithOffers,
  publishCapabilities,
  requestEnrollment,
  resolveReplicaSets,
  toHex,
} from '@o2/core'
import type { NodeCertificate, NodeDescriptor, NodeRecords, Task } from '@o2/core'
import { describe, expect, it } from 'vitest'
// Test-only relative import — see the note in distributed.test.ts.
import { MODULE_ECHOES_INPUT, MODULE_WRITES_PARTITION } from '../../core/src/executor/fixtures.ts'
import {
  EgressGuard,
  FetchingBlockstore,
  RemoteExecutor,
  RpcBlockSource,
  RpcEndpoint,
  RpcRecordIndex,
  rpcAdmission,
  serveAgent,
} from './index.ts'

/**
 * Phase 6 criterion 6 — owner-domain execution, end to end, with the tap watching.
 *
 * Every piece of this exists and is unit-tested separately. What was missing is the
 * assembly, and the assembly is where the claim actually lives: a sovereignty-pinned
 * task, placed on two of one owner's nodes, executed redundantly, its outputs
 * compared, its receipt labelled `owner-domain` rather than `independent`, and an
 * egress manifest showing that what left those nodes was derived and not raw.
 *
 * The manifest is only worth reading if the tap can fail, so the last test replaces
 * the aggregating module with one that echoes its input and requires the tap to
 * catch it *in this exact wiring*. A tap that has never caught anything is a tap
 * nobody has tested.
 */

const NOW = 1_800_000_000_000
const YEAR = 365 * 24 * 3_600_000
const SEED = 'seed'

/** Alice's sovereign row. Distinctive bytes, so a match in a frame means something. */
const SOVEREIGN_ROW = { ssn: '123-45-6789', salary: 87_000, dob: '1984-02-29' }

function sovereignBytes(): Uint8Array<ArrayBuffer> {
  const encoded = encodeCanonical(SOVEREIGN_ROW)
  if (!encoded.ok) throw new Error('fixture not encodable')
  return encoded.bytes
}

interface OwnerNode {
  readonly nodeId: string
  readonly rpc: RpcEndpoint
  readonly guard: EgressGuard
  readonly certificate: NodeCertificate
}

interface Fabric {
  readonly requestorRpc: RpcEndpoint
  readonly owned: readonly OwnerNode[]
  readonly foreignKey: string
  readonly aliceUserKey: string
  readonly inputCid: Awaited<ReturnType<MemoryBlockstore['put']>>
  readonly moduleCid: Awaited<ReturnType<MemoryBlockstore['put']>>
  readonly certificates: readonly NodeCertificate[]
  readonly trustedIssuers: ReadonlySet<string>
  close(): void
}

/**
 * Alice's two nodes plus one of Bob's, all holding the same block.
 *
 * Bob's node is the DATA-09 case made concrete: it *provides* the CID — it holds an
 * encrypted replica, which is useful for availability — and it is not cleared to
 * execute, because executing would mean handing it the key.
 */
async function ownerFabric(options: { module: Uint8Array<ArrayBuffer>; ownerNodes: number }): Promise<Fabric> {
  const network = new MemoryNetwork()
  const authority = new EnrollmentAuthority({
    providerPrivateKey: new Uint8Array(32).fill(80),
    maxPerWindow: 100,
  })
  const trustedIssuers = new Set([authority.issuerKey])
  const aliceUserKey = toHex(ed25519.getPublicKey(new Uint8Array(32).fill(81)))
  const bobUserKey = toHex(ed25519.getPublicKey(new Uint8Array(32).fill(82)))

  const seedStore = new MemoryBlockstore()
  const moduleCid = await seedStore.put(options.module)
  const inputCid = await seedStore.put(sovereignBytes())
  const index = new MemoryRecordIndex()
  const seedRpc = new RpcEndpoint(network.connect(SEED), { timeoutMs: 5_000 })
  serveAgent({
    rpc: seedRpc,
    executor: new WasmExecutor({ nodeId: SEED, blockstore: seedStore }),
    blockstore: seedStore,
    index,
  })

  const certificates: NodeCertificate[] = []

  const enrol = (priv: Uint8Array, userKey: string, operatorId: string): NodeCertificate => {
    const result = authority.enrol(
      requestEnrollment(priv, { userKey, operatorId, discoverability: 'seed', relayIds: [] }),
      NOW,
    )
    if (!result.ok) throw new Error(`fixture enrolment failed: ${result.reason}`)
    return result.certificate
  }

  const owned: OwnerNode[] = []
  for (let i = 0; i < options.ownerNodes; i++) {
    const priv = new Uint8Array(32).fill(90 + i)
    const nodeId = toHex(ed25519.getPublicKey(priv))
    // Same operator for both: one person's own machines are one operator, which is
    // exactly why their agreement is owner-domain and not independent.
    const certificate = enrol(priv, aliceUserKey, 'alice-op')
    const capabilities = publishCapabilities(priv, {
      features: ['bulk-memory'],
      sovereignFor: [aliceUserKey],
      issuedAt: NOW - 1000,
      expiresAt: NOW + YEAR,
    })
    const records: NodeRecords = { certificate, capabilities }

    // The tap wraps the transport, so it is the node's only exit by construction.
    const guard = new EgressGuard(network.connect(nodeId), aliceUserKey)
    guard.guard('alice-row', sovereignBytes())

    const local = new MemoryBlockstore()
    await local.put(sovereignBytes())
    const rpc = new RpcEndpoint(guard, { timeoutMs: 5_000 })
    const store = new FetchingBlockstore(local, new RpcBlockSource(rpc, () => [SEED]))
    serveAgent({ rpc, executor: new WasmExecutor({ nodeId, blockstore: store }), blockstore: store })

    index.provide(inputCid, nodeId)
    index.publish(records)
    certificates.push(certificate)
    owned.push({ nodeId, rpc, guard, certificate })
  }

  // Bob's node: provides the block, cleared for nobody.
  const bobPriv = new Uint8Array(32).fill(99)
  const foreignKey = toHex(ed25519.getPublicKey(bobPriv))
  const bobCertificate = enrol(bobPriv, bobUserKey, 'bob-op')
  const bobRpc = new RpcEndpoint(network.connect(foreignKey), { timeoutMs: 5_000 })
  const bobStore = new MemoryBlockstore()
  await bobStore.put(sovereignBytes())
  serveAgent({
    rpc: bobRpc,
    executor: new WasmExecutor({ nodeId: foreignKey, blockstore: bobStore }),
    blockstore: bobStore,
  })
  index.provide(inputCid, foreignKey)
  index.publish({
    certificate: bobCertificate,
    capabilities: publishCapabilities(bobPriv, {
      features: ['bulk-memory'],
      sovereignFor: [],
      issuedAt: NOW - 1000,
      expiresAt: NOW + YEAR,
    }),
  })
  certificates.push(bobCertificate)

  const requestorRpc = new RpcEndpoint(network.connect('requestor'), { timeoutMs: 5_000 })

  return {
    requestorRpc,
    owned,
    foreignKey,
    aliceUserKey,
    inputCid,
    moduleCid,
    certificates,
    trustedIssuers,
    close() {
      seedRpc.close()
      bobRpc.close()
      requestorRpc.close()
      for (const node of owned) node.rpc.close()
    },
  }
}

const sovereignDescriptors = (
  executors: readonly { nodeKey: string }[],
  ownerId: string,
): readonly NodeDescriptor[] =>
  executors.map((executor) => ({
    nodeId: executor.nodeKey,
    ownerId,
    canExecuteSovereign: true,
    load: 0,
  }))

describe('criterion 6 — an owner’s own nodes verify each other', () => {
  it('discovers, places, executes on two and compares the outputs', async () => {
    const fabric = await ownerFabric({ module: MODULE_WRITES_PARTITION, ownerNodes: 2 })
    try {
      const index = new RpcRecordIndex(fabric.requestorRpc, () => [SEED])

      // AUTH-05: the owner's nodes resolve as one replica set from certificates.
      const replicaSets = resolveReplicaSets(fabric.certificates, fabric.trustedIssuers, NOW)
      const aliceSet = replicaSets.find((set) => set.userKey === fabric.aliceUserKey)
      expect(aliceSet?.certificates).toHaveLength(2)
      expect(aliceSet?.canVerifyWithinOwnerDomain).toBe(true)

      const found = await discoverExecutors(
        { inputCid: fabric.inputCid, sovereignFor: fabric.aliceUserKey },
        index,
        { trustedIssuers: fabric.trustedIssuers, now: NOW },
      )

      // Bob provides the block and is excluded by name, not by omission.
      expect(found.providers).toBe(3)
      expect(found.executors).toHaveLength(2)
      expect(found.executors.map((e) => e.nodeKey)).not.toContain(fabric.foreignKey)
      expect(found.excluded[0]?.reason.kind).toBe('not-cleared-for-owner')

      const placements = await planWithOffers(
        [{ shardId: 's0', label: 'sovereign', ownerId: fabric.aliceUserKey, redundancy: 2 }],
        sovereignDescriptors(found.executors, fabric.aliceUserKey),
        { d: 2, admit: rpcAdmission(fabric.requestorRpc, { probeTimeoutMs: 500 }) },
      )
      const placement = placements[0]
      expect(placement?.status).toBe('placed')
      if (placement?.status !== 'placed') return
      expect(placement.replicas).toBe(2)
      expect(placement.degraded).toBe(false)
      expect(placement.nodeIds).not.toContain(fabric.foreignKey)

      const task: Task = {
        moduleCid: fabric.moduleCid,
        inputCid: fabric.inputCid,
        partitionIndex: 0,
        partitionCount: 1,
      }
      const verification = await executeVerified(
        task,
        placement.nodeIds.map((nodeId) => new RemoteExecutor(nodeId, fabric.requestorRpc)),
      )
      expect(verification.status).toBe('agreed')

      // The label travels with the result. Two nodes, one operator — the agreement
      // is independent of hardware, not of the owner, and must not read otherwise.
      const receipt = attestationReceipt(aliceSet?.certificates ?? [])
      expect(receipt.strength).toBe('owner-domain')
      expect(receipt.replicas).toBe(2)
      expect(receipt.operators).toEqual(['alice-op'])
      expect(receipt.description).toContain('not across operators')
    } finally {
      fabric.close()
    }
  })

  it('shows the tap clean: work left the owner’s nodes, raw data did not', async () => {
    const fabric = await ownerFabric({ module: MODULE_WRITES_PARTITION, ownerNodes: 2 })
    try {
      const task: Task = {
        moduleCid: fabric.moduleCid,
        inputCid: fabric.inputCid,
        partitionIndex: 0,
        partitionCount: 1,
      }
      const verification = await executeVerified(
        task,
        fabric.owned.map((node) => new RemoteExecutor(node.nodeId, fabric.requestorRpc)),
      )
      expect(verification.status).toBe('agreed')

      for (const node of fabric.owned) {
        const manifest = node.guard.manifest
        expect(manifest.violations).toEqual([])
        // Not a vacuous pass: these nodes did send. They fetched the module and
        // returned a result — derived values only.
        expect(manifest.entries.length).toBeGreaterThan(0)
        expect(manifest.totalBytes).toBeGreaterThan(0)
        expect(manifest.ownerId).toBe(fabric.aliceUserKey)
      }
    } finally {
      fabric.close()
    }
  })

  it('catches a map step that forgot to aggregate and shipped its input', async () => {
    // The falsification. Same wiring, same tap, a module that echoes its input —
    // which is precisely the failure the egress requirement exists to catch, and
    // the only evidence that the clean manifest above means anything.
    const fabric = await ownerFabric({ module: MODULE_ECHOES_INPUT, ownerNodes: 1 })
    try {
      const node = fabric.owned[0] as OwnerNode
      const outcome = await new RemoteExecutor(node.nodeId, fabric.requestorRpc).execute({
        moduleCid: fabric.moduleCid,
        inputCid: fabric.inputCid,
        partitionIndex: 0,
        partitionCount: 1,
      })
      expect(outcome.ok).toBe(true)

      const manifest = node.guard.manifest
      expect(manifest.violations).toContain('alice-row')
    } finally {
      fabric.close()
    }
  })
})

describe('criterion 7 — one live node is owner-attested, and says so', () => {
  it('executes once and refuses to call it verified', async () => {
    const fabric = await ownerFabric({ module: MODULE_WRITES_PARTITION, ownerNodes: 1 })
    try {
      const index = new RpcRecordIndex(fabric.requestorRpc, () => [SEED])
      const found = await discoverExecutors(
        { inputCid: fabric.inputCid, sovereignFor: fabric.aliceUserKey },
        index,
        { trustedIssuers: fabric.trustedIssuers, now: NOW },
      )
      expect(found.executors).toHaveLength(1)

      // Asking for two replicas from an owner with one node degrades rather than
      // borrowing Bob's — the requested redundancy is simply not available.
      const placements = await planWithOffers(
        [{ shardId: 's0', label: 'sovereign', ownerId: fabric.aliceUserKey, redundancy: 2 }],
        sovereignDescriptors(found.executors, fabric.aliceUserKey),
        { d: 2, admit: rpcAdmission(fabric.requestorRpc, { probeTimeoutMs: 500 }) },
      )
      const placement = placements[0]
      expect(placement?.status).toBe('placed')
      if (placement?.status !== 'placed') return
      expect(placement.replicas).toBe(1)
      expect(placement.degraded).toBe(true)

      const outcome = await new RemoteExecutor(
        placement.nodeIds[0] as string,
        fabric.requestorRpc,
      ).execute({
        moduleCid: fabric.moduleCid,
        inputCid: fabric.inputCid,
        partitionIndex: 0,
        partitionCount: 1,
      })
      expect(outcome.ok).toBe(true)

      const receipt = attestationReceipt([fabric.owned[0]?.certificate as NodeCertificate])
      expect(receipt.strength).toBe('owner-attested')
      expect(receipt.description).toContain('not independently verified')
    } finally {
      fabric.close()
    }
  })
})
