import { ed25519 } from '@noble/curves/ed25519.js'
import {
  EnrollmentAuthority,
  LocalCapacity,
  MemoryBlockstore,
  MemoryNetwork,
  MemoryRecordIndex,
  WasmExecutor,
  attestationReceipt,
  discoverExecutors,
  encodeCanonical,
  executeVerified,
  guardSovereignty,
  operatorIdFor,
  planWithOffers,
  publishCapabilities,
  requestEnrollment,
  resolveReplicaSets,
  submitJob,
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
  encodeRequest,
  parseResponse,
  rpcAdmission,
  serveAgent,
} from './index.ts'
import type { SovereignCids } from './index.ts'

/**
 * Phase 6 criterion 6 — owner-domain execution, end to end, with the tap watching.
 *
 * Every piece of this exists and is unit-tested separately. What was missing is the
 * assembly, and the assembly is where the claim actually lives: a sovereignty-pinned
 * task, placed on two of one owner's nodes, executed redundantly, its outputs
 * compared, its receipt labelled `owner-domain` rather than `independent`, and an
 * egress manifest showing that what left those nodes was derived and not raw.
 *
 * The manifest is only worth reading if the tap can fire, so the last test replaces
 * the aggregating module with one that echoes its input and requires the tap to
 * refuse the reply *in this exact wiring* — the raw row stays on the owner's node
 * and the dispatch fails. A tap that has never stopped anything is a tap nobody has
 * tested.
 */

const NOW = 1_800_000_000_000
const YEAR = 365 * 24 * 3_600_000
const SEED = 'seed'

/** Alice's sovereign row. Distinctive bytes, so a match in a frame means something. */
const SOVEREIGN_ROW = { ssn: '123-45-6789', salary: 87_000, dob: '1984-02-29' }

