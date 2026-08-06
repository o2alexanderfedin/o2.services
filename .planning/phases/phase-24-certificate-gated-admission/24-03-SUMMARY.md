---
phase: phase-24-certificate-gated-admission
plan: 03
subsystem: admission
tags: [AUTH-02, AUTH-04, relay, connection-gater, cli]
requires:
  - RelayAdmission as a required named union on FabricNodeOptions (24-01)
  - admitsAnyPeer, shipped with no caller (24-01)
  - the pre-gate baseline of three host-independent counts (24-02)
provides:
  - a connectionGater consulting RelayAdmission at the reservation and nowhere else
  - the measured fact that a records request landing before serveAgent is DESTROYED, not delayed, and the retry that answers it
  - the revocation window as a measured number, and renewal re-consultation answered YES
  - the answer that a refused peer never retries by itself, and that a reconnect is what gets it in
  - bin/agent.ts --admit-issuer, with the posture published on the handshake line
  - the first guard in the repository that reddens while the door stays open
affects:
  - packages/node/src/fabric-node.ts
  - packages/node/src/enrol-through-a-closed-door.node.test.ts
  - packages/node/src/relay-admission.node.test.ts
  - packages/node/src/bin/agent.ts
  - packages/node/src/bin/seed.ts
  - packages/browser/src/browser-node.ts
  - packages/node/src/static-rendezvous.e2e.test.ts
  - packages/node/src/reservation-exhaustion.node.test.ts
  - vitest.config.ts
tech-stack:
  added: []
  patterns: [retry-not-wait, bounded-lookup-refuse-on-expiry, inverted-tripwire, paired-arm-in-one-run, assembled-matcher]
key-files:
  created:
    - packages/node/src/enrol-through-a-closed-door.node.test.ts
    - .planning/phases/phase-24-certificate-gated-admission/deferred-items.md
  modified:
    - packages/node/src/fabric-node.ts
    - packages/node/src/relay-admission.node.test.ts
    - packages/node/src/bin/agent.ts
    - packages/node/src/bin/seed.ts
    - packages/browser/src/browser-node.ts
    - packages/node/src/static-rendezvous.e2e.test.ts
    - packages/node/src/reservation-exhaustion.node.test.ts
    - vitest.config.ts
decisions:
  - The gate RE-ASKS rather than waits, because the first request is destroyed and not delayed
  - The lookup budget is sited against libp2p's 5 s reservation-completion ceiling, not chosen
  - 'admits-any-peer' supplies no gater method at all, so the open posture means nobody was asked
  - An unknown posture member refuses; returning undefined there would be a fail-open hole opened by a future union member
  - PeerVerifier is not reused — different set, opposite disposition, and a retry floor longer than this gate's whole budget
  - The revocation window is the reservation TTL, measured, with a 30 s floor no TTL can buy past
metrics:
  duration: ~3h
  completed: 2026-08-06
---

# Phase 24 Plan 03: Arm the door, and only the door — Summary

The relay now refuses a reservation to a peer that cannot present a certificate from a pinned
issuer, admits one that can, and tells the two apart from a peer that brought the wrong
issuer's — while a refused peer still connects, starts, serves and enrols through the same
door. **The criterion is numbered 8**, inherited from Phase 19; Phase 24 has exactly one
criterion, so a future verification scores it **out of 1, not out of 8**.

## THE HINGE — measured first, and it falsifies the plan's premise *and* the plan's correction of it

Task 1 was blocking and it owns the phase's load-bearing unknown: **what can the gate learn
about a peer at the instant `denyInboundRelayReservation(source)` fires?** The plan's original
premise was that a `records` exchange is available. Its 2026-08-06 amendment retracted that as
*"false on the first pass"* on the ground that the joiner *"has nothing serving and cannot
answer"*. **Both are wrong, and the truth is more useful than either.**

Measured, one run, recorded verbatim in the file:

