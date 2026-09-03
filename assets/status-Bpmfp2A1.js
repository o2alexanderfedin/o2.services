import{c as e,l as t}from"./src-BTE1dbav.js";var n=29880,r=3e4,i=`2026-09-02, from three runs of kill-switch-propagation.e2e.test.ts — six browser tabs and one local workerd on one machine, each tab recording in its own page the moment it first saw the halt. Windows at the 30 000 ms poll: 29869, 29884 and 29891 ms; at a 2 000 ms poll for comparison: 1874, 1859 and 1874 ms.`,a=`the time from an operator’s write returning to the LAST of six tabs noticing it, on one machine, with every tab polling a Durable Object every thirty seconds. It is a measurement of what a poll costs. It is NOT a measurement of Workers KV, whose roughly sixty-second global propagation is the mechanism the open question about this control is actually framed in terms of, and which this project has not measured. It carries no network term, because there is no network between these tabs and this object. And six tabs on one machine is not a cohort: what a control does at six is not what it does at three hundred, and nobody here has measured the second thing.`,o=`https://o2-bootstrap.af-4a0.workers.dev`;function s(e){let t=new URLSearchParams(e).getAll(`self`).flatMap(e=>e.split(`,`)).map(e=>e.trim()).filter(e=>e!==``);return t.length>0?t:[o]}async function c(e){try{let t=await fetch(`${e}/self`,{signal:AbortSignal.timeout(1e4)});if(!t.ok)return{kind:`unreachable`,origin:e,detail:`answered HTTP ${String(t.status)}`};let n=l(await t.json());return n===null?{kind:`unreachable`,origin:e,detail:`answered a body this page cannot read`}:{kind:`read`,origin:e,self:n}}catch(t){return{kind:`unreachable`,origin:e,detail:t instanceof Error?t.message:String(t)}}}function l(e){if(typeof e!=`object`||!e)return null;let t={...e},n=e=>typeof t[e]==`string`?t[e]:`not reported`,r=t.admission;return{peerId:n(`peerId`),nodeKey:n(`nodeKey`),instance:n(`instance`),version:n(`version`),traffic:t.traffic??null,relayService:t.relayService??null,admission:u(r)}}function u(t){if(typeof t!=`object`||!t)return e;let n={...t},r=n.versions;return{region:typeof n.region==`string`?n.region:null,halted:n.halted===!0,versions:r===`all`?`all`:Array.isArray(r)?r.filter(e=>typeof e==`string`):`all`,since:typeof n.since==`number`?n.since:null,note:typeof n.note==`string`?n.note:``}}function d(){let e=document.querySelector(`meta[name="o2-build"]`)?.getAttribute(`content`)??null;return{identity:e??`not stamped (a dev server serves this page untransformed)`,version:t(e)??`unreadable`}}var f=e=>e.replace(/[&<>"]/gu,e=>`&#${String(e.charCodeAt(0))};`);function p(e){if(e.kind===`unreachable`)return`
      <section class="card unreachable">
        <h2>${f(e.origin)}</h2>
        <p class="verdict">Could not be read — ${f(e.detail)}</p>
        <p class="sub">
          This says nothing about whether the fabric is running. It says this page could not
          reach this object.
        </p>
      </section>`;let{self:t}=e,n=t.admission,r=n.versions===`all`?`every client version`:n.versions.join(`, `),i=n.since===null?`never set`:new Date(n.since).toISOString();return`
    <section class="card ${n.halted?`halted`:`admitting`}">
      <h2>${f(e.origin)}</h2>
      <p class="verdict">${n.halted?`NOT ADMITTING NEW TASKS`:`Admitting new tasks`}</p>
      <dl>
        <dt>region</dt><dd>${f(n.region??`unlabelled`)}</dd>
        <dt>applies to</dt><dd>${f(r)}</dd>
        <dt>set at</dt><dd>${f(i)}</dd>
        <dt>operator's note</dt><dd>${f(n.note===``?`(none)`:n.note)}</dd>
        <dt>node build</dt><dd>${f(t.version)}</dd>
        <dt>peer id</dt><dd>${f(t.peerId)}</dd>
        <dt>node key</dt><dd>${f(t.nodeKey)}</dd>
        <dt>instance</dt><dd>${f(t.instance)}</dd>
        <dt>traffic split</dt><dd><code>${f(JSON.stringify(t.traffic))}</code></dd>
        <dt>relay service</dt><dd><code>${f(JSON.stringify(t.relayService))}</code></dd>
      </dl>
    </section>`}async function m(e,t){let o=s(t),l=await Promise.all(o.map(e=>c(e))),u=d();e.innerHTML=`
    ${l.map(p).join(``)}
    <section class="card">
      <h2>This page</h2>
      <dl>
        <dt>client build</dt><dd>${f(u.identity)}</dd>
        <dt>client version</dt><dd>${f(u.version)}</dd>
      </dl>
      <p class="sub">
        The build this <em>page</em> came from, which is a different thing from the node build
        above it. Reading one as the other has cost this project a false report already.
      </p>
    </section>
    <section class="card">
      <h2>How long a stop takes to arrive</h2>
      <dl>
        <dt>observed window</dt><dd>${String(n)} ms</dd>
        <dt>over</dt><dd>6 tabs</dd>
        <dt>at a poll interval of</dt><dd>${String(r)} ms</dd>
        <dt>measured</dt><dd>${f(i)}</dd>
      </dl>
      <p class="sub">${f(a)}</p>
    </section>`}if(typeof document<`u`){let e=document.getElementById(`objects`);e!==null&&m(e,location.search)}