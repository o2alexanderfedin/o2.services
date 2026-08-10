---
phase: 28-one-cryptographic-implementation
plan: 3
subsystem: core-crypto
tags: [ed25519, differential-conformance, anti-vacuity, source-scanning-guard, webkit, signature-identity]
requires:
  - packages/core/src/ed25519-backend.ts
  - packages/node/src/strip-comments.ts
provides:
  - "a differential-conformance guard that refuses to run against fewer than two backends, watched red against a one-backend plant"
  - "an asserted rejection weighting, so the corpus cannot be silently rebalanced toward accept"
  - "cross-arm Ed25519 signing proved mutually verifiable on chromium, firefox and webkit and never asserted byte-identical"
  - "a source-level guard: exactly one production file performs WebCrypto Ed25519 operations, asserted by path"
  - "a source-level guard: no production file treats signature bytes as an identifier outside a one-entry register with a ceiling"
affects:
  - packages/core/src/ed25519-backend.test.ts
  - packages/node/src/one-crypto-implementation.node.test.ts
tech-stack:
  added: []
  patterns:
    - "a differential guard asserts its own cardinality before it compares anything"
    - "a register asserted against the live scan in BOTH directions — an unregistered finding and a stale permission both fail"
    - "a byte-identity relation that is engine-dependent is reported, never asserted"
key-files:
  created:
    - packages/node/src/one-crypto-implementation.node.test.ts
  modified:
    - packages/core/src/ed25519-backend.test.ts
decisions:
  - "The backend floor is INFERRED, not observed — every measured host reads two, and the docblock says so rather than implying the floor closed a live failure"
  - "Ed25519 byte-equality is asserted in NEITHER direction: toEqual is red on webkit, not.toEqual is red on the other three"
  - "Barrels are INCLUDED in this guard's corpus, departing from requirements-ledger.node.test.ts, because neither claim here is about call sites"
  - "The conversion arm is narrowed to conversions used as keys — a bare 'computed expression mentioning signature' arm raises five live non-hazards"
metrics:
  duration: ~85 min
  completed: 2026-08-10
---

# Phase 28 Plan 03: The Two Guards — Summary

Obligation 4's vacuity hole is closed by a `backends.length >= 2` floor that has been
watched fail; obligation 6's WebKit finding is now two guards, one behavioural across
three engines and one that reads the tree. Both plants live inside files this plan owns.

## Obligation 4 — the backend floor

`packages/core/src/ed25519-backend.test.ts`, its own named `it`, declared **before** the
accept and reject describes inside `differential-conformance guard — every backend this
host can run`, so it runs first and a failure names the floor rather than a vector.

```
it('refuses to run against fewer than two backends', () => {
  expect(backends.length, …).toBeGreaterThanOrEqual(2)
})
```

**Sited against 28-01's recorded per-engine lists.** Re-read live this plan, verbatim,
identical on all four engines:

```
ed25519-backend.test.ts: backends available this run: noble, subtle
```

— node (Node v25.9.0), chromium, firefox, webkit. So the floor is **slack on every host
anybody has run**, and the docblock says that plainly: it is a guard against a future
host, not a fix for a current failure. The hazard is **INFERRED** from reading
`availableBackends()`'s selection logic, never observed, because no measured engine here
refuses Ed25519.

### The watched-red plant, verbatim

`availableBackends()` planted to `return backends` immediately after the noble push.
`npx vitest run --project node --reporter=verbose packages/core/src/ed25519-backend.test.ts`,
`EXIT=$?` read on the next line: **1**.

```
ed25519-backend.test.ts: backends available this run: noble

 FAIL  |node| packages/core/src/ed25519-backend.test.ts > differential-conformance guard — every backend this host can run > refuses to run against fewer than two backends
AssertionError: a differential guard needs two implementations to differ — this host offered 1: noble. Every "the backends disagreed" loop below would pass by comparing a backend with itself.: expected 1 to be greater than or equal to 2
 ❯ packages/core/src/ed25519-backend.test.ts:464:7

 Test Files  1 failed (1)
      Tests  1 failed | 31 passed (32)
```

