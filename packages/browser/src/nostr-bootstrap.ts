/**
 * A second place to find this fabric's bootstrap document — read only when the origin has none.
 *
 * ## Why this exists, and what it is NOT
 *
 * `demo/main.ts`'s `fetchBootstrapDocument` asks two locations on the page's own origin and
 * answers `undefined` when neither has one. That is *"a static host with no seed, which is a
 * state and not a failure"* — and it is also the state of a client that was never served by the
 * host that knows the address: the **embedded-in-a-host-application** target this project
 * states, where `tab-api.ts` warns against *"an address that can go stale in a build"* and the
 * only alternative on offer is a `?relay=` parameter, i.e. whatever found the page choosing
 * where it knocks.
 *
 * This module is a third answer for exactly that state. It is **in addition to** the Cloudflare
 * bootstrap and never instead of it — see {@link readNostrBootstrap}'s ordering note, which is a
 * security property rather than a preference.
 *
 * **It is not a relay replacement and cannot become one.** Measured 2026-09-07 against the
 * installed `@libp2p/webrtc@6.0.27`: browser-to-browser WebRTC needs a libp2p **stream** —
 * `connection.newStream('/webrtc-signaling/0.0.1')`, `initiate-connection.ts:63` — and a Nostr
 * relay is a mailbox. The hosted object keeps both of its transport roles. Full working:
 * `.planning/consults/2026-09-07-nostr-as-a-bootstrap-tier-measured.md`.
 *
 * ## Ports in, nothing global at module scope
 *
 * `consent.ts`'s rule, in its own words: *"Nothing touches `localStorage` at import time — a
 * module that reads browser globals when it is loaded cannot be imported by a Node test at
 * all."* The same applies to `WebSocket`. Every function here takes its socket factory and its
 * clock as arguments, so the whole of it runs in the `node` lane against a fake and in a real
 * browser against the real thing, and the security decisions are reachable by a unit test.
 *
 * ## Where the trust is
 *
 * A relay is an **untrusted transport**. It can serve any bytes it likes, including a
 * well-formed event that says whatever the operator of that relay wants a visitor to dial. The
 * only thing standing between a visitor and a relay of somebody else's choosing is
 * {@link verifyBootstrapEvent}, and it is written so that every one of its refusals is a case a
 * test can construct.
 */

import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'

/**
 * NIP-78 application-specific data — a *parameterized replaceable* event.
 *
 * The kind band 30000-39999 makes a relay keep only the newest per
 * `(pubkey, kind, d-tag)`, which is a mutable document under a stable name and is exactly the
 * shape `bootstrap.json` has. Measured 2026-09-07 on five public relays: a second document under
 * the same `d` tag superseded the first everywhere, and republishing an OLDER one was refused by
 * the relays themselves — `replaced: have newer event`. That is the monotonic-version rollback
 * refusal `packages/core/src/naming.ts` builds by hand, obtained here from infrastructure this
 * project does not run.
 */
export const NOSTR_BOOTSTRAP_KIND = 30078

/** The `d` tag the document lives under. One name, so a reader and a publisher cannot disagree. */
export const NOSTR_BOOTSTRAP_IDENTIFIER = 'o2.services/bootstrap'

/**
 * How long a single relay is given before it is abandoned.
 *
 * Sited against a measurement rather than chosen: on 2026-09-07 a real Chromium on the published
 * origin read this document from four relays in 720, 729, 790 and 1 239 ms, and two further
 * relays never answered at all. Five seconds is four times the slowest success, which leaves
 * room for a worse network without making a dead relay hold the page.
 *
 * It is a per-relay budget and not a total: {@link readNostrBootstrap} races, so the read
 * finishes when the FIRST relay answers and not when the slowest gives up. The same measurement
 * put the race at 655 ms with two dead relays ahead of the live ones in the list.
 */
export const NOSTR_READ_TIMEOUT_MS = 5_000

/**
 * How old a document may be and still be believed.
 *
 * **This is the one protection a signature does not give.** A relay cannot forge a document, but
 * it can serve an OLD one the publisher genuinely signed — pointing at a relay that has since
 * been retired. Nothing in NIP-01 stops that: `created_at` is the publisher's own claim and the
 * relay chooses which of the events it holds to hand back.
 *
 * Thirty days is deliberately loose. The cost of being too tight is a visitor refusing a
 * perfectly good address because a deploy has not happened lately, which fails in the direction
 * where nobody can join; the cost of being loose is a window in which a retired address can be
 * replayed, and a retired address fails to dial rather than dialling somebody else. The two
 * costs are not symmetric, so the bound is not either.
 */
