import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { compileKernel } from '../scripts/compile-kernel.mjs'
import { KERNEL_WASM_BASE64 } from './kernel-bytes.ts'
import { kernelBytes } from './kernel.ts'

/**
 * The committed binary is checked against the source it claims to come from.
 *
 * `kernel.wasm` is a binary in version control. Nothing about looking at it tells a
 * reader whether it is the compilation of the `.wat` beside it or of something else
 * entirely — and "something else entirely" is precisely the interesting failure, since
 * the module is what every node in the fabric executes. So the claim gets checked:
 * recompile the `.wat` here, and require the bytes to match exactly.
 *
 * Node-only, and named so. Reading two files from disk is what a browser cannot do,
 * and the `.node.test.ts` suffix is the vitest project gate that keeps this file out
 * of the browser run — the same convention `@o2/node`'s specs use. The *bytes*
 * themselves stay portable: `kernel-bytes.ts` carries them as base64, which is what
 * the rest of the suite and the browser demo import.
 */

const wat = readFileSync(new URL('./kernel.wat', import.meta.url), 'utf8')
const committed = new Uint8Array(readFileSync(new URL('./kernel.wasm', import.meta.url)))

describe('the committed kernel.wasm is the compilation of kernel.wat', () => {
  it('recompiles to byte-identical output', async () => {
    const rebuilt = await compileKernel(wat)
    expect(rebuilt.length).toBe(committed.length)
    // Compared as arrays so a mismatch reports the offending index rather than just
    // "not equal" — for a 1 KiB binary that is the difference between a lead and a
    // shrug.
    expect([...rebuilt]).toEqual([...committed])
  })

  it('keeps the base64 mirror in step with the binary', async () => {
    // `kernel-bytes.ts` is generated from `kernel.wasm` by the same script. If the two
    // ever diverged, the browser would run one module and Node another, and every
    // redundant execution across the two would be reported as node disagreement.
    expect([...kernelBytes]).toEqual([...committed])
    expect(KERNEL_WASM_BASE64).not.toContain('\n')
  })
})

describe('the source of truth is genuinely tracked', () => {
  it('carries a .wat that actually declares the four-function ABI', () => {
    // A trivial guard against the test passing because both files are empty, or
    // because the `.wat` was replaced by a stub while the binary stayed behind.
    for (const name of ['input_len', 'input_read', 'output_write', 'partition']) {
      expect(wat).toContain(`(import "o2" "${name}"`)
    }
    expect(wat).toContain('(memory (export "memory") 4 4)')
  })
})
