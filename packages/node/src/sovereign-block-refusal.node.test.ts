import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MemoryNetwork, canonicalCid, decodeCanonical } from '@o2/core'
import type { CanonicalValue, NodeDescriptor } from '@o2/core'
import { EgressGuard, RemoteExecutor, parseRequest, submitJobWithEgress } from '@o2/net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
// Test-only relative import — see the note in packages/net/src/distributed.test.ts.
import { MODULE_WRITES_PARTITION } from '../../core/src/executor/fixtures.ts'
import { OWNER_KEY, chainSupplierFor } from './capability-fixture.ts'
import { FabricNode } from './fabric-node.ts'
import type { FabricNodeOptions } from './fabric-node.ts'

/**
 * DATA-10, ROADMAP criterion 7 — **a submitter mid-job does not serve the row it
 * submitted**, measured byte-for-byte against a tap on the wire between two real
 * `FabricNode`s over TCP on loopback.
 *
 * **What this file proves.** That a node which assembled a job containing a sovereign
 * shard, and never ran a task over it, does not hand the raw row to the peer that asks
 * for the input block — **when the job was submitted through `submitJobWithEgress`**.
 * The claim is checked against every frame that reached the owner, not against an
 * outcome from which what crossed would have to be inferred.
 *
 * As of Phase 15 (AUTH-03) the owner node also verifies a capability chain before it
 * executes anything, so both submits below carry a valid one and the owner is pinned
 * with `ownerKey` to verify it against. That is a precondition this file now has to
 * satisfy, not something it covers — **nothing here asserts on a capability refusal**,
 * and the refusal it measures is still the block branch's.
 *
 * **What it does not prove, in three parts, none of them implied by criterion 7's
 * wording.**
 *
 * 1. It does **not** prove that a node refuses that block **at rest**, after the job
 *    has ended. The registration `submitJobWithEgress` takes is job-scoped: it is given
 *    back in a `finally`, so a peer asking afterwards still receives the raw bytes, and
 *    **that is unmeasured**. Closing it needs a persistent per-node set of sovereign
 *    CIDs that survives the job and the process — `13.1-CONTEXT.md` lists it under
 *    deferred ideas for exactly that reason.
 * 2. It does **not** prove anything about a job submitted through bare `submitJob`.
 *    `submitJob` content-addresses every shard input and `put`s it into the store it
 *    was handed, sovereign ones included, so such a submitter holds the row exactly as
 *    the guarded one does — and registers nothing. **A job submitted through bare
 *    `submitJob` is unguarded, and that is unmeasured.**
 *    `packages/node/src/sovereignty-placement.node.test.ts` is the live example: it
 *    drives a real spawned-agent sovereign scenario that way, it still passes after
 *    this change, and it passes *because* the gap is real, not despite it. The
 *    `submitJob` call-site scan at the bottom of this file is what makes a **new**
 *    production submit path fail loudly rather than quietly inherit the gap.
 * 3. It does **not** prove the browser tier's submitter path — WIRE-03, Phase 19. The
 *    reason recorded here until 2026-07-31, that `BrowserNode.start` *"needs a real
 *    `indexedDB` and a relay, so it runs in neither vitest project"*, was false: the
 *    `e2e` project starts that factory against a live tab
 *    (`packages/node/src/browser-capability.e2e.test.ts`). What is genuinely unproven is
 *    the **submitter** half in a tab — that file dispatches *to* a browser node and
 *    reads what it serves, which is the other direction.
 *
 * What would close (1) and (2) together: registering at a boundary the node owns rather
 * than at one entry point — the submitting node's blockstore-put of a shard labelled
 * sovereign, or a helper both `submitJob` callers share. Criterion 7 is a property of a
 * *node*; what ships here is a property of one *function*.
 *
 * **No test in this file passes `rpcTimeoutMs`.** The production default of 30,000 ms is
 * live and unshortened, for the reason `named-refusal.node.test.ts` states: after Plan
 * 13.1-03 gave the block branch a named refusal, the owner's failed input fetch returns
 * immediately, and a shortened budget would hide a regression to the timeout. Each `it`
 * carries a generous vitest timeout so such a regression reports as a slow pass or a
 * real assertion, never as an opaque runner timeout.
 *
 * `startNode` is the same `FabricNode.start` factory call `bin/agent.ts` makes — no
 * test-only path — and the owner is started with the same `sovereignty` option a real
 * deployment passes through `--owner-id` / `--can-execute-sovereign`.
 */

