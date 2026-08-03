import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { canonicalCid, encodeCanonical, publicNodes } from '@o2/core'
import type { CanonicalValue, NodeDescriptor } from '@o2/core'
import { RemoteExecutor, submitJobWithEgress } from '@o2/net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
// Test-only relative import — see the note in fabric-node.node.test.ts /
// packages/net/src/distributed.test.ts.
import { MODULE_ECHOES_INPUT, MODULE_WRITES_PARTITION } from '../../core/src/executor/fixtures.ts'
import { OWNER_KEY, chainSupplierFor } from './capability-fixture.ts'
import { FabricNode } from './fabric-node.ts'
import type { FabricNodeOptions } from './fabric-node.ts'

/**
 * Phase 13 — the production-wiring proof for DATA-05/DATA-06.
 *
 * **Why this file is in-process, stated plainly rather than borrowed.** Every
 * test here reads the *owner's own* `EgressGuard` manifest, and there is no
 * vantage point outside this process from which that is readable: `protocol.ts`
 * carries no manifest message, and `bin/agent.ts` prints an address line and
 * nothing else. Holding alice's `FabricNode` in the test process is therefore
 * not a shortcut around a process boundary — it is the only place the tap's own
 * record exists as a value at all. What this file proves is the *mechanism*: the
 * refusal is recorded on the owner's tap, and the shard fails because of it.
 *
 * The matching claim about a real operating-system process boundary — that the
 * *consequence* of the refusal is observable from a submitter talking to two
 * spawned `bin/agent.ts` processes — is carried by `egress-refusal.node.test.ts`
 * and is not asserted here. Neither file is asked to prove the other's half, and
 * neither should be read as if it did.
 *
 * `startNode` is the same `FabricNode.start` factory call `bin/agent.ts` makes —
 * no test-only path — so the wiring exercised here is the wiring a deployed
 * agent gets.
 *
 * **No test in this file calls `guard.guard()` directly.** That is the entire
 * point of this plan. Every violation, or its documented absence, is a
 * consequence of `takeSovereignHold` (wired into `FabricNode.start` by
 * Plan 13-02) running inside production dispatch — not of a test standing in for
 * an owner's declaration the way `sovereign-execution.test.ts` still does.
 *
 * `takeSovereignHold` reads from a node's *local-only* blockstore tier
 * (`store`), never the network-fallback tier — a sovereign input is owner-pinned
 * and must already be resident on the owner's own node before dispatch (see
 * `sovereign-egress.ts`'s doc comment on the silent-skip behavior). Every
 * sovereign-labelled test below therefore seeds the row directly onto the
 * executing node's `store` before submitting the job, mirroring
 * `sovereign-execution.test.ts`'s `ownerFabric` helper (`await local.put(...)`)
 * — without that seed, registration is a documented no-op and the tap would have
 * nothing to watch for, which would make a "clean" result meaningless rather
 * than proven.
 *
 * As of Phase 15 (AUTH-03) the serving node also verifies a capability chain before it
 * executes anything, so every sovereign dispatch in this file now carries one and each
 * alice node is pinned with `ownerKey: OWNER_KEY` to verify it against. The properties
 * this file measures — the refusal, the manifest, the release arithmetic — are
 * unchanged by that; the chain is a precondition these tests now have to satisfy, not
 * something they cover. **Nothing here asserts on a capability refusal**, and this file
 * should not be read as evidence for AUTH-03. The `requestor` nodes need no owner key:
 * they submit, they do not serve sovereign work.
 */

let workdir: string
const running: FabricNode[] = []

async function startNode(name: string, extra: Partial<FabricNodeOptions> = {}): Promise<FabricNode> {
  const node = await FabricNode.start({
    blockstoreDir: join(workdir, name),
    // Port 0: the OS picks a free port, so concurrent test runs cannot collide.
    listen: ['/ip4/127.0.0.1/tcp/0'],
    rpcTimeoutMs: 20_000,
    // DET-03: this file's subject is not provenance, and every dispatch in it is
    // in-process on the node being configured. Stated rather than defaulted — the
    // point of the field being required is that a reader counting this literal learns
    // which tests do not exercise the signed path. No job here carries a
    // `moduleRecord`: a node running with the opt-out has no guard to satisfy.
    trustAnchors: 'runs-unsigned-artifacts',
    ...extra,
  })
  running.push(node)
  return node
}

/** Alice's sovereign row for the falsification test. Distinctive bytes so a match means something. */
const LEAK_ROW: CanonicalValue = { ssn: '123-45-6789', salary: 87_000, dob: '1984-02-29' }

