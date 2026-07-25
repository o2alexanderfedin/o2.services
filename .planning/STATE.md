# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-07-24)

**Core value:** Usable capacity grows super-linearly with the user base, without any raw data leaving its owner's device.
**Current focus:** Phase 3 — Browser Tier & Backbone Relay

## Current Position

Phase: 3 of 10 (Browser Tier & Backbone Relay) — not yet planned
Plan: 0 of TBD in current phase
Status: Ready to discuss
Last activity: 2026-07-25 — Phase 2 complete and verified: 206 tests green (node 112, Chromium 94), `tsc --noEmit` clean, `@o2/core` byte-for-byte unchanged

Progress: [██░░░░░░░░] 20% (2 of 10 phases complete)

**Note on the old "Phase 1 — Determinism Gate & Trust-Model Verdict":** that phase no
longer exists. It was deleted from the roadmap (11 phases → 10, 76 → 72 requirements,
`ce1ceb0`) because the question it was built to answer is settled by two specs: the WASM
spec makes a generated NaN's sign nondeterministic, so measuring it could never change
the design, and strict DAG-CBOR forbids the value at the serialization boundary anyway.
The corresponding code — an admission gate that parsed WASM instruction streams — was
deleted at `afb3cad`, 1,214 lines. `.planning/phases/` is empty because the only phase
directory that existed belonged to that phase. This is expected, not damage.

## Performance Metrics

**Velocity:**
- Total plans completed: 0
- Average duration: —
- Total execution time: 0.0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| - | - | - | - |

**Recent Trend:**
- Last 5 plans: —
- Trend: —

*Updated after each plan completion*

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Verification compares the SAME module run on two nodes, byte for byte. Not multiple implementations of the same computation — cross-implementation verification is explicitly out of scope.
- There is no static determinism analysis. Divergence is detected by the comparison, not predicted ahead of it. The admission gate was built and then deleted; do not reintroduce it. The import object is the sandbox — WebAssembly.instantiate refuses any import the host does not supply.
- The verification claim is split (C3, decided): redundant execution on public/shared data and on the aggregation tree; sovereign maps run redundantly within the owner's own node set when two or more are live, and are owner-attested otherwise.
- Relay decision inverted by evidence: own backbone relay primary (AutoTLS + webRTCDirect), public infra opportunistic only. Browsers structurally cannot dial the majority of public libp2p nodes.
- Ordering is load-bearing: sovereignty before placement, tree-reduce before placement, artifact signing at content-addressing time (not at elfconv time), coordinator checkpointing in the churn phase, governor + benchmark instrumentation in the kernel phase.
- **A remote executor is just an `Executor` (Phase 2).** `submitJob` takes `Executor[]` and cannot tell where one runs, so the network arrived without a kernel change. Any future "distributed" feature should first be checked against this: if it can be an adapter behind an existing port, it must be.
- **Packages split on the portability line, not the feature line (Phase 2).** `@o2/net` is portable and its tests run in Node *and* Chromium; `@o2/node` holds everything a browser cannot do. `purity.node.test.ts` enforces it — no `node:`/`libp2p`/`@chainsafe` import may appear in a portable package.
- **`Transport` stays a one-way datagram port (Phase 2).** Request/response correlation lives in `@o2/net` instead, because a datagram shape is the smallest thing an in-process table, a libp2p stream, and a relayed WebRTC channel can all implement.
- **Wire framing is uniform across transports (Phase 2).** One stream per message, completion signalled by the sender closing its write end — so no length prefix and no framing state machine. Chunked at 16 KiB with `runOnLimitedConnection: true` even on TCP, so the same path survives relaying in Phase 3.
- Part I (elfconv AOT) sequenced last and run as a parallel track; it must not block the capacity-scaling thesis.

### Pending Todos

None yet.

### Blockers/Concerns

- **Disclosure gate:** publishing forfeits EPO/China patent rights permanently. No deploy workflow file may exist in the repository at all — absent, not disabled. Deployment is a separately-triggered human action (DEMO-04).
- **Version traps (C5): resolved in Phase 2.** js-libp2p 3.x installed with exact pins; none of the four trap packages are present. Two duplicate resolutions were found and fixed with npm `overrides` — `multiformats` had both 14.0.5 and 13.4.2 (a v13/v14 `CID instanceof` boundary), and an invalid `uint8arrays@5.1.1` was hoisted above the 6.1.1 libp2p v3 needs. **`npm install` alone kept the stale tree; a clean re-resolution was required.** `constants.node.test.ts` now asserts one copy of each plus every relay/transport limit.
- **Doc correction:** the relay constants are named `DEFAULT_DURATION_LIMIT`, `DEFAULT_DATA_LIMIT`, `DEFAULT_MAX_RESERVATION_STORE_SIZE` — `DEFAULT_`-prefixed, unlike what PROJECT.md and STACK.md record. Values are as documented (2 min / 128 KiB / 15 / 2 h).
- **Node 23.11.0 is the host runtime and is not LTS.** Outside vitest's declared range (`^20 || ^22 || >=24`), so every install prints `EBADENGINE`, and `packages/node/src/bin/agent.ts` depends on Node's experimental native type stripping. Everything passes today. `STACK.md` specifies Node 24 LTS — switching the toolchain is a human action, deliberately not taken autonomously.
- **Open decisions carried into planning:** aegir vs. vitest for the three-target test discipline (Phase 2); WASM fuel metering has no maintained JS-side tool (Phase 1/2); Safari + WebRTC-Direct is unverified with a WSS-only fallback branch (Phase 4).

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| *(none)* | | | |

## Session Continuity

Last session: 2026-07-25
Stopped at: Phase 2 complete — `@o2/net` and `@o2/node` added, 206 tests green,
kernel unchanged. See `phases/phase-2-real-network/SUMMARY.md`.
Resume file: `.planning/.continue-here.md` — leads with three blocking constraints
(no static determinism analysis, no cross-implementation verification, no host-import
allow-list). Still current; they apply to every later phase.

**Phase 3 needs a human decision before it can finish.** Its criterion is two browser
tabs *on different machines* against a self-hosted backbone. The buildable part —
`circuitRelayServer` backbone, browser transport profile, IndexedDB blockstore, and a
two-context Playwright job against a locally-run relay — needs nothing. "Different
machines" needs either a second machine or a publicly reachable host, and a publicly
reachable relay touches the disclosure gate below.
