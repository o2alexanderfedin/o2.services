# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-07-24)

**Core value:** Usable capacity grows super-linearly with the user base, without any raw data leaving its owner's device.
**Current focus:** Phase 1 — Determinism Gate & Trust-Model Verdict

## Current Position

Phase: 1 of 11 (Determinism Gate & Trust-Model Verdict)
Plan: 0 of TBD in current phase
Status: Ready to plan
Last activity: 2026-07-24 — Roadmap created; 70/70 v1 requirements mapped across 11 phases

Progress: [░░░░░░░░░░] 0%

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

- Phase 1 gates the trust model. V8 has no NaN canonicalization and x86/ARM disagree on new-NaN sign bits, so honest nodes may split a quorum. Both branches are pre-planned: N-version comparison if the harness is clean, backbone-anchored audit sampling (VER-07) if not. No re-roadmap either way.
- The verification claim is split (C3, decided): full N-version on public/shared data and on the aggregation tree; sovereign maps are owner-attested, carried by egress manifest + coverage report. Do not plan N-version over sovereign maps.
- Relay decision inverted by evidence: own backbone relay primary (AutoTLS + webRTCDirect), public infra opportunistic only. Browsers structurally cannot dial the majority of public libp2p nodes.
- Ordering is load-bearing: sovereignty before placement, tree-reduce before placement, artifact signing at content-addressing time (not at elfconv time), coordinator checkpointing in the churn phase, governor + benchmark instrumentation in the kernel phase.
- Part I (elfconv AOT) sequenced last and run as a parallel track; it must not block the capacity-scaling thesis.

### Pending Todos

None yet.

### Blockers/Concerns

- **Disclosure gate:** publishing forfeits EPO/China patent rights permanently. No deploy workflow file may exist in the repository at all — absent, not disabled. Deployment is a separately-triggered human action (DEMO-04).
- **Version traps (C5):** js-libp2p is 3.x with an `EventTarget` stream API break; four look-current trap packages must be avoided (`@chainsafe/libp2p-gossipsub@14`, `@libp2p/noise`, `@libp2p/yamux`, `@libp2p/mplex`). Pin exact versions; the constants-regression test lands in Phase 3.
- **Open decisions carried into planning:** aegir vs. vitest for the three-target test discipline (Phase 2); WASM fuel metering has no maintained JS-side tool (Phase 1/2); Safari + WebRTC-Direct is unverified with a WSS-only fallback branch (Phase 4).

## Deferred Items

Items acknowledged and carried forward from previous milestone close:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| *(none)* | | | |

## Session Continuity

Last session: 2026-07-24
Stopped at: ROADMAP.md and STATE.md written; REQUIREMENTS.md traceability populated
Resume file: None
