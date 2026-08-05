/**
 * Compile `src/pi.wat` to `src/pi.wasm`, and mirror the bytes into `src/pi-bytes.ts`.
 *
 * The third kernel's half of what `build-kernel.mjs` and `build-primes.mjs` do for the
 * first two, and it shares `compile-kernel.mjs` for their stated reason: kernels
 * compiled through separate configurations would be artifacts whose determinism
 * arguments are not the same argument, and the difference would be invisible in every
 * file involved.
 *
 * Two artifacts from one source, for two consumers:
 *
 *   pi.wasm       the real binary, committed next to the source it came from and
 *                 checked byte-for-byte by `pi-build.node.test.ts`
 *   pi-bytes.ts   the same bytes as base64, because the portable test suite and the
 *                 browser run where there is no filesystem to read from
 *
 * Build-time only.
 *
 *   npm run build:pi --workspace @o2/demo
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { compileKernel } from './compile-kernel.mjs'

const SRC = fileURLToPath(new URL('../src/', import.meta.url))

/** Base64 without a Buffer dependency, so the emitted module stays portable. */
function toBase64(bytes) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function wrap(text, width) {
  const lines = []
  for (let i = 0; i < text.length; i += width) lines.push(text.slice(i, i + width))
  return lines
}

const watSource = readFileSync(`${SRC}pi.wat`, 'utf8')
const wasm = await compileKernel(watSource)

writeFileSync(`${SRC}pi.wasm`, wasm)

const base64 = toBase64(wasm)
const body = wrap(base64, 96)
  .map((line) => `  '${line}' +`)
  .join('\n')
  .replace(/ \+$/, '')

writeFileSync(
  `${SRC}pi-bytes.ts`,
  `/**
 * GENERATED — do not edit. Run \`npm run build:pi --workspace @o2/demo\` to regenerate.
 *
 * The bytes of \`pi.wasm\`, base64-encoded, because the portable test suite and the
 * browser both run where there is no filesystem. \`pi-build.node.test.ts\` asserts these
 * bytes equal both the committed \`pi.wasm\` and a fresh recompilation of \`pi.wat\`.
 */

export const PI_WASM_BASE64: string =
${body}
`,
)

console.log(`src/pi.wasm       ${wasm.length} bytes`)
console.log(`src/pi-bytes.ts   ${base64.length} base64 chars`)
