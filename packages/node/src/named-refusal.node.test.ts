import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { canonicalCid, submitJob } from '@o2/core'
import type { CanonicalValue, NodeDescriptor } from '@o2/core'
import { RemoteExecutor, encodeRequest, parseResponse } from '@o2/net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
// Test-only relative import — see the note in packages/net/src/distributed.test.ts.
import { MODULE_ECHOES_INPUT, MODULE_WRITES_PARTITION } from '../../core/src/executor/fixtures.ts'
import { OWNER_KEY, chainSupplierFor } from './capability-fixture.ts'
import { FabricNode } from './fabric-node.ts'
import type { FabricNodeOptions } from './fabric-node.ts'

/**
 * NET-10, ROADMAP criterion 6 — a sovereignty refusal reaches the requestor as a
 * **named outcome**, not as an RPC timeout, measured against two real
 * `FabricNode`s over TCP on loopback.
 *
 * **No test in this file passes `rpcTimeoutMs`, and that omission is the
 * measurement.** `DEFAULT_RPC_TIMEOUT_MS` is 30,000 ms, and every other test in
 * this repository that touches the refusal path shortens it —
 * `egress-refusal.node.test.ts` picks 10 s and explains why in six lines,
 * `egress-manifest.node.test.ts` picks 5 s — because under the old behaviour the
 * wait dominated the run. That is precisely how a 30 s cost stayed invisible. This
 * file does the opposite on purpose: the production budget is live and unshortened,
 * so a refusal arriving in a small fraction of it cannot be an artifact of a budget
 * somebody shortened to make the suite bearable. Those other files' choices remain
 * right for what they measure — a cross-process job outcome, and a manifest — and
 * neither is asked to carry this.
 *
 * Each `it` carries a generous vitest timeout for the same reason. A regression to
 * the timeout behaviour must report as the elapsed assertion below carrying its
 * number, not as an opaque runner timeout that says nothing about what was
 * measured.
 *
 * `startNode` is the same `FabricNode.start` factory call `bin/agent.ts` makes —
 * no test-only path — and the owner is started with the same `sovereignty` option a
 * real deployment passes through `--owner-id` / `--owner-key` /
 * `--can-execute-sovereign`.
 *
 * The `--owner-key` half is Phase 15's (AUTH-03): the serving node now verifies a
 * capability chain before it executes anything, so the dispatch below carries a valid
 * one and alice is pinned to the key that verifies it. **The refusal this file
 * measures is still the egress one and nothing else** — with no chain, alice would
 * refuse first for want of a pinned key, which is a named refusal too and a completely
 * different one. Only the criterion-6 block dispatches a task; the criterion-7 block
 * below issues a raw block request and never reaches an authorizer, which is why its
 * own alice node is left unpinned.
 */

let workdir: string
const running: FabricNode[] = []

async function startNode(name: string, extra: Partial<FabricNodeOptions> = {}): Promise<FabricNode> {
  const node = await FabricNode.start({
    relayAdmission: 'admits-any-peer',
    startReporting: 'reports-its-own-start',
    blockstoreDir: join(workdir, name),
    // Port 0: the OS picks a free port, so concurrent test runs cannot collide.
    listen: ['/ip4/127.0.0.1/tcp/0'],
    // Deliberately no `rpcTimeoutMs` — see this file's header.
    // DET-03: this file's subject is the wording of a refusal that is not a
    // provenance refusal, and every dispatch in it is in-process on the node being
    // configured. Stated rather than defaulted — the point of the field being
    // required is that a reader counting this literal learns which tests do not
    // exercise the signed path. No job here carries a `moduleRecord`.
    trustAnchors: 'runs-unsigned-artifacts',
    ...extra,
  })
  running.push(node)
  return node
}

/**
 * Alice's row, distinct from every fixture in `egress-manifest.node.test.ts` and
 * `egress-refusal.node.test.ts`.
 *
 * Deliberately not shared, for the reason the latter already records: if two files
 * used one row, either file's seeding could satisfy the other's assertion, and a
 * failure to seed would be invisible.
 */
const OWNED_ROW: CanonicalValue = {
  ssn: '418-60-7723',
  salary: 96_400,
  dob: '1983-09-17',
  branch: 'east-quay',
}

/** A block the owner holds and is free to serve — the positive control for the refusal. */
const PUBLIC_ROW: CanonicalValue = { region: 'east-quay', quarter: 'Q2', headcount: 19 }

/**
 * The budget both timing assertions below exist to distinguish themselves from.
 *
 * Neither test passes `rpcTimeoutMs`, so the live bound is `DEFAULT_RPC_TIMEOUT_MS`.
 * Restated here rather than imported because the point is that nothing configured it:
 * an import would read as though the test had set it.
 */
const LIVE_RPC_BUDGET_MS = 30_000