| reading | value |
|---|---|
| identify complete on the relay's peer store? | **yes** |
| protocols it lists for the joiner | `/ipfs/id/1.0.0`, `/ipfs/id/push/1.0.0`, `/ipfs/ping/1.0.0`, `/libp2p/circuit/relay/0.2.0/stop`, **`/o2/rpc/1.0.0`** |
| node key available with no I/O | **yes** — the peer id *is* the key, already proved over Noise |
| ask 1, issued at the hook, 700 ms budget | `threw: rpc to … timed out after 700ms`, **701 ms** |
| ask 2, issued 702 ms later | **`answered:certificate-verified`, 4 ms** |
| `serveAgent` ready after the hook fired | **5 ms** |
| libp2p's own reservation ceiling | 5 000 ms (`DEFAULT_RESERVATION_COMPLETION_TIMEOUT`) |

**The gate is not short of information — it is told something true about the protocol table and
false about readiness.** `Libp2pTransport.start` calls `libp2p.handle(O2_RPC_PROTOCOL)`, which
is what makes identify advertise the protocol; the thing that *answers* is registered later, by
`serveAgent`, through `onMessage`. A request landing between those two lines is accepted at the
protocol level and dropped into an **empty handler set** — `#dispatch` is
`for (const handler of [...this.#handlers]) handler(from, message)`, and with no handlers that
loop does nothing and no reply is ever written.

**So the request is destroyed, not delayed, and that single fact decides the design.** Waiting
longer on the same request can never succeed; only asking again can. This is also the mechanism
behind the unexplained 30 s silence `peer-verifier.ts`'s header has recorded since 2026-08-01,
now explained rather than merely re-observed.

**And the peer already holds its certificate when the gate asks.** The plan expected *"a node
reaches the door before it can possibly hold a certificate"*. It does not: `resolveCertificate`
runs before `serveAgent`, the hook fires ~5 ms before `start` resolves, and by then the
enrolment round trip is done. What the peer lacked at the first ask was not a certificate; it
was a handler. **The whole verdict is reachable in 706 ms, inside libp2p's own 5 000 ms
ceiling.** Task 2 was therefore not blocked — but it is built on *retry*, and would have been
wrong in three different ways had it been built on any of the plan's four candidate mechanisms.

## The two load-bearing questions, both answered

**(i) Does `@libp2p/circuit-relay-v2` re-consult the gater on RENEWAL? — YES.** Not by
inspection: admission was withdrawn from a peer already holding a reservation, nothing else
touched, and the hook fired a second time at **30 027 ms** with no reconnection. The refused
renewal never reaches the server's `retimeableSignal` reset, so the entry ran out on its
original clock and the peer left the store at **40 028 ms against a 40 000 ms TTL**. **The
revocation window is the reservation TTL, as a number.** Written into
`FabricNodeOptions.reservationTtlMs`'s docblock, which had none at all — subject first, then
the window.

**There is a floor a short TTL cannot buy past, and it is worth 24-04 knowing:** the transport
refreshes at `min(max(expiry − REFRESH_TIMEOUT, REFRESH_TIMEOUT_MIN), 2³¹−1)` with
`REFRESH_TIMEOUT` 5 min and `REFRESH_TIMEOUT_MIN` **30 s**, so for any TTL under five minutes
the clamp wins. Below ~30 s a reservation expires before its holder ever tries to renew — that
is churn, not revocation. It is also why this spec costs 40 s and cannot cost less.

**(ii) Does a peer refused at first boot get in after enrolling, WITHOUT a restart? — NO.**
The door was opened after the peer had been refused and had enrolled; **nothing happened for
15 s, and the gate was not even consulted again.** The refresh timer is armed only inside the
success path, so a failed reservation leaves no timer and schedules no retry. `bin/agent.ts`'s
own comment already said this about a neighbouring case — *"a single lost attempt is
permanent"* — and it is now measured at the gate.

**What does work short of a restart: a reconnection.** `hangUp` then dial re-enters the hook
off the identify topology event, and the peer is admitted. **24-04 task 2's single-page-load
transition needs an explicit reconnect; it will not happen by itself.**

## What was armed

