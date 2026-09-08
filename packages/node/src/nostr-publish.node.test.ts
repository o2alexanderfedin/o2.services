/**
 * The publisher and the reader agree — asserted, not assumed.
 *
 * `tools/run/publish-nostr-bootstrap.mjs` writes NIP-01's serialization out a second time,
 * because signing needs a secret half and nothing that ships to a visitor may carry code whose
 * only purpose is to use a key no visitor has. Two implementations of one serialization is two
 * places to be wrong.
 *
 * **This file is why that is safe.** It takes an event the publisher produced and runs the
 * *reader's own* `verifyBootstrapEvent` over it. If the two ever drift — a tag reordered, a
 * field renamed, a number stringified — the publisher's output stops verifying and this goes
 * red. Sharing one function would have been weaker, not stronger: a shared bug verifies itself,
 * and a visitor would be handed a document nothing on the reading side ever refused.
 *
 * Nothing here touches the network. `publishTo` is the only function that does and it is
 * deliberately not exercised here; the real-relay reading is
 * `packages/browser/src/nostr-bootstrap.e2e.test.ts`.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { schnorr } from '@noble/curves/secp256k1.js'
import { bytesToHex } from '@noble/hashes/utils.js'
import {
  IDENTIFIER,
  KIND,
  RELAYS,
  readSecret,
  signBootstrapDocument,
} from '../../../tools/run/publish-nostr-bootstrap.mjs'
// By relative path rather than through `@o2/browser`, deliberately. Barrel-exporting these to
// let one spec import them would widen the shipped public API for a test's convenience and hand
// `reachability-guard.node.test.ts` exports no production caller has — `capability-fixture.ts`'s
// stated argument, applied. The `tools/` import above takes the same route for the same reason.
import {
  NOSTR_BOOTSTRAP_IDENTIFIER,
  NOSTR_BOOTSTRAP_KIND,
  NOSTR_BOOTSTRAP_RELAYS,
  NOSTR_DOCUMENT_MAX_AGE_MS,
  verifyBootstrapEvent,
} from '../../browser/src/nostr-bootstrap.ts'

const DOCUMENT = JSON.stringify({
  relayAddrs: ['/dns4/example.invalid/tcp/443/tls/ws/p2p/12D3KooWfixture'],
  peerAddrs: [],
})

const scratch: string[] = []
afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true })
})

function scratchDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'o2-nostr-publish-'))
  scratch.push(dir)
  return dir
}

describe('the publisher produces exactly what the reader will accept', () => {
  const secretBytes = schnorr.utils.randomSecretKey()
  const secret = bytesToHex(secretBytes)
  const pubkey = bytesToHex(schnorr.getPublicKey(secretBytes))
  const now = 1_788_900_000_000

  it('signs a document the READER’s verifier believes', () => {
    // The whole point of this file. Not "the event looks right" — the reading side says so.
    const event = signBootstrapDocument(secret, DOCUMENT, Math.floor(now / 1000))
    const verdict = verifyBootstrapEvent(event, {
      publisher: pubkey,
      identifier: NOSTR_BOOTSTRAP_IDENTIFIER,
      now,
    })
    expect(verdict.ok, verdict.ok ? '' : verdict.refusal).toBe(true)
    if (!verdict.ok) return
    expect(verdict.document['relayAddrs']).toEqual([
      '/dns4/example.invalid/tcp/443/tls/ws/p2p/12D3KooWfixture',
    ])
  })

  it('is refused by the reader when signed by a DIFFERENT key, so the case above is not vacuous', () => {
    // The positive control for the control. Without it, a verifier that answered `ok` for
    // everything would pass the case above and this file would prove nothing at all.
    const event = signBootstrapDocument(
      bytesToHex(schnorr.utils.randomSecretKey()),
      DOCUMENT,
      Math.floor(now / 1000),
    )
    const verdict = verifyBootstrapEvent(event, {
      publisher: pubkey,
      identifier: NOSTR_BOOTSTRAP_IDENTIFIER,
      now,
    })
    expect(verdict.ok).toBe(false)
  })

  it('produces an event the reader refuses once it has aged past the bound', () => {
    // The publisher's `created_at` is what the reader dates a document by, so the two must
    // agree about the units — seconds on the wire, milliseconds in the reader. A publisher that
    // signed milliseconds would produce documents dated fifty thousand years in the future, and
    // this is the case that would say so.
    const aged = signBootstrapDocument(
      secret,
      DOCUMENT,
      Math.floor((now - NOSTR_DOCUMENT_MAX_AGE_MS - 86_400_000) / 1000),
    )
    const verdict = verifyBootstrapEvent(aged, { publisher: pubkey, identifier: IDENTIFIER, now })
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.refusal).toContain('days old')
  })

  it('agrees with the reader about the kind, the identifier and the relay list', () => {
    // Three constants declared on both sides. They are compared here rather than shared,
    // because sharing would put a publisher's constants into the bundle a visitor downloads.
    expect(KIND).toBe(NOSTR_BOOTSTRAP_KIND)
    expect(IDENTIFIER).toBe(NOSTR_BOOTSTRAP_IDENTIFIER)
    expect([...RELAYS].sort()).toEqual([...NOSTR_BOOTSTRAP_RELAYS].sort())
  })
})

describe('where the key comes from', () => {
  it('prefers the environment, which is how CI would supply it', () => {
    expect(readSecret({ O2_NOSTR_SECRET_KEY: 'abc123' }, '/nonexistent')).toBe('abc123')
  })

  it('falls back to the ignored file beside the project', () => {
    const dir = scratchDir()
    const path = join(dir, 'key')
    writeFileSync(path, 'deadbeef\n')
    expect(readSecret({}, path)).toBe('deadbeef')
  })

  it('answers null when there is neither, which is a WARNING and not a deploy failure', () => {
    // `deploy-pages.sh` must not fail the publish of the page every visitor loads because an
    // optional fallback could not be refreshed. The script's own header states it; this is the
    // value that behaviour turns on.
    expect(readSecret({}, '/nonexistent')).toBe(null)
    // An empty file is the same as no file — a key that is the empty string would sign nothing
    // and would be indistinguishable from a forgotten one.
    const dir = scratchDir()
    const path = join(dir, 'empty')
    writeFileSync(path, '   \n')
    expect(readSecret({}, path)).toBe(null)
    expect(readSecret({ O2_NOSTR_SECRET_KEY: '   ' }, '/nonexistent')).toBe(null)
  })
})