/**
 * What "long before the budget does" is measured against.
 *
 * The property is not "the refusal is fast". It is **"the refusal is not that budget
 * expiring"**, and the only thing that has to hold for it is a figure unambiguously
 * below 30 s. This was `1_000` — a 30x proxy that says the same thing with more margin
 * than the claim needs, and margin costs nothing until it does: on 2026-07-31, with an
 * unrelated LLVM build holding this host at a load average of 130 on 8 cores, the run
 * measured 2815 ms. Still 10x under the budget, so the property held perfectly well and
 * the proxy failed anyway.
 *
 * A third of the budget keeps the discriminator unambiguous — an expiry cannot arrive
 * three times early — while surviving a host three times slower than the one that
 * broke the old figure. A regression that made the refusal genuinely slow would have to
 * clear 10 s to hide here, and at that point it is the reason strings above, not this
 * line, that say whether a refusal was named.
 */
const NOT_AN_EXPIRY_MS = LIVE_RPC_BUDGET_MS / 3

beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'o2-named-refusal-'))
})

afterEach(async () => {
  await Promise.all(running.splice(0).map((n) => n.stop().catch(() => {})))
  await rm(workdir, { recursive: true, force: true })
})

describe('criterion 6 — the refusal is named, and it arrives long before the budget does', () => {
  it('fails a leaking sovereign job by name in a fraction of the live 30 s budget, records it on the owner’s own tap, and still serves a control job', async () => {
    // AUTH-03: `ownerKey` is what alice verifies the chain below against. Without it
    // she refuses for want of a pinned key, before her tap is consulted — which would
    // leave this test measuring the wrong named refusal.
    const [alice, submitter] = await Promise.all([
      startNode('alice', {
        sovereignty: { ownerId: 'alice', ownerKey: OWNER_KEY, canExecuteSovereign: true },
      }),
      startNode('submitter'),
    ])
    await submitter.dial(alice.multiaddrs[0]!)

    // Owner-pinned, made literal: `takeSovereignHold` reads the node's
    // local-only tier and runs before execution, so an input that is not already
    // on alice's disk registers nothing and the tap has nothing to watch for —
    // which would make a "clean" run prove nothing. The CID is computed here from
    // the same bytes that are seeded, never read back off the code under test.
    const input = await canonicalCid(OWNED_ROW)
    if (!input.ok) throw new Error('fixture not encodable')
    const seeded = await alice.store.put(input.bytes)
    expect(seeded.toString()).toBe(input.cid.toString())

    // Only the submitter holds the modules, so alice pulls whichever one she needs
    // over the wire — the round trip is inside the measured window, which makes the
    // elapsed reading below an over-estimate of the refusal's own cost rather than
    // an under-estimate.
    const echoCid = await submitter.store.put(MODULE_ECHOES_INPUT)
    const aggregateCid = await submitter.store.put(MODULE_WRITES_PARTITION)

    const executors = [new RemoteExecutor(alice.peerId, submitter.rpc, chainSupplierFor(alice.peerId))]
    const descriptors: readonly NodeDescriptor[] = [
      { nodeId: alice.peerId, ownerId: 'alice', canExecuteSovereign: true, load: 0, certificate: 'carries-no-certificate' },
    ]

    const started = performance.now()
    const leaking = await submitJob(
      {
        moduleCid: echoCid,
        shards: [{ value: OWNED_ROW, label: 'sovereign', ownerId: 'alice' }],
        executors,
        nodes: descriptors,
        redundancy: 1,
        onQuorumShortfall: 'runs-at-available-redundancy',
      },
      submitter.store,
    )
    const elapsed = performance.now() - started

    expect(leaking.ok).toBe(true)
    if (!leaking.ok) return
    const shard = leaking.job.shards[0]
    expect(shard?.verification.status).toBe('insufficient')
    if (shard?.verification.status !== 'insufficient') return
    expect(shard.verification.failures).toHaveLength(1)

    const failure = shard.verification.failures[0]
    // Soft, as a group: asserted hard, only the first to fail reaches the report,
    // and on the run that matters — a regression — the reason string and the
    // elapsed figure are two readings of the same defect and both belong in the
    // output. The idiom Plan 13.1-01 settled on for paired evidence.
    //
    // Named: the violated label, and the node that refused. Before this change the
    // reason was `dispatch to <peer> failed: rpc to <peer> timed out after
    // 30000ms` — no label, no attribution beyond the destination.
    expect.soft(failure?.reason.startsWith('egress refused: ')).toBe(true)
    expect.soft(failure?.reason).toContain(input.cid.toString())
    expect.soft(failure?.reason).toContain(alice.peerId)
    // The measurement. `rpcTimeoutMs` was never passed, so the live budget is
    // `DEFAULT_RPC_TIMEOUT_MS` = 30,000 ms; a whole job completing well inside a
    // third of that cannot be the budget expiring. See `NOT_AN_EXPIRY_MS`.
    expect.soft(elapsed).toBeLessThan(NOT_AN_EXPIRY_MS)

    // Recorded on alice's own tap as well as reported to the requestor — read
    // in-process, which is the only vantage point from which a node's manifest
    // exists as a value at all. The refusal moved earlier; it did not stop being
    // recorded.
    const manifest = alice.egress.manifest
    expect(manifest.violations).toContain(input.cid.toString())
    expect(manifest.entries.some((entry) => entry.violation === input.cid.toString())).toBe(true)
    // Paired with a non-empty reading, so a manifest that recorded nothing at all
    // cannot pass as one that recorded a refusal.
    expect(manifest.entries.length).toBeGreaterThan(0)

    // The registration is given back even though the reply was refused: the
    // substituted frame still travels the `afterSent` path.
    expect(alice.egress.registrations).toEqual([])

    // The control, ordered after the refusal on purpose — one that ran first would
    // leave "alice died during the refused dispatch" standing as an explanation.
    // Same row, same owner, same node, same untouched 30 s budget; the module is
    // the only argument that changes.
    const control = await submitJob(
      {
        moduleCid: aggregateCid,
        shards: [{ value: OWNED_ROW, label: 'sovereign', ownerId: 'alice' }],
        executors,
        nodes: descriptors,
        redundancy: 1,
        onQuorumShortfall: 'runs-at-available-redundancy',
      },
      submitter.store,
    )
    expect(control.ok).toBe(true)
    if (!control.ok) return
    expect(control.job.shards[0]?.verification.status).toBe('agreed')
    expect(control.job.complete).toBe(true)
    expect(alice.egress.registrations).toEqual([])
  }, 90_000)
})

