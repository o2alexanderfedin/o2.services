/**
 * Compile `src/kernel.wat` to `src/kernel.wasm`, and mirror the bytes into
 * `src/kernel-bytes.ts`.
 *
 * Two artifacts from one source, for two consumers:
 *
 *   kernel.wasm       the real binary, committed next to the source it came from and
 *                     checked byte-for-byte by `kernel-build.node.test.ts`
 *   kernel-bytes.ts   the same bytes as base64, because the portable test suite and
 *                     the browser demo run where there is no filesystem to read from
 *
 * Both come from here so they cannot drift apart, and the build test asserts all three
 * agree. A committed binary that nothing checks is an unverifiable claim about the
 * source sitting next to it.
 *
 * Build-time only.
 *
 *   npm run build:kernel --workspace @o2/demo
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

const watSource = readFileSync(`${SRC}kernel.wat`, 'utf8')
const wasm = await compileKernel(watSource)

writeFileSync(`${SRC}kernel.wasm`, wasm)

const base64 = toBase64(wasm)
const body = wrap(base64, 96)
  .map((line) => `  '${line}' +`)
  .join('\n')
  .replace(/ \+$/, '')

writeFileSync(
  `${SRC}kernel-bytes.ts`,
  `/**
 * GENERATED — do not edit. Run \`npm run build:kernel --workspace @o2/demo\` to regenerate.
 *
 * The bytes of \`kernel.wasm\`, base64-encoded, because the portable test suite and the
 * browser demo both run where there is no filesystem. \`kernel-build.node.test.ts\`
 * asserts these bytes equal both the committed \`kernel.wasm\` and a fresh recompilation
 * of \`kernel.wat\`.
 */

export const KERNEL_WASM_BASE64: string =
${body}
`,
)

console.log(`src/kernel.wasm       ${wasm.length} bytes`)
console.log(`src/kernel-bytes.ts   ${base64.length} base64 chars`)
