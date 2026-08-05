/**
 * A page-side harness that starts a real {@link BrowserNode} with a pinned owner key —
 * AUTH-03, the browser tier.
 *
 * **This module is test-only.** It is deliberately **not** re-exported from
 * `packages/browser/src/index.ts`, so it exposes no capability that Phase 22's
 * reachability guard could trace to an entry point. The precedent is
 * `packages/node/src/capability-fixture.ts`, which states the same rule for the same
 * reason, and `packages/core/src/executor/fixtures.ts`, which lives beside production
 * source and is reached the same way.
 *
 * ## Why this exists rather than a third option on `window.o2`
 *
 * `TabApi.start` takes `relayAddrs`, `blockstoreName` and `trustAnchors` and nothing
 * else. A tab started through it is pinned to nobody, so its authorizer refuses every
 * sovereign task at the *first* precedence step — `no pinned owner key` — whatever the
 * chain says and whatever audience the factory derived. That refusal is reachable
 * through the demo, and it is worth nothing as evidence: it is produced by an
 * authorizer wired correctly and by one wired wrongly alike.
 *
 * Measuring the wiring needs a tab pinned to a real owner, which needs
 * `BrowserNodeOptions.sovereignty`, which `TabApi` does not carry. Adding it there
 * would put node configuration on the page's own contract to serve a test. So the
 * harness constructs the factory directly, which is also the sharper thing to do: the
 * subject is `BrowserNode.start`'s composition, not the demo glue above it.
 *
 * ## Nothing here branches on what kind of node it is running on
 *
 * The node this builds is an ordinary `BrowserNode` with an ordinary executor,
 * transport and authorizer. What differs from the demo's is configuration — an owner
 * key it was handed — exactly as it differs between two Node agents started with
 * different `--owner-key` arguments.
 *
 * Same-target rules as the rest of `packages/browser/src`: no `node:` imports, because
 * `purity.node.test.ts` lists `browser` under `DUAL_TARGET`.
 */

import { CID } from 'multiformats/cid'
import { BrowserNode } from './browser-node.ts'
import { createTaskWorker } from './worker-factory.ts'
import type { NodeSovereignty, PublicKeyHex } from '@o2/core'

/** What {@link CapabilityHarness.start} is handed from the driving test. */
export interface HarnessStartOptions {
  /**
   * Peers to dial on the way up — here, the submitter's own WebSocket address.
   *
   * Named for what `BrowserNodeOptions` calls it. A browser binds no listening socket,
   * so a tab is reachable only over connections it opened itself; this one opens a
   * direct WebSocket to the Node process that will dispatch to it, and that connection
   * carries the dispatch back the other way. There is no circuit in this topology and
   * deliberately so — a relayed circuit is a signalling channel and may not carry a job.
   */
  readonly relayAddrs: readonly string[]
  readonly blockstoreName: string
  readonly trustAnchors: readonly PublicKeyHex[]
  /** The owner this tab is pinned to, and whether it is cleared to execute for them. */
  readonly sovereignty: NodeSovereignty
  /**
   * Enrol with a provider on the way up — AUTH-01, passed straight through.
   *
   * `userPrivateKey` crosses the `page.evaluate` boundary as a plain number array, not a
   * `Uint8Array`: Playwright serialises arguments as JSON, so typed arrays arrive as
   * `{"0":…}` objects and `ed25519.getPublicKey` would derive a key from nothing. The
   * conversion happens here, at the one place that knows both sides.
   */
  readonly enrollment?: {
    readonly userPrivateKey: readonly number[]
    readonly operatorId: string
    readonly providerAddr: string
  }
  /**
   * What the node does when its seed is gone — required, so the driving test says it.
   *
   * Passed through rather than fixed here. A test that reads identity persistence needs
   * `'mints-a-new-identity'` on the first start and needs to be able to demand
   * `'refuses-to-start-without-its-seed'` afterwards, which is the only way to tell "the
   * peer id was reloaded" apart from "a new one was minted and happened to be asserted
   * against itself".
   */
  readonly whenSeedIsGone: 'mints-a-new-identity' | 'refuses-to-start-without-its-seed'
}

