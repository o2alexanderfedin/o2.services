/**
 * A complete, local stand-in for the two internet services AutoTLS talks to — an ACME
 * certificate authority and a p2p-forge DNS delegate — so NET-03's `auto-acquires a TLS
 * certificate` clause can be *measured* on a laptop behind NAT.
 *
 * ## Why this exists, and what it corrects
 *
 * NET-03 was carried as blocked for weeks on the sentence *"AutoTLS needs a publicly
 * reachable host with a real DNS name."* That sentence conflates two different things.
 * A public host is what **Let's Encrypt** needs, because Let's Encrypt will not put its
 * name on a certificate for a domain you cannot demonstrate control of. It is **not**
 * what the acquisition *mechanism* needs. The mechanism is: generate an account key,
 * sign a JWS, place a DNS TXT record through a delegate, answer a dns-01 challenge, send
 * a CSR, receive a chain, hand it to the listener. Every one of those steps is local
 * except the identity of the certificate authority.
 *
 * So this module supplies the certificate authority. `@ipshipyard/libp2p-auto-tls` runs
 * unmodified against it, over real sockets, speaking real RFC 8555 and real DNS.
 *
 * ## What is real here, and what is not — read this before citing a green run
 *
 * **Real:** the ACME protocol exchange (RFC 8555 §7), JWS signing and *verification* of
 * every request with the account's own RSA key, the RFC 7638 thumbprint, the dns-01 key
 * authorization digest, a **DNS query over UDP** from the CA to a resolver to read the
 * TXT record, PKCS#10 CSR parsing **and signature verification**, X.509 issuance by a CA
 * key, and a TLS handshake a client validates against that CA. Nothing is stubbed with a
 * boolean.
 *
 * **Not real:** the CA is not Let's Encrypt, and the forge does not dial the node back to
 * check it is reachable. Those two facts are exactly the *hosting* half of NET-03 and are
 * why the requirement row still says what it says about a public deployment. A run
 * against this rig establishes that the code acquires and installs a certificate without
 * anybody managing one; it establishes nothing about whether a public CA would agree to
 * issue.
 *
 * ## Why not Pebble
 *
 * Let's Encrypt publishes a test CA (Pebble) and it would be stronger evidence, being a
 * third-party implementation. It is a Go binary that has to be built from the network and
 * would not be in this repository, so every spec over it would carry a `skipIf` — and a
 * spec that skips is not a measurement, which is the objection this project already
 * raised against AOT-04. The client (`acme-client`, third-party and strict) is the check
 * on this server: it refuses malformed nonces, missing `Location` headers, wrong content
 * types and unverifiable orders, so a rig that satisfies it is not free to be lax.
 */

// `@peculiar/x509` reaches its crypto provider through tsyringe, which needs the
// `Reflect.metadata` polyfill installed before any of its decorators evaluate. Import
// order is the contract: below the other imports this throws at module load.
import 'reflect-metadata'
import { createHash, createPublicKey, createVerify, randomBytes } from 'node:crypto'
import { Resolver } from 'node:dns/promises'
import { createSocket } from 'node:dgram'
import type { Socket } from 'node:dgram'
import { createServer } from 'node:http'
import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import { writeFile } from 'node:fs/promises'
import { generateKeyPair } from '@libp2p/crypto/keys'
import { createServerChallenge, serverResponds } from '@libp2p/http-peer-id-auth'
import {
  BasicConstraintsExtension,
  ExtendedKeyUsageExtension,
  KeyUsageFlags,
  KeyUsagesExtension,
  Pkcs10CertificateRequest,
  SubjectAlternativeNameExtension,
  X509Certificate,
  X509CertificateGenerator,
} from '@peculiar/x509'
import { base36 } from 'multiformats/bases/base36'

/** Ninety days, which is what Let's Encrypt issues and what AutoTLS's renewal maths assumes. */
const CERTIFICATE_LIFETIME_MS = 90 * 24 * 60 * 60 * 1000
/** The CA's own certificate outlives anything it signs by enough that expiry is never the fault. */
const CA_LIFETIME_MS = 365 * 24 * 60 * 60 * 1000
const DNS_TTL_SECONDS = 1
const DNS_TYPE_TXT = 16
const DNS_CLASS_IN = 1
const RSA_MODULUS_BITS = 2048

