import { chromium, firefox, webkit } from 'playwright'
for (const [name, bt] of [['chromium', chromium], ['firefox', firefox], ['webkit', webkit]]) {
  try {
    const b = await bt.launch(); const p = await b.newPage()
    await p.goto('http://127.0.0.1:8765/index.html')
    const r = await p.evaluate(() => window.run())
    const wapi = await p.evaluate(() => new Promise(res => { const w = new Worker('worker-api.js'); w.onmessage = e => res(e.data) }))
    console.log(name, b.version(), JSON.stringify({ ...r, workerApis: wapi }))
    await b.close()
  } catch (e) { console.log(name, 'ERR', e.message.split('\n')[0]) }
}
