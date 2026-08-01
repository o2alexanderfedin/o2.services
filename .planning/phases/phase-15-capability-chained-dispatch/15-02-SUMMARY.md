---
phase: phase-15-capability-chained-dispatch
plan: 02
subsystem: net
tags: [capability-chain, delegation, remote-executor, dispatch, wire, auth-03]

requires:
  - phase: phase-4
    provides: "`AgentRequest`'s `exec` variant has carried `capability?: readonly Delegation[]` since Phase 4, encoded and parsed with every field validated — a wire slot with no producer"
  - phase: phase-11
    provides: "the named-sentinel convention (`'serves-unauthenticated'`) and the compile-failure guard in `agent-contract.test.ts` this plan mirrors"
  - phase: phase-14
    provides: "`Task.moduleRecord` — the precedent for an optional field on the `exec` variant, and the rule that a malformed one refuses the whole frame"
provides:
  - "RemoteExecutor's required third constructor argument: `CapabilitySupplier | 'dispatches-unauthenticated'`"
  - "CapabilitySupplier, exported from @o2/net's only entry point, so 15-03 and 15-04 can name it under isolatedDeclarations"
  - "the compile-time proof that the chain argument cannot be omitted, symmetric with serveAgent's seven hooks"
  - "an end-to-end proof that a minted chain reaches a serving node's authorize hook deep-equal, and that a refusal there still precedes execution"
affects: [phase-15-plan-03, phase-15-plan-04, phase-20-churn, phase-22-reachability]

tech-stack:
  added: []
  patterns:
    - "a frame claim is asserted on what the sender actually sent, captured at a peer RpcEndpoint handler — never on a frame the test rebuilt by calling the encoder itself"
    - "a burn-down count with a permanent floor states its floor, and pairs each sentinel count with a construction count so a passing number cannot come from a deleted call site"

key-files:
  created:
    - packages/net/src/remote-executor-contract.test.ts
    - packages/net/src/capability-dispatch.test.ts
  modified:
    - packages/net/src/remote-executor.ts
    - packages/net/src/index.ts
    - packages/node/src/serve-agent-hooks.node.test.ts
    - packages/browser/demo/main.ts
    - packages/node/src/bin/bench.ts
    - packages/bench/src/perf-workload.ts
    - packages/libp2p/src/audience-key.ts
    - packages/net/src/distributed.test.ts
    - packages/net/src/sovereign-execution.test.ts
    - packages/net/src/discovery.test.ts
    - packages/net/src/sovereign-egress.test.ts
    - packages/net/src/submit-with-egress.test.ts
    - packages/node/src/fabric-node.node.test.ts
    - packages/node/src/two-process.node.test.ts
    - packages/node/src/egress-manifest.node.test.ts
    - packages/node/src/egress-refusal.node.test.ts
    - packages/node/src/relaying.node.test.ts
    - packages/node/src/sovereignty-placement.node.test.ts
    - packages/node/src/signed-artifact.node.test.ts
    - packages/node/src/named-refusal.node.test.ts
    - packages/node/src/sovereign-block-refusal.node.test.ts

key-decisions:
  - "The chain rides on the per-remote adapter, not on Task, because the audience a chain must end at is one specific node's key and a task may be dispatched to several"
  - "A supplier rather than a fixed array, so one RemoteExecutor serving several shards of one job can carry a different chain for each"
  - "An empty supplier return and the sentinel encode identically — deliberately, because agent.ts coalesces absent and empty before any Authorizer sees them"
  - "The sentinel at the three production sites is permanent and correct, not a stub: their shards are all label: 'public', so there is no owner and no root key"
  - "The frame assertion reads what RemoteExecutor sent, captured at a peer RpcEndpoint handler, because an assertion rebuilt from encodeRequest survives the deletion of the code it is about"

requirements-completed: [AUTH-03]

duration: 22min
completed: 2026-07-31
---

# Phase 15 Plan 02: The Dispatching Half — Summary

**The `capability?` slot that has ridden `AgentRequest`'s `exec` variant unfilled since Phase 4 now has a producer, and no call site can decline to think about it — `RemoteExecutor`'s third constructor argument is required, and omitting it is a `tsc --noEmit` error that names it.**

