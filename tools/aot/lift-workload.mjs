import { writeFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { loadavg } from 'node:os'
import { describeLiftFailure, liftElf } from './lift.ts'
const t0 = performance.now()
const out = await liftElf('tools/aot/fixtures/workload-linux')
const ms = performance.now() - t0
console.log(`lift ${(ms / 1000).toFixed(1)}s  ok=${out.ok}  load ${loadavg().map(n=>n.toFixed(1)).join(' ')}`)
// The describe helper, not the struct: same reason as `measure-wasi.ts`.
if (!out.ok) { console.log(describeLiftFailure(out.failure)); process.exit(1) }
writeFileSync('tools/aot/fixtures/workload-lifted.wasm', out.artifact.bytes)
console.log(`lifted ${(out.artifact.bytes.length/1024/1024).toFixed(2)} MiB  verdict ${out.verdict}`)
