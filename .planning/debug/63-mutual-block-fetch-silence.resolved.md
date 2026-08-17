---
status: resolved
trigger: "DEFECT #63 — two connected nodes each ask the other for a block neither holds; 60 s timeout with no refusal"
created: 2026-08-05
updated: 2026-08-17
resolved_by: cb842e70950f9efee45618dc6eae1867a00606e6
---

## Current Focus

CLOSED — CONFIRMED then FIXED, and the fix is in the tree today.

The hypothesis below was confirmed on 2026-08-05 and fixed the same day by `cb842e7`
("fix(net): a node answers for what it holds, not for what its peers might hold"), which
is an ancestor of both `develop` and `main`. This file stayed `status: investigating` for
twelve days as a **bookkeeping miss, not outstanding work** — the Resolution section below
was already written and the code already landed. Re-verified against the tree on
2026-08-17; see the four evidence entries dated then. `next_action: none`.

hypothesis: the 60 s is the demo tier's `rpcTimeoutMs`, NOT a property of the block path.
  The real cause is that a serving node answers `block` requests out of a
  `FetchingBlockstore`, which on a local miss goes back to the network — including to
  the peer that asked. Two such nodes deadlock on each other's promise, so the
  `bytes: null` refusal branch in `serveAgent` is never reached.
test: build two in-memory nodes each serving from a `FetchingBlockstore` whose source
  points at the other, ask for a CID neither holds, and measure whether the request
  resolves `undefined` (refusal reached) or hangs to the RPC deadline.
expecting: hangs to the deadline => cause confirmed as the mutual fetch, not a missing
  refusal branch.
next_action: none — closed.

## Symptoms

expected: "I don't have it" — a stated refusal
actual: silence until the deadline
errors: RpcFailure kind 'timeout'
reproduction: two connected nodes, request a CID neither holds
started: unknown

## Eliminated

- hypothesis: "the block branch of `serveAgent` has no not-held answer"
  evidence: it does — `const found: AgentResponse = { kind: 'block', bytes: bytes ?? null }`
    in `serveAgent`'s `request.kind === 'block'` arm. Absence is already a named `null`.
    So the defect is not a missing branch; it is that control never reaches it.
  timestamp: 2026-08-05

## Evidence

- checked: grep for the 60 s bound
  found: `packages/browser/demo/main.ts` sets `rpcTimeoutMs: 60_000`, and two comments in
    the same file call it "60 s, set where this page constructs its node".
    `DEFAULT_RPC_TIMEOUT_MS` in `packages/net/src/rpc.ts` is `30_000`.
  implication: the recorded 60 s is the demo page's own RPC deadline. Per this repo's
    rule, that reading is evidence of the bound and not of the block path.

- checked: `RpcBlockSource.fetch` in `packages/net/src/agent.ts`
  found: iterates `this.#peers()`, and on a reply that is `kind: 'block'` with
    `bytes === null` it does `continue` — i.e. it treats a stated absence as a miss and
    asks the next peer, returning `undefined` when the list is exhausted.
  implication: the requestor side handles a null answer correctly. The question is
    whether the answer is ever produced.

- checked: `FetchingBlockstore.get` in `packages/net/src/block.ts`
  found: local miss => `#inFlight` map keyed by CID => `#fetchAndVerify` => `#source.fetch`.
    No timeout, no abort, no cycle guard, and no notion of who asked.
  implication: a serving node that answers from this class will go to the network for a
    block it does not hold, with nothing stopping it going back to the asker.

- checked: two `serveAgent` nodes, each with `FetchingBlockstore` over an
    `RpcBlockSource` pointing at the other, `rpcTimeoutMs: 2_000`, asked for a CID
    neither holds
  found: `[63] resolved=undefined elapsedMs=2002 rpcTimeoutMs=2000`
  implication: the wait equals the bound, to 2 ms. Re-siting the bound at 2 s moved the
    reading to 2 s, which is the direct falsification of "60 s" as a property of the
    block path. It is the RPC deadline and nothing else. Also: the fetch DOES resolve
    `undefined` — absence is reported correctly, just only after the full deadline.

- checked: cycle-versus-chain, both arms in one call so the machine cancels
  found: `chain resolved=undefined elapsedMs=2 bGets=1 cGets=1` and
    `cycle resolved=undefined elapsedMs=2003 aGets=1 bGets=1`
  implication: cause isolated. The serve-path call counts are the mechanism: A's handler
    was entered exactly once and did NOT start a second fetch — `FetchingBlockstore`'s
    in-flight map handed it the promise already waiting on B. A chain of the same depth
    resolves in 2 ms, so "block fetches are slow" is refuted.

