/**
 * The Nostr bootstrap fallback, over a socket that is entirely under this file's control.
 *
 * ## Why a fake socket rather than a real relay
 *
 * Every decision worth asserting here is about **what this code believes**, and a real relay can
 * only ever hand it things a real relay would hand it. The cases that matter are the ones a
 * hostile or broken relay produces — a valid signature by the wrong key, a document whose content
 * was edited after signing, an answer that arrives first and carries nothing — and none of those
 * is obtainable from `nos.lol` on request. The real-relay reading is
 * `nostr-bootstrap.e2e.test.ts`; this file is where the refusals live.
 *
 * ## The events are signed here, by a second implementation of the serialization
 *
 * `signAs` below writes NIP-01's serialization out again rather than importing the module's. That
 * is deliberate and it is the difference between a test and an echo: an event built by the same
 * expression the verifier hashes would make the id check pass by construction, and the id check
 * is one of the two things standing between a visitor and a relay of somebody else's choosing.
 */

import { describe, expect, it } from 'vitest'
import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'
import {
  NOSTR_BOOTSTRAP_IDENTIFIER,
  NOSTR_BOOTSTRAP_KIND,
  NOSTR_BOOTSTRAP_PUBLISHER,
  NOSTR_BOOTSTRAP_RELAYS,
  NOSTR_DOCUMENT_MAX_AGE_MS,
  NOT_PUBLISHED,
  readNostrBootstrap,
  readNostrBootstrapIfPinned,
  verifyBootstrapEvent,
} from './nostr-bootstrap.ts'
import type { NostrEvent, NostrSocket, OpenNostrRelay } from './nostr-bootstrap.ts'

const NOW = 1_788_800_000_000
const DOCUMENT = '{"relayAddrs":["/dns4/example.invalid/tcp/443/tls/ws/p2p/12D3KooWfake"],"peerAddrs":[]}'

/** Two keys, so "signed by the wrong key" is a case and not a hypothetical. */
const OURS = sha256(utf8ToBytes('the pinned publisher, for this file only'))
const THEIRS = sha256(utf8ToBytes('somebody else entirely'))
const ourPubkey = bytesToHex(schnorr.getPublicKey(OURS))
const theirPubkey = bytesToHex(schnorr.getPublicKey(THEIRS))

interface Draft {
  readonly kind?: number
  readonly identifier?: string
  readonly content?: string
  readonly createdAt?: number
}

/** Build and sign an event — NIP-01's serialization, written out again on purpose. */
function signAs(secret: Uint8Array, draft: Draft = {}): NostrEvent {
  const pubkey = bytesToHex(schnorr.getPublicKey(secret))
  const created = draft.createdAt ?? Math.floor(NOW / 1000)
  const kind = draft.kind ?? NOSTR_BOOTSTRAP_KIND
  const tags = [['d', draft.identifier ?? NOSTR_BOOTSTRAP_IDENTIFIER]]
  const content = draft.content ?? DOCUMENT
  const id = bytesToHex(sha256(utf8ToBytes(JSON.stringify([0, pubkey, created, kind, tags, content]))))
  const sig = bytesToHex(schnorr.sign(hexToBytes(id), secret))
  return { id, pubkey, created_at: created, kind, tags, content, sig }
}

const expectation = { publisher: ourPubkey, identifier: NOSTR_BOOTSTRAP_IDENTIFIER, now: NOW }

// ---------------------------------------------------------------------------
// The verifier — every refusal is a case
// ---------------------------------------------------------------------------

