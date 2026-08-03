/**
 * The third signing leg — a result the node that produced it signed. VER-08, VER-09,
 * VER-10.
 *
 * Two legs already existed before this file. The **code** a node runs is signed by its
 * publisher and checked against pinned `trustAnchors` (`naming.ts`, through
 * `executor/module-provenance.ts`, Phase 14). The **node's certificate** is signed by
 * its provider and checked against pinned `trustedIssuers` (`enrollment.ts`, Phase 17).
 * The third — *this node computed this output* — did not exist, and this file is it.
 *
 * ## What this buys
 *
 * Agreement was attested by **transport authentication only**. Noise proves that peer X
 * sent this frame, but that proof is not transferable: the submitter cannot show it to
 * anybody. `VerificationResult`'s `agreed` arm carried `agreeing: readonly string[]` —
 * plain node-id **strings** — and a receipt built on those is worth exactly the
 * submitter's own word about itself. Plan 19-14 replaced that array with
 * `AgreeingReplica`, so each entry now carries an {@link AttestedResult}; this file is
 * what those entries are checked with.
 *
 * A `ResultAttestation` replaces that with a statement a stranger can check. A third
 * party holding **only the provider's public key** can establish: this output came from
 * a node that provider enrolled, running code that provider published. Nothing is
 * fetched, nothing is asked of an authority, and no shared list is consulted.
 *
 * ## What this does NOT buy, and somebody will propose otherwise within two phases
 *
 * It says a certified node computed this output. It says **nothing** about whether the
 * output is *correct*. Correctness is N-version comparison's answer and lives in
 * `job/verify.ts`'s `executeVerified`; a signature on a wrong answer is a signed wrong
 * answer, and it is signed just as convincingly as a right one.
 *
 * So a signature is **not** a reason to reduce redundancy. The proposal will arrive
 * phrased as "results are attributable now, so R=1 is enough", and it is wrong for a
 * reason that has nothing to do with cryptography: attribution tells you *who* to stop
 * trusting **after** you already know the answer was wrong, and the only thing in this
 * design that tells you the answer was wrong is a second independent execution.
 *
 * ## The replay property, stated rather than left to be found
 *
 * The challenge covers the work, the answer and the signer, and **nothing
 * time-varying** — no nonce, no validity window. An attestation is therefore valid
 * forever for that `(work, output, node)` triple. That is intended: it is exactly what
 * makes the statement transferable, and it means a node cannot be made to un-say
 * something it said. If a later phase needs freshness, the place for it is the
 * certificate's own `expiresAt`, which `verifyResultAttestation` already checks against
 * the caller's clock — not a nonce here, which would make the statement checkable only
 * by whoever issued the nonce.
 *
 * There is no revocation list here and there must not be one. Revocation in this design
 * is **non-renewal**: a node that misbehaves is not re-certified and its certificate
 * lapses on its own clock, with trust pinned per verifier. Nothing global is agreed by
 * anybody.
 *
 * ## What verification costs, in prose, deliberately unmeasured
 *
 * **Signing** is one Ed25519 signature over a fixed-size digest of the challenge, so it
 * does not grow with the output. The browser tier's outputs are bounded at 16 KiB per
 * message by WebRTC in any case.
 *
 * **Verifying is the side that scales, and it is the requestor's.** One Ed25519 verify
 * per agreeing replica per shard: roughly **600 verifies for a 300-shard job at
 * redundancy 2**, and Ed25519 verify is two to three times the cost of sign. On a
 * browser submitter that is main-thread work.
 *
 * No wall-clock assertion exists anywhere in this file's spec, and none should be added:
 * the figures above are shapes, not readings. If this ever binds, the levers are batch
 * verification, verifying only at the moment a receipt is rendered, and sampling — each
 * of those is a decision somebody has to take, not an implementation detail.
 *
 * ## Why `@noble/curves` and not `crypto.subtle`
 *
 * `packages/libp2p/src/identity.ts:59-75` records the reason: a LAN `http://` origin is
 * not a secure context, so `crypto.subtle` is `undefined` there while `getRandomValues`
 * works. `enrollment.ts` already signs with `ed25519` from `@noble/curves/ed25519.js`
 * and this file uses the same import and nothing else.
 *
 * Pure module: no clock of its own, no I/O, no platform imports.
 */

