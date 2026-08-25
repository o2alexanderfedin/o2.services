import { Key } from 'interface-datastore'
import type { Datastore } from 'interface-datastore'
import { parseCertificate } from '@o2/net'
import type { CanonicalValue, NodeCertificate, PublicKeyHex } from '@o2/core'
import type { CertificateCache } from '@o2/libp2p'

/**
 * Peers' certificates, kept in this node's own datastore — DATA-08, W4.
 *
 * ## What it buys, and it is not a general-purpose cache
 *
 * `PeerVerifier` asks every peer for its records on connect. That is one RPC per peer per
 * process, and it was paid again on every restart even for peers this node had verified
 * minutes earlier. With a durable datastore the answer survives, so a restarted node
 * re-derives its verdicts from what it already holds instead of asking the network.
 *
 * ## Why it is safe, stated as a property rather than as care
 *
 * A cached certificate is not believed. `PeerVerifier` runs it through the same `#accept`
 * the wire path runs — it must name the key the peer authenticated with over Noise, and it
 * must satisfy `verifyCertificate` against the issuers pinned *now* and the clock *now*.
 * A cache therefore cannot widen what this node accepts; it can only skip a round trip
 * that would have reached the same answer.
 *
 * That holds because revocation in this fabric is **non-renewal on the certificate's own
 * clock, not a list**. Verification reaches nothing, so a stale copy can never be more
 * acceptable than a fresh one. In a system with an online status check the same cache
 * would be a hole.
 *
 * ## Why it does not sweep
 *
 * Nothing expires entries. A certificate that has lapsed simply fails the check and the
 * peer is asked, and at a one-hour lifetime an entry stops being useful within the hour —
 * so a sweep would spend I/O to reclaim a few hundred bytes per peer this node has met.
 * If that ever matters the fix is a bound on the store, not a timer here.
 */
export class DatastoreCertificateCache implements CertificateCache {
  readonly #store: Datastore

  constructor(store: Datastore) {
    this.#store = store
  }

  /**
   * Namespaced under `/o2/`, so these rows cannot collide with libp2p's own `/peers/…`
   * keys in the same store, and keyed by **node key** rather than by peer id — that is
   * what the certificate names, and what the caller has in hand at the point of the
   * lookup.
   */
  static keyFor(nodeKey: PublicKeyHex): Key {
    return new Key(`/o2/certificates/${nodeKey}`)
  }

  async load(nodeKey: PublicKeyHex): Promise<NodeCertificate | undefined> {
    let raw: Uint8Array
    try {
      raw = await this.#store.get(DatastoreCertificateCache.keyFor(nodeKey))
    } catch {
      // A miss, an unreadable store, a store that is not open. All of them are "ask the
      // peer", and none of them is an error a caller could act on differently.
      return undefined
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(new TextDecoder().decode(raw))
    } catch {
      return undefined
    }

    // **The wire's parser, not a second one** — the same call `identity-store.ts` makes
    // about a certificate read off this node's own disk, and for the same reason: a local
    // store is not more trustworthy than a peer's wire. It may have been truncated by a
    // crash, edited by hand, or written by an older build with a different field set. Two
    // validators would drift and the lenient one would become the one that matters.
    return parseCertificate(parsed as CanonicalValue) ?? undefined
  }

  async save(certificate: NodeCertificate): Promise<void> {
    await this.#store.put(
      DatastoreCertificateCache.keyFor(certificate.nodeKey),
      new TextEncoder().encode(JSON.stringify(certificate)),
    )
  }
}
