// Task #24's deciding question, for Safari — as a 30-second manual check.
//
//   After you click through the certificate warning for https://HOST:A, does that
//   acceptance also cover wss://HOST:B — same certificate, different port?
//
// WHY THIS IS MANUAL. It was not a first choice. `safaridriver` can drive real Safari and
// reaches the warning page fine, but **Safari's automation mode refuses the bypass**:
// `warningPageCommand.postMessage('visitInsecureWebsite')` returns without throwing and
// nothing happens — measured across ten attempts, 20 s of polling and a full re-navigation,
// still on the warning page every time. A WebDriver click on the link does nothing either,
// because synthesised clicks do not run inline `onclick`. That looks like a deliberate
// safety property: a script-driven browser is not allowed to click through a certificate
// warning. So the click has to be a person's.
//
// HOW TO RUN IT
//
//   node .planning/consults/2026-08-21-safari-cert-manual-check.mjs
//
// It prints one URL. Open it in Safari, click through the warning once ("Show Details" →
// "visit this website"), and the page tests both sockets itself and shows the verdict in
// large type. The answer also comes back to this terminal, so you do not have to relay it.
// Ctrl-C when done. Nothing is installed and no certificate is added to any trust store.
//
// WHAT MAKES THE READING MEAN ANYTHING. Port C serves a DIFFERENT self-signed certificate
// and is expected to FAIL. Without that control, "the socket opened" is equally consistent
// with WebKit not checking certificates on WebSockets at all — so a run where BOTH succeed
// is a broken measurement, not a positive result, and the page says so rather than
// reporting a pass.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { createServer } from 'node:https'
import { hostname, tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { WebSocketServer } = require('ws')

const HOST = hostname()
const DIR = mkdtempSync(join(tmpdir(), 'safari-manual-'))
const makeCert = (tag) => {
  const key = join(DIR, `key${tag}.pem`)
  const cert = join(DIR, `cert${tag}.pem`)
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', key, '-out', cert, '-days', '2', '-subj', `/CN=${HOST}`,
  ], { stdio: 'ignore' })
  return { key: readFileSync(key), cert: readFileSync(cert) }
}
const X = makeCert('X')
const Y = makeCert('Y')
const listen = (s) => new Promise((r) => s.listen(0, () => r(s.address().port)))

const wssSame = createServer(X, (_q, s) => { s.writeHead(404); s.end() })
new WebSocketServer({ server: wssSame }).on('connection', (s) => s.send('same'))
const wssDiff = createServer(Y, (_q, s) => { s.writeHead(404); s.end() })
new WebSocketServer({ server: wssDiff }).on('connection', (s) => s.send('diff'))
const [pB, pC] = await Promise.all([listen(wssSame), listen(wssDiff)])