export const NOSTR_DOCUMENT_MAX_AGE_MS: number = 30 * 24 * 60 * 60 * 1_000

/**
 * A future-dated document is refused past this much clock skew.
 *
 * A publisher's `created_at` is self-reported, so a far-future timestamp would sit inside
 * {@link NOSTR_DOCUMENT_MAX_AGE_MS} forever and never expire. Five minutes tolerates an
 * unsynchronised device and nothing else.
 */
export const NOSTR_CLOCK_SKEW_MS: number = 5 * 60 * 1_000

/**
 * The relays a visitor asks, pinned in the build.
 *
 * **Six, and two of them were dead when this list was written.** That is not a defect in the
 * list; it is why there is a list. Measured 2026-09-07 from a real browser:
 * `relay.nostr.band` timed out at 5 000 ms and `relay.damus.io` had banned the measuring host at
 * the socket after an earlier burst, while `nos.lol`, `relay.primal.net`, `nostr.mom` and
 * `relay.snort.social` each answered in 720-1 239 ms. A reader that asked one relay would have
 * had a one-in-three chance of getting nothing that day.
 *
 * `relay.damus.io` is deliberately **absent**. It refused 26 of 30 events in a burst with
 * `rate-limited: you are noting too much` and then stopped accepting connections from that host
 * entirely — it is the strictest of the ones measured, and a bootstrap read that a relay decides
 * to ban is worse than one relay fewer.
 */
export const NOSTR_BOOTSTRAP_RELAYS: readonly string[] = [
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://nostr.mom',
  'wss://relay.snort.social',
]

/**
 * The one key whose bootstrap document this fabric will believe — or a named literal saying
 * there is none.
 *
 * **The absence is a value and never an empty string**, on `trustAnchors`' stated discipline:
 * *"opt-out is a named literal, never emptiness."* An empty pin is indistinguishable from a
 * forgotten one, and the failure mode of a forgotten pin here is a visitor dialling a relay
 * chosen by whoever answered first.
 *
 * It reads {@link NOT_PUBLISHED} today because **no project key exists yet**. The document
 * measured on 2026-09-07 was published under a deliberately public spike key derived from a
 * fixed sentence — anybody can sign under it, so pinning it would be worse than pinning
 * nothing. `readNostrBootstrapIfPinned` returns without opening a socket while this is the
 * value, so the fallback ships inert and becomes live on the day a key the owner controls is
 * put here and the publisher half runs.
 */
export const NOT_PUBLISHED = 'no-nostr-bootstrap-published' as const

/** A 64-character lowercase hex x-only public key, or {@link NOT_PUBLISHED}. */
export type BootstrapPublisher = string | typeof NOT_PUBLISHED

export const NOSTR_BOOTSTRAP_PUBLISHER: BootstrapPublisher = NOT_PUBLISHED

/** The socket surface this module uses, declared as narrowly as it is used. */
export interface NostrSocket {
  send: (data: string) => void
  close: () => void
  addEventListener: (type: string, listener: (event: MessageLike) => void) => void
}

/** The only field of an event this module reads off a socket message. */
export interface MessageLike {
  readonly data?: unknown
}

/** Opens a relay. The real one is `(url) => new WebSocket(url)`; a test supplies a fake. */
export type OpenNostrRelay = (url: string) => NostrSocket

/** A NIP-01 event, as it arrives — every field untrusted until {@link verifyBootstrapEvent}. */
export interface NostrEvent {
  readonly id: string
  readonly pubkey: string
  readonly created_at: number
  readonly kind: number
  readonly tags: readonly (readonly string[])[]
  readonly content: string
  readonly sig: string
}

/** What {@link verifyBootstrapEvent} answers. A reason, never a bare `false`. */
export type BootstrapVerdict =
  | { readonly ok: true; readonly document: Record<string, unknown> }
  | { readonly ok: false; readonly refusal: string }

/** What {@link readNostrBootstrap} answers. */
export type NostrBootstrapReading =
  | { readonly found: true; readonly document: Record<string, unknown>; readonly relay: string }
  | { readonly found: false; readonly refusals: readonly string[] }

