/**
 * Discovery — SCHED-01, NET-06.
 *
 * Every phase before this one handed the requestor a list of peers. That list is the
 * last piece of central coordination in the system, and this module removes it: a
 * requestor that knows only a data CID works out for itself who may run a task on it.
 *
 * The answer is an **intersection of three independently-sourced facts**, and the
 * intersection is the point — no single one of them is worth anything alone:
 *
 * | Fact | Source | Alone it proves |
 * |---|---|---|
 * | holds the input block | content routing (`providers`) | nothing about identity |
 * | is an enrolled node of user U, operator O | provider-signed `NodeCertificate` | nothing about what it can run |
 * | supports these WASM features | node-signed `CapabilityRecord` | nothing — anyone can mint a key |
 *
 * A `CapabilityRecord` is self-signed, which sounds like security theatre until you
 * see what it is bolted to. On its own it is worthless: an attacker generates a
 * keypair and claims anything. It becomes meaningful only because the same `nodeKey`
 * must also carry a certificate a *pinned provider* signed, so the self-signature
 * binds the claim to an identity somebody else vouched for. Splitting it this way
 * means a node whose engine gains a feature re-signs one small record locally instead
 * of going back to the provider for a fresh certificate.
 *
 * ## Every exclusion is named
 *
 * `discoverExecutors` returns the nodes that qualified *and* every node that did not,
 * with the reason. Silent filtering is how a requestor ends up staring at an empty
 * candidate list with no idea whether the network is down, its clock is wrong, or the
 * module needs a feature nobody has.
 *
 * ## Who answers the query — NET-06
 *
 * **All nodes have equal functionality**, so any node can serve records. What varies
 * is whether other peers can currently *reach* this one to ask: a node that has bound
 * a listening socket can be asked directly, and a node that holds a relay reservation
 * can be asked through the relay. A node in neither state cannot serve, and resolves
 * through peers that can.
 *
 * `FallbackRecordIndex` is therefore ordered by **availability at this moment**, never
 * by what kind of node something is. A server that has not finished listening falls
 * back exactly as a browser tab without a reservation does, and a test asserts that
 * symmetry — a rule that exempted one of them would be a tier by another name.
 *
 * Pure module.
 */

import { ed25519 } from '@noble/curves/ed25519.js'
import type { CID } from 'multiformats/cid'
import { NotEncodableError, encodeCanonical } from './canonical/encode.ts'
import type { CanonicalValue } from './canonical/encode.ts'
import { fromHex, toHex } from './capability.ts'
import type { PublicKeyHex } from './capability.ts'
import { verifyCertificate } from './enrollment.ts'
import type { CertificateFailure, NodeCertificate } from './enrollment.ts'
import type { Blockstore } from './ports.ts'

/**
 * A node's own signed statement of what it can execute.
 *
 * Signed by the node key itself, and only meaningful alongside the provider-signed
 * certificate for that same key — see the module note.
 */
export interface CapabilityRecord {
  readonly nodeKey: PublicKeyHex
  /**
   * WASM engine features available here, as reported by feature detection.
   *
   * A module declares what it needs; a node lacking any of it is excluded rather than
   * dispatched to and failed. This is a *matching* list, not a determinism claim —
   * determinism is a property of the published artifact, settled at publish time.
   */
  readonly features: readonly string[]
  /**
   * User keys whose sovereign data this node can decrypt and execute.
   *
   * DATA-09: a node may hold an encrypted replica of someone's sovereign data, which
   * makes it a fine block source and an impossible executor, because executing would
   * mean handing it the key. Such a node provides the CID and is absent from this
   * list, and the sovereign branch of `discoverExecutors` excludes it by name.
   */
  readonly sovereignFor: readonly PublicKeyHex[]
  readonly issuedAt: number
  readonly expiresAt: number
  readonly signature: string
}