const OWNER = 'alice'

let workdir: string
const running: FabricNode[] = []

async function startNode(name: string, extra: Partial<FabricNodeOptions> = {}): Promise<FabricNode> {
  const node = await FabricNode.start({
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
 * The row the submitter assembles into a job it never executes.
 *
 * Distinct from every fixture in `egress-manifest.node.test.ts`,
 * `egress-refusal.node.test.ts` and `named-refusal.node.test.ts`, and the reason is the
 * one `egress-refusal.node.test.ts` already records: a shared row would let either
 * file's seeding satisfy the other's assertion, so a failure to seed would be
 * invisible.
 */
const SUBMITTED_ROW: CanonicalValue = {
  ssn: '864-13-2907',
  salary: 132_775,
  dob: '1969-04-30',
  branch: 'south-wharf',
}

beforeEach(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'o2-sovereign-block-'))
})

afterEach(async () => {
  await Promise.all(running.splice(0).map((n) => n.stop().catch(() => {})))
  await rm(workdir, { recursive: true, force: true })
})

/**
 * The `AgentRequest` kinds present among `frames`, in arrival order.
 *
 * The tap's **known positive**. An `exec` request certainly reaches the owner — that is
 * what a dispatch *is* — so finding one proves the handler sits on the live delivery
 * path rather than merely on a live object. Frames that are not requests, or not
 * decodable at all, are skipped rather than reported: the owner receives responses to
 * its own fetches on the same handler.
 */
function requestKinds(frames: readonly Uint8Array<ArrayBuffer>[]): string[] {
  const kinds: string[] = []
  for (const frame of frames) {
    let decoded: CanonicalValue
    try {
      decoded = decodeCanonical(frame)
    } catch {
      continue
    }
    if (decoded === null || typeof decoded !== 'object' || Array.isArray(decoded)) continue
    const record = decoded as { readonly [k: string]: CanonicalValue }
    if (record['k'] !== 'req') continue
    const body = record['body']
    if (body === undefined) continue
    const request = parseRequest(body)
    if (request !== null) kinds.push(request.kind)
  }
  return kinds
}