/** What one certificate order asked for and what it got. */
export interface IssuedCertificate {
  /** The name in the CSR — a wildcard, because AutoTLS always requests `*.<peer>.<forge>`. */
  readonly domain: string
  readonly serialNumber: string
  readonly notAfter: Date
}

/** One authenticated call the node made to the forge to have a TXT record placed. */
export interface ForgeCall {
  /** The peer id the forge **authenticated**, not one the caller asserted in a field. */
  readonly peerId: string
  /** The addresses the node offered as its dialable set. A real forge would dial these back. */
  readonly addresses: readonly string[]
  /** The TXT value placed, i.e. the dns-01 key authorization digest. */
  readonly value: string
  /** The record name it was placed under. */
  readonly record: string
}

export interface LocalAcme {
  /** Pass to `autoTLS({ acmeDirectory })`. */
  readonly directoryUrl: string
  /** Pass to `autoTLS({ forgeEndpoint })`. Trailing slash included — AutoTLS concatenates. */
  readonly forgeEndpoint: string
  /** Pass to `autoTLS({ forgeDomain })`. */
  readonly forgeDomain: string
  /** The root the issued chain hangs from, PEM. */
  readonly caCertificatePem: string
  /** The same root written to disk, for a child process's `NODE_EXTRA_CA_CERTS`. */
  readonly caCertificatePath: string
  /** Every certificate this CA issued, oldest first. Length is the anti-churn reading. */
  issued(): readonly IssuedCertificate[]
  /** Every authenticated forge call, oldest first. */
  forgeCalls(): readonly ForgeCall[]
  /** The live TXT zone, as the CA's resolver would see it. */
  txtRecords(): ReadonlyMap<string, string>
  close(): Promise<void>
}

export interface LocalAcmeOptions {
  /**
   * The top-level domain certificates are issued under.
   *
   * Defaults to `localhost` for one measured reason: macOS and Chromium both resolve every
   * `*.localhost` name to the loopback address (RFC 6761 §6.3), so the name AutoTLS derives
   * from an address — `<ip-with-dashes>.<peer>.localhost` — reaches the socket the node
   * actually bound, with no `/etc/hosts` edit and no privilege. `auto-tls.node.test.ts`
   * asserts that resolution rather than assuming it.
   */
  readonly forgeDomain?: string
  /** Where to write the CA PEM. Defaults to a file beside the process's temp dir. */
  readonly caCertificatePath?: string
  /**
   * Make the forge place a TXT record that does not answer the challenge.
   *
   * The one knob that exists purely so a negative can be *reached*. Without it the only
   * available failure is an unreachable forge, and that one never gets as far as the CA —
   * `challengeCreateFn` throws and retries, so nothing exercises dns-01 validation at all.
   * With it the record is placed, the challenge is submitted, and the authority's own check
   * is the thing that refuses. Planting `if (true)` over that check turns the case red;
   * without this option it does not.
   */
  readonly forgeAnswersWrongly?: boolean
}

// ── base64url, which ACME uses everywhere and Node spells slightly differently ──────────

function b64url(bytes: Uint8Array | Buffer): string {
  return Buffer.from(bytes).toString('base64url')
}

function fromB64url(text: string): Buffer {
  return Buffer.from(text, 'base64url')
}

/**
 * RFC 7638 §3 — the JWK thumbprint. The member order is **normative**, not stylistic:
 * the digest is taken over a JSON object with exactly the required members in
 * lexicographic order, so `{e, kty, n}` here is the specification and not a formatting
 * choice. Get it wrong and every dns-01 digest is wrong in a way that looks like a DNS
 * fault.
 */
function thumbprint(jwk: { readonly e: string; readonly kty: string; readonly n: string }): string {
  const canonical = JSON.stringify({ e: jwk.e, kty: jwk.kty, n: jwk.n })
  return b64url(createHash('sha256').update(canonical).digest())
}

// ── a DNS server that answers exactly one question type ────────────────────────────────