function capabilityPayload(record: Omit<CapabilityRecord, 'signature'>): Uint8Array<ArrayBuffer> {
  const value: CanonicalValue = {
    nodeKey: record.nodeKey,
    features: [...record.features].sort(),
    sovereignFor: [...record.sovereignFor].sort(),
    issuedAt: record.issuedAt,
    expiresAt: record.expiresAt,
  }
  const encoded = encodeCanonical(value)
  if (!encoded.ok) throw new NotEncodableError('capability record', encoded.error)
  return encoded.bytes
}

/** Sign a capability record with the node's own key. The private key never leaves. */
export function publishCapabilities(
  nodePrivateKey: Uint8Array,
  fields: Omit<CapabilityRecord, 'nodeKey' | 'signature'>,
): CapabilityRecord {
  const unsigned = {
    ...fields,
    nodeKey: toHex(ed25519.getPublicKey(nodePrivateKey)),
    features: [...fields.features].sort(),
    sovereignFor: [...fields.sovereignFor].sort(),
  }
  return { ...unsigned, signature: toHex(ed25519.sign(capabilityPayload(unsigned), nodePrivateKey)) }
}

/** Verify a capability record against its own node key. Offline, like everything here. */
export function verifyCapabilityRecord(record: CapabilityRecord, now: number): boolean {
  if (record.issuedAt > now || record.expiresAt <= now) return false
  // Above the `try` — `capabilityPayload` throws `NotEncodableError` by design, and
  // a record this package cannot encode is not a record that failed to verify.
  const payload = capabilityPayload(record)
  try {
    return ed25519.verify(fromHex(record.signature), payload, fromHex(record.nodeKey))
  } catch {
    return false
  }
}

/** What an index holds about one node: who it is, and what it can run. */
export interface NodeRecords {
  readonly certificate: NodeCertificate
  readonly capabilities: CapabilityRecord
}

/**
 * Content routing plus the record store, as one port.
 *
 * Both halves are lookups against the same distributed index, and keeping them
 * together is what lets a single implementation be swapped for a DHT, a delegated
 * HTTP router, or an in-memory fixture without the discovery logic noticing.
 */
export interface RecordIndex {
  /** Node keys advertising a copy of this block. */
  providers(cid: CID): Promise<readonly PublicKeyHex[]>
  /** Signed records for a node, or `undefined` if this index holds none. */
  recordsFor(nodeKey: PublicKeyHex): Promise<NodeRecords | undefined>
}

/** What a requestor is looking for. */
export interface ExecutorQuery {
  /** The block the task must read. Only its providers are considered. */
  readonly inputCid: CID
  /** Engine features the module needs. A node missing any is excluded. */
  readonly requiredFeatures?: readonly string[]
  /**
   * Set for sovereign work: only nodes cleared to execute for this user key qualify.
   *
   * This is the discovery-side half of the sovereignty rule, and it is a *filter*,
   * never a preference — `placement.ts` enforces the same narrowing again on the
   * candidate set it is handed, because two independent gates is the point.
   */
  readonly sovereignFor?: PublicKeyHex
}

/** Why a provider of the data is not a candidate executor. */
export type ExclusionReason =
  | { readonly kind: 'no-records'; readonly nodeKey: PublicKeyHex }
  | {
      readonly kind: 'invalid-certificate'
      readonly nodeKey: PublicKeyHex
      readonly failure: CertificateFailure
    }
  | { readonly kind: 'invalid-capability-record'; readonly nodeKey: PublicKeyHex }
  | {
      readonly kind: 'certificate-mismatch'
      readonly nodeKey: PublicKeyHex
      readonly recordKey: PublicKeyHex
    }
  | {
      readonly kind: 'missing-features'
      readonly nodeKey: PublicKeyHex
      readonly missing: readonly string[]
    }
  | {
      readonly kind: 'not-cleared-for-owner'
      readonly nodeKey: PublicKeyHex
      readonly userKey: PublicKeyHex
    }

export interface Exclusion {
  readonly reason: ExclusionReason
  /** One line fit to show a human staring at an empty candidate list. */
  readonly detail: string
}

/** A node that holds the data, is enrolled, and can run the module. */
export interface DiscoveredExecutor {
  readonly nodeKey: PublicKeyHex
  readonly certificate: NodeCertificate
  readonly capabilities: CapabilityRecord
}

