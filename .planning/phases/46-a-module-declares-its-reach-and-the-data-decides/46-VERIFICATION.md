---
phase: 46-a-module-declares-its-reach-and-the-data-decides
verified: 2026-09-23T15:00:00Z
status: passed
score: 6/6 must-haves verified
overrides_applied: 0
---

# Phase 46: A Module Declares Its Reach, and the Data Decides — Verification Report

**Phase Goal:** As the owner of a device that holds data nobody else may see, I want a module
that wants the internet to say so in its own signature, and I want my node to refuse the whole
task rather than run it half-privileged, so that reaching the network is a property somebody
signed for rather than something discovered while a task is already running.

**Verified:** 2026-09-23
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (the six roadmap Success Criteria, verbatim)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Declaration is inside the signature — altered fails verification, absent hashes byte-identically to before the field existed | ✓ VERIFIED, one clause by a weaker proof than claimed (see below) | `packages/core/src/naming.ts:177-208` (`wantsNetworkReach?: true`, spread-omit in `payloadOf`). `naming.test.ts:338-364` strips/attaches the field on a signed record and asserts `SignedNameResolver.accept(...).ok === false` with `kind: 'bad-signature'` both ways — the "inside the signature" half, solid. `naming.test.ts:365-376` asserts `withoutField.signature === withUndefinedSpread.signature` — the "byte-identical when absent" half is a **separate assertion**, not double-duty with the first, but it compares two records both signed by today's `signName`, not against a signature captured before the field existed. See the dedicated finding below. |
| 2 | Declaring module + sovereign shard is refused whole, by name, with declaration AND label in the refusal, before `WebAssembly.instantiate` | ✓ VERIFIED | `network-reach-guard.ts:87-101`: the `if` check is the first and only statement before either `return`; refusing never reaches `inner.execute`. `network-reach-guard.test.ts:68-84` proves ordering with a `watched()` call counter (`expect(count()).toBe(0)`) — not merely `ok===false` — matching `sovereignty-guard.test.ts`'s own discipline; this is where the ordering claim actually lives. Refusal text asserted to `.toContain('w0')` (node), the module CID, `'sovereign'`, and `'network reach'` — positive content, not an absence check. Also proven at a real node over real RPC in `fabric-node.node.test.ts:529-563` and a real `BrowserNode` in `network-reach-composition.browser.test.ts:105-131` — but that case's own title ("before anything executes") is not itself an ordering proof: `CountingExecutor` sits outside the guard chain there and can't detect it. The real-node cases prove readability and correctness of the refused/accepted outcome, not ordering; ordering is carried entirely by the unit case above. |
| 3 | Positive control — same declaring module against a public shard is NOT refused | ✓ VERIFIED | Unit: `network-reach-guard.test.ts:86-95` (`count()===1`). Real node: `fabric-node.node.test.ts:565-579` (`node.executor.execute` on a production `FabricNode`). Real browser: `network-reach-composition.browser.test.ts:133-148` (production `BrowserNode`/real Worker). Carried at a real node on both tiers, not only the isolated unit guard. |
| 4 | Module declaring nothing is unaffected on both labels | ✓ VERIFIED | Unit: `network-reach-guard.test.ts:97-128`, three cases, all `count()===1`. Real node: `fabric-node.node.test.ts:581-596`. Real browser: `network-reach-composition.browser.test.ts:150-167`. Same real-node qualification as criterion 3. |
| 5 | A mutation removing the sovereign check turns criterion 2 red, watched failing, restored by surgical inverse, `cmp` verified | ✓ VERIFIED (ledger evidence; plant not re-observed by this verifier) | `mutation-ledger.ts:3747-3763`, entry `NR2` — plants `false && ` onto the guard's one `if`. Ledger's recorded signature, `'refuses a sovereign task whose module declares network reach, before inner.execute runs'`, matches the verbatim `it()` title at `network-reach-guard.test.ts:68`. The cheap layer (`mutation-guard.node.test.ts`) confirms the `find` text occurs exactly once and the `caughtBy` file exists — re-run fresh in this verification, 189 tests, correctly-read exit code 0. This verifier did not re-plant NR2 by hand; the "observed 2026-09-23" note in the ledger is 46-04's own claim, not independently re-observed here. |
| 6 | Refusal is readable by the requestor, not only the operator | ✓ VERIFIED | `fabric-node.node.test.ts:547-563`: the refusal is read off a `RemoteExecutor` — the requestor's own client object over real RPC — not off the guard's return value or a log. `.not.toContain('sovereignty violation')` distinguishes it from the neighboring guard. Unit-level companion also asserts `.not.toContain('module provenance refused')` (`network-reach-guard.test.ts:83`). |