| Thing | Where |
|---|---|
| `connectionGater.denyInboundRelayReservation` | one key on `createLibp2p` in `fabric-node.ts` |
| `relayAdmissionGate(...)` — constructible with no relay | `fabric-node.ts`, module level |
| `admitsAnyPeer`'s first and only production caller | `fabric-node.ts` |
| `admissionDecisions` — why a peer was turned away | `FabricNode`, bounded at 64 |
| `--admit-issuer`, hex-validated, repeatable | `bin/agent.ts` |
| the posture on the handshake line | `bin/agent.ts` |
| the revocation window, measured | `reservationTtlMs`'s new docblock |

`circuitRelayServer` still takes capacity limits and only capacity limits.

**Design decisions the measurements forced, not preferences:**

- **Retry, never wait.** 700 ms per ask, 100 ms apart, 3 500 ms overall — sited *against*
  libp2p's 5 000 ms ceiling, because a gate that blocks past it fails the reservation on the
  joiner's clock whatever verdict it reaches, and a peer refused without being judged is not a
  peer that was gated.
- **Every path out is a decision.** Out of budget refuses. Relay-not-yet-serving refuses. There
  is no fall-through to "allow", which is the admit-while-pending hole the plan named.
- **An unrecognised posture refuses.** Unreachable today; written fail-closed because returning
  `undefined` there would read as tidier and would be a fail-*open* hole opened by whoever adds
  a second string member to the union.
- **`PeerVerifier` is deliberately not reused.** It pins a different set (selection, not
  admission), is fail-open where this is fail-closed, and its 5 000 ms retry floor is longer
  than this gate's entire budget.

## Defect #51 — the inverted tripwire, observed red before and green after

Every guard 24-01 built fired when the door **closed**; nothing anywhere fired while it stayed
**open**. Three of the four cases are inverted and the fourth is re-documented:

| case | before | now |
|---|---|---|
| census: `total − open === 0` | green forever on an open fabric | **`>= 1`**, and names `bin/agent.ts` |
| gater census | `['browser-node.ts']` | `fabric-node.ts` must appear; the browser negative survives as a **protected property** |
| `admitsAnyPeer` callers | `['relay-admission.ts']` | exactly two, and no third |
| `circuitRelayServer` capacity-only | "this wave moved nothing" | **"the gate is not in the capacity call, and must never be"** — assertions unchanged |

**The observation that cannot be produced by inspection:** the gater row was watched RED on a
tree with the door open — `expected [ Array(1) ] to include 'packages/node/src/fabric-node.ts'`
— and green with it armed.

## Premises found FALSE, and one guard of mine found vacuous

### 1. The plan's account of what the gate can learn is wrong in both directions

Recorded above. The premise, its retraction, and the truth are three different things.

### 2. My inverted census row could not fail — caught by its own prescribed mutation

It read `occurrences(agent, ANY_POSTURE) > occurrences(agent, OPEN_POSTURE)`. Planted with the
mutation the plan names — the bare open literal restored at `bin/agent.ts`'s construction site —
it stayed **GREEN**: the handshake line contributes a second field occurrence, so `2 > 1` held
while the site that actually *decides* had gone back to admitting everybody. **A row satisfiable
by a line that merely reports a posture is not a row about a door.** Repaired to key on what the
mutation restores — zero bare open literals — and re-planted red. Three *other* rows did catch
that plant; the one written for it did not, which is the only reason it was found. This is
24-02's plant-6 lesson arriving again, in a new dress.

### 3. My first "how long until the peer became answerable" reading was an artifact

Polling the peer could only begin once the in-gater probe had spent its budget, so the answer
tracked the budget: **4 000 ms gave 4 028; 1 200 ms gave 1 230.** A number that tracks the
instrument is a number about the instrument. Replaced with `FabricNode.start`'s own resolution —
`serveAgent` is the last thing `#compose` does — which nothing of the test's is on the path of.
The honest reading is **5 ms**.

### 4. My first posture assertion in `static-rendezvous.e2e.test.ts` was vacuous

