---
phase: phase-15-capability-chained-dispatch
verified: 2026-08-01T02:35:57Z
status: human_needed
score: 3/3 success criteria verified
requirements_ticked: []
requirement_in_scope: AUTH-03
requirement_disposition: "serving half established; requestor half scheduled to Phase 23 criterion 5 by the owner ruling of 2026-07-31 (ROADMAP.md:442-446). NOT ticked by this verification."
overrides_applied: 0
tsc: "npx tsc --noEmit — exit 0, re-run three times (baseline, under mutation M1, under mutation M2)"
mutations_planted: 3
human_verification:
  - test: "Decide whether the browser factory's authorizer behaviour may stay unmeasured at phase close."
    expected: "A dispatch to a live BrowserNode's serveAgent handler, with and without a valid chain, refused and accepted respectively."
    why_human: "Cannot be verified programmatically today. A BrowserNode listens on ['/p2p-circuit', '/webrtc'] alone (browser-node.ts:378); with no relay reservation it has no dialable address, and the browser vitest project cannot host a Circuit Relay v2 server. Re-measured here: a fully scrambled browser authorizer leaves tsc at exit 0 and 345 browser tests green in three engines."
resolved_after_verification:
  - test: "Resolve the AUTH-03 ledger inconsistency."
    resolved_on: "2026-08-09"
    evidence: "All three sources named by the item now agree. 15-04-SUMMARY.md reads `requirements-completed: []`; REQUIREMENTS.md's AUTH-03 row reads **Partial** with the serving/requestor split stated; and the ':567' clause *'RemoteExecutor sends no capability field'* survives in exactly one place — a paragraph that quotes it as expired and records the measurement that killed it. Checkbox unmoved, as the item required."
  - test: "Decide whether a shipped source comment stating a mechanism that does not exist must be corrected before phase close."
    resolved_on: "2026-08-09"
    evidence: "capability-authorizer.ts is corrected and dated 2026-07-31 in the file: it now records that the comment *claimed* `registerSovereignInputs` never runs, that no such function exists, and that `takeSovereignHold` runs before `options.authorize`. `registerSovereignInputs` appears in three files repo-wide and every one narrates the false claim rather than asserting it. The project rule this follows is CLAUDE.md's: when a comment and a requirement disagree, the requirement wins and the comment gets fixed."
warnings:
  - "Browser tier: the capability mechanism is behaviourally verified in three engines, but browser-node.ts's wiring of it is held only by a source-text argument-equality check."
  - "capability-authorizer.ts:17-23 ships a false mechanism claim naming a non-existent function."
  - "15-CONTEXT.md:107-108 cites purity.node.test.ts:167-174 as keeping the Executor port narrow. Verified false — those lines assert '@o2/core has no dependency edge to any adapter package'. No test in this repository asserts the Executor port carries no chain."
  - "deferred-items.md's five stale comments: four still stand (browser-node-contract.node.test.ts:26, mutation-ledger.ts:141, sovereign-block-refusal.node.test.ts:54, serve-agent-hooks.node.test.ts:135)."
---

# Phase 15: Capability-Chained Dispatch — Verification Report

**Phase Goal (as amended 2026-07-31):** a task dispatched between two live nodes carries a
capability chain rooted at the data owner's key, and the receiving node's `authorize` hook
verifies it before `WebAssembly.instantiate` — the serving end wired and verified end to end;
the requestor end wired to a required constructor argument that every production call site
declines.

**Verified:** 2026-08-01T02:35:57Z
**Status:** human_needed
**Score:** 3/3
**Re-verification:** No — initial verification.

The three numbered success criteria at `ROADMAP.md:419-421` were **not** amended when the
goal line was, and are what this report scores.

**Host state when the readings were taken.** `uptime` reported a 1-minute load average of
**8.01** at the start of this session and **3.71** at the end, on 8 cores. Nothing below is a
wall-clock measurement and no timing bound was set or changed.

---

## Criterion 1 — MET