**The measurement that matters is the 31.** All five accept-vector cases and all seven
reject-vector cases stayed green under the plant, as did both pre-existing cardinality
assertions. The vacuity this floor closes is invisible to every other case in the file —
which is exactly the "proof that cannot fail" shape, demonstrated rather than argued.

Restored by the surgical inverse of the one-line insertion; `cmp` against a snapshot taken
immediately before planting reported **IDENTICAL to pre-plant snapshot**. Never `cp`,
never `git stash`, never `git checkout --`.

## Obligation 4 — the rejection weighting, asserted

Beside the existing `>= 7` floor and the name-uniqueness check, both of which stay:

```
it('the vector corpus stays weighted toward rejection', () => {
  expect(REJECT_VECTORS.length, …).toBeGreaterThan(ACCEPT_VECTORS.length)
})
```

Read 2026-08-10: **7 reject, 5 accept**. Before this plan the weighting was true and
unasserted — three added accept vectors would have inverted it with nothing going red.

## Obligation 4 — the sync/async port boundary, pinned by name

`describe('sync port and async port agree on every reject vector (T-25-16)', …)` is
untouched, still iterates `REJECT_VECTORS`, and still runs all seven malformed vectors
through both ports after `initEd25519()`. `grep -n "sync port and async port agree on
every reject vector"` matches at `:883`.

## Obligation 6, behavioural half — cross-arm signing

`describe('cross-arm signing is mutually verifiable, never byte-identical (CRYPTO-06)',
…)`, four seeds (7, 11, 13, 17), each asserting all four verification directions:
noble→noble, noble→subtle, subtle→subtle, subtle→noble. **Every one passed on every
engine.**

### Per-engine byte-match verdict, as printed

| Engine | seeds 7 / 11 / 13 / 17 |
|---|---|
| node (v25.9.0) | MATCHED ×4 |
| chromium | MATCHED ×4 |
| firefox | MATCHED ×4 |
| **webkit** | **DIFFERED ×4** |

```
ed25519-backend.test.ts: cross-arm seed 7 on webkit: noble and subtle signature bytes DIFFERED (both verified by both arms)
ed25519-backend.test.ts: cross-arm seed 7 on chromium: noble and subtle signature bytes MATCHED (both verified by both arms)
ed25519-backend.test.ts: cross-arm seed 7 on firefox: noble and subtle signature bytes MATCHED (both verified by both arms)
ed25519-backend.test.ts: cross-arm seed 7 on node: noble and subtle signature bytes MATCHED (both verified by both arms)
```

Four seeds rather than one, so webkit's divergence reads as its nonce construction and not
as a coincidence on a single input.

**Byte-equality of Ed25519 signatures is asserted in neither direction**, deliberately:
`toEqual` would be red four times on webkit, `not.toEqual` twelve times across node,
chromium and firefox. Either would encode an engine rather than a property. The acceptance
grep confirms it —
`grep -nE "signature[A-Za-z]*\).?(toEqual|toStrictEqual)\(.*signature"` returns nothing.

**X25519 is the contrast case and the only byte-identity claim in the block**:
`agreeX25519` over the same key pair is asserted byte-identical across arms, and passes on
all three engines. Without it the block would read as "cross-arm agreement is generally
impossible", which is false — the divergence is specific to signature nonces.

Engine attribution uses a `engineLabel()` helper whose ordering is load-bearing: Chrome's
user-agent contains `AppleWebKit`, so the Firefox and Chrome tests precede the WebKit one.

## Obligation 6, source-level half — `one-crypto-implementation.node.test.ts`

637 lines, 24 cases, one corpus computed once at module scope: **153 comment-stripped
production `.ts` files** under `packages/` and `tools/`, `*.test.ts` excluded.

**One deliberate departure from `requirements-ledger.node.test.ts`: barrels are not
excluded.** That file drops `index.ts` because a barrel is not a *caller*, an argument
about call sites. Neither claim here is about calls, and a hand-written comparison inside
a barrel would be a real finding. Measured cost of including them: eight extra files, zero
extra findings in either block after stripping.

### Block 1 — CRYPTO-01, one WebCrypto Ed25519 implementation

Predicate `/\{\s*name:\s*['"]Ed25519['"]/`. **Post-merge match set, taken this plan rather
than trusted:**

```
['packages/core/src/ed25519-backend.ts']
```

