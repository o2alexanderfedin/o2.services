---
status: passed
phase: 11
verified: 2026-07-27
score: 3/3 criteria verified
criteria_met: 3
criteria_total: 3
---

# Phase 11 — Verification

Goal-backward: does the codebase deliver what the phase promised, criterion by
criterion, checked against something that was run in this session rather than
against the SUMMARY's narration of what a prior session ran.

**Environment:** this host, `feature/v1.1-wire-what-was-built`, HEAD `79aad73`
(merge of Phase 11), working tree clean before and after every check below.
`node v23.11.0`, `typescript 7.0.2`, `vitest 4.1.10`.

**A note on this phase's own history, because it is exactly the kind of claim this
verifier is built to distrust.** Commit `306d8b5` ("fix(11): reword planning prose
instead of exempting it from the vocabulary guard") documents, in its own message,
that the prior commit (`ab1061d`, the SUMMARY completion commit) had reported the
suite green while `vocabulary.node.test.ts` was actually red at 5 failures — the
SUMMARY's own exemption fix had tripped the guard it was fixing. That defect was
real, is fully described in the current `11-01-SUMMARY.md`'s Deviations section, and
is already corrected in the commit this verification is checking (`79aad73`). It is
reported here, not to re-litigate it, but because a verifier that took the SUMMARY at
face value at commit `ab1061d` would have signed off on a red suite. Every command
below was run fresh, in this session, against the final merged state — not read off
a prior report.

## 1. Removing any single hook argument from a `serveAgent(...)` call fails `tsc --noEmit`, naming the missing hook — omission is a compile error, not a silent default

**MET.**

**The static shape.** `AgentOptions` in `packages/net/src/agent.ts:65-133` declares
all six hooks (`authorize`, `index`, `capacity`, `reservations`, `ledger`,
`onDispatch`) without a `?`, each as `RealType | 'named-sentinel-literal'`:

```
grep -E "readonly (authorize|index|capacity|ledger|reservations|onDispatch)\?:" packages/net/src/agent.ts
→ no matches
```

**The compile-failure proof is not vacuous — checked by removing the suppression
and reading the raw error, not by trusting the guard agrees with itself.** I deleted
the `@ts-expect-error` comment above the `authorize`-omission case in
`agent-contract.test.ts` and ran `npx tsc --noEmit` directly:

```
packages/net/src/agent-contract.test.ts(54,33): error TS2741: Property 'authorize'
is missing in type '{ rpc: RpcEndpoint; executor: Executor; blockstore: Blockstore;
index: "serves-no-records" | RecordIndex; capacity: "accepts-every-offer" |
LocalCapacity; reservations: "relays-for-nobody" | (() => readonly string[]);
ledger: "keeps-no-ledger" | StartOutcomeLedger; onDispatch: "reports-no-dispatch" |
((from: string)...' but required in type 'AgentOptions'.
```

The underlying error genuinely names the hook (`Property 'authorize' is missing`),
which is what the suppression comment is standing in front of — it is not
suppressing something incidental. Reverted; `git diff` on the file went back to
empty; `npx tsc --noEmit` exited 0 again.

**Mutation test (per the verification brief, not the SUMMARY's account of it) —
planted myself, run myself:** reverted
`readonly authorize: Authorizer | 'serves-unauthenticated'` back to
`readonly authorize?: Authorizer` in `agent.ts`. `npx tsc --noEmit` then reported,
among 19 errors across every call site that now silently overshoots the loosened
type:

```
packages/net/src/agent-contract.test.ts(54,5): error TS2578: Unused '@ts-expect-error' directive.
```

— exactly the "guard fails in the direction that matters" claim: with the hook
optional again, the suppression comment itself becomes the reported defect. The
mutation also broke `packages/browser/src/browser-node.ts(213,7)` and
`packages/node/src/fabric-node.ts(358,7)` (`Type 'string' is not assignable to type
'Authorizer'`), which is independent evidence that the `bin/agent.ts`/browser-node
call sites documented in the ROADMAP's criterion 1 wording are reached by this
guard, even though neither file calls `serveAgent` directly — both reach it
transitively through `FabricNode.start()` / `BrowserNode.start()`. Reverted; `cp` of
the pre-mutation file confirmed byte-identical; `npx tsc --noEmit` exited 0 again.

**`bin/seed.ts`'s route confirmed too, not assumed:**
`grep -n "FabricNode" packages/node/src/seed-server.ts` shows `SeedServer.start()`
constructing a `FabricNode` (`seed-server.ts:191`), so `bin/seed.ts` reaches the same
`fabric-node.ts:354` call site as `bin/agent.ts` — one production `serveAgent` site
serves both binaries, and the mutation above broke both routes' compile.

## 2. Every production call site that starts a node passes all six hooks explicitly

**MET.**

**Call sites counted myself, not taken from the plan's claim of four:**

```
grep -rn "serveAgent(" packages --include="*.ts" | grep -v "\.test\.ts"
packages/net/src/agent.ts:136:export function serveAgent(...           ← the definition, not a call
packages/node/src/bin/bench.ts:123:  serveAgent({                       ← requestor
packages/node/src/bin/bench.ts:145:    serveAgent({                    ← per-worker
packages/browser/src/browser-node.ts:209:    serveAgent({
packages/node/src/fabric-node.ts:354:    serveAgent({
```

Exactly four calls (one definition excluded). Read each object literal directly:

- `fabric-node.ts:354` — `authorize: 'serves-unauthenticated'`, `index:
  'serves-no-records'`, `capacity: 'accepts-every-offer'`, `reservations: () =>
  node.reservedPeerIds` (real, unchanged), `ledger: 'keeps-no-ledger'`, `onDispatch:
  'reports-no-dispatch'` — six keys.
- `browser-node.ts:209` — five sentinels plus the real `onDispatch: (from) => {...}`
  callback, unchanged — six keys.
- `bench.ts:123` and `bench.ts:145` — all six sentinels at both sites.

`serve-agent-hooks.node.test.ts` (structural guard reading the three files' text off
disk) passed with exact counts — 1 each for `fabric-node.ts`'s five sentinels and 0
for `relays-for-nobody`; 1 each for `browser-node.ts`'s five sentinels and 0 for
`reports-no-dispatch`; 2 each for all six in `bench.ts`.

**Mutation test on the sentinel-count guard, planted and run myself:** replaced
`reservations: () => node.reservedPeerIds` in `fabric-node.ts` with the sentinel
`'relays-for-nobody'` and ran the guard:

```
FAIL  serve-agent-hooks.node.test.ts > fabric-node.ts: real reservations, five sentinels
AssertionError: expected 1 to be +0
```

It caught it. Reverted; `git diff` empty; test passed 3/3 again.

## 3. Two nodes still dispatch a job successfully after the refactor, and the `reservations` hook continues to answer real peer IDs rather than regressing to `[]`

**MET — verified against a real two-process run, not only the unit suite.**

`packages/node/src/two-process.node.test.ts` spawns `bin/agent.ts` as two actual
child OS processes (`node --experimental-strip-types … bin/agent.ts`), dials both
from a `FabricNode` submitter running in this process, and dispatches a real job
over the wire. Ran it directly:

```
npx vitest run packages/node/src/two-process.node.test.ts --reporter=verbose

✓ NET-01 — a job across OS processes > completes 4 shards at R=2 in two separate agent processes    634ms
✓ NET-01 — a job across OS processes > leaves fetched blocks on disk in the worker process, surviving its death   440ms
✓ NET-01 — a job across OS processes > reports a dead process as a failed replica without failing the job   602ms

Test Files  1 passed (1)
     Tests  3 passed (3)
```

This is the literal claim in criterion 3 — "starting two nodes via bin/agent.ts and
dispatching a job between them" — exercised as two real OS processes, not simulated.

**The `reservations` regression is caught behaviourally, not only by the
sentinel-count grep.** With the same fabric-node.ts mutation as above
(`reservations: 'relays-for-nobody'` in place of the real thunk), the pre-existing,
unmodified `rendezvous-wire.node.test.ts` also failed:

```
✓ answers with the live reservation set, not an empty list
× lets two nodes on one relay discover each other, with nothing supplied
   AssertionError: expected [] to have a length of 1 but got +0
× is symmetric — bob finds alice by the same route
   AssertionError: expected [] to deeply equal [ Array(1) ]

Test Files  1 failed (1)
     Tests  2 failed | 2 passed (4)
```

So the "reservations regresses to `[]`" failure mode this criterion names is caught
twice, independently: by the new structural guard (string count) and by the
pre-existing behavioural test (real peer-discovery addresses). Reverted the
mutation; `git diff packages/node/src/fabric-node.ts` empty; re-ran
`rendezvous-wire.node.test.ts` and `relaying.node.test.ts` — 17/17 passing again.

## Full-repo regression, run fresh in this session

```
npx tsc --noEmit
→ exit 0, no output

npx vitest run
→ Test Files  115 passed (115)
→      Tests  1690 passed (1690)
→   Duration  288.06s
→ EXIT: 0
```

Matches the SUMMARY's claimed baseline (115 files / 1690 tests) exactly — this time
measured directly rather than read off the SUMMARY, and after this session's four
mutation-and-revert cycles left the tree byte-identical to `HEAD` (`git status
--short` empty throughout).

## Specifically-requested checks

**Behaviour unchanged — read, not assumed.** `git diff c3e6fe1..HEAD --
packages/net/src/agent.ts` shows seven branch rewrites (`providers`, `records`,
`reservations`, `report`/ledger, `offer`/capacity, `onDispatch`, `authorize`). Traced
each against its pre-phase `?.`/`??` form:

| Branch | Pre-phase | Post-phase | Equivalent? |
|---|---|---|---|
| `providers` | `(await options.index?.providers(cid)) ?? []` | sentinel → `[]`, else `await options.index.providers(cid)` | Yes |
| `records` | `(await options.index?.recordsFor(k)) ?? null` | sentinel → `null`, else `(await options.index.recordsFor(k)) ?? null` | Yes — the SUMMARY's disclosed catch: a naive rewrite would have dropped this `?? null`, since `recordsFor` returns `NodeRecords \| undefined`, not `\| null`. Caught by `tsc`, present in the final diff. |
| `reservations` | `options.reservations?.() ?? []` | sentinel → `[]`, else `options.reservations()` | Yes |
| `ledger`/`report` | `const ledger = options.ledger`; `ledger?.record/decline/counts` | `const ledger = sentinel ? null : options.ledger`; same three `?.` calls on the now-`\| null` local | Yes — `?.` behaves identically on `null` and `undefined` |
| `capacity`/`offer` | `options.capacity?.offer(...)` | sentinel → `undefined`, else `options.capacity.offer(...)` | Yes |
| `onDispatch` | `options.onDispatch?.(from)` | `if (options.onDispatch !== 'reports-no-dispatch') options.onDispatch(from)` | Yes |
| `authorize` | `options.authorize?.({...})`, checked against `null \|\| undefined` | sentinel → `null`, else `options.authorize({...})`, checked against `null` only | Yes — the simplification is sound because `Authorizer` itself is typed to return `string \| null`, never `undefined`; the only source of `undefined` was the old optional-call, which the sentinel branch now makes explicit. |

Only the `records` branch had a live defect, and it is the one the SUMMARY discloses.
No other branch has the same class of defect.

**No new vocabulary exemption.** `git diff c3e6fe1..HEAD --
packages/node/src/vocabulary.node.test.ts` is empty — confirmed directly in this
session. The exemption added mid-phase (visible in `82df80f`) and its later removal
(`306d8b5`) net to zero against the pre-phase file.

**Scope discipline.** `grep -rn "class LocalCapacity\|class RecordIndex\|class
StartOutcomeLedger\|implements Authorizer" packages/{net,node,browser}/src` (excluding
tests) returns nothing — no real hook implementation was added. The only two hooks
with a real (non-sentinel) supplier anywhere in production code are `reservations`
on `fabric-node.ts` and `onDispatch` on `browser-node.ts`, both pre-existing from
Phase 9 and explicitly named as "keep exactly as-is" in the plan — consistent with
"no hook gets a real implementation in this phase."

**Sentinel names state, not class.** Read all six doc comments and the dispatch
body in `agent.ts`: `'serves-unauthenticated'`, `'serves-no-records'`,
`'accepts-every-offer'`, `'keeps-no-ledger'`, `'relays-for-nobody'`,
`'reports-no-dispatch'` — each a verb phrase describing current behaviour, none an
noun naming a tier or kind of node.

## Anti-patterns

Scanned every file this phase touched (`agent.ts`, `fabric-node.ts`,
`browser-node.ts`, `bin/bench.ts`, both new guard files, and all six net-package
test files) for `TBD|FIXME|XXX|TODO|HACK|PLACEHOLDER` and stub-language patterns.
**None found.**

## An honest limit, not a gap against this phase's criteria

`BrowserNode.start()` — and therefore `browser-node.ts`'s `serveAgent` call site —
has no dedicated runtime test anywhere in the repository; the only caller in the
whole tree besides `browser-node.ts` itself is the demo entry point
(`packages/browser/demo/main.ts`). `git log --diff-filter=A --name-only -- "*browser-node*test*"`
returns nothing — this was true before Phase 11 as well, so the phase neither
introduced nor worsened it. The browser call site's correctness in this phase is
therefore established by `tsc` (including under the reverted mutation, which broke
`browser-node.ts` too) and by the sentinel-count guard reading its source text —
not by an actual dispatch through a running `BrowserNode`. ROADMAP criterion 3 does
not require this (it names `bin/agent.ts` only), so this is reported as a
pre-existing coverage limit, not a failed truth.

## Minor documentation staleness (not a code gap)

`.planning/REQUIREMENTS.md` line 295 marks `WIRE-01` `[x]` (done), but the
traceability table at line 437 still reads "Not started — new requirement, minted
2026-07-27" for the same ID. This is a doc-only inconsistency inherited from the
requirements file not being updated in the same commit as the phase's completion;
it does not affect any of the three verified criteria and does not require a plan.
Worth a one-line fix, not a gap.

## Summary

| # | Criterion | Verdict |
|---|-----------|---------|
| 1 | Omitting a hook fails `tsc --noEmit`, naming it | **MET** — raw error read directly, mutation planted and caught |
| 2 | All four production call sites pass all six hooks explicitly | **MET** — call sites counted and read myself; count-guard mutation caught |
| 3 | Two nodes dispatch a job; `reservations` still answers real peer IDs | **MET** — real two-process spawn run to completion; regression caught two independent ways |

3 of 3. Full regression (`tsc --noEmit`, `vitest run` — 115 files / 1690 tests) run
fresh in this session, exit 0. Working tree confirmed clean before, during (via
`git diff` after each mutation), and after every check.
