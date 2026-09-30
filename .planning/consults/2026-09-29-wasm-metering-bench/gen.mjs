// Generate metering variants of two kernels as WAT.
// mode: base | bb (inline global deduct+check per basic block) | bbcall (local fn call per block, wasm-instrument style)
//       | instr (per-instruction counter, no check) | host (imported JS call per block)
import fs from 'node:fs'
const charge = (mode, cost) => {
  if (mode === 'bb') return `global.get $gas i64.const ${cost} i64.sub global.set $gas global.get $gas i64.const 0 i64.lt_s if unreachable end`
  if (mode === 'bbcall') return `i64.const ${cost} call $charge`
  if (mode === 'host') return `i64.const ${cost} call $hcharge`
  return ''
}
const ins = (mode, s) => mode === 'instr'
  ? s.trim().split(/\n/).map(l => l.trim()).filter(Boolean).map(l => `global.get $cnt i64.const 1 i64.add global.set $cnt ${l}`).join('\n')
  : s
function mod(mode) {
  // loop kernel: xorshift32 accumulate, n iterations. body ~ 16 instrs
  const loopBody = ins(mode, `
local.get $x
local.get $x
i32.const 13
i32.shl
i32.xor
local.set $x
local.get $x
local.get $x
i32.const 17
i32.shr_u
i32.xor
local.set $x
local.get $x
local.get $x
i32.const 5
i32.shl
i32.xor
local.set $x
local.get $acc
local.get $x
i32.add
local.set $acc
local.get $i
i32.const 1
i32.add
local.tee $i
local.get $n
i32.lt_u
br_if $L`)
  const fibBody = ins(mode, `
local.get $k
i32.const 2
i32.lt_u
if (result i32)
local.get $k
else
local.get $k
i32.const 1
i32.sub
call $fib
local.get $k
i32.const 2
i32.sub
call $fib
i32.add
end`)
  return `(module
  (import "env" "h" (func $hcharge (param i64)))
  (global $gas (export "gas") (mut i64) (i64.const 9223372036854775807))
  (global $cnt (export "cnt") (mut i64) (i64.const 0))
  (func $charge (param $c i64) global.get $gas local.get $c i64.sub global.set $gas global.get $gas i64.const 0 i64.lt_s if unreachable end)
  (func (export "loop") (param $n i32) (result i32) (local $i i32) (local $x i32) (local $acc i32)
    i32.const 2463534242 local.set $x
    (loop $L ${charge(mode, 28)}
${loopBody})
    local.get $acc)
  (func $fib (export "fib") (param $k i32) (result i32)
    ${charge(mode, 14)}
${fibBody}))`
}
for (const m of ['base','bb','bbcall','instr','host']) fs.writeFileSync(`k_${m}.wat`, mod(m))