/**
 * Read an event as this fabric's bootstrap document, or say why not.
 *
 * **Every check here is load bearing and none is a formality.** A Nostr relay is an untrusted
 * transport: it may answer with any bytes at all, and the checks below are the whole of what
 * stops a relay operator choosing which peer a visitor dials.
 *
 * The order is cheapest-first, and the last two are the ones that cost real work:
 *
 * 1. **shape** — every field present and of the right type. A relay may answer with anything.
 * 2. **publisher** — `pubkey` equals the pinned key, compared as a whole string. This is what
 *    makes the other checks worth doing: a valid signature by the wrong key is a valid signature.
 * 3. **kind and `d` tag** — the document asked for, not another of the publisher's documents.
 * 4. **freshness** — inside {@link NOSTR_DOCUMENT_MAX_AGE_MS} and not more than
 *    {@link NOSTR_CLOCK_SKEW_MS} in the future. See that constant: a signature does not expire,
 *    and an old correctly-signed document is the one thing a relay can replay.
 * 5. **id** — recomputed from the serialization. Without this an event could carry a valid
 *    signature over a *different* id than the one whose content is being read, so the content is
 *    checked by being hashed rather than by being trusted.
 * 6. **signature** — schnorr over the recomputed id.
 *
 * Content is then parsed, and a non-object is refused: a page reaching for `peerAddrs` on an
 * array or a string would read `undefined` and report *no relays* rather than *a bad document*.
 */
export function verifyBootstrapEvent(
  event: unknown,
  expectation: {
    readonly publisher: string
    readonly identifier: string
    readonly now: number
    readonly maxAgeMs?: number
  },
): BootstrapVerdict {
  const shaped = asEvent(event)
  if (shaped === null) return { ok: false, refusal: 'not a NIP-01 event' }

  if (shaped.pubkey !== expectation.publisher) {
    return { ok: false, refusal: `signed by ${short(shaped.pubkey)}, not by the pinned publisher` }
  }
  if (shaped.kind !== NOSTR_BOOTSTRAP_KIND) {
    return { ok: false, refusal: `kind ${String(shaped.kind)} is not ${String(NOSTR_BOOTSTRAP_KIND)}` }
  }
  const identifier = shaped.tags.find((tag) => tag[0] === 'd')?.[1]
  if (identifier !== expectation.identifier) {
    return { ok: false, refusal: `d tag ${JSON.stringify(identifier ?? null)} is not the bootstrap document` }
  }

  const ageMs = expectation.now - shaped.created_at * 1_000
  const maxAgeMs = expectation.maxAgeMs ?? NOSTR_DOCUMENT_MAX_AGE_MS
  if (ageMs > maxAgeMs) {
    return { ok: false, refusal: `document is ${String(Math.round(ageMs / 86_400_000))} days old` }
  }
  if (ageMs < -NOSTR_CLOCK_SKEW_MS) {
    return { ok: false, refusal: 'document is dated in the future' }
  }

  // **No try/catch, and its absence is the decision.** `asEvent` has already narrowed every
  // field to a string, a finite number or an array of strings, and `JSON.stringify` does not
  // throw on those — there is no BigInt, no cycle and no `toJSON` to reach. A catch here would
  // be a branch no input can take, and an unreachable branch in a security path is worse than
  // no branch: it reads as a handled case, it can never be exercised, and the first reader to
  // trust it has trusted nothing. What DOES need guarding is a throw escaping into a socket
  // callback, and that is guarded at the callback, in `askOne`.
  const recomputed = bytesToHex(
    sha256(
      utf8ToBytes(
        JSON.stringify([
          0,
          shaped.pubkey,
          shaped.created_at,
          shaped.kind,
          shaped.tags.map((tag) => [...tag]),
          shaped.content,
        ]),
      ),
    ),
  )
  if (recomputed !== shaped.id) {
    return { ok: false, refusal: 'the id does not match the event it is on' }
  }

  let signed = false
  try {
    signed = schnorr.verify(hexToBytes(shaped.sig), hexToBytes(shaped.id), hexToBytes(shaped.pubkey))
  } catch {
    // A malformed hex field reaches here rather than throwing out of the read. It is the same
    // answer as a bad signature and gets the same sentence, because to a caller it is.
    return { ok: false, refusal: 'signature or key is not readable as hex' }
  }
  if (!signed) return { ok: false, refusal: 'the signature does not verify' }

  let parsed: unknown
  try {
    parsed = JSON.parse(shaped.content)
  } catch {
    return { ok: false, refusal: 'content is not JSON' }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, refusal: 'content is not a JSON object' }
  }
  return { ok: true, document: { ...parsed } }
}