- timestamp: 2026-08-17
  checked: whether the fix is in the tree as it stands, by reading the fetch path before
    attempting any repro
  found: `packages/net/src/agent.ts` block branch reads
    `const bytes = (await blockstore.has(request.cid)) ? await blockstore.get(request.cid) : undefined`.
    `git log` attributes it to `cb842e7` (2026-08-05 13:51 -0700).
    `git merge-base --is-ancestor cb842e7 develop` EXIT=0 and the same against HEAD EXIT=0.
  implication: already-fixed-at-cb842e7. The defect is not live. Verified from a worktree
    whose base is a merge commit containing `develop`'s tip `f805c17`, with its OWN
    `npm ci` (EXIT=0, 342 packages) — no node_modules symlinked from the main checkout.

- timestamp: 2026-08-17
  checked: whether the regression guard is still LIVE, not merely present — `agent.ts` has
    taken five commits since the fix, so a green that was never watched fail proves nothing
  found: baseline `npx vitest run --project node packages/net/src/named-refusal.test.ts`
    EXIT=0, 8/8. Planted the bare `get` back (one hunk, 1 insertion 1 deletion, gate grep
    count 0). Red at EXIT=1 with the observed text
    `AssertionError: expected 2001 to be less than 500`, case reported at 2004 ms, in
    "resolves a mutual fetch by name instead of by deadline, against a chain that never
    cycled". 7 of 8 still passed under the plant — the held-block positive control holds,
    so the timing assertion cannot be satisfied by deleting the branch outright. Restored
    by the surgical inverse of my own edit; `cmp` against the snapshot taken immediately
    before planting EXIT=0, `git diff` empty; re-run EXIT=0, 8/8.
  implication: the guard fires. The 2026-08-05 fix is protected today, not just present.
    Host load averages 5.29 / 8.05 / 14.15 with two sibling agents running — which does
    NOT contaminate the reading, because the assertion that fired is the comparative one
    (`cycleMs < chainMs + 500`) and the chain arm absorbs identical load in the same run.
    Planting was safe from the concurrency hazard because this is an isolated worktree,
    not the shared checkout.

- timestamp: 2026-08-17
  checked: the recorded blind spot — "relies on `has` being local for every Blockstore"
  found: all four implementations in the tree are local-only.
    `MemoryBlockstore` (`core/src/blockstore/memory.ts:46`) is a Map lookup;
    `IdbBlockstore` (`browser/src/idb-blockstore.ts:98`) is an IndexedDB `getKey`;
    `FsBlockstore` (`node/src/fs-blockstore.ts:102`) is a `readFile`;
    `FetchingBlockstore` (`net/src/block.ts:90`) delegates to `this.#local.has(cid)`.
  implication: blind spot closed as of today. No implementation reintroduces the defect at
    a distance, so the `ports.ts` contract is currently honoured by every subtype and not
    only by the one the fix was written against.

- timestamp: 2026-08-17
  checked: the deliberately-untouched `combine` branch, which still does a bare
    `options.blockstore.get(cid)` at `agent.ts:882` and so CAN still go to the network
  found: `RpcBlockSource.fetch` (`agent.ts:62-66`) only ever emits
    `{ kind: 'block', cid }` — it has no path that emits a `combine`. So a
    combine-triggered fetch arrives at the peer as a `block` request, which the gated
    branch answers `bytes: null` immediately without re-entering the network.
  implication: the residual is bounded, not open. A combine cycle terminates in one hop
    because the block branch is gated; combine cannot recurse into combine. The refusal
    text `combine input <cid> not held and not obtainable` (`agent.ts:887`) is reachable.
    This is a reading of the call graph, not a measurement — no combine-cycle fixture was
    built, and that is the case that would carry it if the block gate were ever removed.

