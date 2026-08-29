# RCA: the `browser` CI job fails intermittently, always in webkit, on a different Ed25519 spec each time

Produced by the rival-agent Five Whys protocol: two investigators in isolated worktrees on a
hypothesis-free brief, two skeptics cross-assigned to destroy the other's chain, arbitration
here. Every link below carries a filled evidence slot. **Written before the fix**, which is the
one ordering rule the previous attempt at this investigation broke.

## Symptom

```
OBSERVED:  FAIL  browser (webkit)  packages/browser/src/dispatch-chain.browser.test.ts
             > chainsForOwner — a tab mints a chain for a key it cannot export
             > stops a dispatch to a node it minted nothing for instead of sending it bare
           OperationError: The operation failed for an operation-specific reason
            Test Files  1 failed | 341 passed (342)
                 Tests  1 failed | 5747 passed | 9 skipped (5757)
EXPECTED:   Test Files  342 passed (342)
```

**REPRODUCE:** no local reproduction existed when this began; establishing one was half the
work. It is now:

```
docker run --rm -v /tmp/wk-repo:/repo -w /repo mcr.microsoft.com/playwright:v1.62.0-noble \
  sh -lc 'npx vitest run --project browser'
```

against a Linux copy of this repository. 3 of 12 consecutive runs go red with
`OperationError`, against 10 of 41 on CI after the unrelated defect below was excluded —
**25% versus 24.4%**. The engine-level event underneath reproduces at 20 000 samples in
seconds, and that is what the chain is built on.

## The chain

**WHY-1: the fourteen red `browser` jobs are not one defect. Ten are this class; four are a
deterministic, since-fixed defect; one is a missing artifact in all three engines.**

  EVIDENCE — EXPERIMENT, both skeptics independently:
```
for jid in <14 browser job ids>; do gh api .../jobs/$jid/logs | grep -ac "OperationError"; done
  98661670387 OperationError_lines=0   98669013704 OperationError_lines=0
  98673569341 OperationError_lines=0   98680651215 OperationError_lines=0 process_ReferenceError=4
  98688798907 OperationError_lines=2   <- first job of the keygen class
```
  The four earliest failing jobs contain **no `OperationError` anywhere**. They fail on
  `non-canonical S component (S >= L)`, which is deterministic rather than a draw:
```
docker run … malleability.mjs   (S+L malleated signature, 200 verifications per engine, Linux)
  chromium {"goodTrue":200,"badTrue":0,"badFalse":200}
  firefox  {"goodTrue":200,"badTrue":0,"badFalse":200}
  webkit   {"goodTrue":200,"badTrue":200,"badFalse":0}
```
  A 1/256 event cannot produce 200/200. Fixed by `760476f` (2026-08-27 14:36:32 -0700) and
  `abe81ea` (14:44:28); the first green follows at 14:44:40 and the family never recurs in the
  remaining 42 attempts. Job `98661670387` additionally fails `elflift.wasm 404` in **all three
  engines** — not webkit-only, not Ed25519.

  RIVAL VERDICT: **REFUTED in both chains as originally stated.** Both investigators wrote
  "always in webkit, one class"; both skeptics broke it, separately, by the same partition.
  Both chains' headline rate ("~25%", "~30%") was computed over a non-homogeneous population
  spanning three tree states.

**WHY-2: within the surviving class, every failure terminates at one call —
`crypto.subtle.generateKey({ name: 'Ed25519' }, …)` — with nothing between it and the spec.**

  EVIDENCE — EXPERIMENT: all seven `OperationError` job logs, not the two first cited:
```
OperationError: The operation failed for an operation-specific reason
 ❯ generateSubtleKeyPair packages/core/src/ed25519-backend.ts:339:45
 ❯ visitorKeyPair packages/browser/src/visitor-key.ts:144:50
   … and, in the other three,
 ❯ visitorPair packages/browser/src/dispatch-chain.browser.test.ts:25:44
```
  7 of 7. No other frame appears.

  RIVAL VERDICT: SURVIVES — attacked by pulling all seven logs rather than the cited two.

**WHY-3: one full lane run makes exactly 53 such calls per engine, and 27 of them are bare —
one `await`, no catch, no retry.**

  EVIDENCE — EXPERIMENT: a setup file wrapping `crypto.subtle.generateKey`, tagging engine and
  caller, over the full lane:
```
npx vitest run --config vitest.count.config.ts --project browser   EXIT=0
159 instrumented calls, all Ed25519:  53 chromium   53 firefox   53 webkit
```
  CODE — `packages/core/src/ed25519-backend.ts:368-379`, the production funnel:
