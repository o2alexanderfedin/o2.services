---
phase: phase-16-decomposable-tree-reduce-wiring
plan: 01
subsystem: reduce
tags: [reduce, protocol, wire, combine, MR-03, MR-06]
requires: []
provides:
  - "@o2/core: fabricCombiner, asFabricPartial, FabricPartial, MAX_COMBINE_INPUTS"
  - "@o2/net: AgentRequest['combine'] and AgentResponse['combine'], encoded and parsed"
  - "packages/net/src/agent.ts: one narrowing branch answering the null arm (16-02 replaces it)"
affects:
  - packages/core/src/reduce.ts
  - packages/core/src/index.ts
  - packages/core/src/reduce.test.ts
  - packages/net/src/protocol.ts
  - packages/net/src/agent.ts
  - packages/net/src/combine-wire.test.ts
tech-stack:
  added: []
  patterns:
    - "bound at the parser, not the handler — a frame over the bound does not become a request"
    - "one predicate, two dispositions (wire: contribute zero; requestor: named failure)"
key-files:
  created:
    - packages/net/src/combine-wire.test.ts
  modified:
    - packages/core/src/reduce.ts
    - packages/core/src/index.ts
    - packages/core/src/reduce.test.ts
    - packages/net/src/protocol.ts
    - packages/net/src/agent.ts
decisions:
  - "The sorted-key rebuild in fabricCombiner is NOT what makes the CID order-independent — @ipld/dag-cbor sorts map keys at encode time. The plan claimed it was load-bearing; the comment now states the measured truth."
  - "NET-08 has landed. The plan directed a source comment saying it had not; that comment was rewritten rather than shipped."
  - "MAX_COMBINE_INPUTS = 64, a configuration choice. Documented as bounding the number of inputs merged, never bytes transferred or resident."
metrics:
  duration: ~25 min
  completed: 2026-07-31
  tasks: 2
  commits: 3
---

# Phase 16 Plan 01: The Combine Function and the Frame That Names One — Summary

Gave the fabric one combine function with a home in `@o2/core` and one wire frame that
can name *k* inputs by address, each proven in isolation, so Plan 16-02 has contracts to
build a handler against rather than shapes to invent.

## What changed

**Task 1 — `fabricCombiner` promoted into production** (`9dc9847`)

Every combine this repository had ever run was merged by a function defined inside
`reduce.test.ts` and never seen by production code. The two single-node reference
comparisons — the tests that make associativity an enforced contract rather than a
stated intention — therefore measured the tree against a private copy of a function the
fabric does not ship. `fabricCombiner`, `asFabricPartial`, `FabricPartial` and
`MAX_COMBINE_INPUTS` now live in `@o2/core`; the test file defines no combiner at file
scope and imports the production one instead.

`asFabricPartial` is one exported predicate with two deliberately different dispositions,
documented so neither is later "corrected" into the other: on the wire a `null`
contributes zero (bytes from a peer must not abort a combine every other contributor
answered honestly), at the requestor the same `null` must be a named failure (the value
was authored locally, so a diagnosis is possible).

The `describe('associativity …')` block is untouched and holds its own `largestWins` and
`subtract` by design — a falsification of the production function *by* the production
function cannot exist.

**Task 2 — the eighth request kind** (`55069fa`)

`exec` carries a `Task` and a `Task` has exactly one `inputCid`; a combine has *k*. The
new `combine` request names its inputs by CID and carries no payload, which is what lets
it go to a node that has never seen a partial. Bounded at the parser rather than the
handler, which is the disposition `parseRequest` already gives a partition index outside
its own count.

`agent.ts` gained **exactly one** narrowing branch and nothing else — no `AgentOptions`
field, no block read. Verified: `grep -c 'readonly combine' packages/net/src/agent.ts`
is `0`, and `git diff --stat` shows 9 insertions, 0 deletions.

## For Plan 16-02: what changed in `packages/net/src/agent.ts`

One `else if` inserted immediately before the final bare `} else {` (which is at
`agent.ts:327` in the pre-edit file, not `:201` as the plan said):

```ts
} else if (request.kind === 'combine') {
  response = { kind: 'combine', resultCid: null, reason: 'combine not implemented in this build' }
}
```