describe('criterion 7 — a block request for registered bytes is answered, not left hanging', () => {
  it('answers a registered block with a named refusal in a fraction of the live budget, while an unregistered block is still served', async () => {
    const [alice, peer] = await Promise.all([
      startNode('alice', { sovereignty: { ownerId: 'alice', canExecuteSovereign: true } }),
      startNode('peer'),
    ])
    await peer.dial(alice.multiaddrs[0]!)

    const owned = await canonicalCid(OWNED_ROW)
    const shareable = await canonicalCid(PUBLIC_ROW)
    if (!owned.ok || !shareable.ok) throw new Error('fixture not encodable')
    await alice.store.put(owned.bytes)
    await alice.store.put(shareable.bytes)

    // **The registration is placed directly here, and the scope of that matters.**
    // What is under test is the block branch's *answer* when a registration is
    // held — not where the registration came from. Production's own registration
    // is job-scoped: the serve path takes it before execution and
    // `serveAgent`'s `afterSent` gives it back, so no production path holds one at
    // rest for a later block request to find. 13.1-CONTEXT.md lists refusing a
    // sovereign block at rest, indefinitely, under deferred ideas — it needs a
    // persistent per-node set of sovereign CIDs that survives the job and the
    // process. Nothing here implies that was closed.
    alice.egress.guard(owned.cid.toString(), owned.bytes)

    const startedRefusal = performance.now()
    const refused = parseResponse(
      await peer.rpc.request(alice.peerId, encodeRequest({ kind: 'block', cid: owned.cid })),
    )
    const refusalMs = performance.now() - startedRefusal

    expect(refused?.kind).toBe('error')
    if (refused?.kind !== 'error') return
    expect.soft(refused.reason.startsWith('egress refused: ')).toBe(true)
    expect.soft(refused.reason).toContain(owned.cid.toString())
    expect.soft(refused.reason).toContain(alice.peerId)
    // Same measurement as criterion 6, on the other branch: against the untouched
    // 30 s default, an answer well inside a third of it is an answer, not an expiry.
    expect.soft(refusalMs).toBeLessThan(NOT_AN_EXPIRY_MS)

    // The positive control, on the same node over the same connection. Without it
    // "the refusal fired" would be indistinguishable from alice having stopped
    // answering block requests at all.
    const served = parseResponse(
      await peer.rpc.request(alice.peerId, encodeRequest({ kind: 'block', cid: shareable.cid })),
    )
    expect(served?.kind).toBe('block')
    if (served?.kind !== 'block') return
    expect(served.bytes).toEqual(shareable.bytes)

    // And the refusal is on alice's own tap, with its label, exactly as a
    // send-time refusal would have been.
    const manifest = alice.egress.manifest
    expect(manifest.violations).toEqual([owned.cid.toString()])
    expect(manifest.entries.length).toBeGreaterThan(1)
    expect(manifest.totalBytes).toBeGreaterThan(0)
  }, 90_000)
})