interface TxtZone {
  readonly records: Map<string, string>
  readonly socket: Socket
  readonly port: number
}

/**
 * Decode the QNAME at `offset`, returning the name and the offset just past it.
 *
 * No compression-pointer handling: a *question* section never contains one, because there
 * is nothing earlier in the message for it to point at.
 */
function readName(message: Buffer, offset: number): { name: string; end: number } {
  const labels: string[] = []
  let index = offset
  while (index < message.length) {
    const length = message[index]
    if (length === undefined || length === 0) {
      index += 1
      break
    }
    labels.push(message.subarray(index + 1, index + 1 + length).toString('ascii'))
    index += 1 + length
  }
  return { name: labels.join('.'), end: index }
}

function txtAnswer(values: readonly string[]): Buffer {
  const chunks = values.map((value) => {
    const bytes = Buffer.from(value, 'ascii')
    return Buffer.concat([Buffer.from([bytes.length]), bytes])
  })
  const rdata = Buffer.concat(chunks)
  const header = Buffer.alloc(12)
  // A compression pointer to offset 12 — the start of the question's QNAME. Every resolver
  // understands this and it keeps the record independent of the name's length.
  header.writeUInt16BE(0xc00c, 0)
  header.writeUInt16BE(DNS_TYPE_TXT, 2)
  header.writeUInt16BE(DNS_CLASS_IN, 4)
  header.writeUInt32BE(DNS_TTL_SECONDS, 6)
  header.writeUInt16BE(rdata.length, 10)
  return Buffer.concat([header, rdata])
}

async function startTxtZone(): Promise<TxtZone> {
  const records = new Map<string, string>()
  const socket = createSocket('udp4')

  socket.on('message', (message, remote) => {
    if (message.length < 12) return
    const id = message.readUInt16BE(0)
    const { name, end } = readName(message, 12)
    const questionEnd = end + 4
    const qtype = message.readUInt16BE(end)

    const value = records.get(name.toLowerCase())
    const answers = qtype === DNS_TYPE_TXT && value !== undefined ? [txtAnswer([value])] : []

    const header = Buffer.alloc(12)
    header.writeUInt16BE(id, 0)
    // QR=1, Opcode=0, AA=1, RD=1, RA=1. RCODE 0 when we answered, 3 (NXDOMAIN) when we did
    // not — a resolver that gets 0-with-no-answers reads it as NODATA and caches it, which
    // would make a retry after the record lands silently fail.
    header.writeUInt16BE(answers.length > 0 ? 0x8580 : 0x8583, 2)
    header.writeUInt16BE(1, 4)
    header.writeUInt16BE(answers.length, 6)
    const response = Buffer.concat([header, message.subarray(12, questionEnd), ...answers])
    socket.send(response, remote.port, remote.address)
  })

  await new Promise<void>((resolve, reject) => {
    socket.once('error', reject)
    socket.bind(0, '127.0.0.1', () => {
      socket.removeListener('error', reject)
      resolve()
    })
  })

  return { records, socket, port: socket.address().port }
}

// ── the certificate authority ──────────────────────────────────────────────────────────

const SIGNING_ALGORITHM = {
  name: 'RSASSA-PKCS1-v1_5',
  hash: 'SHA-256',
  publicExponent: new Uint8Array([0x01, 0x00, 0x01]),
  modulusLength: RSA_MODULUS_BITS,
} as const

interface CertificateAuthority {
  readonly certificate: X509Certificate
  readonly pem: string
  sign(csrDer: Buffer, now: number): Promise<{ chain: string; issued: IssuedCertificate }>
}

