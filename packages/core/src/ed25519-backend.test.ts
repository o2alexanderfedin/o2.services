import { ed25519 } from '@noble/curves/ed25519.js'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createLibsodiumSyncVerifier, createNobleSyncVerifier, createSubtleAsyncVerifier } from './ed25519-backend.ts'
import type { Ed25519Backend } from './ed25519-backend.ts'

/**
 * Deterministic keys, same convention as `capability.test.ts`: seeded rather than
 * random, so a failure is reproducible and a reader can tell which vector produced it
 * from the test alone.
 */
function keypair(seed: number): { priv: Uint8Array; pub: Uint8Array } {
  const priv = new Uint8Array(32).fill(seed)
  return { priv, pub: ed25519.getPublicKey(priv) }
}

interface Vector {
  readonly name: string
  readonly signature: Uint8Array
  readonly message: Uint8Array
  readonly publicKey: Uint8Array
}

/** At least 5 distinct seeds, per the plan's acceptance criteria. */
const ACCEPT_VECTORS: readonly Vector[] = [1, 2, 3, 4, 5].map((seed) => {
  const { priv, pub } = keypair(seed)
  const message = new TextEncoder().encode(`vector ${seed}: o2.services X.509 profile`)
  return { name: `seed ${seed}`, signature: ed25519.sign(message, priv), message, publicKey: pub }
})

const BASE = (() => {
  const { priv, pub } = keypair(42)
  const message = new TextEncoder().encode('the base vector every reject case mutates')
  return { priv, pub, message, signature: ed25519.sign(message, priv) }
})()

/**
 * Constructs a signature whose `S` component is `S + L (mod 2**256)` — a different
 * byte string many verifiers have historically treated as an alternate valid encoding
 * of the same signature, per "Taming the many EdDSAs". RFC 8032 requires `S < L` in a
 * strict reading; this vector tests whether every backend actually enforces it.
 *
 * `L`, the Ed25519 group order: `2**252 + 27742317777372353535851937790883648493`.
 */
function nonCanonicalSVector(base: { signature: Uint8Array; message: Uint8Array; publicKey: Uint8Array }): Vector {
  const L = 2n ** 252n + 27742317777372353535851937790883648493n
  const bytesToBigIntLE = (bytes: Uint8Array): bigint => {
    let value = 0n
    for (let i = bytes.length - 1; i >= 0; i--) value = (value << 8n) | BigInt(bytes[i] as number)
    return value
  }
  const bigIntToBytesLE = (value: bigint, length: number): Uint8Array => {
    const out = new Uint8Array(length)
    let v = value
    for (let i = 0; i < length; i++) {
      out[i] = Number(v & 0xffn)
      v >>= 8n
    }
    return out
  }
  const r = base.signature.slice(0, 32)
  const s = bytesToBigIntLE(base.signature.slice(32, 64))
  // Verified empirically on this host, 2026-08-09: the resulting `S` is >= L (253 bits
  // vs L's 252), so this is a genuine non-canonical encoding, not a no-op mutation.
  const nonCanonicalS = (s + L) % 2n ** 256n
  const signature = new Uint8Array(64)
  signature.set(r, 0)
  signature.set(bigIntToBytesLE(nonCanonicalS, 32), 32)
  return { name: 'non-canonical S component (S >= L)', signature, message: base.message, publicKey: base.publicKey }
}

/**
 * At least 7 distinct reject vectors, weighted toward the malformed-input class the
 * ruling calls non-negotiable — agreement on the happy path is already established;
 * disagreement on a malformed input is the hazard a second (now third) implementation
 * in a trust path introduces.
 */
const REJECT_VECTORS: readonly Vector[] = [
  (() => {
    const signature = BASE.signature.slice()
    signature[0] = (signature[0] as number) ^ 1
    return { name: 'flipped-bit signature', signature, message: BASE.message, publicKey: BASE.pub }
  })(),
  {
    name: 'truncated signature (63 bytes)',
    signature: BASE.signature.slice(0, 63),
    message: BASE.message,
    publicKey: BASE.pub,
  },
  { name: 'all-zero signature', signature: new Uint8Array(64), message: BASE.message, publicKey: BASE.pub },
  {
    name: 'valid signature checked against a different message',
    signature: BASE.signature,
    message: new TextEncoder().encode('not the message this signature was made over'),
    publicKey: BASE.pub,
  },
  (() => {
    const publicKey = BASE.pub.slice()
    publicKey[0] = (publicKey[0] as number) ^ 1
    return { name: 'flipped-byte public key', signature: BASE.signature, message: BASE.message, publicKey }
  })(),
  {
    name: 'wrong-length public key (16 bytes)',
    signature: BASE.signature,
    message: BASE.message,
    publicKey: new Uint8Array(16),
  },
  nonCanonicalSVector({ signature: BASE.signature, message: BASE.message, publicKey: BASE.pub }),
]

