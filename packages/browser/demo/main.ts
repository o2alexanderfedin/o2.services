/**
 * The tab-side driver for the two-tab test.
 *
 * Exposes a small imperative surface on `window.o2` so the harness can start a
 * node, exchange addresses, dial, and submit a job from outside the page. Keeping
 * the orchestration in the harness rather than in the page means both tabs run
 * identical code and the *test* decides who submits — which is what makes the
 * result meaningful rather than choreographed.
 */

import { submitJob } from '@o2/core'
import type { CanonicalValue } from '@o2/core'
import { RemoteExecutor } from '@o2/net'
import { BrowserNode } from '@o2/browser'
import type { TabApi } from '@o2/browser'
import * as pid from '@libp2p/peer-id'

let node: BrowserNode | null = null
let moduleCidString = ''

function required(): BrowserNode {
  if (node === null) throw new Error('node not started')
  return node
}

function partitionOf(output: CanonicalValue): number {
  const p = (output as { p?: unknown }).p
  if (!(p instanceof Uint8Array) || p.length !== 4) return -1
  return new DataView(p.buffer, p.byteOffset, 4).getUint32(0, true)
}

const api: TabApi = {
  async start(options) {
    node = await BrowserNode.start({
      relayAddrs: options.relayAddrs,
      blockstoreName: options.blockstoreName,
      rpcTimeoutMs: 60_000,
      // Aggressive so the throttle is unmistakable in a test rather than marginal.
      backgroundDutyCycle: 0.05,
      // Loopback relay: refused by libp2p's browser defaults, correct to allow here.
      allowPrivateAddrs: true,
    })
    const status = document.getElementById('status')
    if (status !== null) status.textContent = `running ${node.peerId}`
    return node.peerId
  },

  async autoStart(options = {}) {
    // Same-origin, so it works over `.local`, a raw IP, or localhost without knowing
    // which was used. `cache: 'no-store'` because a stale relay address is worse than
    // a slow one.
    const response = await fetch('/bootstrap.json', { cache: 'no-store' })
    if (!response.ok) throw new Error(`bootstrap failed: HTTP ${response.status}`)
    const info = (await response.json()) as { relayAddrs: string[] }
    if (!Array.isArray(info.relayAddrs) || info.relayAddrs.length === 0) {
      throw new Error('bootstrap returned no relay addresses')
    }
    const peerId = await api.start({
      relayAddrs: info.relayAddrs,
      blockstoreName: options.blockstoreName ?? 'o2-blocks',
    })
    return { peerId, relayAddrs: info.relayAddrs }
  },

  addresses() {
    const n = required()
    return { peerId: n.peerId, webrtc: [...n.webrtcAddrs], circuit: [...n.circuitAddrs] }
  },

  async waitForWebrtcAddr(timeoutMs) {
    const n = required()
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (n.webrtcAddrs.length > 0) return [...n.webrtcAddrs]
      await new Promise((r) => setTimeout(r, 100))
    }
    throw new Error(`no /webrtc address after ${timeoutMs}ms; addrs=${JSON.stringify(n.multiaddrs)}`)
  },

  async dial(address) {
    return required().dial(address)
  },

  peers() {
    return [...required().transport.peers]
  },

  connectionsTo(peerId) {
    const { peerIdFromString } = pid
    return required()
      .libp2p.getConnections(peerIdFromString(peerId))
      .map((connection) => ({
        remoteAddr: connection.remoteAddr.toString(),
        limited: connection.limits !== undefined,
      }))
  },

  governor() {
    const g = required().governor
    return {
      hidden: g.hidden,
      dutyCycle: g.dutyCycle,
      transitions: g.transitions,
      sleptMs: g.sleptMs,
    }
  },

  isolation() {
    return {
      crossOriginIsolated: globalThis.crossOriginIsolated,
      hasSharedArrayBuffer: typeof SharedArrayBuffer !== 'undefined',
      inIframe: window.self !== window.top,
    }
  },

  simulateHidden(hidden) {
    // Shadow the read-only getters on this document instance, then fire the genuine
    // event. The governor's listener, the duty cycle, and the execution path are all
    // untouched by this — only the browser's own signal is stood in for.
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => (hidden ? 'hidden' : 'visible'),
    })
    document.dispatchEvent(new Event('visibilitychange'))
  },

  async storedBlocks() {
    return required().store.refresh()
  },

  async hasBlock(cid) {
    const { CID } = await import('multiformats/cid')
    return required().store.has(CID.parse(cid))
  },

  async putModule(bytes) {
    const cid = await required().store.put(new Uint8Array(bytes))
    moduleCidString = cid.toString()
    return moduleCidString
  },

  async runJob(options) {
    const n = required()
    const { CID } = await import('multiformats/cid')
    const result = await submitJob(
      {
        moduleCid: CID.parse(options.moduleCid),
        shards: Array.from({ length: options.shards }, (_unused, i) => ({ a: i })),
        executors: [
          // This tab contributes its own compute when asked. With two tabs that is
          // what makes R=2 possible: one tab submits *and* executes, the other
          // executes, and the two must agree.
          ...(options.includeSelf === true ? [n.executor] : []),
          ...options.peerIds.map((id) => new RemoteExecutor(id, n.rpc)),
        ],
        redundancy: options.redundancy,
      },
      n.store,
    )
    if (!result.ok) throw new Error(`submit failed: ${JSON.stringify(result.error)}`)

    return {
      complete: result.job.complete,
      partitions: result.job.shards.map((s) =>
        s.verification.status === 'agreed' ? partitionOf(s.verification.output) : -1,
      ),
      agreeing: result.job.shards.map((s) =>
        s.verification.status === 'agreed' ? [...s.verification.agreeing] : [],
      ),
      replicas: result.job.shards.map((s) =>
        s.verification.status === 'agreed' ? s.verification.replicas : 0,
      ),
      verificationMultiplier: result.job.verificationMultiplier,
      fetched: n.blockstore.fetched,
      rejected: n.blockstore.rejected,
    }
  },

  async stop() {
    if (node !== null) await node.stop()
    node = null
  },
}

window.o2 = api
