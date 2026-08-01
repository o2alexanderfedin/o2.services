import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { compileKernel } from '../scripts/compile-kernel.mjs'
import { PRIMES_WASM_BASE64 } from './primes-bytes.ts'
import { primesKernelBytes } from './primes.ts'

/**
 * The committed `primes.wasm` is checked against the source it claims to come from.
 *
 * `primes.wasm` is a binary in version control. Nothing about looking at it tells a
 * reader whether it is the compilation of the `.wat` beside it or of something else
 * entirely — and "something else entirely" is precisely the interesting failure, since
 * the module is what every node in the fabric executes. So the claim gets checked:
 * recompile the `.wat` here, and require the bytes to match exactly.
 *
 * This is `kernel-build.node.test.ts`'s argument applied to the second kernel, and the
 * two share `compileKernel` rather than each naming a feature set. A byte-identity test
 * that compiled by its own route would prove something about two configurations and
 * nothing about the committed binary.
 *
 * Node-only, and named so. Reading two files from disk is what a browser cannot do,
 * and the `.node.test.ts` suffix is the vitest project gate that keeps this file out of
 * the browser run. The *bytes* themselves stay portable: `primes-bytes.ts` carries them
 * as base64, which is what the rest of the suite imports.
 */

const wat = readFileSync(new URL('./primes.wat', import.meta.url), 'utf8')
const committed = new Uint8Array(readFileSync(new URL('./primes.wasm', import.meta.url)))

describe('the committed primes.wasm is the compilation of primes.wat', () => {
  it('recompiles to byte-identical output', async () => {
    const rebuilt = await compileKernel(wat)
    expect(rebuilt.length).toBe(committed.length)
    // Compared as arrays so a mismatch reports the offending index rather than just
    // "not equal" — for a 1 KiB binary that is the difference between a lead and a shrug.
    expect([...rebuilt]).toEqual([...committed])
  })

  it('keeps the base64 mirror in step with the binary', () => {
    // If the two ever diverged, a browser would run one module and Node another, and
    // every redundant execution across the two would be reported as node disagreement
    // rather than as the build defect it is.
    expect([...primesKernelBytes]).toEqual([...committed])
    expect(PRIMES_WASM_BASE64).not.toContain('\n')
  })
})

describe('the source of truth is genuinely tracked', () => {
  it('carries a .wat that declares the four-function ABI and nothing more', () => {
    // A trivial guard against the test passing because both files are empty, or because
    // the `.wat` was replaced by a stub while the binary stayed behind.
    for (const name of ['input_len', 'input_read', 'output_write', 'partition']) {
      expect(wat).toContain(`(import "o2" "${name}"`)
    }
    // The import list *is* the sandbox, so its length is the claim. A fifth import
    // would be a fifth thing the guest can reach, and it must not arrive unnoticed.
    expect(wat.match(/\(import /g) ?? []).toHaveLength(4)
    expect(wat).toContain('(memory (export "memory") 4 4)')
  })

  it('contains no float instruction anywhere in the guest', () => {
    /*
     * The determinism argument in this repository is that a module with no floats
     * cannot reach the WASM specification's float nondeterminism — NaN bit patterns,
     * NaN sign, relaxed SIMD — and that V8 offers no runtime control over any of them.
     * That argument is worth exactly as much as the premise, so the premise is checked
     * rather than asserted in a comment.
     *
     * Read off the *text*, which is where a float would be introduced by a human. The
     * byte-identity block above is what ties this text to the committed binary, so the
     * two together cover the artifact.
     *
     * `f32`/`f64` catch every float instruction and every float type in WAT, because
     * both are spelled with that prefix. The pattern deliberately does not anchor on
     * `(`, so `local.get`-style operands and type annotations are covered too.
     */
    const source = wat.replace(/;;[^\n]*/g, '')
    expect(source.match(/\bf(?:32|64)\b/g) ?? []).toEqual([])
  })
})
