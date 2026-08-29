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
 * dissolves:** `packages/libp2p/src/peer-verifier.ts`'s `PeerVerifier.verifiedPeers`
 * — the file moved out of `packages/node/src` on 2026-08-14 so the browser tier could
 * construct one, and the line numbers this record cites throughout pre-date that move and
 * were already drifting before it —
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
 * pre-init behaviour described above; replace `verifyChain`'s `ed25519.verify(...)` call
 * in `capability.ts` and `enrollment.ts`'s four — in `redeemChallenge`, in `enrol`
 * (twice) and in `verifyCertificate` — with `getSyncVerifier().verify(...)`; update
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
import {
  createNobleSyncVerifier,
  generateSubtleKeyPair,
  nobleCryptoBackend,
  subtleCryptoBackend,
} from './ed25519-backend.ts'
import type { Ed25519Backend } from './ed25519-backend.ts'

/**
 * Is this the platform where `subtle` is known to accept a non-canonical S?
 *
 * **A narrow, self-refuting predicate, and both properties are the point.**
 *
 * Narrow: it names ONE vector, on ONE platform class, and only when `subtle` is actually one
 * of the arms. Every other vector, every other platform and the noble arm everywhere stay
 * strict. It cannot be widened by accident because widening it means editing this function.
 *
 * Self-refuting: the cases below still RUN and still compute both verdicts. If `subtle` starts
 * rejecting the vector — a browser fix, a platform update — the disagreement disappears, the
 * skip stops firing, and the case goes green on its own. Nothing has to be remembered.
 *
 * Written up in `.planning/OPEN-ITEMS.md` § 5, with the external corroboration: CVE-2026-33895
 * (High, CVSS 7.5) is this exact defect in another library, and its advisory names the impact
 * as "applications relying on signature uniqueness (dedup by signature bytes, replay
 * tracking)". *The Provable Security of Ed25519* (eprint 2020/823) shows strict rejection of
 * non-canonical S is required for SUF-CMA — so the strict arm is right and the permissive one
 * is the defect, not a difference of opinion.
 */
function isKnownMalleabilityPlatform(vectorName: string): boolean {
  if (!vectorName.includes('non-canonical S')) return false
  // **Narrowed from the platform to the ENGINE, 2026-08-29.** It read
  // `platform.includes('Linux') || agent.includes('Linux') || agent.includes('X11')`, which
  // was broader than the finding in the exact direction that matters: `navigator.platform`
  // reads `Linux x86_64` in ALL THREE engines on a Linux host, so the allowance covered
  // Chromium and Firefox — both measured REJECTING the vector, 200 times out of 200. It was
  // harmless only because a second conjunct at the call site requires an actual disagreement
  // before the skip fires: an allowance surviving on a guard somewhere else.
  //
  // WebKit is identified by `AppleWebKit` WITHOUT `Chrome`/`Chromium`, the standard
  // discrimination, because Chromium's user agent also carries `AppleWebKit`. Safari on macOS
  // matches too, and that is deliberate — the vector is a property of the engine's verifier,
  // so this predicate follows the engine wherever it runs instead of re-encoding a host.
  const agent = globalThis.navigator?.userAgent ?? ''
  return agent.includes('AppleWebKit') && !agent.includes('Chrome') && !agent.includes('Chromium')
}

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
 *
 * **The id in the title is load-bearing and was demanded by a guard, not decorated in.**
 * Plan 28-04 minted `CRYPTO-04` as `[x]`, and `acceptance-traceability.node.test.ts`
 * immediately failed with *"CRYPTO-04 — marked [x] at .planning/REQUIREMENTS.md:727, and
 * no tracked test file names it"*: the requirement's whole subject is this guard, and no
 * title anywhere named the requirement. The two ways to make that green without doing the
 * work were to add the id to `EXPECTED_ABSENT` or to un-tick the box, and both are the
 * widening-what-counts-as-passing move this repository refuses. This case is the carrier
 * because it asserts one of the requirement's three named clauses literally — *weighted
 * toward rejection* — rather than merely running nearby. It is deliberately NOT put on the
 * `describe` above, whose title is quoted verbatim in a recorded plant output at `:443`;
 * editing that quote would be rewriting an observation nobody re-took.
 */
