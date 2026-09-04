import { afterEach, describe, expect, it } from 'vitest'
import { pausedRefusal } from '@o2/net'
import { BrowserNode } from './browser-node.ts'
// Vite's `?worker` suffix bundles the module and its imports into a real Worker.
// Browser project only — see vitest.config.ts, and `start-unwind.browser.test.ts`,
// whose start options this file copies rather than invents.
import TaskExecutorWorker from './task-executor.worker.ts?worker'
import type { Admission, Offer } from '@o2/core'

/**
 * SCHED-03 / RUN-02 — a paused tab refuses **its own** work, from a live node.
 *
 * ## The gap this closes, measured rather than supposed
 *
 * Phase 36 moved the local path onto {@link BrowserNode.localAdmission}, which folds
 * `paused` into the one reading every local path takes. Its executor then reported that
 * severing that fold left **58/58 unit tests green and `tsc --noEmit` at exit 0**. Both
 * halves of that are explained by what was in the tree:
 *
 * - `BrowserNodeOptions.paused` is **optional** (`browser-node.ts`, `readonly paused?:
 *   () => boolean`), so the type checker has nothing to say about an option that stops
 *   being read.
 * - Every guard that names the wiring reads **source text**.
 *   `serve-agent-hooks.node.test.ts` counts `const paused = options.paused` and the
 *   `paused,` line; `colouring-surface.node.test.ts` pins the exact demo line
 *   `admit: rpcAdmission(node.rpc, { local: node.localAdmission }),`. A count of literals
 *   is not a measurement of behaviour, and this file is the behaviour.
 *
 * Nothing anywhere ran a paused node and asked it about its own shard.
 *
 * ## The plant this file must survive, and the one it is blind to
 *
 * **Survives (this file's own statement of what it is for):** delete the `paused` fold
 * from `localAdmission` in `BrowserNode.#compose` — that is, make `would` delegate
 * straight to `admission.would(offer)`. Expected text:
 * `expected { accepted: true, … } to have property "accepted" with value false`, from
 * *refuses an offer this tab addressed to itself while paused*. The runtime-toggle case and the
 * discriminator below go red with it, so three cases carry the plant rather than one.
 *
 * **Blind to:** deleting `paused,` from the `serveAgent({ … })` call. That is the peer
 * reader, and no test inside a page can drive it: `serveAgent` installs its handler
 * through `RpcEndpoint.serve`, which stores it in a private field, and the only way in is
 * an inbound frame from a peer — which a tab listening on `/p2p-circuit` and `/webrtc`
 * with `relayAddrs: []` has no way to receive. Saying so is the point; a green nobody
 * watched fail is worse than a gap somebody reported. That plant is carried by two other
 * instruments, and it is worth naming both because they are different kinds:
 *
 * - `AgentOptions.paused` is **required** — `packages/net/src/agent.ts:533`,
 *   `readonly paused: PauseState`, no `?`. So the deletion is a type error, not a silent
 *   behaviour change. This is the backstop `BrowserNodeOptions.paused` does not have.
 * - `serve-agent-hooks.node.test.ts` additionally requires exactly one `paused,` line in
 *   this factory, so a caller that resolved the option for its local path and left the
 *   peer path unwired reddens there.
 *
 * ## Why a real node rather than a hand-built `localAdmission`
 *
 * Rebuilding the fold inside the test would measure the test. The subject is
 * `BrowserNode.#compose`'s composition, so the node is started for real —
 * `browser-node-contract.node.test.ts` records that the factory needs a real `indexedDB`,
 * which is why this is a browser-project file and not a Node-project one, and
 * `start-unwind.browser.test.ts` shows `relayAddrs: []` is enough to get one up.
 *
 * Browser-only: real `indexedDB`, a real `document`, a real Worker.
 */

const started: BrowserNode[] = []
let seq = 0

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

/**
 * DET-03 — **`[]`, not the opt-out**, and the difference is the point.
 *
 * No node here executes anything: every case asks `localAdmission` a question and stops, so
 * provenance decides nothing and the opt-out here would not be a decision this file makes.
 * That word exists to cost somebody one, on `relayed-budget.node.test.ts`'s reasoning. An
 * empty anchor set is the accurate statement instead — this tab trusts nobody and refuses
 * every module — and it leaves `guardModuleProvenance` composed rather than swapped for the
 * identity wrapper `browser-node.ts` substitutes when the opt-out is passed. If a later case
 * adds a dispatch it fails loudly, rather than quietly running something unsigned.
 *
 * Stated rather than defaulted because `trustAnchors` is required and carries no default.
 */
const ADMISSION_ANCHORS = [] as const

/** Start a tab with a `paused` thunk, or without one when `paused` is omitted. */
async function startTab(label: string, paused?: () => boolean): Promise<BrowserNode> {
  const node = await BrowserNode.start({
    relayAddrs: [],
    createWorker,
    blockstoreName: `o2-paused-${label}-${seq++}`,
    trustAnchors: ADMISSION_ANCHORS,
    whenSeedIsGone: 'mints-a-new-identity',
    // AUTH-06 — this file's subject is local admission under a `paused` thunk, not
    // persistence: every case takes a fresh store name and never restarts one. The truthful
    // value for a tab that is thrown away is that it writes no secret at all.
    identityProtection: { kind: 'writes-no-new-secret' },
    startReporting: 'reports-its-own-start',
    ...(paused === undefined ? {} : { paused }),
  })
  started.push(node)
  return node
}