export interface DiscoveryResult {
  /** Qualified executors, ordered by node key so a query is reproducible. */
  readonly executors: readonly DiscoveredExecutor[]
  /** Every provider that did not qualify, with the reason it did not. */
  readonly excluded: readonly Exclusion[]
  /** Providers considered, qualified or not. */
  readonly providers: number
}

export interface DiscoveryOptions {
  /** Provider keys pinned in advance. Verification is offline against these. */
  readonly trustedIssuers: ReadonlySet<PublicKeyHex>
  readonly now: number
}

function describe(reason: ExclusionReason): string {
  switch (reason.kind) {
    case 'no-records':
      return `${reason.nodeKey} provides the data but no index holds its records`
    case 'invalid-certificate':
      return `${reason.nodeKey} has an unusable certificate (${reason.failure.kind})`
    case 'invalid-capability-record':
      return `${reason.nodeKey} has an unusable capability record`
    case 'certificate-mismatch':
      return `records for ${reason.nodeKey} carry a capability record for ${reason.recordKey}`
    case 'missing-features':
      return `${reason.nodeKey} lacks required engine features: ${reason.missing.join(', ')}`
    case 'not-cleared-for-owner':
      return `${reason.nodeKey} is not cleared to execute sovereign data for ${reason.userKey}`
  }
}

/**
 * Find executors for a task from a data CID alone.
 *
 * The caller supplies no peer list. Everything comes from the index and from
 * signatures verified against pinned provider keys, so this works for a node that
 * joined thirty seconds ago and knows one bootstrap peer.
 */
export async function discoverExecutors(
  query: ExecutorQuery,
  index: RecordIndex,
  options: DiscoveryOptions,
): Promise<DiscoveryResult> {
  const { trustedIssuers, now } = options
  const providers = [...new Set(await index.providers(query.inputCid))].sort()

  const executors: DiscoveredExecutor[] = []
  const excluded: Exclusion[] = []
  const exclude = (reason: ExclusionReason): void => {
    excluded.push({ reason, detail: describe(reason) })
  }

  for (const nodeKey of providers) {
    const records = await index.recordsFor(nodeKey)
    if (records === undefined) {
      exclude({ kind: 'no-records', nodeKey })
      continue
    }

    const { certificate, capabilities } = records

    const verified = verifyCertificate(certificate, trustedIssuers, now)
    if (!verified.ok) {
      exclude({ kind: 'invalid-certificate', nodeKey, failure: verified.failure })
      continue
    }

    // The certificate names the key; the capability record must be for that same key,
    // or an attacker could pair a real node's certificate with claims of its own.
    if (certificate.nodeKey !== nodeKey || capabilities.nodeKey !== nodeKey) {
      exclude({ kind: 'certificate-mismatch', nodeKey, recordKey: capabilities.nodeKey })
      continue
    }

    if (!verifyCapabilityRecord(capabilities, now)) {
      exclude({ kind: 'invalid-capability-record', nodeKey })
      continue
    }

    const required = query.requiredFeatures ?? []
    const available = new Set(capabilities.features)
    const missing = required.filter((feature) => !available.has(feature))
    if (missing.length > 0) {
      exclude({ kind: 'missing-features', nodeKey, missing })
      continue
    }

    const { sovereignFor } = query
    if (sovereignFor !== undefined && !capabilities.sovereignFor.includes(sovereignFor)) {
      exclude({ kind: 'not-cleared-for-owner', nodeKey, userKey: sovereignFor })
      continue
    }

    executors.push({ nodeKey, certificate, capabilities })
  }

  return { executors, excluded, providers: providers.length }
}

/**
 * One index in a fallback chain, with the condition under which it can be used.
 *
 * `available` is a *state*, deliberately: "am I reachable to be asked right now",
 * which is true of a listening server and of a browser tab holding a relay
 * reservation, and false of either one before it gets there. Nothing here may key on
 * what kind of node it is.
 */
export interface IndexSource {
  readonly name: string
  readonly index: RecordIndex
  available(): boolean | Promise<boolean>
}