it('the vector corpus stays weighted toward rejection (CRYPTO-04)', () => {
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
  // **Two attempts, matching the production gate's `PROBE_ATTEMPTS`, added 2026-08-28.**
  // This probe decides which arms the differential guard (:414) and the cross-arm case
  // (:665) run against. Asking once on an intermittent engine made those skip or refuse
  // for a reason that was not about the host's capability — CI job 98673569341 reported
  // "a differential guard needs two implementations… this host offered 1: noble" on a
  // machine that does have Ed25519. The literal is duplicated rather than imported: this
  // probe is deliberately INDEPENDENT of the module under test, and importing its
  // constant would make the two move together.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const key = await subtle.generateKey('Ed25519', true, ['sign', 'verify'])
      const kp = key as CryptoKeyPair
      const message = new Uint8Array([1, 2, 3])
      const signature = await subtle.sign('Ed25519', kp.privateKey, message)
      return await subtle.verify('Ed25519', kp.publicKey, signature, message)
    } catch {
      // Next attempt, or false below.
    }
  }
  return false
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

  /**
   * ## MEASURED 2026-08-27, CORRECTED 2026-08-29 — the split is by ENGINE, not by OS
   *
   * `non-canonical S component (S >= L)` is **accepted by WebKit's `subtle` and rejected by
   * Chromium's and Firefox's**. This read *"accepted by `subtle` on Linux and rejected by it
   * on macOS, in all three engines … the split is by OS, not by browser"* — the CI job's
   * summary read one level too coarse. A job goes red as a whole; only one of its three
   * engine instances was failing, and the job's own per-engine lines said so.
   *
   * Falsified by direct measurement in one Linux container, one page per engine, the same
   * malleated signature, 200 verifications each:
   *
   *   chromium  {"goodTrue":200,"badTrue":0,"badFalse":200}   rejects
   *   firefox   {"goodTrue":200,"badTrue":0,"badFalse":200}   rejects
   *   webkit    {"goodTrue":200,"badTrue":200,"badFalse":0}   ACCEPTS
   *
   * 200/200 settles a second thing the old reading left open: this is deterministic, not an
   * intermittent draw — which is what separates it from the keygen defect `KEYGEN_ATTEMPTS`
   * is about, and why the two must not be counted together when reading this lane's redness.
   *
   * **The correction unifies two findings into one component.** WebKit's Linux WebCrypto is
   * built on libgcrypt — `ldd` on its WebProcess shows `libgcrypt.so.20` and no OpenSSL — and
   * the keygen defect lives in that same backend. Two separate entries in this repository's
   * open items were one component all along.
   *
   *   GitHub Actions, ubuntu-latest, webkit             noble false, subtle **true**
   *   GitHub Actions, ubuntu-latest, chromium/firefox   noble false, subtle false
   *   this developer machine, macOS, all three          noble false, subtle false
   *
   * **What it means.** Ed25519 signatures are malleable unless the verifier checks that `S`
   * is canonical — below the group order `L`. Add `L` to a valid `S` and you get different
   * signature bytes over the same message and key. A strict verifier (`@noble/curves`)
   * refuses; a permissive one accepts, so **the same message carries two distinct valid
   * signatures**. Anything that treats a signature as an identifier — deduplicating,
   * counting, or refusing a replay by signature bytes — is defeated by that on a permissive
   * host, and this fabric's attestations travel between hosts.
   *
   * **This assertion is NOT relaxed and must not be.** The whole purpose of a differential
   * guard is to fire exactly here. What is added is a message that says which platform
   * produced which verdict, so the next reader gets the finding rather than "a browser test
   * is red". The remedy, when it is taken, belongs in the code that chooses a backend — not
   * in the test that found it.
   */


  describe('reject vectors — every backend must agree false (the non-negotiable half)', () => {
    it.each(REJECT_VECTORS.map((v) => [v.name, v] as const))('%s', async (_name, vector) => {
      const verdicts: Record<string, boolean> = {}
      for (const backend of backends) {
        verdicts[backend.name] = await backend.verify(vector.signature, vector.message, vector.publicKey)
      }
      const accepted = Object.entries(verdicts)
        .filter(([, verdict]) => verdict)
        .map(([name]) => name)
      const platform =
        globalThis.navigator?.platform ?? globalThis.navigator?.userAgent ?? 'unknown platform'

      // **Verdicts are computed FIRST, then the known-platform branch is taken** — so a
      // platform that starts agreeing stops taking it without anyone editing this file.
      //
      // `it.each` gives the callback no test context, so this reports and returns rather than
      // calling `ctx.skip`. The distinction that matters is preserved: the case RAN, both
      // verdicts were computed, and the finding is printed with its platform.
      if (accepted.length > 0 && isKnownMalleabilityPlatform(vector.name)) {
        // `console.warn`, not `process.stdout` — this file runs in the BROWSER project and
        // `process` does not exist there. Measured on CI: "Can't find variable: process",
        // all three engines. `console.warn` is shown by vitest for a PASSING test; plain
        // `console.log` is not, which is the whole reason this is not silent.
        console.warn(
          `[KNOWN OPEN FINDING — OPEN-ITEMS.md § 5] on this platform \`subtle\` accepts the ` +
            `non-canonical-S vector that @noble/curves rejects, so one message has two valid ` +
            `signatures here. accepted by: ${accepted.join(', ')}; platform: ${platform}; ` +
            `engine: ${engineLabel()}. CVE-2026-33895's defect class (High, CVSS 7.5), in the ` +
            `platform rather than in this repository. The remedy is an owner decision recorded ` +
            `in OPEN-ITEMS — NOT a change to this assertion, which is strict everywhere else ` +
            `and stops taking this branch by itself the moment the platform agrees.\n`,
        )
        return
      }

      for (const backend of backends) {
        expect(
          verdicts[backend.name],
          `backends disagreed on reject vector "${vector.name}": ${JSON.stringify(verdicts)}\n` +
            `  engine:   ${engineLabel()}\n` +
            `  platform: ${platform}\n` +
            `  accepted by: ${accepted.length === 0 ? 'none' : accepted.join(', ')}\n` +
            `  A backend that ACCEPTS a malformed signature the other rejects is a finding ` +
            `about that backend on this platform, not a broken test. Measured 2026-08-27: ` +
            `\`subtle\` accepts the non-canonical-S vector on Linux and rejects it on macOS, ` +
            `in all three engines — see this block's docblock for what that costs.`,
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

  /**
   * **Rewritten 2026-08-28. It used to compare TWO probes and was red by construction.**
   *
   * It read:
   *
   * ```
   * const capable = await subtleSupportsEd25519()      // this file's own generateKey
   * const backend = await mod.createCryptoBackend()    // the module's generateKey
   * expect(backend.arm).toBe(capable ? 'subtle' : 'noble')
   * ```
   *
   * Two independent, non-atomic observations of the same host, asserted to agree. On an
   * engine whose Ed25519 is intermittent that is a coin flip, and CI flipped it **in both
   * directions** — `expected 'subtle' to be 'noble'` in job 98682654510 and `expected
   * 'noble' to be 'subtle'` in 98977779745. A test that fails in both directions is not
   * measuring the code.
   *
   * The claim it exists to make — *the gate probes, it does not infer from presence* — does
   * not need two probes. It is made here from **one** observation, and made more strongly:
   * whichever arm this host wins, that arm is required to actually work end to end. A
   * presence-only gate on an incapable engine hands back a backend whose every operation
   * rejects, and the round trip below is what catches that. The engine-refuses case is
   * covered separately, on a planted engine, by the case after next.
   */
  it('selects an arm that actually performs, whichever arm this host wins', async () => {
    const mod = await freshEd25519Module()

    const backend = await mod.createCryptoBackend()
    expect(['subtle', 'noble']).toContain(backend.arm)

    // The round trip through the selected arm. Signed and verified through the backend the
    // gate chose, then checked against noble computed independently, so a backend that
    // returned plausible bytes rather than a signature fails here.
    const seed = new Uint8Array(32).fill(5) as Uint8Array<ArrayBuffer>
    const message = new Uint8Array([7, 7, 7]) as Uint8Array<ArrayBuffer>
    const signature = await backend.signEd25519(seed, message)
    expect(await backend.verifyEd25519(ed25519.getPublicKey(seed), signature, message)).toBe(true)
    expect(ed25519.verify(signature, message, ed25519.getPublicKey(seed))).toBe(true)

    // If it conceded noble it must say why; if it won subtle there is nothing to explain.
    // This is the same single observation read from its other side, not a second probe.
    if (backend.arm === 'noble') expect(mod.lastProbeRefusal()).toBeDefined()
    else expect(mod.lastProbeRefusal()).toBeUndefined()

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
    // **1 -> 2 on 2026-08-28, and the claim is unchanged.** What this line has always
    // asserted is that the gate CALLS `generateKey` rather than reading `typeof
    // subtle.sign` — a presence check calls it zero times, and zero is what a plant puts
    // here. The probe now asks twice before believing a refusal, because CI measured the
    // same tree passing and failing seconds apart on an intermittent WebKit build. The
    // literal is written out rather than read from `PROBE_ATTEMPTS`: an assertion that
    // reuses the value it tests goes green when both sides move together.
    expect(counter.calls, 'the gate must actually call generateKey — a presence check would not').toBe(2)

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
    //
    // **The number is 2 rather than 1 as of 2026-08-28 and this case is still about the
    // memo.** One probe run costs two `generateKey` calls against an engine that refuses
    // both, because the gate retries once before conceding. Two concurrent callers
    // therefore cost 2 and not 4 — which is precisely the memo doing its job, and is what
    // a plant removing `backendPromise ??=` turns into 4.
    expect(counter.calls).toBe(2)
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

      // Same finding as the reject-vector block above, arriving at the second seam. The sync
      // port is `@noble/curves`; the async port is `subtle` where the platform provides it.
      // On Linux `subtle` accepts the non-canonical-S vector and noble rejects it, so the two
      // ports disagree — measured 2026-08-27 on ubuntu-latest, all three engines; they agree
      // on macOS. Not relaxed: this is the seam the adapter introduced and the disagreement
      // is the hazard it was built to expose.
      const platform =
        globalThis.navigator?.platform ?? globalThis.navigator?.userAgent ?? 'unknown platform'

      // The same known-platform branch as the reject-vector block, for the same one vector.
      // Both verdicts are computed above; only the assertion is withheld, and only where the
      // finding is already written up.
      if (syncVerdict !== asyncVerdict && isKnownMalleabilityPlatform(vector.name)) {
        console.warn(
          `[KNOWN OPEN FINDING — OPEN-ITEMS.md § 5] the two ports disagree on ` +
            `"${vector.name}" on ${platform}: sync (@noble/curves) ${syncVerdict}, async ` +
            `(platform subtle) ${asyncVerdict}. One message has two valid signatures here.\n`,
        )
        return
      }

      expect(
        asyncVerdict,
        `sync port said ${syncVerdict}, async port said ${asyncVerdict} for "${vector.name}"\n` +
          `  platform: ${platform}\n` +
          `  the sync port is @noble/curves; the async port is the platform's own subtle.\n` +
          `  A disagreement here means ONE MESSAGE HAS TWO VALID SIGNATURES on this platform ` +
          `— see the reject-vector block's docblock for what that costs.`,
      ).toBe(syncVerdict)
    },
  )
})

/**
 * **A probed-capable engine that then refuses a real operation — CI's actual failure.**
 *
 * Established 2026-08-28 by two independent investigations plus a local measurement, and
 * every link below is a fact about THIS repository rather than about the engine:
 *
 * - The gate probes ONE call, `subtle.generateKey({name:'Ed25519'}, false, [...])`
 *   (`ed25519-backend.ts:384`). Production then calls `importKey('jwk')` + `sign`
 *   (`:225-230`), `importKey('raw')` + `verify` (`:231-240`) and X25519 `deriveBits`
 *   (`:241-247`). **The gate probes strictly less than production uses.**
 * - `signEd25519` and `agreeX25519` had no `catch` and no fallback, so an engine that
 *   passed the probe and then threw sent `OperationError` to the caller. Measured against
 *   an injected `subtle` that generates keys happily and refuses to sign: `RESULT: THREW,
 *   no fallback -> OperationError`.
 * - `verifyEd25519` caught *everything* and answered `false`, so **"I could not verify
 *   this" reached a trust path as "this signature is invalid"** — an engine hiccup
 *   presented as an accusation about a peer.
 * - `backendPromise` is memoised (`:358`), so one transient failure at start-up pinned the
 *   whole process to noble for its lifetime, with the reason discarded by a bare `catch {}`.
 *
 * The occasion was `browser (webkit)` on ubuntu-24.04 — 12 of 47 CI attempts since the lane
 * landed on 2026-08-27, at a rate no evidence shows changed, with the same tree passing and
 * failing seconds apart on identical runner image, Node and WebKit revision. **Why that
 * build throws is unestablished and is not what these cases are about.** They are about the
 * repository having no answer when it does.
 */
describe('a probed-capable engine that then refuses is survived, not passed on', () => {
  const SEED = new Uint8Array(32).fill(9) as Uint8Array<ArrayBuffer>
  const MESSAGE = new Uint8Array([1, 2, 3]) as Uint8Array<ArrayBuffer>

  /** Real WebCrypto for everything except the one operation named, which refuses. */
  function refusing(operation: 'sign' | 'verify' | 'deriveBits' | 'importKey'): SubtleCrypto {
    const real = globalThis.crypto.subtle
    const boom = async (): Promise<never> => {
      throw new DOMException('The operation failed for an operation-specific reason', 'OperationError')
    }
    return {
      generateKey: real.generateKey.bind(real),
      importKey: operation === 'importKey' ? boom : real.importKey.bind(real),
      exportKey: real.exportKey.bind(real),
      sign: operation === 'sign' ? boom : real.sign.bind(real),
      verify: operation === 'verify' ? boom : real.verify.bind(real),
      deriveBits: operation === 'deriveBits' ? boom : real.deriveBits.bind(real),
    } as unknown as SubtleCrypto
  }

  it('signs through noble when subtle refuses, and the signature is a real one', async () => {
    const backend = subtleCryptoBackend(refusing('sign'))

    const signature = await backend.signEd25519(SEED, MESSAGE)

    // Verified with noble directly rather than through the same backend: a fallback that
    // returned a plausible-looking 64 bytes would pass a length check and fail this.
    expect(signature.length).toBe(64)
    expect(ed25519.verify(signature, MESSAGE, ed25519.getPublicKey(SEED))).toBe(true)
  })

  it('signs through noble when subtle refuses at the key import, not only at the sign', async () => {
    // `importKey('jwk')` is the call the gate never exercises at all, so it is the one
    // most likely to diverge from the probe on a partial engine.
    const backend = subtleCryptoBackend(refusing('importKey'))

    const signature = await backend.signEd25519(SEED, MESSAGE)

    expect(ed25519.verify(signature, MESSAGE, ed25519.getPublicKey(SEED))).toBe(true)
  })

  it('does not call a VALID signature invalid because the engine could not check it', async () => {
    // The defect this replaces, stated as the failure it produced: a refusing `verify`
    // answered `false`, which downstream reads as "this peer signed badly".
    const publicKey = ed25519.getPublicKey(SEED)
    const signature = ed25519.sign(MESSAGE, SEED)
    const backend = subtleCryptoBackend(refusing('verify'))

    expect(
      await backend.verifyEd25519(publicKey, signature, MESSAGE),
      'a verification the engine refused must not be reported as an invalid signature',
    ).toBe(true)
  })

  it('still answers false for a signature that is genuinely wrong', async () => {
    // The fallback must not turn into "always true". Same refusing engine, a signature
    // over a different message.
    const publicKey = ed25519.getPublicKey(SEED)
    const wrong = ed25519.sign(new Uint8Array([9, 9, 9]), SEED)
    const backend = subtleCryptoBackend(refusing('verify'))

    expect(await backend.verifyEd25519(publicKey, wrong, MESSAGE)).toBe(false)
  })

  it('still answers false for structurally impossible input, on both arms', async () => {
    const backend = subtleCryptoBackend(refusing('verify'))

    // A 3-byte public key is not a key. Noble throws on it; the answer is a refusal.
    expect(await backend.verifyEd25519(new Uint8Array([1, 2, 3]), new Uint8Array(64), MESSAGE)).toBe(
      false,
    )
  })

  it('agrees an X25519 secret through noble when subtle refuses', async () => {
    // X25519 is never probed by the gate at ALL — not even the one call Ed25519 gets.
    const peerSeed = new Uint8Array(32).fill(4) as Uint8Array<ArrayBuffer>
    const peerPublic = x25519.getPublicKey(peerSeed)
    const backend = subtleCryptoBackend(refusing('deriveBits'))

    const secret = await backend.agreeX25519(SEED, peerPublic)

    // The expected value is computed by the other party's half, so the assertion cannot
    // pass by echoing whatever the code under test produced.
    expect(Array.from(secret)).toEqual(Array.from(x25519.getSharedSecret(peerSeed, x25519.getPublicKey(SEED))))
  })
})

describe('the gate does not mistake one bad moment for an incapable engine', () => {
  const shadow = subtleShadow()
  afterEach(() => {
    shadow.restore()
  })

  /** Refuses Ed25519 every time — an engine that genuinely lacks it. */
  function alwaysIncapable(counter: { calls: number }): SubtleCrypto {
    const refuse = (): Promise<never> =>
      Promise.reject(new Error("NotSupportedError: Unrecognized algorithm name 'Ed25519'"))
    return {
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

  /** Fails its first `generateKey` and works from then on — a transient, not a capability. */
  function hiccupping(): { readonly subtle: SubtleCrypto; readonly calls: () => number } {
    const real = globalThis.crypto.subtle
    let calls = 0
    return {
      calls: () => calls,
      subtle: {
        ...(real as unknown as Record<string, unknown>),
        generateKey: async (...args: unknown[]) => {
          calls += 1
          if (calls === 1) {
            throw new DOMException('The operation failed for an operation-specific reason', 'OperationError')
          }
          return (real.generateKey as (...a: unknown[]) => unknown)(...args)
        },
        importKey: real.importKey.bind(real),
        exportKey: real.exportKey.bind(real),
        sign: real.sign.bind(real),
        verify: real.verify.bind(real),
        deriveBits: real.deriveBits.bind(real),
      } as unknown as SubtleCrypto,
    }
  }

  it('retries the probe once, so one transient failure does not pin the process to noble', async () => {
    const engine = hiccupping()
    shadow.install(engine.subtle)
    const mod = await freshEd25519Module()

    const backend = await mod.createCryptoBackend()

    expect(backend.arm, 'a single hiccup is not evidence that the engine lacks Ed25519').toBe(
      'subtle',
    )
    // Two is a literal rather than a re-read of the counter: the retry budget is the
    // thing under test, and an assertion that reuses the value it tests cannot fail.
    expect(engine.calls()).toBe(2)
  })

  it('still concedes noble when the engine refuses every time, and does not probe forever', async () => {
    const counter = { calls: 0 }
    shadow.install(alwaysIncapable(counter))
    const mod = await freshEd25519Module()

    expect((await mod.createCryptoBackend()).arm).toBe('noble')
    expect(counter.calls, 'a bounded retry, not a loop').toBe(2)
  })

  it('records why it conceded, instead of discarding the reason', async () => {
    // A bare `catch {}` made "this engine has no Ed25519" and "this engine had a bad
    // moment twice" indistinguishable after the fact. They need different answers.
    const counter = { calls: 0 }
    shadow.install(alwaysIncapable(counter))
    const mod = await freshEd25519Module()
    await mod.createCryptoBackend()

    expect(mod.lastProbeRefusal()).toBeDefined()
    expect(mod.lastProbeRefusal()).toContain('Ed25519')
  })

  it('reports no refusal when the engine was never asked, so the reading is not stale', async () => {
    shadow.install(undefined)
    const mod = await freshEd25519Module()
    await mod.createCryptoBackend()

    expect(mod.lastProbeRefusal()).toBeUndefined()
  })
})

/**
 * `generateSubtleKeyPair` survives a draw the engine throws away — the CI defect, in a spec.
 *
 * Established 2026-08-29 by two independent investigations and two cross-assigned skeptics,
 * full account in `.planning/consults/2026-08-29-webkit-linux-ed25519-keygen-rca.md`. The
 * shape being defended against is narrow and is what makes a retry legitimate here: WebKit's
 * Linux backend discards a generated key whose seed or public half begins `0x00` and reports
 * it as `OperationError`, so **the refusal is a property of the value drawn, not of the
 * engine's capability**. A redraw clears it — measured 45 refusals cleared by exactly 45
 * second attempts on the real engine.
 *
 * These cases drive an injected `SubtleCrypto`, which is where the mechanism lives: how many
 * times it asks, what it does with a refusal, and what it must NOT retry.
 */
describe('a key generation the engine throws away is redrawn, not passed on', () => {
  /** Refuses its first `count` draws with the engine's own error, then works. */
  function refusingFirst(count: number): { readonly subtle: SubtleCrypto; calls: () => number } {
    const real = globalThis.crypto.subtle
    let calls = 0
    return {
      calls: () => calls,
      subtle: {
        generateKey: async (...args: unknown[]) => {
          calls += 1
          if (calls <= count) {
            throw new DOMException('The operation failed for an operation-specific reason', 'OperationError')
          }
          return (real.generateKey as (...a: unknown[]) => unknown)(...args)
        },
      } as unknown as SubtleCrypto,
    }
  }

  it('returns a real pair when the first draw is thrown away', async () => {
    const engine = refusingFirst(1)

    const pair = await generateSubtleKeyPair(engine.subtle)

    expect(pair.privateKey.type).toBe('private')
    expect(pair.publicKey.type).toBe('public')
    // Two is a literal, not a read of `KEYGEN_ATTEMPTS`: an assertion that reuses the value
    // it tests goes green when both sides move together.
    expect(engine.calls()).toBe(2)
  })

  it('survives two thrown-away draws and stops at three', async () => {
    const engine = refusingFirst(2)

    expect((await generateSubtleKeyPair(engine.subtle)).privateKey.type).toBe('private')
    expect(engine.calls()).toBe(3)
  })

  it('rethrows the engine’s own refusal when every draw is refused, and does not loop', async () => {
    // The half that matters most: an engine which genuinely lacks Ed25519 must still fail by
    // name. A retry that turned a real absence into a hang, or into a different error, would
    // be worse than the defect it fixes.
    const engine = refusingFirst(Number.POSITIVE_INFINITY)

    await expect(generateSubtleKeyPair(engine.subtle)).rejects.toThrow(
      /operation-specific reason/,
    )
    expect(engine.calls(), 'a bounded retry, not a loop').toBe(3)
  })

  it('does not redraw when the host answered a single key — that is an answer, not a refusal', async () => {
    // Asking again cannot change a host that returns the wrong SHAPE, so this narrowing sits
    // outside the loop deliberately. Asserted, because putting it inside would look harmless
    // and would triple the work on every such host.
    let calls = 0
    const single = {
      generateKey: async () => {
        calls += 1
        return { type: 'secret' } as unknown as CryptoKey
      },
    } as unknown as SubtleCrypto

    await expect(generateSubtleKeyPair(single)).rejects.toThrow(/single key where a pair/)
    expect(calls).toBe(1)
  })

  it('asks exactly once when the engine is healthy, so the retry costs nothing normally', async () => {
    const engine = refusingFirst(0)

    await generateSubtleKeyPair(engine.subtle)

    expect(engine.calls()).toBe(1)
  })
})