> *"A task dispatched through `bin/agent.ts` between two live nodes carries a capability chain
> attached by `RemoteExecutor`, and the receiving node's `authorize` hook verifies it before
> calling `WebAssembly.instantiate`."*

### The entry point is the binary the criterion names

`packages/node/src/capability-dispatch.node.test.ts:145` resolves `./bin/agent.ts`; `:197-201`
spawns it as `process.execPath [AGENT, '--dir', …]` with `stdio: ['ignore','pipe','pipe']`, and
`:203-225` waits on the child's one-line address handshake. This is a genuine operating-system
process, not an in-process fabric.

Confirmed independently of the suite, by starting the binary by hand:

```
$ node packages/node/src/bin/agent.ts --dir $D --port 0 --owner-id alice --owner-key aa11 --can-execute-sovereign
{"peerId":"12D3KooWQjUNxdFoJpScRMwMHxpHgUfZswbwsnf48yxbfP1AwHsd","multiaddrs":["/ip4/127.0.0.1/tcp/65446/p2p/12D3Koo…"],"trustAnchors":["769c7b0d…"]}
EXIT=0
```

`--owner-key` is parsed at `packages/node/src/bin/agent.ts:50`, declared in the usage string at
`:75`, and spread into the `sovereignty` record at `:97`.

### The chain is attached by `RemoteExecutor`

`packages/net/src/remote-executor.ts:109-116` — `#requestFor` calls the supplier and, when the
returned chain is non-empty, encodes `{ kind: 'exec', task, capability: chain }`. The supplier is
the **required** third constructor argument at `:91-95`, typed `CapabilitySupplier |
'dispatches-unauthenticated'` at `:53`. `capability-dispatch.node.test.ts:407` constructs the
chained executor with `chainSupplierFor(alice.peerId)`.

That the chain arrives at the hook **deep-equal to what was minted** is measured separately, in
process, at `packages/net/src/capability-dispatch.test.ts:210`, `:233-234` and `:259-261`.

### The receiving node's hook verifies it

`packages/node/src/fabric-node.ts:764-769` installs `authorizeCapability({ownerId, ownerKey?,
audience, now: Date.now})`; the audience is derived eagerly at `:632` via `audienceKeyOf`.
`packages/net/src/capability-authorizer.ts:99-106` calls `verifyChain` and returns
`result.reason` verbatim.

### "Before `WebAssembly.instantiate`" — the ordering, and how it is measured

`packages/net/src/agent.ts:402-420`: `options.authorize(...)` at `:405-408`, and
`executor.execute(request.task)` at `:417` reached **only** when `refusal === null` at `:409`.

`packages/core/src/executor/wasm.ts:161` is the only `WebAssembly.instantiate` call on the
`serveAgent` dispatch path — verified by grep; `packages/aot/src/wasi-executor.ts:827` is a
second one, off this path.

Three instruments, and **every one has been observed taking both values**:

| Instrument | Negative reading | Positive reading | Both in the same `it`? |
|---|---|---|---|
| child's own blockstore directory | `:424`, `:481`, `:495`, `:551`, `:570` | `:435`, `:504`, `:580` | yes, in all three |
| submitter's outbound frame count | refused **1** | accepted **2** | yes |
| in-process counting `Executor` | `capability-dispatch.test.ts:289` → `0` | `:312` → `1` | same file, adjacent `it`s |

Frame counts, printed by the test on every run rather than quoted from a note:

```
[criterion 1] frames to child — refused: 1, accepted: 2
[criterion 2] frames to child — absent: 1, expired: 1, control: 2
```

These match `15-04-SUMMARY.md`'s table exactly. The assertions are relations only
(`:443-444`, `:508-511`), never literals.

**What is NOT measured, and the report does not claim it is.** No instrument in this repository
observes `WebAssembly.instantiate` across a process boundary. The two cross-process readings are
proxies and the test's own header (`:55-84`) names them as such. The in-process counting
`Executor` is the stronger reading and it is upstream of every instantiate on the path.

### Command and result

```
$ npx vitest run --project node packages/node/src/capability-dispatch.node.test.ts
Test Files  1 passed (1)     Tests  3 passed (3)
criterion 1  588ms   criterion 2  542ms   criterion 3  745ms
```

