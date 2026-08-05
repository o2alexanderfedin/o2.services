---
phase: phase-15-capability-chained-dispatch
plan: 01
subsystem: auth
tags: [capability-chain, delegation, ed25519, libp2p, peer-id, authorizer, auth-03]

requires:
  - phase: phase-4
    provides: verifyChain, delegate, describeFailure — complete and fuzzed, with zero production callers
  - phase: phase-11
    provides: the explicit `authorize` hook and the named-sentinel convention it is declined with
  - phase: phase-14
    provides: the `moduleRecord` precedent for a second optional field on the `exec` variant
provides:
  - "audienceKeyOf — the ed25519 public key behind a libp2p peer id, hex-encoded, from either a PeerId object or its string form"
  - "authorizeCapability — the repository's first real Authorizer, verifying a chain against a pinned owner key, this node's audience and an injected clock"
  - "a measurement, not an assumption, that the browser tier's createLibp2p default identity is Ed25519"
affects: [phase-15-plan-03, phase-15-plan-04, phase-17-enrollment]

tech-stack:
  added: []
  patterns:
    - "the audience key is derived, never distributed: both ends compute it from the peer id they already exchange"
    - "a refusal is named at the point it is detectable, not deferred to a later mechanism that would misattribute it"

key-files:
  created:
    - packages/libp2p/src/audience-key.ts
    - packages/libp2p/src/audience-key.test.ts
    - packages/browser/src/audience-key.browser.test.ts
    - packages/net/src/capability-authorizer.ts
    - packages/net/src/capability-authorizer.test.ts
  modified:
    - packages/libp2p/src/index.ts
    - packages/net/src/index.ts

key-decisions:
  - "The chain audience is derived from the libp2p peer id, so there is nothing to enroll, distribute or keep in step — and the binding to the noise-authenticated identity is structural rather than asserted"
  - "A non-Ed25519 or key-less identity throws at derivation time rather than returning a key verifyChain would later refuse as wrong-audience, because that refusal would send a reader to the wrong file"
  - "The absence check runs before the type narrowing, because after narrowing the compiler reports the check as a type error and the natural fix is to delete it"
  - "A node pinned to no owner key refuses every sovereign task naming that owner; absence never passes"
  - "verifyChain's verdict string is returned verbatim — agent.ts already prefixes it and describeFailure already names the link"
  - "The clock is a thunk one layer above verifyChain, which keeps taking `now` as a value and therefore keeps having no clock port"

patterns-established:
  - "Refusal texts are asserted with toBe where the claim is that no rewording happened, and the assertion carries a comment saying what the text cannot show"
  - "A zero reading from a counter is only reported alongside a non-zero reading from the same counter in the same file"

requirements-completed: [AUTH-03]

duration: 13min
completed: 2026-07-31
---

# Phase 15 Plan 01: The Audience Key and the Authorizer — Summary

**`verifyChain` now has a caller shaped like the hook that wanted it, and a real key to verify against — derived from the libp2p peer id both ends of a dispatch already hold, so nothing had to be enrolled, distributed or kept in step.**

## Performance

- **Duration:** 13 min
- **Started:** 2026-07-31T16:49:00-07:00 (worktree spawn; first commit 16:54:20)
- **Completed:** 2026-07-31T17:02:32-07:00
- **Tasks:** 2 of 2
- **Files created/modified:** 7 (5 created, 2 modified — both barrels, append-only)

## Accomplishments

- **`audienceKeyOf` (`@o2/libp2p`)** recovers the 32 raw ed25519 bytes behind a peer id as 64 lowercase hex characters, from a `PeerId` object *or* from its string form, and proves the two agree. That equality is the whole of 15-CONTEXT.md decision 1: the serving node reads its own `libp2p.peerId`, the requestor reads the `nodeId` string it was already given, and they arrive at the same audience with no new wire message, no enrollment and no key file.
- **`authorizeCapability` (`@o2/net`)** is the first real `Authorizer` in the repository. Every production call site still passes `'serves-unauthenticated'` — this plan wires nothing, by design — but Plan 15-03 now has something real to hand `serveAgent`.
- **Decision 1's one labelled assumption is now a measurement.** The browser tier's `createLibp2p` default identity was *assumed* to be Ed25519 on the grounds that it is the same function with no `privateKey` option. It is now read off a live node in Chromium, Firefox and WebKit.
- **Ordering is proven by absence of execution, not by the wording of a reply.** A refused sovereign dispatch leaves the counting executor at `0`; an accepted one leaves it at `1`; both readings are in the same file, so the `0` comes off an instrument shown able to count.
- **No existing test file was edited, and no dependency was added.** `packages/libp2p/package.json` and `package-lock.json` are byte-identical to the base commit; no `npm install` was run in the shared checkout.