## The limit of that claim, stated plainly

Per the plan's own success criteria, in its words: **a producer exists and every call site must name its choice; no production call site chooses a chain.** All *five* non-test `new RemoteExecutor(` sites take the sentinel when this plan finishes, and Plan 15-03 does not convert them either. The supplier branch of `execute` therefore ends the phase exercised only by test suppliers, and the *minting* side of AUTH-03 remains entry-point-unreachable — recorded in `remote-executor.ts`'s class comment with the three options considered and the one taken, where Phase 22's reachability guard will read it.

(The plan said four production sites. There are five. See Corrections.)

## Performance

- **Duration:** 22 min
- **Started:** 2026-07-31T17:07 (worktree spawn; first commit 17:14)
- **Completed:** 2026-07-31T17:29
- **Tasks:** 3 of 3
- **Files created/modified:** 23 (2 created, 21 modified)

## Task Commits

| Task | Commit | What |
|---|---|---|
| 1 (RED) | `c5d6e1c` | `test(15-02): the chain argument RemoteExecutor does not yet require` |
| 1 (GREEN) | `5bbcebd` | `feat(15-02): make a RemoteExecutor say what it dispatches with` |
| 2 | `1de4d91` | `feat(15-02): make all 53 dispatch sites name the chain they carry` |
| 3 | `e5b7e5b` | `test(15-02): a minted chain arrives intact, and a refusal still precedes execution` |

Both new test files were watched failing before the code they are about existed or worked.

## Accomplishments

- **`RemoteExecutor` is now symmetric with `serveAgent`.** Both refuse to be constructed with a hook left silent, and both have a compile-time guard that says so. `remote-executor-contract.test.ts` mirrors `agent-contract.test.ts:42-103` in structure and voice, including the `@ts-expect-error` convention that fails in *both* directions — as "Expected 3 arguments, but got 2" today, and as "Unused '@ts-expect-error' directive" the moment the parameter is widened back to optional. Both directions were observed, not reasoned.

- **The frame assertions read what `RemoteExecutor` actually sent.** An earlier draft of the plan proposed asserting on `parseRequest(encodeRequest({kind:'exec', task}))`. That expression is a fact about `protocol.ts:355-356` alone, was already true before Phase 15, and survives the deletion of the third argument entirely. Instead a second peer on the same `MemoryNetwork` installs a capturing `RpcHandler`, and `captured[i]` **is** the `CanonicalValue` the executor passed to `rpc.request` — `rpc.ts:183` wraps it as `{k:'req',id,body}`, `#receive` reads `record['body']` back at `:256` and hands it to the handler at `:278`.

- **The negative reading never stands alone.** "No `capability` key" is satisfied perfectly by an empty capture array, which is exactly what an uninstalled handler produces. So the sentinel and supplier dispatches share one `it`, and `expect(captured).toHaveLength(2)` plus the supplier's `toHaveLength(1)` are the positive control proving the instrument was live before the zero is read off it.

- **A minted chain arrives deep-equal, end to end.** `capability-dispatch.test.ts` asserts `toEqual(chain)` against the minted value at a real `serveAgent` `authorize` hook, not a length check — a signature is over exact bytes, so a field reordered or a number widened in transit invalidates the chain at a verifier while passing a length check. This complements rather than duplicates `distributed.test.ts:606-635`, which pins the same failure mode at the encode/parse level; that round trip stays green if `RemoteExecutor` attaches nothing at all.

- **A two-link chain arrives with both links, in the minted order**, checked by comparing `issuer` at each index against `[alice.pub, coord.pub]`. A chain truncated to a prefix that happens to verify is the failure this rules out.

- **Ordering is proven by absence of execution, not by the wording of a reply.** A refused dispatch leaves the counting executor at `0`; an accepted one leaves it at `1`; both readings are in the same file, so the `0` comes off an instrument shown able to count. That counter is strictly stronger than an instantiate-level instrument would be — `WasmExecutor.execute` is the only caller of `WebAssembly.instantiate` on this path, so a counter inside the executor is upstream of every instantiate there is. No instrument in this repository observes `instantiate` directly and none was invented.