---

## Criterion 2 — MET (one clause met in the mechanism's own words rather than the criterion's)

> *"A task arriving with no capability chain, or one that has expired, is refused before
> instantiation, and the refusal names the missing or expired link, observable in the node's
> response."*

### Absent chain

The frame genuinely carries **no** `capability` key: the sentinel branch at
`remote-executor.ts:110-111` encodes `{kind:'exec', task}`, `protocol.ts:355` omits the key when
`undefined`, and `protocol.ts:547` returns `{kind:'exec', task}` with no `capability` on parse.

Refusal observed at the submitter — `capability-dispatch.node.test.ts:473-474`:
`unauthorized:` + `no capability chain supplied` (`capability.ts:104`).

**Where it is asserted, and why it cannot be asserted inside the hook.** `agent.ts:407`
coalesces `request.capability ?? []` before any `Authorizer` sees it, and
`remote-executor.ts:114` collapses an empty supplier return to the same frame. Absent and empty
are therefore indistinguishable at every layer *by construction* — which is exactly why the
assertion lives at the submitter, on the returned `reason`, and not in the hook. The criterion
asks for a refusal observable in the node's response; that is what is asserted, and it is the
right location.

**The clause that is met in weaker words than the criterion uses.** For a wholly absent chain
the refusal names the missing **chain**, not a **link** — `capability.ts:104` produces
`'no capability chain supplied'` and an empty chain has no link to index. The test asserts this
honestly (`:479`, `not.toContain('link ')`) and only alongside the expired case showing the same
instrument producing an index. This is recorded rather than papered over; it is not a defect,
because no link exists to be named.

### Expired chain

`:459-461` mints with `expiresAt: Date.now() - 1_000` — absolute Unix ms,
*"absolute rather than a duration so it cannot drift"* (`capability.ts:56`), so no sleep and no
timing bound. `:490` asserts `expired at`; `:493` asserts **`link 0`** — the index survived
minting, encoding, parse in another process, judgement there, and the trip home.

### Refused before instantiation

Module CID absent from the child's directory after both refusals (`:481`, `:495`), present after
the control (`:504`); frames `1`, `1`, `2`; control ordered **last** so neither refusal is
explained by a child that had stopped serving (`:497-503`).

### Command and result

Same run as criterion 1 — `criterion 2` passed, 542 ms.

---

## Criterion 3 — MET

> *"A validly delegated sub-chain (owner → intermediate → executor) is accepted, and a chain with
> a broken delegation link is refused, proving delegation depth is checked and not merely the
> chain's presence."*

### The discriminating precondition is asserted before any dispatch

`capability-dispatch.node.test.ts:531-537` — all **three** chains are asserted `toHaveLength(2)`
and round-tripped through `encodeRequest`/`parseRequest` with `frame.capability` asserted
`toHaveLength(2)`. Without this, what remains proves only that a two-link chain sometimes fails.

| Chain | Fixture | Differs from the accepted chain by | Outcome | Refusal text asserted |
|---|---|---|---|---|
| owner → coordinator(`execute`,`delegate`) → node | `delegatedChainFor` (`capability-fixture.ts:129-148`) | — | accepted `:578` | — |
| owner → coordinator(`execute` only) → node | `undelegableChainFor` (`:162-181`) | **one ability string** | refused `:546` | `was re-delegated, but its issuer was never granted` (`:549`) |
| owner → coordinator, link 1 issued by a third party | `brokenLinkChainFor` (`:204-224`) | **one issuer** | refused `:563` | `is issued by`, `delegated to`, `link 1` (`:565-568`) |

The accepted output is checked against a single-node reference run over a **separate public row
already in the submitter's own store** (`:586-601`), with a positive/negative egress-manifest
control pair at `:608-609` so "the reference ran locally" is a reading rather than a claim.

### Command and result

Same run — `criterion 3` passed, 745 ms.

---

## Mutation probes