- timestamp: 2026-08-17
  checked: the reading above, now measured — the fixture it said did not exist was built
  found: |
    Three cases at the foot of `named-refusal.test.ts`, and the reading holds exactly as
    stated. A combine sent to a node of a mutually-wired pair, naming two CIDs nobody
    holds, refuses by name in single-digit ms against a chain arm of the same depth run
    in the same call. The serving node emitted **one** request frame while the combine was
    in its hands and that frame was a `block`; its peer emitted **none**, which is the
    gate answering out of its own holdings.
  implication: |
    Both halves of the coupling now fire, and each was watched failing on its own plant.

    - **Gate removed** (`has` gate back to a bare `get`): the new combine case reads
      `expected 2002 to be less than 500`, beside the pre-existing block case's 2004 —
      the same 2 000 ms inner-budget signature, now on both branches.
    - **`combine` made reachable from `RpcBlockSource`** — the half that reddened nothing
      before. A plant that leaves the fetch working and merely adds a combine frame per
      peer reads `expected [ 'combine', 'block', 'combine', 'block' ] to deeply equal
      [ 'block', 'block' ]`. Under the cruder plant that *replaces* the block request, six
      of eleven cases go red. The narrow plant is the one that matters: it is the shape a
      real regression would take, and before today nothing in the tree caught it.

    `agent.ts` was restored by the surgical inverse of each edit and `cmp`'d against a
    snapshot taken immediately before each plant — EXIT=0 all three times, `git status`
    showing only the test file. tsc EXIT=0; `--project node packages/net` 29 files /
    396 tests EXIT=0.

## Resolution

reasoning_checkpoint:
  hypothesis: "a serving node answers `block` out of a `FetchingBlockstore`, which on a
    local miss goes to the network including back to the asker; two such nodes await each
    other's promise and only the RPC deadline ends it."
  confirming_evidence:
    - "cycle 2003 ms vs chain 2 ms in one run, same depth, same fixtures"
    - "serve-path get counts of 1 on each node — no recursion, a held promise"
    - "elapsed tracks the configured bound: 2002 ms at 2000, and the demo sets 60_000"
  falsification_test: "the chain arm waiting as long as the cycle would refute it"
  fix_rationale: "gate the block serve branch on `has`, which is contractually local. It
    removes the network re-entry that IS the cycle, rather than adding a hop counter or a
    cycle set, which would bound the symptom and leave a node acting as an open recursive
    proxy."
  blind_spots: "relies on `has` being local for every Blockstore — unstated until now, so
    the contract was written onto `ports.ts`. Transitive proxy serving is removed; nothing
    in the tree relied on it (every test topology points its RpcBlockSource at a holder,
    and both production sites already walk every peer from the requestor side)."

root_cause: `serveAgent`'s `block` branch answered from `AgentOptions.blockstore`, which in
  production (`fabric-node.ts`, `browser-node.ts`) is a `FetchingBlockstore`. A node asked
  for a block it did not hold therefore went to the network to find one for the peer that
  had just asked it. With two nodes wired to each other — every pair in a mesh — A's `get`
  registers the CID in its in-flight map and asks B, B's serve path asks A, and A's serve
  path is handed back the very promise waiting on B. The correct `bytes ?? null` refusal
  was never reached. THE RECORDED DIAGNOSIS WAS WRONG ON BOTH POINTS: the refusal branch
  exists and is correct, and the 60 s is the demo page's own `rpcTimeoutMs`.

fix: gate the block serve branch on `blockstore.has(cid)` before `get`, so a node answers
  for what it holds. Contract written onto `Blockstore.has` in `ports.ts`. Combine branch
  deliberately untouched — it fetches inputs it was asked to compute over.

verification: `named-refusal.test.ts` 8/8 green; planted the bare `get` back, applied
  confirmed by cmp AND by a grep count of 0 for the gate, red at
  "expected 2001 to be less than 501" with the case at 2005 ms, restored confirmed by cmp.
  The held-block positive control stayed green under the plant.

files_changed:
  - packages/net/src/agent.ts
  - packages/core/src/ports.ts
  - packages/net/src/named-refusal.test.ts

commit: cb842e70950f9efee45618dc6eae1867a00606e6 — "fix(net): a node answers for what it
  holds, not for what its peers might hold", 2026-08-05, ancestor of `develop` and `main`.

reverified: 2026-08-17, from an isolated worktree with its own `npm ci`. Fix present, guard
  watched red under a re-plant and green after a `cmp`-verified restore, blind spot closed
  across all four `Blockstore.has` implementations, combine residual bounded by reading.
  NO CODE CHANGE WAS NEEDED — this pass only corrected the bookkeeping.

still_open: nothing blocking. One thing deliberately NOT done, recorded so it is not
  mistaken for coverage: the `combine` branch's bare `get` is safe only *because* the block
  branch is gated, and no fixture asserts that coupling. If anyone removes the `has` gate,
  `named-refusal.test.ts` reds — but if anyone instead makes combine reachable from
  `RpcBlockSource`, nothing reds. That is a latent coupling, not a live defect.
