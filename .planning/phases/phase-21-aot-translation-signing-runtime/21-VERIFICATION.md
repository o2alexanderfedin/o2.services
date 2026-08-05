---
phase: 21-aot-translation-signing-runtime
verified: 2026-08-05T07:45:16Z
status: ruled # the owner ruling this pass asked for was taken 2026-08-05; see `ruling` below. Score UNCHANGED at 2/3.
ruling: >-
  OWNER RULING 2026-08-05, on task #64. Criterion 2's re-tag clause is RECORDED AS A MEASURED
  NEGATIVE, on AOT-05's precedent — the same disposition v1.0 took for the V8 code-cache result.
  The score does NOT move: criterion 2 stays PARTIAL and Phase 21 stays 2/3. What the ruling
  settles is the REASON, which had been pending since this pass was written.
  The two alternatives were declined on the merits, both by this pass's own measurement: a name
  allow-list decides the clause but makes `--image` pointless, which is the flag's whole purpose;
  and amending the clause was already rejected once as unmeasurable, because the classic-store
  daemon exits 1. Under this project's rule that unmeasured is not met, a third option of
  scoring it MET off the unit-level `resolveImage` refusal was never available.
  The clause is therefore CARRIED, not cleared, and Phase 21 does not close on it — the same
  disposition as 13.1 (6/7), 16 (3/4), 17 (1/3), 18 (8/9), 19 (4/5) and 20 (6/7). The count is
  over criteria, never over requirements.
  REQUIREMENTS.md already carried the measured-negative wording in three places before this
  ruling; the ruling makes the verification agree with the ledger rather than the other way round.
score: >-
  2/3 criteria MET (1 PARTIAL, 0 FAILED). Criterion 2 is PARTIAL on one clause only —
  the re-tag refusal — which this pass RE-MEASURED BY HAND and confirms is not met on
  this host for a reason that is about the containerd image store and not about this
  code. Its second clause (changing a covered input moves the emitted CID) is MET.
  Criteria 1 and 3 are MET and were both re-executed from source by this verifier,
  including both router mutations and a real CLI lift of both guests.
verifier: independent goal-backward pass, adversarial stance, all figures re-measured
head: 7c8baa8
branch: feature/phase-18-discovery-capacity-placement
host: >-
  MacBookPro18,3, 8 cores, 32 GB, Darwin 26.5.2, Docker Server 29.4.0 (containerd image
  store). elfconv image PRESENT at sha256:22a404f31c9f7bb5c49e3193081d4876718253d86747aae3d30fcfd971f19c05.
  Three other agents (20-09, 20-11, one on late-combine.node.test.ts) worked this same
  checkout throughout; load average moved between 24 and 277 across this pass.
overrides_applied: 0
mutations_replanted_by_verifier: 2 # A and B, both in packages/aot/src/abi-router.ts, both observed red, both restored by cp + cmp exit 0
runs: # exit codes read with EXIT=$? on the line immediately after the command, no pipes, no trailing tail
  - command: "npx tsc --noEmit"
    exit: 0
    result: "whole tree, no output"
  - command: "npx vitest run --project node packages/node/src/aot-dispatch.node.test.ts --reporter=verbose"
    exit: 0
    result: >-
      3 passed. grossFuel=208 usefulFuel=104 multiplier=2; wire 5660003 bytes,
      fetched=true, ok=true, dir grew 3→5. real 88.54 user 11.94 sys 4.18.
      NOTE origin=cache for both guests — see W3.
  - command: "npx vitest run --project node tools/aot/echo-guest.node.test.ts --reporter=verbose (attempt 1, load avg 277, four foreign elfconv containers up)"
    exit: 1
    result: >-
      1 file FAILED, 9 tests SKIPPED — "Hook timed out in 900000ms". echo lift
      613 617 ms and produced NO artifact (status=n/a); hello lift 370 962 ms,
      status=2, artifact 5 662 885 bytes, printed key CID
      bafyreid77bug7uea74pkfb26rqn6yidrn2bajl2uxylylvngaeiyu3s2ja. real 1001.22.
      See W1 — the 15-minute hook budget is not sited against a contended host.
  - command: "npx vitest run --project node tools/aot/echo-guest.node.test.ts --reporter=verbose (attempt 2, load avg 24, one container)"
    exit: 0
    result: >-
      9 passed. echo status=2, 5 660 003 bytes, key CID
      bafyreiexejqg25mxzjlybzrzq5sfdk2roy7kkjs5e4jrnfl46jatw73pgm, lift wall 391 442 ms;
      hello status=2, 5 662 885 bytes, key CID
      bafyreid77bug7uea74pkfb26rqn6yidrn2bajl2uxylylvngaeiyu3s2ja, lift wall 351 698 ms.
      real 754.42 user 4.16 sys 1.62, ratio 0.008 (waiting on containers, not starved).
      BOTH key CIDs and BOTH artifact byte counts are byte-identical to 21-04's and
      21-05's tables — a fifth and sixth independent same-host lift.
  - command: "npx vitest run --project node tools/aot/lift.node.test.ts tools/aot/cli.node.test.ts"
    exit: 0
    result: "2 files, 151 passed, NO skip line — the HAVE_IMAGE-gated cases ran. real 263.49"
  - command: "npx vitest run --project node packages/aot"
    exit: 0
    result: "9 files, 265 passed | 1 skipped"
  - command: "npx vitest run --project node packages/node/src/fabric-node.node.test.ts --reporter=verbose"
    exit: 0
    result: "15 passed, including both AOT-04 node-level cases"
  - command: "npx vitest run --project node packages/node/src/requirements-ledger.node.test.ts packages/node/src/trust-anchors.node.test.ts"
    exit: 0
    result: "2 files, 45 passed — AOT-02's checkable claim and the WasiExecutor census both hold"
  - command: "npx vitest run --project node packages/node/src/slow-specs.node.test.ts (twice, 40 min apart)"
    exit: 1
    result: >-
      1 failed | 8 passed BOTH TIMES — "the node project holds 150 test files, the
      recorded measurement covered 144". Drift 6 against tolerance 5. See W2.