/**
 * Try each index in order, skipping any that is currently unavailable — NET-06.
 *
 * An index that is available but knows nothing is not authoritative: the chain falls
 * through to the next one rather than reporting an empty answer, because partial
 * local knowledge is the normal condition for a node that just joined.
 */
export class FallbackRecordIndex implements RecordIndex {
  readonly #sources: readonly IndexSource[]
  #lastSource: string | null = null

  constructor(sources: readonly IndexSource[]) {
    this.#sources = sources
  }

  /** Which source answered the most recent successful lookup. */
  get lastSource(): string | null {
    return this.#lastSource
  }

  async providers(cid: CID): Promise<readonly PublicKeyHex[]> {
    for (const source of this.#sources) {
      if (!(await source.available())) continue
      const found = await source.index.providers(cid)
      if (found.length > 0) {
        this.#lastSource = source.name
        return found
      }
    }
    return []
  }

  async recordsFor(nodeKey: PublicKeyHex): Promise<NodeRecords | undefined> {
    for (const source of this.#sources) {
      if (!(await source.available())) continue
      const records = await source.index.recordsFor(nodeKey)
      if (records !== undefined) {
        this.#lastSource = source.name
        return records
      }
    }
    return undefined
  }
}

/** An in-memory index — a node's own view of what it and its peers have published. */
export class MemoryRecordIndex implements RecordIndex {
  readonly #providers = new Map<string, Set<PublicKeyHex>>()
  readonly #records = new Map<PublicKeyHex, NodeRecords>()

  /** Announce that a node holds a block. */
  provide(cid: CID, nodeKey: PublicKeyHex): void {
    const key = cid.toString()
    const existing = this.#providers.get(key)
    if (existing) existing.add(nodeKey)
    else this.#providers.set(key, new Set([nodeKey]))
  }

  /** Publish a node's signed records. Signatures are checked at lookup, not here. */
  publish(records: NodeRecords): void {
    this.#records.set(records.certificate.nodeKey, records)
  }

