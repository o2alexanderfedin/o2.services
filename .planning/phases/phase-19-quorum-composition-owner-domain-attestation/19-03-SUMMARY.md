---
phase: phase-19-quorum-composition-owner-domain-attestation
plan: 03
subsystem: networking
tags: [rendezvous, discovery, browser, webrtc, circuit-relay, multi-engine, e2e]

requires:
  - phase: phase-6
    provides: "`findReservedPeers` and `serveAgent`'s `reservations` branch — the rendezvous this reads"
  - phase: phase-9-public-demo
    provides: "the built bundle, `?relay=` precedence in `discoverRelays`, and the dumb static-host fixture in `built-bundle.e2e.test.ts`"
  - phase: phase-15
    provides: "`planDials` as a pure module, which is what made the round's filtering readable from a test"
provides:
  - "Criterion 4 is measured: three browser peers on the built bundle, served by a file server that 404s `/bootstrap.json`, find each other with no harness dial and finish a job together over direct WebRTC"
  - "The first spec in this repository to run more than one browser engine outside the `browser` vitest project — all ten prior `*.e2e.test.ts` files are chromium-only"
  - "An exact anti-vacuity reading that replaces the borrowed `dialed + failed > 0` one: each round must attempt precisely the peers that page had not yet discovered when it began"
  - "A measured per-pair connection census showing one limited `/p2p-circuit` and one unlimited `/webrtc` per direction — the relay signalled and dropped out"
  - "Three dated corrections inside the Phase 19 roadmap entry, including criterion 4's hook phrasing"
affects:
  - phase-19-quorum-composition-owner-domain-attestation/19-04
  - phase-19-quorum-composition-owner-domain-attestation/19-12

tech-stack:
  added: []
  patterns:
    - "One `browserType.launch()` per peer rather than one `browser.newContext()` per peer — separate storage *and* separate implementations, for no more code"
    - "An engine that cannot take part is collected with its reason and published by a dedicated case, so a shortfall in the standard is a visible red rather than a quietly narrower matrix"
    - "An anti-vacuity reading stated as an exact expected count derived from state read immediately before the act, so a legitimate zero is derived rather than excused"

key-files:
  created:
    - packages/node/src/static-rendezvous.e2e.test.ts
    - .planning/phases/phase-19-quorum-composition-owner-domain-attestation/deferred-items.md
  modified:
    - .planning/ROADMAP.md

key-decisions:
  - "The discovery rounds run in SEQUENCE, not concurrently. Concurrent rounds give every peer something to dial, which is what the borrowed anti-vacuity reading needs, but a simultaneous mutual dial between firefox and webkit lost ICE on one run of three. Sequential is deterministic across seven runs; the reading was strengthened instead of the topology being raced."
  - "The anti-vacuity assertion is `attempted === undiscovered-at-round-start`, not `attempted > 0`. With three peers the third round correctly has nothing to dial, and the exact form makes that zero a derived answer rather than an excused one — while still catching the original defect on any peer, not only one with work outstanding."
  - "`redundancy` is the participating peer count and every cube's agreement is asserted as a full roster, so a run in which one cube distributed and the other silently ran alone cannot pass."
  - "Criterion 4's phrasing names BOTH hooks, not `index` alone. `19-CONTEXT.md` proposed `index` alone; the owner ruled on 2026-08-03 that this understates the criterion, because the clause 'as full peers rather than only through backbone-served fallback' rests on each tab's own `index` hook while the introduction itself comes from the relay's `reservations` thunk."
  - "Correction 3 (criterion 1's entry-point substitution) was NOT written, because it was already on the record from planning time. Re-measured and annotated instead; duplicating it would have made one measurement look like two."
  - "The plan's checkbox in the ROADMAP Plans list was left unticked, matching 19-01, 19-02, 19-05, 19-13 and 19-14, all of which have summaries and unticked boxes. Ticking this one alone would have implied it was the only plan that ran."

