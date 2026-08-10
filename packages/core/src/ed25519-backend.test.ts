/**
 * Task 3 of the 25-04 adapter revision — the record, the re-measurement, and the
 * wiring decision. Dated 2026-08-09. This docblock is the planning-time deliverable
 * this revision produces; the tests below it are Tasks 1 and 2's.
 *
 * ## Part 1 — the record that selected this design (preserved, reframed, re-derived this revision)
 *
 * This paragraph was originally written as a pricing obligation under the first owner
 * ruling's item 3 ("price this in planning; count the call sites and say the number").
 * The second owner ruling, same day, chose an adapter instead of the migration this
 * priced — so what follows is no longer live scope, it is the **evidence** that
 * selected the adapter, kept because deleting it would erase the reason for the
 * decision. A prior draft of this docblock counted 9 sites; that count was wrong — it
 * double-counted two `agent.ts` lines that call the `Authorizer` abstraction rather
 * than `verifyChain` itself, and it missed two real call sites — and this revision
 * corrects it. Re-derive the number below rather than transcribing it:
 *
 * ```
 * grep -rn -E "\b(verifyChain|verifyCertificate|verifyResultAttestation|verifyCombineAttestation)\(" \
 *   --include="*.ts" packages bin tools \
 *   | grep -v -E "\.test\.ts:|node_modules" \
 *   | grep -v -E ":(export )?(async )?function |: \* |:\s*\*"
 * ```
 *
 * Run this session, 2026-08-09: **11 raw matches.** One is not a call:
 * `packages/node/src/mutation-ledger.ts:1473` is a quoted string literal inside a
 * mutation-ledger `find:` entry (concatenated with `'\n' +`), recording a line of
 * source *about* a call rather than the call itself — this repository's own "quoted
 * history reads as present tense" hazard, live in this file. Excluded by reading, not
 * by pattern — a grep-based exclusion for it would just be a second pattern to go
 * stale. The remaining **10 lines are real production call expressions, across 9
 * files, in 4 packages** (`browser`, `core`, `net`, `node`; `peer-verifier.ts` holds
 * two).
 *
 * Adopting a single async `verifyEd25519Async` inside `verifyChain` (`capability.ts`)
 * and `verifyCertificate` (`enrollment.ts`) would have required both functions to
 * become `async`, propagating to every caller transitively until an already-async
 * boundary absorbed it. All ten, by file:line:
 *
 * **Already inside an `async` function — mechanical `await` only, no signature change
 * anywhere in the chain:**
 * - `discovery.ts:264` — inside `discoverExecutors` (`export async function
 *   discoverExecutors`, `discovery.ts:241`).
 * - `main.ts:350` — inside `peerCertificate` (`async function peerCertificate`,
 *   `browser/demo/main.ts:315`).
 * - `peer-verifier.ts:688` — inside `verify()` (`verify(peerId): Promise<PeerVerdict>`,
 *   already async, `peer-verifier.ts:599`).
 * - `fabric-node.ts:960` — inside an already-`async` arrow closure
 *   (`return async (source: PeerId): Promise<boolean> => {`, `fabric-node.ts:881`).
 *
 * **Currently synchronous, but resolving mechanically one or two levels further up an
 * already-`async` caller:**
 * - `reduce-job.ts:321` (`verifyCombineAttestation`, inside `aggregateAttestationOf` —
 *   not `async` — whose one call site is inside `reduceJob`, `export async function
 *   reduceJob`, already `async`, at `reduce-job.ts:488` — mechanical one level up; the
 *   site a prior draft of this record omitted entirely).
 * - `capability-authorizer.ts:132` (`verifyChain`, inside `authorizeCapability`'s
 *   returned closure — not `async` — promoting it is one change; its two call sites,
 *   `agent.ts:541` and `agent.ts:1014`, already call it through the `Authorizer`
 *   interface (`interface Authorizer`, `agent.ts:121`) inside `async` functions, so
 *   both would need only `await` — these two `agent.ts` lines are **not** among the
 *   10, since they call the `Authorizer` abstraction rather than
 *   `verifyChain`/`verifyCertificate` directly, but they are the concrete downstream
 *   cost of promoting `capability-authorizer.ts:132`, so they are named here rather
 *   than silently absorbed).
 * - `enrollment.ts:926` (`resolveReplicaSets`, `enrollment.ts:919`, currently
 *   synchronous — would itself need to become `async`, with its one call site at
 *   `discover-candidates.ts:263`, inside `discoverCandidates`, `export async function
 *   discoverCandidates` at `discover-candidates.ts:190`, already `async` — mechanical
 *   one level up).
 * - `result-attestation.ts:483` (inside `verifyResultAttestation`,
 *   `result-attestation.ts:408`, currently synchronous — would need to become
 *   `async`) chained with `job/submit.ts:1114` (`verifyResultAttestation`'s own call,
 *   inside `receiptFor`, `job/submit.ts:1084`, itself synchronous, so `receiptFor`
 *   would need to become `async` too — but `receiptFor`'s own one call site, inside
 *   `submitJob` at `job/submit.ts:3071`, `export async function submitJob` at
 *   `job/submit.ts:2389`, is already `async`, so the chain terminates there,
 *   mechanical two levels up from `result-attestation.ts:483`).
 *
 * **Not mechanical at all — the one finding the adapter dissolves rather than pays
 * for:**
 * - `peer-verifier.ts:557` (inside `#demoteIfExpired`, `peer-verifier.ts:552`, called
 *   only from `#refresh` at `peer-verifier.ts:479` (call site `peer-verifier.ts:492`),
 *   called only from the **synchronous getter** `verifiedPeers` at
 *   `peer-verifier.ts:433` — see below; the site a prior draft of this record also
 *   omitted, folding it silently into the `:688` entry although the two are reached
 *   through entirely different paths).
 *
 * **Total: 10 production call sites across 9 files in 4 packages**, of which 4 are
 * already inside an `async` function (mechanical, no promotion needed), 5 require
 * promoting a currently-synchronous function to `async` — each resolving mechanically
 * one or two levels further up an already-`async` caller — and 1
 * (`peer-verifier.ts:557`) is not mechanical: it is reachable only through the same
 * synchronous `verifiedPeers` getter named below, which cannot be made `async` without
 * an interface-shape change.
 *
 * **The structural obstacle, named precisely, because it is the one the adapter
 * dissolves:** `packages/node/src/peer-verifier.ts:433`'s `PeerVerifier.verifiedPeers`
 * is a **synchronous getter**, not a function — `get verifiedPeers(): readonly
 * string[]`. A getter cannot be made `async` without changing its return type from
 * `readonly string[]` to `Promise<readonly string[]>`, an interface-shape change, not
 * a mechanical `await`. That would break `RpcBlockSource`'s constructor contract — it
 * is consumed as a synchronous thunk (`peers: () => requestor.verifiedPeers`,
 * `packages/node/src/bin/bench.ts:1353`; `new RpcBlockSource(rpc, () =>
 * verifier.verifiedPeers)`, `fabric-node.ts:2107`), the path supplying a task's input
 * blocks, which this phase's own locked decision requires staying off the execution
 * path. The getter reaches `verifyCertificate` through exactly one path —
 * `verifiedPeers` (`peer-verifier.ts:433`) -> `#refresh` (its only call site,
 * `peer-verifier.ts:436`) -> `#demoteIfExpired` -> `verifyCertificate`
 * (`peer-verifier.ts:557`) — so making `verifyCertificate` async would force
 * `#demoteIfExpired`, `#refresh`, and `verifiedPeers` itself to become async, which is
 * materially more than an `await` migration and was not scoped or budgeted by this
 * phase's `25-CONTEXT.md`.
 *
 * **The verdict this measurement produced, and how the second ruling answers it — not
 * by paying the cost, by not incurring it.** Under a single async
 * `verifyEd25519Async`, this pricing would have blocked the migration from landing
 * inside Phase 25. Under the adapter's synchronous port, none of it is paid:
 * `verifyChain` and `PeerVerifier.verifiedPeers` can call
 * `getSyncVerifier().verify(...)` and remain exactly as synchronous as they are
 * today — no function in the 10-call-site chain above needs to change signature. The
 * obstacle this section priced is real and correctly measured; it is also no longer
 * the cost of adopting this module, because the module this plan now ships is not the
 * one that was priced.
 *
 * ## Part 2 — re-measurement (ruling item 4, unchanged obligation)
 *
 * Re-measured this session, this host (Node v25.9.0), `performance.now()` throughout —
 * never `Date.now()` — 20 000 iterations after a 1 000-iteration warmup, comparing a
 * direct `@noble/curves` `ed25519.verify(...)` call against
 * `getSyncVerifier().verify(...)` under whichever backend `initEd25519()` selected on
 * this host (this host: `noble` — `crypto.subtle` is Ed25519-capable here, so the sync
 * port picked noble, same as the direct call, isolating the adapter's own try/catch
 * overhead rather than a cross-backend difference):
 *
 * - `@noble/curves` direct: **1.3204 ms** per verify.
 * - `getSyncVerifier().verify(...)`: **1.3257 ms** per verify.
 * - Ratio (port / direct): **1.004** — the adapter's try/catch wrapper costs
 *   approximately 0.4% over the bare library call, on this host, this run. This is a
 *   distinct measurement from `25-CONTEXT.md`'s 2026-08-09 table (which compared
 *   *backends* — noble vs. libsodium vs. subtle — not the port's own overhead over its
 *   selected backend); it is added beside that table as a second, independently-dated
 *   data point, not a replacement for it. `25-CONTEXT.md`'s own table already recorded
 *   its numbers as "one host, one run, without this repository's comparative-ratio
 *   discipline" — this measurement supplies the ratio that discipline asks for, for
 *   the one comparison this plan's own port introduces (port overhead vs. bare call),
 *   which `25-CONTEXT.md`'s table did not and could not cover, since the port did not
 *   exist yet when it was written.
 *
 * **Re-checked, not re-derived**, the `instanceof Promise` table from
 * `25-CONTEXT.md`'s adapter sub-section, run against every backend this host makes
 * available: `@noble/curves`'s `ed25519.verify(...)` -> `false`; libsodium's
 * `crypto_sign_verify_detached(...)` (post-`ready`) -> `false`;
 * `crypto.subtle.verify(...)` -> `true`. Unchanged from the cited table — the
 * empirical claim the entire port design rests on holds on this host, this session.
 *
 * ## Part 3 — the wiring decision, stated by name (new obligation this revision adds)
 *
 * Stated plainly: `verifyChain` (`capability.ts`) and `verifyCertificate`
 * (`enrollment.ts`) are **not** wired to the new port in this phase — **not planned as
 * execution work in Phase 25.** This is out of scope for this revision, and the
 * reason is not the async-migration cost priced in Part 1 above — the adapter
 * dissolves that. The reason is a decision Part 1's pricing never had to make and this
 * plan's obligations do not cover: **where each of three runtime entry points
 * (`packages/net`'s agent bootstrap, `packages/node`'s `fabric-node.ts`,
 * `packages/browser`'s `browser-node.ts`) calls `initEd25519()` before first use, and
 * what a verification arriving before that promise resolves should do** (block on it,
 * fail closed, or fail open with a documented reason — an actual trust-path design
 * choice). Deciding that inside a single-plan revision would be replanning the phase,
 * which this revision is explicitly told not to do.
 *
 * What a future wiring pass needs to do: call `initEd25519()` once per process at
 * startup, at each of the three entry points named above; decide and test the
 * pre-init behaviour described above; replace `capability.ts:219`'s
 * `ed25519.verify(...)` call and `enrollment.ts`'s four `ed25519.verify(...)` call
 * sites (`enrollment.ts:702`, `enrollment.ts:740`, `enrollment.ts:759`,
 * `enrollment.ts:874`) with `getSyncVerifier().verify(...)`; update
 * `capability.test.ts` and `enrollment.test.ts` accordingly.
 *
 * This module carries no requirement ID (`requirements: []` in 25-04-PLAN.md's
 * frontmatter, unchanged this revision), and `.planning/REQUIREMENTS.md` needs no edit
 * as a result of this revision — nothing ledgers this module as delivering a
 * requirement yet, and the ledger claim that matters here is honesty about "Built, not
 * wired", which this section states rather than implies. Wiring the sync port into
 * `verifyChain`/`verifyCertificate` is not planned as execution work in Phase 25 — the
 * module ships complete, tested, and ready to be adopted by whichever future phase
 * makes the bootstrap-ordering decision above.
 */

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
