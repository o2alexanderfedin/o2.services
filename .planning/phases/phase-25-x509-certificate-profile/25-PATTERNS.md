# Phase 25: X.509 Certificate Profile - Pattern Map

**Mapped:** 2026-08-09
**Files analyzed:** 5 (2 new, 1 new test, 1 new e2e/guard, 2 modified — see below)
**Analogs found:** 5 / 5

All file:line citations below were re-verified against the current tree this session
(2026-08-09). Every citation in CONTEXT.md and RESEARCH.md checked out exactly —
`capability.ts:127` (`MAX_CHAIN_DEPTH` declaration), `capability.ts:190` (its
enforcement), `capability.ts:255` (the `reduce` fix), `enrollment.ts:158`
(`NodeCertificate`), `enrollment.ts:179` (`payloadOf`) all match the real line numbers.
No stale citation found in this pass.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `packages/core/src/x509.ts` (new; path is Claude's discretion, this is the named candidate) | utility / decoder (pure module, no platform imports) | transform (bytes → typed structure, refuse-or-accept) | `packages/core/src/capability.ts` | role-match (bound-check-before-work, typed-union refusal) |
| `packages/core/src/x509.test.ts` (new) | test (unit) | transform / refusal | `packages/core/src/capability.test.ts` (esp. lines 202-278, the `MAX_CHAIN_DEPTH` block) | exact (same package, same tier, same "one refusal, one named test" discipline) |
| bundle-cost guard (new; likely `packages/node/src/x509-bundle.e2e.test.ts` or similar, alongside `built-bundle.e2e.test.ts`) | test (e2e, build-artifact measurement) | batch (build once, measure, assert delta) | `packages/node/src/built-bundle.e2e.test.ts` | role-match (only existing "measure the real `dist/` output" precedent in the repo; no prior bundle-*size* guard exists — see "No Analog Found" below for the size-measurement half) |
| `.planning/REQUIREMENTS.md` (modified — new `X509-01…07` block) | config / requirements ledger | CRUD (append rows to an existing table) | Existing `### Authorization & Node Identity` block, `AUTH-01`/`AUTH-05` rows (`REQUIREMENTS.md:266-277`) | exact (same file, same section, same row shape) |
| `packages/core/src/enrollment.ts` (possibly modified — additive only, per CONTEXT.md: X.509 coexists behind a version tag, does not replace `NodeCertificate`) | model / service (issuance + verification) | CRUD (sign/verify) | itself — the file already defines the shape (`NodeCertificate`, `payloadOf`, `verifyCertificate`) that any additive X.509 envelope sits beside | n/a — self-analog |

Also touched, per `verifyChain`/`verifyCertificate` async-backend note in CONTEXT.md
(owner ruling 2026-08-09, `crypto.subtle` / libsodium): `packages/core/src/capability.ts`
(`verifyChain`'s signature becomes async) — **flagged as a cost the planner must price,
not a file this pattern map treats as separately patterned**; its analog is itself
(no other async-signature-migration precedent was found in `@o2/core`, which is
documented as a pure/sync module family by design in both files' headers).

## Pattern Assignments

### `packages/core/src/x509.ts` (decoder, transform)

**Analog:** `packages/core/src/capability.ts`

**Pure-module framing** (`capability.ts:1-25`, docblock) — copy the shape, not the words:
opens by stating what the module refuses and how loudly, states it is a "pure module" at
the end. `enrollment.ts:1-111`'s docblock is the longer sibling of the same convention —
worth the same treatment (state what's proved, cite the obligation IDs, end with the
"pure module" line, e.g. `enrollment.ts:107-110`).

**Bound-checked-before-expensive-work pattern** (`capability.ts:101-127` doc +
`capability.ts:186-192` enforcement) — this is the pattern Obligations 4 and 6's byte
ceilings must copy exactly:

```typescript
// capability.ts:186-192
if (chain.length === 0) return fail({ kind: 'empty-chain' })

// Before any signature work: the length is attacker-supplied, and this is the cheapest
// possible refusal. See MAX_CHAIN_DEPTH for why the bound exists and how it was sited.
if (chain.length > MAX_CHAIN_DEPTH) {
  return fail({ kind: 'too-deep', depth: chain.length, limit: MAX_CHAIN_DEPTH })
}
```

The docblock above the constant (`capability.ts:101-127`) is itself the pattern to copy
for `MAX_CERTIFICATE_BYTES`/`MAX_EXTENSION_BYTES`/`MAX_EXTENSION_COUNT`: state the constant
is "sited, not picked", name the actual measured basis (§4 of RESEARCH.md gives the worked
1612-byte total and the 2.5×/1.9×/2× headroom multiples — cite those numbers verbatim in
the new constants' docblocks, not just "some headroom"), and if two controls interact
(here: the depth bound made a `reduce`-not-spread hazard unreachable — see below), say so
explicitly rather than leaving the second control unexplained.

**Typed discriminated-union refusal shape** (`capability.ts:89-99`):

```typescript
export type ChainFailure =
  | { readonly kind: 'empty-chain' }
  | { readonly kind: 'wrong-root'; readonly index: number; readonly expected: PublicKeyHex; readonly found: PublicKeyHex }
  ...
  | { readonly kind: 'too-deep'; readonly depth: number; readonly limit: number }
```

`x509.ts`'s refusal union should be built the same way — one `kind` literal per named
obligation (`X509-01` unrecognised-algorithm, `X509-02` named-ban, `X509-03`
non-canonical, `X509-04` too-large, `X509-06` extension-too-large / too-many-extensions,
`X509-07` duplicate-extension), each carrying exactly the fields a reader needs to point
at the break — no thrown errors, matching `capability.ts`'s `ChainResult`/`fail()` helper
shape at `capability.ts:155-184`:

```typescript
// capability.ts:179-184
export function verifyChain(chain: readonly Delegation[], options: VerifyOptions): ChainResult {
  const fail = (failure: ChainFailure): ChainResult => ({
    ok: false,
    failure,
    reason: describeFailure(failure),
  })
```

**`describeFailure`-style human-readable mapper** (`capability.ts:129-153`) — a
`switch` over the union's `kind`, one line per case, naming the offending index/value.
Copy this shape for the X.509 refusal union too; it is what the planted-mutation tests
assert against (`result.reason`).

**try/catch-around-crypto-only pattern** (`capability.ts:216-223`, also
`enrollment.ts:867-877`): signature verification is the only thing wrapped in
`try {} catch { valid = false }`; everything that can throw for a *structural* reason
(here: `payloadOf`'s `NotEncodableError`) is built **above** the `try`, deliberately, so
a codec defect is never misreported as the caller's fault. The DER decoder's analogous
boundary is: bounds/structure checks (never throw, always return a refusal) vs.
`ed25519.verify` (wrapped, since a malformed key/signature can throw from the library).

### `packages/core/src/x509.test.ts` (unit test, refusal-per-obligation)

**Analog:** `packages/core/src/capability.test.ts`, lines 1-49 (setup) and 202-278
(the `MAX_CHAIN_DEPTH` block — the single closest existing example of "one bound, sited,
with a three-part proof: at-the-bound accepted, one-past-the-bound refused by name,
and a stress case proving the *right* refusal fires first").

**Imports/setup pattern** (`capability.test.ts:1-25`):

```typescript
import { ed25519 } from '@noble/curves/ed25519.js'
import { describe, expect, it } from 'vitest'
import { MAX_CHAIN_DEPTH, delegate, toHex, verifyChain } from './capability.ts'
import type { Delegation } from './capability.ts'

/**
 * AUTH-03 — a task without a valid chain is refused, and the refusal names the link.
 *
 * Deterministic keys: seeded rather than random, so a failure is reproducible and a
 * reader can tell which principal is which from the test alone.
 */
function keypair(seed: number): { priv: Uint8Array; pub: string } {
  const priv = new Uint8Array(32).fill(seed)
  return { priv, pub: toHex(ed25519.getPublicKey(priv)) }
}
```

`x509.test.ts` should follow the same shape: deterministic fixture builders (a "build one
minimal valid certificate" helper analogous to `directChain()`/`delegatedChain()` at
`capability.test.ts:27-41`), then one `describe` block per obligation.

**The three-part bound proof** (`capability.test.ts:238-252`), copy verbatim in structure
for every byte ceiling (`MAX_CERTIFICATE_BYTES`, `MAX_EXTENSION_BYTES`,
`MAX_EXTENSION_COUNT`):

```typescript
// capability.test.ts:238-252
describe('chain depth is bounded', () => {
  it('accepts a chain exactly at the bound', () => {
    // The other half of the bound, and the half that makes it a bound rather than a ban.
    // Without this, narrowing MAX_CHAIN_DEPTH to 1 would leave the suite green.
    const result = verifyChain(chainOfDepth(MAX_CHAIN_DEPTH), opts)
    expect(result.ok, result.ok ? '' : result.reason).toBe(true)
  })

  it('refuses a chain one link past the bound, naming the depth and the limit', () => {
    const result = verifyChain(chainOfDepth(MAX_CHAIN_DEPTH + 1), opts)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.failure.kind).toBe('too-deep')
    expect(result.reason).toContain(String(MAX_CHAIN_DEPTH))
  })
```

**The "planted mutation, watched red, recorded" style** — this repository's convention
(`CLAUDE.md` § Proofs) is satisfied in this file not by the literal phrase "watched red"
but by a comment recording the *actual pre-fix observed behavior*, which is the concrete
form the planner should reproduce for X509-03 (DER canonicalisation) and every other
refusal:

```typescript
// capability.test.ts:254-276
it('refuses a long chain instead of throwing on it', () => {
  // The defect this closes was not the unbounded loop — it was `Math.min(...chain.map())`
  // on the SUCCESS path. Spreading a wire-length array into a call blows the argument
  // stack: measured on this host, 100 000 elements is fine and 200 000 raises
  // `RangeError: Maximum call stack size exceeded`. ...
  const one = directChain()[0] as Delegation
  const forged: Delegation[] = new Array(250_000).fill(one)
  const result = verifyChain(forged, opts)
  expect(result.ok).toBe(false)
  if (result.ok) return
  // `too-deep` and NOT `broken-link`: the depth check must come before the loop. Measured
  // before the fix, this chain refused `broken-link` at link 1 — a correct refusal that
  // reached the right answer for a reason that does not generalise, since a chain forged
  // to be internally consistent walks the whole way.
  expect(result.failure.kind).toBe('too-deep')
})
```

For X509-03 specifically: the "plant" is a byte-level mutation of an otherwise-valid DER
certificate (per RESEARCH.md §2's five-row table — non-minimal length, padded `INTEGER`,
garbage `BIT STRING` unused bits, etc.), the "watch red" is asserting the decoder
refuses it (or the re-encode/compare mismatches), and the comment should record which
specific bytes were mutated and what the pre-decoder-existing behavior would have been
(accepted silently) — matching this file's practice of naming the *wrong* answer a naive
implementation would have given, not just the right one.

**Distinct-reason-per-failure-kind check** (`capability.test.ts:187-199`) — copy this
shape once, over all seven X509 refusal kinds, the same way `capability.test.ts` does it
over all nine `ChainFailure` kinds: assert `new Set(reasons).size === reasons.length`, so
a refusal that reads the same for two different obligations is caught structurally.

### Bundle-cost guard (new e2e test)

**Analog:** `packages/node/src/built-bundle.e2e.test.ts`

**What to copy — the build-then-serve-then-measure skeleton** (`built-bundle.e2e.test.ts:1-98`):

```typescript
// built-bundle.e2e.test.ts:46-54
beforeAll(async () => {
  workdir = await mkdtemp(join(tmpdir(), 'o2-dist-'))

  // Build here rather than assuming a previous build is current — the test must fail
  // when the *sources* break the bundle, not when someone forgot to rebuild.
  execFileSync('npx', ['vite', 'build', '--config', 'packages/browser/vite.config.ts'], {
    cwd: ROOT,
    stdio: 'pipe',
  })
```

```typescript
// built-bundle.e2e.test.ts:30-31
const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const DIST = join(ROOT, 'packages', 'browser', 'dist')
```

**What this analog does NOT cover, and the guard must add itself:** `built-bundle.e2e.test.ts`
never reads a file's byte size — every assertion in it drives a real `playwright` page and
checks behavior (network requests, DOM state, text content). The new guard's actual
measurement step (`node:fs.statSync` against `dist/assets/index-*.js`, globbed since Vite's
content hash changes the filename per build — RESEARCH.md §5 point 1) has **no existing
precedent to copy**; only the *build-a-real-bundle-first* half is patterned. Per
`CLAUDE.md` § Measurement, the assertion must be a **delta within one run** — build once,
locate the chunk via glob, `statSync` it, compare against the recorded pre-decoder
baseline constant (per RESEARCH.md §5's "store the number in source... matching the
Conventions rule 'never write a measured span you did not measure'") — not two separate
CI runs compared after the fact.

**Tier placement note:** `built-bundle.e2e.test.ts` lives in `packages/node/src/`
(not `packages/browser/`) despite measuring the browser bundle — Node is what runs
`execFileSync('npx', ['vite', 'build', ...])` and `playwright.chromium.launch()`. The
bundle-cost guard should follow the same placement: `packages/node/src/*.e2e.test.ts`,
not `packages/browser/src/`.

### `.planning/REQUIREMENTS.md` (X509-01…07 block)

**Analog:** the existing `### Authorization & Node Identity` section, `AUTH-01`/`AUTH-05`
rows (`REQUIREMENTS.md:266-277`):

```markdown
### Authorization & Node Identity

- [x] **AUTH-01**: A node's identity key is generated on-device and its public half
      is signed into a provider-issued certificate
- [ ] **AUTH-02**: A node verifies a peer's provider-signed certificate offline,
      with no live certificate authority
...
- [x] **AUTH-05**: Multiple node identity certificates chain to a single owner's
      user key, forming a discoverable replica set that the scheduler can target
```

New `X509-01`…`X509-07` rows should follow this exact shape (checkbox, bold ID, one-line
imperative-refusal statement) and can sit either as a new `### X.509 Certificate Profile`
subsection or appended under `### Authorization & Node Identity` — planner's discretion,
per CONTEXT.md. `X509-05` should be checked `[x]` immediately, citing
`capability.ts:127`/`:190`, matching how `AUTH-01`/`AUTH-05` above are already `[x]` with
their evidence recorded in the `## Traceability` table further down
(`REQUIREMENTS.md:699`, `:703` — copy that row's citation-and-evidence density for
`X509-05`'s traceability entry too).

## Shared Patterns

### Refusal-as-typed-union, never thrown

**Source:** `packages/core/src/capability.ts:89-99` (`ChainFailure`) and
`packages/core/src/enrollment.ts:838-842` (`CertificateFailure`) — the same shape twice
in the same package, confirming it is the house style rather than one file's choice.
**Apply to:** `x509.ts`'s entire refusal surface (all seven obligations).

### Bound checked before expensive work, with the ordering stated in a comment

**Source:** `packages/core/src/capability.ts:188-190` (the literal comment: *"Before any
signature work: the length is attacker-supplied, and this is the cheapest possible
refusal"*).
**Apply to:** `MAX_CERTIFICATE_BYTES`/`MAX_EXTENSION_BYTES`/`MAX_EXTENSION_COUNT` checks —
CONTEXT.md explicitly names this as the precedent obligations 4 and 6 must copy, "the
same reasoning `MAX_CHAIN_DEPTH` is checked before any signature work".

### `payloadOf`-style canonical-encoding seam, built above any `try`

**Source:** `packages/core/src/capability.ts:63-76` and `:216-223`;
`packages/core/src/enrollment.ts:179-193` and `:867-877`.
**Apply to:** wherever `x509.ts` needs to build re-encoded bytes for the DER
canonicalisation round-trip (Obligation 3) — build the candidate re-encoding above any
`try`, so a codec defect in the re-encoder itself is never misreported as "the input was
non-canonical".

### "Sited, not picked" constant docblocks

**Source:** `packages/core/src/capability.ts:101-127`, the full `MAX_CHAIN_DEPTH`
docblock — names the deepest real chain in the repo (2), the deepest shipped chain (1),
states the constant as an explicit multiple (4×/8×), and states what would go wrong if a
reader just raised the number without reading the second half of the comment (the
`reduce`-not-spread hazard).
**Apply to:** every new numeric ceiling in `x509.ts` — `MAX_CERTIFICATE_BYTES = 4096`,
`MAX_EXTENSION_BYTES = 2048`, `MAX_EXTENSION_COUNT = 8` — each docblock should cite the
worked byte total from RESEARCH.md §4 (≈1612 bytes) and the stated headroom multiple,
not just assert a round number.

### Build-then-measure-the-real-artifact (partial precedent)

**Source:** `packages/node/src/built-bundle.e2e.test.ts:46-54` (build step only — see
"No Analog Found" below for the size-measurement half, which has no precedent).
**Apply to:** the bundle-cost guard's `beforeAll`.

## No Analog Found

| File / concern | Role | Data Flow | Reason |
|---|---|---|---|
| Bundle **byte-size** assertion (as opposed to bundle **behavior** assertion) | test (e2e) | batch/measurement | Confirmed by RESEARCH.md §5: *"No existing test in this repository measures bundle size"* — grepped for `bundle`/`size`/`byte`/`statSync` across every `*.test.ts` this session, none found. `built-bundle.e2e.test.ts` is the closest available precedent for the *build* half only; the *measure-and-assert-a-delta* half must be built from the general `MAX_CHAIN_DEPTH`/`MAX_PARTIAL_BYTES` "measured ceiling, checked, tested" convention, not from a size-specific prior example |
| Hand-written DER/ASN.1 decoder (any prior parser of this shape) | utility/decoder | transform | No comparable byte-level TLV decoder exists anywhere in `@o2/core` today — `canonical/encode.ts` (dag-cbor) is the nearest sibling by *purpose* (deterministic byte encoding) but not by *technique* (it does not decode an externally-specified, adversarial wire format). Treat `capability.ts`'s refusal/bound patterns as the structural analog and RESEARCH.md §1-§2 as the byte-grammar source of truth |
| `crypto.subtle`/libsodium dual-backend with lazy `import()` behind a capability check | service (crypto backend selection) | request-response (async) | No existing lazy-`import()`-behind-a-runtime-capability-check pattern was found in `@o2/core` or `@o2/browser` in this pass — `@o2/core` is documented pure/no-platform-imports in both `capability.ts` and `enrollment.ts` headers, so a capability-gated dynamic import is a new shape for this package. Flagged for the planner rather than force-fit to a mismatched analog; searching `@o2/browser`/`@o2/net` for an existing `globalThis.crypto?.subtle` feature-detection precedent is worth a follow-up grep before the planner treats this as unpatterned |

## Metadata

**Analog search scope:** `packages/core/src/` (primary), `packages/node/src/` (e2e/build
patterns), `.planning/REQUIREMENTS.md` (requirement-block shape). Stopped at 4 strong
analogs (`capability.ts`, `capability.test.ts`, `enrollment.ts`, `built-bundle.e2e.test.ts`)
plus the REQUIREMENTS.md section itself, per the "stop at 3-5" guidance — a wider sweep of
`packages/node/src/*.node.test.ts` for other "planted mutation" examples
(`trust-anchors.node.test.ts`, `orphan-leash.node.test.ts`, `reachability.node.test.ts`)
was performed but none beat `capability.test.ts` as the closest match: those three are in
`@o2/node`, at a different tier, testing different subjects (build-script/reachability
tooling, not a pure `@o2/core` decoder).
**Files scanned:** `capability.ts`, `capability.test.ts`, `enrollment.ts`,
`enrollment.test.ts` (grepped), `built-bundle.e2e.test.ts`, `REQUIREMENTS.md`,
`packages/core/src/index.ts` (barrel export convention).
**Pattern extraction date:** 2026-08-09