requirements-completed: []

duration: ~50 minutes wall, of which the measured spec is 6.6–7.9 s per run
completed: 2026-08-03
---

# Phase 19 Plan 03: Three engines, one relay, no harness dialling — Summary

**Three browser peers — one chromium, one firefox, one webkit, each its own
`browserType.launch()` and so its own storage and its own implementation — open the built
bundle on a file server that answers 404 to `/bootstrap.json`, are handed nothing but the
relay's address through the page's own `?relay=` link, ask the relay who else is present,
dial each other, and finish a two-cube job together over direct WebRTC with every cube's
agreement carrying all three node ids.**

## Host conditions — read before believing any number here

| when | load average (8 cores) |
|---|---|
| start of plan | **5.26 / 6.82 / 12.53** |
| during the first full spec run | 8.39 |
| during the four-run repeat series | 8.20 |
| during the full `--project e2e` run | 5.62–6.89 |
| final verification run | **5.83 → 7.28** |

No other executor was running. The foreign C++ build that had this host at load 220 overnight
was gone. Load never approached the ~30 line at which these readings would have been discarded,
so nothing here was taken under contention.

**This is a one-host result and is labelled as one.** Three engines on one machine are three
independent implementations and three independent storage backends. They are **not** three
machines. Nothing in this plan may be described as cross-machine or distributed-hardware.

## What was built

### `packages/node/src/static-rendezvous.e2e.test.ts` — the eleventh e2e spec, and the first to run more than one engine

Five cases, all green:

1. **all three engines took part, or the one that could not is published with its reason**
2. **the origin has nothing to say** — `/bootstrap.json` 404s, and every page reports
   `source: 'query'` with the relay address it read out of its own link
3. **each peer asks the relay who is here and dials them, with no harness dial**
4. **an unlimited `/webrtc` connection to every peer, not a relayed circuit**
5. **a job completes across the engines, with a non-submitter in the agreement**

The four conditions `seed-discovery.e2e.test.ts` — the closest existing analogue, and the only
prior spec that deliberately does not dial — fails, each inverted here:

| condition | `seed-discovery.e2e.test.ts` | this file |
|---|---|---|
| who serves the page | a live `SeedServer` | a dumb 404-ing file server over `vite build` output |
| what answers the directory | `/bootstrap.json` | nothing |
| storage isolation | two `context.newPage()` on one context | one engine per peer |
| engines | chromium | chromium, firefox, webkit |

There is no `window.o2.dial(...)` anywhere in the file. The only address the harness supplies
is the relay's, and it arrives through the page's own query string.

### The mechanism, confirmed rather than assumed

A tab holds no reservations of its own — `browser-node.ts:1201` is the named absence
`'relays-for-nobody'` — so no tab is ever asked. Both ask the **relay**, a `FabricNode` with a
real thunk at `fabric-node.ts:1601`. Planting the browser tier's sentinel on the relay
(proof 2 below) turns the whole file red, which is what makes that a reading rather than a
description.

### Measured: the per-pair connection census

All six directed pairs, read from inside each page:

| direction | connections held |
|---|---|
| chromium → firefox | 1 × `/p2p-circuit` **limited**, 1 × `/p2p-circuit/webrtc` **unlimited** |
| chromium → webkit | 1 × `/p2p-circuit` **limited**, 1 × `/p2p-circuit/webrtc` **unlimited** |
| firefox → chromium | 1 × `…/ws/…/p2p-circuit` **limited**, 1 × `/webrtc` **unlimited** |
| firefox → webkit | 1 × `/p2p-circuit` **limited**, 1 × `/p2p-circuit/webrtc` **unlimited** |
| webkit → chromium | 1 × `…/ws/…/p2p-circuit` **limited**, 1 × `/webrtc` **unlimited** |
| webkit → firefox | 1 × `…/ws/…/p2p-circuit` **limited**, 1 × `/webrtc` **unlimited** |