```
  const generated = await subtle.generateKey({ name: 'Ed25519' }, false, ['sign', 'verify'])
  if (!('privateKey' in generated)) {
    throw new TypeError('subtle.generateKey answered a single key where a pair was required')
  }
  return generated
```

  RIVAL VERDICT: SURVIVES, **and it settled a numerical disagreement between the two chains.**
  Investigator A counted 53 per engine; investigator B counted 106 with 54 bare. The
  instrumented count is 53/53/53, and every one of B's five categories is exactly 2×. Verified
  independently here against the source: `webcrypto-ed25519.browser.test.ts` holds **7**
  `subtle.generateKey` sites and CI's own line reads `(7 tests)`. **A was right.** The
  correction improves B's own fit (19.5% predicted vs 15.2% observed, against its 35% vs 22%)
  and dissolves the one anomaly B honestly flagged as unexplained.

**WHY-4: in the Linux WebKit build CI installs, that call refuses ~0.78% of attempts. The same
build on macOS refuses none.**

  EVIDENCE — EXPERIMENT, four independent hammers by three agents:
```
linux/amd64  n=20000 ok=19836 err=164  -> 0.82%      linux/arm64 n=20000 ok=19855 err=145 -> 0.725%
linux/amd64  n=20000 ok=19840 err=160  -> 0.80%      linux/arm64 n=12000            err=85  -> 0.71%
macOS, same playwright build:  n=5000 ok=5000 errs={}
```
  Pooled ≈0.72–0.88% against 1−(255/256)² = **0.781%** predicted.

  RIVAL VERDICT: SURVIVES — re-run from scratch by both skeptics, including one that first
  measured 500/500 `TypeError` because `about:blank` is not a secure context and rebuilt the
  probe over `http://127.0.0.1`.

**WHY-5: it refuses exactly when the drawn key has a zero most-significant byte, in either
component. The refusal is a property of the value, not of the moment.**

  EVIDENCE — EXPERIMENT, the census of the keys that *survived*:
```
Linux,  19855 successes: "tally":{"d0":0,"d31":69,"x0":0,"x31":84}   expected per byte 77.6
Linux,   5958 successes: "pub0_zero":0,"d0_zero":0,"distinct_pub0":255,"distinct_d0":255
macOS,   5000 successes: {"d0":21,"d31":17,"x0":20,"x31":13}
```
  Zero at byte 0 where ~78 are expected; present at byte 31; 255 distinct first-byte values,
  missing only `0x00`. Reproduced here independently at n=8000: `d0:0, x0:0` for Ed25519.

  RIVAL VERDICT: SURVIVES.

**WHY-6: WebKitGTK's WebCrypto is built on libgcrypt, which returns minimal-length unsigned
integers — so a 32-byte value beginning `0x00` comes back as 31 bytes.**

  EVIDENCE — EXPERIMENT:
```
ldd /ms-playwright/webkit-2336/minibrowser-gtk/lib/libwebkitgtk-6.0.so.4
  libgcrypt.so.20 => /lib/aarch64-linux-gnu/libgcrypt.so.20      (amd64 image: x86_64 path)
  — no libcrypto, no libssl, no nettle
```
  and, with no WebKit involved at all, a C probe against the same libgcrypt 1.10.3:
```
gcc gcrypt-probe.c $(libgcrypt-config --cflags --libs) && ./p 20000
  q length 31 bytes: 71   q length 32 bytes: 19928
  d length 31 bytes: 79   d length 32 bytes: 19921
  q shorter than 32: 0.0036   d shorter than 32: 0.0040   1/256 = 0.00391
```

  RIVAL VERDICT: SURVIVES — the skeptic compiled its own C probe rather than re-running the
  investigator's.

**WHY-7: `gcryptGenerateEd25519Keys` reads those integers with the non-padding `mpiData()`,
and the caller then discards any pair that is not exactly 32+32 bytes.**

  EVIDENCE — CODE, `Source/WebCore/crypto/gcrypt/CryptoKeyOKPGCrypt.cpp`:
```
 :68   static … gcryptGenerateEd25519Keys()
 :90       auto q = mpiData(qMpi);
 :91       auto d = mpiData(dMpi);
 :115  std::optional<CryptoKeyPair> CryptoKeyOKP::platformGeneratePair(…)
 :123      keyPair = gcryptGenerateEd25519Keys();
 :138      if (!(publicKeyData.size() == 32 && privateKeyData.size() == 32))
 :139          return std::nullopt;                  // -> OperationError
```
  `GCryptUtilities.cpp:133-149` defines `mpiData` as `gcry_mpi_print(GCRYMPI_FMT_USG, …)` —
  minimal unsigned form. The padding helper the generate path needs is declared in the same
  header and **called nowhere in this file**:
```
GCryptUtilities.h:85  std::optional<Vector<uint8_t>> mpiZeroPrefixedData(gcry_mpi_t, size_t targetLength);
grep -n "mpiZeroPrefixedData" CryptoKeyOKPGCrypt.cpp   -> no hits, EXIT=1
```

  RIVAL VERDICT: SURVIVES. Attacked as "sits near, does not establish": `:138` consumes exactly
  what `:91-92` produced through `:123`, so the link is causal rather than adjacent. Both
  investigators reached this file independently; one skeptic fetched it to look for a rival
  mechanism and found none.

## Root cause

**The mechanism is WHY-7, and it is not in this repository.** WebKit's libgcrypt-backed OKP
key-generation path converts variable-width integers to bytes without left-padding and then
rejects anything not exactly 32+32, so ~2 draws in 256 are thrown away as `OperationError`.

**The deepest link removable here is WHY-3** — and, corrected by the arbitration below, it is
sharper than either chain proposed: *this repository has no single funnel for Ed25519 key
generation.* 27 of the 53 draws per lane run are bare, spread over six files, each
independently exposed. A retry inside the one production helper is **not** the root: measured,
it moves the symptom rather than removing it.

**WHY IT STOPS HERE:** replacing `mpiData` with `mpiZeroPrefixedData(mpi, 32)` at those two
lines would make the class impossible, and that is an upstream change this repository can only
file, not make. Deeper than WHY-7 is not a defect at all: libgcrypt returning the minimal
big-endian encoding of an integer is the documented, correct behaviour of an arbitrary-precision
type — measured in WHY-6 — and padding to a wire width is the caller's job.

**SIBLING CASE:** X25519 key generation, same file, same helper — but `gcryptGenerateX25519Keys`
(`:97-112`) takes only `d` through `mpiData` while `q` comes from a fixed-width scalar
multiplication that never touches an integer object.
PREDICTED: **half** the Ed25519 rate, 1/256 = 0.391%, with `d[0]` filtered and `x[0]` **not**.
OBSERVED, three independent runs: `0.39%` (`d0:0, x0:66`), `0.42%` (`d0_zero:0, pub0_zero:88`),
`0.30%` (`d0_zero:0, pub0_zero:15`); and here at n=8000, `0.45%` with `d0:0, x0:30`.
A different number, not a restatement — which is what makes it a boundary test rather than an
echo. **Negative siblings, also checked and also predicted:** signing, raw and JWK import,
export and X25519 `deriveBits` are all unaffected, because the signature path pads explicitly
(`CryptoAlgorithmEd25519GCrypt.cpp:36-50`). 20 000 signatures, 0 errors. The class is confined
to key generation.

## Rival chains

**INVESTIGATOR A ROOT:** WHY-7, the engine source line, with the repository-side fix placed
deliberately one link up.
**INVESTIGATOR B ROOT:** the same mechanism, but naming WHY-3 (bare call sites) as the root
because it is what this repository can remove.

**AGREEMENT: converged on the same mechanism by independent evidence**, having never seen each
other's work — different containers, different probes, different architectures, and A reaching
the WebKit source while B reached the same conclusion statistically and said so.

**DIVERGED on two points, both resolved by measurement rather than by vote:**

1. *How many draws per run.* Resolved by instrumentation: 53 per engine, 27 bare. A right, B
   double. Verified here against the source and against CI's own per-file test counts.
2. *Whether the proposed fix reaches the root.* Resolved by a paired experiment — 25 webkit
   runs with the fix applied, comparing the three files it protects against the three it does
   not:
```
TOTALS  A_FAIL=0  B_FAIL=4  of 25
   all four are OperationError, all in webcrypto-ed25519.browser.test.ts
```
   **Neither chain's fix makes the class impossible.** It moves the CI symptom from ~25% to
   ~16–18%. Both chains said so in their own words — A as "per-spec judgement", B as an
   explicitly costed item 3 — but neither drew the depth-rule conclusion, and the skeptic's
   paired run is what forced it.

## Flip test

**FLIP: PROVED** — by the arbiter on the real engine against the real repository, and twice
more by the two skeptics at the engine level.

**The arbiter's run, which is the authoritative one.** Four specs that draw keys, twenty runs
per arm, inside the Linux container, changing exactly one constant between the arms:

```
ARM 1  fix applied (KEYGEN_ATTEMPTS = 3)     FIXED      runs=20  red=0
ARM 2  cause re-injected (KEYGEN_ATTEMPTS = 1, nothing else changed)
                                             REINJECTED runs=20  red=4   all OperationError
RESTORED  cmp against the fixed file -> EXIT=0
```