Plus a seven-line comment above it explaining it is a type-system placeholder. **Nothing
else in the file was touched.** 16-02 should replace the branch body and delete the
`describe('MR-06 — the eighth kind does not fall through to the exec branch')` block at
the end of `combine-wire.test.ts` in the same edit.

The branch is load-bearing, not defensive, and that was captured rather than asserted:
with the union extended and before the branch existed, `npx tsc --noEmit` produced six
errors of the form `Property 'task' does not exist on type … { kind: "combine" … }` at
`agent.ts` lines 350 (×2), 385, 406, 407 and 417.

## Two plan claims that were wrong, and were corrected rather than shipped

These are the reason to read this section before 16-02, 16-03 and 16-04.

**1. "The sorted-key rebuild … is what makes the encoding, and therefore the CID,
independent of the order inputs arrived in." False.** The plan instructed that this
comment be kept as load-bearing. It was tested: deleting the `.sort()` leaves **all 28
tests in `reduce.test.ts` green**. `@ipld/dag-cbor` sorts map keys itself at encode time
— measured directly, `encode({x,z,y})` and `encode({y,x,z})` are byte-equal. The line was
kept (it gives a stable in-memory iteration order for any reader that does not encode
first) but its comment now states the measured truth and records the evidence.

**2. "NET-08 … is Phase 13.1 and has not landed", "`rpc.ts` declares a timeout and no
size bound at all … There is no wire byte ceiling underneath." False.** The plan directed
this into the doc comment of a new production constant. NET-08 **has** landed:
`MAX_INBOUND_MESSAGE_BYTES = 8_388_608` (8 MiB) in `packages/libp2p/src/constants.ts:118`
bounds any single inbound message, with a per-peer concurrent-accumulation cap beside it,
and `transport-bounds.node.test.ts` proves the shipped value is the enforced one. Writing
the plan's text would have shipped a false security claim into source. `MAX_COMBINE_INPUTS`'
doc now says what is true: NET-08 bounds *one message*; this constant bounds *how many* a
single frame may provoke. No product of the two is written, per the plan's own correct
instruction that an unmeasured residency figure is not a guarantee.

## Citation drift table

Every `file:line` in the plan was re-grepped. The structural claims held; the line
numbers almost all did not.

| Plan citation | Claim | Actual | Verdict |
|---|---|---|---|
| `deriveReduceTree(partialCids: readonly CID[], …)` | signature | `deriveReduceTree(contributions: readonly ReduceContribution[], …)` | **WRONG** — tree derives from `(contributorId, cid)` contributions, not bare CIDs. Phase-15 change the plan predates. |
| `npx tsc --noEmit -p packages/core` | verify command | no `packages/core/tsconfig.json` exists; errors `TS5081` | **WRONG** — command cannot run. Used root `npx tsc --noEmit`. |
| "NET-08 … has not landed" | | landed; `libp2p/src/constants.ts:118` | **WRONG** (see above) |
| "sorted-key rebuild is load-bearing" | | dag-cbor sorts at encode time | **WRONG** (see above) |
| `reduce.test.ts:178`, `:364` | reference comparisons | `:268`, `:454` | drifted |
| `reduce.test.ts:183`, `:367` | the `toBe(reference…)` assertions | `:273`, `:457` | drifted |
| `reduce.test.ts:22-39` | local `const combiner` | `:23-40` | drifted |
| `reduce.test.ts:428-498` | `describe('associativity …')` | `:518-589` | drifted |
| `reduce.test.ts:437`, `:472` | `largestWins`, `subtract` | `:527`, `:562` | drifted |
| `reduce.test.ts:210-231` | "the property a payload-carrying combine would destroy" | `:216` is the rendezvous `describe`; no such test there | wrong reference |
| `reduce.ts:116-120` | lone-child promotion | `:185-190` | drifted |
| `reduce.ts:305-307` | `executeReduce` disagreement | pushed at `:375-377`; field doc `:271-277` | drifted |
| `executeReduce:273-277` | the ranking fallthrough walk | `:341-349` | drifted |
| `reduce.ts:8-12` | "derived, never agreed" | `:8-12` | **correct** |
| `index.ts:204-222` | reduce export block | `:223-242` | drifted |
| `protocol.ts:396-398` | partition-index refusal | `:496` | drifted |
| `protocol.ts:414-416` | `ownerId` refusal | `:532` | drifted |
| `agent.ts:159-254` | `serveAgent` handler chain | `serveAgent` starts `:231` | drifted |
| `agent.ts:201` | the bare `} else {` | `:327` | drifted |
| `agent.ts:219/:224/:234` | `request.task` | `:350` (×2), `:385`, `:406`, `:417` — five sites, not three | drifted |
| `agent.ts:220` | `request.capability` | `:407` | drifted |
| `tsconfig.json:5` | `"strict": true` | `:7` | drifted |
| `block.ts:110-121` | fetch, hash-verify, write-local | `#fetchAndVerify` at `:108-123` | drifted; claim **true** |
| `distributed.test.ts:495-510` | CID round-trip idiom | `:502-506` | drifted |
| `executor/wasm.ts:37` | `MAX_PARTITIONS = 0xffff` sibling | `:37` | **correct** |
| `rpc.ts:23` | timeout declaration | `DEFAULT_RPC_TIMEOUT_MS` at `:25` | drifted |
| "four errors" (second RED) | | six | minor |

