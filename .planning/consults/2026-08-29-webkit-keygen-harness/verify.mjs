// Independent check of the patched extraction. @noble/curves knows nothing about libgcrypt
// or WebKit: it derives the Ed25519 public key from the private seed per RFC 8032. If the
// zero-prefixed bytes are the real key, noble's derivation matches the q libgcrypt returned.
//
// `full` draws are the CONTROL — the shipping code keeps those, so if noble disagreed there
// the comparison itself would be wrong rather than the patch.
import { readFileSync } from 'node:fs'
import { ed25519 } from '@noble/curves/ed25519.js'

const hex = (s) => Uint8Array.from(s.match(/../g).map((b) => parseInt(b, 16)))
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i])

const tally = { short: { n: 0, ok: 0 }, full: { n: 0, ok: 0 } }
const failures = []

for (const line of readFileSync('draws.txt', 'utf8').trim().split('\n')) {
  const [kind, dHex, qHex, dNat, qNat] = line.split(' ')
  const d = hex(dHex)
  const q = hex(qHex)
  if (d.length !== 32 || q.length !== 32) throw new Error(`not 32 bytes: ${line}`)
  const derived = ed25519.getPublicKey(d)
  tally[kind].n += 1
  if (same(derived, q)) tally[kind].ok += 1
  else failures.push({ kind, dNat, qNat, dHex, qHex, derived: Buffer.from(derived).toString('hex') })
}

console.log(JSON.stringify({ tally, failures: failures.slice(0, 3), failureCount: failures.length }, null, 2))
process.exit(failures.length === 0 ? 0 : 1)