const html = (pageHost, a, b, c) => `<!doctype html>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Certificate exception check</title>
<style>
 body{font:16px/1.5 -apple-system,system-ui,sans-serif;margin:0;padding:2rem;background:#f5f5f7;color:#1d1d1f}
 .card{max-width:40rem;margin:0 auto;background:#fff;border-radius:12px;padding:2rem;box-shadow:0 2px 12px rgba(0,0,0,.08)}
 h1{font-size:1.3rem;margin:0 0 1.5rem}
 .verdict{font-size:1.5rem;font-weight:600;padding:1.25rem;border-radius:8px;margin:1.5rem 0;text-align:center}
 .yes{background:#e3f5e9;color:#0a6b32}.no{background:#fdecea;color:#8c1d13}.wait{background:#eef1f5;color:#444}
 .broken{background:#fff4e5;color:#8a5300}
 table{border-collapse:collapse;width:100%;margin-top:1rem}
 td,th{text-align:left;padding:.55rem .5rem;border-bottom:1px solid #e5e5e7;font-size:.95rem}
 code{background:#f0f0f2;padding:.1rem .35rem;border-radius:4px;font-size:.85em}
 .n{color:#6e6e73;font-size:.9rem;margin-top:1.5rem}
</style>
<div class="card">
<h1>Does one accepted certificate cover another port?</h1>
<div id="v" class="verdict wait">Testing…</div>
<table>
 <tr><th>Connection</th><th>Certificate</th><th>Result</th></tr>
 <tr><td>This page</td><td>X</td><td>accepted (you clicked through)</td></tr>
 <tr><td><code>wss://…:${a}</code></td><td>X — <strong>same port as this page</strong></td><td id="ra">…</td></tr>
 <tr><td><code>wss://…:${b}</code></td><td>X — same cert, other port</td><td id="rb">…</td></tr>
 <tr><td><code>wss://…:${c}</code></td><td>Y — different <em>(control)</em></td><td id="rc">…</td></tr>
</table>
<p class="n">The control must fail. If both succeed, the browser is not checking certificates
on WebSockets and the test tells us nothing.</p>
</div>
<script>
const host=${JSON.stringify(pageHost)};
const test=(p)=>new Promise(res=>{
  let done=false; const fin=v=>{if(!done){done=true;res(v)}};
  try{const ws=new WebSocket('wss://'+host+':'+p+'/');
    ws.onopen=()=>{try{ws.close()}catch(e){};fin('open')};
    ws.onerror=()=>fin('error');
  }catch(e){fin('error')}
  setTimeout(()=>fin('timeout'),10000);
});
(async()=>{
  const a=await test(${a}), b=await test(${b}), c=await test(${c});
  document.getElementById('ra').textContent=a;
  document.getElementById('rb').textContent=b;
  document.getElementById('rc').textContent=c;
  const v=document.getElementById('v');
  if(c==='open'){v.className='verdict broken';v.textContent='INVALID — the control also succeeded';}
  else if(b==='open'){v.className='verdict yes';v.textContent='YES — one click covered a DIFFERENT port';}
  else if(a==='open'){v.className='verdict yes';v.textContent='SAME PORT works — a different port does not';}
  else {v.className='verdict no';v.textContent='NO — even the page\u2019s own port was refused';}
  try{await fetch('/result?a='+a+'&b='+b+'&c='+c)}catch(e){}
})();
</script>`

const page = createServer(X, (req, res) => {
  if (req.url.startsWith('/result')) {
    const q = new URL(req.url, 'https://x').searchParams
    const a = q.get('a'); const b = q.get('b'); const c = q.get('c')
    // Record WHICH browser reported. The first version of this harness did not, and a
    // reading came back that contradicted Chrome — a real and decisive result, but one
    // that could not be attributed to an engine from the log alone, so it had to be taken
    // again. An unattributed reading from a manual check is barely a reading.
    const ua = req.headers['user-agent'] ?? '(no user-agent)'
    // Order matters and is the whole content of this line. Edge's user-agent contains
    // BOTH `Edg/` and `Chrome/`, and Chrome's contains `Safari/` — so a check written in
    // the obvious order labels Edge as Chrome and would have labelled Chrome as Safari.
    // The first version of this did exactly that: a genuine Edge reading was filed as
    // Chrome, and only the raw string underneath showed it. Test most specific first.
    const engine = /Edg\//.test(ua) ? 'Edge'
      : /Firefox\//.test(ua) ? 'Firefox'
        : /Chrome\//.test(ua) ? 'Chrome'
          : /Safari\//.test(ua) ? 'Safari' : 'unknown'
    const verdict = c === 'open'
      ? 'INVALID — the control also succeeded, so nothing was measured'
      : b === 'open'
        ? 'YES — one acceptance covered wss:// on a DIFFERENT port'
        : a === 'open'
          ? "SAME PORT works, a different port does not — the exception is keyed to host AND port"
          : "NO — even a socket on the page's own port was refused"
    console.log(`\n  RESULT from ${engine}`)
    console.log(`  user-agent: ${ua}`)
    console.log(`  same-PORT: ${a}   same-cert/other-port: ${b}   different-cert control: ${c}`)
    console.log(`  ${verdict}\n  Ctrl-C to stop.\n`)
    res.writeHead(204); res.end(); return
  }
  res.writeHead(200, { 'content-type': 'text/html' })
  res.end(html(HOST, pA, pB, pC))
})
// The SAME port as the page. Safari keys the exception to host AND port (measured
// 2026-08-21), so a socket sharing the page's port should be covered by the one click the
// visitor already made — which would remove the need for a second acceptance entirely.
new WebSocketServer({ server: page }).on('connection', (s) => s.send('samePort'))
const pA = await listen(page)

console.log(`
  Open this in Safari, then click through the warning once:

      https://${HOST}:${pA}/

  ("Show Details", then "visit this website".)
  The page tests both sockets and shows the answer; it also prints here.
  Ctrl-C when done.
`)
