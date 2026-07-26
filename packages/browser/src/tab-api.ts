/**
 * The contract between a tab and whatever is driving it.
 *
 * Lives here rather than in `demo/` so the page that implements it and the harness
 * that calls it type-check against one definition. A mismatch between the two would
 * otherwise only show up as a runtime failure inside `page.evaluate`, where the
 * error surfaces as a timeout.
 */

/** What a completed job looks like from outside the tab. */
export interface TabJobReport {
  readonly complete: boolean
  /** Partition index each shard's guest reported, or -1 if it did not agree. */
  readonly partitions: readonly number[]
  readonly agreeing: readonly string[][]
  readonly replicas: readonly number[]
  readonly verificationMultiplier: number
  /** Blocks this tab pulled over the wire. */
  readonly fetched: number
  readonly rejected: number
}

/** How this tab is actually connected to a peer, right now. */
export interface TabConnection {
  readonly remoteAddr: string
  /**
   * True when the connection is a relayed circuit, which libp2p marks as limited
   * (2 min / 128 KiB). A WebRTC connection is unlimited — that difference is how
   * "the relay signals, then drops out of the data path" is verified rather than
   * assumed.
   */
  readonly limited: boolean
}

/** BROW-03 — what the visibility governor is doing right now. */
export interface TabGovernorState {
  readonly hidden: boolean
  readonly dutyCycle: number
  readonly transitions: number
  readonly sleptMs: number
}

/** BROW-05 — the isolation state of the page hosting this node. */
export interface TabIsolation {
  /** False on a page served without COOP/COEP, which is the supported case. */
  readonly crossOriginIsolated: boolean
  readonly hasSharedArrayBuffer: boolean
  readonly inIframe: boolean
}

export interface TabAddresses {
  readonly peerId: string
  readonly webrtc: readonly string[]
  readonly circuit: readonly string[]
}

export interface TabApi {
  start(options: { relayAddrs: string[]; blockstoreName: string }): Promise<string>
  /**
   * Join using whatever the page's own origin says to dial.
   *
   * The whole of "automatic discovery" from the browser's side. The page fetches
   * `/bootstrap.json` from the host it was itself loaded from, so a phone that opened
   * `http://laptop.local:5173` is told to dial `/dns4/laptop.local/...` — nothing
   * hardcoded, nothing guessed, and no address that can go stale in a build.
   */
  autoStart(options?: { blockstoreName?: string }): Promise<{ peerId: string; relayAddrs: string[] }>
  /**
   * Where this page would look for a relay, without joining.
   *
   * `source` is `'query'` when relays came from `?relay=<multiaddr>`, `'origin'` when
   * they came from a same-origin `/bootstrap.json`, and `'none'` when neither is
   * available — which is the normal state on a static host with no relay configured.
   */
  discoverRelays(): Promise<{ source: 'query' | 'origin' | 'none'; relayAddrs: string[] }>
  addresses(): TabAddresses
  /** Resolves once a relay reservation has produced a dialable `/webrtc` address. */
  waitForWebrtcAddr(timeoutMs: number): Promise<string[]>
  dial(address: string): Promise<string>
  peers(): string[]
  connectionsTo(peerId: string): TabConnection[]
  putModule(bytes: number[]): Promise<string>
  storedBlocks(): Promise<number>
  governor(): TabGovernorState
  isolation(): TabIsolation
  /**
   * Force the page's visibility signal, then dispatch a real `visibilitychange`.
   *
   * Exists only because **Chromium under automation never reports a page as
   * hidden** — verified: neither `page.bringToFront()` nor headed mode produces a
   * hidden state or fires the event, because there is no window manager driving tab
   * activation. So the browser's *signal* is simulated and everything downstream is
   * real: the actual `document`, a real event dispatch, the governor's real listener,
   * and the real execution path.
   *
   * Test-only. Nothing in the production path calls it.
   */
  simulateHidden(hidden: boolean): void
  hasBlock(cid: string): Promise<boolean>
  runJob(options: {
    moduleCid: string
    peerIds: string[]
    shards: number
    redundancy: number
    includeSelf?: boolean
  }): Promise<TabJobReport>
  stop(): Promise<void>
}

declare global {
  interface Window {
    o2: TabApi
  }
}
