import { readFileSync } from 'node:fs'
import { ed25519 } from '@noble/curves/ed25519.js'
import { MemoryBlockstore, SignedNameResolver, toHex } from '@o2/core'
import { describe, expect, it } from 'vitest'
import { compileKernel } from '../scripts/compile-kernel.mjs'
import { KERNEL_DELEGATION, KERNEL_TRUST_ANCHOR, PRIMES_NAME, PRIMES_RECORD } from './kernel-record.ts'
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

/**
 * `PRIMES_RECORD` is checked rather than trusted — added 2026-08-17 with the record itself.
 *
 * The record is a **generated literal**. Nothing about reading `kernel-record.ts` says the CID in
 * it is the CID of the `primes.wasm` committed beside it, and a record naming the wrong bytes is
 * not a broken build — it is a module the fabric will refuse at dispatch, far from here, with an
 * error about provenance rather than about a stale literal. `kernel-build.node.test.ts` has made
 * this check for the colouring record since Phase 14 and `pi-build.node.test.ts` since Phase 27;
 * this is the third artifact getting the same treatment on the day it acquired a record.
 *
 * **The anchor case is the one that matters most here, and it is the one this workload could not
 * have before.** `bin/agent.ts` and `bin/seed.ts` default to a single `KERNEL_TRUST_ANCHOR`, so a
 * primes record signed by a second key would be refused by every stock node — a failure that
 * would appear only when somebody ran the prime-counting workload on a default agent, which is
 * the worst possible place to discover it. `sign-kernel.ts` checks all three signers against the
 * first before writing the file; this is that check made again from the committed artifact.
 */
describe('the primes record names the committed bytes, under the one anchor', () => {
  it('maps PRIMES_NAME to the CID of the committed primes.wasm', async () => {
    const cid = await new MemoryBlockstore().put(primesKernelBytes)
    expect(PRIMES_RECORD.cid.toString()).toBe(cid.toString())
    expect(PRIMES_RECORD.name).toBe(PRIMES_NAME)
  })

  it('verifies against the committed trust anchor', () => {
    expect(new SignedNameResolver([KERNEL_TRUST_ANCHOR]).accept(PRIMES_RECORD, Date.now()).ok).toBe(
      true,
    )
  })

  it('is refused by a resolver pinned to any other key', () => {
    // The negative control the two sibling files carry: without it the acceptance above would
    // pass against a resolver that accepted anything handed to it.
    const impostor = toHex(ed25519.getPublicKey(new Uint8Array(32).fill(9)))
    expect(new SignedNameResolver([impostor]).accept(PRIMES_RECORD, Date.now()).ok).toBe(false)
  })

  it('shares its anchor with the other two records, which is what makes one --trust-anchor enough', () => {
    // Task #4 half 2: the shared thing is now the DELEGATION, not the signer-as-anchor. One
    // `--trust-anchor` is still enough for all three, and for a slightly stronger reason than
    // before — they chain to one root through one delegation, so a second signing key could be
    // introduced without re-pinning anything, and these records would still be the only ones
    // that verify.
    expect(PRIMES_RECORD.delegation).toEqual(KERNEL_DELEGATION)
    expect(PRIMES_RECORD.signer).toBe(KERNEL_DELEGATION.delegate)
    expect(KERNEL_DELEGATION.root).toBe(KERNEL_TRUST_ANCHOR)
  })
})