describe('criterion 7 — the row a node submitted does not leave it while the job runs', () => {
  it('refuses the owner’s input fetch, keeps the raw row off every frame that arrived, records the refusal, and still runs the seeded control', async () => {
    // AUTH-03: `ownerKey` is what the owner node verifies the chain below against.
    // Without it both submits are refused for want of a pinned key, before the block
    // branch this file is about is ever reached.
    const [submitter, owner] = await Promise.all([
      startNode('submitter'),
      startNode('owner', {
        sovereignty: { ownerId: OWNER, ownerKey: OWNER_KEY, canExecuteSovereign: true },
      }),
    ])

    // The tap, on the **raw** transport and not on `owner.egress`, so it sees exactly
    // the bytes that arrived. `EgressGuard.onMessage` delegates straight to its inner
    // transport, so both would see the same frames — which is precisely why "it
    // returned nothing" cannot distinguish a clean wire from an unattached probe, and
    // why the liveness pair below is not optional.
    //
    // Each frame is **copied**: a handler that stored the live buffer would be reading
    // whatever the transport went on to reuse.
    //
    // Registered before the dial, so nothing from the handshake onward is missed.
    const captured: Uint8Array<ArrayBuffer>[] = []
    const stopTap = owner.transport.onMessage((_from, frame) => {
      captured.push(frame.slice())
    })

    try {
      await submitter.dial(owner.multiaddrs[0]!)

      const moduleCid = await submitter.store.put(MODULE_WRITES_PARTITION)
      const row = await canonicalCid(SUBMITTED_ROW)
      if (!row.ok) throw new Error('fixture not encodable')

      // **Unseeded**, and this is the configuration the defect lives in: the owner
      // holds neither the module nor the row, so its `RpcBlockSource` has to ask the
      // submitter for both. Asserted rather than assumed — a store that already held
      // the row would make the refusal below unreachable and the run vacuous.
      expect(await owner.store.has(row.cid)).toBe(false)
      expect(await owner.store.has(moduleCid)).toBe(false)

      const executors = [new RemoteExecutor(owner.peerId, submitter.rpc, chainSupplierFor(owner.peerId))]
      const descriptors: readonly NodeDescriptor[] = [
        { nodeId: owner.peerId, ownerId: OWNER, canExecuteSovereign: true, load: 0, certificate: 'carries-no-certificate' },
      ]

      // `submitJobWithEgress` with the submitter's **own** guard — the same production
      // entry point `bin/bench.ts` and the demo call, not a guard built for the
      // occasion. The module aggregates rather than echoes, so the reply frame cannot
      // carry the row: the only route the raw bytes have across this wire is the input
      // block fetch, which is the route under test.
      const refusedJob = await submitJobWithEgress(
        {
          moduleCid,
          shards: [{ value: SUBMITTED_ROW, label: 'sovereign', ownerId: OWNER }],
          executors,
          nodes: descriptors,
          redundancy: 1,
          onQuorumShortfall: 'runs-at-available-redundancy',
        },
        submitter.store,
        [submitter.egress],
      )

      // The submission itself is valid — nothing here is a malformed job.
      expect(refusedJob.ok).toBe(true)
      if (!refusedJob.ok) return

      // The job fails, and that failure is the intended consequence: a submitter
      // holding another owner's raw row has broken the owner-pinned premise before the
      // fabric is involved, so the fetch that would repair it is refused.
      //
      // Soft, as a group with the byte-level sweep below, for the reason Plan 13.1-01
      // settled on: on the run that matters — a regression — the outcome and the bytes
      // that crossed are two readings of one defect, and asserted hard only the first
      // reaches the report. Watched both ways; the hard version said `expected 'agreed'
      // not to be 'agreed'` and printed nothing about the wire.
      const shard = refusedJob.job.shards[0]
      expect.soft(shard?.verification.status).not.toBe('agreed')
      expect.soft(refusedJob.job.complete).toBe(false)

      // ---- The tap is proved to be capturing, before it is allowed to report an
      // absence. Three readings, in this order, and the third is inadmissible without
      // the first two: an absent instrument and a clean wire produce the identical
      // empty array, and this phase exists because a mechanism's intent was once read
      // as its behaviour.

      // (1) It captured something at all. This is what a handler registered on the
      // wrong object, or after the job, or silently dropped, also fails.
      expect(captured.length).toBeGreaterThan(0)

      // (2) It captured a frame known to have arrived. The `exec` request is that
      // frame — the dispatch cannot have happened without it — so its presence proves
      // the handler is on the live delivery path and not merely on a live object.
      expect(requestKinds(captured)).toContain('exec')

      // (3) The scanner is proved able to read, which is a **different** claim from the
      // tap being connected and is asserted separately because it fails differently. A
      // scratch guard over its own `MemoryNetwork` connection, with the row registered
      // on it, is shown finding that row inside a synthetic frame built as
      // prefix ++ row ++ suffix. That validates `violationIn` — never in doubt, and
      // never evidence about the wire.
      const scanner = new EgressGuard(new MemoryNetwork().connect('tap'), 'tap')
      scanner.guard(row.cid.toString(), row.bytes)
      const planted = new Uint8Array(row.bytes.byteLength + 8)
      planted.set([0xa1, 0x61, 0x70, 0x58], 0)
      planted.set(row.bytes, 4)
      planted.set([0xff, 0xff, 0xff, 0xff], row.bytes.byteLength + 4)
      expect(scanner.violationIn(planted)).toBe(row.cid.toString())

      // ---- Only now, the measurement: the raw row appears in no frame that arrived.
      // The failure message carries both sizes, so a regression reproduces the
      // roadmap's own reading — "95 raw bytes inside a 138-byte block-response frame"
      // — rather than merely reporting that something was found. It did reproduce it,
      // watched with the registration removed: `frame 3 of 3: 63 raw bytes inside a
      // 106-byte frame`, the same shape at this file's own fixture size.
      const carriedTheRow = (): string[] =>
        captured
          .map((frame, index) => ({ index, label: scanner.violationIn(frame) }))
          .filter(({ label }) => label !== null)
          .map(
            ({ index, label }) =>
              `frame ${index + 1} of ${captured.length}: ${row.bytes.byteLength} raw bytes ` +
              `inside a ${captured[index]?.byteLength ?? 0}-byte frame — ${label ?? ''}`,
          )
      expect.soft(carriedTheRow()).toEqual([])
      const framesBeforeControl = captured.length

      // A refusal that stopped the bytes and left no record would satisfy the sweep
      // above and must not pass. The submitter's own job-scoped manifest names the
      // label, paired with a non-empty reading so a manifest that recorded nothing at
      // all cannot stand in for one that recorded a refusal.
      const manifest = refusedJob.manifests[0]
      expect.soft(manifest?.violations).toContain(row.cid.toString())
      expect
        .soft(manifest?.entries.some((entry) => entry.violation === row.cid.toString()))
        .toBe(true)
      expect(manifest?.entries.length).toBeGreaterThan(0)

      // The registration is job-scoped and was given back, so the submitter's guard
      // does not grow with every job it runs. This is also the reading that makes
      // point (1) of this file's header concrete: with nothing held, a peer asking for
      // this block now would be served it.
      expect(submitter.egress.registrations).toEqual([])

      // ---- The control, in the same test and ordered **after** the refusal. One that
      // ran first would leave "the owner died during the refused job" standing as an
      // explanation for the failure above. Same two nodes, same module, same owner id,
      // same untouched 30 s budget; the only thing that changes is that the owner now
      // holds the row, which is what "sovereign" is supposed to mean.
      // `canonicalCid`'s own bytes, so the CID this test asserts against is never read
      // back off the code under test.
      const seeded = await owner.store.put(row.bytes)
      expect(seeded.toString()).toBe(row.cid.toString())

      const control = await submitJobWithEgress(
        {
          moduleCid,
          shards: [{ value: SUBMITTED_ROW, label: 'sovereign', ownerId: OWNER }],
          executors,
          nodes: descriptors,
          redundancy: 1,
          onQuorumShortfall: 'runs-at-available-redundancy',
        },
        submitter.store,
        [submitter.egress],
      )

      expect(control.ok).toBe(true)
      if (!control.ok) return
      expect(control.job.shards[0]?.verification.status).toBe('agreed')
      expect(control.job.complete).toBe(true)

      // A clean manifest and an absent one must not look alike — 13-CONTEXT.md
      // decision 3, unchanged. The delta slice is per job, so the refusal recorded
      // above is outside this window by construction.
      const controlManifest = control.manifests[0]
      expect(controlManifest?.violations).toEqual([])
      expect(controlManifest?.entries.length).toBeGreaterThan(0)
      expect(submitter.egress.registrations).toEqual([])

      // The sweep once more, now over everything that arrived across both jobs. The
      // seeded configuration moves no raw bytes either — an `exec` request frame carries
      // CIDs, not bytes — which is the reading Phase 13 recorded on both taps and which
      // this run reproduces on the wire rather than restating. Non-vacuous: more frames
      // arrived during the control than had arrived before it, so this is a sweep over
      // new evidence and not a repeat of the same array.
      expect(captured.length).toBeGreaterThan(framesBeforeControl)
      expect(carriedTheRow()).toEqual([])
    } finally {
      stopTap()
    }
  }, 120_000)
})

