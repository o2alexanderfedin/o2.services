/**
 * The X.509 profile's issuing half — X509-01…07, the counterpart to `x509.ts`.
 *
 * `x509.ts` refuses. This module is what makes those refusals worth having: without a
 * way to *mint* a certificate the profile accepts, a gate wired into the trust path
 * would be a gate that refuses everything, and "refuses everything" is not a profile.
 *
 * ## Why this is a second file rather than the bottom of `x509.ts`
 *
 * `packages/node/src/x509-bundle.e2e.test.ts` measures the gzip weight a browser page
 * pays for importing and calling `decodeX509Certificate`, and guards it at
 * `DECODER_BUDGET_BYTES = 25600` against a measured ~19064 B. A page that verifies
 * certificates never issues them, so folding the encoder into `x509.ts` would charge the
 * verifying tier for the issuing tier's code and move a number the phase owes for a
 * reason that has nothing to do with the decoder. Kept apart, that measurement stays a
 * measurement of the thing it names.
 *
 * ## Canonical by construction, not by inspection
 *
 * Every byte here goes out through `x509.ts`'s own `encodeDer`, which emits minimal
 * lengths, minimal `INTEGER`s, zeroed `BIT STRING` padding and `0xFF` `BOOLEAN` TRUE.
 * So an artifact of this module satisfies X509-03's re-encode-and-compare gate because
 * it *is* the canonical encoding, not because it was checked against one. One encoder
 * on both sides is also why a signer and a verifier here cannot come to disagree about
 * which bytes were signed.
 *
 * ## What it does not do
 *
 * It does not sign. The signature is a parameter, and that is deliberate: `x509.ts` and
 * this file both stay free of `@noble/curves`, so neither drags the Ed25519 graph into a
 * bundle that only wanted DER. `enrollment.ts` owns the key and does the signing.
 *
 * Pure module: no platform imports, no clock, no randomness. `@ipld/dag-cbor` is a
 * library dependency, exactly as it is for `x509.ts` and `canonical/encode.ts`.
 */

import * as dagCbor from '@ipld/dag-cbor'
import type { DerNode } from './x509.ts'
import {
  EXT_DISCOVERABILITY,
  EXT_OPERATOR_ID,
  EXT_RELAY_IDS,
  EXT_USER_KEY,
  ID_AT_COMMON_NAME,
  ID_ED25519,
  encodeDer,
} from './x509.ts'

/**
 * The envelope fields an X.509 form of a `NodeCertificate` carries.
 *
 * Deliberately the certificate's *own* field names rather than X.509's, so the mapping
 * between the two envelopes is written down once, here, and a reader comparing the two
 * forms is comparing names that match.
 */
export interface X509EncodableFields {
  /** Hex, 32 bytes. Becomes both `subjectPublicKey` and the subject's commonName. */
  readonly nodeKey: string
  /** Hex, 32 bytes. Becomes the `userKey` extension's raw payload. */
  readonly userKey: string
  readonly operatorId: string
  readonly discoverability: 'seed' | 'via-relay'
  readonly relayIds: readonly string[]
  /** Milliseconds. Becomes `notBefore` **truncated to a whole second** — see {@link utcTimeBytes}. */
  readonly issuedAt: number
  /** Milliseconds. Becomes `notAfter`, same truncation. */
  readonly expiresAt: number
  /** Hex, 32 bytes. Becomes the issuer's commonName. */
  readonly issuer: string
}

function prim(tag: number, content: Uint8Array): DerNode {
  return { tag, constructed: false, content, children: [] }
}

function cons(tag: number, children: readonly DerNode[]): DerNode {
  return { tag, constructed: true, content: new Uint8Array(0), children }
}

/**
 * Strict hex → bytes. Deliberately **not** `capability.ts`'s `fromHex`, which is lenient:
 * it runs `Number.parseInt` per pair and writes `NaN`, which a `Uint8Array` store
 * silently turns into `0`. A key that quietly became zeroes is exactly the kind of value
 * that produces a certificate nobody can explain, so this one refuses instead.
 */
function hexToBytes(hex: string, what: string): Uint8Array {
  if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/.test(hex)) {
    throw new RangeError(`${what} is not lowercase hex of even length`)
  }
  const out = new Uint8Array(hex.length >> 1)
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

/**
 * Dotted-decimal OID → DER content bytes: first two arcs packed as `40*X+Y`, every
 * further arc base-128 big-endian with the high bit set on all but the last byte.
 *
 * `BigInt` throughout because this profile's own extension arc is a 128-bit UUID
 * (`X509_EXTENSION_ARC`) and a `number` loses it — the same reason `x509.ts`'s
 * `decodeOid` accumulates in `BigInt` on the way back.
 */
