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
 * ## The capability record has an extension seam, and why it had to grow one
 *
 * `capabilityPayload` signed five named fields and `@o2/net`'s parser rebuilt six,
 * **dropping every key it had never heard of.** So the first node to sign a record
 * carrying a new field would have been reported `invalid-capability-record` by every older
 * peer: the reader's own parser removed a field the signer had signed, the payload no
 * longer recomputed, and the signature no longer checked. The reader would then blame the
 * signer for a frame the reader had damaged. `protocol.ts` had already ruled that class of
 * misattribution out for the **sibling** record, in its own words about the certificate's
 * optional X.509 field — *"a certificate stripped of a field its issuer signed no longer
 * verifies and the reader would be told `bad-signature` about a frame this parser had
 * damaged"* — and `NodeCertificate` got the fix while `CapabilityRecord` did not.
 *
 * **The certificate's fix would not have been enough here, and the difference is the whole
 * design.** A known-optional field buys BACKWARD compatibility: a signer that omits it
 * produces bytes an older reader still parses. It buys no FORWARD compatibility at all —
 * an older reader meeting a field it has never heard of still drops it. X.509 was a
 * lockstep change, and the conditional spread protected already-issued certificates rather
 * than older readers.
 *
 * So the seam is {@link CapabilityExtension}: `{ id, critical, value }`, covered by the
 * signature, ordered by id, duplicates refused, and **preserved verbatim by the parser
 * including ids this build has never heard of**. Unknown and non-critical is verified and
 * ignored; unknown and critical is refused as `critical-extension-not-understood`, an
 * exclusion whose text names *this build* rather than the peer.
 *
 * **What it costs, stated rather than left to be discovered.** Adding the field is itself a
 * breaking change for peers built before it existed, and no design removes that. Two things
 * are true alongside it. It is the **last** one — after this, a capability field rides
 * inside `extensions` and an older reader verifies the record and either ignores the field
 * or refuses by name. And the blast radius is narrowed to records that actually carry an
 * extension: `extensions: []` is spread conditionally, so a record with none produces the
 * byte-identical payload it produced before the field existed, and a node upgrading to this
 * build does not become unreadable to its older neighbours merely by restarting.
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
 * One statement a later build put into a capability record, carried by every build.
 *
 * ## Why this shape and not "carry unknown top-level keys through"
 *
 * X.509's own answer, which this repository already has a profile for. The alternative —
 * a parser that preserves whatever keys it does not recognise — buys the same forward
 * compatibility and gives up two things that are worth more than the saving. It has no
 * place to say *"a reader that cannot honour this must refuse"*, so a security-relevant
 * field would be ignored by exactly the peers that could not enforce it; and it makes the
 * record's own shape unbounded, so no reader can say what it is holding.
 *
 * ## `critical` is the whole mechanism, and it is inside the signature
 *
 * `false` means *ignore me if you do not know me*: an older reader verifies the record,
 * preserves the extension, and proceeds. `true` means *refuse rather than proceed without
 * me* — a node that says "I execute only under this policy" must not be dispatched to by a
 * peer that cannot read the policy. Both flags are covered by the node's signature, so a
 * peer cannot downgrade somebody else's `true` to a `false` to get past a refusal.
 *
 * ## `value` is open so that this envelope can stay closed
 *
 * Anything a later build needs to say goes **inside** `value`, never as a fourth key
 * beside it. `CanonicalValue` already admits every shape DAG-CBOR can carry, and the
 * codec's canonical map ordering makes it deterministic without further rules. That is why
 * `@o2/net`'s parser refuses an extension carrying a fourth key rather than dropping it:
 * dropping would recreate, one level further down, the exact defect this seam removes.
 */
export interface CapabilityExtension {
  /**
   * What this extension is, globally. Not interpreted here beyond ordering and
   * uniqueness — this module never knows what any id means.
   */
  readonly id: string
  /** Whether a reader that does not understand `id` must refuse the node. */
  readonly critical: boolean
  readonly value: CanonicalValue
}

