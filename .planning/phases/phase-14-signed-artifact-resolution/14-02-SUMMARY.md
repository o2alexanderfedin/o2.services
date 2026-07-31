---
phase: phase-14-signed-artifact-resolution
plan: 02
subsystem: security
tags: [signed-names, wire-protocol, provenance, generated-artifact, ed25519]

# Dependency graph
requires:
  - phase: phase-14-plan-01
    provides: "Task.moduleRecord?: NameRecord, and guardModuleProvenance — the guard this plan builds three routes to, and does not re-implement"
  - phase: phase-4
    provides: "signName / SignedNameResolver / NameRecord — the record shape carried, and the resolver every round trip is re-verified against"
  - phase: phase-15-groundwork
    provides: "capability?: readonly Delegation[] on the exec frame — the encode/parse pair moduleRecord mirrors exactly"
provides:
  - "moduleRecord on the exec wire frame — nameRecordToValue / parseNameRecord, and a malformed one refusing the whole frame"
  - "JobSpec.moduleRecord — copied onto every Task submitJob builds, sovereign and public alike"
  - "KERNEL_NAME / KERNEL_RECORD / KERNEL_TRUST_ANCHOR exported from @o2/demo"
  - "npm run sign:kernel --workspace @o2/demo — the generator, build-time only"
  - "The .wat -> .wasm -> record chain closed end to end by tests, drift detector proved able to fail"
affects: [phase-14-plan-03, phase-14-plan-04, phase-14-plan-05]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "A wire round-trip for a signed value ends in re-verification against the anchor, not in field comparison — a signature covers exact bytes, so re-verification catches a widened number or a rebuilt CID that toEqual would pass"
    - "Malformation cases are named for the field each corrupts, so a parser that validated five of six fails with the forgotten field in the test name"
    - "An optional field spread from a fragment built once, never assigned inline, so exactOptionalPropertyTypes never sees an explicit undefined"
    - "A generated source file emits single quotes through a helper that refuses characters needing escape, rather than JSON.stringify"

key-files:
  created:
    - packages/net/src/protocol.test.ts
    - packages/demo/scripts/sign-kernel.ts
    - packages/demo/src/kernel-record.ts
  modified:
    - packages/net/src/protocol.ts
    - packages/core/src/job/submit.ts
    - packages/core/src/job/submit.test.ts
    - packages/demo/src/index.ts
    - packages/demo/src/kernel-build.node.test.ts
    - packages/demo/package.json

key-decisions:
  - "A present-but-malformed moduleRecord refuses the whole exec frame rather than being dropped — dropping would convert 'this frame is corrupt' into 'this task arrived unsigned', and guardModuleProvenance would then refuse it as no-record, naming a problem the dispatcher does not have"
  - "version goes through asIndex, not asFiniteNumber — a negative version is one no monotonic check can order, so it would slip past the resolver's rollback protection"
  - "JobSpec.moduleRecord is optional and deliberately unenforced: submitJob runs in the requestor's own process, so a check there would sit on the attacker's side of the wire; the doc names guardModuleProvenance and the cost of omission instead"
  - "The demo signing key is generated per run and its private half discarded — regenerating means a new key, anchor and record committed together, and the default anchor can therefore accept exactly the one record committed"
  - "The record's CID is computed through MemoryBlockstore.put, not a hand-rolled sha256 + CID.create, because that is the path demo/main.ts's store.put(kernelBytes) takes and the only form that cannot drift from it"
  - "Tests for protocol.ts went into a new packages/net/src/protocol.test.ts rather than beside the capability tests in distributed.test.ts — the plan named the file in two places and its own verify command runs it"

patterns-established:
  - "Re-verification as the round-trip assertion: expect(new SignedNameResolver([pub]).accept(parsed.task.moduleRecord!, NOW).ok).toBe(true)"
  - "A control test beside the malformation block, so 'refuses everything' cannot masquerade as 'refuses the malformed'"
  - "An expiry assertion whose failure message names the command that renews it, because a test that starts failing in two months is only useful if it says what to do"

requirements-completed: [DET-03, DATA-08]

# Metrics
duration: 21min
completed: 2026-07-31
---

# Phase 14 Plan 02: Carriage, and the Demo's Own Record Summary

