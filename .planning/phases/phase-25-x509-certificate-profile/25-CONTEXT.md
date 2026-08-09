# Phase 25: X.509 Certificate Profile - Context

**Gathered:** 2026-08-09
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous), 3 areas, all accepted as proposed

<domain>
## Phase Boundary

The certificate envelope becomes X.509 v3 carrying a cryptographic profile that is
**load-bearing rather than advisory** — a set of precise refusals, each guarded by a test
that has been watched red.

Seven obligations were named by the owner ruling of 2026-08-06 (re-confirmed 2026-08-07).
**Obligation 5 is already delivered**: `MAX_CHAIN_DEPTH = 8` at
`packages/core/src/capability.ts:127`, enforced at `:190` before any signature work, with
its companion `reduce`-not-spread hazard closed at `:255`. This phase delivers the other
six and records the fifth with its evidence rather than re-implementing it.

**In scope:** the DER decoder, the profile's refusals, the requirement family that traces
them, and the measured bundle cost.
**Out of scope:** RFC-0003 §2's optional external CA. The ruling's own analysis notes §2
and §4 pull against each other — a standard validator rejects chains carrying critical
unknown extensions — and nothing in this phase attempts to reconcile them.
</domain>

<decisions>
## Implementation Decisions

### The parser, and where it is allowed to run

- **A bounded, hand-written DER decoder covering exactly this profile.** Not `pkijs`,
  not `asn1js`, not `@peculiar/x509`. Adopting X.509 *the format* does not oblige
  adopting a general parser, and the ruling names the hazard precisely: a few hundred KB
  of *"exactly the code that generates CVE classes, at the one boundary that must fail
  closed"*. A decoder that accepts one profile and refuses everything else is smaller
  than a decoder that accepts all of X.509 and is then constrained.
- **It runs in the browser tab, but off the execution path.** Certificate verification
  happens at admission and discovery, never per dispatched task. Keeping the parser out
  of the per-task path is one of the two costs the ruling says this phase owes a number for.
- **Bundle cost is guarded, not merely reported.** A measured ceiling with a test that
  fails when exceeded. The ruling: cost is *"a number this phase owes, not a caveat it
  may inherit."*
- **Coexists with the current envelope behind a version tag; X.509 is additive.** The
  Ed25519-over-canonical-dag-cbor `NodeCertificate` (`enrollment.ts:158`) keeps working.
  A hard replace would break every issued certificate and enrollment itself, for no gain
  this phase needs.

### The six remaining obligations, as exact values

- **Obligation 1 — permitted algorithms: Ed25519 only.** It is the only algorithm in the
  tree (`@noble/curves` 2.2.0). An allow-list of one is the strongest form and requires
  no negotiation.
- **Obligation 2 — bans: SHA-1, P-192, P-224 and RSA < 2048 refused *by name*, each with
  its own test.** A default-deny allow-list already makes them unreachable; the ruling
  asks for precise refusals a reader can point at, so each is named and individually
  guarded rather than left implicit.
- **Obligations 4 and 6 — parsing and extension limits: fixed byte ceilings** on the whole
  certificate, on each extension, and on the extension count — **checked before any parse**,
  on the same reasoning `MAX_CHAIN_DEPTH` is checked before any signature work: the length
  is attacker-supplied and this is the cheapest possible refusal.
- **Obligation 7 — duplicate extensions: refused outright.** No last-wins, no warning.
- **Obligation 3 — DER canonicalisation: proved by re-encoding and comparing bytes.** A
  round-trip that must be byte-identical, rather than a checklist of encoding rules that
  can be satisfied in prose.

### How each refusal is proved, and what it is traced to

- **One test per refusal, each planted and watched red, each ledgered.** The ruling's
  words: *"the set of precise refusals, each with a test that has been watched red"*, and
  *"a profile document with no guard is the advisory thing the ruling exists to replace."*
- **Refusals surface as a typed discriminated union**, matching what `verifyChain` already
  returns (`{kind: 'too-deep', depth, limit}`). Not thrown errors, not reason strings.
- **A new `X509-01…07` requirement family**, one per obligation, traced in
  REQUIREMENTS.md. The roadmap entry says *"none yet — this phase opens them."*
- **Obligation 5 is recorded as already delivered**, citing `capability.ts:127/190` and
  the 2026-08-07 measurement, and is not re-implemented. The review's claim that
  *"verifyChain currently has no depth bound at all"* was false when written.

### The verification backend — OWNER RULING 2026-08-09