Exactly the shape the design predicts: the circuit is retained as a signalling channel and is
marked limited, and the data path beside it is an unlimited WebRTC connection. The job ran over
the second, never the first.

### `.planning/ROADMAP.md` — three corrections

**Correction 1 — criterion 4's hook phrasing.** It read *"discover each other via the wired
`index`/`reservations` hooks"*, which reads as though both hooks were wired on both tiers. Now:
*"via the `index` hook each of them serves and the `reservations` answer the relay gives"*. The
dated comment beside it carries the superseded wording, the four `file:line` measurements, and
the statement that this is about what each node *knows* rather than what either is permitted to
do — explicitly **not** a node-class decision.

**Correction 2 — the `Research: None` line.** It called three symbols uniformly *"uncalled on
the production dispatch path"*. Two are. `composeQuorum` is unimplemented rather than unwired,
and returns a strength it never computes. Corrected in place.

**Correction 3 — criterion 1's entry-point substitution.** Already on the record from planning
time. Re-measured (`bin/agent.ts`: still zero hits for `submitJob`/`JobSpec`/`executeVerified`,
still exactly one `process.stdout.write`, at `:601`) and annotated. Not duplicated.

No other criterion text was amended. `.planning/STATE.md` was not touched.

## Proofs — every one observed, and one of them refuted the plan

Restores were `cp` + `cmp`, never `git checkout --`. Every `cmp` exited 0.

### 1. The discovery is the fabric's, not the harness's

**Mutation:** deleted the `?relay=` return in `discoverRelays` (`demo/main.ts:307`).
**Observed:** exit **1**, all five cases red, `[fixture] build + relay + 0 engines`. All three
engines were published as excluded with the page's own words:

```
chromium could not take part — page.evaluate: Error: no relay available: this page was
not served by a seed node, and no ?relay= was given
```

The exclusion instrument was therefore seen firing, not merely declared.

### 2. The rendezvous answer is what connects them — the pre-Phase-6 signature, reproduced

**Mutation:** `reservations: 'relays-for-nobody'` planted on the **relay** (`fabric-node.ts:1601`).
**Observed:** exit **1**, three cases red. The `asked: true` assertion **passed** and the
attempt count was zero:

```
AssertionError: expected { engine: 'chromium', attempted: +0 } to deeply equal
                         { engine: 'chromium', attempted: 2 }
- Expected
+ Received
  {
-   "attempted": 2,
+   "attempted": 0,
    "engine": "chromium",
  }
```

Asked, nothing attempted, nothing failed, no error anywhere — exactly the shape the fabric
shipped before Phase 6 closed it. **Recorded here for Plan 19-12 to pin.**

### 3. The job really crossed a peer — and the plan's prediction here was wrong

**Plan's prediction:** *"Reddened by running with `peerIds: []`: `complete` stays true and the
agreement assertion goes red."*

**What was observed with `peerIds: []` at this spec's redundancy of 3:** exit 1, and
`expect(run.complete).toBe(true)` was the assertion that failed —

```
AssertionError: expected false to be true
```

`complete` did **not** stay true. The plan drew its prediction from
`built-bundle.e2e.test.ts:292-296`, which runs `peerIds: []` at **redundancy 1**; a solo job at
redundancy 3 cannot reach agreement and reports `complete: false`.

**So the proof was re-run in the shape that isolates the instrument the plan named** —
`peerIds: []` *and* `redundancy: 1`. Then `complete` passed as true and the agreement
assertion was the one that spoke:

```
AssertionError: expected [ Array(1) ] to deeply equal [ …(3) ]
- Expected
+ Received
  [
    "12D3KooWDicNQmaozXnNZnb9xzFU1m7rj5E37Hcy5XczsAoBZ2h4",
-   "12D3KooWMR5s7nmudZYCiGqU664SwQjYDNgkB2iaMvqC32BBnhpK",
-   "12D3KooWPMLHuQgh2b4LHUAQxuVeVx4Etk7iXekbEwcEEa2WfJs9",
  ]
```

