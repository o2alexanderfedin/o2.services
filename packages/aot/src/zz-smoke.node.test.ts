import { encodeCanonical, MemoryBlockstore } from '@o2/core'
import type { CanonicalValue } from '@o2/core'
import { it } from 'vitest'
import { wasiEnv, wasiHostcall, wasiNoisy } from './fixtures/wasi-fixtures.ts'
import { WasiExecutor, describeWasiFailure } from './wasi-executor.ts'

async function run(mod: Uint8Array<ArrayBuffer>, input: CanonicalValue = {}) {
  const bs = new MemoryBlockstore()
  const moduleCid = await bs.put(mod)
  const enc = encodeCanonical(input)
  if (!enc.ok) throw new Error('enc')
  const inputCid = await bs.put(enc.bytes)
  return new WasiExecutor({ nodeId: 'n', blockstore: bs }).run({
    moduleCid, inputCid, partitionIndex: 0, partitionCount: 1,
  })
}

const u32 = (b: Uint8Array, at: number): number => new DataView(b.buffer, b.byteOffset).getUint32(at, true)
const u64 = (b: Uint8Array, at: number): bigint => new DataView(b.buffer, b.byteOffset).getBigUint64(at, true)

it('smoke', async () => {
  const env = await run(wasiEnv)
  console.log('ENV outcome', env.ok ? 'ok' : JSON.stringify(env.failure))
  if (env.ok && env.value instanceof Uint8Array) {
    const v = env.value
    console.log('  len', v.length, 'count', u32(v,0), 'size', u32(v,4),
      'offs', u32(v,8), u32(v,12), u32(v,16))
    console.log('  buf', JSON.stringify(new TextDecoder().decode(v.slice(20))))
    console.log('  raw', [...v].join(','))
  }

  const hc = await run(wasiHostcall)
  console.log('HOSTCALL outcome', hc.ok ? 'ok' : JSON.stringify(hc.failure))
  if (hc.ok && hc.value instanceof Uint8Array) {
    const v = hc.value
    console.log('  len', v.length)
    console.log('  poll errno', u32(v,0), 'nevents 0x'+u32(v,4).toString(16))
    console.log('  fd_read(3) errno', u32(v,8), 'nread 0x'+u32(v,12).toString(16))
    console.log('  fd_write(3) errno', u32(v,16), 'nwritten 0x'+u32(v,20).toString(16))
    console.log('  res realtime errno', u32(v,24), 'val', u64(v,28))
    console.log('  res monotonic errno', u32(v,36), 'val', u64(v,40))
    console.log('  res id99 errno', u32(v,48), 'val', u64(v,52))
    console.log('  sched_yield errno', u32(v,60))
    console.log('  raw', [...v].join(','))
  }

  for (const input of [0, 1]) {
    const n = await run(wasiNoisy, input)
    console.log('NOISY input', input, n.ok ? 'ok!?' : n.failure.kind)
    if (!n.ok) {
      const f = n.failure
      if (f.kind === 'nonzero-exit' || f.kind === 'trap') {
        console.log('  stderr len', f.stderr.length, 'dropped', f.stderrDropped)
        console.log('  head', JSON.stringify(f.stderr.slice(0, 60)))
        console.log('  tail', JSON.stringify(f.stderr.slice(-60)))
      }
      console.log('  desc(first 200)', describeWasiFailure(f).slice(0, 200))
      console.log('  desc(last 160)', describeWasiFailure(f).slice(-160))
    }
  }
})