## Task Commits

1. **Task 1: `audienceKeyOf`** — `b0a1b8d` (test, RED) → `54ef406` (feat, GREEN)
2. **Task 2: `authorizeCapability`** — `de29ac6` (test, RED) → `ad2606a` (feat, GREEN)
3. **Citation correction** — `44ada17` (docs)

Every RED commit was watched failing first, on a resolver proven to read this worktree (below).

## Files Created/Modified

- `packages/libp2p/src/audience-key.ts` — `audienceKeyOf(peer: PeerId | string): PublicKeyHex`. Resolves a string through `peerIdFromString`, tests for an absent public key **while the union still admits absence**, then refuses a non-Ed25519 type by name, then returns `toHex(publicKey.raw)`.
- `packages/libp2p/src/audience-key.test.ts` — four behaviours; no `.node.` suffix, so it runs in Node *and* in three browser engines, which is itself the claim that this path never touches `crypto.subtle`.
- `packages/browser/src/audience-key.browser.test.ts` — decision 1's assumption, measured on the tier it was assumed for.
- `packages/net/src/capability-authorizer.ts` — `authorizeCapability(options): Authorizer`, four-step precedence, pure module.
- `packages/net/src/capability-authorizer.test.ts` — nine behaviours: four as direct calls, five over a real `RpcEndpoint`/`serveAgent` pair on `MemoryNetwork`.
- `packages/libp2p/src/index.ts`, `packages/net/src/index.ts` — appended at the stated anchor lines. No surrounding block was reflowed or regrouped (both are cross-phase hotspots).

## Verification

| Check | Result |
|---|---|
| `npx tsc --noEmit` (whole repository) | exit 0 |
| `vitest --project node packages/libp2p packages/net` | 17 files, **173 passed** |
| `vitest --project browser packages/libp2p packages/net` | 51 files, **519 passed** (chromium + firefox + webkit) |
| `vitest --project node` (unit mode, whole project) | 78 files, **1154 passed**, 18 skipped, 0 failed |
| `purity.node.test.ts` | 14 passed — `@o2/net` stayed portable, `@o2/libp2p` stayed platform-free |
| `vocabulary.node.test.ts` | 24 passed, run **after** committing so `git ls-files` actually saw the new files |
| `serve-agent-hooks.node.test.ts` | 17 passed — the sentinel burn-down count is unchanged, as this plan wires nothing |
| scoped diff vs. base | exactly the 7 planned paths, 696 insertions, **0 deletions** |
| `packages/libp2p/package.json`, `package-lock.json` | unchanged |

**Resolver proof (the trap inherited from Phase 14).** The worktree has no `node_modules`, and symlinking the main install wholesale resolves `@o2/*` back to the **main checkout**, so `tsc` and `vitest` would report a clean repository without reading a line of this work. A farm was built instead — 185 third-party entries symlinked at the main install, all 8 `@o2/*` repointed at this worktree's `packages/` — and proved before any test was trusted:

```
OK   @o2/core -> …/worktrees/agent-a97400725ade1e21a/packages/core/src/index.ts
OK   @o2/net  -> …/worktrees/agent-a97400725ade1e21a/packages/net/src/index.ts
…
vitest -> /Volumes/ProjectsSSD/Projects/o2.services/node_modules/vitest/package.json
```

Every RED test was then watched failing on that worktree path, e.g. `Cannot find module './audience-key.ts' imported from …/worktrees/agent-a97400725ade1e21a/packages/libp2p/src/audience-key.test.ts`.

## Mutation Testing — observed, not predicted

All five mutations were planted, run, and restored by `cp` from a scratch baseline outside the working tree, each restoration confirmed byte-identical with `cmp`. No `git checkout`, `restore`, `stash`, `reset` or `clean` was used at any point after setup — several agents share this checkout.

