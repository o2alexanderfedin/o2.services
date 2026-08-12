import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ed25519 } from '@noble/curves/ed25519.js'
import {
  DEFAULT_FANOUT,
  EnrollmentAuthority,
  canonicalCid,
  decodeCanonical,
  deriveReduceTree,
  executeReduce,
  fabricCombiner,
  requestEnrollment,
  toHex,
  verifyCombineAttestation,
} from '@o2/core'
import type { CanonicalValue, PublicKeyHex, ReduceContribution, ResultSigner } from '@o2/core'
import { remoteCombineDispatch, serveAgent } from '@o2/net'
import { CID } from 'multiformats/cid'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FabricNode } from './fabric-node.ts'

/**
 * VER-08 / VER-09 / VER-10 — the **aggregation** is signed, and a stranger can check it.
 *
 * `PROJECT.md` states this project's split as *the owner's contribution is trusted; the
 * aggregation over contributions is verified*. Plan 19-13 signed `exec` results only,
 * which left a map/reduce job ending with signed map results feeding an **unsigned
 * aggregation** — precisely the half claimed to be the verified one. This file is the
 * reading that the other half now holds.
 *
 * ## What is being measured, stated before anything else because it is easy to fake
 *
 * **The verification is done by a stranger.** `verifyCombineAttestation` is called with
 * the **provider's published public key** as the only trust input, the input CIDs this
 * requestor asked for, and the result CID it was told. **No peer id, no connection, no
 * certificate lifted out of the attestation, nothing taken from this requestor's own
 * state.** A spec that reached for a handy local value — the issuer named *inside* the
 * certificate being checked, most temptingly — would pass every run and prove nothing,
 * because a self-issued certificate satisfies it. That variant was written and run
 * deliberately during this plan; see the summary. The trusted-issuer set here is derived
 * from the provider's seed and from nothing else.
 *
 * ## What a pass establishes, and what it does not
 *
 * It establishes that a node **this provider certified** performed *this* aggregation
 * over *these* partials, in *this* order, and produced *that* result — and that the
 * statement is checkable by somebody who was not present for any of it.
 *
 * It establishes **nothing about whether the aggregation is arithmetically right**. A
 * signature on a wrong aggregate is a signed wrong aggregate, signed just as convincingly
 * as a right one. Correctness remains `executeReduce`'s redundancy and its
 * `disagreements` arm, exactly as a signed `exec` result is not a correct one.
 *
 * ## The boundary this file crosses, named precisely rather than overclaimed
 *
 * **Real transport, not a real process**, and the reason is a dependency rather than a
 * shortcut. Every `serveAgent` call site in the tree currently states
 * `attest: 'signs-nothing'` — Plan 19-15 replaces the two production factories' with real
 * signers, and until it does, a spawned `bin/agent.ts` cannot sign. So this file follows
 * its plan's stated preference and constructs the signer itself: three real
 * `FabricNode`s over tcp + noise + yamux, with this file re-installing `serveAgent` on
 * each combining node's own endpoint carrying a real identity. Everything between the
 * signature and its verification is real — the challenge, the DAG-CBOR encode, the wire,
 * the parse, the Ed25519 verify, and the certificate the provider actually signed.
 *
 * What is therefore **not** established here is that the production factory wires this
 * hook. That is Plan 19-15's, for both verbs at once, and it owns
 * `trust-anchors.node.test.ts`'s composition guard as well.
 *
 * ## The cost, in prose, deliberately without a wall clock
 *
 * One Ed25519 sign per combine on the producing node, over a challenge whose size
 * depends on how many inputs were named and not on how large they are; and one Ed25519
 * verify per combine on the requestor, which is two to three times the cost of a sign.
 * The reply grows by one certificate — 612 DAG-CBOR bytes, the figure measured for the
 * `exec` reply and identical here because it is the same encoder. **No wall-clock
 * assertion exists in this file and none should be added.**
 *
 * Node-only: real TCP listeners and a real temporary blockstore directory.
 */

