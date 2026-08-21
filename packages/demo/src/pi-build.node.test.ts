import { readFileSync } from 'node:fs'
import { ed25519 } from '@noble/curves/ed25519.js'
import { MemoryBlockstore, SignedNameResolver, toHex } from '@o2/core'
import { describe, expect, it } from 'vitest'
import { compileKernel } from '../scripts/compile-kernel.mjs'
import { KERNEL_DELEGATION, KERNEL_TRUST_ANCHOR, PI_NAME, PI_RECORD } from './kernel-record.ts'
import { PI_WASM_BASE64 } from './pi-bytes.ts'
import { PI_SCALE, piKernelBytes } from './pi.ts'

/**
 * The committed `pi.wasm` is checked against the source it claims to come from.
 *
 * `pi.wasm` is a binary in version control. Nothing about looking at it tells a reader
 * whether it is the compilation of the `.wat` beside it or of something else entirely —
 * and "something else entirely" is precisely the interesting failure, since the module
 * is what every node in the fabric executes. So the claim gets checked: recompile the
 * `.wat` here, and require the bytes to match exactly.
 *
 * This is `kernel-build.node.test.ts`'s argument applied to the third kernel, and all
 * three share `compileKernel` rather than each naming a feature set. A byte-identity
 * test that compiled by its own route would prove something about two configurations
 * and nothing about the committed binary.
 *
 * Node-only, and named so. Reading two files from disk is what a browser cannot do, and
 * the `.node.test.ts` suffix is the vitest project gate that keeps this file out of the
 * browser run. The *bytes* themselves stay portable: `pi-bytes.ts` carries them as
 * base64, which is what the rest of the suite imports.
 */

const wat = readFileSync(new URL('./pi.wat', import.meta.url), 'utf8')
const committed = new Uint8Array(readFileSync(new URL('./pi.wasm', import.meta.url)))

describe('the committed pi.wasm is the compilation of pi.wat', () => {
  it('recompiles to byte-identical output', async () => {
    const rebuilt = await compileKernel(wat)
    expect(rebuilt.length).toBe(committed.length)
    // Compared as arrays so a mismatch reports the offending index rather than just
    // "not equal" — for a sub-kilobyte binary that is the difference between a lead
    // and a shrug.
    expect([...rebuilt]).toEqual([...committed])
  })

  it('keeps the base64 mirror in step with the binary', () => {
    // If the two ever diverged, a browser would run one module and Node another, and
    // every redundant execution across the two would be reported as node disagreement
    // rather than as the build defect it is.
    expect([...piKernelBytes]).toEqual([...committed])
    expect(PI_WASM_BASE64).not.toContain('\n')
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
  })

  it('pins its memory so growth cannot fail differently on one host than another', () => {
    // `initial === maximum` is the determinism requirement, not the specific number.
    // This kernel needs one page where the prime sieve needs four, so the figure is
    // read off the source rather than copied from the sibling test.
    const memory = /\(memory \(export "memory"\) (\d+) (\d+)\)/.exec(wat)
    expect(memory).not.toBeNull()
    expect(memory?.[1]).toBe(memory?.[2])
  })

  it('sums at the scale the host divides by', () => {
    /*
     * The one constant that lives on both sides of the wire, and the failure it guards
     * is silent in the worst way: a guest scaling by 10^18 against a host dividing by
     * 10^15 returns an estimate a thousand times too large, which no shard-level check
     * would see because every shard would agree with every other shard.
     *
     * Read out of the guest source rather than imported, because importing would make
     * this a comparison of the constant with itself.
     */
    const scale = /\(global \$SCALE i64 \(i64\.const (\d+)\)\)/.exec(wat)
    expect(scale).not.toBeNull()
    expect(Number(scale?.[1])).toBe(PI_SCALE)
  })

  it('contains no float instruction anywhere in the guest', () => {
    /*
     * The determinism argument in this repository is that a module with no floats
     * cannot reach the WASM specification's float nondeterminism — NaN bit patterns,
     * NaN sign, relaxed SIMD — and that V8 offers no runtime control over any of them.
     * That argument is worth exactly as much as the premise, so the premise is checked
     * rather than asserted in a comment.
     *
     * It matters more here than in either sibling kernel. This workload estimates a
     * real number, which is the one job description that invites a float, and the whole
     * design — a fixed-point integer scale, an integer division per term — exists to
     * avoid one. A float arriving here would look like a simplification.
     *
     * Read off the *text*, which is where a float would be introduced by a human. The
     * byte-identity block above is what ties this text to the committed binary, so the
     * two together cover the artifact.
     */
    const source = wat.replace(/;;[^\n]*/g, '')
    expect(source.match(/\bf(?:32|64)\b/g) ?? []).toEqual([])
  })
})

/**
 * `PI_RECORD` is checked rather than trusted — added 2026-08-08 with the record itself.
 *
 * The record is a **generated literal**. Nothing about reading `kernel-record.ts` says the CID in
 * it is the CID of the `pi.wasm` committed beside it, and a record naming the wrong bytes is not a
 * broken build — it is a module the fabric will refuse at dispatch, far from here, with an error
 * about provenance rather than about a stale literal. `kernel-build.node.test.ts` has made exactly
 * this check for the colouring record since Phase 14; the pi record shipped without it for the
 * length of one commit.
 *
 * The fourth case is the one with no counterpart there, and it is the reason this file changed at
 * all: **both records must carry the same anchor.** `bin/agent.ts` and `bin/seed.ts` default to a
 * single `KERNEL_TRUST_ANCHOR`, so a pi record signed by a second key would be refused by every
 * stock node — a failure that would appear only when somebody ran the pi workload on a default
 * agent, which is the worst possible place to discover it.
 */
describe('the pi record names the committed bytes, under the one anchor', () => {
  it('maps PI_NAME to the CID of the committed pi.wasm', async () => {
    const cid = await new MemoryBlockstore().put(piKernelBytes)
    expect(PI_RECORD.cid.toString()).toBe(cid.toString())
    expect(PI_RECORD.name).toBe(PI_NAME)
  })

  it('verifies against the committed trust anchor', () => {
    expect(new SignedNameResolver([KERNEL_TRUST_ANCHOR]).accept(PI_RECORD, Date.now()).ok).toBe(true)
  })

  it('is refused by a resolver pinned to any other key', () => {
    // The negative control, as `kernel-build.node.test.ts` carries: without it the acceptance
    // above would pass against a resolver that accepted anything handed to it.
    const impostor = toHex(ed25519.getPublicKey(new Uint8Array(32).fill(9)))
    expect(new SignedNameResolver([impostor]).accept(PI_RECORD, Date.now()).ok).toBe(false)
  })

  it('shares its anchor with the colouring record, which is what makes one --trust-anchor enough', () => {
    // Task #4 half 2: the shared thing is now the DELEGATION, not the signer-as-anchor. One
    // `--trust-anchor` is still enough for all three, and for a slightly stronger reason than
    // before — they chain to one root through one delegation, so a second signing key could be
    // introduced without re-pinning anything, and these records would still be the only ones
    // that verify.
    expect(PI_RECORD.delegation).toEqual(KERNEL_DELEGATION)
    expect(PI_RECORD.signer).toBe(KERNEL_DELEGATION.delegate)
    expect(KERNEL_DELEGATION.root).toBe(KERNEL_TRUST_ANCHOR)
  })
})