**A `NameRecord` now reaches `guardModuleProvenance` by all three routes it needs — across the wire with re-verification proving no field was lost, onto every `Task` `submitJob` builds on both the sovereign and public branches, and as a committed signed artifact for `@o2/demo`'s own kernel whose CID is recomputed from the binary on disk rather than asserted.**

## Performance

- **Duration:** 21 min
- **Started:** 2026-07-31T13:37:00Z
- **Completed:** 2026-07-31T13:58:00Z
- **Tasks:** 3
- **Files modified:** 9 (3 created, 6 modified)

## Accomplishments

### 1. The wire (`packages/net/src/protocol.ts`)

`nameRecordToValue` and `parseNameRecord` sit beside their delegation twins and mirror
them exactly: all six fields listed explicitly in a fixed order on the way out, all six
validated on the way in, `null` on any failure.

Two decisions are load-bearing and are written into the code, not only here.

**A malformed record refuses the whole frame.** The tempting alternative — drop the
record, admit the task — is the dangerous one. It converts *"this frame is corrupt"*
into *"this task arrived unsigned"*, and `guardModuleProvenance` would then refuse it
as `no-record`, naming a problem the dispatcher does not have and hiding the one it
does. Absent and malformed are different answers, and `parseRequest` is the only line
in a position to tell them apart.

**`version` goes through `asIndex`, not `asFiniteNumber`.** A negative version is one
no monotonic check can order, so a record offering `-1` would slip past
`SignedNameResolver`'s rollback protection rather than being ranked below what the node
already holds.

The record is decoded *before* the task literal is built and spread into both arms, so
`exactOptionalPropertyTypes` never sees an explicit `undefined` — which `encodeRequest`
would otherwise put on the wire as a present-but-empty key.

### 2. In-process submission (`packages/core/src/job/submit.ts`)

`JobSpec.moduleRecord`, copied onto every `Task` from a fragment built once and spread
into both branches of the two-arm literal. That literal is the exact place a field gets
added to one arm and forgotten on the other, so both are asserted separately.

The field is optional and **deliberately unenforced here**, against the project's
standing rule that an optional field with a silent default is a hole. The reason is in
the doc: `submitJob` runs in the *requestor's own process*. A requestor that omits the
record is not attacking anybody — it is about to have its job refused by every node it
dispatches to. Enforcing at that line would put the check on the side of the wire the
attacker sits on, which is precisely the mistake `guardSovereignty`'s docstring exists
to name. The doc names `executor/module-provenance.ts` as the enforcement point and
states what omission costs, so nobody reads optional as harmless.

### 3. The demo's artifact (`packages/demo/`)

`scripts/sign-kernel.ts` generates a key, computes the CID through
`MemoryBlockstore.put` over `kernelBytes`, signs a 400-day record, writes
`src/kernel-record.ts`, and discards the private half. `npm run sign:kernel --workspace
@o2/demo` runs it; Node's type stripping runs the `.ts` directly with no loader, as
`bin/agent.ts` already relies on.

The key-handling decision is stated in full in both the script's header and the
generated file's, because it is the one place this phase's guarantee is weaker than it
sounds:

> The anchor and the artifact it vouches for ship in the same bundle. What that buys: a
> peer in the demo fabric cannot make a tab run a module this repository did not ship,
> because it cannot forge a record the pinned anchor accepts. What it does not buy: it
> proves nothing to anyone who does not already trust this repository, because the
> anchor and the artifact have exactly one origin.

The generated file's header also records the reach a regenerator needs to see before
running the script — that Plan 14-03 gives both `bin/agent.ts` and `bin/seed.ts` the
same `values['trust-anchor'] ?? [KERNEL_TRUST_ANCHOR]` default, so regenerating changes
what a stock `o2 agent` and a stock `o2 seed` will run.

## The chain, closed

`kernel-build.node.test.ts` already proved `.wat` → `.wasm` → `kernel-bytes.ts`. It now
proves the last link too, against `committed` — the bytes read off disk, not another
derived copy:

