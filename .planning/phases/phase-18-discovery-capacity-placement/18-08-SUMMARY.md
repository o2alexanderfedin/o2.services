---
phase: phase-18-discovery-capacity-placement
plan: 08
subsystem: scheduling
tags: [governor, duty-cycle, admission, capacity, node-tier, operator-control]

requires:
  - phase: phase-18-discovery-capacity-placement/18-07
    provides: "`DutyCycleGovernor.setDutyCycle`, `environment` composition, and `CapacityOptions.dutyCycle: number | Governor` — the mechanism this plan composes into a real node"
provides:
  - "`FabricNode` composes `new GovernedExecutor(counter, governor)` — SCHED-04's *honoured by the executor* half, which had never been true on this tier because `FabricNode` composed no governor at all"
  - "`FabricNode.dutyCycle` getter and `FabricNode.setDutyCycle()` — one call moves both the pacing and the slot count the node advertises"
  - "`bin/agent.ts --duty-cycle` — the cap chosen at start"
  - "`<dir>/.duty-cycle` + `SIGHUP` — the cap moved on a node that is already serving"
  - "`dutyCycle` on the agent's handshake line, so a spawning test reads what the process actually pinned"
  - "`duty-cycle.node.test.ts` — the wire half, measured: a peer probes `{kind:'offer'}` over tcp + noise + yamux and reads `slots: 2` after a `setDutyCycle(0.25)`"
affects: [phase-18-discovery-capacity-placement/18-09]

tech-stack:
  added: []
  patterns:
    - "The counter goes INSIDE the governor on both tiers: a counter outside counts tasks parked on the serialisation chain as in flight, which is not what 'how many tasks is this node running at once' means"
    - "A control channel's reach is a security property, not an ergonomics one — pick the channel by who can already reach it"
    - "Two failure dispositions in one binary, each argued: fatal before the node exists, named-and-survivable while it is serving other peers' work"
    - "A load gate must sample after the reading as well as before — a one-minute average lags the load that invalidates the measurement"

key-files:
  created:
    - packages/node/src/duty-cycle.node.test.ts
    - .planning/phases/phase-18-discovery-capacity-placement/18-08-SUMMARY.md
  modified:
    - packages/node/src/fabric-node.ts
    - packages/node/src/bin/agent.ts
    - packages/node/src/transport-bounds.node.test.ts

key-decisions:
  - "The control channel is a FILE AND A SIGNAL, not a wire frame. `serveAgent` serves unauthenticated, so a frame that set a CPU cap would let any peer able to dial a machine throttle one it does not own. `<dir>/.duty-cycle` + SIGHUP is reachable only by whoever can already write that directory."
  - "Which property of `--dir` is used, stated because the directory now carries two kinds of thing: the key files live there because they are SECRET, the control file because it is OWNED."
  - "The counter moves inside the governor, matching the browser tier, so both tiers agree on layer order."
  - "This REVERSES a decision recorded at `browser-node.ts` ('two independent throttles on one path produce a number nobody can predict'), so it is argued rather than silently changed: they are not two throttles. `GovernedExecutor` is the mechanism; the slot count is the statement about it — advisory, reserving nothing. One cap, seen twice."
  - "What that costs, stated rather than discovered later: a throttled node now refuses earlier as well as running slower. Intended."
  - "A bad `.duty-cycle` file writes one named stderr line and leaves the running cap alone — the OPPOSITE disposition from `--provider-addr`'s fatal check in the same file. That one runs before the node exists, where refusing to start is honest; this one runs while the node is serving other peers' work, and a mistyped file is not a reason to drop those connections."
  - "`SIGHUP` is deliberately NOT wired to the shutdown path. Its default disposition is to terminate, so this handler's existence is the only thing keeping the node alive through one; routing it to `shutdown` would have looked tidy and done exactly what having no handler does."
  - "`provenance(compute)` survives as literal text — mutation-ledger entry M27 checks the recorded signature."

patterns-established:
  - "Plant the mutation the plan names and read which assertion reddens: removing the `GovernedExecutor` wrapper moved throttled peak 1 -> 6; removing `dutyCycle: governor` reddened 3 cases while slots stayed 8. Two different mutations, two different signatures — neither would have been caught by the other's test."

requirements-completed: []

duration: ~2h
completed: 2026-08-01
---