/**
 * An offer addressed to the tab itself.
 *
 * `nodeId` is the tab's own id because that is the only offer `localAdmission` is ever
 * asked about: `rpcAdmission` takes its local branch exactly when
 * `offer.nodeId === rpc.localId`, and hands the offer through unchanged.
 */
function ownOffer(node: BrowserNode, shardId: string): Offer {
  return { shardId, nodeId: node.rpc.localId }
}

/** Narrow at the boundary, so a refusal's fields are read rather than cast. */
function refusalOf(admission: Admission): {
  readonly reason: string
  readonly standing: string
  readonly capacity: Admission['capacity']
} {
  if (admission.accepted) {
    throw new Error('this offer was accepted; there is no refusal to read')
  }
  return { reason: admission.reason, standing: admission.standing, capacity: admission.capacity }
}

describe('a paused tab declines its own work through localAdmission', () => {
  it('refuses an offer this tab addressed to itself while paused, in pausedAnswer two claims', async () => {
    const node = await startTab('true', () => true)

    const slots = node.admission.slots
    const inFlight = node.admission.inFlight
    const answer = node.localAdmission.would(ownOffer(node, 'shard-0'))

    expect(answer.accepted).toBe(false)
    const refusal = refusalOf(answer)

    // The sentence a requestor actually reads, composed in one place. Compared against
    // `pausedRefusal(nodeId)` rather than against a second copy of the string: the wire
    // form and the composed form cannot then diverge. `rpc.localId` is
    // `libp2p.peerId.toString()` (`libp2p-transport.ts:307`), which is the same value
    // `#compose` closes over as `nodeId`.
    expect(refusal.reason).toBe(pausedRefusal(node.rpc.localId))
    // The decision travels beside the string rather than inside it, and nothing in this
    // repository branches control flow on a reason.
    expect(refusal.standing).toBe('declining-all-work')

    // **Capacity published UNCHANGED, and this is the half most likely to be "fixed"
    // wrongly.** The figures say *my capabilities have not shrunk*; the standing says
    // *and I am not taking work anyway*. A refusal reporting zero slots would be a node
    // claiming to have shrunk — a different and false statement, and one a requestor's
    // headroom map reads as such.
    expect(refusal.capacity).toEqual({ slots, inFlight })
    expect(slots).toBeGreaterThan(0)
  }, 60_000)

  it('admits an offer this tab addressed to itself when the thunk says it is not paused', async () => {
    const node = await startTab('false', () => false)
    expect(node.localAdmission.would(ownOffer(node, 'shard-0')).accepted).toBe(true)
  }, 60_000)

  it('admits an offer this tab addressed to itself when no pause control was wired at all', async () => {
    // The named opt-out arm: `options.paused ?? 'never-pauses'`. A tab whose visitor was
    // never given a pause control must be byte-identical in behaviour to the tab that
    // existed before the option did. Without this case, a fold that refused everything
    // unconditionally would still satisfy the case above's sibling.
    const node = await startTab('absent')
    expect(node.localAdmission.would(ownOffer(node, 'shard-0')).accepted).toBe(true)
  }, 60_000)
})

describe('the thunk is read on every offer, not once at construction', () => {
  it('follows a pause the visitor sets and clears while the tab is running', async () => {
    // A thunk rather than a flag is the whole reason `BrowserNodeOptions.paused` has the
    // shape it has: a visitor toggles it while the tab runs. A value read at construction
    // would be a pause an operator could set and never clear — and it would pass both
    // cases above, because each of those starts a node whose answer never has to change.
    let halted = false
    let asked = 0
    const node = await startTab('toggle', () => {
      asked += 1
      return halted
    })

    expect(node.localAdmission.would(ownOffer(node, 'shard-0')).accepted).toBe(true)
    halted = true
    expect(node.localAdmission.would(ownOffer(node, 'shard-1')).accepted).toBe(false)
    halted = false
    expect(node.localAdmission.would(ownOffer(node, 'shard-2')).accepted).toBe(true)

    // The tab consulted the caller's own closure rather than a copy of its answer. A
    // floor rather than an equality: `#compose` may consult it during start for reasons
    // that are not this file's subject, and three readings is what the three offers
    // above demand at minimum.
    expect(asked).toBeGreaterThanOrEqual(3)
  }, 60_000)
})

describe('localAdmission is the folded reading, not the bare capacity port', () => {
  it('refuses through localAdmission while `admission` on the same node still accepts', async () => {
    // **The discriminator, and it is the shape of the defect Phase 36 repaired.**
    // `BrowserNode.admission` is a bare `LocalCapacity` that has never heard of `paused`
    // — `demo/main.ts` reads `admission.slots` for a capacity display, and that reading
    // is about capacity, which a pause does not move. Before the fold existed, the local
    // path consulted exactly this port, so a paused tab refused every peer and went on
    // computing its own work.
    //
    // Both ports are read from ONE node in ONE case, so the difference cannot be an
    // artefact of two nodes started differently. If `localAdmission` were ever re-exported
    // from `admission`, or the fold removed, the two readings would agree and this case
    // says so.
    const node = await startTab('discriminator', () => true)
    const offer = ownOffer(node, 'shard-0')

    expect(node.admission.would(offer).accepted).toBe(true)
    expect(node.localAdmission.would(offer).accepted).toBe(false)
  }, 60_000)
})
