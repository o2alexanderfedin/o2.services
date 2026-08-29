// Zero lines of o2 code. A bare HTML page over http://127.0.0.1 (a secure context),
// then crypto.subtle.generateKey in a loop. Nothing is imported into the page.
import { webkit } from 'playwright'
import http from 'node:http'

const BARE_PAGE = '<!doctype html><meta charset="utf-8"><title>probe</title>'

const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html' })
  res.end(BARE_PAGE)
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const { port } = server.address()

const browser = await webkit.launch()
const page = await browser.newPage()
await page.goto(`http://127.0.0.1:${port}/`)

const report = await page.evaluate(async () => {
  const out = {
    scriptsOnPage: document.scripts.length,
    ok: 0,
    errs: {},
    trace: null,
  }
  for (let i = 0; i < 20000; i++) {
    try {
      const pair = await crypto.subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify'])
      if (out.trace === null) {
        out.trace = {
          typeofPublicKey: typeof pair.publicKey,
          constructorName: pair.publicKey.constructor.name,
          isUint8Array: pair.publicKey instanceof Uint8Array,
          isArrayBuffer: pair.publicKey instanceof ArrayBuffer,
          byteLength: pair.publicKey.byteLength ?? null,
        }
      }
      out.ok += 1
    } catch (e) {
      out.errs[e.name] = (out.errs[e.name] ?? 0) + 1
    }
  }
  return out
})

console.log(JSON.stringify(report, null, 2))
await browser.close()
server.close()