async function createCertificateAuthority(): Promise<CertificateAuthority> {
  const keys = (await crypto.subtle.generateKey(SIGNING_ALGORITHM, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair
  const now = Date.now()
  const certificate = await X509CertificateGenerator.createSelfSigned({
    serialNumber: '01',
    name: 'CN=o2 local ACME test CA, O=o2.services',
    notBefore: new Date(now - 60_000),
    notAfter: new Date(now + CA_LIFETIME_MS),
    signingAlgorithm: SIGNING_ALGORITHM,
    keys,
    extensions: [
      new BasicConstraintsExtension(true, 1, true),
      new KeyUsagesExtension(KeyUsageFlags.keyCertSign | KeyUsageFlags.cRLSign, true),
    ],
  })

  let serial = 1
  return {
    certificate,
    pem: certificate.toString('pem'),
    async sign(csrDer, at) {
      // `Uint8Array.from` rather than the `Buffer` itself: TypeScript 5.7 narrowed
      // `BufferSource` to `ArrayBufferView<ArrayBuffer>` and `Buffer<ArrayBufferLike>` no
      // longer satisfies it. A copy of a CSR is a few hundred bytes, once.
      const csr = new Pkcs10CertificateRequest(Uint8Array.from(csrDer))
      // A CSR whose signature does not verify under its own embedded public key is a
      // forgery, and refusing it here is the difference between a CA and a signing oracle.
      if (!(await csr.verify())) throw new Error('CSR signature did not verify')
      const domain = subjectAlternativeName(csr)
      serial += 1
      const notAfter = new Date(at + CERTIFICATE_LIFETIME_MS)
      const leaf = await X509CertificateGenerator.create({
        serialNumber: serial.toString(16).padStart(4, '0'),
        subject: csr.subject,
        issuer: certificate.subject,
        notBefore: new Date(at - 60_000),
        notAfter,
        signingAlgorithm: SIGNING_ALGORITHM,
        publicKey: csr.publicKey,
        signingKey: keys.privateKey,
        extensions: [
          new BasicConstraintsExtension(false, undefined, true),
          new KeyUsagesExtension(
            KeyUsageFlags.digitalSignature | KeyUsageFlags.keyEncipherment,
            true,
          ),
          new ExtendedKeyUsageExtension(['1.3.6.1.5.5.7.3.1', '1.3.6.1.5.5.7.3.2']),
          new SubjectAlternativeNameExtension([{ type: 'dns', value: domain }]),
        ],
      })
      return {
        chain: `${leaf.toString('pem')}\n${certificate.toString('pem')}\n`,
        issued: { domain, serialNumber: leaf.serialNumber, notAfter },
      }
    },
  }
}

/** RFC 5280 §4.2.1.6 — `id-ce-subjectAltName`. */
const SUBJECT_ALT_NAME_OID = '2.5.29.17'

/**
 * The name the certificate is *for*. Read off the CSR's SAN extension rather than its
 * subject, because the subject common name is legacy and browsers stopped reading it.
 */
function subjectAlternativeName(csr: Pkcs10CertificateRequest): string {
  const extension = csr.getExtension(SUBJECT_ALT_NAME_OID)
  if (extension === null) throw new Error('CSR carried no subjectAltName')
  const first = new SubjectAlternativeNameExtension(extension.rawData).names.items[0]
  if (first === undefined) throw new Error('CSR subjectAltName was empty')
  return first.value
}

// ── ACME wire types, the subset `acme-client` exercises ────────────────────────────────

interface AcmeAccount {
  readonly id: string
  readonly thumbprint: string
  readonly publicKeyPem: string
}

interface AcmeChallenge {
  /**
   * The random value the authority issued for this challenge, which the client must
   * publish under `_acme-challenge.<domain>`.
   *
   * RFC 8555 §8.1 gives this field a name `vocabulary.node.test.ts` bans as cryptocurrency
   * vocabulary. The wire form in `challengeBody` keeps the specification's spelling, because
   * `acme-client` reads the JSON by that name and a protocol field is not ours to rename —
   * and it carries the single registered exemption for it. Everything on this side of the
   * wire is named `issuedValue` instead, which is what reduced six occurrences to one. An
   * exemption over one protocol field is auditable; six over our own identifiers would be a
   * whitelist.
   */
  readonly issuedValue: string
  status: 'pending' | 'valid' | 'invalid'
  error?: { type: string; detail: string }
}

interface AcmeAuthorization {
  readonly id: string
  readonly domain: string
  readonly wildcard: boolean
  readonly challenge: AcmeChallenge
  status: 'pending' | 'valid' | 'invalid'
}

interface AcmeOrder {
  readonly id: string
  readonly identifiers: readonly { type: string; value: string }[]
  readonly authorization: AcmeAuthorization
  status: 'pending' | 'ready' | 'processing' | 'valid' | 'invalid'
  certificate?: string
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ''
    request.setEncoding('utf8')
    request.on('data', (chunk: string) => {
      body += chunk
    })
    request.on('end', () => {
      resolve(body)
    })
    request.on('error', reject)
  })
}

