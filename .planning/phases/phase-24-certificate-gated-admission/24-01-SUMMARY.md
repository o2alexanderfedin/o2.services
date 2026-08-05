---
phase: phase-24-certificate-gated-admission
plan: 01
subsystem: admission
tags: [AUTH-02, AUTH-04, relay, packaging]
requires: []
provides:
  - RelayAdmission — a required named union, threaded to every FabricNode construction site, consulted by nothing
  - SeedServerOptions.trustedIssuers, distinct from trustAnchors
  - bin/seed.ts --trusted-issuer, reported distinctly on stdout
  - the fail-open/fail-closed asymmetry written at both lines
affects:
  - packages/libp2p/src/relay-admission.ts
  - packages/node/src/fabric-node.ts
  - packages/node/src/seed-server.ts
  - packages/node/src/bin/seed.ts
  - packages/node/src/peer-verifier.ts
tech-stack:
  added: []
  patterns: [required-named-union, count-pin-guard, comparative-two-arm-reading]
key-files:
  created:
    - packages/libp2p/src/relay-admission.ts
    - packages/node/src/relay-admission.node.test.ts
  modified:
    - packages/libp2p/src/index.ts
    - packages/node/src/fabric-node.ts
    - packages/node/src/peer-verifier.ts
    - packages/node/src/seed-server.ts
    - packages/node/src/bin/seed.ts
    - packages/node/src/bin/agent.ts
    - 50 files holding FabricNode construction sites