/**
 * A capability record naming one extension id twice, refused at signing time.
 *
 * **Thrown rather than returned, and the distinction is the same one
 * {@link NotEncodableError} exists to protect.** A verdict from
 * {@link verifyCapabilityRecord} is a statement about a *peer's* record. Two extensions
 * under one id in a record this node is about to sign is a statement about *this build* —
 * nobody sent it, and no peer can fix it. Putting it in the verdict channel would be the
 * same conflation that once made an encoder defect read on the wire as a peer forging a
 * signature.
 *
 * Off the wire the same condition is not a defect in this build but a malformed record
 * from a peer, so it is reported as `false` by `verifyCapabilityRecord` and refused
 * outright by `@o2/net`'s parser. One condition, two honest attributions.
 */
export class DuplicateExtensionError extends Error {
  /** The id that appeared more than once. */
  readonly id: string
  constructor(id: string) {
    super(`capability record names extension ${id} more than once`)
    this.name = 'DuplicateExtensionError'
    this.id = id
  }
}

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
  /**
   * Everything this record says that this build may not have a name for — the forward
   * compatibility seam. See {@link CapabilityExtension}.
   *
   * **Required, not optional, and the churn that costs is the point.** Every signer in
   * this repository states its extensions explicitly, including the ones that state none,
   * so "I forgot" and "I have none" are not the same expression. The absence of the seam
   * is what made the first record carrying a new field read as
   * `invalid-capability-record` on every older peer; an optional field would leave the
   * same silence available at every call site.
   */
  readonly extensions: readonly CapabilityExtension[]
  readonly signature: string
}

type OrderedExtensions =
  | { readonly ok: true; readonly ordered: readonly CapabilityExtension[] }
  | { readonly ok: false; readonly duplicate: string }

const UTF8 = new TextEncoder()

/**
 * Order two extension ids by their **UTF-8 bytes**, not by JS's `<`.
 *
 * ## Why the obvious comparator is wrong, even though nothing in this repository can see it
 *
 * `a.id < b.id` compares UTF-16 **code units**, and the two orders disagree for every id
 * carrying an astral code point: `'urn:o2:\u{10000}'` is stored as a surrogate pair
 * beginning `\uD800`, so `<` sorts it before `'urn:o2:＀'` (`＀`), while its UTF-8
 * bytes `f0 90 80 80` sort it after `＀`'s `ef bc 80`.
 *
 * Every peer in this repository is JavaScript, so every peer computes the same wrong
 * order together and no record ever fails. **That is exactly the shape of defect this
 * seam exists to remove**: the extension list is a contract for builds that do not exist
 * yet, and the first non-JS peer to sort by bytes — which is what a language without
 * UTF-16 strings does by default, and the terms DAG-CBOR's own map-key rule is expressed
 * in — computes a different signed payload and reports `invalid-capability-record` about a
 * record that was signed correctly. A claim about the signer, caused by the reader, one
 * layer below where this file already refuses it.
 *
 * **Bytewise, not DAG-CBOR's length-then-bytewise, and the difference is deliberate.**
 * That rule governs *map keys inside the encoding*, which the encoder applies on its own.
 * This is the order of a **list**, which is ours to define and which a second
 * implementation has to be told; plain bytewise lexicographic is the rule that reads the
 * same in every language and needs no reference to the enclosing codec.
 *
 * Exported because `@o2/net`'s `asExtensions` sorts the list it takes off the wire with
 * this same function. Two comparators that agree today and are maintained apart are the
 * failure this file has already paid for once in `capabilitiesToValue`'s conditional
 * spread; one function is the only version of "they agree" that stays true.
 */
export function compareExtensionIds(a: string, b: string): number {
  const left = UTF8.encode(a)
  const right = UTF8.encode(b)
  for (const [index, byte] of left.entries()) {
    const other = right[index]
    // `right` ran out first, so it is a strict prefix of `left` and sorts before it.
    if (other === undefined) return 1
    if (byte !== other) return byte < other ? -1 : 1
  }
  // `left` is a prefix of `right`, or the two are equal.
  return left.length === right.length ? 0 : -1
}