## How each new test was proven able to fail

Every assertion was watched failing before it was allowed to pass. Mutations were planted
and restored with `cp` from a scratch baseline, confirmed byte-identical with `cmp` —
never `git checkout`/`restore`/`clean`, because this working tree is shared.

| Claim | Mutation | Result |
|---|---|---|
| the symbols exist at all (RED) | none — ran before writing them | `TS2305: no exported member 'fabricCombiner'` + 10 runtime failures |
| combiner is total over malformed input | `if (partial === null) continue` → no-op | 2 tests red |
| `asFabricPartial` agrees with the combiner | dropped the `rows` type check | 2 tests red |
| merge is order-independent | made the merge subtract on repeat keys | 6 tests red, **including both single-node reference comparisons** |
| `MAX_COMBINE_INPUTS` ≥ `DEFAULT_FANOUT` | set it to `2` | 1 test red |
| combine is not assignable to `AgentRequest` (RED) | none — ran before extending the union | `TS2345` / `TS2322` on `"combine"` |
| the narrowing branch is necessary (RED) | none — ran before adding it | 6 × `TS2339 Property 'task' does not exist` |
| element ceiling is an inequality | removed the `> MAX_COMBINE_INPUTS` half | 1 test red |
| floor of two | removed the `< 2` half | 1 test red |
| a corrupt reply is refused, not degraded | returned the null arm instead of `null` | 1 test red — the plan's point exactly: degrading passes a weaker test and fails this one |

The four-key `Object.keys` guard has no falsifying deletion, and that is correct for a
shape guard: it fires on *addition*, which is the direction a payload arrives from.

## Verification

Run against a resolver **proven** to read this worktree, not the main checkout. The
worktree had no `node_modules`, and the obvious fix is silently wrong — the main
install's `@o2/*` entries are *relative* symlinks (`@o2/core -> ../../packages/core`) that
resolve back to the main checkout. A farm was built instead: third-party absolute-symlinked
from the main install, every `@o2/*` repointed at this worktree. Proof:

```
@o2/core   → …/agent-a2bc3002858b41475/packages/core/src/index.ts
@o2/net    → …/agent-a2bc3002858b41475/packages/net/src/index.ts
multiformats → /Volumes/ProjectsSSD/Projects/o2.services/node_modules/…
```

| Gate | Result |
|---|---|
| `npx tsc --noEmit` (whole repository) | exit 0 |
| `vitest run --project node packages/core` | 375 passed (24 files) |
| `vitest run --project node packages/net` | 189 passed (19 files) |
| `vitest run --project node packages/net/src/combine-wire.test.ts` | 8 passed |
| `vitest run --project node packages/core/src/reduce.test.ts` | 28 passed (23 pre-existing + 5 new) |
| `vocabulary.node.test.ts` + `purity.node.test.ts` (run **after** commit) | 38 passed |
| `O2_UNIT_ONLY=1 vitest run --project node` (full) | 1187 passed, 18 skipped, **0 failed** |