asserted with `toEqual` against a set of **paths, not a count**, so a second
implementation is reported by name. That file carries **five** hits — `:222`, `:223`
(`importKey`/`sign` on the subtle arm), `:228`, `:229` (`importKey`/`verify`), `:281` (the
surviving `generateKey` capability probe) — against the plan's pre-merge table of
`cert-lifecycle.ts` 5 + `ed25519-backend.ts` 2. `crypto_sign_verify_detached` matches
**zero** files.

The bare string `'Ed25519'` is deliberately *not* the predicate: it appears at
`identity.ts:110`/`:180`, `audience-key.ts:77` and `fabric-node.ts:1933` as libp2p
key-type names.

#### The `stripComments` plant, watched red — verbatim

`stripComments(readFileSync(path, 'utf8'))` → `readFileSync(path, 'utf8')`. Exit **1**:

```
 FAIL  |node| packages/node/src/one-crypto-implementation.node.test.ts > CRYPTO-01 — exactly one production file performs WebCrypto Ed25519 operations > the matching set is exactly one file, named by path
AssertionError: expected [ …(4) ] to deeply equal [ Array(1) ]

- Expected
+ Received

  [
+   "packages/core/src/cert-lifecycle.ts",
    "packages/core/src/ed25519-backend.ts",
+   "packages/core/src/index.ts",
+   "packages/libp2p/src/identity.ts",
  ]

 ❯ packages/node/src/one-crypto-implementation.node.test.ts:218:46

 Test Files  1 failed (1)
      Tests  1 failed | 23 passed (24)
```

**Three extra files, not one.** The plan predicted `identity.ts:70`'s docblock; the tree
also holds `cert-lifecycle.ts:453` and `index.ts:390`, two comments **written by Plan
28-01** to record where the block moved. So an unstripped scan reports four WebCrypto
Ed25519 implementations in a tree that has one, and three of those false reports were
created by the very phase this guard closes. Restored by surgical inverse; `cmp` reported
**IDENTICAL to pre-plant snapshot**.

### Block 2 — CRYPTO-06, signature bytes are not an identifier

`findSignatureIdentityConstructs(file, stripped): readonly Finding[]` — a named,
separately-testable function, three arms and two exclusions:

| Arm | What it raises |
|---|---|
| `equality` | `===`/`!==` where an operand names a signature |
| `keyed` | `.set(` `.add(` `.has(` `.get(` `.delete(` `new Map(` `new Set(` whose **first argument** (extracted with a depth counter, so `toHex(signature)` is not truncated at its own parenthesis) names a signature |
| `conversion-key` | a computed key `[…]` holding a template-literal interpolation of, or a `toHex`/`toString`/`toBase64Url`/`base64`/`btoa` call over, a signature |

An operand "names a signature" if it contains `signature` in either casing of the capital,
**or** matches `\bsig[A-Z0-9]` — the camel-case abbreviation, so `sigA === sigB` is caught
rather than being a hole reachable by renaming a variable. Not widened to a bare `sig`
stem, which would fire on `sign`, `signer`, `signed`, `signal`. Measured: the tree holds
exactly three `sig[A-Z]` identifiers, all `sigNode` in `x509.ts:912`/`:924`/`:927`, none of
them an identifier-against-identifier comparison — so the form costs zero live findings.

**Exclusions, both written for lines this tree really contains:**

- **(a) the line contains `typeof`** — `protocol.ts:310`, `:383`, `:615`, `:815`, `:841`,
  five `typeof signature !== 'string'` type guards over a decoded wire field.
- **(b) either operand is a quoted string literal** — `mutation-ledger.ts:3084`
  (`entry.signatureSource === 'test-title'`), `:3147`
  (`entry.signatureSource === 'rendered-at-runtime'`), and `reduce-job.ts:286`
  (`trustedIssuers === 'checks-no-combine-signatures'`, raised only because the literal
  contains the word).

Two corrections to the plan's `<interfaces>` table, from re-measurement: the
mutation-ledger lines are at **`:3084` and `:3147`**, not `:3070`/`:3133`, and the second
is `'rendered-at-runtime'`, not a second `'test-title'`. `reduce-job.ts:286` is a third
excluded line the plan did not name.

