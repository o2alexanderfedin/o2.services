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

/**
 * A key whose name is written down, rather than merely compared with itself.
 *
 * All four fields are populated, and the feature list is deliberately unsorted and
 * duplicated so the vector pins the normalisation as well as the record shape.
 */
const CONFORMANCE_KEY: TranslationKey = {
  inputDigest: 'bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku',
  target: 'aarch64-wasi32',
  toolchain: { elfconv: '0.9.1', llvm: '19.1.7' },
  features: ['simd128', 'bulk-memory', 'simd128'],
}

/**
 * The name of {@link CONFORMANCE_KEY}. Changing this literal is not a test edit.
 *
 * It means the name of **every** translation changed, and that has to be a deliberate
 * act with a cache flush attached. A silent change here invalidates every cached
 * translation on every machine at once — and the wasted rebuilds are the cheap half.
 * The expensive half is that two machines on different versions would no longer be
 * able to tell whether they are talking about the same translation: each would
 * compute a perfectly good-looking CID, they would simply never match, and nothing
 * anywhere would report a disagreement. A cache key exists to be that comparison.
 *
 * Every other assertion in this file is relative — A differs from B, A equals itself
 * — and relative assertions cannot see this failure at all. Rename a field passed to
 * `canonicalCid`, reorder the record, drop `normaliseFeatures`: the whole suite still
 * passes, because it only ever asked the code to agree with itself.
 *
 * Computed once by a throwaway script outside the repo and pasted here. Never
 * recomputed at test time, for exactly that reason.
 */
const CONFORMANCE_CID = 'bafyreianou4wfzeubaqi7inz6fwuhxfrp7x3qhefrjznzasqiqs6nm34pe'

describe('the name of a translation is fixed, not merely self-consistent', () => {
  it('gives a known key the exact CID that was pinned for it', async () => {
    expect(await cidOf(CONFORMANCE_KEY)).toBe(CONFORMANCE_CID)
  })

  it('gives the already-normalised form of that key the same pinned CID', async () => {
    // The literal is the CID of the *normalised* record, not of whatever the caller
    // happened to type. If these two ever diverge the vector is pinning one caller's
    // spelling of a feature list rather than the identity of a translation.
    expect(await cidOf({ ...CONFORMANCE_KEY, features: ['bulk-memory', 'simd128'] })).toBe(
      CONFORMANCE_CID,
    )
  })
})

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

describe('a key that cannot be encoded says so under its own name', () => {
  /**
   * The one way the all-strings assumption breaks without a type assertion.
   *
   * `new Array<string>(n)` type-checks as `readonly string[]` and holds `n` holes,
   * which read back as `undefined` — a value TypeScript was perfectly happy to hand
   * over and DAG-CBOR has no representation for. That is not a contrived cast; it is
   * a builder pattern somebody will write.
   */
  const holes = (n: number): readonly string[] => new Array<string>(n)

  it('reaches the encoding failure through a value the type system permitted', async () => {
    const result = await translationCid({ ...base, features: holes(2) })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.kind).toBe('unencodable')
    if (result.failure.kind !== 'unencodable') return
    expect(result.failure.error.kind).toBe('codec-rejected')
  })

  it('does not report the failure as an empty field with a JSON blob for a name', async () => {
    // What this used to do. `field` is read as a field *name*, so a caller branching
    // on `empty-field` went hunting for a field called `{"kind":"codec-rejected",…}`
    // — and the failure meaning "this translation has no name at all" arrived wearing
    // the clothes of the one meaning "you left a box blank".
    const result = await translationCid({ ...base, features: holes(1) })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.kind).not.toBe('empty-field')
  })

  it('surfaces the encoding failure rather than hashing whatever survived', async () => {
    // The point of not swallowing it. Silently dropping the unencodable element and
    // hashing the rest would mint a valid-looking CID for a key nobody supplied.
    const result = await translationCid({ ...base, features: holes(2) })
    expect(result.ok).toBe(false)
  })

  it('describes the failure with the codec detail, not a stringified object', () => {
    // The literal `@ipld/dag-cbor` emits for the case above.
    const detail = '`undefined` is not supported by the IPLD Data Model'
    const sentence = describeKeyFailure({
      kind: 'unencodable',
      error: { kind: 'codec-rejected', detail },
    })
    expect(sentence).toContain(detail)
    expect(sentence).not.toContain('[object Object]')
    expect(sentence).not.toContain('\n')
  })

  it('describes a non-finite float by the path it was found at', () => {
    // The other `EncodeError` kind. Unreachable from the current all-string fields,
    // which is precisely why it is asserted here rather than left to a future field
    // type to discover in production.
    expect(
      describeKeyFailure({
        kind: 'unencodable',
        error: { kind: 'non-finite-float', path: 'features[0]', value: 'NaN' },
      }),
    ).toContain('features[0] is NaN')
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
