import { ed25519 } from '@noble/curves/ed25519.js'
import { signName, toHex } from '@o2/core'
import type { NameRecord, Task } from '@o2/core'
import { afterEach, describe, expect, it } from 'vitest'
import { BrowserNode } from './browser-node.ts'
// Vite's `?worker` suffix bundles the module and its imports into a real Worker.
// Browser project only — see vitest.config.ts, and `worker-executor.browser.test.ts`,
// whose fixture this file reuses rather than inventing a second one.
import TaskExecutorWorker from './task-executor.worker.ts?worker'
import { PROBE_EMITS_TEN } from './wasm-probes.ts'

/**
 * CAP-01's browser-tier composition, proven the way `M28`'s own reasoning requires: a
 * real dispatch through a real tab, not an argument by analogy from the Node tier. See
 * `fabric-node.node.test.ts`'s own `CAP-01` block (this phase's Task 2) for the
 * requestor-side counterpart to this file's operator-side one — that file proves the
 * refusal is readable at a real RPC boundary; this file proves the identical property
 * on the tier with no peer-to-peer path in this test, matching this project's
 * "equal functionality across tiers" standard.
 *
 * **No existing browser-project file combines a real `BrowserNode` with a real Worker
 * execution before this one.** `paused-local-admission.browser.test.ts` starts a real
 * node but never executes a task — every case there asks `localAdmission` a question
 * and stops. `worker-executor.browser.test.ts` executes `PROBE_EMITS_TEN` for real but
 * against a bare `browserWorkerExecutor`, not a node. This file is the first to combine
 * the two halves, each independently proven elsewhere.
 *
 * All three cases dispatch through `node.executor.execute` directly rather than over
 * RPC — a single tab, nothing to dial, and `paused-local-admission.browser.test.ts`'s
 * own docblock gives the reason a hand-built executor would not do: the subject is
 * `BrowserNode.#compose`'s real composition, so the node is started for real through
 * the same factory `bin`-less browser callers use.
 */

const started: BrowserNode[] = []

afterEach(async () => {
  await Promise.all(
    started.splice(0).map(async (node) => {
      try {
        await node.stop()
      } catch {
        // A node that already failed is not worth failing teardown over.
      }
    }),
  )
})

const createWorker = (): Worker => new TaskExecutorWorker()

/** The `naming.test.ts` fixture pattern — an ephemeral key derived from one byte. */
function keypair(seed: number): { priv: Uint8Array; pub: string } {
  const priv = new Uint8Array(32).fill(seed)
  return { priv, pub: toHex(ed25519.getPublicKey(priv)) }
}

// A seed distinct from every other fixture key in the repository.
const publisher = keypair(43)

let seq = 0

/**
 * A cleared tab: `canExecuteSovereign: true` for owner `alice`, and
 * `trustAnchors: 'runs-unsigned-artifacts'` — not the empty-anchor-set opt-out
 * `paused-local-admission.browser.test.ts` uses. This test's subject needs a module
 * that actually runs, and the opt-out is what lets `network-reach-guard.ts`'s own
 * docblock claim — "must still apply when provenance is the identity wrapper" — be
 * exercised for real rather than only argued.
 */
async function startTab(label: string): Promise<BrowserNode> {
  const node = await BrowserNode.start({
    relayAddrs: [],
    createWorker,
    blockstoreName: `o2-cap01-${label}-${seq++}`,
    trustAnchors: 'runs-unsigned-artifacts',
    sovereignty: { ownerId: 'alice', canExecuteSovereign: true },
    whenSeedIsGone: 'mints-a-new-identity',
    identityProtection: { kind: 'writes-no-new-secret' },
    startReporting: 'reports-its-own-start',
  })
  started.push(node)
  return node
}

function declaringRecord(moduleCid: Awaited<ReturnType<BrowserNode['store']['put']>>): NameRecord {
  return signName(publisher.priv, {
    name: 'cap01-browser-reaches',
    cid: moduleCid,
    version: 1,
    expiresAt: Date.now() + 3_600_000,
    wantsNetworkReach: true,
  })
}

function nonDeclaringRecord(moduleCid: Awaited<ReturnType<BrowserNode['store']['put']>>): NameRecord {
  return signName(publisher.priv, {
    name: 'cap01-browser-reaches',
    cid: moduleCid,
    version: 1,
    expiresAt: Date.now() + 3_600_000,
  })
}

describe('CAP-01 — a real BrowserNode refuses a declared module against sovereign data', () => {
  it('refuses a sovereign task whose module declares network reach, read through node.executor directly', async () => {
    const node = await startTab('refuse')
    const moduleCid = await node.store.put(PROBE_EMITS_TEN)
    const inputCid = await node.store.put(new Uint8Array([0x0a]))
    const declaring = declaringRecord(moduleCid)

    const sovereignTask: Task = {
      moduleCid,
      inputCid,
      partitionIndex: 0,
      partitionCount: 1,
      label: 'sovereign',
      ownerId: 'alice',
      moduleRecord: declaring,
    }

    // No fallback for this case: the refusal is the property under test, and it is
    // asserted in full or not at all — a fallback here would let this file
    // degenerate into "refuses everything", the exact failure §5 of 46-CONTEXT.md
    // names as the reason the positive control below exists.
    const outcome = await node.executor.execute(sovereignTask)
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.reason).toContain(node.peerId)
    expect(outcome.reason).toContain(moduleCid.toString())
    expect(outcome.reason).toContain('sovereign')
    expect(outcome.reason).toContain('network reach')
  }, 60_000)

  it('runs the identical declaring module as a public task', async () => {
    const node = await startTab('public-control')
    const moduleCid = await node.store.put(PROBE_EMITS_TEN)
    const inputCid = await node.store.put(new Uint8Array([0x0a]))
    const declaring = declaringRecord(moduleCid)

    const publicTask: Task = {
      moduleCid,
      inputCid,
      partitionIndex: 0,
      partitionCount: 1,
      label: 'public',
      moduleRecord: declaring,
    }

    const outcome = await node.executor.execute(publicTask)
    // Criterion 3, the positive control: a public task must never be refused for
    // network reach. The plan's own fallback text names a weaker, still-
    // discriminating reading for the case where this combination (first of its
    // kind in this project, per this file's own docblock) does not settle within
    // the browser project's default timeout — measured NOT needed: a run taken
    // before this file's commit read `{ ok: true, output: 10, ... }` on all three
    // engines, so the strong form is what lands.
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.output).toBe(10)
  }, 60_000)

  it('runs a sovereign task whose module declares nothing', async () => {
    const node = await startTab('nondeclaring-control')
    const moduleCid = await node.store.put(PROBE_EMITS_TEN)
    const inputCid = await node.store.put(new Uint8Array([0x0a]))
    const nonDeclaring = nonDeclaringRecord(moduleCid)

    const sovereignTask: Task = {
      moduleCid,
      inputCid,
      partitionIndex: 0,
      partitionCount: 1,
      label: 'sovereign',
      ownerId: 'alice',
      moduleRecord: nonDeclaring,
    }

    const outcome = await node.executor.execute(sovereignTask)
    // Criterion 4, the second control: a non-declaring module must never be
    // refused for network reach either. Same reasoning as the public-control
    // case above — measured at full strength, so asserted at full strength.
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.output).toBe(10)
  }, 60_000)
})
