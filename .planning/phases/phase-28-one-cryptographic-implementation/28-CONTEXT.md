# Phase 28: One Cryptographic Implementation, and the Facades Ledgered - Context

**Gathered:** 2026-08-10
**Status:** Ready for planning, with two owner rulings outstanding (see `<deferred>`)
**Mode:** Autonomous gather — no interview. Everything below is either read out of the
tree at the cited `file:line`, carried in from this session's own measurements, or
marked **INFERRED**. An unmarked claim here is a claim I read or ran.

<domain>
## Phase Boundary

`packages/core` ends this phase with **one** Ed25519 backend-selection mechanism instead
of two, `libsodium-wrappers` gone from `@o2/core`'s manifest and the lockfile, and the
certificate-lifecycle facades carrying a requirement family with an honest status marker
instead of existing as real-but-uncounted code.

The roadmap entry (`.planning/ROADMAP.md:1818-1885`) names six obligations. They are the
scope, and they are not equal in size: obligations 1, 2 and 3 are the phase; 4, 5 and 6
are the guards that keep 1 and 2 from being an unproved claim.

**In scope:** the merge of the two selection paths, the dependency removal and its
measured bundle delta, the `CRYPTO-01…NN` family and its ledger rows, and three guards
(differential conformance across the merge, the removal's bundle delta, the WebKit
signature-nondeterminism finding).

**Out of scope, and the roadmap says so explicitly:** wiring the port into
`verifyChain`/`verifyCertificate`, and barrel-exporting the facades. Both are owner
rulings, both are stated in `<deferred>`, and neither may be decided as a side effect of
implementing something else.

### A correction the planner needs before it reads anything else

The roadmap entry says *"two implementations in one trust path"*. **Measured: neither one
is in the trust path.** The production trust path calls `@noble/curves` directly and
routes through neither selection module:

| Call site | What it calls |
|---|---|
| `packages/core/src/capability.ts:219` | `ed25519.verify(...)` — inside `verifyChain` |
| `packages/core/src/enrollment.ts:702` | `ed25519.verify(...)` — challenge answer |
| `packages/core/src/enrollment.ts:740` | `ed25519.verify(...)` — proof of possession |
| `packages/core/src/enrollment.ts:759` | `ed25519.verify(...)` — owner proof |
| `packages/core/src/enrollment.ts:874` | `ed25519.verify(...)` — inside `verifyCertificate` |
| `packages/core/src/discovery.ts:122` | `ed25519.verify(...)` — capability record |

So the accurate statement of the defect is **three** Ed25519 arrangements in one package:
a production path that is unconditional noble with no selection at all, plus two unused
selection layers built over it at different times for different reasons. That makes the
merge *easier* than the roadmap wording implies — nothing in production changes behaviour
when the two layers become one, because nothing in production reads either layer — and it
makes obligation 4 *harder to satisfy honestly*, because a differential guard over a seam
no production code crosses proves less than one over a seam it does.
</domain>

<decisions>
## Implementation Decisions

### The exact current state of both selection paths

**Path A — `packages/core/src/ed25519-backend.ts` (Phase 25, Plan 25-04).**
`initEd25519()` at `:194-216` runs one memoised capability check and sets both ports:

- the gate is **presence-only**: `typeof globalThis.crypto?.subtle?.sign === 'function'`
  (`:197`), justified in its own docblock (`:184-188`) against 25-CONTEXT.md's finding
  that `subtle` reads `undefined` *in its entirety* outside a secure context;
- capable → sync port = **noble** (`:200`), async port = **subtle** (`:203`), libsodium
  never imported;
- not capable → sync port = **libsodium** via `await import('libsodium-wrappers')`
  (`:206`, `:117-133`), async port = a `Promise.resolve` wrapper over the same instance
  (`:208-211`);
- `getSyncVerifier()`/`getAsyncVerifier()` (`:219`, `:225`) throw
  `Ed25519NotInitializedError` (`:71-82`) rather than defaulting.

**Path B — `packages/core/src/cert-lifecycle.ts` (the facades, 2026-08-10).**
`createCryptoBackend()` at `:555-558` memoises `detectCryptoBackend()` at `:560-576`:

- the gate is a **real round-trip probe**: `await subtle.generateKey({name:'Ed25519'},
  false, ['sign','verify'])` inside a `try` (`:566-568`), on the stated reasoning that
  `subtle` can be *present and algorithm-incapable* — the opposite failure mode from
  Path A's (`cert-lifecycle.ts:31-38`);
