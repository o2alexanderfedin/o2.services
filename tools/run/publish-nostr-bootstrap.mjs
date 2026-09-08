/**
 * Publish the bootstrap document to the pinned Nostr relays — the half that makes the fallback
 * in `packages/browser/src/nostr-bootstrap.ts` reachable.
 *
 * ## Why this is a script and not part of the browser package
 *
 * It signs, and signing needs the secret half. Nothing that ships to a visitor may contain code
 * whose only purpose is to use a key no visitor has: the browser **verifies** and never signs,
 * and keeping the two in different packages is what makes that true by construction rather than
 * by discipline.
 *
 * ## It writes NIP-01's serialization a second time, and that is checked rather than trusted
 *
 * The reader recomputes the event id from the same rules. Two implementations of one
 * serialization is two places to be wrong — so `nostr-publish.node.test.ts` takes an event this
 * file produced and runs the reader's own `verifyBootstrapEvent` over it. If the two ever
 * disagree, the publisher's output stops verifying and that spec goes red, which is a stronger
 * check than sharing a function would have been: a shared bug verifies itself.
 *
 * ## Where the key comes from, in order
 *
 * 1. `O2_NOSTR_SECRET_KEY` in the environment — how CI would supply it.
 * 2. `.secrets/O2_NOSTR_SECRET_KEY` — gitignored, `0600`, how a laptop supplies it.
 *
 * **Absence is not an error.** `deploy-pages.sh` calls this after a successful publish of the
 * client, and failing the deploy of the page every visitor loads because an optional fallback
 * could not be refreshed would be the wrong way round. It says so loudly and exits 0.
 *
 * ## Usage
 *
 *   node --experimental-strip-types tools/run/publish-nostr-bootstrap.mjs <path to bootstrap.json>
 */

import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { schnorr } from '@noble/curves/secp256k1.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js'

/** NIP-78 parameterized replaceable — the same kind the reader filters on. */
export const KIND = 30078

/** The `d` tag — the same identifier the reader filters on. */
export const IDENTIFIER = 'o2.services/bootstrap'

/**
 * The relays written to.
 *
 * **Deliberately the same list the reader asks**, and it is a list rather than one relay for the
 * reason measured on 2026-09-07: `relay.nostr.band` was unreachable all day and `relay.damus.io`
 * banned the measuring host at the socket after a burst. Writing to one relay is a bootstrap
 * document that disappears when somebody else's server has a bad day.
 */
export const RELAYS = [
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://nostr.mom',
  'wss://relay.snort.social',
]

/**
 * Sign a document as a bootstrap event.
 *
 * `createdAt` is a parameter with no default so that a caller cannot accidentally sign with a
 * clock it did not choose — this value is what a relay uses to decide which of two documents is
 * newer, and what the reader uses to refuse a replayed one.
 */
export function signBootstrapDocument(secretHex, document, createdAt) {
  const secret = hexToBytes(secretHex.trim())
  const pubkey = bytesToHex(schnorr.getPublicKey(secret))
  const tags = [['d', IDENTIFIER]]
  const id = bytesToHex(
    sha256(utf8ToBytes(JSON.stringify([0, pubkey, createdAt, KIND, tags, document]))),
  )
  const sig = bytesToHex(schnorr.sign(hexToBytes(id), secret))
  return { id, pubkey, created_at: createdAt, kind: KIND, tags, content: document, sig }
}

/**
 * Send one event to one relay and report what it said.
 *
 * Never throws and never rejects: a relay is somebody else's server, and one refusing is a fact
 * to report rather than a reason to fail a deploy.
 */
export function publishTo(url, event, timeoutMs = 10_000) {
  return new Promise((resolve) => {
    let socket
    const finish = (accepted, detail) => {
      clearTimeout(timer)
      try {
        socket?.close()
      } catch {
        // already gone
      }
      resolve({ url, accepted, detail })
    }
    const timer = setTimeout(() => finish(false, `no answer within ${timeoutMs} ms`), timeoutMs)
    try {
      socket = new WebSocket(url)
    } catch (cause) {
      finish(false, `could not open: ${cause instanceof Error ? cause.message : String(cause)}`)
      return
    }
    socket.addEventListener('error', () => finish(false, 'socket error'))
    socket.addEventListener('open', () => socket.send(JSON.stringify(['EVENT', event])))
    socket.addEventListener('message', (message) => {
      if (typeof message.data !== 'string') return
      let frame
      try {
        frame = JSON.parse(message.data)
      } catch {
        return
      }
      if (Array.isArray(frame) && frame[0] === 'OK' && frame[1] === event.id) {
        finish(frame[2] === true, String(frame[3] ?? ''))
      }
    })
  })
}

/** The key, from the environment or from the ignored directory beside the project, or `null`. */
export function readSecret(env = process.env, secretsPath = '.secrets/O2_NOSTR_SECRET_KEY') {
  const fromEnv = env['O2_NOSTR_SECRET_KEY']
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return fromEnv.trim()
  try {
    const onDisk = readFileSync(secretsPath, 'utf8').trim()
    return onDisk === '' ? null : onDisk
  } catch {
    return null
  }
}

async function main() {
  const documentPath = process.argv[2]
  if (documentPath === undefined) {
    console.error('usage: publish-nostr-bootstrap.mjs <path to bootstrap.json>')
    process.exit(2)
  }

  const secret = readSecret()
  if (secret === null) {
    // Loud, and exit 0. See this file's header: the page every visitor loads must not fail to
    // publish because an optional fallback could not be refreshed.
    console.log('')
    console.log('⚠️  NO NOSTR KEY — the bootstrap fallback was NOT refreshed.')
    console.log('   Set O2_NOSTR_SECRET_KEY, or put it in .secrets/O2_NOSTR_SECRET_KEY.')
    console.log('   The published client is unaffected; visitors whose origin answers are too.')
    console.log('   What is stale is the copy a visitor reads only when their origin gives them')
    console.log('   nothing — and a stale address there fails to dial rather than dialling')
    console.log('   somebody else.')
    return
  }

  const document = readFileSync(documentPath, 'utf8').trim()
  const event = signBootstrapDocument(secret, document, Math.floor(Date.now() / 1000))
  console.log(`Publishing ${String(document.length)} bytes as ${event.pubkey}`)

  const results = await Promise.all(RELAYS.map((url) => publishTo(url, event)))
  let accepted = 0
  for (const result of results) {
    console.log(`  ${result.accepted ? '✅' : '❌'} ${result.url}${result.detail ? ` — ${result.detail}` : ''}`)
    if (result.accepted) accepted += 1
  }

  if (accepted === 0) {
    console.log('')
    console.log('⚠️  NO relay accepted the bootstrap document. The fallback is stale.')
    console.log('   Not a deploy failure — see this script’s header — but worth chasing.')
    return
  }
  console.log('')
  console.log(`✅ bootstrap document published to ${String(accepted)} of ${String(RELAYS.length)} relays.`)
}

// Only when run, never when imported — the spec beside this imports the functions above.
// Compared as resolved file URLs rather than by suffix: a suffix test matches any file whose
// name happens to end the same way, and this decision is "do the network thing or do not".
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