probes_executed:
  - mutation: >-
      A (21-CONTEXT's seventh, 21-05's Mutation A) — abi-router.ts
      `return wantsWasi ? this.#wasi.execute(task) : this.#native.execute(task)`
      -> `... ? this.#native.execute(task) : this.#native.execute(task)`
    command: "npx vitest run --project node packages/node/src/aot-dispatch.node.test.ts packages/aot/src/abi-router.test.ts --reporter=verbose"
    exit: 1
    result: >-
      5 failed | 14 passed (19) — EXACTLY 21-05's recorded count. The capture that
      carries the criterion clause reproduced verbatim: "translated job incomplete;
      failure reasons: [8 × instantiation failed: WebAssembly.instantiate(): Import #0
      \"wasi_snapshot_preview1\": module is not an object or function]". The
      unplanned fourth capture also reproduced: the wire case's pre-branch cross-check
      fired with fetched=true, ok=false. `Import #0 "o2"` count: 0 — Mutation A cannot
      reach the native direction, exactly as 21-05 states.
    restored: "cp from /tmp/v21-scratch; cmp exit 0; git status --short on the file empty"
  - mutation: >-
      B (21-CONTEXT mutation 6, 21-05's Mutation B) — the same line inverted:
      `return wantsWasi ? this.#native.execute(task) : this.#wasi.execute(task)`
    command: "npx vitest run --project node packages/aot/src/abi-router.test.ts packages/node/src/two-process.node.test.ts packages/node/src/aot-dispatch.node.test.ts --reporter=verbose"
    exit: 1
    result: >-
      3 files failed, 12 failed | 10 passed (22). `Import #0 "o2"` — the NATIVE
      namespace — appears 5 times in this three-file subset. two-process.node.test.ts,
      a pre-existing spec that knows nothing about this phase, went red on all three of
      its cases ("completes 4 shards at R=2 in two separate agent processes"). This is
      the discriminator: it reddens the direction Mutation A cannot reach, so a router
      that was merely wired in with one arm hard-coded is excluded.
    restored: "cp from /tmp/v21-scratch; cmp exit 0; git status --short on the file empty"
  - probe: "docker tag re-measurement, by hand, this verifier"
    command: >-
      docker tag ghcr.io/yomaytk/elfconv:arm64 o2-verify/elfconv:borrowed;
      docker image inspect <both> --format '{{json .RepoDigests}}'; docker rmi o2-verify/elfconv:borrowed
    exit: 0
    result: >-
      BEFORE the tag, canonical returns ["ghcr.io/yomaytk/elfconv@sha256:22a404f3…"].
      AFTER the tag, the BORROWED name returns
      ["o2-verify/elfconv@sha256:22a404f3…","ghcr.io/yomaytk/elfconv@sha256:22a404f3…"]
      and the CANONICAL name returns THE IDENTICAL LIST. `resolveImage`'s repository
      match therefore SUCCEEDS on the borrowed name. Tag removed; canonical image intact.
      21-02's finding and the AOT-02 row's re-statement are BOTH CONFIRMED independently.
  - probe: "the shard input block length the fuel arithmetic rests on"
    command: "node --experimental-strip-types over encodeCanonical({n:1,tag:'echo'})"
    exit: 0
    result: "13 bytes. So 13+13=26 per dispatch, 8×26=208 gross, 4×26=104 useful, multiplier 2 — the numbers my own run produced."
  - probe: "the two artifact CIDs, recomputed independently through @o2/net's blockCid"
    command: "node --experimental-strip-types over blockCid(readFileSync(<each cached artifact>))"
    exit: 0
    result: >-
      echo 5660003 -> bafyreibgiyiuhmbv6tfgh4khvt4derezweyysvxxsu7f76ysnpsxkfc72e;
      hello 5662885 -> bafyreidtuj6grhekedsiidjshhvti6i7k2sbi7svtyotlao2vwdic6myue.
      Both byte-identical to 21-04's and 21-05's tables. sha-256 of both files on disk
      also byte-identical to both summaries.
gaps:
  - criterion: 2
    status: partial
    truth: >-
      Re-tagging a local translated image under a different name and pointing the CLI at
      it is refused rather than hashed under the borrowed name
    reason: >-
      MEASURED AND NOT MET on this host — re-measured by hand by this pass, not accepted
      from 21-02. On Docker Server 29.4.0 with the containerd image store, `docker tag`
      gives the borrowed repository its own `RepoDigests` entry carrying the origin's
      manifest digest, so `resolveImage`'s repository match SUCCEEDS and the borrowed
      name is adopted into the translation key. Worse for any repair: `RepoDigests` is a
      property of the image ID, not of the reference inspected, so once a borrowed tag
      exists the CANONICAL name answers with a byte-identical list — measured directly
      above. No predicate over that data can refuse one call and admit the other.
      This is *measured and not met*, which is a different state from *unmeasured*, and
      it must not be scored MET off the unit-level `resolveImage` refusal, which is
      driven by a stub emitting a digest list `docker tag` no longer produces.
    artifacts:
      - path: "tools/aot/lift.ts — `resolveImage`, the `match === undefined` branch"
        issue: >-
          The refusal is correct and enforced where the data supports it; the data no
          longer distinguishes a borrowed name from a canonical one on this image store.
      - path: "tools/aot/cli.node.test.ts — the case titled 'measures what `docker tag` leaves in RepoDigests, because the refusal turns on it'"
        issue: >-
          The tree PINS the negative rather than hiding it: it asserts the borrowed entry
          exists, asserts the two readings are `toEqual`, asserts an `every` rule would
          falsely refuse the canonical image, and asserts the driver's stderr adopts
          `image o2-local/elfconv@sha256:`. It passed in this pass (151 passed, no skips).
    missing:
      - >-
        EITHER a mechanism that does not rest on `RepoDigests` — the only candidate this
        pass could identify is refusing any `--image` whose repository is not on a
        declared allow-list, which converts content addressing into a name allow-list and
        makes `--image` useless for the purpose 21-CONTEXT decision 5 added it for. That
        is a scope decision an executor may not take.
      - >-
        OR an owner ruling amending criterion 2's first clause to the measured reading
        (the digest recorded is truthful, so no unknown toolchain runs under a trusted
        name; what is recorded is an unportable LOCAL name). RULING A forbids doing this
        silently.
      - >-
        The clause is NOT deferred: `roadmap.analyze` over Phases 22 (Reachability Guard),
        23 (Multi-process Benchmark Driver) and 24 (Certificate-Gated Admission) shows no
        goal or success criterion touching image resolution, `RepoDigests` or AOT-02.
        It belongs to Phase 21 as an open escalation.
human_verification:
  - test: >-
      Decide whether Phase 21 may close at 2/3 with criterion 2's re-tag clause carried
      as a measured negative, or whether the clause is amended.
    expected: >-
      A ruling, not a finding. Everything the phase can prove is proved and was re-proved
      here. What blocks a `passed` verdict is that one clause of one criterion is
      demonstrably unachievable by any predicate over the data the mechanism has — which
      is neither "done" nor "an executor forgot", and the house rule is that lowering a
      bar is not clearing it.
    why_human: "Only the owner may amend a criterion or accept a measured negative in its place."
  - test: >-
      Decide who owns the `slow-specs.node.test.ts` red and the file-count re-measurement.
    expected: >-
      The node project now holds 150 test files against a recorded 144 — drift 6, tolerance
      5, RED in two runs 40 minutes apart. 21-05 predicted this in writing ("the next test
      file added anywhere in the node project reddens it") at drift 5; Phase 20-11's
      `checkpoint-agents.node.test.ts` (commit f906d66) is the file that tipped it, not
      Phase 21's. Re-measuring `MEASURED_NODE_SPANS` requires a full `--reporter=json` run
      whose numbers this phase has independently shown to be wrong for hook-heavy files.
    why_human: "Cross-phase ownership plus a known-broken instrument; not Phase 21's to close alone."
  - test: >-
      Decide whether `tools/aot/echo-guest.node.test.ts` keeps a 900 000 ms hook budget.
    expected: >-
      On a contended host this pass measured the two lifts at 613 617 ms + 370 962 ms and
      the file failed with all nine cases SKIPPED. On a quiet host, 391 442 + 351 698 ms —
      inside budget with ~20 % margin. The budget was sited against 21-04's ~200 s
      readings. A CI host is a contended host.
    why_human: "Choosing a wall-clock budget is a policy call about how long CI may block."
warnings:
  - id: W1
    status: NEW, MEASURED TWICE by this pass
    where: "tools/aot/echo-guest.node.test.ts — `PREPARE_TIMEOUT_MS`, used as the `beforeAll` budget"
    what: >-
      Criterion 1's emission half is load-sensitive to the point of not running. Under
      load average 277 with four foreign elfconv containers up, the echo lift took
      613 617 ms and returned NO artifact (`status=n/a`, i.e. the CLI was killed rather
      than exiting), the hook blew its 900 000 ms budget, and all nine cases were skipped.
      Re-run at load 24 it passed 9/9. The file's own docblock says "a skipped `it.skipIf`
      reports green inside an aggregate pass" — this failure mode is the sibling and is
      LOUDER (the file goes red), which is the better direction, but the criterion is
      unmeasured on any run that hits it.
  - id: W2
    status: NEW, MEASURED — the tree is RED and Phase 21 spent the last unit of tolerance
    where: "packages/node/src/slow-specs.node.test.ts, `FILE_COUNT_TOLERANCE`"
    what: >-
      150 files against a recorded 144: drift 6, tolerance 5, `1 failed | 8 passed` in two
      runs 40 minutes apart. 21-05 recorded drift 5 and wrote down the prediction; it came
      true within hours. Attribution by reading the tree, not by plausibility:
      `aot-dispatch.node.test.ts` (b0dd390, Phase 21) is one of the six over the recorded
      count and consumed the last unit of margin; `checkpoint-agents.node.test.ts`
      (f906d66, Phase 20-11) is the file that tipped it. **Phase 21 did not leave the tree
      red by itself, and it did leave it with zero margin.**
  - id: W3
    status: NEW, MEASURED — the criterion-3 file stops exercising the CLI once a host is warm
    where: "packages/node/src/aot-dispatch.node.test.ts — `ECHO_CACHE` / `HELLO_CACHE`"
    what: >-
      21-05's deviation 1 caches the lifted artifact under
      `tools/aot/fixtures/lifted-<label>-<sha of the C>.wasm`. On this (warm) host the
      spec logged `origin=cache status=n/a keyCid=n/a` for both guests — so the run that
      produced my criterion-3 reading did NOT invoke `tools/aot/cli.ts` in its own process.
      The criterion's *produced by `tools/aot/cli.ts`* clause still holds, but it is
      carried by three things OUTSIDE that file rather than inside it: the cache is
      written only by a CLI lift; the sha-256 of both cached files matches what the CLI
      emitted; and `echo-guest.node.test.ts`, which uses NO cache, lifted both guests
      through the real CLI in this pass. Worth knowing because 21-05's claim "all three
      cases RAN on a cold cache through the real CLI" is true of 21-05's session and is
      NOT re-establishable by re-running the file.
  - id: W4
    status: NEW, MEASURED FALSE — a machine-readable field contradicting the prose above it
    where: ".planning/phases/phase-21-aot-translation-signing-runtime/21-03-SUMMARY.md, frontmatter `requirements-completed:`"
    what: >-
      The frontmatter reads `requirements-completed: [AOT-04]`. The same file's body says
      "**AOT-04 is deliberately not marked complete in `REQUIREMENTS.md` by this plan**",
      and `.planning/REQUIREMENTS.md` carries AOT-04 as an unchecked `- [ ]` row marked
      **Partial**. The other four summaries in this phase all read
      `requirements-completed: []`. Whichever tool reads that field is being told the
      opposite of what the phase decided.
  - id: W5
    status: NEW, MEASURED — the wire-transfer elapsed figure does not reproduce at the recorded magnitude
    where: "21-05-SUMMARY.md, the wire table: 'elapsed 158 / 177 / 689 ms across three runs'"
    what: >-
      This pass measured the same dispatch at **4 657 ms** — 7× to 29× the recorded band.
      Everything else in that table reproduced exactly (5 660 003 bytes offered,
      `fetched=true`, `ok=true`, dir grew 3→5, `statSync` size equal). The outcome is
      solid; the *duration* is a single-host, single-load reading presented as a band and
      should not be quoted as a property of the fabric. Phase 13.1 should take the byte
      count and ignore the milliseconds.
  - id: W6
    status: CONFIRMED STALE, as 21-04 and 21-05 each reported
    where: ".planning/REQUIREMENTS.md — the AOT-02 and AOT-04 traceability rows"
    what: >-
      AOT-02's row still says "the emitted CID has never been compared across two
      genuinely different inputs end to end (Plan 21-04)". 21-04 did exactly that and this
      pass re-executed it (two real lifts, two different printed key CIDs, `inputDigest`
      the one covered input that moved). AOT-04's row still says its outstanding half is
      "the ABI verified against a real elfconv artifact … across real processes (Plan
      21-05)"; 21-05 delivered it and this pass re-executed it. **AOT-02's *checkable*
      claim — "`describeKey` is reachable only through `describeLift`" — was re-derived by
      grep and is still TRUE** (one production caller, `lift.ts`'s `describeLift`), which
      is why `requirements-ledger.node.test.ts` stays green (45 passed) while the prose
      around it has gone stale. Both plans were correctly forbidden from editing that file
      in a shared tree; its owner should now correct it.
  - id: W7
    status: NEW, INFORMATIONAL
    where: ".planning/ROADMAP.md — Phase 21's `Mode: mvp` line"
    what: >-
      Phase 21 declares `Mode: mvp`, but its Goal is an outcome statement rather than the
      "As a … I want to … so that …" User Story that MVP-mode verification is defined
      against, so the User Flow Coverage table that mode calls for cannot be produced. This
      is a project-wide condition, not Phase 21's — Phases 18, 19 and 20 all carry
      `Mode: mvp` with outcome-statement goals, and 18-VERIFICATION.md and
      19-VERIFICATION.md both scored against the ROADMAP Success Criteria instead. This
      pass follows that precedent. Either the goals or the mode marker should move.
assertions_that_cannot_fail:
  # Every one below was already labelled at the line by the executor who wrote it. This
  # pass found NO NEW un-failable assertion in the phase's own specs — which is the first
  # time in three phases (18, 19, 21) that has been true, and is reported as a finding.
  - where: "packages/node/src/aot-dispatch.node.test.ts — `expect(aliceCids.map(String)).toEqual(bobCids.map(String))`"
    why: "Two `FsBlockstore.put` calls over the same bytes in one process cannot disagree."
    labelled: true
    carries: "nothing about the code under test; it guards a future edit. 21-05's plant S1 shows what it does catch."
  - where: "packages/node/src/aot-dispatch.node.test.ts — the wire case's refused arm, `expect(outcome.reason.length).toBeGreaterThan(0)`"
    why: "The arm never executes on this host (`fetched` read `true` in every run, mine included), and a refusal reason is never the empty string."
    labelled: true
    carries: "nothing. What carries the arm is the pre-branch cross-check, which 21-05's plant S3 shows can fail."
  - where: "tools/aot/echo-guest.node.test.ts — `expect(echoKey.target).toBe(helloKey.target)`"
    why: "Both sides read the same imported `LIFT_TARGET` in the same process."
    labelled: true
    carries: "nothing. `toolchain` and `features` beside it are parsed from two separate CLI stdouts and do carry evidence."
  - where: "tools/aot/echo-guest.node.test.ts — the three byte-count lines (`inputBytes`, `stdoutBytes`, `stdinConsumed`)"
    why: "Guarded by the same case as `outcome.ok` and `outcome.value`; every plant tried fires on one of those two first."
    labelled: true
    carries: "not independently shown able to fail. 21-04 states this rather than implying it."
deferred: [] # nothing in this phase's open items is addressed by Phases 22, 23 or 24
---

# Phase 21: AOT Translation Signing & Runtime — Verification Report

**Phase goal:** `translationCid` is called by the lift pipeline itself and the CLI emits the CID it
produces; a production node constructs a real `WasiExecutor` so a translated artifact dispatched to
a running node executes instead of failing at instantiate

**Verified:** 2026-08-05T07:45:16Z (HEAD `7c8baa8`, branch `feature/phase-18-discovery-capacity-placement`)
**Status:** human_needed
**Score: 2/3 criteria MET, 1 PARTIAL, 0 FAILED**

Scored against the criteria as they read at `.planning/ROADMAP.md` under `### Phase 21: AOT
Translation Signing & Runtime`, quoted verbatim in each section below. **Nothing in this report is
taken from a SUMMARY.** Every figure was re-measured on this host by this pass, every mutation was
re-planted and watched go red, and the one clause the summaries report as *not met* was
re-measured by hand with `docker tag` rather than accepted.

---

## Criterion scores

| # | Criterion | Score | Where the evidence is |
|---|---|---|---|
| 1 | The CLI against a real AArch64 binary produces a `TranslationRecord` covering input digest, toolchain, target and feature set, and prints that CID to the operator | **MET** | `tools/aot/echo-guest.node.test.ts` (9 passed, real CLI lift of both guests, this pass); coverage sweep in `tools/aot/lift.node.test.ts` under *the name covers what changed the bytes* |
| 2 | A re-tagged local image pointed at by the CLI is refused rather than hashed under the borrowed name, **and** changing any one covered input changes the emitted CID | **PARTIAL** | clause 2 MET — the sweep plus two real lifts with two different printed key CIDs. Clause 1 **measured and NOT met**, re-measured by hand here: `RepoDigests` cannot distinguish the two names on this image store |
| 3 | A translated artifact from `tools/aot/cli.ts`, dispatched to a live `bin/agent.ts` node, executes successfully — the node constructs a real `WasiExecutor` in production, on the same admission and verification path as a source-compiled module | **MET** | `packages/node/src/aot-dispatch.node.test.ts` (3 passed, this pass), plus Mutation A and Mutation B both re-planted and observed red here |

---

## Criterion 1 — MET

> *"Running `tools/aot/cli.ts` against a real AArch64 binary produces a `TranslationRecord` whose
> CID covers input digest, toolchain versions, target, and WASM feature set, and the CLI prints
> that CID to the operator"*

**The production call site exists and is the only one.** `translationCid` is imported into
`tools/aot/lift.ts` from `@o2/aot` and called inside `liftElf` as
`await translationCid(translationKeyOf(lifted))`, with the failure arm returning
`{ kind: 'unnameable', reason: named.failure }` rather than a defaulted success. A repository-wide
grep for `translationCid` outside `*.test.ts` returns that call, the barrel re-export, the
definition, and prose — nothing else. `LiftedArtifact.translation` is a **required**
`TranslationRecord`, so no lift returns bytes without a name.

**The four covered inputs are the four the criterion names, and only those.**
`translationKeyOf` maps `inputDigest`, `target`, `toolchain`, `features` from the artifact, and
`translationCid` hashes exactly those four after normalising. The case *maps exactly the four
fields the criterion names* asserts each field by value **and** `Object.keys(key).sort()` exactly,
so a fifth field cannot enter an artifact's identity silently. The sweep runs both directions —
six flips move the CID (input digest, target, each toolchain entry **iterated not enumerated**, an
added toolchain entry, the required feature set) and nine build-log fields leave it still
(`durationMs`, `stdout`, `stderr`, `findings`, `unparsed`, `declaredFeatures`,
`unidentifiedTools`, `undecoded`, `blindSpots`). One direction alone would not be a measurement:
a key that moved with `durationMs` would never match twice and would still pass the first half.

**The CLI prints it.** `describeLift` pushes three lines inside the one string it returns —
`key as hashed: …` (through `describeKey`), `translation key cid: …`, `artifact cid: …` — and
`cli.ts` writes `describeLift(outcome.artifact)` to stdout. Note that `describeKey` acquired its
production caller in `ddca460` (defect #41, dated after 21-02 declined it), so 21-02's recorded
decision *"`describeKey` is deliberately not called"* is no longer true of the tree — it was
reversed by defect work inside the phase window, and the AOT-02 row was corrected in the same
commit.

**Against a real AArch64 binary — measured by this pass, not read from a summary.**
`tools/aot/echo-guest.node.test.ts` builds `ECHO_GUEST_C` (four lines of C held in the repository)
with `clang-16 -O0 -static` **inside the digest-pinned elfconv image**, then lifts it by
`spawnSync`-ing `tools/aot/cli.ts` **as a program**. In this pass:

```
[echo-guest] echo:  source=cli status=2 artifact=5660003 bytes wall=391442ms
             keyCid=bafyreiexejqg25mxzjlybzrzq5sfdk2roy7kkjs5e4jrnfl46jatw73pgm
[echo-guest] hello: source=cli status=2 artifact=5662885 bytes wall=351698ms
             keyCid=bafyreid77bug7uea74pkfb26rqn6yidrn2bajl2uxylylvngaeiyu3s2ja
Test Files 1 passed (1) / Tests 9 passed (9)      EXIT=0
```

Both printed key CIDs and both artifact byte counts are **byte-identical to 21-04's and 21-05's
tables**, taken in two earlier sessions. That is a fifth and sixth same-host lift agreeing, taken
by a third party who did not write either. I additionally recomputed both artifact CIDs from the
bytes on disk through `@o2/net`'s `blockCid` and got
`bafyreibgiyiuhmbv6tfgh4khvt4derezweyysvxxsu7f76ysnpsxkfc72e` and
`bafyreidtuj6grhekedsiidjshhvti6i7k2sbi7svtyotlao2vwdic6myue` — again identical, and the sha-256
of both files matches both summaries.

**Why the printed value is a measurement and not a shape match.** `cidOnLine` reads the CID off its
own **label**. Both CIDs the CLI prints are CIDv1/dag-cbor/sha-256 and both render `bafyrei…`, so a
`/bafy[a-z0-9]+/` match would pass with the two swapped — which is exactly 21-CONTEXT mutation 5.
The spec then requires `printedKeyCid` to equal a key **recomputed in the test**, where
`inputDigest` is the sha-256 of the ELF *this file built* and `features` is read out of the
artifact's own `target_features` section *by this file*; only `toolchain` comes off the CLI's
stdout, and the spec says so at the line rather than letting "recomputed the key" read as more
than it is.

**Exit 2, not 0.** Both guests land on `reservations`, which is the success for a glibc-static
input. A case asserting `0` would fail on a correct run. `clean → 0` therefore remains unmeasured
from the CLI — carried forward from 21-02, unchanged, and correctly not scored.

**One real limit on this criterion (W1).** On my first attempt, under load average 277 with four
foreign elfconv containers up, the echo lift ran 613 617 ms and produced *no artifact*, the
`beforeAll` blew its 900 000 ms budget, and **all nine cases were skipped**. The criterion is
unmeasured on any run that hits that. It is a budget problem, not a correctness problem — the
retry at load 24 passed 9/9 — but a CI host is a contended host.

---

## Criterion 2 — PARTIAL

> *"Re-tagging a local translated image under a different name and pointing the CLI at it is
> refused rather than hashed under the borrowed name, and changing any one covered input changes
> the emitted CID"*

### Clause 2 — "changing any one covered input changes the emitted CID" — MET

Two independent halves, both re-executed here.

**The sweep, no container.** Six flips move the emitted CID and nine leave it still, described
under criterion 1. The toolchain leg **iterates** every present entry rather than enumerating a
subset, so a key built from a hardcoded list of names cannot pass it.

**The end-to-end pair.** Two real lifts on this host, minutes apart, same command, same
digest-pinned image. `inputDigest` is the one covered input that moved — asserted from two
recomputed keys, with `toolchain` and `features` asserted **equal** beside it, so the claim is
*this field differed and the CID moved* rather than *two different things hashed differently*. Both
printed key CIDs differ, and I watched both get printed in my own run. The repeat direction (same
input, same CID twice) is `lift.node.test.ts`'s, which passed here with no skips.

### Clause 1 — "a re-tagged local image … is refused" — MEASURED AND NOT MET

**Re-measured by hand by this pass rather than accepted from 21-02:**

```
$ docker image inspect ghcr.io/yomaytk/elfconv:arm64 --format '{{json .RepoDigests}}'
["ghcr.io/yomaytk/elfconv@sha256:22a404f31c9f…"]                            # EXIT=0

$ docker tag ghcr.io/yomaytk/elfconv:arm64 o2-verify/elfconv:borrowed       # EXIT=0
$ docker image inspect o2-verify/elfconv:borrowed --format '{{json .RepoDigests}}'
["o2-verify/elfconv@sha256:22a404f31c9f…","ghcr.io/yomaytk/elfconv@sha256:22a404f31c9f…"]
$ docker image inspect ghcr.io/yomaytk/elfconv:arm64 --format '{{json .RepoDigests}}'
["o2-verify/elfconv@sha256:22a404f31c9f…","ghcr.io/yomaytk/elfconv@sha256:22a404f31c9f…"]
```

The borrowed repository gets an entry of its own, so `resolveImage`'s repository match **succeeds**
and the borrowed name is adopted as the toolchain's identity — the criterion's failure, stated
plainly. And the second reading is the one that closes off repair: **the canonical name answers
with a byte-identical list**, because `RepoDigests` is a property of the image **ID**, not of the
reference handed to `image inspect`. The two calls are being shown the same bytes, so **no
predicate over that data can refuse one and admit the other.** An `every`-must-match rule would
refuse `ghcr.io/yomaytk/elfconv:arm64` itself on any host where somebody has ever run `docker tag`
— trading an unportable recorded name for a false refusal of the correct image.

**This must not be scored MET off the unit-level refusal.** The refusal *is* proved through the
spawned program — exit 1, stderr naming the wanted repository and a found digest, and the stub's
invocation log holding exactly one entry which is the `image inspect`, with `run ` absent from the
joined log (the only assertion an exit code cannot make). But it is driven by a stub emitting a
digest list that `docker tag` **no longer produces** on this image store. Proving the refusal
against synthetic data is not proving the criterion's sentence.

**What the tree does correctly:** it pins the negative rather than hiding it. The case *measures
what `docker tag` leaves in RepoDigests, because the refusal turns on it* asserts the borrowed
entry's presence, asserts the two readings `toEqual`, asserts an `every` rule would falsely refuse
the canonical image, and asserts the driver's own stderr adopts `image o2-local/elfconv@sha256:`.
It reads the exit code nowhere, because on that path `1` means the refusal and the container's
abort alike. It ran in this pass (151 passed, no skip line).

**Verdict.** One clause met, one measured and not met, for a reason that is about the containerd
image store and not about this code. **PARTIAL.** *Measured and not met* is a different state from
*unmeasured*, and both are different from *met*.

---

## Criterion 3 — MET

> *"A translated artifact produced by `tools/aot/cli.ts`, dispatched to a live node started via
> `bin/agent.ts`, executes successfully — the node constructs a real `WasiExecutor` in production,
> completing the same admission and verification path as a source-compiled module"*

**The composition.** `packages/aot/src/abi-router.ts` exports `AbiExecutor`, which reads the module
block, compiles it once, and routes on
`WebAssembly.Module.imports(module).some(entry => entry.module === WASI_NAMESPACE)`. It produces no
refusal of its own — a missing block and a compile throw both delegate to the native arm — so no
existing reason string moves. Both factories compose it **innermost**:
`fabric-node.ts` builds `new AbiExecutor({ blockstore, native: compute, wasi: new WasiExecutor({ nodeId: libp2p.peerId.toString(), blockstore }) })`
and wraps it `new CountingExecutor(guardSovereignty(provenance(abi), sovereignty))`;
`browser-node.ts` does the same over `worker`. So sovereignty, provenance and (in a tab) the
duty-cycle governor apply to a translated artifact exactly as to a source-compiled one.

**The run, taken by this pass.**

```
npx vitest run --project node packages/node/src/aot-dispatch.node.test.ts --reporter=verbose
Test Files 1 passed (1) / Tests 3 passed (3)      EXIT=0
[aot-dispatch] translated 5660003 bytes, 4 shards R2 in 4885ms; source-compiled 146 bytes
               in 2364ms; grossFuel=208 usefulFuel=104 multiplier=2
[aot-dispatch] wire: 5660003 bytes, 4657ms, fetched=true, ok=true, dir grew 3→5
```

Two agents spawned from `bin/agent.ts` with `--dir` and `--trust-anchor` only — **no new flag**;
the phase adds none, verified against `bin/agent.ts` by grep for the spawn argv. Both directories
pre-staged before either child existed. Four shards at redundancy 2, every shard `agreed` with
`replicas: 2` and `agreeing` naming both spawned peer ids sorted, every shard's
`verification.output` deep-equal to its own value, and `observe(translated) toEqual
observe(native)` over `complete`, both fuel totals, the multiplier, and per shard
`partitionIndex`/`inputCid`/status/`output`/`resultCid`/sorted `agreeing`.

**The fuel arithmetic is checkable, and I checked it.** I measured the shard input block
independently — `encodeCanonical({n: 1, tag: 'echo'})` is **13 bytes** — and fuel is
`input + output` in both executors, which an echo makes equal. So each of the eight dispatches is
26, `8 × 26 = 208` gross and `4 × 26 = 104` useful at multiplier 2. Those are exactly the three
numbers my run produced.

**"The node constructs a real `WasiExecutor` in production" rests on the equality plus a mutation,
and NOT on a type check — verified.** There is no `instanceof` or `toBeInstanceOf` assertion
anywhere in `aot-dispatch.node.test.ts`, `abi-router.test.ts` or `fabric-node.node.test.ts` that
carries this claim; the only `instanceof` occurrences are error-narrowing in catch blocks. The
file's own docblock states why (`## Why an equality, and not an `instanceof``): after
`guardSovereignty`/`provenance`/`CountingExecutor`/`GovernedExecutor` have wrapped it four deep,
`node.executor instanceof …` proves nothing.

**Mutation A, re-planted by this verifier and observed red.**
`return wantsWasi ? this.#wasi.execute(task) : this.#native.execute(task)` →
`... ? this.#native.execute(task) : this.#native.execute(task)`:

```
Test Files 2 failed (2) / Tests 5 failed | 14 passed (19)      EXIT=1

AssertionError: translated job incomplete; failure reasons:
["instantiation failed: WebAssembly.instantiate(): Import #0 \"wasi_snapshot_preview1\":
  module is not an object or function", … × 8]: expected false to be true
```

That sentence was produced **inside a spawned `bin/agent.ts` process** and travelled over a socket
to the requestor. `5 failed | 14 passed (19)` is 21-05's recorded count exactly. `Import #0 "o2"`
appears **0** times — Mutation A cannot reach the native direction, which is precisely why it is
not sufficient on its own.

**Mutation B is the discriminator, and it still reddens.** Inverting the predicate:

```
Test Files 3 failed (3) / Tests 12 failed | 10 passed (22)     EXIT=1
`Import #0 "o2"` — the NATIVE namespace — appears 5 times in this three-file subset

FAIL packages/node/src/two-process.node.test.ts > NET-01 — a job across OS processes
     > completes 4 shards at R=2 in two separate agent processes
FAIL packages/aot/src/abi-router.test.ts > … > row 7: trap during execution
     expected 'instantiation failed: WebAssembly.ins…' to be 'trap during execution: unreachable'
```

`two-process.node.test.ts` is a pre-existing spec that knows nothing about this phase, and all
three of its cases went red. **This is what separates "a router is wired in" from "the router
chooses correctly":** a router with one arm hard-coded would look identical to a correct one under
Mutation A, and Mutation B breaks the native direction that Mutation A cannot touch. Both plants
were snapshotted with `cp` to a scratch path outside the repository, restored with `cp`, and
`cmp`'d to exit 0; no `git checkout`, `git stash`, `git reset` or `git clean` was run at any point.

**The falsification holds.** The identical arrangement over the `printf` hello artifact: `complete`
false, four shards `insufficient`, eight failure reasons each containing `output is not valid
DAG-CBOR` and none containing `instantiation failed`. That the codec answered at all is itself a
router proof — the module compiled, every WASI import was satisfied, it instantiated, `_start` ran
to completion and it wrote bytes. A `for` loop over all eight, not a `some`.

**Same admission path, verified structurally.** The spawned agents pin the demo's trust anchor by
default and are given `--trust-anchor <publisher pubkey>`; every job carries a `moduleRecord`
signed by that publisher, so `guardModuleProvenance` runs before any module byte is fetched. An
unsigned job would have every dispatch refused before placement could be observed.

**Two qualifications, neither of which moves the verdict.**

- **W3 — the criterion-3 file no longer invokes the CLI once a host is warm.** My run logged
  `origin=cache status=n/a keyCid=n/a` for both guests. The *produced by `tools/aot/cli.ts`* clause
  is carried by the cache's provenance, the matching sha-256, and `echo-guest.node.test.ts` (which
  uses no cache and did run the CLI in this pass) — not by the file itself.
- **W5 — the wire-transfer elapsed time does not reproduce.** 21-05 records 158/177/689 ms; I
  measured **4 657 ms** for the same dispatch. The byte count, `fetched`, `ok`, the directory
  growth and the `statSync` size all reproduced exactly. Hand Phase 13.1 the bytes, not the
  milliseconds.

---

## Re-derived claims the prompt asked to be checked rather than repeated

| Claim | Verdict | How |
|---|---|---|
| AOT-04's across-real-processes clause is met; `grossFuel 208 / usefulFuel 104 / multiplier 2`, checkable as `8 × 26` and `4 × 26` from a 13-byte block | **CONFIRMED** | ran the file (3 passed); measured the block at 13 bytes independently |
| "the node constructs a real `WasiExecutor` in production" rests on the equality **plus** Mutation A, not on a type check | **CONFIRMED** | no `instanceof`/`toBeInstanceOf` claim exists; Mutation A re-planted, 5 failed \| 14 passed, 8× `wasi_snapshot_preview1` relayed from a spawned agent |
| A real lifted artifact runs — `{n:1, tag:'echo'}`, `stdoutBytes` and `stdinConsumed` both 13, fuel equal to a real `WasmExecutor`'s | **CONFIRMED** | `echo-guest.node.test.ts` 9 passed on a real CLI lift |
| Artifact CIDs byte-identical across three separate lift sessions | **CONFIRMED, and extended to a fourth** | my own CLI lift printed the same two key CIDs and produced the same two byte counts; I recomputed both artifact CIDs and both sha-256s independently |
| Mutation B is the discriminator and still reddens — the native direction Mutation A cannot reach | **CONFIRMED** | 12 failed \| 10 passed across three files; `Import #0 "o2"` ×5; `two-process.node.test.ts` red on all three cases |

## The recorded limits, each re-checked for whether it is still accurately stated

| Limit | Still accurate? | Evidence |
|---|---|---|
| AOT-02's re-tag half is a **measured negative** — `RepoDigests` is a property of the image ID, so no predicate over it can separate canonical from borrowed | **YES — and re-measured by hand here.** Not scored MET | the `docker tag` probe above; the pinning case passed |
| AOT-02's refusal covers **blank and only blank**; `wasi-sdk=unknown`, which the container writes itself twice, is still hashed | **YES** | `lift.ts`'s `unnameable` docblock states it; the case *names a lift whose toolchain said the word "unknown" — the limit of the refusal* asserts `toolchain['wasmedge'] === 'unknown'` and `unidentifiedTools === []` and passes |
| AOT-02's prose is now stale on "never compared across two genuinely different inputs end to end" | **CONFIRMED STALE** (W6) | 21-04 did it and this pass re-executed it |
| AOT-02's *checkable* claim — `describeKey` reachable only through `describeLift` — is untouched and still true | **YES** | repository-wide grep: one production caller, `lift.ts`'s `describeLift`. `requirements-ledger.node.test.ts` 45 passed |
| The WASI arm runs inline with no wall-clock deadline on either tier, and cannot be closed at the composition site | **YES** | stated at both call sites; `@o2/core` may declare no `@o2/*` dependency (`purity.node.test.ts`), so `WorkerExecutor`'s killable thread cannot reach `WasiExecutor`. Nothing in this phase measures it |
| The browser tier's runtime behaviour is structurally present and unmeasured (WIRE-03) | **YES** | `browser-node.ts` composes `AbiExecutor`; no spec dispatches a WASI module through a `BrowserNode` in a tab. Correctly not scored |
| `CROSS_MACHINE_BLIND_SPOT` and `REACHABILITY_BLIND_SPOT` still attached | **YES** | both constants present in `lift.ts` and pushed by `blindSpotsFor` |
| `clean → 0` unmeasured from the CLI | **YES** | both guests are `reservations`; no case asserts `status === 0` |

## The two things no plan owned

**1. `slow-specs` file-count drift — IT HAS TIPPED. The tree is RED.** 21-05 recorded drift 5 of 5
and wrote the prediction down. Measured twice by this pass, 40 minutes apart:

```
npx vitest run --project node packages/node/src/slow-specs.node.test.ts
Tests 1 failed | 8 passed (9)      EXIT=1
"the node project holds 150 test files, the recorded measurement covered 144"
```

Attributed by reading the tree, not by plausibility: `checkpoint-agents.node.test.ts` arrived in
commit `f906d66` (`feat(20-11): the job outlives the requestor that submitted it`) and is the file
that tipped it. Phase 21's `aot-dispatch.node.test.ts` (`b0dd390`) is one of the six over the
recorded count and consumed the last unit of margin. **Phase 21 did not leave the tree red by
itself; it left it with zero margin, and the margin was spent within hours.**

**2. `--reporter=json` attributes a heavy `beforeAll` to nothing.** Both plans that measured this
present the JSON figure **as the defect**, beside a `/usr/bin/time -p` reading of the same run
(21-04: 403 ms vs 194 014 ms of hook; 21-05: 2 804 ms vs `real 116.38 s`). No span figure in any of
the five summaries is offered as a measurement on the strength of the JSON reporter alone — every
performance table in 21-01, 21-02, 21-04 and 21-05 is `/usr/bin/time -p` with `real`/`user`/`sys`
and the derived ratio. **No claim in this phase was found resting on a JSON-reporter span.** The
consequence they both flag is real and unclosed: a re-measurement of `MEASURED_NODE_SPANS` taken the
documented way would file `echo-guest.node.test.ts` at ~400 ms, i.e. *below* `SLOW_CUTOFF_MS`, while
`O2_UNIT_ONLY=1` carries ~750 s of Docker with nothing saying why. That collides with finding 1
above, since closing the drift requires exactly that re-measurement.

## Assertions that cannot fail

Four, **all four already labelled at the line by the executor who wrote them**, listed in the
frontmatter. **This pass found no new un-failable assertion in the phase's own specs.** That is
worth stating plainly given the prompt's expectation that some survived: Phase 18's first pass found
a tautology confirmed at the type level, Phase 19's found the same class, and 21-04 and 21-05 each
went looking in their own work before writing their claims down — 21-04 planting a mutation that
left the file **green** and reporting it as such rather than replacing it, 21-05 rewriting the wire
case's step 5 because the plan's ordering made it read `true === true` on whichever arm ran. The
practice appears to have worked. Two of the four labelled lines are structurally un-failable
(same-process equalities) and two are un-*exercised* rather than un-failable; none is offered as
evidence for a criterion.

The one line that came closest to escaping scrutiny is the wire case's refused arm
(`expect(outcome.reason.length).toBeGreaterThan(0)`). It cannot fail *and* its arm has never
executed on this host — `fetched` read `true` in every run including mine. What carries that arm is
the pre-branch cross-check, and 21-05's plant S3 (`const fetched = !existsSync(artifactPath)`) shows
that line can fire. That is adequate, and it is declared.

## What this pass measured false in the five summaries

| # | Where | Claim | Measured |
|---|---|---|---|
| 1 | 21-03 frontmatter | `requirements-completed: [AOT-04]` | **FALSE.** The same file's body says AOT-04 is deliberately *not* marked complete, and `REQUIREMENTS.md` carries it as an unchecked **Partial** row. The other four summaries read `[]`. (W4) |
| 2 | 21-05, the wire table | elapsed "158 / 177 / 689 ms across three runs" | **Not reproducible at that magnitude.** Measured 4 657 ms here. Every other figure in that table reproduced exactly. (W5) |
| 3 | 21-05, "all three cases RAN on a cold cache through the real CLI" | true of that session | **Not re-establishable.** The cache it introduced means a warm host runs the file with `origin=cache` and no CLI invocation. (W3) |
| 4 | 21-02, "`describeKey` is not called, and that is a decision rather than an omission" | true when written | **Reversed inside the phase window** by `ddca460` (defect #41). `describeLift` now renders the key. The AOT-02 row was corrected in the same commit, so nothing is inconsistent — but the summary's decision no longer describes the tree. |
| 5 | 21-04 / 21-05, "the file-count drift is inside tolerance" | true when written | **Now false.** Drift 6 of 5, red. Not those plans' doing. (W2) |

Everything else I checked reproduced: both mutation counts, both artifact sha-256s, both artifact
CIDs, both emitted key CIDs, both artifact byte counts, the three fuel numbers, the 13-byte input
block, the `MAX_INBOUND_MESSAGE_BYTES` headroom claim (5 660 003 of 8 388 608, 67 %), and the
`docker tag` finding.

### RE-MEASURED 2026-08-05 — row 2 is withdrawn, and rows 3 and 5 are re-scoped

The table above is kept verbatim. Three of its five rows do not survive a second reading, and
saying so here is cheaper than leaving a reader to trust a report that has been checked once.

**Row 2 is withdrawn.** *"Not reproducible at that magnitude. Measured 4 657 ms here."* Four
consecutive runs of `npx vitest run --project node --reporter=verbose
packages/node/src/aot-dispatch.node.test.ts` on 2026-08-05, exit code read with `EXIT=$?` on the
next line and no pipe, at 1-minute loads of 2.68 / 4.77 / 4.55 / 4.66:

```
[aot-dispatch] wire: 5660003 bytes, 152ms, fetched=true, ok=true, dir grew 3→5
[aot-dispatch] wire: 5660003 bytes, 146ms, fetched=true, ok=true, dir grew 3→5
[aot-dispatch] wire: 5660003 bytes, 153ms, fetched=true, ok=true, dir grew 3→5
[aot-dispatch] wire: 5660003 bytes, 155ms, fetched=true, ok=true, dir grew 3→5
```

All four sit **at or below the lowest** of 21-05's recorded `158 / 177 / 689 ms`, with a 9 ms
spread. This pass's own report says it deliberately avoided a full sweep because *"three agents
were editing the tree throughout"*; 4 657 ms is what that host produced, and it is a reading of
the host rather than of the claim. **This pass applied the repository's own rule to every figure
in the summaries and did not apply it to its own refutation** — *"prefer a comparative reading to
an absolute one"*, and *"attribute a failure by measurement, not by plausibility"*. 21-05's
figures stand; the re-measured band is recorded beside them in that summary rather than replacing
them.

**Row 3 is re-scoped, not withdrawn.** *"all three cases RAN on a cold cache through the real
CLI"* is not false and was never claimed to be repeatable: it is unrepeatable **by the design
21-05 itself introduced and documented**, in its deviation 1 (the artifact is cached under a
gitignored path keyed on the guest source). Measured today, the same spec logs `origin=cache
status=n/a … wall=2ms` and invokes no CLI. The escape hatch — delete `tools/aot/fixtures/lifted-*.wasm`
or set `O2_AOT_ARTIFACT` — is named in that deviation. Annotated there.

**Row 5 is now stale in the other direction.** *"Now false. Drift 6 of 5, red."* was true on the
day. `MEASURED_NODE_SPANS` was retaken in full on 2026-08-05 at `files: 150`, and
`npx vitest run --project node packages/node/src/slow-specs.node.test.ts` reads **EXIT=0,
9 passed**. The row's own note — *"Not those plans' doing"* — was right, and the underlying point
is that a file count in a summary is a dated reading rather than a standing claim. Both 21-04 and
21-05 now carry that annotation in place.

**Rows 1 and 4 are confirmed and are the two genuinely false claims.** Row 1: `21-03-SUMMARY.md`'s
frontmatter read `requirements-completed: [AOT-04]` while its own body says AOT-04 is deliberately
not marked complete and `.planning/REQUIREMENTS.md` carries `- [ ] **AOT-04**` as **Partial**;
corrected in place 2026-08-05 with the original retained. Row 4: `describeKey` gained a production
caller in `ddca460` — `tools/aot/lift.ts` pushes `key as hashed: ${'${describeKey(…)}'}` inside
`describeLift`, verified by grep on 2026-08-05 — so 21-02's *"`describeKey` is not called, and
that is a decision rather than an omission"* no longer describes the tree; annotated in place at
both of the two spots that state it.

## Anti-pattern scan

`TBD`, `FIXME`, `XXX`, `HACK`, `TODO`, `PLACEHOLDER`, "not yet implemented", "coming soon" — **zero
hits** across `tools/aot/echo-guest.ts`, `tools/aot/echo-guest.node.test.ts`, `tools/aot/stubs.ts`,
`tools/aot/lift.ts`, `tools/aot/cli.ts`, `tools/aot/cli.node.test.ts`,
`packages/aot/src/abi-router.ts`, `packages/aot/src/abi-router.test.ts` and
`packages/node/src/aot-dispatch.node.test.ts`. No unreferenced debt marker gates this phase.

## Requirements coverage

| Requirement | Status | Evidence |
|---|---|---|
| **AOT-02** | **Partial**, correctly | `translationCid` called on every successful lift; the emitted CID printed on its own labelled line and compared across two genuinely different inputs end to end; the coverage sweep runs both ways. Outstanding: the re-tag clause, a measured negative; and `describeKey` reachable only through `describeLift`, so the mismatch report its docblock names still does not exist. The row's prose is stale on the first of those (W6); its checkable claim is true |
| **AOT-04** | **Partial**, correctly | Both factories construct a real `WasiExecutor` behind `guardSovereignty` and `guardModuleProvenance` through `AbiExecutor`; a real elfconv artifact finishes a 4-shard R2 job across two `bin/agent.ts` processes with the whole `JobResult` matching a source-compiled run. Outstanding: the browser tier's runtime behaviour (WIRE-03) and anything cross-machine (AOT-03's descoped half). The row's "outstanding half" sentence is stale (W6) |

Neither row was marked Done by any plan, and neither should be until the outstanding halves close.
`requirements-ledger.node.test.ts` is green (45 passed with `trust-anchors`), so no row currently
makes a checkable claim the tree contradicts.

## Did the phase leave the tree green?

**No — but not by its own hand.**

| Reading | Result |
|---|---|
| `npx tsc --noEmit` | **EXIT=0**, whole tree |
| `packages/aot` (9 files) | **EXIT=0**, 265 passed \| 1 skipped |
| `tools/aot/lift.node.test.ts` + `cli.node.test.ts` | **EXIT=0**, 151 passed, **no skip line** |
| `tools/aot/echo-guest.node.test.ts` | **EXIT=0** on a quiet host, 9 passed; **EXIT=1** on a contended one, hook timeout, 9 skipped (W1) |
| `packages/node/src/aot-dispatch.node.test.ts` | **EXIT=0**, 3 passed |
| `packages/node/src/fabric-node.node.test.ts` | **EXIT=0**, 15 passed |
| `requirements-ledger` + `trust-anchors` | **EXIT=0**, 45 passed |
| `packages/node/src/slow-specs.node.test.ts` | **EXIT=1**, drift 6 of 5 — tipped by 20-11's `checkpoint-agents.node.test.ts` (W2) |

Every file this phase created or modified is green. The one red in the node project traces to a
concurrent phase's commit, on a tolerance Phase 21 had already spent down to zero and said so.
A full `--project node` sweep was deliberately not run: three agents were editing the tree
throughout, `bench-attestation.node.test.ts` snapshots `git status --porcelain` and reddens when any
of them stages a file, and `late-combine.node.test.ts` has failed the same way in 21-02, 21-04 and
21-05 with an agent live on it now. A sweep taken under those conditions would measure the other
agents, not this phase.

## What would close criterion 2, and where that work belongs

The re-tag clause is **not** an executor task and **not** deferred — Phases 22 (Reachability Guard),
23 (Multi-process Benchmark Driver) and 24 (Certificate-Gated Admission) contain no goal or success
criterion touching image resolution, `RepoDigests` or AOT-02. It belongs to Phase 21 as an open
escalation, and it needs one of:

1. **A mechanism that does not rest on `RepoDigests`.** The only candidate this pass could identify
   is refusing any `--image` whose repository is not on a declared allow-list. That converts content
   addressing into a name allow-list and makes `--image` useless for the purpose 21-CONTEXT decision
   5 added it for. It is a scope decision, not an implementation.
2. **An owner ruling amending the clause** to the measured reading: the recorded digest is truthful,
   so no unknown toolchain runs under a trusted name; what is recorded is a *local* name no other
   host can resolve, which makes the key unportable rather than wrong. RULING A forbids doing this
   silently, and the criterion text at `.planning/ROADMAP.md` is unchanged as of this pass.

Under the Phase 17 → 18, Phase 16 → 20, Phase 18 → 20 and Phase 19 → 24 precedent, a clause that is
carried rather than cleared keeps its criterion at PARTIAL and the phase does not close on it. That
precedent is why this report reads 2/3 and not 3/3, and why the status was `human_needed` rather
than `passed`.

---

## RULED 2026-08-05 — option 3, which this section did not list

**The owner took neither of the two options above.** Both were declined on this pass's own
measurements: option 1 converts content addressing into a name allow-list and makes `--image`
useless for the purpose 21-CONTEXT decision 5 added it for; option 2 was already rejected once as
unmeasurable, because the classic-store daemon exits 1.

**The clause is recorded as a MEASURED NEGATIVE, on AOT-05's precedent** — the disposition v1.0
took for the V8 code-cache result, *"reported unmet rather than reworded"*. That is a third option
and this section should have listed it, because it is the one the repository already had a name
for. Recorded here rather than by rewriting the list above, so what this pass could see on
2026-08-05 stays readable.

**Nothing about the score moves.** Criterion 2 stays PARTIAL, Phase 21 stays **2/3**, and the
phase still does not close on it. The ruling settles the *reason*, which is what had been pending:
`RepoDigests` is a property of the image **ID**, so no predicate over it can separate a borrowed
name from the canonical one, and **the information is not in the data source**. That is a fact
about the containerd image store, not a gap in this code — and *"unmeasured is not met"* was never
in tension with it, because this clause is **measured** and not met.

**The classic dockerd image store remains unmeasured, and unmeasured is not met.** The ruling does
not extend to it. If a future host with the classic store shows the refusal working, this clause
becomes host-dependent rather than false, and that reading should be added beside this one rather
than replacing it.

`REQUIREMENTS.md` already carried the measured-negative wording in three places before the ruling
— the AOT-02 traceability row, the v1.1 wiring row, and the exclusions paragraph. **The ruling
makes this verification agree with the ledger, not the other way round.**

---

_Verified: 2026-08-05T07:45:16Z_
_Verifier: Claude (gsd-verifier) — independent goal-backward pass_
_Working tree at completion: `packages/aot/src/abi-router.ts` byte-identical to HEAD (`cmp` exit 0); no file owned by this phase modified; `git status --porcelain` shows only concurrent agents' work_
