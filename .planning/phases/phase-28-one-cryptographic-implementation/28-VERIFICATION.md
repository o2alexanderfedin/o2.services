---
phase: 28-one-cryptographic-implementation
verified: 2026-08-11T03:09:26Z
status: human_needed
score: 5/6 criteria verified, 1 partial (criterion 5)
overrides_applied: 0
human_verification:
  - test: "Owner ruling on criterion 5's two shortfalls: (a) the ROADMAP's literal clause `size asserted to have moved DOWN` is implemented as `delta < LIBSODIUM_MEASURED_GZIP_BYTES` — a comparison against the dropped dependency's own historical weight — not as a measured decrease, because the measured before/after was 28307 B -> 28306 B and no decrease exists to assert; (b) 28-02-PLAN's `at least an order of magnitude` acceptance criterion is unmet at 3.93x and argued unreachable at any legal headroom."
    expected: "Owner either accepts the substituted downward relation and the 3.93x figure as the honest end state (in which case criterion 5 closes with a recorded deviation), or re-sites the guard / re-scopes the criterion."
    why_human: "Both are judgement calls about what an acceptance criterion is FOR, not facts a scan can settle. The phase reported both against its own interest and bent neither constant; nothing here is a defect to fix, it is a ruling to make."
gaps: []
---

# Phase 28: One Cryptographic Implementation, and the Facades Ledgered — Verification Report

**Phase Goal:** `packages/core` holds exactly one Ed25519 implementation rather than two,
libsodium leaves the dependency tree, and the certificate-lifecycle facades stop being
real-but-unledgered code.

**Verified:** 2026-08-11T03:09:26Z
**Status:** human_needed — 5 of 6 criteria verified outright, criterion 5 partial and escalated
**Re-verification:** No — initial verification

## Method, and its one deliberate limitation

Every claim below was re-taken against the live tree rather than read out of a SUMMARY.
Exit codes were read with `EXIT=$?` on the line immediately following the command, never
through a pipe.

**No planted mutations were performed by this verifier, and that is a decision rather than
an omission.** CLAUDE.md § Concurrent agents states plainly: *"Agents that plant must not
run in parallel on shared source"*, and the verification brief names two sibling verifiers
running concurrently on Phases 26 and 27 in this one working tree. A plant here would have
dirtied a tree those agents are measuring, and the recorded cost of doing it anyway is on
file — 2026-08-06, one agent read another's live plant as an intermittent fail-open in the
admission gate, and refuting it took 111 executions.

What replaced planting, so the "watched red" claims are not simply trusted:

- **Criterion 1** was falsified *behaviourally* in a separate `node` process: `crypto.subtle`
  was shadowed with an engine that satisfies the deleted presence check and refuses
  `Ed25519`, the real production module was imported, and the arm it selected was read. No
  repository file was modified.
- **Criterion 2** was re-derived directly from the manifest, the lockfile, `node_modules`
  and a live `require.resolve`.
- **Criterion 3**'s "+6 on all four regexes" was recomputed from the four literal patterns
  against the live `REQUIREMENTS.md`, not read from the summary's table.
- **Criterion 5**'s bundle delta was **independently re-measured** by this verifier with its
  own dual Vite library build, into the gitignored `tmp/`.
- **Criterion 6**'s WebKit finding was **independently reproduced** across chromium, firefox
  and webkit.
- The two recorded plants I could not reproduce without touching the tree (CRYPTO-04's
  one-backend plant, and the four plants inside the guard files) are marked
  **corroborated-not-reproduced** in the table below, with the independent evidence that
  corroborates each.

`git status --porcelain` was clean at the start of this report and clean at the end; nothing
was staged, committed or stashed.

## Goal Achievement — the Six Success Criteria

| # | Criterion | Status | Evidence taken by this verifier |
|---|---|---|---|
| 1 | One Ed25519 selection path; the surviving gate is the **round-trip probe**, not the presence-only check | ✓ VERIFIED | See §1 — reproduced behaviourally: an engine passing `typeof subtle.sign === 'function'` and refusing Ed25519 selects **noble**, and `generateKey` was called exactly once |
| 2 | `libsodium-wrappers` in no manifest, no lockfile, no built bundle; bare-specifier resolution **throws** | ✓ VERIFIED | See §2 — four independent absence readings, each taken directly, plus a marker scan over real built bytes |
| 3 | `CRYPTO-01…06` honest `[ ]`/`[x]`, both ledger parsers read them | ✓ VERIFIED | See §3 — 102 rows on all four literal patterns, 6 of them CRYPTO, recomputed by this verifier; both parsers green; CRYPTO-03 `[ ]` and *actively claim-checked*, not exempted |
| 4 | Differential guard survives, rejection weighting **asserted**, sync/async boundary still covered | ✓ VERIFIED | See §4 — the floor, the weighting assertion and the port-boundary describe all present and green on node + 3 browser engines |
| 5 | Bundle delta guarded in the **removal** form: absence asserted directly, size asserted to have **moved DOWN** | ⚠️ PARTIAL | See §5 — absence ✓ and not-satisfiable-by-doing-nothing ✓ (five independent reddenings), but **no decrease is asserted because none exists to assert**; plus the plan's ≥10× sub-criterion unmet at 3.93× |
| 6 | WebKit finding is a guard, not a docblock; the one legitimate comparison sits in a bounded register with **set equality both directions** | ✓ VERIFIED | See §6 — webkit **DIFFERED ×4** reproduced by this verifier; register with both-direction set equality green |