# Phase 18 Plan 08: A duty cycle an operator can move on a running node — Summary

**SCHED-04's *honoured by the executor* half had never been true on the Node tier, because
`FabricNode` composed no governor at all; its *user-adjustable* half had never been true
anywhere. 18-07 built the mechanism. This plan composes it into a real node and gives an
operator two ways to reach it — one at start, one on a process that is already serving.**

## What changed

`FabricNode` now wraps `new GovernedExecutor(counter, governor)` and hands **the same
governor object** to `LocalCapacity`. That sharing is the whole design: one `setDutyCycle`
call changes both the rate the node runs at and the slot count it advertises, with nothing
else wired, because the capacity reads the governor rather than a number copied out of it
at construction.

```
GovernedExecutor( CountingExecutor( guardSovereignty( provenance( compute ) ) ) )
                          ▲                                    ▲
                          └── counter INSIDE the governor       └── literal text, M27
LocalCapacity({ dutyCycle: governor })   ← same object, so slots follow the cap
```

The counter sits **inside** the governor, matching the browser tier and for that tier's
stated reason: a counter outside would count tasks parked on the serialisation chain as in
flight, which is not what "how many tasks is this node running at once" means. Both tiers
now agree on layer order, which is the precondition for 18-09 reading the same numbers.

## The control channel, and why it is not on the wire

The obvious design is a frame — the node already speaks a request/response protocol, and a
`{kind:'set-duty-cycle'}` would have been a dozen lines.

**`serveAgent` serves unauthenticated.** A frame that set a CPU cap would let any peer that
can dial a machine throttle one it does not own, which converts a scheduling control into a
denial-of-service primitive available to every peer in the fabric.

So the channel is `<dir>/.duty-cycle` plus `SIGHUP`, and its reach is exactly the set of
principals who can already write that directory — which is the set that could already stop
the process. Worth noting *which* property of `--dir` each file uses, because the directory
now carries two kinds of thing: the identity key and certificate live there because they
are **secret**; the control file lives there because it is **owned**.

The two failure dispositions in `bin/agent.ts` now differ, and the difference is argued in
the source so the two do not read as inconsistent. `--provider-addr`'s check is **fatal** —
it runs before the node exists, where refusing to start is the honest answer to a
half-configured process. The `SIGHUP` re-read is **named and survivable** — it runs while
the node is serving other peers' work, and a control file somebody mistyped is not a reason
to drop those connections. A bad file writes one line to stderr and leaves the cap where it
was.

`SIGHUP` is also deliberately not routed through `shutdown`. The signal's default
disposition is to terminate the process, so the existence of this handler is the only thing
keeping the node alive through one; wiring it to the shutdown path would have looked tidy
and done precisely what having no handler does.

## What was measured

`duty-cycle.node.test.ts` reads the published figure **off the wire**, not off the object:
a peer dials over tcp + noise + yamux, probes with `{kind:'offer'}`, and reads `slots: 2`
after a `setDutyCycle(0.25)` on a node whose `maxConcurrent` is 8. That is the reading a
requestor actually gets, and it is the one that matters for placement.

Both mutations the plan names were planted and both were caught, with **different**
signatures:

| Planted | Reddens |
|---|---|
| remove the `GovernedExecutor` wrapper | throttled peak 1 → 6 |
| remove `dutyCycle: governor` from the capacity | 3 cases red, slots stay 8 |

Neither would have been caught by the other's assertion, which is the point of planting
both rather than one.

## An unrelated failure this plan had to fix to be trusted

`transport-bounds.node.test.ts` failed in the full suite and passed 3/3 in isolation — the
shape that usually means a test is wrong about its own environment rather than about its
subject.

Its load gate sampled `loadavg()[0]` only **before** the work. A one-minute average lags:
the suite began at load 5.20, the case read 51,452,307 bytes against a 40 MiB threshold,
and the load that invalidated the reading arrived as the other 122 files spun up — after
the gate had already passed. The gate now samples after the reading too. Confirmed on the
next full run: load rose 6.81 → 58.50 and the case withheld the byte figure while still
asserting the refusal counter, which is unconditional and always runs.

## What this plan did not do

The browser tier. `browser-node.ts` is 18-09's file; the composition it needs and the
recorded decision it must reverse were written down for that plan rather than reached
across into here.