- **No dependency was added and no existing assertion changed meaning.** `package.json`, every `packages/*/package.json` and `package-lock.json` are byte-identical to the base commit; no `npm install` was run in the shared checkout. The 53 call-site edits add an argument and change nothing a test asserts.

## Verification

| Check | Result |
|---|---|
| `npx tsc --noEmit` (whole repository) | **exit 0** |
| `vitest --project node` (whole project) | 91 files, **1316 passed**, 18 skipped, **0 failed** |
| `vitest --project browser packages/net` | 54 files, **543 passed** (chromium + firefox + webkit) |
| `vitest --project browser packages/browser` | 33 files, **345 passed** |
| `remote-executor-contract.test.ts` | 7 passed node / 21 browser |
| `capability-dispatch.test.ts` | 5 passed node / 15 browser |
| `purity.node.test.ts` | passed — `@o2/net` stayed portable |
| `vocabulary.node.test.ts` | passed, run **after** committing so `git ls-files` saw the new files |
| `serve-agent-hooks.node.test.ts` | passed — the four `'serves-unauthenticated'`/`'accepts-every-offer'` rows unchanged, three new rows added |
| file deletions vs. base | **none** |
| `package.json` / `package-lock.json` / `packages/*/package.json` | unchanged |
| `.planning/` | untouched — STATE.md and ROADMAP.md not modified |

**Resolver proof (the trap inherited from Phase 14).** The worktree has no `node_modules`, and symlinking the main install wholesale resolves `@o2/*` back to the **main checkout**, so `tsc` and `vitest` would report clean without reading a line of this work. A farm was built instead — 184 third-party entries symlinked at the main install, all 8 `@o2/*` repointed at this worktree's `packages/` — and proved before any test was trusted:

```
OK   @o2/core -> …/worktrees/agent-aedcddf7004456b99/packages/core/src/index.ts
OK   @o2/net  -> …/worktrees/agent-aedcddf7004456b99/packages/net/src/index.ts
…all 8 OK…
     vitest/package.json     -> /Volumes/…/o2.services/node_modules/vitest/package.json
     typescript/package.json -> /Volumes/…/o2.services/node_modules/typescript/package.json
FARM PROVEN
```

Every vitest run reported `RUN v4.1.10 /Volumes/…/worktrees/agent-aedcddf7004456b99` as its root. Every run used `--project node` or `--project browser`; no bare-path invocation was made, per the inherited warning about fan-out across four projects.

## Mutation Testing — observed, not predicted

All four were planted, run, and restored by `cp` from a scratch baseline **outside** the working tree, each restoration confirmed byte-identical with `cmp` **and** against `HEAD`. No `git checkout`, `restore`, `stash`, `reset` or `clean` was used at any point after the startup base correction — several agents share this checkout.

| # | Mutation | Plan predicted | **Observed** |
|---|---|---|---|
| A | delete the `capability: chain` branch in `#requestFor` so it always sends the no-key form | "arrival, two-link-order and per-task go red" | **3 of 5 red in `capability-dispatch.test.ts`, exactly those three** — and **2 of 7 in `remote-executor-contract.test.ts`**, including the positive control. Planted *before* `capability-dispatch.test.ts` was written, so that file's first run was against the defect |
| B | make the sentinel encode a present-but-empty `capability` (the typed form of "delete the sentinel branch") | "the sentinel's captured frame gains a `capability` key and the negative assertion goes red" | **1 of 12 red**, `expected [] to be undefined` — precisely the assertion the discarded hand-built `encodeRequest` version would have survived |
| C | widen the third constructor parameter back to optional (`= 'dispatches-unauthenticated'`) | "the `@ts-expect-error` directive becomes unused, which is itself a `tsc --noEmit` error" | **exactly that, and nothing else**: `remote-executor-contract.test.ts(172,7): error TS2578: Unused '@ts-expect-error' directive.` Whole-repository `tsc` exit 1, one error |
| D | delete `export type { CapabilitySupplier }` from `packages/net/src/index.ts` | "Plan 15-03's `chainSupplierFor(nodeId): CapabilitySupplier` becomes uncompilable — no deep-import path to fall back on" | **confirmed against a real stand-in**: a scratch `packages/node/src/probe-barrel.ts` writing `chainSupplierFor(_nodeId: string): CapabilitySupplier` compiled clean with the line present and produced `error TS2305: Module '"@o2/net"' has no exported member 'CapabilitySupplier'.` without it. Probe deleted afterwards |