/** Narrow an unknown value to the event shape, or `null`. No cast, no partial trust. */
function asEvent(value: unknown): NostrEvent | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const source: Record<string, unknown> = { ...value }
  const { id, pubkey, created_at: createdAt, kind, tags, content, sig } = source
  if (typeof id !== 'string' || typeof pubkey !== 'string' || typeof sig !== 'string') return null
  if (typeof createdAt !== 'number' || !Number.isFinite(createdAt)) return null
  if (typeof kind !== 'number' || !Number.isFinite(kind)) return null
  if (typeof content !== 'string') return null
  if (!Array.isArray(tags)) return null
  const narrowed: string[][] = []
  for (const tag of tags) {
    if (!Array.isArray(tag)) return null
    const entries: string[] = []
    for (const entry of tag) {
      if (typeof entry !== 'string') return null
      entries.push(entry)
    }
    narrowed.push(entries)
  }
  return { id, pubkey, created_at: createdAt, kind, tags: narrowed, content, sig }
}

/** First eight characters, so a refusal names a key without pasting sixty-four of them. */
function short(key: string): string {
  return `${key.slice(0, 8)}…`
}

/**
 * Ask every relay at once and take the first answer that carries a document this fabric signed.
 *
 * ## The race resolves on a DOCUMENT, not on a settled promise
 *
 * A relay that has never heard of this document answers `EOSE` with nothing, promptly and
 * correctly. `Promise.any` would let that relay win the race while carrying nothing, and the
 * fastest relay is often the one with the least in it. So the race is written by hand: an answer
 * only ends it if it verified, and the read fails only when every relay has finished failing.
 *
 * Measured 2026-09-07 in a real browser with two dead relays placed FIRST in the list: 655 ms to
 * a verified document, against 720-1 239 ms for the individual relays that had it.
 *
 * ## Every socket is closed on every path
 *
 * Including the losers'. A page that left five sockets open per discovery round would hold five
 * connections to strangers' infrastructure for the life of the tab.
 *
 * ## The ordering this must be called in, which is a security property
 *
 * **The origin first, this second, and never the reverse.** A merge that preferred the fresher
 * of the two, or that asked this first, would let whoever holds the publisher key redirect every
 * visitor to a relay of their choosing — on a page whose origin was answering correctly the
 * whole time. `demo/main.ts` calls this only where `fetchBootstrapDocument` returned `undefined`.
 *
 * ## It runs after consent, and that is not an accident either
 *
 * A Nostr relay is a foreign origin. `built-bundle.e2e.test.ts`'s P10 asserts that every request
 * the page makes before consent carries the page's own origin. Discovery is a network act that
 * runs only when the surfaces are revealed — `signin.ts` states it in those words — which is
 * after the visitor agreed. A read placed at page load would break P10 and would deserve to.
 */
export async function readNostrBootstrap(request: {
  readonly relays: readonly string[]
  readonly publisher: string
  readonly identifier?: string
  readonly open: OpenNostrRelay
  readonly now: () => number
  readonly timeoutMs?: number
}): Promise<NostrBootstrapReading> {
  const identifier = request.identifier ?? NOSTR_BOOTSTRAP_IDENTIFIER
  const timeoutMs = request.timeoutMs ?? NOSTR_READ_TIMEOUT_MS
  if (request.relays.length === 0) return { found: false, refusals: ['no relays configured'] }

  const attempts = request.relays.map(async (url) => {
    const answer = await askOne(url, { ...request, identifier, timeoutMs })
    return { url, answer }
  })

  const refusals: string[] = []
  return await new Promise<NostrBootstrapReading>((resolve) => {
    let outstanding = attempts.length
    for (const attempt of attempts) {
      void attempt.then(({ url, answer }) => {
        if (answer.ok) {
          resolve({ found: true, document: answer.document, relay: url })
          return
        }
        refusals.push(`${url}: ${answer.refusal}`)
        outstanding -= 1
        if (outstanding === 0) resolve({ found: false, refusals })
      })
    }
  })
}

