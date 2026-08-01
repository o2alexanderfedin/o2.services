---
phase: phase-18-discovery-capacity-placement
plan: 02
subsystem: discovery
tags: [discovery, content-routing, rpc, sovereignty, egress, record-index]

requires:
  - phase: phase-17-node-identity-enrollment/17-04
    provides: "`recordsFor` live on both tiers, and the recorded fact that `providers` answers `[]` from every node because `provide()` is never called"
provides:
  - "`SelfRecordIndex` in `@o2/core` — a node's own answer to both halves of a lookup, computed from its own store at ask time"
  - "`RpcRecordIndex.providers` unioning across every connected peer, deduplicated, sorted, asked concurrently"
  - "`withholdingFrom` in `@o2/net` — the ONE construction of the withholding predicate, agreeing with the `block` branch by asking that branch's own question"
  - "`EgressDisposition`, the written-out type `AgentOptions.egress` already carried inline"
  - "A measured correction to the plan's cost claim: fast failure costs nothing, silence costs the budget"
affects: [phase-18-discovery-capacity-placement/18-03, phase-18-discovery-capacity-placement/18-04, phase-18-discovery-capacity-placement/18-05]

tech-stack:
  added: []
  patterns:
    - "One question asked twice, never one question written down twice: the withholding predicate builds the candidate reply the `block` branch would build and puts it to the same `violationIn` scan"
    - "A predicate held as given and consulted per lookup, because a registration's lifetime is a hold and not a process"
    - "A quantity in a doc is a quantity to measure: the union's cost is read against the endpoint's own configured budget rather than against a number nobody chose"
    - "Assert an ordering property, never a wall-clock threshold, when the claim is concurrency"

key-files:
  created:
    - packages/net/src/provider-merge.test.ts
  modified:
    - packages/core/src/discovery.ts
    - packages/core/src/discovery.test.ts
    - packages/core/src/index.ts
    - packages/net/src/discovery.ts
    - packages/net/src/sovereign-egress.ts
    - packages/net/src/index.ts

key-decisions:
  - "`withhold` takes `((cid) => boolean | Promise<boolean>) | 'advertises-everything-it-holds'`, widening the plan's synchronous signature — the only correct predicate needs the bytes, and a synchronous one still satisfies the type."
  - "The withholding predicate is NOT `registrations.includes(cid.toString())` as 18-02 and 18-03 both write. That is a second copy of the condition, and it was planted and measured to advertise a block the `block` branch refuses."
  - "`withholdingFrom` lives in `sovereign-egress.ts`, not `agent.ts`: `agent.ts` is claimed by 18-04 in wave 2, and `agent.ts` already imports `sovereign-egress.ts` so the dependency direction is preserved."
  - "`recordsFor` stays sequential with an early return, and a counted test over two peers both holding the same record says so."
  - "No probe deadline invented for the union. `DEFAULT_PROBE_TIMEOUT_MS` answers a different question."

patterns-established:
  - "Plant the plan's own suggested implementation when it is the cheaper one, to show what it costs"
  - "Plant a reddening claim in more than one form when the plan names more than one — a constructor boolean and a per-CID memo are different defects"

requirements-completed: []

duration: 41min
completed: 2026-08-01
---

# Phase 18 Plan 02: A node answers for what it holds — Summary

**`providers` has a production answer for the first time: every node answers about its own
store at ask time, and a requestor asking every connected peer gets all of their answers
rather than the first one. The invariant that keeps that from becoming a side channel is
held by asking the `block` branch's own question — not by a second copy of it, which was
planted and measured to leak.**

## Performance

- **Duration:** 41 min
- **Tasks:** 2 of 2
- **Files created:** 1 · **modified:** 6

## Commits

| Commit | Task | What |
|---|---|---|
| `0ec6423` | 1 | a node answers for what it holds, from its own store |
| `18c1a93` | 2 | `RpcRecordIndex.providers` asks everyone, and agrees with the block branch |
| `20d3d89` | 2 | measure the union's cost instead of asserting it |

## Verification

