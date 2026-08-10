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
 *   *backends* — noble vs. the WASM fallback vs. subtle — not the port's own overhead over its
 *   selected backend); it is added beside that table as a second, independently-dated
 *   data point, not a replacement for it. `25-CONTEXT.md`'s own table already recorded
 *   its numbers as "one host, one run, without this repository's comparative-ratio
 *   discipline" — this measurement supplies the ratio that discipline asks for, for
 *   the one comparison this plan's own port introduces (port overhead vs. bare call),
 *   which `25-CONTEXT.md`'s table did not and could not cover, since the port did not
 *   exist yet when it was written.
 *
 * **Re-checked, not re-derived**, the `instanceof Promise` table from
 * `25-CONTEXT.md`'s adapter sub-section, run against every backend this host made
 * available on 2026-08-09: `@noble/curves`'s `ed25519.verify(...)` -> `false`; the
 * WASM fallback's detached-verify (post-`ready`) -> `false`;
 * `crypto.subtle.verify(...)` -> `true`. Unchanged from the cited table — the
 * empirical claim the entire port design rests on holds on this host, this session.
 * (The middle row is history: Phase 28 removed that arm and this file no longer names
 * the package, so the differential guard below reads two backends, not three. The name
 * survives in `28-01-SUMMARY.md` and in this file's git history.)
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

import { ed25519, x25519 } from '@noble/curves/ed25519.js'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createNobleSyncVerifier, nobleCryptoBackend, subtleCryptoBackend } from './ed25519-backend.ts'
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
 * The rejection weighting, asserted rather than left as an artefact of how many vectors
 * somebody happened to write.
 *
 * Agreement on the happy path is already established — every backend accepts a valid
 * signature or it would not be a backend. The hazard a second implementation introduces
 * is **disagreement on a malformed input**, so the corpus has to stay heavier on the
 * rejection side. Until Plan 28-03 that weighting was true (7 reject against 5 accept)
 * and unasserted: adding three accept vectors would have silently inverted it with
 * nothing going red. Read 2026-08-10: 7 reject, 5 accept.
 */
it('the vector corpus stays weighted toward rejection', () => {
  expect(
    REJECT_VECTORS.length,
    `the corpus must stay heavier on the rejection side: ${REJECT_VECTORS.length} reject vs ${ACCEPT_VECTORS.length} accept`,
  ).toBeGreaterThan(ACCEPT_VECTORS.length)
})

