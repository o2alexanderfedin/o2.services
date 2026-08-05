/**
 * Compile `src/primes.wat` to `src/primes.wasm`, and mirror the bytes into
 * `src/primes-bytes.ts`.
 *
 * The prime-counting kernel's half of what `build-kernel.mjs` does for the colouring
 * kernel, and it deliberately shares `compile-kernel.mjs` rather than re-declaring a
 * feature set. Two kernels compiled through two configurations would be two artifacts
 * whose determinism arguments are not the same argument, and the difference would be
 * invisible in both files.
 *
 * Two artifacts from one source, for two consumers:
 *
 *   primes.wasm       the real binary, committed next to the source it came from and
 *                     checked byte-for-byte by `primes-build.node.test.ts`
 *   primes-bytes.ts   the same bytes as base64, because the portable test suite and
 *                     the browser run where there is no filesystem to read from
 *
 * Build-time only.
 *
 *   npm run build:primes --workspace @o2/demo
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

const watSource = readFileSync(`${SRC}primes.wat`, 'utf8')
const wasm = await compileKernel(watSource)

writeFileSync(`${SRC}primes.wasm`, wasm)

const base64 = toBase64(wasm)
const body = wrap(base64, 96)
  .map((line) => `  '${line}' +`)
  .join('\n')
  .replace(/ \+$/, '')

writeFileSync(
  `${SRC}primes-bytes.ts`,
  `/**
 * GENERATED — do not edit. Run \`npm run build:primes --workspace @o2/demo\` to regenerate.
 *
 * The bytes of \`primes.wasm\`, base64-encoded, because the portable test suite and the
 * browser both run where there is no filesystem. \`primes-build.node.test.ts\` asserts
 * these bytes equal both the committed \`primes.wasm\` and a fresh recompilation of
 * \`primes.wat\`.
 */

export const PRIMES_WASM_BASE64: string =
${body}
`,
)

console.log(`src/primes.wasm       ${wasm.length} bytes`)
console.log(`src/primes-bytes.ts   ${base64.length} base64 chars`)