describe('a bootstrap event is believed only when everything about it checks out', () => {
  it('accepts one this fabric signed, and parses the document out of it', () => {
    const verdict = verifyBootstrapEvent(signAs(OURS), expectation)
    expect(verdict.ok).toBe(true)
    if (!verdict.ok) throw new Error(verdict.refusal)
    // The value, not merely the verdict: a parser that answered `ok` with an empty object would
    // pass a boolean assertion and hand the page nothing to dial.
    expect(verdict.document['relayAddrs']).toEqual([
      '/dns4/example.invalid/tcp/443/tls/ws/p2p/12D3KooWfake',
    ])
  })

  it('REFUSES a perfectly valid event signed by somebody else', () => {
    // The whole point of pinning. This event is correct in every way except whose it is, and a
    // reader that took it would dial an address a stranger chose.
    const verdict = verifyBootstrapEvent(signAs(THEIRS), expectation)
    expect(verdict.ok).toBe(false)
    if (verdict.ok) throw new Error('a stranger’s event was believed')
    expect(verdict.refusal).toContain('not by the pinned publisher')
    // And the two keys really are different, asserted rather than assumed — a fixture that
    // generated one key twice would make this case pass while proving nothing.
    expect(theirPubkey).not.toBe(ourPubkey)
  })

  it('REFUSES content edited after signing — the id no longer matches the event', () => {
    const signed = signAs(OURS)
    const tampered: NostrEvent = { ...signed, content: '{"relayAddrs":["/dns4/attacker.invalid"]}' }
    const verdict = verifyBootstrapEvent(tampered, expectation)
    expect(verdict.ok).toBe(false)
    if (verdict.ok) throw new Error('edited content was believed')
    expect(verdict.refusal).toContain('the id does not match')
  })

  it('REFUSES content edited WITH a recomputed id — the signature is over the old one', () => {
    // The case the id check alone does not cover, and the reason both checks exist. An attacker
    // who edits the content can also recompute the id; what they cannot do is sign it.
    const evil = '{"relayAddrs":["/dns4/attacker.invalid"]}'
    const signed = signAs(OURS)
    const reid = bytesToHex(
      sha256(
        utf8ToBytes(
          JSON.stringify([0, signed.pubkey, signed.created_at, signed.kind, signed.tags, evil]),
        ),
      ),
    )
    const verdict = verifyBootstrapEvent({ ...signed, content: evil, id: reid }, expectation)
    expect(verdict.ok).toBe(false)
    if (verdict.ok) throw new Error('a re-identified event was believed')
    expect(verdict.refusal).toContain('signature does not verify')
  })

  it('REFUSES another of the publisher’s documents — wrong kind, wrong d tag', () => {
    const wrongKind = verifyBootstrapEvent(signAs(OURS, { kind: 30079 }), expectation)
    expect(wrongKind.ok).toBe(false)
    if (!wrongKind.ok) expect(wrongKind.refusal).toContain('30079')

    const wrongTag = verifyBootstrapEvent(signAs(OURS, { identifier: 'o2.services/other' }), expectation)
    expect(wrongTag.ok).toBe(false)
    if (!wrongTag.ok) expect(wrongTag.refusal).toContain('not the bootstrap document')
  })

  it('REFUSES a document older than the bound — the one thing a signature cannot say', () => {
    // A relay can replay an old document the publisher genuinely signed, pointing at a relay
    // that has since been retired. `created_at` is the publisher's claim; which event is served
    // is the relay's choice.
    const old = signAs(OURS, { createdAt: Math.floor((NOW - NOSTR_DOCUMENT_MAX_AGE_MS - 86_400_000) / 1000) })
    const verdict = verifyBootstrapEvent(old, expectation)
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.refusal).toContain('days old')

    // And one just inside the bound is still believed, so the check is a bound and not a ban.
    const fresh = signAs(OURS, { createdAt: Math.floor((NOW - NOSTR_DOCUMENT_MAX_AGE_MS + 86_400_000) / 1000) })
    expect(verifyBootstrapEvent(fresh, expectation).ok).toBe(true)
  })

  it('REFUSES a future-dated document, which would otherwise never expire', () => {
    const ahead = signAs(OURS, { createdAt: Math.floor(NOW / 1000) + 86_400 })
    const verdict = verifyBootstrapEvent(ahead, expectation)
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.refusal).toContain('dated in the future')
  })

  it('REFUSES content that is not a JSON object', () => {
    const notJson = verifyBootstrapEvent(signAs(OURS, { content: 'not json at all' }), expectation)
    expect(notJson.ok).toBe(false)
    if (!notJson.ok) expect(notJson.refusal).toContain('not JSON')

    // An array parses and is not a document: a caller reaching for `peerAddrs` on it reads
    // `undefined` and reports *no relays* rather than *a bad document*.
    const array = verifyBootstrapEvent(signAs(OURS, { content: '[1,2,3]' }), expectation)
    expect(array.ok).toBe(false)
    if (!array.ok) expect(array.refusal).toContain('not a JSON object')
  })

  it('REFUSES anything that is not an event at all, without throwing', () => {
    for (const junk of [null, undefined, 42, 'a string', [], {}, { id: 1 }, { ...signAs(OURS), tags: [[1]] }]) {
      const verdict = verifyBootstrapEvent(junk, expectation)
      expect(verdict.ok, `${JSON.stringify(junk)} was believed`).toBe(false)
    }
  })

  it('REFUSES a signature that is not readable as hex, by name and not by throwing', () => {
    const verdict = verifyBootstrapEvent({ ...signAs(OURS), sig: 'zzzz' }, expectation)
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.refusal).toContain('hex')
  })
})