/** The provider. Its public half is the only trust input the verification is given. */
const PROVIDER_SEED = new Uint8Array(32).fill(60)
const PROVIDER_KEY: PublicKeyHex = toHex(ed25519.getPublicKey(PROVIDER_SEED))
/** A provider this requestor has never pinned — the exclusion arm. */
const STRANGER_SEED = new Uint8Array(32).fill(61)
/** The user who consents to each enrolment. Not the subject of anything here. */
const USER_SEED = new Uint8Array(32).fill(62)

/**
 * The pinned set, built from the provider's **published** key.
 *
 * Not from `attestation.certificate.issuer`, which is the mistake that would make every
 * case below unfalsifiable.
 */
const PINNED: ReadonlySet<PublicKeyHex> = new Set([PROVIDER_KEY])

/** Leaves, and therefore three combines at the default fanout: two at level 1, one above. */
const PARTIALS = 8

let workdir: string
const running: FabricNode[] = []

/** A node certificate issued by `issuerSeed`, over a fresh node seed. */
function enrol(seed: number, issuerSeed: Uint8Array = PROVIDER_SEED): ResultSigner {
  const nodeSeed = new Uint8Array(32).fill(seed)
  const issued = new EnrollmentAuthority({
    providerPrivateKey: issuerSeed,
    maxIssuedPerWindow: 'issues-without-an-aggregate-budget',
    issuance: 'remembers-only-within-this-process',
  }).enrol(
    requestEnrollment(nodeSeed, USER_SEED, {
      operatorId: `operator-${seed}`,
      discoverability: 'via-relay',
      relayIds: [],
    }),
    Date.now(),
  )
  if (!issued.ok) throw new Error(`fixture failed to enrol: ${issued.reason}`)
  return { nodeSeed, certificate: issued.certificate }
}

async function startNode(name: string): Promise<FabricNode> {
  const node = await FabricNode.start({
    relayAdmission: 'admits-any-peer',
    startReporting: 'reports-its-own-start',
    blockstoreDir: join(workdir, name),
    // Port 0: the OS picks a free port, so concurrent runs cannot collide.
    listen: ['/ip4/127.0.0.1/tcp/0'],
    rpcTimeoutMs: 20_000,
    // DET-03. Nothing in this file runs a guest module — the combine verb runs the
    // fabric's own `fabricCombiner` — so there is no signed artifact to check.
    trustAnchors: 'runs-unsigned-artifacts',
  })
  running.push(node)
  return node
}

/**
 * Give a running node a signing identity, by re-installing its request handler.
 *
 * **This is what stands in for Plan 19-15, and it is deliberately narrow.** The node's
 * own executor, blockstore and admission counters are handed straight back, so the
 * combine branch runs against exactly what the factory built; only the signing identity
 * is this file's. `egress` takes the sentinel rather than the node's real guard because
 * nothing here is labelled sovereign and a combine has no egress hold to give back
 * anyway — see `runCombine`'s header in `agent.ts`.
 */
function giveIdentity(node: FabricNode, signer: ResultSigner): void {
  serveAgent({
    paused: 'never-pauses',
    rpc: node.rpc,
    executor: node.executor,
    blockstore: node.blockstore,
    capacity: node.admission,
    attest: signer,
    authorize: 'serves-unauthenticated',
    egress: 'holds-no-registrations',
    index: 'serves-no-records',
    enroll: 'issues-no-certificates',
    ledger: 'keeps-no-ledger',
    reservations: 'relays-for-nobody',
    onDispatch: 'reports-no-dispatch',
  })
}

/** One owner's local summary over their own rows. Distinct per index. */
function partialFor(index: number): CanonicalValue {
  const counts: { [k: string]: number } = {}
  for (let i = 0; i < 3; i++) counts[`word${(index + i) % 5}`] = index + i + 1
  return { counts, rows: index + 1 }
}

beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'o2-combine-signature-'))
})

afterEach(async () => {
  await Promise.all(running.splice(0).map((n) => n.stop().catch(() => {})))
  await rm(workdir, { recursive: true, force: true })
})

/**
 * Stand up a requestor and two combining nodes, and write the leaves at the requestor.
 *
 * Three nodes rather than the nine `tree-reduce-agents.node.test.ts` runs, because the
 * question here is what a combining node *says* and two of them is enough to ask it —
 * the count that file needs is a property of churn repair, which this file does not
 * measure.
 */
async function standUp(signers: readonly ResultSigner[]) {
  const requestor = await startNode('requestor')
  const workers = await Promise.all(signers.map((_, i) => startNode(`w${i}`)))
  for (const [i, worker] of workers.entries()) {
    giveIdentity(worker, signers[i] as ResultSigner)
  }

  // Outward dials, so each worker can fetch a leaf from the one node that holds it.
  const dialed = await Promise.all(workers.map((w) => requestor.dial(w.multiaddrs[0] as string)))
  expect([...dialed].sort()).toEqual(workers.map((w) => w.peerId).sort())

  const contributions: ReduceContribution[] = []
  for (let i = 0; i < PARTIALS; i++) {
    const hashed = await canonicalCid(partialFor(i))
    if (!hashed.ok) throw new Error('a fixture partial will not canonicalise')
    // The requestor's LOCAL tier, so its own `serveAgent` answers a block request for it.
    await requestor.store.put(hashed.bytes)
    contributions.push({ contributorId: `owner-${i}`, cid: hashed.cid })
  }

  const tree = deriveReduceTree(contributions, DEFAULT_FANOUT)
  // A two-level tree, asserted rather than assumed: a single-level one would leave the
  // level-2 combine — whose inputs are other combines' outputs — unmeasured.
  expect(tree.depth).toBe(2)
  expect(tree.nodes.length).toBe(3)

  return { requestor, workers, tree, executorIds: workers.map((w) => w.peerId) }
}

/**
 * The input CIDs of a tree node, **in merge order** — never sorted.
 *
 * `resolved` maps a child id to the address its value ended up at: a leaf resolves to its
 * own CID, an internal node to whatever the combine that produced it returned. This
 * mirrors `executeReduce`'s own resolution, which is what the signature is over.
 */
function inputsOf(
  node: { readonly children: readonly string[] },
  resolved: ReadonlyMap<string, string>,
): readonly CID[] {
  return node.children.map((child) => {
    const address = resolved.get(child)
    if (address === undefined) throw new Error(`no address resolved for ${child}`)
    return CID.parse(address)
  })
}

