/**
 * The Nostr bootstrap fallback against the public relays it will actually read.
 *
 * ## What this file is for, and what it deliberately is not
 *
 * `nostr-bootstrap.test.ts` holds every refusal, over a socket it controls, because a hostile
 * relay is not something `nos.lol` will impersonate on request. **This file exists to answer the
 * one question a fake cannot**: does the code as written speak to real relay software at all —
 * the real NIP-01 framing, the real filter, the real WebSocket — or does it only speak to the
 * fake that was written beside it.
 *
 * That distinction has cost this project before. A guard that passed against its own fixture and
 * nothing else is the shape of `.planning`'s recurring finding; the answer is one case against
 * the real thing, and this is it.
 *
 * ## It publishes what it then reads, and the key is thrown away
 *
 * The document is signed under a key minted **inside this run** and never written down, so the
 * events this file creates cannot be updated by anyone afterwards, including this file. They are
 * ephemeral-in-practice rather than by kind: a `30078` under a random pubkey nobody will ever
 * query again. The content is a placeholder multiaddr on `.invalid`, which by RFC 2606 resolves
 * nowhere — nothing here publishes a real address, and nothing here can be dialled.
 *
 * ## It is allowed to be skipped, and says so out loud
 *
 * Public relays are somebody else's infrastructure. `relay.nostr.band` timed out on every run of
 * 2026-09-07 and `relay.damus.io` banned the measuring host at the socket after a burst. A file
 * that failed the suite when a stranger's server was down would be a file that gets deleted, so
 * an unreachable relay set **skips with a named reason** — and the skip is loud rather than a
 * silent pass, because a skip that reads as a pass is how a guard stops guarding.
 */

import { describe, expect, it } from 'vitest'
import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'
import {
  NOSTR_BOOTSTRAP_IDENTIFIER,
  NOSTR_BOOTSTRAP_KIND,
  NOSTR_BOOTSTRAP_RELAYS,
  readNostrBootstrap,
} from './nostr-bootstrap.ts'
import type { NostrSocket, OpenNostrRelay } from './nostr-bootstrap.ts'

/** The document, pointing at a name RFC 2606 reserves so that nothing here is dialable. */
const DOCUMENT = JSON.stringify({
  relayAddrs: ['/dns4/nostr-bootstrap-e2e.invalid/tcp/443/tls/ws/p2p/12D3KooWe2eFixture'],
  peerAddrs: [],
})

/** The real socket, adapted to the narrow port. The whole point of the port is this line. */
const openReal: OpenNostrRelay = (url) => new WebSocket(url) as unknown as NostrSocket

function signDocument(secret: Uint8Array): { readonly pubkey: string; readonly event: unknown } {
  const pubkey = bytesToHex(schnorr.getPublicKey(secret))
  const created = Math.floor(Date.now() / 1000)
  const tags = [['d', NOSTR_BOOTSTRAP_IDENTIFIER]]
  const id = bytesToHex(
    sha256(
      utf8ToBytes(JSON.stringify([0, pubkey, created, NOSTR_BOOTSTRAP_KIND, tags, DOCUMENT])),
    ),
  )
  const sig = bytesToHex(schnorr.sign(hexToBytes(id), secret))
  return {
    pubkey,
    event: { id, pubkey, created_at: created, kind: NOSTR_BOOTSTRAP_KIND, tags, content: DOCUMENT, sig },
  }
}

/** Publish to one relay and report whether it took it. Never throws. */
async function publish(url: string, event: unknown, eventId: string): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    let socket: WebSocket
    try {
      socket = new WebSocket(url)
    } catch {
      resolve(false)
      return
    }
    const finish = (accepted: boolean): void => {
      clearTimeout(timer)
      try {
        socket.close()
      } catch {
        // already gone
      }
      resolve(accepted)
    }
    const timer = setTimeout(() => finish(false), 10_000)
    socket.addEventListener('error', () => finish(false))
    socket.addEventListener('open', () => socket.send(JSON.stringify(['EVENT', event])))
    socket.addEventListener('message', (message: MessageEvent) => {
      if (typeof message.data !== 'string') return
      let frame: unknown
      try {
        frame = JSON.parse(message.data)
      } catch {
        return
      }
      if (Array.isArray(frame) && frame[0] === 'OK' && frame[1] === eventId) finish(frame[2] === true)
    })
  })
}

describe('the nostr bootstrap fallback, against real relays', () => {
  it('publishes a document under a throwaway key and reads it back through the real reader', async (ctx) => {
    const secret = schnorr.utils.randomSecretKey()
    const { pubkey, event } = signDocument(secret)
    const eventId = typeof event === 'object' && event !== null && 'id' in event ? String(event.id) : ''

    const accepted: string[] = []
    for (const url of NOSTR_BOOTSTRAP_RELAYS) {
      if (await publish(url, event, eventId)) accepted.push(url)
    }

    if (accepted.length === 0) {
      // Loud, and with the list, so a reader knows this measured nothing today rather than
      // that everything was fine.
      ctx.skip(
        `no pinned relay accepted a publish — ${NOSTR_BOOTSTRAP_RELAYS.join(', ')}. This case ` +
          'measured NOTHING this run; it is somebody else\'s infrastructure and it was down or ' +
          'refusing.',
      )
      return
    }

    const reading = await readNostrBootstrap({
      relays: NOSTR_BOOTSTRAP_RELAYS,
      publisher: pubkey,
      open: openReal,
      now: () => Date.now(),
      timeoutMs: 15_000,
    })

    expect(
      reading.found,
      `published to ${accepted.join(', ')} and the reader found nothing: ` +
        `${reading.found ? '' : reading.refusals.join(' | ')}`,
    ).toBe(true)
    if (!reading.found) return
    // The document, compared against the literal this file signed — not against anything the
    // reader handed back and not re-serialized here.
    expect(reading.document['relayAddrs']).toEqual([
      '/dns4/nostr-bootstrap-e2e.invalid/tcp/443/tls/ws/p2p/12D3KooWe2eFixture',
    ])
    expect(accepted).toContain(reading.relay)
  }, 120_000)

  it('finds NOTHING for a key nobody has published under, without hanging', async () => {
    // The negative control, and the case that makes the one above a reading rather than a
    // formality: the same relays, the same code, a key with no document, and a bounded answer.
    const stranger = bytesToHex(schnorr.getPublicKey(schnorr.utils.randomSecretKey()))
    const started = Date.now()
    const reading = await readNostrBootstrap({
      relays: NOSTR_BOOTSTRAP_RELAYS,
      publisher: stranger,
      open: openReal,
      now: () => Date.now(),
      timeoutMs: 8_000,
    })
    expect(reading.found).toBe(false)
    if (reading.found) throw new Error('a document appeared for a key nobody published under')
    // Every relay named, so a run that failed for a reason other than absence says which.
    expect(reading.refusals).toHaveLength(NOSTR_BOOTSTRAP_RELAYS.length)
    // It came back on its own budget rather than on the test runner's — a reader that hung
    // would hold a discovery round open for as long as a relay felt like it.
    expect(Date.now() - started).toBeLessThan(30_000)
  }, 120_000)
})