function oidBytes(dotted: string): Uint8Array {
  const arcs = dotted.split('.').map((part) => BigInt(part))
  const first = arcs[0]
  const second = arcs[1]
  if (first === undefined || second === undefined) throw new RangeError(`OID ${dotted} has fewer than two arcs`)
  const out: number[] = [Number(first * 40n + second)]
  for (let index = 2; index < arcs.length; index++) {
    let value = arcs[index] as bigint
    const chunk: number[] = [Number(value & 0x7fn)]
    value >>= 7n
    while (value > 0n) {
      chunk.unshift(Number(value & 0x7fn) | 0x80)
      value >>= 7n
    }
    out.push(...chunk)
  }
  return new Uint8Array(out)
}

/**
 * `RFC 5280` §4.1.2.5.1 `UTCTime`, `YYMMDDHHMMSSZ`, which is what `x509.ts`'s
 * `parseUtcTime` is the exact inverse of.
 *
 * **Second granularity is a real, one-directional loss and the reason the caller's
 * agreement check truncates rather than compares.** A `NodeCertificate` carries
 * milliseconds; `UTCTime` cannot. Encoding truncates toward the past for `notBefore`
 * and for `notAfter` alike — for `notAfter` that is the conservative direction (the
 * X.509 form expires no later than the envelope), and for `notBefore` it means the
 * X.509 form becomes valid up to 999 ms *earlier*, which is the one place this profile
 * is fractionally more permissive than the envelope it mirrors. That is stated rather
 * than hidden; the envelope's own `issuedAt` is still checked by `verifyCertificate`
 * at full precision, so the wider window is never the operative bound.
 *
 * Refuses a year outside `UTCTime`'s own 1950-2049 range instead of wrapping into a
 * plausible-looking wrong century. RFC 5280 mandates `GeneralizedTime` past 2049 and
 * this profile refuses `GeneralizedTime` outright, so a certificate that far out is not
 * expressible here — a loud refusal at issuance is the only honest answer.
 */
function utcTimeBytes(ms: number, what: string): Uint8Array {
  const when = new Date(Math.floor(ms / 1000) * 1000)
  const year = when.getUTCFullYear()
  if (!Number.isFinite(ms) || year < 1950 || year > 2049) {
    throw new RangeError(`${what} (${ms}) is outside UTCTime's 1950-2049 range, which this profile cannot encode`)
  }
  const two = (value: number): string => String(value).padStart(2, '0')
  const text =
    two(year % 100) +
    two(when.getUTCMonth() + 1) +
    two(when.getUTCDate()) +
    two(when.getUTCHours()) +
    two(when.getUTCMinutes()) +
    two(when.getUTCSeconds()) +
    'Z'
  return new TextEncoder().encode(text)
}

/**
 * A `Name` holding exactly one RDN holding exactly one `id-at-commonName` — the only
 * shape this profile accepts, and the reason it accepts only that shape is that a
 * single-element `SET` has no `SET OF` ordering question to canonicalise
 * (`x509.ts`'s `readName`, RESEARCH.md §2 row 5).
 */
function rdnName(commonName: string): DerNode {
  const atv = cons(0x30, [prim(0x06, oidBytes(ID_AT_COMMON_NAME)), prim(0x0c, new TextEncoder().encode(commonName))])
  return cons(0x30, [cons(0x31, [atv])])
}

function algorithmIdentifier(): DerNode {
  // No `parameters` child, ever. RFC 8410 §10 requires it absent for Ed25519, and
  // `checkAlgorithm` refuses `algorithm-parameters-present` when it is not — including
  // for a `NULL` one, which is the specific legacy-tolerant trap that rule exists for.
  return cons(0x30, [prim(0x06, oidBytes(ID_ED25519))])
}

function extension(oid: string, payload: Uint8Array): DerNode {
  // Two children, never three: `critical BOOLEAN DEFAULT FALSE` is DER-omitted when
  // false, and every extension this profile issues is non-critical.
  return cons(0x30, [prim(0x06, oidBytes(oid)), prim(0x04, payload)])
}

/**
 * `serialNumber` as the minimal positive `INTEGER` form of `issuedAt`.
 *
 * **Derived rather than random, and that is a choice with a cost worth naming.** RFC 5280
 * §4.1.2.2 wants a serial unique per issuer; `issuedAt` is unique per issuer only to
 * millisecond resolution, so two certificates this provider signs in the same
 * millisecond would collide. Against that: this module is pure and has no randomness
 * port, a random serial would make the X.509 form non-reproducible from the envelope,
 * and reproducibility is what lets `verifyCertificate` check the serial as one more
 * binding between the two envelopes rather than having to ignore it. The collision costs
 * nothing here because nothing in this fabric indexes by serial — revocation is
 * non-renewal on the certificate's own clock (`enrollment.ts`), not a list keyed by
 * serial number.
 *
 * A leading `0x00` is prepended when the high bit would otherwise be set, because DER's
 * `INTEGER` is two's-complement and this value is unsigned. `canonicalizeInteger` keeps
 * that byte — it strips a leading `0x00` only when the next byte's high bit is already
 * clear — so the result stays canonical.
 */
