---
status: investigating
trigger: "DEFECT #63 — two connected nodes each ask the other for a block neither holds; 60 s timeout with no refusal"
created: 2026-08-05
updated: 2026-08-05
---

## Current Focus

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
next_action: confirm `serveAgent` is handed the FetchingBlockstore, not the local tier.

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