/** A different row for the clean-pushdown test, so no test's fixture leaks into another's assertions. */
const CLEAN_ROW: CanonicalValue = { ssn: '555-00-1234', salary: 61_500, dob: '1991-07-15' }

/** Multi-field, larger than MODULE_WRITES_PARTITION's fixed 8-byte output — for the pushdown comparison. */
const PUSHDOWN_ROW: CanonicalValue = {
  ssn: '246-80-1357',
  salary: 118_250,
  dob: '1978-03-22',
  notes: 'quarterly deduction review pending sign-off',
}

beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'o2-egress-'))
})

afterEach(async () => {
  await Promise.all(running.splice(0).map((n) => n.stop().catch(() => {})))
  await rm(workdir, { recursive: true, force: true })
})

describe('DATA-05 — the tap refuses the leaking frame, so the shard fails where it stands', () => {
  it('fails the cross-owner shard at its owner, does not relocate it, and carries the refusal on the owner’s own manifest', async () => {
    // Three nodes. Alice is cleared for herself. The second is started with no
    // sovereignty option at all — the way any node starts, before anyone has
    // told it whose data it may touch.
    //
    // The requestor gets a shortened RPC budget. **Amended 2026-07-29 by NET-10:**
    // this used to say the dispatch resolved only when the requestor's own timeout
    // fired, which made the shortened budget load-bearing. It does not now —
    // `serveAgent` substitutes a small named refusal for a reply that would carry
    // the registered payload, so the refused dispatch resolves with a reason
    // instead of at the budget's expiry. 5 s stays because the control job at the
    // bottom runs on this identical budget through these identical nodes and must
    // not fail for want of time. Nothing here measures wall-clock; the wall-clock
    // measurement, against the unshortened production default, is
    // `named-refusal.node.test.ts`'s subject.
    const [alice, other, requestor] = await Promise.all([
      startNode('alice', {
        sovereignty: { ownerId: 'alice', ownerKey: OWNER_KEY, canExecuteSovereign: true },
      }),
      startNode('other'),
      startNode('requestor', { rpcTimeoutMs: 5_000 }),
    ])
    await Promise.all([
      requestor.dial(alice.multiaddrs[0]!),
      requestor.dial(other.multiaddrs[0]!),
    ])

    const moduleCid = await requestor.store.put(MODULE_ECHOES_INPUT)

    // Owner-pinned: the row must already be resident on alice's own local store
    // before dispatch — takeSovereignHold reads from that local tier only.
    // Computed independently here (not read back off the result below), and the
    // same bytes are what get seeded, so the CID this test asserts against is
    // never trusted from the code under test.
    const inputCid = await canonicalCid(LEAK_ROW)
    if (!inputCid.ok) throw new Error('fixture not encodable')
    await alice.store.put(inputCid.bytes)

    const executors = [
      new RemoteExecutor(alice.peerId, requestor.rpc, chainSupplierFor(alice.peerId)),
      new RemoteExecutor(other.peerId, requestor.rpc, chainSupplierFor(other.peerId)),
    ]

    // Both descriptors say `canExecuteSovereign: true`, and the loads are
    // inverted on purpose — alice saturated, the other node completely idle.
    // This is `sovereignty-placement.node.test.ts`'s arrangement and it is
    // deliberate, not an oversight: with clearance held equal and load pointing
    // the other way, ownership is the *only* thing left that can exclude the
    // idle node. Do not "fix" this descriptor.
    const descriptors: readonly NodeDescriptor[] = [
      { nodeId: alice.peerId, ownerId: 'alice', canExecuteSovereign: true, load: 1, certificate: 'carries-no-certificate' },
      { nodeId: other.peerId, ownerId: 'bob', canExecuteSovereign: true, load: 0, certificate: 'carries-no-certificate' },
    ]

    const result = await submitJobWithEgress(
      {
        moduleCid,
        shards: [{ value: LEAK_ROW, label: 'sovereign', ownerId: 'alice' }],
        executors,
        nodes: descriptors,
        redundancy: 1,
        onQuorumShortfall: 'runs-at-available-redundancy',
      },
      requestor.store,
      [alice.egress],
    )

    // Submission itself is valid — nothing here is a malformed job.
    expect(result.ok).toBe(true)
    if (!result.ok) return

    // The task is not refused by the sovereignty gate: alice is cleared and the
    // echo module runs. What fails is the reply frame, because it carries the
    // raw input back out. `insufficient` is executeVerified's verdict when every
    // selected executor failed, which is exactly what a refused reply produces.
    const shard = result.job.shards[0]
    expect(shard?.verification.status).toBe('insufficient')
    expect(shard?.verification.status).not.toBe('agreed')
    expect(result.job.complete).toBe(false)
    if (shard?.verification.status !== 'insufficient') return

    // What this rules out: a refusal is not retried onto somebody else. Exactly
    // one failure, and it names alice — the idle non-owner sitting in the same
    // job, flagged able to execute sovereign work, never runs it. Nor could it
    // if something tried: `eligibleNodes` narrows a sovereign shard to its
    // owner's nodes before load is consulted at all, and `executeVerified` runs
    // each selected executor once with no retry and no re-placement. A refusal
    // stalls the shard where it stands rather than moving the same leak on.
    expect(shard.verification.failures).toHaveLength(1)
    expect(shard.verification.failures[0]?.nodeId).toBe(alice.peerId)
    expect(shard.verification.failures.map((failure) => failure.nodeId)).not.toContain(other.peerId)

    // What *these* rule out: an `insufficient` shard on its own is
    // indistinguishable from a peer that was unreachable, asleep, or dead. Only
    // the owner's own recorded refusal makes the failure attributable to the tap
    // — and reading it requires holding alice's node in this process, which is
    // the whole reason this half of the proof is in-process.
    const manifest = result.manifests[0]
    expect(manifest?.violations).toContain(inputCid.cid.toString())
    expect(manifest?.entries.some((entry) => entry.violation === inputCid.cid.toString())).toBe(true)
    expect(manifest?.entries.length).toBeGreaterThan(0)

    // The refused path is an exit like any other, and it is the one a naive
    // implementation leaks: a release that only ran when the send succeeded would
    // leave this label held forever. Growth here is a real ceiling on how long a
    // node can serve — every registration it never gives back is scanned against
    // every frame it ever sends afterwards — and this assertion is the only thing
    // that makes that a failure rather than a slow leak nobody measures. It names
    // the label, so a failure says what leaked.
    expect(alice.egress.registrations).toEqual([])

    // The control, and it runs *after* the refusal on purpose: one that ran
    // first would leave "alice died during the refused dispatch" standing as an
    // explanation. Same two running nodes, same sovereign row and owner, same
    // descriptors, same guard, same 5 s budget — the only thing that changes is
    // whether the reply carries the registered payload. Reaching `agreed` here
    // says alice is alive, her socket works, her module fetch works, and the
    // budget was never the constraint.
    const aggregatingCid = await requestor.store.put(MODULE_WRITES_PARTITION)
    const control = await submitJobWithEgress(
      {
        moduleCid: aggregatingCid,
        shards: [{ value: LEAK_ROW, label: 'sovereign', ownerId: 'alice' }],
        executors,
        nodes: descriptors,
        redundancy: 1,
        onQuorumShortfall: 'runs-at-available-redundancy',
      },
      requestor.store,
      [alice.egress],
    )

    expect(control.ok).toBe(true)
    if (!control.ok) return
    expect(control.job.shards[0]?.verification.status).toBe('agreed')
    expect(control.job.complete).toBe(true)

    const controlManifest = control.manifests[0]
    expect(controlManifest?.violations).toEqual([])
    // Never asserted alone: an unwired tap reads zero violations exactly as
    // readily as a genuinely clean job does.
    expect(controlManifest?.entries.length).toBeGreaterThan(0)

    // And on the path where the reply *did* leave. Two jobs have now run against
    // this one guard, so this reading also rules out the arithmetic failure the
    // refused job above cannot see on its own: a release that ran once too few
    // would show up here as the second job's label still held.
    expect(alice.egress.registrations).toEqual([])
  }, 60_000)
})

