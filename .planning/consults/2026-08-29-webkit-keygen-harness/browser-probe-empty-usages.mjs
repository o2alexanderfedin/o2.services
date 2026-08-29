// Reproduce WebKit bug 307095 EXACTLY as its reporter states it:
//   generateKey({name: 'X25519'|'Ed25519'}, true, [])  — empty usages.
// Per spec that must be SyntaxError every time. The report says OperationError
// appears "sometimes". If our defect is theirs, OperationError shows up here at
// the same ~0.8% (Ed25519) / ~0.4% (X25519) we measured on the normal path.
import { webkit } from 'playwright'
import http from 'node:http'

const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/html' })
  res.end('<!doctype html><meta charset="utf-8"><title>probe</title>')
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const { port } = server.address()

const browser = await webkit.launch()
const page = await browser.newPage()
await page.goto(`http://127.0.0.1:${port}/`)

const report = await page.evaluate(async () => {
  const out = {}
  for (const name of ['Ed25519', 'X25519']) {
    const tally = { resolved: 0 }
    for (let i = 0; i < 20000; i++) {
      try {
        await crypto.subtle.generateKey({ name }, true, [])
        tally.resolved += 1
      } catch (e) {
        tally[e.name] = (tally[e.name] ?? 0) + 1
      }
    }
    out[name] = tally
  }
  return out
})

console.log(JSON.stringify(report, null, 2))
await browser.close()
server.close()
