---
phase: phase-15-capability-chained-dispatch
plan: 05
subsystem: auth
tags: [capability-chain, auth-03, browser-tier, e2e, mutation-testing, gap-closure]

requires:
  - phase: phase-15-plan-01
    provides: "audienceKeyOf and authorizeCapability — the mechanism this plan measures in a browser"
  - phase: phase-15-plan-03
    provides: "the authorize hook on both factories, and capability-fixture.ts's chain shapes"
  - phase: phase-15-plan-04
    provides: "the source-text argument-equality check this plan complements rather than replaces"
  - phase: phase-13
    provides: "two-tabs.e2e.test.ts — the worked example that a tab's serveAgent handler is reachable from the e2e project"
provides:
  - "packages/node/src/browser-capability.e2e.test.ts — a live browser tab's authorize hook measured behaviourally: absent chain refused, expired chain refused by link index, valid chain accepted"
  - "packages/browser/src/capability-harness.ts — a test-only page-side harness that starts a real BrowserNode with a pinned owner key"
  - "mutation-ledger entry M30 — 15-03's scrambling, with a signature read off a real planted run"
  - "the corrected reason five shipped comments should have given: the browser project cannot host this, the e2e project can"
affects: [phase-17-enrollment, phase-19-browser-harness, phase-23-requestor-half]

tech-stack:
  added: []
  patterns:
    - "a browser node is dispatched to over a direct WebSocket the tab itself opened — no relay, because a relay signals between two browsers and there is only one"
    - "the browser tier reads an ordering claim off the node's own executor call count, which is strictly stronger than the blockstore-directory proxy the Node tier uses across a process boundary"
    - "a refusal is asserted by its text, never by ok:false, because a scrambled authorizer refuses too and only the wording moves"

key-files:
  created:
    - packages/node/src/browser-capability.e2e.test.ts
    - packages/browser/src/capability-harness.ts
    - packages/browser/harness/capability.html
  modified:
    - packages/node/src/mutation-ledger.ts
    - packages/browser/src/browser-node.ts
    - packages/browser/src/browser-node-contract.node.test.ts
    - packages/node/src/serve-agent-hooks.node.test.ts
    - packages/node/src/sovereign-block-refusal.node.test.ts
    - .planning/phases/phase-15-capability-chained-dispatch/deferred-items.md

key-decisions:
  - "The harness constructs BrowserNode directly rather than extending TabApi.start, because a tab pinned to nobody refuses at the first precedence step and that refusal is produced by a correct authorizer and a scrambled one alike"
  - "No relay in the topology — the tab dials the submitter's WebSocket listener, which is a direct data path; a relayed circuit is a signalling channel and may not carry a job"
  - "The harness module lives in packages/browser/src, not in the harness directory beside its page, because tsconfig includes only src and demo — a harness directory would escape tsc and the purity scan"
  - "M30's caughtBy names only the e2e file, though the 15-04 source-text check also fires: that check is source text and a defect planted identically in both factories would satisfy it"
  - "AUTH-03 is NOT ticked. The owner ruling of 2026-07-31 (ROADMAP.md:442-446) stands; this plan closes a verification gap, not a requirement"

patterns-established:
  - "Pattern 1: every negative reading is paired with its positive twin off the same instrument in the same it — three instruments, each observed taking both values"
  - "Pattern 2: a stale comment is corrected by naming the false claim, not by deleting it, so the next reader inherits the correction rather than re-deriving the error"

requirements-completed: []

duration: 35min
completed: 2026-07-31
---

# Phase 15 Plan 05: Browser-Tier Capability Gap Closure Summary

**A live browser tab's `authorize` hook is now measured behaviourally — three sovereign dispatches, refusals read as text rather than as `ok: false`, and the tab's own executor call count reading 0, 0, 1 — and 15-03's scrambling turns it red.**

## Performance

- **Duration:** ~35 min
- **Tasks:** 3 of 3
- **Files created:** 3
- **Files modified:** 6
- **Commits:** 4

## The gap, and why it survived four plans