async function sovereignBytes(): Promise<Uint8Array<ArrayBuffer>> {
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
  /**
   * SEED's own store — what every owned node's `RpcBlockSource` actually fetches
   * from (`() => [SEED]`, below). Exposed so `submitJob` (criterion 3) can
   * `put` a new shard's input somewhere the dispatched node can reach it, the
   * same way a real requestor's blockstore is reachable by whoever it dispatches
   * to.
   */
  readonly seedStore: MemoryBlockstore
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
    maxIssuedPerWindow: 'issues-without-an-aggregate-budget',
    issuance: 'remembers-only-within-this-process',
  })
  const trustedIssuers = new Set([authority.issuerKey])
  const aliceUserPriv = new Uint8Array(32).fill(81)
  const bobUserPriv = new Uint8Array(32).fill(82)
  const aliceUserKey = toHex(ed25519.getPublicKey(aliceUserPriv))
  const bobUserKey = toHex(ed25519.getPublicKey(bobUserPriv))

  const seedStore = new MemoryBlockstore()
  const moduleCid = await seedStore.put(options.module)
  const inputCid = await seedStore.put(await sovereignBytes())
  const index = new MemoryRecordIndex()
  const seedRpc = new RpcEndpoint(network.connect(SEED), { timeoutMs: 5_000 })
  serveAgent({
    paused: 'never-pauses',
    rpc: seedRpc,
    executor: new WasmExecutor({ nodeId: SEED, blockstore: seedStore }),
    blockstore: seedStore,
    // The seed's transport is un-decorated, so its sends carry no registrations.
    egress: 'holds-no-registrations',
    authorize: 'serves-unauthenticated',
    index,
    enroll: 'issues-no-certificates',
    capacity: 'accepts-every-offer',
    ledger: 'keeps-no-ledger',
    reservations: 'relays-for-nobody',
    onDispatch: 'reports-no-dispatch',
    attest: 'signs-nothing',
  })

  const certificates: NodeCertificate[] = []

  const enrol = async (priv: Uint8Array, userPriv: Uint8Array): Promise<NodeCertificate> => {
    const result = authority.enrol(
      await requestEnrollment(priv, userPriv, { discoverability: 'seed', relayIds: [] }),
      NOW,
    )
    if (!result.ok) throw new Error(`fixture enrolment failed: ${result.reason}`)
    return result.certificate
  }

  const owned: OwnerNode[] = []
  for (let i = 0; i < options.ownerNodes; i++) {
    const priv = new Uint8Array(32).fill(90 + i)
    const nodeId = toHex(ed25519.getPublicKey(priv))
    // Same operator for both, and since 2026-09-16 that is **structural rather than a
    // convention this fixture keeps**: the provider derives `operatorId` from the user key
    // (VER-11), so passing one `aliceUserPriv` is what makes these one operator. It used to
    // be a string both calls happened to repeat. One person's own machines are one operator,
    // which is exactly why their agreement is owner-domain and not independent.
    const certificate = await enrol(priv, aliceUserPriv)
    const capabilities = publishCapabilities(priv, {
      features: ['bulk-memory'],
      sovereignFor: [aliceUserKey],
      issuedAt: NOW - 1000,
      expiresAt: NOW + YEAR,
      extensions: [],
    })
    const records: NodeRecords = { certificate, capabilities }

    // The tap wraps the transport, so it is the node's only exit by construction.
    const guard = new EgressGuard(network.connect(nodeId), aliceUserKey)
    guard.guard('alice-row', await sovereignBytes())

    const local = new MemoryBlockstore()
    await local.put(await sovereignBytes())
    const rpc = new RpcEndpoint(guard, { timeoutMs: 5_000 })
    const store = new FetchingBlockstore(local, new RpcBlockSource(rpc, () => [SEED]))
    // DATA-09: the serving-side gate, wrapped exactly the way `fabric-node.ts`/
    // `browser-node.ts` now wrap it in production (Phase 12 Plan 04). A no-op
    // for every pre-existing test in this file — none of them label a `Task` —
    // and it is what makes criterion 4's refusal test below meaningful: Bob's
    // node below gets the same wrap with `canExecuteSovereign: false`.
    serveAgent({
      paused: 'never-pauses',
      rpc,
      executor: guardSovereignty(new WasmExecutor({ nodeId, blockstore: store }), {
        ownerId: aliceUserKey,
        canExecuteSovereign: true,
      }),
      blockstore: store,
      // This owner node's own tap. These tests take a hold on `'alice-row'`
      // directly rather than through a task, so nothing here gives it back — which
      // is the point: the payload under watch is not one a reply would release.
      // `local` is the node's local-only tier, which is what declares a sovereign
      // input, mirroring both production factories.
      egress: { guard, sovereignInputs: local, sovereignCids: 'forgets-sovereignty-between-jobs' },
      authorize: 'serves-unauthenticated',
      index: 'serves-no-records',
      enroll: 'issues-no-certificates',
      capacity: 'accepts-every-offer',
      ledger: 'keeps-no-ledger',
      reservations: 'relays-for-nobody',
      onDispatch: 'reports-no-dispatch',
      attest: 'signs-nothing',
    })

    index.provide(inputCid, nodeId)
    index.publish(records)
    certificates.push(certificate)
    owned.push({ nodeId, rpc, guard, certificate })
  }

  // Bob's node: provides the block, cleared for nobody.
  const bobPriv = new Uint8Array(32).fill(99)
  const foreignKey = toHex(ed25519.getPublicKey(bobPriv))
  const bobCertificate = await enrol(bobPriv, bobUserPriv)
  const bobRpc = new RpcEndpoint(network.connect(foreignKey), { timeoutMs: 5_000 })
  const bobStore = new MemoryBlockstore()
  await bobStore.put(await sovereignBytes())
  serveAgent({
    paused: 'never-pauses',
    rpc: bobRpc,
    // DATA-09: Bob genuinely holds the block (see `bobStore.put` above) and is
    // still not cleared to execute it — the guard, not absence of data, is what
    // must refuse criterion 4's direct dispatch.
    executor: guardSovereignty(new WasmExecutor({ nodeId: foreignKey, blockstore: bobStore }), {
      ownerId: foreignKey,
      canExecuteSovereign: false,
    }),
    blockstore: bobStore,
    // This endpoint is built over a raw transport with no tap on it, so its sends
    // carry no registrations to release — a statement about this endpoint, not a
    // difference in what kind of node it is.
    egress: 'holds-no-registrations',
    authorize: 'serves-unauthenticated',
    index: 'serves-no-records',
    enroll: 'issues-no-certificates',
    capacity: 'accepts-every-offer',
    ledger: 'keeps-no-ledger',
    reservations: 'relays-for-nobody',
    onDispatch: 'reports-no-dispatch',
    attest: 'signs-nothing',
  })
  index.provide(inputCid, foreignKey)
  index.publish({
    certificate: bobCertificate,
    capabilities: publishCapabilities(bobPriv, {
      features: ['bulk-memory'],
      sovereignFor: [],
      issuedAt: NOW - 1000,
      expiresAt: NOW + YEAR,
      extensions: [],
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
    seedStore,
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
    // This helper is handed node keys, not records, so it has no certificate to pass
    // on and says so. `discoverCandidates` is the producer that does carry one; the
    // difference between the two is what this file's fixture stands in for, and
    // closing it means widening this signature rather than guessing a value here.
    certificate: 'carries-no-certificate',
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

      // Now carries the label the wire actually enforces (Phase 12 Plan 04):
      // both `guardSovereignty` on these nodes (`ownerId: aliceUserKey`,
      // cleared) and `parseRequest`'s now-mandatory label depend on it.
      const task: Task = {
        moduleCid: fabric.moduleCid,
        inputCid: fabric.inputCid,
        partitionIndex: 0,
        partitionCount: 1,
        label: 'sovereign',
        ownerId: fabric.aliceUserKey,
      }
      const verification = await executeVerified(
        task,
        placement.nodeIds.map(
          (nodeId) => new RemoteExecutor(nodeId, fabric.requestorRpc, 'dispatches-unauthenticated'),
        ),
      )
      expect(verification.status).toBe('agreed')

      // The label travels with the result. Two nodes, one operator — the agreement
      // is independent of hardware, not of the owner, and must not read otherwise.
      const receipt = attestationReceipt(aliceSet?.certificates ?? [])
      expect(receipt.strength).toBe('owner-domain')
      expect(receipt.replicas).toBe(2)
      expect(receipt.operators).toEqual([operatorIdFor(fabric.aliceUserKey)])
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
        label: 'sovereign',
        ownerId: fabric.aliceUserKey,
      }
      const verification = await executeVerified(
        task,
        fabric.owned.map(
          (node) => new RemoteExecutor(node.nodeId, fabric.requestorRpc, 'dispatches-unauthenticated'),
        ),
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

  it('stops a map step that forgot to aggregate and tried to ship its input', async () => {
    // The falsification. Same wiring, same tap, a module that echoes its input —
    // which is precisely the failure the egress requirement exists to stop, and the
    // only evidence that the clean manifest above means anything. The tap does not
    // merely notice the echo: the reply frame carrying the raw row is refused, so
    // the row never leaves this node and the dispatch fails instead.
    //
    // NET-10: the requestor is told *why*, rather than waiting out its 5s budget.
    // `serveAgent` asks the tap about its candidate reply before handing it to the
    // exit and, on a hit, substitutes a small `{kind:'exec', outcome:{ok:false}}`
    // naming the violated label and this node. `rpc.ts`'s responding leg still
    // swallows a send failure by documented design — that cost is unchanged for
    // every frame `serveAgent` does not pre-scan; see the scoped exception in
    // `egress.ts`'s class comment. The extended test timeout below is kept so a
    // regression to the old behaviour reports as a failed assertion rather than an
    // opaque runner timeout.
    const fabric = await ownerFabric({ module: MODULE_ECHOES_INPUT, ownerNodes: 1 })
    try {
      const node = fabric.owned[0] as OwnerNode
      const remote = new RemoteExecutor(
        node.nodeId,
        fabric.requestorRpc,
        'dispatches-unauthenticated',
      )
      const outcome = await remote.execute({
        moduleCid: fabric.moduleCid,
        inputCid: fabric.inputCid,
        partitionIndex: 0,
        partitionCount: 1,
        label: 'sovereign',
        ownerId: fabric.aliceUserKey,
      })
      expect(outcome.ok).toBe(false)
      if (outcome.ok) return
      expect(outcome.reason).toContain(node.nodeId)
      // The wire vocabulary, asserted here too so the prefix cannot drift on the
      // path that goes through a real `RemoteExecutor` rather than a direct RPC.
      expect(outcome.reason.startsWith('egress refused: ')).toBe(true)
      expect(outcome.reason).toContain('alice-row')

      // The refusal is still visible on the owner's own tap. Paired with a
      // non-empty entries reading, so a manifest that recorded nothing at all
      // cannot pass as one that recorded a refusal.
      const manifest = node.guard.manifest
      expect(manifest.violations).toContain('alice-row')
      expect(manifest.entries.length).toBeGreaterThan(0)
      expect(manifest.entries.some((entry) => entry.violation === 'alice-row')).toBe(true)
    } finally {
      fabric.close()
    }
  }, 20_000)
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
        'dispatches-unauthenticated',
      ).execute({
        moduleCid: fabric.moduleCid,
        inputCid: fabric.inputCid,
        partitionIndex: 0,
        partitionCount: 1,
        label: 'sovereign',
        ownerId: fabric.aliceUserKey,
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

/**
 * Phase 12 Plan 04 — the two remaining ROADMAP criteria that only make sense at
 * the network layer, now that `label`/`ownerId` survive the wire
 * (`protocol.ts`) and `ownerFabric`'s nodes are wrapped with `guardSovereignty`
 * (above). Distinct from Phase 6's "criterion 6"/"criterion 7" numbering above —
 * these are this plan's own criteria 3 and 4.
 */
describe('Phase 12 — sovereignty wired onto submitJob', () => {
  it('criterion 4 — a genuine replica holder refuses a direct sovereign dispatch, over real RPC', async () => {
    const fabric = await ownerFabric({ module: MODULE_WRITES_PARTITION, ownerNodes: 1 })
    try {
      const task: Task = {
        moduleCid: fabric.moduleCid,
        inputCid: fabric.inputCid,
        partitionIndex: 0,
        partitionCount: 1,
        label: 'sovereign',
        ownerId: fabric.aliceUserKey,
      }
      // Bypasses placement entirely, the same way distributed.test.ts's AUTH-03
      // test bypasses placement to prove its own server-side gate directly —
      // placement would never route a sovereign task to Bob, and the refusal
      // has to hold regardless of what dispatched it.
      const outcome = await new RemoteExecutor(
        fabric.foreignKey,
        fabric.requestorRpc,
        'dispatches-unauthenticated',
      ).execute(task)
      expect(outcome.ok).toBe(false)
      if (outcome.ok) return
      expect(outcome.reason).toContain(fabric.foreignKey)
      expect(outcome.reason).toContain('sovereignty')

      // The refusal is specific to *execution*, not to the node being
      // unreachable or empty: Bob genuinely holds the block and still answers
      // for it, exactly as the quality gate requires.
      const blockReply = await fabric.requestorRpc.request(fabric.foreignKey, {
        kind: 'block',
        cid: fabric.inputCid,
      })
      expect(blockReply).toEqual({ kind: 'block', found: true, bytes: await sovereignBytes() })
    } finally {
      fabric.close()
    }
  })

  it('criterion 3 — pushdown through submitJob, no Phase 13 manifest needed', async () => {
    const fabric = await ownerFabric({ module: MODULE_WRITES_PARTITION, ownerNodes: 1 })
    try {
      const owned = fabric.owned[0] as OwnerNode
      const executors = [new RemoteExecutor(owned.nodeId, fabric.requestorRpc, 'dispatches-unauthenticated')]
      const result = await submitJob(
        {
          moduleCid: fabric.moduleCid,
          // Reuses SOVEREIGN_ROW/sovereignBytes() itself rather than only its
          // shape — that keeps this dispatch checked against the same guarded
          // pattern the falsification test above proves the tap can catch.
          shards: [{ value: SOVEREIGN_ROW, label: 'sovereign', ownerId: fabric.aliceUserKey }],
          executors,
          nodes: [
            {
              nodeId: owned.nodeId,
              ownerId: fabric.aliceUserKey,
              canExecuteSovereign: true,
              load: 0,
              certificate: 'carries-no-certificate',
            },
          ],
          redundancy: 1,
          onQuorumShortfall: 'runs-at-available-redundancy',
        },
        // SEED's own store — the node's `RpcBlockSource` fetches from `[SEED]`,
        // so this is where a real requestor's local blockstore corresponds to.
        fabric.seedStore,
        // CHURN-03 — this test asserts nothing about checkpointing.
        { checkpoints: 'checkpoints-nothing' },
      )

      expect(result.ok).toBe(true)
      if (!result.ok) return
      const shard = result.job.shards[0]
      expect(shard?.verification.status).toBe('agreed')
      if (shard?.verification.status !== 'agreed') return

      const rawEncoded = encodeCanonical(SOVEREIGN_ROW)
      if (!rawEncoded.ok) throw new Error('fixture not encodable')
      const outputEncoded = encodeCanonical(shard.verification.output)
      if (!outputEncoded.ok) throw new Error('output not encodable')
      // DATA-07: what left the node is a partial smaller than the raw sovereign
      // input it was computed from — the pushdown claim, observable without the
      // Phase 13 egress manifest.
      expect(outputEncoded.bytes.length).toBeLessThan(rawEncoded.bytes.length)

      // The existing tap, reused as a test instrument — not newly wired into
      // production here, that is Phase 13's job (fabric-node.ts:311,
      // browser-node.ts:181) — now pointed at submitJob (the live job path)
      // instead of hand-called executeVerified.
      expect(owned.guard.manifest.violations).toEqual([])
      expect(owned.guard.manifest.entries.length).toBeGreaterThan(0)
    } finally {
      fabric.close()
    }
  })
})

/**
 * A hold is given back by whoever took it — B02.
 *
 * `serveAgent`'s exec branch used to release on the *request's* input label, on every
 * exec, whether or not that dispatch had registered anything. `EgressGuard` counts
 * holds, so an unmatched release decrements somebody else's. The slot key is
 * `inputCid:partitionIndex`, so a second request naming the same input with a
 * different partition is admitted concurrently — which makes stripping a sovereign
 * payload's guard a single unauthenticated request, on a factory that serves
 * unauthenticated.
 */
describe('a hold survives an exec that never took one', () => {
  const OWNER = 'alice-user-key'

  /** One serving node, plus a client endpoint pointed at it. */
  /**
   * An in-memory {@link SovereignCids}, which the fixture below can give a node so it is one
   * that KEEPS the durable set rather than one that forgets between jobs.
   *
   * `has` is synchronous by the interface's own requirement — it sits on the `block` branch's
   * hot path, and both shipped adapters load the set at open and keep it in memory.
   */
  function memorySovereignCids(): SovereignCids {
    const held = new Set<string>()
    return {
      add: async (cid: string): Promise<void> => {
        held.add(cid)
      },
      has: (cid: string): boolean => held.has(cid),
    }
  }

  async function servingNode(options: {
    readonly sovereignInputsHoldsIt: boolean
    /**
     * Whether this node keeps the durable sovereign set. Default `false` keeps every case
     * written before 2026-09-15 on exactly the arrangement it was written against.
     */
    readonly keepsSovereignCids?: boolean
    /**
     * The admission table to serve with. Default `'accepts-every-offer'` keeps every case
     * written before 2026-09-15 on exactly the arrangement it was written against — and it is
     * also why no case before that one could see a leaked slot: a table that accepts
     * everything has nothing to leak.
     */
    readonly capacity?: LocalCapacity
  }) {
    const network = new MemoryNetwork()
    const nodeId = 'server'

    // What the executor reads from — everything is resident here, so execution
    // always succeeds and the test is never about a missing block.
    const served = new MemoryBlockstore()
    const moduleCid = await served.put(MODULE_ECHOES_INPUT)
    const inputCid = await served.put(await sovereignBytes())
    // A second input the node holds and has NOT recorded as sovereign — the arm that keeps the
    // refusal above from being satisfied by a node that refuses everything.
    const publicInputCid = await served.put(new Uint8Array([7, 7, 7, 7]))

    // The node's LOCAL-ONLY tier, which is what declares a payload sovereign.
    const sovereignInputs = new MemoryBlockstore()
    if (options.sovereignInputsHoldsIt) await sovereignInputs.put(await sovereignBytes())

    // The durable set — the node's own record of which bytes are sovereign, independent of
    // whether a job is running. `'forgets-sovereignty-between-jobs'` stays the default so the
    // cases written before this one are unchanged.
    const durableCids: SovereignCids | 'forgets-sovereignty-between-jobs' =
      options.keepsSovereignCids === true ? memorySovereignCids() : 'forgets-sovereignty-between-jobs'
    if (durableCids !== 'forgets-sovereignty-between-jobs') await durableCids.add(inputCid.toString())

    const guard = new EgressGuard(network.connect(nodeId), OWNER)
    const rpc = new RpcEndpoint(guard, { timeoutMs: 5_000 })
    serveAgent({
      paused: 'never-pauses',
      rpc,
      executor: guardSovereignty(new WasmExecutor({ nodeId, blockstore: served }), {
        ownerId: OWNER,
        canExecuteSovereign: true,
      }),
      blockstore: served,
      egress: { guard, sovereignInputs, sovereignCids: durableCids },

      authorize: 'serves-unauthenticated',
      index: 'serves-no-records',
      enroll: 'issues-no-certificates',
      capacity: options.capacity ?? 'accepts-every-offer',
      ledger: 'keeps-no-ledger',
      reservations: 'relays-for-nobody',
      onDispatch: 'reports-no-dispatch',
      attest: 'signs-nothing',
    })

    const clientRpc = new RpcEndpoint(network.connect('client'), { timeoutMs: 5_000 })
    /**
     * Dispatch, and wait for the *server's* frame to have settled.
     *
     * `afterSent` runs in a `finally` around the response send, which on an
     * in-process transport is strictly after the requestor's own promise resolves.
     * Asserting on `registrations` without this turn reads the guard one microtask
     * before the release that is the whole subject here.
     */
    const exec = async (task: Task) => {
      const reply = parseResponse(await clientRpc.request(nodeId, encodeRequest({ kind: 'exec', task })))
      await new Promise((resolve) => setTimeout(resolve, 0))
      return reply
    }

    /**
     * The same dispatch as `exec`, on the frame that withholds its answer.
     *
     * `serveAgent` serves both from ONE branch — its own comment says "`exec` and `commit`
     * share this branch, because a commit **is** an exec whose answer is withheld" — so this
     * exists to hold that sharing in place rather than to exercise a second code path. If the
     * branch is ever split, the case using this goes red, which is the only warning a reader
     * would get that a gate written once now needs writing twice.
     */
    const commit = async (task: Task) => {
      const reply = parseResponse(await clientRpc.request(nodeId, encodeRequest({ kind: 'commit', task })))
      await new Promise((resolve) => setTimeout(resolve, 0))
      return reply
    }

    return {
      nodeId,
      guard,
      moduleCid,
      inputCid,
      publicInputCid,
      exec,
      commit,
      close: () => {
        rpc.close()
        clientRpc.close()
      },
    }
  }

  /**
   * The gate the `block` branch has and the `exec` branch did not — issue #15.
   *
   * ## What was wrong
   *
   * A node refused to **hand over** a sovereign block and would **compute over it and return
   * the answer** to anyone who asked. `sovereignCids` was consulted in exactly one place, the
   * `block` branch, and every gate on the `exec` path branched on `task.label` — a value the
   * DISPATCHER chooses. `label: 'public'` therefore switched off the capability chain
   * (`capability-authorizer.ts:109` returns before verifying), registered no egress tap, and
   * made `guardSovereignty` a pass-through. The executor then read the CID unconditionally.
   *
   * The attacker also chooses `partitionIndex` / `partitionCount`, so the output can be steered
   * to reveal the input a slice at a time.
   *
   * ## What this case asserts, and why it is aimed HERE
   *
   * At the **refusal**, not at a hold beside it. That distinction is the reason the defect
   * survived: the case below this one performs the same dispatch and asserts
   * `expect(publicReply?.kind).toBe('exec')` — that it goes through — because it is about hold
   * bookkeeping. Read quickly it looks like coverage of this surface; it is a committed
   * demonstration of the opposite. An instrument one degree off the property is how a gap
   * outlives the tree's habit of naming its own gaps.
   *
   * ## The principle
   *
   * The node decides on **a fact it holds** — is this CID in the durable sovereign set — and
   * never on a claim attached to the frame. `agent.ts`'s `block` branch already wrote the
   * reasoning down: *"sovereignty is a property of the bytes, not of whether a job happens to
   * be running over them."* That conclusion was drawn there and not here.
   */
  it('refuses a public exec over a CID the node knows is sovereign', async () => {
    const node = await servingNode({ sovereignInputsHoldsIt: true, keepsSovereignCids: true })
    try {
      const reply = await node.exec({
        moduleCid: node.moduleCid,
        inputCid: node.inputCid,
        partitionIndex: 0,
        partitionCount: 1,
        // The whole attack: a label the sender chose, over bytes the node knows are not theirs.
        label: 'public',
      })

      // An `error` response, not an `exec` outcome. A refusal that arrived as a failed
      // execution would be indistinguishable from a module that happened not to run.
      expect(
        reply?.kind,
        'a public exec naming a CID this node holds in its sovereign set was ADMITTED — the ' +
          'node refuses to hand these bytes over and computed over them instead, which is the ' +
          'same disclosure by a longer route',
      ).toBe('error')
      if (reply?.kind !== 'error') return

      // By name, in the vocabulary the `block` branch already uses for this exact fact, so an
      // operator greps once and finds both.
      expect(reply.reason).toContain('egress refused')
      expect(reply.reason).toContain(node.inputCid.toString())
    } finally {
      node.close()
    }
  })

  /**
   * The paired positive, and it is what stops the case above from passing for the wrong reason.
   *
   * A node that refused every exec would satisfy the refusal perfectly. This one is the same
   * arrangement with one thing changed — a CID the node has NOT recorded as sovereign — and it
   * must still run. Without it the gate could be a blanket refusal and both cases would be green.
   */
  /**
   * The refusal must not cost the node a slot it never gives back.
   *
   * The gate added for #15 returns early, and on this path an early return is not free: the
   * admission table is claimed *above* it and released in a `finally` *below* it, around the
   * executor. A refusal that returns in between is admitted-and-never-released — and
   * `agent.ts` already says in words what that produces, on the very block that hands the slot
   * out: a node "indistinguishable from a working node for exactly `slots` tasks and then
   * refuses everything forever".
   *
   * So the fix for a disclosure defect would have installed a denial-of-service one, reachable
   * by the same stranger, needing nothing but the CID. `maxConcurrent: 1` makes one refused
   * frame enough to prove it.
   *
   * Two readings, because either alone is weak. `inFlight` is the direct one and says the slot
   * is gone the moment the refusal returns. The second dispatch is the consequence, and it is
   * what a node operator would actually see.
   */
  it('gives the admission slot back when it refuses a public exec over sovereign bytes', async () => {
    const capacity = new LocalCapacity({ nodeId: 'server', maxConcurrent: 1 })
    const node = await servingNode({ sovereignInputsHoldsIt: true, keepsSovereignCids: true, capacity })
    try {
      const refused = await node.exec({
        moduleCid: node.moduleCid,
        inputCid: node.inputCid,
        partitionIndex: 0,
        partitionCount: 1,
        label: 'public',
      })
      expect(refused?.kind, 'the refusal under test did not happen, so nothing here is about slots').toBe('error')

      // The consequence first, because it is the reading an operator would actually get, and
      // because a mutant has to be able to reach it: asserted after the slot count, it would
      // never run on any tree where the slot count is already wrong.
      const admitted = await node.exec({
        moduleCid: node.moduleCid,
        inputCid: node.publicInputCid,
        partitionIndex: 0,
        partitionCount: 1,
        label: 'public',
      })
      expect(
        admitted?.kind,
        'a legitimate exec arriving after a refused one was turned away — the node has been ' +
          'shut by its own gate, which is a denial of service a stranger reaches with one frame',
      ).toBe('exec')

      // The direct reading of the same fact, from inside the table.
      expect(
        capacity.inFlight,
        'a slot is still held after this node finished with both frames. Two separate faults ' +
          'reach this line and it was watched failing on each: a gate sited between the offer ' +
          'and the release, and a release removed from the `finally` altogether',
      ).toBe(0)
    } finally {
      node.close()
    }
  })

  /**
   * The same refusal on the frame that withholds its answer.
   *
   * `exec` and `commit` are served from one branch today, so this is green the moment the gate
   * exists — and that is the point of writing it rather than a reason not to. A commit that
   * slipped past the gate would run the module over the owner's bytes and file the answer
   * locally; the requestor then collects it in round two, where `reveal` binds the handle to
   * the peer that committed — which is the attacker. Disclosure in full, one round later.
   *
   * It therefore fails if anyone ever splits the branch and carries only `exec`'s gate across.
   */
  it('refuses a public commit over a CID the node knows is sovereign', async () => {
    const node = await servingNode({ sovereignInputsHoldsIt: true, keepsSovereignCids: true })
    try {
      const reply = await node.commit({
        moduleCid: node.moduleCid,
        inputCid: node.inputCid,
        partitionIndex: 0,
        partitionCount: 1,
        label: 'public',
      })

      expect(
        reply?.kind,
        'a public COMMIT over sovereign bytes was admitted — the module ran over the owner\'s ' +
          'data and the answer is now filed on this node, collectable by the sender in round two',
      ).toBe('error')
      if (reply?.kind !== 'error') return
      expect(reply.reason).toContain('egress refused')
    } finally {
      node.close()
    }
  })

  it('still runs a public exec over a CID it has not recorded as sovereign', async () => {
    const node = await servingNode({ sovereignInputsHoldsIt: false, keepsSovereignCids: true })
    try {
      const reply = await node.exec({
        moduleCid: node.moduleCid,
        inputCid: node.publicInputCid,
        partitionIndex: 0,
        partitionCount: 1,
        label: 'public',
      })
      expect(
        reply?.kind,
        'a public exec over an unregistered CID was refused, so the gate above is a blanket ' +
          'refusal rather than a reading of the sovereign set',
      ).toBe('exec')
    } finally {
      node.close()
    }
  })

  it('is not released by an unrelated public exec naming the same input', async () => {
    const node = await servingNode({ sovereignInputsHoldsIt: true })
    try {
      const label = node.inputCid.toString()
      // A third party declares the payload sovereign for the life of a job, exactly
      // as `submitJobWithEgress` does.
      const jobHold = node.guard.guard(label, await sovereignBytes())

      const publicReply = await node.exec({
        moduleCid: node.moduleCid,
        inputCid: node.inputCid,
        // A different partition, so the admission slot key does not collide and this
        // is admitted alongside anything else in flight for the same input.
        partitionIndex: 1,
        partitionCount: 2,
        label: 'public',
      })
      // **Still `'exec'`, and beside the #15 refusal above that is worth one sentence.**
      // This node is built with `keepsSovereignCids` at its default — it keeps no durable
      // sovereign set — so the gate added for #15 has no fact to read and cannot fire here by
      // construction. It was verified by reading this fixture call, not inferred from the
      // green. A reader who meets the two cases in file order and wonders why one dispatch is
      // refused and the next admitted has the answer in the argument, not in the gate. That
      // arm is tracked as its own open question.
      expect(publicReply?.kind).toBe('exec')

      // The hold the public exec never took is still held.
      expect(node.guard.registrations).toContain(label)

      // …and the payload is therefore still guarded when the sovereign dispatch's
      // reply tries to carry it out.
      const sovereignReply = await node.exec({
        moduleCid: node.moduleCid,
        inputCid: node.inputCid,
        partitionIndex: 0,
        partitionCount: 2,
        label: 'sovereign',
        ownerId: OWNER,
      })
      expect(sovereignReply?.kind).toBe('exec')
      if (sovereignReply?.kind !== 'exec') return
      expect(sovereignReply.outcome.ok).toBe(false)
      if (sovereignReply.outcome.ok) return
      expect(sovereignReply.outcome.reason).toMatch(/^egress refused: /)
      expect(sovereignReply.outcome.reason).toContain(label)
      expect(sovereignReply.outcome.reason).toContain(node.nodeId)
      expect(node.guard.manifest.violations).toContain(label)

      jobHold.release()
      expect(node.guard.registrations).not.toContain(label)
    } finally {
      node.close()
    }
  })

  it('is not released by a sovereign exec whose input is not locally resident', async () => {
    // The adversary-free trigger. Nothing hostile happens: the serving node simply
    // does not hold the bytes in its local-only tier, so it registers nothing — and
    // used to release all the same, stripping the submitter's job-lifetime hold.
    const node = await servingNode({ sovereignInputsHoldsIt: false })
    try {
      const label = node.inputCid.toString()
      node.guard.guard(label, await sovereignBytes())

      await node.exec({
        moduleCid: node.moduleCid,
        inputCid: node.inputCid,
        partitionIndex: 0,
        partitionCount: 1,
        label: 'sovereign',
        ownerId: OWNER,
      })

      expect(node.guard.registrations).toContain(label)
    } finally {
      node.close()
    }
  })
})