  async providers(cid: CID): Promise<readonly PublicKeyHex[]> {
    return [...(this.#providers.get(cid.toString()) ?? [])]
  }

  async recordsFor(nodeKey: PublicKeyHex): Promise<NodeRecords | undefined> {
    return this.#records.get(nodeKey)
  }
}

export interface SelfRecordIndexOptions {
  /** The key this node answers for, and the only key `recordsFor` will match. */
  readonly nodeKey: PublicKeyHex
  /**
   * The node's **local-only** tier. Never one with network fallback — see the class
   * doc's second section for why that would turn a question into a fetch.
   */
  readonly store: Blockstore
  /** This node's own signed records, or `'holds-no-records'` if it has none. */
  readonly records: NodeRecords | 'holds-no-records'
  /**
   * Says a CID must not be advertised even though this node holds it, or
   * `'advertises-everything-it-holds'`.
   *
   * The predicate may be asynchronous, and in the only production construction it is:
   * deciding this correctly means asking the *same* question the serving node's
   * `block` branch asks about the *same* candidate reply, and that needs the bytes.
   * A synchronous predicate satisfies this type too, so a caller with a cheaper
   * question is not forced into a promise.
   */
  readonly withhold: ((cid: CID) => boolean | Promise<boolean>) | 'advertises-everything-it-holds'
}

/**
 * One node's answer to both halves of a lookup, computed from its own store — SCHED-01.
 *
 * ## Why an answer computed at ask time, and not an announcement
 *
 * Owner ruling **D1** (`18-CONTEXT.md`). A node is authoritative about what it holds,
 * so there is nothing to replicate in advance and nothing to go stale. The rejected
 * alternative was announce-on-write, and the three reasons it was rejected are worth
 * naming here rather than being rediscovered: it needs a new wire frame; a node that
 * evicts a block still reads as a provider until something retracts the announcement;
 * and it lets an unverified peer grow another node's map without bound, which then
 * needs a cap, and a cap that silently drops entries is the shape this project keeps
 * removing.
 *
 * ## Why `store` must be the local-only tier
 *
 * Handing this a `FetchingBlockstore` would make `providers` answer "yes" for anything
 * *obtainable* rather than anything *held*, turning a question about this node into a
 * recursive network lookup — and `has()` on a fetching store would pull the block over
 * the wire merely to answer a question about it. This is the same rule
 * `AgentOptions.egress.sovereignInputs` already states for its own store, for the same
 * reason, and it is stated again here because the mistake is identical and the two
 * fields are configured at the same call sites.
 *
 * ## Why `withhold` exists, and that it is not decoration
 *
 * `serveAgent`'s `block` branch refuses a reply carrying a registered sovereign
 * payload, and the owner ruling recorded in `net/src/egress.ts` knowingly accepts that
 * **a peer cannot tell refusal from absence**. A `providers` answer that said "yes, I
 * hold it" about such a block would convert *cannot tell* into *can tell*: a side
 * channel around a refusal, obtained without ever asking for the bytes and without
 * anything appearing on the refusing node's manifest. The invariant is one sentence,
 * and it is a test rather than a sentence: **this index never advertises a block the
 * `block` branch would refuse to serve.**
 *
 * That invariant is a property of the *predicate*, not of this class, and the only way
 * to hold it is for the predicate to ask the block branch's own question rather than a
 * second question that happens to agree today. `@o2/net`'s `withholdingFrom` is that
 * one construction; a predicate written any other way — comparing a CID against a set
 * of registration labels, say — is a second copy of the condition, and two copies
 * diverge the first time anything registers a payload under a label that is not its
 * CID. This class cannot enforce that, because it must not import an adapter; what it
 * can do is say where the only correct predicate comes from.
 *
 * ## Why the predicate is consulted per lookup
 *
 * A registration's lifetime is a hold, not a process. A snapshot resolved in the
 * constructor would advertise a block that became sovereign a second later, and would
 * go on withholding one whose hold was given back.
 *
 * ## Why a node with no certificate still answers `providers`
 *
 * Holding blocks is not a capability enrollment confers. `discoverExecutors` handles
 * such a provider by name — it is excluded as `no-records` with a `detail` fit to show
 * a human — and silence would be the worse answer, because *"every exclusion is
 * named"* is this module's own rule and a provider nobody hears from is an exclusion
 * nobody can name.
 *
 * ## Nothing here branches on what kind of node it belongs to
 *
 * Said in the voice `net/src/discovery.ts` uses for NET-06: this takes a store, a key,
 * records and a predicate, and there is no field to branch on. A browser tab holding a
 * relay reservation and a listening server construct the identical object from their
 * own four values. All nodes have equal functionality; the only difference is
 * discovery.
 */
export class SelfRecordIndex implements RecordIndex {
  readonly #nodeKey: PublicKeyHex
  readonly #store: Blockstore
  readonly #records: NodeRecords | 'holds-no-records'
  readonly #withhold: SelfRecordIndexOptions['withhold']

  constructor(options: SelfRecordIndexOptions) {
    this.#nodeKey = options.nodeKey
    this.#store = options.store
    this.#records = options.records
    // Held as given, and asked again on every lookup. Resolving it here — into a
    // boolean, into a copy of whatever set it reads, or into a per-CID memo — is the
    // defect the per-lookup section above exists to prevent, and all three forms are
    // planted and caught in `discovery.test.ts`.
    this.#withhold = options.withhold
  }

  async providers(cid: CID): Promise<readonly PublicKeyHex[]> {
    if (!(await this.#store.has(cid))) return []
    // Asked only about blocks this node actually holds, which is what "must not be
    // advertised even though this node holds it" means — and it keeps the production
    // predicate, which reads bytes, off every lookup for a block nobody has.
    if (this.#withhold !== 'advertises-everything-it-holds' && (await this.#withhold(cid))) {
      return []
    }
    return [this.#nodeKey]
  }

  async recordsFor(nodeKey: PublicKeyHex): Promise<NodeRecords | undefined> {
    if (nodeKey !== this.#nodeKey) return undefined
    return this.#records === 'holds-no-records' ? undefined : this.#records
  }
}