**Score:** 5/6 verified, 1 partial. No criterion FAILED.

---

### §1 — One selection path, and the gate is the probe

**The presence check is genuinely gone, proved by behaviour rather than by grep.** Run in a
separate `node` process against the real `packages/core/src/ed25519-backend.ts`, with
`crypto.subtle` shadowed by an object whose `sign` is a function and whose `generateKey`
rejects with `NotSupportedError: Unrecognized algorithm name 'Ed25519'`:

```
presence check would pass: true
selected arm: noble
generateKey calls (probe ran): 1
sync port backend: noble
```

The deleted gate would have selected `subtle` on that engine. It selected `noble`, and the
probe demonstrably ran. This is the one behavioural fact that separates the two gates, and
it was observed, not inferred.

Supporting structural readings, all taken at HEAD:

- `detectCryptoBackend` (`ed25519-backend.ts:275-288`) contains exactly one gate: `await
  subtle.generateKey({ name: 'Ed25519' }, false, ['sign','verify'])` inside a `try`, falling
  through to `nobleCryptoBackend()`.
- `typeof … subtle … sign` appears **nowhere in `ed25519-backend.ts` as code** — the only
  occurrence in that file is prose at `:263` describing the deleted check. The two live
  `typeof` matches in the repository are both inside `ed25519-backend.test.ts` (`:698` prose,
  `:760` an assertion that the *planted* engine satisfies the old gate — which is the case
  proving the two gates differ).
- `createLibsodiumSyncVerifier` and `createSubtleAsyncVerifier` match **zero code sites**;
  all eight remaining matches are comments or recorded history.
- `cert-lifecycle.ts` holds **no residual `subtle` implementation** — `grep` for
  `subtle|generateKey|importKey` returns only four comment lines (`:286`, `:287`, `:450`,
  `:453`). The selection block really moved rather than being copied.
- `Ed25519Backend` is a one-member union `'noble'` (`:89`), so a second synchronous arm is a
  deliberate type edit.
- **Held forward by a running guard**: `one-crypto-implementation.node.test.ts` Block 1
  asserts the set of production files performing WebCrypto Ed25519 operations **by path**,
  over 153 comment-stripped production files, and it reads exactly
  `['packages/core/src/ed25519-backend.ts']`. Re-run by this verifier: **24/24 passed,
  EXIT=0.**

### §2 — libsodium is gone, four ways

Each reading taken directly by this verifier, not through the test:

| Assertion | Reading |
|---|---|
| Manifest | `packages/core/package.json` `dependencies` = `@ipld/dag-cbor`, `@noble/ciphers`, `@noble/curves`, `@noble/hashes`, `multiformats`. No `devDependencies`. No libsodium |
| Lockfile | `grep -c libsodium package-lock.json` → **0** |
| Installed tree | `ls -d node_modules/libsodium*` → no matches |
| Resolution **throws** | `require.resolve('libsodium-wrappers')` → `MODULE_NOT_FOUND: Cannot find module 'libsodium-wrappers'` |
| Built bytes | Marker scan over an independently-built production bundle of the verification surface → `markers []` (both `libsodium` and `crypto_sign_verify_detached` absent) |

**"Absence" here is not a grep returning nothing, and the guard is built so it cannot be.**
`libsodiumReferences` is a named function proved able to report **present** against
`FIXTURE_WITH_LIBSODIUM` before any live reading of it is believed
(`libsodium-absence.e2e.test.ts:226-239`) — the recorded plant that justifies those fixtures
is the one where a crippled matcher left **8 of 9 cases passing**, including both live
readings, and only the fixture caught it. The resolution assertion is the only one of the
three that reads the *installed* tree, which is what distinguishes "unlisted" from "gone".

`npx vitest run --project e2e packages/node/src/libsodium-absence.e2e.test.ts`: **9/9 passed,
EXIT=0**, re-run by this verifier.

### §3 — `CRYPTO-01…06`, honest, and read by both parsers

**The +6 was recomputed, not read.** The four literal patterns were extracted from the two
parser files and run against the live `.planning/REQUIREMENTS.md` in a separate process:

| Pattern | Source | Total matched | of which CRYPTO |
|---|---|---|---|
| `^- \[([x ])\] \*\*([A-Z][A-Z0-9-]*-\d+)\*\*` | `requirements-ledger.node.test.ts:800` | **102** | 6 |
| `^\| ([A-Z][A-Z0-9-]*-\d+) \| ([^\|]*) \| (.*) \|$` | `requirements-ledger.node.test.ts:457` | **102** | 6 |
| `REQUIREMENT_ROW` (global multiline) | `acceptance-traceability.node.test.ts:91` | **102** | 6 |
| `TRACEABILITY_ROW` (global multiline) | `acceptance-traceability.node.test.ts:129` | **102** | 6 |