**Nine candidates raised across the tree, eight excluded, one kept.**

#### The register, in full

```ts
const ACCEPTED_SIGNATURE_COMPARISONS: readonly AcceptedComparison[] = [
  {
    file: 'tools/aot/cli.ts',
    text: 'readBack.signature !== record.signature',
    reason:
      'A serialisation-fidelity check, not an identity. `publishArtifact` signs a name record, ' +
      'encodes it with `encodeNameRecord`, decodes it straight back with `decodeNameRecord`, and ' +
      'asserts the round trip preserved both the CID and the signature — one engine, one signing ' +
      'operation, one value, inside one process. The WebKit hedged-nonce finding cannot reach it: ' +
      'there is no second engine and no second signing operation for it to differ from. Were this ' +
      'comparison instead made against a signature produced elsewhere, it would be exactly the ' +
      'hazard this guard refuses.',
  },
]

const SIGNATURE_COMPARISON_CEILING = 2
```

The entry is anchored by **file plus source text**, never a line number, so an unrelated
edit above `cli.ts:314` does not invalidate it. The ceiling is asserted to be exactly
`register.length + 1`, and its docblock names the 19-12 precedent — the mutation ledger's
floor stale at 23 against a ledger of 42, with nothing saying so.

#### Set equality, both directions, each watched red

Three live assertions — `unregistered = live \ register` empty, `stale = register \ live`
empty, and `liveKeys toEqual registerKeys` — plus a live-positive case requiring
`tools/aot/cli.ts::readBack.signature !== record.signature` to be present, so the scan
cannot pass by reading nothing.

**Direction 1 — an unregistered finding fails.** Exclusion (b) disabled
(`if (false && (QUOTED_LITERAL.test(left) || …)) continue`). **4 failed | 20 passed**:

```
AssertionError: these treat signature bytes as an identity and are not in the register: expected [ …(3) ] to deeply equal []
+ [
+   "packages/net/src/reduce-job.ts::trustedIssuers === 'checks-no-combine-signatures'",
+   "packages/node/src/mutation-ledger.ts::entry.signatureSource === 'rendered-at-runtime'",
+   "packages/node/src/mutation-ledger.ts::entry.signatureSource === 'test-title'",
+ ]
```

Both exclusion fixtures reddened alongside it, so that plant doubles as proof exclusion
(b) is load-bearing on the real tree.

**Direction 2 — a stale register entry fails.** Anchor text changed to
`record.signatureBytes`, an expression the tree does not contain. **3 failed | 21 passed**:

```
AssertionError: the register may not carry a permission the live scan no longer finds: expected [ Array(1) ] to deeply equal []
+ [
+   "tools/aot/cli.ts::readBack.signature !== record.signatureBytes",
+ ]
```

Both plants restored by surgical inverse; `cmp` reported **IDENTICAL to pre-plant
snapshot** on both.

#### Fixtures

Five positives (`readBack.signature !== record.signature`; `sigA === sigB`;
`seen.set(toHex(signature), …)`; `seen.has(signatureHex)`;
`{ [toHex(signature)]: record }`) and eight negatives, of which four are shapes the tree
really contains (`typeof signature !== 'string'` in one- and two-clause form,
`entry.signatureSource === 'test-title'` and `=== 'rendered-at-runtime'`,
`trustedIssuers === 'checks-no-combine-signatures'`, `value['signature']`) plus
`signatureCount === 3`, `signer === issuer` and `signed === expected`.

## Verification

`EXIT=$?` was read on the line immediately after every command, output redirected to a
file and read separately — no pipes, no trailing `tail`. Each project's exit code was
written to **its own file inside the background script**, immediately after its own
command, because 28-02 recorded a composite background command returning shell exit 0
while the e2e project inside it exited 1.

| Command | Exit | Result | `real` | `(user+sys)/real` |
|---|---|---|---|---|
| `npx tsc --noEmit` | **0** | whole repository, clean | — | — |
| `npx vitest run --project node` (**full**) | **0** | **180 files, 2606 passed / 1 skipped (2607)** | 351.61 | 1.275 |
| `npx vitest run --project browser` (**full**) | **0** | **261 files, 4488 passed** | 42.67 | 2.95 |
| `npx vitest run --project e2e` (**full**) | **0** | **28 files, 183 passed** | 453.10 | 0.52 |
| `--project node` ed25519-backend only | **0** | 37 passed (was 30) | — | — |
| `--project browser` ed25519-backend only | **0** | 3 files, 111 passed (37 × 3 engines) | — | — |
| `--project node` one-crypto-implementation only | **0** | 24 passed | — | — |