4 of 20 is 20%, against 19 protected draws × 0.78% ⇒ 14% predicted — the same order, on a
sample this small. The symptom was made to disappear and return on command.

```
FIX APPLIED (bounded retry, K=3, in the production funnel), real WebKit, same harness:
  ATTEMPTS 1: {"N":6000,"ok":5955,"err":45,"kinds":{"OperationError":45},"totalCalls":6000}
CAUSE RE-INJECTED (K back to 1 — the only re-injectable form, see below):
  ATTEMPTS 3: {"N":6000,"ok":6000,"err":0,"kinds":{},"retried":45,"totalCalls":6045}
```
45 → 0, with **exactly 45** second attempts: every refusal cleared on the redraw. That measures
the independence the residual arithmetic assumes instead of assuming it. Independently, against
the repository's own module source bundled into the container's WebKit: `159 → 0` at
K=3, with an engine that genuinely lacks Ed25519 still refused after exactly 3 attempts.

**What is NOT flippable, stated rather than omitted:** the cause itself — the engine's discard —
cannot be re-injected, because it lives in a shipped browser binary. What was flipped is the
repository's *exposure* to it. That is a weaker result than a true cause-flip and is recorded as
such.

**RESTORED:** all four worktrees back at `3f82a0d`, each `cmp`-verified byte-identical against
pre-edit snapshots, `git status --porcelain` empty in every one.

## Contradicted documentation

Three claims in this repository are falsified by the evidence above. Under the evidence
contract a document never fills a slot — and a wrong one is itself a finding.

1. **`packages/core/src/ed25519-backend.test.ts:531-534` and `.planning/OPEN-ITEMS.md:244-259`**
   — *"the split is by OS, not by browser"*, said of non-canonical-S acceptance in all three
   engines. Measured in one container, one malleated signature, 200 verifications per engine:
   chromium and firefox on Linux **reject**; only webkit accepts. The split is by **engine**.
   Consequence worth more than the correction: the malleability finding and this flake are the
   same component — WebKit's libgcrypt backend — differing only in defect.
   Related: `isKnownMalleabilityPlatform` (`:221-224`) keys on `Linux`/`X11`, and
   `navigator.platform` reads `Linux x86_64` in all three engines, so the predicate is broader
   than the finding; harmless today only because a second conjunct gates it.
2. **`packages/browser/src/visitor-key.ts:19-20`, `packages/core/src/ed25519-backend.ts:355`,
   `packages/core/src/enrollment.ts:538`** — each states that Ed25519 `generateKey` *"succeeds
   in chromium, firefox and webkit"*. It succeeds **99.2%** of the time on the Linux WebKit this
   project's own CI runs. All three cite one measurement taken on macOS, where the rate
   genuinely is zero: the measurement was right and the generalisation was not.

## Fix

**CHANGE:** funnel every Ed25519 key generation through one retrying helper. Retry is the right
instrument here and not a papering-over, because each attempt is a **fresh random draw** — the
condition that refused is re-drawn, not re-asked, which the 45-retries-45-cleared reading above
measures directly.

**NOT FIXED HERE**, each named with why:

- **The engine defect.** Belongs upstream; the repository can file it, not fix it.
- **X25519 key generation.** Affected at half the rate and unreachable: no production call site
  exists (`grep -rn "generateKey" packages/*/src` finds none for X25519).
- **`webcrypto-ed25519.browser.test.ts`.** Its subject *is* raw WebCrypto, so a silent retry
  there would hide the very finding this report is about. Its setup keygens should route through
  the helper while the calls that measure `generateKey` itself stay raw and record the refusal
  rate.
- **Three further intermittent classes surfaced by the container baseline and outside this
  chain**, reported rather than folded in: `start-unwind.browser.test.ts` (firefox, 6 of 12
  runs), `idb-identity-store.browser.test.ts` (firefox, 2 of 12), and
  `worker-executor.test.ts` (webkit and chromium, 1 each of 12 — a spec added 2026-08-28 whose
  sequencing rests on absolute millisecond gaps, which this repository's own conventions warn
  against). None is Ed25519. **"Always in a spec that mints an Ed25519 key" has stopped being
  true**, and any future reading of this lane's redness must partition before it counts.

**One measurement disagreement left open, deliberately.** The arbiter's own 12 full-lane
container runs produced **zero** Ed25519 failures where the skeptic's 12 webkit-only runs
produced three. At p≈0.19 per run, zero in twelve is an 8% outcome — unlikely rather than
impossible, and the two loops differed in engine scope. Neither number is discarded; both are
recorded, and no rate claim in this report rests on either alone.