import { ed25519 } from '@noble/curves/ed25519.js'
import type { CID } from 'multiformats/cid'
import { NotEncodableError, encodeCanonical } from './canonical/encode.ts'
import { fromHex, toHex } from './capability.ts'
import type { PublicKeyHex } from './capability.ts'
import { verifyCertificate } from './enrollment.ts'
import type { CertificateFailure, NodeCertificate } from './enrollment.ts'

/**
 * The unit of work an `exec` attestation is about.
 *
 * Deliberately *not* a `Task`. A `Task` carries `partitionCount`, a label, an owner and
 * a name record, none of which the signature covers; taking the narrow shape is what
 * stops a future field silently joining the signed set.
 */
export interface ResultWork {
  readonly moduleCid: CID
  readonly inputCid: CID
  readonly partitionIndex: number
  /** `canonicalCid` of the output the node produced — the answer being attested. */
  readonly outputCid: CID
}

/**
 * The bytes a node signs to say *I computed this output for this unit of work*.
 *
 * The shape is `possessionChallenge`'s, copied deliberately: one function produces the
 * signed bytes, with its purpose string **inside** the canonical encoding, so there is
 * no second encoding anywhere to keep canonical. That is the entire reason
 * `possessionChallenge` looks the way it does, and the reason both challenges in this
 * file live in one module rather than growing a sibling later.
 *
 * `'o2-result'` is the domain separator. Without a distinct purpose, bytes signed for
 * one protocol could be replayed as an answer in another — which is the whole job the
 * `'o2-enrol'` string is doing next door.
 *
 * **What each signed field carries, measured rather than asserted:**
 *
 * - `moduleCid`, `inputCid`, `partitionIndex` — the *work*. Drop any of them and a
 *   signature lifted off one task verifies against another: one node's answer to one
 *   shard becomes its answer to every shard. Observed by deleting `partitionIndex` from
 *   this encoding — two cases in `result-attestation.test.ts` go red.
 * - `outputCid` — the *answer*. Drop it and a node could sign once and have that one
 *   signature stand for anything it later returned. Observed the same way.
 * - `nodeKey` — the *signer*, **and it is not what binds the statement to its signer.**
 *   This was checked, not assumed: deleting `nodeKey` from this encoding leaves the whole
 *   spec green, including the case that presents node A's signature under node B's
 *   certificate. The binding is Ed25519's own — `verifyResultAttestation` verifies under
 *   `certificate.nodeKey`, so a signature made with A's seed cannot check under B's key
 *   whatever bytes were signed. What `nodeKey` in the challenge does buy is that two
 *   nodes answering the same shard identically sign **different bytes**, so an
 *   attestation is self-describing at the byte level rather than only in company with
 *   the certificate it travels with. That is the reading its spec case asserts, because
 *   it is the one that fails when the field goes. `possessionChallenge` carries
 *   `nodeKey` under exactly the same conditions, and the same correction applies there.
 *
 * **`partitionCount` is deliberately out.** It is a property of the *job*, not of this
 * unit of work. Including it would make the same shard over the same input signed
 * differently in two jobs that happened to split the work differently — a difference
 * with no meaning to anyone checking the statement.
 *
 * The encode sits **above** any `try` in every caller, and `enrollment.ts:244-250`
 * records why: `NotEncodableError` is a codec defect in *this* package, and catching it
 * would report it as the peer's fault.
 */