| # | Mutation | Plan predicted | **Observed** |
|---|---|---|---|
| 1 | delete `if (peerId.type !== 'Ed25519') throw` | secp256k1 case red | **1 of 4 red** — exactly that case, `expected [Function] to throw an error` |
| 2 | delete the `publicKey === undefined` throw | RSA case red | **1 of 4 red**, and *how* it failed is the finding: the RSA stub fell through to the **type** check and produced `peer stub-rsa-peer is of type RSA, an…`. The test caught the *wrong refusal*, not merely a missing one — which is the argument for two distinct texts, now demonstrated rather than asserted |
| 3 | delete the `peerIdFromString` resolution of a string argument | "the string-form assertions fail" | **2 of 4 red** — both string-form tests, each with `peer 12D3KooW… carries no public key` |
| 4 | delete the `ownerKey === undefined` refusal | no-pinned-key case red | **1 of 9 red**, and again the manner matters: control fell into `verifyChain` with `ownerKey: undefined`, which returned `link 0 is issued by 8a88e3dd…` — a `wrong-root` refusal naming a **key** instead of the **owner**. Precisely the "indistinguishable from a node that verified" confusion step 2 exists to prevent |
| 5 | replace `return result.ok ? null : result.reason` with `return null` | "the empty-chain and expired cases go red *and* the `executed === 0` reading flips to 1" | **5 of 9 red** — empty-chain, no-chain-dispatch, expired, wrong-audience, and the clock case. The counter did flip: the three fabric refusals all failed on `expected true to be false`, i.e. the dispatch *succeeded*, which is the executor having run |

Mutation 5 broke more than the plan named. Recording the observation rather than the prediction is the house rule (13-05 set it); the extra three are the wrong-audience and clock cases, which the plan's `<proof>` block simply did not enumerate.

**One test in this plan has no production deletion behind it, and that is stated rather than papered over.** `packages/browser/src/audience-key.browser.test.ts` measures a property of `createLibp2p`'s own default, not of anything in this repository. Nothing in `packages/` can be deleted to turn it red, and inventing a mutation for it would be fabricating evidence.

## Corrections — every `file:line` in the plan was verified before being relied on

Six stated locations had drifted, all of them post-Phase-14. Reported per the standing rule that a correction recorded in a SUMMARY reaches no sibling plan, so **Plans 15-02, 15-03 and 15-04 should re-grep rather than trust either copy**:

| Plan said | Actually | Load-bearing? |
|---|---|---|
| `browser-node.ts:196-205` is "the browser tier's `createLibp2p` call" | **`browser-node.ts:376-386`**. Lines 196-205 are the tail of `BrowserNodeOptions` and the opening of `class BrowserNode` | Yes — Plan 15-03 wires this factory |
| `fabric-node.ts:303-336` is "the whole `createLibp2p` call" | **`fabric-node.ts:505-552`** | Yes — 15-03 wires this factory |
| that call's "only top-level keys are `addresses`, `transports`, `connectionEncrypters`, `streamMuxers`, `connectionManager` and `services` — verified 2026-07-29" | **incomplete**: there is a seventh, conditionally-spread `logger` key at `:549-551` | The *conclusion* survives intact — `grep privateKey` returns **nothing** in either factory, so the throwing branch really is unreachable through them. Re-verified 2026-07-31 |
| `agent.ts:61-64` is the `Authorizer` type | **`agent.ts:63-66`** | Minor |
| `agent.ts:211-231` is the authorize `try`, `:215-225` the call and outcome | **`agent.ts:398-420`**; the authorize call is `:402-408` and the `unauthorized: ` composition is `:419` | Yes — cited in shipped source, so the shipped comment carries `:419` |
| `protocol.ts:409-410` refuses an `exec` frame with no label | **`protocol.ts:507-508`** | Not cited in code; still true as behaviour |
| `submit.ts:29-31` is `ShardSpec` | **`submit.ts:30-32`**; `:29` is the doc comment | Corrected in shipped source by `44ada17` |

Verified **correct** and worth recording because they are the ones the phase's claims rest on: `capability.ts:104` is exactly the literal `'no capability chain supplied'`; `capability.ts:101-122` is `describeFailure`; `:132-133` is the `audience` field; `:135` is the "no clock port" comment; `:148-210` is `verifyChain`; `capability.test.ts:12-15` is the seeded `keypair`; `distributed.test.ts:509-566` is the fabric shape; and `13-VERIFICATION.md:245` does carry the peer id `12D3KooWKFrpYTgHg9tkjVvocKdbovBiV1B7LSK3rJSo7eB1emN8` verbatim, as the handshake line of a genuinely spawned agent.

