import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { TURN_MINT_PURPOSE, encodeCanonical } from '@o2/core'
import { describe, expect, it } from 'vitest'
// Test-only relative import — the route `packages/net/src/distributed.test.ts` sanctions.
import { turnMintPayload } from '../../cloudflare/src/turn-credential.ts'

/**
 * NET-12 — the signer and the verifier build the same bytes, held by a test rather than a comment.
 *
 * ## Why this file exists
 *
 * A TURN mint request is signed by a **tab** (`@o2/browser`'s `browser-node.ts`, `turnMintBytes`)
 * and verified by the **hosted minter** (`@o2/cloudflare`'s `turnMintPayload`). Two packages, one
 * set of bytes. If they disagree by a single field, every mint request is refused as
 * `bad-signature` — a failure that looks like an attack and is a typo.
 *
 * The obvious repair is one shared builder on `@o2/core`'s barrel, and that was written first and
 * then withdrawn. A callable on that barrel whose only production caller is `browser-node.ts` is
 * reachable **solely through the `window.o2` hop**, and both the unreachable-export bound and the
 * disposition register that would have to account for it are full and frozen for this phase —
 * raising either is forbidden, and giving the symbol fake wiring to dodge the count is worse than
 * the count. So only {@link TURN_MINT_PURPOSE} is shared, and each side encodes for itself.
 *
 * **That leaves a real drift risk, and this file is the thing that actually holds it closed.**
 * `dag-cbor` sorts keys, so field ORDER cannot drift. What can drift is the field SET and the
 * purpose string, and both are compared here as bytes. A comment saying "keep these in sync"
 * would be exactly the *"a comment is not a specification"* shape `CLAUDE.md` records.
 *
 * The signer's side is **re-declared here rather than imported**, and that is the point: it is a
 * private function inside `BrowserNode.start`'s closure, so it cannot be imported, and a copy
 * that is asserted byte-equal to the verifier is worth more than a copy that is merely nearby.
 * If `browser-node.ts` changes its field set without changing this one, the assertion below still
 * passes — so the case is paired with a source-text check that the signer really does build these
 * four fields and no others.
 */

/** The signer's side, as `browser-node.ts` builds it. */
function signerBytes(nodeKey: string, region: string, requestedAt: number): Uint8Array {
  const encoded = encodeCanonical({ purpose: TURN_MINT_PURPOSE, nodeKey, region, requestedAt })
  if (!encoded.ok) throw new Error('not encodable')
  return encoded.bytes
}

describe('NET-12 — the tab and the hosted minter sign over identical bytes', () => {
  const cases = [
    ['aa', 'bootstrap-us', 1_800_000_000_000],
    ['deadbeef', 'bootstrap-eu', 0],
    ['', 'bootstrap-sam', -1],
    ['f'.repeat(64), 'bootstrap-us', Number.MAX_SAFE_INTEGER],
  ] as const

  for (const [nodeKey, region, requestedAt] of cases) {
    it(`agrees for ${region} / requestedAt=${String(requestedAt)}`, () => {
      expect(Array.from(signerBytes(nodeKey, region, requestedAt))).toEqual(
        Array.from(turnMintPayload(nodeKey, region, requestedAt)),
      )
    })
  }

  it('changes when any field changes, so the comparison is not comparing constants', () => {
    const base = Array.from(turnMintPayload('aa', 'bootstrap-us', 1))
    expect(Array.from(turnMintPayload('ab', 'bootstrap-us', 1))).not.toEqual(base)
    expect(Array.from(turnMintPayload('aa', 'bootstrap-eu', 1))).not.toEqual(base)
    expect(Array.from(turnMintPayload('aa', 'bootstrap-us', 2))).not.toEqual(base)
  })

  it('carries the purpose string, so a signature cannot be replayed from another exchange', () => {
    const withPurpose = turnMintPayload('aa', 'bootstrap-us', 1)
    const withoutPurpose = encodeCanonical({ nodeKey: 'aa', region: 'bootstrap-us', requestedAt: 1 })
    expect(withoutPurpose.ok).toBe(true)
    if (!withoutPurpose.ok) return
    expect(Array.from(withPurpose)).not.toEqual(Array.from(withoutPurpose.bytes))
    expect(TURN_MINT_PURPOSE).toBe('o2/turn-credential/1.0.0')
  })

  /**
   * The pairing the header promises.
   *
   * The two cases above compare a copy of the signer against the verifier. That is worth having
   * and it has a hole: if `browser-node.ts` changed its field set, the copy above would not move
   * and the comparison would stay green while production broke. So the signer's real source is
   * read as text — the `slow-specs.node.test.ts` idiom — and checked to build exactly these four
   * fields under exactly this purpose.
   */
  it('the signer’s real source builds these four fields and no others', () => {
    const source = readFileSync(
      fileURLToPath(new URL('../../browser/src/browser-node.ts', import.meta.url)),
      'utf8',
    )
    const builder = /function turnMintBytes\([^)]*\)[^{]*\{([\s\S]*?)\n\}/.exec(source)?.[1]
    expect(builder, 'turnMintBytes is gone from browser-node.ts — the signer moved').toBeDefined()
    expect(builder).toContain('purpose: TURN_MINT_PURPOSE')
    expect(builder).toContain('nodeKey')
    expect(builder).toContain('region')
    expect(builder).toContain('requestedAt')
    // Any field the verifier does not encode would break every signature.
    const encodedCall = /encodeCanonical\(\{([^}]*)\}\)/.exec(builder ?? '')?.[1] ?? ''
    expect(encodedCall.split(',').map((part) => part.split(':')[0]?.trim()).filter(Boolean)).toEqual([
      'purpose',
      'nodeKey',
      'region',
      'requestedAt',
    ])
  })
})