One consequence was folded back into the spec: the agreement assertions were moved **above**
the `verificationMultiplier` one, because both go red on a job that ran alone and the multiplier
would otherwise speak first, making a distribution reading read as a redundancy reading.

### 4. The data path is not the circuit

**Mutation:** the `limited` assertion inverted to `true`.
**Observed:** exit **1**, one case red, `limited: false` received where `true` was expected, on
`chromium → firefox`. The connections that *are* limited are listed in the census table above;
none of them carried the job.

## Which engines passed, and what needed engine-specific handling

**All three engines took part. None was excluded.** No engine-specific handling was required in
the final spec — the same code path runs in all three.

Two engine-specific observations worth recording, neither of which needed a workaround:

- **firefox and webkit express the same connection differently.** Chromium reports the far end
  as `/p2p/<relay>/p2p-circuit/webrtc/p2p/<peer>`; firefox and webkit report `/webrtc/p2p/<peer>`
  once the connection is up. Filtering on the substring `/webrtc` covers both, which is what
  `two-tabs.e2e.test.ts:239` already does.
- **firefox ↔ webkit under a simultaneous mutual dial is not reliable.** See below.

## What the plan got wrong

1. **The proof-3 prediction.** Documented in full above. `complete` does not stay true at this
   spec's redundancy; the plan generalised from a redundancy-1 citation.

2. **Every `file:line` the plan and `19-CONTEXT.md` cite for the two hooks is stale by 12–14
   lines.** Measured 2026-08-03:

   | cited | actual |
   |---|---|
   | `browser-node.ts:1164` (`index`) | `browser-node.ts:1178` |
   | `browser-node.ts:1187` (`reservations`) | `browser-node.ts:1201` |
   | `fabric-node.ts:1566` (`index`) | `fabric-node.ts:1578` |
   | `fabric-node.ts:1589` (`reservations`) | `fabric-node.ts:1601` |

   The claims themselves all held. The roadmap comment written by this plan carries the
   corrected numbers.

3. **The budget guidance was an order of magnitude out.** The plan asked for the `it` timeout to
   be sized *"against the slowest existing e2e spec"* and warned that this file might dominate
   `--project e2e`. It does not: it is one of the fastest.

   | measurement | value |
   |---|---|
   | this spec alone, five runs | 6.63 s, 6.85 s, 7.11 s, 7.48 s, 7.85 s |
   | its fixture (`vite build` + relay + three engine launches + three reservations) | 3.7–12.1 s, typically ~4.6 s |
   | the whole `--project e2e`, 11 files / 55 tests | **86.32 s** |

   So this file is roughly 8% of the project's wall time while carrying three engines. The
   `vite build` it pays for is 0.86 s. The generous budgets in the file were left as written —
   they cost nothing when green — but nobody should plan around this file being expensive.

4. **The concurrency the plan implied for the anti-vacuity reading does not survive contact.**
   The plan copied `seed-discovery.e2e.test.ts`'s `dialed + failed > 0` reading. With three
   peers that reading is unobtainable per-peer under sequential rounds and unreliable under
   concurrent ones. The spec states an exact expectation instead.

## The finding this plan is handing on

**Two tabs that dial each other in the same moment can end up connected but unusable, and no
later round repairs it.** Filed in full in this phase's `deferred-items.md`.

Measured across three runs: one simultaneous mutual dial between firefox and webkit lost ICE
(*"WebRTC: ICE failed, add a TURN server"*), leaving the pair holding a **limited** circuit and
no `/webrtc` connection, with `computePeers()` listing nothing from either side. The other two
runs succeeded, producing duplicate connections. Sequential dialling worked in all seven runs.

