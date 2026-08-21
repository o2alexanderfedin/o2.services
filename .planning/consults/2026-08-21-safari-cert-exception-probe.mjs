// Task #24's deciding question, asked of REAL Safari.
//
//   After the visitor clicks through the interstitial for https://HOST:A, does that
//   exception cover wss://HOST:B presenting the SAME cert on a DIFFERENT port?
//
// Chrome answered yes (see 2026-08-21-one-cert-exception-covers-another-port.md). This is
// the WebKit arm of the same experiment, and it exists because that consult's claim that
// "nothing available here can answer for iOS" conflated a limit of Playwright with a limit
// of the host. Playwright cannot drive real Safari; `safaridriver` can, it ships inside
// Safari, and it speaks W3C WebDriver over plain HTTP — so Node's fetch is the whole client
// and there is no new dependency.
//
// PREREQUISITE, and it is the only thing standing in the way:
//   Safari -> Settings -> Advanced -> "Show features for web developers"
//   Safari -> Develop  -> "Allow Remote Automation"
// Without it every session request returns "session not created". The setting cannot be
// written from a shell: ~/Library/Containers/com.apple.Safari is TCC-protected and
// `defaults write` gets "Operation not permitted".
//
//   node .planning/consults/2026-08-21-safari-cert-exception-probe.mjs
//
// acceptInsecureCerts is DELIBERATELY false. It is Safari's ignoreHTTPSErrors: setting it
// makes every arm succeed and measures nothing. Port C — a DIFFERENT self-signed cert — is
// the negative control, and without it "the socket opened" is equally consistent with
// WebKit not checking certificates on WebSockets at all.
import { execFileSync } from 'node:child_process'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { createServer } from 'node:https'
import { tmpdir } from 'node:os'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { WebSocketServer } = require('ws')

const HOST = hostname()
const DRIVER = '/System/Cryptexes/App/usr/bin/safaridriver'

/**
 * A free port, asked of the OS rather than hardcoded.
 *
 * The first version of this script pinned 4502 and died with "Address already in use" —
 * safaridriver reports that on stderr and then exits, so the only symptom upstream is
 * `TypeError: fetch failed` from the first WebDriver call, which names nothing useful.
 */
const freePort = async () => {
  const net = await import('node:net')
  return new Promise((resolve) => {
    const probe = net.createServer()
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address()
      probe.close(() => resolve(port))
    })
  })
}
const DRIVER_PORT = await freePort()

// Self-contained: generate both certificates rather than depend on a scratch directory that
// does not outlive the session that made it.
const DIR = mkdtempSync(join(tmpdir(), 'safari-cert-probe-'))
const makeCert = (tag) => {
  const key = join(DIR, `key${tag}.pem`)
  const cert = join(DIR, `cert${tag}.pem`)
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', key, '-out', cert, '-days', '2',
    '-subj', `/CN=${HOST}`,
  ], { stdio: 'ignore' })
  return { key: readFileSync(key), cert: readFileSync(cert) }
}
const X = makeCert('X')
const Y = makeCert('Y')