| Check | Result |
|---|---|
| `npx tsc --noEmit` (worktree root) | **exit 0**, against a resolver proven to read this worktree |
| `npm run test:node` (full suite) | **107 files passed**, 2 skipped · **1546 tests passed**, 19 skipped |
| Baseline before any edit | 106 files passed, 2 skipped · **1528 passed**, 19 skipped |
| Delta | +1 file, **+18 tests**, exactly the 8 + 10 added here |
| `purity.node.test.ts` | passed — `@o2/core` and `@o2/net` remain PORTABLE |
| `vocabulary.node.test.ts` | passed |
| `packages/net/src/discovery.test.ts` | 7 passed, unchanged |
| `packages/net/src/sovereign-execution.test.ts` | 9 passed, unchanged |

**The resolver proof, because a wholesale `node_modules` symlink is silently wrong.** The
main install's `@o2/*` entries are **relative** symlinks (`../../packages/core`), so following
them through a symlinked `node_modules` resolves back into the main checkout — `tsc` and
`vitest` would verify the wrong tree and report clean without reading a line of these changes.
A farm was built instead: every third-party entry symlinked at the main install, and a real
`@o2` directory whose entries point at **this worktree's** packages. Proven with
`createRequire` before any test result was believed:

```
@o2/core    -> …/agent-a852fa0e86cfaf815/packages/core/src/index.ts
@o2/net     -> …/agent-a852fa0e86cfaf815/packages/net/src/index.ts
@o2/libp2p  -> …/agent-a852fa0e86cfaf815/packages/libp2p/src/index.ts
@o2/node    -> …/agent-a852fa0e86cfaf815/packages/node/src/index.ts
@o2/browser -> …/agent-a852fa0e86cfaf815/packages/browser/src/index.ts
@o2/aot, @o2/bench, @o2/demo  (same tree)
vitest      -> /Volumes/…/o2.services/node_modules/vitest/index.cjs
```

Every `@o2/*` resolves inside this worktree; third-party packages resolve to the shared
install, which is the same install and is correct. The probe script was deleted afterwards
and is not in any commit.

**The worktree was not on the branch the prompt said it was.** It was created from `main`
(`c62bae5`), which has no `phase-15`, `phase-16`, `phase-17` or `phase-18` planning directory
and none of their source. `git reset --hard feature/phase-18-discovery-capacity-placement`
was run at startup against a clean tree with nothing of this plan's work in it, so nothing
was lost. Base commit is `f3b0d8c`.

## The `.provide(` grep, command and full output

The premise this whole phase rests on is that `providers` answers `[]` in production. **A run
reporting zero hits anywhere would have found a broken instrument, not a clear field**, so the
recorded output below contains the known positives the plan named.

```
$ grep -rn "\.provide(" packages/ --include="*.ts"

packages/net/src/discovery.test.ts:157:    index.provide(inputCid, nodeKey)
packages/core/src/discovery.test.ts:93:    index.provide(cid, n.nodeKey)
packages/core/src/discovery.test.ts:146:    index.provide(cid, honest.nodeKey)
packages/core/src/discovery.test.ts:165:    index.provide(cid, a.nodeKey)
packages/core/src/discovery.test.ts:199:    index.provide(cid, a.nodeKey)
packages/core/src/discovery.test.ts:200:    index.provide(cid, 'ffff') // provides the block; never enrolled
packages/core/src/discovery.test.ts:305:    local.provide(cid, a.nodeKey)
packages/core/src/discovery.test.ts:318:    serverLocal.provide(cid, a.nodeKey)
packages/core/src/discovery.test.ts:407:    index.provide(cid, attacker.pub)
packages/core/src/discovery.test.ts:427:    index.provide(cid, attacker.pub)
packages/net/src/sovereign-execution.test.ts:193:    index.provide(inputCid, nodeId)
packages/net/src/sovereign-execution.test.ts:228:  index.provide(inputCid, foreignKey)
```

**Reading: 12 hits, every one in a `*.test.ts`, no production caller.** The plan predicted
`net/src/discovery.test.ts:157` (1), `net/src/sovereign-execution.test.ts` (2) and
`core/src/discovery.test.ts` (9) — **all present, all counts exact.** The instrument reads and
the premise holds.

## The finding that changed the shape of Task 1

**The plan and 18-03 both specify a withholding predicate that leaks.**

18-02 says the predicate's contract "has to match what `refuse` actually keys on"; 18-03 then
writes the predicate literally, at its line 202:

```ts
egress.registrations.includes(cid.toString())
```

That is keyed on a **label**. The `block` branch is keyed on a **payload**:
`refusedReason` (`agent.ts:305-316`) calls `egress.guard.refuse(to, encoded.bytes)`, which is
`violationIn` (`egress.ts:287-293`) — a contiguous-run search for any registered payload
inside the candidate frame. The two agree today only because two *independent* facts happen to
line up: `takeSovereignHold` (`sovereign-egress.ts:76`) uses the CID string as the label, **and**
registers exactly that CID's bytes. `EgressGuard.guard(label, payload)` is a public method taking
an arbitrary label for an arbitrary payload, so nothing guarantees either fact.

**This was planted, not reasoned about.** With the label-keyed predicate in place and a payload
registered under `'a label that is not a CID'`:

```
FAIL  agrees even when the registration was not labelled with its CID
AssertionError: expected [ Array(1) ] to strictly equal []
```

The node advertised, over the wire, a block whose bytes its own `block` branch refused to
serve in the same test — the exact side channel around a refusal that the owner ruling recorded
in `egress.ts` exists to prevent, obtained without ever asking for the bytes and without
anything appearing on the refusing node's manifest.

**Fix (Rule 2 — missing security-critical functionality).** `withholdingFrom` in
`packages/net/src/sovereign-egress.ts` builds the candidate reply the `block` branch would
build for that CID —
`encodeCanonical(encodeResponse({ kind: 'block', bytes }))` — and puts it to the same
`EgressGuard.violationIn`. Same bytes, same scan, same answer: **one question asked twice
rather than one question written down twice.** Its two short-circuits mirror `refusedReason`'s
own (no registrations ⇒ nothing withheld; a body that will not canonicalise ⇒ not a body this
node could send either), and `'holds-no-registrations'` maps to `'advertises-everything-it-holds'`,
which is the same case `refusedReason` answers `null` for.

`violationIn` is documented as a pure query that records nothing, which is what makes it safe
to ask on a lookup — a provider question is not a frame offered to the exit, and recording it
would make every provider lookup appear on the manifest as an attempted send.

**Where it lives, and why not in `agent.ts`.** `agent.ts` is claimed by 18-04 in wave 2;
`sovereign-egress.ts` is claimed by no plan in this phase and is only *read* by this one. It is
also the semantically right home — it already owns the relationship between a CID and a
registration, and it already states the local-only-store rule the predicate needs. `agent.ts`
imports `sovereign-egress.ts`, never the reverse, so the dependency direction is preserved.

**For 18-03:** use `withhold: withholdingFrom(egress)`. Do not write the label comparison the
plan gives; it is the defect above.

## Deviation from the plan's stated signature

`SelfRecordIndexOptions.withhold` is

```ts
((cid: CID) => boolean | Promise<boolean>) | 'advertises-everything-it-holds'
```

rather than the plan's `((cid: CID) => boolean) | …`. Deciding correctly needs the bytes, and
reading them is asynchronous. The widened type is a **superset**: every synchronous predicate
the plan or 18-03 writes still satisfies it, so nothing downstream is forced into a promise and
18-03's construction still typechecks. The stated absence is unchanged and is exercised rather
than merely spelled.

## Every reddening claim, planted and watched

Nothing below is restated from the plan. Each row is a mutation written into the source, run,
and reverted — reverted by editing the source back, never by `git checkout`.