`relay.admissionDecisions.length === 0` looks behavioural and is not: no peer has asked at that
point in `beforeAll`, so it reads zero for a pinned relay and an open one alike. Replaced with a
read of the fixture's own source, which is what the plan intended and what actually discriminates.

### 5. Two of my own comments reddened raw-text guards

The `#55` sentence named the `serveAgent` reservations sentinel, taking
`serve-agent-hooks.node.test.ts`'s raw-source count from 1 to 2. The refusal test asserted the
whole of stderr does not name `--trusted-issuer`, when `refuse` writes the reason *and* the
entire `USAGE` string. Both fixed; both recorded because a false negative that reads as a real
finding is worse than a gap.

## `bin/agent.ts` can state a closed posture — and it is what takes the census off zero

`--admit-issuer` on `bin/seed.ts`'s idiom rather than a better one: repeatable, hex-validated at
the binary, absence is the literal open posture, reported on its own line. Two places the seed's
shape cannot transfer, stated where they differ — `relayAdmission` is **required**, so the site
takes a **ternary** rather than a conditional spread; and this binary's stdout is a machine-read
handshake line, not a banner.

**The posture is published for a proof requirement, not tidiness:** without it a typo in argv
produces an open agent and a closed-arm reading passes for the wrong reason. Published as a
sorted array, because `JSON.stringify(new Set())` is `{}` — the fail-closed posture would have
been indistinguishable from a missing field.

**The three-flag family carries its disambiguation at the new flag.** `--trust-anchor`: a
**module**. `--trusted-issuer`: a **peer this node talks to** (selection). `--admit-issuer`: a
**peer asking to come in** (admission). Open ruling 1 is untouched; the 19+3 argv cost stays
recorded at the construction site.

`bin/seed.ts`'s `admits` line stopped being true the moment task 2 landed — it claimed the
mechanism did not exist. One line, now stating that seed's posture, and pinned.

## Defect #55, closed

`BrowserNodeOptions.startReporting` argued its shape *"on the same ground as … `FabricNodeOptions.relayAdmission`"* and closed with *"a browser node is not a lesser node"* —
while `BrowserNodeOptions` has no such field. **The absence is topology, not tier:**
`browser-node.ts` imports only `circuitRelayTransport`, never `circuitRelayServer`, and its
whole services list is `identify` + `identifyPush`. A tab runs no relay server, grants no
reservation, and has no reservation to gate. No field was added. The sentence says plainly that
**it is not what carries the claim** — prose is not executable — and names case 2's surviving
negative as what does.

## The two open-door fixtures

Both now state the dependency and pin their own posture, so pinning an issuer fails **by name**.

- **`static-rendezvous.e2e.test.ts`** — three unenrolled tabs, three engines, Phase 19 criterion
  4. Planted with a pinned set: fails in **2.44 s, in `beforeAll`, before a browser launches**.
- **`reservation-exhaustion.node.test.ts`** — owns no literal; its relay is a spawned seed. Its
  instrument is behavioural: **joiner A was granted**, asserted *before* B's refusal is read,
  because under a pinned seed A is refused too and the case title would be satisfied by the
  wrong mechanism. Planted at `seed-server.ts`: fails at A's grant naming admission —
  `agent.ts: relay reservation refused: PERMISSION_DENIED` ×3.

## The operator-facing refusal text 24-04 needs, verbatim

Nothing had to be invented. libp2p throws `reservation failed with status PERMISSION_DENIED`;
`classifyReservationFailure` turns it into `{ kind: 'refused', status: 'PERMISSION_DENIED' }`,
**distinct from the `at-capacity` / `RESERVATION_REFUSED` a full relay produces**; and
`bin/agent.ts` prints `agent.ts: relay reservation refused: PERMISSION_DENIED`. The relay's own
side is new: `FabricNode.admissionDecisions`, e.g. *"… holds no provider-issued certificate, so
it is not admitted to this relay"* versus *"… certificate issued by …, which is not a pinned
provider"*.

## Plants — every one watched, restored by `cp` + `cmp`