**Score:** 6/6 truths verified

### Delivered by a weaker proof than claimed

**Criterion 1's "byte-identical to before the field existed" clause.** `naming.test.ts:365-372`
proves `signName(seed, fields).signature === signName(seed, { ...fields }).signature` — both
sides computed by the *current* `signName`/`payloadOf`, not against a signature captured before
`wantsNetworkReach` existed in the type. Run the counter-mutation mentally: change
`payloadOf`'s spread from `...(record.wantsNetworkReach === undefined ? {} : {...})` to
`wantsNetworkReach: record.wantsNetworkReach ?? false` — every CAP-01 case in `naming.test.ts`
stays green (stripped/attached still mismatch on either side; the round-trip still verifies,
because `encodeNameRecord`'s own spread and `accept`'s payload recomputation move together with
the same mutated `payloadOf`; the signature-equality case passes because *both* sides now encode
`false`). Yet every record signed before this field existed in the codebase would fail
verification against that mutated code — the property the clause claims — and the named case
would not catch it. `grep -rn "[0-9a-f]\{128\}" packages/core/src/naming.test.ts
packages/net/src/protocol.test.ts` finds no hardcoded signature literal anywhere in either file,
confirming no case in this phase pins a payload against a fixed pre-field signature. **The
implementation is correct by direct reading** (`naming.ts:208` genuinely omits the key when
absent, and this is the same idiom already load-bearing for `translationKeyCid`/`delegation`) —
this is a proof-strength finding, not an implementation defect, and it does not change the phase
status. Smallest closing change: capture a signature literal from `signName` on a fixed seed
before this field existed (e.g. against commit `707ec0e`) and assert
`.toBe('<that literal>')` in place of, or beside, the current comparison.

### Two controls (item 3 in the verification brief)

