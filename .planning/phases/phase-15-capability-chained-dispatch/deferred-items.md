# Deferred items — phase 15

Out-of-scope discoveries, logged rather than fixed. Recorded by Plan 15-03.

## 1. Five shipped comments claim `BrowserNode.start` runs in no vitest project. It does.

**Measured 2026-07-31**, on this worktree:

```
$ npx vitest run --project browser packages/browser/src/start-unwind.browser.test.ts
Test Files  3 passed (3)      # chromium + firefox + webkit
Tests      15 passed (15)
```

`packages/browser/src/start-unwind.browser.test.ts` calls `BrowserNode.start(...)` at
its `:157`, `:170` and `:195`, and the last two start the factory **to success** with
`relayAddrs: []`. So the claim is false as written, in these five places:

| File | Line | Claim |
|---|---|---|
| `packages/browser/src/browser-node.ts` | 179 | "no such test was ever written: `BrowserNode.start` needs a real `indexedDB` and a…" |
| `packages/browser/src/browser-node-contract.node.test.ts` | 26 | "`BrowserNode.start` needs a real `indexedDB` and a relay to dial, so no Node-project…" |
| `packages/node/src/serve-agent-hooks.node.test.ts` | ~66 (SCHED-06 row) | "`BrowserNode.start` needs a real `indexedDB` and a relay to dial, so it runs in neither vitest project" |
| `packages/node/src/sovereign-block-refusal.node.test.ts` | ~46 (item 3) | "so it runs in neither vitest project — WIRE-03, Phase 19" |
| `packages/node/src/mutation-ledger.ts` | 140 | "The same reversion on the browser factory. `BrowserNode.start` needs a real …" |

**What is still true**, and is the claim these five should be rewritten to make: a
started `BrowserNode` listens on `['/p2p-circuit', '/webrtc']` alone
(`browser-node.ts:378`) after dialling each relay it was given (`:391`). With no relay
reservation it has **no address any peer can dial**, so nothing can deliver a frame to
its `serveAgent` handler. The barrier is *dialability*, not *startability*.

**Why this was not fixed here.** It is pre-existing, it touches four files outside Plan
15-03's ten, and one of them is `mutation-ledger.ts`, whose `find` text must keep
matching real source or the entry it plants guards nothing. The single occurrence
inside this plan's scope — the AUTH-03 comment on the `BROWSER_NODE` pair in
`serve-agent-hooks.node.test.ts`, which Plan 15-03 authored — carries the corrected
statement already. The SCHED-06 row in that same file still carries the stale one and
was left alone, because rewriting an assertion's comment that this plan is not otherwise
touching is how a scoped change becomes an unscoped one.

**Who should take it.** Whichever phase next revisits WIRE-03 / the browser harness.
It changes no behaviour and no assertion — five comments and the mutation ledger's
description text.
