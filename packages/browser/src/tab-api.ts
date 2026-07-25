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

export interface TabAddresses {
  readonly peerId: string
  readonly webrtc: readonly string[]
  readonly circuit: readonly string[]
}

export interface TabApi {
  start(options: { relayAddrs: string[]; blockstoreName: string }): Promise<string>
  addresses(): TabAddresses
  /** Resolves once a relay reservation has produced a dialable `/webrtc` address. */
  waitForWebrtcAddr(timeoutMs: number): Promise<string[]>
  dial(address: string): Promise<string>
  peers(): string[]
  connectionsTo(peerId: string): TabConnection[]
  putModule(bytes: number[]): Promise<string>
  storedBlocks(): Promise<number>
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