Criteria 3 and 4 are carried at a real, production-constructed node on **both** tiers
(`node.executor.execute` on a `FabricNode` built by `startNode`, and on a `BrowserNode` built by
`BrowserNode.start` with a real `TaskExecutorWorker`), in addition to the isolated
`guardNetworkReach` unit. Neither control is unit-only, closing the exact failure mode the
verification brief names — a refusal case staying green for twenty merges because the positive
control was never taken.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/core/src/naming.ts` | `wantsNetworkReach` field + codec agreement | ✓ VERIFIED | Field at :177, spread-omit in `payloadOf` (:208), `encodeNameRecord` (:271), refuse-on-malformed in `decodeNameRecord` (:382-398) |
| `packages/net/src/protocol.ts` | Wire codec agreement | ✓ VERIFIED | `nameRecordToValue` :1099, `parseNameRecord` :1197-1213, identical spread-omit / refuse-on-malformed shape |
| `packages/core/src/executor/network-reach-guard.ts` | The refusal guard | ✓ VERIFIED | `guardNetworkReach` :87-101, refuses before `inner.execute`, single `if`, no default arm in `describeNetworkReachRefusal` |
| `packages/node/src/fabric-node.ts` | Composed into production | ✓ VERIFIED | `guardSovereignty(guardNetworkReach(provenance(abi)), sovereignty)` at :2934 |
| `packages/browser/src/browser-node.ts` | Composed into production | ✓ VERIFIED | Identical composition at :2540 |
| `packages/node/src/mutation-ledger.ts` | NR1, NR2 entries | ✓ VERIFIED | :3724-3763, signatures match real `it()` titles verbatim |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `naming.ts` | `protocol.ts` | identical spread-omit field | WIRED | Confirmed byte-for-byte matching idiom in both files |
| `fabric-node.ts` / `browser-node.ts` | `guardNetworkReach` | direct composition | WIRED | `grep` confirms exactly one occurrence each, `core/src/index.ts` barrel-exports it |
| `RemoteExecutor` (requestor) | guard's refusal reason | RPC reply | WIRED | `fabric-node.node.test.ts` reads `outcome.reason` off a `RemoteExecutor`, not off node-internal state |
| `network-reach-guard.ts` (orphan status) | production importer | reachability guard | WIRED | `ORPHAN_MODULE_CEILING` back at 35 (was raised to 36 in 46-03, lowered in 46-05); confirmed by a freshly re-run, correctly-read exit code below |

### Probe / Regression Execution (fresh, this verification, exit code read correctly — no pipe)

Command run with output redirected to a file and `EXIT=$?` read on the next line, no `tail`/`tee` in the pipeline (the exact hazard this repository's own conventions and 46-04's SUMMARY both name):

```
npx vitest run --project node packages/node/src/reachability-guard.node.test.ts \
  packages/node/src/mutation-guard.node.test.ts packages/node/src/vocabulary.node.test.ts \
  > verify-run.log 2>&1