/**
 * Sort extensions by id and refuse a repeated one.
 *
 * Sorting rather than preserving the caller's order is what makes the signature
 * independent of a list order nothing on the wire promises to keep — `@o2/net` carries
 * extensions verbatim precisely so an unknown one survives untouched, which means a
 * verifier can be handed the list in whatever order it was sent.
 *
 * Two extensions under one id have no single meaning: a reader asking "what does this
 * node say about X" would get two answers and no rule for choosing, and a rule invented
 * later would differ per build. Refused at both ends rather than resolved.
 */
function orderExtensions(extensions: readonly CapabilityExtension[]): OrderedExtensions {
  const ordered = [...extensions].sort((a, b) => compareExtensionIds(a.id, b.id))
  for (let i = 1; i < ordered.length; i++) {
    const previous = ordered[i - 1]
    const current = ordered[i]
    if (previous !== undefined && current !== undefined && previous.id === current.id) {
      return { ok: false, duplicate: current.id }
    }
  }
  return { ok: true, ordered }
}

type CapabilityPayload =
  | { readonly ok: true; readonly bytes: Uint8Array<ArrayBuffer> }
  | { readonly ok: false; readonly duplicate: string }

function capabilityPayload(record: Omit<CapabilityRecord, 'signature'>): CapabilityPayload {
  const extensions = orderExtensions(record.extensions)
  if (!extensions.ok) return extensions
  const value: CanonicalValue = {
    nodeKey: record.nodeKey,
    features: [...record.features].sort(),
    sovereignFor: [...record.sovereignFor].sort(),
    issuedAt: record.issuedAt,
    expiresAt: record.expiresAt,
    // Conditionally spread, never `extensions: []`, and the reason is `payloadOf`'s own
    // for the certificate's X.509 field: **a record with no extensions must produce the
    // byte-identical payload it produced before this field existed.** That is what keeps
    // this change free for a node that is not yet using the seam — upgrading does not
    // make it unreadable to its older neighbours the moment it restarts. Only a record
    // that actually carries an extension is unreadable to a peer built before the seam,
    // and that record is the one the seam exists for. `capabilitiesToValue` in `@o2/net`
    // spreads by the identical rule; the two have to match, and a reader changing one is
    // told here about the other.
    ...(extensions.ordered.length === 0
      ? {}
      : {
          extensions: extensions.ordered.map((one) => ({
            id: one.id,
            critical: one.critical,
            value: one.value,
          })),
        }),
  }
  const encoded = encodeCanonical(value)
  if (!encoded.ok) throw new NotEncodableError('capability record', encoded.error)
  return { ok: true, bytes: encoded.bytes }
}

/** Sign a capability record with the node's own key. The private key never leaves. */
export function publishCapabilities(
  nodePrivateKey: Uint8Array,
  fields: Omit<CapabilityRecord, 'nodeKey' | 'signature'>,
): CapabilityRecord {
  const extensions = orderExtensions(fields.extensions)
  if (!extensions.ok) throw new DuplicateExtensionError(extensions.duplicate)
  const unsigned = {
    ...fields,
    nodeKey: toHex(ed25519.getPublicKey(nodePrivateKey)),
    features: [...fields.features].sort(),
    sovereignFor: [...fields.sovereignFor].sort(),
    // Stored in canonical order, so the record a node publishes is byte-identical to the
    // one it signed rather than merely equivalent to it.
    extensions: extensions.ordered,
  }
  const payload = capabilityPayload(unsigned)
  // Unreachable: `unsigned.extensions` was just ordered and de-duplicated. Handled
  // rather than asserted away, because the alternative is a non-null assertion on a
  // union this file is the only writer of, and the cost of the branch is one line.
  if (!payload.ok) throw new DuplicateExtensionError(payload.duplicate)
  return { ...unsigned, signature: toHex(ed25519.sign(payload.bytes, nodePrivateKey)) }
}

