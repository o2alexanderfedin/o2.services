function granularity() { // smallest nonzero step of performance.now()
  let min = Infinity, last = performance.now(), steps = 0; const end = last + 200
  while (steps < 2000) { const t = performance.now(); if (t > end) break; if (t !== last) { min = Math.min(min, t - last); last = t; steps++ } }
  return min
}
async function kernels() {
  const out = {}
  for (const m of ['base','bb','instr']) {
    const bytes = await (await fetch(`k_${m}.wasm`)).arrayBuffer()
    const { instance } = await WebAssembly.instantiate(bytes, { env: { h() {} } })
    const e = instance.exports; e.loop(1000); e.fib(20)
    e.gas.value = 9223372036854775807n; e.cnt.value = 0n
    const best = f => { let b = Infinity; for (let r = 0; r < 3; r++) { const s = performance.now(); f(); b = Math.min(b, performance.now() - s) } return b }
    const tl = best(() => e.loop(50_000_000)), tf = best(() => e.fib(30))
    out[m] = { loopMs: +tl.toFixed(1), fibMs: +tf.toFixed(1), gasUsed: String(9223372036854775807n - e.gas.value), cnt: String(e.cnt.value) }
  }
  return out
}
if (typeof document === 'undefined') {
  onmessage = async () => postMessage({ workerGranMs: granularity(), kernels: await kernels(), coi: self.crossOriginIsolated, hc: navigator.hardwareConcurrency, sab: typeof SharedArrayBuffer })
} else {
  window.run = () => new Promise(res => { const w = new Worker('probe.js'); w.onmessage = ev => res({ mainGranMs: granularity(), coi: crossOriginIsolated, ...ev.data, profilerInWin: typeof Profiler, pressure: typeof PressureObserver, devMem: navigator.deviceMemory, perfMemory: typeof performance.memory, muasm: typeof performance.measureUserAgentSpecificMemory }); w.postMessage(0) })
}
