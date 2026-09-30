import fs from 'node:fs'
let hostCalls = 0n
const env = { env: { h: (c) => { hostCalls += c } } }
const res = {}
for (const m of ['base','bb','bbcall','instr','host']) {
  const bytes = fs.readFileSync(`k_${m}.wasm`)
  const t0 = performance.now()
  const { instance } = await WebAssembly.instantiate(bytes, env)
  const tInst = performance.now() - t0
  const e = instance.exports
  const N = m === 'host' ? 20_000_000 : 200_000_000
  const F = m === 'host' ? 27 : 32
  e.loop(1000); e.fib(20)
  const best = (f) => { let b = Infinity, out; for (let r = 0; r < 5; r++) { const s = performance.now(); out = f(); b = Math.min(b, performance.now() - s) } return [b, out] }
  const [tl, ol] = best(() => e.loop(N))
  const [tf, of] = best(() => e.fib(F))
  res[m] = { loopNsPerIter: (tl * 1e6 / N).toFixed(3), fibMs: tf.toFixed(1), fibN: F, outs: [ol, of], instMs: tInst.toFixed(2) }
}
console.table(res)