/**
 * An RSA account key as ACME carries it, with the three members RFC 7638 digests.
 *
 * Declared here rather than reusing `JsonWebKey`: the DOM's version has no index signature
 * and `node:crypto`'s `JsonWebKeyInput` requires one, so the lib-provided type is the wrong
 * shape for the only thing this is passed to.
 */
interface AccountJwk {
  readonly e: string
  readonly kty: string
  readonly n: string
  readonly [member: string]: unknown
}

interface Jws {
  readonly header: {
    readonly alg: string
    readonly nonce?: string
    readonly url?: string
    readonly kid?: string
    readonly jwk?: AccountJwk
  }
  /** `undefined` for a POST-as-GET, which carries an empty rather than an empty-object body. */
  readonly payload: Record<string, unknown> | undefined
  readonly signingInput: string
  readonly signature: Buffer
}

function parseJws(body: string): Jws {
  const envelope = JSON.parse(body) as {
    protected: string
    payload: string
    signature: string
  }
  const header = JSON.parse(fromB64url(envelope.protected).toString('utf8')) as Jws['header']
  const raw = fromB64url(envelope.payload).toString('utf8')
  return {
    header,
    // POST-as-GET (RFC 8555 §6.3) sends an empty payload, which is not valid JSON.
    payload: raw === '' ? undefined : (JSON.parse(raw) as Record<string, unknown>),
    signingInput: `${envelope.protected}.${envelope.payload}`,
    signature: fromB64url(envelope.signature),
  }
}

function verifyJws(jws: Jws, publicKeyPem: string): boolean {
  if (jws.header.alg !== 'RS256') return false
  return createVerify('RSA-SHA256')
    .update(jws.signingInput)
    .verify(publicKeyPem, jws.signature)
}

/**
 * Start an ACME certificate authority, a DNS resolver holding its challenge zone, and a
 * p2p-forge stand-in that authenticates callers by PeerId before touching that zone.
 *
 * All three listen on loopback with ephemeral ports; nothing is reachable off this host.
 */
