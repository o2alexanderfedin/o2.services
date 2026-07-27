import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { canonicalCid, encodeCanonical, publicNodes } from '@o2/core'
import type { CanonicalValue } from '@o2/core'
import { RemoteExecutor, submitJobWithEgress } from '@o2/net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
// Test-only relative import — see the note in fabric-node.node.test.ts /
// packages/net/src/distributed.test.ts.
import { MODULE_ECHOES_INPUT, MODULE_WRITES_PARTITION } from '../../core/src/executor/fixtures.ts'
import { FabricNode } from './fabric-node.ts'
import type { FabricNodeOptions } from './fabric-node.ts'

/**
 * Phase 13 — the production-wiring proof for DATA-05/DATA-06.
 *
 * Evidentiary standard: same-process, multiple real `FabricNode.start()` calls
 * over real TCP sockets — accepted per 13-CONTEXT.md's `<specifics>` section
 * ("same-process multi-node tests are sufficient evidence, by this repo's own
 * precedent") and `fabric-node.node.test.ts`'s own DATA-09 test, which makes the
 * identical claim: `startNode` here is the same factory call `bin/agent.ts`
 * makes, not a test-only bypass.
 *
 * **No test in this file calls `guard.guard()` directly.** That is the entire
 * point of this plan. Every violation, or its documented absence, is a
 * consequence of `registerSovereignInputs` (wired into `FabricNode.start` by
 * Plan 13-02) running inside production dispatch — not of a test standing in for
 * an owner's declaration the way `sovereign-execution.test.ts` still does.
 *
 * `registerSovereignInputs` reads from a node's *local-only* blockstore tier
 * (`store`), never the network-fallback tier — a sovereign input is owner-pinned
 * and must already be resident on the owner's own node before dispatch (see
 * `sovereign-egress.ts`'s doc comment on the silent-skip behavior). Every
 * sovereign-labelled test below therefore seeds the row directly onto the
 * executing node's `store` before submitting the job, mirroring
 * `sovereign-execution.test.ts`'s `ownerFabric` helper (`await local.put(...)`)
 * — without that seed, registration is a documented no-op and the tap would have
 * nothing to watch for, which would make a "clean" result meaningless rather
 * than proven.
 */

let workdir: string
const running: FabricNode[] = []

async function startNode(name: string, extra: Partial<FabricNodeOptions> = {}): Promise<FabricNode> {
  const node = await FabricNode.start({
    blockstoreDir: join(workdir, name),
    // Port 0: the OS picks a free port, so concurrent test runs cannot collide.
    listen: ['/ip4/127.0.0.1/tcp/0'],
    rpcTimeoutMs: 20_000,
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

describe('DATA-05 — production registration lets the tap catch a real leak, through the same factory bin/agent.ts uses', () => {
  it('a map step that forgot to aggregate names its own violation, with no test-side guard.guard() call', async () => {
    const [alice, requestor] = await Promise.all([
      startNode('alice', { sovereignty: { ownerId: 'alice', canExecuteSovereign: true } }),
      startNode('requestor'),
    ])
    await requestor.dial(alice.multiaddrs[0]!)

    const moduleCid = await requestor.store.put(MODULE_ECHOES_INPUT)

    // Owner-pinned: the row must already be resident on alice's own local store
    // before dispatch — registerSovereignInputs reads from that local tier only.
    // Computed independently here (not read back off the result below), and the
    // same bytes are what get seeded, so the CID this test asserts against is
    // never trusted from the code under test.
    const inputCid = await canonicalCid(LEAK_ROW)
    if (!inputCid.ok) throw new Error('fixture not encodable')
    await alice.store.put(inputCid.bytes)

    const executors = [new RemoteExecutor(alice.peerId, requestor.rpc)]
    const result = await submitJobWithEgress(
      {
        moduleCid,
        shards: [{ value: LEAK_ROW, label: 'sovereign', ownerId: 'alice' }],
        executors,
        nodes: [{ nodeId: alice.peerId, ownerId: 'alice', canExecuteSovereign: true, load: 0 }],
        redundancy: 1,
      },
      requestor.store,
      [alice.egress],
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    // The task is not refused — it is cleared and runs. The echo module returns
    // the raw input as its output; the tap, not the sovereignty gate, is what
    // must catch this.
    expect(result.job.shards[0]?.verification.status).toBe('agreed')

    expect(result.manifests[0]?.violations).toContain(inputCid.ok ? inputCid.cid.toString() : '<unreachable>')
  }, 30_000)
})

describe("DATA-06 — every job's manifest is reachable from its own result metadata", () => {
  it('a clean pushdown job reports zero violations and a non-empty manifest — never indistinguishable from an unwired tap', async () => {
    const [alice, requestor] = await Promise.all([
      startNode('alice', { sovereignty: { ownerId: 'alice', canExecuteSovereign: true } }),
      startNode('requestor'),
    ])
    await requestor.dial(alice.multiaddrs[0]!)

    const moduleCid = await requestor.store.put(MODULE_WRITES_PARTITION)

    const inputCid = await canonicalCid(CLEAN_ROW)
    if (!inputCid.ok) throw new Error('fixture not encodable')
    await alice.store.put(inputCid.bytes)

    const executors = [new RemoteExecutor(alice.peerId, requestor.rpc)]
    const result = await submitJobWithEgress(
      {
        moduleCid,
        shards: [{ value: CLEAN_ROW, label: 'sovereign', ownerId: 'alice' }],
        executors,
        nodes: [{ nodeId: alice.peerId, ownerId: 'alice', canExecuteSovereign: true, load: 0 }],
        redundancy: 1,
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
    const executors = [new RemoteExecutor(defaultNode.peerId, requestor.rpc)]
    const result = await submitJobWithEgress(
      {
        moduleCid,
        shards: [{ value: { a: 0 }, label: 'public' }],
        executors,
        nodes: publicNodes(executors),
        redundancy: 1,
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
      startNode('alice', { sovereignty: { ownerId: 'alice', canExecuteSovereign: true } }),
      startNode('requestor'),
    ])
    await requestor.dial(alice.multiaddrs[0]!)

    const moduleCid = await requestor.store.put(MODULE_WRITES_PARTITION)

    const inputCid = await canonicalCid(PUSHDOWN_ROW)
    if (!inputCid.ok) throw new Error('fixture not encodable')
    await alice.store.put(inputCid.bytes)

    const executors = [new RemoteExecutor(alice.peerId, requestor.rpc)]
    const result = await submitJobWithEgress(
      {
        moduleCid,
        shards: [{ value: PUSHDOWN_ROW, label: 'sovereign', ownerId: 'alice' }],
        executors,
        nodes: [{ nodeId: alice.peerId, ownerId: 'alice', canExecuteSovereign: true, load: 0 }],
        redundancy: 1,
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