**`crypto.subtle` Ed25519 when available; libsodium (WASM) as the fallback when it is not.**

This is not part of the seven obligations. It arrived from a question about
`MAX_CHAIN_DEPTH` and lands here because obligation 1 is *permitted algorithms*, and how
those algorithms are **verified** is the same surface. It touches `verifyChain`
(`capability.ts`) and `verifyCertificate` (`enrollment.ts`), not the DER decoder.

**What was measured, on this host, 2026-08-09:**

| Backend | Per verify | Depth-8 chain | Insecure origin | Bundle |
|---|---|---|---|---|
| `@noble/curves` (today) | 1.348 ms | 10.78 ms | ✅ works | 0 KB marginal — transitive dep of `libp2p-noise` |
| `crypto.subtle` chromium | **0.0393 ms** | 0.31 ms | ❌ `undefined` | 0 KB |
| `crypto.subtle` firefox | 0.0800 ms | 0.64 ms | ❌ `undefined` | 0 KB |
| `crypto.subtle` webkit | 0.1100 ms | 0.88 ms | ❌ `undefined` | 0 KB |
| **libsodium (WASM)** | **0.0887 ms** | 0.71 ms | ✅ works | **314.9 KB gzip** |

**Why a fallback is needed at all — the tier split.** `crypto.subtle` is not merely
missing Ed25519 outside a secure context; the whole interface is absent. Measured
`undefined` in chromium, firefox and webkit at `http://10.144.82.249:8799`. That is the
origin `bin/seed.ts` prints in its banner and encodes in its QR code — the multi-device
LAN demo, the path that demonstrates the project's core claim. HTTPS and `localhost` are
secure; a LAN IP and a `.local` name are not.

**Why libsodium works there and `crypto.subtle` does not:** libsodium is WASM, and WASM
carries no secure-context requirement. This is already proven in this repository rather
than assumed — the demo instantiated the colouring kernel and settled n = 500 over that
exact LAN HTTP origin on 2026-08-08.

**Taken against the standing recommendation, which is recorded because it was overruled.**
The recommendation was `subtle → noble`: noble is already in the dependency graph at zero
marginal cost, while libsodium is 314.9 KB gzip against a total demo bundle of 168.93 KB —
**1.9× the whole application** — to buy ~10 ms per verification on the single tier that
pays it, on a path research already proved is **off** the per-task execution path (all five
`verifyCertificate` call sites sit outside `exec → WebAssembly.instantiate`). The owner
ruled libsodium. The work proceeds under it.

**What the ruling obliges:**

1. **Lazy `import()` behind the capability check.** No secure-context tier may fetch
   libsodium. `globalThis.crypto?.subtle` decides, and the 314.9 KB is reachable only on
   the arm that needs it. A static import would put the cost on every tier and is the one
   way this ruling becomes indefensible.
2. **A differential-conformance guard, and it is the non-negotiable part.** Every enabled
   backend must return the **identical verdict** over one shared vector set — and the
   vectors that matter are the **rejections**, not the acceptances. Agreement on the happy
   path is already established: a noble signature verifies under libsodium and a libsodium
   signature verifies under noble, both directions, same RFC 8032. Disagreement on a
   *malformed* input is what would let one origin accept what another refuses, and that is
   the hazard a second implementation in a trust path introduces.
3. **`subtle.verify` is async and `verifyChain` is synchronous.** The real cost of this
   change is the signature of a security-critical function and every caller with it. Price
   it in planning rather than discovering it in execution.
   **SETTLED BY OWNER RULING 2026-08-09 (second ruling, same day): use an adapter pattern.**
   Priced first, as this obligation required — 9 production call sites, of which 6 are
   mechanical and 3 near-mechanical, plus one genuine structural obstacle:
   `PeerVerifier.verifiedPeers` is a **synchronous getter** feeding the block-fetch path
   (`RpcBlockSource` / `FetchingBlockstore`), which cannot become async without redesigning
   the interface. The owner ruled the adapter rather than the migration, and the ruling
   dissolves the obstacle instead of paying for it. See the sub-section below.
4. **The measurements above are one host, one run.** They were not taken with the
   comparative-ratio discipline this repository requires of a perf claim. Re-measure before
   any of them is quoted as settled.

### The adapter — OWNER RULING 2026-08-09 (second ruling, same day)

**The port is a synchronous `verify`, behind an asynchronous one-time `init`.** Asked
whether Phase 25 should perform the async migration, ship unwired, or convert only the
mechanical sites, the owner ruled: *"ideally, we should use an adapter pattern."*