describe('VER-08/09/10 — every combine in a real tree carries its producer’s signature', () => {
  it('verifies against the provider’s public key alone, for every combine in the tree', async () => {
    const signers = [enrol(11), enrol(12)]
    const { requestor, tree, executorIds } = await standUp(signers)

    const outcome = await executeReduce({
      tree,
      executors: executorIds,
      dispatch: remoteCombineDispatch({ rpc: requestor.rpc, blockstore: requestor.store }),
    })

    // Read before anything else, so a run in which the reduce quietly failed cannot
    // satisfy the signature assertions by having nothing to check.
    expect(outcome.ok).toBe(true)
    expect(outcome.failed).toEqual([])
    expect(outcome.combines).toBe(tree.nodes.length)
    expect(outcome.attestations.size).toBe(tree.nodes.length)

    // The aggregate is the one a single process would have produced. Not the subject of
    // this file, and asserted anyway: a signature over a wrong answer is what this file
    // is careful to say it cannot detect, so the answer being right has to come from
    // somewhere, and here it is the reference.
    const reference = await canonicalCid(
      fabricCombiner(Array.from({ length: PARTIALS }, (_, i) => partialFor(i))),
    )
    if (!reference.ok) throw new Error('the reference will not canonicalise')
    expect(outcome.rootCid).toBe(reference.cid.toString())

    // Rebuild what each combine merged, from this requestor's own tree and its own
    // record of where each value landed. Nothing here is taken from an attestation.
    const resolved = await resolveTree(tree, requestor)
    expect(resolved.get(tree.rootId)).toBe(outcome.rootCid)

    for (const node of tree.nodes) {
      const attested = outcome.attestations.get(node.id)
      expect(attested).toBeDefined()
      if (attested === undefined) continue
      // Not the sentinel: a node holding an identity made a real statement.
      expect(attested).not.toBe('signed-by-nobody')

      const inputs = inputsOf(node, resolved)
      const result = CID.parse(resolved.get(node.id) as string)
      const checked = verifyCombineAttestation(attested, inputs, result, PINNED, Date.now())
      expect(checked.ok).toBe(true)
      if (!checked.ok) throw new Error(`combine ${node.id} did not verify: ${checked.reason}`)

      // The signer is one of the two this provider certified, and the requestor's own
      // record of who answered agrees with it — two independent accounts of the same
      // event, which is the point of `executedBy` and `attestations` being separate.
      expect(signers.map((s) => s.certificate.nodeKey)).toContain(checked.certificate.nodeKey)
      expect(checked.certificate.issuer).toBe(PROVIDER_KEY)
      expect(outcome.executedBy.get(node.id)).toBeDefined()
    }

    // **The order is signed, not the set.** The level-2 combine merges two values whose
    // addresses differ, so reversing them is a merge that did not happen — and the
    // statement must not stand for it.
    const top = tree.nodes.find((node) => node.level === 2)
    if (top === undefined) throw new Error('no level-2 combine in this tree')
    const topAttested = outcome.attestations.get(top.id)
    if (topAttested === undefined || topAttested === 'signed-by-nobody') {
      throw new Error('the level-2 combine carried no statement')
    }
    const reversed = verifyCombineAttestation(
      topAttested,
      [...inputsOf(top, resolved)].reverse(),
      CID.parse(resolved.get(top.id) as string),
      PINNED,
      Date.now(),
    )
    expect(reversed.ok).toBe(false)
    if (reversed.ok) return
    expect(reversed.failure.kind).toBe('bad-result-signature')
  }, 60_000)

  it('refuses a signer no trusted provider certified, naming the issuer and not the signature', async () => {
    // The signature here is **fine** — this node signed correctly with a key its own
    // provider certified. The only thing wrong is that this requestor never pinned that
    // provider, and saying `bad-result-signature` would accuse a peer of forging while
    // the real answer is the reader's own trust configuration.
    const { requestor, tree, executorIds } = await standUp([enrol(21, STRANGER_SEED)])

    const outcome = await executeReduce({
      tree,
      executors: executorIds,
      dispatch: remoteCombineDispatch({ rpc: requestor.rpc, blockstore: requestor.store }),
    })
    expect(outcome.ok).toBe(true)

    const resolved = await resolveTree(tree, requestor)

    const first = tree.nodes[0] as { id: string; children: readonly string[] }
    const attested = outcome.attestations.get(first.id)
    if (attested === undefined || attested === 'signed-by-nobody') {
      throw new Error('the combine carried no statement, so the exclusion arm reads nothing')
    }
    const checked = verifyCombineAttestation(
      attested,
      inputsOf(first, resolved),
      CID.parse(resolved.get(first.id) as string),
      PINNED,
      Date.now(),
    )
    expect(checked.ok).toBe(false)
    if (checked.ok) return
    expect(checked.failure.kind).toBe('untrusted-certificate')
    if (checked.failure.kind !== 'untrusted-certificate') return
    expect(checked.failure.failure.kind).toBe('untrusted-issuer')
  }, 60_000)

  it('does not let one combine’s statement stand for another’s, on real frames', async () => {
    // Both statements came off the wire from real nodes, so this is a reading about what
    // was signed rather than about two objects a test built. The two level-1 combines
    // merge disjoint leaf sets, and the requestor holds both statements.
    const { requestor, tree, executorIds } = await standUp([enrol(31), enrol(32)])

    const outcome = await executeReduce({
      tree,
      executors: executorIds,
      dispatch: remoteCombineDispatch({ rpc: requestor.rpc, blockstore: requestor.store }),
    })
    expect(outcome.ok).toBe(true)

    const resolved = await resolveTree(tree, requestor)

    const level1 = tree.nodes.filter((node) => node.level === 1)
    expect(level1.length).toBe(2)
    const left = level1[0]
    const right = level1[1]
    if (left === undefined || right === undefined) throw new Error('two level-1 combines expected')
    const leftAttested = outcome.attestations.get(left.id)
    if (leftAttested === undefined || leftAttested === 'signed-by-nobody') {
      throw new Error('the first combine carried no statement')
    }

    // It stands for its own merge…
    expect(
      verifyCombineAttestation(
        leftAttested,
        inputsOf(left, resolved),
        CID.parse(resolved.get(left.id) as string),
        PINNED,
        Date.now(),
      ).ok,
    ).toBe(true)

    // …and for nothing else. The signature kind here and not the issuer kind: the
    // certificate is perfectly good and this provider issued it — the statement simply
    // is not about this merge.
    const crossed = verifyCombineAttestation(
      leftAttested,
      inputsOf(right, resolved),
      CID.parse(resolved.get(right.id) as string),
      PINNED,
      Date.now(),
    )
    expect(crossed.ok).toBe(false)
    if (crossed.ok) return
    expect(crossed.failure.kind).toBe('bad-result-signature')
  }, 60_000)
})