/** `new Set(...).size` catches an accidental duplicate vector name silently narrowing coverage. */
it('reject vector names are unique', () => {
  expect(new Set(REJECT_VECTORS.map((v) => v.name)).size).toBe(REJECT_VECTORS.length)
})

it('there are at least 7 reject vectors, including the non-canonical S case', () => {
  expect(REJECT_VECTORS.length).toBeGreaterThanOrEqual(7)
  expect(REJECT_VECTORS.some((v) => v.name.includes('non-canonical'))).toBe(true)
})

/**
 * A real round-trip probe, not a presence check — `createSubtleAsyncVerifier()`
 * returns a verifier whenever `subtle.verify` exists as a function (matching
 * `initEd25519`'s own presence-only gate), which is true even on an engine that
 * advertises `SubtleCrypto` but rejects the `Ed25519` algorithm name specifically.
 * The differential-conformance guard needs to tell "genuinely unavailable" apart from
 * "available and correctly refusing", so it skips a backend the same way this probes.
 */
async function subtleSupportsEd25519(): Promise<boolean> {
  const subtle = globalThis.crypto?.subtle
  if (subtle === undefined) return false
  try {
    const key = await subtle.generateKey('Ed25519', true, ['sign', 'verify'])
    const kp = key as CryptoKeyPair
    const message = new Uint8Array([1, 2, 3])
    const signature = await subtle.sign('Ed25519', kp.privateKey, message)
    return await subtle.verify('Ed25519', kp.publicKey, signature, message)
  } catch {
    return false
  }
}

interface Backend {
  readonly name: Ed25519Backend | 'subtle'
  verify(signature: Uint8Array, message: Uint8Array, publicKey: Uint8Array): boolean | Promise<boolean>
}

/**
 * Every backend this environment can actually run, exercised through Task 1's own
 * exported factories directly — bypassing `initEd25519()`'s auto-selection so every
 * backend runs in the same suite regardless of which one this host would pick by
 * default. This is a quality improvement over a second, hand-rolled copy of each
 * library call: the guard below exercises the exact production adapter code.
 */
async function availableBackends(): Promise<readonly Backend[]> {
  const backends: Backend[] = []
  const noble = createNobleSyncVerifier()
  backends.push({ name: noble.backend, verify: noble.verify })

  const libsodium = await createLibsodiumSyncVerifier()
  backends.push({ name: libsodium.backend, verify: libsodium.verify })

  const subtle = createSubtleAsyncVerifier()
  if (subtle !== undefined && (await subtleSupportsEd25519())) {
    backends.push({ name: 'subtle', verify: subtle.verify })
  }
  return backends
}

describe('differential-conformance guard — every backend this host can run', () => {
  let backends: readonly Backend[] = []

  beforeAll(async () => {
    backends = await availableBackends()
    // Recorded so a skipped backend is visible in test output rather than silently
    // absent, per the plan's own requirement. This run, on Node v25.9.0: all three
    // backends are available (noble, libsodium, subtle — Ed25519 WebCrypto support
    // confirmed present on this host).
    console.log(`ed25519-backend.test.ts: backends available this run: ${backends.map((b) => b.name).join(', ')}`)
  })

  describe('accept vectors — every backend must agree true', () => {
    it.each(ACCEPT_VECTORS.map((v) => [v.name, v] as const))('%s', async (_name, vector) => {
      for (const backend of backends) {
        const result = await backend.verify(vector.signature, vector.message, vector.publicKey)
        expect(result, `${backend.name} disagreed on accept vector "${vector.name}"`).toBe(true)
      }
    })
  })

  describe('reject vectors — every backend must agree false (the non-negotiable half)', () => {
    it.each(REJECT_VECTORS.map((v) => [v.name, v] as const))('%s', async (_name, vector) => {
      const verdicts: Record<string, boolean> = {}
      for (const backend of backends) {
        verdicts[backend.name] = await backend.verify(vector.signature, vector.message, vector.publicKey)
      }
      for (const backend of backends) {
        expect(
          verdicts[backend.name],
          `backends disagreed on reject vector "${vector.name}": ${JSON.stringify(verdicts)}`,
        ).toBe(false)
      }
    })
  })
})