| Link | Checked by |
|---|---|
| `kernel.wat` → `kernel.wasm` | recompile, compare byte-for-byte (pre-existing) |
| `kernel.wasm` → `kernel-bytes.ts` | base64 mirror compared to `committed` (pre-existing) |
| `kernel.wasm` → `KERNEL_RECORD.cid` | `MemoryBlockstore().put(committed)` recomputed and compared |
| `KERNEL_RECORD` → `KERNEL_TRUST_ANCHOR` | a real `SignedNameResolver` accepts it |
| the anchor is not a rubber stamp | a resolver on another key refuses with `untrusted-signer` |
| the anchor matches the signer | `KERNEL_TRUST_ANCHOR === KERNEL_RECORD.signer` |
| the record has not quietly lapsed | more than 60 days remaining |

No link is taken on faith. That is what makes this the drift detector for the phase.

## Verification

Every claim below was run, not assumed.

### The resolver reads *this* worktree

The worktree ships no `node_modules`, and the inherited warning from 14-01 was that
symlinking the main install wholesale runs fine while silently type-checking and
testing the **main checkout's** sources. A farm was built instead: every third-party
package linked from the main install, every `@o2/*` entry repointed at this worktree's
`packages/*`. Proved rather than assumed, two ways:

- `createRequire(...).resolve('@o2/core/package.json')` reports
  `.claude/worktrees/agent-af2f814e62c8ea7ad/node_modules/@o2/core/package.json`.
- Every RED run below failed against this worktree's unmodified sources and passed only
  after this worktree's sources were edited. A RED run that does not fail is not
  evidence of anything, so each was watched.

### Each test watched failing first

| Task | RED evidence | GREEN |
|---|---|---|
| 1 — the wire | 40 failed / 4 passed (44) across the node + 3 browser projects | 44 passed |
| 2 — `JobSpec` | 8 failed / 112 passed (120) — the two "record reaches the task" cases, ×4 projects | 188 passed (`packages/core/src/job`) |
| 3 — the artifact | suite failed to load: `Cannot find module './kernel-record.ts'` | 8 passed |

### The drift detector proved able to fail

Flipping the final character of the committed CID literal in `kernel-record.ts` failed
**two** assertions, not one:

```
× names the CID a blockstore computes for the binary on disk
× verifies against the committed trust anchor
```

The second is the interesting one — the CID is one of the five fields `payloadOf`
signs, so a record whose CID was edited no longer verifies at all. The mutation was
reverted by file copy and the suite re-run clean; `git status` confirms no `.bak`
survived.

### Repository-wide

| Check | Result |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| `npx vitest run packages/net packages/core packages/demo` | 172 files, **2363 tests, 0 failures** |
| `npx vitest run packages/node/src/purity.node.test.ts` | 14 passed — `@o2/demo` still platform-free with the generated record in it |
| `npx vitest run packages/node/src/vocabulary.node.test.ts` | 24 passed, run **after** committing since it scans `git ls-files` |
| Pre-existing tests in `submit.test.ts` edited | **zero** — `git diff` reports 101 insertions, 0 deletions |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `packages/net/src/protocol.test.ts` did not exist**

- **Found during:** Task 1
- **Issue:** The plan directed the new tests "in a describe block beside the existing
  `capability` tests" in `packages/net/src/protocol.test.ts`. That file does not exist.
  The `capability` round-trip and malformation tests actually live in
  `packages/net/src/distributed.test.ts:606-653`, inside a two-node-fabric describe.
- **Fix:** Created `packages/net/src/protocol.test.ts` as a new dedicated unit-test file
  for `protocol.ts`. Chosen over appending to `distributed.test.ts` because the plan
  names `protocol.test.ts` in both its `<files>` list and its `files_modified`
  frontmatter, and because its own verify command is `npx vitest run
  packages/net/src/protocol.test.ts` — which would have run a nonexistent file. The new
  file also matches its subject: these are pure encode/parse round-trips, and
  `distributed.test.ts` is about a fabric with executors and blockstores.
- **Files modified:** `packages/net/src/protocol.test.ts` (created)
- **Commit:** `de7bf6f`

**2. [Rule 1 - Bug] Dead code in the first draft of `sign-kernel.ts`**

- **Found during:** Task 3, self-review before running the generator
- **Issue:** The first draft ended with an `if` whose condition compared `record.signer`
  against `toHex(...subarray(0, 0))` and whose body was a comment. It asserted nothing,
  could never fire meaningfully, and imported `toHex` solely to exist.
- **Fix:** Deleted the block and the now-unused import. The real check is
  `kernel-build.node.test.ts`'s `KERNEL_TRUST_ANCHOR === KERNEL_RECORD.signer`, which
  runs on every suite rather than once at generation.
