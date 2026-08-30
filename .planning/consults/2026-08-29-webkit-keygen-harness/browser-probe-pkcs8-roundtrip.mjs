/*
 * importPkcs8 checks `privateKey->size() != 32` on the DER bytes, then runs the value through
 * mpiData() and hands the result to create(), which requires exactly 32 again. A seed whose
 * first byte is 0x00 passes the first check and fails the second.
 *
 * Ed25519 PKCS#8 v1 is a fixed 16-byte prefix, then the 32-byte seed.
 * Round-trips a private key through export/import too, which is how a real application
 * persists a key.
 */
import { webkit, chromium, firefox } from 'playwright'
import http from 'node:http'
import { ed25519 } from '@noble/curves/ed25519.js'

const b64u = (b) => Buffer.from(b).toString('base64url')

const zeroSeed = [], control = []
for (let i = 0; (zeroSeed.length < 20 || control.length < 20) && i < 60000; i++) {
  const seed = ed25519.utils.randomSecretKey()
  const row = { d: b64u(seed), x: b64u(ed25519.getPublicKey(seed)) }
  if (seed[0] === 0 && zeroSeed.length < 20) zeroSeed.push(row)
  else if (seed[0] !== 0 && control.length < 20) control.push(row)
}
console.error(`zero-leading seeds: ${zeroSeed.length}, controls: ${control.length}`)

const server = http.createServer((_q, res) => {
  res.writeHead(200, { 'content-type': 'text/html' })
  res.end('<!doctype html><meta charset="utf-8"><title>probe</title>')
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const { port } = server.address()

const out = {}
for (const [name, launcher] of Object.entries({ webkit, chromium, firefox })) {
  const browser = await launcher.launch()
  const page = await browser.newPage()
  await page.goto(`http://127.0.0.1:${port}/`)
  out[name] = await page.evaluate(async ({ zeroSeed, control }) => {
    const bytes = (s) => Uint8Array.from(atob(s.replace(/-/g,'+').replace(/_/g,'/')), c => c.charCodeAt(0))
    const PKCS8_PREFIX = new Uint8Array([0x30,0x2e,0x02,0x01,0x00,0x30,0x05,0x06,0x03,0x2b,0x65,0x70,0x04,0x22,0x04,0x20])

    const run = async (rows) => {
      const t = { n: 0, pkcs8Import: {}, jwkImportThenExportPkcs8: {}, roundTrip: {} }
      for (const row of rows) {
        t.n += 1
        const seed = bytes(row.d)

        // 1. import the key as PKCS#8, the way a stored key comes back
        try {
          const p8 = new Uint8Array(PKCS8_PREFIX.length + 32)
          p8.set(PKCS8_PREFIX, 0); p8.set(seed, PKCS8_PREFIX.length)
          await crypto.subtle.importKey('pkcs8', p8, { name: 'Ed25519' }, true, ['sign'])
          t.pkcs8Import.ok = (t.pkcs8Import.ok ?? 0) + 1
        } catch (e) { t.pkcs8Import[e.name] = (t.pkcs8Import[e.name] ?? 0) + 1 }

        // 2. import as JWK (which works), then EXPORT to pkcs8 and re-import — the full
        //    persistence round trip an application actually performs
        try {
          const k = await crypto.subtle.importKey('jwk',
            { kty:'OKP', crv:'Ed25519', d: row.d, x: row.x }, { name:'Ed25519' }, true, ['sign'])
          t.jwkImportThenExportPkcs8.imported = (t.jwkImportThenExportPkcs8.imported ?? 0) + 1
          const p8 = await crypto.subtle.exportKey('pkcs8', k)
          t.jwkImportThenExportPkcs8.exported = (t.jwkImportThenExportPkcs8.exported ?? 0) + 1
          await crypto.subtle.importKey('pkcs8', p8, { name:'Ed25519' }, true, ['sign'])
          t.roundTrip.ok = (t.roundTrip.ok ?? 0) + 1
        } catch (e) { t.roundTrip[e.name] = (t.roundTrip[e.name] ?? 0) + 1 }
      }
      return t
    }
    return { zeroSeed: await run(zeroSeed), control: await run(control) }
  }, { zeroSeed, control })
  await browser.close()
}
console.log(JSON.stringify(out, null, 2))
server.close()