| # | Mutation | Where | Reddened | Held |
|---|---|---|---|---|
| 1 | `providers` → `return [this.#nodeKey]` unconditionally | `core/discovery.ts` | answers-for-what-it-holds (+2 more) | ✅ |
| 2 | drop the `nodeKey` equality check in `recordsFor` | `core/discovery.ts` | not-a-directory | ✅ |
| 3 | `providers` → `[]` when `records === 'holds-no-records'` | `core/discovery.ts` | two-halves-independent, excluded-by-name | ✅ |
| 4 | delete the `withhold` consultation | `core/discovery.ts` | withheld-not-advertised, predicate-live | ✅ |
| 5a | resolve `withhold` to a constructor boolean | `core/discovery.ts` | predicate-live (+1) | ✅ |
| 5b | memoise the predicate's answer per CID | `core/discovery.ts` | predicate-live **only** | ✅ |
| 6 | restore `if (nodeKeys.length > 0) return nodeKeys` | `net/discovery.ts` | union, dedupe, dead-peer | ✅ |
| 7 | delete the `try/catch` in `#ask` | `net/discovery.ts` | dead-peer (`RpcFailure: unknown peer`) | ✅ |
| 8 | rewrite `recordsFor` to ask everyone | `net/discovery.ts` | counter read **2**, expected 1 | ✅ |
| 9 | concurrent issue → `for` loop with `await` inside | `net/discovery.ts` | concurrency (`min` read 1, expected 3) | ✅ |
| 10 | `withholdingFrom` → `registrations.includes(cid.toString())` | `sovereign-egress.ts` | the label-not-CID test | ✅ |
| 11 | return on the first non-empty answer (`Promise.any`) | `net/discovery.ts` | budget-cost (**0.16 ms** vs 300 ms), +4 | ✅ |

**All eleven reddened. None was found false.** Two are worth calling out:

- **5a and 5b are different defects and the plan names both.** 5a — resolving `withhold` into a
  boolean — is caught by *two* tests, so it does not isolate the per-lookup property. 5b — a
  per-CID memo, the realistic drift, since the class cannot reach inside a caller's closure —
  reddens **exactly one** test. Planting only 5a would have left the per-lookup claim
  under-measured.
- **6 and 9 are independent, which the run proves.** Under mutation 9 the union tests stayed
  green (a sequential loop still unions) and only the concurrency test failed; under mutation 6
  the concurrency test stayed green. Neither test is standing in for the other.

Task 1's RED was additionally taken the literal way: with no `SelfRecordIndex` in existence,
`8 failed | 18 passed` — the 18 being every pre-existing assertion in `core/discovery.test.ts`,
untouched. Task 2's RED read `4 failed | 5 passed`.

## The claim the plan asserted and this plan measured

The plan's class-doc instruction says the union "pays the slowest peer, and a dead peer costs
the full RPC budget on **every** lookup". That is a quantity, and this repository's own rule is
that a quantity describing runtime behaviour is measured before it is written down — *including
in a source comment*. So it was read rather than stated.

**Measuring it corrected it.** A peer that fails **fast** — an unknown peer id, a partitioned
link — costs **nothing**: `MemoryNetwork.route` throws synchronously and the transport rejects
before any budget is entered. Only **silence** is expensive. The plan's word was "unreachable";
the accurate word is "silent", and the doc now says so.

The measurement uses a peer that receives the frame and never answers, beside one that answers,
with the requestor's endpoint given its **own** budget of 300 ms — so the assertion compares
elapsed time against a number the test itself configured rather than against one nobody chose.
Reddened by mutation 11: **0.16 ms**.

The production default is `DEFAULT_RPC_TIMEOUT_MS = 30_000` (`rpc.ts:25`). That figure is now
cited in the class doc at the line it is actually on.

## Incorrect `file:line` citations in 18-02-PLAN.md

Every citation was re-derived against source before being relied on. **The plan is unusually
accurate** — one wrong entry out of twenty-two, against Phase 15's forty-one. Numbers below are
**pre-edit**, i.e. as of base commit `f3b0d8c`.

| Plan says | Actually | What it is |
|---|---|---|
| `net/src/rpc.ts:100-135` — *"`RpcFailure` and the timeout"* | `RpcFailure` is **`:47`**; `RpcError`'s `timeout`/`send-failed` arms **`:27-29`**; `DEFAULT_RPC_TIMEOUT_MS` **`:25`**; the timer that enforces it **`:188`** | `:100-135` is `RpcHandler` and the start of `RpcOptions` — the only part of the cited range that bears on the claim is `timeoutMs?: number` at `:134`. This is the same wrong citation `17-04-SUMMARY.md` already recorded for the same range. |