/**
 * The entry-point guard.
 *
 * Criterion 7 states a property of a *node*; this plan delivers a property of one
 * *function*. That gap has to be visible and has to fail loudly if it widens, so this
 * scan pins the set of production files that call bare `submitJob`. A fourth file
 * entering it is a new production submit path that `submitJobWithEgress`'s registration
 * does not cover — the submitter would hold the row and be unguarded, and that would be
 * unmeasured. Written in the idiom `bench-egress.node.test.ts` uses for `bin/bench.ts`'s
 * call sites, and guarded against a mis-rooted scan the way `vocabulary.node.test.ts`
 * guards its own.
 */

const ROOT = fileURLToPath(new URL('../../..', import.meta.url))

/** The three files that may call bare `submitJob`, and what each one is. */
const SUBMIT_CALL_SITES: readonly { readonly file: string; readonly role: string }[] = [
  { file: 'packages/core/src/job/submit.ts', role: 'the definition itself' },
  {
    file: 'packages/net/src/submit-with-egress.ts',
    role: 'the guarded wrapper — the one path that registers a sovereign shard',
  },
  {
    file: 'packages/core/src/executor/task-worker.ts',
    role: "the in-worker caller, which hard-codes label:'public' shards into a MemoryBlockstore",
  },
]

/**
 * Strips `//` line comments and block comments before matching.
 *
 * Load-bearing for the same reason `bench-egress.node.test.ts` gives: several of these
 * files *name* bare `submitJob` in their own prose — `submit-with-egress.ts`'s module
 * comment and `bin/bench.ts`'s `runnerFor` doc both do — so a raw-text match could be
 * satisfied by a description of a call site rather than by one.
 *
 * Regex-based, so a comment opener inside a string literal would be treated as opening
 * a comment. The failure direction is the safe one: over-stripping can only hide a real
 * call site, which drops a file out of the found set and fails this scan loudly.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, '')
}

/**
 * Every tracked, non-test TypeScript source under `packages/`.
 *
 * `git ls-files` rather than a directory walk, for `vocabulary.node.test.ts`'s reason:
 * it excludes `node_modules`, `dist` and everything gitignored for free, and it matches
 * what a reader of the repository sees. `.d.ts` is excluded — an ambient declaration
 * calls nothing.
 */