export function resultChallenge(work: ResultWork, nodeKey: PublicKeyHex): Uint8Array<ArrayBuffer> {
  const encoded = encodeCanonical({
    purpose: 'o2-result',
    moduleCid: work.moduleCid,
    inputCid: work.inputCid,
    partitionIndex: work.partitionIndex,
    outputCid: work.outputCid,
    nodeKey,
  })
  if (!encoded.ok) throw new NotEncodableError('result challenge', encoded.error)
  return encoded.bytes
}

/**
 * The bytes a node signs to say *I merged these inputs into this result*.
 *
 * Defined here, with the exec challenge, rather than beside the combine wire — and the
 * reason is the one `possessionChallenge`'s shape exists to serve. `PROJECT.md` states
 * the headline claim as *the owner's contribution is trusted; the aggregation over
 * contributions is verified*. Sign `exec` alone and a map/reduce job ends with signed
 * map results feeding an **unsigned aggregation** — precisely the half claimed to be
 * the verified one. Two modules with two encodings to keep canonical is the failure
 * mode; one file that is the authority on what this fabric signs is the fix.
 *
 * `combineChallenge` has **no caller in this plan** and is consumed by Plan 19-16,
 * which builds the combine wire. It is here now because adding it later would have
 * meant a second module.
 *
 * **`inputCids` are encoded in the order they were merged, and are NEVER sorted.** A
 * combine's output depends on input order, so a sorted encoding would sign a claim
 * about a merge that did not happen. Sorting is the reflex here — `payloadOf` in
 * `enrollment.ts:131` sorts `relayIds`, and that is correct *there* because a relay set
 * is a set. This is a sequence, and the difference is the whole point.
 *
 * The inputs are the work's identity for the reason `agent.ts:400-409` already records:
 * a combine's output is a pure function of `inputCids`, whereas `combineId` is a
 * requestor's *claim* about where in a tree the node sits. Signing the claim would let
 * one peer present the same merge under any number of names.
 */
export function combineChallenge(
  inputCids: readonly CID[],
  resultCid: CID,
  nodeKey: PublicKeyHex,
): Uint8Array<ArrayBuffer> {
  const encoded = encodeCanonical({
    purpose: 'o2-combine',
    // Merge order. Never `.sort()`. See above.
    inputCids: [...inputCids],
    resultCid,
    nodeKey,
  })
  if (!encoded.ok) throw new NotEncodableError('combine challenge', encoded.error)
  return encoded.bytes
}

/**
 * A node's signed statement about one output it produced.
 *
 * **It carries the whole certificate, not a bare key.** The stated goal is a third party
 * holding *only the provider's public key*; a reader given a bare `nodeKey` would have
 * to go and fetch a certificate for it, and a reader who has to fetch something does not
 * have that property. Self-contained is the requirement, and this is what it costs.
 *
 * **`nodeKey` is not repeated beside the certificate.** The signing key is
 * `certificate.nodeKey` and appears once. Two copies of one value is a disagreement
 * waiting to be introduced, and the disagreement would surface as an unexplainable
 * signature failure.
 *
 * **The cost of carrying it is 612 DAG-CBOR bytes**, measured 2026-08-03 by encoding a
 * real attestation over a certificate this repository's own `EnrollmentAuthority`
 * issued, with one relay id and a short operator string. The plan for this work
 * estimated ~300 and was low by a factor of two; the arithmetic is why, and it is
 * unavoidable rather than sloppy: three hex keys at 64 characters, two hex Ed25519
 * signatures at 128, and DAG-CBOR stores hex as text because these fields are strings
 * in the certificate the provider signed. It grows with `relayIds` and `operatorId` and
 * with nothing else.
 *
 * That is a reading of one shape, not a bound. It sits against NET-08's inbound ceiling
 * and the browser tier's 16 KiB per-message WebRTC bound, and is comfortably inside
 * both — 612 bytes is under 4% of a WebRTC message.
 */
export interface ResultAttestation {
  readonly certificate: NodeCertificate
  /** Hex Ed25519 signature over {@link resultChallenge}, by `certificate.nodeKey`. */
  readonly signature: string
}

