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
