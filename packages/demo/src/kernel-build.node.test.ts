import { ed25519 } from '@noble/curves/ed25519.js'
import { MemoryBlockstore, SignedNameResolver, toHex } from '@o2/core'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { compileKernel } from '../scripts/compile-kernel.mjs'
import { KERNEL_WASM_BASE64 } from './kernel-bytes.ts'
import { KERNEL_DELEGATION, KERNEL_NAME, KERNEL_RECORD, KERNEL_TRUST_ANCHOR } from './kernel-record.ts'
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

/**
 * DET-03 / DATA-08 — the committed record is checked against the committed binary.
 *
 * The block above closes `.wat` → `.wasm` → `kernel-bytes.ts`. This one closes the
 * last link: `.wasm` → the signed record that vouches for it. With both, the chain
 * from source to signature is checked end to end and no link is taken on faith —
 * which is what makes this the drift detector for the whole phase. A record naming a
 * CID nobody recomputed is exactly as unverifiable as a binary nobody recompiled.
 */
describe('the committed record vouches for the committed kernel.wasm', () => {
  it('names the CID a blockstore computes for the binary on disk', async () => {
    // `MemoryBlockstore.put` rather than a hand-rolled sha256 + CID.create: that is
    // the code path `runColouring` obtains its module CID from (`store.put(kernelBytes)`
    // in `demo/main.ts`), and the record has to name what *that* produces. Computed
    // over `committed` — the bytes read off disk above — so the assertion is against
    // the artifact, not against another derived copy of it.
    const cid = await new MemoryBlockstore().put(committed)
    expect(KERNEL_RECORD.cid.toString()).toBe(cid.toString())
    expect(KERNEL_RECORD.name).toBe(KERNEL_NAME)
  })

  it('verifies against the committed trust anchor', () => {
    const resolver = new SignedNameResolver([KERNEL_TRUST_ANCHOR])
    expect(resolver.accept(KERNEL_RECORD, Date.now()).ok).toBe(true)
  })

  it('is refused by a resolver pinned to any other key', () => {
    // The negative control. Without it, the acceptance above would pass just as
    // happily against a resolver that accepted everything it was handed.
    const impostor = toHex(ed25519.getPublicKey(new Uint8Array(32).fill(9)))
    const result = new SignedNameResolver([impostor]).accept(KERNEL_RECORD, Date.now())
    expect(result.ok).toBe(false)
    if (result.ok) return
    // `untrusted-root`, not `untrusted-signer` — task #4 half 2. The record is signed by a
    // delegate rather than by the anchor, so the reason a foreign resolver refuses it is that
    // the ROOT it chains to is not pinned. Asserting the specific kind is what keeps this a
    // negative control: `ok === false` alone would pass just as happily if the delegation had
    // failed to decode, which is a different defect wearing the same answer.
    expect(result.failure.kind).toBe('untrusted-root')
  })

  it('was emitted with a chain that closes: anchor -> delegation -> the key that signed it', () => {
    // A build that wrote one key into the record and another into the anchor would ship a demo
    // that refuses its own kernel, everywhere, on first dispatch. That hazard did not go away
    // when the anchor stopped being the signer (task #4 half 2) — it gained two more links that
    // can disagree, so all three are checked rather than the one that used to be the whole chain.
    expect(KERNEL_DELEGATION.root).toBe(KERNEL_TRUST_ANCHOR)
    expect(KERNEL_RECORD.signer).toBe(KERNEL_DELEGATION.delegate)
    expect(KERNEL_RECORD.delegation).toEqual(KERNEL_DELEGATION)
    // And the anchor is NOT the signer, which is the property the delegation exists to buy.
    // Without this line the three above would all still hold if the change had silently
    // collapsed back to signing with the root.
    expect(KERNEL_TRUST_ANCHOR).not.toBe(KERNEL_RECORD.signer)
  })

  it('still has more than 60 days of life left', () => {
    // An expiry that lapses quietly takes the demo down with a refusal. Sixty days is
    // the margin in which this fails while there is still time to act — and the
    // message has to say what to do, because a test that starts failing in two
    // months' time is only useful if it names the command.
    const remainingDays = (KERNEL_RECORD.expiresAt - Date.now()) / (24 * 3600 * 1000)
    expect(
      remainingDays,
      `KERNEL_RECORD expires in ${remainingDays.toFixed(0)} days. Regenerate it with ` +
        '`npm run sign:kernel --workspace @o2/demo` and commit kernel-record.ts. ' +
        'Note that regenerating changes the anchor too — both node binaries default to it.',
    ).toBeGreaterThan(60)
  })
})