/** Verify a capability record against its own node key. Offline, like everything here. */
export function verifyCapabilityRecord(record: CapabilityRecord, now: number): boolean {
  if (record.issuedAt > now || record.expiresAt <= now) return false
  // Above the `try` — `capabilityPayload` throws `NotEncodableError` by design, and
  // a record this package cannot encode is not a record that failed to verify.
  const payload = capabilityPayload(record)
  // A repeated extension id is a malformed record, so it is a verdict here — `false` —
  // and not the throw `publishCapabilities` raises for the same condition. Same
  // condition, two parties, two honest attributions: a signer that tries to build one is
  // told by name, a reader handed one gets a verdict about the record.
  //
  // **This branch is NOT the wire's path, and the docblock claimed it was until
  // 2026-08-12.** `@o2/net`'s `asExtensions` refuses a repeated id at the frame, so a
  // duplicate arriving over RPC never reaches this function — `parseResponse` returns
  // `null` first. What does reach it is an in-process record: a fixture, a caller that
  // assembled a `CapabilityRecord` by hand, or a future index that does not go through
  // `parseResponse`. The behaviour is right for all of those; the transport story was
  // not, and a comment asserting a fact about every call site is a claim with an expiry
  // date.
  if (!payload.ok) return false
  try {
    return ed25519.verify(fromHex(record.signature), payload.bytes, fromHex(record.nodeKey))
  } catch {
    return false
  }
}

/**
 * The extension ids **this build** knows how to honour.
 *
 * Empty, and that is the honest state rather than a stub: no extension id has a consumer
 * in this repository yet. It is the registry a build adds to when it grows one, and it is
 * deliberately a build-level constant rather than a configuration knob — "do I understand
 * this" is a fact about the code that is running, not a policy somebody sets.
 *
 * A caller that handles an extension out of band declares it through
 * {@link DiscoveryOptions.understands}, which is *added to* this set rather than replacing
 * it. Not exported: a consumer that could read it would be tempted to branch on it, and
 * the only correct question is the one `discoverExecutors` already asks.
 *
 * **Being empty makes `unhonouredCritical`'s test of this set constant-true, and the
 * deferral that keeps it that way is checked rather than remembered.** `understands` has no
 * production caller either — `discoverCandidates` has no field to forward it through — and
 * the owner ruled on 2026-08-11 not to wire it now, because threading an option nothing can
 * populate reaches a check that cannot fail. The hazard in that ruling is *sequencing*, not
 * correctness: the first extension **producer** to land before the reader makes every node
 * publishing a critical extension undiscoverable fleet-wide with no opt-in path.
 * `packages/node/src/extension-sequencing.node.test.ts` reddens on exactly that ordering and
 * names the remedy. Adding an id here is one of the two things that arms it.
 */
const UNDERSTOOD_EXTENSIONS: ReadonlySet<string> = new Set<string>()

/**
 * The critical extensions on a record that neither this build nor the caller understands.
 *
 * **Ordered as the record orders them, and every path that builds a record orders it by
 * id — which is the part that had to be made true rather than asserted.** This sentence
 * read the same before 2026-08-12 and was false for exactly the records that matter:
 * `publishCapabilities` stores the sorted list, so a locally-signed record was ordered,
 * but a record off the wire was ordered by whoever sent it. `capabilityPayload` sorts only
 * its own copy, so a relay could reorder a signed record's extensions, have it verify
 * (correctly — the signature is order-independent by design), and choose the order these
 * ids appear in. `@o2/net`'s `asExtensions` now sorts with {@link compareExtensionIds},
 * the same function `orderExtensions` uses, so the two producers of a `CapabilityRecord`
 * agree and this claim holds for both.
 *
 * Non-critical unknowns are absent by construction — being ignorable is what `false`
 * means, and that is the forward compatibility this whole seam buys.
 */