/**
 * An attestation, **or** the named statement that this executor does not sign.
 *
 * Required with a named sentinel rather than optional — the `AgentOptions` rule, for the
 * reason `.planning/PROJECT.md` records: *an optional hook with a silent default is a
 * hole*. Here the hole has a specific shape. An omitted field read as "attested" would
 * make an unsigned result indistinguishable from a signed one at the exact point the
 * receipt is computed, which is the one place in this phase where that distinction *is*
 * the product.
 *
 * `'signed-by-nobody'` is a truthful statement by an executor nobody enrolled. It is not
 * a degraded mode and it is not an error: the four kernel executors report it by
 * construction, because a kernel that signed would need an identity, and keeping an
 * identity out of the kernel is what `ports.ts` exists for.
 */
export type AttestedResult = ResultAttestation | 'signed-by-nobody'

/**
 * What a node needs in order to sign: its own 32-byte seed and its own certificate.
 *
 * The public key is **derived** from the seed and never accepted as a field — the same
 * discipline `requestEnrollment` applies, for the same reason: naming somebody else's
 * key is not a thing this function can be asked to do.
 */
export interface ResultSigner {
  /** The node's Ed25519 seed. Never leaves the device and is never encoded. */
  readonly nodeSeed: Uint8Array
  /** The provider-signed certificate naming the public half of `nodeSeed`. */
  readonly certificate: NodeCertificate
}

/**
 * A signer whose seed does not match the certificate it was handed.
 *
 * Thrown rather than returned, and it is the same call this package already makes for
 * `NotEncodableError`: this is **a defect in the node's own construction**, not a
 * verdict about anything a peer sent. A node in this state can produce nothing anybody
 * will accept, so the honest move is to fail loudly where the two values were put
 * together — which is why {@link attestResults} makes this check once, at composition,
 * rather than once per task.
 */
export class WrongSigningKeyError extends Error {
  readonly derived: PublicKeyHex
  readonly certified: PublicKeyHex
  constructor(derived: PublicKeyHex, certified: PublicKeyHex) {
    super(
      `the signing seed's public half is ${derived}, but the certificate names ${certified} — ` +
        'this node cannot sign for a key it does not hold',
    )
    this.name = 'WrongSigningKeyError'
    this.derived = derived
    this.certified = certified
  }
}

/**
 * Check a signer's seed against its certificate.
 *
 * Exported so a wrapper can make the check at construction. Throws
 * {@link WrongSigningKeyError}; returns the derived key so the caller does not derive it
 * twice.
 */
export function signingKeyOf(signer: ResultSigner): PublicKeyHex {
  const derived = toHex(ed25519.getPublicKey(signer.nodeSeed))
  if (derived !== signer.certificate.nodeKey) {
    throw new WrongSigningKeyError(derived, signer.certificate.nodeKey)
  }
  return derived
}

/** Sign one unit of work's output as the node named by `signer.certificate`. */
export function signResult(signer: ResultSigner, work: ResultWork): ResultAttestation {
  const nodeKey = signingKeyOf(signer)
  // Above any `try`, per `enrollment.ts:244-250`.
  const challenge = resultChallenge(work, nodeKey)
  return {
    certificate: signer.certificate,
    signature: toHex(ed25519.sign(challenge, signer.nodeSeed)),
  }
}

/**
 * Why an attestation was not accepted. One name per question, never one kind for all.
 *
 * Phase 6's standing rule is that every exclusion is named, and the cost of ignoring it
 * here is concrete: this repository has twice shipped a refusal that named the wrong
 * thing, and a reader told only `ok === false` would go looking at the signature when
 * the real answer is that they do not trust the provider who issued the certificate.
 */