**Mutation A's third message is the finding worth keeping.** The per-task assertion failed as `expected [] to not deeply equal []` — "Compared values have no visual difference". Both captures were `[]`, **not `undefined`**, which is `agent.ts:402-408`'s coalesce turning an absent chain into an empty one before the `Authorizer` sees it. An authorizer physically cannot tell "sent nothing" from "sent an empty chain". That is precisely why the no-key claim is asserted at an `RpcEndpoint` handler in the contract test and *not* at an `authorize` hook, and it is now demonstrated rather than asserted.

**Two claims in this plan have no production deletion behind them, and that is stated rather than papered over.** The three `'dispatches-unauthenticated'` burn-down counts in `serve-agent-hooks.node.test.ts` are substring counts over source text, like every other row in that file. They prove the string is present and state the floor it must not fall below; they prove nothing about a dispatch, and nothing here claims otherwise. Inventing a mutation for them would be fabricating evidence.

## Corrections — every `file:line` was re-grepped before being relied on

The phase-level warning was correct: these plans were written against an older tree. **Nine** stated locations had drifted or were wrong, plus one count and one enumeration. Reported per the standing rule that a correction living in one SUMMARY reaches no sibling plan — **Plans 15-03 and 15-04 should re-grep rather than trust either copy**.

| Plan said | Actually | Load-bearing? |
|---|---|---|
| **44** `new RemoteExecutor(` sites | **53**, in **18** files. Five files the plan never lists: `packages/bench/src/perf-workload.ts` (1), `packages/node/src/signed-artifact.node.test.ts` (5), `packages/node/src/named-refusal.node.test.ts` (1), `packages/node/src/sovereign-block-refusal.node.test.ts` (1), and `fabric-node.node.test.ts` has **8**, not 7 | **Yes.** All 53 handled |
| "the two production sites"; success criteria says "**all four** non-test sites" | **Three files, five sites**: `demo/main.ts:407,598`, `bin/bench.ts:392,450`, **and `bench/src/perf-workload.ts:227`** — a production dispatch site the plan does not mention anywhere. Its shards are `label: 'public'` at `:337`, same as `bin/bench.ts`, so the sentinel is equally permanent there | **Yes.** A burn-down covering two of three production sites has a hole; the third now has its own row |
| `protocol.ts:56-61` is the `exec` variant | **`:56-62`** (the `capability?` field is `:61`, the closing brace `:62`) | Minor |
| `protocol.ts:304-305` encodes `capability`; `:280-306` is encodeRequest's exec branch | **`:355-356`**; the branch runs to `:357` | **Yes** — cited in shipped source, so the shipped comments carry `:355-356` |
| `protocol.ts:422-433` parses it | **`:546-557`** | Not cited in code |
| `agent.ts:215-221` is the authorize coalesce | **`:402-408`** (the whole `try` is `:399-420`) | **Yes** — cited in shipped source and in both new test files |
| `agent.ts:38-42` is `RpcBlockSource`'s `peers` thunk | **`:31-45`** — `:31-37` is the doc comment stating the thunk reasoning, `:38` the class, `:42-45` the constructor | **Yes** — cited in shipped source |
| `agent.ts:114` is `AgentOptions.reservations` | **`:130`**. `:112-129` is its doc comment | **Yes** — cited in shipped source |
| `rpc.ts:151-154` is `request` wrapping the body | **`:179-183`**. `:151-154` is the constructor | **Yes** — cited in shipped test comment |
| `rpc.ts:203-235` is `#receive`, `:217` reads `record['body']`, `:235` calls the handler | **`record['body']` at `:256`, handler at `:278`** | **Yes** — cited in shipped test comment |
| `ROADMAP.md:507-516` is Phase 22's reachability guard, criterion 1 at `:514` | **`:529-542`**, criterion 1 at **`:536`**. `:507-516` is Phase 20 | **Yes** — 15-04 Task 3 amends the roadmap and must not edit Phase 20 by mistake |
| `purity.node.test.ts:167-174` keeps the `Executor` port narrow deliberately | **Wrong, not merely drifted.** `:167-174` is `it('has no dependency edge from @o2/core to any adapter package')`, and the string `Executor` appears **nowhere** in that file. There is no test in this repository asserting the `Executor` port carries no chain | **Yes.** The citation was *not* written into shipped source. The class comment makes the argument on its own terms — a chain on `Task` could only ever name one of the several nodes a task may reach — without claiming a guard that does not exist |