**Count reconciliation, so the numbers are not merely quoted.** The node baseline recorded
by 28-01 and 28-02 is 179 files / 2575 passed / 1 skipped. This plan adds 7 cases to
`ed25519-backend.test.ts` (the floor, the weighting, four cross-arm seeds, the X25519
contrast) and one new file of 24: 2575 + 7 + 24 = **2606**, 179 + 1 = **180**. Exact. The
browser baseline is 4467; the same 7 cases run on three engines, 4467 + 21 = **4488**.
Exact.

The e2e project's `(user+sys)/real` of 0.52 is expected and not a starvation reading: e2e
is Playwright-driven with `fileParallelism: false`, so the process spends most of `real`
waiting on browsers and servers rather than on CPU.

**The e2e project is green in a single whole-project run.** Phase 27 merged with it red
because every invocation across ten summaries was file-scoped; 28-02 recorded it red at
1 failed / 27 passed on `demo-viewport.e2e.test.ts`'s B5 assertion. That failure was fixed
by `dde1ff5`/`f42e985` before this plan started, and this is the first whole-project e2e
run on this branch since — 28 files, 183 tests, exit 0.

## Deviations from Plan

**1. [Measurement contradicts plan] The comment-stripping plant names three extra files,
not one**

- **Found during:** Task 2's falsifiability proof.
- **The plan predicted:** the unstripped scan reddens naming `packages/libp2p/src/identity.ts`.
- **Measured:** it names `cert-lifecycle.ts`, `index.ts` **and** `identity.ts`. The first
  two are comments Plan 28-01 wrote to record the merge.
- **Not narrowed to match the prediction.** The verbatim four-element output is what is
  recorded in the block's docblock, and the stronger reading strengthens the case for
  `stripComments` rather than weakening it.

**2. [Measurement contradicts plan] Two of the plan's cited exclusion lines had moved, and
one was misdescribed**

- `mutation-ledger.ts:3070`/`:3133` are now `:3084`/`:3147`, and `:3147` compares against
  `'rendered-at-runtime'`, not a second `'test-title'`. A third excluded line the plan did
  not name, `reduce-job.ts:286`, is raised only because a string literal contains the word
  "signatures".
- Re-taken rather than transcribed, per the plan's own instruction to re-measure.

**3. [Rule 2 — deliberate narrowing] The conversion arm is keys-only**

- **Found during:** Task 2, measuring arm shapes before writing them.
- **Issue:** the plan's third pattern read loosely enough to be implemented as "a computed
  expression mentioning signature". Measured, that raises five live lines, none of them an
  identity: `value['signature']` (`naming.ts:131`), `record['signature']`
  (`protocol.ts:382`), `[entry.signature]` (`mutation-ledger.ts:3172`) and two `caughtBy:`
  arrays of filenames.
- **Fix:** implemented as the plan's actual wording — a *conversion* of a signature *used
  as a key*. Five register entries for zero hazards is how a register stops being read.

**4. [Reported, not hidden] Exclusion (a) is not independently load-bearing on this tree**

- All five `typeof signature !== 'string'` lines are *also* caught by exclusion (b),
  because `'string'` is a quoted literal. Disabling (a) alone changes nothing live.
- (a) is kept, held by its two fixtures, and the docblock says so: it names the intent —
  a type guard is not a byte comparison — so a future rewrite of (b) does not silently
  take five type guards with it.

**5. [Rule 1 — caught by a guard, fixed] The vocabulary guard refused the first GREEN
commit**

- One clause of the CRYPTO-06 docblock used a verb built on the fourth banned stem in
  `vocabulary.node.test.ts`'s list — the paid-work one — in the ordinary English sense of
  deserving a place. The guard does not read intent, which is the whole point of it:
  1 failed / 266 passed. Reworded to "it keeps its place"; the re-commit passed 7 files /
  267 tests. This summary states the incident without quoting the word, for the same
  reason.