export async function startLocalAcme(options: LocalAcmeOptions = {}): Promise<LocalAcme> {
  const forgeDomain = options.forgeDomain ?? 'localhost'
  const zone = await startTxtZone()
  const ca = await createCertificateAuthority()
  const resolver = new Resolver()
  resolver.setServers([`127.0.0.1:${zone.port}`])

  const accounts = new Map<string, AcmeAccount>()
  const orders = new Map<string, AcmeOrder>()
  const authorizations = new Map<string, AcmeAuthorization>()
  const issued: IssuedCertificate[] = []
  const certificates = new Map<string, string>()
  const forgeCalls: ForgeCall[] = []
  const nonces = new Set<string>()

  const mintNonce = (): string => {
    const nonce = b64url(randomBytes(16))
    nonces.add(nonce)
    return nonce
  }

  let acmeOrigin = ''

  const json = (
    response: ServerResponse,
    status: number,
    body: unknown,
    headers: Record<string, string> = {},
  ): void => {
    response.writeHead(status, {
      'content-type': 'application/json',
      'replay-nonce': mintNonce(),
      ...headers,
    })
    response.end(JSON.stringify(body))
  }

  const problem = (response: ServerResponse, status: number, type: string, detail: string): void => {
    response.writeHead(status, {
      'content-type': 'application/problem+json',
      'replay-nonce': mintNonce(),
    })
    response.end(JSON.stringify({ type: `urn:ietf:params:acme:error:${type}`, detail }))
  }

  /**
   * dns-01, done for real: compute what the TXT record must contain from the account's own
   * key thumbprint and the value the authority issued, then **look it up over UDP** through
   * a resolver pointed at this rig's zone. The forge is the only thing that can have put it
   * there, so
   * a green here is a statement about the whole node → forge → DNS → CA path.
   */
  const validate = async (authz: AcmeAuthorization, account: AcmeAccount): Promise<void> => {
    const expected = b64url(
      createHash('sha256')
        .update(`${authz.challenge.issuedValue}.${account.thumbprint}`)
        .digest(),
    )
    const record = `_acme-challenge.${authz.domain}`
    let found: string[][] = []
    try {
      found = await resolver.resolveTxt(record)
    } catch {
      found = []
    }
    const flat = found.map((parts) => parts.join(''))
    if (flat.includes(expected)) {
      authz.challenge.status = 'valid'
      authz.status = 'valid'
      return
    }
    authz.challenge.status = 'invalid'
    authz.challenge.error = {
      type: 'urn:ietf:params:acme:error:dns',
      detail: `no TXT record at ${record} matching the key authorization (saw ${flat.length})`,
    }
    authz.status = 'invalid'
  }

  const acme = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', acmeOrigin)
      const path = url.pathname

      if (request.method === 'HEAD' && path === '/new-nonce') {
        response.writeHead(200, { 'replay-nonce': mintNonce() })
        response.end()
        return
      }

      if (request.method === 'GET' && path === '/directory') {
        json(response, 200, {
          newNonce: `${acmeOrigin}/new-nonce`,
          newAccount: `${acmeOrigin}/new-account`,
          newOrder: `${acmeOrigin}/new-order`,
          revokeCert: `${acmeOrigin}/revoke-cert`,
          keyChange: `${acmeOrigin}/key-change`,
          meta: { termsOfService: `${acmeOrigin}/terms` },
        })
        return
      }

      if (request.method !== 'POST') {
        problem(response, 405, 'malformed', `unsupported ${request.method ?? '?'} ${path}`)
        return
      }

      const jws = parseJws(await readBody(request))

      // A replay-protection check that can actually fail. The nonce must be one this
      // server minted and has not seen used — which is what makes `acme-client`'s nonce
      // plumbing load-bearing rather than decorative.
      const nonce = jws.header.nonce
      if (nonce === undefined || !nonces.delete(nonce)) {
        problem(response, 400, 'badNonce', 'nonce was not issued by this server, or was reused')
        return
      }

      if (path === '/new-account') {
        const jwk = jws.header.jwk
        if (jwk === undefined) {
          problem(response, 400, 'malformed', 'newAccount must carry a jwk')
          return
        }
        const publicKeyPem = createPublicKey({ key: jwk, format: 'jwk' })
          .export({ format: 'pem', type: 'spki' })
          .toString()
        if (!verifyJws(jws, publicKeyPem)) {
          problem(response, 403, 'unauthorized', 'JWS signature did not verify')
          return
        }
        const print = thumbprint(jwk)
        const id = print.slice(0, 16)
        accounts.set(id, { id, thumbprint: print, publicKeyPem })
        json(
          response,
          201,
          { status: 'valid', contact: jws.payload?.contact ?? [] },
          { location: `${acmeOrigin}/account/${id}` },
        )
        return
      }

      // Everything past this point is `kid`-authenticated against a known account.
      const kid = jws.header.kid ?? ''
      const account = accounts.get(kid.slice(kid.lastIndexOf('/') + 1))
      if (account === undefined) {
        problem(response, 403, 'accountDoesNotExist', `no account for kid ${kid}`)
        return
      }
      if (!verifyJws(jws, account.publicKeyPem)) {
        problem(response, 403, 'unauthorized', 'JWS signature did not verify')
        return
      }

      if (path === '/new-order') {
        const identifiers = (jws.payload?.identifiers ?? []) as { type: string; value: string }[]
        const first = identifiers[0]
        if (first === undefined) {
          problem(response, 400, 'malformed', 'newOrder carried no identifiers')
          return
        }
        // RFC 8555 §7.1.4: a wildcard order names `*.example.com`, and the authorization
        // it produces names `example.com` with `wildcard: true`.
        const wildcard = first.value.startsWith('*.')
        const domain = wildcard ? first.value.slice(2) : first.value
        const id = b64url(randomBytes(8))
        const authz: AcmeAuthorization = {
          id,
          domain,
          wildcard,
          status: 'pending',
          challenge: { issuedValue: b64url(randomBytes(32)), status: 'pending' },
        }
        const order: AcmeOrder = { id, identifiers, authorization: authz, status: 'pending' }
        authorizations.set(id, authz)
        orders.set(id, order)
        json(response, 201, orderBody(order), { location: `${acmeOrigin}/order/${id}` })
        return
      }

      const authzMatch = /^\/authz\/(.+)$/.exec(path)
      if (authzMatch?.[1] !== undefined) {
        const authz = authorizations.get(authzMatch[1])
        if (authz === undefined) {
          problem(response, 404, 'malformed', 'no such authorization')
          return
        }
        json(response, 200, authzBody(authz))
        return
      }

      const challengeMatch = /^\/challenge\/(.+)$/.exec(path)
      if (challengeMatch?.[1] !== undefined) {
        const authz = authorizations.get(challengeMatch[1])
        if (authz === undefined) {
          problem(response, 404, 'malformed', 'no such challenge')
          return
        }
        // An empty payload is a poll; `{}` is the client asking us to validate now.
        if (jws.payload !== undefined && authz.challenge.status === 'pending') {
          await validate(authz, account)
          const order = orders.get(authz.id)
          if (order !== undefined) {
            order.status = authz.status === 'valid' ? 'ready' : 'invalid'
          }
        }
        json(response, 200, challengeBody(authz))
        return
      }

      const finalizeMatch = /^\/order\/(.+)\/finalize$/.exec(path)
      if (finalizeMatch?.[1] !== undefined) {
        const order = orders.get(finalizeMatch[1])
        if (order === undefined) {
          problem(response, 404, 'malformed', 'no such order')
          return
        }
        if (order.status !== 'ready') {
          problem(response, 403, 'orderNotReady', `order is ${order.status}, not ready`)
          return
        }
        const csr = fromB64url(String(jws.payload?.csr ?? ''))
        try {
          const { chain, issued: record } = await ca.sign(csr, Date.now())
          certificates.set(order.id, chain)
          issued.push(record)
          order.status = 'valid'
          order.certificate = `${acmeOrigin}/certificate/${order.id}`
        } catch (error) {
          order.status = 'invalid'
          problem(response, 400, 'badCSR', (error as Error).message)
          return
        }
        json(response, 200, orderBody(order), { location: `${acmeOrigin}/order/${order.id}` })
        return
      }

      const orderMatch = /^\/order\/(.+)$/.exec(path)
      if (orderMatch?.[1] !== undefined) {
        const order = orders.get(orderMatch[1])
        if (order === undefined) {
          problem(response, 404, 'malformed', 'no such order')
          return
        }
        json(response, 200, orderBody(order), { location: `${acmeOrigin}/order/${order.id}` })
        return
      }

      const certificateMatch = /^\/certificate\/(.+)$/.exec(path)
      if (certificateMatch?.[1] !== undefined) {
        const chain = certificates.get(certificateMatch[1])
        if (chain === undefined) {
          problem(response, 404, 'malformed', 'no such certificate')
          return
        }
        response.writeHead(200, {
          'content-type': 'application/pem-certificate-chain',
          'replay-nonce': mintNonce(),
        })
        response.end(chain)
        return
      }

      problem(response, 404, 'malformed', `no route for ${path}`)
    })().catch((error: unknown) => {
      if (!response.headersSent) {
        problem(response, 500, 'serverInternal', (error as Error).message)
        return
      }
      response.end()
    })
  })

  const authzBody = (authz: AcmeAuthorization): unknown => ({
    status: authz.status,
    expires: new Date(Date.now() + 3_600_000).toISOString(),
    identifier: { type: 'dns', value: authz.domain },
    ...(authz.wildcard ? { wildcard: true } : {}),
    challenges: [challengeBody(authz)],
  })

  const challengeBody = (authz: AcmeAuthorization): unknown => ({
    type: 'dns-01',
    url: `${acmeOrigin}/challenge/${authz.id}`,
    status: authz.challenge.status,
    token: authz.challenge.issuedValue,
    ...(authz.challenge.error === undefined ? {} : { error: authz.challenge.error }),
  })

  const orderBody = (order: AcmeOrder): unknown => ({
    status: order.status,
    expires: new Date(Date.now() + 3_600_000).toISOString(),
    identifiers: order.identifiers,
    authorizations: [`${acmeOrigin}/authz/${order.id}`],
    finalize: `${acmeOrigin}/order/${order.id}/finalize`,
    ...(order.certificate === undefined ? {} : { certificate: order.certificate }),
  })

  // ── the forge ────────────────────────────────────────────────────────────────────────
  //
  // p2p-forge's job is to place a DNS TXT record on behalf of a peer that has proved which
  // peer it is. The proof is the same libp2p HTTP PeerID auth handshake the real service
  // uses, run by the library's own server helper — so the peer id below is one this rig
  // *verified*, never one the request body claimed.
  const forgeKey = await generateKeyPair('Ed25519')

  const forge = createServer((request, response) => {
    void (async () => {
      const host = request.headers.host ?? '127.0.0.1'
      const authorization = request.headers.authorization
      if (authorization === undefined) {
        response.writeHead(401, {
          'www-authenticate': await createServerChallenge(host, forgeKey),
        })
        response.end()
        return
      }

      const verdict = await serverResponds(authorization, host, forgeKey)
      if (verdict.authenticate !== undefined) {
        // The client's opening challenge. Answer it and let it come back authenticated.
        response.writeHead(request.method === 'OPTIONS' ? 200 : 401, {
          'www-authenticate': verdict.authenticate,
        })
        response.end()
        return
      }

      if (request.url !== '/v1/_acme-challenge' || request.method !== 'POST') {
        response.writeHead(404).end()
        return
      }

      const body = JSON.parse(await readBody(request)) as {
        Value: string
        Addresses: string[]
      }
      // The domain is derived from the **authenticated** peer, exactly as p2p-forge derives
      // it. A node cannot ask this forge to place a record for anybody else.
      const domain = `${base36.encode(verdict.peerId.toCID().bytes)}.${forgeDomain}`
      const record = `_acme-challenge.${domain}`
      zone.records.set(
        record.toLowerCase(),
        // Same length and alphabet as a real key authorization digest, so what fails is the
        // comparison and not the parsing of a malformed record.
        options.forgeAnswersWrongly === true ? b64url(createHash('sha256').update('not-it').digest()) : body.Value,
      )
      forgeCalls.push({
        peerId: verdict.peerId.toString(),
        addresses: body.Addresses,
        value: body.Value,
        record,
      })
      response.writeHead(200, {
        'content-type': 'application/json',
        ...(verdict.info === undefined ? {} : { 'authentication-info': verdict.info }),
      })
      response.end('{}')
    })().catch(() => {
      if (!response.headersSent) response.writeHead(500)
      response.end()
    })
  })

  await listen(acme)
  await listen(forge)
  acmeOrigin = `http://127.0.0.1:${port(acme)}`

  const caCertificatePath =
    options.caCertificatePath ?? `${process.env.TMPDIR ?? '/tmp'}/o2-local-acme-${process.pid}.pem`
  await writeFile(caCertificatePath, ca.pem, 'utf8')

  return {
    directoryUrl: `${acmeOrigin}/directory`,
    forgeEndpoint: `http://127.0.0.1:${port(forge)}/`,
    forgeDomain,
    caCertificatePem: ca.pem,
    caCertificatePath,
    issued: () => [...issued],
    forgeCalls: () => [...forgeCalls],
    txtRecords: () => new Map(zone.records),
    close: async () => {
      zone.socket.close()
      await Promise.all([shut(acme), shut(forge)])
    },
  }
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.removeListener('error', reject)
      resolve()
    })
  })
}

function port(server: Server): number {
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('server is not listening')
  return address.port
}

function shut(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.closeAllConnections()
    server.close(() => {
      resolve()
    })
  })
}