Verified **correct** and worth recording, because the phase's claims rest on them: `capability.ts:52-60` is `Delegation`; `:79-87` is `delegate`; `:203-205` is the `wrong-audience` refusal; `capability.test.ts:12-15` is the seeded `keypair` and `:27-40` the two chain fixtures; `distributed.test.ts:509-566` is the fabric shape and `:606-635` the round-trip assertion; `agent-contract.test.ts:42` names the hook count and `:52-103` holds the seven omission cases; `protocol.ts:507-508` refuses a label-less `exec`; `PROJECT.md:235` is the "An optional hook with a silent default is a hole" row; `packages/net/src/index.ts:19` is the `RemoteExecutor` export anchor.

The phase-level warning's own corrections were **re-verified and hold**: `browser-node.ts:376-386`, `fabric-node.ts:505-552`, `agent.ts:63-66` (`Authorizer`), `agent.ts:398-420` / `:402-408` / `:419`, `protocol.ts:507-508`, `submit.ts:30-32`, and `capability.ts:104`.

## Decisions Made

- **`CapabilitySupplier` is exported from the barrel in the same commit as the type, not later.** `packages/net/package.json` declares exactly one entry point, `"."`, with no deep-import subpath, and `isolatedDeclarations: true` forces Plan 15-03's `chainSupplierFor(nodeId: string): CapabilitySupplier` to write the name out. Mutation D proved this against a real stand-in rather than by reasoning. Appended at the stated anchor (`:19`); no surrounding block reflowed or regrouped, since this barrel is a cross-phase hotspot.

- **`#requestFor` is a separate private method, not inline in `execute`.** The three-branch frame choice and the network-failure handling are different concerns, and separating them keeps `execute`'s `try` around exactly the send. Everything after the send — `parseResponse`, the three failure branches, and `return response.outcome` — is byte-identical to before.

- **The production sentinels are documented as *permanent*, not temporary.** Writing "for now" at those five sites would invite a later reader to burn them down to zero and break the benchmark's comparability. The comments say why the sentinel is correct there forever: public shards, no owner, no root key, and `authorizeCapability`'s first precedence step returns `null` for a public task regardless.

- **Each burn-down row is paired with a `new RemoteExecutor(` count.** A count of 2 is also what *deleting* a call site and adding a new one elsewhere produces. Pairing the sentinel count with a construction count makes the row say "two sites, both stating the sentinel" rather than "the string appears twice". Follows the `new LocalCapacity(` pattern already in that file at its bench row.

- **Two clocks, sized after measuring the host.** `uptime` read a 1-minute load average of **31.29** before either bound was chosen, so the RPC budget is 10 s and the vitest timeout 30 s — the framework's strictly the larger, both with headroom. Neither number is a claim about how long anything takes; `MemoryNetwork` is in-process and nothing approaches either bound. Recorded in both new files' headers.

- **Neither new test file carries a `.node.` suffix**, so both run in Node and in Chromium, Firefox and WebKit. Everything on the path is `@noble/curves` pure JS and never touches `crypto.subtle` — the kernel's "must never require a secure context" constraint is satisfied by construction, and these files passing in three engines is what says so.