/**
 * Every tree node's address, resolved bottom-up from the bytes the requestor holds.
 *
 * **Recomputed here rather than taken from a reply**, and that is the point. A combine's
 * output is a pure function of its inputs, so the requestor can derive what each node's
 * value *must* be from blocks resident in its own store — which is the only source that
 * makes the verification a stranger's. Reading an address out of the attestation being
 * checked would be checking a statement against itself.
 *
 * It also asserts residency as it goes: `remoteCombineDispatch` fetches each combine's
 * result back before it resolves, and a tree deeper than one level only works because of
 * that. If a block is missing here, the reduce above did something other than what its
 * own outcome claimed.
 */
async function resolveTree(
  tree: { readonly leaves: readonly { readonly id: string; readonly cid: string }[]; readonly nodes: readonly { readonly id: string; readonly children: readonly string[]; readonly level: number }[] },
  requestor: FabricNode,
): Promise<ReadonlyMap<string, string>> {
  const resolved = new Map<string, string>(tree.leaves.map((leaf) => [leaf.id, leaf.cid]))
  const maxLevel = tree.nodes.reduce((max, node) => Math.max(max, node.level), 0)
  for (let level = 1; level <= maxLevel; level++) {
    for (const node of tree.nodes.filter((candidate) => candidate.level === level)) {
      const inputs: CanonicalValue[] = []
      for (const child of node.children) {
        const address = resolved.get(child)
        if (address === undefined) throw new Error(`no address resolved for ${child}`)
        const bytes = await requestor.store.get(CID.parse(address))
        if (bytes === undefined) throw new Error(`the requestor does not hold ${address}`)
        inputs.push(decodeCanonical(bytes))
      }
      const hashed = await canonicalCid(fabricCombiner(inputs))
      if (!hashed.ok) throw new Error('a recomputed combine will not canonicalise')
      // The requestor holds what the producing node returned, which is what makes the
      // level above reachable at all.
      expect(await requestor.store.has(hashed.cid)).toBe(true)
      resolved.set(node.id, hashed.cid.toString())
    }
  }
  return resolved
}