function trackedProductionSources(): readonly string[] {
  return execFileSync('git', ['ls-files', '-z', 'packages'], { cwd: ROOT, encoding: 'utf8' })
    .split('\0')
    .filter(
      (path) => path.endsWith('.ts') && !path.endsWith('.test.ts') && !path.endsWith('.d.ts'),
    )
}

/** The files in `files` containing a bare `submitJob(` call, sorted. */
function filesCallingSubmitJob(files: readonly string[]): string[] {
  return files
    .filter((file) => /\bsubmitJob\s*\(/.test(stripComments(readFileSync(join(ROOT, file), 'utf8'))))
    .sort()
}

describe('the scope of the guard — one entry point, not the node — is pinned by a source scan', () => {
  const sources = trackedProductionSources()

  it('scanned the repository it claims to have scanned', () => {
    // Anti-vacuity, and it is not decoration: every assertion below is of the form
    // "exactly these files", which a scan that found nothing at all would also
    // satisfy for two of the three files by coincidence of an empty set. A mis-rooted
    // `git ls-files` returns nothing and would otherwise pass silently.
    expect(sources.length).toBeGreaterThan(50)
    expect(sources).toContain('packages/net/src/agent.ts')
    expect(sources).toContain('packages/node/src/fabric-node.ts')
    expect(sources).toContain('packages/browser/demo/main.ts')
    for (const { file } of SUBMIT_CALL_SITES) expect(sources).toContain(file)
  })

  it('finds bare submitJob in exactly the three files that may call it', () => {
    const expected = SUBMIT_CALL_SITES.map(({ file }) => file).sort()
    const found = filesCallingSubmitJob(sources)
    const unexpected = found.filter((file) => !expected.includes(file))
    expect(
      unexpected.map(
        (file) =>
          `${file} calls bare submitJob. That is a new production submit path, and ` +
          "submitJobWithEgress's sovereign registration does not cover it — a submitter " +
          'using it holds the raw row and is unguarded, and that is unmeasured. Either ' +
          'route it through submitJobWithEgress, or move the registration to a boundary the ' +
          "node owns. See 13.1-04-PLAN.md's `## Out of scope`.",
      ),
    ).toEqual([])
    // Both directions: a call site that *disappeared* is equally a change of scope,
    // and `toEqual` on the whole set is what catches it.
    expect(found).toEqual(expected)
  })

  it('can report a new call site, and is not satisfied by prose describing one', () => {
    // The scan is only worth having if it has been watched reporting something. Both
    // halves are planted, because they fail differently: a real call must be found, and
    // the same text inside a comment must not be.
    expect(/\bsubmitJob\s*\(/.test(stripComments('const r = await submitJob(spec, store)'))).toBe(
      true,
    )
    expect(
      /\bsubmitJob\s*\(/.test(
        stripComments('// this used to call submitJob(spec, store) before the wrapper existed'),
      ),
    ).toBe(false)
    expect(
      /\bsubmitJob\s*\(/.test(stripComments('/* await submitJob(spec, store) */ const r = 1')),
    ).toBe(false)
    // And the name is matched on a word boundary, so the wrapper's own call is not
    // mistaken for a bare one — which is what makes the three-file set meaningful.
    expect(
      /\bsubmitJob\s*\(/.test(stripComments('await submitJobWithEgress(spec, store, [guard])')),
    ).toBe(false)
  })
})