- success → `subtleCryptoBackend()` (`:518-544`); throw → `nobleCryptoBackend()`
  (`:491-511`);
- the port is `{arm, signEd25519, verifyEd25519, agreeX25519}` (`:470-475`), **all three
  async**, and it signs as well as verifies — Path A only verifies;
- libsodium is not used and the docblock says so by name (`:11-21`).

**The two gates are not equivalent, and the stronger one is Path B's.** Path A's
presence check would select subtle on an engine that advertises `SubtleCrypto` and
refuses `Ed25519`; Path A's own test file compensates for this outside production code
(`ed25519-backend.test.ts:309-328`, `subtleSupportsEd25519()` — *"a real round-trip
probe, not a presence check"*). **The merged module must carry Path B's probe.** Keeping
Path A's gate would be merging toward the weaker of the two.

**Proposed shape of the merge** (mine, not an owner ruling): one module, Path B's async
`CryptoBackend` port with its real probe, plus Path A's synchronous port and its
no-implicit-default error retained, because `verifyChain` and
`PeerVerifier.verifiedPeers` are synchronous and the adapter is the only reason a future
wiring pass would not need the 10-call-site migration Path A's test file priced
(`ed25519-backend.test.ts:100-125`). Dropping the sync port would silently re-incur that
cost and re-open a decision Phase 25 already settled.

### The subtle/noble inversion on the secure path, decided knowingly

On a secure origin Path A selects **noble** for the sync port (`ed25519-backend.ts:200`)
and leaves subtle on the async port. Measured this session in real engines: subtle
0.048 ms chromium / 0.140 ms webkit / 0.125 ms firefox; noble 0.494 / 0.845 / 1.520.
So the sync port runs 10-12× slower than the backend sitting unused beside it. That is a
consequence of the adapter, not a defect in it — a Promise cannot be awaited
synchronously, and the reasoning is recorded at `ed25519-backend.ts:10-22`. The phase
should **state this choice rather than inherit it**: the sync port is deliberately the
slower backend, and the price is bounded because a real capability chain is depth 1-2
(`capability.ts:101-127`, `MAX_CHAIN_DEPTH = 8` is a bound, not an observation), so the
fallback arm costs roughly 1-3 ms per chain, not the `8 × 1.348 = 10.78 ms` figure
25-CONTEXT.md's table implies. **Do not reuse the 10.78 ms framing** — it was never
observed, and no production build reaches depth 8.

### Removing libsodium — what it actually touches

**One real consumer, confirmed three ways.** `await import('libsodium-wrappers')` at
`ed25519-backend.ts:118` is the only import anywhere in `packages/`, `tools/` or `bin/`.
`npm ls libsodium-wrappers` returns a single path: `o2-services → @o2/core → 0.8.4`.
`cert-lifecycle.ts` mentions it only in prose (`:11`, `:16`) saying it is not used.

**Manifest and lockfile.** `packages/core/package.json:14`; `package-lock.json:2731`
(`libsodium`, the transitive), `:2737` (`libsodium-wrappers`), `:4308` (the `@o2/core`
workspace entry). Both packages leave the tree — `libsodium` is pulled in only by
`libsodium-wrappers` (`package-lock.json:2743`).

**Test surface.** Only `packages/core/src/ed25519-backend.test.ts` exercises it:
`:348-349` (the differential guard's backend list), `:412-450` (two secure-arm cases that
assert the import count stays `0`), `:452-537` (three insecure-arm cases that assert the
backend is `libsodium` and the import happens exactly once). Plus one narrative comment
at `packages/node/src/reachability.node.test.ts:511`. **No test asserts that three
backends exist** — I grepped for it; the only cardinality assertions in the file are
`REJECT_VECTORS.length >= 7` (`:304-307`) and reject-vector name uniqueness (`:299-301`).

**The replacement is free, and this is stronger than the bundle argument alone.**
`@chainsafe/libp2p-noise` already imports `@noble/curves/ed25519.js`, the exact module,
so noble is in the browser bundle graph before this project writes a line — 314.9 KB gzip
removed against a 168.93 KB app, with nothing added. And the tier libsodium was bought
for is **already proved served by noble**:
`packages/browser/src/insecure-origin.browser.test.ts:1-35` removes `crypto.subtle`
outright and shows `generateSeed`, `identityFromSeed`, `requestEnrollment`,
`EnrollmentAuthority.enrol` and `verifyCertificate` all still work — *"a green run is a
reading of the actual call graph and not of the import list."* The insecure-origin
justification for a WASM backend was answered by an existing spec, not by this phase.

Removing libsodium also deletes the lazy-`import()` obligation, its two import-counter
tests, and the `?fresh-instance=` module-identity workaround those tests need
(`ed25519-backend.test.ts:396-410`) — the most fragile machinery in the Phase 25 design.

### Obligation 4 — the differential guard across the merge

The guard is `ed25519-backend.test.ts:330-390`. `availableBackends()` (`:346-355`) pushes
noble and libsodium unconditionally and subtle only when the round-trip probe passes.
`ACCEPT_VECTORS` must agree `true` (`:371-378`); `REJECT_VECTORS` must agree `false`
(`:380-389`), and the reject half is labelled *"the non-negotiable half"*. Both ports are
covered by a separate case that runs every reject vector through sync **and** async after
`initEd25519()` (`:566-584`), which is the sync/async-boundary coverage obligation 4 names.

**It survives the merge structurally** — nothing in it requires libsodium to exist. But
there is a real anti-vacuity hole the merge widens and nothing currently closes:

> With libsodium gone, a host where `subtle` is absent or Ed25519-incapable leaves
> `availableBackends()` returning **one** backend, and every "backends disagreed" loop
> passes by comparing noble against itself. There is no assertion of a minimum backend
> count anywhere in the file.

Practically the count stays at 2 (Node v25.9.0 and all three browser engines on
`http://localhost` are Ed25519-capable — `cert-lifecycle.browser.test.ts:32-35` asserts
`isSecureContext`), so this is a latent vacuity, not a live one. **INFERRED**, from
reading the selection logic rather than from running the suite on an incapable host.
The cheap fix is an explicit floor (`backends.length >= 2`) beside the existing
`REJECT_VECTORS.length >= 7` floor, and the phase should take it — a guard that can
silently become a self-comparison is the *"proof that cannot fail"* CLAUDE.md § Proofs
refuses.

The merged guard should also gain **sign**-side vectors, which Path A's guard has none of
because Path A only verifies. Path B signs (`cert-lifecycle.ts:493-496`, `:521-526`), and
that is where the WebKit finding lives.

### Obligation 5 — the bundle delta, guarded the way 25-03 guards the decoder's

The precedent is `packages/node/src/x509-bundle.e2e.test.ts`: two synthetic Vite
library-mode builds in one process (`:60-84`), gzip via `node:zlib` (`:83`), delta
asserted against `DECODER_BUDGET_BYTES = 25_600` (`:159`) sited at ~1.34× a measured
19064 B, with a tree-shaking sanity assertion (`:99`) so the delta cannot be vacuously
small, and a planted-mutation proof recorded verbatim in the docblock (`:147-157`).

**The mirror does not transfer cleanly, and the planner needs to notice.** 25-03 guards
an *addition* with a `toBeLessThanOrEqual` ceiling. Phase 28 measures a *removal*, and a
ceiling on a removal is satisfiable by doing nothing. A removal guard has to assert
something a regression would break — the honest forms are (a) a build of the trust path
contains no libsodium bytes at all, and/or (b) the gzip size of that build is at or below
a ceiling sited just above the post-removal measurement, so re-adding a 314.9 KB
dependency reddens it. Form (b) is closer to the 25-03 pattern and is the one I would
plan; form (a) is the one that actually names the dependency. Doing both is cheap.

The 314.9 KB figure is inherited from 25-CONTEXT.md's table (`:97`), which that document
itself flags as *"one host, one run"* and asks to be re-measured before it is quoted as
settled (`:142-144`). **The phase owes its own reading**, taken the same run as the
post-removal one so the comparison is within-run per CLAUDE.md § Measurement.

### Obligation 6 — the WebKit finding becomes a guard

Today it is prose in two places and nothing else: `cert-lifecycle.ts:58-70` and
`cert-lifecycle.browser.test.ts:79-88`. The browser file asserts what is *true* —
mutual verifiability across arms (`:97-100`) — and asserts byte-identity only for X25519,
where it holds (`:144`). Nothing anywhere prevents a future caller from deduping,
caching, or comparing attestations by signature bytes, which is the failure the finding
predicts: green in Node and CI, broken in Safari.

The finding restated so a guard can be written against it: **Ed25519 signature bytes are
not a stable identifier in this fabric.** Node, chromium and firefox matched noble
byte-for-byte; webkit did not, because it hardens with a synthetic/hedged nonce rather
than RFC 8032's deterministic one. Both signatures verify under both arms.

Two guard shapes are available and they catch different things:

1. **A behavioural guard** in the browser project asserting the cross-arm relation is
   *mutual verifiability and not byte-equality* — which is what the existing test already
   does implicitly. Weak on its own: it re-proves the finding rather than protecting
   against its consequence.
2. **A source-level guard** that refuses a signature-bytes equality/keying construct in
   the production tree. The repository has the machinery for exactly this shape of check
   already — `requirements-ledger.node.test.ts` (comment-stripped source scanning,
   `:278-291`) and `purity.node.test.ts` are both source-reading guards.

**Shape 2 is what obligation 6 asks for** ("a guard, not just a docblock"). Its exact
predicate is the planner's problem and it needs siting against the real tree so it is not
vacuous on day one.

### Obligation 3 — the `CRYPTO` family, and it is known to parse

**No collision.** Existing families read out of `.planning/REQUIREMENTS.md`: AOT, AOTW,
AUTH, BENCH, BROW, CHURN, DATA, DEMO, DET, MR, NET, SCHED, VER, WIRE, X509. No `CRYPTO`.

**It parses under both of the ledger's readers**, which use the same id pattern:
- checkbox rows: `/^- \[([x ])\] \*\*([A-Z][A-Z0-9-]*-\d+)\*\*/`
  (`packages/node/src/requirements-ledger.node.test.ts:800`)
- traceability rows: `/^\| ([A-Z][A-Z0-9-]*-\d+) \| ([^|]*) \| (.*) \|$/` (`:457`, `:826`)

`CRYPTO-01` matches `[A-Z][A-Z0-9-]*-\d+`. Verified by reading the regexes, not by
running the suite (the suite is out of bounds this session).

**Placement is load-bearing and has a precedent.** The header's arithmetic — `**45 of 72
are [x]**` and its three companions — is parsed and asserted
(`requirements-ledger.node.test.ts:772-776`), and `V1_BOXES` collects checkboxes **only
under the `## v1 Requirements` heading** (`:792-804`), with the file's own docblock
warning that folding other sections in is *"how '82' and '72' get quoted for the same
population"* (`:786-790`). X509 and AOTW both avoided this by taking their own top-level
sections: `## Phase 25 Requirements — X.509 Certificate Profile`
(`.planning/REQUIREMENTS.md:630`) and `## Phase 26 Requirements — elfconv Compiled to
Wasm` (`:649`). **`## Phase 28 Requirements — One Cryptographic Implementation` is the
parsing-safe placement** and requires no edit to the header counts. Traceability rows go
in the single table at `:715`+, whose verdict counting is filtered to `V1_BOXES` (`:817-833`),
so extra rows there are safe too.

**Status marker.** `acceptance-traceability.node.test.ts` enforces `[x]` iff the verdict
begins `Done`, over rows that exist. The facades are **Built, not wired** under the
entry-point-reachability convention (`.planning/REQUIREMENTS.md:36-40`): nothing imports
`cert-lifecycle.ts` outside its own two test files — confirmed by grep. So the facade
rows are `[ ]` + **Built, not wired**, and any row about the merge or the dependency
removal is `[x]` + **Done**, because those *are* reachable — they are properties of the
manifest and of `packages/core`'s own module graph, not of a call path.

### Claude's Discretion

Module naming and placement for the merged backend; how many `CRYPTO-*` ids the six
obligations become (one per obligation is the X509 precedent, but obligations 1 and 2 may
read better as one row); the exact predicate and file for the signature-bytes guard; the
sited value and headroom multiple for the bundle ceiling; test file layout.
</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/core/src/ed25519-backend.ts` — the sync/async port pair, the
  no-implicit-default error, and the try/catch refusal boundary (`:98-102`, `:126-130`,
  `:163-169`) that turns a structural throw into `false`. Keep all of it; replace the gate.
- `packages/core/src/cert-lifecycle.ts:560-576` — the real capability probe, which is the
  gate that survives.
- `packages/core/src/ed25519-backend.test.ts:200-390` — the vector corpus and the
  differential harness. The vectors are the asset; the backend list is what changes.
- `packages/node/src/x509-bundle.e2e.test.ts` — the dual-build gzip measurement, with the
  `<repo-root>/tmp/` resolution note at `:27-35` that makes bare-specifier resolution work.
- `packages/browser/src/insecure-origin.browser.test.ts` — the standing proof that the
  production path needs no `subtle`.

### Established Patterns
- Constants are **sited, not picked**, with the measurement and its conditions in the
  docblock: `MAX_CHAIN_DEPTH` (`capability.ts:101-127`), `DECODER_BUDGET_BYTES`
  (`x509-bundle.e2e.test.ts:119-159`), `ARGON2_PARAMS` (`cert-lifecycle.ts:444-464`,
  measured 374.4 ms at OWASP `t=2, m=19456, p=1`).
- Refusals are returned as typed values, never thrown; a library that throws on a
  structural input is wrapped so it reads as `false`.
- Every guard is proved by a planted mutation **watched red**, then restored by the
  surgical inverse of the edit and `cmp`-verified — never by `cp`, and never with the hunk
  count read as the check (CLAUDE.md § Conventions).
- A ceiling records its own history in its docblock so a future raise cannot hide.

### Integration Points
- **The barrel.** `packages/core/src/index.ts:386-397` **already exports all seven of
  `ed25519-backend.ts`'s callable symbols** with a comment saying there is no production
  caller yet. `cert-lifecycle.ts` is **not** exported — grep of `index.ts` for
  `cert-lifecycle` returns nothing. So the two modules sit on opposite sides of the barrel
  today, and a merge has to decide which side the merged module lands on. If the merged
  module keeps the seven names, the ceilings do not move; if the merge deletes or renames
  them, the counts fall and the convention at `reachability-guard.node.test.ts:262-264`
  says a lower reading means the ceiling comes down with it.
- **The reachability ceilings, as they stand today:**

  | Guard | Value | Where |
  |---|---|---|
  | all unreachable callable barrel exports | `<= 75` (hard-coded) | `reachability-guard.node.test.ts:264` |
  | undisposed subset | `OPEN_FINDING_CEILING = 49` | `reachability-dispositions.ts:222`, asserted `:355-363` |
  | disposition register size | `DISPOSITION_CEILING = 26` | `reachability-dispositions.ts:231` |
  | declaration-name collisions | `<= 16` | `reachability.node.test.ts:521` |

  The collision bound pins four names explicitly (`:525-528`):
  `ed25519-backend.ts#verify`, and `cert-lifecycle.ts#signEd25519` / `#verifyEd25519` /
  `#agreeX25519`. **A merge that collapses two ports into one module moves this number**,
  and the direction depends on the shape: fewer modules with the same method names could
  raise collisions (more same-name declarations in one file) rather than lower them.
  This is the guard most likely to redden unexpectedly, and it is the one whose last raise
  (13→16) corrected a false *"pre-existing, unrelated"* report (`:517-522`).
- **Drift observed, non-reddening:** `reachability-guard.node.test.ts:350` still says
  *"47 callable barrel exports have no production caller"* while `OPEN_FINDING_CEILING`
  is 49 (raised 47→49 by Plan 25-02, `reachability-dispositions.ts:208-220`). It is a
  comment, so nothing fails; `.planning/REQUIREMENTS.md:790`'s WIRE-02 row carries the
  same stale 67/20/47 triple. Worth a one-line correction while this phase is in the file.
- **`verifyChain` and `verifyCertificate` both have production callers today** — see
  `<deferred>`. This contradicts one framing of the open question and the planner must
  not restate it wrongly.
</code_context>

<specifics>
## Specific Ideas

- **The facades' test record, reconciled by counting rather than quoted.**
  `cert-lifecycle.test.ts` holds 28 `it(` cases; `cert-lifecycle.browser.test.ts` holds
  10. `cert-lifecycle.test.ts` carries no `.node.` infix, so it matches `--project
  browser` as well (stated in its own header, `:14-16`), and the browser matrix is
  chromium/firefox/webkit (`cert-lifecycle.browser.test.ts:2-3`). `(28 + 10) × 3 = 114`.
  That reconciles the roadmap's *"28 node tests, 114 browser tests"* exactly — the two
  figures are the same 38 cases counted on two tiers, not two independent suites.
- **Two numbers this phase owes by name**, in the 25-03 tradition: the gzip delta of the
  removal, re-measured in-run rather than inherited from 25-CONTEXT.md's `:97`; and the
  post-merge per-verify cost of whichever backend the sync port ends up on, taken as a
  ratio inside one run rather than as an absolute.
- **The merge is behaviour-neutral in production and the phase should say so out loud.**
  No production code reads either selection module, so no production behaviour changes.
  That is what makes this a safe merge — and it is also the reason the phase cannot claim
  to have removed a hazard *from the trust path*. It removes a hazard from the package.
  Claiming more would be the widening-what-counts-as-passing failure CLAUDE.md § Proofs
  names.
- **Do not re-argue Phase 25's owner ruling; note that its premise moved.** The libsodium
  ruling of 2026-08-09 was taken against a standing `subtle → noble` recommendation
  (`25-CONTEXT.md:111-117`). Phase 28 exists because the owner ruled the other way on
  2026-08-10 for `cert-lifecycle.ts` (`cert-lifecycle.ts:13-21`). What is open is *how* to
  reconcile the two modules, not *whether*.
</specifics>

<deferred>
## Deferred Ideas — and two things this phase must NOT decide by implementing

### 1. Whether the Ed25519 port gets wired into the trust path at all

**State the question precisely, because the obvious phrasing is false.** `verifyChain`
is **not** unwired: it has a production caller at
`packages/net/src/capability-authorizer.ts:132`, reached through `authorizeCapability`,
installed by both `FabricNode` and `browser-node.ts` — `.planning/REQUIREMENTS.md:803`
says so in the X509-05 row, calling it *"a real production call path, unlike the other
six rows here."* `verifyCertificate` has six production call sites
(`result-attestation.ts:483`, `enrollment.ts:926`, `discovery.ts:264`,
`browser/demo/main.ts:350`, `peer-verifier.ts:557` and `:688`, `fabric-node.ts:960`).

What is unwired is the **port**: nothing in production calls `initEd25519()`,
`getSyncVerifier()` or `getAsyncVerifier()`. The only importers are the barrel
(`index.ts:386-397`) and the module's own test file.

**Why it was left unwired, and why the reason changed mid-Phase-25.** The original reason
was the async-migration cost, priced at 9-10 call sites with
`PeerVerifier.verifiedPeers` as a synchronous getter feeding the block-fetch path
(`ed25519-backend.test.ts:100-125`). The adapter dissolved that. What remains is
different and is genuinely open (`ed25519-backend.test.ts:158-180`): **where each of
three runtime entry points calls `initEd25519()` before first use, and what a
verification arriving before that promise resolves should do — block, fail closed, or
fail open.** That is a fail-open/fail-closed ruling on a trust path. **Owner's, not the
planner's.**

If the owner rules to wire it, two consequences are already known and must be priced
rather than discovered: the five `ed25519.verify` sites in `capability.ts`/`enrollment.ts`
change, and moving `#refresh` off the `verifiedPeers` read introduces a **staleness
window** that is a security parameter and needs a sited constant, not a picked one.

### 2. Whether the facades join the barrel export

They are deliberately absent from `packages/core/src/index.ts` today, which keeps their
*Built, not wired* status honest and simultaneously keeps them invisible to every guard
that reads the barrel.

**The measured cost of exporting them.** `cert-lifecycle.ts` has 12 callable exports —
`signCertificate` (`:408`), `deriveKeySeeds` (`:437`), `nobleCryptoBackend` (`:491`),
`subtleCryptoBackend` (`:518`), `createCryptoBackend` (`:555`), `Subject` (`:588`),
`Issuer` (`:708`), `Verifier` (`:779`), `Directory` (`:849`), `createSubject` (`:872`),
`createIssuer` (`:877`), `createVerifier` (`:888`). `ARGON2_PARAMS` (`:464`) is a `const`
and never enters the callable corpus, per the guard's own note at
`reachability-guard.node.test.ts:245-249`.

So exporting them unwired and undisposed moves the hard-coded 75 to **87** and
`OPEN_FINDING_CEILING` 49 to **61**. **INFERRED** — a count of export declarations, not a
run of the guard, which needs the vitest suite this session is barred from touching.
Both ceilings are `<=` bounds, so the raise is a deliberate edit rather than an automatic
failure, which is exactly why it is an owner decision: it is the kind of number that
drifts upward quietly.

### 3. Not reconciled here
- RFC-0003 §2's optional external CA and the §2/§4 tension, deferred by Phase 25
  (`25-CONTEXT.md:236-241`). Unchanged.
- Lowering the reachability residue as work in its own right. The owner ruled 2026-08-08
  to hold it rather than work it down (`reachability-dispositions.ts:191-193`).
</deferred>