function unhonouredCritical(
  record: CapabilityRecord,
  understands: ReadonlySet<string>,
): readonly string[] {
  return record.extensions
    .filter(
      (one) => one.critical && !UNDERSTOOD_EXTENSIONS.has(one.id) && !understands.has(one.id),
    )
    .map((one) => one.id)
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
  /**
   * The {@link RecordIndex} handed back nothing for this key — **and that is the whole of
   * what this arm knows.**
   *
   * It is not a statement that no index holds the records, and its `detail` said exactly
   * that until 2026-08-12. `recordsFor` returns `NodeRecords | undefined`, so every way of
   * failing to produce records collapses into one `undefined` before it reaches here: the
   * index genuinely holds none, every peer was unreachable, or **a peer answered and this
   * build's own parser refused the frame**. `RpcRecordIndex.recordsFor` swallows all three
   * identically, which it must, because the port gives it no other vocabulary.
   *
   * The third case is the uncomfortable one and it is named rather than hidden: a
   * capability record carrying a top-level key this build does not know refuses the whole
   * frame in `@o2/net`'s `parseCapabilities`, and the peer arrives here as if no index had
   * ever heard of it — its certificate discarded along with its claims. See that file's
   * `CAPABILITY_KEYS` docblock, which states the trade from the other end. Widening the
   * port so the refusal could be named here is a change to a shared interface with four
   * production implementations and every caller's `=== undefined` check, and it was
   * **declined** on this branch rather than overlooked; what was not acceptable was a
   * `detail` that asserted a fact about the index nobody at this layer can know.
   */
  | { readonly kind: 'no-records'; readonly nodeKey: PublicKeyHex }
  | {
      readonly kind: 'invalid-certificate'
      readonly nodeKey: PublicKeyHex
      readonly failure: CertificateFailure
    }
  | { readonly kind: 'invalid-capability-record'; readonly nodeKey: PublicKeyHex }
  /**
   * The record verified and **this reader is the one that cannot use it** — the arm that
   * exists so that a forward-compatibility limit is never reported as a signature fault.
   *
   * Without it there is no way to say this. The node would fall into
   * `invalid-capability-record`, which asserts that the peer sent a record it did not
   * sign — false, unfixable by whoever reads it, and pointing the operator at the wrong
   * machine. `protocol.ts` already refuses that trade for the sibling record: *"the
   * reader would be told `bad-signature` about a frame this parser had damaged."*
   */
  | {
      readonly kind: 'critical-extension-not-understood'
      readonly nodeKey: PublicKeyHex
      /** Every critical id this build could not honour, in the record's own order. */
      readonly extensionIds: readonly string[]
    }
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
  /**
   * Extension ids this caller handles out of band, added to what the build knows.
   *
   * **Optional, and the default is the strict one** — omitting it means "I understand
   * only what this build understands", under which every unknown critical extension is
   * refused by name. That is the opposite disposition from the optional-hook-with-a-
   * silent-default this repository refuses elsewhere (`CandidateOptions.dispatch`), and
   * it is opposite because the defaults point opposite ways: there, omission would
   * dispatch unauthenticated and nothing would fail; here, omission refuses, loudly, with
   * the ids named.
   *
   * **No production caller supplies it**, and that is a recorded deferral rather than an
   * oversight — see {@link UNDERSTOOD_EXTENSIONS} for the owner's ruling and for the guard
   * that reddens if an extension producer arrives before this is wired.
   */
  readonly understands?: ReadonlySet<string>
}