function serialBytes(issuedAt: number): Uint8Array {
  if (!Number.isInteger(issuedAt) || issuedAt < 0) {
    throw new RangeError(`issuedAt (${issuedAt}) must be a non-negative integer to encode as serialNumber`)
  }
  const digits: number[] = []
  let value = issuedAt
  while (value > 0) {
    digits.unshift(value % 256)
    value = Math.floor(value / 256)
  }
  if (digits.length === 0) digits.push(0)
  if (((digits[0] as number) & 0x80) !== 0) digits.unshift(0x00)
  return new Uint8Array(digits)
}

/** The `TBSCertificate` as a tree, shared by both exports so the grammar is written once. */
function buildTbs(fields: X509EncodableFields): DerNode {
  const nodeKeyBytes = hexToBytes(fields.nodeKey, 'nodeKey')
  const userKeyBytes = hexToBytes(fields.userKey, 'userKey')
  if (nodeKeyBytes.length !== 32) throw new RangeError(`nodeKey is ${nodeKeyBytes.length} bytes, not 32`)
  if (userKeyBytes.length !== 32) throw new RangeError(`userKey is ${userKeyBytes.length} bytes, not 32`)
  hexToBytes(fields.issuer, 'issuer')

  const extensions = [
    extension(EXT_USER_KEY, userKeyBytes),
    extension(EXT_OPERATOR_ID, dagCbor.encode(fields.operatorId)),
    extension(EXT_DISCOVERABILITY, new Uint8Array([fields.discoverability === 'seed' ? 0x00 : 0x01])),
    // Sorted, matching `payloadOf`'s own `[...relayIds].sort()`. Two envelopes that
    // disagreed about ordering would be two different signed statements about one node.
    extension(EXT_RELAY_IDS, dagCbor.encode([...fields.relayIds].sort())),
  ]

  return (
    cons(0x30, [
      // `[0] EXPLICIT` wrapping `INTEGER 2` — X.509 v3, the only version this profile
      // issues, since v1/v2 cannot carry extensions at all.
      cons(0xa0, [prim(0x02, new Uint8Array([0x02]))]),
      prim(0x02, serialBytes(fields.issuedAt)),
      algorithmIdentifier(),
      rdnName(fields.issuer),
      cons(0x30, [
        prim(0x17, utcTimeBytes(fields.issuedAt, 'issuedAt')),
        prim(0x17, utcTimeBytes(fields.expiresAt, 'expiresAt')),
      ]),
      rdnName(fields.nodeKey),
      // `BIT STRING` content is one unused-bits octet then the raw 32-byte key — no
      // `OCTET STRING` wrapper (RESEARCH.md Pitfall 2), which is why `x509.ts` treats
      // 33 bytes as exact rather than as a minimum.
      cons(0x30, [algorithmIdentifier(), prim(0x03, new Uint8Array([0x00, ...nodeKeyBytes]))]),
      cons(0xa3, [cons(0x30, extensions)]),
    ])
  )
}

/**
 * The `TBSCertificate` bytes an X.509 signature is taken over.
 *
 * Exported because the signer needs them before there is a certificate to put a
 * signature in, and because `decodeX509Certificate` hands back exactly this encoding as
 * `tbsBytes` — so a verifier and this signer are provably reading one byte string rather
 * than two agreeing implementations of one grammar.
 */
export function encodeX509Tbs(fields: X509EncodableFields): Uint8Array {
  return encodeDer(buildTbs(fields))
}

/**
 * Assemble the whole `Certificate` around an already-computed signature over
 * {@link encodeX509Tbs}'s output.
 *
 * The signature arrives as a parameter rather than being taken here so this module never
 * touches a private key and never imports a curve implementation — see the file docblock.
 * The `TBSCertificate` is rebuilt from the same `buildTbs` the signer's bytes came from,
 * so the region this certificate carries and the region that was signed are one tree
 * serialized twice by one encoder, not two encodings that have to be checked against
 * each other.
 */
export function encodeX509Certificate(fields: X509EncodableFields, signature: Uint8Array): Uint8Array {
  if (signature.length !== 64) {
    throw new RangeError(`signature is ${signature.length} bytes, not the 64 an Ed25519 signature occupies`)
  }
  return encodeDer(
    cons(0x30, [buildTbs(fields), algorithmIdentifier(), prim(0x03, new Uint8Array([0x00, ...signature]))]),
  )
}