Three planted, each watched, each restored by `cp` from a scratch baseline outside the working
tree (`~/.claude/gsd-scratch/15-verify-base/`) and confirmed byte-identical with `cmp`. **No
`git checkout`, `restore`, `stash`, `reset` or `clean` was used at any point** — several agents
share this checkout. Final state: `git status --short` empty, `cmp` exit 0 on all seven guarded
paths.

### M1 — the ordering inversion (mine, aimed at the phase's central claim)

`packages/net/src/agent.ts`: run `executor.execute` unconditionally, then override the outcome
with the refusal. **The refusal strings are unchanged** — only the ordering moves. This is the
mutation that separates *"a refusal was reported"* from *"the module never ran"*.

`npx tsc --noEmit` → **exit 0**. The defect is type-correct.

```
Test Files  1 failed (1)     Tests  3 failed (3)
AssertionError: expected [ …(2) ] to not include 'bafyreieaeoln2jrvncw3my5wb25aiuoztkid…'
 ❯ packages/node/src/capability-dispatch.node.test.ts:424   (criterion 1)
 ❯ packages/node/src/capability-dispatch.node.test.ts:481   (criterion 2)
 ❯ packages/node/src/capability-dispatch.node.test.ts:551   (criterion 3)
```

and in process:

```
 FAIL  packages/net/src/capability-dispatch.test.ts:289
AssertionError: expected 1 to be +0
Test Files  2 failed (2)     Tests  5 failed | 9 passed (14)
```

**All three criteria went red, and every one of them went red on the *ordering* instrument
rather than on a refusal string.** This is the decisive evidence that "before instantiation" is
measured here and not merely reported. Restored; `cmp` exit 0.

### M2 — 15-03's browser authorizer scrambling, re-planted

`packages/browser/src/browser-node.ts`: `ownerId: sovereignty.ownerKey ?? ''`, `ownerKey:
sovereignty.ownerId`, `audience: 'deadbeef'`, `now: () => 0`.

| Reading | Result |
|---|---|
| `npx tsc --noEmit` | **exit 0** |
| `occurrences(BROWSER_NODE, 'authorizeCapability(')` | still **1** — the substring guard passes |
| `npx vitest run --project browser packages/browser` | **33 files, 345 passed (345)** — fully green |
| `serve-agent-hooks.node.test.ts:182` argument equality | **RED** |

Verbatim, and identical to `15-04-SUMMARY.md`'s capture:

```
  [
-   "ownerId: sovereignty.ownerId,",
-   "...(sovereignty.ownerKey === undefined ? {} : { ownerKey: sovereignty.ownerKey }),",
-   "audience,",
-   "now: Date.now,",
+   "ownerId: sovereignty.ownerKey ?? '',",
+   "...(sovereignty.ownerKey === undefined ? {} : { ownerKey: sovereignty.ownerId }),",
+   "audience: 'deadbeef',",
+   "now: () => 0,",
  ]
 ❯ packages/node/src/serve-agent-hooks.node.test.ts:182:21
```

**Exactly one instrument in the repository sees this, and it reads source text.** 15-04's claim
is confirmed on both halves — the check does turn red, and everything else does stay green.
Restored; `cmp` exit 0.

### M3 — the delegation-depth check removed (mine, aimed at criterion 3)

`packages/core/src/capability.ts:193-198`: replace `!previous.abilities.includes('delegate')`
with `previous.abilities.length === 0`, so a re-delegation by a principal never granted
`delegate` is accepted. Every chain still parses, every signature is still valid, every chain is
still length 2.

```
Test Files  1 failed (1)     Tests  1 failed | 2 passed (3)
AssertionError: expected true to be false
 ❯ packages/node/src/capability-dispatch.node.test.ts:546   (criterion 3, the depth refusal)
```

Criteria 1 and 2 stayed green — correctly, neither dispatches a two-link chain.
**Criterion 3 therefore measures delegation depth, not chain presence.** Restored; `cmp` exit 0.

---

## Node tier versus browser tier — what is established for each

### Node tier — all three criteria established behaviourally

Two independent bodies of evidence:

1. `packages/node/src/capability-dispatch.node.test.ts` — three criteria across a real
   operating-system process spawned from `bin/agent.ts`, sharing nothing with the submitter but
   a socket. 3 passed.
2. `packages/node/src/fabric-node.node.test.ts:291-380` — four dispatches over three live
   `FabricNode`s on real TCP: an unpinned node refused naming **`no pinned owner key`** (`:346` —
   the assertion 15-03 added after finding a refusal that named the wrong thing while still
   failing), a pinned-but-uncleared node refused at the sovereignty gate naming itself
   (`:358-359`), a pinned-keyed-cleared node accepting the same task with the same chain
   (`:367`), and that same node refusing the same task with the chain removed (`:377-379`).

### Browser tier — the mechanism is proven, the factory's wiring of it is not

**Proven in three browser engines** (chromium, firefox, webkit), which this verification ran:

```
$ npx vitest run --project browser \
    packages/net/src/capability-authorizer.test.ts \
    packages/net/src/capability-dispatch.test.ts \
    packages/browser/src/audience-key.browser.test.ts
Test Files  9 passed (9)     Tests  45 passed (45)
```

That covers `authorizeCapability`'s refusal precedence, `verifyChain` through it, chain
attachment by `RemoteExecutor`, the refusal-precedes-execution reading at `0` and `1`, and
`audienceKeyOf` against a real browser libp2p peer id. Everything is `@noble/curves`, so no
secure context is required and the browser runs the byte-identical code.

**Not proven:** that `packages/browser/src/browser-node.ts` wires that mechanism correctly into a
live `serveAgent` handler. M2 measured the size of that hole precisely: a fully scrambled
authorizer passes `tsc` and 345 browser tests. The single instrument that sees it
(`serve-agent-hooks.node.test.ts:177-182`) is a **source-text** equality against
`fabric-node.ts`'s call site. It is relational — it transfers evidence from the tier that has
behavioural proof — and its stated limit is real: **a defect planted identically in both
factories passes it**, and it says nothing about a dispatch to a browser node.

**This does not fail any criterion.** All three name `bin/agent.ts` and none names a browser.
It is carried as a known, recorded hole (`browser-node.ts:579-602`,
`serve-agent-hooks.node.test.ts:95-125` and `:166-176`), routed to Phase 19 / WIRE-03, and
escalated in this report's `human_verification` block for a decision rather than silently
accepted.

---

## AUTH-03 — which half this phase established

**Not ticked.** Per the owner ruling of 2026-07-31 recorded at `ROADMAP.md:442-446`, AUTH-03
stays open and Phase 15 may not close it. `REQUIREMENTS.md:186` is unchanged by this
verification and still reads `- [ ] **AUTH-03**`.

| Half | State at phase close | Evidence |
|---|---|---|
| **Serving** | **Wired and verified end to end.** `bin/agent.ts` takes `--owner-key`; both factories install `authorizeCapability`; neither says `'serves-unauthenticated'` any more (`serve-agent-hooks.node.test.ts:79`, `:126` both assert `0`); all three criteria demonstrated between two real processes. | this report, criteria 1-3 |
| **Requestor** | **A production adapter with zero production callers.** The third `RemoteExecutor` argument is required — omitting it is a `tsc` error, held by `remote-executor-contract.test.ts` — but all five non-test dispatch sites name the sentinel, because all five submit `label: 'public'` shards, which have no owner and therefore no root key. `delegate`, `CapabilitySupplier` and `RemoteExecutor.execute`'s supplier branch reach no entry point. | `serve-agent-hooks.node.test.ts:223-242` pins the five sites at 2 + 2 + 1; `remote-executor.ts:19-32` records the finding in source |

The requestor half is **Phase 23 criterion 5** — an opt-in sovereign leg on `bin/bench.ts`.

---

## Citations checked, and what did not survive the check

Every `file:line` this report relies on was re-grepped. Findings on citations *made by the
phase*:

| Claim | Where | Verdict |
|---|---|---|
| `purity.node.test.ts:167-174` keeps the `Executor` port narrow | `15-CONTEXT.md:107-108` | **False.** Those lines are `it('has no dependency edge from @o2/core to any adapter package')`. Not cited in shipped source, so the defect is confined to the plan document. |
| No test asserts the `Executor` port carries no chain | flagged in the verification brief | **Confirmed.** Grep finds none. The port is `execute(task: Task)` at `ports.ts:85`; nothing asserts it stays that way. |
| `registerSovereignInputs` never runs on a refusal | `capability-authorizer.ts:17-23`, **shipped source** | **False, and still shipped.** `registerSovereignInputs` exists nowhere in the repository — grep returns only two comments mentioning it. `takeSovereignHold` runs at `agent.ts:382-388`, **before** the authorize call at `:402-408`. 15-04 corrected this in `capability-dispatch.node.test.ts:133-142` and left the production comment unchanged. |
| `purity.node.test.ts` lists `net` as portable | `capability-authorizer.ts:31` | **True** — `PORTABLE = ['core','net','bench','demo','aot']` at `purity.node.test.ts:28`. |
| `packages/node` is in neither `PORTABLE` nor `DUAL_TARGET` | `capability-fixture.ts:11-12` | **True** — `:28` and `:36`. |
| `wasm.ts:161` is the only instantiate caller on the dispatch path; `wasi-executor.ts:827` is a second, off path | `capability-dispatch.node.test.ts:92-95` | **True** — grep confirms exactly two non-test callers. |
| `worker-executor.ts:175` fetches the module block; `fs-blockstore.ts:102` names a block file by CID | test header `:65-69` | **True.** |
| `protocol.ts` omits the key when absent and parses without it | `remote-executor.ts:105-107` | **True** — `:355` and `:547`. |
| Five shipped comments claim `BrowserNode.start` runs in no vitest project | `deferred-items.md` | **Four still stand**: `browser-node-contract.node.test.ts:26`, `mutation-ledger.ts:141`, `sovereign-block-refusal.node.test.ts:54`, `serve-agent-hooks.node.test.ts:135`. `browser-node.ts:620` now records the retirement. Correctly logged as deferred. |

---

## Whole-repository checks

| Check | Result |
|---|---|
| `npx tsc --noEmit` (baseline) | **exit 0** |
| `npx tsc --noEmit` (under M1) | exit 0 — the ordering defect is type-correct |
| `npx tsc --noEmit` (under M2) | exit 0 — the scrambled authorizer is type-correct |
| `npx tsc --noEmit` (after all restores) | **exit 0** |
| `capability-dispatch.node.test.ts` | 3 passed |
| `serve-agent-hooks.node.test.ts` | 7 passed |
| `net/capability-dispatch.test.ts` + `net/capability-authorizer.test.ts` + `remote-executor-contract.test.ts` (node) | 31 passed across 5 files with the two above |
| `fabric-node.node.test.ts` + `acceptance-traceability.node.test.ts` + `remote-executor-contract.test.ts` | 60 passed |
| `--project browser packages/browser` | 33 files, 345 passed |
| `--project browser` on the three capability files | 9 files, 45 passed |
| working tree after all probes | `git status --short` empty; `cmp` exit 0 on all 7 guarded paths |

The full-suite figures at HEAD (`--project node` 1320 passed / 18 skipped, all projects 4250
passed) were taken by 15-04 and are not re-run here; targeted evidence and mutation probes were
the better use of the budget.

---

## Score

**3/3 success criteria verified.**

Criterion 1 MET. Criterion 2 MET. Criterion 3 MET. AUTH-03 not ticked — serving half
established, requestor half scheduled to Phase 23 criterion 5.

Status is `human_needed` rather than `passed` because three items need a decision that this
verification cannot make: the browser factory's unmeasured authorizer behaviour, the AUTH-03
ledger inconsistency between `15-04-SUMMARY.md` and `REQUIREMENTS.md`, and a shipped source
comment naming a function that does not exist. **None of the three blocks the criteria**, and
nothing found here contradicts proceeding.

---

*Verified: 2026-08-01T02:35:57Z*
*Verifier: Claude (gsd-verifier), goal-backward, FORCE stance*