**Verified correct individually, each re-read rather than assumed:**
`core/src/discovery.ts:237-296` (`discoverExecutors`), `:137-142` (the port), `:251-256` (the
`no-records` arm), `:298-382` (`FallbackRecordIndex` + `MemoryRecordIndex`), `:1-46` (the module
comment), `:243` (the kernel's own dedupe-and-sort, inside the cited `:237-250`), `:260`
(`verifyCertificate`), `:362-368` (`MemoryRecordIndex.provide`, doc line included — 18-CONTEXT
cites `:363-368` for the method alone; both are right about different spans);
`net/src/discovery.ts:44-51` (the merge replaced), `:1-69` (the class and its doc), `:82`
(`DEFAULT_PROBE_TIMEOUT_MS`); `net/src/agent.ts:575-599` (the two branches), `:305-316`
(`refusedReason`), `:591-592` (the block branch's refusal), `:593-599` (the `providers` branch);
`net/src/protocol.ts:93` (the request kind), `:658-662` (where it is parsed);
`net/src/discovery.test.ts:157`; `fabric-node.ts:1106` (records built), `:1272-1274` (the
comment stating `providers` answers `[]`), `:1278` (the `index` hook);
`browser-node.ts:778-781` (records built), `:988` (the `index` hook).

The objective's claim that `MemoryRecordIndex.provide` has **zero callers outside test files**
is confirmed by the grep above, and `fabric-node.ts:1272-1274` does say so in its own comment,
verbatim.

## Deviations from Plan

### Auto-fixed

**1. [Rule 2 — missing security-critical functionality] The specified withholding predicate is a
side channel**

- **Found during:** Task 1, reading `egress.ts` and `sovereign-egress.ts` as `read_first` asks.
- **Issue:** measured above — label-keyed vs payload-keyed, planted and observed leaking.
- **Fix:** `withholdingFrom` in `packages/net/src/sovereign-egress.ts`, asking the `block`
  branch's own question; exported from `@o2/net`; asserted against a real `serveAgent` on both
  branches over the wire.
- **Files:** `packages/net/src/sovereign-egress.ts`, `packages/net/src/index.ts`,
  `packages/net/src/provider-merge.test.ts`
- **Commit:** `18c1a93`

**2. [Rule 1 — bug] The module header of `net/src/discovery.ts` described behaviour the code no
longer has**

- **Issue:** *"A failed request moves to the next one"* and *"ask peers, take the first useful
  answer"* were true of both halves and are now true of one. A doc that describes the old
  behaviour beside the new code is worse than no doc — the plan says exactly this about the
  class doc and does not extend it to the module header.
- **Fix:** the header now distinguishes the two halves and points at the class doc for why.
- **Commit:** `18c1a93`

### Departures from the plan's letter, each with its reason

**3. `withhold` accepts an asynchronous predicate.** Detailed above. A superset of the plan's
type; nothing downstream is broken by it.

**4. The union's cost is measured, not asserted, and the assertion is a tenth test.** The plan's
proof list for Task 2 has four claims. A fifth test was added because the plan instructs the doc
to state a quantity, and stating an unmeasured quantity in a source comment is what this
plan's own header forbids. Measuring it corrected the claim's wording.

**5. The `recordsFor` counter is taken over a purpose-built pair of nodes, not over the main
fixture.** The plan asks for "two peers both holding a record for the same key". Under D1 a
`SelfRecordIndex` serves only its own records, so the main fixture cannot produce that shape at
all. Two nodes each serving a `MemoryRecordIndex` with the same record published into it is the
real arrangement — `MemoryRecordIndex` is the existing implementation of "a node holding someone
else's published records" — and it makes "first answer" and "every answer" genuinely different
counts rather than the same one.

**6. One extra test beyond the behaviour list: a provider is heard from and then excluded by
name.** The plan's third behaviour says a node with no certificate still answers `providers`,
and gives the reason as `discoverExecutors` excluding it as `no-records` rather than nobody
hearing from it. That reason is a claim about a different function, so it is asserted through
`discoverExecutors` — `providers: 1`, `executors: []`, `excluded: ['no-records']`, and the
`detail` containing the node key. Mutation 3 reddens it.

**7. `FallbackRecordIndex` composition is asserted through both halves, not just `providers`.**
NET-06's symmetry is the property a third implementation of the port could break, so the chain
test reads `lastSource` in both states and both members.

**No existing assertion was weakened, altered or deleted.** `core/src/discovery.test.ts` keeps
all 18 of its prior tests; `net/src/discovery.test.ts` and `net/src/sovereign-execution.test.ts`
were not touched and both pass unchanged, which is the load-bearing check the plan names — their
fixtures publish every provider into one seed index, so a union over one peer is the same list
first-non-empty returned.

## Out-of-scope findings

**1. `tools/aot/lift.node.test.ts` is load-sensitive and failed three tests in one full-suite
run.** Not fixed, not in scope, and **not caused by this plan** — measured three ways: the file
imports only `./lift.ts` and Node builtins, so there is no path from it to `@o2/core` or
`@o2/net`; it passes in isolation (73 tests, 235 s); and it passes when run alongside every file
this plan touched. Two subsequent full-suite runs were green. The mechanism is visible in the
file: it writes shell-script `docker` stubs to a temp directory and waits on
`METADATA_BUDGET_MS = 20_000` per spawn, so process-spawn latency under a loaded parallel run is
enough to exhaust it. **What would fix it:** a budget derived from observed spawn cost, or
serialising that file. Recorded here rather than in `deferred-items.md` because no
`deferred-items.md` exists on this branch and creating one is 18-03's or a later plan's call.

**2. `RpcRecordIndex` still has no production caller.** Unchanged from 17-04's finding. Every
use is a `.test.ts`. Its first production caller is 18-05's.

**3. The `browser` project was not run, and that is not a gap.** No file this plan touched is a
`.node.test.ts`, so both new suites *are* in the browser project's scope in principle — but
`packages/core` and `packages/net` are the PORTABLE tier and `purity.node.test.ts` passed, which
is the structural guarantee that they contain nothing platform-specific. `provider-merge.test.ts`
uses only `MemoryNetwork`, `MemoryBlockstore` and pure crypto; it has no Node builtin and no
libp2p import.

## Known stubs

None. `SelfRecordIndex` reads a real store and answers a real question; `withholdingFrom` scans
real bytes against a real guard. There is no placeholder value, no hardcoded empty collection
that reaches a UI, and no component wired to mock data.

The one deliberate absence is that **nothing is wired yet** — neither node factory constructs a
`SelfRecordIndex`, so `providers` still answers `[]` from every running node. That is the plan's
own boundary (`Out of scope`: "Wiring either node factory — Plan 18-03"), stated so the two can
be reviewed apart, and it is why `requirements-completed` is empty: SCHED-01 is advanced by this
plan and closed by neither it nor 18-03 alone.

## Threat flags

None. No new wire frame, no new request kind, no new network endpoint, no auth path, no file
access pattern and no schema at a trust boundary. `providers` was already a request kind
(`protocol.ts:93`), already parsed (`:658-662`) and already served (`agent.ts:593-599`) — this
plan changed only *what a node computes as the answer* and *how many answers a requestor uses*.

The one security-relevant change is in the **restricting** direction: a node that previously
would have advertised nothing now advertises what it holds, **minus** anything its `block`
branch would refuse — and that subtraction is the whole of the `withholdingFrom` finding above.
No dependency was added; Helia and every IPFS package remain absent, as Phase 21 owns.

## Self-Check: PASSED

Files claimed created, listed off disk:

```
FOUND  packages/net/src/provider-merge.test.ts        617 lines
FOUND  packages/core/src/discovery.ts (modified)      506 lines
FOUND  packages/net/src/discovery.ts (modified)       203 lines
FOUND  packages/net/src/sovereign-egress.ts (mod)     148 lines
```

The plan's `must_haves.artifacts` requires `packages/core/src/discovery.ts` to contain
`class SelfRecordIndex` — present — and `packages/net/src/discovery.ts` to provide
`RpcRecordIndex.providers` merging across peers — present and measured.

Commits claimed, found in `git log --oneline --all`:

```
FOUND  20d3d89  test(18-02): measure the union's cost instead of asserting it
FOUND  18c1a93  feat(18-02): RpcRecordIndex.providers asks everyone, and agrees with the block branch
FOUND  0ec6423  feat(18-02): a node answers for what it holds, from its own store
```

No commit in this plan deleted a tracked file: `git diff --diff-filter=D --name-only HEAD~1 HEAD`
was run after each and returned empty every time. Nothing was staged with `git add -A`; every
path was staged explicitly.