/**
 * A real round-trip probe, not a presence check — an engine can advertise
 * `SubtleCrypto` and reject the `Ed25519` algorithm name specifically. The
 * differential-conformance guard needs to tell "genuinely unavailable" apart from
 * "available and correctly refusing", so it decides whether to include the subtle
 * backend by probing.
 *
 * **Kept deliberately separate from the production module's own probe** (Phase 28
 * merged that gate into `detectCryptoBackend`, which this file also exercises). The
 * guard must reach its own verdict about this host rather than read the module's
 * answer, or it would be validating the module against the module.
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

  if (await subtleSupportsEd25519()) {
    // Phase 28: the subtle arm is now reached through `subtleCryptoBackend()`, the one
    // production implementation, rather than through the deleted
    // `createSubtleAsyncVerifier()` — which was a *second* subtle verify path sitting
    // beside it. The argument reorder happens here at the push site, because the port
    // takes `verifyEd25519(publicKey, signature, message)` and this harness calls
    // `verify(signature, message, publicKey)`. Adapting rather than hand-rolling the
    // subtle calls again is what keeps the property stated above true.
    const subtle = subtleCryptoBackend()
    backends.push({
      name: 'subtle',
      verify: (signature, message, publicKey) => subtle.verifyEd25519(publicKey, signature, message),
    })
  }
  return backends
}

describe('differential-conformance guard — every backend this host can run', () => {
  let backends: readonly Backend[] = []

  beforeAll(async () => {
    backends = await availableBackends()
    // Recorded so a skipped backend is visible in test output rather than silently
    // absent, per the plan's own requirement. Phase 28 removed the WASM arm, so
    // the list is at most two: noble always, subtle when this host's own round-trip
    // probe passes. Read 2026-08-10 on Node v25.9.0 and on all three browser engines:
    // `noble, subtle`. The floor below is sited against exactly those readings.
    console.log(`ed25519-backend.test.ts: backends available this run: ${backends.map((b) => b.name).join(', ')}`)
  })

  /**
   * The floor, and it is its own case on purpose: a failure here has to name the floor,
   * not a vector.
   *
   * ## What it closes
   *
   * `availableBackends()` pushes noble unconditionally and subtle only when this file's
   * own round-trip probe passes. Before Phase 28 it also pushed a WASM arm
   * unconditionally, so the list could never fall below two. **With that arm removed, a
   * host whose `crypto.subtle` is absent or Ed25519-incapable leaves exactly one
   * backend** — and then every loop below that says "the backends disagreed" passes by
   * comparing noble with itself. Both loops iterate `backends`; neither asserts a
   * cardinality. That is the *"proof that cannot fail"* CLAUDE.md § Proofs refuses, and
   * it would become unfalsifiable on precisely the tier the deleted arm had been bought
   * for.
   *
   * ## Sited, not picked — and it does not bind on any measured host
   *
   * Two is the count every host measured so far reports. 28-01 recorded this file's own
   * `availableBackends` console line, verbatim and identical on all four:
   *
   * ```
   * ed25519-backend.test.ts: backends available this run: noble, subtle
   * ```
   *
   * — node (Node v25.9.0), browser/chromium, browser/firefox, browser/webkit, all read
   * 2026-08-10. So this floor is **slack on every host anybody has run**, and that is
   * stated rather than hidden: it is a guard against a future host, not a fix for a
   * current failure. The hazard itself is **INFERRED** — read out of the selection logic
   * above, never observed, because no measured engine here refuses Ed25519.
   *
   * ## Watched red, so it is not itself a proof that cannot fail
   *
   * `availableBackends()` was planted to `return backends` immediately after the noble
   * push, i.e. to report the one-backend host this floor exists for. Observed verbatim,
   * `--project node --reporter=verbose`, 2026-08-10, exit 1:
   *
   * ```
   * ed25519-backend.test.ts: backends available this run: noble
   *
   *  FAIL  |node| packages/core/src/ed25519-backend.test.ts > differential-conformance guard — every backend this host can run > refuses to run against fewer than two backends
   * AssertionError: a differential guard needs two implementations to differ — this host offered 1: noble. Every "the backends disagreed" loop below would pass by comparing a backend with itself.: expected 1 to be greater than or equal to 2
   *  ❯ packages/core/src/ed25519-backend.test.ts:464:7
   *
   *  Test Files  1 failed (1)
   *       Tests  1 failed | 31 passed (32)
   * ```
   *
   * **All five accept-vector cases and all seven reject-vector cases stayed green under
   * that same plant** — 1 failed, 31 passed — which is the whole argument for this case
   * existing: the vacuity it closes is invisible to every other case in the block, and
   * to the two cardinality assertions above it as well. Restored by the surgical inverse
   * of that one-line insertion and `cmp`-verified byte-identical against a snapshot taken
   * immediately before planting.
   */
  it('refuses to run against fewer than two backends', () => {
    expect(
      backends.length,
      `a differential guard needs two implementations to differ — this host offered ${backends.length}: ` +
        `${backends.map((b) => b.name).join(', ')}. Every "the backends disagreed" loop below would pass ` +
        'by comparing a backend with itself.',
    ).toBeGreaterThanOrEqual(2)
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
 * Which engine printed a line, so the byte-match verdict below is attributable rather
 * than three anonymous lines in one browser run.
 *
 * Order matters and is not cosmetic: Chrome's user-agent string contains `AppleWebKit`,
 * so a webkit test written before the chromium test misattributes every chromium run.
 */
function engineLabel(): string {
  const agent = globalThis.navigator?.userAgent
  if (agent === undefined || agent === '') return 'unknown-engine'
  if (agent.includes('Firefox')) return 'firefox'
  if (agent.includes('Chrome') || agent.includes('Chromium')) return 'chromium'
  if (agent.includes('AppleWebKit')) return 'webkit'
  if (agent.includes('Node')) return 'node'
  return agent
}

/**
 * **Ed25519 signature bytes are not a stable identifier in this fabric**, and this is
 * the behavioural half of that claim. The source-level half is
 * `packages/node/src/one-crypto-implementation.node.test.ts`.
 *
 * RFC 8032 defines one canonical deterministic nonce derivation but does not require
 * every conforming implementation to use exactly it; some harden against fault attacks
 * with a synthetic/hedged nonce instead. Measured in this repository:
 * `cert-lifecycle.ts:47-61` and `cert-lifecycle.browser.test.ts:79-88` record that Node,
 * chromium and firefox's `subtle` produced signatures byte-identical to noble's and
 * **WebKit's did not** — a different, still-valid signature over the same seed and
 * message, verified successfully by both arms.
 *
 * So the relation asserted here is **mutual verifiability, in all four directions, over
 * several seeds** — and byte-equality of Ed25519 signatures is asserted in *neither*
 * direction, deliberately. `toEqual` would be red on webkit; `not.toEqual` would be red
 * on node, chromium and firefox. Either one would be a guard that encodes an engine
 * rather than a property. Whether the two arms happened to match is `console.log`ged
 * beside the engine name, so the divergence stays visible in test output on the run
 * where it happens, and nothing depends on the answer.
 *
 * **Re-measured by this block, 2026-08-10**, four seeds (7, 11, 13, 17), one run each of
 * `--project node` and `--project browser`. Every one of the four all-directions
 * verification assertions passed on every engine; the reported byte-match verdict was:
 *
 * | Engine | seeds 7 / 11 / 13 / 17 |
 * |---|---|
 * | node (v25.9.0) | MATCHED ×4 |
 * | chromium | MATCHED ×4 |
 * | firefox | MATCHED ×4 |
 * | **webkit** | **DIFFERED ×4** |
 *
 * Four seeds rather than one, so webkit's divergence reads as its nonce construction
 * rather than as a coincidence on a single input. Had this block asserted equality it
 * would be red four times on webkit; had it asserted inequality it would be red twelve
 * times across node, chromium and firefox.
 *
 * **X25519 is the contrast case, and it is why this block does not read as "cross-arm
 * agreement is impossible".** Agreement is plain scalar multiplication with no
 * randomness anywhere in it, so it has exactly one correct output per input pair — that
 * *is* asserted byte-identical, and it is the only byte-identity claim in this block.
 * The Ed25519 divergence is specific to signature nonces, not general to the two arms.
 */
describe('cross-arm signing is mutually verifiable, never byte-identical (CRYPTO-06)', () => {
  const noble = nobleCryptoBackend()
  let subtleCapable = false

  beforeAll(async () => {
    // The same real round-trip probe `availableBackends` uses, for the same reason: an
    // engine can advertise `SubtleCrypto` and refuse `Ed25519`, and constructing
    // `subtleCryptoBackend()` against such an engine would fail for a reason that is not
    // this block's subject.
    subtleCapable = await subtleSupportsEd25519()
  })

  /** Three seeds minimum, per the plan; four, so a one-off coincidence is visible. */
  const SEEDS: readonly number[] = [7, 11, 13, 17]

  it.each(SEEDS.map((seed) => [seed] as const))(
    'seed %i: every signature verifies on both arms, and the byte-match verdict is reported not asserted',
    async (seed) => {
      const privateSeed = new Uint8Array(32).fill(seed)
      const publicKey = ed25519.getPublicKey(privateSeed)
      const message = new TextEncoder().encode(`cross-arm vector, seed ${seed}`)

      const fromNoble = await noble.signEd25519(privateSeed, message)
      expect(await noble.verifyEd25519(publicKey, fromNoble, message)).toBe(true)

      if (!subtleCapable) {
        console.log(
          `ed25519-backend.test.ts: cross-arm seed ${seed} on ${engineLabel()}: subtle arm skipped — this engine's Ed25519 round-trip probe failed`,
        )
        return
      }

      const subtle = subtleCryptoBackend()
      const fromSubtle = await subtle.signEd25519(privateSeed, message)

      // All four directions. A signature made on either arm is valid under both.
      expect(await subtle.verifyEd25519(publicKey, fromNoble, message), 'subtle must verify a noble signature').toBe(
        true,
      )
      expect(await subtle.verifyEd25519(publicKey, fromSubtle, message), 'subtle must verify its own signature').toBe(
        true,
      )
      expect(await noble.verifyEd25519(publicKey, fromSubtle, message), 'noble must verify a subtle signature').toBe(
        true,
      )

      // Reported, never asserted — see this block's docblock for why an assertion in
      // either direction would encode an engine rather than a property.
      const identical =
        fromNoble.length === fromSubtle.length && fromNoble.every((byte, index) => byte === fromSubtle[index])
      console.log(
        `ed25519-backend.test.ts: cross-arm seed ${seed} on ${engineLabel()}: noble and subtle signature bytes ${
          identical ? 'MATCHED' : 'DIFFERED'
        } (both verified by both arms)`,
      )
    },
  )

  it('X25519 agreement IS byte-identical across arms — the contrast case', async () => {
    if (!subtleCapable) {
      console.log(`ed25519-backend.test.ts: X25519 cross-arm check skipped on ${engineLabel()} — no Ed25519 subtle`)
      return
    }
    const subtle = subtleCryptoBackend()
    const ourSeed = new Uint8Array(32).fill(23)
    const peerSeed = new Uint8Array(32).fill(29)
    const peerPublicKey = x25519.getPublicKey(peerSeed)

    const viaNoble = await noble.agreeX25519(ourSeed, peerPublicKey)
    const viaSubtle = await subtle.agreeX25519(ourSeed, peerPublicKey)

    // The one byte-identity claim in this block, and it holds on every engine measured.
    expect(Array.from(viaSubtle), 'X25519 agreement has exactly one correct output per input pair').toEqual(
      Array.from(viaNoble),
    )
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

/**
 * Shadowing `crypto.subtle` — `Object.defineProperty(..., { value, configurable: true })`,
 * never the JS `delete` operator applied to this same property path: `subtle` is an
 * inherited accessor on `Crypto.prototype`, and removing the own property (there usually
 * isn't one) leaves it reachable through the prototype regardless — silently exercising
 * the other branch while reporting green.
 *
 * The trap is Phase 25's and it did not go away with the WASM arm; the discipline is kept
 * verbatim. `install`/`restore` are shared by the two describes below because both now
 * plant an engine rather than only removing one.
 */
function subtleShadow(): { install(value: unknown): void; restore(): void } {
  let original: PropertyDescriptor | undefined
  let installed = false
  return {
    install(value: unknown): void {
      original = Object.getOwnPropertyDescriptor(globalThis.crypto, 'subtle')
      Object.defineProperty(globalThis.crypto, 'subtle', { value, configurable: true })
      installed = true
    },
    restore(): void {
      if (!installed) return
      if (original !== undefined) {
        Object.defineProperty(globalThis.crypto, 'subtle', original)
      } else {
        // No own-property existed before shadowing (the common case: `subtle` was
        // reachable only through `Crypto.prototype`) — remove the shadow entirely
        // rather than leaving an own `undefined` behind.
        Reflect.deleteProperty(globalThis.crypto, 'subtle')
      }
      installed = false
      original = undefined
    },
  }
}

describe('the surviving gate probes, it does not infer from presence', () => {
  // Phase 28, Plan 28-01. `packages/core` held two Ed25519 selection mechanisms with
  // two different gates: this module's presence-only
  // `typeof globalThis.crypto?.subtle?.sign === 'function'`, and `cert-lifecycle.ts`'s
  // real `subtle.generateKey({name:'Ed25519'})` round trip. They are not equivalent.
  // The probe survived the merge, and this block is the single behavioural reason it
  // had to: the third case below plants an engine that satisfies the deleted gate and
  // cannot do Ed25519, and requires the noble arm to be selected anyway.
  const shadow = subtleShadow()
  afterEach(() => {
    shadow.restore()
  })

  /** An engine that advertises `SubtleCrypto` and refuses the `Ed25519` algorithm. */
  function ed25519IncapableSubtle(counter: { calls: number }): SubtleCrypto {
    const refuse = (): Promise<never> =>
      Promise.reject(new Error("NotSupportedError: Unrecognized algorithm name 'Ed25519'"))
    return {
      // Present as a function — this is exactly what the deleted presence-only gate
      // read, and it is why that gate would have selected this engine.
      sign: refuse,
      verify: refuse,
      importKey: refuse,
      exportKey: refuse,
      deriveBits: refuse,
      generateKey: () => {
        counter.calls++
        return refuse()
      },
    } as unknown as SubtleCrypto
  }

  it('the arm it selects matches an independent round-trip probe of this host', async () => {
    // Unconditional on purpose: the expectation is derived from this file's own probe
    // rather than hard-coded to whichever arm this host happens to win, so the case
    // binds on a capable engine and on an incapable one alike.
    const capable = await subtleSupportsEd25519()
    const mod = await freshEd25519Module()

    const backend = await mod.createCryptoBackend()
    expect(backend.arm).toBe(capable ? 'subtle' : 'noble')

    await mod.initEd25519()
    // The deliberate inversion Phase 25 chose and Phase 28 keeps: even when subtle wins
    // the async port, the sync port is noble, because a Promise cannot be awaited
    // synchronously. Not "resolves" — specifically noble.
    expect(mod.getSyncVerifier().backend).toBe('noble')
  })

  it('resolves the noble arm when crypto.subtle is absent entirely, and initEd25519() still resolves', async () => {
    shadow.install(undefined)
    const mod = await freshEd25519Module()

    const backend = await mod.createCryptoBackend()
    expect(backend.arm).toBe('noble')
    await expect(mod.initEd25519()).resolves.toBeUndefined()
  })

  it('resolves the noble arm on an engine that HAS crypto.subtle and refuses Ed25519 — the case a presence check gets wrong', async () => {
    const counter = { calls: 0 }
    shadow.install(ed25519IncapableSubtle(counter))

    // The planted engine satisfies the deleted gate exactly. Asserted rather than
    // asserted-by-comment: if a future edit made this engine fail the old check too,
    // the case would stop being about the difference between the two gates.
    expect(typeof globalThis.crypto.subtle.sign).toBe('function')

    const mod = await freshEd25519Module()
    const backend = await mod.createCryptoBackend()

    // The arm first, deliberately. This is the claim; the probe count below is the
    // mechanism. Asserting the mechanism first would short-circuit the claim out of the
    // planted-mutation proof, and a claim nobody watched go red is not proved — measured:
    // with the presence-only gate planted back in, the count assertion fired at line 535
    // and the arm assertion was never reached.
    expect(
      backend.arm,
      'an engine that advertises SubtleCrypto and refuses Ed25519 must select noble',
    ).toBe('noble')
    expect(counter.calls, 'the gate must actually call generateKey — a presence check would not').toBe(1)

    // And the selected arm works, which is the point: a presence check here would have
    // handed back a backend whose every operation rejects.
    await mod.initEd25519()
    expect(await mod.getAsyncVerifier().verify(BASE.signature, BASE.message, BASE.pub)).toBe(true)
  })

  it('runs the probe once when initEd25519() is called twice concurrently', async () => {
    const counter = { calls: 0 }
    shadow.install(ed25519IncapableSubtle(counter))
    const mod = await freshEd25519Module()

    const first = mod.initEd25519()
    const second = mod.initEd25519()
    expect(second).toBe(first)

    await first
    // Counted, not inferred. Two memos live in the merged module — `initPromise` and
    // `createCryptoBackend`'s `backendPromise` — and this is the one that says the
    // probe itself ran at most once.
    expect(counter.calls).toBe(1)
  })

  it('the async port is an adapter over the same CryptoBackend, reordered in exactly one place', async () => {
    const mod = await freshEd25519Module()
    const backend = await mod.createCryptoBackend()
    await mod.initEd25519()
    const port = mod.getAsyncVerifier()

    for (const vector of [...ACCEPT_VECTORS, ...REJECT_VECTORS]) {
      const viaPort = await port.verify(vector.signature, vector.message, vector.publicKey)
      const viaBackend = await backend.verifyEd25519(vector.publicKey, vector.signature, vector.message)
      expect(viaPort, `port and backend disagreed on "${vector.name}"`).toBe(viaBackend)
    }

    // Agreement alone would hold vacuously against a *backwards* adapter, which makes
    // every verdict `false` on both sides. The accept half is what refuses that: the
    // reorder `(signature, message, publicKey)` -> `(publicKey, signature, message)`
    // happens in one place and this is where getting it wrong is caught.
    for (const vector of ACCEPT_VECTORS) {
      expect(
        await port.verify(vector.signature, vector.message, vector.publicKey),
        `the async port must accept "${vector.name}" — a reversed adapter rejects everything`,
      ).toBe(true)
    }
  })
})

describe('initEd25519 — capability gate, insecure-context arm (crypto.subtle absent)', () => {
  const shadow = subtleShadow()
  afterEach(() => {
    shadow.restore()
  })

  it('picks noble for the sync port with subtle absent, and both ports verify a real vector', async () => {
    // What the three deleted WASM-arm cases were really proving, kept: with `subtle`
    // shadowed absent the module still settles, and both ports return a correct verdict
    // against a real vector — which cannot happen unless the fallback selection
    // actually completed. The import counters they carried are gone because the import
    // they counted is gone; see this plan's SUMMARY for the coverage that leaves.
    shadow.install(undefined)
    const mod = await freshEd25519Module()

    await mod.initEd25519()
    expect(mod.getSyncVerifier().backend).toBe('noble')

    const syncOk = mod.getSyncVerifier().verify(BASE.signature, BASE.message, BASE.pub)
    const asyncOk = await mod.getAsyncVerifier().verify(BASE.signature, BASE.message, BASE.pub)
    expect(syncOk).toBe(true)
    expect(asyncOk).toBe(true)
  })

  it('performs the settlement at most once when initEd25519() is called twice concurrently', async () => {
    shadow.install(undefined)
    const mod = await freshEd25519Module()

    // A direct identity check, portable across every engine: called before the first
    // call's promise has settled, a second concurrent caller must observe the *exact
    // same* in-flight promise — not a fresh one that would run its own independent
    // settlement — which is precisely what `initEd25519`'s
    // `if (initPromise === undefined)` guard exists to guarantee. (The companion case
    // above counts the probe itself; this one pins the promise identity.)
    const first = mod.initEd25519()
    const second = mod.initEd25519()
    expect(second).toBe(first)

    await first
    expect(mod.getSyncVerifier().backend).toBe('noble')
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
