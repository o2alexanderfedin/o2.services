/**
 * Egress control — DATA-04, DATA-05.
 *
 * Two requirements meet here, and one design satisfies both.
 *
 * **Nothing raw leaves.** A cross-owner job must push filters, projections, and
 * partial aggregation down to the owner's node, so only derived values cross the
 * wire. Proving that means watching the owner's actual network interface, not
 * reasoning about the code that feeds it.
 *
 * **Every job emits a manifest of what left, complete by construction.** The phrase
 * matters. A manifest assembled by instrumenting call sites is complete only for the
 * call sites someone remembered; a manifest produced by the *sole* code path out is
 * complete because there is nowhere else to go. So this is a `Transport` decorator:
 * recording is not something the sender does in addition to sending, it is part of
 * sending. Bypassing the record means bypassing the network.
 *
 * The raw-byte check is a scan of outbound frames for known sovereign block contents.
 * It is deliberately a *detector*, not a *predictor* — the same discipline the rest of
 * this project settled on. It cannot prove that no encoding of a sovereign value
 * could ever slip past; it does catch the failure that actually happens, which is a
 * map step that forgot to aggregate and shipped its input.
 *
 * Pure module.
 */

import type { Transport } from '@o2/core'

/** One outbound transmission, as recorded at the only exit. */
export interface EgressEntry {
  readonly to: string
  readonly bytes: number
  /** Set when the frame matched a registered sovereign value. */
  readonly violation?: string
}

/** What left one node during a job. Signed by the owner to make it attributable. */
export interface EgressManifest {
  readonly nodeId: string
  readonly ownerId: string
  readonly entries: readonly EgressEntry[]
  readonly totalBytes: number
  /** Frames that contained registered sovereign bytes. Non-empty means a leak. */
  readonly violations: readonly string[]
}

/**
 * Wraps a `Transport` so nothing can leave the node unrecorded.
 *
 * Register sovereign payloads with `guard()` and every outbound frame is scanned for
 * them. A match is recorded as a violation rather than thrown: the point is to
 * *observe* what a job actually did, and a throw would let a leak be caught and
 * swallowed by the caller that caused it.
 */
export class EgressGuard implements Transport {
  readonly #inner: Transport
  readonly #ownerId: string
  readonly #entries: EgressEntry[] = []
  /** Sovereign payloads that must never appear in an outbound frame, by label. */
  readonly #guarded = new Map<string, Uint8Array>()

  constructor(inner: Transport, ownerId: string) {
    this.#inner = inner
    this.#ownerId = ownerId
  }

  get localId(): string {
    return this.#inner.localId
  }

  /** Mark a payload as sovereign. Any outbound frame containing it is a violation. */
  guard(label: string, payload: Uint8Array): void {
    this.#guarded.set(label, payload)
  }

  async send(to: string, message: Uint8Array<ArrayBuffer>): Promise<void> {
    // Scan before sending. Recording after a successful send would miss exactly the
    // frames that failed mid-flight, which are still frames that left.
    const violation = this.#scan(message)
    this.#entries.push(
      violation === null
        ? { to, bytes: message.byteLength }
        : { to, bytes: message.byteLength, violation },
    )
    await this.#inner.send(to, message)
  }

  onMessage(handler: (from: string, message: Uint8Array<ArrayBuffer>) => void): () => void {
    return this.#inner.onMessage(handler)
  }

  get peers(): readonly string[] {
    return this.#inner.peers
  }

  /** Everything that has left this node so far. */
  get manifest(): EgressManifest {
    const entries = [...this.#entries]
    return {
      nodeId: this.localId,
      ownerId: this.#ownerId,
      entries,
      totalBytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
      violations: entries
        .map((entry) => entry.violation)
        .filter((label): label is string => label !== undefined),
    }
  }

  /** Discard the record, e.g. between jobs. */
  reset(): void {
    this.#entries.length = 0
  }

  /** The label of the first guarded payload contained in `frame`, or `null`. */
  #scan(frame: Uint8Array): string | null {
    for (const [label, payload] of this.#guarded) {
      if (payload.byteLength === 0 || payload.byteLength > frame.byteLength) continue
      if (contains(frame, payload)) return label
    }
    return null
  }
}

/** Whether `haystack` contains `needle` as a contiguous run. */
function contains(haystack: Uint8Array, needle: Uint8Array): boolean {
  const limit = haystack.byteLength - needle.byteLength
  outer: for (let start = 0; start <= limit; start++) {
    for (let i = 0; i < needle.byteLength; i++) {
      if (haystack[start + i] !== needle[i]) continue outer
    }
    return true
  }
  return false
}