96 + 6 = 102, on all four, independently. Both parsers green:
`npx vitest run --project node packages/node/src/requirements-ledger.node.test.ts
packages/node/src/acceptance-traceability.node.test.ts` → **61/61 passed, EXIT=0.**

**The rows are not merely matched, they are consumed — and no exemption was added.**
`grep CRYPTO` across both parser files returns **zero hits**, so neither an `EXPECTED_ABSENT`
entry nor a pinned-unread-row waiver was used to make the mint green. Two consequences that
this verifier checked rather than assumed:

- `CRYPTO-03` carries the verdict *Built, not wired*, so `requirements-ledger`'s
  `UNREACHED` population includes it, and a row in that population must be **either parsed
  or listed**. It is not listed, therefore its three `has no production caller` claims are
  parsed and checked against the live corpus. Re-derived independently: `createSubject`,
  `createIssuer` and `createVerifier` have their declarations in `cert-lifecycle.ts` and
  **no other occurrence anywhere in `packages`/`tools`/`bin`**. The row's claim is true.
- `acceptance-traceability` requires every `[x]` id to be named by a tracked test file. Each
  of the five is: CRYPTO-01 → `one-crypto-implementation.node.test.ts`; CRYPTO-02 and
  CRYPTO-05 → `libsodium-absence.e2e.test.ts`; CRYPTO-04 → `ed25519-backend.test.ts`;
  CRYPTO-06 → both. The recorded history that this guard *demanded* the CRYPTO-04 title
  (rather than being satisfied by `EXPECTED_ABSENT` or an un-ticked box) is corroborated by
  commit `538a2ad`, whose only source change is the addition of that title.

**Honesty of the statuses.** `CRYPTO-03` is `[ ]` **Built, not wired**, and its status text is
accurate on every checkable clause: the facades exist (`cert-lifecycle.test.ts` **28/28
passed, EXIT=0**, re-run here), nothing calls them, and `cert-lifecycle.ts` is imported by
exactly one file in the repository — its own test (`grep` for
`from '.*cert-lifecycle` returns one match). The ledger's own header explains the `[ ]`, and
`REQUIREMENTS.md:708-715` states in the family preamble that no row claims a hazard removed
from the trust path.

*Observation, not a gap (see §7.3):* four of the five `[x]` rows are ticked on a
"property of the shipped artifact plus a guard that runs" basis rather than the ledger
header's literal `[x]` = *"Delivered on a path reachable from a runnable entry point"*. Each
row discloses that basis in its own text — CRYPTO-01's says so explicitly — so this is
disclosed, not concealed. It is recorded here because the convention was written for
mechanism requirements and these are structural ones.

### §4 — The differential guard, its floor, and its weighting

| Obligation | Evidence at HEAD |
|---|---|
| Guard survives | `ed25519-backend.test.ts:402-502`, accept + reject describes intact, exercised through the **production** factories (`createNobleSyncVerifier`, `subtleCryptoBackend`) rather than a hand-rolled second copy |
| Weighting **asserted**, not incidental | `:335-340`, `it('the vector corpus stays weighted toward rejection (CRYPTO-04)')` → `expect(REJECT_VECTORS.length).toBeGreaterThan(ACCEPT_VECTORS.length)`. Read at HEAD: **7 reject, 5 accept**. Before this phase the relation was true and unasserted |
| The `>= 7` floor and the non-canonical-S case | `:307-310`, both present |
| Sync/async port boundary | `:895-915`, `describe('sync port and async port agree on every reject vector (T-25-16)')`, all seven malformed vectors through both ports after `initEd25519()`. Plus `:798-820`, the port-vs-backend adapter agreement, whose accept half specifically refuses a *backwards* adapter |
| Vacuity floor | `:470-477`, `it('refuses to run against fewer than two backends')` → `toBeGreaterThanOrEqual(2)`, declared **before** the accept/reject describes so a failure names the floor, not a vector |
| **INFERRED marking present** | `:431-444`, heading *"Sited, not picked — and it does not bind on any measured host"*, and the sentence *"The hazard itself is **INFERRED** — read out of the selection logic above, never observed"*. `REQUIREMENTS.md:879` repeats it |

**The floor's slackness was re-measured, not taken on trust.** This verifier ran the file on
four engines and read the console line each time:

```
ed25519-backend.test.ts: backends available this run: noble, subtle   (node v25.9.0)
ed25519-backend.test.ts: backends available this run: noble, subtle   (chromium)
ed25519-backend.test.ts: backends available this run: noble, subtle   (webkit)
ed25519-backend.test.ts: backends available this run: noble, subtle   (firefox)
```

Every measured host reports two. The floor is therefore slack everywhere it has been run,
exactly as the docblock claims, and the INFERRED marking is the correct one.