/**
 * `vi.resetModules()` plus a bare re-`import()` of the same specifier does not yield a
 * fresh module instance under real browser engines driven through vitest's browser
 * mode (measured this session: chromium, firefox and webkit all kept the memoised
 * `noble` selection from an earlier test after a `resetModules()` + re-import, where
 * Node's project did not). A distinct query string on the specifier is honoured as a
 * distinct module identity by every engine's native ESM loader **and** by Node's —
 * this is the portable mechanism, not a Vitest mocking feature with partial platform
 * support. `@vite-ignore` suppresses Vite's "cannot analyse this dynamic import"
 * warning; the specifier is still fully resolved at runtime.
 */
let freshModuleCounter = 0
async function freshEd25519Module(): Promise<typeof import('./ed25519-backend.ts')> {
  const specifier = `./ed25519-backend.ts?fresh-instance=${freshModuleCounter++}`
  return import(/* @vite-ignore */ specifier)
}

describe('initEd25519 — capability gate, secure-context arm', () => {
  afterEach(() => {
    vi.doUnmock('libsodium-wrappers')
  })

  it('never imports libsodium when crypto.subtle is Ed25519-capable, and picks noble for the sync port', async () => {
    let libsodiumImportCount = 0
    vi.doMock('libsodium-wrappers', () => {
      libsodiumImportCount++
      throw new Error('libsodium-wrappers must not be imported on the secure-context arm')
    })
    const mod = await freshEd25519Module()

    await mod.initEd25519()

    expect(libsodiumImportCount).toBe(0)
    // Not merely "resolves" — specifically noble, even though libsodium verifies
    // faster. This is the case that proves the ruling is scoped, not reversed.
    expect(mod.getSyncVerifier().backend).toBe('noble')
  })

  it('backs the async port with crypto.subtle, not libsodium, on the secure-context arm', async () => {
    let libsodiumImportCount = 0
    vi.doMock('libsodium-wrappers', () => {
      libsodiumImportCount++
      throw new Error('libsodium-wrappers must not be imported on the secure-context arm')
    })
    const mod = await freshEd25519Module()

    await mod.initEd25519()
    const asyncVerifier = mod.getAsyncVerifier()

    if (await subtleSupportsEd25519()) {
      const result = await asyncVerifier.verify(BASE.signature, BASE.message, BASE.pub)
      expect(result).toBe(true)
    }
    expect(libsodiumImportCount).toBe(0)
  })
})