The half this repository owns: `runDiscoveryRound` passes `connected: n.transport.peers` to
`planDials`, and `planDials` skips anything already in that set (`dial-plan.ts:66`). A limited
circuit puts the peer in that set — so the degraded state is latched, and the 4 s polling timer
in the demo will never retry the upgrade. That half is read off the source, not measured; the
one failing run was not driven through a further round before it was diagnosed, and the summary
says so rather than rounding it up.

It was **not** fixed: 19-03 touches no browser-tier source, and the obvious repair re-dials
every tick for any peer that is legitimately relay-only.

## Commands and real exit codes

Every exit code below was captured with `EXIT=$?` on the line immediately after the command,
with no pipe between.

| command | exit |
|---|---|
| `npx tsc --noEmit` (after the spec was written) | **0** |
| `npx vitest run --project e2e packages/node/src/static-rendezvous.e2e.test.ts` — first sequential version | **0** |
| the same, three consecutive repeats | **0**, **0**, **0** |
| the same, with proof-1 mutation planted | **1** |
| the same, with proof-2 mutation planted | **1** |
| the same, with proof-3 mutation planted (redundancy 3) | **1** |
| the same, with proof-3 mutation planted (redundancy 1) | **1** |
| the same, with proof-4 mutation planted | **1** |
| `npx vitest run --project e2e` — all 11 files, 55 tests | **0** |
| `npx vitest run --project node` vocabulary + requirements-ledger + mutation-guard + slow-specs | **0** |
| `npx tsc --noEmit` (final) | **0** |
| final verification run of the committed spec | **0** |

The four `cmp` restores after the planted mutations each exited **0**.

## Deviations from plan

### Auto-fixed / adjusted

**1. [Rule 1 — the plan's own proof could not produce the reading it named] proof 3 re-run at redundancy 1**
- **Found during:** Task 1, proof 3
- **Issue:** the plan predicted `complete` would stay true with `peerIds: []`; at this spec's
  redundancy of 3 it goes false, so the assertion the plan named as the reading never spoke
- **Fix:** re-ran the mutation at redundancy 1 — the redundancy of the case the plan cited —
  which isolates the agreement assertion; and reordered the spec's assertions so the agreement
  reading precedes the multiplier reading permanently
- **Files modified:** `packages/node/src/static-rendezvous.e2e.test.ts`
- **Commit:** `4fb2ae0`

**2. [Rule 3 — the planned reading was not obtainable] sequential rounds and an exact anti-vacuity assertion**
- **Found during:** Task 1
- **Issue:** the borrowed `dialed + failed > 0` reading cannot hold for all three peers; making
  it hold by running rounds concurrently is flaky, and the flake is a real defect rather than
  contention
- **Fix:** rounds run in sequence; the assertion became an exact expected count derived from
  each page's own `peers()` read immediately before its round
- **Files modified:** `packages/node/src/static-rendezvous.e2e.test.ts`
- **Commit:** `4fb2ae0`

**3. [Scope boundary] correction 3 annotated rather than written**
- **Found during:** Task 2
- **Issue:** the plan listed criterion 1's entry-point substitution as a correction to make; it
  was already recorded at `ROADMAP.md` from planning on 2026-08-02
- **Fix:** re-measured the claim and added a dated confirmation line to the existing comment
- **Files modified:** `.planning/ROADMAP.md`
- **Commit:** `d8bce8f`

### Out of scope, logged not fixed

The firefox ↔ webkit simultaneous-dial latch, in this phase's `deferred-items.md`.

## Known stubs

None.

## Threat flags

None. This plan adds a test and prose; it introduces no endpoint, no auth path, no file access
and no schema change.

## Commits

| hash | message |
|---|---|
| `4fb2ae0` | `test(19-03): three engines find each other on a bundle with no origin to ask` |
| `d8bce8f` | `docs(19-03): criterion 4 names two hooks because it rests on two, on two nodes` |

## Self-Check: PASSED

Both created files and the modified one are on disk; both commit hashes resolve in `git log`.