- **Line reflow was kept to the four lines that exceeded their own file's prior maximum** (`sovereign-execution.test.ts` 113→130, `bin/bench.ts` 125→137, `fabric-node.node.test.ts` 115→133). Files that already carried longer lines than the conversion produced were left alone. There is no formatter configured in this repository, so "matching the file" is the only available standard.

## Deviations from Plan

Three, all reported rather than silently absorbed. None required a checkpoint.

**1. [Rule 2 — missing critical functionality] The burn-down count covered two of three production dispatch sites**
- **Found during:** Task 2, on the mandated re-grep.
- **Issue:** The plan specifies burn-down rows for `demo/main.ts` and `bin/bench.ts` only. `packages/bench/src/perf-workload.ts:227` is a third production dispatch site the plan never mentions — it appears in no file list, no count and no success criterion. A burn-down guard that covers two of three sites is a guard with a hole in it: the uncovered site could silently acquire or lose a sentinel.
- **Fix:** Converted it with the same stated reasoning (its shards are `label: 'public'` at `:337`), and added a third `it` to `serve-agent-hooks.node.test.ts` counting it, with a comment saying the plan counted two and this is the third, so the next reader inherits three rather than re-discovering it.
- **Files:** `packages/bench/src/perf-workload.ts`, `packages/node/src/serve-agent-hooks.node.test.ts`
- **Commit:** `1de4d91`

**2. [Rule 1 — bug] `audience-key.ts`'s doc comment named a constructor signature this plan removes**
- **Found during:** Task 2, in the `new RemoteExecutor(` grep — the 54th hit was prose, not a call.
- **Issue:** `packages/libp2p/src/audience-key.ts:13` (shipped by Plan 15-01 six commits earlier) reads "the `nodeId` string it already passes to `new RemoteExecutor(nodeId, rpc)`". This plan makes that signature false. A doc comment restating a signature is a citation that drifts, which is the exact failure this phase has been correcting all day.
- **Fix:** Reworded to name the argument by position — "passes as `new RemoteExecutor`'s first argument" — so it cannot drift again. One line; the surrounding reasoning is untouched.
- **Files:** `packages/libp2p/src/audience-key.ts`
- **Commit:** `1de4d91`

**3. [Reporting obligation, not a rule] The plan's `purity.node.test.ts:167-174` citation is wrong, not drifted**
- The plan's Task 1 `<action>` instructs the class comment to say that widening the `Executor` port "would be the wrong direction, kept wrong deliberately by `purity.node.test.ts:167-174`". That range is the "no dependency edge from `@o2/core` to any adapter package" test, and the string `Executor` appears nowhere in the file. **No test in this repository asserts the `Executor` port carries no chain.**
- **Action taken:** the citation was **not** written into shipped source. The class comment argues the point on its own terms instead — a chain carried on `Task` could only ever name one of the several nodes a task may be dispatched to, and widening the port would push a network concern into the kernel. No claim is made about a guard that does not exist.

**No existing assertion was weakened, reworded or deleted.** The 53 call-site edits add an argument. `serve-agent-hooks.node.test.ts`'s four pre-existing `it`s are unchanged line for line; only its header comment was extended and three new `it`s appended.

## Files Created/Modified

- `packages/net/src/remote-executor.ts` — `CapabilitySupplier` type; required third constructor parameter; `#requestFor` with its three-branch frame choice; a documented class-comment paragraph recording the entry-point-unreachability of the minting side, with the three options and the one taken.
- `packages/net/src/index.ts` — one export line appended at the `:19` anchor, with the reason it is load-bearing rather than tidy.
- `packages/net/src/remote-executor-contract.test.ts` (new, 280 lines) — three compile-contract cases including the `@ts-expect-error` guard, and four runtime cases reading captured frames.
- `packages/net/src/capability-dispatch.test.ts` (new, 319 lines) — five behaviours over a real `serveAgent`/`RpcEndpoint` fabric: direct-chain arrival, two-link arrival and order, per-task selection, refusal-before-execution, and the paired non-zero reading.
- `packages/node/src/serve-agent-hooks.node.test.ts` — extended header stating the burn-down now covers both sides of a dispatch and that the new counts have a permanent floor; three new `it`s, each pairing a sentinel count with a construction count.
- `packages/browser/demo/main.ts`, `packages/node/src/bin/bench.ts`, `packages/bench/src/perf-workload.ts` — the five production sites, each with a stated permanent reason.
- `packages/libp2p/src/audience-key.ts` — one doc-comment line (deviation 2).
- Fourteen test files — the remaining 48 call sites, argument added, nothing else changed.