- **Files modified:** `packages/demo/scripts/sign-kernel.ts`
- **Commit:** `80fc7bd`

**3. [Rule 2 - Missing critical functionality] The generator emitted double-quoted strings**

- **Found during:** Task 3, reading the first generated output
- **Issue:** `JSON.stringify` was used for every emitted literal, producing
  double-quoted source in a repository that is single-quoted throughout — a permanent
  foreign patch in every future diff of a file meant to be *read* in diffs.
- **Fix:** A `quoted()` helper that emits single quotes and **throws** on any character
  outside `[A-Za-z0-9._-]`. Written as a check rather than a comment claiming
  escape-safety, because a generator that emits source is one unusual character away
  from writing a file that does not parse. The record was regenerated through it.
- **Files modified:** `packages/demo/scripts/sign-kernel.ts`,
  `packages/demo/src/kernel-record.ts`
- **Commit:** `80fc7bd`

### Out of scope, logged not fixed

`packages/net/src/churn.test.ts`'s "completes every shard with 30% of the fabric
killed" failed once during full-suite verification and passed on every subsequent run.
Logged to `deferred-items.md` with the measurements that place it outside this plan:
host load was 17.5–59.4 on 8 cores at the time, the test passed 3/3 in isolation and in
the immediate full-suite re-run, and it contains zero references to `moduleRecord` — so
`parseRequest`'s new block, which is skipped entirely when the key is absent, never
executes for it. Not fixed, per the scope boundary rule.

## Threat Flags

None. This plan adds no network endpoint, no auth path, no file access pattern and no
schema at a trust boundary that the phase's threat model does not already cover. The
one new *input* surface — `moduleRecord` on the exec frame — is validated field by
field before any consumer sees it, and refuses the whole frame on any malformation,
which is the disposition the register assigns to wire-carried security inputs.

## Known Stubs

None. Every export this plan adds is wired and exercised: `moduleRecord` round-trips
under test on the wire, `JobSpec.moduleRecord` is read by `submitJob` and observed off
a recording executor, and `KERNEL_RECORD` / `KERNEL_TRUST_ANCHOR` are checked against
the committed binary by a real resolver.

Nothing yet *requires* any of it — `guardModuleProvenance` is not composed into any
production node until Plan 14-03 (`fabric-node.ts`, `bin/agent.ts`, `bin/seed.ts`) and
Plan 14-04 (`browser-node.ts`). That is the plan's stated boundary, not an omission:
after this plan a record *can* be attached, sent, received and read; after 14-03 and
14-04 it *must* be.

## Commits

| Commit | Task | What |
|---|---|---|
| `de7bf6f` | 1 | `moduleRecord` on the wire — encode, parse, and a malformed one refusing the frame |
| `5b12347` | 2 | `JobSpec.moduleRecord` reaching both branches of the task literal |
| `80fc7bd` | 3 | `sign-kernel.ts`, the committed `kernel-record.ts`, and the checks against the binary |

## Notes for the next plan

- **Plan 14-03 can now import its default anchor.** `KERNEL_TRUST_ANCHOR` is exported
  from `@o2/demo` and is what `bin/agent.ts` and `bin/seed.ts` are specified to fall
  back to. `KERNEL_NAME` and `KERNEL_RECORD` come with it.
- **The record's name is `o2-demo-colouring-kernel`.** Any node dispatching the demo
  kernel must attach `KERNEL_RECORD`, not construct its own.
- **`packages/demo` has a second npm script now**: `sign:kernel` beside `build:kernel`.
  Anything that regenerates `kernel.wasm` must re-run `sign:kernel` too, or
  `kernel-build.node.test.ts` fails on the CID assertion — which is the intended
  coupling and the reason that assertion exists.
- **The 60-day expiry check will eventually fire on its own.** Its failure message names
  `npm run sign:kernel --workspace @o2/demo` and warns that regenerating changes the
  anchor. That is by design; it is not a flake.

## Self-Check: PASSED

All 9 source files, `deferred-items.md` and this SUMMARY exist on disk. All three
commit hashes (`de7bf6f`, `5b12347`, `80fc7bd`) resolve in `git log`. `STATE.md` and
`ROADMAP.md` were not touched — the orchestrator owns those writes.