`distributed.test.ts` is unaffected, as required. No existing assertion was weakened; the
only change to pre-existing tests was the mechanical `combiner` → `fabricCombiner` rename,
and all 23 previously-existing tests in that file pass with no other edit — which is the
plan's own stated check that the promoted function is the one they were written against.

## Deviations from Plan

### Auto-fixed

**1. [Rule 1 — Bug] The plan's `<verify>` command cannot run.** `npx tsc --noEmit -p
packages/core` fails with `TS5081`: no `packages/core/tsconfig.json` exists. Used the root
`npx tsc --noEmit`, which is the stronger gate anyway (whole repository).

**2. [Rule 2 — Correctness] Refused to write two false claims into production source.**
Both detailed above (the `.sort()` claim and the NET-08 claim). Each was replaced with the
measured truth plus the evidence. This is the plan's own standing rule — "any quantity
describing runtime behaviour must be measured before it is written down anywhere,
including in a source comment" — applied to the plan's own text.

**3. [Rule 3 — Blocking] Worktree had no `node_modules` and was created off the wrong
base.** The worktree HEAD was `main` (`c62bae5`); the plan expects `develop`/phase-16 tip
(`64e363e`, Phase 15's merge). Working tree was clean, so the startup-sanctioned
`git reset --hard` lost nothing. Dependency farm built as described above.

### Not deviations, but worth stating

- `asFabricPartial` is **stricter** than the deleted test-local combiner: the old one
  skipped individual non-number count values and still contributed `rows`, whereas
  `asFabricPartial` rejects the whole partial. For every existing fixture (`partialFor`)
  the two are identical, which is why all 23 pre-existing tests pass unchanged. The
  stricter reading is what makes the wire/requestor disposition split coherent — a
  half-valid partial is not a partial.
- `MAX_PARTIAL_BYTES` still has no production reader, as the plan intends. It gains one in
  16-02's handler.

## Known Stubs

| Stub | File | Reason |
|---|---|---|
| `combine` answers `{resultCid: null, reason: 'combine not implemented in this build'}` | `packages/net/src/agent.ts` (branch before the final `else`) | **Intentional and named in the plan's `## Out of scope`.** It exists for a type-system reason: without it the eighth union member reaches the exec branch's `request.task` and the repository does not type-check. Plan 16-02 replaces the branch wholesale. Its behaviour is asserted by test, so it is a stated behaviour rather than an unobserved stub. |

## Threat Flags

| Flag | File | Description |
|---|---|---|
| threat_flag: unauthenticated-fetch-amplification | `packages/net/src/protocol.ts` | A `combine` frame is a new surface on which an **unauthenticated** peer names *k* CIDs and causes *k* block fetches plus *k* local writes on the receiving node. `MAX_COMBINE_INPUTS` bounds *k* at the parser and NET-08 bounds each message's bytes, but no requirement bounds their product, and `MAX_PARTIAL_BYTES` can only refuse the merge *after* the blocks are resident. Recorded rather than closed; the handler that performs those fetches lands in 16-02, which is where the disposition belongs. |

## What 16-02 inherits

- `fabricCombiner` / `asFabricPartial` — use the requestor-side disposition (named failure
  on `null`) in `reduceJob`, and the wire-side disposition inside the handler.
- The `combine` request/response contracts are fixed and tested; the handler only has to
  fill in the branch.
- `deriveReduceTree` takes `ReduceContribution[]`, **not** `CID[]`. Any plan text saying
  otherwise is wrong.
- Seeds 41, 42, 111, 112, 113 remain taken; this plan added no seeded test.

## Self-Check: PASSED

- `packages/core/src/reduce.ts` — FOUND (`fabricCombiner`, `asFabricPartial`, `FabricPartial`, `MAX_COMBINE_INPUTS` all exported)
- `packages/core/src/index.ts` — FOUND (all four re-exported from `@o2/core`)
- `packages/net/src/protocol.ts` — FOUND (`combine` in both unions, all four codec sites)
- `packages/net/src/agent.ts` — FOUND (exactly one branch; `grep -c 'readonly combine'` = 0)
- `packages/net/src/combine-wire.test.ts` — FOUND (8 tests)
- Commit `9dc9847` — FOUND
- Commit `55069fa` — FOUND