## Known Stubs

**None.** No hardcoded empty value flows to a UI, no placeholder text was introduced, and no component was left without a data source.

The five production sentinels are explicitly **not** stubs and are documented as such in source: they are the correct, permanent value for public work under this phase's own reasoning, not a placeholder awaiting wiring. Recorded here so a future reader scanning for stubs does not mistake them for one.

## Threat Flags

None. This plan introduces no network endpoint, no auth path, no file access pattern and no schema change at a trust boundary. It adds a producer for a wire field that has existed and been parsed with every link validated since Phase 4.

The one boundary worth restating, from the plan's threat model: a supplier that returns the wrong owner's chain is a **requestor bug this layer cannot detect** — anything the supplier returns is what the serving node will judge. That is by design; the serving node's job is to verify, and verification is 15-01's `authorizeCapability`, wired in 15-03.

## Issues Encountered

1. **The worktree resolver trap** (inherited warning, hit as described). Resolved by building a per-package farm and proving `@o2/*` resolution before trusting any test.
2. **Base commit correction at startup.** The worktree spawned at `c62bae5` (a `main` merge) whose merge-base with the required base `6adb450` was `bbb7b2a`. The working tree was clean, so the sanctioned startup `git reset --hard 6adb450` was applied. This was the only `git reset` in the session and it preceded all work.
3. **A bulk-conversion script over-applied to the file it should have skipped.** The paren-matching script that added the third argument at 53 sites also added a fourth argument at the contract test's supplier sites and, worse, a sentinel at the `@ts-expect-error` two-argument case — which would have silently destroyed the guard. Caught because the guard is a `tsc` error in both directions. Restored by reading the blob out of `HEAD` and writing it back (not `git checkout`), confirmed byte-identical. The lesson generalises: a mechanical edit across a repository must exclude the file that tests the thing being edited.
4. **`parseRequest(...)?.capability` does not type-check**, contrary to the plan's `<proof>` block, because `capability` lives only on the `exec` member of the `AgentRequest` union. Both test files narrow through a small `execFrame` helper instead, which also makes each assertion prove the frame really was an `exec`.

## Next Phase Readiness

- **Plan 15-03 has everything it needs from this side.** `CapabilitySupplier` is exported from `@o2/net` and named under `isolatedDeclarations` (proved by Mutation D). When 15-03 converts a test file's sites from the sentinel to a real chain, `capability-dispatch.test.ts` is the file that already proves the chain will arrive intact — so a failure there will localise to *verification*, not to dispatch.
- **Plan 15-04 Task 3 must amend two things, and one has moved.** ROADMAP Phase 15's goal line at **`:413`** reads "both ends wired for the first time", and the checklist line at **`:54`** repeats it; both would be contradicted by the phase that closes it, since no production call site chooses a chain. Phase 22's block is at **`:529-542`**, criterion 1 at **`:536`** — *not* `:507-516`, which is Phase 20. The wording there must agree with `remote-executor.ts`'s class comment.
- **`remoteDispatch` (`packages/net/src/churn.ts`) is still the repository's second `exec` sender and still carries no chain.** Out of scope here by the plan's own statement; it needs the identical treatment when the churn coordinator is wired in Phase 20.
- **Unchanged and still true:** every production `authorize` call site passes `'serves-unauthenticated'`, so the four test files 15-CONTEXT.md flags as breaking are all still green. They break in 15-03, not here.
- **No blockers.**

## Self-Check: PASSED

All 23 changed paths and this SUMMARY exist on disk; all 4 commit hashes are present in `git log`. Verified by direct filesystem and `git log` reading, not by recollection.

---
*Phase: phase-15-capability-chained-dispatch*
*Completed: 2026-07-31*
