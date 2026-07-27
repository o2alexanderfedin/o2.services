/**
 * Compile every `src/fixtures/*.wat` to a committed `.wasm`, and mirror all of them
 * into `src/fixtures/wasi-fixture-bytes.ts`.
 *
 * Two artifacts from one source, for two consumers — the same split
 * `packages/demo/scripts/build-kernel.mjs` makes:
 *
 *   <name>.wasm             the real binary, committed next to the source it came
 *                           from and checked byte-for-byte by
 *                           `wasi-fixtures.node.test.ts`
 *   wasi-fixture-bytes.ts   the same bytes as base64, because the portable test
 *                           suite also runs in a browser, where there is no
 *                           filesystem to read a `.wasm` from
 *
 * Both come from here so they cannot drift apart, and the build test asserts all
 * three agree. A committed binary that nothing checks is an unverifiable claim about
 * the source sitting next to it.
 *
 * Build-time only.
 *
 *   npm run build:fixtures --workspace @o2/aot
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { compileWat, FIXTURES } from './compile-wasi-fixture.mjs'

const DIR = fileURLToPath(new URL('../src/fixtures/', import.meta.url))

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

/** `wasi-echo` → `WASI_ECHO_BASE64`. */
function constantName(fixture) {
  return `${fixture.replace(/-/g, '_').toUpperCase()}_BASE64`
}

const sections = []
for (const fixture of FIXTURES) {
  const wat = readFileSync(`${DIR}${fixture}.wat`, 'utf8')
  const wasm = await compileWat(fixture, wat)
  writeFileSync(`${DIR}${fixture}.wasm`, wasm)

  const base64 = toBase64(wasm)
  const body = wrap(base64, 96)
    .map((line) => `  '${line}' +`)
    .join('\n')
    .replace(/ \+$/, '')
  sections.push(`export const ${constantName(fixture)}: string =\n${body}\n`)

  console.log(`src/fixtures/${fixture}.wasm`.padEnd(38), `${wasm.length} bytes`)
}

writeFileSync(
  `${DIR}wasi-fixture-bytes.ts`,
  `/**
 * GENERATED — do not edit. Run \`npm run build:fixtures --workspace @o2/aot\` to
 * regenerate.
 *
 * The bytes of every committed WASI fixture, base64-encoded, because the portable
 * test suite runs in a browser too and a browser has no filesystem.
 * \`wasi-fixtures.node.test.ts\` asserts these bytes equal both the committed
 * \`.wasm\` files and a fresh recompilation of the \`.wat\` sources.
 */

${sections.join('\n')}`,
)

console.log('src/fixtures/wasi-fixture-bytes.ts'.padEnd(38), `${FIXTURES.length} fixtures`)
