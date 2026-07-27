import { describe, expect, it } from 'vitest'
import { describeKey, describeKeyFailure, normaliseFeatures, translationCid } from './cache-key.ts'
import type { TranslationKey } from './cache-key.ts'

/** AOT-02, AOT-03 — the cache key covers everything that could change the output. */

const base: TranslationKey = {
  inputDigest: 'bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy',
  target: 'aarch64-wasi32',
  toolchain: { elfconv: '0.9.1', llvm: '19.1.7', remill: 'ab12cd3' },
  features: ['bulk-memory', 'simd128'],
}

async function cidOf(key: TranslationKey): Promise<string> {
  const result = await translationCid(key)
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(describeKeyFailure(result.failure))
  return result.cid.toString()
}

describe('changing any part of the key changes the name', () => {
  it('is stable for an unchanged key', async () => {
    // Reproducibility's floor: the same inputs twice must agree with themselves
    // before it is worth asking whether two machines agree.
    expect(await cidOf(base)).toBe(await cidOf(base))
  })

  it('changes when the input changes', async () => {
    expect(await cidOf({ ...base, inputDigest: `${base.inputDigest.slice(0, -1)}a` })).not.toBe(
      await cidOf(base),
    )
  })

  it('changes when the target changes', async () => {
    // The Emscripten target emits JS glue and a different ABI. Two artifacts from
    // one input under two targets are two artifacts.
    expect(await cidOf({ ...base, target: 'wasm32-emscripten' })).not.toBe(await cidOf(base))
  })

  it('changes when any tool version changes', async () => {
    for (const tool of Object.keys(base.toolchain)) {
      const bumped = { ...base, toolchain: { ...base.toolchain, [tool]: 'different' } }
      expect(await cidOf(bumped), `${tool} version did not affect the key`).not.toBe(
        await cidOf(base),
      )
    }
  })

  it('changes when a tool is added or removed', async () => {
    const { remill: _removed, ...fewer } = base.toolchain
    expect(await cidOf({ ...base, toolchain: fewer })).not.toBe(await cidOf(base))
    expect(
      await cidOf({ ...base, toolchain: { ...base.toolchain, binaryen: '123' } }),
    ).not.toBe(await cidOf(base))
  })

  it('changes when the required feature set changes', async () => {
    // A node advertises the features it can run. An artifact that quietly acquired
    // a new requirement under an unchanged name would be dispatched to nodes that
    // cannot execute it, and the failure would look like flaky hardware.
    expect(await cidOf({ ...base, features: ['bulk-memory'] })).not.toBe(await cidOf(base))
    expect(await cidOf({ ...base, features: [...base.features, 'threads'] })).not.toBe(
      await cidOf(base),
    )
  })
})

describe('two machines cannot disagree by accident', () => {
  it('does not depend on the order features were listed in', async () => {
    // DAG-CBOR sorts map keys but preserves array order, so an unsorted list would
    // give two machines different CIDs for the same translation.
    expect(await cidOf({ ...base, features: ['simd128', 'bulk-memory'] })).toBe(await cidOf(base))
  })

  it('does not depend on the order tools were listed in', async () => {
    const reordered = { remill: 'ab12cd3', elfconv: '0.9.1', llvm: '19.1.7' }
    expect(await cidOf({ ...base, toolchain: reordered })).toBe(await cidOf(base))
  })

  it('treats a repeated feature as one feature', async () => {
    expect(normaliseFeatures(['simd128', 'simd128', 'bulk-memory'])).toEqual([
      'bulk-memory',
      'simd128',
    ])
    expect(await cidOf({ ...base, features: ['simd128', 'bulk-memory', 'simd128'] })).toBe(
      await cidOf(base),
    )
  })

  it('returns the normalised key alongside the CID', async () => {
    // So a caller stores what was hashed rather than what it passed in — the two
    // differ, and storing the second is how a cache starts lying.
    const result = await translationCid({ ...base, features: ['simd128', 'bulk-memory'] })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.key.features).toEqual(['bulk-memory', 'simd128'])
  })
})

describe('an incomplete key is refused, never hashed', () => {
  it('refuses an empty toolchain', async () => {
    // The dangerous case. It would produce a perfectly good-looking CID that went
    // on matching after the compiler changed underneath it, and a cache that serves
    // the previous compiler's output is worse than no cache at all.
    const result = await translationCid({ ...base, toolchain: {} })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.kind).toBe('empty-toolchain')
    expect(describeKeyFailure(result.failure)).toContain('when the compiler did')
  })

  it('refuses a blank version, naming the tool', async () => {
    const result = await translationCid({ ...base, toolchain: { ...base.toolchain, llvm: '  ' } })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.kind).toBe('blank-version')
    if (result.failure.kind !== 'blank-version') return
    expect(result.failure.tool).toBe('llvm')
  })

  it.each(['inputDigest', 'target'] as const)('refuses a blank %s', async (field) => {
    const result = await translationCid({ ...base, [field]: '' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.kind).toBe('empty-field')
    if (result.failure.kind !== 'empty-field') return
    expect(result.failure.field).toBe(field)
  })
})

describe('the key is legible in a build log', () => {
  it('names the target, the input, the tools, and the features', () => {
    const line = describeKey(base)
    expect(line).toContain('aarch64-wasi32')
    expect(line).toContain('elfconv 0.9.1')
    expect(line).toContain('llvm 19.1.7')
    expect(line).toContain('needs bulk-memory simd128')
  })

  it('says so when nothing beyond the baseline is required', () => {
    expect(describeKey({ ...base, features: [] })).toContain('no required features')
  })
})