describe("DATA-06 — every job's manifest is reachable from its own result metadata", () => {
  it('a clean pushdown job reports zero violations and a non-empty manifest — never indistinguishable from an unwired tap', async () => {
    const [alice, requestor] = await Promise.all([
      startNode('alice', {
        sovereignty: { ownerId: 'alice', ownerKey: OWNER_KEY, canExecuteSovereign: true },
      }),
      startNode('requestor'),
    ])
    await requestor.dial(alice.multiaddrs[0]!)

    const moduleCid = await requestor.store.put(MODULE_WRITES_PARTITION)

    const inputCid = await canonicalCid(CLEAN_ROW)
    if (!inputCid.ok) throw new Error('fixture not encodable')
    await alice.store.put(inputCid.bytes)

    const executors = [new RemoteExecutor(alice.peerId, requestor.rpc, chainSupplierFor(alice.peerId))]
    const result = await submitJobWithEgress(
      {
        moduleCid,
        shards: [{ value: CLEAN_ROW, label: 'sovereign', ownerId: 'alice' }],
        executors,
        nodes: [{ nodeId: alice.peerId, ownerId: 'alice', canExecuteSovereign: true, load: 0, certificate: 'carries-no-certificate' }],
        redundancy: 1,
        onQuorumShortfall: 'runs-at-available-redundancy',
      },
      requestor.store,
      [alice.egress],
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.job.shards[0]?.verification.status).toBe('agreed')

    const manifest = result.manifests[0]
    expect(manifest?.violations).toEqual([])
    // Not a vacuous pass: alice genuinely sent frames — fetching the module from
    // requestor and returning the partition result. An absent tap would read
    // entries.length === 0 exactly as readily as a genuinely clean job would,
    // which is why this assertion is never made alone (the empty-manifest trap,
    // 13-CONTEXT.md decision 3 / sovereign-execution.test.ts:339,503's idiom).
    expect(manifest?.entries.length).toBeGreaterThan(0)
    expect(manifest?.totalBytes).toBeGreaterThan(0)
  }, 30_000)

  it('a public job also gets a genuine, non-empty manifest from a node with default, unopted-in sovereignty', async () => {
    const [defaultNode, requestor] = await Promise.all([startNode('default'), startNode('requestor')])
    await requestor.dial(defaultNode.multiaddrs[0]!)

    const moduleCid = await requestor.store.put(MODULE_WRITES_PARTITION)
    const executors = [new RemoteExecutor(defaultNode.peerId, requestor.rpc, 'dispatches-unauthenticated')]
    const result = await submitJobWithEgress(
      {
        moduleCid,
        shards: [{ value: { a: 0 }, label: 'public' }],
        executors,
        nodes: publicNodes(executors),
        redundancy: 1,
        onQuorumShortfall: 'runs-at-available-redundancy',
      },
      requestor.store,
      [defaultNode.egress],
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.job.shards[0]?.verification.status).toBe('agreed')

    const manifest = result.manifests[0]
    expect(manifest?.violations).toEqual([])
    expect(manifest?.entries.length).toBeGreaterThan(0)
    expect(manifest?.totalBytes).toBeGreaterThan(0)
  }, 30_000)

  it("a pushdown job's manifest reflects only the aggregate that crossed, smaller than the raw sovereign input", async () => {
    const [alice, requestor] = await Promise.all([
      startNode('alice', {
        sovereignty: { ownerId: 'alice', ownerKey: OWNER_KEY, canExecuteSovereign: true },
      }),
      startNode('requestor'),
    ])
    await requestor.dial(alice.multiaddrs[0]!)

    const moduleCid = await requestor.store.put(MODULE_WRITES_PARTITION)

    const inputCid = await canonicalCid(PUSHDOWN_ROW)
    if (!inputCid.ok) throw new Error('fixture not encodable')
    await alice.store.put(inputCid.bytes)

    const executors = [new RemoteExecutor(alice.peerId, requestor.rpc, chainSupplierFor(alice.peerId))]
    const result = await submitJobWithEgress(
      {
        moduleCid,
        shards: [{ value: PUSHDOWN_ROW, label: 'sovereign', ownerId: 'alice' }],
        executors,
        nodes: [{ nodeId: alice.peerId, ownerId: 'alice', canExecuteSovereign: true, load: 0, certificate: 'carries-no-certificate' }],
        redundancy: 1,
        onQuorumShortfall: 'runs-at-available-redundancy',
      },
      requestor.store,
      [alice.egress],
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const shard = result.job.shards[0]
    expect(shard?.verification.status).toBe('agreed')
    if (shard?.verification.status !== 'agreed') return

    const manifest = result.manifests[0]
    expect(manifest?.violations).toEqual([])
    expect(manifest?.entries.length).toBeGreaterThan(0)

    const rawEncoded = encodeCanonical(PUSHDOWN_ROW)
    if (!rawEncoded.ok) throw new Error('fixture not encodable')
    const outputEncoded = encodeCanonical(shard.verification.output)
    if (!outputEncoded.ok) throw new Error('output not encodable')
    // DATA-07/criterion 3: what left the node is a partial smaller than the raw
    // sovereign input it was computed from — the pushdown claim, now proven
    // through submitJobWithEgress's own manifest rather than a hand-called guard.
    expect(outputEncoded.bytes.length).toBeLessThan(rawEncoded.bytes.length)
  }, 30_000)
})