## Decisions Made

- **`audienceKeyOf` accepts `PeerId | string`, not one or the other.** A serving node has the object; a requestor has only the string. Both must reach the same answer or no chain either mints could verify, so accepting both and asserting their equality is the mechanism, not a convenience.
- **The absence check precedes the type narrowing, and the source says why in the imperative.** `PeerId` is a union whose Ed25519 member declares `publicKey` as required. After narrowing, `publicKey === undefined` is a comparison of non-overlapping types — a compile error whose obvious "fix" is deleting the check that was doing the work. The comment names that trap so a future reader does not spring it.
- **Refusal strings name the owner, and pass `describeFailure` through untouched.** Steps 2 and 3 compose their own text because they are *this module's* refusals about *this node's configuration*; step 4 returns `verifyChain`'s verdict verbatim because it is not.
- **Two clocks, sized after measuring the host.** `uptime` read a 1-minute load average of **8.80** before either bound was chosen, so the RPC budget is 10 s and the vitest timeout 30 s — the framework's strictly the larger, both with headroom. Neither number is a claim about how long anything takes; `MemoryNetwork` is in-process and nothing approaches either bound.
- **The fabric tests dispatch via `rpc.request` with a hand-built `exec` frame, not via `RemoteExecutor`.** `RemoteExecutor` carries no chain until Plan 15-02, and going around it keeps this plan independent of that one, exactly as the plan intended. Said so in a comment at the call site.

## Deviations from Plan

None. Nothing in the plan required a deviation rule: no bug, no missing critical functionality, no blocker, no architectural change. The seven `file:line` corrections above are reporting obligations, not deviations — each was verified before use and only one reached shipped source (`44ada17`).

## Issues Encountered

1. **The worktree resolver trap** (inherited warning, hit as described). Resolved by building a per-package farm and proving `@o2/*` resolution before trusting any test. Documented above.
2. **`require.resolve('@o2/core/package.json')` throws `ERR_PACKAGE_PATH_NOT_EXPORTED`** — the packages' `exports` maps declare only `"."`. The error message still named the worktree path, but the proof was rewritten to resolve the entry point itself so it produces a clean positive reading rather than an informative failure.
3. **Vitest project scoping.** Every run used `--project node` or `--project browser`; no bare-path invocation was made, per the inherited warning about fan-out across four projects on a contended host.

## Known Stubs

Two, both in `packages/libp2p/src/audience-key.test.ts`, both labelled in the file with the reason and both deliberate:

- `SECP256K1_STUB` and `NO_PUBLIC_KEY_STUB` are structural objects cast through `as unknown as PeerId`. Minting a real secp256k1 or RSA identity needs `@libp2p/crypto`, and adding a dependency would mean an `npm install` in a working tree several agents share. The branch under test is a two-line type check whose input shape is fully determined by `@libp2p/interface`.
- **What they cannot show, recorded so a later plan does not over-read them:** they prove `audienceKeyOf` refuses. They prove *nothing* about what a node factory does when it refuses, and they cannot — neither factory passes `privateKey` to `createLibp2p`, so every identity either produces is the Ed25519 default and the throwing branch is unreachable through them. Plan 15-03 should carry that statement in its own words rather than asserting a start-time refusal nothing can drive.

## Next Phase Readiness

- **Plan 15-03 can wire `serveAgent` without inventing anything.** It needs `NodeSovereignty.ownerKey` (which this plan deliberately did not touch), `audienceKeyOf(libp2p.peerId)` at both factories, and `now: Date.now`.
- **Plan 15-02 is unaffected.** The two plans are independent and neither barrel line collides — 15-02 adds a third line to `packages/net/src/index.ts` below the two added here.
- **Unchanged and still true:** every production `authorize` call site passes `'serves-unauthenticated'`, so the four test files 15-CONTEXT.md flags as breaking (`fabric-node.node.test.ts`, `egress-manifest.node.test.ts`, `egress-refusal.node.test.ts`, `sovereignty-placement.node.test.ts`) are all still green. They break in 15-03, not here.
- **No blockers.**

## Self-Check: PASSED

All 7 source paths and the SUMMARY exist on disk; all 5 commit hashes are present in
`git log`. Verified by direct `existsSync` / `git log` reading, not by recollection.

---
*Phase: phase-15-capability-chained-dispatch*
*Completed: 2026-07-31*