**Why that dissolves the obstacle rather than deferring it.** Measured by execution on this
host, 2026-08-09, Node v25.9.0 — not inferred from documentation:

| Backend | `verify(...)` returns | `instanceof Promise` |
|---|---|---|
| `@noble/curves` | `boolean` | **false** |
| libsodium (after one `await sodium.ready`) | `boolean` | **false** |
| `crypto.subtle` | `object` | **true** |

libsodium's WASM instantiation is the only asynchronous part of it, and it happens **once**,
at `ready`. After that `crypto_sign_verify_detached` is an ordinary synchronous call. So a
port shaped `{ init(): Promise<void>; verify(sig, msg, key): boolean }` has **two**
conforming implementations. `verifyChain` stays synchronous, the 9 call sites do not change,
and `PeerVerifier.verifiedPeers` stays a synchronous getter. The interface redesign that
made this a scope question does not need to happen.

**The consequence, stated rather than buried: `crypto.subtle` cannot implement the
synchronous port.** A Promise cannot be awaited synchronously in JavaScript, and no
portable trick changes that (`Atomics.wait` is unavailable on the main thread and needs
cross-origin isolation, which `GitHub Pages` cannot supply — the same constraint that
already rules out WASM threads for this project). Therefore:

- the **synchronous** trust path — `verifyChain` and everything reached from
  `PeerVerifier.verifiedPeers` — runs on **libsodium-or-noble**, selected at `init`;
- `crypto.subtle` serves only call sites that are **already asynchronous**, through a
  separate async port, where its 0.0393 ms genuinely lands.

This **scopes** the first ruling rather than reversing it: *"`crypto.subtle` first"* still
holds wherever subtle can be called at all. What it cannot do is win on the sync path
without the migration the second ruling declined to buy. An owner who intended subtle
everywhere, sync path included, should say so — that reopens the 9-call-site migration and
the `PeerVerifier` redesign, and it is a different phase's worth of work.

**What the adapter obliges the planner to keep:** the lazy-`import()` requirement is
unchanged and still non-negotiable — libsodium's 314.9 KB gzip must be reachable only on
the arm that needs it, decided inside `init` by `globalThis.crypto?.subtle`. The
differential-conformance guard is unchanged and still weighted toward **rejection** vectors;
if anything the adapter raises its importance, because the sync and async ports must not
disagree about a malformed input. And the re-measurement obligation is unchanged.

**A cheaper route exists and is not chosen here, but should be named:** AutoTLS
(`@ipshipyard/libp2p-auto-tls`, already in the stack table) would give the seed a real
`<peerId>.libp2p.direct` certificate, making every tier a secure context and letting
`crypto.subtle` be unconditional with no fallback and no second implementation. It is
blocked on the same thing `NET-03` is — a publicly reachable host — and that requirement
now has a second reason to matter.

### Claude's Discretion

Module placement, decoder internals, the exact numeric ceilings (to be sited against real
certificate sizes rather than guessed), and the test file layout.
</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/core/src/capability.ts` — `MAX_CHAIN_DEPTH`, and the pre-signature bound
  pattern this phase's byte ceilings should copy.
- `packages/core/src/enrollment.ts:158` — `NodeCertificate`, the flat shape an X.509
  envelope must carry; `payloadOf` at `:179` is the canonical-encoding seam.
- `@noble/curves` 2.2.0 / `@noble/hashes` 2.2.0 — already dependencies of `@o2/core`.

### Established Patterns
- Refusals are typed discriminated unions returned, not thrown.
- Bounds are checked before expensive work, and the ordering is stated in the source.
- Every guard is proved by a planted mutation watched red, then restored and `cmp`-verified.

### Integration Points
- `relayAdmissionGate` / `verifyCertificate` — where a certificate is judged today.
- `packages/browser/*` — the tier whose bundle the ruling asks to be measured.
- No X.509 dependency exists in the root manifest or any workspace package (verified
  2026-08-09): `pkijs`, `asn1js`, `node-forge`, `@peculiar` all absent.
</code_context>

<specifics>
## Specific Ideas

- The ruling was taken **against the standing recommendation**, and the planner should not
  re-argue it. What is open is *how* to adopt, not *whether*.
- Two numbers are owed by name: bundle weight added to the browser tier, and whether the
  parser can be kept off the path a tab executes.
</specifics>

<deferred>
## Deferred Ideas

- RFC-0003 §2's optional external CA, and the §2/§4 tension over critical unknown
  extensions. Named in the roadmap entry; not reconciled here.
</deferred>