| # | Plant | Observed |
|---|---|---|
| 1 | gater method renamed by one character | `timed out waiting for the gater to be consulted about the joiner; observed {"refused":[]}` |
| 2 | joiner enrolled against a second provider | `certificate issued by 1ba09e4e…, which is not a pinned provider` |
| 3 | gate the **connection** instead of the reservation | `start` rejects: `enrollment with … failed (unreachable)` — the seam being wrong |
| 4 | recorded file count 162 → 100 | `the node project holds 162 test files, the recorded measurement covered 100` |
| 5 | `connectionGater` key deleted | `expected [ Array(1) ] to include 'packages/node/src/fabric-node.ts'` — **red with the door open** |
| 6 | `relayAdmission` passed into `circuitRelayServer(` | `expected true to be false` |
| 7 | `admitsAnyPeer` inlined as `===` | `expected [ Array(1) ] to deeply equal [ …(2) ]` |
| 8 | a gater that never answers, 400 ms deadline | refuses with `attempts > 1` — admit-while-pending stays shut |
| 9 | `--admit-issuer` cross-wired into `trustedIssuers` | `expected '…' to contain "trustedIssuers: values['trusted-issuer']"` |
| 10 | handshake posture field dropped | `expected undefined to deeply equal [ Array(1) ]` — no fallback to argv |
| 11 | seed's old parenthetical restored | `packages/node/src/bin/seed.ts still tells an operator the gate is unarmed` |
| 12 | bare open literal restored at `agent.ts` | **green first time** (see "vacuous" above); `expected 1 to be +0` after repair |
| 13 | pinned set at `seed-server.ts` | exhaustion fixture fails at A's grant: `expected 0 to be greater than 0`, stderr `relay reservation refused: PERMISSION_DENIED` |
| 14 | pinned set at `static-rendezvous`'s relay | fails by name in 2.44 s, before any browser |

## Measurements, exit codes read directly

| Command | Exit | Result | Process reading |
|---|---|---|---|
| `npx tsc --noEmit` | **0** | zero output, repeatedly | — |
| `--project browser` | **0** | 249 files, 4092 tests — **identical to 24-02** | `real 50.51 user 97.36 sys 23.94`, ratio **2.40** |
| `--project e2e static-rendezvous` | **0** | 5 tests, all three engines | `real 7.81 user 6.58 sys 2.05`, ratio **1.11** |
| `--project node` (run 1) | **1** | 2284 passed, 10 failed — 9 `lift` + 1 mine | `real 434.78 user 352.72 sys 57.64`, ratio **0.94** |
| `--project node` (run 2) | **1** | **2293 passed, 1 failed** — `lift` green, mine fixed | `real 411.58 user 361.42 sys 64.00`, ratio **1.03** |
| `enrol-through-a-closed-door` solo | **0** | 5 tests | `real 60.73 / 60.87`, ratio **0.043** |
| `bench-admission` (24-02 baseline) | **0** | counts byte-identical | `real 1.96`, ratio **1.08** |

**24-02's baseline re-run and unchanged**, which is the reading that says the open posture is
genuinely inert: `room-for-everyone {connected 4, granted 3, advertised 3}` and
`room-for-all-but-one {connected 4, granted 2, advertised 2}`. Arming the gate moved no
published number — not because the posture is open, but because `'admits-any-peer'` supplies no
gater method at all.

**The node project's exit 1 is two deferred items, neither this plan's, both attributed by
measurement** — see `deferred-items.md`. `lift.node.test.ts` (9 cases, run 1) self-diagnosed as
docker swamped and is **green in run 2 on the same code**. `late-combine.node.test.ts` (1 case,
run 2) is a self-calibrating timing budget that **passes in isolation** (`real 12.42`, ratio
1.24) and, decisively, `grep -c "relayAdmission\|relay-addr"` over it returns **0** — no node in
it ever requests a reservation, so the code this plan added is never reached.

## `slow-specs.node.test.ts` — re-sited rather than widened