/** The surface the driving test reaches through `page.evaluate`. */
export interface CapabilityHarness {
  start(options: HarnessStartOptions): Promise<string>
  /**
   * Put bytes into this tab's **local** store.
   *
   * Used to seed the owner's row into the node that owns it, before anything is
   * dispatched, so the only block this tab must go and fetch is the module. That is
   * what makes {@link hasBlock} a clean reading.
   */
  putBytes(bytes: readonly number[]): Promise<string>
  /**
   * Whether this tab's **local** store holds `cid` — never the fetching tier.
   *
   * The distinction is the whole value of the instrument. `BrowserNode.blockstore` is a
   * `FetchingBlockstore`, and asking *it* would pull the block from a peer and then
   * answer `true`, which would make the question change the answer. `store` is the
   * IndexedDB tier alone, so this reports what this tab actually went and got.
   */
  hasBlock(cid: string): Promise<boolean>
  /**
   * How many times this node's executor has been called — the ordering instrument.
   *
   * `GovernedExecutor` increments this immediately before it calls the executor it
   * wraps (`governed-executor.ts:64`, `:85`), and `serveAgent` reaches
   * `executor.execute` only when the authorizer returned `null` (`agent.ts:409-417`).
   * So this counts authorised dispatches and nothing else, and a refusal that arrives
   * with this figure unchanged is a refusal taken *before* the module ran rather than
   * one reported after it.
   *
   * Strictly stronger than {@link hasBlock}, which reads whether the module's bytes
   * were fetched. Both are asserted, because they fail independently.
   */
  executed(): number
  peers(): string[]
  /**
   * This tab's own peer id — readable without starting, unlike {@link start}'s return.
   *
   * Needed because the reload reading has to compare the peer id *before* a restart with
   * the one *after*, and `start` is the only other thing that reports it.
   */
  peerId(): string
  /** Dial a peer after start — see the implementation for why this is not `relayAddrs`. */
  dial(address: string): Promise<string>
  /**
   * The certificate this tab holds, or `null` — the AUTH-01 reading.
   *
   * Returned as its `nodeKey` and validity window rather than the whole structure,
   * because that is all any assertion here needs and a certificate carries a signature
   * that would be compared as a string across a JSON boundary for no benefit.
   */
  certificate(): { nodeKey: string; issuer: string; userKey: string; expiresAt: number } | null
  stop(): Promise<void>
}

declare global {
  interface Window {
    o2capability: CapabilityHarness
  }
}

let node: BrowserNode | null = null

/** The started node, or a failure naming the step that was skipped. */
function running(): BrowserNode {
  if (node === null) throw new Error('harness node is not running — call start() first')
  return node
}

export function installCapabilityHarness(): void {
  const harness: CapabilityHarness = {
    async start(options: HarnessStartOptions): Promise<string> {
      node = await BrowserNode.start({
        relayAddrs: [...options.relayAddrs],
        blockstoreName: options.blockstoreName,
        trustAnchors: [...options.trustAnchors],
        sovereignty: options.sovereignty,
        whenSeedIsGone: options.whenSeedIsGone,
        // BROW-01, and this harness states the open value rather than growing an option
        // for it. Nothing in the capability fixtures reads a start report, so the row is
        // never looked at either way; what the choice has to be is *truthful*, and a
        // harness node is one this file started on purpose rather than a visitor who was
        // asked. Withholding here would also be the wrong default to normalise — it is a
        // person's answer, not a test convenience, and `demo/main.ts` is the only site in
        // this repository that derives it from one.
        startReporting: 'reports-its-own-start',
        // The `Uint8Array` is rebuilt here — see `HarnessStartOptions.enrollment`.
        ...(options.enrollment === undefined
          ? {}
          : {
              enrollment: {
                userPrivateKey: new Uint8Array(options.enrollment.userPrivateKey),
                operatorId: options.enrollment.operatorId,
                providerAddr: options.enrollment.providerAddr,
              },
            }),
        // The submitter listens on loopback, which libp2p refuses from a browser by
        // default. Correct for the public internet, wrong for a test fixture.
        allowPrivateAddrs: true,
        // BROW-04/SCHED-06: required, and there is no main-thread fallback to inherit.
        createWorker: createTaskWorker,
      })
      return node.peerId
    },
    async putBytes(bytes: readonly number[]): Promise<string> {
      const cid = await running().store.put(new Uint8Array(bytes))
      return cid.toString()
    },
    async hasBlock(cid: string): Promise<boolean> {
      return running().store.has(CID.parse(cid))
    },
    executed(): number {
      return running().executor.executed
    },
    peers(): string[] {
      return running()
        .libp2p.getConnections()
        .map((connection) => connection.remotePeer.toString())
    },
    peerId(): string {
      return running().peerId
    },
    /**
     * Dial a peer *after* this node is up, and hand back its peer id.
     *
     * Distinct from `relayAddrs`, and the distinction is load-bearing rather than
     * cosmetic. `relayAddrs` is dialled inside `BrowserNode.start`, before the node is
     * serving anything — a peer met that way asks for records and gets no answer,
     * because `serveAgent` has not been called yet. That is the topology of a relay,
     * which a node must reach to become addressable at all. It is *not* the topology of
     * an ordinary peer, which meets a node that is already running.
     */
    async dial(address: string): Promise<string> {
      return running().dial(address)
    },
    certificate(): {
      nodeKey: string
      issuer: string
      userKey: string
      expiresAt: number
    } | null {
      const held = running().certificate
      if (held === null) return null
      return {
        nodeKey: held.nodeKey,
        issuer: held.issuer,
        userKey: held.userKey,
        expiresAt: held.expiresAt,
      }
    },
    async stop(): Promise<void> {
      const started = node
      node = null
      if (started !== null) await started.stop()
    },
  }
  window.o2capability = harness
}

installCapabilityHarness()