const listen = (s) => new Promise((r) => s.listen(0, () => r(s.address().port)))
const page = createServer(X, (_q, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<h1>ok</h1>') })
const wssSame = createServer(X, (_q, s) => { s.writeHead(404); s.end() })
new WebSocketServer({ server: wssSame }).on('connection', (s) => s.send('same'))
const wssDiff = createServer(Y, (_q, s) => { s.writeHead(404); s.end() })
new WebSocketServer({ server: wssDiff }).on('connection', (s) => s.send('diff'))
const [pA, pB, pC] = await Promise.all([listen(page), listen(wssSame), listen(wssDiff)])

if (!existsSync(DRIVER)) { console.log(JSON.stringify({ fatal: `no safaridriver at ${DRIVER}` })); process.exit(1) }
const driverLog = []
const driver = spawn(DRIVER, ['-p', String(DRIVER_PORT)], { stdio: ['ignore', 'pipe', 'pipe'] })
driver.stdout.on('data', (b) => driverLog.push(String(b)))
driver.stderr.on('data', (b) => driverLog.push(String(b)))
const base = `http://127.0.0.1:${DRIVER_PORT}`
const wd = async (method, path, body) => {
  const r = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return r.json().catch(() => ({}))
}

const out = { engine: 'safari (real, via safaridriver)', host: HOST, ports: { pageA: pA, wssSameCertB: pB, wssDiffCertC: pC } }
let sid = null
try {
  for (let i = 0; i < 40 && !out.driverReady; i++) {
    try { out.driverReady = Boolean((await wd('GET', '/status'))?.value?.ready) } catch {}
    if (!out.driverReady) await new Promise((r) => setTimeout(r, 250))
  }
  const s = await wd('POST', '/session', {
    capabilities: { alwaysMatch: { browserName: 'safari', acceptInsecureCerts: false } },
  })
  sid = s?.value?.sessionId ?? null
  if (!sid) {
    out.blocked = s?.value?.message ?? JSON.stringify(s).slice(0, 300)
    out.remedy = 'Safari -> Settings -> Advanced -> "Show features for web developers", then Develop -> "Allow Remote Automation"'
    throw new Error('no session')
  }

  await wd('POST', `/session/${sid}/timeouts`, { pageLoad: 20000, script: 20000, implicit: 2000 })
  await wd('POST', `/session/${sid}/url`, { url: `https://${HOST}:${pA}/` })
  await new Promise((r) => setTimeout(r, 1500))

  const sourceOf = async () => {
    const s = await wd('GET', `/session/${sid}/source`)
    return typeof s?.value === 'string' ? s.value : ''
  }
  let html = await sourceOf()
  if (html.includes('<h1>ok</h1>')) {
    out.interstitial = 'none-shown'
  } else {
    // Safari's warning page: "Show Details" reveals a "visit this website" link. Both are
    // page content, so WebDriver can reach them; a native confirmation sheet, if one
    // appears, is NOT page content and will show up here as 'click-failed'.
    const click = async (selector) => {
      const f = await wd('POST', `/session/${sid}/element`, { using: 'css selector', value: selector })
      const id = f?.value ? Object.values(f.value)[0] : null
      if (!id) return false
      await wd('POST', `/session/${sid}/element/${id}/click`, {})
      return true
    }
    out.showDetails = await click('button')
    await new Promise((r) => setTimeout(r, 800))
    out.visitLink = await click('a')
    await new Promise((r) => setTimeout(r, 1500))
    html = await sourceOf()
    out.interstitial = html.includes('<h1>ok</h1>') ? 'clicked-through' : 'click-failed'
    if (out.interstitial === 'click-failed') out.sourceHead = html.replace(/\s+/g, ' ').slice(0, 500)
  }

  const tryWs = async (port) => {
    const r = await wd('POST', `/session/${sid}/execute/async`, {
      script: `const [h,p,done]=arguments;const ws=new WebSocket('wss://'+h+':'+p+'/');
               const fin=v=>{try{ws.close()}catch(e){};done(v)};
               ws.onopen=()=>fin('open');ws.onerror=()=>fin('error');
               setTimeout(()=>fin('timeout'),8000);`,
      args: [HOST, port],
    })
    return r?.value ?? `wd-error: ${JSON.stringify(r).slice(0, 120)}`
  }
  const reached = out.interstitial === 'clicked-through' || out.interstitial === 'none-shown'
  out.wssSameCertOtherPort = reached ? await tryWs(pB) : 'skipped'
  out.wssDifferentCert_control = reached ? await tryWs(pC) : 'skipped'
} catch (e) {
  out.fatal = String(e).slice(0, 200)
  // Without this the only symptom of a driver that never started is "fetch failed", which
  // names neither the port nor the reason.
  if (driverLog.length > 0) out.driverSaid = driverLog.join('').trim().slice(0, 300)
}

console.log(JSON.stringify(out, null, 2))
if (sid) await wd('DELETE', `/session/${sid}`).catch(() => {})
driver.kill()
process.exit(0)