EXIT=$?
```

| Result | Status |
|--------|--------|
| `EXIT=0`; `Test Files 3 passed (3)`; `Tests 250 passed (250)`; host quiet (load/core 0.83 before, 0.96 after) | PASS |

Full-lane counts (270 files / 3913 passed / 11 skipped) were already measured fresh by the
orchestrator on a directly-read exit code and are not re-run here per the task's own instruction.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| CAP-01 | 46-01 .. 46-06 | Module declares network reach at signing time inside the signature; refused whole against sovereign data before instantiation | ✓ SATISFIED (in substance) | All six criteria verified against real code and real tests above. `.planning/REQUIREMENTS.md`'s CAP-01 row and checkbox were deliberately left untouched by every plan in this phase — each SUMMARY states this is the orchestrator's step, to run after verification passes. |

### Anti-Patterns Found

None. Scanned all fourteen files this phase touched for `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/
`PLACEHOLDER`/"not yet implemented"/"coming soon" — the one match (`reachability-guard.node.test.ts:2607`) is a comment describing what the reachability guard itself checks for ("unwired" and "TODO" do not pass"), not a debt marker in this phase's own code.

### Scope Fence

`git diff --stat 707ec0e..HEAD --name-only` lists exactly the fourteen source/test files named
across the six plans, `vitest.config.ts`, six SUMMARY.md files, and `STATE.md` (a 76-line
append-only addition, no deletions). No `fetch`, no host import, no stub, no deploy artifact, no
Cloudflare resource, no change to `.planning/REQUIREMENTS.md` or `.planning/ROADMAP.md`. Confirmed by direct `grep` — zero `fetch(` occurrences in any of this phase's production files.

### Human Verification Required

None. Every claim above is checkable by direct code/test inspection or a re-run command.

### Gaps Summary

No gaps that change phase status. Two things to separate, as requested:

**Not delivered (correctly, by design — recorded in the roadmap block as the next phase's subject):**
`fetch` itself; any grant mechanism; a decision on who may sign a declaration or whether a signer
can be trusted to declare honestly; the audience split for refusals that consult node-held state;
`.planning/REQUIREMENTS.md`'s CAP-01 checkbox and traceability row (administrative, explicitly
left for the orchestrator by every plan in this phase).

**Delivered by a weaker proof than claimed:** criterion 1's "byte-identical to before the field
existed" clause is asserted by comparing two records both signed under today's code, not against
a signature literal captured before the field existed — a `payloadOf` regression that always
encodes the field (e.g. `?? false`) would pass every case in this phase's own test files. The
implementation itself is correct by direct reading and follows the exact discipline already
load-bearing for two sibling fields; only the proof is narrower than the criterion's wording. See
the dedicated section above for the counter-mutation and the smallest closing change.

---

## Addendum — 2026-09-23, gap closed (proof-strength finding above)

The "Delivered by a weaker proof than claimed" finding on criterion 1 is closed. A new case,
`packages/core/src/naming.test.ts`'s `'signs a record with no wantsNetworkReach to the exact
bytes signed before the field existed'`, asserts `signName`'s output against a hardcoded
signature literal rather than against another call to today's `signName`.

**Provenance of the literal.** Captured by running `signName` from `naming.ts` as it stood at
commit `707ec0e` — the last commit before this phase touched the file, before
`wantsNetworkReach` existed in it at all — against a fixed fixture (32-byte private key of
`0x2a`, name `"pre-existence-fixture"`, `version: 1`, `expiresAt: 2_000_000_000_000`, no
`wantsNetworkReach`). Route: `git show 707ec0e:packages/core/src/naming.ts` written to a
temporary file inside `packages/core/src/`, imported under Node's
`--experimental-strip-types`, run once, output pasted into the test, temporary file deleted —
confirmed absent by `git status --porcelain` before staging. `canonical/encode.ts` and
`capability.ts`, everything `payloadOf` depends on besides the field list, are unchanged
between `707ec0e` and `HEAD` (`git log 707ec0e..HEAD` over both paths is empty), so the
literal isolates exactly the property the criterion claims rather than freezing today's
behaviour against itself.

**Counter-mutation re-run.** The same `?? false` plant this verification's finding describes
(`naming.ts`'s `payloadOf`, spread-omit replaced with an always-encode) was planted, watched,
and restored:
- Observed failure (verbatim): `expected '61f5f41af6c2685532cb4466d6bd92d3fa227…' to be
  'f8b1d88ff2295bd82d89fda0771600e248202…'` — only the new case failed; all other 32 cases in
  `naming.test.ts`, including the original circular comparison, stayed green under the same
  plant, confirming the finding's own claim that the prior case cannot see this regression.
- Restored by surgical inverse (single line reverted to the spread-omit form), `cmp` against a
  pre-plant snapshot exit 0.

**Verified clean:** `npx vitest run --project node packages/core/src/naming.test.ts` exit 0
(33 tests, was 32); `npx tsc --noEmit -p .` exit 0; full lane `npx vitest run --project node`
exit 0 (271 files, 3925 tests, was 3924); `O2_UNIT_ONLY=1 npx vitest run --project node` exit 0
(188 files, 3153 tests, was 3152). `vitest.config.ts`'s `tests`/`unitTests` fields and dated
notes updated to match. `git status --porcelain` clean at the end — no temporary file, no
plant, left in the tree.

**Not done: a `mutation-ledger.ts` entry for this plant.** One was written (`NR3`), and it
broke `mutation-guard.node.test.ts` in two ways — its `find` text matched the same code twice
because a 4-space-indented search string is a substring of the 6-space-indented sibling line
in `encodeNameRecord`, and that file separately hardcodes the full list of
`rendered-at-runtime` ids and asserts against it exactly, which a new entry always breaks.
`mutation-guard.node.test.ts` is not in this task's file scope, so it could not be fixed
alongside the entry; the entry was reverted rather than left red. `git diff
packages/node/src/mutation-ledger.ts` is empty.

This addendum does not change the verifier's verdict above (`status: passed`, 6/6) — it closes
the one proof-strength gap that verdict already named rather than disputes it.

---

_Verified: 2026-09-23_
_Verifier: Claude (gsd-verifier)_