**The falsifiability plant — corroborated, not reproduced.** The recorded plant
(`availableBackends` returning after the noble push; observed `expected 1 to be greater than
or equal to 2` with **1 failed | 31 passed**) was not re-executed here, for the concurrency
reason stated in the Method section. Three independent facts corroborate it: (a) the
assertion exists at `:470-477` and is reached — it is in this run's verbose output as a
passing case, so it is not `skip`ped or dead; (b) the recorded failure message is
character-for-character the template literal at `:473-475`, which a fabricated quote would
have to have been transcribed from the source anyway; (c) the "**31 passed**" figure is
arithmetically consistent with today's file — the run at HEAD reports **37 tests**, and 37
minus the 5 cases added since (the CRYPTO-04 weighting case at `:335` plus the four
cross-arm seeds' surroundings) is in the right neighbourhood, with the plant's own case
failing. **This is corroboration, not the observation itself**, and it is labelled as such.

`npx vitest run --project node packages/core/src/ed25519-backend.test.ts` → **37/37 passed,
EXIT=0**. `--project browser` (chromium/firefox/webkit) → **3 files, 111/111 passed,
EXIT=0**.

### §5 — The bundle delta, in the removal form — ⚠️ PARTIAL

**What is delivered, and it is real.** The guard is not a bare ceiling:

| Assertion | Location | Would a tree that removed nothing pass it? |
|---|---|---|
| manifest names no libsodium | `:243` | **No** |
| lockfile holds no libsodium key | `:250` | **No** |
| bare specifier resolution throws | `:261` | **No** |
| built bytes contain neither marker | `:271` | **No** |
| verifier build strictly larger than baseline (non-vacuity) | `:276` | passes — but it exists to catch a tree-shaken import, and its own plant is recorded (`expected 122 to be greater than 122`) |
| `delta <= VERIFIER_BUDGET_BYTES` (38912) | `:300` | **No** — re-attachment gives ≈181311 B |
| `delta < LIBSODIUM_MEASURED_GZIP_BYTES` (153005) | `:305` | **No** |

So the roadmap's stated *rationale* — *"A ceiling alone is satisfiable by doing nothing"* —
is satisfied with margin: **five of the seven assertions redden** if libsodium returns.

**Neither constant was bent, checked specifically.**

- `LIBSODIUM_MEASURED_GZIP_BYTES = 153_005` at `:399`. It was **not** inflated back to the
  retired 314.9 KB figure; the docblock at `:375-385` identifies the inherited number to the
  byte as 322427 B (unbundled `dist/modules` files as published) and retires it rather than
  averaging.
- `VERIFIER_BUDGET_BYTES = 38_912` at `:357`, **above** the measured delta at 1.375×
  headroom — it was not re-sited below the measurement to manufacture a ratio, which is the
  one move that would have made 10× arithmetically reachable.

**Independent re-measurement by this verifier**, own dual Vite library build, same procedure,
into the gitignored `tmp/`:

```
baselineGzip 124
verifierGzip 28506
delta        28382
markers      []
```

Recorded in the guard: 28306 B. My reading: **28382 B**, +76 B (+0.27%). The 1-2 B
`mkdtemp`-path variance the docblock cites does not account for 76 B; the most likely cause
is the different process environment (the guard's build runs inside vitest). **Immaterial to
every conclusion** — both readings sit at ≈73% of the 38912 ceiling and at ≈18.5% of 153005 —
but it is recorded rather than rounded away, because a number nobody re-took is how a stale
reading survives.

**Why this criterion is PARTIAL, in two parts.**

1. **The ROADMAP's literal clause `size asserted to have moved DOWN` is not implemented as a
   decrease, and cannot be.** The measured before/after across 28-02's uninstall was **28307 B
   → 28306 B** — unchanged. Plan 28-01 had already deleted the lazy
   `import('libsodium-wrappers')`, so by the time the criterion's own plan ran there were no
   bytes left to take off the page. The implemented substitute is `delta <
   LIBSODIUM_MEASURED_GZIP_BYTES`: *this surface costs less than the dependency that left*.
   That is a downward relation against a different artifact's historical weight, not a
   measured decrease of this one. **The phase states this at the top of the guard's own
   docblock (`:14-32`) rather than letting a reader discover it**, and explicitly refuses the
   claim that the uninstall moved 149.4 KiB off a page. The honesty is exemplary; the literal
   clause is still met by substitution, and that is an owner's call to accept.
2. **28-02-PLAN's `at least an order of magnitude` acceptance criterion is UNMET at 3.93×**
   (153005 / 38912; 5.41× against the raw delta), and is argued unreachable at any legal
   headroom — 4.5× even at the tightest permitted 1.2×. It is recorded unmet in three places
   (the guard docblock `:388-397`, `28-02-SUMMARY.md:306`, `REQUIREMENTS.md:880`) and in
   `28-04-SUMMARY.md`'s "What Phase 28 did NOT deliver" list, item 3. **Not closed by widening
   what counts as passing** — which is the outcome CLAUDE.md § Proofs demands.

Both are escalated to the owner rather than reported as defects, because neither is a thing
to fix: (1) has no decrease available to assert, and (2) is arithmetic.

### §6 — The WebKit finding is a guard, and the register is bounded both ways

**Behavioural half — reproduced by this verifier, not read.**
`npx vitest run --project browser packages/core/src/ed25519-backend.test.ts`, EXIT=0, 111/111:

| Engine | seeds 7 / 11 / 13 / 17 |
|---|---|
| node v25.9.0 | MATCHED ×4 |
| chromium | MATCHED ×4 |
| firefox | MATCHED ×4 |
| **webkit** | **DIFFERED ×4** |

Exactly the recorded table. All four verification directions passed on every engine, so the
divergent signatures are valid on both arms. **Byte-equality of Ed25519 signatures is
asserted in neither direction** (`:610-618` reports it via `console.log` and asserts nothing)
— `toEqual` would be red 4× on webkit and `not.toEqual` 12× across the other three, so either
would encode an engine rather than a property. The **one** byte-identity claim in the block is
X25519 agreement (`:636`), which is the contrast case and passes everywhere.

**Source-level half — the guard, and the register.**
`one-crypto-implementation.node.test.ts` Block 2 scans 153 comment-stripped production files
for three shapes (equality, keyed collection, converted-signature-as-key) with two exclusions,
each written for lines this tree really contains, and each with named negative fixtures. The
matcher is proved able to report **present** against five positive fixtures before any live
reading is believed.

The one legitimate comparison was read at source: `tools/aot/cli.ts:314`,
`if (!readBack.cid.equals(record.cid) || readBack.signature !== record.signature)` inside
`publishArtifact` — one `signName`, one `encodeNameRecord`, one `decodeNameRecord`, one
process, one engine. The hedged-nonce finding cannot reach it, and the register entry says
exactly that in 6 lines of reason (a `reason.length > 80` assertion enforces that it is a
reason, not a note).

**Set equality is asserted in BOTH directions**, and separately from the `toEqual`, so a
failure names which direction:

- `:610` no unregistered construct — `liveKeys \ registerKeys` must be `[]`
- `:615` no stale register entry — `registerKeys \ liveKeys` must be `[]`
- `:620` `expect(liveKeys).toEqual(registerKeys)`
- `:630` `SIGNATURE_COMPARISON_CEILING` asserted to be **exactly** `register.length + 1` —
  not merely `<=`, which is the 19-12 failure shape (a ceiling with slack stops binding)

**24/24 passed, EXIT=0.** The two recorded direction-plants (4 failed of 24; 3 failed of 24)
are corroborated-not-reproduced, per the Method section; the assertions they exercise are
present, reached and separately named.

---

## §7 — The three things that must not score as successes

### 7.1 Criterion 5's "order of magnitude" — confirmed UNMET, and confirmed unbent

Checked directly, not read: `LIBSODIUM_MEASURED_GZIP_BYTES = 153_005` (not 322427/314.9 KB)
and `VERIFIER_BUDGET_BYTES = 38_912` (above the measured 28306/28382 delta, not below it).
153005 / 38912 = **3.93×**. The phase records this unmet in four places and rescues it in
none. **No row anywhere claims the criterion met.** Verified by grepping the phase directory
and the ledger for `order of magnitude` — every hit is either the plan stating the
requirement or a document recording it unmet.

### 7.2 Behaviour-neutral in production — confirmed, and confirmed not over-claimed

The six direct `@noble/curves` verification sites exist at HEAD and route through no
selection layer:

`discovery.ts:122`, `capability.ts:249`, `enrollment.ts:702`, `:740`, `:759`, `:874`.

Nothing in production calls `initEd25519`, `getSyncVerifier`, `getAsyncVerifier` or
`createCryptoBackend` — the only non-test caller of `createCryptoBackend` is
`cert-lifecycle.ts:753/764/773`, and `cert-lifecycle.ts` itself has no production caller.
So no hazard left the trust path; a duplication left the package.

**No row or summary claims more.** Every occurrence of *"hazard … trust path"* in the phase
directory, in `REQUIREMENTS.md` and in the merged module's own docblock is a **negation**:
`ed25519-backend.ts:39` (*"this removes a duplication from the package, not a hazard from the
trust path"*), `28-01-SUMMARY.md:59`, `28-04-SUMMARY.md:266`, `28-CONTEXT.md:355`,
`REQUIREMENTS.md:712-715`, `CRYPTO-01`'s row. `REQUIREMENTS.md:714` goes further and tells a
future reader that finding such a claim is drift.

### 7.3 The port is not wired and the facades are not barrel-exported — confirmed not quietly done

- **Port unwired.** No production caller of `initEd25519` or `getSyncVerifier` anywhere in
  `packages`/`tools`/`bin` (verified by grep at HEAD; the only non-comment hits are the
  declarations themselves and the barrel re-export line).
- **Facades not barrel-exported.** `packages/core/src/index.ts` contains **no**
  `cert-lifecycle` export — the only mention of the file is a comment at `:399` recording
  that the facades are deliberately off the barrel. `createSubject`/`createIssuer`/
  `createVerifier` appear nowhere outside their own declarations.
- **The barrel got smaller, not larger.** `index.ts:403-410` exports five callable symbols
  from `ed25519-backend.ts` where seven stood before; `createCryptoBackend`,
  `nobleCryptoBackend` and `subtleCryptoBackend` were deliberately not added.
  `reachability-guard.node.test.ts` re-run by this verifier: **20/20 passed, EXIT=0**, with
  `OPEN_FINDING_CEILING = 47` and `DISPOSITION_CEILING = 26` in
  `reachability-dispositions.ts:243/252` — both lowered by 28-01, both binding.
- **The `demo-viewport` B5 repair is not claimed.** `28-04-SUMMARY.md:281` says so by name,
  and `deferred-items.md:50-54` says *"The repair is **not** Phase 28 work and this phase does
  not claim it"*. `grep` for `demo-viewport|viewport|B5` across the phase directory returns
  only the deferred-item entry and those two disclaimers.

---

## Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | ------------ | ------ | ------- |
| `packages/core/src/ed25519-backend.ts` | The one Ed25519 module, probe gate, no libsodium | ✓ VERIFIED | 337 lines, no stubs, no debt markers. One `detectCryptoBackend`, one-member `Ed25519Backend` union, no dynamic `import()` |
| `packages/core/src/ed25519-backend.test.ts` | Differential guard + floor + weighting + cross-arm block | ✓ VERIFIED | 916 lines. 37/37 node, 111/111 across 3 browser engines, EXIT=0 both |
| `packages/node/src/one-crypto-implementation.node.test.ts` | Source-level guards, both blocks | ✓ VERIFIED | 638 lines, 24/24 passed, EXIT=0. Corpus 153 files, floor `> 100` asserted |
| `packages/node/src/libsodium-absence.e2e.test.ts` | Absence three ways + built-bytes scan + size relations | ✓ VERIFIED | 399 lines, 9/9 passed, EXIT=0 |
| `packages/core/src/cert-lifecycle.ts` | Facades, backend block **removed** | ✓ VERIFIED | 775 lines; zero residual `subtle` implementation; imports `createCryptoBackend` from the merged module. 28/28 node tests, EXIT=0 |
| `packages/core/src/package.json` | No libsodium | ✓ VERIFIED | Five dependencies, none of them libsodium |
| `package-lock.json` | No libsodium key, transitive included | ✓ VERIFIED | `grep -c libsodium` → 0 |
| `.planning/REQUIREMENTS.md` CRYPTO-01…06 | Six rows, honest markers, six traceability rows | ✓ VERIFIED | 5 `[x]`, 1 `[ ]`; all six read by all four parser patterns |
| `packages/core/src/index.ts` | Facades and backend factories **off** the barrel | ✓ VERIFIED (correctly NOT wired) | 5 callable exports, down from 7; no `cert-lifecycle` export |

## Key Link Verification

| From | To | Via | Status | Details |
| ---- | --- | --- | ------ | ------- |
| `detectCryptoBackend` | the engine's real Ed25519 capability | `subtle.generateKey({name:'Ed25519'})` | ✓ WIRED | Probe observed running exactly once against a planted incapable engine; arm selected was `noble` |
| `initEd25519` | both ports | one memoised `createCryptoBackend()` | ✓ WIRED | Sync port always noble; async port an adapter with the argument reorder in exactly one place, asserted from both sides |
| `libsodium-absence.e2e.test.ts` | the real built bundle | Vite library build + `gzipSync` + marker scan | ✓ WIRED | Non-vacuity asserted separately (`verifier > baseline`), so a tree-shaken import cannot make a clean scan meaningless |
| `one-crypto-implementation.node.test.ts` | the real production tree | `walk` + `stripComments` | ✓ WIRED | Corpus floor `> 100` asserted; live positives required in both blocks so a blinded scan reddens |
| `CRYPTO-03` row | `createSubject`/`createIssuer`/`createVerifier` | `requirements-ledger`'s NO_CALLER instrument | ✓ WIRED | Row is in the `UNREACHED` population, not in the pinned-unread list, so its claim is actively checked |
| `initEd25519`/`getSyncVerifier` | `verifyChain`/`verifyCertificate` | — | correctly NOT WIRED | Explicit owner non-decision, stated in the module docblock, the ledger row and the summary's "did NOT deliver" list |
| `cert-lifecycle.ts` facades | `packages/core/src/index.ts` | — | correctly NOT WIRED | Explicit owner non-decision, priced at 12 callable exports |

## Data-Flow Trace (Level 4)

| Artifact | Data variable | Source | Produces real data | Status |
| --- | --- | --- | --- | --- |
| `ed25519-backend.ts` async port | `backend` | `createCryptoBackend()` → real `subtle` probe or noble | Yes — verified a real vector through the port on a planted incapable engine | ✓ FLOWING |
| `libsodium-absence.e2e.test.ts` | `verifier.text` / `verifier.gzipBytes` | real Vite build output read from disk | Yes — independently reproduced (28382 B delta, markers `[]`) | ✓ FLOWING |
| `one-crypto-implementation.node.test.ts` | `CORPUS` | `readFileSync` over 153 walked production files | Yes — floor asserted, live positives required in both blocks | ✓ FLOWING |
| `LIBSODIUM_MEASURED_GZIP_BYTES` | `153_005` | a **historical** reading whose entry can no longer be built | No — by construction, and the docblock says so | ⚠️ STATIC-BY-DESIGN (disclosed) |

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| Presence-passing, Ed25519-refusing engine selects noble | `node` with shadowed `crypto.subtle`, importing the real module | `selected arm: noble`, `generateKey calls: 1` | ✓ PASS |
| Bare specifier is gone, not merely unlisted | `node -e "require.resolve('libsodium-wrappers')"` | `MODULE_NOT_FOUND` | ✓ PASS |
| Built verification surface carries no libsodium bytes | independent dual Vite build + marker scan | `markers []`, delta 28382 B | ✓ PASS |
| Four ledger regexes read the six new rows | recomputed against live `REQUIREMENTS.md` | 102 / 102 / 102 / 102, 6 CRYPTO each | ✓ PASS |
| WebKit signature divergence is real | `--project browser` on the guard file | webkit DIFFERED ×4; chromium/firefox MATCHED ×4 | ✓ PASS |
| Repo type-checks | `npx tsc --noEmit` | EXIT=0 | ✓ PASS |

## Probe Execution

Not applicable. No `scripts/*/tests/probe-*.sh` exists in this repository and no PLAN or
SUMMARY in this phase declares one. The plant-and-watch-red cycles are this phase's
equivalent; see the Method section for which were reproduced, which were corroborated, and
why none were re-planted by this verifier.

## Requirements Coverage

| Requirement | Source plan(s) | Status | Evidence |
| ----------- | ---------- | ------ | -------- |
| CRYPTO-01 | 28-01, 28-03, 28-04 | ✓ SATISFIED (`[x]` — property of the module graph + a running guard) | §1; guard asserts the set by path and reads exactly one file |
| CRYPTO-02 | 28-02, 28-04 | ✓ SATISFIED (`[x]`) | §2; four absence readings taken directly by this verifier |
| CRYPTO-03 | 28-04 | ✓ SATISFIED as ledgered (`[ ]` **Built, not wired** — correctly unticked) | §3; facades exist and pass 28/28, nothing calls them, claim actively checked by the ledger guard |
| CRYPTO-04 | 28-03, 28-04 | ✓ SATISFIED (`[x]`) | §4; floor + weighting + port boundary, INFERRED marking present, slackness re-measured on 4 engines |
| CRYPTO-05 | 28-02, 28-04 | ⚠️ SATISFIED WITH RECORDED SHORTFALL (`[x]`) | §5; removal-form guard delivered and non-vacuous, order-of-magnitude sub-criterion unmet at 3.93× and recorded unmet |
| CRYPTO-06 | 28-03, 28-04 | ✓ SATISFIED (`[x]`) | §6; both halves, webkit divergence reproduced, both-direction set equality |

**No orphaned requirements.** The six ids declared across the four plans' frontmatter are
exactly the six in `REQUIREMENTS.md`'s Phase 28 family, and `grep -E "Phase 28"` over the
ledger surfaces no additional id mapped to this phase.

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| — | — | `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER`/"not yet implemented"/"coming soon" | — | **Zero matches** across all six of this phase's source and test files. No debt-marker gate triggered |
| `packages/core/src/ed25519-backend.ts` | 35 | Stale citation `capability.ts:219` | ℹ️ INFO | The cited `ed25519.verify` call is at `capability.ts:**249**` at HEAD. It **was** at `:219` until commit `31b64a6` — 28-01 itself — which moved `toBase64Url`/`fromBase64Url` into `capability.ts` and pushed the line down 30. The citation went stale in the same commit that wrote it. Repeated at `REQUIREMENTS.md:711`, `ROADMAP.md:1911`, `28-CONTEXT.md:39`, `28-01-PLAN.md:25`/`:69`, `28-01-SUMMARY.md:56`, `28-04-PLAN.md:68` — eight copies of one number. Comment-only; nothing reddens |
| `packages/core/src/index.ts` | 401-402 | Stale barrel price `75 → 87` / `49 → 61` | ℹ️ INFO | Correct figures are `73 → 85` / `47 → 59`. **Already recorded** by the phase itself in `deferred-items.md` §3 and inside the `CRYPTO-03` row, with the file named as outside 28-04's `files_modified`. Disclosed drift, not concealed |

Neither INFO item is a debt marker under the gate's definition, and neither affects an
assertion.

## Regression Checks

Every command below was run by this verifier, exit code read on the immediately following
line, no pipes.

- `npx tsc --noEmit` (whole repo): **EXIT=0**
- `npx vitest run --project node packages/core/src/ed25519-backend.test.ts`: **37/37, EXIT=0**
- `npx vitest run --project browser packages/core/src/ed25519-backend.test.ts`: **3 files / 111 tests, EXIT=0**
- `npx vitest run --project node packages/node/src/one-crypto-implementation.node.test.ts`: **24/24, EXIT=0**
- `npx vitest run --project e2e packages/node/src/libsodium-absence.e2e.test.ts`: **9/9, EXIT=0**
- `npx vitest run --project node packages/core/src/cert-lifecycle.test.ts`: **28/28, EXIT=0**
- `npx vitest run --project node packages/node/src/requirements-ledger.node.test.ts packages/node/src/acceptance-traceability.node.test.ts`: **61/61, EXIT=0**
- `npx vitest run --project node packages/node/src/reachability-guard.node.test.ts`: **20/20, EXIT=0**
- `git status --porcelain`: clean, before and after. Nothing staged, committed or stashed.

**No project was run in full**, per the brief. The full-project figures cited in the brief
(node 180/2606/1 skipped, browser 261/4488, e2e 28/183, `tsc` 0) were not re-taken; the files
this phase touches were re-run individually instead, plus a whole-repo `tsc`.

## Human Verification Required

### 1. Owner ruling on criterion 5

**Test:** Read §5 above, then decide whether the two shortfalls are accepted as the honest
end state.

**Expected:** One of —
- *Accept.* Criterion 5 closes with a recorded deviation: the removal-form guard is delivered
  and demonstrably non-vacuous (five independent reddenings if libsodium returns), the
  "moved DOWN" clause is satisfied by relation-to-the-dropped-dependency rather than by a
  decrease that does not exist, and 3.93× stands as the measured ratio.
- *Re-site.* The criterion is rewritten against the measured premises, or the guard gains a
  different downward relation.

**Why human:** Neither is a fact a scan settles. (a) There is no decrease available to
assert — 28-01 moved the bytes before 28-02 measured, so the before/after is 28307 → 28306,
and the phase says so at the top of the guard rather than burying it. (b) 3.93× is arithmetic
against two re-measured constants; making it 10× requires bending one of them, which the
phase explicitly refused and which this verifier confirmed it did not do. This is exactly the
*descoped is not satisfied; unmeasured is not met* boundary CLAUDE.md draws, and the ruling
belongs to the owner.

### 2. (Optional, cheap) Re-plant CRYPTO-04's backend floor when the tree is not shared

**Test:** With no concurrent agents in the tree, plant `return backends` immediately after
the noble push in `availableBackends()`, run `--project node
packages/core/src/ed25519-backend.test.ts --reporter=verbose`, restore by the surgical
inverse, `cmp` against a pre-plant snapshot.

**Expected:** `a differential guard needs two implementations to differ — this host offered
1: noble`, exit 1, with the accept and reject vector cases still green.

**Why human:** This verifier declined to plant because two sibling verifiers were running
concurrently in this working tree and CLAUDE.md forbids parallel plants on shared source. The
claim is corroborated three independent ways in §4 but the observation itself was not
re-taken. This is a nice-to-have, not a blocker — the assertion demonstrably exists and runs.

## Gaps Summary

**No gaps.** Nothing is missing, stubbed, unwired-that-should-be-wired, or claimed beyond
what was delivered.

Five of the six ROADMAP success criteria are met outright, and four of those five were
verified by *reproducing the underlying observation* rather than by reading a test file: the
probe-versus-presence distinction was exercised behaviourally against a planted engine in a
separate process; libsodium's absence was read out of the manifest, the lockfile,
`node_modules`, a live `require.resolve` and an independently-built bundle; the "+6 on four
regexes" was recomputed from the literal patterns; and WebKit's signature divergence was
reproduced across three real engines.

Criterion 5 is **partial and escalated, not failed**. Its guard is delivered in the removal
form the criterion asks for and is demonstrably not satisfiable by doing nothing. What falls
short is (a) a literal clause the tree cannot satisfy — there is no decrease to assert,
because the earlier plan already moved the bytes — and (b) a plan-level ratio that is
arithmetic. **Both were reported by the phase against its own interest, in four places, and
neither constant was bent to rescue them.** That is the behaviour this repository's
conventions ask for, and it is why this closes as an owner decision rather than as a defect.

The three things this verification was told must not score as successes do not: the
order-of-magnitude criterion is recorded unmet everywhere it appears; every mention of
"hazard … trust path" in the phase is a negation, and the six direct `@noble/curves` sites
were re-confirmed at HEAD; and neither the port nor the barrel export was quietly done — the
barrel in fact got *smaller*. The `demo-viewport` B5 repair is disclaimed by name in two
places.

Two INFO-level documentation drifts are recorded: eight copies of a `capability.ts:219`
citation that 28-01 itself invalidated (now `:249`), and the already-self-reported stale
barrel price at `index.ts:401-402`. Neither carries an assertion and neither is a debt marker.

---

_Verified: 2026-08-11T03:09:26Z_
_Verifier: Claude (gsd-verifier)_