Phase 15's verification scored 3/3 and returned `human_needed` on one item: the browser
factory's `authorize` wiring was unproven. 15-03 had planted a fully scrambled authorizer
in `browser-node.ts` — owner id and owner key transposed, `audience: 'deadbeef'`,
`now: () => 0` — and measured three readings: `tsc` exit 0, the substring count unchanged
at 1, and 345 browser tests green in three engines. The verifier re-planted it and
reproduced all three.

Every plan that looked at the hole recorded the same reason for leaving it: that
`BrowserNode.start` *"needs a real `indexedDB` and a relay to dial, so it runs in neither
vitest project."*

**That reason was false, and it is the reason the gap survived.** It is the error this
project makes most often — a constraint that is real about one thing restated as a
constraint about everything. The **`browser`** project genuinely cannot host such a test:
a Circuit Relay v2 server *"will not work in browsers"* in `@libp2p/circuit-relay-v2`'s
own words, and vitest's browser mode gives one page per file. The **`e2e`** project has
neither limit — it drives Playwright from Node, and `two-tabs.e2e.test.ts` has been
dispatching jobs into a tab's own `serveAgent` handler since Phase 13.

It turned out not to need a relay at all. A relay exists so two browsers can exchange
SDP; there is one browser here. The tab dials the submitter's WebSocket listener
directly, and the dispatch returns along the connection the tab itself opened —
`Libp2pTransport.send` dials by `PeerId` (`libp2p-transport.ts:339`), which resolves to
the open connection rather than to a new one.

## Task 1 — the behavioural cases

`packages/node/src/browser-capability.e2e.test.ts`, in the `e2e` project. A new file
rather than an extension of `two-tabs.e2e.test.ts`: that file's fixture is two tabs and a
relay, and this one needs one tab, no relay, and a submitter pinned to an owner. Sharing
the fixture would have meant a `beforeAll` serving two unrelated topologies.

`packages/browser/src/capability-harness.ts` starts the node. It constructs `BrowserNode`
directly rather than going through `window.o2`, because `TabApi.start` carries no
`sovereignty` option — a tab started through the demo is pinned to nobody and refuses
every sovereign task at `authorizeCapability`'s **first** precedence step, `no pinned
owner key`. That refusal is worth nothing as evidence: a correctly wired authorizer and a
scrambled one both produce it. The harness is not barrel-exported, following
`capability-fixture.ts`'s rule for Phase 22's reachability guard.

Three dispatches to one tab, refusals first and the acceptance last, so neither refusal
can be explained by a tab that had stopped serving:

| # | Chain | Outcome | Refusal text asserted |
|---|---|---|---|
| 1 | none | refused | `unauthorized:` + `no capability chain supplied`, and **not** `link ` |
| 2 | expired 1 s ago | refused | `unauthorized:` + `expired at` + `link 0` |
| 3 | valid, owner → this tab | **accepted** | — |

Printed by the run rather than quoted from a note:

```
[browser tier] tab executor calls — after absent: 0, after expired: 0, after accepted: 1
[browser tier] absent  -> unauthorized: no capability chain supplied
[browser tier] expired -> unauthorized: link 0 expired at 1785552755653, now 1785552756657
```

The expired reading is worth reading twice: `now` is a real current timestamp about a
second past `expiresAt`, produced inside the tab. That is the browser factory's clock
being live, which is one of the four things 15-03's mutation broke.

### Every negative reading has its positive twin

Three instruments, each observed taking both values **in the same `it`**:

| Instrument | Negative | Positive |
|---|---|---|
| the tab's executor call count | `0` after both refusals | `1` after the accepted dispatch |
| the tab's local IndexedDB store | module absent after both refusals | module present after the accepted one |
| the outcome returned to the submitter | the mechanism's own refusal text | `ok: true` |

**The acceptance case is the one that matters most**, and it is why this is not a file of
refusals: an authorizer that refuses everything — the exact shape of 15-03's defect —
passes any number of refusal assertions.

The executor call count is a stronger instrument than the Node tier gets. Across a
process boundary the count is unreachable and `capability-dispatch.node.test.ts` reads
the child's blockstore directory as a proxy. Here the tab is a live object in a page this
process drives, so `GovernedExecutor.executed` is readable directly, and `serveAgent`
reaches `executor.execute` only when the authorizer returned `null`
(`agent.ts:409-417`). Both instruments are asserted, because they fail independently.

**Not claimed:** nothing here observes `WebAssembly.instantiate`. No instrument inside a
page can. The counter is upstream of it, and the file says so rather than letting a
passing count stand in for the clause.

## Task 2 — the mutation, planted and watched

15-03's scrambling re-planted verbatim. Readings, all taken on this worktree:

| Reading | Result |
|---|---|
| `npx tsc --noEmit` | **exit 0** — the defect is type-correct, as before |
| `serve-agent-hooks.node.test.ts:182` argument equality | **RED** (15-04's check, still working) |
| **`browser-capability.e2e.test.ts`** | **RED** |

The new case went red, and *how* it went red is the point:

```
AssertionError: expected 'unauthorized: task names owner alice,…' to contain 'no capability chain supplied'