function describe(reason: ExclusionReason): string {
  switch (reason.kind) {
    case 'no-records':
      return (
        `${reason.nodeKey} provides the data but no records for it reached this ` +
        `reader — the index holds none, no peer answered, or an answer was refused as ` +
        `unreadable by this build`
      )
    case 'invalid-certificate':
      return `${reason.nodeKey} has an unusable certificate (${reason.failure.kind})`
    case 'invalid-capability-record':
      return `${reason.nodeKey} has an unusable capability record`
    case 'critical-extension-not-understood':
      return (
        `this build does not understand ${reason.extensionIds.join(', ')}, which ` +
        `${reason.nodeKey} marked critical — its record verified, and this reader is ` +
        `the one that cannot honour it`
      )
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
  const understands = options.understands ?? new Set<string>()
  const providers = [...new Set(await index.providers(query.inputCid))].sort()

  const executors: DiscoveredExecutor[] = []
  const excluded: Exclusion[] = []
  const exclude = (reason: ExclusionReason): void => {
    excluded.push({ reason, detail: describe(reason) })
  }

  // ## The lookups are concurrent, and that is a bound rather than a speed-up
  //
  // This loop read `await index.recordsFor(nodeKey)` **inside** the iteration until
  // 2026-08-23, so the cost of a lookup was `providers × per-lookup`. That was free while
  // the only index asked directly-connected peers, and it stopped being free the moment a
  // DHT answered: `DHT_QUERY_TIMEOUT_MS` is 5 000 and `CANDIDATES_DEADLINE_MS` is also
  // 5 000, so **two** providers whose records the DHT does not hold spend the whole page
  // budget before the second one has been asked.
  //
  // That is not a prediction. `attestation-ui.e2e.test.ts`'s SCHED-01 case went red the
  // first time provider announcement put a second, recordless provider in front of the
  // page, with `no answer inside 5000ms` — and the risk was named and declined in
  // `REQUIREMENTS.md`'s NET-06 row on exactly these three numbers before it landed.
  //
  // The providers are independent — nothing in the loop below reads another provider's
  // record — so asking them together makes the worst case one lookup rather than N.
  //
  // **The output is unchanged, deliberately.** The verification loop still runs in sorted
  // provider order over the resolved values, so `executors` and `excluded` come out in the
  // same order as before; only the waiting is shared. A rejection is re-thrown at the
  // *earliest provider index* that produced one rather than at whichever rejected first in
  // time, because that is what the sequential loop did and a caller catching it should not
  // learn about a different provider than it used to.
  const settled = await Promise.allSettled(providers.map((nodeKey) => index.recordsFor(nodeKey)))
  const firstRejection = settled.find((outcome) => outcome.status === 'rejected')
  if (firstRejection !== undefined && firstRejection.status === 'rejected') {
    throw firstRejection.reason
  }

  for (const [position, nodeKey] of providers.entries()) {
    const outcome = settled[position]
    const records = outcome?.status === 'fulfilled' ? outcome.value : undefined
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

    // Asked only after the record has verified, and the order is the whole argument for
    // the arm existing: at this point the signature is known good, so anything refused
    // below is refused by THIS build's limits and must not be reported as the peer's
    // fault. A record naming a critical extension nobody here can honour is a truthful
    // statement this reader cannot act on.
    const unhonoured = unhonouredCritical(capabilities, understands)
    if (unhonoured.length > 0) {
      exclude({ kind: 'critical-extension-not-understood', nodeKey, extensionIds: unhonoured })
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
 *
 * ## Deliberately uncomposed, by owner decision 2026-08-08 — audit finding G7
 *
 * **This class and {@link MemoryRecordIndex} have no production caller, and that is a
 * decision rather than an oversight.** The v1.1 milestone audit raised it as an unwired
 * capability and the honest answer was to leave it unwired: **a fallback chain needs a
 * genuine second source, and this repository does not have one yet.**
 *
 * What was rejected, and why it is worth naming: putting an empty `MemoryRecordIndex` in
 * front of the RPC index would compose the types, satisfy the finding, and demonstrate
 * nothing — a chain whose first link is always empty always falls through, so no test
 * could distinguish it from calling the RPC index directly. That is decoration, and this
 * repository's own rule is that **descoped is not satisfied**.
 *
 * The candidate second source is a node's own store answering without a round trip. It is
 * real work with a real test — the fallback must be *observed* to fire — and it is not
 * scheduled here.
 *
 * **The last sentence read *"Until it is, NET-06 stays open and says so"* until 2026-08-18,
 * and it is corrected rather than deleted, because it was a true reading of that row's
 * state and a wrong reading of what held it open.** NET-06's open leg was never this class:
 * it was that no browser-tier path *selected* executors from an index answer, while
 * `bin/bench.ts --discover` did — a browser-versus-backbone asymmetry, which is the whole
 * of what that id claims. `packages/browser/demo/main.ts`'s `discoveredPool` closed it, and
 * the row is `[x]`. **This class is still uncomposed and still unwired, on exactly the
 * argument above, which nothing here withdraws.** A second source does now exist in
 * production — `DhtRecordIndex` asks the DHT and falls back to the RPC index — but it
 * composes that itself rather than through this port, so what is deferred is this class,
 * not the capability. `reachability-dispositions.ts` carries the disposition.
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