// ---------------------------------------------------------------------------
// The race
// ---------------------------------------------------------------------------

/** A scripted relay. Frames are delivered on the tick the script names. */
interface Script {
  readonly openAfter?: number
  readonly frames?: readonly (readonly [number, unknown])[]
  readonly errorAfter?: number
  readonly closeAfter?: number
  readonly throwOnOpen?: boolean
  readonly sendThrows?: boolean
  /** Frames delivered verbatim, NOT JSON-encoded — a relay that sends something that is not JSON. */
  readonly rawFrames?: readonly (readonly [number, string])[]
}

class FakeRelay implements NostrSocket {
  readonly sent: string[] = []
  closed = false
  readonly #listeners = new Map<string, ((event: { data?: unknown }) => void)[]>()

  constructor(script: Script) {
    const fire = (type: string, payload: { data?: unknown } = {}): void => {
      if (this.closed) return
      for (const listener of this.#listeners.get(type) ?? []) listener(payload)
    }
    if (script.openAfter !== undefined) setTimeout(() => fire('open'), script.openAfter)
    for (const [at, frame] of script.frames ?? []) {
      setTimeout(() => fire('message', { data: JSON.stringify(frame) }), at)
    }
    for (const [at, raw] of script.rawFrames ?? []) {
      setTimeout(() => fire('message', { data: raw }), at)
    }
    if (script.errorAfter !== undefined) setTimeout(() => fire('error'), script.errorAfter)
    if (script.closeAfter !== undefined) setTimeout(() => fire('close'), script.closeAfter)
  }

  /** Set by a script that wants `send` to fail — a relay that accepts a socket and then breaks. */
  sendThrows = false

  send(data: string): void {
    if (this.sendThrows) throw new Error('the socket went away mid-question')
    this.sent.push(data)
  }

  close(): void {
    this.closed = true
  }

  addEventListener(type: string, listener: (event: { data?: unknown }) => void): void {
    const existing = this.#listeners.get(type) ?? []
    existing.push(listener)
    this.#listeners.set(type, existing)
  }
}

function relays(scripts: Readonly<Record<string, Script>>): {
  open: OpenNostrRelay
  sockets: Map<string, FakeRelay>
} {
  const sockets = new Map<string, FakeRelay>()
  const open: OpenNostrRelay = (url) => {
    const script = scripts[url]
    if (script === undefined) throw new Error(`no script for ${url}`)
    if (script.throwOnOpen === true) throw new Error('refused the connection')
    const socket = new FakeRelay(script)
    if (script.sendThrows === true) socket.sendThrows = true
    sockets.set(url, socket)
    return socket
  }
  return { open, sockets }
}

const eventFrame = (event: NostrEvent): readonly [number, unknown] => [5, ['EVENT', 'o2b', event]]
const eoseAt = (at: number): readonly [number, unknown] => [at, ['EOSE', 'o2b']]

describe('the race across relays', () => {
  const base = { publisher: ourPubkey, now: () => NOW, timeoutMs: 200 }

  it('takes the document from whichever relay has it', async () => {
    const { open, sockets } = relays({
      'wss://a': { openAfter: 1, frames: [eventFrame(signAs(OURS)), eoseAt(6)] },
    })
    const reading = await readNostrBootstrap({ ...base, relays: ['wss://a'], open })
    expect(reading.found).toBe(true)
    if (!reading.found) throw new Error(reading.refusals.join('; '))
    expect(reading.relay).toBe('wss://a')
    expect(reading.document['relayAddrs']).toBeDefined()

    // It asked the right question — kind, author and d tag — rather than subscribing to
    // everything and filtering, which would make a relay send a visitor the whole firehose.
    const asked: unknown = JSON.parse(sockets.get('wss://a')?.sent[0] ?? 'null')
    expect(JSON.stringify(asked)).toContain(NOSTR_BOOTSTRAP_IDENTIFIER)
    expect(JSON.stringify(asked)).toContain(ourPubkey)
  })

  it('is NOT won by a fast relay that answers with nothing', async () => {
    // The reason the race is hand-written instead of `Promise.any`: a relay that has never heard
    // of this document answers promptly and correctly with nothing, and the fastest relay is
    // often the emptiest.
    const { open } = relays({
      'wss://empty': { openAfter: 1, frames: [eoseAt(2)] },
      'wss://has-it': { openAfter: 1, frames: [[40, ['EVENT', 'o2b', signAs(OURS)]], eoseAt(45)] },
    })
    const reading = await readNostrBootstrap({ ...base, relays: ['wss://empty', 'wss://has-it'], open })
    expect(reading.found).toBe(true)
    if (!reading.found) throw new Error(reading.refusals.join('; '))
    expect(reading.relay).toBe('wss://has-it')
  })

  it('is NOT won by a relay serving somebody else’s event, while a good one still wins', async () => {
    const { open } = relays({
      'wss://liar': { openAfter: 1, frames: [eventFrame(signAs(THEIRS)), eoseAt(8)] },
      'wss://honest': { openAfter: 1, frames: [[40, ['EVENT', 'o2b', signAs(OURS)]], eoseAt(45)] },
    })
    const reading = await readNostrBootstrap({ ...base, relays: ['wss://liar', 'wss://honest'], open })
    expect(reading.found).toBe(true)
    if (!reading.found) throw new Error(reading.refusals.join('; '))
    expect(reading.relay).toBe('wss://honest')
  })

  it('survives dead relays placed first, which is the shape it was measured in', async () => {
    const { open } = relays({
      'wss://dead': { throwOnOpen: true },
      'wss://silent': { openAfter: 1 },
      'wss://errors': { openAfter: 1, errorAfter: 3 },
      'wss://good': { openAfter: 1, frames: [[20, ['EVENT', 'o2b', signAs(OURS)]], eoseAt(25)] },
    })
    const reading = await readNostrBootstrap({
      ...base,
      relays: ['wss://dead', 'wss://silent', 'wss://errors', 'wss://good'],
      open,
    })
    expect(reading.found).toBe(true)
    if (!reading.found) throw new Error(reading.refusals.join('; '))
    expect(reading.relay).toBe('wss://good')
  })

  it('answers a refusal per relay when every one of them fails', async () => {
    const { open } = relays({
      'wss://dead': { throwOnOpen: true },
      'wss://empty': { openAfter: 1, frames: [eoseAt(2)] },
      'wss://silent': { openAfter: 1 },
    })
    const reading = await readNostrBootstrap({
      ...base,
      relays: ['wss://dead', 'wss://empty', 'wss://silent'],
      open,
    })
    expect(reading.found).toBe(false)
    if (reading.found) throw new Error('a document appeared from nowhere')
    expect(reading.refusals).toHaveLength(3)
    // Each named, so an operator reading the log knows which relay did what rather than that
    // "it failed".
    expect(reading.refusals.join('\n')).toContain('wss://dead')
    expect(reading.refusals.join('\n')).toContain('wss://empty')
    expect(reading.refusals.join('\n')).toContain('wss://silent')
  })

  it('closes every socket it opened, including the losers’', async () => {
    const { open, sockets } = relays({
      'wss://slow': { openAfter: 1, frames: [eoseAt(150)] },
      'wss://fast': { openAfter: 1, frames: [[10, ['EVENT', 'o2b', signAs(OURS)]], eoseAt(12)] },
    })
    await readNostrBootstrap({ ...base, relays: ['wss://slow', 'wss://fast'], open })
    // The loser is still in flight when the race resolves, so this is asserted after its own
    // timeout has had time to fire. A tab that leaked one socket per round would hold
    // connections to strangers' infrastructure for its whole life.
    await new Promise((resolve) => setTimeout(resolve, 260))
    for (const [url, socket] of sockets) {
      expect(socket.closed, `${url} was left open`).toBe(true)
    }
  })

  it('refuses an empty relay list rather than answering found:false quietly', async () => {
    const reading = await readNostrBootstrap({ ...base, relays: [], open: () => { throw new Error('must not open') } })
    expect(reading.found).toBe(false)
    if (reading.found) throw new Error('unreachable')
    expect(reading.refusals).toEqual(['no relays configured'])
  })
})

// ---------------------------------------------------------------------------
// Inert until a key is pinned
// ---------------------------------------------------------------------------

describe('what the shipped pin is, and what an unpinned one still does', () => {
  it('opens NO socket for a publisher of NOT_PUBLISHED', async () => {
    // **This case was written when the SHIPPED pin was `NOT_PUBLISHED`, and it said so.** The
    // key was minted on 2026-09-07 and the pin is now real, so the sentence *"which is the
    // state this ships in"* went false and is gone rather than reworded. What survives is the
    // property of the function, which a fork, a second fabric or a rotation window still needs:
    // an unpinned publisher reads nothing and asks nobody. The publisher is supplied explicitly
    // here for exactly that reason — the shipped constant is no longer this value and the case
    // must not depend on it being.
    let opened = 0
    const result = await readNostrBootstrapIfPinned({
      publisher: NOT_PUBLISHED,
      open: () => {
        opened += 1
        throw new Error('must not open a socket')
      },
      now: () => NOW,
    })
    expect(result).toBeUndefined()
    expect(opened).toBe(0)
  })

  it('ships a REAL pin — 64 lowercase hex, and not the public spike key', () => {
    // `trustAnchors`' discipline, applied: an empty pin is indistinguishable from a forgotten
    // one, so the absence has a name.
    expect(NOT_PUBLISHED).toBe('no-nostr-bootstrap-published')
    expect(NOSTR_BOOTSTRAP_PUBLISHER).not.toBe(NOT_PUBLISHED)
    expect(NOSTR_BOOTSTRAP_PUBLISHER).toMatch(/^[0-9a-f]{64}$/)

    // **The paste this guards against.** `.planning/consults/2026-09-07-nostr-as-a-bootstrap-
    // tier-measured.md` §9 published a document under a key derived from a fixed sentence, so
    // that it would be reproducible — which means anybody can sign under it. Pinning it would
    // be strictly worse than pinning nothing, and it is one copy-paste away.
    expect(NOSTR_BOOTSTRAP_PUBLISHER).not.toBe(
      '717a67daccfa35ad51b1ccdfebd586a42aae9bc479965f08c54a04be964368bc',
    )
  })

  it('does open sockets once a publisher IS supplied, so the inertness is a pin and not a stub', async () => {
    // The positive control for the case above. Without it, a function that always returned
    // `undefined` would pass every assertion in this block.
    const { open } = relays({ 'wss://a': { openAfter: 1, frames: [eventFrame(signAs(OURS)), eoseAt(6)] } })
    const result = await readNostrBootstrapIfPinned({
      open,
      now: () => NOW,
      publisher: ourPubkey,
      relays: ['wss://a'],
    })
    expect(result).toBeDefined()
    expect(result?.['relayAddrs']).toBeDefined()
  })

  it('pins relays that were measured, and not the one that bans', () => {
    expect(NOSTR_BOOTSTRAP_RELAYS.length).toBeGreaterThanOrEqual(3)
    // `relay.damus.io` refused 26 of 30 events in a burst and then stopped accepting
    // connections from the measuring host entirely, 2026-09-07.
    expect(NOSTR_BOOTSTRAP_RELAYS).not.toContain('wss://relay.damus.io')
    for (const url of NOSTR_BOOTSTRAP_RELAYS) expect(url.startsWith('wss://')).toBe(true)
  })
})

describe('a relay that misbehaves after the socket is up', () => {
  const base = { publisher: ourPubkey, now: () => NOW, timeoutMs: 200 }

  it('reports a socket that closes before answering, by name', async () => {
    const { open } = relays({ 'wss://hangs-up': { openAfter: 1, closeAfter: 5 } })
    const reading = await readNostrBootstrap({ ...base, relays: ['wss://hangs-up'], open })
    expect(reading.found).toBe(false)
    if (reading.found) throw new Error('unreachable')
    expect(reading.refusals[0]).toContain('closed before answering')
  })

  it('reports a socket that cannot be asked, rather than waiting out the timeout', async () => {
    const { open } = relays({ 'wss://breaks': { openAfter: 1, sendThrows: true } })
    const started = Date.now()
    const reading = await readNostrBootstrap({ ...base, relays: ['wss://breaks'], open })
    expect(reading.found).toBe(false)
    if (reading.found) throw new Error('unreachable')
    expect(reading.refusals[0]).toContain('could not ask')
    // It answered on the failure and not on the clock. Compared against this file's own
    // `timeoutMs` of 200 rather than an absolute, so the case says what it means on any host.
    expect(Date.now() - started).toBeLessThan(200)
  })

  it('ignores chatter that is not a frame, and still answers from the same relay', async () => {
    // Relays send NOTICE, AUTH and their own inventions. A reader that fell over on the first
    // unrecognised line would be a reader every relay eventually breaks.
    const { open } = relays({
      'wss://chatty': {
        openAfter: 1,
        frames: [
          [2, 'this is not json at all'],
          [3, ['NOTICE', 'restricted: pay to write']],
          [4, ['EVENT', 'a-different-subscription', signAs(THEIRS)]],
          [5, { not: 'an array' }],
          eventFrame(signAs(OURS)),
          eoseAt(8),
        ],
      },
    })
    const reading = await readNostrBootstrap({ ...base, relays: ['wss://chatty'], open })
    expect(reading.found).toBe(true)
    if (!reading.found) throw new Error(reading.refusals.join('; '))
    expect(reading.document['relayAddrs']).toBeDefined()
  })
})

describe('nothing a relay or a port can do leaves a read hanging', () => {
  const base = { publisher: ourPubkey, timeoutMs: 200 }

  it('ignores a frame that is not JSON at all, and still takes the good one after it', async () => {
    // The fake JSON-encodes its frames, so a string that merely looks like prose still arrives
    // as valid JSON. This uses the raw channel: bytes a relay sent that no parser will take.
    const { open } = relays({
      'wss://garbage': {
        openAfter: 1,
        rawFrames: [[2, '<html>502 Bad Gateway</html>'], [3, '{"unterminated']],
        frames: [[5, ['EVENT', 'o2b', signAs(OURS)]], eoseAt(8)],
      },
    })
    const reading = await readNostrBootstrap({ ...base, now: () => NOW, relays: ['wss://garbage'], open })
    expect(reading.found).toBe(true)
    if (!reading.found) throw new Error(reading.refusals.join('; '))
    expect(reading.document['relayAddrs']).toBeDefined()
  })

  it('survives a CLOCK that throws, which is the boundary a throw would escape from', async () => {
    // `now` is an injected port and a port can fail. Verification runs inside a socket callback,
    // which has no caller to catch anything: an unguarded throw there would leave this relay's
    // promise pending until the timeout and would report *no answer* on a relay that answered.
    const { open } = relays({
      'wss://a': { openAfter: 1, frames: [eventFrame(signAs(OURS)), eoseAt(8)] },
    })
    const reading = await readNostrBootstrap({
      ...base,
      now: () => {
        throw new Error('the clock is broken')
      },
      relays: ['wss://a'],
      open,
    })
    expect(reading.found).toBe(false)
    if (reading.found) throw new Error('a document was believed with no clock to date it against')
    expect(reading.refusals[0]).toContain('verification threw')
    expect(reading.refusals[0]).toContain('the clock is broken')
  })
})

describe('the pinned defaults are what a caller gets when it supplies nothing', () => {
  it('asks the PINNED relay list when none is supplied', async () => {
    // The production call site passes neither a relay list nor an identifier. Every earlier case
    // supplies both, so without this one the shipped defaults are never on a path any test takes.
    const asked: string[] = []
    const result = await readNostrBootstrapIfPinned({
      publisher: ourPubkey,
      now: () => NOW,
      open: (url) => {
        asked.push(url)
        throw new Error('not answering, this case is about which relays were asked')
      },
    })
    expect(result).toBeUndefined()
    expect([...asked].sort()).toEqual([...NOSTR_BOOTSTRAP_RELAYS].sort())
  })

  it('reports a non-Error thrown by a socket factory without stringifying it as [object Object]', async () => {
    // A port is somebody else's code and may throw anything at all. The refusal has to name
    // something a reader can act on either way.
    const reading = await readNostrBootstrap({
      relays: ['wss://rude'],
      publisher: ourPubkey,
      now: () => NOW,
      timeoutMs: 200,
      open: () => {
        throw 'a bare string, which is legal and happens'
      },
    })
    expect(reading.found).toBe(false)
    if (reading.found) throw new Error('unreachable')
    expect(reading.refusals[0]).toContain('a bare string')
  })

  it('does the same for a non-Error thrown inside verification', async () => {
    // The other of the two `instanceof Error` alternates, on the boundary that matters more:
    // this one runs inside a socket callback.
    const { open } = relays({ 'wss://a': { openAfter: 1, frames: [eventFrame(signAs(OURS)), eoseAt(8)] } })
    const reading = await readNostrBootstrap({
      relays: ['wss://a'],
      publisher: ourPubkey,
      timeoutMs: 200,
      open,
      now: () => {
        throw { code: 'CLOCK_GONE' }
      },
    })
    expect(reading.found).toBe(false)
    if (reading.found) throw new Error('unreachable')
    expect(reading.refusals[0]).toContain('verification threw')
  })
})