The tree had drifted to 161 files; this plan's spec makes 162, landing the drift check on
exactly its tolerance of 5. Passing with no headroom is what made three agents reach for
`O2_SKIP_GUARDS` last time, so **the count was retaken, not the tolerance widened**:
`NODE_MEASUREMENT.files` 157 → 162, cross-checked by two routes sharing no code (the filesystem
walk the guard itself uses, and `git ls-files`). The new spec's span is in
`MEASURED_NODE_SPANS` at its measured **59 160 ms** (reporter span; cross-checked against
`real 60.73 / 60.87` less the ~1.2 s boot floor, no hook shadow).

**Nothing was re-timed**, and the file says so at the field: `load`, `tests`, `wallClockMs`,
`sumOfReportedSpansMs` and every other span still describe the 2026-08-05 run. `unitFiles`
104 → 108 is **derived and NOT re-observed**, which is a weakening of that field and is recorded
as one. A live gap is named rather than closed: `job-entry-points.node.test.ts` is now tracked
but still absent from the table, still paying 2 737 ms into every `test:unit` run — transcribing
a span out of a docblock is not measuring one, and this plan did not run that file.

## What this plan did NOT do

- **It did not measure the criterion.** A green suite says the tree runs. Every clause of
  criterion 8 across real processes and real tabs is 24-04's, and any reading here taken as
  criterion evidence is the defect this phase exists to avoid.
- **No browser-tier reading of the gate.** A `BrowserNode` runs no relay server, so there is
  nothing there to gate; the tab's side of admission is 24-04's.
- **Neither open-door fixture was converted.** Annotated and pinned, not changed.
- **`PeerVerifier` was neither moved nor flipped.** Phase 22 owns the move (D09).
- **Open ruling 1 is untouched.** No refuse-to-start at either binary.
- **No seed-side admission flag.** 24-01's deferral stands; only the stale banner line moved.
- **`BrowserNodeOptions` gained no field.**
- **`STATE.md`, `ROADMAP.md`, `REQUIREMENTS.md` are untouched** — see below.

## Notes for the verifier — ledger changes this plan did not make

Not edited, on instruction. What this plan would otherwise have recorded:

- **AUTH-02 / AUTH-04**: the mechanism is armed and measured in-process. Neither closes until
  24-04 reads the criterion across real processes and real tabs.
- Phase 24 progress: plans 1–3 of 4 complete.
- **For 24-04, the three things that change its plan:**
  1. A refused peer **never retries by itself** — a reconnect is required. Task 2's
     single-page-load transition must trigger one.
  2. The gate reaches a verdict at **first grant**, in ~706 ms, by re-asking. It does not need
     the re-reservation path to work.
  3. The refusal strings already exist and are listed above verbatim; the relay-side reasons
     come from `FabricNode.admissionDecisions`.
- 24-02's warning stands and was heeded: the phase's plan inventory has been wrong about file
  inventories repeatedly. Every list in this plan was re-derived from `git ls-files` or from the
  installed package, never from a plan — which is how the plan's own hinge premise was caught.

## Known stubs

None. Every value added is consulted, and the one new getter (`admissionDecisions`) is read by
three cases and by two fixtures.

## Self-Check: PASSED

- `packages/node/src/enrol-through-a-closed-door.node.test.ts` — FOUND
- `packages/node/src/fabric-node.ts` — FOUND
- `packages/node/src/relay-admission.node.test.ts` — FOUND
- `packages/node/src/bin/agent.ts` — FOUND
- `packages/node/src/bin/seed.ts` — FOUND
- `packages/browser/src/browser-node.ts` — FOUND
- `packages/node/src/static-rendezvous.e2e.test.ts` — FOUND
- `packages/node/src/reservation-exhaustion.node.test.ts` — FOUND
- `vitest.config.ts` — FOUND
- `.planning/phases/phase-24-certificate-gated-admission/deferred-items.md` — FOUND
- `af58b6d` — FOUND (2 files)
- `9f94dd5` — FOUND (2 files)
- `024250c` — FOUND (3 files)
- `b060f06` — FOUND (4 files)