decisions:
  - RelayAdmission lives in @o2/libp2p, not @o2/net — purity.node.test.ts forbids @libp2p/* in the portable tier
  - PeerVerifier is NOT moved; its stated destination is impossible and the honest one collides with 20-13
  - The operator-boundary refusal is costed at 19 agent + 3 seed argv sites, and not implemented
metrics:
  duration: ~2h
  completed: 2026-08-04
---

# Phase 24 Plan 01: Make the check expressible, and change nothing — Summary

`RelayAdmission` is a required union on `FabricNodeOptions` written at all 70 construction
sites, every one of them stating `'admits-any-peer'`; a seed can be told its certificate
issuers separately from its build authorities; and the inertness of all of it is
demonstrated by a plant rather than asserted.

## What landed

| Thing | Where | State |
|---|---|---|
| `RelayAdmission = ReadonlySet<PublicKeyHex> \| 'admits-any-peer'` | `packages/libp2p/src/relay-admission.ts` | exported, **read by nothing** |
| Required field on `FabricNodeOptions` | `fabric-node.ts` | 70 sites state a posture |
| Fail-open/fail-closed asymmetry | `relay-admission.ts` **and** `PeerVerifier.verifiedPeers` | written at both lines |
| `SeedServerOptions.trustedIssuers` | `seed-server.ts` | passes through, conditional spread |
| `--trusted-issuer` | `bin/seed.ts` | repeatable, hex-validated, exit 2 on garbage |
| Count-pin guard | `relay-admission.node.test.ts` | 16 cases |

## Plan claims measured FALSE

**1. `PeerVerifier` cannot move to `@o2/net`.** The plan inherited `peer-verifier.ts`'s own
header claim that the move is *"a barrel change with no code change"*. That sentence checked
*"nothing Node-only"*; `@o2/net`'s bar is stricter, because the portable tier must also run
over `MemoryNetwork`. `purity.node.test.ts` lists `net` in `PORTABLE` and refuses
`/^@libp2p\//` there — and this module imports `@libp2p/interface`. Four comments in
`packages/net` already say the same of the sibling half (`reduce-job.ts`,
`discover-candidates.ts`, `capability-authorizer.ts`, `start-report.test.ts`, the last
calling the edge *"the wrong direction"*).

**Task 3 was therefore not executed as written.** The plan's own instruction governs: *"If
one is, stop — the move is not a barrel change, and that is a finding worth more than the
move."* The header is rewritten rather than deleted, recording the honest destination
(`@o2/libp2p`) and its measured price. Browser-tier verification stays **UNMEASURED**.

**2. `tsc` cannot see the packaging fact at all.** The plan's proof was *"add an import of
`PeerVerifier` to a browser-tier module and run `npx tsc --noEmit` ... before the move the
same plant must have failed"*. Planted into `browser-node.ts` **before** any move,
`tsc --noEmit` exited **0** — hoisted `node_modules` resolves `@o2/node` whatever
`packages/browser/package.json` declares. That proof would have passed in both directions
and established nothing. The instrument that refuses it is `purity.node.test.ts`.

**3. The tsc/grep reconciliation showed no gap.** The plan warned `tsc` finds fewer sites
than grep (*"Phase 19 measured this twice, once at 4 of 34"*). Measured here: **tsc flagged
70 errors across 50 files; grep found 50 files; `comm` in both directions returned empty.**
`exactOptionalPropertyTypes: true` is what closes it — spreading a `Partial<FabricNodeOptions>`
produces TS2379 (12 of the 70) rather than escaping. No hand-reconciliation was needed.

## The cost of owner ruling 1 — refuse-to-start (REPORTED, NOT IMPLEMENTED)

| Binary | argv-construction sites | Files | Published measurement? |
|---|---|---|---|
| `bin/agent.ts` | **19** | 18 | none |
| `bin/seed.ts` | **3** | 3 | none |

All are `*.node.test.ts`. **No published measurement spawns either binary** — `bin/bench.ts`
and `perf-workload.ts` build nodes in-process and spawn nothing, so a fail-closed operator
boundary would move no committed curve. The seed's three sites are
`trust-anchors.node.test.ts`, `orphan-leash.node.test.ts`, `reservation-exhaustion.node.test.ts`.

That is the entire price of the fail-closed answer. The number is written at
`bin/agent.ts`'s construction site as well as here, so an operator reading the code finds it.

## Plants — every one restored by `cp` + `cmp`

| # | Plant | Instrument | Observed |
|---|---|---|---|
| 1a | field **required**, posture omitted at one site | `tsc` | **exit 1** — `relaying.node.test.ts(321,42): error TS2741: Property 'relayAdmission' is missing in type '{ listen: never[]; relayAddrs: string[]; rpcTimeoutMs: number; trustAnchors: "runs-unsigned-artifacts"; }' but required in type 'FabricNodeOptions'.` |
| 1b | field **optional**, same omission | `tsc` | **exit 0, zero output** — the hole a required field closes, measured not argued |
| 2 | drop the seed's `trustedIssuers` pass-through | `relay-admission.node.test.ts` | **red**: `Error: timed out waiting for the pinned seed to settle a verdict on the peer` (20 161 ms) |
| 3 | wire `--trusted-issuer` into `trustAnchors` | `trust-anchors.node.test.ts` | **red**: `× write the identical default...` `Expected: "values['trust-anchor'] ?? [KERNEL_TRUST_ANCHOR]"` / `Received: "[...(values['trust-anchor'] ?? [KERNEL_TRUST_ANCHOR]), ...(values['trusted-issuer'] ?? [])]"` |
| 4 | **inertness** — `new Set<never>()` at `relayingNode` | full `--project node` | see below |
| 5 | browser-tier import of `@o2/node`, **before** any move | `tsc` / `purity` | tsc **exit 0**; purity **red**: `packages/browser/src/browser-node.ts imports "@o2/node" — a dual-target package must not depend on the Node adapters` |

Plant 3's answer to the plan's either/or: `trust-anchors.node.test.ts` **did** redden, so the
guard can already tell the two flags apart and no new case was needed.

### Plant 4 is the load-bearing one

The fail-closed extreme at the relay every reservation assertion in `relaying.node.test.ts`
uses:

| Run | Files | Tests |
|---|---|---|
| clean | 1 failed / 143 passed | 1 failed, **2074 passed**, 2 skipped |
| planted | 2 failed / 142 passed | 2 failed, **2073 passed**, 2 skipped |

The single moved test is `relay-admission.node.test.ts`'s own census row — a source-text
instrument reddening by design. **Every behavioural test stayed green, `relaying.node.test.ts`
included.** Nothing reads the value; this plan is inert.

## Exit codes, read directly

| Project | Exit | Result |
|---|---|---|
| `--project node` | **1** | 2074 passed, 2 skipped, **1 failed** — `slow-specs.node.test.ts` drift, see below |
| `--project browser` | **0** | 246 files, 3927 tests |
| `--project e2e` | **0** | 15 files, 72 tests |
| `tsc --noEmit` | **0** | — |

Wall clock 247.63 s against the recorded 248.0 s, so the host was comparably loaded;
`(user+sys)/real` = 1.38.

### The one red, and why it was not "fixed"

`slow-specs.node.test.ts`: *the node project holds 144 test files, the recorded measurement
covered 138*, tolerance 5, drift 6. **Five of that six predate this plan** — measured: 143
files without `relay-admission.node.test.ts` (drift 5, passing), 144 with it. The tree was
already at the limit.

Not repaired, and the tolerance was **not widened** (*"never close a gap by widening what
counts as passing"*). Re-baselining means rewriting `MEASURED_NODE_SPANS` in
`vitest.config.ts` — which **20-05 and 20-13 both still have to edit** — and taking fresh
wall-clock spans on a host running concurrent agents would commit this session's load into a
shared table. Both commits therefore used the guard's documented `O2_SKIP_GUARDS=1` escape
with the reason in the commit message.

## Collisions with Phase 20

| File | Phase 20 plan | What this plan did |
|---|---|---|
| `discovery-agents.node.test.ts` | 20-04 | +1 line (posture) |
| `churn-agents.node.test.ts` | 20-05 | +1 line |
| `peer-ledger.e2e.test.ts` | 20-06 | +1 line |
| `bin/bench.ts` | 20-09, 20-10 | +3 lines, **no comment added** — 24-02 owns rig posture |
| `admission.node.test.ts` | 20-12 | +2 lines |
| `vitest.config.ts` | 20-05, 20-13 | **not touched** — reported instead |
| `mutation-ledger.ts` | 20-13 | **not touched** — blocked the `PeerVerifier` move |

A required field cannot be added without every site stating it, so the five test-file
collisions were unavoidable and were held to a single inserted line each. The two files where
a choice existed — `vitest.config.ts` and `mutation-ledger.ts` — were left alone.

`bin/bench.ts` and `perf-workload.ts` are deliberately **absent from the count-pin guard**:
their posture is 24-02's decision and both are concurrently owned.

## Decisions

- **`RelayAdmission` lives in `@o2/libp2p`.** It states a fact about a *circuit reservation*,
  so it belongs beside the four reservation constants whose TTL its docblock must cite; and
  `ConnectionGater.denyInboundRelayReservation`, which will read it, is a `@libp2p/interface`
  type that `purity.node.test.ts` forbids in `@o2/core` and `@o2/net`. Both `@o2/node` and
  `@o2/browser` already depend on it, so `bin/seed.ts`, `bin/agent.ts` and the browser tier
  can all name it without `@o2/browser` acquiring `@o2/node`. This is the discretion
  24-CONTEXT grants, exercised.
- **`admitsAnyPeer` ships with no caller**, so 24-03 adds a *caller* rather than a
  *semantics*. The guard pins that it has none.
- **The seed's posture is hardcoded open at the `SeedServer` construction**, not derived from
  `trustedIssuers` — collapsing them is the exact conflation the new field exists to prevent.

## What this plan did NOT do

- No `connectionGater`, no refusal, no change to `circuitRelayServer`'s arguments.
- `PeerVerifier.verifiedPeers`'s fail-open early return is untouched.
- `BrowserNodeOptions` gained **no** `relayAdmission` field. Flagged for 24-02/24-03: a
  `BrowserNode` cannot run `circuitRelayServer` at all, so it has no reservation to gate —
  but *the tiers now state posture on different terms*, and under the cardinal rule that is
  a difference someone must either justify at the line or remove.

## Known stubs

None. `admitsAnyPeer` is uncalled by design and is count-pinned as such.

## Self-Check: PASSED

- `packages/libp2p/src/relay-admission.ts` — FOUND
- `packages/node/src/relay-admission.node.test.ts` — FOUND
- `959710d` — FOUND (56 files, no `.planning/` swept in)
- `f7bc88e` — FOUND