describe('initEd25519 — capability gate, insecure-context arm (crypto.subtle absent)', () => {
  // `Object.defineProperty(..., { value: undefined })`, never the JS `delete` operator
  // applied to this same property path: `subtle` is an inherited accessor on
  // `Crypto.prototype`, and removing the own property (there usually isn't one) leaves
  // it reachable through the prototype regardless — silently exercising the
  // secure-context branch while reporting green.
  let originalSubtleDescriptor: PropertyDescriptor | undefined

  afterEach(() => {
    if (originalSubtleDescriptor !== undefined) {
      Object.defineProperty(globalThis.crypto, 'subtle', originalSubtleDescriptor)
    } else {
      // No own-property existed before shadowing (the common case: `subtle` was
      // reachable only through `Crypto.prototype`) — remove the shadow entirely
      // rather than leaving an own `undefined` behind.
      Reflect.deleteProperty(globalThis.crypto, 'subtle')
    }
    vi.doUnmock('libsodium-wrappers')
  })

  function shadowSubtleAsAbsent(): void {
    originalSubtleDescriptor = Object.getOwnPropertyDescriptor(globalThis.crypto, 'subtle')
    Object.defineProperty(globalThis.crypto, 'subtle', { value: undefined, configurable: true })
  }

  it('imports libsodium exactly once, shared by both ports, and picks libsodium for the sync port', async () => {
    // `vi.doMock('libsodium-wrappers', ...)` was tried two ways to count the import —
    // on `freshEd25519Module`'s query-suffixed specifier, and (here) on this test's own
    // plain, statically-analysable one. Measured this session: **neither** is
    // intercepted under real chromium/firefox/webkit through vitest's browser mode;
    // both are intercepted correctly under the `node` project. This is a platform
    // limitation of `vi.doMock` against dynamic `import()` in browser mode generally,
    // not specific to a non-literal specifier. So the counter below is asserted only
    // under Node, where it is honestly measured; every engine (Node included) still
    // gets the behavioural proof beneath it — both ports resolve correctly against a
    // real vector, which cannot happen unless the sync port's `libsodium` selection
    // actually completed. This is the only test in the file that calls
    // `initEd25519()` on the plain specifier's module instance, so it is safe to rely
    // on that instance being pristine (nothing else touches its module-level
    // `syncVerifier`/`asyncVerifier`/`initPromise` state).
    let libsodiumImportCount = 0
    vi.doMock('libsodium-wrappers', async (importOriginal) => {
      libsodiumImportCount++
      return await importOriginal<typeof import('libsodium-wrappers')>()
    })
    shadowSubtleAsAbsent()
    const mod = await import('./ed25519-backend.ts')

    await mod.initEd25519()
    expect(mod.getSyncVerifier().backend).toBe('libsodium')

    // Exercise both ports; the counter (Node only, see above) must still read 1
    // afterward — proving the async port wraps the same resolved instance rather than
    // importing a second time.
    const syncOk = mod.getSyncVerifier().verify(BASE.signature, BASE.message, BASE.pub)
    const asyncOk = await mod.getAsyncVerifier().verify(BASE.signature, BASE.message, BASE.pub)
    expect(syncOk).toBe(true)
    expect(asyncOk).toBe(true)
    if (typeof window === 'undefined') {
      expect(libsodiumImportCount).toBe(1)
    }

    vi.doUnmock('libsodium-wrappers')
  })

  it('performs the import at most once when initEd25519() is called twice concurrently', async () => {
    shadowSubtleAsAbsent()
    const mod = await freshEd25519Module()

    // Counting `import('libsodium-wrappers')` invocations via `vi.doMock` was tried
    // first and dropped: measured this session, `vi.doMock` does not intercept a
    // dynamically-constructed (query-suffixed) specifier's transitive imports under
    // real chromium/firefox/webkit engines through vitest's browser mode, only under
    // the `node` project — a platform-specific mocking limitation, not a defect in
    // this module. The portable proof is a direct identity check instead: called
    // before the first call's promise has settled, a second concurrent caller must
    // observe the *exact same* in-flight promise — not a fresh one that would trigger
    // its own independent `import('libsodium-wrappers')` — which is precisely what
    // `initEd25519`'s `if (initPromise === undefined)` guard exists to guarantee.
    const first = mod.initEd25519()
    const second = mod.initEd25519()
    expect(second).toBe(first)

    await first
    expect(mod.getSyncVerifier().backend).toBe('libsodium')
  })
})

describe('getSyncVerifier() / getAsyncVerifier() have no implicit default', () => {
  it('both throw Ed25519NotInitializedError before initEd25519() has resolved', async () => {
    const mod = await freshEd25519Module()

    expect(() => mod.getSyncVerifier()).toThrow(mod.Ed25519NotInitializedError)
    expect(() => mod.getAsyncVerifier()).toThrow(mod.Ed25519NotInitializedError)
  })

  it('the thrown error names which port was requested', async () => {
    const mod = await freshEd25519Module()

    try {
      mod.getSyncVerifier()
      expect.unreachable('getSyncVerifier() must throw before init')
    } catch (error) {
      expect(error).toBeInstanceOf(mod.Ed25519NotInitializedError)
      expect((error as InstanceType<typeof mod.Ed25519NotInitializedError>).port).toBe('sync')
    }

    try {
      mod.getAsyncVerifier()
      expect.unreachable('getAsyncVerifier() must throw before init')
    } catch (error) {
      expect(error).toBeInstanceOf(mod.Ed25519NotInitializedError)
      expect((error as InstanceType<typeof mod.Ed25519NotInitializedError>).port).toBe('async')
    }
  })
})

describe('sync port and async port agree on every reject vector (T-25-16)', () => {
  // The seam the adapter itself introduces: before this module, at most one Ed25519
  // implementation was ever live in a trust path. The adapter makes two live at once —
  // one per port — and disagreement between them over a malformed input is exactly the
  // hazard T-25-11 already names, now with a second seam to check it at.
  it.each(REJECT_VECTORS.map((v) => [v.name, v] as const))(
    '%s — sync and async ports agree',
    async (_name, vector) => {
      const mod = await freshEd25519Module()
      await mod.initEd25519()

      const syncVerdict = mod.getSyncVerifier().verify(vector.signature, vector.message, vector.publicKey)
      const asyncVerdict = await mod.getAsyncVerifier().verify(vector.signature, vector.message, vector.publicKey)

      expect(
        asyncVerdict,
        `sync port said ${syncVerdict}, async port said ${asyncVerdict} for "${vector.name}"`,
      ).toBe(syncVerdict)
    },
  )
})