export type AttestationRefusal =
  /**
   * There is no statement to check — the executor said so by name.
   *
   * Distinct from a bad signature on purpose. An honest peer holding no certificate and
   * a peer whose statement does not check are different events with different answers,
   * and collapsing them would let the first be reported as misconduct.
   */
  | { readonly kind: 'not-attested' }
  /**
   * The certificate did not verify. The forwarded {@link CertificateFailure} keeps
   * `untrusted-issuer`, `bad-signature`, `expired` and `not-yet-valid` under the names
   * `verifyCertificate` already gives them — forwarded rather than re-implemented, so
   * there is one place those four are decided. `ModuleRefusal`'s `unresolvable` arm
   * carries a `ResolveFailure` the same way and for the same reason.
   */
  | {
      readonly kind: 'untrusted-certificate'
      readonly failure: CertificateFailure
      readonly reason: string
    }
  /** The certificate is good and the signature over this work is not. */
  | { readonly kind: 'bad-result-signature'; readonly nodeKey: PublicKeyHex }

export type AttestationResult =
  | { readonly ok: true; readonly certificate: NodeCertificate }
  | { readonly ok: false; readonly failure: AttestationRefusal; readonly reason: string }

/**
 * Check an attestation against pinned issuers and the caller's **own** view of the work.
 *
 * Three questions, in this order:
 *
 * 1. Is there a statement at all, or did the executor say it signs nothing?
 * 2. Does the certificate verify against `trustedIssuers` at `now`?
 * 3. Does the signature verify under `certificate.nodeKey` over the challenge rebuilt
 *    from `work`?
 *
 * **The order is load-bearing, and only in the case where questions 2 and 3 both fail.**
 * That qualifier was measured rather than assumed. Moving the signature check above the
 * certificate check leaves every case with a *good* signature answering exactly as
 * before — a signature-first verifier does not return early on a signature that passes,
 * so it falls through and still reports `untrusted-certificate`. The order is visible
 * only when both fail, and there the answer it changes is the one that matters:
 * verifying a signature under a key taken from a certificate nobody vouched for is
 * checking nothing, so calling the result `bad-result-signature` accuses a peer of
 * forging with a key this verifier never had reason to associate with it.
 * `untrusted-certificate` is a statement about this verifier's own pinning, which is
 * the true one. A refusal naming the wrong thing is a defect this repository has
 * already shipped twice.
 *
 * **`work` comes from the caller and never from the attestation.** That is the whole
 * reason `ResultAttestation` carries no copy of the task: an attestation that could name
 * the work it attests would be a signature over whatever it liked, and would verify
 * against itself every time.
 *
 * Offline, like `verifyCertificate`: the trust anchors are an argument and there is
 * nothing here to reach out to.
 */
export function verifyResultAttestation(
  attested: AttestedResult,
  work: ResultWork,
  trustedIssuers: ReadonlySet<PublicKeyHex>,
  now: number,
): AttestationResult {
  if (attested === 'signed-by-nobody') {
    return {
      ok: false,
      failure: { kind: 'not-attested' },
      reason: 'the executor stated that it signs nothing — there is no attestation to check',
    }
  }

  const certified = verifyCertificate(attested.certificate, trustedIssuers, now)
  if (!certified.ok) {
    return {
      ok: false,
      failure: {
        kind: 'untrusted-certificate',
        failure: certified.failure,
        reason: certified.reason,
      },
      reason: `the attesting node's certificate did not verify: ${certified.reason}`,
    }
  }

  const nodeKey = attested.certificate.nodeKey
  // Above the `try`, not inside it — a challenge this package cannot encode is a codec
  // defect here, not a peer that forged a signature.
  const challenge = resultChallenge(work, nodeKey)

  let valid = false
  try {
    valid = ed25519.verify(fromHex(attested.signature), challenge, fromHex(nodeKey))
  } catch {
    valid = false
  }
  if (!valid) {
    return {
      ok: false,
      failure: { kind: 'bad-result-signature', nodeKey },
      reason: `node ${nodeKey} did not sign this output for partition ${work.partitionIndex} of ${work.inputCid.toString()}`,
    }
  }

  return { ok: true, certificate: attested.certificate }
}
