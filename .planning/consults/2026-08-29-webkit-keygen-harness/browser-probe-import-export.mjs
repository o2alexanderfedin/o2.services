/*
 * The generation path REFUSES a zero-leading key. The import/export paths do not refuse —
 * they produce a value. This asks what value.
 *
 *  CryptoKeyOKPGCrypt.cpp:236  mpiData(q) on SPKI import, with NO length check at all
 *  CryptoKeyOKPGCrypt.cpp:503  mpiData(q) in generateJwkX(), size()==32 or the field is empty
 *
 * Seeds whose PUBLIC half begins 0x00 are found here with @noble/curves — the engine cannot
 * generate one, so they have to be brought in from outside. Control seeds are ordinary.
 */
import { webkit, chromium, firefox } from 'playwright'
import http from 'node:http'
import { ed25519 } from '@noble/curves/ed25519.js'

const b64u = (b) => Buffer.from(b).toString('base64url')

const zeroLeading = []
const control = []
for (let i = 0; zeroLeading.length < 20 || control.length < 20; i++) {
  const seed = ed25519.utils.randomSecretKey()
  const pub = ed25519.getPublicKey(seed)
  const row = { d: b64u(seed), x: b64u(pub) }
  if (pub[0] === 0 && zeroLeading.length < 20) zeroLeading.push(row)
  else if (pub[0] !== 0 && control.length < 20) control.push(row)
  if (i > 40000) break
}
console.error(`found ${zeroLeading.length} zero-leading public keys, ${control.length} controls`)

const server = http.createServer((_q, res) => {
  res.writeHead(200, { 'content-type': 'text/html' })
  res.end('<!doctype html><meta charset="utf-8"><title>probe</title>')
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const { port } = server.address()

const engines = { webkit, chromium, firefox }
const out = {}
for (const [name, launcher] of Object.entries(engines)) {
  const browser = await launcher.launch()
  const page = await browser.newPage()
  await page.goto(`http://127.0.0.1:${port}/`)
  out[name] = await page.evaluate(async ({ zeroLeading, control }) => {
    const b64uToBytes = (s) => {
      const b = atob(s.replace(/-/g, '+').replace(/_/g, '/'))
      return Uint8Array.from(b, (c) => c.charCodeAt(0))
    }
    // Ed25519 SPKI is a fixed 12-byte prefix followed by the 32-byte key.
    const SPKI_PREFIX = new Uint8Array([0x30,0x2a,0x30,0x05,0x06,0x03,0x2b,0x65,0x70,0x03,0x21,0x00])

    const run = async (rows) => {
      const t = { n: 0, jwkPrivateXLengths: {}, rawPublicExportLengths: {}, spkiToRawLengths: {}, errors: {} }
      for (const row of rows) {
        t.n += 1
        // 1. private key imported as JWK, exported as JWK -> what is `x`?
        try {
          const k = await crypto.subtle.importKey('jwk',
            { kty: 'OKP', crv: 'Ed25519', d: row.d, x: row.x }, { name: 'Ed25519' }, true, ['sign'])
          const j = await crypto.subtle.exportKey('jwk', k)
          const len = j.x === undefined ? 'absent' : String(b64uToBytes(j.x).length)
          t.jwkPrivateXLengths[len] = (t.jwkPrivateXLengths[len] ?? 0) + 1
        } catch (e) { t.errors['jwkPrivate:' + e.name] = (t.errors['jwkPrivate:' + e.name] ?? 0) + 1 }

        // 2. public key imported raw, exported raw -> how many bytes?
        try {
          const k = await crypto.subtle.importKey('raw', b64uToBytes(row.x), { name: 'Ed25519' }, true, ['verify'])
          const raw = new Uint8Array(await crypto.subtle.exportKey('raw', k))
          t.rawPublicExportLengths[raw.length] = (t.rawPublicExportLengths[raw.length] ?? 0) + 1
        } catch (e) { t.errors['rawPublic:' + e.name] = (t.errors['rawPublic:' + e.name] ?? 0) + 1 }

        // 3. public key imported from SPKI, exported raw -> how many bytes?
        try {
          const pub = b64uToBytes(row.x)
          const spki = new Uint8Array(SPKI_PREFIX.length + pub.length)
          spki.set(SPKI_PREFIX, 0); spki.set(pub, SPKI_PREFIX.length)
          const k = await crypto.subtle.importKey('spki', spki, { name: 'Ed25519' }, true, ['verify'])
          const raw = new Uint8Array(await crypto.subtle.exportKey('raw', k))
          t.spkiToRawLengths[raw.length] = (t.spkiToRawLengths[raw.length] ?? 0) + 1
        } catch (e) { t.errors['spki:' + e.name] = (t.errors['spki:' + e.name] ?? 0) + 1 }
      }
      return t
    }
    return { zeroLeading: await run(zeroLeading), control: await run(control) }
  }, { zeroLeading, control })
  await browser.close()
}
console.log(JSON.stringify(out, null, 2))
server.close()