/** One relay, one question, one verdict. Never throws; a failure is a refusal with a sentence. */
async function askOne(
  url: string,
  request: {
    readonly publisher: string
    readonly identifier: string
    readonly open: OpenNostrRelay
    readonly now: () => number
    readonly timeoutMs: number
  },
): Promise<BootstrapVerdict> {
  let socket: NostrSocket
  try {
    socket = request.open(url)
  } catch (cause) {
    return { ok: false, refusal: `could not open: ${cause instanceof Error ? cause.message : String(cause)}` }
  }

  return await new Promise<BootstrapVerdict>((resolve) => {
    let settled = false
    const subscription = 'o2b'
    // The best verdict seen so far. A relay may hold several events matching the filter — only
    // one can be the newest, but a relay is not obliged to send only that one — so a refusal is
    // remembered rather than returned, and a later EVENT can still succeed.
    let best: BootstrapVerdict = { ok: false, refusal: 'answered nothing' }

    const finish = (verdict: BootstrapVerdict): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        socket.close()
      } catch {
        // A socket that cannot be closed is already gone. The verdict stands either way.
      }
      resolve(verdict)
    }

    const timer = setTimeout(() => {
      finish(best.ok ? best : { ok: false, refusal: `no answer within ${String(request.timeoutMs)} ms` })
    }, request.timeoutMs)

    socket.addEventListener('error', () => {
      finish({ ok: false, refusal: 'socket error' })
    })
    socket.addEventListener('close', () => {
      finish(best.ok ? best : { ok: false, refusal: 'closed before answering' })
    })
    socket.addEventListener('open', () => {
      try {
        socket.send(
          JSON.stringify([
            'REQ',
            subscription,
            {
              kinds: [NOSTR_BOOTSTRAP_KIND],
              authors: [request.publisher],
              '#d': [request.identifier],
              limit: 1,
            },
          ]),
        )
      } catch (cause) {
        finish({ ok: false, refusal: `could not ask: ${cause instanceof Error ? cause.message : String(cause)}` })
      }
    })
    socket.addEventListener('message', (event) => {
      const frame = readFrame(event.data)
      if (frame === null) return
      const [type, id] = frame
      if (id !== subscription) return
      if (type === 'EVENT') {
        // Wrapped HERE rather than inside the verifier — see the note at the recomputed id.
        // This is the boundary a throw would actually escape from: a socket callback has no
        // caller to catch it, so an unexpected one would leave this relay's promise pending
        // until the timeout and would surface as *"no answer"* on a relay that answered.
        let verdict: BootstrapVerdict
        try {
          verdict = verifyBootstrapEvent(frame[2], {
            publisher: request.publisher,
            identifier: request.identifier,
            now: request.now(),
          })
        } catch (cause) {
          verdict = {
            ok: false,
            refusal: `verification threw: ${cause instanceof Error ? cause.message : String(cause)}`,
          }
        }
        if (verdict.ok) finish(verdict)
        else best = verdict
        return
      }
      if (type === 'EOSE' || type === 'CLOSED') finish(best)
    })
  })
}

/** A relay frame, narrowed. Anything else is ignored rather than refused — relays chatter. */
function readFrame(data: unknown): [string, string, unknown] | null {
  if (typeof data !== 'string') return null
  let parsed: unknown
  try {
    parsed = JSON.parse(data)
  } catch {
    return null
  }
  if (!Array.isArray(parsed) || parsed.length < 2) return null
  const [type, id] = parsed
  if (typeof type !== 'string' || typeof id !== 'string') return null
  return [type, id, parsed[2]]
}

/**
 * The whole fallback as one call, and the only shape `demo/main.ts` needs.
 *
 * Answers `undefined` — never a throw, never a rejected promise — for every reason a caller
 * would treat identically: no key pinned, no relay answered, every answer refused. The caller is
 * a discovery round that already treats *no document* as an ordinary state, and handing it an
 * exception would make a third-party relay's silence louder than the origin's.
 *
 * **It opens no socket at all while nothing is pinned.** That is what lets this ship before a
 * project key exists: a page carrying this code today makes exactly the requests it made
 * yesterday, and `built-bundle.e2e.test.ts`'s P10 arithmetic is unchanged.
 */
export async function readNostrBootstrapIfPinned(ports: {
  readonly open: OpenNostrRelay
  readonly now: () => number
  readonly publisher?: BootstrapPublisher
  readonly relays?: readonly string[]
}): Promise<Record<string, unknown> | undefined> {
  const publisher = ports.publisher ?? NOSTR_BOOTSTRAP_PUBLISHER
  if (publisher === NOT_PUBLISHED) return undefined
  const reading = await readNostrBootstrap({
    relays: ports.relays ?? NOSTR_BOOTSTRAP_RELAYS,
    publisher,
    open: ports.open,
    now: ports.now,
  })
  return reading.found ? reading.document : undefined
}