**6. [Departure, argued] Barrels are included in the corpus**

- `requirements-ledger.node.test.ts:224-229` excludes `index.ts`; this guard does not,
  because that exclusion's reason is about call sites and neither claim here is. Stated in
  the predicate's docblock with its measured cost: eight extra files, zero extra findings.

## TDD Gate Compliance

Task 2 carried `tdd="true"` and both gates are in `git log`:

- **RED** — `3753cb1` `test(28-03): the RED gate …`, with
  `findSignatureIdentityConstructs` throwing. Watched fail before implementation:
  ```
   FAIL  |node| packages/node/src/one-crypto-implementation.node.test.ts [ … ]
  Error: findSignatureIdentityConstructs is not implemented (packages/aot/src/abi-router.ts, 1536 chars)
   Test Files  1 failed (1)
        Tests  no tests
  ```
  The throw aborts collection, so the file reports `no tests` rather than a case count —
  recorded as observed rather than tidied into a nicer-looking red.
- **GREEN** — `7b0b0e0` `feat(28-03): the GREEN gate …`, 24 passed.
- **REFACTOR** — none; no cleanup commit was warranted.

Task 1 was not marked `tdd`; its falsifiability is the watched-red floor plant above.

## Out of scope, deliberately not taken

- **The port is not wired into `verifyChain`/`verifyCertificate`.** Owner non-decision,
  unchanged.
- **Nothing is barrel-exported.** Owner non-decision. `findSignatureIdentityConstructs` is
  `export`ed from a `.test.ts` file, which is outside every barrel and outside the
  reachability corpus, so **no ceiling moved**: 73 / 47 / 15 are untouched, and the
  reachability guards passed in the full node run.
- **`STATE.md`, `ROADMAP.md` and `REQUIREMENTS.md` are not updated.** The executing brief
  barred every `gsd-sdk query state.*` and `roadmap.update-plan-progress` verb. Ledger
  reconciliation for this phase is Plan 28-04's.

## Threat Flags

None. No new network endpoint, auth path, file access pattern or schema change at a trust
boundary. Both new files are tests. The plan's five registered threats are mitigated and
each mitigation was watched working rather than reasoned about:

- **T-28-10** (differential guard self-comparison): the floor, watched red at 1 failed /
  31 passed.
- **T-28-11** (malformed-input agreement): weighting asserted, `>= 7` floor and
  name-uniqueness kept, sync/async block unchanged and still running all seven vectors.
- **T-28-12** (signature bytes as identity): source-level register with both-directions
  equality, each direction watched red; behavioural half green on chromium, firefox and
  webkit with byte-equality asserted in neither direction.
- **T-28-13** (a second Ed25519 implementation returning): match set asserted by path;
  `crypto_sign_verify_detached` refused anywhere in production.
- **T-28-14** (a blind source scan): both live positives present and asserted, and the
  comment-stripping plant watched red naming four files.

## Known Stubs

None.

## Commits

- `01aedbc` — `test(28-03): the differential guard gets a floor it has been watched fail against`
  (1 file, +223/−5).
- `3753cb1` — `test(28-03): the RED gate …` (1 file, +511, new file).
- `7b0b0e0` — `feat(28-03): the GREEN gate …` (1 file, +129/−3).

`git show --stat` was read after each; every commit contains only this plan's own file and
none deletes a tracked file. All three were made with `git commit -m "msg" -- <path>`,
never bare.

## Self-Check: PASSED

- `packages/core/src/ed25519-backend.test.ts` and
  `packages/node/src/one-crypto-implementation.node.test.ts` both present on disk.
- `01aedbc`, `3753cb1`, `7b0b0e0` all present in `git log`.
- `git status --porcelain` clean before each `git add`, and no `git add` was issued while a
  test run was in flight.
- Acceptance greps: `toBeGreaterThanOrEqual(2)` matches at `:464`; `sync port and async
  port agree on every reject vector` matches at `:883`; the Ed25519 byte-equality grep
  returns nothing; `stripComments` (6) and `ed25519-backend` (9) both present in the new
  file.
- `STATE.md`, `ROADMAP.md` and `REQUIREMENTS.md` **not** updated, per the executing brief.