Expected: "no capability chain supplied"
Received: "unauthorized: task names owner alice, but this node is pinned to owner c86d01ad8b2fb694b22ff60e3c9d9e7ed90db5604772b74450d40913b9a9cbaf"
```

The mutated tab **still refuses**. It refuses at a different precedence step, naming the
owner *key* where the owner *id* belongs. Every assertion of the form "the job failed"
passes against it — which is exactly the trap 15-03 recorded and the reason this file
asserts refusal *text*. A `not.toContain('link ')` alone would also have passed.

Restored by `cp` from a baseline outside the working tree
(`~/.claude/gsd-scratch/15-05-base/`); `cmp` exit 0; `git status --short` clean. No
`git checkout`, `restore`, `stash`, `reset` or `clean` was used at any point.

### Ledger entry M30

Added with `project: 'e2e'` and a signature read off the real planted run
(`to contain 'no capability chain supplied'`), never predicted. Run through the actual
script rather than assumed:

```
$ npm run test:mutations -- --only=M30
  M30  packages/browser/src/browser-node.ts … caught (2.9s)
  M30  PASS  caught  2.9s  exit 1 with the recorded signature
  git status --porcelain is empty — the tree is as it was found.
```

**Caught on the first run** — the failure mode the prompt warned about (the last two
entries added to this ledger failed initially on a wrong `project`) did not recur.

`caughtBy` names only the e2e file although 15-04's argument check also fires. That check
is source text and a defect planted identically in both factories would satisfy it;
recording it as the catcher would overstate what the ledger guards.

## Task 3 — the stale comments

Corrected at **six** sites, not four. Each names the false claim rather than deleting it,
so the next reader inherits the correction:

| File | Line at HEAD | What it claimed |
|---|---|---|
| `packages/browser/src/browser-node.ts` | 186 | "No such test was ever written… `demo/main.ts` is the only construction site" |
| `packages/browser/src/browser-node.ts` | 579-602 | "**The browser tier's authorizer behaviour is unmeasured**… Nothing can deliver a frame to the handler this hook sits behind" |
| `packages/browser/src/browser-node-contract.node.test.ts` | 26 | "no Node-project test can reach this factory" |
| `packages/node/src/serve-agent-hooks.node.test.ts` | 107-125, 166-176 | "The browser tier's authorizer behaviour is unmeasured" + "no such dispatch exists" |
| `packages/node/src/serve-agent-hooks.node.test.ts` | 134-135 | SCHED-06 row: "runs in neither vitest project" |
| `packages/node/src/sovereign-block-refusal.node.test.ts` | 54 | "it runs in neither vitest project — WIRE-03, Phase 19" |
| `packages/node/src/mutation-ledger.ts` | 141 | M2b: "no behavioural test can reach it" |

No assertion was weakened. Two counts in `serve-agent-hooks.node.test.ts` scan
`browser-node.ts`'s **whole text including comments**, so the corrected comments
deliberately describe the factory call by name rather than writing it out — the trap that
file's own comment records tripping over on first draft. All seven of its assertions
still read what they read.

Where a claim is still true it is left standing and narrowed rather than removed: the
SCHED-06 admission bound genuinely has never been read on a tab, and `M2b` genuinely has
no behavioural catcher. Both now say *that*, instead of saying the factory is unreachable.

## Corrections — every `file:line` re-grepped

The prompt warned that plan and comment text in this phase was wrong 41 times across four
plans, and instructed re-grepping every citation including its own. **Three sources
disagreed with each other and all three were partly wrong.**

| Citation | Source | Verdict |
|---|---|---|
| stale comment at `browser-node.ts:179` | this prompt, `deferred-items.md` | **Wrong line.** The claim is at `:186`. |
| `browser-node.ts` "now records the retirement" at `:620` | `15-VERIFICATION.md:377` | **Half true.** `:619-620` retires it for the *SCHED-06* hook only. `:186` still carried it. |
| — | *no source named it* | **A sixth site, unnamed by every list:** the authorize hook's own comment at `:579-602`, asserting *"Nothing can deliver a frame to the handler this hook sits behind."* This is the comment sitting directly on the line under test. |
| `serve-agent-hooks.node.test.ts:~66` (SCHED-06 row) | this prompt | **Wrong line.** The SCHED-06 row is at `:133-137`; `:66` is the end of `authorizerArguments`. |
| `serve-agent-hooks.node.test.ts:135` | `15-VERIFICATION.md` | **Correct** (`:134-135`). |
| `mutation-ledger.ts:140` | this prompt, `deferred-items.md` | **Off by one.** The text is at `:141`. |
| `mutation-ledger.ts:141` | `15-VERIFICATION.md` | **Correct.** |
| "the four stale comments" | this prompt | **Five were listed across sources, six exist.** The prompt's four omitted `sovereign-block-refusal.node.test.ts`, which the verification did name. |
| `sovereign-block-refusal.node.test.ts:~46` | `deferred-items.md` | **Wrong line.** It is `:54`. |
| `browser-node-contract.node.test.ts:26` | all three sources | **Correct.** |
| `two-tabs.e2e.test.ts` refusal cases at `:316` and `:367` | this prompt | **Correct.** |
| `two-tabs.e2e.test.ts` relay at `:147-157`, tabs at `:190-214` | this prompt | **Correct.** |
| `capability.ts:56` for the absolute-expiry doc | `capability-dispatch.node.test.ts:458` | **Off by one** — it is `:57`. Noted in the new file rather than silently copied. |
| `browser-node.ts:419` for `audienceKeyOf` | 15-04 era, and my own first draft | **Shifted to `:423`** by this plan's own comment edits. Corrected before commit. |

Seeds re-grepped across every `fill(n)` / `keypair(n)` site: 0-4, 7, 9, 11, 12, 21-24, 30,
31, 40-42, 50-56, 60, 61, 80-82, 90-99, 111-113 taken. **57 chosen**, adjacent to
`capability-dispatch.node.test.ts`'s 56.

## Verification

Node resolver proven to read **this** worktree before anything was measured — the
worktree had no `node_modules`, and symlinking the main checkout's wholesale would have
pointed `@o2/*` back at the main tree:

```
@o2/core      WORKTREE   …/agent-a817476b28913a3a4/packages/core/src/index.ts
@o2/net       WORKTREE   …/agent-a817476b28913a3a4/packages/net/src/index.ts
@o2/browser   WORKTREE   …/agent-a817476b28913a3a4/packages/browser/src/index.ts
@o2/node      WORKTREE   …/agent-a817476b28913a3a4/packages/node/src/index.ts
   (+ demo, bench, aot, libp2p — all 8 resolve into this worktree)
vitest/playwright/libp2p/typescript → main checkout (third-party, intended)
```

| Check | Result |
|---|---|
| `npx tsc --noEmit` (baseline, under mutation, after restore, after edits) | **exit 0** every time |
| `npx vitest run --project e2e` (full) | **8 files, 40 passed** |
| `npx vitest run --project node` (full) | **90 files passed / 2 skipped, 1321 passed / 18 skipped** |
| `vocabulary` + `purity` + `disclosure-gate` (after committing) | 53 passed |
| `serve-agent-hooks` + `mutation-guard` + `browser-node-contract` | 64 passed |
| `npm run test:mutations -- --only=M30` | **caught**, tree clean |
| working tree | `git status --short` empty; `cmp` exit 0 on the guarded path |

The node count moved 1320 → **1321**: `mutation-guard.node.test.ts` runs one case per
ledger entry, and M30 is the new one. Nothing else changed count.

**Host state.** `uptime` reported 1-minute load averages of 3.81 at the start and 3.26
before the full node run, on this machine. Nothing in this plan is a wall-clock
measurement, and no timing bound was set or changed — the submitter inherits the
production 30,000 ms RPC default rather than narrowing it, so no bound here is a number
nobody measured.

## Deviations from Plan

**1. [Rule 2 — missing critical coverage] Six comment sites corrected, not four**

- **Found during:** Task 3
- **Issue:** The prompt named four sites; `15-VERIFICATION.md` named a different four;
  `deferred-items.md` named five. Re-grepping found six, including one no list named —
  the comment sitting *directly on the authorize hook*, asserting the behaviour was
  unmeasurable. Leaving that one would have left the single most misleading claim in place
  on the very line this plan proves.
- **Fix:** All six corrected. Full table above.
- **Commit:** `854e812`

**2. [Rule 1 — stale document] `deferred-items.md` section 1 marked closed**

- **Found during:** Task 3
- **Issue:** Not in the prompt's task list, but the section is the register of exactly
  this item and its line-number table is wrong in every row that other sources copied.
  Leaving it asserting five uncorrected comments would have made it false the moment
  Task 3 landed.
- **Fix:** Closure recorded, with the sharper reason and a pointer to this summary's
  corrections table.

**3. [Rule 3 — blocking] `node_modules` farm built before anything could be measured**

- **Found during:** setup
- **Issue:** The worktree had no `node_modules`. The obvious fix is silently wrong.
- **Fix:** Third-party symlinked from the main install; every `@o2/*` entry repointed at
  this worktree's `packages/*`; proved with `createRequire(...).resolve`. Outside the repo,
  so nothing was committed.

**4. [Rule 3 — blocking] The worktree was created off the wrong commit**

- **Found during:** startup
- **Issue:** HEAD was `c62bae5` (a `main` merge), not the Phase 15 tip. The prompt's
  startup check calls for a reset; before running it I confirmed `c62bae5` is reachable
  from `main` and `origin/main`, so nothing was destroyed.
- **Fix:** `git reset --hard 9f7bac3` per the sanctioned startup step, then verified.

## Known Stubs

None. The harness is test-only and fully wired; every case it drives runs a real node.

## Threat Flags

None. This plan adds no network endpoint, no auth path and no schema at a trust boundary.
It adds a test-only page that constructs an existing factory, and it is excluded from the
production bundle by construction: `packages/browser/vite.config.ts` roots its build at
`demo/`, and the harness page is deliberately outside it.

## What is still open

- **AUTH-03 remains open and is not ticked.** The owner ruling of 2026-07-31
  (`ROADMAP.md:442-446`) stands. This plan closed a verification gap, not a requirement.
  The requestor half is Phase 23 criterion 5.
- **The browser tier's SCHED-06 admission bound is still unmeasured** — nothing drives an
  over-committed dispatch through a tab. `M2b`'s guard is still structural. The comments
  now say this instead of saying the factory is unreachable, and the `e2e` project is
  where it would be closed.
- **The browser tier's *submitter* path is unproven.** This file dispatches *to* a browser
  node; nothing dispatches *from* one with a chain.
- **`capability-authorizer.ts:17-23`** — the shipped comment naming `registerSovereignInputs`,
  a function that exists nowhere in this repository. Flagged by the verification, out of
  this plan's scope, still shipped.
